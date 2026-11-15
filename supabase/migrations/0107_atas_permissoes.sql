-- 0107 — Permissões das atas de reunião (homologação de 15/11/2026; decisão da sócia).
-- Até aqui: ata_sel = ata_wr = sou_equipe() — qualquer membro da equipe criava, editava e excluía atas de qualquer cliente,
-- inclusive por chamada direta à API, e a V2 reenviava autor_id na edição.
--
-- ESTÁGIO 1 (este arquivo) — piloto com CRIAÇÃO E CONSULTA de atas:
--   • leitura: equipe que enxerga o cliente (RLS de clientes);
--   • criação: admin, quem conduz o Acompanhamento PJ (edita_protecao: acesso 'protecao', frente Estratégico, núcleos
--     acompanhamento_pj/pos_vendas/socios) e o núcleo ACORDOS — Acordos entra SÓ nas atas (edita_protecao não muda: ciclo,
--     Raio-X, proteção e medidas continuam restritos);
--   • edição e exclusão: NENHUMA policy de UPDATE/DELETE → bloqueadas pela RLS para todos os usuários (autores inclusive),
--     também pela API. Correções no piloto: registrar nova ata. Liberação na 0108 (vínculo ata ↔ dossiê), ver bloco final;
--   • autoria atribuída pelo banco a partir da sessão (autor_id = meu_colaborador(), created_by = auth.uid()), ignorando o que
--     o cliente enviar; autor_id, created_by, created_at e cliente_id imutáveis no UPDATE (gatilho — vale desde já para o estágio 2).
-- Idempotente. Só RLS/função/trigger: não altera dados nem colunas.

-- ---------- quem pode criar atas ----------
create or replace function public.edita_ata() returns boolean
language sql stable security definer set search_path = public as $$
  select public.edita_protecao()
      or exists (select 1 from public.colaboradores c
                  where c.perfil_id = auth.uid() and coalesce(c.ativo, true) and c.nucleo = 'acordos')
$$;
revoke all on function public.edita_ata() from public;
grant execute on function public.edita_ata() to authenticated;

-- ---------- autoria pelo banco; campos de origem imutáveis ----------
create or replace function public.atas_guard_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare meu uuid := public.meu_colaborador();
begin
  if tg_op = 'INSERT' then
    if meu is null then
      raise exception 'Seu usuário não está vinculado a um colaborador ativo; não é possível registrar a ata.' using errcode = '42501';
    end if;
    new.autor_id   := meu;            -- nunca o valor enviado pelo cliente
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
  end if;
  -- UPDATE (bloqueado neste estágio pela ausência de policy; regra pronta para o estágio 2)
  new.autor_id   := old.autor_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.cliente_id := old.cliente_id;   -- a ata não troca de cliente
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists atas_guard on public.atas_reuniao;
create trigger atas_guard before insert or update on public.atas_reuniao for each row execute function public.atas_guard_tg();

-- ---------- políticas ----------
drop policy if exists ata_wr  on public.atas_reuniao;
drop policy if exists ata_sel on public.atas_reuniao;
drop policy if exists ata_ins on public.atas_reuniao;
drop policy if exists ata_upd on public.atas_reuniao;
drop policy if exists ata_del on public.atas_reuniao;

-- leitura: equipe que enxerga o cliente (a RLS de clientes decide; hoje toda a equipe)
create policy ata_sel on public.atas_reuniao for select to authenticated
  using (public.sou_equipe() and exists (select 1 from public.clientes c where c.id = atas_reuniao.cliente_id));

-- criação: quem conduz o acompanhamento ou Acordos, para cliente que enxerga; autoria é reescrita pelo gatilho
create policy ata_ins on public.atas_reuniao for insert to authenticated
  with check (public.edita_ata() and exists (select 1 from public.clientes c where c.id = atas_reuniao.cliente_id));

-- UPDATE / DELETE: sem policy neste estágio = negados a todos os usuários autenticados (inclusive admin e autor).

-- ---------- ESTÁGIO 2 (entra com a 0108, depois do vínculo ata ↔ dossiê) — NÃO executar agora ----------
-- create policy ata_upd on public.atas_reuniao for update to authenticated
--   using ((atas_reuniao.autor_id = public.meu_colaborador()
--             and exists (select 1 from public.colaboradores c where c.id = atas_reuniao.autor_id and coalesce(c.ativo, true))
--           or public.edita_protecao())
--          and exists (select 1 from public.clientes c where c.id = atas_reuniao.cliente_id))
--   with check (exists (select 1 from public.clientes c where c.id = atas_reuniao.cliente_id));
-- create policy ata_del on public.atas_reuniao for delete to authenticated using (public.sou_admin());
-- (autor inativo ou sem acesso ao cliente deixa de editar; o gatilho atas_guard mantém autor/criação/cliente imutáveis)

select 'ok 0107' as resultado,
       (select count(*) from pg_policies where tablename = 'atas_reuniao') as policies_atas,
       (select count(*) from pg_trigger where tgrelid = 'public.atas_reuniao'::regclass and not tgisinternal) as triggers_atas;
