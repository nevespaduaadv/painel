-- 0114b · Prazos sugeridos: quem confere e quem revisa (regra definida pelas sócias em 17/11)
--
-- Depende da 0114 (já aplicada no beta). Só redefine funções e cria uma visão: não altera dados, não cria tarefa, não cria
-- agendamento, não faz chamada externa. NÃO APLICADA em nenhum ambiente.
--
-- CONFERÊNCIA INICIAL — não basta ter acesso ao módulo Jurídico. Confere quem tem acesso ao Jurídico E atribuição sobre aquela
-- publicação: responsável pelo processo, responsável pela tarefa de análise, pessoa a quem a publicação foi encaminhada, ou
-- integrante da carteira de publicações (integracoes.config.conferentes_publicacoes, definida pela administração). Revisores também.
--
-- SEGUNDA REVISÃO (prazo fatal, data posterior à sugerida, sugestão descartada) — por pessoa diferente de quem conferiu, que seja:
--   · ocupante do cargo Responsável Jurídico (quando a 0113 existir); ou
--   · ocupante do cargo Controladoria Jurídica, se a administração autorizar (config.controladoria_revisa = true); ou
--   · pessoa indicada pela administração em config.revisores_prazo (enquanto os cargos não existem).
-- A revisão é SEMPRE de outra pessoa, mesmo quando quem conferiu é revisor. Sem revisor disponível além de quem conferiu, fica na FILA ADMINISTRATIVA (v_prazos_em_revisao), visível à administração, que então
-- pode revisar. Ninguém é sorteado. A tarefa do prazo já existe desde a conferência inicial; a revisão nunca apaga o histórico.

create or replace function public.prazo_revisores_definidos(p_exceto uuid default null) returns integer language plpgsql stable security definer set search_path = public as $$
declare n integer := 0; c integer := 0; cfg jsonb;
begin
  select config into cfg from public.integracoes where id = 'sync';
  select count(*) into n from jsonb_array_elements_text(coalesce(cfg -> 'revisores_prazo', '[]'::jsonb)) x join public.perfis pf on pf.id::text = x where pf.papel in ('admin', 'colaborador') and pf.id is distinct from p_exceto;
  if to_regclass('public.cargo_ocupacoes') is not null and to_regclass('public.cargos') is not null then
    execute $q$ select count(distinct o.colaborador_id) from public.cargo_ocupacoes o join public.cargos c on c.id = o.cargo_id join public.colaboradores co on co.id = o.colaborador_id
                 where o.fim is null and co.perfil_id is not null and co.perfil_id is distinct from $2 and coalesce(co.ativo, true) and (c.codigo = 'responsavel_juridico' or (c.codigo = 'controladoria_juridica' and $1)) $q$
      into c using coalesce((cfg ->> 'controladoria_revisa')::boolean, false), p_exceto;
  end if;
  return n + c;
end $$;

create or replace function public.prazo_revisor() returns boolean language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; ok boolean := false;
begin
  if auth.uid() is null or not public.sou_equipe() then return false; end if;
  select config into cfg from public.integracoes where id = 'sync';
  if coalesce(cfg -> 'revisores_prazo', '[]'::jsonb) ? auth.uid()::text then return true; end if;
  if to_regclass('public.cargo_ocupacoes') is not null and to_regclass('public.cargos') is not null then
    execute $q$ select exists (select 1 from public.cargo_ocupacoes o join public.cargos c on c.id = o.cargo_id join public.colaboradores co on co.id = o.colaborador_id
                 where o.fim is null and co.perfil_id = $1 and coalesce(co.ativo, true) and (c.codigo = 'responsavel_juridico' or (c.codigo = 'controladoria_juridica' and $2))) $q$
      into ok using auth.uid(), coalesce((cfg ->> 'controladoria_revisa')::boolean, false);
    if ok then return true; end if;
  end if;
  -- fila administrativa: sem nenhum revisor definido, a administração revisa
  return public.sou_admin() and public.prazo_revisores_definidos() = 0;
end $$;

