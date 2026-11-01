-- 0085 — Requisições administrativas (reunião de 31/10): férias, folga, horário reduzido (semana de prova), ausência,
-- atestado e outros pedidos passam pelo sistema, com aprovação da administração/sócias e registro. Substitui o e-mail
-- de formalização. Aprovada uma ausência/férias/folga, entra na agenda do colaborador. Idempotente.

create table if not exists public.requisicoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  tipo text not null check (tipo in ('ferias','folga','horario_reduzido','ausencia','atestado','home_office','outro')),
  data_inicio date not null,
  data_fim date not null,
  detalhe text,
  status text not null default 'pendente' check (status in ('pendente','aprovada','negada','cancelada')),
  resposta text,
  decidido_por uuid references public.perfis(id) on delete set null,
  decidido_em timestamptz,
  agenda_evento_id uuid references public.agenda_eventos(id) on delete set null,
  created_by uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_fim >= data_inicio)
);
create index if not exists requisicoes_status_idx on public.requisicoes (status, created_at desc);
alter table public.requisicoes enable row level security;

create or replace function public.requisicao_tipo_nome(t text) returns text language sql immutable as $$
  select case t when 'ferias' then 'Férias' when 'folga' then 'Folga' when 'horario_reduzido' then 'Horário reduzido' when 'ausencia' then 'Ausência'
                when 'atestado' then 'Atestado' when 'home_office' then 'Home office' else 'Outro' end
$$;

-- quem aprova: admin ou quem tem a área 'equipe'
create or replace function public.aprova_requisicoes() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and (p.papel = 'admin' or 'equipe' = any(p.acessos)))
$$;

drop policy if exists req_sel on public.requisicoes;
create policy req_sel on public.requisicoes for select to authenticated
  using (public.aprova_requisicoes() or colaborador_id = public.meu_colaborador());
drop policy if exists req_ins on public.requisicoes;
create policy req_ins on public.requisicoes for insert to authenticated
  with check (colaborador_id = public.meu_colaborador() or public.aprova_requisicoes());
drop policy if exists req_upd on public.requisicoes;
create policy req_upd on public.requisicoes for update to authenticated
  using (public.aprova_requisicoes() or (colaborador_id = public.meu_colaborador() and status = 'pendente'));
grant select, insert, update on public.requisicoes to authenticated;

-- carimbo + avisos: nova requisição avisa quem aprova; decisão avisa quem pediu; aprovação de ausência entra na agenda
create or replace function public.requisicoes_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); meu text; nome text; perfil uuid; dest uuid; ev uuid; titulo text;
begin
  meu := public.nome_perfil(eu);
  select c.nome, c.perfil_id into nome, perfil from public.colaboradores c where c.id = new.colaborador_id;
  titulo := public.requisicao_tipo_nome(new.tipo) || ' · ' || to_char(new.data_inicio, 'DD/MM') || case when new.data_fim <> new.data_inicio then ' a ' || to_char(new.data_fim, 'DD/MM') else '' end;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, eu);
    for dest in select p.id from public.perfis p where p.papel = 'admin' or 'equipe' = any(p.acessos) loop
      perform public.notificar(dest, 'Requisição: ' || titulo, coalesce(nome, meu, 'Alguém') || ' pediu ' || lower(public.requisicao_tipo_nome(new.tipo)) || coalesce(': ' || left(new.detalhe, 140), ''), '#requisicoes');
    end loop;
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status and new.status in ('aprovada','negada') then
    new.decidido_por := coalesce(new.decidido_por, eu); new.decidido_em := coalesce(new.decidido_em, now());
    perform public.notificar(perfil, 'Requisição ' || new.status || ': ' || titulo, coalesce(meu,'A administração') || ' ' || case when new.status = 'aprovada' then 'aprovou' else 'negou' end || coalesce(' — ' || left(new.resposta, 160), ''), '#perfil');
    if new.status = 'aprovada' and new.tipo in ('ferias','folga','ausencia','atestado','home_office','horario_reduzido') and new.agenda_evento_id is null then
      insert into public.agenda_eventos (titulo, inicio, fim, dia_inteiro, colaborador_id, tipo, descricao, origem, created_by)
      values (public.requisicao_tipo_nome(new.tipo) || ' — ' || coalesce(nome, ''), new.data_inicio::timestamptz, (new.data_fim + 1)::timestamptz, true, new.colaborador_id, 'outro', new.detalhe, 'painel', eu)
      returning id into ev;
      new.agenda_evento_id := ev;
    end if;
  elsif new.status = 'cancelada' and old.status = 'aprovada' and old.agenda_evento_id is not null then
    update public.agenda_eventos set cancelado = true where id = old.agenda_evento_id;
  end if;
  return new;
end $$;
drop trigger if exists requisicoes_tg on public.requisicoes;
create trigger requisicoes_tg before insert or update on public.requisicoes for each row execute function public.requisicoes_tg();

create or replace view public.v_requisicoes with (security_invoker = true) as
select r.*, c.nome as colaborador_nome, c.nucleo, public.requisicao_tipo_nome(r.tipo) as tipo_nome,
       public.nome_perfil(r.decidido_por) as decidido_por_nome, (r.data_fim - r.data_inicio + 1) as dias
from public.requisicoes r join public.colaboradores c on c.id = r.colaborador_id;
grant select on public.v_requisicoes to authenticated;

select 'ok 0085' as resultado, (select count(*) from public.requisicoes) as requisicoes;
