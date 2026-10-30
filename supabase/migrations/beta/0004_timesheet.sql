-- ESPELHO (beta) — Bloco 4 da controladoria: Timesheet completo.
-- Objetivos (Ana Júlia): (a) demonstrar ao cliente as horas trabalhadas (cobrável × tabela de hora);
-- (b) horas gastas × honorário/horas contratadas do cliente; (c) horas por tarefa/atividade e total do colaborador no mês.
-- Acrescenta: catálogo de atividades (admin), tabelas de valor/hora, vínculo por cliente (tabela, horas contratadas, honorário mensal),
-- cobrável/não cobrável, início/fim, processo, aprovação do gestor (pendente → aprovado | correção), cronômetro persistente.
-- Idempotente. Só no beta até aprovação.

-- ---------- catálogo de atividades ----------
create table if not exists public.ts_atividades (
  codigo text primary key,
  nome text not null,
  cobravel_padrao boolean not null default true,
  ativa boolean not null default true,
  ordem integer not null default 0
);
insert into public.ts_atividades (codigo, nome, cobravel_padrao, ordem) values
  ('analise_documentacao', 'Análise de documentação', true, 1), ('analise_contrato', 'Análise de contrato', true, 2),
  ('parecer_tecnico', 'Parecer técnico', true, 3), ('peticao', 'Elaboração de petição', true, 4), ('peticao_inicial', 'Elaboração de petição inicial', true, 5),
  ('recurso', 'Elaboração de recurso', true, 6), ('audiencia', 'Audiência', true, 7), ('reuniao_cliente', 'Reunião / atendimento ao cliente', true, 8),
  ('contato_telefonico', 'Contato telefônico', true, 9), ('contato_banco', 'Contato com jurídico do banco', true, 10), ('proposta_acordo', 'Proposta / negociação de acordo', true, 11),
  ('requerimento_bacen', 'Requerimento ao Bacen', true, 12), ('solicitacao_documentos', 'Solicitação de documentos', true, 13), ('protocolo', 'Protocolo', true, 14),
  ('andamento', 'Acompanhamento processual', true, 15), ('diligencia', 'Diligência', true, 16), ('ata', 'Ata / registro', true, 17),
  ('calculo', 'Cálculo / planilha', true, 18), ('pesquisa', 'Pesquisa jurídica', true, 19),
  ('administrativo', 'Administrativo interno', false, 30), ('comercial', 'Comercial / prospecção', false, 31), ('treinamento', 'Treinamento / estudo', false, 32), ('outro', 'Outro', true, 40)
on conflict (codigo) do nothing;
alter table public.ts_atividades enable row level security;
drop policy if exists ts_ativ_sel on public.ts_atividades; create policy ts_ativ_sel on public.ts_atividades for select to authenticated using (public.sou_equipe());
drop policy if exists ts_ativ_adm on public.ts_atividades; create policy ts_ativ_adm on public.ts_atividades for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update, delete on public.ts_atividades to authenticated;

-- ---------- tabelas de valor/hora ----------
create table if not exists public.ts_tabelas_hora (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  valor_hora numeric(12,2) not null default 0 check (valor_hora >= 0),
  ativa boolean not null default true,
  padrao boolean not null default false,
  created_at timestamptz default now()
);
insert into public.ts_tabelas_hora (nome, valor_hora, padrao) select 'Tabela padrão', 0, true where not exists (select 1 from public.ts_tabelas_hora);
alter table public.ts_tabelas_hora enable row level security;
drop policy if exists ts_tab_sel on public.ts_tabelas_hora; create policy ts_tab_sel on public.ts_tabelas_hora for select to authenticated using (public.sou_equipe());
drop policy if exists ts_tab_adm on public.ts_tabelas_hora; create policy ts_tab_adm on public.ts_tabelas_hora for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update, delete on public.ts_tabelas_hora to authenticated;

