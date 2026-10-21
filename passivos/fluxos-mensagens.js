/* Fluxos de mensagens automáticas para leads (migração 0075): gestão dos fluxos (gatilho + passos) pelo comercial e
   seção "Mensagens automáticas" na ficha do lead. Expõe window.PP_FLUXOS = { gerir(), secaoLead(lead, recarregar) }. */
(() => {
  const GATILHOS = { entrou_na_fase: "Quando o lead entra em uma etapa", novo_lead: "Quando um lead novo é criado", reuniao_marcada: "Quando uma reunião é marcada (passos contam a partir da reunião)", manual: "Só quando alguém iniciar pela ficha do lead" };
  const ORIGENS = { chatguru: "ChatGuru (WhatsApp)", site: "Formulário do site", manual: "Cadastro manual", planilha: "Planilha", gcv: "Importado do GCV" };
  const VARS = [["{primeiro_nome}", "primeiro nome do lead"], ["{nome}", "nome completo"], ["{empresa}", "empresa"], ["{proprietario}", "nome do responsável"], ["{reuniao}", "data e hora da reunião"], ["{reuniao_data}", "data da reunião"], ["{reuniao_hora}", "hora da reunião"], ["{link_reuniao}", "link da sala (config. do escritório)"]];
  const UN = { 1: "minutos", 60: "horas", 1440: "dias" };
  const fmtDH = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const esperaTxt = (min, reuniao) => { const a = Math.abs(min); const [n, u] = a % 1440 === 0 && a ? [a / 1440, "dia(s)"] : a % 60 === 0 && a ? [a / 60, "hora(s)"] : [a, "min"]; return reuniao ? (min < 0 ? `${n} ${u} antes da reunião` : min > 0 ? `${n} ${u} depois da reunião` : "na hora da reunião") : (a ? `${n} ${u} depois` : "imediatamente"); };
  const F = { lista: [], fases: [] };

  async function carregar() {
    const [f, fa] = await Promise.all([SB.from("v_fluxos_mensagens").select("*").order("created_at"), SB.from("fases").select("id,nome,ordem").order("ordem")]);
    if (f.error) throw f.error; F.lista = f.data || []; F.fases = fa.data || [];
  }

  // ---------- gestão ----------
  async function gerir() {
    const host = $("#modalHost");
    try { await carregar(); } catch (e) { toast(e.message); return; }
    const close = () => host.replaceChildren();
    const render = () => {
      host.replaceChildren();
      const body = el("div", {});
      body.append(el("p", { class: "note" }, "Um fluxo dispara uma sequência de mensagens de WhatsApp (enviadas pelo ChatGuru, em horário comercial) e/ou tarefas para o responsável. Ele para sozinho quando o lead responde ou muda de etapa, conforme a configuração de cada fluxo."));
      const tb = el("table", {}, el("thead", {}, el("tr", {}, ["Fluxo", "Gatilho", "Passos", "Em andamento", "Ativo", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, F.lista.length ? F.lista.map((f) => el("tr", {},
          el("td", {}, el("b", {}, f.nome), f.descricao ? el("div", { class: "note" }, f.descricao) : null),
          el("td", {}, f.gatilho === "entrou_na_fase" ? `Entra em "${f.fase_nome || "?"}"` : f.gatilho === "novo_lead" ? "Lead novo" + (f.origens?.length ? ` (${f.origens.map((o) => ORIGENS[o] || o).join(", ")})` : "") : f.gatilho === "reuniao_marcada" ? "Reunião marcada" : "Manual"),
          el("td", {}, String(f.passos)), el("td", {}, String(f.ativas)),
          el("td", {}, el("input", { type: "checkbox", checked: f.ativo ? "" : null, onchange: async (e) => { const { error } = await SB.from("fluxos_mensagens").update({ ativo: e.target.checked, updated_at: new Date().toISOString() }).eq("id", f.id); if (error) { toast(error.message); return; } f.ativo = e.target.checked; toast(f.ativo ? "Fluxo ativado" : "Fluxo pausado"); } })),
          el("td", {}, el("button", { class: "btn sm", onclick: () => editar(f, render) }, "Editar")))) : [el("tr", {}, el("td", { colspan: "6", class: "note" }, "Nenhum fluxo ainda. Crie o primeiro."))]));
      body.append(el("div", { class: "tbl" }, tb));
      const card = el("div", { class: "card", role: "dialog", "aria-modal": "true", style: "max-width:980px;width:min(980px,96vw)" }, el("h2", {}, "✉ Fluxos de mensagens"), body,
        el("div", { class: "actions", style: "margin-top:12px" }, el("button", { class: "btn", onclick: close }, "Fechar"), el("button", { class: "btn primary", onclick: () => editar(null, render) }, "+ Novo fluxo")));
      host.append(el("div", { class: "modal", onclick: (e) => { if (e.target.classList.contains("modal")) close(); } }, card));
    };
    render();
  }

  async function editar(f, voltar) {
    const host = $("#modalHost");
    let passos = [];
    if (f) { const { data } = await SB.from("fluxo_passos").select("*").eq("fluxo_id", f.id).order("ordem"); passos = (data || []).map((p) => ({ ...p })); }
    if (!passos.length) passos = [{ ordem: 1, espera_minutos: 0, tipo: "mensagem", texto: "" }];
    const d = { nome: f?.nome || "", descricao: f?.descricao || "", gatilho: f?.gatilho || "entrou_na_fase", fase_id: f?.fase_id || F.fases[0]?.id, origens: f?.origens || [], parar_ao_responder: f ? f.parar_ao_responder : true, parar_ao_mudar_fase: f ? f.parar_ao_mudar_fase : true, ativo: f ? f.ativo : true };
    const nome = inp("text", d.nome, { placeholder: "Ex.: Boas-vindas ao lead novo" }), desc = inp("text", d.descricao, { placeholder: "Opcional" });
    const gat = sel(GATILHOS, d.gatilho), fase = sel(Object.fromEntries(F.fases.map((x) => [x.id, x.nome])), String(d.fase_id));
    const origChk = Object.fromEntries(Object.keys(ORIGENS).map((k) => [k, el("input", { type: "checkbox", checked: d.origens.includes(k) ? "" : null })]));
    const pResp = el("input", { type: "checkbox", checked: d.parar_ao_responder ? "" : null }), pFase = el("input", { type: "checkbox", checked: d.parar_ao_mudar_fase ? "" : null }), ativo = el("input", { type: "checkbox", checked: d.ativo ? "" : null });
    const faseF = field("fx-fase", "Etapa", fase), origF = el("div", { class: "f full" }, el("label", {}, "Só para leads destas origens (nenhuma marcada = todas)"), el("div", { style: "display:flex;gap:14px;flex-wrap:wrap" }, Object.entries(ORIGENS).map(([k, v]) => el("label", { style: "display:flex;gap:6px;align-items:center;font-weight:400" }, origChk[k], v))));
    const passosBox = el("div", {});
    const ehReuniao = () => gat.value === "reuniao_marcada";
    const desenharPassos = () => {
      passosBox.replaceChildren();
      passos.forEach((p, i) => {
        const abs = Math.abs(p.espera_minutos || 0); const unidade = abs && abs % 1440 === 0 ? 1440 : abs && abs % 60 === 0 ? 60 : 1;
        const n = inp("number", String(abs / unidade), { min: "0", step: "1", style: "width:80px" }), u = sel(UN, String(unidade)), sentido = sel({ "-1": "antes da reunião", "1": "depois da reunião" }, String(p.espera_minutos < 0 ? -1 : 1));
        const tipo = sel({ mensagem: "Mensagem de WhatsApp", tarefa: "Tarefa para o responsável" }, p.tipo);
        const texto = el("textarea", { rows: "3", placeholder: p.tipo === "mensagem" ? "Olá {primeiro_nome}, aqui é {proprietario}, da Neves Pádua…" : "Título da tarefa (ex.: Ligar para o lead)", style: "width:100%" }, p.texto || "");
        const atualizar = () => { p.espera_minutos = (+n.value || 0) * (+u.value) * (ehReuniao() ? +sentido.value : 1); p.tipo = tipo.value; p.texto = texto.value; };
        [n, u, sentido, tipo, texto].forEach((x) => x.addEventListener("input", atualizar));
        tipo.onchange = () => { atualizar(); texto.placeholder = tipo.value === "mensagem" ? "Olá {primeiro_nome}…" : "Título da tarefa"; };
        const vars = el("div", { class: "note", style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:4px" }, "Inserir: ", VARS.map(([v, t]) => el("button", { class: "btn sm", type: "button", title: t, onclick: () => { const s = texto.selectionStart ?? texto.value.length; texto.value = texto.value.slice(0, s) + v + texto.value.slice(texto.selectionEnd ?? s); texto.focus(); atualizar(); } }, v)));
        passosBox.append(el("div", { class: "card section", style: "margin-bottom:8px" },
          el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, el("b", {}, `Passo ${i + 1}`), el("span", { class: "note" }, ehReuniao() ? "" : i ? "esperar" : "esperar (a partir do gatilho)"), n, u, ehReuniao() ? sentido : null, tipo,
            el("span", { style: "margin-left:auto;display:flex;gap:4px" }, i ? el("button", { class: "btn sm", type: "button", title: "Subir", onclick: () => { [passos[i - 1], passos[i]] = [passos[i], passos[i - 1]]; desenharPassos(); } }, "↑") : null, i < passos.length - 1 ? el("button", { class: "btn sm", type: "button", title: "Descer", onclick: () => { [passos[i + 1], passos[i]] = [passos[i], passos[i + 1]]; desenharPassos(); } }, "↓") : null, el("button", { class: "btn sm", type: "button", title: "Remover", onclick: () => { passos.splice(i, 1); if (!passos.length) passos.push({ espera_minutos: 0, tipo: "mensagem", texto: "" }); desenharPassos(); } }, "×"))),
          el("div", { style: "margin-top:6px" }, texto), vars));
      });
      passosBox.append(el("button", { class: "btn sm", type: "button", onclick: () => { passos.push({ espera_minutos: 1440, tipo: "mensagem", texto: "" }); desenharPassos(); } }, "+ Adicionar passo"));
    };
    const ajustarGatilho = () => { faseF.hidden = gat.value !== "entrou_na_fase"; origF.hidden = gat.value !== "novo_lead"; desenharPassos(); };
    gat.onchange = ajustarGatilho;
    const form = el("div", { class: "form" }, field("fx-nome", "Nome do fluxo", nome), field("fx-desc", "Descrição", desc), field("fx-gat", "Gatilho", gat), faseF, origF,
      el("div", { class: "f full" }, el("label", {}, "Parar o fluxo quando…"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, pResp, "o lead responder no WhatsApp (recomendado)"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, pFase, "o lead mudar de etapa ou for fechado"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, ativo, "Fluxo ativo")));
    const body = el("div", {}, form, el("h3", { style: "margin:12px 0 6px" }, "Passos"), el("p", { class: "note" }, "As mensagens saem pelo ChatGuru só em horário comercial (fora dele, ficam para o próximo horário). Uma observação é gravada no lead a cada envio."), passosBox);
    ajustarGatilho();
    const salvar = async () => {
      if (!nome.value.trim()) throw new Error("Dê um nome ao fluxo");
      passos.forEach((p, i) => { p.ordem = i + 1; });
      if (passos.some((p) => !p.texto.trim())) throw new Error("Há passo sem texto");
      const reg = { nome: nome.value.trim(), descricao: desc.value.trim() || null, gatilho: gat.value, fase_id: gat.value === "entrou_na_fase" ? +fase.value : null, origens: gat.value === "novo_lead" ? (Object.keys(ORIGENS).filter((k) => origChk[k].checked).length ? Object.keys(ORIGENS).filter((k) => origChk[k].checked) : null) : null, parar_ao_responder: pResp.checked, parar_ao_mudar_fase: pFase.checked, ativo: ativo.checked, updated_at: new Date().toISOString() };
      let id = f?.id;
      if (id) { const { error } = await SB.from("fluxos_mensagens").update(reg).eq("id", id); if (error) throw error; }
      else { const { data, error } = await SB.from("fluxos_mensagens").insert(reg).select("id").single(); if (error) throw error; id = data.id; }
      const { error: e1 } = await SB.from("fluxo_passos").delete().eq("fluxo_id", id); if (e1) throw e1;
      const { error: e2 } = await SB.from("fluxo_passos").insert(passos.map((p) => ({ fluxo_id: id, ordem: p.ordem, espera_minutos: p.espera_minutos || 0, tipo: p.tipo, texto: p.texto.trim(), tarefa_tipo: p.tipo === "tarefa" ? "whatsapp" : null }))); if (e2) throw e2;
      toast("Fluxo salvo"); await carregar(); voltar();
    };
    const excluir = f ? el("button", { class: "btn danger", onclick: async () => { if (!confirm(`Excluir o fluxo "${f.nome}"? Mensagens já agendadas por ele serão canceladas.`)) return; const { error } = await SB.from("fluxos_mensagens").delete().eq("id", f.id); if (error) { toast(error.message); return; } toast("Fluxo excluído"); await carregar(); voltar(); } }, "Excluir") : null;
    host.replaceChildren();
    const card = el("div", { class: "card", role: "dialog", "aria-modal": "true", style: "max-width:980px;width:min(980px,96vw)" }, el("h2", {}, f ? "Editar fluxo" : "Novo fluxo de mensagens"), body,
      el("div", { class: "actions", style: "margin-top:12px" }, excluir, el("button", { class: "btn", onclick: voltar }, "Cancelar"), el("button", { class: "btn primary", onclick: async () => { try { await salvar(); } catch (e) { toast(e.message); } } }, "Salvar fluxo")));
    host.append(el("div", { class: "modal" }, card));
    nome.focus();
  }

  // ---------- ficha do lead ----------
  async function secaoLead(l, recarregar) {
    const box = el("div", { class: "card section", style: "margin-top:12px" }, el("div", { class: "note" }, "✉ Mensagens automáticas"));
    const [m, f] = await Promise.all([SB.from("v_lead_mensagens").select("*").eq("lead_id", l.id).order("enviar_em"), SB.from("v_fluxos_mensagens").select("id,nome,gatilho,ativo").eq("ativo", true).order("nome")]);
    const msgs = m.data || [], fluxos = f.data || [];
    const pend = msgs.filter((x) => x.status === "pendente"), hist = msgs.filter((x) => x.status !== "pendente");
    const COR = { enviada: "#1baf7a", erro: "#b91c1c", cancelada: "#6b7280", processando: "#2a78d6" };
    const linha = (x) => el("div", { class: "ld-obs" }, el("div", { class: "note" }, `${fmtDH(x.enviar_em)} · `, el("span", { style: `color:${COR[x.status] || "#b45309"};font-weight:600` }, x.status), x.fluxo_nome ? ` · ${x.fluxo_nome}` : "", x.resultado && x.status !== "enviada" ? ` · ${x.resultado}` : ""), el("div", { style: "white-space:pre-wrap" }, x.texto));
    box.append(pend.length ? el("div", { class: "ld-timeline" }, pend.map((x) => el("div", { class: "ld-obs" }, el("div", { class: "note" }, `Agendada para ${fmtDH(x.enviar_em)}`, x.fluxo_nome ? ` · ${x.fluxo_nome}` : "", " ", el("button", { class: "btn sm", onclick: async () => { const { error } = await SB.from("mensagens_fila").update({ status: "cancelada", resultado: "Cancelada pela equipe", atualizado_em: new Date().toISOString() }).eq("id", x.id); if (error) { toast(error.message); return; } toast("Mensagem cancelada"); recarregar(); } }, "cancelar")), el("div", { style: "white-space:pre-wrap" }, x.texto)))) : el("div", { class: "note" }, "Nenhuma mensagem agendada."));
    if (hist.length) box.append(el("details", { style: "margin-top:6px" }, el("summary", { class: "note" }, `Histórico (${hist.length})`), el("div", { class: "ld-timeline" }, hist.slice(-30).reverse().map(linha))));
    if (!(typeof readOnly === "function" && readOnly())) {
      const s = sel({ "": "Iniciar fluxo…", ...Object.fromEntries(fluxos.map((x) => [x.id, x.nome + (x.gatilho === "manual" ? "" : " (" + ({ entrou_na_fase: "etapa", novo_lead: "lead novo", reuniao_marcada: "reunião" })[x.gatilho] + ")")])) }, "");
      s.onchange = async () => { if (!s.value) return; const { error } = await SB.rpc("lead_fluxo_iniciar", { p_lead: l.id, p_fluxo: s.value }); if (error) { toast(error.message); s.value = ""; return; } toast("Fluxo iniciado"); recarregar(); };
      box.append(el("div", { class: "actions", style: "margin-top:8px" }, s, pend.length ? el("button", { class: "btn sm", onclick: async () => { if (!confirm("Parar todos os fluxos deste lead e cancelar as mensagens agendadas?")) return; const { error } = await SB.rpc("lead_fluxos_parar", { p_lead: l.id }); if (error) { toast(error.message); return; } toast("Fluxos parados"); recarregar(); } }, "Parar fluxos") : null, PP.perfil?.papel === "admin" || (PP.perfil?.acessos || []).includes("comercial") ? el("button", { class: "btn sm", onclick: () => gerir() }, "Gerir fluxos") : null));
    }
    return box;
  }
  window.PP_FLUXOS = { gerir, secaoLead };
})();
