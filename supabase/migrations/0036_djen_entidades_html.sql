-- 0036 — Publicações do DJEN: decodificar entidades HTML (&ccedil; &atilde; &nbsp; &#8211; …) no texto limpo, e corrigir o que já foi importado.

create or replace function public.html_decode(t text) returns text
language plpgsql immutable strict as $$
declare r text := t; m text;
begin
  -- numéricas: &#233; &#xE9;
  for m in select distinct (regexp_matches(r, '&#(\d+);', 'g'))[1] loop
    r := replace(r, '&#'||m||';', chr(m::int));
  end loop;
  for m in select distinct (regexp_matches(r, '&#[xX]([0-9a-fA-F]+);', 'g'))[1] loop
    r := regexp_replace(r, '&#[xX]'||m||';', chr(('x'||lpad(m,8,'0'))::bit(32)::int), 'g');
  end loop;
  -- nomeadas mais comuns em português / tipografia
  r := replace(r, '&nbsp;', ' ');   r := replace(r, '&ndash;', '–'); r := replace(r, '&mdash;', '—');
  r := replace(r, '&ldquo;', '“');  r := replace(r, '&rdquo;', '”'); r := replace(r, '&lsquo;', '‘'); r := replace(r, '&rsquo;', '’');
  r := replace(r, '&quot;', '"');   r := replace(r, '&apos;', ''''); r := replace(r, '&hellip;', '…'); r := replace(r, '&ordf;', 'ª'); r := replace(r, '&ordm;', 'º'); r := replace(r, '&sect;', '§'); r := replace(r, '&deg;', '°');
  r := replace(r, '&aacute;', 'á'); r := replace(r, '&agrave;', 'à'); r := replace(r, '&acirc;', 'â'); r := replace(r, '&atilde;', 'ã'); r := replace(r, '&auml;', 'ä');
  r := replace(r, '&eacute;', 'é'); r := replace(r, '&egrave;', 'è'); r := replace(r, '&ecirc;', 'ê'); r := replace(r, '&euml;', 'ë');
  r := replace(r, '&iacute;', 'í'); r := replace(r, '&igrave;', 'ì'); r := replace(r, '&icirc;', 'î'); r := replace(r, '&iuml;', 'ï');
  r := replace(r, '&oacute;', 'ó'); r := replace(r, '&ograve;', 'ò'); r := replace(r, '&ocirc;', 'ô'); r := replace(r, '&otilde;', 'õ'); r := replace(r, '&ouml;', 'ö');
  r := replace(r, '&uacute;', 'ú'); r := replace(r, '&ugrave;', 'ù'); r := replace(r, '&ucirc;', 'û'); r := replace(r, '&uuml;', 'ü');
  r := replace(r, '&ccedil;', 'ç'); r := replace(r, '&ntilde;', 'ñ');
  r := replace(r, '&shy;', ''); r := replace(r, '&cedil;', '¸'); r := replace(r, '&acute;', '´'); r := replace(r, '&rarr;', '→'); r := replace(r, '&larr;', '←'); r := replace(r, '&bull;', '•'); r := replace(r, '&middot;', '·'); r := replace(r, '&laquo;', '«'); r := replace(r, '&raquo;', '»'); r := replace(r, '&copy;', '©'); r := replace(r, '&reg;', '®'); r := replace(r, '&times;', '×'); r := replace(r, '&euro;', '€');
  r := replace(r, '&Aacute;', 'Á'); r := replace(r, '&Agrave;', 'À'); r := replace(r, '&Acirc;', 'Â'); r := replace(r, '&Atilde;', 'Ã');
  r := replace(r, '&Eacute;', 'É'); r := replace(r, '&Ecirc;', 'Ê'); r := replace(r, '&Iacute;', 'Í'); r := replace(r, '&Oacute;', 'Ó'); r := replace(r, '&Ocirc;', 'Ô'); r := replace(r, '&Otilde;', 'Õ'); r := replace(r, '&Uacute;', 'Ú'); r := replace(r, '&Ccedil;', 'Ç');
  r := replace(r, '&lt;', '<'); r := replace(r, '&gt;', '>'); r := replace(r, '&amp;', '&');   -- &amp; por último
  return trim(regexp_replace(regexp_replace(r, '[ \t\r]+', ' ', 'g'), '\s*\n\s*', E'\n', 'g'));
end $$;

-- limpeza de HTML + entidades, reaproveitada na importação
create or replace function public.limpar_html(t text) returns text
language sql immutable strict as $$
  select public.html_decode(regexp_replace(regexp_replace(t, '<br\s*/?>|</p>|</div>|</li>', E'\n', 'gi'), '<[^>]+>', ' ', 'g'));
$$;

create or replace function public.djen_gravar(item jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.publicacoes (id, data_disponibilizacao, tribunal, orgao, id_orgao, tipo_comunicacao, tipo_documento, classe, codigo_classe, numero_processo, meio, link, numero_comunicacao, status_djen, texto, destinatarios, advogados, bruto)
  values ((item->>'id')::bigint, (item->>'data_disponibilizacao')::date, item->>'siglaTribunal', item->>'nomeOrgao', nullif(item->>'idOrgao','')::integer,
          item->>'tipoComunicacao', item->>'tipoDocumento', item->>'nomeClasse', item->>'codigoClasse', coalesce(item->>'numeroprocessocommascara', item->>'numero_processo'),
          item->>'meio', item->>'link', nullif(item->>'numeroComunicacao','')::integer, item->>'status',
          public.limpar_html(coalesce(item->>'texto','')),
          coalesce((select jsonb_agg(jsonb_build_object('nome', d->>'nome', 'polo', d->>'polo')) from jsonb_array_elements(case when jsonb_typeof(item->'destinatarios')='array' then item->'destinatarios' else '[]'::jsonb end) d), '[]'::jsonb),
          coalesce((select jsonb_agg(jsonb_build_object('nome', d->'advogado'->>'nome', 'numero_oab', d->'advogado'->>'numero_oab', 'uf_oab', d->'advogado'->>'uf_oab')) from jsonb_array_elements(case when jsonb_typeof(item->'destinatarioadvogados')='array' then item->'destinatarioadvogados' else '[]'::jsonb end) d), '[]'::jsonb),
          item - 'texto')
  on conflict (id) do update set status_djen = excluded.status_djen, link = coalesce(excluded.link, public.publicacoes.link), updated_at = now();
end $$;

-- corrige o que já está gravado (publicações, andamentos e tarefas gerados delas)
update public.publicacoes set texto = public.html_decode(texto) where texto like '%&%;%';
update public.andamentos set descricao = public.html_decode(descricao) where fonte = 'djen' and descricao like '%&%;%';
update public.tarefas set descricao = public.html_decode(descricao) where descricao like '%&%;%' and (publicacao_id is not null or titulo like 'Analisar publica%');

select 'ok 0036 · '||(select count(*) from public.publicacoes where texto like '%&%;%')||' ainda com entidade' as resultado;
