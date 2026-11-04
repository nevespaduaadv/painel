-- 0098 — Financeiro / Central de Cobranças: controle manual da régua, tarefas a partir da régua, registro completo de contato
-- (meio, medida tomada, retorno do cliente, valor negociado), histórico de cobrança por cliente e controle de negociados.
-- Idempotente. Depende de 0055, 0076.

-- ---------- 1. régua: fixar em uma etapa / retirar ----------
alter table public.cobrancas add column if not exists regua_etapa_manual text references public.regua_etapas (codigo) on delete set null;
alter table public.cobrancas add column if not exists regua_manual_motivo text;
alter table public.cobrancas add column if not exists regua_manual_por uuid;
alter table public.cobrancas add column if not exists regua_manual_em timestamptz;
alter table public.cobrancas add column if not exists valor_negociado numeric;

create or replace function public.cobranca_regua_definir(p_cobranca uuid, p_etapa text default null, p_parada boolean default null, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_etapa is not null and not exists (select 1 from public.regua_etapas where codigo = p_etapa) then raise exception 'Etapa % não existe.', p_etapa; end if;
  update public.cobrancas
     set regua_etapa_manual = p_etapa,
         regua_parada = coalesce(p_parada, case when p_etapa is not null then false else regua_parada end),
         regua_manual_motivo = p_motivo, regua_manual_por = auth.uid(), regua_manual_em = now(), atualizado_em = now()
   where id = p_cobranca;
  insert into public.cobranca_contatos (cobranca_id, cliente_nome, valor, desfecho, proxima_acao, observacao, meio, acao, origem)
  select c.id, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome), c.valor, 'VERIFICAR_AMANHA',
         case when coalesce(p_parada, false) then 'Retirada da régua' when p_etapa is not null then 'Movida para a etapa ' || p_etapa else 'Devolvida à régua automática' end,
         p_motivo, 'sistema', case when coalesce(p_parada, false) then 'Retirada da régua' when p_etapa is not null then 'Movida manualmente para ' || p_etapa else 'Devolvida à régua automática' end, 'regua'
    from public.cobrancas c left join public.clientes cl on cl.id = c.cliente_id left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
   where c.id = p_cobranca;
end $$;
revoke all on function public.cobranca_regua_definir(uuid, text, boolean, text) from public, anon;

-- ---------- 2. registro de contato completo ----------
alter table public.cobranca_contatos add column if not exists meio text;            -- whatsapp | ligacao | email | presencial | sistema | outro
alter table public.cobranca_contatos add column if not exists acao text;            -- medida tomada (texto livre com sugestões)
alter table public.cobranca_contatos add column if not exists retorno text;         -- o que o cliente respondeu
alter table public.cobranca_contatos add column if not exists valor_negociado numeric;
alter table public.cobranca_contatos drop constraint if exists cobranca_contatos_desfecho_check;
alter table public.cobranca_contatos add constraint cobranca_contatos_desfecho_check
  check (desfecho in ('RECUPERADO','NAO_RESPONDE','VERIFICAR_AMANHA','NEGOCIOU','SEM_ACORDO'));
alter table public.cobranca_contatos drop constraint if exists cobranca_contatos_origem_check;
update public.cobranca_contatos set origem = 'painel' where origem not in ('painel','migracao','regua','tarefa');

