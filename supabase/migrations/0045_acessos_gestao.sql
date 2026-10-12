-- 0045 — Acessos da seção Gestão: Visão geral só para admin; Growth para admin ou quem tiver a permissão 'growth' em perfis.acessos
-- (marcada pelo admin na tela Usuários). Os dados do Growth (tabelas growth_*) passam a respeitar essa permissão no banco. Idempotente.

alter table public.perfis add column if not exists acessos text[] not null default '{}';

create or replace function public.pode_growth() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' or 'growth' = any(acessos) from public.perfis where id = auth.uid()), false)
$$;
grant execute on function public.pode_growth() to authenticated;

-- o próprio usuário lê o perfil (já existia); o admin edita acessos pela política de admin em perfis (já existente)

-- tabelas do Growth: leitura só para quem pode
do $$ declare t text; begin
  foreach t in array array['growth_meta_anuncios_dia','growth_meta_conta_dia','growth_ig_dia','growth_ig_posts','growth_coletas'] loop
    execute format('drop policy if exists "growth: equipe le" on public.%I', t);
    execute format('drop policy if exists "growth: pode le" on public.%I', t);
    execute format('create policy "growth: pode le" on public.%I for select to authenticated using (public.pode_growth())', t);
  end loop;
end $$;

-- v_growth_leads: só devolve linhas para quem pode (os leads continuam visíveis na tela de Leads para a equipe)
create or replace view public.v_growth_leads with (security_invoker = true) as
with h as (
  select lead_id, max(para_fase_id) as fase_max, min(created_at) filter (where para_fase_id >= 3) as qualificado_em,
         min(created_at) filter (where para_fase_id >= 4 and para_fase_id <> 5) as reuniao_agendada_em,
         min(created_at) filter (where para_fase_id >= 6) as reuniao_realizada_em
  from public.historico_fases group by lead_id
)
select l.id, (l.data_entrada at time zone 'America/Sao_Paulo')::date as dia, l.data_entrada, l.origem, l.campanha, l.publico, l.anuncio,
       l.fase_id, f.nome as fase_nome, l.status, l.motivo_perda, l.valor, l.proprietario_id,
       greatest(l.fase_id, coalesce(h.fase_max, 0)) as fase_max,
       (l.status = 'Ganho' or greatest(l.fase_id, coalesce(h.fase_max,0)) >= 3) as qualificado,
       (l.status = 'Perdido' and greatest(l.fase_id, coalesce(h.fase_max,0)) < 3
          and coalesce(l.motivo_perda,'') ~* 'desqualific|n[ãa]o tem d[ií]vida|d[ií]vida baixa|n[ãa]o tem empresa|\mclt\M|oferecendo|empr[ée]stimo|fake|oculto|n[ãa]o cabe|n[ãa]o quer ficar inadimplente|pessoa f[ií]sica') as desqualificado,
       (l.status = 'Perdido' and greatest(l.fase_id, coalesce(h.fase_max,0)) < 3
          and coalesce(l.motivo_perda,'') ~* 'sem resposta|n[úu]mero errado|n[ãa]o atende|bloqueou|cad[êe]ncia|parou de responder|n[ãa]o encontramos|inv[áa]lido') as sem_contato,
       (greatest(l.fase_id, coalesce(h.fase_max,0)) >= 4 and greatest(l.fase_id, coalesce(h.fase_max,0)) <> 5 or h.reuniao_agendada_em is not null or l.reuniao_em is not null) as reuniao_agendada,
       (greatest(l.fase_id, coalesce(h.fase_max,0)) >= 6 or h.reuniao_realizada_em is not null) as reuniao_realizada,
       (greatest(l.fase_id, coalesce(h.fase_max,0)) >= 7) as proposta,
       (l.status = 'Ganho') as ganho,
       h.qualificado_em, h.reuniao_agendada_em, h.reuniao_realizada_em, l.data_fechamento
from public.leads l
join public.fases f on f.id = l.fase_id
left join h on h.lead_id = l.id
where public.pode_growth();

-- status da coleta: só para quem pode
create or replace function public.growth_status() returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.pode_growth() then null else jsonb_build_object(
    'ultima_coleta', (select to_jsonb(c) from (select iniciado_em, terminado_em, ok, erro, detalhes from public.growth_coletas order by id desc limit 1) c),
    'meta_primeiro_dia', (select min(data) from public.growth_meta_conta_dia), 'meta_ultimo_dia', (select max(data) from public.growth_meta_conta_dia),
    'ig_primeiro_dia', (select min(data) from public.growth_ig_dia), 'ig_ultimo_dia', (select max(data) from public.growth_ig_dia),
    'ig_posts', (select count(*) from public.growth_ig_posts),
    'cron', (select jsonb_build_object('schedule', schedule) from cron.job where jobname = 'growth-np')) end;
$$;

select 'ok 0045' as resultado;
