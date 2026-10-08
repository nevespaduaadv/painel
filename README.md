# Portal Neves Pádua — Sistema de Carteira de Contratos

Frontend estático (HTML/CSS/JS puros) publicado no GitHub Pages, com dados, login e permissões no Supabase.

| Caminho | O que é |
|---|---|
| `index.html` | Portal: login único e azulejos por área (Clientes · Jurídico · Equipe · Gestão · em breve Comercial/Marketing/Financeiro), filtrados por perfil. |
| `passivos/index.html` | App interno "Clientes" (gerado — **não editar à mão**). Navegação por áreas no topo (Clientes · Jurídico ▾ · Equipe ▾ · Gestão), rotas no `#` (`#clientes/<id>/<aba>`, `#tarefas`, `#negociacoes`…) com voltar do navegador e breadcrumb na página do cliente. |
| `passivos/carteira.js` | Módulo da carteira: abas **Timeline** e **Processos** da página do cliente (lê e grava nas tabelas do Supabase). |
| `passivos/ficha.js` | Aba **Resumo** da ficha do cliente: identificação, história, situação, sócios/contatos, bens, documentos. |
| `passivos/conhecimento.js` | **Base de conhecimento** (Jurídico): artigos em Markdown por tema (teses, POPs, produtos de crédito, negociação, proteção patrimonial, holding), busca full-text, edição com versões, diagramas mermaid. |
| `passivos/rh.js` | **RH**: ficha do colaborador (foto, dados básicos), PDI e acompanhamento (1:1/feedback), dados sensíveis + salário + histórico só para admin; aniversariantes. |
| `passivos/marketing.js` | **Marketing — pautas de conteúdo**: calendário, kanban e lista; fluxo de aprovação das sócias (aprovar / pedir ajuste), comentários, links de criativo e legenda. |
| `passivos/autenticador.js` | **Autenticador (2FA)**: códigos TOTP dos acessos dos clientes sempre visíveis (janela de códigos vinda do banco; o segredo fica no Vault). Widget reutilizado na ficha. |
| `passivos/documentos.js` | **Documentos base (Drive)**, dentro da base de conhecimento: índice pesquisável da pasta JURÍDICO do Google Drive (modelos de peças, tópicos, jurisprudência, planilhas) — os arquivos continuam no Drive; a equipe descreve, marca destaques e adiciona links. |
| `passivos/publicacoes.js` | Aba **Publicações (DJEN)**: intimações por OAB importadas pelo banco (pg_net + pg_cron), vinculadas ao processo, com tarefa de análise; triagem das sem vínculo. |
| `passivos/fluxo.js` | **Fluxo PJ** (etapas 0–10 do Notion na ficha), abas **Negociações** (kanban do setor de acordos) e **Monitoramento** (checagem processual por cliente); sub-aba Negociações na página do cliente. |
| `passivos/equipe.js` | Aba **Equipe**: cadastro de colaboradores (cargo, núcleo, admissão, responsabilidades, vínculo com o usuário). |
| `passivos/tarefas.js` | Abas **Tarefas** (escritório + por cliente) e **Horas** (timesheet e relatórios), sobre `tarefas`, `apontamentos_horas` e as views `v_*`. |
| `cliente/index.html` | Área do cliente **por link com token** (`cliente/?t=…`), sem login (gerado — não editar à mão). Lê `painel_por_token()`. |
| `gestao/index.html` | Dashboard de gestão (carteira, jurídico, equipe, alertas). Lê só as views `v_*`; página independente, mesma sessão de login. |
| `fontes/painel.html` | Protótipo-fonte do painel (motor de projeção, dashboard, formulários). |
| `fontes/gerar-app-supabase.mjs` | Gera `passivos/index.html` a partir de `fontes/painel.html` (injeta login, runtime Supabase, aba Usuários e o `carteira.js`). |
| `fontes/importar-onboarding.py` | Gera SQL (fora do repo) com os dados dos formulários de onboarding e o índice de documentos da pasta de cada cliente. |
| `fontes/gerar-pagina-cliente.mjs` | Legado: gerava a página fixa `alphamec/` a partir de um snapshot do banco antigo. |
| `alphamec/index.html` | Página fixa do cliente Alphamec (congelada na posição de 07/10/2026). |
| `supabase/migrations/*.sql` | Modelo de dados versionado. Toda alteração de schema entra aqui. |
| `docs/plano-etapa-2.md` | Plano da etapa 2 (modelo de dados, telas, ordem dos PRs). |

## Rodar localmente

```bash
python3 -m http.server 8765        # ou qualquer servidor estático
# abrir http://localhost:8765/  (portal)  e  http://localhost:8765/passivos/  (painel)
```
O login usa o projeto Supabase de produção (chave publicável — pública por design; a RLS é quem protege os dados).

## Alterar o painel

