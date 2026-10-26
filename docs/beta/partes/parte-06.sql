-- ESPELHO (beta) — parte 6 de 9: 0050_agenda_lembretes_leads.sql … 0059_conhecimento_por_area.sql

-- ===== 0050_agenda_lembretes_leads.sql =====
-- 0050 — Agenda: (a) lembretes no sino 1h antes de cada compromisso + "Agenda de hoje" no resumo diário (Discord/painel);
-- (b) reunião marcada no CRM (leads.reuniao_em) vira compromisso na Agenda do proprietário (e vai para o Google pela sincronização).
-- Idempotente. Depende de 0047 (agenda), 0038 (resumo), 0030 (leads/fases), 0034 (notificar).

alter table public.agenda_eventos add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.agenda_eventos add column if not exists lembrado_em timestamptz;
create unique index if not exists agenda_eventos_lead_uidx on public.agenda_eventos (lead_id) where lead_id is not null;

-- ---------- view: + lead ----------
create or replace view public.v_agenda with (security_invoker = true) as
select e.id, e.titulo, e.inicio, e.fim, e.dia_inteiro, e.colaborador_id, co.nome as colaborador_nome, e.cliente_id, c.nome as cliente_nome, e.processo_id, p.numero_cnj,
       e.tarefa_id, e.tipo, e.local, e.descricao, e.link, e.origem, e.google_event_id is not null as no_google, e.cancelado, e.sincronizado_em, e.updated_at,
       e.lead_id, l.nome as lead_nome
from public.agenda_eventos e
left join public.colaboradores co on co.id = e.colaborador_id
left join public.clientes c on c.id = e.cliente_id
left join public.processos p on p.id = e.processo_id
left join public.leads l on l.id = e.lead_id;

-- ---------- (b) reunião do lead → Agenda ----------
create or replace function public.lead_para_agenda() returns trigger language plpgsql security definer set search_path = public as $$
declare colab uuid; titulo text; desc_ text;
begin
  if tg_op = 'DELETE' then
    update public.agenda_eventos set cancelado = true where lead_id = old.id and not cancelado;
    return old;
  end if;
  if new.reuniao_em is null or new.status = 'Perdido' then
    update public.agenda_eventos set cancelado = true where lead_id = new.id and not cancelado;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.reuniao_em = old.reuniao_em and new.status = old.status and new.proprietario_id is not distinct from old.proprietario_id
     and new.nome = old.nome and new.empresa is not distinct from old.empresa then
    return new;
  end if;
  select id into colab from public.colaboradores where perfil_id = new.proprietario_id and ativo is distinct from false limit 1;
  titulo := 'Reunião: ' || coalesce(nullif(new.nome,''), 'lead') || coalesce(' (' || nullif(new.empresa,'') || ')', '');
  desc_ := 'Lead do CRM' || coalesce(E'\nWhatsApp: ' || nullif(new.whatsapp,''), '') || coalesce(E'\nE-mail: ' || nullif(new.email,''), '') || coalesce(E'\nChat: ' || nullif(new.link_chat,''), '');
  insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, lead_id, tipo, origem, descricao, link, cancelado, created_by)
  values (titulo, new.reuniao_em, new.reuniao_em + interval '1 hour', false, colab, new.id, 'reuniao', 'painel', desc_, '#leads/' || new.id::text, false, new.proprietario_id)
  on conflict (lead_id) where lead_id is not null do update set
    titulo = excluded.titulo, inicio = excluded.inicio, fim = excluded.fim, colaborador_id = coalesce(excluded.colaborador_id, agenda_eventos.colaborador_id),
    descricao = excluded.descricao, cancelado = false,
    lembrado_em = case when agenda_eventos.inicio <> excluded.inicio then null else agenda_eventos.lembrado_em end;
  return new;
end $$;
drop trigger if exists lead_agenda on public.leads;
create trigger lead_agenda after insert or update of reuniao_em, status, proprietario_id, nome, empresa or delete on public.leads for each row execute procedure public.lead_para_agenda();
-- backfill: reuniões futuras já marcadas
update public.leads set reuniao_em = reuniao_em where reuniao_em >= now() and status is distinct from 'Perdido';

-- reagendou (pelo painel ou pelo Google) → lembra de novo
create or replace function public.agenda_marca_alterado() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.titulo, new.inicio, new.fim, new.dia_inteiro, new.local, new.descricao, new.cancelado, new.colaborador_id) is distinct from (old.titulo, old.inicio, old.fim, old.dia_inteiro, old.local, old.descricao, old.cancelado, old.colaborador_id) then
    new.atualizado_em := now();
  end if;
  if tg_op = 'UPDATE' and new.inicio <> old.inicio then new.lembrado_em := null; end if;
  return new;
end $$;

-- ---------- (a) lembretes: 60 min antes, no sino de quem é o colaborador do compromisso ----------
create or replace function public.agenda_lembretes() returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; mins int; txt text;
begin
  for r in
    select e.id, e.titulo, e.inicio, e.local, e.tipo, e.lead_id, e.tarefa_id, c.perfil_id
    from public.agenda_eventos e join public.colaboradores c on c.id = e.colaborador_id
    where not e.cancelado and not e.dia_inteiro and e.lembrado_em is null and c.perfil_id is not null
      and e.inicio > now() and e.inicio <= now() + interval '60 minutes'
  loop
    mins := greatest(1, round(extract(epoch from (r.inicio - now())) / 60));
    txt := to_char(r.inicio at time zone 'America/Sao_Paulo', 'HH24:MI') || coalesce(' · ' || nullif(r.local,''), '');
    perform public.notificar(r.perfil_id, 'Em ' || mins || ' min: ' || left(r.titulo, 80), txt,
      case when r.lead_id is not null then '#leads/' || r.lead_id::text when r.tarefa_id is not null then '#tarefas/' || r.tarefa_id::text else '#agenda' end);
    update public.agenda_eventos set lembrado_em = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.agenda_lembretes() from public, anon, authenticated;

create or replace function public.configurar_agenda_lembretes(minutos integer default 5) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'agenda-lembretes-np';
  perform cron.schedule('agenda-lembretes-np', format('*/%s * * * *', minutos), 'select public.agenda_lembretes()');
  return 'Lembretes da agenda a cada ' || minutos || ' min';
end $$;
revoke all on function public.configurar_agenda_lembretes(integer) from public, anon, authenticated;

