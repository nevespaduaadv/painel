-- 0041 — Calculadora de planos de pagamento (superendividamento, Lei 14.181/2021 — art. 104-A CDC).
-- Cálculo no painel (superendividamento.js); aqui só a persistência. Idempotente.

create table if not exists public.planos_superendividamento (
  id uuid primary key default gen_random_uuid(),
  cliente_id text references public.clientes(id) on delete set null,   -- opcional: devedor pode estar fora da base
  titulo text not null,
  devedor jsonb not null default '{}'::jsonb,       -- {nome, cpf, rg, nacionalidade, estado_civil, profissao, endereco, cidade, uf, cep, email}
  entradas jsonb not null default '{}'::jsonb,      -- {renda, limitePct, minimoPiso, dividas:[{credor,cnpj,descricao,tipo,saldo,parcela,consignado}], prazo, carenciaDias, juros, dataCalculo, comarca}
  resultado jsonb,                                  -- saída do motor (planoCinco, planoCabe, rateio, tabela…)
  status text not null default 'rascunho' check (status in ('rascunho','concluido')),
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists planos_se_cliente_idx on public.planos_superendividamento (cliente_id);
alter table public.planos_superendividamento enable row level security;
drop policy if exists "planos_se: equipe" on public.planos_superendividamento;
create policy "planos_se: equipe" on public.planos_superendividamento for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop trigger if exists planos_se_carimbo on public.planos_superendividamento;
create trigger planos_se_carimbo before insert or update on public.planos_superendividamento for each row execute procedure public.carimbar2();

create or replace view public.v_planos_superendividamento with (security_invoker = true) as
select p.id, p.titulo, p.cliente_id, c.nome as cliente_nome, p.devedor->>'nome' as devedor_nome, p.status,
       (p.entradas->>'renda')::numeric as renda,
       (select coalesce(sum((d->>'saldo')::numeric),0) from jsonb_array_elements(coalesce(p.entradas->'dividas','[]'::jsonb)) d) as saldo_total,
       jsonb_array_length(coalesce(p.entradas->'dividas','[]'::jsonb)) as qtd_dividas,
       p.resultado->'cinco'->>'parcela' as parcela_cinco, p.resultado->'cabe'->>'meses' as meses_cabe,
       p.created_at, p.updated_at, public.nome_perfil(p.created_by) as criado_por_nome
from public.planos_superendividamento p
left join public.clientes c on c.id = p.cliente_id;

select 'ok 0041' as resultado;
