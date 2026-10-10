-- 0031 — PR 16: calculadora revisional de contratos PJ (Jurídico).
-- Séries do BACEN (SGS) com a taxa média mensal por modalidade, cache das taxas, catálogo de teses revisionais
-- e as revisões feitas por contrato (entradas + resultado calculado + status de cada tese). Idempotente. Depende de 0001/0006.

-- ---------- séries do SGS (taxa média mensal, % a.m., pessoas jurídicas) ----------
create table if not exists public.bacen_series (
  codigo integer primary key,
  nome text not null,
  grupo text not null default 'pj_livre',      -- pj_livre | pj_direcionado | referencia
  unidade text not null default '% a.m.',
  inicio date,
  ativo boolean not null default true
);
alter table public.bacen_series enable row level security;
drop policy if exists "bacen_series: ver" on public.bacen_series;
create policy "bacen_series: ver" on public.bacen_series for select to authenticated using (public.sou_equipe());
drop policy if exists "bacen_series: admin" on public.bacen_series;
create policy "bacen_series: admin" on public.bacen_series for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.bacen_series from anon;
insert into public.bacen_series (codigo, nome, grupo, unidade, inicio) values
  (25437, 'PJ — recursos livres — total', 'pj_livre', '% a.m.', '2011-03-01'),
  (25438, 'PJ — Desconto de duplicatas e recebíveis', 'pj_livre', '% a.m.', '2011-03-01'),
  (25439, 'PJ — Desconto de cheques', 'pj_livre', '% a.m.', '2011-03-01'),
  (25440, 'PJ — Antecipação de faturas de cartão de crédito', 'pj_livre', '% a.m.', '2011-03-01'),
  (25441, 'PJ — Capital de giro com prazo de até 365 dias', 'pj_livre', '% a.m.', '2011-03-01'),
  (25442, 'PJ — Capital de giro com prazo superior a 365 dias', 'pj_livre', '% a.m.', '2011-03-01'),
  (25443, 'PJ — Capital de giro rotativo', 'pj_livre', '% a.m.', '2011-03-01'),
  (25444, 'PJ — Capital de giro total', 'pj_livre', '% a.m.', '2011-03-01'),
  (25445, 'PJ — Conta garantida', 'pj_livre', '% a.m.', '2011-03-01'),
  (25446, 'PJ — Cheque especial', 'pj_livre', '% a.m.', '2011-03-01'),
  (25447, 'PJ — Aquisição de veículos', 'pj_livre', '% a.m.', '2011-03-01'),
  (25448, 'PJ — Aquisição de outros bens', 'pj_livre', '% a.m.', '2011-03-01'),
  (25450, 'PJ — Arrendamento mercantil de veículos', 'pj_livre', '% a.m.', '2011-03-01'),
  (25451, 'PJ — Arrendamento mercantil de outros bens', 'pj_livre', '% a.m.', '2011-03-01'),
  (25453, 'PJ — Vendor', 'pj_livre', '% a.m.', '2011-03-01'),
  (25454, 'PJ — Compror', 'pj_livre', '% a.m.', '2011-03-01'),
  (25455, 'PJ — Cartão de crédito rotativo', 'pj_livre', '% a.m.', '2011-03-01'),
  (25456, 'PJ — Cartão de crédito parcelado', 'pj_livre', '% a.m.', '2011-03-01'),
  (25458, 'PJ — Adiantamento sobre contratos de câmbio (ACC)', 'pj_livre', '% a.m.', '2011-03-01'),
  (25483, 'PJ — Crédito rural com taxas de mercado (direcionado)', 'pj_direcionado', '% a.m.', '2011-03-01'),
  (25484, 'PJ — Crédito rural com taxas reguladas (direcionado)', 'pj_direcionado', '% a.m.', '2011-03-01'),
  (25486, 'PJ — Financiamento imobiliário com taxas de mercado (direcionado)', 'pj_direcionado', '% a.m.', '2011-03-01'),
  (25489, 'PJ — Capital de giro com recursos do BNDES (direcionado)', 'pj_direcionado', '% a.m.', '2011-03-01'),
  (29978, 'PJ — Programas de fomento a micro, pequenas e médias empresas (direcionado)', 'pj_direcionado', '% a.m.', '2011-03-01'),
  (432,   'Meta Selic (Copom) — referência para tetos regulados (Pronampe)', 'referencia', '% a.a.', '1996-06-01')
on conflict (codigo) do update set nome = excluded.nome, grupo = excluded.grupo, unidade = excluded.unidade, inicio = excluded.inicio;

