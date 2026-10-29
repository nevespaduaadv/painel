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

select 'ok beta 0013' as resultado, (select count(*) from public.apontamentos_horas where frente is not null) as com_frente, (select count(*) from public.apontamentos_horas) as total;
