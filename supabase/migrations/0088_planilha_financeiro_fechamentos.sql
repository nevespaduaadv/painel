-- 0088 — Metas do mês ligadas à planilha "Controle de clientes - Financeiro" (Google Sheets, uma aba por mês).
-- Um Apps Script na planilha envia as abas a cada 10 min para sincronizar_planilha_financeiro(); aqui gravamos os
-- fechamentos (fechamentos_planilha), recalculamos contratos/valor por semana em comercial_semanas (só Gestão de
-- Passivos conta) e preenchemos origem/data de fechamento de clientes que estão sem. Token: configurar_planilha_financeiro().
-- Idempotente. Depende de 0025 (comercial), 0082 (num_br) e da infra de integrações (privado.integracoes).

create table if not exists public.fechamentos_planilha (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  aba text not null,
  mes date not null,
  nome text not null,
  nome_norm text not null,
  origem text, data_fechamento date, produto text,
  valor numeric(12,2), exito numeric(6,2), entrada numeric(12,2), data_entrada date, entrada_paga boolean,
  parcela numeric(12,2), parcelamento text, dia_pagamento text, status_pagamento text,
  gestao_passivos boolean not null default false,
  cliente_id text references public.clientes(id) on delete set null,
  recebido_em timestamptz not null default now(),
  unique (ano, mes, nome_norm)
);
alter table public.fechamentos_planilha enable row level security;
drop policy if exists fech_sel on public.fechamentos_planilha;
create policy fech_sel on public.fechamentos_planilha for select to authenticated using (public.sou_equipe());
grant select on public.fechamentos_planilha to authenticated;

create table if not exists public.planilha_financeiro_sincronizacoes (
  id bigserial primary key, abas integer not null, linhas integer not null, meses_recalculados integer not null, erros jsonb not null default '[]', created_at timestamptz not null default now()
);
alter table public.planilha_financeiro_sincronizacoes enable row level security;
drop policy if exists pfs_sel on public.planilha_financeiro_sincronizacoes;
create policy pfs_sel on public.planilha_financeiro_sincronizacoes for select to authenticated using (public.sou_equipe());
grant select on public.planilha_financeiro_sincronizacoes to authenticated;

-- num_br passa a devolver null quando não há dígito ("-", "n/a")
create or replace function public.num_br(t text) returns numeric language sql immutable as $$
  select case
    when t is null or btrim(t) = '' or t !~ '\d' then null
    when t ~ ',' then replace(replace(regexp_replace(t, '[^0-9,.\-]', '', 'g'), '.', ''), ',', '.')::numeric
    when t ~ '^-?\d{1,3}(\.\d{3})+$' then replace(t, '.', '')::numeric
    when t ~ '^-?\d+(\.\d+)?$' then t::numeric
    else nullif(regexp_replace(t, '[^0-9.\-]', '', 'g'), '')::numeric end
$$;

create or replace function public.norm_nome(t text) returns text language sql immutable as $$
  select upper(regexp_replace(public.unaccent(coalesce(t,'')), '[^A-Za-z0-9]+', ' ', 'g'))
$$;

create or replace function public.mes_da_aba(aba text, ano integer) returns date language sql immutable as $$
  select case
    when aba ~* '^JAN' then make_date(ano,1,1) when aba ~* '^FEV' then make_date(ano,2,1) when aba ~* '^MAR' then make_date(ano,3,1)
    when aba ~* '^ABR' then make_date(ano,4,1) when aba ~* '^MAI' then make_date(ano,5,1) when aba ~* '^JUN' then make_date(ano,6,1)
    when aba ~* '^JUL' then make_date(ano,7,1) when aba ~* '^AGO' then make_date(ano,8,1) when aba ~* '^SET' then make_date(ano,9,1)
    when aba ~* '^OUT' then make_date(ano,10,1) when aba ~* '^NOV' then make_date(ano,11,1) when aba ~* '^DEZ' then make_date(ano,12,1) end
$$;