-- ---------- resumo diário: "Agenda de hoje" ----------
create or replace function public.resumo_diario_texto(p_colab uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; r record; t text := ''; n int; painel text;
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
begin
  select * into c from public.colaboradores where id = p_colab;
  if c is null then return null; end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PAINEL_URL' limit 1), 'https://nevespaduaadv.github.io/painel') into painel;
  t := '☀️ *Bom dia, ' || split_part(c.nome, ' ', 1) || '!* ' || dias[extract(dow from hoje)::int + 1] || ', ' || to_char(hoje, 'DD/MM') || E'\n';

  -- agenda de hoje (painel + Google + reuniões do CRM)
  select count(*) into n from public.agenda_eventos e where e.colaborador_id = p_colab and not e.cancelado and (e.inicio at time zone 'America/Sao_Paulo')::date = hoje;
  if n > 0 then
    t := t || E'\n📆 *Agenda de hoje (' || n || ')*' || E'\n';
    for r in select * from public.agenda_eventos e where e.colaborador_id = p_colab and not e.cancelado and (e.inicio at time zone 'America/Sao_Paulo')::date = hoje order by e.dia_inteiro desc, e.inicio limit 10 loop
      t := t || '• ' || case when r.dia_inteiro then 'dia todo' else to_char(r.inicio at time zone 'America/Sao_Paulo', 'HH24:MI') end || ' ' || left(r.titulo, 70) || coalesce(' — ' || nullif(r.local,''), '') || E'\n';
    end loop;
    if n > 10 then t := t || '  … e mais ' || (n - 10) || E'\n'; end if;
  end if;

  -- atrasados
  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada';
  if n > 0 then
    t := t || E'\n🔴 *Atrasado (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada' order by z.prazo limit 8 loop
      t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || ' (' || to_char(r.prazo,'DD/MM') || case when r.prazo_fatal then ', FATAL' else '' end || ')' || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  -- hoje
  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje';
  t := t || E'\n📌 *Vence hoje (' || n || ')*' || E'\n';
  if n = 0 then t := t || '• nada para hoje' || E'\n'; end if;
  for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje' order by z.prazo_fatal desc, z.descricao limit 10 loop
    t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️ FATAL' else '' end || E'\n';
  end loop;

  -- próximos 7 dias
  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7';
  if n > 0 then
    t := t || E'\n📅 *Próximos 7 dias (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7' order by z.prazo, z.prazo_fatal desc limit 8 loop
      t := t || '• ' || to_char(r.prazo,'DD/MM') || ' ' || left(r.descricao, 60) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️' else '' end || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  -- tarefas de lead (CRM) vencidas/hoje, pelo perfil
  if c.perfil_id is not null then
    select count(*) into n from public.lead_tarefas lt where lt.responsavel_id = c.perfil_id and lt.concluida_em is null and (lt.quando at time zone 'America/Sao_Paulo')::date <= hoje;
    if n > 0 then t := t || E'\n📞 *Leads: ' || n || ' tarefa(s) para hoje ou atrasada(s)*' || E'\n'; end if;
    select count(*) into n from public.notificacoes x where x.perfil_id = c.perfil_id and x.lida_em is null;
    if n > 0 then t := t || E'\n🔔 ' || n || ' notificação(ões) não lida(s) no painel' || E'\n'; end if;
  end if;

  t := t || E'\n' || painel || '/#painel';
  return t;
end $$;

select public.configurar_agenda_lembretes(5) as resultado;


-- ===== 0051_acordos_maturacao_pos_acordo.sql =====
-- 0051 — Operação PJ (setor de acordos):
--   (a) régua de maturação: alerta + tarefa aos 6 meses de inadimplência de cada contrato e no 10º/11º/12º mês de contrato do cliente;
--   (b) pós-acordo: ao registrar um acordo, abre as tarefas de depoimento/indicação, prova social e relatório de conclusão;
--   (c) direcionamento do cliente (acordos extrajudicial × jurídico PJ) na ficha → abre a tarefa no núcleo certo e garante a negociação.
-- Idempotente. Depende de 0010 (fluxo PJ, negociacoes, tarefas), 0034 (notificar), 0038 (resumo), 0003 (acordos).

-- ---------- helpers: responsável padrão de um núcleo, aviso no sino do colaborador, formato R$
-- (as tarefas criadas aqui já avisam o responsável pelo gatilho tarefa_trilha de 0034 — por isso não há aviso duplicado) ----------
create or replace function public.responsavel_padrao(p_nucleo text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.colaboradores where ativo and nucleo = p_nucleo order by data_admissao nulls last limit 1
$$;
revoke all on function public.responsavel_padrao(text) from public, anon;

create or replace function public.notificar_colaborador(p_colab uuid, p_titulo text, p_texto text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare perfil uuid;
begin
  if p_colab is null then return; end if;
  select perfil_id into perfil from public.colaboradores where id = p_colab;
  if perfil is not null then perform public.notificar(perfil, p_titulo, p_texto, p_link); end if;
end $$;
revoke all on function public.notificar_colaborador(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.brl(v numeric) returns text language sql immutable as $$
  select case when v is null then null else 'R$ ' || replace(replace(replace(to_char(v, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.') end
$$;

-- responsável do setor de acordos para um cliente/contrato: quem está com a negociação aberta; senão o padrão do núcleo
create or replace function public.responsavel_acordos(p_cliente text, p_contrato text default null) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select n.responsavel_id from public.negociacoes n where n.cliente_id = p_cliente and n.responsavel_id is not null and n.etapa <> 'concluido'
       order by (n.contrato_id = p_contrato) desc nulls last, n.updated_at desc limit 1),
    (select n.responsavel_id from public.negociacoes n where n.cliente_id = p_cliente and n.responsavel_id is not null order by n.updated_at desc limit 1),
    public.responsavel_padrao('acordos'))
$$;
revoke all on function public.responsavel_acordos(text, text) from public, anon;

-- ---------- (a) régua de maturação ----------
create table if not exists public.maturacao_alertas (
  id bigserial primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete cascade,
  tipo text not null,                       -- atraso_6m | contrato_10m | contrato_11m | contrato_12m
  referencia date,                          -- data que disparou (início do atraso / fechamento)
  tarefa_id uuid references public.tarefas(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists maturacao_alertas_uidx on public.maturacao_alertas (cliente_id, coalesce(contrato_id,''), tipo);
alter table public.maturacao_alertas enable row level security;
drop policy if exists "maturacao: equipe le" on public.maturacao_alertas;
create policy "maturacao: equipe le" on public.maturacao_alertas for select to authenticated using (public.sou_equipe());

create or replace function public.acordos_regua_maturacao() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; resp uuid; tid uuid; nome text; meses int; titulo text; descr text;
begin
  -- 1) 6 meses de inadimplência por contrato (sem acordo registrado, contrato ainda em cobrança/ajuizado)
  for r in
    select k.id as contrato_id, k.cliente_id, k.banco, k.produto, k.data_inicio_atraso, k.saldo_atual, coalesce(c.nome_fantasia, c.dados->>'nome', c.id) as cliente_nome
    from public.contratos k join public.clientes c on c.id = k.cliente_id
    where k.data_inicio_atraso is not null and k.data_inicio_atraso <= current_date - interval '6 months'
      and coalesce(k.situacao,'') not in ('quitado','emdia')
      and coalesce(c.status,'ativo') = 'ativo'
      and not exists (select 1 from public.acordos a where a.contrato_id = k.id)
      and not exists (select 1 from public.maturacao_alertas m where m.contrato_id = k.id and m.tipo = 'atraso_6m')
  loop
    resp := public.responsavel_acordos(r.cliente_id, r.contrato_id);
    titulo := 'Acordos: 6 meses de atraso — ' || coalesce(r.banco,'banco') || coalesce(' · ' || nullif(r.produto,''), '') || ' (' || r.cliente_nome || ')';
    descr := 'Contrato em atraso desde ' || to_char(r.data_inicio_atraso,'DD/MM/YYYY') || coalesce(' · saldo ' || public.brl(r.saldo_atual), '') ||
             E'.\nMaturação atingida: janela típica de proposta do banco. Revise a negociação (valores, alçada do cliente e próximo passo) e registre a proposta.';
    insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
    values (titulo, descr, r.cliente_id, r.contrato_id, resp, 'acordos', current_date + 3, 1) returning id into tid;
    insert into public.maturacao_alertas (cliente_id, contrato_id, tipo, referencia, tarefa_id) values (r.cliente_id, r.contrato_id, 'atraso_6m', r.data_inicio_atraso, tid);
    n := n + 1;
  end loop;

  -- 2) 10º, 11º e 12º mês de contrato do cliente (clientes ativos com dívida em atraso ou negociação aberta)
  for r in
    select c.id as cliente_id, c.data_fechamento, coalesce(c.nome_fantasia, c.dados->>'nome', c.id) as cliente_nome,
           (select count(*) from public.negociacoes x where x.cliente_id = c.id and x.etapa <> 'concluido') as abertas
    from public.clientes c
    where c.data_fechamento is not null and coalesce(c.status,'ativo') = 'ativo'
      and (coalesce(c.tem_divida_atraso,false) or exists (select 1 from public.negociacoes x where x.cliente_id = c.id and x.etapa <> 'concluido'))
      and c.data_fechamento <= current_date - interval '10 months'
  loop
    for meses in 10..12 loop
      continue when r.data_fechamento > current_date - (meses || ' months')::interval;
      continue when exists (select 1 from public.maturacao_alertas m where m.cliente_id = r.cliente_id and m.contrato_id is null and m.tipo = 'contrato_' || meses || 'm');
      resp := public.responsavel_acordos(r.cliente_id);
      titulo := 'Acordos: ' || meses || 'º mês de contrato — ' || r.cliente_nome;
      descr := 'Contrato com o escritório fechado em ' || to_char(r.data_fechamento,'DD/MM/YYYY') || ' · ' || r.abertas || ' negociação(ões) aberta(s).' ||
               case meses when 10 then E'\nFaltam 2 meses: priorize as negociações com proposta em aberto e alinhe com o cliente a alçada final.'
                          when 11 then E'\nFalta 1 mês: feche o que estiver maduro e defina com as sócias o que fica para renovação.'
                          else E'\nÚltimo mês de contrato: concluir ou formalizar a renovação/encerramento com o cliente.' end;
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values (titulo, descr, r.cliente_id, resp, 'acordos', current_date + 2, case when meses = 12 then 1 else 2 end) returning id into tid;
      insert into public.maturacao_alertas (cliente_id, tipo, referencia, tarefa_id) values (r.cliente_id, 'contrato_' || meses || 'm', r.data_fechamento, tid);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.acordos_regua_maturacao() from public, anon, authenticated;

-- opcional: marcar o que já está maduro hoje como "já alertado", sem abrir tarefas (para a régua valer só daqui em diante)
create or replace function public.regua_maturacao_marcar_existentes() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with ins as (
    insert into public.maturacao_alertas (cliente_id, contrato_id, tipo, referencia)
    select k.cliente_id, k.id, 'atraso_6m', k.data_inicio_atraso from public.contratos k
    where k.data_inicio_atraso <= current_date - interval '6 months'
    on conflict do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.regua_maturacao_marcar_existentes() from public, anon, authenticated;

create or replace function public.configurar_regua_maturacao(hora_brt integer default 6) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'acordos-maturacao-np';
  perform cron.schedule('acordos-maturacao-np', format('30 %s * * 1-5', (hora_brt + 3) % 24), 'select public.acordos_regua_maturacao()');
  return 'Régua de maturação diária às ' || hora_brt || 'h30 (seg–sex)';
end $$;
revoke all on function public.configurar_regua_maturacao(integer) from public, anon, authenticated;

-- ---------- (b) pós-acordo ----------
create or replace function public.acordos_pos_acordo() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text; banco text; resp_aco uuid; resp_acp uuid; t1 uuid; t2 uuid; t3 uuid;
begin
  select coalesce(c.nome_fantasia, c.dados->>'nome', c.id), c.responsavel_onboarding_id into nome, resp_acp from public.clientes c where c.id = new.cliente_id;
  select k.banco into banco from public.contratos k where k.id = new.contrato_id;
  resp_aco := public.responsavel_acordos(new.cliente_id, new.contrato_id);
  resp_acp := coalesce(resp_acp, public.responsavel_padrao('acompanhamento_pj'));
  if exists (select 1 from public.tarefas t where t.contrato_id = new.contrato_id and t.titulo like 'Pós-acordo:%' and t.created_at > now() - interval '1 day') then return new; end if;

  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Pós-acordo: pedir depoimento e indicação — ' || nome,
          'Acordo ' || coalesce(banco,'') || ' de ' || to_char(new.data,'DD/MM/YYYY') || coalesce(' · ' || public.brl(new.valor_pago), '') ||
          coalesce(' · desconto ' || to_char(new.desconto_obtido,'FM990D0') || '%', '') || E'.\nPeça o depoimento (áudio/vídeo/texto) e 1–2 indicações. Registre na timeline do cliente.',
          new.cliente_id, new.contrato_id, resp_aco, 'acordos', new.data + 7, 2) returning id into t1;
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Pós-acordo: prova social (PNG na pasta do cliente no Drive) — ' || nome,
          'Monte a imagem padrão do acordo (banco, valor original × valor pago, desconto) sem dados pessoais e salve na pasta do cliente no Drive. Avise o marketing.',
          new.cliente_id, new.contrato_id, resp_aco, 'acordos', new.data + 7, 3) returning id into t2;
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Pós-acordo: relatório de conclusão para o cliente — ' || nome,
          'Acordo ' || coalesce(banco,'') || ' concluído em ' || to_char(new.data,'DD/MM/YYYY') || '. Envie o relatório de conclusão (o que foi negociado, economia obtida, próximos passos) e atualize a etapa do fluxo PJ.',
          new.cliente_id, new.contrato_id, resp_acp, 'acompanhamento_pj', new.data + 5, 2) returning id into t3;

  return new;
end $$;
drop trigger if exists acordos_pos_acordo on public.acordos;
create trigger acordos_pos_acordo after insert on public.acordos for each row execute procedure public.acordos_pos_acordo();

-- ---------- (c) direcionamento ----------
alter table public.clientes add column if not exists direcionamento text check (direcionamento in ('acordos','juridico','ambos'));
alter table public.clientes add column if not exists direcionamento_em date;
alter table public.clientes add column if not exists registrato_ok boolean;   -- Registrato (BCB) salvo na pasta do cliente

create or replace function public.clientes_direcionar() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text; resp uuid; tid uuid; aviso text;
begin
  if new.direcionamento is null or (tg_op = 'UPDATE' and new.direcionamento = old.direcionamento) then return new; end if;
  nome := coalesce(new.nome_fantasia, new.dados->>'nome', new.id);
  new.direcionamento_em := current_date;
  aviso := case when coalesce(new.registrato_ok,false) then '' else E'\n⚠️ Registrato ainda não marcado como salvo na pasta — confira antes de abrir as negociações.' end;

  if new.direcionamento in ('acordos','ambos') then
    resp := public.responsavel_acordos(new.id);
    if not exists (select 1 from public.negociacoes where cliente_id = new.id and etapa <> 'concluido') then
      insert into public.negociacoes (cliente_id, titulo, etapa, responsavel_id, proximo_passo)
      values (new.id, 'Acompanhamento — ' || nome, 'iniciar', resp, 'Segmentar as dívidas (banco, tipo, valor, data do atraso) e abrir uma negociação por contrato');
    end if;
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Acordos: cliente direcionado para negociação extrajudicial — ' || nome,
            'Direcionamento feito pelo Acompanhamento PJ em ' || to_char(current_date,'DD/MM/YYYY') || coalesce(E'.\nDívidas mapeadas: ' || nullif(new.tipos_dividas,''), '') || aviso ||
            E'\nAbra uma negociação por banco/contrato, registre valores e alçada e defina o próximo passo.',
            new.id, resp, 'acordos', current_date + 3, 1) returning id into tid;
  end if;

  if new.direcionamento in ('juridico','ambos') then
    resp := public.responsavel_padrao('juridico');
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Jurídico PJ: cliente direcionado para peça — ' || nome,
            'Direcionamento feito pelo Acompanhamento PJ em ' || to_char(current_date,'DD/MM/YYYY') || coalesce(E'.\nDívidas mapeadas: ' || nullif(new.tipos_dividas,''), '') ||
            E'\nDefina a estratégia (revisional, defesa, exceção…) e gere a peça pelo módulo Peças.',
            new.id, resp, 'juridico', current_date + 3, 1) returning id into tid;
  end if;
  return new;
end $$;
drop trigger if exists clientes_direcionar on public.clientes;
create trigger clientes_direcionar before insert or update of direcionamento on public.clientes for each row execute procedure public.clientes_direcionar();

select public.configurar_regua_maturacao(6) as resultado;


-- ===== 0052_onboarding_cliente.sql =====
-- 0052 — Onboarding do cliente PJ (POP Onboarding, passos 1–6 e lembretes):
--   (a) fila de mensagens WhatsApp para clientes (enviada pela Edge Function chatguru, rota /automacoes, a cada minuto, em horário comercial);
--   (b) boas-vindas + link do formulário 5 min depois do cadastro do cliente (token próprio de onboarding, sem login);
--   (c) formulário de mapeamento respondido pelo cliente → ficha/bens, tarefa de auditoria, confirmação + link da agenda;
--   (d) agendamento da R1 pelo cliente (≥ 1 dia útil de preparo, horários livres do responsável) → Agenda/Google, tarefa de preparação,
--       confirmação e lembretes no dia (8h30 e 1h antes, com o link da call quando preenchido no compromisso).
-- Idempotente. Depende de 0010 (fluxo PJ), 0027/0028 (automações/token), 0047 (agenda), 0051 (helpers), feriados (0040?).

-- ---------- token de onboarding e colunas ----------
alter table public.agenda_eventos add column if not exists finalidade text;   -- 'onboarding' = R1 marcada pelo cliente
alter table public.clientes add column if not exists onboarding_token text;
alter table public.clientes add column if not exists onboarding_enviado_em timestamptz;
alter table public.clientes add column if not exists formulario_em timestamptz;
create unique index if not exists clientes_onboarding_token_uidx on public.clientes (onboarding_token) where onboarding_token is not null;
update public.clientes set onboarding_token = encode(gen_random_bytes(24), 'hex') where onboarding_token is null;

create or replace function public.clientes_token_onboarding() returns trigger language plpgsql as $$
begin
  if new.onboarding_token is null then new.onboarding_token := encode(gen_random_bytes(24), 'hex'); end if;
  return new;
end $$;
drop trigger if exists clientes_token_onboarding on public.clientes;
create trigger clientes_token_onboarding before insert on public.clientes for each row execute procedure public.clientes_token_onboarding();

-- ---------- modelos de mensagem (editáveis) ----------
create table if not exists public.mensagens_modelos (
  chave text primary key,
  titulo text not null,
  texto text not null,
  variaveis text,
  updated_at timestamptz not null default now()
);
alter table public.mensagens_modelos enable row level security;
drop policy if exists "modelos: equipe le" on public.mensagens_modelos;
create policy "modelos: equipe le" on public.mensagens_modelos for select to authenticated using (public.sou_equipe());
drop policy if exists "modelos: admin edita" on public.mensagens_modelos;
create policy "modelos: admin edita" on public.mensagens_modelos for update to authenticated using (public.sou_admin()) with check (public.sou_admin());

insert into public.mensagens_modelos (chave, titulo, texto, variaveis) values
('onb_boas_vindas', 'Onboarding — boas-vindas + formulário',
 E'Olá, {nome}! Aqui é da Neves Pádua Advocacia. Seja bem-vindo(a)! 🤝\n\nPara começarmos o seu acompanhamento, preencha o formulário de mapeamento (leva cerca de 10 minutos):\n{link}\n\nCom ele preparamos a sua primeira reunião de estratégia. Qualquer dúvida, é só responder por aqui.',
 '{nome} {link}'),
('onb_formulario_recebido', 'Onboarding — formulário recebido + agenda',
 E'Recebemos o seu formulário, {nome} — obrigado! ✅\n\nAgora escolha o melhor horário para a sua reunião de onboarding:\n{link}',
 '{nome} {link}'),
('onb_reuniao_confirmada', 'Onboarding — reunião confirmada',
 E'Reunião de onboarding confirmada para {data} às {hora}, com {responsavel}. 📅\n\nVamos apresentar a estratégia inicial e alinhar os próximos 30 dias.\nSe precisar remarcar: {link}',
 '{nome} {data} {hora} {responsavel} {link}'),
('onb_lembrete_dia', 'Onboarding — lembrete no dia',
 E'Bom dia, {nome}! Hoje às {hora} temos a sua reunião de onboarding com {responsavel}.\n{link_call}',
 '{nome} {hora} {responsavel} {link_call}'),
('onb_lembrete_1h', 'Onboarding — lembrete 1h antes',
 E'Em 1 hora: reunião de onboarding às {hora} com {responsavel}.\n{link_call}',
 '{nome} {hora} {responsavel} {link_call}')
on conflict (chave) do nothing;

create or replace function public.modelo_texto(p_chave text, p_vars jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text; k text; v text;
begin
  select texto into t from public.mensagens_modelos where chave = p_chave;
  if t is null then return null; end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    t := replace(t, '{' || k || '}', coalesce(v, ''));
  end loop;
  return t;
end $$;

-- ---------- fila de mensagens para clientes ----------
create table if not exists public.mensagens_fila (
  id bigserial primary key,
  cliente_id text references public.clientes(id) on delete cascade,
  nome text,
  numero text,
  modelo text,
  vars jsonb not null default '{}'::jsonb,
  texto text,                                   -- texto final (preenchido na hora de enviar, ou fixo)
  evento_id uuid references public.agenda_eventos(id) on delete cascade,
  referencia text,                              -- ex.: onboarding:boas_vindas
  enviar_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente','processando','enviada','erro','cancelada')),
  tentativas integer not null default 0,
  resultado text,
  enviada_em timestamptz,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists mensagens_fila_pend_idx on public.mensagens_fila (enviar_em) where status = 'pendente';
create index if not exists mensagens_fila_cli_idx on public.mensagens_fila (cliente_id, created_at desc);
alter table public.mensagens_fila enable row level security;
drop policy if exists "fila: equipe le" on public.mensagens_fila;
create policy "fila: equipe le" on public.mensagens_fila for select to authenticated using (public.sou_equipe());
drop policy if exists "fila: equipe cancela" on public.mensagens_fila;
create policy "fila: equipe cancela" on public.mensagens_fila for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- WhatsApp do cliente: contato principal → qualquer contato com telefone → ficha (dados)
create or replace function public.cliente_whatsapp(p_cliente text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(regexp_replace(ct.telefone, '[^0-9+]', '', 'g'), '') from public.contatos ct where ct.cliente_id = p_cliente and ct.telefone is not null order by ct.principal desc nulls last, ct.created_at limit 1),
    (select nullif(regexp_replace(coalesce(c.dados->>'whatsapp', c.dados->>'celular', c.dados->>'telefone', c.dados->>'representanteTelefone'), '[^0-9+]', '', 'g'), '') from public.clientes c where c.id = p_cliente))
$$;

create or replace function public.cliente_primeiro_nome(p_cliente text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    split_part((select ct.nome from public.contatos ct where ct.cliente_id = p_cliente and nullif(ct.nome,'') is not null order by ct.principal desc nulls last, ct.created_at limit 1), ' ', 1),
    split_part((select nullif(c.representante,'') from public.clientes c where c.id = p_cliente), ' ', 1),
    (select coalesce(c.nome_fantasia, c.dados->>'nome') from public.clientes c where c.id = p_cliente))
$$;

create or replace function public.painel_url() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PAINEL_URL' limit 1), 'https://nevespaduaadv.github.io/painel')
$$;
revoke all on function public.painel_url() from public, anon;

-- enfileira uma mensagem de modelo para o cliente
create or replace function public.mensagem_enfileirar(p_cliente text, p_modelo text, p_vars jsonb default '{}'::jsonb, p_quando timestamptz default now(), p_referencia text default null, p_evento uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare num text; nome text; id_ bigint;
begin
  num := public.cliente_whatsapp(p_cliente);
  nome := public.cliente_primeiro_nome(p_cliente);
  insert into public.mensagens_fila (cliente_id, nome, numero, modelo, vars, referencia, evento_id, enviar_em, status, resultado)
  values (p_cliente, nome, num, p_modelo, coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('nome', nome), p_referencia, p_evento, p_quando,
          case when num is null then 'erro' else 'pendente' end, case when num is null then 'Cliente sem WhatsApp cadastrado (contatos/ficha).' end)
  returning id into id_;
  if num is null then
    perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = p_cliente), 'Mensagem não enviada: cliente sem WhatsApp',
      coalesce((select coalesce(nome_fantasia, dados->>'nome') from public.clientes where id = p_cliente), p_cliente) || ' — cadastre o contato principal com telefone', '#clientes/' || p_cliente);
  end if;
  return id_;
end $$;
revoke all on function public.mensagem_enfileirar(text, text, jsonb, timestamptz, text, uuid) from public, anon;

-- texto final na hora do envio (resolve o link da call do compromisso, se houver)
create or replace function public.mensagem_texto(m public.mensagens_fila) returns text
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := m.vars; ev record;
begin
  if m.texto is not null then return m.texto; end if;
  if m.evento_id is not null then
    select * into ev from public.agenda_eventos where id = m.evento_id;
    if found then
      v := v || jsonb_build_object('hora', to_char(ev.inicio at time zone 'America/Sao_Paulo', 'HH24:MI'), 'data', to_char(ev.inicio at time zone 'America/Sao_Paulo', 'DD/MM'),
             'link_call', case when nullif(ev.link,'') is not null and ev.link not like '#%' then 'Link da reunião: ' || ev.link
                               when nullif(ev.local,'') is not null then 'Local: ' || ev.local
                               else 'O link da chamada será enviado por aqui antes do horário.' end);
    end if;
  end if;
  return public.modelo_texto(m.modelo, v);
end $$;

create or replace function public.mensagens_reservar(token text, limite integer default 5) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  update public.mensagens_fila set status = 'pendente', atualizado_em = now() where status = 'processando' and atualizado_em < now() - interval '10 minutes';
  -- lembretes de compromisso cancelado não saem
  update public.mensagens_fila m set status = 'cancelada', resultado = 'Compromisso cancelado', atualizado_em = now()
  from public.agenda_eventos e where m.evento_id = e.id and m.status = 'pendente' and e.cancelado;
  if not public.em_horario_comercial(now()) then return '[]'::jsonb; end if;
  with esc as (
    select id from public.mensagens_fila where status = 'pendente' and enviar_em <= now() and numero is not null
    order by enviar_em limit greatest(1, least(coalesce(limite, 5), 20)) for update skip locked
  ), res_ as (
    update public.mensagens_fila m set status = 'processando', tentativas = m.tentativas + 1, atualizado_em = now(), texto = public.mensagem_texto(m)
    from esc where m.id = esc.id returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nome', coalesce(r.nome, 'Cliente'), 'numero', r.numero, 'texto', r.texto)), '[]'::jsonb) into res from res_ r;
  return res;
end $$;
revoke all on function public.mensagens_reservar(text, integer) from public, anon, authenticated;
grant execute on function public.mensagens_reservar(text, integer) to service_role;

create or replace function public.mensagens_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; m public.mensagens_fila;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for it in select value from jsonb_array_elements(coalesce(resultados, '[]'::jsonb)) loop
    select * into m from public.mensagens_fila where id = (it->>'id')::bigint and status = 'processando';
    continue when not found;
    if coalesce((it->>'ok')::boolean, false) then
      update public.mensagens_fila set status = 'enviada', enviada_em = now(), resultado = it->>'descricao', atualizado_em = now() where id = m.id;
      if m.cliente_id is not null then
        insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
        values (m.cliente_id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'WhatsApp enviado: ' || coalesce((select titulo from public.mensagens_modelos where chave = m.modelo), m.modelo, 'mensagem'), false, true, 'onboarding');
      end if;
    elsif coalesce((it->>'temporario')::boolean, false) and m.tentativas < 3 then
      update public.mensagens_fila set status = 'pendente', enviar_em = now() + interval '5 minutes', resultado = it->>'erro', atualizado_em = now() where id = m.id;
    else
      update public.mensagens_fila set status = 'erro', resultado = it->>'erro', atualizado_em = now() where id = m.id;
      perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = m.cliente_id), 'WhatsApp não enviado',
        coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#clientes/' || coalesce(m.cliente_id, ''));
    end if;
  end loop;
end $$;
revoke all on function public.mensagens_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.mensagens_registrar(text, jsonb) to service_role;

-- ---------- (b) boas-vindas 5 min depois do cadastro ----------
create or replace function public.onboarding_enviar_boas_vindas(p_cliente text, p_em timestamptz default now() + interval '5 minutes') returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.clientes; id_ bigint;
begin
  select * into c from public.clientes where id = p_cliente;
  if c.onboarding_token is null then update public.clientes set onboarding_token = encode(gen_random_bytes(24), 'hex') where id = p_cliente returning * into c; end if;
  update public.mensagens_fila set status = 'cancelada', resultado = 'Reenviado', atualizado_em = now() where cliente_id = p_cliente and referencia = 'onboarding:boas_vindas' and status = 'pendente';
  id_ := public.mensagem_enfileirar(p_cliente, 'onb_boas_vindas', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token), p_em, 'onboarding:boas_vindas');
  update public.clientes set onboarding_enviado_em = p_em, etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 2) where id = p_cliente;
  return id_;
