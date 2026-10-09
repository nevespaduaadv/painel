// Edge Function "chatguru" — porta das funções de servidor do crm-leads (Vercel) para o Supabase.
// Rotas (POST):
//   /chatguru/webhook?token=…   ← "Post para URL" do ChatGuru: cria/atualiza o lead (rpc chatguru_webhook, service role)
//   /chatguru/enviar            ← painel (JWT do usuário): { acao: "mensagem"|"anotacao"|"localizar"|"testar", lead_id, texto }
//   /chatguru/automacoes        ← pg_cron (Bearer token da integração 'automacoes'): dispara os passos vencidos
// Deploy com "Verify JWT" DESLIGADO (o webhook e o cron não têm JWT); cada rota faz a própria autenticação.
// Secrets: CHATGURU_API_URL, CHATGURU_API_KEY, CHATGURU_ACCOUNT_ID, CHATGURU_PHONE_ID, CHATGURU_WEBHOOK_TOKEN, PAINEL_URL.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY são injetadas pelo Supabase.

type Dict = Record<string, unknown>;
interface Cred { url: string; key: string; accountId: string; phoneId: string }
interface Resp { ok: boolean; descricao: string; dados: Dict }

const env = (n: string) => Deno.env.get(n) ?? "";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });

const MARCADOR_MENSAGEM = "WhatsApp enviado pelo CRM:\n";
const MARCADOR_ANOTACAO = "Anotação enviada ao ChatGuru:\n";
const CAMPO_LINK_CRM = "link_crm";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function credenciais(): Cred | string {
  const faltando = ["CHATGURU_API_URL", "CHATGURU_API_KEY", "CHATGURU_ACCOUNT_ID", "CHATGURU_PHONE_ID"].filter((n) => !env(n));
  if (faltando.length) return `Falta configurar nos secrets da função: ${faltando.join(", ")}.`;
  return { url: env("CHATGURU_API_URL"), key: env("CHATGURU_API_KEY"), accountId: env("CHATGURU_ACCOUNT_ID"), phoneId: env("CHATGURU_PHONE_ID") };
}
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- API do ChatGuru (porta de api/_chatguru.ts) ----------
function variantesNumero(whatsapp: string | null | undefined): string[] {
  let d = String(whatsapp ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return [];
  if (d.length === 10 || d.length === 11) d = "55" + d;
  const lista = [d];
  if (d.startsWith("55")) {
    if (d.length === 13 && d[4] === "9") lista.push(d.slice(0, 4) + d.slice(5));
    else if (d.length === 12 && /[6-9]/.test(d[4])) lista.push(d.slice(0, 4) + "9" + d.slice(4));
  }
  return lista;
}
async function chamar(c: Cred, action: string, params: Record<string, string>): Promise<Resp> {
  const corpo = new URLSearchParams({ ...params, key: c.key, account_id: c.accountId, phone_id: c.phoneId, action });
  const r = await fetch(c.url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString(), signal: AbortSignal.timeout(15_000) });
  const texto = await r.text();
  let dados: Dict = {};
  try { const j = JSON.parse(texto); if (j && typeof j === "object") dados = j; } catch { /* resposta fora do padrão */ }
  const descricao = [dados.description, dados.message_file_send_return, dados.dialog_execution_return].find((v) => typeof v === "string");
  return { ok: dados.result === "success", descricao: typeof descricao === "string" ? descricao : texto.slice(0, 200) || `HTTP ${r.status}`, dados };
}
const chatNaoEncontrado = (r: Resp) => !r.ok && /chat n[ãa]o encontrado/i.test(r.descricao);
const txt = (v: unknown) => (typeof v === "string" && v ? v : null);

