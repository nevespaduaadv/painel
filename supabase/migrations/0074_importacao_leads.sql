-- 0074 — Importação em massa de leads por planilha (.xlsx/.csv) com etapa, status, proprietário, motivo de perda, tags etc.
-- Usada pelo assistente "Importar leads" do painel (arquivo → mapear → visualizar → importar). Migração dos leads do GCV.
-- A planilha é mapeada no navegador para os campos abaixo; cada linha chega como jsonb de textos.
-- Chave: WhatsApp normalizado (ou "ID externo"); número repetido atualiza o lead existente quando a opção "atualizar" está ligada.
-- Importação não dispara cadência (opção `iniciar_cadencia` liga para quem quiser). Idempotente. Depende de 0073.

alter table public.leads add column if not exists externo_id text;   -- id do lead no sistema de origem (GCV)
create index if not exists leads_externo_idx on public.leads (externo_id) where externo_id is not null;
do $$ begin alter type public.lead_origem add value if not exists 'gcv'; exception when others then null; end $$;

-- gatilho da cadência respeita o sinal "sem cadência" (importação / ajustes em massa)
create or replace function public.leads_cadencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare nova integer; antiga integer; cad public.cadencias;
begin
  if coalesce(current_setting('np.sem_cadencia', true), '') = '1' then return new; end if;
  nova := case when new.status = 'Aberto' then public.cadencia_da_fase(new.fase_id) end;
  if tg_op = 'INSERT' and new.origem in ('planilha', 'gcv') then nova := null; end if;   -- importação não dispara cadência
  antiga := case when tg_op = 'UPDATE' then old.cadencia_id end;
  if tg_op = 'UPDATE' and old.cadencia_encerrada_em is not null then antiga := null; end if;
  if nova is distinct from antiga then
    if antiga is not null then
      delete from public.lead_tarefas where lead_id = new.id and cadencia_id = antiga and concluida_em is null;
    end if;
    if nova is null then
      if new.cadencia_id is not null and new.cadencia_encerrada_em is null then new.cadencia_encerrada_em := now(); end if;
      new.cadencia_proximo_em := null; new.cadencia_pausada_em := null;
    else
      select * into cad from public.cadencias where id = nova;
      new.cadencia_id := nova; new.cadencia_passo := 0; new.cadencia_pausada_em := null; new.cadencia_encerrada_em := null;
      new.cadencia_proximo_em := case
        when new.fase_id = 5 then now()
        when cad.inicio = 'apos_24h' then now() + interval '24 hours'
        when cad.inicio = 'imediato' then now()
        else public.cadencia_somar_dias_uteis(now(), 1) end;
    end if;
  end if;
  return new;
end $$;

