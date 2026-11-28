-- 0130 · Lapidações pedidas pela sócia em 28/11/2026. Idempotente.
--   A) Adimplência com o escritório: só o ESTADO (adimplente / inadimplente), sem valores, visível a toda a equipe na Carteira;
--      vem do Asaas (cobrança atrasada) ou do que o Financeiro informar (pagou no cartão ou à vista).
--      Quando o cliente fica inadimplente, o líder da carteira (PF ou PJ) recebe aviso no sino.
--   B) Conteúdo que entra na pauta para aprovação: sino para as aprovadoras + mensagem no canal do Discord configurado.
--   C) @menções em qualquer comentário ou descrição: quem foi marcado recebe aviso no sino.
-- Observação sobre a 0129: valores, cobranças e resumos financeiros continuam só para quem tem a área Financeiro.
-- Esta migração libera apenas a marca "adimplente / inadimplente com o escritório", a pedido da sócia.
-- Para desfazer: ver o bloco no fim do arquivo.

-- =====================================================================================================
-- A) ADIMPLÊNCIA COM O ESCRITÓRIO
-- =====================================================================================================
alter table public.clientes add column if not exists adimplencia_manual text;
alter table public.clientes add column if not exists adimplencia_manual_em timestamptz;
alter table public.clientes add column if not exists adimplencia_manual_por uuid;
alter table public.clientes add column if not exists adimplencia_manual_obs text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_adimplencia_manual_chk') then
    alter table public.clientes add constraint clientes_adimplencia_manual_chk check (adimplencia_manual is null or adimplencia_manual in ('adimplente','inadimplente'));
  end if;
end $$;

-- regra única do estado. Ordem: o que o Financeiro informou; cobrança atrasada no Asaas; marcação antiga "honorários em dia?"; existência de cobranças.
create or replace function public.adimplencia_calc(p_cliente text, p_manual text, p_antigo boolean) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_manual is not null then p_manual
    when exists (select 1 from public.cobrancas k where k.cliente_id = p_cliente and k.status = 'atrasada') then 'inadimplente'
    when p_antigo is false then 'inadimplente'
    when p_antigo is true or exists (select 1 from public.cobrancas k where k.cliente_id = p_cliente and k.status in ('pendente','paga')) then 'adimplente'
    else null end
$$;
revoke all on function public.adimplencia_calc(text, text, boolean) from public, anon, authenticated;

-- leitura para a Carteira: uma linha por cliente com estado conhecido. Não traz valor, vencimento nem quantidade.
create or replace function public.clientes_adimplencia() returns table (cliente_id text, situacao text, origem text)
language sql stable security definer set search_path = public as $$
  select c.id, public.adimplencia_calc(c.id, c.adimplencia_manual, c.adimplente),
         case when c.adimplencia_manual is not null then 'financeiro' else 'asaas' end
  from public.clientes c
  where public.sou_equipe() and public.adimplencia_calc(c.id, c.adimplencia_manual, c.adimplente) is not null
$$;
revoke all on function public.clientes_adimplencia() from public, anon;
grant execute on function public.clientes_adimplencia() to authenticated;

-- líderes de carteira (perfis). Editável por administradora em escritorio('carteira').
insert into public.escritorio (id, dados)
select 'carteira', jsonb_build_object(
  'lider_pf', (select id from public.perfis where papel in ('admin','colaborador') and public.sem_acento(nome) like 'maria flavia%' order by nome limit 1),
  'lider_pj', (select id from public.perfis where papel in ('admin','colaborador') and public.sem_acento(nome) like 'ana lui_a%' order by nome limit 1))
on conflict (id) do nothing;

