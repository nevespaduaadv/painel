-- 0114 · matriz no PostgreSQL real. Só dados fictícios. Entregas feitas como o servidor (postgres) e ações humanas com sessão
-- simulada (JWT + role authenticated), como nas demais matrizes.
\set ON_ERROR_STOP 0
\set adm a0000000-0000-0000-0000-0000000000b1
\set jur a0000000-0000-0000-0000-0000000000b2
\set com a0000000-0000-0000-0000-0000000000b3
create table if not exists public._r14 (n serial, caso text, ok boolean, det text); grant all on public._r14 to authenticated; grant usage on sequence public._r14_n_seq to authenticated;
create or replace function public._c14(p_caso text, p_ok boolean, p_det text default '') returns void language sql security definer as $$ insert into public._r14 (caso, ok, det) values (p_caso, coalesce(p_ok, false), coalesce(p_det, '')) $$;
create or replace function public._t14(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return '00000'; exception when others then return sqlstate; end $$;
create or replace function public._como14(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false), set_config('request.jwt.claim.role', case when p is null then '' else 'authenticated' end, false) $$;
grant execute on function public._c14(text, boolean, text), public._t14(text), public._como14(uuid) to authenticated;
insert into auth.users (id, email) values (:'adm', 'adm14@ficticio.test'), (:'jur', 'jur14@ficticio.test'), (:'com', 'com14@ficticio.test') on conflict do nothing;
update public.perfis set papel = 'admin' where id = :'adm';
update public.perfis set papel = 'colaborador', acessos = '{juridico,clientes}' where id = :'jur';
update public.perfis set papel = 'colaborador', acessos = '{comercial}' where id = :'com';
insert into public.colaboradores (id, perfil_id, nome, nucleo, ativo) values ('c0000000-0000-0000-0000-0000000000b2', :'jur', 'Jur Fictício 14', 'juridico', true), ('c0000000-0000-0000-0000-0000000000b3', :'com', 'Com Fictício 14', 'comercial', true) on conflict (id) do nothing;
insert into public.clientes (id, dados) values ('cli-sync-1', '{"nome":"Cliente fictício Sync"}') on conflict do nothing;
insert into public.processos (id, cliente_id, numero_cnj, status) values ('d0000000-0000-0000-0000-000000000001', 'cli-sync-1', '1111111-11.2026.8.26.0100', 'ativo') on conflict do nothing;
-- uma publicação que JÁ veio do DJEN (com a tarefa automática de análise)
select public.djen_gravar('{"id": 900001, "data_disponibilizacao": "2026-11-10", "siglaTribunal": "TJSP", "nomeOrgao": "1ª Vara Cível", "tipoComunicacao": "Intimação", "tipoDocumento": "Despacho", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "<p>Manifeste-se a parte autora em 15 dias.</p>", "link": "https://exemplo.test/djen/900001"}'::jsonb);
create temp table _antes as select (select count(*) from public.publicacoes) pubs, (select count(*) from public.tarefas) tarefas, (select md5(string_agg(md5(p::text), '' order by id)) from public.publicacoes p) h;

-- ===== integração DESLIGADA (padrão) =====
select public._c14('01 desligada por padrão: a entrega do servidor não grava nada',
  (public.sync_receber_intimacao('{"id_externo": "42", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-10", "texto": "x"}'::jsonb) ->> 'acao') = 'desligada'
  and (select (select count(*) from public.publicacoes) = pubs and (select count(*) from public.publicacao_fontes) = 0 from _antes));
select public.sync_evento_registrar('webhook', 'intimacao.criada', 'imp-desligada', true, '{"segredo": "conteudo"}'::jsonb) ->> 'status' as e02 \gset
select public._c14('02 desligada: o evento de webhook é anotado como ignorado, sem guardar o conteúdo',
  :'e02' = 'ignorado_desligada' and (select corpo is null from public.sync_eventos where impressao = 'imp-desligada'));
select public._como14(:'jur'); set role authenticated;
select public._c14('03 só a administradora liga a integração (42501 para os demais)', public._t14($$select public.sync_definir(true)$$) = '42501');
reset role; select public._como14(:'adm'); set role authenticated;
select public._c14('04 a administradora liga; fica registrado no histórico de execuções', public._t14($$select public.sync_definir(true)$$) = '00000');
reset role; select public._como14(null);
select public._c14('04b conferência', public.sync_ativo() and (select count(*) = 1 from public.sync_execucoes where origem = 'configuracao' and por = :'adm'));

-- ===== recebimento, vínculo e deduplicação =====
select public.sync_receber_intimacao('{"id_externo": "42", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-10", "tribunal": "TJSP", "tipo_ato": "Despacho", "texto": "Manifeste-se a parte autora em 15 dias.", "link": "https://exemplo.test/sync/42", "prazos": [{"chave": "k-42-a", "rotulo": "Manifestação — 15 dias úteis", "data_fatal": "2026-12-02"}], "bruto": {"id": 42}}'::jsonb) as r \gset
select public._c14('05 publicação que já existe pelo DJEN e chega pelo Sync (mesmo processo, dia e texto): NÃO duplica — vira mais uma fonte da mesma publicação',
  (:'r'::jsonb ->> 'acao') = 'anexada' and (:'r'::jsonb ->> 'publicacao_id') = '900001'
  and (select (select count(*) from public.publicacoes) = pubs and (select count(*) from public.tarefas) = tarefas from _antes)
  and (select casamento = 'identica' and jsonb_array_length(divergencias) = 0 from public.publicacao_fontes where fonte = 'sync' and id_externo = '42'), :'r');
select public._c14('06 a publicação do DJEN não foi alterada (conteúdo idêntico ao de antes)', (select (select md5(string_agg(md5(p::text), '' order by id)) from public.publicacoes p) = h from _antes));
select public.sync_receber_intimacao('{"id_externo": "42", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-10", "texto": "Manifeste-se a parte autora em 15 dias.", "prazos": [{"chave": "k-42-a", "rotulo": "Manifestação — 15 dias úteis", "data_fatal": "2026-12-02"}]}'::jsonb) as r \gset
select public._c14('07 evento repetido (mesmo id no Sync): só conta a repetição; nenhuma publicação, fonte, prazo ou tarefa a mais',
  (:'r'::jsonb ->> 'acao') = 'repetida' and (:'r'::jsonb ->> 'prazos_novos') = '0'
  and (select vezes = 2 from public.publicacao_fontes where fonte = 'sync' and id_externo = '42')
  and (select count(*) = 1 from public.publicacao_prazos where publicacao_id = 900001)
  and (select (select count(*) from public.tarefas) = tarefas from _antes));
select public.sync_receber_intimacao('{"id_externo": "43", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-12", "tribunal": "TJSP", "tipo_ato": "Decisão", "texto": "Defiro o pedido. Intime-se.", "prazos": [{"chave": "k-43-a", "rotulo": "Embargos de declaração — 5 dias úteis", "data_fatal": "2026-11-19"}, {"chave": "k-43-b", "rotulo": "Agravo de instrumento — 15 dias úteis", "data_fatal": "2026-12-03"}]}'::jsonb) as r \gset
select public._c14('08 publicação nova, de processo cadastrado: entra vinculada ao processo e ao cliente, com UMA tarefa "Analisar publicação" e andamento com origem Sync',
  (:'r'::jsonb ->> 'acao') = 'nova' and (:'r'::jsonb ->> 'sem_processo') = 'false'
  and (select origem = 'sync' and id < 0 and processo_id = 'd0000000-0000-0000-0000-000000000001' and cliente_id = 'cli-sync-1' and tarefa_id is not null from public.publicacoes where id = (:'r'::jsonb ->> 'publicacao_id')::bigint)
  and (select fonte = 'sync' and id_externo = 'sync:43' from public.andamentos a join public.publicacoes p on p.andamento_id = a.id where p.id = (:'r'::jsonb ->> 'publicacao_id')::bigint)
  and (select (select count(*) from public.tarefas) = tarefas + 1 from _antes), :'r');
select (:'r'::jsonb ->> 'publicacao_id')::bigint as p43 \gset
select public.sync_receber_intimacao('{"id_externo": "44", "numero_processo": "9999999-99.2026.8.26.0100", "data_publicacao": "2026-11-12", "tribunal": "TJSP", "texto": "Publicação de processo que não está cadastrado."}'::jsonb) as r \gset
select public._c14('09 publicação sem processo correspondente: entra como "sem processo", sem tarefa e sem criar processo',
  (:'r'::jsonb ->> 'acao') = 'nova' and (:'r'::jsonb ->> 'sem_processo') = 'true'
  and (select processo_id is null and tarefa_id is null from public.publicacoes where id = (:'r'::jsonb ->> 'publicacao_id')::bigint)
  and (select count(*) = 1 from public.processos where cliente_id = 'cli-sync-1'));
select public.sync_receber_intimacao('{"id_externo": "45", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-12", "tribunal": "TJSP", "texto": "Texto DIFERENTE no mesmo processo e no mesmo dia."}'::jsonb) as r \gset
select public._c14('10 mesmo processo e mesmo dia, texto diferente: na dúvida NÃO esconde — entra como publicação própria, marcada "possível duplicata", e junta-se à MESMA tarefa (não abre outra)',
  (:'r'::jsonb ->> 'acao') = 'nova_possivel_duplicata'
  and (select tarefa_id = (select tarefa_id from public.publicacoes where id = :p43) from public.publicacoes where id = (:'r'::jsonb ->> 'publicacao_id')::bigint)
  and (select (select count(*) from public.tarefas) = tarefas + 1 from _antes)
  and (select divergencias_abertas = 1 from public.v_publicacoes_integracao where publicacao_id = (:'r'::jsonb ->> 'publicacao_id')::bigint), :'r');
select public.sync_receber_intimacao('{"id_externo": "46", "djen_id": "900001", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-10", "tribunal": "TJRJ", "texto": "Texto que a outra fonte traz diferente."}'::jsonb) as r \gset
select public._c14('11 dados divergentes entre fontes (mesmo id do DJEN, tribunal e texto diferentes): a nossa publicação fica como está; a divergência é registrada para conciliação',
  (:'r'::jsonb ->> 'acao') = 'divergente' and (:'r'::jsonb ->> 'divergencias') = '2'
  and (select tribunal = 'TJSP' and btrim(texto, E' \n') = 'Manifeste-se a parte autora em 15 dias.' from public.publicacoes where id = 900001)
  and (select divergencias_abertas = 1 from public.v_publicacoes_integracao where publicacao_id = 900001), :'r' || ' abertas=' || (select divergencias_abertas from public.v_publicacoes_integracao where publicacao_id = 900001) || ' trib=' || (select tribunal from public.publicacoes where id = 900001));
select public._c14('12 dados incompletos (sem número ou sem data): quarentena — não vira publicação',
  (public.sync_receber_intimacao('{"id_externo": "47", "texto": "sem processo nem data"}'::jsonb) ->> 'acao') = 'quarentena'
  and not exists (select 1 from public.publicacao_fontes where id_externo = '47'));
-- DJEN chegando DEPOIS do Sync
select count(*) as t_antes from public.tarefas \gset
select public.djen_gravar('{"id": 900043, "data_disponibilizacao": "2026-11-12", "siglaTribunal": "TJSP", "tipoComunicacao": "Intimação", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "<b>Defiro o pedido.</b> Intime-se."}'::jsonb);
select public.djen_gravar('{"id": 900043, "data_disponibilizacao": "2026-11-12", "siglaTribunal": "TJSP", "tipoComunicacao": "Intimação", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "<b>Defiro o pedido.</b> Intime-se."}'::jsonb);
select public._c14('13 o DJEN traz depois a mesma comunicação que entrou pelo Sync (duas rodadas do agendamento): nenhuma linha nova, nenhuma tarefa nova; o id do DJEN fica anotado como fonte',
  not exists (select 1 from public.publicacoes where id = 900043) and (select count(*) = :t_antes from public.tarefas)
  and (select publicacao_id = :p43 and vezes = 2 from public.publicacao_fontes where fonte = 'djen' and id_externo = '900043'));
select public._c14('14 a publicação mostra de onde veio: DJEN + Sync na 900001; Sync + DJEN na que entrou pelo Sync',
  (select fontes @> array['djen','sync'] from public.v_publicacoes_integracao where publicacao_id = 900001)
  and (select origem = 'sync' and fontes @> array['djen','sync'] from public.v_publicacoes_integracao where publicacao_id = :p43));

-- ===== prazos: sugestão × conferência humana =====
select public._c14('15 prazo vindo da plataforma entra só como SUGESTÃO: a tarefa automática não recebe a data nem "fatal"',
  (select count(*) = 2 and bool_and(estado = 'sugerido' and data_conferida is null and fatal is null and tarefa_id is null) from public.publicacao_prazos where publicacao_id = :p43)
  and (select not prazo_fatal and prazo = date '2026-11-13' from public.tarefas where id = (select tarefa_id from public.publicacoes where id = :p43))
  and (select prazos_a_conferir = 2 and situacao = 'recebida' from public.v_publicacoes_integracao where publicacao_id = :p43));
select id as z1 from public.publicacao_prazos where chave_externa = 'k-43-a' \gset
select id as z2 from public.publicacao_prazos where chave_externa = 'k-43-b' \gset
select id as z0 from public.publicacao_prazos where chave_externa = 'k-42-a' \gset
select public._como14(:'com'); set role authenticated;
select public._c14('16 quem não é do Jurídico não confere prazo (42501)', public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar')$$, :z1)) = '42501');
reset role; select public._como14(:'jur'); set role authenticated;
select public._c14('17 confirmar com data diferente da sugerida é recusado: tem de ser "corrigir", com motivo (22023)',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar', '2026-11-20')$$, :z1)) = '22023'
  and public._t14(format($$select public.publicacao_prazo_conferir(%s, 'corrigir', '2026-11-20')$$, :z1)) = '22023');
select public._c14('18 o Jurídico CONFIRMA a sugestão e marca fatal: a tarefa já existente da publicação recebe o prazo (não se cria outra)',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'confirmar', null, true)$$, :z1)) = '00000');
select public._c14('19 o Jurídico CORRIGE a segunda hipótese (outra data, com motivo), sem marcar fatal',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'corrigir', '2026-12-04', false, 'Feriado local em 03/12')$$, :z2)) = '00000');
select public._c14('20 prazo já conferido não muda sem reabertura (23514); reabrir exige motivo (22023)',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'corrigir', '2026-11-21', false, 'tentando mudar')$$, :z1)) = '23514'
  and public._t14(format($$select public.publicacao_prazo_conferir(%s, 'reabrir')$$, :z1)) = '22023');
