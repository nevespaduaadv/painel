-- 0073 — Cadências comerciais (SDR e closer) como tarefas do lead, conforme "Cadências de Follow-up — SDR" (v1)
-- e "Cadências de Follow-up — Closer" (12/10/2026), validados pela Ana Júlia em 20/10/2026.
--   C1 Novo lead + Em qualificação (D1–D32) · C2 Qualificado + No-show (D1–D40) · C3 Proposta enviada (D1–D18)
--   C4 Contrato enviado (D1–D14) · C5 Pagamento pendente (D1–D10)
-- Regras: D0 = entrada na etapa; pausa quando o lead responde (webhook do ChatGuru → lead_respondeu); retoma 24 h depois
-- no passo seguinte (nunca volta ao D1); zera só na troca de cadência; encerra ao sair das etapas da cadência ou no último
-- passo; tarefas só em dias úteis (seg–sex, sem feriado) e horário comercial. Nada é enviado automaticamente — o sistema
-- cria a tarefa com dia, canal e ação; o texto é escrito caso a caso (exceção: D1 do No-show, assinalado na tarefa).
-- Idempotente. Depende de 0030 (lead_tarefas, fases) e 0037 (feriados).

-- ---------- catálogo ----------
create table if not exists public.cadencias (
  id integer primary key,
  nome text not null,
  dono text not null check (dono in ('sdr','closer')),
  fases integer[] not null,          -- etapas em que a cadência roda
  inicio text not null default 'dia_seguinte' check (inicio in ('dia_seguinte','apos_24h','imediato')),
  descricao text
);
create table if not exists public.cadencia_passos (
  cadencia_id integer not null references public.cadencias (id) on delete cascade,
  passo integer not null,
  dia integer not null,              -- D1, D2… (passos, não dias corridos: a contagem segue após uma pausa)
  titulo text not null,
  detalhe text,
  tipo text not null default 'whatsapp' check (tipo in ('ligar','whatsapp','social_selling','follow_up','tarefa')),
  ligacoes integer not null default 0,
  tecnica boolean not null default false,  -- áudio mudo, mensagem apagada, DM/story: leva a observação de não repetição
  primary key (cadencia_id, passo)
);
alter table public.cadencias enable row level security;
alter table public.cadencia_passos enable row level security;
drop policy if exists "cadencias: ver" on public.cadencias;
create policy "cadencias: ver" on public.cadencias for select to authenticated using (public.sou_equipe());
drop policy if exists "cadencias: admin" on public.cadencias;
create policy "cadencias: admin" on public.cadencias for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists "cadencia_passos: ver" on public.cadencia_passos;
create policy "cadencia_passos: ver" on public.cadencia_passos for select to authenticated using (public.sou_equipe());
drop policy if exists "cadencia_passos: admin" on public.cadencia_passos;
create policy "cadencia_passos: admin" on public.cadencia_passos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.cadencias, public.cadencia_passos from anon;

insert into public.cadencias (id, nome, dono, fases, inicio, descricao) values
  (1, 'Cadência 1 — Novo lead e Em qualificação', 'sdr',    array[1,2], 'dia_seguinte', 'Roda enquanto o lead estiver em Novo lead ou Em qualificação; a troca entre elas não zera a contagem.'),
  (2, 'Cadência 2 — Qualificado e No-show',       'sdr',    array[3,5], 'apos_24h',     'Inicia 24 h sem resposta após entrar em Qualificado. No No-show começa na hora, com a mensagem de gancho da ausência.'),
  (3, 'Cadência 3 — Proposta enviada',            'closer', array[7],   'dia_seguinte', 'Objetivo: obter um sim ou um não explícito. D0 = envio da proposta.'),
  (4, 'Cadência 4 — Contrato enviado',            'closer', array[8],   'dia_seguinte', 'Objetivo: assinatura. D0 = envio do contrato.'),
  (5, 'Cadência 5 — Pagamento pendente',          'closer', array[9],   'dia_seguinte', 'Objetivo: entrada paga. D0 = geração do boleto da entrada.')
on conflict (id) do update set nome = excluded.nome, dono = excluded.dono, fases = excluded.fases, inicio = excluded.inicio, descricao = excluded.descricao;

