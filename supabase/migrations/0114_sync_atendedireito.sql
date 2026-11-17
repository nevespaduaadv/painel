-- 0114 — Integração AtendeDireito Sync (intimações/publicações e sugestão de prazo). DESLIGADA por padrão.
--
-- Princípios:
--   • O Sync COMPLEMENTA o que já existe (DJEN por OAB, DataJud). Nada é substituído em silêncio.
--   • Uma comunicação = UMA linha em public.publicacoes, venha de onde vier. Cada fonte que a trouxe fica em publicacao_fontes.
--   • Nenhum dado já analisado pelo Jurídico é sobrescrito: divergência entre fontes é REGISTRADA para conciliação humana.
--   • Prazo calculado pela plataforma é só SUGESTÃO (publicacao_prazos.estado = 'sugerido'). Só vira prazo do sistema
--     (tarefa, com ou sem "fatal") por conferência humana registrada: quem, quando, e cada ajuste no histórico.
--   • Nada aqui dá ciência, trata, baixa ou escreve no Sync. Esta migração não chama serviço externo e não cria agendamento.
--
-- Quem fala com o fornecedor é a Edge Function "sync" (chave e segredo ficam só no servidor). Ela entrega ao banco um
-- objeto JÁ NORMALIZADO; os nomes de campo do fornecedor ficam só no adaptador (supabase/functions/sync/adaptador.mjs).
-- Depende de: 0014/0081 (publicações do DJEN e gatilho de vínculo), 0035 (tarefas.publicacao_id), 0080 (tratamento e histórico).
-- Idempotente. Reversão no fim do arquivo (comentada).

-- ---------- 1. chave geral (desligada) ----------
create table if not exists public.integracoes (
  id text primary key,
  ativo boolean not null default false,
  config jsonb not null default '{}'::jsonb,       -- sem segredos: só preferências (ex.: dias da janela, limite de páginas)
  estado jsonb not null default '{}'::jsonb,       -- última verificação de conexão, feita pelo servidor
  atualizado_em timestamptz not null default now(), atualizado_por uuid
);
alter table public.integracoes enable row level security;
drop policy if exists integracoes_sel on public.integracoes;
create policy integracoes_sel on public.integracoes for select to authenticated using (public.sou_equipe());
revoke all on public.integracoes from anon, authenticated; grant select on public.integracoes to authenticated;
insert into public.integracoes (id, ativo, config) values ('sync', false, '{"janela_dias": 7, "max_paginas": 5, "itens_por_pagina": 100}'::jsonb) on conflict (id) do nothing;

create or replace function public.sync_ativo() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from public.integracoes where id = 'sync'), false) $$;

-- liga/desliga: só a administradora; fica na auditoria do histórico de execuções
create or replace function public.sync_definir(p_ativo boolean, p_config jsonb default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then raise exception 'Só a administradora liga ou desliga a integração.' using errcode = '42501'; end if;
  update public.integracoes set ativo = coalesce(p_ativo, ativo), config = coalesce(p_config, config), atualizado_em = now(), atualizado_por = auth.uid() where id = 'sync';
  insert into public.sync_execucoes (origem, status, resumo, por) values ('configuracao', 'ok', jsonb_build_object('ativo', p_ativo, 'config', p_config), auth.uid());
end $$;

-- ---------- 2. histórico de sincronização e caixa de eventos ----------
create table if not exists public.sync_execucoes (
  id bigserial primary key,
  origem text not null check (origem in ('manual', 'agendada', 'webhook', 'teste_conexao', 'configuracao')),
  iniciada_em timestamptz not null default now(), terminada_em timestamptz,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'ok', 'parcial', 'erro', 'desligada')),
  resumo jsonb not null default '{}'::jsonb,       -- contagens: recebidas, novas, repetidas, anexadas, divergentes, sem_processo, quarentena, paginas
  erro text,                                        -- categoria + mensagem curta (sem conteúdo de processo, sem credencial)
  por uuid
);
create table if not exists public.sync_eventos (
  id bigserial primary key,
  recebido_em timestamptz not null default now(),
  canal text not null check (canal in ('webhook', 'consulta')),
  tipo text,                                        -- tipo do evento informado pelo fornecedor (ex.: intimacao.criada)
  impressao text not null,                          -- sha256 do corpo recebido: evento repetido não é processado de novo
  assinatura_ok boolean,
  status text not null default 'novo' check (status in ('novo', 'processado', 'repetido', 'quarentena', 'erro', 'ignorado_desligada', 'assinatura_invalida')),
  resultado jsonb not null default '{}'::jsonb,
  erro text,
  corpo jsonb,                                      -- como chegou (para conciliação); nunca gravado quando a assinatura é inválida
  processado_em timestamptz
);
create unique index if not exists sync_eventos_impressao_uq on public.sync_eventos (impressao);
create index if not exists sync_eventos_status_idx on public.sync_eventos (status, recebido_em desc);
alter table public.sync_execucoes enable row level security; alter table public.sync_eventos enable row level security;
drop policy if exists sync_exec_sel on public.sync_execucoes; create policy sync_exec_sel on public.sync_execucoes for select to authenticated using (public.sou_admin() or public.tem_acesso('juridico'));
drop policy if exists sync_ev_sel on public.sync_eventos; create policy sync_ev_sel on public.sync_eventos for select to authenticated using (public.sou_admin());
revoke all on public.sync_execucoes, public.sync_eventos from anon, authenticated; grant select on public.sync_execucoes, public.sync_eventos to authenticated;

