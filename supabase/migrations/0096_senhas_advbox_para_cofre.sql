-- 0096 — Logins/senhas (gov.br etc.) que vieram do ADVBox dentro do texto de tarefas e comentários não ficam soltos:
-- vão para Cadastro → Acessos a sistemas (acessos_sistemas, senha no Vault) e o texto original passa a mostrar
-- "(senha no cofre)" no lugar da senha. Idempotente: roda de novo sem duplicar (chave cliente + login).
-- Padrões tratados: "Login: X / Senha: Y", "LOGIN GOV X / SENHA: Y", "ACESSO GOV: X / SENHA: Y", "LOGIN GOV X / Y",
-- com linha opcional "Gov. <titular>" antes.

do $$
declare r record; m text[]; v_titular text; v_login text; v_senha text; aid uuid; sid uuid; novo text; n int := 0; nred int := 0;
begin
  alter table public.tarefas disable trigger user;
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
  alter table public.tarefas enable trigger user;
  raise notice 'acessos criados: %, textos limpos: %', n, nred;
end $$;

select c.nome as cliente, a.sistema, a.titular, a.login, (a.senha_secret_id is not null) as tem_senha, a.observacoes
  from public.acessos_sistemas a join public.clientes c on c.id = a.cliente_id
 where a.observacoes like 'Importado do ADVBox%' order by c.nome;
