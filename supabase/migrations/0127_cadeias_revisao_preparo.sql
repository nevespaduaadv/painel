-- 0127 · Cadeias com revisão da peça, preparo e calendário novo (desenho aprovado pela sócia em 26/11/2026; parte 2)
-- Recursos de 15 dias (apelação, agravo, recurso especial e extraordinário), em dias úteis antes do prazo legal:
--   confeccionar e enviar para revisão −8 · revisar −7 · ajustar −6 · confirmar ajustes −5 · recolher preparo −4 ·
--   protocolar (meta interna) −3 · conferir protocolo −2 · um dia de folga · prazo legal.
-- Demais prazos de 15 dias (sem revisão): confeccionar −6 · protocolar −4 · conferir −3.
-- Prazos de 5 dias: sem mudança (confeccionar −3 · protocolar −2 · conferir −1).
-- Também: aviso diário à controladoria das análises de cabimento que passaram do prazo sem resposta.
-- Só muda a régua dos fluxos; nenhuma tarefa existente é alterada (as cadeias já abertas ficam com as datas que têm). Idempotente.

alter table public.workflows_prazo add column if not exists revisao boolean not null default false;
comment on column public.workflows_prazo.revisao is 'Cadeia com revisão da peça: revisar (confeccionar+1), ajustar (+2) e confirmar os ajustes (+3), por quem está em escritorio(juridico).dados.revisao_pecas_id.';

update public.workflows_prazo set revisao = true, custas = true, confeccionar_offset = -8, protocolar_offset = -3, conferir_offset = -2, updated_at = now()
 where codigo in ('apelacao', 'agravo', 'resp', 're');
update public.workflows_prazo set confeccionar_offset = -6, protocolar_offset = -4, conferir_offset = -3, updated_at = now()
 where dias_legais = 15 and tipo_contagem = 'uteis' and codigo not in ('apelacao', 'agravo', 'resp', 're')
   and confeccionar_offset = -5 and protocolar_offset = -2;   -- só quem ainda está na régua antiga; fluxo ajustado à mão não é tocado

-- tipos de prazo novos (pedido da sócia em 26/11, 20h20). Outros podem ser criados em Gestão → Configurações → Tipos de prazo.
insert into public.workflows_prazo (codigo, nome, dias_legais, dias_internos, confeccionar_offset, protocolar_offset, conferir_offset, custas, revisao, decisao_inicial, ordem) values
 ('agravo_interno',        'Agravo interno',                                   15, 10, -8, -3, -2, false, true,  null, 76),
 ('recurso_inominado',     'Recurso inominado (juizado)',                      10,  6, -7, -2, -1, true,  true,  null, 78),
 ('provas',                'Especificação de provas',                          15, 10, -6, -4, -3, false, false, null, 112),
 ('emenda',                'Emenda à inicial',                                 15, 10, -6, -4, -3, false, false, null, 114),
 ('alegacoes_finais',      'Alegações finais / memoriais',                     15, 10, -6, -4, -3, false, false, null, 116),
 ('laudo',                 'Manifestação sobre laudo pericial',                15, 10, -6, -4, -3, false, false, null, 118),
 ('custas_recolher',       'Recolhimento de custas',                           15, 10, -6, -4, -3, false, false, null, 120),
 ('pagamento_voluntario',  'Pagamento voluntário (cumprimento de sentença)',   15, 10, -6, -4, -3, false, false, null, 122),
 ('cumprimento_iniciar',   'Iniciar cumprimento de sentença',                  15, 10, -6, -4, -3, false, false, null, 124),
 ('pre_executividade',     'Exceção de pré-executividade',                     15, 10, -6, -4, -3, false, false, null, 126),
 ('manifestacao_10',       'Manifestação (10 dias)',                           10,  6, -4, -3, -2, false, false, null, 85)
on conflict (codigo) do nothing;

-- aviso de análise atrasada: uma vez por dia e por tarefa
create table if not exists public.analise_avisos (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  dia date not null default current_date,
  primary key (tarefa_id, dia)
);
alter table public.analise_avisos enable row level security;
revoke all on public.analise_avisos from anon, authenticated;

create or replace function public.analises_avisar_atraso() returns integer language plpgsql security definer set search_path = public as $$
declare confere uuid; r record; n integer := 0;
begin
  select nullif(dados ->> 'conferencia_protocolo_id', '')::uuid into confere from public.escritorio where id = 'juridico';
  if confere is null then return 0; end if;
  for r in select t.id, t.titulo, t.prazo, (select c.nome from public.colaboradores c where c.id = t.responsavel_id) as quem
             from public.tarefas t
            where t.etapa_codigo = 'analise_ato' and t.status in ('aberta', 'em_andamento') and t.prazo < current_date
  loop
    insert into public.analise_avisos (tarefa_id, dia) values (r.id, current_date) on conflict do nothing;
    if found then
      perform public.notificar_colaborador(confere, 'Análise de cabimento atrasada', r.titulo || ' — prazo ' || to_char(r.prazo, 'DD/MM') || coalesce(' · ' || r.quem, ' · sem responsável'), '#tarefas');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.analises_avisar_atraso() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule(jobid) from cron.job where jobname = 'analises_atraso'; exception when others then null; end;
    perform cron.schedule('analises_atraso', '10 11 * * 1-5', $c$select public.analises_avisar_atraso()$c$);   -- 08:10 de Brasília, dias úteis
  end if;
end $$;

select 'ok 0127' as resultado,
       (select count(*) from public.workflows_prazo where revisao) as com_revisao,
       (select count(*) from public.workflows_prazo where dias_legais = 15 and not revisao and confeccionar_offset = -6) as quinze_dias_sem_revisao,
       (select count(*) from public.workflows_prazo where ativo) as tipos_ativos,
       (select count(*) from cron.job where jobname = 'analises_atraso') as agendamento;

-- Reversão: select cron.unschedule(jobid) from cron.job where jobname = 'analises_atraso';
--   update public.workflows_prazo set revisao = false, confeccionar_offset = -5, protocolar_offset = -2, conferir_offset = -1 where dias_legais = 15;
--   drop function public.analises_avisar_atraso(); drop table public.analise_avisos;
