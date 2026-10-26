-- ESPELHO (beta) — parte 1 de 9: 0001_esquema_inicial.sql … 0017_pr8b_documentos_base.sql

-- ===== 0001_esquema_inicial.sql =====
-- =====================================================================
-- PAINEL DE PASSIVOS BANCÁRIOS — Neves Pádua Advocacia
-- Esquema inicial + segurança (RLS) + dados atuais. Gerado em 07/10/2026.
-- Cole tudo no SQL Editor do Supabase e clique em Run.
-- =====================================================================

-- ---------- Perfis de acesso ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  papel text not null default 'pendente' check (papel in ('admin','colaborador','cliente','pendente')),
  cliente_id text,
  created_at timestamptz default now()
);

-- Todo usuário novo ganha um perfil. O PRIMEIRO usuário vira admin; os demais ficam 'pendente' até um admin definir.
create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome, papel)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          case when not exists (select 1 from public.perfis where papel='admin') then 'admin' else 'pendente' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.criar_perfil();

-- Funções auxiliares (lidas pelas políticas)
create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid()
$$;
create or replace function public.meu_cliente() returns text
language sql stable security definer set search_path = public as $$
  select cliente_id from public.perfis where id = auth.uid()
$$;
create or replace function public.sou_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('admin','colaborador') from public.perfis where id = auth.uid()), false)
$$;
create or replace function public.sou_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' from public.perfis where id = auth.uid()), false)
$$;

-- ---------- Tabelas de dados ----------
-- Documentos em JSON (mesma estrutura do painel atual) + colunas-chave para segurança e consulta.
create table if not exists public.clientes (
  id text primary key,
  dados jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid
);
create table if not exists public.contratos (
  id text primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  dados jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid
);
create index if not exists contratos_cliente_idx on public.contratos(cliente_id);

-- Notas internas ficam FORA dos documentos: só a equipe lê.
create table if not exists public.notas_internas (
  id text primary key,              -- 'cliente:<id>' ou 'contrato:<id>'
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete cascade,
  texto text not null default '',
  updated_at timestamptz default now()
);

