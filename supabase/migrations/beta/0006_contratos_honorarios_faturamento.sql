-- ESPELHO (beta) — Bloco 3 da controladoria: contrato de honorários como entidade + solicitação de faturamento (SF) + comissões.
-- Modelo (inspirado no Legale, adaptado):
--   contratos_honorarios: o contrato de prestação de serviços do escritório com o cliente (não confundir com `contratos` = contratos
--     bancários do cliente). Código CH-AAAA-NNNN, tipo, status, vigência, valores (entrada/parcelas/mensalidade/êxito), horas contratadas,
--     tabela de hora, pasta, responsável, aditivos. Um contrato ativo alimenta clientes.horas_contratadas_mes / honorario_mensal / tabela_hora_id.
--   solicitacoes_faturamento (SF): quem presta o serviço pede o faturamento → financeiro autoriza (ou não) → fatura (gera cobranças no
--     painel; a emissão no Asaas continua pela tela Financeiro / Edge em produção). Código SF-AAAA-NNNN, parcelas geradas na autorização.
--   comissoes: previstas na SF (closer 8% sobre a entrada, rateios manuais), liberadas quando a cobrança correspondente é paga.
-- Idempotente. Depende de beta 0002–0005.

-- ---------- contrato de honorários ----------
create table if not exists public.contratos_honorarios (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  ano integer, seq integer, codigo text unique,
  cliente_id text not null references public.clientes (id) on delete cascade,
  pasta_numero integer references public.pastas (numero) on delete set null,
  fechamento_id uuid references public.fechamentos (id) on delete set null,
  tipo text not null default 'gestao_passivos' check (tipo in ('gestao_passivos', 'ad_exitum', 'partido', 'avulso', 'consulta', 'prestacao_servico', 'superendividamento', 'outro')),
  subtipo text check (subtipo in ('contencioso', 'consultivo', 'misto')),
  area text,
  status text not null default 'ativo' check (status in ('minuta', 'enviado', 'assinado', 'ativo', 'encerrado', 'cancelado')),
  responsavel_id uuid references public.colaboradores (id) on delete set null,
  closer_id uuid references public.colaboradores (id) on delete set null,
  descricao_servico text,
  valor_total numeric(14,2),
  entrada numeric(14,2),
  parcelas integer, valor_parcela numeric(14,2), vencimento_dia integer,
  mensalidade numeric(14,2),
  exito_pct numeric(5,2),
  forma_pagamento text,
  indice_reajuste text,
  horas_contratadas_mes numeric(7,2),
  tabela_hora_id uuid references public.ts_tabelas_hora (id) on delete set null,
  vigencia_inicio date, vigencia_fim date, indeterminado boolean not null default true, periodicidade text,
  assinado_em date, contrato_url text,
  observacoes text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists ch_cliente_idx on public.contratos_honorarios (cliente_id);
create index if not exists ch_status_idx on public.contratos_honorarios (status);
alter table public.contratos_honorarios enable row level security;
drop policy if exists ch_sel on public.contratos_honorarios; create policy ch_sel on public.contratos_honorarios for select to authenticated using (public.sou_equipe());
drop policy if exists ch_mod on public.contratos_honorarios; create policy ch_mod on public.contratos_honorarios for all to authenticated using (public.sou_equipe() and (public.sou_admin() or public.tem_acesso('financeiro') or public.tem_acesso('comercial'))) with check (public.sou_equipe() and (public.sou_admin() or public.tem_acesso('financeiro') or public.tem_acesso('comercial')));
grant select, insert, update, delete on public.contratos_honorarios to authenticated;

create or replace function public.ch_codigo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.ano := extract(year from coalesce(new.vigencia_inicio, new.assinado_em, current_date))::integer;
    select coalesce(max(seq), 0) + 1 into new.seq from public.contratos_honorarios where ano = new.ano;
    new.codigo := 'CH-' || new.ano || '-' || lpad(new.seq::text, 4, '0');
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists ch_codigo on public.contratos_honorarios;
create trigger ch_codigo before insert or update on public.contratos_honorarios for each row execute function public.ch_codigo();

-- contrato ativo → espelha no cliente (horas contratadas, honorário mensal, tabela de hora) para o timesheet
create or replace function public.ch_espelhar_cliente_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare c public.contratos_honorarios;
begin
  select * into c from public.contratos_honorarios where cliente_id = coalesce(new.cliente_id, old.cliente_id) and status in ('ativo', 'assinado') order by vigencia_inicio desc nulls last, created_at desc limit 1;
  update public.clientes set horas_contratadas_mes = c.horas_contratadas_mes, honorario_mensal = coalesce(c.mensalidade, case when c.parcelas > 0 then c.valor_parcela end), tabela_hora_id = c.tabela_hora_id
   where id = coalesce(new.cliente_id, old.cliente_id);
  return coalesce(new, old);
end $$;
drop trigger if exists ch_espelhar_cliente on public.contratos_honorarios;
create trigger ch_espelhar_cliente after insert or update or delete on public.contratos_honorarios for each row execute function public.ch_espelhar_cliente_tg();

-- aditivos
create table if not exists public.contratos_honorarios_aditivos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos_honorarios (id) on delete cascade,
  data date not null default current_date,
  descricao text not null,
  valor_delta numeric(14,2),
  nova_vigencia_fim date,
  url text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
alter table public.contratos_honorarios_aditivos enable row level security;
drop policy if exists cha_sel on public.contratos_honorarios_aditivos; create policy cha_sel on public.contratos_honorarios_aditivos for select to authenticated using (public.sou_equipe());
drop policy if exists cha_mod on public.contratos_honorarios_aditivos; create policy cha_mod on public.contratos_honorarios_aditivos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update, delete on public.contratos_honorarios_aditivos to authenticated;

-- backfill: um contrato por fechamento (dados.honorarios), se ainda não houver contrato para o cliente
insert into public.contratos_honorarios (cliente_id, fechamento_id, tipo, status, closer_id, entrada, parcelas, valor_parcela, vencimento_dia, mensalidade, exito_pct, forma_pagamento, observacoes, vigencia_inicio, assinado_em, contrato_url, valor_total, created_at)
select f.cliente_id, f.id, 'gestao_passivos', 'ativo', f.closer_id,
       nullif(f.dados->'honorarios'->>'entrada', '')::numeric, nullif(f.dados->'honorarios'->>'parcelas', '')::integer, nullif(f.dados->'honorarios'->>'valor_parcela', '')::numeric,
       nullif(f.dados->'honorarios'->>'vencimento_dia', '')::integer, nullif(f.dados->'honorarios'->>'mensalidade', '')::numeric, nullif(f.dados->'honorarios'->>'exito_pct', '')::numeric,
       f.dados->'honorarios'->>'forma', f.dados->'honorarios'->>'observacoes',
       coalesce(nullif(f.dados->'condicoes'->>'data_fechamento', '')::date, f.created_at::date), case when f.contrato_gerado_em is not null then f.contrato_gerado_em::date end, f.contrato_url,
       coalesce(nullif(f.dados->'honorarios'->>'entrada', '')::numeric, 0) + coalesce(nullif(f.dados->'honorarios'->>'parcelas', '')::numeric, 0) * coalesce(nullif(f.dados->'honorarios'->>'valor_parcela', '')::numeric, 0),
       f.created_at
  from public.fechamentos f
 where not exists (select 1 from public.contratos_honorarios ch where ch.cliente_id = f.cliente_id);

-- ---------- solicitação de faturamento ----------
create table if not exists public.solicitacoes_faturamento (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  ano integer, seq integer, codigo text unique,
  cliente_id text not null references public.clientes (id) on delete cascade,
  contrato_id uuid references public.contratos_honorarios (id) on delete set null,
  pasta_numero integer references public.pastas (numero) on delete set null,
  processo_id uuid references public.processos (id) on delete set null,
  solicitante_id uuid references public.colaboradores (id) on delete set null,
  area text,
  tipo text not null default 'parcela' check (tipo in ('entrada', 'parcela', 'mensalidade', 'exito', 'sucumbencia', 'avulso', 'custas', 'outro')),
  descricao text not null,
  valor_total numeric(14,2) not null check (valor_total > 0),
  qtd_parcelas integer not null default 1 check (qtd_parcelas between 1 and 120),
  vencimento_inicial date not null,
  forma text not null default 'UNDEFINED',
  emitir_nf boolean not null default true,
  status text not null default 'em_analise' check (status in ('em_analise', 'autorizada', 'faturada', 'nao_autorizada', 'cancelada')),
  autorizada_por uuid, autorizada_em timestamptz, motivo text,
  faturada_em timestamptz,
  rateio jsonb not null default '[]'::jsonb,   -- [{colaborador_id, papel, pct}] comissões previstas
  observacoes text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(), updated_at timestamptz not null default now()
);
create index if not exists sf_status_idx on public.solicitacoes_faturamento (status, created_at desc);
create index if not exists sf_cliente_idx on public.solicitacoes_faturamento (cliente_id);
alter table public.solicitacoes_faturamento enable row level security;
drop policy if exists sf_sel on public.solicitacoes_faturamento; create policy sf_sel on public.solicitacoes_faturamento for select to authenticated using (public.sou_equipe());
drop policy if exists sf_ins on public.solicitacoes_faturamento; create policy sf_ins on public.solicitacoes_faturamento for insert to authenticated with check (public.sou_equipe());
drop policy if exists sf_upd on public.solicitacoes_faturamento; create policy sf_upd on public.solicitacoes_faturamento for update to authenticated using (public.sou_equipe() and (public.pode_financeiro() or (status = 'em_analise' and created_by = auth.uid()))) with check (public.sou_equipe());
grant select, insert, update on public.solicitacoes_faturamento to authenticated;

create or replace function public.sf_codigo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.ano := extract(year from current_date)::integer;
    select coalesce(max(seq), 0) + 1 into new.seq from public.solicitacoes_faturamento where ano = new.ano;
    new.codigo := 'SF-' || new.ano || '-' || lpad(new.seq::text, 4, '0');
  end if;
  if new.solicitante_id is null then new.solicitante_id := public.meu_colaborador(); end if;
  -- comissão do closer: 8% sobre a entrada (regra confirmada 20/10/2026), prevista automaticamente quando a SF é de entrada
  if tg_op = 'INSERT' and new.tipo = 'entrada' and jsonb_array_length(new.rateio) = 0 then
    new.rateio := coalesce((select jsonb_build_array(jsonb_build_object('colaborador_id', ch.closer_id, 'papel', 'closer', 'pct', 8)) from public.contratos_honorarios ch where ch.id = new.contrato_id and ch.closer_id is not null), '[]'::jsonb);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sf_codigo on public.solicitacoes_faturamento;
create trigger sf_codigo before insert or update on public.solicitacoes_faturamento for each row execute function public.sf_codigo();

-- parcelas da SF (geradas na autorização) e vínculo com a cobrança gerada
create table if not exists public.sf_parcelas (
  id uuid primary key default gen_random_uuid(),
  sf_id uuid not null references public.solicitacoes_faturamento (id) on delete cascade,
  n integer not null,
  valor numeric(14,2) not null,
  vencimento date not null,
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  unique (sf_id, n)
);
alter table public.sf_parcelas enable row level security;
drop policy if exists sfp_sel on public.sf_parcelas; create policy sfp_sel on public.sf_parcelas for select to authenticated using (public.sou_equipe());
grant select on public.sf_parcelas to authenticated;
alter table public.cobrancas add column if not exists sf_id uuid references public.solicitacoes_faturamento (id) on delete set null;

-- comissões
create table if not exists public.comissoes (
  id uuid primary key default gen_random_uuid(),
  sf_id uuid references public.solicitacoes_faturamento (id) on delete cascade,
  cobranca_id uuid references public.cobrancas (id) on delete set null,
  colaborador_id uuid not null references public.colaboradores (id) on delete cascade,
  papel text not null default 'closer',
  pct numeric(5,2) not null,
  base numeric(14,2) not null,
  valor numeric(14,2) generated always as (round(base * pct / 100, 2)) stored,
  status text not null default 'prevista' check (status in ('prevista', 'liberada', 'paga', 'cancelada')),
  liberada_em timestamptz, paga_em date,
  created_at timestamptz not null default now()
);
create index if not exists comissoes_colab_idx on public.comissoes (colaborador_id, status);
alter table public.comissoes enable row level security;
drop policy if exists com_sel on public.comissoes; create policy com_sel on public.comissoes for select to authenticated using (public.pode_financeiro() or colaborador_id = public.meu_colaborador());
drop policy if exists com_mod on public.comissoes; create policy com_mod on public.comissoes for update to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
grant select, update on public.comissoes to authenticated;

-- autorizar: gera as parcelas (mensais a partir do vencimento inicial) e as comissões previstas
create or replace function public.sf_autorizar(p_id uuid, p_autorizar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento; i integer; v numeric; resto numeric; r jsonb; base numeric;
begin
  if not public.pode_financeiro() then raise exception 'Só o financeiro autoriza faturamento.'; end if;
  select * into s from public.solicitacoes_faturamento where id = p_id;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if s.status <> 'em_analise' then raise exception 'Esta solicitação já foi %.', s.status; end if;
  if not p_autorizar then
    update public.solicitacoes_faturamento set status = 'nao_autorizada', autorizada_por = auth.uid(), autorizada_em = now(), motivo = p_motivo where id = p_id;
    perform public.notificar(co.perfil_id, 'Faturamento não autorizado', s.codigo || ' · ' || coalesce(left(p_motivo, 120), 'ver solicitação'), '#faturamento') from public.colaboradores co where co.id = s.solicitante_id and co.perfil_id is not null;
    return;
  end if;
  delete from public.sf_parcelas where sf_id = p_id;
  v := trunc(s.valor_total / s.qtd_parcelas, 2); resto := s.valor_total - v * s.qtd_parcelas;
  for i in 1..s.qtd_parcelas loop
    insert into public.sf_parcelas (sf_id, n, valor, vencimento) values (p_id, i, v + case when i = 1 then resto else 0 end, (s.vencimento_inicial + ((i - 1) || ' month')::interval)::date);
  end loop;
  delete from public.comissoes where sf_id = p_id and status = 'prevista';
  base := s.valor_total;
  for r in select * from jsonb_array_elements(s.rateio) loop
    if nullif(r->>'colaborador_id', '') is not null and coalesce((r->>'pct')::numeric, 0) > 0 then
      insert into public.comissoes (sf_id, colaborador_id, papel, pct, base) values (p_id, (r->>'colaborador_id')::uuid, coalesce(r->>'papel', 'rateio'), (r->>'pct')::numeric, base);
    end if;
  end loop;
  update public.solicitacoes_faturamento set status = 'autorizada', autorizada_por = auth.uid(), autorizada_em = now(), motivo = p_motivo where id = p_id;
  perform public.notificar(co.perfil_id, 'Faturamento autorizado', s.codigo || ' · ' || public.brl(s.valor_total), '#faturamento') from public.colaboradores co where co.id = s.solicitante_id and co.perfil_id is not null;
end $$;
grant execute on function public.sf_autorizar(uuid, boolean, text) to authenticated;

-- faturar: cria as cobranças no painel (origem 'painel'); em produção a tela Financeiro emite no Asaas a partir delas
create or replace function public.sf_faturar(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento; p record; cid uuid; n integer := 0; tipo_cob text;
begin
  if not public.pode_financeiro() then raise exception 'Só o financeiro fatura.'; end if;
  select * into s from public.solicitacoes_faturamento where id = p_id;
  if s.status <> 'autorizada' then raise exception 'A solicitação precisa estar autorizada.'; end if;
  tipo_cob := case s.tipo when 'entrada' then 'entrada' when 'parcela' then 'parcela' when 'mensalidade' then 'mensalidade' when 'exito' then 'exito' else 'outro' end;
  for p in select * from public.sf_parcelas where sf_id = p_id and cobranca_id is null order by n loop
    insert into public.cobrancas (cliente_id, tipo, descricao, valor, vencimento, vencimento_original, status, forma, parcela, total_parcelas, origem, sf_id, created_by)
    values (s.cliente_id, tipo_cob, s.descricao || case when s.qtd_parcelas > 1 then format(' (%s/%s)', p.n, s.qtd_parcelas) else '' end, p.valor, p.vencimento, p.vencimento, 'pendente', s.forma, p.n, s.qtd_parcelas, 'painel', p_id, auth.uid())
    returning id into cid;
    update public.sf_parcelas set cobranca_id = cid where id = p.id; n := n + 1;
  end loop;
  update public.solicitacoes_faturamento set status = 'faturada', faturada_em = now() where id = p_id;
  return n;
end $$;
grant execute on function public.sf_faturar(uuid) to authenticated;

create or replace function public.sf_cancelar(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento;
begin
  select * into s from public.solicitacoes_faturamento where id = p_id;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if not (public.pode_financeiro() or (s.status = 'em_analise' and s.created_by = auth.uid())) then raise exception 'Sem permissão.'; end if;
  if s.status = 'faturada' then raise exception 'Já faturada — cancele as cobranças no Financeiro.'; end if;
  update public.solicitacoes_faturamento set status = 'cancelada', motivo = p_motivo where id = p_id;
  update public.comissoes set status = 'cancelada' where sf_id = p_id and status = 'prevista';
end $$;
grant execute on function public.sf_cancelar(uuid, text) to authenticated;

-- cobrança paga → comissões da SF liberadas (proporcional à parcela paga); closer só sobre a entrada efetivamente paga
create or replace function public.comissoes_liberar_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.solicitacoes_faturamento;
begin
  if new.status = 'paga' and (old.status is distinct from 'paga') and new.sf_id is not null then
    select * into s from public.solicitacoes_faturamento where id = new.sf_id;
    -- comissão sobre o valor pago desta cobrança: cria uma liberada por rateio (a prevista da SF continua como referência até todas pagarem)
    insert into public.comissoes (sf_id, cobranca_id, colaborador_id, papel, pct, base, status, liberada_em)
    select c.sf_id, new.id, c.colaborador_id, c.papel, c.pct, coalesce(new.valor_pago, new.valor), 'liberada', now()
      from public.comissoes c where c.sf_id = new.sf_id and c.status = 'prevista' and c.cobranca_id is null
       and not exists (select 1 from public.comissoes x where x.cobranca_id = new.id and x.colaborador_id = c.colaborador_id);
    -- quando todas as parcelas estão pagas, a prevista some
    if not exists (select 1 from public.cobrancas k where k.sf_id = new.sf_id and k.status <> 'paga') then
      delete from public.comissoes where sf_id = new.sf_id and status = 'prevista' and cobranca_id is null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists comissoes_liberar on public.cobrancas;
create trigger comissoes_liberar after update of status on public.cobrancas for each row execute function public.comissoes_liberar_tg();

-- ---------- views ----------
create or replace view public.v_contratos_honorarios with (security_invoker = true) as
select ch.*, c.nome as cliente_nome, pa.codigo as pasta_codigo, co.nome as responsavel_nome, cl.nome as closer_nome, th.nome as tabela_hora_nome,
       (select count(*) from public.contratos_honorarios_aditivos a where a.contrato_id = ch.id) as qtd_aditivos,
       (select count(*) from public.solicitacoes_faturamento s where s.contrato_id = ch.id) as qtd_sf,
       (select coalesce(sum(s.valor_total), 0) from public.solicitacoes_faturamento s where s.contrato_id = ch.id and s.status in ('autorizada', 'faturada')) as faturado,
       (select coalesce(sum(k.valor_pago), 0) from public.cobrancas k join public.solicitacoes_faturamento s on s.id = k.sf_id where s.contrato_id = ch.id and k.status = 'paga') as recebido
  from public.contratos_honorarios ch
  join public.clientes c on c.id = ch.cliente_id
  left join public.pastas pa on pa.numero = ch.pasta_numero
  left join public.colaboradores co on co.id = ch.responsavel_id
  left join public.colaboradores cl on cl.id = ch.closer_id
  left join public.ts_tabelas_hora th on th.id = ch.tabela_hora_id;
grant select on public.v_contratos_honorarios to authenticated;

create or replace view public.v_solicitacoes_faturamento with (security_invoker = true) as
select s.*, c.nome as cliente_nome, ch.codigo as contrato_codigo, pa.codigo as pasta_codigo, p.numero_cnj, so.nome as solicitante_nome, public.nome_perfil(s.autorizada_por) as autorizada_por_nome,
       (select count(*) from public.sf_parcelas x where x.sf_id = s.id) as qtd_geradas,
       (select count(*) from public.cobrancas k where k.sf_id = s.id and k.status = 'paga') as parcelas_pagas,
       (select coalesce(sum(k.valor_pago), 0) from public.cobrancas k where k.sf_id = s.id and k.status = 'paga') as valor_pago,
       (select coalesce(sum(round(x.base * x.pct / 100, 2)), 0) from public.comissoes x where x.sf_id = s.id and x.status = 'prevista') as comissao_prevista
  from public.solicitacoes_faturamento s
  join public.clientes c on c.id = s.cliente_id
  left join public.contratos_honorarios ch on ch.id = s.contrato_id
  left join public.pastas pa on pa.numero = s.pasta_numero
  left join public.processos p on p.id = s.processo_id
  left join public.colaboradores so on so.id = s.solicitante_id;
grant select on public.v_solicitacoes_faturamento to authenticated;

create or replace view public.v_comissoes with (security_invoker = true) as
select x.*, co.nome as colaborador_nome, s.codigo as sf_codigo, s.cliente_id, c.nome as cliente_nome, s.tipo as sf_tipo, k.vencimento, k.pago_em, date_trunc('month', coalesce(k.pago_em, x.created_at::date))::date as mes
  from public.comissoes x
  join public.colaboradores co on co.id = x.colaborador_id
  left join public.solicitacoes_faturamento s on s.id = x.sf_id
  left join public.clientes c on c.id = s.cliente_id
  left join public.cobrancas k on k.id = x.cobranca_id;
grant select on public.v_comissoes to authenticated;

select 'ok beta 0006' as resultado, (select count(*) from public.contratos_honorarios) as contratos_honorarios, (select count(*) from public.fechamentos) as fechamentos;
