-- 0025 — PR 13: Comercial — metas mensais (meta / super / hiper) e lançamento semanal do realizado.
-- Origem: desenho de metas de outubro/2026 (taxas-base jul–set: lead→agendamento 35%, agendamento→proposta 70%,
-- proposta→contrato 20/25/27%, ticket GP R$ 28/30/32k, CPL R$ 70). Só contratos de Gestão de Passivos contam.
-- Regras: equipe lê tudo; equipe lança semanas; só admin define/edita metas. Idempotente.

-- ---------- metas por mês e nível ----------
create table if not exists public.metas_comerciais (
  id uuid primary key default gen_random_uuid(),
  mes date not null,                                  -- sempre dia 1 do mês
  nivel text not null check (nivel in ('meta','super','hiper')),
  contratos int not null default 0,
  ticket numeric(12,2) not null default 0,            -- ticket médio GP
  propostas int not null default 0,                   -- = agendamentos qualificados (critério atual)
  agendamentos int not null default 0,
  leads int not null default 0,
  investimento numeric(12,2) not null default 0,      -- Meta Ads previsto
  taxa_prop_contrato numeric(5,2),                    -- %, informativo
  cpl numeric(10,2),                                  -- custo por lead planejado
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid,
  unique (mes, nivel),
  check (mes = date_trunc('month', mes)::date)
);
drop trigger if exists metas_comerciais_carimbo on public.metas_comerciais;
create trigger metas_comerciais_carimbo before insert or update on public.metas_comerciais for each row execute procedure public.carimbar2();
drop trigger if exists metas_comerciais_audit on public.metas_comerciais;
create trigger metas_comerciais_audit after insert or update or delete on public.metas_comerciais for each row execute procedure public.auditar();
alter table public.metas_comerciais enable row level security;
drop policy if exists mc_sel on public.metas_comerciais;
create policy mc_sel on public.metas_comerciais for select to authenticated using (public.sou_equipe());
drop policy if exists mc_admin on public.metas_comerciais;
create policy mc_admin on public.metas_comerciais for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.metas_comerciais from anon;

-- ---------- realizado por semana ----------
create table if not exists public.comercial_semanas (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  semana smallint not null check (semana between 1 and 6),
  inicio date not null, fim date not null,
  dias_uteis smallint not null default 5 check (dias_uteis between 0 and 7),
  leads int not null default 0,                       -- formulários Meta
  agendamentos int not null default 0,                -- marcados pela SDR
  propostas int not null default 0,                   -- qualificados = proposta enviada
  contratos int not null default 0,                   -- só Gestão de Passivos
  valor numeric(12,2) not null default 0,             -- valor contratado GP
  investimento numeric(12,2) not null default 0,      -- gasto Meta na semana
  lancado boolean not null default false,             -- semana efetivamente preenchida
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid,
  unique (mes, semana),
  check (fim >= inicio)
);
create index if not exists comercial_semanas_mes_idx on public.comercial_semanas(mes, semana);
drop trigger if exists comercial_semanas_carimbo on public.comercial_semanas;
create trigger comercial_semanas_carimbo before insert or update on public.comercial_semanas for each row execute procedure public.carimbar2();
drop trigger if exists comercial_semanas_audit on public.comercial_semanas;
create trigger comercial_semanas_audit after insert or update or delete on public.comercial_semanas for each row execute procedure public.auditar();
alter table public.comercial_semanas enable row level security;
drop policy if exists cs_equipe on public.comercial_semanas;
create policy cs_equipe on public.comercial_semanas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists cs_del_admin on public.comercial_semanas;
revoke all on public.comercial_semanas from anon;

-- ---------- resumo do mês ----------
drop view if exists public.v_comercial_mes;
create view public.v_comercial_mes with (security_invoker = true) as
select s.mes,
       count(*) filter (where s.lancado) as semanas_lancadas, count(*) as semanas,
       sum(s.dias_uteis) as dias_uteis_total, sum(s.dias_uteis) filter (where s.lancado) as dias_uteis_lancados,
       sum(s.leads) as leads, sum(s.agendamentos) as agendamentos, sum(s.propostas) as propostas,
       sum(s.contratos) as contratos, sum(s.valor) as valor, sum(s.investimento) as investimento
from public.comercial_semanas s group by s.mes;
revoke all on public.v_comercial_mes from anon;

-- ---------- semente: outubro/2026 (semanas em dias corridos; dias_uteis só para o ritmo da SDR) ----------
insert into public.metas_comerciais (mes, nivel, contratos, ticket, propostas, agendamentos, leads, investimento, taxa_prop_contrato, cpl, observacoes) values
 ('2026-10-01','meta', 6, 28000, 30, 43, 123,  8600, 20, 70, 'Ligeiramente acima de julho (melhor mês: R$ 162k).'),
 ('2026-10-01','super',8, 30000, 32, 46, 131,  9200, 25, 70, null),
 ('2026-10-01','hiper',10,32000, 37, 53, 151, 10600, 27, 70, 'Dobro de julho. Encosta no limite de ~3 reuniões/dia da closer.')
on conflict (mes, nivel) do nothing;

insert into public.comercial_semanas (mes, semana, inicio, fim, dias_uteis) values
 ('2026-10-01',1,'2026-10-01','2026-10-04',2),
 ('2026-10-01',2,'2026-10-05','2026-10-11',5),
 ('2026-10-01',3,'2026-10-12','2026-10-18',4),   -- 12/10 feriado
 ('2026-10-01',4,'2026-10-19','2026-10-25',5),
 ('2026-10-01',5,'2026-10-26','2026-10-31',5)
on conflict (mes, semana) do nothing;

do $$ begin alter publication supabase_realtime add table public.comercial_semanas; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.metas_comerciais; exception when others then null; end $$;

select 'ok 0025' as resultado;
