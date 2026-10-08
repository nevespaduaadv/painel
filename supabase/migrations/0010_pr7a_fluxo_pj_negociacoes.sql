-- 0010 — PR 7a: fluxo do cliente PJ (etapas do Notion), negociações (kanban de acordos), monitoramento processual
-- e automação de cliente novo. Idempotente. Depende de 0008 (ficha) e 0003 (tarefas).
--
-- Espelha a operação que hoje vive no Notion ("GESTÃO DE PASSIVOS PJ"):
--   • Cadastro Central → colunas novas em clientes (etapa_fluxo, flags, régua, projeto de reserva, serviço)
--   • Acordos e negociações (kanban da Natasha) → tabela negociacoes
--   • Monitoramento PJ (checagem no Escavador) → tabela monitoramentos
--   • Automação "cliente novo" → trigger fluxo_novo_cliente(): tarefas de onboarding + linha de monitoramento
--     (+ negociação "Iniciar acompanhamento" quando tem_divida_atraso = true)

-- ---------- Clientes: fluxo PJ ----------
alter table public.clientes
  add column if not exists etapa_fluxo smallint check (etapa_fluxo between 0 and 10),  -- 0 contrato fechado … 10 ciclo mensal
  add column if not exists tem_divida_atraso boolean,
  add column if not exists adimplente boolean,                                           -- honorários em dia?
  add column if not exists possui_processos boolean,
  add column if not exists projeto_reserva text check (projeto_reserva in ('nao_iniciado','apresentado','em_construcao','formada')),
  add column if not exists regua text check (regua in ('bronze','prata','ouro')),        -- régua de relacionamento
  add column if not exists servico text check (servico in ('gestao_passivos','consultoria','outro')),
  add column if not exists tipos_dividas text,                                           -- texto livre: "3 créditos rurais Sicredi CPF…"
  add column if not exists responsavel_onboarding_id uuid references public.colaboradores(id) on delete set null,
  add column if not exists notion_url text;

-- status ganha 'pausado' (⏸ Pausado / Em risco do Notion)
alter table public.clientes drop constraint if exists clientes_status_check;
alter table public.clientes add constraint clientes_status_check check (status in ('prospect','onboarding','ativo','pausado','encerrado'));

-- ---------- Negociações (kanban de acordos) ----------
create table if not exists public.negociacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  acordo_id uuid references public.acordos(id) on delete set null,     -- preenchido quando o acordo é registrado no contrato
  titulo text not null,                                                 -- "CL Comércio | Santander | Capital de giro"
  banco text,
  etapa text not null default 'iniciar' check (etapa in ('iniciar','extrajudicial','pos_judicializacao','minuta','formalizado','pagamento_pendente','concluido')),
  aguardando text,                                                      -- "comprovante de quitação", "pagamento honorários"…
  temperatura text check (temperatura in ('frio','morno','quente')),
  situacao_processual text,                                             -- sem processo / banco ajuizou ação / cliente ajuizou…
  numero_processo text,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  adverso_contato text,                                                 -- escritório adverso / gerente e telefone
  valor_cobrado numeric, valor_acordo numeric, alcada_autorizada numeric,
  data_acordo date, prazo date,
  proximo_passo text,
  percentual_exito numeric, status_exito text,
  observacoes text,
  ordem integer not null default 0,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists negociacoes_cliente_idx on public.negociacoes(cliente_id);
create index if not exists negociacoes_etapa_idx on public.negociacoes(etapa) where etapa <> 'concluido';

-- ---------- Monitoramento processual (uma linha por cliente) ----------
create table if not exists public.monitoramentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null unique references public.clientes(id) on delete cascade,
  status text not null default 'em_monitoramento' check (status in ('em_monitoramento','nova_movimentacao','pausado')),
  documentos text[] not null default '{}',                               -- CPFs/CNPJs monitorados (empresa, sócios, avalistas)
  tem_processo boolean, foi_citado boolean, tem_garantia boolean,
  avalistas text check (avalistas in ('nao','socio','terceiro')),
  ultima_checagem date, proxima_checagem date,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);

-- Carimbos e auditoria
do $$ declare t text; begin
  foreach t in array array['negociacoes','monitoramentos'] loop
    execute format('drop trigger if exists %I_carimbo on public.%I', t, t);
    execute format('create trigger %I_carimbo before insert or update on public.%I for each row execute procedure public.carimbar2()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute procedure public.auditar()', t, t);
  end loop;
end $$;

-- ---------- RLS: só equipe (o cliente nunca vê negociação nem monitoramento) ----------
alter table public.negociacoes enable row level security;
alter table public.monitoramentos enable row level security;
drop policy if exists neg_all on public.negociacoes;
create policy neg_all on public.negociacoes for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists mon_all on public.monitoramentos;
create policy mon_all on public.monitoramentos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- ---------- Automação: cliente novo ----------
-- Ao criar um cliente: tarefas de onboarding (acompanhamento PJ), linha de monitoramento (jurídico) e,
-- se tem_divida_atraso, negociação "Iniciar acompanhamento" (acordos). Também dispara quando tem_divida_atraso passa a true.
create or replace function public.fluxo_novo_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare novo boolean := (tg_op = 'INSERT');
        virou_divida boolean := (tg_op = 'UPDATE' and coalesce(new.tem_divida_atraso,false) and not coalesce(old.tem_divida_atraso,false));
        resp_onb uuid; resp_jur uuid; resp_aco uuid;
