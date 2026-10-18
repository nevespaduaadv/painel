// Edge Function "chatguru" — porta das funções de servidor do crm-leads (Vercel) para o Supabase.
// Rotas (POST):
//   /chatguru/webhook?token=…   ← "Post para URL" do ChatGuru: cria/atualiza o lead (rpc chatguru_webhook, service role)
//   /chatguru/enviar            ← painel (JWT do usuário): { acao: "mensagem"|"anotacao"|"localizar"|"testar", lead_id, texto }
//   /chatguru/automacoes        ← pg_cron (Bearer token da integração 'automacoes'): dispara os passos vencidos
// Deploy com "Verify JWT" DESLIGADO (o webhook e o cron não têm JWT); cada rota faz a própria autenticação.
// Segredos (CHATGURU_API_URL, CHATGURU_API_KEY, CHATGURU_ACCOUNT_ID, CHATGURU_PHONE_ID, CHATGURU_WEBHOOK_TOKEN, PAINEL_URL):
// no Vault do banco, lidos pela rpc chatguru_segredos (migration 0029); variáveis de ambiente da função, se definidas, prevalecem.
// SUPABASE_URL e as chaves do projeto são injetadas pelo Supabase.

type Dict = Record<string, unknown>;
interface Cred { url: string; key: string; accountId: string; phoneId: string }
interface Resp { ok: boolean; descricao: string; dados: Dict }

