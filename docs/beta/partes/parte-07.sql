-- ESPELHO (beta) — parte 7 de 9: 0060_avisos_ponto.sql … 0069_formulario_site_leads.sql

-- ===== 0060_avisos_ponto.sql =====
-- 0060 — (a) Mural de avisos do escritório (admins publicam; todos ou por área; leitura registrada; sino);
--        (b) Ponto dos estagiários (entrada / intervalo / volta / saída, espelho mensal, ajuste pela administração).
-- Idempotente. Depende de 0056 (tem_acesso), 0034 (notificar), 0006 (colaboradores).

-- ---------- (a) avisos ----------
create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  texto text not null,
  areas text[],                                  -- null = todo o escritório
  fixado boolean not null default false,
  publicado_em timestamptz not null default now(),
  expira_em date,
  autor_id uuid references public.perfis(id) on delete set null,
  discord_enviado_em timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.avisos_leituras (
  aviso_id uuid references public.avisos(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (aviso_id, perfil_id)
);
alter table public.avisos enable row level security;
alter table public.avisos_leituras enable row level security;

create or replace function public.aviso_visivel(p_areas text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sou_equipe() and (p_areas is null or cardinality(p_areas) = 0 or public.sou_admin()
         or exists (select 1 from unnest(p_areas) a where public.tem_acesso(a)))
$$;
drop policy if exists "avisos: ver" on public.avisos; create policy "avisos: ver" on public.avisos for select to authenticated using (public.aviso_visivel(areas));
drop policy if exists "avisos: admin" on public.avisos; create policy "avisos: admin" on public.avisos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());
drop policy if exists "leituras: proprias" on public.avisos_leituras; create policy "leituras: proprias" on public.avisos_leituras for all to authenticated using (perfil_id = auth.uid() or public.sou_admin()) with check (perfil_id = auth.uid());

-- sino para quem pode ver, ao publicar
create or replace function public.avisos_notificar() returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select id, papel, acessos from public.perfis where papel in ('admin','colaborador') and id <> coalesce(new.autor_id, '00000000-0000-0000-0000-000000000000'::uuid) loop
    if new.areas is null or cardinality(new.areas) = 0 or p.papel = 'admin' or coalesce(new.areas && coalesce(p.acessos,'{}'), false) then
      perform public.notificar(p.id, '📣 Aviso: ' || left(new.titulo, 80), left(regexp_replace(new.texto, E'\\s+', ' ', 'g'), 140), '#avisos/' || new.id::text);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists avisos_notificar on public.avisos;
create trigger avisos_notificar after insert on public.avisos for each row execute procedure public.avisos_notificar();

create or replace view public.v_avisos with (security_invoker = true) as
select a.*, p.nome as autor_nome,
       exists (select 1 from public.avisos_leituras l where l.aviso_id = a.id and l.perfil_id = auth.uid()) as lida,
       (select count(*) from public.avisos_leituras l where l.aviso_id = a.id) as leituras
from public.avisos a left join public.perfis p on p.id = a.autor_id
where a.expira_em is null or a.expira_em >= (now() at time zone 'America/Sao_Paulo')::date;

-- ---------- (b) ponto ----------
alter table public.colaboradores add column if not exists registra_ponto boolean not null default false;
alter table public.colaboradores add column if not exists jornada_minutos integer;   -- ex.: 360 = 6h (estágio)

create table if not exists public.pontos (
  id bigserial primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  momento timestamptz not null default now(),
  tipo text not null check (tipo in ('entrada','saida_intervalo','volta_intervalo','saida')),
  origem text not null default 'painel',
  obs text,
  ajustado_por uuid references public.perfis(id) on delete set null,
  ajustado_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pontos_colab_idx on public.pontos (colaborador_id, momento desc);
alter table public.pontos enable row level security;
drop policy if exists "pontos: ver" on public.pontos; create policy "pontos: ver" on public.pontos for select to authenticated using (colaborador_id = public.meu_colaborador() or public.tem_acesso('equipe'));
drop policy if exists "pontos: bater" on public.pontos; create policy "pontos: bater" on public.pontos for insert to authenticated
  with check (colaborador_id = public.meu_colaborador() and ajustado_por is null and exists (select 1 from public.colaboradores c where c.id = colaborador_id and c.registra_ponto));
drop policy if exists "pontos: admin" on public.pontos; create policy "pontos: admin" on public.pontos for all to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- bater o ponto: escolhe o próximo tipo automaticamente e impede batidas duplicadas em menos de 1 minuto
create or replace function public.bater_ponto(p_tipo text default null, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare colab uuid; ultimo record; prox text; hoje date := (now() at time zone 'America/Sao_Paulo')::date; id_ bigint;
begin
  colab := public.meu_colaborador();
  if colab is null then raise exception 'Seu usuário não está vinculado a um colaborador.'; end if;
  if not exists (select 1 from public.colaboradores where id = colab and registra_ponto) then raise exception 'Seu perfil não registra ponto.'; end if;
  select * into ultimo from public.pontos where colaborador_id = colab and (momento at time zone 'America/Sao_Paulo')::date = hoje order by momento desc limit 1;
  if ultimo.id is not null and ultimo.momento > now() - interval '1 minute' then raise exception 'Você acabou de registrar o ponto. Aguarde um minuto.'; end if;
  prox := coalesce(p_tipo, case coalesce(ultimo.tipo, '') when '' then 'entrada' when 'entrada' then 'saida_intervalo' when 'saida_intervalo' then 'volta_intervalo' when 'volta_intervalo' then 'saida' else 'entrada' end);
  insert into public.pontos (colaborador_id, tipo, obs) values (colab, prox, nullif(p_obs,'')) returning id into id_;
  return jsonb_build_object('id', id_, 'tipo', prox, 'momento', now());
end $$;
grant execute on function public.bater_ponto(text, text) to authenticated;

-- espelho: um registro por colaborador/dia com minutos trabalhados (soma dos pares entrada→saída, descontando intervalo)
create or replace view public.v_ponto_dias with (security_invoker = true) as
with b as (
  select p.colaborador_id, (p.momento at time zone 'America/Sao_Paulo')::date as dia, p.tipo, p.momento,
         lead(p.momento) over (partition by p.colaborador_id, (p.momento at time zone 'America/Sao_Paulo')::date order by p.momento) as proximo
  from public.pontos p
), d as (
  select colaborador_id, dia,
         min(momento) filter (where tipo = 'entrada') as entrada,
         max(momento) filter (where tipo = 'saida') as saida,
         sum(extract(epoch from (proximo - momento)) / 60) filter (where tipo in ('entrada','volta_intervalo') and proximo is not null) as minutos,
         sum(extract(epoch from (proximo - momento)) / 60) filter (where tipo = 'saida_intervalo' and proximo is not null) as intervalo_min,
         count(*) as batidas,
         bool_or(tipo = 'saida') as fechado
  from b group by colaborador_id, dia
)
select d.*, c.nome as colaborador_nome, c.jornada_minutos,
       round(coalesce(d.minutos,0))::int - coalesce(c.jornada_minutos, 360) as saldo_min,
       (select string_agg(to_char(p.momento at time zone 'America/Sao_Paulo', 'HH24:MI') || ' ' || p.tipo, ' · ' order by p.momento) from public.pontos p where p.colaborador_id = d.colaborador_id and (p.momento at time zone 'America/Sao_Paulo')::date = d.dia) as batidas_txt
from d join public.colaboradores c on c.id = d.colaborador_id;

-- v_colaboradores com as colunas novas (no fim)
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
       co.whatsapp, co.resumo_diario, co.discord_user_id, co.canal_resumo, co.google_calendar_id, co.agenda_sync, co.agenda_sync_em, co.agenda_sync_erro,
       co.registra_ponto, co.jornada_minutos
from public.colaboradores co
left join public.perfis p on p.id = co.perfil_id;

-- estagiários: Mário e João Vitor, jornada de 6h
update public.colaboradores set registra_ponto = true, jornada_minutos = coalesce(jornada_minutos, 360) where nome in ('Mário','João Vitor') and ativo;

select 'ok 0060' as resultado;


-- ===== 0061_chat_interno.sql =====
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


-- ===== 0062_djen_tarefas_agrupadas.sql =====
-- 0062 — Publicações do DJEN: uma tarefa por processo e dia de disponibilização (em vez de uma por publicação).
-- A segunda publicação do mesmo processo no mesmo dia entra na descrição da tarefa já aberta. Limpa as duplicadas existentes.
-- Idempotente. Depende de 0014.

create or replace function public.publicacao_vincular() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.processos%rowtype; t uuid; a uuid; resumo text; dig text; rotulo text; n integer;
begin
  dig := regexp_replace(coalesce(new.numero_processo,''), '\D', '', 'g');
  if new.processo_id is null and dig <> '' then
    select * into p from public.processos where regexp_replace(coalesce(numero_cnj,''), '\D', '', 'g') = dig limit 1;
    if found then new.processo_id := p.id; end if;
  end if;
  if new.processo_id is not null and new.andamento_id is null then
    if p.id is null or p.id <> new.processo_id then select * into p from public.processos where id = new.processo_id; end if;
    new.cliente_id := p.cliente_id;
    rotulo := coalesce(new.tipo_documento, new.tipo_comunicacao, 'Publicação');
    resumo := rotulo||' · '||coalesce(new.tribunal,'')||' · '||coalesce(new.orgao,'');
    insert into public.andamentos (processo_id, data, tipo, descricao, visivel_cliente, fonte, id_externo)
    values (new.processo_id, new.data_disponibilizacao, 'intimacao', resumo||E'\n'||left(coalesce(new.texto,''), 1500), false, 'djen', 'djen:'||new.id)
    on conflict do nothing returning id into a;
    new.andamento_id := a;
    -- tarefa já aberta para o mesmo processo e o mesmo dia? então agrupa
    select t2.id into t from public.tarefas t2
     join public.publicacoes pb on pb.tarefa_id = t2.id
     where pb.processo_id = new.processo_id and pb.data_disponibilizacao = new.data_disponibilizacao and pb.id <> new.id
       and t2.status in ('aberta','em_andamento')
     order by t2.created_at limit 1;
    if t is not null then
      select count(*) + 1 into n from public.publicacoes where tarefa_id = t;
      update public.tarefas set
        titulo = 'Analisar '||n||' publicações · '||coalesce(new.numero_processo,''),
        descricao = coalesce(descricao,'')||E'\n\n— '||rotulo||' —\n'||left(coalesce(new.texto,''), 600),
        updated_at = now()
      where id = t;
    else
      insert into public.tarefas (titulo, descricao, cliente_id, processo_id, responsavel_id, nucleo, prazo, prazo_fatal, status, prioridade)
      values ('Analisar publicação: '||rotulo||' · '||coalesce(new.numero_processo,''),
              'Publicada no DJEN em '||to_char(new.data_disponibilizacao,'DD/MM/YYYY')||'. Verifique o prazo e registre a providência.'||E'\n\n— '||rotulo||' —\n'||left(coalesce(new.texto,''), 600),
              new.cliente_id, new.processo_id, p.responsavel_id, 'juridico', new.data_disponibilizacao + 1, false, 'aberta', 1)
      returning id into t;
    end if;
    new.tarefa_id := t;
  end if;
  return new;
end $$;

-- limpeza: grupos de tarefas abertas "Analisar publicação" do mesmo processo e mesmo prazo → mantém a mais antiga, apaga as outras
do $$
declare g record; manter uuid; apagar uuid[]; n integer; num text;
begin
  for g in
    select processo_id, prazo, array_agg(id order by created_at) as ids
    from public.tarefas
    where titulo like 'Analisar publica%' and status in ('aberta','em_andamento') and processo_id is not null
    group by processo_id, prazo having count(*) > 1
  loop
    manter := g.ids[1]; apagar := g.ids[2:];
    update public.publicacoes set tarefa_id = manter where tarefa_id = any(apagar);
    update public.tarefas set descricao = coalesce(descricao,'') || (
        select string_agg(E'\n\n— '||coalesce(pb.tipo_documento, pb.tipo_comunicacao, 'Publicação')||' —\n'||left(coalesce(pb.texto,''), 600), '' order by pb.id)
        from public.publicacoes pb where pb.tarefa_id = manter and pb.id not in (select pb2.id from public.publicacoes pb2 where pb2.tarefa_id = manter order by pb2.id limit 1))
      where id = manter;
    select count(*) into n from public.publicacoes where tarefa_id = manter;
    select numero_processo into num from public.publicacoes where tarefa_id = manter limit 1;
    update public.tarefas set titulo = 'Analisar '||n||' publicações · '||coalesce(num,'') where id = manter and n > 1;
    delete from public.tarefa_eventos where tarefa_id = any(apagar);
    delete from public.tarefas where id = any(apagar);
  end loop;
end $$;

select 'ok 0062' as resultado;


-- ===== 0063_onboarding_entrada_antes_r1.sql =====
-- 0063 — Onboarding: a R1 só pode ser agendada depois de confirmado o pagamento da entrada.
-- Confirmação automática (cobrança Asaas do tipo 'entrada' paga) ou manual (botão no card Onboarding).
-- Idempotente. Depende de 0052, 0055.

alter table public.clientes add column if not exists entrada_confirmada_em timestamptz;

create or replace function public.onboarding_entrada_ok(p_cliente text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clientes c where c.id = p_cliente and c.entrada_confirmada_em is not null)
      or exists (select 1 from public.cobrancas k where k.cliente_id = p_cliente and k.tipo = 'entrada' and k.status = 'paga')
$$;

insert into public.mensagens_modelos (chave, titulo, texto, variaveis) values
('onb_formulario_recebido_aguardando', 'Onboarding — formulário recebido (aguardando entrada)',
 E'Recebemos o seu formulário, {nome} — obrigado! ✅\n\nAssim que confirmarmos o pagamento da entrada, você recebe por aqui o link para escolher o horário da sua reunião de onboarding.',
 '{nome}'),
('onb_agenda_liberada', 'Onboarding — entrada confirmada + agenda',
 E'Pagamento confirmado, {nome}! 🤝\n\nAgora escolha o melhor horário para a sua reunião de onboarding:\n{link}',
 '{nome} {link}')
on conflict (chave) do nothing;

-- libera o agendamento: marca a entrada como confirmada (se ainda não) e manda o link da agenda, uma vez só
create or replace function public.onboarding_liberar_agenda(p_cliente text, p_origem text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; ja boolean;
begin
  select * into c from public.clientes where id = p_cliente;
  if c.id is null then raise exception 'Cliente não encontrado'; end if;
  if c.entrada_confirmada_em is null then
    update public.clientes set entrada_confirmada_em = now() where id = p_cliente;
    insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
    values (p_cliente, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'Entrada confirmada (' || p_origem || ') — agendamento da R1 liberado', false, p_origem <> 'manual', 'onboarding');
    update public.tarefas set status = 'concluida', concluida_em = now() where cliente_id = p_cliente and titulo like 'Onboarding: conferir pagamento da entrada%' and status in ('aberta','em_andamento');
  end if;
  select exists (select 1 from public.mensagens_fila m where m.cliente_id = p_cliente and m.referencia = 'onboarding:agenda_liberada' and m.status <> 'cancelada') into ja;
  -- só manda o link se o cliente já respondeu o formulário e ainda não tem reunião marcada
  if not ja and c.formulario_em is not null and not exists (select 1 from public.agenda_eventos e where e.cliente_id = p_cliente and e.finalidade = 'onboarding' and not e.cancelado and e.inicio > now()) then
    perform public.mensagem_enfileirar(p_cliente, 'onb_agenda_liberada', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar'), now(), 'onboarding:agenda_liberada');
    return jsonb_build_object('ok', true, 'enviado', true);
  end if;
  return jsonb_build_object('ok', true, 'enviado', false);
end $$;
revoke all on function public.onboarding_liberar_agenda(text, text) from public, anon;
grant execute on function public.onboarding_liberar_agenda(text, text) to authenticated;

-- formulário respondido: com entrada ok manda a agenda; sem entrada, avisa que aguarda e abre tarefa de conferência
create or replace function public.onboarding_responder(t text, r jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; resp uuid; tid uuid; k text; dsc text; ok boolean;
  simnao text[] := array['sim','true','1'];
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then raise exception 'Link inválido.' using errcode = '28000'; end if;
  if r is null or jsonb_typeof(r) <> 'object' then raise exception 'Respostas inválidas.'; end if;
  if length(r::text) > 60000 then raise exception 'Respostas muito longas.'; end if;
  insert into public.onboarding_respostas (cliente_id, respostas) values (c.id, r);

  update public.clientes set
    negativado = case when lower(coalesce(r->>'negativado','')) = any(simnao) then true when lower(coalesce(r->>'negativado','')) in ('nao','não','false','0') then false else negativado end,
    usa_maquininha = case when lower(coalesce(r->>'maquininha','')) = any(simnao) then true when lower(coalesce(r->>'maquininha','')) in ('nao','não','false','0') then false else usa_maquininha end,
    tem_consorcio = case when lower(coalesce(r->>'consorcio','')) = any(simnao) then true when lower(coalesce(r->>'consorcio','')) in ('nao','não','false','0') then false else tem_consorcio end,
    possui_processos = case when lower(coalesce(r->>'acao_judicial','')) = any(simnao) then true when lower(coalesce(r->>'acao_judicial','')) in ('nao','não','false','0') then false else possui_processos end,
    outros_cnpjs = coalesce(nullif(r->>'outros_cnpjs_quais',''), outros_cnpjs),
    assuntos_interesse = coalesce(nullif(r->>'assuntos',''), assuntos_interesse),
    disponibilidade = coalesce(nullif(r->>'disponibilidade',''), disponibilidade),
    tipos_dividas = coalesce(nullif(r->>'contratos',''), tipos_dividas),
    situacao_atual = coalesce(nullif(r->>'situacao',''), situacao_atual),
    observacoes_onboarding = concat_ws(E'\n', nullif(r->>'extra',''), case when nullif(r->>'garantia','') is not null then 'Garantias: ' || (r->>'garantia') end, case when nullif(r->>'ativos_onus','') is not null then 'Ativos com ônus: ' || (r->>'ativos_onus') end),
    formulario_em = now(),
    etapa_fluxo = greatest(coalesce(etapa_fluxo, 0), 3)
  where id = c.id;

  for k, dsc in select * from (values ('veiculo', r->>'veiculos'), ('imovel', r->>'imoveis'), ('maquinario', r->>'maquinario'), ('outro', r->>'quais_ativos')) v(tipo, descricao) loop
    if nullif(trim(dsc), '') is not null and lower(trim(dsc)) not in ('não','nao','nenhum','nenhuma','-') then
      insert into public.bens (cliente_id, tipo, descricao, observacoes) values (c.id, k, left(dsc, 2000), 'Declarado no formulário de onboarding');
    end if;
  end loop;

  resp := coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  ok := public.onboarding_entrada_ok(c.id);
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Onboarding: conferir o formulário de mapeamento — ' || coalesce(c.nome_fantasia, c.dados->>'nome', c.id),
          E'O cliente respondeu o formulário (aba Onboarding da ficha). Confira as respostas, complete a ficha/contratos e documente o que foi prometido na venda.\n' ||
          case when ok then 'O cliente já recebeu o link da agenda para marcar a R1.' else 'A entrada ainda não está confirmada: o link da agenda só vai depois da confirmação (automática pelo Asaas ou pelo botão no card Onboarding).' end,
          c.id, resp, 'acompanhamento_pj', current_date + 2, 1) returning id into tid;
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, visivel_cliente, automatica, fonte)
  values (c.id, (now() at time zone 'America/Sao_Paulo')::date, 'outro', 'Formulário de mapeamento respondido pelo cliente', false, true, 'onboarding');
  if ok then
    perform public.mensagem_enfileirar(c.id, 'onb_formulario_recebido', jsonb_build_object('link', public.painel_url() || '/cliente/onboarding.html?t=' || c.onboarding_token || '#agendar'), now(), 'onboarding:formulario_recebido');
  else
    perform public.mensagem_enfileirar(c.id, 'onb_formulario_recebido_aguardando', '{}'::jsonb, now(), 'onboarding:formulario_recebido');
    if not exists (select 1 from public.tarefas x where x.cliente_id = c.id and x.titulo like 'Onboarding: conferir pagamento da entrada%' and x.status in ('aberta','em_andamento')) then
      insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
      values ('Onboarding: conferir pagamento da entrada — ' || coalesce(c.nome_fantasia, c.dados->>'nome', c.id),
              E'O cliente respondeu o formulário, mas a entrada ainda não consta como paga. Confira no Financeiro/Asaas. Se já foi paga por fora, use "Confirmar entrada e liberar R1" no card Onboarding da ficha — o cliente recebe o link da agenda na hora.',
              c.id, resp, 'acompanhamento_pj', current_date + 2, 1);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- contexto para a página pública: informa se o agendamento está liberado
create or replace function public.onboarding_contexto(t text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.clientes; ev record; resp text;
begin
  c := public.onboarding_cliente_por_token(t);
  if c.id is null then return null; end if;
  select e.* into ev from public.agenda_eventos e where e.cliente_id = c.id and e.tipo = 'reuniao' and e.finalidade = 'onboarding' and not e.cancelado and e.inicio > now() - interval '2 hours' order by e.inicio limit 1;
  select co.nome into resp from public.colaboradores co where co.id = coalesce(c.responsavel_onboarding_id, public.responsavel_padrao('acompanhamento_pj'));
  return jsonb_build_object(
    'empresa', coalesce(c.nome_fantasia, c.dados->>'nome'),
    'nome', public.cliente_primeiro_nome(c.id),
    'respondido_em', (select max(enviado_em) from public.onboarding_respostas r where r.cliente_id = c.id),
    'responsavel', resp,
    'entrada_ok', public.onboarding_entrada_ok(c.id),
    'reuniao', case when ev.id is null then null else jsonb_build_object('id', ev.id, 'inicio', ev.inicio, 'link', case when ev.link like '#%' then null else ev.link end) end);
end $$;

-- trava no agendamento (o cliente não consegue marcar sem entrada confirmada, mesmo com o link)
do $$
declare src text;
begin
  select pg_get_functiondef('public.onboarding_agendar(text, timestamptz)'::regprocedure) into src;
  if position('onboarding_entrada_ok' in src) = 0 then
    src := replace(src, E'if c.id is null then raise exception ''Link inválido.'' using errcode = ''28000''; end if;',
      E'if c.id is null then raise exception ''Link inválido.'' using errcode = ''28000''; end if;\n  if not public.onboarding_entrada_ok(c.id) then raise exception ''O agendamento é liberado após a confirmação do pagamento da entrada.'' using errcode = ''P0001''; end if;');
    execute src;
  end if;
end $$;

-- Asaas: entrada paga → confirma e libera (manda o link se o formulário já foi respondido)
create or replace function public.cobranca_entrada_paga() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null and new.tipo = 'entrada' and new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then
    perform public.onboarding_liberar_agenda(new.cliente_id, 'Asaas');
  end if;
  return new;
end $$;
drop trigger if exists cobranca_entrada_paga on public.cobrancas;
create trigger cobranca_entrada_paga after insert or update of status on public.cobrancas for each row execute procedure public.cobranca_entrada_paga();

-- view do card
drop view if exists public.v_onboarding_cliente;
create view public.v_onboarding_cliente with (security_invoker = true) as
select c.id as cliente_id, c.onboarding_token, c.onboarding_enviado_em, c.formulario_em, c.proxima_reuniao,
       (select r.respostas from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as respostas,
       (select r.conferido_em from public.onboarding_respostas r where r.cliente_id = c.id order by r.enviado_em desc limit 1) as conferido_em,
       (select jsonb_build_object('id', e.id, 'inicio', e.inicio, 'link', e.link, 'colaborador', co.nome) from public.agenda_eventos e left join public.colaboradores co on co.id = e.colaborador_id
          where e.cliente_id = c.id and e.finalidade = 'onboarding' and not e.cancelado order by e.inicio desc limit 1) as reuniao,
       (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'modelo', m.modelo, 'titulo', mm.titulo, 'enviar_em', m.enviar_em, 'status', m.status, 'resultado', m.resultado, 'enviada_em', m.enviada_em, 'numero', m.numero) order by m.enviar_em desc), '[]'::jsonb)
          from public.mensagens_fila m left join public.mensagens_modelos mm on mm.chave = m.modelo where m.cliente_id = c.id) as mensagens,
       c.entrada_confirmada_em, public.onboarding_entrada_ok(c.id) as entrada_ok,
       (select k.pago_em from public.cobrancas k where k.cliente_id = c.id and k.tipo = 'entrada' and k.status = 'paga' order by k.pago_em desc limit 1) as entrada_paga_em
from public.clientes c;

select 'ok 0063' as resultado;


-- ===== 0064_estoque_inventario.sql =====
-- 0064 — Estoque de consumo e Inventário patrimonial (requisitos da Marina, 15/10/2026).
-- Área Financeiro (pode_financeiro). Tarefas automáticas usam o sistema de tarefas existente. Idempotente.

-- =========================================================
-- ESTOQUE (consumo)
-- =========================================================
create table if not exists public.estoque_produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null check (categoria in ('alimenticios','escritorio')),
  unidade text not null default 'un',
  saldo_inicial numeric(12,2) not null default 0,
  saldo_atual numeric(12,2) not null default 0,
  estoque_minimo numeric(12,2) not null default 0,
  qtd_desejada numeric(12,2) not null default 0,
  observacoes text,
  ativo boolean not null default true,
  tarefa_reposicao_id uuid references public.tarefas(id) on delete set null,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists estoque_produtos_nome_uidx on public.estoque_produtos (lower(nome)) where ativo;

create table if not exists public.estoque_movimentos (
  id bigserial primary key,
  produto_id uuid not null references public.estoque_produtos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada','retirada','ajuste','inicial')),
  quantidade numeric(12,2) not null,
  saldo_apos numeric(12,2) not null,
  observacao text,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  autor uuid default auth.uid(),
  autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists estoque_mov_prod_idx on public.estoque_movimentos (produto_id, criado_em desc);

alter table public.estoque_produtos enable row level security;
alter table public.estoque_movimentos enable row level security;
drop policy if exists "estoque: financeiro" on public.estoque_produtos;
create policy "estoque: financeiro" on public.estoque_produtos for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
drop policy if exists "estoque mov: ver" on public.estoque_movimentos;
create policy "estoque mov: ver" on public.estoque_movimentos for select to authenticated using (public.pode_financeiro());

-- saldo_atual só muda pela função de movimentação
create or replace function public.estoque_protege_saldo() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.saldo_atual is distinct from old.saldo_atual and coalesce(current_setting('app.estoque_mov', true), '') <> '1' then
    raise exception 'O saldo é alterado só por entrada/retirada (registre uma movimentação).';
  end if;
  if tg_op = 'INSERT' then new.saldo_atual := coalesce(new.saldo_inicial, 0); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists estoque_protege_saldo on public.estoque_produtos;
create trigger estoque_protege_saldo before insert or update on public.estoque_produtos for each row execute procedure public.estoque_protege_saldo();

-- movimento inicial ao cadastrar com saldo
create or replace function public.estoque_mov_inicial() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.saldo_inicial,0) <> 0 then
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, observacao, autor, autor_nome)
    values (new.id, 'inicial', new.saldo_inicial, new.saldo_inicial, 'Saldo inicial do cadastro', auth.uid(), (select nome from public.perfis where id = auth.uid()));
  end if;
  perform public.estoque_verificar_reposicao(new.id);
  return new;
end $$;
drop trigger if exists estoque_mov_inicial on public.estoque_produtos;
create trigger estoque_mov_inicial after insert on public.estoque_produtos for each row execute procedure public.estoque_mov_inicial();

-- abre/conclui a tarefa de reposição conforme o saldo
create or replace function public.estoque_verificar_reposicao(p_produto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.estoque_produtos; t uuid; resp uuid; sugerida numeric; cat text;
begin
  select * into p from public.estoque_produtos where id = p_produto for update;
  if p.id is null or not p.ativo then return; end if;
  -- tarefa aberta ainda existe?
  if p.tarefa_reposicao_id is not null and not exists (select 1 from public.tarefas where id = p.tarefa_reposicao_id and status in ('aberta','em_andamento')) then
    update public.estoque_produtos set tarefa_reposicao_id = null where id = p.id; p.tarefa_reposicao_id := null;
  end if;
  cat := case p.categoria when 'alimenticios' then 'Alimentícios' else 'Escritório' end;
  if p.saldo_atual <= p.estoque_minimo then
    if p.tarefa_reposicao_id is null then
      sugerida := greatest(coalesce(p.qtd_desejada,0) - p.saldo_atual, 0);
      resp := coalesce(public.responsavel_padrao('administrativo'), (select id from public.colaboradores where ativo and nucleo = 'administrativo' order by nome limit 1));
      insert into public.tarefas (titulo, descricao, responsavel_id, nucleo, prazo, prioridade, status)
      values ('Reposição de estoque: ' || p.nome,
              'Produto: ' || p.nome || E'\nCategoria: ' || cat || E'\nSaldo atual: ' || p.saldo_atual || ' ' || p.unidade || E'\nEstoque mínimo: ' || p.estoque_minimo || E'\nQuantidade sugerida para compra: ' || sugerida || ' ' || p.unidade ||
              E'\nAberta em: ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || E'\n\nAo receber os produtos, registre a entrada em Financeiro → Estoque; a tarefa é concluída sozinha quando o saldo passar do mínimo.',
              resp, 'administrativo', current_date + 3, case when p.saldo_atual <= 0 then 1 else 2 end, 'aberta')
      returning id into t;
      update public.estoque_produtos set tarefa_reposicao_id = t where id = p.id;
    end if;
  elsif p.tarefa_reposicao_id is not null then
    update public.tarefas set status = 'concluida', concluida_em = now() where id = p.tarefa_reposicao_id and status in ('aberta','em_andamento');
    insert into public.tarefa_eventos (tarefa_id, tipo, nota, autor, autor_nome) values (p.tarefa_reposicao_id, 'comentario', 'Estoque reposto: saldo ' || p.saldo_atual || ' ' || p.unidade || ' (acima do mínimo ' || p.estoque_minimo || ').', auth.uid(), 'Sistema');
    update public.estoque_produtos set tarefa_reposicao_id = null where id = p.id;
  end if;
end $$;

-- movimentação (única porta de entrada para mexer no saldo)
create or replace function public.estoque_movimentar(p_produto uuid, p_tipo text, p_quantidade numeric, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.estoque_produtos; novo numeric; mid bigint; nome_ text;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão para movimentar o estoque.'; end if;
  if p_tipo not in ('entrada','retirada','ajuste') then raise exception 'Tipo inválido.'; end if;
  if p_quantidade is null or (p_tipo <> 'ajuste' and p_quantidade <= 0) then raise exception 'Informe uma quantidade maior que zero.'; end if;
  select * into p from public.estoque_produtos where id = p_produto for update;
  if p.id is null then raise exception 'Produto não encontrado.'; end if;
  novo := case p_tipo when 'entrada' then p.saldo_atual + p_quantidade when 'retirada' then p.saldo_atual - p_quantidade else p_quantidade end;
  if novo < 0 then raise exception 'Retirada maior que o saldo disponível (% %).', p.saldo_atual, p.unidade; end if;
  perform set_config('app.estoque_mov', '1', true);
  update public.estoque_produtos set saldo_atual = novo where id = p.id;
  perform set_config('app.estoque_mov', '', true);
  select nome into nome_ from public.perfis where id = auth.uid();
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, observacao, tarefa_id, autor, autor_nome)
  values (p.id, p_tipo, case when p_tipo = 'ajuste' then novo - p.saldo_atual else p_quantidade end, novo, nullif(p_observacao,''), p.tarefa_reposicao_id, auth.uid(), nome_)
  returning id into mid;
  perform public.estoque_verificar_reposicao(p.id);
  return jsonb_build_object('ok', true, 'saldo', novo, 'movimento', mid);
end $$;
grant execute on function public.estoque_movimentar(uuid, text, numeric, text) to authenticated;

-- visão com consumo médio, previsão e compra sugerida
create or replace view public.v_estoque with (security_invoker = true) as
with ret as (
  select produto_id,
         sum(quantidade) filter (where criado_em >= now() - interval '28 days') as ret_28,
         sum(quantidade) filter (where criado_em >= now() - interval '84 days') as ret_84,
         min(criado_em) as primeira_ret
  from public.estoque_movimentos where tipo = 'retirada' group by produto_id
)
select p.*,
       case p.categoria when 'alimenticios' then 'Alimentícios' else 'Escritório' end as categoria_nome,
       round(coalesce(r.ret_28,0) / 4.0, 2) as consumo_semanal,
       round(coalesce(r.ret_84,0) / 3.0, 2) as consumo_mensal,
       (r.primeira_ret is not null and r.primeira_ret < now() - interval '14 days' and coalesce(r.ret_28,0) > 0) as previsao_confiavel,
       case when coalesce(r.ret_28,0) > 0 then round(p.saldo_atual / (r.ret_28 / 28.0)) else null end as dias_restantes,
       greatest(coalesce(p.qtd_desejada,0) - p.saldo_atual, 0) as compra_sugerida,
       (p.saldo_atual <= p.estoque_minimo) as abaixo_minimo,
       (p.saldo_atual <= 0) as zerado,
       t.status as tarefa_status, t.prazo as tarefa_prazo, t.responsavel_id as tarefa_responsavel_id,
       (select co.nome from public.colaboradores co where co.id = t.responsavel_id) as tarefa_responsavel_nome,
       (select max(m.criado_em) from public.estoque_movimentos m where m.produto_id = p.id) as ultima_movimentacao
from public.estoque_produtos p
left join ret r on r.produto_id = p.id
left join public.tarefas t on t.id = p.tarefa_reposicao_id;

create or replace view public.v_estoque_movimentos with (security_invoker = true) as
select m.*, p.nome as produto_nome, p.unidade, p.categoria from public.estoque_movimentos m join public.estoque_produtos p on p.id = m.produto_id;

-- =========================================================
-- INVENTÁRIO (patrimônio)
-- =========================================================
create table if not exists public.inventario_itens (
  id uuid primary key default gen_random_uuid(),
  patrimonio text not null unique,
  tipo text not null,                               -- notebook, desktop, monitor, mouse, teclado, headset, celular, impressora, cadeira, outro
  marca text, modelo text, numero_serie text,
  situacao text not null default 'disponivel' check (situacao in ('em_uso','disponivel','manutencao','baixado')),
  responsavel_id uuid references public.colaboradores(id) on delete set null,
  departamento text,
  especificacoes jsonb not null default '{}'::jsonb, -- por tipo: processador, ram, armazenamento, conexao, tamanho, resolucao…
  observacoes text,
  adquirido_em date, valor numeric(12,2),
  ativo boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid
);
create table if not exists public.inventario_movimentos (
  id bigserial primary key,
  item_id uuid not null references public.inventario_itens(id) on delete cascade,
  tipo text not null check (tipo in ('cadastro','atribuicao','devolucao','transferencia','situacao','alteracao','revisao')),
  de_responsavel_id uuid, para_responsavel_id uuid,
  de_departamento text, para_departamento text,
  de_situacao text, para_situacao text,
  nota text,
  autor uuid default auth.uid(), autor_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists inventario_mov_item_idx on public.inventario_movimentos (item_id, criado_em desc);
create table if not exists public.inventario_revisoes (
  id bigserial primary key,
  ciclo text not null,                              -- ex.: 2026-10
  tarefa_id uuid references public.tarefas(id) on delete set null,
  item_id uuid not null references public.inventario_itens(id) on delete cascade,
  resultado text not null check (resultado in ('localizado','nao_localizado','divergente')),
  pendencia text,
  revisado_por uuid default auth.uid(), revisado_por_nome text,
  revisado_em timestamptz not null default now(),
  unique (ciclo, item_id)
);
alter table public.inventario_itens enable row level security;
alter table public.inventario_movimentos enable row level security;
alter table public.inventario_revisoes enable row level security;
drop policy if exists "inv: financeiro" on public.inventario_itens;
create policy "inv: financeiro" on public.inventario_itens for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());
drop policy if exists "inv: proprio" on public.inventario_itens;
create policy "inv: proprio" on public.inventario_itens for select to authenticated using (responsavel_id = public.meu_colaborador());
drop policy if exists "inv mov: ver" on public.inventario_movimentos;
create policy "inv mov: ver" on public.inventario_movimentos for select to authenticated using (public.pode_financeiro());
drop policy if exists "inv mov: nota" on public.inventario_movimentos;
create policy "inv mov: nota" on public.inventario_movimentos for insert to authenticated with check (public.pode_financeiro() and tipo = 'alteracao');
drop policy if exists "inv rev: financeiro" on public.inventario_revisoes;
create policy "inv rev: financeiro" on public.inventario_revisoes for all to authenticated using (public.pode_financeiro()) with check (public.pode_financeiro());

-- histórico automático a cada mudança
create or replace function public.inventario_trilha() returns trigger language plpgsql security definer set search_path = public as $$
declare quem text; t text;
begin
  select nome into quem from public.perfis where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.inventario_movimentos (item_id, tipo, para_responsavel_id, para_departamento, para_situacao, nota, autor, autor_nome)
    values (new.id, 'cadastro', new.responsavel_id, new.departamento, new.situacao, 'Cadastrado', auth.uid(), quem);
    return new;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  if new.responsavel_id is distinct from old.responsavel_id then
    t := case when old.responsavel_id is null then 'atribuicao' when new.responsavel_id is null then 'devolucao' else 'transferencia' end;
    insert into public.inventario_movimentos (item_id, tipo, de_responsavel_id, para_responsavel_id, de_departamento, para_departamento, autor, autor_nome)
    values (new.id, t, old.responsavel_id, new.responsavel_id, old.departamento, new.departamento, auth.uid(), quem);
  elsif new.departamento is distinct from old.departamento then
    insert into public.inventario_movimentos (item_id, tipo, de_departamento, para_departamento, autor, autor_nome) values (new.id, 'transferencia', old.departamento, new.departamento, auth.uid(), quem);
  end if;
  if new.situacao is distinct from old.situacao then
    insert into public.inventario_movimentos (item_id, tipo, de_situacao, para_situacao, autor, autor_nome) values (new.id, 'situacao', old.situacao, new.situacao, auth.uid(), quem);
  end if;
  if (new.tipo, new.marca, new.modelo, new.numero_serie, new.especificacoes, new.observacoes) is distinct from (old.tipo, old.marca, old.modelo, old.numero_serie, old.especificacoes, old.observacoes) then
    insert into public.inventario_movimentos (item_id, tipo, nota, autor, autor_nome) values (new.id, 'alteracao', 'Cadastro alterado', auth.uid(), quem);
  end if;
  return new;
end $$;
drop trigger if exists inventario_trilha_ins on public.inventario_itens;
create trigger inventario_trilha_ins after insert on public.inventario_itens for each row execute procedure public.inventario_trilha();
drop trigger if exists inventario_trilha_upd on public.inventario_itens;
create trigger inventario_trilha_upd before update on public.inventario_itens for each row execute procedure public.inventario_trilha();

create or replace view public.v_inventario with (security_invoker = true) as
select i.*, co.nome as responsavel_nome,
       (select r.resultado from public.inventario_revisoes r where r.item_id = i.id order by r.revisado_em desc limit 1) as ultima_revisao_resultado,
       (select r.revisado_em from public.inventario_revisoes r where r.item_id = i.id order by r.revisado_em desc limit 1) as ultima_revisao_em
from public.inventario_itens i left join public.colaboradores co on co.id = i.responsavel_id;

create or replace view public.v_inventario_movimentos with (security_invoker = true) as
select m.*, i.patrimonio, i.tipo as item_tipo, i.marca, i.modelo,
       (select nome from public.colaboradores where id = m.de_responsavel_id) as de_nome,
       (select nome from public.colaboradores where id = m.para_responsavel_id) as para_nome
from public.inventario_movimentos m join public.inventario_itens i on i.id = m.item_id;

-- configuração da revisão periódica
insert into public.escritorio (id, dados) values ('inventario', '{"revisao_frequencia":"trimestral","responsavel_id":null}'::jsonb) on conflict (id) do nothing;

-- abre a tarefa de revisão do ciclo quando for a hora (chamada diária pelo cron); também pode ser chamada pelo botão
create or replace function public.inventario_gerar_revisao(p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; freq text; ciclo text; hoje date := (now() at time zone 'America/Sao_Paulo')::date; resp uuid; t uuid; n int;
begin
  select dados into cfg from public.escritorio where id = 'inventario';
  freq := coalesce(cfg->>'revisao_frequencia', 'trimestral');
  if freq = 'nunca' and not p_forcar then return jsonb_build_object('ok', true, 'criada', false, 'motivo', 'desligada'); end if;
  ciclo := case freq when 'mensal' then to_char(hoje, 'YYYY-MM') when 'semestral' then to_char(hoje, 'YYYY') || '-S' || ((extract(month from hoje)::int + 5) / 6) when 'anual' then to_char(hoje, 'YYYY') else to_char(hoje, 'YYYY') || '-T' || ((extract(month from hoje)::int + 2) / 3) end;
  if not p_forcar and exists (select 1 from public.tarefas where titulo like 'Revisão do inventário — ' || ciclo || '%') then return jsonb_build_object('ok', true, 'criada', false, 'ciclo', ciclo); end if;
  if p_forcar then ciclo := ciclo || '-' || to_char(now(), 'DDHH24MI'); end if;
  select count(*) into n from public.inventario_itens where ativo and situacao <> 'baixado';
  resp := coalesce((cfg->>'responsavel_id')::uuid, public.responsavel_padrao('administrativo'), (select id from public.colaboradores where ativo and nucleo = 'administrativo' order by nome limit 1));
  insert into public.tarefas (titulo, descricao, responsavel_id, nucleo, prazo, prioridade, status)
  values ('Revisão do inventário — ' || ciclo, 'Conferir fisicamente os ' || n || ' equipamentos cadastrados: localizado? responsável correto? dados corretos? situação atualizada?' || E'\nAbra Financeiro → Inventário → Revisão e marque item a item. A tarefa pode ser concluída quando todos estiverem conferidos.',
          resp, 'administrativo', hoje + 15, 2, 'aberta') returning id into t;
  return jsonb_build_object('ok', true, 'criada', true, 'ciclo', ciclo, 'tarefa', t);
end $$;
grant execute on function public.inventario_gerar_revisao(boolean) to authenticated;

-- registra o resultado da conferência de um item no ciclo da tarefa
create or replace function public.inventario_revisar(p_tarefa uuid, p_item uuid, p_resultado text, p_pendencia text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ciclo_ text; quem text; faltam int;
begin
  if not public.pode_financeiro() then raise exception 'Sem permissão.'; end if;
  select substring(titulo from 'Revisão do inventário — (.+)$') into ciclo_ from public.tarefas where id = p_tarefa;
  if ciclo_ is null then raise exception 'Tarefa de revisão não encontrada.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  insert into public.inventario_revisoes (ciclo, tarefa_id, item_id, resultado, pendencia, revisado_por, revisado_por_nome)
  values (ciclo_, p_tarefa, p_item, p_resultado, nullif(p_pendencia,''), auth.uid(), quem)
  on conflict (ciclo, item_id) do update set resultado = excluded.resultado, pendencia = excluded.pendencia, revisado_por = excluded.revisado_por, revisado_por_nome = excluded.revisado_por_nome, revisado_em = now();
  insert into public.inventario_movimentos (item_id, tipo, nota, autor, autor_nome) values (p_item, 'revisao', 'Revisão ' || ciclo_ || ': ' || p_resultado || coalesce(' — ' || nullif(p_pendencia,''), ''), auth.uid(), quem);
  select count(*) into faltam from public.inventario_itens i where i.ativo and i.situacao <> 'baixado' and not exists (select 1 from public.inventario_revisoes r where r.ciclo = ciclo_ and r.item_id = i.id);
  return jsonb_build_object('ok', true, 'faltam', faltam);
end $$;
grant execute on function public.inventario_revisar(uuid, uuid, text, text) to authenticated;

-- cron diário 06:10 BRT: abre a revisão do ciclo se ainda não existir
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'inventario-revisao-np';
    perform cron.schedule('inventario-revisao-np', '10 9 1 * *', $c$ select public.inventario_gerar_revisao(false) $c$);
  end if;
end $$;

select 'ok 0064' as resultado;


-- ===== 0065_manuais_base_conhecimento.sql =====
-- 0065 — Manuais do sistema por perfil na Base de conhecimento (tema "Manuais do sistema", um por área). Idempotente por id_externo.
-- Carga de conteúdo; reaplicar substitui o corpo (a versão anterior fica em conteudos_versoes).

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$geral$md$, $md$Manuais do sistema$md$, $md$Manual do sistema — o básico (todo mundo)$md$, $md$Entrar, Meu painel, tarefas (abrir, passar, concluir, horas), agenda, sino, chat, avisos — o que todo mundo precisa saber.$md$, $md$Endereço: https://nevespaduaadv.github.io/painel/ · Login: e-mail do escritório + senha (a primeira senha vem pelo convite; troque em **Meu perfil**). Cada pessoa só enxerga o que é da sua área.

## Entrar

Abra o endereço, use seu e-mail e senha. No celular funciona igual (pode "adicionar à tela inicial").

## Meu painel

É a sua tela inicial. Mostra:

- **Tarefas abertas / Atrasadas / Fatais em 7 dias** — só as suas.
- **Vence até 7 dias** e **Próximos 30 dias** — suas tarefas e prazos em ordem.
- **Calendário do mês** — bolinha em cada dia com quantas coisas você tem (vermelha = atraso ou prazo fatal; dourada = prazo; azul = compromisso). Clique no dia para ver a lista; **Agenda completa** abre a Agenda naquele mês.
- **Atividade recente** — o que mudou nas suas tarefas.
- Botão **Receber resumo agora** manda o resumo do dia no seu Discord.

## Tarefas e prazos

Tudo que você precisa fazer está aqui. Regras da casa:

- **Toda demanda vira tarefa.** Se alguém te pediu algo no corredor, crie a tarefa (**+ Tarefa**: título, cliente, responsável, prazo, prioridade; marque *prazo fatal* quando perder o prazo for irreversível).
- **Clique no título** da tarefa para abrir a tela dela. Lá estão os botões:
  - **▶ Em andamento** — avisa que você começou.
  - **→ Passar para…** — passa a tarefa para outra pessoa com um recado. A pessoa recebe no sino e no Discord; fica registrado no histórico quem passou, para quem e por quê.
  - **+ Lançar horas** — ao terminar um trabalho, lance as horas na própria tarefa. Quem executa, lança na hora.
  - **✓ Concluir** — pede "o que foi feito?" em uma linha. Tarefa concluída some do seu painel e entra no histórico do cliente.
- Use **Comentar** para registrar o andamento ("liguei para o cliente, aguardando documentos"). Isso vira histórico; ninguém precisa te perguntar. **Ctrl+Enter** envia.
- Digite **@** no comentário e escolha o nome para avisar alguém — a pessoa recebe no sino.
- Tarefa atrasada fica vermelha para você e para quem acompanha. Se o prazo mudou de verdade, altere o prazo em **Editar** e diga por quê no comentário.

## Agenda

Mês / Semana / Dia. Mostra seus prazos (tarefas, processos, negociações), seus compromissos (audiências, reuniões) e o que está no seu Google Calendar, se ligado. **+ Compromisso** cria audiência/reunião/perícia; vai para o Google da pessoa responsável. Feriado nacional aparece como folga; estadual/municipal/forense aparece como "trabalhamos, mas conta para prazo".

## Sino (🔔)

Avisos para você: tarefa nova, tarefa passada para você, menção, prazo, aviso da direção, compromisso em 1h. Clique para abrir o item.

## Chat (💬, ao lado do sino)

Canal **Geral** (todo o escritório — espelhado no Discord), canal da sua área, e conversas diretas (+). **@Nome** avisa a pessoa; **@todos** avisa o canal.

## Avisos

Mural da direção. Aviso novo aparece no seu painel e no sino; leia e clique **Marcar como lido**.

## Meu perfil

Foto, dados de contato, trocar senha, ver seus acessos. Quem registra ponto bate o ponto aqui.

## Busca (/)

Campo no topo: cliente, CNPJ, processo ou lead.

## Visão do cliente

A caixa no topo mostra o sistema como o cliente vê (o painel dele). Use para conferir antes de mandar algo ao cliente.

## Combinados

1. Toda demanda vira tarefa.
2. Registre no sistema, não no WhatsApp.
3. Horas na hora.
4. Terminou → Concluir.$md$, array[$md$manual$md$,$md$sistema$md$,$md$tarefas$md$]::text[], 1, 'manual', 'manual:basico', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$juridico$md$, $md$Manuais do sistema$md$, $md$Manual — Jurídico$md$, $md$Rotina diária, ficha do cliente, processos e DJEN, negociações, régua de maturação, fluxo PJ, onboarding com entrada paga.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Clientes**, **Jurídico** (Processos, Negociações, Revisional, Superendividamento, Modelos de peças, Monitoramento, Base de conhecimento, Autenticador 2FA) e o chat *Jurídico*.

## Rotina diária sugerida

1. Abra **Meu painel**: resolva primeiro *Atrasadas* e *Fatais*, depois *Vence até 7 dias*.
2. Veja o **sino** e o chat.
3. Ao longo do dia: trabalhe pela tarefa (Em andamento → comentário → horas → Concluir).
4. Antes de sair: olhe o calendário do dia seguinte.

## Clientes → ficha do cliente

Tudo do cliente em abas: dados, contratos (dívidas por banco), processos, negociações, fluxo PJ, onboarding, financeiro, timeline.

**Timeline** é o histórico do cliente: registre reuniões, contatos com o banco, protocolos. O que estiver marcado **visível para o cliente** aparece no painel dele — então escreva como se o cliente fosse ler.

Regra: **timeline** é o que aconteceu com o cliente; **tarefa** é o que alguém ainda precisa fazer.

## Processos

Lista com próximo prazo, responsável e fase. Abra o processo para andamentos e prazos.

**Publicações do DJEN** entram sozinhas: cada publicação vira um andamento e uma tarefa "Analisar publicação" (ou "Analisar N publicações", quando o mesmo processo tem várias no dia) com prazo no dia seguinte para o responsável do processo — por isso o responsável da ficha precisa estar certo. Em **Publicações**, o botão da tarefa abre direto a tela dela.

## Negociações (Acordos)

Quadro por etapa. Cada card tem banco, saldo cobrado, proposta, alçada autorizada, honorários de êxito e prazo. O sistema calcula o desembolso total e avisa em vermelho se passar da alçada. Ao registrar o acordo fechado, o sistema abre sozinho as tarefas de pós-acordo (depoimento/prova social e relatório de conclusão). Dentro de Negociações: **Base de acordos** (histórico do que fechamos).

## Régua de maturação (automática)

Aos 6 meses de atraso de um contrato, e nos 10º/11º/12º meses de contrato do cliente, o sistema abre uma tarefa prioridade 1 para quem cuida da negociação daquele cliente. Você não precisa vigiar — mas precisa executar a tarefa.

## Fluxo PJ (na ficha)

Etapas do cliente, régua Bronze/Prata/Ouro, *direcionamento* (Acordos / Jurídico / ambos) e a trava do Registrato na pasta.

## Onboarding do cliente PJ (na ficha)

O cliente recebe o formulário pelo WhatsApp na assinatura. A **R1 só é liberada depois da entrada paga**: quando o pagamento cai no Asaas, o sistema libera sozinho e manda o link da agenda. Se o pagamento foi por fora, abra a ficha → Onboarding → **Confirmar entrada e liberar R1**. Enquanto não houver entrada, o cliente vê "aguardando confirmação do pagamento" e existe uma tarefa "Onboarding: conferir pagamento da entrada" para o responsável.

## Revisional / Superendividamento / Modelos de peças

Ferramentas de análise e geração de peças em .docx com o timbrado. Gere, revise, salve na pasta do Drive do cliente.

## Monitoramento

Processos e CNPJs acompanhados; alerta de distribuição nova.

## Autenticador (2FA)

Códigos dos acessos a PJe/e-SAJ/gov.br compartilhados. Toda consulta fica registrada.

## Base de conhecimento → Jurídico

POPs, teses, modelos. Se descobriu algo que a equipe precisa saber, escreva um artigo (**+ Artigo**).

## O que não fazer

Tarefa sem cliente · trabalho sem tarefa · conversa de prazo pelo WhatsApp sem registrar no sistema · concluir tarefa sem lançar horas.$md$, array[$md$manual$md$,$md$sistema$md$,$md$juridico$md$]::text[], 2, 'manual', 'manual:juridico', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$juridico$md$, $md$Manuais do sistema$md$, $md$Manual — Estagiário do jurídico (ponto)$md$, $md$O manual Jurídico mais o registro de ponto em Meu perfil.$md$, $md$Tudo do **Manual — Jurídico**, mais o **ponto**.

## Ponto

**Meu perfil → Ponto.**

- Ao chegar: **Entrada**.
- Intervalo: **Saída para intervalo** / **Volta**.
- Ao sair: **Saída**.

O sistema escolhe a próxima batida sozinho; se errar, fale com a administração (só ela ajusta).

Jornada padrão: 6h. O espelho do mês mostra as horas e o saldo do dia. Esqueceu de bater? Registre assim que lembrar e avise no comentário — não espere o fim do mês.$md$, array[$md$manual$md$,$md$sistema$md$,$md$ponto$md$,$md$estagiario$md$]::text[], 3, 'manual', 'manual:estagiario', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$juridico$md$, $md$Manuais do sistema$md$, $md$Manual — Controladoria do jurídico$md$, $md$Visão de equipe: aba Jurídico do painel, filtro por responsável, DJEN, horas, ponto e rotina de controle.$md$, $md$Tudo do **Manual — Jurídico**, mais a **visão de equipe**.

## Onde olhar

- **Meu painel → aba Jurídico**: tarefas abertas/atrasadas/fatais de toda a equipe jurídica e atividade recente do setor. É a tela de cobrança de prazo.
- **Tarefas e prazos**: filtro por responsável; veja quem está com atraso e por quê (comentários e histórico da tarefa — inclusive se foi passada de uma pessoa para outra).
- **Publicações (DJEN)**: todas as publicações do escritório, se viraram tarefa e para quem.
- **Equipe → Horas**: horas lançadas por pessoa e por cliente, por semana. **Equipe → Ponto**: espelho dos estagiários e ajustes.
- **Gestão → Visão geral** (se liberado): carteira, prazos, produtividade por pessoa.

## Rotina sugerida de controle

- **Diária (10 min):** Meu painel → Jurídico → *Atrasadas* e *Fatais*. Cobre pelo comentário na tarefa com @Nome, não por WhatsApp.
- **Semanal:** horas por pessoa × tarefas concluídas; publicações sem tarefa; negociações paradas (sem movimento há 15 dias).
- **Mensal:** Visão geral; relatório mensal dos clientes (painel do cliente).$md$, array[$md$manual$md$,$md$sistema$md$,$md$controladoria$md$]::text[], 4, 'manual', 'manual:controladoria', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$comercial$md$, $md$Manuais do sistema$md$, $md$Manual — Comercial (SDR)$md$, $md$Leads/CRM, fases, reunião, perdido com motivo, cadências, metas do mês.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Comercial** (Leads/CRM, Metas do mês, Base de conhecimento) e o chat *Comercial*.

## Leads (CRM)

Todo lead dos anúncios entra sozinho em **Novo lead** com campanha, público e anúncio de origem (via ChatGuru). Fases: Novo lead → Em contato → Em qualificação → Reunião agendada → Proposta → Contrato → Pagamento pendente → Ganho/Perdido.

- O card do lead é o seu lugar de trabalho: telefone/WhatsApp, origem, observações, histórico, tarefas da cadência.
- Mova a fase arrastando o card.
- Marcou reunião? Preencha **Reunião** no card: vira compromisso na Agenda da closer e lembrete automático para o lead.
- Perdeu? Marque **Perdido** com o motivo — o motivo alimenta o relatório de Growth.
- **Cadências (C1–C5):** quando entrarem no ar, cada passo aparece como tarefa sua com o dia e a ação ("C1 D6 — prova social + 5 ligações"); quando o lead responde, a cadência pausa sozinha.

## Metas do mês

Seus números: leads, contatos, reuniões, conversão.

## Regra de ouro

Se não está no card, não aconteceu.$md$, array[$md$manual$md$,$md$sistema$md$,$md$comercial$md$,$md$crm$md$]::text[], 2, 'manual', 'manual:comercial', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$marketing$md$, $md$Manuais do sistema$md$, $md$Manual — Marketing$md$, $md$Pautas de conteúdo e base de conhecimento do marketing.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Marketing** (Pautas de conteúdo, Base de conhecimento) e o chat *Marketing*.

## Pautas de conteúdo

Calendário de posts: ideia → roteiro → produção → publicado. Cada pauta pode virar tarefa com prazo. Os números do Instagram e dos anúncios entram sozinhos no Growth (as sócias acompanham por lá).

## Base de conhecimento → Marketing

Identidade visual, tom de voz, banco de ideias, playbook de conteúdo.$md$, array[$md$manual$md$,$md$sistema$md$,$md$marketing$md$]::text[], 2, 'manual', 'manual:marketing', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$financeiro$md$, $md$Manuais do sistema$md$, $md$Manual — Financeiro (Cobranças, Estoque e Inventário)$md$, $md$Cobranças/Asaas, estoque de consumo com reposição automática e inventário patrimonial com revisão periódica.$md$, $md$Leia antes o **Manual do sistema — o básico** (Base de conhecimento → Geral).

Você vê: Meu painel, Tarefas, Agenda, Avisos, Meu perfil, **Clientes**, **Financeiro** (Cobranças/Asaas, Estoque, Inventário, Base de conhecimento) e o chat *Financeiro*.

## Cobranças (Asaas)

Espelho do Asaas, sincronizado todo dia de manhã (e pelo botão **Sincronizar**). KPIs: recebido no mês, a vencer, em atraso, em aberto. Filtros por status, cliente, tipo (entrada, parcela, êxito, mensalidade).

- Abrir uma cobrança: fatura, boleto, copiar Pix, observações, pausar a régua.
- **Nova cobrança**: cliente, tipo, valor, parcelas, vencimento, forma. Cria no Asaas e aqui.
- **Vincular cliente**: cobrança que veio do Asaas sem cliente no sistema.
- A régua de cobrança por WhatsApp (3 dias antes, no dia, +1, +5, +10) está **desligada** até o lançamento; quando ligar, atraso de 10 dias abre tarefa para você.
- Pagamento confirmado atualiza a ficha do cliente ("honorários em dia") sozinho. Pagamento da **entrada** de cliente novo libera sozinho a R1 do onboarding.

## Ficha do cliente → Financeiro

Cobranças daquele cliente.

## Estoque (consumo)

Produtos de consumo do escritório — **Alimentícios** e **Escritório**.

- **+ Produto**: nome, categoria, unidade, saldo inicial, estoque mínimo e quantidade desejada após a reposição. O saldo atual não se edita na mão: ele só muda por movimentação.
- Na lista, os botões **−** e **+** registram retirada e entrada (quantidade + observação). O sistema não deixa retirar mais do que tem.
- Quando o saldo chega ao mínimo, abre sozinha a tarefa **"Reposição de estoque: <produto>"** para o administrativo, com a quantidade sugerida de compra. Não duplica enquanto houver uma aberta; quando a entrada repõe acima do mínimo, a tarefa é concluída sozinha.
- **Lista de compras**: tudo que precisa ser comprado, com a quantidade sugerida e a tarefa ligada. Filtre por categoria.
- **Movimentações**: histórico completo (quem, quando, quanto, por quê).
- Consumo médio semanal/mensal e "dias restantes" aparecem quando há histórico suficiente de retiradas; antes disso o sistema avisa "previsão ainda não confiável".

## Inventário (patrimônio)

Equipamentos do escritório, cada um com patrimônio (NP-001, NP-002…), tipo, marca/modelo, número de série, situação (em uso / disponível / manutenção / baixado), responsável e departamento.

- **+ Equipamento** cadastra; o patrimônio é sugerido automaticamente.
- **Atribuir / Devolver / Transferir** registra quem está com o quê; toda mudança fica no **Histórico** do item.
- **Por pessoa**: o que cada colaborador tem em mãos.
- **Revisão**: o sistema abre uma tarefa de revisão periódica (mensal ou trimestral, configurável em **Revisão → configurar**). Na revisão, marque cada item como **Localizado**, **Divergente** ou **Não localizado** (com a pendência). Pode abrir uma revisão fora do ciclo pelo botão **Abrir uma revisão agora**.

Estoque e inventário são separados: um é consumo, o outro é patrimônio.$md$, array[$md$manual$md$,$md$sistema$md$,$md$financeiro$md$,$md$estoque$md$,$md$inventario$md$]::text[], 2, 'manual', 'manual:financeiro', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

insert into public.conteudos (area, tema, titulo, resumo, corpo_md, tags, ordem, origem, id_externo, publicado)
values ($md$administrativo$md$, $md$Manuais do sistema$md$, $md$Manual — Sócias e roteiro de treinamento$md$, $md$Visão de equipe, usuários e acessos, gestão, avisos, roteiro de treinamento de 40 min por área e pré-requisitos.$md$, $md$Acesso total. Além de todos os manuais:

- **Meu painel → Equipe**: tudo de todos; Carteira (saldo e contratos); Leads atrasados; atividade por setor.
- **Equipe → Usuários**: quem acessa o quê (áreas e "controle do jurídico"). **Colaboradores**: fichas, Discord, Google Agenda, ponto.
- **Gestão**: Visão geral, Growth (Meta Ads + Instagram + CRM), Financeiro.
- **Avisos → + Aviso** (todo o escritório ou por área; vai também para o Discord). Card **Discord**: configuração da ponte.
- **Financeiro → régua de cobrança** (ligar/desligar).
- Carteira e projeções no painel do cliente.

## Roteiro de treinamento (40 min por área)

1. (5 min) Entrar, trocar senha, foto. Mostrar sino e chat.
2. (10 min) Meu painel e Tarefas: criar uma tarefa real, abrir a tela dela, comentar com @, passar para alguém, lançar horas, concluir. Cada um faz na própria conta.
3. (10 min) A tela principal da área (Jurídico: ficha do cliente + Processos + Negociações; Comercial: Leads; Financeiro: Cobranças + Estoque; Marketing: Pautas).
4. (5 min) Agenda: mês/semana, criar um compromisso.
5. (5 min) Base de conhecimento da área: onde está o manual e os POPs.
6. (5 min) Combinados: toda demanda vira tarefa; registrar no sistema, não no WhatsApp; horas na hora; concluir ao terminar.

Estagiários: + 5 min de ponto. Controladoria: + 15 min na visão de equipe e nos relatórios.

## Pré-requisitos para o treinamento

- Logins criados para a equipe (+ Isadora).
- Responsável certo em cada processo e cliente.
- `data_fechamento` preenchido nos clientes.
- Avisos: publicar um "Bem-vindos ao sistema" com o link e o combinado.$md$, array[$md$manual$md$,$md$sistema$md$,$md$treinamento$md$]::text[], 5, 'manual', 'manual:socias', true)
on conflict (id_externo) where id_externo is not null do update
  set area=excluded.area, tema=excluded.tema, titulo=excluded.titulo, resumo=excluded.resumo, corpo_md=excluded.corpo_md, tags=excluded.tags, ordem=excluded.ordem, publicado=true;

select 'ok 0065 — '||count(*)||' manuais' as resultado from public.conteudos where id_externo like 'manual:%';


-- ===== 0066_documentos_arquivos_internos.sql =====
-- 0066 — Documentos base: arquivos guardados no próprio sistema (bucket privado "conhecimento") e abertura interna.
-- origem 'arquivo' = PDF/DOCX/etc. enviado pela tela e servido por URL assinada; continua valendo o índice do Drive (origem 'drive')
-- e links (origem 'link'). Acesso por área igual aos artigos (acesso_area_kb). Idempotente. Depende de 0017 e 0059.

alter table public.documentos_base add column if not exists caminho_storage text;        -- "<area>/<uuid>-<nome>" no bucket conhecimento
alter table public.documentos_base add column if not exists conteudo_texto text;          -- texto extraído (busca), opcional
alter table public.documentos_base alter column url set default '';
create unique index if not exists documentos_base_storage_uidx on public.documentos_base(caminho_storage) where caminho_storage is not null;

-- busca: inclui o texto extraído quando houver
create or replace function public.documento_base_indexar() returns trigger language plpgsql as $$
begin
  new.busca := setweight(to_tsvector('portuguese', coalesce(new.titulo,'')), 'A')
            || setweight(to_tsvector('portuguese', coalesce(new.caminho,'')||' '||array_to_string(new.tags,' ')), 'B')
            || setweight(to_tsvector('portuguese', coalesce(new.descricao,'')), 'C')
            || setweight(to_tsvector('portuguese', left(coalesce(new.conteudo_texto,''), 200000)), 'D');
  return new;
end $$;

-- bucket privado
insert into storage.buckets (id, name, public, file_size_limit)
values ('conhecimento','conhecimento', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists conhecimento_storage_sel on storage.objects;
create policy conhecimento_storage_sel on storage.objects for select to authenticated
  using (bucket_id = 'conhecimento' and public.sou_equipe() and public.acesso_area_kb(split_part(name,'/',1)));
drop policy if exists conhecimento_storage_ins on storage.objects;
create policy conhecimento_storage_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'conhecimento' and public.sou_equipe() and public.acesso_area_kb(split_part(name,'/',1)));
drop policy if exists conhecimento_storage_upd on storage.objects;
create policy conhecimento_storage_upd on storage.objects for update to authenticated
  using (bucket_id = 'conhecimento' and public.sou_equipe() and public.acesso_area_kb(split_part(name,'/',1)));
drop policy if exists conhecimento_storage_del on storage.objects;
create policy conhecimento_storage_del on storage.objects for delete to authenticated
  using (bucket_id = 'conhecimento' and public.sou_admin());

-- apagar o registro apaga o arquivo do bucket (admin)
create or replace function public.documentos_base_apagar_arquivo() returns trigger language plpgsql security definer set search_path = public, storage as $$
begin
  if old.caminho_storage is not null then
    delete from storage.objects where bucket_id = 'conhecimento' and name = old.caminho_storage;
  end if;
  return old;
end $$;
drop trigger if exists documentos_base_apagar_arquivo on public.documentos_base;
create trigger documentos_base_apagar_arquivo after delete on public.documentos_base for each row execute procedure public.documentos_base_apagar_arquivo();

select 'ok 0066' as resultado;


-- ===== 0067_documentos_curadoria.sql =====
-- 0067 — Curadoria da Documentos base (índice do Drive): tira do índice o que é ruído. Nada é apagado no Drive nem no banco
-- (ativo=false; a próxima importação do índice pode reativar se o critério mudar). Decidido com a Maria Júlia em 15/10/2026.
-- Critérios: pasta duplicada "Busca e Apreensão 2"; cópias "(1)/(2)" que têm o original na mesma pasta; arquivos .rar;
-- planilha de controle INICIAIS 2026; declarações/procuração/renúncia/recibo/substabelecimento/proposta de horários repetidos
-- em várias pastas (fica só a cópia de TECNICAS DE ATENDIMENTO).

-- Pasta DIREITO BANCÁRIO = material de curso de terceiro (não é procedimento do escritório): marcar na descrição
-- de quem ainda não tem descrição própria, para a equipe não confundir com POP.
update public.documentos_base
   set descricao = 'Material de curso de direito bancário (referência de terceiro) — não é procedimento do escritório. Adaptar ao caso e conferir jurisprudência.'
 where ativo and origem = 'drive' and (caminho = 'DIREITO BANCÁRIO' or caminho like 'DIREITO BANCÁRIO / %')
   and tipo <> 'folder' and coalesce(descricao,'') = '';

with base as (
  select id, caminho, titulo, tipo,
         lower(caminho||'|'||regexp_replace(titulo, '\s*\(\d\)(\.\w+)$', '\1')) as chave,
         titulo ~ '\(\d\)\.\w+$' as eh_copia
  from public.documentos_base where ativo
), originais as (select chave from base where not eh_copia),
ruido as (
  select b.id, case
    when b.tipo = 'folder' and b.titulo = 'Busca e Apreensão 2' then 'pasta duplicada'
    when b.caminho like '%Busca e Apreensão 2%' then 'pasta duplicada'
    when b.eh_copia and exists (select 1 from originais o where o.chave = b.chave) then 'cópia (n)'
    when b.tipo = 'rar' then 'rar'
    when b.titulo like 'INICIAIS 2026%' then 'planilha de controle'
    when b.titulo like 'Scripts_Boas_Vindas_RCPCC%' then 'script defasado'
    when b.titulo ~* '^(Declara[cç][aã]o de (resid[eê]ncia|Hipossufici[eê]ncia)|PROCURA[CÇ][AÃ]O|Peti[cç][aã]o de ren[uú]ncia|RECIBO HONOR[AÁ]RIOS|SUBSTABELECIMENTO|PROPOSTA DE HOR[AÁ]RIOS)'
         and b.caminho <> 'DIREITO BANCÁRIO / TECNICAS DE ATENDIMENTO' then 'repetido'
  end as motivo
  from base b
), upd as (
  update public.documentos_base d set ativo = false
  from ruido r where r.id = d.id and r.motivo is not null
  returning r.motivo
)
select 'ok 0067 — '||count(*)||' itens fora do índice ('||string_agg(motivo||': '||n, ', ')||')' as resultado
from (select motivo, count(*) n from upd group by motivo) x;


-- ===== 0068_fechamento_lead_cliente.sql =====
-- 0068 — Formulário de fechamento: lead Ganho → cliente na carteira + contatos + contratos (dívidas por banco) + tarefas.
-- Guarda o formulário completo em public.fechamentos (base para o contrato de honorários .docx, a cobrança da entrada e a comissão).
-- Idempotente. Depende de 0008 (ficha), 0010 (fluxo PJ: gatilho fluxo_novo_cliente abre onboarding), 0027 (leads), 0051 (helpers), 0061 (discord_fila).

alter table public.leads add column if not exists cliente_id text references public.clientes(id) on delete set null;
create index if not exists leads_cliente_idx on public.leads(cliente_id) where cliente_id is not null;
alter table public.clientes add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.clientes add column if not exists pasta_drive_id text;
alter table public.clientes add column if not exists pasta_drive_url text;
alter table public.clientes add column if not exists email text;
alter table public.clientes add column if not exists telefone text;
alter table public.clientes add column if not exists cep text;

create table if not exists public.fechamentos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  cliente_id text not null references public.clientes(id) on delete cascade,
  dados jsonb not null,                       -- formulário completo (empresa, representante, dívidas, honorários, condições)
  closer_id uuid references public.colaboradores(id) on delete set null,
  contrato_gerado_em timestamptz,             -- .docx de honorários gerado
  contrato_url text,                          -- link do contrato (Drive / assinatura)
  created_at timestamptz not null default now(), created_by uuid
);
create index if not exists fechamentos_cliente_idx on public.fechamentos(cliente_id);
alter table public.fechamentos enable row level security;
drop policy if exists fech_sel on public.fechamentos;
create policy fech_sel on public.fechamentos for select to authenticated using (public.sou_equipe() and (public.tem_acesso('comercial') or public.tem_acesso('clientes')));
drop policy if exists fech_upd on public.fechamentos;
create policy fech_upd on public.fechamentos for update to authenticated using (public.sou_equipe()) with check (public.sou_equipe());
revoke all on public.fechamentos from anon;

-- configuração: quem recebe a tarefa do contrato e o canal do Discord (sem dado sensível)
insert into public.escritorio (id, dados) values ('fechamento', '{"responsavel_contrato_id": null, "canal_discord": null, "prazo_contrato_dias": 2}'::jsonb)
on conflict (id) do nothing;

-- id curto no padrão do front ("cli-…", "con-…")
create or replace function public.id_curto(prefixo text) returns text language sql volatile as $$
  select prefixo||'-'||substr(replace(gen_random_uuid()::text,'-',''), 1, 10)
$$;

-- p = { empresa:{nome, nome_fantasia, cnpj, tipo_pessoa, endereco, cidade, uf, cep, email, telefone, segmento, faturamento_mensal, funcionarios},
--       representante:{nome, cpf, qualificacao, email, telefone, estado_civil},
--       dividas:[{banco, titular, produto, garantia, situacao, valor_original, saldo_atual, data_contrato, data_inicio_atraso, parcelas_total, notas}],
--       honorarios:{entrada, parcelas, valor_parcela, vencimento_dia, exito_pct, mensalidade, forma, observacoes},
--       condicoes:{data_fechamento, plano, origem, observacoes, historia} }
create or replace function public.lead_fechar(p_lead uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.leads%rowtype;
  cfg jsonb := (select dados from public.escritorio where id = 'fechamento');
  rg jsonb := coalesce((select dados from public.regras where id = 'regras'), '{}'::jsonb);
  emp jsonb := coalesce(p->'empresa', '{}'::jsonb);
  rep jsonb := coalesce(p->'representante', '{}'::jsonb);
  hon jsonb := coalesce(p->'honorarios', '{}'::jsonb);
  cond jsonb := coalesce(p->'condicoes', '{}'::jsonb);
  d jsonb;
  novo_cli text; novo_con text; fech uuid;
  closer uuid := public.meu_colaborador();
  closer_nome text;
  resp_contrato uuid := nullif(cfg->>'responsavel_contrato_id','')::uuid;
  prazo_dias int := coalesce((cfg->>'prazo_contrato_dias')::int, 2);
  tem_atraso boolean := false;
  resumo_dividas text := '';
  n_dividas int := 0;
  total_saldo numeric := 0;
  nome_cli text := nullif(btrim(emp->>'nome'),'');
  dt_fech date := coalesce(nullif(cond->>'data_fechamento','')::date, current_date);
  tipos text[] := '{}';
begin
  if not public.sou_equipe() then raise exception 'sem permissão'; end if;
  if nome_cli is null then raise exception 'Informe a razão social / nome do cliente'; end if;
  select * into l from public.leads where id = p_lead;
  if l.id is null then raise exception 'Lead não encontrado'; end if;
  if l.cliente_id is not null then raise exception 'Este lead já foi fechado (cliente %)', l.cliente_id; end if;
  select nome into closer_nome from public.colaboradores where id = closer;

  -- ---------- cliente ----------
  novo_cli := public.id_curto('cli');
  for d in select * from jsonb_array_elements(coalesce(p->'dividas','[]'::jsonb)) loop
    n_dividas := n_dividas + 1;
    total_saldo := total_saldo + coalesce(nullif(d->>'saldo_atual','')::numeric, nullif(d->>'valor_original','')::numeric, 0);
    if coalesce(d->>'situacao','') not in ('emdia','quitado') then tem_atraso := true; end if;
    tipos := tipos || (coalesce(d->>'banco','?')||' — '||coalesce(d->>'produto','')||case when coalesce(d->>'titular','PJ')='PF' then ' (CPF do sócio)' else '' end);
  end loop;
  resumo_dividas := array_to_string(tipos, '; ');

  insert into public.clientes (id, dados, cnpj, cpf_titular, tipo_pessoa, nome_fantasia, cidade, uf, cep, endereco, email, telefone,
                               segmento, faturamento_mensal, funcionarios, historia, origem, closer, data_fechamento, plano, servico, status, etapa_fluxo,
                               tem_divida_atraso, tipos_dividas, representante, representante_cpf, representante_qualificacao, lead_id, ativo)
  values (novo_cli,
          jsonb_build_object('nome', nome_cli, 'cnpj', coalesce(emp->>'cnpj',''), 'responsavel', coalesce(closer_nome,''), 'reservaAcumulada', 0,
                             'notasInternas', coalesce(cond->>'observacoes',''), 'timeline', '[]'::jsonb, 'createdAt', now()),
          nullif(emp->>'cnpj',''), nullif(rep->>'cpf',''), coalesce(nullif(emp->>'tipo_pessoa',''),'PJ'), nullif(emp->>'nome_fantasia',''),
          nullif(emp->>'cidade',''), nullif(emp->>'uf',''), nullif(emp->>'cep',''), nullif(emp->>'endereco',''), nullif(emp->>'email',''), nullif(emp->>'telefone',''),
          nullif(emp->>'segmento',''), nullif(emp->>'faturamento_mensal','')::numeric, nullif(emp->>'funcionarios','')::int, nullif(cond->>'historia',''),
          coalesce(nullif(cond->>'origem',''), l.origem::text), closer_nome, dt_fech, coalesce(nullif(cond->>'plano',''),'gestao_passivos'),
          'gestao_passivos', 'onboarding', 0, tem_atraso, nullif(resumo_dividas,''),
          nullif(rep->>'nome',''), nullif(rep->>'cpf',''), nullif(rep->>'qualificacao',''), l.id, true);

  -- contato principal = representante (WhatsApp do lead se não vier outro) → o onboarding manda as boas-vindas para ele
  insert into public.contatos (cliente_id, nome, cargo, email, telefone, principal, papel, cpf)
  values (novo_cli, coalesce(nullif(rep->>'nome',''), l.nome), 'Sócio(a) / representante', coalesce(nullif(rep->>'email',''), l.email),
          coalesce(nullif(rep->>'telefone',''), l.whatsapp), true, 'socio', nullif(rep->>'cpf',''));

  -- ---------- contratos (dívidas por banco) no formato do motor da carteira ----------
  for d in select * from jsonb_array_elements(coalesce(p->'dividas','[]'::jsonb)) loop
    novo_con := public.id_curto('con');
    insert into public.contratos (id, cliente_id, dados) values (novo_con, novo_cli, jsonb_build_object(
      'clienteId', novo_cli, 'banco', btrim(coalesce(d->>'banco','')), 'titular', coalesce(nullif(d->>'titular',''),'PJ'),
      'produto', coalesce(nullif(d->>'produto',''),'giro'), 'garantia', coalesce(nullif(d->>'garantia',''),'nenhuma'),
      'situacao', coalesce(nullif(d->>'situacao',''),'cobranca'),
      'valorOriginal', coalesce(nullif(d->>'valor_original','')::numeric, 0),
      'saldoAtual', coalesce(nullif(d->>'saldo_atual','')::numeric, nullif(d->>'valor_original','')::numeric, 0),
      'dataContrato', coalesce(d->>'data_contrato',''), 'dataInicioAtraso', coalesce(d->>'data_inicio_atraso',''),
      'parcelasPagas', coalesce(nullif(d->>'parcelas_pagas','')::int, 0), 'parcelasTotal', coalesce(nullif(d->>'parcelas_total','')::int, 0),
      'prazoReservaMeses', coalesce((rg->>'prazoReservaPadrao')::int, 6), 'atualizacaoMensal', null, 'carteiraOverride', '',
      'notas', coalesce(d->>'notas',''), 'acordo', null, 'createdAt', now()));
    -- banco novo entra nas regras (fatoresBanco) como o front faz
    if coalesce(btrim(d->>'banco'),'') <> '' and not (rg->'fatoresBanco') ? btrim(d->>'banco') then
      rg := jsonb_set(coalesce(rg,'{}'::jsonb), array['fatoresBanco', btrim(d->>'banco')], '0'::jsonb, true);
      update public.regras set dados = rg, updated_at = now() where id = 'regras';
    end if;
  end loop;

  -- ---------- formulário guardado ----------
  insert into public.fechamentos (lead_id, cliente_id, dados, closer_id, created_by)
  values (l.id, novo_cli, p || jsonb_build_object('resumo', jsonb_build_object('dividas', n_dividas, 'saldo_total', total_saldo)), closer, auth.uid())
  returning id into fech;

  -- ---------- lead → Ganho ----------
  update public.leads set status = 'Ganho', fase_id = 10, cliente_id = novo_cli, data_fechamento = dt_fech,
         empresa = coalesce(nullif(empresa,''), nome_cli),
         valor = case when coalesce(valor,0) = 0 then coalesce(nullif(hon->>'entrada','')::numeric,0) + coalesce(nullif(hon->>'parcelas','')::numeric,0)*coalesce(nullif(hon->>'valor_parcela','')::numeric,0) else valor end
   where id = l.id;

  -- ---------- timeline interna ----------
  insert into public.entradas_timeline (cliente_id, data, tipo, descricao, responsavel_id, automatica, visivel_cliente)
  values (novo_cli, dt_fech, 'mudanca_estagio',
          format('Contrato fechado (closer: %s). %s dívida(s), saldo informado %s. Honorários: entrada %s%s%s.',
                 coalesce(closer_nome,'—'), n_dividas, public.brl(total_saldo),
                 public.brl(coalesce(nullif(hon->>'entrada','')::numeric,0)),
                 case when coalesce(nullif(hon->>'parcelas','')::int,0) > 0 then format(' + %sx %s', hon->>'parcelas', public.brl(nullif(hon->>'valor_parcela','')::numeric)) else '' end,
                 case when nullif(hon->>'exito_pct','') is not null then format(' · êxito %s%%', hon->>'exito_pct') else '' end),
          closer, true, false);

  -- ---------- tarefa do contrato de honorários ----------
  insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
  values ('Contrato de honorários: gerar, conferir e enviar para assinatura — '||coalesce(nullif(emp->>'nome_fantasia',''), nome_cli),
          E'Formulário de fechamento preenchido pelo comercial (ficha do cliente → aba Fechamento).\nGere o .docx pelo botão "Contrato de honorários", confira os dados e envie para assinatura. Depois registre o link em Documentos.',
          novo_cli, coalesce(resp_contrato, public.responsavel_padrao('acompanhamento_pj'), closer), 'acompanhamento_pj', current_date + prazo_dias, 1);
  if coalesce(nullif(hon->>'entrada','')::numeric,0) > 0 and (p->>'emitir_cobranca') is distinct from 'true' then
    insert into public.tarefas (titulo, descricao, cliente_id, responsavel_id, nucleo, prazo, prioridade)
    values ('Financeiro: emitir a cobrança da entrada — '||coalesce(nullif(emp->>'nome_fantasia',''), nome_cli),
            format('Entrada de %s%s. Emita no Asaas pela tela Financeiro → Nova cobrança (tipo "entrada"). O pagamento libera a R1 do onboarding automaticamente.',
                   public.brl(nullif(hon->>'entrada','')::numeric), case when nullif(hon->>'vencimento_dia','') is not null then ', vencimento dia '||(hon->>'vencimento_dia') else '' end),
            novo_cli, public.responsavel_padrao('administrativo'), 'administrativo', current_date + 1, 1);
  end if;

  -- ---------- Discord (#contratos-pj), sem dado sensível ----------
  if nullif(cfg->>'canal_discord','') is not null then
    insert into public.discord_fila (canal_discord, texto, referencia)
    values (cfg->>'canal_discord',
            format('📄 **Contrato fechado** — %s · %s dívida(s) · closer %s. Tarefa do contrato de honorários aberta no sistema.',
                   coalesce(nullif(emp->>'nome_fantasia',''), nome_cli), n_dividas, coalesce(closer_nome,'—')),
            'fechamento:'||fech::text);
  end if;

  return jsonb_build_object('cliente_id', novo_cli, 'fechamento_id', fech, 'dividas', n_dividas);
end $$;
revoke all on function public.lead_fechar(uuid, jsonb) from public, anon;
grant execute on function public.lead_fechar(uuid, jsonb) to authenticated;


-- v_leads usa l.*: recriar para expor leads.cliente_id
drop view if exists public.v_leads;
create view public.v_leads with (security_invoker = true) as
select l.*, f.nome as fase_nome, f.ordem as fase_ordem, f.cor as fase_cor, f.prazo_horas, f.dono as fase_dono, f.sigla as fase_sigla,
       coalesce(p.nome, p.email) as proprietario_nome,
       coalesce((select array_agg(t.nome order by t.nome) from public.lead_tags lt join public.tags t on t.id = lt.tag_id where lt.lead_id = l.id), '{}') as tags,
       (select count(*) from public.observacoes o where o.lead_id = l.id) as total_observacoes,
       extract(day from now() - l.fase_desde)::int as dias_na_fase,
       round(extract(epoch from now() - l.fase_desde) / 3600)::int as horas_na_fase,
       case when l.status <> 'Aberto' or f.prazo_horas is null then 'ok'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) then 'estourado'
            when now() - l.fase_desde > make_interval(hours => f.prazo_horas) * 0.8 then 'alerta'
            else 'ok' end as atraso,
       (select min(t.quando) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as proxima_tarefa,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null) as tarefas_abertas,
       (select count(*) from public.lead_tarefas t where t.lead_id = l.id and t.concluida_em is null and t.quando < now()) as tarefas_vencidas
from public.leads l join public.fases f on f.id = l.fase_id left join public.perfis p on p.id = l.proprietario_id;
revoke all on public.v_leads from anon;

-- view para a ficha do cliente / ficha do lead
create or replace view public.v_fechamentos with (security_invoker = true) as
select f.id, f.lead_id, f.cliente_id, f.dados, f.closer_id, co.nome as closer_nome, f.contrato_gerado_em, f.contrato_url, f.created_at,
       c.nome as cliente_nome, c.nome_fantasia, c.cnpj
from public.fechamentos f
left join public.colaboradores co on co.id = f.closer_id
join public.clientes c on c.id = f.cliente_id;

select 'ok 0068' as resultado;


-- ===== 0069_formulario_site_leads.sql =====
-- 0069 — Formulário do site → lead no CRM (origem 'site'), com filtro de spam e aviso ao comercial.
-- O site (Elementor) continua guardando os envios em Submissions; um script no site repassa cada envio aceito para a
-- rota /functions/v1/chatguru/site, que chama a rpc site_formulario (só service_role). Idempotente.
-- Depende de 0027 (leads, webhook_logs), 0034 (notificar), 0051 (responsavel_padrao), 0061 (discord_fila, painel_url).

-- 1) nova origem (o valor só pode ser usado em transações seguintes; a função abaixo o usa em tempo de execução)
alter type public.lead_origem add value if not exists 'site';

-- 2) configuração: quem recebe os leads do site e em que canal do Discord avisar
insert into public.escritorio (id, dados)
values ('site', '{"responsavel_id": null, "canal_discord": null, "campanha": "Site institucional"}'::jsonb)
on conflict (id) do nothing;
drop policy if exists "escritorio: site admin" on public.escritorio;
create policy "escritorio: site admin" on public.escritorio for update to authenticated
  using (id = 'site' and public.sou_admin()) with check (id = 'site' and public.sou_admin());

-- 3) status 'spam' / 'rejeitado' nos logs já existem como texto livre (coluna status text).

-- 4) a rpc
create or replace function public.site_formulario(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  log_id   bigint;
  cfg      jsonb;
  nome_in  text;
  tel_in   text;
  chave    text;
  email_in text;
  msg      text;
  area     text;
  ip       text;
  motivo   text;
  lead     uuid;
  novo     boolean := false;
  resp_col uuid;
  resp_per uuid;
  painel   text;
  canal    text;
  recentes integer;
begin
  insert into public.webhook_logs (payload) values (p || '{"_origem":"site"}'::jsonb) returning id into log_id;
  select dados into cfg from public.escritorio where id = 'site';
  begin
  nome_in  := left(btrim(coalesce(p ->> 'nome', '')), 100);
  tel_in   := left(btrim(coalesce(p ->> 'telefone', '')), 30);
  email_in := lower(left(btrim(coalesce(p ->> 'email', '')), 120));
  msg      := left(btrim(coalesce(p ->> 'mensagem', '')), 1500);
  area     := nullif(left(btrim(coalesce(p ->> 'area', '')), 80), '');
  ip       := nullif(p ->> '_ip', '');
  chave    := public.normalizar_whatsapp(tel_in);

  -- ---- filtro de spam (nada disso vira lead; fica só no log) ----
  if coalesce(p ->> 'hp', '') <> '' then motivo := 'honeypot preenchido';
  elsif (p ->> 't') ~ '^\d+$' and (p ->> 't')::bigint < 2500 then motivo := 'envio rápido demais';
  elsif length(regexp_replace(nome_in, '[^[:alpha:]]', '', 'g')) < 2 then motivo := 'nome inválido';
  elsif nome_in ~ '[Ѐ-ӿ一-鿿぀-ヿ؀-ۿ]' or msg ~ '[Ѐ-ӿ一-鿿぀-ヿ]' then motivo := 'alfabeto estrangeiro';
  elsif (length(msg) - length(replace(lower(msg), 'http', ''))) / 4 >= 2 then motivo := 'links na mensagem';
  elsif chave is null then motivo := 'telefone inválido';
  elsif email_in <> '' and email_in !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then motivo := 'e-mail inválido';
  end if;
  if motivo is null and ip is not null then
    select count(*) into recentes from public.webhook_logs
     where payload ->> '_origem' = 'site' and payload ->> '_ip' = ip and created_at > now() - interval '1 hour' and id <> log_id;
    if recentes >= 5 then motivo := 'muitos envios do mesmo IP'; end if;
  end if;
  if motivo is not null then
    update public.webhook_logs set status = 'spam', erro = motivo where id = log_id;
    return jsonb_build_object('ok', true, 'spam', true, 'motivo', motivo);
  end if;

  -- ---- responsável ----
  resp_col := nullif(cfg ->> 'responsavel_id', '')::uuid;
  if resp_col is null then resp_col := public.responsavel_padrao('comercial'); end if;
  select perfil_id into resp_per from public.colaboradores where id = resp_col;

  -- ---- lead: um por WhatsApp ----
  select id into lead from public.leads where whatsapp_normalizado = chave;
  if lead is null then
    novo := true;
    insert into public.leads (nome, email, whatsapp, tipo_divida, campanha, origem, ultima_mensagem, ultima_interacao_em, proprietario_id)
    values (nome_in, nullif(email_in, ''), tel_in, area, coalesce(cfg ->> 'campanha', 'Site institucional'), 'site',
            nullif(msg, ''), now(), resp_per)
    returning id into lead;
  else
    update public.leads set
      nome                = coalesce(nullif(nome, ''), nome_in),
      email               = coalesce(email, nullif(email_in, '')),
      tipo_divida         = coalesce(tipo_divida, area),
      ultima_mensagem     = coalesce(nullif(msg, ''), ultima_mensagem),
      ultima_interacao_em = now(),
      proprietario_id     = coalesce(proprietario_id, resp_per)
    where id = lead;
  end if;

  -- ---- avisos ----
  painel := public.painel_url();
  perform public.notificar(coalesce((select proprietario_id from public.leads where id = lead), resp_per),
    case when novo then 'Lead novo pelo site' else 'Lead voltou a escrever pelo site' end,
    nome_in || coalesce(' · ' || area, '') || coalesce(E'\n' || left(msg, 300), ''),
    '#leads/' || lead::text);
  canal := nullif(cfg ->> 'canal_discord', '');
  if canal is not null then
    insert into public.discord_fila (canal_discord, texto, referencia)
    values (canal,
      '🌐 **' || case when novo then 'Lead novo pelo site' else 'Lead voltou a escrever pelo site' end || '** — ' || nome_in
      || coalesce(E'\n' || 'Área: ' || area, '') || coalesce(E'\n' || '> ' || left(msg, 600), '')
      || E'\n' || painel || '/#leads/' || lead::text,
      'site:' || log_id::text);
  end if;

  update public.webhook_logs set status = 'ok', lead_id = lead where id = log_id;
  return jsonb_build_object('ok', true, 'lead_id', lead, 'novo', novo);
  exception when others then
    update public.webhook_logs set status = 'erro', erro = sqlerrm where id = log_id;
    return jsonb_build_object('ok', false, 'erro', sqlerrm);
  end;
end $$;
revoke all on function public.site_formulario(jsonb) from public, anon, authenticated;
grant execute on function public.site_formulario(jsonb) to service_role;

select 'ok 0069' as resultado;


select 'ok parte 7/9' as resultado;
