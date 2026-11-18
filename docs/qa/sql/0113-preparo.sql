-- 0113 · preparo (ANTES da migração): pessoas e dados FICTÍCIOS, no modelo antigo (núcleo/acessos na pessoa).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'adm@ficticio.test'), ('a0000000-0000-0000-0000-000000000002', 'ana@ficticio.test'),
  ('a0000000-0000-0000-0000-000000000003', 'bia@ficticio.test'), ('a0000000-0000-0000-0000-000000000004', 'caio@ficticio.test'),
  ('a0000000-0000-0000-0000-000000000005', 'dora@ficticio.test'), ('a0000000-0000-0000-0000-000000000007', 'teste@ficticio.test'),
  ('a0000000-0000-0000-0000-000000000008', 'fabio@ficticio.test');
update public.perfis set papel = 'admin' where id = 'a0000000-0000-0000-0000-000000000001';
update public.perfis set papel = 'colaborador', acessos = '{}' where id in ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005');
update public.perfis set papel = 'colaborador', acessos = '{juridico,clientes}' where id = 'a0000000-0000-0000-0000-000000000007';
update public.perfis set papel = 'colaborador', acessos = '{superendividamento}' where id = 'a0000000-0000-0000-0000-000000000008';
insert into public.colaboradores (id, perfil_id, nome, nucleo, ativo, data_admissao) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Adm Fictícia', 'socios', true, null),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Ana Fictícia', null, true, null),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'Bia Fictícia', null, true, null),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Caio Fictício', null, true, null),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'Dora Fictícia', null, true, null),
  ('c0000000-0000-0000-0000-000000000006', null, 'Eli Sem Login', null, true, null),
  ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 'Conta de Teste', 'juridico', true, '2000-01-01'),
  ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', 'Fábio Só Calculadora', 'juridico', true, '2020-01-01');
-- cliente fictício no modelo antigo: as tarefas e o monitoramento automáticos caem na "Conta de Teste" (a mais antiga do Jurídico)
insert into public.clientes (id, dados) values ('cli-cargos-0', '{"nome":"Cliente fictício anterior"}');
insert into public.tarefas (titulo, cliente_id, responsavel_id, status) values ('Tarefa nominal antiga do Eli', 'cli-cargos-0', 'c0000000-0000-0000-0000-000000000006', 'aberta');
insert into public.bens (cliente_id, tipo, descricao) values ('cli-cargos-0', 'veiculo', 'Bem fictício');
create table public._antes as
  select (select md5(string_agg(md5(to_jsonb(t)::text), '' order by id)) from public.tarefas t) tarefas, (select md5(string_agg(md5(to_jsonb(m)::text), '' order by id)) from public.monitoramentos m) monit,
         (select md5(string_agg(md5(p::text), '' order by id)) from public.perfis p) perfis,
         (select md5(string_agg(md5((to_jsonb(c) - 'conta_teste' - 'acesso_por_cargo' - 'fila_cargo_id')::text), '' order by id)) from public.colaboradores c) colabs,
         (select count(*) from public.tarefas) n_tarefas;
select 'preparo ok · tarefas ' || (select count(*) from public.tarefas) || ' · com a conta de teste ' || (select count(*) from public.tarefas where responsavel_id = 'c0000000-0000-0000-0000-000000000007')
       || ' · monitoramento com a conta de teste ' || (select count(*) from public.monitoramentos where responsavel_id = 'c0000000-0000-0000-0000-000000000007');
