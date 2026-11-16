-- Emulação mínima do ambiente Supabase para teste de reconstrução LOCAL (descartável). Não é o Supabase.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role supabase_admin nologin; create role authenticator noinherit login; create role dashboard_user nologin;
create role supabase_auth_admin nologin; create role supabase_storage_admin nologin;
create schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to public; alter database postgres set search_path = "$user", public, extensions;
-- auth
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz, phone text, raw_app_meta_data jsonb default '{}', aud text, role text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
-- storage
create schema storage;
create table storage.buckets (id text primary key, name text, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
-- cron (stub)
create schema cron;
create table cron.job (jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432, database text default 'postgres', username text default 'postgres', active boolean default true, jobname text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$ declare j bigint; begin insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid into j; return j; end $$;
create function cron.schedule(schedule text, command text) returns bigint language plpgsql as $$ declare j bigint; begin insert into cron.job(schedule, command) values (schedule, command) returning jobid into j; return j; end $$;
create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$ begin delete from cron.job where jobid = job_id; return found; end $$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$ begin delete from cron.job where jobname = job_name; return found; end $$;
-- net (stub)
create schema net;
create table net._http_response (id bigint primary key, status_code int, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz default now());
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 2000) returns bigint language sql as $$ select 1::bigint $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 2000) returns bigint language sql as $$ select 1::bigint $$;
-- vault (stub)
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, description text, secret text, created_at timestamptz default now(), updated_at timestamptz default now());
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language plpgsql as $$ declare i uuid; begin insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id into i; return i; end $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language plpgsql as $$ begin update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id; end $$;
-- realtime
create publication supabase_realtime;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
