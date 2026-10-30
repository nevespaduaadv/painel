-- ESPELHO (beta) — Bloco 1 da controladoria: pasta sequencial por processo, campos obrigatórios configuráveis e
-- processos relacionados (originário ↔ cumprimento de sentença, recurso, incidente…). Idempotente. Só no beta até aprovação.

-- ---------- áreas do processo (cadastro do admin) ----------
create table if not exists public.areas_processo (
  id serial primary key,
  nome text not null unique,
  ordem integer not null default 0,
  ativa boolean not null default true
);
insert into public.areas_processo (nome, ordem) values
  ('Bancário PJ', 1), ('Superendividamento', 2), ('Revisional', 3), ('Execução / Cobrança', 4), ('Cível', 5), ('Trabalhista', 6), ('Tributário', 7), ('Extrajudicial', 8)
on conflict (nome) do nothing;
alter table public.areas_processo enable row level security;
drop policy if exists areas_sel on public.areas_processo; create policy areas_sel on public.areas_processo for select to authenticated using (public.sou_equipe());
drop policy if exists areas_adm on public.areas_processo; create policy areas_adm on public.areas_processo for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select on public.areas_processo to authenticated; grant insert, update, delete on public.areas_processo to authenticated;
grant usage, select on sequence public.areas_processo_id_seq to authenticated;

-- ---------- pastas ----------
create table if not exists public.pastas (
  numero serial primary key,                          -- número da pasta (sequencial, nunca reaproveitado)
  titulo text,
  cliente_id text references public.clientes (id) on delete set null,
  status text not null default 'ativa' check (status in ('ativa','encerrada')),
  aberta_em date not null default current_date,
  encerrada_em date,
  tipo_encerramento text,
  caixa_arquivo text,                                 -- localização física (caixa/arquivo morto), se houver
  observacoes text,
  created_by uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pastas_cliente_idx on public.pastas (cliente_id);
alter table public.pastas enable row level security;
drop policy if exists pastas_sel on public.pastas; create policy pastas_sel on public.pastas for select to authenticated using (public.sou_equipe());
drop policy if exists pastas_mod on public.pastas; create policy pastas_mod on public.pastas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update on public.pastas to authenticated;
grant usage, select on sequence public.pastas_numero_seq to authenticated;

-- ---------- processos: pasta + campos do cabeçalho ----------
alter table public.processos
  add column if not exists pasta_numero integer references public.pastas (numero) on delete set null,
  add column if not exists area text,
  add column if not exists comarca text,
  add column if not exists uf text,
  add column if not exists rito text,
  add column if not exists assunto text,
  add column if not exists data_distribuicao date,
  add column if not exists sub_status text,
  add column if not exists encerrado_em date,
  add column if not exists tipo_encerramento text,
  add column if not exists relevante boolean not null default false,
  add column if not exists sigiloso boolean not null default false,
  add column if not exists grau_risco text check (grau_risco is null or grau_risco in ('alto','medio','baixo')),
  add column if not exists risco_cliente text,
  add column if not exists advogado_contrario text;
create index if not exists processos_pasta_idx on public.processos (pasta_numero);

-- campos obrigatórios do cadastro (o admin liga/desliga); o relatório mostra o que falta em cada processo
create table if not exists public.processo_campos_obrigatorios (
  campo text primary key,
  rotulo text not null,
  obrigatorio boolean not null default true,
  ordem integer not null default 0
);
insert into public.processo_campos_obrigatorios (campo, rotulo, obrigatorio, ordem) values
  ('numero_cnj', 'Número CNJ', true, 1), ('cliente_id', 'Cliente', true, 2), ('area', 'Área', true, 3), ('tipo_acao', 'Tipo de ação', true, 4),
  ('polo', 'Posição do cliente (polo)', true, 5), ('parte_contraria', 'Parte contrária', true, 6), ('tribunal', 'Tribunal', true, 7),
  ('vara', 'Vara / comarca', true, 8), ('data_distribuicao', 'Data de distribuição', true, 9), ('fase', 'Fase', true, 10),
  ('responsavel_id', 'Advogado responsável', true, 11), ('valor_causa', 'Valor da causa', false, 12), ('rito', 'Rito', false, 13),
  ('assunto', 'Assunto', false, 14), ('contrato_id', 'Contrato vinculado', false, 15)
on conflict (campo) do nothing;
alter table public.processo_campos_obrigatorios enable row level security;
drop policy if exists pco_sel on public.processo_campos_obrigatorios; create policy pco_sel on public.processo_campos_obrigatorios for select to authenticated using (public.sou_equipe());
drop policy if exists pco_adm on public.processo_campos_obrigatorios; create policy pco_adm on public.processo_campos_obrigatorios for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
grant select, insert, update, delete on public.processo_campos_obrigatorios to authenticated;

create or replace function public.processo_campos_faltando(p public.processos) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(c.rotulo order by c.ordem), '{}')
    from public.processo_campos_obrigatorios c
   where c.obrigatorio and nullif(btrim(coalesce(to_jsonb(p) ->> c.campo, '')), '') is null;
