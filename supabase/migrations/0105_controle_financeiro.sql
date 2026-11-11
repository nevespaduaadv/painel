-- 0105 — Controle financeiro v2 (especificação do setor financeiro, 10/11/2026): régua com dia exato (D-5, D-2, D-0, D+1, D+3, D+7),
-- envio do boleto no D-2, retornos (Sem retorno / Remarcou pagamento / Pago), remarcados, recuperados e remanescentes, exclusões
-- (execução / retirado do Asaas), tarefas por etapa com executor padrão e criação automática. Idempotente.

-- 1) etapas da régua: dia exato + executor padrão + tarefa automática
alter table public.regua_etapas add column if not exists executor_padrao_id uuid references public.colaboradores (id) on delete set null;
alter table public.regua_etapas add column if not exists executor_nucleo text;             -- fallback: 'financeiro' | 'administrativo' | 'juridico' | 'socios'
alter table public.regua_etapas add column if not exists tarefa_automatica boolean not null default false;
alter table public.regua_etapas add column if not exists acao text;                        -- nome curto da ação ("Relatório mensal", "Aviso de vencimento + boleto"…)
alter table public.regua_etapas add column if not exists ordem integer not null default 0;
insert into public.regua_etapas (codigo, titulo, descricao, dias, mensagem, personalizada, ativa, automatica, acao, ordem) values
 ('D-5', 'Relatório mensal',        '5 dias antes do vencimento', 5,  coalesce((select mensagem from public.regua_etapas where codigo='D-5'), ''), false, true, false, 'Relatório mensal', 10),
 ('D-2', 'Aviso de vencimento',     '2 dias antes: aviso + envio do boleto', 2, coalesce((select mensagem from public.regua_etapas where codigo='D-2'), ''), false, true, false, 'Aviso de vencimento + envio do boleto', 20),
 ('D-0', 'Lembrete',                'Dia do vencimento', 0, coalesce((select mensagem from public.regua_etapas where codigo='D-0'), ''), false, true, false, 'Lembrete', 30),
 ('D+1', 'Primeiro contato de cobrança', '1 dia após o vencimento sem pagamento', -1, coalesce((select mensagem from public.regua_etapas where codigo='D+1'), ''), false, true, false, 'Primeiro contato de cobrança', 40),
 ('D+3', 'Solicitar previsão de pagamento', '3 dias após', -3, '', false, true, false, 'Solicitar previsão de pagamento', 50),
 ('D+7', 'Contato do supervisor',   '7 dias após', -7, '', false, true, false, 'Contato do supervisor', 60)
on conflict (codigo) do update set acao = excluded.acao, ordem = excluded.ordem, dias = excluded.dias, ativa = true;
update public.regua_etapas set tarefa_automatica = true, executor_nucleo = coalesce(executor_nucleo, 'socios') where codigo = 'D+7' and not tarefa_automatica and executor_padrao_id is null;
update public.regua_etapas set executor_nucleo = coalesce(executor_nucleo, 'financeiro') where codigo in ('D-5','D-2','D-0','D+1','D+3');

-- 2) cobranças: boleto enviado, remarcação, etapa em que pagou
alter table public.cobrancas add column if not exists boleto_enviado_em timestamptz;
alter table public.cobrancas add column if not exists boleto_enviado_canal text;
alter table public.cobrancas add column if not exists boleto_enviado_por uuid;
alter table public.cobrancas add column if not exists remarcado_para date;
alter table public.cobrancas add column if not exists remarcacoes integer not null default 0;
alter table public.cobrancas add column if not exists cobranca_msg_em date;      -- 1ª mensagem de cobrança (D+1 em diante)
alter table public.cobrancas add column if not exists pago_etapa text;           -- etapa da régua em que o pagamento foi confirmado
alter table public.cobrancas add column if not exists excluida_tipo text check (excluida_tipo in ('execucao','retirado'));
alter table public.cobrancas add column if not exists excluida_motivo text;
alter table public.cobrancas add column if not exists excluida_em timestamptz;

