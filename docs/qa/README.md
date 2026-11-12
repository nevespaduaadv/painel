# QA do Design System

## Verificação obrigatória antes de todo PR
```bash
node fontes/verificar-geracao.mjs --base main --fase <0|1>
```
Nunca altera arquivos versionados: o gerador roda numa cópia temporária e o inventário do menu só é gravado com `--gravar-inventario` (faça isso de propósito, em um commit próprio, e revise o diff do JSON).

| Código | O que confere | Fases |
|---|---|---|
| G1 | gerador roda nos modos normal e espelho, em pasta temporária | todas |
| G2 | `index.html` e `cliente/index.html` versionados == gerados (ignorando `?v=`) | todas |
| G3 | só chave publicável nas saídas; nenhuma chave de serviço; modo token carrega só os módulos do cliente (`carteira.js`, `ficha.js`) | todas |
| N1 | menu gerado == `docs/qa/nav-inventario.json` | todas |
| N2 | nenhum item/grupo da referência perdido; nenhuma classe de permissão alterada | todas (com `--base`) |
| N3 | conjunto de classes de permissão inalterado | todas (com `--base`) |
| T1 | tokens legados com os mesmos valores em `fontes/tokens.css` | todas (com `--base`) |
| F0.1 | saídas idênticas à referência **fora do bloco de tokens** (estrito) | só Fase 0 |
| F0.2 | nenhum consumidor de `--np-*` | só Fase 0 |

A partir da Fase 1 (`--fase 1`), mudanças de frontend são esperadas: F0.* não rodam; G*, N* e T1 continuam segurando regressões de geração, navegação, permissões e tokens. Mudanças intencionais de menu entram com `--gravar-inventario` e explicação no PR. Na Fase 1 o inventário não muda: a V3.1 reorganiza a apresentação, não o `NAV`.

## Laboratório da casca (Fase 1+)
```bash
NODE_PATH=<módulos> node docs/qa/casca-lab.cjs
```
Playwright com Chromium local: serve o repositório, **intercepta toda chamada a `*.supabase.co`** e responde com fixtures fictícias (perfis `admin` e `colaborador` do Jurídico, 3 clientes inventados) — nenhuma requisição sai da máquina e nada é escrito. Para cada perfil: (1) compara os **destinos efetivos** (itens `.tab[data-tab]` visíveis + abas de hub a que `PP.temAcesso` dá acesso) entre V2 e V3.1 — têm de ser conjuntos iguais; (2) navega por todos os itens da árvore V3.1 e confere módulo aberto, item ativo e título; (3) exercita trilho, flyout, teclado (`/`, ↑/↓, Esc), tema, grupos, `inert` da casca inativa e o card de Meu perfil; (4) 375/768/1024/1440 nos dois temas, com capturas em `/tmp/casca-lab/`; (5) movimento reduzido; (6) **itens sem acesso**: estilo computado, ordem de Tab e snapshot ARIA sem nenhum destino restrito, `hidden` vencendo o `display`, e **falha simulada** de `PP.temAcesso` (erro e ausência) sem liberar nada; (7) ordem de foco (lateral de cima para baixo → barra da esquerda para a direita → conteúdo), Enter/Espaço, anel de foco, Esc na gaveta; (8) **contraste** ≥ 4,5:1 nos textos da casca (dois temas) e **alvos de toque** ≥ 44 px em celular e tablet (`pointer:coarse`); (9) **persistência** de V2/V3.1, trilho e grupos entre recarregamentos; (10) **modo token** da área do cliente com `np-casca=v3` no mesmo navegador; (11) **espelho `/beta/`** gerado na hora com `PP_ESPELHO=1`: `np-casca=v3` do principal não liga a V3.1 no beta, ligar no beta grava só `np-casca-beta`/`np-trilho-beta`, e `pp-tema` segue compartilhado. O repositório é servido por um servidor HTTP local efêmero (só 127.0.0.1) — em `file://` o Chromium perde gravações de `localStorage` feitas logo antes de um reload. Qualquer linha `FALHA` bloqueia o PR; linhas `obs` são registradas no relatório.

## Laboratório de Tarefas e prazos V3.1 (Fase 2+)
```bash
NODE_PATH=<módulos> node docs/qa/tarefas-lab.cjs
```
Mesma infraestrutura do laboratório da casca (HTTP local, Supabase interceptado, fixtures fictícias com 14 tarefas: fatal atrasada, cadeia, hoje com hora, fazendo, feita, cancelada, sem prazo). Verifica: (1) **paridade de dados** V2 × V3.1 — 11 combinações de filtro × 2 perfis, mesmo conjunto de tarefas; (2) resumo = KPIs da V2, prazo exato + relativo, régua e marcas, grupos na ordem das FAIXAS; nenhuma escrita durante a renderização; (3) **paridade de ações** — Concluir gera a mesma sequência da V2 (PATCH `tarefas` + POST `tarefa_eventos`), Passar/Editar abrem os modais existentes, check marca/desmarca como na V2, faixa "feita · Reabrir"; (4) chips alteram o mesmo `T.f`; "Mais filtros" com os 6 status; (5) quadro com as 4 colunas e regras da V2, "Mover para…" por teclado; (6) escopo restrito e `readOnly`; (7) ARIA (listas, `aria-pressed`, `aria-expanded`, sem `tab/tablist`), Enter/Esc/`c`, atalho inerte em campos, anel de foco; (8) contraste ≥ 4,5:1 (2 temas) e alvos ≥ 44 px (375/1024), painel cheia/overlay; (9) persistência de grupos e V2 intacta sem a chave; movimento reduzido. Capturas em `/tmp/tarefas-lab/`.

## Comparação visual (opcional, fora do projeto)
```bash
git archive main | tar -x -C /tmp/np-main
NODE_PATH=<módulos> node docs/qa/comparar-visual.cjs /tmp/np-main 1440 2
```
Tela de login, claro/escuro, com cursor/animações neutralizados e **espera pelas fontes** (`document.fonts.check`); `ref×ref` mede o ruído (deve ser 0) e `ref×atual` a diferença real. Rodadas sem fontes carregadas são marcadas inconclusivas em vez de contadas.

## Capturas com dados (fases com mudança visual)
Só no espelho `/beta/` (Supabase de teste), com dados fictícios ou anonimizados; nunca em produção; nunca anexar capturas com dados de clientes a PR ou relatório. **Não usar `fontes/publicar-beta.sh` sem autorização expressa: ele também faz push em `main`.**

## Regra de ouro
Chaves `np-*` em `localStorage` controlam só CSS/render e rollout. Acesso é decidido por `PP.temAcesso`, pelas classes `area-*`/`*-only` do gerador e pela RLS do Supabase — nunca por chave.
