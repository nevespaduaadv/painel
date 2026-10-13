-- 0055 — Financeiro com Asaas: cobranças (entrada, parcelas, êxito) espelhadas do Asaas, criadas pelo sistema, baixa automática
-- por webhook, inadimplência na ficha do cliente e régua de cobrança por WhatsApp (fila de 0052). Segredos no Vault:
-- ASAAS_API_KEY (chave da API), ASAAS_WEBHOOK_TOKEN (token que o Asaas manda no cabeçalho asaas-access-token), ASAAS_AMBIENTE (producao|sandbox).
-- Idempotente. Depende de 0052 (mensagens_fila/modelos), 0051 (helpers), 0044 (perfis.acessos), 0047 (segredo_definir).

-- ---------- segredos: aceitar ASAAS_* ----------
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|ASAAS_[A-Z_]+|ZAPSIGN_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;
create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|WINDSOR_[A-Z_]+|ANTHROPIC_[A-Z_]+|META_[A-Z_]+|GOOGLE_[A-Z_]+|ASAAS_[A-Z_]+|ZAPSIGN_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;

-- ---------- permissão ----------
create or replace function public.pode_financeiro() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.papel = 'admin' or 'financeiro' = any(coalesce(p.acessos, '{}')) from public.perfis p where p.id = auth.uid()), false)
$$;
grant execute on function public.pode_financeiro() to authenticated;

-- ---------- configuração ----------
insert into public.escritorio (id, dados) values ('financeiro', '{"regua_whatsapp": false, "importar_desde_meses": 12}'::jsonb) on conflict (id) do nothing;
drop policy if exists "escritorio: financeiro edita" on public.escritorio;
create policy "escritorio: financeiro edita" on public.escritorio for update to authenticated using (id = 'financeiro' and public.pode_financeiro()) with check (id = 'financeiro' and public.pode_financeiro());

-- ---------- tabelas ----------
create table if not exists public.asaas_clientes (
  cliente_id text primary key references public.clientes(id) on delete cascade,
  asaas_id text not null unique,
  cpf_cnpj text, nome text, email text, telefone text,
  atualizado_em timestamptz not null default now()
);
alter table public.asaas_clientes enable row level security;
drop policy if exists "asaas_clientes: financeiro le" on public.asaas_clientes;
create policy "asaas_clientes: financeiro le" on public.asaas_clientes for select to authenticated using (public.pode_financeiro());

create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  asaas_id text unique,
  cliente_id text references public.clientes(id) on delete set null,
  contrato_id text references public.contratos(id) on delete set null,
  acordo_id uuid references public.acordos(id) on delete set null,
  tipo text not null default 'outro' check (tipo in ('entrada','parcela','exito','mensalidade','outro')),
  descricao text,
  valor numeric not null default 0,
  valor_liquido numeric,
  valor_pago numeric,
  vencimento date,
  vencimento_original date,
  pago_em date,
  status text not null default 'pendente' check (status in ('pendente','paga','atrasada','estornada','cancelada','outra')),
  status_asaas text,
  forma text,                        -- BOLETO | PIX | CREDIT_CARD | UNDEFINED
  parcela integer, total_parcelas integer, parcelamento_id text,
  link_fatura text, link_boleto text, pix_copia_cola text,
  asaas_cliente_id text,
  origem text not null default 'asaas' check (origem in ('asaas','painel')),
  regua_enviadas text[] not null default '{}',
  regua_parada boolean not null default false,
  observacoes text,
  dados jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  created_by uuid
);
create index if not exists cobrancas_cliente_idx on public.cobrancas (cliente_id, vencimento desc);
create index if not exists cobrancas_status_idx on public.cobrancas (status, vencimento);
alter table public.cobrancas enable row level security;
drop policy if exists "cobrancas: financeiro le" on public.cobrancas;
create policy "cobrancas: financeiro le" on public.cobrancas for select to authenticated using (public.pode_financeiro() or (public.sou_equipe() and cliente_id is not null));
drop policy if exists "cobrancas: financeiro edita" on public.cobrancas;
create policy "cobrancas: financeiro edita" on public.cobrancas for update to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());