delete from public.cadencia_passos;
insert into public.cadencia_passos (cadencia_id, passo, dia, titulo, detalhe, tipo, ligacoes, tecnica) values
  -- C1
  (1, 1,  1,  'Mensagem no WhatsApp + 5 tentativas de ligação', '2× WhatsApp e 3× API4com, distribuídas entre manhã e tarde.', 'whatsapp', 5, false),
  (1, 2,  2,  'Mensagem curta em formato de pergunta + 5 tentativas de ligação', 'Ex.: "oi?", "[Nome]?".', 'whatsapp', 5, false),
  (1, 3,  3,  'Instagram: seguir + curtir publicações · áudio de ~10 s no WhatsApp', 'Áudio abordando os bancos.', 'social_selling', 0, false),
  (1, 4,  6,  'Prova social + 5 tentativas de ligação', 'Acordo fechado com banco, dados anonimizados, destaque apenas nos valores.', 'whatsapp', 5, false),
  (1, 5,  9,  'DM no Instagram + áudio no WhatsApp', null, 'social_selling', 0, true),
  (1, 6,  10, '5 mensagens escritas e apagadas + 5 tentativas de ligação', null, 'whatsapp', 5, true),
  (1, 7,  17, 'Envio de notícia + 5 tentativas de ligação', null, 'whatsapp', 5, false),
  (1, 8,  20, 'Áudio mudo (~40 s) + áudio "fica bom pra você" + DM "conseguiu ver?"', 'Áudio propondo reunião com a sócia.', 'whatsapp', 0, true),
  (1, 9,  25, 'Mensagem de fechamento de portas', null, 'whatsapp', 0, false),
  (1, 10, 32, 'Encerrar a cadência', 'Registrar o motivo de perda ou mover o lead.', 'follow_up', 0, false),
  -- C2
  (2, 1,  1,  'Mensagem ou áudio personalizado + 5 tentativas de ligação', 'No No-show: mensagem com gancho da ausência, enviada na entrada da etapa.', 'whatsapp', 5, false),
  (2, 2,  2,  'Mensagem ou áudio personalizado + 5 tentativas de ligação', null, 'whatsapp', 5, false),
  (2, 3,  3,  'Mensagem ou áudio personalizado + 5 tentativas de ligação', null, 'whatsapp', 5, false),
  (2, 4,  4,  'Mensagem ou áudio personalizado + 5 tentativas de ligação', null, 'whatsapp', 5, false),
  (2, 5,  5,  'Mensagem ou áudio personalizado + 5 tentativas de ligação', null, 'whatsapp', 5, false),
  (2, 6,  12, 'Envio de notícia + 5 tentativas de ligação', null, 'whatsapp', 5, false),
  (2, 7,  15, 'Mensagem gatilho + curtir foto no Instagram + 2 tentativas de ligação', null, 'social_selling', 2, false),
  (2, 8,  18, 'Áudio mudo', null, 'whatsapp', 0, true),
  (2, 9,  21, '"Agora que vi que meu áudio saiu mudo" + "falei com a sócia" + 2 tentativas pelo WhatsApp', null, 'whatsapp', 2, true),
  (2, 10, 28, 'Interação por DM ou story + 5 tentativas de ligação', null, 'social_selling', 5, true),
  (2, 11, 33, '2 tentativas de ligação pelo WhatsApp + mensagem apagada (reunião de graça)', null, 'whatsapp', 2, true),
  (2, 12, 38, 'Preparação para encerrar', null, 'whatsapp', 0, false),
  (2, 13, 40, 'Encerramento', 'Registrar o motivo de perda ou mover o lead.', 'follow_up', 0, false),
  -- C3
  (3, 1,  1,  'Confirmar recebimento e entendimento da proposta + 2 tentativas de ligação', null, 'whatsapp', 2, false),
  (3, 2,  2,  'Ligação para abrir a objeção real + 2 tentativas', 'Pergunta de consequência, não "passando para saber".', 'ligar', 2, false),
  (3, 3,  4,  'Identificar e envolver quem mais participa da decisão + 2 tentativas', 'Sócio, avalista, cônjuge, contador.', 'whatsapp', 2, false),
  (3, 4,  7,  'Retomar o custo de não agir com dado concreto do caso + 2 tentativas', 'Valor, tempo de atraso, exposição.', 'whatsapp', 2, false),
  (3, 5,  10, 'Oferecer conversa técnica com a sócia + 1 tentativa', 'A conversa precisa acontecer de verdade — não usar como recurso automático.', 'whatsapp', 1, false),
  (3, 6,  14, 'Pedir decisão explícita: sim ou não + 2 tentativas', null, 'whatsapp', 2, false),
  (3, 7,  18, 'Encerrar com motivo registrado ou mover para reativação', null, 'follow_up', 0, false),
  -- C4
  (4, 1,  1,  'Confirmar recebimento e oferecer ler o contrato junto na call + 2 tentativas', null, 'whatsapp', 2, false),
  (4, 2,  2,  '2 tentativas de ligação', null, 'ligar', 2, false),
  (4, 3,  4,  'Verificar dúvida em cláusula específica + 2 tentativas', null, 'whatsapp', 2, false),
  (4, 4,  7,  'Envolver avalista ou segundo decisor, se houver + 1 tentativa', null, 'whatsapp', 1, false),
  (4, 5,  10, 'Confirmar se a condição combinada ainda serve + 1 tentativa', 'Só faz sentido se a condição tiver prazo real.', 'whatsapp', 1, false),
  (4, 6,  14, 'Voltar para Proposta enviada ou encerrar', null, 'follow_up', 0, false),
  -- C5
  (5, 1,  1,  'Confirmar recebimento do boleto + 1 tentativa de ligação', null, 'whatsapp', 1, false),
  (5, 2,  2,  '1 tentativa de ligação', null, 'ligar', 1, false),
  (5, 3,  3,  'Oferecer alternativa de meio ou data de pagamento + 1 tentativa', null, 'whatsapp', 1, false),
  (5, 4,  5,  'Escalar internamente e alinhar condição + 1 tentativa', null, 'tarefa', 1, false),
  (5, 5,  7,  'Reemitir com nova data ou desfazer', null, 'tarefa', 0, false),
  (5, 6,  10, 'Encerrar', 'Registrar o motivo ou mover o lead.', 'follow_up', 0, false);

