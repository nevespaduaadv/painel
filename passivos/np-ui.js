/* np-ui.js — componentes V3.1 do Design System (DESIGN.md §4): toolbar, filtros tipográficos, grupo recolhível, linha com régua,
   marca itálica, painel de detalhe (split/overlay/tela cheia), props, passos, etapa/ciclo/valor/tabela (Fase 3), popover, feedback no lugar, estados, movimento.
   Só apresentação: devolve elementos (mesmo el() do painel), não guarda estado global nem fala com o Supabase.
   Os estilos ficam em fontes/np-ui.css, escopados em html.np-casca-v3; os módulos usam NPUI só quando a casca V3.1 está ativa. */
(() => {
"use strict";
if (window.NPUI) return;
const doc = document;
const BETA = doc.body?.dataset.espelho === "1";
const chave = (n) => n + (BETA ? "-beta" : "");
const pref = { get: (n, d = null) => { try { return localStorage.getItem(chave(n)) ?? d; } catch (_) { return d; } }, set: (n, v) => { try { localStorage.setItem(chave(n), v); } catch (_) {} } };
const reduz = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const ms = (v) => reduz() ? 0 : v;
const E_IN = "cubic-bezier(.2,.7,.2,1)", E_MOVE = "cubic-bezier(.45,0,.2,1)";
const svgIco = (d, cls = "np-ico") => { const s = doc.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true"); s.innerHTML = d; return s; };
const I = { chevE: '<path d="m15 6-6 6 6 6"/>', chevD: '<path d="m9 6 6 6-6 6"/>', sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>', cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', csv: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', chev: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', mais: '<path d="M12 5v14M5 12h14"/>', pontos: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>', check: '<path d="m5 12 4 4L19 6"/>', clip: '<path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.8-8.8a3.5 3.5 0 0 1 5 5l-8.8 8.8a1.5 1.5 0 0 1-2.1-2.1l8.1-8.1"/>', filtro: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>' };
const campoAtivo = () => { const a = doc.activeElement; return !!(a && (a.closest("input,textarea,select,[contenteditable=''],[contenteditable='true']") || a.closest("#modalHost .modal"))); };

/* ---------- texto: pessoas, prazos, marcas ---------- */
const curto = (nome) => { const p = String(nome || "").trim().split(/\s+/).filter(Boolean); if (!p.length) return "—"; if (/^(maria|ana|jo[aã]o)$/i.test(p[0]) && p[1]) return p[0] + " " + p[1]; return p[0]; };
const iniciais = (nome) => { const p = String(nome || "").trim().split(/\s+/).filter(Boolean); return ((p[0] || "")[0] || "") + ((p[p.length - 1] || "")[0] || ""); };
const quem = (nome, { title } = {}) => nome ? el("span", { class: "np-quem", title: title || nome }, el("b", { "aria-hidden": "true" }, iniciais(nome).toUpperCase()), el("span", {}, curto(nome))) : el("span", { class: "np-quem np-quem-vazio" }, "— ninguém —");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const hojeLocal = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
/* prazo: a data exata sempre aparece; a relativa complementa e nunca substitui */
const prazoTxt = (iso, hora) => {
  if (!iso) return { curta: "sem prazo", rel: "", exata: "sem prazo", dias: null, hora: "" };
  const d = parseD(iso); const dias = Math.round((d - hojeLocal()) / 86400000);
  const h = hora ? String(hora).slice(0, 5) : "";
  const curta = `${d.getDate()} ${MESES[d.getMonth()]}` + (d.getFullYear() !== hojeLocal().getFullYear() ? ` ${d.getFullYear()}` : "");
  const rel = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : dias === -1 ? "ontem" : dias < 0 ? `há ${-dias} dias` : `em ${dias} dias`;
  return { curta, rel, dias, hora: h ? h.replace(":", "h") : "", exata: fmtD(d) + (h ? ` às ${h}` : "") };
};
const marca = (texto, tom) => el("i", { class: "np-marca" + (tom ? " " + tom : "") }, texto);

/* ---------- toolbar, filtros, segmento ---------- */
const chip = ({ label, n, on = false, onclick, title, grupo }) => el("button", { type: "button", class: "np-chipf", "aria-pressed": String(!!on), title: title || null, "data-grupo": grupo || null, onclick }, label, n != null ? el("span", { class: "n" }, String(n)) : null);
const seg = (opcoes, valor, onChange, label) => { const g = el("div", { class: "np-seg", role: "group", "aria-label": label || "Vista" }); for (const [k, l] of opcoes) g.append(el("button", { type: "button", "aria-pressed": String(k === valor), onclick: () => { if (k === valor) return; g.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === k))); onChange(k); }, "data-k": k }, l)); return g; };
const resumo = (itens) => el("div", { class: "np-resumo", role: "status", "aria-live": "polite" }, itens.filter(Boolean).map(i => el("span", {}, el("b", { class: i.tom || "" }, String(i.n)), " ", i.label)));
const toolbar = ({ resumo: r, filtros, filtrosFixos, direita }) => el("div", { class: "np-toolbar" }, r || null, filtros ? el("div", { class: "np-filtros-w", role: "group", "aria-label": "Filtros" }, el("div", { class: "np-filtros" }, filtros.filter(Boolean)), filtrosFixos ? el("div", { class: "np-filtros-fixos" }, filtrosFixos.filter(Boolean)) : null) : null, direita ? el("div", { class: "np-tb-dir" }, direita.filter(Boolean)) : null);
const sepv = () => el("span", { class: "np-sepv", "aria-hidden": "true" });

/* ---------- grupo recolhível ---------- */
const grupo = ({ id, titulo, n, tom, aberto = true, onToggle, itens }) => {
  const corpo = el("div", { class: "np-grp-c", id: "np-grp-" + id }, el("ul", { class: "np-lst", role: "list" }, itens));
  const head = el("button", { type: "button", class: "np-grp-h", "aria-expanded": String(aberto), "aria-controls": corpo.id }, svgIco(I.chev, "np-ico np-chev"), el("span", { class: "t" }, titulo), el("span", { class: "n" }, String(n)));
  const g = el("section", { class: "np-grp" + (tom ? " " + tom : ""), "data-aberto": aberto ? "1" : "0", "data-g": id }, head, corpo);
  if (!aberto) corpo.setAttribute("inert", "");
  head.onclick = () => { const ab = g.dataset.aberto !== "1"; g.dataset.aberto = ab ? "1" : "0"; head.setAttribute("aria-expanded", String(ab)); corpo.toggleAttribute("inert", !ab); onToggle?.(ab); };
  return g;
};

/* ---------- linha ---------- */
/* regua: "fatal" | "late" | "att" | null · check: {checked, onChange, title} (sem check, a coluna de 22 px fica vazia para a grade não deslocar) · prazo: {curta, hora, rel, exata, tom} · direita: elementos */
const linha = ({ id, regua, check, prazo, titulo, contexto, direita = [], atual = false, riscado = false, onOpen, onTecla, titleAbrir }) => {
  const li = el("li", { class: "np-it" + (regua ? " r-" + regua : "") + (riscado ? " np-riscado" : ""), "data-id": id, "aria-current": atual ? "true" : null });
  if (check) { const c = el("input", { type: "checkbox", class: "np-check", title: check.title || "Concluir", "aria-label": (check.title || "Concluir") + ": " + titulo }); c.checked = !!check.checked; c.onchange = () => check.onChange(c); li.append(el("span", { class: "np-it-chk" }, c)); } else li.append(el("span", { class: "np-it-chk np-it-chk-vazio", "aria-hidden": "true" }));
  li.append(el("span", { class: "np-it-prazo" + (prazo?.tom ? " " + prazo.tom : ""), title: prazo?.exata || null }, prazo?.curta ? el("span", { class: "d" }, prazo.curta) : el("span", { class: "d np-sem" }, "—"), prazo?.hora ? el("span", { class: "h" }, prazo.hora) : null, prazo?.rel ? el("span", { class: "r", "aria-hidden": "true" }, prazo.rel) : null));
  const abrir = el("button", { type: "button", class: "np-it-abrir", title: titleAbrir || "Abrir", onclick: () => onOpen?.(li) }, el("span", { class: "tx" }, titulo), contexto ? el("span", { class: "ctx" }, ...(Array.isArray(contexto) ? contexto : [contexto])) : null);
  if (onTecla) abrir.addEventListener("keydown", (e) => { if (campoAtivo()) return; onTecla(e, li); });
  li.append(abrir, el("span", { class: "np-it-dir" }, ...direita.filter(Boolean)));
  li.addEventListener("click", (e) => { if (e.target.closest("button,input,a,select,label")) return; onOpen?.(li); });
  return li;
};

/* ---------- feedback no lugar ---------- */
const feito = (li, { texto, acao, onAcao }) => { const f = el("div", { class: "np-feito", role: "status" }, el("span", {}, texto), acao ? el("button", { type: "button", class: "lnk", onclick: onAcao }, acao) : null); li.replaceChildren(f); li.classList.remove("r-fatal", "r-late", "r-att"); li.removeAttribute("aria-current"); li.classList.add("np-it-feita"); li.animate([{ opacity: .4 }, { opacity: 1 }], { duration: ms(240), easing: E_IN }); return f; };
const faixaErro = ({ texto, quando, acao = "Tentar de novo", onAcao }) => el("div", { class: "np-erro", role: "alert" }, el("i", {}, texto), quando ? el("span", {}, ` Mostrando os dados de ${quando}.`) : null, onAcao ? el("button", { type: "button", class: "lnk", onclick: onAcao }, acao) : null);
const vazio = ({ titulo, texto, acao, onAcao }) => el("div", { class: "np-vazio" }, el("h3", {}, titulo), el("p", {}, texto, acao ? [" ", el("button", { type: "button", class: "lnk", onclick: onAcao }, acao)] : null));
const carregando = (n = 6) => el("div", { class: "np-esqueleto", "aria-busy": "true", "aria-label": "Carregando" }, Array.from({ length: n }, () => el("div", {})));
const rodape = (texto, legenda) => el("div", { class: "np-rodape" }, el("span", {}, texto), legenda ? el("span", { class: "np-legenda", "aria-hidden": "true" }, ...legenda.map(([cls, l]) => el("span", {}, el("i", { class: cls }), l))) : null);

/* ---------- painel de detalhe (split ≥ 1180 · overlay 981–1179 · tela cheia ≤ 980) ---------- */
function painel({ obra, label = "Detalhe", onClose }) {
  const btnX = el("button", { type: "button", class: "np-ib", "aria-label": "Fechar (Esc)" }, svgIco(I.x));
  const trilha = el("div", { class: "np-trilha-p" }), tit = el("h2", {}), corpo = el("div", { class: "np-p-corpo" }), pe = el("div", { class: "np-p-pe" });
  const aside = el("aside", { class: "np-painel", "aria-label": label, hidden: "", inert: "" }, el("div", { class: "np-p-h" }, el("div", { class: "np-p-ht" }, trilha, tit), btnX), corpo, pe);
  obra.append(aside);
  let origem = null, aberto = false, ultimoId = null; // ultimoId: devolve o foco à linha certa mesmo quando a lista foi re-renderizada (origem desconectada)
  const modo = () => innerWidth <= 980 ? "cheia" : innerWidth <= 1179 ? "overlay" : "split";
  const aplicarModo = () => { const m = modo(); aside.dataset.modo = m; if (m === "cheia") { aside.setAttribute("role", "dialog"); aside.setAttribute("aria-modal", "true"); } else { aside.removeAttribute("role"); aside.removeAttribute("aria-modal"); } };
  const fechar = (devolver = true) => { if (!aberto) return; aberto = false; const fn = () => { obra.classList.remove("np-aberta"); aside.hidden = true; aside.setAttribute("inert", ""); obra.querySelectorAll('.np-it[aria-current="true"]').forEach(i => i.removeAttribute("aria-current")); doc.body.classList.remove("np-painel-cheia"); }; vt(fn).then(() => { onClose?.(); const alvo = (origem && origem.isConnected) ? origem : (ultimoId != null ? obra.querySelector(`.np-it[data-id="${ultimoId}"] .np-it-abrir, .np-it[data-id="${ultimoId}"] button`) : null); if (devolver && alvo) alvo.focus(); origem = null; }); };
  /* `pend` guarda sempre o último conteúdo pedido: abrir() aplica o DOM dentro de uma view transition (assíncrona) e atualizar()
     pode chegar antes disso — sem isto, o esqueleto do abrir() sobrescreveria os dados já carregados (corrida vista no CI) */
  let pend = { c: null, p: null };
  const abrir = ({ trilha: tr, titulo, corpo: c, pe: p, origem: o, id, foco }) => {
    aplicarModo(); const ja = aberto; aberto = true; if (o) origem = o; if (id != null) ultimoId = id; pend = { c, p: p || [] };
    const linhaTx = id != null ? obra.querySelector(`.np-it[data-id="${id}"] .tx`) : null; if (linhaTx && !ja) linhaTx.style.viewTransitionName = "np-titulo";
    const fn = () => { if (linhaTx) linhaTx.style.viewTransitionName = ""; trilha.replaceChildren(...(Array.isArray(tr) ? tr : [tr]).filter(Boolean)); tit.textContent = titulo; corpo.replaceChildren(...[].concat(pend.c).filter(Boolean)); pe.replaceChildren(...[].concat(pend.p || []).filter(Boolean)); aside.hidden = false; aside.removeAttribute("inert"); obra.classList.add("np-aberta"); obra.querySelectorAll('.np-it[aria-current="true"]').forEach(i => i.removeAttribute("aria-current")); if (id != null) obra.querySelector(`.np-it[data-id="${id}"]`)?.setAttribute("aria-current", "true"); doc.body.classList.toggle("np-painel-cheia", aside.dataset.modo === "cheia"); corpo.scrollTop = 0; };
    (ja ? Promise.resolve(fn()) : vt(fn)).then(() => { if (linhaTx) linhaTx.style.viewTransitionName = ""; if (foco) setTimeout(foco, ms(60)); else if (!ja) setTimeout(() => btnX.focus(), ms(60)); });
  };
  btnX.onclick = () => fechar();
  aside.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented) { if (doc.querySelector("#np-pop.on")) return; e.stopPropagation(); fechar(); } });
  matchMedia("(max-width:980px)").addEventListener("change", () => { if (aberto) aplicarModo(); }); matchMedia("(max-width:1179px)").addEventListener("change", () => { if (aberto) aplicarModo(); });
  return { el: aside, corpo, pe, abrir, fechar, get aberto() { return aberto; }, atualizar: ({ corpo: c, pe: p }) => { if (c) { pend.c = c; corpo.replaceChildren(...[].concat(c).filter(Boolean)); } if (p) { pend.p = p; pe.replaceChildren(...[].concat(p).filter(Boolean)); } } };
}