drop function if exists public.cobranca_registrar_contato(uuid, text, text, date, date);
create or replace function public.cobranca_registrar_contato(p_cobranca uuid, p_desfecho text, p_observacao text default null, p_nova_data date default null, p_data date default null,
                                                             p_meio text default null, p_acao text default null, p_retorno text default null, p_valor_negociado numeric default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare c record; novo bigint; prox text; dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select c0.*, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome) as cliente_nome into c
    from public.cobrancas c0 left join public.clientes cl on cl.id = c0.cliente_id left join public.asaas_contatos ac on ac.asaas_id = c0.asaas_cliente_id
   where c0.id = p_cobranca;
  if c.id is null then raise exception 'Cobrança não encontrada.'; end if;
  prox := case p_desfecho when 'RECUPERADO' then 'Encerrado — cobrança quitada' when 'NAO_RESPONDE' then 'Monitorar histórico / avaliar recorrência'
                          when 'VERIFICAR_AMANHA' then 'Entrar na fila de amanhã' when 'NEGOCIOU' then 'Acompanhar nova data de pagamento'
                          when 'SEM_ACORDO' then 'Avaliar próxima medida (gestão)' end;
  insert into public.cobranca_contatos (cobranca_id, cliente_nome, valor, data, desfecho, proxima_acao, observacao, nova_data, meio, acao, retorno, valor_negociado)
  values (p_cobranca, c.cliente_nome, c.valor, dia, p_desfecho, prox,
          coalesce(nullif(btrim(p_observacao), ''), case when p_nova_data is not null then 'Nova data acordada: ' || to_char(p_nova_data, 'DD/MM/YYYY') end),
          p_nova_data, nullif(btrim(p_meio), ''), nullif(btrim(p_acao), ''), nullif(btrim(p_retorno), ''), p_valor_negociado)
  returning id into novo;
  if p_desfecho = 'RECUPERADO' then
    update public.cobrancas set baixa_manual = true, baixa_manual_em = now(), regua_parada = true, atualizado_em = now() where id = p_cobranca;
  elsif p_desfecho = 'NEGOCIOU' then
    update public.cobrancas set vencimento_negociado = coalesce(p_nova_data, vencimento_negociado), valor_negociado = coalesce(p_valor_negociado, valor_negociado), atualizado_em = now() where id = p_cobranca;
  end if;
  return novo;
end $$;
revoke all on function public.cobranca_registrar_contato(uuid, text, text, date, date, text, text, text, numeric) from public, anon;

-- ---------- 3. tarefas a partir da cobrança (para qualquer pessoa, fora do financeiro) ----------
alter table public.tarefas add column if not exists cobranca_id uuid references public.cobrancas (id) on delete set null;
create index if not exists tarefas_cobranca_idx on public.tarefas (cobranca_id) where cobranca_id is not null;

create or replace function public.cobranca_criar_tarefa(p_cobranca uuid, p_titulo text, p_responsavel uuid, p_prazo date, p_descricao text default null, p_nucleo text default null, p_prioridade smallint default 2)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; cob public.cobrancas; col record; tid uuid;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select c0.*, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome) as cliente_nome into c
    from public.cobrancas c0 left join public.clientes cl on cl.id = c0.cliente_id left join public.asaas_contatos ac on ac.asaas_id = c0.asaas_cliente_id
   where c0.id = p_cobranca;
  if c.id is null then raise exception 'Cobrança não encontrada.'; end if;
  select * into cob from public.cobrancas where id = p_cobranca;
  select * into col from public.colaboradores where id = p_responsavel;
  if col.id is null then raise exception 'Responsável não encontrado.'; end if;
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, status, prioridade, cobranca_id, created_by)
  values (btrim(p_titulo),
          coalesce(nullif(btrim(p_descricao), ''), '') || E'\n\nCobrança: ' || coalesce(c.descricao, public.cobranca_parcela_txt(cob), '') || ' · ' || public.brl(c.valor) || ' · vencimento ' || to_char(coalesce(c.vencimento_negociado, c.vencimento), 'DD/MM/YYYY') || coalesce(E'\nCliente: ' || c.cliente_nome, ''),
          c.cliente_id, c.contrato_id, p_responsavel, coalesce(p_nucleo, col.nucleo, 'financeiro'), p_prazo, 'aberta', coalesce(p_prioridade, 2), p_cobranca, auth.uid())
  returning id into tid;
  insert into public.cobranca_contatos (cobranca_id, cliente_nome, valor, desfecho, proxima_acao, observacao, meio, acao, origem)
  values (p_cobranca, c.cliente_nome, c.valor, 'VERIFICAR_AMANHA', 'Tarefa aberta para ' || col.nome, btrim(p_titulo), 'sistema', 'Tarefa criada para ' || col.nome || ' (prazo ' || to_char(p_prazo, 'DD/MM/YYYY') || ')', 'tarefa');
  return tid;
