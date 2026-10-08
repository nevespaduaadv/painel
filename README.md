# Portal Neves Pádua — Sistema de Carteira de Contratos

Frontend estático (HTML/CSS/JS puros) publicado no GitHub Pages, com dados, login e permissões no Supabase.

| Caminho | O que é |
|---|---|
| `index.html` | Portal: login único e azulejos por perfil (admin, colaborador, cliente). |
| `passivos/index.html` | Painel de Passivos Bancários (gerado — **não editar à mão**). |
| `passivos/carteira.js` | Módulo da carteira: abas **Timeline** e **Processos** da página do cliente (lê e grava nas tabelas do Supabase). |
| `passivos/equipe.js` | Aba **Equipe**: cadastro de colaboradores (cargo, núcleo, admissão, responsabilidades, vínculo com o usuário). |
| `passivos/tarefas.js` | Abas **Tarefas** (escritório + por cliente) e **Horas** (timesheet e relatórios), sobre `tarefas`, `apontamentos_horas` e as views `v_*`. |
| `cliente/index.html` | Área do cliente **por link com token** (`cliente/?t=…`), sem login (gerado — não editar à mão). Lê `painel_por_token()`. |
| `gestao/index.html` | Dashboard de gestão (carteira, jurídico, equipe, alertas). Lê só as views `v_*`; página independente, mesma sessão de login. |
| `fontes/painel.html` | Protótipo-fonte do painel (motor de projeção, dashboard, formulários). |
| `fontes/gerar-app-supabase.mjs` | Gera `passivos/index.html` a partir de `fontes/painel.html` (injeta login, runtime Supabase, aba Usuários e o `carteira.js`). |
| `fontes/gerar-pagina-cliente.mjs` | Legado: gerava a página fixa `alphamec/` a partir de um snapshot do banco antigo. |
| `alphamec/index.html` | Página fixa do cliente Alphamec (congelada na posição de 07/10/2026). |
| `supabase/migrations/*.sql` | Modelo de dados versionado. Toda alteração de schema entra aqui. |
| `docs/plano-etapa-2.md` | Plano da etapa 2 (modelo de dados, telas, ordem dos PRs). |

## Rodar localmente

```bash
python3 -m http.server 8765        # ou qualquer servidor estático
# abrir http://localhost:8765/  (portal)  e  http://localhost:8765/passivos/  (painel)
```
O login usa o projeto Supabase de produção (chave publicável — pública por design; a RLS é quem protege os dados).

## Alterar o painel

1. Edite `fontes/painel.html` (lógica e layout), `passivos/carteira.js` (timeline/processos) ou `passivos/tarefas.js` (tarefas/horas).
2. Regere: `node fontes/gerar-app-supabase.mjs`
3. Teste localmente e faça commit de **fontes/ + passivos/** juntos.

## Aplicar migrations

As migrations são SQL puro, numeradas. Para aplicar uma nova:

1. Supabase → **SQL Editor** → New query.
2. Cole o conteúdo de `supabase/migrations/NNNN_*.sql` e execute (Run).
3. Todas são idempotentes (`if not exists`, `drop policy if exists`…): rodar duas vezes não quebra.

Nunca altere tabelas/policies pelo painel do Supabase sem registrar a migration correspondente aqui.

Aplicadas até agora: `0001_esquema_inicial`, `0002_pr1_timeline_processos`, `0003_pr2_tarefas_timesheet`, `0004_pr3_dashboard_views`, `0005_pr4_visao_cliente_token`, `0006_pr5_colaboradores`.

Validação local antes de enviar: as migrations rodam em sequência num Postgres 16 limpo com stubs de `auth`, `storage` e `cron` (ver histórico do PR 2).

## Usuários e acessos

- Criar usuário: Supabase → Authentication → Users → **Add user** (com *Auto Confirm*). O primeiro usuário vira admin; os demais nascem `pendente`.
- Definir perfil: painel → aba **Usuários** (admin). Para cliente, escolha a empresa. Ao salvar um admin/colaborador, o sistema cria o registro correspondente em `colaboradores`; complete cargo, núcleo e admissão na aba **Equipe**. Quem sai: marque a data de desligamento (vira inativo; o histórico de horas e tarefas fica).
- Cliente logado vê só a própria empresa e só o que está marcado como *visível ao cliente*. Notas internas e a base de acordos nunca saem da equipe (RLS).
- **Link sem login (opcional)**: na página do cliente → "Link do cliente" → Gerar. O link `cliente/?t=TOKEN` mostra a mesma área do cliente (Visão geral · Contratos · Reserva de quitação · Andamento · Processos) lendo a função `painel_por_token`, que entrega só o publicado. Quem tem o link vê; revogue e gere outro quando precisar. Os acessos ficam em `acessos_token`.

## Operação do dia a dia (comandos para o Claude)

- "lance na timeline da Alphamec que fizemos X" → entrada em `entradas_timeline` (interna por padrão; "publique" para o cliente ver).
- "adicione o processo Y ao cliente Z" → linha em `processos`; andamentos entram em `andamentos` e aparecem na timeline.
- "atualiza o painel da Alphamec" → não é mais necessário: a área do cliente (login ou link) lê o banco ao vivo.
- "gera o link da Alphamec" / "revoga o link" → `clientes.acesso_por_token` + `token` (botão "Link do cliente" no painel).
- "crie a tarefa X para o cliente Z, prazo dia D, fatal" → linha em `tarefas` (vence em 7/15/30 na aba Tarefas).
- "lance 2 horas de parecer para a Alphamec" → `apontamentos_horas`; horas informadas na timeline já entram sozinhas.
- Acordos: continue usando **Registrar acordo** no card do contrato; o gatilho espelha em `acordos` e cria a entrada "Acordo fechado" na timeline (visível ao cliente).
- Mudanças de estágio (Res. CMN 4.966) são registradas automaticamente toda madrugada (pg_cron `estagios_diario`).

## Power BI / Looker

As views `v_*` (listadas no rodapé do dashboard) são a camada de leitura para BI. Para conectar:

1. Supabase → Project Settings → Database → crie um usuário de leitura (`create role bi login password '…'; grant usage on schema public to bi; grant select on all tables in schema public to bi;`) — **nunca use o `postgres` nem a service key**.
2. No Power BI: *Obter dados → PostgreSQL*, host e porta do Supabase (use o pooler em modo *session*), banco `postgres`, usuário `bi`.
3. Importe só as views `v_*`. O usuário `bi` enxerga tudo (não passa pela RLS), então o BI é de uso interno.

## Publicar

Push na `main` → GitHub Pages publica em 1–2 minutos. A área do cliente é a mesma `passivos/` (o perfil decide o que aparece).
