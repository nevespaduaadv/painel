-- 0066 — Documentos base: arquivos guardados no próprio sistema (bucket privado "conhecimento") e abertura interna.
-- origem 'arquivo' = PDF/DOCX/etc. enviado pela tela e servido por URL assinada; continua valendo o índice do Drive (origem 'drive')
-- e links (origem 'link'). Acesso por área igual aos artigos (acesso_area_kb). Idempotente. Depende de 0017 e 0059.

alter table public.documentos_base add column if not exists caminho_storage text;        -- "<area>/<uuid>-<nome>" no bucket conhecimento
alter table public.documentos_base add column if not exists conteudo_texto text;          -- texto extraído (busca), opcional
alter table public.documentos_base alter column url set default '';
create unique index if not exists documentos_base_storage_uidx on public.documentos_base(caminho_storage) where caminho_storage is not null;

-- busca: inclui o texto extraído quando houver
create or replace function public.documento_base_indexar() returns trigger language plpgsql as $$
begin
  new.busca := setweight(to_tsvector('portuguese', coalesce(new.titulo,'')), 'A')
            || setweight(to_tsvector('portuguese', coalesce(new.caminho,'')||' '||array_to_string(new.tags,' ')), 'B')
            || setweight(to_tsvector('portuguese', coalesce(new.descricao,'')), 'C')
            || setweight(to_tsvector('portuguese', left(coalesce(new.conteudo_texto,''), 200000)), 'D');
  return new;
end $$;

-- bucket privado
insert into storage.buckets (id, name, public, file_size_limit)
values ('conhecimento','conhecimento', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists conhecimento_storage_sel on storage.objects;
create policy conhecimento_storage_sel on storage.objects for select to authenticated
  using (bucket_id = 'conhecimento' and public.sou_equipe() and public.acesso_area_kb(split_part(name,'/',1)));
drop policy if exists conhecimento_storage_ins on storage.objects;
create policy conhecimento_storage_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'conhecimento' and public.sou_equipe() and public.acesso_area_kb(split_part(name,'/',1)));
drop policy if exists conhecimento_storage_upd on storage.objects;
create policy conhecimento_storage_upd on storage.objects for update to authenticated
  using (bucket_id = 'conhecimento' and public.sou_equipe() and public.acesso_area_kb(split_part(name,'/',1)));
drop policy if exists conhecimento_storage_del on storage.objects;
create policy conhecimento_storage_del on storage.objects for delete to authenticated
  using (bucket_id = 'conhecimento' and public.sou_admin());

-- apagar o registro apaga o arquivo do bucket (admin)
create or replace function public.documentos_base_apagar_arquivo() returns trigger language plpgsql security definer set search_path = public, storage as $$
begin
  if old.caminho_storage is not null then
    delete from storage.objects where bucket_id = 'conhecimento' and name = old.caminho_storage;
  end if;
  return old;
end $$;
drop trigger if exists documentos_base_apagar_arquivo on public.documentos_base;
create trigger documentos_base_apagar_arquivo after delete on public.documentos_base for each row execute procedure public.documentos_base_apagar_arquivo();

select 'ok 0066' as resultado;
