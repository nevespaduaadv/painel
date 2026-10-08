-- 0014 — PR 7½: publicações do DJEN (Diário de Justiça Eletrônico Nacional) por OAB, direto no banco.
-- Idempotente. Depende de 0010. Usa pg_net (chamadas HTTP assíncronas) + pg_cron.
--
-- Fluxo: djen_solicitar() enfileira um GET na API pública do DJEN (comunicaapi.pje.jus.br) → a resposta cai em net._http_response →
-- djen_processar() (cron a cada 10 min) lê, grava em publicacoes (upsert por id do DJEN) e pede a próxima página quando houver.
-- Ao gravar: vincula ao processo pelo número CNJ; se vinculou, cria andamento 'intimacao' (interno) e tarefa "Analisar publicação".
-- Publicações sem processo conhecido ficam na aba Publicações para triagem (vincular / ignorar).

create extension if not exists pg_net;

-- ---------- Parâmetros ----------
insert into public.regras (id, dados) values ('djen', '{"oab":"488803","uf":"SP","itens_por_pagina":100,"dias_retroativos":3}'::jsonb) on conflict (id) do nothing;

-- ---------- Publicações ----------
create table if not exists public.publicacoes (
  id bigint primary key,                              -- id da comunicação no DJEN
  data_disponibilizacao date not null,
  tribunal text, orgao text, id_orgao integer,
  tipo_comunicacao text, tipo_documento text, classe text, codigo_classe text,
  numero_processo text,                               -- com máscara
  numero_processo_digitos text generated always as (regexp_replace(coalesce(numero_processo,''), '\D', '', 'g')) stored,
  meio text, link text, numero_comunicacao integer, status_djen text,
  texto text,                                         -- texto limpo (sem HTML)
  destinatarios jsonb not null default '[]'::jsonb,   -- [{nome, polo}]
  advogados jsonb not null default '[]'::jsonb,       -- [{nome, numero_oab, uf_oab}]
  processo_id uuid references public.processos(id) on delete set null,
  cliente_id text references public.clientes(id) on delete set null,
  andamento_id uuid references public.andamentos(id) on delete set null,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  lida boolean not null default false,
  ignorada boolean not null default false,
  bruto jsonb,                                        -- item original da API
  created_at timestamptz default now(), updated_at timestamptz default now(), updated_by uuid
);
create index if not exists publicacoes_data_idx on public.publicacoes(data_disponibilizacao desc);
create index if not exists publicacoes_num_idx on public.publicacoes(numero_processo_digitos);
create index if not exists publicacoes_proc_idx on public.publicacoes(processo_id);

create table if not exists public.djen_requisicoes (
  id bigserial primary key,
  request_id bigint,
  inicio date not null, fim date not null, pagina integer not null default 1,
  status text not null default 'pendente' check (status in ('pendente','ok','erro')),
  itens integer, total integer, erro text,
  created_at timestamptz default now(), processado_em timestamptz
);

alter table public.publicacoes enable row level security;
alter table public.djen_requisicoes enable row level security;
drop policy if exists pub_sel on public.publicacoes;
create policy pub_sel on public.publicacoes for select to authenticated using (public.sou_equipe());
drop policy if exists pub_upd on public.publicacoes;
create policy pub_upd on public.publicacoes for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists djenreq_sel on public.djen_requisicoes;
create policy djenreq_sel on public.djen_requisicoes for select to authenticated using (public.sou_equipe());
revoke all on public.publicacoes from anon; revoke all on public.djen_requisicoes from anon;

