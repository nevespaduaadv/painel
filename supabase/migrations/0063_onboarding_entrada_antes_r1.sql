-- 0063 — Onboarding: a R1 só pode ser agendada depois de confirmado o pagamento da entrada.
-- Confirmação automática (cobrança Asaas do tipo 'entrada' paga) ou manual (botão no card Onboarding).
-- Idempotente. Depende de 0052, 0055.

alter table public.clientes add column if not exists entrada_confirmada_em timestamptz;

create or replace function public.onboarding_entrada_ok(p_cliente text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clientes c where c.id = p_cliente and c.entrada_confirmada_em is not null)
      or exists (select 1 from public.cobrancas k where k.cliente_id = p_cliente and k.tipo = 'entrada' and k.status = 'paga')
$$;

insert into public.mensagens_modelos (chave, titulo, texto, variaveis) values
('onb_formulario_recebido_aguardando', 'Onboarding — formulário recebido (aguardando entrada)',
 E'Recebemos o seu formulário, {nome} — obrigado! ✅\n\nAssim que confirmarmos o pagamento da entrada, você recebe por aqui o link para escolher o horário da sua reunião de onboarding.',
 '{nome}'),
('onb_agenda_liberada', 'Onboarding — entrada confirmada + agenda',
 E'Pagamento confirmado, {nome}! 🤝\n\nAgora escolha o melhor horário para a sua reunião de onboarding:\n{link}',
 '{nome} {link}')
on conflict (chave) do nothing;

