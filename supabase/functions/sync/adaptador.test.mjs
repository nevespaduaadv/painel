// Testes SIMULADOS do adaptador do Sync: nenhuma chamada real ao fornecedor, nenhum dado de cliente.
// Rodar: node --test supabase/functions/sync/
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mapearIntimacao, prazosPorIntimacao, extrairLista, verificarAssinatura, clienteSync, puxar, testarConexao, receberWebhook, amostrar, ErroSync } from "./adaptador.mjs";

// ---------- dublês ----------
const resp = (status, corpo, cab = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => ({ "x-request-id": "req-teste", ...cab })[k.toLowerCase()] ?? null }, json: async () => { if (corpo === undefined) throw new Error("sem json"); return corpo; } });
function fornecedor(rotas) {            // rotas: { "/v1/intimacoes": [resposta1, resposta2, ...] | (url) => resposta }
  const chamadas = [];
  const f = async (url, init) => {
    const u = new URL(url); chamadas.push({ caminho: u.pathname, params: Object.fromEntries(u.searchParams), auth: init.headers.Authorization });
    const r = rotas[u.pathname]; if (!r) return resp(404, {});
    if (typeof r === "function") return r(u);
    return r.length > 1 ? r.shift() : r[0];
  };
  return { f, chamadas };
}
function banco({ ativo = true, config = { janela_dias: 7, max_paginas: 3, itens_por_pagina: 2, contrato_confirmado: true } } = {}) {
  const b = { ativo, config, execucoes: [], eventos: new Map(), publicacoes: new Map(), quarentena: [], estado: null, chamadas: [] };
  b.rpc = async (nome, a = {}) => {
    b.chamadas.push(nome);
    switch (nome) {
      case "sync_config_ler": return { ativo: b.ativo, config: b.config };
      case "sync_execucao_abrir": b.execucoes.push({ origem: a.p_origem, status: b.ativo || a.p_origem === "teste_conexao" ? "em_andamento" : "desligada" }); return b.execucoes.length;
      case "sync_execucao_fechar": Object.assign(b.execucoes[a.p_id - 1], { status: a.p_status, resumo: a.p_resumo, erro: a.p_erro ?? null }); return null;
      case "sync_estado_gravar": b.estado = a.p_estado; return null;
      case "sync_quarentena_registrar": b.quarentena.push(a); return null;
      case "sync_evento_registrar": {
        if (b.eventos.has(a.p_impressao)) return { id: b.eventos.get(a.p_impressao).id, status: "repetido" };
        const st = a.p_assinatura_ok === false ? "assinatura_invalida" : !b.ativo ? "ignorado_desligada" : "novo";
        const ev = { id: b.eventos.size + 1, status: st, corpo: st === "novo" ? a.p_corpo : null, tipo: a.p_tipo }; b.eventos.set(a.p_impressao, ev); return { id: ev.id, status: st };
      }
      case "sync_evento_concluir": for (const ev of b.eventos.values()) if (ev.id === a.p_id) ev.status = a.p_status; return null;
      case "sync_receber_intimacao": {                 // o comportamento real está na migração 0114 (35 casos em docs/qa/sync/0114-matriz.sql)
        if (!b.ativo) return { acao: "desligada" };
        const it = a.p; if (b.publicacoes.has(it.id_externo)) return { acao: "repetida", prazos_novos: 0 };
        b.publicacoes.set(it.id_externo, it); return { acao: "nova", prazos_novos: it.prazos.length, sem_processo: it.numero_processo.startsWith("9") };
      }
      default: throw new Error("rpc inesperada: " + nome);
    }
  };
  return b;
}
const semEspera = { esperar: async () => {}, esperaBaseMs: 1 };
const intim = (id, extra = {}) => ({ id, numero_processo: "0001234-56.2026.8.26.0100", data_publicacao: "2026-11-16", tribunal: "TJSP", tipo_ato: "Despacho", texto: "Texto fictício " + id, obrigacao_estado: "aberta", ...extra });
const cli = (f) => () => clienteSync({ chave: "sk_teste_ficticia", fetch: f, ...semEspera });

