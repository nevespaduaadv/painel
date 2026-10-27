-- ESPELHO (beta) — mesa de transferência para importações (ex.: extração do ADVBox feita no navegador).
-- O navegador grava o JSON bruto aqui; o processamento é feito depois, em SQL/rpc. Só admins leem. Idempotente.
create table if not exists public.importacao_bruta (
  id uuid primary key default gen_random_uuid(),
  origem text not null,
  chave text not null,
  parte integer not null default 1,
  dados text not null,
  created_at timestamptz not null default now()
);
alter table public.importacao_bruta enable row level security;
-- qualquer cliente com a chave publicável pode DEPOSITAR (só inserir); ninguém além de admin lê/apaga
drop policy if exists imp_ins on public.importacao_bruta; create policy imp_ins on public.importacao_bruta for insert to anon, authenticated with check (origem in ('advbox') and length(dados) < 2000000);
drop policy if exists imp_sel on public.importacao_bruta; create policy imp_sel on public.importacao_bruta for select to authenticated using (public.sou_admin());
drop policy if exists imp_del on public.importacao_bruta; create policy imp_del on public.importacao_bruta for delete to authenticated using (public.sou_admin());
grant insert on public.importacao_bruta to anon, authenticated;
grant select, delete on public.importacao_bruta to authenticated;
select 'ok beta 0011' as resultado;