/* ---------- props, passos, seções ---------- */
const props = (pares) => { const dl = el("dl", { class: "np-props" }); for (const [k, v, cls] of pares.filter(Boolean)) { dl.append(el("dt", {}, k), el("dd", { class: cls || "" }, ...[].concat(v))); } return dl; };
const passos = (itens) => el("ol", { class: "np-passos" }, itens.map(p => el("li", { class: p.estado || "" }, p.el || el("span", {}, p.texto), p.sub ? el("small", {}, p.sub) : null)));
const secao = (titulo, ...kids) => el("section", { class: "np-sec" }, el("h3", {}, titulo), ...kids);

/* ---------- indicador de etapa, valor, ciclo, tabela compacta (DESIGN.md §5; Fase 3) ---------- */
/* etapa: pontos horizontais — passos: [{k,label}] · atual: k · feitos: Set/array de k concluídos (default: os anteriores ao atual) */
const etapa = (passos, atual, { feitos } = {}) => {
  const i = passos.findIndex(p => p.k === atual); const done = new Set(feitos || passos.slice(0, Math.max(i, 0)).map(p => p.k));
  const ol = el("ol", { class: "np-etapa", "aria-label": i >= 0 ? `etapa ${i + 1} de ${passos.length}: ${passos[i].label}` : `${passos.length} etapas`, title: i >= 0 ? passos[i].label : null });
  passos.forEach((p, j) => ol.append(el("li", { class: p.k === atual ? "atual" : done.has(p.k) ? "ok" : "", "aria-current": p.k === atual ? "step" : null }, el("span", { class: "np-sr" }, p.label))));
  return ol;
};
/* val: dinheiro em serifa tabular — "cobrado → acordo" com % só quando os dois existem; nunca inventa valor */
const brl = (v) => (typeof BRL === "function" ? BRL(+v) : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const val = ({ cobrado, acordo, rotuloAcordo = "acordo", sub } = {}) => {
  const temC = cobrado != null && cobrado !== "", temA = acordo != null && acordo !== "";
  const w = el("span", { class: "np-val" });
  if (temC) w.append(el("b", { class: temA ? "de" : "", title: "valor cobrado" }, brl(cobrado)));
  if (temC && temA) w.append(el("span", { class: "seta", "aria-hidden": "true" }, "→"));
  if (temA) w.append(el("b", { title: rotuloAcordo }, brl(acordo)));
  if (temC && temA && +cobrado > 0) { const pct = Math.round((1 - (+acordo) / (+cobrado)) * 100); if (pct > 0 && pct < 100) w.append(el("small", { title: "desconto sobre o cobrado" }, `−${pct}%`)); }
  if (!temC && !temA) w.append(el("span", { class: "np-sem" }, "—"));
  if (sub) w.append(el("small", { class: "sub" }, sub));
  return w;
};
/* ciclo: 5 passos horizontais com data — passos: [{label, data, feita, atual, sub}] */
const ciclo = (passos) => el("ol", { class: "np-ciclo", "aria-label": "Ciclo de acompanhamento" }, passos.map((p, i) => el("li", { class: (p.feita ? "ok" : "") + (p.atual ? " atual" : ""), "aria-current": p.atual ? "step" : null },
  el("span", { class: "dot", "aria-hidden": "true" }, p.feita ? svgIco(I.check, "np-ico") : String(i + 1)), el("span", { class: "l" }, p.label), el("span", { class: "d" }, p.data || p.sub || "—"))));
/* tabela compacta — colunas: [{k,label,num,render}] · linhas: objetos */
const tabela = (colunas, linhas, { vazio: tv = "—", label } = {}) => {
  const t = el("table", { class: "np-tab", "aria-label": label || null }, el("thead", {}, el("tr", {}, colunas.map(c => el("th", { class: c.num ? "num" : "", scope: "col" }, c.label)))),
    el("tbody", {}, linhas.length ? linhas.map(l => el("tr", {}, colunas.map(c => { const v = c.render ? c.render(l) : l[c.k]; return el("td", { class: c.num ? "num" : "" }, v == null || v === "" ? el("span", { class: "np-sem" }, "—") : v); }))) : el("tr", {}, el("td", { colspan: String(colunas.length), class: "np-sem" }, tv))));
  return el("div", { class: "np-tab-w" }, t);
};

/* ---------- popover (um por vez) ---------- */
let popAtual = null;
function pop(anchor, conteudo, { role = "menu", label, alinhar = "esq", aoFechar, refoco } = {}) {
  fecharPop();
  const p = el("div", { id: "np-pop", class: "np-pop", role, "aria-label": label || null, tabindex: "-1" });
  const itens = typeof conteudo === "function" ? conteudo({ fechar: () => fecharPop() }) : conteudo;
  if (role === "menu") p.append(...itens.filter(Boolean).map(i => { if (i instanceof Element) return i; const b = el("button", { type: "button", role: "menuitem", class: "np-pop-i" + (i.tom ? " " + i.tom : "") + (i.atual ? " atual" : ""), disabled: i.disabled ? "" : null, title: i.title || null, onclick: () => { fecharPop(); i.onclick?.(); } }, i.atual ? svgIco(I.check, "np-ico") : el("span", { class: "np-ico" }), i.label); return b; }));
  else p.append(...[].concat(itens).filter(Boolean));
  doc.body.append(p);
  const r = anchor.getBoundingClientRect(); const W = Math.min(p.offsetWidth || 260, innerWidth - 16);
  let left = alinhar === "dir" ? r.right - W : r.left; left = Math.max(8, Math.min(left, innerWidth - W - 8));
  let top = r.bottom + 6; const H = p.offsetHeight; if (top + H > innerHeight - 8 && r.top - H - 6 > 8) top = r.top - H - 6;
  p.style.left = left + "px"; p.style.top = top + "px"; p.classList.add("on");
  anchor.setAttribute("aria-expanded", "true");
  const foco = p.querySelector('[role="menuitem"]:not([disabled]), input, select, button'); setTimeout(() => (foco || p).focus(), 0);
  const tecla = (e) => { if (e.key === "Escape") { e.stopPropagation(); fecharPop(); return; } if (role !== "menu") return; const its = [...p.querySelectorAll('[role="menuitem"]:not([disabled])')]; const i = its.indexOf(doc.activeElement); if (e.key === "ArrowDown") { e.preventDefault(); its[(i + 1) % its.length]?.focus(); } if (e.key === "ArrowUp") { e.preventDefault(); its[(i - 1 + its.length) % its.length]?.focus(); } };
  const fora = (e) => { if (!p.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) fecharPop(); };
  p.addEventListener("keydown", tecla); setTimeout(() => { doc.addEventListener("pointerdown", fora, true); }, 0);
  popAtual = { p, anchor, fora, aoFechar, refoco, alinhar };
  return { fechar: fecharPop, el: p };
}
function reancorarPop() { if (!popAtual) return false; const { anchor, refoco, p } = popAtual; if (anchor.isConnected) return true; const novo = refoco?.(); if (!novo) { fecharPop(); return false; } popAtual.anchor = novo; novo.setAttribute("aria-expanded", "true"); const r = novo.getBoundingClientRect(); const W = p.offsetWidth; let left = Math.max(8, Math.min(r.right - W, innerWidth - W - 8)); if (popAtual.alinhar !== "dir") left = Math.max(8, Math.min(r.left, innerWidth - W - 8)); p.style.left = left + "px"; return true; }
function fecharPop() { if (!popAtual) return; const { p, anchor, fora, aoFechar, refoco } = popAtual; popAtual = null; doc.removeEventListener("pointerdown", fora, true); p.remove(); anchor.setAttribute("aria-expanded", "false"); const alvo = anchor.isConnected ? anchor : refoco?.(); if (alvo && !campoAtivo()) alvo.focus(); aoFechar?.(); }

/* ---------- movimento ---------- */
let vtEmCurso = false;
const vt = (fn) => { if (reduz() || !doc.startViewTransition || vtEmCurso) { fn(); return Promise.resolve(); } try { vtEmCurso = true; const t = doc.startViewTransition(fn); t.finished.catch(() => {}).then(() => { vtEmCurso = false; }); return t.updateCallbackDone.catch(() => {}); } catch (_) { vtEmCurso = false; fn(); return Promise.resolve(); } };
/* FLIP: guarda a posição dos itens (por data-id), aplica fn() e anima só o deslocamento; novos entram por opacidade */
const flip = (host, fn) => { const antes = {}; host.querySelectorAll(".np-it").forEach(e => antes[e.dataset.id] = e.getBoundingClientRect()); fn(); if (reduz()) return; host.querySelectorAll(".np-it").forEach(e => { const a = antes[e.dataset.id]; const b = e.getBoundingClientRect(); if (!a) { e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: E_IN }); return; } const dy = a.top - b.top; if (Math.abs(dy) > 1 && Math.abs(dy) < 600) e.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 240, easing: E_MOVE }); }); };

