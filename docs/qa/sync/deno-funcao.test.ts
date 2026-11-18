// Execução REAL da função de servidor (supabase/functions/sync/index.ts) em Deno, com Supabase e fornecedor SIMULADOS na
// própria máquina. Nenhuma chamada externa; nenhuma credencial real. A função é iniciada como processo separado, com as
// variáveis de ambiente de cada cenário, e exercitada por HTTP como seria em produção.
// Uso: deno test --allow-net=127.0.0.1 --allow-run --allow-env --allow-read docs/qa/sync/deno-funcao.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";

const PORTA_SB = 54991, PORTA_FORN = 54992, PORTA_FN = 8000;
const SERVICE = "sb_secret_ficticia_de_teste", ANON = "sb_publishable_ficticia", CHAVE = "sk_teste_ficticia_nao_real", SEGREDO = "segredo-webhook-ficticio";
type Est = { ativo: boolean; config: Record<string, unknown>; rpcs: { nome: string; auth: string; corpo: unknown }[]; pubs: unknown[]; forn: { caminho: string; auth: string | null }[]; fornResp: (c: string) => Response };
const est: Est = { ativo: false, config: {}, rpcs: [], pubs: [], forn: [], fornResp: () => Response.json({ itens: [] }) };
const USUARIOS: Record<string, { id: string; admin: boolean; juridico: boolean }> = { "tok-admin": { id: "u-admin", admin: true, juridico: true }, "tok-jur": { id: "u-jur", admin: false, juridico: true }, "tok-com": { id: "u-com", admin: false, juridico: false } };

const sb = Deno.serve({ port: PORTA_SB, hostname: "127.0.0.1", onListen() {} }, async (req) => {
  const u = new URL(req.url), tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (u.pathname === "/auth/v1/user") { const p = USUARIOS[tk]; return p ? Response.json({ id: p.id }) : new Response("{}", { status: 401 }); }
  if (u.pathname.startsWith("/rest/v1/rpc/")) {
    const nome = u.pathname.split("/").pop()!, corpo = await req.json().catch(() => ({}));
    est.rpcs.push({ nome, auth: tk === SERVICE ? "service" : USUARIOS[tk] ? "usuario" : "outro", corpo });
    if (nome === "sou_admin") return Response.json(!!USUARIOS[tk]?.admin);
    if (nome === "tem_acesso") return Response.json(!!USUARIOS[tk]?.juridico);
    if (tk !== SERVICE) return new Response('{"code":"42501"}', { status: 403 });   // como no banco: só o servidor chama as rpcs do conector
    if (nome === "sync_config_ler") return Response.json({ ativo: est.ativo, config: est.config });
    if (nome === "sync_execucao_abrir") return Response.json(1);
    if (nome === "sync_evento_registrar") return Response.json({ id: 1, status: corpo.p_assinatura_ok === false ? "assinatura_invalida" : est.ativo ? "novo" : "ignorado_desligada" });
    if (nome === "sync_receber_intimacao") { est.pubs.push(corpo.p); return Response.json({ acao: "nova", prazos_novos: 0 }); }
    return new Response("null", { headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
});
const forn = Deno.serve({ port: PORTA_FORN, hostname: "127.0.0.1", onListen() {} }, (req) => { const u = new URL(req.url); est.forn.push({ caminho: u.pathname, auth: req.headers.get("authorization") }); return est.fornResp(u.pathname); });

async function comFuncao(envExtra: Record<string, string>, f: (chamar: (rota: string, init?: RequestInit) => Promise<{ status: number; corpo: Record<string, unknown>; cab: Headers; bruto: string }>, saida: () => Promise<string>) => Promise<void>) {
  est.rpcs = []; est.pubs = []; est.forn = [];
  const env: Record<string, string> = { SUPABASE_URL: `http://127.0.0.1:${PORTA_SB}`, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SYNC_TESTE_LOCAL: "1", SYNC_API_BASE: `http://127.0.0.1:${PORTA_FORN}`, PATH: Deno.env.get("PATH") || "", HOME: Deno.env.get("HOME") || "", DENO_DIR: Deno.env.get("DENO_DIR") || "", ...envExtra };
  for (const k of Object.keys(env)) if (env[k] === "") delete env[k];
  const p = new Deno.Command(Deno.execPath(), { args: ["run", `--allow-net=127.0.0.1:${PORTA_SB},127.0.0.1:${PORTA_FORN},0.0.0.0:${PORTA_FN},api.sync.atendedireito.app:443`, "--allow-env", "supabase/functions/sync/index.ts"], env, clearEnv: true, stdout: "piped", stderr: "piped" }).spawn();
  let no_ar = false; for (let i = 0; i < 80 && !no_ar; i++) { try { const r = await fetch(`http://127.0.0.1:${PORTA_FN}/sync/x`, { method: "GET" }); await r.body?.cancel(); no_ar = true; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  assert(no_ar, "a função não subiu");
  const chamar = async (rota: string, init: RequestInit = {}) => { const r = await fetch(`http://127.0.0.1:${PORTA_FN}/sync/${rota}`, { method: "POST", ...init }); const bruto = await r.text(); let corpo = {}; try { corpo = JSON.parse(bruto); } catch { /* */ } return { status: r.status, corpo, cab: r.headers, bruto }; };
  let saidaTxt: string | null = null;
  const saida = async () => { if (saidaTxt !== null) return saidaTxt; try { p.kill("SIGTERM"); } catch { /* */ } const o = await p.output(); saidaTxt = new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr); return saidaTxt; };
  try { await f(chamar, saida); } finally { await saida(); }
}
const cab = (tok: string) => ({ headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: "{}" });
const hmac = async (seg: string, corpo: string) => { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(seg), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo)))].map((b) => b.toString(16).padStart(2, "0")).join(""); };
const intim = (id: string) => ({ id, numero_processo: "0001234-56.2026.8.26.0100", data_publicacao: "2026-11-16", texto: "Texto fictício " + id });
const o = { sanitizeOps: false, sanitizeResources: false };

