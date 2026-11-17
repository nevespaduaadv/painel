-- 0113 — Cargos funcionais, ocupações e distribuição institucional (pedido de 17/11/2026). Idempotente.
-- PROPOSTA: não aplicada em beta nem em produção. Pré-requisitos: trilha 0104 → 0107 → 0108.
--
-- PRINCÍPIO: pessoas ocupam cargos; cargos possuem responsabilidades e permissões; ações possuem autores individuais.
--
-- O que muda (evolução compatível — as funções de permissão existentes continuam valendo):
--   * cargos            = posição institucional: núcleo, frente, acessos (módulos), se responde pelo núcleo/frente.
--   * cargo_ocupacoes   = quem ocupa (titular/substituto), desde quando e até quando; histórico nunca é apagado.
--   * Os acessos efetivos (perfis.acessos) e o núcleo/frente (colaboradores) de quem é gerido por cargos passam a ser
--     PROJEÇÃO das ocupações ativas, recalculada a cada mudança. Como toda a RLS lê essas colunas a cada consulta, tirar
--     um cargo revoga o acesso na hora, inclusive de sessão já aberta. edita_protecao() e edita_ata() passam a olhar
--     TODOS os cargos ativos da pessoa (quem ocupa dois cargos tem as permissões dos dois).
--   * responsavel_padrao(núcleo) e resp_frente(frente) deixam de escolher "o mais antigo": devolvem o ocupante elegível do
--     cargo que responde pelo núcleo/frente (titular; substituto se o titular estiver inelegível ou afastado) ou, na falta,
--     a FILA do cargo ("Distribuição pendente"), nunca uma pessoa ao acaso. Sem cargo configurado para o núcleo: nulo.
--   * Elegível = ativo, com login de equipe, não é conta de teste. Atividade ligada a cliente exige acesso a Clientes.
--   * Tarefas e monitoramentos ganham cargo_id (vínculo institucional). Troca de titular move a carteira ABERTA do cargo
--     para o novo ocupante (ou para a fila), sem duplicar nada; atividades nominais ficam com a pessoa e aparecem em
--     v_transferencias_pendentes. Toda troca de responsável fica em responsavel_historico.
--   * Só a administradora gere cargos e ocupações (funções cargo_*). Cargo não concede papel de administradora.
--   * CORREÇÃO DE SEGURANÇA: a policy colab_self deixava a pessoa alterar o PRÓPRIO núcleo/frente/ativo (e assim ganhar
--     edita_protecao/edita_ata). Agora esses campos só mudam pela administradora.
-- O que NÃO muda na instalação: nenhuma ocupação é criada, nenhum acesso de pessoa é alterado, nenhuma tarefa ou
--   monitoramento existente troca de responsável. A partir da instalação, distribuições automáticas novas de núcleos
--   sem ocupante vão para a fila do cargo, até a administradora designar o ocupante.

-- ============ estrutura ============
create table if not exists public.cargos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9_]{3,40}$'),
  nome text not null check (length(btrim(nome)) >= 3),
  nucleo text check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','marketing','administrativo','rh','socios','financeiro')),
  frente text check (frente in ('estrategico','juridico','negocial')),
  acessos text[] not null default '{}'
    check (acessos <@ array['clientes','juridico','comercial','marketing','financeiro','equipe','growth','atendimento','superendividamento','tarefas_equipe','protecao']::text[]),
  responsavel_nucleo boolean not null default false,
  responsavel_frente boolean not null default false,
  responsabilidades text,
  ativo boolean not null default true,
  modalidade text not null default 'coordenacao' check (modalidade in ('coordenacao','operacional')), -- coordenacao: um titular (+ substituto). operacional: vários ocupantes ao mesmo tempo
  distribuicao text not null default 'fila' check (distribuicao in ('fila','rodizio')),                -- operacional com mais de um ocupante: fila administrável ou rodízio explícito
  rodizio_ultimo uuid,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  check (not responsavel_nucleo or nucleo is not null), check (not responsavel_frente or frente is not null),
  check (modalidade = 'coordenacao' or not (responsavel_nucleo or responsavel_frente))                 -- responder por núcleo/frente é responsabilidade individual
);
create unique index if not exists cargos_resp_nucleo_uq on public.cargos (nucleo) where responsavel_nucleo and ativo;
create unique index if not exists cargos_resp_frente_uq on public.cargos (frente) where responsavel_frente and ativo;

create table if not exists public.cargo_ocupacoes (
  id uuid primary key default gen_random_uuid(),
  cargo_id uuid not null references public.cargos(id),
  colaborador_id uuid not null references public.colaboradores(id),
  tipo text not null default 'titular' check (tipo in ('titular','substituto')),
  principal boolean not null default false,
  ordem integer not null default 0,                                      -- posição no rodízio (cargo operacional)
  inicio timestamptz not null default now(), fim timestamptz,
  afastado_de date, afastado_ate date,
  motivo text, motivo_fim text, criado_por uuid, encerrado_por uuid,
  check (fim is null or fim >= inicio), check (afastado_ate is null or afastado_de is not null)
);
drop index if exists public.cargo_ocup_titular_uq; -- o limite de um titular vale só para cargo de coordenação (gatilho abaixo)
create unique index if not exists cargo_ocup_pessoa_uq on public.cargo_ocupacoes (cargo_id, colaborador_id) where fim is null;
create unique index if not exists cargo_ocup_principal_uq on public.cargo_ocupacoes (colaborador_id) where fim is null and principal;
create index if not exists cargo_ocup_colab_idx on public.cargo_ocupacoes (colaborador_id) where fim is null;

create table if not exists public.responsavel_historico (
  id bigint generated always as identity primary key,
  tabela text not null, registro text not null, de uuid, para uuid, cargo_id uuid, motivo text, por uuid, quando timestamptz not null default now()
);
create index if not exists responsavel_hist_reg_idx on public.responsavel_historico (tabela, registro);

alter table public.colaboradores add column if not exists conta_teste boolean not null default false;
alter table public.colaboradores add column if not exists acesso_por_cargo boolean not null default false;
alter table public.colaboradores add column if not exists fila_cargo_id uuid references public.cargos(id);
create unique index if not exists colaboradores_fila_uq on public.colaboradores (fila_cargo_id) where fila_cargo_id is not null;
alter table public.tarefas add column if not exists cargo_id uuid references public.cargos(id);
alter table public.monitoramentos add column if not exists cargo_id uuid references public.cargos(id);
create index if not exists tarefas_cargo_idx on public.tarefas (cargo_id) where cargo_id is not null;

