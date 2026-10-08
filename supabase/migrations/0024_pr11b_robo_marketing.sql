-- 0024 — PR 11b: usuário-robô do marketing ("máquina de ideias") e pedidos de ideias.
-- O robô é um usuário do Supabase Auth com papel 'robo': NÃO é equipe (não vê clientes, acessos, nada) — só lê e escreve
-- pautas (origem 'ia'), comentários de pautas e atende os pedidos da tabela marketing_pedidos. Idempotente. Depende de 0022.

alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check check (papel in ('admin','colaborador','cliente','pendente','robo'));

create or replace function public.sou_robo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'robo' from public.perfis where id = auth.uid()), false)
$$;

-- pautas: robô lê tudo, cria como 'ideia' (origem ia) e só altera as que criou e ainda estão em 'ideia'
drop policy if exists pautas_robo_sel on public.pautas;
create policy pautas_robo_sel on public.pautas for select to authenticated using (public.sou_robo());
drop policy if exists pautas_robo_ins on public.pautas;
create policy pautas_robo_ins on public.pautas for insert to authenticated with check (public.sou_robo() and origem = 'ia' and status = 'ideia');
drop policy if exists pautas_robo_upd on public.pautas;
create policy pautas_robo_upd on public.pautas for update to authenticated using (public.sou_robo() and origem = 'ia' and status = 'ideia') with check (public.sou_robo() and origem = 'ia' and status = 'ideia');
drop policy if exists pcom_robo on public.pautas_comentarios;
create policy pcom_robo on public.pautas_comentarios for all to authenticated using (public.sou_robo()) with check (public.sou_robo() and tipo = 'comentario');
-- colaboradores: robô precisa ler nomes para preencher responsável (sem contato)
drop policy if exists colab_robo on public.colaboradores;
create policy colab_robo on public.colaboradores for select to authenticated using (public.sou_robo());
-- gatilho pauta_fluxo lê perfis.nome: robô enxerga o próprio perfil (policy perfis_sel já cobre id = auth.uid())

-- Pedidos ao robô ("quero 5 ideias sobre X", "legenda para a pauta Y")
create table if not exists public.marketing_pedidos (
  id bigserial primary key,
  texto text not null,
  pauta_id uuid references public.pautas(id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente','atendido','recusado')),
  resposta text,
  created_at timestamptz default now(), created_by uuid, atendido_em timestamptz
);
alter table public.marketing_pedidos enable row level security;
drop policy if exists mkp_equipe on public.marketing_pedidos;
create policy mkp_equipe on public.marketing_pedidos for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists mkp_robo on public.marketing_pedidos;
create policy mkp_robo on public.marketing_pedidos for all to authenticated using (public.sou_robo()) with check (public.sou_robo());
revoke all on public.marketing_pedidos from anon;
create or replace function public.mkp_carimbo() returns trigger language plpgsql as $$ begin if tg_op='INSERT' then new.created_by := auth.uid(); end if; return new; end $$;
drop trigger if exists marketing_pedidos_carimbo on public.marketing_pedidos;
create trigger marketing_pedidos_carimbo before insert on public.marketing_pedidos for each row execute procedure public.mkp_carimbo();

create or replace view public.v_marketing_pedidos with (security_invoker = true) as
select m.*, coalesce(p.nome, p.email) as autor_nome, pa.titulo as pauta_titulo
from public.marketing_pedidos m left join public.perfis p on p.id = m.created_by left join public.pautas pa on pa.id = m.pauta_id;
revoke all on public.v_marketing_pedidos from anon;

-- Colaborador "Robô" (para aparecer como responsável das sugestões) — sem usuário vinculado
insert into public.colaboradores (nome, cargo, nucleo, responsabilidades, ativo)
select 'Robô de marketing', 'Máquina de ideias (IA)', 'marketing', 'Sugere pautas e legendas; as sócias aprovam.', true
where not exists (select 1 from public.colaboradores where nome = 'Robô de marketing');

do $$ begin alter publication supabase_realtime add table public.marketing_pedidos; exception when others then null; end $$;

select 'ok 0024' as resultado;
