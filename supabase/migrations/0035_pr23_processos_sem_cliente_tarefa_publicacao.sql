-- 0035 — PR 23: processo sem cliente (fora da base) + tarefa aberta a partir de uma publicação
-- Idempotente. Depende de 0002 (processos), 0004 (v_processos), 0014 (publicacoes), 0034 (v_tarefas).

-- ---------- processos: cliente opcional ----------
alter table public.processos alter column cliente_id drop not null;

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
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id;

-- ---------- tarefas: origem em publicação ----------
alter table public.tarefas add column if not exists publicacao_id bigint references public.publicacoes(id) on delete set null;
create index if not exists tarefas_publicacao_idx on public.tarefas (publicacao_id);

create or replace view public.v_tarefas with (security_invoker = true) as
select t.id, t.titulo, t.descricao, t.cliente_id, t.contrato_id, t.processo_id, t.responsavel_id, t.nucleo, t.prazo, t.prazo_fatal, t.status, t.concluida_em, t.prioridade, t.created_at, t.created_by, t.updated_at, t.updated_by,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(h.horas) from public.apontamentos_horas h where h.tarefa_id = t.id), 0) as horas_apontadas,
       t.concluida_por,
       public.nome_perfil(t.created_by) as criado_por_nome,
       public.nome_perfil(t.concluida_por) as concluida_por_nome,
       t.publicacao_id
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

-- ---------- v_publicacoes: tarefas atribuídas a partir da publicação ----------
create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id) as tarefas_atribuidas,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as tarefas_atribuidas_abertas,
       (select string_agg(coalesce(cc.nome,'?') || coalesce(' · ' || to_char(x.prazo,'DD/MM'), ''), ', ' order by x.prazo) from public.tarefas x left join public.colaboradores cc on cc.id = x.responsavel_id where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as atribuidas_para
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.tarefas t on t.id = p.tarefa_id;

select 'ok 0035' as resultado;
