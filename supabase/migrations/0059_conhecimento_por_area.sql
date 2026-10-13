-- 0059 — Base de conhecimento por área: cada pessoa vê/edita só artigos e documentos da(s) área(s) a que tem acesso; "geral" é de todos.
-- "administrativo" vale para quem tem Financeiro ou Equipe. Admin vê tudo. Idempotente. Depende de 0056 (tem_acesso).
create or replace function public.acesso_area_kb(area text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when coalesce(area,'juridico') = 'geral' then public.sou_equipe()
              when area = 'administrativo' then public.tem_acesso('financeiro') or public.tem_acesso('equipe')
              else public.tem_acesso(coalesce(area,'juridico')) end
$$;
grant execute on function public.acesso_area_kb(text) to authenticated;

drop policy if exists cont_sel on public.conteudos; create policy cont_sel on public.conteudos for select to authenticated using (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists cont_ins on public.conteudos; create policy cont_ins on public.conteudos for insert to authenticated with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists cont_upd on public.conteudos; create policy cont_upd on public.conteudos for update to authenticated using (public.sou_equipe() and public.acesso_area_kb(area)) with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists docb_sel on public.documentos_base; create policy docb_sel on public.documentos_base for select to authenticated using (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists docb_ins on public.documentos_base; create policy docb_ins on public.documentos_base for insert to authenticated with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists docb_upd on public.documentos_base; create policy docb_upd on public.documentos_base for update to authenticated using (public.sou_equipe() and public.acesso_area_kb(area)) with check (public.sou_equipe() and public.acesso_area_kb(area));
drop policy if exists contv_sel on public.conteudos_versoes; create policy contv_sel on public.conteudos_versoes for select to authenticated using (public.sou_equipe() and exists (select 1 from public.conteudos c where c.id = conteudos_versoes.conteudo_id));
select 'ok 0059' as resultado;