-- ---------- 3. origem de cada publicação ----------
alter table public.publicacoes add column if not exists origem text not null default 'djen' check (origem in ('djen', 'sync'));
create sequence if not exists public.publicacoes_sync_seq;                 -- ids NEGATIVOS para o que chega só pelo Sync (o id positivo é o do DJEN)
create or replace function public.publicacao_impressao(p_numero text, p_data date, p_texto text) returns text language sql immutable as $$
  select case when regexp_replace(coalesce(p_numero, ''), '\D', '', 'g') = '' or p_data is null then null
              else md5(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g') || '|' || p_data::text || '|' ||
                       left(regexp_replace(lower(regexp_replace(coalesce(p_texto, ''), '<[^>]+>', ' ', 'g')), '[^a-z0-9áàâãéêíóôõúç]+', '', 'g'), 400)) end $$;
-- impressão = processo + data + texto normalizado: reconhece a MESMA comunicação vinda por outra fonte. Índice por expressão:
-- nenhuma linha existente do DJEN é alterada.
create index if not exists publicacoes_impressao_idx on public.publicacoes (public.publicacao_impressao(numero_processo, data_disponibilizacao, texto));

create table if not exists public.publicacao_fontes (
  id bigserial primary key,
  publicacao_id bigint not null references public.publicacoes (id) on delete cascade,
  fonte text not null check (fonte in ('djen', 'sync', 'datajud')),
  id_externo text not null,
  casamento text not null check (casamento in ('origem', 'mesmo_id', 'identica', 'provavel')),  -- como esta fonte foi ligada à publicação
  divergencias jsonb not null default '[]'::jsonb,   -- [{campo, nosso, fonte}] — para conciliação; nada é sobrescrito
  conciliada_em timestamptz, conciliada_por uuid, conciliacao text check (conciliacao is null or conciliacao in ('mesma', 'outra')),
  link text, bruto jsonb,
  primeira_vez timestamptz not null default now(), ultima_vez timestamptz not null default now(), vezes integer not null default 1,
  unique (fonte, id_externo)
);
create index if not exists publicacao_fontes_pub_idx on public.publicacao_fontes (publicacao_id);
alter table public.publicacao_fontes enable row level security;
drop policy if exists pf_sel on public.publicacao_fontes; create policy pf_sel on public.publicacao_fontes for select to authenticated using (public.sou_equipe());
revoke all on public.publicacao_fontes from anon, authenticated; grant select on public.publicacao_fontes to authenticated;