// ---------- mapeamento ----------
test("01 recebimento: item com os campos reconhecidos vira o formato do sistema, com a origem preservada", () => {
  const r = mapearIntimacao(intim("a1", { destinatarios: { intimados: [{ nome: "Empresa Fictícia", polo: "passivo" }], advogados: [{ nome: "Adv Fictício", oab: "00000/XX" }] } }));
  assert.equal(r.ok, true); assert.equal(r.item.id_externo, "a1"); assert.equal(r.item.numero_processo, "0001234-56.2026.8.26.0100");
  assert.equal(r.item.data_publicacao, "2026-11-16"); assert.equal(r.item.destinatarios.length, 1); assert.equal(r.item.bruto.id, "a1");
});
test("02 campos não documentados com outro nome: aceitos pelos candidatos ou pelo mapa configurável", () => {
  assert.equal(mapearIntimacao({ id: 7, processo: { numero: "00012345620268260100" }, publicada_em: "2026-11-16T08:00:00Z" }).ok, true);
  assert.equal(mapearIntimacao({ id: 7, autos: "0001234-56.2026.8.26.0100", quando: "16/11/2026" }).ok, false);
  assert.equal(mapearIntimacao({ id: 7, autos: "0001234-56.2026.8.26.0100", quando: "16/11/2026" }, { numero_processo: ["autos"], data_publicacao: ["quando"] }).item.data_publicacao, "2026-11-16");
});
test("03 item sem número de processo ou sem data reconhecível NÃO é adivinhado: quarentena com os nomes dos campos, sem conteúdo", () => {
  const r = mapearIntimacao({ id: "x", conteudo: "segredo de justiça", alguma_data: "ontem" });
  assert.equal(r.ok, false); assert.deepEqual(r.faltando, ["numero_processo", "data_publicacao"]); assert.deepEqual(r.campos, ["alguma_data", "conteudo", "id"]);
  assert.ok(!JSON.stringify(r).includes("segredo"));
});
test("04 prazos da plataforma: todas as hipóteses chegam ligadas à intimação, sem repetição", () => {
  const por = prazosPorIntimacao([{ chave: "k1", data_fatal: "2026-11-23", intimacao_ids: ["a1"], costura: { id: "c", prazos: [{ chave: "k1", rotulo: "Embargos (5 dias)", data_fatal: "2026-11-23" }, { chave: "k2", rotulo: "Agravo (15 dias)", data_fatal: "2026-12-07" }] } }, { chave: "k1", data_fatal: "2026-11-23", intimacao_ids: ["a1"] }]);
  assert.deepEqual(por.get("a1").map((p) => p.chave), ["k1", "k2"]);
  assert.deepEqual(mapearIntimacao(intim("a1"), null, por.get("a1")).item.prazos.map((p) => p.data_fatal), ["2026-11-23", "2026-12-07"]);
});
test("05 resposta em formato desconhecido é erro de formato, não lista vazia", () => {
  assert.deepEqual(extrairLista({ itens: [1] }), [1]); assert.deepEqual(extrairLista([2]), [2]);
  assert.throws(() => extrairLista({ coisa: {} }), (e) => e instanceof ErroSync && e.categoria === "formato");
});

// ---------- assinatura ----------
test("06 webhook: assinatura HMAC-SHA256 válida (hex, base64 ou com prefixo) passa; qualquer outra coisa não", async () => {
  const corpo = '{"evento":"intimacao.criada"}', seg = "segredo-ficticio";
  const h = createHmac("sha256", seg).update(corpo).digest("hex"), b = createHmac("sha256", seg).update(corpo).digest("base64");
  assert.equal(await verificarAssinatura(seg, corpo, h), true); assert.equal(await verificarAssinatura(seg, corpo, "sha256=" + h), true); assert.equal(await verificarAssinatura(seg, corpo, b), true);
  assert.equal(await verificarAssinatura(seg, corpo + " ", h), false); assert.equal(await verificarAssinatura("outro", corpo, h), false);
  assert.equal(await verificarAssinatura(seg, corpo, ""), false); assert.equal(await verificarAssinatura("", corpo, h), false);
});

