# Conector AtendeDireito Sync

**Situação: código no repositório, integração DESLIGADA, função NÃO implantada, nenhuma chamada real feita.**

| Arquivo | O que é |
|---|---|
| `adaptador.mjs` | Módulo puro: tradução fornecedor → sistema, assinatura do webhook, cliente REST (paginação, repetição com limite), consulta, webhook, teste de conexão |
| `index.ts` | Edge Function (Deno): rotas `/webhook`, `/puxar`, `/testar`; lê os segredos do ambiente da função |
| `adaptador.test.mjs` | 22 testes simulados (`node --test supabase/functions/sync/adaptador.test.mjs`) |
| `../../migrations/0114_sync_atendedireito.sql` | Banco: origem das publicações, fontes, divergências, prazos sugeridos × conferidos, histórico, chave liga/desliga |
| `../../../docs/qa/sync/0114-matriz.sql` | 43 casos no banco (PostgreSQL 16 e 17; esquema como o da produção e como o do beta) |
| `../../migrations/0115_publicacoes_guarda_analise.sql` | Independente do Sync: a tarefa de análise não conclui com intimação sem providência (8 casos em `0115-matriz.sql`) |
| `../../../docs/qa/sync/ponta-a-ponta.mjs` | 16 casos: o adaptador entregando ao banco local, com fornecedor simulado |

## Regras que o código garante
- **Desligada por padrão.** `integracoes.ativo = false`: nenhuma chamada ao fornecedor, nenhuma gravação. Só a administradora liga (`sync_definir`).
- **Só leitura no fornecedor.** Nenhuma rota de escrita do Sync é chamada (tratar, ciência, desmarcar, monitorar, importar).
- **Sem duplicar.** Uma intimação só é anexada a uma publicação existente por identificador do DJEN ou por texto idêntico (processo + data + texto). Fora disso entra como publicação própria, marcada "possível duplicata" quando há outra do mesmo processo e dia, para conciliação humana. Nunca se esconde um ato por semelhança.
- **Nada analisado é sobrescrito.** Publicação já tratada pelo Jurídico não muda quando outra fonte chega; a diferença fica registrada como divergência.
- **Prazo da plataforma é sugestão.** Só vira prazo do sistema por `publicacao_prazo_conferir` (Jurídico), com quem, quando e histórico. "Fatal" só se a pessoa marcar.
- **Uma tarefa por prazo conferido.** Cada hipótese conferida tem a própria tarefa e a própria data; reconferir atualiza a mesma tarefa. A tarefa de análise não é alterada.
- **Revisão das situações críticas.** Prazo fatal, data corrigida para depois da sugerida e sugestão descartada ficam aguardando revisão de quem responde pelo Jurídico, sem travar: a tarefa já existe. Quem revisa não é quem conferiu.
- **Sem ingestão antes do contrato confirmado.** `/puxar` não consulta nem grava nada enquanto `integracoes.config.contrato_confirmado` não for verdadeiro. `/amostra` devolve só nomes e tipos dos campos de até 5 registros.
- **Webhook desligado.** Só responde com `SYNC_WEBHOOK_ATIVO=1`; fica assim até o formato da assinatura ser confirmado em teste real.
- **Segredos só no ambiente da função** (`SYNC_API_KEY`, `SYNC_WEBHOOK_SECRET`). Nada no navegador, no banco ou no repositório.
- **Registros sem conteúdo sensível.** Erros guardam categoria e identificador do pedido; quarentena guarda só nomes de campos; webhook inválido não guarda corpo.

## O que o contrato publicado não diz (confirmar na homologação real)
Lido em 17/11/2026 em `https://api.sync.atendedireito.app/openapi.json`. Os corpos de resposta estão sem esquema. Não estão documentados:
1. os nomes dos campos de número do processo, data de publicação, tribunal e link na intimação;
2. a chave que embrulha as listas paginadas;
3. o formato do corpo do webhook, a lista completa de eventos e a codificação da assinatura;
4. limites de requisição; 5. ambiente de testes (não há).

O adaptador usa nomes candidatos (ajustáveis em `integracoes.config.mapa`, sem novo código). Item que não casar vai para quarentena. O webhook é tratado só como aviso: o conteúdo vem da API.

## Revisão de segurança da função (17/11)
| Ponto | Situação |
|---|---|
| Autenticação do painel | token do usuário conferido no Supabase Auth; papel e acesso lidos do banco com o token da própria pessoa |
| Autorização | `/testar` e `/amostra`: administradora; `/puxar`: Jurídico; conferência e revisão de prazo: no banco |
| Webhook | desligado por padrão; segredo obrigatório; HMAC sobre o corpo bruto, comparação em tempo constante; corpo limitado a 256 KB; sem CORS |
| Enxurrada de pedidos forjados | no máximo um registro por hora, sem conteúdo |
| Credenciais | só em variáveis de ambiente; a chave do fornecedor só vai ao endereço dele (sem seguir redirecionamento); tempo limite de 15 s |
| Respostas e registros | sem detalhe de erro, sem conteúdo de processo, sem credencial; `Cache-Control: no-store` |
| CORS | só a origem do painel |
| Falta de configuração | responde 503 em vez de operar parcialmente |
| **Pendente** | execução real em Deno (até aqui só verificação de sintaxe); limite de frequência por usuário em `/puxar`; revisão por segunda pessoa antes da implantação |

## Para ligar de verdade (cada passo depende de autorização específica)
1. Conta e plano contratados pelas sócias; chave criada na conta e colocada pelas sócias nos segredos da função.
2. Migração 0114 no beta → implantação da função no beta → `/sync/testar` (chamada de conexão).
3. `/sync/amostra` com poucos processos escolhidos pelas sócias: conferir os campos reais, paginação, identificadores, datas e mensagens de erro; ajustar o mapa ao contrato observado; só então marcar `contrato_confirmado`.
4. Testes de duplicidade e divergência com dados reais do piloto; depois, ingestão no beta.
5. Webhook: só depois de confirmado o formato da assinatura na documentação oficial e em teste real.
6. Produção: só depois de backup comprovado, homologação própria e autorização.
