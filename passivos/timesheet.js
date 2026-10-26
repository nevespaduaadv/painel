/* Timesheet — bloco 4 da controladoria (beta 0004). Substitui o conteúdo da aba Equipe → Horas.
   - Minha semana: cronômetro (persistente no servidor), lançamento manual (início/fim ou horas), cobrável/não cobrável, atividade do
     catálogo, cliente, processo, tarefa; status de aprovação (pendente / aprovado / corrigir).
   - Relatórios (equipe/admin): período + filtros; por colaborador, por cliente (horas × contratadas × honorário), por atividade,
     por tarefa; "Relatório para o cliente" imprimível (só cobráveis) e CSV.
   - Aprovação (admin): lote de lançamentos pendentes → aprovar / devolver para correção.
   - Configurações (admin): atividades, tabelas de valor/hora, vínculo por cliente (tabela, horas contratadas/mês, honorário mensal).
   Supabase: apontamentos_horas (+inicio, fim, cobravel, processo_id, status…), ts_atividades, ts_tabelas_hora, ts_cronometros,
   rpcs ts_cronometro_iniciar/parar, ts_aprovar; views v_apontamentos, v_horas_*_mes, v_horas_atividade_colaborador_mes, v_horas_tarefa. */
(() => {
  "use strict";
  const H = { aba: "semana", ok: false, ativ: [], tabelas: [], colab: [], procs: [], cron: null, cronT: null,
    sem: { data: null, colab: null, lista: [], ok: false },
    rel: { ini: null, fim: null, colab: "", cli: "", ativ: "", cobr: "", status: "", lista: [], tarefas: [], ok: false },
    apr: { lista: [], sel: new Set(), ok: false, colab: "" } };
  const admin = () => PP.perfil?.papel === "admin";
  const meu = () => H.colab.find((c) => c.perfil_id === PP.perfil?.id);
  const iso = (d) => d.toISOString().slice(0, 10);
  const hoje = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return iso(d); };
  const addD = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = (s) => s ? new Date(s + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const hFmt = (h) => { h = +h || 0; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return mm ? `${hh}h${String(mm).padStart(2, "0")}` : `${hh}h`; };
  const BRL2 = (v) => v == null || isNaN(v) ? "—" : (+v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const semanaDe = (d) => { const x = new Date(d + "T12:00:00"); const dow = (x.getDay() + 6) % 7; const ini = addD(d, -dow); return { ini, fim: addD(ini, 6) }; };
  const STATUS = { pendente: ["pendente", "c"], aprovado: ["aprovado", "e1"], correcao: ["corrigir", "e3"] };
  const chk = (label, on, cb) => { const i = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }); i.checked = !!on; i.onchange = () => cb(i.checked); return el("label", { style: "display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer" }, i, label); };
  const selColab = (v, vazio = "— colaborador —") => sel({ "": vazio, ...Object.fromEntries(H.colab.filter((c) => c.ativo !== false || c.id === v).map((c) => [c.id, c.nome])) }, v || "");
  const selCliente = (v, vazio = "— sem cliente —") => sel({ "": vazio, ...Object.fromEntries([...S.clientes].sort((a, b) => (a.nome || "").localeCompare(b.nome || "")).map((c) => [c.id, c.nome])) }, v || "");
  const selAtiv = (v) => sel(Object.fromEntries(H.ativ.filter((a) => a.ativa || a.codigo === v).map((a) => [a.codigo, a.nome])), v || "outro");
  const ativNome = (c) => H.ativ.find((a) => a.codigo === c)?.nome || c || "—";

  // ---------- carga ----------
  async function carregarBase() {
    const [a, t, c, p, cr] = await Promise.all([SB.from("ts_atividades").select("*").order("ordem"), SB.from("ts_tabelas_hora").select("*").order("nome"), SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo").order("nome"),
      SB.from("processos").select("id,cliente_id,numero_cnj,tipo_acao").order("numero_cnj"), SB.from("ts_cronometros").select("*")]);
    H.ativ = a.data || []; H.tabelas = t.data || []; H.colab = c.data || []; H.procs = p.data || []; H.ok = true;
    const m = meu(); H.cron = (cr.data || []).find((x) => x.colaborador_id === m?.id) || null;
    if (!H.sem.data) { H.sem.data = hoje(); H.sem.colab = m?.id || null; }
    if (!H.rel.ini) { const d = new Date(); d.setDate(1); H.rel.ini = iso(d); d.setMonth(d.getMonth() + 1); d.setDate(0); H.rel.fim = iso(d); }
  }
  async function carregarSemana() {
    const s = semanaDe(H.sem.data); const q = H.sem.colab ? SB.from("v_apontamentos").select("*").eq("colaborador_id", H.sem.colab).gte("data", s.ini).lte("data", s.fim).order("data").order("inicio", { nullsFirst: true }).order("created_at") : Promise.resolve({ data: [] });
    const { data } = await q; H.sem.lista = data || []; H.sem.ok = true; render();
  }
  async function carregarRel() {
    const r = H.rel; let q = SB.from("v_apontamentos").select("*").gte("data", r.ini).lte("data", r.fim).order("data");
    if (r.colab) q = q.eq("colaborador_id", r.colab); if (r.cli) q = q.eq("cliente_id", r.cli); if (r.ativ) q = q.eq("tipo_atividade", r.ativ); if (r.cobr) q = q.eq("cobravel", r.cobr === "sim"); if (r.status) q = q.eq("status", r.status);
    const { data } = await q.limit(5000); r.lista = data || []; r.ok = true; render();
  }
  async function carregarApr() { let q = SB.from("v_apontamentos").select("*").neq("status", "aprovado").order("colaborador_nome").order("data"); if (H.apr.colab) q = q.eq("colaborador_id", H.apr.colab); const { data } = await q.limit(2000); H.apr.lista = data || []; H.apr.ok = true; render(); }
  const inval = () => { H.sem.ok = false; H.rel.ok = false; H.apr.ok = false; };

  // ---------- lançamento ----------
  function lancar({ ap, tarefa, data } = {}) {
    if (!H.ok) { carregarBase().then(() => lancar({ ap, tarefa, data })); return; }
    const a = ap || {}; const m = meu();
    const colab = admin() ? selColab(a.colaborador_id || H.sem.colab || m?.id) : null;
    const dt = inp("date", a.data || data || hoje()), ini = inp("time", a.inicio ? a.inicio.slice(0, 5) : ""), fim = inp("time", a.fim ? a.fim.slice(0, 5) : ""), hr = inp("number", a.horas || "", { step: "0.05", min: "0.05", max: 24 });
    const cli = selCliente(a.cliente_id || tarefa?.cliente_id), tar = sel({ "": "— sem tarefa —" }, ""), proc = sel({ "": "— sem processo —" }, ""), ativ = selAtiv(a.tipo_atividade || (tarefa ? "outro" : "outro"));
    const cobr = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }); cobr.checked = a.id ? !!a.cobravel : (H.ativ.find((x) => x.codigo === ativ.value)?.cobravel_padrao ?? true);
    ativ.onchange = () => { if (!a.id) cobr.checked = H.ativ.find((x) => x.codigo === ativ.value)?.cobravel_padrao ?? true; };
    const desc = inp("text", a.descricao || tarefa?.titulo || "", { placeholder: "O que foi feito (aparece no relatório ao cliente)" });
    const calc = () => { if (ini.value && fim.value) { const [h1, m1] = ini.value.split(":").map(Number), [h2, m2] = fim.value.split(":").map(Number); let mins = (h2 * 60 + m2) - (h1 * 60 + m1); if (mins > 0) hr.value = (Math.round(mins / 3) / 20).toFixed(2); } }; ini.onchange = fim.onchange = calc;
    const vincular = () => { const cid = cli.value; const selT = a.tarefa_id || tarefa?.id; const ts = (window.PP_TAREFAS?.lista?.() || []).filter((t) => (!cid || t.cliente_id === cid) && (t.status === "aberta" || t.status === "em_andamento" || t.id === selT));
      tar.replaceChildren(el("option", { value: "" }, "— sem tarefa —"), ...ts.map((t) => el("option", { value: t.id, selected: t.id === selT ? "" : null }, t.titulo)));
      const selP = a.processo_id || tarefa?.processo_id; proc.replaceChildren(el("option", { value: "" }, "— sem processo —"), ...H.procs.filter((p) => !cid || p.cliente_id === cid || p.id === selP).map((p) => el("option", { value: p.id, selected: p.id === selP ? "" : null }, (p.numero_cnj || "s/ nº") + (p.tipo_acao ? " · " + p.tipo_acao : "")))); };
    cli.onchange = vincular; vincular();
    const body = el("div", { class: "form" }, colab ? field("h-colab", "Colaborador", colab) : null, field("h-data", "Data", dt),
      el("div", { class: "f" }, el("label", {}, "Início → fim (opcional)"), el("div", { style: "display:flex;gap:6px;align-items:center" }, ini, el("span", { class: "note" }, "→"), fim)),
      field("h-hr", "Horas", hr, "Preenche sozinho com início/fim. Frações: 0,5 = 30 min; 1,25 = 1h15."),
      field("h-ativ", "Atividade", ativ), el("div", { class: "f", style: "justify-content:center" }, el("label", { style: "display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px" }, cobr, "Cobrável (entra no relatório ao cliente)")),
      field("h-cli", "Cliente", cli), field("h-proc", "Processo", proc), field("h-tar", "Tarefa", tar), el("div", { class: "f full" }, field("h-desc", "Descrição", desc)),
      a.obs_gestor && a.status === "correcao" ? el("div", { class: "f full", style: "color:var(--crit)" }, "Gestor pediu correção: " + a.obs_gestor) : null);
    const extra = a.id ? el("button", { class: "btn danger", onclick: async () => { if (!confirmInline(body, "Excluir este lançamento?")) return; const { error } = await SB.from("apontamentos_horas").delete().eq("id", a.id); $("#modalHost").replaceChildren(); toast(error ? "Não foi possível excluir" : "Excluído"); inval(); render(); } }, "Excluir") : null;
    modal(a.id ? "Editar lançamento" : "Lançar horas", body, async () => {
      const cid = colab ? colab.value : (a.colaborador_id || m?.id);
      if (!cid) throw new Error("Seu usuário não está vinculado a um colaborador. Peça ao administrador para salvar seu perfil na aba Usuários.");
      if (!(+hr.value > 0)) throw new Error("Informe as horas (ou início e fim)");
      const row = { colaborador_id: cid, data: dt.value, horas: +hr.value, inicio: ini.value || null, fim: fim.value || null, cliente_id: cli.value || null, tarefa_id: tar.value || null, processo_id: proc.value || null, tipo_atividade: ativ.value, cobravel: cobr.checked, descricao: desc.value.trim() || null };
      const { error } = a.id ? await SB.from("apontamentos_horas").update(row).eq("id", a.id) : await SB.from("apontamentos_horas").insert(row);
      if (error) throw new Error(error.code === "42501" ? "Você só pode lançar horas em seu próprio nome" : error.message || "Não foi possível salvar");
      toast("Horas lançadas"); inval(); render();
    }, extra);
  }

  // ---------- cronômetro ----------
  function cardCronometro() {
    const m = meu(); if (!m) return null;
    if (H.cron) {
      const c = H.cron; const t = el("b", { style: "font-size:22px;font-variant-numeric:tabular-nums" }, "00:00");
      const tick = () => { const s = Math.max(0, Math.floor((Date.now() - new Date(c.inicio).getTime()) / 1000)); t.textContent = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }; tick(); clearInterval(H.cronT); H.cronT = setInterval(tick, 1000);
      const desc = inp("text", c.descricao || "", { placeholder: "O que você está fazendo?", style: "flex:1;min-width:200px" });
      return el("div", { class: "card", style: "padding:12px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-color:var(--gold)" }, el("span", { class: "pill e2" }, "● rodando"), t,
        el("span", { class: "note" }, [c.cliente_id ? S.clientes.find((x) => x.id === c.cliente_id)?.nome : null, ativNome(c.tipo_atividade)].filter(Boolean).join(" · ")), desc,
        el("button", { class: "btn primary", onclick: async () => { const { error } = await SB.rpc("ts_cronometro_parar", { p_descricao: desc.value.trim() || null, p_descartar: false }); if (error) { toast(error.message); return; } clearInterval(H.cronT); H.cron = null; toast("Horas gravadas"); inval(); render(); } }, "■ Parar e gravar"),
        el("button", { class: "btn", onclick: async () => { if (!confirm("Descartar o tempo deste cronômetro?")) return; await SB.rpc("ts_cronometro_parar", { p_descartar: true }); clearInterval(H.cronT); H.cron = null; render(); } }, "Descartar"));
    }
    return el("div", { class: "card", style: "padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, el("b", {}, "Cronômetro"), el("span", { class: "note" }, "Inicie ao começar uma atividade; ao parar, o lançamento é criado com início e fim."), el("button", { class: "btn", onclick: () => iniciarCron() }, "▶ Iniciar"));
  }
  function iniciarCron({ tarefa } = {}) {
    const cli = selCliente(tarefa?.cliente_id), ativ = selAtiv("outro"), desc = inp("text", tarefa?.titulo || "", { placeholder: "Opcional" }), proc = sel({ "": "— sem processo —" }, ""), tar = sel({ "": "— sem tarefa —" }, "");
    const vincular = () => { const cid = cli.value; proc.replaceChildren(el("option", { value: "" }, "— sem processo —"), ...H.procs.filter((p) => !cid || p.cliente_id === cid).map((p) => el("option", { value: p.id, selected: p.id === tarefa?.processo_id ? "" : null }, p.numero_cnj || "s/ nº")));
      const ts = (window.PP_TAREFAS?.lista?.() || []).filter((t) => (!cid || t.cliente_id === cid) && (t.status === "aberta" || t.status === "em_andamento")); tar.replaceChildren(el("option", { value: "" }, "— sem tarefa —"), ...ts.map((t) => el("option", { value: t.id, selected: t.id === tarefa?.id ? "" : null }, t.titulo))); }; cli.onchange = vincular; vincular();
    modal("Iniciar cronômetro", el("div", { class: "form" }, field("c-cli", "Cliente", cli), field("c-ativ", "Atividade", ativ), field("c-proc", "Processo", proc), field("c-tar", "Tarefa", tar), el("div", { class: "f full" }, field("c-desc", "Descrição", desc))), async () => {
      const { data, error } = await SB.rpc("ts_cronometro_iniciar", { p_cliente: cli.value || null, p_tarefa: tar.value || null, p_processo: proc.value || null, p_atividade: ativ.value, p_descricao: desc.value.trim() || null }); if (error) throw new Error(error.message);
      H.cron = data; S.tab = "horas"; H.aba = "semana"; render();
    });
    const btn = $("#modalHost button.btn.primary"); if (btn) btn.textContent = "Iniciar";
  }

  // ---------- Minha semana ----------
  function renderSemana(v) {
    const s = semanaDe(H.sem.data); if (!H.sem.ok) { carregarSemana(); }
    const cron = cardCronometro(); if (cron) v.append(cron);
    const nav = el("div", { class: "actions", style: "justify-content:flex-start;align-items:center" },
      el("button", { class: "btn sm", onclick: () => { H.sem.data = addD(H.sem.data, -7); H.sem.ok = false; render(); } }, "‹"), el("b", {}, `${fmt(s.ini)} – ${fmt(s.fim)}`), el("button", { class: "btn sm", onclick: () => { H.sem.data = addD(H.sem.data, 7); H.sem.ok = false; render(); } }, "›"),
      el("button", { class: "btn sm", onclick: () => { H.sem.data = hoje(); H.sem.ok = false; render(); } }, "Hoje"),
      admin() ? Object.assign(selColab(H.sem.colab), { onchange: (e) => { H.sem.colab = e.target.value || null; H.sem.ok = false; render(); } }) : el("span", { class: "note" }, meu()?.nome || "—"));
    const L = H.sem.lista, tot = L.reduce((x, a) => x + +a.horas, 0), cob = L.filter((a) => a.cobravel).reduce((x, a) => x + +a.horas, 0);
    const sec = el("section", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Semana"), el("span", { class: "note" }, `${hFmt(tot)} na semana · ${hFmt(cob)} cobráveis`)), nav);
    if (!H.sem.colab) sec.append(el("div", { class: "empty" }, "Seu usuário ainda não está vinculado a um colaborador. Peça ao administrador para salvar seu perfil na aba Usuários."));
    else if (!H.sem.ok) sec.append(el("div", { class: "note" }, "Carregando…"));
    else {
      const dias = [0, 1, 2, 3, 4, 5, 6].map((i) => addD(s.ini, i));
      const tb = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Dia"), el("th", {}, "Horário"), el("th", {}, "Cliente / processo"), el("th", {}, "Atividade"), el("th", {}, "Descrição"), el("th", { class: "r" }, "Horas"), el("th", {}, "Status"), el("th", {}, ""))),
        el("tbody", {}, ...dias.flatMap((d) => { const ls = L.filter((a) => a.data === d); const t = ls.reduce((x, a) => x + +a.horas, 0);
          return [el("tr", { style: "background:var(--surface-2)" }, el("td", { colspan: 5 }, el("b", {}, new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })), d === hoje() ? el("span", { class: "pill e2", style: "margin-left:8px" }, "hoje") : null), el("td", { class: "r num" }, t ? hFmt(t) : ""), el("td", {}), el("td", {}, el("button", { class: "btn sm", onclick: () => lancar({ data: d }) }, "+"))),
            ...ls.map((a) => el("tr", {}, el("td", {}), el("td", { class: "note" }, a.inicio ? a.inicio.slice(0, 5) + (a.fim ? "–" + a.fim.slice(0, 5) : "") : "—"), el("td", {}, a.cliente_nome || "—", a.numero_cnj ? el("div", { class: "note" }, a.numero_cnj) : null),
              el("td", {}, a.atividade_nome, a.tarefa_titulo ? el("div", { class: "note" }, "Tarefa: " + a.tarefa_titulo) : null, a.cobravel ? null : el("div", { class: "note" }, "não cobrável")), el("td", { class: "note" }, a.descricao || ""), el("td", { class: "r num" }, hFmt(a.horas)),
              el("td", {}, el("span", { class: "pill " + STATUS[a.status][1], title: a.obs_gestor || "" }, STATUS[a.status][0])), el("td", {}, el("button", { class: "btn sm", onclick: () => lancar({ ap: a }) }, "Editar"))))]; })));
      sec.append(el("div", { class: "tbl" }, tb));
      const corr = L.filter((a) => a.status === "correcao"); if (corr.length) sec.append(el("div", { class: "note", style: "color:var(--crit);margin-top:6px" }, `${corr.length} lançamento(s) devolvido(s) pelo gestor — abra em Editar para ver a observação e corrigir.`));
    }
    v.append(sec);
  }

  // ---------- Relatórios ----------
  function renderRel(v) {
    const r = H.rel; if (!r.ok) carregarRel();
    const ini = inp("date", r.ini), fim = inp("date", r.fim); const aplicar = () => { r.ini = ini.value; r.fim = fim.value; r.ok = false; render(); };
    const mes = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); r.ini = iso(d); d.setMonth(d.getMonth() + 1); d.setDate(0); r.fim = iso(d); r.ok = false; render(); };
    const fc = Object.assign(selColab(r.colab, "Todos os colaboradores"), { onchange: (e) => { r.colab = e.target.value; r.ok = false; render(); } }), fcl = Object.assign(selCliente(r.cli, "Todos os clientes"), { onchange: (e) => { r.cli = e.target.value; r.ok = false; render(); } });
    const fa = Object.assign(sel({ "": "Todas as atividades", ...Object.fromEntries(H.ativ.map((a) => [a.codigo, a.nome])) }, r.ativ), { onchange: (e) => { r.ativ = e.target.value; r.ok = false; render(); } });
    const fb = Object.assign(sel({ "": "Cobráveis e não", sim: "Só cobráveis", nao: "Só não cobráveis" }, r.cobr), { onchange: (e) => { r.cobr = e.target.value; r.ok = false; render(); } }), fs = Object.assign(sel({ "": "Qualquer status", aprovado: "Só aprovados", pendente: "Só pendentes", correcao: "Em correção" }, r.status), { onchange: (e) => { r.status = e.target.value; r.ok = false; render(); } });
    v.append(el("div", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Período e filtros"), el("div", { class: "actions" }, el("button", { class: "btn sm", onclick: () => mes(0) }, "Mês atual"), el("button", { class: "btn sm", onclick: () => mes(-1) }, "Mês anterior"))),
      el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center" }, ini, el("span", { class: "note" }, "a"), fim, el("button", { class: "btn sm", onclick: aplicar }, "Aplicar"), fc, fcl, fa, fb, fs)));
    if (!r.ok) { v.append(el("div", { class: "note" }, "Carregando…")); return; }
    const L = r.lista, tot = L.reduce((x, a) => x + +a.horas, 0), cob = L.filter((a) => a.cobravel).reduce((x, a) => x + +a.horas, 0), val = L.reduce((x, a) => x + +a.valor, 0);
    const kpi = (l, v2, n) => el("div", { class: "card kpi" }, el("div", { class: "l" }, l), el("div", { class: "v" }, v2), n ? el("div", { class: "note" }, n) : null);
    v.append(el("div", { class: "kpis" }, kpi("Horas", hFmt(tot), `${L.length} lançamento(s)`), kpi("Cobráveis", hFmt(cob), tot ? Math.round(100 * cob / tot) + "% do total" : ""), kpi("Valor (tabela/hora)", BRL2(val), "só cobráveis"), kpi("Pendentes de aprovação", String(L.filter((a) => a.status !== "aprovado").length))));
    const grupo = (chave, rotulo, extra) => { const m = new Map(); for (const a of L) { const k = a[chave] || "—"; const g = m.get(k) || { h: 0, c: 0, v: 0, n: 0 }; g.h += +a.horas; if (a.cobravel) g.c += +a.horas; g.v += +a.valor; g.n++; m.set(k, g); }
      const rows = [...m.entries()].sort((a, b) => b[1].h - a[1].h);
      return el("div", { class: "card section", style: "flex:1;min-width:300px" }, el("h2", {}, rotulo), el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, rotulo), el("th", { class: "r" }, "Horas"), el("th", { class: "r" }, "Cobráveis"), el("th", { class: "r" }, "Valor"), el("th", { class: "r" }, "%"), ...(extra ? extra.cab.map((h) => el("th", { class: "r" }, h)) : []))),
        el("tbody", {}, ...rows.map(([k, g]) => el("tr", {}, el("td", {}, k), el("td", { class: "r num" }, hFmt(g.h)), el("td", { class: "r num" }, hFmt(g.c)), el("td", { class: "r num" }, BRL2(g.v)), el("td", { class: "r num" }, tot ? Math.round(100 * g.h / tot) + "%" : "—"), ...(extra ? extra.cel(k, g) : []))), rows.length ? el("tr", {}, el("td", {}, el("b", {}, "Total")), el("td", { class: "r num" }, el("b", {}, hFmt(tot))), el("td", { class: "r num" }, el("b", {}, hFmt(cob))), el("td", { class: "r num" }, el("b", {}, BRL2(val))), el("td", {}), ...(extra ? extra.cab.map(() => el("td", {})) : [])) : el("tr", {}, el("td", { colspan: 5, class: "note" }, "Sem lançamentos")))))); };
    // cliente: horas × contratadas × honorário (do cadastro do cliente)
    const cliExtra = { cab: ["Contratadas/mês", "Saldo", "Honorário mensal", "R$/h efetivo"], cel: (nome, g) => { const c = S.clientes.find((x) => x.nome === nome); const hc = c?.horas_contratadas_mes, hm = c?.honorario_mensal;
      return [el("td", { class: "r num" }, hc != null ? hFmt(hc) : "—"), el("td", { class: "r num", style: hc != null && hc - g.c < 0 ? "color:var(--crit);font-weight:600" : "" }, hc != null ? hFmt(hc - g.c) : "—"), el("td", { class: "r num" }, hm != null ? BRL2(hm) : "—"), el("td", { class: "r num" }, hm != null && g.c > 0 ? BRL2(hm / g.c) : "—")]; } };
    v.append(el("div", { style: "display:flex;gap:16px;flex-wrap:wrap" }, grupo("colaborador_nome", "Por colaborador"), grupo("atividade_nome", "Por atividade")));
    v.append(grupo("cliente_nome", "Por cliente", cliExtra));
    // por tarefa
    const mt = new Map(); for (const a of L) if (a.tarefa_id) { const g = mt.get(a.tarefa_id) || { t: a.tarefa_titulo, c: a.cliente_nome, h: 0, n: 0, quem: new Set() }; g.h += +a.horas; g.n++; g.quem.add(a.colaborador_nome); mt.set(a.tarefa_id, g); }
    const rowsT = [...mt.entries()].sort((a, b) => b[1].h - a[1].h).slice(0, 100);
    v.append(el("div", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Por tarefa"), el("span", { class: "note" }, "tempo gasto em cada tarefa no período")), el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Tarefa"), el("th", {}, "Cliente"), el("th", {}, "Quem"), el("th", { class: "r" }, "Lançamentos"), el("th", { class: "r" }, "Horas"))),
      el("tbody", {}, ...(rowsT.length ? rowsT.map(([id, g]) => el("tr", {}, el("td", {}, el("a", { href: "#tarefas/" + id, onclick: (ev) => { ev.preventDefault(); window.PP_TAREFAS?.abrir(id); } }, g.t || "(sem título)")), el("td", {}, g.c || "—"), el("td", { class: "note" }, [...g.quem].join(", ")), el("td", { class: "r num" }, String(g.n)), el("td", { class: "r num" }, hFmt(g.h)))) : [el("tr", {}, el("td", { colspan: 5, class: "note" }, "Nenhum lançamento vinculado a tarefa"))]))))));
    // detalhado + exportar
    v.append(el("div", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Lançamentos"), el("div", { class: "actions" }, el("button", { class: "btn sm", onclick: () => exportarCSV(L) }, "Exportar CSV"), el("button", { class: "btn sm primary", onclick: () => relatorioCliente() }, "Relatório para o cliente…"))),
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Data"), el("th", {}, "Colaborador"), el("th", {}, "Cliente"), el("th", {}, "Atividade"), el("th", {}, "Descrição"), el("th", { class: "r" }, "Horas"), el("th", {}, "Cobrável"), el("th", {}, "Status"), el("th", {}, ""))),
        el("tbody", {}, ...L.slice(0, 500).map((a) => el("tr", {}, el("td", {}, fmt(a.data), a.inicio ? el("div", { class: "note" }, a.inicio.slice(0, 5) + (a.fim ? "–" + a.fim.slice(0, 5) : "")) : null), el("td", {}, a.colaborador_nome), el("td", {}, a.cliente_nome || "—", a.numero_cnj ? el("div", { class: "note" }, a.numero_cnj) : null), el("td", {}, a.atividade_nome, a.tarefa_titulo ? el("div", { class: "note" }, a.tarefa_titulo) : null), el("td", { class: "note" }, a.descricao || ""), el("td", { class: "r num" }, hFmt(a.horas)), el("td", {}, a.cobravel ? "sim" : "não"), el("td", {}, el("span", { class: "pill " + STATUS[a.status][1], title: a.obs_gestor || "" }, STATUS[a.status][0])), el("td", {}, admin() || a.colaborador_id === meu()?.id ? el("button", { class: "btn sm", onclick: () => lancar({ ap: a }) }, "Editar") : null))))))));
  }
  function exportarCSV(L) {
    const cols = ["data", "inicio", "fim", "colaborador_nome", "cliente_nome", "numero_cnj", "atividade_nome", "tarefa_titulo", "descricao", "horas", "cobravel", "valor_hora", "valor", "status"];
    const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"'; const txt = [cols.join(";"), ...L.map((a) => cols.map((c) => esc(typeof a[c] === "number" ? String(a[c]).replace(".", ",") : a[c])).join(";"))].join("\n");
    const u = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" })); const a = el("a", { href: u, download: `timesheet_${H.rel.ini}_${H.rel.fim}.csv` }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  }
  // relatório imprimível para o cliente (só cobráveis, agrupado por dia)
  function relatorioCliente() {
    const r = H.rel; const cli = selCliente(r.cli, "— escolha o cliente —"), ini = inp("date", r.ini), fim = inp("date", r.fim), mostrarValor = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }), mostrarQuem = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }); mostrarQuem.checked = true;
    const body = el("div", { class: "form" }, field("rc-cli", "Cliente", cli), field("rc-ini", "De", ini), field("rc-fim", "Até", fim), el("div", { class: "f full note" }, "Entram só os lançamentos cobráveis. Abre em uma nova aba pronta para imprimir / salvar em PDF."),
      el("div", { class: "f" }, el("label", { style: "display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px" }, mostrarQuem, "Mostrar quem executou")), el("div", { class: "f" }, el("label", { style: "display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px" }, mostrarValor, "Mostrar valor por hora e total")));
    modal("Relatório de horas para o cliente", body, async () => {
      if (!cli.value) throw new Error("Escolha o cliente");
      const { data, error } = await SB.from("v_apontamentos").select("*").eq("cliente_id", cli.value).eq("cobravel", true).gte("data", ini.value).lte("data", fim.value).order("data").order("inicio", { nullsFirst: true }); if (error) throw new Error(error.message);
      const L = data || []; if (!L.length) throw new Error("Sem lançamentos cobráveis nesse período");
      const c = S.clientes.find((x) => x.id === cli.value); const tot = L.reduce((x, a) => x + +a.horas, 0), val = L.reduce((x, a) => x + +a.valor, 0);
      const e = (s) => String(s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
      const linhas = L.map((a) => `<tr><td>${fmt(a.data)}</td>${mostrarQuem.checked ? `<td>${e(a.colaborador_nome)}</td>` : ""}<td>${e(a.atividade_nome)}${a.numero_cnj ? `<div class=n>Processo ${e(a.numero_cnj)}</div>` : ""}</td><td>${e(a.descricao || "")}</td><td class=r>${hFmt(a.horas)}</td>${mostrarValor.checked ? `<td class=r>${BRL2(a.valor)}</td>` : ""}</tr>`).join("");
      const html = `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>Relatório de horas — ${e(c?.nome)}</title><style>
        body{font-family:Georgia,serif;color:#0C1F38;margin:32px 40px;font-size:13px}h1{font-size:20px;margin:0 0 2px;color:#0C1F38}h2{font-size:12px;font-weight:400;color:#555;margin:0 0 20px;font-family:Arial,sans-serif}
        .cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #B8964A;padding-bottom:12px;margin-bottom:18px}.marca{font-size:16px;font-weight:700;letter-spacing:.04em}.marca small{display:block;font-family:Arial,sans-serif;font-weight:400;font-size:11px;color:#555;letter-spacing:0}
        table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px}th{text-align:left;background:#0C1F38;color:#fff;padding:7px 8px;font-weight:600}td{padding:7px 8px;border-bottom:1px solid #e4e4e4;vertical-align:top}.r{text-align:right;white-space:nowrap}.n{color:#666;font-size:11px}
        tfoot td{font-weight:700;border-top:2px solid #B8964A;border-bottom:0}.rod{margin-top:28px;font-family:Arial,sans-serif;font-size:11px;color:#666}@media print{body{margin:16mm 14mm}}</style></head><body>
        <div class=cab><div class=marca>NEVES PÁDUA ADVOCACIA<small>OAB/SP 488.803 · Relatório de horas trabalhadas</small></div><div style="text-align:right;font-family:Arial,sans-serif;font-size:12px"><b>${e(c?.nome)}</b><br>Período: ${fmt(ini.value)} a ${fmt(fim.value)}<br>Emitido em ${new Date().toLocaleDateString("pt-BR")}</div></div>
        <h1>Horas dedicadas ao cliente</h1><h2>${L.length} atividade(s) registradas no período</h2>
        <table><thead><tr><th>Data</th>${mostrarQuem.checked ? "<th>Profissional</th>" : ""}<th>Atividade</th><th>Descrição</th><th class=r>Horas</th>${mostrarValor.checked ? "<th class=r>Valor</th>" : ""}</tr></thead><tbody>${linhas}</tbody>
        <tfoot><tr><td colspan=${2 + (mostrarQuem.checked ? 1 : 0)}>Total</td><td></td><td class=r>${hFmt(tot)}</td>${mostrarValor.checked ? `<td class=r>${BRL2(val)}</td>` : ""}</tr></tfoot></table>
        <div class=rod>Horas registradas no sistema interno do escritório. ${mostrarValor.checked ? "Valores calculados pela tabela de honorários por hora vinculada ao contrato." : ""}</div>
        <script>setTimeout(()=>window.print(),400)</script></body></html>`;
      const w = window.open("", "_blank"); if (!w) throw new Error("O navegador bloqueou a janela — permita pop-ups para este site"); w.document.write(html); w.document.close();
    });
    const btn = $("#modalHost button.btn.primary"); if (btn) btn.textContent = "Gerar";
  }

  // ---------- Aprovação (admin) ----------
  function renderApr(v) {
    const A = H.apr; if (!A.ok) carregarApr();
    const fc = Object.assign(selColab(A.colab, "Todos os colaboradores"), { onchange: (e) => { A.colab = e.target.value; A.ok = false; render(); } });
    const obs = inp("text", "", { placeholder: "Observação para a correção (obrigatória ao devolver)", style: "min-width:320px" });
    const agir = async (status) => { const ids = [...A.sel]; if (!ids.length) { toast("Marque os lançamentos"); return; } if (status === "correcao" && !obs.value.trim()) { toast("Escreva o que precisa corrigir"); return; }
      const { data, error } = await SB.rpc("ts_aprovar", { p_ids: ids, p_status: status, p_obs: obs.value.trim() || null }); if (error) { toast(error.message); return; } toast(`${data} lançamento(s) ${status === "aprovado" ? "aprovados" : "devolvidos"}`); A.sel.clear(); inval(); render(); };
    const todos = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }); todos.onchange = () => { if (todos.checked) A.lista.forEach((a) => A.sel.add(a.id)); else A.sel.clear(); render(); };
    v.append(el("div", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Lançamentos a aprovar"), el("span", { class: "note" }, `${A.lista.length} pendente(s) · ${A.sel.size} marcado(s)`)),
      el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px" }, fc, obs, el("button", { class: "btn sm primary", onclick: () => agir("aprovado") }, "✓ Aprovar marcados"), el("button", { class: "btn sm", onclick: () => agir("correcao") }, "↩ Devolver para correção")),
      !A.ok ? el("div", { class: "note" }, "Carregando…") : el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, todos), el("th", {}, "Data"), el("th", {}, "Colaborador"), el("th", {}, "Cliente"), el("th", {}, "Atividade"), el("th", {}, "Descrição"), el("th", { class: "r" }, "Horas"), el("th", {}, "Cobrável"), el("th", {}, "Status"))),
        el("tbody", {}, ...(A.lista.length ? A.lista.map((a) => { const c = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }); c.checked = A.sel.has(a.id); c.onchange = () => { if (c.checked) A.sel.add(a.id); else A.sel.delete(a.id); };
          return el("tr", {}, el("td", {}, c), el("td", {}, fmt(a.data), a.inicio ? el("div", { class: "note" }, a.inicio.slice(0, 5) + (a.fim ? "–" + a.fim.slice(0, 5) : "")) : null), el("td", {}, a.colaborador_nome), el("td", {}, a.cliente_nome || "—"), el("td", {}, a.atividade_nome, a.tarefa_titulo ? el("div", { class: "note" }, a.tarefa_titulo) : null), el("td", { class: "note" }, a.descricao || ""), el("td", { class: "r num" }, hFmt(a.horas)), el("td", {}, a.cobravel ? "sim" : "não"), el("td", {}, el("span", { class: "pill " + STATUS[a.status][1], title: a.obs_gestor || "" }, STATUS[a.status][0]))); }) : [el("tr", {}, el("td", { colspan: 9, class: "note" }, "Nada pendente."))]))))));
  }

  // ---------- Configurações (admin) ----------
  function renderCfg(v) {
    // atividades
    const nova = inp("text", "", { placeholder: "Nova atividade…" });
    const ativ = el("div", { class: "card section" }, el("h2", {}, "Atividades"), el("div", { class: "note" }, "Catálogo usado nos lançamentos. “Cobrável por padrão” define o valor inicial da caixa ao lançar."),
      el("div", { class: "tbl", style: "margin-top:8px" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Atividade"), el("th", {}, "Cobrável por padrão"), el("th", {}, "Ativa"))), el("tbody", {}, ...H.ativ.map((a) => el("tr", {}, el("td", {}, a.nome, el("div", { class: "note" }, a.codigo)),
        el("td", {}, chk("", a.cobravel_padrao, async (val) => { await SB.from("ts_atividades").update({ cobravel_padrao: val }).eq("codigo", a.codigo); a.cobravel_padrao = val; })), el("td", {}, chk("", a.ativa, async (val) => { await SB.from("ts_atividades").update({ ativa: val }).eq("codigo", a.codigo); a.ativa = val; }))))))),
      el("div", { class: "actions", style: "justify-content:flex-start;margin-top:8px" }, nova, el("button", { class: "btn sm", onclick: async () => { const n = nova.value.trim(); if (!n) return; const codigo = n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); const { error } = await SB.from("ts_atividades").insert({ codigo, nome: n, ordem: H.ativ.length + 1 }); if (error) { toast(error.message); return; } H.ok = false; render(); } }, "+ Adicionar")));
    // tabelas de hora
    const tn = inp("text", "", { placeholder: "Nome da tabela" }), tv = inp("number", "", { step: "0.01", min: 0, placeholder: "R$/hora", style: "width:120px" });
    const tabs = el("div", { class: "card section" }, el("h2", {}, "Tabelas de valor por hora"), el("div", { class: "note" }, "Cada cliente aponta para uma tabela; a marcada como padrão vale para quem não tem tabela. É a base do valor no relatório ao cliente."),
      el("div", { class: "tbl", style: "margin-top:8px" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Tabela"), el("th", {}, "R$/hora"), el("th", {}, "Padrão"), el("th", {}, "Ativa"))), el("tbody", {}, ...H.tabelas.map((t) => { const vi = inp("number", t.valor_hora, { step: "0.01", min: 0, style: "width:120px" }); vi.onchange = async () => { const { error } = await SB.from("ts_tabelas_hora").update({ valor_hora: +vi.value || 0 }).eq("id", t.id); toast(error ? error.message : "Salvo"); };
        return el("tr", {}, el("td", {}, t.nome), el("td", {}, vi), el("td", {}, chk("", t.padrao, async (val) => { if (val) await SB.from("ts_tabelas_hora").update({ padrao: false }).neq("id", t.id); await SB.from("ts_tabelas_hora").update({ padrao: val }).eq("id", t.id); H.ok = false; render(); })), el("td", {}, chk("", t.ativa, async (val) => { await SB.from("ts_tabelas_hora").update({ ativa: val }).eq("id", t.id); t.ativa = val; }))); })))),
      el("div", { class: "actions", style: "justify-content:flex-start;margin-top:8px" }, tn, tv, el("button", { class: "btn sm", onclick: async () => { if (!tn.value.trim()) return; const { error } = await SB.from("ts_tabelas_hora").insert({ nome: tn.value.trim(), valor_hora: +tv.value || 0 }); if (error) { toast(error.message); return; } H.ok = false; render(); } }, "+ Adicionar")));
    // por cliente
    const clis = [...S.clientes].filter((c) => c.ativo !== false).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    const porCli = el("div", { class: "card section" }, el("h2", {}, "Por cliente: tabela, horas contratadas e honorário"), el("div", { class: "note" }, "Horas contratadas/mês e honorário mensal alimentam a comparação “horas gastas × contrato” no relatório por cliente. Deixe em branco quando não se aplica."),
      el("div", { class: "tbl", style: "margin-top:8px" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Cliente"), el("th", {}, "Tabela de hora"), el("th", {}, "Horas contratadas/mês"), el("th", {}, "Honorário mensal (R$)"))), el("tbody", {}, ...clis.map((c) => { const st = sel({ "": "— padrão —", ...Object.fromEntries(H.tabelas.filter((t) => t.ativa).map((t) => [t.id, t.nome + " (" + BRL2(t.valor_hora) + ")"])) }, c.tabela_hora_id || ""), hc = inp("number", c.horas_contratadas_mes ?? "", { step: "0.5", min: 0, style: "width:110px" }), hm = inp("number", c.honorario_mensal ?? "", { step: "0.01", min: 0, style: "width:140px" });
        const salvar = async () => { const row = { tabela_hora_id: st.value || null, horas_contratadas_mes: hc.value === "" ? null : +hc.value, honorario_mensal: hm.value === "" ? null : +hm.value }; const { error } = await SB.from("clientes").update(row).eq("id", c.id); if (error) toast(error.message); else { Object.assign(c, row); toast("Salvo"); } }; st.onchange = hc.onchange = hm.onchange = salvar;
        return el("tr", {}, el("td", {}, c.nome), el("td", {}, st), el("td", {}, hc), el("td", {}, hm)); })))));
    v.append(ativ, tabs, porCli);
  }

  // ---------- render da aba Horas (substitui o conteúdo do tarefas.js) ----------
  function renderHoras() {
    const v = $("#view-horas"); if (!v) return; v.replaceChildren();
    if (!H.ok) { v.append(el("div", { class: "note" }, "Carregando…")); carregarBase().then(render); return; }
    v.append(el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Equipe"), el("h1", {}, "Timesheet"), el("div", { class: "sub" }, "Horas por colaborador, cliente, atividade e tarefa — com cronômetro, cobrável × não cobrável e aprovação do gestor.")),
      el("div", { class: "actions" }, el("button", { class: "btn primary", onclick: () => lancar({}) }, "+ Lançar horas"))));
    const b = (k, l) => el("button", { class: "btn sm" + (H.aba === k ? " primary" : ""), onclick: () => { H.aba = k; render(); } }, l);
    const eq = typeof PP.temAcesso === "function" ? PP.temAcesso("equipe") : admin();
    v.append(el("div", { class: "actions", style: "justify-content:flex-start;margin:-6px 0 10px" }, b("semana", "Minha semana"), eq ? b("rel", "Relatórios") : null, admin() ? b("apr", "Aprovação") : null, admin() ? b("cfg", "Configurações") : null));
    if (H.aba === "rel" && !eq) H.aba = "semana"; if ((H.aba === "apr" || H.aba === "cfg") && !admin()) H.aba = "semana";
    ({ semana: renderSemana, rel: renderRel, apr: renderApr, cfg: renderCfg })[H.aba](v);
  }
  { const _r = render; render = function () { _r(); if (S.tab === "horas") renderHoras(); }; }
  window.PP_TS = { lancar, iniciarCron, invalidar: inval };
  window.__PP_LOGIN?.then(() => { if (typeof equipe === "function" && equipe()) { const ch = SB.channel("timesheet"); ch.on("postgres_changes", { event: "*", schema: "public", table: "apontamentos_horas" }, () => { inval(); if (S.tab === "horas") render(); }); ch.on("postgres_changes", { event: "*", schema: "public", table: "ts_cronometros" }, () => { H.ok = false; if (S.tab === "horas") render(); }); ch.subscribe(); } });
})();
