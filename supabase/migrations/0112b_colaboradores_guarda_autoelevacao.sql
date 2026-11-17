-- 0112b — Correção de segurança isolada: a pessoa não altera os campos da PRÓPRIA ficha que concedem permissão.
--
-- Falha: a policy colab_self (0006/0023) deixa o colaborador atualizar a própria linha em public.colaboradores, sem restrição de
-- colunas. Trocando o próprio núcleo ou a própria frente, ele passa a satisfazer edita_protecao() (0093) e edita_ata() (0107),
-- que leem esses campos. O mesmo vale para reativar a própria ficha (ativo) ou trocar o vínculo de login (perfil_id).
--
-- Correção: gatilho BEFORE UPDATE. Núcleo, frente, situação (ativo), vínculo de login e data de desligamento só mudam pela
-- administradora. Os demais campos da própria ficha (bio, telefone, foto etc.) continuam editáveis pela pessoa.
-- Rotinas do sistema sem usuário (auth.uid() nulo: agendamentos, migrações) não são afetadas.
--
-- Não cria tabela, não altera dado, não muda policy. Idempotente.
-- Compatível com a 0113 (cargos funcionais): ela redefine esta mesma função e este mesmo gatilho, com as regras a mais dos cargos.
-- Reversão: drop trigger colaboradores_guarda on public.colaboradores; drop function public.colaboradores_guarda_tg();
create or replace function public.colaboradores_guarda_tg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.nucleo is distinct from old.nucleo or new.frente is distinct from old.frente or new.ativo is distinct from old.ativo
      or new.perfil_id is distinct from old.perfil_id or new.data_desligamento is distinct from old.data_desligamento)
     and auth.uid() is not null and not public.sou_admin() then
    raise exception 'Núcleo, frente, situação e vínculo de login só mudam pela administradora.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists colaboradores_guarda on public.colaboradores;
create trigger colaboradores_guarda before update on public.colaboradores for each row execute function public.colaboradores_guarda_tg();

select 'ok 0112b' as resultado, (select count(*) from pg_trigger where tgname = 'colaboradores_guarda' and tgrelid = 'public.colaboradores'::regclass) as gatilho;
