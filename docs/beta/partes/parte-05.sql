-- ESPELHO (beta) — parte 5 de 9: 0034_pr19_tarefas_historico_notificacoes.sql … 0049_webhook_campanha_id.sql

-- ===== 0034_pr19_tarefas_historico_notificacoes.sql =====
-- 0034 — PR 19: histórico de tarefas (quem abriu, quem recebeu, reatribuições, prazo adiado, conclusão) + notificações (sino)
-- Idempotente. Depende de 0003 (tarefas, v_tarefas), 0030 (lead_tarefas).

-- ---------- tarefas: quem concluiu ----------
alter table public.tarefas add column if not exists concluida_por uuid references public.perfis(id) on delete set null;

-- ---------- eventos (trilha de auditoria legível) ----------
create table if not exists public.tarefa_eventos (
  id bigserial primary key,
  tarefa_id uuid references public.tarefas(id) on delete cascade,
  lead_tarefa_id bigint references public.lead_tarefas(id) on delete cascade,
  tipo text not null check (tipo in ('criada','reatribuida','prazo_alterado','status','concluida','reaberta','cancelada','comentario','editada')),
  de text, para text,              -- valor anterior / novo (nome do responsável, data do prazo, status…)
  nota text,                        -- comentário livre (ex.: "petição protocolada")
  autor uuid references public.perfis(id) on delete set null,
  autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists tarefa_eventos_tarefa_idx on public.tarefa_eventos (tarefa_id, criado_em);
create index if not exists tarefa_eventos_lead_idx on public.tarefa_eventos (lead_tarefa_id, criado_em);
alter table public.tarefa_eventos enable row level security;
drop policy if exists "tarefa_eventos: equipe le" on public.tarefa_eventos;
create policy "tarefa_eventos: equipe le" on public.tarefa_eventos for select to authenticated using (public.sou_equipe());
drop policy if exists "tarefa_eventos: equipe comenta" on public.tarefa_eventos;
create policy "tarefa_eventos: equipe comenta" on public.tarefa_eventos for insert to authenticated with check (public.sou_equipe() and tipo = 'comentario' and autor = auth.uid());

-- ---------- notificações (sino) ----------
create table if not exists public.notificacoes (
  id bigserial primary key,
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  titulo text not null,
  texto text,
  link text,                        -- hash do painel, ex.: #tarefas/<id>
  lida_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists notificacoes_perfil_idx on public.notificacoes (perfil_id, lida_em, criado_em desc);
alter table public.notificacoes enable row level security;
drop policy if exists "notificacoes: minhas" on public.notificacoes;
create policy "notificacoes: minhas" on public.notificacoes for select to authenticated using (perfil_id = auth.uid());
drop policy if exists "notificacoes: marcar lida" on public.notificacoes;
create policy "notificacoes: marcar lida" on public.notificacoes for update to authenticated using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

create or replace function public.notificar(p_perfil uuid, p_titulo text, p_texto text, p_link text) returns void
language sql security definer set search_path = public as $$
  insert into public.notificacoes (perfil_id, titulo, texto, link)
  select p_perfil, p_titulo, p_texto, p_link where p_perfil is not null and p_perfil <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
$$;

-- nome legível do perfil (cai no colaborador, depois no e-mail)
create or replace function public.nome_perfil(p uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select c.nome from public.colaboradores c where c.perfil_id = p limit 1), (select coalesce(nullif(nome,''), email) from public.perfis where id = p));
$$;

-- ---------- carimbos (antes) + trilha e notificações (depois) das tarefas de cliente ----------
create or replace function public.tarefa_carimbo() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then new.concluida_por := coalesce(new.concluida_por, auth.uid());
  elsif new.status <> 'concluida' then new.concluida_por := null; end if;
  return new;
end $$;
drop trigger if exists tarefas_carimbo on public.tarefas;
create trigger tarefas_carimbo before insert or update on public.tarefas for each row execute procedure public.tarefa_carimbo();

create or replace function public.tarefa_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; resp_perfil uuid; resp_nome text; ant_nome text; link text; titulo text;
begin
  meu := public.nome_perfil(eu);
  link := '#tarefas/' || new.id;
  titulo := left(new.titulo, 90);
  select c.perfil_id, c.nome into resp_perfil, resp_nome from public.colaboradores c where c.id = new.responsavel_id;
  if tg_op = 'INSERT' then
    insert into public.tarefa_eventos (tarefa_id, tipo, para, autor, autor_nome) values (new.id, 'criada', resp_nome, eu, meu);
    perform public.notificar(resp_perfil, 'Nova tarefa para você', coalesce(meu,'Alguém') || ' abriu: ' || titulo || coalesce(' · prazo ' || to_char(new.prazo,'DD/MM'), ''), link);
    return null;
  end if;
  -- UPDATE
  if new.responsavel_id is distinct from old.responsavel_id then
    select c.nome into ant_nome from public.colaboradores c where c.id = old.responsavel_id;
    insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'reatribuida', ant_nome, resp_nome, eu, meu);
    perform public.notificar(resp_perfil, 'Tarefa passada para você', coalesce(meu,'Alguém') || ' passou: ' || titulo || coalesce(' · prazo ' || to_char(new.prazo,'DD/MM'), ''), link);
  end if;
  if new.prazo is distinct from old.prazo then
    insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'prazo_alterado', to_char(old.prazo,'DD/MM/YYYY'), to_char(new.prazo,'DD/MM/YYYY'), eu, meu);
    if new.prazo > old.prazo and new.created_by is distinct from eu then
      perform public.notificar(new.created_by, 'Prazo adiado', coalesce(meu,'Alguém') || ' adiou "' || titulo || '" de ' || to_char(old.prazo,'DD/MM') || ' para ' || to_char(new.prazo,'DD/MM'), link);
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'concluida' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'concluida', eu, meu);
      perform public.notificar(new.created_by, 'Tarefa concluída', coalesce(meu,'Alguém') || ' concluiu: ' || titulo, link);
    elsif old.status = 'concluida' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'reaberta', eu, meu);
    elsif new.status = 'cancelada' then
      insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'cancelada', eu, meu);
      perform public.notificar(new.created_by, 'Tarefa cancelada', coalesce(meu,'Alguém') || ' cancelou: ' || titulo, link);
    else
      insert into public.tarefa_eventos (tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'status', old.status, new.status, eu, meu);
    end if;
  end if;
  if new.titulo is distinct from old.titulo or new.descricao is distinct from old.descricao or new.prazo_fatal is distinct from old.prazo_fatal or new.prioridade is distinct from old.prioridade then
    insert into public.tarefa_eventos (tarefa_id, tipo, autor, autor_nome) values (new.id, 'editada', eu, meu);
  end if;
  return null;
end $$;
drop trigger if exists tarefas_trilha on public.tarefas;
create trigger tarefas_trilha after insert or update on public.tarefas for each row execute procedure public.tarefa_trilha();

-- ---------- tarefas de lead: carimbo (antes) + trilha e notificações (depois) ----------
create or replace function public.lead_tarefa_carimbo() returns trigger language plpgsql as $$
begin
  if new.concluida_em is not null and (tg_op = 'INSERT' or old.concluida_em is null) then new.concluida_por := coalesce(new.concluida_por, auth.uid());
  elsif new.concluida_em is null then new.concluida_por := null; end if;
  return new;
