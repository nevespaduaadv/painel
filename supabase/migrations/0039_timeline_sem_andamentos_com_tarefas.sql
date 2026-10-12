-- 0039 — Timeline = atuação do escritório; andamento processual fica só na aba Processos.
-- (1) andamentos deixam de ser copiados para entradas_timeline (e as cópias antigas são removidas);
-- (2) o que a equipe faz dentro dos processos entra na timeline automaticamente via tarefas: aberta, concluída (com o comentário), cancelada.
-- Idempotente. Depende de 0002 (entradas_timeline), 0034 (tarefa_eventos).

-- ---------- (1) sem cópia de andamentos ----------
drop trigger if exists andamento_para_timeline on public.andamentos;
drop trigger if exists andamento_sync_timeline on public.andamentos;
delete from public.entradas_timeline where andamento_id is not null and automatica;

-- ---------- (2) tarefas na timeline ----------
alter table public.entradas_timeline add column if not exists tarefa_id uuid references public.tarefas(id) on delete set null;
create index if not exists entradas_timeline_tarefa_idx on public.entradas_timeline (tarefa_id);
alter table public.entradas_timeline drop constraint if exists entradas_timeline_tipo_check;
alter table public.entradas_timeline add constraint entradas_timeline_tipo_check check (tipo in ('solicitacao_documentos','requerimento_bacen','analise_contrato','parecer_tecnico','contato_banco',
  'proposta_acordo','reuniao_cliente','ata','protocolo','mudanca_estagio','acordo_fechado','andamento','tarefa','outro'));

create or replace function public.tl_de_evento_tarefa() returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tarefas%rowtype; cid text; txt text; quem text; d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.tarefa_id is null then return null; end if;
  select * into t from public.tarefas where id = new.tarefa_id;
  if t is null then return null; end if;
  cid := t.cliente_id;
  if cid is null and t.processo_id is not null then select cliente_id into cid from public.processos where id = t.processo_id; end if;
  if cid is null then return null; end if;                -- sem cliente: não há timeline onde registrar
  quem := coalesce(new.autor_nome, 'Equipe');
  if new.tipo = 'criada' then
    txt := 'Tarefa aberta: ' || t.titulo || coalesce(' — para ' || new.para, '') || coalesce(' · prazo ' || to_char(t.prazo,'DD/MM/YYYY'), '') || case when t.prazo_fatal then ' (fatal)' else '' end || ' · por ' || quem;
  elsif new.tipo = 'concluida' then
    txt := 'Tarefa concluída: ' || t.titulo || ' · por ' || quem;
  elsif new.tipo = 'cancelada' then
    txt := 'Tarefa cancelada: ' || t.titulo || ' · por ' || quem;
  elsif new.tipo = 'comentario' then
    txt := quem || ' sobre "' || t.titulo || '": ' || coalesce(new.nota, '');
  else
    return null;                                          -- reatribuída, prazo alterado, editada: ficam só no histórico da tarefa
  end if;
  insert into public.entradas_timeline (cliente_id, processo_id, contrato_id, tarefa_id, data, tipo, descricao, visivel_cliente, automatica, fonte, responsavel_id, created_by)
  values (cid, t.processo_id, t.contrato_id, t.id, d, 'tarefa', txt, false, true, 'tarefas', t.responsavel_id, new.autor);
  return null;
end $$;
drop trigger if exists evento_tarefa_para_timeline on public.tarefa_eventos;
create trigger evento_tarefa_para_timeline after insert on public.tarefa_eventos for each row execute procedure public.tl_de_evento_tarefa();

-- backfill dos eventos já existentes (desde 0034)
insert into public.entradas_timeline (cliente_id, processo_id, contrato_id, tarefa_id, data, tipo, descricao, visivel_cliente, automatica, fonte, responsavel_id, created_by)
select coalesce(t.cliente_id, p.cliente_id), t.processo_id, t.contrato_id, t.id, (e.criado_em at time zone 'America/Sao_Paulo')::date, 'tarefa',
       case e.tipo when 'criada' then 'Tarefa aberta: ' || t.titulo || coalesce(' — para ' || e.para, '') || coalesce(' · prazo ' || to_char(t.prazo,'DD/MM/YYYY'), '') || ' · por ' || coalesce(e.autor_nome,'Equipe')
                   when 'concluida' then 'Tarefa concluída: ' || t.titulo || ' · por ' || coalesce(e.autor_nome,'Equipe')
                   when 'cancelada' then 'Tarefa cancelada: ' || t.titulo || ' · por ' || coalesce(e.autor_nome,'Equipe')
                   else coalesce(e.autor_nome,'Equipe') || ' sobre "' || t.titulo || '": ' || coalesce(e.nota,'') end,
       false, true, 'tarefas', t.responsavel_id, e.autor
from public.tarefa_eventos e join public.tarefas t on t.id = e.tarefa_id left join public.processos p on p.id = t.processo_id
where e.tipo in ('criada','concluida','cancelada','comentario') and coalesce(t.cliente_id, p.cliente_id) is not null
  and not exists (select 1 from public.entradas_timeline x where x.tarefa_id = t.id and x.fonte = 'tarefas' and x.descricao like case e.tipo when 'criada' then 'Tarefa aberta:%' when 'concluida' then 'Tarefa concluída:%' when 'cancelada' then 'Tarefa cancelada:%' else '%sobre "%' end and x.data = (e.criado_em at time zone 'America/Sao_Paulo')::date);

select 'ok 0039 · '||(select count(*) from public.entradas_timeline where fonte='tarefas')||' entradas de tarefas' as resultado;