Deno.test("D01 rotas: só POST; rota desconhecida 404; sem login 401 em todas as rotas do painel", o, async () => {
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => {
    const g = await fetch(`http://127.0.0.1:${PORTA_FN}/sync/puxar`); await g.body?.cancel(); assertEquals(g.status, 405);
    for (const r of ["puxar", "testar", "amostra", "qualquer"]) assertEquals((await chamar(r)).status, 401, r);
    assertEquals((await chamar("inexistente", cab("tok-admin"))).status, 404);
    assertEquals((await chamar("puxar", cab("token-forjado"))).status, 401);
    assertEquals(est.forn.length, 0);
  });
});
Deno.test("D02 autorização vem do banco: comercial 403 em tudo; Jurídico puxa mas não testa nem amostra; administradora pode os três", o, async () => {
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => {
    for (const r of ["puxar", "testar", "amostra"]) assertEquals((await chamar(r, cab("tok-com"))).status, 403, r);
    assertEquals((await chamar("testar", cab("tok-jur"))).status, 403); assertEquals((await chamar("amostra", cab("tok-jur"))).status, 403);
    assertEquals((await chamar("puxar", cab("tok-jur"))).status, 200);
    est.fornResp = () => Response.json({}); assertEquals((await chamar("testar", cab("tok-admin"))).corpo.ok, true);
    assert(est.rpcs.filter((r) => r.nome === "sou_admin").every((r) => r.auth === "usuario"), "o papel é lido com o token da própria pessoa");
  });
});
Deno.test("D03 integração DESLIGADA: /puxar não consulta o fornecedor e não entrega nada", o, async () => {
  est.ativo = false; est.config = { contrato_confirmado: true };
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => {
    const r = await chamar("puxar", cab("tok-jur")); assertEquals(r.status, 200); assertEquals(r.corpo.status, "desligada");
    assertEquals(est.forn.length, 0); assertEquals(est.pubs.length, 0); assert(!est.rpcs.some((x) => x.nome === "sync_receber_intimacao"));
  });
});
Deno.test("D04 ligada, mas sem o contrato confirmado: nenhuma consulta e nenhuma ingestão", o, async () => {
  est.ativo = true; est.config = {};
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => { const r = await chamar("puxar", cab("tok-jur")); assertEquals(r.corpo.status, "aguardando_contrato"); assertEquals(est.forn.length, 0); assertEquals(est.pubs.length, 0); });
});
Deno.test("D05 webhook DESATIVADO por padrão: 404 mesmo com assinatura válida; nada registrado, nada consultado", o, async () => {
  est.ativo = true; est.config = { contrato_confirmado: true };
  const corpo = '{"evento":"intimacao.criada"}', ass = await hmac(SEGREDO, corpo);
  await comFuncao({ SYNC_API_KEY: CHAVE, SYNC_WEBHOOK_SECRET: SEGREDO }, async (chamar) => {
    const r = await chamar("webhook", { headers: { "x-webhook-signature": ass }, body: corpo }); assertEquals(r.status, 404); assertEquals(est.rpcs.length, 0); assertEquals(est.forn.length, 0);
  });
  await comFuncao({ SYNC_API_KEY: CHAVE, SYNC_WEBHOOK_ATIVO: "1" }, async (chamar) => { assertEquals((await chamar("webhook", { headers: { "x-webhook-signature": ass }, body: corpo })).status, 404, "sem segredo configurado continua fechado"); });
});
Deno.test("D06 webhook ligado de propósito: assinatura inválida 401 sem guardar o corpo; válida 200; corpo grande 413; sem cabeçalho de CORS", o, async () => {
  est.ativo = true; est.config = { contrato_confirmado: true }; est.fornResp = () => Response.json({ itens: [] });
  const corpo = '{"evento":"intimacao.criada","dado":"SIGILOSO"}', ass = await hmac(SEGREDO, corpo);
  await comFuncao({ SYNC_API_KEY: CHAVE, SYNC_WEBHOOK_SECRET: SEGREDO, SYNC_WEBHOOK_ATIVO: "1" }, async (chamar) => {
    const ruim = await chamar("webhook", { headers: { "x-webhook-signature": "00ff" }, body: corpo }); assertEquals(ruim.status, 401); assertEquals(ruim.cab.get("access-control-allow-origin"), null);
    const reg = est.rpcs.find((r) => r.nome === "sync_evento_registrar")!; assertEquals((reg.corpo as Record<string, unknown>).p_corpo, null); assert(!JSON.stringify(reg.corpo).includes("SIGILOSO")); assertEquals(est.forn.length, 0);
    assertEquals((await chamar("webhook", { headers: { "x-webhook-signature": ass }, body: corpo })).status, 200);
    assertEquals((await chamar("webhook", { headers: { "x-webhook-signature": "x" }, body: "a".repeat(300 * 1024) })).status, 413);
  });
});
Deno.test("D07 credenciais: a chave do fornecedor só aparece no cabeçalho enviado a ele; nunca em resposta, registro ou saída do processo; a chave de serviço idem", o, async () => {
  est.ativo = true; est.config = { contrato_confirmado: true, itens_por_pagina: 2 }; est.fornResp = (c) => c === "/v1/prazos" ? Response.json({ itens: [] }) : Response.json({ itens: [intim("a1")] });
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar, saida) => {
    const r = await chamar("puxar", cab("tok-jur")); assertEquals(r.corpo.status, "ok"); assertEquals(est.pubs.length, 1);
    assert(est.forn.length >= 2 && est.forn.every((x) => x.auth === `Bearer ${CHAVE}`));
    est.fornResp = () => new Response("{}", { status: 401 }); const e = await chamar("puxar", cab("tok-jur"));
    // o texto da intimação só pode aparecer na entrega ao banco (sync_receber_intimacao); em nenhum outro lugar
    const tudo = r.bruto + e.bruto + JSON.stringify(est.rpcs.filter((x) => x.nome !== "sync_receber_intimacao")) + await saida();
    for (const s of [CHAVE, SERVICE, "Texto fictício a1"]) assert(!tudo.includes(s), "vazou: " + s.slice(0, 8));
    assert(!JSON.stringify(est.rpcs).includes(CHAVE), "a chave do fornecedor não vai para o banco");
    assertEquals(e.corpo.categoria, "autenticacao");
  });
});
Deno.test("D08 sem a chave do fornecedor: erro claro de credencial, sem consulta; sem as chaves do projeto: 503 (fecha, não opera pela metade)", o, async () => {
  est.ativo = true; est.config = { contrato_confirmado: true };
  await comFuncao({}, async (chamar) => { assertEquals((await chamar("testar", cab("tok-admin"))).corpo, { ok: false, categoria: "sem_credencial" }); assertEquals(est.forn.length, 0); });
  await comFuncao({ SYNC_API_KEY: CHAVE, SUPABASE_SERVICE_ROLE_KEY: "" }, async (chamar) => { assertEquals((await chamar("puxar", cab("tok-jur"))).status, 503); });
});
Deno.test("D09 resposta desconhecida NÃO vira lista vazia nem sucesso: formato estranho, HTML, 500 e 429 terminam como erro registrado, sem publicação", o, async () => {
  est.ativo = true; est.config = { contrato_confirmado: true, max_paginas: 1 };
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => {
    for (const [nome, resp, cat] of [["objeto sem lista", () => Response.json({ sucesso: true, coisa: {} }), "formato"], ["HTML", () => new Response("<html>manutenção</html>", { headers: { "content-type": "text/html" } }), "formato"], ["500", () => new Response("{}", { status: 500 }), "indisponivel"], ["429", () => new Response("{}", { status: 429, headers: { "retry-after": "0" } }), "limite"]] as [string, () => Response, string][]) {
      est.fornResp = resp; est.pubs = []; const r = await chamar("puxar", cab("tok-jur"));
      assertEquals(r.corpo.status, "erro", nome); assertEquals(r.corpo.categoria, cat, nome); assertEquals(est.pubs.length, 0, nome);
    }
  });
});
Deno.test("D10 quarentena preservada: item sem os campos obrigatórios não é entregue; fica registrado só com os nomes dos campos; a execução sai como parcial", o, async () => {
  est.ativo = true; est.config = { contrato_confirmado: true }; est.fornResp = (c) => c === "/v1/prazos" ? Response.json({ itens: [] }) : Response.json({ itens: [{ uuid: "x", conteudo: "TEXTO SIGILOSO" }, intim("a2")] });
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => {
    const r = await chamar("puxar", cab("tok-jur")); assertEquals(r.corpo.status, "parcial"); assertEquals((r.corpo.resumo as Record<string, number>).quarentena, 1); assertEquals(est.pubs.length, 1);
    const q = est.rpcs.find((x) => x.nome === "sync_quarentena_registrar")!; assertEquals((q.corpo as Record<string, unknown>).p_campos, ["conteudo", "uuid"]); assert(!JSON.stringify(est.rpcs).includes("SIGILOSO"));
  });
});
Deno.test("D11 amostra: só nomes e tipos de campo, no máximo 5 registros pedidos, nenhuma entrega; erros internos não vazam detalhe", o, async () => {
  est.ativo = false; est.config = {}; est.fornResp = () => Response.json({ dados: [{ numero: "0001234-56.2026.8.26.0100", conteudo: "SIGILOSO" }] });
  await comFuncao({ SYNC_API_KEY: CHAVE }, async (chamar) => {
    const r = await chamar("amostra", cab("tok-admin")); assertEquals(r.corpo.ok, true); assert(!r.bruto.includes("SIGILOSO") && !r.bruto.includes("0001234")); assertEquals(est.pubs.length, 0);
    assertEquals(r.cab.get("cache-control"), "no-store"); assertEquals(r.cab.get("access-control-allow-origin"), "https://sistema.nevespaduaadvocacia.com.br");
  });
});
Deno.test("D12 a variável de teste não desvia a chave para fora: endereço que não é da própria máquina é ignorado", o, async () => {
  est.fornResp = () => Response.json({});
  await comFuncao({ SYNC_API_KEY: CHAVE, SYNC_API_BASE: "http://exemplo.invalid:80" }, async (chamar) => {
    const r = await chamar("testar", cab("tok-admin")); assertEquals(est.forn.length, 0); assertEquals(r.corpo.ok, false);   // tentou o endereço oficial; no teste a rede externa não é permitida
  });
  await sb.shutdown(); await forn.shutdown();
});
