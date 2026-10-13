-- 0057 — Financeiro na Gestão → Visão geral (resumo + previsão 90 dias + inadimplentes) e no resumo diário (admins / área financeiro).
-- Idempotente. Depende de 0055 (cobrancas), 0056 (tem_acesso), 0050 (resumo_diario_texto).

create or replace function public.financeiro_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; m1 date := date_trunc('month', hoje)::date; r jsonb;
begin
  if not public.pode_financeiro() then return null; end if;
  select jsonb_build_object(
    'recebido_mes', coalesce((select sum(coalesce(valor_pago, valor)) from public.cobrancas where status = 'paga' and pago_em >= m1 and pago_em < m1 + interval '1 month'), 0),
    'recebido_mes_ant', coalesce((select sum(coalesce(valor_pago, valor)) from public.cobrancas where status = 'paga' and pago_em >= m1 - interval '1 month' and pago_em < m1), 0),
    'a_vencer_mes', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje and vencimento < m1 + interval '1 month'), 0),
    'atrasado', coalesce((select sum(valor) from public.cobrancas where status = 'atrasada'), 0),
    'atrasado_n', (select count(*) from public.cobrancas where status = 'atrasada'),
    'atrasado_clientes', (select count(distinct coalesce(cliente_id, asaas_cliente_id)) from public.cobrancas where status = 'atrasada'),
    'previsao_30', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje and vencimento < hoje + 30), 0),
    'previsao_60', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje + 30 and vencimento < hoje + 60), 0),
    'previsao_90', coalesce((select sum(valor) from public.cobrancas where status = 'pendente' and vencimento >= hoje + 60 and vencimento < hoje + 90), 0),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'recebido', coalesce(recebido,0), 'previsto', coalesce(previsto,0), 'atrasado', coalesce(atrasado,0)) order by mes), '[]'::jsonb)
              from public.v_financeiro_mes where mes >= to_char(m1 - interval '5 months', 'YYYY-MM') and mes <= to_char(m1 + interval '3 months', 'YYYY-MM')),
    'inadimplentes', (select coalesce(jsonb_agg(x order by x->>'valor' desc), '[]'::jsonb) from (
        select jsonb_build_object('cliente_id', c.cliente_id, 'nome', coalesce(cl.nome_fantasia, cl.dados->>'nome', (select nome from public.asaas_clientes a where a.asaas_id = c.asaas_cliente_id), c.asaas_cliente_id),
                                  'valor', sum(c.valor), 'n', count(*), 'dias', max(hoje - c.vencimento), 'no_sistema', c.cliente_id is not null) x
        from public.cobrancas c left join public.clientes cl on cl.id = c.cliente_id
        where c.status = 'atrasada' group by c.cliente_id, c.asaas_cliente_id, cl.nome_fantasia, cl.dados->>'nome' order by sum(c.valor) desc limit 12) s)
  ) into r;
  return r;
end $$;
grant execute on function public.financeiro_resumo() to authenticated;

