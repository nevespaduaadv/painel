-- 0048 — Leads: IDs do anúncio Meta (campanha / conjunto / anúncio / ctwa_clid) vindos do webhook do ChatGuru.
-- Com o ID do anúncio, a atribuição Growth × CRM deixa de depender do nome digitado e passa a cruzar por ad_id
-- com growth_meta_anuncios_dia (0044). Idempotente. Depende de 0027 (leads/webhook), 0044, 0045 (v_growth_leads).

alter table public.leads add column if not exists meta_ad_id text;
alter table public.leads add column if not exists meta_adset_id text;
alter table public.leads add column if not exists meta_campaign_id text;
alter table public.leads add column if not exists meta_ctwa_clid text;
alter table public.leads add column if not exists meta_source_url text;
alter table public.leads add column if not exists meta_headline text;
create index if not exists leads_meta_ad_idx on public.leads (meta_ad_id) where meta_ad_id is not null;

-- ---------- extrai os identificadores do Meta de um payload qualquer ----------
-- Procura no nível raiz e dentro de campos_personalizados / bot_context / referral / anuncio / ad / meta, com vários apelidos
-- (o ChatGuru deixa o nome das variáveis a cargo de quem monta o diálogo). Números de 10+ dígitos são tratados como ID.
create or replace function public.meta_ids_do_payload(p jsonb) returns jsonb language plpgsql immutable as $$
declare
  fontes jsonb[] := array[p];
  f jsonb; k text; v text; r jsonb := '{}'::jsonb;
  sub text;
  alias_ad   text[] := array['ad_id','meta_ad_id','fb_ad_id','anuncio_id','id_anuncio','id_do_anuncio','source_id','ad','anuncio'];
  alias_set  text[] := array['adset_id','meta_adset_id','conjunto_id','id_conjunto','id_do_conjunto','publico_id','adset'];
  alias_camp text[] := array['campaign_id','meta_campaign_id','campanha_id','id_campanha','id_da_campanha','campaign'];
  alias_clid text[] := array['ctwa_clid','click_id','clid','fbclid'];
  alias_url  text[] := array['source_url','url_anuncio','link_anuncio','ad_url','anuncio_url'];
  alias_head text[] := array['headline','titulo_anuncio','ad_headline','titulo_do_anuncio'];
  alias_cnm  text[] := array['campaign_name','campanha_meta','nome_campanha','meta_campanha'];
  alias_snm  text[] := array['adset_name','publico','conjunto','nome_conjunto','meta_conjunto'];
  alias_anm  text[] := array['ad_name','anuncio_nome','nome_anuncio','meta_anuncio'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return r; end if;
  foreach sub in array array['campos_personalizados','bot_context','referral','anuncio','ad','meta','dados_anuncio','ctwa'] loop
    if jsonb_typeof(p -> sub) = 'object' then fontes := fontes || (p -> sub); end if;
  end loop;
  -- referral aninhado dentro de campos_personalizados/bot_context
  foreach f in array fontes loop
    if jsonb_typeof(f -> 'referral') = 'object' then fontes := fontes || (f -> 'referral'); end if;
  end loop;
  foreach f in array fontes loop
    for k, v in select key, value from jsonb_each_text(f) loop
      if v is null or btrim(v) = '' then continue; end if;
      v := btrim(v); k := lower(k);
      if r ->> 'ad_id' is null and k = any(alias_ad) and v ~ '^\d{10,}$' then r := r || jsonb_build_object('ad_id', v);
      elsif r ->> 'adset_id' is null and k = any(alias_set) and v ~ '^\d{10,}$' then r := r || jsonb_build_object('adset_id', v);
      elsif r ->> 'campaign_id' is null and k = any(alias_camp) and v ~ '^\d{10,}$' then r := r || jsonb_build_object('campaign_id', v);
      elsif r ->> 'ctwa_clid' is null and k = any(alias_clid) then r := r || jsonb_build_object('ctwa_clid', left(v, 300));
      elsif r ->> 'source_url' is null and k = any(alias_url) and v ~* '^https?://' then r := r || jsonb_build_object('source_url', left(v, 500));
      elsif r ->> 'headline' is null and k = any(alias_head) then r := r || jsonb_build_object('headline', left(v, 300));
      elsif r ->> 'campaign_name' is null and k = any(alias_cnm) then r := r || jsonb_build_object('campaign_name', left(v, 200));
      elsif r ->> 'adset_name' is null and k = any(alias_snm) then r := r || jsonb_build_object('adset_name', left(v, 200));
      elsif r ->> 'ad_name' is null and k = any(alias_anm) then r := r || jsonb_build_object('ad_name', left(v, 200));
      end if;
    end loop;
  end loop;
  -- ids dentro de uma URL (ex.: ...?ad_id=123&adset_id=456&campaign_id=789 ou utm_content=ad_id)
  foreach f in array fontes loop
    for v in select value from jsonb_each_text(f) where value ~* 'https?://' loop
      if r ->> 'ad_id' is null then r := r || coalesce(jsonb_build_object('ad_id', (regexp_match(v, '[?&](?:ad_id|utm_content|hsa_ad)=(\d{10,})'))[1]) , '{}') ; end if;
      if r ->> 'adset_id' is null then r := r || coalesce(jsonb_build_object('adset_id', (regexp_match(v, '[?&](?:adset_id|utm_term|hsa_grp)=(\d{10,})'))[1]), '{}'); end if;
      if r ->> 'campaign_id' is null then r := r || coalesce(jsonb_build_object('campaign_id', (regexp_match(v, '[?&](?:campaign_id|utm_campaign|hsa_cam)=(\d{10,})'))[1]), '{}'); end if;
    end loop;
  end loop;
  return jsonb_strip_nulls(r);
end $$;

-- ---------- completa campanha/conjunto/anúncio (ids e nomes) a partir do que a coleta Growth já conhece ----------
create or replace function public.leads_completar_meta(p_lead uuid) returns void language plpgsql security definer set search_path = public as $$
declare l record; g record;
begin
  select id, meta_ad_id, meta_adset_id, meta_campaign_id, campanha, publico, anuncio into l from public.leads where id = p_lead;
  if l is null then return; end if;
  if l.meta_ad_id is not null then
    select campaign_id, campaign_name, adset_id, adset_name, ad_name into g from public.growth_meta_anuncios_dia where ad_id = l.meta_ad_id order by data desc limit 1;
  elsif l.meta_adset_id is not null then
    select campaign_id, campaign_name, adset_id, adset_name, null::text as ad_name into g from public.growth_meta_anuncios_dia where adset_id = l.meta_adset_id order by data desc limit 1;
  elsif l.meta_campaign_id is not null then
    select campaign_id, campaign_name, null::text as adset_id, null::text as adset_name, null::text as ad_name into g from public.growth_meta_anuncios_dia where campaign_id = l.meta_campaign_id order by data desc limit 1;
  else
    return;
  end if;
  if g is null then return; end if;
  update public.leads set
    meta_adset_id    = coalesce(meta_adset_id, g.adset_id),
    meta_campaign_id = coalesce(meta_campaign_id, g.campaign_id),
    campanha         = coalesce(nullif(campanha, ''), g.campaign_name),
    publico          = coalesce(nullif(publico, ''), g.adset_name),
    anuncio          = coalesce(nullif(anuncio, ''), g.ad_name)
  where id = p_lead;
end $$;
revoke all on function public.leads_completar_meta(uuid) from public, anon, authenticated;
grant execute on function public.leads_completar_meta(uuid) to service_role;

-- ---------- webhook do ChatGuru: passa a gravar os ids do Meta ----------
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
      email_recebido := null; -- o ChatGuru envia o número no formato 55...@c.us, não é e-mail real
    end if;

    mensagem := left(coalesce(
      nullif(btrim(p ->> 'texto_mensagem'), ''),
      nullif(btrim(p ->> 'mensagem'), ''),
      nullif(btrim(p ->> 'ultima_mensagem'), '')
    ), 2000);

    m := public.meta_ids_do_payload(p);

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
        coalesce(m ->> 'campaign_name', nullif(p ->> 'campanha_nome', '')),
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
        campanha             = coalesce(nullif(campanha, ''), m ->> 'campaign_name', nullif(p ->> 'campanha_nome', '')),
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

    -- Tags: a lista recebida substitui as tags do lead (só quando o campo vier no payload).
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

-- ---------- v_growth_leads: mesmas colunas + ids do Meta no fim; nomes resolvidos pelo ad_id quando faltarem ----------
create or replace view public.v_growth_leads with (security_invoker = true) as
with h as (
  select lead_id, max(para_fase_id) as fase_max, min(created_at) filter (where para_fase_id >= 3) as qualificado_em,
         min(created_at) filter (where para_fase_id >= 4 and para_fase_id <> 5) as reuniao_agendada_em,
         min(created_at) filter (where para_fase_id >= 6) as reuniao_realizada_em
  from public.historico_fases group by lead_id
),
g as (
  select distinct on (ad_id) ad_id, adset_id, campaign_id, ad_name, adset_name, campaign_name
  from public.growth_meta_anuncios_dia order by ad_id, data desc
)
select l.id, (l.data_entrada at time zone 'America/Sao_Paulo')::date as dia, l.data_entrada, l.origem,
       coalesce(nullif(l.campanha,''), g.campaign_name) as campanha,
       coalesce(nullif(l.publico,''), g.adset_name) as publico,
       coalesce(nullif(l.anuncio,''), g.ad_name) as anuncio,
       l.fase_id, f.nome as fase_nome, l.status, l.motivo_perda, l.valor, l.proprietario_id,
       greatest(l.fase_id, coalesce(h.fase_max, 0)) as fase_max,
       (l.status = 'Ganho' or greatest(l.fase_id, coalesce(h.fase_max,0)) >= 3) as qualificado,
       (l.status = 'Perdido' and greatest(l.fase_id, coalesce(h.fase_max,0)) < 3
          and coalesce(l.motivo_perda,'') ~* 'desqualific|n[ãa]o tem d[ií]vida|d[ií]vida baixa|n[ãa]o tem empresa|\mclt\M|oferecendo|empr[ée]stimo|fake|oculto|n[ãa]o cabe|n[ãa]o quer ficar inadimplente|pessoa f[ií]sica') as desqualificado,
       (l.status = 'Perdido' and greatest(l.fase_id, coalesce(h.fase_max,0)) < 3
          and coalesce(l.motivo_perda,'') ~* 'sem resposta|n[úu]mero errado|n[ãa]o atende|bloqueou|cad[êe]ncia|parou de responder|n[ãa]o encontramos|inv[áa]lido') as sem_contato,
       (greatest(l.fase_id, coalesce(h.fase_max,0)) >= 4 and greatest(l.fase_id, coalesce(h.fase_max,0)) <> 5 or h.reuniao_agendada_em is not null or l.reuniao_em is not null) as reuniao_agendada,
       (greatest(l.fase_id, coalesce(h.fase_max,0)) >= 6 or h.reuniao_realizada_em is not null) as reuniao_realizada,
       (greatest(l.fase_id, coalesce(h.fase_max,0)) >= 7) as proposta,
       (l.status = 'Ganho') as ganho,
       h.qualificado_em, h.reuniao_agendada_em, h.reuniao_realizada_em, l.data_fechamento,
       l.meta_ad_id, coalesce(l.meta_adset_id, g.adset_id) as meta_adset_id, coalesce(l.meta_campaign_id, g.campaign_id) as meta_campaign_id
from public.leads l
join public.fases f on f.id = l.fase_id
left join h on h.lead_id = l.id
left join g on g.ad_id = l.meta_ad_id
where public.pode_growth();

select 'ok 0048' as resultado;
