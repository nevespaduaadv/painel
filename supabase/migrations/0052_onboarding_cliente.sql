-- 0052 — Onboarding do cliente PJ (POP Onboarding, passos 1–6 e lembretes):
--   (a) fila de mensagens WhatsApp para clientes (enviada pela Edge Function chatguru, rota /automacoes, a cada minuto, em horário comercial);
--   (b) boas-vindas + link do formulário 5 min depois do cadastro do cliente (token próprio de onboarding, sem login);
--   (c) formulário de mapeamento respondido pelo cliente → ficha/bens, tarefa de auditoria, confirmação + link da agenda;
--   (d) agendamento da R1 pelo cliente (≥ 1 dia útil de preparo, horários livres do responsável) → Agenda/Google, tarefa de preparação,
--       confirmação e lembretes no dia (8h30 e 1h antes, com o link da call quando preenchido no compromisso).
-- Idempotente. Depende de 0010 (fluxo PJ), 0027/0028 (automações/token), 0047 (agenda), 0051 (helpers), feriados (0040?).

-- ---------- token de onboarding e colunas ----------
alter table public.agenda_eventos add column if not exists finalidade text;   -- 'onboarding' = R1 marcada pelo cliente
alter table public.clientes add column if not exists onboarding_token text;
alter table public.clientes add column if not exists onboarding_enviado_em timestamptz;
alter table public.clientes add column if not exists formulario_em timestamptz;
create unique index if not exists clientes_onboarding_token_uidx on public.clientes (onboarding_token) where onboarding_token is not null;
update public.clientes set onboarding_token = encode(gen_random_bytes(24), 'hex') where onboarding_token is null;

create or replace function public.clientes_token_onboarding() returns trigger language plpgsql as $$
begin
  if new.onboarding_token is null then new.onboarding_token := encode(gen_random_bytes(24), 'hex'); end if;
  return new;
end $$;
drop trigger if exists clientes_token_onboarding on public.clientes;
create trigger clientes_token_onboarding before insert on public.clientes for each row execute procedure public.clientes_token_onboarding();

-- ---------- modelos de mensagem (editáveis) ----------
create table if not exists public.mensagens_modelos (
  chave text primary key,
  titulo text not null,
  texto text not null,
  variaveis text,
  updated_at timestamptz not null default now()
);
alter table public.mensagens_modelos enable row level security;
drop policy if exists "modelos: equipe le" on public.mensagens_modelos;
create policy "modelos: equipe le" on public.mensagens_modelos for select to authenticated using (public.sou_equipe());
drop policy if exists "modelos: admin edita" on public.mensagens_modelos;
create policy "modelos: admin edita" on public.mensagens_modelos for update to authenticated using (public.sou_admin()) with check (public.sou_admin());

insert into public.mensagens_modelos (chave, titulo, texto, variaveis) values
('onb_boas_vindas', 'Onboarding — boas-vindas + formulário',
 E'Olá, {nome}! Aqui é da Neves Pádua Advocacia. Seja bem-vindo(a)! 🤝\n\nPara começarmos o seu acompanhamento, preencha o formulário de mapeamento (leva cerca de 10 minutos):\n{link}\n\nCom ele preparamos a sua primeira reunião de estratégia. Qualquer dúvida, é só responder por aqui.',
 '{nome} {link}'),
('onb_formulario_recebido', 'Onboarding — formulário recebido + agenda',
 E'Recebemos o seu formulário, {nome} — obrigado! ✅\n\nAgora escolha o melhor horário para a sua reunião de onboarding:\n{link}',
 '{nome} {link}'),
('onb_reuniao_confirmada', 'Onboarding — reunião confirmada',
 E'Reunião de onboarding confirmada para {data} às {hora}, com {responsavel}. 📅\n\nVamos apresentar a estratégia inicial e alinhar os próximos 30 dias.\nSe precisar remarcar: {link}',
 '{nome} {data} {hora} {responsavel} {link}'),