begin
  if not (novo or virou_divida) then return new; end if;
  -- responsáveis padrão: primeiro colaborador ativo de cada núcleo (ajuste depois na tarefa)
  select id into resp_onb from public.colaboradores where ativo and nucleo = 'acompanhamento_pj' order by data_admissao nulls last limit 1;
  select id into resp_jur from public.colaboradores where ativo and nucleo = 'juridico' order by data_admissao nulls last limit 1;
  select id into resp_aco from public.colaboradores where ativo and nucleo = 'acordos' order by data_admissao nulls last limit 1;

  if novo then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Onboarding: cadastro no ADVBOX e envio do formulário de mapeamento (D0)', 'Etapas 1–2 do fluxo PJ. Avance a etapa na ficha do cliente conforme concluir.', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 2, 1),
           ('Onboarding: auditoria do formulário e agendamento da R1', 'Etapas 4–5 do fluxo PJ.', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 7, 2),
           ('Monitoramento: cadastrar CNPJ/CPFs no Escavador e iniciar checagem', 'Preencha a aba Monitoramento do cliente (documentos monitorados, próxima checagem).', new.id, resp_jur, 'juridico', current_date + 3, 2);
    insert into public.monitoramentos (cliente_id, status, responsavel_id, proxima_checagem)
    values (new.id, 'em_monitoramento', resp_jur, current_date + 3) on conflict (cliente_id) do nothing;
  end if;

  if (novo and coalesce(new.tem_divida_atraso,false)) or virou_divida then
    if not exists (select 1 from public.negociacoes where cliente_id = new.id) then
      insert into public.negociacoes (cliente_id, titulo, etapa, responsavel_id, proximo_passo)
      values (new.id, 'Acompanhamento — '||coalesce(new.nome_fantasia, new.dados->>'nome', new.id), 'iniciar', resp_aco, 'Levantar bancos, valores e situação de cada dívida em atraso');
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Acordos: iniciar acompanhamento das dívidas em atraso', 'Cliente marcado com dívida em atraso. Abra uma negociação por banco/contrato.', new.id, resp_aco, 'acordos', current_date + 5, 2);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists clientes_fluxo_novo on public.clientes;
create trigger clientes_fluxo_novo after insert or update of tem_divida_atraso on public.clientes for each row execute procedure public.fluxo_novo_cliente();

-- Acordo registrado no contrato → negociação do mesmo contrato vai para "concluído" e aponta para o acordo
create or replace function public.negociacao_concluir_por_acordo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.negociacoes set etapa = 'concluido', acordo_id = new.id, valor_acordo = coalesce(valor_acordo, new.valor_pago), data_acordo = coalesce(data_acordo, new.data)
  where contrato_id = new.contrato_id and etapa <> 'concluido';
  return new;
end $$;
drop trigger if exists acordos_concluir_negociacao on public.acordos;
create trigger acordos_concluir_negociacao after insert on public.acordos for each row execute procedure public.negociacao_concluir_por_acordo();

-- ---------- Views ----------
create or replace view public.v_negociacoes with (security_invoker = true) as
select n.*, c.dados->>'nome' as cliente_nome, co.nome as responsavel_nome,
       case n.etapa when 'iniciar' then 1 when 'extrajudicial' then 2 when 'pos_judicializacao' then 3 when 'minuta' then 4 when 'formalizado' then 5 when 'pagamento_pendente' then 6 else 7 end as etapa_ordem,
       (n.prazo is not null and n.prazo < current_date and n.etapa <> 'concluido') as atrasada,
       (current_date - n.updated_at::date) as dias_parada
from public.negociacoes n join public.clientes c on c.id = n.cliente_id left join public.colaboradores co on co.id = n.responsavel_id;

create or replace view public.v_negociacoes_por_etapa with (security_invoker = true) as
select etapa, count(*) as negociacoes, coalesce(sum(valor_cobrado),0) as valor_cobrado, coalesce(sum(valor_acordo),0) as valor_acordo
from public.negociacoes group by etapa;

create or replace view public.v_monitoramentos with (security_invoker = true) as
select m.*, c.dados->>'nome' as cliente_nome, c.cnpj, co.nome as responsavel_nome,
       (select count(*) from public.processos p where p.cliente_id = m.cliente_id and p.status = 'ativo') as processos_ativos,
       (m.proxima_checagem is not null and m.proxima_checagem <= current_date) as checagem_vencida
from public.monitoramentos m join public.clientes c on c.id = m.cliente_id left join public.colaboradores co on co.id = m.responsavel_id;

