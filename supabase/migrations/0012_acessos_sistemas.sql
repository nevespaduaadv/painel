-- 0012 — Acessos a sistemas do cliente (gov.br, bancos, certificados) informados pelo próprio cliente para o trabalho do escritório.
-- Tabela separada da ficha de propósito: nunca entra em views, no painel_por_token, na área do cliente nem no BI.
-- Só equipe lê/escreve; toda alteração fica na auditoria. Próximo passo (depois): criptografar `senha` com Vault/pgsodium.

create table if not exists public.acessos_sistemas (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  sistema text not null default 'gov.br',       -- gov.br, e-CAC, internet banking X, certificado digital…
  titular text,                                 -- de quem é o acesso (empresa, sócio…)
  login text,
  senha text,
  observacoes text,                             -- 2FA? telefone que recebe o código? validade do certificado?
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists acessos_sistemas_cliente_idx on public.acessos_sistemas(cliente_id);

drop trigger if exists acessos_sistemas_carimbo on public.acessos_sistemas;
create trigger acessos_sistemas_carimbo before insert or update on public.acessos_sistemas for each row execute procedure public.carimbar2();
drop trigger if exists acessos_sistemas_audit on public.acessos_sistemas;
create trigger acessos_sistemas_audit after insert or update or delete on public.acessos_sistemas for each row execute procedure public.auditar();

alter table public.acessos_sistemas enable row level security;
drop policy if exists acessos_all on public.acessos_sistemas;
create policy acessos_all on public.acessos_sistemas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.acessos_sistemas from anon;

-- Se existir o usuário de leitura do BI, ele não enxerga esta tabela
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'bi') then execute 'revoke all on public.acessos_sistemas from bi'; end if;
end $$;

select 'ok 0012' as resultado;
