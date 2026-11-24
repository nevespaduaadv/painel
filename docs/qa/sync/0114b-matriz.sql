-- 0114b · matriz (roda depois da 0114-matriz e da 0114b). Só dados fictícios.
\set ON_ERROR_STOP 0
\set adm a0000000-0000-0000-0000-0000000000b1
\set jur a0000000-0000-0000-0000-0000000000b2
\set jur2 a0000000-0000-0000-0000-0000000000b4
\set rev a0000000-0000-0000-0000-0000000000b5
\set adm2 a0000000-0000-0000-0000-0000000000b6
create table if not exists public._r14b (n serial, caso text, ok boolean); grant all on public._r14b to authenticated; grant usage on sequence public._r14b_n_seq to authenticated;
create or replace function public._cb(p_caso text, p_ok boolean) returns void language sql security definer as $$ insert into public._r14b (caso, ok) values (p_caso, coalesce(p_ok, false)) $$; grant execute on function public._cb(text, boolean) to authenticated;
reset role; select public._como14(null);
insert into auth.users (id, email) values (:'jur2', 'jur2@ficticio.test'), (:'rev', 'rev@ficticio.test'), (:'adm2', 'adm2@ficticio.test') on conflict do nothing;
update public.perfis set papel = 'colaborador', acessos = '{juridico,clientes}' where id in (:'jur2', :'rev'); update public.perfis set papel = 'admin' where id = :'adm2';
insert into public.colaboradores (id, perfil_id, nome, nucleo, ativo) values ('c0000000-0000-0000-0000-0000000000b4', :'jur2', 'Jur Dois Fictício', 'juridico', true), ('c0000000-0000-0000-0000-0000000000b5', :'rev', 'Revisora Fictícia', 'juridico', true) on conflict (id) do nothing;
update public.integracoes set ativo = true, config = config - 'revisores_prazo' - 'conferentes_publicacoes' where id = 'sync';
update public.processos set responsavel_id = 'c0000000-0000-0000-0000-0000000000b2' where id = 'd0000000-0000-0000-0000-000000000001';
select public.sync_receber_intimacao('{"id_externo": "b-1", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-16", "texto": "Ato fictício para a 0114b.", "prazos": [{"chave": "b1-a", "rotulo": "Contestação (15 dias)", "data_fatal": "2026-12-07"}, {"chave": "b1-b", "rotulo": "Embargos (5 dias)", "data_fatal": "2026-11-23"}, {"chave": "b1-c", "rotulo": "Manifestação (10 dias)", "data_fatal": "2026-11-30"}, {"chave": "b1-d", "rotulo": "Réplica (15 dias)", "data_fatal": "2026-12-09"}]}'::jsonb) ->> 'publicacao_id' as pb \gset
select id as za from public.publicacao_prazos where chave_externa = 'b1-a' \gset
select id as zb from public.publicacao_prazos where chave_externa = 'b1-b' \gset
select id as zc from public.publicacao_prazos where chave_externa = 'b1-c' \gset
select id as zd from public.publicacao_prazos where chave_externa = 'b1-d' \gset
select count(*) as t0 from public.tarefas \gset
-- ===== conferência inicial: atribuição =====
select public._como14(:'jur2'); set role authenticated;
select public._cb('01 acesso genérico ao Jurídico NÃO basta: quem não responde pelo processo nem pela carteira não confere (42501)', public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar')$$, :za)) = '42501' and not public.pode_conferir_prazo(:pb));
reset role; select public._como14(:'jur'); set role authenticated;
select public._cb('02 a responsável pelo processo confere um prazo não fatal: vale na hora, sem revisão', public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar')$$, :za)) = '00000');
reset role; select public._como14(:'adm'); set role authenticated;
select public.sync_definir(null, (select config || jsonb_build_object('conferentes_publicacoes', jsonb_build_array(:'jur2')) from public.integracoes where id = 'sync'));
reset role; select public._como14(:'jur2'); set role authenticated;
select public._cb('03 incluída na carteira de publicações pela administração, passa a poder conferir', public.pode_conferir_prazo(:pb));
reset role; select public._como14(:'adm'); set role authenticated;
select public.sync_definir(null, (select config - 'conferentes_publicacoes' from public.integracoes where id = 'sync'));
reset role; select public._como14(:'jur2'); set role authenticated;
select public._cb('04 REVOGAÇÃO: retirada da carteira, perde a conferência na chamada seguinte (42501)', public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar')$$, :zc)) = '42501');
reset role; select public._como14(null); update public.perfis set acessos = '{clientes}' where id = :'jur';
select public._como14(:'jur'); set role authenticated;
select public._cb('05 REVOGAÇÃO: a responsável pelo processo que perde o acesso ao Jurídico deixa de conferir (42501)', public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar')$$, :zc)) = '42501');
reset role; select public._como14(null); update public.perfis set acessos = '{juridico,clientes}' where id = :'jur';
-- ===== revisão: pendente, fila administrativa, pessoa diferente =====
select public._como14(:'jur'); set role authenticated;
select public._cb('06 prazo FATAL: a conferência vale e a tarefa nasce na hora, marcada como pendente de revisão', public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar', null, true)$$, :zb)) = '00000');
select public._cb('07 quem conferiu não revisa a própria conferência (42501)', public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zb)) = '42501');
reset role; select public._como14(null);
select public._cb('06b conferência: tarefa do prazo criada (23/11, fatal, aberta) com o aviso de revisão pendente; nenhuma perda de prazo por esperar a revisão',
  (select t.prazo = date '2026-11-23' and t.prazo_fatal and t.status = 'aberta' and t.descricao like '%Aguardando revisão%' from public.tarefas t join public.publicacao_prazos z on z.tarefa_id = t.id where z.id = :zb)
  and (select revisao_pendente and revisao_motivo = 'prazo fatal' from public.publicacao_prazos where id = :zb) and (select count(*) = :t0 + 2 from public.tarefas));
select public._cb('08 sem revisor definido: a pendência aparece na FILA ADMINISTRATIVA; ninguém é sorteado',
  (select count(*) = 1 and bool_and(fila_administrativa) and bool_and(conferido_por = :'jur') from public.v_prazos_em_revisao) and public.prazo_revisores_definidos() = 0
  and (select conferido_por = :'jur' and revisado_por is null from public.publicacao_prazos where id = :zb));
select public._como14(:'jur2'); set role authenticated;
select public._cb('09 colega do Jurídico sem cargo de revisão não revisa (42501)', public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zb)) = '42501');
reset role; select public._como14(null);
-- o fornecedor muda a sugestão ENQUANTO a revisão está pendente
select public.sync_receber_intimacao('{"id_externo": "b-1", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-16", "texto": "Ato fictício para a 0114b.", "prazos": [{"chave": "b1-b", "rotulo": "Embargos (5 dias)", "data_fatal": "2026-11-27"}]}'::jsonb);
select public._cb('10 o fornecedor altera a sugestão com a revisão pendente: prazo conferido, tarefa e pendência NÃO mudam; a alteração fica no histórico',
  (select data_sugerida = date '2026-11-27' and data_conferida = date '2026-11-23' and estado = 'confirmado' and revisao_pendente from public.publicacao_prazos where id = :zb)
  and (select t.prazo = date '2026-11-23' and t.prazo_fatal from public.tarefas t join public.publicacao_prazos z on z.tarefa_id = t.id where z.id = :zb)
  and exists (select 1 from public.publicacao_prazo_historico where prazo_id = :zb and acao = 'sugestao_alterada'));
select public._como14(:'adm'); set role authenticated;
select public._cb('11 fila administrativa: sem revisor definido, a administração aprova — e fica registrado quem revisou', public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zb)) = '00000');
-- administração define a revisora
select public.sync_definir(null, (select config || jsonb_build_object('revisores_prazo', jsonb_build_array(:'rev')) from public.integracoes where id = 'sync'));
reset role; select public._como14(:'jur'); set role authenticated;
select public._cb('12 DESCARTE de sugestão e data POSTERIOR à sugerida também ficam pendentes de revisão',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'descartar', null, false, 'Ato já cumprido')$$, :zc)) = '00000'
  and public._t14(format($$select public.publicacao_prazo_conferir(%s, 'corrigir', '2026-12-11', false, 'Suspensão de prazos no período')$$, :zd)) = '00000');
