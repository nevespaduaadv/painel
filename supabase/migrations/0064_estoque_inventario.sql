-- 0064 — Estoque de consumo e Inventário patrimonial (requisitos da Marina, 15/10/2026).
-- Área Financeiro (pode_financeiro). Tarefas automáticas usam o sistema de tarefas existente. Idempotente.

-- =========================================================
-- ESTOQUE (consumo)
-- =========================================================
create table if not exists public.estoque_produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null check (categoria in ('alimenticios','escritorio')),
  unidade text not null default 'un',
  saldo_inicial numeric(12,2) not null default 0,
  saldo_atual numeric(12,2) not null default 0,
  estoque_minimo numeric(12,2) not null default 0,
  qtd_desejada numeric(12,2) not null default 0,
  observacoes text,
  ativo boolean not null default true,
  tarefa_reposicao_id uuid references public.tarefas(id) on delete set null,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists estoque_produtos_nome_uidx on public.estoque_produtos (lower(nome)) where ativo;

create table if not exists public.estoque_movimentos (
  id bigserial primary key,
  produto_id uuid not null references public.estoque_produtos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada','retirada','ajuste','inicial')),
  quantidade numeric(12,2) not null,
  saldo_apos numeric(12,2) not null,
  observacao text,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  autor uuid default auth.uid(),
  autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists estoque_mov_prod_idx on public.estoque_movimentos (produto_id, criado_em desc);

alter table public.estoque_produtos enable row level security;
alter table public.estoque_movimentos enable row level security;
drop policy if exists "estoque: financeiro" on public.estoque_produtos;
create policy "estoque: financeiro" on public.estoque_produtos for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
drop policy if exists "estoque mov: ver" on public.estoque_movimentos;
create policy "estoque mov: ver" on public.estoque_movimentos for select to authenticated using (public.pode_financeiro());

-- saldo_atual só muda pela função de movimentação
create or replace function public.estoque_protege_saldo() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.saldo_atual is distinct from old.saldo_atual and coalesce(current_setting('app.estoque_mov', true), '') <> '1' then
    raise exception 'O saldo é alterado só por entrada/retirada (registre uma movimentação).';
  end if;
  if tg_op = 'INSERT' then new.saldo_atual := coalesce(new.saldo_inicial, 0); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists estoque_protege_saldo on public.estoque_produtos;
create trigger estoque_protege_saldo before insert or update on public.estoque_produtos for each row execute procedure public.estoque_protege_saldo();

-- movimento inicial ao cadastrar com saldo
create or replace function public.estoque_mov_inicial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.saldo_inicial,0) <> 0 then
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, observacao, autor, autor_nome)
    values (new.id, 'inicial', new.saldo_inicial, new.saldo_inicial, 'Saldo inicial do cadastro', auth.uid(), (select nome from public.perfis where id = auth.uid()));
  end if;
  perform public.estoque_verificar_reposicao(new.id);
  return new;
end $$;
drop trigger if exists estoque_mov_inicial on public.estoque_produtos;
create trigger estoque_mov_inicial after insert on public.estoque_produtos for each row execute procedure public.estoque_mov_inicial();

