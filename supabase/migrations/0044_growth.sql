-- 0044 — Growth: snapshots diários do Meta Ads (Marketing API) e do Instagram (Graph API) + classificação dos leads do CRM
-- para o cruzamento mídia × comercial (skill head-of-growth). Coleta pela Edge Function chatguru (rota /growth), agendada no pg_cron.
-- Leitura: equipe. Escrita: só a RPC growth_gravar (service_role). Idempotente. Depende de 0027 (leads), 0028 (automações), 0043 (META_*).

-- ---------- Meta Ads: dia × anúncio (com campanha e conjunto) ----------
create table if not exists public.growth_meta_anuncios_dia (
  data date not null,
  ad_id text not null,
  ad_name text, adset_id text, adset_name text, campaign_id text, campaign_name text, objective text,
  spend numeric(12,2) not null default 0,
  impressions integer not null default 0, reach integer not null default 0, frequency numeric(8,3),
  clicks integer not null default 0, link_clicks integer not null default 0,
  leads integer not null default 0, conversas integer not null default 0,
  acoes jsonb,                                            -- actions brutos (action_type → value)
  atualizado_em timestamptz not null default now(),
  primary key (data, ad_id)
);
create index if not exists growth_meta_anuncios_campanha_idx on public.growth_meta_anuncios_dia (campaign_id, data);
alter table public.growth_meta_anuncios_dia enable row level security;
drop policy if exists "growth: equipe le" on public.growth_meta_anuncios_dia;
create policy "growth: equipe le" on public.growth_meta_anuncios_dia for select to authenticated using (public.sou_equipe());