-- coordenação: um único titular; operacional: vários ocupantes, sem substituto
create or replace function public.cargo_ocupacoes_guarda_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if new.fim is not null then return new; end if;
  select modalidade into m from public.cargos where id = new.cargo_id;
  if m = 'operacional' and new.tipo <> 'titular' then
    raise exception 'Cargo operacional não tem substituto: todos os ocupantes atuam ao mesmo tempo.' using errcode = '23514';
  end if;
  if m = 'coordenacao' and new.tipo = 'titular' and exists (select 1 from public.cargo_ocupacoes o where o.cargo_id = new.cargo_id and o.fim is null and o.tipo = 'titular' and o.id <> new.id) then
    raise exception 'Cargo de coordenação tem um único titular. Use a transferência da ocupação.' using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists cargo_ocupacoes_guarda on public.cargo_ocupacoes;
create trigger cargo_ocupacoes_guarda before insert or update on public.cargo_ocupacoes for each row execute function public.cargo_ocupacoes_guarda_tg();

alter table public.cargos enable row level security;
alter table public.cargo_ocupacoes enable row level security;
alter table public.responsavel_historico enable row level security;
drop policy if exists cargos_sel on public.cargos;                 create policy cargos_sel on public.cargos for select to authenticated using (public.sou_equipe());
drop policy if exists cargo_ocup_sel on public.cargo_ocupacoes;    create policy cargo_ocup_sel on public.cargo_ocupacoes for select to authenticated using (public.sou_equipe());
drop policy if exists resp_hist_sel on public.responsavel_historico; create policy resp_hist_sel on public.responsavel_historico for select to authenticated using (public.sou_equipe());
-- (sem policies de escrita: só as funções cargo_*, da administradora)
revoke insert, update, delete on public.cargos, public.cargo_ocupacoes, public.responsavel_historico from authenticated, anon;
drop trigger if exists cargos_audit on public.cargos;                 create trigger cargos_audit after insert or update or delete on public.cargos for each row execute function public.auditar();
drop trigger if exists cargo_ocupacoes_audit on public.cargo_ocupacoes; create trigger cargo_ocupacoes_audit after insert or update or delete on public.cargo_ocupacoes for each row execute function public.auditar();

-- ============ elegibilidade e ocupante ============
-- motivo que impede a pessoa de receber atividades (nulo = pode). p_cliente: a atividade é ligada a um cliente.
create or replace function public.colaborador_impedimento(p_colab uuid, p_cliente boolean default false) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.id is null then 'colaborador não encontrado'
    when c.fila_cargo_id is not null then null
    when not coalesce(c.ativo, false) then 'está inativo'
    when c.conta_teste then 'é conta de teste'
    when c.perfil_id is null or p.id is null or p.papel not in ('admin', 'colaborador') then 'não tem login no sistema'
    when p_cliente and p.papel <> 'admin' and not ('clientes' = any(coalesce(p.acessos, '{}'))) then 'não tem acesso a Clientes'
  end
  from (select p_colab as x) q left join public.colaboradores c on c.id = q.x left join public.perfis p on p.id = c.perfil_id
