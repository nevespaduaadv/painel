-- ESPELHO (beta) — Reunião de 26/10 (setor de acordos): (1) cliente novo entra nas três frentes sozinho — a tarefa de acordos
-- deixa de depender de inadimplência; (2) Ficha de passagem (perguntas norteadoras) com histórico de quem respondeu e quando;
-- (3) ao concluir o ciclo de onboarding, a frente negocial é avisada com o que está (e o que não está) respondido.
-- Idempotente. Depende de beta 0008.

-- ---------- 1. entrada nas três frentes ----------
create or replace function public.resp_frente(p_frente text) returns uuid language sql stable as $$
  select id from public.colaboradores where ativo and frente = p_frente order by data_admissao nulls last limit 1
$$;
create or replace function public.cliente_entrada_frentes_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare novo boolean := (tg_op = 'INSERT'); resp_neg uuid; resp_est uuid; nome text;
begin
  if not novo then return new; end if;
  nome := coalesce(new.nome_fantasia, new.dados->>'nome', new.id);
  resp_neg := coalesce(new.resp_negocial_id, public.resp_frente('negocial'), (select id from public.colaboradores where ativo and nucleo = 'acordos' order by data_admissao nulls last limit 1));
  resp_est := coalesce(new.resp_estrategico_id, public.resp_frente('estrategico'), new.responsavel_onboarding_id);
  -- acordos: sempre (alçada e reserva se constroem desde o início), uma semana depois do onboarding
  if resp_neg is not null and not exists (select 1 from public.tarefas t where t.cliente_id = new.id and t.nucleo = 'acordos' and t.titulo like 'Acordos: estudo de caso%') then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Acordos: estudo de caso e reunião de mapeamento — ' || nome,
            E'Cliente novo. Antes da reunião: formulário de onboarding, ficha de passagem (Cadastro), transcrições/atas no dossiê, pareceres dos contratos.\nNa reunião: dívidas por banco, renegociações anteriores, alçada e reserva mensal. Depois: planejamento de quitação e reunião mensal.',
            new.id, resp_neg, 'acordos', current_date + 14, 2);
  end if;
  -- ficha de passagem nasce vazia (as perguntas aparecem como pendência no Hoje de quem faz o onboarding)
  insert into public.cliente_passagem (cliente_id, responsavel_id) values (new.id, resp_est) on conflict (cliente_id) do nothing;
  return new;
end $$;

