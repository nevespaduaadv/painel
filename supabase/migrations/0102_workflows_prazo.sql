-- 0102 — Prazos fracionados (reunião com Isadora, 06/11): todo prazo processual vira uma cadeia de tarefas abertas de uma vez
-- ao tratar a publicação: Confeccionar (D-5 / D-3 nos prazos de 5 dias) → Protocolar (meta interna D-2; o prazo legal fica
-- registrado como fatal) → Conferir protocolo (D-1, controladoria). Custas (D-3) em apelação e agravo.
-- Idempotente.
create table if not exists public.workflows_prazo (
  codigo text primary key,
  nome text not null,
  dias_legais int not null,
  tipo_contagem text not null default 'uteis' check (tipo_contagem in ('uteis','corridos')),
  dias_internos int not null,               -- prazo interno para confeccionar (10 quando legal = 15; 3 quando legal = 5)
  confeccionar_offset int not null default -5, -- dias úteis antes do prazo legal
  protocolar_offset int not null default -2,
  conferir_offset int not null default -1,
  custas boolean not null default false,
  decisao_inicial text,                      -- título da etapa "analisar" que, ao concluir, pergunta fazer/não fazer (ex.: ED, apelação)
  ordem int not null default 100,
  ativo boolean not null default true,
  updated_at timestamptz default now()
);
alter table public.workflows_prazo enable row level security;
drop policy if exists workflows_prazo_sel on public.workflows_prazo;
create policy workflows_prazo_sel on public.workflows_prazo for select to authenticated using (public.sou_equipe());
drop policy if exists workflows_prazo_adm on public.workflows_prazo;
create policy workflows_prazo_adm on public.workflows_prazo for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

insert into public.workflows_prazo (codigo, nome, dias_legais, dias_internos, confeccionar_offset, custas, decisao_inicial, ordem) values
 ('ed',                 'Embargos de declaração',        5, 3, -3, false, 'Analisar cabimento de embargos de declaração', 10),
 ('apelacao',           'Apelação',                     15, 10, -5, true,  'Analisar cabimento de apelação', 20),
 ('contrarrazoes',      'Contrarrazões',                15, 10, -5, false, null, 30),
 ('contestacao',        'Contestação',                  15, 10, -5, false, null, 40),
 ('embargos_execucao',  'Embargos à execução',          15, 10, -5, false, null, 50),
 ('embargos_monitoria', 'Embargos monitórios',          15, 10, -5, false, null, 60),
 ('agravo',             'Agravo de instrumento',        15, 10, -5, true,  'Analisar cabimento de agravo', 70),
 ('manifestacao',       'Manifestação (15 dias)',       15, 10, -5, false, null, 80),
 ('manifestacao_5',     'Manifestação (5 dias)',         5, 3, -3, false, null, 90),
 ('cumprimento',        'Cumprimento de sentença / impugnação', 15, 10, -5, false, null, 100),
 ('replica',            'Réplica',                      15, 10, -5, false, null, 110),
 ('outro',              'Outro prazo processual',       15, 10, -5, false, null, 999)
on conflict (codigo) do nothing;

alter table public.tarefas add column if not exists cadeia_id uuid;
alter table public.tarefas add column if not exists etapa_codigo text;     -- analisar | custas | confeccionar | protocolar | conferir
alter table public.tarefas add column if not exists workflow_codigo text;
create index if not exists tarefas_cadeia_idx on public.tarefas (cadeia_id) where cadeia_id is not null;

-- Quem confere protocolos (controladoria). Fica em escritorio('juridico').dados.conferencia_protocolo_id; o painel usa como padrão.
insert into public.escritorio (id, dados) values ('juridico', '{}'::jsonb) on conflict (id) do nothing;
update public.escritorio e
   set dados = coalesce(e.dados, '{}'::jsonb) || jsonb_build_object('conferencia_protocolo_id', c.id)
  from (select id from public.colaboradores where ativo and lower(public.unaccent(nome)) like 'maria eul%' order by data_admissao nulls last limit 1) c
 where e.id = 'juridico' and (e.dados->>'conferencia_protocolo_id') is null;

-- v_tarefas passa a expor a cadeia (acrescenta colunas no fim, preservando as atuais)
do $$
declare def text;
begin
  select pg_get_viewdef('public.v_tarefas'::regclass, true) into def;
  if def is null then return; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='v_tarefas' and column_name='cadeia_id') then return; end if;
  execute 'create or replace view public.v_tarefas as select x.*, t.cadeia_id, t.etapa_codigo, t.workflow_codigo from (' || rtrim(def, E'; \n') || ') x join public.tarefas t on t.id = x.id';
exception when others then raise notice 'v_tarefas não recriada: %', sqlerrm;
end $$;
select 'ok 0102' as resultado, (select count(*) from public.workflows_prazo) as workflows,
       (select dados->>'conferencia_protocolo_id' from public.escritorio where id='juridico') as confere_protocolo;
