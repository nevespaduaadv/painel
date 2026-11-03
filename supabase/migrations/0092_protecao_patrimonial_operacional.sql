-- 0092 — Proteção patrimonial e operacional do cliente PJ (pedido de 02/11).
--  • cada bem declarado ganha status de proteção (exposto / em proteção / protegido / não protegível), instrumento, data, responsável
--  • medidas operacionais (escrow, gestora, CNPJ espelho, recebíveis…) com status por cliente; lista cadastrável pela gestão
--  • encerramento do ciclo de 45 dias (R1/R2/R3) com a atualização final dos encaminhamentos
--  • tudo vira registro no dossiê (frente Estratégico) — sem notificação; só fica visível para Acordos e Jurídico
--  • edita quem é da frente Estratégico / Acompanhamento PJ (ou admin); os demais só leem
-- Idempotente.

-- ---------- bens: status de proteção ----------
alter table public.bens add column if not exists protecao text not null default 'exposto' check (protecao in ('exposto','em_protecao','protegido','nao_protegivel'));
alter table public.bens add column if not exists protecao_instrumento text check (protecao_instrumento in ('gestora','integralizacao','doacao_reserva','alienacao','seguro','usufruto','bem_familia','outro'));
alter table public.bens add column if not exists protecao_em date;
alter table public.bens add column if not exists protecao_responsavel_id uuid references public.colaboradores(id) on delete set null;
alter table public.bens add column if not exists protecao_nota text;

create or replace function public.protecao_instrumento_nome(t text) returns text language sql immutable as $$
  select case t when 'gestora' then 'Empresa gestora / holding' when 'integralizacao' then 'Integralização de capital' when 'doacao_reserva' then 'Doação com reserva de usufruto'
                when 'alienacao' then 'Alienação' when 'seguro' then 'Seguro' when 'usufruto' then 'Usufruto' when 'bem_familia' then 'Bem de família' when 'outro' then 'Outro' else coalesce(t,'') end
$$;
create or replace function public.protecao_status_nome(t text) returns text language sql immutable as $$
  select case t when 'exposto' then 'Exposto' when 'em_protecao' then 'Em proteção' when 'protegido' then 'Protegido' when 'nao_protegivel' then 'Não protegível'
                when 'nao_se_aplica' then 'Não se aplica' when 'a_fazer' then 'A fazer' when 'em_andamento' then 'Em andamento' when 'implementada' then 'Implementada' else coalesce(t,'') end
$$;

-- quem edita: frente estratégico/acompanhamento PJ ou admin
create or replace function public.edita_protecao() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and p.papel = 'admin')
      or exists (select 1 from public.colaboradores c where c.perfil_id = auth.uid() and (c.frente = 'estrategico' or c.nucleo in ('acompanhamento_pj','pos_vendas','socios')))
$$;

-- ---------- medidas operacionais (catálogo, cadastrável pela gestão) ----------
create table if not exists public.medidas_operacionais (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  descricao text,
  ordem integer not null default 0,
  ativo boolean not null default true
);
alter table public.medidas_operacionais enable row level security;
drop policy if exists mo_sel on public.medidas_operacionais; create policy mo_sel on public.medidas_operacionais for select to authenticated using (public.sou_equipe());
drop policy if exists mo_adm on public.medidas_operacionais; create policy mo_adm on public.medidas_operacionais for all to authenticated using (public.aprova_requisicoes()) with check (public.aprova_requisicoes());
grant select, insert, update, delete on public.medidas_operacionais to authenticated;
insert into public.medidas_operacionais (codigo, nome, descricao, ordem) values
  ('escrow', 'Conta escrow', 'Recebimentos da operação passam por conta vinculada, fora do alcance de bloqueios na conta da devedora.', 10),
  ('gestora', 'Empresa gestora / administradora', 'Constituição da gestora (holding operacional) que passa a centralizar bens, contratos e caixa.', 20),
  ('cnpj_espelho', 'CNPJ espelho', 'Nova pessoa jurídica para a operação seguir (mesma atividade, sem o passivo), com contratos migrados.', 30),
  ('recebiveis', 'Maquininha / recebíveis (domicílio bancário)', 'Adquirência e domicílio bancário dos recebíveis fora dos bancos credores.', 40),
  ('contas', 'Migração de contas bancárias', 'Movimentação sai dos bancos credores (compensação/retenção) para instituição sem relacionamento de crédito.', 50),
  ('pro_labore', 'Pró-labore e folha', 'Pagamentos de sócios e funcionários reorganizados (fonte pagadora, contas de destino).', 60),
  ('contratos', 'Contratos de locação e fornecedores', 'Contratos relevantes renovados/migrados para a estrutura protegida.', 70),
  ('veiculos_frota', 'Frota / veículos em nome de terceiros ou gestora', 'Veículos operacionais retirados do nome da devedora.', 80),
  ('estoque', 'Estoque e equipamentos', 'Ativos operacionais documentados e, quando cabível, transferidos à gestora.', 90)
