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
