-- ESPELHO (beta) — parte 2 de 9: 0020_pr10_cofre_2fa.sql … 0030_pr15_fluxo_lead.sql

-- ===== 0020_pr10_cofre_2fa.sql =====
-- 0020 — PR 10: cofre de segredos dos acessos (Supabase Vault) + 2FA por aplicativo autenticador (TOTP).
-- • Senhas e segredos TOTP saem da tabela e vão para o Vault (criptografado). O navegador nunca recebe o segredo TOTP:
--   pede ao banco o código de 6 dígitos (totp_codigo). A senha é revelada só via função (acesso_senha), e cada revelação/
--   geração de código fica registrada em acessos_logs (quem, quando, qual acesso).
-- • A auditoria genérica deixa de guardar senha em claro (a coluna some; só ficam ids de segredo).
-- Idempotente. Depende de 0012. Requer extensões supabase_vault e pgcrypto (padrão no Supabase).

create extension if not exists pgcrypto with schema extensions;

alter table public.acessos_sistemas
  add column if not exists senha_secret_id uuid,
  add column if not exists totp_secret_id uuid,
  add column if not exists totp_digitos smallint not null default 6,
  add column if not exists totp_periodo smallint not null default 30,
  add column if not exists totp_algoritmo text not null default 'sha1' check (totp_algoritmo in ('sha1','sha256','sha512')),
  add column if not exists totp_emissor text,
  add column if not exists totp_desde timestamptz;

-- Registro de uso (quem viu a senha / gerou código)
create table if not exists public.acessos_logs (
  id bigserial primary key,
  quando timestamptz not null default now(),
  usuario uuid,
  acesso_id uuid references public.acessos_sistemas(id) on delete set null,
  cliente_id text,
  sistema text,
  acao text not null check (acao in ('ver_senha','copiar_senha','definir_senha','codigo_2fa','cadastrar_2fa','remover_2fa'))
);
create index if not exists acessos_logs_quando_idx on public.acessos_logs(quando desc);
alter table public.acessos_logs enable row level security;
drop policy if exists aclog_sel on public.acessos_logs;
create policy aclog_sel on public.acessos_logs for select to authenticated using (public.sou_admin());
revoke all on public.acessos_logs from anon;

-- ---------- utilidades ----------
create or replace function public.base32_decode(t text) returns bytea language plpgsql immutable as $$
declare s text := upper(regexp_replace(coalesce(t,''), '[\s=-]', '', 'g')); alf constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        bits int := 0; buf int := 0; out bytea := '\x'; i int; v int;
begin
  for i in 1..length(s) loop
    v := position(substr(s, i, 1) in alf) - 1;
    if v < 0 then raise exception 'segredo inválido (caractere % não é base32)', substr(s, i, 1); end if;
    buf := (buf << 5) | v; bits := bits + 5;
    if bits >= 8 then out := out || set_byte('\x00'::bytea, 0, (buf >> (bits - 8)) & 255); bits := bits - 8; buf := buf & ((1 << bits) - 1); end if;
  end loop;
  return out;
end $$;

-- Cálculo TOTP (RFC 6238). Interno: sem grant.
create or replace function public.totp_calcular(chave bytea, ts bigint, digitos int default 6, periodo int default 30, algoritmo text default 'sha1')
returns text language plpgsql immutable set search_path = public, extensions as $$
declare c bigint := floor(ts / periodo); msg bytea := '\x0000000000000000'; i int; h bytea; off int; code bigint;
begin
  for i in 0..7 loop msg := set_byte(msg, 7 - i, ((c >> (8*i)) & 255)::int); end loop;
  h := hmac(msg, chave, algoritmo);
  off := get_byte(h, length(h) - 1) & 15;
  code := ((get_byte(h, off) & 127)::bigint << 24) | (get_byte(h, off+1)::bigint << 16) | (get_byte(h, off+2)::bigint << 8) | get_byte(h, off+3)::bigint;
  return lpad((code % (10::bigint ^ digitos)::bigint)::text, digitos, '0');
end $$;
revoke all on function public.totp_calcular(bytea, bigint, int, int, text) from public, anon, authenticated;
revoke all on function public.base32_decode(text) from public, anon, authenticated;

create or replace function public._acesso_log(a public.acessos_sistemas, acao text) returns void language sql security definer set search_path = public as $$
  insert into public.acessos_logs (usuario, acesso_id, cliente_id, sistema, acao) values (auth.uid(), a.id, a.cliente_id, a.sistema, acao)
$$;
revoke all on function public._acesso_log(public.acessos_sistemas, text) from public, anon, authenticated;

