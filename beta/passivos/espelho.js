/* Espelho (beta) — Gestão → Espelho (só administradores): copia uma amostra dos dados reais para o projeto Supabase beta,
   direto do navegador (leitura aqui com o login de admin; gravação no beta com o login de admin de lá). Nada passa por
   servidores intermediários. No beta, as linhas entram pela rpc espelho_importar (sem gatilhos, sem duplicar).
   Arquivos (anexos, fotos) não são copiados. Ver docs/beta e supabase/migrations/beta/0001_espelho_importar.sql. */
(() => {
  "use strict";
  const BETA_URL = "https://ooynicwexxqqccihjiah.supabase.co", BETA_KEY = "sb_publishable_dn6ljhAAaV3TxnAyXQB5TA_0DdvGl-W";
  const E = { beta: null, betaUser: null, clientes: [], sel: new Set(), leadsN: 150, publicacoesN: 300, incluirComercial: true, incluirFinanceiro: true, incluirAtendimento: false, log: [], rodando: false, feito: null };
  const admin = () => PP.perfil?.papel === "admin";
  const esc = (s) => String(s ?? "");

  async function conectar(email, senha) {
    if (!E.beta) E.beta = window.supabase.createClient(BETA_URL, BETA_KEY, { auth: { persistSession: false, storageKey: "pp-beta" } });
    const { data, error } = await E.beta.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error("Beta: " + error.message);
    const { data: p } = await E.beta.from("perfis").select("papel,nome").eq("id", data.user.id).maybeSingle();
    if (p?.papel !== "admin") throw new Error("No beta, este usuário não é administrador.");
    E.betaUser = { email, nome: p.nome }; return true;
  }

  // ---------- leitura (produção) ----------
  async function todos(q) { // pagina em blocos de 1000
    const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await q.range(i, i + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; } return out;
  }
  const lotes = (arr, n = 150) => { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };
  async function porIds(tabela, coluna, ids, extra) {
    const out = []; for (const l of lotes([...new Set(ids.filter(Boolean))])) { let q = SB.from(tabela).select("*").in(coluna, l); if (extra) q = extra(q); out.push(...(await todos(q))); } return out;
  }
  const log = (m) => { E.log.push(m); renderLog(); };

  // ---------- gravação (beta) ----------
  async function gravar(tabela, linhas, omitir) {
    if (!linhas.length) { log(`· ${tabela}: nada a copiar`); return 0; }
    let n = 0;
    for (const l of lotes(linhas, 200)) {
      const { data, error } = await E.beta.rpc("espelho_importar", { p_tabela: tabela, p_linhas: l, p_omitir: omitir || [] });
      if (error) throw new Error(`${tabela}: ${error.message}`);
      n += data || 0;
    }
    log(`✓ ${tabela}: ${n} de ${linhas.length} linha(s) gravadas (o resto já existia)`); return n;
  }
  async function atualizar(tabela, coluna, pares) {
    for (const l of lotes(pares, 300)) { const { error } = await E.beta.rpc("espelho_atualizar", { p_tabela: tabela, p_coluna: coluna, p_linhas: l }); if (error) throw new Error(`${tabela}.${coluna}: ${error.message}`); }
  }

  // ---------- a cópia ----------
  async function copiar() {
    if (E.rodando) return; E.rodando = true; E.log = []; E.feito = null; renderEsp();
    const t0 = Date.now();
    try {
      const cliIds = [...E.sel];
      log(`Amostra: ${cliIds.length} cliente(s), ${E.leadsN} leads recentes, ${E.publicacoesN} publicações recentes.`);
      // equipe
      const perfis = await todos(SB.from("perfis").select("*").in("papel", ["admin", "colaborador", "robo"]));
      await gravar("perfis", perfis);
      const colabs = await todos(SB.from("colaboradores").select("*"));
      await gravar("colaboradores", colabs);
      // clientes e dependentes
      const clientes = await porIds("clientes", "id", cliIds);
      await gravar("clientes", clientes, ["lead_id"]);
      for (const t of ["contatos", "bens", "documentos", "notas_internas", "onboarding_respostas", "acessos_token", "asaas_clientes", "asaas_contatos", "planos_superendividamento"]) {
        try { await gravar(t, await porIds(t, "cliente_id", cliIds)); } catch (e) { log("! " + e.message); }
      }
      const contratos = await porIds("contratos", "cliente_id", cliIds); await gravar("contratos", contratos);
      const acordos = await porIds("acordos", "cliente_id", cliIds); await gravar("acordos", acordos);
      const processos = await porIds("processos", "cliente_id", cliIds); await gravar("processos", processos);
      const procIds = processos.map((p) => p.id);
      await gravar("andamentos", await porIds("andamentos", "processo_id", procIds));
      const tarefas = await porIds("tarefas", "cliente_id", cliIds); await gravar("tarefas", tarefas);
      await gravar("entradas_timeline", await porIds("entradas_timeline", "cliente_id", cliIds));
      await gravar("apontamentos_horas", await porIds("apontamentos_horas", "cliente_id", cliIds));
      await gravar("tarefa_eventos", await porIds("tarefa_eventos", "tarefa_id", tarefas.map((t) => t.id)));
      await gravar("negociacoes", await porIds("negociacoes", "cliente_id", cliIds));
      await gravar("monitoramentos", await porIds("monitoramentos", "cliente_id", cliIds));
      await gravar("revisoes", await porIds("revisoes", "cliente_id", cliIds));
      await gravar("maturacao_alertas", await porIds("maturacao_alertas", "cliente_id", cliIds));
      await gravar("agenda_eventos", await porIds("agenda_eventos", "cliente_id", cliIds));
      if (E.incluirFinanceiro) {
        const cobrancas = await porIds("cobrancas", "cliente_id", cliIds); await gravar("cobrancas", cobrancas);
        await gravar("cobranca_contatos", await porIds("cobranca_contatos", "cobranca_id", cobrancas.map((c) => c.id)));
        await gravar("cobranca_checks", await porIds("cobranca_checks", "cobranca_id", cobrancas.map((c) => c.id)));
      }
      // leads: os dos clientes escolhidos + os N mais recentes
      let leads = [];
      if (E.incluirComercial) {
        const dosClientes = await porIds("leads", "cliente_id", cliIds);
        const recentes = E.leadsN > 0 ? (await SB.from("leads").select("*").order("created_at", { ascending: false }).limit(E.leadsN)).data || [] : [];
        const m = new Map(); [...dosClientes, ...recentes].forEach((l) => m.set(l.id, l)); leads = [...m.values()];
        await gravar("tags", await todos(SB.from("tags").select("*")));
        await gravar("leads", leads, ["cliente_id"]);
        const leadIds = leads.map((l) => l.id);
        for (const t of ["lead_tags", "observacoes", "historico_fases", "lead_tarefas"]) { try { await gravar(t, await porIds(t, "lead_id", leadIds)); } catch (e) { log("! " + e.message); } }
        await gravar("fechamentos", await porIds("fechamentos", "cliente_id", cliIds));
        await gravar("fluxos_mensagens", await todos(SB.from("fluxos_mensagens").select("*")));
        await gravar("cadencias", await todos(SB.from("cadencias").select("*")));
        await gravar("cadencia_passos", await todos(SB.from("cadencia_passos").select("*")));
      }
      if (E.incluirAtendimento) {
        const convs = await todos(SB.from("atd_conversas").select("*").order("ultima_msg_em", { ascending: false }).limit(200));
        await gravar("atd_filas", await todos(SB.from("atd_filas").select("*")));
        await gravar("atd_conversas", convs);
        await gravar("atd_mensagens", await porIds("atd_mensagens", "conversa_id", convs.map((c) => c.id)));
        await gravar("atd_eventos", await porIds("atd_eventos", "conversa_id", convs.map((c) => c.id)));
      }
      if (E.publicacoesN > 0) {
        const pubs = (await SB.from("publicacoes").select("*").order("created_at", { ascending: false }).limit(E.publicacoesN)).data || [];
        const pset = new Set(procIds);
        await gravar("publicacoes", pubs.filter((p) => p.processo_id && pset.has(p.processo_id)));
        await gravar("publicacoes", pubs.filter((p) => !(p.processo_id && pset.has(p.processo_id))), ["processo_id"]); // processo não copiado → sem vínculo
      }
      for (const t of ["feriados", "suspensoes_prazo", "conteudos", "avisos", "regua_etapas"]) { try { await gravar(t, await todos(SB.from(t).select("*"))); } catch (e) { log("! " + e.message); } }
      // vínculos circulares
      await atualizar("clientes", "lead_id", clientes.filter((c) => c.lead_id).map((c) => ({ id: c.id, v: c.lead_id })));
      await atualizar("leads", "cliente_id", leads.filter((l) => l.cliente_id && cliIds.includes(l.cliente_id)).map((l) => ({ id: l.id, v: l.cliente_id })));
      const { data: seqs } = await E.beta.rpc("espelho_ajustar_sequencias");
      log(`Sequências realinhadas (${seqs || 0}). Concluído em ${Math.round((Date.now() - t0) / 1000)} s.`);
      E.feito = true;
    } catch (e) { log("✗ Parou: " + e.message); E.feito = false; }
    finally { E.rodando = false; renderEsp(); }
  }
  async function limpar() {
    if (!confirm("Apagar TODOS os dados copiados no beta (clientes, leads, processos, tarefas…)? Os cadastros base e os logins do beta ficam.")) return;
    const { data, error } = await E.beta.rpc("espelho_limpar"); if (error) { toast(error.message); return; } toast("Beta limpo (" + data + ")"); E.log = []; renderEsp();
  }

  // ---------- tela ----------
  function renderLog() { const b = $("#esp-log"); if (b) { b.textContent = E.log.join("\n"); b.scrollTop = b.scrollHeight; } }
  async function carregarClientes() { const { data } = await SB.from("clientes").select("id,dados,ativo,status,created_at").order("created_at", { ascending: false }); E.clientes = (data || []).map((c) => ({ id: c.id, nome: c.dados?.nome || c.id, ativo: c.ativo, status: c.status })); renderEsp(); }
  function renderEsp() {
    const v = $("#view-espelho"); if (!v) return; v.replaceChildren();
    if (!admin()) { v.append(el("div", { class: "card empty" }, "Só administradores.")); return; }
    v.append(el("div", { class: "head" }, el("div", {}, el("div", { class: "eyebrow" }, "Gestão"), el("h1", {}, "Espelho (beta)"), el("div", { class: "sub" }, "Copia uma amostra dos dados reais para o ambiente de teste em nevespaduaadv.github.io/painel/beta/. A cópia é feita do seu navegador para o banco beta; nada é alterado aqui."))));
    // 1. conexão
    if (!E.betaUser) {
      const em = inp("email", PP.perfil?.email || ""), sn = inp("password", ""); sn.autocomplete = "current-password";
      v.append(el("div", { class: "card section" }, el("h2", {}, "1. Entrar no beta"), el("div", { class: "note" }, "Use o login de administrador criado no projeto beta (não é a senha deste sistema)."),
        el("div", { class: "grid2" }, field("esp-em", "E-mail (beta)", em), field("esp-sn", "Senha (beta)", sn)),
        el("div", { class: "actions" }, el("button", { class: "btn primary", onclick: async () => { try { await conectar(em.value.trim(), sn.value); toast("Conectado ao beta"); carregarClientes(); } catch (e) { toast(e.message); } } }, "Conectar"))));
      return;
    }
    if (!E.clientes.length) { carregarClientes(); v.append(el("div", { class: "note" }, "Carregando clientes…")); return; }
    // 2. amostra
    const busca = inp("search", ""); busca.placeholder = "Filtrar clientes…";
    const lista = el("div", { class: "esp-lista" });
    const desenhar = () => { const q = busca.value.trim().toLowerCase(); lista.replaceChildren(...E.clientes.filter((c) => !q || c.nome.toLowerCase().includes(q)).map((c) => el("label", { class: "esp-item" + (E.sel.has(c.id) ? " on" : "") }, el("input", { type: "checkbox", checked: E.sel.has(c.id) ? "" : null, onchange: (ev) => { ev.target.checked ? E.sel.add(c.id) : E.sel.delete(c.id); renderEsp(); } }), " ", c.nome, el("span", { class: "note" }, " · " + (c.ativo ? "ativo" : "inativo"))))); };
    busca.oninput = desenhar; desenhar();
    const n = (k, v2) => { const i = inp("number", E[k]); i.style.width = "90px"; i.onchange = () => { E[k] = +i.value || 0; }; return i; };
    const chk = (k, l) => el("label", { class: "switch" }, el("input", { type: "checkbox", checked: E[k] ? "" : null, onchange: (ev) => { E[k] = ev.target.checked; } }), " " + l);
    v.append(el("div", { class: "card section" }, el("h2", {}, "2. Escolher a amostra"), el("div", { class: "note" }, `Conectado ao beta como ${E.betaUser.email}. Marque os clientes (recomendado: 20–30). Vão junto contratos, processos, andamentos, timeline, tarefas, negociações, cobranças, leads vinculados e a equipe (nomes). Arquivos não são copiados.`),
      el("div", { class: "actions", style: "justify-content:flex-start;gap:8px;flex-wrap:wrap;margin:8px 0" }, busca, el("button", { class: "btn sm", onclick: () => { E.clientes.filter((c) => c.ativo).slice(0, 30).forEach((c) => E.sel.add(c.id)); renderEsp(); } }, "Marcar 30 ativos mais recentes"), el("button", { class: "btn sm", onclick: () => { E.clientes.forEach((c) => E.sel.add(c.id)); renderEsp(); } }, "Todos"), el("button", { class: "btn sm", onclick: () => { E.sel.clear(); renderEsp(); } }, "Nenhum"), el("span", { class: "note" }, `${E.sel.size} selecionado(s)`)),
      lista,
      el("div", { style: "display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:10px" }, el("span", {}, "Leads mais recentes: ", n("leadsN")), el("span", {}, "Publicações mais recentes: ", n("publicacoesN")), chk("incluirComercial", "Comercial (leads, cadências, automações)"), chk("incluirFinanceiro", "Financeiro (cobranças)"), chk("incluirAtendimento", "Atendimento (conversas)"))));
    // 3. copiar
    v.append(el("div", { class: "card section" }, el("h2", {}, "3. Copiar"),
      el("div", { class: "actions", style: "justify-content:flex-start" }, el("button", { class: "btn primary", disabled: E.rodando || !E.sel.size ? "" : null, onclick: copiar }, E.rodando ? "Copiando…" : "Copiar amostra para o beta"), el("button", { class: "btn danger", disabled: E.rodando ? "" : null, onclick: limpar }, "Limpar o beta"), el("button", { class: "btn", onclick: () => { E.betaUser = null; E.beta?.auth.signOut(); renderEsp(); } }, "Desconectar")),
      el("pre", { id: "esp-log", class: "esp-log" }, E.log.join("\n") || "O progresso aparece aqui."),
      E.feito === true ? el("div", { class: "note", style: "color:var(--ok)" }, "Pronto. Abra nevespaduaadv.github.io/painel/beta/ e entre com o login do beta.") : null));
  }

  document.head.append(el("style", {}, `
.esp-lista{max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:2px}
.esp-item{display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;cursor:pointer;font-size:13px}
.esp-item.on{background:var(--gold-soft)}
.esp-log{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px;max-height:300px;overflow:auto;font-size:12px;white-space:pre-wrap;margin-top:10px}
`));
  { const _r = render; render = function () { _r(); const va = $("#view-espelho"); if (!va) return; if (S.tab === "espelho" && !admin()) S.tab = "painel"; va.hidden = S.tab !== "espelho"; if (S.tab === "espelho") renderEsp(); }; }
  window.PP_ESPELHO = { renderEsp };
})();
