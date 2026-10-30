#!/usr/bin/env bash
# Publica o ramo `beta` no espelho: gera beta/ (PP_ESPELHO=1) a partir do ramo beta e copia para a pasta beta/ do ramo main.
# Uso: fontes/publicar-beta.sh "mensagem do commit"
set -euo pipefail
cd "$(dirname "$0")/.."
msg="${1:-Espelho: atualização do beta}"
git checkout -q beta
PP_ESPELHO=1 node fontes/gerar-app-supabase.mjs >/dev/null
rm -rf /tmp/pp-beta-build && cp -r beta /tmp/pp-beta-build
git checkout -q -- beta 2>/dev/null || true; git clean -fdq beta 2>/dev/null || true
git checkout -q main
rm -rf beta && cp -r /tmp/pp-beta-build beta
git add beta && git commit -q -m "$msg

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KKVnz18k6Q6h2PumYNhv3i" || true
git push -q origin main
git checkout -q beta
echo "publicado: https://nevespaduaadv.github.io/painel/beta/"
