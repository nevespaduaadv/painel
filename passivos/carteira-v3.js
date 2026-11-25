/* V3.1 · Clientes → Carteira (entrega V3 do Cronograma-Mestre) — faixa (resumo + filtros), lista com régua e painel.
   Só com a casca V3.1 (html.np-casca-v3), np-ui e equipe(); fora disso a lista V2 (renderList de painel.html) segue intacta.
   Dados: os MESMOS da V2 (S.clientes, S.contratos, com as mesmas regras de "em atraso" / "em negociação" / saldo) + visão geral
   (PP_CLIENTES_VISAO: processos ativos, situação com os bancos, etapa) + leitura dos prazos abertos por cliente (v_tarefas) e dos
   nomes da equipe (colaboradores). Ações: as MESMAS da V2 (openClientForm, abrir a ficha por S.sel, exportar CSV). Nenhuma gravação nova.
   DESIGN.md §5: linha = régua · prazo (serifa) · título + secundário · marcas itálicas · valor + pessoa; a régua diz o estado do
   próximo prazo (fatal / atrasado / hoje); pílula colorida para estado não existe aqui. */
(() => {
  "use strict";
  const ligado = () => { try { return document.documentElement.classList.contains("np-casca-v3") && !!window.NPUI && typeof equipe === "function" && equipe(); } catch (_) { return false; } };
  const LIMPO = { ordem: "az", escopo: "todos", atraso: false, neg: false, proc: false, inad: false, meus: false, seg: "", resp: "", etapa: "", q: "" };
  const POR_PAGINA = 40;
  const K = { lista: false, idx: null, idxCarregando: false, pg: 1, pgChave: "", f: { ...LIMPO }, aberta: null, painel: null, obra: null, grupos: null, prazos: null, colab: null, carregando: false, erro: null };
  const SIT_B = { inadimplente: "Inadimplente", vai_ficar_inadimplente: "Vai ficar inadimplente", adimplente: "Adimplente" };
  const ETAPAS = { 0: "Contrato fechado", 1: "Cadastro ADVBox", 2: "Formulário enviado", 3: "Formulário respondido", 4: "Auditoria", 5: "R1 agendada", 6: "R1 feita", 7: "R2 feita", 8: "R3 feita", 9: "Ciclo encerrado", 10: "Ciclo mensal" };
  const GRUPOS = [["atencao", "Exigem atenção", "att"], ["negociacao", "Em negociação ou acordo", ""], ["em_dia", "Contratos em dia", ""], ["sem", "Sem contratos ativos", ""]];
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  const brlCurto = (v) => { const n = +v || 0; if (n >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi"; if (n >= 1e4) return "R$ " + Math.round(n / 1e3).toLocaleString("pt-BR") + " mil"; return NPUI.brl(n); };
  const grupos = () => { if (!K.grupos) { try { K.grupos = JSON.parse(NPUI.pref.get("np-carteira-grupos", "{}")) || {}; } catch (_) { K.grupos = {}; } } return K.grupos; };
  const meuColab = () => (K.colab || []).find((c) => c.perfil_id === PP.perfil?.id) || null;
  const nomeColab = (id) => (K.colab || []).find((c) => c.id === id)?.nome || null;
  const respDe = (c) => c.responsavel || c.dados?.responsavel || nomeColab(c.resp_estrategico_id) || nomeColab(c.resp_negocial_id) || nomeColab(c.resp_juridico_id) || null;
  const resps = (c) => [c.resp_estrategico_id, c.resp_juridico_id, c.resp_negocial_id].filter(Boolean);

  /* leituras de apoio (uma vez por sessão; "Atualizar" da barra recarrega a página inteira, como nos outros módulos) */
  async function carregarApoio(force) {
    if (K.carregando || (K.prazos && !force)) return; K.carregando = true; K.erro = null;
    try {
      const [t, co] = await Promise.all([
        SB.from("v_tarefas").select("id,cliente_id,titulo,prazo,prazo_fatal,status,responsavel_nome").in("status", ["aberta", "em_andamento"]).not("cliente_id", "is", null),
        SB.from("colaboradores").select("id,perfil_id,nome,ativo").order("nome")]);
      K.prazos = (t.data || []).filter((x) => x.prazo); K.colab = co.data || []; if (t.error) K.erro = t.error.message || "prazos indisponíveis";
    } catch (e) { K.prazos = []; K.colab = K.colab || []; K.erro = String(e?.message || e); }
    finally { K.carregando = false; }
    if (S.tab === "clientes" && !S.sel) renderList();
  }

  /* um registro por cliente visível — mesmas contas da V2 (renderList) */
  function registros() {
    const vis = window.PP_CLIENTES_VISAO?.dados?.() || null;
    const visPor = new Map((vis?.lista || []).map((c) => [c.id, c])); const passPor = new Map((vis?.pass || []).map((p) => [p.cliente_id, p]));
    const prazPor = new Map(); for (const t of K.prazos || []) { const l = prazPor.get(t.cliente_id) || []; l.push(t); prazPor.set(t.cliente_id, l); }
    return (S.clientes || []).map((c) => {
      const ks = (S.contratos || []).filter((x) => x.clienteId === c.id && x.situacao !== "quitado");
      const total = ks.reduce((s, x) => s + (+x.saldoAtual || +x.valorOriginal || 0), 0);
      const atraso = ks.filter((x) => x.dataInicioAtraso).length; const neg = ks.filter((x) => ["negociacao", "acordo"].includes(x.situacao)).length;
      const prazos = (prazPor.get(c.id) || []).slice().sort((a, b) => a.prazo.localeCompare(b.prazo) || (b.prazo_fatal ? 1 : 0) - (a.prazo_fatal ? 1 : 0));
      const v = visPor.get(c.id) || null; const pass = passPor.get(c.id) || null;
      return { c, ks, total, atraso, neg, prazos, prox: prazos[0] || null, proc: v ? (+v.processos_ativos || 0) : null, sitB: pass?.situacao || null,
        tipo: v?.tipo_pessoa || c.tipo_pessoa || null, etapa: v?.etapa_fluxo ?? c.etapa_fluxo ?? null,
        semResp: !(c.responsavel || c.dados?.responsavel || resps(c).length),
        // Figma de 18/11: quem pede ação vem primeiro — contrato em atraso ou cliente sem responsável (o motivo aparece na linha)
        grupo: atraso || !(c.responsavel || c.dados?.responsavel || resps(c).length) ? "atencao" : neg ? "negociacao" : ks.length ? "em_dia" : "sem" };
    });
  }
  /* régua = estado do próximo prazo, com a mesma regra da lista de Tarefas (fatal até 7 dias, atrasado, hoje) */
  const reguaDe = (r) => { if (!r.prox) return null; const d = NPUI.prazoTxt(r.prox.prazo).dias; if (r.prox.prazo_fatal && d <= 7) return "fatal"; if (d < 0) return "late"; if (d === 0) return "att"; return null; };
  const tomDe = (rg) => rg === "fatal" ? "crit" : rg === "late" ? "late" : rg === "att" ? "att" : "";

  function filtrar(regs) {
    const f = K.f; const meu = meuColab(); const q = norm(f.q), qd = digitos(f.q);
    return regs.filter((r) => {
      if (f.escopo === "pj" && r.tipo === "PF") return false; if (f.escopo === "pf" && r.tipo !== "PF") return false;
      if (f.semResp && !r.semResp) return false; if (f.atraso && !r.atraso) return false; if (f.neg && !r.neg) return false; if (f.proc && !(r.proc > 0)) return false; if (f.inad && r.sitB !== "inadimplente") return false;
      if (f.meus && !(meu && resps(r.c).includes(meu.id))) return false; if (f.resp && !resps(r.c).includes(f.resp)) return false;
      if (f.seg && (r.c.segmento || "") !== f.seg) return false; if (f.etapa !== "" && String(r.etapa ?? "") !== f.etapa) return false;
      if (q && !(norm(r.c.nome).includes(q) || norm(r.c.nome_fantasia).includes(q) || (qd.length >= 3 && digitos(r.c.cnpj).includes(qd)) || noIndice(r.c.id, q, qd))) return false;
      return true;
    });
  }
  /* busca também por sócio/contato e número de processo (25/11): índice leve (duas colunas de cada tabela), carregado só na primeira busca */
  async function carregarIndice() {
    if (K.idx || K.idxCarregando) return; K.idxCarregando = true;
    try {
      const todas = window.npTodas || (async (m) => (await m()).data || []);
      const [ct, pr] = await Promise.all([todas(() => SB.from("contatos").select("id,cliente_id,nome").order("id")), todas(() => SB.from("processos").select("id,cliente_id,numero_cnj").order("id"))]);
      const idx = new Map(); const por = (cid) => { let x = idx.get(cid); if (!x) { x = { nomes: "", procs: "" }; idx.set(cid, x); } return x; };
      for (const c of ct || []) if (c.cliente_id && c.nome) por(c.cliente_id).nomes += " " + norm(c.nome);
      for (const p of pr || []) if (p.cliente_id && p.numero_cnj) por(p.cliente_id).procs += " " + digitos(p.numero_cnj);
      K.idx = idx;
    } catch (_) { K.idx = new Map(); }
    finally { K.idxCarregando = false; }
    if (S.tab === "clientes" && !S.sel && K.f.q) { renderList(); const x = document.querySelector("#np-carteira .np-busca-inline"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }
  }
  const noIndice = (cid, q, qd) => { const x = K.idx?.get(cid); if (!x) return false; return (q.length >= 3 && x.nomes.includes(q)) || (qd.length >= 5 && x.procs.includes(qd)); };
  /* Carteira simples (pedido das sócias, 23/11): só a lista dos clientes. Situação dos contratos, valores e prazos ficam na ficha do cliente e na Gestão. */
  function contexto(r) {
    const c = r.c; const partes = [];
    if (c.cidade) partes.push(c.cidade + (c.uf && !/\/\w\w$/.test(c.cidade) ? "/" + c.uf : ""));
    if (c.segmento) partes.push(c.segmento);
    return partes.join(" · ");
  }
  /* marcas de situação: fora da lista, mas continuam no cabeçalho da ficha do cliente (ficha-v3.js usa PP_CARTEIRA_V3.marcas) */
  function marcas(r) {
    const m = [];
    if (r.atraso) m.push(NPUI.marca(`${r.atraso} em atraso`, "late"));
    else if (r.neg) m.push(NPUI.marca(r.neg === 1 ? "em negociação" : `${r.neg} em negociação`, "info"));
    if (r.sitB === "inadimplente") m.push(NPUI.marca("inadimplente com bancos", "crit"));
    else if (r.sitB === "vai_ficar_inadimplente") m.push(NPUI.marca("vai ficar inadimplente", "att"));
    if (r.proc > 0) m.push(NPUI.marca(`${r.proc} processo${r.proc === 1 ? "" : "s"}`));
    return m;
  }
  function linha(r) {
    return NPUI.linha({ id: r.c.id, atual: K.aberta === r.c.id, titulo: r.c.nome || "(sem nome)", contexto: contexto(r) || null, titleAbrir: "Abrir a ficha do cliente",
      direita: [NPUI.marca(r.tipo === "PF" ? "PF" : "PJ"), r.semResp ? null : NPUI.quem(respDe(r.c))].filter(Boolean),
      onOpen: () => { K.aberta = null; S.sel = r.c.id; S.sub = null; render(); } });
  }
  function lista(regs) {
    const host = el("div", { class: "np-corpo" }); K.fatia = null;
    if (!(S.clientes || []).length) { host.append(NPUI.vazio({ titulo: "Nenhum cliente cadastrado", texto: S.db ? "Use “+ Novo cliente” para começar." : "Conectando ao banco de dados…" })); return host; }
    if (!regs.length) { host.append(NPUI.vazio({ titulo: "Nenhum cliente com esses filtros", texto: "Tire um filtro para ver a carteira inteira.", acao: "Limpar filtros", onAcao: () => { K.f = { ...LIMPO }; renderList(); } })); return host; }
    const sinal = K.f.ordem === "za" ? -1 : 1;
    const its = regs.slice().sort((a, b) => sinal * (a.c.nome || "").localeCompare(b.c.nome || "", "pt-BR"));
    // 40 por página; mudar filtro, busca ou ordem volta para a primeira
    const chave = JSON.stringify(K.f); if (chave !== K.pgChave) { K.pgChave = chave; K.pg = 1; }
    const fa = NPUI.fatia(its, K.pg, POR_PAGINA); K.pg = fa.pagina; K.fatia = fa;
    host.append(el("ul", { class: "np-lst" }, fa.itens.map(linha)));
    const pag = NPUI.paginas({ total: its.length, pagina: fa.pagina, porPagina: POR_PAGINA, rotulo: "clientes", onIr: (n) => { K.pg = n; renderList(); window.scrollTo(0, 0); document.querySelector("#np-carteira .np-corpo")?.scrollTo?.(0, 0); document.querySelector("#np-carteira .np-lst .np-it button, #np-carteira .np-lst .np-it a")?.focus?.({ preventScroll: true }); } });
    if (pag) host.append(pag);
    return host;
  }
  function filtros(regs) {
    const f = K.f; const chips = []; const C = (o) => { const c = NPUI.chip(o); chips.push(c); return c; }; const meu = meuColab();
    C({ label: f.ordem === "za" ? "Z–A" : "A–Z", on: false, title: f.ordem === "za" ? "Ordem decrescente (Z–A). Clique para crescente." : "Ordem crescente (A–Z). Clique para decrescente.", onclick: () => { f.ordem = f.ordem === "za" ? "az" : "za"; renderList(); } });
    return { chips, fixos: [] };
  }
  const COLS_CSV = [{ k: "nome", t: "Cliente" }, { k: "nome_fantasia", t: "Nome fantasia" }, { k: "cnpj", t: "CNPJ" }, { k: "tipo_pessoa", t: "Tipo" }, { k: "cidade", t: "Cidade" }, { k: "uf", t: "UF" }, { k: "segmento", t: "Segmento" }, { k: "servico", t: "Serviço" }, { k: "status", t: "Status" }, { k: "etapa_fluxo", t: "Etapa" }, { k: "responsavel", t: "Responsável" }, { k: "data_fechamento", t: "Fechamento", f: (v) => v ? String(v).slice(0, 10).split("-").reverse().join("/") : "" }];
  function exportar(regs) { if (typeof exportarCSV !== "function") return; const ls = regs.map((r) => ({ ...r.c, _total: r.total, _contratos: r.ks.length, _atraso: r.atraso, _neg: r.neg })); if (!ls.length) { toast("Nada para exportar"); return; } exportarCSV("clientes", ls, COLS_CSV); toast(`${ls.length} linha(s) exportada(s)`); }

  function renderCarteira() {
    const host = $("#clientList"); if (host) host.replaceChildren();
    const nb = $("#btnNewClient"); if (nb) nb.hidden = true;
    const m = $("#main"); if (!m) return; m.replaceChildren(); K.obra = null; K.painel = null;
    window.PP_CLIENTES_VISAO?.carregar?.(); carregarApoio();
    const v = el("div", { class: "np-v3 np-carteira", id: "np-carteira" }); m.append(v);
    const regs = registros(); const vis = filtrar(regs);
    const nPF = regs.filter((r) => r.tipo === "PF").length, nPJ = regs.length - nPF;
    if (K.f.q) { K.lista = true; carregarIndice(); }
    const abrirCarteira = (k) => { if (K.lista && K.f.escopo === k) K.lista = false; else { K.f.escopo = k; K.lista = true; } renderList(); };
    const qd = (k, titulo, n) => ({ titulo, n, ativo: K.lista && K.f.escopo === k, acao: K.lista && K.f.escopo === k ? "Ocultar clientes" : "Mostrar clientes", onclick: () => abrirCarteira(k) });
    const quadros = NPUI.quadros([qd("todos", "Todos os clientes", regs.length), qd("pf", "Carteira PF", nPF), qd("pj", "Carteira PJ", nPJ)]);
    let tq = null; const busca = el("input", { type: "search", class: "np-busca-inline", placeholder: "Buscar nome, CNPJ, sócio ou processo…", title: "Nome ou razão social, CNPJ/CPF, nome do sócio ou número do processo", value: K.f.q || "", "aria-label": "Buscar cliente por nome, CNPJ, sócio ou número do processo", oninput: (ev) => { K.f.q = ev.target.value.trim(); clearTimeout(tq); tq = setTimeout(() => { renderList(); const x = document.querySelector("#np-carteira .np-busca-inline"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 300); } });
    const fl = filtros(regs); const ro = typeof readOnly === "function" && readOnly();
    const maisAc = NPUI.ib("pontos", "Mais ações", () => NPUI.pop(maisAc, [{ label: "Exportar CSV (lista filtrada)", onclick: () => exportar(vis.slice().sort((a, b) => (a.c.nome || "").localeCompare(b.c.nome || "", "pt-BR"))) }, { label: "Acompanhamento PJ (todos os clientes PJ por etapa)", onclick: () => irPara("acompanhamento") }], { label: "Mais ações", alinhar: "dir", refoco: () => document.querySelector('#np-carteira .np-ib[aria-label="Mais ações"]') }));
    maisAc.setAttribute("aria-haspopup", "menu"); maisAc.setAttribute("aria-expanded", "false");
    v.append(quadros);
    v.append(NPUI.toolbar({ filtros: K.lista ? fl.chips : [], filtrosFixos: fl.fixos, direita: [busca, ro ? null : NPUI.btn("+ Novo cliente", { variante: "pri", disabled: !S.db, onclick: () => openClientForm({}) }), maisAc] }));
    NPUI.reancorarPop();
    if (K.erro) v.append(NPUI.faixaErro({ texto: "Os prazos dos clientes não carregaram; a lista segue sem eles.", acao: "Tentar de novo", onAcao: () => carregarApoio(true) }));
    if (K.lista && K.f.escopo === "pj") v.append(el("div", { class: "np-qd-nota" }, "Panorama dos clientes PJ por etapa do ciclo: ", el("button", { type: "button", class: "lnk", onclick: () => irPara("acompanhamento") }, "abrir o Acompanhamento PJ"), "."));
    const obra = el("div", { class: "np-obra" }); K.obra = obra; const corpo = K.lista ? lista(vis) : el("div", { class: "np-corpo" }, el("div", { class: "np-qd-nota" }, "Escolha uma carteira acima para ver a lista, ou busque um cliente pelo nome, CNPJ, sócio ou número do processo."));
    if (!K.lista) { obra.append(corpo); v.append(obra); K.painel = NPUI.painel({ obra, label: "Resumo do cliente", onClose: () => { K.aberta = null; } }); return; }
    corpo.append(NPUI.rodape(`${K.fatia && K.fatia.paginas > 1 ? `mostrando ${K.fatia.de}–${K.fatia.ate} · ` : ""}${vis.length} de ${regs.length} cliente${regs.length === 1 ? "" : "s"}${vis.length === regs.length ? "" : " com estes filtros"} · ordem alfabética ${K.f.ordem === "za" ? "decrescente (Z–A)" : "crescente (A–Z)"}`));
    obra.append(corpo); v.append(obra);
    K.painel = NPUI.painel({ obra, label: "Resumo do cliente", onClose: () => { K.aberta = null; } });
    if (K.aberta) { if (regs.some((r) => r.c.id === K.aberta)) abrirPainel(K.aberta, { silencioso: true }); else K.aberta = null; }
  }

  function montarPainel(r) {
    const c = r.c; const pass = r.sitB;
    const frentes = [["Estratégico", c.resp_estrategico_id], ["Jurídico", c.resp_juridico_id], ["Negocial", c.resp_negocial_id]].filter(([, id]) => id).map(([f, id]) => `${f}: ${nomeColab(id) || "—"}`).join(" · ");
    const props = NPUI.props([
      [c.tipo_pessoa === "PF" || r.tipo === "PF" ? "CPF" : "CNPJ", c.cnpj ? (typeof fmtDoc === "function" ? fmtDoc(c.cnpj) : c.cnpj) : el("span", { class: "np-sem" }, "—")],
      ["Cidade", c.cidade ? c.cidade + (c.uf && !/\/\w\w$/.test(c.cidade) ? "/" + c.uf : "") : el("span", { class: "np-sem" }, "—")],
      c.segmento ? ["Segmento", c.segmento] : null,
      ["Responsável", respDe(c) || el("span", { class: "np-sem" }, "—")],
      frentes ? ["Frentes", frentes] : null,
      r.etapa != null && ETAPAS[r.etapa] ? ["Etapa do fluxo", `${r.etapa} · ${ETAPAS[r.etapa]}`] : null,
      pass ? ["Com os bancos", SIT_B[pass] || pass, pass === "inadimplente" ? "crit" : pass === "vai_ficar_inadimplente" ? "att" : ""] : null,
      r.proc != null ? ["Processos ativos", String(r.proc)] : null,
    ]);
    const secK = NPUI.secao(`Contratos ativos${r.ks.length ? " · " + r.ks.length : ""}`,
      r.ks.length ? NPUI.tabela([{ k: "banco", label: "Banco" }, { label: "Produto", render: (x) => (typeof PRODUTOS !== "undefined" && PRODUTOS[x.produto]) || x.produto || null },
        { label: "Saldo", num: true, render: (x) => NPUI.brl(+x.saldoAtual || +x.valorOriginal || 0) },
        { label: "Situação", render: (x) => x.dataInicioAtraso ? NPUI.marca("em atraso", "late") : ((typeof SITUACOES !== "undefined" && SITUACOES[x.situacao]) || x.situacao || null) }],
        r.ks.slice().sort((a, b) => (+b.saldoAtual || +b.valorOriginal || 0) - (+a.saldoAtual || +a.valorOriginal || 0)), { label: "Contratos ativos" }) : el("div", { class: "np-sem" }, "Nenhum contrato ativo."),
      r.ks.length > 1 ? el("div", { class: "np-cart-total" }, "Total ", el("b", {}, NPUI.brl(r.total))) : null);
    const secP = NPUI.secao(`Próximos prazos${r.prazos.length ? " · " + r.prazos.length : ""}`,
      K.prazos == null ? NPUI.carregando(2) : r.prazos.length ? NPUI.passos(r.prazos.slice(0, 5).map((t) => { const p = NPUI.prazoTxt(t.prazo); const rg = reguaDe({ prox: t }); return { estado: rg === "fatal" || rg === "late" ? "crit" : "", el: el("span", {}, el("b", {}, p.curta), " · ", t.titulo), sub: [p.rel, t.prazo_fatal ? "fatal" : null, t.responsavel_nome].filter(Boolean).join(" · ") }; })) : el("div", { class: "np-sem" }, "Nenhum prazo aberto."),
      r.prazos.length > 5 ? el("div", { class: "np-sem", style: "margin-top:4px" }, `e mais ${r.prazos.length - 5} na ficha`) : null);
    let secA = null; try { secA = window.PP_ACOMP?.bloco ? window.PP_ACOMP.bloco(c.id) : null; } catch (_) { secA = null; }
    const pe = [NPUI.btn("Abrir ficha", { variante: "pri", onclick: () => { K.aberta = null; S.sel = c.id; S.sub = null; render(); } }),
      typeof readOnly === "function" && readOnly() ? null : NPUI.btn("Editar cliente", { onclick: () => openClientForm(c) })].filter(Boolean);
    return { trilha: ["Clientes", " · ", "Carteira"], corpo: [props, secK, secP, secA].filter(Boolean), pe };
  }
  function abrirPainel(cid, { origem, silencioso } = {}) {
    const r = registros().find((x) => x.c.id === cid); if (!r || !K.painel) return;
    K.aberta = cid; const mp = montarPainel(r);
    K.painel.abrir({ id: cid, trilha: mp.trilha, titulo: r.c.nome || "(sem nome)", corpo: mp.corpo, pe: mp.pe, origem: silencioso ? null : origem });
  }

  { const _rl = window.renderList; if (typeof _rl === "function") window.renderList = function () {
      if (!(ligado() && S.tab === "clientes" && !S.sel)) { K.painel = null; K.obra = null; return _rl.apply(this, arguments); }
      renderCarteira(); }; }
  window.PP_CARTEIRA_V3 = { ativo: ligado, filtro: (f = {}) => { K.f = { ...LIMPO, ...f }; if (S.tab === "clientes" && !S.sel) renderList(); }, filtroAtual: () => ({ ...K.f }), registros: () => (ligado() ? registros() : []), registro: (cid) => (ligado() ? registros().find((r) => r.c.id === cid) || null : null), marcas: (r) => (ligado() && r ? marcas(r) : []), abrir: (cid) => { if (S.tab !== "clientes" || S.sel) return false; abrirPainel(cid); return true; }, estado: () => ({ prazos: K.prazos ? K.prazos.length : null, colab: K.colab ? K.colab.length : null, erro: K.erro, aberta: K.aberta }) };
})();
