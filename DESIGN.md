# DESIGN.md — Design System Neves Pádua (V3.1, definitivo)

Vale para o sistema interno (`sistema.nevespaduaadvocacia.com.br`), a área do cliente gerada do mesmo fonte e os módulos futuros. Aprovado em 11/11/2026 como direção definitiva. Não é mais exploração: é referência de implementação. Mudanças aqui passam por aprovação das sócias.

Fonte dos tokens: `fontes/tokens.css`. Protótipos de referência (não são código de produção): `motion/previa-v3-1.html`, documentos `claude/exploracao-v3-aplicativo-premium.md` e `claude/v3-1-refinamento-e-validacao.md`.

## 1. Princípios

1. **Aplicativo, não dashboard.** Uma casca só (lateral + barra + área de trabalho); as telas trocam dentro dela sem recarregar a sensação de lugar. Nada de páginas que parecem HTML independente.
2. **Grafite único + papel.** A tinta `--np-ink` é a única cor de interface (botão primário, seleção, foco, régua do ativo). Cor só quando significa algo: vermelho = fatal, vinho = atrasada, âmbar = atenção/hoje, azul = compromisso/fazendo, verde = feito/ok.
3. **A régua diz o estado.** Barra vertical de 2–3 px à esquerda da linha ou do item: é o elemento de identidade. Nunca pílula colorida para estado.
4. **Serifa para o que decide.** EB Garamond em prazos, datas relativas, números de resumo, valores, marcas itálicas e títulos de leitura longa. Estrutura (barra, grupos, painel, navegação) em General Sans.
5. **Linguagem de prazo, não de banco.** "há 29 dias", "amanhã", "em 2 dias · meta", "13 out", "vence hoje". Datas completas só em formulários e no painel.
6. **Feedback no lugar.** O que mudou aparece onde estava: "feita · Desfazer" na própria linha, "Salvo" no botão, aviso no rodapé da lista. Sem toasts flutuantes para ações comuns.
7. **Movimento é continuidade.** Título viaja da linha ao painel; listas reordenam por FLIP; painéis nascem de onde foram chamados. Sem animação decorativa.
8. **Claro é o padrão; escuro é preferência individual** (`pp-tema` em `localStorage`, ou o sistema quando não há escolha). Um só conjunto de componentes, dois valores por token.
9. **Chaves de rollout controlam experiência, nunca acesso.** Permissões continuam no Supabase (RLS) e nas classes `area-*`/`*-only` do gerador.

## 2. Tokens (resumo; valores completos em `fontes/tokens.css`)

| Grupo | Tokens | Nota |
|---|---|---|
| Planos | `--np-side` (lateral) · `--np-bg` (papel) · `--np-surface` (folha) · `--np-surface-2` | quatro planos: lateral tonal → papel → folha com fio → flutuante com sombra |
| Fios | `--np-line` · `--np-line-2` · `--np-ctrl` | `--np-ctrl` para bordas de controle (≥ 3:1) |
| Texto | `--np-text` · `--np-text-2` · `--np-text-3` · `--np-inv` | `--np-text-3` nunca abaixo de 4,5:1 sobre nenhum plano |
| Tinta/seleção | `--np-ink` · `--np-ink-2` · `--np-sel` · `--np-sel-2` · `--np-hover` · `--np-focus` | seleção e hover são alfa da tinta: funcionam nos dois temas |
| Semânticas | `--np-ok` · `--np-att` / `--np-att-s` · `--np-crit` · `--np-late` · `--np-info` (+ `*-bg`) | `--np-att` é texto, `--np-att-s` é régua/marcador |
| Tipo | `--np-display` (serifa) · `--np-ui` · escala `--np-fs-1…7` | 12 / 13 / 14 / 15 / 15,5 / 17 / 20 |
| Forma | `--np-r` 6 · `--np-r-lg` 10 · larguras da casca · `--np-panel-w` 440 · `--np-row-h` 46 | |
| Movimento | `--np-d1…d4` (90/160/240/360) · `--np-e-in/out/move/spring` · `--np-slow` | reduzido: 0/0/80/80 |

Regra: nenhum hex em componente. Valor novo = token novo neste arquivo, com justificativa.

## 3. Tipografia

