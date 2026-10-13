-- 0061 — Chat interno (canais por área + conversas diretas), menções no sino, ponte com o Discord (canal Geral ↔ #geral)
-- e espelho dos Avisos no Discord. Envio ao Discord pela Edge Function chatguru (rota /automacoes, fila discord_fila);
-- leitura do Discord a cada minuto (mensagens novas do canal espelhado entram no chat com origem 'discord').
-- Idempotente. Depende de 0056 (tem_acesso), 0060 (avisos), 0034 (notificar), 0028 (token das automações).

create table if not exists public.chat_canais (
  id uuid primary key default gen_random_uuid(),
  chave text unique,                       -- geral | juridico | ... (null para DM)
  nome text not null,
  tipo text not null default 'canal' check (tipo in ('canal','dm')),
  areas text[],                            -- canal: null = todos; senão quem tem alguma das áreas
  membros uuid[],                          -- dm: os dois perfis
  discord_canal text,                      -- ID do canal do Discord espelhado (opcional)
  discord_ultimo_id text,                  -- última mensagem do Discord já importada
  ordem integer not null default 100,
  created_at timestamptz not null default now()
);
insert into public.chat_canais (chave, nome, areas, ordem) values
  ('geral', 'Geral', null, 1), ('juridico', 'Jurídico', array['juridico'], 2), ('comercial', 'Comercial', array['comercial'], 3),
  ('marketing', 'Marketing', array['marketing'], 4), ('financeiro', 'Financeiro', array['financeiro'], 5), ('socias', 'Sócias', array['__admin__'], 6)
on conflict (chave) do nothing;

create table if not exists public.chat_mensagens (
  id bigserial primary key,
  canal_id uuid not null references public.chat_canais(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null,
  autor_nome text,
  texto text not null,
  origem text not null default 'painel' check (origem in ('painel','discord','sistema')),
  discord_msg_id text unique,
  discord_enviada_em timestamptz,
  editada_em timestamptz,
  apagada boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists chat_msg_canal_idx on public.chat_mensagens (canal_id, id desc);

create table if not exists public.chat_leituras (
  canal_id uuid references public.chat_canais(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete cascade,
  lida_ate timestamptz not null default now(),
  primary key (canal_id, perfil_id)
);

create table if not exists public.discord_fila (
  id bigserial primary key,
  canal_discord text not null,
  texto text not null,
  referencia text,                         -- chat:<id> | aviso:<id>
  status text not null default 'pendente' check (status in ('pendente','processando','enviada','erro')),
  tentativas integer not null default 0,
  resultado text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists discord_fila_pend_idx on public.discord_fila (id) where status = 'pendente';

alter table public.chat_canais enable row level security;
alter table public.chat_mensagens enable row level security;
alter table public.chat_leituras enable row level security;
alter table public.discord_fila enable row level security;

create or replace function public.chat_canal_visivel(c public.chat_canais) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sou_equipe() and case
    when c.tipo = 'dm' then auth.uid() = any(coalesce(c.membros, '{}'))
    when c.areas is null or cardinality(c.areas) = 0 then true
    when '__admin__' = any(c.areas) then public.sou_admin()
    else public.sou_admin() or exists (select 1 from unnest(c.areas) a where public.tem_acesso(a)) end
$$;
drop policy if exists "chat canais: ver" on public.chat_canais; create policy "chat canais: ver" on public.chat_canais for select to authenticated using (public.chat_canal_visivel(chat_canais));
drop policy if exists "chat canais: admin" on public.chat_canais; create policy "chat canais: admin" on public.chat_canais for update to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists "chat msg: ver" on public.chat_mensagens; create policy "chat msg: ver" on public.chat_mensagens for select to authenticated using (exists (select 1 from public.chat_canais c where c.id = canal_id and public.chat_canal_visivel(c)));
drop policy if exists "chat msg: enviar" on public.chat_mensagens; create policy "chat msg: enviar" on public.chat_mensagens for insert to authenticated with check (autor_id = auth.uid() and origem = 'painel' and exists (select 1 from public.chat_canais c where c.id = canal_id and public.chat_canal_visivel(c)));
drop policy if exists "chat msg: editar" on public.chat_mensagens; create policy "chat msg: editar" on public.chat_mensagens for update to authenticated using (autor_id = auth.uid() or public.sou_admin()) with check (autor_id = auth.uid() or public.sou_admin());
drop policy if exists "chat leituras: proprias" on public.chat_leituras; create policy "chat leituras: proprias" on public.chat_leituras for all to authenticated using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());
drop policy if exists "discord fila: admin le" on public.discord_fila; create policy "discord fila: admin le" on public.discord_fila for select to authenticated using (public.sou_admin());

-- conversa direta (cria se não existir)
create or replace function public.chat_dm(p_outro uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare id_ uuid; eu uuid := auth.uid(); nome_outro text; nome_eu text;
begin
  if eu is null or not public.sou_equipe() then raise exception 'Acesso negado.'; end if;
  if p_outro = eu then raise exception 'Escolha outra pessoa.'; end if;
  if not exists (select 1 from public.perfis where id = p_outro and papel in ('admin','colaborador')) then raise exception 'Pessoa sem acesso ao sistema.'; end if;
  select id into id_ from public.chat_canais where tipo = 'dm' and membros @> array[eu, p_outro] and cardinality(membros) = 2 limit 1;
  if id_ is null then
    select nome into nome_outro from public.perfis where id = p_outro; select nome into nome_eu from public.perfis where id = eu;
    insert into public.chat_canais (nome, tipo, membros, ordem) values (coalesce(nome_eu,'?') || ' · ' || coalesce(nome_outro,'?'), 'dm', array[eu, p_outro], 50) returning id into id_;
  end if;
  return id_;
end $$;
grant execute on function public.chat_dm(uuid) to authenticated;

-- nome da DM do ponto de vista de quem vê
create or replace view public.v_chat_canais with (security_invoker = true) as
select c.id, c.chave, c.tipo, c.areas, c.membros, c.discord_canal, c.ordem,
       case when c.tipo = 'dm' then coalesce((select p.nome from public.perfis p where p.id = any(c.membros) and p.id <> auth.uid() limit 1), c.nome) else c.nome end as nome,
       (select max(m.id) from public.chat_mensagens m where m.canal_id = c.id and not m.apagada) as ultima_id,
       (select max(m.criado_em) from public.chat_mensagens m where m.canal_id = c.id and not m.apagada) as ultima_em,
       (select count(*) from public.chat_mensagens m where m.canal_id = c.id and not m.apagada and m.autor_id is distinct from auth.uid()
          and m.criado_em > coalesce((select l.lida_ate from public.chat_leituras l where l.canal_id = c.id and l.perfil_id = auth.uid()), 'epoch'::timestamptz)) as nao_lidas
from public.chat_canais c;

-- ---------- efeitos ao enviar: menções (sino) e espelho no Discord ----------
create or replace function public.chat_msg_efeitos() returns trigger language plpgsql security definer set search_path = public as $$
declare c public.chat_canais; p record; nome text; alvo text; primeiro text;
begin
  select * into c from public.chat_canais where id = new.canal_id;
  if new.autor_nome is null and new.autor_id is not null then select coalesce(co.apelido, split_part(pf.nome,' ',1), pf.nome) into nome from public.perfis pf left join public.colaboradores co on co.perfil_id = pf.id where pf.id = new.autor_id; update public.chat_mensagens set autor_nome = nome where id = new.id; else nome := new.autor_nome; end if;
  -- DM: avisa o outro no sino; canal: avisa quem foi mencionado com @Nome
  if c.tipo = 'dm' then
    for p in select unnest(c.membros) as id loop
      if p.id <> coalesce(new.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) then perform public.notificar(p.id, '💬 ' || coalesce(nome,'Mensagem') || ' te enviou uma mensagem', left(new.texto, 120), '#chat/' || c.id::text); end if;
    end loop;
  elsif new.texto like '%@%' then
    for p in select pf.id, pf.nome, co.apelido, co.nome as nome_colab from public.perfis pf left join public.colaboradores co on co.perfil_id = pf.id where pf.papel in ('admin','colaborador') and pf.id is distinct from new.autor_id loop
      primeiro := split_part(coalesce(p.nome,''), ' ', 1); alvo := split_part(coalesce(p.nome_colab,''), ' ', 1);
      if (primeiro <> '' and new.texto ~* ('@' || primeiro || '\M')) or (alvo <> '' and new.texto ~* ('@' || alvo || '\M')) or (p.apelido is not null and new.texto ~* ('@' || p.apelido || '\M')) or new.texto ~* '@todos\M' then
        perform public.notificar(p.id, '💬 ' || coalesce(nome,'Alguém') || ' mencionou você em #' || c.nome, left(new.texto, 120), '#chat/' || c.id::text);
      end if;
    end loop;
  end if;
  -- ponte: canal com Discord e mensagem escrita no painel
  if c.discord_canal is not null and new.origem = 'painel' then
    insert into public.discord_fila (canal_discord, texto, referencia) values (c.discord_canal, '**' || coalesce(nome,'Sistema') || ':** ' || left(new.texto, 1800), 'chat:' || new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists chat_msg_efeitos on public.chat_mensagens;
create trigger chat_msg_efeitos after insert on public.chat_mensagens for each row execute procedure public.chat_msg_efeitos();

-- avisos → Discord (canal configurado em escritorio('discord').canal_avisos)
insert into public.escritorio (id, dados) values ('discord', '{"canal_avisos": null, "ponte_ativa": true}'::jsonb) on conflict (id) do nothing;
drop policy if exists "escritorio: discord admin" on public.escritorio;
create policy "escritorio: discord admin" on public.escritorio for update to authenticated using (id = 'discord' and public.sou_admin()) with check (id = 'discord' and public.sou_admin());

create or replace function public.avisos_discord() returns trigger language plpgsql security definer set search_path = public as $$
declare canal text; painel text;
begin
  select dados->>'canal_avisos' into canal from public.escritorio where id = 'discord';
  if canal is null then return new; end if;
  painel := public.painel_url();
  insert into public.discord_fila (canal_discord, texto, referencia)
  values (canal, '📣 **' || new.titulo || '**' || E'\n' || left(new.texto, 1700) || E'\n' || case when new.areas is null or cardinality(new.areas) = 0 then '_Para todo o escritório_' else '_Para: ' || array_to_string(new.areas, ', ') || '_' end || E'\n' || painel || '/#avisos/' || new.id::text, 'aviso:' || new.id::text);
  update public.avisos set discord_enviado_em = now() where id = new.id;
  return new;
end $$;
drop trigger if exists avisos_discord on public.avisos;
create trigger avisos_discord after insert on public.avisos for each row execute procedure public.avisos_discord();

-- ---------- Edge: fila de envio e importação do Discord ----------
create or replace function public.discord_fila_reservar(token text, limite integer default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  update public.discord_fila set status = 'pendente', atualizado_em = now() where status = 'processando' and atualizado_em < now() - interval '10 minutes';
  with esc as (select id from public.discord_fila where status = 'pendente' order by id limit greatest(1, least(limite, 30)) for update skip locked),
       r as (update public.discord_fila f set status = 'processando', tentativas = f.tentativas + 1, atualizado_em = now() from esc where f.id = esc.id returning f.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'canal', r.canal_discord, 'texto', r.texto)), '[]'::jsonb) into res from r;
  return res;
end $$;
revoke all on function public.discord_fila_reservar(text, integer) from public, anon, authenticated;
grant execute on function public.discord_fila_reservar(text, integer) to service_role;

create or replace function public.discord_fila_registrar(token text, resultados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for it in select value from jsonb_array_elements(coalesce(resultados, '[]'::jsonb)) loop
    if coalesce((it->>'ok')::boolean, false) then
      update public.discord_fila set status = 'enviada', resultado = it->>'descricao', atualizado_em = now() where id = (it->>'id')::bigint;
      update public.chat_mensagens set discord_enviada_em = now() where id = (select nullif(split_part(referencia, ':', 2), '')::bigint from public.discord_fila where id = (it->>'id')::bigint and referencia like 'chat:%');
    elsif coalesce((it->>'temporario')::boolean, false) and (select tentativas from public.discord_fila where id = (it->>'id')::bigint) < 5 then
      update public.discord_fila set status = 'pendente', resultado = it->>'erro', atualizado_em = now() where id = (it->>'id')::bigint;
    else
      update public.discord_fila set status = 'erro', resultado = it->>'erro', atualizado_em = now() where id = (it->>'id')::bigint;
    end if;
  end loop;
end $$;
revoke all on function public.discord_fila_registrar(text, jsonb) from public, anon, authenticated;
grant execute on function public.discord_fila_registrar(text, jsonb) to service_role;

-- canais espelhados (para a Edge consultar o Discord)
create or replace function public.discord_canais_ponte(token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  if not coalesce((select (dados->>'ponte_ativa')::boolean from public.escritorio where id = 'discord'), true) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('canal_id', id, 'discord_canal', discord_canal, 'ultimo_id', discord_ultimo_id)) from public.chat_canais where discord_canal is not null and tipo = 'canal'), '[]'::jsonb);
end $$;
revoke all on function public.discord_canais_ponte(text) from public, anon, authenticated;
grant execute on function public.discord_canais_ponte(text) to service_role;

-- mensagens vindas do Discord (já filtradas: sem as do próprio bot)
create or replace function public.discord_importar(token text, p_canal uuid, mensagens jsonb, p_ultimo text) returns integer
language plpgsql security definer set search_path = public as $$
declare m jsonb; n int := 0;
begin
  if not public.automacoes_token_valido(token) then raise exception 'Token inválido.' using errcode = '28000'; end if;
  for m in select value from jsonb_array_elements(coalesce(mensagens, '[]'::jsonb)) loop
    insert into public.chat_mensagens (canal_id, autor_id, autor_nome, texto, origem, discord_msg_id, criado_em)
    values (p_canal, (select pf.id from public.colaboradores co join public.perfis pf on pf.id = co.perfil_id where co.discord_user_id = m->>'autor_discord_id' limit 1),
            coalesce(m->>'autor_nome', 'Discord'), left(coalesce(m->>'texto',''), 4000), 'discord', m->>'id', coalesce((m->>'em')::timestamptz, now()))
    on conflict (discord_msg_id) do nothing;
    n := n + 1;
  end loop;
  if p_ultimo is not null then update public.chat_canais set discord_ultimo_id = p_ultimo where id = p_canal; end if;
  return n;
end $$;
revoke all on function public.discord_importar(text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.discord_importar(text, uuid, jsonb, text) to service_role;

-- o cron das automações acorda também pela fila do Discord e pela ponte (consulta a cada minuto quando há canal espelhado)
create or replace function public.automacoes_ha_trabalho() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.automacao_execucoes e join public.automacoes a on a.id = e.automacao_id
    where (e.status = 'pendente' and e.executar_em <= now()
           and (not a.ativa or not a.so_horario_comercial or public.em_horario_comercial(now())))
       or (e.status = 'processando' and e.atualizado_em < now() - interval '10 minutes')
  ) or exists (
    select 1 from public.mensagens_fila m
    where (m.status = 'pendente' and m.enviar_em <= now() and m.numero is not null and public.em_horario_comercial(now()))
       or (m.status = 'processando' and m.atualizado_em < now() - interval '10 minutes')
  ) or exists (select 1 from public.discord_fila f where f.status = 'pendente')
    or (coalesce((select (dados->>'ponte_ativa')::boolean from public.escritorio where id = 'discord'), true)
        and exists (select 1 from public.chat_canais c where c.discord_canal is not null));
$$;

select 'ok 0061' as resultado;
