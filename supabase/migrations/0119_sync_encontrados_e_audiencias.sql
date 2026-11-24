-- 0119 — (a) Processos que o AtendeDireito Sync acompanha e que NÃO estão cadastrados no sistema: ficam numa fila, ligados ao cliente
--        pelo CPF/CNPJ monitorado, para a equipe decidir (cadastrar ou dispensar) na aba Monitoramento. Processo novo marca o cliente
--        como "nova movimentação". (b) Audiência nova lida dos autos entra sozinha na Agenda do colaborador configurado.
-- Idempotente. Depende de 0047 (agenda), 0117 (processo_sync) e 0118 (sync_monitores).

create table if not exists public.sync_encontrados (
  numero text primary key,                       -- 20 dígitos
  numero_mascara text,
  cliente_id text references public.clientes(id) on delete set null,
  documento text,                                -- CPF/CNPJ monitorado que casou com uma parte
  tribunal text, classe text, assunto text, polo_ativo text, polo_passivo text,
  valor_causa numeric, data_distribuicao date, ultimo_andamento date,
  situacao text not null default 'novo' check (situacao in ('novo', 'dispensado', 'cadastrado')),
  processo_id uuid references public.processos(id) on delete set null,
  decidido_por uuid, decidido_em timestamptz,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index if not exists sync_encontrados_cliente_idx on public.sync_encontrados (cliente_id, situacao);
alter table public.sync_encontrados enable row level security;
drop policy if exists "sync_encontrados: equipe lê" on public.sync_encontrados;
create policy "sync_encontrados: equipe lê" on public.sync_encontrados for select to authenticated using (public.sou_equipe());
revoke insert, update, delete on public.sync_encontrados from anon, authenticated;
grant select on public.sync_encontrados to authenticated;

-- o que o servidor precisa: números já conhecidos e a quem pertence cada documento monitorado
create or replace function public.sync_encontrados_estado() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'conhecidos', coalesce((select jsonb_agg(numero) from public.sync_encontrados), '[]'::jsonb),
    'documentos', coalesce((select jsonb_object_agg(documento, cliente_id) from public.sync_monitores), '{}'::jsonb)) $$;

create or replace function public.sync_encontrado_receber(p jsonb, p_avisar boolean default true) returns text language plpgsql security definer set search_path = public as $$
declare n text := regexp_replace(coalesce(p ->> 'numero', ''), '\D', '', 'g'); cli text := nullif(p ->> 'cliente_id', ''); novo boolean;
begin
  if length(n) <> 20 then return 'sem_numero'; end if;
  if exists (select 1 from public.processos where regexp_replace(coalesce(numero_cnj, ''), '\D', '', 'g') = n) then return 'ja_cadastrado'; end if;
  insert into public.sync_encontrados (numero, numero_mascara, cliente_id, documento, tribunal, classe, assunto, polo_ativo, polo_passivo, valor_causa, data_distribuicao, ultimo_andamento)
  values (n, p ->> 'numero_mascara', cli, nullif(p ->> 'documento', ''), p ->> 'tribunal', p ->> 'classe', p ->> 'assunto', left(p ->> 'polo_ativo', 300), left(p ->> 'polo_passivo', 300),
          nullif(p ->> 'valor_causa', '')::numeric, nullif(left(coalesce(p ->> 'data_distribuicao', ''), 10), '')::date, nullif(left(coalesce(p ->> 'ultimo_andamento', ''), 10), '')::date)
  on conflict (numero) do update set ultimo_andamento = excluded.ultimo_andamento, cliente_id = coalesce(public.sync_encontrados.cliente_id, excluded.cliente_id),
    documento = coalesce(public.sync_encontrados.documento, excluded.documento), atualizado_em = now()
  returning (xmax = 0) into novo;
  if novo and p_avisar and cli is not null then update public.monitoramentos set status = 'nova_movimentacao' where cliente_id = cli and status = 'em_monitoramento'; end if;
  return case when novo then 'novo' else 'conhecido' end;
end $$;

-- decisões da equipe (Jurídico): dispensar, ou cadastrar o processo no sistema já ligado ao cliente
create or replace function public.sync_encontrado_dispensar(p_numero text, p_voltar boolean default false) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.sou_admin() or (public.sou_equipe() and public.tem_acesso('juridico'))) then raise exception 'Só o Jurídico decide sobre processos encontrados.' using errcode = '42501'; end if;
  update public.sync_encontrados set situacao = case when p_voltar then 'novo' else 'dispensado' end, decidido_por = auth.uid(), decidido_em = now(), atualizado_em = now()
   where numero = regexp_replace(p_numero, '\D', '', 'g') and situacao <> 'cadastrado';