-- Base de acordos do escritório (referências reais)
create table if not exists public.historico (
  id text primary key,
  dados jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Regras de projeção (documento único)
create table if not exists public.regras (
  id text primary key default 'regras',
  dados jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Registro de alterações (auditoria simples)
create table if not exists public.auditoria (
  id bigserial primary key,
  quando timestamptz default now(),
  usuario uuid,
  tabela text, registro text, acao text,
  antes jsonb, depois jsonb
);

-- Visão anonimizada da base de acordos para o cálculo da projeção na visão do cliente
-- (sem observações, sem valores; só o necessário para a mediana por credor/grupo).
create or replace view public.referencias as
  select id,
         dados->>'credor' as credor,
         dados->>'grupo'  as grupo,
         coalesce(dados->>'forma','avista') as forma,
         case when (dados->>'divida')::numeric > 0
              then 1 - (dados->>'valorAcordo')::numeric / (dados->>'divida')::numeric end as "desc",
         dados->>'data' as data,
         dados->>'status' as status
  from public.historico;

-- ---------- Gatilhos: carimbo e auditoria ----------
create or replace function public.carimbar() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create or replace function public.auditar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria(usuario,tabela,registro,acao,antes,depois)
  values (auth.uid(), tg_table_name, coalesce(new.id, old.id), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['clientes','contratos','historico','regras','notas_internas'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- Segurança por linha (RLS) ----------
alter table public.perfis enable row level security;
alter table public.clientes enable row level security;
alter table public.contratos enable row level security;
alter table public.notas_internas enable row level security;
alter table public.historico enable row level security;
alter table public.regras enable row level security;
alter table public.auditoria enable row level security;

-- perfis: cada um vê o próprio; equipe vê todos; só admin altera
drop policy if exists perfis_sel on public.perfis;
create policy perfis_sel on public.perfis for select to authenticated using (id = auth.uid() or public.sou_equipe());
drop policy if exists perfis_upd on public.perfis;
create policy perfis_upd on public.perfis for update to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists perfis_del on public.perfis;
create policy perfis_del on public.perfis for delete to authenticated using (public.sou_admin() and id <> auth.uid());

-- clientes: equipe tudo; cliente só o próprio registro (leitura)
drop policy if exists clientes_sel on public.clientes;
create policy clientes_sel on public.clientes for select to authenticated using (public.sou_equipe() or id = public.meu_cliente());
drop policy if exists clientes_wr on public.clientes;
create policy clientes_wr on public.clientes for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- contratos: idem
drop policy if exists contratos_sel on public.contratos;
create policy contratos_sel on public.contratos for select to authenticated using (public.sou_equipe() or cliente_id = public.meu_cliente());
drop policy if exists contratos_wr on public.contratos;
create policy contratos_wr on public.contratos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- notas internas: só equipe
drop policy if exists notas_all on public.notas_internas;
create policy notas_all on public.notas_internas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- base de acordos: só equipe (cliente usa a visão 'referencias')
drop policy if exists hist_all on public.historico;
create policy hist_all on public.historico for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- regras: todos leem; só admin altera
drop policy if exists regras_sel on public.regras;
create policy regras_sel on public.regras for select to authenticated using (true);
drop policy if exists regras_wr on public.regras;
create policy regras_wr on public.regras for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- auditoria: só admin lê
drop policy if exists audit_sel on public.auditoria;
create policy audit_sel on public.auditoria for select to authenticated using (public.sou_admin());

-- A visão 'referencias' roda com os direitos de quem a criou (security definer), para o cliente conseguir ler a mediana sem ler a tabela.
alter view public.referencias set (security_invoker = false);
grant select on public.referencias to authenticated;
revoke all on public.referencias from anon;

-- Nada acessível sem login
revoke all on all tables in schema public from anon;

-- Tempo real: avisar as páginas abertas quando algo mudar
do $$ begin
  alter publication supabase_realtime add table public.clientes, public.contratos, public.historico, public.regras, public.notas_internas, public.perfis;
exception when others then null; end $$;

-- ---------- Parâmetros iniciais do motor (sem dados de clientes) ----------
insert into public.regras(id,dados) values ('regras','{"amplitude": 10, "descontoBase": -15, "fatorParcelado": -15, "fatoresBanco": {"Aymoré (Santander)": 0, "BTG": 0, "Banco do Brasil": 0, "Bradesco": 0, "C6": 0, "Caixa": 0, "Inter": 0, "Itaú": 0, "MGW Ativos (FIDC)": 0, "Nubank": 0, "PicPay": 0, "Safra": 0, "Santander": 0, "Sicoob": 0, "Sicoob Credinor": 0, "Sicoob Mantiqueira": 0, "Sicredi": 0}, "fatoresGarantia": {"aval": -5, "fianca_bancaria": "travar", "fundo": "travar", "hipoteca": "travar", "nenhuma": 0, "real_imovel": "travar", "real_movel": -5, "recebiveis": -10}, "fatoresGrupo": {"cooperativa": -25, "digital": -5, "fidc": 0, "outro": -10, "varejo": 0}, "fatoresProduto": {"cartao": 0, "ccb": 0, "cheque": 0, "contagar": 0, "giro": 0, "imovel": 0, "leasing": 0, "outro": 0, "pronampe": 0, "receb": -5, "rural_custeio": -5, "rural_invest": -5, "veiculo": 0}, "fatoresSituacao": {"acordo": 0, "ajuizado": 0, "cedido": 0, "cobranca": 0, "emdia": 0, "negativado": 0, "prejuizo": 5, "quitado": 0}, "fatoresTitular": {"PF": 0, "PJ": -5}, "margemReserva": 10, "minDiasAtraso": 180, "minRefs": 2, "prazoReservaPadrao": 6, "tetoDesconto": 97, "usarHistorico": true}'::jsonb) on conflict (id) do update set dados=excluded.dados;

-- Dados de clientes, contratos, notas e base de acordos: supabase/dados/0001_dados_iniciais.sql (fora do repositório).


-- ===== 0002_pr1_timeline_processos.sql =====
-- =====================================================================
-- 0002 — PR 1: colaboradores, contatos, processos, andamentos, timeline,
-- anexos, acordos, colunas geradas em contratos/clientes, migração dos
-- dados embutidos e entradas automáticas. Idempotente (pode rodar 2x).
-- Pré-requisito: 0001_esquema_inicial.sql
-- =====================================================================

-- ---------- Funções utilitárias ----------
create or replace function public.carimbar2() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;


-- auditoria: ids uuid nas tabelas novas → texto
create or replace function public.auditar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria(usuario,tabela,registro,acao,antes,depois)
  values (auth.uid(), tg_table_name, coalesce(new.id::text, old.id::text), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- conversão de texto 'AAAA-MM-DD' em data, marcada imutável para uso em coluna gerada
create or replace function public.data_imm(t text) returns date language plpgsql immutable as $$
begin
  if t is null or t = '' then return null; end if;
  return to_date(t, 'YYYY-MM-DD');
exception when others then return null;
end $$;

-- ---------- Colunas geradas nas tabelas existentes ----------
alter table public.clientes
  add column if not exists nome text generated always as (dados->>'nome') stored,
  add column if not exists ativo boolean not null default true,
  add column if not exists acesso_por_token boolean not null default false,
  add column if not exists token text unique;
alter table public.contratos
  add column if not exists banco text generated always as (dados->>'banco') stored,
  add column if not exists titular text generated always as (dados->>'titular') stored,
  add column if not exists produto text generated always as (dados->>'produto') stored,
  add column if not exists garantia text generated always as (dados->>'garantia') stored,
  add column if not exists situacao text generated always as (dados->>'situacao') stored,
  add column if not exists saldo_atual numeric generated always as (nullif(dados->>'saldoAtual','')::numeric) stored,
  add column if not exists data_inicio_atraso date generated always as (public.data_imm(dados->>'dataInicioAtraso')) stored,
  add column if not exists estagio_registrado smallint;   -- último estágio observado (para o gatilho de mudança)

-- ---------- Pessoas ----------
create table if not exists public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid unique references public.perfis(id) on delete set null,
  nome text not null,
  cargo text,
  nucleo text check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','administrativo','socios')),
  data_admissao date,
  responsabilidades text,
  ativo boolean not null default true,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
-- colaborador ligado ao usuário logado (null se não houver)
create or replace function public.meu_colaborador() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.colaboradores where perfil_id = auth.uid() limit 1
$$;

create table if not exists public.contatos (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete set null,
  nome text not null, cargo text, email text, telefone text,
  principal boolean not null default false,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists contatos_cliente_idx on public.contatos(cliente_id);

-- ---------- Contencioso ----------
create table if not exists public.processos (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  numero_cnj text unique,
  tribunal text, vara text, tipo_acao text, parte_contraria text, banco text,
  polo text check (polo in ('ativo','passivo')),
  fase text,
  valor_causa numeric,
  proximo_prazo date, prazo_fatal boolean not null default false,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  status text not null default 'ativo' check (status in ('ativo','suspenso','encerrado')),
  visivel_cliente boolean not null default true,
  fonte text not null default 'manual', id_externo text,
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists processos_cliente_idx on public.processos(cliente_id);

create table if not exists public.andamentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  data date not null,
  tipo text,
  descricao text not null,
  visivel_cliente boolean not null default false,
  fonte text not null default 'manual', id_externo text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists andamentos_processo_idx on public.andamentos(processo_id, data desc);

-- ---------- Timeline ----------
create table if not exists public.entradas_timeline (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  andamento_id uuid references public.andamentos(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('solicitacao_documentos','requerimento_bacen','analise_contrato','parecer_tecnico','contato_banco',
                                     'proposta_acordo','reuniao_cliente','ata','protocolo','mudanca_estagio','acordo_fechado','andamento','outro')),
  descricao text not null,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  horas numeric(6,2) not null default 0,
  links jsonb not null default '[]'::jsonb,      -- [{"titulo":"Ata","url":"https://..."}]
  visivel_cliente boolean not null default false,
  automatica boolean not null default false,
  fonte text not null default 'manual', id_externo text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists timeline_cliente_idx on public.entradas_timeline(cliente_id, data desc);

create table if not exists public.anexos (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid not null references public.entradas_timeline(id) on delete cascade,
  nome text not null, caminho_storage text not null, tamanho integer, mime text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);

-- ---------- Acordos (sai de dentro do contrato) ----------
create table if not exists public.acordos (
  id uuid primary key default gen_random_uuid(),
  contrato_id text not null references public.contratos(id) on delete cascade,
  cliente_id text not null references public.clientes(id) on delete cascade,
  data date not null,
  valor_pago numeric not null,
  desconto_obtido numeric, parcelas integer not null default 1,
  desconto_projetado numeric, saldo_no_acordo numeric, dias_no_acordo integer,
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create unique index if not exists acordos_contrato_uidx on public.acordos(contrato_id);

-- ---------- Carimbo + auditoria nas tabelas novas ----------
do $$ declare t text; begin
  foreach t in array array['colaboradores','contatos','processos','andamentos','entradas_timeline','anexos','acordos'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.colaboradores enable row level security;
alter table public.contatos enable row level security;
alter table public.processos enable row level security;
alter table public.andamentos enable row level security;
alter table public.entradas_timeline enable row level security;
alter table public.anexos enable row level security;
alter table public.acordos enable row level security;

-- colaboradores: equipe lê; admin escreve
drop policy if exists colab_sel on public.colaboradores;
create policy colab_sel on public.colaboradores for select to authenticated using (public.sou_equipe());
drop policy if exists colab_wr on public.colaboradores;
create policy colab_wr on public.colaboradores for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- contatos: equipe tudo; cliente lê os da própria empresa
drop policy if exists contatos_sel on public.contatos;
create policy contatos_sel on public.contatos for select to authenticated using (public.sou_equipe() or cliente_id = public.meu_cliente());
drop policy if exists contatos_wr on public.contatos;
create policy contatos_wr on public.contatos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- processos: equipe tudo; cliente lê os seus marcados como visíveis
drop policy if exists proc_sel on public.processos;
create policy proc_sel on public.processos for select to authenticated using (public.sou_equipe() or (cliente_id = public.meu_cliente() and visivel_cliente));
drop policy if exists proc_wr on public.processos;
create policy proc_wr on public.processos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- andamentos: equipe tudo; cliente lê visíveis de processos visíveis dos seus
drop policy if exists and_sel on public.andamentos;
create policy and_sel on public.andamentos for select to authenticated using (
  public.sou_equipe() or (visivel_cliente and exists (select 1 from public.processos p where p.id = processo_id and p.cliente_id = public.meu_cliente() and p.visivel_cliente)));
drop policy if exists and_wr on public.andamentos;
create policy and_wr on public.andamentos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- timeline: equipe tudo; cliente lê as suas visíveis
drop policy if exists tl_sel on public.entradas_timeline;
create policy tl_sel on public.entradas_timeline for select to authenticated using (public.sou_equipe() or (cliente_id = public.meu_cliente() and visivel_cliente));
drop policy if exists tl_wr on public.entradas_timeline;
create policy tl_wr on public.entradas_timeline for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- anexos: equipe tudo; cliente lê anexos de entradas visíveis suas
drop policy if exists anexos_sel on public.anexos;
create policy anexos_sel on public.anexos for select to authenticated using (
  public.sou_equipe() or exists (select 1 from public.entradas_timeline e where e.id = entrada_id and e.cliente_id = public.meu_cliente() and e.visivel_cliente));
drop policy if exists anexos_wr on public.anexos;
create policy anexos_wr on public.anexos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- acordos: equipe tudo; cliente lê os seus
drop policy if exists acordos_sel on public.acordos;
create policy acordos_sel on public.acordos for select to authenticated using (public.sou_equipe() or cliente_id = public.meu_cliente());
drop policy if exists acordos_wr on public.acordos;
create policy acordos_wr on public.acordos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

revoke all on all tables in schema public from anon;

-- ---------- Storage: bucket de anexos ----------
insert into storage.buckets (id, name, public) values ('anexos','anexos', false) on conflict (id) do nothing;
drop policy if exists anexos_storage_equipe on storage.objects;
create policy anexos_storage_equipe on storage.objects for all to authenticated
  using (bucket_id = 'anexos' and public.sou_equipe()) with check (bucket_id = 'anexos' and public.sou_equipe());
drop policy if exists anexos_storage_cliente on storage.objects;
create policy anexos_storage_cliente on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and split_part(name,'/',1) = public.meu_cliente()
         and exists (select 1 from public.anexos a join public.entradas_timeline e on e.id = a.entrada_id
                     where a.caminho_storage = name and e.visivel_cliente));

-- ---------- Entradas automáticas ----------
-- (1) andamento novo → entrada na timeline do cliente
create or replace function public.tl_de_andamento() returns trigger language plpgsql security definer set search_path = public as $$
declare cid text;
begin
  select cliente_id into cid from public.processos where id = new.processo_id;
  insert into public.entradas_timeline (cliente_id, processo_id, andamento_id, data, tipo, descricao, visivel_cliente, automatica, fonte, created_by)
  values (cid, new.processo_id, new.id, new.data, 'andamento', coalesce(new.tipo||': ','')||new.descricao, new.visivel_cliente, true, new.fonte, new.created_by);
  return new;
end $$;
drop trigger if exists andamento_para_timeline on public.andamentos;
create trigger andamento_para_timeline after insert on public.andamentos for each row execute procedure public.tl_de_andamento();
-- visibilidade do andamento acompanha a entrada da timeline
create or replace function public.tl_sync_andamento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.entradas_timeline set visivel_cliente = new.visivel_cliente, descricao = coalesce(new.tipo||': ','')||new.descricao, data = new.data
   where andamento_id = new.id;
  return new;
end $$;
drop trigger if exists andamento_sync_timeline on public.andamentos;
create trigger andamento_sync_timeline after update on public.andamentos for each row execute procedure public.tl_sync_andamento();

-- (2) acordo fechado → entrada na timeline
create or replace function public.tl_de_acordo() returns trigger language plpgsql security definer set search_path = public as $$
declare b text;
begin
  select banco into b from public.contratos where id = new.contrato_id;
  insert into public.entradas_timeline (cliente_id, contrato_id, data, tipo, descricao, visivel_cliente, automatica, created_by)
  values (new.cliente_id, new.contrato_id, new.data, 'acordo_fechado',
          format('Acordo fechado com %s: R$ %s%s', coalesce(b,'o banco'), to_char(new.valor_pago,'FM999G999G999D00'),
                 case when new.desconto_obtido is not null then format(' (desconto de %s%%)', round(new.desconto_obtido)) else '' end),
          true, true, new.created_by);
  return new;
end $$;
drop trigger if exists acordo_para_timeline on public.acordos;
create trigger acordo_para_timeline after insert on public.acordos for each row execute procedure public.tl_de_acordo();

-- espelho: contratos.dados.acordo (gravado pelo painel) → tabela acordos
create or replace function public.espelhar_acordo() returns trigger language plpgsql security definer set search_path = public as $$
declare a jsonb := new.dados->'acordo';
begin
  if a is not null and a <> 'null'::jsonb and coalesce((a->>'fechado')::boolean,false) then
    insert into public.acordos (contrato_id, cliente_id, data, valor_pago, desconto_obtido, parcelas, desconto_projetado, saldo_no_acordo, dias_no_acordo, created_by)
    values (new.id, new.cliente_id, nullif(a->>'data','')::date, (a->>'valorPago')::numeric, nullif(a->>'descontoObtido','')::numeric,
            coalesce(nullif(a->>'parcelas','')::int,1), nullif(a->>'descontoProjetado','')::numeric, nullif(a->>'saldoNoAcordo','')::numeric, nullif(a->>'diasNoAcordo','')::int, auth.uid())
    on conflict (contrato_id) do update set data = excluded.data, valor_pago = excluded.valor_pago, desconto_obtido = excluded.desconto_obtido,
      parcelas = excluded.parcelas, desconto_projetado = excluded.desconto_projetado, saldo_no_acordo = excluded.saldo_no_acordo, dias_no_acordo = excluded.dias_no_acordo;
  end if;
  return new;
end $$;
drop trigger if exists contrato_espelha_acordo on public.contratos;
create trigger contrato_espelha_acordo after insert or update of dados on public.contratos for each row execute procedure public.espelhar_acordo();

-- (3) mudança de estágio (Res. CMN 4.966): calculada a partir da data de início do atraso
create or replace function public.estagio_de(d date) returns smallint language sql immutable as $$
  select case when d is null then 1 when current_date - d > 90 then 3 when current_date - d > 30 then 2 else 1 end::smallint
$$;
create or replace function public.registrar_mudancas_estagio() returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; e smallint;
begin
  for r in select id, cliente_id, banco, produto, data_inicio_atraso, estagio_registrado from public.contratos where coalesce(situacao,'') <> 'quitado' loop
    e := public.estagio_de(r.data_inicio_atraso);
    if r.estagio_registrado is null then
      update public.contratos set estagio_registrado = e where id = r.id;   -- primeira observação: só registra
    elsif r.estagio_registrado <> e then
      insert into public.entradas_timeline (cliente_id, contrato_id, data, tipo, descricao, visivel_cliente, automatica)
      values (r.cliente_id, r.id, current_date, 'mudanca_estagio',
              format('Contrato %s (%s) passou do estágio %s para o estágio %s (Res. CMN 4.966/2021).', coalesce(r.banco,'?'), coalesce(r.produto,''), r.estagio_registrado, e),
              true, true);
      update public.contratos set estagio_registrado = e where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
-- agendamento diário (pg_cron vem habilitado no Supabase; se não estiver, habilite em Database → Extensions)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'estagios_diario';
  perform cron.schedule('estagios_diario', '15 3 * * *', $c$ select public.registrar_mudancas_estagio(); $c$);
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;
select public.registrar_mudancas_estagio();  -- primeira observação agora

-- ---------- Migração dos dados embutidos ----------
-- timeline embutida em clientes.dados.timeline → entradas_timeline (uma vez; marca os itens migrados)
insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte, id_externo)
select c.id, nullif(t->>'data','')::date, 'outro', t->>'texto', true, false, 'migracao', 'tl:'||c.id||':'||(t->>'id')
from public.clientes c, jsonb_array_elements(coalesce(c.dados->'timeline','[]'::jsonb)) t
where nullif(t->>'data','') is not null
  and not exists (select 1 from public.entradas_timeline e where e.id_externo = 'tl:'||c.id||':'||(t->>'id'));
-- acordos embutidos → tabela acordos (dispara o espelho)
update public.contratos set dados = dados where dados->'acordo' is not null and dados->'acordo' <> 'null'::jsonb;

-- ---------- Tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.colaboradores, public.contatos, public.processos, public.andamentos, public.entradas_timeline, public.anexos, public.acordos;
exception when others then null; end $$;

-- Fim. Conferência: select count(*) from public.entradas_timeline;  -- esperado 3 (Alphamec)


-- ===== 0003_pr2_tarefas_timesheet.sql =====
-- 0003 — PR 2: tarefas e prazos + timesheet (apontamentos de horas)
-- Idempotente. Depende de 0002 (colaboradores, processos, entradas_timeline, carimbar2, auditar, sou_equipe, sou_admin, meu_colaborador).

-- ---------- Tarefas ----------
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  cliente_id text references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  nucleo text check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','administrativo','socios')),
  prazo date,
  prazo_fatal boolean not null default false,
  status text not null default 'aberta' check (status in ('aberta','em_andamento','concluida','cancelada')),
  concluida_em timestamptz,
  prioridade smallint not null default 2 check (prioridade between 1 and 3),   -- 1 alta, 2 normal, 3 baixa
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists tarefas_prazo_idx on public.tarefas (prazo) where status in ('aberta','em_andamento');
create index if not exists tarefas_cliente_idx on public.tarefas (cliente_id);
create index if not exists tarefas_resp_idx on public.tarefas (responsavel_id);

-- concluida_em acompanha o status
create or replace function public.tarefa_concluida() returns trigger language plpgsql as $$
begin
  if new.status = 'concluida' and (old is null or old.status <> 'concluida') then new.concluida_em := coalesce(new.concluida_em, now());
  elsif new.status <> 'concluida' then new.concluida_em := null; end if;
  return new;
end $$;
drop trigger if exists tarefas_concluida on public.tarefas;
create trigger tarefas_concluida before insert or update on public.tarefas for each row execute procedure public.tarefa_concluida();

-- ---------- Apontamentos de horas ----------
create table if not exists public.apontamentos_horas (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  data date not null,
  horas numeric(6,2) not null check (horas > 0 and horas <= 24),
  cliente_id text references public.clientes(id) on delete set null,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  entrada_id uuid references public.entradas_timeline(id) on delete cascade,
  tipo_atividade text,            -- mesmo vocabulário dos tipos da timeline, ou livre
  descricao text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create unique index if not exists apont_entrada_uidx on public.apontamentos_horas (entrada_id) where entrada_id is not null;
create index if not exists apont_colab_data_idx on public.apontamentos_horas (colaborador_id, data);
create index if not exists apont_cliente_idx on public.apontamentos_horas (cliente_id);

-- Horas lançadas na entrada da timeline viram apontamento automaticamente (e acompanham edições)
create or replace function public.apontar_de_entrada() returns trigger language plpgsql security definer set search_path = public as $$
declare colab uuid;
begin
  colab := coalesce(new.responsavel_id, (select id from public.colaboradores where perfil_id = coalesce(new.created_by, auth.uid()) limit 1));
  if coalesce(new.horas,0) > 0 and colab is not null then
    insert into public.apontamentos_horas (colaborador_id, data, horas, cliente_id, entrada_id, tipo_atividade, descricao, created_by)
    values (colab, new.data, new.horas, new.cliente_id, new.id, new.tipo, left(new.descricao, 200), new.created_by)
    on conflict (entrada_id) where entrada_id is not null
    do update set colaborador_id = excluded.colaborador_id, data = excluded.data, horas = excluded.horas, cliente_id = excluded.cliente_id,
                  tipo_atividade = excluded.tipo_atividade, descricao = excluded.descricao;
  else
    delete from public.apontamentos_horas where entrada_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists tl_apontar on public.entradas_timeline;
create trigger tl_apontar after insert or update of horas, responsavel_id, data, cliente_id on public.entradas_timeline
  for each row execute procedure public.apontar_de_entrada();

-- Carimbos e auditoria
do $$ declare t text; begin
  foreach t in array array['tarefas','apontamentos_horas'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.tarefas enable row level security;
alter table public.apontamentos_horas enable row level security;

-- Tarefas: só equipe (o cliente não vê tarefas internas)
drop policy if exists tarefas_sel on public.tarefas;
create policy tarefas_sel on public.tarefas for select to authenticated using (public.sou_equipe());
drop policy if exists tarefas_wr on public.tarefas;
create policy tarefas_wr on public.tarefas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- Apontamentos: equipe lê tudo (relatórios); cada um edita os próprios; admin edita todos
drop policy if exists apont_sel on public.apontamentos_horas;
create policy apont_sel on public.apontamentos_horas for select to authenticated using (public.sou_equipe());
drop policy if exists apont_wr on public.apontamentos_horas;
create policy apont_wr on public.apontamentos_horas for all to authenticated
  using (public.sou_admin() or colaborador_id = public.meu_colaborador())
  with check (public.sou_admin() or colaborador_id = public.meu_colaborador());

-- ---------- Views (lidas pelo painel e, depois, pelo Power BI/Looker) ----------
-- security_invoker: a RLS de quem consulta continua valendo.
create or replace view public.v_tarefas with (security_invoker = true) as
select t.*,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.tarefa_id = t.id), 0) as horas_apontadas
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

create or replace view public.v_apontamentos with (security_invoker = true) as
select a.*,
       co.nome as colaborador_nome, co.nucleo,
       c.nome as cliente_nome,
       t.titulo as tarefa_titulo,
       date_trunc('month', a.data)::date as mes
from public.apontamentos_horas a
join public.colaboradores co on co.id = a.colaborador_id
left join public.clientes c on c.id = a.cliente_id
left join public.tarefas t on t.id = a.tarefa_id;

create or replace view public.v_horas_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, nucleo, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3,4;

create or replace view public.v_horas_cliente_mes with (security_invoker = true) as
select mes, cliente_id, cliente_nome, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3;

create or replace view public.v_horas_tipo_mes with (security_invoker = true) as
select mes, coalesce(tipo_atividade,'outro') as tipo_atividade, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2;

create or replace view public.v_tarefas_pontualidade with (security_invoker = true) as
select responsavel_id, responsavel_nome, nucleo,
       count(*) filter (where status in ('aberta','em_andamento')) as abertas,
       count(*) filter (where faixa = 'atrasada') as atrasadas,
       count(*) filter (where faixa in ('hoje','d7') and prazo_fatal) as fatais_7d,
       count(*) filter (where status = 'concluida') as concluidas,
       count(*) filter (where concluida_no_prazo) as concluidas_no_prazo,
       count(*) filter (where concluida_no_prazo = false) as concluidas_com_atraso
from public.v_tarefas group by 1,2,3;

-- ---------- Tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.tarefas, public.apontamentos_horas;
exception when duplicate_object then null; end $$;

select 'ok 0003' as resultado;


-- ===== 0004_pr3_dashboard_views.sql =====
-- 0004 — PR 3: views do dashboard de gestão (carteira, jurídico, equipe, alertas)
-- Idempotente. Todas as views usam security_invoker: a RLS de quem consulta vale (equipe vê tudo; cliente só o seu).
-- O Power BI / Looker lê estas views direto (conexão Postgres com usuário de leitura — ver README).

-- Parâmetro: dias sem registro na timeline para alertar (regras.dados->>'diasSemRegistro', padrão 15)
create or replace function public.param_int(chave text, padrao int) returns int language sql stable as $$
  select coalesce((select nullif(dados->>chave,'')::int from public.regras where id = 'regras'), padrao)
$$;

-- ---------- Carimbos completos nas tabelas da etapa 1 (created_at / created_by / updated_by) ----------
do $$ declare t text; begin
  foreach t in array array['clientes','contratos','historico','regras','notas_internas'] loop
    execute format('alter table public.%I add column if not exists created_at timestamptz default now(), add column if not exists created_by uuid, add column if not exists updated_by uuid', t);
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
  end loop;
end $$;

-- ---------- Contratos "achatados" ----------
create or replace view public.v_contratos with (security_invoker = true) as
select k.id, k.cliente_id, c.nome as cliente_nome,
       k.banco, k.titular, k.produto, k.garantia, k.situacao,
       coalesce(k.saldo_atual, nullif(k.dados->>'valorOriginal','')::numeric, 0) as saldo_atual,
       nullif(k.dados->>'valorOriginal','')::numeric as valor_original,
       public.data_imm(k.dados->>'dataContrato') as data_contrato,
       extract(year from public.data_imm(k.dados->>'dataContrato'))::int as ano_contrato,
       k.data_inicio_atraso,
       case when k.data_inicio_atraso is null then 0 else greatest(0, current_date - k.data_inicio_atraso) end as dias_atraso,
       public.estagio_de(k.data_inicio_atraso) as estagio,
       coalesce(k.situacao,'') <> 'quitado' as ativo,
       (k.dados->'acordo'->>'fechado')::boolean is true as acordo_fechado,
       k.data_inicio_atraso is not null and current_date - k.data_inicio_atraso >= public.param_int('minDiasAtraso',180) as janela_aberta,
       nullif(k.dados->>'prazoReservaMeses','')::int as prazo_reserva_meses,
       k.created_at, k.updated_at
from public.contratos k
join public.clientes c on c.id = k.cliente_id;

-- ---------- Carteira ----------
create or replace view public.v_carteira_resumo with (security_invoker = true) as
select (select count(*) from public.clientes where ativo) as clientes_ativos,
       (select count(distinct cliente_id) from public.v_contratos where ativo) as clientes_com_contrato_ativo,
       count(*) filter (where ativo) as contratos_ativos,
       coalesce(sum(saldo_atual) filter (where ativo),0) as saldo_sob_gestao,
       coalesce(sum(saldo_atual) filter (where ativo and estagio = 1),0) as saldo_estagio1,
       coalesce(sum(saldo_atual) filter (where ativo and estagio = 2),0) as saldo_estagio2,
       coalesce(sum(saldo_atual) filter (where ativo and estagio = 3),0) as saldo_estagio3,
       count(*) filter (where ativo and estagio = 1) as contratos_estagio1,
       count(*) filter (where ativo and estagio = 2) as contratos_estagio2,
       count(*) filter (where ativo and estagio = 3) as contratos_estagio3,
       coalesce(sum(saldo_atual) filter (where ativo and janela_aberta and not acordo_fechado),0) as saldo_negociavel_hoje,
       count(*) filter (where ativo and janela_aberta and not acordo_fechado) as contratos_negociaveis_hoje,
       count(*) filter (where acordo_fechado) as contratos_com_acordo
from public.v_contratos;

create or replace view public.v_contratos_por_estagio with (security_invoker = true) as
select estagio, count(*) as contratos, coalesce(sum(saldo_atual),0) as saldo, count(distinct cliente_id) as clientes
from public.v_contratos where ativo group by estagio order by estagio;

create or replace view public.v_contratos_por_banco with (security_invoker = true) as
select banco, count(*) as contratos, coalesce(sum(saldo_atual),0) as saldo,
       count(*) filter (where estagio = 3) as em_estagio3, count(distinct cliente_id) as clientes
from public.v_contratos where ativo group by banco order by saldo desc;

create or replace view public.v_contratos_por_produto with (security_invoker = true) as
select produto, count(*) as contratos, coalesce(sum(saldo_atual),0) as saldo
from public.v_contratos where ativo group by produto order by saldo desc;

create or replace view public.v_contratos_por_ano with (security_invoker = true) as
select ano_contrato, count(*) as contratos, coalesce(sum(valor_original),0) as valor_original, coalesce(sum(saldo_atual),0) as saldo_atual
from public.v_contratos group by ano_contrato order by ano_contrato;

create or replace view public.v_carteira_por_cliente with (security_invoker = true) as
select c.id as cliente_id, c.nome as cliente_nome, c.ativo,
       count(k.id) filter (where k.ativo) as contratos_ativos,
       coalesce(sum(k.saldo_atual) filter (where k.ativo),0) as saldo,
       coalesce(sum(k.saldo_atual) filter (where k.ativo and k.estagio = 3),0) as saldo_estagio3,
       coalesce(sum(k.saldo_atual) filter (where k.ativo and k.janela_aberta and not k.acordo_fechado),0) as saldo_negociavel,
       coalesce(nullif(c.dados->>'reservaAcumulada','')::numeric,0) as reserva_acumulada,
       count(k.id) filter (where k.acordo_fechado) as acordos_fechados,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta','em_andamento')) as tarefas_abertas
from public.clientes c
left join public.v_contratos k on k.cliente_id = c.id
group by c.id, c.nome, c.ativo, c.dados;

-- ---------- Acordos ----------
create or replace view public.v_acordos with (security_invoker = true) as
select a.*, c.nome as cliente_nome, k.banco, k.produto,
       date_trunc('month', a.data)::date as mes,
       coalesce(a.saldo_no_acordo,0) - a.valor_pago as economia_obtida,
       coalesce(a.saldo_no_acordo,0) * coalesce(a.desconto_projetado,0) as economia_projetada,
       case when coalesce(a.saldo_no_acordo,0) > 0 then 1 - a.valor_pago / a.saldo_no_acordo end as desconto_real
from public.acordos a
join public.clientes c on c.id = a.cliente_id
left join public.contratos k on k.id = a.contrato_id;

create or replace view public.v_acordos_mes with (security_invoker = true) as
select mes, count(*) as acordos, sum(valor_pago) as valor_pago, sum(coalesce(saldo_no_acordo,0)) as saldo_negociado,
       sum(economia_obtida) as economia_obtida, sum(economia_projetada) as economia_projetada,
       avg(desconto_real) as desconto_medio
from public.v_acordos group by mes order by mes;

-- ---------- Jurídico ----------
create or replace view public.v_processos with (security_invoker = true) as
select p.*, c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (p.proximo_prazo - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia
from public.processos p
join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id;

create or replace view public.v_processos_por_fase with (security_invoker = true) as
select coalesce(fase,'(sem fase)') as fase, count(*) as processos, coalesce(sum(valor_causa),0) as valor_causa
from public.v_processos where status = 'ativo' group by 1 order by processos desc;

create or replace view public.v_processos_por_tipo with (security_invoker = true) as
select coalesce(tipo_acao,'(sem tipo)') as tipo_acao, polo, count(*) as processos
from public.v_processos where status = 'ativo' group by 1,2 order by processos desc;

create or replace view public.v_juridico_resumo with (security_invoker = true) as
select count(*) filter (where status = 'ativo') as processos_ativos,
       count(*) filter (where status = 'encerrado') as processos_encerrados,
       count(*) filter (where status = 'suspenso') as processos_suspensos,
       count(*) filter (where sem_providencia) as sem_providencia,
       count(*) filter (where status = 'ativo' and proximo_prazo between current_date and current_date + 7) as prazos_7d,
       count(*) filter (where status = 'ativo' and prazo_fatal and proximo_prazo between current_date and current_date + 7) as fatais_7d,
       count(*) filter (where status = 'ativo' and proximo_prazo < current_date) as prazos_vencidos,
       coalesce(sum(valor_causa) filter (where status = 'ativo'),0) as valor_causa_ativo
from public.v_processos;

-- Prazos unificados: tarefas abertas com prazo + próximo prazo dos processos ativos
create or replace view public.v_prazos with (security_invoker = true) as
select 'tarefa' as origem, t.id, t.cliente_id, t.cliente_nome, t.titulo as descricao, t.prazo, t.prazo_fatal, t.responsavel_id, t.responsavel_nome, t.nucleo, t.faixa, t.dias_para_prazo, t.processo_id, t.numero_cnj
from public.v_tarefas t where t.status in ('aberta','em_andamento') and t.prazo is not null
union all
select 'processo', p.id, p.cliente_id, p.cliente_nome, coalesce(p.tipo_acao,'Processo')||' · '||coalesce(p.numero_cnj,'s/ nº'), p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.responsavel_nome, null,
       case when p.proximo_prazo < current_date then 'atrasada' when p.proximo_prazo = current_date then 'hoje' when p.proximo_prazo <= current_date + 7 then 'd7' when p.proximo_prazo <= current_date + 15 then 'd15' when p.proximo_prazo <= current_date + 30 then 'd30' else 'depois' end,
       p.dias_para_prazo, p.id, p.numero_cnj
from public.v_processos p where p.status = 'ativo' and p.proximo_prazo is not null;

create or replace view public.v_andamentos_mes with (security_invoker = true) as
select date_trunc('month', a.data)::date as mes, count(*) as andamentos,
       count(*) filter (where a.visivel_cliente) as visiveis_cliente,
       count(*) filter (where a.fonte <> 'manual') as automaticos,
       count(distinct a.processo_id) as processos
from public.andamentos a group by 1 order by 1;

-- ---------- Timeline / atividade ----------
create or replace view public.v_timeline_mes with (security_invoker = true) as
select date_trunc('month', e.data)::date as mes, e.tipo, count(*) as entradas, sum(e.horas) as horas,
       count(*) filter (where e.visivel_cliente) as visiveis_cliente, count(distinct e.cliente_id) as clientes
from public.entradas_timeline e group by 1,2 order by 1,2;

create or replace view public.v_timeline_cliente_mes with (security_invoker = true) as
select date_trunc('month', e.data)::date as mes, e.cliente_id, c.nome as cliente_nome, count(*) as entradas, sum(e.horas) as horas
from public.entradas_timeline e join public.clientes c on c.id = e.cliente_id group by 1,2,3 order by 1,2;

-- ---------- Alertas ----------
create or replace view public.v_clientes_sem_registro with (security_invoker = true) as
select c.id as cliente_id, c.nome as cliente_nome,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       current_date - coalesce((select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id), c.created_at::date) as dias_sem_registro,
       public.param_int('diasSemRegistro',15) as limite_dias,
       (current_date - coalesce((select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id), c.created_at::date)) > public.param_int('diasSemRegistro',15) as alerta
from public.clientes c where c.ativo;

-- ---------- Equipe ----------
create or replace view public.v_equipe_resumo with (security_invoker = true) as
select co.id as colaborador_id, co.nome, co.nucleo, co.ativo,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= date_trunc('month', current_date)),0) as horas_mes_atual,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status = 'concluida' and t.concluida_em >= date_trunc('month', current_date)) as concluidas_mes,
       (select count(*) from public.processos p where p.responsavel_id = co.id and p.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d
from public.colaboradores co;

select 'ok 0004' as resultado;


-- ===== 0005_pr4_visao_cliente_token.sql =====
-- 0005 — PR 4: visão do cliente evoluída + acesso opcional por link com token (opção "a", complementar ao login)
-- Idempotente. Depende de 0002 (clientes.token / acesso_por_token, entradas_timeline, processos, andamentos, acordos) e 0001 (referencias, regras).

-- Função chamada pela página cliente/?t=TOKEN sem login (papel anon). SECURITY DEFINER: entrega só o que o cliente
-- pode ver (visivel_cliente = true), nunca notas internas, base de acordos identificada, nem outros clientes.
create or replace function public.painel_por_token(t text) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare c public.clientes%rowtype;
begin
  if t is null or length(t) < 24 then return null; end if;
  select * into c from public.clientes where token = t and acesso_por_token and ativo;
  if not found then return null; end if;
  return jsonb_build_object(
    'cliente', jsonb_build_object('id', c.id, 'dados', (c.dados - 'notasInternas' - 'timeline')),
    'contratos', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'cliente_id', k.cliente_id, 'dados', (k.dados - 'notas'))), '[]'::jsonb)
                  from public.contratos k where k.cliente_id = c.id),
    'referencias', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.referencias r),
    'regras', (select dados from public.regras where id = 'regras'),
    'entradas_timeline', (select coalesce(jsonb_agg(to_jsonb(e) - 'created_by' - 'updated_by' order by e.data desc), '[]'::jsonb)
                          from public.entradas_timeline e where e.cliente_id = c.id and e.visivel_cliente),
    'processos', (select coalesce(jsonb_agg(to_jsonb(p) - 'observacoes' - 'created_by' - 'updated_by'), '[]'::jsonb)
                  from public.processos p where p.cliente_id = c.id and p.visivel_cliente),
    'andamentos', (select coalesce(jsonb_agg(to_jsonb(a) - 'created_by' - 'updated_by' order by a.data desc), '[]'::jsonb)
                   from public.andamentos a join public.processos p on p.id = a.processo_id
                   where p.cliente_id = c.id and p.visivel_cliente and a.visivel_cliente),
    'acordos', (select coalesce(jsonb_agg(to_jsonb(a) - 'created_by' - 'updated_by'), '[]'::jsonb) from public.acordos a where a.cliente_id = c.id),
    'gerado_em', now()
  );
end $$;
revoke all on function public.painel_por_token(text) from public;
grant execute on function public.painel_por_token(text) to anon, authenticated;

-- Registro de acessos por token (para saber quando o cliente abriu o link)
create table if not exists public.acessos_token (
  id bigint generated always as identity primary key,
  cliente_id text references public.clientes(id) on delete cascade,
  quando timestamptz not null default now(),
  ok boolean not null default true
);
alter table public.acessos_token enable row level security;
drop policy if exists acessos_sel on public.acessos_token;
create policy acessos_sel on public.acessos_token for select to authenticated using (public.sou_equipe());

create or replace function public.registrar_acesso_token(t text) returns void
language sql security definer set search_path = public as $$
  insert into public.acessos_token (cliente_id, ok)
  select id, true from public.clientes where token = t and acesso_por_token limit 1;
$$;
revoke all on function public.registrar_acesso_token(text) from public;
grant execute on function public.registrar_acesso_token(text) to anon, authenticated;

-- Último acesso por token, para a equipe
create or replace view public.v_acessos_token with (security_invoker = true) as
select c.id as cliente_id, c.nome as cliente_nome, c.acesso_por_token,
       (select max(quando) from public.acessos_token a where a.cliente_id = c.id) as ultimo_acesso,
       (select count(*) from public.acessos_token a where a.cliente_id = c.id and a.quando >= now() - interval '30 days') as acessos_30d
from public.clientes c;

select 'ok 0005' as resultado;


-- ===== 0006_pr5_colaboradores.sql =====
-- 0006 — PR 5: colaboradores (RH básico) — cadastro completo e vínculo com o usuário do Supabase Auth
-- Idempotente. A tabela colaboradores nasceu em 0002; aqui entram campos de contato e a view de cadastro.

alter table public.colaboradores
  add column if not exists email text,
  add column if not exists telefone text,
  add column if not exists oab text,
  add column if not exists data_desligamento date;

-- Colaborador pode ver e editar os próprios dados de contato (nome/e-mail/telefone); o resto é admin
drop policy if exists colab_self on public.colaboradores;
create policy colab_self on public.colaboradores for update to authenticated
  using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

-- Cadastro + situação do login + indicadores recentes (para a tela Equipe)
create or replace view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       co.created_at, co.updated_at
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

-- Perfis da equipe ainda sem registro de colaborador (para vincular na tela Equipe)
create or replace view public.v_perfis_sem_colaborador with (security_invoker = true) as
select p.id, p.email, p.nome, p.papel
from public.perfis p
where p.papel in ('admin','colaborador') and not exists (select 1 from public.colaboradores c where c.perfil_id = p.id);

select 'ok 0006' as resultado;


-- ===== 0008_pr6_ficha_cliente.sql =====
-- 0008 — PR 6: ficha do cliente (cadastro completo), contatos/sócios, documentos (links do Drive), bens declarados
-- Idempotente. Os campos do motor continuam em clientes.dados (jsonb); a ficha vive em colunas normais.

-- ---------- Ficha ----------
alter table public.clientes
  add column if not exists cnpj text,
  add column if not exists cpf_titular text,
  add column if not exists tipo_pessoa text default 'PJ' check (tipo_pessoa in ('PJ','PF')),
  add column if not exists nome_fantasia text,
  add column if not exists cidade text,
  add column if not exists uf text,
  add column if not exists segmento text,
  add column if not exists faturamento_mensal numeric,
  add column if not exists funcionarios integer,
  add column if not exists historia text,              -- o que aconteceu com a empresa
  add column if not exists situacao_atual text,        -- opera? fatura? maquininha? negativado?
  add column if not exists origem text,                -- Meta Ads, indicação, orgânico, Google…
  add column if not exists closer text,
  add column if not exists data_fechamento date,
  add column if not exists data_onboarding date,
  add column if not exists plano text,                 -- gestão de passivos PJ, superendividamento, revisional…
  add column if not exists status text default 'ativo' check (status in ('prospect','onboarding','ativo','encerrado')),
  add column if not exists negativado boolean,
  add column if not exists usa_maquininha boolean,
  add column if not exists tem_consorcio boolean,
  add column if not exists outros_cnpjs text,
  add column if not exists assuntos_interesse text,
  add column if not exists disponibilidade text,
  add column if not exists observacoes_onboarding text,
  add column if not exists proxima_reuniao date;

-- cnpj: se ainda vazio, copia do jsonb (carga antiga guardava em dados.cnpj)
update public.clientes set cnpj = nullif(dados->>'cnpj','') where cnpj is null and nullif(dados->>'cnpj','') is not null;

-- ---------- Contatos: papel e CPF ----------
alter table public.contatos
  add column if not exists papel text default 'socio' check (papel in ('socio','titular','avalista','contador','financeiro','conjuge','outro')),
  add column if not exists cpf text,
  add column if not exists participacao numeric,
  add column if not exists observacoes text;

-- ---------- Documentos do cliente (links, não cópias) ----------
create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  titulo text not null,
  tipo text check (tipo in ('contrato_bancario','contrato_honorarios','parecer','onboarding','transcricao','extrato','cartao_cnpj','contrato_social','procuracao','peticao','decisao','acordo','outro')),
  url text,                       -- link do Drive / Notion / tribunal
  caminho_storage text,           -- ou arquivo no bucket anexos
  data date,
  visivel_cliente boolean not null default false,
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists documentos_cliente_idx on public.documentos(cliente_id);

-- ---------- Bens declarados (patrimônio informado no onboarding) ----------
create table if not exists public.bens (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  tipo text not null check (tipo in ('veiculo','imovel','maquinario','rebanho','safra','consorcio','outro')),
  descricao text not null,
  titular text check (titular in ('PJ','PF','terceiro')),
  onus text,                      -- financiado, alienado, hipotecado, penhorado, bem de família, livre
  valor_estimado numeric,
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists bens_cliente_idx on public.bens(cliente_id);

-- Carimbos e auditoria
do $$ declare t text; begin
  foreach t in array array['documentos','bens'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.documentos enable row level security;
alter table public.bens enable row level security;
drop policy if exists docs_sel on public.documentos;
create policy docs_sel on public.documentos for select to authenticated using (public.sou_equipe() or (cliente_id = public.meu_cliente() and visivel_cliente));
drop policy if exists docs_wr on public.documentos;
create policy docs_wr on public.documentos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists bens_sel on public.bens;
create policy bens_sel on public.bens for select to authenticated using (public.sou_equipe());
drop policy if exists bens_wr on public.bens;
create policy bens_wr on public.bens for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- ---------- View da ficha (lista de clientes + indicadores) ----------
create or replace view public.v_clientes_ficha with (security_invoker = true) as
select c.id, c.nome, c.nome_fantasia, c.cnpj, c.cpf_titular, c.tipo_pessoa, c.cidade, c.uf, c.segmento, c.faturamento_mensal, c.funcionarios,
       c.historia, c.situacao_atual, c.origem, c.closer, c.data_fechamento, c.data_onboarding, c.plano, c.status, c.ativo,
       c.negativado, c.usa_maquininha, c.tem_consorcio, c.outros_cnpjs, c.assuntos_interesse, c.disponibilidade, c.observacoes_onboarding, c.proxima_reuniao,
       c.dados->>'responsavel' as responsavel,
       coalesce(nullif(c.dados->>'reservaAcumulada','')::numeric,0) as reserva_acumulada,
       (select count(*) from public.v_contratos k where k.cliente_id = c.id and k.ativo) as contratos_ativos,
       (select coalesce(sum(k.saldo_atual),0) from public.v_contratos k where k.cliente_id = c.id and k.ativo) as saldo,
       (select coalesce(sum(k.saldo_atual),0) from public.v_contratos k where k.cliente_id = c.id and k.ativo and k.estagio = 3) as saldo_estagio3,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select min(prazo) from public.v_prazos z where z.cliente_id = c.id and z.prazo >= current_date) as proximo_prazo,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       (select count(*) from public.contatos ct where ct.cliente_id = c.id) as contatos,
       (select string_agg(ct.nome, ', ' order by ct.principal desc, ct.nome) from public.contatos ct where ct.cliente_id = c.id and ct.papel in ('socio','titular')) as socios,
       c.created_at, c.updated_at
from public.clientes c;

-- Cliente vê a própria ficha resumida (sem campos internos): função usada pela área do cliente
create or replace view public.v_minha_ficha with (security_invoker = true) as
select c.id, c.nome, c.nome_fantasia, c.cnpj, c.cidade, c.uf, c.segmento, c.plano, c.status, c.data_onboarding, c.proxima_reuniao,
       c.dados->>'responsavel' as responsavel
from public.clientes c where c.id = public.meu_cliente();

-- ---------- Área do cliente por token: ficha resumida e documentos publicados ----------
create or replace function public.painel_por_token(t text) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare c public.clientes%rowtype;
begin
  if t is null or length(t) < 24 then return null; end if;
  select * into c from public.clientes where token = t and acesso_por_token and ativo;
  if not found then return null; end if;
  return jsonb_build_object(
    'cliente', jsonb_build_object('id', c.id, 'dados', (c.dados - 'notasInternas' - 'timeline')),
    'ficha', jsonb_build_object('nome_fantasia', c.nome_fantasia, 'cnpj', c.cnpj, 'tipo_pessoa', c.tipo_pessoa, 'cidade', c.cidade, 'uf', c.uf, 'segmento', c.segmento,
                                'plano', c.plano, 'status', c.status, 'data_onboarding', c.data_onboarding, 'proxima_reuniao', c.proxima_reuniao),
    'contratos', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'cliente_id', k.cliente_id, 'dados', (k.dados - 'notas'))), '[]'::jsonb)
                  from public.contratos k where k.cliente_id = c.id),
    'referencias', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.referencias r),
    'regras', (select dados from public.regras where id = 'regras'),
    'entradas_timeline', (select coalesce(jsonb_agg(to_jsonb(e) - 'created_by' - 'updated_by' order by e.data desc), '[]'::jsonb)
                          from public.entradas_timeline e where e.cliente_id = c.id and e.visivel_cliente),
    'processos', (select coalesce(jsonb_agg(to_jsonb(p) - 'observacoes' - 'created_by' - 'updated_by'), '[]'::jsonb)
                  from public.processos p where p.cliente_id = c.id and p.visivel_cliente),
    'andamentos', (select coalesce(jsonb_agg(to_jsonb(a) - 'created_by' - 'updated_by' order by a.data desc), '[]'::jsonb)
                   from public.andamentos a join public.processos p on p.id = a.processo_id
                   where p.cliente_id = c.id and p.visivel_cliente and a.visivel_cliente),
    'acordos', (select coalesce(jsonb_agg(to_jsonb(a) - 'created_by' - 'updated_by'), '[]'::jsonb) from public.acordos a where a.cliente_id = c.id),
    'documentos', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'cliente_id', d.cliente_id, 'titulo', d.titulo, 'tipo', d.tipo, 'url', d.url, 'data', d.data, 'contrato_id', d.contrato_id, 'visivel_cliente', true)), '[]'::jsonb)
                   from public.documentos d where d.cliente_id = c.id and d.visivel_cliente),
    'gerado_em', now()
  );
