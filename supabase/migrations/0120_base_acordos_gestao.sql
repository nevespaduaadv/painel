-- 0120 · Base de acordos só para a gestão (decisão das sócias, 25/11/2026)
-- Antes: toda a equipe lia e alterava public.historico (política hist_all, 0001).
-- Agora: só administradoras leem, alteram e excluem; a equipe apenas INCLUI (alimenta a base ao concluir um acordo).
-- As projeções da equipe seguem pela visão anônima public.referencias (credor, grupo, forma, desconto, data, status),
-- que já existia para o cliente e não muda aqui.
-- Reversão: recriar hist_all (for all … using sou_equipe() with check sou_equipe()) e remover as quatro políticas abaixo.

begin;

drop policy if exists hist_all on public.historico;
drop policy if exists hist_sel on public.historico;
drop policy if exists hist_ins on public.historico;
drop policy if exists hist_upd on public.historico;
drop policy if exists hist_del on public.historico;

create policy hist_sel on public.historico for select to authenticated using (public.sou_admin());
create policy hist_ins on public.historico for insert to authenticated with check (public.sou_equipe());
create policy hist_upd on public.historico for update to authenticated using (public.sou_admin()) with check (public.sou_admin());
create policy hist_del on public.historico for delete to authenticated using (public.sou_admin());

-- marca, na negociação, que o acordo já foi levado à base (id do registro ou 'registrado')
alter table public.negociacoes add column if not exists base_acordo_id text;

commit;
