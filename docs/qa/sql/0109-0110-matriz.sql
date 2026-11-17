-- Matriz da 0109 (autoria/auditoria do ciclo e do Raio-X) e da 0110 (frente da ata de Acordos). Banco descartável,
-- depois de 0109-preparo-historico.sql, 0109 e 0110. Sessões simuladas por request.jwt.claim.sub (papel authenticated),
-- como o PostgREST faz. Perfis fictícios de perfis-teste-ficticios.sql: 111 admin, 222 Acompanhamento PJ (estratégico),
-- 333 Acordos, 444 Jurídico. Cada caso registra esperado × obtido.
create temp table r (n serial, caso text, esperado text, obtido text);
grant all on r to authenticated; grant all on sequence r_n_seq to authenticated;
create or replace function pg_temp.linhas(sql text) returns text language plpgsql as $$
declare n int; begin execute sql; get diagnostics n = row_count; return n || ' linha(s)'; exception when others then return 'NEGADO ' || sqlstate; end $$;
create or replace function pg_temp.sessao(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into r (caso, esperado, obtido) values (c, e, o) $$;

-- ===== 0109: histórico não é inventado =====
select pg_temp.reg('A1 ciclo histórico continua sem criação nem autor', 'null|null',
  (select coalesce(created_at::text, 'null') || '|' || coalesce(created_by::text, 'null') from public.acompanhamento_pj where cliente_id = 'cli-0108-a'));
select pg_temp.reg('A1b dívida histórica continua sem autor', 'null',
  (select coalesce(created_by::text, 'null') from public.dividas_raio_x where id = 'e0000000-0000-0000-0000-0000000000d1'));

set role authenticated;
-- ===== Acompanhamento PJ (pode gravar) =====
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('A2 Acompanhamento altera o ciclo histórico', '1 linha(s)', pg_temp.linhas($q$update public.acompanhamento_pj set observacoes = 'alterado pela 222' where cliente_id = 'cli-0108-a'$q$));
select pg_temp.reg('A3 Acompanhamento cria ciclo de outro cliente', '1 linha(s)', pg_temp.linhas($q$insert into public.acompanhamento_pj (cliente_id, fase) values ('cli-0109-b', 'onboarding')$q$));
select pg_temp.reg('A4 Acompanhamento inclui dívida enviando created_by de outra pessoa', '1 linha(s)', pg_temp.linhas($q$insert into public.dividas_raio_x (id, cliente_id, banco, valor, created_by, created_at) values ('e0000000-0000-0000-0000-0000000000d2', 'cli-0108-a', 'BANCO NOVO', 500, '11111111-1111-1111-1111-111111111111', '2020-01-01')$q$));
select pg_temp.reg('A5 Acompanhamento tenta trocar autor/criação da dívida', '1 linha(s)', pg_temp.linhas($q$update public.dividas_raio_x set valor = 600, created_by = '11111111-1111-1111-1111-111111111111', created_at = '2020-01-01' where id = 'e0000000-0000-0000-0000-0000000000d2'$q$));
select pg_temp.reg('A6 Acompanhamento altera a dívida histórica', '1 linha(s)', pg_temp.linhas($q$update public.dividas_raio_x set observacoes = 'revisada pela 222' where id = 'e0000000-0000-0000-0000-0000000000d1'$q$));
-- ===== Acordos e Jurídico (não gravam ciclo/Raio-X: RLS da 0104) =====
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('A7 Acordos tenta alterar o ciclo', '0 linha(s)', pg_temp.linhas($q$update public.acompanhamento_pj set observacoes = 'indevido' where cliente_id = 'cli-0108-a'$q$));
select pg_temp.reg('A8 Acordos tenta incluir dívida', 'NEGADO 42501', pg_temp.linhas($q$insert into public.dividas_raio_x (cliente_id, banco, valor) values ('cli-0108-a', 'INDEVIDO', 1)$q$));
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('A9 Acompanhamento exclui a dívida nova', '1 linha(s)', pg_temp.linhas($q$delete from public.dividas_raio_x where id = 'e0000000-0000-0000-0000-0000000000d2'$q$));
reset role;

-- ===== 0109: o que ficou gravado (dono do banco) =====
select pg_temp.reg('A2b ciclo histórico: updated_by = sessão; criação continua não registrada (não inventada)', '22222222|null|null',
  (select left(updated_by::text, 8) || '|' || coalesce(created_at::text, 'null') || '|' || coalesce(created_by::text, 'null') from public.acompanhamento_pj where cliente_id = 'cli-0108-a'));
select pg_temp.reg('A3b ciclo novo: criação e autor da sessão', '22222222|true|22222222',
  (select left(created_by::text, 8) || '|' || (created_at is not null) || '|' || left(updated_by::text, 8) from public.acompanhamento_pj where cliente_id = 'cli-0109-b'));
select pg_temp.reg('A6b dívida histórica: autor continua nulo; atualização registrada', 'null|22222222',
  (select coalesce(created_by::text, 'null') || '|' || left(updated_by::text, 8) from public.dividas_raio_x where id = 'e0000000-0000-0000-0000-0000000000d1'));
select pg_temp.reg('A10 auditoria do ciclo (registro = cliente): UPDATE do histórico e INSERT do novo, pela 222', 'UPDATE cli-0108-a 22222222|INSERT cli-0109-b 22222222',
  (select string_agg(acao || ' ' || registro || ' ' || left(usuario::text, 8), '|' order by quando, acao desc) from public.auditoria where tabela = 'acompanhamento_pj'));
select pg_temp.reg('A11 auditoria da dívida nova: INSERT (autor forjado já trocado), UPDATE (antes 500 → 600), DELETE', 'INSERT 22222222 22222222|UPDATE 500.00 600.00|DELETE 600.00 -',
  (select string_agg(acao || ' ' || case acao when 'INSERT' then left(usuario::text, 8) || ' ' || left(depois ->> 'created_by', 8)
                                                  when 'UPDATE' then (antes ->> 'valor') || ' ' || (depois ->> 'valor')
                                                  else (antes ->> 'valor') || ' -' end, '|' order by quando, n_ord)
     from (select *, case acao when 'INSERT' then 1 when 'UPDATE' then 2 else 3 end as n_ord from public.auditoria where tabela = 'dividas_raio_x' and registro = 'e0000000-0000-0000-0000-0000000000d2') x));
select pg_temp.reg('A12 tentativas negadas não geram auditoria (Acordos)', '0',
  (select count(*)::text from public.auditoria where tabela in ('acompanhamento_pj', 'dividas_raio_x') and usuario = '33333333-3333-3333-3333-333333333333'));
-- rotina sem sessão (cron/funções do banco): mantém o autor enviado, updated_by nulo
select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);
insert into public.dividas_raio_x (id, cliente_id, banco, valor, created_by) values ('e0000000-0000-0000-0000-0000000000d3', 'cli-0108-a', 'ROTINA', 1, '11111111-1111-1111-1111-111111111111');
select pg_temp.reg('A13 sem sessão: autor enviado mantido, updated_by nulo', '11111111|null',
  (select left(created_by::text, 8) || '|' || coalesce(updated_by::text, 'null') from public.dividas_raio_x where id = 'e0000000-0000-0000-0000-0000000000d3'));
