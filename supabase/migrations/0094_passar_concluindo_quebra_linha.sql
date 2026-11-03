-- 0094 — corrige a quebra de linha literal (\n) na descrição da tarefa criada por 'passar e concluir a minha parte'. Idempotente.
create or replace function public.tarefa_passar_concluindo(p_tarefa uuid, p_para uuid, p_prazo date, p_nota text) returns uuid
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); t public.tarefas%rowtype; nova uuid; meu text; quem text;
begin
  if eu is null then raise exception 'Sessão expirada'; end if;
  if nullif(btrim(coalesce(p_nota,'')),'') is null then raise exception 'Escreva o que você fez antes de passar'; end if;
  select * into t from public.tarefas where id = p_tarefa; if not found then raise exception 'Tarefa não encontrada'; end if;
  meu := public.nome_perfil(eu); select nome into quem from public.colaboradores where id = p_para;
  -- nova tarefa para quem recebe (herda cliente, processo, contrato, núcleo, fatal, prioridade)
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, processo_id, responsavel_id, nucleo, prazo, hora, prazo_fatal, prioridade, status, created_by)
  values (t.titulo, coalesce(t.descricao,'') || E'\n\n— Recebida de ' || coalesce(meu,'') || ' em ' || to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY') || E' —\n' || btrim(p_nota) || E'\n(continuação da tarefa ' || t.id || ')',
          t.cliente_id, t.contrato_id, t.processo_id, p_para, t.nucleo, coalesce(p_prazo, t.prazo), case when p_prazo is null or p_prazo = t.prazo then t.hora else null end, t.prazo_fatal, t.prioridade, 'aberta', eu)
  returning id into nova;
  -- conclui a minha
  insert into public.tarefa_eventos (tarefa_id, tipo, nota, autor, autor_nome) values (p_tarefa, 'comentario', 'Passei para ' || coalesce(quem,'—') || ' e concluí a minha parte.' || E'\n' || btrim(p_nota) || E'\n(nova tarefa: ' || nova || ')', eu, meu);
  update public.tarefas set status = 'concluida', concluida_em = now() where id = p_tarefa;
  return nova;
end $$;
select 'ok 0094' as resultado;