-- ---------- cache das taxas (preenchido pela tela a partir da API pública do BACEN) ----------
create table if not exists public.bacen_taxas (
  serie integer not null references public.bacen_series (codigo) on delete cascade,
  mes date not null,                               -- 1º dia do mês (série 432: data da leitura)
  valor numeric(10,4) not null,
  importado_em timestamptz not null default now(),
  primary key (serie, mes)
);
alter table public.bacen_taxas enable row level security;
drop policy if exists "bacen_taxas: equipe" on public.bacen_taxas;
create policy "bacen_taxas: equipe" on public.bacen_taxas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.bacen_taxas from anon;

-- ---------- catálogo de teses revisionais ----------
create table if not exists public.teses_revisionais (
  codigo text primary key,
  nome text not null,
  grupo text not null check (grupo in ('encargos','tarifas','mora','processual')),
  verificacao text not null check (verificacao in ('auto','manual','auto_manual')),
  fundamento text,                                 -- lei / súmula / tema citável
  descricao text,                                  -- o que verificar / como a calculadora decide
  acolhimento text check (acolhimento in ('alto','medio_alto','medio','em_queda','informativo')),
  alerta text,                                     -- ressalva (ex.: Tema 1.378, CDC x PJ)
  ordem integer not null default 100,
  ativo boolean not null default true
);
alter table public.teses_revisionais enable row level security;
drop policy if exists "teses: ver" on public.teses_revisionais;
create policy "teses: ver" on public.teses_revisionais for select to authenticated using (public.sou_equipe());
drop policy if exists "teses: admin" on public.teses_revisionais;
create policy "teses: admin" on public.teses_revisionais for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.teses_revisionais from anon;
insert into public.teses_revisionais (codigo, nome, grupo, verificacao, fundamento, descricao, acolhimento, alerta, ordem) values
  ('juros_media', 'Juros remuneratórios acima da taxa média de mercado', 'encargos', 'auto',
   'Tema 27/STJ (REsp 1.061.530/RS); Súmulas 382 e 596/STJ; art. 51, IV, CDC; arts. 421 e 422 CC',
   'A calculadora compara a taxa contratada com a taxa média mensal do BACEN (SGS) da modalidade no mês da contratação. Até 1,2× = dentro da média; 1,2×–1,5× = indício; ≥ 1,5× = indício forte.',
   'em_queda', 'Tema 1.378/STJ (afetado em set/2025, pendente): a 2ª Seção vai decidir se a taxa média basta, sozinha, para caracterizar abusividade. Nunca use esta tese isolada; combine com teses formais e de tarifas. Para PJ, o CDC só se aplica com vulnerabilidade demonstrada (finalismo mitigado).', 10),
  ('capitalizacao', 'Capitalização de juros sem pactuação expressa (teste do duodécuplo)', 'encargos', 'auto_manual',
   'MP 2.170-36/2001, art. 5º; Súmulas 539 e 541/STJ; Tema 246/STJ (Price não é, por si, anatocismo)',
   'Auto: compara a taxa anual do contrato com 12× a mensal (proporcional) e com (1+i)^12−1 (equivalente). Anual acima do duodécuplo presume pactuação (Súm. 541); anual igual ao duodécuplo ou ausente = sem presunção, verificar cláusula. Manual: existe cláusula expressa de capitalização mensal/diária?',
   'alto', 'Capitalização diária sem taxa diária informada vem sendo tratada como nula. Quantificar o efeito exige perícia sobre a evolução do saldo.', 20),
  ('taxa_divergente', 'Taxa efetivamente aplicada diverge da contratada', 'encargos', 'auto',
   'Art. 6º, III, e art. 46 CDC; arts. 113 e 422 CC; Res. CMN 4.881/2020 (CET)',
   'Auto: a partir do valor liberado, do prazo e da parcela informada, calcula a taxa implícita (TIR) e compara com a mensal do contrato. Divergência acima de 0,05 p.p. para cima é indício de cobrança diversa (base para exibição de extratos e perícia).',
   'medio', null, 30),
  ('cet', 'Custo Efetivo Total ausente ou divergente', 'encargos', 'auto_manual',
   'Res. CMN 4.881/2020 (antes 3.517/2007); art. 52 CDC',
   'Auto: CET informado abaixo da taxa contratada ou ausente. A obrigação regulatória do CET alcança PF e ME/EPP; para PJ de maior porte, verificar o enquadramento antes de arguir.',
   'medio', 'Confirmar o porte da empresa (ME/EPP) antes de usar.', 40),
  ('mora_juros', 'Juros de mora acima de 1% ao mês', 'mora', 'auto',
   'Art. 406 CC c/c art. 161, §1º, CTN; Súmula 379/STJ; Tema 28/STJ',
   'Auto: juros moratórios contratados superiores a 1% a.m.',
   'alto', null, 50),
  ('mora_multa', 'Multa moratória acima de 2%', 'mora', 'auto',
   'Art. 52, §1º, CDC (quando aplicável); arts. 412 e 413 CC (redução equitativa)',
   'Auto: multa moratória contratada superior a 2%. Em contrato PJ sem CDC, o pedido é de redução equitativa (art. 413 CC).',
   'alto', 'Para PJ sem relação de consumo, fundamentar pela cláusula penal excessiva (art. 413 CC).', 60),
  ('comissao_permanencia', 'Comissão de permanência cumulada com outros encargos', 'mora', 'auto',
   'Súmulas 30, 294, 296 e 472/STJ; Tema 52/STJ; Res. CMN 4.558/2017 (vedou a comissão de permanência em novos contratos)',
   'Auto: contrato prevê comissão de permanência e, cumulativamente, juros remuneratórios/moratórios, multa ou correção no inadimplemento. Em contratos posteriores a set/2017 a própria cobrança é irregular.',
   'alto', null, 70),
  ('descaracterizacao_mora', 'Descaracterização da mora', 'mora', 'auto',
   'Tema 972/STJ (REsp 1.061.530/RS, item 3); Súmula 380/STJ (ajuizamento, por si, não afasta a mora)',
   'Auto: deriva das demais — constatada abusividade nos encargos do período de normalidade (juros ou capitalização), afasta-se a mora e seus efeitos (inscrição em cadastros, vencimento antecipado, busca e apreensão).',
   'medio_alto', 'Depende da prova dos encargos da normalidade; não decorre de tarifas isoladas.', 80),
  ('tac_tec', 'Tarifa de abertura de crédito (TAC) / emissão de boleto (TEC)', 'tarifas', 'auto',
   'Temas 618 a 620/STJ (REsp 1.251.331/RS); Res. CMN 3.518/2007 e 3.919/2010',
   'Auto: TAC ou TEC cobradas em contrato celebrado após 30/04/2008 são indevidas.',
   'alto', null, 90),
  ('tarifa_cadastro', 'Tarifa de cadastro fora do início do relacionamento', 'tarifas', 'auto_manual',
   'Súmula 566/STJ; Tema 618/STJ',
   'Só é devida uma vez, no início do relacionamento com a instituição. Manual: o cliente já tinha conta/relacionamento anterior com o banco?',
   'medio', null, 100),
  ('tarifa_avaliacao_registro', 'Tarifa de avaliação do bem / registro do contrato sem serviço prestado', 'tarifas', 'auto_manual',
   'Tema 958/STJ (REsp 1.578.553/SP)',
   'Válidas somente se o serviço foi efetivamente prestado e o valor não é abusivo. Manual: há laudo de avaliação / comprovante de registro?',
   'medio_alto', null, 110),
  ('seguro_prestamista', 'Seguro prestamista imposto (venda casada)', 'tarifas', 'auto_manual',
   'Tema 972/STJ (REsp 1.639.259/SP); art. 39, I, CDC; Res. CNSP 365/2018',
   'Venda casada quando o tomador não pôde escolher a seguradora ou recusar o seguro. Manual: houve opção de escolha/recusa documentada?',
   'medio_alto', null, 120),
  ('iof_financiado', 'IOF financiado no contrato', 'tarifas', 'auto',
   'Tema 621/STJ (REsp 1.251.331/RS)',
   'Informativo: o financiamento do IOF é lícito; a calculadora apenas confere se o valor cobrado é compatível com a alíquota (0,38% + 0,0041%/dia, limitado a 365 dias, para PJ) e se foi incluído na base de juros com transparência.',
   'informativo', null, 130),
  ('vicio_ccb', 'Vícios formais do título (CCB) e da planilha de débito', 'processual', 'manual',
   'Art. 28 da Lei 10.931/2004; art. 784, III, CPC; art. 798, I, b, CPC',
   'Verificar: assinaturas e testemunhas quando exigíveis; planilha de evolução do débito clara e individualizada; divergência entre valor original e executado; cédula com campos em branco.',
   'alto', 'Ataca o título antes do mérito — maior índice de acolhimento sem perícia.', 140),
  ('liquidez', 'Ausência de liquidez e certeza do título', 'processual', 'manual',
   'Arts. 783 e 803, I, CPC',
   'Verificar: contrato de abertura de crédito/conta corrente sem demonstrativo (Súmula 233/STJ); saldo apurado unilateralmente sem extratos desde a origem.',
   'alto', null, 150),
  ('prescricao', 'Prescrição (do crédito ou intercorrente)', 'processual', 'manual',
   'Art. 206, §5º, I, CC; art. 921, §§4º e 5º, CPC; Lei 14.195/2021; Súmula 150/STF',
   'Verificar: data do vencimento/inadimplemento × ajuizamento (5 anos); execução suspensa por falta de bens com prazo transcorrido; citação válida.',
   'alto', null, 160),
  ('vencimento_antecipado', 'Vencimento antecipado irregular e juros sobre parcelas vincendas', 'processual', 'manual',
   'Art. 397 CC; art. 1.425 CC; Súmula 369/STJ (notificação); REsp 1.061.530 (juros vincendos)',
   'Verificar: houve notificação/constituição em mora antes da declaração de vencimento antecipado? O saldo executado inclui juros remuneratórios das parcelas vincendas?',
   'medio_alto', null, 170),
  ('compensacao_indevida', 'Compensação/débito indevido em conta (PF para dívida de PJ)', 'processual', 'manual',
   'Arts. 368 e 380 CC; art. 833, IV e X, CPC; Res. CMN 4.790/2020',
   'Verificar: débitos em conta do sócio/avalista para amortizar dívida da PJ sem autorização específica; débito sobre salário/limite.',
   'medio', null, 180),
  ('aval_fianca', 'Aval/fiança: limites, outorga e benefício de ordem', 'processual', 'manual',
   'Arts. 1.647, III, e 827 CC; Súmula 332/STJ; art. 835 CC',
   'Verificar: outorga conjugal na fiança; fiança prorrogada sem anuência; limite de valor; exoneração.',
   'medio', null, 190)