create or replace function public.inadimplencia_avisar_lider(p_cliente text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; lider uuid;
begin
  select id, coalesce(nullif(nome,''), dados->>'nome', id) as nome, coalesce(tipo_pessoa,'PJ') as tipo into c from public.clientes where id = p_cliente;
  if c.id is null then return; end if;
  select nullif(dados->>(case when c.tipo = 'PF' then 'lider_pf' else 'lider_pj' end), '')::uuid into lider from public.escritorio where id = 'carteira';
  if lider is null then return; end if;
  insert into public.notificacoes (perfil_id, titulo, texto, link)
  values (lider, 'Cliente inadimplente com o escritório: ' || left(c.nome, 80),
          coalesce(p_motivo || ' ', '') || 'Apoie o Financeiro na recuperação e alinhe o pagamento com o cliente antes de novos protocolos ou serviços.',
          '#clientes/' || c.id);
end $$;
revoke all on function public.inadimplencia_avisar_lider(text, text) from public, anon, authenticated;

-- Asaas: a cobrança passou a "atrasada"
create or replace function public.cobranca_inadimplencia_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; antes text;
begin
  if new.cliente_id is null or new.status <> 'atrasada' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'atrasada' and old.cliente_id is not distinct from new.cliente_id then return null; end if;
  select id, adimplencia_manual, adimplente into c from public.clientes where id = new.cliente_id;
  if c.id is null then return null; end if;
  -- estado antes desta cobrança atrasar
  antes := case
    when c.adimplencia_manual is not null then c.adimplencia_manual
    when exists (select 1 from public.cobrancas k where k.cliente_id = c.id and k.status = 'atrasada' and k.id <> new.id) then 'inadimplente'
    when c.adimplente is false then 'inadimplente' else 'adimplente' end;
  -- "em dia" informado pelo Financeiro valia para a situação anterior: uma nova parcela vencida desfaz a marcação
  if c.adimplencia_manual = 'adimplente' then
    perform set_config('np.adimplencia_silencio', '1', true);   -- o aviso sai daqui, não do gatilho do cliente
    update public.clientes set adimplencia_manual = null, adimplencia_manual_em = now(), adimplencia_manual_obs = 'Marcação "em dia" desfeita: nova parcela vencida no Asaas.' where id = c.id;
    perform set_config('np.adimplencia_silencio', '', true);
  end if;
  if antes is distinct from 'inadimplente' then
    perform public.inadimplencia_avisar_lider(c.id, 'Parcela vencida' || coalesce(' em ' || to_char(new.vencimento, 'DD/MM/YYYY'), '') || '.');
  end if;
  return null;
exception when others then return null;   -- aviso nunca impede a sincronização do Asaas
end $$;
drop trigger if exists cobranca_inadimplencia_trg on public.cobrancas;
create trigger cobranca_inadimplencia_trg after insert or update of status, cliente_id on public.cobrancas
  for each row execute procedure public.cobranca_inadimplencia_gatilho();

-- Financeiro informou (ou a marcação antiga "honorários em dia?" mudou)
create or replace function public.cliente_inadimplencia_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare antes text; depois text;
begin
  if new.adimplencia_manual is not distinct from old.adimplencia_manual and new.adimplente is not distinct from old.adimplente then return null; end if;
  if coalesce(current_setting('np.adimplencia_silencio', true), '') = '1' then return null; end if;
  antes := public.adimplencia_calc(old.id, old.adimplencia_manual, old.adimplente);
  depois := public.adimplencia_calc(new.id, new.adimplencia_manual, new.adimplente);
  if depois = 'inadimplente' and antes is distinct from 'inadimplente' then
    perform public.inadimplencia_avisar_lider(new.id, 'Informado pelo Financeiro.');
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists cliente_inadimplencia_trg on public.clientes;
create trigger cliente_inadimplencia_trg after update of adimplencia_manual, adimplente on public.clientes
  for each row execute procedure public.cliente_inadimplencia_gatilho();

-- o Financeiro informa: 'adimplente' (pagou no cartão ou à vista), 'inadimplente' ou 'automatico' (volta a valer o Asaas)
create or replace function public.cliente_adimplencia_informar(p_cliente text, p_situacao text, p_obs text default null) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_financeiro() then raise exception 'Só quem tem acesso ao Financeiro informa a adimplência.' using errcode = '42501'; end if;
  if p_situacao not in ('adimplente','inadimplente','automatico') then raise exception 'Situação inválida.'; end if;
  update public.clientes set adimplencia_manual = nullif(p_situacao, 'automatico'), adimplencia_manual_em = now(), adimplencia_manual_por = auth.uid(), adimplencia_manual_obs = nullif(trim(coalesce(p_obs,'')), '')
  where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  return (select public.adimplencia_calc(id, adimplencia_manual, adimplente) from public.clientes where id = p_cliente);
end $$;
revoke all on function public.cliente_adimplencia_informar(text, text, text) from public, anon;
grant execute on function public.cliente_adimplencia_informar(text, text, text) to authenticated;

-- nomes de marcação da equipe (usados nos avisos de B e nas menções de C)
create or replace function public.mencoes_base() returns table (perfil_id uuid, nome text, marca text)
language sql stable security definer set search_path = public as $$
  with base as (
    select pf.id, coalesce(nullif(co.nome, ''), nullif(pf.nome, ''), pf.email) as nome
    from public.perfis pf
    left join lateral (select c.nome from public.colaboradores c where c.perfil_id = pf.id and c.ativo is distinct from false order by c.nome limit 1) co on true
    where pf.papel in ('admin','colaborador')
  ), n as (
    select id, nome, split_part(nome, ' ', 1) as p1, nullif(split_part(nome, ' ', 2), '') as p2 from base
    where nome is not null and public.sem_acento(nome) !~ '^(teste|robo)' and nome !~ '@'
  )
  select n.id, n.nome,
         case when (select count(*) from n x where public.sem_acento(x.p1) = public.sem_acento(n.p1)) > 1 and n.p2 is not null then n.p1 || ' ' || n.p2 else n.p1 end
  from n order by n.nome
$$;
revoke all on function public.mencoes_base() from public, anon, authenticated;

-- =====================================================================================================
-- B) CONTEÚDO PARA APROVAÇÃO: sino + Discord
-- =====================================================================================================
-- aprovadoras (perfis) em escritorio('marketing_aprovacao').aprovadores; canal em escritorio('discord').canal_aprovacao
insert into public.escritorio (id, dados)
select 'marketing_aprovacao', jsonb_build_object('aprovadores', coalesce((select jsonb_agg(id order by nome) from public.perfis where papel = 'admin' and public.sem_acento(nome) ~ '^(ana julia|maria julia)'), '[]'::jsonb))
on conflict (id) do nothing;

