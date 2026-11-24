// Adaptador do AtendeDireito Sync — módulo puro (sem Deno, sem Supabase), usado pela Edge Function "sync" e pelos testes.
//
// CONTRATO LIDO em 17/11/2026 no OpenAPI oficial (https://api.sync.atendedireito.app/openapi.json, "Sync API" 1.0.0):
//   · servidor https://api.sync.atendedireito.app · autenticação "Authorization: Bearer <chave>" · toda resposta traz X-Request-Id
//   · GET /v1/conta · GET /v1/intimacoes (status, dias, pagina, itens ≤ 200; "texto" cortado em 600 caracteres)
//   · GET /v1/intimacoes/{id} (texto integral) · GET /v1/prazos (estado, dias, pagina, itens ≤ 100; itens com data_fatal, chave,
//     intimacao_ids e costura.prazos[{chave, rotulo, data_fatal, restricao, marcado}])
//   · webhooks: segredo → HMAC-SHA256 no cabeçalho X-Webhook-Signature; reenvio com espera crescente
//
// O QUE O CONTRATO NÃO DIZ (os corpos de resposta estão sem esquema no OpenAPI). Nada disso é presumido como certo:
//   (1) os nomes dos campos de número do processo, data de publicação, tribunal e link dentro de uma intimação;
//   (2) a chave que embrulha a lista nas respostas paginadas;
//   (3) o formato do corpo do webhook e a codificação da assinatura (hexadecimal ou base64);
//   (4) os limites de requisição.
// Tratamento: para (1) e (2) há uma lista de NOMES CANDIDATOS, ajustável em integracoes.config.mapa sem novo código; se nenhum
// candidato existir no item, o item vai para QUARENTENA (não vira publicação) e o nome dos campos recebidos fica registrado para
// ajuste. Para (3), o webhook é tratado só como AVISO: o conteúdo é buscado pela API (fonte de verdade) e a assinatura é aceita
// em hexadecimal ou base64. Para (4), respeita-se o 429 e o cabeçalho Retry-After, com teto de tentativas.
// A primeira chamada real (homologação com conta ativa) serve para confirmar ou corrigir estes candidatos.

export const BASE = "https://api.sync.atendedireito.app";

export const MAPA_PADRAO = Object.freeze({
  // documentado
  id: ["id"],
  texto: ["texto", "texto_previa"],
  tipo_ato: ["tipo_ato"],
  estado_fonte: ["obrigacao_estado"],
  // NÃO documentado — candidatos (ver cabeçalho)
  numero_processo: ["numero_processo", "processo", "numero", "numero_cnj", "cnj", "processo_numero"],
  data_publicacao: ["data_publicacao", "data_disponibilizacao", "publicada_em", "disponibilizada_em", "data"],
  tribunal: ["tribunal", "sigla_tribunal"],
  orgao: ["orgao", "orgao_julgador", "vara"],
  link: ["link", "url", "link_documento"],
  djen_id: ["djen_id", "id_djen", "comunicacao_id", "id_comunicacao"],
  lista: ["itens", "intimacoes", "prazos", "dados", "data", "resultados", "items"],
  id_no_evento: ["intimacao_id", "id_intimacao"],
  tipo_evento: ["evento", "tipo", "event", "type"],
});

export class ErroSync extends Error {
  constructor(categoria, mensagem, extra = {}) { super(mensagem); this.name = "ErroSync"; this.categoria = categoria; Object.assign(this, extra); }
}

const CNJ = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/;
const primeiro = (obj, nomes) => { for (const n of nomes || []) { const v = obj?.[n]; if (v !== undefined && v !== null && v !== "") return v; } return undefined; };
const comoData = (v) => { if (v === undefined || v === null) return null; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const b = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return b ? `${b[3]}-${b[2]}-${b[1]}` : null; };
const mapaDe = (cfg) => ({ ...MAPA_PADRAO, ...(cfg && typeof cfg === "object" ? cfg : {}) });