('onb_lembrete_dia', 'Onboarding — lembrete no dia',
 E'Bom dia, {nome}! Hoje às {hora} temos a sua reunião de onboarding com {responsavel}.\n{link_call}',
 '{nome} {hora} {responsavel} {link_call}'),
('onb_lembrete_1h', 'Onboarding — lembrete 1h antes',
 E'Em 1 hora: reunião de onboarding às {hora} com {responsavel}.\n{link_call}',
 '{nome} {hora} {responsavel} {link_call}')
on conflict (chave) do nothing;

create or replace function public.modelo_texto(p_chave text, p_vars jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text; k text; v text;
begin
  select texto into t from public.mensagens_modelos where chave = p_chave;
  if t is null then return null; end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    t := replace(t, '{' || k || '}', coalesce(v, ''));
  end loop;
  return t;
end $$;

-- ---------- fila de mensagens para clientes ----------
create table if not exists public.mensagens_fila (
  id bigserial primary key,
  cliente_id text references public.clientes(id) on delete cascade,
  nome text,
  numero text,
  modelo text,
  vars jsonb not null default '{}'::jsonb,
  texto text,                                   -- texto final (preenchido na hora de enviar, ou fixo)
  evento_id uuid references public.agenda_eventos(id) on delete cascade,
  referencia text,                              -- ex.: onboarding:boas_vindas
  enviar_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente','processando','enviada','erro','cancelada')),
  tentativas integer not null default 0,
  resultado text,
  enviada_em timestamptz,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists mensagens_fila_pend_idx on public.mensagens_fila (enviar_em) where status = 'pendente';
create index if not exists mensagens_fila_cli_idx on public.mensagens_fila (cliente_id, created_at desc);
alter table public.mensagens_fila enable row level security;
drop policy if exists "fila: equipe le" on public.mensagens_fila;
create policy "fila: equipe le" on public.mensagens_fila for select to authenticated using (public.sou_equipe());
drop policy if exists "fila: equipe cancela" on public.mensagens_fila;
create policy "fila: equipe cancela" on public.mensagens_fila for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- WhatsApp do cliente: contato principal → qualquer contato com telefone → ficha (dados)
create or replace function public.cliente_whatsapp(p_cliente text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(regexp_replace(ct.telefone, '[^0-9+]', '', 'g'), '') from public.contatos ct where ct.cliente_id = p_cliente and ct.telefone is not null order by ct.principal desc nulls last, ct.created_at limit 1),
    (select nullif(regexp_replace(coalesce(c.dados->>'whatsapp', c.dados->>'celular', c.dados->>'telefone', c.dados->>'representanteTelefone'), '[^0-9+]', '', 'g'), '') from public.clientes c where c.id = p_cliente))
$$;

create or replace function public.cliente_primeiro_nome(p_cliente text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    split_part((select ct.nome from public.contatos ct where ct.cliente_id = p_cliente and nullif(ct.nome,'') is not null order by ct.principal desc nulls last, ct.created_at limit 1), ' ', 1),
    split_part((select nullif(c.representante,'') from public.clientes c where c.id = p_cliente), ' ', 1),
    (select coalesce(c.nome_fantasia, c.dados->>'nome') from public.clientes c where c.id = p_cliente))
$$;

create or replace function public.painel_url() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PAINEL_URL' limit 1), 'https://nevespaduaadv.github.io/painel')
$$;
revoke all on function public.painel_url() from public, anon;

-- enfileira uma mensagem de modelo para o cliente
create or replace function public.mensagem_enfileirar(p_cliente text, p_modelo text, p_vars jsonb default '{}'::jsonb, p_quando timestamptz default now(), p_referencia text default null, p_evento uuid default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare num text; nome text; id_ bigint;
begin
  num := public.cliente_whatsapp(p_cliente);
  nome := public.cliente_primeiro_nome(p_cliente);
  insert into public.mensagens_fila (cliente_id, nome, numero, modelo, vars, referencia, evento_id, enviar_em, status, resultado)
  values (p_cliente, nome, num, p_modelo, coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('nome', nome), p_referencia, p_evento, p_quando,
          case when num is null then 'erro' else 'pendente' end, case when num is null then 'Cliente sem WhatsApp cadastrado (contatos/ficha).' end)
  returning id into id_;
  if num is null then
    perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = p_cliente), 'Mensagem não enviada: cliente sem WhatsApp',
      coalesce((select coalesce(nome_fantasia, dados->>'nome') from public.clientes where id = p_cliente), p_cliente) || ' — cadastre o contato principal com telefone', '#clientes/' || p_cliente);
  end if;
  return id_;
