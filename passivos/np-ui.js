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
/* ---------- fotos de perfil (28/11, sócia): quem tem foto no cadastro aparece com ela no lugar das iniciais — na indicação de responsável,
   no rodapé do menu e na barra superior. Uma leitura por sessão (nomes + caminho da foto) e links assinados de 24 h do bucket privado "fotos".
   Sem foto, sem rede ou sem permissão: tudo continua com as iniciais. ---------- */
const FOTOS = { nome: new Map(), perfil: new Map(), em: 0, pedindo: false };
const chaveFoto = (n) => String(n || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
const fotoDe = (nome) => (nome && FOTOS.nome.get(chaveFoto(nome))) || null;
const fotoDoPerfil = (id) => (id && FOTOS.perfil.get(id)) || null;
const pintarFoto = (b, url) => { if (!b || !url) return; b.classList.add("np-foto"); b.style.backgroundImage = `url("${url}")`; b.textContent = ""; };
function aplicarFotos(raiz) { if (!FOTOS.nome.size) return; (raiz || doc).querySelectorAll(".np-quem[data-quem] > b:not(.np-foto)").forEach((b) => pintarFoto(b, fotoDe(b.parentElement.getAttribute("data-quem")))); }
async function carregarFotos(force) {
  if (FOTOS.pedindo || (!force && FOTOS.em && Date.now() - FOTOS.em < 20 * 3600e3)) return;
  if (typeof SB === "undefined" || typeof PP === "undefined" || !PP.perfil || PP.perfil.papel === "cliente") return;
  FOTOS.pedindo = true;
  try {
    const { data, error } = await SB.from("v_colaboradores").select("nome,apelido,perfil_id,foto_path"); if (error) return;
    const todos = data || [], com = todos.filter((c) => c.foto_path); const nome = new Map(), perfil = new Map();
    if (com.length) {
      const { data: urls } = await SB.storage.from("fotos").createSignedUrls(com.map((c) => c.foto_path), 86400);
      const conta = (f) => { const m = new Map(); for (const c of todos) { const k = chaveFoto(f(c)); if (k) m.set(k, (m.get(k) || 0) + 1); } return m; };
      const nCurto = conta((c) => curto(c.nome)), nPrim = conta((c) => String(c.nome || "").trim().split(/\s+/)[0]), nApel = conta((c) => c.apelido);
      com.forEach((c, i) => {
        const u = urls?.[i]?.signedUrl; if (!u) return;
        nome.set(chaveFoto(c.nome), u); if (c.perfil_id) perfil.set(c.perfil_id, u);
        /* nomes abreviados só valem quando apontam para uma única pessoa */
        const kc = chaveFoto(curto(c.nome)), kp = chaveFoto(String(c.nome || "").trim().split(/\s+/)[0]), ka = chaveFoto(c.apelido);
        if (kc && nCurto.get(kc) === 1 && !nome.has(kc)) nome.set(kc, u);
        if (kp && nPrim.get(kp) === 1 && !nome.has(kp)) nome.set(kp, u);
        if (ka && nApel.get(ka) === 1 && !nome.has(ka)) nome.set(ka, u);
      });
    }
    FOTOS.nome = nome; FOTOS.perfil = perfil; FOTOS.em = Date.now();
    aplicarFotos(); doc.dispatchEvent(new CustomEvent("np-fotos"));
  } catch (_) { /* segue com as iniciais */ } finally { FOTOS.pedindo = false; }
}
const quem = (nome, { title } = {}) => {
  if (!nome) return el("span", { class: "np-quem np-quem-vazio" }, "— ninguém —");
  if (!FOTOS.em && !FOTOS.pedindo) carregarFotos();
  const b = el("b", { "aria-hidden": "true" }, iniciais(nome).toUpperCase()); pintarFoto(b, fotoDe(nome));
  return el("span", { class: "np-quem", title: title || nome, "data-quem": nome }, b, el("span", {}, curto(nome)));
};
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
/* quadros: cartões de número no topo da tela (pedido da sócia, 25/11). item: {titulo, n, sub, tom, ativo, onclick, acao} — com onclick o quadro é um botão (aria-pressed quando `ativo` é booleano) */
const quadros = (itens) => el("div", { class: "np-quadros", role: "group", "aria-label": "Resumo" }, itens.filter(Boolean).map(i => { const kids = [el("span", { class: "t" }, i.titulo), el("b", { class: i.tom || "" }, String(i.n)), i.sub ? el("span", { class: "s" }, i.sub) : null, i.acao ? el("span", { class: "a" }, i.acao, svgIco(I.chev, "np-ico np-chev")) : null]; return i.onclick ? el("button", { type: "button", class: "np-qd" + (i.ativo ? " on" : ""), "aria-pressed": typeof i.ativo === "boolean" ? String(i.ativo) : null, title: i.title || null, onclick: i.onclick }, kids) : el("div", { class: "np-qd" + (i.tom ? " " + i.tom : "") }, kids); }));
/* barras: distribuição por categoria (até `max` linhas; o resto soma em “Outros”). itens: [{rotulo, n}] */
const barras = ({ titulo, itens, max = 5, vazio = "Sem dados" }) => { const ord = itens.filter(i => i.n > 0).sort((a, b) => b.n - a.n); const topo = ord.slice(0, max); const resto = ord.slice(max).reduce((s, i) => s + i.n, 0); if (resto) topo.push({ rotulo: "Outros", n: resto }); const maior = Math.max(1, ...topo.map(i => i.n)); return el("section", { class: "np-barras" }, el("h3", {}, titulo), topo.length ? el("ul", {}, topo.map(i => el("li", {}, el("span", { class: "r", title: i.rotulo }, i.rotulo), el("span", { class: "tr", "aria-hidden": "true" }, el("i", { style: "width:" + Math.round(100 * i.n / maior) + "%" })), el("span", { class: "n" }, String(i.n))))) : el("div", { class: "v" }, vazio)); };
const resumo = (itens, o = {}) => el("div", { class: "np-resumo" + (o.quadros ? " np-resumo-q" : ""), role: "status", "aria-live": "polite" }, itens.filter(Boolean).map(i => el("span", {}, el("b", { class: i.tom || "" }, String(i.n)), " ", i.label)));
const toolbar = ({ resumo: r, filtros, filtrosFixos, direita }) => el("div", { class: "np-toolbar" }, r || null, filtros ? el("div", { class: "np-filtros-w", role: "group", "aria-label": "Filtros" }, el("div", { class: "np-filtros" }, filtros.filter(Boolean)), filtrosFixos ? el("div", { class: "np-filtros-fixos" }, filtrosFixos.filter(Boolean)) : null) : null, direita ? el("div", { class: "np-tb-dir" }, window.NPCasca?.acomodar ? window.NPCasca.acomodar(direita.filter(Boolean)) : direita.filter(Boolean)) : null); // V2: vista vai para a barra e a ação primária para a lateral (≥ 901 px)
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
const feito = (li, { texto, acao, onAcao }) => { const f = el("div", { class: "np-feito", role: "status" }, el("span", {}, texto), acao ? el("button", { type: "button", class: "lnk", onclick: onAcao }, acao) : null); li.replaceChildren(f); li.classList.remove("r-fatal", "r-late", "r-att", "r-hoje"); li.removeAttribute("aria-current"); li.classList.add("np-it-feita"); li.animate([{ opacity: .4 }, { opacity: 1 }], { duration: ms(240), easing: E_IN }); return f; };
const faixaErro = ({ texto, quando, acao = "Tentar de novo", onAcao }) => el("div", { class: "np-erro", role: "alert" }, el("i", {}, texto), quando ? el("span", {}, ` Mostrando os dados de ${quando}.`) : null, onAcao ? el("button", { type: "button", class: "lnk", onclick: onAcao }, acao) : null);
const vazio = ({ titulo, texto, acao, onAcao }) => el("div", { class: "np-vazio" }, el("h3", {}, titulo), el("p", {}, texto, acao ? [" ", el("button", { type: "button", class: "lnk", onclick: onAcao }, acao)] : null));
const carregando = (n = 6) => el("div", { class: "np-esqueleto", "aria-busy": "true", "aria-label": "Carregando" }, Array.from({ length: n }, () => el("div", {})));
const rodape = (texto, legenda) => el("div", { class: "np-rodape" }, el("span", {}, texto), legenda ? el("span", { class: "np-legenda", "aria-hidden": "true" }, ...legenda.map(([cls, l]) => el("span", {}, el("i", { class: cls }), l))) : null);

/* ---------- painel de detalhe (split ≥ 1180 · overlay 981–1179 · tela cheia ≤ 980) ---------- */
function painel({ obra, label = "Detalhe", onClose }) {
  const btnX = el("button", { type: "button", class: "np-ib", "aria-label": "Fechar (Esc)" }, svgIco(I.x));
  const trilha = el("div", { class: "np-trilha-p" }), tit = el("h2", {}), corpo = el("div", { class: "np-p-corpo" }), pe = el("div", { class: "np-p-pe" });
  const aside = el("aside", { class: "np-painel", "aria-label": label, hidden: "", inert: "" }, el("div", { class: "np-p-h" }, el("div", { class: "np-p-ht" }, trilha, tit), btnX), corpo, pe);
  const veu = el("div", { class: "np-p-veu", hidden: "", "aria-hidden": "true", onclick: () => fechar() }); // 25/11: detalhe abre como pop-up central sobre a lista (pedido da sócia)
  obra.append(veu, aside);
  let origem = null, aberto = false, ultimoId = null; // ultimoId: devolve o foco à linha certa mesmo quando a lista foi re-renderizada (origem desconectada)
  const modo = () => innerWidth <= 980 ? "cheia" : "centro";
  const aplicarModo = () => { const m = modo(); aside.dataset.modo = m; aside.setAttribute("role", "dialog"); aside.setAttribute("aria-modal", "true"); veu.hidden = !(aberto && m === "centro"); };
  const fechar = (devolver = true) => { if (!aberto) return; aberto = false; const fn = () => { obra.classList.remove("np-aberta"); aside.hidden = true; veu.hidden = true; aside.setAttribute("inert", ""); obra.querySelectorAll('.np-it[aria-current="true"]').forEach(i => i.removeAttribute("aria-current")); doc.body.classList.remove("np-painel-cheia"); }; vt(fn).then(() => { onClose?.(); const alvo = (origem && origem.isConnected) ? origem : (ultimoId != null ? obra.querySelector(`.np-it[data-id="${ultimoId}"] .np-it-abrir, .np-it[data-id="${ultimoId}"] button`) : null); if (devolver && alvo) alvo.focus(); origem = null; }); };
  /* Rodapé em linha única com no máximo 3 controles: 1 primário, até 1 secundário e transbordo ⋯ (NPUI.pop) para ações extras ou destrutivas. */
  const normalizarPe = (itens) => {
    const lista = [].concat(itens || []).filter(Boolean);
    const ehCtrl = (e) => e instanceof Element && (e.matches("button,a.np-btn") || e.classList?.contains("np-btn"));
    const controles = lista.filter(ehCtrl);
    if (controles.length <= 3) return lista;
    const pri = controles.find(e => e.classList.contains("pri")) || controles[0];
    const restantes = controles.filter(e => e !== pri);
    const destrutiva = (e) => e.classList.contains("danger") || e.classList.contains("crit") || /excluir|remover|apagar|desativar/i.test(e.textContent || "");
    const sec = restantes.find(e => !destrutiva(e)) || restantes[0];
    const extras = restantes.filter(e => e !== sec);
    const outrosNos = lista.filter(e => !ehCtrl(e) && !(e instanceof Element && e.classList?.contains("sp")));
    const btnMais = el("button", {
      type: "button",
      class: "np-ib np-p-mais",
      "aria-label": "Mais ações",
      title: "Mais ações",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onclick: (ev) => {
        const menuItens = extras.map(b => ({
          label: (b.textContent || b.getAttribute("aria-label") || b.title || "Ação").trim(),
          tom: destrutiva(b) ? "crit" : "",
          disabled: !!b.disabled,
          title: b.title || null,
          onclick: () => b.click(),
        }));
        pop(ev.currentTarget, menuItens, { role: "menu", label: "Mais ações", alinhar: "dir", refoco: ev.currentTarget });
      },
    }, svgIco(I.pontos));
    return [pri, sec, el("span", { class: "sp" }), ...outrosNos, btnMais].filter(Boolean);
  };
  /* `pend` guarda sempre o último conteúdo pedido: abrir() aplica o DOM dentro de uma view transition (assíncrona) e atualizar()
     pode chegar antes disso — sem isto, o esqueleto do abrir() sobrescreveria os dados já carregados (corrida vista no CI) */
  let pend = { c: null, p: null };
  const abrir = ({ trilha: tr, titulo, corpo: c, pe: p, origem: o, id, foco }) => {
    const ja = aberto; aberto = true; aplicarModo(); if (o) origem = o; if (id != null) ultimoId = id; pend = { c, p: p || [] };
    const linhaTx = id != null ? obra.querySelector(`.np-it[data-id="${id}"] .tx`) : null; if (linhaTx && !ja && aside.dataset.modo !== "centro") linhaTx.style.viewTransitionName = "np-titulo"; // no pop-up central o título não “viaja” da linha: só esmaece
    const fn = () => { if (linhaTx) linhaTx.style.viewTransitionName = ""; trilha.replaceChildren(...(Array.isArray(tr) ? tr : [tr]).filter(Boolean)); tit.textContent = titulo; corpo.replaceChildren(...[].concat(pend.c).filter(Boolean)); pe.replaceChildren(...normalizarPe(pend.p)); aside.hidden = false; aside.removeAttribute("inert"); obra.classList.add("np-aberta"); obra.querySelectorAll('.np-it[aria-current="true"]').forEach(i => i.removeAttribute("aria-current")); if (id != null) obra.querySelector(`.np-it[data-id="${id}"]`)?.setAttribute("aria-current", "true"); doc.body.classList.toggle("np-painel-cheia", aside.dataset.modo === "cheia"); corpo.scrollTop = 0; };
    (ja ? Promise.resolve(fn()) : vt(fn)).then(() => { if (linhaTx) linhaTx.style.viewTransitionName = ""; if (foco) setTimeout(foco, ms(60)); else if (!ja) setTimeout(() => btnX.focus(), ms(60)); });
  };
  btnX.onclick = () => fechar();
  aside.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented) { if (doc.querySelector("#np-pop.on")) return; e.stopPropagation(); fechar(); } });
  matchMedia("(max-width:980px)").addEventListener("change", () => { if (aberto) aplicarModo(); }); matchMedia("(max-width:1179px)").addEventListener("change", () => { if (aberto) aplicarModo(); });
  return { el: aside, corpo, pe, abrir, fechar, get aberto() { return aberto; }, atualizar: ({ corpo: c, pe: p }) => { if (c) { pend.c = c; corpo.replaceChildren(...[].concat(c).filter(Boolean)); } if (p) { pend.p = p; pe.replaceChildren(...normalizarPe(p)); } } };
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
/* Paginação de listas longas: devolve null quando cabe tudo em uma página. "onIr(n)" recebe a página pedida (1…N). */
const fatia = (lista, pagina, porPagina = 40) => { const n = Math.max(1, Math.ceil(lista.length / porPagina)); const p = Math.min(Math.max(1, pagina || 1), n); return { pagina: p, paginas: n, itens: lista.slice((p - 1) * porPagina, p * porPagina), de: lista.length ? (p - 1) * porPagina + 1 : 0, ate: Math.min(lista.length, p * porPagina) }; };
const paginas = ({ total, pagina = 1, porPagina = 40, onIr, rotulo = "itens" } = {}) => {
  const n = Math.max(1, Math.ceil(total / porPagina)); if (n <= 1) return null; const p = Math.min(Math.max(1, pagina), n);
  const b = (txt, alvo, ar) => el("button", { type: "button", class: "np-btn ghost", disabled: alvo < 1 || alvo > n || alvo === p ? "" : null, "aria-label": ar, onclick: () => onIr && onIr(alvo) }, txt);
  return el("nav", { class: "np-paginas", "aria-label": "Páginas da lista", style: "display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:14px 4px 6px" },
    b("« Primeira", 1, "Primeira página"), b("‹ Anterior", p - 1, "Página anterior"),
    el("span", { class: "np-num", "aria-live": "polite", style: "min-width:150px;text-align:center" }, `Página ${p} de ${n}`),
    b("Próxima ›", p + 1, "Próxima página"), b("Última »", n, "Última página"),
    el("span", { class: "np-rodape", style: "padding:0 6px" }, `${(p - 1) * porPagina + 1}–${Math.min(total, p * porPagina)} de ${total} ${rotulo}`));
};
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
   → { fechar, erroCampo, avisoCampo, erroGeral, el, valores, mostrar }
   Fase 4C.2: campo checkbox (rótulo ao lado); mostrar(id, visível) oculta um campo SEM apagar o valor (continua em valores() e no payload; não é validado
   enquanto oculto); salvar() pode devolver {parcial:{msg,detalhe}} — o registro principal foi gravado, mas uma gravação secundária falhou: o formulário
   não fecha sozinho nem permite reenviar (evita duplicar o principal): mostra o aviso e só deixa "Fechar". */
