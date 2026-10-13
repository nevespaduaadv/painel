-- 0051 — Operação PJ (setor de acordos):
--   (a) régua de maturação: alerta + tarefa aos 6 meses de inadimplência de cada contrato e no 10º/11º/12º mês de contrato do cliente;
--   (b) pós-acordo: ao registrar um acordo, abre as tarefas de depoimento/indicação, prova social e relatório de conclusão;
--   (c) direcionamento do cliente (acordos extrajudicial × jurídico PJ) na ficha → abre a tarefa no núcleo certo e garante a negociação.
-- Idempotente. Depende de 0010 (fluxo PJ, negociacoes, tarefas), 0034 (notificar), 0038 (resumo), 0003 (acordos).

-- ---------- helpers: responsável padrão de um núcleo, aviso no sino do colaborador, formato R$
-- (as tarefas criadas aqui já avisam o responsável pelo gatilho tarefa_trilha de 0034 — por isso não há aviso duplicado) ----------
create or replace function public.responsavel_padrao(p_nucleo text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.colaboradores where ativo and nucleo = p_nucleo order by data_admissao nulls last limit 1
$$;
revoke all on function public.responsavel_padrao(text) from public, anon;

create or replace function public.notificar_colaborador(p_colab uuid, p_titulo text, p_texto text, p_link text) returns void
language plpgsql security definer set search_path = public as $$
declare perfil uuid;
begin
  if p_colab is null then return; end if;
  select perfil_id into perfil from public.colaboradores where id = p_colab;
  if perfil is not null then perform public.notificar(perfil, p_titulo, p_texto, p_link); end if;
end $$;
revoke all on function public.notificar_colaborador(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.brl(v numeric) returns text language sql immutable as $$
  select case when v is null then null else 'R$ ' || replace(replace(replace(to_char(v, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.') end
$$;

-- responsável do setor de acordos para um cliente/contrato: quem está com a negociação aberta; senão o padrão do núcleo
create or replace function public.responsavel_acordos(p_cliente text, p_contrato text default null) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select n.responsavel_id from public.negociacoes n where n.cliente_id = p_cliente and n.responsavel_id is not null and n.etapa <> 'concluido'
       order by (n.contrato_id = p_contrato) desc nulls last, n.updated_at desc limit 1),
    (select n.responsavel_id from public.negociacoes n where n.cliente_id = p_cliente and n.responsavel_id is not null order by n.updated_at desc limit 1),
    public.responsavel_padrao('acordos'))
$$;
revoke all on function public.responsavel_acordos(text, text) from public, anon;

-- ---------- (a) régua de maturação ----------
create table if not exists public.maturacao_alertas (
  id bigserial primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  contrato_id text references public.contratos(id) on delete cascade,
  tipo text not null,                       -- atraso_6m | contrato_10m | contrato_11m | contrato_12m
  referencia date,                          -- data que disparou (início do atraso / fechamento)
  tarefa_id uuid references public.tarefas(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists maturacao_alertas_uidx on public.maturacao_alertas (cliente_id, coalesce(contrato_id,''), tipo);
alter table public.maturacao_alertas enable row level security;
drop policy if exists "maturacao: equipe le" on public.maturacao_alertas;
create policy "maturacao: equipe le" on public.maturacao_alertas for select to authenticated using (public.sou_equipe());

create or replace function public.acordos_regua_maturacao() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; resp uuid; tid uuid; nome text; meses int; titulo text; descr text;
begin
  -- 1) 6 meses de inadimplência por contrato (sem acordo registrado, contrato ainda em cobrança/ajuizado)
  for r in
    select k.id as contrato_id, k.cliente_id, k.banco, k.produto, k.data_inicio_atraso, k.saldo_atual, coalesce(c.nome_fantasia, c.dados->>'nome', c.id) as cliente_nome
    from public.contratos k join public.clientes c on c.id = k.cliente_id
    where k.data_inicio_atraso is not null and k.data_inicio_atraso <= current_date - interval '6 months'
      and coalesce(k.situacao,'') not in ('quitado','emdia')
      and coalesce(c.status,'ativo') = 'ativo'
      and not exists (select 1 from public.acordos a where a.contrato_id = k.id)
      and not exists (select 1 from public.maturacao_alertas m where m.contrato_id = k.id and m.tipo = 'atraso_6m')
  loop
    resp := public.responsavel_acordos(r.cliente_id, r.contrato_id);
    titulo := 'Acordos: 6 meses de atraso — ' || coalesce(r.banco,'banco') || coalesce(' · ' || nullif(r.produto,''), '') || ' (' || r.cliente_nome || ')';
    descr := 'Contrato em atraso desde ' || to_char(r.data_inicio_atraso,'DD/MM/YYYY') || coalesce(' · saldo ' || public.brl(r.saldo_atual), '') ||
             E'.\nMaturação atingida: janela típica de proposta do banco. Revise a negociação (valores, alçada do cliente e próximo passo) e registre a proposta.';
    insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
    values (titulo, descr, r.cliente_id, r.contrato_id, resp, 'acordos', current_date + 3, 1) returning id into tid;
    insert into public.maturacao_alertas (cliente_id, contrato_id, tipo, referencia, tarefa_id) values (r.cliente_id, r.contrato_id, 'atraso_6m', r.data_inicio_atraso, tid);
    n := n + 1;
  end loop;

  -- 2) 10º, 11º e 12º mês de contrato do cliente (clientes ativos com dívida em atraso ou negociação aberta)
  for r in
    select c.id as cliente_id, c.data_fechamento, coalesce(c.nome_fantasia, c.dados->>'nome', c.id) as cliente_nome,
           (select count(*) from public.negociacoes x where x.cliente_id = c.id and x.etapa <> 'concluido') as abertas
    from public.clientes c
    where c.data_fechamento is not null and coalesce(c.status,'ativo') = 'ativo'
      and (coalesce(c.tem_divida_atraso,false) or exists (select 1 from public.negociacoes x where x.cliente_id = c.id and x.etapa <> 'concluido'))
      and c.data_fechamento <= current_date - interval '10 months'
  loop
    for meses in 10..12 loop
      continue when r.data_fechamento > current_date - (meses || ' months')::interval;
      continue when exists (select 1 from public.maturacao_alertas m where m.cliente_id = r.cliente_id and m.contrato_id is null and m.tipo = 'contrato_' || meses || 'm');
      resp := public.responsavel_acordos(r.cliente_id);
      titulo := 'Acordos: ' || meses || 'º mês de contrato — ' || r.cliente_nome;
      descr := 'Contrato com o escritório fechado em ' || to_char(r.data_fechamento,'DD/MM/YYYY') || ' · ' || r.abertas || ' negociação(ões) aberta(s).' ||
               case meses when 10 then E'\nFaltam 2 meses: priorize as negociações com proposta em aberto e alinhe com o cliente a alçada final.'
                          when 11 then E'\nFalta 1 mês: feche o que estiver maduro e defina com as sócias o que fica para renovação.'
                          else E'\nÚltimo mês de contrato: concluir ou formalizar a renovação/encerramento com o cliente.' end;
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values (titulo, descr, r.cliente_id, resp, 'acordos', current_date + 2, case when meses = 12 then 1 else 2 end) returning id into tid;
      insert into public.maturacao_alertas (cliente_id, tipo, referencia, tarefa_id) values (r.cliente_id, 'contrato_' || meses || 'm', r.data_fechamento, tid);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.acordos_regua_maturacao() from public, anon, authenticated;

-- opcional: marcar o que já está maduro hoje como "já alertado", sem abrir tarefas (para a régua valer só daqui em diante)
create or replace function public.regua_maturacao_marcar_existentes() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with ins as (
    insert into public.maturacao_alertas (cliente_id, contrato_id, tipo, referencia)
    select k.cliente_id, k.id, 'atraso_6m', k.data_inicio_atraso from public.contratos k
    where k.data_inicio_atraso <= current_date - interval '6 months'
    on conflict do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function public.regua_maturacao_marcar_existentes() from public, anon, authenticated;

create or replace function public.configurar_regua_maturacao(hora_brt integer default 6) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'acordos-maturacao-np';
  perform cron.schedule('acordos-maturacao-np', format('30 %s * * 1-5', (hora_brt + 3) % 24), 'select public.acordos_regua_maturacao()');
  return 'Régua de maturação diária às ' || hora_brt || 'h30 (seg–sex)';
end $$;
revoke all on function public.configurar_regua_maturacao(integer) from public, anon, authenticated;

-- ---------- (b) pós-acordo ----------
create or replace function public.acordos_pos_acordo() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text; banco text; resp_aco uuid; resp_acp uuid; t1 uuid; t2 uuid; t3 uuid;
begin
  select coalesce(c.nome_fantasia, c.dados->>'nome', c.id), c.responsavel_onboarding_id into nome, resp_acp from public.clientes c where c.id = new.cliente_id;
  select k.banco into banco from public.contratos k where k.id = new.contrato_id;
  resp_aco := public.responsavel_acordos(new.cliente_id, new.contrato_id);
  resp_acp := coalesce(resp_acp, public.responsavel_padrao('acompanhamento_pj'));
  if exists (select 1 from public.tarefas t where t.contrato_id = new.contrato_id and t.titulo like 'Pós-acordo:%' and t.created_at > now() - interval '1 day') then return new; end if;

  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Pós-acordo: pedir depoimento e indicação — ' || nome,
          'Acordo ' || coalesce(banco,'') || ' de ' || to_char(new.data,'DD/MM/YYYY') || coalesce(' · ' || public.brl(new.valor_pago), '') ||
          coalesce(' · desconto ' || to_char(new.desconto_obtido,'FM990D0') || '%', '') || E'.\nPeça o depoimento (áudio/vídeo/texto) e 1–2 indicações. Registre na timeline do cliente.',
          new.cliente_id, new.contrato_id, resp_aco, 'acordos', new.data + 7, 2) returning id into t1;
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Pós-acordo: prova social (PNG na pasta do cliente no Drive) — ' || nome,
          'Monte a imagem padrão do acordo (banco, valor original × valor pago, desconto) sem dados pessoais e salve na pasta do cliente no Drive. Avise o marketing.',
          new.cliente_id, new.contrato_id, resp_aco, 'acordos', new.data + 7, 3) returning id into t2;
  insert into public.tarefas (titulo, descricao, cliente_id, contrato_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Pós-acordo: relatório de conclusão para o cliente — ' || nome,
          'Acordo ' || coalesce(banco,'') || ' concluído em ' || to_char(new.data,'DD/MM/YYYY') || '. Envie o relatório de conclusão (o que foi negociado, economia obtida, próximos passos) e atualize a etapa do fluxo PJ.',
          new.cliente_id, new.contrato_id, resp_acp, 'acompanhamento_pj', new.data + 5, 2) returning id into t3;

  return new;
end $$;
drop trigger if exists acordos_pos_acordo on public.acordos;
create trigger acordos_pos_acordo after insert on public.acordos for each row execute procedure public.acordos_pos_acordo();

-- ---------- (c) direcionamento ----------
alter table public.clientes add column if not exists direcionamento text check (direcionamento in ('acordos','juridico','ambos'));
alter table public.clientes add column if not exists direcionamento_em date;
alter table public.clientes add column if not exists registrato_ok boolean;   -- Registrato (BCB) salvo na pasta do cliente

create or replace function public.clientes_direcionar() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text; resp uuid; tid uuid; aviso text;
begin
  if new.direcionamento is null or (tg_op = 'UPDATE' and new.direcionamento = old.direcionamento) then return new; end if;
  nome := coalesce(new.nome_fantasia, new.dados->>'nome', new.id);
  new.direcionamento_em := current_date;
  aviso := case when coalesce(new.registrato_ok,false) then '' else E'\n⚠️ Registrato ainda não marcado como salvo na pasta — confira antes de abrir as negociações.' end;

  if new.direcionamento in ('acordos','ambos') then
    resp := public.responsavel_acordos(new.id);
    if not exists (select 1 from public.negociacoes where cliente_id = new.id and etapa <> 'concluido') then
      insert into public.negociacoes (cliente_id, titulo, etapa, responsavel_id, proximo_passo)
      values (new.id, 'Acompanhamento — ' || nome, 'iniciar', resp, 'Segmentar as dívidas (banco, tipo, valor, data do atraso) e abrir uma negociação por contrato');
    end if;
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Acordos: cliente direcionado para negociação extrajudicial — ' || nome,
            'Direcionamento feito pelo Acompanhamento PJ em ' || to_char(current_date,'DD/MM/YYYY') || coalesce(E'.\nDívidas mapeadas: ' || nullif(new.tipos_dividas,''), '') || aviso ||
            E'\nAbra uma negociação por banco/contrato, registre valores e alçada e defina o próximo passo.',
            new.id, resp, 'acordos', current_date + 3, 1) returning id into tid;
  end if;

  if new.direcionamento in ('juridico','ambos') then
    resp := public.responsavel_padrao('juridico');
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Jurídico PJ: cliente direcionado para peça — ' || nome,
            'Direcionamento feito pelo Acompanhamento PJ em ' || to_char(current_date,'DD/MM/YYYY') || coalesce(E'.\nDívidas mapeadas: ' || nullif(new.tipos_dividas,''), '') ||
            E'\nDefina a estratégia (revisional, defesa, exceção…) e gere a peça pelo módulo Peças.',
            new.id, resp, 'juridico', current_date + 3, 1) returning id into tid;
  end if;
  return new;
end $$;
drop trigger if exists clientes_direcionar on public.clientes;
create trigger clientes_direcionar before insert or update of direcionamento on public.clientes for each row execute procedure public.clientes_direcionar();

select public.configurar_regua_maturacao(6) as resultado;