async function enviarMensagem(c: Cred, lead: { nome: string; whatsapp: string | null }, mensagem: string) {
  const numeros = variantesNumero(lead.whatsapp);
  if (!numeros.length) return { ok: false as const, erro: "O lead não tem WhatsApp cadastrado." };
  for (const numero of numeros) {
    const r = await chamar(c, "message_send", { chat_number: numero, text: mensagem });
    if (r.ok) return { ok: true as const, como: "mensagem", numero, id: txt(r.dados.message_id) };
    if (!chatNaoEncontrado(r)) return { ok: false as const, erro: `O ChatGuru recusou o envio: ${r.descricao}` };
  }
  const numero = numeros[0];
  const r = await chamar(c, "chat_add", { chat_number: numero, name: lead.nome.trim() || numero, text: mensagem });
  if (r.ok) return { ok: true as const, como: "conversa_iniciada", numero, id: txt(r.dados.chat_add_id) };
  return { ok: false as const, erro: `Este contato ainda não tem conversa no ChatGuru, e não foi possível iniciar uma: ${r.descricao}` };
}
async function enviarAnotacao(c: Cred, lead: { whatsapp: string | null }, nota: string) {
  const numeros = variantesNumero(lead.whatsapp);
  if (!numeros.length) return { ok: false as const, erro: "O lead não tem WhatsApp cadastrado." };
  for (const numero of numeros) {
    const r = await chamar(c, "note_add", { chat_number: numero, note_text: nota });
    if (r.ok) return { ok: true as const, como: "anotacao", numero, id: txt(r.dados.note_id) };
    if (!chatNaoEncontrado(r)) return { ok: false as const, erro: `O ChatGuru recusou a anotação: ${r.descricao}` };
  }
  return { ok: false as const, erro: "Este contato ainda não tem conversa no ChatGuru. Envie uma mensagem primeiro." };
}
async function testarConexao(c: Cred) {
  const r = await chamar(c, "message_status", { message_id: "000000000000000000000000" });
  if (r.ok || /mensagem n[ãa]o encontrada/i.test(r.descricao)) return { ok: true, descricao: "Credenciais aceitas pelo ChatGuru." };
  return { ok: false, descricao: r.descricao };
}
async function executarDialogo(c: Cred, lead: { nome: string; whatsapp: string | null }, dialogId: string, abertura: string | null) {
  const numeros = variantesNumero(lead.whatsapp);
  if (!numeros.length) return { ok: false as const, erro: "Lead sem WhatsApp cadastrado." };
  for (const numero of numeros) {
    const r = await chamar(c, "dialog_execute", { chat_number: numero, dialog_id: dialogId });
    if (r.ok) return { ok: true as const, descricao: null as string | null };
    if (!chatNaoEncontrado(r)) return { ok: false as const, erro: `ChatGuru: ${r.descricao}` };
  }
  if (!abertura) return { ok: false as const, erro: "Contato sem conversa no ChatGuru, e a automação não tem mensagem de abertura para iniciar uma." };
  const numero = numeros[0];
  const r = await chamar(c, "chat_add", { chat_number: numero, name: lead.nome.trim() || numero, text: abertura, dialog_id: dialogId });
  if (r.ok) return { ok: true as const, descricao: "conversa criada no ChatGuru" };
  return { ok: false as const, erro: `Contato sem conversa no ChatGuru, e não foi possível criar: ${r.descricao}` };
}
async function localizarChat(c: Cred, whatsapp: string | null, linkCrm: string) {
  for (const numero of variantesNumero(whatsapp)) {
    const r = await chamar(c, "chat_update_custom_fields", { chat_number: numero, [`field__${CAMPO_LINK_CRM}`]: linkCrm });
    const chatId = txt(r.dados.chat_id);
    if (r.ok && chatId) return { como: "chat" as const, chatId, numero };
    if (/nenhum campo personalizado/i.test(r.descricao)) return { como: "sem_campo" as const, numero };
    if (!chatNaoEncontrado(r)) throw new Error(`ChatGuru: ${r.descricao}`);
  }
  return { como: "sem_conversa" as const };
}
const linkDoChat = (c: Cred, chatId: string | null) => { const base = new URL(c.url).origin; return chatId ? `${base}/chats#${chatId}` : `${base}/chats`; };

