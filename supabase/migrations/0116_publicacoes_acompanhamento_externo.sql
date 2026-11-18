-- 0116 · Publicações acompanhadas em outro sistema ("Acompanhamento externo — ADVBox")
--
-- Decisão das sócias (17/11/2026): as publicações anteriores a 16/11/2026 estão sendo acompanhadas no ADVBox. Elas saem da fila
-- "A analisar" do sistema próprio com uma classificação própria, em lote, com prévia, auditoria e reversão.
--
-- O que a classificação É: um registro de que o acompanhamento daquela publicação acontece fora deste sistema.
-- O que NÃO É: providência jurídica (o campo "providencia" não é tocado), leitura ("lida" não é tocado), "ignorada", homônimo
-- nem irrelevante. Texto, datas, tribunal, número do processo, vínculos com processo e cliente, fontes e histórico ficam como
-- estão. A publicação continua podendo ser vinculada a um processo e pode voltar à análise a qualquer momento.
--
-- Regras:
--   * só a administradora classifica, reverte o lote ou devolve uma publicação à análise; fundamento obrigatório;
--   * entra no lote só o que está pendente (sem providência, não ignorada, ainda sem classificação) e é ANTERIOR à data de corte;
--   * por padrão, publicação que já tem tarefa de análise neste sistema NÃO entra (ela já está sob controle aqui);
--     a administradora pode incluí-las de propósito — nesse caso elas deixam de travar a conclusão da tarefa (0115);
--   * cada lote guarda quantidade, data de corte, fundamento, quem e quando; cada publicação guarda o lote e ganha uma linha
--     no próprio histórico; a reversão desfaz exatamente o lote e também fica registrada;
--   * não cria tarefa, não altera tarefa, não cria agendamento, não faz chamada externa.
-- Depende da 0115 (redefine as duas funções de pendência para desconsiderar a publicação acompanhada externamente).
alter table public.publicacoes add column if not exists acompanhamento_externo text check (acompanhamento_externo in ('advbox'));
alter table public.publicacoes add column if not exists acompanhamento_externo_lote uuid;
alter table public.publicacoes add column if not exists acompanhamento_externo_em timestamptz;
create index if not exists publicacoes_acomp_ext_idx on public.publicacoes (acompanhamento_externo_lote) where acompanhamento_externo is not null;

create table if not exists public.publicacao_lotes_externos (
  id uuid primary key default gen_random_uuid(),
  sistema text not null check (sistema in ('advbox')),
  corte date not null,                                  -- entram as publicações disponibilizadas ANTES desta data
  incluiu_com_tarefa boolean not null default false,
  fundamento text not null check (length(btrim(fundamento)) >= 10),
  quantidade integer not null,
  criado_em timestamptz not null default now(), criado_por uuid references public.perfis (id) on delete set null, criado_por_nome text,
  revertido_em timestamptz, revertido_por uuid references public.perfis (id) on delete set null, revertido_motivo text, revertidas integer
);
alter table public.publicacao_lotes_externos enable row level security;
drop policy if exists pub_lotes_ext_sel on public.publicacao_lotes_externos;
create policy pub_lotes_ext_sel on public.publicacao_lotes_externos for select to authenticated using (public.sou_equipe());

