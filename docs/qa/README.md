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

A partir da Fase 1 (`--fase 1`), mudanças de frontend são esperadas: F0.* não rodam; G*, N* e T1 continuam segurando regressões de geração, navegação, permissões e tokens. Mudanças intencionais de menu entram com `--gravar-inventario` e explicação no PR.

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