-- 3) exclusões no cadastro do cliente (decidido para execução / retirado do Asaas)
alter table public.clientes add column if not exists cobranca_excluido text check (cobranca_excluido in ('execucao','retirado'));
alter table public.clientes add column if not exists cobranca_excluido_motivo text;
alter table public.clientes add column if not exists cobranca_excluido_em timestamptz;
alter table public.clientes add column if not exists cobranca_excluido_por uuid;

-- 4) contatos: tipos novos (mensagem da etapa, mensagem de cobrança, retorno)
alter table public.cobranca_contatos drop constraint if exists cobranca_contatos_desfecho_check;
alter table public.cobranca_contatos add constraint cobranca_contatos_desfecho_check check (desfecho = any (array['RECUPERADO','NAO_RESPONDE','VERIFICAR_AMANHA','NEGOCIOU','SEM_ACORDO','SEM_RETORNO','REMARCOU','MENSAGEM','BOLETO']));
alter table public.cobranca_contatos add column if not exists etapa text;

-- 5) etapa da régua pelo dia exato
create or replace function public.regua_etapa_de(p_venc date, p_hoje date default null) returns text language sql immutable as $$
  select case when p_venc is null then null
              when (p_venc - coalesce(p_hoje, current_date)) > 5 then 'ANTES'
              when (p_venc - coalesce(p_hoje, current_date)) > 2 then 'D-5'
              when (p_venc - coalesce(p_hoje, current_date)) > 0 then 'D-2'
              when (p_venc - coalesce(p_hoje, current_date)) = 0 then 'D-0'
              when (p_venc - coalesce(p_hoje, current_date)) > -3 then 'D+1'
              when (p_venc - coalesce(p_hoje, current_date)) > -7 then 'D+3'
              else 'D+7' end
$$;

-- 6) régua (cobranças abertas do mês de referência + atrasadas) — uma linha por cobrança
drop view if exists public.v_regua_cobranca;
create view public.v_regua_cobranca with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
select c.id, c.asaas_id, c.cliente_id, c.asaas_cliente_id, coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente,
       coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, c.asaas_cliente_id) as cliente_nome, coalesce(ac.telefone, cl.dados->>'telefone') as telefone,
       c.tipo, c.descricao, c.parcela, c.total_parcelas,
       case when c.total_parcelas is not null then 'Parcela ' || coalesce(c.parcela,1) || ' de ' || c.total_parcelas else coalesce(c.descricao, initcap(c.tipo)) end as parcela_txt,
       c.valor, c.valor_liquido, c.vencimento, c.vencimento_negociado, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef, c.status, c.pago_em, c.link_fatura, c.link_boleto,
       (coalesce(c.vencimento_negociado, c.vencimento) - h.d) as dias_para, greatest(h.d - coalesce(c.vencimento_negociado, c.vencimento), 0) as dias_atraso,
       c.remarcado_para, c.remarcacoes, c.cobranca_msg_em, c.boleto_enviado_em, c.boleto_enviado_canal, c.regua_enviadas, c.regua_parada,
       case when c.remarcado_para is not null and c.remarcado_para >= h.d then 'REMARCADO'
            when c.remarcado_para is not null and c.remarcado_para < h.d and c.status in ('pendente','atrasada') then 'D+1'
            else public.regua_etapa_de(coalesce(c.vencimento_negociado, c.vencimento), h.d) end as etapa,
       (c.remarcado_para is not null and c.remarcado_para < h.d) as venceu_de_novo,
       (public.regua_etapa_de(coalesce(c.vencimento_negociado, c.vencimento), h.d) = any (c.regua_enviadas)) as mensagem_enviada,
       (c.boleto_enviado_em is not null) as boleto_enviado,
       (ac.telefone is null and (cl.dados->>'telefone') is null) as sem_contato,
       (select count(*) from public.tarefas t where t.cobranca_id = c.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'status', t.status, 'prazo', t.prazo, 'responsavel', co.nome) order by t.prazo) from public.tarefas t left join public.colaboradores co on co.id = t.responsavel_id where t.cobranca_id = c.id) as tarefas,
       (cl.cobranca_excluido is not null or c.excluida_tipo is not null) as excluida,
       exists (select 1 from public.cobrancas o where o.id <> c.id and coalesce(o.asaas_cliente_id, o.cliente_id) = coalesce(c.asaas_cliente_id, c.cliente_id) and o.status = 'atrasada' and coalesce(o.vencimento_negociado, o.vencimento) < date_trunc('month', h.d)::date) as inadimplente_anterior
  from public.cobrancas c cross join hoje h
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.asaas_clientes ac on ac.asaas_id = c.asaas_cliente_id
 where c.status in ('pendente','atrasada') and not coalesce(c.baixa_manual, false);
