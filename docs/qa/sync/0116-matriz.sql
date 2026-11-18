-- 0116 · matriz (banco limpo, depois da 0114-matriz, da 0115 e da 0116). Só dados fictícios.
\set ON_ERROR_STOP 0
\set adm a0000000-0000-0000-0000-0000000000b1
\set jur a0000000-0000-0000-0000-0000000000b2
create table if not exists public._r16 (n serial, caso text, ok boolean); grant all on public._r16 to authenticated; grant usage on sequence public._r16_n_seq to authenticated;
create or replace function public._c16(p_caso text, p_ok boolean) returns void language sql security definer as $$ insert into public._r16 (caso, ok) values (p_caso, coalesce(p_ok, false)) $$; grant execute on function public._c16(text, boolean) to authenticated;
reset role; select public._como14(null);
delete from public.publicacoes where id between 920001 and 920010;
select public.djen_gravar(format('{"id": %s, "data_disponibilizacao": "%s", "siglaTribunal": "TJSP", "nomeOrgao": "Vara Fictícia", "tipoComunicacao": "Intimação", "tipoDocumento": "Despacho", "numeroprocessocommascara": "%s", "texto": "<p>Texto fictício %s.</p>"}', i, d, np, i)::jsonb)
  from (values (920001, '2026-10-01', '7777777-77.2026.8.26.0001'), (920002, '2026-11-15', '7777777-77.2026.8.26.0002'), (920003, '2026-11-16', '7777777-77.2026.8.26.0003'), (920004, '2026-11-17', '7777777-77.2026.8.26.0004'), (920005, '2026-10-10', '1111111-11.2026.8.26.0100'), (920006, '2026-10-11', '7777777-77.2026.8.26.0006'), (920007, '2026-10-12', '7777777-77.2026.8.26.0007')) v(i, d, np);
update public.publicacoes set ignorada = true where id = 920006;
select public._como14(:'jur'); set role authenticated; select public.publicacao_tratar(920007, 'ciencia', 'Ciente'); reset role; select public._como14(null);
create table public._f16 as select id, md5(row(texto, data_disponibilizacao, tribunal, orgao, numero_processo, processo_id, cliente_id, tarefa_id, lida, ignorada, providencia)::text) h from public.publicacoes where id between 920001 and 920010;
select count(*) as t0 from public.tarefas \gset
select (select tarefa_id is not null from public.publicacoes where id = 920005) as tem_tarefa \gset
select public._como14(:'jur'); set role authenticated;
select public._c16('01 quem não é administradora não vê a prévia nem classifica (42501)', public._t14($$select public.publicacoes_externo_previa('2026-11-16')$$) = '42501' and public._t14($$select public.publicacoes_externo_classificar('2026-11-16', 'Acompanhadas no ADVBox')$$) = '42501');
select public._c16('02 a pessoa não marca a classificação direto pela API (42501)', public._t14($$update public.publicacoes set acompanhamento_externo = 'advbox' where id = 920001$$) = '42501');
reset role; select public._como14(:'adm'); set role authenticated;
select public.publicacoes_externo_previa('2026-11-16') as pv \gset
select public._c16('03 prévia não altera nada e conta: entram só as pendentes anteriores ao corte e sem tarefa; as de 16/11 em diante ficam', (:'pv'::jsonb ->> 'entram')::int >= 2 and (:'pv'::jsonb ->> 'ficam_na_analise_a_partir_do_corte')::int >= 2 and (select count(*) = 0 from public.publicacoes where acompanhamento_externo is not null));
select public._c16('04 sem fundamento é recusado (22023); quantidade diferente da prévia é recusada e nada muda (40001)', public._t14($$select public.publicacoes_externo_classificar('2026-11-16', 'curto')$$) = '22023' and public._t14($$select public.publicacoes_externo_classificar('2026-11-16', 'Acompanhadas no ADVBox', false, 99999)$$) = '40001' and (select count(*) = 0 from public.publicacoes where acompanhamento_externo is not null));
select public.publicacoes_externo_classificar('2026-11-16', 'Publicações anteriores a 16/11 acompanhadas no ADVBox', false, (:'pv'::jsonb ->> 'entram')::int) ->> 'lote' as lote \gset
reset role; select public._como14(null);
select public._c16('05 classificadas: 920001 (antiga) e 920002 (15/11); NÃO classificadas: 920003 (16/11), 920004 (17/11), a ignorada, a já tratada e a que tem tarefa',
  (select bool_and(acompanhamento_externo = 'advbox') from public.publicacoes where id in (920001, 920002)) and (select bool_and(acompanhamento_externo is null) from public.publicacoes where id in (920003, 920004, 920006, 920007))
  and (not :'tem_tarefa'::boolean or (select acompanhamento_externo is null from public.publicacoes where id = 920005)));
