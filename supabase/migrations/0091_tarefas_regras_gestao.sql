-- 0091 — Tarefas (pedidos de 02/11):
--  • motivos de reagendamento pré-cadastrados pela gestão/controladoria (lista fechada + complemento livre)
--  • SLAs internos dos tickets por área (dias para responder), cadastrados pela gestão
--  • alerta automático para gestão e controladoria quando uma tarefa é reagendada ou excluída
--  • "passar e concluir a minha parte": fecha a tarefa de quem passa e abre uma nova para quem recebe, com a data escolhida
-- Idempotente.

-- ---------- 1) motivos de reagendamento ----------
create table if not exists public.motivos_reagendamento (
  id uuid primary key default gen_random_uuid(),
  motivo text not null unique,
  exige_complemento boolean not null default false,   -- ex.: "Outro" pede texto
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.motivos_reagendamento enable row level security;
drop policy if exists mr_sel on public.motivos_reagendamento; create policy mr_sel on public.motivos_reagendamento for select to authenticated using (public.sou_equipe());
drop policy if exists mr_adm on public.motivos_reagendamento; create policy mr_adm on public.motivos_reagendamento for all to authenticated using (public.aprova_requisicoes()) with check (public.aprova_requisicoes());
grant select, insert, update, delete on public.motivos_reagendamento to authenticated;
insert into public.motivos_reagendamento (motivo, exige_complemento, ordem) values
  ('Aguardando documentos do cliente', false, 10), ('Aguardando retorno do banco', false, 20), ('Prazo processual alterado pelo juízo', false, 30),
  ('Audiência/reunião remarcada', false, 40), ('Dependência de outra área (ticket)', false, 50), ('Priorização de prazo fatal', false, 60),
  ('Não houve tempo hábil', false, 70), ('Ausência/férias do responsável', false, 80), ('Outro (descrever)', true, 90)
on conflict (motivo) do nothing;

-- ---------- 2) SLAs de ticket por área ----------
create table if not exists public.sla_tickets (
  area text primary key check (area in ('juridico','comercial','marketing','financeiro','atendimento','administrativo','socios')),
  dias_resposta integer not null default 2 check (dias_resposta between 0 and 60),
  dias_critico integer not null default 5 check (dias_critico between 0 and 90),
  observacao text,
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.sla_tickets enable row level security;
drop policy if exists sla_sel on public.sla_tickets; create policy sla_sel on public.sla_tickets for select to authenticated using (public.sou_equipe());
drop policy if exists sla_adm on public.sla_tickets; create policy sla_adm on public.sla_tickets for all to authenticated using (public.aprova_requisicoes()) with check (public.aprova_requisicoes());
grant select, insert, update, delete on public.sla_tickets to authenticated;
insert into public.sla_tickets (area, dias_resposta, dias_critico) values ('juridico',2,5),('comercial',1,3),('marketing',2,5),('financeiro',1,3),('atendimento',1,2),('administrativo',2,5),('socios',2,5) on conflict (area) do nothing;

create or replace view public.v_tickets with (security_invoker = true) as
select t.id, t.titulo, t.cliente_id, c.nome as cliente_nome, t.responsavel_id, co.nome as responsavel_nome, t.prazo, t.prazo_fatal, t.status,
       t.aguardando_area, public.area_nome(t.aguardando_area) as aguardando_area_nome, t.aguardando_desde, t.aguardando_motivo,
       t.aguardando_por, public.nome_perfil(t.aguardando_por) as aguardando_por_nome,
       extract(epoch from (now() - t.aguardando_desde)) / 86400.0 as dias_aguardando,
       coalesce(s.dias_resposta, 2) as sla_dias, coalesce(s.dias_critico, 5) as sla_critico,
       case when extract(epoch from (now() - t.aguardando_desde)) / 86400.0 >= coalesce(s.dias_critico, 5) then 'critico'
            when extract(epoch from (now() - t.aguardando_desde)) / 86400.0 >= coalesce(s.dias_resposta, 2) then 'vencido' else 'no_prazo' end as sla_situacao
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.sla_tickets s on s.area = t.aguardando_area
where t.aguardando_area is not null and t.status in ('aberta','em_andamento');
grant select on public.v_tickets to authenticated;

-- ---------- 3) alertas para gestão e controladoria ----------
-- gestão = admins; controladoria = quem tem 'tarefas_equipe' (controle) nos acessos
create or replace function public.perfis_gestao_controladoria() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.perfis p where p.papel = 'admin' or 'tarefas_equipe' = any(p.acessos)
$$;

