# Etapa 3 — Ficha do cliente, navegação por áreas e base de conhecimento

Rascunho para aprovação (08/10/2026). Decisões já tomadas pela Maria Júlia: o sistema substitui o Notion (migração gradual, sem perder o Notion enquanto isso); o ADVBox será olhado depois, começando pelos clientes PJ com lançamentos retroativos.

## 1. O que muda, em uma frase por item

1. **"Painel de Passivos" vira "Clientes"**: a entidade central é a ficha do cliente; os passivos bancários passam a ser uma aba dela.
2. **Ficha de abertura (Resumo)**: sócios, CNPJ/CPF, cidade, segmento, faturamento aproximado, "o que aconteceu", situação atual, origem comercial, data de fechamento, responsável — o que closer e onboarding já captam.
3. **Navegação por áreas**: portal com pastas (Jurídico · Comercial · Marketing · Financeiro · Administrativo); painel com 4 itens (Clientes · Prazos · Jurídico · Gestão); breadcrumb com voltar em todas as telas.
4. **Jurídico / base de conhecimento**: artigos editáveis por tema (gestão de passivos, empresa gestora, teses de revisional, Pronampe/FGO/FGI, crédito rural…), com busca, versão e autor; importação inicial do Notion.
5. **Configurações** separadas do dia a dia: regras de projeção, calibração, base de acordos (operacional da Natasha), usuários.

## 2. Modelo de dados (migration 0008)

```sql
-- clientes: campos de ficha (colunas normais; o jsonb 'dados' continua alimentando o motor)
alter table clientes add column
  cnpj text, cpf_titular text, tipo_pessoa text check in ('PJ','PF'),
  cidade text, uf text, segmento text, faturamento_mensal numeric, funcionarios int,
  historia text,              -- "o que aconteceu com a empresa"
  situacao_atual text,        -- fatura ou não, operação ativa, etc.
  origem text,                -- Meta Ads, indicação, orgânico…
  closer text, data_fechamento date, data_onboarding date,
  plano text,                 -- produto contratado (gestão de passivos PJ, superendividamento…)
  status text default 'ativo' check in ('prospect','onboarding','ativo','encerrado');

-- contatos (já existe): ganha cpf, papel (socio/avalista/contador/financeiro), participacao
-- documentos do cliente (Drive): tabela documentos(cliente_id, titulo, url_drive, tipo, data) — link, não cópia
-- base de conhecimento:
conteudos(id uuid, area text, tema text, titulo text, corpo_md text, resumo text, tags text[],
          autor_id → colaboradores, publicado bool, versao int, origem text, id_externo text, carimbos)
conteudos_versoes(conteudo_id, versao, corpo_md, autor_id, created_at)
```
Views: `v_clientes_ficha` (ficha + indicadores: saldo, estágio 3, próximo prazo, último registro) para a lista de clientes e para o BI.

## 3. Telas

**PR 6 — Ficha do cliente**
- Lista de clientes com filtros (status, responsável, cidade, origem) e cartões com saldo/próximo prazo/último registro.
- Aba **Resumo**: bloco de identificação, "história", situação, sócios e contatos, documentos (links do Drive), indicadores.
- Formulário de ficha; importação dos formulários de onboarding em HTML da pasta (um por cliente) para preencher sócios, bens, contratos declarados e observações.
- As abas atuais (Visão geral → **Passivos**, Contratos, Reserva, Timeline, Processos, Tarefas, Notas) continuam.

**PR 7 — Navegação**
- Portal com pastas por área; cada pasta lista seus módulos. Jurídico: Clientes, Prazos, Base de conhecimento. Administrativo: Equipe, Horas, Usuários, Configurações. Comercial/Marketing/Financeiro: vazias por enquanto (placeholders com "em construção" ou links externos).
- Painel com barra enxuta (Clientes · Prazos · Jurídico · Gestão) e breadcrumb (Portal › Clientes › Alphamec › Timeline) com botão voltar.
- Rotas por hash (`#/clientes/alphamec/timeline`) para o voltar do navegador funcionar.

**PR 8 — Base de conhecimento (Jurídico)**
- Lista por tema, busca por texto, página do artigo em Markdown renderizado, edição com histórico de versões, "relacionados".
- Importação inicial: páginas do Notion (via conector Notion, já disponível nesta conta) + conteúdo da skill `gestao-passivos-bancarios` (teses, metodologia de negociação, empresa gestora, crédito rural, Pronampe).
- Link do artigo a partir da ficha do cliente (ex.: estratégia "empresa gestora" aparece como sugestão quando o contrato é Pronampe).

