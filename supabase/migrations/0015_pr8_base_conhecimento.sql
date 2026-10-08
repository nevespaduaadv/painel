-- 0015 — PR 8: base de conhecimento (Jurídico) — artigos em Markdown por tema, com busca, versões e autor.
-- Idempotente. Depende de 0006 (colaboradores). Conteúdo inicial: carga 0016 (fora do repo) com páginas do Notion e teses.

create table if not exists public.conteudos (
  id uuid primary key default gen_random_uuid(),
  slug text unique,                                -- estável para links (#conhecimento/<slug>)
  area text not null default 'juridico' check (area in ('juridico','comercial','marketing','financeiro','administrativo','geral')),
  tema text not null,                              -- "Teses de defesa", "Operação jurídica", "Crédito rural"…
  titulo text not null,
  resumo text,
  corpo_md text not null default '',
  tags text[] not null default '{}',
  ordem integer not null default 0,
  publicado boolean not null default true,
  autor_id uuid references public.colaboradores(id) on delete set null,
  versao integer not null default 1,
  origem text not null default 'manual',           -- manual | notion | skill
  id_externo text,
  busca tsvector,                                  -- mantido pelo gatilho conteudo_versionar
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists conteudos_busca_idx on public.conteudos using gin (busca);
create index if not exists conteudos_tema_idx on public.conteudos(area, tema, ordem);
create unique index if not exists conteudos_id_externo_uidx on public.conteudos(id_externo) where id_externo is not null;

create table if not exists public.conteudos_versoes (
  id bigserial primary key,
  conteudo_id uuid not null references public.conteudos(id) on delete cascade,
  versao integer not null,
  titulo text, resumo text, corpo_md text, tags text[],
  autor_id uuid references public.colaboradores(id) on delete set null,
  editado_por uuid,
  created_at timestamptz default now()
);
create index if not exists conteudos_versoes_idx on public.conteudos_versoes(conteudo_id, versao desc);

-- slug automático
create or replace function public.slugify(t text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '-', 'g'))
$$;

-- versão anterior guardada a cada edição do corpo/título; versao incrementa
create or replace function public.conteudo_versionar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.busca := setweight(to_tsvector('portuguese', coalesce(new.titulo,'')), 'A')
            || setweight(to_tsvector('portuguese', coalesce(new.resumo,'')||' '||array_to_string(new.tags,' ')), 'B')
            || setweight(to_tsvector('portuguese', coalesce(new.corpo_md,'')), 'C');
  if tg_op = 'INSERT' then
    if new.slug is null or new.slug = '' then new.slug := left(public.slugify(new.titulo), 80)||'-'||left(replace(new.id::text,'-',''), 6); end if;
    return new;
  end if;
  if new.corpo_md is distinct from old.corpo_md or new.titulo is distinct from old.titulo or new.resumo is distinct from old.resumo or new.tags is distinct from old.tags then
    insert into public.conteudos_versoes (conteudo_id, versao, titulo, resumo, corpo_md, tags, autor_id, editado_por)
    values (old.id, old.versao, old.titulo, old.resumo, old.corpo_md, old.tags, old.autor_id, old.updated_by);
    new.versao := old.versao + 1;
    new.autor_id := coalesce((select id from public.colaboradores where perfil_id = auth.uid() limit 1), new.autor_id);
  end if;
  return new;
end $$;
drop trigger if exists conteudos_versionar on public.conteudos;
create trigger conteudos_versionar before insert or update on public.conteudos for each row execute procedure public.conteudo_versionar();
drop trigger if exists conteudos_carimbo on public.conteudos;
create trigger conteudos_carimbo before insert or update on public.conteudos for each row execute procedure public.carimbar2();
drop trigger if exists conteudos_audit on public.conteudos;
create trigger conteudos_audit after insert or update or delete on public.conteudos for each row execute procedure public.auditar();

-- RLS: equipe lê e edita; só admin exclui (decisão provisória — ajustar quando a Maria Júlia definir quem edita)
alter table public.conteudos enable row level security;
alter table public.conteudos_versoes enable row level security;
drop policy if exists cont_sel on public.conteudos;
create policy cont_sel on public.conteudos for select to authenticated using (public.sou_equipe());
drop policy if exists cont_ins on public.conteudos;
create policy cont_ins on public.conteudos for insert to authenticated with check (public.sou_equipe());
drop policy if exists cont_upd on public.conteudos;
create policy cont_upd on public.conteudos for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists cont_del on public.conteudos;
create policy cont_del on public.conteudos for delete to authenticated using (public.sou_admin());
drop policy if exists contv_sel on public.conteudos_versoes;
create policy contv_sel on public.conteudos_versoes for select to authenticated using (public.sou_equipe());
revoke all on public.conteudos from anon; revoke all on public.conteudos_versoes from anon;

-- Lista (sem corpo) e busca
create or replace view public.v_conteudos with (security_invoker = true) as
select c.id, c.slug, c.area, c.tema, c.titulo, c.resumo, c.tags, c.ordem, c.publicado, c.versao, c.origem, c.autor_id, co.nome as autor_nome, c.updated_at, length(c.corpo_md) as tamanho
from public.conteudos c left join public.colaboradores co on co.id = c.autor_id;

create or replace function public.conhecimento_buscar(q text, lim integer default 30)
returns table (id uuid, slug text, tema text, titulo text, trecho text, rank real)
language sql stable security definer set search_path = public as $$
  select c.id, c.slug, c.tema, c.titulo,
         ts_headline('portuguese', left(c.corpo_md, 20000), websearch_to_tsquery('portuguese', q), 'MaxWords=28, MinWords=14, StartSel=<mark>, StopSel=</mark>') as trecho,
         ts_rank(c.busca, websearch_to_tsquery('portuguese', q)) as rank
  from public.conteudos c
  where public.sou_equipe() and c.publicado and c.busca @@ websearch_to_tsquery('portuguese', q)
  order by rank desc limit greatest(1, least(lim, 100))
$$;
grant execute on function public.conhecimento_buscar(text, integer) to authenticated;

do $$ begin alter publication supabase_realtime add table public.conteudos; exception when others then null; end $$;

select 'ok 0015' as resultado;