const FORM_MSG = {
  obrigatorio: "Preencha este campo.", descartar: "Descartar as alterações?", continuar: "Continuar editando", descartarBtn: "Descartar",
  salvando: "Salvando…", excluindo: "Excluindo…", fechar: "Fechar", parcial: "Gravação concluída com ressalva", indisponivel: "O serviço está temporariamente indisponível e não foi possível confirmar se a operação foi concluída. Feche este formulário, confira o registro na lista e só então tente de novo.", semConexaoDesc: "Falha de comunicação: não foi possível confirmar se a operação foi concluída. Confira o registro na lista antes de tentar de novo.", sessao: "Sua sessão expirou — entre de novo e tente outra vez. Nada foi gravado.", resumoErros: (n) => `${n} campos precisam de atenção:`, semConexao: "Sem conexão com o banco — tente de novo.",
  bd: { "23505": "Já existe um registro igual. Nada foi gravado.", "23503": "Este registro faz referência a algo que não existe mais. Nada foi gravado.", "23514": "Um dos valores não é aceito pelo banco. Nada foi gravado.", "42501": "Sem permissão para gravar este registro. Nada foi gravado.", PGRST301: "Sem permissão para gravar este registro. Nada foi gravado.", PGRST116: "Registro não encontrado — pode ter sido excluído por outra pessoa. Nada foi gravado.", "22007": "Data inválida. Nada foi gravado.", "22P02": "Um dos valores está em formato inválido. Nada foi gravado." }, // recusas explícitas do banco: resultado conhecido
};
const traduzErroBD = (e) => { if (!e) return "Não foi possível salvar."; const code = String(e.code || ""); const st = Number(e.status || 0); const m = String(e.message || e);
  if (/^NP_/.test(code)) return m; /* mensagens já em português geradas pelo próprio formulário/persistência */
  if (FORM_MSG.bd[code]) return FORM_MSG.bd[code];
  if (st >= 500 || /^5\d\d$/.test(code) || /upstream|unavailable|indispon|gateway|timeout|timed out|overloaded|too many/i.test(m)) return FORM_MSG.indisponivel;
  if (st === 401 || code === "401") return FORM_MSG.sessao;
  if (/Failed to fetch|NetworkError|network|fetch|ECONN|offline|aborted/i.test(m)) return FORM_MSG.semConexaoDesc; // resultado desconhecido: o pedido pode ter chegado ao banco
  return m || "Não foi possível salvar."; };
