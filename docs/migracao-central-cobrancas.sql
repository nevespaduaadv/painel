-- Migração dos dados do artefato "Central de Cobranças" (log de contatos e histórico de disparos) para o sistema (0076).
-- Casa cada registro com a cobrança do Asaas pelo nome do cliente + valor + vencimento (ou vencimento mais próximo, até 45 dias). Idempotente.
create temp table mig_log (cliente text, valor numeric, venc date, data date, desfecho text, proxima text, obs text, created timestamptz, nova date);
insert into mig_log values
('ANDREZA DOS SANTOS SOUZA',500,'2026-09-10','2026-09-24','VERIFICAR_AMANHA','Entrar na fila de amanhã','','2026-09-24T19:13:12.522Z',null),
('EDENILSON FERREIRA PINTO',300,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T19:52:19.153Z',null),
('ADRIANO ROBERTO BASSETTO',450,'2026-10-02','2026-09-25','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 02/10/2026','2026-09-25T20:41:44.841Z','2026-10-02'),
('JOÃO PEDRO ÁVILA BARBOSA',500,'2026-12-10','2026-09-29','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 10/12/2026','2026-09-29T13:50:30.530Z','2026-12-10'),
('JOÃO MARCELO FRANCISCO DE SOUZA',600,'2026-09-10','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T19:25:44.257Z',null),
('BARBARA PEREIRA GOMES',500,'2026-09-07','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T18:10:15.629Z',null),
('EURIDES SANTANA JUNIOR',450,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T20:06:08.831Z',null),
('DEYCON FRANCISCO DA SILVA',600,'2026-09-24','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','Pago após negociação (marcado na Régua de Cobrança)','2026-09-24T16:59:29.866Z',null),
('ADRIANO ROBERTO BASSETTO',450,'2026-10-02','2026-09-24','VERIFICAR_AMANHA','Entrar na fila de amanhã','4 em atraso, se não responder passar pra gestão','2026-09-24T20:19:33.050Z',null),
('MATEUS MACHADO',500,'2026-09-20','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T19:54:11.459Z',null),
('PAULO TAVARES DE MACÊDO',450,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T20:05:55.174Z',null),
('ALESSANDRO MAGALHÃES FERREIRA',500,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T20:15:03.843Z',null),
('RODRIGO VITOR PEREIRA',99.7,'2026-09-30','2026-09-25','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 30/09/2026','2026-09-25T20:42:03.052Z','2026-09-30'),
('PABLO CHAGAS DE OLIVEIRA',600,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T19:44:56.490Z',null),
('LARRY LUCIANO LOPES DE OLIVEIRA',350,'2026-09-30','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 30/09/2026','2026-09-24T17:01:28.802Z','2026-09-30'),
('PEDRO IVO PASTORELLO',2000,'2026-09-30','2026-09-28','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 30/09/2026','2026-09-28T14:09:14.641Z','2026-09-30'),
('EDSON LUIZ RODRIGUES BADU',450,'2026-09-10','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T20:05:16.203Z',null),
('NATÁLIA BILATTO MANZONI',400,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T19:50:54.371Z',null),
('BLENO DOS SANTOS SOUZA MELO',100,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','duas em atraso, passar pra gestão','2026-09-24T19:45:29.160Z',null),
('MARLON FERNANDO DE MARCO',450,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T20:05:07.324Z',null),
('TABATA AVILA MENEZES DA SILVA',350,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T18:36:34.274Z',null),
('Rodrigo Cesar F Foreze',300,'2026-09-10','2026-09-24','VERIFICAR_AMANHA','Entrar na fila de amanhã','','2026-09-24T20:40:54.427Z',null),
('CARLOS HENRIQUE GONÇALVES DA SILVA',450,'2026-09-17','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T20:01:09.861Z',null),
('CARLA VILAS BOAS SIMÕES SANTOS',500,'2026-09-08','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T18:07:44.869Z',null),
('APARECIDO MARCOS DE OLIVEIRA',350,'2026-10-01','2026-10-01','RECUPERADO','Encerrado — cobrança quitada','Pago em 01/10/2026, na data acordada na negociação (baixa pela lista de pagamentos do mês)','2026-10-05T13:09:33.000Z',null),
('LARRY LUCIANO LOPES DE OLIVEIRA',350,'2026-09-30','2026-10-15','RECUPERADO','Encerrado — cobrança quitada','Pago após negociação (conferido no Asaas em 15/10)','2026-10-15T12:00:00.000Z',null),
('EDENISE APARECIDA DOS SANTOS SILVA',600,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T18:25:59.141Z',null),
('RODRIGO VITOR PEREIRA',99.7,'2026-09-30','2026-09-24','VERIFICAR_AMANHA','Entrar na fila de amanhã','','2026-09-24T20:19:53.156Z',null),
('CL COMÉRCIO SERVIÇOS LTDA',1500,'2026-09-28','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 28/09/2026','2026-09-24T18:41:59.540Z','2026-09-28'),
('IGOR ALVARES BRAGA',400,'2026-09-10','2026-09-29','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-29T13:45:54.223Z',null),
('ANA LUCIA ROCHA PROCÓPIO',350,'2026-09-08','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T18:18:52.674Z',null),
('CARLOS ALEXANDRO GONÇALVES CYRINO',500,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','passar pra gerencia','2026-09-24T19:27:42.335Z',null),
('EDUARDO ROBERTO MARTINS',650,'2026-10-08','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 08/10/2026','2026-09-24T18:09:20.728Z','2026-10-08'),
('WILLIAM NIETO RIBEIRO FILHO',450,'2026-09-20','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T17:00:35.461Z',null),
('ELAINE DE FÁTIMA ROSAS',500,'2026-10-08','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','vai voltar a pagar','2026-09-24T18:12:37.711Z',null),
('ANDREZA DOS SANTOS SOUZA',500,'2026-09-10','2026-09-25','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-25T18:56:14.063Z',null),
('JOSÉ RODRIGO MATHIAS DE OLIVEIRA',450,'2026-09-15','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T20:02:15.682Z',null),
('FERNANDO DE OLIVEIRA SILVA',600,'2026-09-08','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T18:10:35.271Z',null),
('RENAN SANTOS ARMELLINE',650,'2026-09-10','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T18:13:36.909Z',null),
('LEONARDO LINS DE FREITAS',450,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T20:00:45.951Z',null),
('APARECIDO MARCOS DE OLIVEIRA',350,'2026-10-01','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 01/10/2026','2026-09-24T19:52:53.548Z','2026-10-01'),
('Guilherme Augusto Macedo',500,'2026-10-08','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Vai pagar a de setembro junto com a de outubro','2026-09-24T20:13:07.839Z',null),
('CLAUDIO OLIVEIRA MONTENEGRO PITA',225,'2026-09-12','2026-09-29','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-29T13:46:02.227Z',null),
('DEYCON FRANCISCO DA SILVA',600,'2026-09-24','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 24/09/2026','2026-09-24T16:58:55.838Z','2026-09-24'),
('CLAUDIO OLIVEIRA MONTENEGRO PITA',225,'2026-09-26','2026-09-29','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-29T13:46:05.954Z',null),
('FLAVIO DA SILVA LAQUETO ROSA',500,'2026-10-22','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Parcela para o final do contrato, vai voltar a pagar normalmente em outubro','2026-09-24T20:09:18.938Z',null),
('ISAC HENRIQUE DOS SANTOS',500,'2026-09-25','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 25/09/2026','2026-09-24T17:46:33.263Z','2026-09-25'),
('JOSÉ FERNANDES DE LIMA',500,'2026-09-18','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T19:51:14.045Z',null),
('LARISSA CAROLINE VIOTTO',350,'2026-09-10','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','','2026-09-24T19:50:45.356Z',null),
('ALESSANDRO MAGALHÃES FERREIRA',500,'2026-09-06','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','passar pra gerencia','2026-09-24T19:25:00.133Z',null),
('ISAC HENRIQUE DOS SANTOS',500,'2026-09-25','2026-09-24','RECUPERADO','Encerrado — cobrança quitada','Pago após negociação de nova data','2026-09-24T18:48:54.536Z',null),
('DANIEL FRANCISCO DA SILVA',450,'2026-09-30','2026-09-24','NEGOCIOU','Acompanhar nova data de pagamento','Nova data acordada: 30/09/2026','2026-09-24T17:30:36.006Z','2026-09-30'),
('LUCAS DA SILVA MARQUES LUDOLF',600,'2026-09-20','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T17:01:37.000Z',null),
('ENEAS DIAS FURTADO ELER',500,'2026-09-10','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T19:21:16.799Z',null),
('ANGELO MAXIMO OLIVEIRA GOMES',750,'2026-09-05','2026-09-24','NAO_RESPONDE','Monitorar histórico / avaliar recorrência','','2026-09-24T17:45:57.884Z',null);

with alvo as (
  select m.*, (
    select c.id from public.cobrancas c
      left join public.clientes cl on cl.id = c.cliente_id left join public.asaas_contatos ac on ac.asaas_id = c.asaas_cliente_id
     where upper(regexp_replace(coalesce(cl.nome_fantasia, cl.dados->>'nome', ac.nome, ''), '\s+', ' ', 'g')) = upper(regexp_replace(m.cliente, '\s+', ' ', 'g'))
       and abs(c.valor - m.valor) < 0.01 and c.vencimento is not null
       and (m.venc is null or abs(c.vencimento - m.venc) <= 45)
     order by case when c.vencimento = coalesce(m.venc, c.vencimento) then 0 else 1 end, abs(c.vencimento - coalesce(m.venc, c.vencimento)), c.vencimento limit 1) as cobranca_id
  from mig_log m)
insert into public.cobranca_contatos (cobranca_id, cliente_nome, valor, data, desfecho, proxima_acao, observacao, nova_data, registrado_por, origem, created_at)
select cobranca_id, cliente, valor, data, desfecho, nullif(proxima,''), nullif(obs,''), nova, null, 'migracao', coalesce(created, now())
  from alvo a where cobranca_id is not null
   and not exists (select 1 from public.cobranca_contatos k where k.cobranca_id = a.cobranca_id and k.data = a.data and k.desfecho = a.desfecho and k.origem = 'migracao');
-- recuperadas na Central antiga: baixa manual (se o Asaas ainda não deu baixa)
update public.cobrancas c set baixa_manual = true, baixa_manual_em = coalesce(baixa_manual_em, now()), regua_parada = true
  from public.cobranca_contatos k where k.cobranca_id = c.id and k.desfecho = 'RECUPERADO' and k.origem = 'migracao' and c.status <> 'paga';
-- negociações com nova data
update public.cobrancas c set vencimento_negociado = k.nova_data
  from public.cobranca_contatos k where k.cobranca_id = c.id and k.desfecho = 'NEGOCIOU' and k.origem = 'migracao' and k.nova_data is not null and c.vencimento_negociado is null and c.status <> 'paga';
insert into public.regua_disparos (data, etapa, origem, status, aptos, enviados, nao_enviados, motivo, iniciado_em, concluido_em) values
('2026-10-20','D-0','migracao','concluida','[{"cliente": "M. R. GALERA ACESSORIOS LTDA", "parcela": "1 de 3", "tel4": "2932", "vencimento": "20/10/2026"}, {"cliente": "BUTIQUE DE CARNE SANTA RITA", "parcela": "1 de 12", "tel4": "1623", "vencimento": "20/10/2026"}, {"cliente": "LUGIMAR LOPES DA SILVA E OUTRA", "parcela": "1 de 12", "tel4": "3580", "vencimento": "20/10/2026"}, {"cliente": "RENAN SANTOS ARMELLINE", "parcela": "3 de 13", "tel4": "6886", "vencimento": "20/10/2026"}, {"cliente": "CRISTIANE GALLI CARDOSO", "parcela": "3 de 12", "tel4": "3672", "vencimento": "20/10/2026"}, {"cliente": "WILLIAM NIETO RIBEIRO FILHO", "parcela": "9 de 12", "tel4": "6288", "vencimento": "20/10/2026"}, {"cliente": "CEZAR VINICIUS SILVA", "parcela": "9 de 12", "tel4": "9315", "vencimento": "20/10/2026"}, {"cliente": "LUCIANO MARCOS DA SILVA", "parcela": "9 de 11", "tel4": "3390", "vencimento": "20/10/2026"}]'::jsonb,'[{"cliente": "M. R. GALERA ACESSORIOS LTDA", "hora": "09:10", "parcela": "1 de 3", "vencimento": "20/10/2026"}, {"cliente": "BUTIQUE DE CARNE SANTA RITA", "hora": "09:11", "parcela": "1 de 12", "vencimento": "20/10/2026"}, {"cliente": "LUGIMAR LOPES DA SILVA E OUTRA", "hora": "09:11", "parcela": "1 de 12", "vencimento": "20/10/2026"}, {"cliente": "RENAN SANTOS ARMELLINE", "hora": "09:12", "parcela": "3 de 13", "vencimento": "20/10/2026"}, {"cliente": "CRISTIANE GALLI CARDOSO", "hora": "09:13", "parcela": "3 de 12", "vencimento": "20/10/2026"}, {"cliente": "WILLIAM NIETO RIBEIRO FILHO", "hora": "09:13", "parcela": "9 de 12", "vencimento": "20/10/2026"}, {"cliente": "CEZAR VINICIUS SILVA", "hora": "09:14", "parcela": "9 de 12", "vencimento": "20/10/2026"}, {"cliente": "LUCIANO MARCOS DA SILVA", "hora": "09:14", "parcela": "9 de 11", "vencimento": "20/10/2026"}]'::jsonb,'[{"cliente": "MATEUS MACHADO", "motivo": "contato duplicado/ambíguo", "parcela": "2 de 14", "vencimento": "20/10/2026"}, {"cliente": "CL COMÉRCIO SERVIÇOS LTDA", "motivo": "inadimplente", "parcela": "3 de 11", "vencimento": "20/10/2026"}, {"cliente": "LUCAS DA SILVA MARQUES LUDOLF", "motivo": "inadimplente", "parcela": "3 de 12", "vencimento": "20/10/2026"}, {"cliente": "LARRY LUCIANO LOPES DE OLIVEIRA", "motivo": "inadimplente", "parcela": "7 de 11", "vencimento": "20/10/2026"}]'::jsonb,'','2026-10-20T11:55:00Z','2026-10-20T12:15:00Z'),
('2026-10-21','D-0','migracao','falhou','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'3 navegadores Chrome conectados à conta (Browser 1 Windows, Browser 2 macOS, Browser 3 Windows) e nenhum selecionado; a rotina não pode escolher sozinha sem a usuária','2026-10-21T13:54:02Z',null),
('2026-10-19','D-0','migracao','falhou','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'Há 3 navegadores Chrome conectados à conta (Browser 1 Windows, Browser 2 Windows, Browser 3 macOS) e nenhum está selecionado para a sessão; a rotina agendada não pode escolher sozinha. Asaas e ChatGuru não foram acessados. Última tentativa do dia (17:54).','2026-10-19T20:54:27Z',null)
on conflict (data, etapa) do nothing;
select count(*) filter (where origem='migracao') as contatos_migrados from public.cobranca_contatos;-- registros sem correspondência (para conferência) — resultado final mostrado no editor
select m.cliente, m.valor, m.venc, m.data, m.desfecho from mig_log m
 where not exists (select 1 from public.cobranca_contatos k where k.origem = 'migracao' and k.cliente_nome = m.cliente and k.data = m.data and k.desfecho = m.desfecho);
drop table if exists mig_log;