/* ---------- botões ---------- */
const btn = (label, { variante = "", onclick, title, disabled, icone, type = "button", cls = "" } = {}) => el("button", { type, class: ("np-btn " + variante + " " + cls).trim(), onclick, title: title || null, disabled: disabled ? "" : null }, icone ? svgIco(I[icone] || icone) : null, label);
const ib = (icone, label, onclick) => el("button", { type: "button", class: "np-ib", "aria-label": label, title: label, onclick }, svgIco(I[icone] || icone));

/* Permissão falha-fechada para integrações entre módulos (Fase 4B): só equipe, fora do modo só leitura e com PP.temAcesso(tab)
   respondendo exatamente true. Função ausente, false, valor não estrito ou exceção ⇒ false. Nunca libera por conta própria. */
const permite = (tab) => { try { if (typeof equipe !== "function" || !equipe()) return false; if (typeof readOnly === "function" && readOnly()) return false; if (typeof PP?.temAcesso !== "function") return false; return PP.temAcesso(tab) === true; } catch (_) { return false; } };
/* ---------- NPUI.form (Fase 4C) — invólucro de formulário da V3.1 ----------
   Reaproveita #modalHost (irmão de #app: o próprio formulário nunca fica inerte) e as classes .modal/.card do núcleo; o modal() da V2 não muda.
   Responsável só pela EXPERIÊNCIA: cabeçalho com formulário + cliente/registro, foco (inicial, preso, devolvido à origem), Escape/Cancelar/fundo com
   proteção contra descarte, validação junto aos campos (blur + envio) com mensagens em português, aviso não bloqueante, envio com trava (sem dupla
   chamada a salvar/excluir), erro do banco traduzido sem fechar, exclusão com confirmação acessível. A gravação em si é a função que o chamador passa.
   form({ titulo, contexto, campos:[{id,label,el,ajuda,obrigatorio,validar}], validarTudo, salvar, excluir:{rotulo,confirmar,acao}, origem, aoFechar })
   → { fechar, erroCampo, avisoCampo, erroGeral, el } */
