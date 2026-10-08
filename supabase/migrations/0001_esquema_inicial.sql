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