-- ---------- estado da cadência no lead ----------
alter table public.leads
  add column if not exists cadencia_id integer references public.cadencias (id),
  add column if not exists cadencia_passo integer not null default 0,        -- último passo já lançado como tarefa
  add column if not exists cadencia_proximo_em timestamptz,                   -- quando lançar o próximo passo
  add column if not exists cadencia_pausada_em timestamptz,                   -- lead respondeu
  add column if not exists cadencia_encerrada_em timestamptz,
  add column if not exists ultima_resposta_em timestamptz;                    -- última mensagem do lead (ChatGuru)
alter table public.lead_tarefas
  add column if not exists cadencia_id integer,
  add column if not exists cadencia_passo integer,
  add column if not exists detalhe text;
create index if not exists leads_cadencia_idx on public.leads (cadencia_proximo_em) where cadencia_id is not null and cadencia_encerrada_em is null;

-- ---------- utilitários de calendário (BRT) ----------
create or replace function public.cadencia_dia_util(d date) returns boolean
language sql stable set search_path = public as $$
  select extract(isodow from d) < 6
     and not exists (select 1 from public.feriados f where f.data = d and f.ativo
                       and (f.tipo = 'nacional' or (f.tipo = 'estadual' and f.uf = 'SP') or (f.tipo = 'municipal' and f.comarca ilike 'franca%')));
$$;
-- n dias úteis depois de `base` (n ≥ 1), às 09h de Brasília
create or replace function public.cadencia_somar_dias_uteis(base timestamptz, n integer) returns timestamptz
language plpgsql stable set search_path = public as $$
declare d date := (base at time zone 'America/Sao_Paulo')::date; k integer := greatest(n, 1);
begin
  while k > 0 loop
    d := d + 1;
    if public.cadencia_dia_util(d) then k := k - 1; end if;
  end loop;
  return (d::text || ' 09:00')::timestamp at time zone 'America/Sao_Paulo';