-- gera as semanas do mês (mesma regra da tela: seg→dom, pontas com menos de 3 dias se juntam) se ainda não existirem
create or replace function public.comercial_semanas_garantir(p_mes date) returns integer
language plpgsql security definer set search_path = public as $$
declare d date := p_mes; fim date := (p_mes + interval '1 month' - interval '1 day')::date; s0 date; s1 date; n integer := 0; du integer; rows_ jsonb := '[]'; r jsonb; arr jsonb;
begin
  if exists (select 1 from public.comercial_semanas where mes = p_mes) then return 0; end if;
  while d <= fim loop
    s0 := d; du := 0;
    loop
      if extract(isodow from d) < 6 then du := du + 1; end if;
      d := d + 1;
      exit when d > fim or extract(isodow from d) = 1;
    end loop;
    s1 := d - 1;
    rows_ := rows_ || jsonb_build_array(jsonb_build_object('inicio', s0, 'fim', s1, 'du', du));
  end loop;
  -- pontas curtas
  if jsonb_array_length(rows_) > 1 and ((rows_->0->>'fim')::date - (rows_->0->>'inicio')::date + 1) < 3 then
    rows_ := jsonb_set(rows_, '{1,inicio}', rows_->0->'inicio'); rows_ := jsonb_set(rows_, '{1,du}', to_jsonb((rows_->1->>'du')::int + (rows_->0->>'du')::int)); rows_ := rows_ - 0;
  end if;
  if jsonb_array_length(rows_) > 1 and ((rows_->-1->>'fim')::date - (rows_->-1->>'inicio')::date + 1) < 3 then
    arr := rows_ - (jsonb_array_length(rows_) - 1);
    arr := jsonb_set(arr, array[(jsonb_array_length(arr)-1)::text,'fim'], rows_->-1->'fim');
    arr := jsonb_set(arr, array[(jsonb_array_length(arr)-1)::text,'du'], to_jsonb((arr->-1->>'du')::int + (rows_->-1->>'du')::int));
    rows_ := arr;
  end if;
  for r in select * from jsonb_array_elements(rows_) loop
    n := n + 1;
    insert into public.comercial_semanas (mes, semana, inicio, fim, dias_uteis) values (p_mes, n, (r->>'inicio')::date, (r->>'fim')::date, (r->>'du')::int) on conflict do nothing;
  end loop;
  return n;
end $$;

-- recalcula contratos/valor das semanas do mês a partir da planilha (só Gestão de Passivos)
create or replace function public.comercial_recalcular_mes(p_mes date) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; s record; c integer; v numeric;
begin
  perform public.comercial_semanas_garantir(p_mes);
  for s in select * from public.comercial_semanas where mes = p_mes loop
    select count(*), coalesce(sum(valor),0) into c, v from public.fechamentos_planilha f
     where f.mes = p_mes and f.gestao_passivos and f.data_fechamento between s.inicio and s.fim;
    update public.comercial_semanas set contratos = c, valor = v, lancado = lancado or c > 0, updated_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.sincronizar_planilha_financeiro(token text, ano integer, abas jsonb)

returns jsonb language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare p_ano integer := ano; integ privado.integracoes; a jsonb; cab jsonb; ln jsonb; mapa jsonb; i integer; k text; d jsonb; nabas integer := 0; nlin integer := 0;
        meses date[] := '{}'; m date; cid text; produto text; gp boolean; nm text; erros jsonb := '[]'; recalc integer := 0;
