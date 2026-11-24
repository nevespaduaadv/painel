-- 0117 — Carteira do AtendeDireito Sync: o que o Sync lê dos autos de cada processo (capa, partes, movimentos, documentos e
-- audiências) fica guardado por processo, num retrato atualizado a cada sincronização. Só leitura para a equipe; quem grava é o servidor.
-- O retrato NÃO cria andamento, tarefa nem aviso. A capa só preenche campo VAZIO do processo; nada digitado é sobrescrito.
-- Idempotente. Depende da 0114.

create table if not exists public.processo_sync (
  processo_id uuid primary key references public.processos(id) on delete cascade,
  numero text not null,
  capa jsonb not null default '{}'::jsonb,
  partes jsonb not null default '[]'::jsonb,
  movimentos jsonb not null default '[]'::jsonb,
  documentos jsonb not null default '[]'::jsonb,
  audiencias jsonb not null default '[]'::jsonb,
  ultima_decisao date,
  ultimo_andamento date,
  sincronizado_fonte timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.processo_sync enable row level security;
drop policy if exists "processo_sync: equipe lê" on public.processo_sync;
create policy "processo_sync: equipe lê" on public.processo_sync for select to authenticated
  using (public.sou_equipe() and exists (select 1 from public.processos p where p.id = processo_id));
revoke insert, update, delete on public.processo_sync from anon, authenticated;
grant select on public.processo_sync to authenticated;

-- o que o servidor precisa para decidir o que buscar: números da nossa base e a data do último retrato
create or replace function public.sync_carteira_estado() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(d, s), '{}'::jsonb) from (
    select regexp_replace(p.numero_cnj, '\D', '', 'g') as d, max(ps.sincronizado_fonte) as s
      from public.processos p left join public.processo_sync ps on ps.processo_id = p.id
     where length(regexp_replace(coalesce(p.numero_cnj, ''), '\D', '', 'g')) = 20 group by 1) x $$;

create or replace function public.sync_receber_processo(p jsonb) returns text language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p ->> 'numero', ''), '\D', '', 'g'); pr public.processos; c jsonb := coalesce(p -> 'capa', '{}'::jsonb);
  n_vara text; n_comarca text; n_valor numeric; n_assunto text; n_dist date; n_trib text; n_tipo text; n_contra text; n_adv text; n_polo text;
begin
  if length(d) <> 20 then return 'sem_numero'; end if;
  select * into pr from public.processos where regexp_replace(coalesce(numero_cnj, ''), '\D', '', 'g') = d order by created_at limit 1;
  if pr.id is null then return 'sem_processo'; end if;
  insert into public.processo_sync (processo_id, numero, capa, partes, movimentos, documentos, audiencias, ultima_decisao, ultimo_andamento, sincronizado_fonte, atualizado_em)
  values (pr.id, d, c, coalesce(p -> 'partes', '[]'::jsonb), coalesce(p -> 'movimentos', '[]'::jsonb), coalesce(p -> 'documentos', '[]'::jsonb), coalesce(p -> 'audiencias', '[]'::jsonb),
          nullif(left(coalesce(p ->> 'ultima_decisao', ''), 10), '')::date, nullif(left(coalesce(p ->> 'ultimo_andamento', ''), 10), '')::date, nullif(p ->> 'sincronizado_fonte', '')::timestamptz, now())
  on conflict (processo_id) do update set numero = excluded.numero, capa = excluded.capa, partes = excluded.partes, movimentos = excluded.movimentos, documentos = excluded.documentos,
    audiencias = excluded.audiencias, ultima_decisao = excluded.ultima_decisao, ultimo_andamento = excluded.ultimo_andamento, sincronizado_fonte = excluded.sincronizado_fonte, atualizado_em = now();
  -- capa: só o que está vazio no processo
  n_vara := coalesce(nullif(pr.vara, ''), nullif(c ->> 'orgao_julgador', ''));
  n_comarca := coalesce(nullif(pr.comarca, ''), nullif(c ->> 'comarca', ''));
  n_valor := coalesce(pr.valor_causa, nullif(nullif(c ->> 'valor_causa', '')::numeric, 0));
  n_assunto := coalesce(nullif(pr.assunto, ''), nullif(c ->> 'assunto', ''));
  n_dist := coalesce(pr.data_distribuicao, nullif(left(coalesce(c ->> 'data_distribuicao', ''), 10), '')::date);
  n_trib := coalesce(nullif(pr.tribunal, ''), nullif(c ->> 'tribunal', ''));
  n_tipo := coalesce(nullif(pr.tipo_acao, ''), nullif(c ->> 'classe', ''));
  n_contra := coalesce(nullif(pr.parte_contraria, ''), nullif(p ->> 'parte_contraria', ''));
  n_adv := coalesce(nullif(pr.advogado_contrario, ''), nullif(p ->> 'advogado_contrario', ''));
  n_polo := coalesce(pr.polo, case when p ->> 'polo' in ('ativo', 'passivo') then p ->> 'polo' end);
  if (n_vara, n_comarca, n_valor, n_assunto, n_dist, n_trib, n_tipo, n_contra, n_adv, n_polo) is distinct from
     (pr.vara, pr.comarca, pr.valor_causa, pr.assunto, pr.data_distribuicao, pr.tribunal, pr.tipo_acao, pr.parte_contraria, pr.advogado_contrario, pr.polo) then
    update public.processos set vara = n_vara, comarca = n_comarca, valor_causa = n_valor, assunto = n_assunto, data_distribuicao = n_dist, tribunal = n_trib,
      tipo_acao = n_tipo, parte_contraria = n_contra, advogado_contrario = n_adv, polo = n_polo where id = pr.id;
    return 'ok_capa';
  end if;
  return 'ok';
end $$;
revoke all on function public.sync_carteira_estado(), public.sync_receber_processo(jsonb) from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sync_carteira_estado(), public.sync_receber_processo(jsonb) to service_role;
  end if;
end $g$;

-- audiências futuras de toda a carteira, para a tela
create or replace view public.v_sync_audiencias with (security_invoker = true) as
select ps.processo_id, p.numero_cnj, p.cliente_id, (a ->> 'data')::timestamptz as data, a ->> 'descricao' as descricao, p.tribunal
  from public.processo_sync ps join public.processos p on p.id = ps.processo_id, jsonb_array_elements(ps.audiencias) a
 where nullif(a ->> 'data', '') is not null;
grant select on public.v_sync_audiencias to authenticated;

select 'ok 0117' as resultado, (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'processo_sync') as tabela;
-- Reversão: drop view public.v_sync_audiencias; drop function public.sync_receber_processo(jsonb), public.sync_carteira_estado(); drop table public.processo_sync;
