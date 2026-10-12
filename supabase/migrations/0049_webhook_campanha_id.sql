-- 0049 — Webhook do ChatGuru: o campo "ID Campanha" da ação CRM → POST PARA URL (campanha_id) pode trazer o ID do Meta em qualquer
-- nível (anúncio, conjunto ou campanha). Descobre o nível pela coleta Growth e completa o resto; com ID do Meta, o "Nome Campanha"
-- do ChatGuru é ignorado (o nome vem do Meta, para bater com o Growth).
-- Idempotente. Depende de 0048.

-- resolve um ID numérico do Meta pelo que a coleta já conhece
create or replace function public.leads_completar_meta(p_lead uuid) returns void language plpgsql security definer set search_path = public as $$
declare l record; g record; gen text;
begin
  select id, meta_ad_id, meta_adset_id, meta_campaign_id, campanha, publico, anuncio, meta_source_url into l from public.leads where id = p_lead;
  if l is null then return; end if;
  -- id genérico guardado provisoriamente em meta_campaign_id (campanha_id do ChatGuru) pode ser de anúncio ou conjunto
  gen := coalesce(l.meta_ad_id, l.meta_adset_id, l.meta_campaign_id);
  if gen is null then return; end if;
  select campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name into g from public.growth_meta_anuncios_dia where ad_id = gen order by data desc limit 1;
  if g.ad_id is null then
    select campaign_id, campaign_name, adset_id, adset_name, null::text as ad_id, null::text as ad_name into g from public.growth_meta_anuncios_dia where adset_id = gen order by data desc limit 1;
  end if;
  if g.adset_id is null then
    select campaign_id, campaign_name, null::text as adset_id, null::text as adset_name, null::text as ad_id, null::text as ad_name into g from public.growth_meta_anuncios_dia where campaign_id = gen order by data desc limit 1;
  end if;
  if g.campaign_id is null then return; end if;
  update public.leads set
    meta_ad_id       = coalesce(meta_ad_id, g.ad_id),
    meta_adset_id    = coalesce(case when meta_adset_id = gen and g.adset_id is distinct from gen then null else meta_adset_id end, g.adset_id),
    meta_campaign_id = coalesce(case when meta_campaign_id = gen and g.campaign_id is distinct from gen then null else meta_campaign_id end, g.campaign_id),
    campanha         = coalesce(nullif(campanha, ''), g.campaign_name),
    publico          = coalesce(nullif(publico, ''), g.adset_name),
    anuncio          = coalesce(nullif(anuncio, ''), g.ad_name)
  where id = p_lead;
end $$;

-- meta_ids_do_payload: campanha_id (ação CRM do ChatGuru) entra como id genérico → campaign_id provisório; origem da ação é lida à parte
create or replace function public.meta_ids_de_chatguru(p jsonb) returns jsonb language sql immutable as $$
  select public.meta_ids_do_payload(p) ||
         case when (p ->> 'campanha_id') ~ '^\d{10,}$' and public.meta_ids_do_payload(p) ->> 'ad_id' is null and public.meta_ids_do_payload(p) ->> 'campaign_id' is null
              then jsonb_build_object('campaign_id', p ->> 'campanha_id') else '{}'::jsonb end
$$;

create or replace function public.chatguru_webhook(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id bigint;
  chave text;
  lead uuid;
  tag_nome text;
  email_recebido text;
  mensagem text;
  m jsonb;
begin
  insert into public.webhook_logs (payload) values (p) returning id into log_id;

  begin
    chave := public.normalizar_whatsapp(p ->> 'celular');
    if chave is null then
      raise exception 'Payload sem celular.';
    end if;

    email_recebido := nullif(p ->> 'email', '');
    if email_recebido like '%@c.us' then
      email_recebido := null;
    end if;

    mensagem := left(coalesce(
      nullif(btrim(p ->> 'texto_mensagem'), ''),
      nullif(btrim(p ->> 'mensagem'), ''),
      nullif(btrim(p ->> 'ultima_mensagem'), '')
    ), 2000);

    m := public.meta_ids_de_chatguru(p);

    select id into lead from public.leads where whatsapp_normalizado = chave;

    if lead is null then
      insert into public.leads (
        nome, email, whatsapp, campanha, publico, anuncio, link_chat, chatguru_chat_id, responsavel_chatguru, origem,
        ultima_mensagem, ultima_interacao_em,
        meta_ad_id, meta_adset_id, meta_campaign_id, meta_ctwa_clid, meta_source_url, meta_headline
      )
      values (
        coalesce(nullif(p ->> 'nome', ''), 'Sem nome'),
        email_recebido,
        p ->> 'celular',
        case when m ?| array['ad_id','adset_id','campaign_id'] then m ->> 'campaign_name' else coalesce(m ->> 'campaign_name', nullif(p ->> 'campanha_nome', '')) end,
        m ->> 'adset_name',
        coalesce(m ->> 'ad_name', m ->> 'headline'),
        nullif(p ->> 'link_chat', ''),
        nullif(p ->> 'chat_id', ''),
        nullif(p ->> 'responsavel_nome', ''),
        'chatguru',
        mensagem,
        now(),
        m ->> 'ad_id', m ->> 'adset_id', m ->> 'campaign_id', m ->> 'ctwa_clid', m ->> 'source_url', m ->> 'headline'
      ) returning id into lead;
    else
      update public.leads set
        nome                 = coalesce(nullif(nome, ''), nullif(p ->> 'nome', ''), nome),
        email                = coalesce(email, email_recebido),
        campanha             = coalesce(nullif(campanha, ''), m ->> 'campaign_name', case when m ?| array['ad_id','adset_id','campaign_id'] then null else nullif(p ->> 'campanha_nome', '') end),
        publico              = coalesce(nullif(publico, ''), m ->> 'adset_name'),
        anuncio              = coalesce(nullif(anuncio, ''), m ->> 'ad_name', m ->> 'headline'),
        link_chat            = coalesce(nullif(p ->> 'link_chat', ''), link_chat),
        chatguru_chat_id     = coalesce(nullif(p ->> 'chat_id', ''), chatguru_chat_id),
        responsavel_chatguru = coalesce(nullif(p ->> 'responsavel_nome', ''), responsavel_chatguru),
        ultima_mensagem      = coalesce(mensagem, ultima_mensagem),
        ultima_interacao_em  = now(),
        meta_ad_id           = coalesce(meta_ad_id, m ->> 'ad_id'),
        meta_adset_id        = coalesce(meta_adset_id, m ->> 'adset_id'),
        meta_campaign_id     = coalesce(meta_campaign_id, m ->> 'campaign_id'),
        meta_ctwa_clid       = coalesce(meta_ctwa_clid, m ->> 'ctwa_clid'),
        meta_source_url      = coalesce(meta_source_url, m ->> 'source_url'),
        meta_headline        = coalesce(meta_headline, m ->> 'headline')
      where id = lead;
    end if;

    perform public.leads_completar_meta(lead);

    if jsonb_typeof(p -> 'tags') = 'array' then
      delete from public.lead_tags where lead_id = lead;
      for tag_nome in select distinct btrim(value) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '' loop
        insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
        insert into public.lead_tags (lead_id, tag_id)
        select lead, id from public.tags where nome = tag_nome
        on conflict do nothing;
      end loop;
    end if;

    update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
    return jsonb_build_object('ok', true, 'lead_id', lead, 'meta', m);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end;
$$;
revoke all on function public.chatguru_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.chatguru_webhook(jsonb) to service_role;

select 'ok 0049' as resultado;