create table if not exists public.asaas_eventos (
  id bigserial primary key,
  evento text, asaas_id text, payload jsonb, recebido_em timestamptz not null default now(), processado boolean not null default false, erro text
);
alter table public.asaas_eventos enable row level security;
drop policy if exists "asaas_eventos: financeiro le" on public.asaas_eventos;
create policy "asaas_eventos: financeiro le" on public.asaas_eventos for select to authenticated using (public.pode_financeiro());

create table if not exists public.asaas_sincronizacoes (
  id bigserial primary key, inicio timestamptz not null default now(), fim timestamptz, ok boolean, clientes integer, cobrancas integer, erro text, por uuid
);
alter table public.asaas_sincronizacoes enable row level security;
drop policy if exists "asaas_sinc: financeiro le" on public.asaas_sincronizacoes;
create policy "asaas_sinc: financeiro le" on public.asaas_sincronizacoes for select to authenticated using (public.pode_financeiro());

-- ---------- helpers ----------
create or replace function public.so_digitos(t text) returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(t,''), '\D', '', 'g'), '') $$;

create or replace function public.asaas_status_interno(s text, deletado boolean) returns text language sql immutable as $$
  select case when coalesce(deletado,false) then 'cancelada'
              when s in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH','DUNNING_RECEIVED') then 'paga'
              when s = 'PENDING' then 'pendente'
              when s = 'OVERDUE' then 'atrasada'
              when s in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL') then 'estornada'
              else 'outra' end
$$;

-- tipo pela descrição/externalReference (quando a cobrança vem do Asaas)
create or replace function public.cobranca_tipo_por_texto(t text) returns text language sql immutable as $$
  select case when t ~* 'êxito|exito' then 'exito'
              when t ~* 'entrada|sinal' then 'entrada'
              when t ~* 'parcela' then 'parcela'
              when t ~* 'mensal' then 'mensalidade'
              else 'outro' end
$$;

-- cliente do sistema para um customer do Asaas: vínculo gravado → externalReference → CPF/CNPJ
create or replace function public.asaas_cliente_do_sistema(p_asaas_cliente text, p_cpf_cnpj text, p_external text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select cliente_id from public.asaas_clientes where asaas_id = p_asaas_cliente),
    (select id from public.clientes where id = p_external),
    (select c.id from public.clientes c where public.so_digitos(p_cpf_cnpj) is not null
       and (public.so_digitos(c.cnpj) = public.so_digitos(p_cpf_cnpj) or public.so_digitos(c.cpf_titular) = public.so_digitos(p_cpf_cnpj) or public.so_digitos(c.dados->>'cnpj') = public.so_digitos(p_cpf_cnpj) or public.so_digitos(c.dados->>'cpf') = public.so_digitos(p_cpf_cnpj))
       order by coalesce(c.ativo, true) desc limit 1))
$$;

