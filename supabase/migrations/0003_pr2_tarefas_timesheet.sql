-- 0003 — PR 2: tarefas e prazos + timesheet (apontamentos de horas)
-- Idempotente. Depende de 0002 (colaboradores, processos, entradas_timeline, carimbar2, auditar, sou_equipe, sou_admin, meu_colaborador).

-- ---------- Tarefas ----------
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  cliente_id text references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  nucleo text check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','administrativo','socios')),
  prazo date,
  prazo_fatal boolean not null default false,
  status text not null default 'aberta' check (status in ('aberta','em_andamento','concluida','cancelada')),
  concluida_em timestamptz,
  prioridade smallint not null default 2 check (prioridade between 1 and 3),   -- 1 alta, 2 normal, 3 baixa
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists tarefas_prazo_idx on public.tarefas (prazo) where status in ('aberta','em_andamento');
create index if not exists tarefas_cliente_idx on public.tarefas (cliente_id);
create index if not exists tarefas_resp_idx on public.tarefas (responsavel_id);

-- concluida_em acompanha o status
create or replace function public.tarefa_concluida() returns trigger language plpgsql as $$
begin
  if new.status = 'concluida' and (old is null or old.status <> 'concluida') then new.concluida_em := coalesce(new.concluida_em, now());
  elsif new.status <> 'concluida' then new.concluida_em := null; end if;
  return new;
end $$;
drop trigger if exists tarefas_concluida on public.tarefas;
create trigger tarefas_concluida before insert or update on public.tarefas for each row execute procedure public.tarefa_concluida();

-- ---------- Apontamentos de horas ----------
create table if not exists public.apontamentos_horas (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  data date not null,
  horas numeric(6,2) not null check (horas > 0 and horas <= 24),
  cliente_id text references public.clientes(id) on delete set null,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  entrada_id uuid references public.entradas_timeline(id) on delete cascade,
  tipo_atividade text,            -- mesmo vocabulário dos tipos da timeline, ou livre
  descricao text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create unique index if not exists apont_entrada_uidx on public.apontamentos_horas (entrada_id) where entrada_id is not null;
create index if not exists apont_colab_data_idx on public.apontamentos_horas (colaborador_id, data);
create index if not exists apont_cliente_idx on public.apontamentos_horas (cliente_id);

-- Horas lançadas na entrada da timeline viram apontamento automaticamente (e acompanham edições)
create or replace function public.apontar_de_entrada() returns trigger language plpgsql security definer set search_path = public as $$
declare colab uuid;
begin
  colab := coalesce(new.responsavel_id, (select id from public.colaboradores where perfil_id = coalesce(new.created_by, auth.uid()) limit 1));
  if coalesce(new.horas,0) > 0 and colab is not null then
    insert into public.apontamentos_horas (colaborador_id, data, horas, cliente_id, entrada_id, tipo_atividade, descricao, created_by)
    values (colab, new.data, new.horas, new.cliente_id, new.id, new.tipo, left(new.descricao, 200), new.created_by)
    on conflict (entrada_id) where entrada_id is not null
    do update set colaborador_id = excluded.colaborador_id, data = excluded.data, horas = excluded.horas, cliente_id = excluded.cliente_id,
                  tipo_atividade = excluded.tipo_atividade, descricao = excluded.descricao;
  else
    delete from public.apontamentos_horas where entrada_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists tl_apontar on public.entradas_timeline;
create trigger tl_apontar after insert or update of horas, responsavel_id, data, cliente_id on public.entradas_timeline
  for each row execute procedure public.apontar_de_entrada();

-- Carimbos e auditoria
do $$ declare t text; begin
  foreach t in array array['tarefas','apontamentos_horas'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.tarefas enable row level security;
alter table public.apontamentos_horas enable row level security;

-- Tarefas: só equipe (o cliente não vê tarefas internas)
drop policy if exists tarefas_sel on public.tarefas;
create policy tarefas_sel on public.tarefas for select to authenticated using (public.sou_equipe());
drop policy if exists tarefas_wr on public.tarefas;
create policy tarefas_wr on public.tarefas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- Apontamentos: equipe lê tudo (relatórios); cada um edita os próprios; admin edita todos
drop policy if exists apont_sel on public.apontamentos_horas;
create policy apont_sel on public.apontamentos_horas for select to authenticated using (public.sou_equipe());
drop policy if exists apont_wr on public.apontamentos_horas;
create policy apont_wr on public.apontamentos_horas for all to authenticated
  using (public.sou_admin() or colaborador_id = public.meu_colaborador())
  with check (public.sou_admin() or colaborador_id = public.meu_colaborador());

-- ---------- Views (lidas pelo painel e, depois, pelo Power BI/Looker) ----------
-- security_invoker: a RLS de quem consulta continua valendo.
create or replace view public.v_tarefas with (security_invoker = true) as
select t.*,
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
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.tarefa_id = t.id), 0) as horas_apontadas
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

create or replace view public.v_apontamentos with (security_invoker = true) as
select a.*,
       co.nome as colaborador_nome, co.nucleo,
       c.nome as cliente_nome,
       t.titulo as tarefa_titulo,
       date_trunc('month', a.data)::date as mes
from public.apontamentos_horas a
join public.colaboradores co on co.id = a.colaborador_id
left join public.clientes c on c.id = a.cliente_id
left join public.tarefas t on t.id = a.tarefa_id;

create or replace view public.v_horas_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, nucleo, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3,4;

create or replace view public.v_horas_cliente_mes with (security_invoker = true) as
select mes, cliente_id, cliente_nome, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3;

create or replace view public.v_horas_tipo_mes with (security_invoker = true) as
select mes, coalesce(tipo_atividade,'outro') as tipo_atividade, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2;

create or replace view public.v_tarefas_pontualidade with (security_invoker = true) as
select responsavel_id, responsavel_nome, nucleo,
       count(*) filter (where status in ('aberta','em_andamento')) as abertas,
       count(*) filter (where faixa = 'atrasada') as atrasadas,
       count(*) filter (where faixa in ('hoje','d7') and prazo_fatal) as fatais_7d,
       count(*) filter (where status = 'concluida') as concluidas,
       count(*) filter (where concluida_no_prazo) as concluidas_no_prazo,
       count(*) filter (where concluida_no_prazo = false) as concluidas_com_atraso
from public.v_tarefas group by 1,2,3;

-- ---------- Tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.tarefas, public.apontamentos_horas;
exception when duplicate_object then null; end $$;

select 'ok 0003' as resultado;