const detalheDe = (e) => { if (!e) return ""; if (/^NP_/.test(String(e.code || ""))) return ""; return [e.status ? "HTTP " + e.status : null, e.code ? "código " + e.code : null, e.message, e.detalhe].filter(Boolean).join(" · "); };
const form = ({ titulo, contexto, campos = [], validarTudo, salvar, excluir, origem, aoFechar, rotuloSalvar, confirmar: rotConfirmar } = {}) => {
  const txtSalvar = rotConfirmar || rotuloSalvar || "Salvar";
  if (typeof needDb === "function" && !needDb()) return null;
  const host = doc.querySelector("#modalHost"); if (!host) return null; host.replaceChildren();
  const app = doc.querySelector("#app"); const origemEl = origem || doc.activeElement;
  const uid = "npf" + Math.random().toString(36).slice(2, 8); let enviando = false, fechado = false;
  const tit = el("h2", { id: uid + "-t" }, titulo); const ctx = contexto ? el("p", { class: "np-f-ctx", id: uid + "-c" }, contexto) : null;
  const btnX = el("button", { type: "button", class: "np-ib np-f-x", "aria-label": "Fechar (Esc)" }, svgIco(I.x));
  const geral = el("div", { class: "np-f-geral", role: "alert", hidden: "" }); const vivo = el("div", { class: "np-vh", "aria-live": "polite" });
  const grade = el("div", { class: "form np-f-campos" });
  const valorDe = (c) => c.el.type === "checkbox" ? c.el.checked : c.el.value; const inicial = new Map();
  const porId = {}; const erroEl = {}; const avisoEl = {}; const caixa = {}; let cruzados = new Set(); // campos marcados pela regra cruzada (validarTudo), reavaliados a cada digitação
  for (const c of campos) {
    if (!c) continue;
    if (c instanceof Element) { grade.append(c); continue; }
    if (!c.el) continue;
    porId[c.id] = c; c.el.id = c.id; const chk = c.el.type === "checkbox"; const lab = el("label", { for: c.id }, c.label, c.obrigatorio ? el("span", { class: "np-f-req", "aria-hidden": "true" }, " *") : (c.condicional || chk) ? null : el("span", { class: "np-f-opc" }, " (opcional)")); // condicional: obrigatório por regra cruzada (sem "(opcional)")
    const ajuda = c.ajuda ? el("div", { class: "help", id: c.id + "-h" }, c.ajuda) : null; erroEl[c.id] = el("p", { class: "np-f-erro", id: c.id + "-e", hidden: "" }); avisoEl[c.id] = el("p", { class: "np-f-aviso", id: c.id + "-a", hidden: "" });
    c.el.setAttribute("aria-describedby", [ajuda ? c.id + "-h" : null, c.id + "-e", c.id + "-a"].filter(Boolean).join(" ")); if (c.obrigatorio) c.el.setAttribute("aria-required", "true");
    caixa[c.id] = chk ? el("div", { class: "f np-f np-f-check" + (c.largo ? " full" : ""), "data-campo": c.id }, el("div", { class: "np-f-check-l" }, c.el, lab), ajuda, erroEl[c.id], avisoEl[c.id])
      : el("div", { class: "f np-f" + (c.el.tagName === "TEXTAREA" || c.largo ? " full" : ""), "data-campo": c.id }, lab, c.el, ajuda, erroEl[c.id], avisoEl[c.id]);
    grade.append(caixa[c.id]);
    inicial.set(c.id, valorDe(c)); c.el.addEventListener("blur", () => validarCampo(c, { noBlur: true })); c.el.addEventListener(chk ? "change" : "input", () => { if (c.el.getAttribute("aria-invalid") === "true" && !cruzados.has(c.id)) validarCampo(c, { noBlur: true }); if (cruzados.size) reavaliarCruzados(); }); }
  const oculto = (id) => !!caixa[id]?.hidden;
  const mostrar = (id, visivel) => { const c = porId[id]; if (!c) return; caixa[id].hidden = !visivel; if (!visivel) { erroCampo(id, null); avisoCampo(id, null); } }; // o valor fica intacto: valores() e alterado() continuam considerando o campo
  const erroCampo = (id, msg) => { const c = porId[id]; if (!c) return; if (msg) { erroEl[id].textContent = msg; erroEl[id].hidden = false; c.el.setAttribute("aria-invalid", "true"); c.el.closest(".np-f")?.classList.add("com-erro"); } else { erroEl[id].hidden = true; erroEl[id].textContent = ""; c.el.removeAttribute("aria-invalid"); c.el.closest(".np-f")?.classList.remove("com-erro"); } };
  const avisoCampo = (id, msg) => { const c = porId[id]; if (!c) return; avisoEl[id].hidden = !msg; avisoEl[id].textContent = msg || ""; if (msg) vivo.textContent = c.label + ": " + msg; };
  const erroGeral = (msg, detalhe) => { geral.replaceChildren(); if (!msg) { geral.hidden = true; return; } geral.append(el("b", {}, msg)); if (detalhe && String(detalhe) !== msg) geral.append(el("details", {}, el("summary", {}, "detalhes técnicos"), el("code", {}, String(detalhe).slice(0, 400)))); geral.hidden = false; };
  const validarCampo = (c, { noBlur } = {}) => { if (oculto(c.id)) { erroCampo(c.id, null); return null; } const v = valorDe(c); let r = null; if (c.obrigatorio && (v == null || String(v).trim() === "")) r = FORM_MSG.obrigatorio; else if (typeof c.validar === "function") { try { r = c.validar(v, valores()); } catch (_) { r = null; } }
    if (r && typeof r === "object" && r.aviso) { erroCampo(c.id, null); avisoCampo(c.id, r.aviso); return null; } avisoCampo(c.id, null); erroCampo(c.id, r || null); return r || null; };
  const reavaliarCruzados = () => { let cruz = []; try { cruz = (typeof validarTudo === "function" && validarTudo(valores())) || []; } catch (_) { cruz = []; } const agora = new Set(cruz.filter(e => e && e.campo && porId[e.campo]).map(e => e.campo)); for (const id of cruzados) if (!agora.has(id)) erroCampo(id, null); for (const e of cruz) if (e && e.campo && porId[e.campo]) erroCampo(e.campo, e.msg); cruzados = agora; if (!cruzados.size && geral.querySelector("ul")) geral.hidden = true; };
  const valores = () => { const o = {}; for (const c of campos) if (c && c.el) o[c.id] = valorDe(c); return o; };
  const validarTodos = () => { const erros = []; for (const c of campos) { if (!c || !c.el) continue; const r = validarCampo(c); if (r) erros.push({ campo: c.id, msg: r }); }
    cruzados = new Set(); if (typeof validarTudo === "function") { let cruz = []; try { cruz = validarTudo(valores()) || []; } catch (_) { cruz = []; } for (const e of cruz) { if (e && e.campo && porId[e.campo]) cruzados.add(e.campo); if (e && e.campo && porId[e.campo]) { erroCampo(e.campo, e.msg); if (!erros.some(x => x.campo === e.campo)) erros.push(e); } else if (e && e.msg) erros.push(e); } }
    if (erros.length >= 2) { geral.replaceChildren(el("b", {}, FORM_MSG.resumoErros(erros.length)), el("ul", {}, ...erros.map(e => el("li", {}, porId[e.campo] ? el("a", { href: "#" + e.campo, onclick: (ev) => { ev.preventDefault(); porId[e.campo].el.focus(); } }, porId[e.campo].label + ": " + e.msg) : e.msg)))); geral.hidden = false; }
    else if (erros.length === 1 && !porId[erros[0].campo]) erroGeral(erros[0].msg); else geral.hidden = true;
    return erros; };
  let concluido = false; // gravação principal feita com ressalva: nada mais é enviado; só "Fechar"
  const alterado = () => { if (concluido) return false; for (const c of campos) if (c && c.el && String(valorDe(c)) !== String(inicial.get(c.id))) return true; return false; };
  const btnSalvar = el("button", { type: "submit", class: "btn primary np-f-salvar" }, txtSalvar); const btnCancelar = el("button", { type: "button", class: "btn np-f-cancelar" }, "Cancelar");
  const btnExcluir = excluir ? el("button", { type: "button", class: "btn danger np-f-excluir" }, excluir.rotulo || "Excluir") : null;
  const confirmBox = el("div", { class: "np-f-confirm", role: "alertdialog", "aria-labelledby": uid + "-cf", hidden: "" });
  const acoes = el("div", { class: "actions np-f-acoes" }, btnExcluir, el("span", { class: "sp" }), btnCancelar, btnSalvar);
  const formEl = el("form", { class: "np-f-form", novalidate: "" }, grade); const card = el("div", { class: "card np-form", role: "dialog", "aria-modal": "true", "aria-labelledby": uid + "-t", "aria-describedby": ctx ? uid + "-c" : null }, el("div", { class: "np-f-cab" }, el("div", {}, tit, ctx), btnX), geral, vivo, formEl, confirmBox, acoes);
  const fundo = el("div", { class: "modal np-form-fundo" }, card);
  const restaurar = () => { if (fechado) return; fechado = true; host.replaceChildren(); app?.removeAttribute("inert"); doc.removeEventListener("keydown", teclas, true); try { aoFechar?.(); } catch (_) {} const alvo = (origemEl && origemEl.isConnected && typeof origemEl.focus === "function") ? origemEl : null; setTimeout(() => { try { alvo ? alvo.focus() : doc.body.focus(); } catch (_) {} }, 0); };
  const focaveis = () => [...(confirmando ? confirmBox : card).querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(e => !e.disabled && !e.hidden && e.offsetParent !== null && !e.closest("[hidden]"));
  let confirmando = null, focoAntes = null; // {onSim}; focoAntes: elemento que tinha o foco antes da confirmação
  const pedirConfirmacao = (texto, rotuloSim, onSim, { perigo } = {}) => { confirmando = { onSim }; focoAntes = card.contains(doc.activeElement) ? doc.activeElement : null; formEl.setAttribute("inert", ""); btnX.disabled = true; confirmBox.replaceChildren(el("p", { id: uid + "-cf" }, texto), el("div", { class: "np-f-confirm-acoes" }, el("button", { type: "button", class: "btn np-f-conf-nao", onclick: fecharConfirmacao }, FORM_MSG.continuar), el("button", { type: "button", class: ("btn np-f-conf-sim " + (perigo ? "danger" : "primary")), onclick: () => { const fn = confirmando?.onSim; fecharConfirmacao({ devolver: false }); fn && fn(); } }, rotuloSim))); confirmBox.hidden = false; acoes.hidden = true; setTimeout(() => confirmBox.querySelector(".np-f-conf-nao")?.focus(), 0); };
  const fecharConfirmacao = ({ devolver = true } = {}) => { confirmando = null; confirmBox.hidden = true; confirmBox.replaceChildren(); acoes.hidden = false; formEl.removeAttribute("inert"); if (!enviando) btnX.disabled = false; const alvo = focoAntes; focoAntes = null; if (devolver) setTimeout(() => { try { (alvo && alvo.isConnected && !alvo.disabled ? alvo : (campos.find(c => c && c.el && !c.el.disabled)?.el || btnCancelar)).focus(); } catch (_) {} }, 0); };
  const tentarFechar = () => { if (enviando) return; if (confirmando) { fecharConfirmacao(); return; } if (alterado()) { pedirConfirmacao(FORM_MSG.descartar, FORM_MSG.descartarBtn, restaurar, { perigo: true }); return; } restaurar(); };
  const travar = (on, txt) => { enviando = on; card.setAttribute("aria-busy", String(on)); btnSalvar.disabled = on; btnCancelar.disabled = on; btnX.disabled = on; if (btnExcluir) btnExcluir.disabled = on; if (on) { btnSalvar.dataset.rotulo = btnSalvar.textContent; btnSalvar.textContent = txt || FORM_MSG.salvando; vivo.textContent = txt || FORM_MSG.salvando; } else { if (btnSalvar.dataset.rotulo) btnSalvar.textContent = btnSalvar.dataset.rotulo; } };
  const concluirParcial = ({ msg, detalhe } = {}) => { concluido = true; enviando = false; card.setAttribute("aria-busy", "false"); formEl.setAttribute("inert", ""); btnSalvar.hidden = true; if (btnExcluir) btnExcluir.hidden = true; btnCancelar.disabled = false; btnCancelar.textContent = FORM_MSG.fechar; btnX.disabled = false;
    geral.replaceChildren(el("b", {}, FORM_MSG.parcial), el("p", {}, msg || "")); if (detalhe) geral.append(el("details", {}, el("summary", {}, "detalhes técnicos"), el("code", {}, String(detalhe).slice(0, 400)))); geral.classList.add("np-f-parcial"); geral.hidden = false; vivo.textContent = FORM_MSG.parcial + ": " + (msg || ""); setTimeout(() => geral.focus?.(), 0); };
  const enviar = async () => { if (enviando || confirmando || concluido) return; const erros = validarTodos(); if (erros.length) { const c = porId[erros[0].campo]; (c ? c.el : geral).focus?.(); return; } erroGeral(null); travar(true, FORM_MSG.salvando);
    try { const r = await salvar(valores()); if (r && r.parcial && !fechado) concluirParcial(r.parcial); else fechado || restaurar(); } catch (e) { travar(false); erroGeral(traduzErroBD(e), detalheDe(e)); geral.focus?.(); } };
  const excluirAgora = async () => { if (enviando || !excluir || concluido) return; erroGeral(null); travar(true, FORM_MSG.excluindo); try { await excluir.acao(); fechado || restaurar(); } catch (e) { travar(false); erroGeral(traduzErroBD(e), detalheDe(e)); geral.focus?.(); } };
  btnSalvar.onclick = (e) => { e.preventDefault(); enviar(); }; formEl.addEventListener("submit", (e) => { e.preventDefault(); enviar(); });
  btnCancelar.onclick = tentarFechar; btnX.onclick = tentarFechar; fundo.addEventListener("mousedown", (e) => { if (e.target === fundo) tentarFechar(); });
  if (btnExcluir) btnExcluir.onclick = () => { if (enviando || concluido) return; pedirConfirmacao(excluir.confirmar || "Excluir este registro?", excluir.rotulo || "Excluir", excluirAgora, { perigo: true }); };
  const teclas = (e) => { if (!card.isConnected) return; if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); tentarFechar(); return; }
    if (e.key === "Tab") { const fs = focaveis(); if (!fs.length) return; const i = fs.indexOf(doc.activeElement); if (e.shiftKey && (i <= 0)) { e.preventDefault(); fs[fs.length - 1].focus(); } else if (!e.shiftKey && (i === fs.length - 1 || i === -1)) { e.preventDefault(); fs[0].focus(); } return; }
    if (e.key === "Enter" && enviando) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === "Enter" && !confirmando && !concluido && e.target && /^(INPUT|SELECT)$/.test(e.target.tagName) && e.target.type !== "checkbox" && card.contains(e.target)) { e.preventDefault(); enviar(); } };
  doc.addEventListener("keydown", teclas, true);
  host.append(fundo); geral.tabIndex = -1; app?.setAttribute("inert", "");
  // segurança: se outro código esvaziar #modalHost (modal() da V2, limpezas antigas), o inert e os ouvintes são desfeitos — o app nunca fica travado
  const obs = new MutationObserver(() => { if (!fundo.isConnected && !fechado) { obs.disconnect(); restaurar(); } else if (fechado) obs.disconnect(); }); obs.observe(host, { childList: true });
  setTimeout(() => { const primeiro = campos.find(c => c && c.el && c.el.getAttribute("aria-invalid") === "true") || campos.find(c => c && c.el && !c.el.disabled); (primeiro ? primeiro.el : btnX).focus(); }, 0);
  return { fechar: restaurar, erroCampo, avisoCampo, erroGeral, el: card, valores, mostrar };
};
/* ---------- V5 (16/11) — modal() da V2 sob a casca V3.1 ----------
   Os formulários que chamam modal(title, body, onSave, extra) (≈110, em todos os módulos) ganham, SÓ com a casca ligada, a experiência do
   NPUI.form sem mudar o que gravam: cabeçalho com Fechar, role=dialog + aria-labelledby, foco inicial no primeiro campo, preso (inert em #app)
   e devolvido à origem; Escape, fundo, X e Cancelar pedem "Descartar as alterações?" quando a pessoa alterou algum campo (só alteração feita
   por ela: preenchimento automático não conta); envio com trava (onSave roda uma vez por clique, "Salvando…", Salvar/Cancelar/X desabilitados,
   Enter e Escape ignorados durante o envio) e erro exibido no próprio diálogo, traduzido, sem fechar. O DOM continua compatível com a V2:
   .modal > .card (primeiro .card do host) > h2 … corpo … .actions (extra, Cancelar, Salvar = primeiro button.btn.primary) — quem renomeia ou
   remove o Salvar, acrescenta classe ao .card ou esvazia #modalHost (exclusões) continua funcionando; o encerramento só remove o próprio diálogo,
   nunca um formulário aberto em seguida. */
