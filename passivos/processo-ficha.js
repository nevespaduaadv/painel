/* Ficha única do processo — usada pela lista geral (Jurídico → Processos) e pela ficha do cliente (sub-aba Processos).
   Uma só tela: cabeçalho, dados, PRAZOS (= tarefas abertas com prazo deste processo), pasta/relacionados/publicações
   (PP_PASTAS.secaoProcesso) e andamentos. Ações: Editar, + Andamento, + Tarefa/prazo, Abrir no cliente.
   Supabase: v_tarefas (processo_id), andamentos. Só equipe. */
(() => {
  "use strict";
  const C = { ands: {}, tarefas: {} };
  const fmt = (s) => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const BRLx = (v) => v == null || isNaN(v) ? "—" : (+v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const dias = (iso) => { if (!iso) return null; const a = new Date(iso.slice(0, 10) + "T12:00:00"), h = new Date(); h.setHours(12, 0, 0, 0); return Math.round((a - h) / 864e5); };
  const invalidar = (pid) => { if (pid) { delete C.ands[pid]; delete C.tarefas[pid]; } else { C.ands = {}; C.tarefas = {}; } };
  async function carregar(pid) {
    const [a, t] = await Promise.all([SB.from("andamentos").select("*").eq("processo_id", pid).order("data", { ascending: false }), SB.from("v_tarefas").select("*").eq("processo_id", pid).order("prazo", { ascending: true, nullsFirst: false })]);
    C.ands[pid] = a.data || []; C.tarefas[pid] = t.data || []; render();
  }
  function ficha(p, { cliente = null, recarregar = () => {} } = {}) {
    const pid = p.id; if (!C.ands[pid]) { C.ands[pid] = null; carregar(pid); }
    const ands = C.ands[pid] || [], tarefas = C.tarefas[pid] || [];
    const abertas = tarefas.filter((t) => t.status === "aberta" || t.status === "em_andamento"), prazos = abertas.filter((t) => t.prazo).sort((x, y) => x.prazo.localeCompare(y.prazo)), semPrazo = abertas.filter((t) => !t.prazo);
    const pill = (cls, txt) => el("span", { class: "pill " + cls }, txt);
    const kv = (l, v) => v == null || v === "" ? null : el("div", {}, el("b", {}, l), el("div", {}, v));
    const box = el("div", { class: "card pf", style: "padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--surface-2)" });
    // cabeçalho
    box.append(el("div", { class: "section-h" }, el("div", {}, el("div", { class: "eyebrow" }, [p.cliente_nome || (cliente ? cliente.nome : null) || "Fora da base", p.pasta_codigo ? "Pasta " + p.pasta_codigo : null].filter(Boolean).join(" · ")), el("h3", { style: "font-size:17px;margin:0" }, p.numero_cnj || "(sem número)"),
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:4px" }, pill(p.status === "ativo" ? "e1" : p.status === "suspenso" ? "e2" : "g", p.status || "—"), p.fase ? pill("c", p.fase) : null, p.area ? pill("c", p.area) : null, p.polo ? pill("g", p.polo === "ativo" ? "polo ativo" : "polo passivo") : null, p.relevante ? pill("e2", "relevante") : null, p.sigiloso ? pill("e3", "sigiloso") : null, (p.campos_faltando || []).length ? pill("e2", "cadastro incompleto") : null, p.visivel_cliente === false ? pill("g", "oculto do cliente") : null)),
      el("div", { class: "actions edit-only" }, el("button", { class: "btn sm primary", onclick: () => window.PP_TAREFAS?.nova({ processo_id: p.id, cliente_id: p.cliente_id || null, titulo: "", prazo_fatal: false }) }, "+ Prazo / tarefa"), el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p) }, "+ Andamento"), el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.openProcessoForm(cliente || null, p) }, "Editar"),
        !cliente && p.cliente_id ? el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.abrirProcesso(p.cliente_id, p.id) }, "Abrir no cliente") : null)));
    // dados
    box.append(el("div", { class: "tf-meta", style: "margin:0" }, kv("Tipo de ação", p.tipo_acao), kv("Parte contrária", p.parte_contraria ? p.parte_contraria + (p.advogado_contrario ? " (adv. " + p.advogado_contrario + ")" : "") : null), kv("Banco", p.banco), kv("Tribunal / vara", [p.tribunal, p.vara].filter(Boolean).join(" · ") || null), kv("Comarca", p.comarca ? p.comarca + (p.uf ? "/" + p.uf : "") : null),
      kv("Valor da causa", p.valor_causa ? BRLx(p.valor_causa) : null), kv("Distribuição", p.data_distribuicao ? fmt(p.data_distribuicao) : null), kv("Rito", p.rito), kv("Assunto", p.assunto), kv("Responsável", p.responsavel_nome), kv("Risco", p.grau_risco), kv("Última atualização", p.updated_at ? fmt(p.updated_at) : null)));
    if (p.observacoes) box.append(el("div", { class: "note", style: "white-space:pre-wrap" }, p.observacoes));
    // prazos = tarefas
    const prox = prazos[0]; const d0 = prox ? dias(prox.prazo) : null;
    const secPrazos = el("div", {}, el("div", { class: "section-h" }, el("h4", { style: "margin:0" }, "Prazos e tarefas", " ", prox ? pill(d0 < 0 ? "e3" : d0 <= 3 ? "e3" : d0 <= 7 ? "e2" : "e1", "próximo: " + fmt(prox.prazo) + (d0 < 0 ? ` · ${-d0} d atrasado` : d0 === 0 ? " · hoje" : ` · em ${d0} d`) + (prox.prazo_fatal ? " · FATAL" : "")) : pill("g", "sem prazo em aberto")), el("span", { class: "note" }, "O prazo do processo é a tarefa com prazo mais próxima. Para registrar um prazo, crie uma tarefa.")));
    if (C.ands[pid] === null) secPrazos.append(el("div", { class: "note" }, "Carregando…"));
    else if (!abertas.length) secPrazos.append(el("div", { class: "note" }, "Nenhuma tarefa aberta para este processo."));
    else secPrazos.append(el("div", { class: "tbl" }, el("table", {}, el("tbody", {}, ...[...prazos, ...semPrazo].map((t) => { const d = dias(t.prazo); return el("tr", { style: "cursor:pointer", onclick: () => window.PP_TAREFAS?.abrir(t.id) }, el("td", { style: "width:110px" }, t.prazo ? el("b", { style: d < 0 || d === 0 ? "color:var(--crit)" : "" }, fmt(t.prazo)) : el("span", { class: "note" }, "sem prazo"), t.prazo_fatal ? el("div", { class: "pill e3", style: "margin-top:2px" }, "fatal") : null), el("td", {}, t.titulo, el("div", { class: "note" }, [t.responsavel_nome, t.status === "em_andamento" ? "em andamento" : null, t.horas_apontadas > 0 ? (+t.horas_apontadas).toFixed(1).replace(".0", "") + " h" : null].filter(Boolean).join(" · "))), el("td", { class: "r note" }, d == null ? "" : d < 0 ? `${-d} d atrasada` : d === 0 ? "hoje" : `em ${d} d`)); })))));
    const concl = tarefas.filter((t) => t.status === "concluida").length; if (concl) secPrazos.append(el("div", { class: "note" }, `${concl} tarefa(s) concluída(s) neste processo — veja em Tarefas.`));
    box.append(secPrazos);
    // pasta / relacionados / publicações
    if (window.PP_PASTAS?.secaoProcesso) box.append(window.PP_PASTAS.secaoProcesso(p, () => { invalidar(pid); recarregar(); }));
    // andamentos
    const secAnd = el("div", {}, el("div", { class: "section-h" }, el("h4", { style: "margin:0" }, `Andamentos (${ands.length})`), el("button", { class: "btn sm edit-only", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p) }, "+ Andamento")));
    if (C.ands[pid] === null) secAnd.append(el("div", { class: "note" }, "Carregando…"));
    else if (!ands.length) secAnd.append(el("div", { class: "note" }, "Nenhum andamento registrado."));
    else secAnd.append(el("ul", { class: "tl" }, ...ands.map((a) => el("li", {}, el("div", { class: "d" }, fmt(a.data), a.tipo ? " · " + a.tipo : "", el("span", { class: "pill " + (a.visivel_cliente ? "e1" : "e2"), style: "margin-left:6px" }, a.visivel_cliente ? "Visível ao cliente" : "Interno"), a.fonte && a.fonte !== "manual" ? el("span", { class: "pill c", style: "margin-left:6px" }, a.fonte) : null), el("div", { style: "white-space:pre-wrap" }, a.descricao), el("div", { class: "actions edit-only", style: "justify-content:flex-start;margin-top:4px" }, el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.openAndamentoForm(p, a) }, "Editar"))))));
    box.append(secAnd);
    return box;
  }
  window.PP_PROCESSO = { ficha, invalidar };
  window.__PP_LOGIN?.then(() => { if (typeof equipe === "function" && equipe()) { const ch = SB.channel("processo-ficha"); ch.on("postgres_changes", { event: "*", schema: "public", table: "andamentos" }, (m) => { invalidar(m.new?.processo_id || m.old?.processo_id); render(); }); ch.on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, (m) => { const pid = m.new?.processo_id || m.old?.processo_id; if (pid) { invalidar(pid); render(); } }); ch.subscribe(); } });
})();
