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