end $$;
drop trigger if exists lead_tarefas_carimbo on public.lead_tarefas;
create trigger lead_tarefas_carimbo before insert or update on public.lead_tarefas for each row execute procedure public.lead_tarefa_carimbo();

create or replace function public.lead_tarefa_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; link text; titulo text; lnome text;
begin
  meu := public.nome_perfil(eu);
  select nome into lnome from public.leads where id = new.lead_id;
  link := '#leads/' || new.lead_id;
  titulo := coalesce(new.titulo, new.tipo) || coalesce(' — ' || lnome, '');
  if tg_op = 'INSERT' then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, para, autor, autor_nome) values (new.id, 'criada', public.nome_perfil(new.responsavel_id), eu, meu);
    perform public.notificar(new.responsavel_id, 'Nova tarefa de lead para você', coalesce(meu,'Alguém') || ' abriu: ' || titulo || ' · ' || to_char(new.quando at time zone 'America/Sao_Paulo','DD/MM HH24:MI'), link);
    return null;
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'reatribuida', public.nome_perfil(old.responsavel_id), public.nome_perfil(new.responsavel_id), eu, meu);
    perform public.notificar(new.responsavel_id, 'Tarefa de lead passada para você', coalesce(meu,'Alguém') || ' passou: ' || titulo, link);
  end if;
  if new.quando is distinct from old.quando then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, de, para, autor, autor_nome) values (new.id, 'prazo_alterado', to_char(old.quando at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'), to_char(new.quando at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'), eu, meu);
  end if;
  if new.concluida_em is not null and old.concluida_em is null then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, autor, autor_nome) values (new.id, 'concluida', eu, meu);
    perform public.notificar(new.criado_por, 'Tarefa de lead concluída', coalesce(meu,'Alguém') || ' concluiu: ' || titulo, link);
  elsif new.concluida_em is null and old.concluida_em is not null then
    insert into public.tarefa_eventos (lead_tarefa_id, tipo, autor, autor_nome) values (new.id, 'reaberta', eu, meu);
  end if;
  return null;
end $$;
drop trigger if exists lead_tarefas_trilha on public.lead_tarefas;
create trigger lead_tarefas_trilha after insert or update on public.lead_tarefas for each row execute procedure public.lead_tarefa_trilha();

-- ---------- v_tarefas: quem abriu / quem concluiu (colunas na ordem original + novas no fim, para não quebrar v_prazos/v_clientes_ficha) ----------
create or replace view public.v_tarefas with (security_invoker = true) as
select t.id, t.titulo, t.descricao, t.cliente_id, t.contrato_id, t.processo_id, t.responsavel_id, t.nucleo, t.prazo, t.prazo_fatal, t.status, t.concluida_em, t.prioridade, t.created_at, t.created_by, t.updated_at, t.updated_by,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(h.horas) from public.apontamentos_horas h where h.tarefa_id = t.id), 0) as horas_apontadas,
       t.concluida_por,
       public.nome_perfil(t.created_by) as criado_por_nome,
       public.nome_perfil(t.concluida_por) as concluida_por_nome
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

-- ---------- tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.tarefa_eventos;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notificacoes;
exception when duplicate_object then null; end $$;

select 'ok 0034' as resultado;


-- ===== 0035_pr23_processos_sem_cliente_tarefa_publicacao.sql =====
-- 0035 — PR 23: processo sem cliente (fora da base) + tarefa aberta a partir de uma publicação
-- Idempotente. Depende de 0002 (processos), 0004 (v_processos), 0014 (publicacoes), 0034 (v_tarefas).

-- ---------- processos: cliente opcional ----------
alter table public.processos alter column cliente_id drop not null;

create or replace view public.v_processos with (security_invoker = true) as
select p.*, c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (p.proximo_prazo - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id;

-- ---------- tarefas: origem em publicação ----------
alter table public.tarefas add column if not exists publicacao_id bigint references public.publicacoes(id) on delete set null;
create index if not exists tarefas_publicacao_idx on public.tarefas (publicacao_id);

create or replace view public.v_tarefas with (security_invoker = true) as
select t.id, t.titulo, t.descricao, t.cliente_id, t.contrato_id, t.processo_id, t.responsavel_id, t.nucleo, t.prazo, t.prazo_fatal, t.status, t.concluida_em, t.prioridade, t.created_at, t.created_by, t.updated_at, t.updated_by,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(h.horas) from public.apontamentos_horas h where h.tarefa_id = t.id), 0) as horas_apontadas,
       t.concluida_por,
       public.nome_perfil(t.created_by) as criado_por_nome,
       public.nome_perfil(t.concluida_por) as concluida_por_nome,
       t.publicacao_id
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

