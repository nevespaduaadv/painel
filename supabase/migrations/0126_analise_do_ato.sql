-- 0126 · Análise do ato antes da cadeia (aprovado pela sócia em 26/11/2026, 19h10)
-- A análise de cabimento passa a ser UMA tarefa por ato (sentença, decisão interlocutória, acórdão), para quem fará a peça.
-- A cadeia (confeccionar → preparo → protocolar → conferir) só nasce quando a análise é concluída, com o caminho escolhido.
-- O que muda no banco:
--   • tarefas.analise (jsonb): hipóteses do ato e, depois, o caminho e o fundamento;
--   • a análise não conclui sem caminho e sem fundamento (vale para a tela e para a API);
--   • a controladoria é avisada quando uma análise é concluída;
--   • fluxos novos: recurso especial e recurso extraordinário;
--   • embargos de declaração, apelação e agravo deixam de abrir uma “análise” própria junto com a cadeia: escolhidos direto,
--     abrem a cadeia de uma vez (é o atalho de quem já analisou). Cadeias antigas em andamento não são tocadas;
--   • quem revisa peças e decisões de não recorrer: escritorio('juridico').dados.revisao_pecas_id (por ora, Maria Júlia).
-- Nenhuma tarefa existente é alterada. Idempotente.

alter table public.tarefas add column if not exists analise jsonb;
comment on column public.tarefas.analise is 'Análise do ato (etapa_codigo = analise_ato): {ato, base, uf, hip:[{wf,rotulo,fim}], caminho, caminho_rotulo, fundamento, decidido_em}. Em aguardar_ed: {planeja, planeja_rotulo, decidido_por_nome, decidido_em}.';

insert into public.workflows_prazo (codigo, nome, dias_legais, dias_internos, confeccionar_offset, custas, decisao_inicial, ordem) values
 ('resp', 'Recurso especial',       15, 10, -5, true, null, 72),
 ('re',   'Recurso extraordinário', 15, 10, -5, true, null, 74)
on conflict (codigo) do nothing;

update public.workflows_prazo set decisao_inicial = null, updated_at = now()
 where codigo in ('ed', 'apelacao', 'agravo') and decisao_inicial is not null;

update public.escritorio e
   set dados = coalesce(e.dados, '{}'::jsonb) || jsonb_build_object('revisao_pecas_id', c.id)
  from (select id from public.colaboradores where coalesce(ativo, true) and perfil_id is not null and lower(public.unaccent(nome)) like 'maria julia%' order by data_admissao nulls last limit 1) c
 where e.id = 'juridico' and (e.dados ->> 'revisao_pecas_id') is null;

-- a análise só conclui com caminho e fundamento
create or replace function public.tarefas_analise_guarda_tg() returns trigger language plpgsql set search_path = public as $$
begin
  if new.etapa_codigo is distinct from 'analise_ato' then return new; end if;
  if new.status = 'concluida' and old.status is distinct from 'concluida' then
    if nullif(btrim(coalesce(new.analise ->> 'caminho', '')), '') is null then
      raise exception 'Para concluir a análise, escolha o caminho.' using errcode = '23514';
    end if;
    if length(btrim(coalesce(new.analise ->> 'fundamento', ''))) < 5 then
      raise exception 'Informe o fundamento da análise.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_analise_guarda on public.tarefas;
create trigger tarefas_analise_guarda before update on public.tarefas for each row execute function public.tarefas_analise_guarda_tg();

-- aviso à controladoria quando a análise é concluída (o aviso nunca impede a conclusão)
create or replace function public.tarefas_analise_aviso_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare confere uuid;
begin
  if new.etapa_codigo = 'analise_ato' and new.status = 'concluida' and old.status is distinct from 'concluida' then
    begin
      select nullif(dados ->> 'conferencia_protocolo_id', '')::uuid into confere from public.escritorio where id = 'juridico';
      if confere is not null and confere is distinct from new.responsavel_id then
        perform public.notificar_colaborador(confere, 'Análise concluída: ' || coalesce(new.analise ->> 'caminho_rotulo', 'caminho definido'), new.titulo, '#tarefas');
      end if;
    exception when others then null;
    end;
  end if;
  return null;
end $$;
drop trigger if exists tarefas_analise_aviso on public.tarefas;
create trigger tarefas_analise_aviso after update on public.tarefas for each row execute function public.tarefas_analise_aviso_tg();

select 'ok 0126' as resultado,
       (select count(*) from public.workflows_prazo where codigo in ('resp', 're')) as fluxos_novos,
       (select count(*) from public.workflows_prazo where decisao_inicial is not null) as com_analise_propria,
       (select (dados ->> 'revisao_pecas_id') is not null from public.escritorio where id = 'juridico') as revisor_definido;

-- Reversão: drop trigger tarefas_analise_guarda on public.tarefas; drop trigger tarefas_analise_aviso on public.tarefas;
--   drop function public.tarefas_analise_guarda_tg(), public.tarefas_analise_aviso_tg();
--   update public.workflows_prazo set decisao_inicial = 'Analisar cabimento de embargos de declaração' where codigo = 'ed'; (idem apelacao, agravo)
--   A coluna tarefas.analise e os fluxos resp/re podem ficar: não afetam nada sozinhos.
