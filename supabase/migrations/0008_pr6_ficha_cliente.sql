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
