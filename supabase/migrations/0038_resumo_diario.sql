-- 0038 — Resumo diário por WhatsApp (ChatGuru): às 8h (dias úteis) cada colaborador recebe o que vence hoje, o que está atrasado
-- e o que vem nos próximos dias. Texto montado no banco; envio pela Edge Function chatguru (rota /resumo), com o mesmo token das automações.
-- Idempotente. Depende de 0006 (colaboradores), 0010 (v_prazos), 0027/0028 (automações, token), 0034 (notificacoes).

alter table public.colaboradores add column if not exists whatsapp text;
alter table public.colaboradores add column if not exists resumo_diario boolean not null default true;

-- v_colaboradores com os campos novos (colunas no fim)
drop view if exists public.v_colaboradores;
create view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.apelido, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id, co.foto_path, co.data_nascimento, co.cidade, co.linkedin, co.bio,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       (select count(*) from public.pdi d where d.colaborador_id = co.id and d.status in ('planejado','em_andamento')) as pdi_abertos,
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

create table if not exists public.resumos_enviados (
  id bigserial primary key,
  colaborador_id uuid references public.colaboradores(id) on delete cascade,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  canal text not null default 'whatsapp',
  ok boolean, erro text, numero text, texto text,
  criado_em timestamptz not null default now()
);
create index if not exists resumos_enviados_idx on public.resumos_enviados (colaborador_id, data);
alter table public.resumos_enviados enable row level security;
drop policy if exists "resumos: equipe le" on public.resumos_enviados;
create policy "resumos: equipe le" on public.resumos_enviados for select to authenticated using (public.sou_equipe());

-- ---------- texto do resumo de um colaborador ----------
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
revoke all on function public.resumo_diario_texto(uuid) from public, anon;
grant execute on function public.resumo_diario_texto(uuid) to authenticated, service_role;

-- meu próprio resumo (botão no painel)
create or replace function public.meu_resumo_diario() returns text
language sql stable security definer set search_path = public as $$
  select public.resumo_diario_texto((select id from public.colaboradores where perfil_id = auth.uid() limit 1));
$$;
grant execute on function public.meu_resumo_diario() to authenticated;

-- ---------- lote para a Edge Function (token das automações) ----------
create or replace function public.resumo_diario_lote(token text, forcar_colab uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('colaborador_id', c.id, 'nome', c.nome, 'whatsapp', c.whatsapp, 'texto', public.resumo_diario_texto(c.id))), '[]'::jsonb) into res
  from public.colaboradores c
  where c.ativo is distinct from false and c.resumo_diario and nullif(c.whatsapp,'') is not null
    and (forcar_colab is null or c.id = forcar_colab)
    and (forcar_colab is not null or not exists (select 1 from public.resumos_enviados e where e.colaborador_id = c.id and e.data = hoje and e.ok));
  return res;
end $$;
revoke all on function public.resumo_diario_lote(text, uuid) from public, anon, authenticated;
grant execute on function public.resumo_diario_lote(text, uuid) to service_role;

create or replace function public.resumo_diario_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  insert into public.resumos_enviados (colaborador_id, ok, erro, numero, texto)
  select (r->>'colaborador_id')::uuid, (r->>'ok')::boolean, r->>'erro', r->>'numero', r->>'texto' from jsonb_array_elements(resultados) r;
end $$;
revoke all on function public.resumo_diario_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.resumo_diario_registrar(text, jsonb) to service_role;

-- ---------- agendamento: 08:00 America/Sao_Paulo, seg–sex (11:00 UTC; o Brasil não tem horário de verão) ----------
create or replace function public.configurar_resumo_diario(hora_brt integer default 8) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes) — o resumo usa o mesmo token.'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/resumo');
  if auth is null or endpoint is null then raise exception 'Não foi possível ler a URL/token das automações.'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'resumo-diario-np';
  perform cron.schedule('resumo-diario-np', format('0 %s * * 1-5', (hora_brt + 3) % 24), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{}'::jsonb, timeout_milliseconds := 60000)$cmd$,
    endpoint, auth));
  return 'Resumo diário agendado para ' || hora_brt || 'h (seg–sex) em ' || endpoint;
end $$;
revoke all on function public.configurar_resumo_diario(integer) from public, anon, authenticated;

select 'ok 0038' as resultado;
