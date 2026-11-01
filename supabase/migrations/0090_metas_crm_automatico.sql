-- 0090 — Metas do mês: leads, agendamentos e propostas por semana recalculados do CRM todo dia (mesma regra do botão
-- "Preencher pelo CRM": leads por data de entrada, agendamentos = passou pela fase 4, propostas = passou pela fase 7),
-- junto com contratos/valor (planilha) e investimento (Meta). A semana 5 de outubro estava zerada porque o botão não
-- tinha sido clicado depois do fim do mês. Idempotente.

create or replace function public.comercial_crm_recalcular(p_mes date) returns integer
language plpgsql security definer set search_path = public as $$
declare s record; n integer := 0; nl integer; na integer; np integer;
begin
  perform public.comercial_semanas_garantir(p_mes);
  for s in select * from public.comercial_semanas where mes = p_mes loop
    -- leads da meta = quem preencheu o formulário do Meta e caiu na planilha (origem 'planilha'); ChatGuru/site não contam
    select count(*) into nl from public.leads l
     where l.origem = 'planilha' and (l.data_entrada at time zone 'America/Sao_Paulo')::date between s.inicio and s.fim;
    select count(distinct h.lead_id) into na from public.historico_fases h
     where h.para_fase_id = 4 and (h.created_at at time zone 'America/Sao_Paulo')::date between s.inicio and s.fim;
    select count(distinct h.lead_id) into np from public.historico_fases h
     where h.para_fase_id = 7 and (h.created_at at time zone 'America/Sao_Paulo')::date between s.inicio and s.fim;
    update public.comercial_semanas set leads = nl, agendamentos = na, propostas = np, lancado = lancado or nl > 0, updated_at = now()
     where id = s.id and (leads is distinct from nl or agendamentos is distinct from na or propostas is distinct from np);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.comercial_recalcular_tudo() returns integer
language sql security definer set search_path = public as $$
  select public.comercial_crm_recalcular(date_trunc('month', current_date)::date)
       + public.comercial_crm_recalcular((date_trunc('month', current_date) - interval '1 month')::date)
       + public.comercial_recalcular_mes(date_trunc('month', current_date)::date)
       + public.comercial_recalcular_mes((date_trunc('month', current_date) - interval '1 month')::date);
$$;
grant execute on function public.comercial_recalcular_tudo() to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('comercial-investimento-np','comercial-recalculo-np');
    perform cron.schedule('comercial-recalculo-np', '10 10 * * *', $c$ select public.comercial_recalcular_tudo(); $c$);  -- 7h10 BRT
  end if;
exception when others then raise notice 'cron não agendado: %', sqlerrm; end $$;

select public.comercial_recalcular_tudo() as semanas, 'ok 0090' as resultado;