-- abre/conclui a tarefa de reposição conforme o saldo
create or replace function public.estoque_verificar_reposicao(p_produto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.estoque_produtos; t uuid; resp uuid; sugerida numeric; cat text;
begin
  select * into p from public.estoque_produtos where id = p_produto for update;
  if p.id is null or not p.ativo then return; end if;
  -- tarefa aberta ainda existe?
  if p.tarefa_reposicao_id is not null and not exists (select 1 from public.tarefas where id = p.tarefa_reposicao_id and status in ('aberta','em_andamento')) then
    update public.estoque_produtos set tarefa_reposicao_id = null where id = p.id; p.tarefa_reposicao_id := null;
  end if;
  cat := case p.categoria when 'alimenticios' then 'Alimentícios' else 'Escritório' end;
  if p.saldo_atual <= p.estoque_minimo then
    if p.tarefa_reposicao_id is null then
      sugerida := greatest(coalesce(p.qtd_desejada,0) - p.saldo_atual, 0);
      resp := coalesce(public.responsavel_padrao('administrativo'), (select id from public.colaboradores where ativo and nucleo = 'administrativo' order by nome limit 1));
      insert into public.tarefas (titulo, descricao, responsavel_id, nucleo, prazo, prioridade, status)
      values ('Reposição de estoque: ' || p.nome,
              'Produto: ' || p.nome || E'\nCategoria: ' || cat || E'\nSaldo atual: ' || p.saldo_atual || ' ' || p.unidade || E'\nEstoque mínimo: ' || p.estoque_minimo || E'\nQuantidade sugerida para compra: ' || sugerida || ' ' || p.unidade ||
              E'\nAberta em: ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || E'\n\nAo receber os produtos, registre a entrada em Financeiro → Estoque; a tarefa é concluída sozinha quando o saldo passar do mínimo.',
              resp, 'administrativo', current_date + 3, case when p.saldo_atual <= 0 then 1 else 2 end, 'aberta')
      returning id into t;
      update public.estoque_produtos set tarefa_reposicao_id = t where id = p.id;
    end if;
  elsif p.tarefa_reposicao_id is not null then
    update public.tarefas set status = 'concluida', concluida_em = now() where id = p.tarefa_reposicao_id and status in ('aberta','em_andamento');
    insert into public.tarefa_eventos (tarefa_id, tipo, nota, autor, autor_nome) values (p.tarefa_reposicao_id, 'comentario', 'Estoque reposto: saldo ' || p.saldo_atual || ' ' || p.unidade || ' (acima do mínimo ' || p.estoque_minimo || ').', auth.uid(), 'Sistema');
    update public.estoque_produtos set tarefa_reposicao_id = null where id = p.id;
  end if;
end $$;

-- movimentação (única porta de entrada para mexer no saldo)
create or replace function public.estoque_movimentar(p_produto uuid, p_tipo text, p_quantidade numeric, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.estoque_produtos; novo numeric; mid bigint; nome_ text;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if p_tipo not in ('entrada','retirada','ajuste') then raise exception 'Tipo inválido.'; end if;
  if p_quantidade is null or (p_tipo <> 'ajuste' and p_quantidade <= 0) then raise exception 'Informe uma quantidade maior que zero.'; end if;
  select * into p from public.estoque_produtos where id = p_produto for update;
  if p.id is null then raise exception 'Produto não encontrado.'; end if;
  novo := case p_tipo when 'entrada' then p.saldo_atual + p_quantidade when 'retirada' then p.saldo_atual - p_quantidade else p_quantidade end;
  if novo < 0 then raise exception 'Retirada maior que o saldo disponível (% %).', p.saldo_atual, p.unidade; end if;
  perform set_config('app.estoque_mov', '1', true);
  update public.estoque_produtos set saldo_atual = novo where id = p.id;
  perform set_config('app.estoque_mov', '', true);
  select nome into nome_ from public.perfis where id = auth.uid();
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, observacao, tarefa_id, autor, autor_nome)
  values (p.id, p_tipo, case when p_tipo = 'ajuste' then novo - p.saldo_atual else p_quantidade end, novo, nullif(p_observacao,''), p.tarefa_reposicao_id, auth.uid(), nome_)
  returning id into mid;
  perform public.estoque_verificar_reposicao(p.id);
  return jsonb_build_object('ok', true, 'saldo', novo, 'movimento', mid);
end $$;
grant execute on function public.estoque_movimentar(uuid, text, numeric, text) to authenticated;

-- visão com consumo médio, previsão e compra sugerida
create or replace view public.v_estoque with (security_invoker = true) as
with ret as (
  select produto_id,
         sum(quantidade) filter (where criado_em >= now() - interval '28 days') as ret_28,
         sum(quantidade) filter (where criado_em >= now() - interval '84 days') as ret_84,
         min(criado_em) as primeira_ret
  from public.estoque_movimentos where tipo = 'retirada' group by produto_id
)
select p.*,
       case p.categoria when 'alimenticios' then 'Alimentícios' else 'Escritório' end as categoria_nome,
       round(coalesce(r.ret_28,0) / 4.0, 2) as consumo_semanal,
       round(coalesce(r.ret_84,0) / 3.0, 2) as consumo_mensal,
       (r.primeira_ret is not null and r.primeira_ret < now() - interval '14 days' and coalesce(r.ret_28,0) > 0) as previsao_confiavel,
       case when coalesce(r.ret_28,0) > 0 then round(p.saldo_atual / (r.ret_28 / 28.0)) else null end as dias_restantes,
       greatest(coalesce(p.qtd_desejada,0) - p.saldo_atual, 0) as compra_sugerida,
       (p.saldo_atual <= p.estoque_minimo) as abaixo_minimo,
       (p.saldo_atual <= 0) as zerado,
       t.status as tarefa_status, t.prazo as tarefa_prazo, t.responsavel_id as tarefa_responsavel_id,
       (select co.nome from public.colaboradores co where co.id = t.responsavel_id) as tarefa_responsavel_nome,
       (select max(m.criado_em) from public.estoque_movimentos m where m.produto_id = p.id) as ultima_movimentacao
from public.estoque_produtos p
left join ret r on r.produto_id = p.id
left join public.tarefas t on t.id = p.tarefa_reposicao_id;

create or replace view public.v_estoque_movimentos with (security_invoker = true) as
select m.*, p.nome as produto_nome, p.unidade, p.categoria from public.estoque_movimentos m join public.estoque_produtos p on p.id = m.produto_id;

-- =========================================================
-- INVENTÁRIO (patrimônio)
-- =========================================================
create table if not exists public.inventario_itens (
  id uuid primary key default gen_random_uuid(),
  patrimonio text not null unique,
  tipo text not null,                               -- notebook, desktop, monitor, mouse, teclado, headset, celular, impressora, cadeira, outro
  marca text, modelo text, numero_serie text,
  situacao text not null default 'disponivel' check (situacao in ('em_uso','disponivel','manutencao','baixado')),
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  departamento text,
  especificacoes jsonb not null default '{}'::jsonb, -- por tipo: processador, ram, armazenamento, conexao, tamanho, resolucao…
  observacoes text,
  adquirido_em date, valor numeric(12,2),
  ativo boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.inventario_movimentos (
  id bigserial primary key,
  item_id uuid not null references public.inventario_itens(id) on delete cascade,
  tipo text not null check (tipo in ('cadastro','atribuicao','devolucao','transferencia','situacao','alteracao','revisao')),
  de_responsavel_id uuid, para_responsavel_id uuid,
  de_departamento text, para_departamento text,
  de_situacao text, para_situacao text,
  nota text,
  autor uuid default auth.uid(), autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists inventario_mov_item_idx on public.inventario_movimentos (item_id, criado_em desc);
create table if not exists public.inventario_revisoes (
  id bigserial primary key,
  ciclo text not null,                              -- ex.: 2026-10
  tarefa_id uuid references public.tarefas(id) on delete set null,
  item_id uuid not null references public.inventario_itens(id) on delete cascade,
  resultado text not null check (resultado in ('localizado','nao_localizado','divergente')),
  pendencia text,
  revisado_por uuid default auth.uid(), revisado_por_nome text,
  revisado_em timestamptz not null default now(),
  unique (ciclo, item_id)
);
alter table public.inventario_itens enable row level security;
alter table public.inventario_movimentos enable row level security;
alter table public.inventario_revisoes enable row level security;
drop policy if exists "inv: financeiro" on public.inventario_itens;
create policy "inv: financeiro" on public.inventario_itens for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
drop policy if exists "inv: proprio" on public.inventario_itens;
create policy "inv: proprio" on public.inventario_itens for select to authenticated using (responsavel_id = public.meu_colaborador());
drop policy if exists "inv mov: ver" on public.inventario_movimentos;
create policy "inv mov: ver" on public.inventario_movimentos for select to authenticated using (public.pode_financeiro());
drop policy if exists "inv mov: nota" on public.inventario_movimentos;
create policy "inv mov: nota" on public.inventario_movimentos for insert to authenticated with check (public.pode_financeiro() and tipo = 'alteracao');
drop policy if exists "inv rev: financeiro" on public.inventario_revisoes;
create policy "inv rev: financeiro" on public.inventario_revisoes for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());

-- histórico automático a cada mudança
create or replace function public.inventario_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare quem text; t text;
begin
  select nome into quem from public.perfis where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.inventario_movimentos (item_id, tipo, para_responsavel_id, para_departamento, para_situacao, nota, autor, autor_nome)
    values (new.id, 'cadastro', new.responsavel_id, new.departamento, new.situacao, 'Cadastrado', auth.uid(), quem);
    return new;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  if new.responsavel_id is distinct from old.responsavel_id then
    t := case when old.responsavel_id is null then 'atribuicao' when new.responsavel_id is null then 'devolucao' else 'transferencia' end;
    insert into public.inventario_movimentos (item_id, tipo, de_responsavel_id, para_responsavel_id, de_departamento, para_departamento, autor, autor_nome)
    values (new.id, t, old.responsavel_id, new.responsavel_id, old.departamento, new.departamento, auth.uid(), quem);
  elsif new.departamento is distinct from old.departamento then
    insert into public.inventario_movimentos (item_id, tipo, de_departamento, para_departamento, autor, autor_nome) values (new.id, 'transferencia', old.departamento, new.departamento, auth.uid(), quem);
  end if;
  if new.situacao is distinct from old.situacao then
    insert into public.inventario_movimentos (item_id, tipo, de_situacao, para_situacao, autor, autor_nome) values (new.id, 'situacao', old.situacao, new.situacao, auth.uid(), quem);
  end if;
  if (new.tipo, new.marca, new.modelo, new.numero_serie, new.especificacoes, new.observacoes) is distinct from (old.tipo, old.marca, old.modelo, old.numero_serie, old.especificacoes, old.observacoes) then
    insert into public.inventario_movimentos (item_id, tipo, nota, autor, autor_nome) values (new.id, 'alteracao', 'Cadastro alterado', auth.uid(), quem);
  end if;
  return new;
end $$;
drop trigger if exists inventario_trilha_ins on public.inventario_itens;
create trigger inventario_trilha_ins after insert on public.inventario_itens for each row execute procedure public.inventario_trilha();
drop trigger if exists inventario_trilha_upd on public.inventario_itens;
create trigger inventario_trilha_upd before update on public.inventario_itens for each row execute procedure public.inventario_trilha();

create or replace view public.v_inventario with (security_invoker = true) as
select i.*, co.nome as responsavel_nome,
       (select r.resultado from public.inventario_revisoes r where r.item_id = i.id order by r.revisado_em desc limit 1) as ultima_revisao_resultado,
       (select r.revisado_em from public.inventario_revisoes r where r.item_id = i.id order by r.revisado_em desc limit 1) as ultima_revisao_em
from public.inventario_itens i left join public.colaboradores co on co.id = i.responsavel_id;

create or replace view public.v_inventario_movimentos with (security_invoker = true) as
select m.*, i.patrimonio, i.tipo as item_tipo, i.marca, i.modelo,
       (select nome from public.colaboradores where id = m.de_responsavel_id) as de_nome,
       (select nome from public.colaboradores where id = m.para_responsavel_id) as para_nome
from public.inventario_movimentos m join public.inventario_itens i on i.id = m.item_id;

-- configuração da revisão periódica
insert into public.escritorio (id, dados) values ('inventario', '{"revisao_frequencia":"trimestral","responsavel_id":null}'::jsonb) on conflict (id) do nothing;

-- abre a tarefa de revisão do ciclo quando for a hora (chamada diária pelo cron); também pode ser chamada pelo botão
create or replace function public.inventario_gerar_revisao(p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; freq text; ciclo text; hoje date := (now() at time zone 'America/Sao_Paulo')::date; resp uuid; t uuid; n int;
begin
  select dados into cfg from public.escritorio where id = 'inventario';
  freq := coalesce(cfg->>'revisao_frequencia', 'trimestral');
  if freq = 'nunca' and not p_forcar then return jsonb_build_object('ok', true, 'criada', false, 'motivo', 'desligada'); end if;
  ciclo := case freq when 'mensal' then to_char(hoje, 'YYYY-MM') when 'semestral' then to_char(hoje, 'YYYY') || '-S' || ((extract(month from hoje)::int + 5) / 6) when 'anual' then to_char(hoje, 'YYYY') else to_char(hoje, 'YYYY') || '-T' || ((extract(month from hoje)::int + 2) / 3) end;
  if not p_forcar and exists (select 1 from public.tarefas where titulo like 'Revisão do inventário — ' || ciclo || '%') then return jsonb_build_object('ok', true, 'criada', false, 'ciclo', ciclo); end if;
  if p_forcar then ciclo := ciclo || '-' || to_char(now(), 'DDHH24MI'); end if;
  select count(*) into n from public.inventario_itens where ativo and situacao <> 'baixado';
  resp := coalesce((cfg->>'responsavel_id')::uuid, public.responsavel_padrao('administrativo'), (select id from public.colaboradores where ativo and nucleo = 'administrativo' order by nome limit 1));
  insert into public.tarefas (titulo, descricao, responsavel_id, nucleo, prazo, prioridade, status)
  values ('Revisão do inventário — ' || ciclo, 'Conferir fisicamente os ' || n || ' equipamentos cadastrados: localizado? responsável correto? dados corretos? situação atualizada?' || E'\nAbra Financeiro → Inventário → Revisão e marque item a item. A tarefa pode ser concluída quando todos estiverem conferidos.',
          resp, 'administrativo', hoje + 15, 2, 'aberta') returning id into t;
  return jsonb_build_object('ok', true, 'criada', true, 'ciclo', ciclo, 'tarefa', t);
end $$;
grant execute on function public.inventario_gerar_revisao(boolean) to authenticated;

-- registra o resultado da conferência de um item no ciclo da tarefa
create or replace function public.inventario_revisar(p_tarefa uuid, p_item uuid, p_resultado text, p_pendencia text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ciclo_ text; quem text; faltam int;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.'; end if;
  select substring(titulo from 'Revisão do inventário — (.+)$') into ciclo_ from public.tarefas where id = p_tarefa;
  if ciclo_ is null then raise exception 'Tarefa de revisão não encontrada.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  insert into public.inventario_revisoes (ciclo, tarefa_id, item_id, resultado, pendencia, revisado_por, revisado_por_nome)
  values (ciclo_, p_tarefa, p_item, p_resultado, nullif(p_pendencia,''), auth.uid(), quem)
  on conflict (ciclo, item_id) do update set resultado = excluded.resultado, pendencia = excluded.pendencia, revisado_por = excluded.revisado_por, revisado_por_nome = excluded.revisado_por_nome, revisado_em = now();
  insert into public.inventario_movimentos (item_id, tipo, nota, autor, autor_nome) values (p_item, 'revisao', 'Revisão ' || ciclo_ || ': ' || p_resultado || coalesce(' — ' || nullif(p_pendencia,''), ''), auth.uid(), quem);
  select count(*) into faltam from public.inventario_itens i where i.ativo and i.situacao <> 'baixado' and not exists (select 1 from public.inventario_revisoes r where r.ciclo = ciclo_ and r.item_id = i.id);
  return jsonb_build_object('ok', true, 'faltam', faltam);
end $$;
grant execute on function public.inventario_revisar(uuid, uuid, text, text) to authenticated;

-- cron diário 06:10 BRT: abre a revisão do ciclo se ainda não existir
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'inventario-revisao-np';
    perform cron.schedule('inventario-revisao-np', '10 9 1 * *', $c$ select public.inventario_gerar_revisao(false) $c$);
  end if;
end $$;

select 'ok 0064' as resultado;