-- ---------- cliente: tabela de hora, horas contratadas e honorário mensal ----------
alter table public.clientes
  add column if not exists tabela_hora_id uuid references public.ts_tabelas_hora (id) on delete set null,
  add column if not exists horas_contratadas_mes numeric(7,2),
  add column if not exists honorario_mensal numeric(12,2);

-- ---------- apontamentos: novos campos ----------
alter table public.apontamentos_horas
  add column if not exists inicio time,
  add column if not exists fim time,
  add column if not exists cobravel boolean not null default true,
  add column if not exists processo_id uuid references public.processos (id) on delete set null,
  add column if not exists status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'correcao')),
  add column if not exists aprovado_por uuid,
  add column if not exists aprovado_em timestamptz,
  add column if not exists obs_gestor text;
create index if not exists apont_status_idx on public.apontamentos_horas (status) where status <> 'aprovado';
create index if not exists apont_tarefa_idx on public.apontamentos_horas (tarefa_id);

-- só admin muda status/aprovação; edição de lançamento aprovado por não-admin volta a pendente
create or replace function public.ts_proteger_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.sou_admin() then new.status := 'pendente'; new.aprovado_por := null; new.aprovado_em := null; new.obs_gestor := null; end if;
    if new.cobravel is null then new.cobravel := coalesce((select cobravel_padrao from public.ts_atividades where codigo = new.tipo_atividade), true); end if;
    return new;
  end if;
  if not public.sou_admin() then
    if new.status is distinct from old.status or new.obs_gestor is distinct from old.obs_gestor then new.status := old.status; new.obs_gestor := old.obs_gestor; end if;
    if old.status = 'aprovado' and (new.horas is distinct from old.horas or new.data is distinct from old.data or new.cliente_id is distinct from old.cliente_id or new.cobravel is distinct from old.cobravel or new.tipo_atividade is distinct from old.tipo_atividade) then
      new.status := 'pendente'; new.aprovado_por := null; new.aprovado_em := null;
    end if;
    if old.status = 'correcao' and (new.horas is distinct from old.horas or new.data is distinct from old.data or new.descricao is distinct from old.descricao or new.cliente_id is distinct from old.cliente_id or new.cobravel is distinct from old.cobravel or new.tipo_atividade is distinct from old.tipo_atividade) then
      new.status := 'pendente';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ts_proteger on public.apontamentos_horas;
create trigger ts_proteger before insert or update on public.apontamentos_horas for each row execute function public.ts_proteger_tg();