select public._c14('21 descartar a sugestão exige motivo; descartada, não cria tarefa',
  public._t14(format($$select public.publicacao_prazo_conferir(%s, 'descartar')$$, :z0)) = '22023'
  and public._t14(format($$select public.publicacao_prazo_conferir(%s, 'descartar', null, false, 'Ato já cumprido antes')$$, :z0)) = '00000');
reset role; select public._como14(null);
select public._c14('18b conferência: sugerido 19/11 = conferido 19/11; quem e quando; a tarefa da publicação ficou com 19/11 e fatal; nenhuma tarefa nova',
  (select estado = 'confirmado' and data_sugerida = date '2026-11-19' and data_conferida = date '2026-11-19' and fatal and conferido_por = :'jur' and conferido_em is not null and tarefa_id = (select tarefa_id from public.publicacoes where id = :p43) from public.publicacao_prazos where id = :z1)
  and (select prazo = date '2026-11-19' and prazo_fatal from public.tarefas where id = (select tarefa_id from public.publicacoes where id = :p43))
  and (select count(*) = :t_antes from public.tarefas));
select public._c14('19b conferência: sugerido 03/12, conferido 04/12, motivo guardado; impedimento de tarefas duplicadas — as duas hipóteses usam a mesma tarefa',
  (select estado = 'corrigido' and data_sugerida = date '2026-12-03' and data_conferida = date '2026-12-04' and not fatal and observacao = 'Feriado local em 03/12' from public.publicacao_prazos where id = :z2)
  and (select count(distinct tarefa_id) = 1 from public.publicacao_prazos where publicacao_id = :p43) and (select count(*) = :t_antes from public.tarefas));
