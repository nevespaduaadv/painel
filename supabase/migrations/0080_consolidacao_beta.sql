-- 0080 — Consolidação do beta (espelho) na produção, 30/10/2026.
-- Reúne as migrations beta 0002–0013 + a rpc de importação em lote (espelho_importar) + importacao_bruta (restrita à equipe).
-- Todas idempotentes. Blocos: pastas e processos relacionados · pastas por ano e tratamento de publicações · timesheet ·
-- pastas extrajudiciais e contratos · contratos de honorários e faturamento · prazo único e sugestão de cliente nas publicações ·
-- dossiê e frentes · andamentos sem duplicidade · dossiê = trabalho do escritório + anexos em tarefa · entrada nas três frentes e
-- ficha de passagem · timesheet por frente. Rodar inteiro, uma vez, no SQL Editor (pode levar ~1 min).
set client_min_messages = warning;

-- ===== rpc de importação em lote (admin; sem gatilhos; ignora duplicadas) — usada pelo importador do ADVBox =====
create or replace function public.espelho_importar(p_tabela text, p_linhas jsonb, p_omitir text[] default '{}')
returns integer language plpgsql security definer set search_path = public as $$
declare cols text; n integer := 0; tabela regclass;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  if p_tabela !~ '^[a-z_]+$' then raise exception 'Tabela inválida.'; end if;
  tabela := ('public.' || p_tabela)::regclass;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_tabela
     and is_generated = 'NEVER' and coalesce(identity_generation, '') <> 'ALWAYS'
     and not (column_name = any(p_omitir))
     and column_name in (select jsonb_object_keys(p_linhas -> 0));   -- só as colunas presentes; as demais ficam com o padrão
  if cols is null then raise exception 'Tabela sem colunas: %', p_tabela; end if;
  execute format('alter table %s disable trigger user', tabela);
  begin
    execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1) on conflict do nothing', tabela, cols, cols, tabela) using p_linhas;
    get diagnostics n = row_count;
    execute format('alter table %s enable trigger user', tabela);
  exception when others then
    execute format('alter table %s enable trigger user', tabela);
    raise;
  end;
  return n;
end $$;
revoke all on function public.espelho_importar(text, jsonb, text[]) from public, anon;
grant execute on function public.espelho_importar(text, jsonb, text[]) to authenticated;

-- ===================== beta 0002_pastas_processos_relacionados.sql =====================
-- ESPELHO (beta) — Bloco 1 da controladoria: pasta sequencial por processo, campos obrigatórios configuráveis e
-- processos relacionados (originário ↔ cumprimento de sentença, recurso, incidente…). Idempotente. Só no beta até aprovação.

-- ---------- áreas do processo (cadastro do admin) ----------
create table if not exists public.areas_processo (
  id serial primary key,
  nome text not null unique,
  ordem integer not null default 0,
  ativa boolean not null default true
);
insert into public.areas_processo (nome, ordem) values
  ('Bancário PJ', 1), ('Superendividamento', 2), ('Revisional', 3), ('Execução / Cobrança', 4), ('Cível', 5), ('Trabalhista', 6), ('Tributário', 7), ('Extrajudicial', 8)
on conflict (nome) do nothing;
alter table public.areas_processo enable row level security;
drop policy if exists areas_sel on public.areas_processo; create policy areas_sel on public.areas_processo for select to authenticated using (public.sou_equipe());
drop policy if exists areas_adm on public.areas_processo; create policy areas_adm on public.areas_processo for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select on public.areas_processo to authenticated; grant insert, update, delete on public.areas_processo to authenticated;
grant usage, select on sequence public.areas_processo_id_seq to authenticated;

-- ---------- pastas ----------
create table if not exists public.pastas (
  numero serial primary key,                          -- número da pasta (sequencial, nunca reaproveitado)
  titulo text,
  cliente_id text references public.clientes (id) on delete set null,
  status text not null default 'ativa' check (status in ('ativa','encerrada')),
  aberta_em date not null default current_date,
  encerrada_em date,
  tipo_encerramento text,
  caixa_arquivo text,                                 -- localização física (caixa/arquivo morto), se houver
  observacoes text,
  created_by uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pastas_cliente_idx on public.pastas (cliente_id);
alter table public.pastas enable row level security;
drop policy if exists pastas_sel on public.pastas; create policy pastas_sel on public.pastas for select to authenticated using (public.sou_equipe());
drop policy if exists pastas_mod on public.pastas; create policy pastas_mod on public.pastas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update on public.pastas to authenticated;
grant usage, select on sequence public.pastas_numero_seq to authenticated;

-- ---------- processos: pasta + campos do cabeçalho ----------
alter table public.processos
  add column if not exists pasta_numero integer references public.pastas (numero) on delete set null,
  add column if not exists area text,
  add column if not exists comarca text,
  add column if not exists uf text,
  add column if not exists rito text,
  add column if not exists assunto text,
  add column if not exists data_distribuicao date,
  add column if not exists sub_status text,
  add column if not exists encerrado_em date,
  add column if not exists tipo_encerramento text,
  add column if not exists relevante boolean not null default false,
  add column if not exists sigiloso boolean not null default false,
  add column if not exists grau_risco text check (grau_risco is null or grau_risco in ('alto','medio','baixo')),
  add column if not exists risco_cliente text,
  add column if not exists advogado_contrario text;
create index if not exists processos_pasta_idx on public.processos (pasta_numero);

-- campos obrigatórios do cadastro (o admin liga/desliga); o relatório mostra o que falta em cada processo
create table if not exists public.processo_campos_obrigatorios (
  campo text primary key,
  rotulo text not null,
  obrigatorio boolean not null default true,
  ordem integer not null default 0
);
insert into public.processo_campos_obrigatorios (campo, rotulo, obrigatorio, ordem) values
  ('numero_cnj', 'Número CNJ', true, 1), ('cliente_id', 'Cliente', true, 2), ('area', 'Área', true, 3), ('tipo_acao', 'Tipo de ação', true, 4),
  ('polo', 'Posição do cliente (polo)', true, 5), ('parte_contraria', 'Parte contrária', true, 6), ('tribunal', 'Tribunal', true, 7),
  ('vara', 'Vara / comarca', true, 8), ('data_distribuicao', 'Data de distribuição', true, 9), ('fase', 'Fase', true, 10),
  ('responsavel_id', 'Advogado responsável', true, 11), ('valor_causa', 'Valor da causa', false, 12), ('rito', 'Rito', false, 13),
  ('assunto', 'Assunto', false, 14), ('contrato_id', 'Contrato vinculado', false, 15)
on conflict (campo) do nothing;
alter table public.processo_campos_obrigatorios enable row level security;
drop policy if exists pco_sel on public.processo_campos_obrigatorios; create policy pco_sel on public.processo_campos_obrigatorios for select to authenticated using (public.sou_equipe());
drop policy if exists pco_adm on public.processo_campos_obrigatorios; create policy pco_adm on public.processo_campos_obrigatorios for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update, delete on public.processo_campos_obrigatorios to authenticated;

create or replace function public.processo_campos_faltando(p public.processos) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(c.rotulo order by c.ordem), '{}')
    from public.processo_campos_obrigatorios c
   where c.obrigatorio and nullif(btrim(coalesce(to_jsonb(p) ->> c.campo, '')), '') is null;
$$;

-- pasta automática: todo processo novo sem pasta abre a sua (título = cliente ou parte contrária)
create or replace function public.processos_pasta_auto() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer; t text;
begin
  if new.pasta_numero is null then
    select coalesce(c.nome_fantasia, c.dados ->> 'nome') into t from public.clientes c where c.id = new.cliente_id;
    insert into public.pastas (titulo, cliente_id, aberta_em, created_by)
    values (coalesce(t, new.parte_contraria, new.numero_cnj, 'Processo'), new.cliente_id, coalesce(new.data_distribuicao, current_date), coalesce(new.created_by, auth.uid()))
    returning numero into n;
    new.pasta_numero := n;
  end if;
  return new;
end $$;
drop trigger if exists processos_pasta_auto on public.processos;
create trigger processos_pasta_auto before insert on public.processos for each row execute function public.processos_pasta_auto();

-- processos existentes sem pasta: uma pasta por processo, na ordem de cadastro (sequencial)
do $$ declare r record; n integer;
begin
  for r in select p.id, p.cliente_id, p.parte_contraria, p.numero_cnj, p.created_at, coalesce(c.nome_fantasia, c.dados ->> 'nome') as cli
             from public.processos p left join public.clientes c on c.id = p.cliente_id
            where p.pasta_numero is null order by p.created_at, p.id loop
    insert into public.pastas (titulo, cliente_id, aberta_em, created_at) values (coalesce(r.cli, r.parte_contraria, r.numero_cnj, 'Processo'), r.cliente_id, r.created_at::date, r.created_at) returning numero into n;
    update public.processos set pasta_numero = n where id = r.id;
  end loop;
end $$;

-- ---------- processos relacionados ----------
create table if not exists public.processo_relacoes (
  id bigserial primary key,
  processo_id uuid not null references public.processos (id) on delete cascade,      -- principal / originário
  relacionado_id uuid not null references public.processos (id) on delete cascade,   -- derivado
  tipo text not null check (tipo in ('cumprimento_sentenca','recurso','incidente','execucao','cautelar','embargos','conexo','outro')),
  observacao text,
  created_by uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (processo_id, relacionado_id),
  check (processo_id <> relacionado_id)
);
create index if not exists processo_relacoes_rel_idx on public.processo_relacoes (relacionado_id);
alter table public.processo_relacoes enable row level security;
drop policy if exists prel_sel on public.processo_relacoes; create policy prel_sel on public.processo_relacoes for select to authenticated using (public.sou_equipe());
drop policy if exists prel_mod on public.processo_relacoes; create policy prel_mod on public.processo_relacoes for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update, delete on public.processo_relacoes to authenticated;
grant usage, select on sequence public.processo_relacoes_id_seq to authenticated;

-- relaciona e, se pedido, leva o derivado para a pasta do principal (a pasta antiga fica encerrada se ficar vazia)
create or replace function public.processo_relacionar(p_principal uuid, p_relacionado uuid, p_tipo text, p_mesma_pasta boolean default true, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pp integer; pr integer;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  insert into public.processo_relacoes (processo_id, relacionado_id, tipo, observacao) values (p_principal, p_relacionado, p_tipo, p_obs)
  on conflict (processo_id, relacionado_id) do update set tipo = excluded.tipo, observacao = coalesce(excluded.observacao, public.processo_relacoes.observacao);
  if p_mesma_pasta then
    select pasta_numero into pp from public.processos where id = p_principal;
    select pasta_numero into pr from public.processos where id = p_relacionado;
    if pp is not null and pr is distinct from pp then
      update public.processos set pasta_numero = pp, updated_at = now() where id = p_relacionado;
      if pr is not null and not exists (select 1 from public.processos where pasta_numero = pr) then
        update public.pastas set status = 'encerrada', encerrada_em = current_date, tipo_encerramento = 'unificada na pasta ' || pp, updated_at = now() where numero = pr;
      end if;
    end if;
  end if;
end $$;
grant execute on function public.processo_relacionar(uuid, uuid, text, boolean, text) to authenticated;

-- ---------- views ----------
create or replace view public.v_processo_relacoes with (security_invoker = true) as
select r.id, r.processo_id, r.relacionado_id, r.tipo, r.observacao, r.created_at, 'derivado' as sentido,
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara
  from public.processo_relacoes r join public.processos x on x.id = r.relacionado_id
union all
select r.id, r.relacionado_id as processo_id, r.processo_id as relacionado_id, r.tipo, r.observacao, r.created_at, 'originario' as sentido,
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara
  from public.processo_relacoes r join public.processos x on x.id = r.processo_id;
grant select on public.v_processo_relacoes to authenticated;

-- v_processos: mantém a ordem das colunas antigas (as views que dependem dela continuam válidas) e acrescenta as novas no fim
create or replace view public.v_processos with (security_invoker = true) as
select p.id, p.cliente_id, p.contrato_id, p.numero_cnj, p.tribunal, p.vara, p.tipo_acao, p.parte_contraria, p.banco, p.polo, p.fase, p.valor_causa,
       p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.status, p.visivel_cliente, p.fonte, p.id_externo, p.observacoes, p.created_at, p.created_by, p.updated_at, p.updated_by,
       c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (p.proximo_prazo - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia,
       -- novas (beta 0002)
       p.pasta_numero, p.area, p.comarca, p.uf, p.rito, p.assunto, p.data_distribuicao, p.sub_status, p.encerrado_em, p.tipo_encerramento,
       p.relevante, p.sigiloso, p.grau_risco, p.risco_cliente, p.advogado_contrario,
       pa.titulo as pasta_titulo, pa.status as pasta_status,
       public.processo_campos_faltando(p) as campos_faltando,
       (select count(*) from public.processo_relacoes r where r.processo_id = p.id or r.relacionado_id = p.id) as qtd_relacionados,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id) as qtd_publicacoes
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id
left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_processos to authenticated;

create or replace view public.v_pastas with (security_invoker = true) as
select pa.*, c.nome as cliente_nome,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero) as qtd_processos,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero and p.status = 'ativo') as qtd_ativos,
       (select string_agg(coalesce(p.numero_cnj, p.tipo_acao), ' · ' order by p.created_at) from public.processos p where p.pasta_numero = pa.numero) as processos_txt
  from public.pastas pa left join public.clientes c on c.id = pa.cliente_id;