end $$;

select 'ok 0008' as resultado;


-- ===== 0010_pr7a_fluxo_pj_negociacoes.sql =====
-- 0010 — PR 7a: fluxo do cliente PJ (etapas do Notion), negociações (kanban de acordos), monitoramento processual
-- e automação de cliente novo. Idempotente. Depende de 0008 (ficha) e 0003 (tarefas).
--
-- Espelha a operação que hoje vive no Notion ("GESTÃO DE PASSIVOS PJ"):
--   • Cadastro Central → colunas novas em clientes (etapa_fluxo, flags, régua, projeto de reserva, serviço)
--   • Acordos e negociações (kanban da Natasha) → tabela negociacoes
--   • Monitoramento PJ (checagem no Escavador) → tabela monitoramentos
--   • Automação "cliente novo" → trigger fluxo_novo_cliente(): tarefas de onboarding + linha de monitoramento
--     (+ negociação "Iniciar acompanhamento" quando tem_divida_atraso = true)

-- ---------- Clientes: fluxo PJ ----------
alter table public.clientes
  add column if not exists etapa_fluxo smallint check (etapa_fluxo between 0 and 10),  -- 0 contrato fechado … 10 ciclo mensal
  add column if not exists tem_divida_atraso boolean,
  add column if not exists adimplente boolean,                                           -- honorários em dia?
  add column if not exists possui_processos boolean,
  add column if not exists projeto_reserva text check (projeto_reserva in ('nao_iniciado','apresentado','em_construcao','formada')),
  add column if not exists regua text check (regua in ('bronze','prata','ouro')),        -- régua de relacionamento
  add column if not exists servico text check (servico in ('gestao_passivos','consultoria','outro')),
  add column if not exists tipos_dividas text,                                           -- texto livre: "3 créditos rurais Sicredi CPF…"
  add column if not exists responsavel_onboarding_id uuid references public.colaboradores(id) on delete set null,
  add column if not exists notion_url text;

