/* Automações (Comercial → Automações) — construtor visual de fluxos de trabalho (0077).
   Lista de fluxos (pastas, status, inscrições) e construtor: acionadores + passos em cadeia com condição sim/não,
   painel lateral para editar cada passo, abas Construtor / Configurações / Histórico de inscrições / Registros de execução,
   testar com um lead e publicar. Supabase: fluxos_mensagens (definicao jsonb), v_fluxos_mensagens, v_fluxo_execucoes;
   rpcs fluxo_testar, fluxo_execucao_cancelar. */
(() => {
  "use strict";
  const A = { ok: false, carregando: false, lista: [], fases: [], tags: [], abaLista: "todos", busca: "", pastasAbertas: new Set(), sel: null, dirty: false, abaB: "construtor", painel: null, execs: [], execsOk: false };
  const podeCom = () => PP.perfil?.papel === "admin" || (PP.perfil?.acessos || []).includes("comercial");
  const fmtDH = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const uid = () => "n" + Math.random().toString(36).slice(2, 8);
  const GATILHOS = {
    entrou_na_fase: { t: "Lead entra na etapa", i: "⇢", desc: (c) => "Etapa: " + (A.fases.find((f) => f.id === +c.fase_id)?.nome || "—") },
    novo_lead: { t: "Lead novo criado", i: "✦", desc: (c) => c.origens?.length ? "Origens: " + c.origens.join(", ") : "Qualquer origem" },
    tag_adicionada: { t: "Tag adicionada", i: "🏷", desc: (c) => `Tag inclui "${c.tag || "—"}"` },
    lead_respondeu: { t: "Lead respondeu no WhatsApp", i: "💬", desc: () => "Qualquer mensagem recebida" },
    reuniao_marcada: { t: "Reunião marcada", i: "📅", desc: () => "Passos contam a partir da reunião" },
    parado_na_etapa: { t: "Lead parado na etapa", i: "⏳", desc: (c) => `${c.dias || 3} dia(s) sem mudar` + (c.fase_id ? " em " + (A.fases.find((f) => f.id === +c.fase_id)?.nome || "") : " (qualquer etapa)") },
    manual: { t: "Manual (pela ficha do lead)", i: "✋", desc: () => "Iniciado pela equipe" },
  };
  const PASSOS = {
    esperar: { t: "Esperar", i: "⏱", cor: "#5b5fc7", desc: (c) => c.relativo === "reuniao" ? esperaTxt(c.minutos, true) : c.relativo === "horario" ? `${c.dias || 1} dia(s) útil(eis) depois, às ${c.hora || "09:00"}` : esperaTxt(c.minutos, false) },
    mensagem: { t: "Enviar WhatsApp", i: "💬", cor: "#1b8245", desc: (c) => (c.texto || "(sem texto)").slice(0, 90) },
    tarefa: { t: "Criar tarefa", i: "☑", cor: "#b8964a", desc: (c) => c.titulo || "(sem título)" },
    etapa: { t: "Mudar etapa", i: "⇢", cor: "#2a78d6", desc: (c) => "→ " + (A.fases.find((f) => f.id === +c.fase_id)?.nome || "—") },
    tag: { t: "Tag", i: "🏷", cor: "#6b4e82", desc: (c) => (c.acao === "remover" ? "Remover " : "Adicionar ") + `"${c.tag || "—"}"` },
    condicao: { t: "Condição (se / senão)", i: "⑂", cor: "#9c5a12", desc: (c) => c.rotulo || condTxt(c) },
    notificar: { t: "Avisar responsável", i: "🔔", cor: "#2f6690", desc: (c) => c.titulo || "Aviso interno" },
    parar: { t: "Encerrar fluxo", i: "■", cor: "#6b7280", desc: () => "Fim" },
  };
  const COND = { respondeu: "O lead respondeu depois que o fluxo começou", etapa: "O lead está em uma destas etapas", status: "Status do lead é", tag: "O lead tem a tag", reuniao: "Há reunião marcada (futura)", proprietario: "O lead tem proprietário" };
  const condTxt = (c) => c.tipo === "etapa" ? "Está em: " + (c.fases || []).map((id) => A.fases.find((f) => f.id === +id)?.nome || id).join(", ") : c.tipo === "status" ? "Status = " + (c.status || "Aberto") : c.tipo === "tag" ? `Tem a tag "${c.tag || ""}"` : COND[c.tipo] || "Condição";
  const esperaTxt = (min, reuniao) => { const a = Math.abs(min || 0); const [n, u] = a % 1440 === 0 && a ? [a / 1440, "dia(s)"] : a % 60 === 0 && a ? [a / 60, "hora(s)"] : [a, "min"]; return reuniao ? (min < 0 ? `${n} ${u} antes da reunião` : min > 0 ? `${n} ${u} depois da reunião` : "na hora da reunião") : (a ? `${n} ${u}` : "sem espera"); };

  // ---------- dados ----------
  async function carregar() {
    if (A.carregando) return; A.carregando = true;
    try {
      const [f, fa, tg] = await Promise.all([SB.from("v_fluxos_mensagens").select("*").order("pasta", { nullsFirst: false }).order("nome"), SB.from("fases").select("id,nome,ordem").order("ordem"), SB.from("tags").select("nome").order("nome")]);
      if (f.error) throw f.error; A.lista = f.data || []; A.fases = fa.data || []; A.tags = (tg.data || []).map((t) => t.nome); A.ok = true;
    } catch (e) { toast("Não foi possível carregar as automações: " + e.message); }
    finally { A.carregando = false; }
    renderAuto();
  }
  const invalidar = () => { A.ok = false; renderAuto(); };
  async function carregarExecs(id) { const { data } = await SB.from("v_fluxo_execucoes").select("*").eq("fluxo_id", id).order("created_at", { ascending: false }).limit(300); A.execs = data || []; A.execsOk = true; renderAuto(); }

  // ---------- compilação da árvore para o motor ----------
  function compilar(def) {
    const nos = {};
    const walk = (lista, depois) => { for (let i = 0; i < lista.length; i++) { const n = lista[i], next = lista[i + 1]?.id ?? depois; const o = { id: n.id, tipo: n.tipo, config: n.config || {}, next: n.tipo === "parar" ? null : next }; if (n.tipo === "condicao") { o.sim = walk(n.sim || [], next); o.nao = walk(n.nao || [], next); if (!o.sim) o.sim = next; if (!o.nao) o.nao = next; } nos[n.id] = o; } return lista[0]?.id ?? null; };
    const inicio = walk(def.passos || [], null);
    return { ...def, nos, inicio };
  }

  // ---------- render ----------
  function renderAuto() {
    const v = $("#view-automacoes"); if (!v) return;
    v.replaceChildren();
    if (!A.ok) { if (!A.carregando) carregar(); v.append(el("div", { class: "note" }, "Carregando…")); return; }
    if (A.sel) renderBuilder(v); else renderLista(v);
  }
  function renderLista(v) {
    v.append(el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Comercial"), el("h1", {}, "Automações"), el("div", { class: "sub" }, "Fluxos de trabalho: acionadores + passos (mensagens de WhatsApp pelo ChatGuru, esperas, tarefas, etapas, tags e condições). Publique para valer para os leads.")),
      el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => { const n = prompt("Nome da pasta:"); if (n && n.trim()) { A.pastasNovas = [...(A.pastasNovas || []), n.trim()]; renderAuto(); } } }, "Criar pasta"), el("button", { class: "btn primary", onclick: () => novo() }, "+ Criar fluxo de trabalho"))));
    const q = inp("search", A.busca, { placeholder: "Pesquisar…" }); q.oninput = () => { A.busca = q.value; renderAuto(); q.focus(); };
    v.append(el("div", { class: "tabs", style: "margin-bottom:10px" }, [["todos", "Todos os fluxos"], ["publicados", "Publicados"], ["rascunhos", "Rascunhos"]].map(([k, t]) => el("button", { class: "tab", "aria-selected": String(A.abaLista === k), onclick: () => { A.abaLista = k; renderAuto(); } }, t))), el("div", { class: "filters", style: "margin-bottom:10px" }, q));
    const lista = A.lista.filter((f) => (A.abaLista === "todos" || (A.abaLista === "publicados") === !!f.ativo) && (!A.busca || (f.nome || "").toLowerCase().includes(A.busca.toLowerCase())));
    const pastas = [...new Set([...(A.pastasNovas || []), ...lista.map((f) => f.pasta).filter(Boolean)])].sort();
    const linha = (f) => el("tr", { style: "cursor:pointer", onclick: () => abrir(f.id) }, el("td", {}, el("b", {}, f.nome), f.descricao ? el("div", { class: "note" }, f.descricao) : null), el("td", {}, el("span", { class: "pill " + (f.ativo ? "e1" : "c") }, f.ativo ? "Publicado" : "Rascunho")), el("td", { class: "num" }, String(f.execucoes)), el("td", { class: "num" }, String(f.ativas)), el("td", { class: "note" }, fmtDH(f.updated_at)), el("td", { class: "note" }, fmtDH(f.created_at)), el("td", {}, "›"));
    const tb = el("tbody", {});
    for (const p of pastas) { const dentro = lista.filter((f) => f.pasta === p); const aberta = A.pastasAbertas.has(p); tb.append(el("tr", { style: "cursor:pointer;background:var(--surface-2)", onclick: () => { aberta ? A.pastasAbertas.delete(p) : A.pastasAbertas.add(p); renderAuto(); } }, el("td", { colspan: "7" }, `${aberta ? "▾" : "▸"} 📁 ${p}`, el("span", { class: "note" }, ` · ${dentro.length} fluxo(s)`)))); if (aberta) dentro.forEach((f) => tb.append(linha(f))); }
    lista.filter((f) => !f.pasta).forEach((f) => tb.append(linha(f)));
    if (!tb.childElementCount) tb.append(el("tr", {}, el("td", { colspan: "7", class: "note" }, "Nenhum fluxo ainda. Clique em \"Criar fluxo de trabalho\".")));
    v.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Nome", "Status", "Total de inscritos", "Ativos", "Atualizado em", "Criado em", ""].map((h) => el("th", {}, h)))), tb)));
  }
  function novo() { A.sel = { id: null, nome: "Novo fluxo", descricao: "", pasta: "", ativo: false, parar_ao_responder: true, parar_ao_mudar_fase: true, definicao: { gatilhos: [], passos: [] } }; A.dirty = true; A.abaB = "construtor"; A.painel = null; A.execs = []; A.execsOk = false; location.hash = "#automacoes/novo"; renderAuto(); }
  function abrir(id) { const f = A.lista.find((x) => x.id === id); if (!f) return; A.sel = { ...f, definicao: { gatilhos: [], passos: [], ...(f.definicao || {}) } }; A.dirty = false; A.abaB = "construtor"; A.painel = null; A.execs = []; A.execsOk = false; location.hash = "#automacoes/" + id; renderAuto(); }
  function fechar() { if (A.dirty && !confirm("Há alterações não salvas. Sair mesmo assim?")) return; A.sel = null; location.hash = "#automacoes"; invalidar(); }
  async function salvar(publicar) {
    const f = A.sel; if (!f.nome.trim()) { toast("Dê um nome ao fluxo"); return false; }
    const def = compilar(f.definicao);
    const g0 = def.gatilhos[0] || { tipo: "manual", config: {} };
    const reg = { nome: f.nome.trim(), descricao: f.descricao || null, pasta: f.pasta || null, ativo: publicar == null ? !!f.ativo : !!publicar, parar_ao_responder: !!f.parar_ao_responder, parar_ao_mudar_fase: !!f.parar_ao_mudar_fase,
      gatilho: ["entrou_na_fase", "novo_lead", "reuniao_marcada", "manual"].includes(g0.tipo) ? g0.tipo : "manual", fase_id: g0.tipo === "entrou_na_fase" ? +g0.config.fase_id || null : null, origens: g0.tipo === "novo_lead" && g0.config.origens?.length ? g0.config.origens : null, definicao: def, versao: 2, updated_at: new Date().toISOString() };
    if (reg.ativo && !def.inicio) { toast("Adicione pelo menos um passo antes de publicar"); return false; }
    if (reg.ativo && !def.gatilhos.length) { toast("Adicione pelo menos um acionador antes de publicar"); return false; }
    let r;
    if (f.id) r = await SB.from("fluxos_mensagens").update(reg).eq("id", f.id).select("id").single(); else r = await SB.from("fluxos_mensagens").insert(reg).select("id").single();
    if (r.error) { toast(r.error.message); return false; }
    f.id = r.data.id; f.ativo = reg.ativo; f.definicao = def; A.dirty = false; location.hash = "#automacoes/" + f.id; toast(publicar ? "Fluxo publicado" : publicar === false ? "Fluxo despublicado (rascunho)" : "Fluxo salvo"); renderAuto(); return true;
  }

  // ---------- construtor ----------
  function renderBuilder(v) {
    const f = A.sel;
    const nome = inp("text", f.nome, { style: "font-size:18px;font-weight:700;border:none;background:transparent;min-width:280px" }); nome.oninput = () => { f.nome = nome.value; A.dirty = true; };
    const toggle = el("label", { style: "display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer" }, el("span", { class: "note" }, "Rascunho"), (() => { const c = el("input", { type: "checkbox", checked: f.ativo ? "" : null, style: "width:18px;height:18px;accent-color:var(--gold)" }); c.onchange = async () => { const ok = await salvar(c.checked); if (!ok) c.checked = !c.checked; }; return c; })(), el("span", {}, "Publicar"));
    v.append(el("div", { class: "head", style: "align-items:center" }, el("div", { style: "display:flex;align-items:center;gap:10px" }, el("button", { class: "btn", onclick: fechar }, "← Lista de fluxos"), nome, el("span", { class: "pill " + (f.ativo ? "e1" : "c") }, f.ativo ? "Publicado" : "Rascunho")),
      el("div", { class: "actions", style: "align-items:center" }, el("button", { class: "btn", onclick: testar }, "Testar fluxo de trabalho"), toggle, el("button", { class: "btn primary", onclick: () => salvar() }, A.dirty ? "Salvar" : "Salvo"))));
    v.append(el("div", { class: "tabs", style: "margin-bottom:12px" }, [["construtor", "Construtor"], ["config", "Configurações"], ["inscricoes", `Histórico de inscrições`], ["registros", "Registros de execução"]].map(([k, t]) => el("button", { class: "tab", "aria-selected": String(A.abaB === k), onclick: () => { A.abaB = k; if ((k === "inscricoes" || k === "registros") && f.id && !A.execsOk) carregarExecs(f.id); renderAuto(); } }, t))));
    if (A.abaB === "construtor") renderCanvas(v);
    else if (A.abaB === "config") renderConfig(v);
    else if (A.abaB === "inscricoes") renderInscricoes(v);
    else renderRegistros(v);
  }
  function renderCanvas(v) {
    const f = A.sel, def = f.definicao;
    const wrap = el("div", { class: "au-wrap" });
    const canvas = el("div", { class: "au-canvas" });
    // acionadores
    const trig = el("div", { class: "au-trigs" });
    for (const g of def.gatilhos) { const G = GATILHOS[g.tipo] || { t: g.tipo, i: "•", desc: () => "" }; trig.append(el("div", { class: "au-node au-trig" + (A.painel?.id === g.id ? " sel" : ""), onclick: () => { A.painel = { kind: "gatilho", id: g.id }; renderAuto(); } }, el("div", { class: "au-ic", style: "background:#0c1f38" }, G.i), el("div", { class: "au-body" }, el("div", { class: "au-t" }, G.t), el("div", { class: "au-d" }, G.desc(g.config || {}))), el("button", { class: "au-x", title: "Remover", onclick: (e) => { e.stopPropagation(); def.gatilhos = def.gatilhos.filter((x) => x.id !== g.id); A.dirty = true; A.painel = null; renderAuto(); } }, "×"))); }
    trig.append(el("button", { class: "au-add-trig", onclick: () => { A.painel = { kind: "novo_gatilho" }; renderAuto(); } }, "+ Adicionar novo acionador"));
    canvas.append(trig, el("div", { class: "au-line" }));
    canvas.append(renderLista_(def.passos, null));
    wrap.append(canvas, renderPainel());
    v.append(wrap);
  }
  // lista de passos (recursiva) — lista: array; dono: {lista} onde inserir
  function renderLista_(lista, fimLabel) {
    const col = el("div", { class: "au-col" });
    col.append(botaoMais(lista, 0));
    lista.forEach((n, i) => {
      const P = PASSOS[n.tipo] || { t: n.tipo, i: "•", cor: "#999", desc: () => "" };
      const card = el("div", { class: "au-node" + (A.painel?.id === n.id ? " sel" : ""), onclick: () => { A.painel = { kind: "passo", id: n.id }; renderAuto(); } }, el("div", { class: "au-ic", style: `background:${P.cor}` }, P.i), el("div", { class: "au-body" }, el("div", { class: "au-t" }, P.t), el("div", { class: "au-d" }, P.desc(n.config || {}))),
        el("div", { class: "au-menu" }, el("button", { class: "au-x", title: "Duplicar", onclick: (e) => { e.stopPropagation(); lista.splice(i + 1, 0, clonar(n)); A.dirty = true; renderAuto(); } }, "⧉"), el("button", { class: "au-x", title: "Excluir", onclick: (e) => { e.stopPropagation(); if (n.tipo === "condicao" && ((n.sim || []).length || (n.nao || []).length) && !confirm("Excluir a condição e os passos dos dois ramos?")) return; lista.splice(i, 1); A.dirty = true; if (A.painel?.id === n.id) A.painel = null; renderAuto(); } }, "×")));
      col.append(card);
      if (n.tipo === "condicao") {
        n.sim = n.sim || []; n.nao = n.nao || [];
        col.append(el("div", { class: "au-branches" }, el("div", { class: "au-branch" }, el("div", { class: "au-blabel sim" }, "Sim"), renderLista_(n.sim, "↓")), el("div", { class: "au-branch" }, el("div", { class: "au-blabel nao" }, "Não"), renderLista_(n.nao, "↓"))), el("div", { class: "au-merge" }));
      }
      col.append(botaoMais(lista, i + 1));
    });
    col.append(el("div", { class: "au-fim" }, fimLabel || "FIM"));
    return col;
  }
  const clonar = (n) => { const c = JSON.parse(JSON.stringify(n)); const re = (x) => { x.id = uid(); (x.sim || []).forEach(re); (x.nao || []).forEach(re); }; re(c); return c; };
  function botaoMais(lista, pos) {
    const b = el("button", { class: "au-plus", title: "Adicionar passo aqui", onclick: (e) => { e.stopPropagation(); abrirPicker(b, lista, pos); } }, "+");
    return el("div", { class: "au-plus-wrap" }, b);
  }
  function abrirPicker(btn, lista, pos) {
    document.querySelectorAll(".au-picker").forEach((p) => p.remove());
    const pk = el("div", { class: "au-picker" }, el("div", { class: "note", style: "padding:4px 8px" }, "Adicionar passo"), ...Object.entries(PASSOS).map(([k, P]) => el("button", { class: "au-pick", onclick: () => { const n = { id: uid(), tipo: k, config: padrao(k) }; if (k === "condicao") { n.sim = []; n.nao = []; } lista.splice(pos, 0, n); A.dirty = true; A.painel = { kind: "passo", id: n.id }; renderAuto(); } }, el("span", { class: "au-ic sm", style: `background:${P.cor}` }, P.i), P.t)));
    btn.parentElement.append(pk);
    setTimeout(() => document.addEventListener("click", function h(e) { if (!pk.contains(e.target)) { pk.remove(); document.removeEventListener("click", h); } }), 0);
  }
  const padrao = (k) => k === "esperar" ? { minutos: 1440, relativo: "anterior" } : k === "mensagem" ? { texto: "" } : k === "tarefa" ? { titulo: "Ligar para {nome}", tarefa_tipo: "ligar" } : k === "etapa" ? { fase_id: A.fases[0]?.id } : k === "tag" ? { acao: "adicionar", tag: "" } : k === "condicao" ? { tipo: "respondeu", rotulo: "Respondeu?" } : k === "notificar" ? { titulo: "", texto: "" } : {};
  function acharPasso(id, lista = A.sel.definicao.passos) { for (const n of lista) { if (n.id === id) return n; const r = acharPasso(id, n.sim || []) || acharPasso(id, n.nao || []); if (r) return r; } return null; }

  // ---------- painel lateral ----------
  function renderPainel() {
    const f = A.sel, p = A.painel; const box = el("div", { class: "au-side" });
    if (!p) { box.append(el("h3", {}, "Construtor"), el("p", { class: "note" }, "Clique em um acionador ou passo para editar. Use o \"+\" para inserir passos entre os existentes. Condições criam dois caminhos (Sim / Não) que se juntam depois."), el("div", { class: "note", style: "margin-top:10px" }, "Variáveis nas mensagens: {primeiro_nome} {nome} {empresa} {proprietario} {reuniao} {reuniao_data} {reuniao_hora} {link_reuniao}")); return box; }
    const fechar = el("button", { class: "au-x", style: "float:right", onclick: () => { A.painel = null; renderAuto(); } }, "×");
    const marca = () => { A.dirty = true; };
    if (p.kind === "novo_gatilho" || p.kind === "gatilho") {
      const g = p.kind === "gatilho" ? f.definicao.gatilhos.find((x) => x.id === p.id) : { id: uid(), tipo: "entrou_na_fase", config: {} };
      if (!g) return box;
      box.append(fechar, el("h3", {}, p.kind === "gatilho" ? "Acionador" : "Novo acionador"));
      const tipo = sel(Object.fromEntries(Object.entries(GATILHOS).map(([k, G]) => [k, G.t])), g.tipo);
      const cfgBox = el("div", { class: "form", style: "grid-template-columns:1fr" });
      const desenhar = () => { cfgBox.replaceChildren(); const c = g.config; const t = tipo.value;
        if (t === "entrou_na_fase" || t === "parado_na_etapa") { const s = sel({ ...(t === "parado_na_etapa" ? { "": "Qualquer etapa" } : {}), ...Object.fromEntries(A.fases.map((x) => [x.id, x.nome])) }, String(c.fase_id || "")); s.onchange = () => { c.fase_id = s.value ? +s.value : null; marca(); renderCanvasOnly(); }; cfgBox.append(field("g-fase", "Etapa", s)); }
        if (t === "parado_na_etapa") { const d = inp("number", String(c.dias || 3), { min: "1" }); d.oninput = () => { c.dias = +d.value || 3; marca(); renderCanvasOnly(); }; cfgBox.append(field("g-dias", "Dias parado na etapa", d)); }
        if (t === "novo_lead") { const OR = { chatguru: "ChatGuru (WhatsApp)", site: "Formulário do site", manual: "Cadastro manual", planilha: "Planilha", gcv: "GCV" }; cfgBox.append(el("div", { class: "f" }, el("label", {}, "Só destas origens (nenhuma = todas)"), ...Object.entries(OR).map(([k, t2]) => { const cb = el("input", { type: "checkbox", checked: (c.origens || []).includes(k) ? "" : null }); cb.onchange = () => { c.origens = Object.keys(OR).filter((o) => o === k ? cb.checked : (c.origens || []).includes(o)); marca(); renderCanvasOnly(); }; return el("label", { style: "display:flex;gap:6px;align-items:center;font-weight:400" }, cb, t2); }))); }
        if (t === "tag_adicionada") { const i = inp("text", c.tag || "", { list: "au-tags", placeholder: "Ex.: fup1 sdr" }); i.oninput = () => { c.tag = i.value; marca(); renderCanvasOnly(); }; cfgBox.append(field("g-tag", "Tag (quando esta tag for adicionada ao lead)", i), el("datalist", { id: "au-tags" }, A.tags.map((t2) => el("option", { value: t2 })))); }
        if (t === "lead_respondeu") cfgBox.append(el("p", { class: "note" }, "Dispara a cada mensagem recebida do lead no WhatsApp (webhook do ChatGuru). Um fluxo não é iniciado de novo enquanto já estiver ativo para o mesmo lead."));
        if (t === "reuniao_marcada") cfgBox.append(el("p", { class: "note" }, "Dispara quando a reunião do lead é marcada ou remarcada. Nos passos \"Esperar\", escolha \"em relação à reunião\" para enviar antes/depois dela."));
        if (t === "manual") cfgBox.append(el("p", { class: "note" }, "Aparece em \"Iniciar fluxo…\" na ficha do lead."));
      };
      tipo.onchange = () => { g.tipo = tipo.value; g.config = {}; marca(); desenhar(); renderCanvasOnly(); };
      desenhar();
      box.append(el("div", { class: "form", style: "grid-template-columns:1fr" }, field("g-tipo", "Quando", tipo)), cfgBox);
      if (p.kind === "novo_gatilho") box.append(el("div", { class: "actions", style: "margin-top:10px" }, el("button", { class: "btn primary", onclick: () => { f.definicao.gatilhos.push(g); A.painel = { kind: "gatilho", id: g.id }; marca(); renderAuto(); } }, "Adicionar acionador")));
      return box;
    }
    const n = acharPasso(p.id); if (!n) return box;
    const P = PASSOS[n.tipo]; const c = n.config = n.config || {};
    box.append(fechar, el("h3", {}, el("span", { class: "au-ic sm", style: `background:${P.cor};margin-right:8px` }, P.i), P.t));
    const form = el("div", { class: "form", style: "grid-template-columns:1fr" });
    const upd = () => { marca(); renderCanvasOnly(); };
    if (n.tipo === "esperar") {
      const rel = sel({ anterior: "depois do passo anterior", reuniao: "em relação à reunião do lead", horario: "no próximo dia útil, em um horário" }, c.relativo || "anterior");
      const abs = Math.abs(c.minutos || 0), un = abs && abs % 1440 === 0 ? 1440 : abs && abs % 60 === 0 ? 60 : 1;
      const num = inp("number", String(abs / un), { min: "0" }), u = sel({ 1: "minutos", 60: "horas", 1440: "dias" }, String(un)), sent = sel({ "1": "depois da reunião", "-1": "antes da reunião" }, String((c.minutos || 0) < 0 ? -1 : 1));
      const dias = inp("number", String(c.dias || 1), { min: "1" }), hora = inp("time", c.hora || "09:00");
      const linha = el("div", {});
      const desenhar = () => { linha.replaceChildren(); if (rel.value === "horario") linha.append(field("e-d", "Dias úteis depois", dias), field("e-h", "Horário", hora)); else linha.append(el("div", { class: "f" }, el("label", {}, "Tempo"), el("div", { style: "display:flex;gap:6px" }, num, u, rel.value === "reuniao" ? sent : null))); };
      const calc = () => { c.relativo = rel.value; if (rel.value === "horario") { c.dias = +dias.value || 1; c.hora = hora.value || "09:00"; } else c.minutos = (+num.value || 0) * (+u.value) * (rel.value === "reuniao" ? +sent.value : 1); upd(); };
      [num, u, sent, dias, hora].forEach((x) => x.addEventListener("input", calc)); rel.onchange = () => { desenhar(); calc(); }; desenhar();
      form.append(field("e-rel", "Esperar", rel), linha, el("p", { class: "note" }, "As mensagens só saem em horário comercial; fora dele, ficam para o próximo horário."));
    } else if (n.tipo === "mensagem") {
      const ta = el("textarea", { rows: "9", style: "width:100%", placeholder: "Olá {primeiro_nome}, aqui é {proprietario}, da Neves Pádua…" }, c.texto || ""); ta.oninput = () => { c.texto = ta.value; upd(); };
      form.append(el("div", { class: "f" }, el("label", {}, "Mensagem de WhatsApp"), ta), el("div", { class: "note", style: "display:flex;gap:4px;flex-wrap:wrap" }, "Inserir: ", ...["{primeiro_nome}", "{nome}", "{empresa}", "{proprietario}", "{reuniao}", "{link_reuniao}"].map((vv) => el("button", { class: "btn sm", onclick: () => { const s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + vv + ta.value.slice(ta.selectionEnd ?? s); c.texto = ta.value; ta.focus(); upd(); } }, vv))), el("p", { class: "note" }, "Enviada pelo ChatGuru para o WhatsApp do lead; vira observação no lead. *texto* fica em negrito."));
    } else if (n.tipo === "tarefa") {
      const t = inp("text", c.titulo || ""), tp = sel({ ligar: "Ligar", whatsapp: "WhatsApp", social_selling: "Social selling", follow_up: "Follow-up", tarefa: "Tarefa" }, c.tarefa_tipo || "ligar"), pz = inp("number", String((c.prazo_minutos || 0) / 60), { min: "0", step: "1" });
      t.oninput = () => { c.titulo = t.value; upd(); }; tp.onchange = () => { c.tarefa_tipo = tp.value; upd(); }; pz.oninput = () => { c.prazo_minutos = (+pz.value || 0) * 60; upd(); };
      form.append(field("t-t", "Título da tarefa", t), field("t-tp", "Tipo", tp), field("t-pz", "Prazo (horas a partir de agora; 0 = imediato)", pz), el("p", { class: "note" }, "A tarefa vai para o proprietário do lead."));
    } else if (n.tipo === "etapa") {
      const s = sel(Object.fromEntries(A.fases.map((x) => [x.id, x.nome])), String(c.fase_id || "")); s.onchange = () => { c.fase_id = +s.value; upd(); };
      form.append(field("et-f", "Mover o lead para a etapa", s), el("p", { class: "note" }, "A mudança de etapa inicia a cadência daquela etapa (C1–C5) normalmente."));
    } else if (n.tipo === "tag") {
      const a = sel({ adicionar: "Adicionar tag", remover: "Remover tag" }, c.acao || "adicionar"), t = inp("text", c.tag || "", { list: "au-tags2" });
      a.onchange = () => { c.acao = a.value; upd(); }; t.oninput = () => { c.tag = t.value; upd(); };
      form.append(field("tg-a", "Ação", a), field("tg-t", "Tag", t), el("datalist", { id: "au-tags2" }, A.tags.map((t2) => el("option", { value: t2 }))));
    } else if (n.tipo === "condicao") {
      const r = inp("text", c.rotulo || "", { placeholder: "Ex.: Respondeu?" }), tp = sel(COND, c.tipo || "respondeu"); const extra = el("div", {});
      const desenhar = () => { extra.replaceChildren(); if (tp.value === "etapa") extra.append(el("div", { class: "f" }, el("label", {}, "Etapas"), ...A.fases.map((x) => { const cb = el("input", { type: "checkbox", checked: (c.fases || []).map(Number).includes(x.id) ? "" : null }); cb.onchange = () => { c.fases = A.fases.filter((y) => y.id === x.id ? cb.checked : (c.fases || []).map(Number).includes(y.id)).map((y) => y.id); upd(); }; return el("label", { style: "display:flex;gap:6px;align-items:center;font-weight:400" }, cb, x.nome); }))); if (tp.value === "status") { const s = sel({ Aberto: "Aberto", Ganho: "Ganho", Perdido: "Perdido", Abandonado: "Abandonado" }, c.status || "Aberto"); s.onchange = () => { c.status = s.value; upd(); }; extra.append(field("c-s", "Status", s)); } if (tp.value === "tag") { const t = inp("text", c.tag || "", { list: "au-tags2" }); t.oninput = () => { c.tag = t.value; upd(); }; extra.append(field("c-t", "Tag", t), el("datalist", { id: "au-tags2" }, A.tags.map((t2) => el("option", { value: t2 })))); } };
      r.oninput = () => { c.rotulo = r.value; upd(); }; tp.onchange = () => { c.tipo = tp.value; desenhar(); upd(); }; desenhar();
      form.append(field("c-r", "Nome da condição (aparece no fluxo)", r), field("c-tp", "Verificar se", tp), extra, el("p", { class: "note" }, "Se verdadeiro, segue pelo caminho \"Sim\"; senão, \"Não\". Os dois caminhos se juntam depois da condição."));
    } else if (n.tipo === "notificar") {
      const t = inp("text", c.titulo || ""), ta = el("textarea", { rows: "3", style: "width:100%" }, c.texto || ""); t.oninput = () => { c.titulo = t.value; upd(); }; ta.oninput = () => { c.texto = ta.value; upd(); };
      form.append(field("n-t", "Título do aviso", t), el("div", { class: "f" }, el("label", {}, "Texto"), ta), el("p", { class: "note" }, "Aviso interno (sino do sistema) para o proprietário do lead."));
    } else form.append(el("p", { class: "note" }, "Encerra o fluxo neste ponto."));
    box.append(form);
    return box;
  }
  function renderCanvasOnly() { const v = $("#view-automacoes"); const old = v.querySelector(".au-canvas"); if (!old) return; const tmp = el("div", {}); renderCanvas(tmp); old.replaceWith(tmp.querySelector(".au-canvas")); const b = v.querySelector(".head .btn.primary"); if (b) b.textContent = "Salvar"; }

  function renderConfig(v) {
    const f = A.sel; const nome = inp("text", f.nome), desc = inp("text", f.descricao || ""), pasta = inp("text", f.pasta || "", { list: "au-pastas", placeholder: "Opcional" });
    const pr = el("input", { type: "checkbox", checked: f.parar_ao_responder ? "" : null }), pf = el("input", { type: "checkbox", checked: f.parar_ao_mudar_fase ? "" : null });
    const m = () => { f.nome = nome.value; f.descricao = desc.value; f.pasta = pasta.value.trim(); f.parar_ao_responder = pr.checked; f.parar_ao_mudar_fase = pf.checked; A.dirty = true; };
    [nome, desc, pasta].forEach((x) => x.oninput = m); pr.onchange = m; pf.onchange = m;
    v.append(el("div", { class: "card section", style: "max-width:720px" }, el("div", { class: "form", style: "grid-template-columns:1fr" }, field("cf-n", "Nome", nome), field("cf-d", "Descrição", desc), field("cf-p", "Pasta", pasta), el("datalist", { id: "au-pastas" }, [...new Set(A.lista.map((x) => x.pasta).filter(Boolean))].map((p) => el("option", { value: p }))),
      el("div", { class: "f" }, el("label", {}, "Interromper o fluxo quando…"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, pr, "o lead responder no WhatsApp (recomendado para follow-ups)"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, pf, "o lead mudar de etapa ou for fechado (exceto mudanças feitas pelo próprio fluxo)"))),
      el("div", { class: "actions", style: "margin-top:10px" }, el("button", { class: "btn primary", onclick: () => salvar() }, "Salvar"), f.id ? el("button", { class: "btn danger", onclick: async () => { if (!confirm(`Excluir o fluxo "${f.nome}"? Execuções em andamento serão canceladas.`)) return; const { error } = await SB.from("fluxos_mensagens").delete().eq("id", f.id); if (error) { toast(error.message); return; } toast("Fluxo excluído"); A.sel = null; A.dirty = false; location.hash = "#automacoes"; invalidar(); } }, "Excluir fluxo") : null)));
  }
  const ST = { ativo: ["Em andamento", "g"], concluido: ["Concluído", "e1"], cancelado: ["Interrompido", "c"] };
  function renderInscricoes(v) {
    if (!A.sel.id) { v.append(el("div", { class: "note" }, "Salve o fluxo para ver as inscrições.")); return; }
    if (!A.execsOk) { v.append(el("div", { class: "note" }, "Carregando…")); return; }
    v.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Lead", "Etapa atual", "Inscrito em", "Motivo", "Situação", "Passo atual", "Próximo passo", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, A.execs.length ? A.execs.map((x) => { const no = A.sel.definicao.nos?.[x.no_atual]; return el("tr", {}, el("td", {}, el("b", {}, x.lead_nome), x.lead_empresa ? el("div", { class: "note" }, x.lead_empresa) : null), el("td", { class: "note" }, x.lead_fase_nome || "—"), el("td", { class: "note" }, fmtDH(x.created_at)), el("td", { class: "note" }, x.contexto?.motivo || "—"), el("td", {}, el("span", { class: "pill " + (ST[x.status]?.[1] || "c") }, ST[x.status]?.[0] || x.status), x.motivo && x.status !== "ativo" ? el("div", { class: "note" }, x.motivo) : null), el("td", { class: "note" }, x.status === "ativo" && no ? PASSOS[no.tipo]?.t + " — " + PASSOS[no.tipo]?.desc(no.config || {}) : "—"), el("td", { class: "note" }, x.status === "ativo" && x.proximo_em ? fmtDH(x.proximo_em) : "—"), el("td", {}, x.status === "ativo" ? el("button", { class: "btn sm", onclick: async () => { const { error } = await SB.rpc("fluxo_execucao_cancelar", { p_exec: x.id }); if (error) { toast(error.message); return; } toast("Execução cancelada"); carregarExecs(A.sel.id); } }, "Cancelar") : null)); }) : el("tr", {}, el("td", { colspan: "8", class: "note" }, "Nenhum lead inscrito ainda."))))));
  }
  function renderRegistros(v) {
    if (!A.sel.id) { v.append(el("div", { class: "note" }, "Salve o fluxo para ver os registros.")); return; }
    if (!A.execsOk) { v.append(el("div", { class: "note" }, "Carregando…")); return; }
    const linhas = []; for (const x of A.execs) for (const h of x.historico || []) linhas.push({ em: h.em, lead: x.lead_nome, tipo: h.tipo, texto: h.texto, teste: x.contexto?.teste });
    linhas.sort((a, b) => (b.em || "").localeCompare(a.em || ""));
    v.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Quando", "Lead", "Ação", "Detalhe"].map((h) => el("th", {}, h)))),
      el("tbody", {}, linhas.length ? linhas.slice(0, 400).map((l) => el("tr", {}, el("td", { class: "note" }, fmtDH(l.em)), el("td", {}, l.lead, l.teste ? el("span", { class: "pill c", style: "margin-left:6px" }, "teste") : null), el("td", {}, el("span", { class: "pill " + (l.tipo === "mensagem" ? "e1" : l.tipo === "parado" ? "e3" : "c") }, PASSOS[l.tipo]?.t || l.tipo)), el("td", { class: "note" }, l.texto))) : el("tr", {}, el("td", { colspan: "4", class: "note" }, "Nenhuma execução registrada."))))));
  }
  async function testar() {
    const f = A.sel; if (A.dirty || !f.id) { const ok = await salvar(); if (!ok) return; }
    const host = $("#modalHost"); host.replaceChildren(); const close = () => host.replaceChildren();
    const q = inp("search", "", { placeholder: "Nome, empresa ou WhatsApp do lead…" }); const res = el("div", { style: "max-height:300px;overflow:auto;margin-top:8px" });
    let t; q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { const { data } = await SB.from("leads").select("id,nome,empresa,whatsapp,status").or(`nome.ilike.%${q.value}%,empresa.ilike.%${q.value}%,whatsapp.ilike.%${q.value}%`).order("data_entrada", { ascending: false }).limit(15); res.replaceChildren(...(data || []).map((l) => el("div", { class: "ld-obs", style: "cursor:pointer", onclick: async () => { if (!confirm(`Iniciar o fluxo "${f.nome}" para ${l.nome}? Mensagens reais serão enviadas para o WhatsApp dele.`)) return; const { error } = await SB.rpc("fluxo_testar", { p_fluxo: f.id, p_lead: l.id }); if (error) { toast(error.message); return; } toast("Teste iniciado — acompanhe em Histórico de inscrições"); close(); A.abaB = "inscricoes"; carregarExecs(f.id); } }, el("b", {}, l.nome), el("span", { class: "note" }, ` · ${l.empresa || "—"} · ${l.whatsapp || "sem WhatsApp"} · ${l.status}`)))); }, 300); };
    host.append(el("div", { class: "modal", onclick: (e) => { if (e.target.classList.contains("modal")) close(); } }, el("div", { class: "card", role: "dialog", style: "max-width:560px" }, el("h2", {}, "Testar fluxo com um lead"), el("p", { class: "note" }, "Dica: use o seu próprio cadastro de lead (seu número) para ver as mensagens chegando. O teste roda mesmo com o fluxo em rascunho."), q, res, el("div", { class: "actions", style: "margin-top:10px" }, el("button", { class: "btn", onclick: close }, "Fechar")))));
    q.focus();
  }

  // ---------- estilo, rota e registro ----------
  document.head.append(el("style", {}, `
.au-wrap{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}
@media(max-width:1000px){.au-wrap{grid-template-columns:1fr}}
.au-canvas{background:radial-gradient(circle,var(--line) 1px,transparent 1px) 0 0/22px 22px;border:1px solid var(--line);border-radius:14px;padding:28px 16px 40px;min-height:60vh;display:flex;flex-direction:column;align-items:center;overflow:auto}
.au-trigs{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;align-items:stretch}
.au-node{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:260px;max-width:340px;cursor:pointer;box-shadow:0 1px 2px rgba(12,31,56,.06);position:relative;text-align:left}
.au-node:hover{border-color:var(--gold)}.au-node.sel{border-color:var(--gold);box-shadow:0 0 0 3px rgba(184,150,74,.25)}
.au-trig{border-style:dashed;border-color:#0c1f38}
.au-ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex:none;font-size:15px}
.au-ic.sm{width:24px;height:24px;border-radius:7px;font-size:12px;display:inline-flex}
.au-body{min-width:0;flex:1}.au-t{font-weight:700;font-size:13px}.au-d{font-size:12px;color:var(--muted);white-space:pre-wrap;word-break:break-word}
.au-menu{display:flex;flex-direction:column;gap:2px}.au-x{border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:2px 4px;border-radius:6px}.au-x:hover{background:var(--surface-2);color:var(--fg)}
.au-add-trig{border:1px dashed #2a78d6;color:#2a78d6;background:transparent;border-radius:12px;padding:12px 16px;font-weight:600;cursor:pointer;min-width:220px}
.au-line{width:2px;height:22px;background:var(--line)}
.au-col{display:flex;flex-direction:column;align-items:center;min-width:300px}
.au-plus-wrap{position:relative;display:flex;flex-direction:column;align-items:center;padding:4px 0}
.au-plus-wrap::before{content:"";width:2px;height:14px;background:var(--line)}.au-plus-wrap::after{content:"";width:2px;height:14px;background:var(--line)}
.au-plus{width:26px;height:26px;border-radius:50%;border:1px solid var(--line);background:var(--surface);cursor:pointer;font-weight:700;color:var(--muted)}.au-plus:hover{border-color:var(--gold);color:var(--gold)}
.au-picker{position:absolute;top:34px;left:50%;transform:translateX(-50%);z-index:30;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px -10px rgba(12,31,56,.35);padding:6px;display:grid;grid-template-columns:1fr 1fr;gap:4px;width:420px}
.au-pick{display:flex;align-items:center;gap:8px;border:none;background:transparent;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left;font-size:13px;color:var(--fg)}.au-pick:hover{background:var(--surface-2)}
.au-branches{display:flex;gap:24px;align-items:flex-start;justify-content:center;padding-top:10px;position:relative}
.au-branches::before{content:"";position:absolute;top:0;left:25%;right:25%;height:2px;background:var(--line)}
.au-branch{display:flex;flex-direction:column;align-items:center;position:relative}
.au-branch::before{content:"";width:2px;height:12px;background:var(--line)}
.au-blabel{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;border-radius:999px;padding:2px 10px;margin:4px 0}
.au-blabel.sim{background:#e1f1e5;color:#2e7d46}.au-blabel.nao{background:#f8dfda;color:#ae3b2e}
.au-merge{width:2px;height:16px;background:var(--line)}
.au-fim{margin-top:6px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:3px 14px;font-size:11px;font-weight:700;letter-spacing:.5px}
.au-side{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;position:sticky;top:12px;max-height:85vh;overflow:auto}
.au-side h3{margin:0 0 10px;display:flex;align-items:center}
`));
  { const _r = render; render = function () { _r(); const va = $("#view-automacoes"); if (!va) return; if (S.tab === "automacoes" && !podeCom()) S.tab = "clientes"; va.hidden = S.tab !== "automacoes"; if (S.tab === "automacoes") { const m = /^#automacoes\/([^/]+)/.exec(location.hash); if (m && !A.sel && A.ok) { if (m[1] === "novo") novo(); else abrir(m[1]); } else renderAuto(); } }; }
  window.PP_AUTOMACOES = { invalidar, abrir: (id) => { S.tab = "automacoes"; location.hash = "#automacoes" + (id ? "/" + id : ""); if (A.ok) { if (id) abrir(id); else { A.sel = null; renderAuto(); } } render(); } };
  window.__PP_LOGIN?.then(() => { if (podeCom()) { const ch = SB.channel("automacoes"); let t; ch.on("postgres_changes", { event: "*", schema: "public", table: "fluxo_execucoes" }, () => { clearTimeout(t); t = setTimeout(() => { if (A.sel?.id && (A.abaB === "inscricoes" || A.abaB === "registros")) carregarExecs(A.sel.id); }, 800); }); ch.subscribe(); } });
})();