end $$;
revoke all on function public.mensagem_enfileirar(text, text, jsonb, timestamptz, text, uuid) from public, anon;

-- texto final na hora do envio (resolve o link da call do compromisso, se houver)
create or replace function public.mensagem_texto(m public.mensagens_fila) returns text
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := m.vars; ev record;
begin
  if m.texto is not null then return m.texto; end if;
  if m.evento_id is not null then
    select * into ev from public.agenda_eventos where id = m.evento_id;
    if found then
      v := v || jsonb_build_object('hora', to_char(ev.inicio at time zone 'America/Sao_Paulo', 'HH24:MI'), 'data', to_char(ev.inicio at time zone 'America/Sao_Paulo', 'DD/MM'),
             'link_call', case when nullif(ev.link,'') is not null and ev.link not like '#%' then 'Link da reunião: ' || ev.link
                               when nullif(ev.local,'') is not null then 'Local: ' || ev.local
                               else 'O link da chamada será enviado por aqui antes do horário.' end);
    end if;
  end if;
  return public.modelo_texto(m.modelo, v);
end $$;

create or replace function public.mensagens_reservar(token text, limite integer default 5) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  update public.mensagens_fila set status = 'pendente', atualizado_em = now() where status = 'processando' and atualizado_em < now() - interval '10 minutes';
  -- lembretes de compromisso cancelado não saem
  update public.mensagens_fila m set status = 'cancelada', resultado = 'Compromisso cancelado', atualizado_em = now()
  from public.agenda_eventos e where m.evento_id = e.id and m.status = 'pendente' and e.cancelado;
  if not public.em_horario_comercial(now()) then return '[]'::jsonb; end if;
  with esc as (
    select id from public.mensagens_fila where status = 'pendente' and enviar_em <= now() and numero is not null
    order by enviar_em limit greatest(1, least(coalesce(limite, 5), 20)) for update skip locked
  ), res_ as (
    update public.mensagens_fila m set status = 'processando', tentativas = m.tentativas + 1, atualizado_em = now(), texto = public.mensagem_texto(m)
    from esc where m.id = esc.id returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nome', coalesce(r.nome, 'Cliente'), 'numero', r.numero, 'texto', r.texto)), '[]'::jsonb) into res from res_ r;
  return res;
end $$;
revoke all on function public.mensagens_reservar(text, integer) from public, anon, authenticated;
grant execute on function public.mensagens_reservar(text, integer) to service_role;

create or replace function public.mensagens_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; m public.mensagens_fila;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for it in select value from jsonb_array_elements(coalesce(resultados, '[]'::jsonb)) loop
    select * into m from public.mensagens_fila where id = (it->>'id')::bigint and status = 'processando';
    continue when not found;
    if coalesce((it->>'ok')::boolean, false) then
      update public.mensagens_fila set status = 'enviada', enviada_em = now(), resultado = it->>'descricao', atualizado_em = now() where id = m.id;
      if m.cliente_id is not null then
        insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
        values (m.cliente_id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'WhatsApp enviado: ' || coalesce((select titulo from public.mensagens_modelos where chave = m.modelo), m.modelo, 'mensagem'), false, true, 'onboarding');
      end if;
    elsif coalesce((it->>'temporario')::boolean, false) and m.tentativas < 3 then
      update public.mensagens_fila set status = 'pendente', enviar_em = now() + interval '5 minutes', resultado = it->>'erro', atualizado_em = now() where id = m.id;
    else
      update public.mensagens_fila set status = 'erro', resultado = it->>'erro', atualizado_em = now() where id = m.id;
      perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = m.cliente_id), 'WhatsApp não enviado',
        coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#clientes/' || coalesce(m.cliente_id, ''));
    end if;
  end loop;
