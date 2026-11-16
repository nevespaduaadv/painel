-- 0108 — Integridade do dossiê das atas + ESTÁGIO 2 do piloto (edição pelo autor/condução, exclusão pelo admin).
-- Depende da 0107 (edita_ata, atas_guard). Aprovação conceitual: 15/11/2026. NÃO aplicar sem autorização específica.
--
-- Problemas que resolve (0104): a ata vira entrada no dossiê só no INSERT, por um gatilho que engole qualquer erro
-- (exception when others then return new); editar ou excluir a ata não chega ao dossiê; qualquer membro da equipe altera
-- ou exclui a entrada pela API (tl_wr = sou_equipe()); atas_reuniao não tem auditoria.
--
-- Desenho:
--   1. entradas_timeline.ata_origem_id = id da ata, PERMANENTE e SEM chave estrangeira (a ação de FK rodaria antes dos
--      gatilhos de usuário e apagaria o vínculo antes da marcação); índice único parcial: no máximo uma entrada por ata.
--   2. Estado em colunas (ata_versao, ata_atualizada_em/por, ata_excluida_em/por); a descrição é sempre reconstruída por
--      ata_texto_dossie(ata) — mesmo formato da 0104, idempotente, sem mensagens acumuladas.
--   3. Sincronização dentro da MESMA transação da ata, sem blocos de exceção: se o dossiê falhar, a operação da ata é
--      desfeita e o erro chega ao usuário.
--   4. Proteção: gatilho em entradas_timeline recusa (42501) INSERT/UPDATE/DELETE de entrada vinculada a ata, exceto
--      (a) a sincronização (marcador local da transação igual ao id da ata E chamada de dentro de outro gatilho),
--      (b) mudança só de apresentação (fixado, visivel_cliente) e (c) exclusão em cascata do próprio cliente.
--   5. Exclusão do cliente: gatilho BEFORE DELETE em clientes marca o cliente na transação; a ata não tenta marcar o
--      dossiê e a proteção libera a cascata. Não depende da ordem interna das cascatas.
--   6. Auditoria: atas_reuniao_audit (função auditar() existente); entradas_timeline já é auditada.
--   7. Reconciliação conservadora do histórico ANTES de ligar a proteção: só pares 1:1 com mesmo cliente, tipo 'ata',
--      descrição iniciada por 'Ata — ' e created_at idêntico (a entrada nasce na mesma transação da ata). Nada é excluído;
--      o que não casar fica em v_dossie_atas_inconsistencias (lida só pelo SQL Editor).
--   8. Estágio 2: ata_upd (autor ativo ou quem conduz o acompanhamento, cliente visível) e ata_del (admin).
-- Idempotente.

-- ---------- 1. colunas de vínculo e estado ----------
alter table public.entradas_timeline
  add column if not exists ata_origem_id uuid,
  add column if not exists ata_versao int,
  add column if not exists ata_atualizada_em timestamptz,
  add column if not exists ata_atualizada_por uuid,
  add column if not exists ata_excluida_em timestamptz,
  add column if not exists ata_excluida_por uuid;
create unique index if not exists entradas_timeline_ata_origem_uidx on public.entradas_timeline (ata_origem_id) where ata_origem_id is not null;

-- ---------- 2. texto do dossiê a partir da ata (formato da 0104) ----------
create or replace function public.ata_texto_dossie(a public.atas_reuniao) returns text
language sql immutable set search_path = public as $$
  select 'Ata — ' || case a.tipo when 'onb' then 'Onboarding' when 'r1' then 'R1' when 'r2' then 'R2' when 'r3' then 'R3'
                                 when 'mensal' then 'Acompanhamento mensal' when 'estrategia' then 'Núcleo de estratégia'
                                 else coalesce(a.titulo, 'Reunião') end
         || coalesce(': ' || a.titulo, '') || E'\n' || coalesce(a.resumo, '') || coalesce(E'\nPasta: ' || a.link_pasta, '')
$$;

-- ---------- 3. marcadores locais da transação ----------
-- sincronização: só vale de dentro de outro gatilho (pg_trigger_depth() > 1) e para a ata exata
create or replace function public.ata_sync_ativo(p_ata uuid) returns boolean
language sql stable set search_path = public as $$
  select pg_trigger_depth() > 1 and coalesce(current_setting('np.ata_sync', true), '') = p_ata::text
$$;
create or replace function public.cliente_em_exclusao(p_cliente text) returns boolean
language sql stable set search_path = public as $$
  select position('|' || p_cliente || '|' in coalesce(current_setting('np.clientes_excluidos', true), '')) > 0