select public._c14('22 histórico de ajustes do prazo: sugerido → confirmado (com a tarefa vinculada), com autor',
  (select string_agg(acao, ',' order by id) = 'sugerido,tarefa_vinculada,confirmado' from public.publicacao_prazo_historico where prazo_id = :z1)
  and (select count(*) = 2 from public.publicacao_prazo_historico where prazo_id = :z1 and por = :'jur'));
select public.sync_receber_intimacao('{"id_externo": "43", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-12", "texto": "Defiro o pedido. Intime-se.", "prazos": [{"chave": "k-43-a", "rotulo": "Embargos de declaração — 5 dias úteis", "data_fatal": "2026-11-25"}]}'::jsonb) as r \gset
select public._c14('23 a plataforma muda a sugestão DEPOIS da conferência: o prazo conferido e a tarefa NÃO mudam; a mudança fica no histórico',
  (select estado = 'confirmado' and data_conferida = date '2026-11-19' and data_sugerida = date '2026-11-25' from public.publicacao_prazos where id = :z1)
  and (select prazo = date '2026-11-19' from public.tarefas where id = (select tarefa_id from public.publicacoes where id = :p43))
  and exists (select 1 from public.publicacao_prazo_historico where prazo_id = :z1 and acao = 'sugestao_alterada'));