end $$;
revoke all on function public.mensagens_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.mensagens_registrar(text, jsonb) to service_role;

-- ---------- (b) boas-vindas 5 min depois do cadastro ----------
create or replace function public.onboarding_enviar_boas_vindas(p_cliente text, p_em timestamptz default now() + interval '5 minutes') returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.clientes; id_ bigint;
begin
  select * into c from public.clientes where id = p_cliente;
  if c.onboarding_token is null then update public.clientes set onboarding_token = encode(gen_random_bytes(24), 'hex') where id = p_cliente returning * into c; end if;
  update public.mensagens_fila set status = 'cancelada', resultado = 'Reenviado', atualizado_em = now() where cliente_id = p_cliente and referencia = 'onboarding:boas_vindas' and status = 'pendente';
  id_ := public.mensagem_enfileirar(p_cliente, 'onb_boas_vindas', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token), p_em, 'onboarding:boas_vindas');
  update public.clientes set onboarding_enviado_em = p_em, etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 2) where id = p_cliente;
  return id_;
end $$;
revoke all on function public.onboarding_enviar_boas_vindas(text, timestamptz) from public, anon;
grant execute on function public.onboarding_enviar_boas_vindas(text, timestamptz) to authenticated;

create or replace function public.clientes_boas_vindas_auto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.ativo, true) then perform public.onboarding_enviar_boas_vindas(new.id); end if;
  return new;
end $$;
drop trigger if exists clientes_boas_vindas_auto on public.clientes;
create trigger clientes_boas_vindas_auto after insert on public.clientes for each row execute procedure public.clientes_boas_vindas_auto();

-- tarefas do cliente novo: títulos alinhados ao fluxo automatizado (mesma lógica de 0010)
create or replace function public.fluxo_novo_cliente() returns trigger language plpgsql security definer set search_path = public as $$
declare novo boolean := (tg_op = 'INSERT');
        virou_divida boolean := (tg_op = 'UPDATE' and coalesce(new.tem_divida_atraso,false) and not coalesce(old.tem_divida_atraso,false));
        resp_onb uuid; resp_jur uuid; resp_aco uuid;
begin
  if not (novo or virou_divida) then return new; end if;
  resp_onb := public.responsavel_padrao('acompanhamento_pj'); resp_jur := public.responsavel_padrao('juridico'); resp_aco := public.responsavel_padrao('acordos');
  if novo then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Onboarding: conferir cadastro, contato principal e boas-vindas (D0)', E'O sistema envia as boas-vindas com o link do formulário 5 min após o cadastro (precisa do WhatsApp no contato principal).\nConfira a ficha, a pasta no Drive e o dossiê (gravações/transcrições do fechamento).', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 2, 1),
           ('Onboarding: iniciar auditoria ONB (dossiê, gravações, promessas da venda)', 'Comece antes de o formulário voltar. Ao receber o formulário, o sistema abre a tarefa de conferência e envia a agenda ao cliente.', new.id, coalesce(new.responsavel_onboarding_id, resp_onb), 'acompanhamento_pj', current_date + 5, 2),
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

