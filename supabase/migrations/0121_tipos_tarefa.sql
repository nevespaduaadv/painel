-- 0121 · Tipos de tarefa cadastráveis em Gestão → Configurações (pedido da sócia, 25/11/2026)
-- Lista de títulos-padrão sugeridos ao criar uma tarefa. Não altera public.tarefas: o título continua livre.
-- Mesma regra de acesso dos motivos de reagendamento (0091): a equipe lê; gestão/controladoria cadastra.

create table if not exists public.tipos_tarefa (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  nucleo text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tipos_tarefa enable row level security;
drop policy if exists tt_sel on public.tipos_tarefa; create policy tt_sel on public.tipos_tarefa for select to authenticated using (public.sou_equipe());
drop policy if exists tt_adm on public.tipos_tarefa; create policy tt_adm on public.tipos_tarefa for all to authenticated using (public.aprova_requisicoes()) with check (public.aprova_requisicoes());
grant select, insert, update, delete on public.tipos_tarefa to authenticated;
revoke all on public.tipos_tarefa from anon;

select 'ok 0121' as resultado, (select count(*) from public.tipos_tarefa) as tipos;