/* 26/11 · Janelas no visual do sistema: seletor curto (2 a 4 opções, sem “— escolha —”) vira botões lado a lado.
   O <select> continua no lugar (só fica invisível), com o mesmo id e valor: o módulo lê e grava nele como sempre, e os
   botões acompanham. Nada de regra muda — é a mesma escolha, visível de uma vez. */
const segmentarSelects = (raiz) => {
  const feitos = new Map();
  const elegivel = (sl) => !sl.multiple && !sl.size && sl.options.length >= 2 && sl.options.length <= 4 && ![...sl.options].some((o) => o.value === "" || o.disabled || /^[—-]/.test(o.textContent.trim())) && [...sl.options].reduce((n, o) => n + o.textContent.trim().length, 0) <= (sl.options.length === 4 ? 20 : 30) && !sl.dataset.npSegNao && !sl.closest(".np-tp,table,.np-seg-nao,[data-sem-seg]") && !sl.hasAttribute("data-sem-seg");
  const montar = (sl) => { const g = el("div", { class: "np-segs", role: "radiogroup", "aria-label": sl.getAttribute("aria-label") || (sl.id && raiz.querySelector(`label[for="${CSS.escape(sl.id)}"]`)?.textContent) || null });
    const sinal = sl.options.length + "|" + [...sl.options].map((o) => o.value + "=" + o.textContent).join("|");
    for (const o of sl.options) g.append(el("button", { type: "button", role: "radio", "data-v": o.value, "aria-checked": "false", tabindex: "-1", onclick: () => { if (sl.disabled) return; sl.value = o.value; sl.dispatchEvent(new Event("input", { bubbles: true })); sl.dispatchEvent(new Event("change", { bubbles: true })); pintar(sl, g); } }, o.textContent.trim()));
    g.addEventListener("keydown", (e) => { const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!d) return; e.preventDefault(); const bs = [...g.children]; const i = bs.findIndex((b) => b.getAttribute("aria-checked") === "true"); const n = bs[(i + d + bs.length) % bs.length]; n.click(); n.focus(); });
    sl.classList.add("np-seg-oculto"); sl.setAttribute("tabindex", "-1"); sl.after(g); feitos.set(sl, { g, sinal }); pintar(sl, g);
    /* não coube (texto cortado)? volta a ser seletor comum */ requestAnimationFrame(() => { if (g.isConnected && g.offsetWidth && [...g.children].some((b) => b.scrollWidth > b.clientWidth + 1)) { g.remove(); sl.classList.remove("np-seg-oculto"); sl.removeAttribute("tabindex"); sl.dataset.npSegNao = "1"; feitos.delete(sl); } }); };
  const pintar = (sl, g) => { for (const b of g.children) { const on = b.dataset.v === sl.value; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; b.disabled = sl.disabled; } if (![...g.children].some((b) => b.tabIndex === 0) && g.firstElementChild) g.firstElementChild.tabIndex = 0; };
  const varrer = () => { for (const sl of raiz.querySelectorAll("select")) { const f = feitos.get(sl); const sinal = sl.options.length + "|" + [...sl.options].map((o) => o.value + "=" + o.textContent).join("|");
      if (f) { if (!f.g.isConnected || f.sinal !== sinal) { f.g.remove(); sl.classList.remove("np-seg-oculto"); sl.removeAttribute("tabindex"); feitos.delete(sl); if (elegivel(sl)) montar(sl); } else pintar(sl, f.g); }
      else if (elegivel(sl)) montar(sl); } };
  varrer(); const t = setInterval(varrer, 250); const ob = new MutationObserver(() => varrer()); ob.observe(raiz, { childList: true, subtree: true });
  return () => { clearInterval(t); ob.disconnect(); };
};
const modalV3 = (title, body, onSave, extra, opts = {}) => {
  if (typeof needDb === "function" && !needDb()) return;
  const host = doc.querySelector("#modalHost"); if (!host) return; host.replaceChildren();
  const app = doc.querySelector("#app"); const origemEl = doc.activeElement;
  const uid = "npm" + Math.random().toString(36).slice(2, 8); let enviando = false, fechado = false, sujo = false, confirmando = false, focoAntes = null;
  const btnX = el("button", { type: "button", class: "np-ib np-f-x", "aria-label": "Fechar (Esc)" }, svgIco(I.x));
  const geral = el("div", { class: "np-f-geral", role: "alert", tabindex: "-1", hidden: "" }); const vivo = el("div", { class: "np-vh", "aria-live": "polite" });
  const rotCancelar = opts?.cancelar || "Cancelar";
  const rotSalvar = opts?.confirmar || opts?.rotuloSalvar || body?.dataset?.rotuloSalvar || "Salvar";
  const btnCancelar = el("button", { type: "button", class: "btn np-f-cancelar" }, rotCancelar);
  const btnSalvar = el("button", { type: "button", class: "btn " + (opts?.perigo ? "danger" : "primary") + " np-f-salvar" }, rotSalvar);
  const confirmBox = el("div", { class: "np-f-confirm", role: "alertdialog", "aria-labelledby": uid + "-cf", hidden: "" });
  const corpo = el("div", { class: "np-m-corpo" }, body);
  const acoes = el("div", { class: "actions np-f-acoes" }, extra || null, el("span", { class: "sp" }), btnCancelar, btnSalvar);
  const card = el("div", { class: "card np-form np-modal-v3", role: "dialog", "aria-modal": "true", "aria-labelledby": uid + "-t" },
    el("div", { class: "np-f-cab" }, el("div", {}, el("h2", { id: uid + "-t" }, title)), btnX), geral, vivo, corpo, confirmBox, acoes);
  const fundo = el("div", { class: "modal np-form-fundo" }, card);
  const marcar = (e) => { if (e.isTrusted && !enviando) sujo = true; }; corpo.addEventListener("input", marcar, true); corpo.addEventListener("change", marcar, true);
  const outroAberto = () => [...host.querySelectorAll('[role="dialog"]')].some((d) => d !== card);
  let pararSeg = null;
  const restaurar = () => { if (fechado) return; fechado = true; obs.disconnect(); try { pararSeg?.(); } catch (_) {} doc.removeEventListener("keydown", teclas, true); if (fundo.isConnected) fundo.remove();
    if (outroAberto()) return; /* outro formulário abriu no lugar deste: ele cuida do inert e do foco */ app?.removeAttribute("inert");
    const alvo = (origemEl && origemEl.isConnected && typeof origemEl.focus === "function") ? origemEl : null; setTimeout(() => { try { alvo ? alvo.focus() : doc.body.focus(); } catch (_) {} }, 0); };
  const focaveis = () => [...(confirmando ? confirmBox : card).querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled && !e.hidden && e.offsetParent !== null && !e.closest("[hidden],[inert]"));
  const pedirConfirmacao = () => { confirmando = true; focoAntes = card.contains(doc.activeElement) ? doc.activeElement : null; corpo.setAttribute("inert", ""); btnX.disabled = true;
    confirmBox.replaceChildren(el("p", { id: uid + "-cf" }, FORM_MSG.descartar), el("div", { class: "np-f-confirm-acoes" },
      el("button", { type: "button", class: "btn np-f-conf-nao", onclick: () => fecharConfirmacao() }, FORM_MSG.continuar),
      el("button", { type: "button", class: "btn danger np-f-conf-sim", onclick: () => { fecharConfirmacao({ devolver: false }); restaurar(); } }, FORM_MSG.descartarBtn)));
    confirmBox.hidden = false; acoes.hidden = true; setTimeout(() => confirmBox.querySelector(".np-f-conf-nao")?.focus(), 0); };
  const fecharConfirmacao = ({ devolver = true } = {}) => { confirmando = false; confirmBox.hidden = true; confirmBox.replaceChildren(); acoes.hidden = false; corpo.removeAttribute("inert"); btnX.disabled = false;
    const alvo = focoAntes; focoAntes = null; if (devolver) setTimeout(() => { try { (alvo && alvo.isConnected && !alvo.disabled ? alvo : (corpo.querySelector("input,select,textarea") || btnCancelar)).focus(); } catch (_) {} }, 0); };
  const tentarFechar = () => { if (enviando) return; if (confirmando) { fecharConfirmacao(); return; } if (sujo) { pedirConfirmacao(); return; } restaurar(); };
  const travar = (on) => { enviando = on; card.setAttribute("aria-busy", String(on)); btnCancelar.disabled = on; btnX.disabled = on;
    const salvar = card.querySelector(".np-f-salvar"); if (!salvar) return; salvar.disabled = on; /* o módulo pode ter renomeado ("Enviar", "Importar"…) */
    if (on) { salvar.dataset.rotulo = salvar.textContent; salvar.textContent = FORM_MSG.salvando; vivo.textContent = FORM_MSG.salvando; } else if (salvar.dataset.rotulo) { salvar.textContent = salvar.dataset.rotulo; delete salvar.dataset.rotulo; } };
  const mostrarErro = (e) => { const msg = traduzErroBD(e); const det = (e && (e.code || e.status)) ? detalheDe(e) : ""; geral.replaceChildren(el("b", {}, msg));
    if (det && det !== msg) geral.append(el("details", {}, el("summary", {}, "detalhes técnicos"), el("code", {}, String(det).slice(0, 400)))); geral.hidden = false;
    if (e && e.campo) { revelarCampo(e.campo); return; }
    setTimeout(() => { try { geral.focus(); } catch (_) {} }, 0); };
  const checarInvalidosEmMais = () => {
    for (const det of corpo.querySelectorAll("details.np-f-mais")) {
      if (det.open) continue;
      for (const ctrl of det.querySelectorAll("input,select,textarea")) {
        if (ctrl.disabled || ctrl.type === "hidden") continue;
        if (typeof ctrl.checkValidity === "function" && !ctrl.checkValidity()) {
          det.open = true;
          try { ctrl.focus(); ctrl.reportValidity?.(); } catch (_) {}
          return ctrl;
        }
      }
    }
    return null;
  };
  const enviar = async () => { if (enviando || confirmando || fechado) return; geral.hidden = true;
    const inv = checarInvalidosEmMais(); if (inv) return;
    travar(true);
    try { await onSave(); if (fechado) return; travar(false); restaurar(); } catch (e) { if (fechado) return; travar(false); mostrarErro(e); } };
  btnSalvar.onclick = (e) => { e.preventDefault(); enviar(); }; btnCancelar.onclick = tentarFechar; btnX.onclick = tentarFechar;
  fundo.addEventListener("mousedown", (e) => { if (e.target === fundo) tentarFechar(); });
  const teclas = (e) => { if (!card.isConnected) return; if (e.key === "Escape") { if (popAtual) return; /* o popover fecha primeiro */ e.preventDefault(); e.stopPropagation(); tentarFechar(); return; }
    if (e.key === "Tab") { const fs = focaveis(); if (!fs.length) return; const i = fs.indexOf(doc.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); fs[fs.length - 1].focus(); } else if (!e.shiftKey && (i === fs.length - 1 || i === -1)) { e.preventDefault(); fs[0].focus(); } return; }
    if (e.key === "Enter" && enviando) { e.preventDefault(); e.stopPropagation(); } };
  doc.addEventListener("keydown", teclas, true);
  host.append(fundo); app?.setAttribute("inert", "");
  pararSeg = segmentarSelects(corpo);
  // quem esvazia #modalHost (exclusões da V2, outro formulário) encerra este diálogo: inert, ouvintes e foco são desfeitos
  const obs = new MutationObserver(() => { if (!fundo.isConnected && !fechado) restaurar(); }); obs.observe(host, { childList: true });
  setTimeout(() => { if (fechado) return; const primeiro = corpo.querySelector("input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])"); (primeiro || btnX).focus(); }, 0);
  return { fechar: restaurar, el: card };
};
modalV3.ativo = () => doc.documentElement.classList.contains("np-casca-v3"); /* o desvio do modal() só vale com a casca V3.1 ligada */

