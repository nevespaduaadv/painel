-- 0112 — Controle financeiro: instalação SEM tarefas automáticas, ativação explícita e cobranças antigas à parte.
-- PROPOSTA: não aplicada. Vai SEMPRE na mesma transação, na ordem 0104b (trava prévia) → 0105 → 0112. Idempotente.
-- Contexto: aplicada sozinha, a 0105 agenda regua_tarefas_auto e, na 1ª execução (dia útil, 08h20), criaria em produção
-- uma tarefa de prioridade alta por cobrança vencida há 7+ dias sem tarefa aberta (154 em 15/11, todas para a mesma sócia).
--
-- 1) INSTALAÇÃO: as estruturas da 0105 ficam; o agendamento é retirado; a rotina não cria nada enquanto a régua não for
--    ativada (três travas independentes: sem agendamento; rotina que só age ativada; gatilho que barra a inserção de tarefa
--    automática com a régua desligada — vale mesmo se alguém reexecutar a 0105 sozinha).
-- 2) ATIVAÇÃO: só a administradora, por regua_tarefas_ativar(data_corte, limite, prioridade, executor). Antes, a prévia
--    (regua_tarefas_previa) mostra o que seria criado. Só entram cobranças que chegam à D+7 a partir da data de corte;
--    limite por execução; prioridade e executor definidos pelo Financeiro.
-- 3) ACUMULADO: as cobranças antigas (D+7 antes da data de corte) ficam fora da rotina. O Financeiro as revisa em
--    v_regua_acumulado e cria tarefas só para as que escolher, com responsável e prioridade (regua_tarefas_acumulado).

create table if not exists public.regua_tarefas_config (
  id boolean primary key default true check (id),
  ativa boolean not null default false,
  data_corte date,
  limite_por_execucao integer not null default 20 check (limite_por_execucao between 1 and 200),
  prioridade smallint not null default 2 check (prioridade between 1 and 3),
  executor_padrao_id uuid references public.colaboradores (id) on delete set null,
  atualizado_por uuid, atualizado_em timestamptz, observacao text);
insert into public.regua_tarefas_config (id) values (true) on conflict (id) do nothing;
alter table public.regua_tarefas_config enable row level security;
drop policy if exists regua_cfg_sel on public.regua_tarefas_config;
create policy regua_cfg_sel on public.regua_tarefas_config for select to authenticated using (public.pode_financeiro());
revoke all on public.regua_tarefas_config from anon;
-- (sem policy de escrita: só as funções abaixo mudam a configuração)

-- trava 3: com a régua desligada, nenhuma tarefa "Criada automaticamente pela régua" entra (descarta a linha, sem erro)
create or replace function public.tarefas_regua_trava_tg() returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) ->> 'cobranca_id') is not null and coalesce(new.descricao, '') like 'Criada automaticamente pela régua%' -- to_jsonb: não quebra a inclusão de tarefas num banco sem tarefas.cobranca_id (0098)
     and not coalesce((select ativa from public.regua_tarefas_config where id), false) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_regua_trava on public.tarefas;
create trigger tarefas_regua_trava before insert on public.tarefas for each row execute function public.tarefas_regua_trava_tg();

