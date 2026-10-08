-- 0022 — PR 11: Marketing — pautas de conteúdo com calendário e fluxo de aprovação das sócias.
-- Fluxo: ideia → em_aprovacao → (aprovado | ajustar) → em_producao → agendado → publicado (ou cancelado).
-- Só admin aprova (gatilho garante); equipe cria/edita/move o resto; comentários registram pedidos de ajuste e aprovações.
-- Idempotente. Depende de 0006 (colaboradores).

-- núcleo "marketing" (e "rh") passam a existir para colaboradores e tarefas
alter table public.colaboradores drop constraint if exists colaboradores_nucleo_check;
alter table public.colaboradores add constraint colaboradores_nucleo_check check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','marketing','administrativo','rh','socios'));
alter table public.tarefas drop constraint if exists tarefas_nucleo_check;
alter table public.tarefas add constraint tarefas_nucleo_check check (nucleo in ('juridico','acordos','acompanhamento_pj','pos_vendas','comercial','marketing','administrativo','rh','socios'));

create table if not exists public.pautas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,                                   -- ideia, gancho, roteiro
  formato text not null default 'carrossel' check (formato in ('reels','carrossel','estatico','story','artigo','email','video','live','outro')),
  canais text[] not null default '{instagram}',     -- instagram, linkedin, youtube, blog, whatsapp, email, tiktok
  pilar text,                                       -- autoridade, educativo, prova social, bastidores, oferta…
  objetivo text,                                    -- atração, autoridade, conversão, relacionamento
  data_prevista date,
  data_publicacao date,
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  status text not null default 'ideia' check (status in ('ideia','em_aprovacao','ajustar','aprovado','em_producao','agendado','publicado','cancelado')),
  link_criativo text,                               -- Drive / Canva / Figma
  link_publicado text,
  legenda text,
  hashtags text,
  aprovado_por uuid,                                -- perfil (auth.uid) da sócia
  aprovado_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual','ia')),
  metricas jsonb,                                   -- {alcance, curtidas, comentarios, salvamentos, leads}
  ordem integer not null default 0,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists pautas_data_idx on public.pautas(data_prevista);
create index if not exists pautas_status_idx on public.pautas(status, ordem);

create table if not exists public.pautas_comentarios (
  id bigserial primary key,
  pauta_id uuid not null references public.pautas(id) on delete cascade,
  autor_id uuid,                                    -- perfil
  tipo text not null default 'comentario' check (tipo in ('comentario','ajuste','aprovacao','status')),
  texto text not null,
  created_at timestamptz default now()
);
create index if not exists pautas_comentarios_idx on public.pautas_comentarios(pauta_id, created_at);

-- Aprovação só por admin; registra quem/quando; mudança de status vira comentário automático
create or replace function public.pauta_fluxo() returns trigger language plpgsql security definer set search_path = public as $$
declare nome text;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'aprovado' and not public.sou_admin() then raise exception 'Só as sócias aprovam pautas'; end if;
    if new.status = 'aprovado' then new.aprovado_por := auth.uid(); new.aprovado_em := now(); end if;
    if new.status = 'publicado' and new.data_publicacao is null then new.data_publicacao := current_date; end if;
    select coalesce(p.nome, p.email, 'sistema') into nome from public.perfis p where p.id = auth.uid();
    insert into public.pautas_comentarios (pauta_id, autor_id, tipo, texto) values (old.id, auth.uid(), 'status', coalesce(nome,'sistema')||' moveu de '||old.status||' para '||new.status);
  end if;
  return new;
end $$;
drop trigger if exists pautas_fluxo on public.pautas;
create trigger pautas_fluxo before update on public.pautas for each row execute procedure public.pauta_fluxo();
drop trigger if exists pautas_carimbo on public.pautas;
create trigger pautas_carimbo before insert or update on public.pautas for each row execute procedure public.carimbar2();
drop trigger if exists pautas_audit on public.pautas;
create trigger pautas_audit after insert or update or delete on public.pautas for each row execute procedure public.auditar();

alter table public.pautas enable row level security;
alter table public.pautas_comentarios enable row level security;
drop policy if exists pautas_sel on public.pautas;  create policy pautas_sel on public.pautas for select to authenticated using (public.sou_equipe());
drop policy if exists pautas_ins on public.pautas;  create policy pautas_ins on public.pautas for insert to authenticated with check (public.sou_equipe());
drop policy if exists pautas_upd on public.pautas;  create policy pautas_upd on public.pautas for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
drop policy if exists pautas_del on public.pautas;  create policy pautas_del on public.pautas for delete to authenticated using (public.sou_admin());
drop policy if exists pcom_sel on public.pautas_comentarios; create policy pcom_sel on public.pautas_comentarios for select to authenticated using (public.sou_equipe());
drop policy if exists pcom_ins on public.pautas_comentarios; create policy pcom_ins on public.pautas_comentarios for insert to authenticated with check (public.sou_equipe() and (autor_id is null or autor_id = auth.uid()));
drop policy if exists pcom_del on public.pautas_comentarios; create policy pcom_del on public.pautas_comentarios for delete to authenticated using (public.sou_admin() or autor_id = auth.uid());
revoke all on public.pautas from anon; revoke all on public.pautas_comentarios from anon;
do $$ begin if exists (select 1 from pg_roles where rolname='bi') then revoke all on public.pautas from bi; revoke all on public.pautas_comentarios from bi; end if; end $$;

create or replace view public.v_pautas with (security_invoker = true) as
select p.*, co.nome as responsavel_nome, ap.nome as aprovado_por_nome,
       (select count(*) from public.pautas_comentarios c where c.pauta_id = p.id and c.tipo in ('comentario','ajuste')) as n_comentarios,
       (select c.texto from public.pautas_comentarios c where c.pauta_id = p.id and c.tipo = 'ajuste' order by c.created_at desc limit 1) as ultimo_ajuste,
       case when p.data_prevista < current_date and p.status not in ('publicado','cancelado') then true else false end as atrasada
from public.pautas p
left join public.colaboradores co on co.id = p.responsavel_id
left join public.perfis ap on ap.id = p.aprovado_por;
revoke all on public.v_pautas from anon;

create or replace view public.v_pautas_comentarios with (security_invoker = true) as
select c.*, coalesce(p.nome, p.email) as autor_nome from public.pautas_comentarios c left join public.perfis p on p.id = c.autor_id;
revoke all on public.v_pautas_comentarios from anon;

do $$ begin alter publication supabase_realtime add table public.pautas; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.pautas_comentarios; exception when others then null; end $$;

select 'ok 0022' as resultado;
