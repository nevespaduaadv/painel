-- 0071 — Fechamento, parte 2: documentos gerados (.docx de contrato e procurações) e pasta do cliente no Drive.
-- Modelos ficam no bucket privado "modelos" (equipe lê, admin envia); os arquivos gerados vão para o bucket "anexos"
-- em <cliente_id>/fechamento/… e são listados em fechamentos.documentos. Idempotente. Depende de 0068.

-- bucket dos modelos
insert into storage.buckets (id, name, public, file_size_limit) values ('modelos', 'modelos', false, 20971520)
on conflict (id) do update set public = false;
drop policy if exists modelos_storage_sel on storage.objects;
create policy modelos_storage_sel on storage.objects for select to authenticated using (bucket_id = 'modelos' and public.sou_equipe());
drop policy if exists modelos_storage_adm on storage.objects;
create policy modelos_storage_adm on storage.objects for all to authenticated
  using (bucket_id = 'modelos' and public.sou_admin()) with check (bucket_id = 'modelos' and public.sou_admin());

-- documentos gerados por fechamento
alter table public.fechamentos add column if not exists documentos jsonb not null default '[]'::jsonb;
-- [{tipo:'contrato'|'procuracoes', nome, caminho (bucket anexos), gerado_em, por, drive_id, drive_url}]

-- configuração do Drive (pasta "- PESSOA JURÍDICA" dentro de CLIENTES; descoberta pela Edge se vazio) e e-mail impersonado
update public.escritorio set dados = dados
  || jsonb_build_object('drive_pasta_pj_id', coalesce(dados->>'drive_pasta_pj_id', null))
  || jsonb_build_object('drive_usuario', coalesce(dados->>'drive_usuario', 'contato@nevespaduaadvocacia.com.br'))
  || jsonb_build_object('drive_subpastas', coalesce(dados->'drive_subpastas', '["DOSSIÊ"]'::jsonb))
 where id = 'fechamento';

-- registrar documento gerado (equipe)
create or replace function public.fechamento_documento_registrar(p_fechamento uuid, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare docs jsonb; novo jsonb;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  novo := p_doc || jsonb_build_object('gerado_em', now(), 'por', auth.uid());
  select documentos into docs from public.fechamentos where id = p_fechamento for update;
  if docs is null then raise exception 'Fechamento não encontrado.'; end if;
  -- substitui documento do mesmo tipo (regerado)
  docs := coalesce((select jsonb_agg(d) from jsonb_array_elements(docs) d where d->>'tipo' <> (p_doc->>'tipo')), '[]'::jsonb) || jsonb_build_array(novo);
  update public.fechamentos set documentos = docs,
    contrato_gerado_em = case when p_doc->>'tipo' = 'contrato' then now() else contrato_gerado_em end,
    contrato_url = case when p_doc->>'tipo' = 'contrato' and nullif(p_doc->>'drive_url','') is not null then p_doc->>'drive_url' else contrato_url end
  where id = p_fechamento;
  return novo;
end $$;
revoke all on function public.fechamento_documento_registrar(uuid, jsonb) from public, anon;

-- atualizar os dados do fechamento (completar RG/endereço do representante etc.) — equipe
create or replace function public.fechamento_dados_atualizar(p_fechamento uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not public.sou_equipe() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select dados into d from public.fechamentos where id = p_fechamento for update;
  if d is null then raise exception 'Fechamento não encontrado.'; end if;
  -- merge raso por seção (empresa, representante, honorarios, condicoes)
  d := d || jsonb_build_object(
    'empresa', coalesce(d->'empresa', '{}'::jsonb) || coalesce(p_patch->'empresa', '{}'::jsonb),
    'representante', coalesce(d->'representante', '{}'::jsonb) || coalesce(p_patch->'representante', '{}'::jsonb),
    'honorarios', coalesce(d->'honorarios', '{}'::jsonb) || coalesce(p_patch->'honorarios', '{}'::jsonb),
    'condicoes', coalesce(d->'condicoes', '{}'::jsonb) || coalesce(p_patch->'condicoes', '{}'::jsonb));
  update public.fechamentos set dados = d where id = p_fechamento;
  return d;
end $$;
revoke all on function public.fechamento_dados_atualizar(uuid, jsonb) from public, anon;

-- a view expõe os documentos
drop view if exists public.v_fechamentos;
create view public.v_fechamentos with (security_invoker = true) as
select f.id, f.lead_id, f.cliente_id, f.dados, f.closer_id, co.nome as closer_nome, f.contrato_gerado_em, f.contrato_url, f.documentos, f.created_at,
       c.nome as cliente_nome, c.nome_fantasia, c.cnpj, c.pasta_drive_id, c.pasta_drive_url
  from public.fechamentos f
  left join public.colaboradores co on co.id = f.closer_id
  join public.clientes c on c.id = f.cliente_id;

-- Edge (service_role): gravar pasta do Drive no cliente
create or replace function public.cliente_pasta_drive_definir(p_cliente text, p_id text, p_url text)
returns void language sql security definer set search_path = public as $$
  update public.clientes set pasta_drive_id = p_id, pasta_drive_url = p_url where id = p_cliente;
$$;
revoke all on function public.cliente_pasta_drive_definir(text, text, text) from public, anon, authenticated;
grant execute on function public.cliente_pasta_drive_definir(text, text, text) to service_role;

select 'ok 0071' as resultado;
