-- Matriz da 0108 (banco descartável, depois de 0108-preparo-historico.sql e da 0108). Sessões simuladas por
-- request.jwt.claim.sub com o papel authenticated, como o PostgREST faz. Cada caso registra esperado × obtido.
create temp table r (n serial, caso text, esperado text, obtido text);
grant all on r to authenticated; grant all on sequence r_n_seq to authenticated;
create or replace function pg_temp.tenta(sql text) returns text language plpgsql as $$
begin execute sql; return 'OK'; exception when others then return 'NEGADO ' || sqlstate; end $$;
create or replace function pg_temp.linhas(sql text) returns text language plpgsql as $$
declare n int; begin execute sql; get diagnostics n = row_count; return n || ' linha(s)'; exception when others then return 'NEGADO ' || sqlstate; end $$;
create or replace function pg_temp.sessao(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into r (caso, esperado, obtido) values (c, e, o) $$;

-- ===== reconciliação (verificada como dono do banco) =====
select pg_temp.reg('R1 H1 (normal) vinculada', '1', (select count(*)::text from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000a1'));
select pg_temp.reg('R2 H3/H4 (mesma transação) sem vínculo', '0', (select count(*)::text from public.entradas_timeline where ata_origem_id in ('d0000000-0000-0000-0000-0000000000a3','d0000000-0000-0000-0000-0000000000a4')));
select pg_temp.reg('R3 entrada manual "Ata — " sem vínculo', '1', (select count(*)::text from public.entradas_timeline where descricao = 'Ata — manual sem ata' and ata_origem_id is null));
select pg_temp.reg('R4 inconsistências listadas (H2 sem registro, H3, H4 sem registro, 2 entradas ambíguas, 1 manual)', '6', (select count(*)::text from public.v_dossie_atas_inconsistencias where cliente_id = 'cli-0108-a'));
select pg_temp.reg('R5 C1 (cascata) vinculada', '1', (select count(*)::text from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000c1'));

set role authenticated;
-- ===== criação e vínculo =====
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('T1 Acompanhamento cria ata', 'OK', pg_temp.tenta($q$insert into public.atas_reuniao (id, cliente_id, tipo, data, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000b1','cli-0108-a','r3',current_date,'T1','criada após a 0108')$q$));
reset role;
select pg_temp.reg('T1b entrada vinculada, versão 1, autoria da sessão, texto reconstruído', '1|1|22222222|true',
  (select count(*)||'|'||min(ata_versao)||'|'||left(min(created_by::text),8)||'|'||bool_and(descricao = (select public.ata_texto_dossie(a) from public.atas_reuniao a where a.id = 'd0000000-0000-0000-0000-0000000000b1'))
     from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'));
set role authenticated;

-- ===== manipulação direta da timeline pela API (Jurídico comum: equipe, tl_wr permite tudo) =====
select pg_temp.sessao('44444444-4444-4444-4444-444444444444');
select pg_temp.reg('T2 UPDATE da descrição da entrada vinculada', 'NEGADO 42501', pg_temp.tenta($q$update public.entradas_timeline set descricao = 'adulterada' where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T3 DELETE da entrada vinculada', 'NEGADO 42501', pg_temp.tenta($q$delete from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T4 desfazer o vínculo (ata_origem_id = null)', 'NEGADO 42501', pg_temp.tenta($q$update public.entradas_timeline set ata_origem_id = null where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T5 INSERT forjado com o id de uma ata existente', 'NEGADO 42501', pg_temp.tenta($q$insert into public.entradas_timeline (cliente_id, data, tipo, descricao, frente, ata_origem_id) values ('cli-0108-a', current_date, 'ata', 'falsa', 'estrategico', 'd0000000-0000-0000-0000-0000000000b1')$q$));
select pg_temp.reg('T6 INSERT forjado com id inventado', 'NEGADO 42501', pg_temp.tenta($q$insert into public.entradas_timeline (cliente_id, data, tipo, descricao, frente, ata_origem_id) values ('cli-0108-a', current_date, 'ata', 'falsa', 'estrategico', gen_random_uuid())$q$));
select set_config('np.ata_sync', 'd0000000-0000-0000-0000-0000000000b1', false);  -- marcador forjado na própria sessão
select pg_temp.reg('T7 marcador de sincronização forjado na sessão', 'NEGADO 42501', pg_temp.tenta($q$update public.entradas_timeline set descricao = 'adulterada' where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select set_config('np.ata_sync', '', false);
select pg_temp.reg('T8 trocar o cliente da entrada vinculada', 'NEGADO 42501', pg_temp.tenta($q$update public.entradas_timeline set cliente_id = 'cli-0108-cascata' where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T9 fixar a entrada vinculada (apresentação)', '1 linha(s)', pg_temp.linhas($q$update public.entradas_timeline set fixado = true where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T10 entrada comum continua editável e excluível', '1 linha(s)', pg_temp.linhas($q$update public.entradas_timeline set descricao = 'registro comum editado' where id = 'e0000000-0000-0000-0000-0000000000e1'$q$));
select pg_temp.reg('T11 Jurídico não edita ata (RLS)', '0 linha(s)', pg_temp.linhas($q$update public.atas_reuniao set resumo = 'x' where id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T12 Jurídico não exclui ata (RLS)', '0 linha(s)', pg_temp.linhas($q$delete from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T13 Jurídico não lê a visão de inconsistências', 'NEGADO 42501', pg_temp.tenta($q$select count(*) from public.v_dossie_atas_inconsistencias$q$));

-- ===== edição pelo autor (estágio 2) e sincronização =====
select pg_temp.sessao('33333333-3333-3333-3333-333333333333');
select pg_temp.reg('T14 Acordos cria ata', 'OK', pg_temp.tenta($q$insert into public.atas_reuniao (id, cliente_id, tipo, data, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000b2','cli-0108-a','mensal',current_date,'T14','de Acordos')$q$));
select pg_temp.reg('T15 autor edita a própria ata', '1 linha(s)', pg_temp.linhas($q$update public.atas_reuniao set resumo = 'de Acordos, revisada', data = current_date - 1 where id = 'd0000000-0000-0000-0000-0000000000b2'$q$));
select pg_temp.reg('T16 autor tenta trocar autor e cliente', '1 linha(s)', pg_temp.linhas($q$update public.atas_reuniao set autor_id = 'a2222222-2222-2222-2222-222222222222', cliente_id = 'cli-0108-cascata' where id = 'd0000000-0000-0000-0000-0000000000b2'$q$));
select pg_temp.reg('T17 Acordos não edita ata de outro autor', '0 linha(s)', pg_temp.linhas($q$update public.atas_reuniao set resumo = 'x' where id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('T18 condução (Acompanhamento) edita ata de Acordos', '1 linha(s)', pg_temp.linhas($q$update public.atas_reuniao set titulo = 'T14 revista' where id = 'd0000000-0000-0000-0000-0000000000b2'$q$));
select pg_temp.reg('T19 Acompanhamento não exclui ata (só admin)', '0 linha(s)', pg_temp.linhas($q$delete from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
reset role;
select pg_temp.reg('T20 autor e cliente imutáveis', 'a3333333|cli-0108-a', (select left(autor_id::text,8)||'|'||cliente_id from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000b2'));
select pg_temp.reg('T21 entrada sincronizada: texto e data da ata, versão 3, atualizada pela condução', 'true|true|3|22222222',
  (select (e.descricao = public.ata_texto_dossie(a))::text||'|'||(e.data = a.data)::text||'|'||e.ata_versao||'|'||left(e.ata_atualizada_por::text,8)
     from public.atas_reuniao a join public.entradas_timeline e on e.ata_origem_id = a.id where a.id = 'd0000000-0000-0000-0000-0000000000b2'));
select pg_temp.reg('T22 autoria original da entrada preservada', '33333333', (select left(created_by::text,8) from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b2'));
set role authenticated;

-- ===== exclusão pelo admin =====
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('T23 admin exclui ata', '1 linha(s)', pg_temp.linhas($q$delete from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
select pg_temp.reg('T24 admin exclui ata antiga sem entrada (H2)', '1 linha(s)', pg_temp.linhas($q$delete from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000a2'$q$));
select pg_temp.reg('T25 admin também não apaga a entrada vinculada pela API', 'NEGADO 42501', pg_temp.tenta($q$delete from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1'$q$));
reset role;
select pg_temp.reg('T26 entrada da ata excluída permanece marcada (excluída por admin, desafixada)', '1|11111111|false',
  (select count(*)||'|'||left(min(ata_excluida_por::text),8)||'|'||bool_or(fixado)::text from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000b1' and ata_excluida_em is not null));
select pg_temp.reg('T27 lápide da ata sem entrada (H2), automática', '1|true', (select count(*)||'|'||bool_and(automatica)::text from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000a2' and ata_excluida_em is not null));

-- ===== transação: falha na sincronização desfaz a ata =====
alter table public.entradas_timeline add constraint teste_0108_falha check (descricao not like '%FALHA-SYNC%') not valid;
set role authenticated;
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.reg('T28 INSERT de ata com falha no dossiê', 'NEGADO 23514', pg_temp.tenta($q$insert into public.atas_reuniao (cliente_id, tipo, data, resumo) values ('cli-0108-a','r1',current_date,'FALHA-SYNC')$q$));
select pg_temp.reg('T29 UPDATE de ata com falha no dossiê', 'NEGADO 23514', pg_temp.tenta($q$update public.atas_reuniao set resumo = 'FALHA-SYNC' where id = 'd0000000-0000-0000-0000-0000000000b2'$q$));
reset role;
alter table public.entradas_timeline drop constraint teste_0108_falha;
select pg_temp.reg('T30 nada ficou gravado (ata nova inexistente, resumo antigo mantido)', '0|de Acordos, revisada',
  (select (select count(*) from public.atas_reuniao where resumo = 'FALHA-SYNC')||'|'||(select resumo from public.atas_reuniao where id = 'd0000000-0000-0000-0000-0000000000b2')));

-- ===== exclusão do cliente em cascata =====
set role authenticated;
select pg_temp.sessao('22222222-2222-2222-2222-222222222222');
select pg_temp.tenta($q$insert into public.atas_reuniao (id, cliente_id, tipo, data, resumo) values ('d0000000-0000-0000-0000-0000000000c2','cli-0108-cascata','r1',current_date,'cascata pós-0108')$q$);
reset role;
insert into public.anexos (entrada_id, nome, caminho_storage) select id, 'anexo-teste.pdf', 'teste/anexo-teste.pdf' from public.entradas_timeline where ata_origem_id = 'd0000000-0000-0000-0000-0000000000c2';
select pg_temp.reg('T31 antes da exclusão: 2 atas, 2 entradas vinculadas, 1 anexo', '2|2|1',
  (select (select count(*) from public.atas_reuniao where cliente_id = 'cli-0108-cascata')||'|'||(select count(*) from public.entradas_timeline where cliente_id = 'cli-0108-cascata' and ata_origem_id is not null)||'|'||(select count(*) from public.anexos a join public.entradas_timeline e on e.id = a.entrada_id where e.cliente_id = 'cli-0108-cascata')));
create temp table aud0 as select count(*) n from public.auditoria;
set role authenticated;
select pg_temp.sessao('11111111-1111-1111-1111-111111111111');
select pg_temp.reg('T32 admin exclui o cliente (cascata)', '1 linha(s)', pg_temp.linhas($q$delete from public.clientes where id = 'cli-0108-cascata'$q$));
reset role;
select pg_temp.reg('T33 nada sobrou do cliente (atas, entradas, anexos)', '0|0|0',
  (select (select count(*) from public.atas_reuniao where cliente_id = 'cli-0108-cascata')||'|'||(select count(*) from public.entradas_timeline where cliente_id = 'cli-0108-cascata')||'|'||(select count(*) from public.anexos where caminho_storage = 'teste/anexo-teste.pdf')));
select pg_temp.reg('T34 auditoria da cascata: 2 atas e 2 entradas excluídas registradas', '2|2',
  (select (select count(*) from public.auditoria where tabela = 'atas_reuniao' and acao = 'DELETE' and registro in ('d0000000-0000-0000-0000-0000000000c1','d0000000-0000-0000-0000-0000000000c2'))||'|'||(select count(*) from public.auditoria where tabela = 'entradas_timeline' and acao = 'DELETE' and antes->>'cliente_id' = 'cli-0108-cascata' and antes->>'ata_origem_id' is not null)));

-- ===== auditoria e privilégios =====
select pg_temp.reg('T35 auditoria das atas (insert, update, delete)', 'true|true|true',
  (select (exists (select 1 from public.auditoria where tabela = 'atas_reuniao' and acao = 'INSERT' and registro = 'd0000000-0000-0000-0000-0000000000b2'))::text||'|'||
          (exists (select 1 from public.auditoria where tabela = 'atas_reuniao' and acao = 'UPDATE' and registro = 'd0000000-0000-0000-0000-0000000000b2'))::text||'|'||
          (exists (select 1 from public.auditoria where tabela = 'atas_reuniao' and acao = 'DELETE' and registro = 'd0000000-0000-0000-0000-0000000000b1'))::text));
select pg_temp.reg('T36 anon sem EXECUTE em edita_ata / ata_sync_ativo', 'false|false', (select has_function_privilege('anon','public.edita_ata()','execute')::text||'|'||has_function_privilege('anon','public.ata_sync_ativo(uuid)','execute')::text));
select pg_temp.reg('T37 inconsistências após os testes (H3, H4 sem registro; 2 ambíguas; 1 manual)', '5', (select count(*)::text from public.v_dossie_atas_inconsistencias));

select n, caso, esperado, obtido, case when esperado = obtido then 'ok' else 'FALHA' end as resultado from r order by n;
select 'resumo' as etapa, count(*) filter (where esperado = obtido) as ok, count(*) filter (where esperado <> obtido or obtido is null) as falhas from r;