reset role; select public._como14(:'adm'); set role authenticated;
select public._cb('13 com revisora definida, a revisão é dela: a administração deixa de revisar (42501) e a fila deixa de ser administrativa',
  public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zc)) = '42501' and (select count(*) = 2 and not bool_or(fila_administrativa) from public.v_prazos_em_revisao));
reset role; select public._como14(:'rev'); set role authenticated;
select public._cb('14 a revisora (pessoa diferente) aprova o descarte e DEVOLVE a correção, com motivo',
  public.prazo_revisor() and public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zc)) = '00000'
  and public._t14(format($$select public.publicacao_prazo_revisar(%s, 'devolver', 'Portaria não alcança este juízo')$$, :zd)) = '00000');
reset role; select public._como14(null);
select public._cb('14b conferência: a devolução NÃO apaga a primeira conferência — o histórico guarda quem conferiu, a data e o motivo; a tarefa continua aberta',
  (select estado = 'sugerido' and not revisao_pendente and tarefa_id is not null from public.publicacao_prazos where id = :zd)
  and (select string_agg(acao, ',' order by id) = 'sugerido,tarefa_criada,corrigido,revisao_devolvida' from public.publicacao_prazo_historico where prazo_id = :zd)
  and exists (select 1 from public.publicacao_prazo_historico where prazo_id = :zd and acao = 'corrigido' and por = :'jur' and observacao = 'Suspensão de prazos no período' and (para ->> 'data_conferida') = '2026-12-11')
  and (select t.status = 'aberta' from public.tarefas t join public.publicacao_prazos z on z.tarefa_id = t.id where z.id = :zd));