-- grava/atualiza uma cobrança a partir do objeto "payment" do Asaas
create or replace function public.asaas_upsert_cobranca(p jsonb, p_cpf_cnpj text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid text; id_ uuid; st text; tipo_ text; ext text := p->>'externalReference';
begin
  if p->>'id' is null then return null; end if;
  cid := public.asaas_cliente_do_sistema(p->>'customer', p_cpf_cnpj, split_part(coalesce(ext,''), '|', 1));
  st := public.asaas_status_interno(p->>'status', (p->>'deleted')::boolean);
  tipo_ := coalesce(nullif(split_part(coalesce(ext,''), '|', 2), ''), public.cobranca_tipo_por_texto(coalesce(p->>'description','')));
  if tipo_ not in ('entrada','parcela','exito','mensalidade','outro') then tipo_ := 'outro'; end if;
  insert into public.cobrancas (asaas_id, cliente_id, tipo, descricao, valor, valor_liquido, valor_pago, vencimento, vencimento_original, pago_em, status, status_asaas, forma,
                                parcela, total_parcelas, parcelamento_id, link_fatura, link_boleto, asaas_cliente_id, origem, dados, atualizado_em)
  values (p->>'id', cid, tipo_, p->>'description', coalesce((p->>'value')::numeric, 0), (p->>'netValue')::numeric,
          case when st = 'paga' then coalesce((p->>'value')::numeric, 0) end,
          (p->>'dueDate')::date, coalesce((p->>'originalDueDate')::date, (p->>'dueDate')::date),
          coalesce((p->>'clientPaymentDate')::date, (p->>'paymentDate')::date, (p->>'confirmedDate')::date),
          st, p->>'status', p->>'billingType', (p->>'installmentNumber')::int, null, p->>'installment', p->>'invoiceUrl', p->>'bankSlipUrl', p->>'customer', 'asaas', p, now())
  on conflict (asaas_id) do update set
    cliente_id = coalesce(cobrancas.cliente_id, excluded.cliente_id),
    tipo = case when cobrancas.origem = 'painel' then cobrancas.tipo else excluded.tipo end,
    descricao = coalesce(excluded.descricao, cobrancas.descricao), valor = excluded.valor, valor_liquido = excluded.valor_liquido,
    valor_pago = excluded.valor_pago, vencimento = excluded.vencimento, vencimento_original = excluded.vencimento_original, pago_em = excluded.pago_em,
    status = excluded.status, status_asaas = excluded.status_asaas, forma = excluded.forma, parcela = coalesce(excluded.parcela, cobrancas.parcela),
    parcelamento_id = coalesce(excluded.parcelamento_id, cobrancas.parcelamento_id), link_fatura = coalesce(excluded.link_fatura, cobrancas.link_fatura),
    link_boleto = coalesce(excluded.link_boleto, cobrancas.link_boleto), asaas_cliente_id = excluded.asaas_cliente_id, dados = excluded.dados, atualizado_em = now()
  returning id into id_;
  return id_;
end $$;
revoke all on function public.asaas_upsert_cobranca(jsonb, text) from public, anon, authenticated;

-- lote da sincronização (Edge): clientes do Asaas + cobranças
create or replace function public.asaas_sincronizar_gravar(token text, clientes jsonb, cobrancas jsonb, p_erro text default null, p_por uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; p jsonb; nc int := 0; np int := 0; cid text; doc text;
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for c in select value from jsonb_array_elements(coalesce(clientes, '[]'::jsonb)) loop
    cid := public.asaas_cliente_do_sistema(c->>'id', c->>'cpfCnpj', c->>'externalReference');
    if cid is not null then
      insert into public.asaas_clientes (cliente_id, asaas_id, cpf_cnpj, nome, email, telefone, atualizado_em)
      values (cid, c->>'id', c->>'cpfCnpj', c->>'name', c->>'email', coalesce(c->>'mobilePhone', c->>'phone'), now())
      on conflict (cliente_id) do update set asaas_id = excluded.asaas_id, cpf_cnpj = excluded.cpf_cnpj, nome = excluded.nome, email = excluded.email, telefone = excluded.telefone, atualizado_em = now();
      nc := nc + 1;
    end if;
  end loop;
  for p in select value from jsonb_array_elements(coalesce(cobrancas, '[]'::jsonb)) loop
    select cl->>'cpfCnpj' into doc from jsonb_array_elements(coalesce(clientes, '[]'::jsonb)) cl where cl->>'id' = p->>'customer' limit 1;
    perform public.asaas_upsert_cobranca(p, doc);
    np := np + 1;
  end loop;
  insert into public.asaas_sincronizacoes (fim, ok, clientes, cobrancas, erro, por) values (now(), p_erro is null, nc, np, p_erro, p_por);
  return jsonb_build_object('clientes', nc, 'cobrancas', np);
end $$;
revoke all on function public.asaas_sincronizar_gravar(text, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.asaas_sincronizar_gravar(text, jsonb, jsonb, text, uuid) to service_role;

-- webhook (Edge já validou o token do cabeçalho)
create or replace function public.asaas_webhook_gravar(corpo jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare id_ uuid; ev text := corpo->>'event'; p jsonb := corpo->'payment';
begin
  if coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' <> 'service_role' then raise exception 'Acesso negado.' using errcode = '28000'; end if;
  insert into public.asaas_eventos (evento, asaas_id, payload) values (ev, p->>'id', corpo);
  if p is not null and ev like 'PAYMENT_%' then
    id_ := public.asaas_upsert_cobranca(p);
    update public.asaas_eventos set processado = true where id = currval('public.asaas_eventos_id_seq');
  end if;
  return jsonb_build_object('ok', true, 'cobranca', id_);
end $$;
revoke all on function public.asaas_webhook_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.asaas_webhook_gravar(jsonb) to service_role;

-- dados para criar o cliente/cobrança no Asaas (Edge, com a sessão do usuário)
create or replace function public.asaas_dados_cliente(p_cliente text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; a public.asaas_clientes;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  select * into c from public.clientes where id = p_cliente;
  if c.id is null then return null; end if;
  select * into a from public.asaas_clientes where cliente_id = p_cliente;
  return jsonb_build_object('cliente_id', c.id, 'asaas_id', a.asaas_id,
    'nome', coalesce(c.dados->>'razaoSocial', c.dados->>'nome', c.nome_fantasia),
    'cpf_cnpj', coalesce(public.so_digitos(c.cnpj), public.so_digitos(c.dados->>'cnpj'), public.so_digitos(c.cpf_titular), public.so_digitos(c.dados->>'cpf')),
    'email', coalesce(c.dados->>'email', (select ct.email from public.contatos ct where ct.cliente_id = c.id and nullif(ct.email,'') is not null order by ct.principal desc nulls last limit 1)),
    'telefone', public.cliente_whatsapp(c.id));
end $$;
grant execute on function public.asaas_dados_cliente(text) to authenticated;

create or replace function public.asaas_cliente_gravar(p_cliente text, p_asaas jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  insert into public.asaas_clientes (cliente_id, asaas_id, cpf_cnpj, nome, email, telefone)
  values (p_cliente, p_asaas->>'id', p_asaas->>'cpfCnpj', p_asaas->>'name', p_asaas->>'email', coalesce(p_asaas->>'mobilePhone', p_asaas->>'phone'))
  on conflict (cliente_id) do update set asaas_id = excluded.asaas_id, cpf_cnpj = excluded.cpf_cnpj, nome = excluded.nome, email = excluded.email, telefone = excluded.telefone, atualizado_em = now();
end $$;
grant execute on function public.asaas_cliente_gravar(text, jsonb) to authenticated;

-- cobrança criada pelo painel: grava o retorno do Asaas já com cliente/tipo/contrato
create or replace function public.asaas_cobranca_gravar(p_cliente text, p_tipo text, p_contrato text, p_acordo uuid, p_pagamentos jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare p jsonb; n int := 0; id_ uuid; tot int;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  tot := jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb));
  for p in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) loop
    id_ := public.asaas_upsert_cobranca(p);
    update public.cobrancas set cliente_id = p_cliente, tipo = p_tipo, contrato_id = p_contrato, acordo_id = p_acordo, origem = 'painel', created_by = auth.uid(),
      total_parcelas = case when tot > 1 then tot else total_parcelas end where id = id_;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.asaas_cobranca_gravar(text, text, text, uuid, jsonb) to authenticated;

-- ---------- efeitos: timeline, adimplência, régua ----------
create or replace function public.cobrancas_efeitos() returns trigger language plpgsql security definer set search_path = public as $$
declare nome text; em_atraso boolean;
begin
  if new.cliente_id is null then return new; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.cliente_id is distinct from old.cliente_id then
    if new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then
      insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte, id_externo)
      select new.cliente_id, coalesce(new.pago_em, current_date), 'outro', 'Pagamento recebido: ' || coalesce(new.descricao, initcap(new.tipo)) || ' — ' || public.brl(coalesce(new.valor_pago, new.valor)), true, true, 'asaas', 'cob:' || new.id::text
      where not exists (select 1 from public.entradas_timeline t where t.id_externo = 'cob:' || new.id::text);
      update public.mensagens_fila set status = 'cancelada', resultado = 'Pagamento recebido', atualizado_em = now() where referencia = 'cobranca:' || new.id::text and status = 'pendente';
      update public.tarefas set status = 'concluida', concluida_em = now() where titulo like 'Cobrança manual%' and descricao like '%' || new.id::text || '%' and status in ('aberta','em_andamento');
    end if;
    if new.status in ('cancelada','estornada') then
      update public.mensagens_fila set status = 'cancelada', resultado = 'Cobrança ' || new.status, atualizado_em = now() where referencia = 'cobranca:' || new.id::text and status = 'pendente';
    end if;
    -- adimplência do cliente: sem cobrança atrasada
    select exists (select 1 from public.cobrancas x where x.cliente_id = new.cliente_id and x.status = 'atrasada' and x.id <> new.id) or new.status = 'atrasada' into em_atraso;
    update public.clientes set adimplente = not em_atraso where id = new.cliente_id and adimplente is distinct from (not em_atraso);
  end if;
  return new;
end $$;
drop trigger if exists cobrancas_efeitos on public.cobrancas;
create trigger cobrancas_efeitos after insert or update of status, cliente_id on public.cobrancas for each row execute procedure public.cobrancas_efeitos();

-- modelos da régua
insert into public.mensagens_modelos (chave, titulo, texto, variaveis) values
('cob_lembrete_3d', 'Cobrança — 3 dias antes', E'Olá, {nome}! Passando para lembrar: a {descricao} de {valor} vence em {vencimento}.\n{link}\nQualquer dúvida, é só responder por aqui. 🙂', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_vencimento', 'Cobrança — no dia', E'Olá, {nome}! A {descricao} de {valor} vence hoje ({vencimento}).\n{link}\nSe já pagou, desconsidere esta mensagem.', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_atraso_1', 'Cobrança — 1 dia de atraso', E'Olá, {nome}. Não identificamos o pagamento da {descricao} de {valor}, vencida em {vencimento}.\n{link}\nSe precisar de uma nova data ou já tiver pago, nos avise por aqui.', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_atraso_5', 'Cobrança — 5 dias de atraso', E'Olá, {nome}. A {descricao} de {valor} está em aberto desde {vencimento}.\n{link}\nPodemos conversar sobre a melhor forma de regularizar? É só responder esta mensagem.', '{nome} {descricao} {valor} {vencimento} {link}'),
('cob_atraso_10', 'Cobrança — 10 dias de atraso', E'Olá, {nome}. A {descricao} de {valor} (vencimento {vencimento}) segue em aberto.\n{link}\nNossa equipe financeira vai entrar em contato para alinhar a regularização.', '{nome} {descricao} {valor} {vencimento} {link}')
on conflict (chave) do nothing;

create or replace function public.cobrancas_regua() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; n int := 0; passo text; dias int; vars jsonb; resp uuid;
begin
  if not coalesce((select (dados->>'regua_whatsapp')::boolean from public.escritorio where id = 'financeiro'), false) then return 0; end if;
  for r in
    select c.*, coalesce(cl.nome_fantasia, cl.dados->>'nome') as cliente_nome
    from public.cobrancas c join public.clientes cl on cl.id = c.cliente_id
    where c.status in ('pendente','atrasada') and not c.regua_parada and c.vencimento is not null and coalesce(cl.status,'ativo') = 'ativo'
      and c.vencimento between hoje - 10 and hoje + 3
    order by c.vencimento
  loop
    dias := hoje - r.vencimento;   -- negativo = antes do vencimento
    passo := case dias when -3 then 'cob_lembrete_3d' when 0 then 'cob_vencimento' when 1 then 'cob_atraso_1' when 5 then 'cob_atraso_5' when 10 then 'cob_atraso_10' else null end;
    continue when passo is null or passo = any(r.regua_enviadas);
    -- uma mensagem de cobrança por cliente por dia
    continue when exists (select 1 from public.mensagens_fila m where m.cliente_id = r.cliente_id and m.referencia like 'cobranca:%' and (m.enviar_em at time zone 'America/Sao_Paulo')::date = hoje and m.status <> 'cancelada');
    vars := jsonb_build_object('descricao', coalesce(nullif(r.descricao,''), case r.tipo when 'entrada' then 'entrada dos honorários' when 'parcela' then 'parcela ' || coalesce(r.parcela::text,'') when 'exito' then 'cobrança de êxito' when 'mensalidade' then 'mensalidade' else 'cobrança' end),
                               'valor', public.brl(r.valor), 'vencimento', to_char(r.vencimento, 'DD/MM'),
                               'link', coalesce('Boleto/Pix: ' || coalesce(r.link_fatura, r.link_boleto), ''));
    perform public.mensagem_enfileirar(r.cliente_id, passo, vars, now(), 'cobranca:' || r.id::text);
    update public.cobrancas set regua_enviadas = regua_enviadas || passo, regua_parada = (passo = 'cob_atraso_10') where id = r.id;
    if passo = 'cob_atraso_10' then
      resp := public.responsavel_padrao('administrativo');
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Cobrança manual: ' || r.cliente_nome || ' — ' || public.brl(r.valor), 'Cobrança ' || coalesce(r.descricao, r.tipo) || ' vencida em ' || to_char(r.vencimento,'DD/MM/YYYY') || ' sem pagamento após a régua automática (3 dias antes, no dia, +1, +5, +10). Entre em contato e registre o combinado. Ref. ' || r.id::text,
              r.cliente_id, resp, 'administrativo', hoje + 1, 1);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cobrancas_regua() from public, anon, authenticated;

create or replace function public.configurar_regua_cobranca(hora_brt integer default 9) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cobrancas-regua-np';
  perform cron.schedule('cobrancas-regua-np', format('10 %s * * 1-6', (hora_brt + 3) % 24), 'select public.cobrancas_regua()');
  return 'Régua de cobrança diária às ' || hora_brt || 'h10 (seg–sáb)';
end $$;
revoke all on function public.configurar_regua_cobranca(integer) from public, anon, authenticated;

-- sincronização diária com o Asaas (rede de segurança do webhook): 05:50 BRT, via Edge /asaas com o token das automações
create or replace function public.configurar_asaas_sincronizacao(hora_brt integer default 5) returns text
language plpgsql security definer set search_path = public as $$
declare cmd text; auth text; endpoint text;
begin
  select command into cmd from cron.job where jobname = 'automacoes-np';
  if cmd is null then raise exception 'Configure antes as automações (configurar_automacoes).'; end if;
  auth := substring(cmd from '''Authorization'', ''([^'']+)''');
  endpoint := regexp_replace(substring(cmd from 'url := ''([^'']+)'''), '/automacoes$', '/asaas');
  perform cron.unschedule(jobid) from cron.job where jobname = 'asaas-sinc-np';
  perform cron.schedule('asaas-sinc-np', format('50 %s * * *', (hora_brt + 3) % 24), format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L), body := '{"dias": 60}'::jsonb, timeout_milliseconds := 120000)$cmd$, endpoint, auth));
  return 'Sincronização diária do Asaas às ' || hora_brt || 'h50 em ' || endpoint;
