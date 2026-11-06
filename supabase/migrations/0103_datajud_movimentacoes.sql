-- 0103 — Movimentações processuais pelo DataJud (API pública do CNJ), sem robô e sem certificado.
-- Mesmo padrão do DJEN (0014): pg_net faz a requisição; um processador lê a resposta e grava em public.andamentos (fonte 'datajud').
--  • cobre todos os tribunais pelo número CNJ (alias deduzido do próprio número: J.TR → tjsp, trf3, trt15, stj, tre-sp…)
--  • cada processo ativo é consultado no máximo 1× por dia (lotes de 40 por hora para não estourar a cota pública)
--  • andamento novo: entra em andamentos (visível ao cliente só se a regra mandar), atualiza vara/classe/assunto vazios do processo
--    e avisa o responsável no sino quando houver movimento novo
-- Chave pública do CNJ fica em regras('datajud').dados.chave (o CNJ pode trocar; basta editar a regra).
-- Idempotente.

alter table public.processos add column if not exists datajud_atualizado_em timestamptz;   -- dataHoraUltimaAtualizacao no DataJud
alter table public.processos add column if not exists datajud_consulta_em timestamptz;     -- última consulta feita
alter table public.processos add column if not exists datajud_erro text;
alter table public.processos add column if not exists datajud_grau text;

create table if not exists public.datajud_requisicoes (
  id bigserial primary key,
  processo_id uuid not null references public.processos (id) on delete cascade,
  alias text not null,
  request_id bigint,
  status text not null default 'pendente',   -- pendente | ok | vazio | erro
  novos integer default 0,
  erro text,
  created_at timestamptz not null default now(),
  processado_em timestamptz
);
create index if not exists datajud_req_status_idx on public.datajud_requisicoes (status) where status = 'pendente';
alter table public.datajud_requisicoes enable row level security;
drop policy if exists dj_sel on public.datajud_requisicoes;
create policy dj_sel on public.datajud_requisicoes for select to authenticated using (public.sou_equipe());

insert into public.regras (id, dados) values ('datajud', jsonb_build_object(
  'chave', 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==',
  'lote_por_hora', 20, 'horas_entre_consultas', 20, 'visivel_cliente', false, 'avisar_responsavel', true))
on conflict (id) do nothing;
update public.regras set dados = dados || '{"lote_por_hora": 20}'::jsonb where id = 'datajud' and (dados->>'lote_por_hora')::int > 20;

-- alias do índice a partir do número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
create or replace function public.datajud_alias(p_numero text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p_numero,''), '[^0-9]', '', 'g'); j text; tr text; uf text;
begin
  if length(d) <> 20 then return null; end if;
  j := substr(d, 14, 1); tr := substr(d, 15, 2);
  uf := case tr when '01' then 'ac' when '02' then 'al' when '03' then 'ap' when '04' then 'am' when '05' then 'ba' when '06' then 'ce' when '07' then 'df' when '08' then 'es'
                when '09' then 'go' when '10' then 'ma' when '11' then 'mt' when '12' then 'ms' when '13' then 'mg' when '14' then 'pa' when '15' then 'pb' when '16' then 'pr'
                when '17' then 'pe' when '18' then 'pi' when '19' then 'rj' when '20' then 'rn' when '21' then 'rs' when '22' then 'ro' when '23' then 'rr' when '24' then 'sc'
                when '25' then 'se' when '26' then 'sp' when '27' then 'to' end;
  return case j
    when '1' then 'stf' when '3' then 'stj'
    when '4' then 'trf' || (tr::int)::text
    when '5' then case when tr = '00' then 'tst' else 'trt' || (tr::int)::text end
    when '6' then case when tr = '00' then 'tse' else 'tre-' || uf end
    when '7' then 'stm'
    when '8' then case when uf is null then null else 'tj' || uf end
    when '9' then case when uf is null then null else 'tjm' || uf end
    else null end;
end $$;

-- datas do DataJud vêm como ISO ("2026-07-24T09:08:26.000Z") ou como 14 dígitos ("20260724090826"), conforme o tribunal
create or replace function public.datajud_ts(p text) returns timestamptz language plpgsql immutable as $$
begin
  if p is null or p = '' then return null; end if;
  if p ~ '^\d{14}$' then return (to_timestamp(p, 'YYYYMMDDHH24MISS') at time zone 'UTC') at time zone 'America/Sao_Paulo'; end if;
  if p ~ '^\d{8}$' then return to_date(p, 'YYYYMMDD')::timestamptz; end if;
  return p::timestamptz;
exception when others then return null;
end $$;