$$;

-- pasta automática: todo processo novo sem pasta abre a sua (título = cliente ou parte contrária)
create or replace function public.processos_pasta_auto() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer; t text;
begin
  if new.pasta_numero is null then
    select coalesce(c.nome_fantasia, c.dados ->> 'nome') into t from public.clientes c where c.id = new.cliente_id;
    insert into public.pastas (titulo, cliente_id, aberta_em, created_by)
    values (coalesce(t, new.parte_contraria, new.numero_cnj, 'Processo'), new.cliente_id, coalesce(new.data_distribuicao, current_date), coalesce(new.created_by, auth.uid()))
    returning numero into n;
    new.pasta_numero := n;
  end if;
  return new;
end $$;
drop trigger if exists processos_pasta_auto on public.processos;
create trigger processos_pasta_auto before insert on public.processos for each row execute function public.processos_pasta_auto();

-- processos existentes sem pasta: uma pasta por processo, na ordem de cadastro (sequencial)
do $$ declare r record; n integer;
begin
  for r in select p.id, p.cliente_id, p.parte_contraria, p.numero_cnj, p.created_at, coalesce(c.nome_fantasia, c.dados ->> 'nome') as cli
             from public.processos p left join public.clientes c on c.id = p.cliente_id
            where p.pasta_numero is null order by p.created_at, p.id loop
    insert into public.pastas (titulo, cliente_id, aberta_em, created_at) values (coalesce(r.cli, r.parte_contraria, r.numero_cnj, 'Processo'), r.cliente_id, r.created_at::date, r.created_at) returning numero into n;
    update public.processos set pasta_numero = n where id = r.id;
  end loop;
end $$;

-- ---------- processos relacionados ----------
create table if not exists public.processo_relacoes (
  id bigserial primary key,
  processo_id uuid not null references public.processos (id) on delete cascade,      -- principal / originário
  relacionado_id uuid not null references public.processos (id) on delete cascade,   -- derivado
  tipo text not null check (tipo in ('cumprimento_sentenca','recurso','incidente','execucao','cautelar','embargos','conexo','outro')),
  observacao text,
  created_by uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (processo_id, relacionado_id),
  check (processo_id <> relacionado_id)
);
create index if not exists processo_relacoes_rel_idx on public.processo_relacoes (relacionado_id);
alter table public.processo_relacoes enable row level security;
drop policy if exists prel_sel on public.processo_relacoes; create policy prel_sel on public.processo_relacoes for select to authenticated using (public.sou_equipe());
drop policy if exists prel_mod on public.processo_relacoes; create policy prel_mod on public.processo_relacoes for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
grant select, insert, update, delete on public.processo_relacoes to authenticated;
grant usage, select on sequence public.processo_relacoes_id_seq to authenticated;

