-- ESPELHO (beta) — parte 9 de 9: 0077_automacoes_construtor.sql … 0079_atendimento_whatsapp.sql

-- ===== 0077_automacoes_construtor.sql =====
-- 0077 — Automações (construtor de fluxos de trabalho) — versão 2 dos fluxos de mensagens (0075).
-- Um fluxo tem vários acionadores e uma árvore de passos com ramificação (condição sim/não). A definição fica em
-- fluxos_mensagens.definicao: {"gatilhos":[{tipo,config}], "passos":[árvore para o editor], "nos":{id:{tipo,config,next,sim,nao}}, "inicio":id}.
-- O motor (fluxo_executar) percorre os "nos" a partir de fluxo_execucoes.no_atual, passo a passo: esperar agenda proximo_em;
-- mensagem entra na fila de WhatsApp (ChatGuru); tarefa/etapa/tag/notificar agem no lead; condicao escolhe o ramo.
-- Acionadores: entrou_na_fase, novo_lead, reuniao_marcada, manual, tag_adicionada, lead_respondeu, parado_na_etapa.
-- Idempotente. Depende de 0075.

alter table public.fluxos_mensagens
  add column if not exists definicao jsonb not null default '{"gatilhos":[],"passos":[],"nos":{},"inicio":null}'::jsonb,
  add column if not exists pasta text,
  add column if not exists versao integer not null default 2;
alter table public.fluxo_execucoes
  add column if not exists no_atual text,
  add column if not exists proximo_em timestamptz,
  add column if not exists contexto jsonb not null default '{}'::jsonb,
  add column if not exists historico jsonb not null default '[]'::jsonb;
create index if not exists fluxo_execucoes_fila_idx on public.fluxo_execucoes (proximo_em) where status = 'ativo';

-- converte fluxos da versão 1 (fluxo_passos sequenciais) para a definição v2
do $$
declare f record; p record; nos jsonb; passos jsonb; prev text; ini text; cfg jsonb; idn text; i int;
begin
  for f in select * from public.fluxos_mensagens where versao < 2 or (definicao->'nos' = '{}'::jsonb and exists (select 1 from public.fluxo_passos x where x.fluxo_id = fluxos_mensagens.id)) loop
    nos := '{}'::jsonb; passos := '[]'::jsonb; prev := null; ini := null; i := 0;
    for p in select * from public.fluxo_passos where fluxo_id = f.id order by ordem loop
      -- espera (se houver) + ação
      if p.espera_minutos <> 0 or f.gatilho = 'reuniao_marcada' then
        i := i + 1; idn := 'n' || i;
        cfg := jsonb_build_object('minutos', p.espera_minutos, 'relativo', case when f.gatilho = 'reuniao_marcada' then 'reuniao' else 'anterior' end);
        nos := nos || jsonb_build_object(idn, jsonb_build_object('id', idn, 'tipo', 'esperar', 'config', cfg, 'next', null));
        passos := passos || jsonb_build_object('id', idn, 'tipo', 'esperar', 'config', cfg);
        if prev is not null then nos := jsonb_set(nos, array[prev, 'next'], to_jsonb(idn)); else ini := idn; end if;
        prev := idn;
      end if;
      i := i + 1; idn := 'n' || i;
      cfg := case when p.tipo = 'mensagem' then jsonb_build_object('texto', p.texto) else jsonb_build_object('titulo', p.texto, 'tarefa_tipo', coalesce(p.tarefa_tipo, 'whatsapp')) end;
      nos := nos || jsonb_build_object(idn, jsonb_build_object('id', idn, 'tipo', p.tipo, 'config', cfg, 'next', null));
      passos := passos || jsonb_build_object('id', idn, 'tipo', p.tipo, 'config', cfg);
      if prev is not null then nos := jsonb_set(nos, array[prev, 'next'], to_jsonb(idn)); else ini := idn; end if;
      prev := idn;
    end loop;
    update public.fluxos_mensagens set versao = 2,
      definicao = jsonb_build_object(
        'gatilhos', jsonb_build_array(jsonb_build_object('id', 'g1', 'tipo', f.gatilho, 'config', jsonb_strip_nulls(jsonb_build_object('fase_id', f.fase_id, 'origens', to_jsonb(f.origens))))),
        'passos', passos, 'nos', nos, 'inicio', ini)
     where id = f.id;
  end loop;
end $$;

-- ---------- utilitários ----------
create or replace function public.fluxo_tem_gatilho(f public.fluxos_mensagens, p_tipo text) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(f.definicao->'gatilhos', '[]'::jsonb)) g where g->>'tipo' = p_tipo)
$$;
create or replace function public.fluxo_gatilhos(f public.fluxos_mensagens, p_tipo text) returns setof jsonb
language sql immutable as $$
  select g->'config' from jsonb_array_elements(coalesce(f.definicao->'gatilhos', '[]'::jsonb)) g where g->>'tipo' = p_tipo
$$;
create or replace function public.fluxo_log(p_exec bigint, p_no text, p_tipo text, p_texto text) returns void
language sql security definer set search_path = public as $$
  update public.fluxo_execucoes set historico = historico || jsonb_build_object('em', now(), 'no', p_no, 'tipo', p_tipo, 'texto', p_texto), atualizado_em = now() where id = p_exec;
$$;

