-- ESPELHO (beta) — Pastas sem processo (extrajudicial / consultivo) e contratos bancários apontando para a pasta.
-- Idempotente. Depende de beta 0002/0003.

alter table public.pastas
  add column if not exists tipo text not null default 'judicial' check (tipo in ('judicial', 'extrajudicial', 'consultivo')),
  add column if not exists descricao text;

-- contrato bancário (passivo) → pasta
alter table public.contratos add column if not exists pasta_numero integer references public.pastas (numero) on delete set null;
create index if not exists contratos_pasta_idx on public.contratos (pasta_numero);

-- abrir pasta diretamente pelo cliente (sem processo)
create or replace function public.pasta_abrir(p_cliente text, p_titulo text default null, p_tipo text default 'extrajudicial', p_descricao text default null)
returns public.pastas language plpgsql security definer set search_path = public as $$
declare r public.pastas;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  insert into public.pastas (cliente_id, titulo, tipo, descricao) values (p_cliente, nullif(trim(p_titulo), ''), coalesce(p_tipo, 'extrajudicial'), nullif(trim(p_descricao), '')) returning * into r;
  return r;
end $$;
grant execute on function public.pasta_abrir(text, text, text, text) to authenticated;

-- vincular/desvincular contratos bancários a uma pasta (vários de uma vez; null desvincula)
create or replace function public.pasta_vincular_contratos(p_pasta integer, p_contratos text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.sou_equipe() then raise exception 'Só equipe.'; end if;
  update public.contratos set pasta_numero = p_pasta where id = any(p_contratos);
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.pasta_vincular_contratos(integer, text[]) to authenticated;

-- processo que entra numa pasta extrajudicial a torna judicial
create or replace function public.processos_pasta_tipo_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pasta_numero is not null then update public.pastas set tipo = 'judicial', updated_at = now() where numero = new.pasta_numero and tipo <> 'judicial'; end if;
  return new;
end $$;
drop trigger if exists processos_pasta_tipo on public.processos;
create trigger processos_pasta_tipo after insert or update of pasta_numero on public.processos for each row execute function public.processos_pasta_tipo_tg();

drop view if exists public.v_pastas;
create view public.v_pastas with (security_invoker = true) as
select pa.numero, pa.titulo, pa.cliente_id, pa.status, pa.aberta_em, pa.encerrada_em, pa.tipo_encerramento, pa.caixa_arquivo, pa.observacoes, pa.created_by, pa.created_at, pa.updated_at,
       c.nome as cliente_nome,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero) as qtd_processos,
       (select count(*) from public.processos p where p.pasta_numero = pa.numero and p.status = 'ativo') as qtd_ativos,
       (select string_agg(coalesce(p.numero_cnj, p.tipo_acao), ' · ' order by p.created_at) from public.processos p where p.pasta_numero = pa.numero) as processos_txt,
       pa.ano, pa.seq, pa.codigo, pa.tipo, pa.descricao,
       (select count(*) from public.contratos k where k.pasta_numero = pa.numero) as qtd_contratos,
       (select string_agg(coalesce(k.banco, k.dados->>'banco', k.id), ' · ' order by k.created_at) from public.contratos k where k.pasta_numero = pa.numero) as contratos_txt
  from public.pastas pa left join public.clientes c on c.id = pa.cliente_id;
grant select on public.v_pastas to authenticated;

select 'ok beta 0005' as resultado, (select count(*) from public.pastas) as pastas;
