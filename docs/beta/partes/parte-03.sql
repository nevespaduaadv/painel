-- ESPELHO (beta) — parte 3 de 9: 0031_pr16_revisional.sql … 0032_pr17_pecas.sql

-- ===== 0031_pr16_revisional.sql =====
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
   'Auto: a partir do valor liberado, do prazo e da parcela informada, calcula a taxa implícita (TIR) e compara com a mensal do contrato. Divergência acima de 0,10 p.p. para cima é indício de cobrança diversa (entre 0,05 e 0,10 p.p. costuma ser contagem de dias do 1º período) (base para exibição de extratos e perícia).',
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


-- ===== 0032_pr17_pecas.sql =====
-- 0032 — PR 17: peças por blocos (petição inicial revisional, embargos à execução e parecer ao cliente) montadas
-- a partir da revisão do contrato. Modelos e blocos por tese são editáveis pelo admin no painel; a geração do .docx é
-- feita na tela. Os blocos abaixo são RASCUNHOS iniciais (rascunho = true) para serem substituídos pelos modelos do
-- escritório. Idempotente. Depende de 0031.

-- ---------- qualificação do cliente (campos que faltavam para a peça) ----------
alter table public.clientes
  add column if not exists endereco text,
  add column if not exists representante text,
  add column if not exists representante_cpf text,
  add column if not exists representante_qualificacao text;   -- "brasileiro, casado, empresário…"

-- ---------- dados do escritório usados nas peças ----------
create table if not exists public.escritorio (
  id text primary key default 'escritorio',
  dados jsonb not null default '{}'::jsonb,   -- nome, cnpj, endereco, cidade, uf, email, advogados: [{nome, oab}]
  updated_at timestamptz not null default now()
);
alter table public.escritorio enable row level security;
drop policy if exists "escritorio: ver" on public.escritorio;
create policy "escritorio: ver" on public.escritorio for select to authenticated using (public.sou_equipe());
drop policy if exists "escritorio: admin" on public.escritorio;
create policy "escritorio: admin" on public.escritorio for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.escritorio from anon;
insert into public.escritorio (id, dados) values ('escritorio', '{"nome":"Neves Pádua Sociedade Individual de Advocacia","cnpj":"61.958.184/0001-91","endereco":"Rua General Osório, nº 1850, Sala 15, Pavimento 1, Centro","cidade":"Franca","uf":"SP","cep":"14400-520","email":"contato@nevespaduaadvocacia.com.br","advogados":[{"nome":"Maria Júlia Neves de Pádua","oab":"OAB/SP 488.803"}]}'::jsonb)
on conflict (id) do nothing;

-- ---------- modelos de peça ----------
create table if not exists public.modelos_peca (
  id text primary key,                         -- inicial_revisional | embargos_execucao | parecer_cliente
  nome text not null,
  tipo text not null check (tipo in ('inicial','embargos','parecer')),
  descricao text,
  secoes jsonb not null default '[]'::jsonb,   -- [{chave, titulo, texto}] — texto com {{campos}} e marcadores {{BLOCOS:fatos|fundamentos|pedidos|provas|parecer}}
  ativo boolean not null default true,
  ordem integer not null default 100,
  updated_at timestamptz not null default now()
);
alter table public.modelos_peca enable row level security;
drop policy if exists "modelos: ver" on public.modelos_peca;
create policy "modelos: ver" on public.modelos_peca for select to authenticated using (public.sou_equipe());
drop policy if exists "modelos: admin" on public.modelos_peca;
create policy "modelos: admin" on public.modelos_peca for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.modelos_peca from anon;

-- ---------- blocos por tese ----------
create table if not exists public.blocos_tese (
  tese text not null references public.teses_revisionais (codigo) on delete cascade,
  peca text not null check (peca in ('inicial','embargos')),
  titulo text,                                 -- título do tópico de fundamentação
  fatos text,                                  -- parágrafo(s) para "Dos fatos"
  fundamentos text,                            -- fundamentação jurídica
  pedidos text,                                -- um pedido por linha
  provas text,                                 -- um item por linha
  parecer text,                                -- parágrafo em linguagem simples para o parecer ao cliente
  rascunho boolean not null default true,      -- true = texto inicial gerado, ainda não revisado pelo escritório
  updated_at timestamptz not null default now(),
  primary key (tese, peca)
);
alter table public.blocos_tese enable row level security;
drop policy if exists "blocos: ver" on public.blocos_tese;
create policy "blocos: ver" on public.blocos_tese for select to authenticated using (public.sou_equipe());
drop policy if exists "blocos: admin" on public.blocos_tese;
create policy "blocos: admin" on public.blocos_tese for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.blocos_tese from anon;