end $$;
revoke all on function public.configurar_asaas_sincronizacao(integer) from public, anon, authenticated;

-- vínculo manual (cobrança do Asaas sem cliente): aplica ao customer inteiro
create or replace function public.asaas_vincular_manual(p_cliente text, p_asaas_cliente text, p_cobranca uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para o financeiro.' using errcode = '42501'; end if;
  if p_asaas_cliente is not null then
    insert into public.asaas_clientes (cliente_id, asaas_id) values (p_cliente, p_asaas_cliente)
    on conflict (cliente_id) do update set asaas_id = excluded.asaas_id, atualizado_em = now();
    update public.cobrancas set cliente_id = p_cliente where asaas_cliente_id = p_asaas_cliente and cliente_id is null;
  end if;
  update public.cobrancas set cliente_id = p_cliente where id = p_cobranca and cliente_id is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.asaas_vincular_manual(text, text, uuid) to authenticated;

-- ---------- views ----------
create or replace view public.v_cobrancas with (security_invoker = true) as
select c.*, coalesce(cl.nome_fantasia, cl.dados->>'nome') as cliente_nome, cl.status as cliente_status,
       case when c.status = 'atrasada' then (now() at time zone 'America/Sao_Paulo')::date - c.vencimento else null end as dias_atraso
from public.cobrancas c left join public.clientes cl on cl.id = c.cliente_id;

create or replace view public.v_financeiro_mes with (security_invoker = true) as
select to_char(coalesce(c.pago_em, c.vencimento), 'YYYY-MM') as mes,
       sum(c.valor) filter (where c.status in ('pendente','atrasada','paga')) as previsto,
       sum(coalesce(c.valor_pago, c.valor)) filter (where c.status = 'paga') as recebido,
       sum(c.valor) filter (where c.status = 'atrasada') as atrasado,
       count(*) filter (where c.status = 'paga') as n_pagas, count(*) filter (where c.status = 'atrasada') as n_atrasadas, count(*) filter (where c.status = 'pendente') as n_pendentes
from public.cobrancas c where c.status in ('pendente','atrasada','paga')
group by 1;

select public.configurar_regua_cobranca(9) as regua, public.configurar_asaas_sincronizacao(5) as sincronizacao;
