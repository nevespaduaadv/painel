-- 0097 — Função reutilizável: após cada importação do ADVBox, o painel chama advbox_cofre_senhas() para levar logins/senhas
-- que vieram dentro do texto das tarefas/andamentos para Cadastro → Acessos a sistemas (senha no Vault) e limpar o texto.
-- Mesma lógica da 0096, agora como rpc (equipe). Idempotente.
create or replace function public.advbox_cofre_senhas() returns json
language plpgsql security definer set search_path = public, vault as $$
declare r record; m text[]; v_titular text; v_login text; v_senha text; aid uuid; sid uuid; novo text; n int := 0; nred int := 0;
begin
  if auth.uid() is not null and not public.sou_equipe() then raise exception 'sem permissão'; end if;  -- sem auth = SQL editor/cron
  for r in
    select 'tarefa' as origem, t.id::text as rid, t.cliente_id, t.titulo, t.descricao as texto, coalesce(t.updated_at, t.created_at) as quando
      from public.tarefas t where t.cliente_id is not null and t.descricao ~* '(senha|login|acesso gov)'
    union all
    select 'dossie', e.id::text, e.cliente_id, 'andamento', e.descricao, coalesce(e.updated_at, e.created_at)
      from public.entradas_timeline e where e.cliente_id is not null and e.descricao ~* '(senha|login|acesso gov)'
    order by quando asc
  loop
    novo := r.texto;
    for m in select regexp_matches(r.texto,
        '(?:Gov\.?\s*([^\n:]{2,40}?)\s*\n)?[ \t]*(?:LOGIN|Login|ACESSO|Acesso)[ \t]*(?:GOV|Gov)?[ \t]*:?[ \t]*([0-9][0-9.\-]{7,})[ \t]*\n[ \t]*(?:SENHA|Senha)?[ \t]*:?[ \t]*(\S+)', 'g')
    loop
      v_titular := nullif(btrim(m[1]), ''); v_login := btrim(m[2]); v_senha := btrim(m[3]);
      if v_senha ~* '^(senha|login|acesso|\(senha)' or length(v_senha) < 4 then continue; end if;
      select a.id into aid from public.acessos_sistemas a where a.cliente_id = r.cliente_id and a.login = v_login limit 1;
      if aid is null then
        insert into public.acessos_sistemas (cliente_id, sistema, titular, login, observacoes)
        values (r.cliente_id, 'gov.br', v_titular, v_login, 'Importado do ADVBox (' || r.titulo || ') em ' || to_char(now(), 'DD/MM/YYYY') || '. Confira se o acesso ainda vale.')
        returning id into aid;
        n := n + 1;
      end if;
      select senha_secret_id into sid from public.acessos_sistemas where id = aid;
      if sid is null then
        sid := vault.create_secret(v_senha, 'acesso_senha:' || aid::text, 'senha de acesso — gov.br');
        update public.acessos_sistemas set senha_secret_id = sid where id = aid;
      else
        perform vault.update_secret(sid, v_senha);  -- texto mais recente prevalece
      end if;
      novo := replace(novo, v_senha, '(senha no cofre: Cadastro → Acessos a sistemas)');
    end loop;
    if novo is distinct from r.texto then
      if r.origem = 'tarefa' then update public.tarefas set descricao = novo where id::text = r.rid;
      else update public.entradas_timeline set descricao = novo where id::text = r.rid; end if;
      nred := nred + 1;
    end if;
  end loop;
  return json_build_object('acessos', n, 'textos', nred);
end $$;
grant execute on function public.advbox_cofre_senhas() to authenticated;
revoke all on function public.advbox_cofre_senhas() from anon;
select public.advbox_cofre_senhas() as resultado;