revoke all on public.v_regua_cobranca from anon;

-- 7) ações da equipe (financeiro)
create or replace function public.cobranca_boleto_enviado(p_cobranca uuid, p_canal text default 'chatguru', p_data timestamptz default now(), p_desfazer boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_desfazer then update public.cobrancas set boleto_enviado_em = null, boleto_enviado_canal = null, boleto_enviado_por = null where id = p_cobranca; return; end if;
  update public.cobrancas set boleto_enviado_em = coalesce(p_data, now()), boleto_enviado_canal = coalesce(p_canal,'manual'), boleto_enviado_por = auth.uid() where id = p_cobranca;
  insert into public.cobranca_contatos (cobranca_id, data, desfecho, observacao, registrado_por, origem, meio, acao, etapa)
  select c.id, (coalesce(p_data, now()) at time zone 'America/Sao_Paulo')::date, 'BOLETO', 'Boleto enviado (' || coalesce(p_canal,'manual') || ')', auth.uid(), 'painel', p_canal, 'boleto', 'D-2' from public.cobrancas c where c.id = p_cobranca;
end $$;
grant execute on function public.cobranca_boleto_enviado(uuid, text, timestamptz, boolean) to authenticated;

-- mensagem da etapa (D-5, D-2, D-0, D+1, D+3, D+7) registrada à mão; marca regua_enviadas e a 1ª mensagem de cobrança
create or replace function public.cobranca_registrar_mensagem(p_cobranca uuid, p_etapa text, p_data date default null, p_observacao text default null, p_meio text default 'whatsapp') returns void
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.cobrancas set regua_enviadas = (case when p_etapa = any(regua_enviadas) then regua_enviadas else regua_enviadas || p_etapa end),
         cobranca_msg_em = case when p_etapa like 'D+%' then coalesce(cobranca_msg_em, d) else cobranca_msg_em end
   where id = p_cobranca;
  insert into public.cobranca_contatos (cobranca_id, data, desfecho, observacao, registrado_por, origem, meio, acao, etapa)
  values (p_cobranca, d, 'MENSAGEM', coalesce(p_observacao, 'Mensagem da etapa ' || p_etapa), auth.uid(), 'painel', p_meio, 'mensagem', p_etapa);
end $$;
grant execute on function public.cobranca_registrar_mensagem(uuid, text, date, text, text) to authenticated;

-- retorno do cliente: SEM_RETORNO ou REMARCOU (nova data obrigatória)
create or replace function public.cobranca_registrar_retorno(p_cobranca uuid, p_tipo text, p_nova_data date default null, p_observacao text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Sao_Paulo')::date; c public.cobrancas;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into c from public.cobrancas where id = p_cobranca; if not found then raise exception 'Cobrança não encontrada'; end if;
  if p_tipo = 'REMARCOU' then
    if p_nova_data is null then raise exception 'Informe a nova data da remarcação'; end if;
    update public.cobrancas set remarcado_para = p_nova_data, remarcacoes = coalesce(remarcacoes,0) + 1 where id = p_cobranca;
  elsif p_tipo = 'SEM_RETORNO' then null;
  else raise exception 'Retorno inválido'; end if;
  insert into public.cobranca_contatos (cobranca_id, data, desfecho, observacao, nova_data, registrado_por, origem, acao, retorno, etapa)
  values (p_cobranca, d, p_tipo, p_observacao, p_nova_data, auth.uid(), 'painel', 'retorno', case p_tipo when 'REMARCOU' then 'Remarcou pagamento' else 'Sem retorno' end, public.regua_etapa_de(coalesce(c.vencimento_negociado, c.vencimento), d));
end $$;
grant execute on function public.cobranca_registrar_retorno(uuid, text, date, text) to authenticated;

-- exclusão do cliente da régua (execução / retirado do Asaas), com motivo; p_tipo null reverte
create or replace function public.cliente_cobranca_excluir(p_cliente text, p_tipo text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_tipo is not null and coalesce(p_motivo,'') = '' then raise exception 'Informe o motivo'; end if;
  update public.clientes set cobranca_excluido = p_tipo, cobranca_excluido_motivo = case when p_tipo is null then null else p_motivo end,
         cobranca_excluido_em = case when p_tipo is null then null else now() end, cobranca_excluido_por = case when p_tipo is null then null else auth.uid() end
   where id = p_cliente;
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente)
  values (p_cliente, current_date, 'registro', case when p_tipo is null then 'Cobrança: cliente voltou para a régua.' else 'Cobrança: cliente ' || case p_tipo when 'execucao' then 'decidido para execução' else 'retirado do Asaas' end || '. Motivo: ' || p_motivo end, false, auth.uid(), 'negocial');
end $$;
grant execute on function public.cliente_cobranca_excluir(text, text, text) to authenticated;

-- 8) ao confirmar pagamento: registra a etapa em que pagou (para o gráfico de recuperação)
create or replace function public.cobranca_pago_etapa() returns trigger language plpgsql as $$
begin
  if new.status = 'paga' and (old.status is distinct from 'paga') and new.pago_etapa is null then
    new.pago_etapa := case when new.remarcado_para is not null then 'REMARCACAO' else public.regua_etapa_de(coalesce(new.vencimento_negociado, new.vencimento), coalesce(new.pago_em, (now() at time zone 'America/Sao_Paulo')::date)) end;
  end if;
  return new;
end $$;
drop trigger if exists cobrancas_pago_etapa on public.cobrancas;
create trigger cobrancas_pago_etapa before update on public.cobrancas for each row execute procedure public.cobranca_pago_etapa();

-- 9) recuperação: cobranças vencidas no mês que receberam mensagem de cobrança
drop view if exists public.v_fin_recuperacao;
create view public.v_fin_recuperacao with (security_invoker = true) as
select c.id, c.cliente_id, coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, c.asaas_cliente_id) as cliente_nome,
       to_char(coalesce(c.vencimento_negociado, c.vencimento), 'YYYY-MM') as mes, coalesce(c.vencimento_negociado, c.vencimento) as vencimento, c.valor, c.valor_pago, c.cobranca_msg_em, c.pago_em, c.status,
       case when c.status = 'paga' and coalesce(c.valor_pago, c.valor) >= c.valor - 0.01 then 'recuperado'
            when c.status = 'paga' then 'parcial' else 'aberto' end as situacao,
       case when c.status = 'paga' then coalesce(c.pago_etapa, case when c.remarcado_para is not null then 'REMARCACAO' else public.regua_etapa_de(coalesce(c.vencimento_negociado, c.vencimento), c.pago_em) end) end as pago_etapa,
       c.parcela, c.total_parcelas
  from public.cobrancas c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.asaas_clientes ac on ac.asaas_id = c.asaas_cliente_id
 where c.cobranca_msg_em is not null and (c.status <> 'paga' or c.pago_em >= c.cobranca_msg_em);
