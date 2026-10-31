-- 0082 — Superendividamento: a listagem (v_planos_superendividamento) quebrava quando um plano tinha renda/saldo gravados
-- no formato brasileiro ("5.239,93"): cast direto para numeric falha e a tela mostra "Não foi possível carregar os planos".
-- Conversão tolerante + normalização do que já está gravado. Idempotente.

create or replace function public.num_br(t text) returns numeric language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then null
    when t ~ '^-?\d+(\.\d+)?$' then t::numeric                                  -- já numérico (ponto decimal)
    when t ~ ',' then replace(replace(regexp_replace(t, '[^0-9,.\-]', '', 'g'), '.', ''), ',', '.')::numeric  -- 5.239,93
    when t ~ '^-?\d{1,3}(\.\d{3})+$' then replace(t, '.', '')::numeric           -- 5.239 (milhar sem centavos)
    else nullif(regexp_replace(t, '[^0-9.\-]', '', 'g'), '')::numeric end
$$;

create or replace view public.v_planos_superendividamento with (security_invoker = true) as
select p.id, p.titulo, p.cliente_id, c.nome as cliente_nome, p.devedor->>'nome' as devedor_nome, p.status,
       public.num_br(p.entradas->>'renda') as renda,
       (select coalesce(sum(public.num_br(d->>'saldo')),0) from jsonb_array_elements(coalesce(p.entradas->'dividas','[]'::jsonb)) d) as saldo_total,
       jsonb_array_length(coalesce(p.entradas->'dividas','[]'::jsonb)) as qtd_dividas,
       p.resultado->'cinco'->>'parcela' as parcela_cinco, p.resultado->'cabe'->>'meses' as meses_cabe,
       p.created_at, p.updated_at, public.nome_perfil(p.created_by) as criado_por_nome
from public.planos_superendividamento p
left join public.clientes c on c.id = p.cliente_id;
grant select on public.v_planos_superendividamento to authenticated;

-- normaliza o que já está gravado em formato BR
update public.planos_superendividamento p set entradas = jsonb_set(entradas, '{renda}', to_jsonb(public.num_br(entradas->>'renda')::text))
 where entradas->>'renda' ~ ',';
update public.planos_superendividamento p set entradas = jsonb_set(entradas, '{dividas}', (
  select jsonb_agg(d || jsonb_build_object('saldo', coalesce(public.num_br(d->>'saldo')::text, d->>'saldo'), 'parcela', coalesce(public.num_br(d->>'parcela')::text, d->>'parcela')))
  from jsonb_array_elements(entradas->'dividas') d))
 where exists (select 1 from jsonb_array_elements(coalesce(entradas->'dividas','[]'::jsonb)) d where (d->>'saldo') ~ ',' or (d->>'parcela') ~ ',');

select 'ok 0082' as resultado, (select count(*) from public.v_planos_superendividamento) as planos;