// ---------- 1. fornecedor → formato do sistema ----------
// Devolve { ok: true, item } pronto para a rpc sync_receber_intimacao, ou { ok: false, faltando, campos } (quarentena).
export function mapearIntimacao(bruto, mapaCfg, prazos = []) {
  const m = mapaDe(mapaCfg);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false, faltando: ["item"], campos: [] };
  const id = primeiro(bruto, m.id);
  let numero = primeiro(bruto, m.numero_processo);
  if (numero && typeof numero === "object") numero = primeiro(numero, ["numero", "numero_cnj", "cnj"]);   // processo aninhado
  const achado = numero !== undefined ? String(numero).match(CNJ) : null;
  const data = comoData(primeiro(bruto, m.data_publicacao));
  const faltando = [];
  if (id === undefined) faltando.push("id_externo");
  if (!achado) faltando.push("numero_processo");
  if (!data) faltando.push("data_publicacao");
  if (faltando.length) return { ok: false, faltando, campos: Object.keys(bruto).sort() };
  const dest = bruto.destinatarios && typeof bruto.destinatarios === "object" ? bruto.destinatarios : {};
  const djen = primeiro(bruto, m.djen_id);
  return {
    ok: true,
    item: {
      id_externo: String(id),
      numero_processo: achado[0],
      data_publicacao: data,
      texto: String(primeiro(bruto, m.texto) ?? ""),
      tipo_ato: primeiro(bruto, m.tipo_ato) ?? null,
      tribunal: primeiro(bruto, m.tribunal) ?? null,
      orgao: primeiro(bruto, m.orgao) ?? null,
      link: primeiro(bruto, m.link) ?? null,
      djen_id: djen !== undefined && /^\d+$/.test(String(djen)) ? String(djen) : null,
      estado_fonte: primeiro(bruto, m.estado_fonte) ?? null,
      destinatarios: Array.isArray(dest.intimados) ? dest.intimados : [],
      advogados: Array.isArray(dest.advogados) ? dest.advogados : [],
      prazos: prazos.filter((p) => p && p.chave).map((p) => ({ chave: String(p.chave), rotulo: p.rotulo ?? null, data_fatal: comoData(p.data_fatal), restricao: p.restricao ?? null, marcado: p.marcado ?? null })),
      bruto,
    },
  };
}

// Itens de GET /v1/prazos → { id da intimação: [hipóteses de prazo] }. Tudo entra no sistema como SUGESTÃO.
export function prazosPorIntimacao(itens) {
  const por = new Map();
  for (const it of itens || []) {
    const hipoteses = Array.isArray(it?.costura?.prazos) && it.costura.prazos.length ? it.costura.prazos : (it?.chave ? [{ chave: it.chave, rotulo: it.rotulo, data_fatal: it.data_fatal }] : []);
    for (const iid of Array.isArray(it?.intimacao_ids) ? it.intimacao_ids : []) {
      const k = String(iid); const atual = por.get(k) || [];
      for (const h of hipoteses) if (h?.chave && !atual.some((a) => a.chave === h.chave)) atual.push(h);
      por.set(k, atual);
    }
  }
  return por;
}

// Prazos que o Sync calculou a partir dos AUTOS (documento juntado) e que ainda não têm intimação no diário: intimacao_ids vazio.
// Sem isto eles não entravam no sistema (o prazo só chegava pendurado numa intimação). Cada ATO (costura.id) vira uma entrada
// própria, com o texto marcado como "dos autos", e as hipóteses de prazo seguem como SUGESTÃO, igual às das intimações.
// Prazo desmarcado no Sync não entra. Quando o diário publicar o mesmo ato, a intimação chega pelo caminho normal.
export function prazosDosAutos(itens) {
  const porAto = new Map();
  for (const it of itens || []) {
    if (!it || typeof it !== "object") continue;
    if (Array.isArray(it.intimacao_ids) && it.intimacao_ids.length) continue;
    if (it.estado === "desmarcada" || it.desmarcado_em) continue;
    const ato = it?.costura?.id ?? it.chave; if (ato === undefined || ato === null || ato === "") continue;
    const k = String(ato); const g = porAto.get(k) || { base: it, hip: [] };
    const hipoteses = Array.isArray(it?.costura?.prazos) && it.costura.prazos.length ? it.costura.prazos : (it.chave ? [{ chave: it.chave, rotulo: it.prazo_ato ?? it.tipo_ato ?? null, data_fatal: it.data_fatal }] : []);
    for (const h of hipoteses) if (h?.chave && !g.hip.some((x) => x.chave === h.chave)) g.hip.push(h);
    porAto.set(k, g);
  }
  const saida = [];
  for (const [k, g] of porAto) {
    const it = g.base; const achado = it.processo !== undefined && it.processo !== null ? String(typeof it.processo === "object" ? (it.processo.numero ?? it.processo.numero_cnj ?? "") : it.processo).match(CNJ) : null;
    const data = comoData(it.data) || comoData(it.capturado_em);
    if (!achado || !data || !g.hip.length) { saida.push({ ok: false, faltando: [!achado ? "numero_processo" : null, !data ? "data_publicacao" : null, !g.hip.length ? "prazo" : null].filter(Boolean), campos: Object.keys(it).sort() }); continue; }
    const corpo = String(it.previa ?? it.resumo ?? it.prazo_ato ?? "").trim();
    saida.push({ ok: true, item: {
      id_externo: "autos:" + k, numero_processo: achado[0], data_publicacao: data,
      texto: "[Ato dos autos, ainda sem publicação no diário] " + (it.prazo_ato && !corpo.includes(String(it.prazo_ato)) ? String(it.prazo_ato) + ". " : "") + corpo,
      tipo_ato: it.tipo_ato ?? it?.costura?.tipo_ato ?? null, tribunal: it.tribunal ?? null, orgao: it.orgao ?? null, link: null, djen_id: null, estado_fonte: it.estado ?? null,
      destinatarios: [], advogados: [],
      prazos: g.hip.map((p) => ({ chave: String(p.chave), rotulo: p.rotulo ?? it.prazo_ato ?? null, data_fatal: comoData(p.data_fatal), restricao: p.restricao ?? null, marcado: p.marcado ?? null })),
      bruto: it,
    } });
  }
  return saida;
}