/* ---------- Onda 4A · Organização editorial de formulários ---------- */
const secaoForm = (titulo, descricao) => el("div", { class: "np-f-sec full" },
  el("h3", { class: "np-f-sec-t" }, titulo),
  descricao ? el("p", { class: "np-f-sec-d" }, descricao) : null
);

const maisCampos = (rotulo = "Mais opções", conteudo = [], { aberto = false, contador } = {}) => {
  const corpo = el("div", { class: "np-f-mais-b form" });
  for (const item of [].concat(conteudo || []).filter(Boolean)) corpo.append(item);
  const badge = el("span", { class: "np-f-mais-c" });
  const contarPreenchidos = () => {
    let n = 0;
    corpo.querySelectorAll("input,select,textarea").forEach((ctrl) => {
      if (ctrl.type === "hidden" || ctrl.disabled) return;
      if (ctrl.type === "checkbox" || ctrl.type === "radio") { if (ctrl.checked) n++; }
      else if (String(ctrl.value || "").trim() !== "") n++;
    });
    return n;
  };
  const atualizarContador = () => {
    if (contador == null) { badge.hidden = true; badge.textContent = ""; return; }
    if (contador === "auto") {
      const n = contarPreenchidos();
      badge.textContent = n ? `(${n} ${n === 1 ? "preenchido" : "preenchidos"})` : "";
      badge.hidden = !n;
      return;
    }
    const txt = typeof contador === "function" ? contador() : contador;
    if (typeof txt === "number") {
      badge.textContent = txt ? `(${txt} ${txt === 1 ? "preenchido" : "preenchidos"})` : "";
      badge.hidden = !txt;
    } else {
      badge.textContent = txt ? String(txt) : "";
      badge.hidden = !txt;
    }
  };
  atualizarContador();
  if (contador === "auto" || typeof contador === "function") {
    corpo.addEventListener("input", atualizarContador, true);
    corpo.addEventListener("change", atualizarContador, true);
  }
  const sum = el("summary", { class: "np-f-mais-s" }, svgIco(I.chev, "np-ico np-f-mais-chev"), el("span", { class: "np-f-mais-l" }, rotulo), badge);
  const det = el("details", { class: "np-f-mais full", open: aberto ? "" : null }, sum, corpo);
  det.atualizarContador = atualizarContador;
  return det;
};