**PR 9 — Retroativo ADVBox (clientes PJ)**
- O ADVBox não tem conector; caminho: exportação CSV/Excel pelo painel do ADVBox (processos, andamentos, tarefas, horas) ou navegação no site pelo navegador do app. Importação com `fonte='advbox'` e `id_externo` (já previstos no schema), sem duplicar o que foi lançado à mão.
- Antes: listar no ADVBox quais clientes PJ têm registros e o período, para decidir o que vale trazer.

## 4. Ordem e esforço
PR 6 (ficha + importação do onboarding) → PR 7 (navegação) → PR 8 (conhecimento + Notion) → PR 9 (ADVBox). Cada um com migration, código e roteiro de teste, como na etapa 2.

## 5. Decisões pendentes para a Maria Júlia
1. Nome das áreas do portal: Jurídico · Comercial · Marketing · Financeiro · Administrativo — confirma?
2. Base de conhecimento: aberta a toda a equipe para editar, ou só Jurídico edita e os demais leem?
3. Quais páginas do Notion entram primeiro (ex.: intranet jurídica, playbooks, onboarding)?
4. ADVBox: você consegue exportar CSV pelo painel deles, ou prefere que eu navegue no site pelo app?
5. Repositório: tornar privado (GitHub Pro) — recomendado antes de importar o Notion.

## 6. Frontend — reforma estrutural no PR 7
- Substituir o esquema "protótipo + gerador por âncoras" por um app único: `app.html`, CSS compartilhado, módulos JS por área (clientes, prazos, jurídico, gestão), roteador por `#`, motor de projeção como módulo puro com testes.
- Componentes únicos (tabela, formulário, modal, pills, KPIs, exportação CSV) em vez de cópias por módulo.
- Área do cliente mobile-first (cards em vez de tabelas largas; link abre no WhatsApp).
- Acabamento: esqueletos de carregamento, estados vazios com instrução, botões de modal contextuais, diálogo de confirmação, busca global, aviso de atualização em tempo real.
- Manter: identidade visual, modo escuro, gráficos SVG sem biblioteca, Supabase + RLS como única fonte.

## 7. Itens adicionados em 08/10 (a validar)
- **Publicações DJEN por OAB** (Edge Function diária → `andamentos` com fonte='djen' → tarefa de prazo + timeline + alerta). Testar a API com a OAB do escritório antes de prometer. Depois: contagem de prazo assistida, modelos de documentos, agenda (Google Calendar), Asaas, monitoramento Escavador/Judit por CNPJ.
- **Cofre de códigos 2FA (TOTP)** dos acessos a PJe/e-SAJ/gov.br: segredo cifrado no banco, cofre por pessoa com compartilhamento explícito e auditoria de consulta. Decisão pendente da Maria Júlia sobre enfraquecimento do 2FA e titularidade dos acessos; alternativa pronta: Bitwarden/1Password.

## 8. PR 7a (08/10) — o que veio do Notion para o sistema

Lido via conector: página "GESTÃO DE PASSIVOS PJ" (Cadastro Central, Contratos e Acordos, Monitoramento PJ, Sócios, Avalistas, Processos). Migration `0010` + carga `supabase/dados/0011_notion_fluxo_pj.sql` (fora do repo).

- **Ficha → Fluxo PJ**: `clientes.etapa_fluxo` (0–10, mesma régua do Notion), `tem_divida_atraso`, `adimplente` (honorários), `possui_processos`, `projeto_reserva`, `regua` (bronze/prata/ouro), `servico`, `tipos_dividas`, `responsavel_onboarding_id`, `notion_url`; status ganha `pausado`. Card "Fluxo PJ" no Resumo com barra de etapas, "Avançar etapa" (registra na timeline) e "Editar fluxo".
- **Negociações** (`negociacoes`, aba própria + sub-aba do cliente): kanban com as 7 etapas da Natasha, temperatura, situação processual, adverso/contato, valores (cobrado, acordo, alçada), prazo, próximo passo, "aguardando". Prazos entram em `v_prazos`. Registrar acordo no contrato conclui a negociação daquele contrato (gatilho).
- **Monitoramento** (`monitoramentos`, aba própria): uma linha por cliente com documentos monitorados (CNPJ/CPFs), status (em monitoramento / nova movimentação / pausado), citado/garantia/avalistas, última e próxima checagem; botão "Checado hoje" (próxima = amanhã).
- **Automação de cliente novo** (`fluxo_novo_cliente`): ao inserir cliente → 2 tarefas de onboarding (núcleo acompanhamento PJ), 1 de monitoramento (jurídico) + linha de monitoramento; se `tem_divida_atraso` (na criação ou depois) → negociação "Iniciar acompanhamento" + tarefa (acordos). Responsável padrão = primeiro colaborador ativo do núcleo (ajuste quando a Equipe estiver cadastrada).
- **Views**: `v_negociacoes`, `v_negociacoes_por_etapa`, `v_monitoramentos`, `v_fluxo_pj` (com alerta de relacionamento pela régua: bronze 3 dias, prata 20, ouro 45), `v_clientes_ficha` ampliada.
- **Carga 0011**: 15 clientes com etapa/flags/resumo do caso/próxima reunião, 28 sócios/avalistas/contatos com CPF e telefone, 14 processos novos (monitoramento), 14 negociações (8 reais da Natasha + 6 "iniciar acompanhamento"), 15 monitoramentos. Fora: Pedro Ivo (lead), Willerson, Chirlaine, Luis Bonadio (PF antigos — não estão no sistema).
- Pendências vistas no Notion: CNPJ do Carlos Mata está errado lá (repete o da Boutique; no sistema ficou o do cartão CNPJ da pasta); M. R. Galera tem 2 cards com "adimplente" diferente (deixado em branco); "Acesso GOV" do Notion **não** foi importado (senhas nunca entram no sistema).

