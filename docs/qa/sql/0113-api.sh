#!/usr/bin/env bash
# 0113 · testes pela API REAL (PostgREST 12 sobre o banco local já com a 0113 e a matriz executada). Só dados fictícios.
# Uso: 0113-api.sh <diretório do socket do PostgreSQL> <porta do PostgreSQL> <binário do postgrest>
# O que prova: a recusa acontece no BANCO, por HTTP, com o token da própria pessoa — independentemente do que a tela mostra ou esconde.
set -u
W=$1; PGPORT=$2; PGRST=${3:-postgrest}; AP=3113; SEG="segredo-ficticio-de-teste-com-mais-de-32-caracteres"
P(){ psql -h "$W" -p "$PGPORT" -U postgres -q -At "$@"; }
# auth.uid() como no Supabase real: aceita o formato novo de claims (request.jwt.claims) e o legado
P -c "create or replace function auth.uid() returns uuid language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid \$\$" \
  -c "grant anon, authenticated to authenticator" -c "grant usage on schema public to anon, authenticated" >/dev/null 2>&1
cat > "$W/pgrst.conf" <<EOF
db-uri = "postgres://authenticator@/postgres?host=$W&port=$PGPORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SEG"
server-port = $AP
EOF
pkill -f "postgrest $W/pgrst.conf" 2>/dev/null; "$PGRST" "$W/pgrst.conf" >"$W/pgrst.log" 2>&1 & PID=$!; sleep 4
tok(){ python3 - "$1" "$SEG" <<'PY'
import sys, json, hmac, hashlib, base64, time
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
h = b(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()); p = b(json.dumps({"role": "authenticated", "sub": sys.argv[1], "exp": int(time.time()) + 3600}).encode())
print((h + b'.' + p + b'.' + b(hmac.new(sys.argv[2].encode(), h + b'.' + p, hashlib.sha256).digest())).decode())
PY
}
ADM=$(tok a0000000-0000-0000-0000-000000000001); CAIO=$(tok a0000000-0000-0000-0000-000000000004); TST=$(tok a0000000-0000-0000-0000-000000000007); DORA=$(tok a0000000-0000-0000-0000-000000000005)
cCAIO=c0000000-0000-0000-0000-000000000004; cTST=c0000000-0000-0000-0000-000000000007; cBIA=c0000000-0000-0000-0000-000000000003
# chamada: metodo token caminho [corpo]  →  "status|corpo"
C(){ local m=$1 t=$2 u=$3 d=${4:-}; local a=(-s -o "$W/r.out" -w '%{http_code}' -X "$m" "http://127.0.0.1:$AP$u" -H 'Content-Type: application/json' -H 'Prefer: return=representation'); [ -n "$t" ] && a+=(-H "Authorization: Bearer $t"); [ -n "$d" ] && a+=(-d "$d"); echo "$(curl "${a[@]}")|$(tr -d '\n' < "$W/r.out" | cut -c1-300)"; }
N=0; F=0
ok(){ N=$((N+1)); if [ "$2" = 1 ]; then echo "ok    API $1  [$3]"; else F=$((F+1)); echo "FALHA API $1  [$3]"; fi; }
st(){ echo "${1%%|*}"; }; tem(){ case "$1" in *"$2"*) echo 1;; *) echo 0;; esac; }
CG(){ P -c "select id from public.cargos where codigo = '$1'"; }
PJ=$(CG responsavel_acompanhamento_pj); FIN=$(CG responsavel_financeiro)