export function extrairLista(corpo, mapaCfg) {
  if (Array.isArray(corpo)) return corpo;
  const m = mapaDe(mapaCfg);
  for (const k of m.lista) if (Array.isArray(corpo?.[k])) return corpo[k];
  throw new ErroSync("formato", "Resposta em formato não reconhecido (lista não encontrada).", { campos: corpo && typeof corpo === "object" ? Object.keys(corpo).sort() : [] });
}

// ---------- 2. assinatura do webhook ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const igualTempoConstante = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function sha256(texto) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(texto))); }

// Confere HMAC-SHA256(segredo, corpo exatamente como chegou). Sem segredo configurado, NADA é aceito.
export async function verificarAssinatura(segredo, corpoBruto, cabecalho) {
  if (!segredo || !cabecalho || typeof corpoBruto !== "string") return false;
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", chave, enc.encode(corpoBruto));
  const recebido = String(cabecalho).trim().replace(/^sha256=/i, "");
  return igualTempoConstante(recebido.toLowerCase(), hex(mac)) || igualTempoConstante(recebido, b64(mac));
}

// ---------- 3. cliente REST ----------
// opções: chave (obrigatória), fetch, base, maxTentativas (padrão 4), esperaBaseMs (padrão 500), esperar(ms), limiteEsperaMs, tempoLimiteMs (padrão 15 s por pedido)
export function clienteSync({ chave, fetch: f = globalThis.fetch, base = BASE, maxTentativas = 4, esperaBaseMs = 500, limiteEsperaMs = 20000, tempoLimiteMs = 15000, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!chave) throw new ErroSync("sem_credencial", "Chave de acesso não configurada no servidor.");
  async function get(caminho, params = {}) {
    const u = new URL(caminho, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    let ultimo = null;
    for (let t = 1; t <= maxTentativas; t++) {
      let r;
      try { r = await f(u.toString(), { method: "GET", headers: { Authorization: `Bearer ${chave}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(tempoLimiteMs) }); }   // sem seguir redirecionamento: a chave só vai ao endereço do fornecedor
      catch (e) { ultimo = new ErroSync("indisponivel", "Fornecedor inacessível (rede).", { tentativas: t }); if (t < maxTentativas) { await esperar(Math.min(esperaBaseMs * 2 ** (t - 1), limiteEsperaMs)); continue; } throw ultimo; }
      const pedido = r.headers?.get?.("x-request-id") || null;
      if (r.ok) { try { return { corpo: await r.json(), pedido }; } catch { throw new ErroSync("formato", "Resposta que não é JSON.", { status: r.status, pedido }); } }
      // credencial ou plano: não adianta repetir — parar e avisar
      if (r.status === 401 || r.status === 403) throw new ErroSync("autenticacao", "Chave recusada pelo fornecedor.", { status: r.status, pedido });
      if (r.status === 402) throw new ErroSync("plano", "Conta sem plano ativo no fornecedor.", { status: r.status, pedido });
      if (r.status === 404) throw new ErroSync("nao_encontrado", "Registro não encontrado no fornecedor.", { status: 404, pedido });
      if (r.status === 429 || r.status >= 500) {
        ultimo = new ErroSync(r.status === 429 ? "limite" : "indisponivel", r.status === 429 ? "Limite de requisições do fornecedor atingido." : "Fornecedor indisponível.", { status: r.status, pedido, tentativas: t });
        if (t < maxTentativas) {
          const ra = Number(r.headers?.get?.("retry-after"));
          await esperar(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : esperaBaseMs * 2 ** (t - 1), limiteEsperaMs));
          continue;
        }
        throw ultimo;
      }
      throw new ErroSync("recusada", "Requisição recusada pelo fornecedor.", { status: r.status, pedido });
    }
    throw ultimo;
  }
  // ÚNICA escrita no fornecedor: criar monitor (sem repetição automática, para não criar em dobro)
  async function post(caminho, corpo) {
    let r;
    try { r = await f(new URL(caminho, base).toString(), { method: "POST", headers: { Authorization: `Bearer ${chave}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(corpo ?? {}), redirect: "error", signal: AbortSignal.timeout(tempoLimiteMs) }); }
    catch (_e) { throw new ErroSync("indisponivel", "Fornecedor inacessível (rede).", {}); }
    const pedido = r.headers?.get?.("x-request-id") || null;
    if (r.ok) { try { return { corpo: await r.json(), pedido }; } catch { return { corpo: null, pedido }; } }
    if (r.status === 401 || r.status === 403) throw new ErroSync("autenticacao", "Chave recusada pelo fornecedor.", { status: r.status, pedido });
    if (r.status === 402) throw new ErroSync("plano", "Conta sem plano ativo ou limite do plano atingido.", { status: 402, pedido });
    throw new ErroSync(r.status === 429 ? "limite" : r.status >= 500 ? "indisponivel" : "recusada", "Requisição recusada pelo fornecedor.", { status: r.status, pedido });
  }
  return {
    get, post,
    conta: () => get("/v1/conta"),
    intimacoes: (p) => get("/v1/intimacoes", p),
    intimacao: (id) => get(`/v1/intimacoes/${encodeURIComponent(id)}`),
    prazos: (p) => get("/v1/prazos", p),
  };
}

// ---------- 4. operações ----------
// db = { rpc(nome, args) → Promise<valor> }  (na Edge Function: chamadas com a chave de serviço, que nunca sai do servidor)
const CONTAGEM = () => ({ recebidas: 0, novas: 0, possiveis_duplicatas: 0, repetidas: 0, anexadas: 0, divergentes: 0, sem_processo: 0, quarentena: 0, prazos_sugeridos: 0, paginas: 0, dos_autos: 0 });
function contar(c, r) {
  c.recebidas++;
  if (r?.acao === "nova") c.novas++; else if (r?.acao === "nova_possivel_duplicata") { c.novas++; c.possiveis_duplicatas++; }
  else if (r?.acao === "repetida") c.repetidas++; else if (r?.acao === "anexada") c.anexadas++; else if (r?.acao === "divergente") c.divergentes++;
  else if (r?.acao === "quarentena") c.quarentena++;
  if (r?.sem_processo) c.sem_processo++;
  c.prazos_sugeridos += r?.prazos_novos || 0;
}
const erroCurto = (e) => `${e?.categoria || "erro"}: ${String(e?.message || e).slice(0, 200)}${e?.pedido ? ` (pedido ${e.pedido})` : ""}`;   // sem conteúdo de processo, sem credencial

async function integracao(db) { const i = await db.rpc("sync_config_ler", {}); return { ativo: !!i?.ativo, config: i?.config || {} }; }

// Teste de conexão: funciona com a integração DESLIGADA (não lê nem grava nada de processos).
export async function testarConexao({ db, cliente }) {
  const ex = await db.rpc("sync_execucao_abrir", { p_origem: "teste_conexao" });
  try {
    const { pedido } = await cliente().conta();
    await db.rpc("sync_estado_gravar", { p_estado: { conexao: "ok", pedido } });
    await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: "ok", p_resumo: { conexao: "ok" } });
    return { ok: true };
  } catch (e) {
    await db.rpc("sync_estado_gravar", { p_estado: { conexao: "erro", categoria: e?.categoria || "erro" } });
    await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: "erro", p_erro: erroCurto(e) });
    return { ok: false, categoria: e?.categoria || "erro" };
  }
}