-- ---------- Vínculo com processo + andamento + tarefa ----------
create or replace function public.publicacao_vincular() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.processos%rowtype; t uuid; a uuid; resumo text; dig text;
begin
  dig := regexp_replace(coalesce(new.numero_processo,''), '\D', '', 'g');   -- (coluna gerada ainda não existe no BEFORE)
  if new.processo_id is null and dig <> '' then
    select * into p from public.processos where regexp_replace(coalesce(numero_cnj,''), '\D', '', 'g') = dig limit 1;
    if found then new.processo_id := p.id; end if;
  end if;
  if new.processo_id is not null and new.andamento_id is null then
    if p.id is null or p.id <> new.processo_id then select * into p from public.processos where id = new.processo_id; end if;
    new.cliente_id := p.cliente_id;
    resumo := coalesce(new.tipo_documento, new.tipo_comunicacao, 'Publicação')||' · '||coalesce(new.tribunal,'')||' · '||coalesce(new.orgao,'');
    insert into public.andamentos (processo_id, data, tipo, descricao, visivel_cliente, fonte, id_externo)
    values (new.processo_id, new.data_disponibilizacao, 'intimacao', resumo||E'\n'||left(coalesce(new.texto,''), 1500), false, 'djen', 'djen:'||new.id)
    on conflict do nothing returning id into a;
    new.andamento_id := a;
    insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, status, prioridade)
    values ('Analisar publicação: '||coalesce(new.tipo_documento, new.tipo_comunicacao, 'DJEN')||' · '||coalesce(new.numero_processo,''),
            'Publicada no DJEN em '||to_char(new.data_disponibilizacao,'DD/MM/YYYY')||'. Verifique o prazo e registre a providência.'||E'\n'||left(coalesce(new.texto,''), 600),
            new.cliente_id, new.processo_id, p.responsavel_id, 'juridico', new.data_disponibilizacao + 1, false, 'aberta', 1)
    returning id into t;
    new.tarefa_id := t;
  end if;
  return new;
end $$;
drop trigger if exists publicacoes_vincular on public.publicacoes;
create trigger publicacoes_vincular before insert or update of processo_id on public.publicacoes for each row execute procedure public.publicacao_vincular();

-- Processo novo com número já conhecido nas publicações → vincula as publicações antigas
create or replace function public.processo_vincular_publicacoes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero_cnj is not null then
    update public.publicacoes set processo_id = new.id
    where processo_id is null and numero_processo_digitos = regexp_replace(new.numero_cnj, '\D', '', 'g');
  end if;
  return new;
end $$;
drop trigger if exists processos_vincular_publicacoes on public.processos;
create trigger processos_vincular_publicacoes after insert or update of numero_cnj on public.processos for each row execute procedure public.processo_vincular_publicacoes();

-- ---------- Busca na API (pg_net) ----------
create or replace function public.djen_solicitar(inicio date, fim date, pagina integer default 1) returns bigint
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; url text; rid bigint;
begin
  select dados into cfg from public.regras where id = 'djen';
  url := 'https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroOab='||(cfg->>'oab')||'&ufOab='||(cfg->>'uf')
         ||'&itensPorPagina='||coalesce(cfg->>'itens_por_pagina','100')||'&pagina='||pagina
         ||'&dataDisponibilizacaoInicio='||to_char(inicio,'YYYY-MM-DD')||'&dataDisponibilizacaoFim='||to_char(fim,'YYYY-MM-DD');
  select net.http_get(url := url, headers := '{"Accept":"application/json","User-Agent":"NevesPadua-Carteira/1.0"}'::jsonb, timeout_milliseconds := 30000) into rid;
  insert into public.djen_requisicoes (request_id, inicio, fim, pagina) values (rid, inicio, fim, pagina);
  return rid;
end $$;