create or replace view public.v_fluxo_pj with (security_invoker = true) as
select c.id, c.dados->>'nome' as nome, c.etapa_fluxo, c.status, c.tem_divida_atraso, c.adimplente, c.possui_processos, c.projeto_reserva, c.regua, c.servico, c.proxima_reuniao, c.data_onboarding,
       co.nome as responsavel_onboarding,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       case c.regua when 'bronze' then 3 when 'prata' then 20 when 'ouro' then 45 end as dias_regua,
       (c.regua is not null and coalesce((select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id), c.created_at::date) < current_date - case c.regua when 'bronze' then 3 when 'prata' then 20 else 45 end) as alerta_relacionamento
from public.clientes c left join public.colaboradores co on co.id = c.responsavel_onboarding_id where c.ativo;

-- v_clientes_ficha ganha as colunas novas (colunas no meio → precisa recriar)
drop view if exists public.v_clientes_ficha;
create view public.v_clientes_ficha with (security_invoker = true) as
select c.id, c.nome, c.nome_fantasia, c.cnpj, c.cpf_titular, c.tipo_pessoa, c.cidade, c.uf, c.segmento, c.faturamento_mensal, c.funcionarios,
       c.historia, c.situacao_atual, c.origem, c.closer, c.data_fechamento, c.data_onboarding, c.plano, c.status, c.ativo,
       c.negativado, c.usa_maquininha, c.tem_consorcio, c.outros_cnpjs, c.assuntos_interesse, c.disponibilidade, c.observacoes_onboarding, c.proxima_reuniao,
       c.etapa_fluxo, c.tem_divida_atraso, c.adimplente, c.possui_processos, c.projeto_reserva, c.regua, c.servico, c.tipos_dividas, c.responsavel_onboarding_id, c.notion_url,
       c.dados->>'responsavel' as responsavel,
       coalesce(nullif(c.dados->>'reservaAcumulada','')::numeric,0) as reserva_acumulada,
       (select count(*) from public.v_contratos k where k.cliente_id = c.id and k.ativo) as contratos_ativos,
       (select coalesce(sum(k.saldo_atual),0) from public.v_contratos k where k.cliente_id = c.id and k.ativo) as saldo,
       (select coalesce(sum(k.saldo_atual),0) from public.v_contratos k where k.cliente_id = c.id and k.ativo and k.estagio = 3) as saldo_estagio3,
       (select count(*) from public.processos p where p.cliente_id = c.id and p.status = 'ativo') as processos_ativos,
       (select count(*) from public.tarefas t where t.cliente_id = c.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select min(prazo) from public.v_prazos z where z.cliente_id = c.id and z.prazo >= current_date) as proximo_prazo,
       (select max(e.data) from public.entradas_timeline e where e.cliente_id = c.id) as ultimo_registro,
       (select count(*) from public.contatos ct where ct.cliente_id = c.id) as contatos,
       (select string_agg(ct.nome, ', ' order by ct.principal desc, ct.nome) from public.contatos ct where ct.cliente_id = c.id and ct.papel in ('socio','titular')) as socios,
       (select count(*) from public.negociacoes n where n.cliente_id = c.id and n.etapa <> 'concluido') as negociacoes_abertas,
       c.created_at, c.updated_at
from public.clientes c;

-- Prazos de negociação entram na agenda geral
create or replace view public.v_prazos with (security_invoker = true) as
select 'tarefa' as origem, t.id, t.cliente_id, t.cliente_nome, t.titulo as descricao, t.prazo, t.prazo_fatal, t.responsavel_id, t.responsavel_nome, t.nucleo, t.faixa, t.dias_para_prazo, t.processo_id, t.numero_cnj
from public.v_tarefas t where t.status in ('aberta','em_andamento') and t.prazo is not null
union all
select 'processo', p.id, p.cliente_id, p.cliente_nome, coalesce(p.tipo_acao,'Processo')||' · '||coalesce(p.numero_cnj,'s/ nº'), p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.responsavel_nome, null,
       case when p.proximo_prazo < current_date then 'atrasada' when p.proximo_prazo = current_date then 'hoje' when p.proximo_prazo <= current_date + 7 then 'd7' when p.proximo_prazo <= current_date + 15 then 'd15' when p.proximo_prazo <= current_date + 30 then 'd30' else 'depois' end,
       p.dias_para_prazo, p.id, p.numero_cnj
from public.v_processos p where p.status = 'ativo' and p.proximo_prazo is not null
union all
select 'negociacao', n.id, n.cliente_id, n.cliente_nome, 'Negociação · '||n.titulo, n.prazo, false, n.responsavel_id, n.responsavel_nome, 'acordos',
       case when n.prazo < current_date then 'atrasada' when n.prazo = current_date then 'hoje' when n.prazo <= current_date + 7 then 'd7' when n.prazo <= current_date + 15 then 'd15' when n.prazo <= current_date + 30 then 'd30' else 'depois' end,
       (n.prazo - current_date), n.processo_id, n.numero_processo
from public.v_negociacoes n where n.etapa <> 'concluido' and n.prazo is not null;

-- ---------- Tempo real ----------
do $$ begin
  alter publication supabase_realtime add table public.negociacoes, public.monitoramentos;
exception when others then null; end $$;

select 'ok 0010' as resultado;
