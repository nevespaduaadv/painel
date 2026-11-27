-- 0128 — Boas-vindas automática por WhatsApp desligada (decisão das sócias, 27/11/2026, antes da liberação à equipe em 30/11)
-- O gatilho enfileirava a mensagem "onb_boas_vindas" a cada cliente novo ativo com fechamento recente. Com a equipe cadastrando
-- clientes, a mensagem sairia para o cliente real. O gatilho fica DESLIGADO (não removido); a função continua existindo.
-- Aplicada na produção em 27/11/2026 pelo editor SQL. Conferido: estado do gatilho = D; nenhuma mensagem pendente na fila.
alter table public.clientes disable trigger clientes_boas_vindas_auto;

-- Para religar:
--   alter table public.clientes enable trigger clientes_boas_vindas_auto;
