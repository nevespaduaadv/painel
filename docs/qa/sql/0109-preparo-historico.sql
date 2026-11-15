-- Antes da 0109 (banco descartável): registros "históricos" de ciclo e Raio-X sem autoria, como existem hoje no beta,
-- e um segundo cliente fictício para o ciclo novo.
insert into public.clientes (id, dados) values ('cli-0109-b', '{"nome": "Cliente 0109 B (fictício)"}') on conflict (id) do nothing;
insert into public.acompanhamento_pj (cliente_id, fase, observacoes) values ('cli-0108-a', 'ciclo', 'ciclo histórico (antes da 0109)')
  on conflict (cliente_id) do update set observacoes = excluded.observacoes;
insert into public.dividas_raio_x (id, cliente_id, banco, valor, observacoes)
  values ('e0000000-0000-0000-0000-0000000000d1', 'cli-0108-a', 'BANCO HISTÓRICO', 1000, 'dívida histórica (antes da 0109)')
  on conflict (id) do nothing;
select 'ok preparo 0109' as resultado,
       (select count(*) from public.acompanhamento_pj) as ciclos,
       (select count(*) from public.dividas_raio_x where created_by is null) as dividas_sem_autor;
