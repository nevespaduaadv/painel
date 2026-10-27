-- ESPELHO (beta) — Andamentos duplicados (mesma intimação captada várias vezes pelo DJEN, um registro por destinatário).
-- 1) Limpeza: apaga as cópias mantendo a mais antiga (texto, data e processo iguais), religando publicações/timeline que apontavam para a cópia.
-- 2) Prevenção: índice único para andamentos automáticos (fonte <> 'manual') por processo + data + texto — o "on conflict do nothing" do DJEN passa a valer.
-- 3) v_dossie já lê andamentos sem repetição.
-- Idempotente.

create or replace function public.andamentos_deduplicar() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  if not public.sou_admin() then raise exception 'Só administradores.'; end if;
  for r in
    select a.id as dup, (select x.id from public.andamentos x where x.processo_id = a.processo_id and x.data = a.data and md5(x.descricao) = md5(a.descricao) order by x.created_at, x.id limit 1) as mantido
      from public.andamentos a
     where exists (select 1 from public.andamentos y where y.processo_id = a.processo_id and y.data = a.data and md5(y.descricao) = md5(a.descricao) and (y.created_at, y.id) < (a.created_at, a.id))
  loop
    update public.publicacoes set andamento_id = r.mantido where andamento_id = r.dup;
    update public.entradas_timeline set andamento_id = r.mantido where andamento_id = r.dup;
    delete from public.andamentos where id = r.dup; n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.andamentos_deduplicar() to authenticated;

-- limpa agora (como superusuário do script, sem a checagem de admin)
do $$ declare r record; begin
  for r in
    select a.id as dup, (select x.id from public.andamentos x where x.processo_id = a.processo_id and x.data = a.data and md5(x.descricao) = md5(a.descricao) order by x.created_at, x.id limit 1) as mantido
      from public.andamentos a
     where exists (select 1 from public.andamentos y where y.processo_id = a.processo_id and y.data = a.data and md5(y.descricao) = md5(a.descricao) and (y.created_at, y.id) < (a.created_at, a.id))
  loop
    update public.publicacoes set andamento_id = r.mantido where andamento_id = r.dup;
    update public.entradas_timeline set andamento_id = r.mantido where andamento_id = r.dup;
    delete from public.andamentos where id = r.dup;
  end loop;
end $$;

create unique index if not exists andamentos_auto_unicos_idx on public.andamentos (processo_id, data, md5(descricao)) where fonte <> 'manual';

select 'ok beta 0009' as resultado, (select count(*) from public.andamentos) as andamentos;