-- status ganha 'pausado' (⏸ Pausado / Em risco do Notion)
alter table public.clientes drop constraint if exists clientes_status_check;
alter table public.clientes add constraint clientes_status_check check (status in ('prospect','onboarding','ativo','pausado','encerrado'));

-- ---------- Negociações (kanban de acordos) ----------
create table if not exists public.negociacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  acordo_id uuid references public.acordos(id) on delete set null,     -- preenchido quando o acordo é registrado no contrato
  titulo text not null,                                                 -- "CL Comércio | Santander | Capital de giro"
  banco text,
  etapa text not null default 'iniciar' check (etapa in ('iniciar','extrajudicial','pos_judicializacao','minuta','formalizado','pagamento_pendente','concluido')),
  aguardando text,                                                      -- "comprovante de quitação", "pagamento honorários"…
  temperatura text check (temperatura in ('frio','morno','quente')),
  situacao_processual text,                                             -- sem processo / banco ajuizou ação / cliente ajuizou…
  numero_processo text,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  adverso_contato text,                                                 -- escritório adverso / gerente e telefone
  valor_cobrado numeric, valor_acordo numeric, alcada_autorizada numeric,
  data_acordo date, prazo date,
  proximo_passo text,
  percentual_exito numeric, status_exito text,
  observacoes text,
  ordem integer not null default 0,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists negociacoes_cliente_idx on public.negociacoes(cliente_id);
