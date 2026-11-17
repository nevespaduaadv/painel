-- Matriz da 0112 (depois de 0112-preparo.sql e de 0105+0112 numa transação só). Sessões simuladas como o PostgREST faz.
-- 111 administradora · 666 Financeiro (acesso financeiro) · 333 Acordos.
create temp table r (n serial, caso text, esperado text, obtido text);
grant all on r to authenticated; grant all on sequence r_n_seq to authenticated;
create or replace function pg_temp.res(sql text) returns text language plpgsql as $$
declare v text; begin execute sql into v; return coalesce(v, 'null'); exception when others then return 'ERRO ' || sqlstate; end $$;
create or replace function pg_temp.sessao(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into r (caso, esperado, obtido) values (c, e, o) $$;
create or replace function pg_temp.auto() returns bigint language sql as $$ select count(*) from public.tarefas where descricao like 'Criada automaticamente pela régua%' $$;
create or replace function pg_temp.nova(n int, delta int) returns void language sql as $$
  insert into public.cobrancas (id, cliente_id, tipo, descricao, valor, vencimento, status, origem)
  values (('c0000000-0000-0000-0000-0000000013' || lpad(n::text, 2, '0'))::uuid, 'cli-0112-a', 'mensalidade', 'nova ' || n, 1000 + n, (now() at time zone 'America/Sao_Paulo')::date + delta, 'atrasada', 'painel') $$;

-- ===== 1. Instalação =====
select pg_temp.reg('I1 depois da instalação: régua desligada, sem agendamento, nenhuma tarefa automática', 'false|0|0', (select (select ativa::text from public.regua_tarefas_config where id) || '|' || (select count(*) from cron.job where jobname = 'regua_tarefas_auto') || '|' || pg_temp.auto()));
select pg_temp.reg('I2 rotina executada (como o pg_cron faria): cria 0', '0', (select public.regua_tarefas_auto()::text));
select pg_temp.reg('I3 segunda execução: cria 0', '0|0', (select public.regua_tarefas_auto()::text || '|' || pg_temp.auto()));
select pg_temp.reg('I4 o acumulado (D+7 antigas sem tarefa aberta) fica visível para conferência: 11', '11', (select count(*)::text from public.v_regua_acumulado));
set role authenticated; select pg_temp.sessao('66666666-6666-6666-6666-666666666666');
select pg_temp.reg('I5 Financeiro: prévia com a data de corte de hoje = 0 (acumulado fora)', '0', (select count(*)::text from public.regua_tarefas_previa()));
select pg_temp.reg('I6 Financeiro: prévia se a data de corte fosse antiga = 11 (o que a 0105 sozinha faria)', '11', (select count(*)::text from public.regua_tarefas_previa('2000-01-01')));
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('I7 Acordos: prévia vazia (sem acesso financeiro)', '0', (select count(*)::text from public.regua_tarefas_previa('2000-01-01')));
select pg_temp.reg('I8 Acordos: não lê nem muda a configuração', '0|ERRO 42501', (select count(*)::text from public.regua_tarefas_config) || '|' || pg_temp.res($q$select public.regua_tarefas_ativar()::text$q$));
select pg_temp.sessao('66666666-6666-6666-6666-666666666666');
select pg_temp.reg('I9 Financeiro não ativa sozinho (decisão da administradora)', 'ERRO 42501', pg_temp.res($q$select public.regua_tarefas_ativar()::text$q$));
reset role;

-- ===== 2. Ativação controlada =====
set role authenticated; select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('A1 administradora ativa com corte hoje, executor Financeiro T, prioridade normal: previstas agora = 0', '0|2',
  pg_temp.res($q$select (public.regua_tarefas_ativar(null, 20, 2::smallint, 'a6666666-6666-6666-6666-666666666666', 'teste'))->>'previstas_agora'$q$) || '|' || (select prioridade::text from public.regua_tarefas_config where id));
reset role;
select pg_temp.reg('A2 agendamento criado só agora (08h20 BRT dias úteis)', '1 20 11 * * 1-5', (select count(*) || ' ' || min(schedule) from cron.job where jobname = 'regua_tarefas_auto'));
select pg_temp.reg('A3 rotina ativada sobre o acumulado: 0 (antigas ficam fora)', '0', (select public.regua_tarefas_auto()::text));
select pg_temp.nova(1, -7);
select pg_temp.reg('A4 cobrança que chega à D+7 hoje: a rotina cria 1', '1', (select public.regua_tarefas_auto()::text));
select pg_temp.reg('A4b a tarefa: prioridade 2 e o executor definido', '2|Financeiro T', (select t.prioridade::text || '|' || c.nome from public.tarefas t join public.colaboradores c on c.id = t.responsavel_id where t.cobranca_id = 'c0000000-0000-0000-0000-000000001301'));
select pg_temp.reg('A5 segunda execução no mesmo dia: 0', '0', (select public.regua_tarefas_auto()::text));
set role authenticated; select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('A6 nova ativação: corte há 3 dias, limite 2 por execução', 'true', pg_temp.res($q$select ((public.regua_tarefas_ativar(((now() at time zone 'America/Sao_Paulo')::date - 3), 2, 2::smallint, 'a6666666-6666-6666-6666-666666666666'))->>'ativa')$q$));
reset role;
select pg_temp.nova(2, -8); select pg_temp.nova(3, -9); select pg_temp.nova(4, -10);
select pg_temp.reg('A7 limite por execução: 2, depois 1, depois 0', '2|1|0', (select public.regua_tarefas_auto()::text) || '|' || (select public.regua_tarefas_auto()::text) || '|' || (select public.regua_tarefas_auto()::text));
select pg_temp.reg('A8 o acumulado continua intocado pela rotina', '0', (select count(*)::text from public.tarefas where cobranca_id::text like 'c0000000-0000-0000-0000-0000000012%' and descricao like 'Criada automaticamente%'));

-- ===== 3. Acumulado validado pelo Financeiro =====
set role authenticated; select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('B1 Acordos tenta criar tarefas do acumulado', 'ERRO 42501', pg_temp.res($q$select public.regua_tarefas_acumulado(array['c0000000-0000-0000-0000-000000001201']::uuid[], 'a1111111-1111-1111-1111-111111111111')::text$q$));
select pg_temp.sessao('66666666-6666-6666-6666-666666666666');
select pg_temp.reg('B2 Financeiro sem responsável', 'ERRO 22023', pg_temp.res($q$select public.regua_tarefas_acumulado(array['c0000000-0000-0000-0000-000000001201']::uuid[], null)::text$q$));
select pg_temp.reg('B3 Financeiro escolhe 3 cobranças antigas, responsável Admin T, prioridade 3', '3', pg_temp.res($q$select public.regua_tarefas_acumulado(array['c0000000-0000-0000-0000-000000001201','c0000000-0000-0000-0000-000000001202','c0000000-0000-0000-0000-000000001203']::uuid[], 'a1111111-1111-1111-1111-111111111111', 3::smallint)::text$q$));
select pg_temp.reg('B4 mesmas cobranças de novo: 0 (não repete)', '0', pg_temp.res($q$select public.regua_tarefas_acumulado(array['c0000000-0000-0000-0000-000000001201','c0000000-0000-0000-0000-000000001202','c0000000-0000-0000-0000-000000001203']::uuid[], 'a1111111-1111-1111-1111-111111111111', 3::smallint)::text$q$));
select pg_temp.reg('B5 a cobrança que já tinha tarefa aberta não recebe outra', '0', pg_temp.res($q$select public.regua_tarefas_acumulado(array['c0000000-0000-0000-0000-000000001212']::uuid[], 'a1111111-1111-1111-1111-111111111111')::text$q$));
reset role;
select pg_temp.reg('B6 tarefas do acumulado: prioridade 3, Admin T, fora da trava', '3|3|Admin T', (select count(*) || '|' || min(t.prioridade) || '|' || min(c.nome) from public.tarefas t join public.colaboradores c on c.id = t.responsavel_id where t.descricao like 'Cobrança antiga (acumulado)%'));
select pg_temp.reg('B7 acumulado restante para conferência (sem tarefa aberta)', '8', (select count(*)::text from public.v_regua_acumulado));

-- ===== 4. Desativação =====
set role authenticated; select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('D1 administradora desativa', 'ok', pg_temp.res($q$select 'ok' from (select public.regua_tarefas_desativar('teste')) x$q$));
reset role;
select pg_temp.nova(5, -5); update public.cobrancas set vencimento = (now() at time zone 'America/Sao_Paulo')::date - 7 where id = 'c0000000-0000-0000-0000-000000001305';
select pg_temp.reg('D2 desativada: sem agendamento e a rotina cria 0 mesmo com cobrança nova na D+7', '0|0', (select (select count(*) from cron.job where jobname = 'regua_tarefas_auto') || '|' || public.regua_tarefas_auto()));
select pg_temp.reg('D3 auditoria registra ativações e desativação', 'ATIVAR|ATIVAR|DESATIVAR', (select string_agg(acao, '|' order by id) from public.auditoria where tabela = 'regua_tarefas_config'));
select pg_temp.reg('D4 total de tarefas automáticas criadas no teste inteiro (1 + 3)', '4', (select pg_temp.auto()::text));

select n, caso, esperado, obtido, case when esperado = obtido then 'ok' else 'FALHA' end as res from r order by n;
select count(*) filter (where esperado = obtido) || '/' || count(*) as resumo from r;