/* Abre qualquer bloco NPUI.maisCampos pai ao ocorrer erro de validação em campo recolhido */
const revelarCampo = (ctrl) => {
  if (!ctrl) return false;
  let aberto = false;
  let p = ctrl.parentElement;
  while (p) {
    if (p.tagName === "DETAILS" && p.classList?.contains("np-f-mais")) {
      if (!p.open) { p.open = true; aberto = true; }
    }
    p = p.parentElement;
  }
  setTimeout(() => {
    try { ctrl.scrollIntoView?.({ block: "nearest" }); ctrl.focus?.(); } catch (_) {}
  }, 0);
  return aberto;
};

/* ---------- Onda 4A · Diálogos acessíveis V3.1 (confirmar + pedirTexto) com fallback V2 ---------- */
const prenderIrmaos = (host, bg) => {
  const presos = [];
  for (const ch of [...host.children]) {
    if (ch !== bg && !ch.hasAttribute("inert")) { ch.setAttribute("inert", ""); presos.push(ch); }
  }
  return () => { for (const ch of presos) ch.removeAttribute("inert"); };
};

/* Diálogo acessível de confirmação explícita (role="alertdialog") — retorna Promise<boolean> com .fechar e .el */
const confirmar = ({ titulo = "Confirmar ação", mensagem = "", texto = "", detalhe = null, confirmar: rotConfirmar, rotuloSim, cancelar: rotCancelar, rotuloNao, perigo = false, onSim, origem } = {}) => {
  const msg = mensagem || texto || "";
  const lblSim = rotConfirmar || rotuloSim || "Confirmar";
  const lblNao = rotCancelar || rotuloNao || "Cancelar";

  if (!doc.documentElement.classList.contains("np-casca-v3")) {
    const pV2 = (async () => {
      const ok = window.confirm(msg || titulo);
      if (ok && typeof onSim === "function") await onSim();
      return !!ok;
    })();
    pV2.fechar = () => {};
    pV2.el = null;
    return pV2;
  }

  const host = doc.querySelector("#modalHost") || doc.body;
  const app = doc.querySelector("#app");
  const origemEl = origem || (doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null);
  const uid = "np-cf-" + Math.random().toString(36).slice(2, 8);
  let fechado = false, enviando = false, resolver = null;

  const erroBox = el("div", { class: "np-f-geral", role: "alert", hidden: true, tabindex: -1 });
  const btnNao = el("button", { type: "button", class: "np-btn" }, lblNao);
  const btnSim = el("button", { type: "button", class: "np-btn " + (perigo ? "danger" : "pri") }, lblSim);
  const btnX = el("button", { type: "button", class: "np-ib", "aria-label": "Fechar" }, svgIco(I.x));

  const corpo = el("div", { class: "np-alert-b" });
  if (msg) corpo.append(el("p", { id: uid + "-d", class: "np-confirm-txt" }, msg));
  if (detalhe) corpo.append(typeof detalhe === "string" ? el("div", { class: "np-diff-meta" }, detalhe) : detalhe);
  corpo.append(erroBox);

  const dlg = el("div", {
    class: "np-alert-dlg np-confirm-dlg",
    role: "alertdialog",
    "aria-modal": "true",
    "aria-labelledby": uid + "-t",
    ...(msg ? { "aria-describedby": uid + "-d" } : {})
  },
    el("div", { class: "np-alert-h" }, el("h2", { id: uid + "-t" }, titulo), btnX),
    corpo,
    el("div", { class: "np-alert-f" }, btnNao, btnSim)
  );
  const bg = el("div", { class: "np-alert-bg" }, dlg);

  let soltarIrmaos = () => {};
  const outroAberto = () => [...host.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some((d) => d !== dlg);
  const fechar = (resultado = false) => {
    if (fechado) return;
    fechado = true;
    doc.removeEventListener("keydown", onKey, true);
    if (bg.isConnected) bg.remove();
    soltarIrmaos();
    if (!outroAberto()) app?.removeAttribute("inert");
    if (origemEl && origemEl.isConnected && typeof origemEl.focus === "function") {
      setTimeout(() => { try { origemEl.focus(); } catch (_) {} }, 0);
    }
    const r = resolver; resolver = null;
    if (r) r(!!resultado);
  };

  const focaveis = () => [...dlg.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);
  const onKey = (e) => {
    if (!dlg.isConnected) return;
    if (e.key === "Escape") { if (enviando) return; e.preventDefault(); e.stopPropagation(); fechar(false); return; }
    if (e.key === "Tab") {
      const fs = focaveis(); if (!fs.length) return;
      const i = fs.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); fs[fs.length - 1].focus(); }
      else if (!e.shiftKey && (i === fs.length - 1 || i === -1)) { e.preventDefault(); fs[0].focus(); }
    }
  };

  const prom = new Promise((resolve) => { resolver = resolve; });

  btnNao.onclick = () => { if (!enviando) fechar(false); };
  btnX.onclick = () => { if (!enviando) fechar(false); };
  bg.addEventListener("mousedown", (e) => { if (e.target === bg && !enviando) fechar(false); });
  btnSim.onclick = async () => {
    if (enviando || fechado) return;
    if (typeof onSim !== "function") { fechar(true); return; }
    erroBox.hidden = true;
    enviando = true;
    btnSim.disabled = true; btnNao.disabled = true; btnX.disabled = true;
    const prevTxt = btnSim.textContent;
    btnSim.textContent = "Aplicando…";
    try {
      await onSim();
      if (!fechado) fechar(true);
    } catch (e) {
      enviando = false;
      btnSim.disabled = false; btnNao.disabled = false; btnX.disabled = false;
      btnSim.textContent = prevTxt;
      erroBox.replaceChildren(el("b", {}, traduzErroBD(e)));
      erroBox.hidden = false;
      try { erroBox.focus(); } catch (_) {}
    }
  };

  doc.addEventListener("keydown", onKey, true);
  host.append(bg);
  soltarIrmaos = prenderIrmaos(host, bg);
  app?.setAttribute("inert", "");
  setTimeout(() => { if (!fechado) (perigo ? btnNao : btnSim).focus(); }, 0);
  prom.fechar = () => fechar(false);
  prom.el = dlg;
  return prom;
};