select public._c16('06 nada além da classificação mudou: texto, datas, tribunal, processo, cliente, tarefa, lida, ignorada e PROVIDÊNCIA idênticos', (select count(*) = 0 from public.publicacoes p join public._f16 f on f.id = p.id where f.h <> md5(row(p.texto, p.data_disponibilizacao, p.tribunal, p.orgao, p.numero_processo, p.processo_id, p.cliente_id, p.tarefa_id, p.lida, p.ignorada, p.providencia)::text)) and (select providencia is null and not lida from public.publicacoes where id = 920001));
select public._c16('07 nenhuma tarefa criada ou alterada', (select count(*) = :t0 from public.tarefas));
select public._c16('08 lote registrado (quantidade, corte, fundamento, quem, quando); histórico em cada publicação; auditoria', (select quantidade = (:'pv'::jsonb ->> 'entram')::int and corte = date '2026-11-16' and criado_por = :'adm' and revertido_em is null from public.publicacao_lotes_externos where id = :'lote') and (select count(*) = 1 from public.publicacao_historico where publicacao_id = 920001 and acao = 'acompanhamento_externo') and exists (select 1 from public.auditoria where acao = 'CLASSIFICACAO_EM_LOTE' and registro = :'lote'));
select public._como14(:'jur'); set role authenticated;
select public._c16('09 a publicação classificada continua podendo ser vinculada e devolvida à análise pelo Jurídico, com motivo', public._t14($$select public.publicacao_externo_devolver(920002, '')$$) = '22023' and public._t14($$select public.publicacao_externo_devolver(920002, 'Processo do escritório, será cadastrado')$$) = '00000');
select public._c16('10 quem não é administradora não reverte o lote (42501)', public._t14(format($$select public.publicacoes_externo_reverter(%L, 'tentativa de reversão')$$, :'lote')) = '42501');
reset role; select public._como14(:'adm'); set role authenticated;
select public._c16('11 segunda classificação com o mesmo corte não pega de novo o que já foi classificado; a devolvida entra de novo só se a administradora repetir', (select (public.publicacoes_externo_previa('2026-11-16') ->> 'entram')::int = 1));
select public._c16('12 reversão exige motivo; reverte exatamente o lote; segunda reversão é recusada', public._t14(format($$select public.publicacoes_externo_reverter(%L, 'x')$$, :'lote')) = '22023' and public._t14(format($$select public.publicacoes_externo_reverter(%L, 'Classificação feita com corte errado')$$, :'lote')) = '00000' and public._t14(format($$select public.publicacoes_externo_reverter(%L, 'Classificação feita com corte errado')$$, :'lote')) = 'P0002');
reset role; select public._como14(null);
select public._c16('13 depois da reversão: nenhuma classificada; publicações idênticas às do início; lote marcado como revertido, com quem e motivo; histórico guarda ida e volta', (select count(*) = 0 from public.publicacoes where acompanhamento_externo is not null)
  and (select count(*) = 0 from public.publicacoes p join public._f16 f on f.id = p.id where f.h <> md5(row(p.texto, p.data_disponibilizacao, p.tribunal, p.orgao, p.numero_processo, p.processo_id, p.cliente_id, p.tarefa_id, p.lida, p.ignorada, p.providencia)::text))
  and (select revertido_em is not null and revertido_por = :'adm' and revertidas >= 1 from public.publicacao_lotes_externos where id = :'lote') and (select count(*) = 2 from public.publicacao_historico where publicacao_id = 920001 and acao like 'acompanhamento_externo%'));
-- com tarefa: incluída de propósito, deixa de travar a tarefa (0115)
select public._como14(:'adm'); set role authenticated;
select public.publicacoes_externo_classificar('2026-11-16', 'Incluindo as que têm tarefa, por decisão das sócias', true) ->> 'lote' as lote2 \gset
reset role; select public._como14(null);
select tarefa_id as tt from public.publicacoes where id = 920005 \gset
select public._c16('14 incluída de propósito, a publicação com tarefa é classificada e fica PENDENTE DE CONCILIAÇÃO; a tarefa não é concluída nem cancelada e a 0115 continua travando; a providência continua vazia', not :'tem_tarefa'::boolean or ((select acompanhamento_externo = 'advbox' and acompanhamento_externo_conciliar and providencia is null from public.publicacoes where id = 920005) and (select n = 1 from public.tarefa_pendencias_analise(:'tt')) and (select status in ('aberta', 'em_andamento') from public.tarefas where id = :'tt')));
select public._como14(:'jur'); set role authenticated;
select public._c16('15 a tarefa com publicação em conciliação continua não podendo ser concluída pela pessoa (23514)', not :'tem_tarefa'::boolean or public._t14(format($$update public.tarefas set status = 'concluida' where id = %L$$, :'tt')) = '23514');
select public._c16('16 conciliação individual: exige nota; registra no histórico; não é providência (a tarefa continua travada)', not :'tem_tarefa'::boolean or (public._t14($$select public.publicacao_externo_conciliada(920005, '')$$) = '22023' and public._t14($$select public.publicacao_externo_conciliada(920005, 'Conferido no ADVBox: prazo controlado lá')$$) = '00000'));
reset role; select public._como14(null);
select public._c16('16b conferência: conciliada, sem providência; a 0115 segue travando; as sem tarefa não ficam pendentes de conciliação', not :'tem_tarefa'::boolean or ((select not acompanhamento_externo_conciliar and providencia is null and acompanhamento_externo = 'advbox' from public.publicacoes where id = 920005) and (select n = 1 from public.tarefa_pendencias_analise(:'tt')) and (select count(*) = 0 from public.publicacoes where acompanhamento_externo_conciliar and tarefa_id is null)));
select case when ok then 'ok    ' else 'FALHA ' end || caso from public._r16 order by n;
select count(*) filter (where ok) || ' de ' || count(*) || ' casos conformes (0116)' from public._r16;
