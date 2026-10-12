-- 0047 — Agenda do escritório sincronizada com o Google Calendar de cada colaborador (Workspace, conta de serviço com delegação de domínio).
-- Eventos do painel (criados na tela Agenda ou derivados de tarefas com horário / prazo fatal) vão para o Google; eventos do Google voltam para cá.
-- Idempotente. Depende de 0006 (colaboradores), 0003/0046 (tarefas.hora), 0028 (token das automações), 0042 (chatguru_segredo_definir).

alter table public.colaboradores add column if not exists google_calendar_id text;      -- e-mail da agenda (padrão: e-mail Workspace do colaborador)
alter table public.colaboradores add column if not exists agenda_sync boolean not null default false;
alter table public.colaboradores add column if not exists agenda_sync_token text;        -- syncToken do Google (incremental)
alter table public.colaboradores add column if not exists agenda_sync_em timestamptz;
alter table public.colaboradores add column if not exists agenda_sync_erro text;


-- v_colaboradores com os campos da agenda (colunas no fim)
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
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo,
       co.google_calendar_id, co.agenda_sync, co.agenda_sync_em, co.agenda_sync_erro
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

create table if not exists public.agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  dia_inteiro boolean not null default false,
  colaborador_id uuid references public.colaboradores(id) on delete cascade,
  cliente_id text references public.clientes(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  tarefa_id uuid references public.tarefas(id) on delete cascade,
  tipo text not null default 'compromisso' check (tipo in ('compromisso','audiencia','reuniao','prazo','pericia','outro')),
  local text, descricao text, link text,
  origem text not null default 'painel' check (origem in ('painel','google','tarefa')),
  google_event_id text, google_calendar_id text, google_etag text,
  cancelado boolean not null default false,
  sincronizado_em timestamptz, atualizado_em timestamptz not null default now(),
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists agenda_eventos_inicio_idx on public.agenda_eventos (inicio);
create index if not exists agenda_eventos_colab_idx on public.agenda_eventos (colaborador_id, inicio);
create unique index if not exists agenda_eventos_google_uidx on public.agenda_eventos (google_calendar_id, google_event_id) where google_event_id is not null;
create unique index if not exists agenda_eventos_tarefa_uidx on public.agenda_eventos (tarefa_id) where tarefa_id is not null;
alter table public.agenda_eventos enable row level security;
drop policy if exists "agenda: equipe" on public.agenda_eventos;
create policy "agenda: equipe" on public.agenda_eventos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop trigger if exists agenda_carimbo on public.agenda_eventos;
create trigger agenda_carimbo before insert or update on public.agenda_eventos for each row execute procedure public.carimbar2();
-- qualquer alteração vinda do painel marca para reenviar ao Google
create or replace function public.agenda_marca_alterado() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.titulo, new.inicio, new.fim, new.dia_inteiro, new.local, new.descricao, new.cancelado, new.colaborador_id) is distinct from (old.titulo, old.inicio, old.fim, old.dia_inteiro, old.local, old.descricao, old.cancelado, old.colaborador_id) then
    new.atualizado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists agenda_alterado on public.agenda_eventos;
create trigger agenda_alterado before update on public.agenda_eventos for each row execute procedure public.agenda_marca_alterado();

-- segredos do Google no Vault (JSON da conta de serviço)
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;

-- ---------- tarefas com horário (ou prazo fatal) viram eventos da agenda do responsável ----------
create or replace function public.tarefa_para_agenda() returns trigger language plpgsql security definer set search_path = public as $$
declare ini timestamptz; fim timestamptz; inteiro boolean; titulo text; cnome text;
begin
  if tg_op = 'DELETE' then delete from public.agenda_eventos where tarefa_id = old.id; return old; end if;
  if new.prazo is null or new.status in ('cancelada') or (new.hora is null and not new.prazo_fatal) then
    update public.agenda_eventos set cancelado = true where tarefa_id = new.id and not cancelado; return new;
  end if;
  inteiro := new.hora is null;
  ini := case when inteiro then (new.prazo::timestamp) at time zone 'America/Sao_Paulo' else (new.prazo + new.hora) at time zone 'America/Sao_Paulo' end;
  fim := case when inteiro then ((new.prazo + 1)::timestamp) at time zone 'America/Sao_Paulo' else ini + interval '1 hour' end;
  select nome into cnome from public.clientes where id = new.cliente_id;
  titulo := case when new.prazo_fatal and inteiro then 'PRAZO FATAL: ' else '' end || new.titulo || coalesce(' — ' || cnome, '');
  insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, cliente_id, processo_id, tarefa_id, tipo, origem, cancelado, created_by)
  values (titulo, ini, fim, inteiro, new.responsavel_id, new.cliente_id, new.processo_id, new.id, case when new.prazo_fatal and inteiro then 'prazo' else 'compromisso' end, 'tarefa', new.status = 'concluida', new.created_by)
  on conflict (tarefa_id) where tarefa_id is not null do update set titulo = excluded.titulo, inicio = excluded.inicio, fim = excluded.fim, dia_inteiro = excluded.dia_inteiro,
    colaborador_id = excluded.colaborador_id, cliente_id = excluded.cliente_id, processo_id = excluded.processo_id, tipo = excluded.tipo, cancelado = excluded.cancelado;
  return new;
