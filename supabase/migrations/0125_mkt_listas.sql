-- 0125 · Produção de conteúdo: listas livres como no Trello (autorizado pela sócia em 26/11/2026, 14h58)
-- As listas do quadro passam a ser criadas, renomeadas, reordenadas e excluídas pela equipe. “Aguardando aprovação”
-- continua fixa (chave 'aprovacao'): é ela que libera o envio para a Pauta de conteúdo. Nada é apagado.

create table if not exists public.mkt_listas (
  chave text primary key,
  nome text not null,
  ordem integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
insert into public.mkt_listas (chave, nome, ordem) values
  ('ideias','Ideias',10), ('planejamento','Planejamento',20), ('producao','Em produção',30), ('aprovacao','Aguardando aprovação',99999)
on conflict (chave) do nothing;

alter table public.mkt_listas enable row level security;
drop policy if exists mkl_sel on public.mkt_listas;
create policy mkl_sel on public.mkt_listas for select to authenticated using (public.sou_equipe());
drop policy if exists mkl_ins on public.mkt_listas;
create policy mkl_ins on public.mkt_listas for insert to authenticated with check (public.sou_equipe() and chave <> 'aprovacao');
drop policy if exists mkl_upd on public.mkt_listas;
create policy mkl_upd on public.mkt_listas for update to authenticated using (public.sou_equipe() and chave <> 'aprovacao') with check (public.sou_equipe() and chave <> 'aprovacao');
drop policy if exists mkl_del on public.mkt_listas;
create policy mkl_del on public.mkt_listas for delete to authenticated using (public.sou_equipe() and chave <> 'aprovacao');
grant select, insert, update, delete on public.mkt_listas to authenticated;
revoke all on public.mkt_listas from anon;

-- o cartão passa a aceitar qualquer lista (antes só as quatro de origem)
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.mkt_producao'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%coluna%' loop
    execute format('alter table public.mkt_producao drop constraint %I', c.conname);
  end loop;
end $$;
notify pgrst, 'reload schema';

select 'ok 0125' as resultado;
