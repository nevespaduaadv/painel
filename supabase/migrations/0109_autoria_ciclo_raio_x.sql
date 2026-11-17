-- 0109 — Autoria e auditoria do ciclo (acompanhamento_pj) e do Raio-X de dívidas (dividas_raio_x).
-- Depende da 0104 (tabelas) e das funções existentes carimbar2/auditar (0002). NÃO aplicar sem autorização específica.
--
-- Achado da homologação multiperfil (15/11): as duas tabelas da 0104 não têm gatilho de carimbo nem de auditoria —
-- updated_by/created_by ficam vazios e nada vai para public.auditoria; quem mudou o ciclo ou uma dívida não fica registrado.
--
-- Desenho (padrões existentes, com duas adaptações justificadas):
--   1. Carimbo: mesma ideia de carimbar2(), mas a AUTORIA vem da sessão e a criação é imutável (carimbar2 aceita o
--      created_by enviado pelo navegador — coalesce(new.created_by, auth.uid()) — o que permitiria forjar autoria pela API;
--      a 0107 já fixou esse princípio para as atas: o autor é decidido pelo banco). Sem sessão (rotinas do banco/cron),
--      fica o que vier. updated_by = auth.uid(), como no carimbar2.
--   2. Auditoria: dividas_raio_x usa auditar() (tem id). acompanhamento_pj não tem coluna id (a chave é cliente_id), então
--      auditar() falharia (new.id); auditar_por_cliente() é a mesma função com o cliente como registro.
--   3. Histórico: NADA é preenchido para registros antigos. acompanhamento_pj ganha created_at/created_by SEM default na
--      criação da coluna (linhas existentes ficam nulas = "não registrado"); o default vale só para linhas novas.
-- Idempotente.

-- ---------- 1. colunas (acompanhamento_pj não tinha criação) ----------
alter table public.acompanhamento_pj add column if not exists created_at timestamptz;
alter table public.acompanhamento_pj add column if not exists created_by uuid;
alter table public.acompanhamento_pj alter column created_at set default now();   -- só para linhas novas; as antigas ficam nulas

-- ---------- 2. carimbo com autoria da sessão e criação imutável ----------
create or replace function public.carimbar_autoria() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);   -- com sessão, vale a sessão; sem sessão (rotina do banco), o enviado
  else
    new.created_at := old.created_at;                          -- criação não muda depois de gravada (nem é inventada)
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ---------- 3. auditoria para tabela com chave cliente_id ----------
create or replace function public.auditar_por_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.auditoria(usuario, tabela, registro, acao, antes, depois)
  values (auth.uid(), tg_table_name, coalesce(new.cliente_id, old.cliente_id), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
revoke all on function public.carimbar_autoria(), public.auditar_por_cliente() from public, anon;

-- ---------- 4. gatilhos ----------
drop trigger if exists acompanhamento_pj_carimbo on public.acompanhamento_pj;
create trigger acompanhamento_pj_carimbo before insert or update on public.acompanhamento_pj for each row execute function public.carimbar_autoria();
drop trigger if exists acompanhamento_pj_audit on public.acompanhamento_pj;
create trigger acompanhamento_pj_audit after insert or update or delete on public.acompanhamento_pj for each row execute function public.auditar_por_cliente();
drop trigger if exists dividas_raio_x_carimbo on public.dividas_raio_x;
create trigger dividas_raio_x_carimbo before insert or update on public.dividas_raio_x for each row execute function public.carimbar_autoria();
drop trigger if exists dividas_raio_x_audit on public.dividas_raio_x;
create trigger dividas_raio_x_audit after insert or update or delete on public.dividas_raio_x for each row execute function public.auditar();

select 'ok 0109' as resultado,
       (select count(*) from pg_trigger where tgrelid = 'public.acompanhamento_pj'::regclass and not tgisinternal) as gatilhos_ciclo,
       (select count(*) from pg_trigger where tgrelid = 'public.dividas_raio_x'::regclass and not tgisinternal) as gatilhos_raio_x,
       (select count(*) from public.acompanhamento_pj where created_by is not null) as ciclos_com_autor,
       (select count(*) from public.dividas_raio_x where created_by is not null) as dividas_com_autor;
