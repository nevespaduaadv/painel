-- Antes da 0105+0112 (banco descartável, com perfis-teste-ficticios.sql). Dados 100% fictícios.
-- 12 cobranças antigas na D+7 (o "acumulado"; uma já tem tarefa aberta), 1 na D+3 e 2 a vencer.
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'financeiro@teste') on conflict (id) do nothing;
update public.perfis set papel = 'colaborador', acessos = '{financeiro}' where id = '66666666-6666-6666-6666-666666666666';
insert into public.colaboradores (id, perfil_id, nome, nucleo, ativo) values ('a6666666-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666', 'Financeiro T', 'administrativo', true) on conflict (id) do nothing;
insert into public.clientes (id, dados) values ('cli-0112-a', '{"nome":"Cliente 0112 A (fictício)","telefone":"0000"}') on conflict (id) do nothing;
with h as (select (now() at time zone 'America/Sao_Paulo')::date d)
insert into public.cobrancas (id, cliente_id, tipo, descricao, valor, vencimento, status, origem)
select ('c0000000-0000-0000-0000-0000000012' || lpad(n::text, 2, '0'))::uuid, 'cli-0112-a', 'mensalidade', 'fictícia ' || n, 100 * n, h.d + delta, st, 'painel'
  from h, (values (1,-11,'atrasada'),(2,-15,'atrasada'),(3,-20,'atrasada'),(4,-25,'atrasada'),(5,-30,'atrasada'),(6,-35,'atrasada'),(7,-40,'atrasada'),(8,-45,'atrasada'),
                  (9,-50,'atrasada'),(10,-55,'atrasada'),(11,-60,'atrasada'),(12,-90,'atrasada'),(13,-4,'atrasada'),(14,5,'pendente'),(15,20,'pendente')) v(n, delta, st)
on conflict (id) do nothing;
insert into public.tarefas (titulo, cliente_id, cobranca_id, nucleo, prazo, status) values ('tarefa aberta da cobrança 12', 'cli-0112-a', 'c0000000-0000-0000-0000-000000001212', 'financeiro', current_date, 'aberta');
select 'ok preparo 0112' as r, (select count(*) from public.cobrancas where cliente_id = 'cli-0112-a') as cobrancas, (select count(*) from public.tarefas) as tarefas;