// Amostra para CONFIRMAR O CONTRATO: consulta poucos registros e devolve só a FORMA (nomes de campo e tipo de cada valor),
// nunca o conteúdo. Não grava publicação. Funciona com a integração desligada. É o segundo passo do primeiro teste real,
// depois do teste de conexão.
const forma = (v, nivel = 0) => v === null ? "nulo" : Array.isArray(v) ? (v.length && nivel < 5 ? [forma(v[0], nivel + 1)] : "lista") : typeof v === "object" ? (nivel < 5 ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, forma(v[k], nivel + 1)])) : "objeto")
  : typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}/.test(v) ? "texto(data)" : /^\d+$/.test(v) ? "texto(número)" : "texto") : typeof v === "number" ? "número" : typeof v === "boolean" ? "lógico" : typeof v;
export async function amostrar({ db, cliente, itens = 3, dias = 7 }) {
  const ex = await db.rpc("sync_execucao_abrir", { p_origem: "teste_conexao" });
  try {
    const api = cliente(); const n = Math.min(Math.max(Number(itens) || 3, 1), 5);
    const i = await api.intimacoes({ status: "todas", dias, pagina: 1, itens: n }); const z = await api.prazos({ estado: "todas", dias, pagina: 1, itens: n });
    const r = { intimacoes: forma(i.corpo), prazos: forma(z.corpo) };
    let reconhecidos = null; try { const l = extrairLista(i.corpo); reconhecidos = l.slice(0, n).map((b) => { const m = mapearIntimacao(b); return m.ok ? "reconhecido" : { faltando: m.faltando }; }); } catch (e) { reconhecidos = { erro: e?.categoria || "formato" }; }
    await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: "ok", p_resumo: { amostra: true, registros: Array.isArray(reconhecidos) ? reconhecidos.length : 0 } });
    return { ok: true, forma: r, mapeamento_candidato: reconhecidos };
  } catch (e) {
    await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: "erro", p_erro: erroCurto(e) });
    return { ok: false, categoria: e?.categoria || "erro" };
  }
}

