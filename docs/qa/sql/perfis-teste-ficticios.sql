-- Perfis e colaboradores FICTÍCIOS para os testes locais de permissão (banco descartável). Nenhum dado real.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@teste'),
  ('22222222-2222-2222-2222-222222222222', 'acomp@teste'),
  ('33333333-3333-3333-3333-333333333333', 'acordos@teste'),
  ('44444444-4444-4444-4444-444444444444', 'juridico@teste'),
  ('55555555-5555-5555-5555-555555555555', 'inativo@teste')
on conflict (id) do nothing;
update public.perfis set papel = 'admin', acessos = '{}' where id = '11111111-1111-1111-1111-111111111111';
update public.perfis set papel = 'colaborador', acessos = '{clientes}' where id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555');
update public.perfis set papel = 'colaborador', acessos = '{clientes,juridico}' where id = '44444444-4444-4444-4444-444444444444';
insert into public.colaboradores (id, perfil_id, nome, nucleo, frente, ativo) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Admin T', 'socios', null, true),
  ('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Acomp T', 'acompanhamento_pj', 'estrategico', true),
  ('a3333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Acordos T', 'acordos', null, true),
  ('a4444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'Juridico T', 'juridico', null, true),
  ('a5555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', 'Inativo T', 'acordos', null, false)
on conflict (id) do nothing;
