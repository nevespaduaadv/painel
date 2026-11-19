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
  const LIMPO = { escopo: "todos", atraso: false, neg: false, proc: false, inad: false, meus: false, seg: "", resp: "", etapa: "", q: "" };
  const K = { f: { ...LIMPO }, aberta: null, painel: null, obra: null, grupos: null, prazos: null, colab: null, carregando: false, erro: null };
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
      if (q && !(norm(r.c.nome).includes(q) || norm(r.c.nome_fantasia).includes(q) || (qd.length >= 3 && digitos(r.c.cnpj).includes(qd)))) return false;
      return true;
    });
  }
  function contexto(r) {
    const c = r.c; const partes = [];
    if (c.cidade) partes.push(c.cidade + (c.uf && !/\/\w\w$/.test(c.cidade) ? "/" + c.uf : ""));
    if (c.segmento) partes.push(c.segmento);
    partes.push(r.ks.length ? `${r.ks.length} contrato${r.ks.length === 1 ? "" : "s"}` : "sem contratos ativos");
    const out = []; partes.forEach((x, i) => { if (i) out.push(" · "); out.push(x); });
    if (r.prox) { const p = NPUI.prazoTxt(r.prox.prazo); out.push(el("span", { class: "sep" }, " · ")); out.push(el("span", { class: "rel " + tomDe(reguaDe(r)) }, p.rel)); }
    return out;
  }
  function marcas(r) {
    const m = [];
    if (r.atraso) m.push(NPUI.marca(`${r.atraso} em atraso`, "late"));
    else if (r.neg) m.push(NPUI.marca(r.neg === 1 ? "em negociação" : `${r.neg} em negociação`, "info"));
    if (r.sitB === "inadimplente") m.push(NPUI.marca("inadimplente com bancos", "crit"));
    else if (r.sitB === "vai_ficar_inadimplente") m.push(NPUI.marca("vai ficar inadimplente", "att"));
    if (r.proc > 0) m.push(NPUI.marca(`${r.proc} processo${r.proc === 1 ? "" : "s"}`));
    return m;
  }
  const valor = (v, n) => n ? el("span", { class: "np-val np-cart-val", title: "saldo em contratos ativos" }, el("b", {}, NPUI.brl(v))) : null;
  function linha(r) {
    const rg = reguaDe(r); const p = r.prox ? NPUI.prazoTxt(r.prox.prazo) : null;
    return NPUI.linha({ id: r.c.id, regua: rg, atual: K.aberta === r.c.id,
      prazo: p ? { curta: p.curta, rel: p.rel, exata: p.exata + " · " + r.prox.titulo + " · " + p.rel, tom: tomDe(rg) } : { curta: "", exata: "sem prazo aberto" },
      titulo: r.c.nome || "(sem nome)", contexto: contexto(r), titleAbrir: "Ver resumo do cliente",
      direita: [...marcas(r), valor(r.total, r.ks.length), r.semResp ? NPUI.marca("sem responsável", "crit") : NPUI.quem(respDe(r.c))].filter(Boolean),
      onOpen: (li) => abrirPainel(r.c.id, { origem: li.querySelector(".np-it-abrir") }) });
  }
  function lista(regs) {
    const host = el("div", { class: "np-corpo" });
    if (!(S.clientes || []).length) { host.append(NPUI.vazio({ titulo: "Nenhum cliente cadastrado", texto: S.db ? "Use “+ Novo cliente” para começar." : "Conectando ao banco de dados…" })); return host; }
    const gs = GRUPOS.filter(([k]) => regs.some((r) => r.grupo === k));
    if (!gs.length) { host.append(NPUI.vazio({ titulo: "Nenhum cliente com esses filtros", texto: "Tire um filtro para ver a carteira inteira.", acao: "Limpar filtros", onAcao: () => { K.f = { ...LIMPO }; renderList(); } })); return host; }
    const ab = grupos();
    for (const [k, l, tom] of gs) {
      const its = regs.filter((r) => r.grupo === k).sort((a, b) => (a.c.nome || "").localeCompare(b.c.nome || "", "pt-BR"));
      host.append(NPUI.grupo({ id: "cart-" + k, titulo: l, n: its.length, tom, aberto: ab[k] !== false, onToggle: (v) => { ab[k] = v; NPUI.pref.set("np-carteira-grupos", JSON.stringify(ab)); }, itens: its.map(linha) }));
    }
    return host;
  }
  function filtros(regs) {
    const f = K.f; const chips = []; const C = (o) => { const c = NPUI.chip(o); chips.push(c); return c; }; const meu = meuColab();
    const esc = (k, l, n) => C({ label: l, n, on: f.escopo === k, grupo: "escopo", onclick: () => { f.escopo = k; renderList(); } });
    esc("todos", "Todos"); esc("pj", "PJ", regs.filter((r) => r.tipo !== "PF").length); esc("pf", "PF", regs.filter((r) => r.tipo === "PF").length);
    chips.push(NPUI.sepv());
    const at = (k, l, n, title) => C({ label: l, n, on: f[k], grupo: "attr", title, onclick: () => { f[k] = !f[k]; renderList(); } });
    at("atraso", "Em atraso", regs.filter((r) => r.atraso).length, "Clientes com ao menos um contrato em atraso");
    at("neg", "Em negociação", regs.filter((r) => r.neg).length, "Clientes com contrato em negociação ou acordo");
    if (regs.some((r) => r.semResp) || f.semResp) at("semResp", "Sem responsável", regs.filter((r) => r.semResp).length, "Clientes sem responsável em nenhuma frente");
    if (regs.some((r) => r.proc != null)) at("proc", "Com processo", regs.filter((r) => r.proc > 0).length, "Clientes com processo ativo");
    if (regs.some((r) => r.sitB)) at("inad", "Inadimplentes", regs.filter((r) => r.sitB === "inadimplente").length, "Inadimplentes com os bancos (ficha de passagem)");
    if (meu) at("meus", "Meus", regs.filter((r) => resps(r.c).includes(meu.id)).length, "Clientes em que sou responsável em alguma frente");
    const extras = [f.q, f.seg, f.resp, f.etapa].filter((x) => x !== "" && x != null).length;
    const mais = NPUI.chip({ label: "Mais filtros", n: extras || null, on: extras > 0, title: "Nome ou CNPJ, segmento, responsável, etapa do fluxo", onclick: (e) => NPUI.pop(e.currentTarget, () => {
      const q = el("input", { type: "search", class: "np-in", value: f.q, placeholder: "Nome, nome fantasia ou CNPJ", "aria-label": "Nome ou CNPJ" });
      let tq = null; q.oninput = () => { clearTimeout(tq); tq = setTimeout(() => { f.q = q.value.trim(); renderList(); }, 220); };
      const segs = [...new Set((S.clientes || []).map((c) => c.segmento).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const fSeg = sel({ "": "Todos os segmentos", ...Object.fromEntries(segs.map((s) => [s, s])) }, f.seg);
      const fResp = sel({ "": "Todas as pessoas", ...Object.fromEntries((K.colab || []).filter((c) => c.ativo !== false).map((c) => [c.id, c.nome])) }, f.resp);
      const fEt = sel({ "": "Todas as etapas", ...Object.fromEntries(Object.entries(ETAPAS).map(([k, v]) => [k, k + " · " + v])) }, f.etapa);
      fSeg.onchange = () => { f.seg = fSeg.value; renderList(); }; fResp.onchange = () => { f.resp = fResp.value; renderList(); }; fEt.onchange = () => { f.etapa = fEt.value; renderList(); };
      const L = (l, c) => el("div", {}, el("label", {}, l), c);
      setTimeout(() => q.focus(), 0);
      return [el("div", { class: "np-pop-form" }, L("Nome ou CNPJ", q), L("Segmento", fSeg), L("Responsável (qualquer frente)", fResp), L("Etapa do fluxo", fEt),
        el("div", { style: "display:flex;justify-content:space-between;gap:8px" }, NPUI.btn("Limpar", { variante: "ghost", onclick: () => { K.f = { ...LIMPO }; NPUI.fecharPop(); renderList(); } }), NPUI.btn("Fechar", { onclick: () => NPUI.fecharPop() })))];
    }, { role: "dialog", label: "Mais filtros", alinhar: "dir", refoco: () => document.querySelector('#np-carteira .np-chipf[aria-haspopup="dialog"]') }) });
    mais.setAttribute("aria-haspopup", "dialog"); mais.setAttribute("aria-expanded", "false");
    return { chips, fixos: [mais] };
  }
  const COLS_CSV = [{ k: "nome", t: "Cliente" }, { k: "nome_fantasia", t: "Nome fantasia" }, { k: "cnpj", t: "CNPJ" }, { k: "tipo_pessoa", t: "Tipo" }, { k: "cidade", t: "Cidade" }, { k: "uf", t: "UF" }, { k: "segmento", t: "Segmento" }, { k: "servico", t: "Serviço" }, { k: "status", t: "Status" }, { k: "etapa_fluxo", t: "Etapa" }, { k: "responsavel", t: "Responsável" }, { k: "data_fechamento", t: "Fechamento", f: (v) => v ? String(v).slice(0, 10).split("-").reverse().join("/") : "" }, { k: "_contratos", t: "Contratos ativos" }, { k: "_total", t: "Saldo em contratos", f: (v) => String(Math.round(v * 100) / 100).replace(".", ",") }, { k: "_atraso", t: "Contratos em atraso" }, { k: "_neg", t: "Em negociação" }, { k: "adimplente", t: "Adimplente", f: (v) => v == null ? "" : v ? "sim" : "não" }];
  function exportar(regs) { if (typeof exportarCSV !== "function") return; const ls = regs.map((r) => ({ ...r.c, _total: r.total, _contratos: r.ks.length, _atraso: r.atraso, _neg: r.neg })); if (!ls.length) { toast("Nada para exportar"); return; } exportarCSV("clientes", ls, COLS_CSV); toast(`${ls.length} linha(s) exportada(s)`); }

  function renderCarteira() {
    const host = $("#clientList"); if (host) host.replaceChildren();
    const nb = $("#btnNewClient"); if (nb) nb.hidden = true;
    const m = $("#main"); if (!m) return; m.replaceChildren(); K.obra = null; K.painel = null;
    window.PP_CLIENTES_VISAO?.carregar?.(); carregarApoio();
    const v = el("div", { class: "np-v3 np-carteira", id: "np-carteira" }); m.append(v);
    const regs = registros(); const vis = filtrar(regs);
    const total = regs.reduce((s, r) => s + r.total, 0), nAt = regs.filter((r) => r.atraso).length, nInad = regs.filter((r) => r.sitB === "inadimplente").length;
    const temVis = regs.some((r) => r.proc != null);
    const resumo = NPUI.resumo([{ n: regs.length, label: regs.length === 1 ? "cliente" : "clientes" }, { n: brlCurto(total), label: "em contratos" }, { n: nAt, label: "com atraso", tom: nAt ? "crit" : "zero" }, regs.some((r) => r.semResp) ? { n: regs.filter((r) => r.semResp).length, label: "sem responsável", tom: "crit" } : null,
      temVis && nInad ? { n: nInad, label: "inadimplentes", tom: "att" } : null]);
    const fl = filtros(regs); const ro = typeof readOnly === "function" && readOnly();
    const maisAc = NPUI.ib("pontos", "Mais ações", () => NPUI.pop(maisAc, [{ label: "Exportar CSV (lista filtrada)", onclick: () => exportar(vis.slice().sort((a, b) => (a.c.nome || "").localeCompare(b.c.nome || "", "pt-BR"))) }, { label: "Acompanhamento PJ", onclick: () => irPara("acompanhamento") }], { label: "Mais ações", alinhar: "dir", refoco: () => document.querySelector('#np-carteira .np-ib[aria-label="Mais ações"]') }));
    maisAc.setAttribute("aria-haspopup", "menu"); maisAc.setAttribute("aria-expanded", "false");
    v.append(NPUI.toolbar({ resumo, filtros: fl.chips, filtrosFixos: fl.fixos, direita: [ro ? null : NPUI.btn("+ Novo cliente", { variante: "pri", disabled: !S.db, onclick: () => openClientForm({}) }), maisAc] }));
    NPUI.reancorarPop();
    if (K.erro) v.append(NPUI.faixaErro({ texto: "Os prazos dos clientes não carregaram; a lista segue sem eles.", acao: "Tentar de novo", onAcao: () => carregarApoio(true) }));
    const obra = el("div", { class: "np-obra" }); K.obra = obra; const corpo = lista(vis);
    corpo.append(NPUI.rodape(`${vis.length} de ${regs.length} cliente${regs.length === 1 ? "" : "s"}${vis.length === regs.length ? "" : " com estes filtros"} · ordem alfabética em cada grupo`, [["fatal", "prazo fatal"], ["late", "prazo vencido"], ["att", "vence hoje"]]));
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