end $$;
create or replace function public.cadencia_horario_comercial() returns boolean
language sql stable set search_path = public as $$
  select public.cadencia_dia_util((now() at time zone 'America/Sao_Paulo')::date)
     and extract(hour from now() at time zone 'America/Sao_Paulo') between 8 and 18;
$$;

create or replace function public.cadencia_da_fase(p_fase integer) returns integer
language sql stable set search_path = public as $$
  select id from public.cadencias where p_fase = any(fases) limit 1;
$$;

-- ---------- início / encerramento (usados pelo gatilho do lead) ----------
create or replace function public.leads_cadencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare nova integer; antiga integer; cad public.cadencias;
begin
  nova := case when new.status = 'Aberto' then public.cadencia_da_fase(new.fase_id) end;
  if tg_op = 'INSERT' and new.origem = 'planilha' then nova := null; end if;   -- importação histórica não dispara cadência
  antiga := case when tg_op = 'UPDATE' then old.cadencia_id end;
  if tg_op = 'UPDATE' and old.cadencia_encerrada_em is not null then antiga := null; end if;
  if nova is distinct from antiga then
    -- encerra a anterior: tarefas abertas dela saem da fila
    if antiga is not null then
      delete from public.lead_tarefas where lead_id = new.id and cadencia_id = antiga and concluida_em is null;
    end if;
    if nova is null then
      if new.cadencia_id is not null and new.cadencia_encerrada_em is null then new.cadencia_encerrada_em := now(); end if;
      new.cadencia_proximo_em := null; new.cadencia_pausada_em := null;
    else
      select * into cad from public.cadencias where id = nova;
      new.cadencia_id := nova; new.cadencia_passo := 0; new.cadencia_pausada_em := null; new.cadencia_encerrada_em := null;
      new.cadencia_proximo_em := case
        when new.fase_id = 5 then now()                                             -- No-show: D1 na entrada da etapa
        when cad.inicio = 'apos_24h' then now() + interval '24 hours'
        when cad.inicio = 'imediato' then now()
        else public.cadencia_somar_dias_uteis(now(), 1) end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_zcadencia on public.leads;
create trigger leads_zcadencia before insert or update of fase_id, status on public.leads
  for each row execute function public.leads_cadencia();

-- auditoria: ignora os campos de controle da cadência
create or replace function public.leads_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  campo text;
  antigo jsonb;
  novo jsonb;
  ignorar text[] := array['updated_at', 'fase_desde', 'whatsapp_normalizado', 'fase_id', 'created_at', 'ultima_mensagem', 'ultima_interacao_em',
                          'cadencia_id', 'cadencia_passo', 'cadencia_proximo_em', 'cadencia_pausada_em', 'cadencia_encerrada_em', 'ultima_resposta_em'];