create or replace function public.tarefas_alerta_gestao_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; dest uuid; resp text;
begin
  meu := coalesce(public.nome_perfil(eu), 'Sistema');
  if tg_op = 'DELETE' then
    select c.nome into resp from public.colaboradores c where c.id = old.responsavel_id;
    for dest in select * from public.perfis_gestao_controladoria() loop
      perform public.notificar(dest, 'Tarefa excluída', meu || ' excluiu "' || left(old.titulo, 80) || '"' || coalesce(' (resp. ' || resp || ')', '') || coalesce(' · prazo ' || to_char(old.prazo, 'DD/MM'), ''), '#tarefas');
    end loop;
    return old;
  end if;
  if new.prazo is distinct from old.prazo and old.prazo is not null then
    select c.nome into resp from public.colaboradores c where c.id = new.responsavel_id;
    for dest in select * from public.perfis_gestao_controladoria() loop
      perform public.notificar(dest, 'Tarefa reagendada', meu || ' moveu "' || left(new.titulo, 80) || '" de ' || to_char(old.prazo, 'DD/MM') || ' para ' || coalesce(to_char(new.prazo, 'DD/MM'), 'sem prazo') || coalesce(' — ' || new.motivo_reagendamento, '') || coalesce(' (resp. ' || resp || ')', ''), '#tarefas/' || new.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_alerta_gestao on public.tarefas;
create trigger tarefas_alerta_gestao after update of prazo or delete on public.tarefas for each row execute function public.tarefas_alerta_gestao_tg();

-- ---------- 4) passar e concluir a minha parte ----------
-- Fecha a tarefa atual (concluída, com o que foi feito) e abre uma nova para quem recebe, com o prazo escolhido. Quem recebe é avisado pelo gatilho de criação.
create or replace function public.tarefa_passar_concluindo(p_tarefa uuid, p_para uuid, p_prazo date, p_nota text) returns uuid
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); t public.tarefas%rowtype; nova uuid; meu text; quem text;
begin
  if eu is null then raise exception 'Sessão expirada'; end if;
  if nullif(btrim(coalesce(p_nota,'')),'') is null then raise exception 'Escreva o que você fez antes de passar'; end if;
  select * into t from public.tarefas where id = p_tarefa; if not found then raise exception 'Tarefa não encontrada'; end if;
  meu := public.nome_perfil(eu); select nome into quem from public.colaboradores where id = p_para;
  -- nova tarefa para quem recebe (herda cliente, processo, contrato, núcleo, fatal, prioridade)
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, processo_id, responsavel_id, nucleo, prazo, hora, prazo_fatal, prioridade, status, created_by)
  values (t.titulo, coalesce(t.descricao,'') || E'\n\n— Recebida de ' || coalesce(meu,'') || ' em ' || to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY') || ' —\n' || btrim(p_nota) || E'\n(continuação da tarefa ' || t.id || ')',
          t.cliente_id, t.contrato_id, t.processo_id, p_para, t.nucleo, coalesce(p_prazo, t.prazo), case when p_prazo is null or p_prazo = t.prazo then t.hora else null end, t.prazo_fatal, t.prioridade, 'aberta', eu)
  returning id into nova;
  -- conclui a minha
  insert into public.tarefa_eventos (tarefa_id, tipo, nota, autor, autor_nome) values (p_tarefa, 'comentario', 'Passei para ' || coalesce(quem,'—') || ' e concluí a minha parte.' || E'\n' || btrim(p_nota) || E'\n(nova tarefa: ' || nova || ')', eu, meu);
  update public.tarefas set status = 'concluida', concluida_em = now() where id = p_tarefa;
  return nova;
end $$;
grant execute on function public.tarefa_passar_concluindo(uuid, uuid, date, text) to authenticated;

select 'ok 0091' as resultado, (select count(*) from public.motivos_reagendamento) as motivos, (select count(*) from public.sla_tickets) as slas;
