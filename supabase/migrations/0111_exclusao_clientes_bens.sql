-- 0111 — Segurança da exclusão de CLIENTES e de BENS (correção pedida em 15/11/2026). Idempotente.
-- PROPOSTA: não aplicada em beta nem em produção; aplicar só com autorização específica.
--
-- CLIENTES
--   * Ninguém exclui cliente pela API (PostgREST), nem a administradora: sem policy de DELETE.
--   * Tirar da carteira = status "Encerrado" (já existe; preserva contratos, atas, dossiê, bens e auditoria).
--   * Exclusão DEFINITIVA só pela função cliente_excluir_definitivo(id, motivo): administradora, motivo, cliente já
--     encerrado e SEM registros de trabalho (contratos, atas, dossiê manual, bens, processos, negociações, documentos,
--     cobranças, tarefas manuais…). É para cadastro feito por engano. Tudo o que a cascata remove ou desvincula vai,
--     antes, num instantâneo na auditoria (acao = 'EXCLUSAO_DEFINITIVA', com o motivo).
--   * Gatilho de guarda: DELETE em clientes fora dessa função é recusado (42501) para qualquer papel, inclusive o dono
--     do banco pelo SQL Editor — só desligando o gatilho de propósito.
-- BENS
--   * Excluir bem: só quem conduz a proteção patrimonial (edita_protecao: frente Estratégico / Acompanhamento PJ,
--     pós-vendas, sócios, acesso "protecao", administradora) e só bem FORA de proteção.
--   * Bem em proteção ou protegido: ninguém exclui pela API; só bem_excluir_protegido(id, motivo), pela administradora,
--     com motivo, registro na auditoria e no dossiê (interno, frente Estratégico).
--   * Tirar um bem da proteção (em proteção/protegido → exposto/não protegível) passa a exigir a administradora; sem
--     isso, rebaixar e depois excluir contornaria a regra.
--   * Incluir e editar bens continuam como hoje (equipe), com a regra de proteção da 0092.

-- ============ CLIENTES ============
drop policy if exists clientes_wr on public.clientes;
drop policy if exists clientes_ins on public.clientes;
drop policy if exists clientes_upd on public.clientes;
create policy clientes_ins on public.clientes for insert to authenticated with check (public.sou_equipe());
create policy clientes_upd on public.clientes for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
-- (sem policy de DELETE: DELETE pela API devolve 0 linha para qualquer usuário autenticado)

create or replace function public.clientes_exclusao_guarda_tg() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('np.cliente_exclusao', true), '') is distinct from old.id then
    raise exception 'Cliente não se exclui por aqui. Para tirá-lo da carteira, use o status "Encerrado"; a exclusão definitiva (cadastro feito por engano) é da administradora, com motivo.'
      using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists clientes_exclusao_guarda on public.clientes;
-- nome em ordem alfabética antes de clientes_marca_exclusao (0108): a guarda decide primeiro
create trigger clientes_exclusao_guarda before delete on public.clientes for each row execute function public.clientes_exclusao_guarda_tg();

