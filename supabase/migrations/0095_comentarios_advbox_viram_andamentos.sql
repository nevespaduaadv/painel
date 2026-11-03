-- 0095 — "Comentários" importados do ADVBox não são tarefas: viram andamentos no dossiê do cliente (entradas_timeline),
-- com a data/hora original e o autor. As tarefas convertidas são apagadas (sem alerta). Também o campo clientes.dados.grupo
-- (vínculo entre empresas do mesmo contrato/sócios) passa a ser lido pela view v_dossie_grupo. Idempotente.

do $$
declare r record; n int := 0; aut uuid; txt text;
begin
  alter table public.tarefas disable trigger user;
  for r in select t.* from public.tarefas t
            where t.titulo = 'Comentário' and t.cliente_id is not null
              and (t.descricao like '%(ADVBox #%' or t.descricao like '%(importado do ADVBox)%')
  loop
    txt := btrim(regexp_replace(regexp_replace(coalesce(r.descricao,''), '\s*\(ADVBox #\d+\)\s*', '', 'g'), '\s*\(importado do ADVBox\)\s*', '', 'g'));
    if txt = '' then txt := '(comentário sem texto)'; end if;
    if not exists (select 1 from public.entradas_timeline e where e.id_externo = 'advbox:tarefa:' || r.id) then
      insert into public.entradas_timeline (cliente_id, processo_id, data, tipo, descricao, responsavel_id, visivel_cliente, automatica, fonte, id_externo, frente, created_at)
      values (r.cliente_id, r.processo_id, coalesce(r.prazo, r.created_at::date), 'registro', txt, r.responsavel_id, false, false, 'advbox', 'advbox:tarefa:' || r.id,
              coalesce((select frente from public.colaboradores c where c.id = r.responsavel_id), 'juridico'), r.created_at);
      n := n + 1;
    end if;
    delete from public.tarefa_eventos where tarefa_id = r.id;
    delete from public.tarefas where id = r.id;
  end loop;
  alter table public.tarefas enable trigger user;
  raise notice 'comentários convertidos em andamentos: %', n;
end $$;

-- v_dossie com empresas do mesmo grupo (clientes.dados->>'grupo' igual)
create or replace view public.v_dossie_grupo with (security_invoker = true) as
select d.*, c.nome as de_cliente_nome, c.dados->>'grupo' as grupo
from public.v_dossie d join public.clientes c on c.id = d.cliente_id;
grant select on public.v_dossie_grupo to authenticated;

select 'ok 0095' as resultado,
       (select count(*) from public.entradas_timeline where fonte = 'advbox' and id_externo like 'advbox:tarefa:%') as andamentos_convertidos,
       (select count(*) from public.tarefas where titulo = 'Comentário') as comentarios_restantes;