## 9. PR 9 (08/10) — retroativo do ADVBox

Extraído pelo navegador (busca global `/search`, `lawsuits/history/<id>` e `/filter-movements`) e convertido por `supabase/dados/advbox-import.py` em `0013_advbox_retroativo.sql` (fora do repo). 28 processos do ADVBox dos 14 clientes PJ: 15 com número CNJ (criados/vinculados em `processos`, `id_externo = advbox:<id>`), 13 "S/N" (pastas administrativas "Gestão de Passivos PJ" — só o histórico entra, no cliente). Andamentos do tribunal → `andamentos` (movimentação), intimações → `andamentos` (intimação), tarefas pendentes → `tarefas` abertas (núcleo jurídico, responsável pelo nome do ADVBox), tarefas concluídas e mudanças de etapa → `entradas_timeline` (interna, automática). Versões editadas/excluídas e "processo cadastrado" ficam de fora. Tudo interno por padrão; publicar ao cliente é decisão caso a caso.

## 10. PR 7 (08/10) — navegação por áreas, rotas e breadcrumb
- Topo do app: **Clientes** (centro) · **Jurídico ▾** (Tarefas e prazos, Negociações, Monitoramento, Base de acordos, Regras de projeção, Calibração) · **Equipe ▾** (Colaboradores, Horas, Usuários) · **Gestão** (dashboard). O nome da área atual aparece no logo. Menus definidos em `NAV` no `fontes/painel.html`; o gerador injeta os itens dos módulos nos marcadores `/*NAV_JURIDICO*/` e `/*NAV_GRUPOS*/`.
- Rotas no `#`: `#clientes/<id>/<aba>` e `#<area>`; o botão voltar do navegador funciona (pushState/popstate), links do portal abrem direto na área.
- Página do cliente: breadcrumb "Clientes › Empresa › Aba"; no celular a lista some ao abrir um cliente e aparece o botão "← Clientes".
- Portal: azulejos agrupados por área, "Clientes" em destaque; Comercial, Marketing e Financeiro aparecem como "Em breve" (sem página ainda).
- Fica para depois (parte estrutural do §6): app único com módulos e componentes compartilhados, área do cliente mobile-first, esqueletos de carregamento, busca global.

## 11. PR 7½ (08/10) — publicações do DJEN
- Migration `0014`: `pg_net` + `pg_cron`. `djen_solicitar()` enfileira GET em `comunicaapi.pje.jus.br` (OAB/UF em `regras.djen`, filtro `dataDisponibilizacaoInicio/Fim`, 100 por página); `djen_processar()` lê `net._http_response`, grava em `publicacoes` (upsert por id do DJEN, texto sem HTML) e pede a próxima página. Agenda: `djen_diario` 09/13/18 UTC dias úteis (últimos 3 dias, sobreposto), `djen_processar` a cada 10 min.
- Vínculo automático pelo número CNJ (dígitos) → `andamentos` tipo `intimacao` (interno) + tarefa "Analisar publicação" (prazo D+1, prioridade alta, responsável do processo). Processo cadastrado depois puxa as publicações antigas. Sem vínculo → triagem na aba (vincular a processo existente, criar processo no cliente com o número preenchido, ou ignorar).
- Tela: aba Publicações (Jurídico) com KPIs, filtros, leitura em modal com link do tribunal, "Atualizar agora" e "Buscar período…" (histórico, máx. 400 dias por pedido).
- Validado pelo navegador da Maria Júlia: a API aceita os filtros de data (32 publicações entre 01 e 08/10). Risco: a API bloqueou o servidor fora do Brasil; o Supabase fica em São Paulo, mas se bloquear, `djen_requisicoes.erro` mostra e o plano B é uma Edge Function ou rodar a busca pelo navegador.
- Correção de rota: o `#` de um módulo ainda não registrado (antes do login) é preservado até o módulo carregar.

