-- Antes da 0111 (banco descartável, com perfis-teste-ficticios.sql): clientes e bens fictícios.
-- cli-0111-dup: cadastro feito por engano (criado pela administradora; só tem o que o sistema cria sozinho) e encerrado.
-- cli-0111-trab: cliente com trabalho (contrato, ata, registro manual no dossiê e bens em três situações).
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into public.clientes (id, dados) values ('cli-0111-dup', '{"nome":"Cliente 0111 duplicado (fictício)"}'), ('cli-0111-trab', '{"nome":"Cliente 0111 com trabalho (fictício)"}'), ('cli-0111-novo', '{"nome":"Cliente 0111 ativo (fictício)"}');
insert into public.atas_reuniao (id, cliente_id, tipo, titulo, resumo) values ('d0000000-0000-0000-0000-0000000111a1', 'cli-0111-trab', 'r1', 'R1', 'ata fictícia');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.clientes set status = 'encerrado' where id in ('cli-0111-dup', 'cli-0111-trab');
insert into public.contratos (id, cliente_id, dados) values ('k-0111', 'cli-0111-trab', '{"banco":"Banco fictício","saldoAtual":1000}');
insert into public.entradas_timeline (cliente_id, data, tipo, descricao, frente) values ('cli-0111-trab', current_date, 'registro', 'registro manual fictício', 'estrategico');
insert into public.bens (id, cliente_id, tipo, descricao, titular, protecao) values
  ('b0000000-0000-0000-0000-000000000111', 'cli-0111-trab', 'veiculo', 'Veículo exposto (fictício)', 'PJ', 'exposto'),
  ('b0000000-0000-0000-0000-000000000112', 'cli-0111-trab', 'imovel', 'Imóvel protegido (fictício)', 'PF', 'protegido'),
  ('b0000000-0000-0000-0000-000000000113', 'cli-0111-trab', 'maquinario', 'Máquina em proteção (fictícia)', 'PJ', 'em_protecao'),
  ('b0000000-0000-0000-0000-000000000114', 'cli-0111-trab', 'veiculo', 'Veículo exposto 2 (fictício)', 'PJ', 'exposto'),
  ('b0000000-0000-0000-0000-000000000115', 'cli-0111-trab', 'imovel', 'Imóvel em proteção 2 (fictício)', 'PJ', 'em_protecao');
select 'ok preparo 0111' as r, (select count(*) from public.tarefas where cliente_id = 'cli-0111-dup') as tarefas_auto_dup,
       (select count(*) from public.entradas_timeline where cliente_id = 'cli-0111-dup') as entradas_auto_dup, (select count(*) from public.bens where cliente_id = 'cli-0111-trab') as bens;