on conflict (codigo) do nothing;

-- status por cliente
create table if not exists public.cliente_medidas (
  cliente_id text not null references public.clientes(id) on delete cascade,
  medida_id uuid not null references public.medidas_operacionais(id) on delete cascade,
  status text not null default 'a_fazer' check (status in ('nao_se_aplica','a_fazer','em_andamento','implementada')),
  data date,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  nota text,
  updated_at timestamptz not null default now(), updated_by uuid,
  primary key (cliente_id, medida_id)
);
alter table public.cliente_medidas enable row level security;
drop policy if exists cm_sel on public.cliente_medidas; create policy cm_sel on public.cliente_medidas for select to authenticated using (public.sou_equipe());
drop policy if exists cm_wr on public.cliente_medidas; create policy cm_wr on public.cliente_medidas for all to authenticated using (public.edita_protecao()) with check (public.edita_protecao());
grant select, insert, update, delete on public.cliente_medidas to authenticated;

-- bens: a alteração dos campos de proteção também é restrita à frente estratégico (os demais campos seguem a regra atual da equipe)
create or replace function public.bens_protecao_guard_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.protecao is distinct from old.protecao or new.protecao_instrumento is distinct from old.protecao_instrumento or new.protecao_em is distinct from old.protecao_em or new.protecao_nota is distinct from old.protecao_nota)
     and auth.uid() is not null and not public.edita_protecao() then
    raise exception 'Só a frente Estratégico / Acompanhamento PJ altera a proteção dos bens';
  end if;
  return new;
end $$;
drop trigger if exists bens_protecao_guard on public.bens;
create trigger bens_protecao_guard before update on public.bens for each row execute function public.bens_protecao_guard_tg();

-- ---------- registro no dossiê a cada mudança (sem notificação) ----------
create or replace function public.protecao_registrar(p_cliente text, p_texto text, p_resp uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, responsavel_id, visivel_cliente, automatica, fonte, frente)
  values (p_cliente, current_date, 'registro', p_texto, p_resp, false, true, 'protecao', 'estrategico')
$$;
create or replace function public.bens_protecao_dossie_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.protecao is distinct from old.protecao then
    perform public.protecao_registrar(new.cliente_id, 'Proteção patrimonial — ' || new.descricao || ': ' || public.protecao_status_nome(new.protecao)
      || coalesce(' via ' || public.protecao_instrumento_nome(new.protecao_instrumento), '') || coalesce(' em ' || to_char(new.protecao_em, 'DD/MM/YYYY'), '') || coalesce(E'\n' || new.protecao_nota, ''), new.protecao_responsavel_id);
  end if;
  return new;
end $$;
drop trigger if exists bens_protecao_dossie on public.bens;
create trigger bens_protecao_dossie after update on public.bens for each row execute function public.bens_protecao_dossie_tg();

