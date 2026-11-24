// Edge Function "sync" — conector do AtendeDireito Sync. Em produção desde 24/11/2026 (ver README.md nesta pasta).
// Rotas (POST):
//   /sync/webhook   ← fornecedor. Sem JWT; vale a assinatura HMAC-SHA256 (cabeçalho X-Webhook-Signature) com SYNC_WEBHOOK_SECRET.
//                     DESLIGADA por padrão: só responde com SYNC_WEBHOOK_ATIVO=1 (a ligar depois de confirmado, em teste real, o formato da assinatura).
//   /sync/agendado  ← pg_cron (Bearer do token das automações, conferido por automacoes_token_valido): mesma consulta do /puxar, sem pessoa.
//   /sync/carteira  ← painel (JWT de quem é do Jurídico): atualiza o retrato dos autos (capa, partes, movimentos, documentos, audiências) de até 40 processos.
//   /sync/puxar     ← painel (JWT de quem é do Jurídico ou administradora): consulta as intimações e os prazos da janela configurada.
//   /sync/testar    ← painel (JWT da administradora): confere a chave com GET /v1/conta. Funciona com a integração desligada.
//   /sync/amostra   ← painel (JWT da administradora): consulta até 5 registros e devolve só os nomes e tipos dos campos, para
//                     confirmar o formato real das respostas. Não grava publicação. Sem essa confirmação, /puxar não ingere nada.
// Segredos — só em variáveis de ambiente da função, nunca no navegador, no banco ou no repositório:
//   SYNC_API_KEY (chave "sk_live_…" criada na conta do escritório) e SYNC_WEBHOOK_SECRET (o mesmo segredo informado ao cadastrar o webhook).
// Sem SYNC_API_KEY a função responde "sem_credencial"; sem SYNC_WEBHOOK_SECRET todo webhook é recusado.
// Só leitura no fornecedor: esta função não chama nenhuma rota de escrita do Sync (tratar, ciência, monitorar, importar).
// Deploy com "Verify JWT" desligado (o webhook não tem JWT); cada rota faz a própria autenticação.
import { amostrar, clienteSync, puxar, puxarCarteira, receberWebhook, testarConexao } from "./adaptador.mjs";

type Dict = Record<string, unknown>;
const env = (n: string) => Deno.env.get(n) ?? "";
function achaChave(v: unknown): string {
  if (typeof v === "string") return /^(sb_|eyJ)/.test(v) ? v : "";
  if (Array.isArray(v)) { for (const x of v) { const r = achaChave(x); if (r) return r; } return ""; }
  if (v && typeof v === "object") { for (const x of Object.values(v as Dict)) { const r = achaChave(x); if (r) return r; } }
  return "";
}
function chaveDe(legado: string, dict: string): string { try { const n = achaChave(JSON.parse(env(dict) || "{}")); if (n) return n; } catch { /* sem dicionário */ } return env(legado); }
const ANON = chaveDe("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
const SERVICE = chaveDe("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");   // injetada pelo Supabase; não sai do servidor
const cab = (chave: string, bearer = chave) => ({ apikey: chave, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" });
// CORS: só o painel chama /puxar e /testar pelo navegador; o webhook é servidor a servidor e não recebe cabeçalho de CORS.
const ORIGEM = env("PAINEL_URL") || "https://sistema.nevespaduaadvocacia.com.br";
const json = (status: number, body: unknown, cors = true) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
  ...(cors ? { "Access-Control-Allow-Origin": ORIGEM, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } : {}) } });
const MAX_CORPO = 256 * 1024;   // webhook: corpo acima disso é recusado antes de qualquer processamento

