-- 0017 — PR 8b: documentos base (índice do Google Drive) dentro da base de conhecimento.
-- Os arquivos continuam no Drive (não são copiados): aqui fica um índice pesquisável com título, pasta, tipo, link,
-- descrição e tags editáveis pela equipe. Carga inicial 0018 (fora do repo); re-sincronização por nova carga.
-- Idempotente. Depende de 0015.

create table if not exists public.documentos_base (
  id uuid primary key default gen_random_uuid(),
  area text not null default 'juridico' check (area in ('juridico','comercial','marketing','financeiro','administrativo','geral')),
  origem text not null default 'drive',               -- drive | link (adicionado à mão)
  drive_id text,                                      -- id do arquivo/pasta no Drive (único)
  pasta_drive_id text,                                -- id da pasta-mãe no Drive
  caminho text not null default '',                   -- "MODELOS DE PEÇAS / EMBARGOS" (relativo à pasta JURÍDICO)
  titulo text not null,
  tipo text not null default '',                      -- docx, pdf, xlsx, odt, folder…
  mime text,
  url text not null,
  tamanho bigint,
  modificado_em date,
  descricao text,                                     -- editável pela equipe (o que é, quando usar)
  tags text[] not null default '{}',
  destaque boolean not null default false,            -- modelos de uso frequente
  ativo boolean not null default true,                -- false = sumiu do Drive na última sincronização
  busca tsvector,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
drop index if exists public.documentos_base_drive_uidx;
create unique index if not exists documentos_base_drive_uidx on public.documentos_base(drive_id); -- único (nulos permitidos); sem WHERE para o upsert da tela funcionar
create index if not exists documentos_base_caminho_idx on public.documentos_base(area, caminho, titulo);
create index if not exists documentos_base_busca_idx on public.documentos_base using gin (busca);

create or replace function public.documento_base_indexar() returns trigger language plpgsql as $$
begin
  new.busca := setweight(to_tsvector('portuguese', coalesce(new.titulo,'')), 'A')
            || setweight(to_tsvector('portuguese', coalesce(new.descricao,'')||' '||array_to_string(new.tags,' ')), 'B')
            || setweight(to_tsvector('portuguese', coalesce(new.caminho,'')), 'C');
  return new;
end $$;
drop trigger if exists documentos_base_indexar on public.documentos_base;
create trigger documentos_base_indexar before insert or update on public.documentos_base for each row execute procedure public.documento_base_indexar();
drop trigger if exists documentos_base_carimbo on public.documentos_base;
create trigger documentos_base_carimbo before insert or update on public.documentos_base for each row execute procedure public.carimbar2();
drop trigger if exists documentos_base_audit on public.documentos_base;
create trigger documentos_base_audit after insert or update or delete on public.documentos_base for each row execute procedure public.auditar();

-- RLS: equipe lê, inclui links e edita descrição/tags; só admin exclui. Cliente nunca vê.
alter table public.documentos_base enable row level security;
drop policy if exists docb_sel on public.documentos_base;
create policy docb_sel on public.documentos_base for select to authenticated using (public.sou_equipe());
drop policy if exists docb_ins on public.documentos_base;
create policy docb_ins on public.documentos_base for insert to authenticated with check (public.sou_equipe());
drop policy if exists docb_upd on public.documentos_base;
create policy docb_upd on public.documentos_base for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists docb_del on public.documentos_base;
create policy docb_del on public.documentos_base for delete to authenticated using (public.sou_admin());
revoke all on public.documentos_base from anon;
do $$ begin if exists (select 1 from pg_roles where rolname = 'bi') then revoke all on public.documentos_base from bi; end if; end $$;

-- Busca unificada (artigos + documentos) para a caixa de busca da base de conhecimento
create or replace function public.documentos_base_buscar(q text, lim integer default 30)
returns table (id uuid, titulo text, caminho text, tipo text, url text, trecho text, rank real)
language sql stable security definer set search_path = public as $$
  select d.id, d.titulo, d.caminho, d.tipo, d.url,
         ts_headline('portuguese', coalesce(d.descricao,'')||' '||array_to_string(d.tags,' '), websearch_to_tsquery('portuguese', q), 'MaxWords=20, MinWords=8, StartSel=<mark>, StopSel=</mark>') as trecho,
         ts_rank(d.busca, websearch_to_tsquery('portuguese', q)) as rank
  from public.documentos_base d
  where public.sou_equipe() and d.ativo and d.tipo <> 'folder' and d.busca @@ websearch_to_tsquery('portuguese', q)
  order by rank desc, d.titulo limit greatest(1, least(lim, 100))
$$;
grant execute on function public.documentos_base_buscar(text, integer) to authenticated;

do $$ begin alter publication supabase_realtime add table public.documentos_base; exception when others then null; end $$;

select 'ok 0017' as resultado;