| Papel | Família | Tamanho / peso | Onde |
|---|---|---|---|
| Título da barra | UI | 15 / 600 | `.bar h1` |
| Título da linha | UI | 14 / 500, quebra em 2 linhas antes de truncar | `.it .t` |
| Secundário da linha | UI | 13 / 400; cliente em `--np-text-2` 500 | `.it .m` |
| Prazo / data relativa | Serifa | 15,5 / 400 + complemento UI 12,5 | `.it .q` |
| Marca | Serifa itálica | 13,5 | *fatal*, *fazendo*, *quente*, *reserva formada* |
| Número de resumo | Serifa | 20 / 500, tabular | `.resumo b` |
| Valor monetário | Serifa | 14,5–17 / 400, tabular, `R$ 143.000` sem centavos na lista | `.val`, `.kv2 .v` |
| Grupo / seção | UI | 12,5–13 / 600, tracking 1 % | `.grp h3`, `.sec h3`, grupos da árvore |
| Navegação | UI | 14 / 400 (ativo 500); subnível 13,5 | `.tree` |
| Título do painel | UI | 17 / 600 | `.painel h2` |
| Leitura longa (KB, relatórios) | Serifa nos títulos | 21+ | fora da casca de listas |
| Mínimo | — | **12 px** | `kbd`, contadores, iniciais |

Line-height 1,45 no corpo; 1,35 em linhas de lista; 1,1–1,15 em números grandes. Sem caixa alta com tracking em rótulos. Sem acentuar uma palavra do título com cor.

## 4. Casca e navegação

- **Lateral** 244 px (`--np-side`), rolagem própria com desvanecimento nas pontas. Cabeçalho (monograma em tinta + nome), busca/paleta, botão **único em tinta** ("Nova tarefa" / ação primária do módulo), árvore, pessoa logada no rodapé.
- **Árvore**: itens fixos sem grupo (Hoje, Tarefas e prazos, Agenda, Avisos); grupos expansíveis (Clientes, Jurídico, Financeiro, Equipe e gestão, Ferramentas) com chevron que gira; subnível por recuo de 15 px + guia de 1 px, sem ícone. Ícones (16 px, traço 1,6, monocromáticos) nos fixos, nos grupos e em destinos fortes. Contador só onde a contagem orienta ação.
- **Ativo**: preenchimento `--np-sel` + régua grafite de 3 px à esquerda (subnível: guia vira grafite). Grupo do ativo aberto por padrão; estado de cada grupo lembrado.
- **Trilho** 56 px (recolhido): ícones, contador em pastilha, dica de texto após 220 ms; grupo abre **flyout** por clique/Enter/Espaço — nasce colado ao trilho, repete ícone + nome do grupo na altura do botão, item ativo com régua, ↑/↓, Esc devolve o foco.
- **Larguras**: ≥ 1180 árvore (recolhível em trilho, lembrado); 901–1179 trilho automático, expansão por cima; ≤ 900 gaveta de 272 px. (Fase 1 alinhou o corte da gaveta ao breakpoint já existente do grid `.app` da V2, 900 px, em vez dos 760 px do protótipo — evita duas grades convivendo; 768 em retrato fica em gaveta.)
- **Barra** 48 px, sticky, com desfoque leve: menu (celular) · trilha "Grupo / Módulo" · espaço · alternador Lista/Quadro · Atualizar · tema. **Faixa de ferramentas** 38 px: resumo em serifa à esquerda, filtros tipográficos à direita (escopo exclusivo | fio | atributos cumulativos).
- **Permissões** continuam no gerador (`cls` por item); grupo sem item visível não renderiza.