$$;
create or replace function public.clientes_marca_exclusao_tg() returns trigger
language plpgsql set search_path = public as $$
begin
  perform set_config('np.clientes_excluidos', coalesce(current_setting('np.clientes_excluidos', true), '') || '|' || old.id || '|', true);
  return old;
end $$;
drop trigger if exists clientes_marca_exclusao on public.clientes;
create trigger clientes_marca_exclusao before delete on public.clientes for each row execute function public.clientes_marca_exclusao_tg();

-- ---------- 4. sincronização ata → dossiê (sem engolir erros) ----------
create or replace function public.ata_dossie_sync_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('np.ata_sync', new.id::text, true);
  if tg_op = 'INSERT' then
    insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente, ata_origem_id, ata_versao)
    values (new.cliente_id, new.data, 'ata', public.ata_texto_dossie(new), false, coalesce(new.created_by, auth.uid()), 'estrategico', new.id, 1);
  elsif (new.tipo, new.data, new.titulo, new.resumo, new.link_pasta, new.link_gravacao)
        is distinct from (old.tipo, old.data, old.titulo, old.resumo, old.link_pasta, old.link_gravacao) then
    update public.entradas_timeline
       set descricao = public.ata_texto_dossie(new), data = new.data, ata_versao = coalesce(ata_versao, 1) + 1,
           ata_atualizada_em = now(), ata_atualizada_por = auth.uid()
     where ata_origem_id = new.id;
    if not found then   -- ata antiga sem entrada vinculada: passa a ter
      insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente, ata_origem_id, ata_versao, ata_atualizada_em, ata_atualizada_por)
      values (new.cliente_id, new.data, 'ata', public.ata_texto_dossie(new), false, coalesce(new.created_by, auth.uid()), 'estrategico', new.id, 2, now(), auth.uid());
    end if;
  end if;
  perform set_config('np.ata_sync', '', true);
  return null;
end $$;

create or replace function public.ata_dossie_exclusao_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.cliente_em_exclusao(old.cliente_id) then return old; end if;  -- cascata do cliente: as entradas saem pelo cascade dele
  perform set_config('np.ata_sync', old.id::text, true);
  update public.entradas_timeline set ata_excluida_em = now(), ata_excluida_por = auth.uid(), fixado = false
   where ata_origem_id = old.id;
  if not found then   -- ata sem entrada: o dossiê guarda que ela existiu e foi excluída (automática = sem aviso à frente)
    insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, created_by, frente, ata_origem_id, ata_versao, ata_excluida_em, ata_excluida_por)
    values (old.cliente_id, old.data, 'ata', public.ata_texto_dossie(old), false, true, coalesce(old.created_by, auth.uid()), 'estrategico', old.id, 1, now(), auth.uid());
  end if;
  perform set_config('np.ata_sync', '', true);
  return old;
end $$;

-- ---------- 5. reconciliação conservadora do histórico (antes da proteção) ----------
with cand as (
  select a.id as ata_id, e.id as entrada_id
    from public.atas_reuniao a
    join public.entradas_timeline e
      on e.cliente_id = a.cliente_id and e.tipo = 'ata' and e.descricao like 'Ata — %'
     and e.created_at = a.created_at and e.ata_origem_id is null
), unicos as (
  select c.ata_id, c.entrada_id from cand c
   where (select count(*) from cand x where x.ata_id = c.ata_id) = 1
     and (select count(*) from cand y where y.entrada_id = c.entrada_id) = 1
     and not exists (select 1 from public.entradas_timeline z where z.ata_origem_id = c.ata_id)
)
update public.entradas_timeline e set ata_origem_id = u.ata_id, ata_versao = coalesce(e.ata_versao, 1)
  from unicos u where e.id = u.entrada_id;

-- ---------- 6. gatilhos das atas ----------
drop trigger if exists atas_reuniao_dossie on public.atas_reuniao;
drop function if exists public.ata_para_dossie();
create trigger atas_reuniao_dossie after insert or update on public.atas_reuniao for each row execute function public.ata_dossie_sync_tg();
drop trigger if exists atas_reuniao_dossie_exclusao on public.atas_reuniao;
create trigger atas_reuniao_dossie_exclusao before delete on public.atas_reuniao for each row execute function public.ata_dossie_exclusao_tg();
drop trigger if exists atas_reuniao_audit on public.atas_reuniao;
create trigger atas_reuniao_audit after insert or update or delete on public.atas_reuniao for each row execute function public.auditar();