grant select on public.v_pastas to authenticated;

-- a busca global já usa v_processos; o relatório de cadastro incompleto é a própria view (campos_faltando <> '{}')

-- ===================== beta 0003_pastas_ano_publicacoes_tratamento.sql =====================
-- ESPELHO (beta) — Bloco 1 (ajuste): numeração da pasta por ano (2026-0001). Bloco 2: tratamento das publicações com
-- histórico e tempestividade, e card de publicações por processo. Idempotente. Depende de beta/0002.

-- ---------- pasta: código por ano ----------
alter table public.pastas add column if not exists ano integer, add column if not exists seq integer, add column if not exists codigo text;
create unique index if not exists pastas_codigo_idx on public.pastas (codigo);
create or replace function public.pastas_codigo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.ano := extract(year from coalesce(new.aberta_em, current_date))::integer;
    select coalesce(max(seq), 0) + 1 into new.seq from public.pastas where ano = new.ano;
    new.codigo := new.ano || '-' || lpad(new.seq::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists pastas_codigo on public.pastas;
create trigger pastas_codigo before insert on public.pastas for each row execute function public.pastas_codigo();
-- pastas já existentes: numera por ano de abertura, na ordem de criação
do $$ declare r record; a integer; n integer;
begin
  for r in select numero, aberta_em from public.pastas where codigo is null order by aberta_em, numero loop
    a := extract(year from r.aberta_em)::integer;
    select coalesce(max(seq), 0) + 1 into n from public.pastas where ano = a;
    update public.pastas set ano = a, seq = n, codigo = a || '-' || lpad(n::text, 4, '0') where numero = r.numero;
  end loop;
end $$;

-- ---------- configuração da controladoria ----------
create table if not exists public.controladoria_config (chave text primary key, valor text not null, descricao text);
insert into public.controladoria_config (chave, valor, descricao) values
  ('publicacao_prazo_dias_uteis', '1', 'Dias úteis após a disponibilização para a publicação ser tratada (tempestividade)')
on conflict (chave) do nothing;
alter table public.controladoria_config enable row level security;
drop policy if exists ccfg_sel on public.controladoria_config; create policy ccfg_sel on public.controladoria_config for select to authenticated using (public.sou_equipe());
drop policy if exists ccfg_adm on public.controladoria_config; create policy ccfg_adm on public.controladoria_config for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update on public.controladoria_config to authenticated;

-- ---------- publicações: tratamento ----------
alter table public.publicacoes
  add column if not exists providencia text check (providencia is null or providencia in ('gerou_prazo','nada_a_fazer','duplicidade','encaminhada','ciencia')),
  add column if not exists tratada_em timestamptz,
  add column if not exists tratada_por uuid references public.perfis (id) on delete set null,
  add column if not exists encaminhada_para uuid references public.colaboradores (id) on delete set null,
  add column if not exists observacao_tratamento text,
  add column if not exists prazo_tratamento date;
create index if not exists publicacoes_pend_idx on public.publicacoes (providencia) where providencia is null;

create table if not exists public.publicacao_historico (
  id bigserial primary key,
  publicacao_id bigint not null references public.publicacoes (id) on delete cascade,
  acao text not null,
  detalhe jsonb not null default '{}',
  por uuid references public.perfis (id) on delete set null,
  por_nome text,
  em timestamptz not null default now()
);
create index if not exists publicacao_historico_idx on public.publicacao_historico (publicacao_id, em);
alter table public.publicacao_historico enable row level security;
drop policy if exists ph_sel on public.publicacao_historico; create policy ph_sel on public.publicacao_historico for select to authenticated using (public.sou_equipe());
grant select on public.publicacao_historico to authenticated;

-- prazo de tratamento = N dias úteis após a disponibilização (09h não importa: compara datas)
create or replace function public.publicacao_prazo_tratamento(d date) returns date
language sql stable set search_path = public as $$
  select (public.cadencia_somar_dias_uteis(d::timestamp at time zone 'America/Sao_Paulo', coalesce((select valor::integer from public.controladoria_config where chave = 'publicacao_prazo_dias_uteis'), 1)) at time zone 'America/Sao_Paulo')::date;
$$;
update public.publicacoes set prazo_tratamento = public.publicacao_prazo_tratamento(data_disponibilizacao) where prazo_tratamento is null and data_disponibilizacao is not null;

-- histórico automático das mudanças relevantes
create or replace function public.publicacoes_historico_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text := public.nome_perfil(auth.uid());
begin
  if tg_op = 'INSERT' then
    new.prazo_tratamento := coalesce(new.prazo_tratamento, public.publicacao_prazo_tratamento(new.data_disponibilizacao));
    return new;
  end if;
  if new.processo_id is distinct from old.processo_id then insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.id, case when new.processo_id is null then 'desvinculada' else 'vinculada' end, jsonb_build_object('processo_id', new.processo_id), auth.uid(), nome); end if;
  if new.lida and not old.lida then insert into public.publicacao_historico (publicacao_id, acao, por, por_nome) values (new.id, 'lida', auth.uid(), nome); end if;
  if new.ignorada and not old.ignorada then insert into public.publicacao_historico (publicacao_id, acao, por, por_nome) values (new.id, 'ignorada', auth.uid(), nome); end if;
  if new.providencia is distinct from old.providencia and new.providencia is not null then
    insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.id, 'tratada', jsonb_build_object('providencia', new.providencia, 'observacao', new.observacao_tratamento, 'encaminhada_para', new.encaminhada_para), coalesce(new.tratada_por, auth.uid()), nome);
  end if;
  return new;
end $$;
drop trigger if exists publicacoes_historico on public.publicacoes;
create trigger publicacoes_historico before insert or update on public.publicacoes for each row execute function public.publicacoes_historico_tg();
create or replace function public.publicacoes_captada_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.id, 'captada', jsonb_build_object('tribunal', new.tribunal, 'processo', new.numero_processo), null, 'DJEN');
  return new;
end $$;
drop trigger if exists publicacoes_captada on public.publicacoes;
create trigger publicacoes_captada after insert on public.publicacoes for each row execute function public.publicacoes_captada_tg();

-- tarefa criada a partir da publicação = providência "gerou prazo" (quando ainda não tratada)
create or replace function public.tarefas_publicacao_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.publicacao_id is not null then
    update public.publicacoes set providencia = coalesce(providencia, 'gerou_prazo'), tratada_em = coalesce(tratada_em, now()), tratada_por = coalesce(tratada_por, auth.uid()), lida = true
     where id = new.publicacao_id;
    insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.publicacao_id, 'tarefa_criada', jsonb_build_object('tarefa_id', new.id, 'titulo', new.titulo, 'prazo', new.prazo, 'responsavel_id', new.responsavel_id), auth.uid(), public.nome_perfil(auth.uid()));
  end if;
  return new;
end $$;
drop trigger if exists tarefas_publicacao on public.tarefas;
create trigger tarefas_publicacao after insert on public.tarefas for each row execute function public.tarefas_publicacao_tg();

-- tratar: providência + observação (+ encaminhar para alguém, com aviso)
create or replace function public.publicacao_tratar(p_id bigint, p_providencia text, p_obs text default null, p_encaminhar uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare perfil_dest uuid; pub public.publicacoes;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  select * into pub from public.publicacoes where id = p_id;
  if pub.id is null then raise exception 'Publicação não encontrada.'; end if;
  update public.publicacoes set providencia = p_providencia, observacao_tratamento = p_obs, encaminhada_para = p_encaminhar,
         tratada_em = now(), tratada_por = auth.uid(), lida = true, ignorada = (p_providencia = 'duplicidade'), updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  if p_encaminhar is not null then
    select perfil_id into perfil_dest from public.colaboradores where id = p_encaminhar;
    perform public.notificar(perfil_dest, 'Publicação encaminhada para você', coalesce(pub.numero_processo, 'sem número') || ' · ' || coalesce(left(p_obs, 120), 'ver publicação'), '#publicacoes/' || p_id);
  end if;
end $$;
grant execute on function public.publicacao_tratar(bigint, text, text, uuid) to authenticated;

-- reabrir tratamento (volta a pendente)
create or replace function public.publicacao_reabrir(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  update public.publicacoes set providencia = null, tratada_em = null, tratada_por = null, encaminhada_para = null, ignorada = false, updated_at = now() where id = p_id;
  insert into public.publicacao_historico (publicacao_id, acao, por, por_nome) values (p_id, 'reaberta', auth.uid(), public.nome_perfil(auth.uid()));
end $$;
grant execute on function public.publicacao_reabrir(bigint) to authenticated;

-- ---------- views ----------
create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id) as tarefas_atribuidas,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as tarefas_atribuidas_abertas,
       (select string_agg(coalesce(cc.nome,'?') || coalesce(' · ' || to_char(x.prazo,'DD/MM'), ''), ', ' order by x.prazo) from public.tarefas x left join public.colaboradores cc on cc.id = x.responsavel_id where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as atribuidas_para,
       -- beta 0003
       p.providencia, p.tratada_em, public.nome_perfil(p.tratada_por) as tratada_por_nome, p.encaminhada_para, ce.nome as encaminhada_para_nome, p.observacao_tratamento,
       p.prazo_tratamento,
       case when p.providencia is null then null else (p.tratada_em at time zone 'America/Sao_Paulo')::date <= p.prazo_tratamento end as tempestiva,
       case when p.providencia is null then p.prazo_tratamento - current_date end as dias_para_tratar,
       pr.pasta_numero, pa.codigo as pasta_codigo
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.pastas pa on pa.numero = pr.pasta_numero
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.colaboradores ce on ce.id = p.encaminhada_para
left join public.tarefas t on t.id = p.tarefa_id;
grant select on public.v_publicacoes to authenticated;

-- relatório de tempestividade por mês e por quem tratou
create or replace view public.v_publicacoes_tempestividade with (security_invoker = true) as
select to_char(p.data_disponibilizacao, 'YYYY-MM') as mes, coalesce(public.nome_perfil(p.tratada_por), '(pendente)') as tratada_por_nome,
       count(*) as publicacoes,
       count(*) filter (where p.providencia is not null) as tratadas,
       count(*) filter (where p.providencia is not null and (p.tratada_em at time zone 'America/Sao_Paulo')::date <= p.prazo_tratamento) as tempestivas,
       count(*) filter (where p.providencia is null and p.prazo_tratamento < current_date) as pendentes_vencidas,
       count(*) filter (where p.providencia = 'gerou_prazo') as gerou_prazo,
       count(*) filter (where p.providencia = 'nada_a_fazer') as nada_a_fazer,
       count(*) filter (where p.providencia = 'duplicidade') as duplicidade,
       count(*) filter (where p.providencia = 'encaminhada') as encaminhadas,
       round(avg(extract(epoch from (p.tratada_em - (p.data_disponibilizacao::timestamp at time zone 'America/Sao_Paulo'))) / 86400) filter (where p.providencia is not null), 1) as media_dias_para_tratar
  from public.publicacoes p
 group by 1, 2;
grant select on public.v_publicacoes_tempestividade to authenticated;

-- v_processos / v_pastas: código da pasta
create or replace view public.v_pastas with (security_invoker = true) as
select pa.numero, pa.titulo, pa.cliente_id, pa.status, pa.aberta_em, pa.encerrada_em, pa.tipo_encerramento, pa.caixa_arquivo, pa.observacoes, pa.created_by, pa.created_at, pa.updated_at,
       c.nome as cliente_nome,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero) as qtd_processos,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero and p.status = 'ativo') as qtd_ativos,
       (select string_agg(coalesce(p.numero_cnj, p.tipo_acao), ' · ' order by p.created_at) from public.processos p where p.pasta_numero = pa.numero) as processos_txt,
       pa.ano, pa.seq, pa.codigo
  from public.pastas pa left join public.clientes c on c.id = pa.cliente_id;
grant select on public.v_pastas to authenticated;

create or replace view public.v_processos with (security_invoker = true) as
select p.id, p.cliente_id, p.contrato_id, p.numero_cnj, p.tribunal, p.vara, p.tipo_acao, p.parte_contraria, p.banco, p.polo, p.fase, p.valor_causa,
       p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.status, p.visivel_cliente, p.fonte, p.id_externo, p.observacoes, p.created_at, p.created_by, p.updated_at, p.updated_by,
       c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (p.proximo_prazo - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia,
       p.pasta_numero, p.area, p.comarca, p.uf, p.rito, p.assunto, p.data_distribuicao, p.sub_status, p.encerrado_em, p.tipo_encerramento,
       p.relevante, p.sigiloso, p.grau_risco, p.risco_cliente, p.advogado_contrario,
       pa.titulo as pasta_titulo, pa.status as pasta_status,
       public.processo_campos_faltando(p) as campos_faltando,
       (select count(*) from public.processo_relacoes r where r.processo_id = p.id or r.relacionado_id = p.id) as qtd_relacionados,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id) as qtd_publicacoes,
       pa.codigo as pasta_codigo,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id and pb.providencia is null) as publicacoes_pendentes
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id
left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_processos to authenticated;

create or replace view public.v_processo_relacoes with (security_invoker = true) as
select r.id, r.processo_id, r.relacionado_id, r.tipo, r.observacao, r.created_at, 'derivado' as sentido,
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara, pa.codigo as pasta_codigo
  from public.processo_relacoes r join public.processos x on x.id = r.relacionado_id left join public.pastas pa on pa.numero = x.pasta_numero
