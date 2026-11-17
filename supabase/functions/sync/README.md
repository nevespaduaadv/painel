# Conector AtendeDireito Sync

**Situação: código no repositório, integração DESLIGADA, função NÃO implantada, nenhuma chamada real feita.**

| Arquivo | O que é |
|---|---|
| `adaptador.mjs` | Módulo puro: tradução fornecedor → sistema, assinatura do webhook, cliente REST (paginação, repetição com limite), consulta, webhook, teste de conexão |
| `index.ts` | Edge Function (Deno): rotas `/webhook`, `/puxar`, `/testar`; lê os segredos do ambiente da função |
| `adaptador.test.mjs` | 18 testes simulados (`node --test supabase/functions/sync/adaptador.test.mjs`) |
| `../../migrations/0114_sync_atendedireito.sql` | Banco: origem das publicações, fontes, divergências, prazos sugeridos × conferidos, histórico, chave liga/desliga |
| `../../../docs/qa/sync/0114-matriz.sql` | 35 casos no banco (PostgreSQL 16 e 17) |
| `../../../docs/qa/sync/ponta-a-ponta.mjs` | 15 casos: o adaptador entregando ao banco local, com fornecedor simulado |

## Regras que o código garante
- **Desligada por padrão.** `integracoes.ativo = false`: nenhuma chamada ao fornecedor, nenhuma gravação. Só a administradora liga (`sync_definir`).
- **Só leitura no fornecedor.** Nenhuma rota de escrita do Sync é chamada (tratar, ciência, desmarcar, monitorar, importar).
- **Sem duplicar.** Uma intimação só é anexada a uma publicação existente por identificador do DJEN ou por texto idêntico (processo + data + texto). Fora disso entra como publicação própria, marcada "possível duplicata" quando há outra do mesmo processo e dia, para conciliação humana. Nunca se esconde um ato por semelhança.
- **Nada analisado é sobrescrito.** Publicação já tratada pelo Jurídico não muda quando outra fonte chega; a diferença fica registrada como divergência.
- **Prazo da plataforma é sugestão.** Só vira prazo do sistema por `publicacao_prazo_conferir` (Jurídico), com quem, quando e histórico. "Fatal" só se a pessoa marcar.
- **Uma tarefa por intimação.** A conferência usa a tarefa de análise já aberta; não abre outra.
- **Segredos só no ambiente da função** (`SYNC_API_KEY`, `SYNC_WEBHOOK_SECRET`). Nada no navegador, no banco ou no repositório.
- **Registros sem conteúdo sensível.** Erros guardam categoria e identificador do pedido; quarentena guarda só nomes de campos; webhook inválido não guarda corpo.

## O que o contrato publicado não diz (confirmar na homologação real)
Lido em 17/11/2026 em `https://api.sync.atendedireito.app/openapi.json`. Os corpos de resposta estão sem esquema. Não estão documentados:
1. os nomes dos campos de número do processo, data de publicação, tribunal e link na intimação;
2. a chave que embrulha as listas paginadas;
3. o formato do corpo do webhook, a lista completa de eventos e a codificação da assinatura;
4. limites de requisição; 5. ambiente de testes (não há).

O adaptador usa nomes candidatos (ajustáveis em `integracoes.config.mapa`, sem novo código). Item que não casar vai para quarentena. O webhook é tratado só como aviso: o conteúdo vem da API.

## Para ligar de verdade (cada passo depende de autorização específica)
1. Conta e plano contratados pelas sócias; chave criada na conta e colocada pelas sócias nos segredos da função.
2. Migração 0114 no beta → implantação da função no beta → `/sync/testar`.
3. Primeira consulta real com processo de teste escolhido pelas sócias: conferir os campos reais e ajustar o mapa.
4. Webhook cadastrado no fornecedor com a URL da função e o segredo.
5. Produção: só depois de backup comprovado, homologação própria e autorização.