end $$;
drop trigger if exists tarefa_agenda on public.tarefas;
create trigger tarefa_agenda after insert or update of prazo, hora, prazo_fatal, titulo, responsavel_id, cliente_id, processo_id, status or delete on public.tarefas for each row execute procedure public.tarefa_para_agenda();
-- backfill
update public.tarefas set updated_at = updated_at where prazo is not null and (hora is not null or prazo_fatal) and status in ('aberta','em_andamento');

-- ---------- view para a tela ----------
create or replace view public.v_agenda with (security_invoker = true) as
select e.id, e.titulo, e.inicio, e.fim, e.dia_inteiro, e.colaborador_id, co.nome as colaborador_nome, e.cliente_id, c.nome as cliente_nome, e.processo_id, p.numero_cnj,
       e.tarefa_id, e.tipo, e.local, e.descricao, e.link, e.origem, e.google_event_id is not null as no_google, e.cancelado, e.sincronizado_em, e.updated_at
from public.agenda_eventos e
left join public.colaboradores co on co.id = e.colaborador_id
left join public.clientes c on c.id = e.cliente_id
left join public.processos p on p.id = e.processo_id;

-- ---------- RPCs usadas pela Edge Function (token das automações) ----------
-- colaboradores com sincronização ligada + eventos do painel pendentes de envio
create or replace function public.agenda_lote(token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'colaborador_id', c.id, 'nome', c.nome, 'calendar_id', coalesce(nullif(c.google_calendar_id,''), c.email), 'sync_token', c.agenda_sync_token,
    'pendentes', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim, 'dia_inteiro', e.dia_inteiro, 'local', e.local, 'descricao', e.descricao,
                                   'cancelado', e.cancelado, 'google_event_id', e.google_event_id, 'google_calendar_id', e.google_calendar_id)), '[]'::jsonb)
                  from public.agenda_eventos e where e.colaborador_id = c.id and e.origem in ('painel','tarefa')
                    and (e.google_event_id is null or e.sincronizado_em is null or e.atualizado_em > e.sincronizado_em) and (not e.cancelado or e.google_event_id is not null)
                    and e.inicio > now() - interval '30 days')))
    from public.colaboradores c where c.agenda_sync and c.ativo is distinct from false and coalesce(nullif(c.google_calendar_id,''), c.email) is not null), '[]'::jsonb);
end $$;
revoke all on function public.agenda_lote(text) from public, anon, authenticated;
grant execute on function public.agenda_lote(text) to service_role;

-- resultado do envio ao Google
create or replace function public.agenda_marcar_enviados(token text, itens jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  update public.agenda_eventos e set google_event_id = coalesce(i->>'google_event_id', e.google_event_id), google_calendar_id = coalesce(i->>'google_calendar_id', e.google_calendar_id),
         google_etag = i->>'etag', sincronizado_em = now()
  from jsonb_array_elements(itens) i where e.id = (i->>'id')::uuid and (i->>'ok')::boolean;
end $$;
revoke all on function public.agenda_marcar_enviados(text, jsonb) from public, anon, authenticated;
grant execute on function public.agenda_marcar_enviados(text, jsonb) to service_role;

-- eventos vindos do Google de um colaborador (upsert; cancelados marcam cancelado) + novo syncToken
create or replace function public.agenda_gravar_google(token text, p_colab uuid, p_calendar text, eventos jsonb, p_sync_token text, p_erro text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; ev jsonb;
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for ev in select * from jsonb_array_elements(coalesce(eventos, '[]'::jsonb)) loop
    if ev->>'status' = 'cancelled' then
      update public.agenda_eventos set cancelado = true, sincronizado_em = now() where google_calendar_id = p_calendar and google_event_id = ev->>'id';
    else
      insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, local, descricao, link, origem, google_event_id, google_calendar_id, google_etag, cancelado, sincronizado_em)
      values (coalesce(nullif(ev->>'titulo',''), '(sem título)'), (ev->>'inicio')::timestamptz, (ev->>'fim')::timestamptz, coalesce((ev->>'dia_inteiro')::boolean, false), p_colab, ev->>'local', left(ev->>'descricao', 2000), ev->>'link', 'google', ev->>'id', p_calendar, ev->>'etag', false, now())
      on conflict (google_calendar_id, google_event_id) where google_event_id is not null do update set
        titulo = excluded.titulo, inicio = excluded.inicio, fim = excluded.fim, dia_inteiro = excluded.dia_inteiro, local = excluded.local,
        descricao = case when agenda_eventos.origem = 'google' then excluded.descricao else agenda_eventos.descricao end, link = excluded.link, google_etag = excluded.google_etag, cancelado = false, sincronizado_em = now();
    end if;
    n := n + 1;
  end loop;
  update public.colaboradores set agenda_sync_token = coalesce(p_sync_token, agenda_sync_token), agenda_sync_em = now(), agenda_sync_erro = p_erro where id = p_colab;
  return n;
end $$;
revoke all on function public.agenda_gravar_google(text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.agenda_gravar_google(text, uuid, text, jsonb, text, text) to service_role;

-- ---------- agendamento: a cada 15 minutos ----------
create or replace function public.configurar_agenda(minutos integer default 15) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes).'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/agenda');
  perform cron.unschedule(jobid) from cron.job where jobname = 'agenda-np';
  perform cron.schedule('agenda-np', format('*/%s * * * *', minutos), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{}'::jsonb, timeout_milliseconds := 120000)$cmd$, endpoint, auth));
  return 'Agenda sincronizando a cada ' || minutos || ' min em ' || endpoint;
end $$;
revoke all on function public.configurar_agenda(integer) from public, anon, authenticated;
select public.configurar_agenda(15) as resultado;