$$;
create or replace function public.colaborador_elegivel(p_colab uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.colaborador_impedimento(p_colab, false) is null and not exists (select 1 from public.colaboradores where id = p_colab and fila_cargo_id is not null)
$$;
create or replace function public.np_hoje() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- ocupante efetivo, sem escolha arbitrária:
--   coordenação: titular elegível e não afastado; senão, substituto elegível; senão, nulo
--   operacional: o ocupante elegível, quando há exatamente um; com vários, nulo (decide a regra do cargo: fila ou rodízio)
create or replace function public.cargo_ocupante(p_cargo uuid) returns uuid
language sql stable security definer set search_path = public as $$
  with e as (
    select o.colaborador_id, o.tipo, o.inicio, g.modalidade from public.cargo_ocupacoes o join public.cargos g on g.id = o.cargo_id
     where o.cargo_id = p_cargo and o.fim is null and g.ativo and public.colaborador_elegivel(o.colaborador_id) and not (o.afastado_de is not null and public.np_hoje() >= o.afastado_de and (o.afastado_ate is null or public.np_hoje() <= o.afastado_ate))
  )
  select case when (select max(modalidade) from e) = 'operacional'
              then (select (array_agg(colaborador_id))[1] from e having count(*) = 1)
              else (select colaborador_id from e order by (tipo = 'titular') desc, inicio limit 1) end
$$;
create or replace function public.cargo_fila(p_cargo uuid) returns uuid
language sql stable security definer set search_path = public as $$ select id from public.colaboradores where fila_cargo_id = p_cargo $$;

-- destino de uma atividade do cargo: o ocupante efetivo; com vários operadores, o próximo do rodízio (se a regra do cargo for rodízio); senão, a fila
create or replace function public.cargo_destino(p_cargo uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare r uuid; g public.cargos; ids uuid[]; i integer;
begin
  r := public.cargo_ocupante(p_cargo);
  if r is not null then return r; end if;
  select * into g from public.cargos where id = p_cargo;
  if g.ativo and g.modalidade = 'operacional' and g.distribuicao = 'rodizio' then
    select array_agg(o.colaborador_id order by o.ordem, o.inicio, o.id) into ids from public.cargo_ocupacoes o
     where o.cargo_id = p_cargo and o.fim is null and public.colaborador_elegivel(o.colaborador_id) and not (o.afastado_de is not null and public.np_hoje() >= o.afastado_de and (o.afastado_ate is null or public.np_hoje() <= o.afastado_ate));
    if coalesce(cardinality(ids), 0) > 0 then
      i := coalesce(array_position(ids, g.rodizio_ultimo), 0);
      r := ids[(i % cardinality(ids)) + 1];
      update public.cargos set rodizio_ultimo = r where id = p_cargo;
      return r;
    end if;
  end if;
  return public.cargo_fila(p_cargo);
end $$;
revoke all on function public.cargo_destino(uuid) from public, anon, authenticated;

-- a fila é uma ficha de sistema (sem login, inativa, sem núcleo): recebe o que não tem ocupante elegível
create or replace function public.cargos_fila_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('np.cargos_sync', '1', true);
  if not exists (select 1 from public.colaboradores where fila_cargo_id = new.id) then
    insert into public.colaboradores (nome, ativo, fila_cargo_id) values ('Distribuição pendente — ' || new.nome, false, new.id);
  else
    update public.colaboradores set nome = 'Distribuição pendente — ' || new.nome where fila_cargo_id = new.id and nome is distinct from 'Distribuição pendente — ' || new.nome;
  end if;
  perform set_config('np.cargos_sync', '', true);
  return new;
end $$;
drop trigger if exists cargos_fila on public.cargos;
create trigger cargos_fila after insert or update of nome on public.cargos for each row execute function public.cargos_fila_tg();

-- ============ distribuição: ocupante elegível ou fila; nunca antiguidade ============
create or replace function public.np_dist_marcar(p_colab uuid, p_cargo uuid) returns void language plpgsql as $$
begin perform set_config('np.dist', coalesce(current_setting('np.dist', true), '') || p_colab::text || '=' || p_cargo::text || ';', true); end $$;

create or replace function public.responsavel_padrao(p_nucleo text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare g uuid; r uuid;
begin
  select id into g from public.cargos where ativo and responsavel_nucleo and nucleo = p_nucleo;
  if g is null then return null; end if;
  r := public.cargo_destino(g);
  if r is not null then perform public.np_dist_marcar(r, g); end if;
  return r;
end $$;
create or replace function public.resp_frente(p_frente text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare g uuid; r uuid;
begin
  select id into g from public.cargos where ativo and responsavel_frente and frente = p_frente;
  if g is null then return null; end if;
  r := public.cargo_destino(g);
  if r is not null then perform public.np_dist_marcar(r, g); end if;
  return r;
end $$;

-- cargo que responde pelo núcleo (para redirecionar à fila)
create or replace function public.cargo_do_nucleo(p_nucleo text) returns uuid
language sql stable security definer set search_path = public as $$ select id from public.cargos where ativo and responsavel_nucleo and nucleo = p_nucleo $$;

-- tarefas e monitoramentos: (1) ninguém recebe atividade que não consegue abrir; (2) carimbo do vínculo institucional
create or replace function public.responsavel_guarda_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare imp text; g uuid; m text; j jsonb := to_jsonb(new); tem_cliente boolean := (j ->> 'cliente_id') is not null;
begin
  if new.responsavel_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.responsavel_id is not distinct from old.responsavel_id then return new; end if;
  select fila_cargo_id into g from public.colaboradores where id = new.responsavel_id;
  if g is not null then new.cargo_id := coalesce(new.cargo_id, g); return new; end if;      -- fila do cargo
  imp := public.colaborador_impedimento(new.responsavel_id, tem_cliente);
  if imp is not null then
    if tg_op = 'UPDATE' and auth.uid() is not null then
      raise exception '% não pode receber esta atividade: %. Escolha outra pessoa ou deixe na distribuição pendente.',
        (select nome from public.colaboradores where id = new.responsavel_id), imp using errcode = '23514';
    end if;
    -- inclusão (qualquer origem) ou automação: vai para a fila do cargo do núcleo, à vista da administradora
    g := coalesce(new.cargo_id, public.cargo_do_nucleo(coalesce(j ->> 'nucleo', (select nucleo from public.colaboradores where id = new.responsavel_id))));
    new.responsavel_id := case when g is not null then public.cargo_fila(g) end;
    new.cargo_id := g;
    return new;
  end if;
  if tg_op = 'INSERT' and new.cargo_id is null then                                             -- veio de responsavel_padrao()/resp_frente() nesta transação
    m := current_setting('np.dist', true);
    if m is not null and position(new.responsavel_id::text || '=' in m) > 0 then
      -- quem ocupa dois cargos: vale o cargo do núcleo da atividade; sem núcleo, a distribuição mais recente
      g := public.cargo_do_nucleo(coalesce(j ->> 'nucleo', case when tg_table_name = 'monitoramentos' then 'juridico' end)); -- o monitoramento é do Jurídico
      if g is not null and position(new.responsavel_id::text || '=' || g::text || ';' in m) > 0 then new.cargo_id := g;
      else new.cargo_id := substring(m from '.*' || new.responsavel_id::text || '=([0-9a-f-]{36});')::uuid;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_responsavel_guarda on public.tarefas;
create trigger tarefas_responsavel_guarda before insert or update of responsavel_id on public.tarefas for each row execute function public.responsavel_guarda_tg();
drop trigger if exists monitoramentos_responsavel_guarda on public.monitoramentos;
create trigger monitoramentos_responsavel_guarda before insert or update of responsavel_id on public.monitoramentos for each row execute function public.responsavel_guarda_tg();

-- histórico de responsáveis (quem era, quem passou a ser, por quem, por quê)
create or replace function public.responsavel_historico_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into public.responsavel_historico (tabela, registro, de, para, cargo_id, motivo, por)
    values (tg_table_name, new.id::text, old.responsavel_id, new.responsavel_id, nullif(to_jsonb(new) ->> 'cargo_id', '')::uuid,
            nullif(current_setting('np.motivo_transferencia', true), ''), auth.uid());
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['tarefas', 'monitoramentos', 'processos', 'negociacoes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_responsavel_hist', t);
    execute format('create trigger %I after update of responsavel_id on public.%I for each row execute function public.responsavel_historico_tg()', t || '_responsavel_hist', t);
  end loop;
end $$;

-- ============ projeção das ocupações nos acessos efetivos ============
create or replace function public.cargos_sincronizar(p_colab uuid) returns void language plpgsql security definer set search_path = public as $$
declare c public.colaboradores; ac text[]; nu text; fr text;
begin
  select * into c from public.colaboradores where id = p_colab;
  if c.id is null or not c.acesso_por_cargo or c.fila_cargo_id is not null then return; end if;
  select coalesce(array_agg(distinct a order by a), '{}') into ac
    from public.cargo_ocupacoes o join public.cargos g on g.id = o.cargo_id and g.ativo, unnest(g.acessos) a
   where o.colaborador_id = p_colab and o.fim is null;
  select case when g.nucleo = 'financeiro' then 'administrativo' else g.nucleo end, g.frente into nu, fr
    from public.cargo_ocupacoes o join public.cargos g on g.id = o.cargo_id and g.ativo
   where o.colaborador_id = p_colab and o.fim is null order by o.principal desc, (o.tipo = 'titular') desc, o.inicio limit 1;
  perform set_config('np.cargos_sync', '1', true);
  update public.colaboradores set nucleo = nu, frente = fr where id = p_colab and (nucleo is distinct from nu or frente is distinct from fr);
  if c.perfil_id is not null then
    update public.perfis set acessos = ac where id = c.perfil_id and papel <> 'admin' and acessos is distinct from ac;
  end if;
  perform set_config('np.cargos_sync', '', true);
end $$;
revoke all on function public.cargos_sincronizar(uuid) from public, anon, authenticated;

-- guardas: campos de permissão não mudam fora da gestão de cargos
create or replace function public.colaboradores_guarda_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare sinc boolean := coalesce(current_setting('np.cargos_sync', true), '') = '1';
begin
  if sinc then return new; end if;
  if (new.nucleo is distinct from old.nucleo or new.frente is distinct from old.frente or new.ativo is distinct from old.ativo
      or new.perfil_id is distinct from old.perfil_id or new.conta_teste is distinct from old.conta_teste
      or new.acesso_por_cargo is distinct from old.acesso_por_cargo or new.fila_cargo_id is distinct from old.fila_cargo_id
      or new.data_desligamento is distinct from old.data_desligamento) then
    if auth.uid() is not null and not public.sou_admin() then
      raise exception 'Núcleo, frente, situação e vínculo de login só mudam pela administradora.' using errcode = '42501';
    end if;
    if old.fila_cargo_id is not null then raise exception 'A ficha de distribuição pendente é do sistema.' using errcode = '42501'; end if;
    if old.acesso_por_cargo and not new.acesso_por_cargo and exists (select 1 from public.cargo_ocupacoes where colaborador_id = old.id and fim is null) then
      raise exception 'Esta pessoa ocupa cargos: os acessos dela vêm deles. Encerre as ocupações antes.' using errcode = '23514';
    end if;
    if old.acesso_por_cargo and (new.nucleo is distinct from old.nucleo or new.frente is distinct from old.frente) then
      raise exception 'O núcleo e a frente desta pessoa vêm dos cargos que ela ocupa. Altere pela gestão de cargos.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists colaboradores_guarda on public.colaboradores;
create trigger colaboradores_guarda before update on public.colaboradores for each row execute function public.colaboradores_guarda_tg();

create or replace function public.perfis_cargos_guarda_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.acessos is distinct from old.acessos and coalesce(current_setting('np.cargos_sync', true), '') <> '1'
     and exists (select 1 from public.colaboradores c where c.perfil_id = new.id and c.acesso_por_cargo) then
    raise exception 'Os acessos desta pessoa vêm dos cargos que ela ocupa. Altere pela gestão de cargos.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists perfis_cargos_guarda on public.perfis;
create trigger perfis_cargos_guarda before update on public.perfis for each row execute function public.perfis_cargos_guarda_tg();

-- ============ permissões por TODOS os cargos ativos ============
create or replace function public.edita_protecao() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and (p.papel = 'admin' or 'protecao' = any(p.acessos)))
      or exists (select 1 from public.colaboradores c where c.perfil_id = auth.uid() and not c.acesso_por_cargo and (c.frente = 'estrategico' or c.nucleo in ('acompanhamento_pj','pos_vendas','socios')))
      or exists (select 1 from public.colaboradores c join public.cargo_ocupacoes o on o.colaborador_id = c.id and o.fim is null
                   join public.cargos g on g.id = o.cargo_id and g.ativo
                  where c.perfil_id = auth.uid() and coalesce(c.ativo, true) and (g.frente = 'estrategico' or g.nucleo in ('acompanhamento_pj','pos_vendas','socios')))
$$;
create or replace function public.edita_ata() returns boolean language sql stable security definer set search_path = public as $$
  select public.edita_protecao()
      or exists (select 1 from public.colaboradores c where c.perfil_id = auth.uid() and coalesce(c.ativo, true) and not c.acesso_por_cargo and c.nucleo = 'acordos')
      or exists (select 1 from public.colaboradores c join public.cargo_ocupacoes o on o.colaborador_id = c.id and o.fim is null
                   join public.cargos g on g.id = o.cargo_id and g.ativo
                  where c.perfil_id = auth.uid() and coalesce(c.ativo, true) and g.nucleo = 'acordos')
$$;

-- ============ gestão (só a administradora) ============
create or replace function public.np_exige_admin() returns void language plpgsql as $$
begin if not public.sou_admin() then raise exception 'Só a administradora gere cargos e ocupações.' using errcode = '42501'; end if; end $$;

-- carteira institucional ABERTA do cargo. Não cria nem duplica nada.
--   coordenação: tudo o que é do cargo acompanha o ocupante efetivo (ou a fila).
--   operacional: a carteira é de cada ocupante. Só se move (1) a de quem saiu (p_de → p_para, ou fila) e (2) o que está na fila,
--   quando há um único ocupante ou a regra do cargo é rodízio. Com vários ocupantes e regra "fila", fica na fila para a gestão distribuir.
drop function if exists public.cargo_mover_carteira(uuid, text);
create or replace function public.cargo_mover_carteira(p_cargo uuid, p_motivo text, p_de uuid default null, p_para uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare g public.cargos; fila uuid := public.cargo_fila(p_cargo); alvo uuid; n integer := 0; k integer; r record;
begin
  select * into g from public.cargos where id = p_cargo;
  if g.id is null then return 0; end if;
  perform set_config('np.motivo_transferencia', coalesce(p_motivo, 'troca de ocupante do cargo'), true);
  if g.modalidade = 'coordenacao' then
    alvo := coalesce(public.cargo_ocupante(p_cargo), fila);
    if alvo is not null then
      update public.tarefas set responsavel_id = alvo where cargo_id = p_cargo and status in ('aberta', 'em_andamento') and responsavel_id is distinct from alvo;
      get diagnostics k = row_count; n := n + k;
      update public.monitoramentos set responsavel_id = alvo where cargo_id = p_cargo and responsavel_id is distinct from alvo;
      get diagnostics k = row_count; n := n + k;
    end if;
  elsif p_de is not null then
    alvo := case when p_para is not null and public.colaborador_impedimento(p_para, true) is null
                      and exists (select 1 from public.cargo_ocupacoes where cargo_id = p_cargo and colaborador_id = p_para and fim is null) then p_para else fila end;
    if alvo is not null then
      update public.tarefas set responsavel_id = alvo where cargo_id = p_cargo and status in ('aberta', 'em_andamento') and responsavel_id = p_de;
      get diagnostics k = row_count; n := n + k;
      update public.monitoramentos set responsavel_id = alvo where cargo_id = p_cargo and responsavel_id = p_de;
      get diagnostics k = row_count; n := n + k;
    end if;
  elsif fila is not null and (public.cargo_ocupante(p_cargo) is not null or g.distribuicao = 'rodizio') then
    for r in select 'tarefas'::text as t, id::text as i, created_at from public.tarefas where cargo_id = p_cargo and status in ('aberta', 'em_andamento') and responsavel_id = fila
             union all select 'monitoramentos', id::text, created_at from public.monitoramentos where cargo_id = p_cargo and responsavel_id = fila order by 3, 2 loop
      alvo := public.cargo_destino(p_cargo);
      exit when alvo is null or alvo = fila;
      execute format('update public.%I set responsavel_id = $1 where id::text = $2', r.t) using alvo, r.i;
      n := n + 1;
    end loop;
  end if;
  perform set_config('np.motivo_transferencia', '', true);
  return n;
end $$;
revoke all on function public.cargo_mover_carteira(uuid, text, uuid, uuid) from public, anon, authenticated;

drop function if exists public.cargo_salvar(uuid, text, text, text, text, text[], boolean, boolean, text, boolean);
create or replace function public.cargo_salvar(p_id uuid, p_codigo text, p_nome text, p_nucleo text, p_frente text, p_acessos text[],
  p_responsavel_nucleo boolean default false, p_responsavel_frente boolean default false, p_responsabilidades text default null, p_ativo boolean default true,
  p_modalidade text default 'coordenacao', p_distribuicao text default 'fila')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; r record;
begin
  perform public.np_exige_admin();
  if coalesce(p_modalidade, 'coordenacao') = 'operacional' and (coalesce(p_responsavel_nucleo, false) or coalesce(p_responsavel_frente, false)) then
    raise exception 'Responder por um núcleo ou frente é responsabilidade individual: o cargo precisa ser de coordenação.' using errcode = '23514';
  end if;
  if p_id is not null and coalesce(p_modalidade, 'coordenacao') = 'coordenacao' and (select count(*) from public.cargo_ocupacoes where cargo_id = p_id and fim is null and tipo = 'titular') > 1 then
    raise exception 'Este cargo tem mais de um ocupante. Deixe um só antes de torná-lo cargo de coordenação.' using errcode = '23514';
  end if;
  if p_id is not null and p_modalidade = 'operacional' and exists (select 1 from public.cargo_ocupacoes where cargo_id = p_id and fim is null and tipo = 'substituto') then
    raise exception 'Encerre a ocupação do substituto antes de tornar o cargo operacional.' using errcode = '23514';
  end if;
  if p_id is null then
    insert into public.cargos (codigo, nome, nucleo, frente, acessos, responsavel_nucleo, responsavel_frente, responsabilidades, ativo, modalidade, distribuicao, created_by, updated_by)
    values (p_codigo, btrim(p_nome), nullif(p_nucleo, ''), nullif(p_frente, ''), coalesce(p_acessos, '{}'), coalesce(p_responsavel_nucleo, false), coalesce(p_responsavel_frente, false), p_responsabilidades, coalesce(p_ativo, true), coalesce(p_modalidade, 'coordenacao'), coalesce(p_distribuicao, 'fila'), auth.uid(), auth.uid())
    returning id into v;
  else
    update public.cargos set nome = btrim(p_nome), nucleo = nullif(p_nucleo, ''), frente = nullif(p_frente, ''), acessos = coalesce(p_acessos, '{}'),
           responsavel_nucleo = coalesce(p_responsavel_nucleo, false), responsavel_frente = coalesce(p_responsavel_frente, false),
           responsabilidades = p_responsabilidades, ativo = coalesce(p_ativo, true), modalidade = coalesce(p_modalidade, 'coordenacao'), distribuicao = coalesce(p_distribuicao, 'fila'),
           updated_at = now(), updated_by = auth.uid()
     where id = p_id returning id into v;
    if v is null then raise exception 'Cargo não encontrado.' using errcode = 'P0002'; end if;
    for r in select colaborador_id from public.cargo_ocupacoes where cargo_id = v and fim is null loop perform public.cargos_sincronizar(r.colaborador_id); end loop;
  end if;
  return v;
end $$;

-- designa um ocupante. Coordenação: o titular anterior sai (transferência). Operacional: soma-se aos demais;
-- com p_substitui, a pessoa indicada sai e a carteira dela neste cargo passa ao novo ocupante.
-- A designação concede os acessos do cargo: não exige acesso pessoal anterior.
drop function if exists public.cargo_designar(uuid, uuid, text, text, boolean);
create or replace function public.cargo_designar(p_cargo uuid, p_colab uuid, p_tipo text default 'titular', p_motivo text default null, p_principal boolean default null, p_substitui uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.colaboradores; g public.cargos; v uuid; pr boolean; ord integer;
begin
  perform public.np_exige_admin();
  if p_tipo not in ('titular', 'substituto') then raise exception 'Tipo inválido.' using errcode = '22023'; end if;
  select * into g from public.cargos where id = p_cargo and ativo;
  if g.id is null then raise exception 'Cargo não encontrado ou inativo.' using errcode = 'P0002'; end if;
  if g.modalidade = 'operacional' and p_tipo <> 'titular' then raise exception 'Cargo operacional não tem substituto: todos os ocupantes atuam ao mesmo tempo.' using errcode = '23514'; end if;
  select * into c from public.colaboradores where id = p_colab for update;
  if c.id is null or c.fila_cargo_id is not null then raise exception 'Colaborador não encontrado.' using errcode = 'P0002'; end if;
  if not coalesce(c.ativo, false) then raise exception 'Colaborador inativo não ocupa cargo.' using errcode = '23514'; end if;
  if c.conta_teste then raise exception 'Conta de teste não ocupa cargo.' using errcode = '23514'; end if;
  if p_substitui is not null and (g.modalidade <> 'operacional' or p_substitui = p_colab) then raise exception 'A substituição nominal vale só entre ocupantes de um cargo operacional.' using errcode = '22023'; end if;
  -- a mesma pessoa não fica duas vezes no mesmo cargo
  update public.cargo_ocupacoes set fim = now(), principal = false, motivo_fim = 'mudança de tipo de ocupação', encerrado_por = auth.uid() where cargo_id = p_cargo and colaborador_id = p_colab and fim is null;
  if g.modalidade = 'coordenacao' and p_tipo = 'titular' then
    update public.cargo_ocupacoes set fim = now(), principal = false, motivo_fim = coalesce(p_motivo, 'transferência da ocupação'), encerrado_por = auth.uid()
     where cargo_id = p_cargo and fim is null and tipo = 'titular';
  elsif p_substitui is not null then
    update public.cargo_ocupacoes set fim = now(), principal = false, motivo_fim = coalesce(p_motivo, 'transferência da ocupação'), encerrado_por = auth.uid()
     where cargo_id = p_cargo and colaborador_id = p_substitui and fim is null;
    if not found then raise exception 'A pessoa substituída não ocupa este cargo.' using errcode = 'P0002'; end if;
  end if;
  pr := coalesce(p_principal, not exists (select 1 from public.cargo_ocupacoes where colaborador_id = p_colab and fim is null and principal));
  if pr then update public.cargo_ocupacoes set principal = false where colaborador_id = p_colab and fim is null and principal; end if;
  select coalesce(max(ordem), 0) + 1 into ord from public.cargo_ocupacoes where cargo_id = p_cargo and fim is null;
  insert into public.cargo_ocupacoes (cargo_id, colaborador_id, tipo, principal, ordem, motivo, criado_por) values (p_cargo, p_colab, p_tipo, pr, ord, p_motivo, auth.uid()) returning id into v;
  if not c.acesso_por_cargo then
    perform set_config('np.cargos_sync', '1', true); update public.colaboradores set acesso_por_cargo = true where id = p_colab; perform set_config('np.cargos_sync', '', true);
  end if;
  perform public.cargos_sincronizar(p_colab);
  perform public.cargos_sincronizar(x.colaborador_id) from (select distinct colaborador_id from public.cargo_ocupacoes where cargo_id = p_cargo and fim is not null and fim >= now() - interval '1 minute' and colaborador_id <> p_colab) x;
  if p_substitui is not null then perform public.cargo_mover_carteira(p_cargo, coalesce(p_motivo, 'troca de ocupante do cargo'), p_substitui, p_colab); end if;
  perform public.cargo_mover_carteira(p_cargo, coalesce(p_motivo, 'troca de ocupante do cargo'));
  return v;
end $$;

drop function if exists public.cargo_encerrar(uuid, text);
create or replace function public.cargo_encerrar(p_ocupacao uuid, p_motivo text, p_para uuid default null) returns void language plpgsql security definer set search_path = public as $$
declare o public.cargo_ocupacoes;
begin
  perform public.np_exige_admin();
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do encerramento.' using errcode = '22023'; end if;
  update public.cargo_ocupacoes set fim = now(), motivo_fim = btrim(p_motivo), encerrado_por = auth.uid(), principal = false where id = p_ocupacao and fim is null returning * into o;
  if o.id is null then raise exception 'Ocupação não encontrada ou já encerrada.' using errcode = 'P0002'; end if;
  perform public.cargos_sincronizar(o.colaborador_id);
  -- operacional: a carteira de quem saiu vai para p_para (outro ocupante do cargo) ou para a fila; coordenação: acompanha o ocupante efetivo
  perform public.cargo_mover_carteira(o.cargo_id, 'ocupação encerrada: ' || btrim(p_motivo), o.colaborador_id, p_para);
end $$;

-- ordem do ocupante no rodízio do cargo operacional
create or replace function public.cargo_ordem(p_ocupacao uuid, p_ordem integer) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.np_exige_admin();
  update public.cargo_ocupacoes set ordem = coalesce(p_ordem, 0) where id = p_ocupacao and fim is null;
  if not found then raise exception 'Ocupação não encontrada ou já encerrada.' using errcode = 'P0002'; end if;
end $$;

-- afastamento temporário do titular: o substituto assume as distribuições novas no período
create or replace function public.cargo_afastar(p_ocupacao uuid, p_de date, p_ate date) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.np_exige_admin();
  if p_de is not null and p_ate is not null and p_ate < p_de then raise exception 'Período inválido.' using errcode = '22023'; end if;
  update public.cargo_ocupacoes set afastado_de = p_de, afastado_ate = p_ate where id = p_ocupacao and fim is null;
  if not found then raise exception 'Ocupação não encontrada ou já encerrada.' using errcode = 'P0002'; end if;
end $$;

-- distribui ao ocupante o que está na fila do cargo (ato da administradora)
create or replace function public.cargo_distribuir_pendentes(p_cargo uuid) returns integer language plpgsql security definer set search_path = public as $$
begin
  perform public.np_exige_admin();
  if public.cargo_ocupante(p_cargo) is null then raise exception 'O cargo não tem ocupante elegível: designe um titular ou substituto antes.' using errcode = '23514'; end if;
  return public.cargo_mover_carteira(p_cargo, 'distribuição da fila do cargo');
end $$;

-- transferência controlada de uma atividade nominal
create or replace function public.atividade_transferir(p_tabela text, p_id text, p_para uuid, p_motivo text) returns void language plpgsql security definer set search_path = public as $$
declare imp text; n integer;
begin
  perform public.np_exige_admin();
  if p_tabela not in ('tarefas', 'monitoramentos', 'processos', 'negociacoes') then raise exception 'Tabela não permitida.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da transferência.' using errcode = '22023'; end if;
  imp := public.colaborador_impedimento(p_para, true);
  if imp is not null then raise exception 'O destinatário não pode receber a atividade: %.', imp using errcode = '23514'; end if;
  perform set_config('np.motivo_transferencia', btrim(p_motivo), true);
  execute format('update public.%I set responsavel_id = $1 where id::text = $2', p_tabela) using p_para, p_id;
  get diagnostics n = row_count;
  perform set_config('np.motivo_transferencia', '', true);
  if n <> 1 then raise exception 'Atividade não encontrada.' using errcode = 'P0002'; end if;
end $$;

-- envia uma atividade ao CARGO (vínculo institucional): fica com o ocupante efetivo, com o próximo do rodízio ou na fila do cargo
create or replace function public.atividade_para_cargo(p_tabela text, p_id text, p_cargo uuid, p_motivo text) returns uuid language plpgsql security definer set search_path = public as $$
declare alvo uuid; n integer;
begin
  perform public.np_exige_admin();
  if p_tabela not in ('tarefas', 'monitoramentos') then raise exception 'Tabela não permitida.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da transferência.' using errcode = '22023'; end if;
  if not exists (select 1 from public.cargos where id = p_cargo and ativo) then raise exception 'Cargo não encontrado ou inativo.' using errcode = 'P0002'; end if;
  alvo := public.cargo_destino(p_cargo);
  if alvo is null then raise exception 'O cargo não tem fila de distribuição.' using errcode = 'P0002'; end if;
  perform set_config('np.motivo_transferencia', btrim(p_motivo), true);
  execute format('update public.%I set cargo_id = $3, responsavel_id = $1 where id::text = $2', p_tabela) using alvo, p_id, p_cargo;
  get diagnostics n = row_count;
  perform set_config('np.motivo_transferencia', '', true);
  if n <> 1 then raise exception 'Atividade não encontrada.' using errcode = 'P0002'; end if;
  return alvo;
end $$;

-- marcar/desmarcar conta de teste (sai de toda distribuição; não ocupa cargo)
create or replace function public.colaborador_conta_teste(p_colab uuid, p_teste boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.np_exige_admin();
  if p_teste and exists (select 1 from public.cargo_ocupacoes where colaborador_id = p_colab and fim is null) then raise exception 'Encerre as ocupações antes de marcar como conta de teste.' using errcode = '23514'; end if;
  update public.colaboradores set conta_teste = coalesce(p_teste, false) where id = p_colab and fila_cargo_id is null;
  if not found then raise exception 'Colaborador não encontrado.' using errcode = 'P0002'; end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['cargo_salvar(uuid,text,text,text,text,text[],boolean,boolean,text,boolean,text,text)', 'cargo_designar(uuid,uuid,text,text,boolean,uuid)', 'cargo_encerrar(uuid,text,uuid)',
    'cargo_ordem(uuid,integer)', 'atividade_para_cargo(text,text,uuid,text)',
    'cargo_afastar(uuid,date,date)', 'cargo_distribuir_pendentes(uuid)', 'atividade_transferir(text,text,uuid,text)', 'colaborador_conta_teste(uuid,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============ visões para Equipe e gestão ============
drop view if exists public.v_cargos;
create view public.v_cargos with (security_invoker = true) as
select g.id, g.codigo, g.nome, g.nucleo, g.frente, g.acessos, g.responsavel_nucleo, g.responsavel_frente, g.responsabilidades, g.ativo, g.modalidade, g.distribuicao,
       t.colaborador_id as titular_id, ct.nome as titular, public.colaborador_impedimento(t.colaborador_id, false) as titular_pendencia,
       (t.afastado_de is not null and public.np_hoje() >= t.afastado_de and (t.afastado_ate is null or public.np_hoje() <= t.afastado_ate)) as titular_afastado,
       s.colaborador_id as substituto_id, cs.nome as substituto, public.colaborador_impedimento(s.colaborador_id, false) as substituto_pendencia,
       public.cargo_ocupante(g.id) as ocupante_id,
       (select count(*) from public.cargo_ocupacoes o where o.cargo_id = g.id and o.fim is null and o.tipo = 'titular') as ocupantes_n,
       not exists (select 1 from public.cargo_ocupacoes o where o.cargo_id = g.id and o.fim is null and public.colaborador_elegivel(o.colaborador_id)
                     and not (o.afastado_de is not null and public.np_hoje() >= o.afastado_de and (o.afastado_ate is null or public.np_hoje() <= o.afastado_ate))) as vago,
       coalesce((select jsonb_agg(jsonb_build_object('ocupacao_id', o.id, 'colaborador_id', o.colaborador_id, 'nome', c.nome, 'tipo', o.tipo, 'principal', o.principal, 'ordem', o.ordem,
                   'inicio', o.inicio, 'afastado_de', o.afastado_de, 'afastado_ate', o.afastado_ate, 'pendencia', public.colaborador_impedimento(o.colaborador_id, false),
                   'tarefas_abertas', (select count(*) from public.tarefas x where x.cargo_id = g.id and x.responsavel_id = o.colaborador_id and x.status in ('aberta', 'em_andamento')))
                 order by (o.tipo = 'titular') desc, o.ordem, o.inicio)
            from public.cargo_ocupacoes o join public.colaboradores c on c.id = o.colaborador_id where o.cargo_id = g.id and o.fim is null), '[]'::jsonb) as ocupantes,
       (select count(*) from public.tarefas x where x.cargo_id = g.id and x.status in ('aberta', 'em_andamento')) as tarefas_abertas,
       (select count(*) from public.monitoramentos x where x.cargo_id = g.id) as monitoramentos,
       (select count(*) from public.tarefas x where x.responsavel_id = public.cargo_fila(g.id) and x.status in ('aberta', 'em_andamento'))
         + (select count(*) from public.monitoramentos x where x.responsavel_id = public.cargo_fila(g.id)) as na_fila
  from public.cargos g
  left join lateral (select * from public.cargo_ocupacoes t where t.cargo_id = g.id and t.fim is null and t.tipo = 'titular' order by t.ordem, t.inicio limit 1) t on true
  left join public.colaboradores ct on ct.id = t.colaborador_id
  left join lateral (select * from public.cargo_ocupacoes s where s.cargo_id = g.id and s.fim is null and s.tipo = 'substituto' order by s.inicio limit 1) s on true
  left join public.colaboradores cs on cs.id = s.colaborador_id;

-- fonte única: os acessos gravados de quem é gerido por cargo têm de ser exatamente os dos cargos ativos (deve ficar sempre vazia)
create or replace view public.v_cargos_divergencias with (security_invoker = true) as
select c.id as colaborador_id, c.nome, p.acessos as acessos_gravados, x.ac as acessos_dos_cargos
  from public.colaboradores c join public.perfis p on p.id = c.perfil_id
  cross join lateral (select coalesce(array_agg(distinct a order by a), '{}') as ac
                        from public.cargo_ocupacoes o join public.cargos g on g.id = o.cargo_id and g.ativo, unnest(g.acessos) a
                       where o.colaborador_id = c.id and o.fim is null) x
 where c.acesso_por_cargo and p.papel <> 'admin' and coalesce(p.acessos, '{}') is distinct from x.ac;

-- o que espera distribuição: na fila de um cargo, ou sem responsável
create or replace view public.v_distribuicao_pendente with (security_invoker = true) as
select 'tarefas'::text as tabela, t.id::text as registro, t.titulo as descricao, t.cliente_id, t.prazo, t.prioridade, t.cargo_id, g.nome as cargo, t.created_at
  from public.tarefas t left join public.colaboradores c on c.id = t.responsavel_id left join public.cargos g on g.id = coalesce(t.cargo_id, c.fila_cargo_id)
 where t.status in ('aberta', 'em_andamento') and (t.responsavel_id is null or c.fila_cargo_id is not null)
union all
select 'monitoramentos', m.id::text, 'Monitoramento do cliente', m.cliente_id, m.proxima_checagem, null, m.cargo_id, g.nome, m.created_at
  from public.monitoramentos m left join public.colaboradores c on c.id = m.responsavel_id left join public.cargos g on g.id = coalesce(m.cargo_id, c.fila_cargo_id)
 where m.responsavel_id is null or c.fila_cargo_id is not null;

-- atividades nominais com quem não pode mais recebê-las (transferência controlada, caso a caso)
create or replace view public.v_transferencias_pendentes with (security_invoker = true) as
select x.tabela, x.registro, x.descricao, x.cliente_id, x.prazo, x.responsavel_id, c.nome as responsavel, public.colaborador_impedimento(x.responsavel_id, x.cliente_id is not null) as impedimento
  from (
    select 'tarefas'::text as tabela, id::text as registro, titulo as descricao, cliente_id, prazo, responsavel_id from public.tarefas where status in ('aberta', 'em_andamento') and responsavel_id is not null
    union all select 'monitoramentos', id::text, 'Monitoramento do cliente', cliente_id, proxima_checagem, responsavel_id from public.monitoramentos where responsavel_id is not null
    union all select 'processos', id::text, coalesce(numero_cnj, 'processo'), cliente_id, null::date, responsavel_id from public.processos where responsavel_id is not null and status = 'ativo'
    union all select 'negociacoes', id::text, coalesce(titulo, 'negociação'), cliente_id, null::date, responsavel_id from public.negociacoes where responsavel_id is not null and etapa <> 'concluido'
  ) x join public.colaboradores c on c.id = x.responsavel_id
 where c.fila_cargo_id is null and public.colaborador_impedimento(x.responsavel_id, x.cliente_id is not null) is not null;
grant select on public.v_cargos, public.v_cargos_divergencias, public.v_distribuicao_pendente, public.v_transferencias_pendentes to authenticated;

-- ============ catálogo inicial de cargos (SEM ocupantes; a gestão designa) ============
insert into public.cargos (codigo, nome, nucleo, frente, acessos, responsavel_nucleo, responsavel_frente, responsabilidades) values
  ('responsavel_juridico', 'Responsável Jurídico', 'juridico', 'juridico', '{clientes,juridico,tarefas_equipe}', true, true,
   'Responde pelo núcleo Jurídico: monitoramento de clientes novos, clientes direcionados para peça, distribuição das tarefas jurídicas.'),
  ('operador_juridico', 'Operador Jurídico', 'juridico', 'juridico', '{clientes,juridico,superendividamento}', false, false,
   'Executa as atividades jurídicas atribuídas: prazos, publicações, peças, monitoramentos e superendividamento.'),
  ('controladoria_juridica', 'Controladoria Jurídica', 'juridico', null, '{clientes,juridico,tarefas_equipe}', false, false,
   'Controla prazos, publicações e a carga de tarefas da equipe jurídica.'),
  ('responsavel_acompanhamento_pj', 'Responsável pelo Acompanhamento PJ', 'acompanhamento_pj', 'estrategico', '{clientes,juridico,protecao}', true, true,
   'Conduz o ciclo de acompanhamento, o Raio-X, as atas e a proteção patrimonial dos clientes PJ.'),
  ('responsavel_acordos', 'Responsável por Acordos', 'acordos', 'negocial', '{clientes,juridico}', true, true,
   'Conduz negociações e acordos; recebe o estudo de caso de clientes novos e o pós-acordo.'),
  ('responsavel_comercial', 'Responsável Comercial', 'comercial', null, '{comercial}', true, false,
   'Recebe leads do site e fechamentos; conduz o funil comercial.'),
  ('responsavel_marketing', 'Responsável pelo Marketing', 'marketing', null, '{marketing,growth}', true, false,
   'Conduz o marketing e os indicadores de crescimento.'),
  ('responsavel_financeiro', 'Responsável Financeiro', 'financeiro', null, '{financeiro,clientes}', true, false,
   'Responde pelas cobranças, pela régua e pelas tarefas financeiras de clientes novos.'),
  ('responsavel_administrativo', 'Responsável Administrativo', 'administrativo', null, '{equipe,clientes,atendimento}', true, false,
   'Responde pelo administrativo: requisições, estoque, inventário e atendimento.')
on conflict (codigo) do nothing;
-- o Operador Jurídico é cargo operacional (vários ocupantes; atividades novas ficam na fila do cargo até a gestão distribuir)
update public.cargos set modalidade = 'operacional', distribuicao = 'fila' where codigo = 'operador_juridico' and created_at = now();

select 'ok 0113' as resultado,
       (select count(*) from public.cargos) as cargos,
       (select count(*) from public.cargo_ocupacoes) as ocupacoes,
       (select count(*) from public.colaboradores where fila_cargo_id is not null) as filas,
       (select count(*) from public.colaboradores where acesso_por_cargo) as geridos_por_cargo,
       (select count(*) from pg_trigger where tgname in ('tarefas_responsavel_guarda', 'monitoramentos_responsavel_guarda', 'colaboradores_guarda', 'perfis_cargos_guarda')) as guardas;
