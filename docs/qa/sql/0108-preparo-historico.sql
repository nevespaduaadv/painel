-- Histórico ANTES da 0108 (banco descartável; 0104 + 0107 ativos): cria os casos que a reconciliação precisa tratar.
-- Clientes e atas fictícios.
insert into public.clientes (id, dados) values
  ('cli-0108-a', '{"nome":"TESTE 0108 A"}'),
  ('cli-0108-cascata', '{"nome":"TESTE 0108 CASCATA"}')
on conflict (id) do nothing;

-- H1: ata normal (o gatilho antigo cria a entrada na mesma transação) → deve ser VINCULADA
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
insert into public.atas_reuniao (id, cliente_id, tipo, data, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000a1', 'cli-0108-a', 'r1', current_date - 10, 'H1', 'histórico normal');
commit;
-- H2: ata cuja entrada foi apagada antes da 0108 → "ata sem registro"; depois é excluída pelo admin (lápide)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
insert into public.atas_reuniao (id, cliente_id, tipo, data, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000a2', 'cli-0108-a', 'r2', current_date - 9, 'H2', 'entrada perdida');
commit;
delete from public.entradas_timeline where cliente_id = 'cli-0108-a' and descricao like 'Ata — R2: H2%';
-- H3 e H4: duas atas na MESMA transação (created_at idêntico) → par ambíguo, NÃO vincula
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
insert into public.atas_reuniao (id, cliente_id, tipo, data, titulo, resumo) values
  ('d0000000-0000-0000-0000-0000000000a3', 'cli-0108-a', 'mensal', current_date - 8, 'H3', 'ambígua 1'),
  ('d0000000-0000-0000-0000-0000000000a4', 'cli-0108-a', 'mensal', current_date - 8, 'H4', 'ambígua 2');
commit;
-- entrada manual que parece ata, sem ata → fica sem vínculo
insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, frente) values ('cli-0108-a', current_date - 7, 'ata', 'Ata — manual sem ata', false, 'estrategico');
-- C1: ata do cliente que será excluído em cascata
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
insert into public.atas_reuniao (id, cliente_id, tipo, data, titulo, resumo) values ('d0000000-0000-0000-0000-0000000000c1', 'cli-0108-cascata', 'onb', current_date - 6, 'C1', 'cascata pré-0108');
commit;
-- entrada comum (não é ata) para o teste de regressão
insert into public.entradas_timeline (id, cliente_id, data, tipo, descricao, visivel_cliente, frente) values ('e0000000-0000-0000-0000-0000000000e1', 'cli-0108-a', current_date - 5, 'outro', 'registro comum', false, 'estrategico') on conflict (id) do nothing;
select 'preparo' as etapa, (select count(*) from public.atas_reuniao where cliente_id like 'cli-0108-%') as atas,
       (select count(*) from public.entradas_timeline where cliente_id like 'cli-0108-%' and tipo = 'ata') as entradas_ata;
