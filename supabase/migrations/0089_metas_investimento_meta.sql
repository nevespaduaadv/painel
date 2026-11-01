-- 0089 — Metas do mês: investimento Meta Ads por semana vem da coleta do Growth (growth_meta_conta_dia), sem digitação.
-- Recalculado junto com a planilha do financeiro (0088) e todo dia às 7h10 (BRT), depois da coleta do Growth (6h40). Idempotente.

create or replace function public.comercial_investimento_recalcular(p_mes date) returns integer
language plpgsql security definer set search_path = public as $$
declare s record; n integer := 0; v numeric;
begin
  if not exists (select 1 from public.growth_meta_conta_dia where data >= p_mes and data < p_mes + interval '1 month') then return 0; end if;
  perform public.comercial_semanas_garantir(p_mes);
  for s in select * from public.comercial_semanas where mes = p_mes loop
    select coalesce(sum(spend), 0) into v from public.growth_meta_conta_dia where data between s.inicio and s.fim;
    update public.comercial_semanas set investimento = v, updated_at = now() where id = s.id and investimento is distinct from v;
    n := n + 1;
  end loop;
  return n;
end $$;

-- o recálculo do mês (planilha) também atualiza o investimento
create or replace function public.comercial_recalcular_mes(p_mes date) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; s record; c integer; v numeric;
begin
  perform public.comercial_semanas_garantir(p_mes);
  for s in select * from public.comercial_semanas where mes = p_mes loop
    select count(*), coalesce(sum(valor),0) into c, v from public.fechamentos_planilha f
     where f.mes = p_mes and f.gestao_passivos and f.data_fechamento between s.inicio and s.fim;
    update public.comercial_semanas set contratos = c, valor = v, lancado = lancado or c > 0, updated_at = now() where id = s.id;
    n := n + 1;
  end loop;
  perform public.comercial_investimento_recalcular(p_mes);
  return n;
end $$;

-- diário: mês atual e anterior (a coleta do Growth pode trazer dias passados)
create or replace function public.comercial_investimento_diario() returns integer
language sql security definer set search_path = public as $$
  select public.comercial_investimento_recalcular(date_trunc('month', current_date)::date)
       + public.comercial_investimento_recalcular((date_trunc('month', current_date) - interval '1 month')::date);
$$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'comercial-investimento-np';
    perform cron.schedule('comercial-investimento-np', '10 10 * * *', $c$ select public.comercial_investimento_diario(); $c$);  -- 7h10 BRT
  end if;
exception when others then raise notice 'cron não agendado: %', sqlerrm; end $$;

-- aplica já
select public.comercial_investimento_diario() as semanas_atualizadas, 'ok 0089' as resultado;