-- resumo diário: bloco financeiro para admins / quem tem a área
create or replace function public.resumo_financeiro_texto(p_colab uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare perfil uuid; ok boolean; hoje date := (now() at time zone 'America/Sao_Paulo')::date; m1 date := date_trunc('month', hoje)::date;
        rec numeric; venc_hoje numeric; n_hoje int; atr numeric; n_atr int; novos_atr int; pagos_ontem numeric; n_ontem int; t text := '';
begin
  select c.perfil_id into perfil from public.colaboradores c where c.id = p_colab;
  if perfil is null then return null; end if;
  select p.papel = 'admin' or 'financeiro' = any(coalesce(p.acessos,'{}')) into ok from public.perfis p where p.id = perfil;
  if not coalesce(ok, false) then return null; end if;
  select coalesce(sum(coalesce(valor_pago, valor)),0) into rec from public.cobrancas where status = 'paga' and pago_em >= m1;
  select coalesce(sum(coalesce(valor_pago, valor)),0), count(*) into pagos_ontem, n_ontem from public.cobrancas where status = 'paga' and pago_em = hoje - 1;
  select coalesce(sum(valor),0), count(*) into venc_hoje, n_hoje from public.cobrancas where status = 'pendente' and vencimento = hoje;
  select coalesce(sum(valor),0), count(*) into atr, n_atr from public.cobrancas where status = 'atrasada';
  select count(*) into novos_atr from public.cobrancas where status = 'atrasada' and vencimento = hoje - 1;
  t := E'\n💰 *Financeiro*\n• Recebido no mês: ' || public.brl(rec) || E'\n';
  if n_ontem > 0 then t := t || '• Ontem: ' || n_ontem || ' pagamento(s), ' || public.brl(pagos_ontem) || E'\n'; end if;
  if n_hoje > 0 then t := t || '• Vence hoje: ' || n_hoje || ' cobrança(s), ' || public.brl(venc_hoje) || E'\n'; end if;
  t := t || '• Em atraso: ' || n_atr || ' cobrança(s), ' || public.brl(atr) || case when novos_atr > 0 then ' (' || novos_atr || ' venceu ontem)' else '' end || E'\n';
  return t;
end $$;
revoke all on function public.resumo_financeiro_texto(uuid) from public, anon;

create or replace function public.resumo_diario_texto(p_colab uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  c record; hoje date := (now() at time zone 'America/Sao_Paulo')::date; r record; t text := ''; n int; painel text; fin text;
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
begin
  select * into c from public.colaboradores where id = p_colab;
  if c is null then return null; end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PAINEL_URL' limit 1), 'https://nevespaduaadv.github.io/painel') into painel;
  t := '☀️ *Bom dia, ' || split_part(c.nome, ' ', 1) || '!* ' || dias[extract(dow from hoje)::int + 1] || ', ' || to_char(hoje, 'DD/MM') || E'\n';

  select count(*) into n from public.agenda_eventos e where e.colaborador_id = p_colab and not e.cancelado and (e.inicio at time zone 'America/Sao_Paulo')::date = hoje;
  if n > 0 then
    t := t || E'\n📆 *Agenda de hoje (' || n || ')*' || E'\n';
    for r in select * from public.agenda_eventos e where e.colaborador_id = p_colab and not e.cancelado and (e.inicio at time zone 'America/Sao_Paulo')::date = hoje order by e.dia_inteiro desc, e.inicio limit 10 loop
      t := t || '• ' || case when r.dia_inteiro then 'dia todo' else to_char(r.inicio at time zone 'America/Sao_Paulo', 'HH24:MI') end || ' ' || left(r.titulo, 70) || coalesce(' — ' || nullif(r.local,''), '') || E'\n';
    end loop;
    if n > 10 then t := t || '  … e mais ' || (n - 10) || E'\n'; end if;
  end if;

  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada';
  if n > 0 then
    t := t || E'\n🔴 *Atrasado (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'atrasada' order by z.prazo limit 8 loop
      t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || ' (' || to_char(r.prazo,'DD/MM') || case when r.prazo_fatal then ', FATAL' else '' end || ')' || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje';
  t := t || E'\n📌 *Vence hoje (' || n || ')*' || E'\n';
  if n = 0 then t := t || '• nada para hoje' || E'\n'; end if;
  for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'hoje' order by z.prazo_fatal desc, z.descricao limit 10 loop
    t := t || '• ' || left(r.descricao, 70) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️ FATAL' else '' end || E'\n';
  end loop;

  select count(*) into n from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7';
  if n > 0 then
    t := t || E'\n📅 *Próximos 7 dias (' || n || ')*' || E'\n';
    for r in select * from public.v_prazos z where z.responsavel_id = p_colab and z.faixa = 'd7' order by z.prazo, z.prazo_fatal desc limit 8 loop
      t := t || '• ' || to_char(r.prazo,'DD/MM') || ' ' || left(r.descricao, 60) || coalesce(' — ' || r.cliente_nome, '') || case when r.prazo_fatal then ' ⚠️' else '' end || E'\n';
    end loop;
    if n > 8 then t := t || '  … e mais ' || (n - 8) || E'\n'; end if;
  end if;

  if c.perfil_id is not null then
    select count(*) into n from public.lead_tarefas lt where lt.responsavel_id = c.perfil_id and lt.concluida_em is null and (lt.quando at time zone 'America/Sao_Paulo')::date <= hoje;
    if n > 0 then t := t || E'\n📞 *Leads: ' || n || ' tarefa(s) para hoje ou atrasada(s)*' || E'\n'; end if;
    select count(*) into n from public.notificacoes x where x.perfil_id = c.perfil_id and x.lida_em is null;
    if n > 0 then t := t || E'\n🔔 ' || n || ' notificação(ões) não lida(s) no painel' || E'\n'; end if;
  end if;

  fin := public.resumo_financeiro_texto(p_colab);
  if fin is not null then t := t || fin; end if;

  t := t || E'\n' || painel || '/#painel';
  return t;
end $$;

select 'ok 0057' as resultado;
