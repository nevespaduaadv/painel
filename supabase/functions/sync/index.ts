// Edge Function "sync" — conector do AtendeDireito Sync. NÃO IMPLANTADA: este arquivo entra no repositório para revisão;
// a implantação, os segredos e a ativação dependem de autorização específica (ver README.md nesta pasta).
// Rotas (POST):
//   /sync/webhook   ← fornecedor. Sem JWT; vale a assinatura HMAC-SHA256 (cabeçalho X-Webhook-Signature) com SYNC_WEBHOOK_SECRET.
//   /sync/puxar     ← painel (JWT de quem é do Jurídico ou administradora): consulta as intimações e os prazos da janela configurada.
//   /sync/testar    ← painel (JWT da administradora): confere a chave com GET /v1/conta. Funciona com a integração desligada.
// Segredos — só em variáveis de ambiente da função, nunca no navegador, no banco ou no repositório:
//   SYNC_API_KEY (chave "sk_live_…" criada na conta do escritório) e SYNC_WEBHOOK_SECRET (o mesmo segredo informado ao cadastrar o webhook).
// Sem SYNC_API_KEY a função responde "sem_credencial"; sem SYNC_WEBHOOK_SECRET todo webhook é recusado.
// Só leitura no fornecedor: esta função não chama nenhuma rota de escrita do Sync (tratar, ciência, monitorar, importar).
// Deploy com "Verify JWT" desligado (o webhook não tem JWT); cada rota faz a própria autenticação.
import { clienteSync, puxar, receberWebhook, testarConexao } from "./adaptador.mjs";

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
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });

async function rpcComo(chave: string, bearer: string, nome: string, args: Dict = {}): Promise<unknown> {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${nome}`, { method: "POST", headers: cab(chave, bearer), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${nome}: ${r.status}`);            // sem corpo de erro no log: pode conter dado de processo
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const db = { rpc: (nome: string, args: Dict = {}) => rpcComo(SERVICE, SERVICE, nome, args) };
const cliente = () => clienteSync({ chave: env("SYNC_API_KEY") });

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
  try {
    if (rota === "webhook") {
      const corpoBruto = await req.text();
      const r = await receberWebhook({ db, cliente, corpoBruto, assinatura: req.headers.get("x-webhook-signature") || "", segredo: env("SYNC_WEBHOOK_SECRET") });
      return json(r.http, { status: r.status });
    }
    const p = await quem(req);
    if (!p) return json(401, { erro: "sem_login" });
    if (rota === "testar") { if (!p.admin) return json(403, { erro: "so_administradora" }); return json(200, await testarConexao({ db, cliente })); }
    if (rota === "puxar") { if (!p.juridico) return json(403, { erro: "so_juridico" }); const r = await puxar({ db, cliente, origem: "manual", por: p.id }); return json(200, { status: r.status, resumo: r.resumo ?? null, categoria: r.categoria ?? null }); }
    return json(404, { erro: "rota" });
  } catch (_e) {
    return json(500, { erro: "interno" });                               // sem detalhe na resposta nem no log
  }
});
