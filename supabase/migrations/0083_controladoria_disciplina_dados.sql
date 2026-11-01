-- 0083 — Controladoria (reunião de 31/10 com a Isadora): disciplina de dados.
-- 1) Reagendar tarefa exige justificativa; a justificativa fica no evento "prazo_alterado"; contador de reagendamentos por tarefa.
-- 2) Relatório de reagendamentos por colaborador e mês.
-- 3) Timesheet: dias úteis da semana sem lançamento por colaborador; aviso automático na sexta às 16h (BRT) e relatório na segunda.
-- Idempotente. Depende de 0003, 0034 e 0080 (beta 0013).

-- ---------- 1) justificativa de reagendamento ----------
alter table public.tarefas add column if not exists motivo_reagendamento text;
alter table public.tarefas add column if not exists reagendamentos integer not null default 0;

create or replace function public.tarefa_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; resp_perfil uuid; resp_nome text; ant_nome text; link text; titulo text;
begin
  meu := public.nome_perfil(eu);
  link := '#tarefas/' || new.id;
  titulo := left(new.titulo, 90);
  select c.perfil_id, c.nome into resp_perfil, resp_nome from public.colaboradores c where c.id = new.responsavel_id;
  if tg_op = 'INSERT' then
    insert into public.tarefa_eventos (tarefa_id, tipo, para, autor, autor_nome) values (new.id, 'criada', resp_nome, eu, meu);
    perform public.notificar(resp_perfil, 'Nova tarefa para você', coalesce(meu,'Alguém') || ' abriu: ' || titulo || coalesce(' · prazo ' || to_char(new.prazo,'DD/MM'), ''), link);
    return null;
  end if;
  -- UPDATE
  if new.responsavel_id is distinct from old.responsavel_id then
    select c.nome into ant_nome from public.colaboradores c where c.id = old.responsavel_id;
    insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'reatribuida', ant_nome, resp_nome, eu, meu);
    perform public.notificar(resp_perfil, 'Tarefa passada para você', coalesce(meu,'Alguém') || ' passou: ' || titulo || coalesce(' · prazo ' || to_char(new.prazo,'DD/MM'), ''), link);
  end if;
  if new.prazo is distinct from old.prazo then
    insert into public.tarefa_eventos (tarefa_id, tipo, de, para, nota, autor, autor_nome) values (new.id, 'prazo_alterado', to_char(old.prazo,'DD/MM/YYYY'), to_char(new.prazo,'DD/MM/YYYY'), nullif(btrim(coalesce(new.motivo_reagendamento,'')), ''), eu, meu);
    if new.prazo > old.prazo and new.created_by is distinct from eu then
      perform public.notificar(new.created_by, 'Prazo adiado', coalesce(meu,'Alguém') || ' adiou "' || titulo || '" de ' || to_char(old.prazo,'DD/MM') || ' para ' || to_char(new.prazo,'DD/MM') || coalesce(' — ' || nullif(btrim(new.motivo_reagendamento),''), ''), link);
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'concluida' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'concluida', eu, meu);
      perform public.notificar(new.created_by, 'Tarefa concluída', coalesce(meu,'Alguém') || ' concluiu: ' || titulo, link);
    elsif old.status = 'concluida' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'reaberta', eu, meu);
    elsif new.status = 'cancelada' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'cancelada', eu, meu);
      perform public.notificar(new.created_by, 'Tarefa cancelada', coalesce(meu,'Alguém') || ' cancelou: ' || titulo, link);
    else
      insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'status', old.status, new.status, eu, meu);
    end if;
  end if;
  if new.titulo is distinct from old.titulo or new.descricao is distinct from old.descricao or new.prazo_fatal is distinct from old.prazo_fatal or new.prioridade is distinct from old.prioridade then
    insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'editada', eu, meu);
  end if;
  return null;
end $$;

-- antes de gravar: exige o motivo quando uma pessoa (sessão autenticada) adia/antecipa um prazo já existente; conta reagendamentos; limpa o motivo depois
create or replace function public.tarefas_reagendar_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.prazo is distinct from old.prazo then
    if old.prazo is not null and auth.uid() is not null and nullif(btrim(coalesce(new.motivo_reagendamento, '')), '') is null then
      raise exception 'Informe o motivo do reagendamento' using errcode = 'P0001';
    end if;
    new.reagendamentos := coalesce(old.reagendamentos, 0) + case when old.prazo is not null then 1 else 0 end;
  else
    new.motivo_reagendamento := null;  -- só vale para a gravação que muda o prazo
  end if;
  return new;
