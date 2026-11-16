-- Matriz da 0111 (exclusão de clientes e bens). Banco descartável, depois de perfis-teste-ficticios.sql, 0111-preparo.sql e 0111.
-- "API" = o que o PostgREST faz: papel authenticated + request.jwt.claim.sub. 111 admin, 222 Acompanhamento PJ, 333 Acordos, 444 Jurídico.
create temp table r (n serial, caso text, esperado text, obtido text);
grant all on r to authenticated, anon; grant all on sequence r_n_seq to authenticated, anon;
create or replace function pg_temp.linhas(sql text) returns text language plpgsql as $$
declare n int; begin execute sql; get diagnostics n = row_count; return n || ' linha(s)'; exception when others then return 'ERRO ' || sqlstate; end $$;
create or replace function pg_temp.sessao(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into r (caso, esperado, obtido) values (c, e, o) $$;
create temp table antes as select (select count(*) from public.clientes) as clientes, (select count(*) from public.contratos where cliente_id = 'cli-0111-trab') as contratos,
  (select count(*) from public.atas_reuniao where cliente_id = 'cli-0111-trab') as atas, (select count(*) from public.entradas_timeline where cliente_id = 'cli-0111-trab') as entradas,
  (select count(*) from public.bens where cliente_id = 'cli-0111-trab') as bens;
grant select on antes to authenticated;

-- ===== Clientes pela API =====
set role authenticated;
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('C1 Acordos exclui cliente pela API', '0 linha(s)', pg_temp.linhas($q$delete from public.clientes where id = 'cli-0111-novo'$q$));
select pg_temp.sessao('44444444-4444-4444-4444-444444444444');
select pg_temp.reg('C2 Jurídico exclui cliente pela API', '0 linha(s)', pg_temp.linhas($q$delete from public.clientes where id = 'cli-0111-novo'$q$));
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('C3 Acompanhamento PJ exclui cliente pela API', '0 linha(s)', pg_temp.linhas($q$delete from public.clientes where id = 'cli-0111-novo'$q$));
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('C4 administradora exclui cliente pela API (sem policy de DELETE para ninguém)', '0 linha(s)', pg_temp.linhas($q$delete from public.clientes where id = 'cli-0111-dup'$q$));
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.reg('C5 anônimo exclui cliente', 'recusado', (select case when x in ('0 linha(s)', 'ERRO 42501') then 'recusado' else x end from pg_temp.linhas($q$delete from public.clientes where id = 'cli-0111-novo'$q$) as x));
reset role;
select pg_temp.reg('C6 dono do banco (SQL Editor / service role) exclui fora da função: guarda recusa', 'ERRO 42501', pg_temp.linhas($q$delete from public.clientes where id = 'cli-0111-dup'$q$));
-- ===== Encerrar (inativar) continua com a equipe e preserva tudo =====
set role authenticated; select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('C7 Acordos encerra cliente (status Encerrado)', '1 linha(s)', pg_temp.linhas($q$update public.clientes set status = 'encerrado' where id = 'cli-0111-novo'$q$));
-- ===== Exclusão definitiva (função) =====
select pg_temp.reg('C8 Acordos chama a exclusão definitiva', 'ERRO 42501', pg_temp.linhas($q$select public.cliente_excluir_definitivo('cli-0111-dup', 'cadastro duplicado por engano')$q$));
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('C9 Acompanhamento PJ chama a exclusão definitiva', 'ERRO 42501', pg_temp.linhas($q$select public.cliente_excluir_definitivo('cli-0111-dup', 'cadastro duplicado por engano')$q$));
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('C10 administradora sem motivo suficiente', 'ERRO 22023', pg_temp.linhas($q$select public.cliente_excluir_definitivo('cli-0111-dup', 'engano')$q$));
update public.clientes set status = 'ativo' where id = 'cli-0111-novo';
select pg_temp.reg('C11 administradora: cliente não encerrado', 'ERRO 22023', pg_temp.linhas($q$select public.cliente_excluir_definitivo('cli-0111-novo', 'cadastro duplicado por engano')$q$));
select pg_temp.reg('C12 administradora: cliente com trabalho (contrato, ata, dossiê, bens) é recusado', 'ERRO 23503', pg_temp.linhas($q$select public.cliente_excluir_definitivo('cli-0111-trab', 'tentativa de excluir cliente com histórico')$q$));
select pg_temp.reg('C13 administradora: cadastro feito por engano (só registros do sistema) é excluído', '1 linha(s)', pg_temp.linhas($q$select public.cliente_excluir_definitivo('cli-0111-dup', 'cadastro duplicado por engano (teste)')$q$));
reset role;
select pg_temp.reg('C12b nada do cliente com trabalho mudou', 'true', (select ((select count(*) from public.contratos where cliente_id = 'cli-0111-trab') = a.contratos and (select count(*) from public.atas_reuniao where cliente_id = 'cli-0111-trab') = a.atas and (select count(*) from public.entradas_timeline where cliente_id = 'cli-0111-trab') = a.entradas and (select count(*) from public.bens where cliente_id = 'cli-0111-trab') = a.bens and exists (select 1 from public.clientes where id = 'cli-0111-trab'))::text from antes a));
select pg_temp.reg('C13b cliente duplicado e o que o sistema criou para ele saíram', '0|0|0', (select (select count(*) from public.clientes where id = 'cli-0111-dup') || '|' || (select count(*) from public.tarefas where cliente_id = 'cli-0111-dup') || '|' || (select count(*) from public.entradas_timeline where cliente_id = 'cli-0111-dup')));
select pg_temp.reg('C13c auditoria: instantâneo com motivo e o cliente; marcador da função limpo', 'true|cadastro duplicado por engano (teste)|true|',
  (select (antes ? 'dependentes')::text || '|' || (depois ->> 'motivo') || '|' || ((antes -> 'cliente' ->> 'id') = 'cli-0111-dup')::text || '|' || coalesce(current_setting('np.cliente_exclusao', true), '')
     from public.auditoria where tabela = 'clientes' and registro = 'cli-0111-dup' and acao = 'EXCLUSAO_DEFINITIVA'));
select pg_temp.reg('C13d auditoria guarda as tarefas e entradas automáticas removidas', 'true', (select ((antes -> 'dependentes' ? 'tarefas.cliente_id') and (antes -> 'dependentes' ? 'entradas_timeline.cliente_id'))::text from public.auditoria where tabela = 'clientes' and registro = 'cli-0111-dup' and acao = 'EXCLUSAO_DEFINITIVA'));
select pg_temp.reg('C14 tentativas recusadas não deixaram exclusão na auditoria (só a do duplicado)', 'cli-0111-dup DELETE|cli-0111-dup EXCLUSAO_DEFINITIVA', (select string_agg(registro || ' ' || acao, '|' order by acao) from public.auditoria where tabela = 'clientes' and acao in ('DELETE', 'EXCLUSAO_DEFINITIVA') and registro in ('cli-0111-novo', 'cli-0111-trab', 'cli-0111-dup')));
select pg_temp.reg('C15 dependentes do cliente com trabalho (o que impede a exclusão)', 'atas_reuniao,bens,contratos,entradas_timeline',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.cliente_dependentes('cli-0111-trab')) as k));

