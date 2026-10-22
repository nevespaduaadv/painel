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