on conflict (codigo) do update set nome = excluded.nome, grupo = excluded.grupo, verificacao = excluded.verificacao, fundamento = excluded.fundamento,
  descricao = excluded.descricao, acolhimento = excluded.acolhimento, alerta = excluded.alerta, ordem = excluded.ordem;

-- ---------- revisões por contrato ----------
create table if not exists public.revisoes (
  id bigserial primary key,
  contrato_id text not null references public.contratos (id) on delete cascade,
  cliente_id text not null references public.clientes (id) on delete cascade,
  titulo text,
  entradas jsonb not null default '{}'::jsonb,    -- o que o advogado informou (taxas, prazo, tarifas, mora…)
  resultado jsonb not null default '{}'::jsonb,   -- o que a calculadora apurou (série, média, razão, parcelas, diferenças)
  status text not null default 'rascunho' check (status in ('rascunho','concluida')),
  observacoes text,
  criado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists revisoes_contrato_idx on public.revisoes (contrato_id);
create index if not exists revisoes_cliente_idx on public.revisoes (cliente_id);
alter table public.revisoes enable row level security;
drop policy if exists "revisoes: equipe" on public.revisoes;
create policy "revisoes: equipe" on public.revisoes for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.revisoes from anon;

create table if not exists public.revisao_teses (
  revisao_id bigint not null references public.revisoes (id) on delete cascade,
  tese text not null references public.teses_revisionais (codigo) on delete cascade,
  status text not null default 'verificar' check (status in ('constatada','indicio','nao_aplica','verificar')),
  automatico boolean not null default false,       -- status definido pela calculadora (true) ou pelo advogado (false)
  valor_impacto numeric(14,2),
  nota text,
  primary key (revisao_id, tese)
);
alter table public.revisao_teses enable row level security;
drop policy if exists "revisao_teses: equipe" on public.revisao_teses;
create policy "revisao_teses: equipe" on public.revisao_teses for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.revisao_teses from anon;

create or replace function public.revisoes_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists revisoes_touch on public.revisoes;
create trigger revisoes_touch before update on public.revisoes for each row execute function public.revisoes_touch();

drop view if exists public.v_revisoes;
create view public.v_revisoes with (security_invoker = true) as
select r.*, c.dados->>'nome' as cliente_nome, k.dados->>'banco' as banco, k.dados->>'produto' as produto,
       coalesce(p.nome, p.email) as criado_por_nome,
       (select count(*) from public.revisao_teses t where t.revisao_id = r.id and t.status = 'constatada') as constatadas,
       (select count(*) from public.revisao_teses t where t.revisao_id = r.id and t.status = 'indicio') as indicios
from public.revisoes r join public.clientes c on c.id = r.cliente_id join public.contratos k on k.id = r.contrato_id
left join public.perfis p on p.id = r.criado_por;
revoke all on public.v_revisoes from anon;

select 'ok 0031' as resultado;