// Consulta periódica ou manual. Com a integração desligada: não chama o fornecedor, não grava publicações.
export async function puxar({ db, cliente, origem = "manual", por = null }) {
  const { ativo, config } = await integracao(db);
  const ex = await db.rpc("sync_execucao_abrir", { p_origem: origem, p_por: por });
  if (!ativo) return { status: "desligada", execucao: ex };
  // Os nomes de campo deste adaptador são CANDIDATOS, não contrato. Nenhuma ingestão acontece antes de alguém conferir o formato
  // real (função amostrar) e registrar isso em integracoes.config.contrato_confirmado = true.
  if (config.contrato_confirmado !== true) { await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: "erro", p_erro: "contrato: formato real das respostas ainda não confirmado" }); return { status: "aguardando_contrato", execucao: ex }; }
  const c = CONTAGEM(); const dias = Math.min(Math.max(Number(config.janela_dias) || 7, 1), 60);
  const maxPag = Math.min(Math.max(Number(config.max_paginas) || 5, 1), 50);
  const itensInt = Math.min(Math.max(Number(config.itens_por_pagina) || 100, 1), 200), itensPz = Math.min(itensInt, 100);
  let parcial = false;
  try {
    const api = cliente();
    // prazos primeiro, para chegarem junto com a intimação (sempre como sugestão)
    const brutoPz = [];
    for (let p = 1; p <= maxPag; p++) { const l = extrairLista((await api.prazos({ estado: "todas", dias, pagina: p, itens: itensPz })).corpo, config.mapa); brutoPz.push(...l); if (l.length < itensPz) break; if (p === maxPag) parcial = true; }
    const pz = prazosPorIntimacao(brutoPz);
    for (let p = 1; p <= maxPag; p++) {
      const l = extrairLista((await api.intimacoes({ status: "todas", dias, pagina: p, itens: itensInt })).corpo, config.mapa); c.paginas++;
      for (const bruto of l) await entregar({ db, api, bruto, config, pz, c, ex });
      if (l.length < itensInt) break; if (p === maxPag) parcial = true;   // limite de páginas: fica registrado como "parcial"
    }
    for (const m of prazosDosAutos(brutoPz)) {
      if (!m.ok) { contar(c, { acao: "quarentena" }); await db.rpc("sync_quarentena_registrar", { p_execucao: ex, p_faltando: m.faltando, p_campos: m.campos }); continue; }
      contar(c, await db.rpc("sync_receber_intimacao", { p: m.item, p_execucao: ex })); c.dos_autos++;
    }
    const status = parcial || c.quarentena ? "parcial" : "ok";
    await db.rpc("sync_estado_gravar", { p_estado: { conexao: "ok", ultima_sincronizacao: status } });
    await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: status, p_resumo: c });
    return { status, execucao: ex, resumo: c };
  } catch (e) {
    await db.rpc("sync_estado_gravar", { p_estado: { conexao: e?.categoria === "autenticacao" || e?.categoria === "plano" ? "erro" : "instavel", categoria: e?.categoria || "erro" } });
    await db.rpc("sync_execucao_fechar", { p_id: ex, p_status: c.recebidas ? "parcial" : "erro", p_resumo: c, p_erro: erroCurto(e) });
    return { status: c.recebidas ? "parcial" : "erro", execucao: ex, resumo: c, categoria: e?.categoria || "erro" };
  }
}

async function entregar({ db, api, bruto, config, pz, c, ex }) {
  let m = mapearIntimacao(bruto, config.mapa, pz.get(String(primeiro(bruto, mapaDe(config.mapa).id))) || []);
  if (!m.ok) { contar(c, { acao: "quarentena" }); await db.rpc("sync_quarentena_registrar", { p_execucao: ex, p_faltando: m.faltando, p_campos: m.campos }); return; }
  // a lista corta o texto em 600 caracteres: quando parece cortado, busca o inteiro (falhou → segue com o que tem e marca)
  if (m.item.texto.length >= 600) {
    try { const cheio = mapearIntimacao((await api.intimacao(m.item.id_externo)).corpo, config.mapa, m.item.prazos); if (cheio.ok && cheio.item.texto.length >= m.item.texto.length) m = cheio; }
    catch (e) { if (e?.categoria === "autenticacao" || e?.categoria === "plano") throw e; m.item.texto_cortado = true; }
  }
  contar(c, await db.rpc("sync_receber_intimacao", { p: m.item, p_execucao: ex }));
}

