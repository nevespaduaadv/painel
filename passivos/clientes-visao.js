/* Visão geral de clientes (beta) — no topo da lista de Clientes, só equipe. Conta CLIENTES (quem contratou), não "contatos":
   sócios/avalistas ficam dentro do cliente, partes contrárias ficam no processo e colaboradores em Gestão.
   KPIs: ativos, novos no mês × mês anterior, com/sem processo ativo, inadimplentes. Gráficos: origem, segmento, cidade/UF, etapa do fluxo, frentes.
   Supabase: v_clientes_ficha, v_cliente_passagem. */
(() => {
  "use strict";
  const V = { lista: null, pass: null, carregando: false, aberto: true };
  const COR = ["#0C1F38", "#B8964A", "#3F6B8E", "#7A9E7E", "#C96C3B", "#8E6C8A", "#5B8FA8", "#A3A380", "#D4A373", "#6B705C"];
  const sv = (t, a = {}, ...k) => { const e = document.createElementNS("http://www.w3.org/2000/svg", t); for (const [n, v] of Object.entries(a)) e.setAttribute(n, v); e.append(...k); return e; };
  const contar = (L, f) => { const m = new Map(); for (const c of L) { const k = (f(c) || "Não informado").toString().trim() || "Não informado"; m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  function barras(itens, max = 8) {
    const it = itens.slice(0, max); const W = 420, rh = 24, ml = 150, H = Math.max(30, it.length * rh + 6), top = Math.max(1, ...it.map((x) => x[1]));
    const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, style: "width:100%;height:auto;display:block", role: "img" });
    it.forEach(([nome, v], i) => { const y = 3 + i * rh, w = (W - ml - 40) * (v / top); const rot = String(nome).length > 22 ? String(nome).slice(0, 21) + "…" : String(nome);
      s.append(sv("text", { x: ml - 8, y: y + 16, "text-anchor": "end", "font-size": "12", fill: "var(--muted)" }, sv("title", {}, String(nome)), rot), sv("rect", { x: ml, y: y + 4, width: Math.max(w, 2), height: rh - 9, rx: 3, fill: COR[i % COR.length], opacity: ".85" }), sv("text", { x: ml + w + 6, y: y + 16, "font-size": "12", fill: "var(--fg)" }, String(v))); });
    if (!it.length) s.append(sv("text", { x: W / 2, y: 20, "text-anchor": "middle", fill: "var(--muted)", "font-size": "12" }, "Sem dados"));
    return s;
  }
  function donut(itens, max = 7) {
    const it = itens.slice(0, max); const resto = itens.slice(max).reduce((a, x) => a + x[1], 0); if (resto) it.push(["Outras", resto]);
    const tot = it.reduce((a, x) => a + x[1], 0) || 1; const R = 54, r = 32, cx = 64, cy = 64; let ang = -Math.PI / 2;
    const s = sv("svg", { viewBox: "0 0 128 128", style: "width:128px;height:128px;flex:none", role: "img" });
    it.forEach(([nome, v], i) => { const a2 = ang + 2 * Math.PI * (v / tot); const big = a2 - ang > Math.PI ? 1 : 0; const p = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; const [x1, y1] = p(ang, R), [x2, y2] = p(a2, R), [x3, y3] = p(a2, r), [x4, y4] = p(ang, r);
      s.append(sv("path", { d: `M${x1} ${y1} A${R} ${R} 0 ${big} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${big} 0 ${x4} ${y4} Z`, fill: COR[i % COR.length], opacity: ".9" }, sv("title", {}, `${nome}: ${v}`))); ang = a2; });
    s.append(sv("text", { x: cx, y: cy + 5, "text-anchor": "middle", "font-size": "16", "font-weight": "700", fill: "var(--fg)" }, String(tot)));
    const leg = el("div", { style: "display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:0" }, ...it.map(([nome, v], i) => el("div", { style: "display:flex;gap:6px;align-items:center" }, el("span", { style: `width:10px;height:10px;border-radius:2px;background:${COR[i % COR.length]};flex:none` }), el("span", { class: "note", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: String(nome) }, nome), el("b", {}, String(v)))));
    return el("div", { style: "display:flex;gap:14px;align-items:center" }, s, leg);
  }
  async function carregar() { if (V.carregando) return; V.carregando = true; try { const [a, b, p] = await Promise.all([SB.from("clientes").select("id,nome,ativo,status,tipo_pessoa,cidade,uf,segmento,origem,closer,plano,etapa_fluxo,servico,created_at,data_fechamento,data_onboarding").then((r) => r.data || []).catch(() => []), SB.from("v_cliente_passagem").select("cliente_id,situacao,faltam,bens_expostos").then((r) => r.data || []).catch(() => []), SB.from("processos").select("cliente_id,status").eq("status", "ativo").then((r) => r.data || []).catch(() => [])]);
      const np = {}; for (const x of p) np[x.cliente_id] = (np[x.cliente_id] || 0) + 1; V.lista = a.map((c) => ({ ...c, processos_ativos: np[c.id] || 0 })); V.pass = b; } finally { V.carregando = false; } if (S.tab === "clientes" && !S.sel) renderList(); }
  const ETAPAS = { 0: "0 Contrato fechado", 1: "1 Cadastro ADVBox", 2: "2 Formulário enviado", 3: "3 Formulário respondido", 4: "4 Auditoria", 5: "5 R1 agendada", 6: "6 R1 feita", 7: "7 R2 feita", 8: "8 R3 feita", 9: "9 Ciclo encerrado", 10: "10 Ciclo mensal" };
  const SIT = { inadimplente: "Inadimplente", vai_ficar_inadimplente: "Vai ficar inadimplente", adimplente: "Adimplente" };
  function card() {
    if (!V.lista) { if (!V.carregando) carregar(); return el("div", { class: "card section" }, el("div", { class: "note" }, "Carregando visão geral…")); }
    const L = V.lista.filter((c) => c.ativo !== false && !/^TESTE/i.test(c.nome || ""));
    const hoje = new Date(), m0 = hoje.toISOString().slice(0, 7), d1 = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), m1 = d1.toISOString().slice(0, 7);
    const mes = (c) => (c.data_fechamento || c.created_at || "").slice(0, 7); const novos = L.filter((c) => mes(c) === m0).length, ant = L.filter((c) => mes(c) === m1).length;
    const comProc = L.filter((c) => +c.processos_ativos > 0), semProc = L.filter((c) => !(+c.processos_ativos > 0));
    const sitDe = (c) => SIT[V.pass.find((p) => p.cliente_id === c.id)?.situacao] || "Não respondido";
    const K = (l, v, h, cls) => el("div", { class: "card kpi" }, el("div", { class: "l" }, l), el("div", { class: "v", style: cls ? `color:var(--${cls})` : "" }, v), el("div", { class: "h" }, h));
    const lista = (arr) => el("details", { style: "margin-top:4px" }, el("summary", { class: "note", style: "cursor:pointer" }, "Mostrar clientes"), el("div", { class: "note", style: "margin-top:4px;line-height:1.7" }, ...arr.map((c, i) => [i ? " · " : "", el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); S.sel = c.id; S.sub = "dossie"; render(); } }, c.nome)]).flat()));
    const bloco = (titulo, conteudo, nota) => el("div", { class: "card section", style: "flex:1;min-width:280px" }, el("div", { class: "section-h" }, el("h2", {}, titulo), nota ? el("span", { class: "note" }, nota) : null), conteudo);
    const head = el("div", { class: "section-h", style: "cursor:pointer", onclick: () => { V.aberto = !V.aberto; renderList(); } }, el("div", {}, el("h2", {}, "Visão geral dos clientes"), el("div", { class: "note" }, "Só quem contratou. Sócios e avalistas ficam dentro do cliente; partes contrárias, no processo; equipe, em Gestão.")), el("div", { class: "actions" }, el("button", { class: "btn sm", onclick: (ev) => { ev.stopPropagation(); V.lista = null; carregar(); } }, "↻"), el("span", { class: "note" }, V.aberto ? "▾ recolher" : "▸ expandir")));
    const box = el("div", { class: "card section", style: "margin-bottom:14px" }, head);
    if (!V.aberto) return box;
    box.append(el("div", { class: "kpis", style: "margin:10px 0" }, K("Clientes ativos", String(L.length), `${L.filter((c) => c.tipo_pessoa === "PF").length} PF · ${L.filter((c) => c.tipo_pessoa !== "PF").length} PJ`), K("Novos no mês", String(novos), `mês anterior: ${ant}${ant ? ` (${novos >= ant ? "+" : ""}${Math.round(100 * (novos - ant) / ant)}%)` : ""}`, novos >= ant ? "ok" : "warn"), K("Com processo ativo", String(comProc.length), `${comProc.reduce((a, c) => a + +c.processos_ativos, 0)} processos`), K("Sem processo ativo", String(semProc.length), "só extrajudicial / consultivo"), K("Inadimplentes com bancos", String(L.filter((c) => sitDe(c) === "Inadimplente").length), `${L.filter((c) => sitDe(c) === "Não respondido").length} sem ficha de passagem`, "crit")),
      el("div", { style: "display:flex;gap:14px;flex-wrap:wrap" }, bloco("Com processo ativo", lista(comProc)), bloco("Sem processo ativo", lista(semProc))),
      el("div", { style: "display:flex;gap:14px;flex-wrap:wrap;margin-top:14px" }, bloco("Origem", barras(contar(L, (c) => c.origem)), "de onde vieram"), bloco("Segmento", donut(contar(L, (c) => c.segmento))), bloco("Situação com os bancos", donut(contar(L, sitDe)), "ficha de passagem")),
      el("div", { style: "display:flex;gap:14px;flex-wrap:wrap;margin-top:14px" }, bloco("Etapa do fluxo PJ", barras(contar(L.filter((c) => c.tipo_pessoa !== "PF"), (c) => c.etapa_fluxo == null ? "Sem etapa" : ETAPAS[c.etapa_fluxo] || String(c.etapa_fluxo)), 12)), bloco("Cidade / UF", barras(contar(L, (c) => c.cidade ? `${c.cidade}${c.uf ? "/" + c.uf : ""}` : c.uf), 10)), bloco("Closer", barras(contar(L, (c) => c.closer), 8), "quem fechou")));
    return box;
  }
  { const _rl = window.renderList; if (typeof _rl === "function") window.renderList = function () { _rl.apply(this, arguments); if (S.sel || S.tab !== "clientes") return; if (!(typeof equipe === "function" && equipe())) return; const m = $("#main"); const k = m?.querySelector(".kpis"); if (!k || m.querySelector(".visao-clientes")) return; const c = card(); c.classList.add("visao-clientes"); k.replaceWith(c); }; }
  window.PP_CLIENTES_VISAO = { recarregar: () => { V.lista = null; carregar(); } };
})();