-- ---------- (c) formulário de mapeamento ----------
create table if not exists public.onboarding_respostas (
  id bigserial primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  respostas jsonb not null,
  enviado_em timestamptz not null default now(),
  conferido_em timestamptz,
  conferido_por uuid
);
create index if not exists onboarding_respostas_cli_idx on public.onboarding_respostas (cliente_id, enviado_em desc);
alter table public.onboarding_respostas enable row level security;
drop policy if exists "onb: equipe le" on public.onboarding_respostas;
create policy "onb: equipe le" on public.onboarding_respostas for select to authenticated using (public.sou_equipe());
drop policy if exists "onb: equipe confere" on public.onboarding_respostas;
create policy "onb: equipe confere" on public.onboarding_respostas for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

create or replace function public.onboarding_cliente_por_token(t text) returns public.clientes
language sql stable security definer set search_path = public as $$
  select * from public.clientes where onboarding_token = t and length(coalesce(t,'')) >= 32 and coalesce(ativo, true)
$$;
revoke all on function public.onboarding_cliente_por_token(text) from public, anon, authenticated;

-- o que a página pública mostra
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
    'reuniao', case when ev.id is null then null else jsonb_build_object('id', ev.id, 'inicio', ev.inicio, 'link', case when ev.link like '#%' then null else ev.link end) end);
end $$;
revoke all on function public.onboarding_contexto(text) from public;
grant execute on function public.onboarding_contexto(text) to anon, authenticated;

create or replace function public.onboarding_responder(t text, r jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; resp uuid; tid uuid; k text; dsc text;
  simnao text[] := array['sim','true','1'];
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then raise exception 'Link inválido.' using errcode = '28000'; end if;
  if r is null or jsonb_typeof(r) <> 'object' then raise exception 'Respostas inválidas.'; end if;
  if length(r::text) > 60000 then raise exception 'Respostas muito longas.'; end if;
  insert into public.onboarding_respostas (cliente_id, respostas) values (c.id, r);

  -- espelho na ficha (só os campos que existem)
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

  -- bens declarados
  for k, dsc in select * from (values ('veiculo', r->>'veiculos'), ('imovel', r->>'imoveis'), ('maquinario', r->>'maquinario'), ('outro', r->>'quais_ativos')) v(tipo, descricao) loop
    if nullif(trim(dsc), '') is not null and lower(trim(dsc)) not in ('não','nao','nenhum','nenhuma','-') then
      insert into public.bens (cliente_id, tipo, descricao, observacoes) values (c.id, k, left(dsc, 2000), 'Declarado no formulário de onboarding');
    end if;
  end loop;

  resp := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Onboarding: conferir o formulário de mapeamento — ' || coalesce(c.nome_fantasia, c.dados->>'nome', c.id),
          E'O cliente respondeu o formulário (aba Onboarding da ficha). Confira as respostas, complete a ficha/contratos e documente o que foi prometido na venda.\nO cliente já recebeu o link da agenda para marcar a R1.',
          c.id, resp, 'acompanhamento_pj', current_date + 2, 1) returning id into tid;
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
  values (c.id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'Formulário de mapeamento respondido pelo cliente', false, true, 'onboarding');
  perform public.mensagem_enfileirar(c.id, 'onb_formulario_recebido', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar'), now(), 'onboarding:formulario_recebido');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.onboarding_responder(text, jsonb) from public;
grant execute on function public.onboarding_responder(text, jsonb) to anon, authenticated;

-- ---------- (d) agendamento da R1 ----------
create or replace function public.dia_util(d date) returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from d) between 1 and 5
     and not exists (select 1 from public.feriados f where f.data = d and coalesce(f.ativo, true) and (f.uf is null or f.uf = 'SP') and (f.comarca is null or f.comarca = ''))
$$;
create or replace function public.somar_dias_uteis(d date, n integer) returns date language plpgsql stable security definer set search_path = public as $$
declare x date := d; i int := 0;
begin
  while i < n loop x := x + 1; if public.dia_util(x) then i := i + 1; end if; end loop;
  return x;
end $$;