// Webhook. O corpo NÃO é tratado como fonte de dados (formato não documentado): serve de aviso; o conteúdo vem da API.
// Respostas: 401 assinatura inválida/ausente · 200 repetido · 200 ignorado (integração desligada) · 200 processado · 202 aceito com falha de consulta
export async function receberWebhook({ db, cliente, corpoBruto, assinatura, segredo, agora = () => new Date() }) {
  const ok = await verificarAssinatura(segredo, corpoBruto, assinatura);
  const impressao = await sha256(corpoBruto || "");
  // Assinatura inválida: recusa e anota no máximo UM registro por hora (com contador), sem o corpo — uma enxurrada de pedidos
  // forjados não enche o banco nem deixa conteúdo de terceiros guardado.
  if (!ok) { await db.rpc("sync_evento_registrar", { p_canal: "webhook", p_tipo: null, p_impressao: `inv:${agora().toISOString().slice(0, 13)}`, p_assinatura_ok: false, p_corpo: null }); return { http: 401, status: "assinatura_invalida" }; }
  let corpo = null; try { corpo = JSON.parse(corpoBruto); } catch { /* corpo que não é JSON: ainda vale como aviso */ }
  const { ativo, config } = await integracao(db); const m = mapaDe(config.mapa);
  const tipo = corpo && typeof corpo === "object" ? primeiro(corpo, m.tipo_evento) ?? null : null;
  const ev = await db.rpc("sync_evento_registrar", { p_canal: "webhook", p_tipo: typeof tipo === "string" ? tipo.slice(0, 80) : null, p_impressao: impressao, p_assinatura_ok: true, p_corpo: corpo });
  if (ev?.status === "repetido") return { http: 200, status: "repetido" };
  if (!ativo || ev?.status === "ignorado_desligada") return { http: 200, status: "ignorado_desligada" };
  const r = await puxar({ db, cliente, origem: "webhook" });
  await db.rpc("sync_evento_concluir", { p_id: ev.id, p_status: r.status === "erro" ? "erro" : "processado", p_resultado: { execucao: r.execucao, resumo: r.resumo || {} }, p_erro: r.status === "erro" ? r.categoria : null });
  return { http: r.status === "erro" ? 202 : 200, status: r.status === "erro" ? "aceito_com_falha" : "processado", resumo: r.resumo };
}


// ---------- carteira: o que o Sync lê DOS AUTOS de cada processo (capa, partes, movimentos, documentos, audiências) ----------
// Um retrato por processo, gravado por sync_receber_processo. Não cria andamento, tarefa nem aviso; a capa só preenche campo vazio.
const NOSSO = /neves\s+de\s+p[aá]dua|488\.?803/i;   // advogado do escritório: diz de que lado estamos
const curto = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));
export function mapearProcesso(det, audExtra = []) {
  if (!det || typeof det !== "object") return null;
  const numero = String(det.numero ?? "").replace(/\D/g, ""); if (numero.length !== 20) return null;
  const ladoAtivo = NOSSO.test(String(det.advogados_ativo ?? "")), ladoPassivo = NOSSO.test(String(det.advogados_passivo ?? ""));
  const polo = ladoAtivo && !ladoPassivo ? "ativo" : ladoPassivo && !ladoAtivo ? "passivo" : null;
  const movimentos = (Array.isArray(det.movimentos) ? det.movimentos : []).map((m) => ({ data: comoData(m?.data), descricao: curto(m?.descricao, 600), grau: m?.grau ?? null })).filter((m) => m.data || m.descricao);
  const documentos = (Array.isArray(det.documentos) ? det.documentos : []).map((d) => ({ id: d?.id ?? null, tipo: curto(d?.tipo, 80), nome: curto(d?.nome, 200), data: comoData(d?.data_juntada), lido: d?.tem_markdown === true, grau: d?.grau ?? null }));
  const partes = (Array.isArray(det.partes) ? det.partes : []).map((x) => ({ polo: x?.polo ?? null, nome: curto(x?.nome, 200), documento: x?.sigiloso ? null : curto(x?.cpf_cnpj, 20), tipo: x?.tipo_pessoa ?? null, advogados: curto(x?.advogados, 400) }));
  const audBrutas = [...(Array.isArray(det.audiencias) ? det.audiencias : []), ...audExtra];
  const audiencias = []; for (const a of audBrutas) { const data = a?.data_audiencia ?? a?.data ?? a?.inicio ?? null; if (!data) continue;
    const item = { data: String(data), descricao: curto(a?.descricao ?? a?.tipo ?? "Audiência", 300) }; if (!audiencias.some((x) => x.data === item.data)) audiencias.push(item); }
  const datasMov = movimentos.map((m) => m.data).filter(Boolean).sort();
  return {
    numero, polo,
    capa: { tribunal: det.tribunal ?? null, orgao_julgador: det.orgao_julgador ?? null, comarca: det.comarca ?? null, classe: det.classe ?? null, assunto: det.assunto ?? null,
      valor_causa: typeof det.valor_causa === "number" ? det.valor_causa : null, data_distribuicao: comoData(det.data_distribuicao), grau: det.grau ?? null, sistema: det.sistema ?? null,
      polo_ativo: curto(det.polo_ativo, 300), polo_passivo: curto(det.polo_passivo, 300), advogados_ativo: curto(det.advogados_ativo, 400), advogados_passivo: curto(det.advogados_passivo, 400),
      segredo_justica: det.segredo_justica === true, segredo_sem_acesso: det.segredo_sem_acesso ?? null, baixado: det.baixado === true },
    parte_contraria: polo === "ativo" ? curto(det.polo_passivo, 300) : polo === "passivo" ? curto(det.polo_ativo, 300) : null,
    advogado_contrario: polo === "ativo" ? curto(det.advogados_passivo, 300) : polo === "passivo" ? curto(det.advogados_ativo, 300) : null,
    partes, movimentos, documentos, audiencias,
    ultima_decisao: comoData(det.ultima_decisao), ultimo_andamento: datasMov.length ? datasMov[datasMov.length - 1] : null,
    sincronizado_fonte: det.ultima_sincronizacao ?? null,
  };
}

