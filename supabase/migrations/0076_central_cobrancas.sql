-- 0076 — Central de Cobranças dentro do Financeiro (migração do artefato "Central de Cobranças").
-- Base: as cobranças já sincronizadas do Asaas (0055). Acrescenta:
--   • asaas_contatos: todos os clientes do Asaas (nome/telefone), mesmo sem ficha no sistema — a Central cobre toda a carteira
--   • cobranca_contatos: registro de contato da cadência de vencidas (Recuperado / Não responde / Verificar amanhã / Negociou)
--   • cobrancas.baixa_manual e vencimento_negociado (nova data acordada sem mexer no Asaas)
--   • cobranca_checks: "lembrete enviado" dos cards de pré-vencimento (D-5, D-2, D-0)
--   • regua_etapas (D-5, D-2, D-0, D+1 + personalizadas, com a mensagem de cada etapa) e regua_disparos (prévia → aprovação → envio
--     pela fila de WhatsApp existente, com registro de enviados / fora pelas regras / falhas)
-- Idempotente. Depende de 0055, 0052, 0075.

-- ---------- todos os clientes do Asaas ----------
create table if not exists public.asaas_contatos (
  asaas_id text primary key,
  nome text, cpf_cnpj text, email text, telefone text,
  cliente_id text references public.clientes (id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table public.asaas_contatos enable row level security;
drop policy if exists "asaas_contatos: financeiro le" on public.asaas_contatos;
create policy "asaas_contatos: financeiro le" on public.asaas_contatos for select to authenticated using (public.pode_financeiro());
revoke all on public.asaas_contatos from anon;

create or replace function public.asaas_sincronizar_gravar(token text, clientes jsonb, cobrancas jsonb, p_erro text default null, p_por uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; p jsonb; nc int := 0; np int := 0; cid text; doc text;
begin
  if not (public.automacoes_token_valido(token) or coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'role' = 'service_role') then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for c in select value from jsonb_array_elements(coalesce(clientes, '[]'::jsonb)) loop
    cid := public.asaas_cliente_do_sistema(c->>'id', c->>'cpfCnpj', c->>'externalReference');
    insert into public.asaas_contatos (asaas_id, nome, cpf_cnpj, email, telefone, cliente_id, atualizado_em)
    values (c->>'id', c->>'name', c->>'cpfCnpj', c->>'email', coalesce(nullif(c->>'mobilePhone',''), c->>'phone'), cid, now())
    on conflict (asaas_id) do update set nome = excluded.nome, cpf_cnpj = excluded.cpf_cnpj, email = excluded.email, telefone = excluded.telefone, cliente_id = coalesce(excluded.cliente_id, asaas_contatos.cliente_id), atualizado_em = now();
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

-- ---------- cobranças: baixa manual, nova data negociada ----------
alter table public.cobrancas
  add column if not exists baixa_manual boolean not null default false,
  add column if not exists baixa_manual_em timestamptz,
  add column if not exists vencimento_negociado date;

create table if not exists public.cobranca_contatos (
  id bigserial primary key,
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  cliente_nome text,
  valor numeric,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  desfecho text not null check (desfecho in ('RECUPERADO','NAO_RESPONDE','VERIFICAR_AMANHA','NEGOCIOU')),
  proxima_acao text,
  observacao text,
  nova_data date,
  registrado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  origem text not null default 'painel',   -- painel | migracao
  created_at timestamptz not null default now()
);
create index if not exists cobranca_contatos_cob_idx on public.cobranca_contatos (cobranca_id, data desc, created_at desc);
create index if not exists cobranca_contatos_data_idx on public.cobranca_contatos (data desc);
alter table public.cobranca_contatos enable row level security;
drop policy if exists "cobranca_contatos: financeiro" on public.cobranca_contatos;
create policy "cobranca_contatos: financeiro" on public.cobranca_contatos for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
revoke all on public.cobranca_contatos from anon;

create table if not exists public.cobranca_checks (
  data date not null,
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (data, cobranca_id)
);
alter table public.cobranca_checks enable row level security;
drop policy if exists "cobranca_checks: financeiro" on public.cobranca_checks;
create policy "cobranca_checks: financeiro" on public.cobranca_checks for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
revoke all on public.cobranca_checks from anon;

-- registrar contato (fila de vencidas): Recuperado dá baixa manual; Negociou com data grava o vencimento negociado
create or replace function public.cobranca_registrar_contato(p_cobranca uuid, p_desfecho text, p_observacao text default null, p_nova_data date default null, p_data date default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare c record; novo bigint; prox text; dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select c0.*, coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome) as cliente_nome into c
    from public.cobrancas c0 left join public.clientes cl on cl.id = c0.cliente_id left join public.asaas_contatos ac on ac.asaas_id = c0.asaas_cliente_id
   where c0.id = p_cobranca;
  if c.id is null then raise exception 'Cobrança não encontrada.'; end if;
  prox := case p_desfecho when 'RECUPERADO' then 'Encerrado — cobrança quitada' when 'NAO_RESPONDE' then 'Monitorar histórico / avaliar recorrência'
                          when 'VERIFICAR_AMANHA' then 'Entrar na fila de amanhã' when 'NEGOCIOU' then 'Acompanhar nova data de pagamento' end;
  insert into public.cobranca_contatos (cobranca_id, cliente_nome, valor, data, desfecho, proxima_acao, observacao, nova_data)
  values (p_cobranca, c.cliente_nome, c.valor, dia, p_desfecho, prox, coalesce(nullif(btrim(p_observacao), ''), case when p_nova_data is not null then 'Nova data acordada: ' || to_char(p_nova_data, 'DD/MM/YYYY') end), p_nova_data)
  returning id into novo;
  if p_desfecho = 'RECUPERADO' then
    update public.cobrancas set baixa_manual = true, baixa_manual_em = now(), regua_parada = true, atualizado_em = now() where id = p_cobranca;
  elsif p_desfecho = 'NEGOCIOU' and p_nova_data is not null then
    update public.cobrancas set vencimento_negociado = p_nova_data, atualizado_em = now() where id = p_cobranca;
  end if;
  return novo;
end $$;
revoke all on function public.cobranca_registrar_contato(uuid, text, text, date, date) from public, anon;

create or replace function public.cobranca_marcar_paga(p_cobranca uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.cobrancas set baixa_manual = true, baixa_manual_em = now(), regua_parada = true, atualizado_em = now() where id = p_cobranca;
end $$;
revoke all on function public.cobranca_marcar_paga(uuid) from public, anon;

-- ---------- etapas da régua e disparos ----------
create table if not exists public.regua_etapas (
  codigo text primary key,                 -- D-5, D-2, D-0, D+1, D+3…
  titulo text not null,
  descricao text,
  dias integer not null,                   -- dias até o vencimento: positivo = antes, 0 = no dia, negativo = depois
  mensagem text,
  personalizada boolean not null default false,
  ativa boolean not null default true,
  automatica boolean not null default false,   -- prepara o disparo sozinha nos dias úteis (continua exigindo aprovação)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.regua_etapas enable row level security;
drop policy if exists "regua_etapas: financeiro" on public.regua_etapas;
create policy "regua_etapas: financeiro" on public.regua_etapas for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
revoke all on public.regua_etapas from anon;
insert into public.regua_etapas (codigo, titulo, descricao, dias, mensagem, automatica) values
  ('D-5', 'Relatório', '5 dias antes do vencimento: mensagem com o relatório.', 5, null, false),
  ('D-2', 'Fatura com link', '2 dias antes do vencimento: fatura com o link de pagamento.', 2, null, false),
  ('D-0', 'Lembrete', 'No dia do vencimento: lembrete com o link. Preparada sozinha nos dias úteis às 8h55 (aprovação continua manual).', 0,
   E'Olá! Tudo bem?\n\nEsta é uma *mensagem automática* para lembrar que *{quando} é o vencimento* da sua *parcela {parcela}*.\n\nPara sua comodidade, segue o link da fatura. O pagamento pode ser feito via PIX ou boleto:\n\n{link}\n\nCaso o pagamento já tenha sido efetuado, desconsidere esta mensagem.\n\nAgradecemos e desejamos um ótimo dia!', true),
  ('D+1', 'Cobrança', '1 dia após o vencimento: mensagem de cobrança da parcela vencida.', -1,
   E'Bom dia, tudo bem? \n\nPassando para verificar se deu tudo certo com o link de pagamento que enviamos.\nPercebemos que o pagamento ainda não foi identificado e gostaríamos de saber se houve alguma dificuldade para realizá-lo. \n\nSe precisar de um novo link ou de qualquer auxílio, é só nos avisar.\nFicamos à disposição e agradecemos o seu retorno!', false)
on conflict (codigo) do nothing;

create table if not exists public.regua_disparos (
  id bigserial primary key,
  data date not null,
  etapa text not null,
  origem text not null default 'manual' check (origem in ('manual', 'agendada', 'migracao')),
  status text not null default 'aguardando_aprovacao' check (status in ('solicitado','aguardando_aprovacao','em_andamento','concluida','sem_clientes','falhou','cancelada')),
  aptos jsonb not null default '[]'::jsonb,          -- [{cobranca_id, cliente, parcela, vencimento, valor, tel4, numero, texto}]
  enviados jsonb not null default '[]'::jsonb,       -- [{cobranca_id, cliente, parcela, vencimento, hora, mensagem}]
  nao_enviados jsonb not null default '[]'::jsonb,   -- [{cobranca_id, cliente, parcela, vencimento, motivo, falha}]
  motivo text,
  solicitado_por uuid, aprovado_por uuid, aprovado_em timestamptz,
  iniciado_em timestamptz, concluido_em timestamptz,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (data, etapa)
);
alter table public.regua_disparos enable row level security;
drop policy if exists "regua_disparos: financeiro le" on public.regua_disparos;
create policy "regua_disparos: financeiro le" on public.regua_disparos for select to authenticated using (public.pode_financeiro());
revoke all on public.regua_disparos from anon;

-- texto da parcela ("3 de 12") e vencimento efetivo
create or replace function public.cobranca_parcela_txt(c public.cobrancas) returns text
language sql immutable as $$
  select coalesce(case when c.parcela is not null and c.total_parcelas is not null then c.parcela || ' de ' || c.total_parcelas end,
                  (select m[1] || ' de ' || m[2] from regexp_matches(coalesce(c.descricao, ''), '(\d+)\s*de\s*(\d+)', 'i') m limit 1),
                  nullif(c.descricao, ''), c.tipo)
$$;
create or replace function public.regua_quando(venc date, dia date) returns text
language sql immutable as $$
  select case when venc = dia then 'hoje'
              when extract(isodow from venc) = 6 then 'neste sábado (' || to_char(venc, 'DD/MM') || ')'
              when extract(isodow from venc) = 7 then 'neste domingo (' || to_char(venc, 'DD/MM') || ')'
              else 'em ' || to_char(venc, 'DD/MM') end
$$;
create or replace function public.regua_render(tpl text, c public.cobrancas, dia date) returns text
language sql stable as $$
  select replace(replace(replace(replace(replace(coalesce(tpl, ''),
    '{parcela}', coalesce(public.cobranca_parcela_txt(c), '')),
    '{vencimento}', to_char(coalesce(c.vencimento_negociado, c.vencimento), 'DD/MM')),
    '{valor}', public.brl(c.valor)),
    '{link}', coalesce(c.link_fatura, c.link_boleto, '')),
    '{quando}', public.regua_quando(coalesce(c.vencimento_negociado, c.vencimento), dia))
$$;

-- prévia + criação do disparo (aguardando aprovação). Regras do artefato: antes do vencimento, cliente com outra parcela vencida
-- fica de fora (inadimplente); depois, cliente com parcela vencida mais antiga fica de fora (já em cadência); sem telefone,
-- duplicado (uma mensagem por cliente) e quem já recebeu mensagem da régua hoje também ficam de fora. Sexta inclui o fim de
-- semana (D-5/D-2/D-0) e segunda inclui sex–dom (D+1 etc.).
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
           coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente
      from public.cobrancas c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
     where c.status in ('pendente', 'atrasada') and not c.baixa_manual and coalesce(c.vencimento_negociado, c.vencimento) is not null
       and (coalesce(c.vencimento_negociado, c.vencimento) - dia) = any(alvos)
     order by cliente_nome, coalesce(c.vencimento_negociado, c.vencimento)
  loop
    motivo := null;
    select * into cob from public.cobrancas where id = r.id;
    if et.dias >= 0 and exists (select 1 from public.cobrancas o where o.id <> r.id and coalesce(o.asaas_cliente_id, o.cliente_id) = r.chave_cliente and o.status in ('pendente','atrasada') and not o.baixa_manual and coalesce(o.vencimento_negociado, o.vencimento) < dia) then
      motivo := 'inadimplente (outra parcela vencida)';
    elsif et.dias < 0 and exists (select 1 from public.cobrancas o where o.id <> r.id and coalesce(o.asaas_cliente_id, o.cliente_id) = r.chave_cliente and o.status in ('pendente','atrasada') and not o.baixa_manual and coalesce(o.vencimento_negociado, o.vencimento) < r.venc_ef) then
      motivo := 'já em cadência (outras parcelas vencidas)';
    elsif r.chave_cliente = any(vistos) then
      motivo := 'duplicado (uma mensagem por cliente)';
    elsif nullif(regexp_replace(coalesce(r.telefone, ''), '[^0-9]', '', 'g'), '') is null then
      motivo := 'sem telefone';
    elsif exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:%' and m.status <> 'cancelada' and (m.enviar_em at time zone 'America/Sao_Paulo')::date = dia
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
                                         'valor', public.brl(r.valor), 'tel4', right(num, 4), 'numero', num, 'texto', public.regua_render(et.mensagem, cob, dia));
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

-- aprovar: enfileira as mensagens (ChatGuru, horário comercial) e acompanha o resultado
create or replace function public.regua_aprovar(p_disparo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.regua_disparos; a jsonb; n int := 0;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into d from public.regua_disparos where id = p_disparo for update;
  if d.id is null then raise exception 'Disparo não encontrado.'; end if;
  if d.status <> 'aguardando_aprovacao' then raise exception 'Este disparo não está aguardando aprovação (%).', d.status; end if;
  for a in select value from jsonb_array_elements(d.aptos) loop
    insert into public.mensagens_fila (cliente_id, nome, numero, texto, referencia, enviar_em)
    values ((select cliente_id from public.cobrancas where id = (a->>'cobranca_id')::uuid), a->>'cliente', a->>'numero', a->>'texto', 'regua:' || d.id || ':' || (a->>'cobranca_id'), now());
    n := n + 1;
  end loop;
  update public.regua_disparos set status = 'em_andamento', aprovado_por = auth.uid(), aprovado_em = now(), iniciado_em = now(), atualizado_em = now() where id = d.id;
  return jsonb_build_object('ok', true, 'enfileiradas', n);
end $$;
revoke all on function public.regua_aprovar(bigint) from public, anon;

create or replace function public.regua_cancelar(p_disparo bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.mensagens_fila set status = 'cancelada', resultado = 'Disparo cancelado', atualizado_em = now() where referencia like 'regua:' || p_disparo || ':%' and status = 'pendente';
  update public.regua_disparos set status = 'cancelada', motivo = 'Cancelado pela equipe', atualizado_em = now() where id = p_disparo and status in ('aguardando_aprovacao', 'em_andamento', 'solicitado');
end $$;
revoke all on function public.regua_cancelar(bigint) from public, anon;

-- consolida o resultado das mensagens da régua no disparo (chamado após cada lote de envio)
create or replace function public.regua_disparos_atualizar() returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  for d in select * from public.regua_disparos where status = 'em_andamento' loop
    update public.regua_disparos x set
      enviados = coalesce((select jsonb_agg(jsonb_build_object('cobranca_id', split_part(m.referencia, ':', 3), 'cliente', m.nome, 'hora', to_char(m.enviada_em at time zone 'America/Sao_Paulo', 'HH24:MI'), 'mensagem', m.texto,
                                                 'parcela', a->>'parcela', 'vencimento', a->>'vencimento') order by m.enviada_em)
                             from public.mensagens_fila m left join jsonb_array_elements(d.aptos) a on a->>'cobranca_id' = split_part(m.referencia, ':', 3)
                            where m.referencia like 'regua:' || d.id || ':%' and m.status = 'enviada'), '[]'::jsonb),
      nao_enviados = (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(d.nao_enviados) f where coalesce(f->>'falha', 'false') <> 'true')
                     || coalesce((select jsonb_agg(jsonb_build_object('cobranca_id', split_part(m.referencia, ':', 3), 'cliente', m.nome, 'motivo', 'falha no envio: ' || coalesce(m.resultado, ''), 'falha', true,
                                                        'parcela', a->>'parcela', 'vencimento', a->>'vencimento'))
                                    from public.mensagens_fila m left join jsonb_array_elements(d.aptos) a on a->>'cobranca_id' = split_part(m.referencia, ':', 3)
                                   where m.referencia like 'regua:' || d.id || ':%' and m.status in ('erro', 'cancelada')), '[]'::jsonb),
      status = case when exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:' || d.id || ':%' and m.status in ('pendente', 'processando')) then 'em_andamento' else 'concluida' end,
      concluido_em = case when exists (select 1 from public.mensagens_fila m where m.referencia like 'regua:' || d.id || ':%' and m.status in ('pendente', 'processando')) then null else now() end,
      atualizado_em = now()
    where x.id = d.id;
  end loop;
end $$;

-- envio registrado também nos disparos da régua
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
        values (m.cliente_id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'WhatsApp enviado: ' || coalesce((select titulo from public.mensagens_modelos where chave = m.modelo), m.modelo, case when m.referencia like 'regua:%' then 'régua de cobrança' else 'mensagem' end), false, true, 'onboarding');
      end if;
      if m.lead_id is not null then
        insert into public.observacoes (lead_id, texto) values (m.lead_id, 'Automação do CRM:' || E'\n' || coalesce(m.texto, ''));
        update public.leads set ultima_interacao_em = now() where id = m.lead_id;
      end if;
    elsif coalesce((it->>'temporario')::boolean, false) and m.tentativas < 3 then
      update public.mensagens_fila set status = 'pendente', enviar_em = now() + interval '5 minutes', resultado = it->>'erro', atualizado_em = now() where id = m.id;
    else
      update public.mensagens_fila set status = 'erro', resultado = it->>'erro', atualizado_em = now() where id = m.id;
      if m.cliente_id is not null and m.referencia not like 'regua:%' then
        perform public.notificar_colaborador((select responsavel_onboarding_id from public.clientes where id = m.cliente_id), 'WhatsApp não enviado',
          coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#clientes/' || coalesce(m.cliente_id, ''));
      elsif m.lead_id is not null then
        perform public.notificar((select proprietario_id from public.leads where id = m.lead_id), 'Mensagem automática não enviada',
          coalesce(m.nome, '') || ': ' || left(coalesce(it->>'erro', 'erro'), 120), '#leads');
      end if;
    end if;
  end loop;
  perform public.fluxos_concluir_prontos();
  perform public.regua_disparos_atualizar();
end $$;
revoke all on function public.mensagens_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.mensagens_registrar(text, jsonb) to service_role;

-- etapas automáticas: preparam o disparo nos dias úteis e avisam o financeiro (aprovação continua manual)
create or replace function public.regua_preparar_automaticas() returns integer
language plpgsql security definer set search_path = public as $$
declare et record; n int := 0; d jsonb; resp uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if extract(isodow from hoje) > 5 then return 0; end if;
  for et in select * from public.regua_etapas where ativa and automatica and coalesce(mensagem, '') <> '' loop
    continue when exists (select 1 from public.regua_disparos x where x.data = hoje and x.etapa = et.codigo);
    d := public.regua_preparar(et.codigo, hoje, 'agendada');
    n := n + 1;
    if d->>'status' = 'aguardando_aprovacao' then
      resp := public.responsavel_padrao('administrativo');
      perform public.notificar_colaborador(resp, 'Régua ' || et.codigo || ' aguardando aprovação', jsonb_array_length(d->'aptos') || ' cliente(s) para receber "' || et.titulo || '" hoje. Aprove em Financeiro → Central de Cobranças.', '#financeiro');
    end if;
  end loop;
  return n;
end $$;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'regua-central-np';
  perform cron.schedule('regua-central-np', '55 11 * * 1-5', $c$ select public.regua_preparar_automaticas(); $c$);  -- 08:55 BRT
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

-- ---------- views ----------
drop view if exists public.v_central_cobrancas;
create view public.v_central_cobrancas with (security_invoker = true) as
select c.id, c.asaas_id, c.cliente_id, c.asaas_cliente_id, coalesce(c.asaas_cliente_id, c.cliente_id) as chave_cliente,
       coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, '(cliente ' || coalesce(c.asaas_cliente_id, '?') || ')') as cliente_nome,
       coalesce(ac.telefone, (select ct.telefone from public.contatos ct where ct.cliente_id = c.cliente_id and ct.telefone is not null order by ct.principal desc nulls last limit 1)) as telefone,
       c.tipo, c.descricao, public.cobranca_parcela_txt(c) as parcela_txt, c.valor, c.vencimento, c.vencimento_negociado, coalesce(c.vencimento_negociado, c.vencimento) as venc_ef,
       c.status, c.pago_em, c.baixa_manual, (c.status = 'paga' or c.baixa_manual) as paga, c.link_fatura, c.link_boleto,
       (select jsonb_build_object('id', k.id, 'data', k.data, 'desfecho', k.desfecho, 'observacao', k.observacao, 'nova_data', k.nova_data, 'created_at', k.created_at)
          from public.cobranca_contatos k where k.cobranca_id = c.id order by k.data desc, k.created_at desc limit 1) as ultimo_contato,
       exists (select 1 from public.cobranca_contatos k where k.cobranca_id = c.id and k.desfecho = 'NEGOCIOU') as negociada,
       exists (select 1 from public.cobranca_checks ck where ck.cobranca_id = c.id and ck.data = (now() at time zone 'America/Sao_Paulo')::date) as check_hoje
  from public.cobrancas c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
 where c.status in ('pendente', 'atrasada', 'paga');
revoke all on public.v_central_cobrancas from anon;

create or replace view public.v_cobranca_contatos with (security_invoker = true) as
select k.*, coalesce(p.nome, p.email) as registrado_por_nome from public.cobranca_contatos k left join public.perfis p on p.id = k.registrado_por;
revoke all on public.v_cobranca_contatos from anon;

select 'ok 0076' as resultado;
