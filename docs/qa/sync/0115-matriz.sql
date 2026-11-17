-- 0115 · matriz (roda depois da 0114-matriz: reaproveita os usuários e o processo fictícios). Só dados fictícios.
\set ON_ERROR_STOP 0
\set jur a0000000-0000-0000-0000-0000000000b2
create table if not exists public._r15 (n serial, caso text, ok boolean); grant all on public._r15 to authenticated; grant usage on sequence public._r15_n_seq to authenticated;
create or replace function public._c15(p_caso text, p_ok boolean) returns void language sql security definer as $$ insert into public._r15 (caso, ok) values (p_caso, coalesce(p_ok, false)) $$;
grant execute on function public._c15(text, boolean) to authenticated;
reset role; select public._como14(null);
select public.djen_gravar('{"id": 910001, "data_disponibilizacao": "2026-11-14", "siglaTribunal": "TJSP", "nomeOrgao": "1ª Vara Cível", "tipoComunicacao": "Intimação", "tipoDocumento": "Despacho", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "<p>Especifiquem as partes as provas.</p>"}'::jsonb);
select public.djen_gravar('{"id": 910002, "data_disponibilizacao": "2026-11-14", "siglaTribunal": "TJSP", "nomeOrgao": "1ª Vara Cível", "tipoComunicacao": "Intimação", "tipoDocumento": "Decisão", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "<p>Indefiro a tutela. Intime-se.</p>"}'::jsonb);
select tarefa_id as ta from public.publicacoes where id = 910001 \gset
select public._c15('01 duas intimações do mesmo processo e do mesmo dia: são DUAS publicações, cada uma com a sua análise, na mesma tarefa',
  (select count(*) = 2 and count(distinct tarefa_id) = 1 and bool_and(providencia is null) from public.publicacoes where id in (910001, 910002)));
insert into public.tarefas (id, titulo, nucleo, status, prioridade) values ('e0000000-0000-0000-0000-000000000015', 'Tarefa comum fictícia', 'juridico', 'aberta', 1);
select public._como14(:'jur'); set role authenticated;
select public._c15('02 concluir a tarefa com as duas sem análise é recusado (23514)', public._t14(format($$update public.tarefas set status = 'concluida' where id = %L$$, :'ta')) = '23514');
select public._c15('03 marcar como LIDA não libera: ler não é tratar', public._t14($$update public.publicacoes set lida = true where id in (910001, 910002)$$) = '00000'
  and public._t14(format($$update public.tarefas set status = 'concluida' where id = %L$$, :'ta')) = '23514');
select public._c15('04 tratada só UMA das duas: a tarefa continua sem poder ser concluída', public._t14($$select public.publicacao_tratar(910001, 'nada_a_fazer', 'Sem providência')$$) = '00000'
  and public._t14(format($$update public.tarefas set status = 'concluida' where id = %L$$, :'ta')) = '23514');
select public._c15('05 tratada a segunda: agora conclui', public._t14($$select public.publicacao_tratar(910002, 'ciencia', 'Ciente')$$) = '00000'
  and public._t14(format($$update public.tarefas set status = 'concluida' where id = %L$$, :'ta')) = '00000');
select public._c15('06 tarefa sem publicação conclui normalmente', public._t14($$update public.tarefas set status = 'concluida' where id = 'e0000000-0000-0000-0000-000000000015'$$) = '00000');
reset role; select public._como14(null);
select public._c15('07 conferência: a tarefa ficou concluída; "lida" e "providência" são registros separados; o histórico guarda quem tratou cada uma',
  (select status = 'concluida' from public.tarefas where id = :'ta')
  and (select count(*) = 2 from public.publicacoes where id in (910001, 910002) and lida and providencia is not null and tratada_por = :'jur')
  and (select count(distinct publicacao_id) = 2 from public.publicacao_historico where publicacao_id in (910001, 910002) and acao = 'tratada'));
select public.djen_gravar('{"id": 910003, "data_disponibilizacao": "2026-11-15", "siglaTribunal": "TJSP", "tipoComunicacao": "Intimação", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "<p>Outra.</p>"}'::jsonb);
select public._c15('08 cancelar a tarefa e as rotinas do sistema não são afetados',
  public._t14($$update public.tarefas set status = 'cancelada' where id = (select tarefa_id from public.publicacoes where id = 910003)$$) = '00000');
select case when ok then 'ok    ' else 'FALHA ' end || caso from public._r15 order by n;
select (select count(*) filter (where ok) from public._r15) || ' de ' || (select count(*) from public._r15) || ' casos conformes (0115)';
