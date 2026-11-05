-- 0100 — Integração do CRM com automações externas (gestor de tráfego / iMotion):
--   (a) ENTRADA (HTTP): rota POST /chatguru/leads da Edge, token no cabeçalho x-api-token (Vault LEADS_API_TOKEN) → lead_receber_api(p):
--       cria/atualiza o lead pelo WhatsApp, guarda as respostas do formulário e registra no histórico.
--   (b) SAÍDA (webhook): tabela webhooks_saida (url + segredo + fases que disparam). Quando um lead entra numa dessas fases
--       (ex.: Qualificado, Ganho), o banco envia POST JSON para a URL com nome/id da etapa, telefone, nome, valor etc.
-- Idempotente. Depende de 0027 (leads/fases), pg_net.

do $$ begin alter type public.lead_origem add value if not exists 'api'; exception when others then null; end $$;
alter table public.leads add column if not exists respostas jsonb;
-- v_leads precisa ser recriada para expor a coluna nova (l.* é fixado na criação da view)
drop view if exists public.v_leads;
create view public.v_leads with (security_invoker = true) as
select l.*, f.nome as fase_nome, f.ordem as fase_ordem, f.cor as fase_cor, f.prazo_horas, f.dono as fase_dono, f.sigla as fase_sigla,
       coalesce(p.nome, p.email) as proprietario_nome,
       coalesce((select array_agg(t.nome order by t.nome) from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.lead_id = l.id), '{}') as tags,
       (select count(*) from public.observacoes o where o.lead_id = l.id) as total_observacoes,
       extract(day from now() - l.fase_desde)::int as dias_na_fase,
       round(extract(epoch from now() - l.fase_desde) / 3600)::int as horas_na_fase,
       case when l.status <> 'Aberto' or f.prazo_horas is null then 'ok'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) then 'estourado'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) * 0.8 then 'alerta'
            else 'ok' end as atraso,
       (select min(t.quando) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as proxima_tarefa,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as tarefas_abertas,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null and t.quando < now()) as tarefas_vencidas,
       c.nome as cadencia_nome,
       (select max(cp.passo) from public.cadencia_passos cp where cp.cadencia_id = l.cadencia_id) as cadencia_total,
       (select cp.dia from public.cadencia_passos cp where cp.cadencia_id = l.cadencia_id and cp.passo = l.cadencia_passo) as cadencia_dia
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id
left join public.cadencias c on c.id = l.cadencia_id;
revoke all on public.v_leads from anon;


