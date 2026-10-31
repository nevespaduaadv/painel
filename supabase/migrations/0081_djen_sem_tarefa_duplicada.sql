-- 0081 — Publicações do DJEN: não recriar tarefa quando a publicação já existe.
-- O cron grava com "insert … on conflict (id) do update"; o gatilho BEFORE INSERT disparava a cada rodada e abria uma tarefa
-- "Analisar publicação" nova para a mesma publicação (59 tarefas para 9 publicações em 31/10). Agora o gatilho sai cedo quando
-- a publicação já está gravada. Também fecha as cópias órfãs (abertas e sem publicação apontando para elas). Idempotente.

create or replace function public.publicacao_vincular() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.processos%rowtype; t uuid; a uuid; resumo text; dig text; rotulo text; n integer;
begin
  -- publicação já gravada (upsert do cron caindo no "on conflict"): nada a vincular de novo
  if tg_op = 'INSERT' and exists (select 1 from public.publicacoes where id = new.id) then return new; end if;
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

-- cópias órfãs ainda abertas (nenhuma publicação aponta para elas): cancela
update public.tarefas t set status = 'cancelada', updated_at = now()
 where t.titulo like 'Analisar publica%' and t.status in ('aberta','em_andamento')
   and not exists (select 1 from public.publicacoes pb where pb.tarefa_id = t.id);

select 'ok 0081' as resultado,
       (select count(*) from public.tarefas where titulo like 'Analisar publica%' and status in ('aberta','em_andamento')) as abertas_publicacao;
