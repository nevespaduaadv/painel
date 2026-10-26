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

  // ---------- tratar ----------
  function modalTratar(p) {
    const prov = sel({ gerou_prazo: "Gerou prazo (crie a tarefa para quem vai cumprir)", nada_a_fazer: "Nada a fazer", ciencia: "Só ciência (sem providência)", encaminhada: "Encaminhar para alguém decidir", duplicidade: "Duplicidade (já tratada em outra publicação)" }, p.providencia || "nada_a_fazer");
    const para = sel({ "": "— escolha —", ...Object.fromEntries((T.colab.length ? T.colab : (window.PP_PUBLICACOES?.colab?.() || [])).filter((c) => c.ativo !== false).map((c) => [c.id, c.nome])) }, p.encaminhada_para || "");
    const obs = el("textarea", { rows: 3 }, p.observacao_tratamento || "");
    const fPara = field("tr-para", "Encaminhar para", para); fPara.hidden = prov.value !== "encaminhada"; prov.onchange = () => { fPara.hidden = prov.value !== "encaminhada"; };
    const body = el("div", { class: "form" }, el("div", { class: "f full note" }, `Publicação de ${fmtDt(p.data_disponibilizacao)} · ${p.numero_processo || "sem número"}${p.cliente_nome ? " · " + p.cliente_nome : ""} · prazo para tratar: ${fmtDt(p.prazo_tratamento)}`),
      field("tr-prov", "Providência", prov), fPara, field("tr-obs", "Observação (o que foi feito / por quê)", obs));
    modal("Tratar publicação", body, async () => {
      if (prov.value === "encaminhada" && !para.value) throw new Error("Escolha para quem encaminhar");
      if (prov.value === "gerou_prazo") { $("#modalHost").replaceChildren(); window.PP_PUBLICACOES?.atribuir?.(p); return; }
      const { error } = await SB.rpc("publicacao_tratar", { p_id: p.id, p_providencia: prov.value, p_obs: obs.value.trim() || null, p_encaminhar: prov.value === "encaminhada" ? para.value : null });
      if (error) throw new Error(error.message);
      toast("Publicação tratada"); recarregar();
    });
    const btn = $("#modalHost button.btn.primary"); if (btn) btn.textContent = "Registrar";
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
      el("tbody", {}, ...st.lista.map((x) => el("tr", {}, el("td", {}, fmtDt(x.data_disponibilizacao)), el("td", {}, el("div", {}, x.tipo_documento || x.tipo_comunicacao || "—"), el("div", { class: "note" }, x.orgao || x.tribunal || "")), el("td", { style: "max-width:360px" }, el("div", { class: "note", style: "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" }, x.resumo || "—")), el("td", {}, pillStatus(x)),
        el("td", {}, el("div", { style: "display:flex;gap:4px" }, el("button", { class: "btn sm", onclick: () => window.PP_PUBLICACOES?.abrir?.(x) }, "Ler"), x.providencia ? el("button", { class: "btn sm", onclick: () => modalHistorico(x) }, "Histórico") : el("button", { class: "btn sm primary", onclick: () => modalTratar(x) }, "Tratar")))))))));
    host.append(box);
  }

  // ---------- integração com a tela Publicações ----------
  { const _r = render; render = function () { _r(); const v = $("#view-publicacoes"); if (!v || v.hidden) return;
      const head = v.querySelector(".head"); if (!head) return;
      const b = (k, l) => el("button", { class: "btn sm" + (T.aba === k ? " primary" : ""), onclick: () => { T.aba = k; render(); } }, l);
      head.after(el("div", { class: "actions", style: "justify-content:flex-start;margin:-6px 0 10px" }, b("lista", "Publicações"), b("rel", "Tempestividade")));
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
        const acts = tr.querySelector("td:last-child > div"); if (acts && !acts.querySelector(".pt-btn")) { acts.prepend(pub.providencia ? el("button", { class: "btn sm pt-btn", onclick: () => modalHistorico(pub) }, "Histórico") : el("button", { class: "btn sm primary pt-btn", onclick: () => modalTratar(pub) }, "Tratar")); if (pub.providencia) acts.append(el("button", { class: "btn sm pt-btn", onclick: () => reabrir(pub) }, "Reabrir")); }
      });
      v.querySelectorAll("section.card.section").forEach((sec) => { if (!sec.querySelector("tbody tr")) sec.remove(); });
    }; }
  window.PP_PUB_TRAT = { modalTratar, modalHistorico, pillStatus, secaoProcesso };
  window.__PP_LOGIN?.then(() => { SB.from("colaboradores").select("id,perfil_id,nome,ativo").order("nome").then(({ data }) => { T.colab = data || []; }); });
})();
