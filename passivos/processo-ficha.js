/* Ficha única do processo — usada pela lista geral (Jurídico → Processos) e pela ficha do cliente (sub-aba Processos).
   Uma só tela: cabeçalho, dados, PRAZOS (= tarefas abertas com prazo deste processo), pasta/relacionados/publicações
   (PP_PASTAS.secaoProcesso) e andamentos. Ações: Editar, + Andamento, + Tarefa/prazo, Abrir no cliente.
   Supabase: v_tarefas (processo_id), andamentos. Só equipe. */
(() => {
  "use strict";
  const C = { ands: {}, tarefas: {}, regs: {}, aba: {} };
  const fmt = (s) => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const BRLx = (v) => v == null || isNaN(v) ? "—" : (+v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const dias = (iso) => { if (!iso) return null; const a = new Date(iso.slice(0, 10) + "T12:00:00"), h = new Date(); h.setHours(12, 0, 0, 0); return Math.round((a - h) / 864e5); };
  const invalidar = (pid) => { if (pid) { delete C.ands[pid]; delete C.tarefas[pid]; delete C.regs[pid]; } else { C.ands = {}; C.tarefas = {}; C.regs = {}; } };
  async function carregar(pid) {
    const [a, t, r] = await Promise.all([SB.from("andamentos").select("*").eq("processo_id", pid).order("data", { ascending: false }), SB.from("v_tarefas").select("*").eq("processo_id", pid).order("prazo", { ascending: true, nullsFirst: false }), SB.from("v_dossie").select("*").eq("processo_id", pid).order("quando", { ascending: false }).limit(100)]);
    C.ands[pid] = a.data || []; C.tarefas[pid] = t.data || []; C.regs[pid] = r.data || []; render();
  }
  function ficha(p, { cliente = null, recarregar = () => {} } = {}) {
    if (v3()) return fichaV3(p, { cliente, recarregar });
    const pid = p.id; if (!C.ands[pid]) { C.ands[pid] = null; carregar(pid); }
    const ands = C.ands[pid] || [], tarefas = C.tarefas[pid] || [];
    const abertas = tarefas.filter((t) => t.status === "aberta" || t.status === "em_andamento"), prazos = abertas.filter((t) => t.prazo).sort((x, y) => x.prazo.localeCompare(y.prazo)), semPrazo = abertas.filter((t) => !t.prazo);
    const pill = (cls, txt) => el("span", { class: "pill " + cls }, txt);
    const kv = (l, v) => v == null || v === "" ? null : el("div", {}, el("b", {}, l), el("div", {}, v));
    const box = el("div", { class: "card pf", style: "padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--surface-2)" });
    // cabeçalho
    box.append(el("div", { class: "section-h" }, el("div", {}, el("div", { class: "eyebrow" }, p.cliente_id ? el("a", { href: "#clientes/" + encodeURIComponent(p.cliente_id), onclick: (ev) => { ev.preventDefault(); S.tab = "clientes"; S.sel = p.cliente_id; S.sub = "processos"; render(); } }, p.cliente_nome || cliente?.nome || "Cliente") : "Fora da base", p.pasta_codigo ? " · Pasta " + p.pasta_codigo + (p.pasta_titulo ? " — " + p.pasta_titulo : "") : ""), el("h3", { style: "font-size:17px;margin:0" }, p.numero_cnj || "(sem número)"),
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:4px" }, pill(p.status === "ativo" ? "e1" : p.status === "suspenso" ? "e2" : "g", p.status || "—"), p.fase ? pill("c", p.fase) : null, p.area ? pill("c", p.area) : null, p.polo ? pill("g", p.polo === "ativo" ? "polo ativo" : "polo passivo") : null, p.relevante ? pill("e2", "relevante") : null, p.sigiloso ? pill("e3", "sigiloso") : null, (p.campos_faltando || []).length ? pill("e2", "cadastro incompleto") : null, p.visivel_cliente === false ? pill("g", "oculto do cliente") : null)),
      el("div", { class: "actions edit-only" }, el("button", { class: "btn sm primary", onclick: () => window.PP_TAREFAS?.nova({ processo_id: p.id, cliente_id: p.cliente_id || null, titulo: "", prazo_fatal: false }) }, "+ Prazo / tarefa"), el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p) }, "+ Andamento"), p.cliente_id ? el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.registrar(p.cliente_id, { processo_id: p.id, frente: "juridico" }) }, "Registrar") : null, el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.openProcessoForm(cliente || null, p) }, "Editar"),
        !cliente && p.cliente_id ? el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.abrirProcesso(p.cliente_id, p.id) }, "Abrir no cliente") : null)));
    // dados
    box.append(el("div", { class: "tf-meta", style: "margin:0" }, kv("Tipo de ação", p.tipo_acao), kv("Parte contrária", p.parte_contraria ? p.parte_contraria + (p.advogado_contrario ? " (adv. " + p.advogado_contrario + ")" : "") : null), kv("Banco", p.banco), kv("Tribunal / vara", [p.tribunal, p.vara].filter(Boolean).join(" · ") || null), kv("Comarca", p.comarca ? p.comarca + (p.uf ? "/" + p.uf : "") : null),
      kv("Valor da causa", p.valor_causa ? BRLx(p.valor_causa) : null), kv("Distribuição", p.data_distribuicao ? fmt(p.data_distribuicao) : null), kv("Rito", p.rito), kv("Assunto", p.assunto), kv("Responsável", p.responsavel_nome), kv("Risco", p.grau_risco), kv("Última atualização", p.updated_at ? fmt(p.updated_at) : null)));
    if (p.observacoes) box.append(el("div", { class: "note", style: "white-space:pre-wrap" }, p.observacoes));
    // abas internas da página do processo
    const aba = C.aba[pid] || "visao"; const ab = (k, l, n) => el("button", { class: "btn sm" + (aba === k ? " primary" : ""), onclick: () => { C.aba[pid] = k; render(); } }, l, n != null ? el("span", { class: "cnt", style: "margin-left:6px" }, String(n)) : null);
    const regs = C.regs[pid] || [];
    box.append(el("div", { class: "actions", style: "justify-content:flex-start;border-top:1px solid var(--line);padding-top:10px" }, ab("visao", "Prazos e tarefas", abertas.length || null), ab("registros", "Trabalho do escritório", regs.length || null), ab("andamentos", "Andamentos", ands.length || null), ab("publicacoes", "Publicações", p.publicacoes_pendentes ? +p.publicacoes_pendentes : null), ab("pasta", "Pasta e relacionados", p.qtd_relacionados ? +p.qtd_relacionados : null)));
    if (aba === "visao") {
      const prox = prazos[0]; const d0 = prox ? dias(prox.prazo) : null;
      const secPrazos = el("div", {}, el("div", { class: "section-h" }, el("h4", { style: "margin:0" }, "Prazos e tarefas", " ", prox ? pill(d0 < 0 ? "e3" : d0 <= 3 ? "e3" : d0 <= 7 ? "e2" : "e1", "próximo: " + fmt(prox.prazo) + (d0 < 0 ? ` · ${-d0} d atrasado` : d0 === 0 ? " · hoje" : ` · em ${d0} d`) + (prox.prazo_fatal ? " · FATAL" : "")) : pill("g", "sem prazo em aberto")), el("span", { class: "note" }, "O prazo do processo é a tarefa com prazo mais próxima. Para registrar um prazo, crie uma tarefa.")));
      if (C.ands[pid] === null) secPrazos.append(el("div", { class: "note" }, "Carregando…"));
      else if (!abertas.length) secPrazos.append(el("div", { class: "note" }, "Nenhuma tarefa aberta para este processo."));
      else secPrazos.append(el("div", { class: "tbl" }, el("table", {}, el("tbody", {}, ...[...prazos, ...semPrazo].map((t) => { const d = dias(t.prazo); return el("tr", { style: "cursor:pointer", onclick: () => window.PP_TAREFAS?.abrir(t.id) }, el("td", { style: "width:110px" }, t.prazo ? el("b", { style: d < 0 || d === 0 ? "color:var(--crit)" : "" }, fmt(t.prazo)) : el("span", { class: "note" }, "sem prazo"), t.prazo_fatal ? el("div", { class: "pill e3", style: "margin-top:2px" }, "fatal") : null), el("td", {}, t.titulo, el("div", { class: "note" }, [t.responsavel_nome, t.status === "em_andamento" ? "fazendo" : null, t.horas_apontadas > 0 ? (+t.horas_apontadas).toFixed(1).replace(".0", "") + " h" : null].filter(Boolean).join(" · "))), el("td", { class: "r note" }, d == null ? "" : d < 0 ? `${-d} d atrasada` : d === 0 ? "hoje" : `em ${d} d`)); })))));
      const concl = tarefas.filter((t) => t.status === "concluida").length; if (concl) secPrazos.append(el("div", { class: "note" }, `${concl} tarefa(s) concluída(s) neste processo — veja em “Trabalho do escritório”.`));
      box.append(secPrazos);
    }
    if (aba === "registros") {
      const FR = { estrategico: "Estratégico", juridico: "Jurídico", negocial: "Negocial" };
      box.append(el("div", {}, el("div", { class: "section-h" }, el("h4", { style: "margin:0" }, "Trabalho do escritório neste processo"), el("button", { class: "btn sm primary edit-only", onclick: () => p.cliente_id && window.PP_CARTEIRA?.registrar(p.cliente_id, { processo_id: p.id, frente: "juridico" }) }, "+ Registrar")),
        regs.length ? el("ul", { class: "tl" }, ...regs.map((i) => el("li", { class: i.origem === "registro" ? "" : "ev-sistema" }, el("div", { class: "d" }, new Date(i.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) + " · " + (i.origem === "tarefa" ? "Tarefa" : i.origem === "registro" ? "Registro" : "Negociação") + (i.autor ? " · " + i.autor : "") + (+i.anexos ? " · 📎 " + i.anexos : "")), el("div", { style: "white-space:pre-wrap;font-size:13.5px" + (i.origem === "registro" ? ";padding:6px 10px;background:var(--surface-2);border-radius:8px;margin-top:2px" : "") }, i.texto), i.tarefa_id ? el("div", { class: "actions", style: "justify-content:flex-start;margin-top:2px" }, el("button", { class: "btn sm", onclick: () => window.PP_TAREFAS?.abrir(i.tarefa_id) }, "Abrir tarefa")) : null))) : el("div", { class: "note" }, "Nenhum registro ainda. Tarefas abertas/passadas/concluídas e registros manuais deste processo aparecem aqui — e também no dossiê do cliente.")));
    }
    if (aba === "andamentos") {
      const secAnd = el("div", {}, el("div", { class: "section-h" }, el("h4", { style: "margin:0" }, `Andamentos do tribunal (${ands.length})`), el("button", { class: "btn sm edit-only", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p) }, "+ Andamento")));
      if (C.ands[pid] === null) secAnd.append(el("div", { class: "note" }, "Carregando…"));
      else if (!ands.length) secAnd.append(el("div", { class: "note" }, "Nenhum andamento registrado."));
      else secAnd.append(el("ul", { class: "tl" }, ...ands.map((a) => el("li", {}, el("div", { class: "d" }, fmt(a.data), a.tipo ? " · " + a.tipo : "", el("span", { class: "pill " + (a.visivel_cliente ? "e1" : "e2"), style: "margin-left:6px" }, a.visivel_cliente ? "Visível ao cliente" : "Interno"), a.fonte && a.fonte !== "manual" ? el("span", { class: "pill c", style: "margin-left:6px" }, a.fonte) : null), el("div", { style: "white-space:pre-wrap" }, a.descricao), el("div", { class: "actions edit-only", style: "justify-content:flex-start;margin-top:4px" }, el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p, a) }, "Editar"))))));
      box.append(secAnd);
    }
    if (aba === "publicacoes") { if (window.PP_PUB_TRAT?.secaoProcesso) window.PP_PUB_TRAT.secaoProcesso(p, box); else box.append(el("div", { class: "note" }, "Módulo de publicações não carregado.")); }
    if (aba === "pasta") { if (window.PP_PASTAS?.secaoProcesso) box.append(window.PP_PASTAS.secaoProcesso(p, () => { invalidar(pid); recarregar(); }, { semPublicacoes: true })); }
    return box;
  }
  /* ==========================================================================================================================
     V3.1 (entrega visual V8) — a MESMA ficha com os componentes do Design System. Mesmos dados (v_processos, andamentos, v_tarefas,
     v_dossie), as mesmas cinco seções e as mesmas ações da V2. Ativa só com a casca V3.1 ligada. Nada novo é gravado.
     As seções "Publicações" e "Pasta e relacionados" continuam vindo de PP_PUB_TRAT e PP_PASTAS (mesmo conteúdo, tokens da V3.1).
     ========================================================================================================================== */
  const v3 = () => document.documentElement.classList.contains("np-casca-v3") && !!window.NPUI;
  const SECOES = [["visao", "Prazos e tarefas"], ["registros", "Trabalho do escritório"], ["andamentos", "Andamentos"], ["publicacoes", "Publicações"], ["pasta", "Pasta e relacionados"]];
  async function datajud(p, b, recarregar) {
    b.disabled = true;
    try { const { error } = await SB.rpc("datajud_atualizar", { p_processo: p.id }); if (error) throw error; toast("Consulta enviada — as movimentações aparecem em alguns minutos");
      setTimeout(async () => { await SB.rpc("datajud_atualizar", { p_processo: null }).catch(() => {}); invalidar(p.id); recarregar(); if (typeof render === "function") render(); }, 20000); }
    catch (err) { toast(err.message || "Não foi possível consultar"); } finally { b.disabled = false; }
  }
  function fichaV3(p, { cliente = null, recarregar = () => {} } = {}) {
    const U = window.NPUI, m = U.marca; const pid = p.id; if (!C.ands[pid]) { C.ands[pid] = null; carregar(pid); }
    const carregandoF = C.ands[pid] === null; const ands = C.ands[pid] || [], tarefas = C.tarefas[pid] || [], regs = C.regs[pid] || [];
    const abertas = tarefas.filter((t) => t.status === "aberta" || t.status === "em_andamento"), prazos = abertas.filter((t) => t.prazo).sort((x, y) => x.prazo.localeCompare(y.prazo)), semPrazo = abertas.filter((t) => !t.prazo);
    const ro = typeof readOnly === "function" && readOnly();
    const faltam = p.campos_faltando || []; const incompleto = faltam.length ? m("cadastro incompleto", "att") : null; if (incompleto) incompleto.title = "Falta: " + faltam.join(", ");
    const marcas = [m(p.status || "—", p.status === "ativo" ? "ok" : ""), p.fase ? m(p.fase) : null, p.area ? m(p.area) : null, p.polo ? m(p.polo === "ativo" ? "polo ativo" : "polo passivo") : null, p.relevante ? m("relevante", "att") : null, p.sigiloso ? m("sigiloso", "crit") : null, incompleto, p.visivel_cliente === false ? m("oculto do cliente") : null].filter(Boolean);
    const acoes = [
      ro ? null : U.btn("Prazo ou tarefa", { variante: "pri", icone: "mais", onclick: () => window.PP_TAREFAS?.nova({ processo_id: p.id, cliente_id: p.cliente_id || null, titulo: "", prazo_fatal: false }) }),
      ro ? null : U.btn("+ Andamento", { onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p) }),
      ro || !p.cliente_id ? null : U.btn("Registrar", { title: "Registrar trabalho do escritório neste processo", onclick: () => window.PP_CARTEIRA?.registrar(p.cliente_id, { processo_id: p.id, frente: "juridico" }) }),
      ro ? null : U.btn("Editar", { onclick: () => window.PP_CARTEIRA?.openProcessoForm(cliente || null, p) }),
      !cliente && p.cliente_id ? U.btn("Abrir no cliente", { variante: "ghost", onclick: () => window.PP_CARTEIRA?.abrirProcesso(p.cliente_id, p.id) }) : null].filter(Boolean);
    const trilha = [p.cliente_id ? el("a", { href: "#clientes/" + encodeURIComponent(p.cliente_id), onclick: (ev) => { ev.preventDefault(); S.tab = "clientes"; S.sel = p.cliente_id; S.sub = "processos"; render(); } }, p.cliente_nome || cliente?.nome || "Cliente") : "Fora da base", p.pasta_codigo ? " · Pasta " + p.pasta_codigo : ""];
    const box = el("article", { class: "np-v3 np-pf", "aria-label": "Processo " + (p.numero_cnj || "sem número") });
    box.append(el("header", { class: "np-pf-cab" }, el("div", { class: "np-pf-id" }, el("p", { class: "np-pf-trilha" }, ...trilha), el("h2", { class: "np-pf-num" }, p.numero_cnj || "(sem número)"),
        (p.tipo_acao || p.parte_contraria) ? el("p", { class: "np-pf-sub" }, [p.tipo_acao, p.parte_contraria ? "× " + p.parte_contraria : null].filter(Boolean).join(" · ")) : null, el("div", { class: "np-pf-marcas" }, ...marcas)),
      acoes.length ? el("div", { class: "np-pf-acoes" }, ...acoes) : null));
    const pares = [["Tipo de ação", p.tipo_acao], ["Parte contrária", p.parte_contraria ? p.parte_contraria + (p.advogado_contrario ? " (adv. " + p.advogado_contrario + ")" : "") : null], ["Banco", p.banco], ["Tribunal / vara", [p.tribunal, p.vara].filter(Boolean).join(" · ") || null], ["Comarca", p.comarca ? p.comarca + (p.uf ? "/" + p.uf : "") : null],
      ["Valor da causa", p.valor_causa ? BRLx(p.valor_causa) : null], ["Distribuição", p.data_distribuicao ? fmt(p.data_distribuicao) : null], ["Rito", p.rito], ["Assunto", p.assunto], ["Responsável", p.responsavel_nome ? U.quem(p.responsavel_nome) : el("span", { class: "np-sem" }, "— ninguém —")], ["Risco", p.grau_risco], ["Última atualização", p.updated_at ? fmt(p.updated_at) : null]].filter((x) => x[1] != null && x[1] !== "");
    const meio = Math.ceil(pares.length / 2);
    box.append(el("div", { class: "np-pf-dados" }, U.props(pares.slice(0, meio)), pares.length > meio ? U.props(pares.slice(meio)) : null));
    if (p.observacoes) box.append(U.secao("Observações", el("p", { style: "white-space:pre-wrap" }, p.observacoes)));
    const bDJ = U.btn("Atualizar andamentos", { title: "Busca as movimentações do processo. A consulta automática roda uma vez por dia.", onclick: (e) => datajud(p, e.currentTarget, recarregar) });
    box.append(U.secao("Atualização automática", el("p", { class: "np-nota" }, p.datajud_erro ? [m("erro na última consulta", "att"), " ", p.datajud_erro] : p.datajud_atualizado_em ? "Movimentações atualizadas em " + new Date(p.datajud_atualizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + "." : "Ainda sem consulta registrada para este processo."), ro || !p.numero_cnj ? null : bDJ));
    // seções (as mesmas cinco abas da V2)
    const aba = C.aba[pid] || "visao"; const cont = { visao: abertas.length, registros: regs.length, andamentos: ands.length, publicacoes: +p.publicacoes_pendentes || 0, pasta: +p.qtd_relacionados || 0 };
    const seg = U.seg(SECOES.map(([k, l]) => [k, l + (cont[k] ? " · " + cont[k] : "")]), aba, (k) => { C.aba[pid] = k; render(); }, "Seções do processo");
    box.append(el("div", { class: "np-pf-abas" }, seg));
    const corpo = el("div", { class: "np-pf-secao", "data-secao": aba }); box.append(corpo);
    const quando = (q) => new Date(q).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    const cabSec = (titulo, ...dir) => el("div", { class: "np-pf-sec-h" }, el("h3", {}, titulo), el("div", { class: "np-pf-sec-a" }, ...dir.filter(Boolean)));
    if (aba === "visao") {
      const prox = prazos[0]; const d0 = prox ? dias(prox.prazo) : null;
      corpo.append(cabSec("Prazos e tarefas", prox ? m("próximo: " + fmt(prox.prazo) + (d0 < 0 ? ` · ${-d0} d atrasado` : d0 === 0 ? " · hoje" : ` · em ${d0} d`) + (prox.prazo_fatal ? " · fatal" : ""), d0 <= 3 ? "crit" : d0 <= 7 ? "att" : "ok") : m("sem prazo em aberto")));
      corpo.append(el("p", { class: "np-nota" }, "O prazo do processo é a tarefa com prazo mais próxima. Para registrar um prazo, crie uma tarefa."));
      if (carregandoF) corpo.append(U.carregando(3));
      else if (!abertas.length) corpo.append(U.vazio({ titulo: "Nenhuma tarefa aberta", texto: "Não há prazo nem tarefa em aberto para este processo.", acao: ro ? null : "Criar prazo ou tarefa", onAcao: () => window.PP_TAREFAS?.nova({ processo_id: p.id, cliente_id: p.cliente_id || null, titulo: "", prazo_fatal: false }) }));
      else corpo.append(el("ul", { class: "np-lst", role: "list" }, [...prazos, ...semPrazo].map((t) => { const d = dias(t.prazo); const pz = t.prazo ? U.prazoTxt(t.prazo, t.hora) : null;
        return U.linha({ id: t.id, regua: d == null ? null : d < 0 ? "late" : t.prazo_fatal && d <= 7 ? "fatal" : d <= 7 ? "att" : null, prazo: pz ? { curta: pz.curta, hora: pz.hora, exata: pz.exata, rel: t.prazo_fatal ? [el("b", {}, "fatal"), " · ", pz.rel] : pz.rel, tom: d < 0 ? "late" : t.prazo_fatal && d <= 7 ? "crit" : "" } : null,
          titulo: t.titulo, contexto: [t.status === "em_andamento" ? "fazendo" : null, t.horas_apontadas > 0 ? (+t.horas_apontadas).toFixed(1).replace(".0", "").replace(".", ",") + " h apontadas" : null].filter(Boolean).join(" · ") || null,
          direita: [t.prazo_fatal ? (() => { const k = m("fatal", "crit"); k.classList.add("np-so-largo"); return k; })() : null, t.responsavel_nome ? U.quem(t.responsavel_nome) : el("span", { class: "np-sem" }, "— ninguém —")], titleAbrir: "Abrir a tarefa", onOpen: () => window.PP_TAREFAS?.abrir(t.id) }); })));
      const concl = tarefas.filter((t) => t.status === "concluida").length; if (concl) corpo.append(el("p", { class: "np-nota" }, `${concl} tarefa(s) concluída(s) neste processo — veja em “Trabalho do escritório”.`));
    }
    if (aba === "registros") {
      corpo.append(cabSec("Trabalho do escritório neste processo", ro || !p.cliente_id ? null : U.btn("Registrar", { icone: "mais", onclick: () => window.PP_CARTEIRA?.registrar(p.cliente_id, { processo_id: p.id, frente: "juridico" }) })));
      if (carregandoF) corpo.append(U.carregando(3));
      else if (!regs.length) corpo.append(U.vazio({ titulo: "Nenhum registro ainda", texto: "Tarefas abertas, passadas e concluídas e os registros manuais deste processo aparecem aqui — e também no dossiê do cliente." }));
      else corpo.append(U.passos(regs.map((i) => ({ estado: i.origem === "registro" ? "ok" : "", el: el("span", {}, el("b", {}, quando(i.quando)), " · " + (i.origem === "tarefa" ? "Tarefa" : i.origem === "registro" ? "Registro" : "Negociação") + (i.autor ? " · " + i.autor : "") + (+i.anexos ? " · " + i.anexos + " anexo(s)" : "")),
        sub: [el("span", { style: "white-space:pre-wrap" }, i.texto || ""), i.tarefa_id ? el("button", { type: "button", class: "np-link", onclick: () => window.PP_TAREFAS?.abrir(i.tarefa_id) }, "Abrir tarefa") : null].filter(Boolean) }))));
    }
    if (aba === "andamentos") {
      corpo.append(cabSec(`Andamentos do tribunal${carregandoF ? "" : " (" + ands.length + ")"}`, ro ? null : U.btn("Andamento", { icone: "mais", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p) })));
      if (carregandoF) corpo.append(U.carregando(3));
      else if (!ands.length) corpo.append(U.vazio({ titulo: "Nenhum andamento registrado", texto: "Os andamentos chegam sozinhos ou são incluídos à mão.", acao: ro ? null : "Incluir andamento", onAcao: () => window.PP_CARTEIRA?.openAndamentoForm(p) }));
      else corpo.append(U.passos(ands.map((a) => ({ estado: "ok", el: el("span", {}, el("b", {}, fmt(a.data)), a.tipo ? " · " + a.tipo : "", " ", m(a.visivel_cliente ? "visível ao cliente" : "interno", a.visivel_cliente ? "ok" : ""), a.fonte && a.fonte !== "manual" ? [" ", m("automático", "info")] : null),
        sub: [el("span", { style: "white-space:pre-wrap" }, a.descricao || ""), ro ? null : el("button", { type: "button", class: "np-link", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p, a) }, "Editar")].filter(Boolean) }))));
    }
    if (aba === "publicacoes") { corpo.append(cabSec("Publicações deste processo")); const h = el("div", { class: "np-pf-legado" }); corpo.append(h); if (window.PP_PUB_TRAT?.secaoProcesso) window.PP_PUB_TRAT.secaoProcesso(p, h); else h.append(el("p", { class: "np-nota" }, "Módulo de publicações não carregado.")); }
    if (aba === "pasta") { corpo.append(cabSec("Pasta e processos relacionados")); const h = el("div", { class: "np-pf-legado" }); corpo.append(h); if (window.PP_PASTAS?.secaoProcesso) h.append(window.PP_PASTAS.secaoProcesso(p, () => { invalidar(pid); recarregar(); }, { semPublicacoes: true })); else h.append(el("p", { class: "np-nota" }, "Módulo de pastas não carregado.")); }
    return box;
  }
  window.PP_PROCESSO = { ficha, invalidar };
  window.__PP_LOGIN?.then(() => { if (typeof equipe === "function" && equipe()) { const ch = SB.channel("processo-ficha"); ch.on("postgres_changes", { event: "*", schema: "public", table: "andamentos" }, (m) => { invalidar(m.new?.processo_id || m.old?.processo_id); render(); }); ch.on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, (m) => { const pid = m.new?.processo_id || m.old?.processo_id; if (pid) { invalidar(pid); render(); } }); ch.on("postgres_changes", { event: "*", schema: "public", table: "entradas_timeline" }, (m) => { const pid = m.new?.processo_id || m.old?.processo_id; if (pid) { invalidar(pid); render(); } }); ch.on("postgres_changes", { event: "*", schema: "public", table: "tarefa_eventos" }, () => { C.regs = {}; }); ch.subscribe(); } });
})();
