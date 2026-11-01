-- 0087 — Anexos em requisições (atestado, comprovante) e base para anexos em outros registros. As tarefas já têm anexos
-- por evento (comentário, conclusão, passagem). Arquivos de requisição só são vistos por quem pediu e por quem aprova. Idempotente.

alter table public.anexos add column if not exists requisicao_id uuid references public.requisicoes(id) on delete cascade;
alter table public.anexos drop constraint if exists anexos_dono_chk;
alter table public.anexos add constraint anexos_dono_chk check (entrada_id is not null or tarefa_evento_id is not null or requisicao_id is not null);
create index if not exists anexos_requisicao_idx on public.anexos (requisicao_id) where requisicao_id is not null;

drop policy if exists anexos_requisicao on public.anexos;
create policy anexos_requisicao on public.anexos for all to authenticated
  using (requisicao_id is not null and (public.aprova_requisicoes() or exists (select 1 from public.requisicoes r where r.id = requisicao_id and r.colaborador_id = public.meu_colaborador())))
  with check (requisicao_id is not null and (public.aprova_requisicoes() or exists (select 1 from public.requisicoes r where r.id = requisicao_id and r.colaborador_id = public.meu_colaborador())));

-- storage: a pasta requisicoes/<id>/ do bucket anexos fica restrita a quem pediu e a quem aprova
drop policy if exists anexos_storage_equipe on storage.objects;
create policy anexos_storage_equipe on storage.objects for all to authenticated
  using (bucket_id = 'anexos' and public.sou_equipe() and (storage.foldername(name))[1] is distinct from 'requisicoes')
  with check (bucket_id = 'anexos' and public.sou_equipe() and (storage.foldername(name))[1] is distinct from 'requisicoes');
drop policy if exists anexos_storage_requisicoes on storage.objects;
create policy anexos_storage_requisicoes on storage.objects for all to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = 'requisicoes'
         and (public.aprova_requisicoes() or exists (select 1 from public.requisicoes r where r.id::text = (storage.foldername(name))[2] and r.colaborador_id = public.meu_colaborador())))
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = 'requisicoes'
         and (public.aprova_requisicoes() or exists (select 1 from public.requisicoes r where r.id::text = (storage.foldername(name))[2] and r.colaborador_id = public.meu_colaborador())));

create or replace view public.v_requisicoes with (security_invoker = true) as
select r.*, c.nome as colaborador_nome, c.nucleo, public.requisicao_tipo_nome(r.tipo) as tipo_nome,
       public.nome_perfil(r.decidido_por) as decidido_por_nome, (r.data_fim - r.data_inicio + 1) as dias,
       coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'caminho_storage', a.caminho_storage, 'tamanho', a.tamanho) order by a.created_at)
                 from public.anexos a where a.requisicao_id = r.id), '[]'::jsonb) as anexos
from public.requisicoes r join public.colaboradores c on c.id = r.colaborador_id;
grant select on public.v_requisicoes to authenticated;

select 'ok 0087' as resultado;