end $$;
create or replace function public.sync_encontrado_cadastrar(p_numero text, p_cliente text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare e public.sync_encontrados; pid uuid; cli text; num text;
begin
  if not (public.sou_admin() or (public.sou_equipe() and public.tem_acesso('juridico'))) then raise exception 'Só o Jurídico cadastra processos encontrados.' using errcode = '42501'; end if;
  select * into e from public.sync_encontrados where numero = regexp_replace(p_numero, '\D', '', 'g');
  if e.numero is null then raise exception 'Processo não está na lista de encontrados.'; end if;
  cli := coalesce(nullif(p_cliente, ''), e.cliente_id);
  if cli is null then raise exception 'Escolha o cliente deste processo.'; end if;
  select id into pid from public.processos where regexp_replace(coalesce(numero_cnj, ''), '\D', '', 'g') = e.numero limit 1;
  if pid is null then
    num := coalesce(nullif(e.numero_mascara, ''), regexp_replace(e.numero, '^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$', '\1-\2.\3.\4.\5.\6'));
    insert into public.processos (cliente_id, numero_cnj, tribunal, tipo_acao, assunto, valor_causa, data_distribuicao, status, visivel_cliente, fonte, id_externo, observacoes, created_by)
    values (cli, num, e.tribunal, e.classe, e.assunto, e.valor_causa, e.data_distribuicao, 'ativo', false, 'sync', 'sync:' || e.numero,
            'Encontrado pelo monitoramento do AtendeDireito Sync' || coalesce(' (documento ' || e.documento || ')', '') || '. ' || coalesce(e.polo_ativo, '?') || ' × ' || coalesce(e.polo_passivo, '?'), auth.uid())
    returning id into pid;
  end if;
  update public.sync_encontrados set situacao = 'cadastrado', processo_id = pid, cliente_id = cli, decidido_por = auth.uid(), decidido_em = now(), atualizado_em = now() where numero = e.numero;
  return pid;
end $$;
revoke all on function public.sync_encontrados_estado(), public.sync_encontrado_receber(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.sync_encontrado_dispensar(text, boolean), public.sync_encontrado_cadastrar(text, text) from public, anon;
grant execute on function public.sync_encontrado_dispensar(text, boolean), public.sync_encontrado_cadastrar(text, text) to authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_encontrados_estado(), public.sync_encontrado_receber(jsonb, boolean) to service_role;
  end if;
end $g$;

-- (b) audiência nova → Agenda de quem estiver em integracoes.config.agenda_audiencias_colaborador (id de colaborador). Sem a chave, nada acontece.
create or replace function public.sync_audiencias_para_agenda_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare quem uuid; a jsonb; ini timestamptz; pr public.processos; nome text;
begin
  select nullif(config ->> 'agenda_audiencias_colaborador', '')::uuid into quem from public.integracoes where id = 'sync';
  if quem is null or jsonb_array_length(coalesce(new.audiencias, '[]'::jsonb)) = 0 then return new; end if;
  select * into pr from public.processos where id = new.processo_id;
  select coalesce(c.nome_fantasia, c.nome) into nome from public.clientes c where c.id = pr.cliente_id;
  for a in select * from jsonb_array_elements(new.audiencias) loop
    begin ini := (a ->> 'data')::timestamptz; exception when others then continue; end;
    if ini is null or ini < now() then continue; end if;
    if exists (select 1 from public.agenda_eventos e where e.processo_id = new.processo_id and e.inicio = ini and not coalesce(e.cancelado, false)) then continue; end if;
    insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, cliente_id, processo_id, tipo, origem, descricao)
    values (left('Audiência · ' || coalesce(nome, 'cliente') || ' · ' || coalesce(pr.numero_cnj, new.numero), 200), ini, ini + interval '1 hour', false, quem, pr.cliente_id, new.processo_id, 'audiencia', 'painel',
            coalesce(a ->> 'descricao', '') || E'\n' || coalesce(pr.tribunal, '') || ' · processo ' || coalesce(pr.numero_cnj, new.numero) || E'\nTrazida do AtendeDireito Sync (autos do tribunal). Confira horário e local no processo.');
  end loop;
  return new;
exception when others then return new;   -- a agenda nunca impede a gravação do retrato
end $$;
drop trigger if exists processo_sync_audiencias on public.processo_sync;
create trigger processo_sync_audiencias after insert or update of audiencias on public.processo_sync for each row execute function public.sync_audiencias_para_agenda_tg();

select 'ok 0119' as resultado, (select count(*) from pg_trigger where tgname = 'processo_sync_audiencias') as gatilho;
-- Reversão: drop trigger processo_sync_audiencias on public.processo_sync; drop function public.sync_audiencias_para_agenda_tg(), public.sync_encontrado_cadastrar(text, text),
--   public.sync_encontrado_dispensar(text, boolean), public.sync_encontrado_receber(jsonb, boolean), public.sync_encontrados_estado(); drop table public.sync_encontrados;