### 4.1 Implementação (Fase 1 — `fontes/casca.css` + `passivos/casca.js`)
- **Chave de rollout**: `localStorage["np-casca"]==="v3"` → `html.np-casca-v3` definida no `<head>` (âncora `<!--CASCA_BOOT-->` do gerador). Sem a chave, nada da V3.1 renderiza; a casca V2 (`#sb`, `#nav`, `renderNav`, `header.top`) continua intacta. Alternância pela pessoa em **Meu perfil → Navegação** (card `.np-pref`), nunca por hash. **No espelho `/beta/`** (mesma origem do sistema principal, mesmo `localStorage`) as chaves da casca levam sufixo `-beta` (`np-casca-beta`, `np-trilho-beta`, `np-grupos-beta`; boot gerado com `PP_ESPELHO=1` e `casca.js` detectando `body[data-espelho]`), para que testar a V3.1 no beta não mude a navegação de ninguém em produção; `pp-tema` continua compartilhado de propósito.
- **Uma casca por vez**: com V3 ativa, `#sb[data-casca="v2"]` recebe `display:none`, `inert` e `aria-hidden`; sem a chave, `#np-side[data-casca="v3"]` fica `hidden inert`. Não há controles duplicados no DOM acessível.
- **Árvore derivada do `NAV` real**: `casca.js` envolve `renderNav()` (chama a original primeiro) e monta `#np-tree` a partir de `NAV`/`PP_HUBS.HUBS`, reaproveitando os botões `.tab[data-tab]` e as classes de permissão (`area-*`, `*-only`). Filhos de hub só entram no modelo quando `PP.temAcesso(tab) === true` (**falha fechada**: função ausente ou com erro esconde o item — a casca nunca libera nada por conta própria); item restrito não é renderizado (não existe na árvore, no flyout nem na árvore de acessibilidade). `hidden` vence qualquer `display` da casca. Grupo sem filho visível não aparece. Rotas e `aplicarHash` não mudam.
- **Cabeçalho reaproveitado**: a barra V3.1 é a própria `header.top` reestilizada; `#btnSb`, `#brandArea`, `#busca`/`#buscaGlobal` (atalho `/`), `#btnTema` (`pp-tema`), `#viewClient`, `#userbox` continuam os mesmos nós. A trilha `#np-trilha` é inserida antes de `#brandArea`.
- **Trilho/gaveta** reutilizam estados existentes: `sb-aberta` + `.sb-overlay` (≤ 900), `np-expandida` (901–1179), `np-trilho` (≥ 1180, lembrado em `localStorage["np-trilho"]`). Larguras via `--sbw` (`--np-side-w` / `--np-rail-w`).
- **Ícones**: `casca.js` tem um mapa próprio (`I_TAB`) só para destinos que o `ICONES` global não cobre (Avisos, Cobranças, Contratos e faturamento, Estoque, Inventário, Ponto, Requisições, Espelho, Importar do ADVBox, Configurações, Meu perfil); nada muda na V2.
- **Toque** (`pointer:coarse` ou `hover:none`): todo alvo da casca com 44 px (itens, grupos, flyout, trilho 44×44, barra); em ≤ 600 px a busca recolhe a um botão de 44 px e expande ao receber foco.
- **Semântica**: `#np-tree` é `<nav aria-label="Módulos">` com listas (`ul.np-lista > li > button`), **sem** `tablist`/`tab` (o menu tem grupos expansíveis e leva a páginas, não alterna painéis); o destino atual leva `aria-current="page"` (único); grupo = botão com `aria-expanded` + `aria-controls` apontando para a lista, estado visual em `data-aberto`, corpo fechado `inert`; `#np-fly` é um segundo `<nav>`. O `itemNav()` da V2 continua gerando os botões (`role=tab`/`aria-selected` ficam só na V2); a casca apenas troca os atributos — comportamento e teclado inalterados.
- **Clientes** fica item fixo na Fase 1. O protótipo V3.1 previa o grupo Clientes → Carteira / Em onboarding, mas hoje não existe rota nem vista de "Em onboarding" (o status é um campo da ficha; `ROTAS` só tem `clientes[/id[/sub]]`). Criar o grupo agora exigiria inventar destino. O modelo da casca já suporta grupos por configuração: quando a Fase 3 (Acompanhamento PJ transversal) entregar a vista/rota real, Clientes vira grupo com Carteira (lista atual) e Em onboarding (vista nova), sem mudar a casca.
- **Modo token** (área do cliente): `NAV=[]`, sem `casca.css`, sem boot, sem `casca.js`.

