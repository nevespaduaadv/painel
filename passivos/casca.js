/* Casca V3.1 (Design System — Fase 1). Árvore de navegação, trilho, flyout, gaveta e barra de 48 px.
   - Só age quando <html class="np-casca-v3"> (chave localStorage "np-casca" = "v3", lida no boot em fontes/painel.html).
   - Não decide acesso: usa o NAV gerado (mesmos tab/hash/cls), o itemNav() de fontes/painel.html (mesmos cliques,
     mesmas rotas), as classes area-… e …-only já aplicadas ao <body> e PP.temAcesso para as abas dos hubs.
   - A casca V2 (#sb, #nav) continua renderizando por renderNav(); quando V3 está ativa ela fica display:none + inert.
   Carregar por último (depois de hubs.js). */
(() => {
  "use strict";
  const html = document.documentElement, $ = (s, r = document) => r.querySelector(s);
  const ATIVA = () => html.classList.contains("np-casca-v3");
  // /beta/ e o sistema principal dividem a mesma origem (mesmo localStorage): no espelho as chaves da casca levam
  // sufixo -beta, para que testar a V3.1 no beta não mude a navegação, o trilho nem os grupos de ninguém em produção.
  // O tema (pp-tema) continua compartilhado de propósito, como já é hoje.
  const BETA = document.body?.dataset.espelho === "1";
  const K = (n) => n + (BETA ? "-beta" : "");
  const lerChave = () => { try { return localStorage.getItem(K("np-casca")) || "v2"; } catch (_) { return "v2"; } };
  const gravarChave = (v) => { try { localStorage.setItem(K("np-casca"), v); } catch (_) {} };

  /* ---------- bloco "Navegação" em Meu perfil (nas duas cascas) ---------- */
  function cardPerfil() {
    const v = $("#view-perfil"); if (!v || v.hidden) return;
    if (v.querySelector(":scope > .np-pref")) return; // já está lá; render() roda com frequência
    const nova = lerChave() === "v3";
    const card = el("div", { class: "np-pref" },
      el("div", {}, el("h3", {}, "Navegação"), el("p", {}, nova
        ? "Você está usando a nova navegação (V3.1): menu em árvore, trilho recolhível e barra compacta. A preferência vale só neste navegador" + (BETA ? " e só aqui no beta" : "") + " e não muda nenhum acesso."
        : "Experimente a nova navegação (V3.1): menu em árvore, trilho recolhível e barra compacta. A preferência vale só neste navegador" + (BETA ? " e só aqui no beta" : "") + " e não muda nenhum acesso.")),
      el("button", { class: "btn" + (nova ? "" : " primary"), type: "button", onclick: () => { gravarChave(nova ? "v2" : "v3"); location.reload(); } }, nova ? "Voltar à navegação atual" : "Experimentar a nova navegação"));
    v.append(card);
  }
  { const _r = render; render = function () { _r(); try { cardPerfil(); } catch (_) {} }; }

  if (!ATIVA()) return; // casca V2 em uso: nada mais a fazer

  /* ---------- montagem única da casca ---------- */
  const app = $("#app"), side = $("#np-side"), sbV2 = $("#sb"), navV2 = $("#nav"), top = $("header.top"), brand = $("#brandArea");
  if (!app || !side || !top) return;
  app.classList.remove("colapsada"); // estado da V2 não se aplica
  sbV2?.setAttribute("inert", ""); sbV2?.setAttribute("aria-hidden", "true");
  side.hidden = false; side.removeAttribute("inert");
  try { if (localStorage.getItem(K("np-trilho")) === "1") app.classList.add("np-trilho"); } catch (_) {}
  const ico = (d, cls = "np-ico") => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", cls); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = d; return s; };
  const CHEV = '<path d="m6 9 6 6 6-6"/>', LUPA = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
  // Ícones só da casca para destinos que o NAV não cobre (o ICONES global continua valendo para a V2 e para os demais)
  const I_TAB = {
    avisos: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    financeiro: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    faturamento: '<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><path d="M8 9h8M8 13h6"/>',
    estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    inventario: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9zM9 11h6M9 15h4"/>',
    ponto: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 17c0-1.7 1.3-3 3-3s3 1.3 3 3M15 9h4M15 13h3"/>',
    requisicoes: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 4h14l2 9v7H3v-7z"/>',
    espelho: '<path d="M9 3h6M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>',
    "importar-advbox": '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    "config-gestao": '<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h12M20 18h.01"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  const temIcone = (i) => { const k = i.icone || i.tab; return !!(typeof ICONES === "object" && ICONES && ICONES[k]); };
  const I_GRUPO = { juridico: '<path d="M12 3v18M3 7h18M5 7l-3 7a4 4 0 0 0 8 0zM19 7l-3 7a4 4 0 0 0 8 0z"/>', financeiro: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>', equipe: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>', ferramentas: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3L16.7 8.3"/>' };
  const ws = el("div", { class: "np-ws" }, el("div", { class: "np-mono", "aria-hidden": "true" }, "NP"), el("div", { class: "np-rot" }, el("b", {}, "Neves Pádua"), el("small", {}, "Advocacia")));
  const buscaBtn = el("button", { class: "np-busca-btn edit-only", type: "button", onclick: () => { const i = $("#buscaGlobal"); if (i) { fecharGaveta(); i.focus(); } } }, ico(LUPA), el("span", {}, "Buscar"), el("kbd", {}, "/"));
  // Semântica: <nav> com listas de botões (não é tablist — os grupos expansíveis não são abas); o destino atual leva
  // aria-current="page"; grupo = botão com aria-expanded/aria-controls + lista. Mesmo itemNav() da V2, só os atributos mudam.
  const tree = el("nav", { id: "np-tree", "aria-label": "Módulos" });
  const eu = el("div", { class: "np-eu" });
  side.append(ws, el("div", { class: "np-acoes" }, buscaBtn), tree, eu);
  const trilha = el("span", { id: "np-trilha" }); brand?.before(trilha);
  const fly = el("nav", { id: "np-fly", "aria-label": "Itens do grupo" }), dica = el("div", { id: "np-dica", role: "tooltip" });
  document.body.append(fly, dica);
  // véu: fecha gaveta e expansão (o onclick inline do .sb-overlay já remove sb-aberta)
  $(".sb-overlay")?.addEventListener("click", () => app.classList.remove("np-expandida"));
  // #btnSb (único controle): gaveta ≤900, expansão por cima 901–1179, trilho ≥1180
  const btnSb = $("#btnSb");
  if (btnSb) btnSb.onclick = () => {
    if (matchMedia("(max-width:900px)").matches) { app.classList.toggle("sb-aberta"); return; }
    if (matchMedia("(max-width:1179px)").matches) { app.classList.toggle("np-expandida"); return; }
    app.classList.toggle("np-trilho"); fecharFly();
    try { localStorage.setItem(K("np-trilho"), app.classList.contains("np-trilho") ? "1" : "0"); } catch (_) {}
  };
  const fecharGaveta = () => app.classList.remove("sb-aberta", "np-expandida");
  const emTrilho = () => !matchMedia("(max-width:900px)").matches && (app.classList.contains("np-trilho") || (matchMedia("(max-width:1179px)").matches && !app.classList.contains("np-expandida")));
  // .np-rail é o estado visual derivado (o CSS do trilho pende dele); recalculado a cada mudança de classe/largura
  const sincRail = () => { const q = emTrilho(); if (app.classList.contains("np-rail") !== q) app.classList.toggle("np-rail", q); };
  new MutationObserver(sincRail).observe(app, { attributes: true, attributeFilter: ["class"] });
  for (const q of ["(max-width:900px)", "(max-width:1179px)"]) matchMedia(q).addEventListener("change", sincRail);
  sincRail();

  /* ---------- modelo da árvore a partir do NAV real ---------- */
  const FIXOS = ["painel", "tarefas", "agenda", "avisos", "clientes", "acompanhamento"]; // "acompanhamento" (Fase 3) é filho visual de Clientes
  const FILHOS = { acompanhamento: "clientes" };
  const HUBS = (window.PP_HUBS && window.PP_HUBS.HUBS) || {};
  // Falha fechada: a casca nunca libera visualmente um destino por conta própria. Só mostra o que PP.temAcesso
  // (regra da aplicação, definida pelo gerador) responde `true`; ausência ou erro da função esconde o item.
  const acesso = (tab) => { try { return typeof PP.temAcesso === "function" && PP.temAcesso(tab) === true; } catch (_) { return false; } };
  function modelo() {
    const itens = NAV.filter(n => n.tab || n.link), grupos = NAV.filter(n => n.grupo), byTab = t => itens.find(i => i.tab === t);
    const hub = (chave, label, icone) => { const h = HUBS[chave]; const it = itens.find(i => i.tabs && h && i.tabs.some(t => h.tabs.some(([x]) => x === t))); if (!h || !it) return null;
      // abas de hub sem acesso não entram no modelo (não existem na árvore, no flyout nem na árvore de acessibilidade)
      return { id: chave, label, icone, cls: it.cls || "", hubTab: it.tab, itens: h.tabs.filter(([t]) => it.tabs.includes(t) && acesso(t)).map(([t, l]) => ({ tab: t, label: l, cls: "" })) }; };
    const deGrupos = (ids) => grupos.filter(g => ids.includes(g.grupo)).flatMap(g => g.itens.map(i => ({ ...i, cls: ((g.cls || "") + " " + (i.cls || "")).trim() })));
    const gs = [hub("juridico", "Jurídico", "juridico"), hub("financeiro", "Financeiro", "financeiro"),
      { id: "equipe", label: "Equipe e gestão", icone: "equipe", cls: "", itens: deGrupos(["equipe", "gestao"]) },
      { id: "ferramentas", label: "Ferramentas", icone: "ferramentas", cls: "", itens: deGrupos(["juridico-ferr", "comercial", "marketing"]) }].filter(g => g && g.itens.length);
    // itens do NAV que não entraram em fixos, hubs ou grupos conhecidos: grupo "Outros" (nunca se perde destino)
    const cobertos = new Set([...FIXOS, "perfil", ...gs.flatMap(g => g.itens.map(i => i.tab)), ...gs.map(g => g.hubTab).filter(Boolean)]);
    // itens com `tabs` são hubs (filhos já avaliados por acesso); nunca caem em "Outros"
    const soltos = itens.filter(i => i.tab && !i.tabs && !cobertos.has(i.tab)).concat(grupos.filter(g => !["equipe", "gestao", "juridico-ferr", "comercial", "marketing"].includes(g.grupo)).flatMap(g => g.itens.filter(i => !cobertos.has(i.tab))));
    if (soltos.length) gs.push({ id: "outros", label: "Outros", icone: "ferramentas", cls: "", itens: soltos });
    return { fixos: FIXOS.map(byTab).filter(Boolean), perfil: byTab("perfil"), grupos: gs, links: itens.filter(i => i.link) };
  }
  const ativoDe = (i) => (i.tabs ? i.tabs.includes(S.tab) : (S.tab === i.tab || (i.alt || []).includes(S.tab))) && (!i.sel || i.sel());
  let abertos = {}; try { abertos = JSON.parse(localStorage.getItem(K("np-grupos")) || "{}"); } catch (_) {}
  const visivel = (e) => e && getComputedStyle(e).display !== "none";
  // troca a semântica de aba (role=tab/aria-selected, herdada do itemNav da V2) pela de navegação (aria-current)
  const semantica = (b, atual) => { b.removeAttribute("role"); b.removeAttribute("aria-selected"); if (atual) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); return b; };

  /* ---------- render da árvore (chamado por renderNav) ---------- */
  function montar() {
    const m = modelo(); const ativo = (i) => ativoDe(i);
    const item = (i, extra) => { const b = itemNav(i, ativo(i)); semantica(b, ativo(i)); if (!temIcone(i) && I_TAB[i.tab]) b.querySelector("svg")?.replaceWith(ico(I_TAB[i.tab])); if (extra) b.classList.add(extra); return b; };
    const lista = (botoes) => el("ul", { class: "np-lista" }, botoes.map(b => el("li", {}, b)));
    tree.replaceChildren(lista(m.fixos.map(i => { const b = item(i, "np-top"); if (FILHOS[i.tab]) b.classList.add("np-filho"); return b; })), el("div", { class: "np-sec" }));
    for (const g of m.grupos) {
      const temAtivo = g.itens.some(ativo) || (g.hubTab && ativo({ tab: g.hubTab, tabs: g.itens.map(i => i.tab) }));
      const aberto = abertos[g.id] !== undefined ? !!abertos[g.id] : (g.id === "juridico" || temAtivo);
      const head = el("button", { class: "np-gh", type: "button", "aria-expanded": String(aberto || temAtivo), "aria-controls": "np-g-" + g.id, "data-g": g.id, onclick: (e) => aoClicarGrupo(e, g) }, ico(CHEV, "np-ico np-chev"), ico(I_GRUPO[g.icone] || I_GRUPO.ferramentas), el("span", {}, g.label));
      const corpo = el("div", { class: "np-corpo", id: "np-g-" + g.id }, lista(g.itens.map(i => item(i))));
      // estado aberto/fechado fica em data-aberto (CSS); aria-expanded só no botão, onde é válido
      const grp = el("div", { class: "np-g " + (g.cls || "") + (temAtivo ? " np-ativo" : ""), "data-aberto": (aberto || temAtivo) ? "1" : "0", "data-g": g.id }, head, corpo);
      if (!(aberto || temAtivo)) corpo.setAttribute("inert", "");
      tree.append(grp);
    }
    // rodapé: pessoa + Meu perfil + links externos
    const nome = ($("#userName")?.textContent || "").trim();
    const ini = nome ? nome.split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase() : "NP";
    const perfilBtn = m.perfil ? item(m.perfil) : null;
    if (perfilBtn) { perfilBtn.classList.remove("np-top"); perfilBtn.replaceChildren(el("i", { "aria-hidden": "true" }, ini), el("div", { class: "np-rot" }, el("b", {}, nome || "Meu perfil"), el("small", {}, "Meu perfil"))); perfilBtn.title = "Meu perfil"; }
    eu.replaceChildren(el("div", { style: "flex:1;min-width:0" }, m.links.length ? el("div", { class: "np-links edit-only" }, m.links.map(l => el("a", { href: l.link }, l.label))) : "", perfilBtn || ""));
    // grupos sem nenhum item visível para este perfil somem (mesmas regras CSS de permissão da V2)
    requestAnimationFrame(() => { for (const grp of tree.querySelectorAll(".np-g")) { const algum = [...grp.querySelectorAll(".tab")].some(visivel); grp.dataset.vazio = algum ? "0" : "1"; } });
    // trilha e título da barra
    const gAtivo = m.grupos.find(g => g.itens.some(ativo) || (g.hubTab && ativoDe({ tab: g.hubTab, tabs: g.itens.map(i => i.tab) })));
    trilha.textContent = gAtivo ? gAtivo.label : ""; trilha.hidden = !gAtivo;
    if (brand) { const i = m.fixos.concat(m.grupos.flatMap(g => g.itens)).find(ativo); if (i && !readOnly()) brand.textContent = i.label; }
    if (flyG) atualizarFly();
  }
  function aoClicarGrupo(e, g) {
    const grp = e.currentTarget.parentElement;
    if (emTrilho()) { if (flyG === g.id) fecharFly(true); else abrirFly(e.currentTarget, g); return; }
    const aberto = grp.dataset.aberto !== "1"; abertos[g.id] = aberto;
    grp.dataset.aberto = aberto ? "1" : "0"; e.currentTarget.setAttribute("aria-expanded", String(aberto));
    grp.querySelector(".np-corpo").toggleAttribute("inert", !aberto);
    try { localStorage.setItem(K("np-grupos"), JSON.stringify(abertos)); } catch (_) {}
  }
  { const _rn = renderNav; renderNav = function () { _rn(); try { montar(); } catch (err) { console.error("casca v3:", err); } }; }

  /* ---------- flyout (trilho) ---------- */
  let flyG = null, flyBtn = null;
  function abrirFly(btn, g) { mostrarDica(null); flyG = g.id; flyBtn = btn; tree.querySelectorAll(".np-g").forEach(x => x.classList.toggle("np-fly-on", x.dataset.g === g.id)); atualizarFly(g); const r = btn.getBoundingClientRect(); fly.style.top = Math.max(8, Math.min(innerHeight - fly.offsetHeight - 12, r.top)) + "px"; fly.classList.add("on"); setTimeout(() => (fly.querySelector('.tab[aria-current="page"]') || fly.querySelector(".tab"))?.focus(), 60); }
  function atualizarFly(g) { g = g || modelo().grupos.find(x => x.id === flyG); if (!g) return fecharFly(false);
    fly.replaceChildren(el("div", { class: "np-orig" }, ico(I_GRUPO[g.icone] || I_GRUPO.ferramentas), el("span", {}, g.label), el("span", { class: "np-k" }, "Esc fecha")), ...g.itens.map(i => { const b = semantica(itemNav(i, ativoDe(i)), ativoDe(i)); if (!temIcone(i) && I_TAB[i.tab]) b.querySelector("svg")?.replaceWith(ico(I_TAB[i.tab])); b.addEventListener("click", () => fecharFly(false)); return b; })); }
  function fecharFly(foco) { if (!flyG) return; fly.classList.remove("on"); flyG = null; tree.querySelectorAll(".np-fly-on").forEach(x => x.classList.remove("np-fly-on")); if (foco && flyBtn && flyBtn.isConnected) flyBtn.focus(); flyBtn = null; }
  fly.addEventListener("keydown", e => { const as = [...fly.querySelectorAll(".tab:not([hidden])")]; const i = as.indexOf(document.activeElement); if (e.key === "ArrowDown") { e.preventDefault(); as[(i + 1) % as.length]?.focus(); } if (e.key === "ArrowUp") { e.preventDefault(); as[(i - 1 + as.length) % as.length]?.focus(); } });
  fly.addEventListener("focusout", e => { if (e.relatedTarget && (fly.contains(e.relatedTarget) || e.relatedTarget.closest?.(".np-gh"))) return; setTimeout(() => { if (!fly.contains(document.activeElement)) fecharFly(false); }, 0); });
  document.addEventListener("click", e => { if (!fly.contains(e.target) && !e.target.closest(".np-gh")) fecharFly(false); });
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (flyG) { fecharFly(true); return; } if (app.classList.contains("sb-aberta") || app.classList.contains("np-expandida")) { fecharGaveta(); btnSb?.focus(); } });
  addEventListener("resize", () => fecharFly(false));

  /* ---------- dica de texto no trilho ---------- */
  function mostrarDica(elm) { if (!elm) { dica.classList.remove("on"); return; } const t = elm.querySelector("span")?.textContent || elm.title || ""; if (!t) return; const r = elm.getBoundingClientRect(); dica.textContent = t; dica.style.left = (r.right + 10) + "px"; dica.style.top = (r.top + r.height / 2 - 14) + "px"; dica.classList.add("on"); }
  side.addEventListener("mouseover", e => { if (!emTrilho() || flyG) return; const elm = e.target.closest("#np-tree .tab, #np-tree .np-gh, .np-busca-btn, .np-eu .tab"); if (elm) mostrarDica(elm); });
  side.addEventListener("mouseout", () => mostrarDica(null));
  // navegar fecha a gaveta/expansão (itemNav já chama fecharSb() para sb-aberta)
  tree.addEventListener("click", e => { if (e.target.closest(".tab")) app.classList.remove("np-expandida"); });

  window.PP_CASCA = { versao: "v3.1", modelo, emTrilho, fecharFly };
  try { renderNav(); } catch (_) {} // o módulo carrega depois do primeiro render
})();