-- ---------- v_publicacoes: tarefas atribuídas a partir da publicação ----------
create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id) as tarefas_atribuidas,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as tarefas_atribuidas_abertas,
       (select string_agg(coalesce(cc.nome,'?') || coalesce(' · ' || to_char(x.prazo,'DD/MM'), ''), ', ' order by x.prazo) from public.tarefas x left join public.colaboradores cc on cc.id = x.responsavel_id where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as atribuidas_para
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.tarefas t on t.id = p.tarefa_id;

select 'ok 0035' as resultado;


-- ===== 0036_djen_entidades_html.sql =====
-- 0036 — Publicações do DJEN: decodificar entidades HTML (&ccedil; &atilde; &nbsp; &#8211; …) no texto limpo, e corrigir o que já foi importado.

create or replace function public.html_decode(t text) returns text
language plpgsql immutable strict as $$
declare r text := t; m text;
begin
  -- numéricas: &#233; &#xE9;
  for m in select distinct (regexp_matches(r, '&#(\d+);', 'g'))[1] loop
    r := replace(r, '&#'||m||';', chr(m::int));
  end loop;
  for m in select distinct (regexp_matches(r, '&#[xX]([0-9a-fA-F]+);', 'g'))[1] loop
    r := regexp_replace(r, '&#[xX]'||m||';', chr(('x'||lpad(m,8,'0'))::bit(32)::int), 'g');
  end loop;
  -- nomeadas mais comuns em português / tipografia
  r := replace(r, '&nbsp;', ' ');   r := replace(r, '&ndash;', '–'); r := replace(r, '&mdash;', '—');
  r := replace(r, '&ldquo;', '“');  r := replace(r, '&rdquo;', '”'); r := replace(r, '&lsquo;', '‘'); r := replace(r, '&rsquo;', '’');
  r := replace(r, '&quot;', '"');   r := replace(r, '&apos;', ''''); r := replace(r, '&hellip;', '…'); r := replace(r, '&ordf;', 'ª'); r := replace(r, '&ordm;', 'º'); r := replace(r, '&sect;', '§'); r := replace(r, '&deg;', '°');
  r := replace(r, '&aacute;', 'á'); r := replace(r, '&agrave;', 'à'); r := replace(r, '&acirc;', 'â'); r := replace(r, '&atilde;', 'ã'); r := replace(r, '&auml;', 'ä');
  r := replace(r, '&eacute;', 'é'); r := replace(r, '&egrave;', 'è'); r := replace(r, '&ecirc;', 'ê'); r := replace(r, '&euml;', 'ë');
  r := replace(r, '&iacute;', 'í'); r := replace(r, '&igrave;', 'ì'); r := replace(r, '&icirc;', 'î'); r := replace(r, '&iuml;', 'ï');
  r := replace(r, '&oacute;', 'ó'); r := replace(r, '&ograve;', 'ò'); r := replace(r, '&ocirc;', 'ô'); r := replace(r, '&otilde;', 'õ'); r := replace(r, '&ouml;', 'ö');
  r := replace(r, '&uacute;', 'ú'); r := replace(r, '&ugrave;', 'ù'); r := replace(r, '&ucirc;', 'û'); r := replace(r, '&uuml;', 'ü');
  r := replace(r, '&ccedil;', 'ç'); r := replace(r, '&ntilde;', 'ñ');
  r := replace(r, '&shy;', ''); r := replace(r, '&cedil;', '¸'); r := replace(r, '&acute;', '´'); r := replace(r, '&rarr;', '→'); r := replace(r, '&larr;', '←'); r := replace(r, '&bull;', '•'); r := replace(r, '&middot;', '·'); r := replace(r, '&laquo;', '«'); r := replace(r, '&raquo;', '»'); r := replace(r, '&copy;', '©'); r := replace(r, '&reg;', '®'); r := replace(r, '&times;', '×'); r := replace(r, '&euro;', '€');
  r := replace(r, '&Aacute;', 'Á'); r := replace(r, '&Agrave;', 'À'); r := replace(r, '&Acirc;', 'Â'); r := replace(r, '&Atilde;', 'Ã');
  r := replace(r, '&Eacute;', 'É'); r := replace(r, '&Ecirc;', 'Ê'); r := replace(r, '&Iacute;', 'Í'); r := replace(r, '&Oacute;', 'Ó'); r := replace(r, '&Ocirc;', 'Ô'); r := replace(r, '&Otilde;', 'Õ'); r := replace(r, '&Uacute;', 'Ú'); r := replace(r, '&Ccedil;', 'Ç');
  r := replace(r, '&lt;', '<'); r := replace(r, '&gt;', '>'); r := replace(r, '&amp;', '&');   -- &amp; por último
  return trim(regexp_replace(regexp_replace(r, '[ \t\r]+', ' ', 'g'), '\s*\n\s*', E'\n', 'g'));
end $$;

-- limpeza de HTML + entidades, reaproveitada na importação
create or replace function public.limpar_html(t text) returns text
language sql immutable strict as $$
  select public.html_decode(regexp_replace(regexp_replace(t, '<br\s*/?>|</p>|</div>|</li>', E'\n', 'gi'), '<[^>]+>', ' ', 'g'));
$$;

create or replace function public.djen_gravar(item jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.publicacoes (id, data_disponibilizacao, tribunal, orgao, id_orgao, tipo_comunicacao, tipo_documento, classe, codigo_classe, numero_processo, meio, link, numero_comunicacao, status_djen, texto, destinatarios, advogados, bruto)
  values ((item->>'id')::bigint, (item->>'data_disponibilizacao')::date, item->>'siglaTribunal', item->>'nomeOrgao', nullif(item->>'idOrgao','')::integer,
          item->>'tipoComunicacao', item->>'tipoDocumento', item->>'nomeClasse', item->>'codigoClasse', coalesce(item->>'numeroprocessocommascara', item->>'numero_processo'),
          item->>'meio', item->>'link', nullif(item->>'numeroComunicacao','')::integer, item->>'status',
          public.limpar_html(coalesce(item->>'texto','')),
          coalesce((select jsonb_agg(jsonb_build_object('nome', d->>'nome', 'polo', d->>'polo')) from jsonb_array_elements(case when jsonb_typeof(item->'destinatarios')='array' then item->'destinatarios' else '[]'::jsonb end) d), '[]'::jsonb),
          coalesce((select jsonb_agg(jsonb_build_object('nome', d->'advogado'->>'nome', 'numero_oab', d->'advogado'->>'numero_oab', 'uf_oab', d->'advogado'->>'uf_oab')) from jsonb_array_elements(case when jsonb_typeof(item->'destinatarioadvogados')='array' then item->'destinatarioadvogados' else '[]'::jsonb end) d), '[]'::jsonb),
          item - 'texto')
  on conflict (id) do update set status_djen = excluded.status_djen, link = coalesce(excluded.link, public.publicacoes.link), updated_at = now();
end $$;

-- corrige o que já está gravado (publicações, andamentos e tarefas gerados delas)
update public.publicacoes set texto = public.html_decode(texto) where texto like '%&%;%';
update public.andamentos set descricao = public.html_decode(descricao) where fonte = 'djen' and descricao like '%&%;%';
update public.tarefas set descricao = public.html_decode(descricao) where descricao like '%&%;%' and (publicacao_id is not null or titulo like 'Analisar publica%');

select 'ok 0036 · '||(select count(*) from public.publicacoes where texto like '%&%;%')||' ainda com entidade' as resultado;


-- ===== 0037_prazos_feriados.sql =====
-- 0037 — Prazos processuais: feriados (nacionais, forenses, estaduais, municipais) e suspensões de prazo (recesso, art. 220 CPC).
-- A contagem é feita no painel (prazos.js) a partir destas tabelas. Idempotente.

create table if not exists public.feriados (
  id bigserial primary key,
  data date not null,
  nome text not null,
  tipo text not null default 'nacional' check (tipo in ('nacional','forense','estadual','municipal')),
  uf text,            -- para estadual/municipal
  comarca text,       -- para municipal (texto livre, ex.: 'Franca')
  ativo boolean not null default true,
  created_at timestamptz default now()
);
create unique index if not exists feriados_uidx on public.feriados (data, tipo, coalesce(uf,''), coalesce(comarca,''));
alter table public.feriados enable row level security;
drop policy if exists "feriados: equipe le" on public.feriados;
create policy "feriados: equipe le" on public.feriados for select to authenticated using (public.sou_equipe());
drop policy if exists "feriados: admin edita" on public.feriados;
create policy "feriados: admin edita" on public.feriados for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

create table if not exists public.suspensoes_prazo (
  id bigserial primary key,
  inicio date not null, fim date not null,
  motivo text not null,
  uf text,            -- null = todos os tribunais
  ativo boolean not null default true
);
alter table public.suspensoes_prazo enable row level security;
drop policy if exists "suspensoes: equipe le" on public.suspensoes_prazo;
create policy "suspensoes: equipe le" on public.suspensoes_prazo for select to authenticated using (public.sou_equipe());
drop policy if exists "suspensoes: admin edita" on public.suspensoes_prazo;
create policy "suspensoes: admin edita" on public.suspensoes_prazo for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- Nacionais (Lei 662/49, 6.802/80, 14.759/23) e forenses de observância geral (Lei 5.010/66 art. 62; CNJ) — 2026 e 2027
insert into public.feriados (data, nome, tipo) values
 ('2026-01-01','Confraternização Universal','nacional'),('2026-02-16','Carnaval (segunda)','forense'),('2026-02-17','Carnaval (terça)','forense'),('2026-02-18','Quarta-feira de Cinzas (expediente parcial)','forense'),
 ('2026-04-03','Sexta-feira Santa','nacional'),('2026-04-21','Tiradentes','nacional'),('2026-05-01','Dia do Trabalho','nacional'),('2026-06-04','Corpus Christi','forense'),
 ('2026-09-07','Independência','nacional'),('2026-10-12','Nossa Senhora Aparecida','nacional'),('2026-11-01','Todos os Santos','forense'),('2026-11-02','Finados','nacional'),('2026-11-15','Proclamação da República','nacional'),('2026-11-20','Consciência Negra','nacional'),
 ('2026-12-08','Dia da Justiça','forense'),('2026-12-24','Véspera de Natal','forense'),('2026-12-25','Natal','nacional'),('2026-12-31','Véspera de Ano Novo','forense'),
 ('2027-01-01','Confraternização Universal','nacional'),('2027-02-08','Carnaval (segunda)','forense'),('2027-02-09','Carnaval (terça)','forense'),('2027-02-10','Quarta-feira de Cinzas (expediente parcial)','forense'),
 ('2027-03-26','Sexta-feira Santa','nacional'),('2027-04-21','Tiradentes','nacional'),('2027-05-01','Dia do Trabalho','nacional'),('2027-05-27','Corpus Christi','forense'),
 ('2027-09-07','Independência','nacional'),('2027-10-12','Nossa Senhora Aparecida','nacional'),('2027-11-01','Todos os Santos','forense'),('2027-11-02','Finados','nacional'),('2027-11-15','Proclamação da República','nacional'),('2027-11-20','Consciência Negra','nacional'),
 ('2027-12-08','Dia da Justiça','forense'),('2027-12-24','Véspera de Natal','forense'),('2027-12-25','Natal','nacional'),('2027-12-31','Véspera de Ano Novo','forense')
on conflict do nothing;
-- Estaduais
insert into public.feriados (data, nome, tipo, uf, comarca) values
 ('2026-07-09','Revolução Constitucionalista','estadual','SP',null),('2027-07-09','Revolução Constitucionalista','estadual','SP',null),
 ('2026-01-25','Aniversário de São Paulo','municipal','SP','São Paulo'),('2027-01-25','Aniversário de São Paulo','municipal','SP','São Paulo'),
 ('2026-11-28','Aniversário de Franca','municipal','SP','Franca'),('2027-11-28','Aniversário de Franca','municipal','SP','Franca')
on conflict do nothing;

-- Recesso forense / suspensão de prazos (CPC art. 220: 20/12 a 20/01)
insert into public.suspensoes_prazo (inicio, fim, motivo)
select d.inicio, d.fim, d.motivo from (values
  ('2025-12-20'::date,'2026-01-20'::date,'Recesso forense — art. 220 CPC'),
  ('2026-12-20'::date,'2027-01-20'::date,'Recesso forense — art. 220 CPC')) as d(inicio,fim,motivo)
where not exists (select 1 from public.suspensoes_prazo s where s.inicio = d.inicio and s.fim = d.fim);

select 'ok 0037 · '||(select count(*) from public.feriados)||' feriados' as resultado;


-- ===== 0038_resumo_diario.sql =====
-- 0038 — Resumo diário por WhatsApp (ChatGuru): às 8h (dias úteis) cada colaborador recebe o que vence hoje, o que está atrasado
-- e o que vem nos próximos dias. Texto montado no banco; envio pela Edge Function chatguru (rota /resumo), com o mesmo token das automações.
-- Idempotente. Depende de 0006 (colaboradores), 0010 (v_prazos), 0027/0028 (automações, token), 0034 (notificacoes).

alter table public.colaboradores add column if not exists whatsapp text;
alter table public.colaboradores add column if not exists resumo_diario boolean not null default true;

-- v_colaboradores com os campos novos (colunas no fim)
drop view if exists public.v_colaboradores;
create view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.apelido, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id, co.foto_path, co.data_nascimento, co.cidade, co.linkedin, co.bio,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       (select count(*) from public.pdi d where d.colaborador_id = co.id and d.status in ('planejado','em_andamento')) as pdi_abertos,
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

create table if not exists public.resumos_enviados (
  id bigserial primary key,
  colaborador_id uuid references public.colaboradores(id) on delete cascade,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  canal text not null default 'whatsapp',
  ok boolean, erro text, numero text, texto text,
  criado_em timestamptz not null default now()
);
create index if not exists resumos_enviados_idx on public.resumos_enviados (colaborador_id, data);
alter table public.resumos_enviados enable row level security;
drop policy if exists "resumos: equipe le" on public.resumos_enviados;
create policy "resumos: equipe le" on public.resumos_enviados for select to authenticated using (public.sou_equipe());

-- ---------- texto do resumo de um colaborador ----------
create or replace function public.resumo_diario_texto(p_colab uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; r record; t text := ''; n int; painel text;
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
begin
  select * into c from public.colaboradores where id = p_colab;
  if c is null then return null; end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PAINEL_URL' limit 1), 'https://nevespaduaadv.github.io/painel') into painel;
  t := '☀️ *Bom dia, ' || split_part(c.nome, ' ', 1) || '!* ' || dias[extract(dow from hoje)::int + 1] || ', ' || to_char(hoje, 'DD/MM') || E'\n';

  -- atrasados
  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada';
  if n > 0 then
    t := t || E'\n🔴 *Atrasado (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada' order by z.prazo limit 8 loop
      t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || ' (' || to_char(r.prazo,'DD/MM') || case when r.prazo_fatal then ', FATAL' else '' end || ')' || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  -- hoje
  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje';
  t := t || E'\n📌 *Vence hoje (' || n || ')*' || E'\n';
  if n = 0 then t := t || '• nada para hoje' || E'\n'; end if;
  for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje' order by z.prazo_fatal desc, z.descricao limit 10 loop
    t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️ FATAL' else '' end || E'\n';
  end loop;

  -- próximos 7 dias
  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7';
  if n > 0 then
    t := t || E'\n📅 *Próximos 7 dias (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7' order by z.prazo, z.prazo_fatal desc limit 8 loop
      t := t || '• ' || to_char(r.prazo,'DD/MM') || ' ' || left(r.descricao, 60) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️' else '' end || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  -- tarefas de lead (CRM) vencidas/hoje, pelo perfil
  if c.perfil_id is not null then
    select count(*) into n from public.lead_tarefas lt where lt.responsavel_id = c.perfil_id and lt.concluida_em is null and (lt.quando at time zone 'America/Sao_Paulo')::date <= hoje;
    if n > 0 then t := t || E'\n📞 *Leads: ' || n || ' tarefa(s) para hoje ou atrasada(s)*' || E'\n'; end if;
    select count(*) into n from public.notificacoes x where x.perfil_id = c.perfil_id and x.lida_em is null;
    if n > 0 then t := t || E'\n🔔 ' || n || ' notificação(ões) não lida(s) no painel' || E'\n'; end if;
  end if;

  t := t || E'\n' || painel || '/#painel';
  return t;
end $$;
revoke all on function public.resumo_diario_texto(uuid) from public, anon;
grant execute on function public.resumo_diario_texto(uuid) to authenticated, service_role;

-- meu próprio resumo (botão no painel)
create or replace function public.meu_resumo_diario() returns text
language sql stable security definer set search_path = public as $$
  select public.resumo_diario_texto((select id from public.colaboradores where perfil_id = auth.uid() limit 1));
$$;
grant execute on function public.meu_resumo_diario() to authenticated;

-- ---------- lote para a Edge Function (token das automações) ----------
create or replace function public.resumo_diario_lote(token text, forcar_colab uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('colaborador_id', c.id, 'nome', c.nome, 'whatsapp', c.whatsapp, 'texto', public.resumo_diario_texto(c.id))), '[]'::jsonb) into res
  from public.colaboradores c
  where c.ativo is distinct from false and c.resumo_diario and nullif(c.whatsapp,'') is not null
    and (forcar_colab is null or c.id = forcar_colab)
    and (forcar_colab is not null or not exists (select 1 from public.resumos_enviados e where e.colaborador_id = c.id and e.data = hoje and e.ok));
  return res;
end $$;
revoke all on function public.resumo_diario_lote(text, uuid) from public, anon, authenticated;
grant execute on function public.resumo_diario_lote(text, uuid) to service_role;

create or replace function public.resumo_diario_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  insert into public.resumos_enviados (colaborador_id, ok, erro, numero, texto)
  select (r->>'colaborador_id')::uuid, (r->>'ok')::boolean, r->>'erro', r->>'numero', r->>'texto' from jsonb_array_elements(resultados) r;
end $$;
revoke all on function public.resumo_diario_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.resumo_diario_registrar(text, jsonb) to service_role;

-- ---------- agendamento: 08:00 America/Sao_Paulo, seg–sex (11:00 UTC; o Brasil não tem horário de verão) ----------
create or replace function public.configurar_resumo_diario(hora_brt integer default 8) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes) — o resumo usa o mesmo token.'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/resumo');
  if auth is null or endpoint is null then raise exception 'Não foi possível ler a URL/token das automações.'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'resumo-diario-np';
  perform cron.schedule('resumo-diario-np', format('0 %s * * 1-5', (hora_brt + 3) % 24), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{}'::jsonb, timeout_milliseconds := 60000)$cmd$,
    endpoint, auth));
  return 'Resumo diário agendado para ' || hora_brt || 'h (seg–sex) em ' || endpoint;
end $$;
revoke all on function public.configurar_resumo_diario(integer) from public, anon, authenticated;

select 'ok 0038' as resultado;


-- ===== 0039_timeline_sem_andamentos_com_tarefas.sql =====
-- 0039 — Timeline = atuação do escritório; andamento processual fica só na aba Processos.
-- (1) andamentos deixam de ser copiados para entradas_timeline (e as cópias antigas são removidas);
-- (2) o que a equipe faz dentro dos processos entra na timeline automaticamente via tarefas: aberta, concluída (com o comentário), cancelada.
-- Idempotente. Depende de 0002 (entradas_timeline), 0034 (tarefa_eventos).

-- ---------- (1) sem cópia de andamentos ----------
drop trigger if exists andamento_para_timeline on public.andamentos;
drop trigger if exists andamento_sync_timeline on public.andamentos;
delete from public.entradas_timeline where andamento_id is not null and automatica;

-- ---------- (2) tarefas na timeline ----------
alter table public.entradas_timeline add column if not exists tarefa_id uuid references public.tarefas(id) on delete set null;
create index if not exists entradas_timeline_tarefa_idx on public.entradas_timeline (tarefa_id);
alter table public.entradas_timeline drop constraint if exists entradas_timeline_tipo_check;
alter table public.entradas_timeline add constraint entradas_timeline_tipo_check check (tipo in ('solicitacao_documentos','requerimento_bacen','analise_contrato','parecer_tecnico','contato_banco',
  'proposta_acordo','reuniao_cliente','ata','protocolo','mudanca_estagio','acordo_fechado','andamento','tarefa','outro'));

create or replace function public.tl_de_evento_tarefa() returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tarefas%rowtype; cid text; txt text; quem text; d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.tarefa_id is null then return null; end if;
  select * into t from public.tarefas where id = new.tarefa_id;
  if t is null then return null; end if;
  cid := t.cliente_id;
  if cid is null and t.processo_id is not null then select cliente_id into cid from public.processos where id = t.processo_id; end if;
  if cid is null then return null; end if;                -- sem cliente: não há timeline onde registrar
  quem := coalesce(new.autor_nome, 'Equipe');
  if new.tipo = 'criada' then
    txt := 'Tarefa aberta: ' || t.titulo || coalesce(' — para ' || new.para, '') || coalesce(' · prazo ' || to_char(t.prazo,'DD/MM/YYYY'), '') || case when t.prazo_fatal then ' (fatal)' else '' end || ' · por ' || quem;
  elsif new.tipo = 'concluida' then
    txt := 'Tarefa concluída: ' || t.titulo || ' · por ' || quem;
  elsif new.tipo = 'cancelada' then
    txt := 'Tarefa cancelada: ' || t.titulo || ' · por ' || quem;
  elsif new.tipo = 'comentario' then
    txt := quem || ' sobre "' || t.titulo || '": ' || coalesce(new.nota, '');
  else
    return null;                                          -- reatribuída, prazo alterado, editada: ficam só no histórico da tarefa
  end if;
  insert into public.entradas_timeline (cliente_id, processo_id, contrato_id, tarefa_id, data, tipo, descricao, visivel_cliente, automatica, fonte, responsavel_id, created_by)
  values (cid, t.processo_id, t.contrato_id, t.id, d, 'tarefa', txt, false, true, 'tarefas', t.responsavel_id, new.autor);
  return null;
end $$;
drop trigger if exists evento_tarefa_para_timeline on public.tarefa_eventos;
create trigger evento_tarefa_para_timeline after insert on public.tarefa_eventos for each row execute procedure public.tl_de_evento_tarefa();

-- backfill dos eventos já existentes (desde 0034)
insert into public.entradas_timeline (cliente_id, processo_id, contrato_id, tarefa_id, data, tipo, descricao, visivel_cliente, automatica, fonte, responsavel_id, created_by)
select coalesce(t.cliente_id, p.cliente_id), t.processo_id, t.contrato_id, t.id, (e.criado_em at time zone 'America/Sao_Paulo')::date, 'tarefa',
       case e.tipo when 'criada' then 'Tarefa aberta: ' || t.titulo || coalesce(' — para ' || e.para, '') || coalesce(' · prazo ' || to_char(t.prazo,'DD/MM/YYYY'), '') || ' · por ' || coalesce(e.autor_nome,'Equipe')
                   when 'concluida' then 'Tarefa concluída: ' || t.titulo || ' · por ' || coalesce(e.autor_nome,'Equipe')
                   when 'cancelada' then 'Tarefa cancelada: ' || t.titulo || ' · por ' || coalesce(e.autor_nome,'Equipe')
                   else coalesce(e.autor_nome,'Equipe') || ' sobre "' || t.titulo || '": ' || coalesce(e.nota,'') end,
       false, true, 'tarefas', t.responsavel_id, e.autor
from public.tarefa_eventos e join public.tarefas t on t.id = e.tarefa_id left join public.processos p on p.id = t.processo_id
where e.tipo in ('criada','concluida','cancelada','comentario') and coalesce(t.cliente_id, p.cliente_id) is not null
  and not exists (select 1 from public.entradas_timeline x where x.tarefa_id = t.id and x.fonte = 'tarefas' and x.descricao like case e.tipo when 'criada' then 'Tarefa aberta:%' when 'concluida' then 'Tarefa concluída:%' when 'cancelada' then 'Tarefa cancelada:%' else '%sobre "%' end and x.data = (e.criado_em at time zone 'America/Sao_Paulo')::date);

select 'ok 0039 · '||(select count(*) from public.entradas_timeline where fonte='tarefas')||' entradas de tarefas' as resultado;


-- ===== 0040_resumo_discord.sql =====
-- 0040 — Resumo diário também pelo Discord (DM via bot do servidor do escritório). Canal escolhido por colaborador.
-- Segredo DISCORD_BOT_TOKEN no Vault: select public.chatguru_segredo_definir('DISCORD_BOT_TOKEN', '…');
-- Idempotente. Depende de 0029 e 0038.

alter table public.colaboradores add column if not exists discord_user_id text;
alter table public.colaboradores add column if not exists canal_resumo text not null default 'discord' check (canal_resumo in ('discord','whatsapp','ambos'));

-- segredos: aceitar DISCORD_*
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;

create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;

-- v_colaboradores com os campos novos
drop view if exists public.v_colaboradores;
create view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.apelido, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id, co.foto_path, co.data_nascimento, co.cidade, co.linkedin, co.bio,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       (select count(*) from public.pdi d where d.colaborador_id = co.id and d.status in ('planejado','em_andamento')) as pdi_abertos,
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

-- lote: inclui canal e discord; envia a quem tem ao menos um destino configurado
create or replace function public.resumo_diario_lote(token text, forcar_colab uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('colaborador_id', c.id, 'nome', c.nome, 'whatsapp', c.whatsapp, 'discord_user_id', c.discord_user_id, 'canal', c.canal_resumo, 'texto', public.resumo_diario_texto(c.id))), '[]'::jsonb) into res
  from public.colaboradores c
  where c.ativo is distinct from false and c.resumo_diario
    and ((c.canal_resumo in ('discord','ambos') and nullif(c.discord_user_id,'') is not null) or (c.canal_resumo in ('whatsapp','ambos') and nullif(c.whatsapp,'') is not null))
    and (forcar_colab is null or c.id = forcar_colab)
    and (forcar_colab is not null or not exists (select 1 from public.resumos_enviados e where e.colaborador_id = c.id and e.data = hoje and e.ok));
  return res;
end $$;
revoke all on function public.resumo_diario_lote(text, uuid) from public, anon, authenticated;
grant execute on function public.resumo_diario_lote(text, uuid) to service_role;

-- registrar: canal
create or replace function public.resumo_diario_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  insert into public.resumos_enviados (colaborador_id, canal, ok, erro, numero, texto)
  select (r->>'colaborador_id')::uuid, coalesce(r->>'canal','whatsapp'), (r->>'ok')::boolean, r->>'erro', r->>'numero', r->>'texto' from jsonb_array_elements(resultados) r;
end $$;
revoke all on function public.resumo_diario_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.resumo_diario_registrar(text, jsonb) to service_role;

-- meu colaborador (para o botão "enviar agora"): id, canal e destinos
create or replace function public.meu_resumo_destinos() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'nome', nome, 'whatsapp', whatsapp, 'discord_user_id', discord_user_id, 'canal', canal_resumo)
  from public.colaboradores where perfil_id = auth.uid() limit 1
$$;
grant execute on function public.meu_resumo_destinos() to authenticated;

select 'ok 0040' as resultado;


-- ===== 0041_superendividamento.sql =====
-- 0041 — Calculadora de planos de pagamento (superendividamento, Lei 14.181/2021 — art. 104-A CDC).
-- Cálculo no painel (superendividamento.js); aqui só a persistência. Idempotente.

create table if not exists public.planos_superendividamento (
  id uuid primary key default gen_random_uuid(),
  cliente_id text references public.clientes(id) on delete set null,   -- opcional: devedor pode estar fora da base
  titulo text not null,
  devedor jsonb not null default '{}'::jsonb,       -- {nome, cpf, rg, nacionalidade, estado_civil, profissao, endereco, cidade, uf, cep, email}
  entradas jsonb not null default '{}'::jsonb,      -- {renda, limitePct, minimoPiso, dividas:[{credor,cnpj,descricao,tipo,saldo,parcela,consignado}], prazo, carenciaDias, juros, dataCalculo, comarca}
  resultado jsonb,                                  -- saída do motor (planoCinco, planoCabe, rateio, tabela…)
  status text not null default 'rascunho' check (status in ('rascunho','concluido')),
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists planos_se_cliente_idx on public.planos_superendividamento (cliente_id);
alter table public.planos_superendividamento enable row level security;
drop policy if exists "planos_se: equipe" on public.planos_superendividamento;
create policy "planos_se: equipe" on public.planos_superendividamento for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop trigger if exists planos_se_carimbo on public.planos_superendividamento;
create trigger planos_se_carimbo before insert or update on public.planos_superendividamento for each row execute procedure public.carimbar2();

create or replace view public.v_planos_superendividamento with (security_invoker = true) as
select p.id, p.titulo, p.cliente_id, c.nome as cliente_nome, p.devedor->>'nome' as devedor_nome, p.status,
       (p.entradas->>'renda')::numeric as renda,
       (select coalesce(sum((d->>'saldo')::numeric),0) from jsonb_array_elements(coalesce(p.entradas->'dividas','[]'::jsonb)) d) as saldo_total,
       jsonb_array_length(coalesce(p.entradas->'dividas','[]'::jsonb)) as qtd_dividas,
       p.resultado->'cinco'->>'parcela' as parcela_cinco, p.resultado->'cabe'->>'meses' as meses_cabe,
       p.created_at, p.updated_at, public.nome_perfil(p.created_by) as criado_por_nome
from public.planos_superendividamento p
left join public.clientes c on c.id = p.cliente_id;

select 'ok 0041' as resultado;


-- ===== 0042_segredos_growth.sql =====
-- 0042 — Segredos do Growth no Vault: WINDSOR_API_KEY e ANTHROPIC_API_KEY (lidos só pela Edge Function). Idempotente.
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;
select 'ok 0042' as resultado;


-- ===== 0043_segredos_meta.sql =====
-- 0043 — Segredos da Meta (Marketing API / Instagram Graph API) no Vault: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_IG_USER_ID, META_PAGE_ID.
-- Lidos só pela Edge Function (chatguru_segredos). Idempotente.
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;
select 'ok 0043' as resultado;


-- ===== 0044_growth.sql =====
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


-- ===== 0045_acessos_gestao.sql =====
-- 0045 — Acessos da seção Gestão: Visão geral só para admin; Growth para admin ou quem tiver a permissão 'growth' em perfis.acessos
-- (marcada pelo admin na tela Usuários). Os dados do Growth (tabelas growth_*) passam a respeitar essa permissão no banco. Idempotente.

alter table public.perfis add column if not exists acessos text[] not null default '{}';

create or replace function public.pode_growth() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' or 'growth' = any(acessos) from public.perfis where id = auth.uid()), false)
$$;
grant execute on function public.pode_growth() to authenticated;

-- o próprio usuário lê o perfil (já existia); o admin edita acessos pela política de admin em perfis (já existente)

-- tabelas do Growth: leitura só para quem pode
do $$ declare t text; begin
  foreach t in array array['growth_meta_anuncios_dia','growth_meta_conta_dia','growth_ig_dia','growth_ig_posts','growth_coletas'] loop
    execute format('drop policy if exists "growth: equipe le" on public.%I', t);
    execute format('drop policy if exists "growth: pode le" on public.%I', t);
    execute format('create policy "growth: pode le" on public.%I for select to authenticated using (public.pode_growth())', t);
  end loop;
end $$;

-- v_growth_leads: só devolve linhas para quem pode (os leads continuam visíveis na tela de Leads para a equipe)
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
left join h on h.lead_id = l.id
where public.pode_growth();

-- status da coleta: só para quem pode
create or replace function public.growth_status() returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.pode_growth() then null else jsonb_build_object(
    'ultima_coleta', (select to_jsonb(c) from (select iniciado_em, terminado_em, ok, erro, detalhes from public.growth_coletas order by id desc limit 1) c),
    'meta_primeiro_dia', (select min(data) from public.growth_meta_conta_dia), 'meta_ultimo_dia', (select max(data) from public.growth_meta_conta_dia),
    'ig_primeiro_dia', (select min(data) from public.growth_ig_dia), 'ig_ultimo_dia', (select max(data) from public.growth_ig_dia),
    'ig_posts', (select count(*) from public.growth_ig_posts),
    'cron', (select jsonb_build_object('schedule', schedule) from cron.job where jobname = 'growth-np')) end;
$$;

select 'ok 0045' as resultado;


-- ===== 0046_tarefas_hora_mencoes.sql =====
-- 0046 — Tarefas: horário opcional no prazo (audiência às 14h) e @menções nos comentários (notificação no sino para quem foi marcado).
-- Idempotente. Depende de 0034 (tarefa_eventos/notificar), 0035 (v_tarefas).

alter table public.tarefas add column if not exists hora time;

-- v_tarefas: mesma ordem de colunas, + hora no fim
create or replace view public.v_tarefas with (security_invoker = true) as
select t.id, t.titulo, t.descricao, t.cliente_id, t.contrato_id, t.processo_id, t.responsavel_id, t.nucleo, t.prazo, t.prazo_fatal, t.status, t.concluida_em, t.prioridade, t.created_at, t.created_by, t.updated_at, t.updated_by,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(h.horas) from public.apontamentos_horas h where h.tarefa_id = t.id), 0) as horas_apontadas,
       t.concluida_por,
       public.nome_perfil(t.created_by) as criado_por_nome,
       public.nome_perfil(t.concluida_por) as concluida_por_nome,
       t.publicacao_id,
       t.hora
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

-- @menções: "@Nome" ou "@Nome Sobrenome" no comentário → notifica o colaborador (primeiro nome ou apelido, sem acento/caixa)
create or replace function public.sem_acento(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;
create or replace function public.tarefa_mencoes() returns trigger language plpgsql security definer set search_path = public as $$
declare m text; alvo record; t public.tarefas%rowtype; quem text; vistos uuid[] := '{}';
begin
  if new.tipo <> 'comentario' or new.nota is null or position('@' in new.nota) = 0 then return null; end if;
  select * into t from public.tarefas where id = new.tarefa_id; if t is null then return null; end if;
  quem := coalesce(new.autor_nome, 'Alguém');
  for m in select distinct lower(x[1]) from regexp_matches(new.nota, '@([[:alpha:]][[:alnum:]._-]*(?:\s[[:upper:]][[:alpha:]]+)?)', 'g') x loop
    for alvo in
      select c.perfil_id from public.colaboradores c
      where c.perfil_id is not null and c.ativo is distinct from false
        and (public.sem_acento(c.nome) = public.sem_acento(m)
             or public.sem_acento(split_part(c.nome,' ',1)) = public.sem_acento(split_part(m,' ',1)) and (position(' ' in m) = 0 or public.sem_acento(c.nome) like public.sem_acento(m) || '%')
             or public.sem_acento(c.apelido) = public.sem_acento(m))
    loop
      if alvo.perfil_id = any(vistos) then continue; end if; vistos := vistos || alvo.perfil_id;
      perform public.notificar(alvo.perfil_id, quem || ' mencionou você em "' || left(t.titulo, 60) || '"', left(new.nota, 200), '#tarefas/' || t.id::text);
    end loop;
  end loop;
  return null;
end $$;
drop trigger if exists tarefa_mencoes_trg on public.tarefa_eventos;
create trigger tarefa_mencoes_trg after insert on public.tarefa_eventos for each row execute procedure public.tarefa_mencoes();

select 'ok 0046' as resultado;


-- ===== 0047_agenda.sql =====
-- 0047 — Agenda do escritório sincronizada com o Google Calendar de cada colaborador (Workspace, conta de serviço com delegação de domínio).
-- Eventos do painel (criados na tela Agenda ou derivados de tarefas com horário / prazo fatal) vão para o Google; eventos do Google voltam para cá.
-- Idempotente. Depende de 0006 (colaboradores), 0003/0046 (tarefas.hora), 0028 (token das automações), 0042 (chatguru_segredo_definir).

alter table public.colaboradores add column if not exists google_calendar_id text;      -- e-mail da agenda (padrão: e-mail Workspace do colaborador)
alter table public.colaboradores add column if not exists agenda_sync boolean not null default false;
alter table public.colaboradores add column if not exists agenda_sync_token text;        -- syncToken do Google (incremental)
alter table public.colaboradores add column if not exists agenda_sync_em timestamptz;
alter table public.colaboradores add column if not exists agenda_sync_erro text;


-- v_colaboradores com os campos da agenda (colunas no fim)
drop view if exists public.v_colaboradores;
create view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.apelido, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id, co.foto_path, co.data_nascimento, co.cidade, co.linkedin, co.bio,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       (select count(*) from public.pdi d where d.colaborador_id = co.id and d.status in ('planejado','em_andamento')) as pdi_abertos,
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo,
       co.google_calendar_id, co.agenda_sync, co.agenda_sync_em, co.agenda_sync_erro
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

create table if not exists public.agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  dia_inteiro boolean not null default false,
  colaborador_id uuid references public.colaboradores(id) on delete cascade,
  cliente_id text references public.clientes(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  tarefa_id uuid references public.tarefas(id) on delete cascade,
  tipo text not null default 'compromisso' check (tipo in ('compromisso','audiencia','reuniao','prazo','pericia','outro')),
  local text, descricao text, link text,
  origem text not null default 'painel' check (origem in ('painel','google','tarefa')),
  google_event_id text, google_calendar_id text, google_etag text,
  cancelado boolean not null default false,
  sincronizado_em timestamptz, atualizado_em timestamptz not null default now(),
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists agenda_eventos_inicio_idx on public.agenda_eventos (inicio);
create index if not exists agenda_eventos_colab_idx on public.agenda_eventos (colaborador_id, inicio);
create unique index if not exists agenda_eventos_google_uidx on public.agenda_eventos (google_calendar_id, google_event_id) where google_event_id is not null;
create unique index if not exists agenda_eventos_tarefa_uidx on public.agenda_eventos (tarefa_id) where tarefa_id is not null;
alter table public.agenda_eventos enable row level security;
drop policy if exists "agenda: equipe" on public.agenda_eventos;
create policy "agenda: equipe" on public.agenda_eventos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop trigger if exists agenda_carimbo on public.agenda_eventos;
create trigger agenda_carimbo before insert or update on public.agenda_eventos for each row execute procedure public.carimbar2();
-- qualquer alteração vinda do painel marca para reenviar ao Google
create or replace function public.agenda_marca_alterado() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.titulo, new.inicio, new.fim, new.dia_inteiro, new.local, new.descricao, new.cancelado, new.colaborador_id) is distinct from (old.titulo, old.inicio, old.fim, old.dia_inteiro, old.local, old.descricao, old.cancelado, old.colaborador_id) then
    new.atualizado_em := now();
  end if;
  return new;
end $$;
drop trigger if exists agenda_alterado on public.agenda_eventos;
create trigger agenda_alterado before update on public.agenda_eventos for each row execute procedure public.agenda_marca_alterado();

-- segredos do Google no Vault (JSON da conta de serviço)
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;

-- ---------- tarefas com horário (ou prazo fatal) viram eventos da agenda do responsável ----------
create or replace function public.tarefa_para_agenda() returns trigger language plpgsql security definer set search_path = public as $$
declare ini timestamptz; fim timestamptz; inteiro boolean; titulo text; cnome text;
begin
  if tg_op = 'DELETE' then delete from public.agenda_eventos where tarefa_id = old.id; return old; end if;
  if new.prazo is null or new.status in ('cancelada') or (new.hora is null and not new.prazo_fatal) then
    update public.agenda_eventos set cancelado = true where tarefa_id = new.id and not cancelado; return new;
  end if;
  inteiro := new.hora is null;
  ini := case when inteiro then (new.prazo::timestamp) at time zone 'America/Sao_Paulo' else (new.prazo + new.hora) at time zone 'America/Sao_Paulo' end;
  fim := case when inteiro then ((new.prazo + 1)::timestamp) at time zone 'America/Sao_Paulo' else ini + interval '1 hour' end;
  select nome into cnome from public.clientes where id = new.cliente_id;
  titulo := case when new.prazo_fatal and inteiro then 'PRAZO FATAL: ' else '' end || new.titulo || coalesce(' — ' || cnome, '');
  insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, cliente_id, processo_id, tarefa_id, tipo, origem, cancelado, created_by)
  values (titulo, ini, fim, inteiro, new.responsavel_id, new.cliente_id, new.processo_id, new.id, case when new.prazo_fatal and inteiro then 'prazo' else 'compromisso' end, 'tarefa', new.status = 'concluida', new.created_by)
  on conflict (tarefa_id) where tarefa_id is not null do update set titulo = excluded.titulo, inicio = excluded.inicio, fim = excluded.fim, dia_inteiro = excluded.dia_inteiro,
    colaborador_id = excluded.colaborador_id, cliente_id = excluded.cliente_id, processo_id = excluded.processo_id, tipo = excluded.tipo, cancelado = excluded.cancelado;
  return new;
end $$;
drop trigger if exists tarefa_agenda on public.tarefas;
create trigger tarefa_agenda after insert or update of prazo, hora, prazo_fatal, titulo, responsavel_id, cliente_id, processo_id, status or delete on public.tarefas for each row execute procedure public.tarefa_para_agenda();
-- backfill
update public.tarefas set updated_at = updated_at where prazo is not null and (hora is not null or prazo_fatal) and status in ('aberta','em_andamento');

-- ---------- view para a tela ----------
create or replace view public.v_agenda with (security_invoker = true) as
select e.id, e.titulo, e.inicio, e.fim, e.dia_inteiro, e.colaborador_id, co.nome as colaborador_nome, e.cliente_id, c.nome as cliente_nome, e.processo_id, p.numero_cnj,
       e.tarefa_id, e.tipo, e.local, e.descricao, e.link, e.origem, e.google_event_id is not null as no_google, e.cancelado, e.sincronizado_em, e.updated_at
from public.agenda_eventos e
left join public.colaboradores co on co.id = e.colaborador_id
left join public.clientes c on c.id = e.cliente_id
left join public.processos p on p.id = e.processo_id;

-- ---------- RPCs usadas pela Edge Function (token das automações) ----------
-- colaboradores com sincronização ligada + eventos do painel pendentes de envio
create or replace function public.agenda_lote(token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'colaborador_id', c.id, 'nome', c.nome, 'calendar_id', coalesce(nullif(c.google_calendar_id,''), c.email), 'sync_token', c.agenda_sync_token,
    'pendentes', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim, 'dia_inteiro', e.dia_inteiro, 'local', e.local, 'descricao', e.descricao,
                                   'cancelado', e.cancelado, 'google_event_id', e.google_event_id, 'google_calendar_id', e.google_calendar_id)), '[]'::jsonb)
                  from public.agenda_eventos e where e.colaborador_id = c.id and e.origem in ('painel','tarefa')
                    and (e.google_event_id is null or e.sincronizado_em is null or e.atualizado_em > e.sincronizado_em) and (not e.cancelado or e.google_event_id is not null)
                    and e.inicio > now() - interval '30 days')))
    from public.colaboradores c where c.agenda_sync and c.ativo is distinct from false and coalesce(nullif(c.google_calendar_id,''), c.email) is not null), '[]'::jsonb);
end $$;
revoke all on function public.agenda_lote(text) from public, anon, authenticated;
grant execute on function public.agenda_lote(text) to service_role;

-- resultado do envio ao Google
create or replace function public.agenda_marcar_enviados(token text, itens jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  update public.agenda_eventos e set google_event_id = coalesce(i->>'google_event_id', e.google_event_id), google_calendar_id = coalesce(i->>'google_calendar_id', e.google_calendar_id),
         google_etag = i->>'etag', sincronizado_em = now()
  from jsonb_array_elements(itens) i where e.id = (i->>'id')::uuid and (i->>'ok')::boolean;
end $$;
revoke all on function public.agenda_marcar_enviados(text, jsonb) from public, anon, authenticated;
grant execute on function public.agenda_marcar_enviados(text, jsonb) to service_role;

-- eventos vindos do Google de um colaborador (upsert; cancelados marcam cancelado) + novo syncToken
create or replace function public.agenda_gravar_google(token text, p_colab uuid, p_calendar text, eventos jsonb, p_sync_token text, p_erro text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; ev jsonb;
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for ev in select * from jsonb_array_elements(coalesce(eventos, '[]'::jsonb)) loop
    if ev->>'status' = 'cancelled' then
      update public.agenda_eventos set cancelado = true, sincronizado_em = now() where google_calendar_id = p_calendar and google_event_id = ev->>'id';
    else
      insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, local, descricao, link, origem, google_event_id, google_calendar_id, google_etag, cancelado, sincronizado_em)
      values (coalesce(nullif(ev->>'titulo',''), '(sem título)'), (ev->>'inicio')::timestamptz, (ev->>'fim')::timestamptz, coalesce((ev->>'dia_inteiro')::boolean, false), p_colab, ev->>'local', left(ev->>'descricao', 2000), ev->>'link', 'google', ev->>'id', p_calendar, ev->>'etag', false, now())
      on conflict (google_calendar_id, google_event_id) where google_event_id is not null do update set
        titulo = excluded.titulo, inicio = excluded.inicio, fim = excluded.fim, dia_inteiro = excluded.dia_inteiro, local = excluded.local,
        descricao = case when agenda_eventos.origem = 'google' then excluded.descricao else agenda_eventos.descricao end, link = excluded.link, google_etag = excluded.google_etag, cancelado = false, sincronizado_em = now();
    end if;
    n := n + 1;
  end loop;
  update public.colaboradores set agenda_sync_token = coalesce(p_sync_token, agenda_sync_token), agenda_sync_em = now(), agenda_sync_erro = p_erro where id = p_colab;
  return n;
end $$;
revoke all on function public.agenda_gravar_google(text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.agenda_gravar_google(text, uuid, text, jsonb, text, text) to service_role;

-- ---------- agendamento: a cada 15 minutos ----------
create or replace function public.configurar_agenda(minutos integer default 15) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes).'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/agenda');
  perform cron.unschedule(jobid) from cron.job where jobname = 'agenda-np';
  perform cron.schedule('agenda-np', format('*/%s * * * *', minutos), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{}'::jsonb, timeout_milliseconds := 120000)$cmd$, endpoint, auth));
  return 'Agenda sincronizando a cada ' || minutos || ' min em ' || endpoint;
end $$;
revoke all on function public.configurar_agenda(integer) from public, anon, authenticated;
select public.configurar_agenda(15) as resultado;


-- ===== 0048_leads_meta_ids.sql =====
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


-- ===== 0049_webhook_campanha_id.sql =====
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


select 'ok parte 5/9' as resultado;
