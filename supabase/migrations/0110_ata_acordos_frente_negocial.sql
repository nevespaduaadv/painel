-- 0110 — Ata registrada pelo núcleo Acordos entra no dossiê na frente NEGOCIAL (as demais seguem Estratégico).
-- Depende da 0108 (ata_dossie_sync_tg / ata_dossie_exclusao_tg). NÃO aplicar sem autorização específica.
--
-- Preferência das sócias (15/11): atas do setor de Acordos identificadas na frente Negocial, não na Estratégica.
-- Compatibilidade conferida antes: entradas_timeline.frente aceita 'negocial' (check da 0080); nenhuma política de acesso
-- depende da frente (tl_sel/tl_wr = sou_equipe); o dossiê filtra e agrupa por frente (cartão "Negocial / Acordos");
-- o CSV do dossiê exporta a frente; o Acompanhamento PJ lê as atas de atas_reuniao (não da frente).
-- Efeito colateral a saber: o aviso automático da entrada (tl_avisar_frente_tg) passa a ir para a pessoa responsável
-- NEGOCIAL do cliente (quando não for a própria autora), e não mais para a Estratégica.
--
-- Regra: frente = 'negocial' quando o AUTOR da ata (autor_id, definido pelo banco na 0107) é colaborador do núcleo
-- 'acordos'; senão 'estrategico'. Só vale para entradas NOVAS (inserção da ata, ata antiga sem entrada que ganha uma, e o
-- registro de exclusão de ata sem entrada). Entradas existentes NÃO são alteradas (edição da ata não mexe na frente).
-- As duas funções abaixo são as da 0108 com uma única diferença: a frente. Idempotente.

create or replace function public.ata_frente(p_autor uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.colaboradores c where c.id = p_autor and c.nucleo = 'acordos')
              then 'negocial' else 'estrategico' end
$$;
revoke execute on function public.ata_frente(uuid) from public, anon;
grant execute on function public.ata_frente(uuid) to authenticated;

create or replace function public.ata_dossie_sync_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('np.ata_sync', new.id::text, true);
  if tg_op = 'INSERT' then
    insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente, ata_origem_id, ata_versao)
    values (new.cliente_id, new.data, 'ata', public.ata_texto_dossie(new), false, coalesce(new.created_by, auth.uid()), public.ata_frente(new.autor_id), new.id, 1);
  elsif (new.tipo, new.data, new.titulo, new.resumo, new.link_pasta, new.link_gravacao)
        is distinct from (old.tipo, old.data, old.titulo, old.resumo, old.link_pasta, old.link_gravacao) then
    update public.entradas_timeline
       set descricao = public.ata_texto_dossie(new), data = new.data, ata_versao = coalesce(ata_versao, 1) + 1,
           ata_atualizada_em = now(), ata_atualizada_por = auth.uid()
     where ata_origem_id = new.id;
    if not found then   -- ata antiga sem entrada vinculada: passa a ter
      insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente, ata_origem_id, ata_versao, ata_atualizada_em, ata_atualizada_por)
      values (new.cliente_id, new.data, 'ata', public.ata_texto_dossie(new), false, coalesce(new.created_by, auth.uid()), public.ata_frente(new.autor_id), new.id, 2, now(), auth.uid());
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
    values (old.cliente_id, old.data, 'ata', public.ata_texto_dossie(old), false, true, coalesce(old.created_by, auth.uid()), public.ata_frente(old.autor_id), old.id, 1, now(), auth.uid());
  end if;
  perform set_config('np.ata_sync', '', true);
  return old;
end $$;

select 'ok 0110' as resultado,
       (select count(*) from public.entradas_timeline where ata_origem_id is not null and frente = 'negocial') as entradas_negocial,
       (select count(*) from public.entradas_timeline where ata_origem_id is not null and frente = 'estrategico') as entradas_estrategico;