-- ---------- 4. prazos: sugestão × conferência humana × prazo do sistema ----------
create table if not exists public.publicacao_prazos (
  id bigserial primary key,
  publicacao_id bigint not null references public.publicacoes (id) on delete cascade,
  origem text not null check (origem in ('sync', 'manual')),
  chave_externa text,                               -- "chave" da obrigação no Sync (uma por hipótese de prazo do mesmo ato)
  rotulo text,                                      -- ex.: "Embargos de declaração — 5 dias úteis" (como veio da plataforma)
  data_sugerida date,                               -- PRAZO SUGERIDO PELA API (nunca usado como prazo do sistema)
  detalhe jsonb not null default '{}'::jsonb,       -- restrição, estado na plataforma e demais campos da sugestão
  estado text not null default 'sugerido' check (estado in ('sugerido', 'confirmado', 'corrigido', 'descartado')),
  data_conferida date,                              -- PRAZO CONFERIDO PELO ADVOGADO
  fatal boolean,                                    -- só preenchido na conferência humana
  conferido_por uuid references public.perfis (id) on delete set null, conferido_por_nome text, conferido_em timestamptz,
  observacao text,
  tarefa_id uuid references public.tarefas (id) on delete set null,   -- PRAZO OFICIALMENTE REGISTRADO (a tarefa)
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create unique index if not exists publicacao_prazos_ext_uq on public.publicacao_prazos (publicacao_id, origem, chave_externa) where chave_externa is not null;
create index if not exists publicacao_prazos_pub_idx on public.publicacao_prazos (publicacao_id);
create index if not exists publicacao_prazos_pend_idx on public.publicacao_prazos (estado) where estado = 'sugerido';
create table if not exists public.publicacao_prazo_historico (
  id bigserial primary key, prazo_id bigint not null references public.publicacao_prazos (id) on delete cascade,
  acao text not null,                               -- sugerido | sugestao_alterada | confirmado | corrigido | descartado | reaberto | tarefa_criada | tarefa_vinculada
  de jsonb, para jsonb, observacao text, por uuid, por_nome text, em timestamptz not null default now()
);
alter table public.publicacao_prazos enable row level security; alter table public.publicacao_prazo_historico enable row level security;
drop policy if exists pp_sel on public.publicacao_prazos; create policy pp_sel on public.publicacao_prazos for select to authenticated using (public.sou_equipe());
drop policy if exists pph_sel on public.publicacao_prazo_historico; create policy pph_sel on public.publicacao_prazo_historico for select to authenticated using (public.sou_equipe());
revoke all on public.publicacao_prazos, public.publicacao_prazo_historico from anon, authenticated;
grant select on public.publicacao_prazos, public.publicacao_prazo_historico to authenticated;

-- ---------- 5. DJEN chegando depois do Sync: não duplica ----------
-- Se a MESMA comunicação (mesma impressão) já entrou pelo Sync, a linha do DJEN não é criada: o id do DJEN é anotado como
-- mais uma fonte da publicação existente. O nome do gatilho o põe ANTES de "publicacoes_vincular" (ordem alfabética),
-- então nenhum andamento nem tarefa é criado para a cópia. Sem linha vinda do Sync, o gatilho não faz nada.
create or replace function public.publicacao_dedup_fontes_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare alvo bigint; imp text;
begin
  if new.id <= 0 or not exists (select 1 from public.publicacoes where origem = 'sync' limit 1) then return new; end if;   -- sem nada vindo do Sync, não faz nada
  imp := public.publicacao_impressao(new.numero_processo, new.data_disponibilizacao, new.texto);
  if imp is not null and not exists (select 1 from public.publicacoes where id = new.id) then
    select id into alvo from public.publicacoes where public.publicacao_impressao(numero_processo, data_disponibilizacao, texto) = imp and origem = 'sync' and id < 0 order by id desc limit 1;
    if alvo is not null then
      insert into public.publicacao_fontes (publicacao_id, fonte, id_externo, casamento, link, bruto)
      values (alvo, 'djen', new.id::text, 'identica', new.link, new.bruto)
      on conflict (fonte, id_externo) do update set ultima_vez = now(), vezes = public.publicacao_fontes.vezes + 1;
      return null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists publicacoes_a_dedup_fontes on public.publicacoes;
create trigger publicacoes_a_dedup_fontes before insert on public.publicacoes for each row execute function public.publicacao_dedup_fontes_tg();

-- ---------- 6. entrada de uma intimação normalizada ----------
-- p: { id_externo*, numero_processo*, data_publicacao*, tribunal, orgao, tipo_ato, texto, link, djen_id, destinatarios, advogados,
--      prazos: [{chave, rotulo, data_fatal, restricao, estado}], bruto }
-- Devolve { acao: desligada | quarentena | repetida | anexada | divergente | nova | nova_possivel_duplicata, publicacao_id, sem_processo, prazos_novos }.
create or replace function public.sync_receber_intimacao(p jsonb, p_execucao bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ext text := nullif(btrim(p ->> 'id_externo'), ''); num text := nullif(btrim(p ->> 'numero_processo'), ''); dt date; txt text := coalesce(p ->> 'texto', '');
        imp text; f public.publicacao_fontes; alvo public.publicacoes; casam text; div jsonb := '[]'::jsonb; novo bigint; acao text; np integer := 0; pz jsonb; pr public.publicacao_prazos; d date;
begin
  if not public.sync_ativo() then return jsonb_build_object('acao', 'desligada'); end if;
  begin dt := (p ->> 'data_publicacao')::date; exception when others then dt := null; end;
  if ext is null or num is null or dt is null then
    return jsonb_build_object('acao', 'quarentena', 'faltando', (select jsonb_agg(k) from (values ('id_externo', ext is null), ('numero_processo', num is null), ('data_publicacao', dt is null)) v(k, falta) where falta));
  end if;
  -- (a) já recebida do Sync: só conta a repetição
  select * into f from public.publicacao_fontes where fonte = 'sync' and id_externo = ext;
  if f.id is not null then
    update public.publicacao_fontes set ultima_vez = now(), vezes = vezes + 1 where id = f.id;
    novo := f.publicacao_id; acao := 'repetida';
  else
    imp := public.publicacao_impressao(num, dt, txt);
    -- (b) é a MESMA comunicação que já temos? Só por identificador real (id do DJEN, se a fonte informar) ou por texto idêntico.
    if nullif(p ->> 'djen_id', '') is not null and (p ->> 'djen_id') ~ '^\d+$' then select * into alvo from public.publicacoes where id = (p ->> 'djen_id')::bigint; if alvo.id is not null then casam := 'mesmo_id'; end if; end if;
    if alvo.id is null and imp is not null then
      select * into alvo from public.publicacoes where public.publicacao_impressao(numero_processo, data_disponibilizacao, texto) = imp order by (origem = 'djen') desc, id limit 1;
      if alvo.id is not null then casam := 'identica'; end if;
    end if;
    if alvo.id is not null then
      -- anexa a fonte; registra o que difere; NÃO altera a publicação existente (nem a análise já feita)
      if casam = 'mesmo_id' and public.publicacao_impressao(alvo.numero_processo, alvo.data_disponibilizacao, alvo.texto) is distinct from imp then div := div || jsonb_build_object('campo', 'texto', 'nosso', left(coalesce(alvo.texto, ''), 300), 'fonte', left(txt, 300)); end if;
      if nullif(p ->> 'tribunal', '') is not null and alvo.tribunal is not null and upper(p ->> 'tribunal') <> upper(alvo.tribunal) then div := div || jsonb_build_object('campo', 'tribunal', 'nosso', alvo.tribunal, 'fonte', p ->> 'tribunal'); end if;
      if alvo.data_disponibilizacao <> dt then div := div || jsonb_build_object('campo', 'data', 'nosso', alvo.data_disponibilizacao, 'fonte', dt); end if;
      insert into public.publicacao_fontes (publicacao_id, fonte, id_externo, casamento, divergencias, link, bruto) values (alvo.id, 'sync', ext, casam, div, nullif(p ->> 'link', ''), p -> 'bruto');
      novo := alvo.id; acao := case when jsonb_array_length(div) > 0 then 'divergente' else 'anexada' end;
      insert into public.publicacao_historico (publicacao_id, acao, detalhe) values (alvo.id, 'fonte_sync', jsonb_build_object('casamento', casam, 'divergencias', jsonb_array_length(div)));
    else
      -- (c) não é comprovadamente a mesma: entra como publicação própria, à vista do Jurídico. Na dúvida, NUNCA esconder um ato.
      --     Se já existe outra do mesmo processo e dia, fica marcada como "possível duplicata" para conciliação humana — e o
      --     gatilho existente junta as duas na MESMA tarefa "Analisar publicações" (não abre tarefa nova).
      select coalesce(jsonb_agg(jsonb_build_object('campo', 'possivel_duplicata', 'nosso', x.id, 'fonte', ext)), '[]'::jsonb) into div
        from (select id from public.publicacoes where numero_processo_digitos = regexp_replace(num, '\D', '', 'g') and data_disponibilizacao = dt order by id limit 5) x;
      casam := case when jsonb_array_length(div) > 0 then 'provavel' else 'origem' end;
      novo := -nextval('public.publicacoes_sync_seq');
      insert into public.publicacoes (id, origem, data_disponibilizacao, tribunal, orgao, tipo_comunicacao, tipo_documento, numero_processo, link, texto, destinatarios, advogados, bruto)
      values (novo, 'sync', dt, nullif(p ->> 'tribunal', ''), nullif(p ->> 'orgao', ''), 'Intimação', nullif(p ->> 'tipo_ato', ''), num, nullif(p ->> 'link', ''),
              trim(regexp_replace(regexp_replace(txt, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')),
              case when jsonb_typeof(p -> 'destinatarios') = 'array' then p -> 'destinatarios' else '[]'::jsonb end, case when jsonb_typeof(p -> 'advogados') = 'array' then p -> 'advogados' else '[]'::jsonb end, p -> 'bruto');
      update public.andamentos a set fonte = 'sync', id_externo = 'sync:' || ext from public.publicacoes pb where pb.id = novo and a.id = pb.andamento_id;
      insert into public.publicacao_fontes (publicacao_id, fonte, id_externo, casamento, divergencias, link, bruto) values (novo, 'sync', ext, casam, div, nullif(p ->> 'link', ''), p -> 'bruto');
      acao := case when casam = 'provavel' then 'nova_possivel_duplicata' else 'nova' end;
    end if;
  end if;
  -- prazos: SEMPRE como sugestão. Sugestão já conferida por uma pessoa não é tocada; mudança da plataforma fica no histórico.
  if jsonb_typeof(p -> 'prazos') = 'array' then
    for pz in select * from jsonb_array_elements(p -> 'prazos') loop
      continue when nullif(pz ->> 'chave', '') is null;
      begin d := (pz ->> 'data_fatal')::date; exception when others then d := null; end;
      select * into pr from public.publicacao_prazos where publicacao_id = novo and origem = 'sync' and chave_externa = pz ->> 'chave';
      if pr.id is null then
        insert into public.publicacao_prazos (publicacao_id, origem, chave_externa, rotulo, data_sugerida, detalhe) values (novo, 'sync', pz ->> 'chave', nullif(pz ->> 'rotulo', ''), d, pz - 'chave' - 'rotulo' - 'data_fatal') returning * into pr;
        insert into public.publicacao_prazo_historico (prazo_id, acao, para) values (pr.id, 'sugerido', jsonb_build_object('data_sugerida', d, 'rotulo', pr.rotulo));
        np := np + 1;
      elsif pr.data_sugerida is distinct from d or pr.rotulo is distinct from nullif(pz ->> 'rotulo', '') then
        insert into public.publicacao_prazo_historico (prazo_id, acao, de, para) values (pr.id, 'sugestao_alterada', jsonb_build_object('data_sugerida', pr.data_sugerida, 'rotulo', pr.rotulo), jsonb_build_object('data_sugerida', d, 'rotulo', nullif(pz ->> 'rotulo', '')));
        update public.publicacao_prazos set data_sugerida = d, rotulo = nullif(pz ->> 'rotulo', ''), detalhe = pz - 'chave' - 'rotulo' - 'data_fatal', atualizado_em = now() where id = pr.id;   -- data_conferida, estado e tarefa ficam como estão
      end if;
    end loop;
  end if;
  return jsonb_build_object('acao', acao, 'publicacao_id', novo, 'casamento', casam, 'divergencias', jsonb_array_length(div), 'prazos_novos', np,
                            'sem_processo', (select processo_id is null from public.publicacoes where id = novo));
end $$;
revoke all on function public.sync_receber_intimacao(jsonb, bigint) from public, anon, authenticated;   -- só o servidor (service_role) entrega

-- ---------- 7. conferência humana do prazo ----------
-- p_decisao: confirmar (aceita a data sugerida) | corrigir (informa outra data) | descartar (não é prazo) | reabrir
-- Só aqui uma data vira prazo do sistema. Tarefa: no máximo UMA por prazo; se a publicação já tem a tarefa "Analisar publicação"
-- aberta, ela é a que recebe o prazo conferido (não se cria outra). "Fatal" só existe se a pessoa marcar.
create or replace function public.publicacao_prazo_conferir(p_prazo bigint, p_decisao text, p_data date default null, p_fatal boolean default false, p_obs text default null, p_tarefa boolean default true, p_responsavel uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.publicacao_prazos; pb public.publicacoes; nome text; dt date; t uuid; antes jsonb; criou boolean := false; mais_cedo date;
begin
  if not (public.sou_admin() or (public.sou_equipe() and public.tem_acesso('juridico'))) then raise exception 'Só o Jurídico confere prazos.' using errcode = '42501'; end if;
  if p_decisao not in ('confirmar', 'corrigir', 'descartar', 'reabrir') then raise exception 'Decisão inválida.' using errcode = '22023'; end if;
  select * into pr from public.publicacao_prazos where id = p_prazo for update;
  if pr.id is null then raise exception 'Prazo não encontrado.' using errcode = 'P0002'; end if;
  select * into pb from public.publicacoes where id = pr.publicacao_id;
  select pf.nome into nome from public.perfis pf where pf.id = auth.uid();
  antes := jsonb_build_object('estado', pr.estado, 'data_conferida', pr.data_conferida, 'fatal', pr.fatal, 'tarefa_id', pr.tarefa_id);
  if p_decisao = 'reabrir' then
    if length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da reabertura.' using errcode = '22023'; end if;
    update public.publicacao_prazos set estado = 'sugerido', atualizado_em = now() where id = pr.id;   -- a conferência anterior fica no histórico; a tarefa não é apagada
    insert into public.publicacao_prazo_historico (prazo_id, acao, de, observacao, por, por_nome) values (pr.id, 'reaberto', antes, btrim(p_obs), auth.uid(), nome);
    return jsonb_build_object('estado', 'sugerido');
  end if;
  if pr.estado <> 'sugerido' then raise exception 'Este prazo já foi conferido. Reabra antes de mudar.' using errcode = '23514'; end if;
  if p_decisao = 'descartar' then
    if length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe por que a sugestão não se aplica.' using errcode = '22023'; end if;
    update public.publicacao_prazos set estado = 'descartado', conferido_por = auth.uid(), conferido_por_nome = nome, conferido_em = now(), observacao = btrim(p_obs), atualizado_em = now() where id = pr.id;
    insert into public.publicacao_prazo_historico (prazo_id, acao, de, observacao, por, por_nome) values (pr.id, 'descartado', antes, btrim(p_obs), auth.uid(), nome);
    return jsonb_build_object('estado', 'descartado');
  end if;
  dt := case when p_decisao = 'confirmar' then coalesce(p_data, pr.data_sugerida) else p_data end;
  if dt is null then raise exception 'Informe a data do prazo.' using errcode = '22023'; end if;
  if p_decisao = 'confirmar' and dt is distinct from pr.data_sugerida then raise exception 'A data difere da sugerida: use "corrigir" e registre o motivo.' using errcode = '22023'; end if;
  if p_decisao = 'corrigir' and length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da correção.' using errcode = '22023'; end if;
  t := pr.tarefa_id;
  if p_tarefa and t is null then
    -- reaproveita a tarefa aberta da própria publicação; senão cria UMA
    select tf.id into t from public.tarefas tf where tf.id = pb.tarefa_id and tf.status in ('aberta', 'em_andamento');
    if t is null then select tf.id into t from public.tarefas tf where tf.publicacao_id = pb.id and tf.status in ('aberta', 'em_andamento') order by tf.created_at limit 1; end if;
    if t is not null then
      -- Um ato pode ter mais de uma hipótese de prazo (ex.: embargos em 5 dias e agravo em 15). A tarefa única da publicação
      -- fica com o prazo conferido MAIS PRÓXIMO; os demais ficam listados na descrição e em publicacao_prazos.
      -- (o gatilho de disciplina de prazos exige motivo quando uma pessoa muda o prazo: o motivo é a própria conferência)
      select min(z.data_conferida) into mais_cedo from public.publicacao_prazos z where z.tarefa_id = t and z.id <> pr.id and z.estado in ('confirmado', 'corrigido');
      update public.tarefas set
             prazo = case when mais_cedo is null or dt < mais_cedo then dt else prazo end,
             prazo_fatal = case when mais_cedo is null or dt < mais_cedo then coalesce(p_fatal, false) when dt = mais_cedo then prazo_fatal or coalesce(p_fatal, false) else prazo_fatal end,
             motivo_reagendamento = case when mais_cedo is null or dt < mais_cedo then 'Prazo conferido a partir da publicação' || coalesce(' — ' || nullif(btrim(coalesce(p_obs, '')), ''), '') else null end,
             descricao = coalesce(descricao, '') || E'\n\nPrazo conferido por ' || coalesce(nome, 'Jurídico') || ': ' || coalesce(pr.rotulo, 'prazo') || ' — ' || to_char(dt, 'DD/MM/YYYY') || case when coalesce(p_fatal, false) then ' (fatal)' else '' end,
             updated_at = now()
       where id = t;
      insert into public.publicacao_prazo_historico (prazo_id, acao, para, por, por_nome) values (pr.id, 'tarefa_vinculada', jsonb_build_object('tarefa_id', t, 'prazo', dt, 'fatal', coalesce(p_fatal, false)), auth.uid(), nome);
    else
      insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, status, prioridade, publicacao_id)
      values (coalesce(pr.rotulo, 'Cumprir prazo') || ' · ' || coalesce(pb.numero_processo, ''), 'Prazo conferido por ' || coalesce(nome, 'Jurídico') || ' a partir da publicação de ' || to_char(pb.data_disponibilizacao, 'DD/MM/YYYY') || '.' || coalesce(E'\n' || btrim(p_obs), ''),
              pb.cliente_id, pb.processo_id, p_responsavel, 'juridico', dt, coalesce(p_fatal, false), 'aberta', 1, pb.id) returning id into t;
      criou := true;
      insert into public.publicacao_prazo_historico (prazo_id, acao, para, por, por_nome) values (pr.id, 'tarefa_criada', jsonb_build_object('tarefa_id', t, 'prazo', dt, 'fatal', coalesce(p_fatal, false)), auth.uid(), nome);
    end if;
  end if;
  update public.publicacao_prazos set estado = case when p_decisao = 'confirmar' then 'confirmado' else 'corrigido' end, data_conferida = dt, fatal = coalesce(p_fatal, false),
         conferido_por = auth.uid(), conferido_por_nome = nome, conferido_em = now(), observacao = nullif(btrim(coalesce(p_obs, '')), ''), tarefa_id = t, atualizado_em = now() where id = pr.id;
  insert into public.publicacao_prazo_historico (prazo_id, acao, de, para, observacao, por, por_nome)
  values (pr.id, case when p_decisao = 'confirmar' then 'confirmado' else 'corrigido' end, antes, jsonb_build_object('data_sugerida', pr.data_sugerida, 'data_conferida', dt, 'fatal', coalesce(p_fatal, false)), nullif(btrim(coalesce(p_obs, '')), ''), auth.uid(), nome);
  return jsonb_build_object('estado', case when p_decisao = 'confirmar' then 'confirmado' else 'corrigido' end, 'data_conferida', dt, 'tarefa_id', t, 'tarefa_criada', criou);
end $$;
revoke all on function public.publicacao_prazo_conferir(bigint, text, date, boolean, text, boolean, uuid) from public, anon;
grant execute on function public.publicacao_prazo_conferir(bigint, text, date, boolean, text, boolean, uuid) to authenticated;

-- conciliação de fonte divergente: "é a mesma" (aceita) ou "é outra" (vira publicação própria, pelo fluxo normal)
create or replace function public.publicacao_fonte_conciliar(p_fonte bigint, p_decisao text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.sou_admin() or (public.sou_equipe() and public.tem_acesso('juridico'))) then raise exception 'Só o Jurídico concilia fontes.' using errcode = '42501'; end if;
  if p_decisao not in ('mesma', 'outra') then raise exception 'Decisão inválida.' using errcode = '22023'; end if;
  update public.publicacao_fontes set conciliacao = p_decisao, conciliada_em = now(), conciliada_por = auth.uid() where id = p_fonte and conciliada_em is null;
  if not found then raise exception 'Fonte não encontrada ou já conciliada.' using errcode = 'P0002'; end if;
  insert into public.publicacao_historico (publicacao_id, acao, detalhe, por) select publicacao_id, 'fonte_conciliada', jsonb_build_object('fonte', fonte, 'decisao', p_decisao), auth.uid() from public.publicacao_fontes where id = p_fonte;
end $$;
revoke all on function public.publicacao_fonte_conciliar(bigint, text) from public, anon; grant execute on function public.publicacao_fonte_conciliar(bigint, text) to authenticated;
revoke all on function public.sync_definir(boolean, jsonb) from public, anon; grant execute on function public.sync_definir(boolean, jsonb) to authenticated;
grant execute on function public.sync_ativo() to authenticated;

-- ---------- 7b. registro de eventos e execuções (só o servidor) ----------
-- evento repetido (mesma impressão do corpo) não é processado de novo; assinatura inválida não guarda o corpo
create or replace function public.sync_evento_registrar(p_canal text, p_tipo text, p_impressao text, p_assinatura_ok boolean, p_corpo jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v bigint; st text;
begin
  st := case when p_assinatura_ok is false then 'assinatura_invalida' when not public.sync_ativo() then 'ignorado_desligada' else 'novo' end;
  insert into public.sync_eventos (canal, tipo, impressao, assinatura_ok, status, corpo)
  values (p_canal, p_tipo, p_impressao, p_assinatura_ok, st, case when st = 'novo' then p_corpo else null end)
  on conflict (impressao) do nothing returning id into v;
  if v is null then
    update public.sync_eventos set resultado = jsonb_set(resultado, '{repeticoes}', to_jsonb(coalesce((resultado ->> 'repeticoes')::integer, 0) + 1)) where impressao = p_impressao returning id into v;
    return jsonb_build_object('id', v, 'status', 'repetido');
  end if;
  return jsonb_build_object('id', v, 'status', st);
end $$;
create or replace function public.sync_evento_concluir(p_id bigint, p_status text, p_resultado jsonb default '{}'::jsonb, p_erro text default null) returns void
language sql security definer set search_path = public as $$
  update public.sync_eventos set status = p_status, resultado = resultado || coalesce(p_resultado, '{}'::jsonb), erro = left(p_erro, 500), processado_em = now() where id = p_id $$;
create or replace function public.sync_execucao_abrir(p_origem text, p_por uuid default null) returns bigint language sql security definer set search_path = public as $$
  insert into public.sync_execucoes (origem, por, status) values (p_origem, p_por, case when public.sync_ativo() or p_origem = 'teste_conexao' then 'em_andamento' else 'desligada' end) returning id $$;
create or replace function public.sync_execucao_fechar(p_id bigint, p_status text, p_resumo jsonb default '{}'::jsonb, p_erro text default null) returns void language sql security definer set search_path = public as $$
  update public.sync_execucoes set status = p_status, resumo = coalesce(p_resumo, '{}'::jsonb), erro = left(p_erro, 500), terminada_em = now() where id = p_id $$;
create or replace function public.sync_estado_gravar(p_estado jsonb) returns void language sql security definer set search_path = public as $$
  update public.integracoes set estado = coalesce(p_estado, '{}'::jsonb) || jsonb_build_object('verificado_em', now()) where id = 'sync' $$;
revoke all on function public.sync_evento_registrar(text, text, text, boolean, jsonb), public.sync_evento_concluir(bigint, text, jsonb, text), public.sync_execucao_abrir(text, uuid),
  public.sync_execucao_fechar(bigint, text, jsonb, text), public.sync_estado_gravar(jsonb) from public, anon, authenticated;

-- leitura da configuração pelo servidor e registro de item em quarentena (campos obrigatórios não reconhecidos).
-- A quarentena guarda SÓ os nomes dos campos recebidos — nunca o conteúdo — e conta repetições do mesmo formato.
create or replace function public.sync_config_ler() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ativo', ativo, 'config', config) from public.integracoes where id = 'sync' $$;
create or replace function public.sync_quarentena_registrar(p_execucao bigint, p_faltando jsonb, p_campos jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare imp text := 'q:' || md5(coalesce(p_faltando::text, '') || '|' || coalesce(p_campos::text, ''));
begin
  insert into public.sync_eventos (canal, tipo, impressao, status, resultado)
  values ('consulta', 'item_sem_campos_obrigatorios', imp, 'quarentena', jsonb_build_object('faltando', p_faltando, 'campos_recebidos', p_campos, 'execucao', p_execucao, 'repeticoes', 0))
  on conflict (impressao) do update set resultado = jsonb_set(public.sync_eventos.resultado, '{repeticoes}', to_jsonb(coalesce((public.sync_eventos.resultado ->> 'repeticoes')::integer, 0) + 1)), recebido_em = now();
end $$;
revoke all on function public.sync_config_ler(), public.sync_quarentena_registrar(bigint, jsonb, jsonb) from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_config_ler(), public.sync_quarentena_registrar(bigint, jsonb, jsonb), public.sync_receber_intimacao(jsonb, bigint),
      public.sync_evento_registrar(text, text, text, boolean, jsonb), public.sync_evento_concluir(bigint, text, jsonb, text), public.sync_execucao_abrir(text, uuid),
      public.sync_execucao_fechar(bigint, text, jsonb, text), public.sync_estado_gravar(jsonb) to service_role;
  end if;
end $g$;

-- ---------- 8. o que a tela lê ----------
-- situação: recebida → pendente de análise → analisada → com providência; mais os avisos "prazo a conferir" e "fontes divergentes"
create or replace view public.v_publicacoes_integracao with (security_invoker = true) as
select p.id as publicacao_id, p.origem,
       coalesce((select array_agg(distinct f.fonte order by f.fonte) from public.publicacao_fontes f where f.publicacao_id = p.id), '{}') || case when p.id > 0 then array['djen'] else '{}'::text[] end as fontes,
       (select count(*) from public.publicacao_fontes f where f.publicacao_id = p.id and f.conciliada_em is null and (jsonb_array_length(f.divergencias) > 0 or f.casamento = 'provavel')) as divergencias_abertas,
       (select count(*) from public.publicacao_prazos z where z.publicacao_id = p.id and z.estado = 'sugerido') as prazos_a_conferir,
       (select count(*) from public.publicacao_prazos z where z.publicacao_id = p.id and z.estado in ('confirmado', 'corrigido')) as prazos_conferidos,
       case when p.providencia is not null and (p.providencia = 'gerou_prazo' or p.tarefa_id is not null) then 'com_providencia'
            when p.providencia is not null then 'analisada'
            when p.lida then 'pendente_analise' else 'recebida' end as situacao
  from public.publicacoes p;
grant select on public.v_publicacoes_integracao to authenticated;

select 'ok 0114' as resultado, (select ativo from public.integracoes where id = 'sync') as sync_ativo,
       (select count(*) from pg_trigger where tgname = 'publicacoes_a_dedup_fontes') as gatilho,
       (select count(*) from public.publicacoes where origem = 'sync') as publicacoes_sync;

-- Reversão (nada de dado do DJEN é tocado):
--   drop trigger publicacoes_a_dedup_fontes on public.publicacoes; drop view public.v_publicacoes_integracao;
--   drop function public.sync_receber_intimacao(jsonb, bigint), public.publicacao_prazo_conferir(bigint, text, date, boolean, text, boolean, uuid),
--        public.publicacao_fonte_conciliar(bigint, text), public.sync_definir(boolean, jsonb), public.publicacao_dedup_fontes_tg(), public.sync_ativo();
--   drop table public.publicacao_prazo_historico, public.publicacao_prazos, public.publicacao_fontes, public.sync_eventos, public.sync_execucoes, public.integracoes;
--   drop index public.publicacoes_impressao_idx; alter table public.publicacoes drop column origem; drop sequence public.publicacoes_sync_seq; drop function public.publicacao_impressao(text, date, text);
