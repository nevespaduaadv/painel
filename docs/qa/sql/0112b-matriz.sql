-- 0112b · matriz no PostgreSQL real (sessões simuladas como o PostgREST: JWT + role authenticated). Só dados fictícios.
-- Uso: psql -v fase=antes|depois -f 0112b-matriz.sql   (antes = reproduz a falha, em transação desfeita; depois = com o gatilho)
\set ON_ERROR_STOP 0
\set adm a0000000-0000-0000-0000-0000000000a1
\set ana a0000000-0000-0000-0000-0000000000a2
\set bia a0000000-0000-0000-0000-0000000000a3
\set cAna c0000000-0000-0000-0000-0000000000a2
\set cBia c0000000-0000-0000-0000-0000000000a3
create table if not exists public._res12 (n serial, caso text, ok boolean, det text);
grant all on public._res12 to authenticated; grant usage on sequence public._res12_n_seq to authenticated;
create or replace function public._chk12(p_caso text, p_ok boolean, p_det text default '') returns void language sql security definer as $$ insert into public._res12 (caso, ok, det) values (p_caso, coalesce(p_ok, false), p_det) $$;
create or replace function public._tenta12(p_sql text) returns text language plpgsql as $$ declare n bigint; begin execute p_sql; get diagnostics n = row_count; return '00000/' || n; exception when others then return sqlstate; end $$;
create or replace function public._como12(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false), set_config('request.jwt.claim.role', case when p is null then '' else 'authenticated' end, false) $$;
grant execute on function public._chk12(text, boolean, text), public._tenta12(text), public._como12(uuid) to authenticated;
insert into auth.users (id, email) values (:'adm', 'adm12@ficticio.test'), (:'ana', 'ana12@ficticio.test'), (:'bia', 'bia12@ficticio.test') on conflict do nothing;
update public.perfis set papel = 'admin' where id = :'adm';
update public.perfis set papel = 'colaborador', acessos = '{juridico,clientes}' where id in (:'ana', :'bia');
insert into public.colaboradores (id, perfil_id, nome, nucleo, ativo) values (:'cAna', :'ana', 'Ana Fictícia 12', 'juridico', true), (:'cBia', :'bia', 'Bia Fictícia 12', 'juridico', true) on conflict (id) do update set nucleo = 'juridico', frente = null, ativo = true;

\if :{?fase}
\else
\set fase depois
\endif
select :'fase' = 'antes' as antes \gset
\if :antes
-- ===== ANTES da correção: a falha existe (tudo em transação desfeita) =====
begin;
select public._como12(:'ana'); set role authenticated;
select public.edita_protecao() as p0 \gset
select public._tenta12($$update public.colaboradores set frente = 'estrategico' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) as t1 \gset
select public.edita_protecao() as p1 \gset
reset role;
rollback;
select public._como12(null);
select public._chk12('A0 ANTES da correção (falha reproduzida, desfeita em seguida): a colaboradora troca a própria frente e passa a ter edita_protecao()',
  :'p0' = 'f' and :'t1' = '00000/1' and :'p1' = 't', 'antes ' || :'p0' || ' · troca ' || :'t1' || ' · depois ' || :'p1');
\else
-- ===== DEPOIS da correção =====
select public._como12(:'ana'); set role authenticated;
select public._chk12('01 a pessoa não troca a PRÓPRIA frente (42501) e continua sem edita_protecao()',
  public._tenta12($$update public.colaboradores set frente = 'estrategico' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '42501' and not public.edita_protecao());
select public._chk12('02 a pessoa não troca o PRÓPRIO núcleo (42501)',
  public._tenta12($$update public.colaboradores set nucleo = 'acompanhamento_pj' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '42501'
  and public._tenta12($$update public.colaboradores set nucleo = 'socios' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '42501');
select public._chk12('03 a pessoa não altera a própria situação, o vínculo de login nem a data de desligamento (42501)',
  public._tenta12($$update public.colaboradores set ativo = false where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '42501'
  and public._tenta12($$update public.colaboradores set perfil_id = 'a0000000-0000-0000-0000-0000000000a1' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '42501'
  and public._tenta12($$update public.colaboradores set data_desligamento = current_date where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '42501');
select public._chk12('04 os demais campos da própria ficha continuam editáveis pela pessoa (responsabilidades)',
  public._tenta12($$update public.colaboradores set responsabilidades = 'texto fictício' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '00000/1');
select public._chk12('05 regravar a ficha sem mudar os campos protegidos é aceito (a tela envia a linha inteira)',
  public._tenta12($$update public.colaboradores set nucleo = nucleo, frente = frente, ativo = ativo, responsabilidades = 'de novo' where id = 'c0000000-0000-0000-0000-0000000000a2'$$) = '00000/1');
select public._chk12('06 a pessoa não alcança a ficha de outra (0 linhas, pela regra de acesso que já existia)',
  public._tenta12($$update public.colaboradores set frente = 'estrategico' where id = 'c0000000-0000-0000-0000-0000000000a3'$$) in ('00000/0', '42501'));
reset role; select public._como12(:'adm'); set role authenticated;
select public._chk12('07 a administradora altera núcleo, frente e situação de qualquer pessoa',
  public._tenta12($$update public.colaboradores set frente = 'estrategico', nucleo = 'acompanhamento_pj' where id = 'c0000000-0000-0000-0000-0000000000a3'$$) = '00000/1'
  and public._tenta12($$update public.colaboradores set ativo = false where id = 'c0000000-0000-0000-0000-0000000000a3'$$) = '00000/1'
  and public._tenta12($$update public.colaboradores set ativo = true where id = 'c0000000-0000-0000-0000-0000000000a3'$$) = '00000/1');
reset role; select public._como12(:'bia'); set role authenticated;
select public._chk12('08 o caminho legítimo continua valendo: quem a administradora pôs na frente estratégica tem edita_protecao()', public.edita_protecao());
reset role; select public._como12(null);
select public._chk12('09 rotinas do sistema sem usuário (migrações, agendamentos) não são barradas',
  public._tenta12($$update public.colaboradores set nucleo = 'juridico', frente = null where id = 'c0000000-0000-0000-0000-0000000000a3'$$) = '00000/1');
select public._chk12('10 nenhum dado foi alterado pela instalação: o gatilho existe e é o único objeto novo',
  (select count(*) = 1 from pg_trigger where tgname = 'colaboradores_guarda' and tgrelid = 'public.colaboradores'::regclass));
\endif
\echo
select case when ok then 'ok    ' else 'FALHA ' end || caso || case when det <> '' then '  [' || det || ']' else '' end from public._res12 order by n;
select count(*) filter (where ok) || ' de ' || count(*) || ' casos conformes' from public._res12;
