# Etapa 3 — Ficha do cliente, navegação por áreas e base de conhecimento

Rascunho para aprovação (08/10/2026). Decisões já tomadas pela Maria Júlia: o sistema substitui o Notion (migração gradual, sem perder o Notion enquanto isso); o ADVBox será olhado depois, começando pelos clientes PJ com lançamentos retroativos.

## 1. O que muda, em uma frase por item

1. **"Painel de Passivos" vira "Clientes"**: a entidade central é a ficha do cliente; os passivos bancários passam a ser uma aba dela.
2. **Ficha de abertura (Resumo)**: sócios, CNPJ/CPF, cidade, segmento, faturamento aproximado, "o que aconteceu", situação atual, origem comercial, data de fechamento, responsável — o que closer e onboarding já captam.
3. **Navegação por áreas**: portal com pastas (Jurídico · Comercial · Marketing · Financeiro · Administrativo); painel com 4 itens (Clientes · Prazos · Jurídico · Gestão); breadcrumb com voltar em todas as telas.
4. **Jurídico / base de conhecimento**: artigos editáveis por tema (gestão de passivos, empresa gestora, teses de revisional, Pronampe/FGO/FGI, crédito rural…), com busca, versão e autor; importação inicial do Notion.
5. **Configurações** separadas do dia a dia: regras de projeção, calibração, base de acordos (operacional da Natasha), usuários.

## 2. Modelo de dados (migration 0008)

```sql
-- clientes: campos de ficha (colunas normais; o jsonb 'dados' continua alimentando o motor)
alter table clientes add column
  cnpj text, cpf_titular text, tipo_pessoa text check in ('PJ','PF'),
  cidade text, uf text, segmento text, faturamento_mensal numeric, funcionarios int,
  historia text,              -- "o que aconteceu com a empresa"
  situacao_atual text,        -- fatura ou não, operação ativa, etc.
  origem text,                -- Meta Ads, indicação, orgânico…
  closer text, data_fechamento date, data_onboarding date,
  plano text,                 -- produto contratado (gestão de passivos PJ, superendividamento…)
  status text default 'ativo' check in ('prospect','onboarding','ativo','encerrado');

-- contatos (já existe): ganha cpf, papel (socio/avalista/contador/financeiro), participacao
-- documentos do cliente (Drive): tabela documentos(cliente_id, titulo, url_drive, tipo, data) — link, não cópia
-- base de conhecimento:
conteudos(id uuid, area text, tema text, titulo text, corpo_md text, resumo text, tags text[],
          autor_id → colaboradores, publicado bool, versao int, origem text, id_externo text, carimbos)
conteudos_versoes(conteudo_id, versao, corpo_md, autor_id, created_at)
```
Views: `v_clientes_ficha` (ficha + indicadores: saldo, estágio 3, próximo prazo, último registro) para a lista de clientes e para o BI.

## 3. Telas

**PR 6 — Ficha do cliente**
- Lista de clientes com filtros (status, responsável, cidade, origem) e cartões com saldo/próximo prazo/último registro.
- Aba **Resumo**: bloco de identificação, "história", situação, sócios e contatos, documentos (links do Drive), indicadores.
- Formulário de ficha; importação dos formulários de onboarding em HTML da pasta (um por cliente) para preencher sócios, bens, contratos declarados e observações.
- As abas atuais (Visão geral → **Passivos**, Contratos, Reserva, Timeline, Processos, Tarefas, Notas) continuam.

**PR 7 — Navegação**
- Portal com pastas por área; cada pasta lista seus módulos. Jurídico: Clientes, Prazos, Base de conhecimento. Administrativo: Equipe, Horas, Usuários, Configurações. Comercial/Marketing/Financeiro: vazias por enquanto (placeholders com "em construção" ou links externos).
- Painel com barra enxuta (Clientes · Prazos · Jurídico · Gestão) e breadcrumb (Portal › Clientes › Alphamec › Timeline) com botão voltar.
- Rotas por hash (`#/clientes/alphamec/timeline`) para o voltar do navegador funcionar.

**PR 8 — Base de conhecimento (Jurídico)**
- Lista por tema, busca por texto, página do artigo em Markdown renderizado, edição com histórico de versões, "relacionados".
- Importação inicial: páginas do Notion (via conector Notion, já disponível nesta conta) + conteúdo da skill `gestao-passivos-bancarios` (teses, metodologia de negociação, empresa gestora, crédito rural, Pronampe).
- Link do artigo a partir da ficha do cliente (ex.: estratégia "empresa gestora" aparece como sugestão quando o contrato é Pronampe).

**PR 9 — Retroativo ADVBox (clientes PJ)**
- O ADVBox não tem conector; caminho: exportação CSV/Excel pelo painel do ADVBox (processos, andamentos, tarefas, horas) ou navegação no site pelo navegador do app. Importação com `fonte='advbox'` e `id_externo` (já previstos no schema), sem duplicar o que foi lançado à mão.
- Antes: listar no ADVBox quais clientes PJ têm registros e o período, para decidir o que vale trazer.

## 4. Ordem e esforço
PR 6 (ficha + importação do onboarding) → PR 7 (navegação) → PR 8 (conhecimento + Notion) → PR 9 (ADVBox). Cada um com migration, código e roteiro de teste, como na etapa 2.

## 5. Decisões pendentes para a Maria Júlia
1. Nome das áreas do portal: Jurídico · Comercial · Marketing · Financeiro · Administrativo — confirma?
2. Base de conhecimento: aberta a toda a equipe para editar, ou só Jurídico edita e os demais leem?
3. Quais páginas do Notion entram primeiro (ex.: intranet jurídica, playbooks, onboarding)?
4. ADVBox: você consegue exportar CSV pelo painel deles, ou prefere que eu navegue no site pelo app?
5. Repositório: tornar privado (GitHub Pro) — recomendado antes de importar o Notion.

## 6. Frontend — reforma estrutural no PR 7
- Substituir o esquema "protótipo + gerador por âncoras" por um app único: `app.html`, CSS compartilhado, módulos JS por área (clientes, prazos, jurídico, gestão), roteador por `#`, motor de projeção como módulo puro com testes.
- Componentes únicos (tabela, formulário, modal, pills, KPIs, exportação CSV) em vez de cópias por módulo.
- Área do cliente mobile-first (cards em vez de tabelas largas; link abre no WhatsApp).
- Acabamento: esqueletos de carregamento, estados vazios com instrução, botões de modal contextuais, diálogo de confirmação, busca global, aviso de atualização em tempo real.
- Manter: identidade visual, modo escuro, gráficos SVG sem biblioteca, Supabase + RLS como única fonte.

## 7. Itens adicionados em 08/10 (a validar)
- **Publicações DJEN por OAB** (Edge Function diária → `andamentos` com fonte='djen' → tarefa de prazo + timeline + alerta). Testar a API com a OAB do escritório antes de prometer. Depois: contagem de prazo assistida, modelos de documentos, agenda (Google Calendar), Asaas, monitoramento Escavador/Judit por CNPJ.
- **Cofre de códigos 2FA (TOTP)** dos acessos a PJe/e-SAJ/gov.br: segredo cifrado no banco, cofre por pessoa com compartilhamento explícito e auditoria de consulta. Decisão pendente da Maria Júlia sobre enfraquecimento do 2FA e titularidade dos acessos; alternativa pronta: Bitwarden/1Password.
