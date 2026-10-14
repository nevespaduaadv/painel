-- 0062 — Publicações do DJEN: uma tarefa por processo e dia de disponibilização (em vez de uma por publicação).
-- A segunda publicação do mesmo processo no mesmo dia entra na descrição da tarefa já aberta. Limpa as duplicadas existentes.
-- Idempotente. Depende de 0014.

create or replace function public.publicacao_vincular() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.processos%rowtype; t uuid; a uuid; resumo text; dig text; rotulo text; n integer;
begin
  dig := regexp_replace(coalesce(new.numero_processo,''), '\D', '', 'g');
  if new.processo_id is null and dig <> '' then
    select * into p from public.processos where regexp_replace(coalesce(numero_cnj,''), '\D', '', 'g') = dig limit 1;
    if found then new.processo_id := p.id; end if;
  end if;
  if new.processo_id is not null and new.andamento_id is null then
    if p.id is null or p.id <> new.processo_id then select * into p from public.processos where id = new.processo_id; end if;
    new.cliente_id := p.cliente_id;
    rotulo := coalesce(new.tipo_documento, new.tipo_comunicacao, 'Publicação');
    resumo := rotulo||' · '||coalesce(new.tribunal,'')||' · '||coalesce(new.orgao,'');
    insert into public.andamentos (processo_id, data, tipo, descricao, visivel_cliente, fonte, id_externo)
    values (new.processo_id, new.data_disponibilizacao, 'intimacao', resumo||E'\n'||left(coalesce(new.texto,''), 1500), false, 'djen', 'djen:'||new.id)
    on conflict do nothing returning id into a;
    new.andamento_id := a;
    -- tarefa já aberta para o mesmo processo e o mesmo dia? então agrupa
    select t2.id into t from public.tarefas t2
     join public.publicacoes pb on pb.tarefa_id = t2.id
     where pb.processo_id = new.processo_id and pb.data_disponibilizacao = new.data_disponibilizacao and pb.id <> new.id
       and t2.status in ('aberta','em_andamento')
     order by t2.created_at limit 1;
    if t is not null then
      select count(*) + 1 into n from public.publicacoes where tarefa_id = t;
      update public.tarefas set
        titulo = 'Analisar '||n||' publicações · '||coalesce(new.numero_processo,''),
        descricao = coalesce(descricao,'')||E'\n\n— '||rotulo||' —\n'||left(coalesce(new.texto,''), 600),
        updated_at = now()
      where id = t;
    else
      insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, status, prioridade)
      values ('Analisar publicação: '||rotulo||' · '||coalesce(new.numero_processo,''),
              'Publicada no DJEN em '||to_char(new.data_disponibilizacao,'DD/MM/YYYY')||'. Verifique o prazo e registre a providência.'||E'\n\n— '||rotulo||' —\n'||left(coalesce(new.texto,''), 600),
              new.cliente_id, new.processo_id, p.responsavel_id, 'juridico', new.data_disponibilizacao + 1, false, 'aberta', 1)
      returning id into t;
    end if;
    new.tarefa_id := t;
  end if;
  return new;
end $$;

-- limpeza: grupos de tarefas abertas "Analisar publicação" do mesmo processo e mesmo prazo → mantém a mais antiga, apaga as outras
do $$
declare g record; manter uuid; apagar uuid[]; n integer; num text;
begin
  for g in
    select processo_id, prazo, array_agg(id order by created_at) as ids
    from public.tarefas
    where titulo like 'Analisar publica%' and status in ('aberta','em_andamento') and processo_id is not null
    group by processo_id, prazo having count(*) > 1
  loop
    manter := g.ids[1]; apagar := g.ids[2:];
    update public.publicacoes set tarefa_id = manter where tarefa_id = any(apagar);
    update public.tarefas set descricao = coalesce(descricao,'') || (
        select string_agg(E'\n\n— '||coalesce(pb.tipo_documento, pb.tipo_comunicacao, 'Publicação')||' —\n'||left(coalesce(pb.texto,''), 600), '' order by pb.id)
        from public.publicacoes pb where pb.tarefa_id = manter and pb.id not in (select pb2.id from public.publicacoes pb2 where pb2.tarefa_id = manter order by pb2.id limit 1))
      where id = manter;
    select count(*) into n from public.publicacoes where tarefa_id = manter;
    select numero_processo into num from public.publicacoes where tarefa_id = manter limit 1;
    update public.tarefas set titulo = 'Analisar '||n||' publicações · '||coalesce(num,'') where id = manter and n > 1;
    delete from public.tarefa_eventos where tarefa_id = any(apagar);
    delete from public.tarefas where id = any(apagar);
  end loop;
end $$;

select 'ok 0062' as resultado;