// Busca a lista da carteira e atualiza, por vez, até `limite` processos cujo retrato está desatualizado (ou não existe).
// Processo do Sync que não está cadastrado no sistema é só contado (fora_da_base): nada é criado.
export async function puxarCarteira({ db, cliente, limite = 40, paralelo = 4, itens = 200, maxPaginas = 10 }) {
  const { ativo, config } = await integracao(db);
  if (!ativo) return { status: "desligada" };
  if (config.contrato_confirmado !== true) return { status: "aguardando_contrato" };
  const r = { na_carteira: 0, fora_da_base: 0, em_dia: 0, atualizados: 0, capas_preenchidas: 0, erros: 0, restantes: 0 };
  try {
    const api = cliente(); const lista = [];
    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const { corpo } = await api.get("/v1/processos", { itens, pagina, bloqueados: false });
      const lote = Array.isArray(corpo?.processos) ? corpo.processos : []; lista.push(...lote); if (lote.length < itens) break;
    }
    r.na_carteira = lista.length;
    const estado = (await db.rpc("sync_carteira_estado")) || {};
    const audPor = new Map();
    try { const { corpo } = await api.get("/v1/dashboard"); for (const a of corpo?.audiencias?.proximas || []) { const k = String(a?.processo ?? "").replace(/\D/g, ""); if (k) audPor.set(k, [...(audPor.get(k) || []), a]); } } catch { /* sem o painel, seguem só as audiências do detalhe */ }
    const pend = [];
    for (const it of lista) {
      const k = String(it?.numero ?? "").replace(/\D/g, ""); if (k.length !== 20) continue;
      if (!(k in estado)) { r.fora_da_base++; continue; }
      const nosso = estado[k] ? Date.parse(estado[k]) : 0, deles = it?.ultima_sincronizacao ? Date.parse(it.ultima_sincronizacao) : 0;
      if (nosso && deles && deles <= nosso && !audPor.has(k)) { r.em_dia++; continue; }
      pend.push({ k, deles });
    }
    pend.sort((a, b) => a.deles - b.deles);
    const agora = pend.slice(0, Math.max(1, limite)); r.restantes = pend.length - agora.length;
    let i = 0;
    const trabalhar = async () => { while (i < agora.length) { const { k } = agora[i++];
      try { const { corpo } = await api.get("/v1/processos/" + k); const item = mapearProcesso(corpo, audPor.get(k) || []);
        if (!item) { r.erros++; continue; }
        const res = await db.rpc("sync_receber_processo", { p: item }); if (res === "ok" || res === "ok_capa") { r.atualizados++; if (res === "ok_capa") r.capas_preenchidas++; } else r.erros++;
      } catch (e) { if (e instanceof ErroSync && ["credencial", "plano", "sem_credencial"].includes(e.categoria)) throw e; r.erros++; } } };
    await Promise.all(Array.from({ length: Math.max(1, paralelo) }, trabalhar));
    return { status: r.erros ? "parcial" : "ok", resumo: r };
  } catch (e) {
    return { status: "erro", categoria: e instanceof ErroSync ? e.categoria : "interno", resumo: r };
  }
}