async function rpcComo(chave: string, bearer: string, nome: string, args: Dict = {}): Promise<unknown> {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${nome}`, { method: "POST", headers: cab(chave, bearer), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${nome}: ${r.status}`);            // sem corpo de erro no log: pode conter dado de processo
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const db = { rpc: (nome: string, args: Dict = {}) => rpcComo(SERVICE, SERVICE, nome, args) };
// Só para o teste local em Deno: permite apontar o cliente para um fornecedor simulado NA PRÓPRIA MÁQUINA. Fora de 127.0.0.1/localhost
// a variável é ignorada — a chave nunca é enviada a outro endereço que não o do fornecedor.
const BASE_LOCAL = env("SYNC_TESTE_LOCAL") === "1" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env("SYNC_API_BASE")) ? env("SYNC_API_BASE") : undefined;
const cliente = () => clienteSync({ chave: env("SYNC_API_KEY"), ...(BASE_LOCAL ? { base: BASE_LOCAL } : {}) });

async function quem(req: Request): Promise<{ id: string; admin: boolean; juridico: boolean } | null> {
  const tk = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tk) return null;
  const u = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tk}` } });
  if (!u.ok) return null;
  const id = ((await u.json()) as Dict).id as string;
  const admin = (await rpcComo(ANON, tk, "sou_admin").catch(() => false)) === true;
  const juridico = admin || (await rpcComo(ANON, tk, "tem_acesso", { area: "juridico" }).catch(() => false)) === true;   // a permissão é a do banco, não a da tela
  return { id, admin, juridico };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, {});
  if (req.method !== "POST") return json(405, { erro: "metodo" });
  const rota = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop();
  if (!SERVICE || !ANON || !env("SUPABASE_URL")) return json(503, { erro: "configuracao" });   // sem as chaves do projeto, nada funciona (fecha em vez de abrir)
  try {
    if (rota === "webhook") {
      if (env("SYNC_WEBHOOK_ATIVO") !== "1" || !env("SYNC_WEBHOOK_SECRET")) return json(404, { erro: "rota" }, false);
      if (Number(req.headers.get("content-length") || "0") > MAX_CORPO) return json(413, { erro: "corpo" }, false);
      const corpoBruto = await req.text();
      if (corpoBruto.length > MAX_CORPO) return json(413, { erro: "corpo" }, false);
      const r = await receberWebhook({ db, cliente, corpoBruto, assinatura: req.headers.get("x-webhook-signature") || "", segredo: env("SYNC_WEBHOOK_SECRET") });
      return json(r.http, { status: r.status }, false);
    }
    if (rota === "agendado") {   // pg_cron: mesmo token das automações já usado pelos outros agendamentos (conferido no banco)
      const tk = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
      if (!tk) return json(401, { erro: "sem_token" }, false);
      const v = await rpcComo(SERVICE, SERVICE, "automacoes_token_valido", { token: tk }).catch(() => false);
      if (v !== true) return json(401, { erro: "token" }, false);
      const r = await puxar({ db, cliente, origem: "agendada" });
      const k = await puxarCarteira({ db, cliente, limite: 40 }).catch(() => ({ status: "erro" }));   // autos: capa, partes, movimentos, documentos e audiências
      return json(200, { status: r.status, resumo: r.resumo ?? null, carteira: k }, false);
    }
    const p = await quem(req);
    if (!p) return json(401, { erro: "sem_login" });
    if (rota === "testar") { if (!p.admin) return json(403, { erro: "so_administradora" }); return json(200, await testarConexao({ db, cliente })); }
    if (rota === "amostra") { if (!p.admin) return json(403, { erro: "so_administradora" }); return json(200, await amostrar({ db, cliente })); }   // só a forma das respostas, sem conteúdo
    if (rota === "carteira") {   // retrato dos autos por processo; até 40 por chamada (a tela repete enquanto houver restantes)
      if (!p.juridico) return json(403, { erro: "so_juridico" });
      return json(200, await puxarCarteira({ db, cliente, limite: 40 }));
    }
    if (rota === "puxar") { if (!p.juridico) return json(403, { erro: "so_juridico" }); const r = await puxar({ db, cliente, origem: "manual", por: p.id }); return json(200, { status: r.status, resumo: r.resumo ?? null, categoria: r.categoria ?? null }); }
    return json(404, { erro: "rota" });
  } catch (_e) {
    return json(500, { erro: "interno" });                               // sem detalhe na resposta nem no log
  }
});