const env = (n: string) => Deno.env.get(n) ?? "";
// Chaves do projeto: aceita as legadas (SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) e as novas (dicionários JSON).
function achaChave(v: unknown): string {
  if (typeof v === "string") return /^(sb_|eyJ)/.test(v) ? v : "";
  if (Array.isArray(v)) { for (const x of v) { const r = achaChave(x); if (r) return r; } return ""; }
  if (v && typeof v === "object") { for (const k of ["api_key", "key", "secret", "default"]) { const r = achaChave((v as Dict)[k]); if (r) return r; } for (const x of Object.values(v as Dict)) { const r = achaChave(x); if (r) return r; } }
  return "";
}
function chaveDe(nomeLegado: string, nomeDict: string): string {
  // prefere as chaves novas (sb_publishable_/sb_secret_); as legadas (JWT anon/service_role) só se não houver novas — elas podem estar desativadas no projeto
  try { const nova = achaChave(JSON.parse(env(nomeDict) || "{}")); if (nova) return nova; } catch { /* sem dicionário */ }
  return env(nomeLegado);
}
const ANON = chaveDe("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
const SERVICE = chaveDe("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
// Segredos do ChatGuru: lidos do Vault do banco (rpc chatguru_segredos, só service_role) e guardados em memória;
// variáveis de ambiente da função, se existirem, têm prioridade.
let cacheSeg: Record<string, string> | null = null;
let ultimoRpc = "";
async function segredo(n: string): Promise<string> {
  if (env(n)) return env(n);
  if (!cacheSeg) {
    const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/chatguru_segredos`, { method: "POST", headers: { ...cabecalhos(SERVICE), "Content-Type": "application/json" }, body: "{}" });
    ultimoRpc = `${r.status}`;
    cacheSeg = r.ok ? ((await r.json()) as Record<string, string>) ?? {} : {};
    if (!r.ok) ultimoRpc += " " + (await r.text().catch(() => "")).slice(0, 200);
  }
  return cacheSeg[n] ?? "";
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });

const MARCADOR_MENSAGEM = "WhatsApp enviado pelo CRM:\n";
const MARCADOR_ANOTACAO = "Anotação enviada ao ChatGuru:\n";
const CAMPO_LINK_CRM = "link_crm";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function credenciais(): Promise<Cred | string> {
  const v: Record<string, string> = {};
  for (const n of ["CHATGURU_API_URL", "CHATGURU_API_KEY", "CHATGURU_ACCOUNT_ID", "CHATGURU_PHONE_ID"]) v[n] = await segredo(n);
  const faltando = Object.keys(v).filter((n) => !v[n]);
  if (faltando.length) return `Falta configurar no Vault (chatguru_segredos): ${faltando.join(", ")}.`;
  return { url: v.CHATGURU_API_URL, key: v.CHATGURU_API_KEY, accountId: v.CHATGURU_ACCOUNT_ID, phoneId: v.CHATGURU_PHONE_ID };
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
// auth = JWT do usuário (vai em Authorization, com a chave publicável em apikey) ou a chave service (legada = JWT; nova sb_secret_ = só apikey)
function cabecalhos(auth: string): Record<string, string> {
  if (auth.startsWith("sb_")) return { apikey: auth };
  return { apikey: ANON, Authorization: `Bearer ${auth}` };
}
function rest(path: string, auth: string, init: { method?: string; body?: string; prefer?: string } = {}) {
  return fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { method: init.method ?? "GET", headers: { ...cabecalhos(auth), "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) }, body: init.body });
}
const service = () => SERVICE;

// ---------- rotas ----------
async function webhook(req: Request, url: URL): Promise<Response> {
  const esperado = await segredo("CHATGURU_WEBHOOK_TOKEN");
  const token = url.searchParams.get("token") ?? "";
  if (!esperado || !igual(token, esperado)) return json(401, { ok: false, erro: "Token inválido." });
  const p = await lerPayload(req);
  const r = await rest("rpc/chatguru_webhook", service(), { method: "POST", body: JSON.stringify({ p }) });
  if (!r.ok) return json(502, { ok: false, erro: `Supabase respondeu ${r.status}: ${await r.text()}` });
  return json(200, await r.json()); // erros de conteúdo ficam em webhook_logs; 200 para o ChatGuru não reenviar
}

// Formulário do site (nevespaduaadvocacia.com.br/contato): o script do site repassa o envio aceito pelo Elementor.
// Sem segredo (o chamador é o navegador do visitante); a triagem de spam e o limite por IP ficam na rpc site_formulario.
async function siteFormulario(req: Request): Promise<Response> {
  const origem = req.headers.get("origin") ?? "";
  if (!/^https:\/\/(www\.)?nevespaduaadvocacia\.com\.br$/.test(origem)) return json(403, { ok: false, erro: "Origem não permitida." });
  const bruto = await lerPayload(req);
  const campos = ["nome", "telefone", "email", "area", "mensagem", "consentimento", "hp", "t", "pagina"];
  const p: Dict = {};
  for (const c of campos) if (bruto[c] !== undefined && bruto[c] !== null) p[c] = String(bruto[c]).slice(0, 2000);
  p._ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  p._ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
  const r = await rest("rpc/site_formulario", service(), { method: "POST", body: JSON.stringify({ p }) });
  if (!r.ok) return json(502, { ok: false, erro: `Supabase respondeu ${r.status}` });
  const res = (await r.json()) as Dict;
  return json(200, { ok: res.ok === true }); // não devolve ids nem motivo ao navegador
}

async function enviar(req: Request): Promise<Response> {
  const cg = await credenciais();
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!jwt) return json(401, { ok: false, erro: "Faça login no painel." });
  const eq = await rest("rpc/sou_equipe", jwt, { method: "POST", body: "{}" });
  if (!eq.ok || (await eq.json().catch(() => null)) !== true) return json(401, { ok: false, erro: "Sessão expirada ou usuário sem acesso." });
  const corpo = (await req.json().catch(() => ({}))) as Dict;
  const acao = corpo.acao;
  if (acao === "testar") { if (typeof cg === "string") return json(500, { ok: false, erro: cg }); const r = await testarConexao(cg); return json(200, { ok: r.ok, descricao: r.descricao, servidor: new URL(cg.url).hostname }); }
  if (acao === "resumo") { // meu resumo diário, agora
    const rt = await rest("rpc/meu_resumo_diario", jwt, { method: "POST", body: "{}" });
    const texto = rt.ok ? ((await rt.json()) as string | null) : null;
    if (!texto) return json(400, { ok: false, erro: "Você não tem registro de colaborador." });
    const rd = await rest("rpc/meu_resumo_destinos", jwt, { method: "POST", body: "{}" });
    const me = rd.ok ? ((await rd.json()) as { id: string; nome: string; whatsapp: string | null; discord_user_id: string | null; canal: string } | null) : null;
    if (!me) return json(400, { ok: false, erro: "Você não tem registro de colaborador." });
    const rs = await enviarResumoPara(cg, me, texto);
    const okAlgum = rs.some((r) => r.ok);
    if (!okAlgum) return json(502, { ok: false, erro: rs.map((r) => `${r.canal}: ${r.erro}`).join(" · ") });
    return json(200, { ok: true, canais: rs.filter((r) => r.ok).map((r) => r.canal), avisos: rs.filter((r) => !r.ok).map((r) => `${r.canal}: ${r.erro}`) });
  }
  if (acao === "agenda") { // sincronizar a agenda agora (equipe); as RPCs aceitam o papel service_role sem token
    try { return json(200, await sincronizarAgenda("", txt(corpo.colaborador_id) ?? undefined)); } catch (e) { return json(502, { ok: false, erro: e instanceof Error ? e.message : String(e) }); }
  }
  if (typeof acao === "string" && acao.startsWith("asaas_")) return await asaasAcao(acao, corpo, jwt);
  if (acao === "growth") { // atualizar os dados de Growth agora (admin)
    const adm = await rest("rpc/sou_admin", jwt, { method: "POST", body: "{}" });
    if (!adm.ok || (await adm.json().catch(() => null)) !== true) return json(403, { ok: false, erro: "Só administradores atualizam o Growth." });
    try { return json(200, await coletarGrowth({ dias: Math.min(Number(corpo.dias ?? 3), 90), inicio: txt(corpo.inicio) ?? undefined, fim: txt(corpo.fim) ?? undefined, posts: corpo.posts !== false })); }
    catch (e) { const erro = e instanceof Error ? e.message : String(e); await rest("rpc/growth_gravar", service(), { method: "POST", body: JSON.stringify({ log: { ok: false, erro } }) }); return json(502, { ok: false, erro }); }
  }
  if (acao !== "mensagem" && acao !== "anotacao" && acao !== "localizar") return json(400, { ok: false, erro: "Ação inválida." });
  if (typeof cg === "string") return json(500, { ok: false, erro: cg });
  const leadId = String(corpo.lead_id ?? ""); const texto = String(corpo.texto ?? "").trim();
  if (!UUID.test(leadId)) return json(400, { ok: false, erro: "Lead inválido." });
  const rl = await rest(`leads?id=eq.${leadId}&select=id,nome,whatsapp,link_chat`, jwt);
  const [lead] = rl.ok ? ((await rl.json()) as { id: string; nome: string; whatsapp: string | null; link_chat: string | null }[]) : [];
  if (!lead) return json(404, { ok: false, erro: "Lead não encontrado." });
  if (acao === "localizar") {
    if (lead.link_chat) return json(200, { ok: true, como: "chat", link: lead.link_chat });
    const r = await localizarChat(cg, lead.whatsapp, `${(await segredo("PAINEL_URL")) || "https://nevespaduaadv.github.io/painel"}/#leads/${lead.id}`);
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
  const cg = await credenciais(); if (typeof cg === "string") return json(500, { ok: false, erro: cg });
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { ok: false, erro: "Token ausente." });
  const rpc = (f: string, args: Dict) => rest(`rpc/${f}`, service(), { method: "POST", body: JSON.stringify(args) });
  const reserva = await rpc("automacoes_reservar", { token, limite: 5 });
  if (!reserva.ok) { const t = await reserva.text(); return json(/token inv/i.test(t) ? 401 : 502, { ok: false, erro: t }); }
  const passos = (await reserva.json()) as Passo[];
  const fila = await mensagensClientes(cg, rpc, token); // fila de WhatsApp para clientes (onboarding etc.), no mesmo ciclo
  const discord = await pontéDiscord(rpc, token); // chat interno ↔ Discord e avisos (0061)
  if (!passos.length) return json(200, { ok: true, processados: 0, mensagens: fila, discord });
  const inicio = Date.now(); const resultados: Dict[] = [];
  for (const p of passos) {
    if (Date.now() - inicio > 35_000) { resultados.push({ id: p.id, liberar: true }); continue; }
    if (!p.dialog_id) { resultados.push({ id: p.id, ok: false, erro: "O diálogo deste passo foi removido do CRM." }); continue; }
    try { const r = await executarDialogo(cg, p.lead, p.dialog_id, p.texto_abertura); resultados.push(r.ok ? { id: p.id, ok: true, descricao: r.descricao } : { id: p.id, ok: false, erro: r.erro }); }
    catch (e) { const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"); resultados.push({ id: p.id, ok: false, temporario: true, erro: tempo ? "O ChatGuru não respondeu a tempo." : `Falha de conexão: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  const reg = await rpc("automacoes_registrar", { token, resultados });
  if (!reg.ok) return json(502, { ok: false, erro: `Não foi possível registrar o resultado: ${await reg.text()}` });
  return json(200, { ok: true, processados: resultados.length, feitos: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => r.ok === false).length, mensagens: fila, discord });
}
// ---------- Discord: fila de envio (chat/avisos → canal) e importação (canal → chat), token DISCORD_BOT_TOKEN ----------
async function pontéDiscord(rpc: (f: string, a: Dict) => Promise<Response>, token: string): Promise<Dict> {
  const bot = await segredo("DISCORD_BOT_TOKEN");
  if (!bot) return { ok: false, erro: "DISCORD_BOT_TOKEN não configurado." };
  const h = { Authorization: `Bot ${bot}`, "Content-Type": "application/json" };
  const out: Dict = {}; let enviadas = 0, erros = 0, importadas = 0;
  // 1) envio
  const r = await rpc("discord_fila_reservar", { token, limite: 10 });
  if (r.ok) {
    const itens = (await r.json()) as { id: number; canal: string; texto: string }[];
    const res: Dict[] = [];
    for (const it of itens) {
      try {
        const m = await fetch(`${DISCORD}/channels/${it.canal}/messages`, { method: "POST", headers: h, body: JSON.stringify({ content: it.texto.slice(0, 1990), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(15_000) });
        if (m.ok) { res.push({ id: it.id, ok: true, descricao: `canal ${it.canal}` }); enviadas++; }
        else { const t = (await m.text()).slice(0, 200); res.push({ id: it.id, ok: false, temporario: m.status === 429 || m.status >= 500, erro: `Discord ${m.status}: ${t}` }); erros++; }
      } catch (e) { res.push({ id: it.id, ok: false, temporario: true, erro: e instanceof Error ? e.message : String(e) }); erros++; }
    }
    if (res.length) await rpc("discord_fila_registrar", { token, resultados: res });
  }
  // 2) importação dos canais espelhados
  const c = await rpc("discord_canais_ponte", { token });
  if (c.ok) {
    const canais = (await c.json()) as { canal_id: string; discord_canal: string; ultimo_id: string | null }[];
    for (const ch of canais) {
      try {
        const q = new URLSearchParams({ limit: "50", ...(ch.ultimo_id ? { after: ch.ultimo_id } : {}) });
        const g = await fetch(`${DISCORD}/channels/${ch.discord_canal}/messages?${q}`, { headers: h, signal: AbortSignal.timeout(15_000) });
        if (!g.ok) { out[`canal_${ch.discord_canal}`] = `Discord ${g.status}`; continue; }
        const msgs = ((await g.json()) as Dict[]).sort((a, b) => (BigInt(String(a.id)) < BigInt(String(b.id)) ? -1 : 1));
        if (!msgs.length) continue;
        const ultimo = String(msgs[msgs.length - 1].id);
        const novas = msgs.filter((m) => !(m.author as Dict)?.bot && typeof m.content === "string" && m.content.trim()).map((m) => {
          const a = m.author as Dict; const anexos = ((m.attachments as Dict[]) ?? []).map((x) => x.url).filter(Boolean);
          return { id: String(m.id), autor_discord_id: String(a?.id ?? ""), autor_nome: String((m.member as Dict)?.nick ?? a?.global_name ?? a?.username ?? "Discord"), texto: [m.content, ...anexos].join("\n"), em: m.timestamp };
        });
        const imp = await rpc("discord_importar", { token, p_canal: ch.canal_id, mensagens: novas, p_ultimo: ultimo });
        if (imp.ok) importadas += novas.length;
      } catch (e) { out[`canal_${ch.discord_canal}`] = e instanceof Error ? e.message : String(e); }
    }
  }
  return { ...out, enviadas, erros, importadas };
}
// fila de mensagens para clientes (tabela mensagens_fila, 0052): o banco monta o texto e respeita o horário comercial
interface Msg { id: number; nome: string; numero: string; texto: string | null }
async function mensagensClientes(cg: Cred, rpc: (f: string, a: Dict) => Promise<Response>, token: string): Promise<Dict> {
  const r = await rpc("mensagens_reservar", { token, limite: 5 });
  if (!r.ok) return { ok: false, erro: (await r.text()).slice(0, 200) };
  const itens = (await r.json()) as Msg[];
  if (!itens.length) return { ok: true, processadas: 0 };
  const resultados: Dict[] = [];
  for (const m of itens) {
    if (!m.texto) { resultados.push({ id: m.id, ok: false, erro: "Modelo de mensagem não encontrado." }); continue; }
    try { const e = await enviarMensagem(cg, { nome: m.nome, whatsapp: m.numero }, m.texto); resultados.push(e.ok ? { id: m.id, ok: true, descricao: `${e.como} ${e.numero}` } : { id: m.id, ok: false, erro: e.erro }); }
    catch (e) { const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"); resultados.push({ id: m.id, ok: false, temporario: true, erro: tempo ? "O ChatGuru não respondeu a tempo." : `Falha de conexão: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  const reg = await rpc("mensagens_registrar", { token, resultados });
  return { ok: reg.ok, processadas: resultados.length, enviadas: resultados.filter((x) => x.ok).length, erros: resultados.filter((x) => x.ok === false).length };
}

// ---------- Discord: DM via bot (token DISCORD_BOT_TOKEN no Vault). O usuário precisa estar num servidor em comum com o bot. ----------
const DISCORD = "https://discord.com/api/v10";
const paraDiscord = (t: string) => t.replace(/\*([^*\n]+)\*/g, "**$1**"); // negrito do WhatsApp (*x*) → Discord (**x**)
async function enviarDiscordDM(userId: string, texto: string): Promise<{ ok: true; canalId: string } | { ok: false; erro: string }> {
  const token = await segredo("DISCORD_BOT_TOKEN");
  if (!token) return { ok: false, erro: "DISCORD_BOT_TOKEN não configurado no Vault." };
  const h = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const c = await fetch(`${DISCORD}/users/@me/channels`, { method: "POST", headers: h, body: JSON.stringify({ recipient_id: userId }), signal: AbortSignal.timeout(15_000) });
  if (!c.ok) return { ok: false, erro: `Discord não abriu a DM (${c.status}): ${(await c.text()).slice(0, 200)}` };
  const canal = (await c.json()) as { id: string };
  const partes = paraDiscord(texto).match(/[\s\S]{1,1900}(?:\n|$)/g) ?? [texto];
  for (const parte of partes) {
    const m = await fetch(`${DISCORD}/channels/${canal.id}/messages`, { method: "POST", headers: h, body: JSON.stringify({ content: parte }), signal: AbortSignal.timeout(15_000) });
    if (!m.ok) return { ok: false, erro: `Discord recusou a mensagem (${m.status}): ${(await m.text()).slice(0, 200)}` };
  }
  return { ok: true, canalId: canal.id };
}
async function enviarResumoPara(cg: Cred | string, it: { nome: string; whatsapp: string | null; discord_user_id: string | null; canal: string }, texto: string): Promise<Dict[]> {
  const out: Dict[] = [];
  if ((it.canal === "discord" || it.canal === "ambos") && it.discord_user_id) {
    const r = await enviarDiscordDM(it.discord_user_id, texto);
    out.push({ canal: "discord", ok: r.ok, erro: r.ok ? null : r.erro, numero: it.discord_user_id });
  }
  if ((it.canal === "whatsapp" || it.canal === "ambos") && it.whatsapp) {
    if (typeof cg === "string") out.push({ canal: "whatsapp", ok: false, erro: cg, numero: it.whatsapp });
    else { const r = await enviarMensagem(cg, { nome: it.nome, whatsapp: it.whatsapp }, texto); out.push({ canal: "whatsapp", ok: r.ok, erro: r.ok ? null : r.erro, numero: r.ok ? r.numero : it.whatsapp }); }
  }
  if (!out.length) out.push({ canal: it.canal, ok: false, erro: "Sem destino configurado para o canal escolhido." });
  return out;
}

interface Resumo { colaborador_id: string; nome: string; whatsapp: string | null; discord_user_id: string | null; canal: string; texto: string }
async function resumo(req: Request): Promise<Response> {
  const cg = await credenciais(); // string = ChatGuru não configurado (só afeta quem usa WhatsApp)
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { ok: false, erro: "Token ausente." });
  const corpo = (await req.json().catch(() => ({}))) as Dict;
  const rpc = (f: string, args: Dict) => rest(`rpc/${f}`, service(), { method: "POST", body: JSON.stringify(args) });
  const lote = await rpc("resumo_diario_lote", { token, forcar_colab: corpo.colaborador_id ?? null });
  if (!lote.ok) { const t = await lote.text(); return json(/token inv/i.test(t) ? 401 : 502, { ok: false, erro: t }); }
  const itens = (await lote.json()) as Resumo[];
  const resultados: Dict[] = [];
  for (const it of itens) {
    try { for (const r of await enviarResumoPara(cg, it, it.texto)) resultados.push({ colaborador_id: it.colaborador_id, ...r, texto: it.texto }); }
    catch (e) { resultados.push({ colaborador_id: it.colaborador_id, canal: it.canal, ok: false, erro: e instanceof Error ? e.message : String(e), texto: it.texto }); }
  }
  if (resultados.length) { const reg = await rpc("resumo_diario_registrar", { token, resultados }); if (!reg.ok) return json(502, { ok: false, erro: `Enviado, mas não registrado: ${await reg.text()}` }); }
  return json(200, { ok: true, enviados: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).map((r) => ({ colaborador_id: r.colaborador_id, erro: r.erro })) });
}

// ---------- Growth: Meta Marketing API + Instagram Graph API → tabelas growth_* (segredos META_* no Vault) ----------
const GRAPH = "https://graph.facebook.com/v21.0";
const diaISO = (d: Date) => d.toISOString().slice(0, 10);
const diasAtras = (n: number) => { const d = new Date(Date.now() - 3 * 3600_000); d.setUTCDate(d.getUTCDate() - n); return diaISO(d); }; // "hoje" em BRT
async function graph(path: string, params: Record<string, string>, token: string): Promise<Dict> {
  const u = new URL(`${GRAPH}/${path}`); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); u.searchParams.set("access_token", token);
  const r = await fetch(u, { signal: AbortSignal.timeout(40_000) });
  const j = (await r.json().catch(() => ({}))) as Dict;
  if (!r.ok) { const e = (j.error ?? {}) as Dict; throw new Error(`Graph ${path.split("/").slice(-1)[0]} ${r.status}: ${String(e.message ?? JSON.stringify(j)).slice(0, 200)}`); }
  return j;
}
async function graphTodos(path: string, params: Record<string, string>, token: string, maxPaginas = 20): Promise<Dict[]> {
  const out: Dict[] = []; let j = await graph(path, params, token);
  for (let i = 0; i < maxPaginas; i++) {
    out.push(...((j.data as Dict[]) ?? []));
    const next = (j.paging as Dict | undefined)?.next as string | undefined; if (!next) break;
    const r = await fetch(next, { signal: AbortSignal.timeout(40_000) }); j = (await r.json().catch(() => ({}))) as Dict; if (!r.ok) break;
  }
  return out;
}
const acoesMapa = (acts: unknown): Record<string, number> => { const m: Record<string, number> = {}; for (const a of (Array.isArray(acts) ? acts : []) as Dict[]) m[String(a.action_type)] = Number(a.value ?? 0); return m; };
const leadsDe = (m: Record<string, number>) => m["lead"] ?? ((m["onsite_conversion.lead_grouped"] ?? 0) + (m["offsite_conversion.fb_pixel_lead"] ?? 0));
const conversasDe = (m: Record<string, number>) => m["onsite_conversion.messaging_conversation_started_7d"] ?? m["onsite_conversion.total_messaging_connection"] ?? 0;
function linhaMeta(r: Dict): Dict {
  const m = acoesMapa(r.actions);
  return { data: r.date_start, ad_id: r.ad_id, ad_name: r.ad_name, adset_id: r.adset_id, adset_name: r.adset_name, campaign_id: r.campaign_id, campaign_name: r.campaign_name, objective: r.objective,
    spend: r.spend, impressions: r.impressions, reach: r.reach, frequency: r.frequency, clicks: r.clicks, link_clicks: r.inline_link_clicks, leads: leadsDe(m), conversas: conversasDe(m), acoes: m };
}
async function coletarGrowth(opts: { dias?: number; inicio?: string; fim?: string; posts?: boolean }): Promise<Dict> {
  const token = await segredo("META_ACCESS_TOKEN"); const conta = await segredo("META_AD_ACCOUNT_ID"); const ig = await segredo("META_IG_USER_ID");
  if (!token || !conta) throw new Error("Falta META_ACCESS_TOKEN / META_AD_ACCOUNT_ID no Vault.");
  const fim = opts.fim ?? diasAtras(0); const inicio = opts.inicio ?? diasAtras(Math.max(1, Math.min(opts.dias ?? 3, 90)));
  const range = JSON.stringify({ since: inicio, until: fim });
  const avisos: string[] = [];
  const campos = "spend,impressions,reach,frequency,clicks,inline_link_clicks,actions";
  const anuncios = (await graphTodos(`${conta}/insights`, { level: "ad", fields: `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,objective,${campos}`, time_increment: "1", time_range: range, limit: "500" }, token)).map(linhaMeta);
  const contaDias = (await graphTodos(`${conta}/insights`, { fields: campos, time_increment: "1", time_range: range, limit: "500" }, token)).map((r) => { const m = acoesMapa(r.actions); return { data: r.date_start, spend: r.spend, impressions: r.impressions, reach: r.reach, frequency: r.frequency, clicks: r.clicks, link_clicks: r.inline_link_clicks, leads: leadsDe(m), conversas: conversasDe(m), acoes: m }; });
  const igDias: Dict[] = []; const igPosts: Dict[] = [];
  if (ig) {
    const porDia: Record<string, Dict> = {};
    try { // séries diárias (reach e follower_count aceitam period=day com valores por dia)
      const s = await graph(`${ig}/insights`, { metric: "reach,follower_count", period: "day", since: inicio, until: fim }, token);
      for (const m of (s.data as Dict[]) ?? []) for (const v of (m.values as Dict[]) ?? []) { const d = String(v.end_time).slice(0, 10); (porDia[d] ??= { data: d })[String(m.name)] = v.value; }
    } catch (e) { avisos.push(`IG séries: ${e instanceof Error ? e.message : e}`); }
    // métricas "total_value" só vêm agregadas no intervalo → uma chamada por dia (limitado a 30 dias por coleta)
    const dias: string[] = []; for (let d = new Date(fim + "T00:00:00Z"); diaISO(d) >= inicio && dias.length < 30; d.setUTCDate(d.getUTCDate() - 1)) dias.push(diaISO(d));
    for (const d of dias) {
      try {
        // total_value só aceita janela em timestamp Unix (00:00 → 00:00 do dia seguinte, horário de Brasília)
        const ini = Math.floor(new Date(d + "T03:00:00Z").getTime() / 1000), fimTs = ini + 86400;
        const t = await graph(`${ig}/insights`, { metric: "profile_views,accounts_engaged,total_interactions,website_clicks", period: "day", metric_type: "total_value", since: String(ini), until: String(fimTs) }, token);
        for (const m of (t.data as Dict[]) ?? []) (porDia[d] ??= { data: d })[String(m.name)] = (m.total_value as Dict | undefined)?.value ?? null;
      } catch (e) { avisos.push(`IG ${d}: ${e instanceof Error ? e.message : e}`); break; }
    }
    try { const p = await graph(ig, { fields: "followers_count" }, token); const hoje = diasAtras(0); (porDia[hoje] ??= { data: hoje }).followers_total = p.followers_count; } catch (e) { avisos.push(`IG perfil: ${e instanceof Error ? e.message : e}`); }
    igDias.push(...Object.values(porDia));
    if (opts.posts !== false) {
      try {
        const limite = diasAtras(60);
        const midias = (await graphTodos(`${ig}/media`, { fields: "id,timestamp,media_type,media_product_type,caption,permalink,like_count,comments_count", limit: "50" }, token, 2)).filter((m) => String(m.timestamp).slice(0, 10) >= limite);
        for (const m of midias.slice(0, 40)) {
          const linha: Dict = { id: m.id, publicado_em: m.timestamp, media_type: m.media_type, media_product_type: m.media_product_type, caption: m.caption, permalink: m.permalink, like_count: m.like_count, comments_count: m.comments_count };
          const metricas = m.media_product_type === "STORY" ? "reach,shares,views,total_interactions" : "reach,saved,shares,views,total_interactions";
          try { const i = await graph(`${m.id}/insights`, { metric: metricas }, token); for (const x of (i.data as Dict[]) ?? []) linha[String(x.name)] = ((x.values as Dict[])?.[0]?.value) ?? null; }
          catch (e) { linha.erro = e instanceof Error ? e.message : String(e); }
          igPosts.push(linha);
        }
      } catch (e) { avisos.push(`IG posts: ${e instanceof Error ? e.message : e}`); }
    }
  } else avisos.push("META_IG_USER_ID não configurado: Instagram ignorado.");
  const log = { ok: true, inicio, fim, avisos, anuncios: anuncios.length, conta_dias: contaDias.length, ig_dias: igDias.length, ig_posts: igPosts.length };
  const g = await rest("rpc/growth_gravar", service(), { method: "POST", body: JSON.stringify({ meta_anuncios: anuncios, meta_conta: contaDias, ig_dias: igDias, ig_posts: igPosts, log }) });
  if (!g.ok) throw new Error(`growth_gravar ${g.status}: ${(await g.text()).slice(0, 300)}`);
  return { ...log, gravado: await g.json() };
}
async function growth(req: Request): Promise<Response> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { ok: false, erro: "Token ausente." });
  const v = await rest("rpc/automacoes_token_valido", service(), { method: "POST", body: JSON.stringify({ token }) });
  if (!v.ok || (await v.json().catch(() => null)) !== true) return json(401, { ok: false, erro: "Token inválido." });
  const corpo = (await req.json().catch(() => ({}))) as Dict;
  try { return json(200, await coletarGrowth({ dias: Number(corpo.dias ?? 3), inicio: txt(corpo.inicio) ?? undefined, fim: txt(corpo.fim) ?? undefined, posts: corpo.posts !== false })); }
  catch (e) { const erro = e instanceof Error ? e.message : String(e); await rest("rpc/growth_gravar", service(), { method: "POST", body: JSON.stringify({ log: { ok: false, erro } }) }); return json(502, { ok: false, erro }); }
}

// ---------- Agenda ↔ Google Calendar (conta de serviço com delegação de domínio; JSON em GOOGLE_SA_JSON no Vault) ----------
const GCAL = "https://www.googleapis.com/calendar/v3";
const b64url = (b: ArrayBuffer | Uint8Array | string) => { const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b); let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const tokensGoogle = new Map<string, { token: string; exp: number }>();
async function tokenGoogle(sub: string | null): Promise<string> {
  const chave = sub ?? "@sa"; const c = tokensGoogle.get(chave); if (c && c.exp > Date.now() + 60_000) return c.token;
  const raw = await segredo("GOOGLE_SA_JSON"); if (!raw) throw new Error("GOOGLE_SA_JSON não configurado no Vault.");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const agora = Math.floor(Date.now() / 1000);
  const claims: Dict = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/calendar", aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 };
  if (sub) claims.sub = sub;
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const cabecalho = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })), corpo = b64url(JSON.stringify(claims));
  const assinatura = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${cabecalho}.${corpo}`));
  const jwt = `${cabecalho}.${corpo}.${b64url(assinatura)}`;
  const r = await fetch(claims.aud as string, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }), signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as Dict;
  if (!r.ok || !j.access_token) throw new Error(`Google não emitiu token${sub ? " para " + sub : ""}: ${String(j.error_description ?? j.error ?? r.status).slice(0, 160)}`);
  tokensGoogle.set(chave, { token: String(j.access_token), exp: Date.now() + Number(j.expires_in ?? 3600) * 1000 });
  return String(j.access_token);
}
// token para a agenda de um e-mail: tenta impersonar (Workspace); se não der, usa a própria conta de serviço (agenda compartilhada com ela)
async function tokenParaAgenda(email: string): Promise<{ token: string; modo: string }> {
  try { return { token: await tokenGoogle(email), modo: "delegacao" }; } catch (e) { const t = await tokenGoogle(null); return { token: t, modo: `compartilhada (${e instanceof Error ? e.message.slice(0, 80) : e})` }; }
}
async function gcal(token: string, metodo: string, path: string, body?: unknown, params?: Record<string, string>): Promise<{ status: number; json: Dict }> {
  const u = new URL(`${GCAL}/${path}`); for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u, { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const json = (r.status === 204 ? {} : await r.json().catch(() => ({}))) as Dict;
  return { status: r.status, json };
}
const TZ = "America/Sao_Paulo";
const diaLocal = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10); // BRT sem horário de verão
function corpoEvento(e: Dict): Dict {
  const inteiro = !!e.dia_inteiro;
  return { summary: e.titulo, location: e.local ?? undefined, description: e.descricao ?? undefined, status: e.cancelado ? "cancelled" : "confirmed",
    start: inteiro ? { date: diaLocal(String(e.inicio)) } : { dateTime: e.inicio, timeZone: TZ }, end: inteiro ? { date: diaLocal(String(e.fim)) } : { dateTime: e.fim, timeZone: TZ },
    extendedProperties: { private: { painel_id: String(e.id) } } };
}
function eventoDoGoogle(g: Dict): Dict | null {
  if (g.status === "cancelled") return { id: g.id, status: "cancelled" };
  const s = (g.start ?? {}) as Dict, f = (g.end ?? {}) as Dict; const inteiro = !!s.date;
  const inicio = inteiro ? `${s.date}T00:00:00-03:00` : s.dateTime, fim = inteiro ? `${f.date}T00:00:00-03:00` : f.dateTime;
  if (!inicio || !fim) return null;
  return { id: g.id, titulo: g.summary ?? "", inicio, fim, dia_inteiro: inteiro, local: g.location ?? null, descricao: g.description ?? null, link: g.htmlLink ?? null, etag: g.etag ?? null };
}
async function sincronizarAgenda(token: string, apenasColab?: string): Promise<Dict> {
  const rpc = (f: string, args: Dict) => rest(`rpc/${f}`, service(), { method: "POST", body: JSON.stringify(args) });
  const lote = await rpc("agenda_lote", { token }); if (!lote.ok) throw new Error(`agenda_lote ${lote.status}: ${(await lote.text()).slice(0, 200)}`);
  const colabs = (await lote.json()) as Dict[]; const resumo: Dict[] = [];
  for (const c of colabs) {
    if (apenasColab && c.colaborador_id !== apenasColab) continue;
    const cal = String(c.calendar_id); const r: Dict = { colaborador: c.nome, calendar: cal, enviados: 0, recebidos: 0, erros: [] as string[] };
    let gt: { token: string; modo: string };
    try { gt = await tokenParaAgenda(cal); r.modo = gt.modo; } catch (e) { r.erros = [e instanceof Error ? e.message : String(e)]; await rpc("agenda_gravar_google", { token, p_colab: c.colaborador_id, p_calendar: cal, eventos: [], p_sync_token: null, p_erro: (r.erros as string[])[0] }); resumo.push(r); continue; }
    // 1) painel → Google
    const marcados: Dict[] = [];
    for (const e of (c.pendentes as Dict[]) ?? []) {
      try {
        const corpo = corpoEvento(e); let res;
        if (e.google_event_id) {
          // ids do Google vêm da própria agenda (google_calendar_id); se o evento foi criado em outra agenda, cria de novo nesta
          const calEv = String(e.google_calendar_id ?? cal);
          res = await gcal(gt.token, e.cancelado ? "DELETE" : "PATCH", `calendars/${encodeURIComponent(calEv)}/events/${encodeURIComponent(String(e.google_event_id))}`, e.cancelado ? undefined : corpo);
          if (res.status === 404 || res.status === 410) { if (e.cancelado) { marcados.push({ id: e.id, ok: true }); continue; } res = await gcal(gt.token, "POST", `calendars/${encodeURIComponent(cal)}/events`, corpo); }
          else if (res.status < 300) { marcados.push({ id: e.id, ok: true, google_event_id: e.google_event_id, google_calendar_id: calEv, etag: res.json.etag ?? null }); r.enviados = (r.enviados as number) + 1; continue; }
        } else {
          if (e.cancelado) { marcados.push({ id: e.id, ok: true }); continue; }
          res = await gcal(gt.token, "POST", `calendars/${encodeURIComponent(cal)}/events`, corpo);
        }
        if (res.status < 300 && res.json.id) { marcados.push({ id: e.id, ok: true, google_event_id: res.json.id, google_calendar_id: cal, etag: res.json.etag ?? null }); r.enviados = (r.enviados as number) + 1; }
        else (r.erros as string[]).push(`${e.titulo}: Google ${res.status} ${String((res.json.error as Dict | undefined)?.message ?? "").slice(0, 100)}`);
      } catch (err) { (r.erros as string[]).push(`${e.titulo}: ${err instanceof Error ? err.message : err}`); }
    }
    if (marcados.length) await rpc("agenda_marcar_enviados", { token, itens: marcados });
    // 2) Google → painel (incremental com syncToken; completo na primeira vez ou se o token expirou)
    let syncToken: string | null = (c.sync_token as string | null) ?? null; let pagina: string | null = null; const recebidos: Dict[] = []; let novoSync: string | null = null; let erroPull: string | null = null;
    for (let i = 0; i < 20; i++) {
      const params: Record<string, string> = { maxResults: "250", singleEvents: "true", showDeleted: "true" };
      if (pagina) params.pageToken = pagina; else if (syncToken) params.syncToken = syncToken; else { params.timeMin = new Date(Date.now() - 30 * 864e5).toISOString(); params.timeMax = new Date(Date.now() + 120 * 864e5).toISOString(); }
      const res = await gcal(gt.token, "GET", `calendars/${encodeURIComponent(cal)}/events`, undefined, params);
      if (res.status === 410 && syncToken) { syncToken = null; pagina = null; continue; } // token expirado → completo
      if (res.status >= 300) { erroPull = `Google ${res.status} ${String((res.json.error as Dict | undefined)?.message ?? "").slice(0, 120)}`; break; }
      for (const g of (res.json.items as Dict[]) ?? []) { if ((((g.extendedProperties as Dict)?.private as Dict)?.painel_id)) continue; const ev = eventoDoGoogle(g); if (ev) recebidos.push(ev); } // os do painel já estão cá
      pagina = (res.json.nextPageToken as string) ?? null; novoSync = (res.json.nextSyncToken as string) ?? novoSync;
      if (!pagina) break;
    }
    const grav = await rpc("agenda_gravar_google", { token, p_colab: c.colaborador_id, p_calendar: cal, eventos: recebidos, p_sync_token: novoSync, p_erro: erroPull ?? ((r.erros as string[])[0] ?? null) });
    if (!grav.ok) (r.erros as string[]).push(`gravar: ${(await grav.text()).slice(0, 120)}`);
    r.recebidos = recebidos.length; if (erroPull) (r.erros as string[]).push(erroPull);
    resumo.push(r);
  }
  return { ok: true, colaboradores: resumo };
}
async function agenda(req: Request): Promise<Response> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { ok: false, erro: "Token ausente." });
  const v = await rest("rpc/automacoes_token_valido", service(), { method: "POST", body: JSON.stringify({ token }) });
  if (!v.ok || (await v.json().catch(() => null)) !== true) return json(401, { ok: false, erro: "Token inválido." });
  const corpo = (await req.json().catch(() => ({}))) as Dict;
  try { return json(200, await sincronizarAgenda(token, txt(corpo.colaborador_id) ?? undefined)); } catch (e) { return json(502, { ok: false, erro: e instanceof Error ? e.message : String(e) }); }
}

// ---------- Asaas (financeiro): ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, ASAAS_AMBIENTE no Vault ----------
async function asaasBase(): Promise<{ url: string; key: string } | string> {
  const key = await segredo("ASAAS_API_KEY");
  if (!key) return "Falta configurar ASAAS_API_KEY no Vault.";
  const amb = (await segredo("ASAAS_AMBIENTE")) || "producao";
  return { url: amb === "sandbox" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3", key };
}
async function asaas(c: { url: string; key: string }, path: string, init: { method?: string; body?: Dict } = {}): Promise<{ ok: boolean; status: number; dados: Dict }> {
  const r = await fetch(`${c.url}/${path}`, { method: init.method ?? "GET", headers: { access_token: c.key, "Content-Type": "application/json", "User-Agent": "PainelNevesPadua/1.0" }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(25_000) });
  const dados = (await r.json().catch(() => ({}))) as Dict;
  return { ok: r.ok, status: r.status, dados };
}
const asaasErro = (d: Dict) => { const e = (d.errors as { description?: string }[] | undefined)?.map((x) => x.description).filter(Boolean).join(" · "); return e || "erro do Asaas"; };
async function asaasListar(c: { url: string; key: string }, path: string, params: Record<string, string>): Promise<Dict[]> {
  const out: Dict[] = []; let offset = 0;
  for (let i = 0; i < 60; i++) {
    const q = new URLSearchParams({ ...params, limit: "100", offset: String(offset) });
    const r = await asaas(c, `${path}?${q}`);
    if (!r.ok) throw new Error(`Asaas ${path} (${r.status}): ${asaasErro(r.dados)}`);
    const data = (r.dados.data as Dict[] | undefined) ?? [];
    out.push(...data); offset += data.length;
    if (!r.dados.hasMore || !data.length) break;
  }
  return out;
}
// sincroniza clientes + cobranças (dias = janela por data de criação/vencimento; 0 = tudo)
async function asaasSincronizar(dias: number, por: string | null): Promise<Dict> {
  const c = await asaasBase(); if (typeof c === "string") throw new Error(c);
  const rpc = (f: string, args: Dict) => rest(`rpc/${f}`, service(), { method: "POST", body: JSON.stringify(args) });
  try {
    const clientes = await asaasListar(c, "customers", {});
    const desde = new Date(Date.now() - Math.max(1, dias) * 86400_000).toISOString().slice(0, 10);
    const p1 = dias > 0 ? await asaasListar(c, "payments", { "dateCreated[ge]": desde }) : await asaasListar(c, "payments", {});
    const p2 = dias > 0 ? await asaasListar(c, "payments", { "dueDate[ge]": desde }) : [];
    const vistos = new Set<string>(); const cobrancas: Dict[] = [];
    for (const p of [...p1, ...p2]) { const id = String(p.id); if (!vistos.has(id)) { vistos.add(id); cobrancas.push(p); } }
    const g = await rpc("asaas_sincronizar_gravar", { token: "", clientes, cobrancas, p_erro: null, p_por: por });
    if (!g.ok) throw new Error(`Não foi possível gravar: ${(await g.text()).slice(0, 200)}`);
    return { ok: true, ...(await g.json() as Dict) };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await rpc("asaas_sincronizar_gravar", { token: "", clientes: [], cobrancas: [], p_erro: erro, p_por: por });
    throw e;
  }
}
async function asaasRota(req: Request, url: URL): Promise<Response> {
  if (url.pathname.endsWith("/webhook")) { // Asaas → sistema (cabeçalho asaas-access-token)
    const esperado = await segredo("ASAAS_WEBHOOK_TOKEN");
    const tk = req.headers.get("asaas-access-token") ?? "";
    if (!esperado || !igual(tk, esperado)) return json(401, { ok: false, erro: "Token do webhook inválido." });
    const corpo = (await req.json().catch(() => null)) as Dict | null;
    if (!corpo) return json(400, { ok: false, erro: "Corpo inválido." });
    const r = await rest("rpc/asaas_webhook_gravar", service(), { method: "POST", body: JSON.stringify({ corpo }) });
    if (!r.ok) return json(500, { ok: false, erro: (await r.text()).slice(0, 200) });
    return json(200, await r.json());
  }
  // cron → sincronização (token das automações)
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return json(401, { ok: false, erro: "Token ausente." });
  const v = await rest("rpc/automacoes_token_valido", service(), { method: "POST", body: JSON.stringify({ token }) });
  if (!v.ok || (await v.json().catch(() => null)) !== true) return json(401, { ok: false, erro: "Token inválido." });
  const corpo = (await req.json().catch(() => ({}))) as Dict;
  try { return json(200, await asaasSincronizar(Number(corpo.dias ?? 60), null)); }
  catch (e) { return json(502, { ok: false, erro: e instanceof Error ? e.message : String(e) }); }
}
// ações do painel (sessão do usuário; permissão conferida no banco por pode_financeiro)
async function asaasAcao(acao: string, corpo: Dict, jwt: string): Promise<Response> {
  const pf = await rest("rpc/pode_financeiro", jwt, { method: "POST", body: "{}" });
  if (!pf.ok || (await pf.json().catch(() => null)) !== true) return json(403, { ok: false, erro: "Sem permissão para o financeiro." });
  const c = await asaasBase(); if (typeof c === "string") return json(500, { ok: false, erro: c });
  if (acao === "asaas_testar") { const r = await asaas(c, "myAccount"); return r.ok ? json(200, { ok: true, conta: { nome: r.dados.name, email: r.dados.email, cnpj: r.dados.cpfCnpj }, ambiente: c.url.includes("sandbox") ? "sandbox" : "produção" }) : json(502, { ok: false, erro: `Asaas recusou (${r.status}): ${asaasErro(r.dados)}` }); }
  if (acao === "asaas_sincronizar") {
    try { return json(200, await asaasSincronizar(Number(corpo.dias ?? 0), null)); } catch (e) { return json(502, { ok: false, erro: e instanceof Error ? e.message : String(e) }); }
  }
  if (acao === "asaas_cobrar") {
    const clienteId = String(corpo.cliente_id ?? ""); const tipo = String(corpo.tipo ?? "outro"); const valor = Number(corpo.valor); const venc = String(corpo.vencimento ?? "");
    const forma = ["BOLETO", "PIX", "UNDEFINED", "CREDIT_CARD"].includes(String(corpo.forma)) ? String(corpo.forma) : "UNDEFINED";
    const parcelas = Math.max(1, Math.min(60, Number(corpo.parcelas ?? 1) || 1)); const descricao = String(corpo.descricao ?? "").trim();
    if (!clienteId || !(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return json(400, { ok: false, erro: "Informe cliente, valor e vencimento." });
    const rd = await rest("rpc/asaas_dados_cliente", jwt, { method: "POST", body: JSON.stringify({ p_cliente: clienteId }) });
    const d = rd.ok ? ((await rd.json()) as Dict | null) : null;
    if (!d) return json(404, { ok: false, erro: "Cliente não encontrado." });
    let customer = txt(d.asaas_id);
    if (!customer) { // procura pelo CPF/CNPJ; senão cria
      if (!d.cpf_cnpj) return json(400, { ok: false, erro: "O cliente precisa ter CNPJ/CPF na ficha para ser cadastrado no Asaas." });
      const busca = await asaas(c, `customers?cpfCnpj=${d.cpf_cnpj}`);
      let cust = ((busca.dados.data as Dict[] | undefined) ?? [])[0];
      if (!cust) {
        const cr = await asaas(c, "customers", { method: "POST", body: { name: d.nome, cpfCnpj: d.cpf_cnpj, email: d.email ?? undefined, mobilePhone: d.telefone ?? undefined, externalReference: clienteId, notificationDisabled: corpo.sem_notificacao_asaas === true } });
        if (!cr.ok) return json(502, { ok: false, erro: `Asaas não criou o cliente: ${asaasErro(cr.dados)}` });
        cust = cr.dados;
      }
      customer = String(cust.id);
      await rest("rpc/asaas_cliente_gravar", jwt, { method: "POST", body: JSON.stringify({ p_cliente: clienteId, p_asaas: cust }) });
    }
    const body: Dict = { customer, billingType: forma, dueDate: venc, description: descricao || undefined, externalReference: `${clienteId}|${tipo}` };
    if (parcelas > 1) { body.installmentCount = parcelas; body.totalValue = valor; } else body.value = valor;
    const pr = await asaas(c, "payments", { method: "POST", body });
    if (!pr.ok) return json(502, { ok: false, erro: `Asaas não criou a cobrança: ${asaasErro(pr.dados)}` });
    let pagamentos: Dict[] = [pr.dados];
    if (parcelas > 1 && pr.dados.installment) { const li = await asaas(c, `installments/${pr.dados.installment}/payments?limit=100`); if (li.ok && Array.isArray(li.dados.data)) pagamentos = li.dados.data as Dict[]; }
    const g = await rest("rpc/asaas_cobranca_gravar", jwt, { method: "POST", body: JSON.stringify({ p_cliente: clienteId, p_tipo: tipo, p_contrato: txt(corpo.contrato_id), p_acordo: txt(corpo.acordo_id), p_pagamentos: pagamentos }) });
    if (!g.ok) return json(200, { ok: true, aviso: "Cobrança criada no Asaas, mas não foi gravada no sistema: " + (await g.text()).slice(0, 160), pagamentos: pagamentos.length });
    return json(200, { ok: true, pagamentos: pagamentos.length, link: txt(pagamentos[0].invoiceUrl) });
  }
  if (acao === "asaas_pix") { // copia-e-cola do Pix de uma cobrança
    const id = String(corpo.asaas_id ?? ""); if (!/^pay_\w+$/.test(id)) return json(400, { ok: false, erro: "Cobrança inválida." });
    const r = await asaas(c, `payments/${id}/pixQrCode`);
    return r.ok ? json(200, { ok: true, payload: r.dados.payload, imagem: r.dados.encodedImage, expira: r.dados.expirationDate }) : json(502, { ok: false, erro: asaasErro(r.dados) });
  }
  return json(400, { ok: false, erro: "Ação inválida." });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^\/chatguru\/?/, "").replace(/\/$/, "");
  if (req.method !== "POST") return json(405, { ok: false, erro: "Use POST." });
  try {
    if (rota === "webhook") return await webhook(req, url);
    if (rota === "enviar") return await enviar(req);
    if (rota === "site") return await siteFormulario(req);
    if (rota === "automacoes") return await automacoes(req);
    if (rota === "resumo") return await resumo(req);
    if (rota === "growth") return await growth(req);
    if (rota === "agenda") return await agenda(req);
    if (rota === "asaas" || rota === "asaas/webhook") return await asaasRota(req, url);
    if (rota === "diag") { // só com o token do webhook; não expõe valores
      const esperado = await segredo("CHATGURU_WEBHOOK_TOKEN");
      const tk = url.searchParams.get("token") ?? "";
      const ambiente = Object.fromEntries(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS"].map((n) => [n, env(n) ? (env(n).trim().startsWith("[") ? "array" : env(n).trim().startsWith("{") ? "objeto" : "texto") : "vazio"]));
      if (esperado && igual(tk, esperado)) return json(200, { ok: true, anon: !!ANON, service: !!SERVICE, ambiente, segredos: Object.keys(cacheSeg ?? {}), rpc: ultimoRpc });
      return json(401, { ok: false, anon: !!ANON, service: !!SERVICE, ambiente, rpc: ultimoRpc });
    }
    return json(404, { ok: false, erro: "Rota desconhecida." });
  } catch (e) {
    const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return json(tempo ? 504 : 500, { ok: false, erro: tempo ? "O ChatGuru não respondeu a tempo." : `Falha: ${e instanceof Error ? e.message : String(e)}` });
  }
});
