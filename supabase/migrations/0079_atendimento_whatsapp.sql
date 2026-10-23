-- 0079 — Atendimento (WhatsApp) dentro do sistema: filas (setores) administradas pelos admins, conversas por contato
-- (ChatGuru por baixo: entrada pelo webhook, saída pela API), mensagens recebidas/enviadas, notas internas só da equipe,
-- eventos (assumida, transferida, resolvida, reaberta), respostas rápidas e SLA em horário comercial.
-- Decisões (23/10/2026): toda conversa nova começa na fila Comercial e é transferida manualmente; administradores
-- veem tudo, colaboradores só as filas em que forem incluídos (ou cuja área tenham); o sistema recebe 24h, o SLA conta
-- só em horário comercial. Idempotente. Depende de 0078.

-- ---------- filas ----------
create table if not exists public.atd_filas (
  id serial primary key,
  nome text not null,
  slug text not null unique,
  cor text not null default '#B8964A',
  ordem integer not null default 0,
  ativa boolean not null default true,
  areas text[] not null default '{}',          -- quem tem alguma dessas áreas (perfis.acessos) vê a fila
  membros uuid[] not null default '{}',        -- inclusão manual pelos administradores
  sla_primeira_resposta_min integer not null default 15,
  sla_resolucao_horas integer not null default 24,
  mensagem_boas_vindas text,
  mensagem_encerramento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.atd_filas (nome, slug, cor, ordem, areas) values
  ('Comercial',  'comercial',  '#2E7D5B', 1, '{comercial}'),
  ('Financeiro', 'financeiro', '#B8964A', 2, '{financeiro}'),
  ('Jurídico',   'juridico',   '#0C1F38', 3, '{juridico}'),
  ('Pós-vendas', 'pos_vendas', '#6A4C93', 4, '{}')
on conflict (slug) do nothing;

-- ---------- conversas ----------
create sequence if not exists public.atd_protocolo_seq;
create table if not exists public.atd_conversas (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique default (to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMM') || '-' || lpad(nextval('public.atd_protocolo_seq')::text, 5, '0')),
  chatguru_chat_id text unique,
  whatsapp text,
  whatsapp_normalizado text,
  nome_contato text,
  link_chat text,
  cliente_id text references public.clientes (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  fila_id integer references public.atd_filas (id) on delete set null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  status text not null default 'nova' check (status in ('nova','aguardando','em_atendimento','pendente_contato','resolvida')),
  aberta_em timestamptz not null default now(),
  primeira_resposta_em timestamptz,
  sla_resposta_ate timestamptz,                 -- limite da 1ª resposta (horário comercial)
  ultima_msg_em timestamptz,
  ultima_msg_contato_em timestamptz,
  ultima_msg_texto text,
  resolvida_em timestamptz,
  resolvida_por uuid references public.perfis (id) on delete set null,
  nao_lidas integer not null default 0,
  tags text[] not null default '{}',
  campos jsonb not null default '{}',           -- campos personalizados do ChatGuru (último payload)
  responsavel_chatguru text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists atd_conversas_fila_idx on public.atd_conversas (fila_id, status, ultima_msg_em desc);
create index if not exists atd_conversas_resp_idx on public.atd_conversas (responsavel_id, status);
create index if not exists atd_conversas_wa_idx on public.atd_conversas (whatsapp_normalizado);
create index if not exists atd_conversas_cliente_idx on public.atd_conversas (cliente_id);
create index if not exists atd_conversas_lead_idx on public.atd_conversas (lead_id);

-- ---------- mensagens ----------
create table if not exists public.atd_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.atd_conversas (id) on delete cascade,
  direcao text not null check (direcao in ('in','out','nota','sistema')),
  tipo text not null default 'chat',            -- chat | image | audio | video | document | sticker | call_log | sistema
  texto text,
  arquivo_url text,                             -- URL original do ChatGuru (pode expirar)
  arquivo_path text,                            -- cópia no bucket 'atendimento'
  arquivo_nome text,
  mime text,
  autor_id uuid references public.perfis (id) on delete set null,
  autor_nome text,
  status_envio text check (status_envio in ('enviando','enviada','erro')),
  erro text,
  chatguru_ref text,
  payload jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists atd_mensagens_conv_idx on public.atd_mensagens (conversa_id, criado_em);

-- ---------- eventos ----------
create table if not exists public.atd_eventos (
  id bigserial primary key,
  conversa_id uuid not null references public.atd_conversas (id) on delete cascade,
  tipo text not null,                           -- aberta | assumida | transferida | fila | resolvida | reaberta | vinculada | status
  de text, para text,
  por uuid references public.perfis (id) on delete set null,
  por_nome text,
  em timestamptz not null default now()
);
create index if not exists atd_eventos_conv_idx on public.atd_eventos (conversa_id, em);

-- ---------- respostas rápidas ----------
create table if not exists public.atd_respostas_rapidas (
  id serial primary key,
  titulo text not null,
  atalho text not null,
  texto text not null,
  fila_id integer references public.atd_filas (id) on delete cascade,  -- null = todas
  ativa boolean not null default true,
  criado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- quem vê o quê ----------
create or replace function public.atd_ve_fila(p_fila integer) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sou_admin()
      or exists (select 1 from public.atd_filas f join public.perfis p on p.id = auth.uid()
                  where f.id = p_fila and (auth.uid() = any(f.membros) or coalesce(p.acessos, '{}') && f.areas));
$$;
create or replace function public.atd_minhas_filas() returns setof integer
language sql stable security definer set search_path = public as $$
  select f.id from public.atd_filas f join public.perfis p on p.id = auth.uid()
   where f.ativa and (public.sou_admin() or auth.uid() = any(f.membros) or coalesce(p.acessos, '{}') && f.areas);
$$;
create or replace function public.atd_ve_conversa(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.atd_conversas c where c.id = p_conv
                   and (public.sou_admin() or c.responsavel_id = auth.uid() or public.atd_ve_fila(c.fila_id)));
$$;

alter table public.atd_filas enable row level security;
alter table public.atd_conversas enable row level security;
alter table public.atd_mensagens enable row level security;
alter table public.atd_eventos enable row level security;
alter table public.atd_respostas_rapidas enable row level security;
drop policy if exists atd_filas_sel on public.atd_filas;
create policy atd_filas_sel on public.atd_filas for select to authenticated using (public.sou_equipe());
drop policy if exists atd_filas_adm on public.atd_filas;
create policy atd_filas_adm on public.atd_filas for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists atd_conv_sel on public.atd_conversas;
create policy atd_conv_sel on public.atd_conversas for select to authenticated using (public.sou_equipe() and (public.sou_admin() or responsavel_id = auth.uid() or public.atd_ve_fila(fila_id)));
drop policy if exists atd_conv_upd on public.atd_conversas;
create policy atd_conv_upd on public.atd_conversas for update to authenticated using (public.sou_equipe() and (public.sou_admin() or responsavel_id = auth.uid() or public.atd_ve_fila(fila_id))) with check (public.sou_equipe());
drop policy if exists atd_msg_sel on public.atd_mensagens;
create policy atd_msg_sel on public.atd_mensagens for select to authenticated using (public.sou_equipe() and public.atd_ve_conversa(conversa_id));
drop policy if exists atd_msg_ins on public.atd_mensagens;
create policy atd_msg_ins on public.atd_mensagens for insert to authenticated with check (public.sou_equipe() and public.atd_ve_conversa(conversa_id) and direcao in ('out','nota'));
drop policy if exists atd_msg_upd on public.atd_mensagens;
create policy atd_msg_upd on public.atd_mensagens for update to authenticated using (public.sou_equipe() and autor_id = auth.uid()) with check (public.sou_equipe());
drop policy if exists atd_ev_sel on public.atd_eventos;
create policy atd_ev_sel on public.atd_eventos for select to authenticated using (public.sou_equipe() and public.atd_ve_conversa(conversa_id));
drop policy if exists atd_rr_sel on public.atd_respostas_rapidas;
create policy atd_rr_sel on public.atd_respostas_rapidas for select to authenticated using (public.sou_equipe());
drop policy if exists atd_rr_adm on public.atd_respostas_rapidas;
create policy atd_rr_adm on public.atd_respostas_rapidas for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select on public.atd_filas, public.atd_conversas, public.atd_mensagens, public.atd_eventos, public.atd_respostas_rapidas to authenticated;
grant insert, update, delete on public.atd_filas, public.atd_respostas_rapidas to authenticated;
grant update on public.atd_conversas to authenticated;
grant insert, update on public.atd_mensagens to authenticated;
grant usage on sequence public.atd_protocolo_seq to authenticated;
grant usage, select on sequence public.atd_filas_id_seq, public.atd_respostas_rapidas_id_seq to authenticated;

-- bucket privado para as mídias recebidas (URL assinada ao exibir)
insert into storage.buckets (id, name, public, file_size_limit) values ('atendimento', 'atendimento', false, 52428800) on conflict (id) do nothing;
drop policy if exists atendimento_storage_equipe on storage.objects;
create policy atendimento_storage_equipe on storage.objects for select to authenticated
  using (bucket_id = 'atendimento' and public.sou_equipe());

-- ---------- SLA em horário comercial ----------
-- prazo = base + minutos, contando só seg–sex 8h–18h (BRT) em dias úteis; fora do expediente, começa no próximo
create or replace function public.atd_prazo(base timestamptz, minutos integer) returns timestamptz
language plpgsql stable set search_path = public as $$
declare t timestamp := base at time zone 'America/Sao_Paulo'; resto integer := greatest(minutos, 0); fim timestamp;
begin
  loop
    if not public.cadencia_dia_util(t::date) or t::time >= '18:00' then
      t := (t::date + 1)::timestamp + interval '8 hours'; continue;
    end if;
    if t::time < '08:00' then t := t::date::timestamp + interval '8 hours'; end if;
    fim := t::date::timestamp + interval '18 hours';
    if t + make_interval(mins => resto) <= fim then
      return (t + make_interval(mins => resto)) at time zone 'America/Sao_Paulo';
    end if;
    resto := resto - (extract(epoch from (fim - t)) / 60)::integer;
    t := (t::date + 1)::timestamp + interval '8 hours';
  end loop;
end $$;

-- ---------- utilitários ----------
create or replace function public.atd_evento(p_conv uuid, p_tipo text, p_de text, p_para text) returns void
language sql security definer set search_path = public as $$
  insert into public.atd_eventos (conversa_id, tipo, de, para, por, por_nome)
  values (p_conv, p_tipo, p_de, p_para, auth.uid(), public.nome_perfil(auth.uid()));
$$;
create or replace function public.atd_fila_padrao() returns integer
language sql stable set search_path = public as $$
  select coalesce((select id from public.atd_filas where slug = 'comercial'), (select id from public.atd_filas where ativa order by ordem limit 1));
$$;

-- ---------- entrada: chamada pelo webhook do ChatGuru ----------
create or replace function public.atd_receber(p jsonb, p_lead uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  chave text := public.normalizar_whatsapp(p ->> 'celular');
  chat text := nullif(p ->> 'chat_id', '');
  conv public.atd_conversas;
  tipo text := coalesce(nullif(p ->> 'tipo_mensagem', ''), 'chat');
  texto text := left(nullif(btrim(coalesce(p ->> 'texto_mensagem', '')), ''), 4000);
  url text := nullif(p ->> 'url_arquivo', '');
  quando timestamptz := now();   -- o webhook chega em tempo real; datetime_post (sem fuso) fica no payload
  cid text;
  msg uuid;
  fila integer;
  resp uuid;
  reaberta boolean := false;
begin
  if coalesce(p ->> '_origem', '') = 'equipe' then return jsonb_build_object('ok', true, 'ignorado', 'equipe'); end if;
  if chave is null and chat is null then return jsonb_build_object('ok', false, 'erro', 'sem celular/chat_id'); end if;

  select * into conv from public.atd_conversas where (chat is not null and chatguru_chat_id = chat) or (chat is null and whatsapp_normalizado = chave)
   order by (status <> 'resolvida') desc, ultima_msg_em desc nulls last limit 1;

  -- cliente pelo telefone (cadastro do cliente ou contato)
  select c.id into cid from public.clientes c where public.normalizar_whatsapp(c.telefone) = chave limit 1;
  if cid is null then select ct.cliente_id into cid from public.contatos ct where public.normalizar_whatsapp(ct.telefone) = chave limit 1; end if;
  -- responsável do ChatGuru → perfil (por e-mail)
  select id into resp from public.perfis where email is not null and lower(email) = lower(nullif(p ->> 'responsavel_email', '')) and papel in ('admin','colaborador') limit 1;

  if conv.id is null then
    fila := public.atd_fila_padrao();
    insert into public.atd_conversas (chatguru_chat_id, whatsapp, whatsapp_normalizado, nome_contato, link_chat, cliente_id, lead_id, fila_id, responsavel_id,
                                      status, aberta_em, sla_resposta_ate, ultima_msg_em, ultima_msg_contato_em, ultima_msg_texto, nao_lidas, tags, campos, responsavel_chatguru)
    values (chat, p ->> 'celular', chave, coalesce(nullif(p ->> 'nome', ''), p ->> 'celular'), nullif(p ->> 'link_chat', ''), cid, p_lead, fila, null,
            'nova', quando, public.atd_prazo(quando, (select sla_primeira_resposta_min from public.atd_filas where id = fila)), quando, quando,
            coalesce(texto, '[' || tipo || ']'), 1,
            coalesce((select array_agg(btrim(value)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'tags') = 'array' then p -> 'tags' else '[]'::jsonb end) where btrim(value) <> ''), '{}'),
            coalesce(case when jsonb_typeof(p -> 'campos_personalizados') = 'object' then p -> 'campos_personalizados' end, '{}'::jsonb),
            nullif(p ->> 'responsavel_nome', ''))
    returning * into conv;
    insert into public.atd_eventos (conversa_id, tipo, para) values (conv.id, 'aberta', (select nome from public.atd_filas where id = fila));
  else
    if conv.status = 'resolvida' then
      reaberta := true;
      update public.atd_conversas set status = 'nova', aberta_em = quando, primeira_resposta_em = null, resolvida_em = null, resolvida_por = null,
             fila_id = coalesce(fila_id, public.atd_fila_padrao()),
             sla_resposta_ate = public.atd_prazo(quando, coalesce((select sla_primeira_resposta_min from public.atd_filas where id = conv.fila_id), 15))
       where id = conv.id;
      insert into public.atd_eventos (conversa_id, tipo) values (conv.id, 'reaberta');
    elsif conv.status in ('em_atendimento','pendente_contato') then
      update public.atd_conversas set status = 'aguardando' where id = conv.id;
    end if;
    update public.atd_conversas set
      chatguru_chat_id = coalesce(chatguru_chat_id, chat),
      whatsapp = coalesce(whatsapp, p ->> 'celular'), whatsapp_normalizado = coalesce(whatsapp_normalizado, chave),
      nome_contato = coalesce(nullif(p ->> 'nome', ''), nome_contato),
      link_chat = coalesce(nullif(p ->> 'link_chat', ''), link_chat),
      cliente_id = coalesce(cliente_id, cid), lead_id = coalesce(lead_id, p_lead),
      ultima_msg_em = quando, ultima_msg_contato_em = quando, ultima_msg_texto = coalesce(texto, '[' || tipo || ']'),
      nao_lidas = nao_lidas + 1,
      tags = coalesce((select array_agg(btrim(value)) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'tags') = 'array' then p -> 'tags' else '[]'::jsonb end) where btrim(value) <> ''), tags),
      campos = coalesce(case when jsonb_typeof(p -> 'campos_personalizados') = 'object' then p -> 'campos_personalizados' end, campos),
      responsavel_chatguru = coalesce(nullif(p ->> 'responsavel_nome', ''), responsavel_chatguru),
      updated_at = now()
     where id = conv.id returning * into conv;
  end if;

  insert into public.atd_mensagens (conversa_id, direcao, tipo, texto, arquivo_url, autor_nome, criado_em, payload)
  values (conv.id, 'in', tipo, texto, url, conv.nome_contato, quando,
          jsonb_build_object('responsavel_nome', p ->> 'responsavel_nome', 'bsuid', p ->> 'bsuid', 'datetime_post', p ->> 'datetime_post'))
  returning id into msg;

  -- aviso: para o responsável, ou para todos da fila quando não há responsável
  if conv.responsavel_id is not null then
    perform public.notificar(conv.responsavel_id, 'Nova mensagem · ' || coalesce(conv.nome_contato, ''), left(coalesce(texto, '[' || tipo || ']'), 140), '#atendimento/' || conv.id);
  else
    perform public.notificar(p.id, 'Atendimento · ' || coalesce((select nome from public.atd_filas where id = conv.fila_id), 'fila'), coalesce(conv.nome_contato, '') || ': ' || left(coalesce(texto, '[' || tipo || ']'), 120), '#atendimento/' || conv.id)
      from public.perfis p join public.atd_filas f on f.id = conv.fila_id
     where p.papel in ('admin','colaborador') and (p.id = any(f.membros) or coalesce(p.acessos, '{}') && f.areas);
  end if;

  return jsonb_build_object('ok', true, 'conversa_id', conv.id, 'mensagem_id', msg, 'reaberta', reaberta, 'tem_arquivo', url is not null);
end $$;
revoke all on function public.atd_receber(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.atd_receber(jsonb, uuid) to service_role;

-- o webhook do ChatGuru passa a registrar a conversa (sem quebrar o fluxo do lead se algo falhar)
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
  atd jsonb := '{}'::jsonb;
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

    if existia and coalesce(p ->> 'tipo_mensagem', 'chat') not in ('call_log') and coalesce(p ->> '_origem', '') <> 'equipe' then
      perform public.lead_respondeu(lead, case when (p ->> 'datetime_post') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then (p ->> 'datetime_post')::timestamptz else now() end);
    end if;

    -- Atendimento: registra a conversa/mensagem (falha aqui não derruba o lead)
    begin
      atd := public.atd_receber(p, lead);
    exception when others then
      atd := jsonb_build_object('ok', false, 'erro', sqlerrm);
    end;

    update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
    return jsonb_build_object('ok', true, 'lead_id', lead, 'meta', m, 'respondeu', existia, 'atd', atd);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end;
$$;
revoke all on function public.chatguru_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.chatguru_webhook(jsonb) to service_role;

-- ---------- ações da equipe ----------
-- registra a mensagem de saída (a Edge envia pelo ChatGuru e marca enviada/erro)
create or replace function public.atd_mensagem_out(p_conv uuid, p_texto text, p_nota boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare msg uuid; conv public.atd_conversas; eu uuid := auth.uid();
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso a esta conversa.'; end if;
  select * into conv from public.atd_conversas where id = p_conv;
  insert into public.atd_mensagens (conversa_id, direcao, tipo, texto, autor_id, autor_nome, status_envio)
  values (p_conv, case when p_nota then 'nota' else 'out' end, 'chat', left(p_texto, 4000), eu, public.nome_perfil(eu), case when p_nota then null else 'enviando' end)
  returning id into msg;
  if not p_nota then
    update public.atd_conversas set
      responsavel_id = coalesce(responsavel_id, eu),
      status = case when status in ('nova','aguardando') then 'em_atendimento' else status end,
      primeira_resposta_em = coalesce(primeira_resposta_em, now()),
      ultima_msg_em = now(), ultima_msg_texto = left(p_texto, 200), nao_lidas = 0, updated_at = now()
     where id = p_conv;
    if conv.responsavel_id is null then perform public.atd_evento(p_conv, 'assumida', null, public.nome_perfil(eu)); end if;
  end if;
  return msg;
end $$;
grant execute on function public.atd_mensagem_out(uuid, text, boolean) to authenticated;

create or replace function public.atd_marcar_envio(p_msg uuid, p_ok boolean, p_erro text, p_ref text) returns void
language sql security definer set search_path = public as $$
  update public.atd_mensagens set status_envio = case when p_ok then 'enviada' else 'erro' end, erro = p_erro, chatguru_ref = coalesce(p_ref, chatguru_ref)
   where id = p_msg and (autor_id = auth.uid() or auth.role() = 'service_role');
$$;
grant execute on function public.atd_marcar_envio(uuid, boolean, text, text) to authenticated, service_role;

create or replace function public.atd_assumir(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); antes text;
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  select public.nome_perfil(responsavel_id) into antes from public.atd_conversas where id = p_conv;
  update public.atd_conversas set responsavel_id = eu, status = case when status = 'nova' then 'aguardando' else status end, nao_lidas = 0, updated_at = now() where id = p_conv;
  perform public.atd_evento(p_conv, 'assumida', antes, public.nome_perfil(eu));
end $$;
grant execute on function public.atd_assumir(uuid) to authenticated;

-- transferir: para uma fila (sem responsável) e/ou para uma pessoa
create or replace function public.atd_transferir(p_conv uuid, p_fila integer, p_responsavel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.atd_conversas; fila_nome text; nova_fila integer;
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  select * into c from public.atd_conversas where id = p_conv;
  nova_fila := coalesce(p_fila, c.fila_id);
  update public.atd_conversas set fila_id = nova_fila, responsavel_id = p_responsavel,
         status = case when p_responsavel is null then 'aguardando' when status = 'nova' then 'aguardando' else status end,
         sla_resposta_ate = case when primeira_resposta_em is null then public.atd_prazo(now(), (select sla_primeira_resposta_min from public.atd_filas where id = nova_fila)) else sla_resposta_ate end,
         updated_at = now()
   where id = p_conv;
  if p_fila is not null and p_fila is distinct from c.fila_id then
    perform public.atd_evento(p_conv, 'fila', (select nome from public.atd_filas where id = c.fila_id), (select nome from public.atd_filas where id = p_fila));
  end if;
  if p_responsavel is distinct from c.responsavel_id then
    perform public.atd_evento(p_conv, 'transferida', public.nome_perfil(c.responsavel_id), coalesce(public.nome_perfil(p_responsavel), 'fila'));
    if p_responsavel is not null then
      perform public.notificar(p_responsavel, 'Conversa transferida para você', coalesce(c.nome_contato, '') || ' · ' || c.protocolo, '#atendimento/' || p_conv);
    end if;
  end if;
  if p_responsavel is null then
    perform public.notificar(p.id, 'Conversa na fila ' || f.nome, coalesce(c.nome_contato, '') || ' · ' || c.protocolo, '#atendimento/' || p_conv)
      from public.perfis p join public.atd_filas f on f.id = nova_fila
     where p.papel in ('admin','colaborador') and (p.id = any(f.membros) or coalesce(p.acessos, '{}') && f.areas);
  end if;
end $$;
grant execute on function public.atd_transferir(uuid, integer, uuid) to authenticated;

create or replace function public.atd_status(p_conv uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare antes text;
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  if p_status not in ('aguardando','em_atendimento','pendente_contato','resolvida') then raise exception 'Status inválido.'; end if;
  select status into antes from public.atd_conversas where id = p_conv;
  update public.atd_conversas set status = p_status,
         resolvida_em = case when p_status = 'resolvida' then now() else null end,
         resolvida_por = case when p_status = 'resolvida' then auth.uid() else null end,
         nao_lidas = 0, updated_at = now()
   where id = p_conv;
  perform public.atd_evento(p_conv, case when p_status = 'resolvida' then 'resolvida' else 'status' end, antes, p_status);
end $$;
grant execute on function public.atd_status(uuid, text) to authenticated;

create or replace function public.atd_lida(p_conv uuid) returns void
language sql security definer set search_path = public as $$
  update public.atd_conversas set nao_lidas = 0 where id = p_conv and public.atd_ve_conversa(p_conv);
$$;
grant execute on function public.atd_lida(uuid) to authenticated;

create or replace function public.atd_vincular(p_conv uuid, p_cliente text, p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() or not public.atd_ve_conversa(p_conv) then raise exception 'Sem acesso.'; end if;
  update public.atd_conversas set cliente_id = coalesce(p_cliente, cliente_id), lead_id = coalesce(p_lead, lead_id), updated_at = now() where id = p_conv;
  perform public.atd_evento(p_conv, 'vinculada', null, coalesce((select dados ->> 'nome' from public.clientes where id = p_cliente), (select nome from public.leads where id = p_lead)));
end $$;
grant execute on function public.atd_vincular(uuid, text, uuid) to authenticated;

-- ---------- views ----------
create or replace view public.v_atd_conversas with (security_invoker = true) as
select c.*,
       f.nome as fila_nome, f.cor as fila_cor, f.slug as fila_slug,
       public.nome_perfil(c.responsavel_id) as responsavel_nome,
       cl.dados ->> 'nome' as cliente_nome,
       l.nome as lead_nome, l.fase_id as lead_fase_id,
       case when c.status = 'resolvida' then null
            when c.primeira_resposta_em is null and c.sla_resposta_ate < now() then 'vencido'
            when c.primeira_resposta_em is null and c.sla_resposta_ate < now() + interval '5 minutes' then 'quase'
            when c.primeira_resposta_em is null then 'no_prazo'
            else 'respondida' end as sla,
       (select count(*) from public.atd_conversas c2 where c2.whatsapp_normalizado = c.whatsapp_normalizado and c2.id <> c.id) as conversas_anteriores
  from public.atd_conversas c
  left join public.atd_filas f on f.id = c.fila_id
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.leads l on l.id = c.lead_id;
grant select on public.v_atd_conversas to authenticated;

create or replace view public.v_atd_filas_resumo with (security_invoker = true) as
select f.id, f.nome, f.slug, f.cor, f.ordem, f.ativa, f.areas, f.membros, f.sla_primeira_resposta_min, f.sla_resolucao_horas,
       count(c.id) filter (where c.status <> 'resolvida') as abertas,
       count(c.id) filter (where c.status <> 'resolvida' and c.responsavel_id is null) as sem_responsavel,
       count(c.id) filter (where c.status <> 'resolvida' and c.primeira_resposta_em is null and c.sla_resposta_ate < now()) as sla_vencido,
       coalesce(sum(c.nao_lidas) filter (where c.status <> 'resolvida'), 0) as nao_lidas,
       count(c.id) filter (where c.resolvida_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as resolvidas_hoje,
       round(avg(extract(epoch from (c.primeira_resposta_em - c.aberta_em)) / 60) filter (where c.primeira_resposta_em is not null and c.aberta_em > now() - interval '30 days'))::integer as media_primeira_resposta_min,
       round(avg(extract(epoch from (c.resolvida_em - c.aberta_em)) / 3600) filter (where c.resolvida_em is not null and c.aberta_em > now() - interval '30 days'), 1) as media_resolucao_h
  from public.atd_filas f
  left join public.atd_conversas c on c.fila_id = f.id
 group by f.id;
grant select on public.v_atd_filas_resumo to authenticated;

-- equipe disponível para transferência (quem vê a fila)
create or replace function public.atd_equipe_fila(p_fila integer) returns table (id uuid, nome text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(public.nome_perfil(p.id), p.email), p.email
    from public.perfis p left join public.atd_filas f on f.id = p_fila
   where p.papel in ('admin','colaborador') and public.sou_equipe()
     and (p.papel = 'admin' or f.id is null or p.id = any(f.membros) or coalesce(p.acessos, '{}') && f.areas)
   order by 2;
$$;
grant execute on function public.atd_equipe_fila(integer) to authenticated;

-- realtime
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.atd_conversas; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.atd_mensagens; exception when duplicate_object then null; end;
  end if;
end $$;

select 'ok 0079' as resultado;