create or replace function public.pauta_aprovacao_avisar() returns trigger
language plpgsql security definer set search_path = public as $$
declare quem text; ap uuid; canal text; painel text; anexos text; quando text; msg text;
begin
  if new.status <> 'em_aprovacao' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'em_aprovacao' then return null; end if;
  quem := coalesce((select b.marca from public.mencoes_base() b where b.perfil_id = auth.uid()), 'Equipe');
  quando := case when new.data_prevista is not null then ' · previsto para ' || to_char(new.data_prevista, 'DD/MM') else '' end;
  for ap in select (jsonb_array_elements_text(coalesce(dados->'aprovadores', '[]'::jsonb)))::uuid from public.escritorio where id = 'marketing_aprovacao' loop
    insert into public.notificacoes (perfil_id, titulo, texto, link)
    values (ap, 'Conteúdo para aprovação: ' || left(new.titulo, 80), quem || ' enviou para aprovação' || quando || '.', '#marketing');
  end loop;
  select nullif(dados->>'canal_aprovacao', '') into canal from public.escritorio where id = 'discord';
  if canal is not null then
    painel := public.painel_url();
    anexos := substring(coalesce(new.descricao, '') from 'Anexos no cartão de produção: ([^\n]+)');
    msg := '🗂️ **Novo conteúdo para aprovação**' || E'\n' || '**' || left(new.titulo, 200) || '**' || ' · ' || new.formato || quando || E'\n' || 'Enviado por ' || quem
        || case when nullif(new.link_criativo, '') is not null then E'\n' || 'Criativo: ' || new.link_criativo else '' end
        || case when anexos is not null then E'\n' || 'Anexos no cartão: ' || left(anexos, 600) else '' end
        || E'\n' || 'Abrir a pauta: ' || coalesce(painel, '') || '/#marketing';
    insert into public.discord_fila (canal_discord, texto, referencia) values (canal, msg, 'pauta:' || new.id::text);
  end if;
  return null;