-- dispara as consultas (lote por hora; cada processo no máximo 1× a cada N horas)
create or replace function public.datajud_solicitar() returns integer
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; r record; rid bigint; n integer := 0; lote integer; horas integer; al text;
begin
  select dados into cfg from public.regras where id = 'datajud';
  if cfg is null or coalesce(cfg->>'chave','') = '' then return 0; end if;
  lote := coalesce((cfg->>'lote_por_hora')::int, 20); horas := coalesce((cfg->>'horas_entre_consultas')::int, 20);
  for r in
    select p.id, p.numero_cnj from public.processos p
     where p.status = 'ativo' and public.datajud_alias(p.numero_cnj) is not null
       and (p.datajud_consulta_em is null or p.datajud_consulta_em < now() - make_interval(hours => horas))
       and not exists (select 1 from public.datajud_requisicoes q where q.processo_id = p.id and q.status = 'pendente' and q.created_at > now() - interval '2 hours')
     order by p.datajud_consulta_em nulls first, p.proximo_prazo nulls last
     limit lote
  loop
    al := public.datajud_alias(r.numero_cnj);
    select net.http_post(
      url := 'https://api-publica.datajud.cnj.jus.br/api_publica_' || al || '/_search',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'APIKey ' || (cfg->>'chave'), 'User-Agent', 'NevesPadua-Carteira/1.0'),
      body := jsonb_build_object('size', 1, 'query', jsonb_build_object('match', jsonb_build_object('numeroProcesso', regexp_replace(r.numero_cnj, '[^0-9]', '', 'g')))),
      timeout_milliseconds := 60000) into rid;
    insert into public.datajud_requisicoes (processo_id, alias, request_id) values (r.id, al, rid);
    update public.processos set datajud_consulta_em = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.datajud_solicitar() from public, anon, authenticated;

-- lê as respostas e grava os andamentos
create or replace function public.datajud_processar() returns integer
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; r record; resp record; corpo jsonb; src jsonb; mv jsonb; n integer := 0; v_novos integer; total integer; vis boolean; avisar boolean;
        d_mov date; txt text; comp text; ult timestamptz; p public.processos; resp_colab uuid; prim text;
begin
  select dados into cfg from public.regras where id = 'datajud';
  vis := coalesce((cfg->>'visivel_cliente')::boolean, false); avisar := coalesce((cfg->>'avisar_responsavel')::boolean, true);
  for r in select * from public.datajud_requisicoes where status = 'pendente' and request_id is not null order by id limit 200 loop
    select * into resp from net._http_response where id = r.request_id;
    if not found then
      if r.created_at < now() - interval '2 hours' then update public.datajud_requisicoes set status = 'erro', erro = 'sem resposta', processado_em = now() where id = r.id; end if;
      continue;
    end if;
    if resp.status_code is distinct from 200 or resp.content is null then
      update public.datajud_requisicoes set status = 'erro', erro = coalesce(resp.error_msg, 'HTTP '||coalesce(resp.status_code::text,'?'))||' '||left(coalesce(resp.content,''),200), processado_em = now() where id = r.id;
      update public.processos set datajud_erro = left(coalesce(resp.error_msg, 'HTTP '||coalesce(resp.status_code::text,'?')), 200),
             datajud_consulta_em = case when resp.status_code is null or resp.status_code in (408, 429, 500, 502, 503, 504) then now() - interval '18 hours' else datajud_consulta_em end  -- sobrecarga/timeout: tenta de novo em ~2h
       where id = r.processo_id;
      continue;
    end if;
    begin corpo := resp.content::jsonb; exception when others then
      update public.datajud_requisicoes set status = 'erro', erro = 'resposta inválida', processado_em = now() where id = r.id; continue; end;
    total := coalesce((corpo->'hits'->'total'->>'value')::int, jsonb_array_length(coalesce(corpo->'hits'->'hits','[]'::jsonb)));
    if total = 0 or jsonb_array_length(coalesce(corpo->'hits'->'hits','[]'::jsonb)) = 0 then
      update public.datajud_requisicoes set status = 'vazio', processado_em = now() where id = r.id;
      update public.processos set datajud_erro = 'não encontrado no DataJud (' || r.alias || ')', datajud_consulta_em = now() + interval '6 days' where id = r.processo_id;  -- tenta de novo em 7 dias
      continue;
    end if;
    src := corpo->'hits'->'hits'->0->'_source';
    select * into p from public.processos where id = r.processo_id;
    v_novos := 0;
    for mv in select * from jsonb_array_elements(coalesce(src->'movimentos','[]'::jsonb)) loop
      d_mov := (public.datajud_ts(mv->>'dataHora') at time zone 'America/Sao_Paulo')::date;
      if d_mov is null then continue; end if;
      select string_agg(coalesce(c->>'descricao', c->>'nome') || ': ' || coalesce(c->>'valor', c->>'nome', ''), '; ' order by c->>'codigo') into comp
        from jsonb_array_elements(coalesce(mv->'complementosTabelados','[]'::jsonb)) c;
      txt := coalesce(mv->>'nome', 'Movimento ' || coalesce(mv->>'codigo','')) || coalesce(' (' || comp || ')', '');
      if mv->'orgaoJulgador'->>'nomeOrgao' is not null and (mv->'orgaoJulgador'->>'nomeOrgao') <> coalesce(src->'orgaoJulgador'->>'nome','') then txt := txt || ' — ' || (mv->'orgaoJulgador'->>'nomeOrgao'); end if;
      insert into public.andamentos (processo_id, data, tipo, descricao, visivel_cliente, fonte, id_externo)
      values (p.id, d_mov, 'movimentacao', txt, vis, 'datajud', (mv->>'codigo') || '@' || (mv->>'dataHora'))
      on conflict (processo_id, data, md5(descricao)) where (fonte <> 'manual') do nothing;
      if found then v_novos := v_novos + 1; prim := coalesce(prim, to_char(d_mov,'DD/MM/YYYY') || ' — ' || txt); end if;
    end loop;
    ult := public.datajud_ts(src->>'dataHoraUltimaAtualizacao');
    update public.processos set
      datajud_atualizado_em = coalesce(ult, datajud_atualizado_em), datajud_erro = null, datajud_grau = coalesce(src->>'grau', datajud_grau), datajud_consulta_em = now(),
      vara = coalesce(nullif(vara,''), src->'orgaoJulgador'->>'nome'),
      tipo_acao = coalesce(nullif(tipo_acao,''), src->'classe'->>'nome'),
      assunto = coalesce(nullif(assunto,''), src->'assuntos'->0->>'nome'),
      tribunal = coalesce(nullif(tribunal,''), src->>'tribunal'),
      data_distribuicao = coalesce(data_distribuicao, (public.datajud_ts(src->>'dataAjuizamento') at time zone 'America/Sao_Paulo')::date)
     where id = p.id;
    update public.datajud_requisicoes set status = 'ok', novos = v_novos, processado_em = now() where id = r.id;
    if v_novos > 0 and avisar and p.responsavel_id is not null and p.datajud_atualizado_em is not null then  -- na 1ª carga (histórico) não avisa
      perform public.notificar_colaborador(p.responsavel_id, 'Movimentação nova — ' || coalesce(p.numero_cnj, 'processo'),
        v_novos || ' andamento(s) novo(s) no DataJud. Mais recente: ' || left(coalesce(prim,''), 200), '#processos/' || p.id::text);
    end if;
    n := n + 1; prim := null;
  end loop;
  return n;
