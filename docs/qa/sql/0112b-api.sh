#!/usr/bin/env bash
# 0112b · testes pela API REAL (PostgREST 12 sobre o banco local com a 0112b e a matriz executada). Só dados fictícios.
# Uso: 0112b-api.sh <diretório do socket do PostgreSQL> <porta> <binário do postgrest>
set -u
W=$1; PGPORT=$2; PGRST=${3:-postgrest}; AP=3112; SEG="segredo-ficticio-de-teste-com-mais-de-32-caracteres"
P(){ psql -h "$W" -p "$PGPORT" -U postgres -q -At "$@"; }
P -c "create or replace function auth.uid() returns uuid language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid \$\$" \
  -c "grant anon, authenticated to authenticator" -c "grant usage on schema public to anon, authenticated" >/dev/null 2>&1
printf 'db-uri = "postgres://authenticator@/postgres?host=%s&port=%s"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "%s"\nserver-port = %s\n' "$W" "$PGPORT" "$SEG" "$AP" > "$W/pgrst12.conf"
"$PGRST" "$W/pgrst12.conf" >"$W/pgrst12.log" 2>&1 & PID=$!; sleep 4
tok(){ python3 - "$1" "$SEG" <<'PY'
import sys, json, hmac, hashlib, base64, time
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
h = b(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); p = b(json.dumps({"role": "authenticated", "sub": sys.argv[1], "exp": int(time.time()) + 3600}).encode())
print((h + b'.' + p + b'.' + b(hmac.new(sys.argv[2].encode(), h + b'.' + p, hashlib.sha256).digest())).decode())
PY
}
ADM=$(tok a0000000-0000-0000-0000-0000000000a1); ANA=$(tok a0000000-0000-0000-0000-0000000000a2)
cANA=c0000000-0000-0000-0000-0000000000a2
C(){ local m=$1 t=$2 u=$3 d=${4:-}; local a=(-s -o "$W/r12.out" -w '%{http_code}' -X "$m" "http://127.0.0.1:$AP$u" -H 'Content-Type: application/json' -H 'Prefer: return=representation'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-d "$d"); echo "$(curl "${a[@]}")|$(tr -d '\n' < "$W/r12.out" | cut -c1-300)"; }
N=0; F=0; ok(){ N=$((N+1)); if [ "$2" = 1 ]; then echo "ok    API $1  [$3]"; else F=$((F+1)); echo "FALHA API $1  [$3]"; fi; }
st(){ echo "${1%%|*}"; }
R=$(C PATCH "$ANA" "/colaboradores?id=eq.$cANA" '{"frente":"estrategico"}'); R2=$(C POST "$ANA" /rpc/edita_protecao '{}')
ok "01 PATCH da própria frente → 403; edita_protecao continua falsa" "$([ "$(st "$R")" = 403 ] && [ "${R2#*|}" = false ] && echo 1 || echo 0)" "http $(st "$R") · ${R2#*|}"
R=$(C PATCH "$ANA" "/colaboradores?id=eq.$cANA" '{"nucleo":"acompanhamento_pj"}'); ok "02 PATCH do próprio núcleo → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C PATCH "$ANA" "/colaboradores?id=eq.$cANA" '{"ativo":false}'); ok "03 PATCH da própria situação → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C PATCH "$ANA" "/colaboradores?id=eq.$cANA&select=id" '{"responsabilidades":"texto fictício pela API"}'); ok "04 PATCH de campo comum da própria ficha → 200" "$([ "$(st "$R")" = 200 ] && echo 1 || echo 0)" "$(st "$R")"
BEM=$(P -c "select id from public.bens limit 1")
if [ -n "$BEM" ]; then R=$(C PATCH "$ANA" "/bens?id=eq.$BEM&select=id" '{"protecao":"em_protecao"}'); R3=$(P -c "select coalesce(protecao,'exposto') from public.bens where id='$BEM'"); ok "05 sem a frente, não altera a proteção de um bem" "$([ "$R3" != em_protecao ] && echo 1 || echo 0)" "http $(st "$R") · bem $R3"; fi
R=$(C PATCH "$ADM" "/colaboradores?id=eq.$cANA&select=id" '{"frente":"estrategico"}'); R2=$(C POST "$ANA" /rpc/edita_protecao '{}')
ok "06 a administradora muda a frente: 200, e o mesmo token da colaboradora passa a ter a permissão" "$([ "$(st "$R")" = 200 ] && [ "${R2#*|}" = true ] && echo 1 || echo 0)" "http $(st "$R") · ${R2#*|}"
R=$(C PATCH "$ADM" "/colaboradores?id=eq.$cANA&select=id" '{"frente":null}'); R2=$(C POST "$ANA" /rpc/edita_protecao '{}')
ok "07 a administradora retira a frente: o mesmo token perde a permissão" "$([ "$(st "$R")" = 200 ] && [ "${R2#*|}" = false ] && echo 1 || echo 0)" "http $(st "$R") · ${R2#*|}"
R=$(C PATCH "" "/colaboradores?id=eq.$cANA" '{"frente":"estrategico"}'); ok "08 sem login: nada muda" "$([ "$(st "$R")" != 200 ] || [ "${R#*|}" = "[]" ] && echo 1 || echo 0)" "$(st "$R")"
kill $PID 2>/dev/null; echo "API: $((N-F)) de $N conformes"