end $$;
revoke all on function public.onboarding_enviar_boas_vindas(text, timestamptz) from public, anon;
grant execute on function public.onboarding_enviar_boas_vindas(text, timestamptz) to authenticated;

create or replace function public.clientes_boas_vindas_auto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.ativo, true) then perform public.onboarding_enviar_boas_vindas(new.id); end if;
  return new;
end $$;
drop trigger if exists clientes_boas_vindas_auto on public.clientes;
create trigger clientes_boas_vindas_auto after insert on public.clientes for each row execute procedure public.clientes_boas_vindas_auto();

-- tarefas do cliente novo: títulos alinhados ao fluxo automatizado (mesma lógica de 0010)
create or replace function public.fluxo_novo_cliente() returns trigger language plpgsql security definer set search_path = public as $$
declare novo boolean := (tg_op = 'INSERT');
        virou_divida boolean := (tg_op = 'UPDATE' and coalesce(new.tem_divida_atraso,false) and not coalesce(old.tem_divida_atraso,false));
        resp_onb uuid; resp_jur uuid; resp_aco uuid;
begin
  if not (novo or virou_divida) then return new; end if;
  resp_onb := public.responsavel_padrao('acompanhamento_pj'); resp_jur := public.responsavel_padrao('juridico'); resp_aco := public.responsavel_padrao('acordos');
  if novo then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Onboarding: conferir cadastro, contato principal e boas-vindas (D0)', E'O sistema envia as boas-vindas com o link do formulário 5 min após o cadastro (precisa do WhatsApp no contato principal).\nConfira a ficha, a pasta no Drive e o dossiê (gravações/transcrições do fechamento).', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 2, 1),
           ('Onboarding: iniciar auditoria ONB (dossiê, gravações, promessas da venda)', 'Comece antes de o formulário voltar. Ao receber o formulário, o sistema abre a tarefa de conferência e envia a agenda ao cliente.', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 5, 2),
           ('Monitoramento: cadastrar CNPJ/CPFs no Escavador e iniciar checagem', 'Preencha a aba Monitoramento do cliente (documentos monitorados, próxima checagem).', new.id, resp_jur, 'juridico', current_date + 3, 2);
    insert into public.monitoramentos (cliente_id, status, responsavel_id, proxima_checagem)
    values (new.id, 'em_monitoramento', resp_jur, current_date + 3) on conflict (cliente_id) do nothing;
  end if;
  if (novo and coalesce(new.tem_divida_atraso,false)) or virou_divida then
    if not exists (select 1 from public.negociacoes where cliente_id = new.id) then
      insert into public.negociacoes (cliente_id, titulo, etapa, responsavel_id, proximo_passo)
      values (new.id, 'Acompanhamento — '||coalesce(new.nome_fantasia, new.dados->>'nome', new.id), 'iniciar', resp_aco, 'Levantar bancos, valores e situação de cada dívida em atraso');
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Acordos: iniciar acompanhamento das dívidas em atraso', 'Cliente marcado com dívida em atraso. Abra uma negociação por banco/contrato.', new.id, resp_aco, 'acordos', current_date + 5, 2);
    end if;
  end if;
  return new;