const FORM_MSG = {
  obrigatorio: "Preencha este campo.", descartar: "Descartar as alterações?", continuar: "Continuar editando", descartarBtn: "Descartar",
  salvando: "Salvando…", excluindo: "Excluindo…", resumoErros: (n) => `${n} campos precisam de atenção:`, semConexao: "Sem conexão com o banco — tente de novo.",
  bd: { "23505": "Já existe um registro igual.", "23503": "Este registro faz referência a algo que não existe mais.", "23514": "Um dos valores não é aceito pelo banco.", "42501": "Sem permissão para gravar este registro.", PGRST301: "Sem permissão para gravar este registro.", PGRST116: "Registro não encontrado — pode ter sido excluído por outra pessoa.", "22007": "Data inválida.", "22P02": "Um dos valores está em formato inválido." },
};
const traduzErroBD = (e) => { if (!e) return "Não foi possível salvar."; const code = e.code || e.status || ""; if (FORM_MSG.bd[code]) return FORM_MSG.bd[code]; const m = String(e.message || e); if (/Failed to fetch|NetworkError|network|fetch/i.test(m)) return FORM_MSG.semConexao; return m || "Não foi possível salvar."; };
const form = ({ titulo, contexto, campos = [], validarTudo, salvar, excluir, origem, aoFechar, rotuloSalvar = "Salvar" } = {}) => {
  if (typeof needDb === "function" && !needDb()) return null;
  const host = doc.querySelector("#modalHost"); if (!host) return null; host.replaceChildren();
  const app = doc.querySelector("#app"); const origemEl = origem || doc.activeElement;
  const uid = "npf" + Math.random().toString(36).slice(2, 8); let enviando = false, fechado = false;
  const tit = el("h2", { id: uid + "-t" }, titulo); const ctx = contexto ? el("p", { class: "np-f-ctx", id: uid + "-c" }, contexto) : null;
  const btnX = el("button", { type: "button", class: "np-ib np-f-x", "aria-label": "Fechar (Esc)" }, svgIco(I.x));
  const geral = el("div", { class: "np-f-geral", role: "alert", hidden: "" }); const vivo = el("div", { class: "np-vh", "aria-live": "polite" });
  const grade = el("div", { class: "form np-f-campos" });
  const valorDe = (c) => c.el.type === "checkbox" ? c.el.checked : c.el.value; const inicial = new Map();
  const porId = {}; const erroEl = {}; const avisoEl = {}; let cruzados = new Set(); // campos marcados pela regra cruzada (validarTudo), reavaliados a cada digitação
  for (const c of campos) { if (!c || !c.el) continue; porId[c.id] = c; c.el.id = c.id; const lab = el("label", { for: c.id }, c.label, c.obrigatorio ? el("span", { class: "np-f-req", "aria-hidden": "true" }, " *") : c.condicional ? null : el("span", { class: "np-f-opc" }, " (opcional)")); // condicional: obrigatório por regra cruzada (sem "(opcional)")
    const ajuda = c.ajuda ? el("div", { class: "help", id: c.id + "-h" }, c.ajuda) : null; erroEl[c.id] = el("p", { class: "np-f-erro", id: c.id + "-e", hidden: "" }); avisoEl[c.id] = el("p", { class: "np-f-aviso", id: c.id + "-a", hidden: "" });
    c.el.setAttribute("aria-describedby", [ajuda ? c.id + "-h" : null, c.id + "-e", c.id + "-a"].filter(Boolean).join(" ")); if (c.obrigatorio) c.el.setAttribute("aria-required", "true");
    grade.append(el("div", { class: "f np-f" + (c.el.tagName === "TEXTAREA" || c.largo ? " full" : ""), "data-campo": c.id }, lab, c.el, ajuda, erroEl[c.id], avisoEl[c.id]));
    inicial.set(c.id, valorDe(c)); c.el.addEventListener("blur", () => validarCampo(c, { noBlur: true })); c.el.addEventListener("input", () => { if (c.el.getAttribute("aria-invalid") === "true" && !cruzados.has(c.id)) validarCampo(c, { noBlur: true }); if (cruzados.size) reavaliarCruzados(); }); }
  const erroCampo = (id, msg) => { const c = porId[id]; if (!c) return; if (msg) { erroEl[id].textContent = msg; erroEl[id].hidden = false; c.el.setAttribute("aria-invalid", "true"); c.el.closest(".np-f")?.classList.add("com-erro"); } else { erroEl[id].hidden = true; erroEl[id].textContent = ""; c.el.removeAttribute("aria-invalid"); c.el.closest(".np-f")?.classList.remove("com-erro"); } };
  const avisoCampo = (id, msg) => { const c = porId[id]; if (!c) return; avisoEl[id].hidden = !msg; avisoEl[id].textContent = msg || ""; if (msg) vivo.textContent = c.label + ": " + msg; };
  const erroGeral = (msg, detalhe) => { geral.replaceChildren(); if (!msg) { geral.hidden = true; return; } geral.append(el("b", {}, msg)); if (detalhe && detalhe !== msg) geral.append(el("details", {}, el("summary", {}, "detalhes técnicos"), el("code", {}, String(detalhe).slice(0, 400)))); geral.hidden = false; };
  const validarCampo = (c, { noBlur } = {}) => { const v = valorDe(c); let r = null; if (c.obrigatorio && (v == null || String(v).trim() === "")) r = FORM_MSG.obrigatorio; else if (typeof c.validar === "function") { try { r = c.validar(v, valores()); } catch (_) { r = null; } }
    if (r && typeof r === "object" && r.aviso) { erroCampo(c.id, null); avisoCampo(c.id, r.aviso); return null; } avisoCampo(c.id, null); erroCampo(c.id, r || null); return r || null; };
  const reavaliarCruzados = () => { let cruz = []; try { cruz = (typeof validarTudo === "function" && validarTudo(valores())) || []; } catch (_) { cruz = []; } const agora = new Set(cruz.filter(e => e && e.campo && porId[e.campo]).map(e => e.campo)); for (const id of cruzados) if (!agora.has(id)) erroCampo(id, null); for (const e of cruz) if (e && e.campo && porId[e.campo]) erroCampo(e.campo, e.msg); cruzados = agora; if (!cruzados.size && geral.querySelector("ul")) geral.hidden = true; };
  const valores = () => { const o = {}; for (const c of campos) if (c && c.el) o[c.id] = valorDe(c); return o; };
  const validarTodos = () => { const erros = []; for (const c of campos) { if (!c || !c.el) continue; const r = validarCampo(c); if (r) erros.push({ campo: c.id, msg: r }); }
    cruzados = new Set(); if (typeof validarTudo === "function") { let cruz = []; try { cruz = validarTudo(valores()) || []; } catch (_) { cruz = []; } for (const e of cruz) { if (e && e.campo && porId[e.campo]) cruzados.add(e.campo); if (e && e.campo && porId[e.campo]) { erroCampo(e.campo, e.msg); if (!erros.some(x => x.campo === e.campo)) erros.push(e); } else if (e && e.msg) erros.push(e); } }
    if (erros.length >= 2) { geral.replaceChildren(el("b", {}, FORM_MSG.resumoErros(erros.length)), el("ul", {}, ...erros.map(e => el("li", {}, porId[e.campo] ? el("a", { href: "#" + e.campo, onclick: (ev) => { ev.preventDefault(); porId[e.campo].el.focus(); } }, porId[e.campo].label + ": " + e.msg) : e.msg)))); geral.hidden = false; }
    else if (erros.length === 1 && !porId[erros[0].campo]) erroGeral(erros[0].msg); else geral.hidden = true;
    return erros; };
  const alterado = () => { for (const c of campos) if (c && c.el && String(valorDe(c)) !== String(inicial.get(c.id))) return true; return false; };
  const btnSalvar = el("button", { type: "submit", class: "btn primary np-f-salvar" }, rotuloSalvar); const btnCancelar = el("button", { type: "button", class: "btn np-f-cancelar" }, "Cancelar");
  const btnExcluir = excluir ? el("button", { type: "button", class: "btn danger np-f-excluir" }, excluir.rotulo || "Excluir") : null;
  const confirmBox = el("div", { class: "np-f-confirm", role: "alertdialog", "aria-labelledby": uid + "-cf", hidden: "" });
  const acoes = el("div", { class: "actions np-f-acoes" }, btnExcluir, el("span", { class: "sp" }), btnCancelar, btnSalvar);
  const formEl = el("form", { class: "np-f-form", novalidate: "" }, grade); const card = el("div", { class: "card np-form", role: "dialog", "aria-modal": "true", "aria-labelledby": uid + "-t", "aria-describedby": ctx ? uid + "-c" : null }, el("div", { class: "np-f-cab" }, el("div", {}, tit, ctx), btnX), geral, vivo, formEl, confirmBox, acoes);
  const fundo = el("div", { class: "modal np-form-fundo" }, card);
  const restaurar = () => { if (fechado) return; fechado = true; host.replaceChildren(); app?.removeAttribute("inert"); doc.removeEventListener("keydown", teclas, true); try { aoFechar?.(); } catch (_) {} const alvo = (origemEl && origemEl.isConnected && typeof origemEl.focus === "function") ? origemEl : null; setTimeout(() => { try { alvo ? alvo.focus() : doc.body.focus(); } catch (_) {} }, 0); };
  const focaveis = () => [...card.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(e => !e.disabled && !e.hidden && e.offsetParent !== null && !e.closest("[hidden]"));
  let confirmando = null; // {texto, onSim}
  const pedirConfirmacao = (texto, rotuloSim, onSim, { perigo } = {}) => { confirmando = { onSim }; confirmBox.replaceChildren(el("p", { id: uid + "-cf" }, texto), el("div", { class: "np-f-confirm-acoes" }, el("button", { type: "button", class: "btn np-f-conf-nao", onclick: fecharConfirmacao }, FORM_MSG.continuar), el("button", { type: "button", class: ("btn np-f-conf-sim " + (perigo ? "danger" : "primary")), onclick: () => { const fn = confirmando?.onSim; fecharConfirmacao(); fn && fn(); } }, rotuloSim))); confirmBox.hidden = false; acoes.hidden = true; setTimeout(() => confirmBox.querySelector(".np-f-conf-nao")?.focus(), 0); };
  const fecharConfirmacao = () => { confirmando = null; confirmBox.hidden = true; confirmBox.replaceChildren(); acoes.hidden = false; };
  const tentarFechar = () => { if (enviando) return; if (confirmando) { fecharConfirmacao(); return; } if (alterado()) { pedirConfirmacao(FORM_MSG.descartar, FORM_MSG.descartarBtn, restaurar, { perigo: true }); return; } restaurar(); };
  const travar = (on, txt) => { enviando = on; card.setAttribute("aria-busy", String(on)); btnSalvar.disabled = on; btnCancelar.disabled = on; btnX.disabled = on; if (btnExcluir) btnExcluir.disabled = on; if (on) { btnSalvar.dataset.rotulo = btnSalvar.textContent; btnSalvar.textContent = txt || FORM_MSG.salvando; vivo.textContent = txt || FORM_MSG.salvando; } else { if (btnSalvar.dataset.rotulo) btnSalvar.textContent = btnSalvar.dataset.rotulo; } };
  const enviar = async () => { if (enviando || confirmando) return; const erros = validarTodos(); if (erros.length) { const c = porId[erros[0].campo]; (c ? c.el : geral).focus?.(); return; } erroGeral(null); travar(true, FORM_MSG.salvando);
    try { await salvar(valores()); fechado || restaurar(); } catch (e) { travar(false); erroGeral(traduzErroBD(e), e && e.message); geral.focus?.(); } };
  const excluirAgora = async () => { if (enviando || !excluir) return; erroGeral(null); travar(true, FORM_MSG.excluindo); try { await excluir.acao(); fechado || restaurar(); } catch (e) { travar(false); erroGeral(traduzErroBD(e), e && e.message); } };
  btnSalvar.onclick = (e) => { e.preventDefault(); enviar(); }; formEl.addEventListener("submit", (e) => { e.preventDefault(); enviar(); });
  btnCancelar.onclick = tentarFechar; btnX.onclick = tentarFechar; fundo.addEventListener("mousedown", (e) => { if (e.target === fundo) tentarFechar(); });
  if (btnExcluir) btnExcluir.onclick = () => { if (enviando) return; pedirConfirmacao(excluir.confirmar || "Excluir este registro?", excluir.rotulo || "Excluir", excluirAgora, { perigo: true }); };
  const teclas = (e) => { if (!card.isConnected) return; if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); tentarFechar(); return; }
    if (e.key === "Tab") { const fs = focaveis(); if (!fs.length) return; const i = fs.indexOf(doc.activeElement); if (e.shiftKey && (i <= 0)) { e.preventDefault(); fs[fs.length - 1].focus(); } else if (!e.shiftKey && (i === fs.length - 1 || i === -1)) { e.preventDefault(); fs[0].focus(); } return; }
    if (e.key === "Enter" && enviando) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === "Enter" && e.target && /^(INPUT|SELECT)$/.test(e.target.tagName) && card.contains(e.target)) { e.preventDefault(); enviar(); } };
  doc.addEventListener("keydown", teclas, true);
  host.append(fundo); geral.tabIndex = -1; app?.setAttribute("inert", "");
  // segurança: se outro código esvaziar #modalHost (modal() da V2, limpezas antigas), o inert e os ouvintes são desfeitos — o app nunca fica travado
  const obs = new MutationObserver(() => { if (!fundo.isConnected && !fechado) { obs.disconnect(); restaurar(); } else if (fechado) obs.disconnect(); }); obs.observe(host, { childList: true });
  setTimeout(() => { const primeiro = campos.find(c => c && c.el && c.el.getAttribute("aria-invalid") === "true") || campos.find(c => c && c.el && !c.el.disabled); (primeiro ? primeiro.el : btnX).focus(); }, 0);
  return { fechar: restaurar, erroCampo, avisoCampo, erroGeral, el: card, valores };
};
window.NPUI = { form, traduzErroBD, permite, pref, chave, reduz, ms, vt, flip, svgIco, I, quem, curto, iniciais, prazoTxt, marca, chip, seg, resumo, toolbar, sepv, grupo, linha, feito, faixaErro, vazio, carregando, rodape, painel, props, passos, secao, etapa, val, ciclo, tabela, brl, pop, fecharPop, reancorarPop, popAberto: () => !!popAtual, btn, ib, campoAtivo };
})();
