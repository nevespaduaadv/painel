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

## 15. PR 10 (08/10) — cofre de acessos + 2FA (TOTP)
- Migration `0020`: senhas e segredos 2FA saem da tabela `acessos_sistemas` e vão para o **Supabase Vault** (coluna `senha` removida; a auditoria antiga é limpa). Funções: `acesso_senha_definir`, `acesso_senha` (revela/copia), `totp_cadastrar` (chave manual ou URI otpauth; valida base32; sha1/256/512), `totp_codigo` (código + segundos restantes + próximo; o segredo nunca sai do banco), `totp_remover` (admin). Tudo registrado em `acessos_logs` (quem/quando/qual acesso; só admin lê). `totp_calcular` validado contra os vetores da RFC 6238. View `v_acessos_sistemas` sem ids de segredo.
- Tela (ficha › Acessos a sistemas): Mostrar/Copiar senha via função; coluna 2FA com botão **Código** (gera, mostra contagem regressiva, renova até 2 ciclos, clique copia); **Configurar 2FA** com chave manual, leitura de QR por imagem ou câmera (jsQR); admin remove.
- Escopo: só sistemas com autenticador padrão (TOTP). gov.br fica de fora por decisão da Maria Júlia (usa o app próprio).
- Códigos **sempre visíveis** (pedido da Maria Júlia): `totp_janela` devolve atual + próximos 10 códigos com um único registro no log; o widget (`autenticador.js`) avança sozinho a cada período e pede nova janela a cada ~5 min. Aba **Jurídico › Autenticador (2FA)** lista todos os acessos com 2FA da carteira (`v_autenticador`), com busca e link para a ficha; na ficha o widget aparece na própria linha do acesso (⚙ para substituir/remover).

## 16. PR 10b (08/10) — contas do escritório no Autenticador + importação do Google Authenticator
- Esclarecimento da Maria Júlia: os 2FA são de contas **do escritório** (tribunais etc., no nome da advogada), hoje no Google Authenticator — não de clientes. Migration `0021`: `acessos_sistemas.cliente_id` passa a aceitar nulo (= conta do escritório) + coluna `grupo`; views `v_contas_escritorio`, `v_autenticador` (left join) e `v_acessos_sistemas` recriadas.
- Tela Autenticador: cadastro mora aqui (“+ Conta”: sistema, grupo, titular, login, senha no cofre; ao criar, já abre o Configurar 2FA), cards por grupo com código vivo, senha Mostrar/Copiar, editar, ⚙ 2FA; seção separada para acessos de clientes com 2FA (continuam na ficha).
- **Importar do Google Authenticator**: lê o QR de “Transferir contas › Exportar” (formato `otpauth-migration`, protobuf decodificado no navegador), lista as contas (marca HOTP como não suportado e duplicadas), importa as selecionadas num grupo. Helpers de 2FA/QR/senha centralizados em `autenticador.js` (`PP_TOTP`); `ficha.js` delega.

## 17. PR 11 (08/10) — Marketing: pautas de conteúdo com aprovação
- Pedido (áudio da Ana Júlia): calendário onde a social media coloca ideias; as sócias aprovam ou pedem ajuste por botão; o aprovado vira pauta; automatizar o máximo com as skills de marketing; acompanhar de forma visual.
- Migration `0022`: `pautas` (título, ideia/roteiro, formato, canais, pilar, objetivo, data prevista/publicação, responsável, status ideia→em_aprovacao→ajustar/aprovado→em_producao→agendado→publicado/cancelado, links do criativo e publicado, legenda, hashtags, aprovado_por/em, origem manual|ia, métricas) + `pautas_comentarios` (comentário, ajuste, aprovação, status automático). Gatilho `pauta_fluxo`: só admin aprova; registra quem/quando; cada mudança de status vira comentário. Núcleos `marketing` e `rh` liberados em colaboradores/tarefas. Views `v_pautas`, `v_pautas_comentarios`.
- Tela Marketing › Pautas de conteúdo (`passivos/marketing.js`): calendário mensal (clique no dia cria pauta), kanban por status com botões Aprovar/Ajustar nas de "em aprovação" (admin), lista; detalhe com ações de fluxo, comentários em tempo real, pedido de ajuste com texto; formulário completo. Portal e menu "Marketing ▾".
- Próximo (automação): usuário-robô para eu criar pautas como "Ideia" (origem `ia`) por tarefa agendada — ex.: toda segunda, 5 sugestões a partir do radar — e gerar legenda/criativo sob demanda.

