-- 0104 — Aba "Acompanhamento PJ" (alinhamento Ana Júlia × Lucas, 09/11/2026): passagem de bastão visual entre
-- Acompanhamento, Jurídico e Acordos. Cadastro vira ficha enxuta; o que depende de investigar o cliente vai para
-- o Acompanhamento: status do ciclo (ONB → R1 → R2 → R3 → mensal), Raio-X (dívidas como ponto de partida visual),
-- bens/proteção e atas das reuniões (com link da pasta/gravação). Idempotente.

-- 1) ciclo de acompanhamento por cliente
create table if not exists public.acompanhamento_pj (
  cliente_id text primary key references public.clientes (id) on delete cascade,
  onb_data date, onb_feita boolean not null default false,
  r1_data date,  r1_feita boolean not null default false,
  r2_data date,  r2_feita boolean not null default false,
  r3_data date,  r3_feita boolean not null default false,
  fase text not null default 'onboarding' check (fase in ('onboarding','ciclo','mensal','encerrado')),
  proxima_reuniao date,
  acordos_liberado boolean not null default false,       -- vira true quando a R1 é concluída com o Raio-X preenchido
  acordos_liberado_em timestamptz,
  observacoes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.acompanhamento_pj enable row level security;
drop policy if exists acpj_sel on public.acompanhamento_pj; create policy acpj_sel on public.acompanhamento_pj for select to authenticated using (public.sou_equipe());
drop policy if exists acpj_wr  on public.acompanhamento_pj; create policy acpj_wr  on public.acompanhamento_pj for all to authenticated using (public.edita_protecao()) with check (public.edita_protecao());

-- 2) Raio-X: dívidas (ponto de partida visual; os contratos detalhados continuam em Passivos → Contratos)
create table if not exists public.dividas_raio_x (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes (id) on delete cascade,
  banco text not null,
  tipo text,                              -- capital de giro, cheque especial, financiamento, cartão…
  valor numeric(14,2),
  atraso_meses integer,                   -- 0 = em dia
  avalista boolean not null default false,
  avalista_nome text, avalista_cpf text,
  avalista_tem_bens boolean,
  garantia boolean not null default false,
  garantia_descricao text,                -- ex.: HB20 alienado, casa hipotecada
  contrato_em_maos boolean,
  processo boolean,
  observacoes text,
  ordem integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists dividas_raio_x_cli on public.dividas_raio_x (cliente_id);
alter table public.dividas_raio_x enable row level security;
drop policy if exists drx_sel on public.dividas_raio_x; create policy drx_sel on public.dividas_raio_x for select to authenticated using (public.sou_equipe());
drop policy if exists drx_wr  on public.dividas_raio_x; create policy drx_wr  on public.dividas_raio_x for all to authenticated using (public.edita_protecao()) with check (public.edita_protecao());

-- 3) atas das reuniões (ONB, R1, R2, R3, mensais…) com link para a pasta/gravação
create table if not exists public.atas_reuniao (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null references public.clientes (id) on delete cascade,
  tipo text not null default 'outra' check (tipo in ('onb','r1','r2','r3','mensal','estrategia','outra')),
  data date not null default current_date,
  titulo text,
  resumo text,
  link_pasta text,                        -- pasta do Drive com gravação/transcrição
  link_gravacao text,
  participantes text,
  autor_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists atas_reuniao_cli on public.atas_reuniao (cliente_id, data desc);
alter table public.atas_reuniao enable row level security;
drop policy if exists ata_sel on public.atas_reuniao; create policy ata_sel on public.atas_reuniao for select to authenticated using (public.sou_equipe());
drop policy if exists ata_wr  on public.atas_reuniao; create policy ata_wr  on public.atas_reuniao for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());

-- 4) bens: titular pode ser 'avalista' (separado de terceiro)
alter table public.bens drop constraint if exists bens_titular_check;
alter table public.bens add constraint bens_titular_check check (titular = any (array['PJ','PF','avalista','terceiro']));

-- 5) ata registrada vira entrada no dossiê (frente Estratégico), sem notificação
create or replace function public.ata_para_dossie() returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  t := case new.tipo when 'onb' then 'Onboarding' when 'r1' then 'R1' when 'r2' then 'R2' when 'r3' then 'R3' when 'mensal' then 'Acompanhamento mensal' when 'estrategia' then 'Núcleo de estratégia' else coalesce(new.titulo,'Reunião') end;
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, created_by, frente)
  values (new.cliente_id, new.data, 'ata', 'Ata — ' || t || coalesce(': ' || new.titulo, '') || E'\n' || coalesce(new.resumo,'') || coalesce(E'\nPasta: ' || new.link_pasta, ''), false, coalesce(new.created_by, auth.uid()), 'estrategico');
  return new;
exception when others then return new;
end $$;
drop trigger if exists atas_reuniao_dossie on public.atas_reuniao;
create trigger atas_reuniao_dossie after insert on public.atas_reuniao for each row execute procedure public.ata_para_dossie();

-- 6) resumo do acompanhamento para o cabeçalho do cliente e para Acordos/Jurídico
create or replace view public.v_acompanhamento_pj with (security_invoker = true) as
select c.id as cliente_id, a.fase, a.onb_data, a.onb_feita, a.r1_data, a.r1_feita, a.r2_data, a.r2_feita, a.r3_data, a.r3_feita, a.proxima_reuniao,
       a.acordos_liberado, a.acordos_liberado_em,
       case when a.cliente_id is null or not a.onb_feita then 'onb' when not a.r1_feita then 'r1' when not a.r2_feita then 'r2' when not a.r3_feita then 'r3' else 'mensal' end as etapa_atual,
       (select count(*) from public.dividas_raio_x d where d.cliente_id = c.id) as dividas,
       (select count(*) from public.atas_reuniao t where t.cliente_id = c.id) as atas,
       (select max(t.data) from public.atas_reuniao t where t.cliente_id = c.id) as ultima_ata
  from public.clientes c left join public.acompanhamento_pj a on a.cliente_id = c.id;
grant select on public.v_acompanhamento_pj to authenticated;

select 'ok 0104' as resultado;
