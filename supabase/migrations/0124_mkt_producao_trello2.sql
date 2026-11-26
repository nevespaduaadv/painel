-- 0124 · Produção de conteúdo mais próxima do Trello (vídeo da sócia, 26/11/2026, 14h39)
-- Horário na data de entrega e edição do próprio comentário. Só acrescenta; nada é apagado.

alter table public.mkt_producao add column if not exists hora_entrega time;
alter table public.mkt_producao_comentarios add column if not exists editado_em timestamptz;
drop policy if exists mkpc_upd on public.mkt_producao_comentarios;
create policy mkpc_upd on public.mkt_producao_comentarios for update to authenticated
  using (public.sou_equipe() and autor_id = auth.uid()) with check (public.sou_equipe() and autor_id = auth.uid());
grant update (texto, editado_em) on public.mkt_producao_comentarios to authenticated;
notify pgrst, 'reload schema';

select 'ok 0124' as resultado;
