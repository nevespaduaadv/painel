-- 0113 · matriz de casos no PostgreSQL real (sessões simuladas como o PostgREST: JWT + role authenticated). Só dados fictícios.
\set ON_ERROR_STOP 0
\set adm  a0000000-0000-0000-0000-000000000001
\set ana  a0000000-0000-0000-0000-000000000002
\set bia  a0000000-0000-0000-0000-000000000003
\set caio a0000000-0000-0000-0000-000000000004
\set dora a0000000-0000-0000-0000-000000000005
\set fab  a0000000-0000-0000-0000-000000000008
\set cAdm  c0000000-0000-0000-0000-000000000001
\set cAna  c0000000-0000-0000-0000-000000000002
\set cBia  c0000000-0000-0000-0000-000000000003
\set cCaio c0000000-0000-0000-0000-000000000004
\set cDora c0000000-0000-0000-0000-000000000005
\set cEli  c0000000-0000-0000-0000-000000000006
\set cTst  c0000000-0000-0000-0000-000000000007
\set cFab  c0000000-0000-0000-0000-000000000008
create table if not exists public._res (n serial, caso text, ok boolean, det text);
grant all on public._res to authenticated; grant usage on sequence public._res_n_seq to authenticated;
create or replace function public._chk(p_caso text, p_ok boolean, p_det text default '') returns void language sql security definer as $$ insert into public._res (caso, ok, det) values (p_caso, coalesce(p_ok, false), p_det) $$;
-- tenta um comando e devolve o SQLSTATE ('00000' = executou)
create or replace function public._tenta(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return '00000'; exception when others then return sqlstate; end $$;
create or replace function public._cg(p text) returns uuid language sql stable security definer as $$ select id from public.cargos where codigo = p $$;
create or replace function public._como(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', p::text, false), set_config('request.jwt.claim.role', 'authenticated', false) $$;
grant execute on function public._chk(text, boolean, text), public._tenta(text), public._cg(text), public._como(uuid) to authenticated;

-- ===== 1. instalação não mexe em nada existente =====
select public._chk('01 instalação: tarefas, monitoramentos, perfis e fichas existentes idênticos; 0 ocupações; ninguém gerido por cargo',
  (select a.tarefas = (select md5(string_agg(md5(((to_jsonb(t) - 'cargo_id')::jsonb)::text), '' order by id)) from public.tarefas t) from public._antes a) and
  (select a.monit = (select md5(string_agg(md5(((to_jsonb(m) - 'cargo_id')::jsonb)::text), '' order by id)) from public.monitoramentos m) from public._antes a) and
  (select a.n_tarefas = (select count(*) from public.tarefas) from public._antes a) and
  (select a.perfis = (select md5(string_agg(md5(p::text), '' order by id)) from public.perfis p) from public._antes a) and
  (select a.colabs = (select md5(string_agg(md5((to_jsonb(c) - 'conta_teste' - 'acesso_por_cargo' - 'fila_cargo_id')::text), '' order by id)) from public.colaboradores c where fila_cargo_id is null) from public._antes a) and
  (select count(*) = 0 from public.cargo_ocupacoes) and (select count(*) = 0 from public.colaboradores where acesso_por_cargo) and
  (select count(*) = 1 from public.tarefas where responsavel_id = :'cTst' and cargo_id is null) and (select count(*) = 1 from public.monitoramentos where responsavel_id = :'cTst'),
  'tarefa e monitoramento antigos continuam com a conta de teste, para transferência controlada');
select public._chk('02 catálogo: 9 cargos, 9 filas, todos vagos; núcleo sem ocupante responde com a FILA, nunca com a conta de teste nem com o mais antigo',
  (select count(*) = 9 from public.cargos) and (select count(*) = 9 from public.colaboradores where fila_cargo_id is not null and not ativo and perfil_id is null)
  and (select bool_and(vago) from public.v_cargos) and public.responsavel_padrao('juridico') = public.cargo_fila(public._cg('responsavel_juridico'))
  and public.responsavel_padrao('rh') is null);

-- ===== 2. escalonamento por quem não é administradora =====
select public._como(:'bia'); set role authenticated;
select public._chk('03 não administradora: criar cargo, designar-se, gravar direto nas tabelas e marcar conta de teste → recusados',
  public._tenta($$select public.cargo_salvar(null, 'cargo_da_bia', 'Cargo da Bia', 'juridico', null, '{financeiro}')$$) = '42501'
  and public._tenta(format($$select public.cargo_designar(%L, %L)$$, public._cg('responsavel_financeiro'), 'c0000000-0000-0000-0000-000000000003')) = '42501'
  and public._tenta(format($$insert into public.cargo_ocupacoes (cargo_id, colaborador_id) values (%L, %L)$$, public._cg('responsavel_financeiro'), 'c0000000-0000-0000-0000-000000000003')) = '42501'
  and public._tenta($$update public.cargos set acessos = '{financeiro}'$$) = '42501'
  and public._tenta($$select public.colaborador_conta_teste('c0000000-0000-0000-0000-000000000007', false)$$) = '42501');
select public._chk('04 correção de segurança: a pessoa não muda o PRÓPRIO núcleo, frente nem situação (antes conseguia e ganhava edita_protecao)',
  public._tenta($$update public.colaboradores set frente = 'estrategico' where id = 'c0000000-0000-0000-0000-000000000003'$$) = '42501'
  and public._tenta($$update public.colaboradores set nucleo = 'socios' where id = 'c0000000-0000-0000-0000-000000000003'$$) = '42501'
  and public._tenta($$update public.colaboradores set bio = 'posso editar minha bio' where id = 'c0000000-0000-0000-0000-000000000003'$$) = '00000'
  and not public.edita_protecao(), 'a bio continua editável');
with u as (update public.perfis set acessos = '{financeiro,protecao}' where id = auth.uid() returning 1)
select public._chk('05 a pessoa não altera os próprios acessos (0 linhas)', (select count(*) = 0 from u));
reset role;
select public._chk('06 cargo não concede administração: acesso fora da lista é recusado pelo banco',
  public._tenta($$insert into public.cargos (codigo, nome, acessos) values ('cargo_admin', 'Cargo admin', '{admin}')$$) = '23514');

-- ===== 3. cargo ocupado; dois cargos =====
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_juridico'), :'cAna', 'titular', 'designação inicial (teste)') \gset oc1_
reset role;
select public._chk('07 cargo ocupado: Ana titular do Responsável Jurídico → acessos e núcleo vêm do cargo; passa a responder pelo núcleo',
  (select acessos = '{clientes,juridico,tarefas_equipe}' from public.perfis where id = :'ana') and (select nucleo = 'juridico' and frente = 'juridico' and acesso_por_cargo from public.colaboradores where id = :'cAna')
  and public.responsavel_padrao('juridico') = :'cAna');
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_acordos'), :'cAna', 'titular', 'acumula Acordos (teste)') \gset oc2_
reset role;
select public._como(:'ana'); set role authenticated;
select public._chk('08 dois cargos: acessos somados; edita_ata() vale pelo cargo de Acordos mesmo com o núcleo principal Jurídico; sem proteção',
  (select acessos = '{clientes,juridico,tarefas_equipe}' from public.perfis where id = auth.uid()) and public.edita_ata() and not public.edita_protecao()
  and (select nucleo = 'juridico' from public.colaboradores where perfil_id = auth.uid()) and (select count(*) = 2 from public.cargo_ocupacoes o join public.colaboradores c on c.id = o.colaborador_id where c.perfil_id = auth.uid() and o.fim is null));
reset role;

-- ===== 4. cliente novo: vínculo institucional, vacância, nada perdido =====
insert into public.clientes (id, dados) values ('cli-cargos-1', '{"nome":"Cliente fictício novo"}');
select public._chk('09 cliente novo: tarefas e monitoramento automáticos saem com cargo_id; Jurídico e Acordos com a Ana (ocupante); nada com a conta de teste',
  (select count(*) > 0 and bool_and(cargo_id is not null) from public.tarefas where cliente_id = 'cli-cargos-1' and responsavel_id = :'cAna')
  and (select responsavel_id = :'cAna' and cargo_id = public._cg('responsavel_juridico') from public.monitoramentos where cliente_id = 'cli-cargos-1')
  and not exists (select 1 from public.tarefas where cliente_id = 'cli-cargos-1' and responsavel_id = :'cTst'),
  (select count(*) || ' tarefas do cliente novo' from public.tarefas where cliente_id = 'cli-cargos-1'));
select public._chk('10 cargo vago: o que é de núcleo sem ocupante fica na fila do cargo e aparece em v_distribuicao_pendente (nada se perde, ninguém recebe ao acaso)',
  (select count(*) = (select count(*) from public.tarefas t join public.colaboradores c on c.id = t.responsavel_id where t.cliente_id = 'cli-cargos-1' and c.fila_cargo_id is not null)
     from public.v_distribuicao_pendente where cliente_id = 'cli-cargos-1' and tabela = 'tarefas')
  and (select count(*) = (select count(*) from public.tarefas where cliente_id = 'cli-cargos-0') from public.tarefas where cliente_id = 'cli-cargos-1'),
  (select count(*) || ' na fila; mesmas ' || (select count(*) from public.tarefas where cliente_id = 'cli-cargos-1') || ' tarefas que o cliente anterior gerou' from public.v_distribuicao_pendente where cliente_id = 'cli-cargos-1'));

-- ===== 5. mudança de ocupante: continuidade, sem duplicar, autoria e nominal preservados =====
insert into public.tarefas (titulo, cliente_id, responsavel_id, status, created_by) values ('Tarefa nominal da Ana', 'cli-cargos-1', :'cAna', 'aberta', :'adm');
select public._como(:'ana'); set role authenticated;
insert into public.entradas_timeline (cliente_id, data, tipo, descricao) values ('cli-cargos-1', current_date, 'registro', 'Registro feito pela Ana enquanto Responsável Jurídico');
reset role;
create temp table _t5 as select (select count(*) from public.tarefas) n, (select count(*) from public.tarefas where cargo_id = public._cg('responsavel_juridico') and status in ('aberta','em_andamento')) inst,
  (select count(*) from public.monitoramentos where cargo_id = public._cg('responsavel_juridico')) mon;
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_juridico'), :'cBia', 'titular', 'Ana mudou de área (teste)') \gset oc3_
reset role;
select public._chk('11 troca de ocupante: a carteira institucional aberta do cargo passa inteira para a Bia; nenhuma tarefa criada ou duplicada',
  (select t.n = (select count(*) from public.tarefas) and t.inst > 0
      and t.inst = (select count(*) from public.tarefas where cargo_id = public._cg('responsavel_juridico') and status in ('aberta','em_andamento') and responsavel_id = :'cBia')
      and t.mon = (select count(*) from public.monitoramentos where cargo_id = public._cg('responsavel_juridico') and responsavel_id = :'cBia') from _t5 t),
  (select inst || ' tarefas e ' || mon || ' monitoramento(s) institucionais' from _t5));
select public._chk('12 quem saiu: perde os acessos exclusivos do cargo e mantém os do outro cargo (Acordos); a ocupação fica no histórico',
  (select acessos = '{clientes,juridico}' from public.perfis where id = :'ana') and (select nucleo = 'acordos' and frente = 'negocial' from public.colaboradores where id = :'cAna')
  and (select count(*) = 1 from public.cargo_ocupacoes where colaborador_id = :'cAna' and cargo_id = public._cg('responsavel_juridico') and fim is not null and motivo_fim like 'Ana mudou%')
  and (select acessos = '{clientes,juridico,tarefas_equipe}' from public.perfis where id = :'bia'));
select public._chk('13 atividade nominal fica com a pessoa (não segue o cargo) e a autoria do registro no dossiê continua da Ana',
  (select responsavel_id = :'cAna' and cargo_id is null from public.tarefas where titulo = 'Tarefa nominal da Ana')
  and (select created_by = :'ana' from public.entradas_timeline where descricao like 'Registro feito pela Ana%'));
select public._chk('14 histórico de responsáveis: cada troca registrada com de → para, cargo, motivo e quem fez',
  (select count(*) = (select inst + mon from _t5) and bool_and(de = :'cAna' and para = :'cBia' and motivo like 'Ana mudou%' and por = :'adm') from public.responsavel_historico where cargo_id = public._cg('responsavel_juridico')));

-- ===== 6. revogação vale na sessão aberta, pelo banco (tentativa direta pela API) =====
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_acompanhamento_pj'), :'cCaio', 'titular', 'teste') \gset oc4_
reset role;
select public._como(:'caio'); set role authenticated;
select public._chk('15 com o cargo: Caio conduz a proteção (edita_protecao) e altera a proteção de um bem pela API',
  public.edita_protecao() and public._tenta($$update public.bens set protecao = 'em_protecao' where cliente_id = 'cli-cargos-0'$$) = '00000' and public.tem_acesso('clientes'));
reset role;
select public._como(:'adm'); set role authenticated;
select public.cargo_encerrar(:'oc4_cargo_designar', 'saiu do Acompanhamento PJ (teste)');
reset role;
select public._como(:'caio'); set role authenticated;
select public._chk('16 cargo retirado, MESMA sessão: edita_protecao() falsa, alteração de proteção recusada, acessos zerados — sem novo login',
  not public.edita_protecao() and public._tenta($$update public.bens set protecao = 'exposto' where cliente_id = 'cli-cargos-0'$$) <> '00000'
  and not public.tem_acesso('clientes') and not public.tem_acesso('juridico') and (select acessos = '{}' from public.perfis where id = auth.uid())
  and (select count(*) = 0 from (select 1 from public.bens where cliente_id = 'cli-cargos-0' and protecao = 'exposto') z));
reset role;

-- ===== 7. substituto temporário, titular sem login, titular inativo =====
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_juridico'), :'cCaio', 'substituto', 'substituto do Jurídico (teste)') \gset oc5_
select public.cargo_afastar(:'oc3_cargo_designar', public.np_hoje(), public.np_hoje() + 5);
reset role;
select public._chk('17 substituto temporário: com a titular afastada, as distribuições novas vão ao substituto; a carteira já distribuída não é movida',
  public.responsavel_padrao('juridico') = :'cCaio' and (select titular_afastado and ocupante_id = :'cCaio' from public.v_cargos where codigo = 'responsavel_juridico')
  and (select count(*) > 0 from public.tarefas where cargo_id = public._cg('responsavel_juridico') and responsavel_id = :'cBia' and status = 'aberta'));
select public._como(:'adm'); set role authenticated; select public.cargo_afastar(:'oc3_cargo_designar', null, null); reset role;
select public._chk('18 fim do afastamento: a titular volta a responder', public.responsavel_padrao('juridico') = :'cBia');
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_comercial'), :'cEli', 'titular', 'titular ainda sem login (teste)') \gset oc6_
reset role;
select public._chk('19 titular sem login: o cargo continua vago para distribuição (fila) e a pendência aparece na matriz',
  public.responsavel_padrao('comercial') = public.cargo_fila(public._cg('responsavel_comercial'))
  and (select vago and titular = 'Eli Sem Login' and titular_pendencia = 'não tem login no sistema' from public.v_cargos where codigo = 'responsavel_comercial'));
select public._como(:'adm'); set role authenticated;
select public.cargo_designar(public._cg('responsavel_marketing'), :'cDora', 'titular', 'teste') \gset oc7_
update public.colaboradores set ativo = false, data_desligamento = current_date where id = :'cDora';
reset role;
select public._chk('20 titular inativa (desligada): deixa de receber; distribuições vão à fila; designar pessoa inativa é recusado',
  public.responsavel_padrao('marketing') = public.cargo_fila(public._cg('responsavel_marketing'))
  and (select titular_pendencia = 'está inativo' from public.v_cargos where codigo = 'responsavel_marketing'));
select public._como(:'adm'); set role authenticated;
select public._chk('21 designar inativa ou conta de teste → recusado (23514)',
  public._tenta(format($$select public.cargo_designar(%L, %L)$$, public._cg('responsavel_financeiro'), 'c0000000-0000-0000-0000-000000000005')) = '23514'
  and public._tenta($$select public.colaborador_conta_teste('c0000000-0000-0000-0000-000000000007', true)$$) = '00000'
  and public._tenta(format($$select public.cargo_designar(%L, %L)$$, public._cg('responsavel_financeiro'), 'c0000000-0000-0000-0000-000000000007')) = '23514');
select public.cargo_encerrar(:'oc7_cargo_designar', 'desligamento (teste)');
reset role;
select public._chk('22 colaboradora desligada: ocupação encerrada com motivo, acessos zerados, ficha e histórico preservados',
  (select acessos = '{}' from public.perfis where id = :'dora') and (select count(*) = 1 from public.cargo_ocupacoes where colaborador_id = :'cDora' and fim is not null)
  and (select count(*) = 1 from public.colaboradores where id = :'cDora' and not ativo));

-- ===== 8. ninguém recebe o que não consegue abrir =====
select public._como(:'adm'); set role authenticated;
select public._chk('23 atribuir à mão (alterar responsável) a conta de teste, pessoa sem login ou sem acesso a Clientes → recusado com explicação (23514)',
  public._tenta($$update public.tarefas set responsavel_id = 'c0000000-0000-0000-0000-000000000007' where titulo = 'Tarefa nominal da Ana'$$) = '23514'
  and public._tenta($$update public.tarefas set responsavel_id = 'c0000000-0000-0000-0000-000000000006' where titulo = 'Tarefa nominal da Ana'$$) = '23514'
  and public._tenta($$update public.tarefas set responsavel_id = 'c0000000-0000-0000-0000-000000000008' where titulo = 'Tarefa nominal da Ana'$$) = '23514'
  and (select responsavel_id = 'c0000000-0000-0000-0000-000000000002' from public.tarefas where titulo = 'Tarefa nominal da Ana'));
insert into public.tarefas (titulo, cliente_id, responsavel_id, nucleo, status) values ('Inclusão apontando para a conta de teste', 'cli-cargos-1', :'cTst', 'juridico', 'aberta'),
  ('Inclusão apontando para pessoa sem login', 'cli-cargos-1', :'cEli', 'juridico', 'aberta'), ('Inclusão para quem não acessa Clientes', 'cli-cargos-1', :'cFab', 'juridico', 'aberta');
reset role;
select public._chk('24 inclusão (importação, automação, formulário) apontando para quem não pode receber: vai para a fila do cargo do núcleo, à vista da administradora',
  (select count(*) = 3 and bool_and(t.responsavel_id = public.cargo_fila(public._cg('responsavel_juridico')) and t.cargo_id = public._cg('responsavel_juridico')) from public.tarefas t where t.titulo like 'Inclusão %'));
select public._chk('25 v_transferencias_pendentes lista as atividades nominais antigas com quem não pode recebê-las (conta de teste, sem login), com o motivo',
  (select count(*) filter (where responsavel = 'Conta de Teste' and impedimento = 'é conta de teste') >= 2 and count(*) filter (where responsavel = 'Eli Sem Login' and impedimento = 'não tem login no sistema') = 1 from public.v_transferencias_pendentes),
  (select string_agg(distinct responsavel || ': ' || impedimento, ' · ') from public.v_transferencias_pendentes));

-- ===== 9. transferência individual controlada =====
select public._como(:'adm'); set role authenticated;
select public._chk('26 transferência individual pela administradora: tarefa antiga da conta de teste → Bia, com motivo; destinatário sem login é recusado',
  public._tenta(format($$select public.atividade_transferir('tarefas', %L, 'c0000000-0000-0000-0000-000000000006', 'teste de recusa')$$, (select id::text from public.tarefas where responsavel_id = 'c0000000-0000-0000-0000-000000000007' limit 1))) = '23514'
  and public._tenta(format($$select public.atividade_transferir('tarefas', %L, 'c0000000-0000-0000-0000-000000000003', 'regularização da conta de teste')$$, (select id::text from public.tarefas where responsavel_id = 'c0000000-0000-0000-0000-000000000007' limit 1))) = '00000'
  and public._tenta(format($$select public.atividade_transferir('monitoramentos', %L, 'c0000000-0000-0000-0000-000000000003', 'regularização da conta de teste')$$, (select id::text from public.monitoramentos where responsavel_id = 'c0000000-0000-0000-0000-000000000007' limit 1))) = '00000');
reset role;
select public._chk('27 depois: nada mais com a conta de teste; histórico guarda quem era o responsável anterior e o motivo',
  not exists (select 1 from public.tarefas where responsavel_id = :'cTst' and status in ('aberta','em_andamento')) and not exists (select 1 from public.monitoramentos where responsavel_id = :'cTst')
  and (select count(*) = 2 from public.responsavel_historico where de = :'cTst' and para = :'cBia' and motivo = 'regularização da conta de teste'));
select public._como(:'bia'); set role authenticated;
select public._chk('28 não administradora não transfere atividades por essa função (42501)',
  public._tenta($$select public.atividade_transferir('tarefas', '1', 'c0000000-0000-0000-0000-000000000003', 'tentativa')$$) = '42501');
reset role;

-- ===== 10. mudança de núcleo, guardas e fila =====
select public._como(:'adm'); set role authenticated;
select public._chk('29 pessoa gerida por cargo: núcleo e acessos não se alteram à mão, nem pela administradora — só pela gestão de cargos (23514)',
  public._tenta($$update public.colaboradores set nucleo = 'socios' where id = 'c0000000-0000-0000-0000-000000000003'$$) = '23514'
  and public._tenta($$update public.perfis set acessos = '{financeiro}' where id = 'a0000000-0000-0000-0000-000000000003'$$) = '23514');
select public.cargo_encerrar((select id from public.cargo_ocupacoes where colaborador_id = :'cAna' and fim is null and cargo_id = public._cg('responsavel_acordos')), 'mudança de núcleo (teste)');
select public.cargo_designar(public._cg('responsavel_marketing'), :'cAna', 'titular', 'mudança de núcleo (teste)') \gset oc8_
reset role;
select public._chk('30 mudança de núcleo: Ana sai de Acordos e assume o Marketing → núcleo e acessos trocam; a carteira de Acordos volta à fila do cargo',
  (select nucleo = 'marketing' and frente is null from public.colaboradores where id = :'cAna') and (select acessos = '{growth,marketing}' from public.perfis where id = :'ana')
  and public.responsavel_padrao('acordos') = public.cargo_fila(public._cg('responsavel_acordos'))
  and not exists (select 1 from public.tarefas where cargo_id = public._cg('responsavel_acordos') and status in ('aberta','em_andamento') and responsavel_id = :'cAna'));
select public._como(:'adm'); set role authenticated;
select public._chk('31 distribuir a fila exige ocupante elegível (23514); com ocupante, a fila do cargo passa para ele',
  public._tenta(format($$select public.cargo_distribuir_pendentes(%L)$$, public._cg('responsavel_acordos'))) = '23514'
  and public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000004', 'titular', 'assume Acordos (teste)')$$, public._cg('responsavel_acordos'))) = '00000');
reset role;
select public._chk('32 novo titular de Acordos recebe a carteira que estava na fila; nenhuma tarefa nova',
  (select count(*) > 0 and bool_and(responsavel_id = :'cCaio') from public.tarefas where cargo_id = public._cg('responsavel_acordos') and status in ('aberta','em_andamento'))
  and (select na_fila = 0 from public.v_cargos where codigo = 'responsavel_acordos'));
select public._chk('33 contagem final: nenhuma tarefa duplicada em todo o teste (só as incluídas de propósito)',
  (select (select count(*) from public.tarefas) = t.n + 3 from _t5 t), (select count(*) || ' tarefas' from public.tarefas));
select public._chk('34 auditoria: toda criação, troca e encerramento de ocupação e toda mudança de acesso estão registradas com quem fez',
  (select count(*) from public.auditoria where tabela = 'cargo_ocupacoes') >= 12 and (select count(*) from public.auditoria where tabela = 'cargo_ocupacoes' and usuario = :'adm') >= 12
  and (select count(*) from public.auditoria where tabela = 'cargos') >= 9,
  (select count(*) || ' linhas de ocupações' from public.auditoria where tabela = 'cargo_ocupacoes'));

-- ===== 35+. cargo OPERACIONAL (vários ocupantes, sem escolha arbitrária) e fonte única de permissões =====
create table if not exists public._op (n serial, id uuid, quem uuid); grant all on public._op to authenticated; grant usage on sequence public._op_n_seq to authenticated;
create or replace function public._novo_op(p_titulo text) returns uuid language sql security definer as $$
  with x as (insert into public.tarefas (titulo, cliente_id, status, nucleo) values (p_titulo, 'cli-cargos-1', 'aberta', 'juridico') returning id)
  insert into public._op (id) select id from x returning id $$;
create or replace function public._salvar_op(p_distribuicao text, p_modalidade text default 'operacional') returns text language sql as $$
  select public._tenta(format($f$select public.cargo_salvar(%L, 'operador_juridico', 'Operador Jurídico', 'juridico', 'juridico', '{clientes,juridico,superendividamento}', false, false, null, true, %L, %L)$f$,
    public._cg('operador_juridico'), p_modalidade, p_distribuicao)) $$;
create or replace function public._ocup(p_colab uuid) returns uuid language sql stable security definer as $$
  select id from public.cargo_ocupacoes where cargo_id = public._cg('operador_juridico') and colaborador_id = p_colab and fim is null $$;
grant execute on function public._novo_op(text), public._salvar_op(text, text), public._ocup(uuid) to authenticated;
create temp table _t35 as select count(*) n from public.tarefas;

select public._como(:'adm'); set role authenticated;
select public._chk('35 cargo operacional: Bia e Fábio ocupam o Operador Jurídico ao mesmo tempo; substituto é recusado (23514); a designação concede os acessos sem acesso pessoal anterior',
  public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000003', 'titular', 'Bia também opera (teste)')$$, public._cg('operador_juridico'))) = '00000'
  and public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000008', 'titular', 'Fábio passa a operar (teste)')$$, public._cg('operador_juridico'))) = '00000'
  and public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000002', 'substituto', 'não existe substituto aqui')$$, public._cg('operador_juridico'))) = '23514');
select public._chk('35b conferência: dois ocupantes ativos, nenhum "ocupante único"; acessos somados; a Bia segue titular do Responsável Jurídico',
  (select ocupantes_n = 2 and not vago and ocupante_id is null and jsonb_array_length(ocupantes) = 2 from public.v_cargos where codigo = 'operador_juridico')
  and (select acessos = '{clientes,juridico,superendividamento}' from public.perfis where id = :'fab')
  and (select acessos = '{clientes,juridico,superendividamento,tarefas_equipe}' from public.perfis where id = :'bia')
  and (select titular = 'Bia Fictícia' from public.v_cargos where codigo = 'responsavel_juridico'),
  'a Bia continua titular do Responsável Jurídico: uma pessoa em dois cargos');
select public._chk('36 regras do cargo: operacional não responde por núcleo (23514); não vira coordenação com dois ocupantes (23514)',
  public._tenta($$select public.cargo_salvar(null, 'op_teste', 'Operacional que responde por núcleo', 'rh', null, '{equipe}', true, false, null, true, 'operacional', 'fila')$$) = '23514'
  and public._salvar_op('fila', 'coordenacao') = '23514');
select public._novo_op('Operador: peça 1') \gset t1_
select public._chk('37 dois operadores, regra "fila": a atividade enviada ao cargo NÃO escolhe ninguém — fica na fila do cargo, à vista da gestão',
  public._tenta(format($$select public.atividade_para_cargo('tarefas', %L, %L, 'vai para o cargo (teste)')$$, :'t1__novo_op', public._cg('operador_juridico'))) = '00000');
reset role;
select public._chk('37b conferência: responsável é a fila do Operador Jurídico; cargo carimbado; aparece em v_distribuicao_pendente',
  (select responsavel_id = public.cargo_fila(public._cg('operador_juridico')) and cargo_id = public._cg('operador_juridico') from public.tarefas where id = :'t1__novo_op')
  and exists (select 1 from public.v_distribuicao_pendente where registro = :'t1__novo_op' and cargo = 'Operador Jurídico'));
select public._como(:'adm'); set role authenticated;
select public._chk('38 a gestão distribui da fila para um ocupante (Fábio): a atividade continua vinculada ao cargo',
  public._tenta(format($$select public.atividade_transferir('tarefas', %L, 'c0000000-0000-0000-0000-000000000008', 'distribuída ao Fábio (teste)')$$, :'t1__novo_op')) = '00000');
reset role;
select public._chk('38b conferência', (select responsavel_id = :'cFab' and cargo_id = public._cg('operador_juridico') from public.tarefas where id = :'t1__novo_op'));
select public._como(:'adm'); set role authenticated;
select public._chk('39 regra "rodízio" (explícita, ligada pela administradora): quatro atividades alternam Bia, Fábio, Bia, Fábio, na ordem definida',
  public._salvar_op('rodizio') = '00000'
  and public._tenta(format($$select public.atividade_para_cargo('tarefas', public._novo_op('Operador: rodízio 1')::text, %L, 'rodízio (teste)')$$, public._cg('operador_juridico'))) = '00000'
  and public._tenta(format($$select public.atividade_para_cargo('tarefas', public._novo_op('Operador: rodízio 2')::text, %L, 'rodízio (teste)')$$, public._cg('operador_juridico'))) = '00000'
  and public._tenta(format($$select public.atividade_para_cargo('tarefas', public._novo_op('Operador: rodízio 3')::text, %L, 'rodízio (teste)')$$, public._cg('operador_juridico'))) = '00000'
  and public._tenta(format($$select public.atividade_para_cargo('tarefas', public._novo_op('Operador: rodízio 4')::text, %L, 'rodízio (teste)')$$, public._cg('operador_juridico'))) = '00000');
reset role;
select public._chk('39b conferência do rodízio',
  (select string_agg(case t.responsavel_id when :'cBia' then 'B' when :'cFab' then 'F' else '?' end, '' order by o.n) = 'BFBF'
     from public._op o join public.tarefas t on t.id = o.id where t.titulo like 'Operador: rodízio%'),
  (select string_agg(case t.responsavel_id when :'cBia' then 'Bia' when :'cFab' then 'Fábio' else '?' end, ' → ' order by o.n)
     from public._op o join public.tarefas t on t.id = o.id where t.titulo like 'Operador: rodízio%'));
select public._como(:'adm'); set role authenticated;
select public._chk('40 operador sai indicando quem assume (Fábio → Bia): só a carteira dele neste cargo passa à Bia; nada é criado',
  public._salvar_op('fila') = '00000'
  and public._tenta(format($$select public.cargo_encerrar(%L, 'Fábio deixou a operação (teste)', 'c0000000-0000-0000-0000-000000000003')$$, public._ocup('c0000000-0000-0000-0000-000000000008'))) = '00000');
reset role;
select public._chk('40b conferência: as 5 atividades do cargo estão com a Bia; o Fábio perdeu os acessos do cargo; a carteira do outro cargo da Bia não mudou de dono',
  (select count(*) = 5 and bool_and(t.responsavel_id = :'cBia') from public._op o join public.tarefas t on t.id = o.id)
  and (select acessos = '{}' from public.perfis where id = :'fab')
  and (select count(*) = 3 from public.responsavel_historico h join public._op o on o.id::text = h.registro where h.de = :'cFab' and h.para = :'cBia' and h.motivo like 'ocupação encerrada%'));
select public._como(:'adm'); set role authenticated;
select public._chk('41 operador sai sem indicar sucessor, com outro ocupante no cargo (Ana): a carteira dele vai para a FILA; depois a gestão distribui à única ocupante',
  public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000002', 'titular', 'Ana passa a operar (teste)')$$, public._cg('operador_juridico'))) = '00000'
  and public._tenta(format($$select public.cargo_encerrar(%L, 'Bia saiu da operação (teste)')$$, public._ocup('c0000000-0000-0000-0000-000000000003'))) = '00000');
reset role;
select public._chk('41b conferência: 5 na fila do cargo; a Ana (marketing + operadora) não recebeu nada sozinha',
  (select count(*) = 5 and bool_and(t.responsavel_id = public.cargo_fila(public._cg('operador_juridico'))) from public._op o join public.tarefas t on t.id = o.id)
  and (select acessos = '{clientes,growth,juridico,marketing,superendividamento}' from public.perfis where id = :'ana'));
select public._como(:'adm'); set role authenticated;
select public._chk('42 distribuir pendentes com uma única ocupante: a fila passa para a Ana', public._tenta(format($$select public.cargo_distribuir_pendentes(%L)$$, public._cg('operador_juridico'))) = '00000');
select public._chk('43 substituição nominal (Ana → Caio): o Caio assume a carteira da Ana neste cargo; a Ana mantém o Marketing',
  public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000004', 'titular', 'Caio assume no lugar da Ana (teste)', null, 'c0000000-0000-0000-0000-000000000002')$$, public._cg('operador_juridico'))) = '00000');
reset role;
select public._chk('43b conferência: 5 com o Caio; Ana só com o Marketing; nenhuma tarefa duplicada desde o caso 35 (só as 5 incluídas de propósito)',
  (select count(*) = 5 and bool_and(t.responsavel_id = :'cCaio') from public._op o join public.tarefas t on t.id = o.id)
  and (select acessos = '{growth,marketing}' from public.perfis where id = :'ana')
  and (select (select count(*) from public.tarefas) = n + 5 from _t35));
select public._chk('44 coordenação continua com um único titular: segundo titular gravado direto no banco é recusado (23505)',
  public._tenta(format($$insert into public.cargo_ocupacoes (cargo_id, colaborador_id, tipo) values (%L, 'c0000000-0000-0000-0000-000000000002', 'titular')$$, public._cg('responsavel_juridico'))) = '23505');
-- fonte única
select public._chk('45 fonte única: nenhuma divergência entre os acessos gravados e os dos cargos ativos', (select count(*) = 0 from public.v_cargos_divergencias));
select set_config('np.cargos_sync', '1', false);
update public.colaboradores set nucleo = 'acompanhamento_pj', frente = 'estrategico' where id = :'cBia';   -- campo legado adulterado por fora da gestão
select set_config('np.cargos_sync', '', false);
select public._como(:'bia'); set role authenticated;
select public._chk('46 pessoa gerida por cargo: o campo legado (núcleo/frente na ficha) NÃO concede permissão — só os cargos ativos contam', not public.edita_protecao());
reset role;
select set_config('np.cargos_sync', '1', false);
update public.colaboradores set nucleo = 'juridico', frente = 'juridico' where id = :'cBia';
select set_config('np.cargos_sync', '', false);
select public._como(:'adm'); set role authenticated;
select public._chk('47 nem a administradora desliga a gestão por cargo de quem ocupa cargo (23514): não há segunda fonte de acesso',
  public._tenta($$update public.colaboradores set acesso_por_cargo = false where id = 'c0000000-0000-0000-0000-000000000003'$$) = '23514');
reset role;
-- autoelevação
select public._como(:'caio'); set role authenticated;
select public._chk('48 autoelevação: quem não é administradora não se designa, não cria cargo, não muda ordem, não encerra ocupação, não envia atividade a cargo (42501)',
  public._tenta(format($$select public.cargo_designar(%L, 'c0000000-0000-0000-0000-000000000004', 'titular', 'eu mesmo')$$, public._cg('responsavel_acompanhamento_pj'))) = '42501'
  and public._tenta($$select public.cargo_salvar(null, 'meu_cargo', 'Meu cargo', 'socios', null, '{financeiro,protecao}')$$) = '42501'
  and public._tenta(format($$select public.cargo_ordem(%L, 1)$$, public._ocup('c0000000-0000-0000-0000-000000000004'))) = '42501'
  and public._tenta(format($$select public.cargo_encerrar(%L, 'encerrando outro')$$, (select id from public.cargo_ocupacoes where fim is null and colaborador_id = 'c0000000-0000-0000-0000-000000000002' limit 1))) = '42501'
  and public._tenta(format($$select public.atividade_para_cargo('tarefas', %L, %L, 'puxando para mim')$$, (select id from public._op limit 1), public._cg('responsavel_acordos'))) = '42501'
  and public._tenta($$insert into public.cargo_ocupacoes (cargo_id, colaborador_id) select id, 'c0000000-0000-0000-0000-000000000004' from public.cargos where codigo = 'responsavel_financeiro'$$) = '42501'
  and public._tenta($$update public.cargos set acessos = acessos || '{financeiro}'::text[]$$) = '42501');
select public._tenta($$update public.perfis set papel = 'admin' where id = 'a0000000-0000-0000-0000-000000000004'$$) as t49a \gset
select public._tenta($$update public.perfis set acessos = '{financeiro,protecao,equipe}' where id = 'a0000000-0000-0000-0000-000000000004'$$) as t49b \gset
select public._tenta($$update public.colaboradores set acesso_por_cargo = false, nucleo = 'socios' where id = 'c0000000-0000-0000-0000-000000000004'$$) as t49c \gset
reset role;
select public._chk('49 autoelevação por cadastro: a pessoa não vira administradora, não amplia os próprios acessos e não troca o próprio núcleo',
  (select papel = 'colaborador' and not ('financeiro' = any(acessos)) and not ('protecao' = any(acessos)) from public.perfis where id = :'caio')
  and (select acesso_por_cargo and nucleo <> 'socios' from public.colaboradores where id = :'cCaio'),
  'tentativas: papel ' || :'t49a' || ' · acessos ' || :'t49b' || ' · ficha ' || :'t49c');

\echo
select case when ok then 'ok    ' else 'FALHA ' end || caso || case when det <> '' then '  [' || det || ']' else '' end from public._res order by n;
select 'resumo';
select count(*) filter (where ok) || ' de ' || count(*) || ' casos conformes' from public._res;
