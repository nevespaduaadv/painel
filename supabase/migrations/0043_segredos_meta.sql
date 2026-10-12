-- 0043 — Segredos da Meta (Marketing API / Instagram Graph API) no Vault: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_IG_USER_ID, META_PAGE_ID.
-- Lidos só pela Edge Function (chatguru_segredos). Idempotente.
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;
select 'ok 0043' as resultado;
