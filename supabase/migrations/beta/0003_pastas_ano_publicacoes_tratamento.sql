-- ESPELHO (beta) — Bloco 1 (ajuste): numeração da pasta por ano (2026-0001). Bloco 2: tratamento das publicações com
-- histórico e tempestividade, e card de publicações por processo. Idempotente. Depende de beta/0002.

-- ---------- pasta: código por ano ----------
alter table public.pastas add column if not exists ano integer, add column if not exists seq integer, add column if not exists codigo text;
create unique index if not exists pastas_codigo_idx on public.pastas (codigo);
create or replace function public.pastas_codigo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is null then
    new.ano := extract(year from coalesce(new.aberta_em, current_date))::integer;
    select coalesce(max(seq), 0) + 1 into new.seq from public.pastas where ano = new.ano;
    new.codigo := new.ano || '-' || lpad(new.seq::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists pastas_codigo on public.pastas;
create trigger pastas_codigo before insert on public.pastas for each row execute function public.pastas_codigo();
-- pastas já existentes: numera por ano de abertura, na ordem de criação
do $$ declare r record; a integer; n integer;
begin
  for r in select numero, aberta_em from public.pastas where codigo is null order by aberta_em, numero loop
    a := extract(year from r.aberta_em)::integer;
    select coalesce(max(seq), 0) + 1 into n from public.pastas where ano = a;
    update public.pastas set ano = a, seq = n, codigo = a || '-' || lpad(n::text, 4, '0') where numero = r.numero;
  end loop;
end $$;

-- ---------- configuração da controladoria ----------
create table if not exists public.controladoria_config (chave text primary key, valor text not null, descricao text);
insert into public.controladoria_config (chave, valor, descricao) values
  ('publicacao_prazo_dias_uteis', '1', 'Dias úteis após a disponibilização para a publicação ser tratada (tempestividade)')
on conflict (chave) do nothing;
alter table public.controladoria_config enable row level security;
drop policy if exists ccfg_sel on public.controladoria_config; create policy ccfg_sel on public.controladoria_config for select to authenticated using (public.sou_equipe());
drop policy if exists ccfg_adm on public.controladoria_config; create policy ccfg_adm on public.controladoria_config for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update on public.controladoria_config to authenticated;

-- ---------- publicações: tratamento ----------
alter table public.publicacoes
  add column if not exists providencia text check (providencia is null or providencia in ('gerou_prazo','nada_a_fazer','duplicidade','encaminhada','ciencia')),
  add column if not exists tratada_em timestamptz,
  add column if not exists tratada_por uuid references public.perfis (id) on delete set null,
  add column if not exists encaminhada_para uuid references public.colaboradores (id) on delete set null,
  add column if not exists observacao_tratamento text,
  add column if not exists prazo_tratamento date;
create index if not exists publicacoes_pend_idx on public.publicacoes (providencia) where providencia is null;

create table if not exists public.publicacao_historico (
  id bigserial primary key,
  publicacao_id bigint not null references public.publicacoes (id) on delete cascade,
  acao text not null,
  detalhe jsonb not null default '{}',
  por uuid references public.perfis (id) on delete set null,
  por_nome text,
  em timestamptz not null default now()
);
create index if not exists publicacao_historico_idx on public.publicacao_historico (publicacao_id, em);
alter table public.publicacao_historico enable row level security;
drop policy if exists ph_sel on public.publicacao_historico; create policy ph_sel on public.publicacao_historico for select to authenticated using (public.sou_equipe());
grant select on public.publicacao_historico to authenticated;

-- prazo de tratamento = N dias úteis após a disponibilização (09h não importa: compara datas)
create or replace function public.publicacao_prazo_tratamento(d date) returns date
language sql stable set search_path = public as $$
  select (public.cadencia_somar_dias_uteis(d::timestamp at time zone 'America/Sao_Paulo', coalesce((select valor::integer from public.controladoria_config where chave = 'publicacao_prazo_dias_uteis'), 1)) at time zone 'America/Sao_Paulo')::date;
$$;
update public.publicacoes set prazo_tratamento = public.publicacao_prazo_tratamento(data_disponibilizacao) where prazo_tratamento is null and data_disponibilizacao is not null;

-- histórico automático das mudanças relevantes
create or replace function public.publicacoes_historico_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text := public.nome_perfil(auth.uid());
begin
  if tg_op = 'INSERT' then
    new.prazo_tratamento := coalesce(new.prazo_tratamento, public.publicacao_prazo_tratamento(new.data_disponibilizacao));
    return new;
  end if;
  if new.processo_id is distinct from old.processo_id then insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.id, case when new.processo_id is null then 'desvinculada' else 'vinculada' end, jsonb_build_object('processo_id', new.processo_id), auth.uid(), nome); end if;
  if new.lida and not old.lida then insert into public.publicacao_historico (publicacao_id, acao, por, por_nome) values (new.id, 'lida', auth.uid(), nome); end if;
  if new.ignorada and not old.ignorada then insert into public.publicacao_historico (publicacao_id, acao, por, por_nome) values (new.id, 'ignorada', auth.uid(), nome); end if;
  if new.providencia is distinct from old.providencia and new.providencia is not null then
    insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.id, 'tratada', jsonb_build_object('providencia', new.providencia, 'observacao', new.observacao_tratamento, 'encaminhada_para', new.encaminhada_para), coalesce(new.tratada_por, auth.uid()), nome);
  end if;
  return new;
