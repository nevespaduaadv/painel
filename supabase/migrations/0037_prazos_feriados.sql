-- 0037 — Prazos processuais: feriados (nacionais, forenses, estaduais, municipais) e suspensões de prazo (recesso, art. 220 CPC).
-- A contagem é feita no painel (prazos.js) a partir destas tabelas. Idempotente.

create table if not exists public.feriados (
  id bigserial primary key,
  data date not null,
  nome text not null,
  tipo text not null default 'nacional' check (tipo in ('nacional','forense','estadual','municipal')),
  uf text,            -- para estadual/municipal
  comarca text,       -- para municipal (texto livre, ex.: 'Franca')
  ativo boolean not null default true,
  created_at timestamptz default now()
);
create unique index if not exists feriados_uidx on public.feriados (data, tipo, coalesce(uf,''), coalesce(comarca,''));
alter table public.feriados enable row level security;
drop policy if exists "feriados: equipe le" on public.feriados;
create policy "feriados: equipe le" on public.feriados for select to authenticated using (public.sou_equipe());
drop policy if exists "feriados: admin edita" on public.feriados;
create policy "feriados: admin edita" on public.feriados for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

create table if not exists public.suspensoes_prazo (
  id bigserial primary key,
  inicio date not null, fim date not null,
  motivo text not null,
  uf text,            -- null = todos os tribunais
  ativo boolean not null default true
);
alter table public.suspensoes_prazo enable row level security;
drop policy if exists "suspensoes: equipe le" on public.suspensoes_prazo;
create policy "suspensoes: equipe le" on public.suspensoes_prazo for select to authenticated using (public.sou_equipe());
drop policy if exists "suspensoes: admin edita" on public.suspensoes_prazo;
create policy "suspensoes: admin edita" on public.suspensoes_prazo for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- Nacionais (Lei 662/49, 6.802/80, 14.759/23) e forenses de observância geral (Lei 5.010/66 art. 62; CNJ) — 2026 e 2027
insert into public.feriados (data, nome, tipo) values
 ('2026-01-01','Confraternização Universal','nacional'),('2026-02-16','Carnaval (segunda)','forense'),('2026-02-17','Carnaval (terça)','forense'),('2026-02-18','Quarta-feira de Cinzas (expediente parcial)','forense'),
 ('2026-04-03','Sexta-feira Santa','nacional'),('2026-04-21','Tiradentes','nacional'),('2026-05-01','Dia do Trabalho','nacional'),('2026-06-04','Corpus Christi','forense'),
 ('2026-09-07','Independência','nacional'),('2026-10-12','Nossa Senhora Aparecida','nacional'),('2026-11-01','Todos os Santos','forense'),('2026-11-02','Finados','nacional'),('2026-11-15','Proclamação da República','nacional'),('2026-11-20','Consciência Negra','nacional'),
 ('2026-12-08','Dia da Justiça','forense'),('2026-12-24','Véspera de Natal','forense'),('2026-12-25','Natal','nacional'),('2026-12-31','Véspera de Ano Novo','forense'),
 ('2027-01-01','Confraternização Universal','nacional'),('2027-02-08','Carnaval (segunda)','forense'),('2027-02-09','Carnaval (terça)','forense'),('2027-02-10','Quarta-feira de Cinzas (expediente parcial)','forense'),
 ('2027-03-26','Sexta-feira Santa','nacional'),('2027-04-21','Tiradentes','nacional'),('2027-05-01','Dia do Trabalho','nacional'),('2027-05-27','Corpus Christi','forense'),
 ('2027-09-07','Independência','nacional'),('2027-10-12','Nossa Senhora Aparecida','nacional'),('2027-11-01','Todos os Santos','forense'),('2027-11-02','Finados','nacional'),('2027-11-15','Proclamação da República','nacional'),('2027-11-20','Consciência Negra','nacional'),
 ('2027-12-08','Dia da Justiça','forense'),('2027-12-24','Véspera de Natal','forense'),('2027-12-25','Natal','nacional'),('2027-12-31','Véspera de Ano Novo','forense')
on conflict do nothing;
-- Estaduais
insert into public.feriados (data, nome, tipo, uf, comarca) values
 ('2026-07-09','Revolução Constitucionalista','estadual','SP',null),('2027-07-09','Revolução Constitucionalista','estadual','SP',null),
 ('2026-01-25','Aniversário de São Paulo','municipal','SP','São Paulo'),('2027-01-25','Aniversário de São Paulo','municipal','SP','São Paulo'),
 ('2026-11-28','Aniversário de Franca','municipal','SP','Franca'),('2027-11-28','Aniversário de Franca','municipal','SP','Franca')
on conflict do nothing;

-- Recesso forense / suspensão de prazos (CPC art. 220: 20/12 a 20/01)
insert into public.suspensoes_prazo (inicio, fim, motivo)
select d.inicio, d.fim, d.motivo from (values
  ('2025-12-20'::date,'2026-01-20'::date,'Recesso forense — art. 220 CPC'),
  ('2026-12-20'::date,'2027-01-20'::date,'Recesso forense — art. 220 CPC')) as d(inicio,fim,motivo)
where not exists (select 1 from public.suspensoes_prazo s where s.inicio = d.inicio and s.fim = d.fim);

select 'ok 0037 · '||(select count(*) from public.feriados)||' feriados' as resultado;
