# Sistema de Carteira de Contratos — Plano da etapa 2

**Neves Pádua Advocacia · 07/10/2026 · confirmado em 07/10 (itens 1–5); PR 1 em construção**

Repositório: `nevespaduaadv/painel` (GitHub Pages) · Banco: Supabase `ksdwzljfjfucjevdqxvx` (São Paulo).

---

## 0. O que existe hoje no repositório (lido antes de planejar)

| Item | Estado |
|---|---|
| `index.html` | Portal: login único (Supabase Auth) + azulejos por perfil |
| `passivos/index.html` | Painel de Passivos (gerado a partir de `painel-passivos/index.html` + `gerar-app-supabase.mjs`): clientes, contratos, base de acordos, regras, calibração, usuários; tempo real; auditoria |
| `alphamec/index.html` | Página fixa do cliente (sem login), regerada às quartas |
| Banco | `perfis`, `clientes`, `contratos`, `notas_internas`, `historico` (base de acordos), `regras`, `auditoria`, view `referencias`; RLS em tudo; trigger de perfil no 1º login; auditoria automática |
| Dados reais | Alphamec (12 contratos), 22 acordos de referência, regras v2 |

### Quatro divergências entre o briefing e o que existe — e o que recomendo

1. **Motor de projeção.** O briefing descreve "desconto = piso de provisão − 15 p.p.". Esse era o motor v1. O que está em produção (v2, validado com você em 06/10) usa **a mediana dos acordos reais do escritório com o credor** → grupo de credor → e só sem histórico cai em provisão − 15 p.p. Recomendo **manter o v2**: é ele que faz a projeção "refletir como cada banco opera", que é o objetivo declarado no próprio briefing. Nada a construir aqui.
2. **IDs uuid.** `clientes` e `contratos` usam ids de texto (`alphamec`, `alphamec-d5`) e já são referenciados por notas, auditoria, páginas publicadas e pela rotina semanal. Trocar por uuid agora é risco sem ganho. Recomendo: **tabelas novas nascem com uuid; as duas existentes mantêm id texto** (estável, único, legível). Chaves estrangeiras funcionam igual.
3. **Normalização.** `clientes.dados` e `contratos.dados` são JSON (mesmo formato do painel). O briefing pede Postgres normalizado. Normalizar tudo agora significa reescrever a camada de dados do painel inteiro. Recomendo **normalizar por etapas**: nesta etapa, tudo que é novo (timeline, processos, tarefas, horas, acordos, colaboradores) nasce em colunas normais; para contratos, crio **colunas geradas** a partir do JSON (banco, saldo, data de início do atraso, situação, titular) — suficientes para views, Power BI e integrações. A migração completa de `contratos` para colunas vira uma etapa própria depois do dashboard, quando saberemos exatamente quais campos as views precisam.
4. **Timeline e acordos já existem em formato embutido** (`clientes.dados.timeline` e `contratos.dados.acordo`). Vou migrá-los para as tabelas novas com script, e o painel passa a gravar nas tabelas. A página fixa do cliente e a rotina semanal precisam de um ajuste pequeno para ler da tabela (incluído na etapa 1).

Uma observação sobre a visão do cliente: o briefing diz "atualizada quando o escritório pedir". Com Supabase + login, a visão do cliente pode ser **ao vivo** (sem regeração). Mantenho as duas: a fixa (sem login) continua existindo para quem receber só o link; a ao vivo passa a ser a principal. A decisão (a)/(b) abaixo define qual é a padrão.

---

## 1. Acesso do cliente — decisão sua antes da etapa 4

| | (a) Link por token, sem login | (b) Login do cliente (Supabase Auth) — **já implementado** |
|---|---|---|
| Experiência | Abre o link e vê. Zero atrito. | E-mail + senha (ou link mágico por e-mail). Um passo a mais. |
| Segurança | Quem tiver o link vê. Token de 32+ caracteres não é adivinhável, mas é repassável (WhatsApp, e-mail encaminhado). Dá para revogar e gerar outro. | Credencial pessoal. Dá para desativar o usuário, ver quando entrou, exigir troca de senha. |
| LGPD / sigilo | Mais frágil: dado financeiro atrás de um link compartilhável. Aceitável se o contrato com o cliente prever e o token for revogável. | Mais defensável: acesso identificado e auditável. |
| Implementação | Função no banco (`painel_por_token`) que devolve só os dados daquele cliente com `visivel_cliente = true`; página `cliente/?t=…` sem Supabase Auth. ~meio dia. | Pronto. Falta só criar os usuários dos clientes e marcar o perfil. |
| Tempo real | Sim (a página consulta o banco a cada abertura). | Sim. |
| Multi-usuário no cliente | Um link serve para todos na empresa — bom e ruim. | Um login por pessoa (sócio, financeiro). |