// ---------- payload do webhook (porta de api/_payload.ts) ----------
function tentarJson(v: string): unknown { try { return JSON.parse(v); } catch { return undefined; } }
function normalizarTags(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === "string") { const s = v.trim(); if (!s) return []; const j = tentarJson(s); if (Array.isArray(j)) return j.map((t) => String(t).trim()).filter(Boolean); return s.split(",").map((t) => t.trim()).filter(Boolean); }
  return undefined;
}
function deForm(sp: URLSearchParams): Dict { const p: Dict = {}; for (const k of new Set(sp.keys())) { const v = sp.getAll(k); p[k] = k.endsWith("[]") || v.length > 1 ? v : v[0]; } return p; }
async function lerPayload(req: Request): Promise<Dict> {
  const ct = req.headers.get("content-type") ?? "";
  const bruto = await req.text();
  let p: Dict = {};
  if (ct.includes("application/json")) { const j = tentarJson(bruto); if (j && typeof j === "object") p = j as Dict; }
  else if (ct.includes("form-urlencoded")) p = deForm(new URLSearchParams(bruto));
  else if (ct.includes("multipart/form-data")) { const fd = await new Request(req.url, { method: "POST", headers: req.headers, body: bruto }).formData(); fd.forEach((v, k) => { p[k] = String(v); }); }
  else { const j = tentarJson(bruto); p = j && typeof j === "object" ? (j as Dict) : deForm(new URLSearchParams(bruto)); }
  if (p["tags[]"] !== undefined && p.tags === undefined) { p.tags = p["tags[]"]; delete p["tags[]"]; }
  const tags = normalizarTags(p.tags); if (tags === undefined) delete p.tags; else p.tags = tags;
  for (const campo of ["campos_personalizados", "bot_context"]) if (typeof p[campo] === "string") { const j = tentarJson(p[campo] as string); if (j !== undefined) p[campo] = j; }
  if (p.celular !== undefined && p.celular !== null) p.celular = String(p.celular);
  return p;
}

// ---------- acesso ao banco ----------
function rest(path: string, auth: string, init: { method?: string; body?: string; prefer?: string } = {}) {
  return fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { method: init.method ?? "GET", headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) }, body: init.body });
}
const service = () => env("SUPABASE_SERVICE_ROLE_KEY");

// ---------- rotas ----------
async function webhook(req: Request, url: URL): Promise<Response> {
  const esperado = env("CHATGURU_WEBHOOK_TOKEN");
  const token = url.searchParams.get("token") ?? "";
  if (!esperado || !igual(token, esperado)) return json(401, { ok: false, erro: "Token inválido." });
  const p = await lerPayload(req);
  const r = await rest("rpc/chatguru_webhook", service(), { method: "POST", body: JSON.stringify({ p }) });
  if (!r.ok) return json(502, { ok: false, erro: `Supabase respondeu ${r.status}: ${await r.text()}` });
  return json(200, await r.json()); // erros de conteúdo ficam em webhook_logs; 200 para o ChatGuru não reenviar
}

async function enviar(req: Request): Promise<Response> {
  const cg = credenciais(); if (typeof cg === "string") return json(500, { ok: false, erro: cg });
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!jwt) return json(401, { ok: false, erro: "Faça login no painel." });
  const eq = await rest("rpc/sou_equipe", jwt, { method: "POST", body: "{}" });
  if (!eq.ok || (await eq.json().catch(() => null)) !== true) return json(401, { ok: false, erro: "Sessão expirada ou usuário sem acesso." });
  const corpo = (await req.json().catch(() => ({}))) as Dict;
  const acao = corpo.acao;
  if (acao === "testar") { const r = await testarConexao(cg); return json(200, { ok: r.ok, descricao: r.descricao, servidor: new URL(cg.url).hostname }); }
  if (acao !== "mensagem" && acao !== "anotacao" && acao !== "localizar") return json(400, { ok: false, erro: "Ação inválida." });
  const leadId = String(corpo.lead_id ?? ""); const texto = String(corpo.texto ?? "").trim();
  if (!UUID.test(leadId)) return json(400, { ok: false, erro: "Lead inválido." });
  const rl = await rest(`leads?id=eq.${leadId}&select=id,nome,whatsapp,link_chat`, jwt);
  const [lead] = rl.ok ? ((await rl.json()) as { id: string; nome: string; whatsapp: string | null; link_chat: string | null }[]) : [];
  if (!lead) return json(404, { ok: false, erro: "Lead não encontrado." });
  if (acao === "localizar") {
    if (lead.link_chat) return json(200, { ok: true, como: "chat", link: lead.link_chat });
    const r = await localizarChat(cg, lead.whatsapp, `${env("PAINEL_URL") || "https://nevespaduaadv.github.io/painel"}/passivos/#leads/${lead.id}`);
    if (r.como === "chat") { const link = linkDoChat(cg, r.chatId); await rest(`leads?id=eq.${lead.id}`, jwt, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ link_chat: link, chatguru_chat_id: r.chatId }) }); return json(200, { ok: true, como: "chat", link }); }
    if (r.como === "sem_campo") return json(200, { ok: true, como: "lista", link: linkDoChat(cg, null), numero: r.numero });
    return json(200, { ok: true, como: "sem_conversa" });
  }
  if (!texto) return json(400, { ok: false, erro: "Escreva o texto antes de enviar." });
  if (texto.length > 4000) return json(400, { ok: false, erro: "O texto passa de 4000 caracteres." });
  const res = acao === "mensagem" ? await enviarMensagem(cg, lead, texto) : await enviarAnotacao(cg, lead, texto);
  if (!res.ok) return json(502, { ok: false, erro: res.erro });
  const obs = await rest("observacoes", jwt, { method: "POST", prefer: "return=minimal", body: JSON.stringify({ lead_id: lead.id, texto: (acao === "mensagem" ? MARCADOR_MENSAGEM : MARCADOR_ANOTACAO) + texto }) });
  if (acao === "mensagem") await rest(`leads?id=eq.${lead.id}`, jwt, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ ultima_interacao_em: new Date().toISOString() }) });
  return json(200, { ok: true, como: res.como, numero: res.numero, id: res.id, ...(obs.ok ? {} : { aviso: "Enviado ao ChatGuru, mas não foi possível registrar no histórico." }) });
}