select public._c14('24 nada foi tratado, lido ou baixado automaticamente: as publicações vindas do Sync continuam sem providência e não lidas',
  (select bool_and(providencia is null and not lida and not ignorada) from public.publicacoes where origem = 'sync'));
-- ===== conciliação, eventos, permissões =====
select public._como14(:'jur'); set role authenticated;
select public._c14('25 o Jurídico concilia a fonte divergente ("é a mesma"); fica no histórico da publicação',
  public._t14(format($$select public.publicacao_fonte_conciliar(%s, 'mesma')$$, (select id from public.publicacao_fontes where id_externo = '46'))) = '00000');
select public._c14('26 pela sessão de usuário não se entrega intimação nem se registra evento (42501): só o servidor',
  public._t14($$select public.sync_receber_intimacao('{"id_externo":"x"}'::jsonb)$$) = '42501' and public._t14($$select public.sync_evento_registrar('webhook','x','y',true,'{}'::jsonb)$$) = '42501'
  and public._t14($$insert into public.publicacao_prazos (publicacao_id, origem) values (900001, 'manual')$$) = '42501' and public._t14($$update public.integracoes set ativo = true$$) = '42501');
select public._c14('27 os eventos brutos do webhook só são legíveis pela administradora', (select count(*) = 0 from public.sync_eventos));
reset role; select public._como14(null);
select public.sync_evento_registrar('webhook', 'intimacao.criada', 'imp-1', true, '{"a":1}'::jsonb) ->> 'status' as e28a \gset
select public.sync_evento_registrar('webhook', 'intimacao.criada', 'imp-1', true, '{"a":1}'::jsonb) ->> 'status' as e28b \gset
select public._c14('28 webhook repetido (mesmo corpo): registrado uma vez; a segunda entrega volta como "repetido"',
  :'e28a' = 'novo' and :'e28b' = 'repetido' and (select count(*) = 1 from public.sync_eventos where impressao = 'imp-1'));
