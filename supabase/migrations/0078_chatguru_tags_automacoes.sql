-- 0078 — Tags do ChatGuru integradas às automações: o webhook sincroniza as tags por diferença (o acionador "tag adicionada"
-- dispara só quando a tag entra) e um POST disparado por diálogo executado pela equipe (URL com &origem=equipe) não conta
-- como "lead respondeu". Com isso, a equipe aplica a tag no ChatGuru por um diálogo (ação TAG + POST PARA URL) e o
-- sistema cria/atualiza o lead e dispara o fluxo na hora, mesmo para leads orgânicos que ainda não estavam no CRM.
-- Idempotente. Depende de 0077.

-- ---------- webhook do ChatGuru: toda mensagem do lead conta como resposta ----------
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
  existia boolean := false;
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
      existia := true;
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

    -- tags: sincroniza por diferença (só insere as novas e remove as que saíram) — assim o acionador
    -- "tag adicionada" dispara uma vez, quando a tag entra, e não a cada mensagem do lead
    if jsonb_typeof(p -> 'tags') = 'array' then
      delete from public.lead_tags lt using public.tags t
       where lt.lead_id = lead and t.id = lt.tag_id
         and lower(t.nome) not in (select lower(btrim(value)) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '');
      for tag_nome in select distinct btrim(value) from jsonb_array_elements_text(p -> 'tags') where btrim(value) <> '' loop
        insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
        insert into public.lead_tags (lead_id, tag_id)
        select lead, id from public.tags where lower(nome) = lower(tag_nome)
        on conflict do nothing;
      end loop;
    end if;

    -- mensagem do contato em lead já existente = "lead respondeu" (pausa a cadência; Novo lead → Em qualificação).
    -- call_log e afins não contam.
    -- "lead respondeu" só quando o POST veio de uma mensagem do contato (diálogos executados pela equipe
    -- mandam origem_execucao = 'equipe' na URL ou o campo executado_por vazio)
    if existia and coalesce(p ->> 'tipo_mensagem', 'chat') not in ('call_log') and coalesce(p ->> '_origem', '') <> 'equipe' then
      perform public.lead_respondeu(lead, case when (p ->> 'datetime_post') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (p ->> 'datetime_post')::timestamptz else now() end);
    end if;

    update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
    return jsonb_build_object('ok', true, 'lead_id', lead, 'meta', m, 'respondeu', existia);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end;
$$;
revoke all on function public.chatguru_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.chatguru_webhook(jsonb) to service_role;


select 'ok 0078' as resultado;