create index if not exists negociacoes_etapa_idx on public.negociacoes(etapa) where etapa <> 'concluido';

-- ---------- Monitoramento processual (uma linha por cliente) ----------
create table if not exists public.monitoramentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null unique references public.clientes(id) on delete cascade,
  status text not null default 'em_monitoramento' check (status in ('em_monitoramento','nova_movimentacao','pausado')),
  documentos text[] not null default '{}',                               -- CPFs/CNPJs monitorados (empresa, sócios, avalistas)
  tem_processo boolean, foi_citado boolean, tem_garantia boolean,
  avalistas text check (avalistas in ('nao','socio','terceiro')),
  ultima_checagem date, proxima_checagem date,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);

-- Carimbos e auditoria
do $$ declare t text; begin
  foreach t in array array['negociacoes','monitoramentos'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- RLS: só equipe (o cliente nunca vê negociação nem monitoramento) ----------
alter table public.negociacoes enable row level security;
alter table public.monitoramentos enable row level security;
drop policy if exists neg_all on public.negociacoes;
create policy neg_all on public.negociacoes for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists mon_all on public.monitoramentos;
create policy mon_all on public.monitoramentos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- ---------- Automação: cliente novo ----------
-- Ao criar um cliente: tarefas de onboarding (acompanhamento PJ), linha de monitoramento (jurídico) e,
-- se tem_divida_atraso, negociação "Iniciar acompanhamento" (acordos). Também dispara quando tem_divida_atraso passa a true.
create or replace function public.fluxo_novo_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare novo boolean := (tg_op = 'INSERT');
        virou_divida boolean := (tg_op = 'UPDATE' and coalesce(new.tem_divida_atraso,false) and not coalesce(old.tem_divida_atraso,false));
        resp_onb uuid; resp_jur uuid; resp_aco uuid;
begin
  if not (novo or virou_divida) then return new; end if;
  -- responsáveis padrão: primeiro colaborador ativo de cada núcleo (ajuste depois na tarefa)
  select id into resp_onb from public.colaboradores where ativo and nucleo = 'acompanhamento_pj' order by data_admissao nulls last limit 1;
  select id into resp_jur from public.colaboradores where ativo and nucleo = 'juridico' order by data_admissao nulls last limit 1;
  select id into resp_aco from public.colaboradores where ativo and nucleo = 'acordos' order by data_admissao nulls last limit 1;

  if novo then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Onboarding: cadastro no ADVBOX e envio do formulário de mapeamento (D0)', 'Etapas 1–2 do fluxo PJ. Avance a etapa na ficha do cliente conforme concluir.', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 2, 1),
           ('Onboarding: auditoria do formulário e agendamento da R1', 'Etapas 4–5 do fluxo PJ.', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 7, 2),
           ('Monitoramento: cadastrar CNPJ/CPFs no Escavador e iniciar checagem', 'Preencha a aba Monitoramento do cliente (documentos monitorados, próxima checagem).', new.id, resp_jur, 'juridico', current_date + 3, 2);
    insert into public.monitoramentos (cliente_id, status, responsavel_id, proxima_checagem)
    values (new.id, 'em_monitoramento', resp_jur, current_date + 3) on conflict (cliente_id) do nothing;
  end if;

  if (novo and coalesce(new.tem_divida_atraso,false)) or virou_divida then
    if not exists (select 1 from public.negociacoes where cliente_id = new.id) then
      insert into public.negociacoes (cliente_id, titulo, etapa, responsavel_id, proximo_passo)
      values (new.id, 'Acompanhamento — '||coalesce(new.nome_fantasia, new.dados->>'nome', new.id), 'iniciar', resp_aco, 'Levantar bancos, valores e situação de cada dívida em atraso');
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Acordos: iniciar acompanhamento das dívidas em atraso', 'Cliente marcado com dívida em atraso. Abra uma negociação por banco/contrato.', new.id, resp_aco, 'acordos', current_date + 5, 2);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists clientes_fluxo_novo on public.clientes;
create trigger clientes_fluxo_novo after insert or update of tem_divida_atraso on public.clientes for each row execute procedure public.fluxo_novo_cliente();

-- Acordo registrado no contrato → negociação do mesmo contrato vai para "concluído" e aponta para o acordo
create or replace function public.negociacao_concluir_por_acordo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.negociacoes set etapa = 'concluido', acordo_id = new.id, valor_acordo = coalesce(valor_acordo, new.valor_pago), data_acordo = coalesce(data_acordo, new.data)
  where contrato_id = new.contrato_id and etapa <> 'concluido';
  return new;
end $$;
drop trigger if exists acordos_concluir_negociacao on public.acordos;
create trigger acordos_concluir_negociacao after insert on public.acordos for each row execute procedure public.negociacao_concluir_por_acordo();

-- ---------- Views ----------
create or replace view public.v_negociacoes with (security_invoker = true) as
select n.*, c.dados->>'nome' as cliente_nome, co.nome as responsavel_nome,
       case n.etapa when 'iniciar' then 1 when 'extrajudicial' then 2 when 'pos_judicializacao' then 3 when 'minuta' then 4 when 'formalizado' then 5 when 'pagamento_pendente' then 6 else 7 end as etapa_ordem,
       (n.prazo is not null and n.prazo < current_date and n.etapa <> 'concluido') as atrasada,
       (current_date - n.updated_at::date) as dias_parada
from public.negociacoes n join public.clientes c on c.id = n.cliente_id left join public.colaboradores co on co.id = n.responsavel_id;

create or replace view public.v_negociacoes_por_etapa with (security_invoker = true) as
select etapa, count(*) as negociacoes, coalesce(sum(valor_cobrado),0) as valor_cobrado, coalesce(sum(valor_acordo),0) as valor_acordo
from public.negociacoes group by etapa;

create or replace view public.v_monitoramentos with (security_invoker = true) as
select m.*, c.dados->>'nome' as cliente_nome, c.cnpj, co.nome as responsavel_nome,
       (select count(*) from public.processos p where p.cliente_id = m.cliente_id and p.status = 'ativo') as processos_ativos,
       (m.proxima_checagem is not null and m.proxima_checagem <= current_date) as checagem_vencida
from public.monitoramentos m join public.clientes c on c.id = m.cliente_id left join public.colaboradores co on co.id = m.responsavel_id;

create or replace view public.v_fluxo_pj with (security_invoker = true) as
select c.id, c.dados->>'nome' as nome, c.etapa_fluxo, c.status, c.tem_divida_atraso, c.adimplente, c.possui_processos, c.projeto_reserva, c.regua, c.servico, c.proxima_reuniao, c.data_onboarding,
       co.nome as responsavel_onboarding,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       case c.regua when 'bronze' then 3 when 'prata' then 20 when 'ouro' then 45 end as dias_regua,
       (c.regua is not null and coalesce((select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id), c.created_at::date) < current_date - case c.regua when 'bronze' then 3 when 'prata' then 20 else 45 end) as alerta_relacionamento
from public.clientes c left join public.colaboradores co on co.id = c.responsavel_onboarding_id where c.ativo;

-- v_clientes_ficha ganha as colunas novas (colunas no meio → precisa recriar)
drop view if exists public.v_clientes_ficha;
create view public.v_clientes_ficha with (security_invoker = true) as
select c.id, c.nome, c.nome_fantasia, c.cnpj, c.cpf_titular, c.tipo_pessoa, c.cidade, c.uf, c.segmento, c.faturamento_mensal, c.funcionarios,
       c.historia, c.situacao_atual, c.origem, c.closer, c.data_fechamento, c.data_onboarding, c.plano, c.status, c.ativo,
       c.negativado, c.usa_maquininha, c.tem_consorcio, c.outros_cnpjs, c.assuntos_interesse, c.disponibilidade, c.observacoes_onboarding, c.proxima_reuniao,
       c.etapa_fluxo, c.tem_divida_atraso, c.adimplente, c.possui_processos, c.projeto_reserva, c.regua, c.servico, c.tipos_dividas, c.responsavel_onboarding_id, c.notion_url,
       c.dados->>'responsavel' as responsavel,
       coalesce(nullif(c.dados->>'reservaAcumulada','')::numeric,0) as reserva_acumulada,
       (select count(*) from public.v_contratos k where k.cliente_id = c.id and k.ativo) as contratos_ativos,
       (select coalesce(sum(k.saldo_atual),0) from public.v_contratos k where k.cliente_id = c.id and k.ativo) as saldo,
       (select coalesce(sum(k.saldo_atual),0) from public.v_contratos k where k.cliente_id = c.id and k.ativo and k.estagio = 3) as saldo_estagio3,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select min(prazo) from public.v_prazos z where z.cliente_id = c.id and z.prazo >= current_date) as proximo_prazo,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       (select count(*) from public.contatos ct where ct.cliente_id = c.id) as contatos,
       (select string_agg(ct.nome, ', ' order by ct.principal desc, ct.nome) from public.contatos ct where ct.cliente_id = c.id and ct.papel in ('socio','titular')) as socios,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       c.created_at, c.updated_at