end $$;

-- ---------- (c) formulário de mapeamento ----------
create table if not exists public.onboarding_respostas (
  id bigserial primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  respostas jsonb not null,
  enviado_em timestamptz not null default now(),
  conferido_em timestamptz,
  conferido_por uuid
);
create index if not exists onboarding_respostas_cli_idx on public.onboarding_respostas (cliente_id, enviado_em desc);
alter table public.onboarding_respostas enable row level security;
drop policy if exists "onb: equipe le" on public.onboarding_respostas;
create policy "onb: equipe le" on public.onboarding_respostas for select to authenticated using (public.sou_equipe());
drop policy if exists "onb: equipe confere" on public.onboarding_respostas;
create policy "onb: equipe confere" on public.onboarding_respostas for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

create or replace function public.onboarding_cliente_por_token(t text) returns public.clientes
language sql stable security definer set search_path = public as $$
  select * from public.clientes where onboarding_token = t and length(coalesce(t,'')) >= 32 and coalesce(ativo, true)
$$;
revoke all on function public.onboarding_cliente_por_token(text) from public, anon, authenticated;

-- o que a página pública mostra
create or replace function public.onboarding_contexto(t text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; ev record; resp text;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then return null; end if;
  select e.* into ev from public.agenda_eventos e where e.cliente_id = c.id and e.tipo = 'reuniao' and e.finalidade = 'onboarding' and not e.cancelado and e.inicio > now() - interval '2 hours' order by e.inicio limit 1;
  select co.nome into resp from public.colaboradores co where co.id = coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  return jsonb_build_object(
    'empresa', coalesce(c.nome_fantasia, c.dados->>'nome'),
    'nome', public.cliente_primeiro_nome(c.id),
    'respondido_em', (select max(enviado_em) from public.onboarding_respostas r where r.cliente_id = c.id),
    'responsavel', resp,
    'reuniao', case when ev.id is null then null else jsonb_build_object('id', ev.id, 'inicio', ev.inicio, 'link', case when ev.link like '#%' then null else ev.link end) end);
end $$;
revoke all on function public.onboarding_contexto(text) from public;
grant execute on function public.onboarding_contexto(text) to anon, authenticated;

create or replace function public.onboarding_responder(t text, r jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; resp uuid; tid uuid; k text; dsc text;
  simnao text[] := array['sim','true','1'];
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then raise exception 'Link inválido.' using errcode = '28000'; end if;
  if r is null or jsonb_typeof(r) <> 'object' then raise exception 'Respostas inválidas.'; end if;
  if length(r::text) > 60000 then raise exception 'Respostas muito longas.'; end if;
  insert into public.onboarding_respostas (cliente_id, respostas) values (c.id, r);

  -- espelho na ficha (só os campos que existem)
  update public.clientes set
    negativado = case when lower(coalesce(r->>'negativado','')) = any(simnao) then true when lower(coalesce(r->>'negativado','')) in ('nao','não','false','0') then false else negativado end,
    usa_maquininha = case when lower(coalesce(r->>'maquininha','')) = any(simnao) then true when lower(coalesce(r->>'maquininha','')) in ('nao','não','false','0') then false else usa_maquininha end,
    tem_consorcio = case when lower(coalesce(r->>'consorcio','')) = any(simnao) then true when lower(coalesce(r->>'consorcio','')) in ('nao','não','false','0') then false else tem_consorcio end,
    possui_processos = case when lower(coalesce(r->>'acao_judicial','')) = any(simnao) then true when lower(coalesce(r->>'acao_judicial','')) in ('nao','não','false','0') then false else possui_processos end,
    outros_cnpjs = coalesce(nullif(r->>'outros_cnpjs_quais',''), outros_cnpjs),
    assuntos_interesse = coalesce(nullif(r->>'assuntos',''), assuntos_interesse),
    disponibilidade = coalesce(nullif(r->>'disponibilidade',''), disponibilidade),
    tipos_dividas = coalesce(nullif(r->>'contratos',''), tipos_dividas),
    situacao_atual = coalesce(nullif(r->>'situacao',''), situacao_atual),
    observacoes_onboarding = concat_ws(E'\n', nullif(r->>'extra',''), case when nullif(r->>'garantia','') is not null then 'Garantias: ' || (r->>'garantia') end, case when nullif(r->>'ativos_onus','') is not null then 'Ativos com ônus: ' || (r->>'ativos_onus') end),
    formulario_em = now(),
    etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 3)
  where id = c.id;

  -- bens declarados
  for k, dsc in select * from (values ('veiculo', r->>'veiculos'), ('imovel', r->>'imoveis'), ('maquinario', r->>'maquinario'), ('outro', r->>'quais_ativos')) v(tipo, descricao) loop
    if nullif(trim(dsc), '') is not null and lower(trim(dsc)) not in ('não','nao','nenhum','nenhuma','-') then
      insert into public.bens (cliente_id, tipo, descricao, observacoes) values (c.id, k, left(dsc, 2000), 'Declarado no formulário de onboarding');
    end if;
  end loop;

  resp := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Onboarding: conferir o formulário de mapeamento — ' || coalesce(c.nome_fantasia, c.dados->>'nome', c.id),
          E'O cliente respondeu o formulário (aba Onboarding da ficha). Confira as respostas, complete a ficha/contratos e documente o que foi prometido na venda.\nO cliente já recebeu o link da agenda para marcar a R1.',
          c.id, resp, 'acompanhamento_pj', current_date + 2, 1) returning id into tid;
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
  values (c.id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'Formulário de mapeamento respondido pelo cliente', false, true, 'onboarding');
  perform public.mensagem_enfileirar(c.id, 'onb_formulario_recebido', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar'), now(), 'onboarding:formulario_recebido');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.onboarding_responder(text, jsonb) from public;
grant execute on function public.onboarding_responder(text, jsonb) to anon, authenticated;

-- ---------- (d) agendamento da R1 ----------
create or replace function public.dia_util(d date) returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from d) between 1 and 5
     and not exists (select 1 from public.feriados f where f.data = d and coalesce(f.ativo, true) and (f.uf is null or f.uf = 'SP') and (f.comarca is null or f.comarca = ''))
$$;
create or replace function public.somar_dias_uteis(d date, n integer) returns date language plpgsql stable security definer set search_path = public as $$
declare x date := d; i int := 0;
begin
  while i < n loop x := x + 1; if public.dia_util(x) then i := i + 1; end if; end loop;
  return x;
end $$;