end $$;
drop trigger if exists tarefas_reagendar on public.tarefas;
create trigger tarefas_reagendar before update on public.tarefas for each row execute function public.tarefas_reagendar_tg();

-- ---------- 2) reagendamentos por colaborador e mês ----------
create or replace view public.v_reagendamentos_mes with (security_invoker = true) as
select date_trunc('month', e.criado_em)::date as mes,
       co.id as colaborador_id, coalesce(co.nome, e.autor_nome, 'Sistema') as colaborador_nome,
       count(*) as reagendamentos,
       count(*) filter (where e.nota is null) as sem_motivo,
       count(distinct e.tarefa_id) as tarefas,
       count(*) filter (where t.prazo_fatal) as em_prazo_fatal
from public.tarefa_eventos e
join public.tarefas t on t.id = e.tarefa_id
left join public.colaboradores co on co.perfil_id = e.autor
where e.tipo = 'prazo_alterado'
group by 1, 2, 3;
grant select on public.v_reagendamentos_mes to authenticated;

-- ---------- 3) timesheet: dias úteis sem lançamento na semana ----------
create or replace function public.ts_dias_sem_lancamento(p_ini date, p_fim date)
returns table (colaborador_id uuid, colaborador_nome text, nucleo text, dias_uteis integer, dias_lancados integer, dias_faltando date[], horas numeric)
language sql stable security invoker as $$
  with dias as (
    select d::date as dia from generate_series(p_ini, least(p_fim, current_date), interval '1 day') d
    where extract(isodow from d) between 1 and 5
      and not exists (select 1 from public.feriados f where f.data = d::date)
  ), colabs as (
    select c.id, c.nome, c.nucleo from public.colaboradores c
    where c.ativo and c.nucleo is distinct from 'socios' and c.perfil_id is not null
  )
  select c.id, c.nome, c.nucleo,
         (select count(*) from dias)::int,
         (select count(distinct a.data) from public.apontamentos_horas a where a.colaborador_id = c.id and a.data between p_ini and p_fim)::int,
         array(select dia from dias where not exists (select 1 from public.apontamentos_horas a where a.colaborador_id = c.id and a.data = dias.dia) order by dia),
         coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = c.id and a.data between p_ini and p_fim), 0)
  from colabs c order by c.nome;
$$;
grant execute on function public.ts_dias_sem_lancamento(date, date) to authenticated;

-- aviso de sexta: quem tem dia útil da semana sem lançamento recebe notificação no sino (e a controladoria também)
create or replace function public.ts_cobrar_semana() returns integer
language plpgsql security definer set search_path = public as $$
declare ini date := date_trunc('week', current_date)::date; fim date := ini + 4; r record; n integer := 0; resumo text := ''; ctrl uuid;
begin
  for r in select * from public.ts_dias_sem_lancamento(ini, fim) where cardinality(dias_faltando) > 0 loop
    n := n + 1;
    resumo := resumo || r.colaborador_nome || ' (' || cardinality(r.dias_faltando) || ' dia(s)) · ';
    perform public.notificar_colaborador(r.colaborador_id, 'Timesheet da semana em aberto',
      'Faltam lançamentos em ' || array_to_string(array(select to_char(d, 'DD/MM') from unnest(r.dias_faltando) d), ', ') || '. A semana precisa estar fechada até sexta.', '#horas');
  end loop;
  -- controladoria (colaborador do núcleo acompanhamento_pj com cargo de controladoria) e admins recebem o resumo
  if n > 0 then
    for ctrl in select p.id from public.perfis p where p.papel = 'admin' loop
      perform public.notificar(ctrl, 'Timesheet: ' || n || ' colaborador(es) com a semana em aberto', left(resumo, 900), '#horas');
    end loop;
  end if;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ts-cobrar-semana-np';
    perform cron.schedule('ts-cobrar-semana-np', '0 19 * * 5', $c$ select public.ts_cobrar_semana(); $c$);   -- sexta 16h BRT
  end if;
exception when others then raise notice 'cron não agendado: %', sqlerrm; end $$;

select 'ok 0083' as resultado,
       (select count(*) from public.tarefas where reagendamentos > 0) as tarefas_reagendadas,
       (select count(*) from public.ts_dias_sem_lancamento(date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 4) where cardinality(dias_faltando) > 0) as colabs_semana_aberta;
