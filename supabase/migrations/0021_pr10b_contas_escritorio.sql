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