union all
select r.id, r.relacionado_id, r.processo_id, r.tipo, r.observacao, r.created_at, 'originario',
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara, pa.codigo
  from public.processo_relacoes r join public.processos x on x.id = r.processo_id left join public.pastas pa on pa.numero = x.pasta_numero;
grant select on public.v_processo_relacoes to authenticated;

-- ===================== beta 0004_timesheet.sql =====================
-- ESPELHO (beta) — Bloco 4 da controladoria: Timesheet completo.
-- Objetivos (Ana Júlia): (a) demonstrar ao cliente as horas trabalhadas (cobrável × tabela de hora);
-- (b) horas gastas × honorário/horas contratadas do cliente; (c) horas por tarefa/atividade e total do colaborador no mês.
-- Acrescenta: catálogo de atividades (admin), tabelas de valor/hora, vínculo por cliente (tabela, horas contratadas, honorário mensal),
-- cobrável/não cobrável, início/fim, processo, aprovação do gestor (pendente → aprovado | correção), cronômetro persistente.
-- Idempotente. Só no beta até aprovação.

-- ---------- catálogo de atividades ----------
create table if not exists public.ts_atividades (
  codigo text primary key,
  nome text not null,
  cobravel_padrao boolean not null default true,
  ativa boolean not null default true,
  ordem integer not null default 0
);
insert into public.ts_atividades (codigo, nome, cobravel_padrao, ordem) values
  ('analise_documentacao', 'Análise de documentação', true, 1), ('analise_contrato', 'Análise de contrato', true, 2),
  ('parecer_tecnico', 'Parecer técnico', true, 3), ('peticao', 'Elaboração de petição', true, 4), ('peticao_inicial', 'Elaboração de petição inicial', true, 5),
  ('recurso', 'Elaboração de recurso', true, 6), ('audiencia', 'Audiência', true, 7), ('reuniao_cliente', 'Reunião / atendimento ao cliente', true, 8),
  ('contato_telefonico', 'Contato telefônico', true, 9), ('contato_banco', 'Contato com jurídico do banco', true, 10), ('proposta_acordo', 'Proposta / negociação de acordo', true, 11),
  ('requerimento_bacen', 'Requerimento ao Bacen', true, 12), ('solicitacao_documentos', 'Solicitação de documentos', true, 13), ('protocolo', 'Protocolo', true, 14),
  ('andamento', 'Acompanhamento processual', true, 15), ('diligencia', 'Diligência', true, 16), ('ata', 'Ata / registro', true, 17),
  ('calculo', 'Cálculo / planilha', true, 18), ('pesquisa', 'Pesquisa jurídica', true, 19),
  ('administrativo', 'Administrativo interno', false, 30), ('comercial', 'Comercial / prospecção', false, 31), ('treinamento', 'Treinamento / estudo', false, 32), ('outro', 'Outro', true, 40)
on conflict (codigo) do nothing;
alter table public.ts_atividades enable row level security;
drop policy if exists ts_ativ_sel on public.ts_atividades; create policy ts_ativ_sel on public.ts_atividades for select to authenticated using (public.sou_equipe());
drop policy if exists ts_ativ_adm on public.ts_atividades; create policy ts_ativ_adm on public.ts_atividades for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update, delete on public.ts_atividades to authenticated;

-- ---------- tabelas de valor/hora ----------
create table if not exists public.ts_tabelas_hora (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  valor_hora numeric(12,2) not null default 0 check (valor_hora >= 0),
  ativa boolean not null default true,
  padrao boolean not null default false,
  created_at timestamptz default now()
);
insert into public.ts_tabelas_hora (nome, valor_hora, padrao) select 'Tabela padrão', 0, true where not exists (select 1 from public.ts_tabelas_hora);
alter table public.ts_tabelas_hora enable row level security;
drop policy if exists ts_tab_sel on public.ts_tabelas_hora; create policy ts_tab_sel on public.ts_tabelas_hora for select to authenticated using (public.sou_equipe());
drop policy if exists ts_tab_adm on public.ts_tabelas_hora; create policy ts_tab_adm on public.ts_tabelas_hora for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update, delete on public.ts_tabelas_hora to authenticated;

-- ---------- cliente: tabela de hora, horas contratadas e honorário mensal ----------
alter table public.clientes
  add column if not exists tabela_hora_id uuid references public.ts_tabelas_hora (id) on delete set null,
  add column if not exists horas_contratadas_mes numeric(7,2),
  add column if not exists honorario_mensal numeric(12,2);

-- ---------- apontamentos: novos campos ----------
alter table public.apontamentos_horas
  add column if not exists inicio time,
  add column if not exists fim time,
  add column if not exists cobravel boolean not null default true,
  add column if not exists processo_id uuid references public.processos (id) on delete set null,
  add column if not exists status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'correcao')),
  add column if not exists aprovado_por uuid,
  add column if not exists aprovado_em timestamptz,
  add column if not exists obs_gestor text;
create index if not exists apont_status_idx on public.apontamentos_horas (status) where status <> 'aprovado';
create index if not exists apont_tarefa_idx on public.apontamentos_horas (tarefa_id);

-- só admin muda status/aprovação; edição de lançamento aprovado por não-admin volta a pendente
create or replace function public.ts_proteger_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.sou_admin() then new.status := 'pendente'; new.aprovado_por := null; new.aprovado_em := null; new.obs_gestor := null; end if;
    if new.cobravel is null then new.cobravel := coalesce((select cobravel_padrao from public.ts_atividades where codigo = new.tipo_atividade), true); end if;
    return new;
  end if;
  if not public.sou_admin() then
    if new.status is distinct from old.status or new.obs_gestor is distinct from old.obs_gestor then new.status := old.status; new.obs_gestor := old.obs_gestor; end if;
    if old.status = 'aprovado' and (new.horas is distinct from old.horas or new.data is distinct from old.data or new.cliente_id is distinct from old.cliente_id or new.cobravel is distinct from old.cobravel or new.tipo_atividade is distinct from old.tipo_atividade) then
      new.status := 'pendente'; new.aprovado_por := null; new.aprovado_em := null;
    end if;
    if old.status = 'correcao' and (new.horas is distinct from old.horas or new.data is distinct from old.data or new.descricao is distinct from old.descricao or new.cliente_id is distinct from old.cliente_id or new.cobravel is distinct from old.cobravel or new.tipo_atividade is distinct from old.tipo_atividade) then
      new.status := 'pendente';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ts_proteger on public.apontamentos_horas;
create trigger ts_proteger before insert or update on public.apontamentos_horas for each row execute function public.ts_proteger_tg();

-- aprovar / pedir correção (admin). Avisa o colaborador no sino quando pede correção.
create or replace function public.ts_aprovar(p_ids uuid[], p_status text, p_obs text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; r record;
begin
  if not public.sou_admin() then raise exception 'Só administradores aprovam horas.'; end if;
  if p_status not in ('aprovado', 'correcao', 'pendente') then raise exception 'Status inválido.'; end if;
  update public.apontamentos_horas set status = p_status, obs_gestor = case when p_status = 'correcao' then p_obs else null end,
         aprovado_por = case when p_status = 'aprovado' then auth.uid() end, aprovado_em = case when p_status = 'aprovado' then now() end, updated_at = now(), updated_by = auth.uid()
   where id = any(p_ids);
  get diagnostics n = row_count;
  if p_status = 'correcao' then
    for r in select distinct co.perfil_id, co.nome from public.apontamentos_horas a join public.colaboradores co on co.id = a.colaborador_id where a.id = any(p_ids) and co.perfil_id is not null loop
      perform public.notificar(r.perfil_id, 'Horas devolvidas para correção', coalesce(left(p_obs, 140), 'Veja a observação do gestor na aba Horas'), '#horas');
    end loop;
  end if;
  return n;
end $$;
grant execute on function public.ts_aprovar(uuid[], text, text) to authenticated;

-- ---------- cronômetro persistente (um por colaborador) ----------
create table if not exists public.ts_cronometros (
  colaborador_id uuid primary key references public.colaboradores (id) on delete cascade,
  inicio timestamptz not null default now(),
  cliente_id text references public.clientes (id) on delete set null,
  tarefa_id uuid references public.tarefas (id) on delete set null,
  processo_id uuid references public.processos (id) on delete set null,
  tipo_atividade text,
  descricao text
);
alter table public.ts_cronometros enable row level security;
drop policy if exists ts_cron_own on public.ts_cronometros; create policy ts_cron_own on public.ts_cronometros for all to authenticated using (colaborador_id = public.meu_colaborador() or public.sou_admin()) with check (colaborador_id = public.meu_colaborador() or public.sou_admin());
grant select, insert, update, delete on public.ts_cronometros to authenticated;

create or replace function public.ts_cronometro_iniciar(p_cliente text default null, p_tarefa uuid default null, p_processo uuid default null, p_atividade text default null, p_descricao text default null)
returns public.ts_cronometros language plpgsql security definer set search_path = public as $$
declare me uuid := public.meu_colaborador(); r public.ts_cronometros;
begin
  if me is null then raise exception 'Seu usuário não está vinculado a um colaborador.'; end if;
  if exists (select 1 from public.ts_cronometros where colaborador_id = me) then raise exception 'Já existe um cronômetro rodando — pare-o antes.'; end if;
  insert into public.ts_cronometros (colaborador_id, cliente_id, tarefa_id, processo_id, tipo_atividade, descricao) values (me, p_cliente, p_tarefa, p_processo, p_atividade, p_descricao) returning * into r;
  return r;
end $$;
-- parar: grava o apontamento (mínimo 5 min, arredondado para cima em blocos de 5 min) e remove o cronômetro
create or replace function public.ts_cronometro_parar(p_descricao text default null, p_descartar boolean default false)
returns public.apontamentos_horas language plpgsql security definer set search_path = public as $$
declare me uuid := public.meu_colaborador(); c public.ts_cronometros; a public.apontamentos_horas; mins numeric;
begin
  select * into c from public.ts_cronometros where colaborador_id = me;
  if c.colaborador_id is null then raise exception 'Nenhum cronômetro rodando.'; end if;
  delete from public.ts_cronometros where colaborador_id = me;
  if p_descartar then return null; end if;
  mins := greatest(5, ceil(extract(epoch from (now() - c.inicio)) / 60 / 5) * 5);
  insert into public.apontamentos_horas (colaborador_id, data, horas, inicio, fim, cliente_id, tarefa_id, processo_id, tipo_atividade, descricao, cobravel, created_by)
  values (me, (c.inicio at time zone 'America/Sao_Paulo')::date, round(mins / 60.0, 2), (c.inicio at time zone 'America/Sao_Paulo')::time, (now() at time zone 'America/Sao_Paulo')::time,
          c.cliente_id, c.tarefa_id, c.processo_id, coalesce(c.tipo_atividade, 'outro'), coalesce(p_descricao, c.descricao),
          coalesce((select cobravel_padrao from public.ts_atividades where codigo = c.tipo_atividade), true), auth.uid())
  returning * into a;
  return a;
end $$;
grant execute on function public.ts_cronometro_iniciar(text, uuid, uuid, text, text) to authenticated;
grant execute on function public.ts_cronometro_parar(text, boolean) to authenticated;

-- ---------- views ----------
drop view if exists public.v_horas_colaborador_mes; drop view if exists public.v_horas_cliente_mes; drop view if exists public.v_horas_tipo_mes; drop view if exists public.v_apontamentos;
create view public.v_apontamentos with (security_invoker = true) as
select a.*,
       co.nome as colaborador_nome, co.nucleo,
       c.nome as cliente_nome,
       t.titulo as tarefa_titulo,
       date_trunc('month', a.data)::date as mes,
       coalesce(at.nome, a.tipo_atividade) as atividade_nome,
       p.numero_cnj,
       coalesce(th.valor_hora, (select valor_hora from public.ts_tabelas_hora where padrao limit 1), 0) as valor_hora,
       case when a.cobravel then a.horas * coalesce(th.valor_hora, (select valor_hora from public.ts_tabelas_hora where padrao limit 1), 0) else 0 end as valor,
       public.nome_perfil(a.aprovado_por) as aprovado_por_nome
from public.apontamentos_horas a
join public.colaboradores co on co.id = a.colaborador_id
left join public.clientes c on c.id = a.cliente_id
left join public.ts_tabelas_hora th on th.id = c.tabela_hora_id
left join public.tarefas t on t.id = a.tarefa_id
left join public.processos p on p.id = a.processo_id
left join public.ts_atividades at on at.codigo = a.tipo_atividade;
grant select on public.v_apontamentos to authenticated;

create view public.v_horas_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, nucleo, sum(horas) as horas, count(*) as lancamentos,
       sum(horas) filter (where cobravel) as horas_cobraveis, sum(valor) as valor,
       count(*) filter (where status = 'pendente') as pendentes, count(*) filter (where status = 'correcao') as em_correcao,
       count(distinct data) as dias_com_lancamento
from public.v_apontamentos group by 1,2,3,4;
grant select on public.v_horas_colaborador_mes to authenticated;

create view public.v_horas_cliente_mes with (security_invoker = true) as
select a.mes, a.cliente_id, a.cliente_nome, sum(a.horas) as horas, count(*) as lancamentos,
       sum(a.horas) filter (where a.cobravel) as horas_cobraveis, sum(a.valor) as valor,
       c.horas_contratadas_mes, c.honorario_mensal,
       case when c.horas_contratadas_mes is not null then c.horas_contratadas_mes - sum(a.horas) filter (where a.cobravel) end as saldo_horas,
       case when c.honorario_mensal is not null and sum(a.horas) filter (where a.cobravel) > 0 then round(c.honorario_mensal / (sum(a.horas) filter (where a.cobravel)), 2) end as honorario_por_hora_efetivo
from public.v_apontamentos a left join public.clientes c on c.id = a.cliente_id group by 1,2,3,c.horas_contratadas_mes,c.honorario_mensal;
grant select on public.v_horas_cliente_mes to authenticated;

create view public.v_horas_tipo_mes with (security_invoker = true) as
select mes, coalesce(tipo_atividade,'outro') as tipo_atividade, atividade_nome, sum(horas) as horas, count(*) as lancamentos, sum(horas) filter (where cobravel) as horas_cobraveis
from public.v_apontamentos group by 1,2,3;
grant select on public.v_horas_tipo_mes to authenticated;

create or replace view public.v_horas_atividade_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, coalesce(tipo_atividade,'outro') as tipo_atividade, atividade_nome, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3,4,5;
grant select on public.v_horas_atividade_colaborador_mes to authenticated;

create or replace view public.v_horas_tarefa with (security_invoker = true) as
select t.id as tarefa_id, t.titulo, t.cliente_id, c.nome as cliente_nome, t.responsavel_id, co.nome as responsavel_nome, t.status, t.prazo,
       coalesce(sum(a.horas), 0) as horas, coalesce(sum(a.horas) filter (where a.cobravel), 0) as horas_cobraveis, count(a.id) as lancamentos, min(a.data) as primeiro, max(a.data) as ultimo
from public.tarefas t left join public.apontamentos_horas a on a.tarefa_id = t.id left join public.clientes c on c.id = t.cliente_id left join public.colaboradores co on co.id = t.responsavel_id
group by t.id, t.titulo, t.cliente_id, c.nome, t.responsavel_id, co.nome, t.status, t.prazo;
grant select on public.v_horas_tarefa to authenticated;

-- ===================== beta 0005_pastas_extrajudiciais_contratos.sql =====================
-- ESPELHO (beta) — Pastas sem processo (extrajudicial / consultivo) e contratos bancários apontando para a pasta.
-- Idempotente. Depende de beta 0002/0003.

alter table public.pastas
  add column if not exists tipo text not null default 'judicial' check (tipo in ('judicial', 'extrajudicial', 'consultivo')),
  add column if not exists descricao text;

-- contrato bancário (passivo) → pasta
alter table public.contratos add column if not exists pasta_numero integer references public.pastas (numero) on delete set null;
create index if not exists contratos_pasta_idx on public.contratos (pasta_numero);

-- abrir pasta diretamente pelo cliente (sem processo)
create or replace function public.pasta_abrir(p_cliente text, p_titulo text default null, p_tipo text default 'extrajudicial', p_descricao text default null)
returns public.pastas language plpgsql security definer set search_path = public as $$
declare r public.pastas;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  insert into public.pastas (cliente_id, titulo, tipo, descricao) values (p_cliente, nullif(trim(p_titulo), ''), coalesce(p_tipo, 'extrajudicial'), nullif(trim(p_descricao), '')) returning * into r;
  return r;
end $$;
grant execute on function public.pasta_abrir(text, text, text, text) to authenticated;

-- vincular/desvincular contratos bancários a uma pasta (vários de uma vez; null desvincula)
create or replace function public.pasta_vincular_contratos(p_pasta integer, p_contratos text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  update public.contratos set pasta_numero = p_pasta where id = any(p_contratos);
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.pasta_vincular_contratos(integer, text[]) to authenticated;

-- processo que entra numa pasta extrajudicial a torna judicial
create or replace function public.processos_pasta_tipo_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pasta_numero is not null then update public.pastas set tipo = 'judicial', updated_at = now() where numero = new.pasta_numero and tipo <> 'judicial'; end if;
  return new;
end $$;
drop trigger if exists processos_pasta_tipo on public.processos;
create trigger processos_pasta_tipo after insert or update of pasta_numero on public.processos for each row execute function public.processos_pasta_tipo_tg();

drop view if exists public.v_pastas;
create view public.v_pastas with (security_invoker = true) as
select pa.numero, pa.titulo, pa.cliente_id, pa.status, pa.aberta_em, pa.encerrada_em, pa.tipo_encerramento, pa.caixa_arquivo, pa.observacoes, pa.created_by, pa.created_at, pa.updated_at,
       c.nome as cliente_nome,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero) as qtd_processos,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero and p.status = 'ativo') as qtd_ativos,
       (select string_agg(coalesce(p.numero_cnj, p.tipo_acao), ' · ' order by p.created_at) from public.processos p where p.pasta_numero = pa.numero) as processos_txt,
       pa.ano, pa.seq, pa.codigo, pa.tipo, pa.descricao,
       (select count(*) from public.contratos k where k.pasta_numero = pa.numero) as qtd_contratos,
       (select string_agg(coalesce(k.banco, k.dados->>'banco', k.id), ' · ' order by k.created_at) from public.contratos k where k.pasta_numero = pa.numero) as contratos_txt
  from public.pastas pa left join public.clientes c on c.id = pa.cliente_id;