exception when others then return null;   -- aviso nunca impede o envio para a pauta
end $$;
drop trigger if exists pauta_aprovacao_avisar_trg on public.pautas;
create trigger pauta_aprovacao_avisar_trg after insert or update of status on public.pautas
  for each row execute procedure public.pauta_aprovacao_avisar();

-- =====================================================================================================
-- C) @MENÇÕES em comentários e descrições
-- =====================================================================================================
-- Como marcar: "@Natasha" quando o primeiro nome é único na equipe; "@Maria Júlia" (dois nomes) quando há mais de uma pessoa
-- com o mesmo primeiro nome. O apelido também vale quando é único. Sem acento e sem diferenciar maiúsculas.
-- lista para o autocompletar da tela (só equipe)
create or replace function public.mencoes_pessoas() returns table (perfil_id uuid, nome text, marca text)
language sql stable security definer set search_path = public as $$
  select b.perfil_id, b.nome, b.marca from public.mencoes_base() b where public.sou_equipe()
$$;
revoke all on function public.mencoes_pessoas() from public, anon;
grant execute on function public.mencoes_pessoas() to authenticated;

create or replace function public.mencoes_avisar(p_novo text, p_antigo text, p_onde text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare autor uuid := auth.uid(); quem text; p record; t text; a text; padrao text;
begin
  if p_novo is null or position('@' in p_novo) = 0 then return; end if;
  t := public.sem_acento(p_novo); a := public.sem_acento(coalesce(p_antigo, ''));
  quem := coalesce((select b.marca from public.mencoes_base() b where b.perfil_id = autor), 'Alguém');
  for p in select b.perfil_id as id, b.marca from public.mencoes_base() b loop
    if p.id is not distinct from autor then continue; end if;
    padrao := '@' || regexp_replace(regexp_replace(public.sem_acento(p.marca), '[^a-z0-9 ]', '', 'g'), ' +', '\\s+', 'g') || '\M';
    if t ~ padrao and a !~ padrao then
      insert into public.notificacoes (perfil_id, titulo, texto, link)
      values (p.id, quem || ' mencionou você ' || p_onde, left(regexp_replace(p_novo, '\s+', ' ', 'g'), 200), p_link);
    end if;
  end loop;
end $$;
revoke all on function public.mencoes_avisar(text, text, text, text) from public, anon, authenticated;

-- gatilho genérico. Argumentos: colunas de texto (separadas por vírgula), rótulo, modelo do link (com {coluna}), coluna do título (opcional)
create or replace function public.mencoes_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare cols text[] := string_to_array(tg_argv[0], ','); rotulo text := tg_argv[1]; link text := tg_argv[2]; col_titulo text := nullif(tg_argv[3], '');
        n jsonb; o jsonb; c text; k text; onde text;
begin
  n := to_jsonb(new); o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  for k in select distinct x[1] from regexp_matches(link, '\{([a-z_]+)\}', 'g') x loop link := replace(link, '{' || k || '}', coalesce(n->>k, '')); end loop;
  onde := rotulo || case when col_titulo is not null and nullif(n->>col_titulo, '') is not null then ' “' || left(n->>col_titulo, 70) || '”' else '' end;
  foreach c in array cols loop
    if n->>c is null or position('@' in n->>c) = 0 or (n->>c) is not distinct from (o->>c) then continue; end if;
    perform public.mencoes_avisar(n->>c, o->>c, onde, link);
  end loop;
  return null;
exception when others then return null;   -- menção nunca impede a gravação
end $$;

-- liga o gatilho em cada tabela que existe, só com as colunas que existem
do $$
declare r record; achadas text; tit text;
begin
  for r in select * from (values
    ('tarefas',                   'descricao',                         'na tarefa',                       '#tarefas/{id}',           'titulo'),
    ('tarefa_eventos',            'nota',                              'em um andamento de tarefa',         '#tarefas/{tarefa_id}',    ''),
    ('mkt_producao',              'descricao',                         'no cartão de conteúdo',           '#mkt-producao',           'titulo'),
    ('mkt_producao_comentarios',  'texto',                             'em um comentário de conteúdo',      '#mkt-producao',           ''),
    ('pautas',                    'descricao,legenda',                 'na pauta',                        '#marketing',              'titulo'),
    ('pautas_comentarios',        'texto',                             'em um comentário da pauta',         '#marketing',              ''),
    ('entradas_timeline',         'descricao,texto',                   'no dossiê de um cliente',         '#clientes/{cliente_id}',  ''),
    ('notas_internas',            'texto',                             'em uma nota interna de cliente',    '#clientes/{cliente_id}',  ''),
    ('observacoes',               'texto',                             'em uma observação',                 '#clientes/{cliente_id}',  ''),
    ('providencias',              'observacao,observacoes,descricao',  'na providência',                  '#clientes/{cliente_id}',  'titulo'),
    ('atas_reuniao',              'resumo',                            'na ata de reunião',               '#clientes/{cliente_id}',  'titulo'),
    ('cliente_medidas',           'descricao,observacao,observacoes',  'em uma medida de cliente',          '#clientes/{cliente_id}',  ''),
    ('processos',                 'observacoes',                       'no processo',                    '#processos',              'numero_cnj'),
    ('publicacoes',               'observacao,observacoes,nota',       'em uma publicação',                 '#publicacoes',            ''),
    ('agenda_eventos',            'descricao,observacoes',             'no compromisso',                  '#agenda',                 'titulo'),
    ('requisicoes',               'detalhe,resposta',                  'em uma requisição',                 '#perfil',                 ''),
    ('marketing_pedidos',         'texto,resposta',                    'em um pedido ao marketing',         '#marketing',              ''),
    ('avisos',                    'texto',                             'no aviso',                        '#avisos/{id}',            'titulo'),
    ('negociacoes',               'observacoes,descricao',             'em uma negociação',                 '#clientes/{cliente_id}',  ''),
    ('acordos',                   'observacoes',                       'em um acordo',                      '#clientes/{cliente_id}',  ''),
    ('pdi_registros',             'texto,descricao',                   'em um registro de PDI',             '#perfil',                 '')
  ) as t(tabela, colunas, rotulo, link, titulo) loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = r.tabela) then continue; end if;
    select string_agg(column_name, ',' order by column_name) into achadas from information_schema.columns
      where table_schema = 'public' and table_name = r.tabela and data_type = 'text' and column_name = any(string_to_array(r.colunas, ','));
    if achadas is null then continue; end if;
    tit := case when r.titulo <> '' and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tabela and column_name = r.titulo) then r.titulo else '' end;
    execute format('drop trigger if exists np_mencoes on public.%I', r.tabela);
    execute format('create trigger np_mencoes after insert or update on public.%I for each row execute procedure public.mencoes_gatilho(%L, %L, %L, %L)', r.tabela, achadas, r.rotulo, r.link, tit);
  end loop;