**Minha recomendação: (b) como padrão, (a) como opção por cliente** (campo `acesso_por_token` no cadastro, desligado por padrão). Cliente que não quer senha recebe o link; os demais entram com login. Se preferir só uma das duas, implemento só ela.

---

## 2. Modelo de dados — o que entra

Convenções em todas as tabelas novas: `id uuid default gen_random_uuid()`, `created_at`, `created_by uuid → auth.users`, `updated_at`, `updated_by`; gatilho de carimbo; gatilho de auditoria (reaproveita `public.auditoria`); RLS: equipe tudo, cliente só o próprio `cliente_id` e só `visivel_cliente = true` onde a coluna existir, anônimo nada. Campos `fonte text default 'manual'` e `id_externo text` onde houver integração futura.

### 2.1 Pessoas

```sql
-- colaboradores: dados de RH básico; 1:1 opcional com perfis (usuário de login)
colaboradores (
  id uuid pk, perfil_id uuid unique → perfis(id) null,
  nome text not null, cargo text, nucleo text check in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','administrativo','socios'),
  data_admissao date, responsabilidades text, ativo bool default true, ...carimbos
)
-- contatos: pessoas do lado do cliente
contatos (
  id uuid pk, cliente_id text → clientes(id), nome text not null, cargo text, email text, telefone text,
  principal bool default false, perfil_id uuid → perfis(id) null,  -- se tiver login
  ...carimbos
)
```

### 2.2 Contencioso

```sql
processos (
  id uuid pk, cliente_id text → clientes(id), contrato_id text → contratos(id) null,
  numero_cnj text unique, tribunal text, vara text, tipo_acao text, parte_contraria text,
  banco text, polo text check in ('ativo','passivo'), fase text,
  valor_causa numeric, proximo_prazo date, prazo_fatal bool default false,
  responsavel_id uuid → colaboradores(id), status text default 'ativo' check in ('ativo','suspenso','encerrado'),
  visivel_cliente bool default true, fonte text default 'manual', id_externo text, ...carimbos
)
andamentos (
  id uuid pk, processo_id uuid → processos(id), data date not null, tipo text, descricao text not null,
  fonte text default 'manual', id_externo text,   -- Escavador/Judit depois
  visivel_cliente bool default false, ...carimbos
)
```

### 2.3 Timeline (registro central de atuação)

```sql
entradas_timeline (
  id uuid pk, cliente_id text → clientes(id) not null,
  contrato_id text → contratos(id) null, processo_id uuid → processos(id) null, andamento_id uuid → andamentos(id) null,
  data date not null, tipo text not null check in ('solicitacao_documentos','requerimento_bacen','analise_contrato','parecer_tecnico',
      'contato_banco','proposta_acordo','reuniao_cliente','ata','protocolo','mudanca_estagio','acordo_fechado','andamento','outro'),
  descricao text not null, responsavel_id uuid → colaboradores(id),
  horas numeric(6,2) default 0, links jsonb default '[]',  -- [{titulo,url}]
  visivel_cliente bool default false, automatica bool default false,
  fonte text default 'manual', id_externo text, ...carimbos
)
anexos ( id uuid pk, entrada_id uuid → entradas_timeline(id), nome text, caminho_storage text, tamanho int, mime text, ...carimbos )
-- bucket Storage 'anexos' com política: equipe lê/escreve; cliente lê só anexos de entradas visíveis do próprio cliente
```

**Entradas automáticas (gatilhos no banco):** (1) mudança de estágio de um contrato (1→2, 2→3), calculada diariamente por job `pg_cron` que compara o estágio de ontem e de hoje; (2) acordo fechado (inserção em `acordos`); (3) novo andamento de processo. Todas com `automatica = true`.

### 2.4 Acordos (sai de dentro do contrato)

```sql
acordos (
  id uuid pk, contrato_id text → contratos(id) not null, cliente_id text → clientes(id) not null,
  data date not null, valor_pago numeric not null, desconto_obtido numeric, parcelas int default 1,
  desconto_projetado numeric, saldo_no_acordo numeric, dias_no_acordo int,  -- congelados para calibração
  observacoes text, ...carimbos
)
```
`contratos.dados.acordo` continua sendo gravado pelo painel (compatibilidade) e um gatilho espelha em `acordos`. A calibração passa a ler `acordos`.

### 2.5 Tarefas e horas

