/* @menções em qualquer comentário ou descrição (pedido da sócia, 28/11/2026).
   Ao digitar "@" em uma caixa de texto de várias linhas (comentário, descrição, andamento, observação), aparece a lista da equipe;
   ao escolher, entra "@Nome" no texto. Quem grava é a própria tela, como antes; o banco (0130, gatilho np_mencoes) lê o texto salvo e
   avisa no sino quem foi marcado. A marca de cada pessoa vem do banco (mencoes_pessoas): primeiro nome quando é único na equipe
   ("@Natasha"), dois nomes quando há mais de uma pessoa com o mesmo primeiro nome ("@Maria Júlia").
   Sem a função no banco, sem rede ou para o perfil de cliente, nada aparece e as caixas de texto seguem como sempre. */
(() => {
"use strict";
const M = { pessoas: null, pedindo: null, pop: null, ta: null, itens: [], i: 0, ini: 0 };
const norm = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const css = document.createElement("style");
css.textContent = `
.np-menc{position:fixed;z-index:2147483000;min-width:220px;max-width:min(320px,92vw);max-height:260px;overflow:auto;padding:4px;display:flex;flex-direction:column;gap:1px;
  background:var(--np-surface,var(--surface,#fff));color:var(--np-text,var(--fg,#222));border:1px solid var(--np-line-2,var(--line,#ddd));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.22);font:inherit;font-size:13.5px}
.np-menc[hidden]{display:none}
.np-menc button{display:flex;align-items:center;gap:8px;min-height:36px;padding:6px 8px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.np-menc button[aria-selected="true"],.np-menc button:hover{background:var(--np-hover,var(--surface-2,#f1f1ee))}
.np-menc b{flex:none;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--np-surface-2,var(--surface-2,#eee));border:1px solid var(--np-line,var(--line,#ddd));font-size:10.5px;font-weight:600}
.np-menc span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-menc small{color:var(--np-text-3,var(--muted,#777));font-size:12px;white-space:nowrap}
@media (pointer:coarse){.np-menc button{min-height:44px}}`;
document.head.append(css);

function carregar() {
  if (M.pessoas) return Promise.resolve(M.pessoas);
  if (typeof SB === "undefined" || typeof PP === "undefined" || !PP.perfil || PP.perfil.papel === "cliente") return Promise.resolve([]);
  if (!M.pedindo) M.pedindo = Promise.resolve(SB.rpc("mencoes_pessoas", {}, { get: true })).then((r) => {
    M.pessoas = r.error || !Array.isArray(r.data) ? [] : r.data.filter((p) => p.marca && p.perfil_id !== PP.perfil?.id);
    return M.pessoas; }, () => (M.pessoas = [])).finally(() => { M.pedindo = null; });
  return M.pedindo;
}
const elegivel = (t) => !!t && t.tagName === "TEXTAREA" && !t.readOnly && !t.disabled && !t.closest("[data-sem-mencao]");
/* o trecho depois do último "@" até o cursor: até dois nomes, só letras */
function trecho(ta) {
  const v = ta.value.slice(0, ta.selectionStart);
  const m = /(^|[\s(\[{>«“"'])@([\p{L}]{0,24}(?: [\p{L}]{0,24})?)$/u.exec(v);
  return m ? { ini: v.length - m[2].length - 1, q: norm(m[2]) } : null;
}
function fechar() { if (M.pop) M.pop.hidden = true; M.ta = null; M.itens = []; }
const aberto = () => !!(M.pop && !M.pop.hidden && M.ta);
function escolher(p) {
  const ta = M.ta; if (!ta || !p) return;
  const fim = ta.selectionStart; ta.setRangeText("@" + p.marca + " ", M.ini, fim, "end");
  fechar(); ta.focus(); ta.dispatchEvent(new Event("input", { bubbles: true }));
}
function pintar() {
  M.pop.replaceChildren(...M.itens.map((p, i) => {
    const b = document.createElement("b"); b.setAttribute("aria-hidden", "true"); b.textContent = (window.NPUI?.iniciais?.(p.nome) || p.nome.slice(0, 2)).toUpperCase();
    try { window.NPUI?.fotos?.pintar?.(b, window.NPUI.fotos.doPerfil(p.perfil_id)); } catch (_) {}
    const bt = document.createElement("button"); bt.type = "button"; bt.setAttribute("role", "option"); bt.setAttribute("aria-selected", String(i === M.i)); bt.tabIndex = -1;
    const n = document.createElement("span"); n.textContent = p.nome; const s = document.createElement("small"); s.textContent = "@" + p.marca;
    bt.append(b, n, s); bt.addEventListener("mousedown", (e) => { e.preventDefault(); escolher(p); });
    return bt; }));
  M.pop.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}
function posicionar(ta) {
  const r = ta.getBoundingClientRect(); const h = Math.min(260, M.itens.length * 38 + 10);
  const abaixo = r.bottom + 4 + h <= window.innerHeight || r.top < h + 8;
  M.pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 328)) + "px";
  M.pop.style.top = (abaixo ? Math.min(r.bottom + 4, window.innerHeight - h - 8) : r.top - h - 4) + "px";
}
async function avaliar(ta) {
  if (!elegivel(ta)) { fechar(); return; }
  const t = trecho(ta); if (!t) { fechar(); return; }
  const pessoas = await carregar(); if (document.activeElement !== ta) return;
  const t2 = trecho(ta); if (!t2) { fechar(); return; }
  const q = t2.q; const itens = pessoas.filter((p) => !q || norm(p.marca).startsWith(q) || norm(p.nome).startsWith(q) || (!q.includes(" ") && norm(p.nome).split(" ").some((w) => w.startsWith(q)))).slice(0, 8);
  if (!itens.length) { fechar(); return; }
  if (!M.pop) { M.pop = document.createElement("div"); M.pop.className = "np-menc"; M.pop.setAttribute("role", "listbox"); M.pop.setAttribute("aria-label", "Mencionar alguém da equipe"); document.body.append(M.pop); }
  M.ta = ta; M.ini = t2.ini; M.itens = itens; M.i = Math.min(M.i, itens.length - 1); if (M.i < 0) M.i = 0;
  M.pop.hidden = false; pintar(); posicionar(ta);
}
document.addEventListener("input", (e) => { if (e.target && e.target.tagName === "TEXTAREA") { M.i = 0; avaliar(e.target); } }, true);
/* captura na janela: a lista de menções responde antes dos atalhos do formulário (Enter envia, Escape fecha a janela) */
window.addEventListener("keydown", (e) => {
  if (!aberto() || e.target !== M.ta) return;
  const para = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (e.key === "ArrowDown") { para(); M.i = (M.i + 1) % M.itens.length; pintar(); }
  else if (e.key === "ArrowUp") { para(); M.i = (M.i - 1 + M.itens.length) % M.itens.length; pintar(); }
  else if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") { para(); escolher(M.itens[M.i]); }
  else if (e.key === "Escape") { para(); fechar(); }
}, true);
document.addEventListener("click", (e) => { if (aberto() && e.target !== M.ta && !M.pop.contains(e.target)) fechar(); }, true);
document.addEventListener("focusout", (e) => { if (aberto() && e.target === M.ta) setTimeout(() => { if (document.activeElement !== M.ta) fechar(); }, 150); }, true);
window.addEventListener("resize", fechar); window.addEventListener("scroll", (e) => { if (aberto() && !(M.pop.contains(e.target))) posicionar(M.ta); }, true);
window.NP_MENCOES = { pessoas: carregar, fechar, get ativo() { return !!(M.pessoas && M.pessoas.length); } };
try { carregar(); } catch (_) {}
})();