delete from public.dividas_raio_x where id = 'e0000000-0000-0000-0000-0000000000d3';

-- ===== 0110: frente da ata no dossiê =====
create temp table frentes_antes as select id, frente from public.entradas_timeline where ata_origem_id is not null;
set role authenticated;
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('F1 Acordos registra ata', '1 linha(s)', pg_temp.linhas($q$insert into public.atas_reuniao (id, cliente_id, tipo, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000f1', 'cli-0108-a', 'outra', 'Ata de Acordos', 'negociação com o banco')$q$));
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('F2 Acompanhamento registra ata', '1 linha(s)', pg_temp.linhas($q$insert into public.atas_reuniao (id, cliente_id, tipo, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000f2', 'cli-0108-a', 'r1', 'R1', 'reunião R1')$q$));
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('F3 administradora (sócios) registra ata', '1 linha(s)', pg_temp.linhas($q$insert into public.atas_reuniao (id, cliente_id, tipo, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000f3', 'cli-0108-a', 'estrategia', 'Estratégia', 'núcleo de estratégia')$q$));
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('F4 Acordos edita a própria ata', '1 linha(s)', pg_temp.linhas($q$update public.atas_reuniao set resumo = 'negociação com o banco (revisada)' where id = 'd0000000-0000-0000-0000-0000000000f1'$q$));
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('F5 administradora exclui a ata de Acordos', '1 linha(s)', pg_temp.linhas($q$delete from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000f1'$q$));
reset role;
select pg_temp.reg('F1b ata de Acordos → frente negocial', 'negocial', (select frente from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000f1'));
select pg_temp.reg('F2b ata de Acompanhamento → estratégico', 'estrategico', (select frente from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000f2'));
select pg_temp.reg('F3b ata da administradora → estratégico', 'estrategico', (select frente from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000f3'));
select pg_temp.reg('F4b edição mantém a frente e sobe a versão; exclusão marca e preserva', 'negocial|2|true',
  (select frente || '|' || ata_versao || '|' || (ata_excluida_em is not null) from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000f1'));
select pg_temp.reg('F6 entradas anteriores à 0110 com a frente intacta', '0',
  (select count(*)::text from frentes_antes a join public.entradas_timeline e on e.id = a.id where e.frente is distinct from a.frente));
select pg_temp.reg('F7 visão de inconsistências sem itens novos das atas F1–F3', '0',
  (select count(*)::text from public.v_dossie_atas_inconsistencias where ata_id in ('d0000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-0000000000f2','d0000000-0000-0000-0000-0000000000f3')));
select pg_temp.reg('F8 anon sem EXECUTE em ata_frente; authenticated com', 'false|true',
  (select has_function_privilege('anon', 'public.ata_frente(uuid)', 'execute') || '|' || has_function_privilege('authenticated', 'public.ata_frente(uuid)', 'execute')));

select n, caso, esperado, obtido, case when esperado = obtido then 'ok' else 'FALHA' end as res from r order by n;
select count(*) filter (where esperado = obtido) || '/' || count(*) as resumo from r;