-- ---------- (a) entrada ----------
create or replace function public.lead_receber_api(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tel text; chave text; lid uuid; novo boolean := false; nome_in text; resp jsonb; log_id bigint;
begin
  insert into public.webhook_logs (payload) values (p || '{"_origem":"api_leads"}'::jsonb) returning id into log_id;
  tel := left(btrim(coalesce(p->>'telefone', p->>'whatsapp', p->>'phone', '')), 30);
  chave := public.normalizar_whatsapp(tel);
  if chave is null or length(chave) < 12 then return jsonb_build_object('ok', false, 'erro', 'telefone inválido', 'log', log_id); end if;
  nome_in := nullif(left(btrim(coalesce(p->>'nome', p->>'name', '')), 100), '');
  resp := coalesce(p->'respostas', p->'answers', p->'formulario', '{}'::jsonb);
  select id into lid from public.leads where whatsapp_normalizado = chave order by created_at desc limit 1;
  if lid is null then
    novo := true;
    insert into public.leads (nome, email, whatsapp, empresa, tipo_divida, situacao_divida, valor_divida, outras_dividas, melhor_horario, campanha, publico, anuncio,
                              meta_ad_id, meta_adset_id, meta_campaign_id, meta_ctwa_clid, meta_source_url, meta_headline, origem, externo_id, fase_id, data_entrada)
    values (coalesce(nome_in, 'Lead ' || right(chave, 4)), nullif(lower(left(btrim(coalesce(p->>'email','')),120)),''), tel, nullif(left(btrim(coalesce(p->>'empresa','')),120),''),
            nullif(left(coalesce(p->>'tipo_divida', resp->>'tipo_divida', ''),80),''), nullif(left(coalesce(p->>'situacao_divida', resp->>'situacao_divida', ''),80),''),
            nullif(left(coalesce(p->>'valor_divida', resp->>'valor_divida', ''),60),''), nullif(left(coalesce(p->>'outras_dividas', resp->>'outras_dividas', ''),200),''),
            nullif(left(coalesce(p->>'melhor_horario', resp->>'melhor_horario', ''),60),''),
            nullif(left(coalesce(p->>'campanha', p->>'campaign_name', ''),120),''), nullif(left(coalesce(p->>'publico', p->>'adset_name', ''),120),''), nullif(left(coalesce(p->>'anuncio', p->>'ad_name', ''),120),''),
            nullif(p->>'meta_ad_id',''), nullif(p->>'meta_adset_id',''), nullif(p->>'meta_campaign_id',''), nullif(p->>'ctwa_clid',''), nullif(p->>'source_url',''), nullif(p->>'headline',''),
            'api', nullif(p->>'externo_id',''), 1, current_date)
    returning id into lid;
  else
    update public.leads set
      nome = coalesce(nome, nome_in), email = coalesce(email, nullif(lower(p->>'email'),'')), empresa = coalesce(empresa, nullif(p->>'empresa','')),
      tipo_divida = coalesce(tipo_divida, nullif(coalesce(p->>'tipo_divida', resp->>'tipo_divida'),'')), situacao_divida = coalesce(situacao_divida, nullif(coalesce(p->>'situacao_divida', resp->>'situacao_divida'),'')),
      valor_divida = coalesce(valor_divida, nullif(coalesce(p->>'valor_divida', resp->>'valor_divida'),'')), outras_dividas = coalesce(outras_dividas, nullif(coalesce(p->>'outras_dividas', resp->>'outras_dividas'),'')),
      campanha = coalesce(campanha, nullif(coalesce(p->>'campanha', p->>'campaign_name'),'')), publico = coalesce(publico, nullif(coalesce(p->>'publico', p->>'adset_name'),'')), anuncio = coalesce(anuncio, nullif(coalesce(p->>'anuncio', p->>'ad_name'),'')),
      meta_ad_id = coalesce(meta_ad_id, nullif(p->>'meta_ad_id','')), meta_adset_id = coalesce(meta_adset_id, nullif(p->>'meta_adset_id','')), meta_campaign_id = coalesce(meta_campaign_id, nullif(p->>'meta_campaign_id','')),
      externo_id = coalesce(externo_id, nullif(p->>'externo_id','')), updated_at = now()
    where id = lid;
  end if;
  -- respostas do formulário ficam no lead (jsonb), mescladas às anteriores
  if jsonb_typeof(resp) = 'object' and resp <> '{}'::jsonb then
    update public.leads set respostas = coalesce(respostas, '{}'::jsonb) || resp || jsonb_build_object('_recebido_em', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '_fonte', coalesce(p->>'fonte', 'api')) where id = lid;
  end if;
  update public.webhook_logs set payload = payload || jsonb_build_object('_lead', lid, '_novo', novo) where id = log_id;
  return jsonb_build_object('ok', true, 'lead_id', lid, 'novo', novo);
exception when others then
  update public.webhook_logs set payload = payload || jsonb_build_object('_erro', sqlerrm) where id = log_id;
  return jsonb_build_object('ok', false, 'erro', sqlerrm, 'log', log_id);
end $$;
revoke all on function public.lead_receber_api(jsonb) from public, anon, authenticated;

-- ---------- (b) saída ----------
create table if not exists public.webhooks_saida (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  url text not null,
  segredo text,                                   -- enviado no cabeçalho X-Webhook-Token
  eventos text[] not null default '{lead_fase}',  -- lead_fase (por enquanto o único)
  fases integer[],                                -- null = todas as fases; ex.: {3,10} = Qualificado e Ganho
  ativo boolean not null default true,
  ultimo_envio_em timestamptz, ultimo_status text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
alter table public.webhooks_saida enable row level security;
drop policy if exists "webhooks_saida: admin" on public.webhooks_saida;
create policy "webhooks_saida: admin" on public.webhooks_saida for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.webhooks_saida from anon;

create table if not exists public.webhooks_envios (
  id bigserial primary key, webhook_id uuid references public.webhooks_saida (id) on delete cascade,
  evento text, lead_id uuid, corpo jsonb, request_id bigint, created_at timestamptz not null default now()
);
alter table public.webhooks_envios enable row level security;
drop policy if exists "webhooks_envios: admin" on public.webhooks_envios;
create policy "webhooks_envios: admin" on public.webhooks_envios for select to authenticated using (public.sou_admin());
revoke all on public.webhooks_envios from anon;

create or replace function public.webhook_lead_fase_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare w record; corpo jsonb; fnome text; fant text; rid bigint;
begin
  if tg_op = 'UPDATE' and new.fase_id is not distinct from old.fase_id then return new; end if;
  select nome into fnome from public.fases where id = new.fase_id;
  if tg_op = 'UPDATE' then select nome into fant from public.fases where id = old.fase_id; end if;
  for w in select * from public.webhooks_saida where ativo and 'lead_fase' = any(eventos) and (fases is null or new.fase_id = any(fases)) loop
    corpo := jsonb_build_object('evento', 'lead_fase', 'lead_id', new.id, 'nome', new.nome, 'telefone', new.whatsapp_normalizado, 'email', new.email, 'empresa', new.empresa,
                                'etapa_id', new.fase_id, 'etapa', fnome, 'etapa_anterior_id', case when tg_op = 'UPDATE' then old.fase_id end, 'etapa_anterior', fant,
                                'valor', new.valor, 'origem', new.origem, 'campanha', new.campanha, 'anuncio', new.anuncio, 'meta_ad_id', new.meta_ad_id, 'externo_id', new.externo_id,
                                'data_entrada', new.data_entrada, 'data_fechamento', new.data_fechamento, 'quando', now());
    begin
      select net.http_post(url := w.url, headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Token', coalesce(w.segredo, '')), body := corpo, timeout_milliseconds := 8000) into rid;
      update public.webhooks_saida set ultimo_envio_em = now(), ultimo_status = 'enviado (req ' || rid || ')' where id = w.id;
    exception when others then
      update public.webhooks_saida set ultimo_envio_em = now(), ultimo_status = 'erro: ' || sqlerrm where id = w.id;
    end;
    insert into public.webhooks_envios (webhook_id, evento, lead_id, corpo, request_id) values (w.id, 'lead_fase', new.id, corpo, rid);
  end loop;
  return new;
end $$;
drop trigger if exists leads_webhook_fase on public.leads;
create trigger leads_webhook_fase after insert or update of fase_id on public.leads for each row execute procedure public.webhook_lead_fase_tg();

-- token de entrada: cria no Vault se não existir e mostra UMA vez no resultado (copie para a automação; nunca cole no chat)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'LEADS_API_TOKEN') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'LEADS_API_TOKEN', 'token da rota /chatguru/leads (automações externas)');
  end if;
end $$;
select 'ok 0100' as resultado, (select decrypted_secret from vault.decrypted_secrets where name = 'LEADS_API_TOKEN') as leads_api_token,
       'https://ksdwzljfjfucjevdqxvx.supabase.co/functions/v1/chatguru/leads' as url_entrada;
