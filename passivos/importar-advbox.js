/* Importar ADVBox (beta, admin) — Gestão → Espelho → aba "ADVBox". Lê a extração bruta depositada em importacao_bruta
   (chave advbox-pj-AAAA-MM-DD), casa cada cliente do ADVBox com um cliente da base (automático por nome; ajuste manual),
   mostra a prévia e importa sem disparar gatilhos/avisos (rpc espelho_importar):
   - processo com nº CNJ que não existe → processos (fonte advbox, id_externo advbox:<lid>)
   - tarefa pendente → tarefas abertas; tarefa concluída (título ≠ Comentário) → tarefas concluídas retroativas (+ eventos criada/concluída)
   - "Comentário" (concluído) e mudanças de etapa → registro no dossiê (entradas_timeline, frente jurídico, automática)
   Idempotente: tarefas levam "(ADVBox #id)" na descrição; registros levam id_externo advbox:<id>. */
(() => {
  "use strict";
  const A = { chave: "", bruto: null, lotes: [], mapa: {}, prev: null, log: [], rodando: false, colab: [], existentes: null };
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[.,\-\/()'"]/g, " ").replace(/\b(LTDA|ME|MEI|EPP|EIRELI|S A|SA|CIA|E OUTRA|E OUTROS|SERVBEM)\b/g, " ").replace(/&/g, " ").replace(/\s+/g, " ").trim();
  const dBR = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const dhBR = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}):(\d{2})?/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5] || "00"}:00-03:00` : (dBR(s) ? dBR(s) + "T12:00:00-03:00" : null); };
  const quem = (it) => { const u = (it.users || []).map((x) => x.replace(/^Enviada por\s*/i, "")); const l = /por (.+)$/.exec(it.lens || "")?.[1]; return { autor: u[0] || null, resp: l || u[0] || null }; };
  const colabPor = (nome) => { if (!nome) return null; const n = norm(nome).split(" ")[0]; return A.colab.find((c) => norm(c.nome).split(" ")[0] === n) || null; };
  const classificar = (it) => { const c = it.cls; if (/no_rows|more|registered|deleted|edited/.test(c)) return "ignorar"; if (/stage/.test(c)) return "etapa"; if (/pending/.test(c)) return "tarefa_aberta"; if (/completed/.test(c)) return it.titulo === "Comentário" ? "registro" : "tarefa_feita"; return "ignorar"; };
  async function carregarBruto() {
    const { data, error } = await SB.from("importacao_bruta").select("id,chave,parte,created_at").eq("origem", "advbox").order("created_at", { ascending: false }); if (error) { toast(error.message); return; }
    A.lotes = [...new Set((data || []).map((r) => r.chave))]; if (!A.chave) A.chave = A.lotes[0] || ""; render();
  }
  async function abrirLote() {
    const { data, error } = await SB.from("importacao_bruta").select("parte,dados").eq("origem", "advbox").eq("chave", A.chave).order("parte"); if (error) { toast(error.message); return; }
    const txt = (data || []).map((r) => r.dados).join(""); try { A.bruto = JSON.parse(txt); } catch (e) { toast("JSON inválido: " + e.message); return; }
    const [c, t, e, p] = await Promise.all([SB.from("colaboradores").select("id,nome,ativo"), SB.from("tarefas").select("id,descricao").like("descricao", "%(ADVBox #%"), SB.from("entradas_timeline").select("id_externo").like("id_externo", "advbox:%"), SB.from("processos").select("id,numero_cnj,cliente_id,id_externo")]);
    A.colab = c.data || []; A.existentes = { tar: new Set((t.data || []).map((x) => /\(ADVBox #(\d+)\)/.exec(x.descricao || "")?.[1]).filter(Boolean)), tl: new Set((e.data || []).map((x) => x.id_externo)), proc: p.data || [] };
    // mapa automático de clientes
    const nomes = [...new Set(Object.values(A.bruto).map((v) => v.cliente))];
    for (const n of nomes) { if (A.mapa[n]) continue; const nn = norm(n); const hit = S.clientes.find((c) => { const a = norm(c.nome), b = norm(c.nome_fantasia); return (a && (a === nn || (nn.length >= 8 && (a.includes(nn) || nn.includes(a))))) || (b && (b === nn || (nn.length >= 8 && (b.includes(nn) || nn.includes(b))))); }); A.mapa[n] = hit ? hit.id : ""; }
    A.prev = prever(); render();
  }
  function prever() {
    const p = { porCliente: {}, processosNovos: [], tar: 0, feitas: 0, reg: 0, etapas: 0, ign: 0, jaImportado: 0, semCliente: 0 };
    for (const v of Object.values(A.bruto)) { const cid = A.mapa[v.cliente]; const pc = p.porCliente[v.cliente] = p.porCliente[v.cliente] || { cid, lids: 0, tar: 0, feitas: 0, reg: 0, etapas: 0, nums: [] }; pc.lids++; if (v.num) pc.nums.push(v.num);
      if (cid && v.num && !A.existentes.proc.some((x) => x.numero_cnj === v.num)) p.processosNovos.push({ cliente: v.cliente, cid, num: v.num, tipo: v.tipo, lid: v.lid });
      for (const it of v.itens) { const k = classificar(it); if (k === "ignorar") { p.ign++; continue; } if (!cid) { p.semCliente++; continue; } const ja = (k === "tarefa_aberta" || k === "tarefa_feita") ? A.existentes.tar.has(it.id) : A.existentes.tl.has("advbox:" + (it.id || (v.lid + ":" + it.hora + ":" + it.texto.slice(0, 40)))); if (ja) { p.jaImportado++; continue; }
        if (k === "tarefa_aberta") { p.tar++; pc.tar++; } else if (k === "tarefa_feita") { p.feitas++; pc.feitas++; } else if (k === "registro") { p.reg++; pc.reg++; } else { p.etapas++; pc.etapas++; } } }
    return p;
  }
  async function importar() {
    if (A.rodando) return; A.rodando = true; A.log = []; render();
    const log = (m) => { A.log.push(m); render(); };
    try {
      const imp = async (tabela, linhas, omitir = []) => { if (!linhas.length) return; for (let i = 0; i < linhas.length; i += 200) { const { error } = await SB.rpc("espelho_importar", { tabela, linhas: linhas.slice(i, i + 200), omitir }); if (error) throw new Error(tabela + ": " + error.message); } };
      // 1) processos novos
      const novos = A.prev.processosNovos.filter((n, i, arr) => arr.findIndex((x) => x.num === n.num) === i).map((n) => ({ id: crypto.randomUUID(), cliente_id: n.cid, numero_cnj: n.num, tipo_acao: n.tipo, polo: "passivo", status: "ativo", visivel_cliente: false, fonte: "advbox", id_externo: "advbox:" + n.lid }));
      await imp("processos", novos); if (novos.length) { A.existentes.proc.push(...novos); log(`${novos.length} processo(s) criados`); }
      const procId = (num) => num ? (A.existentes.proc.find((x) => x.numero_cnj === num)?.id || null) : null;
      // 2) tarefas + eventos + registros
      const tarefas = [], eventos = [], regs = [];
      for (const v of Object.values(A.bruto)) { const cid = A.mapa[v.cliente]; if (!cid) continue; const pid = procId(v.num);
        for (const it of v.itens) { const k = classificar(it); if (k === "ignorar") continue; const { autor, resp } = quem(it); const ca = colabPor(autor), cr = colabPor(resp); const criado = dhBR(it.hora) || new Date().toISOString(); const prazo = dBR(it.dataComp);
          if (k === "tarefa_aberta" || k === "tarefa_feita") { if (A.existentes.tar.has(it.id)) continue; const fatal = /prazo fatal/i.test(it.texto); const texto = it.texto.replace(/^Prazo fatal:\s*\d{2}\/\d{2}\/\d{4}\.?\s*/i, "").trim(); const feita = k === "tarefa_feita";
            const tid = crypto.randomUUID(); const concl = feita ? (prazo && prazo <= new Date().toISOString().slice(0, 10) ? prazo + "T18:00:00-03:00" : criado) : null;
            tarefas.push({ id: tid, titulo: (it.titulo || "Tarefa do ADVBox").slice(0, 200), descricao: (texto ? texto + "\n" : "") + `(ADVBox #${it.id})`, cliente_id: cid, processo_id: pid, responsavel_id: cr?.id || ca?.id || null, nucleo: "juridico", prazo, prazo_fatal: fatal, prioridade: fatal ? 1 : 2, status: feita ? "concluida" : "aberta", concluida_em: concl, created_at: criado, created_by: null });
            eventos.push({ tarefa_id: tid, tipo: "criada", de: null, para: cr?.nome || resp || null, nota: null, autor_nome: ca?.nome || autor || "ADVBox", criado_em: criado });
            if (feita) eventos.push({ tarefa_id: tid, tipo: "concluida", de: null, para: null, nota: null, autor_nome: cr?.nome || resp || ca?.nome || "ADVBox", criado_em: concl }); }
          else { const ext = "advbox:" + (it.id || (v.lid + ":" + it.hora + ":" + it.texto.slice(0, 40))); if (A.existentes.tl.has(ext)) continue;
            const desc = k === "etapa" ? "ADVBox — " + it.texto : it.texto; if (!desc.trim()) continue;
            regs.push({ cliente_id: cid, processo_id: pid, data: (criado || "").slice(0, 10), tipo: k === "etapa" ? "mudanca_estagio" : "registro", descricao: desc.slice(0, 4000), responsavel_id: ca?.id || null, visivel_cliente: false, automatica: k === "etapa", fonte: "advbox", id_externo: ext, frente: "juridico", created_at: criado }); } } }
      await imp("tarefas", tarefas); log(`${tarefas.length} tarefa(s) (${tarefas.filter((t) => t.status === "concluida").length} concluídas retroativas)`);
      await imp("tarefa_eventos", eventos); log(`${eventos.length} evento(s) de tarefa`);
      await imp("entradas_timeline", regs); log(`${regs.length} registro(s) no dossiê`);
      log("Concluído."); toast("Importação concluída"); A.existentes = null; await abrirLote();
    } catch (e) { log("ERRO: " + e.message); toast(e.message); }
    A.rodando = false; render();
  }
  function renderAba(v) {
    if (!A.lotes.length && !A.bruto) { carregarBruto(); v.append(el("div", { class: "note" }, "Carregando lotes…")); return; }
    const sl = sel(Object.fromEntries(A.lotes.map((l) => [l, l])), A.chave); sl.onchange = () => { A.chave = sl.value; A.bruto = null; A.prev = null; render(); };
    v.append(el("div", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Lote extraído do ADVBox"), el("div", { class: "actions" }, sl, el("button", { class: "btn sm primary", onclick: abrirLote }, "Analisar"))),
      el("div", { class: "note" }, "O lote é a extração feita no navegador (processos dos clientes PJ com todo o histórico de tarefas e comentários). Analisar casa os clientes e mostra o que seria importado; nada é gravado até clicar em Importar.")));
    if (!A.bruto || !A.prev) return;
    const p = A.prev; const nomes = Object.keys(p.porCliente).sort();
    const opts = { "": "— ignorar (não importar) —", ...Object.fromEntries([...S.clientes].sort((a, b) => (a.nome || "").localeCompare(b.nome || "")).map((c) => [c.id, c.nome])) };
    v.append(el("div", { class: "card section" }, el("h2", {}, "Clientes do ADVBox → clientes do sistema"), el("div", { class: "note" }, "Confira o casamento automático. Quem ficar em “ignorar” não entra. Clientes que ainda não existem no sistema precisam ser cadastrados antes (Clientes → + Cliente) e depois escolhidos aqui."),
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "No ADVBox"), el("th", {}, "Processos"), el("th", {}, "No sistema"), el("th", { class: "r" }, "A fazer"), el("th", { class: "r" }, "Feitas"), el("th", { class: "r" }, "Registros"), el("th", { class: "r" }, "Etapas"))),
        el("tbody", {}, ...nomes.map((n) => { const pc = p.porCliente[n]; const s = sel(opts, A.mapa[n] || ""); s.onchange = () => { A.mapa[n] = s.value; A.prev = prever(); render(); }; return el("tr", { style: A.mapa[n] ? "" : "background:var(--gold-soft)" }, el("td", {}, el("b", {}, n), el("div", { class: "note" }, pc.lids + " pasta(s)")), el("td", { class: "note" }, pc.nums.join(", ") || "sem nº"), el("td", {}, s), el("td", { class: "r num" }, String(pc.tar)), el("td", { class: "r num" }, String(pc.feitas)), el("td", { class: "r num" }, String(pc.reg)), el("td", { class: "r num" }, String(pc.etapas))); }))))));
    v.append(el("div", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Prévia"), el("button", { class: "btn primary", disabled: A.rodando ? "" : null, onclick: () => { if (confirm(`Importar agora? ${p.processosNovos.length} processo(s), ${p.tar} tarefa(s) abertas, ${p.feitas} concluídas, ${p.reg} registro(s) e ${p.etapas} mudança(s) de etapa.`)) importar(); } }, A.rodando ? "Importando…" : "Importar")),
      el("div", { class: "kpis" }, ...[["Processos novos", p.processosNovos.length], ["Tarefas a fazer", p.tar], ["Tarefas feitas (retroativas)", p.feitas], ["Registros no dossiê", p.reg], ["Mudanças de etapa", p.etapas], ["Já importados (pulam)", p.jaImportado], ["Sem cliente (pulam)", p.semCliente], ["Ignorados (editados/excluídos)", p.ign]].map(([l, n]) => el("div", { class: "card kpi" }, el("div", { class: "l" }, l), el("div", { class: "v" }, String(n))))),
      p.processosNovos.length ? el("div", { class: "note", style: "margin-top:8px" }, "Processos a criar: " + p.processosNovos.map((x) => x.num + " (" + x.cliente.split(" ").slice(0, 2).join(" ") + ")").join(" · ")) : null,
      A.log.length ? el("pre", { style: "margin-top:10px;font-size:12px;white-space:pre-wrap" }, A.log.join("\n")) : null));
  }
  function renderTela() { const v = $("#view-importar-advbox"); if (!v) return; v.replaceChildren(); v.append(el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Gestão"), el("h1", {}, "Importar do ADVBox"), el("div", { class: "sub" }, "Tarefas, comentários e etapas dos clientes PJ extraídos do ADVBox, para dentro de tarefas e do dossiê.")))); renderAba(v); }
  { const _r = render; render = function () { _r(); const v = $("#view-importar-advbox"); if (!v) return; const ok = PP.perfil?.papel === "admin"; if (!ok && S.tab === "importar-advbox") S.tab = "clientes"; v.hidden = S.tab !== "importar-advbox"; if (S.tab === "importar-advbox") renderTela(); }; }
  window.PP_IMPORTAR_ADVBOX = { renderAba };
})();