-- ---------- 7. proteção das entradas vinculadas (nome ordena antes de entradas_timeline_carimbo) ----------
create or replace function public.tl_ata_guarda_tg() returns trigger
language plpgsql set search_path = public as $$
declare livre text[] := array['fixado', 'visivel_cliente', 'updated_at', 'updated_by'];
begin
  if tg_op = 'INSERT' then
    if new.ata_origem_id is null or public.ata_sync_ativo(new.ata_origem_id) then return new; end if;
  elsif tg_op = 'UPDATE' then
    if old.ata_origem_id is null and new.ata_origem_id is null then return new; end if;
    if old.ata_origem_id is not null and new.ata_origem_id is not distinct from old.ata_origem_id then
      if public.ata_sync_ativo(old.ata_origem_id) then return new; end if;
      if (to_jsonb(new) - livre) = (to_jsonb(old) - livre) then return new; end if;   -- só apresentação
    end if;
  else
    if old.ata_origem_id is null or public.cliente_em_exclusao(old.cliente_id) then return old; end if;
  end if;
  raise exception 'Este registro do dossiê vem de uma ata de reunião: edite ou exclua a própria ata.' using errcode = '42501';
end $$;
drop trigger if exists entradas_timeline_ata_guarda on public.entradas_timeline;
create trigger entradas_timeline_ata_guarda before insert or update or delete on public.entradas_timeline for each row execute function public.tl_ata_guarda_tg();

-- ---------- 8. ESTÁGIO 2: edição e exclusão de atas ----------
drop policy if exists ata_upd on public.atas_reuniao;
create policy ata_upd on public.atas_reuniao for update to authenticated
  using ((atas_reuniao.autor_id = public.meu_colaborador()
            and exists (select 1 from public.colaboradores c where c.id = atas_reuniao.autor_id and coalesce(c.ativo, true))
          or public.edita_protecao())
         and exists (select 1 from public.clientes c where c.id = atas_reuniao.cliente_id))
  with check (exists (select 1 from public.clientes c where c.id = atas_reuniao.cliente_id));
drop policy if exists ata_del on public.atas_reuniao;
create policy ata_del on public.atas_reuniao for delete to authenticated using (public.sou_admin());

-- ---------- 9. verificação (só pelo SQL Editor / papel do banco; nenhum usuário do app lê) ----------
create or replace view public.v_dossie_atas_inconsistencias with (security_invoker = true) as
select 'ata sem registro no dossiê'::text as problema, a.cliente_id, a.id as ata_id, null::uuid as entrada_id
  from public.atas_reuniao a
 where not exists (select 1 from public.entradas_timeline e where e.ata_origem_id = a.id)
union all
select 'registro de ata inexistente sem marcação de exclusão', e.cliente_id, e.ata_origem_id, e.id
  from public.entradas_timeline e
 where e.ata_origem_id is not null and e.ata_excluida_em is null
   and not exists (select 1 from public.atas_reuniao a where a.id = e.ata_origem_id)
union all
select 'descrição ou data divergente da ata', a.cliente_id, a.id, e.id
  from public.atas_reuniao a join public.entradas_timeline e on e.ata_origem_id = a.id
 where (e.descricao is distinct from public.ata_texto_dossie(a) or e.data is distinct from a.data)
union all
select 'registro "Ata — " sem vínculo (histórico não reconciliado)', e.cliente_id, null::uuid, e.id
  from public.entradas_timeline e
 where e.tipo = 'ata' and e.descricao like 'Ata — %' and e.ata_origem_id is null;

-- privilégios: nada disto é para chamada anônima (PUBLIC e anon recebem EXECUTE por padrão no Supabase);
-- authenticated precisa de EXECUTE porque a RLS (edita_ata) e o gatilho de proteção (invoker) chamam estas funções
revoke execute on function public.ata_texto_dossie(public.atas_reuniao), public.ata_sync_ativo(uuid), public.cliente_em_exclusao(text), public.edita_ata() from public, anon;
grant execute on function public.ata_texto_dossie(public.atas_reuniao), public.ata_sync_ativo(uuid), public.cliente_em_exclusao(text), public.edita_ata() to authenticated;
revoke all on public.v_dossie_atas_inconsistencias from anon, authenticated;

select 'ok 0108' as resultado,
       (select count(*) from public.entradas_timeline where ata_origem_id is not null) as entradas_vinculadas,
       (select count(*) from public.atas_reuniao) as atas,
       (select count(*) from pg_policies where tablename = 'atas_reuniao') as policies_atas,
       (select count(*) from pg_trigger where tgrelid = 'public.atas_reuniao'::regclass and not tgisinternal) as triggers_atas,
       (select count(*) from pg_trigger where tgrelid = 'public.entradas_timeline'::regclass and tgname = 'entradas_timeline_ata_guarda') as protecao,
       (select count(*) from public.v_dossie_atas_inconsistencias) as inconsistencias;
