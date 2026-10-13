-- 0060 — (a) Mural de avisos do escritório (admins publicam; todos ou por área; leitura registrada; sino);
--        (b) Ponto dos estagiários (entrada / intervalo / volta / saída, espelho mensal, ajuste pela administração).
-- Idempotente. Depende de 0056 (tem_acesso), 0034 (notificar), 0006 (colaboradores).

-- ---------- (a) avisos ----------
create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  texto text not null,
  areas text[],                                  -- null = todo o escritório
  fixado boolean not null default false,
  publicado_em timestamptz not null default now(),
  expira_em date,
  autor_id uuid references public.perfis(id) on delete set null,
  discord_enviado_em timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.avisos_leituras (
  aviso_id uuid references public.avisos(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (aviso_id, perfil_id)
);
alter table public.avisos enable row level security;
alter table public.avisos_leituras enable row level security;

create or replace function public.aviso_visivel(p_areas text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sou_equipe() and (p_areas is null or cardinality(p_areas) = 0 or public.sou_admin()
         or exists (select 1 from unnest(p_areas) a where public.tem_acesso(a)))
$$;
drop policy if exists "avisos: ver" on public.avisos; create policy "avisos: ver" on public.avisos for select to authenticated using (public.aviso_visivel(areas));
drop policy if exists "avisos: admin" on public.avisos; create policy "avisos: admin" on public.avisos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists "leituras: proprias" on public.avisos_leituras; create policy "leituras: proprias" on public.avisos_leituras for all to authenticated using (perfil_id = auth.uid() or public.sou_admin()) with check (perfil_id = auth.uid());

-- sino para quem pode ver, ao publicar
create or replace function public.avisos_notificar() returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select id, papel, acessos from public.perfis where papel in ('admin','colaborador') and id <> coalesce(new.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) loop
    if new.areas is null or cardinality(new.areas) = 0 or p.papel = 'admin' or coalesce(new.areas && coalesce(p.acessos,'{}'), false) then
      perform public.notificar(p.id, '📣 Aviso: ' || left(new.titulo, 80), left(regexp_replace(new.texto, E'\\s+', ' ', 'g'), 140), '#avisos/' || new.id::text);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists avisos_notificar on public.avisos;
create trigger avisos_notificar after insert on public.avisos for each row execute procedure public.avisos_notificar();

create or replace view public.v_avisos with (security_invoker = true) as
select a.*, p.nome as autor_nome,
       exists (select 1 from public.avisos_leituras l where l.aviso_id = a.id and l.perfil_id = auth.uid()) as lida,
       (select count(*) from public.avisos_leituras l where l.aviso_id = a.id) as leituras
from public.avisos a left join public.perfis p on p.id = a.autor_id
where a.expira_em is null or a.expira_em >= (now() at time zone 'America/Sao_Paulo')::date;

-- ---------- (b) ponto ----------
alter table public.colaboradores add column if not exists registra_ponto boolean not null default false;
alter table public.colaboradores add column if not exists jornada_minutos integer;   -- ex.: 360 = 6h (estágio)

create table if not exists public.pontos (
  id bigserial primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  momento timestamptz not null default now(),
  tipo text not null check (tipo in ('entrada','saida_intervalo','volta_intervalo','saida')),
  origem text not null default 'painel',
  obs text,
  ajustado_por uuid references public.perfis(id) on delete set null,
  ajustado_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pontos_colab_idx on public.pontos (colaborador_id, momento desc);
alter table public.pontos enable row level security;
drop policy if exists "pontos: ver" on public.pontos; create policy "pontos: ver" on public.pontos for select to authenticated using (colaborador_id = public.meu_colaborador() or public.tem_acesso('equipe'));
drop policy if exists "pontos: bater" on public.pontos; create policy "pontos: bater" on public.pontos for insert to authenticated
  with check (colaborador_id = public.meu_colaborador() and ajustado_por is null and exists (select 1 from public.colaboradores c where c.id = colaborador_id and c.registra_ponto));
drop policy if exists "pontos: admin" on public.pontos; create policy "pontos: admin" on public.pontos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- bater o ponto: escolhe o próximo tipo automaticamente e impede batidas duplicadas em menos de 1 minuto
create or replace function public.bater_ponto(p_tipo text default null, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare colab uuid; ultimo record; prox text; hoje date := (now() at time zone 'America/Sao_Paulo')::date; id_ bigint;
begin
  colab := public.meu_colaborador();
  if colab is null then raise exception 'Seu usuário não está vinculado a um colaborador.'; end if;
  if not exists (select 1 from public.colaboradores where id = colab and registra_ponto) then raise exception 'Seu perfil não registra ponto.'; end if;
  select * into ultimo from public.pontos where colaborador_id = colab and (momento at time zone 'America/Sao_Paulo')::date = hoje order by momento desc limit 1;
  if ultimo.id is not null and ultimo.momento > now() - interval '1 minute' then raise exception 'Você acabou de registrar o ponto. Aguarde um minuto.'; end if;
  prox := coalesce(p_tipo, case coalesce(ultimo.tipo, '') when '' then 'entrada' when 'entrada' then 'saida_intervalo' when 'saida_intervalo' then 'volta_intervalo' when 'volta_intervalo' then 'saida' else 'entrada' end);
  insert into public.pontos (colaborador_id, tipo, obs) values (colab, prox, nullif(p_obs,'')) returning id into id_;
  return jsonb_build_object('id', id_, 'tipo', prox, 'momento', now());
end $$;
grant execute on function public.bater_ponto(text, text) to authenticated;

-- espelho: um registro por colaborador/dia com minutos trabalhados (soma dos pares entrada→saída, descontando intervalo)
create or replace view public.v_ponto_dias with (security_invoker = true) as
with b as (
  select p.colaborador_id, (p.momento at time zone 'America/Sao_Paulo')::date as dia, p.tipo, p.momento,
         lead(p.momento) over (partition by p.colaborador_id, (p.momento at time zone 'America/Sao_Paulo')::date order by p.momento) as proximo
  from public.pontos p
), d as (
  select colaborador_id, dia,
         min(momento) filter (where tipo = 'entrada') as entrada,
         max(momento) filter (where tipo = 'saida') as saida,
         sum(extract(epoch from (proximo - momento)) / 60) filter (where tipo in ('entrada','volta_intervalo') and proximo is not null) as minutos,
         sum(extract(epoch from (proximo - momento)) / 60) filter (where tipo = 'saida_intervalo' and proximo is not null) as intervalo_min,
         count(*) as batidas,
         bool_or(tipo = 'saida') as fechado
  from b group by colaborador_id, dia
)
select d.*, c.nome as colaborador_nome, c.jornada_minutos,
       round(coalesce(d.minutos,0))::int - coalesce(c.jornada_minutos, 360) as saldo_min,
       (select string_agg(to_char(p.momento at time zone 'America/Sao_Paulo', 'HH24:MI') || ' ' || p.tipo, ' · ' order by p.momento) from public.pontos p where p.colaborador_id = d.colaborador_id and (p.momento at time zone 'America/Sao_Paulo')::date = d.dia) as batidas_txt
from d join public.colaboradores c on c.id = d.colaborador_id;

-- v_colaboradores com as colunas novas (no fim)
drop view if exists public.v_colaboradores;
create view public.v_colaboradores with (security_invoker = true) as
select co.id, co.nome, co.apelido, co.cargo, co.nucleo, co.data_admissao, co.data_desligamento, co.responsabilidades, co.ativo,
       co.email, co.telefone, co.oab, co.perfil_id, co.foto_path, co.data_nascimento, co.cidade, co.linkedin, co.bio,
       p.email as login_email, p.papel as login_papel,
       (select max(a.data) from public.apontamentos_horas a where a.colaborador_id = co.id) as ultimo_apontamento,
       coalesce((select sum(a.horas) from public.apontamentos_horas a where a.colaborador_id = co.id and a.data >= current_date - 30),0) as horas_30d,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (select count(*) from public.tarefas t where t.responsavel_id = co.id and t.status in ('aberta','em_andamento') and t.prazo < current_date) as tarefas_atrasadas,
       (select count(*) from public.processos pr where pr.responsavel_id = co.id and pr.status = 'ativo') as processos_ativos,
       (select count(*) from public.entradas_timeline e where e.responsavel_id = co.id and e.data >= current_date - 30) as registros_30d,
       (select count(*) from public.pdi d where d.colaborador_id = co.id and d.status in ('planejado','em_andamento')) as pdi_abertos,
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo, co.google_calendar_id, co.agenda_sync, co.agenda_sync_em, co.agenda_sync_erro,
       co.registra_ponto, co.jornada_minutos
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

-- estagiários: Mário e João Vitor, jornada de 6h
update public.colaboradores set registra_ponto = true, jornada_minutos = coalesce(jornada_minutos, 360) where nome in ('Mário','João Vitor') and ativo;

select 'ok 0060' as resultado;