-- horários livres do responsável: dias úteis, 09–12h e 14–17h (blocos de 1h), a partir de 2 dias úteis após o formulário/hoje, 15 dias úteis à frente
create or replace function public.onboarding_horarios(t text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; colab uuid; d0 date; d date; h int; ini_ timestamptz; fim_ timestamptz; out jsonb := '[]'::jsonb; n int := 0;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then return null; end if;
  colab := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  d0 := public.somar_dias_uteis(greatest((now() at time zone 'America/Sao_Paulo')::date, coalesce((c.formulario_em at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)), 2);
  d := d0;
  while n < 15 loop
    if public.dia_util(d) then
      n := n + 1;
      foreach h in array array[9,10,11,14,15,16] loop
        ini_ := (d::text || ' ' || lpad(h::text, 2, '0') || ':00')::timestamp at time zone 'America/Sao_Paulo';
        fim_ := ini_ + interval '1 hour';
        if ini_ > now() and not exists (select 1 from public.agenda_eventos e where e.colaborador_id = colab and not e.cancelado and (e.dia_inteiro and (e.inicio at time zone 'America/Sao_Paulo')::date = d or (not e.dia_inteiro and e.inicio < fim_ and e.fim > ini_))) then
          out := out || jsonb_build_object('inicio', ini_, 'dia', d, 'hora', lpad(h::text, 2, '0') || ':00');
        end if;
      end loop;
    end if;
    d := d + 1;
  end loop;
  return jsonb_build_object('responsavel', (select nome from public.colaboradores where id = colab), 'horarios', out);
end $$;
revoke all on function public.onboarding_horarios(text) from public;
grant execute on function public.onboarding_horarios(text) to anon, authenticated;

create or replace function public.onboarding_agendar(t text, p_inicio timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; colab uuid; resp_nome text; ev uuid; nome text; livre boolean; dia date; prep date; vars jsonb;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then raise exception 'Link inválido.' using errcode = '28000'; end if;
  select exists (select 1 from jsonb_array_elements(public.onboarding_horarios(t)->'horarios') x where (x->>'inicio')::timestamptz = p_inicio) into livre;
  if not livre then raise exception 'Esse horário não está mais disponível. Escolha outro.' using errcode = 'P0001';end if;
  colab := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  select co.nome into resp_nome from public.colaboradores co where co.id = colab;
  nome := coalesce(c.nome_fantasia, c.dados->>'nome', c.id);
  -- reagendamento: cancela o anterior e os lembretes dele
  update public.agenda_eventos set cancelado = true where cliente_id = c.id and tipo = 'reuniao' and finalidade = 'onboarding' and not cancelado and inicio > now();
  update public.mensagens_fila set status = 'cancelada', resultado = 'Reagendado', atualizado_em = now() where cliente_id = c.id and referencia like 'onboarding:reuniao%' and status = 'pendente';

  insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, cliente_id, tipo, origem, finalidade, descricao, link, cancelado)
  values ('Onboarding (R1): ' || nome, p_inicio, p_inicio + interval '1 hour', false, colab, c.id, 'reuniao', 'painel', 'onboarding',
          E'Reunião de onboarding marcada pelo cliente pela página de agendamento.\nPreencha o campo Link com o link da chamada: ele vai nos lembretes do cliente.', null, false)
  returning id into ev;
  dia := (p_inicio at time zone 'America/Sao_Paulo')::date;
  prep := dia - 1; while not public.dia_util(prep) loop prep := prep - 1; end loop;
  update public.clientes set proxima_reuniao = dia, data_onboarding = coalesce(data_onboarding, dia), etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 5) where id = c.id;
  update public.tarefas set status = 'concluida', concluida_em = now() where cliente_id = c.id and titulo like 'Onboarding: preparar R1%' and status in ('aberta','em_andamento');
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Onboarding: preparar R1 de ' || to_char(dia, 'DD/MM') || ' — ' || nome,
          E'Obrigatório antes da reunião: (1) estratégia e orientações iniciais definidas; (2) slides de apresentação; (3) pauta estruturada.\nColoque o link da chamada no compromisso da Agenda — ele vai automaticamente nos lembretes do cliente (8h30 do dia e 1h antes).',
          c.id, colab, 'acompanhamento_pj', prep, 1);
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
  values (c.id, (now() at time zone 'America/Sao_Paulo')::date, 'reuniao_cliente', 'R1 (onboarding) agendada pelo cliente para ' || to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), true, true, 'onboarding');

  vars := jsonb_build_object('responsavel', split_part(coalesce(resp_nome, 'nossa equipe'), ' ', 1), 'link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar');
  perform public.mensagem_enfileirar(c.id, 'onb_reuniao_confirmada', vars, now(), 'onboarding:reuniao_confirmada', ev);
  perform public.mensagem_enfileirar(c.id, 'onb_lembrete_dia', vars, (dia::text || ' 08:30')::timestamp at time zone 'America/Sao_Paulo', 'onboarding:reuniao_lembrete_dia', ev);
  perform public.mensagem_enfileirar(c.id, 'onb_lembrete_1h', vars, p_inicio - interval '1 hour', 'onboarding:reuniao_lembrete_1h', ev);
  perform public.notificar_colaborador(colab, 'R1 agendada pelo cliente', nome || ' — ' || to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#agenda');
  return jsonb_build_object('ok', true, 'inicio', p_inicio, 'responsavel', resp_nome);
end $$;
revoke all on function public.onboarding_responder(text, jsonb) from public;
revoke all on function public.onboarding_agendar(text, timestamptz) from public;
grant execute on function public.onboarding_agendar(text, timestamptz) to anon, authenticated;

-- lembretes/confirmação acompanham mudança de horário feita pela equipe (painel/Google)
create or replace function public.onboarding_evento_alterado() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.finalidade = 'onboarding' and new.inicio <> old.inicio and not new.cancelado then
    update public.mensagens_fila set enviar_em = case referencia when 'onboarding:reuniao_lembrete_dia' then ((new.inicio at time zone 'America/Sao_Paulo')::date::text || ' 08:30')::timestamp at time zone 'America/Sao_Paulo'
                                                             when 'onboarding:reuniao_lembrete_1h' then new.inicio - interval '1 hour' else enviar_em end, atualizado_em = now()
    where evento_id = new.id and status = 'pendente';
    update public.clientes set proxima_reuniao = (new.inicio at time zone 'America/Sao_Paulo')::date where id = new.cliente_id;
  end if;
  return new;
end $$;
drop trigger if exists onboarding_evento_alterado on public.agenda_eventos;
create trigger onboarding_evento_alterado after update of inicio, cancelado on public.agenda_eventos for each row execute procedure public.onboarding_evento_alterado();

-- ---------- views para a ficha ----------
create or replace view public.v_onboarding_cliente with (security_invoker = true) as
select c.id as cliente_id, c.onboarding_token, c.onboarding_enviado_em, c.formulario_em, c.proxima_reuniao,
       (select r.respostas from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as respostas,
       (select r.conferido_em from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as conferido_em,
       (select jsonb_build_object('id', e.id, 'inicio', e.inicio, 'link', e.link, 'colaborador', co.nome) from public.agenda_eventos e left join public.colaboradores co on co.id = e.colaborador_id
          where e.cliente_id = c.id and e.finalidade = 'onboarding' and not e.cancelado order by e.inicio desc limit 1) as reuniao,
       (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'modelo', m.modelo, 'titulo', mm.titulo, 'enviar_em', m.enviar_em, 'status', m.status, 'resultado', m.resultado, 'enviada_em', m.enviada_em, 'numero', m.numero) order by m.enviar_em desc), '[]'::jsonb)
          from public.mensagens_fila m left join public.mensagens_modelos mm on mm.chave = m.modelo where m.cliente_id = c.id) as mensagens
from public.clientes c;

select 'ok 0052' as resultado;


-- ===== 0053_fila_mensagens_cron.sql =====
-- 0053 — o cron das automações (automacoes-np, a cada minuto) só chama a Edge Function quando há trabalho;
-- passa a considerar também a fila de mensagens para clientes (0052). Idempotente.
create or replace function public.automacoes_ha_trabalho() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.automacao_execucoes e join public.automacoes a on a.id = e.automacao_id
    where (e.status = 'pendente' and e.executar_em <= now()
           and (not a.ativa or not a.so_horario_comercial or public.em_horario_comercial(now())))
       or (e.status = 'processando' and e.atualizado_em < now() - interval '10 minutes')
  ) or exists (
    select 1 from public.mensagens_fila m
    where (m.status = 'pendente' and m.enviar_em <= now() and m.numero is not null and public.em_horario_comercial(now()))
       or (m.status = 'processando' and m.atualizado_em < now() - interval '10 minutes')
  );
$$;
select 'ok 0053' as resultado;


-- ===== 0054_boas_vindas_so_cliente_novo.sql =====
-- 0054 — boas-vindas automáticas só para cliente realmente novo (sem data de fechamento ou fechado nos últimos 30 dias);
-- cadastro de cliente antigo (migração/histórico) não dispara WhatsApp — a equipe pode enviar pelo botão na ficha. Idempotente.
create or replace function public.clientes_boas_vindas_auto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.ativo, true) and (new.data_fechamento is null or new.data_fechamento >= current_date - 30) then
    perform public.onboarding_enviar_boas_vindas(new.id);
  end if;
  return new;
end $$;
select 'ok 0054' as resultado;


-- ===== 0055_asaas_financeiro.sql =====
-- 0055 — Financeiro com Asaas: cobranças (entrada, parcelas, êxito) espelhadas do Asaas, criadas pelo sistema, baixa automática
-- por webhook, inadimplência na ficha do cliente e régua de cobrança por WhatsApp (fila de 0052). Segredos no Vault:
-- ASAAS_API_KEY (chave da API), ASAAS_WEBHOOK_TOKEN (token que o Asaas manda no cabeçalho asaas-access-token), ASAAS_AMBIENTE (producao|sandbox).
-- Idempotente. Depende de 0052 (mensagens_fila/modelos), 0051 (helpers), 0044 (perfis.acessos), 0047 (segredo_definir).

-- ---------- segredos: aceitar ASAAS_* ----------
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|ASAAS_[A-Z_]+|ZAPSIGN_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|ASAAS_[A-Z_]+|ZAPSIGN_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;

-- ---------- permissão ----------
create or replace function public.pode_financeiro() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.papel = 'admin' or 'financeiro' = any(coalesce(p.acessos, '{}')) from public.perfis p where p.id = auth.uid()), false)
$$;
grant execute on function public.pode_financeiro() to authenticated;

-- ---------- configuração ----------
insert into public.escritorio (id, dados) values ('financeiro', '{"regua_whatsapp": false, "importar_desde_meses": 12}'::jsonb) on conflict (id) do nothing;
drop policy if exists "escritorio: financeiro edita" on public.escritorio;
create policy "escritorio: financeiro edita" on public.escritorio for update to authenticated using (id = 'financeiro' and public.pode_financeiro()) with check (id = 'financeiro' and public.pode_financeiro());

-- ---------- tabelas ----------
create table if not exists public.asaas_clientes (
  cliente_id text primary key references public.clientes(id) on delete cascade,
  asaas_id text not null unique,
  cpf_cnpj text, nome text, email text, telefone text,
  atualizado_em timestamptz not null default now()
);
alter table public.asaas_clientes enable row level security;
drop policy if exists "asaas_clientes: financeiro le" on public.asaas_clientes;
create policy "asaas_clientes: financeiro le" on public.asaas_clientes for select to authenticated using (public.pode_financeiro());

create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  asaas_id text unique,
  cliente_id text references public.clientes(id) on delete set null,
  contrato_id text references public.contratos(id) on delete set null,
  acordo_id uuid references public.acordos(id) on delete set null,
  tipo text not null default 'outro' check (tipo in ('entrada','parcela','exito','mensalidade','outro')),
  descricao text,
  valor numeric not null default 0,
  valor_liquido numeric,
  valor_pago numeric,
  vencimento date,
  vencimento_original date,
  pago_em date,
  status text not null default 'pendente' check (status in ('pendente','paga','atrasada','estornada','cancelada','outra')),
  status_asaas text,
  forma text,                        -- BOLETO | PIX | CREDIT_CARD | UNDEFINED
  parcela integer, total_parcelas integer, parcelamento_id text,
  link_fatura text, link_boleto text, pix_copia_cola text,
  asaas_cliente_id text,
  origem text not null default 'asaas' check (origem in ('asaas','painel')),
  regua_enviadas text[] not null default '{}',
  regua_parada boolean not null default false,
  observacoes text,
  dados jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  created_by uuid
);
create index if not exists cobrancas_cliente_idx on public.cobrancas (cliente_id, vencimento desc);
create index if not exists cobrancas_status_idx on public.cobrancas (status, vencimento);
alter table public.cobrancas enable row level security;
drop policy if exists "cobrancas: financeiro le" on public.cobrancas;
create policy "cobrancas: financeiro le" on public.cobrancas for select to authenticated using (public.pode_financeiro() or (public.sou_equipe() and cliente_id is not null));
drop policy if exists "cobrancas: financeiro edita" on public.cobrancas;
create policy "cobrancas: financeiro edita" on public.cobrancas for update to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());

create table if not exists public.asaas_eventos (
  id bigserial primary key,
  evento text, asaas_id text, payload jsonb, recebido_em timestamptz not null default now(), processado boolean not null default false, erro text
);
alter table public.asaas_eventos enable row level security;
drop policy if exists "asaas_eventos: financeiro le" on public.asaas_eventos;
create policy "asaas_eventos: financeiro le" on public.asaas_eventos for select to authenticated using (public.pode_financeiro());

create table if not exists public.asaas_sincronizacoes (
  id bigserial primary key, inicio timestamptz not null default now(), fim timestamptz, ok boolean, clientes integer, cobrancas integer, erro text, por uuid
);
alter table public.asaas_sincronizacoes enable row level security;
drop policy if exists "asaas_sinc: financeiro le" on public.asaas_sincronizacoes;
create policy "asaas_sinc: financeiro le" on public.asaas_sincronizacoes for select to authenticated using (public.pode_financeiro());

-- ---------- helpers ----------
create or replace function public.so_digitos(t text) returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(t,''), '\D', '', 'g'), '') $$;

create or replace function public.asaas_status_interno(s text, deletado boolean) returns text language sql immutable as $$
  select case when coalesce(deletado,false) then 'cancelada'
              when s in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH','DUNNING_RECEIVED') then 'paga'
              when s = 'PENDING' then 'pendente'
              when s = 'OVERDUE' then 'atrasada'
              when s in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL') then 'estornada'
              else 'outra' end
$$;

