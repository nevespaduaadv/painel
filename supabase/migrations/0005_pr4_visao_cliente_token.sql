-- 0005 — PR 4: visão do cliente evoluída + acesso opcional por link com token (opção "a", complementar ao login)
-- Idempotente. Depende de 0002 (clientes.token / acesso_por_token, entradas_timeline, processos, andamentos, acordos) e 0001 (referencias, regras).

-- Função chamada pela página cliente/?t=TOKEN sem login (papel anon). SECURITY DEFINER: entrega só o que o cliente
-- pode ver (visivel_cliente = true), nunca notas internas, base de acordos identificada, nem outros clientes.
create or replace function public.painel_por_token(t text) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare c public.clientes%rowtype;
begin
  if t is null or length(t) < 24 then return null; end if;
  select * into c from public.clientes where token = t and acesso_por_token and ativo;
  if not found then return null; end if;
  return jsonb_build_object(
    'cliente', jsonb_build_object('id', c.id, 'dados', (c.dados - 'notasInternas' - 'timeline')),
    'contratos', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'cliente_id', k.cliente_id, 'dados', (k.dados - 'notas'))), '[]'::jsonb)
                  from public.contratos k where k.cliente_id = c.id),
    'referencias', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.referencias r),
    'regras', (select dados from public.regras where id = 'regras'),
    'entradas_timeline', (select coalesce(jsonb_agg(to_jsonb(e) - 'created_by' - 'updated_by' order by e.data desc), '[]'::jsonb)
                          from public.entradas_timeline e where e.cliente_id = c.id and e.visivel_cliente),
    'processos', (select coalesce(jsonb_agg(to_jsonb(p) - 'observacoes' - 'created_by' - 'updated_by'), '[]'::jsonb)
                  from public.processos p where p.cliente_id = c.id and p.visivel_cliente),
    'andamentos', (select coalesce(jsonb_agg(to_jsonb(a) - 'created_by' - 'updated_by' order by a.data desc), '[]'::jsonb)
                   from public.andamentos a join public.processos p on p.id = a.processo_id
                   where p.cliente_id = c.id and p.visivel_cliente and a.visivel_cliente),
    'acordos', (select coalesce(jsonb_agg(to_jsonb(a) - 'created_by' - 'updated_by'), '[]'::jsonb) from public.acordos a where a.cliente_id = c.id),
    'gerado_em', now()
  );
end $$;
revoke all on function public.painel_por_token(text) from public;
grant execute on function public.painel_por_token(text) to anon, authenticated;

-- Registro de acessos por token (para saber quando o cliente abriu o link)
create table if not exists public.acessos_token (
  id bigint generated always as identity primary key,
  cliente_id text references public.clientes(id) on delete cascade,
  quando timestamptz not null default now(),
  ok boolean not null default true
);
alter table public.acessos_token enable row level security;
drop policy if exists acessos_sel on public.acessos_token;
create policy acessos_sel on public.acessos_token for select to authenticated using (public.sou_equipe());

create or replace function public.registrar_acesso_token(t text) returns void
language sql security definer set search_path = public as $$
  insert into public.acessos_token (cliente_id, ok)
  select id, true from public.clientes where token = t and acesso_por_token limit 1;
$$;
revoke all on function public.registrar_acesso_token(text) from public;
grant execute on function public.registrar_acesso_token(text) to anon, authenticated;

-- Último acesso por token, para a equipe
create or replace view public.v_acessos_token with (security_invoker = true) as
select c.id as cliente_id, c.nome as cliente_nome, c.acesso_por_token,
       (select max(quando) from public.acessos_token a where a.cliente_id = c.id) as ultimo_acesso,
       (select count(*) from public.acessos_token a where a.cliente_id = c.id and a.quando >= now() - interval '30 days') as acessos_30d
from public.clientes c;

select 'ok 0005' as resultado;