interface Passo { id: number; passo: number; tentativas: number; automacao: string; texto_abertura: string | null; dialogo: string | null; dialog_id: string | null; lead: { id: string; nome: string; whatsapp: string | null } }
async function automacoes(req: Request): Promise<Response> {
  const cg = credenciais(); if (typeof cg === "string") return json(500, { ok: false, erro: cg });
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { ok: false, erro: "Token ausente." });
  const rpc = (f: string, args: Dict) => rest(`rpc/${f}`, service(), { method: "POST", body: JSON.stringify(args) });
  const reserva = await rpc("automacoes_reservar", { token, limite: 5 });
  if (!reserva.ok) { const t = await reserva.text(); return json(/token inv/i.test(t) ? 401 : 502, { ok: false, erro: t }); }
  const passos = (await reserva.json()) as Passo[];
  if (!passos.length) return json(200, { ok: true, processados: 0 });
  const inicio = Date.now(); const resultados: Dict[] = [];
  for (const p of passos) {
    if (Date.now() - inicio > 35_000) { resultados.push({ id: p.id, liberar: true }); continue; }
    if (!p.dialog_id) { resultados.push({ id: p.id, ok: false, erro: "O diálogo deste passo foi removido do CRM." }); continue; }
    try { const r = await executarDialogo(cg, p.lead, p.dialog_id, p.texto_abertura); resultados.push(r.ok ? { id: p.id, ok: true, descricao: r.descricao } : { id: p.id, ok: false, erro: r.erro }); }
    catch (e) { const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"); resultados.push({ id: p.id, ok: false, temporario: true, erro: tempo ? "O ChatGuru não respondeu a tempo." : `Falha de conexão: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  const reg = await rpc("automacoes_registrar", { token, resultados });
  if (!reg.ok) return json(502, { ok: false, erro: `Não foi possível registrar o resultado: ${await reg.text()}` });
  return json(200, { ok: true, processados: resultados.length, feitos: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => r.ok === false).length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^\/chatguru\/?/, "").replace(/\/$/, "");
  if (req.method !== "POST") return json(405, { ok: false, erro: "Use POST." });
  try {
    if (rota === "webhook") return await webhook(req, url);
    if (rota === "enviar") return await enviar(req);
    if (rota === "automacoes") return await automacoes(req);
    return json(404, { ok: false, erro: "Rota desconhecida." });
  } catch (e) {
    const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return json(tempo ? 504 : 500, { ok: false, erro: tempo ? "O ChatGuru não respondeu a tempo." : `Falha: ${e instanceof Error ? e.message : String(e)}` });
  }
});
