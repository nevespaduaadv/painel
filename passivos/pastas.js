/* Pastas, campos obrigatórios e processos relacionados — bloco 1 da controladoria (beta 0002).
   - Cada processo tem uma pasta sequencial (automática ao cadastrar); processos relacionados podem dividir a mesma pasta.
   - Campos obrigatórios do cadastro são configurados pelo admin (processo_campos_obrigatorios); o formulário bloqueia o
     salvamento incompleto e a lista mostra o que falta em cada processo.
   - Jurídico → Processos ganha as abas Pastas e Configurações; a ficha do processo ganha "Pasta e processos relacionados".
   Supabase: pastas, v_pastas, areas_processo, processo_campos_obrigatorios, processo_relacoes, v_processo_relacoes,
   rpc processo_relacionar; v_processos (pasta_numero, campos_faltando, qtd_relacionados). Só equipe. */
(() => {
  "use strict";
  const PA = { ok: false, areas: [], campos: [], pastas: [], pastasOk: false, porCliente: {}, rel: {}, relDe: null, aba: "processos", fPasta: { q: "", status: "ativa" } };
  const admin = () => PP.perfil?.papel === "admin";
  const TIPOS_PASTA = { judicial: "Judicial", extrajudicial: "Extrajudicial", consultivo: "Consultivo" };
  const TIPOS_REL = { cumprimento_sentenca: "Cumprimento de sentença", recurso: "Recurso", execucao: "Execução", embargos: "Embargos", incidente: "Incidente", cautelar: "Cautelar / tutela", conexo: "Processo conexo", outro: "Outro" };
  // código "AAAA-NNNN" (beta 0003); aceita o número da pasta ou a linha (com pasta_codigo/codigo)
  const COD = {};
  const pastaTxt = (n) => { if (!n) return "—"; if (typeof n === "object") { const c = n.pasta_codigo || n.codigo; if (c) COD[n.pasta_numero || n.numero] = c; return c ? "Pasta " + c : pastaTxt(n.pasta_numero || n.numero); } return "Pasta " + (COD[n] || String(n).padStart(5, "0")); };
  const fmt = (iso) => iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR") : "—";

  async function carregarCfg() {
    const [a, c] = await Promise.all([SB.from("areas_processo").select("*").order("ordem"), SB.from("processo_campos_obrigatorios").select("*").order("ordem")]);
    PA.areas = a.data || []; PA.campos = c.data || []; PA.ok = true;
  }
  async function carregarPastas() { const { data } = await SB.from("v_pastas").select("*").order("numero", { ascending: false }); PA.pastas = data || []; PA.pastasOk = true; for (const x of PA.pastas) if (x.codigo) COD[x.numero] = x.codigo; render(); }
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
    const pastaOpts = { "": p.id ? pastaTxt(p) + " (atual)" : "Nova pasta (número automático)" };
    for (const x of outros) pastaOpts[String(x.pasta_numero)] = pastaTxt(x) + " — mesma de " + (x.numero_cnj || x.tipo_acao || "processo");
    const pasta = sel(pastaOpts, "");
    if (c?.id) pastasDoCliente(c.id).then((ps) => { for (const x of ps) if (x.status === "ativa" && !pastaOpts[String(x.numero)] && x.numero !== p.pasta_numero) pasta.append(el("option", { value: String(x.numero) }, pastaTxt(x) + " — " + (x.titulo || TIPOS_PASTA[x.tipo] || "pasta") + (+x.qtd_processos ? "" : " (sem processo)"))); });
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
      el("div", { class: "section-h" }, el("div", {}, el("div", { class: "eyebrow" }, "Arquivo"), el("h3", { style: "font-size:16px" }, pastaTxt(p), p.pasta_titulo ? el("span", { class: "note" }, " · " + p.pasta_titulo) : null)),
        el("div", { class: "actions edit-only" }, el("button", { class: "btn sm", onclick: () => modalRelacionar(p, recarregar) }, "Relacionar processo…"))),
      falta.length ? el("div", { class: "pill e2", style: "align-self:flex-start" }, "Cadastro incompleto: " + falta.join(", ")) : el("div", { class: "pill e1", style: "align-self:flex-start" }, "Cadastro completo"),
      el("div", { class: "note" }, [p.area ? "Área: " + p.area : null, p.data_distribuicao ? "Distribuído em " + fmt(p.data_distribuicao) : null, p.rito ? "Rito: " + p.rito : null, p.relevante ? "⭐ relevante" : null, p.sigiloso ? "🔒 sigiloso" : null].filter(Boolean).join(" · ") || "Sem dados de cabeçalho."),
      el("h4", { style: "margin:4px 0 0" }, `Processos relacionados (${rel.length})`),
      rel.length ? el("ul", { class: "tl" }, rel.map((r) => el("li", {}, el("div", { class: "d" }, (r.sentido === "derivado" ? "↳ " : "↰ ") + (TIPOS_REL[r.tipo] || r.tipo) + (r.sentido === "originario" ? " (este é derivado dele)" : "")),
        el("div", {}, el("a", { href: "#processos/" + r.relacionado_id, onclick: (ev) => { ev.preventDefault(); window.PP_PROCESSOS?.abrir(r.relacionado_id); } }, r.numero_cnj || r.tipo_acao || "(sem número)"), el("span", { class: "note" }, " · " + [r.tipo_acao, r.fase, pastaTxt(r)].filter(Boolean).join(" · "))),
        r.observacao ? el("div", { class: "note" }, r.observacao) : null,
        el("div", { class: "actions edit-only", style: "justify-content:flex-start;margin-top:2px" }, el("button", { class: "btn sm", onclick: async () => { if (!confirm("Desfazer este relacionamento? (a pasta não muda)")) return; await SB.from("processo_relacoes").delete().eq("id", r.id); delete PA.rel[p.id]; recarregar?.(); carregarRel(p.id); } }, "Desfazer"))))) : el("div", { class: "note" }, "Nenhum. Use “Relacionar processo…” para vincular cumprimento de sentença, recurso, embargos etc."));
    if (window.PP_PUB_TRAT?.secaoProcesso) { const wrap = el("div", { style: "display:contents" }, box); window.PP_PUB_TRAT.secaoProcesso(p, wrap); return wrap; }
    return box;
  }
  function modalRelacionar(p, recarregar) {
    const busca = inp("search", ""); busca.placeholder = "Nº CNJ, tipo de ação ou cliente…";
    const lista = el("div", { style: "display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto;margin-top:6px" });
    let escolhido = null; const escolhidoTxt = el("div", { class: "note" }, "Escolha o processo a relacionar.");
    const todos = window.PP_PROCESSOS?.lista?.() || [];
    const desenhar = () => { const q = busca.value.trim().toLowerCase(); const cand = todos.filter((x) => x.id !== p.id && (!q || [x.numero_cnj, x.tipo_acao, x.cliente_nome, x.parte_contraria].join(" ").toLowerCase().includes(q))).slice(0, 30);
      lista.replaceChildren(...cand.map((x) => el("button", { class: "btn sm" + (escolhido === x.id ? " primary" : ""), style: "text-align:left", onclick: () => { escolhido = x.id; escolhidoTxt.textContent = "Relacionar com: " + (x.numero_cnj || x.tipo_acao) + " · " + (x.cliente_nome || "fora da base") + " · " + pastaTxt(x); desenhar(); } }, (x.numero_cnj || "(sem número)") + " — " + [x.tipo_acao, x.cliente_nome].filter(Boolean).join(" · ")))); };
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

  // ---------- pastas do cliente (card no topo da sub-aba Processos do cliente) ----------
  async function pastasDoCliente(cid, forcar) {
    if (!forcar && PA.porCliente[cid]) return PA.porCliente[cid];
    const { data } = await SB.from("v_pastas").select("*").eq("cliente_id", cid).order("numero", { ascending: false }); PA.porCliente[cid] = data || []; return PA.porCliente[cid];
  }
  function modalAbrirPasta(c) {
    const titulo = inp("text", "", { placeholder: "Ex.: Itaú — negociação do capital de giro" }), tipo = sel({ extrajudicial: "Extrajudicial (negociação / gestão de passivos)", consultivo: "Consultivo" }, "extrajudicial"), descr = inp("text", "", { placeholder: "Opcional" });
    const ks = (S.contratos || []).filter((k) => k.clienteId === c.id && !k.pasta_numero); const caixas = ks.map((k) => { const i = el("input", { type: "checkbox", style: "width:15px;height:15px;margin:0;accent-color:var(--gold)" }); return { k, i, lab: el("label", { style: "display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer" }, i, (typeof shortName === "function" ? shortName(k) : k.banco || k.id) + (k.saldoAtual != null ? " · " + BRL(k.saldoAtual) : "")) }; });
    modal("Abrir pasta para " + c.nome, el("div", { class: "form" }, el("div", { class: "f full note" }, "Pasta sem processo judicial — recebe o próximo número do ano. Se depois surgir um processo, é só cadastrá-lo escolhendo esta pasta."), field("ap-t", "Título", titulo), field("ap-tp", "Tipo", tipo), el("div", { class: "f full" }, field("ap-d", "Descrição", descr)),
      caixas.length ? el("div", { class: "f full" }, el("label", {}, "Contratos bancários desta pasta"), el("div", { style: "display:flex;flex-direction:column;gap:4px;margin-top:4px" }, ...caixas.map((x) => x.lab))) : null), async () => {
      const { data, error } = await SB.rpc("pasta_abrir", { p_cliente: c.id, p_titulo: titulo.value.trim() || null, p_tipo: tipo.value, p_descricao: descr.value.trim() || null }); if (error) throw new Error(error.message);
      const ids = caixas.filter((x) => x.i.checked).map((x) => x.k.id); if (ids.length) { const { error: e2 } = await SB.rpc("pasta_vincular_contratos", { p_pasta: data.numero, p_contratos: ids }); if (e2) throw new Error(e2.message); for (const k of ks) if (ids.includes(k.id)) k.pasta_numero = data.numero; }
      toast("Pasta " + (data.codigo || data.numero) + " aberta"); PA.pastasOk = false; delete PA.porCliente[c.id]; render();
    });
    const btn = $("#modalHost button.btn.primary"); if (btn) btn.textContent = "Abrir pasta";
  }
  function modalContratosPasta(c, pa) {
    const ks = (S.contratos || []).filter((k) => k.clienteId === c.id); if (!ks.length) { toast("Este cliente não tem contratos cadastrados"); return; }
    const caixas = ks.map((k) => { const i = el("input", { type: "checkbox", style: "width:15px;height:15px;margin:0;accent-color:var(--gold)" }); i.checked = k.pasta_numero === pa.numero; const outra = k.pasta_numero && k.pasta_numero !== pa.numero; return { k, i, lab: el("label", { style: "display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer" }, i, (typeof shortName === "function" ? shortName(k) : k.banco || k.id), outra ? el("span", { class: "note" }, " (hoje na pasta " + pastaTxt(k.pasta_numero) + ")") : null) }; });
    modal("Contratos da " + pastaTxt(pa), el("div", { class: "form" }, el("div", { class: "f full note" }, "Marque os contratos bancários que pertencem a esta pasta. Desmarcar tira o contrato da pasta."), el("div", { class: "f full", style: "display:flex;flex-direction:column;gap:4px" }, ...caixas.map((x) => x.lab))), async () => {
      const entra = caixas.filter((x) => x.i.checked).map((x) => x.k.id), sai = caixas.filter((x) => !x.i.checked && x.k.pasta_numero === pa.numero).map((x) => x.k.id);
      if (entra.length) { const { error } = await SB.rpc("pasta_vincular_contratos", { p_pasta: pa.numero, p_contratos: entra }); if (error) throw new Error(error.message); }
      if (sai.length) { const { error } = await SB.rpc("pasta_vincular_contratos", { p_pasta: null, p_contratos: sai }); if (error) throw new Error(error.message); }
      for (const x of caixas) x.k.pasta_numero = x.i.checked ? pa.numero : (sai.includes(x.k.id) ? null : x.k.pasta_numero);
      toast("Contratos atualizados"); PA.pastasOk = false; delete PA.porCliente[c.id]; render();
    });
  }
  function cardPastasCliente(c) {
    const box = el("div", { class: "card", style: "padding:12px 14px;display:flex;flex-direction:column;gap:6px" });
    const ps = PA.porCliente[c.id]; if (!ps) { pastasDoCliente(c.id).then(() => render()); box.append(el("div", { class: "section-h" }, el("h3", { style: "margin:0;font-size:15px" }, "Pastas"), el("span", { class: "note" }, "carregando…"))); return box; }
    box.append(el("div", { class: "section-h" }, el("div", {}, el("div", { class: "eyebrow" }, "Arquivo"), el("h3", { style: "margin:0;font-size:15px" }, `Pastas do cliente (${ps.length})`)), el("div", { class: "actions edit-only" }, el("button", { class: "btn sm", onclick: () => modalAbrirPasta(c) }, "+ Abrir pasta sem processo"))));
    if (!ps.length) box.append(el("div", { class: "note" }, "Nenhuma pasta ainda. Processos cadastrados abrem a pasta sozinhos; para um caso só extrajudicial ou consultivo, abra a pasta aqui."));
    else box.append(el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Pasta"), el("th", {}, "Título"), el("th", {}, "Tipo"), el("th", {}, "Conteúdo"), el("th", {}, "Status"), el("th", {}, ""))),
      el("tbody", {}, ...ps.map((pa) => el("tr", {}, el("td", {}, el("b", {}, pastaTxt(pa))), el("td", {}, pa.titulo || "—", pa.descricao ? el("div", { class: "note" }, pa.descricao) : null), el("td", {}, el("span", { class: "pill " + (pa.tipo === "judicial" ? "c" : "e2") }, TIPOS_PASTA[pa.tipo] || pa.tipo)),
        el("td", {}, +pa.qtd_processos ? el("div", {}, pa.qtd_processos + " processo(s)", el("div", { class: "note" }, (pa.processos_txt || "").slice(0, 80))) : null, +pa.qtd_contratos ? el("div", {}, pa.qtd_contratos + " contrato(s)", el("div", { class: "note" }, (pa.contratos_txt || "").slice(0, 80))) : null, !+pa.qtd_processos && !+pa.qtd_contratos ? el("span", { class: "note" }, "vazia") : null),
        el("td", {}, el("span", { class: "pill " + (pa.status === "ativa" ? "e1" : "g") }, pa.status)), el("td", {}, el("div", { class: "edit-only", style: "display:flex;gap:4px" }, el("button", { class: "btn sm", onclick: () => modalContratosPasta(c, pa) }, "Contratos…"), el("button", { class: "btn sm", onclick: () => modalPasta(pa) }, "Editar")))))))));
    return box;
  }
  { const _p = window.PP_MOD?.processos; if (_p) window.PP_MOD.processos = (c, host) => { _p(c, host); if (typeof equipe === "function" && equipe()) host.prepend(cardPastasCliente(c)); }; }

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
    const lista = PA.pastas.filter((p) => (!f.status || p.status === f.status) && (!ql || [String(p.numero).padStart(5, "0"), p.codigo, p.titulo, p.cliente_nome, p.processos_txt, p.contratos_txt].join(" ").toLowerCase().includes(ql)));
    const card = el("div", { class: "card" }, el("div", { class: "tbl-tools" }, q, st, el("div", { class: "sp" }), el("span", { class: "note" }, `${lista.length} de ${PA.pastas.length}`)));
    card.append(tabela({ cols: [
      { label: "Pasta", r: (p) => el("b", {}, pastaTxt(p)) },
      { label: "Título / cliente", r: (p) => el("div", {}, p.titulo || "—", p.cliente_nome ? el("div", { class: "note" }, p.cliente_nome) : null) },
      { label: "Tipo", r: (p) => el("span", { class: "pill " + (p.tipo === "judicial" ? "c" : "e2") }, TIPOS_PASTA[p.tipo] || p.tipo || "—") },
      { label: "Processos / contratos", r: (p) => el("div", {}, +p.qtd_processos ? String(p.qtd_processos) + " processo(s)" + (p.qtd_ativos !== p.qtd_processos ? ` (${p.qtd_ativos} ativos)` : "") : "", +p.qtd_processos ? el("div", { class: "note" }, (p.processos_txt || "").slice(0, 90)) : null, +p.qtd_contratos ? el("div", {}, p.qtd_contratos + " contrato(s): ", el("span", { class: "note" }, (p.contratos_txt || "").slice(0, 90))) : null, !+p.qtd_processos && !+p.qtd_contratos ? el("span", { class: "note" }, "vazia") : null) },
      { label: "Abertura", r: (p) => fmt(p.aberta_em) },
      { label: "Status", r: (p) => el("span", { class: "pill " + (p.status === "ativa" ? "e1" : "g") }, p.status + (p.encerrada_em ? " · " + fmt(p.encerrada_em) : "")) },
      { label: "Arquivo físico", r: (p) => p.caixa_arquivo || "—" }],
      rows: lista, vazio: "Nenhuma pasta.", acts: (p) => [btnIco("editar", "Editar pasta", () => modalPasta(p))] }));
    v.append(card);
  }
  function modalPasta(p) {
    const titulo = inp("text", p.titulo || ""), tipo = sel(TIPOS_PASTA, p.tipo || "judicial"), descr = inp("text", p.descricao || "", { placeholder: "Resumo do caso (opcional)" }), status = sel({ ativa: "Ativa", encerrada: "Encerrada" }, p.status), enc = inp("date", p.encerrada_em || ""), tipoEnc = inp("text", p.tipo_encerramento || "", { placeholder: "Ex.: arquivamento, acordo, baixa" }), caixa = inp("text", p.caixa_arquivo || "", { placeholder: "Ex.: Caixa 12 / arquivo morto" }), obs = el("textarea", {}, p.observacoes || "");
    modal(pastaTxt(p), el("div", { class: "form" }, field("pa-t", "Título", titulo), field("pa-tp", "Tipo", tipo), el("div", { class: "f full" }, field("pa-d", "Descrição", descr)), field("pa-s", "Status", status), field("pa-e", "Encerrada em", enc), field("pa-te", "Tipo de encerramento", tipoEnc), field("pa-c", "Localização física", caixa), field("pa-o", "Observações", obs)), async () => {
      const { error } = await SB.from("pastas").update({ titulo: titulo.value.trim() || null, tipo: tipo.value, descricao: descr.value.trim() || null, status: status.value, encerrada_em: status.value === "encerrada" ? (enc.value || new Date().toISOString().slice(0, 10)) : null, tipo_encerramento: tipoEnc.value.trim() || null, caixa_arquivo: caixa.value.trim() || null, observacoes: obs.value.trim() || null, updated_at: new Date().toISOString() }).eq("numero", p.numero);
      if (error) throw new Error(error.message); toast("Pasta salva"); PA.pastasOk = false; delete PA.porCliente[p.cliente_id]; carregarPastas();
    });
  }
  function renderConfig(v) {
    const campos = el("div", { class: "card section" }, el("h2", {}, "Campos obrigatórios do processo"), el("div", { class: "note" }, "Os campos marcados bloqueiam o salvamento do processo quando vazios e aparecem como “cadastro incompleto” na lista e no relatório."),
      el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px;margin-top:8px" }, ...PA.campos.map((c) => el("label", { class: "switch" }, el("input", { type: "checkbox", checked: c.obrigatorio ? "" : null, onchange: async (ev) => { const { error } = await SB.from("processo_campos_obrigatorios").update({ obrigatorio: ev.target.checked }).eq("campo", c.campo); if (error) toast(error.message); else { c.obrigatorio = ev.target.checked; toast("Salvo"); window.PP_PROCESSOS?.recarregar?.(); } } }), " " + c.rotulo))));
    const novaArea = inp("text", "", { placeholder: "Nova área…" });
    const areas = el("div", { class: "card section" }, el("h2", {}, "Áreas"), el("div", { class: "note" }, "Lista de áreas do processo (ex.: Bancário PJ, Trabalhista, Tributário). Desative em vez de excluir."),
      el("div", { style: "display:flex;flex-direction:column;gap:4px;margin-top:8px" }, ...PA.areas.map((a) => el("div", { style: "display:flex;gap:8px;align-items:center" }, el("label", { class: "switch", style: "flex:1" }, el("input", { type: "checkbox", checked: a.ativa ? "" : null, onchange: async (ev) => { await SB.from("areas_processo").update({ ativa: ev.target.checked }).eq("id", a.id); a.ativa = ev.target.checked; } }), " " + a.nome)))),
      el("div", { class: "actions", style: "justify-content:flex-start;margin-top:8px" }, novaArea, el("button", { class: "btn sm", onclick: async () => { const n = novaArea.value.trim(); if (!n) return; const { error } = await SB.from("areas_processo").insert({ nome: n, ordem: PA.areas.length + 1 }); if (error) { toast(error.message); return; } await carregarCfg(); render(); } }, "+ Adicionar")));
    const prazo = inp("number", "", { min: 0, max: 10, style: "width:80px" }), prazoBox = el("div", { class: "card section" }, el("h2", {}, "Publicações — prazo para tratar"), el("div", { class: "note" }, "Dias úteis, contados da disponibilização no DJEN, para a publicação receber uma providência. Define a tempestividade no relatório."),
      el("div", { class: "actions", style: "justify-content:flex-start;margin-top:8px" }, prazo, el("span", { class: "note" }, "dia(s) útil(eis)"), el("button", { class: "btn sm", onclick: async () => { const { error } = await SB.from("controladoria_config").upsert({ chave: "publicacao_prazo_dias_uteis", valor: String(Math.max(0, +prazo.value || 0)) }); toast(error ? error.message : "Salvo — vale para as próximas publicações"); } }, "Salvar")));
    SB.from("controladoria_config").select("valor").eq("chave", "publicacao_prazo_dias_uteis").maybeSingle().then(({ data }) => { prazo.value = data?.valor ?? "1"; });
    v.append(campos, areas, prazoBox);
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
