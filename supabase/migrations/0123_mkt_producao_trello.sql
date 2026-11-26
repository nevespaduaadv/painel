-- 0123 · Produção de conteúdo no molde do Trello (pedido da sócia, 26/11/2026, 11h38)
-- Concluir o cartão pela bolinha, histórico de atividade junto dos comentários e catálogo de etiquetas do quadro.
-- Só acrescenta colunas e uma tabela nova; nada é apagado nem alterado. Mesma regra de acesso do quadro (0122).

alter table public.mkt_producao add column if not exists concluido_em timestamptz;
alter table public.mkt_producao add column if not exists concluido_por uuid;
alter table public.mkt_producao_comentarios add column if not exists tipo text not null default 'comentario';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_producao_comentarios_tipo_chk') then
    alter table public.mkt_producao_comentarios add constraint mkt_producao_comentarios_tipo_chk check (tipo in ('comentario','atividade'));
  end if;
end $$;

create table if not exists public.mkt_etiquetas (
  id bigserial primary key,
  nome text not null,
  cor text not null default 'verde',
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (nome, cor)
);
alter table public.mkt_etiquetas enable row level security;
drop policy if exists mke_all on public.mkt_etiquetas;
create policy mke_all on public.mkt_etiquetas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update, delete on public.mkt_etiquetas to authenticated;
grant usage, select on sequence public.mkt_etiquetas_id_seq to authenticated;
revoke all on public.mkt_etiquetas from anon;

select 'ok 0123' as resultado;
