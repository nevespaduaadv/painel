-- 0027 — PR 14: CRM de leads (portado de nevespaduaadv/crm-leads, supabase/schema.sql, commit e59472a).
-- Adaptações: usuários = perfis/sou_equipe()/sou_admin() (sem a tabela profiles do CRM); a auditoria de campos
-- do lead virou leads_auditoria (a nossa auditoria genérica já existe); tudo idempotente.
-- Regras de negócio, importação da planilha, webhook do ChatGuru, sincronização e automações preservados.
-- As funções que dependem de servidor (webhook, envio ChatGuru, executor de automações) ganham Edge Functions na fase seguinte.



-- ---------- Tipos ----------
do $$ begin create type public.app_role as enum ('admin', 'user'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_status as enum ('Aberto', 'Perdido', 'Ganho', 'Abandonado'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lead_origem as enum ('planilha', 'chatguru', 'manual'); exception when duplicate_object then null; end $$;

-- ---------- Fases do funil ----------
create table if not exists public.fases (
  id integer primary key,
  nome text not null unique,
  ordem integer not null unique,
  cor text not null
);

insert into public.fases (id, nome, ordem, cor) values
  (1,  'Novo lead',              1,  '#EEEEF1'),
  (2,  'Em qualificação - SDR',  2,  '#E2E3E7'),
  (3,  'Qualificado',            3,  '#D5D7DD'),
  (4,  'Reunião agendada',       4,  '#C9CBD3'),
  (5,  'No-show',                5,  '#E4E4E4'),
  (6,  'Reunião realizada',      6,  '#BDC0C9'),
  (7,  'Proposta enviada',       7,  '#FFF7D1'),
  (8,  'Contrato enviado',       8,  '#FFF0AC'),
  (9,  'Pagamento pendente',     9,  '#FFE27A'),
  (10, 'Ganho',                  10, '#F6D353')
on conflict (id) do nothing;

-- ---------- Normalização do WhatsApp ----------
-- Chave única: 55 + DDD + últimos 8 dígitos. Assim "51993102417", "5551993102417"
-- e "555193102417" (sem o 9º dígito, como o WhatsApp às vezes informa) são o mesmo lead.
create or replace function public.normalizar_whatsapp(valor text)
returns text language plpgsql immutable as $$
declare
  d text;
begin
  d := ltrim(regexp_replace(coalesce(valor, ''), '\D', '', 'g'), '0');
  if d = '' then
    return null;
  end if;
  if length(d) in (10, 11) then
    d := '55' || d;
  end if;
  if left(d, 2) = '55' and length(d) in (12, 13) then
    return '55' || substr(d, 3, 2) || right(d, 8);
  end if;
  return d;
end;
$$;

-- ---------- Leads / oportunidades ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null default '',
  email text,
  whatsapp text,
  whatsapp_normalizado text unique,
  empresa text,
  tipo_divida text,
  situacao_divida text,
  valor_divida text,
  outras_dividas text,
  melhor_horario text,
  campanha text,
  publico text,
  anuncio text,
  fase_id integer not null default 1 references public.fases (id),
  fase_desde timestamptz not null default now(),
  status public.lead_status not null default 'Aberto',
  valor numeric(14, 2) not null default 0,
  proprietario_id uuid references public.perfis (id) on delete set null,
  data_entrada timestamptz not null default now(),
  data_fechamento date,
  motivo_perda text,
  link_chat text,
  chatguru_chat_id text,
  responsavel_chatguru text,
  reuniao_em timestamptz,
  ultima_mensagem text,
  ultima_interacao_em timestamptz,
  origem public.lead_origem not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_fase_idx on public.leads (fase_id);
create index if not exists leads_proprietario_idx on public.leads (proprietario_id);
create index if not exists leads_ultima_interacao_idx on public.leads (ultima_interacao_em desc);

create table if not exists public.historico_fases (
  id bigserial primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  de_fase_id integer references public.fases (id),
  para_fase_id integer not null references public.fases (id),
  usuario_id uuid references public.perfis (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists historico_fases_lead_idx on public.historico_fases (lead_id);

create table if not exists public.observacoes (
  id bigserial primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  texto text not null,
  autor_id uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists observacoes_lead_idx on public.observacoes (lead_id);

create table if not exists public.tags (
  id bigserial primary key,
  nome text not null unique
);

create table if not exists public.lead_tags (
  lead_id uuid not null references public.leads (id) on delete cascade,
  tag_id bigint not null references public.tags (id) on delete cascade,
  primary key (lead_id, tag_id)
);

create table if not exists public.leads_auditoria (
  id bigserial primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  campo text not null,
  valor_antigo text,
  valor_novo text,
  usuario_id uuid references public.perfis (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists leads_auditoria_lead_idx on public.leads_auditoria (lead_id);

create table if not exists public.webhook_logs (
  id bigserial primary key,
  payload jsonb,
  status text not null default 'recebido',
  erro text,
  lead_id uuid references public.leads (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists webhook_logs_lead_idx on public.webhook_logs (lead_id, created_at desc);

-- ---------- Regras de negócio (RN-01 a RN-05) ----------
create or replace function public.leads_regras()
returns trigger language plpgsql as $$
begin
  new.whatsapp_normalizado := public.normalizar_whatsapp(new.whatsapp);
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    -- Fase Ganho <-> status Ganho (RN-03)
    if new.status = 'Ganho' and old.status is distinct from 'Ganho' then
      new.fase_id := 10;
    elsif new.fase_id = 10 and old.fase_id is distinct from 10 then
      new.status := 'Ganho';
    elsif old.fase_id = 10 and new.fase_id <> 10 and new.status = 'Ganho' then
      new.status := 'Aberto';
    end if;
    if new.fase_id is distinct from old.fase_id then
      new.fase_desde := now();
    end if;
  else
    if new.status = 'Ganho' then
      new.fase_id := 10;
    elsif new.fase_id = 10 then
      new.status := 'Ganho';
    end if;
  end if;

  -- Data de fechamento e motivo (RN-02, RN-04)
  if new.status = 'Aberto' then
    new.data_fechamento := null;
    new.motivo_perda := null;
  else
    new.data_fechamento := coalesce(new.data_fechamento, current_date);
    if new.status in ('Perdido', 'Abandonado') and coalesce(btrim(new.motivo_perda), '') = '' then
      raise exception 'Informe o motivo para marcar o lead como %.', new.status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists leads_regras on public.leads;
create trigger leads_regras
  before insert or update on public.leads
  for each row execute function public.leads_regras();

-- Histórico de fases e auditoria de campos (RF-06, RNF-03)
create or replace function public.leads_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  campo text;
  antigo jsonb;
  novo jsonb;
  ignorar text[] := array['updated_at', 'fase_desde', 'whatsapp_normalizado', 'fase_id', 'created_at', 'ultima_mensagem', 'ultima_interacao_em'];
begin
  if tg_op = 'INSERT' then
    insert into public.historico_fases (lead_id, de_fase_id, para_fase_id, usuario_id)
    values (new.id, null, new.fase_id, auth.uid());
    return new;
  end if;

  if new.fase_id is distinct from old.fase_id then
    insert into public.historico_fases (lead_id, de_fase_id, para_fase_id, usuario_id)
    values (new.id, old.fase_id, new.fase_id, auth.uid());
  end if;

  antigo := to_jsonb(old) - ignorar;
  novo := to_jsonb(new) - ignorar;
  for campo in select jsonb_object_keys(novo) loop
    if (antigo -> campo) is distinct from (novo -> campo) then
      insert into public.leads_auditoria (lead_id, campo, valor_antigo, valor_novo, usuario_id)
      values (new.id, campo, antigo ->> campo, novo ->> campo, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists leads_historico on public.leads;
create trigger leads_historico
  after insert or update on public.leads
  for each row execute function public.leads_historico();

-- ---------- Importação da planilha (RF-10, RF-12) ----------
-- Recebe um array JSON de linhas já mapeadas e devolve o resumo.
create or replace function public.importar_leads(linhas jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  linha jsonb;
  idx integer := 0;
  chave text;
  existente uuid;
  novo_id uuid;
  criados integer := 0;
  atualizados integer := 0;
  ignorados integer := 0;
  erros jsonb := '[]'::jsonb;
begin
  if not public.sou_equipe() then
    raise exception 'Acesso negado.';
  end if;

  for linha in select * from jsonb_array_elements(linhas) loop
    idx := idx + 1;
    begin
      chave := public.normalizar_whatsapp(linha ->> 'whatsapp');
      if chave is null then
        ignorados := ignorados + 1;
        erros := erros || jsonb_build_object('linha', coalesce((linha ->> '_linha')::int, idx), 'motivo', 'WhatsApp vazio');
        continue;
      end if;

      select id into existente from public.leads where whatsapp_normalizado = chave;

      if existente is not null then
        update public.leads set
          nome            = coalesce(nullif(linha ->> 'nome', ''), nome),
          email           = coalesce(nullif(linha ->> 'email', ''), email),
          empresa         = coalesce(nullif(linha ->> 'empresa', ''), empresa),
          tipo_divida     = coalesce(nullif(linha ->> 'tipo_divida', ''), tipo_divida),
          situacao_divida = coalesce(nullif(linha ->> 'situacao_divida', ''), situacao_divida),
          valor_divida    = coalesce(nullif(linha ->> 'valor_divida', ''), valor_divida),
          outras_dividas  = coalesce(nullif(linha ->> 'outras_dividas', ''), outras_dividas),
          melhor_horario  = coalesce(nullif(linha ->> 'melhor_horario', ''), melhor_horario),
          campanha        = coalesce(nullif(linha ->> 'campanha', ''), campanha),
          publico         = coalesce(nullif(linha ->> 'publico', ''), publico),
          anuncio         = coalesce(nullif(linha ->> 'anuncio', ''), anuncio)
        where id = existente;
        atualizados := atualizados + 1;
      else
        insert into public.leads (
          nome, email, whatsapp, empresa, tipo_divida, situacao_divida, valor_divida,
          outras_dividas, melhor_horario, campanha, publico, anuncio, data_entrada, origem
        ) values (
          coalesce(nullif(linha ->> 'nome', ''), 'Sem nome'),
          nullif(linha ->> 'email', ''),
          linha ->> 'whatsapp',
          nullif(linha ->> 'empresa', ''),
          nullif(linha ->> 'tipo_divida', ''),
          nullif(linha ->> 'situacao_divida', ''),
          nullif(linha ->> 'valor_divida', ''),
          nullif(linha ->> 'outras_dividas', ''),
          nullif(linha ->> 'melhor_horario', ''),
          nullif(linha ->> 'campanha', ''),
          nullif(linha ->> 'publico', ''),
          nullif(linha ->> 'anuncio', ''),
          coalesce((nullif(linha ->> 'data_entrada', ''))::timestamptz, now()),
          'planilha'
        ) returning id into novo_id;

        if coalesce(btrim(linha ->> 'observacao'), '') <> '' then
          insert into public.observacoes (lead_id, texto)
          values (novo_id, 'Planilha: ' || btrim(linha ->> 'observacao'));
        end if;
        criados := criados + 1;
      end if;
    exception when others then
      erros := erros || jsonb_build_object('linha', coalesce((linha ->> '_linha')::int, idx), 'motivo', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'criados', criados, 'atualizados', atualizados, 'ignorados', ignorados, 'erros', erros
  );
end;
$$;

-- ---------- Webhook do ChatGuru (seção 6.1) ----------
-- Chamado apenas pelo servidor (api/chatguru-webhook) com a service role.
create or replace function public.chatguru_webhook(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id bigint;
  chave text;
  lead uuid;
  tag_nome text;
  email_recebido text;
  mensagem text;
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

    -- Texto da mensagem que disparou o diálogo, quando o ChatGuru envia
    mensagem := left(coalesce(
      nullif(btrim(p ->> 'texto_mensagem'), ''),
      nullif(btrim(p ->> 'mensagem'), ''),
      nullif(btrim(p ->> 'ultima_mensagem'), '')
    ), 2000);

    select id into lead from public.leads where whatsapp_normalizado = chave;

    if lead is null then
      insert into public.leads (
        nome, email, whatsapp, campanha, link_chat, chatguru_chat_id, responsavel_chatguru, origem,
        ultima_mensagem, ultima_interacao_em
      )
      values (
        coalesce(nullif(p ->> 'nome', ''), 'Sem nome'),
        email_recebido,
        p ->> 'celular',
        nullif(p ->> 'campanha_nome', ''),
        nullif(p ->> 'link_chat', ''),
        nullif(p ->> 'chat_id', ''),
        nullif(p ->> 'responsavel_nome', ''),
        'chatguru',
        mensagem,
        now()
      ) returning id into lead;
    else
      update public.leads set
        nome                 = coalesce(nullif(nome, ''), nullif(p ->> 'nome', ''), nome),
        email                = coalesce(email, email_recebido),
        campanha             = coalesce(campanha, nullif(p ->> 'campanha_nome', '')),
        link_chat            = coalesce(nullif(p ->> 'link_chat', ''), link_chat),
        chatguru_chat_id     = coalesce(nullif(p ->> 'chat_id', ''), chatguru_chat_id),
        responsavel_chatguru = coalesce(nullif(p ->> 'responsavel_nome', ''), responsavel_chatguru),
        ultima_mensagem      = coalesce(mensagem, ultima_mensagem),
        ultima_interacao_em  = now()
      where id = lead;
    end if;

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
    return jsonb_build_object('ok', true, 'lead_id', lead);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end;
$$;

-- ---------- Segurança (RLS) ----------
alter table public.fases enable row level security;
alter table public.leads enable row level security;
alter table public.historico_fases enable row level security;
alter table public.observacoes enable row level security;
alter table public.tags enable row level security;
alter table public.lead_tags enable row level security;
alter table public.leads_auditoria enable row level security;
alter table public.webhook_logs enable row level security;

-- Todos os usuários ativos veem e editam tudo (decisão do escritório); excluir só Admin.

drop policy if exists "fases: ver" on public.fases;
create policy "fases: ver" on public.fases for select to authenticated using (public.sou_equipe());

drop policy if exists "leads: ver" on public.leads;
create policy "leads: ver" on public.leads for select to authenticated using (public.sou_equipe());
drop policy if exists "leads: criar" on public.leads;
create policy "leads: criar" on public.leads for insert to authenticated with check (public.sou_equipe());
drop policy if exists "leads: editar" on public.leads;
create policy "leads: editar" on public.leads for update to authenticated
  using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists "leads: excluir" on public.leads;
create policy "leads: excluir" on public.leads for delete to authenticated using (public.sou_admin());

drop policy if exists "historico: ver" on public.historico_fases;
create policy "historico: ver" on public.historico_fases for select to authenticated using (public.sou_equipe());
drop policy if exists "leads_auditoria: ver" on public.leads_auditoria;
create policy "leads_auditoria: ver" on public.leads_auditoria for select to authenticated using (public.sou_equipe());

drop policy if exists "observacoes: ver" on public.observacoes;
create policy "observacoes: ver" on public.observacoes for select to authenticated using (public.sou_equipe());
drop policy if exists "observacoes: criar" on public.observacoes;
create policy "observacoes: criar" on public.observacoes for insert to authenticated
  with check (public.sou_equipe() and autor_id = auth.uid());

drop policy if exists "tags: ver" on public.tags;
create policy "tags: ver" on public.tags for select to authenticated using (public.sou_equipe());
drop policy if exists "tags: criar" on public.tags;
create policy "tags: criar" on public.tags for insert to authenticated with check (public.sou_equipe());

drop policy if exists "lead_tags: ver" on public.lead_tags;
create policy "lead_tags: ver" on public.lead_tags for select to authenticated using (public.sou_equipe());
drop policy if exists "lead_tags: criar" on public.lead_tags;
create policy "lead_tags: criar" on public.lead_tags for insert to authenticated with check (public.sou_equipe());
drop policy if exists "lead_tags: remover" on public.lead_tags;
create policy "lead_tags: remover" on public.lead_tags for delete to authenticated using (public.sou_equipe());

drop policy if exists "webhook_logs: admin ve" on public.webhook_logs;
create policy "webhook_logs: admin ve" on public.webhook_logs for select to authenticated using (public.sou_admin());
drop policy if exists "webhook_logs: ver eventos de leads" on public.webhook_logs;
create policy "webhook_logs: ver eventos de leads" on public.webhook_logs for select to authenticated
  using (lead_id is not null and public.sou_equipe());

revoke all on function public.chatguru_webhook(jsonb) from public, anon, authenticated;
grant execute on function public.chatguru_webhook(jsonb) to service_role;
revoke all on function public.importar_leads(jsonb) from public, anon;
grant execute on function public.importar_leads(jsonb) to authenticated;

-- ---------- Sincronização automática da planilha (Google Sheets -> CRM) ----------
-- O Apps Script da planilha (apps-script/sincronizar-planilha.gs) envia a aba inteira a cada 5 minutos.
-- Cada linha fica registrada em planilha_linhas; o lead só é criado ou atualizado com a integração ativa.
-- Lead novo entra na fase indicada pelo STATUS. Depois disso a fase é do CRM: um STATUS novo na
-- planilha vira observação, e só os campos alterados na planilha sobrescrevem o lead.

create schema if not exists privado; -- fora da API: o PostgREST só expõe o schema public
revoke all on schema privado from public;

create table if not exists privado.integracoes (
  nome text primary key,
  token_sha256 text not null,
  ativa boolean not null default false,
  ultima_chamada timestamptz
);

create table if not exists public.planilha_linhas (
  whatsapp_normalizado text primary key,
  numero_linha integer not null,
  recebido jsonb not null, -- última versão da linha recebida da planilha
  aplicado jsonb,          -- versão já levada ao lead (null = ainda não aplicada)
  lead_id uuid references public.leads (id) on delete set null,
  recebido_em timestamptz not null default now(),
  aplicado_em timestamptz
);

create table if not exists public.planilha_sincronizacoes (
  id bigserial primary key,
  recebidas integer not null,
  criados integer not null,
  atualizados integer not null,
  pendentes integer not null,
  erros jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.planilha_linhas enable row level security;
alter table public.planilha_sincronizacoes enable row level security;
drop policy if exists "planilha_linhas: admin ve" on public.planilha_linhas;
create policy "planilha_linhas: admin ve" on public.planilha_linhas for select to authenticated
  using (public.sou_admin());
drop policy if exists "planilha_sincronizacoes: admin ve" on public.planilha_sincronizacoes;
create policy "planilha_sincronizacoes: admin ve" on public.planilha_sincronizacoes for select to authenticated
  using (public.sou_admin());

-- Minúsculas, sem acento e com espaços simples (cabeçalhos e STATUS).
create or replace function public.normalizar_texto(valor text)
returns text language sql immutable as $$
  select btrim(regexp_replace(lower(translate(coalesce(valor, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g'));
$$;

-- "16/06/2026 09:49:26", "21/06/2026" ou "2026-06-16 09:49" no horário de Brasília. Null se não reconhecer.
create or replace function public.converter_data_br(valor text)
returns timestamptz language plpgsql stable as $$
declare
  m text[];
  ano integer;
begin
  m := regexp_match(btrim(coalesce(valor, '')), '^(\d{1,2})/(\d{1,2})/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$');
  if m is not null then
    ano := m[3]::integer;
    if ano < 100 then
      ano := ano + 2000;
    end if;
    return (to_char(make_timestamp(ano, m[2]::integer, m[1]::integer, coalesce(m[4], '0')::integer,
      coalesce(m[5], '0')::integer, coalesce(m[6], '0')::double precision), 'YYYY-MM-DD HH24:MI:SS') || '-03')::timestamptz;
  end if;
  m := regexp_match(btrim(coalesce(valor, '')), '^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?');
  if m is not null then
    return (to_char(make_timestamp(m[1]::integer, m[2]::integer, m[3]::integer, coalesce(m[4], '0')::integer,
      coalesce(m[5], '0')::integer, coalesce(m[6], '0')::double precision), 'YYYY-MM-DD HH24:MI:SS') || '-03')::timestamptz;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- Classifica o lead novo pelo texto da coluna STATUS em duas partes: a etapa a que chegou (fase)
-- e como terminou (status + motivo). Nas duas, a primeira regra que casar vale.
create or replace function public.classificar_status_planilha(
  texto text, out fase_id integer, out status public.lead_status, out motivo text
) language plpgsql immutable as $$
declare
  t text := public.normalizar_texto(texto);
begin
  status := 'Aberto';
  motivo := null;
  if t = '' then
    fase_id := 1;
    return;
  end if;

  if t ~ 'contrato enviado|enviad[oa] (o )?contrato' then
    fase_id := 8;
  elsif t ~ 'proposta' then
    fase_id := 7;
  elsif t ~ 'fez (a )?reuniao|reuniao realizada|realizou (a )?reuniao' then
    fase_id := 6;
  elsif t ~ 'no.?show|nao compareceu|nao apareceu|faltou' then
    fase_id := 5;
  elsif t ~ 'reuniao (agendada|marcada)|(marcou|marquei|agendou|agendei) (uma |a )?reuniao|tinha reuniao' then
    fase_id := 4;
  elsif t ~ '(^|\W)qualificad' then
    fase_id := 3;
  else
    fase_id := 2; -- STATUS preenchido: o SDR já atuou
  end if;

  if t ~ '(ja tem|ja tinha|ja possui|contratou|fechou com) (outro |um |uma )?(advogad|escritorio)' then
    status := 'Perdido'; motivo := 'Já tem advogado';
  elsif t ~ 'resolveu (direto |diretamente )?com o banco|renegociou (direto )?com o banco' then
    status := 'Perdido'; motivo := 'Resolveu direto com o banco';
  elsif t ~ 'numero (errado|invalido|inexistente|nao encontrado|com erro)|mensagem nao chega|nao e (a pessoa|o dono)' then
    status := 'Perdido'; motivo := 'Número errado'; fase_id := 1;
  elsif t ~ 'desqualificad|nao qualificad|fora do perfil|pessoa fisica|vendendo' then
    status := 'Perdido'; motivo := 'Desqualificado';
  elsif t ~ 'sem interesse|nao tem interesse|desistiu' then
    status := 'Perdido'; motivo := 'Sem interesse';
  elsif t ~ 'contrato assinado|assinou (o )?contrato|fechou (o )?contrato' then
    status := 'Ganho'; fase_id := 10;
  elsif t ~ 'nao atende\M|nao atendeu|nao respond|nunca respondeu|sem resposta' then
    status := 'Abandonado'; motivo := 'Sem resposta';
  end if;
end;
$$;

-- Valor a gravar num campo do lead já existente: a planilha só sobrescreve o que mudou nela desde
-- a última sincronização; em lead vindo de outra origem (aplicado null), só preenche campo vazio.
create or replace function public.valor_da_planilha(atual text, novo text, campo text, aplicado jsonb)
returns text language sql immutable as $$
  select case
    when novo is null then atual
    when aplicado is null then coalesce(nullif(atual, ''), novo)
    when novo is distinct from aplicado ->> campo then novo
    else atual
  end;
$$;

-- Chamado pelo Apps Script com a chave publicável; o token próprio da integração é a autorização.
create or replace function public.sincronizar_planilha(token text, cabecalho jsonb, linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  integracao privado.integracoes;
  sinonimos constant jsonb := '{
    "data_entrada": ["data", "f", "data de entrada", "created time", "created_time"],
    "nome": ["nome", "nome completo", "full name", "full_name"],
    "email": ["email", "e-mail"],
    "whatsapp": ["whatsapp", "telefone", "celular", "phone", "phone_number"],
    "empresa": ["nome da empresa", "empresa", "nome comercial"],
    "tipo_divida": ["tipo de divida"],
    "situacao_divida": ["situacao das suas dividas", "situacao das dividas"],
    "valor_divida": ["valor da divida"],
    "outras_dividas": ["alem do pronampe, o que mais tem?", "alem do pronampe"],
    "melhor_horario": ["melhor horario para contato", "melhor horario"],
    "campanha": ["campanha", "campaign_name"],
    "publico": ["publico", "adset_name"],
    "anuncio": ["anuncio", "ad_name"],
    "observacao": ["status", "observacao", "observacoes"]
  }';
  mapa jsonb := '{}';
  campo text;
  i integer;
  linha jsonb;
  numero integer := 1; -- linha 1 = cabeçalho
  dados jsonb;
  chave text;
  lote jsonb := '{}';
  item jsonb;
  anterior public.planilha_linhas;
  lead uuid;
  c record;
  recebidas integer := 0;
  criados integer := 0;
  atualizados integer := 0;
  pendentes integer := 0;
  erros jsonb := '[]';
begin
  select * into integracao from privado.integracoes
  where nome = 'planilha' and token_sha256 = encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex');
  if not found then
    raise exception 'Token inválido.' using errcode = '28000';
  end if;
  update privado.integracoes set ultima_chamada = now() where nome = 'planilha';

  for i in 0 .. coalesce(jsonb_array_length(cabecalho), 0) - 1 loop
    select key into campo from jsonb_each(sinonimos) where value ? public.normalizar_texto(cabecalho ->> i);
    if campo is not null and not (mapa ? campo) then
      mapa := mapa || jsonb_build_object(campo, i);
    end if;
  end loop;
  if not (mapa ? 'whatsapp') then
    raise exception 'A planilha não tem coluna de WhatsApp.';
  end if;

  -- Se o mesmo WhatsApp aparece em mais de uma linha, vale a última.
  for linha in select value from jsonb_array_elements(linhas) loop
    numero := numero + 1;
    dados := '{}';
    for campo, i in select key, value::integer from jsonb_each_text(mapa) loop
      if btrim(coalesce(linha ->> i, '')) <> '' then
        dados := dados || jsonb_build_object(campo, btrim(linha ->> i));
      end if;
    end loop;
    continue when dados = '{}';
    recebidas := recebidas + 1;
    chave := public.normalizar_whatsapp(dados ->> 'whatsapp');
    if chave is null then
      erros := erros || jsonb_build_object('linha', numero, 'motivo', 'WhatsApp vazio');
    else
      lote := lote || jsonb_build_object(chave, jsonb_build_object('linha', numero, 'dados', dados));
    end if;
  end loop;

  for chave, item in select key, value from jsonb_each(lote) loop
    begin
      dados := item -> 'dados';
      insert into public.planilha_linhas as p (whatsapp_normalizado, numero_linha, recebido)
      values (chave, (item ->> 'linha')::integer, dados)
      on conflict (whatsapp_normalizado) do update set
        numero_linha = excluded.numero_linha,
        recebido = excluded.recebido,
        recebido_em = case when p.recebido is distinct from excluded.recebido then now() else p.recebido_em end
      where p.numero_linha is distinct from excluded.numero_linha or p.recebido is distinct from excluded.recebido;

      select * into anterior from public.planilha_linhas where whatsapp_normalizado = chave;
      continue when anterior.aplicado is not distinct from dados;
      if not integracao.ativa then
        pendentes := pendentes + 1;
        continue;
      end if;

      select id into lead from public.leads where whatsapp_normalizado = chave;
      if lead is null then
        select * into c from public.classificar_status_planilha(dados ->> 'observacao');
        insert into public.leads (
          nome, email, whatsapp, empresa, tipo_divida, situacao_divida, valor_divida, outras_dividas,
          melhor_horario, campanha, publico, anuncio, data_entrada, origem, fase_id, status, motivo_perda
        ) values (
          coalesce(dados ->> 'nome', 'Sem nome'), dados ->> 'email', dados ->> 'whatsapp', dados ->> 'empresa',
          dados ->> 'tipo_divida', dados ->> 'situacao_divida', dados ->> 'valor_divida', dados ->> 'outras_dividas',
          dados ->> 'melhor_horario', dados ->> 'campanha', dados ->> 'publico', dados ->> 'anuncio',
          coalesce(public.converter_data_br(dados ->> 'data_entrada'), now()), 'planilha', c.fase_id, c.status, c.motivo
        ) returning id into lead;
        criados := criados + 1;
      else
        update public.leads l set
          nome = case when anterior.aplicado is null and l.origem = 'chatguru' then coalesce(dados ->> 'nome', l.nome)
                      else public.valor_da_planilha(l.nome, dados ->> 'nome', 'nome', anterior.aplicado) end,
          email           = public.valor_da_planilha(l.email, dados ->> 'email', 'email', anterior.aplicado),
          empresa         = public.valor_da_planilha(l.empresa, dados ->> 'empresa', 'empresa', anterior.aplicado),
          tipo_divida     = public.valor_da_planilha(l.tipo_divida, dados ->> 'tipo_divida', 'tipo_divida', anterior.aplicado),
          situacao_divida = public.valor_da_planilha(l.situacao_divida, dados ->> 'situacao_divida', 'situacao_divida', anterior.aplicado),
          valor_divida    = public.valor_da_planilha(l.valor_divida, dados ->> 'valor_divida', 'valor_divida', anterior.aplicado),
          outras_dividas  = public.valor_da_planilha(l.outras_dividas, dados ->> 'outras_dividas', 'outras_dividas', anterior.aplicado),
          melhor_horario  = public.valor_da_planilha(l.melhor_horario, dados ->> 'melhor_horario', 'melhor_horario', anterior.aplicado),
          campanha        = public.valor_da_planilha(l.campanha, dados ->> 'campanha', 'campanha', anterior.aplicado),
          publico         = public.valor_da_planilha(l.publico, dados ->> 'publico', 'publico', anterior.aplicado),
          anuncio         = public.valor_da_planilha(l.anuncio, dados ->> 'anuncio', 'anuncio', anterior.aplicado)
        where l.id = lead;
        atualizados := atualizados + 1;
      end if;

      if (dados ->> 'observacao') is distinct from (anterior.aplicado ->> 'observacao') and dados ? 'observacao' then
        insert into public.observacoes (lead_id, texto) values (lead, 'Planilha: ' || (dados ->> 'observacao'));
      end if;
      update public.planilha_linhas set aplicado = dados, aplicado_em = now(), lead_id = lead
      where whatsapp_normalizado = chave;
    exception when others then
      erros := erros || jsonb_build_object('linha', (item ->> 'linha')::integer, 'motivo', sqlerrm);
    end;
  end loop;

  -- Registra só o que muda: execuções com lead criado/atualizado ou com erros diferentes da anterior.
  if criados + atualizados > 0
     or erros is distinct from coalesce((select s.erros from public.planilha_sincronizacoes s order by s.id desc limit 1), '[]') then
    insert into public.planilha_sincronizacoes (recebidas, criados, atualizados, pendentes, erros)
    values (recebidas, criados, atualizados, pendentes, erros);
  end if;

  return jsonb_build_object(
    'ativa', integracao.ativa, 'recebidas', recebidas, 'criados', criados,
    'atualizados', atualizados, 'pendentes', pendentes, 'erros', erros
  );
end;
$$;

revoke all on function public.sincronizar_planilha(text, jsonb, jsonb) from public;
grant execute on function public.sincronizar_planilha(text, jsonb, jsonb) to anon, authenticated;

-- ---------- Automações de mensagem (diálogos do ChatGuru) ----------
-- Cada automação tem um gatilho e uma sequência de passos; cada passo dispara um diálogo do ChatGuru.
-- O gatilho (trigger em leads) enfileira os passos em automacao_execucoes. O pg_cron chama a cada
-- minuto a função de servidor /api/automacoes, só quando há passo vencido; ela dispara os diálogos pela
-- API do ChatGuru e devolve o resultado (automacoes_reservar / automacoes_registrar).
-- Gatilhos:
--   novo_lead       lead criado na primeira fase, em aberto e com entrada nos últimos 2 dias (importar
--                   uma planilha antiga não dispara nada); filtro opcional por origem.
--   entrou_na_fase  lead passou para a fase escolhida (cadência de follow-up).
--   reuniao         lembrete: cada passo roda X minutos antes de leads.reuniao_em.
-- Em novo_lead e entrou_na_fase a espera de cada passo conta a partir do passo anterior. A sequência
-- para quando o lead é fechado e, com parar_ao_mudar_fase, quando ele muda de fase. Automação nova ou
-- reativada vale só para o que acontecer dali em diante (nada retroativo).

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end;
$$;

create table if not exists public.dialogos_chatguru (
  id bigserial primary key,
  nome text not null,
  dialog_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.automacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativa boolean not null default false,
  gatilho text not null check (gatilho in ('novo_lead', 'entrou_na_fase', 'reuniao')),
  fase_id integer references public.fases (id),
  origens public.lead_origem[],       -- novo_lead: null = todas as origens
  passos jsonb not null default '[]', -- [{"espera_minutos": 0, "dialogo_id": 1}, ...]
  parar_ao_mudar_fase boolean not null default true,
  so_horario_comercial boolean not null default true,
  texto_abertura text,                -- mensagem do chat_add quando o contato ainda não tem conversa no ChatGuru
  criado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automacoes_fase_do_gatilho check (gatilho <> 'entrou_na_fase' or fase_id is not null)
);

create table if not exists public.automacao_execucoes (
  id bigserial primary key,
  automacao_id uuid not null references public.automacoes (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  passo integer not null,
  dialogo_id bigint references public.dialogos_chatguru (id) on delete set null,
  executar_em timestamptz not null,
  fase_no_inicio integer,
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'feito', 'erro', 'cancelado')),
  tentativas integer not null default 0,
  resultado text,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists automacao_execucoes_fila_idx on public.automacao_execucoes (status, executar_em);
create index if not exists automacao_execucoes_lead_idx on public.automacao_execucoes (lead_id);

alter table public.dialogos_chatguru enable row level security;
alter table public.automacoes enable row level security;
alter table public.automacao_execucoes enable row level security;

drop policy if exists "dialogos: ver" on public.dialogos_chatguru;
create policy "dialogos: ver" on public.dialogos_chatguru for select to authenticated using (public.sou_equipe());
drop policy if exists "dialogos: criar" on public.dialogos_chatguru;
create policy "dialogos: criar" on public.dialogos_chatguru for insert to authenticated with check (public.sou_equipe());
drop policy if exists "dialogos: editar" on public.dialogos_chatguru;
create policy "dialogos: editar" on public.dialogos_chatguru for update to authenticated
  using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists "dialogos: excluir" on public.dialogos_chatguru;
create policy "dialogos: excluir" on public.dialogos_chatguru for delete to authenticated using (public.sou_equipe());

drop policy if exists "automacoes: ver" on public.automacoes;
create policy "automacoes: ver" on public.automacoes for select to authenticated using (public.sou_equipe());
drop policy if exists "automacoes: criar" on public.automacoes;
create policy "automacoes: criar" on public.automacoes for insert to authenticated with check (public.sou_equipe());
drop policy if exists "automacoes: editar" on public.automacoes;
create policy "automacoes: editar" on public.automacoes for update to authenticated
  using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists "automacoes: excluir" on public.automacoes;
create policy "automacoes: excluir" on public.automacoes for delete to authenticated using (public.sou_admin());

drop policy if exists "execucoes: ver" on public.automacao_execucoes;
create policy "execucoes: ver" on public.automacao_execucoes for select to authenticated using (public.sou_equipe());

-- Nome e passos válidos; campos que não valem para o gatilho escolhido ficam vazios.
create or replace function public.automacoes_validar()
returns trigger language plpgsql set search_path = public as $$
declare
  passo jsonb;
begin
  new.nome := btrim(coalesce(new.nome, ''));
  if new.nome = '' then
    raise exception 'Dê um nome à automação.';
  end if;
  if jsonb_typeof(new.passos) is distinct from 'array' or jsonb_array_length(new.passos) = 0 then
    raise exception 'A automação precisa de pelo menos um passo.';
  end if;
  if jsonb_array_length(new.passos) > 20 then
    raise exception 'Use no máximo 20 passos por automação.';
  end if;
  for passo in select value from jsonb_array_elements(new.passos) loop
    if jsonb_typeof(passo -> 'espera_minutos') is distinct from 'number'
       or (passo ->> 'espera_minutos')::numeric < 0
       or (passo ->> 'espera_minutos')::numeric <> trunc((passo ->> 'espera_minutos')::numeric) then
      raise exception 'Cada passo precisa de uma espera em minutos (número inteiro, zero ou mais).';
    end if;
    if jsonb_typeof(passo -> 'dialogo_id') is distinct from 'number'
       or not exists (select 1 from public.dialogos_chatguru d where d.id = (passo ->> 'dialogo_id')::bigint) then
      raise exception 'Escolha um diálogo do ChatGuru em todos os passos.';
    end if;
  end loop;
  if new.gatilho <> 'entrou_na_fase' then
    new.fase_id := null;
  end if;
  if new.gatilho <> 'novo_lead' then
    new.origens := null;
  end if;
  new.texto_abertura := nullif(btrim(coalesce(new.texto_abertura, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists automacoes_validar on public.automacoes;
drop trigger if exists automacoes_validar on public.automacoes;
create trigger automacoes_validar
  before insert or update on public.automacoes
  for each row execute function public.automacoes_validar();

-- Desativar uma automação cancela o que estava na fila dela.
create or replace function public.automacoes_desativada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.ativa and not new.ativa then
    update public.automacao_execucoes set status = 'cancelado', resultado = 'Automação desativada', atualizado_em = now()
    where automacao_id = new.id and status = 'pendente';
  end if;
  return null;
end;
$$;

drop trigger if exists automacoes_desativada on public.automacoes;
drop trigger if exists automacoes_desativada on public.automacoes;
create trigger automacoes_desativada
  after update of ativa on public.automacoes
  for each row execute function public.automacoes_desativada();

-- Diálogo em uso em alguma automação não pode ser apagado.
create or replace function public.dialogos_em_uso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nome_automacao text;
begin
  select a.nome into nome_automacao from public.automacoes a
  where exists (select 1 from jsonb_array_elements(a.passos) p where (p ->> 'dialogo_id') = old.id::text)
  limit 1;
  if nome_automacao is not null then
    raise exception 'Este diálogo está em uso na automação "%". Tire-o dos passos antes de apagar.', nome_automacao;
  end if;
  return old;
end;
$$;

drop trigger if exists dialogos_em_uso on public.dialogos_chatguru;
drop trigger if exists dialogos_em_uso on public.dialogos_chatguru;
create trigger dialogos_em_uso
  before delete on public.dialogos_chatguru
  for each row execute function public.dialogos_em_uso();

-- Enfileira os passos de uma automação para um lead.
create or replace function public.automacao_enfileirar(a public.automacoes, l public.leads)
returns void language plpgsql security definer set search_path = public as $$
declare
  passo jsonb;
  i integer := 0;
  quando timestamptz := now();
begin
  for passo in select value from jsonb_array_elements(a.passos) loop
    i := i + 1;
    if a.gatilho = 'reuniao' then
      quando := l.reuniao_em - make_interval(mins => (passo ->> 'espera_minutos')::integer);
      continue when quando <= now();
    else
      quando := quando + make_interval(mins => (passo ->> 'espera_minutos')::integer);
    end if;
    insert into public.automacao_execucoes (automacao_id, lead_id, passo, dialogo_id, executar_em, fase_no_inicio)
    values (a.id, l.id, i, (passo ->> 'dialogo_id')::bigint, quando, l.fase_id);
  end loop;
end;
$$;

-- Gatilhos nos leads: cancela o que não vale mais e enfileira as automações que se aplicam.
-- Um erro aqui nunca impede gravar o lead: vira aviso no log do banco.
create or replace function public.leads_automacoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.automacoes;
  primeira_fase integer;
begin
  if tg_op = 'UPDATE' then
    if new.status <> 'Aberto' then
      update public.automacao_execucoes set status = 'cancelado', resultado = 'Lead fechado', atualizado_em = now()
      where lead_id = new.id and status = 'pendente';
    end if;
    if new.fase_id is distinct from old.fase_id then
      update public.automacao_execucoes e set status = 'cancelado', resultado = 'Lead mudou de fase', atualizado_em = now()
      from public.automacoes au
      where e.automacao_id = au.id and e.lead_id = new.id and e.status = 'pendente'
        and au.gatilho <> 'reuniao' and au.parar_ao_mudar_fase;
    end if;
    if new.reuniao_em is distinct from old.reuniao_em then
      update public.automacao_execucoes e set status = 'cancelado', resultado = 'Reunião remarcada ou desmarcada', atualizado_em = now()
      from public.automacoes au
      where e.automacao_id = au.id and e.lead_id = new.id and e.status = 'pendente' and au.gatilho = 'reuniao';
    end if;
  end if;

  if new.status <> 'Aberto' then
    return null;
  end if;

  select f.id into primeira_fase from public.fases f order by f.ordem limit 1;
  for a in select * from public.automacoes where ativa loop
    begin
      if a.gatilho = 'novo_lead' then
        continue when tg_op <> 'INSERT';
        continue when new.data_entrada < now() - interval '2 days';
        continue when new.fase_id is distinct from primeira_fase;
        continue when a.origens is not null and not (new.origem = any (a.origens));
      elsif a.gatilho = 'entrou_na_fase' then
        continue when new.fase_id is distinct from a.fase_id;
        continue when tg_op = 'UPDATE' and new.fase_id is not distinct from old.fase_id;
        continue when tg_op = 'INSERT' and new.data_entrada < now() - interval '2 days';
      else
        continue when new.reuniao_em is null or new.reuniao_em <= now();
        continue when tg_op = 'UPDATE' and new.reuniao_em is not distinct from old.reuniao_em;
      end if;
      -- Recomeça a sequência desta automação para o lead.
      update public.automacao_execucoes set status = 'cancelado', resultado = 'Sequência reiniciada', atualizado_em = now()
      where automacao_id = a.id and lead_id = new.id and status = 'pendente';
      perform public.automacao_enfileirar(a, new);
    exception when others then
      raise warning 'Automação % não enfileirada para o lead %: %', a.id, new.id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

drop trigger if exists leads_automacoes on public.leads;
drop trigger if exists leads_automacoes on public.leads;
create trigger leads_automacoes
  after insert or update of fase_id, status, reuniao_em on public.leads
  for each row execute function public.leads_automacoes();

-- Envios só de segunda a sábado, das 8h às 20h (horário de Brasília, UTC-3).
create or replace function public.em_horario_comercial(momento timestamptz)
returns boolean language sql immutable as $$
  select extract(isodow from momento at time zone interval '-03:00') between 1 and 6
     and (momento at time zone interval '-03:00')::time between time '08:00' and time '20:00';
$$;

create or replace function public.automacoes_token_valido(token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from privado.integracoes
    where nome = 'automacoes' and ativa and token_sha256 = encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex')
  );
$$;

-- Usada pelo pg_cron: só chama o CRM quando há passo vencido para disparar.
create or replace function public.automacoes_ha_trabalho()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.automacao_execucoes e join public.automacoes a on a.id = e.automacao_id
    where (e.status = 'pendente' and e.executar_em <= now()
           and (not a.ativa or not a.so_horario_comercial or public.em_horario_comercial(now())))
       or (e.status = 'processando' and e.atualizado_em < now() - interval '10 minutes')
  );
$$;

-- Reserva os próximos passos vencidos (status processando) e devolve o que a função de servidor precisa.
create or replace function public.automacoes_reservar(token text, limite integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  resultado jsonb;
begin
  if not public.automacoes_token_valido(token) then
    raise exception 'Token inválido.' using errcode = '28000';
  end if;
  update privado.integracoes set ultima_chamada = now() where nome = 'automacoes';

  -- Interrompidas há mais de 10 minutos (função de servidor caiu): voltam para a fila.
  update public.automacao_execucoes set status = 'pendente', atualizado_em = now()
  where status = 'processando' and atualizado_em < now() - interval '10 minutes';

  -- Rede de segurança: o que não vale mais é cancelado antes de disparar.
  update public.automacao_execucoes e set status = 'cancelado', atualizado_em = now(),
    resultado = case
      when not a.ativa then 'Automação desativada'
      when l.status <> 'Aberto' then 'Lead fechado'
      else 'Lead mudou de fase'
    end
  from public.automacoes a, public.leads l
  where e.automacao_id = a.id and e.lead_id = l.id and e.status = 'pendente' and e.executar_em <= now()
    and (not a.ativa or l.status <> 'Aberto'
         or (a.gatilho <> 'reuniao' and a.parar_ao_mudar_fase and l.fase_id is distinct from e.fase_no_inicio));

  with escolhidas as (
    select e.id from public.automacao_execucoes e join public.automacoes a on a.id = e.automacao_id
    where e.status = 'pendente' and e.executar_em <= now()
      and (not a.so_horario_comercial or public.em_horario_comercial(now()))
    order by e.executar_em
    limit greatest(1, least(coalesce(limite, 5), 50))
    for update of e skip locked
  ), reservadas as (
    update public.automacao_execucoes e set status = 'processando', tentativas = e.tentativas + 1, atualizado_em = now()
    from escolhidas where e.id = escolhidas.id
    returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'passo', r.passo, 'tentativas', r.tentativas,
    'automacao', a.nome, 'texto_abertura', a.texto_abertura,
    'dialogo', d.nome, 'dialog_id', d.dialog_id,
    'lead', jsonb_build_object('id', l.id, 'nome', l.nome, 'whatsapp', l.whatsapp)
  ) order by r.executar_em), '[]'::jsonb)
  into resultado
  from reservadas r
  join public.automacoes a on a.id = r.automacao_id
  join public.leads l on l.id = r.lead_id
  left join public.dialogos_chatguru d on d.id = r.dialogo_id;
  return resultado;
end;
$$;

-- Grava o resultado de cada passo reservado: [{id, ok, descricao?, erro?, temporario?, liberar?}]
-- ok -> feito, com observação no lead; temporario -> tenta de novo em 5 min (até 3 vezes);
-- liberar -> volta para a fila sem contar tentativa (a função de servidor ficou sem tempo).
create or replace function public.automacoes_registrar(token text, resultados jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  item jsonb;
  e public.automacao_execucoes;
  nome_automacao text;
  nome_dialogo text;
begin
  if not public.automacoes_token_valido(token) then
    raise exception 'Token inválido.' using errcode = '28000';
  end if;
  for item in select value from jsonb_array_elements(coalesce(resultados, '[]'::jsonb)) loop
    select * into e from public.automacao_execucoes where id = (item ->> 'id')::bigint and status = 'processando';
    continue when not found;
    if coalesce((item ->> 'liberar')::boolean, false) then
      update public.automacao_execucoes set status = 'pendente', tentativas = greatest(tentativas - 1, 0), atualizado_em = now()
      where id = e.id;
    elsif coalesce((item ->> 'ok')::boolean, false) then
      update public.automacao_execucoes set status = 'feito', resultado = item ->> 'descricao', atualizado_em = now()
      where id = e.id;
      select a.nome, d.nome into nome_automacao, nome_dialogo
      from public.automacoes a left join public.dialogos_chatguru d on d.id = e.dialogo_id
      where a.id = e.automacao_id;
      insert into public.observacoes (lead_id, texto, autor_id) values (
        e.lead_id,
        'Automação do CRM:' || chr(10) || nome_automacao || ' · passo ' || e.passo || ': diálogo "' || coalesce(nome_dialogo, '?') || '"'
          || coalesce(' (' || nullif(item ->> 'descricao', '') || ')', ''),
        null
      );
      update public.leads set ultima_interacao_em = now() where id = e.lead_id;
    elsif coalesce((item ->> 'temporario')::boolean, false) and e.tentativas < 3 then
      update public.automacao_execucoes set status = 'pendente', executar_em = now() + interval '5 minutes',
        resultado = item ->> 'erro', atualizado_em = now()
      where id = e.id;
    else
      update public.automacao_execucoes set status = 'erro', resultado = item ->> 'erro', atualizado_em = now()
      where id = e.id;
    end if;
  end loop;
end;
$$;

-- Liga o agendamento (pg_cron + pg_net) com um token novo. Rodar de novo troca o token.
create or replace function public.configurar_automacoes(url_crm text)
returns text language plpgsql security definer set search_path = public as $$
declare
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  endpoint text := rtrim(btrim(url_crm), '/') || '/api/automacoes';
begin
  if endpoint !~ '^https://' then
    raise exception 'Informe o endereço do CRM começando com https://';
  end if;
  insert into privado.integracoes (nome, token_sha256, ativa)
  values ('automacoes', encode(sha256(convert_to(token, 'UTF8')), 'hex'), true)
  on conflict (nome) do update set token_sha256 = excluded.token_sha256, ativa = true;
  perform cron.schedule('automacoes-np', '* * * * *', format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{}'::jsonb, timeout_milliseconds := 30000) where public.automacoes_ha_trabalho()$cmd$,
    endpoint, 'Bearer ' || token));
  return 'Automações agendadas: ' || endpoint;
end;
$$;

revoke all on function public.automacao_enfileirar(public.automacoes, public.leads) from public, anon, authenticated;
revoke all on function public.automacoes_token_valido(text) from public, anon, authenticated;
revoke all on function public.automacoes_ha_trabalho() from public, anon, authenticated;
revoke all on function public.automacoes_reservar(text, integer) from public, anon, authenticated;
revoke all on function public.automacoes_registrar(text, jsonb) from public, anon, authenticated;
revoke all on function public.configurar_automacoes(text) from public, anon, authenticated;
grant execute on function public.automacoes_reservar(text, integer) to service_role;
grant execute on function public.automacoes_registrar(text, jsonb) to service_role;


-- ---------- views para o painel ----------
drop view if exists public.v_leads;
create view public.v_leads with (security_invoker = true) as
select l.*, f.nome as fase_nome, f.ordem as fase_ordem, f.cor as fase_cor,
       coalesce(p.nome, p.email) as proprietario_nome,
       coalesce((select array_agg(t.nome order by t.nome) from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.lead_id = l.id), '{}') as tags,
       (select count(*) from public.observacoes o where o.lead_id = l.id) as total_observacoes,
       extract(day from now() - l.fase_desde)::int as dias_na_fase
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id;
revoke all on public.v_leads from anon;

drop view if exists public.v_observacoes;
create view public.v_observacoes with (security_invoker = true) as
select o.*, coalesce(p.nome, p.email) as autor_nome from public.observacoes o left join public.perfis p on p.id = o.autor_id;
revoke all on public.v_observacoes from anon;

drop view if exists public.v_historico_fases;
create view public.v_historico_fases with (security_invoker = true) as
select h.*, fd.nome as de_fase, fp.nome as para_fase, coalesce(p.nome, p.email) as usuario_nome
from public.historico_fases h left join public.fases fd on fd.id = h.de_fase_id join public.fases fp on fp.id = h.para_fase_id left join public.perfis p on p.id = h.usuario_id;
revoke all on public.v_historico_fases from anon;

do $$ begin alter publication supabase_realtime add table public.leads; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.observacoes; exception when others then null; end $$;

select 'ok 0027' as resultado;
