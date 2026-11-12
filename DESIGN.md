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
- **Larguras**: ≥ 1440 árvore (recolhível, lembrado); 1180–1439 árvore que recolhe ao abrir o painel se faltar espaço; 761–1179 trilho automático, expansão por cima; ≤ 760 gaveta de 272 px.
- **Barra** 48 px, sticky, com desfoque leve: menu (celular) · trilha "Grupo / Módulo" · espaço · alternador Lista/Quadro · Atualizar · tema. **Faixa de ferramentas** 38 px: resumo em serifa à esquerda, filtros tipográficos à direita (escopo exclusivo | fio | atributos cumulativos).
- **Permissões** continuam no gerador (`cls` por item); grupo sem item visível não renderiza.

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