-- ---------- senha no cofre ----------
create or replace function public.acesso_senha_definir(acesso_id uuid, senha text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare a public.acessos_sistemas; sid uuid;
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  select * into a from public.acessos_sistemas where id = acesso_id; if a.id is null then raise exception 'acesso não encontrado'; end if;
  if senha is null or senha = '' then
    if a.senha_secret_id is not null then delete from vault.secrets where id = a.senha_secret_id; end if;
    update public.acessos_sistemas set senha_secret_id = null where id = acesso_id;
  elsif a.senha_secret_id is not null then
    perform vault.update_secret(a.senha_secret_id, senha);
  else
    sid := vault.create_secret(senha, 'acesso_senha:'||acesso_id::text, 'senha de acesso — '||a.sistema);
    update public.acessos_sistemas set senha_secret_id = sid where id = acesso_id;
  end if;
  perform public._acesso_log(a, 'definir_senha');
end $$;
grant execute on function public.acesso_senha_definir(uuid, text) to authenticated;

create or replace function public.acesso_senha(acesso_id uuid, motivo text default 'ver_senha') returns text
language plpgsql security definer set search_path = public, vault as $$
declare a public.acessos_sistemas; s text;
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  select * into a from public.acessos_sistemas where id = acesso_id; if a.id is null or a.senha_secret_id is null then return null; end if;
  select decrypted_secret into s from vault.decrypted_secrets where id = a.senha_secret_id;
  perform public._acesso_log(a, case when motivo = 'copiar_senha' then 'copiar_senha' else 'ver_senha' end);
  return s;
end $$;
grant execute on function public.acesso_senha(uuid, text) to authenticated;

-- ---------- 2FA (TOTP) ----------
-- Aceita a "chave manual" (base32, com ou sem espaços) ou a URI otpauth://totp/...?secret=...&digits=&period=&algorithm=&issuer=
create or replace function public.totp_cadastrar(acesso_id uuid, segredo text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare a public.acessos_sistemas; s text := trim(segredo); sec text; dig int := 6; per int := 30; alg text := 'sha1'; iss text; sid uuid; k bytea;
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  select * into a from public.acessos_sistemas where id = acesso_id; if a.id is null then raise exception 'acesso não encontrado'; end if;
  if s ilike 'otpauth://%' then
    sec := substring(s from '(?i)[?&]secret=([^&]+)');
    sec := regexp_replace(coalesce(sec,''), '(%20|\+)', '', 'g');
    dig := coalesce(substring(s from '(?i)[?&]digits=(\d+)')::int, 6);
    per := coalesce(substring(s from '(?i)[?&]period=(\d+)')::int, 30);
    alg := lower(coalesce(substring(s from '(?i)[?&]algorithm=([A-Za-z0-9]+)'), 'sha1'));
    iss := coalesce(substring(s from '(?i)[?&]issuer=([^&]+)'), substring(s from '(?i)otpauth://totp/([^:?]+):'));
    if iss is not null then iss := replace(replace(iss, '%20', ' '), '+', ' '); end if;
  else
    sec := s;
  end if;
  if sec is null or length(regexp_replace(sec, '[\s=-]', '', 'g')) < 16 then raise exception 'segredo 2FA inválido ou curto demais'; end if;
  if alg not in ('sha1','sha256','sha512') then raise exception 'algoritmo % não suportado', alg; end if;
  k := public.base32_decode(sec);  -- valida
  sec := upper(regexp_replace(sec, '[\s=-]', '', 'g'));
  if a.totp_secret_id is not null then delete from vault.secrets where id = a.totp_secret_id; end if;
  sid := vault.create_secret(sec, 'acesso_totp:'||acesso_id::text, 'segredo TOTP — '||a.sistema);
  update public.acessos_sistemas set totp_secret_id = sid, totp_digitos = dig, totp_periodo = per, totp_algoritmo = alg, totp_emissor = iss, totp_desde = now() where id = acesso_id;
  perform public._acesso_log(a, 'cadastrar_2fa');
end $$;
grant execute on function public.totp_cadastrar(uuid, text) to authenticated;

create or replace function public.totp_remover(acesso_id uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare a public.acessos_sistemas;
begin
  if not public.sou_admin() then raise exception 'só o administrador remove o 2FA'; end if;
  select * into a from public.acessos_sistemas where id = acesso_id; if a.id is null then return; end if;
  if a.totp_secret_id is not null then delete from vault.secrets where id = a.totp_secret_id; end if;
  update public.acessos_sistemas set totp_secret_id = null, totp_emissor = null, totp_desde = null where id = acesso_id;
  perform public._acesso_log(a, 'remover_2fa');
end $$;
grant execute on function public.totp_remover(uuid) to authenticated;

-- Código atual + segundos restantes. O segredo não sai do banco.
create or replace function public.totp_codigo(acesso_id uuid) returns table (codigo text, restam int, periodo int, proximo text)
language plpgsql security definer set search_path = public, vault as $$
declare a public.acessos_sistemas; s text; k bytea; ts bigint := floor(extract(epoch from clock_timestamp()))::bigint;
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  select * into a from public.acessos_sistemas where id = acesso_id; if a.id is null or a.totp_secret_id is null then raise exception '2FA não cadastrado'; end if;
  select decrypted_secret into s from vault.decrypted_secrets where id = a.totp_secret_id;
  k := public.base32_decode(s);
  perform public._acesso_log(a, 'codigo_2fa');
  return query select public.totp_calcular(k, ts, a.totp_digitos, a.totp_periodo, a.totp_algoritmo),
                      (a.totp_periodo - (ts % a.totp_periodo))::int, a.totp_periodo::int,
                      public.totp_calcular(k, ts + a.totp_periodo, a.totp_digitos, a.totp_periodo, a.totp_algoritmo);
end $$;
grant execute on function public.totp_codigo(uuid) to authenticated;

-- ---------- migração das senhas existentes para o cofre e remoção da coluna em claro ----------
do $$ declare r record; sid uuid; begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='acessos_sistemas' and column_name='senha') then
    for r in select id, sistema, senha from public.acessos_sistemas where senha is not null and senha <> '' and senha_secret_id is null loop
      sid := vault.create_secret(r.senha, 'acesso_senha:'||r.id::text, 'senha de acesso — '||r.sistema);
      update public.acessos_sistemas set senha_secret_id = sid where id = r.id;
    end loop;
    alter table public.acessos_sistemas drop column senha;
  end if;
end $$;
-- apaga senhas em claro que ficaram na auditoria genérica
update public.auditoria set antes = antes - 'senha', depois = depois - 'senha' where tabela = 'acessos_sistemas' and (antes ? 'senha' or depois ? 'senha');

-- ids de segredo nunca saem para o cliente/BI (a tabela já é só equipe); e a lista não precisa dos ids
create or replace view public.v_acessos_sistemas with (security_invoker = true) as
select id, cliente_id, sistema, titular, login, observacoes, (senha_secret_id is not null) as tem_senha, (totp_secret_id is not null) as tem_2fa,
       totp_digitos, totp_periodo, totp_emissor, totp_desde, created_at, updated_at
from public.acessos_sistemas;
revoke all on public.v_acessos_sistemas from anon;

select 'ok 0020' as resultado;

-- Janela de códigos (atual + próximos N) para a tela ficar "viva" como um autenticador, com um único registro no log.
create or replace function public.totp_janela(acesso_id uuid, qtd int default 10) returns table (inicio bigint, periodo int, codigos text[])
language plpgsql security definer set search_path = public, vault as $$
declare a public.acessos_sistemas; s text; k bytea; ts bigint := floor(extract(epoch from clock_timestamp()))::bigint; i int; arr text[] := '{}';
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  select * into a from public.acessos_sistemas where id = acesso_id; if a.id is null or a.totp_secret_id is null then raise exception '2FA não cadastrado'; end if;
  select decrypted_secret into s from vault.decrypted_secrets where id = a.totp_secret_id;
  k := public.base32_decode(s); qtd := greatest(1, least(qtd, 20));
  for i in 0..qtd-1 loop arr := arr || public.totp_calcular(k, ts + i*a.totp_periodo, a.totp_digitos, a.totp_periodo, a.totp_algoritmo); end loop;
  perform public._acesso_log(a, 'codigo_2fa');
  return query select (ts - ts % a.totp_periodo)::bigint, a.totp_periodo::int, arr;
end $$;
grant execute on function public.totp_janela(uuid, int) to authenticated;

-- Lista para a tela Autenticador (todos os acessos com 2FA da carteira)
create or replace view public.v_autenticador with (security_invoker = true) as
select a.id, a.cliente_id, c.nome as cliente_nome, a.sistema, a.titular, a.login, a.totp_emissor, a.totp_periodo, a.totp_digitos
from public.acessos_sistemas a join public.clientes c on c.id = a.cliente_id
where a.totp_secret_id is not null;
revoke all on public.v_autenticador from anon;

select 'ok 0020b' as resultado;


-- ===== 0021_pr10b_contas_escritorio.sql =====
-- 0021 — PR 10b: acessos/2FA do escritório (tribunais etc., no nome da advogada), sem vínculo com cliente.
-- Reaproveita acessos_sistemas (cliente_id passa a aceitar nulo = conta do escritório), o cofre e as funções da 0020.
-- Idempotente. Depende de 0020.

alter table public.acessos_sistemas alter column cliente_id drop not null;
alter table public.acessos_sistemas add column if not exists grupo text;   -- "Tribunais", "Receita", "Bancos"… (contas do escritório)
create index if not exists acessos_sistemas_escritorio_idx on public.acessos_sistemas(grupo, sistema) where cliente_id is null;

drop view if exists public.v_acessos_sistemas;
create view public.v_acessos_sistemas with (security_invoker = true) as
select id, cliente_id, grupo, sistema, titular, login, observacoes, (senha_secret_id is not null) as tem_senha, (totp_secret_id is not null) as tem_2fa,
       totp_digitos, totp_periodo, totp_emissor, totp_desde, created_at, updated_at
from public.acessos_sistemas;
revoke all on public.v_acessos_sistemas from anon;

drop view if exists public.v_autenticador;
create view public.v_autenticador with (security_invoker = true) as
select a.id, a.cliente_id, c.nome as cliente_nome, a.grupo, a.sistema, a.titular, a.login, a.observacoes, a.totp_emissor, a.totp_periodo, a.totp_digitos, (a.senha_secret_id is not null) as tem_senha
from public.acessos_sistemas a left join public.clientes c on c.id = a.cliente_id
where a.totp_secret_id is not null;
revoke all on public.v_autenticador from anon;

-- contas do escritório sem 2FA ainda (para a lista de cadastro da tela Autenticador)
create or replace view public.v_contas_escritorio with (security_invoker = true) as
select id, grupo, sistema, titular, login, observacoes, (senha_secret_id is not null) as tem_senha, (totp_secret_id is not null) as tem_2fa, totp_emissor, created_at
from public.acessos_sistemas where cliente_id is null;
revoke all on public.v_contas_escritorio from anon;

select 'ok 0021' as resultado;


-- ===== 0022_pr11_marketing_pautas.sql =====
-- 0022 — PR 11: Marketing — pautas de conteúdo com calendário e fluxo de aprovação das sócias.
-- Fluxo: ideia → em_aprovacao → (aprovado | ajustar) → em_producao → agendado → publicado (ou cancelado).
-- Só admin aprova (gatilho garante); equipe cria/edita/move o resto; comentários registram pedidos de ajuste e aprovações.
-- Idempotente. Depende de 0006 (colaboradores).

-- núcleo "marketing" (e "rh") passam a existir para colaboradores e tarefas
alter table public.colaboradores drop constraint if exists colaboradores_nucleo_check;
alter table public.colaboradores add constraint colaboradores_nucleo_check check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','marketing','administrativo','rh','socios'));
alter table public.tarefas drop constraint if exists tarefas_nucleo_check;
alter table public.tarefas add constraint tarefas_nucleo_check check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','marketing','administrativo','rh','socios'));

create table if not exists public.pautas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,                                   -- ideia, gancho, roteiro
  formato text not null default 'carrossel' check (formato in ('reels','carrossel','estatico','story','artigo','email','video','live','outro')),
  canais text[] not null default '{instagram}',     -- instagram, linkedin, youtube, blog, whatsapp, email, tiktok
  pilar text,                                       -- autoridade, educativo, prova social, bastidores, oferta…
  objetivo text,                                    -- atração, autoridade, conversão, relacionamento
  data_prevista date,
  data_publicacao date,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  status text not null default 'ideia' check (status in ('ideia','em_aprovacao','ajustar','aprovado','em_producao','agendado','publicado','cancelado')),
  link_criativo text,                               -- Drive / Canva / Figma
  link_publicado text,
  legenda text,
  hashtags text,
  aprovado_por uuid,                                -- perfil (auth.uid) da sócia
  aprovado_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual','ia')),
  metricas jsonb,                                   -- {alcance, curtidas, comentarios, salvamentos, leads}
  ordem integer not null default 0,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
alter table public.pautas add column if not exists hora_prevista time;   -- horário de publicação (como no agendador)
create index if not exists pautas_data_idx on public.pautas(data_prevista);
create index if not exists pautas_status_idx on public.pautas(status, ordem);

create table if not exists public.pautas_comentarios (
  id bigserial primary key,
  pauta_id uuid not null references public.pautas(id) on delete cascade,
  autor_id uuid,                                    -- perfil
  tipo text not null default 'comentario' check (tipo in ('comentario','ajuste','aprovacao','status')),
  texto text not null,
  created_at timestamptz default now()
);
create index if not exists pautas_comentarios_idx on public.pautas_comentarios(pauta_id, created_at);

-- Aprovação só por admin; registra quem/quando; mudança de status vira comentário automático
create or replace function public.pauta_fluxo() returns trigger language plpgsql security definer set search_path = public as $$
declare nome text;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'aprovado' and not public.sou_admin() then raise exception 'Só as sócias aprovam pautas'; end if;
    if new.status = 'aprovado' then new.aprovado_por := auth.uid(); new.aprovado_em := now(); end if;
    if new.status = 'publicado' and new.data_publicacao is null then new.data_publicacao := current_date; end if;
    select coalesce(p.nome, p.email, 'sistema') into nome from public.perfis p where p.id = auth.uid();
    insert into public.pautas_comentarios (pauta_id, autor_id, tipo, texto) values (old.id, auth.uid(), 'status', coalesce(nome,'sistema')||' moveu de '||old.status||' para '||new.status);
  end if;
  return new;
end $$;
drop trigger if exists pautas_fluxo on public.pautas;
create trigger pautas_fluxo before update on public.pautas for each row execute procedure public.pauta_fluxo();
drop trigger if exists pautas_carimbo on public.pautas;
create trigger pautas_carimbo before insert or update on public.pautas for each row execute procedure public.carimbar2();
drop trigger if exists pautas_audit on public.pautas;
create trigger pautas_audit after insert or update or delete on public.pautas for each row execute procedure public.auditar();

alter table public.pautas enable row level security;
alter table public.pautas_comentarios enable row level security;
drop policy if exists pautas_sel on public.pautas;  create policy pautas_sel on public.pautas for select to authenticated using (public.sou_equipe());
drop policy if exists pautas_ins on public.pautas;  create policy pautas_ins on public.pautas for insert to authenticated with check (public.sou_equipe());
drop policy if exists pautas_upd on public.pautas;  create policy pautas_upd on public.pautas for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists pautas_del on public.pautas;  create policy pautas_del on public.pautas for delete to authenticated using (public.sou_admin());
drop policy if exists pcom_sel on public.pautas_comentarios; create policy pcom_sel on public.pautas_comentarios for select to authenticated using (public.sou_equipe());
drop policy if exists pcom_ins on public.pautas_comentarios; create policy pcom_ins on public.pautas_comentarios for insert to authenticated with check (public.sou_equipe() and (autor_id is null or autor_id = auth.uid()));
drop policy if exists pcom_del on public.pautas_comentarios; create policy pcom_del on public.pautas_comentarios for delete to authenticated using (public.sou_admin() or autor_id = auth.uid());
revoke all on public.pautas from anon; revoke all on public.pautas_comentarios from anon;
do $$ begin if exists (select 1 from pg_roles where rolname='bi') then revoke all on public.pautas from bi; revoke all on public.pautas_comentarios from bi; end if; end $$;

drop view if exists public.v_pautas;
create view public.v_pautas with (security_invoker = true) as
select p.*, co.nome as responsavel_nome, ap.nome as aprovado_por_nome,
       (select count(*) from public.pautas_comentarios c where c.pauta_id = p.id and c.tipo in ('comentario','ajuste')) as n_comentarios,
       (select c.texto from public.pautas_comentarios c where c.pauta_id = p.id and c.tipo = 'ajuste' order by c.created_at desc limit 1) as ultimo_ajuste,
       case when p.data_prevista < current_date and p.status not in ('publicado','cancelado') then true else false end as atrasada
from public.pautas p
left join public.colaboradores co on co.id = p.responsavel_id
left join public.perfis ap on ap.id = p.aprovado_por;
revoke all on public.v_pautas from anon;

create or replace view public.v_pautas_comentarios with (security_invoker = true) as
select c.*, coalesce(p.nome, p.email) as autor_nome from public.pautas_comentarios c left join public.perfis p on p.id = c.autor_id;
revoke all on public.v_pautas_comentarios from anon;

do $$ begin alter publication supabase_realtime add table public.pautas; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.pautas_comentarios; exception when others then null; end $$;

select 'ok 0022' as resultado;


-- ===== 0023_pr12_rh.sql =====
-- 0023 — PR 12: RH — ficha do colaborador (foto, dados pessoais), dados sensíveis/salário só para admin, histórico e PDI.
-- Regras: equipe vê a ficha básica de todos (foto, cargo, núcleo, contato, aniversário); salário, documentos e histórico
-- só admin; cada colaborador vê e atualiza o próprio PDI e vê os registros marcados como visíveis para ele.
-- Idempotente. Depende de 0006 e 0022 (núcleos marketing/rh).

-- ---------- ficha básica (visível à equipe) ----------
alter table public.colaboradores
  add column if not exists foto_path text,            -- caminho no bucket 'fotos'
  add column if not exists apelido text,
  add column if not exists data_nascimento date,
  add column if not exists cidade text,
  add column if not exists linkedin text,
  add column if not exists bio text;                  -- "sobre mim" curto

-- ---------- dados sensíveis (só admin) ----------
create table if not exists public.colaboradores_rh (
  id uuid not null default gen_random_uuid(),                   -- a auditoria genérica exige coluna id
  colaborador_id uuid primary key references public.colaboradores(id) on delete cascade,
  cpf text, rg text, pis text,
  estado_civil text,
  endereco text,
  contato_emergencia text,                            -- nome e telefone
  vinculo text check (vinculo in ('clt','pj','estagio','socio','autonomo','outro')),
  jornada text,                                       -- "44h", "meio período"…
  salario numeric(12,2),
  beneficios text,                                    -- VR, VT, plano…
  cnpj_pj text, razao_social_pj text,
  banco_pix text,
  documentos jsonb not null default '[]',             -- [{titulo, url}]
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
drop trigger if exists colaboradores_rh_carimbo on public.colaboradores_rh;
create trigger colaboradores_rh_carimbo before insert or update on public.colaboradores_rh for each row execute procedure public.carimbar2();
drop trigger if exists colaboradores_rh_audit on public.colaboradores_rh;
create trigger colaboradores_rh_audit after insert or update or delete on public.colaboradores_rh for each row execute procedure public.auditar();
alter table public.colaboradores_rh enable row level security;
drop policy if exists crh_admin on public.colaboradores_rh;
create policy crh_admin on public.colaboradores_rh for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.colaboradores_rh from anon;

-- ---------- histórico (admissão, reajuste, promoção, feedback formal, férias, advertência, desligamento) — só admin ----------
create table if not exists public.colaboradores_historico (
  id bigserial primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  data date not null default current_date,
  tipo text not null check (tipo in ('admissao','promocao','reajuste','mudanca_cargo','ferias','feedback','advertencia','desligamento','outro')),
  descricao text,
  valor numeric(12,2),                                -- novo salário, quando reajuste
  created_at timestamptz default now(), created_by uuid
);
create index if not exists colab_hist_idx on public.colaboradores_historico(colaborador_id, data desc);
alter table public.colaboradores_historico enable row level security;
drop policy if exists chist_admin on public.colaboradores_historico;
create policy chist_admin on public.colaboradores_historico for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.colaboradores_historico from anon;

-- ---------- PDI ----------
create table if not exists public.pdi (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  titulo text not null,
  descricao text,                                     -- competência, como medir
  prazo date,
  status text not null default 'planejado' check (status in ('planejado','em_andamento','concluido','cancelado')),
  progresso smallint not null default 0 check (progresso between 0 and 100),
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists pdi_colab_idx on public.pdi(colaborador_id, status);
drop trigger if exists pdi_carimbo on public.pdi;
create trigger pdi_carimbo before insert or update on public.pdi for each row execute procedure public.carimbar2();
alter table public.pdi enable row level security;
drop policy if exists pdi_admin on public.pdi;
create policy pdi_admin on public.pdi for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists pdi_proprio_sel on public.pdi;
create policy pdi_proprio_sel on public.pdi for select to authenticated using (colaborador_id = public.meu_colaborador());
drop policy if exists pdi_proprio_upd on public.pdi;
create policy pdi_proprio_upd on public.pdi for update to authenticated using (colaborador_id = public.meu_colaborador()) with check (colaborador_id = public.meu_colaborador());
revoke all on public.pdi from anon;

-- registros de acompanhamento: 1:1, feedback, avaliação, nota — admin escreve; colaborador vê os marcados como visíveis
create table if not exists public.pdi_registros (
  id bigserial primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  pdi_id uuid references public.pdi(id) on delete set null,
  data date not null default current_date,
  tipo text not null default 'one_on_one' check (tipo in ('one_on_one','feedback','avaliacao','nota')),
  texto text not null,
  visivel_colaborador boolean not null default true,
  created_at timestamptz default now(), created_by uuid
);
create index if not exists pdi_reg_idx on public.pdi_registros(colaborador_id, data desc);
alter table public.pdi_registros enable row level security;
drop policy if exists pdir_admin on public.pdi_registros;
create policy pdir_admin on public.pdi_registros for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists pdir_proprio on public.pdi_registros;
create policy pdir_proprio on public.pdi_registros for select to authenticated using (visivel_colaborador and colaborador_id = public.meu_colaborador());
revoke all on public.pdi_registros from anon;

-- ---------- fotos (bucket privado; URL assinada na tela) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos','fotos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists fotos_sel on storage.objects;
create policy fotos_sel on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.sou_equipe());
drop policy if exists fotos_wr on storage.objects;
create policy fotos_wr on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.sou_equipe());
drop policy if exists fotos_upd on storage.objects;
create policy fotos_upd on storage.objects for update to authenticated using (bucket_id = 'fotos' and public.sou_equipe());
drop policy if exists fotos_del on storage.objects;
create policy fotos_del on storage.objects for delete to authenticated using (bucket_id = 'fotos' and public.sou_admin());

-- colaborador pode atualizar os próprios campos básicos (a policy colab_self já existe; só garantimos que exista)
drop policy if exists colab_self on public.colaboradores;
create policy colab_self on public.colaboradores for update to authenticated using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

-- ---------- views ----------
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
       co.created_at, co.updated_at
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;
revoke all on public.v_colaboradores from anon;

-- aniversariantes do mês (equipe)
create or replace view public.v_aniversarios with (security_invoker = true) as
select id, nome, apelido, foto_path, data_nascimento, extract(month from data_nascimento)::int as mes, extract(day from data_nascimento)::int as dia
from public.colaboradores where ativo and data_nascimento is not null;
revoke all on public.v_aniversarios from anon;

do $$ begin alter publication supabase_realtime add table public.pdi; exception when others then null; end $$;

select 'ok 0023' as resultado;


-- ===== 0024_pr11b_robo_marketing.sql =====
-- 0024 — PR 11b: usuário-robô do marketing ("máquina de ideias") e pedidos de ideias.
-- O robô é um usuário do Supabase Auth com papel 'robo': NÃO é equipe (não vê clientes, acessos, nada) — só lê e escreve
-- pautas (origem 'ia'), comentários de pautas e atende os pedidos da tabela marketing_pedidos. Idempotente. Depende de 0022.

alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check check (papel in ('admin','colaborador','cliente','pendente','robo'));

create or replace function public.sou_robo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'robo' from public.perfis where id = auth.uid()), false)
$$;