```sql
tarefas (
  id uuid pk, titulo text not null, descricao text, cliente_id text → clientes(id) null,
  contrato_id text null, processo_id uuid null, responsavel_id uuid → colaboradores(id),
  nucleo text, prazo date, prazo_fatal bool default false,
  status text default 'aberta' check in ('aberta','em_andamento','concluida','cancelada'), concluida_em timestamptz,
  ...carimbos
)
apontamentos_horas (
  id uuid pk, colaborador_id uuid → colaboradores(id) not null, data date not null, horas numeric(6,2) not null,
  cliente_id text null, tarefa_id uuid null, entrada_id uuid null,  -- um dos dois
  tipo_atividade text, descricao text, ...carimbos
)
```

### 2.6 Contratos — colunas geradas (sem mexer no JSON)

```sql
alter table contratos
  add column banco text generated always as (dados->>'banco') stored,
  add column titular text generated always as (dados->>'titular') stored,
  add column situacao text generated always as (dados->>'situacao') stored,
  add column saldo_atual numeric generated always as ((dados->>'saldoAtual')::numeric) stored,
  add column data_inicio_atraso date generated always as (nullif(dados->>'dataInicioAtraso','')::date) stored,
  add column garantia text generated always as (dados->>'garantia') stored;
```
Mais `clientes.nome` gerada, `clientes.ativo bool default true`, `clientes.acesso_por_token bool default false`, `clientes.token text unique` (só se (a) for escolhida).

### 2.7 Views para o dashboard / Power BI (etapa 3)

`v_carteira_por_estagio`, `v_clientes_resumo` (saldo sob gestão, contratos por estágio, último registro na timeline, dias sem registro), `v_acordos_periodo` (economia obtida × projetada), `v_prazos` (próximos 7/15/30 dias, fatal × interno), `v_processos_por_fase`, `v_horas_por_colaborador`, `v_horas_por_cliente`, `v_horas_por_tipo`, `v_tarefas_no_prazo`. Todas `security_invoker = true` (respeitam a RLS); exposição ao Power BI via usuário de leitura ou chave de serviço num conector, depois.

### 2.8 Migrations no repositório

```
supabase/migrations/
  0001_esquema_inicial.sql        ← o script já rodado em 07/10 (movido para cá, inalterado)
  0002_colaboradores_contatos.sql
  0003_processos_andamentos.sql
  0004_timeline_anexos_acordos.sql   (inclui migração dos dados embutidos + gatilhos automáticos)
  0005_tarefas_horas.sql
  0006_views_dashboard.sql
  0007_acesso_cliente_token.sql      (só se (a) for escolhida)
```
Regra a partir de agora: nada de alterar o schema pelo painel do Supabase sem migration no repositório. README terá "como aplicar uma migration" (colar no SQL Editor, na ordem; ou `supabase db push` com a CLI, para quem tiver).

---

## 3. Telas — por etapa / PR

### PR 1 — Timeline + Processos na página do cliente (`passivos/`)
- Página do cliente ganha **abas internas**: Visão geral (KPIs + dashboard atuais) · Contratos (cards atuais) · **Timeline** · **Processos** · Notas internas (equipe).
- **Timeline**: lista cronológica com filtro por tipo/responsável/período; cada entrada mostra data, tipo (pílula), responsável, descrição, links, horas, vínculo (contrato/processo), selo "visível ao cliente" com alternador rápido; botão "+ Registrar atuação" (formulário completo); entradas automáticas com selo próprio.
- **Processos**: tabela por cliente (CNJ, tribunal/vara, tipo, parte contrária, banco/contrato, fase, próximo prazo com destaque se fatal, responsável); formulário de processo; dentro de cada processo, lista de andamentos com "+ Andamento".
- Migração: timeline embutida → `entradas_timeline` (tipo "outro", responsável vazio, `visivel_cliente = true` para as 3 entradas do Alphamec já exibidas ao cliente); `contratos.dados.acordo` → `acordos`.
- Página fixa e rotina semanal passam a ler `entradas_timeline` com `visivel_cliente = true`.

### PR 2 — Tarefas + Timesheet (`tarefas/` + aba no cliente)
- **Tarefas (escritório)**: visão "Vencendo em 7 / 15 / 30 dias" com prazo fatal destacado em vermelho, filtros por núcleo/responsável/status; kanban simples por status; formulário de tarefa.
- **Aba Tarefas no cliente**: as tarefas daquele cliente.
- **Apontar horas**: no formulário da entrada de timeline e no da tarefa; tela "Minhas horas" (por dia) para o colaborador lançar rápido.

### PR 3 — Dashboard de gestão (`gestao/`)
- Carteira: clientes ativos, saldo sob gestão, contratos por estágio (gráfico), acordos no período, economia obtida × projetada.
- Jurídico: prazos no período, fatais próximos, processos por fase.
- Equipe: horas por colaborador/cliente/tipo, tarefas no prazo × atrasadas.
- Alertas: clientes sem registro na timeline há mais de X dias (X configurável nas regras).
- Tudo lendo das views SQL (nenhuma conta no front).

