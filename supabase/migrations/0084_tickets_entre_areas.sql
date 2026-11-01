-- 0084 — Tickets entre áreas (reunião de 31/10): uma tarefa pode ficar "aguardando" outra área (ex.: Marina precisa que
-- as sócias aprovem uma negociação; Lucas precisa do financeiro). Quem encaminha diz o que precisa; a área responde;
-- fica visível para todos quanto tempo está parado e com quem. Não é módulo novo: é um estado da tarefa. Idempotente.

alter table public.tarefas add column if not exists aguardando_area text
  check (aguardando_area in ('juridico','comercial','marketing','financeiro','atendimento','administrativo','socios'));
alter table public.tarefas add column if not exists aguardando_desde timestamptz;
alter table public.tarefas add column if not exists aguardando_motivo text;
alter table public.tarefas add column if not exists aguardando_por uuid references public.perfis(id) on delete set null;
create index if not exists tarefas_aguardando_idx on public.tarefas (aguardando_area) where aguardando_area is not null;

-- tipos de evento: encaminhada / respondida
do $$ declare c text; begin
  select pg_get_constraintdef(oid) into c from pg_constraint where conrelid = 'public.tarefa_eventos'::regclass and conname = 'tarefa_eventos_tipo_check';
  if c is not null and c not like '%encaminhada%' then
    alter table public.tarefa_eventos drop constraint tarefa_eventos_tipo_check;
    alter table public.tarefa_eventos add constraint tarefa_eventos_tipo_check check (tipo in ('criada','reatribuida','prazo_alterado','status','concluida','reaberta','cancelada','comentario','editada','encaminhada','respondida','trabalho','anexo'));
  end if;
exception when others then raise notice 'constraint tarefa_eventos_tipo_check: %', sqlerrm; end $$;

-- perfis que atendem uma área: admins (sempre) + quem tem a área em perfis.acessos; 'socios' = só admins
create or replace function public.perfis_da_area(p_area text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.perfis p
  where p.papel = 'admin'
     or (p_area <> 'socios' and p.papel = 'colaborador' and (p_area = any(p.acessos) or (p_area = 'administrativo' and 'equipe' = any(p.acessos))))
$$;

create or replace function public.area_nome(p_area text) returns text language sql immutable as $$
  select case p_area when 'juridico' then 'Jurídico' when 'comercial' then 'Comercial' when 'marketing' then 'Marketing' when 'financeiro' then 'Financeiro'
                     when 'atendimento' then 'Atendimento' when 'administrativo' then 'Administrativo' when 'socios' then 'Sócias' else coalesce(p_area,'') end
$$;

-- encaminhar: a tarefa passa a aguardar a área; evento + aviso no sino para quem atende a área
create or replace function public.tarefa_encaminhar(p_tarefa uuid, p_area text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; t public.tarefas%rowtype; dest uuid;
begin
  if eu is null then raise exception 'Sessão expirada'; end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then raise exception 'Diga o que você precisa da área'; end if;
  select * into t from public.tarefas where id = p_tarefa; if not found then raise exception 'Tarefa não encontrada'; end if;
  meu := public.nome_perfil(eu);
  update public.tarefas set aguardando_area = p_area, aguardando_desde = now(), aguardando_motivo = btrim(p_motivo), aguardando_por = eu,
         status = case when status = 'aberta' then 'em_andamento' else status end
   where id = p_tarefa;
  insert into public.tarefa_eventos (tarefa_id, tipo, para, nota, autor, autor_nome) values (p_tarefa, 'encaminhada', public.area_nome(p_area), btrim(p_motivo), eu, meu);
  for dest in select * from public.perfis_da_area(p_area) loop
    perform public.notificar(dest, 'Ticket para ' || public.area_nome(p_area), coalesce(meu,'Alguém') || ' precisa de você em "' || left(t.titulo, 80) || '": ' || left(btrim(p_motivo), 160), '#tarefas/' || p_tarefa);
  end loop;
end $$;
grant execute on function public.tarefa_encaminhar(uuid, text, text) to authenticated;

-- responder: libera a tarefa; evento + aviso para quem encaminhou e para o responsável
create or replace function public.tarefa_responder(p_tarefa uuid, p_resposta text) returns void
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; t public.tarefas%rowtype; resp_perfil uuid;
begin
  if eu is null then raise exception 'Sessão expirada'; end if;
  if nullif(btrim(coalesce(p_resposta,'')),'') is null then raise exception 'Escreva a resposta'; end if;
  select * into t from public.tarefas where id = p_tarefa; if not found then raise exception 'Tarefa não encontrada'; end if;
  if t.aguardando_area is null then raise exception 'Esta tarefa não está aguardando nenhuma área'; end if;
  meu := public.nome_perfil(eu);
  update public.tarefas set aguardando_area = null, aguardando_desde = null, aguardando_motivo = null, aguardando_por = null where id = p_tarefa;
  insert into public.tarefa_eventos (tarefa_id, tipo, de, nota, autor, autor_nome) values (p_tarefa, 'respondida', public.area_nome(t.aguardando_area), btrim(p_resposta), eu, meu);
  perform public.notificar(t.aguardando_por, public.area_nome(t.aguardando_area) || ' respondeu', coalesce(meu,'Alguém') || ' em "' || left(t.titulo, 80) || '": ' || left(btrim(p_resposta), 160), '#tarefas/' || p_tarefa);
  select c.perfil_id into resp_perfil from public.colaboradores c where c.id = t.responsavel_id;
  if resp_perfil is distinct from t.aguardando_por then
    perform public.notificar(resp_perfil, public.area_nome(t.aguardando_area) || ' respondeu', coalesce(meu,'Alguém') || ' em "' || left(t.titulo, 80) || '": ' || left(btrim(p_resposta), 160), '#tarefas/' || p_tarefa);
  end if;
end $$;
grant execute on function public.tarefa_responder(uuid, text) to authenticated;

-- fila de tickets: o que está aguardando cada área e há quanto tempo
create or replace view public.v_tickets with (security_invoker = true) as
select t.id, t.titulo, t.cliente_id, c.nome as cliente_nome, t.responsavel_id, co.nome as responsavel_nome, t.prazo, t.prazo_fatal, t.status,
       t.aguardando_area, public.area_nome(t.aguardando_area) as aguardando_area_nome, t.aguardando_desde, t.aguardando_motivo,
       t.aguardando_por, public.nome_perfil(t.aguardando_por) as aguardando_por_nome,
       extract(epoch from (now() - t.aguardando_desde)) / 86400.0 as dias_aguardando
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
where t.aguardando_area is not null and t.status in ('aberta','em_andamento');
grant select on public.v_tickets to authenticated;

select 'ok 0084' as resultado, (select count(*) from public.v_tickets) as tickets_abertos;