-- aprovar / pedir correção (admin). Avisa o colaborador no sino quando pede correção.
create or replace function public.ts_aprovar(p_ids uuid[], p_status text, p_obs text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; r record;
begin
  if not public.sou_admin() then raise exception 'Só administradores aprovam horas.'; end if;
  if p_status not in ('aprovado', 'correcao', 'pendente') then raise exception 'Status inválido.'; end if;
  update public.apontamentos_horas set status = p_status, obs_gestor = case when p_status = 'correcao' then p_obs else null end,
         aprovado_por = case when p_status = 'aprovado' then auth.uid() end, aprovado_em = case when p_status = 'aprovado' then now() end, updated_at = now(), updated_by = auth.uid()
   where id = any(p_ids);
  get diagnostics n = row_count;
  if p_status = 'correcao' then
    for r in select distinct co.perfil_id, co.nome from public.apontamentos_horas a join public.colaboradores co on co.id = a.colaborador_id where a.id = any(p_ids) and co.perfil_id is not null loop
      perform public.notificar(r.perfil_id, 'Horas devolvidas para correção', coalesce(left(p_obs, 140), 'Veja a observação do gestor na aba Horas'), '#horas');
    end loop;
  end if;
  return n;
end $$;
grant execute on function public.ts_aprovar(uuid[], text, text) to authenticated;

-- ---------- cronômetro persistente (um por colaborador) ----------
create table if not exists public.ts_cronometros (
  colaborador_id uuid primary key references public.colaboradores (id) on delete cascade,
  inicio timestamptz not null default now(),
  cliente_id text references public.clientes (id) on delete set null,
  tarefa_id uuid references public.tarefas (id) on delete set null,
  processo_id uuid references public.processos (id) on delete set null,
  tipo_atividade text,
  descricao text
);
alter table public.ts_cronometros enable row level security;
drop policy if exists ts_cron_own on public.ts_cronometros; create policy ts_cron_own on public.ts_cronometros for all to authenticated using (colaborador_id = public.meu_colaborador() or public.sou_admin()) with check (colaborador_id = public.meu_colaborador() or public.sou_admin());
grant select, insert, update, delete on public.ts_cronometros to authenticated;

create or replace function public.ts_cronometro_iniciar(p_cliente text default null, p_tarefa uuid default null, p_processo uuid default null, p_atividade text default null, p_descricao text default null)
returns public.ts_cronometros language plpgsql security definer set search_path = public as $$
declare me uuid := public.meu_colaborador(); r public.ts_cronometros;
begin
  if me is null then raise exception 'Seu usuário não está vinculado a um colaborador.'; end if;
  if exists (select 1 from public.ts_cronometros where colaborador_id = me) then raise exception 'Já existe um cronômetro rodando — pare-o antes.'; end if;
  insert into public.ts_cronometros (colaborador_id, cliente_id, tarefa_id, processo_id, tipo_atividade, descricao) values (me, p_cliente, p_tarefa, p_processo, p_atividade, p_descricao) returning * into r;
  return r;
end $$;
-- parar: grava o apontamento (mínimo 5 min, arredondado para cima em blocos de 5 min) e remove o cronômetro
create or replace function public.ts_cronometro_parar(p_descricao text default null, p_descartar boolean default false)
returns public.apontamentos_horas language plpgsql security definer set search_path = public as $$
declare me uuid := public.meu_colaborador(); c public.ts_cronometros; a public.apontamentos_horas; mins numeric;
begin
  select * into c from public.ts_cronometros where colaborador_id = me;
  if c.colaborador_id is null then raise exception 'Nenhum cronômetro rodando.'; end if;
  delete from public.ts_cronometros where colaborador_id = me;
  if p_descartar then return null; end if;
  mins := greatest(5, ceil(extract(epoch from (now() - c.inicio)) / 60 / 5) * 5);
  insert into public.apontamentos_horas (colaborador_id, data, horas, inicio, fim, cliente_id, tarefa_id, processo_id, tipo_atividade, descricao, cobravel, created_by)
  values (me, (c.inicio at time zone 'America/Sao_Paulo')::date, round(mins / 60.0, 2), (c.inicio at time zone 'America/Sao_Paulo')::time, (now() at time zone 'America/Sao_Paulo')::time,
          c.cliente_id, c.tarefa_id, c.processo_id, coalesce(c.tipo_atividade, 'outro'), coalesce(p_descricao, c.descricao),
          coalesce((select cobravel_padrao from public.ts_atividades where codigo = c.tipo_atividade), true), auth.uid())
  returning * into a;
  return a;
end $$;
grant execute on function public.ts_cronometro_iniciar(text, uuid, uuid, text, text) to authenticated;
grant execute on function public.ts_cronometro_parar(text, boolean) to authenticated;

-- ---------- views ----------
drop view if exists public.v_horas_colaborador_mes; drop view if exists public.v_horas_cliente_mes; drop view if exists public.v_horas_tipo_mes; drop view if exists public.v_apontamentos;
create view public.v_apontamentos with (security_invoker = true) as
select a.*,
       co.nome as colaborador_nome, co.nucleo,
       c.nome as cliente_nome,
       t.titulo as tarefa_titulo,
       date_trunc('month', a.data)::date as mes,
       coalesce(at.nome, a.tipo_atividade) as atividade_nome,
       p.numero_cnj,
       coalesce(th.valor_hora, (select valor_hora from public.ts_tabelas_hora where padrao limit 1), 0) as valor_hora,
       case when a.cobravel then a.horas * coalesce(th.valor_hora, (select valor_hora from public.ts_tabelas_hora where padrao limit 1), 0) else 0 end as valor,
       public.nome_perfil(a.aprovado_por) as aprovado_por_nome
from public.apontamentos_horas a
join public.colaboradores co on co.id = a.colaborador_id
left join public.clientes c on c.id = a.cliente_id
left join public.ts_tabelas_hora th on th.id = c.tabela_hora_id
left join public.tarefas t on t.id = a.tarefa_id
left join public.processos p on p.id = a.processo_id
left join public.ts_atividades at on at.codigo = a.tipo_atividade;
grant select on public.v_apontamentos to authenticated;

create view public.v_horas_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, nucleo, sum(horas) as horas, count(*) as lancamentos,
       sum(horas) filter (where cobravel) as horas_cobraveis, sum(valor) as valor,
       count(*) filter (where status = 'pendente') as pendentes, count(*) filter (where status = 'correcao') as em_correcao,
       count(distinct data) as dias_com_lancamento
from public.v_apontamentos group by 1,2,3,4;
grant select on public.v_horas_colaborador_mes to authenticated;

create view public.v_horas_cliente_mes with (security_invoker = true) as
select a.mes, a.cliente_id, a.cliente_nome, sum(a.horas) as horas, count(*) as lancamentos,
       sum(a.horas) filter (where a.cobravel) as horas_cobraveis, sum(a.valor) as valor,
       c.horas_contratadas_mes, c.honorario_mensal,
       case when c.horas_contratadas_mes is not null then c.horas_contratadas_mes - sum(a.horas) filter (where a.cobravel) end as saldo_horas,
       case when c.honorario_mensal is not null and sum(a.horas) filter (where a.cobravel) > 0 then round(c.honorario_mensal / (sum(a.horas) filter (where a.cobravel)), 2) end as honorario_por_hora_efetivo
from public.v_apontamentos a left join public.clientes c on c.id = a.cliente_id group by 1,2,3,c.horas_contratadas_mes,c.honorario_mensal;
grant select on public.v_horas_cliente_mes to authenticated;

create view public.v_horas_tipo_mes with (security_invoker = true) as
select mes, coalesce(tipo_atividade,'outro') as tipo_atividade, atividade_nome, sum(horas) as horas, count(*) as lancamentos, sum(horas) filter (where cobravel) as horas_cobraveis
from public.v_apontamentos group by 1,2,3;
grant select on public.v_horas_tipo_mes to authenticated;

create or replace view public.v_horas_atividade_colaborador_mes with (security_invoker = true) as
select mes, colaborador_id, colaborador_nome, coalesce(tipo_atividade,'outro') as tipo_atividade, atividade_nome, sum(horas) as horas, count(*) as lancamentos
from public.v_apontamentos group by 1,2,3,4,5;
grant select on public.v_horas_atividade_colaborador_mes to authenticated;

create or replace view public.v_horas_tarefa with (security_invoker = true) as
select t.id as tarefa_id, t.titulo, t.cliente_id, c.nome as cliente_nome, t.responsavel_id, co.nome as responsavel_nome, t.status, t.prazo,
       coalesce(sum(a.horas), 0) as horas, coalesce(sum(a.horas) filter (where a.cobravel), 0) as horas_cobraveis, count(a.id) as lancamentos, min(a.data) as primeiro, max(a.data) as ultimo
from public.tarefas t left join public.apontamentos_horas a on a.tarefa_id = t.id left join public.clientes c on c.id = t.cliente_id left join public.colaboradores co on co.id = t.responsavel_id
group by t.id, t.titulo, t.cliente_id, c.nome, t.responsavel_id, co.nome, t.status, t.prazo;
grant select on public.v_horas_tarefa to authenticated;

select 'ok beta 0004' as resultado, (select count(*) from public.ts_atividades) as atividades, (select count(*) from public.apontamentos_horas) as apontamentos;
