-- 0118 — Monitores do AtendeDireito Sync por CPF/CNPJ dos clientes (aba Monitoramento).
-- Cada documento cadastrado em monitoramentos.documentos vira um monitor no Sync; o que o monitor descobre fica guardado aqui,
-- e processo novo marca o cliente como "nova movimentação". Só leitura para a equipe; quem grava é o servidor.
-- Criar monitor é a única ESCRITA que o conector faz no fornecedor. Idempotente. Depende de 0010 (monitoramentos) e 0114.

create table if not exists public.sync_monitores (
  id bigint generated always as identity primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  tipo text not null check (tipo in ('cpf', 'cnpj')),
  documento text not null unique,                 -- só dígitos
  monitor_fonte bigint,                           -- id do monitor no Sync
  descobertos jsonb not null default '[]'::jsonb, -- processos que o monitor encontrou (como o Sync devolve)
  pendentes integer not null default 0,           -- encontrados que ainda não estão cadastrados no sistema nem foram dispensados no Sync
  ultima_checagem timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists sync_monitores_cliente_idx on public.sync_monitores (cliente_id);
alter table public.sync_monitores enable row level security;
drop policy if exists "sync_monitores: equipe lê" on public.sync_monitores;
create policy "sync_monitores: equipe lê" on public.sync_monitores for select to authenticated using (public.sou_equipe());
revoke insert, update, delete on public.sync_monitores from anon, authenticated;
grant select on public.sync_monitores to authenticated;

-- documentos cadastrados na aba Monitoramento que ainda não têm monitor no Sync
create or replace function public.sync_monitores_a_criar() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cliente_id', cliente_id, 'documento', d, 'tipo', case length(d) when 11 then 'cpf' else 'cnpj' end) order by cliente_id, d), '[]'::jsonb)
    from (select distinct on (d) m.cliente_id, d from public.monitoramentos m, lateral (select regexp_replace(x, '\D', '', 'g') as d from unnest(m.documentos) x) y
           where length(d) in (11, 14) and m.status <> 'pausado' order by d, m.created_at) z
   where not exists (select 1 from public.sync_monitores s where s.documento = z.d and s.monitor_fonte is not null) $$;

create or replace function public.sync_monitor_registrar(p_cliente text, p_tipo text, p_documento text, p_monitor bigint, p_erro text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.sync_monitores (cliente_id, tipo, documento, monitor_fonte, erro) values (p_cliente, p_tipo, regexp_replace(p_documento, '\D', '', 'g'), p_monitor, p_erro)
  on conflict (documento) do update set monitor_fonte = coalesce(excluded.monitor_fonte, public.sync_monitores.monitor_fonte), erro = excluded.erro, atualizado_em = now() $$;

create or replace function public.sync_monitores_lista() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('documento', documento, 'monitor', monitor_fonte)), '[]'::jsonb) from public.sync_monitores where monitor_fonte is not null $$;

-- guarda o que o monitor encontrou; devolve quantos processos são NOVOS em relação à última leitura (e ainda não cadastrados)
create or replace function public.sync_monitor_descobertos(p_documento text, p_processos jsonb, p_checagem timestamptz default null) returns integer
language plpgsql security definer set search_path = public as $$
declare s public.sync_monitores; novos integer; pend integer;
begin
  select * into s from public.sync_monitores where documento = regexp_replace(p_documento, '\D', '', 'g');
  if s.id is null then return 0; end if;
  with atual as (select regexp_replace(coalesce(x ->> 'numero', ''), '\D', '', 'g') as n, coalesce((x ->> 'arquivado')::boolean, false) as arq from jsonb_array_elements(coalesce(p_processos, '[]'::jsonb)) x),
       fora as (select a.n from atual a where length(a.n) = 20 and not a.arq
                   and not exists (select 1 from public.processos p where regexp_replace(coalesce(p.numero_cnj, ''), '\D', '', 'g') = a.n)),
       antes as (select regexp_replace(coalesce(x ->> 'numero', ''), '\D', '', 'g') as n from jsonb_array_elements(s.descobertos) x)
  select (select count(*) from fora), (select count(*) from fora f where not exists (select 1 from antes b where b.n = f.n)) into pend, novos;
  update public.sync_monitores set descobertos = coalesce(p_processos, '[]'::jsonb), pendentes = pend, ultima_checagem = coalesce(p_checagem, now()), erro = null, atualizado_em = now() where id = s.id;
  if novos > 0 and s.ultima_checagem is not null then   -- a primeira leitura é o estoque antigo: não dispara aviso
    update public.monitoramentos set status = 'nova_movimentacao' where cliente_id = s.cliente_id and status = 'em_monitoramento';
  end if;
  return novos;
end $$;
revoke all on function public.sync_monitores_a_criar(), public.sync_monitor_registrar(text, text, text, bigint, text), public.sync_monitores_lista(), public.sync_monitor_descobertos(text, jsonb, timestamptz) from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_monitores_a_criar(), public.sync_monitor_registrar(text, text, text, bigint, text), public.sync_monitores_lista(), public.sync_monitor_descobertos(text, jsonb, timestamptz) to service_role;
  end if;
end $g$;

select 'ok 0118' as resultado, (select jsonb_array_length(public.sync_monitores_a_criar())) as documentos_a_criar;
-- Reversão: drop function public.sync_monitor_descobertos(text, jsonb, timestamptz), public.sync_monitores_lista(), public.sync_monitor_registrar(text, text, text, bigint, text), public.sync_monitores_a_criar(); drop table public.sync_monitores;
-- (os monitores criados no Sync continuam lá; arquivar pela tela Monitores do Sync.)
