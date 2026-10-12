-- 0034 — PR 19: histórico de tarefas (quem abriu, quem recebeu, reatribuições, prazo adiado, conclusão) + notificações (sino)
-- Idempotente. Depende de 0003 (tarefas, v_tarefas), 0030 (lead_tarefas).

-- ---------- tarefas: quem concluiu ----------
alter table public.tarefas add column if not exists concluida_por uuid references public.perfis(id) on delete set null;

-- ---------- eventos (trilha de auditoria legível) ----------
create table if not exists public.tarefa_eventos (
  id bigserial primary key,
  tarefa_id uuid references public.tarefas(id) on delete cascade,
  lead_tarefa_id bigint references public.lead_tarefas(id) on delete cascade,
  tipo text not null check (tipo in ('criada','reatribuida','prazo_alterado','status','concluida','reaberta','cancelada','comentario','editada')),
  de text, para text,              -- valor anterior / novo (nome do responsável, data do prazo, status…)
  nota text,                        -- comentário livre (ex.: "petição protocolada")
  autor uuid references public.perfis(id) on delete set null,
  autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists tarefa_eventos_tarefa_idx on public.tarefa_eventos (tarefa_id, criado_em);
create index if not exists tarefa_eventos_lead_idx on public.tarefa_eventos (lead_tarefa_id, criado_em);
alter table public.tarefa_eventos enable row level security;
drop policy if exists "tarefa_eventos: equipe le" on public.tarefa_eventos;
create policy "tarefa_eventos: equipe le" on public.tarefa_eventos for select to authenticated using (public.sou_equipe());
drop policy if exists "tarefa_eventos: equipe comenta" on public.tarefa_eventos;
create policy "tarefa_eventos: equipe comenta" on public.tarefa_eventos for insert to authenticated with check (public.sou_equipe() and tipo = 'comentario' and autor = auth.uid());

-- ---------- notificações (sino) ----------
create table if not exists public.notificacoes (
  id bigserial primary key,
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  titulo text not null,
  texto text,
  link text,                        -- hash do painel, ex.: #tarefas/<id>
  lida_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists notificacoes_perfil_idx on public.notificacoes (perfil_id, lida_em, criado_em desc);
alter table public.notificacoes enable row level security;
drop policy if exists "notificacoes: minhas" on public.notificacoes;
create policy "notificacoes: minhas" on public.notificacoes for select to authenticated using (perfil_id = auth.uid());
drop policy if exists "notificacoes: marcar lida" on public.notificacoes;
create policy "notificacoes: marcar lida" on public.notificacoes for update to authenticated using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

create or replace function public.notificar(p_perfil uuid, p_titulo text, p_texto text, p_link text) returns void
language sql security definer set search_path = public as $$
  insert into public.notificacoes (perfil_id, titulo, texto, link)
  select p_perfil, p_titulo, p_texto, p_link where p_perfil is not null and p_perfil <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
$$;

-- nome legível do perfil (cai no colaborador, depois no e-mail)
create or replace function public.nome_perfil(p uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select c.nome from public.colaboradores c where c.perfil_id = p limit 1), (select coalesce(nullif(nome,''), email) from public.perfis where id = p));
$$;

-- ---------- carimbos (antes) + trilha e notificações (depois) das tarefas de cliente ----------
create or replace function public.tarefa_carimbo() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then new.concluida_por := coalesce(new.concluida_por, auth.uid());
  elsif new.status <> 'concluida' then new.concluida_por := null; end if;
  return new;
end $$;
drop trigger if exists tarefas_carimbo on public.tarefas;
create trigger tarefas_carimbo before insert or update on public.tarefas for each row execute procedure public.tarefa_carimbo();

create or replace function public.tarefa_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; resp_perfil uuid; resp_nome text; ant_nome text; link text; titulo text;
begin
  meu := public.nome_perfil(eu);
  link := '#tarefas/' || new.id;
  titulo := left(new.titulo, 90);
  select c.perfil_id, c.nome into resp_perfil, resp_nome from public.colaboradores c where c.id = new.responsavel_id;
  if tg_op = 'INSERT' then
    insert into public.tarefa_eventos (tarefa_id, tipo, para, autor, autor_nome) values (new.id, 'criada', resp_nome, eu, meu);
    perform public.notificar(resp_perfil, 'Nova tarefa para você', coalesce(meu,'Alguém') || ' abriu: ' || titulo || coalesce(' · prazo ' || to_char(new.prazo,'DD/MM'), ''), link);
    return null;
  end if;
  -- UPDATE
  if new.responsavel_id is distinct from old.responsavel_id then
    select c.nome into ant_nome from public.colaboradores c where c.id = old.responsavel_id;
    insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'reatribuida', ant_nome, resp_nome, eu, meu);
    perform public.notificar(resp_perfil, 'Tarefa passada para você', coalesce(meu,'Alguém') || ' passou: ' || titulo || coalesce(' · prazo ' || to_char(new.prazo,'DD/MM'), ''), link);
  end if;
  if new.prazo is distinct from old.prazo then
    insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'prazo_alterado', to_char(old.prazo,'DD/MM/YYYY'), to_char(new.prazo,'DD/MM/YYYY'), eu, meu);
    if new.prazo > old.prazo and new.created_by is distinct from eu then
      perform public.notificar(new.created_by, 'Prazo adiado', coalesce(meu,'Alguém') || ' adiou "' || titulo || '" de ' || to_char(old.prazo,'DD/MM') || ' para ' || to_char(new.prazo,'DD/MM'), link);
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'concluida' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'concluida', eu, meu);
      perform public.notificar(new.created_by, 'Tarefa concluída', coalesce(meu,'Alguém') || ' concluiu: ' || titulo, link);
    elsif old.status = 'concluida' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'reaberta', eu, meu);
    elsif new.status = 'cancelada' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'cancelada', eu, meu);
      perform public.notificar(new.created_by, 'Tarefa cancelada', coalesce(meu,'Alguém') || ' cancelou: ' || titulo, link);
    else
      insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'status', old.status, new.status, eu, meu);
    end if;
  end if;
  if new.titulo is distinct from old.titulo or new.descricao is distinct from old.descricao or new.prazo_fatal is distinct from old.prazo_fatal or new.prioridade is distinct from old.prioridade then
    insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'editada', eu, meu);
  end if;
  return null;