end $$;
drop trigger if exists publicacoes_historico on public.publicacoes;
create trigger publicacoes_historico before insert or update on public.publicacoes for each row execute function public.publicacoes_historico_tg();
create or replace function public.publicacoes_captada_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.id, 'captada', jsonb_build_object('tribunal', new.tribunal, 'processo', new.numero_processo), null, 'DJEN');
  return new;
end $$;
drop trigger if exists publicacoes_captada on public.publicacoes;
create trigger publicacoes_captada after insert on public.publicacoes for each row execute function public.publicacoes_captada_tg();

-- tarefa criada a partir da publicação = providência "gerou prazo" (quando ainda não tratada)
create or replace function public.tarefas_publicacao_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.publicacao_id is not null then
    update public.publicacoes set providencia = coalesce(providencia, 'gerou_prazo'), tratada_em = coalesce(tratada_em, now()), tratada_por = coalesce(tratada_por, auth.uid()), lida = true
     where id = new.publicacao_id;
    insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (new.publicacao_id, 'tarefa_criada', jsonb_build_object('tarefa_id', new.id, 'titulo', new.titulo, 'prazo', new.prazo, 'responsavel_id', new.responsavel_id), auth.uid(), public.nome_perfil(auth.uid()));
  end if;
  return new;
end $$;
drop trigger if exists tarefas_publicacao on public.tarefas;
create trigger tarefas_publicacao after insert on public.tarefas for each row execute function public.tarefas_publicacao_tg();

-- tratar: providência + observação (+ encaminhar para alguém, com aviso)
create or replace function public.publicacao_tratar(p_id bigint, p_providencia text, p_obs text default null, p_encaminhar uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare perfil_dest uuid; pub public.publicacoes;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  select * into pub from public.publicacoes where id = p_id;
  if pub.id is null then raise exception 'Publicação não encontrada.'; end if;
  update public.publicacoes set providencia = p_providencia, observacao_tratamento = p_obs, encaminhada_para = p_encaminhar,
         tratada_em = now(), tratada_por = auth.uid(), lida = true, ignorada = (p_providencia = 'duplicidade'), updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  if p_encaminhar is not null then
    select perfil_id into perfil_dest from public.colaboradores where id = p_encaminhar;
    perform public.notificar(perfil_dest, 'Publicação encaminhada para você', coalesce(pub.numero_processo, 'sem número') || ' · ' || coalesce(left(p_obs, 120), 'ver publicação'), '#publicacoes/' || p_id);
  end if;
end $$;
grant execute on function public.publicacao_tratar(bigint, text, text, uuid) to authenticated;

-- reabrir tratamento (volta a pendente)
create or replace function public.publicacao_reabrir(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  update public.publicacoes set providencia = null, tratada_em = null, tratada_por = null, encaminhada_para = null, ignorada = false, updated_at = now() where id = p_id;
  insert into public.publicacao_historico (publicacao_id, acao, por, por_nome) values (p_id, 'reaberta', auth.uid(), public.nome_perfil(auth.uid()));
end $$;
grant execute on function public.publicacao_reabrir(bigint) to authenticated;

-- ---------- views ----------
create or replace view public.v_publicacoes with (security_invoker = true) as
select p.id, p.data_disponibilizacao, p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe, p.numero_processo, p.meio, p.link, p.lida, p.ignorada,
       left(p.texto, 400) as resumo, p.texto, p.destinatarios, p.advogados,
       p.processo_id, p.cliente_id, c.dados->>'nome' as cliente_nome, pr.tipo_acao, pr.responsavel_id, co.nome as responsavel_nome,
       p.tarefa_id, t.status as tarefa_status, t.prazo as tarefa_prazo,
       (p.processo_id is null and not p.ignorada) as sem_vinculo, p.created_at,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id) as tarefas_atribuidas,
       (select count(*) from public.tarefas x where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as tarefas_atribuidas_abertas,
       (select string_agg(coalesce(cc.nome,'?') || coalesce(' · ' || to_char(x.prazo,'DD/MM'), ''), ', ' order by x.prazo) from public.tarefas x left join public.colaboradores cc on cc.id = x.responsavel_id where x.publicacao_id = p.id and x.status in ('aberta','em_andamento')) as atribuidas_para,
       -- beta 0003
       p.providencia, p.tratada_em, public.nome_perfil(p.tratada_por) as tratada_por_nome, p.encaminhada_para, ce.nome as encaminhada_para_nome, p.observacao_tratamento,
       p.prazo_tratamento,
       case when p.providencia is null then null else (p.tratada_em at time zone 'America/Sao_Paulo')::date <= p.prazo_tratamento end as tempestiva,
       case when p.providencia is null then p.prazo_tratamento - current_date end as dias_para_tratar,
       pr.pasta_numero, pa.codigo as pasta_codigo
from public.publicacoes p
left join public.processos pr on pr.id = p.processo_id
left join public.pastas pa on pa.numero = pr.pasta_numero
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = pr.responsavel_id
left join public.colaboradores ce on ce.id = p.encaminhada_para
left join public.tarefas t on t.id = p.tarefa_id;
grant select on public.v_publicacoes to authenticated;

-- relatório de tempestividade por mês e por quem tratou
create or replace view public.v_publicacoes_tempestividade with (security_invoker = true) as
select to_char(p.data_disponibilizacao, 'YYYY-MM') as mes, coalesce(public.nome_perfil(p.tratada_por), '(pendente)') as tratada_por_nome,
       count(*) as publicacoes,
       count(*) filter (where p.providencia is not null) as tratadas,
       count(*) filter (where p.providencia is not null and (p.tratada_em at time zone 'America/Sao_Paulo')::date <= p.prazo_tratamento) as tempestivas,
       count(*) filter (where p.providencia is null and p.prazo_tratamento < current_date) as pendentes_vencidas,
       count(*) filter (where p.providencia = 'gerou_prazo') as gerou_prazo,
       count(*) filter (where p.providencia = 'nada_a_fazer') as nada_a_fazer,
       count(*) filter (where p.providencia = 'duplicidade') as duplicidade,
       count(*) filter (where p.providencia = 'encaminhada') as encaminhadas,
       round(avg(extract(epoch from (p.tratada_em - (p.data_disponibilizacao::timestamp at time zone 'America/Sao_Paulo'))) / 86400) filter (where p.providencia is not null), 1) as media_dias_para_tratar
  from public.publicacoes p
 group by 1, 2;
grant select on public.v_publicacoes_tempestividade to authenticated;

-- v_processos / v_pastas: código da pasta
create or replace view public.v_pastas with (security_invoker = true) as
select pa.numero, pa.titulo, pa.cliente_id, pa.status, pa.aberta_em, pa.encerrada_em, pa.tipo_encerramento, pa.caixa_arquivo, pa.observacoes, pa.created_by, pa.created_at, pa.updated_at,
       c.nome as cliente_nome,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero) as qtd_processos,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero and p.status = 'ativo') as qtd_ativos,
       (select string_agg(coalesce(p.numero_cnj, p.tipo_acao), ' · ' order by p.created_at) from public.processos p where p.pasta_numero = pa.numero) as processos_txt,
       pa.ano, pa.seq, pa.codigo
  from public.pastas pa left join public.clientes c on c.id = pa.cliente_id;
