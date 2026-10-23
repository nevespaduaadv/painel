/* Atendimento (WhatsApp) — gestão de atendimento dentro do sistema, com o ChatGuru por baixo (0079).
   Três colunas no estilo DigiSac/Zendesk: lista de conversas (Minhas / Fila / Todas / Resolvidas, filtros, não lidas, SLA),
   conversa (recebidas, enviadas, notas internas em amarelo, mídia recebida, eventos) e painel do contato (cliente/lead,
   cobranças, tarefas, conversas anteriores). Filas (setores) e respostas rápidas administradas pelos admins.
   Supabase: atd_filas, v_atd_conversas, atd_mensagens, atd_eventos, atd_respostas_rapidas, v_atd_filas_resumo;
   rpcs atd_assumir, atd_transferir, atd_status, atd_lida, atd_vincular, atd_mensagem_out (nota), atd_equipe_fila;
   Edge chatguru/enviar {acao:"atd_enviar"} para responder. Só equipe com a área "atendimento". */
(() => {
  "use strict";
  const T = { ok: false, carregando: false, filas: [], resumo: [], convs: [], rapidas: [], equipe: [], sel: null, msgs: [], eventos: [], contato: null,
    aba: "minhas", fila: "", busca: "", sub: "conversas", urls: {}, pendentes: 0, rascunho: {}, nota: false };
  const admin = () => PP.perfil?.papel === "admin";
  const pode = () => admin() || (PP.perfil?.acessos || []).includes("atendimento");
  const eu = () => PP.perfil?.id;
  const STATUS = { nova: ["Nova", "#2F5C8F"], aguardando: ["Aguardando", "#B8860B"], em_atendimento: ["Em atendimento", "#1B8245"], pendente_contato: ["Pendente do contato", "#6b7280"], resolvida: ["Resolvida", "#8E958F"] };
  const fmtH = (iso) => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const fmtDH = (iso) => iso ? fmtD(iso) + " " + fmtH(iso) : "—";
  const relativo = (iso) => { if (!iso) return ""; const d = new Date(iso), h = new Date(); const dia = d.toDateString() === h.toDateString(); return dia ? fmtH(iso) : fmtD(iso); };
  const fone = (v) => { const d = String(v || "").replace(/\D/g, "").replace(/^55/, ""); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : v || "—"; };
  const ini = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  const fld = (l, c, h) => field("atd-" + Math.random().toString(36).slice(2, 8), l, c, h);
  const BRL = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function edge(body) {
    const { data: { session } } = await SB.auth.getSession(); if (!session) throw new Error("Faça login de novo");
    const r = await fetch(SB_URL + "/functions/v1/chatguru/enviar", { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + session.access_token }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, erro: "Resposta inválida" })); if (!r.ok || j.ok === false) throw new Error(j.erro || ("HTTP " + r.status)); return j;
  }

  // ---------- dados ----------
  async function carregar(silencioso) {
    if (T.carregando) return; T.carregando = true;
    try {
      const resolvidas = T.aba === "resolvidas";
      let q = SB.from("v_atd_conversas").select("*").order("ultima_msg_em", { ascending: false, nullsFirst: false }).limit(400);
      q = resolvidas ? q.eq("status", "resolvida") : q.neq("status", "resolvida");
      const [f, r, c, rr] = await Promise.all([SB.from("atd_filas").select("*").order("ordem"), SB.from("v_atd_filas_resumo").select("*").order("ordem"), q, SB.from("atd_respostas_rapidas").select("*").eq("ativa", true).order("titulo")]);
      if (c.error) throw c.error;
      T.filas = f.data || []; T.resumo = r.data || []; T.convs = c.data || []; T.rapidas = rr.data || []; T.ok = true;
      if (!T.equipe.length) { const e = await SB.rpc("atd_equipe_fila", { p_fila: null }); T.equipe = e.data || []; }
    } catch (e) { if (!silencioso) toast("Não foi possível carregar o atendimento: " + e.message); }
    finally { T.carregando = false; }
    renderAtd();
  }
  const invalidar = () => { T.ok = false; renderAtd(); };
  async function abrir(id, manterScroll) {
    const c = T.convs.find((x) => x.id === id);
    if (!c) { const { data } = await SB.from("v_atd_conversas").select("*").eq("id", id).maybeSingle(); if (!data) { toast("Conversa não encontrada"); return; } T.convs.unshift(data); }
    T.sel = id; T.msgs = []; T.eventos = []; T.contato = null; T.nota = false;
    location.hash = "#atendimento/" + id; renderAtd();
    await recarregarConversa(manterScroll);
    const conv = T.convs.find((x) => x.id === id);
    if (conv?.nao_lidas) { SB.rpc("atd_lida", { p_conv: id }); conv.nao_lidas = 0; }
    carregarContato(conv);
  }
  async function recarregarConversa(manterScroll) {
    if (!T.sel) return; const id = T.sel;
    const [m, e] = await Promise.all([SB.from("atd_mensagens").select("*").eq("conversa_id", id).order("criado_em").limit(500), SB.from("atd_eventos").select("*").eq("conversa_id", id).order("em")]);
    if (T.sel !== id) return;
    T.msgs = m.data || []; T.eventos = e.data || [];
    renderAtd(); if (!manterScroll) rolarFim();
  }
  async function carregarContato(conv) {
    if (!conv) return; const id = conv.id;
    const ct = { cobrancas: [], tarefas: [], anteriores: [] };
    const ps = [];
    if (conv.cliente_id) {
      ps.push(SB.from("v_cobrancas").select("id,valor,vencimento,status,descricao,tipo").eq("cliente_id", conv.cliente_id).in("status", ["pendente", "atrasada"]).order("vencimento").limit(5).then((r) => { ct.cobrancas = r.data || []; }));
      ps.push(SB.from("v_tarefas").select("id,titulo,prazo,situacao,responsavel_nome").eq("cliente_id", conv.cliente_id).not("status", "in", "(concluida,cancelada)").order("prazo").limit(5).then((r) => { ct.tarefas = r.data || []; }));
    }
    if (conv.whatsapp_normalizado) ps.push(SB.from("v_atd_conversas").select("id,protocolo,status,aberta_em,resolvida_em,fila_nome").eq("whatsapp_normalizado", conv.whatsapp_normalizado).neq("id", id).order("aberta_em", { ascending: false }).limit(8).then((r) => { ct.anteriores = r.data || []; }));
    await Promise.all(ps);
    if (T.sel === id) { T.contato = ct; renderAtd(); }
  }
  async function urlArquivo(m) {
    if (!m.arquivo_path) return m.arquivo_url || null;
    if (T.urls[m.id]) return T.urls[m.id];
    const { data } = await SB.storage.from("atendimento").createSignedUrl(m.arquivo_path, 3600);
    if (data?.signedUrl) T.urls[m.id] = data.signedUrl; return T.urls[m.id] || m.arquivo_url || null;
  }
  const rolarFim = () => setTimeout(() => { const b = $("#atd-msgs"); if (b) b.scrollTop = b.scrollHeight; }, 30);

  // ---------- ações ----------
  async function enviar(texto) {
    const conv = T.convs.find((x) => x.id === T.sel); if (!conv || !texto.trim()) return;
    const t = texto.trim();
    if (T.nota) {
      const { error } = await SB.rpc("atd_mensagem_out", { p_conv: conv.id, p_texto: t, p_nota: true });
      if (error) { toast("Não foi possível salvar a nota: " + error.message); return; }
      T.rascunho[conv.id] = ""; await recarregarConversa(); return;
    }
    T.pendentes++; T.rascunho[conv.id] = ""; renderAtd();
    try { await edge({ acao: "atd_enviar", conversa_id: conv.id, texto: t }); }
    catch (e) { toast("Falha no envio: " + e.message); }
    finally { T.pendentes--; await Promise.all([recarregarConversa(), carregar(true)]); }
  }
  async function rpc(nome, args, okMsg) {
    const { error } = await SB.rpc(nome, args);
    if (error) { toast(error.message); return false; }
    if (okMsg) toast(okMsg); await Promise.all([carregar(true), recarregarConversa(true)]); return true;
  }
  function modalTransferir(conv) {
    const fila = sel(Object.fromEntries([["", "— manter a fila —"], ...T.filas.filter((f) => f.ativa).map((f) => [String(f.id), f.nome])]), "");
    const resp = sel({ "": "— ninguém (fica na fila) —" }, "");
    const carregarEquipe = async () => { const { data } = await SB.rpc("atd_equipe_fila", { p_fila: fila.value ? +fila.value : conv.fila_id }); resp.replaceChildren(el("option", { value: "" }, "— ninguém (fica na fila) —"), ...(data || []).map((p) => el("option", { value: p.id }, p.nome))); };
    fila.onchange = carregarEquipe; carregarEquipe();
    modal("Transferir conversa", el("div", { class: "grid2" }, fld("Para a fila", fila), fld("Para a pessoa", resp)), async () => {
      await rpc("atd_transferir", { p_conv: conv.id, p_fila: fila.value ? +fila.value : null, p_responsavel: resp.value || null }, "Conversa transferida");
    });
  }
  function modalVincular(conv) {
    const i = inp("text", ""); i.placeholder = "Nome do cliente ou do lead…";
    const lista = el("div", { class: "atd-vinc" });
    let t;
    i.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const q = i.value.trim(); if (q.length < 2) { lista.replaceChildren(); return; }
      const [c, l] = await Promise.all([SB.from("clientes").select("id,dados").ilike("dados->>nome", `%${q}%`).limit(6), SB.from("leads").select("id,nome,empresa").ilike("nome", `%${q}%`).limit(6)]);
      lista.replaceChildren(
        ...(c.data || []).map((x) => el("button", { class: "btn sm", onclick: async () => { if (await rpc("atd_vincular", { p_conv: conv.id, p_cliente: x.id, p_lead: null }, "Vinculada ao cliente")) $("#modalHost").replaceChildren(); } }, "Cliente · " + (x.dados?.nome || x.id))),
        ...(l.data || []).map((x) => el("button", { class: "btn sm", onclick: async () => { if (await rpc("atd_vincular", { p_conv: conv.id, p_cliente: null, p_lead: x.id }, "Vinculada ao lead")) $("#modalHost").replaceChildren(); } }, "Lead · " + x.nome + (x.empresa ? " (" + x.empresa + ")" : ""))));
    }, 250); };
    modal("Vincular a cliente ou lead", el("div", {}, fld("Buscar", i), lista), async () => {});
  }

  // ---------- render ----------
  function renderAtd() {
    const v = $("#view-atendimento"); if (!v) return;
    v.replaceChildren();
    if (!pode()) { v.append(el("div", { class: "card empty" }, "Você não tem acesso ao Atendimento. Peça a um administrador para liberar a área.")); return; }
    if (!T.ok) { if (!T.carregando) carregar(); v.append(el("div", { class: "note" }, "Carregando…")); return; }
    const sub = (k, l) => el("button", { class: "atd-sub" + (T.sub === k ? " on" : ""), onclick: () => { T.sub = k; renderAtd(); } }, l);
    v.append(el("div", { class: "head atd-head" },
      el("div", {}, el("div", { class: "eyebrow" }, "Atendimento"), el("h1", {}, "Conversas (WhatsApp)"), el("div", { class: "sub" }, "Mesmo número para toda a equipe: filas por setor, responsável, notas internas e SLA. A equipe atende por aqui; o ChatGuru fica como bastidor.")),
      el("div", { class: "tabs atd-subtabs" }, sub("conversas", "Conversas"), sub("painel", "Painel"), admin() ? sub("filas", "Filas e respostas rápidas") : null)));
    if (T.sub === "painel") { v.append(renderPainel()); return; }
    if (T.sub === "filas") { v.append(renderFilas()); return; }
    v.append(el("div", { class: "atd-wrap" }, renderLista(), renderConversa(), renderContato()));
  }

  function filtrar() {
    const q = T.busca.trim().toLowerCase();
    return T.convs.filter((c) => {
      if (T.aba === "minhas" && c.responsavel_id !== eu()) return false;
      if (T.aba === "fila" && c.responsavel_id) return false;
      if (T.fila && String(c.fila_id) !== T.fila) return false;
      if (q && !((c.nome_contato || "").toLowerCase().includes(q) || (c.whatsapp || "").includes(q) || (c.protocolo || "").includes(q) || (c.cliente_nome || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function renderLista() {
    const abas = [["minhas", "Minhas", T.convs.filter((c) => c.status !== "resolvida" && c.responsavel_id === eu()).length], ["fila", "Na fila", T.convs.filter((c) => c.status !== "resolvida" && !c.responsavel_id).length], ["todas", "Todas", T.convs.filter((c) => c.status !== "resolvida").length], ["resolvidas", "Resolvidas", null]];
    const busca = inp("search", T.busca); busca.placeholder = "Nome, telefone, protocolo…"; busca.oninput = () => { T.busca = busca.value; renderAtd(); const b = $("#atd-busca"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }; busca.id = "atd-busca";
    const filaSel = sel(Object.fromEntries([["", "Todas as filas"], ...T.filas.filter((f) => f.ativa).map((f) => [String(f.id), f.nome])]), T.fila); filaSel.onchange = () => { T.fila = filaSel.value; renderAtd(); };
    const lista = filtrar();
    return el("div", { class: "atd-col atd-lista card" },
      el("div", { class: "atd-abas" }, ...abas.map(([k, l, n]) => el("button", { class: "atd-aba" + (T.aba === k ? " on" : ""), onclick: () => { T.aba = k; T.ok = false; carregar(); } }, l, n ? el("em", {}, String(n)) : null))),
      el("div", { class: "atd-filtros" }, busca, filaSel),
      el("div", { class: "atd-itens" }, lista.length ? lista.map((c) => itemLista(c)) : el("div", { class: "note", style: "padding:16px" }, T.aba === "minhas" ? "Nenhuma conversa com você. Veja a aba “Na fila”." : "Nenhuma conversa.")));
  }
  function itemLista(c) {
    const on = c.id === T.sel;
    const sla = c.sla === "vencido" ? el("span", { class: "atd-sla crit", title: "1ª resposta fora do prazo" }, "SLA") : c.sla === "quase" ? el("span", { class: "atd-sla warn", title: "1ª resposta vence em 5 min" }, "SLA") : null;
    return el("div", { class: "atd-item" + (on ? " on" : "") + (c.nao_lidas ? " unread" : ""), onclick: () => abrir(c.id) },
      el("div", { class: "atd-avatar", style: "background:" + (c.fila_cor || "#888") }, ini(c.nome_contato)),
      el("div", { class: "atd-item-body" },
        el("div", { class: "atd-item-top" }, el("strong", {}, c.nome_contato || fone(c.whatsapp)), el("span", { class: "atd-hora" }, relativo(c.ultima_msg_em))),
        el("div", { class: "atd-item-sub" }, el("span", { class: "atd-prev" }, c.ultima_msg_texto || "—"), c.nao_lidas ? el("em", { class: "atd-badge" }, String(c.nao_lidas)) : null),
        el("div", { class: "atd-item-tags" }, el("span", { class: "atd-fila", style: "--c:" + (c.fila_cor || "#888") }, c.fila_nome || "sem fila"), el("span", { class: "atd-st", style: "--c:" + STATUS[c.status][1] }, STATUS[c.status][0]), c.responsavel_nome ? el("span", { class: "atd-resp" }, "· " + c.responsavel_nome.split(" ")[0]) : null, sla)));
  }

  function renderConversa() {
    const conv = T.convs.find((x) => x.id === T.sel);
    if (!conv) return el("div", { class: "atd-col atd-conv card empty-conv" }, el("div", { class: "note" }, "Escolha uma conversa à esquerda.", el("br"), "Mensagens novas aparecem aqui em tempo real."));
    const minha = conv.responsavel_id === eu();
    const st = STATUS[conv.status];
    const statusSel = sel({ aguardando: "Aguardando", em_atendimento: "Em atendimento", pendente_contato: "Pendente do contato" }, conv.status === "nova" ? "aguardando" : conv.status);
    statusSel.className = "atd-status-sel"; statusSel.style.setProperty("--c", st[1]);
    statusSel.onchange = () => rpc("atd_status", { p_conv: conv.id, p_status: statusSel.value });
    const head = el("div", { class: "atd-conv-head" },
      el("div", { class: "atd-avatar lg", style: "background:" + (conv.fila_cor || "#888") }, ini(conv.nome_contato)),
      el("div", { class: "atd-conv-id" },
        el("div", { class: "atd-conv-nome" }, conv.nome_contato || fone(conv.whatsapp), el("span", { class: "atd-proto" }, conv.protocolo)),
        el("div", { class: "note" }, fone(conv.whatsapp), " · ", conv.fila_nome || "sem fila", " · ", conv.responsavel_nome ? "com " + conv.responsavel_nome : "sem responsável")),
      el("div", { class: "atd-conv-acoes" },
        conv.status !== "resolvida" ? statusSel : el("span", { class: "pill" }, "Resolvida"),
        !minha && conv.status !== "resolvida" ? el("button", { class: "btn sm primary", onclick: () => rpc("atd_assumir", { p_conv: conv.id }, "Conversa assumida") }, "Assumir") : null,
        conv.status !== "resolvida" ? el("button", { class: "btn sm", onclick: () => modalTransferir(conv) }, "Transferir") : null,
        conv.status !== "resolvida" ? el("button", { class: "btn sm", onclick: () => { if (confirm("Marcar como resolvida? Se o contato escrever de novo, a conversa reabre sozinha.")) rpc("atd_status", { p_conv: conv.id, p_status: "resolvida" }, "Conversa resolvida"); } }, "Resolver") : el("button", { class: "btn sm", onclick: () => rpc("atd_status", { p_conv: conv.id, p_status: "aguardando" }, "Conversa reaberta") }, "Reabrir"),
        conv.link_chat ? el("a", { class: "btn sm", href: conv.link_chat, target: "_blank", rel: "noopener", title: "Abrir no ChatGuru (mídia enviada, URA, histórico antigo)" }, "ChatGuru ↗") : null));

    // linha do tempo: mensagens + eventos intercalados
    const itens = [...T.msgs.map((m) => ({ t: m.criado_em, m })), ...T.eventos.map((e) => ({ t: e.em, e }))].sort((a, b) => new Date(a.t) - new Date(b.t));
    const corpo = el("div", { class: "atd-msgs", id: "atd-msgs" });
    let diaAnterior = "";
    for (const it of itens) {
      const dia = fmtD(it.t); if (dia !== diaAnterior) { corpo.append(el("div", { class: "atd-dia" }, el("span", {}, dia))); diaAnterior = dia; }
      if (it.e) { corpo.append(el("div", { class: "atd-evento" }, textoEvento(it.e), el("span", { class: "atd-ev-hora" }, fmtH(it.e.em)))); continue; }
      corpo.append(bolha(it.m));
    }
    if (!itens.length) corpo.append(el("div", { class: "note", style: "padding:20px;text-align:center" }, "Sem mensagens registradas ainda."));

    // composer
    const ta = el("textarea", { class: "atd-ta", rows: "2", placeholder: T.nota ? "Nota interna — só a equipe vê. Enter para salvar." : "Escreva a resposta… Enter envia, Shift+Enter quebra linha, / respostas rápidas" });
    ta.value = T.rascunho[conv.id] || "";
    ta.oninput = () => { T.rascunho[conv.id] = ta.value; if (ta.value === "/" ) menuRapidas(ta); };
    ta.onkeydown = (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); enviar(ta.value); } };
    const btnNota = el("button", { class: "btn sm" + (T.nota ? " atd-nota-on" : ""), title: "Nota interna (só a equipe vê)", onclick: () => { T.nota = !T.nota; renderAtd(); $("#view-atendimento textarea")?.focus(); } }, T.nota ? "✎ Nota interna" : "Nota interna");
    const btnRap = el("button", { class: "btn sm", title: "Respostas rápidas", onclick: () => menuRapidas(ta) }, "⚡");
    const btnEnv = el("button", { class: "btn primary", disabled: T.pendentes ? "" : null, onclick: () => enviar(ta.value) }, T.nota ? "Salvar nota" : T.pendentes ? "Enviando…" : "Enviar");
    const composer = el("div", { class: "atd-composer" + (T.nota ? " nota" : "") }, ta, el("div", { class: "atd-composer-bar" }, btnNota, btnRap, el("span", { style: "flex:1" }), conv.status === "resolvida" && !T.nota ? el("span", { class: "note" }, "Responder reabre a conversa. ") : null, btnEnv));
    return el("div", { class: "atd-col atd-conv card" }, head, corpo, composer);
  }
  function bolha(m) {
    if (m.direcao === "nota") return el("div", { class: "atd-b nota" }, el("div", { class: "atd-b-autor" }, "Nota interna · " + (m.autor_nome || "")), el("div", { class: "atd-b-txt" }, m.texto || ""), el("div", { class: "atd-b-meta" }, fmtH(m.criado_em)));
    const out = m.direcao === "out";
    const b = el("div", { class: "atd-b " + (out ? "out" : "in") });
    if (out && m.autor_nome) b.append(el("div", { class: "atd-b-autor" }, m.autor_nome));
    if (m.tipo !== "chat" && m.direcao === "in") b.append(midia(m));
    if (m.texto) b.append(el("div", { class: "atd-b-txt" }, m.texto));
    const meta = el("div", { class: "atd-b-meta" }, fmtH(m.criado_em));
    if (out) meta.append(" ", m.status_envio === "enviada" ? el("span", { title: "Entregue ao ChatGuru" }, "✓✓") : m.status_envio === "erro" ? el("span", { class: "crit", title: m.erro || "erro" }, "✗ falhou") : el("span", { title: "Enviando" }, "⏳"));
    b.append(meta); return b;
  }
  function midia(m) {
    const box = el("div", { class: "atd-midia" }, el("span", { class: "note" }, { image: "📷 Imagem", audio: "🎧 Áudio", video: "🎬 Vídeo", document: "📎 Documento", sticker: "Figurinha", call_log: "📞 Chamada" }[m.tipo] || m.tipo));
    if (m.tipo === "call_log") return box;
    urlArquivo(m).then((u) => {
      if (!u) { box.append(el("div", { class: "note" }, "Arquivo não disponível — abra no ChatGuru.")); return; }
      if (m.tipo === "image" || (m.mime || "").startsWith("image/")) box.append(el("a", { href: u, target: "_blank", rel: "noopener" }, el("img", { src: u, class: "atd-img", alt: m.arquivo_nome || "imagem" })));
      else if (m.tipo === "audio" || (m.mime || "").startsWith("audio/")) box.append(el("audio", { controls: "", src: u, preload: "none" }));
      else if (m.tipo === "video" || (m.mime || "").startsWith("video/")) box.append(el("video", { controls: "", src: u, class: "atd-img", preload: "metadata" }));
      else box.append(el("a", { class: "btn sm", href: u, target: "_blank", rel: "noopener" }, "Abrir " + (m.arquivo_nome || "arquivo")));
    });
    return box;
  }
  const textoEvento = (e) => ({ aberta: `Conversa aberta na fila ${e.para || ""}`, assumida: `${e.para || "Alguém"} assumiu a conversa`, transferida: `Transferida de ${e.de || "fila"} para ${e.para || "fila"}${e.por_nome ? " por " + e.por_nome : ""}`, fila: `Movida da fila ${e.de || "—"} para ${e.para || "—"}${e.por_nome ? " por " + e.por_nome : ""}`, resolvida: `Resolvida${e.por_nome ? " por " + e.por_nome : ""}`, reaberta: "Reaberta: o contato escreveu de novo", vinculada: `Vinculada a ${e.para || "—"}`, status: `Status: ${STATUS[e.para]?.[0] || e.para}${e.por_nome ? " · " + e.por_nome : ""}` }[e.tipo] || e.tipo);
  function menuRapidas(ta) {
    const conv = T.convs.find((x) => x.id === T.sel);
    const lista = T.rapidas.filter((r) => !r.fila_id || r.fila_id === conv?.fila_id);
    if (!lista.length) { toast(admin() ? "Cadastre respostas rápidas em Filas e respostas rápidas." : "Nenhuma resposta rápida cadastrada."); return; }
    const vars = { primeiro_nome: (conv?.nome_contato || "").split(" ")[0], nome: conv?.nome_contato || "", proprietario: (PP.perfil?.nome || "").split(" ")[0], protocolo: conv?.protocolo || "" };
    const render = (t) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "{" + k + "}");
    modal("Respostas rápidas", el("div", { class: "atd-rapidas" }, ...lista.map((r) => el("button", { class: "atd-rapida", onclick: () => { ta.value = (ta.value === "/" ? "" : ta.value) + render(r.texto); T.rascunho[conv.id] = ta.value; $("#modalHost").replaceChildren(); ta.focus(); } }, el("strong", {}, r.titulo, " ", el("code", {}, r.atalho)), el("div", { class: "note" }, r.texto.slice(0, 140))))), async () => {});
  }

  function renderContato() {
    const conv = T.convs.find((x) => x.id === T.sel);
    if (!conv) return el("div", { class: "atd-col atd-contato card" }, el("div", { class: "note" }, "Dados do contato aparecem aqui."));
    const ct = T.contato;
    const linha = (l, v) => el("div", { class: "atd-kv" }, el("span", {}, l), el("strong", {}, v || "—"));
    const vinc = conv.cliente_id ? el("a", { href: "#clientes/" + encodeURIComponent(conv.cliente_id), class: "btn sm" }, "Cliente: " + (conv.cliente_nome || conv.cliente_id))
      : conv.lead_id ? el("a", { href: "#leads/" + conv.lead_id, class: "btn sm" }, "Lead: " + (conv.lead_nome || "abrir")) : el("span", { class: "note" }, "Sem vínculo");
    return el("div", { class: "atd-col atd-contato card" },
      el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Contato"), linha("Nome", conv.nome_contato), linha("WhatsApp", fone(conv.whatsapp)), linha("Protocolo", conv.protocolo), linha("Aberta em", fmtDH(conv.aberta_em)), linha("1ª resposta", conv.primeira_resposta_em ? fmtDH(conv.primeira_resposta_em) : (conv.sla === "vencido" ? "fora do prazo" : "até " + fmtDH(conv.sla_resposta_ate))), conv.responsavel_chatguru ? linha("No ChatGuru", conv.responsavel_chatguru) : null),
      el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Vínculo"), el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" }, vinc, el("button", { class: "btn sm", onclick: () => modalVincular(conv) }, conv.cliente_id || conv.lead_id ? "Alterar" : "Vincular…"))),
      conv.tags?.length ? el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Tags (ChatGuru)"), el("div", { style: "display:flex;gap:4px;flex-wrap:wrap" }, ...conv.tags.map((t) => el("span", { class: "pill" }, t)))) : null,
      conv.cliente_id ? el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Cobranças em aberto"), !ct ? el("div", { class: "note" }, "…") : ct.cobrancas.length ? ct.cobrancas.map((c) => el("div", { class: "atd-kv" }, el("span", {}, fmtD(c.vencimento) + " · " + (c.descricao || c.tipo || "")), el("strong", { class: c.status === "atrasada" ? "crit" : "" }, BRL(c.valor)))) : el("div", { class: "note" }, "Nenhuma.")) : null,
      conv.cliente_id ? el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Tarefas abertas"), !ct ? el("div", { class: "note" }, "…") : ct.tarefas.length ? ct.tarefas.map((t) => el("div", { class: "atd-kv" }, el("span", {}, t.titulo), el("strong", { class: t.situacao === "atrasada" ? "crit" : "" }, t.prazo ? fmtD(t.prazo) : "—"))) : el("div", { class: "note" }, "Nenhuma.")) : null,
      el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Conversas anteriores"), !ct ? el("div", { class: "note" }, "…") : ct.anteriores.length ? ct.anteriores.map((a) => el("a", { href: "#atendimento/" + a.id, class: "atd-kv link", onclick: (ev) => { ev.preventDefault(); abrir(a.id); } }, el("span", {}, a.protocolo + " · " + (a.fila_nome || "")), el("strong", {}, STATUS[a.status][0]))) : el("div", { class: "note" }, "Primeira conversa.")),
      Object.keys(conv.campos || {}).length ? el("div", { class: "atd-sec" }, el("div", { class: "eyebrow" }, "Campos do ChatGuru"), ...Object.entries(conv.campos).filter(([, v]) => v).map(([k, v]) => linha(k, String(v)))) : null);
  }

  function renderPainel() {
    const tot = (k) => T.resumo.reduce((s, f) => s + Number(f[k] || 0), 0);
    return el("div", {},
      el("div", { class: "kpis" }, kpi("Abertas", String(tot("abertas")), "em todas as filas"), kpi("Sem responsável", String(tot("sem_responsavel")), "aguardando alguém assumir"), kpi("SLA vencido", String(tot("sla_vencido")), "1ª resposta fora do prazo"), kpi("Resolvidas hoje", String(tot("resolvidas_hoje")), "")),
      el("div", { class: "card section" }, el("h2", {}, "Por fila"), el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Fila", "Abertas", "Sem responsável", "SLA vencido", "Não lidas", "Resolvidas hoje", "1ª resposta (média 30d)", "Resolução (média 30d)"].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...T.resumo.map((f) => el("tr", {}, el("td", {}, el("span", { class: "atd-fila", style: "--c:" + f.cor }, f.nome)), el("td", {}, String(f.abertas)), el("td", {}, String(f.sem_responsavel)), el("td", { class: f.sla_vencido > 0 ? "crit" : "" }, String(f.sla_vencido)), el("td", {}, String(f.nao_lidas)), el("td", {}, String(f.resolvidas_hoje)), el("td", {}, f.media_primeira_resposta_min != null ? f.media_primeira_resposta_min + " min" : "—"), el("td", {}, f.media_resolucao_h != null ? f.media_resolucao_h + " h" : "—"))))))),
      el("div", { class: "card section" }, el("h2", {}, "Por pessoa (abertas)"), el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Responsável"), el("th", {}, "Abertas"), el("th", {}, "Não lidas"))),
        el("tbody", {}, ...Object.entries(T.convs.filter((c) => c.status !== "resolvida").reduce((a, c) => { const k = c.responsavel_nome || "(fila)"; a[k] = a[k] || [0, 0]; a[k][0]++; a[k][1] += c.nao_lidas || 0; return a; }, {})).sort((a, b) => b[1][0] - a[1][0]).map(([n, [a, u]]) => el("tr", {}, el("td", {}, n), el("td", {}, String(a)), el("td", {}, String(u)))))))));
  }

  // ---------- filas e respostas rápidas (admin) ----------
  function renderFilas() {
    const wrap = el("div", {});
    const formFila = (f) => {
      const nome = inp("text", f.nome || ""), slug = inp("text", f.slug || ""), cor = inp("color", f.cor || "#B8964A"), ordem = inp("number", f.ordem ?? 0);
      const sla1 = inp("number", f.sla_primeira_resposta_min ?? 15), sla2 = inp("number", f.sla_resolucao_horas ?? 24);
      const areas = Object.fromEntries(["comercial", "financeiro", "juridico", "clientes", "marketing", "equipe"].map((a) => [a, el("input", { type: "checkbox", checked: (f.areas || []).includes(a) ? "" : null })]));
      const membros = Object.fromEntries(T.equipe.map((p) => [p.id, el("input", { type: "checkbox", checked: (f.membros || []).includes(p.id) ? "" : null })]));
      const ativa = el("input", { type: "checkbox", checked: f.ativa !== false ? "" : null });
      const boas = el("textarea", { rows: "2" }); boas.value = f.mensagem_boas_vindas || "";
      modal(f.id ? "Editar fila" : "Nova fila", el("div", {},
        el("div", { class: "grid2" }, fld("Nome", nome), fld("Identificador (slug)", slug), fld("Cor", cor), fld("Ordem", ordem), fld("SLA 1ª resposta (min, horário comercial)", sla1), fld("SLA resolução (horas)", sla2)),
        fld("Quem vê pela área de acesso", el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, ...Object.entries(areas).map(([a, c]) => el("label", { class: "switch" }, c, " " + a)))),
        fld("Membros (inclusão manual)", el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;max-height:160px;overflow:auto" }, ...T.equipe.map((p) => el("label", { class: "switch" }, membros[p.id], " " + p.nome)))),
        fld("Mensagem de boas-vindas (opcional, uso futuro)", boas), el("label", { class: "switch" }, ativa, " Fila ativa")), async () => {
        const reg = { nome: nome.value.trim(), slug: (slug.value.trim() || nome.value.trim()).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), cor: cor.value, ordem: +ordem.value || 0, sla_primeira_resposta_min: +sla1.value || 15, sla_resolucao_horas: +sla2.value || 24, areas: Object.keys(areas).filter((a) => areas[a].checked), membros: Object.keys(membros).filter((id) => membros[id].checked), mensagem_boas_vindas: boas.value.trim() || null, ativa: ativa.checked, updated_at: new Date().toISOString() };
        if (!reg.nome) throw new Error("Dê um nome à fila");
        const r = f.id ? await SB.from("atd_filas").update(reg).eq("id", f.id) : await SB.from("atd_filas").insert(reg);
        if (r.error) throw r.error; toast("Fila salva"); T.ok = false; carregar();
      });
    };
    wrap.append(el("div", { class: "card section" }, el("div", { class: "actions", style: "justify-content:space-between;align-items:center" }, el("h2", {}, "Filas (setores)"), el("button", { class: "btn primary", onclick: () => formFila({}) }, "+ Nova fila")),
      el("div", { class: "note" }, "Toda conversa nova entra na fila Comercial e é transferida manualmente. Administradores veem todas as filas; os demais veem as filas em que forem incluídos como membros ou cuja área de acesso tenham."),
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Fila", "Áreas", "Membros", "SLA 1ª resp.", "SLA resolução", "Ativa", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, ...T.filas.map((f) => el("tr", {}, el("td", {}, el("span", { class: "atd-fila", style: "--c:" + f.cor }, f.nome), el("div", { class: "note" }, f.slug)), el("td", {}, (f.areas || []).join(", ") || "—"), el("td", {}, (f.membros || []).map((id) => T.equipe.find((p) => p.id === id)?.nome?.split(" ")[0] || "?").join(", ") || "—"), el("td", {}, f.sla_primeira_resposta_min + " min"), el("td", {}, f.sla_resolucao_horas + " h"), el("td", {}, f.ativa ? "Sim" : "Não"), el("td", {}, el("button", { class: "btn sm", onclick: () => formFila(f) }, "Editar")))))))));
    const formRapida = (r) => {
      const titulo = inp("text", r.titulo || ""), atalho = inp("text", r.atalho || ""), texto = el("textarea", { rows: "4" }); texto.value = r.texto || "";
      const fila = sel(Object.fromEntries([["", "Todas as filas"], ...T.filas.map((f) => [String(f.id), f.nome])]), r.fila_id ? String(r.fila_id) : "");
      modal(r.id ? "Editar resposta rápida" : "Nova resposta rápida", el("div", {}, el("div", { class: "grid2" }, fld("Título", titulo), fld("Atalho (ex.: /boleto)", atalho)), fld("Fila", fila), fld("Texto — variáveis: {primeiro_nome} {nome} {proprietario} {protocolo}", texto)), async () => {
        const reg = { titulo: titulo.value.trim(), atalho: atalho.value.trim() || "/" + titulo.value.trim().toLowerCase().replace(/\s+/g, "-"), texto: texto.value.trim(), fila_id: fila.value ? +fila.value : null, ativa: true };
        if (!reg.titulo || !reg.texto) throw new Error("Título e texto são obrigatórios");
        const q = r.id ? await SB.from("atd_respostas_rapidas").update(reg).eq("id", r.id) : await SB.from("atd_respostas_rapidas").insert(reg);
        if (q.error) throw q.error; toast("Resposta salva"); T.ok = false; carregar();
      }, r.id ? el("button", { class: "btn danger", onclick: async () => { if (!confirm("Excluir esta resposta rápida?")) return; await SB.from("atd_respostas_rapidas").delete().eq("id", r.id); $("#modalHost").replaceChildren(); T.ok = false; carregar(); } }, "Excluir") : null);
    };
    wrap.append(el("div", { class: "card section" }, el("div", { class: "actions", style: "justify-content:space-between;align-items:center" }, el("h2", {}, "Respostas rápidas"), el("button", { class: "btn primary", onclick: () => formRapida({}) }, "+ Nova resposta")),
      el("div", { class: "tbl" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Título", "Atalho", "Fila", "Texto", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, T.rapidas.length ? T.rapidas.map((r) => el("tr", {}, el("td", {}, r.titulo), el("td", {}, el("code", {}, r.atalho)), el("td", {}, T.filas.find((f) => f.id === r.fila_id)?.nome || "Todas"), el("td", {}, r.texto.slice(0, 90)), el("td", {}, el("button", { class: "btn sm", onclick: () => formRapida(r) }, "Editar")))) : el("tr", {}, el("td", { colspan: "5", class: "note" }, "Nenhuma resposta rápida ainda.")))))));
    return wrap;
  }

  // ---------- estilo, rota e registro ----------
  document.head.append(el("style", {}, `
.atd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.atd-subtabs{display:flex;gap:6px}
.atd-sub{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);cursor:pointer;color:var(--fg)}
.atd-sub.on{background:var(--navy);color:#fff;border-color:var(--navy)}
.atd-wrap{display:grid;grid-template-columns:340px minmax(0,1fr) 300px;gap:12px;align-items:stretch;height:calc(100vh - 190px);min-height:520px}
.atd-col{padding:0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.atd-abas{display:flex;border-bottom:1px solid var(--line)}
.atd-aba{flex:1;padding:10px 4px;border:0;background:none;color:var(--muted);font-weight:600;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;display:flex;gap:4px;justify-content:center;align-items:center}
.atd-aba.on{color:var(--fg);border-bottom-color:var(--gold)}
.atd-aba em{font-style:normal;background:var(--surface-2);border-radius:999px;padding:0 6px;font-size:11px}
.atd-filtros{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--line)}
.atd-filtros input{flex:1;min-width:0}
.atd-itens{overflow:auto;flex:1}
.atd-item{display:flex;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer}
.atd-item:hover{background:var(--surface-2)}
.atd-item.on{background:var(--gold-soft)}
.atd-item.unread strong{font-weight:800}
.atd-avatar{width:36px;height:36px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none}
.atd-avatar.lg{width:42px;height:42px}
.atd-item-body{flex:1;min-width:0}
.atd-item-top{display:flex;justify-content:space-between;gap:6px}
.atd-item-top strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atd-hora{color:var(--faint);font-size:11px;flex:none}
.atd-item-sub{display:flex;justify-content:space-between;gap:6px;align-items:center}
.atd-prev{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atd-badge{font-style:normal;background:var(--ok);color:#fff;border-radius:999px;padding:0 6px;font-size:11px;font-weight:700;flex:none}
.atd-item-tags{display:flex;gap:6px;align-items:center;margin-top:4px;font-size:11px;color:var(--muted);flex-wrap:wrap}
.atd-fila{display:inline-flex;align-items:center;gap:5px;font-weight:600}
.atd-fila::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c)}
.atd-st{color:var(--c);font-weight:600}
.atd-sla{font-size:10px;font-weight:800;padding:0 5px;border-radius:4px;color:#fff}
.atd-sla.crit{background:var(--crit)} .atd-sla.warn{background:var(--warn)}
.atd-conv{background:var(--surface)}
.empty-conv{align-items:center;justify-content:center;text-align:center}
.atd-conv-head{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.atd-conv-id{flex:1;min-width:160px}
.atd-conv-nome{font-weight:700;display:flex;gap:8px;align-items:baseline}
.atd-proto{font-size:11px;color:var(--faint);font-weight:500}
.atd-conv-acoes{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.atd-status-sel{border-radius:999px;padding:4px 10px;border:1px solid var(--c);color:var(--c);font-weight:600;background:var(--surface);font-size:12px}
.atd-msgs{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:6px;background:var(--surface-2)}
.atd-dia{text-align:center;margin:8px 0 4px} .atd-dia span{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--muted)}
.atd-evento{text-align:center;font-size:11px;color:var(--muted);margin:2px 0} .atd-ev-hora{margin-left:6px;color:var(--faint)}
.atd-b{max-width:72%;padding:8px 11px;border-radius:12px;background:var(--surface);box-shadow:0 1px 1px rgba(0,0,0,.06);font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
.atd-b.in{align-self:flex-start;border-bottom-left-radius:4px}
.atd-b.out{align-self:flex-end;background:#DDF3E3;border-bottom-right-radius:4px}
:root[data-theme="dark"] .atd-b.out{background:#1F4A33}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .atd-b.out{background:#1F4A33}}
.atd-b.nota{align-self:center;max-width:85%;background:#FFF6CC;border:1px dashed #D9B04A;color:#4a3f10}
:root[data-theme="dark"] .atd-b.nota{background:#4a3f10;color:#FFF0B3;border-color:#B8964A}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .atd-b.nota{background:#4a3f10;color:#FFF0B3;border-color:#B8964A}}
.atd-b-autor{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:2px}
.atd-b-meta{font-size:10px;color:var(--faint);text-align:right;margin-top:3px}
.atd-img{max-width:280px;max-height:280px;border-radius:8px;display:block}
.atd-midia{display:flex;flex-direction:column;gap:4px;margin-bottom:4px}
.atd-composer{border-top:1px solid var(--line);padding:8px 10px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}
.atd-composer.nota{background:#FFF6CC} :root[data-theme="dark"] .atd-composer.nota{background:#3a3210}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .atd-composer.nota{background:#3a3210}}
.atd-ta{width:100%;resize:vertical;min-height:44px;font:inherit;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--fg)}
.atd-composer-bar{display:flex;gap:6px;align-items:center}
.atd-nota-on{background:#D9B04A;color:#222;border-color:#D9B04A}
.atd-contato{overflow:auto;padding:0}
.atd-sec{padding:10px 12px;border-bottom:1px solid var(--line)}
.atd-kv{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0} .atd-kv span{color:var(--muted)} .atd-kv strong{text-align:right}
.atd-kv.link{text-decoration:none;color:inherit} .atd-kv.link:hover{text-decoration:underline}
.atd-rapidas{display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow:auto}
.atd-rapida{text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 10px;cursor:pointer;color:var(--fg)} .atd-rapida:hover{background:var(--surface-2)}
.atd-vinc{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.crit{color:var(--crit)}
@media (max-width:1100px){.atd-wrap{grid-template-columns:300px minmax(0,1fr)} .atd-contato{display:none}}
@media (max-width:760px){.atd-wrap{grid-template-columns:1fr;height:auto} .atd-lista{max-height:40vh} .atd-conv{height:70vh}}
`));

  { const _r = render; render = function () { _r(); const va = $("#view-atendimento"); if (!va) return; if (S.tab === "atendimento" && !pode()) S.tab = "painel"; va.hidden = S.tab !== "atendimento"; if (S.tab === "atendimento") { const m = /^#atendimento\/([0-9a-f-]{36})/.exec(location.hash); if (m && m[1] !== T.sel && T.ok) abrir(m[1]); else renderAtd(); } }; }
  window.PP_ATENDIMENTO = { invalidar, abrir: (id) => { S.tab = "atendimento"; location.hash = "#atendimento" + (id ? "/" + id : ""); render(); if (id && T.ok) abrir(id); } };
  window.__PP_LOGIN?.then(() => {
    if (!pode()) return;
    const ch = SB.channel("atendimento"); let t;
    ch.on("postgres_changes", { event: "*", schema: "public", table: "atd_conversas" }, () => { clearTimeout(t); t = setTimeout(() => { if (S.tab === "atendimento") carregar(true); else T.ok = false; }, 400); });
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "atd_mensagens" }, (p) => { if (p.new?.conversa_id === T.sel) { recarregarConversa(); if (p.new.direcao === "in" && document.visibilityState === "visible") SB.rpc("atd_lida", { p_conv: T.sel }); } });
    ch.subscribe();
  });
})();