grant select on public.v_pastas to authenticated;

-- ===================== beta 0006_contratos_honorarios_faturamento.sql =====================
-- ESPELHO (beta) — Bloco 3 da controladoria: contrato de honorários como entidade + solicitação de faturamento (SF) + comissões.
-- Modelo (inspirado no Legale, adaptado):
--   contratos_honorarios: o contrato de prestação de serviços do escritório com o cliente (não confundir com `contratos` = contratos
--     bancários do cliente). Código CH-AAAA-NNNN, tipo, status, vigência, valores (entrada/parcelas/mensalidade/êxito), horas contratadas,
--     tabela de hora, pasta, responsável, aditivos. Um contrato ativo alimenta clientes.horas_contratadas_mes / honorario_mensal / tabela_hora_id.
--   solicitacoes_faturamento (SF): quem presta o serviço pede o faturamento → financeiro autoriza (ou não) → fatura (gera cobranças no
--     painel; a emissão no Asaas continua pela tela Financeiro / Edge em produção). Código SF-AAAA-NNNN, parcelas geradas na autorização.
--   comissoes: previstas na SF (closer 8% sobre a entrada, rateios manuais), liberadas quando a cobrança correspondente é paga.
-- Idempotente. Depende de beta 0002–0005.

-- ---------- contrato de honorários ----------
create table if not exists public.contratos_honorarios (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  ano integer, seq integer, codigo text unique,
  cliente_id text not null references public.clientes (id) on delete cascade,
  pasta_numero integer references public.pastas (numero) on delete set null,
  fechamento_id uuid references public.fechamentos (id) on delete set null,
  tipo text not null default 'gestao_passivos' check (tipo in ('gestao_passivos', 'ad_exitum', 'partido', 'avulso', 'consulta', 'prestacao_servico', 'superendividamento', 'outro')),
  subtipo text check (subtipo in ('contencioso', 'consultivo', 'misto')),
  area text,
  status text not null default 'ativo' check (status in ('minuta', 'enviado', 'assinado', 'ativo', 'encerrado', 'cancelado')),
  responsavel_id uuid references public.colaboradores (id) on delete set null,
  closer_id uuid references public.colaboradores (id) on delete set null,
  descricao_servico text,
  valor_total numeric(14,2),
  entrada numeric(14,2),
  parcelas integer, valor_parcela numeric(14,2), vencimento_dia integer,
  mensalidade numeric(14,2),
  exito_pct numeric(5,2),
  forma_pagamento text,
  indice_reajuste text,
  horas_contratadas_mes numeric(7,2),
  tabela_hora_id uuid references public.ts_tabelas_hora (id) on delete set null,
  vigencia_inicio date, vigencia_fim date, indeterminado boolean not null default true, periodicidade text,
  assinado_em date, contrato_url text,
  observacoes text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists ch_cliente_idx on public.contratos_honorarios (cliente_id);
create index if not exists ch_status_idx on public.contratos_honorarios (status);
alter table public.contratos_honorarios enable row level security;
drop policy if exists ch_sel on public.contratos_honorarios; create policy ch_sel on public.contratos_honorarios for select to authenticated using (public.sou_equipe());
drop policy if exists ch_mod on public.contratos_honorarios; create policy ch_mod on public.contratos_honorarios for all to authenticated using (public.sou_equipe() and (public.sou_admin() or public.tem_acesso('financeiro') or public.tem_acesso('comercial'))) with check (public.sou_equipe() and (public.sou_admin() or public.tem_acesso('financeiro') or public.tem_acesso('comercial')));
grant select, insert, update, delete on public.contratos_honorarios to authenticated;

create or replace function public.ch_codigo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.ano := extract(year from coalesce(new.vigencia_inicio, new.assinado_em, current_date))::integer;
    select coalesce(max(seq), 0) + 1 into new.seq from public.contratos_honorarios where ano = new.ano;
    new.codigo := 'CH-' || new.ano || '-' || lpad(new.seq::text, 4, '0');
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists ch_codigo on public.contratos_honorarios;
create trigger ch_codigo before insert or update on public.contratos_honorarios for each row execute function public.ch_codigo();

-- contrato ativo → espelha no cliente (horas contratadas, honorário mensal, tabela de hora) para o timesheet
create or replace function public.ch_espelhar_cliente_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare c public.contratos_honorarios;
begin
  select * into c from public.contratos_honorarios where cliente_id = coalesce(new.cliente_id, old.cliente_id) and status in ('ativo', 'assinado') order by vigencia_inicio desc nulls last, created_at desc limit 1;
  update public.clientes set horas_contratadas_mes = c.horas_contratadas_mes, honorario_mensal = coalesce(c.mensalidade, case when c.parcelas > 0 then c.valor_parcela end), tabela_hora_id = c.tabela_hora_id
   where id = coalesce(new.cliente_id, old.cliente_id);
  return coalesce(new, old);
end $$;
drop trigger if exists ch_espelhar_cliente on public.contratos_honorarios;
create trigger ch_espelhar_cliente after insert or update or delete on public.contratos_honorarios for each row execute function public.ch_espelhar_cliente_tg();

-- aditivos
create table if not exists public.contratos_honorarios_aditivos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos_honorarios (id) on delete cascade,
  data date not null default current_date,
  descricao text not null,
  valor_delta numeric(14,2),
  nova_vigencia_fim date,
  url text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
alter table public.contratos_honorarios_aditivos enable row level security;
drop policy if exists cha_sel on public.contratos_honorarios_aditivos; create policy cha_sel on public.contratos_honorarios_aditivos for select to authenticated using (public.sou_equipe());
drop policy if exists cha_mod on public.contratos_honorarios_aditivos; create policy cha_mod on public.contratos_honorarios_aditivos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update, delete on public.contratos_honorarios_aditivos to authenticated;

-- backfill: um contrato por fechamento (dados.honorarios), se ainda não houver contrato para o cliente
insert into public.contratos_honorarios (cliente_id, fechamento_id, tipo, status, closer_id, entrada, parcelas, valor_parcela, vencimento_dia, mensalidade, exito_pct, forma_pagamento, observacoes, vigencia_inicio, assinado_em, contrato_url, valor_total, created_at)
select f.cliente_id, f.id, 'gestao_passivos', 'ativo', f.closer_id,
       nullif(f.dados->'honorarios'->>'entrada', '')::numeric, nullif(f.dados->'honorarios'->>'parcelas', '')::integer, nullif(f.dados->'honorarios'->>'valor_parcela', '')::numeric,
       nullif(f.dados->'honorarios'->>'vencimento_dia', '')::integer, nullif(f.dados->'honorarios'->>'mensalidade', '')::numeric, nullif(f.dados->'honorarios'->>'exito_pct', '')::numeric,
       f.dados->'honorarios'->>'forma', f.dados->'honorarios'->>'observacoes',
       coalesce(nullif(f.dados->'condicoes'->>'data_fechamento', '')::date, f.created_at::date), case when f.contrato_gerado_em is not null then f.contrato_gerado_em::date end, f.contrato_url,
       coalesce(nullif(f.dados->'honorarios'->>'entrada', '')::numeric, 0) + coalesce(nullif(f.dados->'honorarios'->>'parcelas', '')::numeric, 0) * coalesce(nullif(f.dados->'honorarios'->>'valor_parcela', '')::numeric, 0),
       f.created_at
  from public.fechamentos f
 where not exists (select 1 from public.contratos_honorarios ch where ch.cliente_id = f.cliente_id);

-- ---------- solicitação de faturamento ----------
create table if not exists public.solicitacoes_faturamento (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  ano integer, seq integer, codigo text unique,
  cliente_id text not null references public.clientes (id) on delete cascade,
  contrato_id uuid references public.contratos_honorarios (id) on delete set null,
  pasta_numero integer references public.pastas (numero) on delete set null,
  processo_id uuid references public.processos (id) on delete set null,
  solicitante_id uuid references public.colaboradores (id) on delete set null,
  area text,
  tipo text not null default 'parcela' check (tipo in ('entrada', 'parcela', 'mensalidade', 'exito', 'sucumbencia', 'avulso', 'custas', 'outro')),
  descricao text not null,
  valor_total numeric(14,2) not null check (valor_total > 0),
  qtd_parcelas integer not null default 1 check (qtd_parcelas between 1 and 120),
  vencimento_inicial date not null,
  forma text not null default 'UNDEFINED',
  emitir_nf boolean not null default true,
  status text not null default 'em_analise' check (status in ('em_analise', 'autorizada', 'faturada', 'nao_autorizada', 'cancelada')),
  autorizada_por uuid, autorizada_em timestamptz, motivo text,
  faturada_em timestamptz,
  rateio jsonb not null default '[]'::jsonb,   -- [{colaborador_id, papel, pct}] comissões previstas
  observacoes text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), updated_at timestamptz not null default now()
);
create index if not exists sf_status_idx on public.solicitacoes_faturamento (status, created_at desc);
create index if not exists sf_cliente_idx on public.solicitacoes_faturamento (cliente_id);
alter table public.solicitacoes_faturamento enable row level security;
drop policy if exists sf_sel on public.solicitacoes_faturamento; create policy sf_sel on public.solicitacoes_faturamento for select to authenticated using (public.sou_equipe());
drop policy if exists sf_ins on public.solicitacoes_faturamento; create policy sf_ins on public.solicitacoes_faturamento for insert to authenticated with check (public.sou_equipe());
drop policy if exists sf_upd on public.solicitacoes_faturamento; create policy sf_upd on public.solicitacoes_faturamento for update to authenticated using (public.sou_equipe() and (public.pode_financeiro() or (status = 'em_analise' and created_by = auth.uid()))) with check (public.sou_equipe());
grant select, insert, update on public.solicitacoes_faturamento to authenticated;