-- prévia: o que entraria no lote, sem alterar nada
create or replace function public.publicacoes_externo_previa(p_corte date, p_incluir_com_tarefa boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.sou_admin() then raise exception 'Só a administradora classifica publicações em lote.' using errcode = '42501'; end if;
  if p_corte is null then raise exception 'Informe a data de corte.' using errcode = '22023'; end if;
  with base as (select p.* from public.publicacoes p where p.providencia is null and not coalesce(p.ignorada, false) and p.acompanhamento_externo is null),
       lote as (select * from base where data_disponibilizacao::date < p_corte and (tarefa_id is null or p_incluir_com_tarefa))
  select jsonb_build_object('corte', p_corte, 'entram', (select count(*) from lote),
    'entram_sem_processo', (select count(*) from lote where processo_id is null), 'entram_com_processo', (select count(*) from lote where processo_id is not null),
    'entram_com_tarefa', (select count(*) from lote where tarefa_id is not null), 'processos_distintos', (select count(distinct numero_processo) from lote),
    'mais_antiga', (select min(data_disponibilizacao::date) from lote), 'mais_recente', (select max(data_disponibilizacao::date) from lote),
    'anteriores_ao_corte_que_ficam_por_terem_tarefa', (select count(*) from base where data_disponibilizacao::date < p_corte and tarefa_id is not null and not p_incluir_com_tarefa),
    'ficam_na_analise_a_partir_do_corte', (select count(*) from base where data_disponibilizacao::date >= p_corte)) into r;
  return r;
end $$;

create or replace function public.publicacoes_externo_classificar(p_corte date, p_fundamento text, p_incluir_com_tarefa boolean default false, p_esperado integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := gen_random_uuid(); n integer; v_nome text;
begin
  if not public.sou_admin() then raise exception 'Só a administradora classifica publicações em lote.' using errcode = '42501'; end if;
  if p_corte is null then raise exception 'Informe a data de corte.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_fundamento, ''))) < 10 then raise exception 'Informe o fundamento da classificação (pelo menos 10 caracteres).' using errcode = '22023'; end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  update public.publicacoes p set acompanhamento_externo = 'advbox', acompanhamento_externo_lote = v, acompanhamento_externo_em = now()
   where p.providencia is null and not coalesce(p.ignorada, false) and p.acompanhamento_externo is null
     and p.data_disponibilizacao::date < p_corte and (p.tarefa_id is null or p_incluir_com_tarefa);
  get diagnostics n = row_count;
  -- trava de segurança: a quantidade tem de ser a que a administradora viu na prévia
  if p_esperado is not null and n <> p_esperado then raise exception 'A quantidade mudou desde a prévia: seriam % publicações, e a prévia mostrava %. Nada foi alterado; refaça a prévia.', n, p_esperado using errcode = '40001'; end if;
  if n = 0 then raise exception 'Nenhuma publicação se enquadra. Nada foi alterado.' using errcode = 'P0002'; end if;
  insert into public.publicacao_lotes_externos (id, sistema, corte, incluiu_com_tarefa, fundamento, quantidade, criado_por, criado_por_nome) values (v, 'advbox', p_corte, coalesce(p_incluir_com_tarefa, false), btrim(p_fundamento), n, auth.uid(), v_nome);
  insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome)
    select id, 'acompanhamento_externo', jsonb_build_object('sistema', 'advbox', 'lote', v, 'corte', p_corte, 'fundamento', btrim(p_fundamento)), auth.uid(), v_nome from public.publicacoes where acompanhamento_externo_lote = v;
  insert into public.auditoria (usuario, tabela, registro, acao, antes, depois) values (auth.uid(), 'publicacao_lotes_externos', v::text, 'CLASSIFICACAO_EM_LOTE', null, jsonb_build_object('sistema', 'advbox', 'corte', p_corte, 'quantidade', n, 'incluiu_com_tarefa', coalesce(p_incluir_com_tarefa, false), 'fundamento', btrim(p_fundamento)));
  return jsonb_build_object('lote', v, 'quantidade', n);
end $$;

create or replace function public.publicacoes_externo_reverter(p_lote uuid, p_motivo text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; v_nome text;
begin
  if not public.sou_admin() then raise exception 'Só a administradora reverte a classificação em lote.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then raise exception 'Informe o motivo da reversão (pelo menos 10 caracteres).' using errcode = '22023'; end if;
  if not exists (select 1 from public.publicacao_lotes_externos where id = p_lote and revertido_em is null) then raise exception 'Lote não encontrado ou já revertido.' using errcode = 'P0002'; end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome)
    select id, 'acompanhamento_externo_revertido', jsonb_build_object('lote', p_lote, 'motivo', btrim(p_motivo)), auth.uid(), v_nome from public.publicacoes where acompanhamento_externo_lote = p_lote and acompanhamento_externo is not null;
  update public.publicacoes set acompanhamento_externo = null, acompanhamento_externo_em = null where acompanhamento_externo_lote = p_lote and acompanhamento_externo is not null;
  get diagnostics n = row_count;
  update public.publicacao_lotes_externos set revertido_em = now(), revertido_por = auth.uid(), revertido_motivo = btrim(p_motivo), revertidas = n where id = p_lote;
  insert into public.auditoria (usuario, tabela, registro, acao, antes, depois) values (auth.uid(), 'publicacao_lotes_externos', p_lote::text, 'REVERSAO_DE_LOTE', null, jsonb_build_object('revertidas', n, 'motivo', btrim(p_motivo)));
  return n;
end $$;

-- uma publicação volta à análise neste sistema (por exemplo, ao ser vinculada ao processo certo). Jurídico ou administradora.
create or replace function public.publicacao_externo_devolver(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.sou_admin() or (public.sou_equipe() and public.tem_acesso('juridico'))) then raise exception 'Sem permissão para devolver a publicação à análise.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.' using errcode = '22023'; end if;
  update public.publicacoes set acompanhamento_externo = null, acompanhamento_externo_em = null where id = p_id and acompanhamento_externo is not null;
  if not found then raise exception 'Publicação não encontrada ou não está em acompanhamento externo.' using errcode = 'P0002'; end if;
  insert into public.publicacao_historico (publicacao_id, acao, detalhe, por, por_nome) values (p_id, 'acompanhamento_externo_devolvida', jsonb_build_object('motivo', btrim(p_motivo)), auth.uid(), (select nome from public.perfis where id = auth.uid()));
end $$;
revoke all on function public.publicacoes_externo_previa(date, boolean), public.publicacoes_externo_classificar(date, text, boolean, integer), public.publicacoes_externo_reverter(uuid, text), public.publicacao_externo_devolver(bigint, text) from public, anon;
grant execute on function public.publicacoes_externo_previa(date, boolean), public.publicacoes_externo_classificar(date, text, boolean, integer), public.publicacoes_externo_reverter(uuid, text), public.publicacao_externo_devolver(bigint, text) to authenticated;

-- a pessoa não altera a classificação direto pela API (só pelas funções acima)
create or replace function public.publicacoes_acomp_externo_guarda_tg() returns trigger language plpgsql set search_path = public as $$
begin
  if (new.acompanhamento_externo is distinct from old.acompanhamento_externo or new.acompanhamento_externo_lote is distinct from old.acompanhamento_externo_lote or new.acompanhamento_externo_em is distinct from old.acompanhamento_externo_em)
     and current_user in ('authenticated', 'anon') then
    raise exception 'A classificação de acompanhamento externo só muda pelas funções próprias.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists publicacoes_acomp_externo_guarda on public.publicacoes;
create trigger publicacoes_acomp_externo_guarda before update on public.publicacoes for each row execute function public.publicacoes_acomp_externo_guarda_tg();

-- 0115: publicação acompanhada externamente não trava a tarefa de análise (só importa se a administradora incluiu as que têm tarefa)
create or replace function public.tarefa_publicacoes_pendentes(p_tarefa uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('publicacao_id', p.id, 'numero_processo', p.numero_processo, 'data', p.data_disponibilizacao, 'tipo', coalesce(p.tipo_documento, p.tipo_comunicacao), 'lida', p.lida) order by p.data_disponibilizacao, p.id), '[]'::jsonb)
    from public.publicacoes p where p.tarefa_id = p_tarefa and p.providencia is null and not coalesce(p.ignorada, false) and p.acompanhamento_externo is null and public.sou_equipe() $$;