end $$;
revoke all on function public.cobranca_criar_tarefa(uuid, text, uuid, date, text, text, smallint) from public, anon;

-- ---------- 4. views ----------
drop view if exists public.v_cobrancas_negociadas;
drop view if exists public.v_central_cobrancas;
create view public.v_central_cobrancas with (security_invoker = true) as
select c.id, c.asaas_id, c.cliente_id, c.asaas_cliente_id, coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente,
       coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, '(cliente ' || coalesce(c.asaas_cliente_id, '?') || ')') as cliente_nome,
       coalesce(ac.telefone, (select ct.telefone from public.contatos ct where ct.cliente_id = c.cliente_id and ct.telefone is not null order by ct.principal desc nulls last limit 1)) as telefone,
       c.tipo, c.descricao, public.cobranca_parcela_txt(c) as parcela_txt, c.valor, c.valor_negociado, c.vencimento, c.vencimento_negociado, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef,
       c.status, c.pago_em, c.baixa_manual, (c.status = 'paga' or c.baixa_manual) as paga, c.link_fatura, c.link_boleto,
       c.regua_parada, c.regua_etapa_manual, c.regua_manual_motivo,
       (select jsonb_build_object('id', k.id, 'data', k.data, 'desfecho', k.desfecho, 'observacao', k.observacao, 'nova_data', k.nova_data, 'created_at', k.created_at, 'meio', k.meio, 'acao', k.acao, 'retorno', k.retorno)
          from public.cobranca_contatos k where k.cobranca_id = c.id and k.origem in ('painel','migracao') order by k.data desc, k.created_at desc limit 1) as ultimo_contato,
       exists (select 1 from public.cobranca_contatos k where k.cobranca_id = c.id and k.desfecho = 'NEGOCIOU') as negociada,
       exists (select 1 from public.cobranca_checks ck where ck.cobranca_id = c.id and ck.data = (now() at time zone 'America/Sao_Paulo')::date) as check_hoje,
       (select count(*) from public.tarefas t where t.cobranca_id = c.id and t.status not in ('concluida','cancelada'))::int as tarefas_abertas,
       (select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'prazo', t.prazo, 'status', t.status, 'responsavel', co.nome) order by t.prazo)
          from public.tarefas t left join public.colaboradores co on co.id = t.responsavel_id where t.cobranca_id = c.id and t.status not in ('concluida','cancelada')) as tarefas
  from public.cobrancas c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
 where c.status in ('pendente', 'atrasada', 'paga');
revoke all on public.v_central_cobrancas from anon;

-- histórico de cobrança por cliente: contatos manuais + mensagens automáticas da régua + movimentos de régua/tarefas
create or replace view public.v_cobranca_historico with (security_invoker = true) as
select 'contato' as tipo, k.id::text as ref, k.cobranca_id, coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente, c.cliente_id,
       k.cliente_nome, public.cobranca_parcela_txt(c) as parcela_txt, c.descricao, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef, k.valor,
       k.data, k.created_at as quando, k.origem, null::text as etapa, k.meio, k.acao, k.desfecho, k.retorno, k.observacao, k.nova_data, k.valor_negociado,
       coalesce(p.nome, p.email, case when k.origem = 'migracao' then 'Central antiga' end) as por
  from public.cobranca_contatos k join public.cobrancas c on c.id = k.cobranca_id left join public.perfis p on p.id = k.registrado_por