-- ---------- resolução de uma linha (texto → ids/valores) ----------
-- Devolve {ok, erros:[], avisos:[], dados:{...}} sem gravar nada.
create or replace function public.importar_lead_resolver(linha jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb := '{}'::jsonb; erros text[] := '{}'; avisos text[] := '{}';
  t text; n text; v numeric; f record; m record; p record; st text; o text; chave text; existente record;
begin
  -- whatsapp (chave)
  chave := public.normalizar_whatsapp(linha ->> 'whatsapp');
  if chave is null and coalesce(btrim(linha ->> 'externo_id'), '') = '' then erros := array_append(erros, 'WhatsApp vazio ou inválido'); end if;
  d := d || jsonb_build_object('whatsapp', nullif(btrim(linha ->> 'whatsapp'), ''), 'whatsapp_normalizado', chave, 'externo_id', nullif(btrim(linha ->> 'externo_id'), ''));
  -- lead existente?
  select id, nome into existente from public.leads
   where (chave is not null and whatsapp_normalizado = chave)
      or (nullif(btrim(linha ->> 'externo_id'), '') is not null and externo_id = btrim(linha ->> 'externo_id'))
   limit 1;
  -- sem WhatsApp/ID correspondente: tenta o e-mail (evita duplicar lead que entrou só com e-mail)
  if existente.id is null and nullif(btrim(linha ->> 'email'), '') is not null then
    select id, nome into existente from public.leads where lower(email) = lower(btrim(linha ->> 'email')) limit 1;
  end if;
  d := d || jsonb_build_object('existente_id', existente.id, 'existente_nome', existente.nome);

  -- etapa
  t := nullif(btrim(linha ->> 'fase'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    select id, nome into f from public.fases
     where id::text = t or lower(public.sem_acento(nome)) = n or lower(coalesce(sigla, '')) = n
        or lower(public.sem_acento(nome)) like n || '%'
     order by case when id::text = t or lower(public.sem_acento(nome)) = n then 0 else 1 end, ordem limit 1;
    if f.id is null then
      -- apelidos comuns
      f.id := case
        when n in ('novo','novo lead','lead novo','lead','entrada') then 1
        when n like 'em qualifica%' or n like 'qualifica%sdr%' or n in ('sdr','qualificando') then 2
        when n in ('qualificado','mql','qualificados') then 3
        when n like 'reuni%agend%' or n in ('agendado','agendada','sql') then 4
        when n like 'no%show%' or n = 'noshow' then 5
        when n like 'reuni%realiz%' or n in ('se','realizada','call realizada') then 6
        when n like 'proposta%' or n = 'opp' then 7
        when n like 'contrato%' then 8
        when n like 'pagamento%' or n like 'aguardando pag%' then 9
        when n in ('ganho','fechado','cliente','vendido') then 10 end;
      if f.id is null then erros := array_append(erros, 'Etapa não reconhecida: "' || t || '"'); end if;
    end if;
    d := d || jsonb_build_object('fase_id', f.id);
  end if;

  -- status
  t := nullif(btrim(linha ->> 'status'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    st := case when n in ('aberto','em aberto','open','ativo','em andamento') then 'Aberto'
               when n in ('ganho','won','fechado','vendido','cliente') then 'Ganho'
               when n in ('perdido','lost','perda') then 'Perdido'
               when n in ('abandonado','abandono','descartado') then 'Abandonado' end;
    if st is null then erros := array_append(erros, 'Status não reconhecido: "' || t || '" (use Aberto, Ganho, Perdido ou Abandonado)'); end if;
    d := d || jsonb_build_object('status', st);
  end if;
  -- motivo de perda (código, rótulo do catálogo ou texto livre)
  t := nullif(btrim(linha ->> 'motivo_perda'), '');
  if t is not null then
    n := lower(public.sem_acento(regexp_replace(t, '^\[(sdr|closer|cs)\]\s*', '', 'i')));
    select codigo into m from public.motivos_perda
     where codigo = t or lower(public.sem_acento(regexp_replace(rotulo, '^\[(sdr|closer|cs)\]\s*', '', 'i'))) = n limit 1;
    d := d || jsonb_build_object('motivo_perda', coalesce(m.codigo, t));
    if m.codigo is null then avisos := array_append(avisos, 'Motivo fora do catálogo, gravado como texto: "' || t || '"'); end if;
  end if;
  if coalesce(d ->> 'status', '') in ('Perdido', 'Abandonado') and coalesce(d ->> 'motivo_perda', '') = '' then
    erros := array_append(erros, 'Lead Perdido/Abandonado precisa de motivo da perda');
  end if;

  -- proprietário (e-mail ou nome de um perfil da equipe)
  t := nullif(btrim(linha ->> 'proprietario'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    select id, nome into p from public.perfis
     where papel in ('admin', 'colaborador') and (lower(email) = lower(t) or lower(public.sem_acento(coalesce(nome, ''))) = n)
     limit 1;
    if p.id is null then
      select id, nome into p from public.perfis
       where papel in ('admin', 'colaborador') and (lower(public.sem_acento(coalesce(nome, ''))) like n || '%' or lower(email) like n || '%') limit 1;
    end if;
    if p.id is null then avisos := array_append(avisos, 'Proprietário não encontrado: "' || t || '" (lead fica sem proprietário)'); end if;
    d := d || jsonb_build_object('proprietario_id', p.id);
  end if;

  -- valor da oportunidade ("R$ 12.500,00", "12500", "12.500")
  t := nullif(btrim(linha ->> 'valor'), '');
  if t is not null then
    begin
      n := regexp_replace(t, '[^0-9,.\-]', '', 'g');
      if n ~ ',\d{1,2}$' then n := replace(replace(n, '.', ''), ',', '.'); elsif n ~ '\.\d{1,2}$' and n !~ ',' then n := replace(n, ',', ''); else n := replace(replace(n, '.', ''), ',', ''); end if;
      v := nullif(n, '')::numeric;
      d := d || jsonb_build_object('valor', v);
    exception when others then avisos := array_append(avisos, 'Valor não numérico ignorado: "' || t || '"'); end;
  end if;

  -- datas (o navegador já converte para ISO quando consegue)
  foreach t in array array['data_entrada', 'reuniao_em'] loop
    n := nullif(btrim(linha ->> t), '');
    if n is not null then
      begin d := d || jsonb_build_object(t, (n::timestamptz)); exception when others then avisos := array_append(avisos, 'Data inválida em ' || t || ': "' || n || '"'); end;
    end if;
  end loop;

  -- origem
  t := nullif(btrim(linha ->> 'origem'), '');
  if t is not null then
    n := lower(public.sem_acento(t));
    o := case when n like 'gcv%' then 'gcv' when n like 'chatguru%' or n like 'whatsapp%' then 'chatguru' when n like 'site%' or n like 'formul%' then 'site'
              when n like 'manual%' or n like 'cadastr%' then 'manual' when n like 'planilha%' or n like 'meta%' or n like 'facebook%' or n like 'instagram%' then 'planilha' end;
    if o is null then avisos := array_append(avisos, 'Origem não reconhecida: "' || t || '"'); end if;
    d := d || jsonb_build_object('origem', o);
  end if;

  -- textos simples
  foreach t in array array['nome', 'email', 'empresa', 'tipo_divida', 'situacao_divida', 'valor_divida', 'outras_dividas', 'melhor_horario', 'campanha', 'publico', 'anuncio', 'link_chat', 'observacao'] loop
    d := d || jsonb_build_object(t, nullif(btrim(linha ->> t), ''));
  end loop;
  -- tags: separadas por vírgula, ponto e vírgula ou barra
  t := nullif(btrim(linha ->> 'tags'), '');
  if t is not null then
    d := d || jsonb_build_object('tags', (select coalesce(jsonb_agg(distinct btrim(x)), '[]'::jsonb) from unnest(regexp_split_to_array(t, '\s*[,;|/]\s*')) x where btrim(x) <> ''));
  end if;
  if existente.id is null and coalesce(d ->> 'nome', '') = '' then avisos := array_append(avisos, 'Sem nome (ficará "Sem nome")'); end if;

  return jsonb_build_object('ok', cardinality(erros) = 0, 'erros', to_jsonb(erros), 'avisos', to_jsonb(avisos), 'dados', d,
                            'acao', case when cardinality(erros) > 0 then 'erro' when existente.id is not null then 'atualizar' else 'criar' end);
end $$;
revoke all on function public.importar_lead_resolver(jsonb) from public, anon;

-- ---------- importação ----------
-- opcoes: {simular:bool, atualizar:bool (padrão true), iniciar_cadencia:bool (padrão false), origem_padrao:text (padrão 'planilha'), lote:text}
create or replace function public.importar_leads_v2(linhas jsonb, opcoes jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  linha jsonb; r jsonb; d jsonb; idx integer := 0; nlinha integer;
  simular boolean := coalesce((opcoes ->> 'simular')::boolean, false);
  atualizar boolean := coalesce((opcoes ->> 'atualizar')::boolean, true);
  iniciar boolean := coalesce((opcoes ->> 'iniciar_cadencia')::boolean, false);
  origem_padrao text := coalesce(nullif(opcoes ->> 'origem_padrao', ''), 'planilha');
  criados integer := 0; atualizados integer := 0; ignorados integer := 0;
  erros jsonb := '[]'::jsonb; avisos jsonb := '[]'::jsonb; detalhes jsonb := '[]'::jsonb;
  lead_id uuid; tag_nome text; cad integer; cadr public.cadencias; lr record;
begin
  if not public.sou_equipe() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  perform set_config('np.sem_cadencia', '1', true);

  for linha in select * from jsonb_array_elements(linhas) loop
    idx := idx + 1; nlinha := coalesce((linha ->> '_linha')::int, idx);
    r := public.importar_lead_resolver(linha); d := r -> 'dados';
    if jsonb_array_length(r -> 'avisos') > 0 then
      avisos := avisos || (select jsonb_agg(jsonb_build_object('linha', nlinha, 'motivo', a)) from jsonb_array_elements_text(r -> 'avisos') a);
    end if;
    if not (r ->> 'ok')::boolean then
      ignorados := ignorados + 1;
      erros := erros || jsonb_build_object('linha', nlinha, 'motivo', array_to_string(array(select jsonb_array_elements_text(r -> 'erros')), '; '));
      if simular then detalhes := detalhes || jsonb_build_object('linha', nlinha, 'acao', 'erro', 'nome', d ->> 'nome'); end if;
      continue;
    end if;
    if (d ->> 'existente_id') is not null and not atualizar then
      ignorados := ignorados + 1;
      if simular then detalhes := detalhes || jsonb_build_object('linha', nlinha, 'acao', 'ignorar', 'nome', d ->> 'nome', 'existente', d ->> 'existente_nome'); end if;
      continue;
    end if;
    if simular then
      if (d ->> 'existente_id') is not null then atualizados := atualizados + 1; else criados := criados + 1; end if;
      detalhes := detalhes || jsonb_build_object('linha', nlinha, 'acao', r ->> 'acao', 'nome', d ->> 'nome', 'existente', d ->> 'existente_nome', 'fase_id', d -> 'fase_id', 'status', d ->> 'status', 'proprietario_id', d -> 'proprietario_id');
      continue;
    end if;

    begin
      if (d ->> 'existente_id') is not null then
        lead_id := (d ->> 'existente_id')::uuid;
        update public.leads set
          nome            = coalesce(d ->> 'nome', nome),
          email           = coalesce(d ->> 'email', email),
          whatsapp        = coalesce(d ->> 'whatsapp', whatsapp),
          empresa         = coalesce(d ->> 'empresa', empresa),
          externo_id      = coalesce(d ->> 'externo_id', externo_id),
          fase_id         = coalesce((d ->> 'fase_id')::int, fase_id),
          status          = coalesce((d ->> 'status')::public.lead_status, status),
          motivo_perda    = coalesce(d ->> 'motivo_perda', motivo_perda),
          proprietario_id = coalesce((d ->> 'proprietario_id')::uuid, proprietario_id),
          valor           = coalesce((d ->> 'valor')::numeric, valor),
          data_entrada    = coalesce((d ->> 'data_entrada')::timestamptz, data_entrada),
          reuniao_em      = coalesce((d ->> 'reuniao_em')::timestamptz, reuniao_em),
          tipo_divida     = coalesce(d ->> 'tipo_divida', tipo_divida),
          situacao_divida = coalesce(d ->> 'situacao_divida', situacao_divida),
          valor_divida    = coalesce(d ->> 'valor_divida', valor_divida),
          outras_dividas  = coalesce(d ->> 'outras_dividas', outras_dividas),
          melhor_horario  = coalesce(d ->> 'melhor_horario', melhor_horario),
          campanha        = coalesce(d ->> 'campanha', campanha),
          publico         = coalesce(d ->> 'publico', publico),
          anuncio         = coalesce(d ->> 'anuncio', anuncio),
          link_chat       = coalesce(d ->> 'link_chat', link_chat)
        where id = lead_id;
        atualizados := atualizados + 1;
      else
        insert into public.leads (nome, email, whatsapp, empresa, externo_id, fase_id, status, motivo_perda, proprietario_id, valor, data_entrada, reuniao_em,
                                  tipo_divida, situacao_divida, valor_divida, outras_dividas, melhor_horario, campanha, publico, anuncio, link_chat, origem)
        values (coalesce(d ->> 'nome', 'Sem nome'), d ->> 'email', d ->> 'whatsapp', d ->> 'empresa', d ->> 'externo_id',
                coalesce((d ->> 'fase_id')::int, 1), coalesce((d ->> 'status')::public.lead_status, 'Aberto'), d ->> 'motivo_perda',
                (d ->> 'proprietario_id')::uuid, coalesce((d ->> 'valor')::numeric, 0), coalesce((d ->> 'data_entrada')::timestamptz, now()), (d ->> 'reuniao_em')::timestamptz,
                d ->> 'tipo_divida', d ->> 'situacao_divida', d ->> 'valor_divida', d ->> 'outras_dividas', d ->> 'melhor_horario',
                d ->> 'campanha', d ->> 'publico', d ->> 'anuncio', d ->> 'link_chat', coalesce(d ->> 'origem', origem_padrao)::public.lead_origem)
        returning id into lead_id;
        criados := criados + 1;
      end if;
      -- tags (acrescenta; não remove as existentes)
      if jsonb_typeof(d -> 'tags') = 'array' then
        for tag_nome in select value from jsonb_array_elements_text(d -> 'tags') loop
          insert into public.tags (nome) values (tag_nome) on conflict (nome) do nothing;
          insert into public.lead_tags (lead_id, tag_id) select lead_id, id from public.tags where nome = tag_nome on conflict do nothing;
        end loop;
      end if;
      if (d ->> 'observacao') is not null then
        insert into public.observacoes (lead_id, texto, autor_id) values (lead_id, 'Importação' || coalesce(' (' || nullif(opcoes ->> 'lote', '') || ')', '') || ': ' || (d ->> 'observacao'), auth.uid());
      end if;
      -- cadência opcional: só para leads em aberto, em etapa com cadência
      if iniciar then
        select status, fase_id into lr from public.leads where id = lead_id;
        cad := case when lr.status = 'Aberto' then public.cadencia_da_fase(lr.fase_id) end;
        if cad is not null then
          select * into cadr from public.cadencias where id = cad;
          update public.leads set cadencia_id = cad, cadencia_passo = 0, cadencia_pausada_em = null, cadencia_encerrada_em = null,
            cadencia_proximo_em = case when fase_id = 5 or cadr.inicio = 'imediato' then now() when cadr.inicio = 'apos_24h' then now() + interval '24 hours' else public.cadencia_somar_dias_uteis(now(), 1) end
           where id = lead_id;
        end if;
      end if;
    exception when others then
      ignorados := ignorados + 1;
      erros := erros || jsonb_build_object('linha', nlinha, 'motivo', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('simulado', simular, 'criados', criados, 'atualizados', atualizados, 'ignorados', ignorados, 'erros', erros, 'avisos', avisos, 'detalhes', detalhes);
end $$;
revoke all on function public.importar_leads_v2(jsonb, jsonb) from public, anon;

select 'ok 0074' as resultado;