create or replace function public.sf_codigo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.ano := extract(year from current_date)::integer;
    select coalesce(max(seq), 0) + 1 into new.seq from public.solicitacoes_faturamento where ano = new.ano;
    new.codigo := 'SF-' || new.ano || '-' || lpad(new.seq::text, 4, '0');
  end if;
  if new.solicitante_id is null then new.solicitante_id := public.meu_colaborador(); end if;
  -- comissão do closer: 8% sobre a entrada (regra confirmada 20/10/2026), prevista automaticamente quando a SF é de entrada
  if tg_op = 'INSERT' and new.tipo = 'entrada' and jsonb_array_length(new.rateio) = 0 then
    new.rateio := coalesce((select jsonb_build_array(jsonb_build_object('colaborador_id', ch.closer_id, 'papel', 'closer', 'pct', 8)) from public.contratos_honorarios ch where ch.id = new.contrato_id and ch.closer_id is not null), '[]'::jsonb);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sf_codigo on public.solicitacoes_faturamento;
create trigger sf_codigo before insert or update on public.solicitacoes_faturamento for each row execute function public.sf_codigo();

-- parcelas da SF (geradas na autorização) e vínculo com a cobrança gerada
create table if not exists public.sf_parcelas (
  id uuid primary key default gen_random_uuid(),
  sf_id uuid not null references public.solicitacoes_faturamento (id) on delete cascade,
  n integer not null,
  valor numeric(14,2) not null,
  vencimento date not null,
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  unique (sf_id, n)
);
alter table public.sf_parcelas enable row level security;
drop policy if exists sfp_sel on public.sf_parcelas; create policy sfp_sel on public.sf_parcelas for select to authenticated using (public.sou_equipe());
grant select on public.sf_parcelas to authenticated;
alter table public.cobrancas add column if not exists sf_id uuid references public.solicitacoes_faturamento (id) on delete set null;

-- comissões
create table if not exists public.comissoes (
  id uuid primary key default gen_random_uuid(),
  sf_id uuid references public.solicitacoes_faturamento (id) on delete cascade,
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  colaborador_id uuid not null references public.colaboradores (id) on delete cascade,
  papel text not null default 'closer',
  pct numeric(5,2) not null,
  base numeric(14,2) not null,
  valor numeric(14,2) generated always as (round(base * pct / 100, 2)) stored,
  status text not null default 'prevista' check (status in ('prevista', 'liberada', 'paga', 'cancelada')),
  liberada_em timestamptz, paga_em date,
  created_at timestamptz not null default now()
);
create index if not exists comissoes_colab_idx on public.comissoes (colaborador_id, status);
alter table public.comissoes enable row level security;
drop policy if exists com_sel on public.comissoes; create policy com_sel on public.comissoes for select to authenticated using (public.pode_financeiro() or colaborador_id = public.meu_colaborador());
drop policy if exists com_mod on public.comissoes; create policy com_mod on public.comissoes for update to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
grant select, update on public.comissoes to authenticated;

-- autorizar: gera as parcelas (mensais a partir do vencimento inicial) e as comissões previstas
create or replace function public.sf_autorizar(p_id uuid, p_autorizar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento; i integer; v numeric; resto numeric; r jsonb; base numeric;
begin
  if not public.pode_financeiro() then raise exception 'Só o financeiro autoriza faturamento.'; end if;
  select * into s from public.solicitacoes_faturamento where id = p_id;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if s.status <> 'em_analise' then raise exception 'Esta solicitação já foi %.', s.status; end if;
  if not p_autorizar then
    update public.solicitacoes_faturamento set status = 'nao_autorizada', autorizada_por = auth.uid(), autorizada_em = now(), motivo = p_motivo where id = p_id;
    perform public.notificar(co.perfil_id, 'Faturamento não autorizado', s.codigo || ' · ' || coalesce(left(p_motivo, 120), 'ver solicitação'), '#faturamento') from public.colaboradores co where co.id = s.solicitante_id and co.perfil_id is not null;
    return;
  end if;
  delete from public.sf_parcelas where sf_id = p_id;
  v := trunc(s.valor_total / s.qtd_parcelas, 2); resto := s.valor_total - v * s.qtd_parcelas;
  for i in 1..s.qtd_parcelas loop
    insert into public.sf_parcelas (sf_id, n, valor, vencimento) values (p_id, i, v + case when i = 1 then resto else 0 end, (s.vencimento_inicial + ((i - 1) || ' month')::interval)::date);
  end loop;
  delete from public.comissoes where sf_id = p_id and status = 'prevista';
  base := s.valor_total;
  for r in select * from jsonb_array_elements(s.rateio) loop
    if nullif(r->>'colaborador_id', '') is not null and coalesce((r->>'pct')::numeric, 0) > 0 then
      insert into public.comissoes (sf_id, colaborador_id, papel, pct, base) values (p_id, (r->>'colaborador_id')::uuid, coalesce(r->>'papel', 'rateio'), (r->>'pct')::numeric, base);
    end if;
  end loop;
  update public.solicitacoes_faturamento set status = 'autorizada', autorizada_por = auth.uid(), autorizada_em = now(), motivo = p_motivo where id = p_id;
  perform public.notificar(co.perfil_id, 'Faturamento autorizado', s.codigo || ' · ' || public.brl(s.valor_total), '#faturamento') from public.colaboradores co where co.id = s.solicitante_id and co.perfil_id is not null;
end $$;
grant execute on function public.sf_autorizar(uuid, boolean, text) to authenticated;

-- faturar: cria as cobranças no painel (origem 'painel'); em produção a tela Financeiro emite no Asaas a partir delas
create or replace function public.sf_faturar(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento; p record; cid uuid; n integer := 0; tipo_cob text;
begin
  if not public.pode_financeiro() then raise exception 'Só o financeiro fatura.'; end if;
  select * into s from public.solicitacoes_faturamento where id = p_id;
  if s.status <> 'autorizada' then raise exception 'A solicitação precisa estar autorizada.'; end if;
  tipo_cob := case s.tipo when 'entrada' then 'entrada' when 'parcela' then 'parcela' when 'mensalidade' then 'mensalidade' when 'exito' then 'exito' else 'outro' end;
  for p in select * from public.sf_parcelas where sf_id = p_id and cobranca_id is null order by n loop
    insert into public.cobrancas (cliente_id, tipo, descricao, valor, vencimento, vencimento_original, status, forma, parcela, total_parcelas, origem, sf_id, created_by)
    values (s.cliente_id, tipo_cob, s.descricao || case when s.qtd_parcelas > 1 then format(' (%s/%s)', p.n, s.qtd_parcelas) else '' end, p.valor, p.vencimento, p.vencimento, 'pendente', s.forma, p.n, s.qtd_parcelas, 'painel', p_id, auth.uid())
    returning id into cid;
    update public.sf_parcelas set cobranca_id = cid where id = p.id; n := n + 1;
  end loop;
  update public.solicitacoes_faturamento set status = 'faturada', faturada_em = now() where id = p_id;
  return n;
end $$;
grant execute on function public.sf_faturar(uuid) to authenticated;

create or replace function public.sf_cancelar(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento;
begin
  select * into s from public.solicitacoes_faturamento where id = p_id;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not (public.pode_financeiro() or (s.status = 'em_analise' and s.created_by = auth.uid())) then raise exception 'Sem permissão.'; end if;
  if s.status = 'faturada' then raise exception 'Já faturada — cancele as cobranças no Financeiro.'; end if;
  update public.solicitacoes_faturamento set status = 'cancelada', motivo = p_motivo where id = p_id;
  update public.comissoes set status = 'cancelada' where sf_id = p_id and status = 'prevista';
end $$;
grant execute on function public.sf_cancelar(uuid, text) to authenticated;

-- cobrança paga → comissões da SF liberadas (proporcional à parcela paga); closer só sobre a entrada efetivamente paga
create or replace function public.comissoes_liberar_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento;
begin
  if new.status = 'paga' and (old.status is distinct from 'paga') and new.sf_id is not null then
    select * into s from public.solicitacoes_faturamento where id = new.sf_id;
    -- comissão sobre o valor pago desta cobrança: cria uma liberada por rateio (a prevista da SF continua como referência até todas pagarem)
    insert into public.comissoes (sf_id, cobranca_id, colaborador_id, papel, pct, base, status, liberada_em)
    select c.sf_id, new.id, c.colaborador_id, c.papel, c.pct, coalesce(new.valor_pago, new.valor), 'liberada', now()
      from public.comissoes c where c.sf_id = new.sf_id and c.status = 'prevista' and c.cobranca_id is null
       and not exists (select 1 from public.comissoes x where x.cobranca_id = new.id and x.colaborador_id = c.colaborador_id);
    -- quando todas as parcelas estão pagas, a prevista some
    if not exists (select 1 from public.cobrancas k where k.sf_id = new.sf_id and k.status <> 'paga') then
      delete from public.comissoes where sf_id = new.sf_id and status = 'prevista' and cobranca_id is null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists comissoes_liberar on public.cobrancas;
create trigger comissoes_liberar after update of status on public.cobrancas for each row execute function public.comissoes_liberar_tg();

-- ---------- views ----------
create or replace view public.v_contratos_honorarios with (security_invoker = true) as
select ch.*, c.nome as cliente_nome, pa.codigo as pasta_codigo, co.nome as responsavel_nome, cl.nome as closer_nome, th.nome as tabela_hora_nome,
       (select count(*) from public.contratos_honorarios_aditivos a where a.contrato_id = ch.id) as qtd_aditivos,
       (select count(*) from public.solicitacoes_faturamento s where s.contrato_id = ch.id) as qtd_sf,
       (select coalesce(sum(s.valor_total), 0) from public.solicitacoes_faturamento s where s.contrato_id = ch.id and s.status in ('autorizada', 'faturada')) as faturado,
       (select coalesce(sum(k.valor_pago), 0) from public.cobrancas k join public.solicitacoes_faturamento s on s.id = k.sf_id where s.contrato_id = ch.id and k.status = 'paga') as recebido
  from public.contratos_honorarios ch
  join public.clientes c on c.id = ch.cliente_id
  left join public.pastas pa on pa.numero = ch.pasta_numero
  left join public.colaboradores co on co.id = ch.responsavel_id
  left join public.colaboradores cl on cl.id = ch.closer_id
  left join public.ts_tabelas_hora th on th.id = ch.tabela_hora_id;
grant select on public.v_contratos_honorarios to authenticated;

create or replace view public.v_solicitacoes_faturamento with (security_invoker = true) as
select s.*, c.nome as cliente_nome, ch.codigo as contrato_codigo, pa.codigo as pasta_codigo, p.numero_cnj, so.nome as solicitante_nome, public.nome_perfil(s.autorizada_por) as autorizada_por_nome,
       (select count(*) from public.sf_parcelas x where x.sf_id = s.id) as qtd_geradas,
       (select count(*) from public.cobrancas k where k.sf_id = s.id and k.status = 'paga') as parcelas_pagas,
       (select coalesce(sum(k.valor_pago), 0) from public.cobrancas k where k.sf_id = s.id and k.status = 'paga') as valor_pago,
       (select coalesce(sum(round(x.base * x.pct / 100, 2)), 0) from public.comissoes x where x.sf_id = s.id and x.status = 'prevista') as comissao_prevista
  from public.solicitacoes_faturamento s
  join public.clientes c on c.id = s.cliente_id
  left join public.contratos_honorarios ch on ch.id = s.contrato_id
  left join public.pastas pa on pa.numero = s.pasta_numero
  left join public.processos p on p.id = s.processo_id
  left join public.colaboradores so on so.id = s.solicitante_id;
grant select on public.v_solicitacoes_faturamento to authenticated;

create or replace view public.v_comissoes with (security_invoker = true) as
select x.*, co.nome as colaborador_nome, s.codigo as sf_codigo, s.cliente_id, c.nome as cliente_nome, s.tipo as sf_tipo, k.vencimento, k.pago_em, date_trunc('month', coalesce(k.pago_em, x.created_at::date))::date as mes
  from public.comissoes x
  join public.colaboradores co on co.id = x.colaborador_id
  left join public.solicitacoes_faturamento s on s.id = x.sf_id
  left join public.clientes c on c.id = s.cliente_id
  left join public.cobrancas k on k.id = x.cobranca_id;
grant select on public.v_comissoes to authenticated;

-- ===================== beta 0007_prazo_unico_publicacoes_sugestao.sql =====================
-- ESPELHO (beta) — Prazo único (o prazo do processo vem das tarefas) e sugestão de cliente nas publicações sem vínculo.
-- Idempotente. Depende de beta 0002–0006.

-- ---------- 1. prazo do processo = tarefa aberta com prazo mais próximo (o campo manual fica só como reserva) ----------
create or replace function public.processo_proximo_prazo(p public.processos) returns date language sql stable as $$
  select coalesce((select min(t.prazo) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null), p.proximo_prazo)
$$;
create or replace function public.processo_prazo_fatal(p public.processos) returns boolean language sql stable as $$
  select coalesce((select bool_or(t.prazo_fatal) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null
                    and t.prazo = (select min(x.prazo) from public.tarefas x where x.processo_id = p.id and x.status in ('aberta','em_andamento') and x.prazo is not null)), p.prazo_fatal, false)
$$;

create or replace view public.v_processos with (security_invoker = true) as
select p.id, p.cliente_id, p.contrato_id, p.numero_cnj, p.tribunal, p.vara, p.tipo_acao, p.parte_contraria, p.banco, p.polo, p.fase, p.valor_causa,
       public.processo_proximo_prazo(p) as proximo_prazo, public.processo_prazo_fatal(p) as prazo_fatal,
       p.responsavel_id, p.status, p.visivel_cliente, p.fonte, p.id_externo, p.observacoes, p.created_at, p.created_by, p.updated_at, p.updated_by,
       c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (public.processo_proximo_prazo(p) - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia,
       p.pasta_numero, p.area, p.comarca, p.uf, p.rito, p.assunto, p.data_distribuicao, p.sub_status, p.encerrado_em, p.tipo_encerramento,
       p.relevante, p.sigiloso, p.grau_risco, p.risco_cliente, p.advogado_contrario,
       pa.titulo as pasta_titulo, pa.status as pasta_status,
       public.processo_campos_faltando(p) as campos_faltando,
       (select count(*) from public.processo_relacoes r where r.processo_id = p.id or r.relacionado_id = p.id) as qtd_relacionados,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id) as qtd_publicacoes,
       pa.codigo as pasta_codigo,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id and pb.providencia is null) as publicacoes_pendentes,
       (select t.id from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null order by t.prazo limit 1) as proxima_tarefa_id,
       (select t.titulo from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null order by t.prazo limit 1) as proxima_tarefa_titulo
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id
left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_processos to authenticated;

-- processos com "próximo prazo" manual e sem tarefa correspondente: vira uma tarefa (prazo), para o conceito ficar único
insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, prioridade, status)
select 'Prazo — ' || coalesce(p.numero_cnj, p.tipo_acao, 'processo'), 'Migrado do campo "próximo prazo" do processo (prazo único).', p.cliente_id, p.id, p.responsavel_id, 'juridico', p.proximo_prazo, coalesce(p.prazo_fatal, false), case when p.prazo_fatal then 1 else 2 end, 'aberta'
  from public.processos p
 where p.proximo_prazo is not null and p.proximo_prazo >= current_date - 30 and p.status = 'ativo'
   and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo = p.proximo_prazo);

