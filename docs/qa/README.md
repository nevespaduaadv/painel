# QA do Design System

## Verificação obrigatória antes de todo PR
```bash
node fontes/verificar-geracao.mjs --base main
```
Gera as páginas em pasta temporária (nunca sobrescreve `index.html`, `cliente/index.html` nem `beta/`), confere que o versionado é o que o gerador produz (ignorando o carimbo `?v=`), que só o bloco de tokens difere da referência, que os tokens legados mantêm os valores, que nenhum item ou classe de permissão do menu se perdeu (`nav-inventario.json`) e — na Fase 0 — que ninguém consome `--np-*` ainda. A partir da Fase 1, rodar com `--fase1` (libera o uso de `--np-*`).

## Comparação visual (opcional, fora do projeto)
```bash
git archive main | tar -x -C /tmp/np-main
NODE_PATH=<módulos> node docs/qa/comparar-visual.cjs /tmp/np-main 1440
```
Compara a tela de login (sem credenciais) em claro/escuro, neutralizando cursor e animações; a linha `ref×ref` mostra o ruído (deve ser 0) e `ref×atual` a diferença real.

## Capturas com dados (fases com mudança visual)
Só no espelho `/beta/` (Supabase de teste), com dados fictícios ou anonimizados; nunca em produção; nunca anexar capturas com dados de clientes a PR ou relatório.

## Regra de ouro
Chaves `np-*` em `localStorage` controlam só CSS/render e rollout. Acesso é decidido por `PP.temAcesso`, pelas classes `area-*`/`*-only` do gerador e pela RLS do Supabase — nunca por chave.