-- ---------- Meta Ads: dia × conta (alcance/frequência não somam entre anúncios) ----------
create table if not exists public.growth_meta_conta_dia (
  data date primary key,
  spend numeric(12,2) not null default 0,
  impressions integer not null default 0, reach integer not null default 0, frequency numeric(8,3),
  clicks integer not null default 0, link_clicks integer not null default 0,
  leads integer not null default 0, conversas integer not null default 0,
  acoes jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.growth_meta_conta_dia enable row level security;
drop policy if exists "growth: equipe le" on public.growth_meta_conta_dia;
create policy "growth: equipe le" on public.growth_meta_conta_dia for select to authenticated using (public.sou_equipe());

-- ---------- Instagram: dia × conta ----------
create table if not exists public.growth_ig_dia (
  data date primary key,
  reach integer, profile_views integer, accounts_engaged integer, total_interactions integer,
  follower_count integer,            -- novos seguidores no dia (API)
  followers_total integer,           -- total de seguidores no momento da coleta
  website_clicks integer,
  atualizado_em timestamptz not null default now()
);
alter table public.growth_ig_dia enable row level security;
drop policy if exists "growth: equipe le" on public.growth_ig_dia;
create policy "growth: equipe le" on public.growth_ig_dia for select to authenticated using (public.sou_equipe());

-- ---------- Instagram: publicações (últimas) ----------
create table if not exists public.growth_ig_posts (
  id text primary key,
  publicado_em timestamptz, media_type text, media_product_type text, caption text, permalink text,
  like_count integer, comments_count integer, reach integer, saved integer, shares integer, views integer, total_interactions integer,
  atualizado_em timestamptz not null default now()
);
create index if not exists growth_ig_posts_data_idx on public.growth_ig_posts (publicado_em desc);
alter table public.growth_ig_posts enable row level security;
drop policy if exists "growth: equipe le" on public.growth_ig_posts;
create policy "growth: equipe le" on public.growth_ig_posts for select to authenticated using (public.sou_equipe());

-- ---------- log das coletas ----------
create table if not exists public.growth_coletas (
  id bigserial primary key,
  iniciado_em timestamptz not null default now(), terminado_em timestamptz,
  ok boolean, erro text, detalhes jsonb
);
alter table public.growth_coletas enable row level security;
drop policy if exists "growth: equipe le" on public.growth_coletas;
create policy "growth: equipe le" on public.growth_coletas for select to authenticated using (public.sou_equipe());

-- ---------- gravação (Edge Function, service_role) ----------
create or replace function public.growth_gravar(meta_anuncios jsonb default '[]', meta_conta jsonb default '[]', ig_dias jsonb default '[]', ig_posts jsonb default '[]', log jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n1 int := 0; n2 int := 0; n3 int := 0; n4 int := 0;
begin
  insert into public.growth_meta_anuncios_dia (data, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, objective, spend, impressions, reach, frequency, clicks, link_clicks, leads, conversas, acoes, atualizado_em)
  select (r->>'data')::date, r->>'ad_id', r->>'ad_name', r->>'adset_id', r->>'adset_name', r->>'campaign_id', r->>'campaign_name', r->>'objective',
         coalesce((r->>'spend')::numeric,0), coalesce((r->>'impressions')::int,0), coalesce((r->>'reach')::int,0), (r->>'frequency')::numeric,
         coalesce((r->>'clicks')::int,0), coalesce((r->>'link_clicks')::int,0), coalesce((r->>'leads')::int,0), coalesce((r->>'conversas')::int,0), r->'acoes', now()
  from jsonb_array_elements(coalesce(meta_anuncios,'[]'::jsonb)) r where r->>'data' is not null and r->>'ad_id' is not null
  on conflict (data, ad_id) do update set ad_name = excluded.ad_name, adset_id = excluded.adset_id, adset_name = excluded.adset_name, campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name,
    objective = excluded.objective, spend = excluded.spend, impressions = excluded.impressions, reach = excluded.reach, frequency = excluded.frequency, clicks = excluded.clicks, link_clicks = excluded.link_clicks,
    leads = excluded.leads, conversas = excluded.conversas, acoes = excluded.acoes, atualizado_em = now();
  get diagnostics n1 = row_count;

  insert into public.growth_meta_conta_dia (data, spend, impressions, reach, frequency, clicks, link_clicks, leads, conversas, acoes, atualizado_em)
  select (r->>'data')::date, coalesce((r->>'spend')::numeric,0), coalesce((r->>'impressions')::int,0), coalesce((r->>'reach')::int,0), (r->>'frequency')::numeric,
         coalesce((r->>'clicks')::int,0), coalesce((r->>'link_clicks')::int,0), coalesce((r->>'leads')::int,0), coalesce((r->>'conversas')::int,0), r->'acoes', now()
  from jsonb_array_elements(coalesce(meta_conta,'[]'::jsonb)) r where r->>'data' is not null
  on conflict (data) do update set spend = excluded.spend, impressions = excluded.impressions, reach = excluded.reach, frequency = excluded.frequency, clicks = excluded.clicks, link_clicks = excluded.link_clicks,
    leads = excluded.leads, conversas = excluded.conversas, acoes = excluded.acoes, atualizado_em = now();
  get diagnostics n2 = row_count;

  insert into public.growth_ig_dia (data, reach, profile_views, accounts_engaged, total_interactions, follower_count, followers_total, website_clicks, atualizado_em)
  select (r->>'data')::date, (r->>'reach')::int, (r->>'profile_views')::int, (r->>'accounts_engaged')::int, (r->>'total_interactions')::int, (r->>'follower_count')::int, (r->>'followers_total')::int, (r->>'website_clicks')::int, now()
  from jsonb_array_elements(coalesce(ig_dias,'[]'::jsonb)) r where r->>'data' is not null
  on conflict (data) do update set reach = coalesce(excluded.reach, growth_ig_dia.reach), profile_views = coalesce(excluded.profile_views, growth_ig_dia.profile_views),
    accounts_engaged = coalesce(excluded.accounts_engaged, growth_ig_dia.accounts_engaged), total_interactions = coalesce(excluded.total_interactions, growth_ig_dia.total_interactions),
    follower_count = coalesce(excluded.follower_count, growth_ig_dia.follower_count), followers_total = coalesce(excluded.followers_total, growth_ig_dia.followers_total),
    website_clicks = coalesce(excluded.website_clicks, growth_ig_dia.website_clicks), atualizado_em = now();
  get diagnostics n3 = row_count;

  insert into public.growth_ig_posts (id, publicado_em, media_type, media_product_type, caption, permalink, like_count, comments_count, reach, saved, shares, views, total_interactions, atualizado_em)
  select r->>'id', (r->>'publicado_em')::timestamptz, r->>'media_type', r->>'media_product_type', left(r->>'caption', 600), r->>'permalink',
         (r->>'like_count')::int, (r->>'comments_count')::int, (r->>'reach')::int, (r->>'saved')::int, (r->>'shares')::int, (r->>'views')::int, (r->>'total_interactions')::int, now()
  from jsonb_array_elements(coalesce(ig_posts,'[]'::jsonb)) r where r->>'id' is not null
  on conflict (id) do update set publicado_em = excluded.publicado_em, media_type = excluded.media_type, media_product_type = excluded.media_product_type, caption = excluded.caption, permalink = excluded.permalink,
    like_count = excluded.like_count, comments_count = excluded.comments_count, reach = coalesce(excluded.reach, growth_ig_posts.reach), saved = coalesce(excluded.saved, growth_ig_posts.saved),
    shares = coalesce(excluded.shares, growth_ig_posts.shares), views = coalesce(excluded.views, growth_ig_posts.views), total_interactions = coalesce(excluded.total_interactions, growth_ig_posts.total_interactions), atualizado_em = now();
  get diagnostics n4 = row_count;

  if log is not null then
    insert into public.growth_coletas (terminado_em, ok, erro, detalhes) values (now(), coalesce((log->>'ok')::boolean, true), log->>'erro', log - 'ok' - 'erro' || jsonb_build_object('meta_anuncios', n1, 'meta_conta', n2, 'ig_dias', n3, 'ig_posts', n4));
  end if;
  return jsonb_build_object('meta_anuncios', n1, 'meta_conta', n2, 'ig_dias', n3, 'ig_posts', n4);
end $$;
revoke all on function public.growth_gravar(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.growth_gravar(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ---------- leads do CRM classificados (regras da skill: avaliado = qualificado ou desqualificado; "Perdido" sozinho não desqualifica) ----------
create or replace view public.v_growth_leads with (security_invoker = true) as
with h as (
  select lead_id, max(para_fase_id) as fase_max, min(created_at) filter (where para_fase_id >= 3) as qualificado_em,
         min(created_at) filter (where para_fase_id >= 4 and para_fase_id <> 5) as reuniao_agendada_em,
         min(created_at) filter (where para_fase_id >= 6) as reuniao_realizada_em
  from public.historico_fases group by lead_id
)
select l.id, (l.data_entrada at time zone 'America/Sao_Paulo')::date as dia, l.data_entrada, l.origem, l.campanha, l.publico, l.anuncio,
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
       h.qualificado_em, h.reuniao_agendada_em, h.reuniao_realizada_em, l.data_fechamento
from public.leads l
join public.fases f on f.id = l.fase_id
left join h on h.lead_id = l.id;

-- última coleta (para a tela)
create or replace function public.growth_status() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ultima_coleta', (select to_jsonb(c) from (select iniciado_em, terminado_em, ok, erro, detalhes from public.growth_coletas order by id desc limit 1) c),
    'meta_primeiro_dia', (select min(data) from public.growth_meta_conta_dia), 'meta_ultimo_dia', (select max(data) from public.growth_meta_conta_dia),
    'ig_primeiro_dia', (select min(data) from public.growth_ig_dia), 'ig_ultimo_dia', (select max(data) from public.growth_ig_dia),
    'ig_posts', (select count(*) from public.growth_ig_posts),
    'cron', (select jsonb_build_object('schedule', schedule) from cron.job where jobname = 'growth-np'));
$$;
revoke all on function public.growth_status() from public, anon;
grant execute on function public.growth_status() to authenticated;

-- ---------- agendamento: 06:40 America/Sao_Paulo, todo dia (09:40 UTC), mesma URL/token das automações ----------
create or replace function public.configurar_growth(hora_brt integer default 6, minuto integer default 40) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes) — a coleta usa o mesmo token.'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/growth');
  if auth is null or endpoint is null then raise exception 'Não foi possível ler a URL/token das automações.'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'growth-np';
  perform cron.schedule('growth-np', format('%s %s * * *', minuto, (hora_brt + 3) % 24), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{"dias":3}'::jsonb, timeout_milliseconds := 120000)$cmd$,
    endpoint, auth));
  return 'Coleta de Growth agendada para ' || hora_brt || 'h' || lpad(minuto::text, 2, '0') || ' (todo dia) em ' || endpoint;
end $$;
revoke all on function public.configurar_growth(integer, integer) from public, anon, authenticated;

select public.configurar_growth(6, 40) as resultado;