-- ---------- iniciar (v2) ----------
create or replace function public.fluxo_iniciar(p_fluxo uuid, p_lead uuid, p_por uuid default null, p_contexto jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare f public.fluxos_mensagens; l public.leads; exec_id bigint;
begin
  select * into f from public.fluxos_mensagens where id = p_fluxo;
  select * into l from public.leads where id = p_lead;
  if f.id is null or l.id is null then return null; end if;
  if exists (select 1 from public.fluxo_execucoes where fluxo_id = p_fluxo and lead_id = p_lead and status = 'ativo') then return null; end if;
  if (f.definicao->>'inicio') is null then return null; end if;
  insert into public.fluxo_execucoes (fluxo_id, lead_id, fase_no_inicio, iniciado_por, no_atual, proximo_em, contexto)
  values (p_fluxo, p_lead, l.fase_id, p_por, f.definicao->>'inicio', now(), coalesce(p_contexto, '{}'::jsonb)) returning id into exec_id;
  perform public.fluxo_log(exec_id, null, 'inicio', 'Fluxo iniciado' || coalesce(' (' || nullif(p_contexto->>'motivo', '') || ')', ''));
  perform public.fluxo_executar(exec_id);
  return exec_id;
end $$;
revoke all on function public.fluxo_iniciar(uuid, uuid, uuid, jsonb) from public, anon;
drop function if exists public.fluxo_iniciar(uuid, uuid, uuid);

create or replace function public.lead_fluxo_iniciar(p_lead uuid, p_fluxo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e bigint;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  e := public.fluxo_iniciar(p_fluxo, p_lead, auth.uid(), jsonb_build_object('motivo', 'iniciado pela equipe'));
  if e is null then raise exception 'Este fluxo já está ativo para o lead, não tem passos, ou fluxo/lead não encontrado.'; end if;
  return jsonb_build_object('ok', true, 'execucao', e);
end $$;

-- parar: também cancela mensagens pendentes; ignora a execução que está agindo agora (np.fluxo_exec_atual)
create or replace function public.fluxos_parar(p_lead uuid, p_motivo text, p_so_configurados boolean default true) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; e record; atual bigint := nullif(current_setting('np.fluxo_exec_atual', true), '')::bigint;
begin
  for e in select x.id, f.parar_ao_responder, f.parar_ao_mudar_fase from public.fluxo_execucoes x join public.fluxos_mensagens f on f.id = x.fluxo_id
            where x.lead_id = p_lead and x.status = 'ativo' loop
    continue when e.id = atual;
    if p_so_configurados and ((p_motivo = 'respondeu' and not e.parar_ao_responder) or (p_motivo = 'mudou_fase' and not e.parar_ao_mudar_fase)) then continue; end if;
    update public.mensagens_fila set status = 'cancelada', resultado = 'Fluxo interrompido: ' || p_motivo, atualizado_em = now()
     where lead_id = p_lead and status = 'pendente' and referencia like 'fluxo:' || e.id || ':%';
    update public.fluxo_execucoes set status = 'cancelado', motivo = p_motivo, atualizado_em = now() where id = e.id;
    perform public.fluxo_log(e.id, null, 'parado', 'Fluxo interrompido: ' || p_motivo);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- condição ----------
create or replace function public.fluxo_condicao(x public.fluxo_execucoes, cfg jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare l public.leads; t text := cfg->>'tipo';
begin
  select * into l from public.leads where id = x.lead_id;
  return case t
    when 'respondeu' then l.ultima_resposta_em is not null and l.ultima_resposta_em >= x.created_at
    when 'etapa' then l.fase_id = any(array(select (v)::int from jsonb_array_elements_text(coalesce(cfg->'fases', '[]'::jsonb)) v))
    when 'status' then l.status::text = coalesce(cfg->>'status', 'Aberto')
    when 'tag' then exists (select 1 from public.lead_tags lt join public.tags tg on tg.id = lt.tag_id where lt.lead_id = l.id and lower(tg.nome) = lower(cfg->>'tag'))
    when 'reuniao' then l.reuniao_em is not null and l.reuniao_em > now()
    when 'proprietario' then l.proprietario_id is not null
    else false end;
end $$;

-- ---------- motor ----------
create or replace function public.fluxo_executar(p_exec bigint) returns void
language plpgsql security definer set search_path = public as $$
declare x public.fluxo_execucoes; f public.fluxos_mensagens; l public.leads; no jsonb; cfg jsonb; tipo text; passos int := 0;
        quando timestamptz; num text; txt text; tg bigint; prox text; ok boolean;
begin
  select * into x from public.fluxo_execucoes where id = p_exec for update;
  if x.id is null or x.status <> 'ativo' then return; end if;
  select * into f from public.fluxos_mensagens where id = x.fluxo_id;
  perform set_config('np.fluxo_exec_atual', p_exec::text, true);
  while passos < 60 loop
    passos := passos + 1;
    if x.no_atual is null then
      update public.fluxo_execucoes set status = 'concluido', proximo_em = null, atualizado_em = now() where id = x.id;
      perform public.fluxo_log(x.id, null, 'fim', 'Fluxo concluído');
      exit;
    end if;
    no := f.definicao->'nos'->(x.no_atual);
    if no is null then
      update public.fluxo_execucoes set status = 'concluido', proximo_em = null, motivo = 'passo removido', atualizado_em = now() where id = x.id;
      perform public.fluxo_log(x.id, x.no_atual, 'fim', 'Passo não existe mais — fluxo encerrado');
      exit;
    end if;
    select * into l from public.leads where id = x.lead_id;
    if l.id is null or l.status <> 'Aberto' and f.parar_ao_mudar_fase then
      update public.fluxo_execucoes set status = 'cancelado', motivo = 'lead fechado', proximo_em = null, atualizado_em = now() where id = x.id;
      perform public.fluxo_log(x.id, x.no_atual, 'parado', 'Lead fechado — fluxo interrompido');
      exit;
    end if;
    tipo := no->>'tipo'; cfg := coalesce(no->'config', '{}'::jsonb); prox := no->>'next';
    if tipo = 'esperar' then
      if coalesce(cfg->>'relativo', 'anterior') = 'reuniao' then
        quando := coalesce(l.reuniao_em, now()) + make_interval(mins => coalesce((cfg->>'minutos')::int, 0));
      elsif coalesce(cfg->>'relativo', 'anterior') = 'horario' then   -- próximo dia útil às HH:MM
        quando := public.cadencia_somar_dias_uteis(now(), greatest(coalesce((cfg->>'dias')::int, 1), 1)) + (coalesce(cfg->>'hora', '09:00')::time - time '09:00');
      else
        quando := now() + make_interval(mins => coalesce((cfg->>'minutos')::int, 0));
      end if;
      if quando < now() then quando := now(); end if;
      -- se a espera já foi cumprida (retomada pelo cron), segue; senão agenda
      if x.proximo_em is not null and x.proximo_em <= now() and (x.contexto->>'esperando') = x.no_atual then
        x.contexto := x.contexto - 'esperando';
        update public.fluxo_execucoes set no_atual = prox, contexto = x.contexto, atualizado_em = now() where id = x.id;
        x.no_atual := prox; continue;
      end if;
      update public.fluxo_execucoes set proximo_em = quando, contexto = x.contexto || jsonb_build_object('esperando', x.no_atual), atualizado_em = now() where id = x.id;
      perform public.fluxo_log(x.id, x.no_atual, 'esperar', 'Aguardando até ' || to_char(quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'));
      exit;
    elsif tipo = 'mensagem' then
      num := nullif(regexp_replace(coalesce(l.whatsapp, ''), '[^0-9]', '', 'g'), '');
      if num is not null and length(num) <= 11 then num := '55' || num; end if;
      txt := public.lead_mensagem_render(l.id, cfg->>'texto');
      insert into public.mensagens_fila (lead_id, nome, numero, texto, referencia, enviar_em, status, resultado)
      values (l.id, l.nome, num, txt, 'fluxo:' || x.id || ':' || x.no_atual, now(), case when num is null then 'erro' else 'pendente' end, case when num is null then 'Lead sem WhatsApp' end);
      perform public.fluxo_log(x.id, x.no_atual, 'mensagem', case when num is null then 'Mensagem não enviada: lead sem WhatsApp' else 'Mensagem na fila: ' || left(txt, 80) end);
    elsif tipo = 'tarefa' then
      insert into public.lead_tarefas (lead_id, tipo, titulo, quando, responsavel_id, detalhe, criado_por)
      values (l.id, coalesce(cfg->>'tarefa_tipo', 'whatsapp'), public.lead_mensagem_render(l.id, coalesce(cfg->>'titulo', 'Tarefa do fluxo')), now() + make_interval(mins => coalesce((cfg->>'prazo_minutos')::int, 0)), l.proprietario_id, 'Fluxo: ' || f.nome, null);
      perform public.fluxo_log(x.id, x.no_atual, 'tarefa', 'Tarefa criada: ' || coalesce(cfg->>'titulo', ''));
    elsif tipo = 'etapa' then
      if (cfg->>'fase_id') is not null and l.fase_id <> (cfg->>'fase_id')::int then
        update public.leads set fase_id = (cfg->>'fase_id')::int where id = l.id;
        perform public.fluxo_log(x.id, x.no_atual, 'etapa', 'Lead movido para ' || coalesce((select nome from public.fases where id = (cfg->>'fase_id')::int), cfg->>'fase_id'));
      end if;
    elsif tipo = 'tag' then
      if coalesce(cfg->>'acao', 'adicionar') = 'adicionar' and nullif(btrim(cfg->>'tag'), '') is not null then
        insert into public.tags (nome) values (btrim(cfg->>'tag')) on conflict (nome) do nothing;
        select id into tg from public.tags where nome = btrim(cfg->>'tag');
        insert into public.lead_tags (lead_id, tag_id) values (l.id, tg) on conflict do nothing;
        perform public.fluxo_log(x.id, x.no_atual, 'tag', 'Tag adicionada: ' || btrim(cfg->>'tag'));
      elsif nullif(btrim(cfg->>'tag'), '') is not null then
        delete from public.lead_tags where lead_id = l.id and tag_id in (select id from public.tags where lower(nome) = lower(btrim(cfg->>'tag')));
        perform public.fluxo_log(x.id, x.no_atual, 'tag', 'Tag removida: ' || btrim(cfg->>'tag'));
      end if;
    elsif tipo = 'notificar' then
      perform public.notificar(l.proprietario_id, coalesce(nullif(cfg->>'titulo', ''), 'Fluxo: ' || f.nome), public.lead_mensagem_render(l.id, coalesce(cfg->>'texto', '')) || ' — ' || l.nome, '#leads');
      perform public.fluxo_log(x.id, x.no_atual, 'notificar', 'Responsável avisado: ' || coalesce(cfg->>'titulo', ''));
    elsif tipo = 'condicao' then
      ok := public.fluxo_condicao(x, cfg);
      prox := case when ok then no->>'sim' else no->>'nao' end;
      if prox is null then prox := no->>'next'; end if;
      perform public.fluxo_log(x.id, x.no_atual, 'condicao', 'Condição "' || coalesce(cfg->>'rotulo', cfg->>'tipo') || '": ' || case when ok then 'sim' else 'não' end);
    elsif tipo = 'parar' then
      prox := null;
    end if;
    update public.fluxo_execucoes set no_atual = prox, proximo_em = null, atualizado_em = now() where id = x.id;
    x.no_atual := prox;
  end loop;
end $$;
revoke all on function public.fluxo_executar(bigint) from public, anon;

-- processador (cron a cada minuto): retoma esperas vencidas e dispara "parado na etapa"
create or replace function public.fluxos_processar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; f public.fluxos_mensagens; g jsonb; l record; n int := 0; m int := 0;
begin
  if auth.uid() is not null and not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  for e in select id from public.fluxo_execucoes where status = 'ativo' and proximo_em is not null and proximo_em <= now() order by proximo_em limit 200 loop
    perform public.fluxo_executar(e.id); n := n + 1;
  end loop;
  -- parado na etapa (uma vez por lead por "entrada na etapa")
  for f in select * from public.fluxos_mensagens where ativo and public.fluxo_tem_gatilho(fluxos_mensagens, 'parado_na_etapa') loop
    for g in select * from public.fluxo_gatilhos(f, 'parado_na_etapa') loop
      for l in select id, fase_desde from public.leads
                where status = 'Aberto' and ((g->>'fase_id') is null or fase_id = (g->>'fase_id')::int)
                  and fase_desde <= now() - make_interval(days => greatest(coalesce((g->>'dias')::int, 3), 1))
                  and not exists (select 1 from public.fluxo_execucoes x where x.fluxo_id = f.id and x.lead_id = leads.id and (x.contexto->>'fase_desde')::timestamptz = leads.fase_desde)
                limit 100 loop
        perform public.fluxo_iniciar(f.id, l.id, null, jsonb_build_object('motivo', 'parado na etapa', 'fase_desde', l.fase_desde)); m := m + 1;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('retomadas', n, 'parados', m);
end $$;
revoke all on function public.fluxos_processar() from public, anon;
grant execute on function public.fluxos_processar() to authenticated;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'fluxos-np';
  perform cron.schedule('fluxos-np', '* * * * *', $c$ select public.fluxos_processar(); $c$);
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

-- ---------- acionadores automáticos (v2) ----------
create or replace function public.leads_fluxos_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.fluxos_mensagens; g jsonb;
begin
  if coalesce(current_setting('np.sem_cadencia', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' and (new.fase_id is distinct from old.fase_id or (new.status <> 'Aberto' and old.status = 'Aberto')) then
    perform public.fluxos_parar(new.id, 'mudou_fase', true);
  end if;
  if new.status <> 'Aberto' then return new; end if;
  for f in select * from public.fluxos_mensagens where ativo loop
    if tg_op = 'INSERT' then
      for g in select * from public.fluxo_gatilhos(f, 'novo_lead') loop
        if jsonb_typeof(g->'origens') <> 'array' or jsonb_array_length(g->'origens') = 0 or (g->'origens') ? new.origem::text then
          perform public.fluxo_iniciar(f.id, new.id, null, jsonb_build_object('motivo', 'lead novo')); exit;
        end if;
      end loop;
    end if;
    if tg_op = 'INSERT' or new.fase_id is distinct from old.fase_id then
      for g in select * from public.fluxo_gatilhos(f, 'entrou_na_fase') loop
        if (g->>'fase_id')::int = new.fase_id then perform public.fluxo_iniciar(f.id, new.id, null, jsonb_build_object('motivo', 'entrou na etapa')); exit; end if;
      end loop;
    end if;
    if tg_op = 'UPDATE' and new.reuniao_em is distinct from old.reuniao_em and new.reuniao_em is not null and new.reuniao_em > now() and public.fluxo_tem_gatilho(f, 'reuniao_marcada') then
      update public.fluxo_execucoes x set status = 'cancelado', motivo = 'reunião remarcada', atualizado_em = now() where x.fluxo_id = f.id and x.lead_id = new.id and x.status = 'ativo';
      update public.mensagens_fila m set status = 'cancelada', resultado = 'reunião remarcada', atualizado_em = now() where m.lead_id = new.id and m.status = 'pendente' and m.referencia like 'fluxo:%';
      perform public.fluxo_iniciar(f.id, new.id, null, jsonb_build_object('motivo', 'reunião marcada'));
    end if;
  end loop;
  return new;
end $$;

-- tag adicionada
create or replace function public.lead_tags_fluxos_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.fluxos_mensagens; g jsonb; nome text;
begin
  if coalesce(current_setting('np.sem_cadencia', true), '') = '1' then return new; end if;
  select t.nome into nome from public.tags t where t.id = new.tag_id;
  for f in select * from public.fluxos_mensagens where ativo and public.fluxo_tem_gatilho(fluxos_mensagens, 'tag_adicionada') loop
    for g in select * from public.fluxo_gatilhos(f, 'tag_adicionada') loop
      if lower(coalesce(g->>'tag', '')) = lower(nome) then perform public.fluxo_iniciar(f.id, new.lead_id, null, jsonb_build_object('motivo', 'tag "' || nome || '" adicionada')); exit; end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists lead_tags_fluxos on public.lead_tags;
create trigger lead_tags_fluxos after insert on public.lead_tags for each row execute function public.lead_tags_fluxos_gatilho();

-- lead respondeu → gatilho + parar os configurados
create or replace function public.lead_respondeu(p_lead uuid, p_quando timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads; f public.fluxos_mensagens;
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
  if l.status = 'Aberto' then
    for f in select * from public.fluxos_mensagens where ativo and public.fluxo_tem_gatilho(fluxos_mensagens, 'lead_respondeu') loop
      perform public.fluxo_iniciar(f.id, p_lead, null, jsonb_build_object('motivo', 'lead respondeu'));
    end loop;
  end if;
  if l.status = 'Aberto' and l.fase_id = 1 then
    update public.leads set fase_id = 2 where id = p_lead;
  end if;
end $$;

-- testar um fluxo com um lead (equipe): inicia mesmo se o fluxo estiver em rascunho
create or replace function public.fluxo_testar(p_fluxo uuid, p_lead uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e bigint;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.fluxo_execucoes set status = 'cancelado', motivo = 'novo teste', atualizado_em = now() where fluxo_id = p_fluxo and lead_id = p_lead and status = 'ativo';
  e := public.fluxo_iniciar(p_fluxo, p_lead, auth.uid(), jsonb_build_object('motivo', 'teste', 'teste', true));
  if e is null then raise exception 'Não foi possível iniciar: o fluxo precisa ter pelo menos um passo.'; end if;
  return jsonb_build_object('ok', true, 'execucao', e);
end $$;
revoke all on function public.fluxo_testar(uuid, uuid) from public, anon;

-- cancelar uma execução específica (equipe)
create or replace function public.fluxo_execucao_cancelar(p_exec bigint) returns void
language plpgsql security definer set search_path = public as $$
declare x public.fluxo_execucoes;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into x from public.fluxo_execucoes where id = p_exec;
  if x.id is null or x.status <> 'ativo' then return; end if;
  update public.mensagens_fila set status = 'cancelada', resultado = 'Execução cancelada', atualizado_em = now() where status = 'pendente' and referencia like 'fluxo:' || p_exec || ':%';
  update public.fluxo_execucoes set status = 'cancelado', motivo = 'cancelado pela equipe', proximo_em = null, atualizado_em = now() where id = p_exec;
  perform public.fluxo_log(p_exec, null, 'parado', 'Cancelado pela equipe');
end $$;
revoke all on function public.fluxo_execucao_cancelar(bigint) from public, anon;

-- views
drop view if exists public.v_fluxos_mensagens;
create view public.v_fluxos_mensagens with (security_invoker = true) as
select f.*, fa.nome as fase_nome,
       coalesce(jsonb_array_length(f.definicao->'gatilhos'), 0) as n_gatilhos,
       (select count(*) from jsonb_object_keys(coalesce(f.definicao->'nos', '{}'::jsonb))) as passos,
       (select count(*) from public.fluxo_execucoes x where x.fluxo_id = f.id) as execucoes,
       (select count(*) from public.fluxo_execucoes x where x.fluxo_id = f.id and x.status = 'ativo') as ativas,
       (select max(x.created_at) from public.fluxo_execucoes x where x.fluxo_id = f.id) as ultima_execucao
  from public.fluxos_mensagens f left join public.fases fa on fa.id = f.fase_id;
revoke all on public.v_fluxos_mensagens from anon;

create or replace view public.v_fluxo_execucoes with (security_invoker = true) as
select x.*, l.nome as lead_nome, l.empresa as lead_empresa, l.whatsapp as lead_whatsapp, l.fase_id as lead_fase_id, fa.nome as lead_fase_nome, f.nome as fluxo_nome,
       coalesce(p.nome, p.email) as iniciado_por_nome
  from public.fluxo_execucoes x join public.leads l on l.id = x.lead_id join public.fluxos_mensagens f on f.id = x.fluxo_id
  left join public.fases fa on fa.id = l.fase_id left join public.perfis p on p.id = x.iniciado_por;
revoke all on public.v_fluxo_execucoes from anon;

select 'ok 0077' as resultado;


-- ===== 0078_chatguru_tags_automacoes.sql =====
-- 0078 — Tags do ChatGuru integradas às automações: o webhook sincroniza as tags por diferença (o acionador "tag adicionada"
-- dispara só quando a tag entra) e um POST disparado por diálogo executado pela equipe (URL com &origem=equipe) não conta
-- como "lead respondeu". Com isso, a equipe aplica a tag no ChatGuru por um diálogo (ação TAG + POST PARA URL) e o
-- sistema cria/atualiza o lead e dispara o fluxo na hora, mesmo para leads orgânicos que ainda não estavam no CRM.
-- Idempotente. Depende de 0077.

-- ---------- webhook do ChatGuru: toda mensagem do lead conta como resposta ----------
create or replace function public.chatguru_webhook(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id bigint;
  chave text;
  lead uuid;
  tag_nome text;
  email_recebido text;
  mensagem text;
  m jsonb;
  existia boolean := false;
begin
  insert into public.webhook_logs (payload) values (p) returning id into log_id;

  begin
    chave := public.normalizar_whatsapp(p ->> 'celular');
    if chave is null then
      raise exception 'Payload sem celular.';
    end if;

    email_recebido := nullif(p ->> 'email', '');
    if email_recebido like '%@c.us' then
      email_recebido := null;
    end if;

    mensagem := left(coalesce(
      nullif(btrim(p ->> 'texto_mensagem'), ''),
      nullif(btrim(p ->> 'mensagem'), ''),
      nullif(btrim(p ->> 'ultima_mensagem'), '')
    ), 2000);

    m := public.meta_ids_de_chatguru(p);

    select id into lead from public.leads where whatsapp_normalizado = chave;

    if lead is null then
      insert into public.leads (
        nome, email, whatsapp, campanha, publico, anuncio, link_chat, chatguru_chat_id, responsavel_chatguru, origem,
        ultima_mensagem, ultima_interacao_em,
        meta_ad_id, meta_adset_id, meta_campaign_id, meta_ctwa_clid, meta_source_url, meta_headline
      )
      values (
        coalesce(nullif(p ->> 'nome', ''), 'Sem nome'),
        email_recebido,
        p ->> 'celular',
        case when m ?| array['ad_id','adset_id','campaign_id'] then m ->> 'campaign_name' else coalesce(m ->> 'campaign_name', nullif(p ->> 'campanha_nome', '')) end,
        m ->> 'adset_name',
        coalesce(m ->> 'ad_name', m ->> 'headline'),
        nullif(p ->> 'link_chat', ''),
        nullif(p ->> 'chat_id', ''),
        nullif(p ->> 'responsavel_nome', ''),
        'chatguru',
        mensagem,
        now(),
        m ->> 'ad_id', m ->> 'adset_id', m ->> 'campaign_id', m ->> 'ctwa_clid', m ->> 'source_url', m ->> 'headline'
      ) returning id into lead;
    else
      existia := true;
      update public.leads set
        nome                 = coalesce(nullif(nome, ''), nullif(p ->> 'nome', ''), nome),
        email                = coalesce(email, email_recebido),
        campanha             = coalesce(nullif(campanha, ''), m ->> 'campaign_name', case when m ?| array['ad_id','adset_id','campaign_id'] then null else nullif(p ->> 'campanha_nome', '') end),
        publico              = coalesce(nullif(publico, ''), m ->> 'adset_name'),
        anuncio              = coalesce(nullif(anuncio, ''), m ->> 'ad_name', m ->> 'headline'),
        link_chat            = coalesce(nullif(p ->> 'link_chat', ''), link_chat),
        chatguru_chat_id     = coalesce(nullif(p ->> 'chat_id', ''), chatguru_chat_id),
        responsavel_chatguru = coalesce(nullif(p ->> 'responsavel_nome', ''), responsavel_chatguru),
        ultima_mensagem      = coalesce(mensagem, ultima_mensagem),
        ultima_interacao_em  = now(),
        meta_ad_id           = coalesce(meta_ad_id, m ->> 'ad_id'),
        meta_adset_id        = coalesce(meta_adset_id, m ->> 'adset_id'),
        meta_campaign_id     = coalesce(meta_campaign_id, m ->> 'campaign_id'),
        meta_ctwa_clid       = coalesce(meta_ctwa_clid, m ->> 'ctwa_clid'),
        meta_source_url      = coalesce(meta_source_url, m ->> 'source_url'),
        meta_headline        = coalesce(meta_headline, m ->> 'headline')
      where id = lead;
    end if;

    perform public.leads_completar_meta(lead);

    -- tags: sincroniza por diferença (só insere as novas e remove as que saíram) — assim o acionador
    -- "tag adicionada" dispara uma vez, quando a tag entra, e não a cada mensagem do lead
    if jsonb_typeof(p -> 'tags') = 'array' then
      delete from public.lead_tags lt using public.tags t
       where lt.lead_id = lead and t.id = lt.tag_id
         and lower(t.nome) not in (select lower(btrim(value)) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '');
      for tag_nome in select distinct btrim(value) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '' loop
        insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
        insert into public.lead_tags (lead_id, tag_id)
        select lead, id from public.tags where lower(nome) = lower(tag_nome)
        on conflict do nothing;
      end loop;
    end if;

    -- mensagem do contato em lead já existente = "lead respondeu" (pausa a cadência; Novo lead → Em qualificação).
    -- call_log e afins não contam.
    -- "lead respondeu" só quando o POST veio de uma mensagem do contato (diálogos executados pela equipe
    -- mandam origem_execucao = 'equipe' na URL ou o campo executado_por vazio)
    if existia and coalesce(p ->> 'tipo_mensagem', 'chat') not in ('call_log') and coalesce(p ->> '_origem', '') <> 'equipe' then
      perform public.lead_respondeu(lead, case when (p ->> 'datetime_post') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (p ->> 'datetime_post')::timestamptz else now() end);
    end if;

    update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
    return jsonb_build_object('ok', true, 'lead_id', lead, 'meta', m, 'respondeu', existia);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end;
$$;
revoke all on function public.chatguru_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.chatguru_webhook(jsonb) to service_role;


select 'ok 0078' as resultado;


-- ===== 0079_atendimento_whatsapp.sql =====
-- 0079 — Atendimento (WhatsApp) dentro do sistema: filas (setores) administradas pelos admins, conversas por contato
-- (ChatGuru por baixo: entrada pelo webhook, saída pela API), mensagens recebidas/enviadas, notas internas só da equipe,
-- eventos (assumida, transferida, resolvida, reaberta), respostas rápidas e SLA em horário comercial.
-- Decisões (23/10/2026): toda conversa nova começa na fila Comercial e é transferida manualmente; administradores
-- veem tudo, colaboradores só as filas em que forem incluídos (ou cuja área tenham); o sistema recebe 24h, o SLA conta
-- só em horário comercial. Idempotente. Depende de 0078.

-- ---------- filas ----------
create table if not exists public.atd_filas (
  id serial primary key,
  nome text not null,
  slug text not null unique,
  cor text not null default '#B8964A',
  ordem integer not null default 0,
  ativa boolean not null default true,
  areas text[] not null default '{}',          -- quem tem alguma dessas áreas (perfis.acessos) vê a fila
  membros uuid[] not null default '{}',        -- inclusão manual pelos administradores
  sla_primeira_resposta_min integer not null default 15,
  sla_resolucao_horas integer not null default 24,
  mensagem_boas_vindas text,
  mensagem_encerramento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.atd_filas (nome, slug, cor, ordem, areas) values
  ('Comercial',  'comercial',  '#2E7D5B', 1, '{comercial}'),
  ('Financeiro', 'financeiro', '#B8964A', 2, '{financeiro}'),
  ('Jurídico',   'juridico',   '#0C1F38', 3, '{juridico}'),
  ('Pós-vendas', 'pos_vendas', '#6A4C93', 4, '{}')
on conflict (slug) do nothing;

-- ---------- conversas ----------
create sequence if not exists public.atd_protocolo_seq;
create table if not exists public.atd_conversas (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique default (to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMM') || '-' || lpad(nextval('public.atd_protocolo_seq')::text, 5, '0')),
  chatguru_chat_id text unique,
  whatsapp text,
  whatsapp_normalizado text,
  nome_contato text,
  link_chat text,
  cliente_id text references public.clientes (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  fila_id integer references public.atd_filas (id) on delete set null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  status text not null default 'nova' check (status in ('nova','aguardando','em_atendimento','pendente_contato','resolvida')),
  aberta_em timestamptz not null default now(),
  primeira_resposta_em timestamptz,
  sla_resposta_ate timestamptz,                 -- limite da 1ª resposta (horário comercial)
  ultima_msg_em timestamptz,
  ultima_msg_contato_em timestamptz,
  ultima_msg_texto text,
  resolvida_em timestamptz,
  resolvida_por uuid references public.perfis (id) on delete set null,
  nao_lidas integer not null default 0,
  tags text[] not null default '{}',
  campos jsonb not null default '{}',           -- campos personalizados do ChatGuru (último payload)
  responsavel_chatguru text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists atd_conversas_fila_idx on public.atd_conversas (fila_id, status, ultima_msg_em desc);
create index if not exists atd_conversas_resp_idx on public.atd_conversas (responsavel_id, status);
create index if not exists atd_conversas_wa_idx on public.atd_conversas (whatsapp_normalizado);
create index if not exists atd_conversas_cliente_idx on public.atd_conversas (cliente_id);
create index if not exists atd_conversas_lead_idx on public.atd_conversas (lead_id);

-- ---------- mensagens ----------
create table if not exists public.atd_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.atd_conversas (id) on delete cascade,
  direcao text not null check (direcao in ('in','out','nota','sistema')),
  tipo text not null default 'chat',            -- chat | image | audio | video | document | sticker | call_log | sistema
  texto text,
  arquivo_url text,                             -- URL original do ChatGuru (pode expirar)
  arquivo_path text,                            -- cópia no bucket 'atendimento'
  arquivo_nome text,
  mime text,
  autor_id uuid references public.perfis (id) on delete set null,
  autor_nome text,
  status_envio text check (status_envio in ('enviando','enviada','erro')),
  erro text,
  chatguru_ref text,
  payload jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists atd_mensagens_conv_idx on public.atd_mensagens (conversa_id, criado_em);

-- ---------- eventos ----------
create table if not exists public.atd_eventos (
  id bigserial primary key,
  conversa_id uuid not null references public.atd_conversas (id) on delete cascade,
  tipo text not null,                           -- aberta | assumida | transferida | fila | resolvida | reaberta | vinculada | status
  de text, para text,
  por uuid references public.perfis (id) on delete set null,
  por_nome text,
  em timestamptz not null default now()
);
create index if not exists atd_eventos_conv_idx on public.atd_eventos (conversa_id, em);

-- ---------- respostas rápidas ----------
create table if not exists public.atd_respostas_rapidas (
  id serial primary key,
  titulo text not null,
  atalho text not null,
  texto text not null,
  fila_id integer references public.atd_filas (id) on delete cascade,  -- null = todas
  ativa boolean not null default true,
  criado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- quem vê o quê ----------
create or replace function public.atd_ve_fila(p_fila integer) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sou_admin()
      or exists (select 1 from public.atd_filas f join public.perfis p on p.id = auth.uid()
                  where f.id = p_fila and (auth.uid() = any(f.membros) or coalesce(p.acessos, '{}') && f.areas));
$$;
create or replace function public.atd_minhas_filas() returns setof integer
language sql stable security definer set search_path = public as $$
  select f.id from public.atd_filas f join public.perfis p on p.id = auth.uid()
   where f.ativa and (public.sou_admin() or auth.uid() = any(f.membros) or coalesce(p.acessos, '{}') && f.areas);
$$;
create or replace function public.atd_ve_conversa(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.atd_conversas c where c.id = p_conv
                   and (public.sou_admin() or c.responsavel_id = auth.uid() or public.atd_ve_fila(c.fila_id)));
$$;

alter table public.atd_filas enable row level security;
alter table public.atd_conversas enable row level security;
alter table public.atd_mensagens enable row level security;
alter table public.atd_eventos enable row level security;
alter table public.atd_respostas_rapidas enable row level security;
drop policy if exists atd_filas_sel on public.atd_filas;
create policy atd_filas_sel on public.atd_filas for select to authenticated using (public.sou_equipe());
drop policy if exists atd_filas_adm on public.atd_filas;
create policy atd_filas_adm on public.atd_filas for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists atd_conv_sel on public.atd_conversas;
create policy atd_conv_sel on public.atd_conversas for select to authenticated using (public.sou_equipe() and (public.sou_admin() or responsavel_id = auth.uid() or public.atd_ve_fila(fila_id)));
drop policy if exists atd_conv_upd on public.atd_conversas;
create policy atd_conv_upd on public.atd_conversas for update to authenticated using (public.sou_equipe() and (public.sou_admin() or responsavel_id = auth.uid() or public.atd_ve_fila(fila_id))) with check (public.sou_equipe());
drop policy if exists atd_msg_sel on public.atd_mensagens;
create policy atd_msg_sel on public.atd_mensagens for select to authenticated using (public.sou_equipe() and public.atd_ve_conversa(conversa_id));
drop policy if exists atd_msg_ins on public.atd_mensagens;
create policy atd_msg_ins on public.atd_mensagens for insert to authenticated with check (public.sou_equipe() and public.atd_ve_conversa(conversa_id) and direcao in ('out','nota'));
drop policy if exists atd_msg_upd on public.atd_mensagens;
create policy atd_msg_upd on public.atd_mensagens for update to authenticated using (public.sou_equipe() and autor_id = auth.uid()) with check (public.sou_equipe());
drop policy if exists atd_ev_sel on public.atd_eventos;
create policy atd_ev_sel on public.atd_eventos for select to authenticated using (public.sou_equipe() and public.atd_ve_conversa(conversa_id));
drop policy if exists atd_rr_sel on public.atd_respostas_rapidas;
create policy atd_rr_sel on public.atd_respostas_rapidas for select to authenticated using (public.sou_equipe());
drop policy if exists atd_rr_adm on public.atd_respostas_rapidas;
create policy atd_rr_adm on public.atd_respostas_rapidas for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select on public.atd_filas, public.atd_conversas, public.atd_mensagens, public.atd_eventos, public.atd_respostas_rapidas to authenticated;
grant insert, update, delete on public.atd_filas, public.atd_respostas_rapidas to authenticated;
grant update on public.atd_conversas to authenticated;
grant insert, update on public.atd_mensagens to authenticated;
grant usage on sequence public.atd_protocolo_seq to authenticated;
grant usage, select on sequence public.atd_filas_id_seq, public.atd_respostas_rapidas_id_seq to authenticated;

-- bucket privado para as mídias recebidas (URL assinada ao exibir)
insert into storage.buckets (id, name, public, file_size_limit) values ('atendimento', 'atendimento', false, 52428800) on conflict (id) do nothing;
drop policy if exists atendimento_storage_equipe on storage.objects;
create policy atendimento_storage_equipe on storage.objects for select to authenticated
  using (bucket_id = 'atendimento' and public.sou_equipe());

-- ---------- SLA em horário comercial ----------
-- prazo = base + minutos, contando só seg–sex 8h–18h (BRT) em dias úteis; fora do expediente, começa no próximo
create or replace function public.atd_prazo(base timestamptz, minutos integer) returns timestamptz
language plpgsql stable set search_path = public as $$
declare t timestamp := base at time zone 'America/Sao_Paulo'; resto integer := greatest(minutos, 0); fim timestamp;
begin
  loop
    if not public.cadencia_dia_util(t::date) or t::time >= '18:00' then
      t := (t::date + 1)::timestamp + interval '8 hours'; continue;
    end if;
    if t::time < '08:00' then t := t::date::timestamp + interval '8 hours'; end if;
    fim := t::date::timestamp + interval '18 hours';
    if t + make_interval(mins => resto) <= fim then
      return (t + make_interval(mins => resto)) at time zone 'America/Sao_Paulo';
    end if;
    resto := resto - (extract(epoch from (fim - t)) / 60)::integer;
    t := (t::date + 1)::timestamp + interval '8 hours';
  end loop;
end $$;

-- ---------- utilitários ----------
create or replace function public.atd_evento(p_conv uuid, p_tipo text, p_de text, p_para text) returns void
language sql security definer set search_path = public as $$
  insert into public.atd_eventos (conversa_id, tipo, de, para, por, por_nome)
  values (p_conv, p_tipo, p_de, p_para, auth.uid(), public.nome_perfil(auth.uid()));
$$;
create or replace function public.atd_fila_padrao() returns integer
language sql stable set search_path = public as $$
  select coalesce((select id from public.atd_filas where slug = 'comercial'), (select id from public.atd_filas where ativa order by ordem limit 1));
$$;

-- ---------- entrada: chamada pelo webhook do ChatGuru ----------
create or replace function public.atd_receber(p jsonb, p_lead uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  chave text := public.normalizar_whatsapp(p ->> 'celular');
  chat text := nullif(p ->> 'chat_id', '');
  conv public.atd_conversas;
  tipo text := coalesce(nullif(p ->> 'tipo_mensagem', ''), 'chat');
  texto text := left(nullif(btrim(coalesce(p ->> 'texto_mensagem', '')), ''), 4000);
  url text := nullif(p ->> 'url_arquivo', '');
  quando timestamptz := now();   -- o webhook chega em tempo real; datetime_post (sem fuso) fica no payload
  cid text;
  msg uuid;
  fila integer;
  resp uuid;
  reaberta boolean := false;
begin
  if coalesce(p ->> '_origem', '') = 'equipe' then return jsonb_build_object('ok', true, 'ignorado', 'equipe'); end if;
  if chave is null and chat is null then return jsonb_build_object('ok', false, 'erro', 'sem celular/chat_id'); end if;

  select * into conv from public.atd_conversas where (chat is not null and chatguru_chat_id = chat) or (chat is null and whatsapp_normalizado = chave)
   order by (status <> 'resolvida') desc, ultima_msg_em desc nulls last limit 1;

  -- cliente pelo telefone (cadastro do cliente ou contato)
  select c.id into cid from public.clientes c where public.normalizar_whatsapp(c.telefone) = chave limit 1;
  if cid is null then select ct.cliente_id into cid from public.contatos ct where public.normalizar_whatsapp(ct.telefone) = chave limit 1; end if;
  -- responsável do ChatGuru → perfil (por e-mail)
  select id into resp from public.perfis where email is not null and lower(email) = lower(nullif(p ->> 'responsavel_email', '')) and papel in ('admin','colaborador') limit 1;

  if conv.id is null then
    fila := public.atd_fila_padrao();
    insert into public.atd_conversas (chatguru_chat_id, whatsapp, whatsapp_normalizado, nome_contato, link_chat, cliente_id, lead_id, fila_id, responsavel_id,
                                      status, aberta_em, sla_resposta_ate, ultima_msg_em, ultima_msg_contato_em, ultima_msg_texto, nao_lidas, tags, campos, responsavel_chatguru)
    values (chat, p ->> 'celular', chave, coalesce(nullif(p ->> 'nome', ''), p ->> 'celular'), nullif(p ->> 'link_chat', ''), cid, p_lead, fila, null,
            'nova', quando, public.atd_prazo(quando, (select sla_primeira_resposta_min from public.atd_filas where id = fila)), quando, quando,
            coalesce(texto, '[' || tipo || ']'), 1,
            coalesce((select array_agg(btrim(value)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'tags') = 'array' then p -> 'tags' else '[]'::jsonb end) where btrim(value) <> ''), '{}'),
            coalesce(case when jsonb_typeof(p -> 'campos_personalizados') = 'object' then p -> 'campos_personalizados' end, '{}'::jsonb),
            nullif(p ->> 'responsavel_nome', ''))
    returning * into conv;
    insert into public.atd_eventos (conversa_id, tipo, para) values (conv.id, 'aberta', (select nome from public.atd_filas where id = fila));
  else
    if conv.status = 'resolvida' then
      reaberta := true;
      update public.atd_conversas set status = 'nova', aberta_em = quando, primeira_resposta_em = null, resolvida_em = null, resolvida_por = null,
             fila_id = coalesce(fila_id, public.atd_fila_padrao()),
             sla_resposta_ate = public.atd_prazo(quando, coalesce((select sla_primeira_resposta_min from public.atd_filas where id = conv.fila_id), 15))
       where id = conv.id;
      insert into public.atd_eventos (conversa_id, tipo) values (conv.id, 'reaberta');
    elsif conv.status in ('em_atendimento','pendente_contato') then
      update public.atd_conversas set status = 'aguardando' where id = conv.id;
    end if;
    update public.atd_conversas set
      chatguru_chat_id = coalesce(chatguru_chat_id, chat),
      whatsapp = coalesce(whatsapp, p ->> 'celular'), whatsapp_normalizado = coalesce(whatsapp_normalizado, chave),
      nome_contato = coalesce(nullif(p ->> 'nome', ''), nome_contato),
      link_chat = coalesce(nullif(p ->> 'link_chat', ''), link_chat),
      cliente_id = coalesce(cliente_id, cid), lead_id = coalesce(lead_id, p_lead),
      ultima_msg_em = quando, ultima_msg_contato_em = quando, ultima_msg_texto = coalesce(texto, '[' || tipo || ']'),
      nao_lidas = nao_lidas + 1,
      tags = coalesce((select array_agg(btrim(value)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'tags') = 'array' then p -> 'tags' else '[]'::jsonb end) where btrim(value) <> ''), tags),
      campos = coalesce(case when jsonb_typeof(p -> 'campos_personalizados') = 'object' then p -> 'campos_personalizados' end, campos),
      responsavel_chatguru = coalesce(nullif(p ->> 'responsavel_nome', ''), responsavel_chatguru),
      updated_at = now()
     where id = conv.id returning * into conv;
  end if;

  insert into public.atd_mensagens (conversa_id, direcao, tipo, texto, arquivo_url, autor_nome, criado_em, payload)
  values (conv.id, 'in', tipo, texto, url, conv.nome_contato, quando,
          jsonb_build_object('responsavel_nome', p ->> 'responsavel_nome', 'bsuid', p ->> 'bsuid', 'datetime_post', p ->> 'datetime_post'))
  returning id into msg;

  -- aviso: para o responsável, ou para todos da fila quando não há responsável
  if conv.responsavel_id is not null then
    perform public.notificar(conv.responsavel_id, 'Nova mensagem · ' || coalesce(conv.nome_contato, ''), left(coalesce(texto, '[' || tipo || ']'), 140), '#atendimento/' || conv.id);
  else
    perform public.notificar(p.id, 'Atendimento · ' || coalesce((select nome from public.atd_filas where id = conv.fila_id), 'fila'), coalesce(conv.nome_contato, '') || ': ' || left(coalesce(texto, '[' || tipo || ']'), 120), '#atendimento/' || conv.id)
      from public.perfis p join public.atd_filas f on f.id = conv.fila_id
     where p.papel in ('admin','colaborador') and (p.id = any(f.membros) or coalesce(p.acessos, '{}') && f.areas);
  end if;

  return jsonb_build_object('ok', true, 'conversa_id', conv.id, 'mensagem_id', msg, 'reaberta', reaberta, 'tem_arquivo', url is not null);
end $$;
revoke all on function public.atd_receber(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.atd_receber(jsonb, uuid) to service_role;

-- o webhook do ChatGuru passa a registrar a conversa (sem quebrar o fluxo do lead se algo falhar)
create or replace function public.chatguru_webhook(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id bigint;
  chave text;
  lead uuid;
  tag_nome text;
  email_recebido text;
  mensagem text;
  m jsonb;
  existia boolean := false;
  atd jsonb := '{}'::jsonb;
begin
  insert into public.webhook_logs (payload) values (p) returning id into log_id;

  begin
    chave := public.normalizar_whatsapp(p ->> 'celular');
    if chave is null then
      raise exception 'Payload sem celular.';
    end if;

    email_recebido := nullif(p ->> 'email', '');
    if email_recebido like '%@c.us' then
      email_recebido := null;
    end if;

    mensagem := left(coalesce(
      nullif(btrim(p ->> 'texto_mensagem'), ''),
      nullif(btrim(p ->> 'mensagem'), ''),
      nullif(btrim(p ->> 'ultima_mensagem'), '')
    ), 2000);

    m := public.meta_ids_de_chatguru(p);

    select id into lead from public.leads where whatsapp_normalizado = chave;

    if lead is null then
      insert into public.leads (
        nome, email, whatsapp, campanha, publico, anuncio, link_chat, chatguru_chat_id, responsavel_chatguru, origem,
        ultima_mensagem, ultima_interacao_em,
        meta_ad_id, meta_adset_id, meta_campaign_id, meta_ctwa_clid, meta_source_url, meta_headline
      )
      values (
        coalesce(nullif(p ->> 'nome', ''), 'Sem nome'),
        email_recebido,
        p ->> 'celular',
        case when m ?| array['ad_id','adset_id','campaign_id'] then m ->> 'campaign_name' else coalesce(m ->> 'campaign_name', nullif(p ->> 'campanha_nome', '')) end,
        m ->> 'adset_name',
        coalesce(m ->> 'ad_name', m ->> 'headline'),
        nullif(p ->> 'link_chat', ''),
        nullif(p ->> 'chat_id', ''),
        nullif(p ->> 'responsavel_nome', ''),
        'chatguru',
        mensagem,
        now(),
        m ->> 'ad_id', m ->> 'adset_id', m ->> 'campaign_id', m ->> 'ctwa_clid', m ->> 'source_url', m ->> 'headline'
      ) returning id into lead;
    else
      existia := true;
      update public.leads set
        nome                 = coalesce(nullif(nome, ''), nullif(p ->> 'nome', ''), nome),
        email                = coalesce(email, email_recebido),
        campanha             = coalesce(nullif(campanha, ''), m ->> 'campaign_name', case when m ?| array['ad_id','adset_id','campaign_id'] then null else nullif(p ->> 'campanha_nome', '') end),
        publico              = coalesce(nullif(publico, ''), m ->> 'adset_name'),
        anuncio              = coalesce(nullif(anuncio, ''), m ->> 'ad_name', m ->> 'headline'),
        link_chat            = coalesce(nullif(p ->> 'link_chat', ''), link_chat),
        chatguru_chat_id     = coalesce(nullif(p ->> 'chat_id', ''), chatguru_chat_id),
        responsavel_chatguru = coalesce(nullif(p ->> 'responsavel_nome', ''), responsavel_chatguru),
        ultima_mensagem      = coalesce(mensagem, ultima_mensagem),
        ultima_interacao_em  = now(),
        meta_ad_id           = coalesce(meta_ad_id, m ->> 'ad_id'),
        meta_adset_id        = coalesce(meta_adset_id, m ->> 'adset_id'),
        meta_campaign_id     = coalesce(meta_campaign_id, m ->> 'campaign_id'),
        meta_ctwa_clid       = coalesce(meta_ctwa_clid, m ->> 'ctwa_clid'),
        meta_source_url      = coalesce(meta_source_url, m ->> 'source_url'),
        meta_headline        = coalesce(meta_headline, m ->> 'headline')
      where id = lead;
    end if;

    perform public.leads_completar_meta(lead);

    if jsonb_typeof(p -> 'tags') = 'array' then
      delete from public.lead_tags lt using public.tags t
       where lt.lead_id = lead and t.id = lt.tag_id
         and lower(t.nome) not in (select lower(btrim(value)) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '');
      for tag_nome in select distinct btrim(value) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '' loop
        insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
        insert into public.lead_tags (lead_id, tag_id)
        select lead, id from public.tags where lower(nome) = lower(tag_nome)
        on conflict do nothing;
      end loop;
    end if;

    if existia and coalesce(p ->> 'tipo_mensagem', 'chat') not in ('call_log') and coalesce(p ->> '_origem', '') <> 'equipe' then
      perform public.lead_respondeu(lead, case when (p ->> 'datetime_post') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (p ->> 'datetime_post')::timestamptz else now() end);
    end if;

    -- Atendimento: registra a conversa/mensagem (falha aqui não derruba o lead)
    begin
      atd := public.atd_receber(p, lead);
    exception when others then
      atd := jsonb_build_object('ok', false, 'erro', sqlerrm);
    end;

    update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
    return jsonb_build_object('ok', true, 'lead_id', lead, 'meta', m, 'respondeu', existia, 'atd', atd);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end;
$$;
revoke all on function public.chatguru_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.chatguru_webhook(jsonb) to service_role;

-- ---------- ações da equipe ----------
-- registra a mensagem de saída (a Edge envia pelo ChatGuru e marca enviada/erro)
create or replace function public.atd_mensagem_out(p_conv uuid, p_texto text, p_nota boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare msg uuid; conv public.atd_conversas; eu uuid := auth.uid();
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso a esta conversa.'; end if;
  select * into conv from public.atd_conversas where id = p_conv;
  insert into public.atd_mensagens (conversa_id, direcao, tipo, texto, autor_id, autor_nome, status_envio)
  values (p_conv, case when p_nota then 'nota' else 'out' end, 'chat', left(p_texto, 4000), eu, public.nome_perfil(eu), case when p_nota then null else 'enviando' end)
  returning id into msg;
  if not p_nota then
    update public.atd_conversas set
      responsavel_id = coalesce(responsavel_id, eu),
      status = case when status in ('nova','aguardando') then 'em_atendimento' else status end,
      primeira_resposta_em = coalesce(primeira_resposta_em, now()),
      ultima_msg_em = now(), ultima_msg_texto = left(p_texto, 200), nao_lidas = 0, updated_at = now()
     where id = p_conv;
    if conv.responsavel_id is null then perform public.atd_evento(p_conv, 'assumida', null, public.nome_perfil(eu)); end if;
  end if;
  return msg;
end $$;
grant execute on function public.atd_mensagem_out(uuid, text, boolean) to authenticated;

create or replace function public.atd_marcar_envio(p_msg uuid, p_ok boolean, p_erro text, p_ref text) returns void
language sql security definer set search_path = public as $$
  update public.atd_mensagens set status_envio = case when p_ok then 'enviada' else 'erro' end, erro = p_erro, chatguru_ref = coalesce(p_ref, chatguru_ref)
   where id = p_msg and (autor_id = auth.uid() or auth.role() = 'service_role');
$$;
grant execute on function public.atd_marcar_envio(uuid, boolean, text, text) to authenticated, service_role;

create or replace function public.atd_assumir(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); antes text;
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  select public.nome_perfil(responsavel_id) into antes from public.atd_conversas where id = p_conv;
  update public.atd_conversas set responsavel_id = eu, status = case when status = 'nova' then 'aguardando' else status end, nao_lidas = 0, updated_at = now() where id = p_conv;
  perform public.atd_evento(p_conv, 'assumida', antes, public.nome_perfil(eu));
end $$;
grant execute on function public.atd_assumir(uuid) to authenticated;

-- transferir: para uma fila (sem responsável) e/ou para uma pessoa
create or replace function public.atd_transferir(p_conv uuid, p_fila integer, p_responsavel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.atd_conversas; fila_nome text; nova_fila integer;
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  select * into c from public.atd_conversas where id = p_conv;
  nova_fila := coalesce(p_fila, c.fila_id);
  update public.atd_conversas set fila_id = nova_fila, responsavel_id = p_responsavel,
         status = case when p_responsavel is null then 'aguardando' when status = 'nova' then 'aguardando' else status end,
         sla_resposta_ate = case when primeira_resposta_em is null then public.atd_prazo(now(), (select sla_primeira_resposta_min from public.atd_filas where id = nova_fila)) else sla_resposta_ate end,
         updated_at = now()
   where id = p_conv;
  if p_fila is not null and p_fila is distinct from c.fila_id then
    perform public.atd_evento(p_conv, 'fila', (select nome from public.atd_filas where id = c.fila_id), (select nome from public.atd_filas where id = p_fila));
  end if;
  if p_responsavel is distinct from c.responsavel_id then
    perform public.atd_evento(p_conv, 'transferida', public.nome_perfil(c.responsavel_id), coalesce(public.nome_perfil(p_responsavel), 'fila'));
    if p_responsavel is not null then
      perform public.notificar(p_responsavel, 'Conversa transferida para você', coalesce(c.nome_contato, '') || ' · ' || c.protocolo, '#atendimento/' || p_conv);
    end if;
  end if;
  if p_responsavel is null then
    perform public.notificar(p.id, 'Conversa na fila ' || f.nome, coalesce(c.nome_contato, '') || ' · ' || c.protocolo, '#atendimento/' || p_conv)
      from public.perfis p join public.atd_filas f on f.id = nova_fila
     where p.papel in ('admin','colaborador') and (p.id = any(f.membros) or coalesce(p.acessos, '{}') && f.areas);
  end if;
end $$;
grant execute on function public.atd_transferir(uuid, integer, uuid) to authenticated;

create or replace function public.atd_status(p_conv uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare antes text;
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  if p_status not in ('aguardando','em_atendimento','pendente_contato','resolvida') then raise exception 'Status inválido.'; end if;
  select status into antes from public.atd_conversas where id = p_conv;
  update public.atd_conversas set status = p_status,
         resolvida_em = case when p_status = 'resolvida' then now() else null end,
         resolvida_por = case when p_status = 'resolvida' then auth.uid() else null end,
         nao_lidas = 0, updated_at = now()
   where id = p_conv;
  perform public.atd_evento(p_conv, case when p_status = 'resolvida' then 'resolvida' else 'status' end, antes, p_status);
end $$;
grant execute on function public.atd_status(uuid, text) to authenticated;

create or replace function public.atd_lida(p_conv uuid) returns void
language sql security definer set search_path = public as $$
  update public.atd_conversas set nao_lidas = 0 where id = p_conv and public.atd_ve_conversa(p_conv);
$$;
grant execute on function public.atd_lida(uuid) to authenticated;

create or replace function public.atd_vincular(p_conv uuid, p_cliente text, p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  update public.atd_conversas set cliente_id = coalesce(p_cliente, cliente_id), lead_id = coalesce(p_lead, lead_id), updated_at = now() where id = p_conv;
  perform public.atd_evento(p_conv, 'vinculada', null, coalesce((select dados ->> 'nome' from public.clientes where id = p_cliente), (select nome from public.leads where id = p_lead)));
end $$;
grant execute on function public.atd_vincular(uuid, text, uuid) to authenticated;

-- ---------- views ----------
create or replace view public.v_atd_conversas with (security_invoker = true) as
select c.*,
       f.nome as fila_nome, f.cor as fila_cor, f.slug as fila_slug,
       public.nome_perfil(c.responsavel_id) as responsavel_nome,
       cl.dados ->> 'nome' as cliente_nome,
       l.nome as lead_nome, l.fase_id as lead_fase_id,
       case when c.status = 'resolvida' then null
            when c.primeira_resposta_em is null and c.sla_resposta_ate < now() then 'vencido'
            when c.primeira_resposta_em is null and c.sla_resposta_ate < now() + interval '5 minutes' then 'quase'
            when c.primeira_resposta_em is null then 'no_prazo'
            else 'respondida' end as sla,
       (select count(*) from public.atd_conversas c2 where c2.whatsapp_normalizado = c.whatsapp_normalizado and c2.id <> c.id) as conversas_anteriores
  from public.atd_conversas c
  left join public.atd_filas f on f.id = c.fila_id
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.leads l on l.id = c.lead_id;
grant select on public.v_atd_conversas to authenticated;

create or replace view public.v_atd_filas_resumo with (security_invoker = true) as
select f.id, f.nome, f.slug, f.cor, f.ordem, f.ativa, f.areas, f.membros, f.sla_primeira_resposta_min, f.sla_resolucao_horas,
       count(c.id) filter (where c.status <> 'resolvida') as abertas,
       count(c.id) filter (where c.status <> 'resolvida' and c.responsavel_id is null) as sem_responsavel,
       count(c.id) filter (where c.status <> 'resolvida' and c.primeira_resposta_em is null and c.sla_resposta_ate < now()) as sla_vencido,
       coalesce(sum(c.nao_lidas) filter (where c.status <> 'resolvida'), 0) as nao_lidas,
       count(c.id) filter (where c.resolvida_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as resolvidas_hoje,
       round(avg(extract(epoch from (c.primeira_resposta_em - c.aberta_em)) / 60) filter (where c.primeira_resposta_em is not null and c.aberta_em > now() - interval '30 days'))::integer as media_primeira_resposta_min,
       round(avg(extract(epoch from (c.resolvida_em - c.aberta_em)) / 3600) filter (where c.resolvida_em is not null and c.aberta_em > now() - interval '30 days'), 1) as media_resolucao_h
  from public.atd_filas f
  left join public.atd_conversas c on c.fila_id = f.id
 group by f.id;
grant select on public.v_atd_filas_resumo to authenticated;

-- equipe disponível para transferência (quem vê a fila)
create or replace function public.atd_equipe_fila(p_fila integer) returns table (id uuid, nome text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(public.nome_perfil(p.id), p.email), p.email
    from public.perfis p left join public.atd_filas f on f.id = p_fila
   where p.papel in ('admin','colaborador') and public.sou_equipe()
     and (p.papel = 'admin' or f.id is null or p.id = any(f.membros) or coalesce(p.acessos, '{}') && f.areas)
   order by 2;
$$;
grant execute on function public.atd_equipe_fila(integer) to authenticated;

-- realtime
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.atd_conversas; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.atd_mensagens; exception when duplicate_object then null; end;
  end if;
end $$;

select 'ok 0079' as resultado;


select 'ok parte 9/9' as resultado;
