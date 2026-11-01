-- 0086 — Providências do cliente (reunião de 31/10): status de fácil acesso do que já foi feito por cliente
-- ("proteção patrimonial concluída / em andamento"), para o jurídico e para quem pega o caso numa execução.
-- Checklist padrão para PJ; cada item tem status, responsável, prazo e observação; concluir registra no dossiê. Idempotente.

create table if not exists public.providencias (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes(id) on delete cascade,
  titulo text not null,
  categoria text not null default 'outro' check (categoria in ('estrategico','patrimonial','juridico','negocial','documentos','outro')),
  status text not null default 'a_fazer' check (status in ('a_fazer','em_andamento','concluida','nao_aplicavel')),
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  prazo date,
  concluida_em timestamptz,
  observacao text,
  ordem integer not null default 0,
  created_by uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists providencias_cliente_idx on public.providencias (cliente_id, ordem);
alter table public.providencias enable row level security;
drop policy if exists prov_equipe on public.providencias;
create policy prov_equipe on public.providencias for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update, delete on public.providencias to authenticated;

-- checklist padrão (PJ — gestão de passivos); só cria o que ainda não existe para o cliente
create or replace function public.providencias_padrao(p_cliente text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in select * from (values
      (10, 'Estudo de caso (dívidas, bancos, atrasos, provisionamento)', 'estrategico'),
      (20, 'Levantamento e análise dos contratos bancários', 'juridico'),
      (30, 'Proteção patrimonial', 'patrimonial'),
      (40, 'Mapeamento de bens, garantias e avalistas', 'patrimonial'),
      (50, 'Defesa em execuções e cobranças em curso', 'juridico'),
      (60, 'Estratégia de negociação definida (alçada e reserva)', 'negocial'),
      (70, 'Relatório inicial entregue ao cliente', 'estrategico'),
      (80, 'Documentos do onboarding recebidos e salvos', 'documentos')) as v(ordem, titulo, categoria) loop
    if not exists (select 1 from public.providencias p where p.cliente_id = p_cliente and p.titulo = r.titulo) then
      insert into public.providencias (cliente_id, titulo, categoria, ordem, created_by) values (p_cliente, r.titulo, r.categoria, r.ordem, auth.uid());
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.providencias_padrao(text) to authenticated;

-- concluir registra no dossiê do cliente (fica visível numa eventual execução)
create or replace function public.providencias_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare meu text; fr text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); return new; end if;
  if new.status = 'concluida' and old.status <> 'concluida' then
    new.concluida_em := coalesce(new.concluida_em, now());
    meu := public.nome_perfil(auth.uid());
    fr := case new.categoria when 'patrimonial' then 'estrategico' when 'estrategico' then 'estrategico' when 'negocial' then 'negocial' when 'juridico' then 'juridico' else 'estrategico' end;
    insert into public.entradas_timeline (cliente_id, data, tipo, descricao, responsavel_id, visivel_cliente, automatica, fonte, frente)
    values (new.cliente_id, current_date, 'registro', 'Providência concluída: ' || new.titulo || coalesce(E'\n' || new.observacao, '') || coalesce(' (' || meu || ')', ''), new.responsavel_id, false, true, 'providencia', fr);
  elsif new.status <> 'concluida' then
    new.concluida_em := null;
  end if;
  return new;
end $$;
drop trigger if exists providencias_tg on public.providencias;
create trigger providencias_tg before insert or update on public.providencias for each row execute function public.providencias_tg();

create or replace view public.v_providencias with (security_invoker = true) as
select p.*, co.nome as responsavel_nome,
       case p.categoria when 'estrategico' then 'Estratégico' when 'patrimonial' then 'Patrimonial' when 'juridico' then 'Jurídico' when 'negocial' then 'Negocial' when 'documentos' then 'Documentos' else 'Outro' end as categoria_nome
from public.providencias p left join public.colaboradores co on co.id = p.responsavel_id;
grant select on public.v_providencias to authenticated;

-- resumo por cliente (para a lista de clientes e a visão geral)
create or replace view public.v_providencias_cliente with (security_invoker = true) as
select cliente_id, count(*) as total, count(*) filter (where status = 'concluida') as concluidas,
       count(*) filter (where status = 'em_andamento') as em_andamento, count(*) filter (where status = 'a_fazer') as a_fazer,
       count(*) filter (where status = 'a_fazer' and prazo < current_date) as atrasadas
from public.providencias group by 1;
grant select on public.v_providencias_cliente to authenticated;

select 'ok 0086' as resultado, (select count(*) from public.providencias) as providencias;
