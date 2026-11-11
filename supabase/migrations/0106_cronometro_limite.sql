-- 0106 — Cronômetro esquecido ligado: ao parar com mais de 12h, grava no máximo 8h (o check de apontamentos_horas é 0 < horas <= 24)
-- e anota na descrição para ajuste no timesheet. Antes, estourava o check e impedia concluir a tarefa. Idempotente.
create or replace function public.ts_cronometro_parar(p_descricao text default null, p_descartar boolean default false)
returns public.apontamentos_horas language plpgsql security definer set search_path = public as $$
declare me uuid := public.meu_colaborador(); c public.ts_cronometros; a public.apontamentos_horas; mins numeric;
begin
  select * into c from public.ts_cronometros where colaborador_id = me;
  if c.colaborador_id is null then raise exception 'Nenhum cronômetro rodando.'; end if;
  delete from public.ts_cronometros where colaborador_id = me;
  if p_descartar then return null; end if;
  mins := greatest(5, ceil(extract(epoch from (now() - c.inicio)) / 60 / 5) * 5);
  -- cronômetro esquecido ligado (mais de 12h): grava no máximo 8h e avisa na descrição, para a pessoa ajustar no timesheet
  if mins > 12 * 60 then
    p_descricao := coalesce(p_descricao, c.descricao, '') || ' [cronômetro ficou ligado por ' || round(mins / 60.0, 1) || 'h — horas limitadas a 8h; ajuste se necessário]';
    mins := 8 * 60;
  end if;
  insert into public.apontamentos_horas (colaborador_id, data, horas, inicio, fim, cliente_id, tarefa_id, processo_id, tipo_atividade, descricao, cobravel, created_by)
  values (me, (c.inicio at time zone 'America/Sao_Paulo')::date, round(mins / 60.0, 2), (c.inicio at time zone 'America/Sao_Paulo')::time, (now() at time zone 'America/Sao_Paulo')::time,
          c.cliente_id, c.tarefa_id, c.processo_id, coalesce(c.tipo_atividade, 'outro'), coalesce(p_descricao, c.descricao),
          coalesce((select cobravel_padrao from public.ts_atividades where codigo = c.tipo_atividade), true), auth.uid())
  returning * into a;
  return a;
end $$;
select 'ok 0106' as resultado;