-- ---------- 2. publicações sem vínculo: sugerir cliente pelo nome das partes ----------
alter table public.publicacoes add column if not exists cliente_sugerido_id text references public.clientes (id) on delete set null;
create or replace function public.publicacao_sugerir_cliente(p_id bigint) returns text language plpgsql security definer set search_path = public as $$
declare pub public.publicacoes; achado text; nm text;
begin
  select * into pub from public.publicacoes where id = p_id;
  if pub.processo_id is not null then return null; end if;
  -- 1) número do processo bate com um processo da base → vincula direto
  if pub.numero_processo is not null then
    select pr.id::text into achado from public.processos pr where pr.numero_cnj = pub.numero_processo limit 1;
    if achado is not null then update public.publicacoes set processo_id = achado::uuid where id = p_id; return null; end if;
  end if;
  -- 2) nome de uma das partes contém o nome (ou fantasia) do cliente
  for nm in select d->>'nome' from jsonb_array_elements(coalesce(pub.destinatarios, '[]'::jsonb)) d where coalesce(d->>'nome', '') <> '' loop
    select c.id into achado from public.clientes c
     where c.ativo is distinct from false
       and (length(coalesce(c.nome, '')) >= 6 and unaccent(lower(nm)) like '%' || unaccent(lower(c.nome)) || '%'
            or length(coalesce(c.nome_fantasia, '')) >= 6 and unaccent(lower(nm)) like '%' || unaccent(lower(c.nome_fantasia)) || '%'
            or c.cnpj is not null and regexp_replace(nm, '\D', '', 'g') <> '' and regexp_replace(nm, '\D', '', 'g') = regexp_replace(c.cnpj, '\D', '', 'g'))
     limit 1;
    if achado is not null then update public.publicacoes set cliente_sugerido_id = achado where id = p_id; return achado; end if;
  end loop;
  return null;
end $$;
create extension if not exists unaccent;
create or replace function public.publicacoes_sugerir_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.publicacao_sugerir_cliente(new.id); return new; end $$;
drop trigger if exists publicacoes_sugerir on public.publicacoes;
create trigger publicacoes_sugerir after insert on public.publicacoes for each row execute function public.publicacoes_sugerir_tg();
-- backfill das pendentes sem vínculo
do $$ declare r record; begin for r in select id from public.publicacoes where processo_id is null and providencia is null loop perform public.publicacao_sugerir_cliente(r.id); end loop; end $$;

create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id) as tarefas_atribuidas,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as tarefas_atribuidas_abertas,
       (select string_agg(coalesce(cc.nome,'?') || coalesce(' · ' || to_char(x.prazo,'DD/MM'), ''), ', ' order by x.prazo) from public.tarefas x left join public.colaboradores cc on cc.id = x.responsavel_id where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as atribuidas_para,
       p.providencia, p.tratada_em, public.nome_perfil(p.tratada_por) as tratada_por_nome, p.encaminhada_para, ce.nome as encaminhada_para_nome, p.observacao_tratamento,
       p.prazo_tratamento,
       case when p.providencia is null then null else (p.tratada_em at time zone 'America/Sao_Paulo')::date <= p.prazo_tratamento end as tempestiva,
       case when p.providencia is null then p.prazo_tratamento - current_date end as dias_para_tratar,
       pr.pasta_numero, pa.codigo as pasta_codigo,
       p.cliente_sugerido_id, cs.nome as cliente_sugerido_nome
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.pastas pa on pa.numero = pr.pasta_numero
left join public.clientes c on c.id = p.cliente_id
left join public.clientes cs on cs.id = p.cliente_sugerido_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.colaboradores ce on ce.id = p.encaminhada_para
left join public.tarefas t on t.id = p.tarefa_id;
grant select on public.v_publicacoes to authenticated;

-- ===================== beta 0008_dossie_frentes.sql =====================
-- ESPELHO (beta) — Dossiê do cliente e as três frentes (Estratégico/Consultivo · Jurídico/Contencioso · Negocial/Acordos).
-- Um único "Registrar" (entradas_timeline) com frente, tipo e fixado; responsável por frente = frente do colaborador (padrão),
-- com exceção por cliente; view v_dossie que junta registros, andamentos, tarefas feitas, publicações tratadas, negociações e cobranças.
-- Idempotente. Depende de beta 0002–0007.

-- ---------- frentes ----------
alter table public.colaboradores add column if not exists frente text check (frente in ('estrategico', 'juridico', 'negocial'));
alter table public.clientes
  add column if not exists resp_estrategico_id uuid references public.colaboradores (id) on delete set null,
  add column if not exists resp_juridico_id uuid references public.colaboradores (id) on delete set null,
  add column if not exists resp_negocial_id uuid references public.colaboradores (id) on delete set null;

-- ---------- registro único ----------
alter table public.entradas_timeline
  add column if not exists frente text check (frente in ('estrategico', 'juridico', 'negocial')),
  add column if not exists fixado boolean not null default false,
  add column if not exists negociacao_id uuid references public.negociacoes (id) on delete set null;
create index if not exists tl_cliente_frente_idx on public.entradas_timeline (cliente_id, frente, data desc);
create index if not exists tl_fixado_idx on public.entradas_timeline (cliente_id) where fixado;

-- tipos novos: informação do cliente, decisão, motivo de não fazer, registro de trabalho, contato com cliente
alter table public.entradas_timeline drop constraint if exists entradas_timeline_tipo_check;
alter table public.entradas_timeline add constraint entradas_timeline_tipo_check check (tipo in ('solicitacao_documentos','requerimento_bacen','analise_contrato','parecer_tecnico','contato_banco',
  'proposta_acordo','reuniao_cliente','ata','protocolo','mudanca_estagio','acordo_fechado','andamento','tarefa','outro',
  'registro','informacao_cliente','decisao','nao_feito','contato_cliente'));
-- frente padrão: do núcleo da tarefa / do colaborador que registra
create or replace function public.frente_do_nucleo(n text) returns text language sql immutable as $$
  select case n when 'juridico' then 'juridico' when 'acordos' then 'negocial' when 'acompanhamento_pj' then 'estrategico' when 'pos_vendas' then 'estrategico' else null end
$$;
create or replace function public.tl_frente_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.frente is null then
    new.frente := coalesce((select public.frente_do_nucleo(t.nucleo) from public.tarefas t where t.id = new.tarefa_id),
                           case when new.negociacao_id is not null then 'negocial' when new.processo_id is not null then 'juridico' end,
                           (select co.frente from public.colaboradores co where co.id = coalesce(new.responsavel_id, public.meu_colaborador())));
  end if;
  return new;
end $$;
drop trigger if exists tl_frente on public.entradas_timeline;
create trigger tl_frente before insert on public.entradas_timeline for each row execute function public.tl_frente_tg();

-- aviso ao responsável da frente (exceção do cliente, senão ninguém — a frente inteira vê no dossiê)
create or replace function public.tl_avisar_frente_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare dest uuid; perfil uuid; nome text;
begin
  if new.frente is null or new.automatica then return new; end if;
  select case new.frente when 'estrategico' then c.resp_estrategico_id when 'juridico' then c.resp_juridico_id else c.resp_negocial_id end, c.nome into dest, nome from public.clientes c where c.id = new.cliente_id;
  if dest is null or dest = coalesce(new.responsavel_id, public.meu_colaborador()) then return new; end if;
  select perfil_id into perfil from public.colaboradores where id = dest;
  if perfil is not null then perform public.notificar(perfil, 'Registro na sua frente · ' || coalesce(nome, ''), left(new.descricao, 140), '#clientes/' || new.cliente_id); end if;
  return new;
end $$;
drop trigger if exists tl_avisar_frente on public.entradas_timeline;
create trigger tl_avisar_frente after insert on public.entradas_timeline for each row execute function public.tl_avisar_frente_tg();

-- ---------- dossiê: tudo do cliente em uma linha do tempo ----------
create or replace view public.v_dossie with (security_invoker = true) as
select 'registro' as origem, e.id::text as ref_id, e.cliente_id, e.data::timestamptz + coalesce(e.created_at::time, '12:00'::time) as quando, e.frente, e.tipo, e.descricao as texto,
       coalesce(co.nome, public.nome_perfil(e.created_by)) as autor, e.processo_id, p.numero_cnj, e.contrato_id, e.tarefa_id, e.negociacao_id, e.visivel_cliente, e.fixado, e.horas
  from public.entradas_timeline e left join public.colaboradores co on co.id = e.responsavel_id left join public.processos p on p.id = e.processo_id
 where e.andamento_id is null and e.tarefa_id is null
union all
select 'andamento', a.id::text, p.cliente_id, a.data::timestamptz + '12:00'::time, 'juridico', coalesce(a.tipo, 'andamento'), a.descricao, public.nome_perfil(a.created_by), a.processo_id, p.numero_cnj, p.contrato_id, null, null, a.visivel_cliente, false, null
  from public.andamentos a join public.processos p on p.id = a.processo_id where p.cliente_id is not null
union all
select 'tarefa', t.id::text, t.cliente_id, t.concluida_em, coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end), 'tarefa_feita',
       t.titulo || coalesce(E'\n' || (select ev.nota from public.tarefa_eventos ev where ev.tarefa_id = t.id and ev.tipo = 'comentario' and ev.criado_em >= t.concluida_em - interval '2 minutes' order by ev.criado_em desc limit 1), ''),
       coalesce(co.nome, public.nome_perfil(t.concluida_por)), t.processo_id, p.numero_cnj, t.contrato_id, t.id, null, false, false, null
  from public.tarefas t left join public.colaboradores co on co.id = t.responsavel_id left join public.processos p on p.id = t.processo_id
 where t.status = 'concluida' and t.concluida_em is not null and t.cliente_id is not null