-- ---------- registro das peças geradas ----------
create table if not exists public.pecas_geradas (
  id bigserial primary key,
  revisao_id bigint references public.revisoes (id) on delete cascade,
  cliente_id text references public.clientes (id) on delete cascade,
  modelo_id text references public.modelos_peca (id) on delete set null,
  teses text[] not null default '{}',
  arquivo text,
  gerado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.pecas_geradas enable row level security;
drop policy if exists "pecas: equipe" on public.pecas_geradas;
create policy "pecas: equipe" on public.pecas_geradas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.pecas_geradas from anon;

-- ---------- seeds: modelos ----------
insert into public.modelos_peca (id, nome, tipo, descricao, ordem, secoes) values
('inicial_revisional', 'Ação revisional de contrato bancário (PJ)', 'inicial',
 'Petição inicial de ação revisional c/c repetição de indébito. Montada com os blocos das teses constatadas/indícios da revisão.', 10,
 $j$[
  {"chave":"enderecamento","titulo":"","texto":"EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DA ___ VARA CÍVEL DA COMARCA DE {{comarca}}"},
  {"chave":"qualificacao","titulo":"","texto":"{{cliente.nome}}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{cliente.cnpj}}, com sede em {{cliente.endereco}}, {{cliente.cidade}}/{{cliente.uf}}, neste ato representada por {{cliente.representante}}, {{cliente.representante_qualificacao}}, inscrito(a) no CPF sob o nº {{cliente.representante_cpf}}, por seus advogados que esta subscrevem (procuração anexa), com escritório em {{escritorio.endereco}}, {{escritorio.cidade}}/{{escritorio.uf}}, onde recebem intimações, vem, respeitosamente, à presença de Vossa Excelência, com fundamento nos arts. 319 e seguintes do Código de Processo Civil, propor a presente\n\nAÇÃO REVISIONAL DE CONTRATO BANCÁRIO C/C REPETIÇÃO DE INDÉBITO\n\nem face de {{banco}}, instituição financeira inscrita no CNPJ sob o nº «CNPJ do banco», com sede em «endereço do banco», pelos fatos e fundamentos a seguir expostos."},
  {"chave":"fatos","titulo":"I – DOS FATOS","texto":"A Autora celebrou com a Ré, em {{contrato.data}}, contrato de {{contrato.produto}} («nº do contrato»), no valor de {{contrato.valor}}, a ser pago em {{contrato.prazo}} parcelas mensais de {{contrato.parcela}}, com juros remuneratórios contratados de {{contrato.taxa_mensal}} ao mês ({{contrato.taxa_anual}} ao ano), sistema {{contrato.sistema}}, e Custo Efetivo Total de {{contrato.cet}} ao ano.\n\n{{BLOCOS:fatos}}\n\nDiante das irregularidades apuradas, não restou alternativa à Autora senão buscar a tutela jurisdicional para a revisão das cláusulas abusivas e a restituição do que foi cobrado a maior."},
  {"chave":"preliminares","titulo":"II – PRELIMINARMENTE","texto":"II.1 – Da aplicação das normas protetivas e da boa-fé objetiva\n\nAinda que se trate de pessoa jurídica, a Autora é {{cliente.porte}} e tomou o crédito como destinatária final para fazer frente às necessidades de capital de giro, em evidente posição de vulnerabilidade técnica e econômica perante a instituição financeira (teoria finalista mitigada — STJ, REsp 1.195.642/RJ). Aplicam-se, portanto, o Código de Defesa do Consumidor (Súmula 297/STJ) e, em qualquer hipótese, os deveres de boa-fé objetiva, função social do contrato e equilíbrio das prestações (arts. 421, 422 e 478 do Código Civil).\n\nII.2 – Da exibição de documentos\n\nRequer a Autora, com fundamento nos arts. 396 e seguintes do CPC, seja a Ré compelida a exibir o instrumento contratual integral, os extratos da conta vinculada desde a contratação e a planilha de evolução do saldo devedor, documentos comuns às partes e indispensáveis à perícia."},
  {"chave":"fundamentos","titulo":"III – DO DIREITO","texto":"{{BLOCOS:fundamentos}}"},
  {"chave":"tutela","titulo":"IV – DA TUTELA DE URGÊNCIA","texto":"Presentes a probabilidade do direito, demonstrada pelos cálculos que instruem a inicial, e o perigo de dano, consistente na continuidade dos descontos em conta e na iminente inscrição do nome da Autora em cadastros restritivos, requer-se, nos termos do art. 300 do CPC, a concessão de tutela de urgência para: (a) autorizar o depósito judicial das parcelas no valor incontroverso de {{calc.parcela_media}} (parcela recalculada pela taxa média de mercado); (b) determinar que a Ré se abstenha de inscrever ou mantenha excluído o nome da Autora dos cadastros de inadimplentes em relação ao contrato discutido; e (c) determinar que a Ré se abstenha de realizar débitos automáticos em conta além do valor incontroverso."},
  {"chave":"pedidos","titulo":"V – DOS PEDIDOS","texto":"Diante do exposto, requer:\n\na concessão da tutela de urgência, nos termos do item IV;\na citação da Ré para, querendo, contestar a presente ação, sob pena de revelia;\n{{BLOCOS:pedidos}}\na condenação da Ré à restituição dos valores cobrados a maior, apurados em liquidação por perícia contábil, com correção monetária desde cada desembolso e juros de mora desde a citação, em dobro quando demonstrada a má-fé (art. 42, parágrafo único, do CDC);\na produção de todos os meios de prova admitidos, em especial a prova pericial contábil e a exibição de documentos;\na condenação da Ré ao pagamento das custas processuais e dos honorários advocatícios;\n\nDá-se à causa o valor de {{valor_causa}}.\n\nNestes termos, pede deferimento.\n\n{{escritorio.cidade}}, {{hoje}}.\n\n{{advogado.nome}}\n{{advogado.oab}}"},
  {"chave":"provas","titulo":"ROL DE DOCUMENTOS","texto":"1. Procuração e atos constitutivos da Autora;\n2. Contrato / cédula de crédito bancário;\n3. Demonstrativo do Custo Efetivo Total;\n4. Extratos bancários;\n5. Relatório de revisão contratual com a taxa média do Banco Central (série {{bacen.serie}} — {{bacen.nome}}, {{bacen.mes}});\n{{BLOCOS:provas}}"}
 ]$j$::jsonb),
('embargos_execucao', 'Embargos à execução (título bancário)', 'embargos',
 'Embargos à execução de título extrajudicial (CCB). Prioriza teses formais e de encargos; usa os mesmos blocos por tese.', 20,
 $j$[
  {"chave":"enderecamento","titulo":"","texto":"EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DA ___ VARA CÍVEL DA COMARCA DE {{comarca}}\n\nAutos nº «número do processo»\nExecução de título extrajudicial"},
  {"chave":"qualificacao","titulo":"","texto":"{{cliente.nome}}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{cliente.cnpj}}, com sede em {{cliente.endereco}}, {{cliente.cidade}}/{{cliente.uf}}, já qualificada nos autos da execução que lhe move {{banco}}, vem, por seus advogados, com fundamento nos arts. 914 e seguintes do Código de Processo Civil, opor os presentes\n\nEMBARGOS À EXECUÇÃO\n\npelas razões de fato e de direito a seguir expostas."},
  {"chave":"tempestividade","titulo":"I – DA TEMPESTIVIDADE E DO EFEITO SUSPENSIVO","texto":"Os presentes embargos são tempestivos, pois opostos no prazo de 15 (quinze) dias contados da juntada do mandado de citação (art. 915 do CPC). Requer-se a atribuição de efeito suspensivo (art. 919, §1º, do CPC), uma vez que os fundamentos são relevantes e o prosseguimento da execução pode causar dano de difícil reparação, «indicar garantia do juízo ou justificar sua dispensa»."},
  {"chave":"fatos","titulo":"II – DOS FATOS","texto":"A Embargada executa a Embargante com base em {{contrato.produto}} celebrado em {{contrato.data}}, no valor original de {{contrato.valor}}, em {{contrato.prazo}} parcelas de {{contrato.parcela}}, com juros de {{contrato.taxa_mensal}} ao mês ({{contrato.taxa_anual}} ao ano), apontando saldo devedor de «valor executado».\n\n{{BLOCOS:fatos}}"},
  {"chave":"fundamentos","titulo":"III – DO DIREITO","texto":"{{BLOCOS:fundamentos}}"},
  {"chave":"excesso","titulo":"IV – DO EXCESSO DE EXECUÇÃO","texto":"Nos termos do art. 917, §§ 3º e 4º, do CPC, a Embargante declara que o valor que entende correto é de «valor que entende devido», conforme demonstrativo discriminado e atualizado que acompanha estes embargos, elaborado a partir do recálculo do contrato pela taxa média de mercado ({{bacen.media_mensal}} ao mês — série {{bacen.serie}} do Banco Central, {{bacen.mes}}) e com a exclusão dos encargos indevidos apontados acima. Só a diferença de juros remuneratórios em relação à média de mercado alcança {{calc.dif_media}}."},
  {"chave":"pedidos","titulo":"V – DOS PEDIDOS","texto":"Diante do exposto, requer:\n\no recebimento dos embargos com efeito suspensivo;\na intimação da Embargada para impugnação;\n{{BLOCOS:pedidos}}\no acolhimento dos embargos para reconhecer o excesso de execução, reduzindo o débito ao valor apurado em perícia contábil, ou, subsidiariamente, a extinção da execução pela iliquidez do título;\na produção de prova pericial contábil e a exibição dos extratos e da planilha de evolução do débito;\na condenação da Embargada em custas e honorários;\n\nDá-se aos embargos o valor de «valor do proveito econômico».\n\nNestes termos, pede deferimento.\n\n{{escritorio.cidade}}, {{hoje}}.\n\n{{advogado.nome}}\n{{advogado.oab}}"},
  {"chave":"provas","titulo":"ROL DE DOCUMENTOS","texto":"1. Procuração;\n2. Cópia do título executado e da planilha apresentada pelo credor;\n3. Demonstrativo do valor que a Embargante entende devido;\n4. Relatório de revisão contratual com a taxa média do Banco Central;\n{{BLOCOS:provas}}"}
 ]$j$::jsonb),
('parecer_cliente', 'Parecer ao cliente (revisão contratual)', 'parecer',
 'Parecer em linguagem simples para o cliente: o que analisamos, o que encontramos, quanto representa e o que recomendamos.', 30,
 $j$[
  {"chave":"cabecalho","titulo":"PARECER — REVISÃO DO CONTRATO {{banco}}","texto":"Cliente: {{cliente.nome}} · CNPJ {{cliente.cnpj}}\nContrato: {{contrato.produto}} de {{contrato.valor}}, celebrado em {{contrato.data}} com {{banco}}\nData do parecer: {{hoje}}"},
  {"chave":"analise","titulo":"1. O que analisamos","texto":"Analisamos o contrato de {{contrato.produto}} celebrado com {{banco}} em {{contrato.data}}, no valor de {{contrato.valor}}, com {{contrato.prazo}} parcelas de {{contrato.parcela}} e juros de {{contrato.taxa_mensal}} ao mês ({{contrato.taxa_anual}} ao ano). Comparamos os juros com a taxa média que o Banco Central divulga para esse tipo de operação no mês da contratação ({{bacen.nome}}, {{bacen.mes}}): {{bacen.media_mensal}} ao mês. Os juros do seu contrato equivalem a {{bacen.razao}} vezes a média de mercado."},
  {"chave":"constatacoes","titulo":"2. O que encontramos","texto":"{{BLOCOS:parecer}}"},
  {"chave":"numeros","titulo":"3. Quanto isso representa","texto":"Pelas condições contratadas, o total de juros ao longo do contrato é de {{calc.juros_contratados}}. Se os juros fossem os da média de mercado, seriam {{calc.juros_media}} — uma diferença de {{calc.dif_media}}. Sem a capitalização dos juros, a diferença seria de {{calc.dif_capitalizacao}}. Tarifas e produtos embutidos somam {{calc.tarifas_total}}, dos quais {{calc.repeticao}} podem ser discutidos. Esses números são estimativas feitas a partir do contrato; o valor exato depende de perícia contábil sobre os extratos."},
  {"chave":"recomendacao","titulo":"4. O que recomendamos","texto":"{{recomendacao}}\n\nPara avançar, precisamos dos seguintes documentos: contrato completo assinado, extratos da conta desde a contratação, comprovantes das tarifas e do seguro (se houver) e eventuais notificações recebidas do banco."},
  {"chave":"ressalva","titulo":"","texto":"Este parecer é preliminar e se baseia nas informações fornecidas e nas taxas médias publicadas pelo Banco Central. A comparação com a média de mercado é um indicador, não uma conclusão definitiva; os tribunais exigem que a taxa seja substancialmente superior à média e analisam cada caso (Tema 27/STJ; Tema 1.378/STJ pendente de julgamento). A quantificação final depende de perícia contábil.\n\n{{escritorio.nome}} · {{advogado.nome}} — {{advogado.oab}}"}
 ]$j$::jsonb)
on conflict (id) do update set nome = excluded.nome, tipo = excluded.tipo, descricao = excluded.descricao, ordem = excluded.ordem;
-- (as seções só são gravadas na primeira vez: edições do escritório não são sobrescritas por reaplicação da migration)

-- ---------- seeds: blocos por tese (rascunhos) ----------
-- Um bloco por tese, válido para inicial e embargos (peca = 'inicial' e 'embargos' recebem o mesmo texto inicial).
with b (tese, titulo, fatos, fundamentos, pedidos, provas, parecer) as (values
 ('juros_media',
  'Da abusividade dos juros remuneratórios',
  'Os juros remuneratórios pactuados — {{contrato.taxa_mensal}} ao mês ({{contrato.taxa_anual}} ao ano) — superam em muito a taxa média de mercado apurada pelo Banco Central do Brasil para a modalidade {{bacen.nome}} no mês da contratação ({{bacen.mes}}), que era de {{bacen.media_mensal}} ao mês ({{bacen.media_anual}} ao ano). A taxa contratada corresponde a {{bacen.razao}} vezes a média, o que, no prazo do contrato, representa {{calc.dif_media}} de juros cobrados além do que seria devido pela taxa média.',
  'Embora as instituições financeiras não se submetam ao limite da Lei de Usura (Súmula 596/STF) e a estipulação de juros superiores a 12% ao ano não indique, por si só, abusividade (Súmula 382/STJ), o Superior Tribunal de Justiça firmou, em recurso repetitivo (REsp 1.061.530/RS, Tema 27), que a revisão da taxa é cabível quando demonstrada abusividade no caso concreto, tendo por parâmetro a taxa média de mercado divulgada pelo Banco Central. No caso, a taxa contratada equivale a {{bacen.razao}} vezes a média — discrepância que coloca a Autora em desvantagem exagerada (art. 51, IV e §1º, III, do CDC) e viola a boa-fé objetiva e a função social do contrato (arts. 421 e 422 do Código Civil). Não há justificativa, no perfil da operação (garantias prestadas, porte do tomador, prazo), para spread dessa magnitude.\n\nRequer-se, assim, a limitação dos juros remuneratórios à taxa média de mercado da modalidade no mês da contratação ({{bacen.media_mensal}} ao mês), com o recálculo das parcelas e a restituição do excesso.',
  'a limitação dos juros remuneratórios à taxa média de mercado divulgada pelo Banco Central para a modalidade no mês da contratação ({{bacen.media_mensal}} ao mês), com recálculo do saldo devedor e das parcelas;',
  'Série histórica {{bacen.serie}} do SGS/BACEN ({{bacen.nome}})',
  'Os juros do seu contrato ({{contrato.taxa_mensal}} ao mês) estão bem acima da média que o Banco Central registrou para esse tipo de empréstimo no mês em que você contratou ({{bacen.media_mensal}} ao mês). Isso representa cerca de {{calc.dif_media}} de juros a mais ao longo do contrato. A Justiça não reduz juros só porque estão acima da média, mas uma diferença dessa proporção é um bom indício para pedir a revisão.'),
 ('capitalizacao',
  'Da capitalização de juros sem pactuação expressa',
  'O contrato prevê taxa mensal de {{contrato.taxa_mensal}} e anual de {{contrato.taxa_anual}} — esta última superior ao duodécuplo da mensal ({{calc.duodecuplo}}) —, o que revela a aplicação de juros capitalizados sem que haja cláusula clara e expressa nesse sentido, em periodicidade que o instrumento não informa de forma compreensível. A diferença entre o fluxo contratado e o mesmo fluxo com juros simples sobre o saldo alcança {{calc.dif_capitalizacao}}.',
  'A capitalização de juros com periodicidade inferior a um ano é admitida nos contratos celebrados após 31/03/2000 apenas quando expressamente pactuada (MP 2.170-36/2001, art. 5º; Súmula 539/STJ). A previsão de taxa anual superior ao duodécuplo da mensal é suficiente para caracterizar a pactuação (Súmula 541/STJ), mas não dispensa a informação clara ao contratante (arts. 6º, III, 46 e 54, §4º, do CDC; art. 113 do CC), sobretudo quanto à periodicidade da capitalização. A capitalização diária sem a indicação da taxa diária correspondente tem sido reconhecida como nula pela jurisprudência, por frustrar o dever de informação. Os valores cobrados a esse título devem ser excluídos e restituídos, apurando-se o excesso por perícia contábil.',
  'o afastamento da capitalização de juros em periodicidade inferior à anual, por ausência de pactuação clara e expressa, com o recálculo do débito por juros simples e a restituição do excesso;',
  'Planilha de evolução do saldo devedor (a ser exibida pela Ré)',
  'O banco cobrou juros sobre juros (capitalização) sem deixar isso claro no contrato — a taxa anual informada ({{contrato.taxa_anual}}) é maior do que 12 vezes a mensal. Estimamos que isso tenha custado cerca de {{calc.dif_capitalizacao}} a mais. A confirmação exata depende de perícia nos extratos.'),
 ('taxa_divergente',
  'Da cobrança de taxa superior à contratada',
  'A parcela cobrada ({{contrato.parcela}}) corresponde a uma taxa efetiva de {{calc.tir}} ao mês, superior à taxa contratada de {{contrato.taxa_mensal}}, o que indica a aplicação de encargos diversos dos pactuados.',
  'A instituição financeira está vinculada à taxa que contratou (arts. 422 e 427 do Código Civil; art. 6º, III, e art. 46 do CDC). A divergência entre a taxa expressa no instrumento e a efetivamente aplicada nas parcelas configura cobrança indevida, cuja apuração exige a exibição da planilha de evolução do débito e perícia contábil, com restituição do excesso.',
  'a declaração de que a taxa aplicável é a expressamente contratada ({{contrato.taxa_mensal}} ao mês), com o recálculo das parcelas e a restituição da diferença;',
  'Comprovantes de pagamento das parcelas',
  'As parcelas cobradas correspondem a uma taxa maior do que a escrita no contrato. Precisamos dos extratos para confirmar.'),
 ('cet',
  'Da ausência ou inconsistência do Custo Efetivo Total',
  'O Custo Efetivo Total informado ({{contrato.cet}} ao ano) não reflete os encargos efetivamente incidentes sobre a operação, «descrever a inconsistência ou a ausência».',
  'A Resolução CMN 4.881/2020 (antes, Res. 3.517/2007) obriga as instituições financeiras a informar o Custo Efetivo Total previamente à contratação, nas operações com pessoas naturais e com microempresas e empresas de pequeno porte, e o art. 52 do CDC exige a informação prévia e adequada sobre o custo do crédito. A omissão ou inconsistência do CET viola o dever de informação e autoriza a revisão dos encargos não informados.',
  'o reconhecimento da violação ao dever de informação quanto ao Custo Efetivo Total, com a exclusão dos encargos não informados;',
  'Demonstrativo do CET',
  'O custo total do empréstimo não foi informado corretamente, o que o banco é obrigado a fazer para empresas de pequeno porte.'),
 ('mora_juros',
  'Dos juros moratórios acima do limite legal',
  'O contrato prevê juros de mora de {{mora.juros}} ao mês, acima do limite de 1% ao mês.',
  'Os juros moratórios em contratos bancários são limitados a 1% ao mês (art. 406 do Código Civil c/c art. 161, §1º, do CTN; Súmula 379/STJ; Tema 28/STJ). O excesso é indevido e deve ser excluído do saldo devedor.',
  'a limitação dos juros moratórios a 1% ao mês;',
  '',
  'Os juros de atraso previstos ({{mora.juros}} ao mês) ultrapassam o limite de 1% ao mês admitido pela Justiça.'),
 ('mora_multa',
  'Da multa moratória acima do limite',
  'O contrato prevê multa moratória de {{mora.multa}}, superior ao limite de 2%.',
  'A multa moratória nos contratos de consumo é limitada a 2% (art. 52, §1º, do CDC). Ainda que afastada a relação de consumo, a cláusula penal manifestamente excessiva deve ser reduzida equitativamente pelo juiz (arts. 412 e 413 do Código Civil).',
  'a redução da multa moratória ao patamar de 2%;',
  '',
  'A multa por atraso prevista ({{mora.multa}}) é maior do que os 2% permitidos.'),
 ('comissao_permanencia',
  'Da comissão de permanência cumulada com outros encargos',
  'Para o período de inadimplência, o contrato prevê comissão de permanência cumulada com juros remuneratórios, juros moratórios, multa e/ou correção monetária.',
  'A comissão de permanência, quando admitida, não pode ser cumulada com correção monetária (Súmula 30/STJ), com juros remuneratórios (Súmula 296/STJ) nem com juros moratórios e multa (Súmula 472/STJ), pois já engloba todos esses encargos (Tema 52/STJ). Além disso, a Resolução CMN 4.558/2017 vedou a cobrança de comissão de permanência nos contratos celebrados a partir de 1º/09/2017, de modo que sua simples previsão é irregular em contratos posteriores.',
  'a exclusão da comissão de permanência, ou, subsidiariamente, o afastamento de sua cumulação com quaisquer outros encargos moratórios;',
  '',
  'O contrato prevê, para o atraso, uma cobrança chamada comissão de permanência somada a juros e multa — a Justiça não admite essa soma, e esse encargo nem pode mais ser cobrado em contratos recentes.'),
 ('descaracterizacao_mora',
  'Da descaracterização da mora',
  'Demonstrada a abusividade dos encargos do período de normalidade contratual, a Autora não pode ser considerada em mora, pois o inadimplemento decorreu da cobrança de encargos ilegais.',
  'Conforme a tese firmada no REsp 1.061.530/RS (Tema 972/STJ), o reconhecimento da abusividade nos encargos exigidos no período da normalidade contratual (juros remuneratórios e capitalização) descaracteriza a mora, afastando os seus efeitos — inscrição em cadastros restritivos, vencimento antecipado e encargos moratórios — enquanto perdurar a discussão.',
  'o reconhecimento da descaracterização da mora, com o afastamento dos encargos moratórios e dos seus efeitos, inclusive a inscrição em cadastros restritivos;',
  '',
  'Se a Justiça reconhecer que os juros eram abusivos, o atraso no pagamento deixa de ser considerado culpa sua — e o banco não pode negativar seu nome por esse contrato enquanto a discussão durar.'),
 ('tac_tec',
  'Das tarifas de abertura de crédito e de emissão de boleto',
  'Foram cobradas tarifa de abertura de crédito (TAC) de {{tarifas.tac}} e tarifa de emissão de boleto/carnê (TEC) de {{tarifas.tec}}, em contrato celebrado após 30/04/2008.',
  'O STJ, em recurso repetitivo (REsp 1.251.331/RS, Temas 618 a 620), fixou que a cobrança de TAC e TEC é indevida nos contratos celebrados a partir de 30/04/2008, quando passaram a vigorar as Resoluções CMN 3.518/2007 e 3.919/2010, que não as preveem. Os valores devem ser restituídos.',
  'a declaração de nulidade da cobrança de TAC e TEC, com a restituição dos valores pagos;',
  'Comprovante da cobrança das tarifas',
  'O banco cobrou tarifas de abertura de crédito e de boleto ({{tarifas.tac}} e {{tarifas.tec}}) que não podem ser cobradas em contratos feitos depois de 2008.'),
 ('tarifa_cadastro',
  'Da tarifa de cadastro cobrada fora do início do relacionamento',
  'Foi cobrada tarifa de cadastro de {{tarifas.cadastro}}, embora a Autora já mantivesse relacionamento com a Ré, com conta corrente e operações anteriores.',
  'A tarifa de cadastro só pode ser cobrada uma única vez, no início do relacionamento entre o consumidor e a instituição financeira (Súmula 566/STJ; Tema 618/STJ). Cobrada em contrato posterior, com relacionamento já existente, é indevida.',
  'a declaração de nulidade da tarifa de cadastro, com a restituição do valor pago;',
  'Extratos que comprovam o relacionamento anterior',
  'O banco cobrou uma tarifa de cadastro ({{tarifas.cadastro}}) que só poderia ser cobrada no início do relacionamento — e você já era cliente.'),
 ('tarifa_avaliacao_registro',
  'Das tarifas de avaliação do bem e de registro sem contraprestação',
  'Foram cobradas tarifa de avaliação do bem de {{tarifas.avaliacao}} e de registro do contrato de {{tarifas.registro}}, sem comprovação de que os serviços tenham sido efetivamente prestados.',
  'Conforme o Tema 958/STJ (REsp 1.578.553/SP), as tarifas de avaliação do bem e de registro do contrato são válidas apenas quando comprovada a efetiva prestação do serviço e desde que o valor não seja abusivo. Não demonstrada a prestação, a cobrança é indevida e os valores devem ser restituídos.',
  'a declaração de nulidade das tarifas de avaliação e de registro, com a restituição dos valores, salvo comprovação da efetiva prestação dos serviços;',
  '',
  'Foram cobradas tarifas de avaliação e registro ({{tarifas.avaliacao}} e {{tarifas.registro}}) sem que o banco comprove que o serviço foi feito.'),
 ('seguro_prestamista',
  'Do seguro prestamista imposto (venda casada)',
  'O contrato embutiu seguro prestamista no valor de {{tarifas.seguro}}, contratado com seguradora do mesmo conglomerado da Ré, sem que fosse oferecida à Autora a possibilidade de recusa ou de escolha de outra seguradora.',
  'Nos termos do Tema 972/STJ (REsp 1.639.259/SP), a contratação de seguro prestamista é lícita, mas configura venda casada (art. 39, I, do CDC) quando o tomador é compelido a contratá-lo com a seguradora indicada pela instituição financeira, sem liberdade de escolha. O prêmio deve ser restituído.',
  'a declaração de nulidade da contratação do seguro prestamista, com a restituição do prêmio pago;',
  'Proposta/apólice do seguro',
  'O seguro embutido no contrato ({{tarifas.seguro}}) foi imposto, sem opção de recusa ou de escolher outra seguradora — a Justiça chama isso de venda casada.'),
 ('iof_financiado',
  'Do IOF financiado',
  'O IOF no valor de {{tarifas.iof}} foi financiado e incorporado ao principal, sobre o qual incidem os juros remuneratórios, embora o valor esperado para a operação fosse de aproximadamente {{calc.iof_esperado}}.',
  'O financiamento do IOF é admitido (Tema 621/STJ), mas o valor cobrado deve corresponder ao tributo efetivamente devido e ser informado com transparência (art. 46 do CDC). A cobrança em valor superior ao devido é indevida e deve ser restituída.',
  'a adequação do IOF ao valor efetivamente devido, com a restituição do excesso;',
  '',
  'O imposto (IOF) foi somado ao empréstimo e também sofre juros; o valor cobrado parece maior do que o devido.'),
 ('vicio_ccb',
  'Dos vícios formais do título executivo',
  'A cédula de crédito bancário que instrui a execução «descrever o vício: falta de assinatura/testemunhas, ausência de planilha de evolução do débito, divergência entre o valor original e o executado, campos em branco».',
  'A cédula de crédito bancário é título executivo extrajudicial apenas quando acompanhada de demonstrativo claro e individualizado do débito, com a evolução do saldo e os encargos aplicados (art. 28, §2º, da Lei 10.931/2004; art. 798, I, b, do CPC). A ausência desses requisitos retira a liquidez do título e impõe a extinção da execução (art. 803, I, do CPC).',
  'a extinção da execução pela ausência dos requisitos formais do título executivo, nos termos do art. 28 da Lei 10.931/2004 e do art. 803, I, do CPC;',
  '',
  'O documento que o banco usa para cobrar tem falhas formais que podem invalidar a cobrança judicial.'),
 ('liquidez',
  'Da ausência de liquidez e certeza do título',
  'O valor executado foi apurado unilateralmente pela Ré, sem a apresentação dos extratos desde a origem e da planilha discriminada dos encargos.',
  'A execução exige título líquido, certo e exigível (art. 783 do CPC). O contrato de abertura de crédito, ainda que acompanhado de extratos, não é título executivo (Súmula 233/STJ), e o saldo apurado unilateralmente pelo credor, sem demonstrativo que permita a conferência dos encargos, é ilíquido, impondo a extinção da execução (art. 803, I, do CPC).',
  'a extinção da execução por iliquidez do título;',
  '',
  'O banco não demonstrou de forma clara como chegou ao valor cobrado.'),
 ('prescricao',
  'Da prescrição',
  '«Descrever: data do vencimento/inadimplemento, data do ajuizamento, período de suspensão da execução sem bens».',
  'A pretensão de cobrança de dívida líquida constante de instrumento particular prescreve em 5 anos (art. 206, §5º, I, do Código Civil). Na execução suspensa por ausência de bens penhoráveis, decorrido o prazo de 1 ano, inicia-se o prazo da prescrição intercorrente (art. 921, §§ 1º a 5º, do CPC; Súmula 150/STF; Lei 14.195/2021), que não é interrompido por diligências infrutíferas.',
  'o reconhecimento da prescrição (ou da prescrição intercorrente), com a extinção da execução;',
  '',
  'O prazo legal para o banco cobrar essa dívida pode já ter passado.'),
 ('vencimento_antecipado',
  'Do vencimento antecipado irregular e da cobrança de juros sobre parcelas vincendas',
  'A Ré declarou o vencimento antecipado da dívida sem prévia notificação da Autora e incluiu no saldo executado os juros remuneratórios das parcelas vincendas.',
  'O vencimento antecipado pressupõe a constituição em mora do devedor (art. 397, parágrafo único, do Código Civil) e a prévia notificação. Além disso, antecipado o vencimento, não são devidos os juros remuneratórios embutidos nas parcelas vincendas, que remuneram o uso do capital por prazo que não se cumpriu (REsp 1.061.530/RS), devendo o saldo ser apurado pelo valor presente das parcelas, com a exclusão desses juros.',
  'o reconhecimento da irregularidade do vencimento antecipado e a exclusão dos juros remuneratórios incidentes sobre as parcelas vincendas;',
  '',
  'O banco venceu a dívida toda de uma vez sem avisar e está cobrando juros de parcelas que ainda nem venceram.'),
 ('compensacao_indevida',
  'Da compensação indevida em conta',
  'A Ré debitou valores da conta «do sócio/avalista ou de outra conta», sem autorização específica, para amortizar a dívida da Autora, «descrever os débitos».',
  'A compensação exige dívidas recíprocas, líquidas e vencidas entre as mesmas partes (arts. 368 e 369 do Código Civil); o débito em conta de terceiro, ainda que avalista, ou sobre verbas impenhoráveis (art. 833, IV e X, do CPC) é indevido. O débito automático pode ser cancelado a qualquer tempo pelo cliente (Resolução CMN 4.790/2020).',
  'a declaração de ilegalidade dos débitos em conta realizados sem autorização específica, com a restituição dos valores;',
  'Extratos da conta debitada',
  'O banco descontou valores de conta que não podia usar para pagar essa dívida.'),
 ('aval_fianca',
  'Da garantia pessoal',
  '«Descrever: fiança sem outorga conjugal, fiança prorrogada sem anuência, aval sem limite de valor».',
  'A fiança prestada sem outorga do cônjuge é ineficaz em sua totalidade (art. 1.647, III, do Código Civil; Súmula 332/STJ); a fiança não se estende além do prazo e do valor pactuados, e o fiador pode exonerar-se das obrigações futuras (arts. 819, 835 e 837 do Código Civil).',
  'o reconhecimento da ineficácia/limitação da garantia pessoal prestada, nos termos expostos;',
  '',
  'A garantia dada pelos sócios tem falhas que podem limitar ou afastar a responsabilidade pessoal deles.')
)
insert into public.blocos_tese (tese, peca, titulo, fatos, fundamentos, pedidos, provas, parecer, rascunho)
select b.tese, p.peca, b.titulo, b.fatos, b.fundamentos, b.pedidos, nullif(b.provas,''), b.parecer, true
from b cross join (values ('inicial'),('embargos')) as p(peca)
on conflict (tese, peca) do nothing;   -- não sobrescreve edições do escritório

select 'ok 0032' as resultado;


select 'ok parte 3/9' as resultado;
