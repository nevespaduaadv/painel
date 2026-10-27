/* Dossiê do cliente — as três frentes se encontram aqui (beta 0008).
   No Resumo do cliente: "Informações relevantes" (registros fixados), três colunas (Estratégico · Jurídico · Negocial: responsável,
   último registro, próximo prazo, abertas) e a linha do tempo única (v_dossie: registros, andamentos, tarefas feitas, publicações
   tratadas, negociações, cobranças), com filtro por frente. Botão "Registrar" (PP_CARTEIRA.registrar) em todo lugar.
   Supabase: v_dossie, v_cliente_frentes, entradas_timeline(frente, fixado), clientes.resp_*_id, colaboradores.frente. */
(() => {
  "use strict";
  const D = { cache: {}, filtro: {} };
  const FRENTES = { estrategico: "Estratégico / Consultivo", juridico: "Jurídico / Contencioso", negocial: "Negocial / Acordos" };
  const ORIGEM = { registro: "Registro", andamento: "Andamento", tarefa: "Tarefa feita", publicacao: "Publicação", negociacao: "Negociação", cobranca: "Cobrança" };
  const TIPO = { registro: "Registro", informacao_cliente: "Informação do cliente", decisao: "Decisão", nao_feito: "Não feito — motivo", contato_cliente: "Contato com o cliente", contato_banco: "Contato com o banco", reuniao_cliente: "Reunião", proposta_acordo: "Proposta de acordo", parecer_tecnico: "Parecer", analise_contrato: "Análise de contrato", solicitacao_documentos: "Solicitação de documentos", requerimento_bacen: "Requerimento ao Bacen", ata: "Ata", protocolo: "Protocolo", tarefa_feita: "Tarefa concluída", outro: "Registro" };
  const fmtDH = (s) => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtD = (s) => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const dias = (iso) => iso ? Math.round((Date.now() - new Date(iso).getTime()) / 864e5) : null;
  const invalidar = (cid) => { if (cid) delete D.cache[cid]; else D.cache = {}; };
  async function carregar(cid) {
    D.cache[cid] = { ok: false, itens: [], frentes: [], colab: [] };
    const [a, b, c] = await Promise.all([SB.from("v_dossie").select("*").eq("cliente_id", cid).order("quando", { ascending: false }).limit(150), SB.from("v_cliente_frentes").select("*").eq("cliente_id", cid), SB.from("colaboradores").select("id,nome,frente,ativo").order("nome")]);
    D.cache[cid] = { ok: true, itens: a.data || [], frentes: b.data || [], colab: c.data || [] }; render();
  }
  const rotuloTipo = (it) => it.origem === "registro" ? (TIPO[it.tipo] || it.tipo) : it.origem === "publicacao" ? "Publicação · " + (it.tipo || "").replace("publicacao_", "").replace("_", " ") : it.origem === "negociacao" ? "Negociação" : it.origem === "cobranca" ? "Cobrança" : ORIGEM[it.origem] || it.origem;
  function definirResp(c, frente, atual, colab) {
    const s = sel({ "": "— padrão (quem é da frente) —", ...Object.fromEntries(colab.filter((x) => x.ativo !== false).map((x) => [x.id, x.nome + (x.frente ? " · " + FRENTES[x.frente].split(" /")[0] : "")])) }, atual || "");
    modal("Responsável · " + FRENTES[frente], el("div", { class: "form" }, el("div", { class: "f full note" }, "Só preencha quando este cliente fugir da regra. Em branco, vale a frente de cada pessoa no cadastro de colaboradores."), field("rf", "Responsável neste cliente", s)), async () => {
      const col = { estrategico: "resp_estrategico_id", juridico: "resp_juridico_id", negocial: "resp_negocial_id" }[frente];
      const { error } = await SB.from("clientes").update({ [col]: s.value || null }).eq("id", c.id); if (error) throw new Error(error.message); c[col] = s.value || null; toast("Salvo"); invalidar(c.id); render();
    });
  }
  function cardDossie(c) {
    const st = D.cache[c.id]; if (!st) { carregar(c.id); }
    const box = el("section", { class: "card section", style: "display:flex;flex-direction:column;gap:12px" });
    box.append(el("div", { class: "section-h" }, el("div", {}, el("h2", {}, "Dossiê"), el("div", { class: "note" }, "Tudo o que o escritório sabe e fez por este cliente, nas três frentes.")), el("div", { class: "actions edit-only" }, el("button", { class: "btn sm primary", onclick: () => window.PP_CARTEIRA?.registrar(c.id, {}) }, "+ Registrar"))));
    if (!st || !st.ok) { box.append(el("div", { class: "note" }, "Carregando…")); return box; }
    // informações relevantes (fixadas)
    const fix = st.itens.filter((i) => i.fixado);
    box.append(el("div", {}, el("div", { class: "eyebrow" }, "Informações relevantes"), fix.length ? el("ul", { style: "margin:4px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px" }, ...fix.map((i) => el("li", { style: "white-space:pre-wrap" }, i.texto, el("span", { class: "note" }, ` — ${i.autor || ""}, ${fmtD(i.quando)}`)))) : el("div", { class: "note" }, "Nada fixado. Ao registrar uma “Informação do cliente”, marque “Fixar no perfil”.")));
    // três colunas
    const porF = Object.fromEntries(st.frentes.map((f) => [f.frente, f]));
    const cols = el("div", { style: "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px" });
    for (const [k, nome] of Object.entries(FRENTES)) { const f = porF[k] || {}; const resp = f.responsavel_id ? st.colab.find((x) => x.id === f.responsavel_id)?.nome : null; const padrao = st.colab.filter((x) => x.frente === k && x.ativo !== false).map((x) => x.nome.split(" ")[0]); const d = dias(f.ultimo_em); const dp = f.proximo_prazo ? Math.round((new Date(f.proximo_prazo + "T12:00:00") - new Date().setHours(12, 0, 0, 0)) / 864e5) : null;
      cols.append(el("div", { class: "card", style: "padding:10px 12px;display:flex;flex-direction:column;gap:4px;border-top:3px solid var(--" + (k === "juridico" ? "crit" : k === "negocial" ? "gold" : "info") + ")" },
        el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, el("b", {}, nome), el("button", { class: "btn sm edit-only", style: "padding:2px 8px", onclick: () => definirResp(c, k, f.responsavel_id, st.colab) }, resp ? resp.split(" ")[0] : padrao.length ? padrao.join(", ") : "sem responsável")),
        el("div", { class: "note" }, f.ultimo_em ? `Último: ${fmtDH(f.ultimo_em)} (${d} d) · ${f.ultimo_autor || ""}` : "Sem registro nesta frente"), f.ultimo_texto ? el("div", { style: "font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap" }, f.ultimo_texto) : null,
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:4px" }, f.proximo_prazo ? el("span", { class: "pill " + (dp < 0 ? "e3" : dp <= 7 ? "e2" : "g") }, "próximo prazo " + fmtD(f.proximo_prazo)) : null, +f.tarefas_abertas ? el("span", { class: "pill c" }, f.tarefas_abertas + " tarefa(s)") : null, k === "juridico" && +f.processos_ativos ? el("span", { class: "pill g" }, f.processos_ativos + " processo(s)") : null, k === "negocial" && +f.negociacoes_abertas ? el("span", { class: "pill g" }, f.negociacoes_abertas + " negociação(ões)") : null, d != null && d > 30 ? el("span", { class: "pill e3" }, "parado há " + d + " d") : null),
        el("div", { class: "actions edit-only", style: "justify-content:flex-start;margin-top:2px" }, el("button", { class: "btn sm", onclick: () => window.PP_CARTEIRA?.registrar(c.id, { frente: k }) }, "Registrar aqui")))); }
    box.append(cols);
    // linha do tempo
    const fl = D.filtro[c.id] || ""; const fs = sel({ "": "Todas as frentes", ...FRENTES, "__reg": "Só registros manuais" }, fl); fs.onchange = () => { D.filtro[c.id] = fs.value; render(); };
    const itens = st.itens.filter((i) => !fl || (fl === "__reg" ? i.origem === "registro" : i.frente === fl));
    const lista = el("ul", { class: "tl", style: "margin-top:6px" }, ...itens.slice(0, 80).map((i) => el("li", { class: i.origem === "registro" ? "" : "ev-sistema" }, el("div", { class: "d" }, fmtDH(i.quando), " · ", el("span", { class: "pill " + (i.frente === "juridico" ? "e3" : i.frente === "negocial" ? "e2" : "c"), style: "margin:0 4px" }, i.frente ? FRENTES[i.frente].split(" /")[0] : "—"), rotuloTipo(i), i.autor ? " · " + i.autor : "", i.numero_cnj ? el("a", { href: "#processos", style: "margin-left:6px", onclick: (ev) => { ev.preventDefault(); if (i.processo_id) window.PP_CARTEIRA?.abrirProcesso(c.id, i.processo_id); } }, i.numero_cnj) : null, i.visivel_cliente ? el("span", { class: "pill e1", style: "margin-left:6px" }, "visível ao cliente") : null),
      el("div", { style: "white-space:pre-wrap;font-size:13.5px" + (i.origem === "registro" ? ";padding:6px 10px;background:var(--surface-2);border-radius:8px;margin-top:2px" : "") }, i.texto),
      i.tarefa_id && i.origem !== "registro" ? el("div", { class: "actions", style: "justify-content:flex-start;margin-top:2px" }, el("button", { class: "btn sm", onclick: () => window.PP_TAREFAS?.abrir(i.tarefa_id) }, "Abrir tarefa")) : null)));
    box.append(el("div", {}, el("div", { class: "section-h" }, el("h3", { style: "margin:0;font-size:15px" }, `Linha do tempo (${itens.length})`), fs), itens.length ? lista : el("div", { class: "note" }, "Nada ainda.")));
    return box;
  }
  { const _r = window.PP_MOD?.resumo; if (window.PP_MOD) window.PP_MOD.resumo = (c, host, ind) => { if (typeof equipe === "function" && equipe() && !(typeof readOnly === "function" && readOnly())) host.append(cardDossie(c)); _r && _r(c, host, ind); }; }
  window.PP_DOSSIE = { invalidar, FRENTES };
  window.__PP_LOGIN?.then(() => { if (typeof equipe === "function" && equipe()) { const ch = SB.channel("dossie"); for (const t of ["entradas_timeline", "andamentos", "tarefas", "negociacoes"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (m) => { const cid = m.new?.cliente_id || m.old?.cliente_id; if (cid) invalidar(cid); else invalidar(); if (S.tab === "clientes") render(); }); ch.subscribe(); } });
})();
