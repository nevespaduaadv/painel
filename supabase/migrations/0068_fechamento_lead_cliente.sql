-- 0068 — Formulário de fechamento: lead Ganho → cliente na carteira + contatos + contratos (dívidas por banco) + tarefas.
-- Guarda o formulário completo em public.fechamentos (base para o contrato de honorários .docx, a cobrança da entrada e a comissão).
-- Idempotente. Depende de 0008 (ficha), 0010 (fluxo PJ: gatilho fluxo_novo_cliente abre onboarding), 0027 (leads), 0051 (helpers), 0061 (discord_fila).

alter table public.leads add column if not exists cliente_id text references public.clientes(id) on delete set null;
create index if not exists leads_cliente_idx on public.leads(cliente_id) where cliente_id is not null;
alter table public.clientes add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.clientes add column if not exists pasta_drive_id text;
alter table public.clientes add column if not exists pasta_drive_url text;
alter table public.clientes add column if not exists email text;
alter table public.clientes add column if not exists telefone text;
alter table public.clientes add column if not exists cep text;

create table if not exists public.fechamentos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  cliente_id text not null references public.clientes(id) on delete cascade,
  dados jsonb not null,                       -- formulário completo (empresa, representante, dívidas, honorários, condições)
  closer_id uuid references public.colaboradores(id) on delete set null,
  contrato_gerado_em timestamptz,             -- .docx de honorários gerado
  contrato_url text,                          -- link do contrato (Drive / assinatura)
  created_at timestamptz not null default now(), created_by uuid
);
create index if not exists fechamentos_cliente_idx on public.fechamentos(cliente_id);
alter table public.fechamentos enable row level security;
drop policy if exists fech_sel on public.fechamentos;
create policy fech_sel on public.fechamentos for select to authenticated using (public.sou_equipe() and (public.tem_acesso('comercial') or public.tem_acesso('clientes')));
drop policy if exists fech_upd on public.fechamentos;
create policy fech_upd on public.fechamentos for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.fechamentos from anon;

-- configuração: quem recebe a tarefa do contrato e o canal do Discord (sem dado sensível)
insert into public.escritorio (id, dados) values ('fechamento', '{"responsavel_contrato_id": null, "canal_discord": null, "prazo_contrato_dias": 2}'::jsonb)
on conflict (id) do nothing;

-- id curto no padrão do front ("cli-…", "con-…")
create or replace function public.id_curto(prefixo text) returns text language sql volatile as $$
  select prefixo||'-'||substr(replace(gen_random_uuid()::text,'-',''), 1, 10)
$$;

