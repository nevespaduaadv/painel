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
