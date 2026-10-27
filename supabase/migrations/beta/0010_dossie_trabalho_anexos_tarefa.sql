-- ESPELHO (beta) — Dossiê = só o que o escritório faz (registros, tarefas: abertura, passagem, comentários, conclusão, negociações).
-- Andamentos e publicações saem do dossiê e ficam na página do processo. Comentários/conclusões de tarefa aceitam anexos.
-- Idempotente. Depende de beta 0008.

-- anexos em eventos de tarefa (comentário, conclusão)
alter table public.anexos alter column entrada_id drop not null;
alter table public.anexos add column if not exists tarefa_evento_id bigint references public.tarefa_eventos (id) on delete cascade;
alter table public.anexos add column if not exists tarefa_id uuid references public.tarefas (id) on delete cascade;
alter table public.anexos drop constraint if exists anexos_dono_chk;
alter table public.anexos add constraint anexos_dono_chk check (entrada_id is not null or tarefa_evento_id is not null);
create index if not exists anexos_tarefa_idx on public.anexos (tarefa_id);
-- RLS: equipe lê/escreve anexos de tarefa (os de timeline já têm política própria)
drop policy if exists anexos_tarefa_eq on public.anexos;
create policy anexos_tarefa_eq on public.anexos for all to authenticated using (public.sou_equipe() and tarefa_evento_id is not null) with check (public.sou_equipe() and tarefa_evento_id is not null);

create or replace view public.v_tarefa_anexos with (security_invoker = true) as
select a.id, a.tarefa_id, a.tarefa_evento_id, a.nome, a.caminho_storage, a.tamanho, a.mime, a.created_at from public.anexos a where a.tarefa_evento_id is not null;
grant select on public.v_tarefa_anexos to authenticated;

-- dossiê: trabalho do escritório
drop view if exists public.v_cliente_frentes;
drop view if exists public.v_dossie;
create view public.v_dossie with (security_invoker = true) as
select 'registro' as origem, e.id::text as ref_id, e.cliente_id, e.data::timestamptz + coalesce(e.created_at::time, '12:00'::time) as quando, e.frente, e.tipo, e.descricao as texto,
       coalesce(co.nome, public.nome_perfil(e.created_by)) as autor, e.processo_id, p.numero_cnj, pa.codigo as pasta_codigo, e.contrato_id, e.tarefa_id, e.negociacao_id, e.visivel_cliente, e.fixado, e.horas,
       (select count(*) from public.anexos x where x.entrada_id = e.id) as anexos
  from public.entradas_timeline e left join public.colaboradores co on co.id = e.responsavel_id left join public.processos p on p.id = e.processo_id left join public.pastas pa on pa.numero = p.pasta_numero
 where e.andamento_id is null and e.tarefa_id is null
union all
-- eventos de tarefa: abriu (para quem), passou (de → para + recado), comentou (+anexos), concluiu (o que foi feito)
select 'tarefa', ev.id::text, t.cliente_id, ev.criado_em, coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end),
       'tarefa_' || ev.tipo,
       case ev.tipo
         when 'criada' then 'Abriu a tarefa “' || t.titulo || '”' || coalesce(' para ' || ev.para, '')
         when 'reatribuida' then 'Passou “' || t.titulo || '” de ' || coalesce(ev.de, '—') || ' para ' || coalesce(ev.para, '—') || coalesce(E'\n' || ev.nota, '')
         when 'comentario' then '“' || t.titulo || '”' || E'\n' || coalesce(ev.nota, '')
         when 'concluida' then 'Concluiu “' || t.titulo || '”' || coalesce(E'\n' || ev.nota, '')
         when 'reaberta' then 'Reabriu “' || t.titulo || '”'
         when 'cancelada' then 'Cancelou “' || t.titulo || '”' || coalesce(E'\n' || ev.nota, '')
         else ev.tipo || ' · ' || t.titulo end,
       ev.autor_nome, t.processo_id, p.numero_cnj, pa.codigo, t.contrato_id, t.id, null, false, false, null,
       (select count(*) from public.anexos x where x.tarefa_evento_id = ev.id)
  from public.tarefa_eventos ev join public.tarefas t on t.id = ev.tarefa_id left join public.processos p on p.id = t.processo_id left join public.pastas pa on pa.numero = p.pasta_numero
 where t.cliente_id is not null and ev.tipo in ('criada', 'reatribuida', 'comentario', 'concluida', 'reaberta', 'cancelada')
union all
select 'negociacao', n.id::text, n.cliente_id, n.updated_at, 'negocial', 'negociacao_' || n.etapa,
       coalesce(n.titulo, n.banco, 'Negociação') || ' · etapa: ' || n.etapa || coalesce(' · ' || n.proximo_passo, ''),
       co.nome, n.processo_id, n.numero_processo, pa.codigo, n.contrato_id, null, n.id, false, false, null, 0
  from public.negociacoes n left join public.colaboradores co on co.id = n.responsavel_id left join public.processos p on p.id = n.processo_id left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_dossie to authenticated;

create view public.v_cliente_frentes with (security_invoker = true) as
select c.id as cliente_id, f.frente,
       case f.frente when 'estrategico' then c.resp_estrategico_id when 'juridico' then c.resp_juridico_id else c.resp_negocial_id end as responsavel_id,
       (select max(d.quando) from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente) as ultimo_em,
       (select d.texto from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente order by d.quando desc limit 1) as ultimo_texto,
       (select d.autor from public.v_dossie d where d.cliente_id = c.id and d.frente = f.frente order by d.quando desc limit 1) as ultimo_autor,
       (select min(t.prazo) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta', 'em_andamento') and coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end) = f.frente) as proximo_prazo,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta', 'em_andamento') and coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end) = f.frente) as tarefas_abertas,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos
  from public.clientes c cross join (values ('estrategico'), ('juridico'), ('negocial')) as f(frente)
 where c.ativo is distinct from false;
grant select on public.v_cliente_frentes to authenticated;

select 'ok beta 0010' as resultado, (select count(*) from public.v_dossie) as itens_dossie;
