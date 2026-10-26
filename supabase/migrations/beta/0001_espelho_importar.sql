-- ESPELHO (beta) — só no projeto beta, nunca em produção.
-- Recebe linhas copiadas do sistema real pela ferramenta "Espelho → copiar amostra" (admin), gravando-as sem disparar
-- gatilhos (sem notificações, cadências, timeline automática) e ignorando duplicadas. Idempotente.

-- perfis da equipe vêm do sistema real com os ids originais (não existem como usuários de login no beta)
alter table public.perfis drop constraint if exists perfis_id_fkey;

create or replace function public.espelho_importar(p_tabela text, p_linhas jsonb, p_omitir text[] default '{}')
returns integer language plpgsql security definer set search_path = public as $$
declare cols text; n integer := 0; tabela regclass;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  if p_tabela !~ '^[a-z_]+$' then raise exception 'Tabela inválida.'; end if;
  tabela := ('public.' || p_tabela)::regclass;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_tabela
     and is_generated = 'NEVER' and coalesce(identity_generation, '') <> 'ALWAYS'
     and not (column_name = any(p_omitir))
     and column_name in (select jsonb_object_keys(p_linhas -> 0));   -- só as colunas presentes; as demais ficam com o padrão
  if cols is null then raise exception 'Tabela sem colunas: %', p_tabela; end if;
  execute format('alter table %s disable trigger user', tabela);
  begin
    execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1) on conflict do nothing', tabela, cols, cols, tabela) using p_linhas;
    get diagnostics n = row_count;
    execute format('alter table %s enable trigger user', tabela);
  exception when others then
    execute format('alter table %s enable trigger user', tabela);
    raise;
  end;
  return n;
end $$;
revoke all on function public.espelho_importar(text, jsonb, text[]) from public, anon;
grant execute on function public.espelho_importar(text, jsonb, text[]) to authenticated;

-- segunda passada para colunas circulares (clientes.lead_id ↔ leads.cliente_id): p_linhas = [{id, coluna: valor}]
create or replace function public.espelho_atualizar(p_tabela text, p_coluna text, p_linhas jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; tabela regclass; tipo text; tipo_id text;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  if p_tabela !~ '^[a-z_]+$' or p_coluna !~ '^[a-z_]+$' then raise exception 'Nome inválido.'; end if;
  tabela := ('public.' || p_tabela)::regclass;
  select format_type(atttypid, atttypmod) into tipo from pg_attribute where attrelid = tabela and attname = p_coluna;
  select format_type(atttypid, atttypmod) into tipo_id from pg_attribute where attrelid = tabela and attname = 'id';
  execute format('alter table %s disable trigger user', tabela);
  begin
    execute format('update %s t set %I = (x.v)::%s from (select (e->>''id'')::%s as id, e->>''v'' as v from jsonb_array_elements($1) e) x where x.id = t.id', tabela, p_coluna, tipo, tipo_id) using p_linhas;
    get diagnostics n = row_count;
    execute format('alter table %s enable trigger user', tabela);
  exception when others then
    execute format('alter table %s enable trigger user', tabela);
    raise;
  end;
  return n;
end $$;
revoke all on function public.espelho_atualizar(text, text, jsonb) from public, anon;
grant execute on function public.espelho_atualizar(text, text, jsonb) to authenticated;

-- realinha as sequências (ids seriais) depois da cópia
create or replace function public.espelho_ajustar_sequencias() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; m bigint;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  for r in
    select s.relname as seq, t.relname as tab, a.attname as col
      from pg_class s join pg_depend d on d.objid = s.oid and d.deptype = 'a'
      join pg_class t on t.oid = d.refobjid join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      join pg_namespace n on n.oid = s.relnamespace
     where s.relkind = 'S' and n.nspname = 'public'
  loop
    execute format('select max(%I) from public.%I', r.col, r.tab) into m;
    if m is not null then execute format('select setval(%L, %s)', 'public.' || r.seq, m); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.espelho_ajustar_sequencias() from public, anon;
grant execute on function public.espelho_ajustar_sequencias() to authenticated;

-- apaga a amostra copiada (para recomeçar) — tudo menos cadastros base, perfis de login e configurações
create or replace function public.espelho_limpar() returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  foreach t in array array['atd_mensagens','atd_eventos','atd_conversas','mensagens_fila','fluxo_execucoes','automacao_execucoes','lead_tags','observacoes','historico_fases','lead_tarefas','tarefa_eventos','leads_auditoria','webhook_logs','planilha_linhas','fechamentos','agenda_eventos','apontamentos_horas','anexos','entradas_timeline','tarefas','maturacao_alertas','cobranca_checks','cobranca_contatos','regua_disparos','cobrancas','asaas_contatos','asaas_clientes','negociacoes','monitoramentos','andamentos','documentos','revisao_teses','revisoes','pecas_geradas','planos_superendividamento','processos','acordos','notas_internas','contratos','contatos','bens','acessos_token','onboarding_respostas','leads','clientes','publicacoes','notificacoes','colaboradores_historico','colaboradores_rh','pdi_registros','pdi','pontos','colaboradores'] loop
    begin execute format('alter table public.%I disable trigger user', t); execute format('delete from public.%I', t); execute format('alter table public.%I enable trigger user', t);
    exception when undefined_table then null; end;
  end loop;
  delete from public.perfis where id not in (select id from auth.users);
  return 'ok';
end $$;
revoke all on function public.espelho_limpar() from public, anon;
grant execute on function public.espelho_limpar() to authenticated;

select 'ok espelho importar' as resultado;
