-- ESPELHO (beta) — Prazo único (o prazo do processo vem das tarefas) e sugestão de cliente nas publicações sem vínculo.
-- Idempotente. Depende de beta 0002–0006.

-- ---------- 1. prazo do processo = tarefa aberta com prazo mais próximo (o campo manual fica só como reserva) ----------
create or replace function public.processo_proximo_prazo(p public.processos) returns date language sql stable as $$
  select coalesce((select min(t.prazo) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null), p.proximo_prazo)
$$;
create or replace function public.processo_prazo_fatal(p public.processos) returns boolean language sql stable as $$
  select coalesce((select bool_or(t.prazo_fatal) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null
                    and t.prazo = (select min(x.prazo) from public.tarefas x where x.processo_id = p.id and x.status in ('aberta','em_andamento') and x.prazo is not null)), p.prazo_fatal, false)
$$;

create or replace view public.v_processos with (security_invoker = true) as
select p.id, p.cliente_id, p.contrato_id, p.numero_cnj, p.tribunal, p.vara, p.tipo_acao, p.parte_contraria, p.banco, p.polo, p.fase, p.valor_causa,
       public.processo_proximo_prazo(p) as proximo_prazo, public.processo_prazo_fatal(p) as prazo_fatal,
       p.responsavel_id, p.status, p.visivel_cliente, p.fonte, p.id_externo, p.observacoes, p.created_at, p.created_by, p.updated_at, p.updated_by,
       c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (public.processo_proximo_prazo(p) - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia,
       p.pasta_numero, p.area, p.comarca, p.uf, p.rito, p.assunto, p.data_distribuicao, p.sub_status, p.encerrado_em, p.tipo_encerramento,
       p.relevante, p.sigiloso, p.grau_risco, p.risco_cliente, p.advogado_contrario,
       pa.titulo as pasta_titulo, pa.status as pasta_status,
       public.processo_campos_faltando(p) as campos_faltando,
       (select count(*) from public.processo_relacoes r where r.processo_id = p.id or r.relacionado_id = p.id) as qtd_relacionados,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id) as qtd_publicacoes,
       pa.codigo as pasta_codigo,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id and pb.providencia is null) as publicacoes_pendentes,
       (select t.id from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null order by t.prazo limit 1) as proxima_tarefa_id,
       (select t.titulo from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo is not null order by t.prazo limit 1) as proxima_tarefa_titulo
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id
left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_processos to authenticated;

-- processos com "próximo prazo" manual e sem tarefa correspondente: vira uma tarefa (prazo), para o conceito ficar único
insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, prioridade, status)
select 'Prazo — ' || coalesce(p.numero_cnj, p.tipo_acao, 'processo'), 'Migrado do campo "próximo prazo" do processo (prazo único).', p.cliente_id, p.id, p.responsavel_id, 'juridico', p.proximo_prazo, coalesce(p.prazo_fatal, false), case when p.prazo_fatal then 1 else 2 end, 'aberta'
  from public.processos p
 where p.proximo_prazo is not null and p.proximo_prazo >= current_date - 30 and p.status = 'ativo'
   and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento') and t.prazo = p.proximo_prazo);

-- ---------- 2. publicações sem vínculo: sugerir cliente pelo nome das partes ----------
alter table public.publicacoes add column if not exists cliente_sugerido_id text references public.clientes (id) on delete set null;
create or replace function public.publicacao_sugerir_cliente(p_id bigint) returns text language plpgsql security definer set search_path = public as $$
declare pub public.publicacoes; achado text; nm text;
begin
  select * into pub from public.publicacoes where id = p_id;
  if pub.processo_id is not null then return null; end if;
  -- 1) número do processo bate com um processo da base → vincula direto
  if pub.numero_processo is not null then
    select pr.id::text into achado from public.processos pr where pr.numero_cnj = pub.numero_processo limit 1;
    if achado is not null then update public.publicacoes set processo_id = achado::uuid where id = p_id; return null; end if;
  end if;
  -- 2) nome de uma das partes contém o nome (ou fantasia) do cliente
  for nm in select d->>'nome' from jsonb_array_elements(coalesce(pub.destinatarios, '[]'::jsonb)) d where coalesce(d->>'nome', '') <> '' loop
    select c.id into achado from public.clientes c
     where c.ativo is distinct from false
       and (length(coalesce(c.nome, '')) >= 6 and unaccent(lower(nm)) like '%' || unaccent(lower(c.nome)) || '%'
            or length(coalesce(c.nome_fantasia, '')) >= 6 and unaccent(lower(nm)) like '%' || unaccent(lower(c.nome_fantasia)) || '%'
            or c.cnpj is not null and regexp_replace(nm, '\D', '', 'g') <> '' and regexp_replace(nm, '\D', '', 'g') = regexp_replace(c.cnpj, '\D', '', 'g'))
     limit 1;
    if achado is not null then update public.publicacoes set cliente_sugerido_id = achado where id = p_id; return achado; end if;
  end loop;
  return null;
end $$;
create extension if not exists unaccent;
create or replace function public.publicacoes_sugerir_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.publicacao_sugerir_cliente(new.id); return new; end $$;
drop trigger if exists publicacoes_sugerir on public.publicacoes;
create trigger publicacoes_sugerir after insert on public.publicacoes for each row execute function public.publicacoes_sugerir_tg();
-- backfill das pendentes sem vínculo
do $$ declare r record; begin for r in select id from public.publicacoes where processo_id is null and providencia is null loop perform public.publicacao_sugerir_cliente(r.id); end loop; end $$;

create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id) as tarefas_atribuidas,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as tarefas_atribuidas_abertas,
       (select string_agg(coalesce(cc.nome,'?') || coalesce(' · ' || to_char(x.prazo,'DD/MM'), ''), ', ' order by x.prazo) from public.tarefas x left join public.colaboradores cc on cc.id = x.responsavel_id where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as atribuidas_para,
       p.providencia, p.tratada_em, public.nome_perfil(p.tratada_por) as tratada_por_nome, p.encaminhada_para, ce.nome as encaminhada_para_nome, p.observacao_tratamento,
       p.prazo_tratamento,
       case when p.providencia is null then null else (p.tratada_em at time zone 'America/Sao_Paulo')::date <= p.prazo_tratamento end as tempestiva,
       case when p.providencia is null then p.prazo_tratamento - current_date end as dias_para_tratar,
       pr.pasta_numero, pa.codigo as pasta_codigo,
       p.cliente_sugerido_id, cs.nome as cliente_sugerido_nome
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.pastas pa on pa.numero = pr.pasta_numero
left join public.clientes c on c.id = p.cliente_id
left join public.clientes cs on cs.id = p.cliente_sugerido_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.colaboradores ce on ce.id = p.encaminhada_para
left join public.tarefas t on t.id = p.tarefa_id;
grant select on public.v_publicacoes to authenticated;

select 'ok beta 0007' as resultado, (select count(*) from public.publicacoes where cliente_sugerido_id is not null) as publicacoes_com_sugestao, (select count(*) from public.tarefas where descricao like 'Migrado do campo%') as prazos_migrados;
