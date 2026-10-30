-- ESPELHO (beta) — Dossiê do cliente e as três frentes (Estratégico/Consultivo · Jurídico/Contencioso · Negocial/Acordos).
-- Um único "Registrar" (entradas_timeline) com frente, tipo e fixado; responsável por frente = frente do colaborador (padrão),
-- com exceção por cliente; view v_dossie que junta registros, andamentos, tarefas feitas, publicações tratadas, negociações e cobranças.
-- Idempotente. Depende de beta 0002–0007.

-- ---------- frentes ----------
alter table public.colaboradores add column if not exists frente text check (frente in ('estrategico', 'juridico', 'negocial'));
alter table public.clientes
  add column if not exists resp_estrategico_id uuid references public.colaboradores (id) on delete set null,
  add column if not exists resp_juridico_id uuid references public.colaboradores (id) on delete set null,
  add column if not exists resp_negocial_id uuid references public.colaboradores (id) on delete set null;

-- ---------- registro único ----------
alter table public.entradas_timeline
  add column if not exists frente text check (frente in ('estrategico', 'juridico', 'negocial')),
  add column if not exists fixado boolean not null default false,
  add column if not exists negociacao_id uuid references public.negociacoes (id) on delete set null;
create index if not exists tl_cliente_frente_idx on public.entradas_timeline (cliente_id, frente, data desc);
create index if not exists tl_fixado_idx on public.entradas_timeline (cliente_id) where fixado;

-- tipos novos: informação do cliente, decisão, motivo de não fazer, registro de trabalho, contato com cliente
alter table public.entradas_timeline drop constraint if exists entradas_timeline_tipo_check;
alter table public.entradas_timeline add constraint entradas_timeline_tipo_check check (tipo in ('solicitacao_documentos','requerimento_bacen','analise_contrato','parecer_tecnico','contato_banco',
  'proposta_acordo','reuniao_cliente','ata','protocolo','mudanca_estagio','acordo_fechado','andamento','tarefa','outro',
  'registro','informacao_cliente','decisao','nao_feito','contato_cliente'));
-- frente padrão: do núcleo da tarefa / do colaborador que registra
create or replace function public.frente_do_nucleo(n text) returns text language sql immutable as $$
  select case n when 'juridico' then 'juridico' when 'acordos' then 'negocial' when 'acompanhamento_pj' then 'estrategico' when 'pos_vendas' then 'estrategico' else null end
$$;
create or replace function public.tl_frente_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.frente is null then
    new.frente := coalesce((select public.frente_do_nucleo(t.nucleo) from public.tarefas t where t.id = new.tarefa_id),
                           case when new.negociacao_id is not null then 'negocial' when new.processo_id is not null then 'juridico' end,
                           (select co.frente from public.colaboradores co where co.id = coalesce(new.responsavel_id, public.meu_colaborador())));
  end if;
  return new;
end $$;
drop trigger if exists tl_frente on public.entradas_timeline;
create trigger tl_frente before insert on public.entradas_timeline for each row execute function public.tl_frente_tg();

-- aviso ao responsável da frente (exceção do cliente, senão ninguém — a frente inteira vê no dossiê)
create or replace function public.tl_avisar_frente_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare dest uuid; perfil uuid; nome text;
begin
  if new.frente is null or new.automatica then return new; end if;
  select case new.frente when 'estrategico' then c.resp_estrategico_id when 'juridico' then c.resp_juridico_id else c.resp_negocial_id end, c.nome into dest, nome from public.clientes c where c.id = new.cliente_id;
  if dest is null or dest = coalesce(new.responsavel_id, public.meu_colaborador()) then return new; end if;
  select perfil_id into perfil from public.colaboradores where id = dest;
  if perfil is not null then perform public.notificar(perfil, 'Registro na sua frente · ' || coalesce(nome, ''), left(new.descricao, 140), '#clientes/' || new.cliente_id); end if;
  return new;
end $$;
drop trigger if exists tl_avisar_frente on public.entradas_timeline;
create trigger tl_avisar_frente after insert on public.entradas_timeline for each row execute function public.tl_avisar_frente_tg();