-- tipo pela descrição/externalReference (quando a cobrança vem do Asaas)
create or replace function public.cobranca_tipo_por_texto(t text) returns text language sql immutable as $$
  select case when t ~* 'êxito|exito' then 'exito'
              when t ~* 'entrada|sinal' then 'entrada'
              when t ~* 'parcela' then 'parcela'
              when t ~* 'mensal' then 'mensalidade'
              else 'outro' end
$$;

-- cliente do sistema para um customer do Asaas: vínculo gravado → externalReference → CPF/CNPJ
create or replace function public.asaas_cliente_do_sistema(p_asaas_cliente text, p_cpf_cnpj text, p_external text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cliente_id from public.asaas_clientes where asaas_id = p_asaas_cliente),
    (select id from public.clientes where id = p_external),
    (select c.id from public.clientes c where public.so_digitos(p_cpf_cnpj) is not null
       and (public.so_digitos(c.cnpj) = public.so_digitos(p_cpf_cnpj) or public.so_digitos(c.cpf_titular) = public.so_digitos(p_cpf_cnpj) or public.so_digitos(c.dados->>'cnpj') = public.so_digitos(p_cpf_cnpj) or public.so_digitos(c.dados->>'cpf') = public.so_digitos(p_cpf_cnpj))
       order by coalesce(c.ativo, true) desc limit 1))
$$;