end $$;
revoke all on function public.datajud_processar() from public, anon, authenticated;

-- botão "Atualizar agora" (equipe): dispara um lote e processa o que já respondeu
create or replace function public.datajud_atualizar(p_processo uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer; cfg jsonb; al text; rid bigint; num text;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_processo is not null then
    select dados into cfg from public.regras where id = 'datajud';
    select numero_cnj into num from public.processos where id = p_processo; al := public.datajud_alias(num);
    if al is null then raise exception 'Número CNJ inválido para consulta no DataJud.'; end if;
    select net.http_post(url := 'https://api-publica.datajud.cnj.jus.br/api_publica_' || al || '/_search',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','APIKey ' || (cfg->>'chave'),'User-Agent','NevesPadua-Carteira/1.0'),
      body := jsonb_build_object('size',1,'query',jsonb_build_object('match',jsonb_build_object('numeroProcesso', regexp_replace(num,'[^0-9]','','g')))), timeout_milliseconds := 60000) into rid;
    insert into public.datajud_requisicoes (processo_id, alias, request_id) values (p_processo, al, rid);
    update public.processos set datajud_consulta_em = now() where id = p_processo; n := 1;
  else
    n := public.datajud_solicitar();
  end if;
  m := public.datajud_processar();
  return jsonb_build_object('solicitadas', n, 'processadas', m);
end $$;
grant execute on function public.datajud_atualizar(uuid) to authenticated;

-- v_processos passa a expor os campos do DataJud (acrescenta no fim, preservando as colunas atuais)
do $$
declare def text;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='v_processos' and column_name='datajud_erro') then return; end if;
  select pg_get_viewdef('public.v_processos'::regclass, true) into def;
  execute 'create or replace view public.v_processos as select x.*, p.datajud_atualizado_em, p.datajud_consulta_em, p.datajud_erro, p.datajud_grau from (' || rtrim(def, E'; \n') || ') x join public.processos p on p.id = x.id';
exception when others then raise notice 'v_processos não recriada: %', sqlerrm;
end $$;

-- agenda: consultas a cada 30 min (7h–19h BRT, dias úteis), em lotes pequenos para não tomar 429 e processamento a cada 5 min
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('datajud_solicitar','datajud_processar');
  perform cron.schedule('datajud_solicitar', '15,45 10-22 * * 1-5', $c$select public.datajud_solicitar()$c$);
  perform cron.schedule('datajud_processar', '*/5 * * * *', $c$select public.datajud_processar()$c$);
exception when others then raise notice 'cron indisponível: %', sqlerrm;
end $$;

select 'ok 0103' as resultado, (select count(*) from public.processos where status = 'ativo' and public.datajud_alias(numero_cnj) is not null) as processos_consultaveis,
       (select count(*) from public.processos where status = 'ativo' and public.datajud_alias(numero_cnj) is null) as sem_numero_valido;