// ---------- cliente ----------
test("07 falha de autenticação: para na primeira resposta 401, sem repetir, e a chave não aparece no erro", async () => {
  const { f, chamadas } = fornecedor({ "/v1/conta": [resp(401, {})] });
  await assert.rejects(clienteSync({ chave: "sk_teste_ficticia", fetch: f, ...semEspera }).conta(), (e) => e.categoria === "autenticacao" && !JSON.stringify({ ...e, m: e.message }).includes("sk_teste"));
  assert.equal(chamadas.length, 1); assert.equal(chamadas[0].auth, "Bearer sk_teste_ficticia");
});
test("08 limite de requisições: respeita o 429 e o Retry-After, tenta de novo e desiste no teto", async () => {
  const esperas = []; const { f, chamadas } = fornecedor({ "/v1/conta": [resp(429, {}, { "retry-after": "3" }), resp(200, { ok: 1 })] });
  const r = await clienteSync({ chave: "k", fetch: f, esperar: async (ms) => esperas.push(ms) }).conta();
  assert.deepEqual(r.corpo, { ok: 1 }); assert.deepEqual(esperas, [3000]); assert.equal(chamadas.length, 2);
  const s = fornecedor({ "/v1/conta": [resp(429, {})] });
  await assert.rejects(clienteSync({ chave: "k", fetch: s.f, maxTentativas: 3, ...semEspera }).conta(), (e) => e.categoria === "limite" && e.tentativas === 3);
  assert.equal(s.chamadas.length, 3);
});
test("09 indisponibilidade: erro 5xx e queda de rede são repetidos com limite; conta sem plano (402) não é repetida", async () => {
  const a = fornecedor({ "/v1/conta": [resp(503, {}), resp(503, {}), resp(200, { ok: 1 })] });
  assert.deepEqual((await clienteSync({ chave: "k", fetch: a.f, ...semEspera }).conta()).corpo, { ok: 1 });
  let n = 0; await assert.rejects(clienteSync({ chave: "k", fetch: async () => { n++; throw new Error("ECONNRESET"); }, maxTentativas: 2, ...semEspera }).conta(), (e) => e.categoria === "indisponivel"); assert.equal(n, 2);
  const p = fornecedor({ "/v1/conta": [resp(402, {})] });
  await assert.rejects(clienteSync({ chave: "k", fetch: p.f, ...semEspera }).conta(), (e) => e.categoria === "plano"); assert.equal(p.chamadas.length, 1);
  assert.throws(() => clienteSync({ chave: "" }), (e) => e.categoria === "sem_credencial");
});