-- ---------- dossiê: tudo do cliente em uma linha do tempo ----------
create or replace view public.v_dossie with (security_invoker = true) as
select 'registro' as origem, e.id::text as ref_id, e.cliente_id, e.data::timestamptz + coalesce(e.created_at::time, '12:00'::time) as quando, e.frente, e.tipo, e.descricao as texto,
       coalesce(co.nome, public.nome_perfil(e.created_by)) as autor, e.processo_id, p.numero_cnj, e.contrato_id, e.tarefa_id, e.negociacao_id, e.visivel_cliente, e.fixado, e.horas
  from public.entradas_timeline e left join public.colaboradores co on co.id = e.responsavel_id left join public.processos p on p.id = e.processo_id
 where e.andamento_id is null and e.tarefa_id is null
union all
select 'andamento', a.id::text, p.cliente_id, a.data::timestamptz + '12:00'::time, 'juridico', coalesce(a.tipo, 'andamento'), a.descricao, public.nome_perfil(a.created_by), a.processo_id, p.numero_cnj, p.contrato_id, null, null, a.visivel_cliente, false, null
  from public.andamentos a join public.processos p on p.id = a.processo_id where p.cliente_id is not null
union all
select 'tarefa', t.id::text, t.cliente_id, t.concluida_em, coalesce(public.frente_do_nucleo(t.nucleo), case when t.processo_id is not null then 'juridico' end), 'tarefa_feita',
       t.titulo || coalesce(E'\n' || (select ev.nota from public.tarefa_eventos ev where ev.tarefa_id = t.id and ev.tipo = 'comentario' and ev.criado_em >= t.concluida_em - interval '2 minutes' order by ev.criado_em desc limit 1), ''),
       coalesce(co.nome, public.nome_perfil(t.concluida_por)), t.processo_id, p.numero_cnj, t.contrato_id, t.id, null, false, false, null
  from public.tarefas t left join public.colaboradores co on co.id = t.responsavel_id left join public.processos p on p.id = t.processo_id
 where t.status = 'concluida' and t.concluida_em is not null and t.cliente_id is not null
union all
select 'publicacao', pb.id::text, coalesce(pb.cliente_id, p.cliente_id), pb.tratada_em, 'juridico', 'publicacao_' || pb.providencia,
       coalesce(pb.tipo_documento, pb.tipo_comunicacao, 'Publicação') || ' · ' || coalesce(left(pb.texto, 200), '') || coalesce(E'\n→ ' || pb.observacao_tratamento, ''),
       public.nome_perfil(pb.tratada_por), pb.processo_id, pb.numero_processo, null, pb.tarefa_id, null, false, false, null
  from public.publicacoes pb left join public.processos p on p.id = pb.processo_id
 where pb.providencia is not null and pb.tratada_em is not null and coalesce(pb.cliente_id, p.cliente_id) is not null
union all
select 'negociacao', n.id::text, n.cliente_id, n.updated_at, 'negocial', 'negociacao_' || n.etapa,
       coalesce(n.titulo, n.banco, 'Negociação') || ' · etapa: ' || n.etapa || coalesce(' · ' || n.proximo_passo, ''),
       co.nome, n.processo_id, n.numero_processo, n.contrato_id, null, n.id, false, false, null
  from public.negociacoes n left join public.colaboradores co on co.id = n.responsavel_id
union all
select 'cobranca', k.id::text, k.cliente_id, coalesce(k.pago_em::timestamptz, k.atualizado_em), 'estrategico', 'cobranca_' || k.status,
       coalesce(k.descricao, k.tipo) || ' · ' || public.brl(k.valor) || case when k.status = 'paga' then ' · paga' when k.status = 'atrasada' then ' · ATRASADA (venc. ' || to_char(k.vencimento, 'DD/MM') || ')' else '' end,
       null, null, null, k.contrato_id, null, null, false, false, null
  from public.cobrancas k where k.cliente_id is not null and k.status in ('paga', 'atrasada');
grant select on public.v_dossie to authenticated;

-- resumo por frente, por cliente (para as três colunas do dossiê e o Hoje)
create or replace view public.v_cliente_frentes with (security_invoker = true) as
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

-- v_colaboradores com a frente (coluna nova no fim)
create or replace view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.apelido, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id, co.foto_path, co.data_nascimento, co.cidade, co.linkedin, co.bio,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       (select count(*) from public.pdi d where d.colaborador_id = co.id and d.status in ('planejado','em_andamento')) as pdi_abertos,
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo, co.google_calendar_id, co.agenda_sync, co.agenda_sync_em, co.agenda_sync_erro,
       co.registra_ponto, co.jornada_minutos,
       co.frente
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;
grant select on public.v_colaboradores to authenticated;

select 'ok beta 0008' as resultado, (select count(*) from public.v_dossie) as itens_dossie;