-- relaciona e, se pedido, leva o derivado para a pasta do principal (a pasta antiga fica encerrada se ficar vazia)
create or replace function public.processo_relacionar(p_principal uuid, p_relacionado uuid, p_tipo text, p_mesma_pasta boolean default true, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pp integer; pr integer;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  insert into public.processo_relacoes (processo_id, relacionado_id, tipo, observacao) values (p_principal, p_relacionado, p_tipo, p_obs)
  on conflict (processo_id, relacionado_id) do update set tipo = excluded.tipo, observacao = coalesce(excluded.observacao, public.processo_relacoes.observacao);
  if p_mesma_pasta then
    select pasta_numero into pp from public.processos where id = p_principal;
    select pasta_numero into pr from public.processos where id = p_relacionado;
    if pp is not null and pr is distinct from pp then
      update public.processos set pasta_numero = pp, updated_at = now() where id = p_relacionado;
      if pr is not null and not exists (select 1 from public.processos where pasta_numero = pr) then
        update public.pastas set status = 'encerrada', encerrada_em = current_date, tipo_encerramento = 'unificada na pasta ' || pp, updated_at = now() where numero = pr;
      end if;
    end if;
  end if;
end $$;
grant execute on function public.processo_relacionar(uuid, uuid, text, boolean, text) to authenticated;

-- ---------- views ----------
create or replace view public.v_processo_relacoes with (security_invoker = true) as
select r.id, r.processo_id, r.relacionado_id, r.tipo, r.observacao, r.created_at, 'derivado' as sentido,
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara
  from public.processo_relacoes r join public.processos x on x.id = r.relacionado_id
union all
select r.id, r.relacionado_id as processo_id, r.processo_id as relacionado_id, r.tipo, r.observacao, r.created_at, 'originario' as sentido,
       x.numero_cnj, x.tipo_acao, x.fase, x.status, x.pasta_numero, x.tribunal, x.vara
  from public.processo_relacoes r join public.processos x on x.id = r.processo_id;
grant select on public.v_processo_relacoes to authenticated;

-- v_processos: mantém a ordem das colunas antigas (as views que dependem dela continuam válidas) e acrescenta as novas no fim
create or replace view public.v_processos with (security_invoker = true) as
select p.id, p.cliente_id, p.contrato_id, p.numero_cnj, p.tribunal, p.vara, p.tipo_acao, p.parte_contraria, p.banco, p.polo, p.fase, p.valor_causa,
       p.proximo_prazo, p.prazo_fatal, p.responsavel_id, p.status, p.visivel_cliente, p.fonte, p.id_externo, p.observacoes, p.created_at, p.created_by, p.updated_at, p.updated_by,
       c.nome as cliente_nome, co.nome as responsavel_nome,
       (select max(a.data) from public.andamentos a where a.processo_id = p.id) as ultimo_andamento,
       (select count(*) from public.andamentos a where a.processo_id = p.id) as qtd_andamentos,
       current_date - coalesce((select max(a.data) from public.andamentos a where a.processo_id = p.id), p.created_at::date) as dias_sem_andamento,
       (p.proximo_prazo - current_date) as dias_para_prazo,
       (select count(*) from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento')) as tarefas_abertas,
       (p.status = 'ativo'
        and not exists (select 1 from public.andamentos a where a.processo_id = p.id and a.data >= current_date - 30)
        and not exists (select 1 from public.tarefas t where t.processo_id = p.id and t.status in ('aberta','em_andamento'))) as sem_providencia,
       -- novas (beta 0002)
       p.pasta_numero, p.area, p.comarca, p.uf, p.rito, p.assunto, p.data_distribuicao, p.sub_status, p.encerrado_em, p.tipo_encerramento,
       p.relevante, p.sigiloso, p.grau_risco, p.risco_cliente, p.advogado_contrario,
       pa.titulo as pasta_titulo, pa.status as pasta_status,
       public.processo_campos_faltando(p) as campos_faltando,
       (select count(*) from public.processo_relacoes r where r.processo_id = p.id or r.relacionado_id = p.id) as qtd_relacionados,
       (select count(*) from public.publicacoes pb where pb.processo_id = p.id) as qtd_publicacoes
from public.processos p
left join public.clientes c on c.id = p.cliente_id
left join public.colaboradores co on co.id = p.responsavel_id
left join public.pastas pa on pa.numero = p.pasta_numero;
grant select on public.v_processos to authenticated;

create or replace view public.v_pastas with (security_invoker = true) as
select pa.*, c.nome as cliente_nome,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero) as qtd_processos,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero and p.status = 'ativo') as qtd_ativos,
       (select string_agg(coalesce(p.numero_cnj, p.tipo_acao), ' · ' order by p.created_at) from public.processos p where p.pasta_numero = pa.numero) as processos_txt
  from public.pastas pa left join public.clientes c on c.id = pa.cliente_id;
grant select on public.v_pastas to authenticated;

-- a busca global já usa v_processos; o relatório de cadastro incompleto é a própria view (campos_faltando <> '{}')
select 'ok beta 0002' as resultado, (select count(*) from public.pastas) as pastas, (select count(*) from public.processos where pasta_numero is null) as processos_sem_pasta;