union all
select 'regua', d.id::text || ':' || (e->>'cobranca_id'), (e->>'cobranca_id')::uuid, coalesce(c.asaas_cliente_id, c.cliente_id), c.cliente_id,
       e->>'cliente', e->>'parcela', c.descricao, coalesce(c.vencimento_negociado, c.vencimento), c.valor,
       d.data, coalesce(d.concluido_em, d.aprovado_em, d.created_at), d.origem, d.etapa, 'whatsapp', 'Mensagem automática da régua (' || d.etapa || ')', null, null, left(e->>'mensagem', 300), null, null,
       'Régua de cobrança'
  from public.regua_disparos d cross join lateral jsonb_array_elements(coalesce(d.enviados, '[]'::jsonb)) e
  join public.cobrancas c on c.id::text = e->>'cobranca_id';
revoke all on public.v_cobranca_historico from anon;

-- negociados: toda cobrança com nova data/valor acordado e a situação da promessa
create or replace view public.v_cobrancas_negociadas with (security_invoker = true) as
select v.*, k.data as negociado_em, k.por as negociado_por, k.retorno as negociacao_retorno, k.observacao as negociacao_obs,
       case when v.paga then 'cumprida' when v.venc_ef < (now() at time zone 'America/Sao_Paulo')::date then 'descumprida' else 'a_vencer' end as negociacao_situacao
  from public.v_central_cobrancas v
  left join lateral (select h.data, h.por, h.retorno, h.observacao from public.v_cobranca_historico h where h.cobranca_id = v.id and h.desfecho = 'NEGOCIOU' order by h.quando desc limit 1) k on true
 where v.vencimento_negociado is not null or v.valor_negociado is not null or v.negociada;
revoke all on public.v_cobrancas_negociadas from anon;

-- ---------- 5. regua_preparar respeita fixadas / retiradas ----------
create or replace function public.regua_preparar(p_etapa text, p_data date default null, p_origem text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare et public.regua_etapas; dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date); dow int; alvos int[];
        r record; cob public.cobrancas; aptos jsonb := '[]'::jsonb; fora jsonb := '[]'::jsonb; vistos text[] := '{}'; motivo text; num text; d_id bigint; st text;
