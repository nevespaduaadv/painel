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

-- colaborador ligado ao usuário logado (null se não houver)
create or replace function public.meu_colaborador() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.colaboradores where perfil_id = auth.uid() limit 1
$$;

-- auditoria: ids uuid nas tabelas novas → texto
create or replace function public.auditar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria(usuario,tabela,registro,acao,antes,depois)
  values (auth.uid(), tg_table_name, coalesce(new.id::text, old.id::text), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
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
  add column if not exists data_inicio_atraso date generated always as (nullif(dados->>'dataInicioAtraso','')::date) stored,
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