// ---------- monitores por CPF/CNPJ dos clientes (aba Monitoramento) ----------
const soDig = (v) => String(v ?? "").replace(/\D/g, "");
async function monitoresDaFonte(api) { const { corpo } = await api.get("/v1/monitores"); const m = new Map(); for (const x of corpo?.monitores || []) m.set(String(x?.tipo) + ":" + soDig(x?.valor), x); return m; }
// Cria no Sync um monitor para cada documento cadastrado que ainda não tem. Não confirma processo nenhum: descobrir não consome o plano.
export async function criarMonitores({ db, cliente, limite = 60 }) {
  const { ativo } = await integracao(db); if (!ativo) return { status: "desligada" };
  const r = { a_criar: 0, criados: 0, ja_existiam: 0, erros: 0, restantes: 0 };
  try {
    const api = cliente(); const fila = (await db.rpc("sync_monitores_a_criar")) || []; r.a_criar = fila.length;
    let naFonte = await monitoresDaFonte(api);
    const agora = fila.slice(0, limite); r.restantes = fila.length - agora.length;
    for (const it of agora) {
      const chave = it.tipo + ":" + soDig(it.documento);
      try {
        let m = naFonte.get(chave);
        if (m) r.ja_existiam++; else { await api.post("/v1/monitores", { tipo: it.tipo, valor: soDig(it.documento), pasta_id: null }); naFonte = await monitoresDaFonte(api); m = naFonte.get(chave); if (m) r.criados++; }
        if (!m?.id) { r.erros++; await db.rpc("sync_monitor_registrar", { p_cliente: it.cliente_id, p_tipo: it.tipo, p_documento: it.documento, p_monitor: null, p_erro: "monitor não apareceu na lista do fornecedor" }); continue; }
        await db.rpc("sync_monitor_registrar", { p_cliente: it.cliente_id, p_tipo: it.tipo, p_documento: it.documento, p_monitor: m.id, p_erro: null });
      } catch (e) {
        r.erros++; await db.rpc("sync_monitor_registrar", { p_cliente: it.cliente_id, p_tipo: it.tipo, p_documento: it.documento, p_monitor: null, p_erro: e instanceof ErroSync ? e.categoria : "erro" }).catch(() => {});
        if (e instanceof ErroSync && ["autenticacao", "plano", "sem_credencial"].includes(e.categoria)) return { status: "erro", categoria: e.categoria, resumo: r };
      }
    }
    return { status: r.erros ? "parcial" : "ok", resumo: r };
  } catch (e) { return { status: "erro", categoria: e instanceof ErroSync ? e.categoria : "interno", resumo: r }; }
}
// Lê o que cada monitor encontrou e guarda. Processo novo (depois da primeira leitura) marca o cliente como "nova movimentação".
export async function puxarDescobertos({ db, cliente, paralelo = 4 }) {
  const { ativo } = await integracao(db); if (!ativo) return { status: "desligada" };
  const r = { monitores: 0, lidos: 0, processos: 0, novos: 0, erros: 0, plano: null };
  try {
    const api = cliente(); const lista = (await db.rpc("sync_monitores_lista")) || []; r.monitores = lista.length; let i = 0;
    const trabalhar = async () => { while (i < lista.length) { const it = lista[i++];
      try { const { corpo } = await api.get(`/v1/monitores/${encodeURIComponent(it.monitor)}/descobertos`);
        const procs = (Array.isArray(corpo?.processos) ? corpo.processos : []).map((p) => ({ numero: soDig(p?.numero), numero_mascara: p?.numero_mascara ?? null, tribunal: p?.tribunal ?? null, classe: p?.classe ?? null, assunto: p?.assunto ?? null,
          orgao: p?.orgao ?? null, comarca: p?.comarca ?? null, valor_causa: p?.valor_causa ?? null, distribuicao: p?.distribuicao ?? null, segredo: p?.segredo === true, polo_ativo: p?.polo_ativo ?? null, polo_passivo: p?.polo_passivo ?? null, lido: p?.lido === true, arquivado: p?.arquivado === true }));
        if (corpo?.cobranca && !r.plano) r.plano = { monitorados: corpo.cobranca.monitorados ?? null, limite: corpo.cobranca.limite_plano ?? null, vagas: corpo.cobranca.vagas_no_plano ?? null };
        const n = await db.rpc("sync_monitor_descobertos", { p_documento: it.documento, p_processos: procs, p_checagem: corpo?.monitor?.ultima_checagem ?? null });
        r.lidos++; r.processos += procs.length; r.novos += Number(n) || 0;
      } catch (e) { if (e instanceof ErroSync && ["autenticacao", "plano", "sem_credencial"].includes(e.categoria)) throw e; r.erros++; } } };
    await Promise.all(Array.from({ length: Math.max(1, paralelo) }, trabalhar));
    return { status: r.erros ? "parcial" : "ok", resumo: r };
  } catch (e) { return { status: "erro", categoria: e instanceof ErroSync ? e.categoria : "interno", resumo: r }; }
}
