/* Monitoramento — processos encontrados pelo AtendeDireito Sync (migrações 0118/0119).
   O Sync acompanha os processos em nome do CPF/CNPJ de cada cliente. Os que ainda não estão cadastrados no sistema aparecem aqui,
   por cliente, para o Jurídico decidir: Cadastrar (cria o processo já ligado ao cliente) ou Dispensar. Nada é cadastrado sozinho.
   Onde as migrações não existem, a seção simplesmente não aparece. */
(() => {
  "use strict";
  const M = { ok: false, pedindo: false, lista: [], mons: 0, verDisp: false, abertos: new Set(), erro: false };
  const dBR = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const nomeCli = (id) => { const c = (S.clientes || []).find((x) => x.id === id); return c ? (c.nome_fantasia || c.nome) : "Cliente"; };
  async function carregar() {
    if (M.pedindo) return; M.pedindo = true;
    try {
      const [e, m] = await Promise.all([SB.from("sync_encontrados").select("numero,numero_mascara,cliente_id,documento,tribunal,classe,assunto,polo_ativo,polo_passivo,valor_causa,data_distribuicao,ultimo_andamento,situacao,criado_em").neq("situacao", "cadastrado").order("criado_em", { ascending: false }).limit(1000),
        SB.from("sync_monitores").select("id", { count: "exact", head: true })]);
      M.erro = !!e.error; M.lista = e.error ? [] : (e.data || []); M.mons = m.count || 0; M.ok = true;
    } catch (_) { M.erro = true; M.ok = true; } finally { M.pedindo = false; }
    if (S.tab === "monitoramento" && typeof render === "function") render();
  }
  async function decidir(btn, fn, okMsg) {
    btn.disabled = true;
    try { const { error } = await fn(); if (error) throw error; toast(okMsg); M.ok = false; await carregar(); window.PP_PROCESSOS?.recarregar?.(); }
    catch (err) { toast(err.message || "Não foi possível concluir"); btn.disabled = false; }
  }
  /* Em lote, por grupo: uma chamada por processo, na ordem; o que falhar fica na lista e é contado no aviso. */
  async function emLote(btn, itens, modo, nome) {
    const cad = modo === "cadastrar", alvo = cad ? itens.filter((x) => x.cliente_id) : itens; if (!alvo.length) return;
    const rodar = async () => {
      btn.disabled = true; const rot = btn.textContent; let ok = 0, falhas = 0;
      for (const x of alvo) {
        btn.textContent = `${cad ? "Cadastrando" : "Dispensando"} ${ok + falhas + 1} de ${alvo.length}…`;
        try { const { error } = cad ? await SB.rpc("sync_encontrado_cadastrar", { p_numero: x.numero, p_cliente: null }) : await SB.rpc("sync_encontrado_dispensar", { p_numero: x.numero, p_voltar: false }); if (error) throw error; ok++; }
        catch (_) { falhas++; }
      }
      btn.textContent = rot; btn.disabled = false;
      toast(`${ok} processo(s) ${cad ? "cadastrado(s)" : "dispensado(s)"}` + (falhas ? ` · ${falhas} não ${cad ? "cadastrado(s)" : "dispensado(s)"}, continuam na lista` : ""));
      M.ok = false; await carregar(); if (cad) window.PP_PROCESSOS?.recarregar?.();
    };
    const titulo = cad ? `Cadastrar ${alvo.length} processo(s)?` : `Dispensar ${alvo.length} processo(s)?`;
    const texto = cad ? `Os ${alvo.length} processo(s) de ${nome} entram no cadastro do cliente como ativos, sem ficar visíveis ao cliente.` : `Os ${alvo.length} processo(s) de ${nome} saem desta lista. Eles continuam em “Ver dispensados” e podem voltar.`;
    if (window.NPUI?.confirmar) window.NPUI.confirmar({ titulo, texto, rotuloSim: cad ? "Cadastrar todos" : "Dispensar todos", origem: btn, onSim: rodar });
    else if (typeof npConfirmar === "function") npConfirmar({ titulo, mensagem: texto, confirmar: cad ? "Cadastrar todos" : "Dispensar todos", onSim: rodar });
  }
  function acoesGrupo(k, itens) {
    const nome = k ? nomeCli(k) : "processos sem cliente identificado";
    const b = (rot, modo, pri) => window.NPUI?.btn ? window.NPUI.btn(rot, { variante: pri ? "pri" : undefined, onclick: (e) => emLote(e.currentTarget, itens, modo, nome) }) : el("button", { class: "btn sm" + (pri ? " primary" : ""), onclick: (e) => emLote(e.currentTarget, itens, modo, nome) }, rot);
    return el("div", { "data-np-lote": "1", style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 2px" },
      k ? b(`Cadastrar todos (${itens.length})`, "cadastrar", true) : null, b(`Dispensar todos (${itens.length})`, "dispensar", false));
  }
  function linha(x, ro) {
    const b = (rot, fn, pri) => window.NPUI?.btn ? window.NPUI.btn(rot, { variante: pri ? "pri" : undefined, onclick: fn }) : el("button", { class: "btn sm" + (pri ? " primary" : ""), onclick: fn }, rot);
    const acoes = ro ? [] : x.situacao === "dispensado"
      ? [b("Voltar para a lista", (e) => decidir(e.currentTarget, () => SB.rpc("sync_encontrado_dispensar", { p_numero: x.numero, p_voltar: true }), "Voltou para a lista"))]
      : [x.cliente_id ? b("Cadastrar", (e) => decidir(e.currentTarget, () => SB.rpc("sync_encontrado_cadastrar", { p_numero: x.numero, p_cliente: null }), "Processo cadastrado no cliente"), true) : null,
         b("Dispensar", (e) => decidir(e.currentTarget, () => SB.rpc("sync_encontrado_dispensar", { p_numero: x.numero, p_voltar: false }), "Dispensado"))].filter(Boolean);
    return el("li", { style: "display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line);flex-wrap:wrap" },
      el("div", { style: "min-width:0;flex:1 1 320px" },
        el("div", { style: "font-weight:600;overflow-wrap:anywhere" }, x.numero_mascara || x.numero, x.tribunal ? el("span", { style: "font-weight:400;color:var(--muted)" }, " · " + x.tribunal) : null),
        el("div", { style: "overflow-wrap:anywhere" }, [x.polo_ativo, x.polo_passivo].filter(Boolean).join(" × ") || "partes não informadas"),
        el("div", { class: "note np-nota", style: "margin:0" }, [x.classe, x.valor_causa ? "R$ " + Number(x.valor_causa).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : null, x.data_distribuicao ? "distribuído em " + dBR(x.data_distribuicao) : null, x.ultimo_andamento ? "último andamento em " + dBR(x.ultimo_andamento) : null].filter(Boolean).join(" · "))),
      acoes.length ? el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, ...acoes) : null);
  }
  function secao() {
    if (!M.ok) { carregar(); return null; }
    if (M.erro || (!M.lista.length && !M.mons)) return null;
    const ro = typeof readOnly === "function" && readOnly();
    const vivos = M.lista.filter((x) => x.situacao === "novo"), disp = M.lista.filter((x) => x.situacao === "dispensado"), fonte = M.verDisp ? disp : vivos;
    const grupos = new Map(); for (const x of fonte) { const k = x.cliente_id || ""; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(x); }
    const ordem = [...grupos.keys()].sort((a, b) => (a ? nomeCli(a) : "~").localeCompare(b ? nomeCli(b) : "~"));
    const corpo = el("div", { style: "display:flex;flex-direction:column;gap:6px" },
      el("p", { class: "note np-nota", style: "margin:0" }, `${M.mons} CPF/CNPJ de clientes monitorados no AtendeDireito Sync. Abaixo, os processos que ele acompanha e que ainda não estão cadastrados aqui. Cadastrar cria o processo no cliente; dispensar só tira da lista.`),
      el("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" }, el("b", {}, M.verDisp ? `${disp.length} dispensado(s)` : `${vivos.length} a decidir`),
        disp.length || M.verDisp ? el("button", { type: "button", class: "np-link link", onclick: () => { M.verDisp = !M.verDisp; render(); } }, M.verDisp ? "Ver os que faltam decidir" : `Ver dispensados (${disp.length})`) : null),
      ...ordem.map((k) => { const itens = grupos.get(k), aberto = M.abertos.has(k);
        return el("div", { style: "border:1px solid var(--line);border-radius:10px;padding:10px 14px" },
          el("button", { type: "button", style: "all:unset;cursor:pointer;display:flex;justify-content:space-between;gap:12px;width:100%;font-weight:600", "aria-expanded": String(aberto), onclick: () => { aberto ? M.abertos.delete(k) : M.abertos.add(k); render(); } },
            el("span", {}, k ? nomeCli(k) : "Sem cliente identificado (processos da OAB do escritório)"), el("span", { style: "font-weight:400;color:var(--muted)" }, `${itens.length} processo(s) ${aberto ? "▴" : "▾"}`)),
          aberto && !ro && !M.verDisp && itens.length > 1 ? acoesGrupo(k, itens) : null,
          aberto ? el("ul", { style: "list-style:none;margin:8px 0 0;padding:0" }, ...itens.map((x) => linha(x, ro))) : null); }),
      !fonte.length ? el("p", { class: "note np-nota", style: "margin:0" }, M.verDisp ? "Nenhum processo dispensado." : "Nenhum processo novo a decidir.") : null);
    const s = window.NPUI?.secao ? window.NPUI.secao("Processos encontrados pelo Sync", corpo) : el("section", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Processos encontrados pelo Sync")), corpo);
    return el("div", { "data-np-encontrados": "1", style: "margin:0 0 20px" }, s);
  }
  const _r = render;
  render = function () {
    _r.apply(this, arguments);
    try { if (S.tab !== "monitoramento") return; const v = document.getElementById("view-monitoramento"); if (!v || v.hidden || v.querySelector("[data-np-encontrados]")) return; const s = secao(); if (s) v.prepend(s); }
    catch (e) { console.warn("monitoramento-sync:", e); }
  };
  window.PP_MONITORAMENTO_SYNC = { recarregar: () => { M.ok = false; carregar(); }, lista: () => M.lista };
})();
