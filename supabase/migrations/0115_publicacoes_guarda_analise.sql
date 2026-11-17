-- 0115 · Publicações: a tarefa de análise não pode ser concluída enquanto houver intimação dela sem análise
--
-- Contexto (regra que já existe desde a 0062/0081): duas publicações do MESMO processo no MESMO dia caem na mesma tarefa
-- "Analisar N publicações". Isso evita tarefas repetidas, mas são atos distintos, que podem pedir providências diferentes.
-- Hoje é possível concluir essa tarefa tendo registrado a providência de só uma delas — a outra some da agenda sem análise.
--
-- O que muda: concluir a tarefa de análise passa a exigir que TODAS as publicações ligadas a ela tenham providência registrada
-- ("Tratar") ou estejam ignoradas. A análise e os prazos continuam sendo por publicação (providência, histórico, prazos conferidos).
-- "Lida" não conta: ler não é tratar.
--
-- O que NÃO muda: o agrupamento em si, as publicações, as tarefas existentes, cancelamento de tarefa, exclusão/encerramento de
-- cliente, rotinas do sistema. Não cria tarefa, não cria agendamento, não faz chamada externa.
-- Independente da 0114 (Sync): pode ser aplicada sozinha. NÃO APLICADA em nenhum ambiente.
create or replace function public.tarefas_guarda_analise_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare n integer; nums text;
begin
  if new.status = 'concluida' and old.status is distinct from 'concluida' then
    select count(*), string_agg(to_char(p.data_disponibilizacao, 'DD/MM') || coalesce(' · ' || coalesce(p.tipo_documento, p.tipo_comunicacao), ''), '; ' order by p.id)
      into n, nums from public.publicacoes p where p.tarefa_id = new.id and p.providencia is null and not coalesce(p.ignorada, false);
    if n > 0 then
      raise exception 'Esta tarefa reúne % publicação(ões) ainda sem análise (%). Registre a providência de cada uma em Publicações antes de concluir.', n, left(nums, 200) using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_guarda_analise on public.tarefas;
create trigger tarefas_guarda_analise before update of status on public.tarefas for each row execute function public.tarefas_guarda_analise_tg();

select 'ok 0115' as resultado, (select count(*) from pg_trigger where tgname = 'tarefas_guarda_analise') as gatilho,
       (select count(*) from public.tarefas t where t.status in ('aberta', 'em_andamento') and exists (select 1 from public.publicacoes p where p.tarefa_id = t.id and p.providencia is null and not coalesce(p.ignorada, false))) as tarefas_abertas_com_publicacao_sem_analise;

-- Reversão: drop trigger tarefas_guarda_analise on public.tarefas; drop function public.tarefas_guarda_analise_tg();
