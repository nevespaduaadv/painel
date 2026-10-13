-- 0056 — Acesso por área para cada usuário (perfis.acessos): clientes, juridico, comercial, marketing, financeiro, equipe, growth.
-- Admin vê tudo. Colaborador vê só as áreas marcadas em Usuários. O menu/rotas respeitam no painel; no banco, as áreas
-- comercial, marketing, equipe (horas dos outros) e financeiro/growth (já existiam) são bloqueadas por RLS.
-- Clientes/jurídico continuam legíveis no banco para qualquer colaborador (muitas telas cruzam esses dados) — só o menu esconde.
-- Idempotente. Depende de 0044 (perfis.acessos), 0055 (pode_financeiro).

-- quem já é colaborador/admin mantém o que via hoje (todas as áreas de operação); growth/financeiro só quem já tinha
update public.perfis set acessos = (
  select array_agg(distinct a) from unnest(coalesce(acessos, '{}') || array['clientes','juridico','comercial','marketing','equipe']) a)
where papel in ('colaborador','admin');

create or replace function public.tem_acesso(area text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.papel = 'admin' or (p.papel = 'colaborador' and area = any(coalesce(p.acessos, '{}'))) from public.perfis p where p.id = auth.uid()), false)
$$;
grant execute on function public.tem_acesso(text) to authenticated;

-- pode_growth / pode_financeiro passam pelo mesmo mecanismo
create or replace function public.pode_growth() returns boolean language sql stable security definer set search_path = public as $$ select public.tem_acesso('growth') $$;
create or replace function public.pode_financeiro() returns boolean language sql stable security definer set search_path = public as $$ select public.tem_acesso('financeiro') $$;

-- meus acessos (para o painel montar o menu)
create or replace function public.meus_acessos() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('papel', p.papel, 'acessos', to_jsonb(coalesce(p.acessos, '{}'::text[]))) from public.perfis p where p.id = auth.uid()
$$;
grant execute on function public.meus_acessos() to authenticated;

-- ---------- comercial (CRM) ----------
drop policy if exists "leads: ver" on public.leads; create policy "leads: ver" on public.leads for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "leads: criar" on public.leads; create policy "leads: criar" on public.leads for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "leads: editar" on public.leads; create policy "leads: editar" on public.leads for update to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tarefas: equipe" on public.lead_tarefas; create policy "lead_tarefas: equipe" on public.lead_tarefas for all to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tags: ver" on public.lead_tags; create policy "lead_tags: ver" on public.lead_tags for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tags: criar" on public.lead_tags; create policy "lead_tags: criar" on public.lead_tags for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "lead_tags: remover" on public.lead_tags; create policy "lead_tags: remover" on public.lead_tags for delete to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "observacoes: ver" on public.observacoes; create policy "observacoes: ver" on public.observacoes for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "observacoes: criar" on public.observacoes; create policy "observacoes: criar" on public.observacoes for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial') and autor_id = auth.uid());
drop policy if exists "historico: ver" on public.historico_fases; create policy "historico: ver" on public.historico_fases for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "leads_auditoria: ver" on public.leads_auditoria; create policy "leads_auditoria: ver" on public.leads_auditoria for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "mc_sel" on public.metas_comerciais; create policy "mc_sel" on public.metas_comerciais for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "cs_equipe" on public.comercial_semanas; create policy "cs_equipe" on public.comercial_semanas for all to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "automacoes: ver" on public.automacoes; create policy "automacoes: ver" on public.automacoes for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "automacoes: criar" on public.automacoes; create policy "automacoes: criar" on public.automacoes for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "automacoes: editar" on public.automacoes; create policy "automacoes: editar" on public.automacoes for update to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "execucoes: ver" on public.automacao_execucoes; create policy "execucoes: ver" on public.automacao_execucoes for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: ver" on public.dialogos_chatguru; create policy "dialogos: ver" on public.dialogos_chatguru for select to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: criar" on public.dialogos_chatguru; create policy "dialogos: criar" on public.dialogos_chatguru for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: editar" on public.dialogos_chatguru; create policy "dialogos: editar" on public.dialogos_chatguru for update to authenticated using (public.sou_equipe() and public.tem_acesso('comercial')) with check (public.sou_equipe() and public.tem_acesso('comercial'));
drop policy if exists "dialogos: excluir" on public.dialogos_chatguru; create policy "dialogos: excluir" on public.dialogos_chatguru for delete to authenticated using (public.sou_equipe() and public.tem_acesso('comercial'));

-- ---------- marketing ----------
drop policy if exists "pautas_sel" on public.pautas; create policy "pautas_sel" on public.pautas for select to authenticated using (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pautas_ins" on public.pautas; create policy "pautas_ins" on public.pautas for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pautas_upd" on public.pautas; create policy "pautas_upd" on public.pautas for update to authenticated using (public.sou_equipe() and public.tem_acesso('marketing')) with check (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pcom_sel" on public.pautas_comentarios; create policy "pcom_sel" on public.pautas_comentarios for select to authenticated using (public.sou_equipe() and public.tem_acesso('marketing'));
drop policy if exists "pcom_ins" on public.pautas_comentarios; create policy "pcom_ins" on public.pautas_comentarios for insert to authenticated with check (public.sou_equipe() and public.tem_acesso('marketing') and (autor_id is null or autor_id = auth.uid()));
drop policy if exists "mkp_equipe" on public.marketing_pedidos; create policy "mkp_equipe" on public.marketing_pedidos for all to authenticated using (public.sou_equipe() and public.tem_acesso('marketing')) with check (public.sou_equipe() and public.tem_acesso('marketing'));

-- ---------- equipe: horas dos outros só com a área; as próprias sempre ----------
drop policy if exists "apont_sel" on public.apontamentos_horas; create policy "apont_sel" on public.apontamentos_horas for select to authenticated using (public.sou_equipe() and (public.tem_acesso('equipe') or colaborador_id = public.meu_colaborador()));

select 'ok 0056' as resultado;
