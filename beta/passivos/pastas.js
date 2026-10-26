/* Pastas, campos obrigatórios e processos relacionados — bloco 1 da controladoria (beta 0002).
   - Cada processo tem uma pasta sequencial (automática ao cadastrar); processos relacionados podem dividir a mesma pasta.
   - Campos obrigatórios do cadastro são configurados pelo admin (processo_campos_obrigatorios); o formulário bloqueia o
     salvamento incompleto e a lista mostra o que falta em cada processo.
   - Jurídico → Processos ganha as abas Pastas e Configurações; a ficha do processo ganha "Pasta e processos relacionados".
   Supabase: pastas, v_pastas, areas_processo, processo_campos_obrigatorios, processo_relacoes, v_processo_relacoes,
   rpc processo_relacionar; v_processos (pasta_numero, campos_faltando, qtd_relacionados). Só equipe. */
(() => {
  "use strict";
  const PA = { ok: false, areas: [], campos: [], pastas: [], pastasOk: false, rel: {}, relDe: null, aba: "processos", fPasta: { q: "", status: "ativa" } };
  const admin = () => PP.perfil?.papel === "admin";
  const TIPOS_REL = { cumprimento_sentenca: "Cumprimento de sentença", recurso: "Recurso", execucao: "Execução", embargos: "Embargos", incidente: "Incidente", cautelar: "Cautelar / tutela", conexo: "Processo conexo", outro: "Outro" };
  const pastaTxt = (n) => n ? "Pasta " + String(n).padStart(5, "0") : "—";
  const fmt = (iso) => iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—";

  async function carregarCfg() {
    const [a, c] = await Promise.all([SB.from("areas_processo").select("*").order("ordem"), SB.from("processo_campos_obrigatorios").select("*").order("ordem")]);
    PA.areas = a.data || []; PA.campos = c.data || []; PA.ok = true;
  }
  async function carregarPastas() { const { data } = await SB.from("v_pastas").select("*").order("numero", { ascending: false }); PA.pastas = data || []; PA.pastasOk = true; render(); }
  async function carregarRel(pid) { const { data } = await SB.from("v_processo_relacoes").select("*").eq("processo_id", pid).order("created_at"); PA.rel[pid] = data || []; PA.relDe = pid; render(); }
  const faltando = (row) => PA.campos.filter((c) => c.obrigatorio && (row[c.campo] == null || String(row[c.campo]).trim() === "")).map((c) => c.rotulo);

  // ---------- campos extras do formulário de processo (chamado por carteira.js) ----------
  function camposForm(p, c) {
    const area = sel({ "": "— escolha —", ...Object.fromEntries(PA.areas.filter((a) => a.ativa || a.nome === p.area).map((a) => [a.nome, a.nome])) }, p.area || "");
    const dist = inp("date", p.data_distribuicao || ""), rito = inp("text", p.rito || "", { placeholder: "Ex.: comum, execução, JEC" }), assunto = inp("text", p.assunto || ""), advc = inp("text", p.advogado_contrario || "");
    const risco = sel({ "": "—", alto: "Alto", medio: "Médio", baixo: "Baixo" }, p.grau_risco || "");
    const relevante = el("input", { type: "checkbox", checked: p.relevante ? "" : null }), sigiloso = el("input", { type: "checkbox", checked: p.sigiloso ? "" : null });
    // pasta: nova (automática) ou a mesma de outro processo do cliente
    const outros = (window.PP_CARTEIRA?.processosDoCliente?.(c?.id) || []).filter((x) => x.id !== p.id && x.pasta_numero);
    const pastaOpts = { "": p.id ? pastaTxt(p.pasta_numero) + " (atual)" : "Nova pasta (número automático)" };
    for (const x of outros) pastaOpts[String(x.pasta_numero)] = pastaTxt(x.pasta_numero) + " — mesma de " + (x.numero_cnj || x.tipo_acao || "processo");
    const pasta = sel(pastaOpts, "");
    const wrap = el("div", { class: "form", style: "grid-column:1/-1;border-top:1px dashed var(--line);padding-top:10px;margin-top:4px" },
      field("p-area", "Área", area), field("p-dist", "Data de distribuição", dist), field("p-rito", "Rito", rito), field("p-assunto", "Assunto", assunto),
      field("p-advc", "Advogado da parte contrária", advc), field("p-risco", "Grau de risco (interno)", risco),
      field("p-pasta", "Pasta", pasta, p.id ? "Processos relacionados (cumprimento, recurso…) ficam na mesma pasta do originário." : "Deixe em “Nova pasta” para um processo independente."),
      el("div", { class: "f", style: "display:flex;gap:16px;align-items:center" }, el("label", { class: "switch" }, relevante, " Processo relevante"), el("label", { class: "switch" }, sigiloso, " Sigiloso")));
    return { wrap, valores: () => ({ area: area.value || null, data_distribuicao: dist.value || null, rito: rito.value.trim() || null, assunto: assunto.value.trim() || null, advogado_contrario: advc.value.trim() || null, grau_risco: risco.value || null, relevante: relevante.checked, sigiloso: sigiloso.checked, ...(pasta.value ? { pasta_numero: +pasta.value } : {}) }) };
  }
  function validar(row) {
    const f = faltando(row);
    if (f.length) throw new Error("Cadastro incompleto — preencha: " + f.join(", "));
  }

  // ---------- seção "Pasta e processos relacionados" (ficha do processo) ----------
  function secaoProcesso(p, recarregar) {
    if (PA.relDe !== p.id && !PA.rel[p.id]) carregarRel(p.id);
    const rel = PA.rel[p.id] || [];
    const falta = p.campos_faltando || faltando(p);
    const box = el("div", { class: "card", style: "padding:12px 14px;display:flex;flex-direction:column;gap:8px" },
      el("div", { class: "section-h" }, el("div", {}, el("div", { class: "eyebrow" }, "Arquivo"), el("h3", { style: "font-size:16px" }, pastaTxt(p.pasta_numero), p.pasta_titulo ? el("span", { class: "note" }, " · " + p.pasta_titulo) : null)),
        el("div", { class: "actions edit-only" }, el("button", { class: "btn sm", onclick: () => modalRelacionar(p, recarregar) }, "Relacionar processo…"))),
      falta.length ? el("div", { class: "pill e2", style: "align-self:flex-start" }, "Cadastro incompleto: " + falta.join(", ")) : el("div", { class: "pill e1", style: "align-self:flex-start" }, "Cadastro completo"),
      el("div", { class: "note" }, [p.area ? "Área: " + p.area : null, p.data_distribuicao ? "Distribuído em " + fmt(p.data_distribuicao) : null, p.rito ? "Rito: " + p.rito : null, p.relevante ? "⭐ relevante" : null, p.sigiloso ? "🔒 sigiloso" : null].filter(Boolean).join(" · ") || "Sem dados de cabeçalho."),
      el("h4", { style: "margin:4px 0 0" }, `Processos relacionados (${rel.length})`),
      rel.length ? el("ul", { class: "tl" }, rel.map((r) => el("li", {}, el("div", { class: "d" }, (r.sentido === "derivado" ? "↳ " : "↰ ") + (TIPOS_REL[r.tipo] || r.tipo) + (r.sentido === "originario" ? " (este é derivado dele)" : "")),
        el("div", {}, el("a", { href: "#processos/" + r.relacionado_id, onclick: (ev) => { ev.preventDefault(); window.PP_PROCESSOS?.abrir(r.relacionado_id); } }, r.numero_cnj || r.tipo_acao || "(sem número)"), el("span", { class: "note" }, " · " + [r.tipo_acao, r.fase, pastaTxt(r.pasta_numero)].filter(Boolean).join(" · "))),
        r.observacao ? el("div", { class: "note" }, r.observacao) : null,
        el("div", { class: "actions edit-only", style: "justify-content:flex-start;margin-top:2px" }, el("button", { class: "btn sm", onclick: async () => { if (!confirm("Desfazer este relacionamento? (a pasta não muda)")) return; await SB.from("processo_relacoes").delete().eq("id", r.id); delete PA.rel[p.id]; recarregar?.(); carregarRel(p.id); } }, "Desfazer"))))) : el("div", { class: "note" }, "Nenhum. Use “Relacionar processo…” para vincular cumprimento de sentença, recurso, embargos etc."));
    return box;
  }
  function modalRelacionar(p, recarregar) {
    const busca = inp("search", ""); busca.placeholder = "Nº CNJ, tipo de ação ou cliente…";
    const lista = el("div", { style: "display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto;margin-top:6px" });
    let escolhido = null; const escolhidoTxt = el("div", { class: "note" }, "Escolha o processo a relacionar.");
    const todos = window.PP_PROCESSOS?.lista?.() || [];
    const desenhar = () => { const q = busca.value.trim().toLowerCase(); const cand = todos.filter((x) => x.id !== p.id && (!q || [x.numero_cnj, x.tipo_acao, x.cliente_nome, x.parte_contraria].join(" ").toLowerCase().includes(q))).slice(0, 30);
      lista.replaceChildren(...cand.map((x) => el("button", { class: "btn sm" + (escolhido === x.id ? " primary" : ""), style: "text-align:left", onclick: () => { escolhido = x.id; escolhidoTxt.textContent = "Relacionar com: " + (x.numero_cnj || x.tipo_acao) + " · " + (x.cliente_nome || "fora da base") + " · " + pastaTxt(x.pasta_numero); desenhar(); } }, (x.numero_cnj || "(sem número)") + " — " + [x.tipo_acao, x.cliente_nome].filter(Boolean).join(" · ")))); };
    busca.oninput = desenhar; desenhar();
    const tipo = sel(TIPOS_REL, "cumprimento_sentenca"), sentido = sel({ derivado: "O processo escolhido deriva deste (este é o originário)", originario: "Este processo deriva do escolhido (o escolhido é o originário)" }, "derivado");
    const mesma = el("input", { type: "checkbox", checked: "" }), obs = inp("text", "");
    modal("Relacionar processo", el("div", {}, field("rel-busca", "Processo", busca), lista, escolhidoTxt, el("div", { class: "grid2", style: "margin-top:8px" }, field("rel-tipo", "Tipo de relação", tipo), field("rel-sentido", "Sentido", sentido)), field("rel-obs", "Observação (opcional)", obs), el("label", { class: "switch" }, mesma, " Unificar na mesma pasta do originário")),
      async () => {
        if (!escolhido) throw new Error("Escolha o processo");
        const principal = sentido.value === "derivado" ? p.id : escolhido, derivado = sentido.value === "derivado" ? escolhido : p.id;
        const { error } = await SB.rpc("processo_relacionar", { p_principal: principal, p_relacionado: derivado, p_tipo: tipo.value, p_mesma_pasta: mesma.checked, p_obs: obs.value.trim() || null });
        if (error) throw new Error(error.message);
        toast("Processos relacionados"); delete PA.rel[p.id]; delete PA.rel[escolhido]; PA.pastasOk = false; window.PP_PROCESSOS?.recarregar?.(); recarregar?.();
      });
  }

  // ---------- abas em Jurídico → Processos: Pastas e Configurações ----------
  function abas() {
    const b = (k, l) => el("button", { class: "btn sm" + (PA.aba === k ? " primary" : ""), onclick: () => { PA.aba = k; if (k === "pastas" && !PA.pastasOk) carregarPastas(); render(); } }, l);
    return el("div", { class: "actions", style: "justify-content:flex-start;margin:-6px 0 10px" }, b("processos", "Processos"), b("pastas", "Pastas"), admin() ? b("config", "Configurações") : null);
  }
  function renderPastas(v) {
    if (!PA.pastasOk) { carregarPastas(); v.append(el("div", { class: "note" }, "Carregando pastas…")); return; }
    const f = PA.fPasta; const q = inp("search", f.q); q.placeholder = "Nº da pasta, cliente, processo…"; q.oninput = () => { f.q = q.value; render(); const b = $("#pa-q"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }; q.id = "pa-q";
    const st = sel({ ativa: "Ativas", encerrada: "Encerradas", "": "Todas" }, f.status); st.onchange = () => { f.status = st.value; render(); };
    const ql = f.q.trim().toLowerCase();
    const lista = PA.pastas.filter((p) => (!f.status || p.status === f.status) && (!ql || [String(p.numero).padStart(5, "0"), p.titulo, p.cliente_nome, p.processos_txt].join(" ").toLowerCase().includes(ql)));
    const card = el("div", { class: "card" }, el("div", { class: "tbl-tools" }, q, st, el("div", { class: "sp" }), el("span", { class: "note" }, `${lista.length} de ${PA.pastas.length}`)));
    card.append(tabela({ cols: [
      { label: "Pasta", r: (p) => el("b", {}, pastaTxt(p.numero)) },
      { label: "Título / cliente", r: (p) => el("div", {}, p.titulo || "—", p.cliente_nome ? el("div", { class: "note" }, p.cliente_nome) : null) },
      { label: "Processos", r: (p) => el("div", {}, String(p.qtd_processos) + (p.qtd_ativos !== p.qtd_processos ? ` (${p.qtd_ativos} ativos)` : ""), el("div", { class: "note" }, (p.processos_txt || "").slice(0, 90))) },
      { label: "Abertura", r: (p) => fmt(p.aberta_em) },
      { label: "Status", r: (p) => el("span", { class: "pill " + (p.status === "ativa" ? "e1" : "g") }, p.status + (p.encerrada_em ? " · " + fmt(p.encerrada_em) : "")) },
      { label: "Arquivo físico", r: (p) => p.caixa_arquivo || "—" }],
      rows: lista, vazio: "Nenhuma pasta.", acts: (p) => [btnIco("editar", "Editar pasta", () => modalPasta(p))] }));
    v.append(card);
  }
  function modalPasta(p) {
    const titulo = inp("text", p.titulo || ""), status = sel({ ativa: "Ativa", encerrada: "Encerrada" }, p.status), enc = inp("date", p.encerrada_em || ""), tipoEnc = inp("text", p.tipo_encerramento || "", { placeholder: "Ex.: arquivamento, acordo, baixa" }), caixa = inp("text", p.caixa_arquivo || "", { placeholder: "Ex.: Caixa 12 / arquivo morto" }), obs = el("textarea", {}, p.observacoes || "");
    modal("Pasta " + String(p.numero).padStart(5, "0"), el("div", { class: "form" }, field("pa-t", "Título", titulo), field("pa-s", "Status", status), field("pa-e", "Encerrada em", enc), field("pa-te", "Tipo de encerramento", tipoEnc), field("pa-c", "Localização física", caixa), field("pa-o", "Observações", obs)), async () => {
      const { error } = await SB.from("pastas").update({ titulo: titulo.value.trim() || null, status: status.value, encerrada_em: status.value === "encerrada" ? (enc.value || new Date().toISOString().slice(0, 10)) : null, tipo_encerramento: tipoEnc.value.trim() || null, caixa_arquivo: caixa.value.trim() || null, observacoes: obs.value.trim() || null, updated_at: new Date().toISOString() }).eq("numero", p.numero);
      if (error) throw new Error(error.message); toast("Pasta salva"); PA.pastasOk = false; carregarPastas();
    });
  }
  function renderConfig(v) {
    const campos = el("div", { class: "card section" }, el("h2", {}, "Campos obrigatórios do processo"), el("div", { class: "note" }, "Os campos marcados bloqueiam o salvamento do processo quando vazios e aparecem como “cadastro incompleto” na lista e no relatório."),
      el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px;margin-top:8px" }, ...PA.campos.map((c) => el("label", { class: "switch" }, el("input", { type: "checkbox", checked: c.obrigatorio ? "" : null, onchange: async (ev) => { const { error } = await SB.from("processo_campos_obrigatorios").update({ obrigatorio: ev.target.checked }).eq("campo", c.campo); if (error) toast(error.message); else { c.obrigatorio = ev.target.checked; toast("Salvo"); window.PP_PROCESSOS?.recarregar?.(); } } }), " " + c.rotulo))));
    const novaArea = inp("text", "", { placeholder: "Nova área…" });
    const areas = el("div", { class: "card section" }, el("h2", {}, "Áreas"), el("div", { class: "note" }, "Lista de áreas do processo (ex.: Bancário PJ, Trabalhista, Tributário). Desative em vez de excluir."),
      el("div", { style: "display:flex;flex-direction:column;gap:4px;margin-top:8px" }, ...PA.areas.map((a) => el("div", { style: "display:flex;gap:8px;align-items:center" }, el("label", { class: "switch", style: "flex:1" }, el("input", { type: "checkbox", checked: a.ativa ? "" : null, onchange: async (ev) => { await SB.from("areas_processo").update({ ativa: ev.target.checked }).eq("id", a.id); a.ativa = ev.target.checked; } }), " " + a.nome)))),
      el("div", { class: "actions", style: "justify-content:flex-start;margin-top:8px" }, novaArea, el("button", { class: "btn sm", onclick: async () => { const n = novaArea.value.trim(); if (!n) return; const { error } = await SB.from("areas_processo").insert({ nome: n, ordem: PA.areas.length + 1 }); if (error) { toast(error.message); return; } await carregarCfg(); render(); } }, "+ Adicionar")));
    v.append(campos, areas);
  }

  // ---------- integração com processos.js (abas + colunas) ----------
  { const _r = render; render = function () { _r(); const v = $("#view-processos"); if (!v || v.hidden || !PA.ok) return;
      const head = v.querySelector(".head"); if (!head) return;
      head.after(abas());
      if (PA.aba !== "processos") { [...v.children].forEach((ch, i) => { if (i > 1) ch.remove(); }); if (PA.aba === "pastas") renderPastas(v); else renderConfig(v); }
    }; }
  window.PP_PASTAS = { camposForm, validar, secaoProcesso, pastaTxt, faltando, cfg: () => PA, invalidar: () => { PA.pastasOk = false; } };
  window.__PP_LOGIN?.then(() => { if (typeof equipe === "function" && equipe()) carregarCfg().then(() => { if (S.tab === "processos") render(); }); });
})();