R=$(C POST "$CAIO" /rpc/cargo_designar "{\"p_cargo\":\"$PJ\",\"p_colab\":\"$cCAIO\",\"p_tipo\":\"titular\",\"p_motivo\":\"eu mesmo\"}")
ok "01 colaborador se designa a um cargo com proteção → 403 (42501)" "$([ "$(st "$R")" = 403 ] && tem "$R" 42501)" "$(st "$R")"
R=$(C POST "$CAIO" /rpc/cargo_salvar '{"p_id":null,"p_codigo":"meu_cargo","p_nome":"Meu cargo","p_nucleo":"socios","p_frente":null,"p_acessos":["financeiro","protecao"]}')
ok "02 colaborador cria cargo com acessos sensíveis → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C POST "$CAIO" /cargo_ocupacoes "{\"cargo_id\":\"$FIN\",\"colaborador_id\":\"$cCAIO\"}")
ok "03 colaborador grava a própria ocupação direto na tabela → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C PATCH "$CAIO" "/cargos?codigo=eq.responsavel_acordos" '{"acessos":["clientes","juridico","financeiro","protecao"]}')
ok "04 colaborador amplia os acessos do próprio cargo → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C PATCH "$CAIO" "/perfis?id=eq.a0000000-0000-0000-0000-000000000004" '{"papel":"admin"}'); R2=$(P -c "select papel from public.perfis where id='a0000000-0000-0000-0000-000000000004'")
ok "05 colaborador tenta virar administradora pelo cadastro → papel continua colaborador" "$([ "$R2" = colaborador ] && echo 1 || echo 0)" "http $(st "$R") · papel $R2"
R=$(C PATCH "$CAIO" "/perfis?id=eq.a0000000-0000-0000-0000-000000000004" '{"acessos":["financeiro","protecao","equipe"]}'); R2=$(P -c "select array_to_string(acessos, ',') from public.perfis where id='a0000000-0000-0000-0000-000000000004'")
ok "06 colaborador tenta ampliar os próprios acessos → inalterados" "$(tem "x$R2" financeiro | sed 's/1/x/;s/0/1/;s/x/0/')" "http $(st "$R") · $R2"
R=$(C PATCH "$CAIO" "/colaboradores?id=eq.$cCAIO" '{"nucleo":"socios","frente":"estrategico"}')
ok "07 colaborador (gerido por cargo) troca o próprio núcleo e frente → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C PATCH "$TST" "/colaboradores?id=eq.$cTST" '{"frente":"estrategico"}'); R2=$(C POST "$TST" /rpc/edita_protecao '{}')
ok "08 a falha original, pela API: pessoa no modelo antigo troca a própria frente para ganhar proteção → 403; edita_protecao continua falsa" "$([ "$(st "$R")" = 403 ] && [ "${R2#*|}" = false ] && echo 1 || echo 0)" "http $(st "$R") · edita_protecao ${R2#*|}"
R=$(C PATCH "$TST" "/colaboradores?id=eq.$cTST" '{"nucleo":"acompanhamento_pj"}')
ok "09 idem com o núcleo → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C POST "$CAIO" /rpc/cargo_encerrar "{\"p_ocupacao\":\"$(P -c "select id from public.cargo_ocupacoes where fim is null and colaborador_id='$cBIA' limit 1")\",\"p_motivo\":\"tirando a colega\"}")
ok "10 colaborador encerra a ocupação de outra pessoa → 403" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C POST "" /rpc/cargo_designar "{\"p_cargo\":\"$PJ\",\"p_colab\":\"$cCAIO\"}")
ok "11 sem login: função de gestão inacessível" "$([ "$(st "$R")" != 200 ] && [ "$(st "$R")" != 204 ] && echo 1 || echo 0)" "$(st "$R")"
R=$(C GET "" "/cargo_ocupacoes?select=id"); ok "12 sem login: ocupações não são legíveis" "$([ "$(st "$R")" != 200 ] || [ "${R#*|}" = "[]" ] && echo 1 || echo 0)" "$(st "$R")"
# concessão e revogação com o MESMO token (sessão já autenticada)
R0=$(C POST "$CAIO" /rpc/edita_protecao '{}')
R=$(C POST "$ADM" /rpc/cargo_designar "{\"p_cargo\":\"$PJ\",\"p_colab\":\"$cCAIO\",\"p_tipo\":\"titular\",\"p_motivo\":\"assume o Acompanhamento PJ (teste API)\"}"); OC=$(echo "${R#*|}" | tr -d '"')
R1=$(C POST "$CAIO" /rpc/edita_protecao '{}')
ok "13 a administradora designa o cargo: o MESMO token passa a ter a permissão, sem novo login" "$([ "${R0#*|}" = false ] && [ "$(st "$R")" = 200 ] && [ "${R1#*|}" = true ] && echo 1 || echo 0)" "antes ${R0#*|} · designar $(st "$R") · depois ${R1#*|}"
BEM=$(P -c "select id from public.bens limit 1")
R=$(C PATCH "$CAIO" "/bens?id=eq.$BEM&select=protecao" '{"protecao":"em_protecao"}'); ok "14 com o cargo, altera a proteção de um bem pela API" "$([ "$(st "$R")" = 200 ] && tem "$R" em_protecao)" "$(st "$R")"
R=$(C POST "$ADM" /rpc/cargo_encerrar "{\"p_ocupacao\":\"$OC\",\"p_motivo\":\"cargo retirado (teste API)\"}"); R2=$(C POST "$CAIO" /rpc/edita_protecao '{}')
R3=$(C PATCH "$CAIO" "/bens?id=eq.$BEM" '{"protecao":"protegido"}'); R4=$(P -c "select protecao from public.bens where id='$BEM'")
ok "15 cargo retirado: o MESMO token perde a permissão na chamada seguinte; a alteração de proteção é recusada" "$([ "$(st "$R")" = 204 ] && [ "${R2#*|}" = false ] && [ "$R4" = em_protecao ] && echo 1 || echo 0)" "encerrar $(st "$R") · edita_protecao ${R2#*|} · tentativa $(st "$R3") · bem $R4"
R=$(C GET "$CAIO" "/v_cargos_divergencias?select=nome"); ok "16 fonte única: nenhuma divergência entre acessos gravados e cargos ativos" "$([ "${R#*|}" = "[]" ] && echo 1 || echo 0)" "$(st "$R") ${R#*|}"
R=$(C POST "$DORA" /rpc/cargo_designar "{\"p_cargo\":\"$PJ\",\"p_colab\":\"c0000000-0000-0000-0000-000000000005\"}")
ok "17 colaboradora desligada, com token ainda válido, não se designa" "$([ "$(st "$R")" = 403 ] && echo 1 || echo 0)" "$(st "$R")"
kill $PID 2>/dev/null
echo "API: $((N-F)) de $N conformes"