-- libera o agendamento: marca a entrada como confirmada (se ainda não) e manda o link da agenda, uma vez só
create or replace function public.onboarding_liberar_agenda(p_cliente text, p_origem text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; ja boolean;
begin
  select * into c from public.clientes where id = p_cliente;
  if c.id is null then raise exception 'Cliente não encontrado'; end if;
  if c.entrada_confirmada_em is null then
    update public.clientes set entrada_confirmada_em = now() where id = p_cliente;
    insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
    values (p_cliente, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'Entrada confirmada (' || p_origem || ') — agendamento da R1 liberado', false, p_origem <> 'manual', 'onboarding');
    update public.tarefas set status = 'concluida', concluida_em = now() where cliente_id = p_cliente and titulo like 'Onboarding: conferir pagamento da entrada%' and status in ('aberta','em_andamento');
  end if;
  select exists (select 1 from public.mensagens_fila m where m.cliente_id = p_cliente and m.referencia = 'onboarding:agenda_liberada' and m.status <> 'cancelada') into ja;
  -- só manda o link se o cliente já respondeu o formulário e ainda não tem reunião marcada
  if not ja and c.formulario_em is not null and not exists (select 1 from public.agenda_eventos e where e.cliente_id = p_cliente and e.finalidade = 'onboarding' and not e.cancelado and e.inicio > now()) then
    perform public.mensagem_enfileirar(p_cliente, 'onb_agenda_liberada', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar'), now(), 'onboarding:agenda_liberada');
    return jsonb_build_object('ok', true, 'enviado', true);
  end if;
  return jsonb_build_object('ok', true, 'enviado', false);
end $$;
revoke all on function public.onboarding_liberar_agenda(text, text) from public, anon;
grant execute on function public.onboarding_liberar_agenda(text, text) to authenticated;

-- formulário respondido: com entrada ok manda a agenda; sem entrada, avisa que aguarda e abre tarefa de conferência
create or replace function public.onboarding_responder(t text, r jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; resp uuid; tid uuid; k text; dsc text; ok boolean;
  simnao text[] := array['sim','true','1'];
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then raise exception 'Link inválido.' using errcode = '28000'; end if;
  if r is null or jsonb_typeof(r) <> 'object' then raise exception 'Respostas inválidas.'; end if;
  if length(r::text) > 60000 then raise exception 'Respostas muito longas.'; end if;
  insert into public.onboarding_respostas (cliente_id, respostas) values (c.id, r);

  update public.clientes set
    negativado = case when lower(coalesce(r->>'negativado','')) = any(simnao) then true when lower(coalesce(r->>'negativado','')) in ('nao','não','false','0') then false else negativado end,
    usa_maquininha = case when lower(coalesce(r->>'maquininha','')) = any(simnao) then true when lower(coalesce(r->>'maquininha','')) in ('nao','não','false','0') then false else usa_maquininha end,
    tem_consorcio = case when lower(coalesce(r->>'consorcio','')) = any(simnao) then true when lower(coalesce(r->>'consorcio','')) in ('nao','não','false','0') then false else tem_consorcio end,
    possui_processos = case when lower(coalesce(r->>'acao_judicial','')) = any(simnao) then true when lower(coalesce(r->>'acao_judicial','')) in ('nao','não','false','0') then false else possui_processos end,
    outros_cnpjs = coalesce(nullif(r->>'outros_cnpjs_quais',''), outros_cnpjs),
    assuntos_interesse = coalesce(nullif(r->>'assuntos',''), assuntos_interesse),
    disponibilidade = coalesce(nullif(r->>'disponibilidade',''), disponibilidade),
    tipos_dividas = coalesce(nullif(r->>'contratos',''), tipos_dividas),
    situacao_atual = coalesce(nullif(r->>'situacao',''), situacao_atual),
    observacoes_onboarding = concat_ws(E'\n', nullif(r->>'extra',''), case when nullif(r->>'garantia','') is not null then 'Garantias: ' || (r->>'garantia') end, case when nullif(r->>'ativos_onus','') is not null then 'Ativos com ônus: ' || (r->>'ativos_onus') end),
    formulario_em = now(),
    etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 3)
  where id = c.id;

  for k, dsc in select * from (values ('veiculo', r->>'veiculos'), ('imovel', r->>'imoveis'), ('maquinario', r->>'maquinario'), ('outro', r->>'quais_ativos')) v(tipo, descricao) loop
    if nullif(trim(dsc), '') is not null and lower(trim(dsc)) not in ('não','nao','nenhum','nenhuma','-') then
      insert into public.bens (cliente_id, tipo, descricao, observacoes) values (c.id, k, left(dsc, 2000), 'Declarado no formulário de onboarding');
    end if;
  end loop;

  resp := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  ok := public.onboarding_entrada_ok(c.id);
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Onboarding: conferir o formulário de mapeamento — ' || coalesce(c.nome_fantasia, c.dados->>'nome', c.id),
          E'O cliente respondeu o formulário (aba Onboarding da ficha). Confira as respostas, complete a ficha/contratos e documente o que foi prometido na venda.\n' ||
          case when ok then 'O cliente já recebeu o link da agenda para marcar a R1.' else 'A entrada ainda não está confirmada: o link da agenda só vai depois da confirmação (automática pelo Asaas ou pelo botão no card Onboarding).' end,
          c.id, resp, 'acompanhamento_pj', current_date + 2, 1) returning id into tid;
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
  values (c.id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'Formulário de mapeamento respondido pelo cliente', false, true, 'onboarding');
  if ok then
    perform public.mensagem_enfileirar(c.id, 'onb_formulario_recebido', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar'), now(), 'onboarding:formulario_recebido');
  else
    perform public.mensagem_enfileirar(c.id, 'onb_formulario_recebido_aguardando', '{}'::jsonb, now(), 'onboarding:formulario_recebido');
    if not exists (select 1 from public.tarefas x where x.cliente_id = c.id and x.titulo like 'Onboarding: conferir pagamento da entrada%' and x.status in ('aberta','em_andamento')) then
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Onboarding: conferir pagamento da entrada — ' || coalesce(c.nome_fantasia, c.dados->>'nome', c.id),
              E'O cliente respondeu o formulário, mas a entrada ainda não consta como paga. Confira no Financeiro/Asaas. Se já foi paga por fora, use "Confirmar entrada e liberar R1" no card Onboarding da ficha — o cliente recebe o link da agenda na hora.',
              c.id, resp, 'acompanhamento_pj', current_date + 2, 1);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- contexto para a página pública: informa se o agendamento está liberado
create or replace function public.onboarding_contexto(t text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; ev record; resp text;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then return null; end if;
  select e.* into ev from public.agenda_eventos e where e.cliente_id = c.id and e.tipo = 'reuniao' and e.finalidade = 'onboarding' and not e.cancelado and e.inicio > now() - interval '2 hours' order by e.inicio limit 1;
  select co.nome into resp from public.colaboradores co where co.id = coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  return jsonb_build_object(
    'empresa', coalesce(c.nome_fantasia, c.dados->>'nome'),
    'nome', public.cliente_primeiro_nome(c.id),
    'respondido_em', (select max(enviado_em) from public.onboarding_respostas r where r.cliente_id = c.id),
    'responsavel', resp,
    'entrada_ok', public.onboarding_entrada_ok(c.id),
    'reuniao', case when ev.id is null then null else jsonb_build_object('id', ev.id, 'inicio', ev.inicio, 'link', case when ev.link like '#%' then null else ev.link end) end);
end $$;

-- trava no agendamento (o cliente não consegue marcar sem entrada confirmada, mesmo com o link)
do $$
declare src text;
begin
  select pg_get_functiondef('public.onboarding_agendar(text, timestamptz)'::regprocedure) into src;
  if position('onboarding_entrada_ok' in src) = 0 then
    src := replace(src, E'if c.id is null then raise exception ''Link inválido.'' using errcode = ''28000''; end if;',
      E'if c.id is null then raise exception ''Link inválido.'' using errcode = ''28000''; end if;\n  if not public.onboarding_entrada_ok(c.id) then raise exception ''O agendamento é liberado após a confirmação do pagamento da entrada.'' using errcode = ''P0001''; end if;');
    execute src;
  end if;
end $$;

-- Asaas: entrada paga → confirma e libera (manda o link se o formulário já foi respondido)
create or replace function public.cobranca_entrada_paga() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and new.tipo = 'entrada' and new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then
    perform public.onboarding_liberar_agenda(new.cliente_id, 'Asaas');
  end if;
  return new;
end $$;
drop trigger if exists cobranca_entrada_paga on public.cobrancas;
create trigger cobranca_entrada_paga after insert or update of status on public.cobrancas for each row execute procedure public.cobranca_entrada_paga();

-- view do card
drop view if exists public.v_onboarding_cliente;
create view public.v_onboarding_cliente with (security_invoker = true) as
select c.id as cliente_id, c.onboarding_token, c.onboarding_enviado_em, c.formulario_em, c.proxima_reuniao,
       (select r.respostas from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as respostas,
       (select r.conferido_em from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as conferido_em,
       (select jsonb_build_object('id', e.id, 'inicio', e.inicio, 'link', e.link, 'colaborador', co.nome) from public.agenda_eventos e left join public.colaboradores co on co.id = e.colaborador_id
          where e.cliente_id = c.id and e.finalidade = 'onboarding' and not e.cancelado order by e.inicio desc limit 1) as reuniao,
       (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'modelo', m.modelo, 'titulo', mm.titulo, 'enviar_em', m.enviar_em, 'status', m.status, 'resultado', m.resultado, 'enviada_em', m.enviada_em, 'numero', m.numero) order by m.enviar_em desc), '[]'::jsonb)
          from public.mensagens_fila m left join public.mensagens_modelos mm on mm.chave = m.modelo where m.cliente_id = c.id) as mensagens,
       c.entrada_confirmada_em, public.onboarding_entrada_ok(c.id) as entrada_ok,
       (select k.pago_em from public.cobrancas k where k.cliente_id = c.id and k.tipo = 'entrada' and k.status = 'paga' order by k.pago_em desc limit 1) as entrada_paga_em
from public.clientes c;

select 'ok 0063' as resultado;