### PR 4 — Visão do cliente evoluída
- Abas: Visão geral · Contratos · Reserva de quitação (reserva acumulada, aporte mensal, gap por contrato) · Andamento (timeline filtrada) · Processos (resumo: fase e último andamento visível).
- Implementa a opção (a) se escolhida; página fixa atualizada para o mesmo layout.

### PR 5 — Colaboradores (`equipe/`)
- Cadastro: nome, cargo, núcleo, admissão, responsabilidades, vínculo com usuário; ativo/inativo.
- Integra com a aba Usuários (um colaborador pode ter login; perfil define o papel).

### Transversal (em todos os PRs)
- Azulejo no portal para cada tela nova; `created_by/updated_at` em tudo; exportação CSV/JSON (botão "Exportar" na aba Usuários/Admin, por tabela); README atualizado; dados de demonstração só fictícios (Alphamec única real).

---

## 4. O que fica preparado, não construído
- `fonte`/`id_externo` em `andamentos`, `processos`, `entradas_timeline` (Escavador/Judit).
- Tabelas financeiras **não** criadas agora; reservo o prefixo `fin_` e o campo `asaas_id` no cliente (`clientes.dados.asaasId`) para o webhook futuro.
- Edge Functions: pasta `supabase/functions/` criada com README; nenhuma função ainda.
- Integração com EasyJur/Projuris: via API do Supabase (PostgREST) — já existe; nada a construir.

---

## 5. Operação por comando (meta do briefing)
Depois do PR 1, comandos como "lance na timeline da Alphamec que fizemos X" ou "adicione o processo Y ao cliente Z" viram inserções diretas nas tabelas a partir desta conversa, com `fonte = 'claude'` e o responsável que você indicar. "Atualiza o painel da Alphamec" continua regerando a página fixa; a visão ao vivo não precisa.

---

## 5b. Referência de indicadores para o dashboard (prints Legale/Power BI, 07/10)
O que importa é o conteúdo, não a estética. Indicadores a reproduzir nas views (PR 3), adaptados à realidade do escritório:

**Equipe / produtividade** — total de andamentos (publicações) e de tarefas (compromissos) no período; por responsável; por tipo; por cliente; em atraso (total, por responsável, por tipo); concluídos com antecedência × com atraso (por responsável e por tipo); status (concluído × pendente); filtros: ano/período, gestor, usuário, cliente, processo.

**Jurídico** — base de processos (ativos × encerrados), processos sem providência (sem andamento/tarefa recente), quantidade por área, por tipo de ação, por fase, por assunto, polo (autor × réu); tabela de processos com último compromisso e dias desde a última atualização; filtros: unidade/núcleo, status, ano, área, cliente, responsável.

**Andamentos / publicações** — quantidade no período, sem providência, sem vínculo com processo; por status, por área, por data (série temporal); por usuário; tabela detalhada.

**Contratos (carteira)** — quantidade e valor original por ano; por cliente; por área/produto; tabela cliente → contratos → valor; além dos nossos: por estágio (1/2/3), por banco, saldo sob gestão, acordos fechados e economia obtida × projetada.

**Financeiro (fase posterior, via Asaas)** — receita × despesa com variação mensal; resultado e acumulado; total recebido × a receber (quantidade e valor), pago × a pagar; inadimplência acumulada, no período, por cliente, por plano de contas, série temporal; receita/despesa por unidade, plano de contas, grupo de cliente/fornecedor. O schema financeiro será desenhado para alimentar exatamente esses cortes.

## 5d. Situação (08/10)
PR 1–5 publicados (migrations 0002–0006) — etapa 2 completa. Acesso do cliente: login (padrão) + link por token (`cliente/?t=…`), conforme decidido. A página fixa `alphamec/` continua no ar como foto de 07/10 até o escritório migrar a Alphamec para login ou link por token.

## 5c. Regeração desativada (07/10)
Com a visão do cliente ao vivo, as rotinas de regeração (artefato reserva às quartas e publicação no GitHub) foram desativadas. A página fixa `alphamec/` permanece no ar com a posição de 07/10/2026 até o PR 4 definir seu destino (manter como opção por token ou retirar).

## 6. Para você confirmar
1. Manter o motor v2 (mediana dos acordos reais) em vez do "provisão − 15 p.p." do briefing. **Recomendo manter.**
2. Ids de texto nas duas tabelas existentes; uuid nas novas. **Recomendo.**
3. Normalização por etapas (JSON + colunas geradas agora; normalização completa de contratos depois do dashboard). **Recomendo.**
4. Acesso do cliente: (b) padrão + (a) opcional por cliente — ou só uma.
5. Ordem dos PRs como acima (1 → 5). Começo pelo PR 1 assim que você confirmar.
