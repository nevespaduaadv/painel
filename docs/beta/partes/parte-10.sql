-- ESPELHO (beta) — parte final: desligar agendamentos
do $$ declare j record; begin for j in select jobname from cron.job loop perform cron.unschedule(j.jobname); end loop; end $$;
select 'ok espelho' as resultado;
