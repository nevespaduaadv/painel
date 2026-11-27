-- 0129 — Dados financeiros só para quem tem acesso ao Financeiro (decisão das sócias, 27/11/2026)
-- Aplicada na produção em 27/11/2026, 15h30, pelo editor SQL.
--
-- Antes: qualquer colaborador com login lia, no banco, as cobranças ligadas a um cliente (2.378 de 2.645) e, por elas, as visões
-- v_cobrancas, v_central_cobrancas, v_cobrancas_negociadas, v_regua_cobranca, v_regua_acumulado, v_financeiro_mes e v_fin_*;
-- lia também os fechamentos vindos da planilha (valor do contrato, entrada, parcelas) e o registro das sincronizações.
-- As telas já escondiam isso de quem não tem a área; o banco, não.
--
-- Agora a leitura exige pode_financeiro() (administradoras e quem tem a área "financeiro"). As visões são security_invoker:
-- fecham junto com a tabela de origem. Três funções que entregavam dado financeiro por outro caminho também foram fechadas.
--
-- Efeito na tela para quem NÃO tem a área: o balão de adimplência da ficha do cliente deixa de aparecer (a contagem volta zero
-- e a ficha não mostra nada nesse caso). A aba Financeiro da ficha já era só de quem tem a área. Nenhuma regra financeira muda.
--
-- Conferido depois de aplicar, simulando os logins: Ana Luiza, Maria Flávia, Natasha e Maria Eulália leem ZERO linhas em todas as
-- tabelas e visões financeiras e continuam lendo clientes, tarefas, prazos e onboarding; Marina (com a área) lê tudo como antes;
-- a tela Financeiro › Visão geral abre normalmente para a administradora.

begin;

drop policy if exists "cobrancas: financeiro le" on public.cobrancas;
create policy "cobrancas: financeiro le" on public.cobrancas for select to authenticated using (public.pode_financeiro());

drop policy if exists fech_sel on public.fechamentos_planilha;
create policy fech_sel on public.fechamentos_planilha for select to authenticated using (public.pode_financeiro());

drop policy if exists pfs_sel on public.planilha_financeiro_sincronizacoes;
create policy pfs_sel on public.planilha_financeiro_sincronizacoes for select to authenticated using (public.pode_financeiro());

-- resumo_financeiro_texto conferia a área da PESSOA DO RESUMO, não de quem chamava: qualquer login pedia o resumo de uma sócia
-- e recebia os totais. Passa a devolver vazio quando quem chama está logado e não tem a área (o envio agendado, sem login, segue igual).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'resumo_financeiro_texto';
  if position('pode_financeiro()' in d) > 0 then return; end if;
  novo := regexp_replace(d, 'begin\s+select c\.perfil_id into perfil', 'begin if auth.uid() is not null and not public.pode_financeiro() then return null; end if; select c.perfil_id into perfil');
  if novo = d then raise exception 'trecho não encontrado em resumo_financeiro_texto'; end if;
  execute novo;
end $$;
revoke all on function public.resumo_financeiro_texto(uuid) from public, anon, authenticated;
grant execute on function public.resumo_financeiro_texto(uuid) to service_role;

-- asaas_cliente_do_sistema dizia, a quem perguntasse SEM LOGIN, se um CPF/CNPJ é cliente. Só as rotinas do Asaas precisam dela.
revoke all on function public.asaas_cliente_do_sistema(text, text, text) from public, anon, authenticated;
grant execute on function public.asaas_cliente_do_sistema(text, text, text) to service_role;

-- onboarding_entrada_ok ("a entrada foi paga?") continua para a equipe, porque a regra da R1 depende dela; sai de quem não tem login.
revoke all on function public.onboarding_entrada_ok(text) from public, anon;
grant execute on function public.onboarding_entrada_ok(text) to authenticated, service_role;

commit;

-- Reversão das políticas (volta ao que era):
--   drop policy "cobrancas: financeiro le" on public.cobrancas;
--   create policy "cobrancas: financeiro le" on public.cobrancas for select to authenticated using (public.pode_financeiro() or (public.sou_equipe() and cliente_id is not null));
--   drop policy fech_sel on public.fechamentos_planilha; create policy fech_sel on public.fechamentos_planilha for select to authenticated using (public.sou_equipe());
--   drop policy pfs_sel on public.planilha_financeiro_sincronizacoes; create policy pfs_sel on public.planilha_financeiro_sincronizacoes for select to authenticated using (public.sou_equipe());
