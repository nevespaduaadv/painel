-- 0122 · Marketing → Produção de conteúdo (quadro kanban; pedido da sócia, 26/11/2026)
-- Cartões de produção com descrição, etiquetas, datas, checklist, membros, anexos e comentários.
-- Ao chegar em "Aguardando aprovação", o cartão pode ser enviado para a Pauta de conteúdo (public.pautas, status em_aprovacao).
-- Acesso: mesma regra das pautas (0022) — toda a equipe lê e escreve; nada para anon. Anexos no bucket "anexos" (pasta marketing/).

create table if not exists public.mkt_producao (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  coluna text not null default 'ideias' check (coluna in ('ideias','planejamento','producao','aprovacao')),
  ordem integer not null default 0,
  etiquetas jsonb not null default '[]'::jsonb,      -- [{nome, cor}]
  data_inicio date,
  data_entrega date,
  checklist jsonb not null default '[]'::jsonb,      -- [{t, ok}]
  membros uuid[] not null default '{}',              -- colaboradores
  anexos jsonb not null default '[]'::jsonb,         -- [{nome, caminho_storage, tamanho, tipo}]
  gestor_id uuid references public.colaboradores(id) on delete set null,   -- responsável pela gestão (quem aprova)
  pauta_id uuid references public.pautas(id) on delete set null,           -- preenchido ao enviar para a pauta
  arquivado boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_producao_col_idx on public.mkt_producao(coluna, ordem) where not arquivado;

create table if not exists public.mkt_producao_comentarios (
  id bigserial primary key,
  card_id uuid not null references public.mkt_producao(id) on delete cascade,
  autor_id uuid default auth.uid(),
  autor_nome text,
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_producao_com_idx on public.mkt_producao_comentarios(card_id, created_at);

alter table public.mkt_producao enable row level security;
alter table public.mkt_producao_comentarios enable row level security;
drop policy if exists mkp_all on public.mkt_producao;
create policy mkp_all on public.mkt_producao for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists mkpc_sel on public.mkt_producao_comentarios;
create policy mkpc_sel on public.mkt_producao_comentarios for select to authenticated using (public.sou_equipe());
drop policy if exists mkpc_ins on public.mkt_producao_comentarios;
create policy mkpc_ins on public.mkt_producao_comentarios for insert to authenticated with check (public.sou_equipe() and (autor_id is null or autor_id = auth.uid()));
drop policy if exists mkpc_del on public.mkt_producao_comentarios;
create policy mkpc_del on public.mkt_producao_comentarios for delete to authenticated using (public.sou_admin() or autor_id = auth.uid());
grant select, insert, update, delete on public.mkt_producao to authenticated;
grant select, insert, delete on public.mkt_producao_comentarios to authenticated;
grant usage, select on sequence public.mkt_producao_comentarios_id_seq to authenticated;
revoke all on public.mkt_producao from anon; revoke all on public.mkt_producao_comentarios from anon;

select 'ok 0122' as resultado;
