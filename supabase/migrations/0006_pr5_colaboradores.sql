-- 0006 — PR 5: colaboradores (RH básico) — cadastro completo e vínculo com o usuário do Supabase Auth
-- Idempotente. A tabela colaboradores nasceu em 0002; aqui entram campos de contato e a view de cadastro.

alter table public.colaboradores
  add column if not exists email text,
  add column if not exists telefone text,
  add column if not exists oab text,
  add column if not exists data_desligamento date;

-- Colaborador pode ver e editar os próprios dados de contato (nome/e-mail/telefone); o resto é admin
drop policy if exists colab_self on public.colaboradores;
create policy colab_self on public.colaboradores for update to authenticated
  using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

-- Cadastro + situação do login + indicadores recentes (para a tela Equipe)
create or replace view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       co.created_at, co.updated_at
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

-- Perfis da equipe ainda sem registro de colaborador (para vincular na tela Equipe)
create or replace view public.v_perfis_sem_colaborador with (security_invoker = true) as
select p.id, p.email, p.nome, p.papel
from public.perfis p
where p.papel in ('admin','colaborador') and not exists (select 1 from public.colaboradores c where c.perfil_id = p.id);

select 'ok 0006' as resultado;
