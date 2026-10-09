-- 0030 — PR 15: fluxo do lead conforme "Modos Operantes" (prazo e dono por fase, tarefas do lead, motivos de perda
-- padronizados) e campos para os relatórios de "Como montar seu DASH". Idempotente. Depende de 0027.

-- ---------- prazo e dono por fase ----------
alter table public.fases
  add column if not exists prazo_horas integer,                 -- prazo máximo na fase (null = sem prazo)
  add column if not exists dono text check (dono in ('sdr','closer','ambos')),
  add column if not exists sigla text;                          -- rótulo curto do material (Lead, MQL, SQL, OPP…)
update public.fases set prazo_horas = v.p, dono = v.d, sigla = v.s from (values
  (1, 12,  'sdr',    'Lead'),
  (2, 120, 'sdr',    'Lead'),
  (3, 72,  'sdr',    'MQL'),
  (4, 72,  'ambos',  'SQL'),
  (5, 24,  'sdr',    'No-show'),
  (6, 24,  'closer', 'SE'),
  (7, 24,  'closer', 'OPP'),
  (8, 168, 'closer', 'Follow-up'),
  (9, 168, 'closer', 'Follow-up'),
  (10, null, null,   'Ganho')) as v(id, p, d, s) where fases.id = v.id;
drop policy if exists "fases: admin edita" on public.fases;
create policy "fases: admin edita" on public.fases for update to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- ---------- tarefas do lead ----------
create table if not exists public.lead_tarefas (
  id bigserial primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  tipo text not null default 'ligar' check (tipo in ('ligar','whatsapp','social_selling','se_agendada','se_realizada','se_noshow','segunda_call','follow_up','prazo','tarefa','email','pagar')),
  titulo text,
  quando timestamptz not null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  concluida_em timestamptz,
  concluida_por uuid references public.perfis (id) on delete set null,
  created_at timestamptz not null default now(),
  criado_por uuid references public.perfis (id) on delete set null default auth.uid()
);
create index if not exists lead_tarefas_lead_idx on public.lead_tarefas (lead_id, concluida_em);
create index if not exists lead_tarefas_quando_idx on public.lead_tarefas (quando) where concluida_em is null;
alter table public.lead_tarefas enable row level security;
drop policy if exists "lead_tarefas: equipe" on public.lead_tarefas;
create policy "lead_tarefas: equipe" on public.lead_tarefas for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.lead_tarefas from anon;

-- Ao concluir uma tarefa de SE agendada / realizada / no-show, nada automático na fase: quem decide é o kanban (regra do material).