-- trava 2: a rotina só age com a régua ativada e só sobre o que chegou à D+7 a partir da data de corte, até o limite
create or replace function public.regua_tarefas_auto() returns integer language plpgsql security definer set search_path = public as $$
declare cfg public.regua_tarefas_config; r record; et public.regua_etapas; resp uuid; n integer := 0; tit text; k integer;
begin
  select * into cfg from public.regua_tarefas_config where id;
  if not found or not cfg.ativa or cfg.data_corte is null then return 0; end if;
  for r in select v.* from public.v_regua_cobranca v
            where not v.excluida and v.tarefas_abertas = 0
              and v.etapa in (select codigo from public.regua_etapas where ativa and tarefa_automatica)
              and (v.venc_ef + 7) >= cfg.data_corte
              and not exists (select 1 from public.tarefas t where t.cobranca_id = v.id and t.titulo like v.etapa || ' · %')
            order by v.venc_ef, v.id limit cfg.limite_por_execucao loop
    select * into et from public.regua_etapas where codigo = r.etapa;
    resp := coalesce(cfg.executor_padrao_id, et.executor_padrao_id);
    if resp is null and et.executor_nucleo is not null then resp := public.responsavel_padrao(et.executor_nucleo); end if;
    if resp is null then select id into resp from public.colaboradores where ativo and nucleo = 'socios' order by data_admissao nulls last limit 1; end if;
    tit := r.etapa || ' · ' || coalesce(et.acao, et.titulo) || ' · ' || coalesce(r.cliente_nome, 'cliente');
    insert into public.tarefas (titulo, descricao, cliente_id, cobranca_id, responsavel_id, nucleo, prazo, prioridade, status, prazo_fatal)
    values (tit, 'Criada automaticamente pela régua (' || r.etapa || '). ' || coalesce(r.parcela_txt, '') || ' · ' || to_char(r.valor, 'FM999G999G990D00') || ' · ' || r.dias_atraso || ' dia(s) de atraso.' || coalesce(E'\nFatura: ' || r.link_fatura, ''),
            r.cliente_id, r.id, resp, 'financeiro', (now() at time zone 'America/Sao_Paulo')::date, cfg.prioridade, 'aberta', false);
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke all on function public.regua_tarefas_auto() from public, anon, authenticated;

-- trava 1: sem agendamento até a ativação
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'regua_tarefas_auto';
exception when others then raise notice 'cron indisponível: %', sqlerrm; end $$;

-- o que a rotina criaria AGORA (sem criar nada), para o Financeiro conferir antes de ativar ou a cada mudança
create or replace function public.regua_tarefas_previa(p_data_corte date default null) returns table (cobranca_id uuid, cliente_nome text, etapa text, vencimento date, valor numeric, dias_atraso integer)
language sql stable security definer set search_path = public as $$
  select v.id, v.cliente_nome, v.etapa, v.venc_ef, v.valor, v.dias_atraso from public.v_regua_cobranca v
   where public.pode_financeiro() and not v.excluida and v.tarefas_abertas = 0
     and v.etapa in (select codigo from public.regua_etapas where ativa and tarefa_automatica)
     and (v.venc_ef + 7) >= coalesce(p_data_corte, (select data_corte from public.regua_tarefas_config where id), (now() at time zone 'America/Sao_Paulo')::date)
     and not exists (select 1 from public.tarefas t where t.cobranca_id = v.id and t.titulo like v.etapa || ' · %')
   order by v.venc_ef, v.id
$$;
revoke all on function public.regua_tarefas_previa(date) from public, anon;
grant execute on function public.regua_tarefas_previa(date) to authenticated;

-- acumulado: cobranças que já estavam na D+7 antes da data de corte (ou todas, com a régua desligada), sem tarefa aberta
create or replace view public.v_regua_acumulado with (security_invoker = true) as
select v.id as cobranca_id, v.cliente_id, v.cliente_nome, v.parcela_txt, v.venc_ef as vencimento, v.valor, v.dias_atraso, v.telefone, v.sem_contato, v.inadimplente_anterior
  from public.v_regua_cobranca v
 where not v.excluida and v.tarefas_abertas = 0 and v.etapa = 'D+7'
   and (v.venc_ef + 7) < coalesce((select case when c.ativa then c.data_corte end from public.regua_tarefas_config c where c.id), 'infinity'::date);
revoke all on public.v_regua_acumulado from anon;

