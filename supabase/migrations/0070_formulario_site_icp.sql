-- 0070 — Formulário do site: campos do ICP (empresa, faixa e situação da dívida, descrição) no lead; sem responsável
-- do comercial com login, o aviso vai para as sócias. Substitui a função de 0069. Idempotente.

create or replace function public.site_formulario(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id   bigint;
  cfg      jsonb;
  nome_in  text;
  tel_in   text;
  chave    text;
  email_in text;
  msg      text;
  area     text;
  ip       text;
  motivo   text;
  lead     uuid;
  novo     boolean := false;
  resp_col uuid;
  resp_per uuid;
  painel   text;
  canal    text;
  recentes integer;
  empresa_in text;
  valor_in text;
  situacao_in text;
  socio uuid;
begin
  insert into public.webhook_logs (payload) values (p || '{"_origem":"site"}'::jsonb) returning id into log_id;
  select dados into cfg from public.escritorio where id = 'site';
  begin
  nome_in  := left(btrim(coalesce(p ->> 'nome', '')), 100);
  tel_in   := left(btrim(coalesce(p ->> 'telefone', '')), 30);
  email_in := lower(left(btrim(coalesce(p ->> 'email', '')), 120));
  msg      := left(btrim(coalesce(nullif(p ->> 'mensagem', ''), p ->> 'descricaoSituacao', '')), 1500);
  area     := nullif(left(btrim(coalesce(p ->> 'area', '')), 80), '');
  empresa_in := nullif(left(btrim(coalesce(p ->> 'empresa', '')), 120), '');
  valor_in   := nullif(left(btrim(coalesce(p ->> 'valorDivida', p ->> 'valor_divida', '')), 60), '');
  situacao_in := nullif(left(btrim(coalesce(p ->> 'situacaoDivida', p ->> 'situacao_divida', '')), 60), '');
  ip       := nullif(p ->> '_ip', '');
  chave    := public.normalizar_whatsapp(tel_in);

  -- ---- filtro de spam (nada disso vira lead; fica só no log) ----
  if coalesce(p ->> 'hp', '') <> '' then motivo := 'honeypot preenchido';
  elsif (p ->> 't') ~ '^\d+$' and (p ->> 't')::bigint < 2500 then motivo := 'envio rápido demais';
  elsif length(regexp_replace(nome_in, '[^[:alpha:]]', '', 'g')) < 2 then motivo := 'nome inválido';
  elsif nome_in ~ '[Ѐ-ӿ一-鿿぀-ヿ؀-ۿ]' or msg ~ '[Ѐ-ӿ一-鿿぀-ヿ]' then motivo := 'alfabeto estrangeiro';
  elsif (length(msg) - length(replace(lower(msg), 'http', ''))) / 4 >= 2 then motivo := 'links na mensagem';
  elsif chave is null then motivo := 'telefone inválido';
  elsif email_in <> '' and email_in !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then motivo := 'e-mail inválido';
  end if;
  if motivo is null and ip is not null then
    select count(*) into recentes from public.webhook_logs
     where payload ->> '_origem' = 'site' and payload ->> '_ip' = ip and created_at > now() - interval '1 hour' and id <> log_id;
    if recentes >= 5 then motivo := 'muitos envios do mesmo IP'; end if;
  end if;
  if motivo is not null then
    update public.webhook_logs set status = 'spam', erro = motivo where id = log_id;
    return jsonb_build_object('ok', true, 'spam', true, 'motivo', motivo);
  end if;

  -- ---- responsável ----
  resp_col := nullif(cfg ->> 'responsavel_id', '')::uuid;
  if resp_col is null then resp_col := public.responsavel_padrao('comercial'); end if;
  select perfil_id into resp_per from public.colaboradores where id = resp_col;

  -- ---- lead: um por WhatsApp ----
  select id into lead from public.leads where whatsapp_normalizado = chave;
  if lead is null then
    novo := true;
    insert into public.leads (nome, email, whatsapp, empresa, tipo_divida, valor_divida, situacao_divida, campanha, origem, ultima_mensagem, ultima_interacao_em, proprietario_id)
    values (nome_in, nullif(email_in, ''), tel_in, empresa_in, area, valor_in, situacao_in, coalesce(cfg ->> 'campanha', 'Site institucional'), 'site',
            nullif(msg, ''), now(), resp_per)
    returning id into lead;
  else
    update public.leads set
      nome                = coalesce(nullif(nome, ''), nome_in),
      email               = coalesce(email, nullif(email_in, '')),
      empresa             = coalesce(empresa, empresa_in),
      tipo_divida         = coalesce(tipo_divida, area),
      valor_divida        = coalesce(valor_divida, valor_in),
      situacao_divida     = coalesce(situacao_divida, situacao_in),
      ultima_mensagem     = coalesce(nullif(msg, ''), ultima_mensagem),
      ultima_interacao_em = now(),
      proprietario_id     = coalesce(proprietario_id, resp_per)
    where id = lead;
  end if;

  -- ---- avisos ----
  painel := public.painel_url();
  resp_per := coalesce((select proprietario_id from public.leads where id = lead), resp_per);
  if resp_per is not null then
    perform public.notificar(resp_per,
      case when novo then 'Lead novo pelo site' else 'Lead voltou a escrever pelo site' end,
      nome_in || coalesce(' · ' || empresa_in, '') || coalesce(' · ' || valor_in, '') || coalesce(' · ' || situacao_in, '') || coalesce(E'\n' || left(msg, 300), ''),
      '#leads/' || lead::text);
  else -- ninguém do comercial com login ainda: avisa as sócias
    for socio in select perfil_id from public.colaboradores where ativo and nucleo = 'socios' and perfil_id is not null loop
      perform public.notificar(socio, 'Lead novo pelo site (sem responsável)', nome_in || coalesce(' · ' || empresa_in, ''), '#leads/' || lead::text);
    end loop;
  end if;
  canal := nullif(cfg ->> 'canal_discord', '');
  if canal is not null then
    insert into public.discord_fila (canal_discord, texto, referencia)
    values (canal,
      '🌐 **' || case when novo then 'Lead novo pelo site' else 'Lead voltou a escrever pelo site' end || '** — ' || nome_in
      || coalesce(E'\n' || 'Empresa: ' || empresa_in, '') || coalesce(E'\n' || 'Dívida: ' || valor_in, '') || coalesce(' · ' || situacao_in, '') || coalesce(E'\n' || 'Área: ' || area, '') || coalesce(E'\n' || '> ' || left(msg, 600), '')
      || E'\n' || painel || '/#leads/' || lead::text,
      'site:' || log_id::text);
  end if;

  update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
  return jsonb_build_object('ok', true, 'lead_id', lead, 'novo', novo);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end $$;
revoke all on function public.site_formulario(jsonb) from public, anon, authenticated;
grant execute on function public.site_formulario(jsonb) to service_role;

select 'ok 0070' as resultado;