### 4.2 Componentes implementados (Fase 2 — `passivos/np-ui.js` + `fontes/np-ui.css`)
Biblioteca `NPUI` (módulo `core`, só apresentação, sem Supabase, sem estado global; CSS escopado em `html.np-casca-v3`, injetado na âncora `/*NP_UI*/`, ausente no modo token). Primeiro consumidor: **Tarefas e prazos** (`renderTarefasV3` em `tarefas.js`, ativo com a mesma chave da casca; o render V2 e todas as funções de ação continuam intactos).
- `toolbar({resumo, filtros, filtrosFixos, direita})` 38 px, sticky sob a barra; `resumo([{n,label,tom}])` em serifa (`role=status`); `chip({label,n,on})` com `aria-pressed`; `sepv()`; `seg(opções, valor, onChange)`. Reflui por **container query** (`#view-tarefas` é `container-type:inline-size`): até 1080 px de largura da área os filtros descem para a 2ª linha; ≤ 600 px o resumo quebra em linhas. Chips rolam horizontalmente; `filtrosFixos` ("Mais filtros") nunca sai da vista.
- `grupo({id,titulo,n,tom,aberto,onToggle,itens})`: `section` + botão com `aria-expanded`/`aria-controls`, corpo `inert` quando fechado, altura por `grid-template-rows`.
- `linha({regua,check,prazo,titulo,contexto,direita,atual,onOpen,onTecla})`: `li` em `ul[role=list]`; régua `fatal` (vermelho cheio) / `late` (2 px a 55 %) / `att` (âmbar); check com `aria-label`; **prazo exato sempre** (coluna em serifa "9 nov" + hora "23h59"; `title` com "09/11/2026 às 23:59 · há 3 dias"); o relativo ("há 3 dias", "hoje", "em 2 dias") fica no contexto e nunca substitui a data; título é um `button` (Enter abre); `aria-current="true"` na linha aberta.
- `marca(texto, tom)` itálica em serifa: *alta*, *fatal*, *fazendo*, *aguardando Financeiro há 2d*, *feita*, *cancelada* — nunca pílula colorida.
- `quem(nome)`: iniciais + primeiro nome ("Maria"/"Ana"/"João" mantêm dois nomes).
- `painel({obra,label,onClose})` → `abrir({id,trilha,titulo,corpo,pe,origem,foco})`/`fechar()`: **split 440 px** (≥ 1180, sticky), **overlay 480 px** (981–1179), **tela cheia** (≤ 980, `role=dialog aria-modal`); foco vai ao Fechar (ou ao campo pedido) e volta à origem; Esc fecha (popover antes do painel); View Transition do título (nome `np-titulo`, sem duplicidade) com fallback.
- `props`, `secao`, `passos` (histórico/cadeia: `ok`/`on`/`cancelada`), `pop(anchor, itens|form, {role:"menu"|"dialog", refoco})` com ↑/↓/Esc e um só aberto, `feito(li, {texto, acao})`, `faixaErro`, `vazio`, `carregando`, `rodape(texto, legenda)`, `flip`, `vt` (ignora chamada enquanto outra transição corre), `pref.get/set` (sufixo `-beta` no espelho).
- Tarefas V3.1: filtros são atalhos para o **mesmo `T.f`** da V2 (Abertas/Feitas/Todas = status; Fatais; Cadeias [novo, só client-side]; Minhas = responsável eu; até 3 núcleos; "Mais filtros" com status completo, responsável, núcleo, cliente, tickets); quadro com as **4 colunas e regras da V2** + "Mover para…" por popover/teclado; painel com as mesmas ações (Concluir exige andamento ou registro prévio; Feito; Passar; Editar/reagendar com motivo; ticket; horas; dossiê; Reabrir; Abrir em janela); **sem "desfazer"**: concluída vira faixa "feita · Reabrir" (fluxo de reabertura existente), mantida por 10 min mesmo após recarga; toasts só para erro; atalho `c` na linha focada abre o painel com foco no andamento e **não dispara dentro de campos/modais**; Horas e Tarefas do cliente permanecem na V2 nesta fase.

- **QA**: `docs/qa/casca-lab.cjs` (navegação real com dados fictícios, sem Supabase) + `node fontes/verificar-geracao.mjs --base main --fase 1`.

## 5. Componentes