-- grava/atualiza uma cobrança a partir do objeto "payment" do Asaas
create or replace function public.asaas_upsert_cobranca(p jsonb, p_cpf_cnpj text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid text; id_ uuid; st text; tipo_ text; ext text := p->>'externalReference';
begin
  if p->>'id' is null then return null; end if;
  cid := public.asaas_cliente_do_sistema(p->>'customer', p_cpf_cnpj, split_part(coalesce(ext,''), '|', 1));
  st := public.asaas_status_interno(p->>'status', (p->>'deleted')::boolean);
  tipo_ := coalesce(nullif(split_part(coalesce(ext,''), '|', 2), ''), public.cobranca_tipo_por_texto(coalesce(p->>'description','')));
  if tipo_ not in ('entrada','parcela','exito','mensalidade','outro') then tipo_ := 'outro'; end if;
  insert into public.cobrancas (asaas_id, cliente_id, tipo, descricao, valor, valor_liquido, valor_pago, vencimento, vencimento_original, pago_em, status, status_asaas, forma,
                                parcela, total_parcelas, parcelamento_id, link_fatura, link_boleto, asaas_cliente_id, origem, dados, atualizado_em)
  values (p->>'id', cid, tipo_, p->>'description', coalesce((p->>'value')::numeric, 0), (p->>'netValue')::numeric,
          case when st = 'paga' then coalesce((p->>'value')::numeric, 0) end,
          (p->>'dueDate')::date, coalesce((p->>'originalDueDate')::date, (p->>'dueDate')::date),
          coalesce((p->>'clientPaymentDate')::date, (p->>'paymentDate')::date, (p->>'confirmedDate')::date),
          st, p->>'status', p->>'billingType', (p->>'installmentNumber')::int, null, p->>'installment', p->>'invoiceUrl', p->>'bankSlipUrl', p->>'customer', 'asaas', p, now())
  on conflict (asaas_id) do update set
    cliente_id = coalesce(cobrancas.cliente_id, excluded.cliente_id),
    tipo = case when cobrancas.origem = 'painel' then cobrancas.tipo else excluded.tipo end,
    descricao = coalesce(excluded.descricao, cobrancas.descricao), valor = excluded.valor, valor_liquido = excluded.valor_liquido,
    valor_pago = excluded.valor_pago, vencimento = excluded.vencimento, vencimento_original = excluded.vencimento_original, pago_em = excluded.pago_em,
    status = excluded.status, status_asaas = excluded.status_asaas, forma = excluded.forma, parcela = coalesce(excluded.parcela, cobrancas.parcela),
    parcelamento_id = coalesce(excluded.parcelamento_id, cobrancas.parcelamento_id), link_fatura = coalesce(excluded.link_fatura, cobrancas.link_fatura),
    link_boleto = coalesce(excluded.link_boleto, cobrancas.link_boleto), asaas_cliente_id = excluded.asaas_cliente_id, dados = excluded.dados, atualizado_em = now()
  returning id into id_;
  return id_;
end $$;
revoke all on function public.asaas_upsert_cobranca(jsonb, text) from public, anon, authenticated;

-- lote da sincronização (Edge): clientes do Asaas + cobranças
create or replace function public.asaas_sincronizar_gravar(token text, clientes jsonb, cobrancas jsonb, p_erro text default null, p_por uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; p jsonb; nc int := 0; np int := 0; cid text; doc text;
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for c in select value from jsonb_array_elements(coalesce(clientes, '[]'::jsonb)) loop
    cid := public.asaas_cliente_do_sistema(c->>'id', c->>'cpfCnpj', c->>'externalReference');
    if cid is not null then
      insert into public.asaas_clientes (cliente_id, asaas_id, cpf_cnpj, nome, email, telefone, atualizado_em)
      values (cid, c->>'id', c->>'cpfCnpj', c->>'name', c->>'email', coalesce(c->>'mobilePhone', c->>'phone'), now())
      on conflict (cliente_id) do update set asaas_id = excluded.asaas_id, cpf_cnpj = excluded.cpf_cnpj, nome = excluded.nome, email = excluded.email, telefone = excluded.telefone, atualizado_em = now();
      nc := nc + 1;
    end if;
  end loop;
  for p in select value from jsonb_array_elements(coalesce(cobrancas, '[]'::jsonb)) loop
    select cl->>'cpfCnpj' into doc from jsonb_array_elements(coalesce(clientes, '[]'::jsonb)) cl where cl->>'id' = p->>'customer' limit 1;
    perform public.asaas_upsert_cobranca(p, doc);
    np := np + 1;
  end loop;
  insert into public.asaas_sincronizacoes (fim, ok, clientes, cobrancas, erro, por) values (now(), p_erro is null, nc, np, p_erro, p_por);
  return jsonb_build_object('clientes', nc, 'cobrancas', np);
end $$;
revoke all on function public.asaas_sincronizar_gravar(text, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.asaas_sincronizar_gravar(text, jsonb, jsonb, text, uuid) to service_role;

-- webhook (Edge já validou o token do cabeçalho)
create or replace function public.asaas_webhook_gravar(corpo jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare id_ uuid; ev text := corpo->>'event'; p jsonb := corpo->'payment';
begin
  if coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' <> 'service_role' then raise exception 'Acesso negado.' using errcode = '28000'; end if;
  insert into public.asaas_eventos (evento, asaas_id, payload) values (ev, p->>'id', corpo);
  if p is not null and ev like 'PAYMENT_%' then
    id_ := public.asaas_upsert_cobranca(p);
    update public.asaas_eventos set processado = true where id = currval('public.asaas_eventos_id_seq');
  end if;
  return jsonb_build_object('ok', true, 'cobranca', id_);
end $$;
revoke all on function public.asaas_webhook_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.asaas_webhook_gravar(jsonb) to service_role;

-- dados para criar o cliente/cobrança no Asaas (Edge, com a sessão do usuário)
create or replace function public.asaas_dados_cliente(p_cliente text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; a public.asaas_clientes;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  select * into c from public.clientes where id = p_cliente;
  if c.id is null then return null; end if;
  select * into a from public.asaas_clientes where cliente_id = p_cliente;
  return jsonb_build_object('cliente_id', c.id, 'asaas_id', a.asaas_id,
    'nome', coalesce(c.dados->>'razaoSocial', c.dados->>'nome', c.nome_fantasia),
    'cpf_cnpj', coalesce(public.so_digitos(c.cnpj), public.so_digitos(c.dados->>'cnpj'), public.so_digitos(c.cpf_titular), public.so_digitos(c.dados->>'cpf')),
    'email', coalesce(c.dados->>'email', (select ct.email from public.contatos ct where ct.cliente_id = c.id and nullif(ct.email,'') is not null order by ct.principal desc nulls last limit 1)),
    'telefone', public.cliente_whatsapp(c.id));
end $$;
grant execute on function public.asaas_dados_cliente(text) to authenticated;

create or replace function public.asaas_cliente_gravar(p_cliente text, p_asaas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  insert into public.asaas_clientes (cliente_id, asaas_id, cpf_cnpj, nome, email, telefone)
  values (p_cliente, p_asaas->>'id', p_asaas->>'cpfCnpj', p_asaas->>'name', p_asaas->>'email', coalesce(p_asaas->>'mobilePhone', p_asaas->>'phone'))
  on conflict (cliente_id) do update set asaas_id = excluded.asaas_id, cpf_cnpj = excluded.cpf_cnpj, nome = excluded.nome, email = excluded.email, telefone = excluded.telefone, atualizado_em = now();
end $$;
grant execute on function public.asaas_cliente_gravar(text, jsonb) to authenticated;

-- cobrança criada pelo painel: grava o retorno do Asaas já com cliente/tipo/contrato
create or replace function public.asaas_cobranca_gravar(p_cliente text, p_tipo text, p_contrato text, p_acordo uuid, p_pagamentos jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare p jsonb; n int := 0; id_ uuid; tot int;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  tot := jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb));
  for p in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) loop
    id_ := public.asaas_upsert_cobranca(p);
    update public.cobrancas set cliente_id = p_cliente, tipo = p_tipo, contrato_id = p_contrato, acordo_id = p_acordo, origem = 'painel', created_by = auth.uid(),
      total_parcelas = case when tot > 1 then tot else total_parcelas end where id = id_;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.asaas_cobranca_gravar(text, text, text, uuid, jsonb) to authenticated;

-- ---------- efeitos: timeline, adimplência, régua ----------
create or replace function public.cobrancas_efeitos() returns trigger language plpgsql security definer set search_path = public as $$
declare nome text; em_atraso boolean;
begin
  if new.cliente_id is null then return new; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.cliente_id is distinct from old.cliente_id then
    if new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then
      insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte, id_externo)
      select new.cliente_id, coalesce(new.pago_em, current_date), 'outro', 'Pagamento recebido: ' || coalesce(new.descricao, initcap(new.tipo)) || ' — ' || public.brl(coalesce(new.valor_pago, new.valor)), true, true, 'asaas', 'cob:' || new.id::text
      where not exists (select 1 from public.entradas_timeline t where t.id_externo = 'cob:' || new.id::text);
      update public.mensagens_fila set status = 'cancelada', resultado = 'Pagamento recebido', atualizado_em = now() where referencia = 'cobranca:' || new.id::text and status = 'pendente';
      update public.tarefas set status = 'concluida', concluida_em = now() where titulo like 'Cobrança manual%' and descricao like '%' || new.id::text || '%' and status in ('aberta','em_andamento');
    end if;
    if new.status in ('cancelada','estornada') then
      update public.mensagens_fila set status = 'cancelada', resultado = 'Cobrança ' || new.status, atualizado_em = now() where referencia = 'cobranca:' || new.id::text and status = 'pendente';
    end if;
    -- adimplência do cliente: sem cobrança atrasada
    select exists (select 1 from public.cobrancas x where x.cliente_id = new.cliente_id and x.status = 'atrasada' and x.id <> new.id) or new.status = 'atrasada' into em_atraso;
    update public.clientes set adimplente = not em_atraso where id = new.cliente_id and adimplente is distinct from (not em_atraso);
  end if;
  return new;
end $$;
drop trigger if exists cobrancas_efeitos on public.cobrancas;
create trigger cobrancas_efeitos after insert or update of status, cliente_id on public.cobrancas for each row execute procedure public.cobrancas_efeitos();

-- modelos da régua
insert into public.mensagens_modelos (chave, titulo, texto, variaveis) values
('cob_lembrete_3d', 'Cobrança — 3 dias antes', E'Olá, {nome}! Passando para lembrar: a {descricao} de {valor} vence em {vencimento}.\n{link}\nQualquer dúvida, é só responder por aqui. 🙂', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_vencimento', 'Cobrança — no dia', E'Olá, {nome}! A {descricao} de {valor} vence hoje ({vencimento}).\n{link}\nSe já pagou, desconsidere esta mensagem.', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_atraso_1', 'Cobrança — 1 dia de atraso', E'Olá, {nome}. Não identificamos o pagamento da {descricao} de {valor}, vencida em {vencimento}.\n{link}\nSe precisar de uma nova data ou já tiver pago, nos avise por aqui.', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_atraso_5', 'Cobrança — 5 dias de atraso', E'Olá, {nome}. A {descricao} de {valor} está em aberto desde {vencimento}.\n{link}\nPodemos conversar sobre a melhor forma de regularizar? É só responder esta mensagem.', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_atraso_10', 'Cobrança — 10 dias de atraso', E'Olá, {nome}. A {descricao} de {valor} (vencimento {vencimento}) segue em aberto.\n{link}\nNossa equipe financeira vai entrar em contato para alinhar a regularização.', '{nome} {descricao} {valor} {vencimento} {link}')
on conflict (chave) do nothing;

create or replace function public.cobrancas_regua() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; n int := 0; passo text; dias int; vars jsonb; resp uuid;
begin
  if not coalesce((select (dados->>'regua_whatsapp')::boolean from public.escritorio where id = 'financeiro'), false) then return 0; end if;
  for r in
    select c.*, coalesce(cl.nome_fantasia, cl.dados->>'nome') as cliente_nome
    from public.cobrancas c join public.clientes cl on cl.id = c.cliente_id
    where c.status in ('pendente','atrasada') and not c.regua_parada and c.vencimento is not null and coalesce(cl.status,'ativo') = 'ativo'
      and c.vencimento between hoje - 10 and hoje + 3
    order by c.vencimento
  loop
    dias := hoje - r.vencimento;   -- negativo = antes do vencimento
    passo := case dias when -3 then 'cob_lembrete_3d' when 0 then 'cob_vencimento' when 1 then 'cob_atraso_1' when 5 then 'cob_atraso_5' when 10 then 'cob_atraso_10' else null end;
    continue when passo is null or passo = any(r.regua_enviadas);
    -- uma mensagem de cobrança por cliente por dia
    continue when exists (select 1 from public.mensagens_fila m where m.cliente_id = r.cliente_id and m.referencia like 'cobranca:%' and (m.enviar_em at time zone 'America/Sao_Paulo')::date = hoje and m.status <> 'cancelada');
    vars := jsonb_build_object('descricao', coalesce(nullif(r.descricao,''), case r.tipo when 'entrada' then 'entrada dos honorários' when 'parcela' then 'parcela ' || coalesce(r.parcela::text,'') when 'exito' then 'cobrança de êxito' when 'mensalidade' then 'mensalidade' else 'cobrança' end),
                               'valor', public.brl(r.valor), 'vencimento', to_char(r.vencimento, 'DD/MM'),
                               'link', coalesce('Boleto/Pix: ' || coalesce(r.link_fatura, r.link_boleto), ''));
    perform public.mensagem_enfileirar(r.cliente_id, passo, vars, now(), 'cobranca:' || r.id::text);
    update public.cobrancas set regua_enviadas = regua_enviadas || passo, regua_parada = (passo = 'cob_atraso_10') where id = r.id;
    if passo = 'cob_atraso_10' then
      resp := public.responsavel_padrao('administrativo');
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Cobrança manual: ' || r.cliente_nome || ' — ' || public.brl(r.valor), 'Cobrança ' || coalesce(r.descricao, r.tipo) || ' vencida em ' || to_char(r.vencimento,'DD/MM/YYYY') || ' sem pagamento após a régua automática (3 dias antes, no dia, +1, +5, +10). Entre em contato e registre o combinado. Ref. ' || r.id::text,
              r.cliente_id, resp, 'administrativo', hoje + 1, 1);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cobrancas_regua() from public, anon, authenticated;

create or replace function public.configurar_regua_cobranca(hora_brt integer default 9) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cobrancas-regua-np';
  perform cron.schedule('cobrancas-regua-np', format('10 %s * * 1-6', (hora_brt + 3) % 24), 'select public.cobrancas_regua()');
  return 'Régua de cobrança diária às ' || hora_brt || 'h10 (seg–sáb)';
end $$;
revoke all on function public.configurar_regua_cobranca(integer) from public, anon, authenticated;

-- sincronização diária com o Asaas (rede de segurança do webhook): 05:50 BRT, via Edge /asaas com o token das automações
create or replace function public.configurar_asaas_sincronizacao(hora_brt integer default 5) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes).'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/asaas');
  perform cron.unschedule(jobid) from cron.job where jobname = 'asaas-sinc-np';
  perform cron.schedule('asaas-sinc-np', format('50 %s * * *', (hora_brt + 3) % 24), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{"dias": 60}'::jsonb, timeout_milliseconds := 120000)$cmd$, endpoint, auth));
  return 'Sincronização diária do Asaas às ' || hora_brt || 'h50 em ' || endpoint;
end $$;
revoke all on function public.configurar_asaas_sincronizacao(integer) from public, anon, authenticated;

-- vínculo manual (cobrança do Asaas sem cliente): aplica ao customer inteiro
create or replace function public.asaas_vincular_manual(p_cliente text, p_asaas_cliente text, p_cobranca uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  if p_asaas_cliente is not null then
    insert into public.asaas_clientes (cliente_id, asaas_id) values (p_cliente, p_asaas_cliente)
    on conflict (cliente_id) do update set asaas_id = excluded.asaas_id, atualizado_em = now();
    update public.cobrancas set cliente_id = p_cliente where asaas_cliente_id = p_asaas_cliente and cliente_id is null;
  end if;
  update public.cobrancas set cliente_id = p_cliente where id = p_cobranca and cliente_id is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.asaas_vincular_manual(text, text, uuid) to authenticated;

-- ---------- views ----------
create or replace view public.v_cobrancas with (security_invoker = true) as
select c.*, coalesce(cl.nome_fantasia, cl.dados->>'nome') as cliente_nome, cl.status as cliente_status,
       case when c.status = 'atrasada' then (now() at time zone 'America/Sao_Paulo')::date - c.vencimento else null end as dias_atraso
from public.cobrancas c left join public.clientes cl on cl.id = c.cliente_id;

create or replace view public.v_financeiro_mes with (security_invoker = true) as
select to_char(coalesce(c.pago_em, c.vencimento), 'YYYY-MM') as mes,
       sum(c.valor) filter (where c.status in ('pendente','atrasada','paga')) as previsto,
       sum(coalesce(c.valor_pago, c.valor)) filter (where c.status = 'paga') as recebido,
       sum(c.valor) filter (where c.status = 'atrasada') as atrasado,
       count(*) filter (where c.status = 'paga') as n_pagas, count(*) filter (where c.status = 'atrasada') as n_atrasadas, count(*) filter (where c.status = 'pendente') as n_pendentes
from public.cobrancas c where c.status in ('pendente','atrasada','paga')
group by 1;

select public.configurar_regua_cobranca(9) as regua, public.configurar_asaas_sincronizacao(5) as sincronizacao;


-- ===== 0056_acessos_por_area.sql =====
-- 0056 — Acesso por área para cada usuário (perfis.acessos): clientes, juridico, comercial, marketing, financeiro, equipe, growth.
-- Admin vê tudo. Colaborador vê só as áreas marcadas em Usuários. O menu/rotas respeitam no painel; no banco, as áreas
-- comercial, marketing, equipe (horas dos outros) e financeiro/growth (já existiam) são bloqueadas por RLS.
-- Clientes/jurídico continuam legíveis no banco para qualquer colaborador (muitas telas cruzam esses dados) — só o menu esconde.
-- Idempotente. Depende de 0044 (perfis.acessos), 0055 (pode_financeiro).

-- quem já é colaborador/admin mantém o que via hoje (todas as áreas de operação); growth/financeiro só quem já tinha
update public.perfis set acessos = (
  select array_agg(distinct a) from unnest(coalesce(acessos, '{}') || array['clientes','juridico','comercial','marketing','equipe']) a)
where papel in ('colaborador','admin');

create or replace function public.tem_acesso(area text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.papel = 'admin' or (p.papel = 'colaborador' and area = any(coalesce(p.acessos, '{}'))) from public.perfis p where p.id = auth.uid()), false)
$$;
grant execute on function public.tem_acesso(text) to authenticated;

-- pode_growth / pode_financeiro passam pelo mesmo mecanismo
create or replace function public.pode_growth() returns boolean language sql stable security definer set search_path = public as $$ select public.tem_acesso('growth') $$;
create or replace function public.pode_financeiro() returns boolean language sql stable security definer set search_path = public as $$ select public.tem_acesso('financeiro') $$;

-- meus acessos (para o painel montar o menu)
create or replace function public.meus_acessos() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('papel', p.papel, 'acessos', to_jsonb(coalesce(p.acessos, '{}'::text[]))) from public.perfis p where p.id = auth.uid()
$$;
grant execute on function public.meus_acessos() to authenticated;

-- ---------- comercial (CRM) ----------
drop policy if exists "leads: ver" on public.leads; create policy "leads: ver" on public.leads for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "leads: criar" on public.leads; create policy "leads: criar" on public.leads for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "leads: editar" on public.leads; create policy "leads: editar" on public.leads for update to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tarefas: equipe" on public.lead_tarefas; create policy "lead_tarefas: equipe" on public.lead_tarefas for all to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tags: ver" on public.lead_tags; create policy "lead_tags: ver" on public.lead_tags for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tags: criar" on public.lead_tags; create policy "lead_tags: criar" on public.lead_tags for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tags: remover" on public.lead_tags; create policy "lead_tags: remover" on public.lead_tags for delete to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "observacoes: ver" on public.observacoes; create policy "observacoes: ver" on public.observacoes for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "observacoes: criar" on public.observacoes; create policy "observacoes: criar" on public.observacoes for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial') and autor_id = auth.uid());
drop policy if exists "historico: ver" on public.historico_fases; create policy "historico: ver" on public.historico_fases for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "leads_auditoria: ver" on public.leads_auditoria; create policy "leads_auditoria: ver" on public.leads_auditoria for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "mc_sel" on public.metas_comerciais; create policy "mc_sel" on public.metas_comerciais for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "cs_equipe" on public.comercial_semanas; create policy "cs_equipe" on public.comercial_semanas for all to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "automacoes: ver" on public.automacoes; create policy "automacoes: ver" on public.automacoes for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "automacoes: criar" on public.automacoes; create policy "automacoes: criar" on public.automacoes for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "automacoes: editar" on public.automacoes; create policy "automacoes: editar" on public.automacoes for update to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "execucoes: ver" on public.automacao_execucoes; create policy "execucoes: ver" on public.automacao_execucoes for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: ver" on public.dialogos_chatguru; create policy "dialogos: ver" on public.dialogos_chatguru for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: criar" on public.dialogos_chatguru; create policy "dialogos: criar" on public.dialogos_chatguru for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: editar" on public.dialogos_chatguru; create policy "dialogos: editar" on public.dialogos_chatguru for update to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: excluir" on public.dialogos_chatguru; create policy "dialogos: excluir" on public.dialogos_chatguru for delete to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));

