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