-- a própria revisora confere um prazo fatal: revisão independente continua obrigatória
select public._como14(:'rev'); set role authenticated;
select public._cb('15 a revisora confere um prazo FATAL: mesmo sendo revisora, fica pendente — a revisão é sempre de outra pessoa (ela não aprova o próprio: 42501)',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar', null, true)$$, :zd)) = '00000' and public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zd)) = '42501');
reset role; select public._como14(:'adm2'); set role authenticated;
select public._cb('16 sem outro revisor além de quem conferiu, a pendência cai na fila administrativa e outra administradora revisa',
  (select fila_administrativa from public.v_prazos_em_revisao where prazo_id = :zd) and public._t14(format($$select public.publicacao_prazo_revisar(%s, 'aprovar')$$, :zd)) = '00000');
-- revogação da revisora
reset role; select public._como14(:'adm'); set role authenticated;
select public.sync_definir(null, (select config - 'revisores_prazo' from public.integracoes where id = 'sync'));
reset role; select public._como14(:'rev'); set role authenticated;
select public._cb('17 REVOGAÇÃO: retirada da lista de revisores, deixa de ser revisora na chamada seguinte', not public.prazo_revisor());
reset role; select public._como14(null);
-- cargos (0113): ocupante do Responsável Jurídico revisa; Controladoria só se autorizada; fim da ocupação = fim da revisão
create table if not exists public.cargos (id uuid primary key default gen_random_uuid(), codigo text not null unique, nome text);
create table if not exists public.cargo_ocupacoes (id uuid primary key default gen_random_uuid(), cargo_id uuid not null references public.cargos (id), colaborador_id uuid not null references public.colaboradores (id), fim timestamptz);
insert into public.cargos (codigo, nome) values ('responsavel_juridico', 'Responsável Jurídico'), ('controladoria_juridica', 'Controladoria Jurídica') on conflict (codigo) do nothing;
delete from public.cargo_ocupacoes where colaborador_id in ('c0000000-0000-0000-0000-0000000000b4', 'c0000000-0000-0000-0000-0000000000b5');
insert into public.cargo_ocupacoes (cargo_id, colaborador_id) select id, 'c0000000-0000-0000-0000-0000000000b5' from public.cargos where codigo = 'responsavel_juridico';
insert into public.cargo_ocupacoes (cargo_id, colaborador_id) select id, 'c0000000-0000-0000-0000-0000000000b4' from public.cargos where codigo = 'controladoria_juridica';
grant select on public.cargos, public.cargo_ocupacoes to authenticated;
select public._como14(:'rev'); set role authenticated; select public.prazo_revisor() as r1 \gset
reset role; select public._como14(:'jur2'); set role authenticated; select public.prazo_revisor() as r2 \gset
reset role; select public._como14(null);
select public._cb('18 com os cargos: quem OCUPA o Responsável Jurídico é revisora; a Controladoria Jurídica só revisa se a administração autorizar', :'r1' = 't' and :'r2' = 'f' and public.prazo_revisores_definidos() = 1);
update public.integracoes set config = config || '{"controladoria_revisa": true}'::jsonb where id = 'sync';
select public._como14(:'jur2'); set role authenticated; select public.prazo_revisor() as r3 \gset
reset role; select public._como14(null); update public.cargo_ocupacoes set fim = now() where colaborador_id = 'c0000000-0000-0000-0000-0000000000b5';
select public._como14(:'rev'); set role authenticated; select public.prazo_revisor() as r4 \gset
reset role; select public._como14(null);
select public._cb('19 Controladoria autorizada passa a revisar; ocupação ENCERRADA deixa de revisar na chamada seguinte', :'r3' = 't' and :'r4' = 'f');
select public._cb('20 autoria preservada: cada prazo guarda quem conferiu e quem revisou, pessoas diferentes',
  (select count(*) = 3 and bool_and(conferido_por is distinct from revisado_por) from public.publicacao_prazos where revisado_por is not null and publicacao_id = :pb));
select case when ok then 'ok    ' else 'FALHA ' end || caso from public._r14b order by n;
select (select count(*) filter (where ok) from public._r14b) || ' de ' || (select count(*) from public._r14b) || ' casos conformes (0114b)';
