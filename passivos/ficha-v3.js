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
  const STATUS_MAP = { ativo: ["Ativo", "ok"], onboarding: ["Em onboarding", "att"], prospect: ["Prospect", "info"], encerrado: ["Encerrado", "muted"] };
  const docFmt = (c) => { const d = String(c.cnpj || "").replace(/\D/g, ""); if (!d) return null; const f = typeof fmtDoc === "function" ? fmtDoc(c.cnpj) : c.cnpj; const tipo = c.tipo_pessoa === "PF" || d.length === 11 ? "CPF" : "CNPJ"; return { tipo, valor: f, texto: `${tipo} ${f}` }; };
  const copiarDoc = (valor, tipo, btn) => {
    const ok = () => {
      btn.dataset.copiado = "1";
      const orig = btn.dataset.orig || btn.textContent;
      btn.dataset.orig = orig;
      btn.textContent = "Copiado";
      if (typeof toast === "function") toast(`${tipo} copiado`);
      clearTimeout(btn._tCopy);
      btn._tCopy = setTimeout(() => { delete btn.dataset.copiado; btn.textContent = orig; }, 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(valor).then(ok).catch(() => {
        try { const ta = el("textarea", { style: "position:fixed;opacity:0" }, valor); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); ok(); } catch (_) {}
      });
    } else {
      try { const ta = el("textarea", { style: "position:fixed;opacity:0" }, valor); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); ok(); } catch (_) {}
    }
  };
  const abrirGrupoPop = (c, grupo, btn) => {
    const norm = (s) => String(s || "").trim().toLowerCase();
    const gNorm = norm(grupo);
    const membros = (S.clientes || []).filter((x) => norm(x.grupo || x.dados?.grupo) === gNorm).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    const itens = [
      el("div", { class: "np-fc-pop-t" }, `Grupo econômico · ${grupo} (${membros.length})`),
      ...membros.map((m) => ({
        label: m.nome || "(sem nome)",
        atual: m.id === c.id,
        title: m.id === c.id ? "Cliente atual" : `Abrir ficha de ${m.nome || "cliente"}`,
        onclick: () => { if (m.id !== c.id) { S.sel = m.id; render(); } }
      }))
    ];
    NPUI.pop(btn, itens, { role: "menu", label: `Empresas do grupo ${grupo}` });
  };

  // usada no cabeçalho; tinha sido retirada na 2ª rodada do AI Studio e o cabeçalho novo deixava de aparecer (erro "cidadeTxt is not defined")
  const cidadeTxt = (c) => c.cidade ? c.cidade + (c.uf && !/\/\w\w$/.test(c.cidade) ? "/" + c.uf : "") : null;
  function cabecalho(c, head) {
    head.dataset.v3 = "1"; head.classList.add("np-ficha-cab");
    const id = head.firstElementChild; if (!id || id.classList.contains("actions")) return;
    const resp = c.responsavel || c.dados?.responsavel || null;
    const docInfo = docFmt(c);
    const grupo = String(c.grupo || c.dados?.grupo || "").trim();
    const stInfo = STATUS_MAP[c.status || "ativo"] || [c.status || "Ativo", "muted"];
    const metaExtras = [cidadeTxt(c), c.segmento, resp ? "Responsável: " + resp : null].filter(Boolean);

    const idItens = [];
    if (docInfo) {
      const btnCopy = el("button", {
        type: "button",
        class: "np-fc-copy-btn",
        title: `Copiar ${docInfo.tipo}`,
        "aria-label": `Copiar ${docInfo.tipo} ${docInfo.valor}`,
        onclick: (e) => { e.stopPropagation(); copiarDoc(docInfo.valor, docInfo.tipo, btnCopy); }
      }, "Copiar");
      idItens.push(el("span", { class: "np-fc-doc-wrap" }, el("span", {}, docInfo.texto), btnCopy));
    }
    if (grupo) {
      const norm = (s) => String(s || "").trim().toLowerCase();
      const qtdGrupo = (S.clientes || []).filter((x) => norm(x.grupo || x.dados?.grupo) === norm(grupo)).length;
      const btnGrupo = el("button", {
        type: "button",
        class: "np-fc-grupo-btn",
        title: "Ver empresas do grupo econômico",
        onclick: (e) => { e.stopPropagation(); abrirGrupoPop(c, grupo, btnGrupo); }
      }, `Grupo: ${grupo}` + (qtdGrupo > 1 ? ` (${qtdGrupo})` : ""));
      idItens.push(btnGrupo);
    }
    if (c.pasta_drive_url) {
      idItens.push(el("a", {
        class: "np-fc-drive-link",
        href: c.pasta_drive_url,
        target: "_blank",
        rel: "noopener",
        title: "Abrir pasta do cliente no Google Drive"
      }, "Pasta no Drive ↗"));
    }
    if (metaExtras.length) {
      if (idItens.length) idItens.push(el("span", { class: "np-fc-id-sep", "aria-hidden": "true" }, "·"));
      idItens.push(el("span", {}, metaExtras.join(" · ")));
    }

    // valor e marcas: as MESMAS contas da Carteira V3.1 (PP_CARTEIRA_V3), que repetem as da V2
    const reg = window.PP_CARTEIRA_V3?.registro?.(c.id) || null;
    const marcas = reg && window.PP_CARTEIRA_V3?.marcas ? window.PP_CARTEIRA_V3.marcas(reg) : [];
    const valor = reg ? (reg.ks.length
      ? el("span", { class: "np-ficha-val", title: "saldo em contratos ativos" }, el("b", {}, NPUI.brl(reg.total)), ` em ${reg.ks.length} contrato${reg.ks.length === 1 ? "" : "s"} ativo${reg.ks.length === 1 ? "" : "s"}`)
      : el("span", { class: "np-ficha-val vazio" }, "sem contratos ativos")) : null;
    id.classList.add("np-ficha-id");
    id.replaceChildren(
      el("div", { class: "np-fc-head-top" }, el("h1", { class: "np-ficha-nome" }, c.nome || "(sem nome)"), NPUI.marca(stInfo[0], stInfo[1])),
      idItens.length ? el("div", { class: "np-fc-id-row" }, ...idItens) : null,
      valor || marcas.length ? el("div", { class: "np-ficha-marcas" }, valor, ...marcas) : null
    );
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