1. Edite `fontes/painel.html` (lógica e layout), `passivos/carteira.js` (timeline/processos) ou `passivos/tarefas.js` (tarefas/horas).
2. Regere: `node fontes/gerar-app-supabase.mjs`
3. Teste localmente e faça commit de **fontes/ + passivos/** juntos.

## Aplicar migrations

As migrations são SQL puro, numeradas. Para aplicar uma nova:

1. Supabase → **SQL Editor** → New query.
2. Cole o conteúdo de `supabase/migrations/NNNN_*.sql` e execute (Run).
3. Todas são idempotentes (`if not exists`, `drop policy if exists`…): rodar duas vezes não quebra.

Nunca altere tabelas/policies pelo painel do Supabase sem registrar a migration correspondente aqui.

Aplicadas até agora: `0001_esquema_inicial`, `0002_pr1_timeline_processos`, `0003_pr2_tarefas_timesheet`, `0004_pr3_dashboard_views`, `0005_pr4_visao_cliente_token`, `0006_pr5_colaboradores`, `0008_pr6_ficha_cliente`, `0010_pr7a_fluxo_pj_negociacoes`, `0012_acessos_sistemas`, `0014_pr7b_publicacoes_djen`, `0015_pr8_base_conhecimento`, `0017_pr8b_documentos_base`, `0020_pr10_cofre_2fa`, `0021_pr10b_contas_escritorio`, `0022_pr11_marketing_pautas`, `0023_pr12_rh`. Cargas 0016 (artigos iniciais) e 0018 (índice do Drive) fora do repo. Cargas de dados (0007, 0009, 0011…) ficam em `supabase/dados/`, fora do repositório.

Validação local antes de enviar: as migrations rodam em sequência num Postgres 16 limpo com stubs de `auth`, `storage` e `cron` (ver histórico do PR 2).

## Usuários e acessos

- Criar usuário: Supabase → Authentication → Users → **Add user** (com *Auto Confirm*). O primeiro usuário vira admin; os demais nascem `pendente`.
- Definir perfil: painel → aba **Usuários** (admin). Para cliente, escolha a empresa. Ao salvar um admin/colaborador, o sistema cria o registro correspondente em `colaboradores`; complete cargo, núcleo e admissão na aba **Equipe**. Quem sai: marque a data de desligamento (vira inativo; o histórico de horas e tarefas fica).
- Cliente logado vê só a própria empresa e só o que está marcado como *visível ao cliente*. Notas internas e a base de acordos nunca saem da equipe (RLS).
- **Link sem login (opcional)**: na página do cliente → "Link do cliente" → Gerar. O link `cliente/?t=TOKEN` mostra a mesma área do cliente (Visão geral · Contratos · Reserva de quitação · Andamento · Processos) lendo a função `painel_por_token`, que entrega só o publicado. Quem tem o link vê; revogue e gere outro quando precisar. Os acessos ficam em `acessos_token`.

## Operação do dia a dia (comandos para o Claude)

- "lance na timeline da Alphamec que fizemos X" → entrada em `entradas_timeline` (interna por padrão; "publique" para o cliente ver).
- "adicione o processo Y ao cliente Z" → linha em `processos`; andamentos entram em `andamentos` e aparecem na timeline.
- "atualiza o painel da Alphamec" → não é mais necessário: a área do cliente (login ou link) lê o banco ao vivo.
- "gera o link da Alphamec" / "revoga o link" → `clientes.acesso_por_token` + `token` (botão "Link do cliente" no painel).
- "atualize a ficha da Alphamec: sócio X, CNPJ Y, história Z" → colunas da ficha em `clientes`, `contatos`, `bens`, `documentos`.
- Acessos do cliente (gov.br, e-CAC, bancos) ficam em `acessos_sistemas` — só equipe, fora de views, BI e área do cliente; senha oculta na tela até clicar "Mostrar". Nunca em `clientes`, notas ou timeline.
- "crie a tarefa X para o cliente Z, prazo dia D, fatal" → linha em `tarefas` (vence em 7/15/30 na aba Tarefas).
- "lance 2 horas de parecer para a Alphamec" → `apontamentos_horas`; horas informadas na timeline já entram sozinhas.
- "abre uma negociação com o Santander para a CL Comércio" → linha em `negociacoes` (kanban: iniciar → extrajudicial → pós-judicialização → minuta → formalizado → pagamento pendente → concluído).
- "avança a etapa do fluxo da Adriana" / "marca que a Lugimar tem dívida em atraso" → `clientes.etapa_fluxo` / `tem_divida_atraso` (marcar dívida em atraso abre sozinho a negociação "Iniciar acompanhamento" + tarefa para o setor de acordos).
- "checado hoje o monitoramento da Via Rios" → `monitoramentos.ultima_checagem` (próxima = amanhã). Cliente novo nasce com tarefas de onboarding, monitoramento e, se tiver dívida em atraso, negociação (gatilho `fluxo_novo_cliente`).
- Acordos: continue usando **Registrar acordo** no card do contrato; o gatilho espelha em `acordos`, cria a entrada "Acordo fechado" na timeline (visível ao cliente) e conclui a negociação daquele contrato.
- Mudanças de estágio (Res. CMN 4.966) são registradas automaticamente toda madrugada (pg_cron `estagios_diario`).
- **DJEN**: o banco busca as publicações da OAB 488.803/SP 3× ao dia em dias úteis (`djen_diario`, 06h/10h/15h) e processa as respostas a cada 10 min (`djen_processar`). Parâmetros em `regras` (id `djen`: oab, uf, dias_retroativos). Para trazer histórico: aba Publicações → "Buscar período…". Se a API bloquear o servidor, a tabela `djen_requisicoes` mostra o erro.

## Power BI / Looker

As views `v_*` (listadas no rodapé do dashboard) são a camada de leitura para BI. Para conectar:

1. Supabase → Project Settings → Database → crie um usuário de leitura (`create role bi login password '…'; grant usage on schema public to bi; grant select on all tables in schema public to bi;`) — **nunca use o `postgres` nem a service key**.
2. No Power BI: *Obter dados → PostgreSQL*, host e porta do Supabase (use o pooler em modo *session*), banco `postgres`, usuário `bi`.
3. Importe só as views `v_*`. O usuário `bi` enxerga tudo (não passa pela RLS), então o BI é de uso interno.

## Publicar

Push na `main` → GitHub Pages publica em 1–2 minutos. A área do cliente é a mesma `passivos/` (o perfil decide o que aparece).