-- registros de trabalho que impedem a exclusão definitiva (tudo o que referencia o cliente, menos o que o sistema cria sozinho)
create or replace function public.cliente_dependentes(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; n bigint; q text; saida jsonb := '{}'::jsonb;
begin
  for r in select c.conrelid::regclass::text as tab, a.attname::text as col
             from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.clientes'::regclass order by 1, 2 loop
    if r.tab in ('mensagens_fila', 'cliente_passagem', 'acessos_token', 'maturacao_alertas') then continue; end if; -- criados pelo sistema
    q := format('select count(*) from %s where %I = $1', r.tab, r.col);
    -- o que o sistema cria sozinho no cadastro (mesma transação do cliente) e ninguém trabalhou não conta como registro de trabalho
    if r.tab = 'entradas_timeline' then q := q || ' and not coalesce(automatica, false)';
    elsif r.tab = 'tarefas' then q := q || ' and not (status in (''aberta'', ''em_andamento'') and concluida_em is null and created_at = (select created_at from public.clientes where id = $1))';
    elsif r.tab = 'monitoramentos' then q := q || ' and not (created_at = (select created_at from public.clientes where id = $1) and ultima_checagem is null and coalesce(observacoes, '''') = '''' and tem_processo is null and foi_citado is null and tem_garantia is null and coalesce(cardinality(documentos), 0) = 0)';
    end if;
    execute q into n using p_id;
    if n > 0 then saida := saida || jsonb_build_object(r.tab || case when r.col <> 'cliente_id' then '.' || r.col else '' end, n); end if;
  end loop;
  return saida;
end $$;
revoke all on function public.cliente_dependentes(text) from public, anon;
grant execute on function public.cliente_dependentes(text) to authenticated;

create or replace function public.cliente_excluir_definitivo(p_id text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; dep jsonb; snap jsonb := '{}'::jsonb; r record; linhas jsonb;
begin
  if not public.sou_admin() then raise exception 'Só a administradora exclui um cliente definitivamente.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then raise exception 'Informe o motivo da exclusão (pelo menos 10 caracteres).' using errcode = '22023'; end if;
  select * into c from public.clientes where id = p_id for update;
  if not found then raise exception 'Cliente não encontrado.' using errcode = 'P0002'; end if;
  if coalesce(c.status, '') <> 'encerrado' then raise exception 'Encerre o cliente antes (status "Encerrado"). A exclusão definitiva é só para cadastro feito por engano.' using errcode = '22023'; end if;
  dep := public.cliente_dependentes(p_id);
  if dep <> '{}'::jsonb then raise exception 'Este cliente tem registros de trabalho (%). Mantenha-o como "Encerrado": nada foi excluído.', dep::text using errcode = '23503'; end if;
  -- instantâneo de tudo o que a cascata vai remover (CASCADE) ou desvincular (SET NULL)
  for r in select c2.conrelid::regclass::text as tab, a.attname::text as col
             from pg_constraint c2 join pg_attribute a on a.attrelid = c2.conrelid and a.attnum = c2.conkey[1]
            where c2.contype = 'f' and c2.confrelid = 'public.clientes'::regclass order by 1, 2 loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %s t where %I = $1', r.tab, r.col) into linhas using p_id;
    if jsonb_array_length(linhas) > 0 then snap := snap || jsonb_build_object(r.tab || '.' || r.col, linhas); end if;
  end loop;
  insert into public.auditoria (usuario, tabela, registro, acao, antes, depois)
  values (auth.uid(), 'clientes', p_id, 'EXCLUSAO_DEFINITIVA', jsonb_build_object('cliente', to_jsonb(c), 'dependentes', snap), jsonb_build_object('motivo', trim(p_motivo)));
  perform set_config('np.cliente_exclusao', p_id, true);
  delete from public.clientes where id = p_id;
  perform set_config('np.cliente_exclusao', '', true);
  return jsonb_build_object('excluido', p_id, 'removidos', (select coalesce(jsonb_object_agg(k, jsonb_array_length(v)), '{}'::jsonb) from jsonb_each(snap) as e(k, v)));
end $$;
revoke all on function public.cliente_excluir_definitivo(text, text) from public, anon;
grant execute on function public.cliente_excluir_definitivo(text, text) to authenticated;

-- ============ BENS ============
drop policy if exists bens_wr on public.bens;
drop policy if exists bens_ins on public.bens;
drop policy if exists bens_upd on public.bens;
drop policy if exists bens_del on public.bens;
create policy bens_ins on public.bens for insert to authenticated with check (public.sou_equipe());
create policy bens_upd on public.bens for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
create policy bens_del on public.bens for delete to authenticated
  using (public.edita_protecao() and coalesce(protecao, 'exposto') not in ('em_protecao', 'protegido'));

-- 0092 + rebaixamento: tirar um bem da proteção exige a administradora
create or replace function public.bens_protecao_guard_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.protecao is distinct from old.protecao or new.protecao_instrumento is distinct from old.protecao_instrumento or new.protecao_em is distinct from old.protecao_em or new.protecao_nota is distinct from old.protecao_nota)
     and auth.uid() is not null and not public.edita_protecao() then
    raise exception 'Só a frente Estratégico / Acompanhamento PJ altera a proteção dos bens';
  end if;
  if tg_op = 'UPDATE' and coalesce(old.protecao, 'exposto') in ('em_protecao', 'protegido') and coalesce(new.protecao, 'exposto') not in ('em_protecao', 'protegido')
     and auth.uid() is not null and not public.sou_admin() then
    raise exception 'Tirar um bem da proteção patrimonial exige a administradora.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.bem_excluir_protegido(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bens;
begin
  if not public.sou_admin() then raise exception 'Só a administradora exclui um bem em proteção ou protegido.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then raise exception 'Informe o motivo da exclusão (pelo menos 10 caracteres).' using errcode = '22023'; end if;
  select * into b from public.bens where id = p_id for update;
  if not found then raise exception 'Bem não encontrado.' using errcode = 'P0002'; end if;
  if coalesce(b.protecao, 'exposto') not in ('em_protecao', 'protegido') then raise exception 'Este bem não está em proteção: use a exclusão comum.' using errcode = '22023'; end if;
  insert into public.auditoria (usuario, tabela, registro, acao, antes, depois)
  values (auth.uid(), 'bens', p_id::text, 'EXCLUSAO_AUTORIZADA', to_jsonb(b), jsonb_build_object('motivo', trim(p_motivo)));
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente)
  values (b.cliente_id, (now() at time zone 'America/Sao_Paulo')::date, 'registro',
          'Bem em proteção excluído com autorização da administradora: ' || coalesce(b.descricao, 'bem') || '. Motivo: ' || trim(p_motivo), false, auth.uid(), 'estrategico');
  delete from public.bens where id = p_id;
end $$;
revoke all on function public.bem_excluir_protegido(uuid, text) from public, anon;
grant execute on function public.bem_excluir_protegido(uuid, text) to authenticated;

select 'ok 0111' as resultado,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'clientes') as policies_clientes,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'clientes' and cmd in ('DELETE', 'ALL')) as clientes_delete_api,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'bens') as policies_bens,
       (select count(*) from pg_trigger where tgname = 'clientes_exclusao_guarda') as guarda;