/* Fase 4B · B5 — busca global integrada: grupos "Negociações" e "Acompanhamento PJ", SÓ com a casca V3.1 ligada e SÓ para quem tem permissão
   (NPUI.permite(aba) === true, falha-fechado). Consome apenas as listas que os módulos já carregaram (PP_NEG.lista / PP_ACOMP.registros);
   distingue "ainda não carregado" (botão explícito para carregar pelo mecanismo do próprio módulo), "nenhum resultado" e "indisponível";
   nada muda de rota enquanto se digita — só o clique/Enter em um resultado abre (PP_NEG.abrir / PP_ACOMP.abrir). A busca V2 do núcleo fica intacta:
   este bloco só acrescenta grupos ao mesmo listbox (ou cria o seu quando o núcleo não encontrou nada). */
(() => {
  const inp = document.querySelector("#buscaGlobal"), box = document.querySelector("#busca"); if (!inp || !box) return;
  const html = document.documentElement; const ativa = () => html.classList.contains("np-casca-v3") && !!window.NPUI;
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const permite = tab => { try { return window.NPUI?.permite?.(tab) === true; } catch (_) { return false; } };
  let meu = null, est = null, espera = null;
  const limpar = () => { if (meu) { meu.remove(); meu = null; } if (est) { est.remove(); est = null; } box.querySelectorAll(".res.np-busca-res").forEach(r => r.remove()); clearTimeout(espera); espera = null; };
  const ir = fn => { limpar(); const r = box.querySelector(".res"); if (r) r.remove(); inp.value = ""; inp.blur(); fn(); };
  const FASE = { onboarding: "Onboarding", ciclo: "Ciclo inicial", mensal: "Mensal", encerrado: "Encerrado" };
  const op = (titulo, sub, onclick) => el("button", { role: "option", type: "button", onclick }, titulo, el("small", {}, sub));
  const extra = () => {
    limpar(); if (!ativa()) return;
    const q = norm(inp.value.trim()); if (q.length < 2) return; const qd = q.replace(/\D/g, "");
    const grupos = [], estados = []; let acionavel = false; // acionavel: há lista ainda não carregada (botão "carregar para buscar") — vale abrir a caixa mesmo sem resultado
    if (permite("negociacoes")) {
      const NG = window.PP_NEG; const e = NG?.estado ? NG.estado() : null;
      if (!NG || !e) estados.push(el("span", {}, "Negociações: indisponíveis"));
      else if (e.erro) estados.push(el("span", {}, "Negociações: indisponíveis"));
      else if (!e.carregado) { const b = el("button", { type: "button", class: "np-busca-carregar", onclick: ev => { ev.stopPropagation(); if (e.carregando || !NG.carregar()) return; b.disabled = true; b.textContent = "carregando…"; const t0 = Date.now(); const aguardar = () => { const x = NG.estado(); if (x.carregado || x.erro || Date.now() - t0 > 15000) { if (document.activeElement === inp || inp.value) extra(); return; } espera = setTimeout(aguardar, 250); }; aguardar(); } }, e.carregando ? "carregando…" : "carregar para buscar"); if (e.carregando) b.disabled = true; estados.push(el("span", {}, "Negociações: ainda não carregadas · ", b)); acionavel = true; }
      else { const ls = NG.lista().filter(n => norm(n.titulo).includes(q) || norm(n.banco).includes(q) || norm(n.cliente_nome).includes(q) || (qd.length >= 4 && String(n.numero_processo || "").replace(/\D/g, "").includes(qd))).slice(0, 6);
        if (ls.length) grupos.push(["Negociações", ls.map(n => op(n.titulo || [n.cliente_nome, n.banco].filter(Boolean).join(" | "), [n.cliente_nome, n.banco, NG.etapas ? (Object.fromEntries(NG.etapas)[n.etapa] || n.etapa) : n.etapa, n.responsavel_nome].filter(Boolean).join(" · "), () => ir(() => NG.abrir(n.id))))]);
        else estados.push(el("span", {}, "Negociações: nenhum resultado")); }
    }
    if (permite("acompanhamento")) {
      const AC = window.PP_ACOMP; const e = AC?.estado ? AC.estado() : null;
      if (!AC || !e) estados.push(el("span", {}, "Acompanhamento PJ: indisponível"));
      else if (e.erro) estados.push(el("span", {}, "Acompanhamento PJ: indisponível"));
      else if (!e.carregado) { const b = el("button", { type: "button", class: "np-busca-carregar", onclick: ev => { ev.stopPropagation(); if (e.carregando || !AC.carregarLista()) return; b.disabled = true; b.textContent = "carregando…"; const t0 = Date.now(); const aguardar = () => { const x = AC.estado(); if (x.carregado || x.erro || Date.now() - t0 > 15000) { if (document.activeElement === inp || inp.value) extra(); return; } espera = setTimeout(aguardar, 250); }; aguardar(); } }, e.carregando ? "carregando…" : "carregar para buscar"); if (e.carregando) b.disabled = true; estados.push(el("span", {}, "Acompanhamento PJ: ainda não carregado · ", b)); acionavel = true; }
      else { const rs = AC.registros().filter(r => r.iniciado && (norm(r.c.nome).includes(q) || norm(r.c.cnpj).includes(q) || norm(r.c.nome_fantasia).includes(q) || norm(FASE[r.a?.fase]).includes(q) || (r.prox && norm(r.prox.rotulo) === q))).slice(0, 6);
        if (rs.length) grupos.push(["Acompanhamento PJ", rs.map(r => { const p = r.prox ? NPUI.prazoTxt(r.prox.data) : null; return op(r.c.nome, [FASE[r.a?.fase] || r.a?.fase, p ? r.prox.rotulo + " prevista " + p.rel : "sem data prevista", r.resp?.nome ? NPUI.curto(r.resp.nome) : null].filter(Boolean).join(" · "), () => ir(() => AC.abrir(r.c.id))); })]);
        else estados.push(el("span", {}, "Acompanhamento PJ: nenhum resultado")); }
    }
    if (!grupos.length && !estados.length) return;
    let res = box.querySelector(".res"); let proprio = false;
    if (!res) { if (!grupos.length && !acionavel) return; /* sem resultado em lugar nenhum e nada a carregar: não abre caixa só para dizer "nenhum resultado" */ res = el("div", { class: "res np-busca-res", role: "listbox" }); box.append(res); proprio = true; }
    meu = el("div", { class: "np-busca-extra" }); for (const [t, items] of grupos) { meu.append(el("div", { class: "grp-h" }, t)); items.forEach(i => meu.append(i)); } res.append(meu);
    if (estados.length) { est = el("div", { class: "np-busca-est" }); estados.forEach((s, i) => { if (i) est.append(" · "); est.append(s); }); res.append(est); }
    if (proprio) meu.dataset.proprio = "1";
  };
  inp.addEventListener("input", extra); inp.addEventListener("focus", extra);
  // teclado quando a caixa é só nossa (o núcleo não encontrou nada): ↑/↓ entre as opções, Enter abre, Esc fecha
  inp.addEventListener("keydown", e => { if (!meu || !meu.dataset.proprio) { if (e.key === "Escape") limpar(); return; } const ops = [...meu.querySelectorAll("[role=option]")]; let idx = ops.findIndex(o => o.getAttribute("aria-selected") === "true");
    if (e.key === "Escape") { limpar(); const r = box.querySelector(".res"); if (r) r.remove(); }
    else if (e.key === "ArrowDown" && ops.length) { e.preventDefault(); idx = (idx + 1) % ops.length; ops.forEach((o, i) => o.setAttribute("aria-selected", String(i === idx))); }
    else if (e.key === "ArrowUp" && ops.length) { e.preventDefault(); idx = (idx - 1 + ops.length) % ops.length; ops.forEach((o, i) => o.setAttribute("aria-selected", String(i === idx))); }
    else if (e.key === "Enter" && ops.length) { e.preventDefault(); (ops[idx] || ops[0]).click(); } });
  document.addEventListener("click", e => { if (!box.contains(e.target)) limpar(); });
  document.head.append(el("style", {}, `.busca .res .np-busca-est{padding:6px 12px 8px;font-size:11.5px;color:var(--faint);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:2px 4px}.busca .res .np-busca-est .np-busca-carregar{display:inline;width:auto;padding:0 2px;font:inherit;color:var(--info);text-decoration:underline;background:transparent;border:0;cursor:pointer}.busca .res .np-busca-est .np-busca-carregar[disabled]{color:var(--faint);text-decoration:none;cursor:default}`));
})();