## 18. PR 12 (08/10) — RH: ficha do colaborador, dados sensíveis, PDI
- Decisão (Maria Júlia): salário e dados sensíveis só para as sócias (admin); cada colaborador vê a própria ficha básica e o próprio PDI.
- Migration `0023`: `colaboradores` ganha foto_path, apelido, data_nascimento, cidade, linkedin, bio (equipe vê). `colaboradores_rh` (admin): CPF/RG/PIS, estado civil, endereço, contato de emergência, vínculo CLT/PJ/estágio/sócio, jornada, **salário**, benefícios, dados PJ, banco/PIX, documentos (links), observações — auditado. `colaboradores_historico` (admin): admissão, promoção, reajuste (valor), mudança de cargo, férias, feedback formal, advertência, desligamento. `pdi` (metas com prazo, status, progresso; admin edita, o próprio atualiza progresso/status) e `pdi_registros` (1:1, feedback, avaliação, nota; flag "visível para o colaborador"). Bucket privado `fotos` (5 MB, jpeg/png/webp; URL assinada). Views `v_colaboradores` (+pdi_abertos e campos novos) e `v_aniversarios`.
- Tela (`passivos/rh.js`): na Equipe, linha clicável / botão Ficha → ficha com foto (upload redimensionado a 512 px, admin ou o próprio), cabeçalho (cargo, núcleo, tempo de casa, contato, aniversário, bio), KPIs, abas PDI (metas com barra de progresso + acompanhamento) e, para admin, Dados de RH e Histórico. Card "Aniversariantes do mês" na Equipe. Rota `#equipe/<id>`. Formulário de colaborador ganhou apelido, nascimento, cidade, LinkedIn, sobre.

## 19. PR 11b (08/10) — robô de marketing, máquina de ideias e arrastar-e-soltar
- Migration `0024`: papel **`robo`** em perfis (não é equipe: não vê clientes/acessos; só pautas, comentários, pedidos e nomes de colaboradores), `sou_robo()`, políticas (cria pautas só como ideia/ia e altera só as suas ainda em ideia), tabela `marketing_pedidos` (pedidos da equipe ao robô: pendente/atendido/recusado + resposta) e colaborador "Robô de marketing" (núcleo marketing) como responsável das sugestões. Tela Usuários ganhou o papel "Robô".
- Tela: aba **Máquina de ideias** em Marketing (sugestões aguardando triagem com Levar p/ aprovação / Aprovar / Descartar; pedidos ao robô; botão "Pedir ideias ao robô" e "🤖 Pedir ao robô" dentro da pauta).
- `ferramentas/robo-marketing.mjs`: CLI que loga como o robô (ROBO_EMAIL/ROBO_SENHA no ambiente, nunca no repo) — `contexto`, `criar`, `atender`, `comentar`. Usado pelas tarefas agendadas do Claude (segunda: 5 pautas da semana a partir do radar; diário: atender pedidos pendentes).
- **Arrastar e soltar** (`passivos/dnd.js`, mouse e toque) nos kanbans de Pautas (não-admin não solta em "Aprovado"; soltar em "Ajustar" abre o pedido de ajuste) e de Negociações. O seletor de etapa continua como alternativa.

## 20. (08/10) — áreas Comercial, Marketing e Financeiro no portal e no menu
- Base de conhecimento ganhou rota por área: `#conhecimento/area:<comercial|financeiro|marketing|juridico|…>` filtra a lista de temas; `#conhecimento/<slug>` abre o artigo direto.
- Menu do painel: grupos **Comercial** (Base de conhecimento), **Marketing** (Pautas de conteúdo, Base de conhecimento) e **Financeiro** (Base de conhecimento). Item de menu pode apontar para um hash (`hash`) e definir quando está selecionado (`sel`), para o mesmo módulo aparecer em mais de um grupo com filtro diferente.
- Portal (`index.html`): azulejos "Em breve" de Comercial e Financeiro substituídos por "Base de conhecimento (área)".
- Pendente de decisão: permissão de leitura por núcleo (hoje toda a equipe lê todas as áreas).
