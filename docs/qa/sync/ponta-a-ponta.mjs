// Ponta a ponta SIMULADA: o adaptador (o mesmo código da Edge Function) entregando a um PostgreSQL local com a migração 0114.
// O fornecedor é um dublê em memória — nenhuma chamada real, nenhum dado de cliente.
// Uso: node docs/qa/sync/ponta-a-ponta.mjs <diretório do socket> <porta>      (depois de docs/qa/sync/0114-matriz.sql)
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { clienteSync, puxar, receberWebhook, testarConexao } from "../../../supabase/functions/sync/adaptador.mjs";
const [W, PORTA] = process.argv.slice(2);
const sql = (q) => { const r = spawnSync("psql", ["-h", W, "-p", PORTA, "-U", "postgres", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr.slice(0, 400)); return r.stdout.trim(); };
const lit = (v) => v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : "'" + (typeof v === "string" ? v : JSON.stringify(v)).replace(/'/g, "''") + "'" + (typeof v === "object" ? "::jsonb" : "");
const db = { rpc: async (nome, a = {}) => { const s = sql(`select to_jsonb(public.${nome}(${Object.entries(a).map(([k, v]) => `${k} => ${lit(v)}`).join(", ")}))`); return s ? JSON.parse(s) : null; } };
const resp = (status, corpo, cab = {}) => ({ ok: status < 300, status, headers: { get: (k) => cab[k.toLowerCase()] ?? null }, json: async () => corpo });
let chamadas = 0;
const fornecedor = (itens, prazos = []) => async (url) => { chamadas++; const u = new URL(url); if (u.pathname === "/v1/conta") return resp(200, {}); if (u.pathname === "/v1/prazos") return resp(200, { itens: prazos }); if (u.pathname === "/v1/intimacoes") return resp(200, { itens }); return resp(404, {}); };
const cli = (f) => () => clienteSync({ chave: "sk_teste_ficticia", fetch: f, esperar: async () => {} });
let n = 0, falhas = 0; const caso = (nome, ok, det = "") => { n++; if (!ok) falhas++; console.log(`${ok ? "ok   " : "FALHA"} P${String(n).padStart(2, "0")} ${nome}${det ? "  [" + det + "]" : ""}`); };
const num = (q) => Number(sql(q));
const PROC = "1111111-11.2026.8.26.0100";               // processo fictício já cadastrado pela matriz
const itens = [
  { id: "e2e-1", numero_processo: PROC, data_publicacao: "2026-11-17", tribunal: "TJSP", tipo_ato: "Decisão", texto: "Decisão fictícia de ponta a ponta. Intime-se." },
  { id: "e2e-2", numero_processo: "8888888-88.2026.8.26.0100", data_publicacao: "2026-11-17", tribunal: "TJSP", texto: "Ato de processo que o escritório não cadastrou." },
  { id: "e2e-3", numero_processo: PROC, data_publicacao: "2026-11-10", tribunal: "TJSP", texto: "Manifeste-se a parte autora em 15 dias." },   // idêntica à publicação 900001 do DJEN
  { id: "e2e-4", texto: "item sem processo e sem data" },
];
const prazos = [{ chave: "e2e-k1", data_fatal: "2026-11-24", intimacao_ids: ["e2e-1"], costura: { prazos: [{ chave: "e2e-k1", rotulo: "Embargos de declaração (5 dias)", data_fatal: "2026-11-24" }, { chave: "e2e-k2", rotulo: "Agravo (15 dias)", data_fatal: "2026-12-08" }] } }];

sql("update public.integracoes set ativo = false where id = 'sync'");
const pubs0 = num("select count(*) from public.publicacoes"), tar0 = num("select count(*) from public.tarefas"), and0 = num("select count(*) from public.andamentos");
let r = await puxar({ db, cliente: cli(fornecedor(itens, prazos)) });
caso("integração desligada: nenhuma chamada ao fornecedor; publicações, tarefas e andamentos intactos", r.status === "desligada" && chamadas === 0 && num("select count(*) from public.publicacoes") === pubs0 && num("select count(*) from public.tarefas") === tar0, `status ${r.status} · chamadas ${chamadas}`);
r = await testarConexao({ db, cliente: cli(fornecedor([])) });
caso("teste de conexão com a integração desligada: registra o estado e não grava publicação", r.ok && sql("select estado ->> 'conexao' from public.integracoes where id = 'sync'") === "ok" && num("select count(*) from public.publicacoes") === pubs0);
sql("update public.integracoes set ativo = true where id = 'sync'");
chamadas = 0; r = await puxar({ db, cliente: cli(fornecedor(itens, prazos)) });
caso("ligada, mas sem o contrato confirmado: nenhuma chamada, nenhuma publicação", r.status === "aguardando_contrato" && chamadas === 0 && num("select count(*) from public.publicacoes") === pubs0, r.status);
sql("update public.integracoes set config = config || '{\"contrato_confirmado\": true}'::jsonb where id = 'sync'");
r = await puxar({ db, cliente: cli(fornecedor(itens, prazos)) });
caso("recebimento: 4 itens → 2 novas, 1 anexada à publicação do DJEN, 1 em quarentena; execução parcial (há quarentena)", r.status === "parcial" && r.resumo.novas === 2 && r.resumo.anexadas === 1 && r.resumo.quarentena === 1, JSON.stringify(r.resumo));
caso("vinculação: a nova do processo cadastrado ficou ligada ao processo e ao cliente, com origem Sync", sql("select (processo_id is not null) || '|' || (cliente_id is not null) || '|' || origem from public.publicacoes p join public.publicacao_fontes f on f.publicacao_id = p.id where f.id_externo = 'e2e-1'") === "true|true|sync");
caso("sem processo: entra na fila sem vínculo e sem tarefa automática", sql("select (processo_id is null) || '|' || (tarefa_id is null) from public.publicacoes p join public.publicacao_fontes f on f.publicacao_id = p.id where f.id_externo = 'e2e-2'") === "true|true");
caso("já existente no DJEN: nenhuma publicação nova; a publicação 900001 passa a ter as duas fontes e continua como estava", sql("select publicacao_id || '|' || casamento from public.publicacao_fontes where id_externo = 'e2e-3'") === "900001|identica" && sql("select array_to_string(fontes, ',') from public.v_publicacoes_integracao where publicacao_id = 900001") === "sync,djen");
caso("quarentena: registrados só os nomes dos campos, sem o conteúdo", sql("select resultado ->> 'campos_recebidos' from public.sync_eventos where status = 'quarentena' order by id desc limit 1") === '["id", "texto"]' && num("select count(*) from public.sync_eventos where status = 'quarentena' and resultado::text ilike '%sem processo e sem data%'") === 0);
caso("prazos da plataforma: duas hipóteses gravadas como SUGESTÃO, sem data conferida, sem tarefa com esse prazo", sql("select count(*) || '|' || count(*) filter (where estado = 'sugerido' and data_conferida is null and tarefa_id is null) from public.publicacao_prazos z join public.publicacao_fontes f on f.publicacao_id = z.publicacao_id where f.id_externo = 'e2e-1'") === "2|2"
  && num("select count(*) from public.tarefas where prazo in ('2026-11-24', '2026-12-08') and prazo_fatal") === 0);
const pubs1 = num("select count(*) from public.publicacoes"), tar1 = num("select count(*) from public.tarefas"), and1 = num("select count(*) from public.andamentos");
caso("tarefas: no máximo uma tarefa de análise para a intimação nova do processo cadastrado", tar1 - tar0 <= 1 && and1 - and0 === 1, `tarefas +${tar1 - tar0} · andamentos +${and1 - and0}`);
r = await puxar({ db, cliente: cli(fornecedor(itens, prazos)) });
caso("evento repetido: a mesma consulta de novo não cria publicação, tarefa, andamento nem prazo", r.resumo.repetidas === 3 && r.resumo.novas === 0 && r.resumo.prazos_sugeridos === 0 && num("select count(*) from public.publicacoes") === pubs1 && num("select count(*) from public.tarefas") === tar1 && num("select count(*) from public.andamentos") === and1, JSON.stringify(r.resumo));
const corpo = JSON.stringify({ evento: "intimacao.criada", intimacao_id: "e2e-1" }), seg = "segredo-ficticio-de-teste", ass = createHmac("sha256", seg).update(corpo).digest("hex");
chamadas = 0; r = await receberWebhook({ db, cliente: cli(fornecedor(itens, prazos)), corpoBruto: corpo, assinatura: "abc123", segredo: seg });
caso("webhook com assinatura inválida: 401, corpo não guardado, fornecedor não consultado", r.http === 401 && chamadas === 0 && num("select count(*) from public.sync_eventos where status = 'assinatura_invalida' and corpo is null") >= 1);
r = await receberWebhook({ db, cliente: cli(fornecedor(itens, prazos)), corpoBruto: corpo, assinatura: ass, segredo: seg });
caso("webhook válido: processado; nada duplicado", r.http === 200 && r.status === "processado" && num("select count(*) from public.publicacoes") === pubs1, r.status);
chamadas = 0; r = await receberWebhook({ db, cliente: cli(fornecedor(itens, prazos)), corpoBruto: corpo, assinatura: ass, segredo: seg });
caso("webhook repetido: reconhecido pela impressão do corpo; não consulta o fornecedor de novo", r.status === "repetido" && chamadas === 0);
r = await puxar({ db, cliente: cli(async () => resp(401, {})) });
caso("falha de autenticação: execução com erro, categoria registrada, sem a chave no registro", r.status === "erro" && sql("select erro from public.sync_execucoes order by id desc limit 1").startsWith("autenticacao:") && num("select count(*) from public.sync_execucoes where erro ilike '%sk_teste%' or resumo::text ilike '%sk_teste%'") === 0);
caso("histórico: toda execução tem origem, início, término e situação", num("select count(*) from public.sync_execucoes where terminada_em is null and status = 'em_andamento'") === 0, sql("select string_agg(origem || ':' || status, ' ' order by id) from (select * from public.sync_execucoes order by id desc limit 6) x"));
sql("update public.integracoes set ativo = false where id = 'sync'");
console.log(`ponta a ponta: ${n - falhas} de ${n} conformes`); process.exit(falhas ? 1 : 0);
