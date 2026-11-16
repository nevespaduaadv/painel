/* V4 — Ficha do cliente na V3.1 (Design System, entrega V4). Só age com a casca V3.1 ligada (html.np-casca-v3) e NPUI;
   com a V2 nada muda. Escopo VISUAL: cabeçalho (nome, contexto, valor em serifa e marcas no lugar de pílulas), abas numa linha
   (rolam no celular, ←/→ entre abas), uma única ação primária em tinta (a do cabeçalho), seções em folha com fio, tabelas e
   indicadores no padrão do DESIGN.md. Decora o DOM que renderMain e os módulos da ficha já geraram: mesmos dados, rotas,
   handlers e permissões; não lê nem grava nada no banco. O Dossiê V3.1 (régua nas frentes, passos na linha do tempo) está
   em dossie.js. Estilos: fontes/np-ui.css, bloco "V4 · Ficha". */
(() => {
  "use strict";
  const ligado = () => document.documentElement.classList.contains("np-casca-v3") && !!window.NPUI;
  const $ = (s, r = document) => r.querySelector(s);
  const docTxt = (c) => { const d = String(c.cnpj || "").replace(/\D/g, ""); if (!d) return null; const f = typeof fmtDoc === "function" ? fmtDoc(c.cnpj) : c.cnpj; return (c.tipo_pessoa === "PF" || d.length === 11 ? "CPF " : "CNPJ ") + f; };
  const cidadeTxt = (c) => c.cidade ? c.cidade + (c.uf && !/\/\w\w$/.test(c.cidade) ? "/" + c.uf : "") : null;

  function cabecalho(c, head) {
    head.dataset.v3 = "1"; head.classList.add("np-ficha-cab");
    const id = head.firstElementChild; if (!id || id.classList.contains("actions")) return;
    const resp = c.responsavel || c.dados?.responsavel || null;
    const ctx = [docTxt(c), cidadeTxt(c), c.segmento, resp ? "Responsável: " + resp : null].filter(Boolean);
    // valor e marcas: as MESMAS contas da Carteira V3.1 (PP_CARTEIRA_V3), que repetem as da V2
    const reg = window.PP_CARTEIRA_V3?.registro?.(c.id) || null;
    const marcas = reg && window.PP_CARTEIRA_V3?.marcas ? window.PP_CARTEIRA_V3.marcas(reg) : [];
    const valor = reg ? (reg.ks.length
      ? el("span", { class: "np-ficha-val", title: "saldo em contratos ativos" }, el("b", {}, NPUI.brl(reg.total)), ` em ${reg.ks.length} contrato${reg.ks.length === 1 ? "" : "s"} ativo${reg.ks.length === 1 ? "" : "s"}`)
      : el("span", { class: "np-ficha-val vazio" }, "sem contratos ativos")) : null;
    id.classList.add("np-ficha-id");
    id.replaceChildren(el("h1", { class: "np-ficha-nome" }, c.nome || "(sem nome)"),
      ctx.length ? el("p", { class: "np-ficha-ctx" }, ctx.join(" · ")) : null,
      valor || marcas.length ? el("div", { class: "np-ficha-marcas" }, valor, ...marcas) : null);
    const acts = head.querySelector(":scope > .actions");
    if (acts) { acts.classList.add("np-ficha-acoes"); acts.querySelectorAll(".btn").forEach((b) => b.classList.add("np-ficha-b")); }
  }

  function abas(tabs) {
    tabs.dataset.v3 = "1"; tabs.classList.add("np-ficha-abas"); tabs.setAttribute("aria-label", "Pastas do cliente");
    const bts = [...tabs.querySelectorAll(":scope > .subtab")];
    bts.forEach((b) => { const sel = b.getAttribute("aria-selected") === "true"; b.tabIndex = sel ? 0 : -1; });
    if (!bts.some((b) => b.tabIndex === 0) && bts[0]) bts[0].tabIndex = 0;
    tabs.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      const i = bts.indexOf(document.activeElement); if (i < 0) return; e.preventDefault();
      const j = e.key === "Home" ? 0 : e.key === "End" ? bts.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + bts.length) % bts.length;
      bts[i].tabIndex = -1; bts[j].tabIndex = 0; bts[j].focus(); bts[j].scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    const marcar = () => { const fim = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 2, ini = tabs.scrollLeft <= 2; tabs.dataset.rola = tabs.scrollWidth <= tabs.clientWidth + 2 ? "" : ini ? "ini" : fim ? "fim" : "meio"; };
    tabs.addEventListener("scroll", marcar, { passive: true });
    requestAnimationFrame(() => { const a = tabs.querySelector('[aria-selected="true"]'); if (a && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = Math.max(0, a.offsetLeft - 24); marcar(); });
  }

  function decorar() {
    const m = $("#main"); if (!m) return;
    const ficha = ligado() && S.tab === "clientes" && !!S.sel && !!m.querySelector(":scope > .subtabs");
    m.classList.toggle("np-ficha", ficha); if (!ficha) return;
    const c = (S.clientes || []).find((x) => x.id === S.sel); if (!c) return;
    const head = m.querySelector(":scope > .head"); if (head && !head.dataset.v3) cabecalho(c, head);
    const tabs = m.querySelector(":scope > .subtabs"); if (tabs && !tabs.dataset.v3) abas(tabs);
    // sub-navegação de Passivos (Visão geral · Contratos · Reserva): o selecionado é o .primary — vira estado pressionado
    m.querySelectorAll(":scope > .actions .btn").forEach((b) => b.setAttribute("aria-pressed", String(b.classList.contains("primary"))));
  }

  { const _r = render; render = function () { _r.apply(this, arguments); try { decorar(); } catch (e) { console.warn("ficha-v3", e); } }; }
  window.PP_FICHA_V3 = { ativo: ligado, decorar };
})();