create or replace function public.djen_gravar(item jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.publicacoes (id, data_disponibilizacao, tribunal, orgao, id_orgao, tipo_comunicacao, tipo_documento, classe, codigo_classe, numero_processo, meio, link, numero_comunicacao, status_djen, texto, destinatarios, advogados, bruto)
  values ((item->>'id')::bigint, (item->>'data_disponibilizacao')::date, item->>'siglaTribunal', item->>'nomeOrgao', nullif(item->>'idOrgao','')::integer,
          item->>'tipoComunicacao', item->>'tipoDocumento', item->>'nomeClasse', item->>'codigoClasse', coalesce(item->>'numeroprocessocommascara', item->>'numero_processo'),
          item->>'meio', item->>'link', nullif(item->>'numeroComunicacao','')::integer, item->>'status',
          trim(regexp_replace(regexp_replace(coalesce(item->>'texto',''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')),
          coalesce((select jsonb_agg(jsonb_build_object('nome', d->>'nome', 'polo', d->>'polo')) from jsonb_array_elements(case when jsonb_typeof(item->'destinatarios')='array' then item->'destinatarios' else '[]'::jsonb end) d), '[]'::jsonb),
          coalesce((select jsonb_agg(jsonb_build_object('nome', d->'advogado'->>'nome', 'numero_oab', d->'advogado'->>'numero_oab', 'uf_oab', d->'advogado'->>'uf_oab')) from jsonb_array_elements(case when jsonb_typeof(item->'destinatarioadvogados')='array' then item->'destinatarioadvogados' else '[]'::jsonb end) d), '[]'::jsonb),
          item - 'texto')
  on conflict (id) do update set status_djen = excluded.status_djen, link = coalesce(excluded.link, public.publicacoes.link), updated_at = now();
end $$;

create or replace function public.djen_processar() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; resp record; corpo jsonb; it jsonb; n integer := 0; v_total integer; porpag integer; cfg jsonb;
begin
  select dados into cfg from public.regras where id = 'djen';
  porpag := coalesce((cfg->>'itens_por_pagina')::integer, 100);
  for r in select * from public.djen_requisicoes where status = 'pendente' and request_id is not null order by id loop
    select * into resp from net._http_response where id = r.request_id;
    if not found then continue; end if;   -- ainda não respondeu
    if resp.status_code is distinct from 200 or resp.content is null then
      update public.djen_requisicoes set status = 'erro', erro = coalesce(resp.error_msg, 'HTTP '||coalesce(resp.status_code::text,'?'))||' '||left(coalesce(resp.content,''),300), processado_em = now() where id = r.id;
      continue;
    end if;
    begin
      corpo := resp.content::jsonb;
    exception when others then
      update public.djen_requisicoes set status = 'erro', erro = 'resposta não é JSON: '||left(resp.content,200), processado_em = now() where id = r.id; continue;
    end;
    v_total := coalesce((corpo->>'count')::integer, 0);
    for it in select * from jsonb_array_elements(case when jsonb_typeof(corpo->'items')='array' then corpo->'items' else '[]'::jsonb end) loop
      perform public.djen_gravar(it); n := n + 1;
    end loop;
    update public.djen_requisicoes set status = 'ok', itens = (case when jsonb_typeof(corpo->'items')='array' then jsonb_array_length(corpo->'items') else 0 end), total = v_total, processado_em = now() where id = r.id;
    if v_total > r.pagina * porpag and jsonb_typeof(corpo->'items')='array' and jsonb_array_length(corpo->'items') > 0 then
      perform public.djen_solicitar(r.inicio, r.fim, r.pagina + 1);
    end if;
  end loop;
  return n;
end $$;

-- Rotina diária: últimos N dias (sobreposição cobre atrasos de publicação; upsert evita duplicar)
create or replace function public.djen_diario() returns bigint
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; begin
  select dados into cfg from public.regras where id = 'djen';
  return public.djen_solicitar(current_date - coalesce((cfg->>'dias_retroativos')::integer, 3), current_date, 1);
end $$;

-- RPCs para a tela (equipe): buscar um período (histórico) e processar agora
create or replace function public.djen_buscar_periodo(inicio date, fim date) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  if fim < inicio or fim - inicio > 400 then raise exception 'período inválido (máx. 400 dias)'; end if;
  return public.djen_solicitar(inicio, fim, 1);
end $$;
create or replace function public.djen_atualizar() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  return public.djen_processar();
end $$;
revoke all on function public.djen_solicitar(date,date,integer) from public, anon, authenticated;
revoke all on function public.djen_processar() from public, anon, authenticated;
revoke all on function public.djen_diario() from public, anon, authenticated;
revoke all on function public.djen_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.djen_buscar_periodo(date,date) to authenticated;
grant execute on function public.djen_atualizar() to authenticated;

-- ---------- Agenda ----------
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('djen_diario','djen_processar');
  perform cron.schedule('djen_diario', '0 9,13,18 * * 1-5', $c$select public.djen_diario()$c$);   -- 06h, 10h e 15h (BRT), dias úteis
  perform cron.schedule('djen_processar', '*/10 * * * *', $c$select public.djen_processar()$c$);
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

-- ---------- Views ----------
create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.tarefas t on t.id = p.tarefa_id;

create or replace view public.v_publicacoes_resumo with (security_invoker = true) as
select count(*) as total,
       count(*) filter (where data_disponibilizacao >= current_date - 7) as ultimos_7d,
       count(*) filter (where not lida and not ignorada) as nao_lidas,
       count(*) filter (where processo_id is null and not ignorada) as sem_vinculo,
       max(data_disponibilizacao) as ultima_data,
       (select max(processado_em) from public.djen_requisicoes where status = 'ok') as ultima_busca,
       (select count(*) from public.djen_requisicoes where status = 'erro' and created_at > now() - interval '2 days') as erros_recentes
from public.publicacoes;

-- Tempo real
do $$ begin alter publication supabase_realtime add table public.publicacoes; exception when others then null; end $$;

select 'ok 0014' as resultado;
