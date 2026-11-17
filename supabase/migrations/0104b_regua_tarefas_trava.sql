-- 0104b — Trava prévia da régua de tarefas (proteção ANTES da 0105). Idempotente. PROPOSTA: não aplicada.
-- Ordem obrigatória, numa transação só: 0104b (esta trava) → 0105 (estruturas do Financeiro) → 0112 (ativação controlada).
-- O nome do arquivo ordena esta trava antes da 0105. Com ela instalada, a rotina regua_tarefas_auto() da 0105 não
-- consegue gravar nenhuma tarefa "Criada automaticamente pela régua" enquanto regua_tarefas_config.ativa = false
-- (padrão), nem se a 0105 for executada sozinha e a rotina for chamada à mão ou pelo agendamento.
-- Nada aqui depende da 0105: tarefas.cobranca_id existe desde a 0098 e pode_financeiro() desde a 0055.
-- O mesmo bloco se repete, idêntico, no início da 0112 (que continua autossuficiente).

create table if not exists public.regua_tarefas_config (
  id boolean primary key default true check (id),
  ativa boolean not null default false,
  data_corte date,
  limite_por_execucao integer not null default 20 check (limite_por_execucao between 1 and 200),
  prioridade smallint not null default 2 check (prioridade between 1 and 3),
  executor_padrao_id uuid references public.colaboradores (id) on delete set null,
  atualizado_por uuid, atualizado_em timestamptz, observacao text);
insert into public.regua_tarefas_config (id) values (true) on conflict (id) do nothing;
alter table public.regua_tarefas_config enable row level security;
drop policy if exists regua_cfg_sel on public.regua_tarefas_config;
create policy regua_cfg_sel on public.regua_tarefas_config for select to authenticated using (public.pode_financeiro());
revoke all on public.regua_tarefas_config from anon;
-- (sem policy de escrita: só as funções abaixo mudam a configuração)

-- trava 3: com a régua desligada, nenhuma tarefa "Criada automaticamente pela régua" entra (descarta a linha, sem erro)
create or replace function public.tarefas_regua_trava_tg() returns trigger language plpgsql set search_path = public as $$
begin
  if new.cobranca_id is not null and coalesce(new.descricao, '') like 'Criada automaticamente pela régua%'
     and not coalesce((select ativa from public.regua_tarefas_config where id), false) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists tarefas_regua_trava on public.tarefas;
create trigger tarefas_regua_trava before insert on public.tarefas for each row execute function public.tarefas_regua_trava_tg();

-- Reexecução do trio (0104b → 0105 → 0112): a 0105 recria v_regua_cobranca, e a visão v_regua_acumulado (da 0112) depende dela.
-- Retirada aqui e recriada, idêntica, pela 0112 no fim da mesma transação. Na primeira instalação ela ainda não existe.
drop view if exists public.v_regua_acumulado;

select 'ok 0104b' as resultado,
       (select count(*) from pg_trigger where tgname = 'tarefas_regua_trava' and not tgisinternal) as trava,
       (select ativa::text from public.regua_tarefas_config where id) as regua_ativa;