// ---------- operações ----------
test("10 consulta: pagina até o fim, entrega cada item uma vez e fecha a execução com as contagens", async () => {
  const db = banco(); const { f, chamadas } = fornecedor({ "/v1/prazos": [resp(200, { itens: [{ chave: "k1", data_fatal: "2026-11-23", intimacao_ids: ["a1"] }] })],
    "/v1/intimacoes": [resp(200, { itens: [intim("a1"), intim("a2")] }), resp(200, { itens: [intim("a3", { numero_processo: "9000000-00.2026.8.26.0001" })] })] });
  const r = await puxar({ db, cliente: cli(f) });
  assert.equal(r.status, "ok"); assert.deepEqual({ ...r.resumo }, { recebidas: 3, novas: 3, possiveis_duplicatas: 0, repetidas: 0, anexadas: 0, divergentes: 0, sem_processo: 1, quarentena: 0, prazos_sugeridos: 1, paginas: 2, dos_autos: 0 });
  assert.deepEqual(chamadas.filter((c) => c.caminho === "/v1/intimacoes").map((c) => c.params.pagina), ["1", "2"]);
  assert.equal(db.execucoes[0].status, "ok"); assert.equal(db.publicacoes.get("a1").prazos[0].chave, "k1");
});
test("11 evento repetido: a mesma intimação recebida de novo só conta como repetida", async () => {
  const db = banco(); const rotas = () => ({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": [resp(200, { itens: [intim("a1")] })] });
  await puxar({ db, cliente: cli(fornecedor(rotas()).f) }); const r = await puxar({ db, cliente: cli(fornecedor(rotas()).f) });
  assert.equal(r.resumo.repetidas, 1); assert.equal(r.resumo.novas, 0); assert.equal(db.publicacoes.size, 1);
});
test("12 integração desligada: nenhuma chamada ao fornecedor, nada gravado, execução marcada como desligada", async () => {
  const db = banco({ ativo: false }); const { f, chamadas } = fornecedor({});
  assert.equal((await puxar({ db, cliente: cli(f) })).status, "desligada"); assert.equal(chamadas.length, 0); assert.equal(db.publicacoes.size, 0); assert.equal(db.execucoes[0].status, "desligada");
});
test("13 falha no meio: autenticação recusada encerra com erro registrado; o que já entrou fica como parcial", async () => {
  const db = banco(); const a = fornecedor({ "/v1/prazos": [resp(401, {})] }); const r = await puxar({ db, cliente: cli(a.f) });
  assert.equal(r.status, "erro"); assert.equal(r.categoria, "autenticacao"); assert.equal(db.estado.conexao, "erro"); assert.match(db.execucoes[0].erro, /^autenticacao: /);
  const db2 = banco(); const b = fornecedor({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": [resp(200, { itens: [intim("a1"), intim("a2")] }), resp(503, {})] });
  const r2 = await puxar({ db: db2, cliente: () => clienteSync({ chave: "k", fetch: b.f, maxTentativas: 2, ...semEspera }) });
  assert.equal(r2.status, "parcial"); assert.equal(r2.resumo.novas, 2); assert.equal(db2.estado.conexao, "instavel");
});
test("14 item em quarentena não vira publicação e a execução fica parcial; limite de páginas também marca parcial", async () => {
  const db = banco(); const a = fornecedor({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": [resp(200, { itens: [{ id: "q1", texto: "sem processo" }] })] });
  const r = await puxar({ db, cliente: cli(a.f) }); assert.equal(r.status, "parcial"); assert.equal(r.resumo.quarentena, 1); assert.equal(db.publicacoes.size, 0); assert.deepEqual(db.quarentena[0].p_campos, ["id", "texto"]);
  const db2 = banco({ config: { max_paginas: 2, itens_por_pagina: 1, contrato_confirmado: true } }); let n = 0;
  const b = fornecedor({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": () => resp(200, { itens: [intim("p" + ++n)] }) });
  const r2 = await puxar({ db: db2, cliente: cli(b.f) }); assert.equal(r2.status, "parcial"); assert.equal(r2.resumo.paginas, 2);
});
test("15 texto cortado na lista (600 caracteres): busca o inteiro; se a busca falhar, segue com o que tem", async () => {
  const curto = "x".repeat(600), inteiro = "x".repeat(600) + " continuação";
  const db = banco(); const a = fornecedor({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": [resp(200, { itens: [intim("a1", { texto: curto })] })], "/v1/intimacoes/a1": [resp(200, intim("a1", { texto: inteiro }))] });
  await puxar({ db, cliente: cli(a.f) }); assert.equal(db.publicacoes.get("a1").texto, inteiro);
  const db2 = banco(); const b = fornecedor({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": [resp(200, { itens: [intim("a1", { texto: curto })] })] });
  await puxar({ db: db2, cliente: cli(b.f) }); assert.equal(db2.publicacoes.get("a1").texto_cortado, true);
});
test("16 teste de conexão funciona com a integração desligada e não toca em publicações", async () => {
  const db = banco({ ativo: false }); const a = fornecedor({ "/v1/conta": [resp(200, { nome: "Conta fictícia" })] });
  assert.deepEqual(await testarConexao({ db, cliente: cli(a.f) }), { ok: true }); assert.equal(db.estado.conexao, "ok"); assert.ok(!db.chamadas.includes("sync_receber_intimacao"));
  const db2 = banco({ ativo: false }); assert.deepEqual(await testarConexao({ db: db2, cliente: () => clienteSync({ chave: "" }) }), { ok: false, categoria: "sem_credencial" });
});
test("17 webhook inválido: 401, corpo não guardado, fornecedor não consultado; sem segredo configurado nada é aceito", async () => {
  const db = banco(); const { f, chamadas } = fornecedor({});
  const r = await receberWebhook({ db, cliente: cli(f), corpoBruto: '{"evento":"intimacao.criada"}', assinatura: "00ff", segredo: "s" });
  assert.equal(r.http, 401); assert.equal(chamadas.length, 0); assert.equal([...db.eventos.values()][0].corpo, null);
  assert.equal((await receberWebhook({ db, cliente: cli(f), corpoBruto: "{}", assinatura: "qualquer", segredo: "" })).http, 401);
});
test("18 webhook válido dispara a consulta; o MESMO webhook de novo não reprocessa; com a integração desligada é ignorado", async () => {
  const corpo = '{"evento":"intimacao.criada","intimacao_id":"a1"}', seg = "s", ass = createHmac("sha256", seg).update(corpo).digest("hex");
  const db = banco(); const a = fornecedor({ "/v1/prazos": [resp(200, { itens: [] })], "/v1/intimacoes": [resp(200, { itens: [intim("a1")] })] });
  const r = await receberWebhook({ db, cliente: cli(a.f), corpoBruto: corpo, assinatura: ass, segredo: seg });
  assert.equal(r.http, 200); assert.equal(r.status, "processado"); assert.equal(db.publicacoes.size, 1); assert.equal([...db.eventos.values()][0].tipo, "intimacao.criada");
  const n = a.chamadas.length; const r2 = await receberWebhook({ db, cliente: cli(a.f), corpoBruto: corpo, assinatura: ass, segredo: seg });
  assert.equal(r2.status, "repetido"); assert.equal(a.chamadas.length, n);
  const off = banco({ ativo: false }); const b = fornecedor({});
  assert.equal((await receberWebhook({ db: off, cliente: cli(b.f), corpoBruto: corpo, assinatura: ass, segredo: seg })).status, "ignorado_desligada"); assert.equal(b.chamadas.length, 0);
});
test("19 enxurrada de webhooks forjados: 50 corpos diferentes na mesma hora geram UM registro, sem conteúdo, e nenhuma consulta", async () => {
  const db = banco(); const { f, chamadas } = fornecedor({}); const agora = () => new Date("2026-11-17T22:10:00Z");
  for (let i = 0; i < 50; i++) assert.equal((await receberWebhook({ db, cliente: cli(f), corpoBruto: `{"n":${i},"dado":"sigiloso"}`, assinatura: "ff" + i, segredo: "s", agora })).http, 401);
  assert.equal(db.eventos.size, 1); assert.equal([...db.eventos.keys()][0], "inv:2026-11-17T22"); assert.equal(chamadas.length, 0); assert.ok(!JSON.stringify([...db.eventos.values()]).includes("sigiloso"));
});
test("20 a chave só vai ao endereço do fornecedor: sem seguir redirecionamento, com tempo limite por pedido", async () => {
  let init = null; const f = async (url, i) => { init = { url, ...i }; return resp(200, {}); };
  await clienteSync({ chave: "k", fetch: f, ...semEspera }).conta();
  assert.equal(new URL(init.url).origin, "https://api.sync.atendedireito.app"); assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
});
test("21 sem o contrato confirmado NÃO há ingestão: integração ligada, mas nenhuma chamada e nenhuma publicação até alguém conferir o formato real", async () => {
  const db = banco({ config: { janela_dias: 7 } }); const { f, chamadas } = fornecedor({ "/v1/intimacoes": [resp(200, { itens: [intim("a1")] })] });
  const r = await puxar({ db, cliente: cli(f) });
  assert.equal(r.status, "aguardando_contrato"); assert.equal(chamadas.length, 0); assert.equal(db.publicacoes.size, 0); assert.match(db.execucoes[0].erro, /^contrato: /);
});
test("22 amostra para confirmar o contrato: devolve só nomes de campo e tipos, nunca o conteúdo; não grava publicação; funciona com a integração desligada", async () => {
  const db = banco({ ativo: false }); const { f, chamadas } = fornecedor({ "/v1/intimacoes": [resp(200, { dados: [{ uuid: "x9", autos: { cnj: "0001234-56.2026.8.26.0100" }, quando: "2026-11-16T10:00:00Z", conteudo: "TEXTO SIGILOSO" }], total: 1 })], "/v1/prazos": [resp(200, { dados: [] })] });
  const r = await amostrar({ db, cliente: cli(f), itens: 50 });
  assert.equal(r.ok, true); assert.deepEqual(r.forma.intimacoes, { dados: [{ autos: { cnj: "texto" }, conteudo: "texto", quando: "texto(data)", uuid: "texto" }], total: "número" });
  assert.deepEqual(r.mapeamento_candidato, [{ faltando: ["id_externo", "numero_processo", "data_publicacao"] }]);
  assert.ok(!JSON.stringify(r).includes("SIGILOSO") && !JSON.stringify(r).includes("0001234")); assert.equal(chamadas[0].params.itens, "5"); assert.ok(!db.chamadas.includes("sync_receber_intimacao"));
});

// ---- prazos dos autos (sem intimação) ----
import { prazosDosAutos } from "./adaptador.mjs";
test("prazos dos autos: ato sem intimação vira entrada própria com as hipóteses", () => {
  const itens = [
    { chave: "k1", intimacao_ids: [], processo: "4002020-82.2026.8.26.0292", data: "2026-11-02", data_fatal: "2026-11-25", prazo_ato: "Manifestação", previa: "texto do ato", tribunal: "TJSP", estado: "aberta", costura: { id: "c1", prazos: [{ chave: "k1", rotulo: "Manifestação", data_fatal: "2026-11-25" }, { chave: "k2", rotulo: "Recurso", data_fatal: "2026-12-01" }] } },
    { chave: "k2", intimacao_ids: [], processo: "4002020-82.2026.8.26.0292", data: "2026-11-02", data_fatal: "2026-12-01", estado: "aberta", costura: { id: "c1", prazos: [{ chave: "k1", data_fatal: "2026-11-25" }, { chave: "k2", data_fatal: "2026-12-01" }] } },
    { chave: "k3", intimacao_ids: [77], processo: "4002020-82.2026.8.26.0292", data: "2026-11-02", data_fatal: "2026-12-05", estado: "aberta" },
    { chave: "k4", intimacao_ids: [], processo: "4002020-82.2026.8.26.0292", data: "2026-11-03", data_fatal: "2026-12-06", estado: "desmarcada" },
    { chave: "k5", intimacao_ids: [], processo: "sem número", data: "2026-11-03", data_fatal: "2026-12-06", estado: "aberta" },
  ];
  const r = prazosDosAutos(itens);
  assert.equal(r.length, 2);
  assert.equal(r[0].ok, true); assert.equal(r[0].item.id_externo, "autos:c1"); assert.equal(r[0].item.numero_processo, "4002020-82.2026.8.26.0292");
  assert.equal(r[0].item.data_publicacao, "2026-11-02"); assert.deepEqual(r[0].item.prazos.map((p) => [p.chave, p.data_fatal]), [["k1", "2026-11-25"], ["k2", "2026-12-01"]]);
  assert.match(r[0].item.texto, /^\[Ato dos autos/);
  assert.equal(r[1].ok, false); assert.deepEqual(r[1].faltando, ["numero_processo"]);
});

// ---- carteira (autos por processo) ----
import { mapearProcesso, puxarCarteira } from "./adaptador.mjs";
test("carteira: mapeia o detalhe do processo e descobre o nosso lado pelo advogado", () => {
  const det = { numero: "4010284-64.2026.8.26.0009", tribunal: "TJSP", classe: "Procedimento Comum", assunto: "Superendividamento", valor_causa: 1621, data_distribuicao: "2026-07-15T00:00:00", grau: "G1",
    polo_ativo: "Fulana", advogados_ativo: "Maria Julia Neves De Padua", polo_passivo: "Banco X", advogados_passivo: "Beltrano", ultima_decisao: "2026-11-16", ultima_sincronizacao: "2026-11-24T17:46:00Z",
    partes: [{ polo: "ativo", nome: "Fulana", cpf_cnpj: "111", tipo_pessoa: "fisica", advogados: "MJ", sigiloso: false }], movimentos: [{ data: "2026-11-20", descricao: "Juntada", grau: "G1" }, { data: "2026-11-24", descricao: "Conclusos", grau: "G1" }],
    documentos: [{ id: 9, tipo: "PETIÇÃO", nome: "a.pdf", data_juntada: "2026-11-20", tem_markdown: true }], audiencias: [] };
  const m = mapearProcesso(det, [{ data_audiencia: "2026-12-03T14:00:00", descricao: "Conciliação" }]);
  assert.equal(m.numero, "40102846420268260009"); assert.equal(m.polo, "ativo"); assert.equal(m.parte_contraria, "Banco X"); assert.equal(m.advogado_contrario, "Beltrano");
  assert.equal(m.capa.valor_causa, 1621); assert.equal(m.capa.data_distribuicao, "2026-07-15"); assert.equal(m.ultimo_andamento, "2026-11-24");
  assert.deepEqual(m.audiencias, [{ data: "2026-12-03T14:00:00", descricao: "Conciliação" }]); assert.equal(m.documentos[0].lido, true);
  assert.equal(mapearProcesso({ numero: "123" }), null);
});
test("carteira: só busca o detalhe do que está na base e desatualizado; respeita o limite", async () => {
  const pedidos = [], gravados = [];
  const lista = [{ numero: "0000001-11.2026.8.26.0001", ultima_sincronizacao: "2026-11-24T10:00:00Z" }, { numero: "0000002-22.2026.8.26.0001", ultima_sincronizacao: "2026-11-24T10:00:00Z" },
    { numero: "0000003-33.2026.8.26.0001", ultima_sincronizacao: "2026-11-20T10:00:00Z" }, { numero: "0000004-44.2026.8.26.0001", ultima_sincronizacao: "2026-11-24T10:00:00Z" }];
  const api = { get: async (c) => { pedidos.push(c); if (c === "/v1/processos") return { corpo: { processos: lista } }; if (c === "/v1/dashboard") return { corpo: {} }; return { corpo: { numero: c.split("/").pop(), movimentos: [], documentos: [], partes: [] } }; } };
  const db = { rpc: async (n, a) => n === "sync_config_ler" ? { ativo: true, config: { contrato_confirmado: true } } : n === "sync_carteira_estado" ? { "00000011120268260001": null, "00000033320268260001": "2026-11-21T00:00:00Z", "00000044420268260001": "2026-11-23T00:00:00Z" } : (gravados.push(a.p.numero), "ok") };
  const r = await puxarCarteira({ db, cliente: () => api, limite: 1, paralelo: 1 });
  assert.equal(r.status, "ok"); assert.deepEqual(r.resumo, { na_carteira: 4, fora_da_base: 1, em_dia: 1, atualizados: 1, capas_preenchidas: 0, erros: 0, restantes: 1 });
  assert.equal(gravados.length, 1); assert.equal(pedidos.filter((c) => /^\/v1\/processos\/\d/.test(c)).length, 1);
});