-- ---------- motivos de perda padronizados ----------
create table if not exists public.motivos_perda (
  codigo text primary key,
  rotulo text not null,
  papel text not null check (papel in ('sdr','closer','cs')),
  descricao text,
  ordem integer not null default 100,
  ativo boolean not null default true
);
alter table public.motivos_perda enable row level security;
drop policy if exists "motivos: ver" on public.motivos_perda;
create policy "motivos: ver" on public.motivos_perda for select to authenticated using (public.sou_equipe());
drop policy if exists "motivos: admin" on public.motivos_perda;
create policy "motivos: admin" on public.motivos_perda for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
revoke all on public.motivos_perda from anon;
insert into public.motivos_perda (codigo, rotulo, papel, descricao, ordem) values
  ('closer_no_show',        '[closer] No show',                         'closer', 'O lead não compareceu à call.', 10),
  ('closer_sem_pitch',      '[closer] Não teve pitch',                  'closer', 'Fez a reunião, mas não recebeu pitch por algum motivo específico.', 11),
  ('closer_nao_prioridade', '[closer] Não é prioridade',                'closer', 'O lead diz que a solução não é prioridade para ele.', 12),
  ('closer_contatos_esgot', '[closer] Tentativas de contato esgotadas', 'closer', 'Disse que ia fechar e parou de responder, sumiu.', 13),
  ('closer_sem_budget',     '[closer] Não tem budget',                  'closer', 'Não tem recursos para contratar.', 14),
  ('closer_nao_decisor',    '[closer] Não é decisor',                   'closer', 'Falamos com gerente, vendedor ou funcionário.', 15),
  ('closer_outro_escrit',   '[closer] Contratou outro escritório',      'closer', 'Decidiu fechar com outro escritório.', 16),
  ('closer_concorrente',    '[closer] Possível concorrente espionando', 'closer', 'A call pareceu de concorrente.', 17),
  ('closer_sem_valor',      '[closer] Não encontrou valor',             'closer', 'Não acreditou na solução / sem interesse.', 18),
  ('sdr_nao_decisor',       '[sdr] Não é o decisor (gerente/vendedor)', 'sdr',    'Falamos com gerente, vendedor ou funcionário.', 20),
  ('sdr_fake',              '[sdr] Fake',                               'sdr',    'O lead não existe.', 21),
  ('sdr_numero_incorreto',  '[sdr] Número incorreto',                   'sdr',    'Número de contato errado.', 22),
  ('sdr_nunca_respondeu',   '[sdr] Não respondeu abordagem (nunca retornou)', 'sdr', 'Nunca atendeu nem respondeu WhatsApp.', 23),
  ('sdr_nao_agendou',       '[sdr] Não conseguimos agendar SE',         'sdr',    'Qualificado, mas não conseguimos agendar.', 24),
  ('sdr_sem_interesse',     '[sdr] Não tem interesse em agendar',       'sdr',    'Avisou que não tem interesse na conversa/SE.', 25),
  ('sdr_duplicado',         '[sdr] Duplicado',                          'sdr',    'Mesmo negócio duplicado.', 26),
  ('sdr_resolveu_banco',    '[sdr] Resolveu direto com o banco',        'sdr',    'Renegociou diretamente com o banco.', 27),
  ('cs_reembolso',          '[cs] Reembolso / cancelamento 7 dias',     'cs',     'Cancelou no prazo de arrependimento.', 30)
on conflict (codigo) do update set rotulo = excluded.rotulo, papel = excluded.papel, descricao = excluded.descricao, ordem = excluded.ordem;

-- ---------- views ----------
drop view if exists public.v_leads;
create view public.v_leads with (security_invoker = true) as
select l.*, f.nome as fase_nome, f.ordem as fase_ordem, f.cor as fase_cor, f.prazo_horas, f.dono as fase_dono, f.sigla as fase_sigla,
       coalesce(p.nome, p.email) as proprietario_nome,
       coalesce((select array_agg(t.nome order by t.nome) from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.lead_id = l.id), '{}') as tags,
       (select count(*) from public.observacoes o where o.lead_id = l.id) as total_observacoes,
       extract(day from now() - l.fase_desde)::int as dias_na_fase,
       round(extract(epoch from now() - l.fase_desde) / 3600)::int as horas_na_fase,
       case when l.status <> 'Aberto' or f.prazo_horas is null then 'ok'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) then 'estourado'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) * 0.8 then 'alerta'
            else 'ok' end as atraso,
       (select min(t.quando) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as proxima_tarefa,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as tarefas_abertas,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null and t.quando < now()) as tarefas_vencidas
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id;
revoke all on public.v_leads from anon;

drop view if exists public.v_lead_tarefas;
create view public.v_lead_tarefas with (security_invoker = true) as
select t.*, l.nome as lead_nome, l.empresa as lead_empresa, l.whatsapp as lead_whatsapp, l.fase_id, l.status as lead_status,
       coalesce(p.nome, p.email) as responsavel_nome
from public.lead_tarefas t join public.leads l on l.id = t.lead_id left join public.perfis p on p.id = t.responsavel_id;
revoke all on public.v_lead_tarefas from anon;

do $$ begin alter publication supabase_realtime add table public.lead_tarefas; exception when others then null; end $$;
select 'ok 0030' as resultado;
