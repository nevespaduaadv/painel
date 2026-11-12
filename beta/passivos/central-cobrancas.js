/* Central de Cobranças (Financeiro → aba "Central de Cobranças") — porte do artefato "Central de Cobranças" para o sistema.
   Base: cobranças do Asaas (v_central_cobrancas, 0076). Abas: Ações de hoje · Disparos da régua · Régua · Cadência (histórico) · Resumo · Dashboard.
   Supabase: v_central_cobrancas, v_cobranca_contatos, cobranca_checks, regua_etapas, regua_disparos; rpcs cobranca_registrar_contato,
   cobranca_marcar_paga, regua_preparar, regua_aprovar, regua_cancelar. */
(() => {
  "use strict";
  const C = { ok: false, carregando: false, rows: [], log: [], etapas: [], disparos: [], colab: [], hist: [], aba: "hoje", busca: "", reguaF: "todas", reguaEtapa: "todas", logF: "todas", listaF: "todas", negF: "todas", histCli: "", dashView: "geral", edit: null, nova: false, detalhe: null, conta: null, asaasCli: null, asaasQ: "" };
  const MEIOS = { whatsapp: "WhatsApp", ligacao: "Ligação", email: "E-mail", presencial: "Presencial", sistema: "Sistema", outro: "Outro" };
  const ACOES_SUGERIDAS = ["Lembrete amigável", "Cobrança formal", "Reenvio do boleto/link", "Proposta de parcelamento", "Proposta de desconto para quitação", "Aviso de suspensão do serviço", "Notificação extrajudicial", "Encaminhado ao jurídico", "Ligação sem atendimento", "Visita/reunião"];
  const podeFin = () => PP.perfil?.papel === "admin" || (PP.perfil?.acessos || []).includes("financeiro");
  const R$ = (v) => (v == null || isNaN(v)) ? "—" : (+v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const pad = (n) => String(n).padStart(2, "0");
  const hojeISO = () => { const d = new Date(Date.now() - 3 * 3600e3); return d.toISOString().slice(0, 10); };
  const parseISO = (s) => { const p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const addDias = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const diasEntre = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5);
  const fmtD = (iso) => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
  const fmtDM = (iso) => iso ? iso.slice(5, 10).split("-").reverse().join("/") : "—";
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const fmtMes = (m) => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;
  const nomeMes = (m) => MESES[+m.slice(5, 7) - 1];
  const norm = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
  const DESF = { RECUPERADO: ["Recuperado", "e1"], NAO_RESPONDE: ["Não responde", "e3"], VERIFICAR_AMANHA: ["Verificar amanhã", "g"], NEGOCIOU: ["Negociou", "c"], SEM_ACORDO: ["Sem acordo", "e3"] };
  const CAD = { FILA_HOJE: ["Na fila de contato", "g"], MONITORANDO: ["Não responde", "e3"], NEGOCIOU: ["Negociou", "c"], CONTATADA_HOJE: ["Contatado hoje", "e1"] };
  const DISP_ST = { solicitado: ["Solicitado", "g"], aguardando_aprovacao: ["Aguardando aprovação", "e3"], em_andamento: ["Em andamento", "g"], concluida: ["Concluída", "e1"], sem_clientes: ["Sem clientes", "c"], falhou: ["Falhou", "e3"], cancelada: ["Cancelada", "c"] };
  const pill = (t, cls) => el("span", { class: "pill " + (cls || "c") }, t);
  let HOJE = hojeISO();
  const mesAtual = () => HOJE.slice(0, 7);
  const mesAnterior = () => { const [y, m] = mesAtual().split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };

  // ---------- carga ----------
  async function carregar() {
    if (C.carregando) return; C.carregando = true; HOJE = hojeISO();
    try {
      const desde = addDias(mesAnterior() + "-01", -1);
      const pag = async (q) => { const out = []; for (let i = 0; i < 10; i++) { const { data, error } = await q.range(i * 1000, i * 1000 + 999); if (error) throw error; out.push(...(data || [])); if ((data || []).length < 1000) break; } return out; };
      const [ab, pg, lg, et, dp, co, hs] = await Promise.all([
        pag(SB.from("v_central_cobrancas").select("*").eq("paga", false).order("venc_ef")),
        pag(SB.from("v_central_cobrancas").select("*").eq("paga", true).gte("venc_ef", desde).order("venc_ef")),
        SB.from("v_cobranca_contatos").select("*").order("data", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
        SB.from("regua_etapas").select("*").order("dias", { ascending: false }),
        SB.from("regua_disparos").select("*").order("data", { ascending: false }).order("etapa").limit(200),
        SB.from("colaboradores").select("id,nome,nucleo,ativo").eq("ativo", true).order("nome"),
        SB.from("v_cobranca_historico").select("*").order("quando", { ascending: false }).limit(3000),
      ]);
      if (lg.error) throw lg.error;
      C.rows = [...ab, ...pg]; C.log = (lg.data || []).filter((l) => !l.origem || ["painel", "migracao"].includes(l.origem)); C.etapas = et.data || []; C.disparos = dp.data || []; C.colab = co.data || []; C.hist = hs.error ? [] : (hs.data || []); C.ok = true;
      if (hs.error) console.warn("histórico (rode a 0098)", hs.error.message);
    } catch (e) { console.warn("central", e); toast("Não foi possível carregar a Central de Cobranças"); }
    finally { C.carregando = false; }
    renderCentral();
  }
  const invalidar = () => { C.ok = false; renderCentral(); };

  // ---------- regras (porte do artefato) ----------
  const etapaLabel = (et) => `${et.codigo} · ${et.titulo}`;
  function stageInfo(c) {
    if (c.paga) return { situacao: "Paga", F: null, stage: "Paga", etapa: "Paga", acao: "Pago — nenhuma ação necessária" };
    const F = diasEntre(c.venc_ef, HOJE), situacao = F < 0 ? "Vencida" : "Aguardando";
    if (c.regua_parada) return { situacao, F, stage: "fora", etapa: "Retirada da régua" + (c.regua_manual_motivo ? " · " + c.regua_manual_motivo : ""), acao: "Fora da régua automática — acompanhar manualmente", manual: true };
    if (c.regua_etapa_manual) { const et = C.etapas.find((e) => e.codigo === c.regua_etapa_manual); return { situacao, F, stage: c.regua_etapa_manual, etapa: (et ? etapaLabel(et) : c.regua_etapa_manual) + " (fixada)", acao: et?.descricao || "Fixada manualmente nesta etapa", manual: true }; }
    const ativas = C.etapas.filter((e) => e.ativa);
    if (ativas.length) {
      let et = null;
      if (F >= 0) et = ativas.find((e) => e.dias === F) || null;
      else { const pos = ativas.filter((e) => e.dias < 0 && e.dias >= F).sort((a, b) => a.dias - b.dias); et = pos[0] || null; }
      if (et) return { situacao, F, stage: et.codigo, etapa: etapaLabel(et), acao: et.descricao || et.titulo };
      if (F >= 0) { const prox = ativas.filter((e) => e.dias >= 0 && e.dias < F).sort((a, b) => b.dias - a.dias)[0]; return { situacao, F, stage: "—", etapa: prox ? `Fora da régua (aguardando ${prox.codigo})` : "Fora da régua", acao: prox ? `Próxima ação em ${prox.codigo}, dia ${fmtDM(addDias(c.venc_ef, -prox.dias))}` : "Sem etapa prevista" }; }
      const prox = ativas.filter((e) => e.dias < 0 && e.dias < F).sort((a, b) => b.dias - a.dias)[0];
      return { situacao, F, stage: "—", etapa: prox ? `Vencida (aguardando ${prox.codigo})` : "Vencida (sem etapa)", acao: prox ? `Próxima ação em ${prox.codigo}, dia ${fmtDM(addDias(c.venc_ef, -prox.dias))}` : "Sem etapa prevista" };
    }
    let stage, etapa, acao;
    if (F > 5) { stage = "—"; etapa = "Fora da régua (pré D-5)"; acao = "Próxima ação em D-5, dia " + fmtDM(addDias(c.venc_ef, -5)); }
    else if (F === 5) { stage = "D-5"; etapa = "D-5 · Relatório mensal"; acao = "Enviar mensagem com o relatório mensal sobre o processo (vencimento em 5 dias)"; }
    else if (F === 2) { stage = "D-2"; etapa = "D-2 · Aviso de vencimento"; acao = "Enviar mensagem com o link do boleto e aviso de vencimento (faltam 2 dias)"; }
    else if (F === 0) { stage = "D-0"; etapa = "D-0 · Lembrete de pagamento"; acao = "Enviar lembrete simples informando o vencimento de hoje"; }
    else if (F > 0) { const px = F > 2 ? 2 : 0; stage = "—"; etapa = `Fora da régua (aguardando D-${px})`; acao = `Sem ação hoje — próxima em D-${px}, dia ${fmtDM(addDias(c.venc_ef, -px))}`; }
    else if (F > -3) { stage = "D+1"; etapa = "D+1 · 1º contato pós-vencimento"; acao = "Fazer o 1º contato pós-vencimento — cobrança amigável sobre o atraso"; }
    else if (F > -7) { stage = "D+3"; etapa = "D+3 · Solicitar previsão"; acao = "Enviar mensagem solicitando previsão de pagamento"; }
    else { stage = "D+7"; etapa = "D+7 · Contato do supervisor"; acao = "Supervisor faz contato, relembrando o débito e as consequências do não pagamento"; }
    return { situacao, F, stage, etapa, acao };
  }
  function cadStatus(c, logs) {
    if (c.paga) return { status: "PAGA", last: null };
    if (!logs.length) return { status: "FILA_HOJE", last: null };
    const last = logs[0];
    if (last.desfecho === "RECUPERADO") return { status: "RECUPERADO", last };
    if (last.desfecho === "NEGOCIOU") return { status: "NEGOCIOU", last };
    if (last.desfecho === "NAO_RESPONDE") return { status: "MONITORANDO", last };
    if (last.desfecho === "VERIFICAR_AMANHA") return { status: last.data === HOJE ? "CONTATADA_HOJE" : "FILA_HOJE", last };
    return { status: "FILA_HOJE", last };
  }
  function derivar() {
    const logMap = {}; for (const l of C.log) (logMap[l.cobranca_id] = logMap[l.cobranca_id] || []).push(l);
    return C.rows.map((c) => ({ c, info: stageInfo(c), logs: logMap[c.id] || [], cad: cadStatus(c, logMap[c.id] || []) }));
  }
  const isCarry = (r) => !r.c.paga && r.c.venc_ef.slice(0, 7) !== mesAtual() && r.c.negociada;
  const inScope = (r) => { const m = r.c.venc_ef.slice(0, 7), cur = mesAtual(); return m === cur || isCarry(r) || (m > cur && !r.c.paga && r.info.F !== null && r.info.F <= 5); };
  const busca = (nome) => !C.busca || String(nome || "").toLowerCase().includes(C.busca.toLowerCase());

  // ---------- render ----------
  function renderCentral() {
    const v = $("#view-financeiro"); if (!v) return;
    v.replaceChildren(cabecalho());
    if (!C.ok) { if (!C.carregando) carregar(); v.append(el("div", { class: "note" }, "Carregando a Central de Cobranças…")); return; }
    const all = derivar(), rows = all.filter(inScope);
    const cur = mesAtual();
    const monthLog = C.log.filter((l) => (l.data || "").slice(0, 7) === cur);
    const scoped = new Set(rows.map((r) => r.c.id));
    const viewLog = C.log.filter((l) => (l.data || "").slice(0, 7) === cur || scoped.has(l.cobranca_id));
    const pre = rows.filter((r) => !r.c.paga && ["D-5", "D-2", "D-0"].includes(r.info.stage)).length, fila = rows.filter((r) => !r.c.paga && r.info.situacao === "Vencida" && r.cad.status === "FILA_HOJE").length;
    const carry = rows.filter(isCarry).length, prox = rows.filter((r) => r.c.venc_ef.slice(0, 7) > cur && !isCarry(r)).length;
    v.append(el("div", { class: "tabs", style: "margin:4px 0 10px" }, [["hoje", `Ações de hoje (${pre + fila})`], ["disparos", "Disparos da régua"], ["regua", "Régua de cobrança"], ["negociados", `Negociados (${rows.filter((r) => !r.c.paga && (r.c.vencimento_negociado || r.c.valor_negociado)).length})`], ["historico", "Histórico por cliente"], ["cadencia", "Registros de contato"], ["resumo", "Resumo"], ["dashboard", "Dashboard"]].map(([k, t]) => el("button", { class: "tab", "aria-selected": String(C.aba === k), onclick: () => { C.aba = k; renderCentral(); } }, t))),
      el("div", { class: "note", style: "margin-bottom:10px" }, `Mostrando ${fmtMes(cur)}` + (carry ? ` + ${carry} parcela(s) negociada(s) de meses anteriores sem pagamento` : "") + (prox ? ` + ${prox} parcela(s) do próximo mês já na régua (D-5)` : "") + ". Base: cobranças do Asaas (sincronização automática). Meses anteriores ficam no histórico e na exportação."));
    const host = el("div", {}); v.append(host);
    if (C.aba === "hoje") renderHoje(host, rows);
    else if (C.aba === "disparos") renderDisparos(host, all);
    else if (C.aba === "regua") renderRegua(host, rows);
    else if (C.aba === "negociados") renderNegociados(host, all);
    else if (C.aba === "historico") renderHistorico(host, all);
    else if (C.aba === "cadencia") renderLog(host, viewLog);
    else if (C.aba === "resumo") renderResumo(host, rows, monthLog);
    else renderDashboard(host, rows, all, monthLog);
  }
  function cabecalho() {
    return el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Financeiro"), el("h1", {}, "Central de Cobranças"), el("div", { class: "sub" }, `Hoje · ${fmtD(HOJE)}. Lembretes de pré-vencimento, cadência de vencidas, disparos da régua pelo WhatsApp e controle de inadimplência.`)),
      el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => { S0.finSub = "asaas"; try { localStorage.setItem("pp-fin-sub", "asaas"); } catch (_) {} render(); } }, "← Cobranças (Asaas)"), el("button", { class: "btn", onclick: invalidar }, "Atualizar")));
  }
  const buscaBox = () => { const i = inp("search", C.busca, { placeholder: "Buscar cliente…", style: "min-width:220px" }); i.oninput = () => { C.busca = i.value; renderCentral(); const n = $("#view-financeiro input[type=search]"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }; return i; };

  // ----- HOJE -----
  function renderHoje(host, rows) {
    host.append(el("div", { class: "filters", style: "margin-bottom:10px" }, buscaBox()));
    const stages = [["D-5", "D-5 · Relatório mensal"], ["D-2", "D-2 · Aviso de vencimento"], ["D-0", "D-0 · Lembrete de pagamento"]];
    host.append(el("h3", {}, "Pré-vencimento — lembretes de hoje"), el("p", { class: "note" }, "Cobranças que ainda não venceram, mas entram na régua hoje. Marque quando o lembrete for enviado (ou use os Disparos da régua)."));
    host.append(el("div", { class: "kpis", style: "grid-template-columns:repeat(3,minmax(0,1fr))" }, stages.map(([k, label]) => {
      const items = rows.filter((r) => !r.c.paga && r.info.stage === k && busca(r.c.cliente_nome));
      const feitos = items.filter((r) => r.c.check_hoje).length;
      return el("div", { class: "card", style: "padding:12px" }, el("div", { style: "display:flex;justify-content:space-between;align-items:baseline" }, el("b", {}, label), el("span", { class: "num", style: "font-size:18px" }, items.length ? `${feitos}/${items.length}` : "0")),
        el("div", { class: "note", style: "margin:4px 0 8px" }, items.length ? items[0].info.acao : "Nenhuma ação neste estágio hoje."),
        el("div", { style: "max-height:220px;overflow:auto" }, items.map((r) => { const cb = el("input", { type: "checkbox", checked: r.c.check_hoje ? "" : null }); cb.onchange = async () => { const { error } = cb.checked ? await SB.from("cobranca_checks").insert({ data: HOJE, cobranca_id: r.c.id }) : await SB.from("cobranca_checks").delete().eq("data", HOJE).eq("cobranca_id", r.c.id); if (error) { toast(error.message); cb.checked = !cb.checked; return; } r.c.check_hoje = cb.checked; }; return el("label", { style: "display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line);cursor:pointer" + (r.c.check_hoje ? ";opacity:.6" : "") }, cb, el("span", { style: "flex:1" }, r.c.cliente_nome, el("span", { class: "note" }, " · " + r.c.parcela_txt)), el("span", { class: "num" }, R$(r.c.valor))); })));
    })));
    const fila = rows.filter((r) => !r.c.paga && r.info.situacao === "Vencida" && r.cad.status === "FILA_HOJE" && busca(r.c.cliente_nome)).sort((a, b) => a.info.F - b.info.F);
    host.append(el("h3", { style: "margin-top:18px" }, `Cadência de cobranças vencidas — ações de hoje (${fila.length})`), el("p", { class: "note" }, "Uma cobrança contatada hoje não volta a aparecer nesta fila hoje. Ela só retorna sozinha amanhã quando o desfecho for Verificar amanhã."));
    host.append(el("div", { class: "card", style: "padding:0" }, fila.length ? fila.map(itemFila) : el("div", { class: "note", style: "padding:14px" }, "Nenhuma cobrança vencida pendente de contato hoje.")));
    const mon = rows.filter((r) => !r.c.paga && r.cad.status === "MONITORANDO" && busca(r.c.cliente_nome)), neg = rows.filter((r) => !r.c.paga && r.cad.status === "NEGOCIOU" && busca(r.c.cliente_nome));
    host.append(el("details", { style: "margin-top:14px" }, el("summary", {}, `Em monitoramento (não responde) — ${mon.length}`), el("div", { class: "card", style: "padding:0" }, mon.length ? mon.map((r) => itemMono(r, false)) : el("div", { class: "note", style: "padding:12px" }, "Nenhum cliente em monitoramento."))),
      el("details", { style: "margin-top:8px" }, el("summary", {}, `Negociações em acompanhamento — ${neg.length}`), el("div", { class: "card", style: "padding:0" }, neg.length ? neg.map((r) => itemMono(r, true)) : el("div", { class: "note", style: "padding:12px" }, "Nenhuma negociação em acompanhamento."))));
  }
  const linhaBase = (r, extra) => el("div", { style: "display:grid;grid-template-columns:1.6fr .9fr 1fr 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)" }, el("div", {}, el("b", {}, r.c.cliente_nome), el("div", { class: "note" }, r.c.parcela_txt, r.c.descricao && r.c.descricao !== r.c.parcela_txt ? " · " + r.c.descricao : "")), el("div", {}, el("b", { class: "num" }, R$(r.c.valor)), el("div", { class: "note" }, r.info.F < 0 ? `${-r.info.F} dia(s) vencido` : `vence ${fmtD(r.c.venc_ef)}`)), ...extra);
  function itemFila(r) {
    const last = r.cad.last; const slot = el("div", {});
    const wrap = el("div", {}, linhaBase(r, [el("div", {}, el("div", { class: "note" }, "Última cobrança"), el("div", {}, last ? fmtD(last.data) : "Nunca contatado")), el("div", {}, last ? pill(DESF[last.desfecho][0], DESF[last.desfecho][1]) : pill("—")), el("div", { style: "display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end" }, el("button", { class: "btn sm primary", onclick: () => { if (slot.childElementCount) { slot.replaceChildren(); return; } slot.replaceChildren(formContato(r, () => slot.replaceChildren())); } }, "Registrar contato"), el("button", { class: "btn sm", onclick: () => formTarefa(r) }, "+ Tarefa"), menuRegua(r))]), chipsTarefas(r) ? el("div", { style: "padding:0 12px 6px" }, chipsTarefas(r)) : null, slot);
    return wrap;
  }
  function itemMono(r, neg) {
    const last = r.cad.last;
    return linhaBase(r, [el("div", { class: "note", style: "grid-column:span 2" }, "Última cobrança: " + (last ? fmtD(last.data) : "—") + (last?.observacao ? " · " + last.observacao : "") + (r.c.vencimento_negociado ? ` · nova data ${fmtD(r.c.vencimento_negociado)}` : "")),
      el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end" }, neg ? el("button", { class: "btn sm primary", onclick: () => { if (!confirm("Marcar como paga (recuperada)?")) return; rpc("cobranca_registrar_contato", { p_cobranca: r.c.id, p_desfecho: "RECUPERADO", p_observacao: "Pago após negociação de nova data" }, "Cobrança marcada como recuperada."); } }, "Marcar paga (recuperada)") : null,
        el("button", { class: "btn sm", onclick: () => rpc("cobranca_registrar_contato", { p_cobranca: r.c.id, p_desfecho: "VERIFICAR_AMANHA", p_observacao: "Reaberto manualmente", p_data: addDias(HOJE, -1) }, "Cliente reaberto para a fila de hoje.") }, "Reabrir para a fila"))]);
  }
  async function rpc(f, args, msg) { const { error } = await SB.rpc(f, args); if (error) { toast(error.message); return false; } toast(msg); invalidar(); return true; }
  function formContato(r, fechar) {
    let escolhido = null; const data = inp("date", ""), valorNeg = inp("text", "", { placeholder: "Valor acordado (opcional)", style: "width:170px" }), obs = el("textarea", { rows: "2", placeholder: "Observação interna (opcional)", style: "width:100%" });
    const meio = sel(MEIOS, "whatsapp"); const acao = inp("text", "", { placeholder: "Medida tomada — ex.: lembrete amigável, proposta de parcelamento…", list: "cc-acoes", style: "flex:1;min-width:220px" });
    if (!$("#cc-acoes")) document.body.append(el("datalist", { id: "cc-acoes" }, ACOES_SUGERIDAS.map((a) => el("option", { value: a }))));
    const retorno = el("textarea", { rows: "2", placeholder: "Retorno do cliente — o que ele respondeu (ou \"sem retorno\")", style: "width:100%" });
    const negBox = el("div", { hidden: "", style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center" }, el("label", { class: "note" }, "Nova data acordada ", data), el("label", { class: "note" }, "Valor acordado ", valorNeg));
    const salvar = el("button", { class: "btn sm primary", disabled: "" }, "Salvar registro");
    const opts = el("div", { style: "display:grid;grid-template-columns:repeat(5,1fr);gap:6px" }, Object.entries(DESF).map(([k, [t, cls]]) => el("button", { class: "btn sm", onclick: (e) => { escolhido = k; [...opts.children].forEach((b) => b.classList.remove("primary")); e.currentTarget.classList.add("primary"); salvar.disabled = false; negBox.hidden = k !== "NEGOCIOU"; } }, t)));
    const numBRv = (t) => { const x = String(t || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."); const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
    salvar.onclick = async () => { if (!escolhido) return; if (!acao.value.trim()) { toast("Informe a medida tomada"); return; } salvar.disabled = true;
      if (await rpc("cobranca_registrar_contato", { p_cobranca: r.c.id, p_desfecho: escolhido, p_observacao: obs.value.trim() || null, p_nova_data: escolhido === "NEGOCIOU" && data.value ? data.value : null, p_meio: meio.value, p_acao: acao.value.trim(), p_retorno: retorno.value.trim() || null, p_valor_negociado: escolhido === "NEGOCIOU" ? numBRv(valorNeg.value) : null }, "Contato registrado.")) fechar(); else salvar.disabled = false; };
    return el("div", { class: "card", style: "margin:6px 12px 10px;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--surface-2)" },
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" }, el("span", { class: "note" }, "Meio"), meio, acao), retorno, el("div", { class: "note" }, "Desfecho"), opts, negBox, obs,
      el("div", { class: "actions" }, salvar, el("button", { class: "btn sm", onclick: fechar }, "Cancelar")));
  }
  // ----- ações sobre a régua (mover / retirar / devolver) e tarefa -----
  function menuRegua(r) {
    const etOpts = Object.fromEntries([["", "— escolher etapa —"], ...C.etapas.filter((e) => e.ativa).map((e) => [e.codigo, etapaLabel(e)])]);
    const abrir = () => {
      const s = sel(etOpts, r.c.regua_etapa_manual || ""), motivo = inp("text", r.c.regua_manual_motivo || "", { placeholder: "Motivo (opcional)" });
      const body = el("div", { class: "form" }, el("div", { class: "f full" }, el("label", {}, "Fixar nesta etapa da régua"), s, el("div", { class: "help" }, "A cobrança passa a receber o disparo dessa etapa, mesmo fora da data. Deixe vazio para voltar ao automático.")), field("mr-mot", "Motivo", motivo));
      const extra = el("div", { style: "display:flex;gap:6px" }, r.c.regua_parada ? el("button", { class: "btn", onclick: async () => { if (await rpc("cobranca_regua_definir", { p_cobranca: r.c.id, p_etapa: null, p_parada: false, p_motivo: motivo.value.trim() || null }, "Cobrança devolvida à régua.")) $("#modalHost").replaceChildren(); } }, "Devolver à régua") : el("button", { class: "btn danger", onclick: async () => { if (await rpc("cobranca_regua_definir", { p_cobranca: r.c.id, p_etapa: null, p_parada: true, p_motivo: motivo.value.trim() || null }, "Cobrança retirada da régua.")) $("#modalHost").replaceChildren(); } }, "Retirar da régua"));
      modal(`Régua · ${r.c.cliente_nome} · ${r.c.parcela_txt || ""}`, body, async () => { const { error } = await SB.rpc("cobranca_regua_definir", { p_cobranca: r.c.id, p_etapa: s.value || null, p_parada: s.value ? false : null, p_motivo: motivo.value.trim() || null }); if (error) throw new Error(error.message); toast(s.value ? `Fixada em ${s.value}` : "Voltou ao automático"); invalidar(); }, extra);
    };
    return el("button", { class: "btn sm", title: "Mover / retirar da régua", onclick: abrir }, r.c.regua_parada ? "Fora da régua ▾" : r.c.regua_etapa_manual ? `Fixada ${r.c.regua_etapa_manual} ▾` : "Mover ▾");
  }
  function formTarefa(r) {
    const tit = inp("text", `Cobrança: ${r.c.cliente_nome} · ${r.c.parcela_txt || R$(r.c.valor)}`), resp = sel(Object.fromEntries(C.colab.map((c) => [c.id, c.nome + (c.nucleo ? " · " + c.nucleo : "")])), C.colab[0]?.id || ""), prazo = inp("date", addDias(HOJE, 2)), nuc = sel({ financeiro: "Financeiro", juridico: "Jurídico", acordos: "Acordos", acompanhamento_pj: "Acompanhamento PJ", comercial: "Comercial", administrativo: "Administrativo" }, "financeiro"), desc = el("textarea", { rows: "3", placeholder: "O que a pessoa precisa fazer" });
    resp.onchange = () => { const c = C.colab.find((x) => x.id === resp.value); if (c?.nucleo && nuc.querySelector(`option[value="${c.nucleo}"]`)) nuc.value = c.nucleo; };
    const body = el("div", { class: "form" }, field("ct-tit", "Título", tit), field("ct-resp", "Responsável (qualquer pessoa)", resp), field("ct-prazo", "Prazo", prazo), field("ct-nuc", "Núcleo", nuc), el("div", { class: "f full" }, el("label", {}, "Descrição"), desc));
    modal("Criar tarefa a partir da cobrança", body, async () => { if (!tit.value.trim() || !resp.value || !prazo.value) throw new Error("Título, responsável e prazo são obrigatórios"); const { error } = await SB.rpc("cobranca_criar_tarefa", { p_cobranca: r.c.id, p_titulo: tit.value.trim(), p_responsavel: resp.value, p_prazo: prazo.value, p_descricao: desc.value.trim() || null, p_nucleo: nuc.value, p_prioridade: 2 }); if (error) throw new Error(error.message); toast("Tarefa criada"); invalidar(); window.PP_TAREFAS?.invalidar?.(); });
  }
  const chipsTarefas = (r) => (r.c.tarefas || []).length ? el("div", { style: "display:flex;gap:4px;flex-wrap:wrap;margin-top:3px" }, (r.c.tarefas || []).map((t) => el("span", { class: "pill " + (t.prazo && t.prazo < HOJE ? "e3" : "g"), title: t.titulo, style: "cursor:pointer", onclick: () => window.PP_TAREFAS?.abrir?.(t.id) }, `📋 ${t.responsavel || "?"} · ${fmtDM(t.prazo)}`))) : null;
  const btnHist = (r) => el("button", { class: "btn sm", onclick: () => { C.aba = "historico"; C.histCli = r.c.chave_cliente; renderCentral(); } }, "Histórico");

  // ----- DISPAROS -----
  function renderDisparos(host, all) {
    const dow = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][parseISO(HOJE).getDay()];
    host.append(el("p", { class: "note" }, `${fmtD(HOJE)} · ${dow}. Cada etapa gera uma prévia (quem recebe, quem fica de fora pelas regras); o envio só acontece depois da sua aprovação e sai pelo ChatGuru em horário comercial. Às sextas, D-5/D-2/D-0 incluem os vencimentos do fim de semana; às segundas, D+1 inclui o que venceu de sexta a domingo.`),
      el("div", { class: "actions", style: "margin:8px 0" }, el("button", { class: "btn sm", onclick: () => { C.nova = !C.nova; renderCentral(); } }, C.nova ? "Fechar" : "+ Nova cadência")));
    if (C.nova) host.append(formNovaCadencia());
    const grid = el("div", { class: "kpis", style: "grid-template-columns:repeat(2,minmax(0,1fr))" });
    for (const et of C.etapas.filter((e) => e.ativa)) {
      const hoje = C.disparos.find((d) => d.data === HOJE && d.etapa === et.codigo);
      const prev = previa(et, all), fora = prev.filter((r) => regraPrevista(et, r, all)).length;
      const st = hoje ? DISP_ST[hoje.status] : null;
      const card = el("div", { class: "card", style: "padding:14px;display:flex;flex-direction:column;gap:8px" },
        el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, pill(et.codigo, "e2"), el("b", {}, et.titulo), et.personalizada ? pill("Personalizada", "c") : null, et.automatica ? pill("automática 8h55", "g") : null),
        el("div", { class: "note" }, et.descricao || ""),
        el("div", {}, el("span", { class: "note" }, "Hoje: "), st ? pill(st[0], st[1]) : pill("Ainda não disparada hoje"), hoje ? el("span", { class: "note" }, ` · ${(hoje.enviados || []).length} enviada(s) · ${(hoje.nao_enviados || []).length} fora/falha` + (hoje.status === "aguardando_aprovacao" ? ` · ${(hoje.aptos || []).length} apto(s)` : "")) : null),
        el("div", {}, el("span", { class: "note" }, "Prévia: "), el("b", { class: "num" }, String(prev.length)), el("span", { class: "note" }, " cobrança(s) nesta etapa" + (fora ? ` · ${fora} devem ficar de fora pelas regras` : "")), prev.length ? el("div", { class: "note" }, prev.slice(0, 5).map((r) => r.c.cliente_nome).join(", ") + (prev.length > 5 ? ` e mais ${prev.length - 5}` : "")) : null));
      if (C.edit === et.codigo) {
        const ta = el("textarea", { rows: "8", style: "width:100%" }, et.mensagem || "");
        card.append(ta, el("div", { class: "note" }, "Campos: {parcela} {link} {vencimento} {valor} {quando} · *texto* fica em negrito no WhatsApp"),
          el("div", { class: "actions" }, el("button", { class: "btn sm primary", onclick: async () => { const { error } = await SB.from("regua_etapas").update({ mensagem: ta.value.replace(/\r\n/g, "\n").trim() || null, atualizado_em: new Date().toISOString(), atualizado_por: PP.perfil?.id }).eq("codigo", et.codigo); if (error) { toast(error.message); return; } toast("Mensagem salva"); C.edit = null; invalidar(); } }, "Salvar mensagem"), el("button", { class: "btn sm", onclick: () => { C.edit = null; renderCentral(); } }, "Cancelar")));
      } else {
        card.append(et.mensagem ? el("div", { class: "note", style: "white-space:pre-wrap;max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px" }, et.mensagem) : el("div", { class: "note", style: "color:var(--warn)" }, "Mensagem ainda não cadastrada. O disparo fica liberado depois que ela for salva."));
      }
      const podeDisparar = !!et.mensagem && (!hoje || !["em_andamento", "concluida", "aguardando_aprovacao"].includes(hoje.status));
      card.append(el("div", { class: "actions", style: "margin-top:auto;flex-wrap:wrap" },
        hoje?.status === "aguardando_aprovacao" ? el("button", { class: "btn sm primary", onclick: () => abrirDetalhe(et.codigo, HOJE) }, `Revisar e aprovar (${(hoje.aptos || []).length})`) : el("button", { class: "btn sm primary", disabled: podeDisparar ? null : "", onclick: async () => { if (!confirm(`Gerar a prévia da etapa ${et.codigo} para hoje? Nada é enviado antes da sua aprovação.`)) return; const { data, error } = await SB.rpc("regua_preparar", { p_etapa: et.codigo, p_data: HOJE }); if (error) { toast(error.message); return; } toast(data.status === "sem_clientes" ? "Nenhuma cobrança se encaixa hoje." : `${(data.aptos || []).length} cliente(s) aguardando sua aprovação.`); await carregar(); if (data.status !== "sem_clientes") abrirDetalhe(et.codigo, HOJE); } }, `Disparar ${et.codigo}`),
        C.edit === et.codigo ? null : el("button", { class: "btn sm", onclick: () => { C.edit = et.codigo; renderCentral(); } }, et.mensagem ? "Editar mensagem" : "Cadastrar mensagem"),
        el("button", { class: "btn sm", onclick: () => abrirDetalhe(et.codigo, HOJE) }, "Ver descritivo do dia"),
        PP.perfil?.papel === "admin" ? el("label", { class: "note", style: "display:flex;gap:4px;align-items:center" }, (() => { const cb = el("input", { type: "checkbox", checked: et.automatica ? "" : null }); cb.onchange = async () => { const { error } = await SB.from("regua_etapas").update({ automatica: cb.checked }).eq("codigo", et.codigo); if (error) { toast(error.message); cb.checked = !cb.checked; } else toast(cb.checked ? "Prévia automática nos dias úteis (8h55)" : "Só manual"); }; return cb; })(), "automática") : null,
        et.personalizada ? el("button", { class: "btn sm", onclick: async () => { if (!confirm(`Remover a cadência ${et.codigo}? O histórico de disparos continua guardado.`)) return; const { error } = await SB.from("regua_etapas").delete().eq("codigo", et.codigo); if (error) { toast(error.message); return; } toast("Cadência removida"); invalidar(); } }, "Remover") : null));
      grid.append(card);
    }
    host.append(grid);
    // histórico
    host.append(el("h3", { style: "margin-top:18px" }, `Histórico de disparos (${C.disparos.length})`), el("div", { class: "actions", style: "margin:6px 0" }, exportMensagens()));
    host.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Data", "Etapa", "Origem", "Situação", "Enviadas", "Fora/falhas", "Observação"].map((h) => el("th", {}, h)))),
      el("tbody", {}, C.disparos.length ? C.disparos.slice(0, 60).map((d) => el("tr", { style: "cursor:pointer", onclick: () => abrirDetalhe(d.etapa, d.data) }, el("td", {}, fmtD(d.data)), el("td", {}, pill(d.etapa, "e2")), el("td", { class: "note" }, d.origem === "agendada" ? "Automática" : d.origem === "migracao" ? "Central antiga" : "Botão"), el("td", {}, pill(...(DISP_ST[d.status] || [d.status, "c"]))), el("td", { class: "num" }, String((d.enviados || []).length)), el("td", { class: "num" }, String((d.nao_enviados || []).length)), el("td", { class: "note" }, d.motivo || ""))) : el("tr", {}, el("td", { colspan: "7", class: "note" }, "Nenhum disparo registrado ainda."))))));
  }
  function alvos(et) { const dow = parseISO(HOJE).getDay(), fs = [et.dias]; if (et.dias >= 0 && dow === 5) fs.push(et.dias + 1, et.dias + 2); if (et.dias < 0 && dow === 1) fs.push(et.dias - 1, et.dias - 2); return fs; }
  const previa = (et, all) => { const fs = alvos(et); return all.filter((r) => !r.c.paga && fs.includes(diasEntre(r.c.venc_ef, HOJE))); };
  function regraPrevista(et, r, all) {
    const outras = all.filter((x) => x.c.id !== r.c.id && !x.c.paga && x.c.chave_cliente === r.c.chave_cliente && x.c.venc_ef < HOJE);
    if (et.dias >= 0 && outras.length) return "inadimplente";
    if (et.dias < 0 && outras.some((x) => x.c.venc_ef < r.c.venc_ef)) return "já em cadência";
    if (!r.c.telefone) return "sem telefone";
    return "";
  }
  function formNovaCadencia() {
    const dias = inp("number", "3", { min: "0", max: "60", style: "width:80px" }), sent = sel({ depois: "dia(s) depois do vencimento", antes: "dia(s) antes do vencimento", dia: "no dia do vencimento" }, "depois"), tit = inp("text", "", { placeholder: "Ex.: Solicitar previsão de pagamento" }), desc = inp("text", "", { placeholder: "Opcional" }), msg = el("textarea", { rows: "7", style: "width:100%", placeholder: "Bom dia, tudo bem?\n\nSua parcela {parcela} venceu em {vencimento}…" });
    const cod = () => { const n = +dias.value || 0; const o = sent.value === "dia" ? 0 : sent.value === "antes" ? n : -n; return { o, c: o >= 0 ? "D-" + o : "D+" + (-o) }; };
    const hint = el("div", { class: "note" }); const upd = () => { dias.disabled = sent.value === "dia"; const { c } = cod(); hint.textContent = C.etapas.some((e) => e.codigo === c) ? `Já existe o quadro ${c}. Escolha outro dia.` : `Código do quadro: ${c}`; }; dias.oninput = upd; sent.onchange = upd; upd();
    return el("div", { class: "card", style: "padding:14px;margin-bottom:12px" }, el("h3", {}, "Nova cadência de disparo"), el("div", { class: "form" }, el("div", { class: "f" }, el("label", {}, "Quando disparar"), el("div", { style: "display:flex;gap:6px" }, dias, sent), hint), field("nc-tit", "Nome do quadro", tit), field("nc-desc", "Descrição", desc), el("div", { class: "f full" }, el("label", {}, "Mensagem"), msg, el("div", { class: "note" }, "Campos: {parcela} {link} {vencimento} {valor} {quando}"))),
      el("div", { class: "actions", style: "margin-top:8px" }, el("button", { class: "btn primary", onclick: async () => { const { o, c } = cod(); if (sent.value !== "dia" && !(+dias.value >= 1)) { toast("Informe um número de dias a partir de 1"); return; } if (C.etapas.some((e) => e.codigo === c)) { toast(`Já existe o quadro ${c}`); return; } if (!tit.value.trim() || !msg.value.trim()) { toast("Dê um nome e escreva a mensagem"); return; } const { error } = await SB.from("regua_etapas").insert({ codigo: c, titulo: tit.value.trim(), descricao: desc.value.trim() || (o > 0 ? `${o} dia(s) antes do vencimento.` : o === 0 ? "No dia do vencimento." : `${-o} dia(s) depois do vencimento.`), dias: o, mensagem: msg.value.replace(/\r\n/g, "\n").trim(), personalizada: true, atualizado_por: PP.perfil?.id }); if (error) { toast(error.message); return; } toast(`Cadência ${c} criada`); C.nova = false; invalidar(); } }, "Criar cadência"), el("button", { class: "btn", onclick: () => { C.nova = false; renderCentral(); } }, "Cancelar")));
  }
  function abrirDetalhe(etapa, data) {
    const d = C.disparos.find((x) => x.etapa === etapa && x.data === data); const et = C.etapas.find((e) => e.codigo === etapa);
    const host = $("#modalHost"); host.replaceChildren(); const close = () => host.replaceChildren();
    const body = el("div", {});
    const tabela = (cols, linhas) => el("div", { class: "tbl", style: "max-height:260px;overflow:auto" }, el("table", {}, el("thead", {}, el("tr", {}, ...cols.map((c) => el("th", {}, c)))), el("tbody", {}, linhas.map((l) => el("tr", {}, ...l.map((v) => el("td", {}, v)))))));
    if (d) {
      body.append(el("div", { class: "note" }, `${fmtD(d.data)} · `, pill(...(DISP_ST[d.status] || [d.status, "c"])), d.origem === "agendada" ? " · automática" : d.origem === "migracao" ? " · registro da Central antiga" : " · botão", d.aprovado_em ? ` · aprovado ${new Date(d.aprovado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "", d.motivo ? ` · ${d.motivo}` : ""));
      const aptos = d.aptos || [], env = d.enviados || [], nao = d.nao_enviados || [], fora = nao.filter((n) => !n.falha), falhas = nao.filter((n) => n.falha);
      if (d.status === "aguardando_aprovacao") body.append(el("h3", { style: "color:var(--good,#2e7d46)" }, `Vão receber depois da sua aprovação (${aptos.length})`), tabela(["Cliente", "Parcela", "Vencimento", "Valor", "Telefone"], aptos.map((a) => [a.cliente, a.parcela || "—", a.vencimento || "—", a.valor || "—", a.tel4 ? "final " + a.tel4 : "—"])));
      else if (env.length) body.append(el("h3", {}, `Receberam a mensagem (${env.length})`), tabela(["Cliente", "Parcela", "Vencimento", "Hora"], env.map((a) => [a.cliente, a.parcela || "—", a.vencimento || "—", a.hora || "—"])));
      else if (aptos.length && d.status === "em_andamento") body.append(el("h3", {}, `Na fila de envio (${aptos.length})`), tabela(["Cliente", "Parcela", "Vencimento"], aptos.map((a) => [a.cliente, a.parcela || "—", a.vencimento || "—"])));
      body.append(el("h3", { style: "margin-top:10px;color:var(--warn,#9c5a12)" }, `Ficaram de fora pelas regras (${fora.length})`), fora.length ? tabela(["Cliente", "Parcela", "Vencimento", "Motivo"], fora.map((a) => [a.cliente, a.parcela || "—", a.vencimento || "—", a.motivo || "—"])) : el("div", { class: "note" }, "Ninguém ficou de fora pelas regras."));
      body.append(el("h3", { style: "margin-top:10px;color:#b91c1c" }, `Falharam no envio (${falhas.length})`), falhas.length ? tabela(["Cliente", "Parcela", "Motivo"], falhas.map((a) => [a.cliente, a.parcela || "—", a.motivo || "—"])) : el("div", { class: "note" }, "Nenhuma falha de envio registrada."));
      const ex = aptos[0] || env[0]; if (ex && (ex.texto || ex.mensagem)) body.append(el("h3", { style: "margin-top:10px" }, `Mensagem (exemplo: ${ex.cliente})`), el("div", { class: "note", style: "white-space:pre-wrap;border:1px solid var(--line);border-radius:8px;padding:8px;max-height:200px;overflow:auto" }, ex.texto || ex.mensagem));
    } else {
      body.append(el("div", { class: "note" }, data === HOJE ? "Esta etapa ainda não rodou hoje. Clique em \"Disparar\" para gerar a prévia." : "Não há registro de disparo desta etapa neste dia."));
      if (et?.mensagem) body.append(el("h3", { style: "margin-top:10px" }, "Mensagem da etapa"), el("div", { class: "note", style: "white-space:pre-wrap;border:1px solid var(--line);border-radius:8px;padding:8px" }, et.mensagem));
    }
    const acoes = el("div", { class: "actions", style: "margin-top:12px" });
    if (d?.status === "aguardando_aprovacao") acoes.append(el("button", { class: "btn primary", onclick: async () => { if (!confirm(`Aprovar e enviar ${(d.aptos || []).length} mensagem(ns) da etapa ${etapa}?`)) return; const { data: r, error } = await SB.rpc("regua_aprovar", { p_disparo: d.id }); if (error) { toast(error.message); return; } toast(`${r.enfileiradas} mensagem(ns) na fila de envio.`); close(); invalidar(); } }, "Aprovar e enviar"), el("button", { class: "btn", onclick: async () => { if (!confirm("Cancelar este disparo?")) return; const { error } = await SB.rpc("regua_cancelar", { p_disparo: d.id }); if (error) { toast(error.message); return; } toast("Disparo cancelado"); close(); invalidar(); } }, "Cancelar disparo"));
    if (d?.status === "em_andamento") acoes.append(el("button", { class: "btn", onclick: async () => { if (!confirm("Cancelar as mensagens que ainda não saíram?")) return; const { error } = await SB.rpc("regua_cancelar", { p_disparo: d.id }); if (error) { toast(error.message); return; } toast("Pendentes canceladas"); close(); invalidar(); } }, "Cancelar pendentes"));
    acoes.append(el("button", { class: "btn", onclick: close }, "Fechar"));
    host.append(el("div", { class: "modal", onclick: (e) => { if (e.target.classList.contains("modal")) close(); } }, el("div", { class: "card", role: "dialog", style: "max-width:900px;width:min(900px,96vw)" }, el("h2", {}, `${etapa} · ${et?.titulo || "Etapa"} — descritivo do dia`), body, acoes)));
  }
  function exportMensagens() {
    const meses = [...new Set([mesAtual(), ...C.disparos.map((d) => (d.data || "").slice(0, 7))])].filter(Boolean).sort().reverse();
    const s = sel(Object.fromEntries(meses.map((m) => [m, fmtMes(m)])), mesAtual()); const inc = el("input", { type: "checkbox" });
    return el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, el("span", { class: "note" }, "Exportar mensagens por cliente:"), s, el("label", { class: "note" }, inc, " incluir quem ficou de fora e falhas"), el("button", { class: "btn sm", onclick: () => {
      const linhas = [];
      for (const d of C.disparos.filter((d) => (d.data || "").slice(0, 7) === s.value)) { const et = C.etapas.find((e) => e.codigo === d.etapa); for (const x of d.enviados || []) linhas.push([x.cliente, fmtD(d.data), x.hora || "", d.etapa, et?.titulo || "", x.parcela || "", x.vencimento || "", "Enviada", "", d.origem, (x.mensagem || "").replace(/\n/g, " ")]); if (inc.checked) for (const x of d.nao_enviados || []) linhas.push([x.cliente, fmtD(d.data), "", d.etapa, et?.titulo || "", x.parcela || "", x.vencimento || "", x.falha ? "Falhou" : "Não enviada (regra)", x.motivo || "", d.origem, ""]); }
      if (!linhas.length) { toast("Nenhuma mensagem registrada no mês"); return; }
      linhas.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      baixarCSV(linhas, ["Cliente", "Data", "Hora", "Etapa", "Nome da etapa", "Parcela", "Vencimento", "Situação", "Motivo", "Origem", "Mensagem"], `mensagens_regua_${s.value}.csv`);
    } }, "Exportar (.csv)"));
  }

  // ----- RÉGUA -----
  function renderRegua(host, rows) {
    const abertos = rows.filter((r) => !r.c.paga);
    // posição por etapa (parâmetros da régua) com quem tem tarefa
    const etapas = C.etapas.filter((e) => e.ativa).sort((a, b) => b.dias - a.dias);
    const grupos = [...etapas.map((e) => [e.codigo, etapaLabel(e), abertos.filter((r) => r.info.stage === e.codigo)]), ["—", "Fora da régua (sem ação hoje)", abertos.filter((r) => r.info.stage === "—")], ["fora", "Retiradas da régua", abertos.filter((r) => r.info.stage === "fora")]];
    host.append(el("div", { class: "kpis", style: "grid-template-columns:repeat(auto-fill,minmax(170px,1fr));margin-bottom:10px" }, grupos.map(([k, l, it]) => { const comT = it.filter((r) => (r.c.tarefas_abertas || 0) > 0).length; return el("div", { class: "card", style: "padding:10px;cursor:pointer" + (C.reguaEtapa === k ? ";outline:2px solid var(--gold)" : ""), onclick: () => { C.reguaEtapa = C.reguaEtapa === k ? "todas" : k; renderCentral(); } }, el("div", { class: "note" }, l), el("div", { style: "display:flex;justify-content:space-between;align-items:baseline" }, el("b", { class: "num", style: "font-size:20px" }, String(it.length)), el("span", { class: "note" }, R$(soma(it)))), comT ? el("div", { class: "note" }, `📋 ${comT} com tarefa aberta`) : null); })));
    host.append(el("div", { class: "filters", style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" }, buscaBox(), ...[["todas", "Todas"], ["Vencida", "Vencidas"], ["Aguardando", "Aguardando"], ["Paga", "Pagas"], ["comTarefa", "Com tarefa"], ["manual", "Fixadas/retiradas"]].map(([k, t]) => el("button", { class: "btn sm" + (C.reguaF === k ? " primary" : ""), onclick: () => { C.reguaF = k; renderCentral(); } }, t)), C.reguaEtapa !== "todas" ? el("button", { class: "btn sm", onclick: () => { C.reguaEtapa = "todas"; renderCentral(); } }, `Etapa: ${C.reguaEtapa} ✕`) : null));
    const lista = rows.filter((r) => (C.reguaF === "todas" || (C.reguaF === "comTarefa" ? (r.c.tarefas_abertas || 0) > 0 : C.reguaF === "manual" ? r.info.manual : r.info.situacao === C.reguaF)) && (C.reguaEtapa === "todas" || r.info.stage === C.reguaEtapa) && busca(r.c.cliente_nome)).sort((a, b) => a.c.venc_ef.localeCompare(b.c.venc_ef));
    host.append(el("div", { class: "note", style: "margin-bottom:6px" }, `${lista.length} cobrança(s). Use "Mover" para fixar uma cobrança em qualquer etapa (ou adicionar uma que está fora), retirar ou devolver à régua; "+ Tarefa" cria uma tarefa para qualquer pessoa da equipe a partir da cobrança.`), el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Cliente", "Descrição", "Vencimento", "Situação", "Etapa da régua", "Valor", "Tarefas", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, lista.length ? lista.map((r) => el("tr", {}, el("td", {}, el("b", {}, r.c.cliente_nome)), el("td", { class: "note" }, r.c.descricao || r.c.parcela_txt || ""), el("td", {}, fmtD(r.c.venc_ef), r.c.vencimento_negociado ? el("div", { class: "note" }, "negociado (orig. " + fmtD(r.c.vencimento) + ")") : null), el("td", {}, pill(r.info.situacao, r.info.situacao === "Paga" ? "e1" : r.info.situacao === "Vencida" ? "e3" : "g")), el("td", { class: "note" }, r.info.manual ? pill(r.info.etapa, r.c.regua_parada ? "e3" : "e2") : r.info.etapa), el("td", { class: "num" }, R$(r.c.valor)), el("td", {}, chipsTarefas(r) || el("span", { class: "note" }, "—")),
        el("td", {}, el("div", { style: "display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end" }, r.c.paga ? null : menuRegua(r), r.c.paga ? null : el("button", { class: "btn sm", onclick: () => formTarefa(r) }, "+ Tarefa"), btnHist(r), r.c.paga ? null : el("button", { class: "btn sm", onclick: () => { if (!confirm("Marcar esta cobrança como paga?")) return; r.cad.status === "NEGOCIOU" ? rpc("cobranca_registrar_contato", { p_cobranca: r.c.id, p_desfecho: "RECUPERADO", p_observacao: "Pago após negociação (marcado na Régua de Cobrança)", p_meio: "sistema", p_acao: "Baixa manual" }, "Cobrança marcada como recuperada.") : rpc("cobranca_marcar_paga", { p_cobranca: r.c.id }, "Cobrança marcada como paga."); } }, "Marcar paga"))))) : el("tr", {}, el("td", { colspan: "8", class: "note" }, "Nenhuma cobrança encontrada."))))),
      el("p", { class: "note", style: "margin-top:8px" }, "\"Marcar paga\" registra uma baixa manual na Central; a baixa oficial continua vindo do Asaas (webhook/sincronização). Os parâmetros da régua (etapas, dias e mensagens) são editados em Disparos da régua."));
  }
  // ----- NEGOCIADOS -----
  function renderNegociados(host, all) {
    const lista0 = all.filter((r) => r.c.vencimento_negociado || r.c.valor_negociado || r.c.negociada).map((r) => { const sit = r.c.paga ? "cumprida" : r.c.venc_ef < HOJE ? "descumprida" : "a_vencer"; const neg = C.hist.find((h) => h.cobranca_id === r.c.id && h.desfecho === "NEGOCIOU"); return { r, sit, neg }; });
    const SIT = { a_vencer: ["Aguardando a data", "g"], descumprida: ["Não cumpriu", "e3"], cumprida: ["Pagou", "e1"] };
    host.append(el("p", { class: "note" }, "Clientes que negociaram nova data ou valor. A situação muda sozinha: paga no Asaas = cumprida; passou da data sem pagar = não cumpriu (volta à fila de cobrança)."));
    host.append(el("div", { class: "kpis fin-kpis" }, ...Object.entries(SIT).map(([k, [t]]) => { const it = lista0.filter((x) => x.sit === k); return kpi(t, String(it.length), R$(it.reduce((a, x) => a + (+x.r.c.valor_negociado || +x.r.c.valor || 0), 0))); })));
    host.append(el("div", { class: "filters", style: "display:flex;gap:8px;flex-wrap:wrap;margin:10px 0" }, buscaBox(), ...[["todas", "Todas"], ...Object.entries(SIT).map(([k, [t]]) => [k, t])].map(([k, t]) => el("button", { class: "btn sm" + (C.negF === k ? " primary" : ""), onclick: () => { C.negF = k; renderCentral(); } }, t))));
    const lista = lista0.filter((x) => (C.negF === "todas" || x.sit === C.negF) && busca(x.r.c.cliente_nome)).sort((a, b) => (a.r.c.venc_ef || "").localeCompare(b.r.c.venc_ef || ""));
    host.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Cliente", "Parcela", "Venc. original", "Nova data", "Valor", "Valor acordado", "Situação", "Negociado em", "Retorno do cliente", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, lista.length ? lista.map(({ r, sit, neg }) => { const slot = el("tr", { hidden: "" }, el("td", { colspan: "10" })); return [el("tr", {}, el("td", {}, el("b", {}, r.c.cliente_nome)), el("td", { class: "note" }, r.c.parcela_txt || r.c.descricao || ""), el("td", {}, fmtD(r.c.vencimento)), el("td", {}, r.c.vencimento_negociado ? el("b", {}, fmtD(r.c.vencimento_negociado)) : "—"), el("td", { class: "num" }, R$(r.c.valor)), el("td", { class: "num" }, r.c.valor_negociado ? R$(r.c.valor_negociado) : "—"), el("td", {}, pill(...SIT[sit])), el("td", { class: "note" }, neg ? fmtD(neg.data) + (neg.por ? " · " + neg.por : "") : "—"), el("td", { class: "note" }, neg?.retorno || neg?.observacao || ""),
        el("td", {}, el("div", { style: "display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap" }, r.c.paga ? null : el("button", { class: "btn sm primary", onclick: () => { if (slot.hidden) { slot.firstChild.replaceChildren(formContato(r, () => { slot.hidden = true; })); slot.hidden = false; } else slot.hidden = true; } }, "Registrar contato"), btnHist(r), r.c.paga ? null : el("button", { class: "btn sm", onclick: () => { if (!confirm("Marcar como paga (recuperada)?")) return; rpc("cobranca_registrar_contato", { p_cobranca: r.c.id, p_desfecho: "RECUPERADO", p_observacao: "Pago após negociação", p_meio: "sistema", p_acao: "Baixa manual" }, "Cobrança marcada como recuperada."); } }, "Pagou")))), slot]; }).flat() : el("tr", {}, el("td", { colspan: "10", class: "note" }, "Nenhuma negociação registrada."))))));
  }
  // ----- HISTÓRICO POR CLIENTE -----
  function renderHistorico(host, all) {
    const clientes = {}; for (const r of all) { const g = clientes[r.c.chave_cliente] = clientes[r.c.chave_cliente] || { chave: r.c.chave_cliente, nome: r.c.cliente_nome, aberto: 0, n: 0 }; if (!r.c.paga) { g.aberto += +r.c.valor || 0; g.n++; } }
    for (const h of C.hist) if (!clientes[h.chave_cliente]) clientes[h.chave_cliente] = { chave: h.chave_cliente, nome: h.cliente_nome, aberto: 0, n: 0 };
    const lista = Object.values(clientes).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    const s = sel(Object.fromEntries([["", "— escolher cliente —"], ...lista.map((c) => [c.chave, `${c.nome}${c.n ? ` · ${c.n} em aberto (${R$(c.aberto)})` : ""}`])]), C.histCli || ""); s.onchange = () => { C.histCli = s.value; renderCentral(); };
    host.append(el("div", { class: "filters", style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center" }, el("span", { class: "note" }, "Cliente"), s));
    if (!C.histCli) { host.append(el("div", { class: "note" }, "Escolha um cliente para ver, mês a mês, cada ação de cobrança (manual ou automática), o retorno dado e as negociações.")); return; }
    const cli = clientes[C.histCli]; const hist = C.hist.filter((h) => h.chave_cliente === C.histCli); const cobs = all.filter((r) => r.c.chave_cliente === C.histCli);
    host.append(el("div", { class: "kpis fin-kpis" }, kpi("Cobranças em aberto", String(cobs.filter((r) => !r.c.paga).length), R$(soma(cobs.filter((r) => !r.c.paga)))), kpi("Contatos registrados", String(hist.filter((h) => h.tipo === "contato" && h.origem !== "regua" && h.origem !== "tarefa").length), "manuais"), kpi("Mensagens da régua", String(hist.filter((h) => h.tipo === "regua").length), "automáticas enviadas"), kpi("Negociações", String(hist.filter((h) => h.desfecho === "NEGOCIOU").length), "novas datas/valores acordados")));
    const porMes = {}; for (const h of hist) (porMes[(h.data || "").slice(0, 7)] = porMes[(h.data || "").slice(0, 7)] || []).push(h);
    const meses = Object.keys(porMes).sort().reverse();
    if (!meses.length) { host.append(el("div", { class: "note", style: "margin-top:10px" }, "Nenhuma ação de cobrança registrada para este cliente.")); return; }
    for (const m of meses) {
      host.append(el("h3", { style: "margin-top:14px" }, fmtMes(m), el("span", { class: "note" }, ` · ${porMes[m].length} ação(ões)`)));
      host.append(el("div", { class: "card", style: "padding:0" }, porMes[m].map((h) => el("div", { style: "display:grid;grid-template-columns:90px 1fr;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line)" }, el("div", {}, el("b", {}, fmtDM(h.data)), el("div", { class: "note" }, h.tipo === "regua" ? "régua" : MEIOS[h.meio] || h.meio || "—")),
        el("div", {}, el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" }, h.etapa ? pill(h.etapa, "e2") : null, h.desfecho && h.tipo === "contato" && h.origem !== "regua" && h.origem !== "tarefa" ? pill(...(DESF[h.desfecho] || [h.desfecho, "c"])) : null, el("b", {}, h.acao || h.proxima_acao || "—"), el("span", { class: "note" }, ` · ${h.parcela_txt || h.descricao || ""} · ${R$(h.valor)} · venc. ${fmtD(h.venc_ef)}`)),
          h.retorno ? el("div", {}, el("span", { class: "note" }, "Retorno do cliente: "), h.retorno) : null,
          h.nova_data || h.valor_negociado ? el("div", { class: "note" }, "Negociado: " + (h.nova_data ? "nova data " + fmtD(h.nova_data) : "") + (h.valor_negociado ? (h.nova_data ? " · " : "") + "valor " + R$(h.valor_negociado) : "")) : null,
          h.observacao && h.tipo !== "regua" ? el("div", { class: "note" }, h.observacao) : null,
          h.tipo === "regua" && h.observacao ? el("details", {}, el("summary", { class: "note" }, "mensagem enviada"), el("div", { class: "note", style: "white-space:pre-wrap" }, h.observacao)) : null,
          el("div", { class: "note" }, "por " + (h.por || "—")))))));
    }
  }

  // ----- HISTÓRICO -----
  function renderLog(host, viewLog) {
    host.append(el("div", { class: "filters", style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" }, buscaBox(), ...[["todas", "Todos os desfechos"], ...Object.entries(DESF).map(([k, [t]]) => [k, t])].map(([k, t]) => el("button", { class: "btn sm" + (C.logF === k ? " primary" : ""), onclick: () => { C.logF = k; renderCentral(); } }, t))));
    const lista = viewLog.filter((l) => (C.logF === "todas" || l.desfecho === C.logF) && busca(l.cliente_nome));
    host.append(el("div", { class: "note", style: "margin-bottom:6px" }, `${lista.length} registro(s)`), el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Data", "Cliente", "Valor", "Desfecho", "Próxima ação", "Observação", "Registrado por"].map((h) => el("th", {}, h)))),
      el("tbody", {}, lista.length ? lista.slice(0, 500).map((l) => el("tr", {}, el("td", {}, fmtD(l.data)), el("td", {}, el("b", {}, l.cliente_nome || "—")), el("td", { class: "num" }, R$(l.valor)), el("td", {}, pill(...DESF[l.desfecho])), el("td", { class: "note" }, l.proxima_acao || ""), el("td", { class: "note" }, l.observacao || ""), el("td", { class: "note" }, l.registrado_por_nome || (l.origem === "migracao" ? "Central antiga" : "—")))) : el("tr", {}, el("td", { colspan: "7", class: "note" }, "Nenhum registro encontrado."))))));
  }

  // ----- RESUMO -----
  const soma = (arr, f = (r) => +r.c.valor || 0) => arr.reduce((a, r) => a + f(r), 0);
  function renderResumo(host, rows, monthLog) {
    const cur = mesAtual(), rec = monthLog.filter((l) => l.desfecho === "RECUPERADO");
    const nr = rows.filter((r) => !r.c.paga && r.cad.status === "MONITORANDO").length, neg = rows.filter((r) => !r.c.paga && r.cad.status === "NEGOCIOU").length;
    const pre = rows.filter((r) => !r.c.paga && ["D-5", "D-2", "D-0"].includes(r.info.stage)).length, fila = rows.filter((r) => !r.c.paga && r.info.situacao === "Vencida" && r.cad.status === "FILA_HOJE").length;
    const abertos = rows.filter((r) => !r.c.paga), rowsMes = rows.filter((r) => r.c.venc_ef.slice(0, 7) === cur), vencMes = rowsMes.filter((r) => !r.c.paga && r.c.venc_ef < HOJE), aVencer = rowsMes.filter((r) => !r.c.paga && r.c.venc_ef >= HOJE), carry = rows.filter(isCarry), pagas = rowsMes.filter((r) => r.c.paga);
    host.append(el("div", { class: "kpis fin-kpis" }, kpi("Cobranças recuperadas no mês", String(rec.length), "registros com desfecho Recuperado"), kpi("Valor recuperado no mês", R$(rec.reduce((a, l) => a + (+l.valor || 0), 0)), "soma dos registros Recuperado"), kpi("Não responde", String(nr), "clientes em monitoramento"), kpi("Negociações", String(neg), "clientes com nova data"),
      kpi("Ações de hoje", String(pre + fila), `${pre} lembretes preventivos + ${fila} cobranças vencidas`), kpi("Vencido em aberto no mês", R$(soma(vencMes)), `${vencMes.length} parcela(s) vencidas e não pagas` + (carry.length ? ` · + ${R$(soma(carry))} em ${carry.length} negociação(ões) de meses anteriores` : "")), kpi("Já pago no mês", R$(soma(pagas)), `${pagas.length} cobrança(s) quitada(s)`), kpi("Cobranças no mês", String(rowsMes.length), `${fmtMes(cur)} · ${aVencer.length} a vencer (${R$(soma(aVencer))})`)));
    const stages = [["—", "Fora da régua (sem ação hoje)"], ["D-5", "D-5 · Relatório mensal"], ["D-2", "D-2 · Aviso de vencimento"], ["D-0", "D-0 · Lembrete de pagamento"], ["D+1", "D+1 · 1º contato pós-vencimento"], ["D+3", "D+3 · Solicitar previsão"], ["D+7", "D+7 · Contato do supervisor"]];
    host.append(el("div", { class: "card section", style: "margin-top:12px" }, el("h3", {}, "Posição na régua hoje"), el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Etapa da régua"), el("th", {}, "Clientes"), el("th", {}, "Valor em aberto"))), el("tbody", {}, ...stages.map(([k, l]) => { const it = abertos.filter((r) => r.info.stage === k); return el("tr", {}, el("td", {}, l), el("td", { class: "num" }, String(it.length)), el("td", { class: "num" }, R$(soma(it)))); }), el("tr", { style: "font-weight:700" }, el("td", {}, "Total não pago (vencidas + a vencer)"), el("td", { class: "num" }, String(abertos.length)), el("td", { class: "num" }, R$(soma(abertos)))))))));
    const counts = Object.fromEntries(Object.keys(DESF).map((d) => [d, monthLog.filter((l) => l.desfecho === d).length])); const max = Math.max(1, ...Object.values(counts));
    host.append(el("div", { class: "card section", style: "margin-top:12px" }, el("h3", {}, `Distribuição de desfechos · ${monthLog.length} registro(s) no mês`), ...Object.entries(DESF).map(([d, [t, cls]]) => el("div", { style: "display:grid;grid-template-columns:160px 1fr 50px;gap:10px;align-items:center;margin:6px 0" }, pill(t, cls), el("div", { style: "height:14px;border:1px solid var(--line);border-radius:5px;overflow:hidden" }, el("div", { style: `height:100%;width:${Math.round(counts[d] / max * 100)}%;background:var(--gold,#b8964a)` })), el("b", { class: "num" }, String(counts[d]))))));
    const fc = inp("text", "", { placeholder: "Nome do cliente (opcional)…" });
    host.append(el("div", { class: "card section", style: "margin-top:12px" }, el("h3", {}, "Exportar dados"), el("p", { class: "note" }, "Baixa um .csv com a base carregada (cobranças em aberto de qualquer mês + pagas desde o mês anterior) ou o histórico de cadência."), el("div", { class: "actions" }, fc, el("button", { class: "btn sm", onclick: () => { const f = fc.value.trim().toLowerCase(); const lin = C.rows.filter((c) => !f || (c.cliente_nome || "").toLowerCase().includes(f)).map((c) => { const i = stageInfo(c); return [c.cliente_nome, numBR(c.valor), c.descricao || "", c.venc_ef.slice(0, 7), fmtD(c.venc_ef), i.situacao, i.etapa, c.paga ? "Sim" : "Não"]; }); baixarCSV(lin, ["Cliente", "Valor", "Descrição", "Mês", "Vencimento", "Situação", "Estágio", "Paga"], "cobrancas.csv"); } }, "Exportar cobranças (.csv)"), el("button", { class: "btn sm", onclick: () => { const f = fc.value.trim().toLowerCase(); const lin = C.log.filter((l) => !f || (l.cliente_nome || "").toLowerCase().includes(f)).map((l) => [fmtD(l.data), l.cliente_nome || "", numBR(l.valor), DESF[l.desfecho][0], l.proxima_acao || "", l.observacao || "", l.registrado_por_nome || ""]); baixarCSV(lin, ["Data", "Cliente", "Valor", "Desfecho", "Próxima ação", "Observação", "Registrado por"], "historico_cadencia.csv"); } }, "Exportar histórico (.csv)"))));
  }
  const numBR = (v) => (+v || 0).toFixed(2).replace(".", ",");
  function baixarCSV(rows, headers, nome) { const cell = (v) => { v = v == null ? "" : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; const csv = "﻿" + [headers.map(cell).join(";"), ...rows.map((r) => r.map(cell).join(";"))].join("\r\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("Arquivo exportado."); }

  // ----- DASHBOARD -----
  function renderDashboard(host, rows, all, monthLog) {
    host.append(el("div", { class: "actions", style: "margin-bottom:12px" }, ...[["geral", "Visão geral"], ["lista", "Lista de clientes inadimplentes"]].map(([k, t]) => el("button", { class: "btn sm" + (C.dashView === k ? " primary" : ""), onclick: () => { C.dashView = k; renderCentral(); } }, t))));
    const cur = mesAtual(), prev = mesAnterior();
    if (C.dashView === "geral") {
      const rec = monthLog.filter((l) => l.desfecho === "RECUPERADO"), doMes = rows.filter((r) => r.c.venc_ef.slice(0, 7) === cur), abertoMes = doMes.filter((r) => !r.c.paga && r.c.venc_ef < HOJE), pagasMes = doMes.filter((r) => r.c.paga), carry = rows.filter(isCarry);
      const abertoV = soma(abertoMes), base = abertoV + soma(pagasMes), pct = base > 0 ? abertoV / base * 100 : 0;
      host.append(el("div", { class: "kpis fin-kpis" }, kpi("Cobranças recuperadas no mês", String(rec.length), `desfecho Recuperado em ${fmtMes(cur)}`), kpi("Valor recuperado no mês", R$(rec.reduce((a, l) => a + (+l.valor || 0), 0)), "soma dos registros Recuperado"), kpi("Total em aberto no mês", R$(abertoV), `${abertoMes.length} parcela(s) do mês vencidas e não pagas` + (carry.length ? ` · + ${R$(soma(carry))} em ${carry.length} negociação(ões) anteriores` : "")), kpi("% da carteira do mês em aberto", pct.toFixed(1).replace(".", ",") + "%", `dos recebidos + vencidos do mês até hoje (${R$(base)})`)));
      const prevAberto = all.filter((r) => r.c.venc_ef.slice(0, 7) === prev && !r.c.paga), prevV = soma(prevAberto);
      const uniq = (arr) => new Set(arr.map((r) => r.c.chave_cliente)).size;
      const barras = (a, b, la, lb, f) => { const max = Math.max(a, b, 1); const col = (v, l, cor) => el("div", { style: "flex:1;max-width:140px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" }, el("b", { class: "num" }, f(v)), el("div", { style: `width:56px;height:${Math.max(4, Math.round(v / max * 130))}px;background:${cor};border-radius:6px 6px 0 0` }), el("div", { class: "note", style: "margin-top:6px;text-align:center" }, l)); return el("div", { style: "display:flex;gap:30px;align-items:flex-end;height:190px;padding:0 14px;border-bottom:1px solid var(--line)" }, col(a, la, "#2f6690"), col(b, lb, "var(--gold,#b8964a)")); };
      const delta = (o, n, f, menorMelhor) => { const d = n - o, p = o > 0 ? Math.abs(d / o * 100).toFixed(1).replace(".", ",") + "%" : "—"; const bom = menorMelhor ? d < 0 : d > 0; return el("span", { class: "pill " + (d === 0 ? "c" : bom ? "e1" : "e3") }, `${d === 0 ? "=" : d < 0 ? "↓" : "↑"} ${p} vs. ${nomeMes(prev).toLowerCase()} (${d <= 0 ? "-" : "+"}${f(Math.abs(d))})`); };
      const la = nomeMes(prev), lb = `${nomeMes(cur)} (até ${fmtDM(HOJE)})`;
      host.append(el("div", { class: "kpis", style: "grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px" },
        el("div", { class: "card section" }, el("h3", {}, `Em aberto: ${la.toLowerCase()} x ${nomeMes(cur).toLowerCase()}`), barras(prevV, abertoV, la, lb, R$), el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;flex-wrap:wrap" }, el("span", { class: "note" }, "Parcelas vencidas e não pagas de cada mês. O mês atual ainda está em curso."), delta(prevV, abertoV, R$, true))),
        el("div", { class: "card section" }, el("h3", {}, `Clientes inadimplentes: ${la.toLowerCase()} x ${nomeMes(cur).toLowerCase()}`), barras(uniq(prevAberto), uniq(abertoMes), la, lb, (v) => String(Math.round(v))), el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;flex-wrap:wrap" }, el("span", { class: "note" }, "Clientes únicos com ao menos uma parcela do mês vencida e não paga."), delta(uniq(prevAberto), uniq(abertoMes), (v) => Math.round(v) + " cliente(s)", true)))));
      host.append(el("div", { class: "card section", style: "margin-top:12px" }, el("h3", {}, "Nota metodológica"), el("p", { class: "note" }, `Este painel mostra só ${fmtMes(cur)} (pelo vencimento da parcela) e as parcelas negociadas de meses anteriores que ainda não foram pagas. Em aberto = parcela já vencida e não paga; o % usa como base os recebidos + vencidos do mês até hoje. ${fmtMes(prev)} entra só como referência, calculado ao vivo a partir das cobranças do Asaas. Na virada do mês, o painel passa sozinho para o mês novo.`)));
      return;
    }
    // lista de inadimplentes
    const alvo = rows.filter((r) => !r.c.paga && (isCarry(r) || r.c.venc_ef < HOJE)); const byCli = {};
    for (const r of alvo) { const g = byCli[r.c.chave_cliente] = byCli[r.c.chave_cliente] || { nome: r.c.cliente_nome, parcelas: [], valor: 0, carry: false }; g.parcelas.push(r); g.valor += +r.c.valor || 0; if (isCarry(r)) g.carry = true; }
    const clientes = Object.values(byCli).map((g) => { g.parcelas.sort((a, b) => a.info.F - b.info.F); g.ref = g.parcelas[0]; g.atraso = g.ref.info.F < 0 ? -g.ref.info.F : null; g.status = g.ref.cad.status; g.last = g.parcelas.map((r) => r.cad.last).filter(Boolean).sort((a, b) => b.data.localeCompare(a.data))[0] || null; return g; });
    const nr = clientes.filter((g) => g.status === "MONITORANDO"), carry = clientes.filter((g) => g.carry);
    host.append(el("div", { class: "kpis fin-kpis" }, kpi("Clientes inadimplentes", String(clientes.length), `${alvo.length} parcela(s) em aberto`), kpi("Valor em aberto", R$(clientes.reduce((a, g) => a + g.valor, 0)), "parcelas vencidas + negociações sem solução"), kpi("Não respondem", String(nr.length), R$(nr.reduce((a, g) => a + g.valor, 0)) + " em aberto"), kpi("Negociações de meses anteriores", String(carry.length), carry.length ? R$(carry.reduce((a, g) => a + g.parcelas.filter(isCarry).reduce((x, r) => x + (+r.c.valor || 0), 0), 0)) + " sem pagamento" : "nenhuma pendente")));
    const counts = Object.fromEntries(Object.keys(CAD).map((k) => [k, clientes.filter((g) => g.status === k).length])); const max = Math.max(1, ...Object.values(counts));
    host.append(el("div", { class: "card section", style: "margin:12px 0" }, el("h3", {}, `Clientes por situação na cadência · ${clientes.length}`), ...Object.entries(CAD).map(([k, [t, cls]]) => el("div", { style: "display:grid;grid-template-columns:180px 1fr 40px;gap:10px;align-items:center;margin:6px 0" }, pill(t, cls), el("div", { style: "height:14px;border:1px solid var(--line);border-radius:5px;overflow:hidden" }, el("div", { style: `height:100%;width:${Math.round(counts[k] / max * 100)}%;background:var(--gold,#b8964a)` })), el("b", { class: "num" }, String(counts[k]))))));
    host.append(el("div", { class: "filters", style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px" }, buscaBox(), ...[["todas", "Todas"], ["FILA_HOJE", "Na fila"], ["MONITORANDO", "Não responde"], ["NEGOCIOU", "Negociou"], ["CONTATADA_HOJE", "Contatado hoje"], ["CARRY", "Meses anteriores"]].map(([k, t]) => el("button", { class: "btn sm" + (C.listaF === k ? " primary" : ""), onclick: () => { C.listaF = k; renderCentral(); } }, t))));
    const lista = clientes.filter((g) => (C.listaF === "todas" || (C.listaF === "CARRY" ? g.carry : g.status === C.listaF)) && busca(g.nome)).sort((a, b) => b.valor - a.valor);
    host.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Cliente", "Situação", "Parcelas", "Valor em aberto", "Dias de atraso", "Etapa", "Último contato"].map((h) => el("th", {}, h)))),
      el("tbody", {}, lista.length ? lista.map((g) => el("tr", {}, el("td", {}, el("b", {}, g.nome), g.carry ? pill("negociação de mês anterior", "c") : null), el("td", {}, pill(...(CAD[g.status] || [g.status, "c"]))), el("td", { class: "num" }, String(g.parcelas.length)), el("td", { class: "num" }, R$(g.valor)), el("td", { class: "num" }, g.atraso != null ? String(g.atraso) : "—"), el("td", { class: "note" }, g.ref.info.etapa), el("td", {}, g.last ? [pill(...DESF[g.last.desfecho]), el("span", { class: "note" }, ` ${fmtD(g.last.data)}${g.last.observacao ? " · " + g.last.observacao : ""}`)] : el("span", { class: "note" }, "Nunca contatado")))) : el("tr", {}, el("td", { colspan: "7", class: "note" }, "Nenhum cliente inadimplente neste recorte."))))),
      el("p", { class: "note", style: "margin-top:8px" }, "Lista ao vivo: entra quem tem parcela vencida e não paga, ou negociação de mês anterior ainda sem pagamento. Sai sozinha quando o Asaas confirma o pagamento."));
  }

  // ---------- integração com a aba Financeiro ----------
  const S0 = S;
  function barraSub() {
    return el("div", { class: "tabs", style: "margin-bottom:10px" }, [["asaas", "Cobranças (Asaas)"], ["central", "Central de Cobranças"], ["clientes", "Clientes (Asaas)"], ["conta", "Conta Asaas · Parâmetros"]].map(([k, t]) => el("button", { class: "tab", "aria-selected": String((S0.finSub || "asaas") === k), onclick: () => { S0.finSub = k; try { localStorage.setItem("pp-fin-sub", k); } catch (_) {} render(); } }, t)));
  }
  try { S0.finSub = localStorage.getItem("pp-fin-sub") || "asaas"; } catch (_) { S0.finSub = "asaas"; }
  { const _r = render; render = function () { _r(); const vf = $("#view-financeiro"); if (!vf || S0.tab !== "financeiro" || !podeFin()) return; if (S0.finSub === "central") { renderCentral(); } else if (S0.finSub === "clientes") { renderClientesAsaas(vf); } else if (S0.finSub === "conta") { renderConta(vf); } vf.prepend(barraSub()); }; }
  // ----- CLIENTES DO ASAAS -----
  async function renderClientesAsaas(v) {
    v.replaceChildren(el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Financeiro"), el("h1", {}, "Clientes no Asaas"), el("div", { class: "sub" }, "Todos os clientes cadastrados no Asaas (sincronização diária), o vínculo com a ficha no sistema e a posição de cobrança de cada um.")), el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => { C.asaasCli = null; render(); } }, "Atualizar"))));
    if (!C.asaasCli) { v.append(el("div", { class: "note" }, "Carregando…")); const [a, b] = await Promise.all([SB.from("asaas_contatos").select("*").order("nome"), SB.from("v_central_cobrancas").select("chave_cliente,asaas_cliente_id,cliente_id,valor,venc_ef,paga,status")]); if (a.error) { v.append(el("div", { class: "note" }, a.error.message)); return; } C.asaasCli = { lista: a.data || [], cobs: b.data || [] }; render(); return; }
    const q = inp("search", C.asaasQ, { placeholder: "Buscar por nome, CPF/CNPJ, telefone…", style: "min-width:260px" }); q.oninput = () => { C.asaasQ = q.value; render(); const n = $("#view-financeiro input[type=search]"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
    const f = C.asaasQ.toLowerCase(); const hoje = hojeISO();
    const linhas = C.asaasCli.lista.filter((c) => !f || [c.nome, c.cpf_cnpj, c.telefone, c.email].some((x) => String(x || "").toLowerCase().includes(f))).map((c) => { const cobs = C.asaasCli.cobs.filter((x) => x.asaas_cliente_id === c.asaas_id); const ab = cobs.filter((x) => !x.paga), venc = ab.filter((x) => x.venc_ef < hoje); return { c, ab, venc, pagas: cobs.filter((x) => x.paga).length }; });
    const semV = linhas.filter((l) => !l.c.cliente_id).length;
    v.append(el("div", { class: "kpis fin-kpis" }, kpi("Clientes no Asaas", String(C.asaasCli.lista.length)), kpi("Sem ficha vinculada", String(semV), "cobrados só pelo Asaas"), kpi("Com cobrança vencida", String(linhas.filter((l) => l.venc.length).length)), kpi("Em aberto (total)", R$(linhas.reduce((a, l) => a + l.ab.reduce((x, y) => x + (+y.valor || 0), 0), 0)))));
    v.append(el("div", { class: "filters", style: "margin:10px 0" }, q));
    v.append(el("div", { class: "card", style: "padding:0;overflow:auto" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ...["Cliente (Asaas)", "CPF/CNPJ", "Telefone", "Ficha no sistema", "Em aberto", "Vencidas", "Pagas", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, linhas.length ? linhas.slice(0, 500).map(({ c, ab, venc, pagas }) => { const cli = (S.clientes || []).find((x) => x.id === c.cliente_id); return el("tr", {}, el("td", {}, el("b", {}, c.nome || c.asaas_id), el("div", { class: "note" }, c.email || "")), el("td", { class: "note" }, c.cpf_cnpj || "—"), el("td", { class: "note" }, c.telefone || "—"), el("td", {}, c.cliente_id ? el("a", { href: "#", onclick: (e) => { e.preventDefault(); S.tab = "clientes"; S.sel = c.cliente_id; S.sub = "financeiro"; render(); } }, cli?.nome || c.cliente_id) : pill("sem vínculo", "e3")), el("td", { class: "num" }, ab.length ? `${ab.length} · ${R$(ab.reduce((a, x) => a + (+x.valor || 0), 0))}` : "—"), el("td", { class: "num" }, venc.length ? pill(String(venc.length), "e3") : "—"), el("td", { class: "num" }, String(pagas)),
        el("td", {}, el("div", { style: "display:flex;gap:4px;justify-content:flex-end" }, el("a", { class: "btn sm", href: `https://www.asaas.com/customerAccount/show/${c.asaas_id}`, target: "_blank", rel: "noopener" }, "Abrir no Asaas"), el("button", { class: "btn sm", onclick: () => { C.aba = "historico"; C.histCli = c.asaas_id; S0.finSub = "central"; render(); } }, "Histórico")))); }) : el("tr", {}, el("td", { colspan: "8", class: "note" }, "Nenhum cliente."))))));
  }
  // ----- CONTA ASAAS · PARÂMETROS GERAIS DE RECEBIMENTO -----
  async function renderConta(v) {
    v.replaceChildren(el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Financeiro"), el("h1", {}, "Conta Asaas e parâmetros de recebimento"), el("div", { class: "sub" }, "Dados da conta, saldo e taxas consultados ao vivo no Asaas; e os parâmetros padrão (multa, juros, desconto, forma, vencimento) usados quando o sistema cria uma cobrança.")), el("div", { class: "actions" }, el("button", { class: "btn", onclick: () => { C.conta = null; render(); } }, "Consultar agora"))));
    const host = el("div", { class: "kpis", style: "grid-template-columns:repeat(2,minmax(0,1fr))" }); v.append(host);
    // parâmetros (nossos)
    const cfgCard = el("div", { class: "card section" }, el("h3", {}, "Parâmetros gerais de recebimento"), el("div", { class: "note" }, "Carregando…")); host.append(cfgCard);
    (async () => {
      const { data } = await SB.from("escritorio").select("dados").eq("id", "financeiro").maybeSingle(); const cfg = { multa_pct: 2, juros_mes_pct: 1, desconto_pct: 0, desconto_dias: 0, forma_padrao: "UNDEFINED", dia_vencimento_padrao: 10, notificacoes_asaas: true, ...((data?.dados || {}).recebimento || {}) };
      const multa = inp("number", cfg.multa_pct, { step: "0.01", min: 0, max: 10 }), juros = inp("number", cfg.juros_mes_pct, { step: "0.01", min: 0, max: 10 }), desc = inp("number", cfg.desconto_pct, { step: "0.01", min: 0, max: 100 }), descD = inp("number", cfg.desconto_dias, { min: 0, max: 30 }), forma = sel({ UNDEFINED: "Cliente escolhe (boleto, Pix ou cartão)", BOLETO: "Boleto", PIX: "Pix", CREDIT_CARD: "Cartão de crédito" }, cfg.forma_padrao), dia = inp("number", cfg.dia_vencimento_padrao, { min: 1, max: 28 });
      const notif = el("input", { type: "checkbox", checked: cfg.notificacoes_asaas ? "" : null });
      cfgCard.replaceChildren(el("h3", {}, "Parâmetros gerais de recebimento"), el("div", { class: "form" }, field("pr-multa", "Multa por atraso (%)", multa, "Aplicada uma vez após o vencimento. Limite legal: 2%."), field("pr-juros", "Juros de mora (% ao mês)", juros, "Limite legal: 1% ao mês."), field("pr-desc", "Desconto por antecipação (%)", desc, "0 = sem desconto."), field("pr-descd", "Desconto válido até (dias antes do vencimento)", descD), field("pr-forma", "Forma de pagamento padrão", forma), field("pr-dia", "Dia de vencimento padrão", dia, "Sugerido ao criar cobranças novas."), el("div", { class: "f full" }, el("label", { style: "display:flex;gap:8px;align-items:center;text-transform:none" }, notif, "Deixar o Asaas enviar as notificações dele (e-mail/SMS) além da nossa régua"))),
        el("div", { class: "actions", style: "margin-top:8px" }, el("button", { class: "btn primary", onclick: async () => { const novo = { ...(data?.dados || {}), recebimento: { multa_pct: +multa.value || 0, juros_mes_pct: +juros.value || 0, desconto_pct: +desc.value || 0, desconto_dias: +descD.value || 0, forma_padrao: forma.value, dia_vencimento_padrao: +dia.value || 10, notificacoes_asaas: notif.checked } }; const { error } = await SB.from("escritorio").upsert({ id: "financeiro", dados: novo }); if (error) { toast(error.message); return; } toast("Parâmetros salvos — valem para as próximas cobranças criadas pelo sistema"); } }, "Salvar parâmetros")),
        el("p", { class: "note" }, "Cobranças já existentes no Asaas não mudam. Para alterar juros/multa de uma cobrança específica, edite no Asaas."));
    })();
    // conta (ao vivo)
    const contaCard = el("div", { class: "card section" }, el("h3", {}, "Conta no Asaas"), el("div", { class: "note" }, "Consultando o Asaas…")); host.append(contaCard);
    if (!C.conta) { try { C.conta = await window.PP_FIN.edge({ acao: "asaas_conta" }); } catch (e) { C.conta = { ok: false, erro: e.message }; } }
    const r = C.conta;
    if (!r?.ok) { contaCard.replaceChildren(el("h3", {}, "Conta no Asaas"), el("div", { class: "note", style: "color:var(--warn)" }, r?.erro || "Não foi possível consultar (a função do servidor precisa estar atualizada — Deploy da Edge)")); return; }
    const ct = r.conta || {}, sd = r.saldo || {}, tx = r.taxas || {}, es = r.estatisticas_mes || {};
    const linha = (k, val) => el("div", { style: "display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--line)" }, el("span", { class: "note" }, k), el("b", {}, val ?? "—"));
    const pct = (o) => o == null ? "—" : (o.percentage != null ? `${o.percentage}%` : "") + (o.fixedValue != null ? ` + ${R$(o.fixedValue)}` : "") + (o.value != null && o.percentage == null && o.fixedValue == null ? R$(o.value) : "");
    contaCard.replaceChildren(el("h3", {}, "Conta no Asaas ", pill(r.ambiente, r.ambiente === "produção" ? "e1" : "e3")),
      linha("Titular", ct.name), linha("CPF/CNPJ", ct.cpfCnpj), linha("E-mail", ct.email), linha("Saldo disponível", sd.balance != null ? R$(sd.balance) : "—"),
      el("h3", { style: "margin-top:12px" }, "Taxas vigentes"), linha("Boleto", tx.payment?.bankSlip ? R$(tx.payment.bankSlip.defaultValue ?? tx.payment.bankSlip.value) : "—"), linha("Pix", tx.payment?.pix ? pct(tx.payment.pix) : "—"), linha("Cartão (à vista)", tx.payment?.creditCard?.operationValue != null ? `${tx.payment.creditCard.oneInstallmentPercentage ?? ""}% + ${R$(tx.payment.creditCard.operationValue)}` : "—"), linha("Transferência/saque", tx.transfer ? R$(tx.transfer.monthlyTransfersWithoutFee != null ? 0 : tx.transfer.value) + (tx.transfer.monthlyTransfersWithoutFee != null ? ` (${tx.transfer.monthlyTransfersWithoutFee} grátis/mês)` : "") : "—"), linha("Notificações (e-mail/SMS/WhatsApp)", tx.notification ? [tx.notification.emailNotification != null ? "e-mail " + R$(tx.notification.emailNotification) : null, tx.notification.smsNotification != null ? "SMS " + R$(tx.notification.smsNotification) : null, tx.notification.whatsAppNotification != null ? "WhatsApp " + R$(tx.notification.whatsAppNotification) : null].filter(Boolean).join(" · ") || "—" : "—"),
      el("h3", { style: "margin-top:12px" }, "Mês atual (vencimentos até hoje)"), linha("Quantidade de cobranças", es.quantity != null ? String(es.quantity) : "—"), linha("Valor total", es.value != null ? R$(es.value) : "—"), linha("Valor líquido", es.netValue != null ? R$(es.netValue) : "—"),
      el("details", { style: "margin-top:8px" }, el("summary", { class: "note" }, "dados completos retornados pelo Asaas"), el("pre", { class: "note", style: "white-space:pre-wrap;font-size:11px;max-height:300px;overflow:auto" }, JSON.stringify({ conta: ct, saldo: sd, taxas: tx, estatisticas: es }, null, 2))));
  }
  window.PP_CENTRAL = { invalidar, render: renderCentral };
  window.__PP_LOGIN?.then(() => { if (podeFin()) { const ch = SB.channel("central-cobrancas"); let t; const re = () => { clearTimeout(t); t = setTimeout(() => { if (S0.tab === "financeiro" && S0.finSub === "central") invalidar(); else C.ok = false; }, 800); }; for (const tb of ["cobranca_contatos", "regua_disparos", "regua_etapas", "cobranca_checks", "cobrancas"]) ch.on("postgres_changes", { event: "*", schema: "public", table: tb }, re); ch.subscribe(); } });
})();