/* Diálogo acessível de entrada curta de texto (role="dialog") — retorna Promise<string | null> */
const pedirTexto = ({ titulo = "Informar texto", mensagem = "", texto = "", rotulo = "", valorInicial = "", placeholder = "", obrigatorio = false, confirmar: rotConfirmar = "Confirmar", cancelar: rotCancelar = "Cancelar", multiline = false, validar = null, origem } = {}) => {
  const msg = mensagem || texto || "";
  if (!doc.documentElement.classList.contains("np-casca-v3")) {
    const pV2 = Promise.resolve(window.prompt(msg || rotulo || titulo, valorInicial || ""));
    pV2.fechar = () => {};
    pV2.el = null;
    return pV2;
  }

  const host = doc.querySelector("#modalHost") || doc.body;
  const app = doc.querySelector("#app");
  const origemEl = origem || (doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null);
  const uid = "np-pr-" + Math.random().toString(36).slice(2, 8);
  let fechado = false, resolver = null;

  const btnNao = el("button", { type: "button", class: "np-btn" }, rotCancelar);
  const btnSim = el("button", { type: "button", class: "np-btn pri" }, rotConfirmar);
  const btnX = el("button", { type: "button", class: "np-ib", "aria-label": "Fechar" }, svgIco(I.x));
  const inp = multiline
    ? el("textarea", { id: uid + "-i", class: "np-prompt-inp", rows: "4", placeholder: placeholder || "" }, valorInicial || "")
    : el("input", { id: uid + "-i", type: "text", class: "np-prompt-inp", value: valorInicial || "", placeholder: placeholder || "" });
  const errEl = el("p", { id: uid + "-e", class: "np-prompt-err", role: "alert", hidden: true });
  inp.setAttribute("aria-describedby", uid + "-e");
  if (obrigatorio) inp.setAttribute("aria-required", "true");

  const corpo = el("div", { class: "np-alert-b" });
  if (msg) corpo.append(el("p", { id: uid + "-d", class: "np-confirm-txt" }, msg));
  const campo = el("div", { class: "np-prompt-field" });
  if (rotulo) campo.append(el("label", { for: uid + "-i", class: "np-prompt-lbl" }, rotulo, obrigatorio ? el("span", { class: "np-f-req", "aria-hidden": "true" }, " *") : null));
  else inp.setAttribute("aria-label", titulo);
  campo.append(inp, errEl);
  corpo.append(campo);

  const dlg = el("div", {
    class: "np-alert-dlg np-prompt-dlg",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": uid + "-t",
    ...(msg ? { "aria-describedby": uid + "-d" } : {})
  },
    el("div", { class: "np-alert-h" }, el("h2", { id: uid + "-t" }, titulo), btnX),
    corpo,
    el("div", { class: "np-alert-f" }, btnNao, btnSim)
  );
  const bg = el("div", { class: "np-alert-bg" }, dlg);

  let soltarIrmaos = () => {};
  const outroAberto = () => [...host.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some((d) => d !== dlg);
  const fechar = (val) => {
    if (fechado) return;
    fechado = true;
    doc.removeEventListener("keydown", onKey, true);
    if (bg.isConnected) bg.remove();
    soltarIrmaos();
    if (!outroAberto()) app?.removeAttribute("inert");
    if (origemEl && origemEl.isConnected && typeof origemEl.focus === "function") {
      setTimeout(() => { try { origemEl.focus(); } catch (_) {} }, 0);
    }
    const r = resolver; resolver = null;
    if (r) r(val);
  };

  const setErro = (txt) => {
    if (txt) { errEl.textContent = txt; errEl.hidden = false; inp.setAttribute("aria-invalid", "true"); }
    else { errEl.textContent = ""; errEl.hidden = true; inp.removeAttribute("aria-invalid"); }
  };

  const enviar = () => {
    const v = inp.value;
    if (obrigatorio && !v.trim()) { setErro(FORM_MSG.obrigatorio); inp.focus(); return; }
    if (typeof validar === "function") {
      const msgErro = validar(v);
      if (msgErro) { setErro(String(msgErro)); inp.focus(); return; }
    }
    setErro(null);
    fechar(v);
  };

  inp.addEventListener("input", () => { if (inp.getAttribute("aria-invalid") === "true") setErro(null); });

  const focaveis = () => [...dlg.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);
  const onKey = (e) => {
    if (!dlg.isConnected) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(null); return; }
    if (e.key === "Tab") {
      const fs = focaveis(); if (!fs.length) return;
      const i = fs.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); fs[fs.length - 1].focus(); }
      else if (!e.shiftKey && (i === fs.length - 1 || i === -1)) { e.preventDefault(); fs[0].focus(); }
      return;
    }
    if (e.key === "Enter" && doc.activeElement === inp) {
      if (!multiline || e.ctrlKey || e.metaKey) { e.preventDefault(); enviar(); }
    }
  };

  const prom = new Promise((resolve) => { resolver = resolve; });

  btnNao.onclick = () => fechar(null);
  btnX.onclick = () => fechar(null);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) fechar(null); });
  btnSim.onclick = enviar;

  doc.addEventListener("keydown", onKey, true);
  host.append(bg);
  soltarIrmaos = prenderIrmaos(host, bg);
  app?.setAttribute("inert", "");
  setTimeout(() => {
    if (fechado) return;
    inp.focus();
    if (!multiline && valorInicial && typeof inp.select === "function") { try { inp.select(); } catch (_) {} }
  }, 0);
  prom.fechar = () => fechar(null);
  prom.el = dlg;
  return prom;
};

const ativo = () => doc.documentElement.classList.contains("np-casca-v3");
window.NPUI = { fotos: { carregar: carregarFotos, de: fotoDe, doPerfil: fotoDoPerfil, pintar: pintarFoto, aplicar: aplicarFotos }, quadros, barras, fatia, paginas, ativo, form, modalV3, confirmar, pedirTexto, secaoForm, maisCampos, revelarCampo, traduzErroBD, permite, pref, chave, reduz, ms, vt, flip, svgIco, I, quem, curto, iniciais, prazoTxt, marca, chip, seg, resumo, toolbar, sepv, grupo, linha, feito, faixaErro, vazio, carregando, rodape, painel, props, passos, secao, etapa, val, ciclo, tabela, brl, pop, fecharPop, reancorarPop, popAberto: () => !!popAtual, btn, ib, campoAtivo };
})();
