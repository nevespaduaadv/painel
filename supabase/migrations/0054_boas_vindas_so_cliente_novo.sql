-- 0054 — boas-vindas automáticas só para cliente realmente novo (sem data de fechamento ou fechado nos últimos 30 dias);
-- cadastro de cliente antigo (migração/histórico) não dispara WhatsApp — a equipe pode enviar pelo botão na ficha. Idempotente.
create or replace function public.clientes_boas_vindas_auto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.ativo, true) and (new.data_fechamento is null or new.data_fechamento >= current_date - 30) then
    perform public.onboarding_enviar_boas_vindas(new.id);
  end if;
  return new;
end $$;
select 'ok 0054' as resultado;