begin
  if tg_op = 'INSERT' then
    insert into public.historico_fases (lead_id, de_fase_id, para_fase_id, usuario_id)
    values (new.id, null, new.fase_id, auth.uid());
    return new;
  end if;
  if new.fase_id is distinct from old.fase_id then
    insert into public.historico_fases (lead_id, de_fase_id, para_fase_id, usuario_id)
    values (new.id, old.fase_id, new.fase_id, auth.uid());
  end if;
  antigo := to_jsonb(old) - ignorar;
  novo := to_jsonb(new) - ignorar;
  for campo in select jsonb_object_keys(novo) loop
    if (antigo -> campo) is distinct from (novo -> campo) then
      insert into public.leads_auditoria (lead_id, campo, valor_antigo, valor_novo, usuario_id)
      values (new.id, campo, antigo ->> campo, novo ->> campo, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

-- ---------- lead respondeu (ChatGuru → webhook) ----------
create or replace function public.lead_respondeu(p_lead uuid, p_quando timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then return; end if;
  update public.leads set ultima_resposta_em = p_quando,
    cadencia_pausada_em = case when cadencia_id is not null and cadencia_encerrada_em is null then coalesce(cadencia_pausada_em, p_quando) else cadencia_pausada_em end
   where id = p_lead;
  -- tarefas da cadência pendentes do dia são encerradas junto
  if l.cadencia_id is not null and l.cadencia_encerrada_em is null then
    update public.lead_tarefas set concluida_em = now(), detalhe = concat_ws(' · ', detalhe, 'Encerrada automaticamente: o lead respondeu.')
     where lead_id = p_lead and cadencia_id = l.cadencia_id and concluida_em is null
       and (quando at time zone 'America/Sao_Paulo')::date <= (p_quando at time zone 'America/Sao_Paulo')::date;
  end if;
  -- Novo lead que responde passa para Em qualificação (mesma cadência: a posição é mantida)
  if l.status = 'Aberto' and l.fase_id = 1 then
    update public.leads set fase_id = 2 where id = p_lead;
  end if;
end $$;
revoke all on function public.lead_respondeu(uuid, timestamptz) from public, anon;
grant execute on function public.lead_respondeu(uuid, timestamptz) to service_role, authenticated;

-- ---------- processador (pg_cron, a cada 10 min) ----------
create or replace function public.cadencias_processar(p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l record; p public.cadencia_passos; prox public.cadencia_passos; cad public.cadencias;
        criadas integer := 0; retomadas integer := 0; encerradas integer := 0; obs text; quando timestamptz;
begin
  if auth.uid() is not null and not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  -- retomada: 24 h sem nova resposta → continua no passo seguinte
  update public.leads set cadencia_pausada_em = null, cadencia_proximo_em = now()
   where cadencia_id is not null and cadencia_encerrada_em is null and cadencia_pausada_em is not null
     and coalesce(ultima_resposta_em, cadencia_pausada_em) < now() - interval '24 hours' and status = 'Aberto';
  get diagnostics retomadas = row_count;
  if not p_forcar and not public.cadencia_horario_comercial() then
    return jsonb_build_object('ok', true, 'fora_do_horario', true, 'retomadas', retomadas);
  end if;
  for l in select * from public.leads
            where status = 'Aberto' and cadencia_id is not null and cadencia_encerrada_em is null and cadencia_pausada_em is null
              and cadencia_proximo_em <= now()
            order by cadencia_proximo_em limit 200 loop
    select * into cad from public.cadencias where id = l.cadencia_id;
    select * into p from public.cadencia_passos where cadencia_id = l.cadencia_id and passo > l.cadencia_passo order by passo limit 1;
    if p.passo is null then
      update public.leads set cadencia_encerrada_em = now(), cadencia_proximo_em = null where id = l.id;
      encerradas := encerradas + 1; continue;
    end if;
    obs := p.detalhe;
    if p.tecnica then obs := concat_ws(' ', obs, 'Caso essa técnica já tenha sido utilizada anteriormente com este lead, substituir por outra interação, personalizada ao momento.'); end if;
    quando := greatest(l.cadencia_proximo_em, now());
    insert into public.lead_tarefas (lead_id, tipo, titulo, quando, responsavel_id, cadencia_id, cadencia_passo, detalhe, criado_por)
    values (l.id, p.tipo, format('C%s · D%s — %s', l.cadencia_id, p.dia, p.titulo), quando, l.proprietario_id, l.cadencia_id, p.passo, obs, null);
    criadas := criadas + 1;
    select * into prox from public.cadencia_passos where cadencia_id = l.cadencia_id and passo > p.passo order by passo limit 1;
    update public.leads set cadencia_passo = p.passo,
      cadencia_proximo_em = case when prox.passo is null then null else public.cadencia_somar_dias_uteis(quando, prox.dia - p.dia) end,
      cadencia_encerrada_em = case when prox.passo is null then now() else null end
     where id = l.id;
    if prox.passo is null then encerradas := encerradas + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'criadas', criadas, 'retomadas', retomadas, 'encerradas', encerradas);
end $$;
revoke all on function public.cadencias_processar(boolean) from public, anon;
grant execute on function public.cadencias_processar(boolean) to authenticated;  -- "Processar agora" pelo admin no painel

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cadencias-np';
  perform cron.schedule('cadencias-np', '*/10 * * * *', $c$ select public.cadencias_processar(); $c$);
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

-- ---------- controle manual pela ficha do lead (equipe) ----------
-- (re)inicia a cadência da etapa atual do lead (ex.: leads que já estavam no funil antes desta versão)
create or replace function public.lead_cadencia_iniciar(p_lead uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.leads; c integer; cad public.cadencias;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead não encontrado.'; end if;
  if l.status <> 'Aberto' then raise exception 'O lead não está em aberto.'; end if;
  c := public.cadencia_da_fase(l.fase_id);
  if c is null then raise exception 'A etapa atual não tem cadência.'; end if;
  select * into cad from public.cadencias where id = c;
  delete from public.lead_tarefas where lead_id = p_lead and cadencia_id is not null and concluida_em is null;
  update public.leads set cadencia_id = c, cadencia_passo = 0, cadencia_pausada_em = null, cadencia_encerrada_em = null,
    cadencia_proximo_em = case when l.fase_id = 5 or cad.inicio = 'imediato' then now()
                               when cad.inicio = 'apos_24h' then now() + interval '24 hours'
                               else public.cadencia_somar_dias_uteis(now(), 1) end
   where id = p_lead;
  return jsonb_build_object('ok', true, 'cadencia', cad.nome);
end $$;
revoke all on function public.lead_cadencia_iniciar(uuid) from public, anon;

-- encerra a cadência do lead (tarefas pendentes dela saem da fila)
create or replace function public.lead_cadencia_encerrar(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  delete from public.lead_tarefas where lead_id = p_lead and cadencia_id is not null and concluida_em is null;
  update public.leads set cadencia_encerrada_em = now(), cadencia_proximo_em = null, cadencia_pausada_em = null where id = p_lead and cadencia_id is not null;
end $$;
revoke all on function public.lead_cadencia_encerrar(uuid) from public, anon;

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

    if jsonb_typeof(p -> 'tags') = 'array' then
      delete from public.lead_tags where lead_id = lead;
      for tag_nome in select distinct btrim(value) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '' loop
        insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
        insert into public.lead_tags (lead_id, tag_id)
        select lead, id from public.tags where nome = tag_nome
        on conflict do nothing;
      end loop;
    end if;

    -- mensagem do contato em lead já existente = "lead respondeu" (pausa a cadência; Novo lead → Em qualificação).
    -- call_log e afins não contam.
    if existia and coalesce(p ->> 'tipo_mensagem', 'chat') not in ('call_log') then
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

-- ---------- views ----------
drop view if exists public.v_leads;
create view public.v_leads with (security_invoker = true) as
select l.*, f.nome as fase_nome, f.ordem as fase_ordem, f.cor as fase_cor, f.prazo_horas, f.dono as fase_dono, f.sigla as fase_sigla,
       coalesce(p.nome, p.email) as proprietario_nome,
       coalesce((select array_agg(t.nome order by t.nome) from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.lead_id = l.id), '{}') as tags,
       (select count(*) from public.observacoes o where o.lead_id = l.id) as total_observacoes,
       extract(day from now() - l.fase_desde)::int as dias_na_fase,
       round(extract(epoch from now() - l.fase_desde) / 3600)::int as horas_na_fase,
       case when l.status <> 'Aberto' or f.prazo_horas is null then 'ok'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) then 'estourado'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) * 0.8 then 'alerta'
            else 'ok' end as atraso,
       (select min(t.quando) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as proxima_tarefa,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as tarefas_abertas,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null and t.quando < now()) as tarefas_vencidas,
       c.nome as cadencia_nome,
       (select max(cp.passo) from public.cadencia_passos cp where cp.cadencia_id = l.cadencia_id) as cadencia_total,
       (select cp.dia from public.cadencia_passos cp where cp.cadencia_id = l.cadencia_id and cp.passo = l.cadencia_passo) as cadencia_dia
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id
left join public.cadencias c on c.id = l.cadencia_id;
revoke all on public.v_leads from anon;

drop view if exists public.v_lead_tarefas;
create view public.v_lead_tarefas with (security_invoker = true) as
select t.*, l.nome as lead_nome, l.empresa as lead_empresa, l.whatsapp as lead_whatsapp, l.fase_id, l.status as lead_status,
       coalesce(p.nome, p.email) as responsavel_nome
from public.lead_tarefas t join public.leads l on l.id = t.lead_id left join public.perfis p on p.id = t.responsavel_id;
revoke all on public.v_lead_tarefas from anon;

select 'ok 0073' as resultado;