union all
select 'publicacao', pb.id::text, coalesce(pb.cliente_id, p.cliente_id), pb.tratada_em, 'juridico', 'publicacao_' || pb.providencia,
       coalesce(pb.tipo_documento, pb.tipo_comunicacao, 'Publicação') || ' · ' || coalesce(left(pb.texto, 200), '') || coalesce(E'\n→ ' || pb.observacao_tratamento, ''),
       public.nome_perfil(pb.tratada_por), pb.processo_id, pb.numero_processo, null, pb.tarefa_id, null, false, false, null
  from public.publicacoes pb left join public.processos p on p.id = pb.processo_id
 where pb.providencia is not null and pb.tratada_em is not null and coalesce(pb.cliente_id, p.cliente_id) is not null
union all
select 'negociacao', n.id::text, n.cliente_id, n.updated_at, 'negocial', 'negociacao_' || n.etapa,
       coalesce(n.titulo, n.banco, 'Negociação') || ' · etapa: ' || n.etapa || coalesce(' · ' || n.proximo_passo, ''),
       co.nome, n.processo_id, n.numero_processo, n.contrato_id, null, n.id, false, false, null
  from public.negociacoes n left join public.colaboradores co on co.id = n.responsavel_id
union all
select 'cobranca', k.id::text, k.cliente_id, coalesce(k.pago_em::timestamptz, k.atualizado_em), 'estrategico', 'cobranca_' || k.status,
       coalesce(k.descricao, k.tipo) || ' · ' || public.brl(k.valor) || case when k.status = 'paga' then ' · paga' when k.status = 'atrasada' then ' · ATRASADA (venc. ' || to_char(k.vencimento, 'DD/MM') || ')' else '' end,
       null, null, null, k.contrato_id, null, null, false, false, null
  from public.cobrancas k where k.cliente_id is not null and k.status in ('paga', 'atrasada');
grant select on public.v_dossie to authenticated;

-- resumo por frente, por cliente (para as três colunas do dossiê e o Hoje)
create or replace view public.v_cliente_frentes with (security_invoker = true) as
select c.id as cliente_id, f.frente,
       case f.frente when 'estrategico' then c.resp_estrategico_id when 'juridico' then c.resp_juridico_id else c.resp_negocial_id end as responsavel_id,
       (select max(d.quando) from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente) as ultimo_em,
       (select d.texto from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente order by d.quando desc limit 1) as ultimo_texto,
       (select d.autor from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente order by d.quando desc limit 1) as ultimo_autor,
       (select min(t.prazo) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta', 'em_andamento') and coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end) = f.frente) as proximo_prazo,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta', 'em_andamento') and coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end) = f.frente) as tarefas_abertas,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos
  from public.clientes c cross join (values ('estrategico'), ('juridico'), ('negocial')) as f(frente)
 where c.ativo is distinct from false;
grant select on public.v_cliente_frentes to authenticated;

-- v_colaboradores com a frente (coluna nova no fim)
create or replace view public.v_colaboradores with (security_invoker = true) as
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
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo, co.google_calendar_id, co.agenda_sync, co.agenda_sync_em, co.agenda_sync_erro,
       co.registra_ponto, co.jornada_minutos,
       co.frente
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;
grant select on public.v_colaboradores to authenticated;

-- ===================== beta 0009_andamentos_sem_duplicidade.sql =====================
-- ESPELHO (beta) — Andamentos duplicados (mesma intimação captada várias vezes pelo DJEN, um registro por destinatário).
-- 1) Limpeza: apaga as cópias mantendo a mais antiga (texto, data e processo iguais), religando publicações/timeline que apontavam para a cópia.
-- 2) Prevenção: índice único para andamentos automáticos (fonte <> 'manual') por processo + data + texto — o "on conflict do nothing" do DJEN passa a valer.
-- 3) v_dossie já lê andamentos sem repetição.
-- Idempotente.

create or replace function public.andamentos_deduplicar() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  for r in
    select a.id as dup, (select x.id from public.andamentos x where x.processo_id = a.processo_id and x.data = a.data and md5(x.descricao) = md5(a.descricao) order by x.created_at, x.id limit 1) as mantido
      from public.andamentos a
     where exists (select 1 from public.andamentos y where y.processo_id = a.processo_id and y.data = a.data and md5(y.descricao) = md5(a.descricao) and (y.created_at, y.id) < (a.created_at, a.id))
  loop
    update public.publicacoes set andamento_id = r.mantido where andamento_id = r.dup;
    update public.entradas_timeline set andamento_id = r.mantido where andamento_id = r.dup;
    delete from public.andamentos where id = r.dup; n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.andamentos_deduplicar() to authenticated;

-- limpa agora (como superusuário do script, sem a checagem de admin)
do $$ declare r record; begin
  for r in
    select a.id as dup, (select x.id from public.andamentos x where x.processo_id = a.processo_id and x.data = a.data and md5(x.descricao) = md5(a.descricao) order by x.created_at, x.id limit 1) as mantido
      from public.andamentos a
     where exists (select 1 from public.andamentos y where y.processo_id = a.processo_id and y.data = a.data and md5(y.descricao) = md5(a.descricao) and (y.created_at, y.id) < (a.created_at, a.id))
  loop
    update public.publicacoes set andamento_id = r.mantido where andamento_id = r.dup;
    update public.entradas_timeline set andamento_id = r.mantido where andamento_id = r.dup;
    delete from public.andamentos where id = r.dup;
  end loop;
end $$;

create unique index if not exists andamentos_auto_unicos_idx on public.andamentos (processo_id, data, md5(descricao)) where fonte <> 'manual';

-- ===================== beta 0010_dossie_trabalho_anexos_tarefa.sql =====================
-- ESPELHO (beta) — Dossiê = só o que o escritório faz (registros, tarefas: abertura, passagem, comentários, conclusão, negociações).
-- Andamentos e publicações saem do dossiê e ficam na página do processo. Comentários/conclusões de tarefa aceitam anexos.
-- Idempotente. Depende de beta 0008.

-- anexos em eventos de tarefa (comentário, conclusão)
alter table public.anexos alter column entrada_id drop not null;
alter table public.anexos add column if not exists tarefa_evento_id bigint references public.tarefa_eventos (id) on delete cascade;
alter table public.anexos add column if not exists tarefa_id uuid references public.tarefas (id) on delete cascade;
alter table public.anexos drop constraint if exists anexos_dono_chk;
alter table public.anexos add constraint anexos_dono_chk check (entrada_id is not null or tarefa_evento_id is not null);
create index if not exists anexos_tarefa_idx on public.anexos (tarefa_id);
-- RLS: equipe lê/escreve anexos de tarefa (os de timeline já têm política própria)
drop policy if exists anexos_tarefa_eq on public.anexos;
create policy anexos_tarefa_eq on public.anexos for all to authenticated using (public.sou_equipe() and tarefa_evento_id is not null) with check (public.sou_equipe() and tarefa_evento_id is not null);

create or replace view public.v_tarefa_anexos with (security_invoker = true) as
select a.id, a.tarefa_id, a.tarefa_evento_id, a.nome, a.caminho_storage, a.tamanho, a.mime, a.created_at from public.anexos a where a.tarefa_evento_id is not null;
grant select on public.v_tarefa_anexos to authenticated;

-- dossiê: trabalho do escritório
drop view if exists public.v_cliente_frentes;
drop view if exists public.v_dossie;
create view public.v_dossie with (security_invoker = true) as
select 'registro' as origem, e.id::text as ref_id, e.cliente_id, e.data::timestamptz + coalesce(e.created_at::time, '12:00'::time) as quando, e.frente, e.tipo, e.descricao as texto,
       coalesce(co.nome, public.nome_perfil(e.created_by)) as autor, e.processo_id, p.numero_cnj, pa.codigo as pasta_codigo, e.contrato_id, e.tarefa_id, e.negociacao_id, e.visivel_cliente, e.fixado, e.horas,
       (select count(*) from public.anexos x where x.entrada_id = e.id) as anexos
  from public.entradas_timeline e left join public.colaboradores co on co.id = e.responsavel_id left join public.processos p on p.id = e.processo_id left join public.pastas pa on pa.numero = p.pasta_numero
 where e.andamento_id is null and e.tarefa_id is null
union all
-- eventos de tarefa: abriu (para quem), passou (de → para + recado), comentou (+anexos), concluiu (o que foi feito)
select 'tarefa', ev.id::text, t.cliente_id, ev.criado_em, coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end),
       'tarefa_' || ev.tipo,
       case ev.tipo
         when 'criada' then 'Abriu a tarefa “' || t.titulo || '”' || coalesce(' para ' || ev.para, '')
         when 'reatribuida' then 'Passou “' || t.titulo || '” de ' || coalesce(ev.de, '—') || ' para ' || coalesce(ev.para, '—') || coalesce(E'\n' || ev.nota, '')
         when 'comentario' then '“' || t.titulo || '”' || E'\n' || coalesce(ev.nota, '')
         when 'concluida' then 'Concluiu “' || t.titulo || '”' || coalesce(E'\n' || ev.nota, '')
         when 'reaberta' then 'Reabriu “' || t.titulo || '”'
         when 'cancelada' then 'Cancelou “' || t.titulo || '”' || coalesce(E'\n' || ev.nota, '')
         else ev.tipo || ' · ' || t.titulo end,
       ev.autor_nome, t.processo_id, p.numero_cnj, pa.codigo, t.contrato_id, t.id, null, false, false, null,
       (select count(*) from public.anexos x where x.tarefa_evento_id = ev.id)
  from public.tarefa_eventos ev join public.tarefas t on t.id = ev.tarefa_id left join public.processos p on p.id = t.processo_id left join public.pastas pa on pa.numero = p.pasta_numero
 where t.cliente_id is not null and ev.tipo in ('criada', 'reatribuida', 'comentario', 'concluida', 'reaberta', 'cancelada')
union all
select 'negociacao', n.id::text, n.cliente_id, n.updated_at, 'negocial', 'negociacao_' || n.etapa,
       coalesce(n.titulo, n.banco, 'Negociação') || ' · etapa: ' || n.etapa || coalesce(' · ' || n.proximo_passo, ''),
       co.nome, n.processo_id, n.numero_processo, pa.codigo, n.contrato_id, null, n.id, false, false, null, 0
  from public.negociacoes n left join public.colaboradores co on co.id = n.responsavel_id left join public.processos p on p.id = n.processo_id left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_dossie to authenticated;

create view public.v_cliente_frentes with (security_invoker = true) as
select c.id as cliente_id, f.frente,
       case f.frente when 'estrategico' then c.resp_estrategico_id when 'juridico' then c.resp_juridico_id else c.resp_negocial_id end as responsavel_id,
       (select max(d.quando) from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente) as ultimo_em,
       (select d.texto from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente order by d.quando desc limit 1) as ultimo_texto,
       (select d.autor from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente order by d.quando desc limit 1) as ultimo_autor,
       (select min(t.prazo) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta', 'em_andamento') and coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end) = f.frente) as proximo_prazo,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta', 'em_andamento') and coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end) = f.frente) as tarefas_abertas,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos
  from public.clientes c cross join (values ('estrategico'), ('juridico'), ('negocial')) as f(frente)
 where c.ativo is distinct from false;
grant select on public.v_cliente_frentes to authenticated;

-- ===================== beta 0011_importacao_bruta.sql =====================
-- ESPELHO (beta) — mesa de transferência para importações (ex.: extração do ADVBox feita no navegador).
-- O navegador grava o JSON bruto aqui; o processamento é feito depois, em SQL/rpc. Só admins leem. Idempotente.
create table if not exists public.importacao_bruta (
  id uuid primary key default gen_random_uuid(),
  origem text not null,
  chave text not null,
  parte integer not null default 1,
  dados text not null,
  created_at timestamptz not null default now()
);
alter table public.importacao_bruta enable row level security;
-- qualquer cliente com a chave publicável pode DEPOSITAR (só inserir); ninguém além de admin lê/apaga
drop policy if exists imp_ins on public.importacao_bruta; create policy imp_ins on public.importacao_bruta for insert to authenticated with check (public.sou_equipe() and origem in ('advbox') and length(dados) < 2000000);
drop policy if exists imp_sel on public.importacao_bruta; create policy imp_sel on public.importacao_bruta for select to authenticated using (public.sou_admin());
drop policy if exists imp_del on public.importacao_bruta; create policy imp_del on public.importacao_bruta for delete to authenticated using (public.sou_admin());
grant insert on public.importacao_bruta to authenticated;
grant select, delete on public.importacao_bruta to authenticated;

-- ===================== beta 0012_entrada_frentes_ficha_passagem.sql =====================
-- ESPELHO (beta) — Reunião de 26/10 (setor de acordos): (1) cliente novo entra nas três frentes sozinho — a tarefa de acordos
-- deixa de depender de inadimplência; (2) Ficha de passagem (perguntas norteadoras) com histórico de quem respondeu e quando;
-- (3) ao concluir o ciclo de onboarding, a frente negocial é avisada com o que está (e o que não está) respondido.
-- Idempotente. Depende de beta 0008.

-- ---------- 1. entrada nas três frentes ----------
create or replace function public.resp_frente(p_frente text) returns uuid language sql stable as $$
  select id from public.colaboradores where ativo and frente = p_frente order by data_admissao nulls last limit 1