## 12. PR 8 (08/10) — base de conhecimento
- Migration `0015`: `conteudos` (área, tema, título, resumo, corpo em Markdown, tags, publicado, autor, versão, origem/id_externo, tsvector em português mantido por gatilho) + `conteudos_versoes` (versão anterior guardada a cada edição; restaurar pela tela). RLS: equipe lê/edita, admin exclui (provisório até definir quem edita). `conhecimento_buscar(q)` com `websearch_to_tsquery` e trecho destacado.
- Carga `0016` (fora do repo): 4 páginas do Notion (Jurídico, Novos Negócios, Acordos, Pós-Vendas — POPs, scripts, checklists, fluxogramas) + 53 artigos das referências técnicas (teses de defesa, produtos de crédito PJ, negociação e proteção patrimonial, RJ e crédito rural, holding familiar), um artigo por seção. Upsert por `id_externo` só enquanto o artigo está na versão 1 (não sobrescreve edição manual).
- Tela: aba Base de conhecimento (Jurídico) com lista por tema, busca, leitura (marked + sanitização própria + mermaid sob demanda), editor Markdown com pré-visualização, versões e relacionados; rota `#conhecimento/<slug>`.
- Ficou para depois: matriz completa de blindagem (tabela do Notion), páginas Serviços Jurídicos / Procedimentos Internos / Backoffice; sugestão de artigo a partir da ficha do cliente; documentos-base do Drive (ver §13).

## 13. PR 8b (08/10) — documentos base (Drive) na base de conhecimento
- Decisão: **vincular, não copiar**. Os arquivos ficam no Google Drive (pasta JURÍDICO); o sistema guarda um índice (`documentos_base`: título, pasta/caminho, tipo, link, data, tamanho, descrição, tags, destaque, ativo) com busca em português. Equipe lê e edita descrição/tags/destaque e adiciona links à mão; admin remove do índice. Cliente nunca vê.
- Migration `0017`; carga `0018` (fora do repo) gerada por `supabase/dados/documentos-import.py` a partir de `supabase/dados/drive/juridico.json` (mapeamento feito pelo conector do Drive: 415 arquivos + 39 pastas, 32 caminhos; pastas de AULAS/treinamentos entram só como link da pasta). Re-sincronização: gerar e rodar a 0018 de novo (upsert por `drive_id`; o que sumiu do Drive vira `ativo=false`; descrição/tags/destaque editados são preservados).
- Tela: dentro de Base de conhecimento, item "📁 Documentos base (Drive)" na lateral e rota `#conhecimento/documentos`: filtros (texto sem acento, pasta, tipo, só destaques), lista agrupada por pasta com "Abrir pasta" e "Abrir" (nova aba), ★ destaque, editar descrição/tags, "+ Adicionar link". A busca da lateral consulta artigos e documentos (`documentos_base_buscar`).
- Carga pela tela: botão **Importar índice (JSON)** (admin) em Documentos base lê `juridico-indice.json` e faz upsert por `drive_id` em lotes de 100 (novos com tags automáticas; existentes preservam descrição/tags/destaque; ausentes viram `ativo=false`). Alternativa à 0018 quando o SQL Editor não aceita o arquivo.
- Pendente: sincronização automática (hoje é manual, via mim/conector); outras áreas do Drive (Comercial, Financeiro…) quando as abas existirem.

## 14. PR 8c (08/10) — base de conhecimento por área (Comercial, Financeiro, Administrativo)
- Levantamento no Notion: as páginas **Serviços Jurídicos**, **Procedimentos Internos** e **Backoffice** estão vazias (só capa/botão; a base de produtos não tem linhas). O bloco "🔒 Sistema (não editar) / OG - Cultura" é texto genérico do template (missão/visão de "gestão empresarial"), não do escritório — não importado.
- Importadas: **Comercial** (SDR, Closer, Metas e comissionamento — 3 artigos; inclui manual de precificação, NEPQ, cadência pós-proposta, objeções), **Financeiro** (régua e scripts de cobrança, cobrança pelo líder, êxito, indicadores, fluxograma) e **Administrativo** (regras do painel ADM). Carga `0019` (fora do repo), gerada por `conhecimento-import.py --so …`; conversor `notion-conv.py` transforma o markdown do conector (details, tabelas, callouts) em Markdown da base.
- Tela: filtro por **área** na lateral (aparece quando há mais de uma área), temas agrupados com prefixo da área, campo Área no editor. A aba continua no menu Jurídico até existirem as áreas Comercial/Financeiro no portal.