| Componente | Anatomia | Estados |
|---|---|---|
| **Linha** `.it` | régua · ação/estado 22 px (check ou vazio) · prazo 68 px (serifa) · texto flexível (título + marcas / secundário) · coluna direita (pessoa + ações, ou valor + pessoa) · 46 px, 48 no toque | hover `--np-hover`; selecionada `--np-sel` + régua grafite; régua fatal 3 px `--np-crit`, atrasada 2 px `--np-late`, hoje `--np-att-s` |
| **Grupo** `.grp` | título 13/600 + contagem + chevron; corpo abre por `grid-template-rows`; fechado = `inert` | tom crítico / atenção no título |
| **Marca** `.marca` | serifa itálica 13,5 | cores só semânticas |
| **Resumo** `.resumo` | número serifa 20 + rótulo 13,5 | crítico / atenção / neutro |
| **Filtro** `.chipf` | 30 px, 13,5; escopo exclusivo à esquerda, atributos cumulativos após fio | pressionado `--np-sel` + 500 |
| **Check** | 18 px (22 no toque), borda `--np-ctrl`, área de 44 px; concluir = pulso + traço que se desenha | — |
| **Indicador de etapa** `.etapa` / **cadeia** `.cadeia` | pontos (ciclo, etapa) × quadrados (cadeia de prazo) | ok / atual / aguardando |
| **Valor** `.val` | serifa tabular, "cobrado → acordo", sublinha com % e alçada | só exibe % quando acordo e cobrado existem |
| **Painel** `.painel` | folha 440 px, cantos 10, sticky; trilha + h2; corpo = `props` (104 px + valor) + seções; rodapé fixo com até 3 ações | split ≥ 1180; overlay 480 com véu < 1180; tela cheia ≤ 760 |
| **Props / kv2** | pares rótulo-valor; kv2 = grade 2×2 com número em serifa | — |
| **Ciclo** `.ciclo` | 5 passos horizontais com data | ok / atual |
| **Tabela compacta** `.tab` | 13,5; número em serifa à direita, `nowrap` | — |
| **Passos** `.passos` | linha vertical com pontos; histórico, atas, pendências, cadeia | ok / atual / aguardando |
| **Popover** `.pop` | 236 px, item atual marcado, letras de atalho | — |
| **Feita · Desfazer** `.feito` | substitui a linha; fio verde de 6 s; Desfazer devolve | — |
| **Paleta** | `/` e `Ctrl K`; tipos: navegar, cliente, negociação, tarefa, filtro, ação | — |
| **Botões** | primário = tinta; secundário = folha com fio; fantasma = sem fio; 30 px (36 no toque) | salvando (giro), salvo (verde) |
| **Formulários** | `modal()` atual, estilizado com os tokens; label visível, validação no blur, erro junto ao campo | — |
| **Estados** | vazio: título + ação ("Nada com esses filtros · Limpar"); carregando: `aria-busy` + esmaecimento, espaço reservado; erro: o que fazer | — |

## 6. Motion Design System (regras vigentes)

1. Só `transform` e `opacity`; altura por `grid-template-rows 0fr↔1fr`; a **única exceção** é `grid-template-columns` da casca (recolher/expandir).
2. Durações: micro 90 · entrada 160 · padrão 240 · espacial 360. Saída mais curta que entrada.
3. Curvas: chegada (`--np-e-in`), saída, mover, mola (casca e painel).
4. Continuidade: View Transitions com `view-transition-name: titulo-ativo` só na **primeira abertura e no fechamento** do painel; navegar entre linhas com o painel aberto só desliza o corpo 6 px.
5. Listas reordenam por FLIP (360 ms); itens novos aparecem por opacidade.
6. Flyout e popover: `translate(-10px) scaleX(.94)` → identidade, origem no elemento que os chamou.
7. Dica de texto com atraso de 220 ms. Troca de tema **sem** transição.
8. `prefers-reduced-motion`: 0/0/80/80 ms, só opacidade e cor; View Transitions e FLIP desligados; fio de tempo some (prazo do Desfazer mantido).
9. Fallbacks: sem `startViewTransition` → troca direta.

## 7. Acessibilidade e toque

Contraste ≥ 4,5:1 texto e ≥ 3:1 componentes nos dois temas (medido no DOM). Foco visível com anel duplo em tudo. Botão só-ícone com `aria-label`; grupos fechados `inert`; popover com `aria-haspopup`/`aria-expanded`; Esc fecha na ordem paleta → popover → flyout → gaveta → painel; o foco volta à origem. Teclado: Enter/Espaço abre, ↑/↓ troca no painel, C conclui (tarefas). Toque (`hover:none`): alvos ≥ 44 px, ações de linha sempre visíveis, botões 36–40 px.

## 8. Regras de dados e cálculo na interface

- Percentuais de desconto só quando `valor_cobrado` e `valor_acordo` existem; nunca presumidos.
- Honorários de êxito e alçada vêm do registro (`percentual_exito`, `alcada_autorizada`) e do contrato aplicável; a interface não aplica percentual fixo.
- Datas relativas calculadas no fuso de Brasília (regra já usada em `hojeISO`).
- O que não existe no banco não aparece como se existisse; em prévias, leva a etiqueta "sugestão"; em produção, não aparece.

## 9. Governança

- Toda tela nova parte dos componentes da seção 5; componente novo é proposto aqui antes de entrar.
- Toda alteração visual passa por: captura em 375/768/1024/1440 × claro/escuro, medição de contraste, teclado, `prefers-reduced-motion`, perfil de teste `teste.juridico@…`.
- Versões: V1 → V2 → V2.1 → V2.2 → V3 → **V3.1 (vigente)**. Histórico em `claude/motion-design-system-neves-padua.md` e documentos seguintes.