end $$;

-- as tarefas já tinham @menção nos andamentos (0046) com a regra antiga (só o primeiro nome, que marcava todas as "Marias").
-- O gatilho genérico acima assume o lugar, para não avisar em dobro.
drop trigger if exists tarefa_mencoes_trg on public.tarefa_eventos;

select 'ok 0130' as resultado;

-- -----------------------------------------------------------------------------------------------------
-- PARA DESFAZER
-- drop trigger if exists cobranca_inadimplencia_trg on public.cobrancas;
-- drop trigger if exists cliente_inadimplencia_trg on public.clientes;
-- drop trigger if exists pauta_aprovacao_avisar_trg on public.pautas;
-- do $$ declare r record; begin for r in select event_object_table t from information_schema.triggers where trigger_schema='public' and trigger_name='np_mencoes' group by 1 loop execute format('drop trigger np_mencoes on public.%I', r.t); end loop; end $$;
-- create trigger tarefa_mencoes_trg after insert on public.tarefa_eventos for each row execute procedure public.tarefa_mencoes();
-- revoke execute on function public.clientes_adimplencia() from authenticated;
-- (as colunas adimplencia_manual* e as linhas 'carteira' e 'marketing_aprovacao' de public.escritorio podem ficar: sem os gatilhos, nada as usa)