begin
  if p_origem = 'manual' and not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into et from public.regua_etapas where codigo = p_etapa and ativa;
  if et.codigo is null then raise exception 'Etapa não encontrada.'; end if;
  if coalesce(et.mensagem, '') = '' then raise exception 'Cadastre a mensagem da etapa antes de disparar.'; end if;
  dow := extract(isodow from dia);
  alvos := array[et.dias];
  if et.dias >= 0 and dow = 5 then alvos := alvos || array[et.dias + 1, et.dias + 2]; end if;
  if et.dias < 0 and dow = 1 then alvos := alvos || array[et.dias - 1, et.dias - 2]; end if;
  for r in
    select c.*, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, c.asaas_cliente_id) as cliente_nome,
           coalesce(ac.telefone, (select ct.telefone from public.contatos ct where ct.cliente_id = c.cliente_id and ct.telefone is not null order by ct.principal desc nulls last limit 1)) as telefone,
           coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente,
           (c.regua_etapa_manual = p_etapa) as fixada
      from public.cobrancas c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
     where c.status in ('pendente', 'atrasada') and not c.baixa_manual and not coalesce(c.regua_parada, false)
       and ( c.regua_etapa_manual = p_etapa
             or (c.regua_etapa_manual is null and coalesce(c.vencimento_negociado, c.vencimento) is not null and (coalesce(c.vencimento_negociado, c.vencimento) - dia) = any(alvos)) )
     order by cliente_nome, coalesce(c.vencimento_negociado, c.vencimento)
  loop
    motivo := null;
    select * into cob from public.cobrancas where id = r.id;
    if r.fixada then
      null; -- fixada manualmente nesta etapa: entra mesmo com outras parcelas em aberto
    elsif et.dias >= 0 and exists (select 1 from public.cobrancas o where o.id <> r.id and coalesce(o.asaas_cliente_id, o.cliente_id) = r.chave_cliente and o.status in ('pendente','atrasada') and not o.baixa_manual and coalesce(o.vencimento_negociado, o.vencimento) < dia) then
      motivo := 'inadimplente (outra parcela vencida)';
    elsif et.dias < 0 and exists (select 1 from public.cobrancas o where o.id <> r.id and coalesce(o.asaas_cliente_id, o.cliente_id) = r.chave_cliente and o.status in ('pendente','atrasada') and not o.baixa_manual and coalesce(o.vencimento_negociado, o.vencimento) < r.venc_ef) then
      motivo := 'já em cadência (outras parcelas vencidas)';
    end if;
    if motivo is null and r.chave_cliente = any(vistos) then
      motivo := 'duplicado (uma mensagem por cliente)';
    elsif motivo is null and nullif(regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g'), '') is null then
      motivo := 'sem telefone';
    elsif motivo is null and exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:%' and m.status <> 'cancelada' and (m.enviar_em at time zone 'America/Sao_Paulo')::date = dia
                    and (m.numero = regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g') or m.numero = '55' || regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g'))) then
      motivo := 'já recebeu mensagem da régua hoje';
    end if;
    if motivo is not null then
      fora := fora || jsonb_build_object('cobranca_id', r.id, 'cliente', r.cliente_nome, 'parcela', public.cobranca_parcela_txt(cob), 'vencimento', to_char(r.venc_ef, 'DD/MM/YYYY'), 'motivo', motivo);
      continue;
    end if;
    vistos := vistos || r.chave_cliente;
    num := regexp_replace(r.telefone, '[^0-9]', '', 'g'); if length(num) <= 11 then num := '55' || num; end if;
    aptos := aptos || jsonb_build_object('cobranca_id', r.id, 'cliente', r.cliente_nome, 'parcela', public.cobranca_parcela_txt(cob), 'vencimento', to_char(r.venc_ef, 'DD/MM/YYYY'),
                                         'valor', public.brl(r.valor), 'tel4', right(num, 4), 'numero', num, 'texto', public.regua_render(et.mensagem, cob, dia), 'fixada', r.fixada);
  end loop;
  st := case when jsonb_array_length(aptos) = 0 then 'sem_clientes' else 'aguardando_aprovacao' end;
  insert into public.regua_disparos (data, etapa, origem, status, aptos, nao_enviados, solicitado_por, motivo)
  values (dia, p_etapa, p_origem, st, aptos, fora, auth.uid(), case when st = 'sem_clientes' then 'Nenhuma cobrança se encaixa nesta etapa hoje.' end)
  on conflict (data, etapa) do update set status = case when regua_disparos.status in ('em_andamento', 'concluida') then regua_disparos.status else excluded.status end,
    aptos = case when regua_disparos.status in ('em_andamento', 'concluida') then regua_disparos.aptos else excluded.aptos end,
    nao_enviados = case when regua_disparos.status in ('em_andamento', 'concluida') then regua_disparos.nao_enviados else excluded.nao_enviados end,
    origem = excluded.origem, solicitado_por = excluded.solicitado_por, motivo = excluded.motivo, atualizado_em = now()
  returning id into d_id;
  return (select to_jsonb(d) from public.regua_disparos d where d.id = d_id);
end $$;
revoke all on function public.regua_preparar(text, date, text) from public, anon;

-- ---------- 6. parâmetros gerais de recebimento (usados ao criar cobranças no Asaas) ----------
insert into public.escritorio (id, dados) values ('financeiro', '{}'::jsonb) on conflict (id) do nothing;
update public.escritorio set dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object(
  'recebimento', coalesce(dados->'recebimento', jsonb_build_object('multa_pct', 2, 'juros_mes_pct', 1, 'desconto_pct', 0, 'desconto_dias', 0, 'forma_padrao', 'UNDEFINED', 'dia_vencimento_padrao', 10, 'notificacoes_asaas', true)))
 where id = 'financeiro';

select 'ok 0098' as resultado;
