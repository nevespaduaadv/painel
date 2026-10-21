-- 0075 — Fluxos de mensagens automáticas para leads (criados pelo comercial no painel).
-- Um fluxo = gatilho (novo lead / entrou na etapa / reunião marcada / manual) + passos em sequência, cada um com espera
-- (minutos, horas ou dias) e uma mensagem de WhatsApp (variáveis {primeiro_nome}, {nome}, {empresa}, {proprietario},
-- {reuniao}, {link_reuniao}) ou uma tarefa para o responsável. As mensagens entram na fila `mensagens_fila` (0052), que o
-- ChatGuru envia em horário comercial via Edge /automacoes. O fluxo para quando o lead responde (webhook) e/ou muda de etapa,
-- conforme a configuração. Idempotente. Depende de 0052, 0073.

-- fila de mensagens passa a aceitar lead
alter table public.mensagens_fila add column if not exists lead_id uuid references public.leads (id) on delete cascade;
create index if not exists mensagens_fila_lead_idx on public.mensagens_fila (lead_id, status);
drop policy if exists "fila: equipe insere" on public.mensagens_fila;
create policy "fila: equipe insere" on public.mensagens_fila for insert to authenticated with check (public.sou_equipe());

create table if not exists public.fluxos_mensagens (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  ativo boolean not null default true,
  gatilho text not null default 'entrou_na_fase' check (gatilho in ('novo_lead', 'entrou_na_fase', 'reuniao_marcada', 'manual')),
  fase_id integer references public.fases (id),
  origens public.lead_origem[],                 -- novo_lead: null = todas
  parar_ao_responder boolean not null default true,
  parar_ao_mudar_fase boolean not null default true,
  criado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fluxos_fase_do_gatilho check (gatilho <> 'entrou_na_fase' or fase_id is not null)
);
create table if not exists public.fluxo_passos (
  id bigserial primary key,
  fluxo_id uuid not null references public.fluxos_mensagens (id) on delete cascade,
  ordem integer not null,
  espera_minutos integer not null default 0,    -- a partir do passo anterior (ou do gatilho)
  tipo text not null default 'mensagem' check (tipo in ('mensagem', 'tarefa')),
  texto text not null,                          -- mensagem (com variáveis) ou título da tarefa
  tarefa_tipo text default 'whatsapp',
  unique (fluxo_id, ordem)
);
create table if not exists public.fluxo_execucoes (
  id bigserial primary key,
  fluxo_id uuid not null references public.fluxos_mensagens (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  fase_no_inicio integer,
  iniciado_por uuid,
  status text not null default 'ativo' check (status in ('ativo', 'concluido', 'cancelado')),
  motivo text,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists fluxo_execucoes_lead_idx on public.fluxo_execucoes (lead_id, status);
alter table public.fluxos_mensagens enable row level security;
alter table public.fluxo_passos enable row level security;
alter table public.fluxo_execucoes enable row level security;
drop policy if exists "fluxos: equipe" on public.fluxos_mensagens;
create policy "fluxos: equipe" on public.fluxos_mensagens for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists "fluxo_passos: equipe" on public.fluxo_passos;
create policy "fluxo_passos: equipe" on public.fluxo_passos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists "fluxo_exec: equipe le" on public.fluxo_execucoes;
create policy "fluxo_exec: equipe le" on public.fluxo_execucoes for select to authenticated using (public.sou_equipe());
revoke all on public.fluxos_mensagens, public.fluxo_passos, public.fluxo_execucoes from anon;
do $$ begin alter publication supabase_realtime add table public.mensagens_fila; exception when others then null; end $$;

-- ---------- texto da mensagem com variáveis do lead ----------
create or replace function public.lead_mensagem_render(p_lead uuid, p_texto text) returns text
language plpgsql stable security definer set search_path = public as $$
declare l record; t text := p_texto; link text;
begin
  select l0.*, coalesce(p.nome, p.email) as prop_nome into l from public.leads l0 left join public.perfis p on p.id = l0.proprietario_id where l0.id = p_lead;
  if l.id is null then return p_texto; end if;
  link := coalesce((select dados ->> 'link_reuniao' from public.escritorio where id = 'fechamento'), (select dados ->> 'link_reuniao' from public.escritorio where id = 'site'), '');
  t := replace(t, '{nome}', coalesce(l.nome, ''));
  t := replace(t, '{primeiro_nome}', coalesce(split_part(btrim(l.nome), ' ', 1), ''));
  t := replace(t, '{empresa}', coalesce(l.empresa, ''));
  t := replace(t, '{proprietario}', coalesce(l.prop_nome, ''));
  t := replace(t, '{reuniao}', case when l.reuniao_em is null then '' else to_char(l.reuniao_em at time zone 'America/Sao_Paulo', 'DD/MM') || ' às ' || to_char(l.reuniao_em at time zone 'America/Sao_Paulo', 'HH24:MI') end);
  t := replace(t, '{reuniao_data}', case when l.reuniao_em is null then '' else to_char(l.reuniao_em at time zone 'America/Sao_Paulo', 'DD/MM') end);
  t := replace(t, '{reuniao_hora}', case when l.reuniao_em is null then '' else to_char(l.reuniao_em at time zone 'America/Sao_Paulo', 'HH24:MI') end);
  t := replace(t, '{link_reuniao}', link);
  return t;
end $$;

-- ---------- iniciar um fluxo para um lead: enfileira todos os passos ----------
create or replace function public.fluxo_iniciar(p_fluxo uuid, p_lead uuid, p_por uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare f public.fluxos_mensagens; l public.leads; p public.fluxo_passos; quando timestamptz; exec_id bigint; num text; base timestamptz;
begin
  select * into f from public.fluxos_mensagens where id = p_fluxo;
  select * into l from public.leads where id = p_lead;
  if f.id is null or l.id is null then return null; end if;
  -- não repete o mesmo fluxo ativo no mesmo lead
  if exists (select 1 from public.fluxo_execucoes where fluxo_id = p_fluxo and lead_id = p_lead and status = 'ativo') then return null; end if;
  num := nullif(regexp_replace(coalesce(l.whatsapp, ''), '[^0-9]', '', 'g'), '');
  if num is not null and length(num) <= 11 then num := '55' || num; end if;
  insert into public.fluxo_execucoes (fluxo_id, lead_id, fase_no_inicio, iniciado_por) values (p_fluxo, p_lead, l.fase_id, p_por) returning id into exec_id;
  -- reunião: os passos contam a partir da reunião (espera negativa = antes); demais: a partir de agora
  base := case when f.gatilho = 'reuniao_marcada' then l.reuniao_em else now() end;
  quando := base;
  for p in select * from public.fluxo_passos where fluxo_id = p_fluxo order by ordem loop
    quando := case when f.gatilho = 'reuniao_marcada' then base + make_interval(mins => p.espera_minutos) else quando + make_interval(mins => p.espera_minutos) end;
    if quando < now() then quando := now(); end if;
    if p.tipo = 'mensagem' then
      insert into public.mensagens_fila (lead_id, nome, numero, texto, referencia, enviar_em, status, resultado)
      values (p_lead, l.nome, num, public.lead_mensagem_render(p_lead, p.texto), 'fluxo:' || exec_id || ':' || p.ordem, quando,
              case when num is null then 'erro' else 'pendente' end, case when num is null then 'Lead sem WhatsApp' end);
    else
      insert into public.lead_tarefas (lead_id, tipo, titulo, quando, responsavel_id, detalhe, criado_por)
      values (p_lead, coalesce(p.tarefa_tipo, 'whatsapp'), p.texto, quando, l.proprietario_id, 'Fluxo: ' || f.nome, null);
    end if;
  end loop;
  return exec_id;
end $$;
revoke all on function public.fluxo_iniciar(uuid, uuid, uuid) from public, anon;

-- iniciar manualmente pela ficha (equipe)
create or replace function public.lead_fluxo_iniciar(p_lead uuid, p_fluxo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e bigint;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  e := public.fluxo_iniciar(p_fluxo, p_lead, auth.uid());
  if e is null then raise exception 'Este fluxo já está ativo para o lead (ou fluxo/lead não encontrado).'; end if;
  return jsonb_build_object('ok', true, 'execucao', e);
end $$;
revoke all on function public.lead_fluxo_iniciar(uuid, uuid) from public, anon;

-- parar fluxos ativos do lead (todos ou só os que param por aquele motivo)
create or replace function public.fluxos_parar(p_lead uuid, p_motivo text, p_so_configurados boolean default true) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; e record;
begin
  for e in select x.id, f.parar_ao_responder, f.parar_ao_mudar_fase from public.fluxo_execucoes x join public.fluxos_mensagens f on f.id = x.fluxo_id
            where x.lead_id = p_lead and x.status = 'ativo' loop
    if p_so_configurados and ((p_motivo = 'respondeu' and not e.parar_ao_responder) or (p_motivo = 'mudou_fase' and not e.parar_ao_mudar_fase)) then continue; end if;
    update public.mensagens_fila set status = 'cancelada', resultado = 'Fluxo interrompido: ' || p_motivo, atualizado_em = now()
     where lead_id = p_lead and status = 'pendente' and referencia like 'fluxo:' || e.id || ':%';
    update public.fluxo_execucoes set status = 'cancelado', motivo = p_motivo, atualizado_em = now() where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fluxos_parar(uuid, text, boolean) from public, anon;
create or replace function public.lead_fluxos_parar(p_lead uuid) returns integer
language sql security definer set search_path = public as $$ select public.fluxos_parar(p_lead, 'parado pela equipe', false) $$;
revoke all on function public.lead_fluxos_parar(uuid) from public, anon;

-- fluxos concluem sozinhos quando não resta mensagem pendente
create or replace function public.fluxos_concluir_prontos() returns void
language sql security definer set search_path = public as $$
  update public.fluxo_execucoes x set status = 'concluido', atualizado_em = now()
   where x.status = 'ativo' and x.created_at < now() - interval '1 minute'
     and not exists (select 1 from public.mensagens_fila m where m.lead_id = x.lead_id and m.status in ('pendente', 'processando') and m.referencia like 'fluxo:' || x.id || ':%');
$$;

-- ---------- gatilhos automáticos ----------
create or replace function public.leads_fluxos_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if coalesce(current_setting('np.sem_cadencia', true), '') = '1' then return new; end if;  -- importação não dispara
  if tg_op = 'UPDATE' and (new.fase_id is distinct from old.fase_id or new.status <> 'Aberto' and old.status = 'Aberto') then
    perform public.fluxos_parar(new.id, 'mudou_fase', true);
  end if;
  if new.status <> 'Aberto' then return new; end if;
  if tg_op = 'INSERT' then
    for f in select * from public.fluxos_mensagens where ativo and gatilho = 'novo_lead' and (origens is null or new.origem = any(origens)) loop
      perform public.fluxo_iniciar(f.id, new.id, null);
    end loop;
    for f in select * from public.fluxos_mensagens where ativo and gatilho = 'entrou_na_fase' and fase_id = new.fase_id loop
      perform public.fluxo_iniciar(f.id, new.id, null);
    end loop;
  else
    if new.fase_id is distinct from old.fase_id then
      for f in select * from public.fluxos_mensagens where ativo and gatilho = 'entrou_na_fase' and fase_id = new.fase_id loop
        perform public.fluxo_iniciar(f.id, new.id, null);
      end loop;
    end if;
    if new.reuniao_em is distinct from old.reuniao_em and new.reuniao_em is not null and new.reuniao_em > now() then
      perform public.fluxos_parar(new.id, 'reuniao remarcada', false) where exists (select 1 from public.fluxo_execucoes x join public.fluxos_mensagens fm on fm.id = x.fluxo_id where x.lead_id = new.id and x.status = 'ativo' and fm.gatilho = 'reuniao_marcada');
      for f in select * from public.fluxos_mensagens where ativo and gatilho = 'reuniao_marcada' loop
        perform public.fluxo_iniciar(f.id, new.id, null);
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_fluxos on public.leads;
create trigger leads_fluxos after insert or update of fase_id, status, reuniao_em on public.leads
  for each row execute function public.leads_fluxos_gatilho();

-- lead respondeu → para os fluxos configurados para isso
create or replace function public.lead_respondeu(p_lead uuid, p_quando timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then return; end if;
  update public.leads set ultima_resposta_em = p_quando,
    cadencia_pausada_em = case when cadencia_id is not null and cadencia_encerrada_em is null then coalesce(cadencia_pausada_em, p_quando) else cadencia_pausada_em end
   where id = p_lead;
  if l.cadencia_id is not null and l.cadencia_encerrada_em is null then
    update public.lead_tarefas set concluida_em = now(), detalhe = concat_ws(' · ', detalhe, 'Encerrada automaticamente: o lead respondeu.')
     where lead_id = p_lead and cadencia_id = l.cadencia_id and concluida_em is null
       and (quando at time zone 'America/Sao_Paulo')::date <= (p_quando at time zone 'America/Sao_Paulo')::date;
  end if;
  perform public.fluxos_parar(p_lead, 'respondeu', true);
  if l.status = 'Aberto' and l.fase_id = 1 then
    update public.leads set fase_id = 2 where id = p_lead;
  end if;
end $$;

-- envio registrado no lead (observação + última interação); erro avisa o proprietário
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
      if m.lead_id is not null then
        insert into public.observacoes (lead_id, texto) values (m.lead_id, 'Automação do CRM:' || E'\n' || coalesce(m.texto, ''));
        update public.leads set ultima_interacao_em = now() where id = m.lead_id;
      end if;
    elsif coalesce((it->>'temporario')::boolean, false) and m.tentativas < 3 then
      update public.mensagens_fila set status = 'pendente', enviar_em = now() + interval '5 minutes', resultado = it->>'erro', atualizado_em = now() where id = m.id;
    else
      update public.mensagens_fila set status = 'erro', resultado = it->>'erro', atualizado_em = now() where id = m.id;
      if m.cliente_id is not null then
        perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = m.cliente_id), 'WhatsApp não enviado',
          coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#clientes/' || coalesce(m.cliente_id, ''));
      elsif m.lead_id is not null then
        perform public.notificar((select proprietario_id from public.leads where id = m.lead_id), 'Mensagem automática não enviada',
          coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#leads');
      end if;
    end if;
  end loop;
  perform public.fluxos_concluir_prontos();
end $$;
revoke all on function public.mensagens_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.mensagens_registrar(text, jsonb) to service_role;

-- view para a ficha do lead: mensagens automáticas (pendentes/enviadas) e fluxos
create or replace view public.v_lead_mensagens with (security_invoker = true) as
select m.id, m.lead_id, m.texto, m.enviar_em, m.status, m.resultado, m.enviada_em, m.referencia, m.created_at,
       x.id as execucao_id, f.nome as fluxo_nome, x.status as fluxo_status
  from public.mensagens_fila m
  left join public.fluxo_execucoes x on m.referencia like 'fluxo:' || x.id || ':%'
  left join public.fluxos_mensagens f on f.id = x.fluxo_id
 where m.lead_id is not null;
revoke all on public.v_lead_mensagens from anon;

create or replace view public.v_fluxos_mensagens with (security_invoker = true) as
select f.*, fa.nome as fase_nome,
       (select count(*) from public.fluxo_passos p where p.fluxo_id = f.id) as passos,
       (select count(*) from public.fluxo_execucoes x where x.fluxo_id = f.id) as execucoes,
       (select count(*) from public.fluxo_execucoes x where x.fluxo_id = f.id and x.status = 'ativo') as ativas
  from public.fluxos_mensagens f left join public.fases fa on fa.id = f.fase_id;
revoke all on public.v_fluxos_mensagens from anon;

select 'ok 0075' as resultado;
