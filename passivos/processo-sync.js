/* Autos no tribunal — o que o AtendeDireito Sync lê de dentro do processo (migração 0117): capa, audiências, partes, movimentos e
   lista de documentos. Entra no fim da ficha completa do processo. Só leitura: não grava nada e não cria andamento nem tarefa.
   Onde a 0117 não existe, ou o processo ainda não foi lido pelo Sync, a seção simplesmente não aparece. */
(() => {
  "use strict";
  const C = { dados: new Map(), pedindo: new Set(), aberto: new Map() };
  const dBR = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const dhBR = (s) => { const d = new Date(s); return isNaN(d) ? dBR(s) : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
  const nota = (...f) => el("p", { class: "np-nota note", style: "margin:0" }, ...f);
  const bloco = (titulo, ...filhos) => el("div", { style: "display:flex;flex-direction:column;gap:6px;min-width:0" }, el("div", { style: "font-weight:600" }, titulo), ...filhos);
  function lista(pid, chave, itens, max, linha) {
    const tudo = C.aberto.get(pid + chave) === true, mostra = tudo ? itens : itens.slice(0, max);
    const ul = el("ul", { style: "list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px" }, ...mostra.map((x) => el("li", { style: "overflow-wrap:anywhere" }, linha(x))));
    const mais = itens.length > max ? el("button", { type: "button", class: "np-link link", onclick: () => { C.aberto.set(pid + chave, !tudo); if (typeof render === "function") render(); } }, tudo ? "Mostrar menos" : `Mostrar todos (${itens.length})`) : null;
    return [ul, mais].filter(Boolean);
  }
  function montar(pid, s) {
    const capa = s.capa || {}, aud = (s.audiencias || []).slice().sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const hoje = new Date().toISOString().slice(0, 10), futuras = aud.filter((a) => String(a.data).slice(0, 10) >= hoje);
    const mov = (s.movimentos || []).slice().sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    const docs = (s.documentos || []).slice().sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    const partes = s.partes || [];
    const resumo = [capa.classe, capa.grau ? "grau " + capa.grau : null, s.ultima_decisao ? "última decisão em " + dBR(s.ultima_decisao) : null, s.ultimo_andamento ? "último andamento em " + dBR(s.ultimo_andamento) : null].filter(Boolean).join(" · ");
    const corpo = [
      nota("Lido dos autos pelo AtendeDireito Sync", s.sincronizado_fonte ? " em " + dhBR(s.sincronizado_fonte) : "", ". Informação do tribunal, só para consulta: não substitui os andamentos e prazos registrados pelo escritório."),
      resumo ? el("p", { style: "margin:0" }, resumo) : null,
      capa.segredo_justica ? nota("Processo em segredo de justiça", capa.segredo_sem_acesso ? ": o Sync não consegue ler os autos sem o acesso do titular." : ".") : null,
      futuras.length ? bloco(`Audiências marcadas (${futuras.length})`, ...futuras.map((a) => el("div", {}, el("b", {}, dhBR(a.data)), a.descricao ? " · " + a.descricao : ""))) : null,
      partes.length ? bloco(`Partes (${partes.length})`, ...lista(pid, "p", partes, 6, (x) => [el("b", {}, x.nome || "—"), x.polo ? " · polo " + x.polo : "", x.documento ? " · " + x.documento : "", x.advogados ? el("span", { style: "color:var(--muted)" }, " · adv. " + x.advogados) : null])) : null,
      mov.length ? bloco(`Movimentos no tribunal (${mov.length})`, ...lista(pid, "m", mov, 10, (x) => [el("b", {}, dBR(x.data) || "—"), " · ", x.descricao || ""])) : null,
      docs.length ? bloco(`Documentos nos autos (${docs.length})`, ...lista(pid, "d", docs, 10, (x) => [el("b", {}, dBR(x.data) || "—"), " · ", x.nome || x.tipo || "documento", x.tipo && x.nome ? el("span", { style: "color:var(--muted)" }, " · " + String(x.tipo).toLowerCase()) : null]),
        nota("Para abrir uma peça, use o AtendeDireito Sync ou o tribunal; os arquivos não são copiados para este sistema.")) : null,
    ].filter(Boolean);
    const dentro = el("div", { style: "display:flex;flex-direction:column;gap:14px" }, ...corpo);
    return window.NPUI?.secao ? window.NPUI.secao("Autos no tribunal", dentro) : el("section", { class: "card section" }, el("div", { class: "section-h" }, el("h2", {}, "Autos no tribunal")), dentro);
  }
  async function buscar(pid) {
    if (C.pedindo.has(pid)) return; C.pedindo.add(pid);
    try { const r = await SB.from("processo_sync").select("capa,partes,movimentos,documentos,audiencias,ultima_decisao,ultimo_andamento,sincronizado_fonte").eq("processo_id", pid).maybeSingle();
      C.dados.set(pid, r.error ? null : (r.data || null)); }
    catch (_) { C.dados.set(pid, null); }
    finally { C.pedindo.delete(pid); }
    if (C.dados.get(pid) && typeof render === "function") render();
  }
  const O = window.PP_PROCESSO; if (!O || typeof O.ficha !== "function") return;
  const _ficha = O.ficha;
  O.ficha = function (p, opts) {
    const box = _ficha.call(this, p, opts);
    try { if (p?.id && box?.append) { if (!C.dados.has(p.id)) buscar(p.id); const s = C.dados.get(p.id); if (s) box.append(el("div", { "data-np-autos": p.id, style: "margin-top:16px" }, montar(p.id, s))); } }
    catch (e) { console.warn("processo-sync:", e); }
    return box;
  };
  window.PP_PROCESSO_SYNC = { invalidar: (pid) => { pid ? C.dados.delete(pid) : C.dados.clear(); } };
})();