from public.clientes c;

-- Prazos de negociação entram na agenda geral
create or replace view public.v_prazos with (security_invoker = true) as
select 'tarefa' as origem, t.id, t.cliente_id, t.cliente_nome, t.titulo as descricao, t.prazo, t.prazo_fatal, t.responsavel_id, t.responsavel_nome, t.nucleo, t.faixa, t.dias_para_prazo, t.processo_id, t.numero_cnj
from public.v_tarefas t where t.status in ('aberta','em_andamento') and t.prazo is not null
union all
select 'processo', p.id, p.cliente_id, p.cliente_nome, coalesce(p.tipo_acao,'Processo')||' · '||coalesce(p.numero_cnj,'s/ nº'), p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.responsavel_nome, null,
       case when p.proximo_prazo < current_date then 'atrasada' when p.proximo_prazo = current_date then 'hoje' when p.proximo_prazo <= current_date + 7 then 'd7' when p.proximo_prazo <= current_date + 15 then 'd15' when p.proximo_prazo <= current_date + 30 then 'd30' else 'depois' end,
       p.dias_para_prazo, p.id, p.numero_cnj
from public.v_processos p where p.status = 'ativo' and p.proximo_prazo is not null
union all
select 'negociacao', n.id, n.cliente_id, n.cliente_nome, 'Negociação · '||n.titulo, n.prazo, false, n.responsavel_id, n.responsavel_nome, 'acordos',
       case when n.prazo < current_date then 'atrasada' when n.prazo = current_date then 'hoje' when n.prazo <= current_date + 7 then 'd7' when n.prazo <= current_date + 15 then 'd15' when n.prazo <= current_date + 30 then 'd30' else 'depois' end,
       (n.prazo - current_date), n.processo_id, n.numero_processo