select public.sync_evento_registrar('webhook', null, 'imp-2', false, '{"conteudo":"forjado"}'::jsonb) ->> 'status' as e29 \gset
select public._c14('29 webhook com assinatura inválida: anotado, sem guardar o conteúdo',
  :'e29' = 'assinatura_invalida' and (select corpo is null from public.sync_eventos where impressao = 'imp-2'));
select public._como14(:'adm'); set role authenticated;
select public._c14('30 desligar a integração não interrompe o módulo: as publicações (inclusive as que vieram do Sync) continuam lá; novas entregas são recusadas',
  public._t14($$select public.sync_definir(false)$$) = '00000');
reset role; select public._como14(null);
select public._c14('30b conferência',
  (public.sync_receber_intimacao('{"id_externo": "99", "numero_processo": "1111111-11.2026.8.26.0100", "data_publicacao": "2026-11-13", "texto": "depois de desligada"}'::jsonb) ->> 'acao') = 'desligada'
  and (select count(*) >= 3 from public.publicacoes where origem = 'sync') and not exists (select 1 from public.publicacao_fontes where id_externo = '99'));
select public.djen_gravar('{"id": 900050, "data_disponibilizacao": "2026-11-13", "siglaTribunal": "TJSP", "tipoComunicacao": "Intimação", "numeroprocessocommascara": "1111111-11.2026.8.26.0100", "texto": "Publicação nova do DJEN, com a integração desligada."}'::jsonb);
select public._c14('31 com a integração desligada, o DJEN segue funcionando como sempre (publicação nova entra, com tarefa)', (select tarefa_id is not null and origem = 'djen' from public.publicacoes where id = 900050));
\echo
select case when ok then 'ok    ' else 'FALHA ' end || caso || case when det <> '' and not ok then '  [' || left(det, 300) || ']' else '' end from public._r14 order by n;
select count(*) filter (where ok) || ' de ' || count(*) || ' casos conformes' from public._r14;
