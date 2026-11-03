-- 0093 — Acesso "protecao" nos perfis: além da frente Estratégico/Acompanhamento PJ e admins, quem tiver 'protecao' em perfis.acessos
-- edita a proteção patrimonial/operacional (usado para o perfil de teste e para exceções). Idempotente.
create or replace function public.edita_protecao() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and (p.papel = 'admin' or 'protecao' = any(p.acessos)))
      or exists (select 1 from public.colaboradores c where c.perfil_id = auth.uid() and (c.frente = 'estrategico' or c.nucleo in ('acompanhamento_pj','pos_vendas','socios')))
$$;
select 'ok 0093' as resultado;