revoke all on public.v_fin_recuperacao from anon;

-- 10) remanescentes: remarcações cuja nova data cai em mês posterior ao vencimento
drop view if exists public.v_fin_remanescentes;
create view public.v_fin_remanescentes with (security_invoker = true) as
with ult as (
  select distinct on (k.cobranca_id) k.cobranca_id, k.nova_data, k.data as remarcado_em from public.cobranca_contatos k where k.desfecho = 'REMARCOU' and k.nova_data is not null order by k.cobranca_id, k.created_at desc)
select c.id, c.cliente_id, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, c.asaas_cliente_id) as cliente_nome,
       to_char(coalesce(c.vencimento_negociado, c.vencimento), 'YYYY-MM') as mes_origem, to_char(u.nova_data, 'YYYY-MM') as mes_destino,
       coalesce(c.vencimento_negociado, c.vencimento) as vencimento_original, u.nova_data, u.remarcado_em, c.valor, c.valor_pago, c.status, c.pago_em, c.remarcacoes,
       case when c.status = 'paga' then 'pago' when u.nova_data >= (now() at time zone 'America/Sao_Paulo')::date then 'aguardando' else 'venceu_de_novo' end as situacao
  from ult u join public.cobrancas c on c.id = u.cobranca_id
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.asaas_clientes ac on ac.asaas_id = c.asaas_cliente_id
 where to_char(u.nova_data, 'YYYY-MM') > to_char(coalesce(c.vencimento_negociado, c.vencimento), 'YYYY-MM');
