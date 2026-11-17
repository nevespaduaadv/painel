#!/usr/bin/env bash
SP=/tmp/claude-0/-home-claude/87aef90b-33c2-5541-af27-065f5a8fd8e4/scratchpad; R=$SP/repos/wt-cargos; Q=$R/docs/qa/sql; QB=$SP/repos/wt-0112/docs/qa/sql; M=$SP/qa0105/mig
V=$1; PORT=$2; if [ "$V" = pg16 ]; then B=/usr/lib/postgresql/16/bin; else B=/var/tmp/pg17-bin/bin; fi; W=/var/tmp/$V-0113
su postgres -s /bin/bash -c "$B/pg_ctl -D $W/data stop -m fast" >/dev/null 2>&1; rm -rf $W; mkdir -p $W; chown postgres $W
su postgres -s /bin/bash -c "$B/initdb -D $W/data -U postgres -A trust -E UTF8 --locale=C.UTF-8 >$W/initdb.log 2>&1"
su postgres -s /bin/bash -c "$B/pg_ctl -D $W/data -o '-p $PORT -k $W -c listen_addresses=' -l $W/pg.log start" >/dev/null; sleep 3
P(){ psql -h $W -p $PORT -U postgres -q "$@"; }
P -v ON_ERROR_STOP=1 -f $QB/00-preambulo-supabase-local.sql >/dev/null 2>$W/00.err
for f in $(ls $M/0*.sql | sort); do b=$(basename $f); n=${b:0:4}; case $n in 0105|0109|0110) continue;; esac; P -f $f >/dev/null 2>$W/$b.err; done
P -f $SP/repos/wt-0111/supabase/migrations/0111_exclusao_clientes_bens.sql >/dev/null 2>$W/0111.err
P -At -f $Q/0113-preparo.sql 2>&1 | tail -1
P -1 -v ON_ERROR_STOP=1 -At -f $R/supabase/migrations/0113_cargos_funcionais.sql 2>$W/0113.err | tail -1; grep -m3 -A3 ERROR $W/0113.err
P -1 -v ON_ERROR_STOP=1 -At -f $R/supabase/migrations/0113_cargos_funcionais.sql 2>$W/0113b.err | tail -1 | sed 's/^/2ª execução: /'; grep -m3 -A3 ERROR $W/0113b.err
P -At -f $Q/0113-matriz.sql 2>&1 | grep -v "^SET\|^RESET\|^$\|NOTICE" 
