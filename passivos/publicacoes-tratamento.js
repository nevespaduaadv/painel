/* Tratamento de publicações — bloco 2 da controladoria (beta 0003). Carregado depois de publicacoes.js e pastas.js.
   - Cada publicação recebe uma providência (gerou prazo / nada a fazer / duplicidade / encaminhada / ciência) com observação,
     quem tratou e quando; prazo de tratamento = N dias úteis após a disponibilização (controladoria_config);
     tempestiva = tratada dentro do prazo.
   - Histórico da publicação (captada, lida, vinculada, tratada, tarefa criada, reaberta) e relatório de tempestividade
     por mês e por pessoa (Jurídico → Publicações → aba Tempestividade).
   - Card "Publicações" dentro da ficha do processo (lista com status) via PP_PASTAS.secaoProcesso.
   Supabase: v_publicacoes (providencia, tempestiva, prazo_tratamento…), publicacao_historico, v_publicacoes_tempestividade,
   rpcs publicacao_tratar, publicacao_reabrir. */
(() => {
  "use strict";
  const T = { aba: "lista", rel: [], relOk: false, hist: {}, pubProc: {}, soPendentes: false, colab: [] };
  const PROV = { gerou_prazo: ["Gerou prazo", "e1"], nada_a_fazer: ["Nada a fazer", "g"], duplicidade: ["Duplicidade", "g"], encaminhada: ["Encaminhada", "e2"], ciencia: ["Ciência", "g"] };
  const ACAO = { captada: "Captada no DJEN", lida: "Lida", ignorada: "Ignorada", vinculada: "Vinculada a processo", desvinculada: "Desvinculada", tratada: "Tratada", tarefa_criada: "Tarefa criada", reaberta: "Reaberta" };
  const fmtDH = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtDt = (iso) => iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const recarregar = () => { window.PP_PUBLICACOES?.recarregar?.(); T.relOk = false; T.pubProc = {}; };

  // ---------- pill de status (usada na lista e no card do processo) ----------
  function pillStatus(p) {
    if (p.providencia) { const [l, cls] = PROV[p.providencia] || [p.providencia, "g"]; return el("div", {}, el("span", { class: "pill " + cls, title: (p.tratada_por_nome ? "por " + p.tratada_por_nome + " em " + fmtDH(p.tratada_em) : "") }, l + (p.encaminhada_para_nome ? " → " + p.encaminhada_para_nome.split(" ")[0] : "")), p.tempestiva === false ? el("div", { class: "note", style: "color:var(--crit)" }, "fora do prazo") : el("div", { class: "note" }, "no prazo")); }
    const d = p.dias_para_tratar;
    return el("div", {}, el("span", { class: "pill " + (d != null && d < 0 ? "e3" : d === 0 ? "e2" : "c") }, "pendente"), el("div", { class: "note" }, d == null ? "" : d < 0 ? `vencido há ${-d} d` : d === 0 ? "tratar hoje" : `até ${fmtDt(p.prazo_tratamento)}`));
  }

  // ---------- tratar: ler + vincular + providência (+ tarefa) em um só lugar ----------
  /* 26/11 (16h34, aprovado pela sócia sobre a prévia): tela em duas colunas — a publicação à esquerda, a decisão à direita.
     A providência é escolhida em botões (nada vem marcado) e só aparecem os campos da opção escolhida. Um único texto livre
     (vai para a tarefa e para o histórico da publicação). Prioridade padrão: Normal. O botão diz o que vai acontecer. */
  function modalTratar(p, opts = {}) {
    const PUB = window.PP_PUBLICACOES || {}; const colab = (T.colab.length ? T.colab : (PUB.colab?.() || [])).filter((c) => c.ativo !== false); const procs = PUB.procs?.() || [];
    const TT = PUB.TIPOS_TAREFA_PUB || { prazo: "Cumprir prazo", manifestar: "Manifestar nos autos", recurso: "Analisar cabimento de recurso", audiencia: "Preparar audiência", cliente: "Comunicar o cliente", diligencia: "Diligência / providência" };
    const fmtD2 = (iso) => fmtDt(iso); const curta = (iso) => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "—";
    const nomeCli = (id) => (S.clientes || []).find((c) => c.id === id)?.nome || "?";
    // ----- coluna da publicação -----
    const limparTxt = (s, o) => (typeof PUB.limparTexto === "function" ? PUB.limparTexto(s, o) : String(s || ""));
    const bruto = limparTxt(p.texto || p.resumo) || "(sem texto)";
    // destaca só visualmente os trechos “prazo de N dias” (nada é preenchido a partir disso: o prazo é sempre conferido por quem trata)
    const teor = el("div", { class: "np-tp-teor", tabindex: "0", role: "document", "aria-label": "Teor da publicação" });
    { const re = /\bprazo\s+(?:comum\s+|sucessivo\s+|legal\s+|improrrogável\s+)?de\s+\d{1,3}\s*(?:\([^)]{1,30}\)\s*)?(?:dias?|horas?)(?:\s+(?:úteis|corridos))?/gi; let i = 0, m; while ((m = re.exec(bruto))) { if (m.index > i) teor.append(bruto.slice(i, m.index)); teor.append(el("mark", {}, m[0])); i = m.index + m[0].length; } teor.append(bruto.slice(i)); }
    const d = p.dias_para_tratar;
    /* 26/11 (18h02, pedido da sócia): a leitura que o AtendeDireito Sync já faz do ato aparece aqui — o resumo em linguagem simples, na coluna
       da publicação, e os prazos que ele sugere, junto da decisão. É só apoio: nada vem marcado, nenhum prazo vira fatal sozinho, e “Usar” apenas
       preenche a data e o título para quem trata conferir. A conferência formal do prazo sugerido continua onde sempre esteve (Ver detalhes). */
    const caixaSync = el("div", { class: "np-tp-sync", hidden: "" }), sugBox = el("div", { class: "np-tp-sug", hidden: "" });
    const pub = el("section", { class: "np-tp-pub", "aria-label": "Publicação" },
      el("div", { class: "np-tp-num" }, p.numero_processo || "sem número"),
      el("div", { class: "np-tp-meta" }, [p.tribunal, p.orgao, p.tipo_comunicacao, p.tipo_documento, p.classe].filter(Boolean).join(" · ")),
      el("div", { class: "np-tp-fichas" }, el("span", { class: "np-tp-m" }, "disponibilizada " + fmtD2(p.data_disponibilizacao)), p.prazo_tratamento ? el("span", { class: "np-tp-m" + (d != null && d <= 0 ? " late" : "") }, "tratar até " + fmtD2(p.prazo_tratamento)) : null, p.link ? el("a", { href: p.link, target: "_blank", rel: "noopener", class: "lnk" }, "↗ abrir no tribunal") : null),
      p.cliente_nome ? el("div", { class: "np-tp-meta" }, "Cliente: ", el("b", {}, p.cliente_nome)) : null,
      (p.destinatarios || []).length ? el("div", { class: "np-tp-meta" }, "Partes: " + p.destinatarios.map((x) => x.nome + (x.polo ? ` (${x.polo})` : "")).join(" · ")) : null, caixaSync, teor);
    // ----- 1. processo (só quando falta) -----
    const E = { vinc: null, prov: p.providencia || null, dataManual: false };
    let passoProc = null;
    if (!p.processo_id) {
      const caixa = el("div", { class: "np-tp-vinc" });
      const rotVinc = (v) => v.tipo === "proc" ? (() => { const x = procs.find((y) => y.id === v.id); return `${x?.numero_cnj || "processo s/ nº"} · ${nomeCli(x?.cliente_id)}`; })() : `novo processo em ${nomeCli(v.id)}`;
      const desenha = (modo) => {
        if (E.vinc) { caixa.replaceChildren(el("span", { class: "ok" }, "Vinculado a ", el("b", {}, rotVinc(E.vinc))), el("button", { type: "button", class: "lnk", onclick: () => { E.vinc = null; desenha(); } }, "desfazer")); return; }
        if (modo !== "busca" && p.cliente_sugerido_id) { const meus = procs.filter((x) => x.cliente_id === p.cliente_sugerido_id); const v = meus.length === 1 ? { tipo: "proc", id: meus[0].id } : { tipo: "cli", id: p.cliente_sugerido_id };
          caixa.replaceChildren(el("span", {}, "Parece ser de ", el("b", {}, p.cliente_sugerido_nome || nomeCli(p.cliente_sugerido_id))), el("button", { type: "button", class: "btn sm primary", onclick: () => { E.vinc = v; desenha(); } }, "Confirmar"), el("button", { type: "button", class: "btn sm", onclick: () => desenha("busca") }, "Escolher outro"), el("span", { class: "np-tp-nota" }, "ou deixe sem vínculo")); return; }
        const busca = inp("search", "", { placeholder: "Buscar por número do processo ou nome do cliente…", "aria-label": "Buscar processo ou cliente" }); const res = el("ul", { class: "np-tp-res" });
        const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        busca.oninput = () => { const q = norm(busca.value.trim()); res.replaceChildren(); if (q.length < 2) return; const qn = q.replace(/\D/g, "");
          const ps = procs.filter((x) => (qn.length >= 3 && String(x.numero_cnj || "").replace(/\D/g, "").includes(qn)) || norm(nomeCli(x.cliente_id)).includes(q)).slice(0, 6);
          const cs = (S.clientes || []).filter((c) => norm(c.nome).includes(q)).slice(0, 4);
          for (const x of ps) res.append(el("li", {}, el("button", { type: "button", onclick: () => { E.vinc = { tipo: "proc", id: x.id }; desenha(); } }, el("b", {}, x.numero_cnj || "s/ nº"), " · " + nomeCli(x.cliente_id) + (x.tipo_acao ? " · " + x.tipo_acao : ""))));
          for (const c of cs) res.append(el("li", {}, el("button", { type: "button", onclick: () => { E.vinc = { tipo: "cli", id: c.id }; desenha(); } }, "Criar o processo em ", el("b", {}, c.nome))));
          if (!ps.length && !cs.length) res.append(el("li", { class: "np-tp-nota" }, "Nada encontrado.")); };
        caixa.replaceChildren(busca, res, el("span", { class: "np-tp-nota" }, "Opcional. Se for de terceiro, deixe sem vínculo e use “Não é nosso”."));
      };
      desenha(); passoProc = el("div", { class: "np-tp-passo" }, el("div", { class: "np-tp-rot" }, "1. Processo", el("small", {}, "ainda não vinculado")), caixa);
    }
    const nP = passoProc ? 2 : 1;
    // ----- 2. providência em botões -----
    const OPC = [["gerou_prazo", "Criar tarefa ou prazo"], ["ciencia", "Só ciência"], ["nada_a_fazer", "Nada a fazer"], ["encaminhada", "Encaminhar"], ["duplicidade", "Não é nosso"]];
    const seg = el("div", { class: "np-tp-seg", role: "group", "aria-label": "O que fazer com esta publicação" }, ...OPC.map(([k, l]) => el("button", { type: "button", "data-o": k, "aria-pressed": "false", onclick: () => { E.prov = k; ajustar(); } }, l)));
    // ----- 3. campos -----
    const colOpts = { "": "— escolha —", ...Object.fromEntries(colab.map((c) => [c.id, c.nome])) };
    const meu = colab.find((c) => c.perfil_id === PP.perfil?.id);
    const para = sel(colOpts, p.encaminhada_para || ""), txt = el("textarea", { rows: 3, id: "tr-obs" }, p.observacao_tratamento || "");
    const tipo = sel(TT, "prazo"), titulo = inp("text", "", { placeholder: "Ex.: Contestar — prazo de 15 dias" }), resp = sel(colOpts, ""), prazo = inp("date", ""), fatal = el("input", { type: "checkbox", id: "tr-fatal" }), pri = sel({ "1": "Alta", "2": "Normal", "3": "Baixa" }, "2");
    const sug = () => { if (!titulo.value.trim() || titulo.dataset.auto === "1") { titulo.value = `${TT[tipo.value]} — ${p.numero_processo || "publicação"}`; titulo.dataset.auto = "1"; } }; titulo.oninput = () => { titulo.dataset.auto = "0"; }; tipo.onchange = sug; sug();
    const WF = T.workflows || []; const wfSel = sel({ "": "Tarefa simples (sem cadeia)", ...Object.fromEntries(WF.map((w) => [w.codigo, w.nome + " · " + w.dias_legais + " dias"])) }, "");
    const uf = window.PP_PRAZOS?.ufDoCnj(p.numero_processo); const confereId = T.confereId || null;
    const addUteis = (iso, n) => { if (!iso) return null; let dd = new Date(iso + "T12:00:00"), c = 0, step = n < 0 ? -1 : 1; while (c < Math.abs(n)) { dd.setDate(dd.getDate() + step); if (!window.PP_PRAZOS || window.PP_PRAZOS.ehUtil(dd, uf)) c++; } return dd.toISOString().slice(0, 10); };
    const etapasDe = (w, fim) => { if (!w || !fim) return []; const e = []; e.push({ codigo: "confeccionar", titulo: "Confeccionar — " + w.nome, prazo: addUteis(fim, w.confeccionar_offset), para: "resp" }); if (w.custas) e.push({ codigo: "custas", titulo: "Recolher custas — " + w.nome, prazo: addUteis(fim, -3), para: "resp" }); e.push({ codigo: "protocolar", titulo: "Protocolar — " + w.nome, prazo: addUteis(fim, w.protocolar_offset), para: "resp", fatalEm: fim }); e.push({ codigo: "conferir", titulo: "Conferir protocolo — " + w.nome, prazo: addUteis(fim, w.protocolar_offset), para: "confere" }); return e; };
    const fmtBR = curta;
    // contagem numa linha, calculando sozinha (mesma regra de PP_PRAZOS.calcular); a data pode ser alterada à mão
    const nDias = inp("number", "15", { min: 1, "aria-label": "Quantidade de dias" }), sTipo = sel({ uteis: "dias úteis (CPC)", corridos: "dias corridos" }, "uteis"), dBase = inp("date", p.data_disponibilizacao ? String(p.data_disponibilizacao).slice(0, 10) : "", { "aria-label": "Contar a partir de (disponibilização)" });
    const sUf = sel({ "": "só nacionais", ...Object.fromEntries("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ").map((u) => [u, u])) }, uf || ""); for (const x of [sTipo, sUf]) x.setAttribute("aria-label", x === sTipo ? "Tipo de contagem" : "Feriados de");
    const resD = el("div", { class: "d" }, "Informe a contagem"), resE = el("div", { class: "e" }), notas = el("div", { class: "np-tp-notas", hidden: "" }), cadeiaBox = el("div", { class: "np-tp-cad", hidden: "" });
    const lnkComo = el("button", { type: "button", class: "lnk", "aria-expanded": "false", onclick: () => { notas.hidden = !notas.hidden; lnkComo.setAttribute("aria-expanded", String(!notas.hidden)); } }, "como foi contado");
    const fData = el("div", { class: "np-tp-f", hidden: "" }, el("label", { for: "tr-prazo" }, "Vencimento (alterado à mão)"), prazo); prazo.id = "tr-prazo";
    const lnkData = el("button", { type: "button", class: "lnk", onclick: () => { fData.hidden = !fData.hidden; if (!fData.hidden) prazo.focus(); } }, "alterar data");
    const renderCadeia = () => { const w = WF.find((x) => x.codigo === wfSel.value); if (!w) { cadeiaBox.hidden = true; return; } cadeiaBox.hidden = false; const fim = prazo.value; if (!fim) { cadeiaBox.replaceChildren(el("b", {}, "Tarefas que serão abertas"), el("span", { class: "np-tp-nota", style: "grid-column:1/-1" }, "Informe a contagem para ver as datas.")); return; }
      const et = etapasDe(w, fim); cadeiaBox.replaceChildren(el("b", {}, "Tarefas que serão abertas"), ...et.flatMap((x) => [el("span", {}, fmtBR(x.prazo)), el("span", {}, x.titulo.replace(" — " + w.nome, "") + (x.codigo === "protocolar" ? " (meta interna)" : "")), el("span", {}, x.para === "confere" ? (confereId ? "controladoria" : "quem recebe") : "quem recebe")]), w.decisao_inicial ? el("span", { class: "np-tp-nota", style: "grid-column:1/-1" }, "Antes: “" + w.decisao_inicial + "”, em 2 dias úteis.") : null); };
    const mostraFim = () => { const v = prazo.value; if (!v) { resD.textContent = "Informe a contagem"; resE.replaceChildren(); atualizarBotao(); return; } resD.textContent = "Vence em " + fmtD2(v); renderCadeia(); atualizarBotao(); };
    const recalc = () => { const PZ = window.PP_PRAZOS; if (!PZ) { fData.hidden = false; return; } PZ.pronto().then(() => { const r = PZ.calcular({ base: dBase.value, dias: nDias.value, tipo: sTipo.value, uf: sUf.value || null });
      if (!r) { resE.replaceChildren("Informe a data-base e o número de dias."); return; } E.dataManual = false; prazo.value = r.fim;
      resE.replaceChildren(`${r.dias} ${r.tipo === "uteis" ? "dias úteis" : "dias corridos"}, contados de ${fmtBR(r.inicio)} · `, lnkComo, " · ", lnkData);
      notas.replaceChildren(r.notas.length ? el("div", {}, "Considerado: " + r.notas.join("; ")) : el("div", {}, "Sem feriados ou suspensões no período."), el("div", {}, "A contagem exclui o dia da publicação e inclui o do vencimento (CPC 224). Confira o prazo específico da intimação.")); mostraFim(); }); };
    for (const x of [nDias, sTipo, dBase, sUf]) x.onchange = recalc;
    prazo.addEventListener("change", () => { E.dataManual = true; resE.replaceChildren("data informada à mão · ", lnkData); mostraFim(); });
    wfSel.onchange = () => { const w = WF.find((x) => x.codigo === wfSel.value); if (w) { nDias.value = w.dias_legais; titulo.value = w.nome + " — " + (p.numero_processo || "publicação"); titulo.dataset.auto = "1"; fatal.checked = true; recalc(); } fTipo.hidden = fTit.hidden = !!w; renderCadeia(); atualizarBotao(); };
    const campo = (id, rot, ctl, obrig) => { ctl.id = ctl.id || id; return el("div", { class: "np-tp-f" }, el("label", { for: ctl.id }, rot, obrig ? el("b", { title: "obrigatório" }, " *") : null), ctl); };
    const fTipo = campo("tr-tipo", "Tipo da tarefa", tipo), fTit = campo("tr-tit", "Título da tarefa", titulo);
    const blocoPrazo = el("div", { class: "np-tp-passo", "data-v": "gerou_prazo" }, el("div", { class: "np-tp-rot" }, (nP + 1) + ". Prazo e responsável"),
      el("div", { class: "np-tp-grade" }, campo("tr-wf", "Tipo de prazo", wfSel), campo("tr-resp", "Para quem", resp, true)),
      el("div", { class: "np-tp-f" }, el("span", { class: "np-tp-lab" }, "Contagem"), el("div", { class: "np-tp-conta" }, nDias, sTipo, dBase, sUf)),
      el("div", { class: "np-tp-resb" }, el("div", {}, resD, resE), el("label", { class: "ck", for: "tr-fatal" }, fatal, "Prazo fatal")), notas, fData, cadeiaBox,
      el("details", { class: "np-tp-mais" }, el("summary", {}, "Mais opções ", el("i", {}, "(título, prioridade)")), el("div", { class: "np-tp-grade" }, fTipo, fTit, campo("tr-pri", "Prioridade", pri))));
    const blocoEnc = el("div", { class: "np-tp-passo", "data-v": "encaminhada" }, el("div", { class: "np-tp-grade" }, campo("tr-para", "Encaminhar para", para, true)));
    const rotTxt = el("label", { for: "tr-obs" }); const fTxt = el("div", { class: "np-tp-f", hidden: "" }, rotTxt, txt);
    const vazio = el("div", { class: "np-tp-vazio" }, "Escolha uma opção acima. Só aparecem os campos da opção escolhida.");
    const dec = el("section", { class: "np-tp-dec", "aria-label": "Decisão" }, passoProc, el("div", { class: "np-tp-passo" }, el("div", { class: "np-tp-rot" }, nP + ". O que fazer com esta publicação"), seg, sugBox), vazio, blocoPrazo, blocoEnc, fTxt);
    const body = el("div", { class: "np-tp" }, pub, dec);
    // rótulo do botão diz o que vai acontecer
    let btnSalvar = null;
    const ROT = { ciencia: "Registrar ciência", nada_a_fazer: "Registrar: nada a fazer", encaminhada: "Encaminhar", duplicidade: "Registrar: não é nosso" };
    function atualizarBotao() { if (!btnSalvar) return; let r = "Escolha uma opção"; if (E.prov === "gerou_prazo") { const w = WF.find((x) => x.codigo === wfSel.value); const n = w ? etapasDe(w, prazo.value || "2000-01-03").length + (w.decisao_inicial ? 1 : 0) : 1; r = n > 1 ? `Criar ${n} tarefas e concluir` : "Criar tarefa e concluir"; } else if (E.prov) r = ROT[E.prov]; btnSalvar.textContent = r; btnSalvar.classList.toggle("np-tp-espera", !E.prov); }
    function ajustar() { for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.o === E.prov)); vazio.hidden = !!E.prov; blocoPrazo.hidden = E.prov !== "gerou_prazo"; blocoEnc.hidden = E.prov !== "encaminhada"; fTxt.hidden = !E.prov;
      rotTxt.replaceChildren(E.prov === "gerou_prazo" ? "Instruções e observação" : "Observação", el("span", {}, E.prov === "gerou_prazo" ? ` (opcional · vai para a tarefa${meu ? ", como vinda de " + meu.nome + "," : ""} e para o histórico da publicação)` : " (opcional)"));
      txt.placeholder = E.prov === "encaminhada" ? "O que a pessoa precisa decidir…" : E.prov === "gerou_prazo" ? "O que precisa ser feito…" : "O que foi feito ou por quê…";
      if (E.prov === "gerou_prazo" && !prazo.value && !E.dataManual) recalc(); atualizarBotao(); }
    const usarSugestao = (z) => { E.prov = "gerou_prazo"; E.dataManual = true; prazo.value = z.data_sugerida; const rot = String(z.rotulo || "Cumprir prazo").trim();
      if (!wfSel.value) { titulo.value = rot + " — " + (p.numero_processo || "publicação"); titulo.dataset.auto = "0"; }
      ajustar(); resE.replaceChildren("data sugerida pelo Sync (" + rot + ") — confira nos autos · ", lnkData); mostraFim(); for (const b of sugBox.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.z === String(z.id))); };
    (async () => { try {
      const [f, z] = await Promise.all([SB.from("publicacao_fontes").select("publicacao_id,fonte,resumo:bruto->>resumo,tipo_ato:bruto->>tipo_ato").eq("publicacao_id", p.id).eq("fonte", "sync"),
        SB.from("publicacao_prazos").select("id,publicacao_id,origem,rotulo,data_sugerida,estado,data_conferida,tarefa_id").eq("publicacao_id", p.id).order("data_sugerida")]);
      const fonte = (f.data || []).filter((x) => String(x.publicacao_id) === String(p.id) && x.fonte === "sync" && String(x.resumo || "").trim()).sort((a, b) => String(b.resumo).length - String(a.resumo).length)[0];
      if (fonte) { caixaSync.replaceChildren(el("div", { class: "r" }, "Resumo do Sync", fonte.tipo_ato ? el("span", {}, " · " + fonte.tipo_ato) : null), el("p", {}, String(fonte.resumo).trim()), el("small", {}, "Leitura automática da plataforma. Vale o teor abaixo.")); caixaSync.hidden = false; }
      const pz = (z.data || []).filter((x) => String(x.publicacao_id) === String(p.id) && x.estado !== "descartado" && x.data_sugerida);
      if (pz.length) { sugBox.replaceChildren(el("div", { class: "r" }, pz.length === 1 ? "Prazo sugerido pelo Sync" : "Prazos sugeridos pelo Sync"),
          el("ul", {}, ...pz.map((x) => { const conf = x.estado !== "sugerido"; return el("li", {}, el("span", { class: "n" }, x.rotulo || "Prazo"), el("span", { class: "d" }, fmtD2(conf && x.data_conferida ? x.data_conferida : x.data_sugerida)),
            conf ? el("span", { class: "np-tp-nota" }, x.tarefa_id ? "já conferido, com tarefa" : "já conferido") : el("button", { type: "button", class: "btn sm", "data-z": String(x.id), "aria-pressed": "false", title: "Preenche a data e o título da tarefa com esta sugestão. Você confere e pode alterar.", onclick: () => usarSugestao(x) }, "Usar")); })),
          el("small", {}, "Sugestão automática, não é prazo do escritório. “Usar” só preenche; confira o ato, a regra e o calendário do juízo.")); sugBox.hidden = false; }
    } catch (e) { /* sem o Sync (ou sem permissão de leitura) a tela segue como sempre */ } })();
    modal("Tratar publicação", body, async () => {
      if (!E.prov) throw new Error("Escolha o que fazer com esta publicação");
      const obsTxt = txt.value.trim();
      if (E.prov === "gerou_prazo") { if (!resp.value) throw new Error("Escolha para quem vai a tarefa"); if (!prazo.value) throw new Error("Informe o prazo da tarefa"); }
      if (E.prov === "encaminhada" && !para.value) throw new Error("Escolha para quem encaminhar");
      // vínculo
      let processo_id = p.processo_id, cliente_id = p.cliente_id;
      if (!processo_id && E.vinc?.tipo === "proc") { const { error } = await SB.from("publicacoes").update({ processo_id: E.vinc.id }).eq("id", p.id); if (error) throw new Error(error.message); processo_id = E.vinc.id; cliente_id = procs.find((x) => x.id === processo_id)?.cliente_id || null; }
      else if (!processo_id && E.vinc?.tipo === "cli") { const { data, error } = await SB.from("processos").insert({ cliente_id: E.vinc.id, numero_cnj: p.numero_processo || null, tribunal: p.tribunal || null, vara: p.orgao || null, tipo_acao: p.classe || null, polo: "passivo", status: "ativo", visivel_cliente: false, fonte: "djen" }).select("id").single(); if (error) throw new Error(error.code === "23505" ? "Já existe processo com este número — escolha-o na busca" : error.message); processo_id = data.id; cliente_id = E.vinc.id; await SB.from("publicacoes").update({ processo_id }).eq("id", p.id); }
      if (E.prov === "gerou_prazo") {
        // a tarefa leva uma linha de origem (sem copiar o teor: ela já fica ligada à publicação) + o texto de quem tratou
        const origem = `Publicação de ${fmtD2(p.data_disponibilizacao)} · ${[p.tribunal, p.orgao, p.tipo_documento || p.tipo_comunicacao].filter(Boolean).join(" · ")} · processo ${p.numero_processo || "s/ nº"}${p.cliente_nome ? " · " + p.cliente_nome : ""}`;
        const descricao = [origem, obsTxt].filter(Boolean).join("\n\n");
        const w = WF.find((x) => x.codigo === wfSel.value);
        if (w) {
          const cadeia = crypto.randomUUID(); const et = etapasDe(w, prazo.value); const base = { descricao, cliente_id: cliente_id || null, processo_id: processo_id || null, nucleo: "juridico", prioridade: +pri.value, status: "aberta", publicacao_id: p.id, cadeia_id: cadeia, workflow_codigo: w.codigo };
          const rows = [];
          if (w.decisao_inicial) rows.push({ ...base, titulo: w.decisao_inicial + " — " + (p.numero_processo || "publicação"), responsavel_id: resp.value, prazo: addUteis(p.data_disponibilizacao || prazo.value, 2) || prazo.value, prazo_fatal: false, etapa_codigo: "analisar", descricao: (base.descricao || "") + "\n\nAo concluir, diga no andamento se cabe ou não. A cadeia (confeccionar → protocolar → conferir) já está aberta; se não couber, cancele as demais." });
          for (const x of et) rows.push({ ...base, titulo: x.titulo, responsavel_id: x.para === "confere" && confereId ? confereId : resp.value, prazo: x.prazo, prazo_fatal: x.codigo === "protocolar", etapa_codigo: x.codigo, descricao: (x.codigo === "protocolar" ? `Prazo legal (fatal): ${fmtBR(x.fatalEm)}. Meta interna: protocolar até ${fmtBR(x.prazo)}.\n\n` : x.codigo === "conferir" ? "Conferir nos autos se o protocolo foi feito e juntado corretamente.\n\n" : "") + (base.descricao || "") });
          const { error } = await SB.from("tarefas").insert(rows); if (error) throw new Error("Não foi possível abrir a cadeia: " + error.message);
          toast(`Cadeia aberta: ${rows.length} tarefas`);
        } else {
          const row = { titulo: titulo.value.trim() || TT[tipo.value], descricao, cliente_id: cliente_id || null, processo_id: processo_id || null, responsavel_id: resp.value, nucleo: "juridico", prazo: prazo.value, prazo_fatal: fatal.checked, prioridade: +pri.value, status: "aberta", publicacao_id: p.id };
          const { error } = await SB.from("tarefas").insert(row); if (error) throw new Error("Não foi possível criar a tarefa");
        }
        if (obsTxt) await SB.from("publicacoes").update({ observacao_tratamento: obsTxt }).eq("id", p.id);
        toast("Tarefa criada e publicação tratada");
      } else {
        const { error } = await SB.rpc("publicacao_tratar", { p_id: p.id, p_providencia: E.prov, p_obs: obsTxt || null, p_encaminhar: E.prov === "encaminhada" ? para.value : null }); if (error) throw new Error(error.message);
        toast("Publicação tratada");
      }
      try { opts.aoRegistrar?.(); } catch (_) {}
      recarregar();
    }, typeof opts.detalhes === "function" ? el("button", { class: "btn", type: "button", title: "Situação, prazos sugeridos, fontes e histórico", onclick: () => { $("#modalHost").replaceChildren(); opts.detalhes(); } }, "Ver detalhes e histórico") : null);
    const host = $("#modalHost"); btnSalvar = host?.querySelector(".np-f-salvar") || host?.querySelector("button.btn.primary");
    const card = host?.querySelector(".card.np-modal-v3") || host?.querySelector(".modal > .card"); if (card) { card.classList.add("np-modal-wide", "np-tp-card"); if (!card.classList.contains("np-modal-v3")) card.style.maxWidth = "1080px"; }
    ajustar();
    if (!p.lida) SB.from("publicacoes").update({ lida: true }).eq("id", p.id).then(() => { p.lida = true; });
  }
  async function reabrir(p) { if (!confirm("Reabrir o tratamento desta publicação?")) return; const { error } = await SB.rpc("publicacao_reabrir", { p_id: p.id }); if (error) toast(error.message); else { toast("Reaberta"); recarregar(); } }
  async function modalHistorico(p) {
    const { data } = await SB.from("publicacao_historico").select("*").eq("publicacao_id", p.id).order("em");
    const lista = (data || []).length ? el("ul", { class: "tl" }, (data || []).map((h) => el("li", {}, el("div", { class: "d" }, fmtDH(h.em) + " · " + (ACAO[h.acao] || h.acao) + (h.por_nome ? " · " + h.por_nome : "")),
      h.detalhe && Object.keys(h.detalhe).length ? el("div", { class: "note" }, [h.detalhe.providencia ? "Providência: " + (PROV[h.detalhe.providencia]?.[0] || h.detalhe.providencia) : null, h.detalhe.observacao ? "Obs.: " + h.detalhe.observacao : null, h.detalhe.titulo ? "Tarefa: " + h.detalhe.titulo + (h.detalhe.prazo ? " (prazo " + fmtDt(h.detalhe.prazo) + ")" : "") : null].filter(Boolean).join(" · ")) : null))) : el("div", { class: "note" }, "Sem histórico.");
    modal("Histórico da publicação", el("div", {}, el("div", { class: "note" }, (p.numero_processo || "sem número") + " · disponibilizada em " + fmtDt(p.data_disponibilizacao)), lista), async () => {});
    const btn = $("#modalHost button.btn.primary"); if (btn) btn.remove();
  }

  // ---------- relatório ----------
  async function carregarRel() { const { data } = await SB.from("v_publicacoes_tempestividade").select("*").order("mes", { ascending: false }); T.rel = data || []; T.relOk = true; render(); }
  function renderRelatorio(v) {
    if (!T.relOk) { carregarRel(); v.append(el("div", { class: "note" }, "Carregando…")); return; }
    const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "—";
    const porMes = new Map(); for (const r of T.rel) { const m = porMes.get(r.mes) || { mes: r.mes, publicacoes: 0, tratadas: 0, tempestivas: 0, pendentes_vencidas: 0, gerou_prazo: 0, nada_a_fazer: 0, duplicidade: 0, encaminhadas: 0 }; for (const k of Object.keys(m)) if (k !== "mes") m[k] += +r[k] || 0; porMes.set(r.mes, m); }
    const meses = [...porMes.values()];
    v.append(el("div", { class: "card section" }, el("h2", {}, "Tempestividade por mês"), el("div", { class: "note" }, "Tempestiva = tratada até o prazo (dias úteis após a disponibilização, configurável em Processos → Configurações). Pendentes vencidas = ainda sem providência e já fora do prazo."),
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Mês", "Publicações", "Tratadas", "Tempestivas", "% tempestivas", "Pendentes vencidas", "Gerou prazo", "Nada a fazer", "Duplicidade", "Encaminhadas"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...meses.map((m) => el("tr", {}, el("td", {}, m.mes), el("td", {}, String(m.publicacoes)), el("td", {}, String(m.tratadas)), el("td", {}, String(m.tempestivas)), el("td", { class: m.tratadas && m.tempestivas / m.tratadas < 0.9 ? "crit" : "" }, pct(m.tempestivas, m.tratadas)), el("td", { class: m.pendentes_vencidas ? "crit" : "" }, String(m.pendentes_vencidas)), el("td", {}, String(m.gerou_prazo)), el("td", {}, String(m.nada_a_fazer)), el("td", {}, String(m.duplicidade)), el("td", {}, String(m.encaminhadas))))))),
      ...(meses.length ? [] : [el("div", { class: "note" }, "Sem dados.")])));
    v.append(el("div", { class: "card section" }, el("h2", {}, "Por pessoa"), el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Mês", "Quem tratou", "Tratadas", "Tempestivas", "% tempestivas", "Média de dias para tratar"].map((h) => el("th", {}, h)))),
      el("tbody", {}, ...T.rel.filter((r) => r.tratada_por_nome !== "(pendente)").map((r) => el("tr", {}, el("td", {}, r.mes), el("td", {}, r.tratada_por_nome), el("td", {}, String(r.tratadas)), el("td", {}, String(r.tempestivas)), el("td", {}, pct(+r.tempestivas, +r.tratadas)), el("td", {}, r.media_dias_para_tratar ?? "—"))))))));
  }

  // ---------- card de publicações do processo ----------
  function secaoProcesso(p, host) {
    const key = p.id;
    if (!T.pubProc[key]) { T.pubProc[key] = { ok: false, lista: [] }; SB.from("v_publicacoes").select("*").eq("processo_id", p.id).order("data_disponibilizacao", { ascending: false }).limit(50).then(({ data }) => { T.pubProc[key] = { ok: true, lista: data || [] }; render(); }); }
    const st = T.pubProc[key];
    const box = el("div", { class: "card", style: "padding:12px 14px;display:flex;flex-direction:column;gap:6px" }, el("div", { class: "section-h" }, el("h4", { style: "margin:0" }, `Publicações (${st.ok ? st.lista.length : "…"})`), el("div", { class: "actions" }, el("a", { class: "btn sm", href: "#publicacoes", onclick: (ev) => { ev.preventDefault(); S.tab = "publicacoes"; render(); } }, "Abrir Publicações"))));
    if (!st.ok) box.append(el("div", { class: "note" }, "Carregando…"));
    else if (!st.lista.length) box.append(el("div", { class: "note" }, "Nenhuma publicação direcionada a este processo."));
    else box.append(el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Data"), el("th", {}, "Tipo / órgão"), el("th", {}, "Resumo"), el("th", {}, "Providência"), el("th", {}, ""))),
      el("tbody", {}, ...st.lista.map((x) => {
        const resTxt = (typeof window.PP_PUBLICACOES?.limparTexto === "function" ? window.PP_PUBLICACOES.limparTexto(x.texto || x.resumo, { compacto: true }) : String(x.resumo || "")).slice(0, 400);
        return el("tr", {}, el("td", {}, fmtDt(x.data_disponibilizacao)), el("td", {}, el("div", {}, x.tipo_documento || x.tipo_comunicacao || "—"), el("div", { class: "note" }, x.orgao || x.tribunal || "")), el("td", { style: "max-width:360px" }, el("div", { class: "note", style: "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" }, resTxt || "—")), el("td", {}, pillStatus(x)),
        el("td", {}, el("div", { style: "display:flex;gap:4px" }, el("button", { class: "btn sm", onclick: () => window.PP_PUBLICACOES?.abrir?.(x) }, "Ler"), x.providencia ? el("button", { class: "btn sm", onclick: () => modalHistorico(x) }, "Histórico") : el("button", { class: "btn sm primary", onclick: () => modalTratar(x) }, "Tratar"))));
      })))));
    host.append(box);
  }

  // ---------- admin: dar ciência em lote nas publicações antigas (zera o passivo do começo) ----------
  function limparAntigas() {
    const ate = inp("date", new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)), obs = inp("text", "Tratada antes do início do controle de publicações", { style: "min-width:320px" });
    const prev = el("div", { class: "note" }); const contar = async () => { const { count } = await SB.from("publicacoes").select("id", { count: "exact", head: true }).is("providencia", null).lte("data_disponibilizacao", ate.value); prev.textContent = `${count ?? 0} publicação(ões) pendentes até ${fmtDt(ate.value)} receberão a providência "Ciência".`; }; ate.onchange = contar; contar();
    modal("Dar ciência em lote", el("div", { class: "form" }, el("div", { class: "f full note" }, "Use uma vez, para limpar as publicações anteriores ao início do controle. Elas ficam marcadas como “Ciência”, com você como responsável e a observação abaixo, e saem da lista de pendentes (contam como tratadas fora do prazo no relatório — por isso prefira uma data anterior ao mês que você quer medir)."), field("la-ate", "Pendentes disponibilizadas até", ate), el("div", { class: "f full" }, field("la-obs", "Observação", obs)), el("div", { class: "f full" }, prev)), async () => {
      const { data, error } = await SB.from("publicacoes").select("id").is("providencia", null).lte("data_disponibilizacao", ate.value).limit(2000); if (error) throw new Error(error.message);
      let n = 0; for (const p of data || []) { const { error: e2 } = await SB.rpc("publicacao_tratar", { p_id: p.id, p_providencia: "ciencia", p_obs: obs.value.trim() || null, p_encaminhar: null }); if (!e2) n++; }
      toast(`${n} publicação(ões) marcadas como ciência`); recarregar();
    });
    const btn = $("#modalHost button.btn.primary"); if (btn) btn.textContent = "Aplicar";
  }

  // ---------- integração com a tela Publicações ----------
  { const _r = render; render = function () { _r(); const v = $("#view-publicacoes"); if (!v || v.hidden) return;
      const head = v.querySelector(".head"); if (!head) return;
      const b = (k, l) => el("button", { class: "btn sm" + (T.aba === k ? " primary" : ""), onclick: () => { T.aba = k; render(); } }, l);
      head.after(el("div", { class: "actions", style: "justify-content:flex-start;margin:-6px 0 10px" }, b("lista", "Publicações"), b("rel", "Tempestividade"), PP.perfil?.papel === "admin" ? el("button", { class: "btn sm", style: "margin-left:auto", onclick: limparAntigas }, "Dar ciência em lote…") : null));
      if (T.aba === "rel") { [...v.children].forEach((ch, i) => { if (i > 1) ch.remove(); }); renderRelatorio(v); return; }
      // filtro "só pendentes de providência" + coluna de providência nas linhas
      const filtros = v.querySelector("div[style*='flex-wrap']"); if (filtros && !filtros.querySelector(".pt-pend")) {
        const i = el("input", { type: "checkbox", style: "width:16px;height:16px;margin:0;accent-color:var(--gold)" }); i.checked = T.soPendentes; i.onchange = () => { T.soPendentes = i.checked; render(); };
        filtros.append(el("label", { class: "pt-pend", style: "display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer" }, i, "Só pendentes de providência"));
      }
      const lista = window.PP_PUBLICACOES?.lista?.() || []; const porId = new Map(lista.map((p) => [p.id, p]));
      v.querySelectorAll("section.card.section tbody tr").forEach((tr) => {
        const btnLer = [...tr.querySelectorAll("button")].find((b2) => b2.textContent === "Ler"); if (!btnLer) return;
        const pub = porId.get(+tr.dataset.pubId) || porId.get(tr.dataset.pubId); if (!pub) return;
        if (T.soPendentes && pub.providencia) { tr.remove(); return; }
        const tdTarefa = tr.children[5]; if (tdTarefa && !tdTarefa.querySelector(".pt-prov")) tdTarefa.prepend(el("div", { class: "pt-prov", style: "margin-bottom:4px" }, pillStatus(pub)));
        const acts = tr.querySelector("td:last-child > div"); if (acts && !acts.querySelector(".pt-btn")) acts.replaceChildren(...(pub.providencia
          ? [el("button", { class: "btn sm pt-btn", onclick: () => window.PP_PUBLICACOES?.abrir?.(pub) }, "Ler"), el("button", { class: "btn sm pt-btn", onclick: () => modalHistorico(pub) }, "Histórico"), el("button", { class: "btn sm pt-btn", onclick: () => reabrir(pub) }, "Reabrir")]
          : [el("button", { class: "btn sm primary pt-btn", onclick: () => modalTratar(pub) }, "Tratar")]));
      });
      v.querySelectorAll("section.card.section").forEach((sec) => { if (!sec.querySelector("tbody tr")) sec.remove(); });
    }; }
  window.PP_PUB_TRAT = { modalTratar, modalHistorico, pillStatus, secaoProcesso, renderRelatorio, reabrir, limparAntigas };
  window.__PP_LOGIN?.then(() => { SB.from("colaboradores").select("id,perfil_id,nome,ativo").order("nome").then(({ data }) => { T.colab = data || []; });
    SB.from("workflows_prazo").select("*").eq("ativo", true).order("ordem").then(({ data }) => { T.workflows = data || []; });
    SB.from("escritorio").select("dados").eq("id", "juridico").maybeSingle().then(({ data }) => { T.confereId = data?.dados?.conferencia_protocolo_id || null; }); });
})();
