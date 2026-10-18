-- 0072 — Correção: gen_random_bytes (pgcrypto) fica no schema "extensions" no Supabase; funções com search_path = public
-- (lead_fechar → insert em clientes → gatilho do token de onboarding) não o encontravam. Idempotente.
create or replace function public.clientes_token_onboarding() returns trigger language plpgsql as $$
begin
  if new.onboarding_token is null then new.onboarding_token := encode(extensions.gen_random_bytes(24), 'hex'); end if;
  return new;
end $$;
alter function public.onboarding_enviar_boas_vindas(text, timestamptz) set search_path = public, extensions;
select 'ok 0072' as resultado;
