-- ESPELHO (beta) — parte 8 de 9: 0070_formulario_site_icp.sql … 0076_central_cobrancas.sql

-- ===== 0070_formulario_site_icp.sql =====
-- 0070 — Formulário do site: campos do ICP (empresa, faixa e situação da dívida, descrição) no lead; sem responsável
-- do comercial com login, o aviso vai para as sócias. Substitui a função de 0069. Idempotente.

create or replace function public.site_formulario(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id   bigint;
  cfg      jsonb;
  nome_in  text;
  tel_in   text;
  chave    text;
  email_in text;
  msg      text;
  area     text;
  ip       text;
  motivo   text;
  lead     uuid;
  novo     boolean := false;
  resp_col uuid;
  resp_per uuid;
  painel   text;
  canal    text;
  recentes integer;
  empresa_in text;
  valor_in text;
  situacao_in text;
  socio uuid;
begin
  insert into public.webhook_logs (payload) values (p || '{"_origem":"site"}'::jsonb) returning id into log_id;
  select dados into cfg from public.escritorio where id = 'site';
  begin
  nome_in  := left(btrim(coalesce(p ->> 'nome', '')), 100);
  tel_in   := left(btrim(coalesce(p ->> 'telefone', '')), 30);
  email_in := lower(left(btrim(coalesce(p ->> 'email', '')), 120));
  msg      := left(btrim(coalesce(nullif(p ->> 'mensagem', ''), p ->> 'descricaoSituacao', '')), 1500);
  area     := nullif(left(btrim(coalesce(p ->> 'area', '')), 80), '');
  empresa_in := nullif(left(btrim(coalesce(p ->> 'empresa', '')), 120), '');
  valor_in   := nullif(left(btrim(coalesce(p ->> 'valorDivida', p ->> 'valor_divida', '')), 60), '');
  situacao_in := nullif(left(btrim(coalesce(p ->> 'situacaoDivida', p ->> 'situacao_divida', '')), 60), '');
  ip       := nullif(p ->> '_ip', '');
  chave    := public.normalizar_whatsapp(tel_in);

  -- ---- filtro de spam (nada disso vira lead; fica só no log) ----
  if coalesce(p ->> 'hp', '') <> '' then motivo := 'honeypot preenchido';
  elsif (p ->> 't') ~ '^\d+$' and (p ->> 't')::bigint < 2500 then motivo := 'envio rápido demais';
  elsif length(regexp_replace(nome_in, '[^[:alpha:]]', '', 'g')) < 2 then motivo := 'nome inválido';
  elsif nome_in ~ '[Ѐ-ӿ一-鿿぀-ヿ؀-ۿ]' or msg ~ '[Ѐ-ӿ一-鿿぀-ヿ]' then motivo := 'alfabeto estrangeiro';
  elsif (length(msg) - length(replace(lower(msg), 'http', ''))) / 4 >= 2 then motivo := 'links na mensagem';
  elsif chave is null then motivo := 'telefone inválido';
  elsif email_in <> '' and email_in !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then motivo := 'e-mail inválido';
  end if;
  if motivo is null and ip is not null then
    select count(*) into recentes from public.webhook_logs
     where payload ->> '_origem' = 'site' and payload ->> '_ip' = ip and created_at > now() - interval '1 hour' and id <> log_id;
    if recentes >= 5 then motivo := 'muitos envios do mesmo IP'; end if;
  end if;
  if motivo is not null then
    update public.webhook_logs set status = 'spam', erro = motivo where id = log_id;
    return jsonb_build_object('ok', true, 'spam', true, 'motivo', motivo);
  end if;

  -- ---- responsável ----
  resp_col := nullif(cfg ->> 'responsavel_id', '')::uuid;
  if resp_col is null then resp_col := public.responsavel_padrao('comercial'); end if;
  select perfil_id into resp_per from public.colaboradores where id = resp_col;

  -- ---- lead: um por WhatsApp ----
  select id into lead from public.leads where whatsapp_normalizado = chave;
  if lead is null then
    novo := true;
    insert into public.leads (nome, email, whatsapp, empresa, tipo_divida, valor_divida, situacao_divida, campanha, origem, ultima_mensagem, ultima_interacao_em, proprietario_id)
    values (nome_in, nullif(email_in, ''), tel_in, empresa_in, area, valor_in, situacao_in, coalesce(cfg ->> 'campanha', 'Site institucional'), 'site',
            nullif(msg, ''), now(), resp_per)
    returning id into lead;
  else
    update public.leads set
      nome                = coalesce(nullif(nome, ''), nome_in),
      email               = coalesce(email, nullif(email_in, '')),
      empresa             = coalesce(empresa, empresa_in),
      tipo_divida         = coalesce(tipo_divida, area),
      valor_divida        = coalesce(valor_divida, valor_in),
      situacao_divida     = coalesce(situacao_divida, situacao_in),
      ultima_mensagem     = coalesce(nullif(msg, ''), ultima_mensagem),
      ultima_interacao_em = now(),
      proprietario_id     = coalesce(proprietario_id, resp_per)
    where id = lead;
  end if;

  -- ---- avisos ----
  painel := public.painel_url();
  resp_per := coalesce((select proprietario_id from public.leads where id = lead), resp_per);
  if resp_per is not null then
    perform public.notificar(resp_per,
      case when novo then 'Lead novo pelo site' else 'Lead voltou a escrever pelo site' end,
      nome_in || coalesce(' · ' || empresa_in, '') || coalesce(' · ' || valor_in, '') || coalesce(' · ' || situacao_in, '') || coalesce(E'\n' || left(msg, 300), ''),
      '#leads/' || lead::text);
  else -- ninguém do comercial com login ainda: avisa as sócias
    for socio in select perfil_id from public.colaboradores where ativo and nucleo = 'socios' and perfil_id is not null loop
      perform public.notificar(socio, 'Lead novo pelo site (sem responsável)', nome_in || coalesce(' · ' || empresa_in, ''), '#leads/' || lead::text);
    end loop;
  end if;
  canal := nullif(cfg ->> 'canal_discord', '');
  if canal is not null then
    insert into public.discord_fila (canal_discord, texto, referencia)
    values (canal,
      '🌐 **' || case when novo then 'Lead novo pelo site' else 'Lead voltou a escrever pelo site' end || '** — ' || nome_in
      || coalesce(E'\n' || 'Empresa: ' || empresa_in, '') || coalesce(E'\n' || 'Dívida: ' || valor_in, '') || coalesce(' · ' || situacao_in, '') || coalesce(E'\n' || 'Área: ' || area, '') || coalesce(E'\n' || '> ' || left(msg, 600), '')
      || E'\n' || painel || '/#leads/' || lead::text,
      'site:' || log_id::text);
  end if;

  update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
  return jsonb_build_object('ok', true, 'lead_id', lead, 'novo', novo);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end $$;
revoke all on function public.site_formulario(jsonb) from public, anon, authenticated;
grant execute on function public.site_formulario(jsonb) to service_role;

select 'ok 0070' as resultado;


-- ===== 0071_fechamento_documentos_drive.sql =====
-- 0071 — Fechamento, parte 2: documentos gerados (.docx de contrato e procurações) e pasta do cliente no Drive.
-- Modelos ficam no bucket privado "modelos" (equipe lê, admin envia); os arquivos gerados vão para o bucket "anexos"
-- em <cliente_id>/fechamento/… e são listados em fechamentos.documentos. Idempotente. Depende de 0068.

-- bucket dos modelos
insert into storage.buckets (id, name, public, file_size_limit) values ('modelos', 'modelos', false, 20971520)
on conflict (id) do update set public = false;
drop policy if exists modelos_storage_sel on storage.objects;
create policy modelos_storage_sel on storage.objects for select to authenticated using (bucket_id = 'modelos' and public.sou_equipe());
drop policy if exists modelos_storage_adm on storage.objects;
create policy modelos_storage_adm on storage.objects for all to authenticated
  using (bucket_id = 'modelos' and public.sou_admin()) with check (bucket_id = 'modelos' and public.sou_admin());

-- documentos gerados por fechamento
alter table public.fechamentos add column if not exists documentos jsonb not null default '[]'::jsonb;
-- [{tipo:'contrato'|'procuracoes', nome, caminho (bucket anexos), gerado_em, por, drive_id, drive_url}]

-- configuração do Drive (pasta "- PESSOA JURÍDICA" dentro de CLIENTES; descoberta pela Edge se vazio) e e-mail impersonado
update public.escritorio set dados = dados
  || jsonb_build_object('drive_pasta_pj_id', coalesce(dados->>'drive_pasta_pj_id', null))
  || jsonb_build_object('drive_usuario', coalesce(dados->>'drive_usuario', 'contato@nevespaduaadvocacia.com.br'))
  || jsonb_build_object('drive_subpastas', coalesce(dados->'drive_subpastas', '["DOSSIÊ"]'::jsonb))
 where id = 'fechamento';

-- registrar documento gerado (equipe)
create or replace function public.fechamento_documento_registrar(p_fechamento uuid, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare docs jsonb; novo jsonb;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  novo := p_doc || jsonb_build_object('gerado_em', now(), 'por', auth.uid());
  select documentos into docs from public.fechamentos where id = p_fechamento for update;
  if docs is null then raise exception 'Fechamento não encontrado.'; end if;
  -- substitui documento do mesmo tipo (regerado)
  docs := coalesce((select jsonb_agg(d) from jsonb_array_elements(docs) d where d->>'tipo' <> (p_doc->>'tipo')), '[]'::jsonb) || jsonb_build_array(novo);
  update public.fechamentos set documentos = docs,
    contrato_gerado_em = case when p_doc->>'tipo' = 'contrato' then now() else contrato_gerado_em end,
    contrato_url = case when p_doc->>'tipo' = 'contrato' and nullif(p_doc->>'drive_url','') is not null then p_doc->>'drive_url' else contrato_url end
  where id = p_fechamento;
  return novo;
end $$;
revoke all on function public.fechamento_documento_registrar(uuid, jsonb) from public, anon;

-- atualizar os dados do fechamento (completar RG/endereço do representante etc.) — equipe
create or replace function public.fechamento_dados_atualizar(p_fechamento uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select dados into d from public.fechamentos where id = p_fechamento for update;
  if d is null then raise exception 'Fechamento não encontrado.'; end if;
  -- merge raso por seção (empresa, representante, honorarios, condicoes)
  d := d || jsonb_build_object(
    'empresa', coalesce(d->'empresa', '{}'::jsonb) || coalesce(p_patch->'empresa', '{}'::jsonb),
    'representante', coalesce(d->'representante', '{}'::jsonb) || coalesce(p_patch->'representante', '{}'::jsonb),
    'honorarios', coalesce(d->'honorarios', '{}'::jsonb) || coalesce(p_patch->'honorarios', '{}'::jsonb),
    'condicoes', coalesce(d->'condicoes', '{}'::jsonb) || coalesce(p_patch->'condicoes', '{}'::jsonb));
  update public.fechamentos set dados = d where id = p_fechamento;
  return d;
end $$;
revoke all on function public.fechamento_dados_atualizar(uuid, jsonb) from public, anon;

-- a view expõe os documentos
drop view if exists public.v_fechamentos;
create view public.v_fechamentos with (security_invoker = true) as
select f.id, f.lead_id, f.cliente_id, f.dados, f.closer_id, co.nome as closer_nome, f.contrato_gerado_em, f.contrato_url, f.documentos, f.created_at,
       c.nome as cliente_nome, c.nome_fantasia, c.cnpj, c.pasta_drive_id, c.pasta_drive_url
  from public.fechamentos f
  left join public.colaboradores co on co.id = f.closer_id
  join public.clientes c on c.id = f.cliente_id;

-- Edge (service_role): gravar pasta do Drive no cliente
create or replace function public.cliente_pasta_drive_definir(p_cliente text, p_id text, p_url text)
returns void language sql security definer set search_path = public as $$
  update public.clientes set pasta_drive_id = p_id, pasta_drive_url = p_url where id = p_cliente;
$$;
revoke all on function public.cliente_pasta_drive_definir(text, text, text) from public, anon, authenticated;
grant execute on function public.cliente_pasta_drive_definir(text, text, text) to service_role;

select 'ok 0071' as resultado;


-- ===== 0072_gen_random_bytes_schema.sql =====
-- 0072 — Correção: gen_random_bytes (pgcrypto) fica no schema "extensions" no Supabase; funções com search_path = public
-- (lead_fechar → insert em clientes → gatilho do token de onboarding) não o encontravam. Idempotente.
create or replace function public.clientes_token_onboarding() returns trigger language plpgsql as $$
begin
  if new.onboarding_token is null then new.onboarding_token := encode(extensions.gen_random_bytes(24), 'hex'); end if;
  return new;
end $$;
alter function public.onboarding_enviar_boas_vindas(text, timestamptz) set search_path = public, extensions;
select 'ok 0072' as resultado;


-- ===== 0073_cadencias_comerciais.sql =====
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


-- ===== 0074_importacao_leads.sql =====
-- 0074 — Importação em massa de leads por planilha (.xlsx/.csv) com etapa, status, proprietário, motivo de perda, tags etc.
-- Usada pelo assistente "Importar leads" do painel (arquivo → mapear → visualizar → importar). Migração dos leads do GCV.
-- A planilha é mapeada no navegador para os campos abaixo; cada linha chega como jsonb de textos.
-- Chave: WhatsApp normalizado (ou "ID externo"); número repetido atualiza o lead existente quando a opção "atualizar" está ligada.
-- Importação não dispara cadência (opção `iniciar_cadencia` liga para quem quiser). Idempotente. Depende de 0073.

alter table public.leads add column if not exists externo_id text;   -- id do lead no sistema de origem (GCV)
create index if not exists leads_externo_idx on public.leads (externo_id) where externo_id is not null;
do $$ begin alter type public.lead_origem add value if not exists 'gcv'; exception when others then null; end $$;

-- gatilho da cadência respeita o sinal "sem cadência" (importação / ajustes em massa)
create or replace function public.leads_cadencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare nova integer; antiga integer; cad public.cadencias;
begin
  if coalesce(current_setting('np.sem_cadencia', true), '') = '1' then return new; end if;
  nova := case when new.status = 'Aberto' then public.cadencia_da_fase(new.fase_id) end;
  if tg_op = 'INSERT' and new.origem in ('planilha', 'gcv') then nova := null; end if;   -- importação não dispara cadência
  antiga := case when tg_op = 'UPDATE' then old.cadencia_id end;
  if tg_op = 'UPDATE' and old.cadencia_encerrada_em is not null then antiga := null; end if;
  if nova is distinct from antiga then
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
        when new.fase_id = 5 then now()
        when cad.inicio = 'apos_24h' then now() + interval '24 hours'
        when cad.inicio = 'imediato' then now()
        else public.cadencia_somar_dias_uteis(now(), 1) end;
    end if;
  end if;
  return new;
end $$;

-- ---------- resolução de uma linha (texto → ids/valores) ----------
-- Devolve {ok, erros:[], avisos:[], dados:{...}} sem gravar nada.
create or replace function public.importar_lead_resolver(linha jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb := '{}'::jsonb; erros text[] := '{}'; avisos text[] := '{}';
  t text; n text; v numeric; f record; m record; p record; st text; o text; chave text; existente record;
begin
  -- whatsapp (chave)
  chave := public.normalizar_whatsapp(linha ->> 'whatsapp');
  if chave is null and coalesce(btrim(linha ->> 'externo_id'), '') = '' then erros := array_append(erros, 'WhatsApp vazio ou inválido'); end if;
  d := d || jsonb_build_object('whatsapp', nullif(btrim(linha ->> 'whatsapp'), ''), 'whatsapp_normalizado', chave, 'externo_id', nullif(btrim(linha ->> 'externo_id'), ''));
  -- lead existente?
  select id, nome into existente from public.leads
   where (chave is not null and whatsapp_normalizado = chave)
      or (nullif(btrim(linha ->> 'externo_id'), '') is not null and externo_id = btrim(linha ->> 'externo_id'))
   limit 1;
  -- sem WhatsApp/ID correspondente: tenta o e-mail (evita duplicar lead que entrou só com e-mail)
  if existente.id is null and nullif(btrim(linha ->> 'email'), '') is not null then
    select id, nome into existente from public.leads where lower(email) = lower(btrim(linha ->> 'email')) limit 1;
  end if;
  d := d || jsonb_build_object('existente_id', existente.id, 'existente_nome', existente.nome);

  -- etapa
  t := nullif(btrim(linha ->> 'fase'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    select id, nome into f from public.fases
     where id::text = t or lower(public.sem_acento(nome)) = n or lower(coalesce(sigla, '')) = n
        or lower(public.sem_acento(nome)) like n || '%'
     order by case when id::text = t or lower(public.sem_acento(nome)) = n then 0 else 1 end, ordem limit 1;
    if f.id is null then
      -- apelidos comuns
      f.id := case
        when n in ('novo','novo lead','lead novo','lead','entrada') then 1
        when n like 'em qualifica%' or n like 'qualifica%sdr%' or n in ('sdr','qualificando') then 2
        when n in ('qualificado','mql','qualificados') then 3
        when n like 'reuni%agend%' or n in ('agendado','agendada','sql') then 4
        when n like 'no%show%' or n = 'noshow' then 5
        when n like 'reuni%realiz%' or n in ('se','realizada','call realizada') then 6
        when n like 'proposta%' or n = 'opp' then 7
        when n like 'contrato%' then 8
        when n like 'pagamento%' or n like 'aguardando pag%' then 9
        when n in ('ganho','fechado','cliente','vendido') then 10 end;
      if f.id is null then erros := array_append(erros, 'Etapa não reconhecida: "' || t || '"'); end if;
    end if;
    d := d || jsonb_build_object('fase_id', f.id);
  end if;

  -- status
  t := nullif(btrim(linha ->> 'status'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    st := case when n in ('aberto','em aberto','open','ativo','em andamento') then 'Aberto'
               when n in ('ganho','won','fechado','vendido','cliente') then 'Ganho'
               when n in ('perdido','lost','perda') then 'Perdido'
               when n in ('abandonado','abandono','descartado') then 'Abandonado' end;
    if st is null then erros := array_append(erros, 'Status não reconhecido: "' || t || '" (use Aberto, Ganho, Perdido ou Abandonado)'); end if;
    d := d || jsonb_build_object('status', st);
  end if;
  -- motivo de perda (código, rótulo do catálogo ou texto livre)
  t := nullif(btrim(linha ->> 'motivo_perda'), '');
  if t is not null then
    n := lower(public.sem_acento(regexp_replace(t, '^\[(sdr|closer|cs)\]\s*', '', 'i')));
    select codigo into m from public.motivos_perda
     where codigo = t or lower(public.sem_acento(regexp_replace(rotulo, '^\[(sdr|closer|cs)\]\s*', '', 'i'))) = n limit 1;
    d := d || jsonb_build_object('motivo_perda', coalesce(m.codigo, t));
    if m.codigo is null then avisos := array_append(avisos, 'Motivo fora do catálogo, gravado como texto: "' || t || '"'); end if;
  end if;
  if coalesce(d ->> 'status', '') in ('Perdido', 'Abandonado') and coalesce(d ->> 'motivo_perda', '') = '' then
    erros := array_append(erros, 'Lead Perdido/Abandonado precisa de motivo da perda');
  end if;

  -- proprietário (e-mail ou nome de um perfil da equipe)
  t := nullif(btrim(linha ->> 'proprietario'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    select id, nome into p from public.perfis
     where papel in ('admin', 'colaborador') and (lower(email) = lower(t) or lower(public.sem_acento(coalesce(nome, ''))) = n)
     limit 1;
    if p.id is null then
      select id, nome into p from public.perfis
       where papel in ('admin', 'colaborador') and (lower(public.sem_acento(coalesce(nome, ''))) like n || '%' or lower(email) like n || '%') limit 1;
    end if;
    if p.id is null then avisos := array_append(avisos, 'Proprietário não encontrado: "' || t || '" (lead fica sem proprietário)'); end if;
    d := d || jsonb_build_object('proprietario_id', p.id);
  end if;

  -- valor da oportunidade ("R$ 12.500,00", "12500", "12.500")
  t := nullif(btrim(linha ->> 'valor'), '');
  if t is not null then
    begin
      n := regexp_replace(t, '[^0-9,.\-]', '', 'g');
      if n ~ ',\d{1,2}$' then n := replace(replace(n, '.', ''), ',', '.'); elsif n ~ '\.\d{1,2}$' and n !~ ',' then n := replace(n, ',', ''); else n := replace(replace(n, '.', ''), ',', ''); end if;
      v := nullif(n, '')::numeric;
      d := d || jsonb_build_object('valor', v);
    exception when others then avisos := array_append(avisos, 'Valor não numérico ignorado: "' || t || '"'); end;
  end if;

  -- datas (o navegador já converte para ISO quando consegue)
  foreach t in array array['data_entrada', 'reuniao_em'] loop
    n := nullif(btrim(linha ->> t), '');
    if n is not null then
      begin d := d || jsonb_build_object(t, (n::timestamptz)); exception when others then avisos := array_append(avisos, 'Data inválida em ' || t || ': "' || n || '"'); end;
    end if;
  end loop;

  -- origem
  t := nullif(btrim(linha ->> 'origem'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    o := case when n like 'gcv%' then 'gcv' when n like 'chatguru%' or n like 'whatsapp%' then 'chatguru' when n like 'site%' or n like 'formul%' then 'site'
              when n like 'manual%' or n like 'cadastr%' then 'manual' when n like 'planilha%' or n like 'meta%' or n like 'facebook%' or n like 'instagram%' then 'planilha' end;
    if o is null then avisos := array_append(avisos, 'Origem não reconhecida: "' || t || '"'); end if;
    d := d || jsonb_build_object('origem', o);
  end if;

  -- textos simples
  foreach t in array array['nome', 'email', 'empresa', 'tipo_divida', 'situacao_divida', 'valor_divida', 'outras_dividas', 'melhor_horario', 'campanha', 'publico', 'anuncio', 'link_chat', 'observacao'] loop
    d := d || jsonb_build_object(t, nullif(btrim(linha ->> t), ''));
  end loop;
  -- tags: separadas por vírgula, ponto e vírgula ou barra
  t := nullif(btrim(linha ->> 'tags'), '');
  if t is not null then
    d := d || jsonb_build_object('tags', (select coalesce(jsonb_agg(distinct btrim(x)), '[]'::jsonb) from unnest(regexp_split_to_array(t, '\s*[,;|/]\s*')) x where btrim(x) <> ''));
  end if;
  if existente.id is null and coalesce(d ->> 'nome', '') = '' then avisos := array_append(avisos, 'Sem nome (ficará "Sem nome")'); end if;

  return jsonb_build_object('ok', cardinality(erros) = 0, 'erros', to_jsonb(erros), 'avisos', to_jsonb(avisos), 'dados', d,
                            'acao', case when cardinality(erros) > 0 then 'erro' when existente.id is not null then 'atualizar' else 'criar' end);
end $$;
revoke all on function public.importar_lead_resolver(jsonb) from public, anon;

-- ---------- importação ----------
-- opcoes: {simular:bool, atualizar:bool (padrão true), iniciar_cadencia:bool (padrão false), origem_padrao:text (padrão 'planilha'), lote:text}
create or replace function public.importar_leads_v2(linhas jsonb, opcoes jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  linha jsonb; r jsonb; d jsonb; idx integer := 0; nlinha integer;
  simular boolean := coalesce((opcoes ->> 'simular')::boolean, false);
  atualizar boolean := coalesce((opcoes ->> 'atualizar')::boolean, true);
  iniciar boolean := coalesce((opcoes ->> 'iniciar_cadencia')::boolean, false);
  origem_padrao text := coalesce(nullif(opcoes ->> 'origem_padrao', ''), 'planilha');
  criados integer := 0; atualizados integer := 0; ignorados integer := 0;
  erros jsonb := '[]'::jsonb; avisos jsonb := '[]'::jsonb; detalhes jsonb := '[]'::jsonb;
  lead_id uuid; tag_nome text; cad integer; cadr public.cadencias; lr record;
begin
  if not public.sou_equipe() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  perform set_config('np.sem_cadencia', '1', true);

  for linha in select * from jsonb_array_elements(linhas) loop
    idx := idx + 1; nlinha := coalesce((linha ->> '_linha')::int, idx);
    r := public.importar_lead_resolver(linha); d := r -> 'dados';
    if jsonb_array_length(r -> 'avisos') > 0 then
      avisos := avisos || (select jsonb_agg(jsonb_build_object('linha', nlinha, 'motivo', a)) from jsonb_array_elements_text(r -> 'avisos') a);
    end if;
    if not (r ->> 'ok')::boolean then
      ignorados := ignorados + 1;
      erros := erros || jsonb_build_object('linha', nlinha, 'motivo', array_to_string(array(select jsonb_array_elements_text(r -> 'erros')), '; '));
      if simular then detalhes := detalhes || jsonb_build_object('linha', nlinha, 'acao', 'erro', 'nome', d ->> 'nome'); end if;
      continue;
    end if;
    if (d ->> 'existente_id') is not null and not atualizar then
      ignorados := ignorados + 1;
      if simular then detalhes := detalhes || jsonb_build_object('linha', nlinha, 'acao', 'ignorar', 'nome', d ->> 'nome', 'existente', d ->> 'existente_nome'); end if;
      continue;
    end if;
    if simular then
      if (d ->> 'existente_id') is not null then atualizados := atualizados + 1; else criados := criados + 1; end if;
      detalhes := detalhes || jsonb_build_object('linha', nlinha, 'acao', r ->> 'acao', 'nome', d ->> 'nome', 'existente', d ->> 'existente_nome', 'fase_id', d -> 'fase_id', 'status', d ->> 'status', 'proprietario_id', d -> 'proprietario_id');
      continue;
    end if;

    begin
      if (d ->> 'existente_id') is not null then
        lead_id := (d ->> 'existente_id')::uuid;
        update public.leads set
          nome            = coalesce(d ->> 'nome', nome),
          email           = coalesce(d ->> 'email', email),
          whatsapp        = coalesce(d ->> 'whatsapp', whatsapp),
          empresa         = coalesce(d ->> 'empresa', empresa),
          externo_id      = coalesce(d ->> 'externo_id', externo_id),
          fase_id         = coalesce((d ->> 'fase_id')::int, fase_id),
          status          = coalesce((d ->> 'status')::public.lead_status, status),
          motivo_perda    = coalesce(d ->> 'motivo_perda', motivo_perda),
          proprietario_id = coalesce((d ->> 'proprietario_id')::uuid, proprietario_id),
          valor           = coalesce((d ->> 'valor')::numeric, valor),
          data_entrada    = coalesce((d ->> 'data_entrada')::timestamptz, data_entrada),
          reuniao_em      = coalesce((d ->> 'reuniao_em')::timestamptz, reuniao_em),
          tipo_divida     = coalesce(d ->> 'tipo_divida', tipo_divida),
          situacao_divida = coalesce(d ->> 'situacao_divida', situacao_divida),
          valor_divida    = coalesce(d ->> 'valor_divida', valor_divida),
          outras_dividas  = coalesce(d ->> 'outras_dividas', outras_dividas),
          melhor_horario  = coalesce(d ->> 'melhor_horario', melhor_horario),
          campanha        = coalesce(d ->> 'campanha', campanha),
          publico         = coalesce(d ->> 'publico', publico),
          anuncio         = coalesce(d ->> 'anuncio', anuncio),
          link_chat       = coalesce(d ->> 'link_chat', link_chat)
        where id = lead_id;
        atualizados := atualizados + 1;
      else
        insert into public.leads (nome, email, whatsapp, empresa, externo_id, fase_id, status, motivo_perda, proprietario_id, valor, data_entrada, reuniao_em,
                                  tipo_divida, situacao_divida, valor_divida, outras_dividas, melhor_horario, campanha, publico, anuncio, link_chat, origem)
        values (coalesce(d ->> 'nome', 'Sem nome'), d ->> 'email', d ->> 'whatsapp', d ->> 'empresa', d ->> 'externo_id',
                coalesce((d ->> 'fase_id')::int, 1), coalesce((d ->> 'status')::public.lead_status, 'Aberto'), d ->> 'motivo_perda',
                (d ->> 'proprietario_id')::uuid, coalesce((d ->> 'valor')::numeric, 0), coalesce((d ->> 'data_entrada')::timestamptz, now()), (d ->> 'reuniao_em')::timestamptz,
                d ->> 'tipo_divida', d ->> 'situacao_divida', d ->> 'valor_divida', d ->> 'outras_dividas', d ->> 'melhor_horario',
                d ->> 'campanha', d ->> 'publico', d ->> 'anuncio', d ->> 'link_chat', coalesce(d ->> 'origem', origem_padrao)::public.lead_origem)
        returning id into lead_id;
        criados := criados + 1;
      end if;
      -- tags (acrescenta; não remove as existentes)
      if jsonb_typeof(d -> 'tags') = 'array' then
        for tag_nome in select value from jsonb_array_elements_text(d -> 'tags') loop
          insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
          insert into public.lead_tags (lead_id, tag_id) select lead_id, id from public.tags where nome = tag_nome on conflict do nothing;
        end loop;
      end if;
      if (d ->> 'observacao') is not null then
        insert into public.observacoes (lead_id, texto, autor_id) values (lead_id, 'Importação' || coalesce(' (' || nullif(opcoes ->> 'lote', '') || ')', '') || ': ' || (d ->> 'observacao'), auth.uid());
      end if;
      -- cadência opcional: só para leads em aberto, em etapa com cadência
      if iniciar then
        select status, fase_id into lr from public.leads where id = lead_id;
        cad := case when lr.status = 'Aberto' then public.cadencia_da_fase(lr.fase_id) end;
        if cad is not null then
          select * into cadr from public.cadencias where id = cad;
          update public.leads set cadencia_id = cad, cadencia_passo = 0, cadencia_pausada_em = null, cadencia_encerrada_em = null,
            cadencia_proximo_em = case when fase_id = 5 or cadr.inicio = 'imediato' then now() when cadr.inicio = 'apos_24h' then now() + interval '24 hours' else public.cadencia_somar_dias_uteis(now(), 1) end
           where id = lead_id;
        end if;
      end if;
    exception when others then
      ignorados := ignorados + 1;
      erros := erros || jsonb_build_object('linha', nlinha, 'motivo', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('simulado', simular, 'criados', criados, 'atualizados', atualizados, 'ignorados', ignorados, 'erros', erros, 'avisos', avisos, 'detalhes', detalhes);
end $$;
revoke all on function public.importar_leads_v2(jsonb, jsonb) from public, anon;

select 'ok 0074' as resultado;


-- ===== 0075_fluxos_mensagens_leads.sql =====
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


-- ===== 0076_central_cobrancas.sql =====
-- 0076 — Central de Cobranças dentro do Financeiro (migração do artefato "Central de Cobranças").
-- Base: as cobranças já sincronizadas do Asaas (0055). Acrescenta:
--   • asaas_contatos: todos os clientes do Asaas (nome/telefone), mesmo sem ficha no sistema — a Central cobre toda a carteira
--   • cobranca_contatos: registro de contato da cadência de vencidas (Recuperado / Não responde / Verificar amanhã / Negociou)
--   • cobrancas.baixa_manual e vencimento_negociado (nova data acordada sem mexer no Asaas)
--   • cobranca_checks: "lembrete enviado" dos cards de pré-vencimento (D-5, D-2, D-0)
--   • regua_etapas (D-5, D-2, D-0, D+1 + personalizadas, com a mensagem de cada etapa) e regua_disparos (prévia → aprovação → envio
--     pela fila de WhatsApp existente, com registro de enviados / fora pelas regras / falhas)
-- Idempotente. Depende de 0055, 0052, 0075.

-- ---------- todos os clientes do Asaas ----------
create table if not exists public.asaas_contatos (
  asaas_id text primary key,
  nome text, cpf_cnpj text, email text, telefone text,
  cliente_id text references public.clientes (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table public.asaas_contatos enable row level security;
drop policy if exists "asaas_contatos: financeiro le" on public.asaas_contatos;
create policy "asaas_contatos: financeiro le" on public.asaas_contatos for select to authenticated using (public.pode_financeiro());
revoke all on public.asaas_contatos from anon;

create or replace function public.asaas_sincronizar_gravar(token text, clientes jsonb, cobrancas jsonb, p_erro text default null, p_por uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; p jsonb; nc int := 0; np int := 0; cid text; doc text;
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for c in select value from jsonb_array_elements(coalesce(clientes, '[]'::jsonb)) loop
    cid := public.asaas_cliente_do_sistema(c->>'id', c->>'cpfCnpj', c->>'externalReference');
    insert into public.asaas_contatos (asaas_id, nome, cpf_cnpj, email, telefone, cliente_id, atualizado_em)
    values (c->>'id', c->>'name', c->>'cpfCnpj', c->>'email', coalesce(nullif(c->>'mobilePhone',''), c->>'phone'), cid, now())
    on conflict (asaas_id) do update set nome = excluded.nome, cpf_cnpj = excluded.cpf_cnpj, email = excluded.email, telefone = excluded.telefone, cliente_id = coalesce(excluded.cliente_id, asaas_contatos.cliente_id), atualizado_em = now();
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

-- ---------- cobranças: baixa manual, nova data negociada ----------
alter table public.cobrancas
  add column if not exists baixa_manual boolean not null default false,
  add column if not exists baixa_manual_em timestamptz,
  add column if not exists vencimento_negociado date;

create table if not exists public.cobranca_contatos (
  id bigserial primary key,
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  cliente_nome text,
  valor numeric,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  desfecho text not null check (desfecho in ('RECUPERADO','NAO_RESPONDE','VERIFICAR_AMANHA','NEGOCIOU')),
  proxima_acao text,
  observacao text,
  nova_data date,
  registrado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  origem text not null default 'painel',   -- painel | migracao
  created_at timestamptz not null default now()
);
create index if not exists cobranca_contatos_cob_idx on public.cobranca_contatos (cobranca_id, data desc, created_at desc);
create index if not exists cobranca_contatos_data_idx on public.cobranca_contatos (data desc);
alter table public.cobranca_contatos enable row level security;
drop policy if exists "cobranca_contatos: financeiro" on public.cobranca_contatos;
create policy "cobranca_contatos: financeiro" on public.cobranca_contatos for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
revoke all on public.cobranca_contatos from anon;

create table if not exists public.cobranca_checks (
  data date not null,
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (data, cobranca_id)
);
alter table public.cobranca_checks enable row level security;
drop policy if exists "cobranca_checks: financeiro" on public.cobranca_checks;
create policy "cobranca_checks: financeiro" on public.cobranca_checks for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
revoke all on public.cobranca_checks from anon;

-- registrar contato (fila de vencidas): Recuperado dá baixa manual; Negociou com data grava o vencimento negociado
create or replace function public.cobranca_registrar_contato(p_cobranca uuid, p_desfecho text, p_observacao text default null, p_nova_data date default null, p_data date default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare c record; novo bigint; prox text; dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select c0.*, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome) as cliente_nome into c
    from public.cobrancas c0 left join public.clientes cl on cl.id = c0.cliente_id left join public.asaas_contatos ac on ac.asaas_id = c0.asaas_cliente_id
   where c0.id = p_cobranca;
  if c.id is null then raise exception 'Cobrança não encontrada.'; end if;
  prox := case p_desfecho when 'RECUPERADO' then 'Encerrado — cobrança quitada' when 'NAO_RESPONDE' then 'Monitorar histórico / avaliar recorrência'
                          when 'VERIFICAR_AMANHA' then 'Entrar na fila de amanhã' when 'NEGOCIOU' then 'Acompanhar nova data de pagamento' end;
  insert into public.cobranca_contatos (cobranca_id, cliente_nome, valor, data, desfecho, proxima_acao, observacao, nova_data)
  values (p_cobranca, c.cliente_nome, c.valor, dia, p_desfecho, prox, coalesce(nullif(btrim(p_observacao), ''), case when p_nova_data is not null then 'Nova data acordada: ' || to_char(p_nova_data, 'DD/MM/YYYY') end), p_nova_data)
  returning id into novo;
  if p_desfecho = 'RECUPERADO' then
    update public.cobrancas set baixa_manual = true, baixa_manual_em = now(), regua_parada = true, atualizado_em = now() where id = p_cobranca;
  elsif p_desfecho = 'NEGOCIOU' and p_nova_data is not null then
    update public.cobrancas set vencimento_negociado = p_nova_data, atualizado_em = now() where id = p_cobranca;
  end if;
  return novo;
end $$;
revoke all on function public.cobranca_registrar_contato(uuid, text, text, date, date) from public, anon;

create or replace function public.cobranca_marcar_paga(p_cobranca uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.cobrancas set baixa_manual = true, baixa_manual_em = now(), regua_parada = true, atualizado_em = now() where id = p_cobranca;
end $$;
revoke all on function public.cobranca_marcar_paga(uuid) from public, anon;

-- ---------- etapas da régua e disparos ----------
create table if not exists public.regua_etapas (
  codigo text primary key,                 -- D-5, D-2, D-0, D+1, D+3…
  titulo text not null,
  descricao text,
  dias integer not null,                   -- dias até o vencimento: positivo = antes, 0 = no dia, negativo = depois
  mensagem text,
  personalizada boolean not null default false,
  ativa boolean not null default true,
  automatica boolean not null default false,   -- prepara o disparo sozinha nos dias úteis (continua exigindo aprovação)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.regua_etapas enable row level security;
drop policy if exists "regua_etapas: financeiro" on public.regua_etapas;
create policy "regua_etapas: financeiro" on public.regua_etapas for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
revoke all on public.regua_etapas from anon;
insert into public.regua_etapas (codigo, titulo, descricao, dias, mensagem, automatica) values
  ('D-5', 'Relatório', '5 dias antes do vencimento: mensagem com o relatório.', 5, null, false),
  ('D-2', 'Fatura com link', '2 dias antes do vencimento: fatura com o link de pagamento.', 2, null, false),
  ('D-0', 'Lembrete', 'No dia do vencimento: lembrete com o link. Preparada sozinha nos dias úteis às 8h55 (aprovação continua manual).', 0,
   E'Olá! Tudo bem?\n\nEsta é uma *mensagem automática* para lembrar que *{quando} é o vencimento* da sua *parcela {parcela}*.\n\nPara sua comodidade, segue o link da fatura. O pagamento pode ser feito via PIX ou boleto:\n\n{link}\n\nCaso o pagamento já tenha sido efetuado, desconsidere esta mensagem.\n\nAgradecemos e desejamos um ótimo dia!', true),
  ('D+1', 'Cobrança', '1 dia após o vencimento: mensagem de cobrança da parcela vencida.', -1,
   E'Bom dia, tudo bem? \n\nPassando para verificar se deu tudo certo com o link de pagamento que enviamos.\nPercebemos que o pagamento ainda não foi identificado e gostaríamos de saber se houve alguma dificuldade para realizá-lo. \n\nSe precisar de um novo link ou de qualquer auxílio, é só nos avisar.\nFicamos à disposição e agradecemos o seu retorno!', false)
on conflict (codigo) do nothing;

create table if not exists public.regua_disparos (
  id bigserial primary key,
  data date not null,
  etapa text not null,
  origem text not null default 'manual' check (origem in ('manual', 'agendada', 'migracao')),
  status text not null default 'aguardando_aprovacao' check (status in ('solicitado','aguardando_aprovacao','em_andamento','concluida','sem_clientes','falhou','cancelada')),
  aptos jsonb not null default '[]'::jsonb,          -- [{cobranca_id, cliente, parcela, vencimento, valor, tel4, numero, texto}]
  enviados jsonb not null default '[]'::jsonb,       -- [{cobranca_id, cliente, parcela, vencimento, hora, mensagem}]
  nao_enviados jsonb not null default '[]'::jsonb,   -- [{cobranca_id, cliente, parcela, vencimento, motivo, falha}]
  motivo text,
  solicitado_por uuid, aprovado_por uuid, aprovado_em timestamptz,
  iniciado_em timestamptz, concluido_em timestamptz,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (data, etapa)
);
alter table public.regua_disparos enable row level security;
drop policy if exists "regua_disparos: financeiro le" on public.regua_disparos;
create policy "regua_disparos: financeiro le" on public.regua_disparos for select to authenticated using (public.pode_financeiro());
revoke all on public.regua_disparos from anon;

-- texto da parcela ("3 de 12") e vencimento efetivo
create or replace function public.cobranca_parcela_txt(c public.cobrancas) returns text
language sql immutable as $$
  select coalesce(case when c.parcela is not null and c.total_parcelas is not null then c.parcela || ' de ' || c.total_parcelas end,
                  (select m[1] || ' de ' || m[2] from regexp_matches(coalesce(c.descricao, ''), '(\d+)\s*de\s*(\d+)', 'i') m limit 1),
                  nullif(c.descricao, ''), c.tipo)
$$;
create or replace function public.regua_quando(venc date, dia date) returns text
language sql immutable as $$
  select case when venc = dia then 'hoje'
              when extract(isodow from venc) = 6 then 'neste sábado (' || to_char(venc, 'DD/MM') || ')'
              when extract(isodow from venc) = 7 then 'neste domingo (' || to_char(venc, 'DD/MM') || ')'
              else 'em ' || to_char(venc, 'DD/MM') end
$$;
create or replace function public.regua_render(tpl text, c public.cobrancas, dia date) returns text
language sql stable as $$
  select replace(replace(replace(replace(replace(coalesce(tpl, ''),
    '{parcela}', coalesce(public.cobranca_parcela_txt(c), '')),
    '{vencimento}', to_char(coalesce(c.vencimento_negociado, c.vencimento), 'DD/MM')),
    '{valor}', public.brl(c.valor)),
    '{link}', coalesce(c.link_fatura, c.link_boleto, '')),
    '{quando}', public.regua_quando(coalesce(c.vencimento_negociado, c.vencimento), dia))
$$;

-- prévia + criação do disparo (aguardando aprovação). Regras do artefato: antes do vencimento, cliente com outra parcela vencida
-- fica de fora (inadimplente); depois, cliente com parcela vencida mais antiga fica de fora (já em cadência); sem telefone,
-- duplicado (uma mensagem por cliente) e quem já recebeu mensagem da régua hoje também ficam de fora. Sexta inclui o fim de
-- semana (D-5/D-2/D-0) e segunda inclui sex–dom (D+1 etc.).
create or replace function public.regua_preparar(p_etapa text, p_data date default null, p_origem text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare et public.regua_etapas; dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date); dow int; alvos int[];
        r record; cob public.cobrancas; aptos jsonb := '[]'::jsonb; fora jsonb := '[]'::jsonb; vistos text[] := '{}'; motivo text; num text; d_id bigint; st text;
begin
  if p_origem = 'manual' and not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into et from public.regua_etapas where codigo = p_etapa and ativa;
  if et.codigo is null then raise exception 'Etapa não encontrada.'; end if;
  if coalesce(et.mensagem, '') = '' then raise exception 'Cadastre a mensagem da etapa antes de disparar.'; end if;
  dow := extract(isodow from dia);
  alvos := array[et.dias];
  if et.dias >= 0 and dow = 5 then alvos := alvos || array[et.dias + 1, et.dias + 2]; end if;
  if et.dias < 0 and dow = 1 then alvos := alvos || array[et.dias - 1, et.dias - 2]; end if;
  for r in
    select c.*, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, c.asaas_cliente_id) as cliente_nome,
           coalesce(ac.telefone, (select ct.telefone from public.contatos ct where ct.cliente_id = c.cliente_id and ct.telefone is not null order by ct.principal desc nulls last limit 1)) as telefone,
           coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente
      from public.cobrancas c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
     where c.status in ('pendente', 'atrasada') and not c.baixa_manual and coalesce(c.vencimento_negociado, c.vencimento) is not null
       and (coalesce(c.vencimento_negociado, c.vencimento) - dia) = any(alvos)
     order by cliente_nome, coalesce(c.vencimento_negociado, c.vencimento)
  loop
    motivo := null;
    select * into cob from public.cobrancas where id = r.id;
    if et.dias >= 0 and exists (select 1 from public.cobrancas o where o.id <> r.id and coalesce(o.asaas_cliente_id, o.cliente_id) = r.chave_cliente and o.status in ('pendente','atrasada') and not o.baixa_manual and coalesce(o.vencimento_negociado, o.vencimento) < dia) then
      motivo := 'inadimplente (outra parcela vencida)';
    elsif et.dias < 0 and exists (select 1 from public.cobrancas o where o.id <> r.id and coalesce(o.asaas_cliente_id, o.cliente_id) = r.chave_cliente and o.status in ('pendente','atrasada') and not o.baixa_manual and coalesce(o.vencimento_negociado, o.vencimento) < r.venc_ef) then
      motivo := 'já em cadência (outras parcelas vencidas)';
    elsif r.chave_cliente = any(vistos) then
      motivo := 'duplicado (uma mensagem por cliente)';
    elsif nullif(regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g'), '') is null then
      motivo := 'sem telefone';
    elsif exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:%' and m.status <> 'cancelada' and (m.enviar_em at time zone 'America/Sao_Paulo')::date = dia
                    and (m.numero = regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g') or m.numero = '55' || regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g'))) then
      motivo := 'já recebeu mensagem da régua hoje';
    end if;
    if motivo is not null then
      fora := fora || jsonb_build_object('cobranca_id', r.id, 'cliente', r.cliente_nome, 'parcela', public.cobranca_parcela_txt(cob), 'vencimento', to_char(r.venc_ef, 'DD/MM/YYYY'), 'motivo', motivo);
      continue;
    end if;
    vistos := vistos || r.chave_cliente;
    num := regexp_replace(r.telefone, '[^0-9]', '', 'g'); if length(num) <= 11 then num := '55' || num; end if;
    aptos := aptos || jsonb_build_object('cobranca_id', r.id, 'cliente', r.cliente_nome, 'parcela', public.cobranca_parcela_txt(cob), 'vencimento', to_char(r.venc_ef, 'DD/MM/YYYY'),
                                         'valor', public.brl(r.valor), 'tel4', right(num, 4), 'numero', num, 'texto', public.regua_render(et.mensagem, cob, dia));
  end loop;
  st := case when jsonb_array_length(aptos) = 0 then 'sem_clientes' else 'aguardando_aprovacao' end;
  insert into public.regua_disparos (data, etapa, origem, status, aptos, nao_enviados, solicitado_por, motivo)
  values (dia, p_etapa, p_origem, st, aptos, fora, auth.uid(), case when st = 'sem_clientes' then 'Nenhuma cobrança se encaixa nesta etapa hoje.' end)
  on conflict (data, etapa) do update set status = case when regua_disparos.status in ('em_andamento', 'concluida') then regua_disparos.status else excluded.status end,
    aptos = case when regua_disparos.status in ('em_andamento', 'concluida') then regua_disparos.aptos else excluded.aptos end,
    nao_enviados = case when regua_disparos.status in ('em_andamento', 'concluida') then regua_disparos.nao_enviados else excluded.nao_enviados end,
    origem = excluded.origem, solicitado_por = excluded.solicitado_por, motivo = excluded.motivo, atualizado_em = now()
  returning id into d_id;
  return (select to_jsonb(d) from public.regua_disparos d where d.id = d_id);
end $$;
revoke all on function public.regua_preparar(text, date, text) from public, anon;

-- aprovar: enfileira as mensagens (ChatGuru, horário comercial) e acompanha o resultado
create or replace function public.regua_aprovar(p_disparo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.regua_disparos; a jsonb; n int := 0;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into d from public.regua_disparos where id = p_disparo for update;
  if d.id is null then raise exception 'Disparo não encontrado.'; end if;
  if d.status <> 'aguardando_aprovacao' then raise exception 'Este disparo não está aguardando aprovação (%).', d.status; end if;
  for a in select value from jsonb_array_elements(d.aptos) loop
    insert into public.mensagens_fila (cliente_id, nome, numero, texto, referencia, enviar_em)
    values ((select cliente_id from public.cobrancas where id = (a->>'cobranca_id')::uuid), a->>'cliente', a->>'numero', a->>'texto', 'regua:' || d.id || ':' || (a->>'cobranca_id'), now());
    n := n + 1;
  end loop;
  update public.regua_disparos set status = 'em_andamento', aprovado_por = auth.uid(), aprovado_em = now(), iniciado_em = now(), atualizado_em = now() where id = d.id;
  return jsonb_build_object('ok', true, 'enfileiradas', n);
end $$;
revoke all on function public.regua_aprovar(bigint) from public, anon;

create or replace function public.regua_cancelar(p_disparo bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.mensagens_fila set status = 'cancelada', resultado = 'Disparo cancelado', atualizado_em = now() where referencia like 'regua:' || p_disparo || ':%' and status = 'pendente';
  update public.regua_disparos set status = 'cancelada', motivo = 'Cancelado pela equipe', atualizado_em = now() where id = p_disparo and status in ('aguardando_aprovacao', 'em_andamento', 'solicitado');
end $$;
revoke all on function public.regua_cancelar(bigint) from public, anon;

-- consolida o resultado das mensagens da régua no disparo (chamado após cada lote de envio)
create or replace function public.regua_disparos_atualizar() returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  for d in select * from public.regua_disparos where status = 'em_andamento' loop
    update public.regua_disparos x set
      enviados = coalesce((select jsonb_agg(jsonb_build_object('cobranca_id', split_part(m.referencia, ':', 3), 'cliente', m.nome, 'hora', to_char(m.enviada_em at time zone 'America/Sao_Paulo', 'HH24:MI'), 'mensagem', m.texto,
                                                 'parcela', a->>'parcela', 'vencimento', a->>'vencimento') order by m.enviada_em)
                             from public.mensagens_fila m left join jsonb_array_elements(d.aptos) a on a->>'cobranca_id' = split_part(m.referencia, ':', 3)
                            where m.referencia like 'regua:' || d.id || ':%' and m.status = 'enviada'), '[]'::jsonb),
      nao_enviados = (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(d.nao_enviados) f where coalesce(f->>'falha', 'false') <> 'true')
                     || coalesce((select jsonb_agg(jsonb_build_object('cobranca_id', split_part(m.referencia, ':', 3), 'cliente', m.nome, 'motivo', 'falha no envio: ' || coalesce(m.resultado, ''), 'falha', true,
                                                        'parcela', a->>'parcela', 'vencimento', a->>'vencimento'))
                                    from public.mensagens_fila m left join jsonb_array_elements(d.aptos) a on a->>'cobranca_id' = split_part(m.referencia, ':', 3)
                                   where m.referencia like 'regua:' || d.id || ':%' and m.status in ('erro', 'cancelada')), '[]'::jsonb),
      status = case when exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:' || d.id || ':%' and m.status in ('pendente', 'processando')) then 'em_andamento' else 'concluida' end,
      concluido_em = case when exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:' || d.id || ':%' and m.status in ('pendente', 'processando')) then null else now() end,
      atualizado_em = now()
    where x.id = d.id;
  end loop;
end $$;

-- envio registrado também nos disparos da régua
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
        values (m.cliente_id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'WhatsApp enviado: ' || coalesce((select titulo from public.mensagens_modelos where chave = m.modelo), m.modelo, case when m.referencia like 'regua:%' then 'régua de cobrança' else 'mensagem' end), false, true, 'onboarding');
      end if;
      if m.lead_id is not null then
        insert into public.observacoes (lead_id, texto) values (m.lead_id, 'Automação do CRM:' || E'\n' || coalesce(m.texto, ''));
        update public.leads set ultima_interacao_em = now() where id = m.lead_id;
      end if;
    elsif coalesce((it->>'temporario')::boolean, false) and m.tentativas < 3 then
      update public.mensagens_fila set status = 'pendente', enviar_em = now() + interval '5 minutes', resultado = it->>'erro', atualizado_em = now() where id = m.id;
    else
      update public.mensagens_fila set status = 'erro', resultado = it->>'erro', atualizado_em = now() where id = m.id;
      if m.cliente_id is not null and m.referencia not like 'regua:%' then
        perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = m.cliente_id), 'WhatsApp não enviado',
          coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#clientes/' || coalesce(m.cliente_id, ''));
      elsif m.lead_id is not null then
        perform public.notificar((select proprietario_id from public.leads where id = m.lead_id), 'Mensagem automática não enviada',
          coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#leads');
      end if;
    end if;
  end loop;
  perform public.fluxos_concluir_prontos();
  perform public.regua_disparos_atualizar();
end $$;
revoke all on function public.mensagens_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.mensagens_registrar(text, jsonb) to service_role;

-- etapas automáticas: preparam o disparo nos dias úteis e avisam o financeiro (aprovação continua manual)
create or replace function public.regua_preparar_automaticas() returns integer
language plpgsql security definer set search_path = public as $$
declare et record; n int := 0; d jsonb; resp uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if extract(isodow from hoje) > 5 then return 0; end if;
  for et in select * from public.regua_etapas where ativa and automatica and coalesce(mensagem, '') <> '' loop
    continue when exists (select 1 from public.regua_disparos x where x.data = hoje and x.etapa = et.codigo);
    d := public.regua_preparar(et.codigo, hoje, 'agendada');
    n := n + 1;
    if d->>'status' = 'aguardando_aprovacao' then
      resp := public.responsavel_padrao('administrativo');
      perform public.notificar_colaborador(resp, 'Régua ' || et.codigo || ' aguardando aprovação', jsonb_array_length(d->'aptos') || ' cliente(s) para receber "' || et.titulo || '" hoje. Aprove em Financeiro → Central de Cobranças.', '#financeiro');
    end if;
  end loop;
  return n;
end $$;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'regua-central-np';
  perform cron.schedule('regua-central-np', '55 11 * * 1-5', $c$ select public.regua_preparar_automaticas(); $c$);  -- 08:55 BRT
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

-- ---------- views ----------
drop view if exists public.v_central_cobrancas;
create view public.v_central_cobrancas with (security_invoker = true) as
select c.id, c.asaas_id, c.cliente_id, c.asaas_cliente_id, coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente,
       coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, '(cliente ' || coalesce(c.asaas_cliente_id, '?') || ')') as cliente_nome,
       coalesce(ac.telefone, (select ct.telefone from public.contatos ct where ct.cliente_id = c.cliente_id and ct.telefone is not null order by ct.principal desc nulls last limit 1)) as telefone,
       c.tipo, c.descricao, public.cobranca_parcela_txt(c) as parcela_txt, c.valor, c.vencimento, c.vencimento_negociado, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef,
       c.status, c.pago_em, c.baixa_manual, (c.status = 'paga' or c.baixa_manual) as paga, c.link_fatura, c.link_boleto,
       (select jsonb_build_object('id', k.id, 'data', k.data, 'desfecho', k.desfecho, 'observacao', k.observacao, 'nova_data', k.nova_data, 'created_at', k.created_at)
          from public.cobranca_contatos k where k.cobranca_id = c.id order by k.data desc, k.created_at desc limit 1) as ultimo_contato,
       exists (select 1 from public.cobranca_contatos k where k.cobranca_id = c.id and k.desfecho = 'NEGOCIOU') as negociada,
       exists (select 1 from public.cobranca_checks ck where ck.cobranca_id = c.id and ck.data = (now() at time zone 'America/Sao_Paulo')::date) as check_hoje
  from public.cobrancas c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
 where c.status in ('pendente', 'atrasada', 'paga');
revoke all on public.v_central_cobrancas from anon;

create or replace view public.v_cobranca_contatos with (security_invoker = true) as
select k.*, coalesce(p.nome, p.email) as registrado_por_nome from public.cobranca_contatos k left join public.perfis p on p.id = k.registrado_por;
revoke all on public.v_cobranca_contatos from anon;

select 'ok 0076' as resultado;


select 'ok parte 8/9' as resultado;