-- horários livres do responsável: dias úteis, 09–12h e 14–17h (blocos de 1h), a partir de 2 dias úteis após o formulário/hoje, 15 dias úteis à frente
create or replace function public.onboarding_horarios(t text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; colab uuid; d0 date; d date; h int; ini_ timestamptz; fim_ timestamptz; out jsonb := '[]'::jsonb; n int := 0;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then return null; end if;
  colab := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  d0 := public.somar_dias_uteis(greatest((now() at time zone 'America/Sao_Paulo')::date, coalesce((c.formulario_em at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)), 2);
  d := d0;
  while n < 15 loop
    if public.dia_util(d) then
      n := n + 1;
      foreach h in array array[9,10,11,14,15,16] loop
        ini_ := (d::text || ' ' || lpad(h::text, 2, '0') || ':00')::timestamp at time zone 'America/Sao_Paulo';
        fim_ := ini_ + interval '1 hour';
        if ini_ > now() and not exists (select 1 from public.agenda_eventos e where e.colaborador_id = colab and not e.cancelado and (e.dia_inteiro and (e.inicio at time zone 'America/Sao_Paulo')::date = d or (not e.dia_inteiro and e.inicio < fim_ and e.fim > ini_))) then
          out := out || jsonb_build_object('inicio', ini_, 'dia', d, 'hora', lpad(h::text, 2, '0') || ':00');
        end if;
      end loop;
    end if;
    d := d + 1;
  end loop;
  return jsonb_build_object('responsavel', (select nome from public.colaboradores where id = colab), 'horarios', out);
end $$;
revoke all on function public.onboarding_horarios(text) from public;
grant execute on function public.onboarding_horarios(text) to anon, authenticated;

create or replace function public.onboarding_agendar(t text, p_inicio timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; colab uuid; resp_nome text; ev uuid; nome text; livre boolean; dia date; prep date; vars jsonb;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then raise exception 'Link inválido.' using errcode = '28000'; end if;
  select exists (select 1 from jsonb_array_elements(public.onboarding_horarios(t)->'horarios') x where (x->>'inicio')::timestamptz = p_inicio) into livre;
  if not livre then raise exception 'Esse horário não está mais disponível. Escolha outro.' using errcode = 'P0001';end if;
  colab := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  select co.nome into resp_nome from public.colaboradores co where co.id = colab;
  nome := coalesce(c.nome_fantasia, c.dados->>'nome', c.id);
  -- reagendamento: cancela o anterior e os lembretes dele
  update public.agenda_eventos set cancelado = true where cliente_id = c.id and tipo = 'reuniao' and finalidade = 'onboarding' and not cancelado and inicio > now();
  update public.mensagens_fila set status = 'cancelada', resultado = 'Reagendado', atualizado_em = now() where cliente_id = c.id and referencia like 'onboarding:reuniao%' and status = 'pendente';

  insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, cliente_id, tipo, origem, finalidade, descricao, link, cancelado)
  values ('Onboarding (R1): ' || nome, p_inicio, p_inicio + interval '1 hour', false, colab, c.id, 'reuniao', 'painel', 'onboarding',
          E'Reunião de onboarding marcada pelo cliente pela página de agendamento.\nPreencha o campo Link com o link da chamada: ele vai nos lembretes do cliente.', null, false)
  returning id into ev;
  dia := (p_inicio at time zone 'America/Sao_Paulo')::date;
  prep := dia - 1; while not public.dia_util(prep) loop prep := prep - 1; end loop;
  update public.clientes set proxima_reuniao = dia, data_onboarding = coalesce(data_onboarding, dia), etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 5) where id = c.id;
  update public.tarefas set status = 'concluida', concluida_em = now() where cliente_id = c.id and titulo like 'Onboarding: preparar R1%' and status in ('aberta','em_andamento');
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Onboarding: preparar R1 de ' || to_char(dia, 'DD/MM') || ' — ' || nome,
          E'Obrigatório antes da reunião: (1) estratégia e orientações iniciais definidas; (2) slides de apresentação; (3) pauta estruturada.\nColoque o link da chamada no compromisso da Agenda — ele vai automaticamente nos lembretes do cliente (8h30 do dia e 1h antes).',
          c.id, colab, 'acompanhamento_pj', prep, 1);
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
  values (c.id, (now() at time zone 'America/Sao_Paulo')::date, 'reuniao_cliente', 'R1 (onboarding) agendada pelo cliente para ' || to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), true, true, 'onboarding');

  vars := jsonb_build_object('responsavel', split_part(coalesce(resp_nome, 'nossa equipe'), ' ', 1), 'link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar');
  perform public.mensagem_enfileirar(c.id, 'onb_reuniao_confirmada', vars, now(), 'onboarding:reuniao_confirmada', ev);
  perform public.mensagem_enfileirar(c.id, 'onb_lembrete_dia', vars, (dia::text || ' 08:30')::timestamp at time zone 'America/Sao_Paulo', 'onboarding:reuniao_lembrete_dia', ev);
  perform public.mensagem_enfileirar(c.id, 'onb_lembrete_1h', vars, p_inicio - interval '1 hour', 'onboarding:reuniao_lembrete_1h', ev);
  perform public.notificar_colaborador(colab, 'R1 agendada pelo cliente', nome || ' — ' || to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#agenda');
  return jsonb_build_object('ok', true, 'inicio', p_inicio, 'responsavel', resp_nome);
end $$;
revoke all on function public.onboarding_responder(text, jsonb) from public;
revoke all on function public.onboarding_agendar(text, timestamptz) from public;
grant execute on function public.onboarding_agendar(text, timestamptz) to anon, authenticated;

-- lembretes/confirmação acompanham mudança de horário feita pela equipe (painel/Google)
create or replace function public.onboarding_evento_alterado() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.finalidade = 'onboarding' and new.inicio <> old.inicio and not new.cancelado then
    update public.mensagens_fila set enviar_em = case referencia when 'onboarding:reuniao_lembrete_dia' then ((new.inicio at time zone 'America/Sao_Paulo')::date::text || ' 08:30')::timestamp at time zone 'America/Sao_Paulo'
                                                             when 'onboarding:reuniao_lembrete_1h' then new.inicio - interval '1 hour' else enviar_em end, atualizado_em = now()
    where evento_id = new.id and status = 'pendente';
    update public.clientes set proxima_reuniao = (new.inicio at time zone 'America/Sao_Paulo')::date where id = new.cliente_id;
  end if;
  return new;
end $$;
drop trigger if exists onboarding_evento_alterado on public.agenda_eventos;
create trigger onboarding_evento_alterado after update of inicio, cancelado on public.agenda_eventos for each row execute procedure public.onboarding_evento_alterado();

-- ---------- views para a ficha ----------
create or replace view public.v_onboarding_cliente with (security_invoker = true) as
select c.id as cliente_id, c.onboarding_token, c.onboarding_enviado_em, c.formulario_em, c.proxima_reuniao,
       (select r.respostas from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as respostas,
       (select r.conferido_em from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as conferido_em,
       (select jsonb_build_object('id', e.id, 'inicio', e.inicio, 'link', e.link, 'colaborador', co.nome) from public.agenda_eventos e left join public.colaboradores co on co.id = e.colaborador_id
          where e.cliente_id = c.id and e.finalidade = 'onboarding' and not e.cancelado order by e.inicio desc limit 1) as reuniao,
       (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'modelo', m.modelo, 'titulo', mm.titulo, 'enviar_em', m.enviar_em, 'status', m.status, 'resultado', m.resultado, 'enviada_em', m.enviada_em, 'numero', m.numero) order by m.enviar_em desc), '[]'::jsonb)
          from public.mensagens_fila m left join public.mensagens_modelos mm on mm.chave = m.modelo where m.cliente_id = c.id) as mensagens
from public.clientes c;

select 'ok 0052' as resultado;