begin
  select * into integ from privado.integracoes where nome = 'planilha_financeiro' and ativa and token_sha256 = encode(sha256(convert_to(coalesce(token,''), 'UTF8')), 'hex');
  if not found then raise exception 'Token inválido.' using errcode = '28000'; end if;
  update privado.integracoes set ultima_chamada = now() where nome = 'planilha_financeiro';
  for a in select * from jsonb_array_elements(abas) loop
    m := public.mes_da_aba(a->>'aba', p_ano); if m is null then continue; end if;
    nabas := nabas + 1; meses := array_append(meses, m);
    cab := a->'cabecalho'; mapa := '{}';
    for i in 0 .. coalesce(jsonb_array_length(cab),0) - 1 loop
      k := lower(public.unaccent(btrim(cab->>i)));
      mapa := mapa || jsonb_build_object(case
        when k = 'nome' then 'nome' when k = 'origem' then 'origem' when k like 'data fechamento%' then 'data_fechamento' when k like 'produto%' then 'produto'
        when k like 'valor do contrato%' then 'valor' when k = 'exito' then 'exito' when k like 'entrada/receita%' or k = 'entrada' then 'entrada'
        when k like 'data entrada%' then 'data_entrada' when k like 'entrada paga%' then 'entrada_paga' when k like 'valor parcela%' then 'parcela'
        when k like 'parcelamento%' then 'parcelamento' when k like 'dia do pagamento%' then 'dia_pagamento' when k like 'status de pagamento%' then 'status_pagamento' else '_' || i end, i);
    end loop;
    -- limpa a aba e regrava (a planilha é a fonte da verdade)
    delete from public.fechamentos_planilha f where f.ano = p_ano and f.aba = a->>'aba';
    for ln in select * from jsonb_array_elements(a->'linhas') loop
      d := '{}';
      for k in select key from jsonb_each(mapa) loop d := d || jsonb_build_object(k, ln->>((mapa->>k)::int)); end loop;
      nm := btrim(coalesce(d->>'nome',''));
      if nm = '' or upper(nm) = 'TOTAL' then continue; end if;
      produto := nullif(btrim(d->>'produto'), '');
      gp := coalesce(produto ~* 'passiv', false);
      select c.id into cid from public.clientes c where public.norm_nome(c.nome) = public.norm_nome(nm) or public.norm_nome(c.nome) like public.norm_nome(nm) || ' %' order by length(c.nome) limit 1;
      begin
        insert into public.fechamentos_planilha (ano, aba, mes, nome, nome_norm, origem, data_fechamento, produto, valor, exito, entrada, data_entrada, entrada_paga, parcela, parcelamento, dia_pagamento, status_pagamento, gestao_passivos, cliente_id)
        values (p_ano, a->>'aba', m, nm, public.norm_nome(nm), nullif(btrim(d->>'origem'),''), public.converter_data_br(d->>'data_fechamento')::date, produto,
                public.num_br(d->>'valor'), public.num_br(replace(d->>'exito','%','')), public.num_br(d->>'entrada'), public.converter_data_br(d->>'data_entrada')::date,
                case upper(btrim(coalesce(d->>'entrada_paga',''))) when 'SIM' then true when 'NAO' then false when 'NÃO' then false else null end,
                public.num_br(d->>'parcela'), nullif(btrim(d->>'parcelamento'),''), nullif(btrim(d->>'dia_pagamento'),''), nullif(btrim(d->>'status_pagamento'),''), gp, cid)
        on conflict (ano, mes, nome_norm) do update set aba = excluded.aba, origem = excluded.origem, data_fechamento = excluded.data_fechamento, produto = excluded.produto, valor = excluded.valor, exito = excluded.exito,
          entrada = excluded.entrada, data_entrada = excluded.data_entrada, entrada_paga = excluded.entrada_paga, parcela = excluded.parcela, parcelamento = excluded.parcelamento,
          dia_pagamento = excluded.dia_pagamento, status_pagamento = excluded.status_pagamento, gestao_passivos = excluded.gestao_passivos, cliente_id = excluded.cliente_id, recebido_em = now();
        nlin := nlin + 1;
        -- preenche no cadastro do cliente o que está vazio (origem, data de fechamento)
        if cid is not null then
          update public.clientes set dados = dados
             || case when coalesce(dados->>'origem','') = '' and nullif(btrim(d->>'origem'),'') is not null then jsonb_build_object('origem', btrim(d->>'origem')) else '{}'::jsonb end
             || case when coalesce(dados->>'data_fechamento','') = '' and public.converter_data_br(d->>'data_fechamento') is not null then jsonb_build_object('data_fechamento', to_char(public.converter_data_br(d->>'data_fechamento'),'YYYY-MM-DD')) else '{}'::jsonb end
           where id = cid;
        end if;
      exception when others then erros := erros || jsonb_build_object('aba', a->>'aba', 'nome', nm, 'erro', sqlerrm);
      end;
    end loop;
  end loop;
  for m in select distinct unnest(meses) loop recalc := recalc + 1; perform public.comercial_recalcular_mes(m); end loop;
  insert into public.planilha_financeiro_sincronizacoes (abas, linhas, meses_recalculados, erros) values (nabas, nlin, recalc, erros);
  return jsonb_build_object('abas', nabas, 'linhas', nlin, 'meses', recalc, 'erros', erros);
end $$;
revoke all on function public.sincronizar_planilha_financeiro(text, integer, jsonb) from public;
grant execute on function public.sincronizar_planilha_financeiro(text, integer, jsonb) to anon, authenticated;

-- token novo para o Apps Script (rodar no editor SQL; copiar o resultado para o script; rodar de novo troca o token)
create or replace function public.configurar_planilha_financeiro() returns text
language plpgsql security definer set search_path = public as $$
declare token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into privado.integracoes (nome, token_sha256, ativa) values ('planilha_financeiro', encode(sha256(convert_to(token, 'UTF8')), 'hex'), true)
  on conflict (nome) do update set token_sha256 = excluded.token_sha256, ativa = true;
  return token;
end $$;
revoke all on function public.configurar_planilha_financeiro() from public, anon, authenticated;

create or replace view public.v_fechamentos_mes with (security_invoker = true) as
select f.*, c.nome as cliente_nome,
       (select max(created_at) from public.planilha_financeiro_sincronizacoes) as ultima_sincronizacao
from public.fechamentos_planilha f left join public.clientes c on c.id = f.cliente_id;
grant select on public.v_fechamentos_mes to authenticated;

select 'ok 0088' as resultado;
