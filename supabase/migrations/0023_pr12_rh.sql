-- 0023 — PR 12: RH — ficha do colaborador (foto, dados pessoais), dados sensíveis/salário só para admin, histórico e PDI.
-- Regras: equipe vê a ficha básica de todos (foto, cargo, núcleo, contato, aniversário); salário, documentos e histórico
-- só admin; cada colaborador vê e atualiza o próprio PDI e vê os registros marcados como visíveis para ele.
-- Idempotente. Depende de 0006 e 0022 (núcleos marketing/rh).

-- ---------- ficha básica (visível à equipe) ----------
alter table public.colaboradores
  add column if not exists foto_path text,            -- caminho no bucket 'fotos'
  add column if not exists apelido text,
  add column if not exists data_nascimento date,
  add column if not exists cidade text,
  add column if not exists linkedin text,
  add column if not exists bio text;                  -- "sobre mim" curto

-- ---------- dados sensíveis (só admin) ----------
create table if not exists public.colaboradores_rh (
  id uuid not null default gen_random_uuid(),                   -- a auditoria genérica exige coluna id
  colaborador_id uuid primary key references public.colaboradores(id) on delete cascade,
  cpf text, rg text, pis text,
  estado_civil text,
  endereco text,
  contato_emergencia text,                            -- nome e telefone
  vinculo text check (vinculo in ('clt','pj','estagio','socio','autonomo','outro')),
  jornada text,                                       -- "44h", "meio período"…
  salario numeric(12,2),
  beneficios text,                                    -- VR, VT, plano…
  cnpj_pj text, razao_social_pj text,
  banco_pix text,
  documentos jsonb not null default '[]',             -- [{titulo, url}]
  observacoes text,
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
drop trigger if exists colaboradores_rh_carimbo on public.colaboradores_rh;
create trigger colaboradores_rh_carimbo before insert or update on public.colaboradores_rh for each row execute procedure public.carimbar2();
drop trigger if exists colaboradores_rh_audit on public.colaboradores_rh;
create trigger colaboradores_rh_audit after insert or update or delete on public.colaboradores_rh for each row execute procedure public.auditar();
alter table public.colaboradores_rh enable row level security;
drop policy if exists crh_admin on public.colaboradores_rh;
create policy crh_admin on public.colaboradores_rh for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.colaboradores_rh from anon;

-- ---------- histórico (admissão, reajuste, promoção, feedback formal, férias, advertência, desligamento) — só admin ----------
create table if not exists public.colaboradores_historico (
  id bigserial primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  data date not null default current_date,
  tipo text not null check (tipo in ('admissao','promocao','reajuste','mudanca_cargo','ferias','feedback','advertencia','desligamento','outro')),
  descricao text,
  valor numeric(12,2),                                -- novo salário, quando reajuste
  created_at timestamptz default now(), created_by uuid
);
create index if not exists colab_hist_idx on public.colaboradores_historico(colaborador_id, data desc);
alter table public.colaboradores_historico enable row level security;
drop policy if exists chist_admin on public.colaboradores_historico;
create policy chist_admin on public.colaboradores_historico for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.colaboradores_historico from anon;

-- ---------- PDI ----------
create table if not exists public.pdi (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  titulo text not null,
  descricao text,                                     -- competência, como medir
  prazo date,
  status text not null default 'planejado' check (status in ('planejado','em_andamento','concluido','cancelado')),
  progresso smallint not null default 0 check (progresso between 0 and 100),
  created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now(), updated_by uuid
);
create index if not exists pdi_colab_idx on public.pdi(colaborador_id, status);
drop trigger if exists pdi_carimbo on public.pdi;
create trigger pdi_carimbo before insert or update on public.pdi for each row execute procedure public.carimbar2();
alter table public.pdi enable row level security;
drop policy if exists pdi_admin on public.pdi;
create policy pdi_admin on public.pdi for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists pdi_proprio_sel on public.pdi;
create policy pdi_proprio_sel on public.pdi for select to authenticated using (colaborador_id = public.meu_colaborador());
drop policy if exists pdi_proprio_upd on public.pdi;
create policy pdi_proprio_upd on public.pdi for update to authenticated using (colaborador_id = public.meu_colaborador()) with check (colaborador_id = public.meu_colaborador());
revoke all on public.pdi from anon;

-- registros de acompanhamento: 1:1, feedback, avaliação, nota — admin escreve; colaborador vê os marcados como visíveis
create table if not exists public.pdi_registros (
  id bigserial primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  pdi_id uuid references public.pdi(id) on delete set null,
  data date not null default current_date,
  tipo text not null default 'one_on_one' check (tipo in ('one_on_one','feedback','avaliacao','nota')),
  texto text not null,
  visivel_colaborador boolean not null default true,
  created_at timestamptz default now(), created_by uuid
);
create index if not exists pdi_reg_idx on public.pdi_registros(colaborador_id, data desc);
alter table public.pdi_registros enable row level security;
drop policy if exists pdir_admin on public.pdi_registros;
create policy pdir_admin on public.pdi_registros for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists pdir_proprio on public.pdi_registros;
create policy pdir_proprio on public.pdi_registros for select to authenticated using (visivel_colaborador and colaborador_id = public.meu_colaborador());
revoke all on public.pdi_registros from anon;

-- ---------- fotos (bucket privado; URL assinada na tela) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos','fotos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists fotos_sel on storage.objects;
create policy fotos_sel on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.sou_equipe());
drop policy if exists fotos_wr on storage.objects;
create policy fotos_wr on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.sou_equipe());
drop policy if exists fotos_upd on storage.objects;
create policy fotos_upd on storage.objects for update to authenticated using (bucket_id = 'fotos' and public.sou_equipe());
drop policy if exists fotos_del on storage.objects;
create policy fotos_del on storage.objects for delete to authenticated using (bucket_id = 'fotos' and public.sou_admin());

-- colaborador pode atualizar os próprios campos básicos (a policy colab_self já existe; só garantimos que exista)
drop policy if exists colab_self on public.colaboradores;
create policy colab_self on public.colaboradores for update to authenticated using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

-- ---------- views ----------
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
       co.created_at, co.updated_at
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;
revoke all on public.v_colaboradores from anon;

-- aniversariantes do mês (equipe)
create or replace view public.v_aniversarios with (security_invoker = true) as
select id, nome, apelido, foto_path, data_nascimento, extract(month from data_nascimento)::int as mes, extract(day from data_nascimento)::int as dia
from public.colaboradores where ativo and data_nascimento is not null;
revoke all on public.v_aniversarios from anon;

do $$ begin alter publication supabase_realtime add table public.pdi; exception when others then null; end $$;

select 'ok 0023' as resultado;