revoke all on public.v_fin_remanescentes from anon;

-- 11) tarefas automáticas por etapa (executor padrão), 1× por dia
create or replace function public.regua_tarefas_auto() returns integer language plpgsql security definer set search_path = public as $$
declare r record; et public.regua_etapas; resp uuid; n integer := 0; tit text;
begin
  for r in select v.* from public.v_regua_cobranca v where not v.excluida and v.etapa in (select codigo from public.regua_etapas where ativa and tarefa_automatica) and v.tarefas_abertas = 0
             and not exists (select 1 from public.tarefas t where t.cobranca_id = v.id and t.titulo like v.etapa || ' · %') loop
    select * into et from public.regua_etapas where codigo = r.etapa;
    resp := et.executor_padrao_id;
    if resp is null and et.executor_nucleo is not null then resp := public.responsavel_padrao(et.executor_nucleo); end if;
    if resp is null then select id into resp from public.colaboradores where ativo and nucleo = 'socios' order by data_admissao nulls last limit 1; end if;
    tit := r.etapa || ' · ' || coalesce(et.acao, et.titulo) || ' · ' || coalesce(r.cliente_nome, 'cliente');
    insert into public.tarefas (titulo, descricao, cliente_id, cobranca_id, responsavel_id, nucleo, prazo, prioridade, status, prazo_fatal)
    values (tit, 'Criada automaticamente pela régua (' || r.etapa || '). ' || coalesce(r.parcela_txt,'') || ' · ' || to_char(r.valor, 'FM999G999G990D00') || ' · ' || r.dias_atraso || ' dia(s) de atraso.' || coalesce(E'\nFatura: ' || r.link_fatura, ''),
            r.cliente_id, r.id, resp, 'financeiro', (now() at time zone 'America/Sao_Paulo')::date, 1, 'aberta', false);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.regua_tarefas_auto() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'regua_tarefas_auto';
  perform cron.schedule('regua_tarefas_auto', '20 11 * * 1-5', $c$select public.regua_tarefas_auto()$c$);   -- 08:20 BRT, dias úteis
exception when others then raise notice 'cron indisponível: %', sqlerrm; end $$;

select 'ok 0105' as resultado, (select count(*) from public.regua_etapas where ativa) as etapas, (select count(*) from public.v_regua_cobranca) as cobrancas_na_regua;