-- ===== Bens =====
set role authenticated;
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('B1 Acordos exclui bem exposto', '0 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000111'$q$));
select pg_temp.reg('B2 Acordos inclui e edita bem (continua como hoje)', '1 linha(s)|1 linha(s)', pg_temp.linhas($q$insert into public.bens (id, cliente_id, tipo, descricao, titular) values ('b0000000-0000-0000-0000-000000000119', 'cli-0111-trab', 'outro', 'Bem incluído por Acordos (fictício)', 'PJ')$q$) || '|' || pg_temp.linhas($q$update public.bens set observacoes = 'editado por Acordos' where id = 'b0000000-0000-0000-0000-000000000119'$q$));
select pg_temp.reg('B3 Acordos altera a proteção (0092 inalterada)', 'ERRO P0001', pg_temp.linhas($q$update public.bens set protecao = 'em_protecao' where id = 'b0000000-0000-0000-0000-000000000114'$q$));
select pg_temp.sessao('44444444-4444-4444-4444-444444444444');
select pg_temp.reg('B4 Jurídico exclui bem exposto', '0 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000111'$q$));
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('B5 Acompanhamento PJ exclui bem exposto', '1 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000111'$q$));
select pg_temp.reg('B6 Acompanhamento PJ exclui bem protegido pela API', '0 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000112'$q$));
select pg_temp.reg('B7 Acompanhamento PJ exclui bem em proteção pela API', '0 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000113'$q$));
select pg_temp.reg('B8 Acompanhamento PJ rebaixa bem em proteção para exposto', 'ERRO 42501', pg_temp.linhas($q$update public.bens set protecao = 'exposto' where id = 'b0000000-0000-0000-0000-000000000113'$q$));
select pg_temp.reg('B9 Acompanhamento PJ coloca bem exposto em proteção e o conclui (avançar continua livre)', '1 linha(s)|1 linha(s)', pg_temp.linhas($q$update public.bens set protecao = 'em_protecao' where id = 'b0000000-0000-0000-0000-000000000114'$q$) || '|' || pg_temp.linhas($q$update public.bens set protecao = 'protegido' where id = 'b0000000-0000-0000-0000-000000000114'$q$));
select pg_temp.reg('B10 Acompanhamento PJ chama a exclusão autorizada', 'ERRO 42501', pg_temp.linhas($q$select public.bem_excluir_protegido('b0000000-0000-0000-0000-000000000112', 'motivo qualquer de teste')$q$));
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('B11 administradora exclui bem protegido pela API', '0 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000112'$q$));
select pg_temp.reg('B12 administradora: exclusão autorizada sem motivo suficiente', 'ERRO 22023', pg_temp.linhas($q$select public.bem_excluir_protegido('b0000000-0000-0000-0000-000000000112', 'curto')$q$));
select pg_temp.reg('B13 administradora: exclusão autorizada de bem que não está em proteção', 'ERRO 22023', pg_temp.linhas($q$select public.bem_excluir_protegido('b0000000-0000-0000-0000-000000000119', 'teste de bem exposto')$q$));
select pg_temp.reg('B14 administradora: exclusão autorizada de bem protegido, com motivo', '1 linha(s)', pg_temp.linhas($q$select public.bem_excluir_protegido('b0000000-0000-0000-0000-000000000112', 'bem vendido antes da proteção (teste)')$q$));
select pg_temp.reg('B15 administradora rebaixa bem em proteção (permitido)', '1 linha(s)', pg_temp.linhas($q$update public.bens set protecao = 'exposto' where id = 'b0000000-0000-0000-0000-000000000115'$q$));
select pg_temp.reg('B16 administradora exclui bem exposto pela API', '1 linha(s)', pg_temp.linhas($q$delete from public.bens where id = 'b0000000-0000-0000-0000-000000000115'$q$));
reset role;
select pg_temp.reg('B14b auditoria: EXCLUSAO_AUTORIZADA com motivo + DELETE; registro interno no dossiê (Estratégico)', 'bem vendido antes da proteção (teste)|1|estrategico false',
  (select (select depois ->> 'motivo' from public.auditoria where tabela = 'bens' and registro = 'b0000000-0000-0000-0000-000000000112' and acao = 'EXCLUSAO_AUTORIZADA') || '|' ||
          (select count(*) from public.auditoria where tabela = 'bens' and registro = 'b0000000-0000-0000-0000-000000000112' and acao = 'DELETE') || '|' ||
          (select frente || ' ' || visivel_cliente from public.entradas_timeline where cliente_id = 'cli-0111-trab' and descricao like 'Bem em proteção excluído%' order by created_at desc limit 1)));
select pg_temp.reg('B17 bens que restaram no cliente com trabalho', 'em_protecao,protegido', (select string_agg(protecao, ',' order by protecao) from public.bens where id in ('b0000000-0000-0000-0000-000000000113', 'b0000000-0000-0000-0000-000000000114')));
select pg_temp.reg('B18 anônimo sem EXECUTE nas funções novas; autenticado com', 'false|false|true|true',
  (select has_function_privilege('anon', 'public.cliente_excluir_definitivo(text,text)', 'execute') || '|' || has_function_privilege('anon', 'public.bem_excluir_protegido(uuid,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.cliente_excluir_definitivo(text,text)', 'execute') || '|' || has_function_privilege('authenticated', 'public.bem_excluir_protegido(uuid,text)', 'execute')));

select n, caso, esperado, obtido, case when esperado = obtido then 'ok' else 'FALHA' end as res from r order by n;
select count(*) filter (where esperado = obtido) || '/' || count(*) as resumo from r;