create or replace function public.pode_conferir_prazo(p_publicacao bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.prazo_revisor() or (public.sou_equipe() and (public.sou_admin() or public.tem_acesso('juridico')) and (
    coalesce((select (config -> 'conferentes_publicacoes') ? auth.uid()::text from public.integracoes where id = 'sync'), false)
    or exists (select 1 from public.publicacoes pb left join public.processos pr on pr.id = pb.processo_id left join public.tarefas t on t.id = pb.tarefa_id
                where pb.id = p_publicacao and exists (select 1 from public.colaboradores co where co.perfil_id = auth.uid() and coalesce(co.ativo, true) and co.id in (pr.responsavel_id, t.responsavel_id, pb.encaminhada_para))))) $$;
-- a versão sem argumento (0114) deixa de valer como autorização: passa a responder "não" para não ser usada por engano
create or replace function public.pode_conferir_prazo() returns boolean language sql stable security definer set search_path = public as $$ select false $$;
grant execute on function public.pode_conferir_prazo(bigint), public.prazo_revisores_definidos(uuid) to authenticated;

create or replace function public.publicacao_prazo_conferir(p_prazo bigint, p_decisao text, p_data date default null, p_fatal boolean default false, p_obs text default null, p_tarefa boolean default true, p_responsavel uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.publicacao_prazos; pb public.publicacoes; nome text; dt date; t uuid; antes jsonb; criou boolean := false; fat boolean := coalesce(p_fatal, false);
        critico text; pend boolean; aberta boolean; tem_motivo boolean; mot text;
begin
  if p_decisao not in ('confirmar', 'corrigir', 'descartar', 'reabrir') then raise exception 'Decisão inválida.' using errcode = '22023'; end if;
  select * into pr from public.publicacao_prazos where id = p_prazo for update;
  if pr.id is null then raise exception 'Prazo não encontrado.' using errcode = 'P0002'; end if;
  select * into pb from public.publicacoes where id = pr.publicacao_id;
  if not public.pode_conferir_prazo(pr.publicacao_id) then raise exception 'A conferência cabe a quem responde por este processo ou pela carteira de publicações.' using errcode = '42501'; end if;
  select pf.nome into nome from public.perfis pf where pf.id = auth.uid();
  antes := jsonb_build_object('estado', pr.estado, 'data_conferida', pr.data_conferida, 'fatal', pr.fatal, 'tarefa_id', pr.tarefa_id, 'revisao_pendente', pr.revisao_pendente);
  if p_decisao = 'reabrir' then
    if length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da reabertura.' using errcode = '22023'; end if;
    update public.publicacao_prazos set estado = 'sugerido', revisao_pendente = false, revisao_motivo = null, atualizado_em = now() where id = pr.id;   -- a conferência anterior fica no histórico; a tarefa não é apagada
    insert into public.publicacao_prazo_historico (prazo_id, acao, de, observacao, por, por_nome) values (pr.id, 'reaberto', antes, btrim(p_obs), auth.uid(), nome);
    return jsonb_build_object('estado', 'sugerido');
  end if;
  if pr.estado <> 'sugerido' then raise exception 'Este prazo já foi conferido. Reabra antes de mudar.' using errcode = '23514'; end if;
  if p_decisao = 'descartar' then
    if length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe por que a sugestão não se aplica.' using errcode = '22023'; end if;
    pend := true;   -- descarte: revisão independente sempre
    update public.publicacao_prazos set estado = 'descartado', conferido_por = auth.uid(), conferido_por_nome = nome, conferido_em = now(), observacao = btrim(p_obs),
           revisao_pendente = pend, revisao_motivo = case when pend then 'sugestão descartada' end, revisado_por = null, revisado_por_nome = null, revisado_em = null, atualizado_em = now() where id = pr.id;
    insert into public.publicacao_prazo_historico (prazo_id, acao, de, para, observacao, por, por_nome) values (pr.id, 'descartado', antes, jsonb_build_object('revisao_pendente', pend), btrim(p_obs), auth.uid(), nome);
    return jsonb_build_object('estado', 'descartado', 'revisao_pendente', pend);
  end if;
  dt := case when p_decisao = 'confirmar' then coalesce(p_data, pr.data_sugerida) else p_data end;
  if dt is null then raise exception 'Informe a data do prazo.' using errcode = '22023'; end if;
  if p_decisao = 'confirmar' and dt is distinct from pr.data_sugerida then raise exception 'A data difere da sugerida: use "corrigir" e registre o motivo.' using errcode = '22023'; end if;
  if p_decisao = 'corrigir' and length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da correção.' using errcode = '22023'; end if;
  critico := case when fat then 'prazo fatal' when p_decisao = 'corrigir' and pr.data_sugerida is not null and dt > pr.data_sugerida then 'data posterior à sugerida' end;
  pend := critico is not null;   -- situação crítica: revisão independente sempre, mesmo quando quem conferiu é revisor
  t := pr.tarefa_id;
  if p_tarefa then
    select exists (select 1 from public.tarefas tf where tf.id = t and tf.status in ('aberta', 'em_andamento')) into aberta;
    if aberta then
      -- reconferência depois de uma reabertura: a MESMA tarefa recebe a nova data (onde existe a disciplina de prazos, com o motivo)
      mot := 'Prazo reconferido a partir da publicação' || coalesce(' — ' || nullif(btrim(coalesce(p_obs, '')), ''), '');
      select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarefas' and column_name = 'motivo_reagendamento') into tem_motivo;
      if tem_motivo then execute 'update public.tarefas set prazo = $1, prazo_fatal = $2, motivo_reagendamento = $3, updated_at = now() where id = $4' using dt, fat, mot, t;
      else update public.tarefas set prazo = dt, prazo_fatal = fat, updated_at = now() where id = t; end if;
      insert into public.publicacao_prazo_historico (prazo_id, acao, para, por, por_nome) values (pr.id, 'tarefa_atualizada', jsonb_build_object('tarefa_id', t, 'prazo', dt, 'fatal', fat), auth.uid(), nome);
    else
      insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, status, prioridade, publicacao_id)
      values (coalesce(pr.rotulo, 'Cumprir prazo') || ' · ' || coalesce(pb.numero_processo, ''),
              'Prazo conferido por ' || coalesce(nome, 'Jurídico') || ' a partir da publicação de ' || to_char(pb.data_disponibilizacao, 'DD/MM/YYYY') || '. Data sugerida pela plataforma: ' || coalesce(to_char(pr.data_sugerida, 'DD/MM/YYYY'), '—') || '.'
                || case when pend then E'\nAguardando revisão de quem responde pelo Jurídico (' || critico || ').' else '' end || coalesce(E'\n' || nullif(btrim(coalesce(p_obs, '')), ''), ''),
              pb.cliente_id, pb.processo_id, coalesce(p_responsavel, (select x.responsavel_id from public.processos x where x.id = pb.processo_id)), 'juridico', dt, fat, 'aberta', 1, pb.id) returning id into t;
      criou := true;
      insert into public.publicacao_prazo_historico (prazo_id, acao, para, por, por_nome) values (pr.id, 'tarefa_criada', jsonb_build_object('tarefa_id', t, 'prazo', dt, 'fatal', fat), auth.uid(), nome);
    end if;
  end if;
  update public.publicacao_prazos set estado = case when p_decisao = 'confirmar' then 'confirmado' else 'corrigido' end, data_conferida = dt, fatal = fat,
         conferido_por = auth.uid(), conferido_por_nome = nome, conferido_em = now(), observacao = nullif(btrim(coalesce(p_obs, '')), ''), tarefa_id = t,
         revisao_pendente = pend, revisao_motivo = case when pend then critico end, revisado_por = null, revisado_por_nome = null, revisado_em = null, atualizado_em = now() where id = pr.id;
  insert into public.publicacao_prazo_historico (prazo_id, acao, de, para, observacao, por, por_nome)
  values (pr.id, case when p_decisao = 'confirmar' then 'confirmado' else 'corrigido' end, antes, jsonb_build_object('data_sugerida', pr.data_sugerida, 'data_conferida', dt, 'fatal', fat, 'revisao_pendente', pend), nullif(btrim(coalesce(p_obs, '')), ''), auth.uid(), nome);
  return jsonb_build_object('estado', case when p_decisao = 'confirmar' then 'confirmado' else 'corrigido' end, 'data_conferida', dt, 'tarefa_id', t, 'tarefa_criada', criou, 'revisao_pendente', pend);
end $$;


create or replace function public.publicacao_prazo_revisar(p_prazo bigint, p_decisao text, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr public.publicacao_prazos; nome text;
begin
  if p_decisao not in ('aprovar', 'devolver') then raise exception 'Decisão inválida.' using errcode = '22023'; end if;
  select * into pr from public.publicacao_prazos where id = p_prazo for update;
  if pr.id is null then raise exception 'Prazo não encontrado.' using errcode = 'P0002'; end if;
  if not pr.revisao_pendente then raise exception 'Este prazo não está aguardando revisão.' using errcode = '23514'; end if;
  if pr.conferido_por = auth.uid() then raise exception 'A revisão é de outra pessoa: quem conferiu não revisa.' using errcode = '42501'; end if;
  -- revisa: revisor definido; ou a administração, quando não há revisor além de quem conferiu (fila administrativa)
  if not (public.prazo_revisor() or (public.sou_admin() and public.prazo_revisores_definidos(pr.conferido_por) = 0)) then raise exception 'A revisão cabe ao Responsável Jurídico ou à Controladoria autorizada.' using errcode = '42501'; end if;
  select pf.nome into nome from public.perfis pf where pf.id = auth.uid();
  if p_decisao = 'devolver' then
    if length(btrim(coalesce(p_obs, ''))) < 5 then raise exception 'Informe o motivo da devolução.' using errcode = '22023'; end if;
    update public.publicacao_prazos set estado = 'sugerido', revisao_pendente = false, revisao_motivo = null, atualizado_em = now() where id = pr.id;
    insert into public.publicacao_prazo_historico (prazo_id, acao, de, observacao, por, por_nome)
    values (pr.id, 'revisao_devolvida', jsonb_build_object('estado', pr.estado, 'data_conferida', pr.data_conferida, 'fatal', pr.fatal, 'conferido_por_nome', pr.conferido_por_nome), btrim(p_obs), auth.uid(), nome);
    return jsonb_build_object('estado', 'sugerido');
  end if;
  update public.publicacao_prazos set revisao_pendente = false, revisado_por = auth.uid(), revisado_por_nome = nome, revisado_em = now(), atualizado_em = now() where id = pr.id;
  insert into public.publicacao_prazo_historico (prazo_id, acao, de, observacao, por, por_nome) values (pr.id, 'revisao_aprovada', jsonb_build_object('motivo', pr.revisao_motivo), nullif(btrim(coalesce(p_obs, '')), ''), auth.uid(), nome);
  return jsonb_build_object('estado', pr.estado, 'revisado', true);
end $$;

-- fila de revisão: o que está pendente, de quem é a conferência e há quanto tempo. Visível a quem tem acesso ao Jurídico e à administração.
create or replace view public.v_prazos_em_revisao with (security_invoker = true) as
select z.id as prazo_id, z.publicacao_id, pb.numero_processo, pb.processo_id, pb.cliente_id, z.rotulo, z.data_sugerida, z.data_conferida, z.fatal, z.estado, z.revisao_motivo,
       z.conferido_por, z.conferido_por_nome, z.conferido_em, z.tarefa_id, public.prazo_revisores_definidos(z.conferido_por) = 0 as fila_administrativa
  from public.publicacao_prazos z join public.publicacoes pb on pb.id = z.publicacao_id where z.revisao_pendente;
grant select on public.v_prazos_em_revisao to authenticated;

select 'ok 0114b' as resultado, public.prazo_revisores_definidos() as revisores_definidos, (select count(*) from public.publicacao_prazos where revisao_pendente) as prazos_em_revisao;

-- Reversão: reexecutar as definições destas funções a partir da 0114 (pode_conferir_prazo(), prazo_revisor(), publicacao_prazo_conferir);
--   drop view public.v_prazos_em_revisao; drop function public.pode_conferir_prazo(bigint), public.prazo_revisores_definidos(uuid);