-- pautas: robô lê tudo, cria como 'ideia' (origem ia) e só altera as que criou e ainda estão em 'ideia'
drop policy if exists pautas_robo_sel on public.pautas;
create policy pautas_robo_sel on public.pautas for select to authenticated using (public.sou_robo());
drop policy if exists pautas_robo_ins on public.pautas;
create policy pautas_robo_ins on public.pautas for insert to authenticated with check (public.sou_robo() and origem = 'ia' and status = 'ideia');
drop policy if exists pautas_robo_upd on public.pautas;
create policy pautas_robo_upd on public.pautas for update to authenticated using (public.sou_robo() and origem = 'ia' and status = 'ideia') with check (public.sou_robo() and origem = 'ia' and status = 'ideia');
drop policy if exists pcom_robo on public.pautas_comentarios;
create policy pcom_robo on public.pautas_comentarios for all to authenticated using (public.sou_robo()) with check (public.sou_robo() and tipo = 'comentario');
-- colaboradores: robô precisa ler nomes para preencher responsável (sem contato)
drop policy if exists colab_robo on public.colaboradores;
create policy colab_robo on public.colaboradores for select to authenticated using (public.sou_robo());
-- gatilho pauta_fluxo lê perfis.nome: robô enxerga o próprio perfil (policy perfis_sel já cobre id = auth.uid())

