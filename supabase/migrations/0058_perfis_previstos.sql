-- 0058 — Pré-cadastro de acessos: quando um usuário é criado no Supabase Auth com um e-mail listado aqui, o perfil já nasce
-- com papel, nome e áreas certos (sem passar por "pendente"). Também vincula o colaborador (colaboradores.perfil_id) pelo e-mail/nome.
-- Idempotente. Depende de 0001 (criar_perfil), 0056 (acessos por área).
create table if not exists public.perfis_previstos (
  email text primary key,
  nome text,
  papel text not null default 'colaborador' check (papel in ('admin','colaborador','cliente','robo')),
  acessos text[] not null default '{}',
  colaborador_id uuid references public.colaboradores(id) on delete set null,
  aplicado_em timestamptz
);
alter table public.perfis_previstos enable row level security;
drop policy if exists "previstos: admin" on public.perfis_previstos;
create policy "previstos: admin" on public.perfis_previstos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

create or replace function public.criar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare pv public.perfis_previstos; colab uuid;
begin
  select * into pv from public.perfis_previstos where lower(email) = lower(new.email);
  insert into public.perfis (id, email, nome, papel, acessos)
  values (new.id, new.email, coalesce(pv.nome, new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          case when pv.email is not null then pv.papel
               when not exists (select 1 from public.perfis where papel='admin') then 'admin' else 'pendente' end,
          coalesce(pv.acessos, '{}'))
  on conflict (id) do nothing;
  if pv.email is not null then
    colab := coalesce(pv.colaborador_id, (select id from public.colaboradores c where lower(c.email) = lower(new.email) limit 1));
    if colab is not null then update public.colaboradores set perfil_id = new.id where id = colab and perfil_id is null; end if;
    update public.perfis_previstos set aplicado_em = now() where email = pv.email;
  end if;
  return new;
end $$;

select 'ok 0058' as resultado;
