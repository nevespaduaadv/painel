-- 0053 — o cron das automações (automacoes-np, a cada minuto) só chama a Edge Function quando há trabalho;
-- passa a considerar também a fila de mensagens para clientes (0052). Idempotente.
create or replace function public.automacoes_ha_trabalho() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.automacao_execucoes e join public.automacoes a on a.id = e.automacao_id
    where (e.status = 'pendente' and e.executar_em <= now()
           and (not a.ativa or not a.so_horario_comercial or public.em_horario_comercial(now())))
       or (e.status = 'processando' and e.atualizado_em < now() - interval '10 minutes')
  ) or exists (
    select 1 from public.mensagens_fila m
    where (m.status = 'pendente' and m.enviar_em <= now() and m.numero is not null and public.em_horario_comercial(now()))
       or (m.status = 'processando' and m.atualizado_em < now() - interval '10 minutes')
  );
$$;
select 'ok 0053' as resultado;
