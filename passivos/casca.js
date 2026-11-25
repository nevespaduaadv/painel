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
  const PADRAO = BETA ? "v2" : "v3";
  const lerChave = () => { try { return localStorage.getItem(K("np-casca")) || PADRAO; } catch (_) { return PADRAO; } }; // visual novo é o padrão (decisão das sócias, 24/11); "v2" só para quem escolher no perfil
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
    "financeiro-controle": '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
    "fin-visao": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    "fin-regua": '<path d="M4 6h16M4 12h12M4 18h8"/><circle cx="19" cy="12" r="2"/>',
    "fin-retornos": '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    "fin-recuperacao": '<path d="M4 17l6-6 4 4 6-7"/><path d="M16 8h4v4"/>',
    faturamento: '<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><path d="M8 9h8M8 13h6"/>',
    estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    inventario: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9zM9 11h6M9 15h4"/>',
    ponto: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 17c0-1.7 1.3-3 3-3s3 1.3 3 3M15 9h4M15 13h3"/>',
    requisicoes: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 4h14l2 9v7H3v-7z"/>',
    espelho: '<path d="M9 3h6M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>',
    "importar-advbox": '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    "config-gestao": '<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h12M20 18h.01"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    leads: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',
    comercial: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    atendimento: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    automacoes: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    feriados: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15h6"/>',
    regras: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>',
    calibracao: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M17 11h6"/>',
    perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  const ROTAS_META = {
    "financeiro-controle": { grupo: "Financeiro", grupoId: "financeiro", label: "Cobranças", tabAcesso: "financeiro", cls: "area-financeiro" },
    "fin-visao": { grupo: "Financeiro", grupoId: "financeiro", label: "Visão geral", tabAcesso: "financeiro", cls: "area-financeiro" },
    "fin-regua": { grupo: "Financeiro", grupoId: "financeiro", label: "Régua de cobrança", tabAcesso: "financeiro", cls: "area-financeiro" },
    "fin-retornos": { grupo: "Financeiro", grupoId: "financeiro", label: "Cobranças e retornos", tabAcesso: "financeiro", cls: "area-financeiro" },
    "fin-recuperacao": { grupo: "Financeiro", grupoId: "financeiro", label: "Recuperação", tabAcesso: "financeiro", cls: "area-financeiro" },
    estoque: { grupo: "Administrativo", grupoId: "administrativo", label: "Estoque", tabAcesso: "estoque", cls: "area-financeiro" },
    inventario: { grupo: "Administrativo", grupoId: "administrativo", label: "Inventário", tabAcesso: "inventario", cls: "area-financeiro" },
    // Decisão 06/11 (sócias): Leads, Comercial, Atendimento e Automações saem da árvore V3.1 (CRM separado);
    // permanecem em ROTAS_META apenas como fallback silencioso de breadcrumb/título na transição em paralelo com o GCV.
    leads: { grupo: "Comercial", grupoId: null, label: "Leads", tabAcesso: "leads", cls: "area-comercial" },
    comercial: { grupo: "Comercial", grupoId: null, label: "Comercial", tabAcesso: "comercial", cls: "area-comercial" },
    atendimento: { grupo: "Atendimento", grupoId: null, label: "Atendimento", tabAcesso: "atendimento", cls: "area-atendimento" },
    automacoes: { grupo: "Comercial", grupoId: null, label: "Automações", tabAcesso: "automacoes", cls: "area-comercial" },
    feriados: { grupo: "Ferramentas", grupoId: null, label: "Feriados", tabAcesso: "feriados", cls: "" },
    // 25/11 (sócia): Base de acordos, Regras de projeção e Calibração saem do Jurídico e ficam com a gestão
    historico: { grupo: "Equipe e gestão", grupoId: "equipe", label: "Base de acordos", tabAcesso: "historico", cls: "admin-only" },
    regras: { grupo: "Equipe e gestão", grupoId: "equipe", label: "Regras de projeção", tabAcesso: "regras", cls: "admin-only" },
    calibracao: { grupo: "Equipe e gestão", grupoId: "equipe", label: "Calibração", tabAcesso: "calibracao", cls: "admin-only" },
    usuarios: { grupo: "Equipe e gestão", grupoId: "equipe", label: "Usuários e acessos", tabAcesso: "usuarios", cls: "admin-only" },
    perfil: { grupo: "", grupoId: null, label: "Meu perfil", tabAcesso: "perfil", cls: "" },
  };
  const temIcone = (i) => { const k = i.icone || i.tab; return !!(typeof ICONES === "object" && ICONES && ICONES[k]); };
  const I_GRUPO = { clientes: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', juridico: '<path d="M12 3v18M3 7h18M5 7l-3 7a4 4 0 0 0 8 0zM19 7l-3 7a4 4 0 0 0 8 0z"/>', financeiro: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>', equipe: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>', ferramentas: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3L16.7 8.3"/>', administrativo: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>' };
  const ws = el("div", { class: "np-ws" }, el("div", { class: "np-mono", "aria-hidden": "true" }, "NP"), el("div", { class: "np-rot" }, el("b", {}, "Neves Pádua"), el("small", {}, "Advocacia")));
  const buscaBtn = el("button", { class: "np-busca-btn edit-only", type: "button", onclick: () => { const i = $("#buscaGlobal"); if (i) { fecharGaveta(); i.focus(); } } }, ico(LUPA), el("span", {}, "Buscar"), el("kbd", {}, "/"));
  // Semântica: <nav> com listas de botões (não é tablist — os grupos expansíveis não são abas); o destino atual leva
  // aria-current="page"; grupo = botão com aria-expanded/aria-controls + lista. Mesmo itemNav() da V2, só os atributos mudam.
  const tree = el("nav", { id: "np-tree", "aria-label": "Módulos" });
  const eu = el("div", { class: "np-eu" });
  // V2 (15/11) + Onda 1: ação primária do módulo em tinta na lateral (≥ 901 px); quando o módulo não registra CTA,
  // mantém o slot constante com o botão discreto "+ Novo ▾" (filtrado por PP.temAcesso) evitando salto vertical da árvore.
  const acaoSlot = el("div", { id: "np-acao" });
  side.append(ws, el("div", { class: "np-acoes" }, buscaBtn, acaoSlot), tree, eu);
  const trilha = el("span", { id: "np-trilha" }); brand?.before(trilha);
  const vistaSlot = el("div", { id: "np-barra-vista", role: "group", "aria-label": "Vista" }); $("#btnTema")?.before(vistaSlot);
  const tabAtual = () => { try { return S.tab; } catch (_) { return null; } };
  const somenteLeitura = () => { try { return typeof readOnly === "function" && readOnly(); } catch (_) { return false; } };
  function acoesNovoRapido() {
    if (somenteLeitura()) return [];
    const ops = [];
    if (acesso("tarefas") && window.PP_TAREFAS?.nova) ops.push({ label: "Nova tarefa", onclick: () => window.PP_TAREFAS.nova({}) });
    if (acesso("agenda") && window.PP_AGENDA?.novo) ops.push({ label: "Novo compromisso", onclick: () => window.PP_AGENDA.novo() });
    if (acesso("clientes") && typeof openClientForm === "function") ops.push({ label: "Novo cliente", onclick: () => openClientForm({}) });
    if (acesso("negociacoes") && window.PP_NEG?.nova) ops.push({ label: "Nova negociação", onclick: () => window.PP_NEG.nova({}) });
    if (acesso("avisos") && PP?.perfil?.papel === "admin" && typeof irPara === "function") ops.push({ label: "Novo aviso", onclick: () => irPara("avisos") });
    return ops;
  }
  function preencherAcaoPadrao() {
    if (matchMedia("(max-width:900px)").matches) { acaoSlot.replaceChildren(); return; }
    const ops = acoesNovoRapido();
    if (!ops.length) { acaoSlot.replaceChildren(); return; }
    const b = el("button", {
      type: "button",
      class: "np-btn np-novo-rapido",
      title: "Novo",
      "aria-label": "Criar novo item",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      onclick: (e) => {
        const lista = acoesNovoRapido();
        if (!lista.length || !window.NPUI?.pop) return;
        NPUI.pop(e.currentTarget, lista, { role: "menu", label: "Criação rápida", alinhar: "esq", refoco: e.currentTarget });
      },
    }, ico('<path d="M12 5v14M5 12h14"/>'), el("span", {}, "Novo"), ico(CHEV, "np-ico np-chev"));
    acaoSlot.replaceChildren(b);
  }
    window.NPCasca = { contar: (tab, fn, rotulo) => { CONT[tab] = { fn, rotulo: rotulo || ((n) => String(n)) }; },
    acomodar(itens) {
      if (!document.documentElement.classList.contains("np-casca-v3")) return itens;
      if (matchMedia("(max-width:900px)").matches) { vistaSlot.replaceChildren(); acaoSlot.replaceChildren(); return itens; } // celular/tablet retrato: tudo fica na faixa
      const resto = [], vistas = [], acoes = [];
      for (const i of itens) {
        if (i?.classList?.contains("np-seg") && [...i.querySelectorAll("button")].some(b => /^(Lista|Quadro|Grade)$/.test(b.textContent.trim()))) vistas.push(i);
        else if (i?.classList?.contains("np-btn") && i.classList.contains("pri") && !acoes.length) acoes.push(i);
        else resto.push(i);
      }
      vistaSlot.replaceChildren(...vistas);
      if (acoes.length) acaoSlot.replaceChildren(...acoes);
      else preencherAcaoPadrao();
      vistaSlot.dataset.tab = acaoSlot.dataset.tab = tabAtual() || "";
      return resto;
    },
    sincronizarUsuario() { atualizarRodapeUsuario(); },
  };
  // busca: a entrada é o "Buscar" da lateral (e o atalho /); o campo da barra vira paleta ao receber foco (CSS)
  const inpBusca = $("#buscaGlobal"); if (inpBusca) { inpBusca.tabIndex = -1; inpBusca.addEventListener("keydown", e => { if (e.key === "Escape") setTimeout(() => inpBusca.blur(), 0); }); }
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
  if (btnSb) {
    const casaBarra = btnSb.nextSibling, paiBarra = btnSb.parentNode;
    btnSb.append(ico('<path d="m15 6-6 6 6 6"/>', "np-ico np-ico-rec"));
    const morar = () => { const cel = matchMedia("(max-width:900px)").matches;
      if (cel && btnSb.parentNode !== paiBarra) paiBarra.insertBefore(btnSb, casaBarra); else if (!cel && btnSb.parentNode !== ws) ws.append(btnSb);
      btnSb.title = cel ? "Menu" : "Recolher ou expandir o menu"; };
    morar(); matchMedia("(max-width:900px)").addEventListener("change", morar);
  }
  const fecharGaveta = () => app.classList.remove("sb-aberta", "np-expandida");
  const emTrilho = () => !matchMedia("(max-width:900px)").matches && (app.classList.contains("np-trilho") || (matchMedia("(max-width:1179px)").matches && !app.classList.contains("np-expandida")));
  // .np-rail é o estado visual derivado (o CSS do trilho pende dele); recalculado a cada mudança de classe/largura
  const sincRail = () => { const q = emTrilho(); if (app.classList.contains("np-rail") !== q) app.classList.toggle("np-rail", q); };
  new MutationObserver(sincRail).observe(app, { attributes: true, attributeFilter: ["class"] });
  for (const q of ["(max-width:900px)", "(max-width:1179px)"]) matchMedia(q).addEventListener("change", sincRail);
  sincRail();

  /* ---------- modelo da árvore a partir do NAV real ---------- */
  // DESIGN.md §4: fixos sem grupo = Hoje, Tarefas e prazos, Agenda, Avisos; Clientes é GRUPO (Carteira, Acompanhamento PJ).
  // Na visão do cliente (somente leitura) "Clientes" continua item único ("Minha área"), como sempre foi.
  const soLeitura = () => { try { return readOnly(); } catch (_) { return false; } };
  const FIXOS_BASE = ["painel", "tarefas", "agenda", "avisos"];
  const FILHOS = {};
  const HUBS = (window.PP_HUBS && window.PP_HUBS.HUBS) || {};
  // Falha fechada: a casca nunca libera visualmente um destino por conta própria. Só mostra o que PP.temAcesso
  // (regra da aplicação, definida pelo gerador) responde `true`; ausência ou erro da função esconde o item.
  const acesso = (tab) => { try { return typeof PP.temAcesso === "function" && PP.temAcesso(tab) === true; } catch (_) { return false; } };
  const podeRota = (tab) => {
    const meta = ROTAS_META[tab];
    if (tab === "feriados" && !(typeof equipe === "function" && equipe())) return false;
    if (!acesso(tab)) return false;
    if (meta?.tabAcesso && meta.tabAcesso !== tab && !acesso(meta.tabAcesso)) return false;
    return true;
  };
  function modelo() {
    const itens = NAV.filter(n => n.tab || n.link), grupos = NAV.filter(n => n.grupo), byTab = t => itens.find(i => i.tab === t);
    const hub = (chave, label, icone) => { const h = HUBS[chave]; const it = itens.find(i => i.tabs && h && i.tabs.some(t => h.tabs.some(([x]) => x === t))); if (!h || !it) return null;
      // abas de hub sem acesso não entram no modelo (não existem na árvore, no flyout nem na árvore de acessibilidade)
      return { id: chave, label, icone, cls: it.cls || "", hubTab: it.tab, itens: h.tabs.filter(([t]) => it.tabs.includes(t) && acesso(t) && t !== "historico").map(([t, l]) => ({ tab: t, label: l, cls: "" })) }; };
    const deGrupos = (ids) => grupos.filter(g => ids.includes(g.grupo)).flatMap(g => g.itens.map(i => ({ ...i, cls: ((g.cls || "") + " " + (i.cls || "")).trim() })));
    const ro = soLeitura(); const FIXOS = ro ? [...FIXOS_BASE, "clientes", "acompanhamento"] : FIXOS_BASE;
    const cart = byTab("clientes"), acomp = byTab("acompanhamento");
    const gCli = ro || !cart ? null : { id: "clientes", label: "Clientes", icone: "clientes", cls: "", itens: [{ ...cart, label: "Carteira" }, acomp].filter(Boolean) };
    const gs = [gCli, hub("juridico", "Jurídico", "juridico"), hub("financeiro", "Financeiro", "financeiro"),
      { id: "equipe", label: "Equipe e gestão", icone: "equipe", cls: "", itens: deGrupos(["equipe", "gestao"]) },
      { id: "ferramentas", label: "Ferramentas", icone: "ferramentas", cls: "", itens: deGrupos(["juridico-ferr", "comercial", "marketing"]) }].filter(g => g && g.itens.length);
    // Financeiro (19/11, 12h — decisão das sócias): só as quatro páginas da especificação do setor. Estoque e Inventário passam para o grupo
    // Administrativo, com a mesma regra de acesso de antes. As telas do Asaas e Contratos e faturamento saem da navegação da casca nova
    // (a integração com o Asaas continua; na casca antiga nada muda). Nenhuma permissão foi alterada.
    { const i = gs.findIndex(g => g.id === "financeiro"), fin = gs[i], podeFin = PP.perfil?.papel === "admin" || (PP.perfil?.acessos || []).includes("financeiro");
      if (fin) { const novas = podeFin ? [["fin-visao", "Visão geral"], ["fin-regua", "Régua de cobrança"], ["fin-retornos", "Cobranças e retornos"], ["fin-recuperacao", "Recuperação"]].filter(([t]) => document.getElementById("view-" + t) && acesso(t)).map(([t, l]) => ({ tab: t, label: l, cls: "" })) : [];
        const adm = fin.itens.filter(it => it.tab === "estoque" || it.tab === "inventario");
        fin.itens = novas; const grupos = [fin.itens.length ? fin : null, adm.length ? { id: "administrativo", label: "Administrativo", icone: "administrativo", cls: "", itens: adm } : null].filter(Boolean);
        gs.splice(i, 1, ...grupos); } }
    const addAoGrupo = (grupoId, tab, exigirView = true) => {
      const meta = ROTAS_META[tab];
      if (!meta || !podeRota(tab)) return;
      if (exigirView && !$("#view-" + tab)) return;
      if (gs.some(g => g.itens.some(i => i.tab === tab))) return;
      let g = gs.find(x => x.id === grupoId);
      if (!g) { g = { id: grupoId, label: meta.grupo || "Outros", icone: I_GRUPO[grupoId] ? grupoId : "ferramentas", cls: "", itens: [] }; gs.push(g); }
      g.itens.push({ tab, label: meta.label, cls: meta.cls || "" });
    };
    // Destinos internos válidos que ficam fora dos hubs principais (sempre falha-fechado por PP.temAcesso).
    // Decisão 06/11: Leads, Comercial, Atendimento e Automações NÃO entram na árvore V3.1 (saem para o CRM separado);
    // Ferramentas mantém apenas os destinos aprovados do NAV (ex.: Base de conhecimento em Comercial), preservando
    // apenas o fallback silencioso de breadcrumb/título em ROTAS_META para rotas legadas abertas diretamente.
    const LEGADO_CRM = new Set(["leads", "comercial", "atendimento", "automacoes"]);
    for (const t of ["historico", "regras", "calibracao"]) addAoGrupo("equipe", t, true);
    // Rota direta atualmente aberta fora de NAV/hubs (ex.: fin-visao, financeiro-controle): entra no grupo correto se permitida,
    // exceto rotas legadas de CRM/Atendimento (grupoId: null e guardadas em LEGADO_CRM).
    const curTab = tabAtual();
    if (curTab && !LEGADO_CRM.has(curTab) && ROTAS_META[curTab]?.grupoId && !FIXOS.includes(curTab) && curTab !== "perfil") addAoGrupo(ROTAS_META[curTab].grupoId, curTab, false);
    // itens do NAV que não entraram em fixos, hubs ou grupos conhecidos: grupo "Outros" (nunca se perde destino)
    const cobertos = new Set([...FIXOS, "clientes", "acompanhamento", "perfil", ...gs.flatMap(g => g.itens.map(i => i.tab)), ...gs.map(g => g.hubTab).filter(Boolean)]);
    // itens com `tabs` são hubs (filhos já avaliados por acesso); nunca caem em "Outros"
    const soltos = itens.filter(i => i.tab && !i.tabs && !cobertos.has(i.tab) && !LEGADO_CRM.has(i.tab)).concat(grupos.filter(g => !["equipe", "gestao", "juridico-ferr", "comercial", "marketing"].includes(g.grupo)).flatMap(g => g.itens.filter(i => !cobertos.has(i.tab) && !LEGADO_CRM.has(i.tab))));
    if (soltos.length) gs.push({ id: "outros", label: "Outros", icone: "ferramentas", cls: "", itens: soltos });
    return { fixos: FIXOS.map(byTab).filter(Boolean), perfil: byTab("perfil"), grupos: gs, links: itens.filter(i => i.link) };
  }
  /* contagens da lateral (Figma de 18/11): só o que pede ação de quem está logado, e só quando há algo — sem número, sem ruído.
     Cada módulo registra a sua em window.__NP_CONT[tab] = { fn, rotulo }; fn devolve null enquanto o dado não estiver carregado. */
  const CONT = (window.__NP_CONT = window.__NP_CONT || {}); // registro compartilhado: independe da ordem de carga dos módulos
  const ativoDe = (i) => (i.tabs ? i.tabs.includes(S.tab) : (S.tab === i.tab || (i.alt || []).includes(S.tab))) && (!i.sel || i.sel());
  let abertos = {}; try { abertos = JSON.parse(localStorage.getItem(K("np-grupos")) || "{}"); } catch (_) {}
  const visivel = (e) => e && getComputedStyle(e).display !== "none";
  // troca a semântica de aba (role=tab/aria-selected, herdada do itemNav da V2) pela de navegação (aria-current)
  const semantica = (b, atual) => { b.removeAttribute("role"); b.removeAttribute("aria-selected"); if (atual) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); return b; };

  /* ---------- resolução do nome real do usuário (evita prefixo de e-mail no rodapé) ---------- */
  const pareceHandle = s => { const t = String(s || "").trim(); return !t || /@/.test(t) || (!/\s/.test(t) && /[._-]/.test(t)); };
  function nomeRealUsuario() {
    const em = String((typeof S !== "undefined" ? S.user?.email : "") || (typeof PP !== "undefined" ? PP.perfil?.email : "") || "").trim().toLowerCase();
    const pid = typeof PP !== "undefined" ? PP.perfil?.id : null;
    const eqLista = window.PP_EQUIPE?.lista || [];
    const colab = eqLista.find(c => pid && c.perfil_id === pid) || (em ? eqLista.find(c => String(c.email || "").trim().toLowerCase() === em) : null);
    const cands = [
      window.PP_PAINEL?.nomeUsuario?.(),
      colab?.nome,
      typeof PP !== "undefined" ? PP.perfil?.nome : null,
      typeof PP !== "undefined" ? PP.perfil?.nome_completo : null,
      typeof S !== "undefined" ? S.user?.user_metadata?.full_name : null,
      typeof S !== "undefined" ? S.user?.user_metadata?.name : null,
      $("#userName")?.textContent,
    ];
    const real = cands.find(x => x && !pareceHandle(x));
    const chosen = String(real || $("#userName")?.textContent || "").trim();
    if (!chosen) return "";
    return pareceHandle(chosen) ? chosen : chosen.split(/\s+/).slice(0, 2).join(" ");
  }
  function iniciaisUsuario(nome) {
    if (!nome) return "NP";
    const partes = nome.split(/\s+/).filter(Boolean);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return nome.slice(0, 2).toUpperCase();
  }
  function atualizarRodapeUsuario() {
    const nome = nomeRealUsuario();
    const b = eu.querySelector(".np-rot b"), av = eu.querySelector(".tab > i");
    if (b && nome) b.textContent = nome;
    if (av && nome) av.textContent = iniciaisUsuario(nome);
  }

  /* ---------- render da árvore (chamado por renderNav) ---------- */
  function montar() {
    const m = modelo(); const ativo = (i) => ativoDe(i);
    const item = (i, extra) => { const b = itemNav(i, ativo(i)); semantica(b, ativo(i)); { const c = CONT[i.tab]; let n = null; try { n = c ? c.fn() : null; } catch (_) {} if (n > 0 && !b.querySelector(".cnt")) { b.append(el("em", { class: "cnt", title: c.rotulo(n) }, String(n))); b.setAttribute("aria-label", (i.label || "") + ", " + c.rotulo(n)); } } if (!temIcone(i) && I_TAB[i.tab]) b.querySelector("svg")?.replaceWith(ico(I_TAB[i.tab])); if (extra) b.classList.add(extra); return b; };
    const lista = (botoes) => el("ul", { class: "np-lista" }, botoes.map(b => el("li", {}, b)));
    tree.replaceChildren(lista(m.fixos.map(i => { const b = item(i, "np-top"); if (FILHOS[i.tab]) b.classList.add("np-filho"); return b; })), el("div", { class: "np-sec" }));
    for (const g of m.grupos) {
      const temAtivo = g.itens.some(ativo) || (g.hubTab && ativo({ tab: g.hubTab, tabs: g.itens.map(i => i.tab) }));
      const aberto = abertos[g.id] !== undefined ? !!abertos[g.id] : (g.id === "juridico" || g.id === "clientes" || temAtivo);
      const head = el("button", { class: "np-gh", type: "button", "aria-expanded": String(aberto || temAtivo), "aria-controls": "np-g-" + g.id, "data-g": g.id, onclick: (e) => aoClicarGrupo(e, g) }, ico(CHEV, "np-ico np-chev"), ico(I_GRUPO[g.icone] || I_GRUPO.ferramentas), el("span", {}, g.label));
      const corpo = el("div", { class: "np-corpo", id: "np-g-" + g.id }, lista(g.itens.map(i => item(i))));
      // estado aberto/fechado fica em data-aberto (CSS); aria-expanded só no botão, onde é válido
      const grp = el("div", { class: "np-g " + (g.cls || "") + (temAtivo ? " np-ativo" : ""), "data-aberto": (aberto || temAtivo) ? "1" : "0", "data-g": g.id }, head, corpo);
      if (!(aberto || temAtivo)) corpo.setAttribute("inert", "");
      tree.append(grp);
    }
    // rodapé: pessoa (nome real do colaborador/perfil, sem prefixo de e-mail) + Meu perfil + links externos
    const nome = nomeRealUsuario();
    const ini = iniciaisUsuario(nome);
    const perfilBtn = m.perfil ? item(m.perfil) : null;
    if (perfilBtn) { perfilBtn.classList.remove("np-top"); perfilBtn.replaceChildren(el("i", { "aria-hidden": "true" }, ini), el("div", { class: "np-rot" }, el("b", {}, nome || "Meu perfil"), el("small", {}, "Meu perfil"))); perfilBtn.title = "Meu perfil"; }
    // menu da conta (DESIGN.md §4: pessoa logada no rodapé): Meu perfil, Visão do cliente e Sair — os mesmos controles da V2, acionados por clique
    const conta = el("button", { type: "button", class: "np-conta", "aria-label": "Conta: perfil, visão do cliente e sair", title: "Conta", "aria-haspopup": "menu", "aria-expanded": "false", onclick: (e) => {
      const vc = $("#viewClient"), sair = $("#btnSair"); let ro = false; try { ro = readOnly(); } catch (_) {}
      NPUI.pop(e.currentTarget, [perfilBtn ? { label: "Meu perfil", onclick: () => perfilBtn.click() } : null,
        (vc && !ro) ? { label: vc.checked ? "Sair da visão do cliente" : "Ver como o cliente", onclick: () => vc.click() } : null,
        sair ? { label: "Sair", onclick: () => sair.click() } : null], { role: "menu", label: "Conta", refoco: e.currentTarget });
    } }, ico('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'));
    eu.replaceChildren(el("div", { style: "flex:1;min-width:0" }, m.links.length ? el("div", { class: "np-links edit-only" }, m.links.map(l => el("a", { href: l.link }, l.label))) : "", perfilBtn || ""), conta);
    // troca de módulo: a vista sai e o slot de ação mantém altura constante com "+ Novo ▾" até o módulo acomodar CTA próprio
    const cur = tabAtual() || "";
    if ((vistaSlot.dataset.tab || "") !== cur) { vistaSlot.replaceChildren(); preencherAcaoPadrao(); vistaSlot.dataset.tab = acaoSlot.dataset.tab = cur; }
    else if (!acaoSlot.childElementCount) { preencherAcaoPadrao(); }
    // grupos sem nenhum item visível para este perfil somem (mesmas regras CSS de permissão da V2)
    requestAnimationFrame(() => { for (const grp of tree.querySelectorAll(".np-g")) { const algum = [...grp.querySelectorAll(".tab")].some(visivel); grp.dataset.vazio = algum ? "0" : "1"; } });
    // trilha e título da barra (com fallback ROTAS_META para que nenhuma rota fique presa em "Clientes")
    const meta = cur ? ROTAS_META[cur] : null;
    const gAtivo = m.grupos.find(g => g.itens.some(ativo) || (g.hubTab && ativoDe({ tab: g.hubTab, tabs: g.itens.map(i => i.tab) })));
    const fixoAtivo = !gAtivo && m.fixos.some(ativo); // itens fixos da árvore pertencem a "Meu dia" (DESIGN.md §4)
    const trilhaTxt = gAtivo ? gAtivo.label : fixoAtivo ? "Meu dia" : (meta?.grupo || "");
    trilha.textContent = trilhaTxt; trilha.hidden = !trilhaTxt;
    if (brand && !somenteLeitura()) {
      const todos = m.fixos.concat(m.grupos.flatMap(g => g.itens), m.perfil ? [m.perfil] : []);
      const i = todos.find(ativo);
      const titulo = i?.label || meta?.label;
      if (titulo) brand.textContent = titulo;
    }
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
  function mostrarDica(elm) { if (!elm) { dica.classList.remove("on"); return; } const t = elm.querySelector("span")?.textContent || elm.title || elm.getAttribute("aria-label") || ""; if (!t) return; const r = elm.getBoundingClientRect(); dica.textContent = t; dica.style.left = (r.right + 10) + "px"; dica.style.top = (r.top + r.height / 2 - 14) + "px"; dica.classList.add("on"); }
  side.addEventListener("mouseover", e => { if (!emTrilho() || flyG) return; const elm = e.target.closest("#np-tree .tab, #np-tree .np-gh, .np-busca-btn, #np-acao .np-btn, .np-eu .tab"); if (elm) mostrarDica(elm); });
  side.addEventListener("mouseout", () => mostrarDica(null));
  matchMedia("(max-width:900px)").addEventListener("change", () => { if (!acaoSlot.querySelector(".pri")) preencherAcaoPadrao(); });
  // navegar fecha a gaveta/expansão (itemNav já chama fecharSb() para sb-aberta)
  tree.addEventListener("click", e => { if (e.target.closest(".tab")) app.classList.remove("np-expandida"); });

  window.PP_CASCA = { versao: "v3.1", modelo, emTrilho, fecharFly, ROTAS_META };
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
  document.head.append(el("style", {}, `html.np-casca-v3 .busca .res .grp-h{color:var(--muted)} /* V3.1: cabeçalhos dos grupos da busca com contraste ≥ 4,5:1 (V2 mantém a cor de antes) */
.busca .res .np-busca-est{padding:6px 12px 8px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:2px 4px}.busca .res .np-busca-est .np-busca-carregar{display:inline;width:auto;padding:0 2px;font:inherit;color:var(--info);text-decoration:underline;background:transparent;border:0;cursor:pointer}.busca .res .np-busca-est .np-busca-carregar[disabled]{color:var(--muted);text-decoration:none;cursor:default}`));
})();