grant select on public.v_pastas to authenticated;

create or replace view public.v_processos with (security_invoker = true) as
select p.id, p.cliente_id, p.contrato_id, p.numero_cnj, p.tribunal, p.vara, p.tipo_acao, p.parte_contraria, p.banco, p.polo, p.fase, p.valor_causa,
       p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.status, p.visivel_cliente, p.fonte, p.id_externo, p.observacoes, p.created_at, p.created_by, p.updated_at, p.updated_by,
       c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (p.proximo_prazo - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia,
       p.pasta_numero, p.area, p.comarca, p.uf, p.rito, p.assunto, p.data_distribuicao, p.sub_status, p.encerrado_em, p.tipo_encerramento,
       p.relevante, p.sigiloso, p.grau_risco, p.risco_cliente, p.advogado_contrario,
       pa.titulo as pasta_titulo, pa.status as pasta_status,
       public.processo_campos_faltando(p) as campos_faltando,
       (select count(*) from public.processo_relacoes r where r.processo_id = p.id or r.relacionado_id = p.id) as qtd_relacionados,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id) as qtd_publicacoes,
       pa.codigo as pasta_codigo,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id and pb.providencia is null) as publicacoes_pendentes
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id
left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_processos to authenticated;

create or replace view public.v_processo_relacoes with (security_invoker = true) as
select r.id, r.processo_id, r.relacionado_id, r.tipo, r.observacao, r.created_at, 'derivado' as sentido,
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara, pa.codigo as pasta_codigo
  from public.processo_relacoes r join public.processos x on x.id = r.relacionado_id left join public.pastas pa on pa.numero = x.pasta_numero
union all
select r.id, r.relacionado_id, r.processo_id, r.tipo, r.observacao, r.created_at, 'originario',
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara, pa.codigo
  from public.processo_relacoes r join public.processos x on x.id = r.processo_id left join public.pastas pa on pa.numero = x.pasta_numero;
grant select on public.v_processo_relacoes to authenticated;

select 'ok beta 0003' as resultado, (select count(*) from public.pastas where codigo is not null) as pastas_com_codigo, (select count(*) from public.publicacoes where providencia is null) as publicacoes_pendentes;