-- p = { empresa:{nome, nome_fantasia, cnpj, tipo_pessoa, endereco, cidade, uf, cep, email, telefone, segmento, faturamento_mensal, funcionarios},
--       representante:{nome, cpf, qualificacao, email, telefone, estado_civil},
--       dividas:[{banco, titular, produto, garantia, situacao, valor_original, saldo_atual, data_contrato, data_inicio_atraso, parcelas_total, notas}],
--       honorarios:{entrada, parcelas, valor_parcela, vencimento_dia, exito_pct, mensalidade, forma, observacoes},
--       condicoes:{data_fechamento, plano, origem, observacoes, historia} }
create or replace function public.lead_fechar(p_lead uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.leads%rowtype;
  cfg jsonb := (select dados from public.escritorio where id = 'fechamento');
  rg jsonb := coalesce((select dados from public.regras where id = 'regras'), '{}'::jsonb);
  emp jsonb := coalesce(p->'empresa', '{}'::jsonb);
  rep jsonb := coalesce(p->'representante', '{}'::jsonb);
  hon jsonb := coalesce(p->'honorarios', '{}'::jsonb);
  cond jsonb := coalesce(p->'condicoes', '{}'::jsonb);
  d jsonb;
  novo_cli text; novo_con text; fech uuid;
  closer uuid := public.meu_colaborador();
  closer_nome text;
  resp_contrato uuid := nullif(cfg->>'responsavel_contrato_id','')::uuid;
  prazo_dias int := coalesce((cfg->>'prazo_contrato_dias')::int, 2);
  tem_atraso boolean := false;
  resumo_dividas text := '';
  n_dividas int := 0;
  total_saldo numeric := 0;
  nome_cli text := nullif(btrim(emp->>'nome'),'');
  dt_fech date := coalesce(nullif(cond->>'data_fechamento','')::date, current_date);
  tipos text[] := '{}';
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  if nome_cli is null then raise exception 'Informe a razão social / nome do cliente'; end if;
  select * into l from public.leads where id = p_lead;
  if l.id is null then raise exception 'Lead não encontrado'; end if;
  if l.cliente_id is not null then raise exception 'Este lead já foi fechado (cliente %)', l.cliente_id; end if;
  select nome into closer_nome from public.colaboradores where id = closer;

  -- ---------- cliente ----------
  novo_cli := public.id_curto('cli');
  for d in select * from jsonb_array_elements(coalesce(p->'dividas','[]'::jsonb)) loop
    n_dividas := n_dividas + 1;
    total_saldo := total_saldo + coalesce(nullif(d->>'saldo_atual','')::numeric, nullif(d->>'valor_original','')::numeric, 0);
    if coalesce(d->>'situacao','') not in ('emdia','quitado') then tem_atraso := true; end if;
    tipos := tipos || (coalesce(d->>'banco','?')||' — '||coalesce(d->>'produto','')||case when coalesce(d->>'titular','PJ')='PF' then ' (CPF do sócio)' else '' end);
  end loop;
  resumo_dividas := array_to_string(tipos, '; ');

  insert into public.clientes (id, dados, cnpj, cpf_titular, tipo_pessoa, nome_fantasia, cidade, uf, cep, endereco, email, telefone,
                               segmento, faturamento_mensal, funcionarios, historia, origem, closer, data_fechamento, plano, servico, status, etapa_fluxo,
                               tem_divida_atraso, tipos_dividas, representante, representante_cpf, representante_qualificacao, lead_id, ativo)
  values (novo_cli,
          jsonb_build_object('nome', nome_cli, 'cnpj', coalesce(emp->>'cnpj',''), 'responsavel', coalesce(closer_nome,''), 'reservaAcumulada', 0,
                             'notasInternas', coalesce(cond->>'observacoes',''), 'timeline', '[]'::jsonb, 'createdAt', now()),
          nullif(emp->>'cnpj',''), nullif(rep->>'cpf',''), coalesce(nullif(emp->>'tipo_pessoa',''),'PJ'), nullif(emp->>'nome_fantasia',''),
          nullif(emp->>'cidade',''), nullif(emp->>'uf',''), nullif(emp->>'cep',''), nullif(emp->>'endereco',''), nullif(emp->>'email',''), nullif(emp->>'telefone',''),
          nullif(emp->>'segmento',''), nullif(emp->>'faturamento_mensal','')::numeric, nullif(emp->>'funcionarios','')::int, nullif(cond->>'historia',''),
          coalesce(nullif(cond->>'origem',''), l.origem::text), closer_nome, dt_fech, coalesce(nullif(cond->>'plano',''),'gestao_passivos'),
          'gestao_passivos', 'onboarding', 0, tem_atraso, nullif(resumo_dividas,''),
          nullif(rep->>'nome',''), nullif(rep->>'cpf',''), nullif(rep->>'qualificacao',''), l.id, true);

  -- contato principal = representante (WhatsApp do lead se não vier outro) → o onboarding manda as boas-vindas para ele
  insert into public.contatos (cliente_id, nome, cargo, email, telefone, principal, papel, cpf)
  values (novo_cli, coalesce(nullif(rep->>'nome',''), l.nome), 'Sócio(a) / representante', coalesce(nullif(rep->>'email',''), l.email),
          coalesce(nullif(rep->>'telefone',''), l.whatsapp), true, 'socio', nullif(rep->>'cpf',''));

  -- ---------- contratos (dívidas por banco) no formato do motor da carteira ----------
  for d in select * from jsonb_array_elements(coalesce(p->'dividas','[]'::jsonb)) loop
    novo_con := public.id_curto('con');
    insert into public.contratos (id, cliente_id, dados) values (novo_con, novo_cli, jsonb_build_object(
      'clienteId', novo_cli, 'banco', btrim(coalesce(d->>'banco','')), 'titular', coalesce(nullif(d->>'titular',''),'PJ'),
      'produto', coalesce(nullif(d->>'produto',''),'giro'), 'garantia', coalesce(nullif(d->>'garantia',''),'nenhuma'),
      'situacao', coalesce(nullif(d->>'situacao',''),'cobranca'),
      'valorOriginal', coalesce(nullif(d->>'valor_original','')::numeric, 0),
      'saldoAtual', coalesce(nullif(d->>'saldo_atual','')::numeric, nullif(d->>'valor_original','')::numeric, 0),
      'dataContrato', coalesce(d->>'data_contrato',''), 'dataInicioAtraso', coalesce(d->>'data_inicio_atraso',''),
      'parcelasPagas', coalesce(nullif(d->>'parcelas_pagas','')::int, 0), 'parcelasTotal', coalesce(nullif(d->>'parcelas_total','')::int, 0),
      'prazoReservaMeses', coalesce((rg->>'prazoReservaPadrao')::int, 6), 'atualizacaoMensal', null, 'carteiraOverride', '',
      'notas', coalesce(d->>'notas',''), 'acordo', null, 'createdAt', now()));
    -- banco novo entra nas regras (fatoresBanco) como o front faz
    if coalesce(btrim(d->>'banco'),'') <> '' and not (rg->'fatoresBanco') ? btrim(d->>'banco') then
      rg := jsonb_set(coalesce(rg,'{}'::jsonb), array['fatoresBanco', btrim(d->>'banco')], '0'::jsonb, true);
      update public.regras set dados = rg, updated_at = now() where id = 'regras';
    end if;
  end loop;

  -- ---------- formulário guardado ----------
  insert into public.fechamentos (lead_id, cliente_id, dados, closer_id, created_by)
  values (l.id, novo_cli, p || jsonb_build_object('resumo', jsonb_build_object('dividas', n_dividas, 'saldo_total', total_saldo)), closer, auth.uid())
  returning id into fech;

  -- ---------- lead → Ganho ----------
  update public.leads set status = 'Ganho', fase_id = 10, cliente_id = novo_cli, data_fechamento = dt_fech,
         empresa = coalesce(nullif(empresa,''), nome_cli),
         valor = case when coalesce(valor,0) = 0 then coalesce(nullif(hon->>'entrada','')::numeric,0) + coalesce(nullif(hon->>'parcelas','')::numeric,0)*coalesce(nullif(hon->>'valor_parcela','')::numeric,0) else valor end
   where id = l.id;

  -- ---------- timeline interna ----------
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, responsavel_id, automatica, visivel_cliente)
  values (novo_cli, dt_fech, 'mudanca_estagio',
          format('Contrato fechado (closer: %s). %s dívida(s), saldo informado %s. Honorários: entrada %s%s%s.',
                 coalesce(closer_nome,'—'), n_dividas, public.brl(total_saldo),
                 public.brl(coalesce(nullif(hon->>'entrada','')::numeric,0)),
                 case when coalesce(nullif(hon->>'parcelas','')::int,0) > 0 then format(' + %sx %s', hon->>'parcelas', public.brl(nullif(hon->>'valor_parcela','')::numeric)) else '' end,
                 case when nullif(hon->>'exito_pct','') is not null then format(' · êxito %s%%', hon->>'exito_pct') else '' end),
          closer, true, false);

  -- ---------- tarefa do contrato de honorários ----------
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Contrato de honorários: gerar, conferir e enviar para assinatura — '||coalesce(nullif(emp->>'nome_fantasia',''), nome_cli),
          E'Formulário de fechamento preenchido pelo comercial (ficha do cliente → aba Fechamento).\nGere o .docx pelo botão "Contrato de honorários", confira os dados e envie para assinatura. Depois registre o link em Documentos.',
          novo_cli, coalesce(resp_contrato, public.responsavel_padrao('acompanhamento_pj'), closer), 'acompanhamento_pj', current_date + prazo_dias, 1);
  if coalesce(nullif(hon->>'entrada','')::numeric,0) > 0 and (p->>'emitir_cobranca') is distinct from 'true' then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Financeiro: emitir a cobrança da entrada — '||coalesce(nullif(emp->>'nome_fantasia',''), nome_cli),
            format('Entrada de %s%s. Emita no Asaas pela tela Financeiro → Nova cobrança (tipo "entrada"). O pagamento libera a R1 do onboarding automaticamente.',
                   public.brl(nullif(hon->>'entrada','')::numeric), case when nullif(hon->>'vencimento_dia','') is not null then ', vencimento dia '||(hon->>'vencimento_dia') else '' end),
            novo_cli, public.responsavel_padrao('administrativo'), 'administrativo', current_date + 1, 1);
  end if;

  -- ---------- Discord (#contratos-pj), sem dado sensível ----------
  if nullif(cfg->>'canal_discord','') is not null then
    insert into public.discord_fila (canal_discord, texto, referencia)
    values (cfg->>'canal_discord',
            format('📄 **Contrato fechado** — %s · %s dívida(s) · closer %s. Tarefa do contrato de honorários aberta no sistema.',
                   coalesce(nullif(emp->>'nome_fantasia',''), nome_cli), n_dividas, coalesce(closer_nome,'—')),
            'fechamento:'||fech::text);
  end if;

  return jsonb_build_object('cliente_id', novo_cli, 'fechamento_id', fech, 'dividas', n_dividas);
end $$;
revoke all on function public.lead_fechar(uuid, jsonb) from public, anon;
grant execute on function public.lead_fechar(uuid, jsonb) to authenticated;


-- v_leads usa l.*: recriar para expor leads.cliente_id
drop view if exists public.v_leads;
create view public.v_leads with (security_invoker = true) as
select l.*, f.nome as fase_nome, f.ordem as fase_ordem, f.cor as fase_cor, f.prazo_horas, f.dono as fase_dono, f.sigla as fase_sigla,
       coalesce(p.nome, p.email) as proprietario_nome,
       coalesce((select array_agg(t.nome order by t.nome) from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.lead_id = l.id), '{}') as tags,
       (select count(*) from public.observacoes o where o.lead_id = l.id) as total_observacoes,
       extract(day from now() - l.fase_desde)::int as dias_na_fase,
       round(extract(epoch from now() - l.fase_desde) / 3600)::int as horas_na_fase,
       case when l.status <> 'Aberto' or f.prazo_horas is null then 'ok'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) then 'estourado'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) * 0.8 then 'alerta'
            else 'ok' end as atraso,
       (select min(t.quando) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as proxima_tarefa,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as tarefas_abertas,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null and t.quando < now()) as tarefas_vencidas
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id;
revoke all on public.v_leads from anon;

-- view para a ficha do cliente / ficha do lead
create or replace view public.v_fechamentos with (security_invoker = true) as
select f.id, f.lead_id, f.cliente_id, f.dados, f.closer_id, co.nome as closer_nome, f.contrato_gerado_em, f.contrato_url, f.created_at,
       c.nome as cliente_nome, c.nome_fantasia, c.cnpj
from public.fechamentos f
left join public.colaboradores co on co.id = f.closer_id
join public.clientes c on c.id = f.cliente_id;

select 'ok 0068' as resultado;
