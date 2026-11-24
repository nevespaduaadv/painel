-- 0119b — Encontrados: (1) quem ainda não tem cliente identificado volta a ser conferido a cada sincronização (as partes só ganham
-- CPF/CNPJ depois que o Sync lê os autos); (2) quando o documento não casa, tenta pelo NOME do cliente monitorado no polo do processo.
-- Idempotente. Depende da 0119.

create or replace function public.np_norm_nome(t text) returns text language sql immutable as $$
  select regexp_replace(upper(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^A-Z0-9]+', ' ', 'g') $$;

-- cliente monitorado cujo nome (razão social ou fantasia, com 8+ letras) aparece num dos polos; só devolve se for um único
create or replace function public.sync_cliente_por_nome(p_ativo text, p_passivo text) returns text language sql stable security definer set search_path = public as $$
  with alvo as (select ' ' || public.np_norm_nome(coalesce(p_ativo, '') || ' | ' || coalesce(p_passivo, '')) || ' ' as t),
       c as (select distinct m.cliente_id from public.monitoramentos m join public.clientes cl on cl.id = m.cliente_id, alvo
              where (length(public.np_norm_nome(cl.nome)) >= 8 and alvo.t like '% ' || trim(public.np_norm_nome(cl.nome)) || ' %')
                 or (length(public.np_norm_nome(cl.nome_fantasia)) >= 8 and alvo.t like '% ' || trim(public.np_norm_nome(cl.nome_fantasia)) || ' %'))
  select case when (select count(*) from c) = 1 then (select cliente_id from c) end $$;

create or replace function public.sync_encontrados_estado() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'conhecidos', coalesce((select jsonb_agg(numero) from public.sync_encontrados where cliente_id is not null or situacao <> 'novo'), '[]'::jsonb),
    'documentos', coalesce((select jsonb_object_agg(documento, cliente_id) from public.sync_monitores), '{}'::jsonb)) $$;

create or replace function public.sync_encontrado_receber(p jsonb, p_avisar boolean default true) returns text language plpgsql security definer set search_path = public as $$
declare n text := regexp_replace(coalesce(p ->> 'numero', ''), '[^0-9]', '', 'g'); cli text := nullif(p ->> 'cliente_id', ''); novo boolean; antes text;
begin
  if length(n) <> 20 then return 'sem_numero'; end if;
  if exists (select 1 from public.processos where regexp_replace(coalesce(numero_cnj, ''), '[^0-9]', '', 'g') = n) then return 'ja_cadastrado'; end if;
  if cli is null then cli := public.sync_cliente_por_nome(p ->> 'polo_ativo', p ->> 'polo_passivo'); end if;
  select cliente_id into antes from public.sync_encontrados where numero = n;
  insert into public.sync_encontrados (numero, numero_mascara, cliente_id, documento, tribunal, classe, assunto, polo_ativo, polo_passivo, valor_causa, data_distribuicao, ultimo_andamento)
  values (n, p ->> 'numero_mascara', cli, nullif(p ->> 'documento', ''), p ->> 'tribunal', p ->> 'classe', p ->> 'assunto', left(p ->> 'polo_ativo', 300), left(p ->> 'polo_passivo', 300),
          nullif(p ->> 'valor_causa', '')::numeric, nullif(left(coalesce(p ->> 'data_distribuicao', ''), 10), '')::date, nullif(left(coalesce(p ->> 'ultimo_andamento', ''), 10), '')::date)
  on conflict (numero) do update set ultimo_andamento = coalesce(excluded.ultimo_andamento, public.sync_encontrados.ultimo_andamento), cliente_id = coalesce(public.sync_encontrados.cliente_id, excluded.cliente_id),
    documento = coalesce(public.sync_encontrados.documento, excluded.documento), classe = coalesce(excluded.classe, public.sync_encontrados.classe), assunto = coalesce(excluded.assunto, public.sync_encontrados.assunto),
    polo_ativo = coalesce(excluded.polo_ativo, public.sync_encontrados.polo_ativo), polo_passivo = coalesce(excluded.polo_passivo, public.sync_encontrados.polo_passivo),
    valor_causa = coalesce(excluded.valor_causa, public.sync_encontrados.valor_causa), data_distribuicao = coalesce(excluded.data_distribuicao, public.sync_encontrados.data_distribuicao), atualizado_em = now()
  returning (xmax = 0) into novo;
  -- avisa quando o processo aparece já com cliente, ou quando o cliente é identificado depois
  if p_avisar and cli is not null and (novo or antes is null) then update public.monitoramentos set status = 'nova_movimentacao' where cliente_id = cli and status = 'em_monitoramento'; end if;
  return case when novo then 'novo' else 'conhecido' end;
end $$;
revoke all on function public.sync_cliente_por_nome(text, text), public.sync_encontrados_estado(), public.sync_encontrado_receber(jsonb, boolean) from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_cliente_por_nome(text, text), public.sync_encontrados_estado(), public.sync_encontrado_receber(jsonb, boolean) to service_role;
  end if;
end $g$;

-- o que já está na fila sem cliente: tenta pelo nome agora
update public.sync_encontrados e set cliente_id = public.sync_cliente_por_nome(e.polo_ativo, e.polo_passivo), atualizado_em = now()
 where e.cliente_id is null and public.sync_cliente_por_nome(e.polo_ativo, e.polo_passivo) is not null;

select 'ok 0119b' as resultado, (select count(*) from public.sync_encontrados) as total, (select count(*) from public.sync_encontrados where cliente_id is not null) as com_cliente;