create or replace function public.tarefa_pendencias_analise(p_tarefa uuid, out n integer, out quais text, out detalhe text) language sql stable security definer set search_path = public as $$
  select count(*)::integer,
         case when public.sou_equipe() or auth.uid() is null then string_agg(coalesce(p.numero_processo, 'sem número') || ' · ' || to_char(p.data_disponibilizacao, 'DD/MM') || coalesce(' · ' || coalesce(p.tipo_documento, p.tipo_comunicacao), ''), '; ' order by p.data_disponibilizacao, p.id) end,
         case when public.sou_equipe() or auth.uid() is null then coalesce(jsonb_agg(jsonb_build_object('publicacao_id', p.id, 'numero_processo', p.numero_processo, 'data', p.data_disponibilizacao, 'tipo', coalesce(p.tipo_documento, p.tipo_comunicacao)) order by p.data_disponibilizacao, p.id), '[]'::jsonb)::text end
    from public.publicacoes p where p.tarefa_id = p_tarefa and p.providencia is null and not coalesce(p.ignorada, false) and p.acompanhamento_externo is null $$;

select 'ok 0116' as resultado, (select count(*) from public.publicacoes where acompanhamento_externo is not null) as classificadas, (select count(*) from public.publicacao_lotes_externos) as lotes;

-- Reversão: drop trigger publicacoes_acomp_externo_guarda on public.publicacoes; drop function public.publicacoes_acomp_externo_guarda_tg(), public.publicacoes_externo_previa(date, boolean),
--   public.publicacoes_externo_classificar(date, text, boolean, integer), public.publicacoes_externo_reverter(uuid, text), public.publicacao_externo_devolver(bigint, text);
--   reexecutar as duas funções da 0115; drop table public.publicacao_lotes_externos; alter table public.publicacoes drop column acompanhamento_externo, drop column acompanhamento_externo_lote, drop column acompanhamento_externo_em;
