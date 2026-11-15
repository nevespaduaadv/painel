#!/usr/bin/env bash
# Reconstrói LOCALMENTE (banco descartável) o esquema do Supabase beta para testar migrações antes de aplicá-las.
# Não é o Supabase: auth/storage/cron/net/vault são simulados (00-preambulo-supabase-local.sql). Não usa nenhuma credencial.
# Uso (como root, roda o PostgreSQL com o usuário postgres):
#   docs/qa/sql/reconstruir-beta-local.sh <pasta-bin-do-postgres> <pasta-de-trabalho> <porta> <0107.sql> [migração extra ...]
# Ordem: preâmbulo → docs/beta/esquema-espelho.sql (4 erros conhecidos: pg_net ausente e 3 agendamentos que exigem
# configurar_automacoes) → supabase/migrations/beta/0001–0013 → trilha 0085, 0092, 0093, 0104 → 0107 → perfis de teste
# fictícios → migrações extras (ex.: 0108). Para em qualquer erro fora dos 4 conhecidos.
set -euo pipefail
BIN="$1"; W="$2"; PORT="$3"; M0107="$4"; shift 4
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"; SQLD="$RAIZ/docs/qa/sql"
mkdir -p "$W" && chown postgres "$W"
[ -d "$W/data" ] || su postgres -s /bin/bash -c "$BIN/initdb -D $W/data -U postgres -A trust -E UTF8 --locale=C.UTF-8 >$W/initdb.log 2>&1"
su postgres -s /bin/bash -c "$BIN/pg_ctl -D $W/data -o '-p $PORT -k $W -c listen_addresses=' -l $W/pg.log start" >/dev/null
for i in $(seq 1 30); do psql -h "$W" -p "$PORT" -U postgres -Atc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
P() { psql -h "$W" -p "$PORT" -U postgres -q "$@"; }
P -v ON_ERROR_STOP=1 -f "$SQLD/00-preambulo-supabase-local.sql" >"$W/00.out" 2>"$W/00.err"
P -f "$RAIZ/docs/beta/esquema-espelho.sql" >"$W/espelho.out" 2>"$W/espelho.err" || true
n=$(grep -c ERROR "$W/espelho.err" || true); [ "$n" = 4 ] || { echo "espelho: $n erros (esperados 4)"; grep ERROR "$W/espelho.err" | head; exit 1; }
for f in "$RAIZ"/supabase/migrations/beta/00*.sql; do P -v ON_ERROR_STOP=1 -f "$f" >"$W/$(basename "$f").out" 2>"$W/$(basename "$f").err" || { echo "falhou: $f"; tail -3 "$W/$(basename "$f").err"; exit 1; }; done
for f in 0085_requisicoes_administrativas 0092_protecao_patrimonial_operacional 0093_acesso_protecao 0104_acompanhamento_pj; do
  P -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/migrations/$f.sql" >"$W/$f.out" 2>"$W/$f.err" || { echo "falhou: $f"; tail -3 "$W/$f.err"; exit 1; }; done
P -v ON_ERROR_STOP=1 -f "$M0107" >"$W/0107.out" 2>"$W/0107.err" || { echo "falhou: 0107"; tail -3 "$W/0107.err"; exit 1; }
P -v ON_ERROR_STOP=1 -f "$SQLD/perfis-teste-ficticios.sql" >"$W/perfis.out" 2>"$W/perfis.err"
for m in "$@"; do P -v ON_ERROR_STOP=1 -f "$m" >"$W/$(basename "$m").out" 2>"$W/$(basename "$m").err" || { echo "falhou: $m"; tail -5 "$W/$(basename "$m").err"; exit 1; }; cat "$W/$(basename "$m").out"; done
echo "pronto: $(psql -h "$W" -p "$PORT" -U postgres -Atc 'select version()' | cut -d' ' -f1-2) em $W porta $PORT"