-- ---------- 2. ficha de passagem ----------
create table if not exists public.cliente_passagem (
  cliente_id text primary key references public.clientes (id) on delete cascade,
  responsavel_id uuid references public.colaboradores (id) on delete set null,
  situacao text check (situacao in ('adimplente', 'vai_ficar_inadimplente', 'inadimplente')),
  inadimplente_desde date,
  patrimonio jsonb not null default '[]'::jsonb,              -- [{bem, status: exposto|em_transferencia|protegido|nao_compensa|nao_protegivel, obs}]
  patrimonio_concluido boolean not null default false,        -- blindagem encerrada (ciclo de 45 dias)
  renegociacoes_anteriores text,
  processos_existentes text,
  contratos_obtidos text,                                     -- quais contratos bancários já foram obtidos / faltam
  alcada numeric(14,2),
  reserva_mensal numeric(14,2),
  prazo_meses integer,
  observacoes text,
  onboarding_concluido_em date,
  historico jsonb not null default '[]'::jsonb,               -- [{campo, de, para, por, por_nome, em}]
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.cliente_passagem enable row level security;
drop policy if exists cp_sel on public.cliente_passagem; create policy cp_sel on public.cliente_passagem for select to authenticated using (public.sou_equipe());
drop policy if exists cp_mod on public.cliente_passagem; create policy cp_mod on public.cliente_passagem for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update on public.cliente_passagem to authenticated;
insert into public.cliente_passagem (cliente_id) select id from public.clientes where ativo is distinct from false on conflict do nothing;

create or replace function public.cliente_passagem_hist_tg() returns trigger language plpgsql security definer set search_path = public as $$
declare h jsonb := '[]'::jsonb; campo text; de jsonb; para jsonb; nome text := public.nome_perfil(auth.uid()); dest uuid; perfil uuid; faltam text[];
begin
  foreach campo in array array['situacao','inadimplente_desde','patrimonio','patrimonio_concluido','renegociacoes_anteriores','processos_existentes','contratos_obtidos','alcada','reserva_mensal','prazo_meses','observacoes','onboarding_concluido_em'] loop
    de := to_jsonb(old) -> campo; para := to_jsonb(new) -> campo;
    if de is distinct from para then h := h || jsonb_build_object('campo', campo, 'de', de, 'para', para, 'por', auth.uid(), 'por_nome', nome, 'em', now()); end if;
  end loop;
  if h <> '[]'::jsonb then new.historico := coalesce(old.historico, '[]'::jsonb) || h; new.updated_at := now(); new.updated_by := auth.uid(); end if;
  -- ciclo concluído → avisa a frente negocial com o que falta
  if new.onboarding_concluido_em is not null and old.onboarding_concluido_em is null then
    faltam := array_remove(array[case when new.situacao is null then 'situação de inadimplência' end, case when jsonb_array_length(new.patrimonio) = 0 then 'patrimônio' end, case when new.renegociacoes_anteriores is null then 'renegociações anteriores' end, case when new.processos_existentes is null then 'processos existentes' end, case when new.contratos_obtidos is null then 'contratos obtidos' end], null);
    select coalesce(c.resp_negocial_id, public.resp_frente('negocial')) into dest from public.clientes c where c.id = new.cliente_id;
    select perfil_id into perfil from public.colaboradores where id = dest;
    if perfil is not null then perform public.notificar(perfil, 'Passagem de bastão: ' || coalesce((select nome from public.clientes where id = new.cliente_id), new.cliente_id), case when coalesce(array_length(faltam, 1), 0) = 0 then 'Onboarding concluído; ficha de passagem completa.' else 'Onboarding concluído. Ainda sem resposta: ' || array_to_string(faltam, ', ') end, '#clientes/' || new.cliente_id); end if;
    -- a tarefa de acordos passa a vencer em 7 dias, se ainda estiver mais longe
    update public.tarefas set prazo = least(prazo, current_date + 7) where cliente_id = new.cliente_id and nucleo = 'acordos' and status in ('aberta','em_andamento') and titulo like 'Acordos: estudo de caso%';
  end if;
  return new;
end $$;
drop trigger if exists cliente_passagem_hist on public.cliente_passagem;
create trigger cliente_passagem_hist before update on public.cliente_passagem for each row execute function public.cliente_passagem_hist_tg();

drop trigger if exists cliente_entrada_frentes on public.clientes;
create trigger cliente_entrada_frentes after insert on public.clientes for each row execute function public.cliente_entrada_frentes_tg();

-- pendências da ficha por cliente (para o Hoje e para o card)
create or replace view public.v_cliente_passagem with (security_invoker = true) as
select p.*, c.nome as cliente_nome, co.nome as responsavel_nome, c.created_at as cliente_desde,
       array_remove(array[case when p.situacao is null then 'situação de inadimplência' end, case when jsonb_array_length(p.patrimonio) = 0 then 'patrimônio' end, case when p.renegociacoes_anteriores is null then 'renegociações anteriores' end, case when p.processos_existentes is null then 'processos existentes' end, case when p.contratos_obtidos is null then 'contratos obtidos' end, case when p.alcada is null then 'alçada' end, case when p.reserva_mensal is null then 'reserva mensal' end], null) as faltam,
       (select count(*) from jsonb_array_elements(p.patrimonio) b where b->>'status' = 'exposto') as bens_expostos
  from public.cliente_passagem p join public.clientes c on c.id = p.cliente_id left join public.colaboradores co on co.id = p.responsavel_id
 where c.ativo is distinct from false;
grant select on public.v_cliente_passagem to authenticated;

select 'ok beta 0012' as resultado, (select count(*) from public.cliente_passagem) as fichas;