$$;
create or replace function public.cliente_entrada_frentes_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare novo boolean := (tg_op = 'INSERT'); resp_neg uuid; resp_est uuid; nome text;
begin
  if not novo then return new; end if;
  nome := coalesce(new.nome_fantasia, new.dados->>'nome', new.id);
  resp_neg := coalesce(new.resp_negocial_id, public.resp_frente('negocial'), (select id from public.colaboradores where ativo and nucleo = 'acordos' order by data_admissao nulls last limit 1));
  resp_est := coalesce(new.resp_estrategico_id, public.resp_frente('estrategico'), new.responsavel_onboarding_id);
  -- acordos: sempre (alçada e reserva se constroem desde o início), uma semana depois do onboarding
  if resp_neg is not null and not exists (select 1 from public.tarefas t where t.cliente_id = new.id and t.nucleo = 'acordos' and t.titulo like 'Acordos: estudo de caso%') then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Acordos: estudo de caso e reunião de mapeamento — ' || nome,
            E'Cliente novo. Antes da reunião: formulário de onboarding, ficha de passagem (Cadastro), transcrições/atas no dossiê, pareceres dos contratos.\nNa reunião: dívidas por banco, renegociações anteriores, alçada e reserva mensal. Depois: planejamento de quitação e reunião mensal.',
            new.id, resp_neg, 'acordos', current_date + 14, 2);
  end if;
  -- ficha de passagem nasce vazia (as perguntas aparecem como pendência no Hoje de quem faz o onboarding)
  insert into public.cliente_passagem (cliente_id, responsavel_id) values (new.id, resp_est) on conflict (cliente_id) do nothing;
  return new;
end $$;

-- ---------- 2. ficha de passagem ----------
create table if not exists public.cliente_passagem (
  cliente_id text primary key references public.clientes (id) on delete cascade,
  responsavel_id uuid references public.colaboradores (id) on delete set null,
  situacao text check (situacao in ('adimplente', 'vai_ficar_inadimplente', 'inadimplente')),
  inadimplente_desde date,
  patrimonio jsonb not null default '[]'::jsonb,              -- [{bem, status: exposto|em_transferencia|protegido|nao_compensa|nao_protegivel, obs}]
  patrimonio_concluido boolean not null default false,        -- blindagem encerrada (ciclo de 45 dias)
  renegociacoes_anteriores text,
  processos_existentes text,
  contratos_obtidos text,                                     -- quais contratos bancários já foram obtidos / faltam
  alcada numeric(14,2),
  reserva_mensal numeric(14,2),
  prazo_meses integer,
  observacoes text,
  onboarding_concluido_em date,
  historico jsonb not null default '[]'::jsonb,               -- [{campo, de, para, por, por_nome, em}]
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.cliente_passagem enable row level security;
drop policy if exists cp_sel on public.cliente_passagem; create policy cp_sel on public.cliente_passagem for select to authenticated using (public.sou_equipe());
drop policy if exists cp_mod on public.cliente_passagem; create policy cp_mod on public.cliente_passagem for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update on public.cliente_passagem to authenticated;
insert into public.cliente_passagem (cliente_id) select id from public.clientes where ativo is distinct from false on conflict do nothing;

create or replace function public.cliente_passagem_hist_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare h jsonb := '[]'::jsonb; campo text; de jsonb; para jsonb; nome text := public.nome_perfil(auth.uid()); dest uuid; perfil uuid; faltam text[];
begin
  foreach campo in array array['situacao','inadimplente_desde','patrimonio','patrimonio_concluido','renegociacoes_anteriores','processos_existentes','contratos_obtidos','alcada','reserva_mensal','prazo_meses','observacoes','onboarding_concluido_em'] loop
    de := to_jsonb(old) -> campo; para := to_jsonb(new) -> campo;
    if de is distinct from para then h := h || jsonb_build_object('campo', campo, 'de', de, 'para', para, 'por', auth.uid(), 'por_nome', nome, 'em', now()); end if;
  end loop;
  if h <> '[]'::jsonb then new.historico := coalesce(old.historico, '[]'::jsonb) || h; new.updated_at := now(); new.updated_by := auth.uid(); end if;
  -- ciclo concluído → avisa a frente negocial com o que falta
  if new.onboarding_concluido_em is not null and old.onboarding_concluido_em is null then
    faltam := array_remove(array[case when new.situacao is null then 'situação de inadimplência' end, case when jsonb_array_length(new.patrimonio) = 0 then 'patrimônio' end, case when new.renegociacoes_anteriores is null then 'renegociações anteriores' end, case when new.processos_existentes is null then 'processos existentes' end, case when new.contratos_obtidos is null then 'contratos obtidos' end], null);
    select coalesce(c.resp_negocial_id, public.resp_frente('negocial')) into dest from public.clientes c where c.id = new.cliente_id;
    select perfil_id into perfil from public.colaboradores where id = dest;
    if perfil is not null then perform public.notificar(perfil, 'Passagem de bastão: ' || coalesce((select nome from public.clientes where id = new.cliente_id), new.cliente_id), case when coalesce(array_length(faltam, 1), 0) = 0 then 'Onboarding concluído; ficha de passagem completa.' else 'Onboarding concluído. Ainda sem resposta: ' || array_to_string(faltam, ', ') end, '#clientes/' || new.cliente_id); end if;
    -- a tarefa de acordos passa a vencer em 7 dias, se ainda estiver mais longe
    update public.tarefas set prazo = least(prazo, current_date + 7) where cliente_id = new.cliente_id and nucleo = 'acordos' and status in ('aberta','em_andamento') and titulo like 'Acordos: estudo de caso%';
  end if;
  return new;
end $$;
drop trigger if exists cliente_passagem_hist on public.cliente_passagem;
create trigger cliente_passagem_hist before update on public.cliente_passagem for each row execute function public.cliente_passagem_hist_tg();

drop trigger if exists cliente_entrada_frentes on public.clientes;
create trigger cliente_entrada_frentes after insert on public.clientes for each row execute function public.cliente_entrada_frentes_tg();

-- pendências da ficha por cliente (para o Hoje e para o card)
create or replace view public.v_cliente_passagem with (security_invoker = true) as
select p.*, c.nome as cliente_nome, co.nome as responsavel_nome, c.created_at as cliente_desde,
       array_remove(array[case when p.situacao is null then 'situação de inadimplência' end, case when jsonb_array_length(p.patrimonio) = 0 then 'patrimônio' end, case when p.renegociacoes_anteriores is null then 'renegociações anteriores' end, case when p.processos_existentes is null then 'processos existentes' end, case when p.contratos_obtidos is null then 'contratos obtidos' end, case when p.alcada is null then 'alçada' end, case when p.reserva_mensal is null then 'reserva mensal' end], null) as faltam,
       (select count(*) from jsonb_array_elements(p.patrimonio) b where b->>'status' = 'exposto') as bens_expostos
  from public.cliente_passagem p join public.clientes c on c.id = p.cliente_id left join public.colaboradores co on co.id = p.responsavel_id
 where c.ativo is distinct from false;
grant select on public.v_cliente_passagem to authenticated;

-- ===================== beta 0013_timesheet_frente_processo.sql =====================
-- ESPELHO (beta) — Timesheet: cada lançamento ganha a frente de trabalho (Estratégico/Consultivo · Jurídico/Contencioso · Negocial/Acordos),
-- derivada da tarefa (núcleo) → processo (jurídico) → colaborador; e o código da pasta do processo. Pedido da Isadora (29/10):
-- colunas Processo e Tarefa no relatório e horas mapeadas por "divisão de trabalho" do cliente, sem criar tarefas-mãe artificiais.
-- Idempotente. Depende de beta 0004 e 0008.

alter table public.apontamentos_horas add column if not exists frente text check (frente in ('estrategico', 'juridico', 'negocial'));

create or replace function public.ts_frente_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.frente is null then
    new.frente := coalesce((select public.frente_do_nucleo(t.nucleo) from public.tarefas t where t.id = new.tarefa_id),
                           case when new.processo_id is not null then 'juridico' end,
                           case new.tipo_atividade when 'acordo' then 'negocial' when 'negociacao' then 'negocial' when 'reuniao_cliente' then 'estrategico' when 'onboarding' then 'estrategico' when 'audiencia' then 'juridico' when 'peticao' then 'juridico' when 'prazo' then 'juridico' end,
                           (select co.frente from public.colaboradores co where co.id = new.colaborador_id));
  end if;
  return new;
end $$;
drop trigger if exists ts_frente on public.apontamentos_horas;
create trigger ts_frente before insert or update of tarefa_id, processo_id, tipo_atividade on public.apontamentos_horas for each row execute function public.ts_frente_tg();

-- preenche o histórico
update public.apontamentos_horas a set frente = coalesce((select public.frente_do_nucleo(t.nucleo) from public.tarefas t where t.id = a.tarefa_id),
  case when a.processo_id is not null then 'juridico' end, (select co.frente from public.colaboradores co where co.id = a.colaborador_id)) where a.frente is null;

drop view if exists public.v_horas_colaborador_mes; drop view if exists public.v_horas_cliente_mes; drop view if exists public.v_horas_tipo_mes; drop view if exists public.v_horas_atividade_colaborador_mes; drop view if exists public.v_horas_cliente_frente_mes; drop view if exists public.v_apontamentos;
create view public.v_apontamentos with (security_invoker = true) as
select a.*,
       co.nome as colaborador_nome, co.nucleo,
       c.nome as cliente_nome,
       t.titulo as tarefa_titulo, t.nucleo as tarefa_nucleo, t.status as tarefa_status,
       date_trunc('month', a.data)::date as mes,
       coalesce(at.nome, a.tipo_atividade) as atividade_nome,
       p.numero_cnj, pa.codigo as pasta_codigo,
       case a.frente when 'estrategico' then 'Estratégico / Consultivo' when 'juridico' then 'Jurídico / Contencioso' when 'negocial' then 'Negocial / Acordos' end as frente_nome,
       coalesce(th.valor_hora, (select valor_hora from public.ts_tabelas_hora where padrao limit 1), 0) as valor_hora,
       case when a.cobravel then a.horas * coalesce(th.valor_hora, (select valor_hora from public.ts_tabelas_hora where padrao limit 1), 0) else 0 end as valor,
       public.nome_perfil(a.aprovado_por) as aprovado_por_nome
from public.apontamentos_horas a
join public.colaboradores co on co.id = a.colaborador_id
left join public.clientes c on c.id = a.cliente_id
left join public.ts_tabelas_hora th on th.id = c.tabela_hora_id
left join public.tarefas t on t.id = a.tarefa_id
left join public.processos p on p.id = a.processo_id
left join public.pastas pa on pa.numero = p.pasta_numero
left join public.ts_atividades at on at.codigo = a.tipo_atividade;
grant select on public.v_apontamentos to authenticated;

create view public.v_horas_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, nucleo, sum(horas) as horas, count(*) as lancamentos,
       sum(horas) filter (where cobravel) as horas_cobraveis, sum(valor) as valor,
       count(*) filter (where status = 'pendente') as pendentes, count(*) filter (where status = 'correcao') as em_correcao,
       count(distinct data) as dias_com_lancamento
from public.v_apontamentos group by 1,2,3,4;
grant select on public.v_horas_colaborador_mes to authenticated;

create view public.v_horas_cliente_mes with (security_invoker = true) as
select a.mes, a.cliente_id, a.cliente_nome, sum(a.horas) as horas, count(*) as lancamentos,
       sum(a.horas) filter (where a.cobravel) as horas_cobraveis, sum(a.valor) as valor,
       c.horas_contratadas_mes, c.honorario_mensal,
       case when c.horas_contratadas_mes is not null then c.horas_contratadas_mes - sum(a.horas) filter (where a.cobravel) end as saldo_horas,
       case when c.honorario_mensal is not null and sum(a.horas) filter (where a.cobravel) > 0 then round(c.honorario_mensal / (sum(a.horas) filter (where a.cobravel)), 2) end as honorario_por_hora_efetivo
from public.v_apontamentos a left join public.clientes c on c.id = a.cliente_id group by 1,2,3,c.horas_contratadas_mes,c.honorario_mensal;
grant select on public.v_horas_cliente_mes to authenticated;

create view public.v_horas_tipo_mes with (security_invoker = true) as
select mes, coalesce(tipo_atividade,'outro') as tipo_atividade, atividade_nome, sum(horas) as horas, count(*) as lancamentos, sum(horas) filter (where cobravel) as horas_cobraveis
from public.v_apontamentos group by 1,2,3;
grant select on public.v_horas_tipo_mes to authenticated;

create or replace view public.v_horas_atividade_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, coalesce(tipo_atividade,'outro') as tipo_atividade, atividade_nome, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3,4,5;
grant select on public.v_horas_atividade_colaborador_mes to authenticated;

-- horas por cliente × frente no mês (gestão dos dados: quanto de cada serviço cada cliente consome)
create or replace view public.v_horas_cliente_frente_mes with (security_invoker = true) as
select cliente_id, cliente_nome, mes, frente, frente_nome, sum(horas) as horas, sum(case when cobravel then horas else 0 end) as horas_cobraveis, sum(valor) as valor, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3,4,5;
grant select on public.v_horas_cliente_frente_mes to authenticated;

select 'ok 0080 consolidação beta' as resultado, (select count(*) from public.cliente_passagem) as fichas, (select count(*) from public.ts_atividades) as atividades_ts, (select count(*) from public.pastas) as pastas;