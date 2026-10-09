-- 0026 — PR 13b: semanas comerciais em dias corridos (leads e investimento chegam no fim de semana).
-- inicio/fim cobrem o mês inteiro, sem buracos; dias_uteis continua valendo só para o ritmo da SDR. Idempotente.
alter table public.comercial_semanas add column if not exists dias smallint generated always as ((fim - inicio) + 1) stored;

update public.comercial_semanas set fim = '2026-10-04' where mes = '2026-10-01' and semana = 1 and fim = '2026-10-02';
update public.comercial_semanas set fim = '2026-10-11' where mes = '2026-10-01' and semana = 2 and fim = '2026-10-09';
update public.comercial_semanas set fim = '2026-10-18' where mes = '2026-10-01' and semana = 3 and fim = '2026-10-16';
update public.comercial_semanas set fim = '2026-10-25' where mes = '2026-10-01' and semana = 4 and fim = '2026-10-23';
update public.comercial_semanas set fim = '2026-10-31' where mes = '2026-10-01' and semana = 5 and fim = '2026-10-30';

drop view if exists public.v_comercial_mes;
create view public.v_comercial_mes with (security_invoker = true) as
select s.mes,
       count(*) filter (where s.lancado) as semanas_lancadas, count(*) as semanas,
       sum(s.dias) as dias_total, sum(s.dias) filter (where s.lancado) as dias_lancados,
       sum(s.dias_uteis) as dias_uteis_total, sum(s.dias_uteis) filter (where s.lancado) as dias_uteis_lancados,
       sum(s.leads) as leads, sum(s.agendamentos) as agendamentos, sum(s.propostas) as propostas,
       sum(s.contratos) as contratos, sum(s.valor) as valor, sum(s.investimento) as investimento
from public.comercial_semanas s group by s.mes;
revoke all on public.v_comercial_mes from anon;
select 'ok 0026' as resultado;