create or replace function public.regua_tarefas_ativar(p_data_corte date default null, p_limite integer default 20, p_prioridade smallint default 2, p_executor uuid default null, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_data_corte, (now() at time zone 'America/Sao_Paulo')::date); n integer;
begin
  if not public.sou_admin() then raise exception 'Só a administradora ativa as tarefas automáticas da régua.' using errcode = '42501'; end if;
  if p_executor is not null and not exists (select 1 from public.colaboradores where id = p_executor and ativo) then raise exception 'Executor inválido ou inativo.' using errcode = '22023'; end if;
  update public.regua_tarefas_config set ativa = true, data_corte = d, limite_por_execucao = coalesce(p_limite, 20), prioridade = coalesce(p_prioridade, 2),
         executor_padrao_id = p_executor, atualizado_por = auth.uid(), atualizado_em = now(), observacao = p_observacao where id;
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'regua_tarefas_auto';
    perform cron.schedule('regua_tarefas_auto', '20 11 * * 1-5', $c$select public.regua_tarefas_auto()$c$);   -- 08:20 BRT, dias úteis
  exception when others then raise notice 'cron indisponível: %', sqlerrm; end;
  select count(*) into n from public.regua_tarefas_previa(d);
  insert into public.auditoria (usuario, tabela, registro, acao, depois) values (auth.uid(), 'regua_tarefas_config', 'true', 'ATIVAR', (select to_jsonb(c) from public.regua_tarefas_config c where c.id));
  return jsonb_build_object('ativa', true, 'data_corte', d, 'limite', coalesce(p_limite, 20), 'prioridade', coalesce(p_prioridade, 2), 'previstas_agora', n);
end $$;
revoke all on function public.regua_tarefas_ativar(date, integer, smallint, uuid, text) from public, anon;
grant execute on function public.regua_tarefas_ativar(date, integer, smallint, uuid, text) to authenticated;

create or replace function public.regua_tarefas_desativar(p_observacao text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_admin() then raise exception 'Só a administradora desativa as tarefas automáticas da régua.' using errcode = '42501'; end if;
  update public.regua_tarefas_config set ativa = false, atualizado_por = auth.uid(), atualizado_em = now(), observacao = p_observacao where id;
  begin perform cron.unschedule(jobid) from cron.job where jobname = 'regua_tarefas_auto'; exception when others then null; end;
  insert into public.auditoria (usuario, tabela, registro, acao, depois) values (auth.uid(), 'regua_tarefas_config', 'true', 'DESATIVAR', (select to_jsonb(c) from public.regua_tarefas_config c where c.id));
end $$;
revoke all on function public.regua_tarefas_desativar(text) from public, anon;
grant execute on function public.regua_tarefas_desativar(text) to authenticated;

-- acumulado validado: o Financeiro escolhe as cobranças, o responsável e a prioridade; idempotente (não repete tarefa)
create or replace function public.regua_tarefas_acumulado(p_cobrancas uuid[], p_responsavel uuid, p_prioridade smallint default 2) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_responsavel is null or not exists (select 1 from public.colaboradores where id = p_responsavel and ativo) then raise exception 'Informe um responsável ativo.' using errcode = '22023'; end if;
  if coalesce(p_prioridade, 2) not between 1 and 3 then raise exception 'Prioridade inválida.' using errcode = '22023'; end if;
  for r in select a.* from public.v_regua_acumulado a where a.cobranca_id = any (p_cobrancas)
             and not exists (select 1 from public.tarefas t where t.cobranca_id = a.cobranca_id and t.titulo like 'D+7 · %') loop
    insert into public.tarefas (titulo, descricao, cliente_id, cobranca_id, responsavel_id, nucleo, prazo, prioridade, status, prazo_fatal)
    values ('D+7 · Contato do supervisor · ' || coalesce(r.cliente_nome, 'cliente'),
            'Cobrança antiga (acumulado) validada pelo Financeiro. ' || coalesce(r.parcela_txt, '') || ' · ' || to_char(r.valor, 'FM999G999G990D00') || ' · ' || r.dias_atraso || ' dia(s) de atraso.',
            r.cliente_id, r.cobranca_id, p_responsavel, 'financeiro', (now() at time zone 'America/Sao_Paulo')::date, coalesce(p_prioridade, 2), 'aberta', false);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.regua_tarefas_acumulado(uuid[], uuid, smallint) from public, anon;
grant execute on function public.regua_tarefas_acumulado(uuid[], uuid, smallint) to authenticated;

select 'ok 0112' as resultado,
       (select ativa from public.regua_tarefas_config where id) as ativa,
       (select count(*) from cron.job where jobname = 'regua_tarefas_auto') as agendamento,
       (select count(*) from public.v_regua_acumulado) as acumulado;
