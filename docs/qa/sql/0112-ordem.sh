#!/usr/bin/env bash
# Prova da ordem segura: 0104b (trava) → 0105 → 0112. Esquema equivalente ao beta (trilha 0104/0107/0108, sem 0109/0110).
SP=/tmp/claude-0/-home-claude/87aef90b-33c2-5541-af27-065f5a8fd8e4/scratchpad; R=$SP/repos/wt-0112; Q=$R/docs/qa/sql; M=$SP/qa0105/mig; G=$R/supabase/migrations
V=$1; PORT=$2; if [ "$V" = pg16 ]; then B=/usr/lib/postgresql/16/bin; else B=/var/tmp/pg17-bin/bin; fi; W=/var/tmp/$V-ordem
su postgres -s /bin/bash -c "$B/pg_ctl -D $W/data stop -m fast" >/dev/null 2>&1; rm -rf $W; mkdir -p $W; chown postgres $W
su postgres -s /bin/bash -c "$B/initdb -D $W/data -U postgres -A trust -E UTF8 --locale=C.UTF-8 >$W/initdb.log 2>&1"
su postgres -s /bin/bash -c "$B/pg_ctl -D $W/data -o '-p $PORT -k $W -c listen_addresses=' -l $W/pg.log start" >/dev/null; sleep 3
P(){ psql -h $W -p $PORT -U postgres -q "$@"; }; Q1(){ P -At -c "$1"; }
P -v ON_ERROR_STOP=1 -f $Q/00-preambulo-supabase-local.sql >/dev/null 2>$W/00.err
for f in $(ls $M/0*.sql | sort); do b=$(basename $f); n=${b:0:4}; case $n in 0105|0109|0110) continue;; esac; P -f $f >/dev/null 2>$W/$b.err; done
P -f $Q/perfis-teste-ficticios.sql >/dev/null 2>&1; P -v ON_ERROR_STOP=1 -At -f $Q/0112-preparo.sql | tail -1
est(){ Q1 "select (select count(*) from public.tarefas) || ' tarefas · ' || (select count(*) from public.tarefas where descricao like 'Criada automaticamente pela régua%') || ' automáticas · ' || (select count(*) from cron.job where jobname='regua_tarefas_auto') || ' agendamento · ' || (select count(*) from public.mensagens_fila) || ' mensagens na fila · dados dos clientes ' || (select left(md5(string_agg(md5((to_jsonb(c) - 'cobranca_excluido' - 'cobranca_excluido_motivo' - 'cobranca_excluido_em' - 'cobranca_excluido_por')::text), '' order by id)), 8) || ' (' || count(*) || ')' from public.clientes c)"; }
echo "A0 antes:                              $(est)"
# A) proteção ANTERIOR: trava instalada e confirmada; depois a 0105 SOZINHA (pior caso) e a rotina chamada à mão
P -v ON_ERROR_STOP=1 -At -f $G/0104b_regua_tarefas_trava.sql | tail -1 | tr '|' ' ' | sed 's/^/A1 trava instalada:                    /'
P -v ON_ERROR_STOP=1 -f $M/0105_controle_financeiro.sql >/dev/null 2>$W/a.err; echo "A2 0105 sozinha rc=$? (pior caso):      $(est)"
echo "A4 rotina da 0105 chamada 3x:          devolveu $(Q1 'select public.regua_tarefas_auto()')/$(Q1 'select public.regua_tarefas_auto()')/$(Q1 'select public.regua_tarefas_auto()') :: $(est)"
echo "A5 inserção direta de tarefa da régua: $(Q1 "with i as (insert into public.tarefas (titulo, descricao, cobranca_id, status) select 'x', 'Criada automaticamente pela régua (teste)', id, 'aberta' from public.cobrancas limit 1 returning 1) select count(*) from i") linha(s) gravada(s)"
echo "A6 tarefa manual continua entrando:    $(Q1 "with i as (insert into public.tarefas (titulo, descricao, status) values ('Tarefa manual de teste', 'manual', 'aberta') returning 1) select count(*) from i") linha gravada"
P -v ON_ERROR_STOP=1 -At -f $G/0112_regua_tarefas_ativacao_controlada.sql | tail -1 | tr '|' ' ' | sed 's/^/A7 0112 em seguida:                    /'; echo "A8 final:                              $(est)"
# B) banco novo: a execução proposta — uma transação só, na ordem 0104b → 0105 → 0112
su postgres -s /bin/bash -c "$B/pg_ctl -D $W/data stop -m fast" >/dev/null 2>&1; rm -rf $W/data
su postgres -s /bin/bash -c "$B/initdb -D $W/data -U postgres -A trust -E UTF8 --locale=C.UTF-8 >$W/initdb.log 2>&1"
su postgres -s /bin/bash -c "$B/pg_ctl -D $W/data -o '-p $PORT -k $W -c listen_addresses=' -l $W/pg.log start" >/dev/null; sleep 3
P -v ON_ERROR_STOP=1 -f $Q/00-preambulo-supabase-local.sql >/dev/null 2>$W/00.err
for f in $(ls $M/0*.sql | sort); do b=$(basename $f); n=${b:0:4}; case $n in 0105|0109|0110) continue;; esac; P -f $f >/dev/null 2>$W/$b.err; done
P -f $Q/perfis-teste-ficticios.sql >/dev/null 2>&1; P -v ON_ERROR_STOP=1 -At -f $Q/0112-preparo.sql >/dev/null
echo "B0 antes:                              $(est)"
cat $G/0104b_regua_tarefas_trava.sql $M/0105_controle_financeiro.sql $G/0112_regua_tarefas_ativacao_controlada.sql > $W/inst.sql
# B1: mesma transação, com a rotina chamada no meio e erro provocado no fim → nada fica
{ echo "begin;"; cat $G/0104b_regua_tarefas_trava.sql $M/0105_controle_financeiro.sql; echo "select public.regua_tarefas_auto();"; cat $G/0112_regua_tarefas_ativacao_controlada.sql; echo "do \$\$ begin raise exception 'teste de reversão'; end \$\$;"; echo "commit;"; } > $W/rb.sql
P -f $W/rb.sql >/dev/null 2>$W/rb.err; echo "B1 transação revertida:                $(est) · estruturas da 0105: $(Q1 "select count(*) from information_schema.columns where table_name='cobrancas' and column_name='boleto_enviado_em'") · trava: $(Q1 "select count(*) from pg_trigger where tgname='tarefas_regua_trava'")"
# B2: durante a transação aberta, outra sessão (o pg_cron lê a tabela com outra sessão) não vê o agendamento
( { echo "begin;"; cat $G/0104b_regua_tarefas_trava.sql $M/0105_controle_financeiro.sql; echo "select pg_sleep(4);"; cat $G/0112_regua_tarefas_ativacao_controlada.sql; echo "commit;"; } | P >/dev/null 2>$W/b2.err ) &
sleep 2.5; echo "B2 outra sessão, no meio da transação: agendamento visível = $(Q1 "select count(*) from cron.job where jobname='regua_tarefas_auto'") (dentro da transação ele existe até a 0112 retirar)"; wait
echo "B3 instalada (transação única):        $(est)"
P -1 -v ON_ERROR_STOP=1 -At -f $W/inst.sql > $W/inst2.out 2>$W/inst2.err; echo "B4 segunda execução rc=$?:              $(est) :: $(grep -E '^ok 01' $W/inst2.out | tr '\n' ' ' | tr '|' ' ')"
echo "B5 rotina chamada após instalar:       devolveu $(Q1 'select public.regua_tarefas_auto()') :: $(est)"
P -f $Q/0112-matriz.sql > $W/matriz.txt 2>&1; grep -E "FALHA|ERROR" $W/matriz.txt | head -10; echo "B6 matriz da 0112:                    $(grep -A2 resumo $W/matriz.txt | sed -n 3p)"
