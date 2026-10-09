-- 0029 — PR 14c: segredos do ChatGuru no Vault, lidos só pela Edge Function (service_role).
-- Gravar/atualizar um segredo (SQL editor, nunca no repo):
--   select public.chatguru_segredo_definir('CHATGURU_API_KEY', '…');
-- Nomes usados: CHATGURU_API_URL, CHATGURU_API_KEY, CHATGURU_ACCOUNT_ID, CHATGURU_PHONE_ID, CHATGURU_WEBHOOK_TOKEN, PAINEL_URL.
-- Idempotente. Depende de 0020 (Vault já em uso) e 0027.

create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração ChatGuru (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração ChatGuru (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;

create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;

select 'ok 0029' as resultado;
