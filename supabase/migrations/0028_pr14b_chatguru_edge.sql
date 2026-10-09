-- 0028 — PR 14b: automações do CRM apontando para a Edge Function "chatguru" (em vez do servidor da Vercel).
-- configurar_automacoes(url) agora recebe a URL base da função (…/functions/v1/chatguru) e agenda o pg_cron
-- para chamar …/automacoes a cada minuto, só quando há passo vencido. Idempotente. Depende de 0027.
create or replace function public.configurar_automacoes(url_funcao text)
returns text language plpgsql security definer set search_path = public as $$
declare
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  endpoint text := rtrim(btrim(url_funcao), '/') || '/automacoes';
begin
  if endpoint !~ '^https://' then
    raise exception 'Informe a URL da função começando com https://';
  end if;
  insert into privado.integracoes (nome, token_sha256, ativa)
  values ('automacoes', encode(sha256(convert_to(token, 'UTF8')), 'hex'), true)
  on conflict (nome) do update set token_sha256 = excluded.token_sha256, ativa = true;
  perform cron.unschedule(jobid) from cron.job where jobname = 'automacoes-np';
  perform cron.schedule('automacoes-np', '* * * * *', format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{}'::jsonb, timeout_milliseconds := 30000) where public.automacoes_ha_trabalho()$cmd$,
    endpoint, 'Bearer ' || token));
  return 'Automações agendadas: ' || endpoint;
end;
$$;
revoke all on function public.configurar_automacoes(text) from public, anon, authenticated;
select 'ok 0028' as resultado;