from public.v_negociacoes n where n.etapa <> 'concluido' and n.prazo is not null;

-- ---------- Tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.negociacoes, public.monitoramentos;
exception when others then null; end $$;

select 'ok 0010' as resultado;


-- ===== 0012_acessos_sistemas.sql =====
-- 0012 — Acessos a sistemas do cliente (gov.br, bancos, certificados) informados pelo próprio cliente para o trabalho do escritório.
-- Tabela separada da ficha de propósito: nunca entra em views, no painel_por_token, na área do cliente nem no BI.
-- Só equipe lê/escreve; toda alteração fica na auditoria. Próximo passo (depois): criptografar `senha` com Vault/pgsodium.

create table if not exists public.acessos_sistemas (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  sistema text not null default 'gov.br',       -- gov.br, e-CAC, internet banking X, certificado digital…
  titular text,                                 -- de quem é o acesso (empresa, sócio…)
  login text,
  senha text,
  observacoes text,                             -- 2FA? telefone que recebe o código? validade do certificado?
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists acessos_sistemas_cliente_idx on public.acessos_sistemas(cliente_id);

drop trigger if exists acessos_sistemas_carimbo on public.acessos_sistemas;
create trigger acessos_sistemas_carimbo before insert or update on public.acessos_sistemas for each row execute procedure public.carimbar2();
drop trigger if exists acessos_sistemas_audit on public.acessos_sistemas;
create trigger acessos_sistemas_audit after insert or update or delete on public.acessos_sistemas for each row execute procedure public.auditar();

alter table public.acessos_sistemas enable row level security;
drop policy if exists acessos_all on public.acessos_sistemas;
create policy acessos_all on public.acessos_sistemas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.acessos_sistemas from anon;

-- Se existir o usuário de leitura do BI, ele não enxerga esta tabela
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bi') then execute 'revoke all on public.acessos_sistemas from bi'; end if;
end $$;

select 'ok 0012' as resultado;


-- ===== 0014_pr7b_publicacoes_djen.sql =====
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


-- ===== 0015_pr8_base_conhecimento.sql =====
-- 0015 — PR 8: base de conhecimento (Jurídico) — artigos em Markdown por tema, com busca, versões e autor.
-- Idempotente. Depende de 0006 (colaboradores). Conteúdo inicial: carga 0016 (fora do repo) com páginas do Notion e teses.

create table if not exists public.conteudos (
  id uuid primary key default gen_random_uuid(),
  slug text unique,                                -- estável para links (#conhecimento/<slug>)
  area text not null default 'juridico' check (area in ('juridico','comercial','marketing','financeiro','administrativo','geral')),
  tema text not null,                              -- "Teses de defesa", "Operação jurídica", "Crédito rural"…
  titulo text not null,
  resumo text,
  corpo_md text not null default '',
  tags text[] not null default '{}',
  ordem integer not null default 0,
  publicado boolean not null default true,
  autor_id uuid references public.colaboradores(id) on delete set null,
  versao integer not null default 1,
  origem text not null default 'manual',           -- manual | notion | skill
  id_externo text,
  busca tsvector,                                  -- mantido pelo gatilho conteudo_versionar
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists conteudos_busca_idx on public.conteudos using gin (busca);
create index if not exists conteudos_tema_idx on public.conteudos(area, tema, ordem);
create unique index if not exists conteudos_id_externo_uidx on public.conteudos(id_externo) where id_externo is not null;

create table if not exists public.conteudos_versoes (
  id bigserial primary key,
  conteudo_id uuid not null references public.conteudos(id) on delete cascade,
  versao integer not null,
  titulo text, resumo text, corpo_md text, tags text[],
  autor_id uuid references public.colaboradores(id) on delete set null,
  editado_por uuid,
  created_at timestamptz default now()
);
create index if not exists conteudos_versoes_idx on public.conteudos_versoes(conteudo_id, versao desc);

-- slug automático
create or replace function public.slugify(t text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '-', 'g'))
$$;

-- versão anterior guardada a cada edição do corpo/título; versao incrementa
create or replace function public.conteudo_versionar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.busca := setweight(to_tsvector('portuguese', coalesce(new.titulo,'')), 'A')
            || setweight(to_tsvector('portuguese', coalesce(new.resumo,'')||' '||array_to_string(new.tags,' ')), 'B')
            || setweight(to_tsvector('portuguese', coalesce(new.corpo_md,'')), 'C');
  if tg_op = 'INSERT' then
    if new.slug is null or new.slug = '' then new.slug := left(public.slugify(new.titulo), 80)||'-'||left(replace(new.id::text,'-',''), 6); end if;
    return new;
  end if;
  if new.corpo_md is distinct from old.corpo_md or new.titulo is distinct from old.titulo or new.resumo is distinct from old.resumo or new.tags is distinct from old.tags then
    insert into public.conteudos_versoes (conteudo_id, versao, titulo, resumo, corpo_md, tags, autor_id, editado_por)
    values (old.id, old.versao, old.titulo, old.resumo, old.corpo_md, old.tags, old.autor_id, old.updated_by);
    new.versao := old.versao + 1;
    new.autor_id := coalesce((select id from public.colaboradores where perfil_id = auth.uid() limit 1), new.autor_id);
  end if;
  return new;
end $$;
drop trigger if exists conteudos_versionar on public.conteudos;
create trigger conteudos_versionar before insert or update on public.conteudos for each row execute procedure public.conteudo_versionar();
drop trigger if exists conteudos_carimbo on public.conteudos;
create trigger conteudos_carimbo before insert or update on public.conteudos for each row execute procedure public.carimbar2();
drop trigger if exists conteudos_audit on public.conteudos;
create trigger conteudos_audit after insert or update or delete on public.conteudos for each row execute procedure public.auditar();

-- RLS: equipe lê e edita; só admin exclui (decisão provisória — ajustar quando a Maria Júlia definir quem edita)
alter table public.conteudos enable row level security;
alter table public.conteudos_versoes enable row level security;
drop policy if exists cont_sel on public.conteudos;
create policy cont_sel on public.conteudos for select to authenticated using (public.sou_equipe());
drop policy if exists cont_ins on public.conteudos;
create policy cont_ins on public.conteudos for insert to authenticated with check (public.sou_equipe());
drop policy if exists cont_upd on public.conteudos;
create policy cont_upd on public.conteudos for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists cont_del on public.conteudos;
create policy cont_del on public.conteudos for delete to authenticated using (public.sou_admin());
drop policy if exists contv_sel on public.conteudos_versoes;
create policy contv_sel on public.conteudos_versoes for select to authenticated using (public.sou_equipe());
revoke all on public.conteudos from anon; revoke all on public.conteudos_versoes from anon;

-- Lista (sem corpo) e busca
create or replace view public.v_conteudos with (security_invoker = true) as
select c.id, c.slug, c.area, c.tema, c.titulo, c.resumo, c.tags, c.ordem, c.publicado, c.versao, c.origem, c.autor_id, co.nome as autor_nome, c.updated_at, length(c.corpo_md) as tamanho
from public.conteudos c left join public.colaboradores co on co.id = c.autor_id;

create or replace function public.conhecimento_buscar(q text, lim integer default 30)
returns table (id uuid, slug text, tema text, titulo text, trecho text, rank real)
language sql stable security definer set search_path = public as $$
  select c.id, c.slug, c.tema, c.titulo,
         ts_headline('portuguese', left(c.corpo_md, 20000), websearch_to_tsquery('portuguese', q), 'MaxWords=28, MinWords=14, StartSel=<mark>, StopSel=</mark>') as trecho,
         ts_rank(c.busca, websearch_to_tsquery('portuguese', q)) as rank
  from public.conteudos c
  where public.sou_equipe() and c.publicado and c.busca @@ websearch_to_tsquery('portuguese', q)
  order by rank desc limit greatest(1, least(lim, 100))
$$;
grant execute on function public.conhecimento_buscar(text, integer) to authenticated;

do $$ begin alter publication supabase_realtime add table public.conteudos; exception when others then null; end $$;

select 'ok 0015' as resultado;


-- ===== 0017_pr8b_documentos_base.sql =====
-- 0017 — PR 8b: documentos base (índice do Google Drive) dentro da base de conhecimento.
-- Os arquivos continuam no Drive (não são copiados): aqui fica um índice pesquisável com título, pasta, tipo, link,
-- descrição e tags editáveis pela equipe. Carga inicial 0018 (fora do repo); re-sincronização por nova carga.
-- Idempotente. Depende de 0015.

create table if not exists public.documentos_base (
  id uuid primary key default gen_random_uuid(),
  area text not null default 'juridico' check (area in ('juridico','comercial','marketing','financeiro','administrativo','geral')),
  origem text not null default 'drive',               -- drive | link (adicionado à mão)
  drive_id text,                                      -- id do arquivo/pasta no Drive (único)
  pasta_drive_id text,                                -- id da pasta-mãe no Drive
  caminho text not null default '',                   -- "MODELOS DE PEÇAS / EMBARGOS" (relativo à pasta JURÍDICO)
  titulo text not null,
  tipo text not null default '',                      -- docx, pdf, xlsx, odt, folder…
  mime text,
  url text not null,
  tamanho bigint,
  modificado_em date,
  descricao text,                                     -- editável pela equipe (o que é, quando usar)
  tags text[] not null default '{}',
  destaque boolean not null default false,            -- modelos de uso frequente
  ativo boolean not null default true,                -- false = sumiu do Drive na última sincronização
  busca tsvector,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
drop index if exists public.documentos_base_drive_uidx;
create unique index if not exists documentos_base_drive_uidx on public.documentos_base(drive_id); -- único (nulos permitidos); sem WHERE para o upsert da tela funcionar
create index if not exists documentos_base_caminho_idx on public.documentos_base(area, caminho, titulo);
create index if not exists documentos_base_busca_idx on public.documentos_base using gin (busca);

create or replace function public.documento_base_indexar() returns trigger language plpgsql as $$
begin
  new.busca := setweight(to_tsvector('portuguese', coalesce(new.titulo,'')), 'A')
            || setweight(to_tsvector('portuguese', coalesce(new.descricao,'')||' '||array_to_string(new.tags,' ')), 'B')
            || setweight(to_tsvector('portuguese', coalesce(new.caminho,'')), 'C');
  return new;
end $$;
drop trigger if exists documentos_base_indexar on public.documentos_base;
create trigger documentos_base_indexar before insert or update on public.documentos_base for each row execute procedure public.documento_base_indexar();
drop trigger if exists documentos_base_carimbo on public.documentos_base;
create trigger documentos_base_carimbo before insert or update on public.documentos_base for each row execute procedure public.carimbar2();
drop trigger if exists documentos_base_audit on public.documentos_base;
create trigger documentos_base_audit after insert or update or delete on public.documentos_base for each row execute procedure public.auditar();

-- RLS: equipe lê, inclui links e edita descrição/tags; só admin exclui. Cliente nunca vê.
alter table public.documentos_base enable row level security;
drop policy if exists docb_sel on public.documentos_base;
create policy docb_sel on public.documentos_base for select to authenticated using (public.sou_equipe());
drop policy if exists docb_ins on public.documentos_base;
create policy docb_ins on public.documentos_base for insert to authenticated with check (public.sou_equipe());
drop policy if exists docb_upd on public.documentos_base;
create policy docb_upd on public.documentos_base for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists docb_del on public.documentos_base;
create policy docb_del on public.documentos_base for delete to authenticated using (public.sou_admin());
revoke all on public.documentos_base from anon;
do $$ begin if exists (select 1 from pg_roles where rolname = 'bi') then revoke all on public.documentos_base from bi; end if; end $$;

-- Busca unificada (artigos + documentos) para a caixa de busca da base de conhecimento
create or replace function public.documentos_base_buscar(q text, lim integer default 30)
returns table (id uuid, titulo text, caminho text, tipo text, url text, trecho text, rank real)
language sql stable security definer set search_path = public as $$
  select d.id, d.titulo, d.caminho, d.tipo, d.url,
         ts_headline('portuguese', coalesce(d.descricao,'')||' '||array_to_string(d.tags,' '), websearch_to_tsquery('portuguese', q), 'MaxWords=20, MinWords=8, StartSel=<mark>, StopSel=</mark>') as trecho,
         ts_rank(d.busca, websearch_to_tsquery('portuguese', q)) as rank
  from public.documentos_base d
  where public.sou_equipe() and d.ativo and d.tipo <> 'folder' and d.busca @@ websearch_to_tsquery('portuguese', q)
  order by rank desc, d.titulo limit greatest(1, least(lim, 100))
$$;
grant execute on function public.documentos_base_buscar(text, integer) to authenticated;

do $$ begin alter publication supabase_realtime add table public.documentos_base; exception when others then null; end $$;

select 'ok 0017' as resultado;


select 'ok parte 1/9' as resultado;
