-- 0099 — Cliente novo: além das tarefas de onboarding (D0, auditoria ONB, monitoramento), abre uma tarefa para o Financeiro
-- lançar o cliente e as cobranças (entrada e parcelas) no Asaas / sistema de cobrança. Gatilho AFTER INSERT em clientes.
-- Idempotente. Também passa a aceitar o núcleo 'financeiro' nas tarefas (usado aqui e nas tarefas criadas pela Central de Cobranças).
alter table public.tarefas drop constraint if exists tarefas_nucleo_check;
alter table public.tarefas add constraint tarefas_nucleo_check check (nucleo = any (array['juridico','acordos','acompanhamento_pj','pos_vendas','comercial','marketing','administrativo','rh','socios','financeiro']));
create or replace function public.fluxo_novo_cliente_financeiro() returns trigger language plpgsql security definer set search_path = public as $$
declare resp uuid;
begin
  if tg_op <> 'INSERT' then return new; end if;
  resp := public.responsavel_padrao('financeiro');
  if resp is null then
    select c.id into resp from public.colaboradores c where c.ativo and (c.nucleo in ('administrativo') or lower(coalesce(c.cargo,'')) like '%financ%') order by c.data_admissao nulls last limit 1;
  end if;
  if not exists (select 1 from public.tarefas t where t.cliente_id = new.id and t.titulo like 'Financeiro: lançar cliente e cobranças%') then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Financeiro: lançar cliente e cobranças (entrada e parcelas) no Asaas',
            E'Cliente novo fechado. Cadastre o cliente no Asaas (ou vincule, se já existir) e crie as cobranças conforme o contrato: entrada, parcelas e dia de vencimento acordado.\nDepois, confira em Financeiro → Clientes (Asaas) se a ficha ficou vinculada e se a régua de cobrança está ativa.',
            new.id, resp, 'financeiro', current_date + 2, 1);
  end if;
  return new;
end $$;
drop trigger if exists clientes_fluxo_financeiro on public.clientes;
create trigger clientes_fluxo_financeiro after insert on public.clientes for each row execute procedure public.fluxo_novo_cliente_financeiro();
select 'ok 0099' as resultado;
