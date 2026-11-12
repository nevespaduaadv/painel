#!/usr/bin/env bash
# Publica o ramo `beta` no espelho (/beta/) ABRINDO UM PULL REQUEST para `main` — nunca faz push direto em main
# (main é protegida por ruleset: só entra por PR).
#
# Uso: fontes/publicar-beta.sh "mensagem"
# Pré-requisitos: estar no ramo `beta`, árvore limpa, `gh` autenticado, remoto `origin`.
# O que faz: gera beta/ com PP_ESPELHO=1 a partir do `beta`, cria o ramo `espelho/<data>` a partir de origin/main,
# copia a pasta beta/ gerada, faz commit, push desse ramo e abre o PR. O merge continua manual, no GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:-Espelho: atualização do beta}"

ramo="$(git branch --show-current)"
[[ "$ramo" == "beta" ]] || { echo "erro: execute a partir do ramo 'beta' (atual: '$ramo')" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "erro: árvore de trabalho com alterações não commitadas; faça commit ou stash antes" >&2; exit 1; }
command -v gh >/dev/null || { echo "erro: 'gh' (GitHub CLI) não encontrado" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "erro: 'gh' não autenticado (gh auth login)" >&2; exit 1; }

git fetch -q origin main
PP_ESPELHO=1 node fontes/gerar-app-supabase.mjs >/dev/null
build="$(mktemp -d)"; cp -r beta "$build/beta"
git checkout -q -- beta 2>/dev/null || true; git clean -fdq beta 2>/dev/null || true

novo="espelho/$(date +%Y%m%d-%H%M)"
git checkout -q -b "$novo" origin/main
rm -rf beta && cp -r "$build/beta" beta
git add beta
if git diff --cached --quiet; then
  echo "nada a publicar: beta/ gerado é idêntico ao de main"; git checkout -q beta; git branch -q -D "$novo"; exit 0
fi
git commit -q -m "$msg"
git push -q -u origin "$novo"
gh pr create --base main --head "$novo" --title "$msg" --body "$(cat <<CORPO
Atualização do espelho \`/beta/\` gerada a partir do ramo \`beta\` (PP_ESPELHO=1).

Conferir antes do merge:
- [ ] \`node fontes/verificar-geracao.mjs --base main --fase 1\` passou no ramo \`beta\`
- [ ] nenhum dado real ou chave de serviço em \`beta/\`
CORPO
)"
git checkout -q beta
echo "PR aberto; após o merge: https://nevespaduaadv.github.io/painel/beta/"