create or replace function public.cliente_medidas_dossie_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    select nome into nm from public.medidas_operacionais where id = new.medida_id;
    if new.status in ('em_andamento','implementada') then
      perform public.protecao_registrar(new.cliente_id, 'Proteção operacional — ' || coalesce(nm,'') || ': ' || public.protecao_status_nome(new.status)
        || coalesce(' em ' || to_char(new.data, 'DD/MM/YYYY'), '') || coalesce(E'\n' || new.nota, ''), new.responsavel_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists cliente_medidas_dossie on public.cliente_medidas;
create trigger cliente_medidas_dossie before insert or update on public.cliente_medidas for each row execute function public.cliente_medidas_dossie_tg();

-- ---------- ciclo de 45 dias ----------
-- clientes.dados ganha: ciclo_concluido_em, ciclo_resumo (texto final dos encaminhamentos), ciclo_por
create or replace function public.ciclo_concluir(p_cliente text, p_resumo text) returns void
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; pend integer; cid uuid;
begin
  if not public.edita_protecao() then raise exception 'Só a frente Estratégico / Acompanhamento PJ conclui o ciclo'; end if;
  if nullif(btrim(coalesce(p_resumo,'')),'') is null then raise exception 'Escreva a atualização final dos encaminhamentos'; end if;
  select count(*) into pend from public.cliente_medidas where cliente_id = p_cliente and status = 'a_fazer';
  if pend > 0 then raise exception 'Ainda há % medida(s) operacional(is) "a fazer" — defina o status (em andamento, implementada ou não se aplica) antes de concluir', pend; end if;
  meu := public.nome_perfil(eu); select id into cid from public.colaboradores where perfil_id = eu;
  update public.clientes set dados = dados || jsonb_build_object('ciclo_concluido_em', to_char(current_date,'YYYY-MM-DD'), 'ciclo_resumo', btrim(p_resumo), 'ciclo_por', coalesce(meu,'')) where id = p_cliente;
  perform public.protecao_registrar(p_cliente, 'Ciclo de onboarding (45 dias) concluído' || coalesce(' por ' || meu, '') || E'.\nAtualização dos encaminhamentos:\n' || btrim(p_resumo), cid);
  update public.providencias set status = 'concluida', observacao = coalesce(observacao,'') || case when coalesce(observacao,'') = '' then '' else E'\n' end || 'Ciclo de onboarding concluído em ' || to_char(current_date,'DD/MM/YYYY') || '.'
   where cliente_id = p_cliente and categoria = 'patrimonial' and status <> 'concluida' and titulo ilike 'Proteção patrimonial%';
end $$;
grant execute on function public.ciclo_concluir(text, text) to authenticated;

-- reabrir (admin) — para ajustes
create or replace function public.ciclo_reabrir(p_cliente text) returns void
language sql security definer set search_path = public as $$
  update public.clientes set dados = dados - 'ciclo_concluido_em' - 'ciclo_resumo' - 'ciclo_por' where id = p_cliente and public.sou_admin();
$$;
grant execute on function public.ciclo_reabrir(text) to authenticated;

-- ---------- resumo por cliente (cabeçalho, Visão geral, abas Negocial/Jurídico) ----------
create or replace view public.v_protecao_cliente with (security_invoker = true) as
select c.id as cliente_id,
       (select count(*) from public.bens b where b.cliente_id = c.id) as bens,
       (select count(*) from public.bens b where b.cliente_id = c.id and b.protecao = 'protegido') as bens_protegidos,
       (select count(*) from public.bens b where b.cliente_id = c.id and b.protecao = 'em_protecao') as bens_em_protecao,
       (select count(*) from public.bens b where b.cliente_id = c.id and b.protecao = 'exposto') as bens_expostos,
       (select count(*) from public.cliente_medidas m where m.cliente_id = c.id and m.status = 'implementada') as medidas_implementadas,
       (select count(*) from public.cliente_medidas m where m.cliente_id = c.id and m.status = 'em_andamento') as medidas_em_andamento,
       (select count(*) from public.cliente_medidas m where m.cliente_id = c.id and m.status = 'a_fazer') as medidas_a_fazer,
       (select string_agg(mo.nome || ': ' || public.protecao_status_nome(m.status), ' · ' order by mo.ordem) from public.cliente_medidas m join public.medidas_operacionais mo on mo.id = m.medida_id where m.cliente_id = c.id and m.status in ('em_andamento','implementada')) as medidas_resumo,
       c.dados->>'ciclo_concluido_em' as ciclo_concluido_em, c.dados->>'ciclo_por' as ciclo_por, c.dados->>'data_onboarding' as data_onboarding,
       case when c.dados->>'data_onboarding' ~ '^\d{4}-\d{2}-\d{2}$' then current_date - (c.dados->>'data_onboarding')::date end as dias_de_ciclo
from public.clientes c;
grant select on public.v_protecao_cliente to authenticated;

select 'ok 0092' as resultado, (select count(*) from public.medidas_operacionais) as medidas;
