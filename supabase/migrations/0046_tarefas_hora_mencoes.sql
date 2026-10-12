-- 0046 — Tarefas: horário opcional no prazo (audiência às 14h) e @menções nos comentários (notificação no sino para quem foi marcado).
-- Idempotente. Depende de 0034 (tarefa_eventos/notificar), 0035 (v_tarefas).

alter table public.tarefas add column if not exists hora time;

-- v_tarefas: mesma ordem de colunas, + hora no fim
create or replace view public.v_tarefas with (security_invoker = true) as
select t.id, t.titulo, t.descricao, t.cliente_id, t.contrato_id, t.processo_id, t.responsavel_id, t.nucleo, t.prazo, t.prazo_fatal, t.status, t.concluida_em, t.prioridade, t.created_at, t.created_by, t.updated_at, t.updated_by,
       c.nome as cliente_nome,
       co.nome as responsavel_nome,
       p.numero_cnj,
       (t.prazo - current_date) as dias_para_prazo,
       case when t.status in ('concluida','cancelada') then 'fechada'
            when t.prazo is null then 'sem_prazo'
            when t.prazo < current_date then 'atrasada'
            when t.prazo = current_date then 'hoje'
            when t.prazo <= current_date + 7 then 'd7'
            when t.prazo <= current_date + 15 then 'd15'
            when t.prazo <= current_date + 30 then 'd30'
            else 'depois' end as faixa,
       case when t.status = 'concluida' and t.prazo is not null then (t.concluida_em::date <= t.prazo) end as concluida_no_prazo,
       coalesce((select sum(h.horas) from public.apontamentos_horas h where h.tarefa_id = t.id), 0) as horas_apontadas,
       t.concluida_por,
       public.nome_perfil(t.created_by) as criado_por_nome,
       public.nome_perfil(t.concluida_por) as concluida_por_nome,
       t.publicacao_id,
       t.hora
from public.tarefas t
left join public.clientes c on c.id = t.cliente_id
left join public.colaboradores co on co.id = t.responsavel_id
left join public.processos p on p.id = t.processo_id;

-- @menções: "@Nome" ou "@Nome Sobrenome" no comentário → notifica o colaborador (primeiro nome ou apelido, sem acento/caixa)
create or replace function public.sem_acento(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;
create or replace function public.tarefa_mencoes() returns trigger language plpgsql security definer set search_path = public as $$
declare m text; alvo record; t public.tarefas%rowtype; quem text; vistos uuid[] := '{}';
begin
  if new.tipo <> 'comentario' or new.nota is null or position('@' in new.nota) = 0 then return null; end if;
  select * into t from public.tarefas where id = new.tarefa_id; if t is null then return null; end if;
  quem := coalesce(new.autor_nome, 'Alguém');
  for m in select distinct lower(x[1]) from regexp_matches(new.nota, '@([[:alpha:]][[:alnum:]._-]*(?:\s[[:upper:]][[:alpha:]]+)?)', 'g') x loop
    for alvo in
      select c.perfil_id from public.colaboradores c
      where c.perfil_id is not null and c.ativo is distinct from false
        and (public.sem_acento(c.nome) = public.sem_acento(m)
             or public.sem_acento(split_part(c.nome,' ',1)) = public.sem_acento(split_part(m,' ',1)) and (position(' ' in m) = 0 or public.sem_acento(c.nome) like public.sem_acento(m) || '%')
             or public.sem_acento(c.apelido) = public.sem_acento(m))
    loop
      if alvo.perfil_id = any(vistos) then continue; end if; vistos := vistos || alvo.perfil_id;
      perform public.notificar(alvo.perfil_id, quem || ' mencionou você em "' || left(t.titulo, 60) || '"', left(new.nota, 200), '#tarefas/' || t.id::text);
    end loop;
  end loop;
  return null;
end $$;
drop trigger if exists tarefa_mencoes_trg on public.tarefa_eventos;
create trigger tarefa_mencoes_trg after insert on public.tarefa_eventos for each row execute procedure public.tarefa_mencoes();

select 'ok 0046' as resultado;