-- Pedidos ao robô ("quero 5 ideias sobre X", "legenda para a pauta Y")
create table if not exists public.marketing_pedidos (
  id bigserial primary key,
  texto text not null,
  pauta_id uuid references public.pautas(id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente','atendido','recusado')),
  resposta text,
  created_at timestamptz default now(), created_by uuid, atendido_em timestamptz
);
alter table public.marketing_pedidos enable row level security;
drop policy if exists mkp_equipe on public.marketing_pedidos;
create policy mkp_equipe on public.marketing_pedidos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists mkp_robo on public.marketing_pedidos;
create policy mkp_robo on public.marketing_pedidos for all to authenticated using (public.sou_robo()) with check (public.sou_robo());
revoke all on public.marketing_pedidos from anon;
create or replace function public.mkp_carimbo() returns trigger language plpgsql as $$ begin if tg_op='INSERT' then new.created_by := auth.uid(); end if; return new; end $$;
drop trigger if exists marketing_pedidos_carimbo on public.marketing_pedidos;
create trigger marketing_pedidos_carimbo before insert on public.marketing_pedidos for each row execute procedure public.mkp_carimbo();

create or replace view public.v_marketing_pedidos with (security_invoker = true) as
select m.*, coalesce(p.nome, p.email) as autor_nome, pa.titulo as pauta_titulo
from public.marketing_pedidos m left join public.perfis p on p.id = m.created_by left join public.pautas pa on pa.id = m.pauta_id;
revoke all on public.v_marketing_pedidos from anon;

-- Colaborador "Robô" (para aparecer como responsável das sugestões) — sem usuário vinculado
insert into public.colaboradores (nome, cargo, nucleo, responsabilidades, ativo)
select 'Robô de marketing', 'Máquina de ideias (IA)', 'marketing', 'Sugere pautas e legendas; as sócias aprovam.', true
where not exists (select 1 from public.colaboradores where nome = 'Robô de marketing');

do $$ begin alter publication supabase_realtime add table public.marketing_pedidos; exception when others then null; end $$;

select 'ok 0024' as resultado;


-- ===== 0025_pr13_metas_comerciais.sql =====
-- 0025 — PR 13: Comercial — metas mensais (meta / super / hiper) e lançamento semanal do realizado.
-- Origem: desenho de metas de outubro/2026 (taxas-base jul–set: lead→agendamento 35%, agendamento→proposta 70%,
-- proposta→contrato 20/25/27%, ticket GP R$ 28/30/32k, CPL R$ 70). Só contratos de Gestão de Passivos contam.
-- Regras: equipe lê tudo; equipe lança semanas; só admin define/edita metas. Idempotente.

-- ---------- metas por mês e nível ----------
create table if not exists public.metas_comerciais (
  id uuid primary key default gen_random_uuid(),
  mes date not null,                                  -- sempre dia 1 do mês
  nivel text not null check (nivel in ('meta','super','hiper')),
  contratos int not null default 0,
  ticket numeric(12,2) not null default 0,            -- ticket médio GP
  propostas int not null default 0,                   -- = agendamentos qualificados (critério atual)
  agendamentos int not null default 0,
  leads int not null default 0,
  investimento numeric(12,2) not null default 0,      -- Meta Ads previsto
  taxa_prop_contrato numeric(5,2),                    -- %, informativo
  cpl numeric(10,2),                                  -- custo por lead planejado
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid,
  unique (mes, nivel),
  check (mes = date_trunc('month', mes)::date)
);
drop trigger if exists metas_comerciais_carimbo on public.metas_comerciais;
create trigger metas_comerciais_carimbo before insert or update on public.metas_comerciais for each row execute procedure public.carimbar2();
drop trigger if exists metas_comerciais_audit on public.metas_comerciais;
create trigger metas_comerciais_audit after insert or update or delete on public.metas_comerciais for each row execute procedure public.auditar();
alter table public.metas_comerciais enable row level security;
drop policy if exists mc_sel on public.metas_comerciais;
create policy mc_sel on public.metas_comerciais for select to authenticated using (public.sou_equipe());
drop policy if exists mc_admin on public.metas_comerciais;
create policy mc_admin on public.metas_comerciais for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.metas_comerciais from anon;

-- ---------- realizado por semana ----------
create table if not exists public.comercial_semanas (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  semana smallint not null check (semana between 1 and 6),
  inicio date not null, fim date not null,
  dias_uteis smallint not null default 5 check (dias_uteis between 0 and 7),
  leads int not null default 0,                       -- formulários Meta
  agendamentos int not null default 0,                -- marcados pela SDR
  propostas int not null default 0,                   -- qualificados = proposta enviada
  contratos int not null default 0,                   -- só Gestão de Passivos
  valor numeric(12,2) not null default 0,             -- valor contratado GP
  investimento numeric(12,2) not null default 0,      -- gasto Meta na semana
  lancado boolean not null default false,             -- semana efetivamente preenchida
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid,
  unique (mes, semana),
  check (fim >= inicio)
);
create index if not exists comercial_semanas_mes_idx on public.comercial_semanas(mes, semana);
drop trigger if exists comercial_semanas_carimbo on public.comercial_semanas;
create trigger comercial_semanas_carimbo before insert or update on public.comercial_semanas for each row execute procedure public.carimbar2();
drop trigger if exists comercial_semanas_audit on public.comercial_semanas;
create trigger comercial_semanas_audit after insert or update or delete on public.comercial_semanas for each row execute procedure public.auditar();
alter table public.comercial_semanas enable row level security;
drop policy if exists cs_equipe on public.comercial_semanas;
create policy cs_equipe on public.comercial_semanas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists cs_del_admin on public.comercial_semanas;
revoke all on public.comercial_semanas from anon;

-- ---------- resumo do mês ----------
drop view if exists public.v_comercial_mes;
create view public.v_comercial_mes with (security_invoker = true) as
select s.mes,
       count(*) filter (where s.lancado) as semanas_lancadas, count(*) as semanas,
       sum(s.dias_uteis) as dias_uteis_total, sum(s.dias_uteis) filter (where s.lancado) as dias_uteis_lancados,
       sum(s.leads) as leads, sum(s.agendamentos) as agendamentos, sum(s.propostas) as propostas,
       sum(s.contratos) as contratos, sum(s.valor) as valor, sum(s.investimento) as investimento
from public.comercial_semanas s group by s.mes;
revoke all on public.v_comercial_mes from anon;

-- ---------- semente: outubro/2026 (semanas em dias corridos; dias_uteis só para o ritmo da SDR) ----------
insert into public.metas_comerciais (mes, nivel, contratos, ticket, propostas, agendamentos, leads, investimento, taxa_prop_contrato, cpl, observacoes) values
 ('2026-10-01','meta', 6, 28000, 30, 43, 123,  8600, 20, 70, 'Ligeiramente acima de julho (melhor mês: R$ 162k).'),
 ('2026-10-01','super',8, 30000, 32, 46, 131,  9200, 25, 70, null),
 ('2026-10-01','hiper',10,32000, 37, 53, 151, 10600, 27, 70, 'Dobro de julho. Encosta no limite de ~3 reuniões/dia da closer.')
on conflict (mes, nivel) do nothing;

insert into public.comercial_semanas (mes, semana, inicio, fim, dias_uteis) values
 ('2026-10-01',1,'2026-10-01','2026-10-04',2),
 ('2026-10-01',2,'2026-10-05','2026-10-11',5),
 ('2026-10-01',3,'2026-10-12','2026-10-18',4),   -- 12/10 feriado
 ('2026-10-01',4,'2026-10-19','2026-10-25',5),
 ('2026-10-01',5,'2026-10-26','2026-10-31',5)
on conflict (mes, semana) do nothing;

do $$ begin alter publication supabase_realtime add table public.comercial_semanas; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.metas_comerciais; exception when others then null; end $$;

select 'ok 0025' as resultado;


-- ===== 0026_pr13b_semanas_corridas.sql =====
-- 0026 — PR 13b: semanas comerciais em dias corridos (leads e investimento chegam no fim de semana).
-- inicio/fim cobrem o mês inteiro, sem buracos; dias_uteis continua valendo só para o ritmo da SDR. Idempotente.
alter table public.comercial_semanas add column if not exists dias smallint generated always as ((fim - inicio) + 1) stored;

update public.comercial_semanas set fim = '2026-10-04' where mes = '2026-10-01' and semana = 1 and fim = '2026-10-02';
update public.comercial_semanas set fim = '2026-10-11' where mes = '2026-10-01' and semana = 2 and fim = '2026-10-09';
update public.comercial_semanas set fim = '2026-10-18' where mes = '2026-10-01' and semana = 3 and fim = '2026-10-16';
update public.comercial_semanas set fim = '2026-10-25' where mes = '2026-10-01' and semana = 4 and fim = '2026-10-23';
update public.comercial_semanas set fim = '2026-10-31' where mes = '2026-10-01' and semana = 5 and fim = '2026-10-30';

drop view if exists public.v_comercial_mes;
create view public.v_comercial_mes with (security_invoker = true) as
select s.mes,
       count(*) filter (where s.lancado) as semanas_lancadas, count(*) as semanas,
       sum(s.dias) as dias_total, sum(s.dias) filter (where s.lancado) as dias_lancados,
       sum(s.dias_uteis) as dias_uteis_total, sum(s.dias_uteis) filter (where s.lancado) as dias_uteis_lancados,
       sum(s.leads) as leads, sum(s.agendamentos) as agendamentos, sum(s.propostas) as propostas,
       sum(s.contratos) as contratos, sum(s.valor) as valor, sum(s.investimento) as investimento
from public.comercial_semanas s group by s.mes;
revoke all on public.v_comercial_mes from anon;
select 'ok 0026' as resultado;


-- ===== 0027_pr14_crm_leads.sql =====
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


-- ===== 0028_pr14b_chatguru_edge.sql =====
-- 0028 — PR 14b: automações do CRM apontando para a Edge Function "chatguru" (em vez do servidor da Vercel).
-- configurar_automacoes(url) agora recebe a URL base da função (…/functions/v1/chatguru) e agenda o pg_cron
-- para chamar …/automacoes a cada minuto, só quando há passo vencido. Idempotente. Depende de 0027.
drop function if exists public.configurar_automacoes(text);
create function public.configurar_automacoes(url_funcao text)
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


-- ===== 0029_pr14c_chatguru_segredos.sql =====
-- 0029 — PR 14c: segredos do ChatGuru no Vault, lidos só pela Edge Function (service_role).
-- Gravar/atualizar um segredo (SQL editor, nunca no repo):
--   select public.chatguru_segredo_definir('CHATGURU_API_KEY', '…');
-- Nomes usados: CHATGURU_API_URL, CHATGURU_API_KEY, CHATGURU_ACCOUNT_ID, CHATGURU_PHONE_ID, CHATGURU_WEBHOOK_TOKEN, PAINEL_URL.
-- Idempotente. Depende de 0020 (Vault já em uso) e 0027.

create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração ChatGuru (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração ChatGuru (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;

create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;

select 'ok 0029' as resultado;


-- ===== 0030_pr15_fluxo_lead.sql =====
-- 0030 — PR 15: fluxo do lead conforme "Modos Operantes" (prazo e dono por fase, tarefas do lead, motivos de perda
-- padronizados) e campos para os relatórios de "Como montar seu DASH". Idempotente. Depende de 0027.

-- ---------- prazo e dono por fase ----------
alter table public.fases
  add column if not exists prazo_horas integer,                 -- prazo máximo na fase (null = sem prazo)
  add column if not exists dono text check (dono in ('sdr','closer','ambos')),
  add column if not exists sigla text;                          -- rótulo curto do material (Lead, MQL, SQL, OPP…)
update public.fases set prazo_horas = v.p, dono = v.d, sigla = v.s from (values
  (1, 12,  'sdr',    'Lead'),
  (2, 120, 'sdr',    'Lead'),
  (3, 72,  'sdr',    'MQL'),
  (4, 72,  'ambos',  'SQL'),
  (5, 24,  'sdr',    'No-show'),
  (6, 24,  'closer', 'SE'),
  (7, 24,  'closer', 'OPP'),
  (8, 168, 'closer', 'Follow-up'),
  (9, 168, 'closer', 'Follow-up'),
  (10, null, null,   'Ganho')) as v(id, p, d, s) where fases.id = v.id;
drop policy if exists "fases: admin edita" on public.fases;
create policy "fases: admin edita" on public.fases for update to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- ---------- tarefas do lead ----------
create table if not exists public.lead_tarefas (
  id bigserial primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  tipo text not null default 'ligar' check (tipo in ('ligar','whatsapp','social_selling','se_agendada','se_realizada','se_noshow','segunda_call','follow_up','prazo','tarefa','email','pagar')),
  titulo text,
  quando timestamptz not null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  concluida_em timestamptz,
  concluida_por uuid references public.perfis (id) on delete set null,
  created_at timestamptz not null default now(),
  criado_por uuid references public.perfis (id) on delete set null default auth.uid()
);
create index if not exists lead_tarefas_lead_idx on public.lead_tarefas (lead_id, concluida_em);
create index if not exists lead_tarefas_quando_idx on public.lead_tarefas (quando) where concluida_em is null;
alter table public.lead_tarefas enable row level security;
drop policy if exists "lead_tarefas: equipe" on public.lead_tarefas;
create policy "lead_tarefas: equipe" on public.lead_tarefas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.lead_tarefas from anon;

-- Ao concluir uma tarefa de SE agendada / realizada / no-show, nada automático na fase: quem decide é o kanban (regra do material).

-- ---------- motivos de perda padronizados ----------
create table if not exists public.motivos_perda (
  codigo text primary key,
  rotulo text not null,
  papel text not null check (papel in ('sdr','closer','cs')),
  descricao text,
  ordem integer not null default 100,
  ativo boolean not null default true
);
alter table public.motivos_perda enable row level security;
drop policy if exists "motivos: ver" on public.motivos_perda;
create policy "motivos: ver" on public.motivos_perda for select to authenticated using (public.sou_equipe());
drop policy if exists "motivos: admin" on public.motivos_perda;
create policy "motivos: admin" on public.motivos_perda for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.motivos_perda from anon;
insert into public.motivos_perda (codigo, rotulo, papel, descricao, ordem) values
  ('closer_no_show',        '[closer] No show',                         'closer', 'O lead não compareceu à call.', 10),
  ('closer_sem_pitch',      '[closer] Não teve pitch',                  'closer', 'Fez a reunião, mas não recebeu pitch por algum motivo específico.', 11),
  ('closer_nao_prioridade', '[closer] Não é prioridade',                'closer', 'O lead diz que a solução não é prioridade para ele.', 12),
  ('closer_contatos_esgot', '[closer] Tentativas de contato esgotadas', 'closer', 'Disse que ia fechar e parou de responder, sumiu.', 13),
  ('closer_sem_budget',     '[closer] Não tem budget',                  'closer', 'Não tem recursos para contratar.', 14),
  ('closer_nao_decisor',    '[closer] Não é decisor',                   'closer', 'Falamos com gerente, vendedor ou funcionário.', 15),
  ('closer_outro_escrit',   '[closer] Contratou outro escritório',      'closer', 'Decidiu fechar com outro escritório.', 16),
  ('closer_concorrente',    '[closer] Possível concorrente espionando', 'closer', 'A call pareceu de concorrente.', 17),
  ('closer_sem_valor',      '[closer] Não encontrou valor',             'closer', 'Não acreditou na solução / sem interesse.', 18),
  ('sdr_nao_decisor',       '[sdr] Não é o decisor (gerente/vendedor)', 'sdr',    'Falamos com gerente, vendedor ou funcionário.', 20),
  ('sdr_fake',              '[sdr] Fake',                               'sdr',    'O lead não existe.', 21),
  ('sdr_numero_incorreto',  '[sdr] Número incorreto',                   'sdr',    'Número de contato errado.', 22),
  ('sdr_nunca_respondeu',   '[sdr] Não respondeu abordagem (nunca retornou)', 'sdr', 'Nunca atendeu nem respondeu WhatsApp.', 23),
  ('sdr_nao_agendou',       '[sdr] Não conseguimos agendar SE',         'sdr',    'Qualificado, mas não conseguimos agendar.', 24),
  ('sdr_sem_interesse',     '[sdr] Não tem interesse em agendar',       'sdr',    'Avisou que não tem interesse na conversa/SE.', 25),
  ('sdr_duplicado',         '[sdr] Duplicado',                          'sdr',    'Mesmo negócio duplicado.', 26),
  ('sdr_resolveu_banco',    '[sdr] Resolveu direto com o banco',        'sdr',    'Renegociou diretamente com o banco.', 27),
  ('cs_reembolso',          '[cs] Reembolso / cancelamento 7 dias',     'cs',     'Cancelou no prazo de arrependimento.', 30)
on conflict (codigo) do update set rotulo = excluded.rotulo, papel = excluded.papel, descricao = excluded.descricao, ordem = excluded.ordem;

-- ---------- views ----------
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
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null and t.quando < now()) as tarefas_vencidas
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id;
revoke all on public.v_leads from anon;

drop view if exists public.v_lead_tarefas;
create view public.v_lead_tarefas with (security_invoker = true) as
select t.*, l.nome as lead_nome, l.empresa as lead_empresa, l.whatsapp as lead_whatsapp, l.fase_id, l.status as lead_status,
       coalesce(p.nome, p.email) as responsavel_nome
from public.lead_tarefas t join public.leads l on l.id = t.lead_id left join public.perfis p on p.id = t.responsavel_id;
revoke all on public.v_lead_tarefas from anon;

do $$ begin alter publication supabase_realtime add table public.lead_tarefas; exception when others then null; end $$;
select 'ok 0030' as resultado;


select 'ok parte 2/9' as resultado;
