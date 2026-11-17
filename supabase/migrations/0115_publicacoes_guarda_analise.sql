-- 0115 · Publicações: controle individual de cada intimação dentro da tarefa de análise agrupada
--
-- Decisão das sócias (17/11): o agrupamento das tarefas de análise continua (duas publicações do mesmo processo e do mesmo dia
-- na mesma tarefa "Analisar N publicações"), mas cada publicação tem a sua análise e precisa da sua providência.
--
-- Regras garantidas NO BANCO (valem para a tela, para a API e para qualquer rotina):
--   1. A tarefa de análise não é CONCLUÍDA enquanto houver publicação ligada a ela sem providência (e não ignorada).
--      A mensagem diz quantas faltam e quais (processo, data, tipo).
--   2. "Lida" não conta: ler não é tratar.
--   3. A tarefa de análise não é CANCELADA por uma pessoa, pela tela ou pela API, enquanto houver publicação dela sem providência
--      (cancelar não pode esconder intimação pendente). Rotinas internas do sistema (encerramento de cliente, limpeza de cópias)
--      continuam podendo cancelar — e a publicação segue aparecendo como pendente em Publicações, que não depende da tarefa.
--   4. Tratar uma publicação não trata nem conclui nenhuma outra (nada aqui altera publicações).
--   5. public.tarefa_publicacoes_pendentes(tarefa) devolve a lista exata do que falta, para a tela mostrar.
--
-- Não muda: o agrupamento, as publicações, as tarefas existentes, o histórico. Não cria tarefa, não cria agendamento, não faz
-- chamada externa. Independente da 0114 (Sync). NÃO APLICADA em nenhum ambiente.
create or replace function public.tarefa_publicacoes_pendentes(p_tarefa uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('publicacao_id', p.id, 'numero_processo', p.numero_processo, 'data', p.data_disponibilizacao, 'tipo', coalesce(p.tipo_documento, p.tipo_comunicacao), 'lida', p.lida) order by p.data_disponibilizacao, p.id), '[]'::jsonb)
    from public.publicacoes p where p.tarefa_id = p_tarefa and p.providencia is null and not coalesce(p.ignorada, false) and public.sou_equipe() $$;
revoke all on function public.tarefa_publicacoes_pendentes(uuid) from public, anon; grant execute on function public.tarefa_publicacoes_pendentes(uuid) to authenticated;

-- contagem e descrição do que falta (função com privilégio do dono, para o gatilho enxergar as publicações independentemente de quem chama;
-- a descrição só é devolvida à equipe ou a rotinas internas)
create or replace function public.tarefa_pendencias_analise(p_tarefa uuid, out n integer, out quais text, out detalhe text) language sql stable security definer set search_path = public as $$
  select count(*)::integer,
         case when public.sou_equipe() or auth.uid() is null then string_agg(coalesce(p.numero_processo, 'sem número') || ' · ' || to_char(p.data_disponibilizacao, 'DD/MM') || coalesce(' · ' || coalesce(p.tipo_documento, p.tipo_comunicacao), ''), '; ' order by p.data_disponibilizacao, p.id) end,
         case when public.sou_equipe() or auth.uid() is null then coalesce(jsonb_agg(jsonb_build_object('publicacao_id', p.id, 'numero_processo', p.numero_processo, 'data', p.data_disponibilizacao, 'tipo', coalesce(p.tipo_documento, p.tipo_comunicacao)) order by p.data_disponibilizacao, p.id), '[]'::jsonb)::text end
    from public.publicacoes p where p.tarefa_id = p_tarefa and p.providencia is null and not coalesce(p.ignorada, false) $$;
revoke all on function public.tarefa_pendencias_analise(uuid) from public, anon; grant execute on function public.tarefa_pendencias_analise(uuid) to authenticated;

-- O gatilho roda com a identidade de QUEM CHAMA (não é "security definer"): assim distingue a pessoa que altera a tarefa direto
-- pela tela/API (papel authenticated) de uma rotina interna do sistema (função com privilégio do dono).
create or replace function public.tarefas_guarda_analise_tg() returns trigger language plpgsql set search_path = public as $$
declare r record;
begin
  if new.status is distinct from old.status and new.status in ('concluida', 'cancelada') then
    if new.status = 'cancelada' and current_user not in ('authenticated', 'anon') then return new; end if;   -- rotina interna
    select * into r from public.tarefa_pendencias_analise(new.id);
    if r.n > 0 then
      raise exception 'Esta tarefa reúne % publicação(ões) ainda sem providência: %. Registre a providência de cada uma em Publicações antes de % a tarefa.', r.n, left(coalesce(r.quais, '—'), 300), case when new.status = 'concluida' then 'concluir' else 'cancelar' end
        using errcode = '23514', detail = coalesce(r.detalhe, '[]');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_guarda_analise on public.tarefas;
create trigger tarefas_guarda_analise before update of status on public.tarefas for each row execute function public.tarefas_guarda_analise_tg();

select 'ok 0115' as resultado, (select count(*) from pg_trigger where tgname = 'tarefas_guarda_analise') as gatilho,
       (select count(*) from public.tarefas t where t.status in ('aberta', 'em_andamento') and exists (select 1 from public.publicacoes p where p.tarefa_id = t.id and p.providencia is null and not coalesce(p.ignorada, false))) as tarefas_abertas_com_publicacao_sem_providencia,
       (select count(*) from public.tarefas t where t.status in ('concluida', 'cancelada') and exists (select 1 from public.publicacoes p where p.tarefa_id = t.id and p.providencia is null and not coalesce(p.ignorada, false))) as tarefas_ja_encerradas_com_publicacao_sem_providencia;

-- Reversão: drop trigger tarefas_guarda_analise on public.tarefas; drop function public.tarefas_guarda_analise_tg(), public.tarefa_publicacoes_pendentes(uuid), public.tarefa_pendencias_analise(uuid);
