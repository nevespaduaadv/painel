-- 0040 — Resumo diário também pelo Discord (DM via bot do servidor do escritório). Canal escolhido por colaborador.
-- Segredo DISCORD_BOT_TOKEN no Vault: select public.chatguru_segredo_definir('DISCORD_BOT_TOKEN', '…');
-- Idempotente. Depende de 0029 e 0038.

alter table public.colaboradores add column if not exists discord_user_id text;
alter table public.colaboradores add column if not exists canal_resumo text not null default 'discord' check (canal_resumo in ('discord','whatsapp','ambos'));

-- segredos: aceitar DISCORD_*
create or replace function public.chatguru_segredo_definir(nome text, valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if nome !~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|PAINEL_URL)$' then raise exception 'Nome de segredo inválido: %', nome; end if;
  select id into sid from vault.secrets where name = nome;
  if sid is null then perform vault.create_secret(valor, nome, 'Integração (Edge Function)');
  else perform vault.update_secret(sid, valor, nome, 'Integração (Edge Function)'); end if;
end $$;
revoke all on function public.chatguru_segredo_definir(text, text) from public, anon, authenticated;

create or replace function public.chatguru_segredos()
returns jsonb language sql security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name ~ '^(CHATGURU_[A-Z_]+|DISCORD_[A-Z_]+|PAINEL_URL)$'
$$;
revoke all on function public.chatguru_segredos() from public, anon, authenticated;
grant execute on function public.chatguru_segredos() to service_role;

-- v_colaboradores com os campos novos
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
       co.created_at, co.updated_at,
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

-- lote: inclui canal e discord; envia a quem tem ao menos um destino configurado
create or replace function public.resumo_diario_lote(token text, forcar_colab uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('colaborador_id', c.id, 'nome', c.nome, 'whatsapp', c.whatsapp, 'discord_user_id', c.discord_user_id, 'canal', c.canal_resumo, 'texto', public.resumo_diario_texto(c.id))), '[]'::jsonb) into res
  from public.colaboradores c
  where c.ativo is distinct from false and c.resumo_diario
    and ((c.canal_resumo in ('discord','ambos') and nullif(c.discord_user_id,'') is not null) or (c.canal_resumo in ('whatsapp','ambos') and nullif(c.whatsapp,'') is not null))
    and (forcar_colab is null or c.id = forcar_colab)
    and (forcar_colab is not null or not exists (select 1 from public.resumos_enviados e where e.colaborador_id = c.id and e.data = hoje and e.ok));
  return res;
end $$;
revoke all on function public.resumo_diario_lote(text, uuid) from public, anon, authenticated;
grant execute on function public.resumo_diario_lote(text, uuid) to service_role;

-- registrar: canal
create or replace function public.resumo_diario_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  insert into public.resumos_enviados (colaborador_id, canal, ok, erro, numero, texto)
  select (r->>'colaborador_id')::uuid, coalesce(r->>'canal','whatsapp'), (r->>'ok')::boolean, r->>'erro', r->>'numero', r->>'texto' from jsonb_array_elements(resultados) r;
end $$;
revoke all on function public.resumo_diario_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.resumo_diario_registrar(text, jsonb) to service_role;

-- meu colaborador (para o botão "enviar agora"): id, canal e destinos
create or replace function public.meu_resumo_destinos() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'nome', nome, 'whatsapp', whatsapp, 'discord_user_id', discord_user_id, 'canal', canal_resumo)
  from public.colaboradores where perfil_id = auth.uid() limit 1
$$;
grant execute on function public.meu_resumo_destinos() to authenticated;

select 'ok 0040' as resultado;