-- ---------- marketing ----------
drop policy if exists "pautas_sel" on public.pautas; create policy "pautas_sel" on public.pautas for select to authenticated using (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pautas_ins" on public.pautas; create policy "pautas_ins" on public.pautas for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pautas_upd" on public.pautas; create policy "pautas_upd" on public.pautas for update to authenticated using (public.sou_equipe() and public.tem_acesso('marketing')) with check (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pcom_sel" on public.pautas_comentarios; create policy "pcom_sel" on public.pautas_comentarios for select to authenticated using (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pcom_ins" on public.pautas_comentarios; create policy "pcom_ins" on public.pautas_comentarios for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('marketing') and (autor_id is null or autor_id = auth.uid()));
drop policy if exists "mkp_equipe" on public.marketing_pedidos; create policy "mkp_equipe" on public.marketing_pedidos for all to authenticated using (public.sou_equipe() and public.tem_acesso('marketing')) with check (public.sou_equipe() and public.tem_acesso('marketing'));

-- ---------- equipe: horas dos outros só com a área; as próprias sempre ----------
drop policy if exists "apont_sel" on public.apontamentos_horas; create policy "apont_sel" on public.apontamentos_horas for select to authenticated using (public.sou_equipe() and (public.tem_acesso('equipe') or colaborador_id = public.meu_colaborador()));

select 'ok 0056' as resultado;


-- ===== 0057_financeiro_gestao.sql =====
-- 0057 — Financeiro na Gestão → Visão geral (resumo + previsão 90 dias + inadimplentes) e no resumo diário (admins / área financeiro).
-- Idempotente. Depende de 0055 (cobrancas), 0056 (tem_acesso), 0050 (resumo_diario_texto).

create or replace function public.financeiro_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; m1 date := date_trunc('month', hoje)::date; r jsonb;
begin
  if not public.pode_financeiro() then return null; end if;
  select jsonb_build_object(
    'recebido_mes', coalesce((select sum(coalesce(valor_pago, valor)) from public.cobrancas where status = 'paga' and pago_em >= m1 and pago_em < m1 + interval '1 month'), 0),
    'recebido_mes_ant', coalesce((select sum(coalesce(valor_pago, valor)) from public.cobrancas where status = 'paga' and pago_em >= m1 - interval '1 month' and pago_em < m1), 0),
    'a_vencer_mes', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje and vencimento < m1 + interval '1 month'), 0),
    'atrasado', coalesce((select sum(valor) from public.cobrancas where status = 'atrasada'), 0),
    'atrasado_n', (select count(*) from public.cobrancas where status = 'atrasada'),
    'atrasado_clientes', (select count(distinct coalesce(cliente_id, asaas_cliente_id)) from public.cobrancas where status = 'atrasada'),
    'previsao_30', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje and vencimento < hoje + 30), 0),
    'previsao_60', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje + 30 and vencimento < hoje + 60), 0),
    'previsao_90', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje + 60 and vencimento < hoje + 90), 0),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'recebido', coalesce(recebido,0), 'previsto', coalesce(previsto,0), 'atrasado', coalesce(atrasado,0)) order by mes), '[]'::jsonb)
              from public.v_financeiro_mes where mes >= to_char(m1 - interval '5 months', 'YYYY-MM') and mes <= to_char(m1 + interval '3 months', 'YYYY-MM')),
    'inadimplentes', (select coalesce(jsonb_agg(x order by x->>'valor' desc), '[]'::jsonb) from (
        select jsonb_build_object('cliente_id', c.cliente_id, 'nome', coalesce(cl.nome_fantasia, cl.dados->>'nome', (select nome from public.asaas_clientes a where a.asaas_id = c.asaas_cliente_id), c.asaas_cliente_id),
                                  'valor', sum(c.valor), 'n', count(*), 'dias', max(hoje - c.vencimento), 'no_sistema', c.cliente_id is not null) x
        from public.cobrancas c left join public.clientes cl on cl.id = c.cliente_id
        where c.status = 'atrasada' group by c.cliente_id, c.asaas_cliente_id, cl.nome_fantasia, cl.dados->>'nome' order by sum(c.valor) desc limit 12) s)
  ) into r;
  return r;
end $$;
grant execute on function public.financeiro_resumo() to authenticated;

-- resumo diário: bloco financeiro para admins / quem tem a área
create or replace function public.resumo_financeiro_texto(p_colab uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare perfil uuid; ok boolean; hoje date := (now() at time zone 'America/Sao_Paulo')::date; m1 date := date_trunc('month', hoje)::date;
        rec numeric; venc_hoje numeric; n_hoje int; atr numeric; n_atr int; novos_atr int; pagos_ontem numeric; n_ontem int; t text := '';
begin
  select c.perfil_id into perfil from public.colaboradores c where c.id = p_colab;
  if perfil is null then return null; end if;
  select p.papel = 'admin' or 'financeiro' = any(coalesce(p.acessos,'{}')) into ok from public.perfis p where p.id = perfil;
  if not coalesce(ok, false) then return null; end if;
  select coalesce(sum(coalesce(valor_pago, valor)),0) into rec from public.cobrancas where status = 'paga' and pago_em >= m1;
  select coalesce(sum(coalesce(valor_pago, valor)),0), count(*) into pagos_ontem, n_ontem from public.cobrancas where status = 'paga' and pago_em = hoje - 1;
  select coalesce(sum(valor),0), count(*) into venc_hoje, n_hoje from public.cobrancas where status = 'pendente' and vencimento = hoje;
  select coalesce(sum(valor),0), count(*) into atr, n_atr from public.cobrancas where status = 'atrasada';
  select count(*) into novos_atr from public.cobrancas where status = 'atrasada' and vencimento = hoje - 1;
  t := E'\n💰 *Financeiro*\n• Recebido no mês: ' || public.brl(rec) || E'\n';
  if n_ontem > 0 then t := t || '• Ontem: ' || n_ontem || ' pagamento(s), ' || public.brl(pagos_ontem) || E'\n'; end if;
  if n_hoje > 0 then t := t || '• Vence hoje: ' || n_hoje || ' cobrança(s), ' || public.brl(venc_hoje) || E'\n'; end if;
  t := t || '• Em atraso: ' || n_atr || ' cobrança(s), ' || public.brl(atr) || case when novos_atr > 0 then ' (' || novos_atr || ' venceu ontem)' else '' end || E'\n';
  return t;
end $$;
revoke all on function public.resumo_financeiro_texto(uuid) from public, anon;

create or replace function public.resumo_diario_texto(p_colab uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; r record; t text := ''; n int; painel text; fin text;
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
begin
  select * into c from public.colaboradores where id = p_colab;
  if c is null then return null; end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PAINEL_URL' limit 1), 'https://nevespaduaadv.github.io/painel') into painel;
  t := '☀️ *Bom dia, ' || split_part(c.nome, ' ', 1) || '!* ' || dias[extract(dow from hoje)::int + 1] || ', ' || to_char(hoje, 'DD/MM') || E'\n';

  select count(*) into n from public.agenda_eventos e where e.colaborador_id = p_colab and not e.cancelado and (e.inicio at time zone 'America/Sao_Paulo')::date = hoje;
  if n > 0 then
    t := t || E'\n📆 *Agenda de hoje (' || n || ')*' || E'\n';
    for r in select * from public.agenda_eventos e where e.colaborador_id = p_colab and not e.cancelado and (e.inicio at time zone 'America/Sao_Paulo')::date = hoje order by e.dia_inteiro desc, e.inicio limit 10 loop
      t := t || '• ' || case when r.dia_inteiro then 'dia todo' else to_char(r.inicio at time zone 'America/Sao_Paulo', 'HH24:MI') end || ' ' || left(r.titulo, 70) || coalesce(' — ' || nullif(r.local,''), '') || E'\n';
    end loop;
    if n > 10 then t := t || '  … e mais ' || (n - 10) || E'\n'; end if;
  end if;

  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada';
  if n > 0 then
    t := t || E'\n🔴 *Atrasado (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada' order by z.prazo limit 8 loop
      t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || ' (' || to_char(r.prazo,'DD/MM') || case when r.prazo_fatal then ', FATAL' else '' end || ')' || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje';
  t := t || E'\n📌 *Vence hoje (' || n || ')*' || E'\n';
  if n = 0 then t := t || '• nada para hoje' || E'\n'; end if;
  for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje' order by z.prazo_fatal desc, z.descricao limit 10 loop
    t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️ FATAL' else '' end || E'\n';
  end loop;

  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7';
  if n > 0 then
    t := t || E'\n📅 *Próximos 7 dias (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7' order by z.prazo, z.prazo_fatal desc limit 8 loop
      t := t || '• ' || to_char(r.prazo,'DD/MM') || ' ' || left(r.descricao, 60) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️' else '' end || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  if c.perfil_id is not null then
    select count(*) into n from public.lead_tarefas lt where lt.responsavel_id = c.perfil_id and lt.concluida_em is null and (lt.quando at time zone 'America/Sao_Paulo')::date <= hoje;
    if n > 0 then t := t || E'\n📞 *Leads: ' || n || ' tarefa(s) para hoje ou atrasada(s)*' || E'\n'; end if;
    select count(*) into n from public.notificacoes x where x.perfil_id = c.perfil_id and x.lida_em is null;
    if n > 0 then t := t || E'\n🔔 ' || n || ' notificação(ões) não lida(s) no painel' || E'\n'; end if;
  end if;

  fin := public.resumo_financeiro_texto(p_colab);
  if fin is not null then t := t || fin; end if;

  t := t || E'\n' || painel || '/#painel';
  return t;
end $$;

select 'ok 0057' as resultado;


-- ===== 0058_perfis_previstos.sql =====
-- 0058 — Pré-cadastro de acessos: quando um usuário é criado no Supabase Auth com um e-mail listado aqui, o perfil já nasce
-- com papel, nome e áreas certos (sem passar por "pendente"). Também vincula o colaborador (colaboradores.perfil_id) pelo e-mail/nome.
-- Idempotente. Depende de 0001 (criar_perfil), 0056 (acessos por área).
create table if not exists public.perfis_previstos (
  email text primary key,
  nome text,
  papel text not null default 'colaborador' check (papel in ('admin','colaborador','cliente','robo')),
  acessos text[] not null default '{}',
  colaborador_id uuid references public.colaboradores(id) on delete set null,
  aplicado_em timestamptz
);
alter table public.perfis_previstos enable row level security;
drop policy if exists "previstos: admin" on public.perfis_previstos;
create policy "previstos: admin" on public.perfis_previstos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare pv public.perfis_previstos; colab uuid;
begin
  select * into pv from public.perfis_previstos where lower(email) = lower(new.email);
  insert into public.perfis (id, email, nome, papel, acessos)
  values (new.id, new.email, coalesce(pv.nome, new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          case when pv.email is not null then pv.papel
               when not exists (select 1 from public.perfis where papel='admin') then 'admin' else 'pendente' end,
          coalesce(pv.acessos, '{}'))
  on conflict (id) do nothing;
  if pv.email is not null then
    colab := coalesce(pv.colaborador_id, (select id from public.colaboradores c where lower(c.email) = lower(new.email) limit 1));
    if colab is not null then update public.colaboradores set perfil_id = new.id where id = colab and perfil_id is null; end if;
    update public.perfis_previstos set aplicado_em = now() where email = pv.email;
  end if;
  return new;
end $$;

select 'ok 0058' as resultado;


-- ===== 0059_conhecimento_por_area.sql =====
-- 0059 — Base de conhecimento por área: cada pessoa vê/edita só artigos e documentos da(s) área(s) a que tem acesso; "geral" é de todos.
-- "administrativo" vale para quem tem Financeiro ou Equipe. Admin vê tudo. Idempotente. Depende de 0056 (tem_acesso).
create or replace function public.acesso_area_kb(area text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when coalesce(area,'juridico') = 'geral' then public.sou_equipe()
              when area = 'administrativo' then public.tem_acesso('financeiro') or public.tem_acesso('equipe')
              else public.tem_acesso(coalesce(area,'juridico')) end
$$;
grant execute on function public.acesso_area_kb(text) to authenticated;

drop policy if exists cont_sel on public.conteudos; create policy cont_sel on public.conteudos for select to authenticated using (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists cont_ins on public.conteudos; create policy cont_ins on public.conteudos for insert to authenticated with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists cont_upd on public.conteudos; create policy cont_upd on public.conteudos for update to authenticated using (public.sou_equipe() and public.acesso_area_kb(area)) with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists docb_sel on public.documentos_base; create policy docb_sel on public.documentos_base for select to authenticated using (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists docb_ins on public.documentos_base; create policy docb_ins on public.documentos_base for insert to authenticated with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists docb_upd on public.documentos_base; create policy docb_upd on public.documentos_base for update to authenticated using (public.sou_equipe() and public.acesso_area_kb(area)) with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists contv_sel on public.conteudos_versoes; create policy contv_sel on public.conteudos_versoes for select to authenticated using (public.sou_equipe() and exists (select 1 from public.conteudos c where c.id = conteudos_versoes.conteudo_id));
select 'ok 0059' as resultado;


select 'ok parte 6/9' as resultado;