end $$;
drop trigger if exists tarefas_trilha on public.tarefas;
create trigger tarefas_trilha after insert or update on public.tarefas for each row execute procedure public.tarefa_trilha();

-- ---------- tarefas de lead: carimbo (antes) + trilha e notificações (depois) ----------
create or replace function public.lead_tarefa_carimbo() returns trigger language plpgsql as $$
begin
  if new.concluida_em is not null and (tg_op = 'INSERT' or old.concluida_em is null) then new.concluida_por := coalesce(new.concluida_por, auth.uid());
  elsif new.concluida_em is null then new.concluida_por := null; end if;
  return new;
end $$;
drop trigger if exists lead_tarefas_carimbo on public.lead_tarefas;
create trigger lead_tarefas_carimbo before insert or update on public.lead_tarefas for each row execute procedure public.lead_tarefa_carimbo();

create or replace function public.lead_tarefa_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; link text; titulo text; lnome text;
begin
  meu := public.nome_perfil(eu);
  select nome into lnome from public.leads where id = new.lead_id;
  link := '#leads/' || new.lead_id;
  titulo := coalesce(new.titulo, new.tipo) || coalesce(' — ' || lnome, '');
  if tg_op = 'INSERT' then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, para, autor, autor_nome) values (new.id, 'criada', public.nome_perfil(new.responsavel_id), eu, meu);
    perform public.notificar(new.responsavel_id, 'Nova tarefa de lead para você', coalesce(meu,'Alguém') || ' abriu: ' || titulo || ' · ' || to_char(new.quando at time zone 'America/Sao_Paulo','DD/MM HH24:MI'), link);
    return null;
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'reatribuida', public.nome_perfil(old.responsavel_id), public.nome_perfil(new.responsavel_id), eu, meu);
    perform public.notificar(new.responsavel_id, 'Tarefa de lead passada para você', coalesce(meu,'Alguém') || ' passou: ' || titulo, link);
  end if;
  if new.quando is distinct from old.quando then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'prazo_alterado', to_char(old.quando at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'), to_char(new.quando at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'), eu, meu);
  end if;
  if new.concluida_em is not null and old.concluida_em is null then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, autor, autor_nome) values (new.id, 'concluida', eu, meu);
    perform public.notificar(new.criado_por, 'Tarefa de lead concluída', coalesce(meu,'Alguém') || ' concluiu: ' || titulo, link);
  elsif new.concluida_em is null and old.concluida_em is not null then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, autor, autor_nome) values (new.id, 'reaberta', eu, meu);
  end if;
  return null;
end $$;
drop trigger if exists lead_tarefas_trilha on public.lead_tarefas;
create trigger lead_tarefas_trilha after insert or update on public.lead_tarefas for each row execute procedure public.lead_tarefa_trilha();

-- ---------- v_tarefas: quem abriu / quem concluiu (colunas na ordem original + novas no fim, para não quebrar v_prazos/v_clientes_ficha) ----------
create or replace view public.v_tarefas with (security_invoker = true) as
select t.id, t.titulo, t.descricao, t.cliente_id, t.contrato_id, t.processo_id, t.responsavel_id, t.nucleo, t.prazo, t.prazo_fatal, t.status, t.concluida_em, t.prioridade, t.created_at, t.created_by, t.updated_at, t.updated_by,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(h.horas) from public.apontamentos_horas h where h.tarefa_id = t.id), 0) as horas_apontadas,
       t.concluida_por,
       public.nome_perfil(t.created_by) as criado_por_nome,
       public.nome_perfil(t.concluida_por) as concluida_por_nome
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

-- ---------- tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.tarefa_eventos;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notificacoes;
exception when duplicate_object then null; end $$;

select 'ok 0034' as resultado;
