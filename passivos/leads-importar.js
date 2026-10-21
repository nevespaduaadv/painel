/* Importação em massa de leads por planilha (.xlsx/.csv) — assistente em 4 passos (arquivo → mapear → visualizar → importar),
   planilha modelo e sincronização coluna → campo. Usa rpc importar_leads_v2 (migração 0074). Expõe window.PP_IMPORTAR.abrir(). */
(() => {
  const CAMPOS = [
    ["nome", "Nome", ["nome", "nome completo", "lead", "titulo", "título", "nome do lead", "pessoa - nome", "contato"], true],
    ["whatsapp", "WhatsApp", ["whatsapp", "telefone", "celular", "phone", "fone", "pessoa - telefone", "telefone 1", "whats"], true],
    ["externo_id", "ID no sistema de origem (GCV)", ["id", "id gcv", "id no gcv", "codigo", "código", "lead id", "id externo"], false],
    ["email", "E-mail", ["email", "e-mail", "pessoa - e-mail"], false],
    ["empresa", "Empresa", ["empresa", "nome da empresa", "organizacao", "organização", "organizacao - nome", "razao social", "razão social"], false],
    ["fase", "Etapa do funil", ["etapa", "fase", "etapa do funil", "estagio", "estágio", "stage", "pipeline", "funil"], false],
    ["status", "Status (Aberto / Ganho / Perdido / Abandonado)", ["status", "situacao", "situação", "resultado"], false],
    ["motivo_perda", "Motivo da perda", ["motivo da perda", "motivo de perda", "motivo perda", "motivo", "lost reason"], false],
    ["proprietario", "Proprietário (e-mail ou nome)", ["proprietario", "proprietário", "responsavel", "responsável", "dono", "vendedor", "sdr", "closer", "owner", "atendente"], false],
    ["valor", "Valor da oportunidade (R$)", ["valor", "valor da oportunidade", "valor do negocio", "valor do negócio", "oportunidade", "honorarios", "honorários", "ticket"], false],
    ["data_entrada", "Data de entrada", ["data de entrada", "data", "entrada", "criado em", "data de criacao", "data de criação", "created", "cadastro"], false],
    ["reuniao_em", "Reunião (data e hora)", ["reuniao", "reunião", "data da reuniao", "data da reunião", "agendamento", "call"], false],
    ["origem", "Origem", ["origem", "fonte", "canal", "source"], false],
    ["tipo_divida", "Tipo de dívida", ["tipo de divida", "tipo de dívida", "tipo divida"], false],
    ["situacao_divida", "Situação da dívida", ["situacao da divida", "situação da dívida", "situacao das dividas", "situação das dívidas"], false],
    ["valor_divida", "Valor da dívida", ["valor da divida", "valor da dívida", "divida", "dívida", "faixa"], false],
    ["campanha", "Campanha", ["campanha", "campaign", "campaign_name"], false],
    ["publico", "Público", ["publico", "público", "adset", "adset_name", "conjunto"], false],
    ["anuncio", "Anúncio", ["anuncio", "anúncio", "ad", "ad_name", "criativo"], false],
    ["tags", "Tags (separadas por vírgula)", ["tags", "etiquetas", "marcadores", "labels"], false],
    ["observacao", "Observação (vira nota no lead)", ["observacao", "observação", "observacoes", "observações", "notas", "nota", "comentarios", "comentários", "anotacoes", "anotações", "historico", "histórico"], false],
    ["link_chat", "Link do chat (ChatGuru)", ["link do chat", "link chat", "chat", "link"], false],
  ];
  const ROTULO = Object.fromEntries(CAMPOS.map(([k, r]) => [k, r]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ").replace(/\s*\*$/, "");
  const txt = (v) => v == null ? "" : v instanceof Date ? v.toLocaleString("pt-BR") : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : String(v).trim();
  const p2 = (n) => String(n).padStart(2, "0");
  const iso = (a, m, d, h = 0, mi = 0, s = 0) => `${a}-${p2(m)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(s)}-03:00`;
  const converterData = (v) => {
    if (v == null || v === "") return "";
    if (v instanceof Date) return isNaN(v) ? "" : iso(v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds());
    if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 864e5)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()); }
    const s = String(v).trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) { let a = +m[3]; if (a < 100) a += 2000; return iso(a, +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return iso(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return s; // deixa o servidor avisar
  };
  const carregarXLSX = async () => { if (window.XLSX) return; await new Promise((ok, err) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload = ok; s.onerror = () => err(new Error("Não foi possível carregar o leitor de Excel")); document.head.append(s); }); };
  const lerArquivo = async (file) => {
    await carregarXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true, raw: false });
    return wb.SheetNames.map((n) => ({ nome: n, linhas: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }) })).filter((p) => p.linhas.length);
  };
  const mapearAuto = (cab) => { const nomes = cab.map(norm); const mapa = {}; for (const [campo, rot, sin] of CAMPOS) { const alvo = [norm(rot), ...sin.map(norm)]; let i = nomes.findIndex((n) => alvo.includes(n)); if (i < 0) i = nomes.findIndex((n) => n && alvo.some((a) => a.length > 3 && n.startsWith(a))); if (i >= 0 && !Object.values(mapa).includes(i)) mapa[campo] = i; } return mapa; };

  // ---- planilha modelo ----
  async function baixarModelo(ref) {
    await carregarXLSX();
    const cab = ["Nome", "WhatsApp", "E-mail", "Empresa", "Etapa", "Status", "Motivo da perda", "Proprietário", "Valor da oportunidade", "Data de entrada", "Reunião", "Origem", "Tipo de dívida", "Situação da dívida", "Valor da dívida", "Campanha", "Público", "Anúncio", "Tags", "Observação", "Link do chat", "ID no GCV"];
    const ex = [
      ["Carlos Pereira", "(16) 99999-0001", "carlos@empresa.com.br", "Pereira Distribuidora LTDA", "Proposta enviada", "Aberto", "", ref.perfis[0]?.email || "closer@escritorio.com", "15000", "10/09/2026", "15/10/2026 14:00", "GCV", "Capital de giro", "Em atraso", "300 mil a 500 mil", "PJ - Google", "", "", "PJ, Itaú", "Dois contratos no Itaú; sócio avalista", "", "GCV-1234"],
      ["Ana Souza", "16988880002", "", "Souza & Filhos ME", "Em qualificação", "Aberto", "", ref.perfis[0]?.email || "sdr@escritorio.com", "", "01/10/2026", "", "GCV", "", "", "", "", "", "", "", "", "", "GCV-1235"],
      ["Marcos Lima", "(16) 97777-0003", "", "Lima Transportes", "Qualificado", "Perdido", "Não tem budget", "", "", "20/08/2026", "", "GCV", "", "", "", "", "", "", "", "Preferiu negociar direto com o banco", "", "GCV-1236"],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([cab, ...ex]);
    ws["!cols"] = cab.map((c, i) => ({ wch: Math.max(14, c.length + 4, ...ex.map((r) => String(r[i] || "").length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    const col = (t, arr) => [t, ...arr];
    const valores = [
      col("Etapa", ref.fases.map((f) => f.nome)),
      col("Status", ["Aberto", "Ganho", "Perdido", "Abandonado"]),
      col("Motivo da perda", ref.motivos.map((m) => m.rotulo.replace(/^\[(sdr|closer|cs)\]\s*/i, ""))),
      col("Proprietário (e-mail)", ref.perfis.map((p) => p.email)),
      col("Origem", ["GCV", "Planilha", "ChatGuru", "Site", "Manual"]),
    ];
    const alt = Math.max(...valores.map((v) => v.length));
    const aoa = []; for (let r = 0; r < alt; r++) aoa.push(valores.map((v) => v[r] ?? ""));
    const ws2 = XLSX.utils.aoa_to_sheet(aoa); ws2["!cols"] = valores.map(() => ({ wch: 36 }));
    XLSX.utils.book_append_sheet(wb, ws2, "Valores aceitos");
    const ws3 = XLSX.utils.aoa_to_sheet([
      ["Como preencher"],
      ["Obrigatórios: Nome e WhatsApp (com DDD). O WhatsApp é a chave: número repetido atualiza o lead em vez de duplicar."],
      ["Etapa e Status: use os valores da aba 'Valores aceitos' (apelidos como MQL, SQL, No-show, Em aberto também funcionam)."],
      ["Perdido/Abandonado exige Motivo da perda. Motivos fora do catálogo são gravados como texto."],
      ["Proprietário: e-mail (ou nome) de alguém da equipe com login no sistema. Se não encontrar, o lead fica sem proprietário."],
      ["Datas: dd/mm/aaaa (hora opcional: dd/mm/aaaa hh:mm). Valor: número ou 'R$ 12.500,00'."],
      ["Tags: separadas por vírgula. Observação vira uma nota no histórico do lead."],
      ["Colunas que não existem na sua exportação podem ficar vazias ou ser removidas."],
    ]); ws3["!cols"] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Instruções");
    XLSX.writeFile(wb, "modelo-importacao-leads.xlsx");
  }

  // ---- assistente ----
  async function abrir() {
    const SBc = window.SB; const host = document.querySelector("#modalHost");
    const ref = { fases: window.PP_LEADS?.fases || [], perfis: [], motivos: [] };
    try {
      const [p, m, f] = await Promise.all([SBc.from("perfis").select("id,nome,email").in("papel", ["admin", "colaborador"]).order("nome"), SBc.from("motivos_perda").select("codigo,rotulo").eq("ativo", true).order("ordem"), ref.fases.length ? Promise.resolve({ data: ref.fases }) : SBc.from("fases").select("*").order("ordem")]);
      ref.perfis = p.data || []; ref.motivos = m.data || []; ref.fases = f.data || ref.fases;
    } catch (_) {}
    const st = { passo: 1, planilhas: [], idx: 0, mapa: {}, linhas: [], simulacao: null, resultado: null, opcoes: { atualizar: true, iniciar_cadencia: false, origem_padrao: "gcv", lote: "GCV " + new Date().toLocaleDateString("pt-BR") } };
    const close = () => host.replaceChildren();
    const PASSOS = ["Arquivo", "Mapear", "Visualizar", "Importar"];
    const render = () => {
      host.replaceChildren();
      const cab = el("div", { class: "tabs", style: "margin-bottom:12px" }, PASSOS.map((p, i) => el("button", { class: "tab", "aria-selected": String(st.passo === i + 1), disabled: i + 1 > st.passo ? "" : null, onclick: () => { if (i + 1 < st.passo && !st.resultado) { st.passo = i + 1; render(); } } }, `${i + 1}. ${p}`)));
      const body = el("div", {});
      const acoes = el("div", { class: "actions", style: "margin-top:14px" });
      if (st.passo === 1) passo1(body, acoes); else if (st.passo === 2) passo2(body, acoes); else if (st.passo === 3) passo3(body, acoes); else passo4(body, acoes);
      const card = el("div", { class: "card", role: "dialog", "aria-modal": "true", style: "max-width:1100px;width:min(1100px,96vw)" }, el("h2", {}, "Importar leads"), cab, body, acoes);
      host.append(el("div", { class: "modal", onclick: (e) => { if (e.target.classList.contains("modal") && !st.resultado) close(); } }, card));
    };
    const btn = (t, fn, cls = "btn") => el("button", { class: cls, onclick: fn }, t);

    function passo1(body, acoes) {
      const file = inp("file", "", { accept: ".xlsx,.xls,.csv" });
      const atualizar = el("input", { type: "checkbox", checked: st.opcoes.atualizar ? "" : null });
      const cad = el("input", { type: "checkbox", checked: st.opcoes.iniciar_cadencia ? "" : null });
      const origem = sel({ gcv: "GCV (CRM anterior)", planilha: "Planilha", manual: "Cadastro manual", chatguru: "ChatGuru", site: "Site" }, st.opcoes.origem_padrao);
      const lote = inp("text", st.opcoes.lote, { placeholder: "Ex.: GCV outubro/2026" });
      body.append(
        el("div", { class: "card section", style: "margin-bottom:12px" },
          el("h3", {}, "1. Prepare a planilha"),
          el("p", { class: "note" }, "Exporte os leads do GCV (ou preencha a planilha modelo). Obrigatórios: Nome e WhatsApp. Etapa, Status, Proprietário, Motivo da perda, Valor, Datas, Tags e Observação são opcionais — a aba \"Valores aceitos\" do modelo lista o que o sistema reconhece."),
          el("div", { class: "actions" }, btn("⬇ Baixar planilha modelo (.xlsx)", () => baixarModelo(ref).catch((e) => toast(e.message))))),
        el("div", { class: "card section" },
          el("h3", {}, "2. Envie o arquivo"),
          el("div", { class: "form" },
            field("imp-file", "Arquivo (.xlsx, .xls ou .csv)", file),
            field("imp-lote", "Nome do lote (aparece nas notas importadas)", lote),
            field("imp-origem", "Origem padrão (quando a planilha não informa)", origem),
            el("div", { class: "f" }, el("label", {}, "Opções"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, atualizar, "Atualizar leads que já existem (mesmo WhatsApp ou ID) com os dados da planilha"), el("label", { style: "display:flex;gap:8px;align-items:center;font-weight:400" }, cad, "Iniciar a cadência da etapa para os leads importados em aberto (padrão: não — evita tarefas em massa)")))),
      );
      const info = el("div", { class: "note", style: "margin-top:8px" }); body.append(info);
      file.onchange = async () => {
        if (!file.files[0]) return;
        try { st.planilhas = await lerArquivo(file.files[0]); st.idx = 0; if (!st.planilhas.length) throw new Error("Planilha vazia"); const pl = st.planilhas.find((p) => p.nome.toLowerCase() === "leads") || st.planilhas[0]; st.idx = st.planilhas.indexOf(pl); st.mapa = mapearAuto(pl.linhas[0] || []); info.textContent = `${file.files[0].name} · ${st.planilhas.length} aba(s) · ${Math.max(0, pl.linhas.length - 1)} linha(s) na aba "${pl.nome}" · ${Object.keys(st.mapa).length} coluna(s) reconhecida(s)`; }
        catch (e) { toast(e.message); st.planilhas = []; }
      };
      acoes.append(btn("Cancelar", close), btn("Próximo →", () => {
        if (!st.planilhas.length) { toast("Escolha o arquivo"); return; }
        st.opcoes = { atualizar: atualizar.checked, iniciar_cadencia: cad.checked, origem_padrao: origem.value, lote: lote.value.trim() };
        st.passo = 2; render();
      }, "btn primary"));
    }

    function passo2(body, acoes) {
      const pl = st.planilhas[st.idx]; const cab = pl.linhas[0] || []; const ex = pl.linhas.slice(1, 3);
      const aba = sel(Object.fromEntries(st.planilhas.map((p, i) => [i, `${p.nome} (${Math.max(0, p.linhas.length - 1)} linhas)`])), String(st.idx));
      aba.onchange = () => { st.idx = +aba.value; st.mapa = mapearAuto(st.planilhas[st.idx].linhas[0] || []); render(); };
      const usados = () => new Set(Object.values(st.mapa));
      const resumo = el("div", { class: "note" });
      const atualizarResumo = () => { const n = Object.keys(st.mapa).length; resumo.textContent = `${n} de ${cab.length} coluna(s) mapeada(s). Colunas não mapeadas não são importadas.`; };
      const tb = el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Coluna da planilha"), el("th", {}, "Exemplos"), el("th", {}, "→ Campo do sistema"))),
        el("tbody", {}, cab.map((c, i) => {
          const campoAtual = Object.entries(st.mapa).find(([, v]) => v === i)?.[0] || "";
          const s = sel({ "": "— não importar —", ...Object.fromEntries(CAMPOS.map(([k, r, , ob]) => [k, r + (ob ? " *" : "")])) }, campoAtual);
          s.onchange = () => { for (const [k, v] of Object.entries(st.mapa)) if (v === i) delete st.mapa[k]; if (s.value) { for (const [k, v] of Object.entries(st.mapa)) if (k === s.value) delete st.mapa[k]; st.mapa[s.value] = i; } atualizarResumo(); render(); };
          return el("tr", { style: campoAtual ? "" : "opacity:.75" }, el("td", {}, el("b", {}, txt(c) || `(coluna ${i + 1})`)), el("td", { class: "note" }, ex.map((r) => txt(r[i])).filter(Boolean).join(" · ") || "—"), el("td", {}, s, campoAtual ? el("span", { class: "pill", style: "margin-left:6px;background:#1baf7a1a;color:#1baf7a" }, "✓") : null));
        })));
      atualizarResumo();
      body.append(el("div", { class: "form", style: "margin-bottom:8px" }, field("imp-aba", "Aba da planilha", aba)), resumo, el("div", { class: "tbl", style: "max-height:52vh;overflow:auto" }, tb));
      const pend = CAMPOS.filter(([k, , , ob]) => ob && st.mapa[k] == null).map(([k]) => ROTULO[k]);
      body.append(el("div", { class: "note", style: pend.length ? "color:#b45309;margin-top:8px" : "margin-top:8px" }, pend.length ? `Obrigatórios ainda sem coluna: ${pend.join(", ")}` + (pend.includes("WhatsApp") && st.mapa.externo_id != null ? " (aceito: ID no sistema de origem no lugar do WhatsApp)" : "") : "Obrigatórios mapeados. Campos disponíveis que não estão na planilha: " + CAMPOS.filter(([k]) => st.mapa[k] == null).map(([k]) => ROTULO[k]).join(", ")));
      acoes.append(btn("← Voltar", () => { st.passo = 1; render(); }), btn("Cancelar", close), btn("Visualizar →", async () => {
        if (st.mapa.whatsapp == null && st.mapa.externo_id == null) { toast("Mapeie a coluna de WhatsApp (ou o ID no sistema de origem)"); return; }
        st.linhas = []; pl.linhas.slice(1).forEach((ln, i) => { if (!ln || ln.every((c) => txt(c) === "")) return; const r = { _linha: i + 2 }; for (const [campo, col] of Object.entries(st.mapa)) r[campo] = ["data_entrada", "reuniao_em"].includes(campo) ? converterData(ln[col]) : txt(ln[col]); st.linhas.push(r); });
        if (!st.linhas.length) { toast("A aba não tem linhas de dados"); return; }
        st.passo = 3; st.simulacao = null; render();
        try { st.simulacao = await executar(true); } catch (e) { toast(e.message); st.passo = 2; }
        render();
      }, "btn primary"));
    }

    async function executar(simular) {
      const tot = { criados: 0, atualizados: 0, ignorados: 0, erros: [], avisos: [], detalhes: [] };
      for (let i = 0; i < st.linhas.length; i += 200) {
        const { data, error } = await SBc.rpc("importar_leads_v2", { linhas: st.linhas.slice(i, i + 200), opcoes: { ...st.opcoes, simular } });
        if (error) throw error;
        tot.criados += data.criados; tot.atualizados += data.atualizados; tot.ignorados += data.ignorados; tot.erros.push(...(data.erros || [])); tot.avisos.push(...(data.avisos || [])); tot.detalhes.push(...(data.detalhes || []));
      }
      return tot;
    }
    const faseNome = (id) => ref.fases.find((f) => f.id === id)?.nome || (id ? "#" + id : "—");
    const perfilNome = (id) => { const p = ref.perfis.find((x) => x.id === id); return p ? (p.nome || p.email) : "—"; };

    function passo3(body, acoes) {
      const s = st.simulacao;
      if (!s) { body.append(el("div", { class: "note" }, `Conferindo ${st.linhas.length} linha(s) com o sistema…`)); acoes.append(btn("Cancelar", close)); return; }
      const kpi = (n, l, cor) => el("div", { class: "card section", style: "text-align:center;flex:1;min-width:120px" }, el("div", { class: "num", style: `font-size:26px;font-weight:700;color:${cor}` }, String(n)), el("div", { class: "note" }, l));
      body.append(el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px" }, kpi(s.criados, "serão criados", "#1baf7a"), kpi(s.atualizados, st.opcoes.atualizar ? "serão atualizados" : "já existem", "#2a78d6"), kpi(s.ignorados, "ignorados (com erro ou já existentes)", "#b45309"), kpi(s.avisos.length, "avisos", "#6b7280")));
      if (s.erros.length) body.append(el("details", { open: "" }, el("summary", {}, `Linhas com erro (${s.erros.length}) — não serão importadas`), el("ul", { class: "note", style: "max-height:160px;overflow:auto" }, s.erros.slice(0, 200).map((e) => el("li", {}, `Linha ${e.linha}: ${e.motivo}`)))));
      if (s.avisos.length) body.append(el("details", {}, el("summary", {}, `Avisos (${s.avisos.length}) — importa mesmo assim`), el("ul", { class: "note", style: "max-height:160px;overflow:auto" }, s.avisos.slice(0, 200).map((e) => el("li", {}, `Linha ${e.linha}: ${e.motivo}`)))));
      const det = s.detalhes.filter((d) => d.acao !== "erro");
      body.append(el("h3", { style: "margin-top:10px" }, "Prévia"), el("div", { class: "tbl", style: "max-height:36vh;overflow:auto" }, el("table", {}, el("thead", {}, el("tr", {}, ["Linha", "Ação", "Nome", "Etapa", "Status", "Proprietário", "Lead existente"].map((h) => el("th", {}, h)))),
        el("tbody", {}, det.slice(0, 100).map((d) => el("tr", {}, el("td", {}, String(d.linha)), el("td", {}, el("span", { class: "pill", style: d.acao === "criar" ? "background:#1baf7a1a;color:#1baf7a" : d.acao === "atualizar" ? "background:#2a78d61a;color:#2a78d6" : "" }, d.acao === "criar" ? "criar" : d.acao === "atualizar" ? "atualizar" : "ignorar")), el("td", {}, d.nome || "—"), el("td", {}, d.fase_id ? faseNome(d.fase_id) : "—"), el("td", {}, d.status || "—"), el("td", {}, d.proprietario_id ? perfilNome(d.proprietario_id) : "—"), el("td", { class: "note" }, d.existente || "—")))))),
        det.length > 100 ? el("div", { class: "note" }, `Mostrando 100 de ${det.length}.`) : null);
      acoes.append(btn("← Voltar ao mapeamento", () => { st.passo = 2; render(); }), btn("Cancelar", close),
        btn(`Importar ${s.criados + s.atualizados} lead(s)`, async () => { if (!(s.criados + s.atualizados)) { toast("Nada a importar"); return; } st.passo = 4; st.resultado = null; render(); try { st.resultado = await executar(false); } catch (e) { st.resultado = { erro: e.message }; } window.PP_LEADS?.invalidar?.(); render(); }, "btn primary"));
    }

    function passo4(body, acoes) {
      const r = st.resultado;
      if (!r) { body.append(el("div", { class: "note" }, "Importando… não feche esta janela.")); return; }
      if (r.erro) { body.append(el("div", { class: "note", style: "color:#b91c1c" }, "Falha: " + r.erro)); acoes.append(btn("Fechar", close)); return; }
      const kpi = (n, l, cor) => el("div", { class: "card section", style: "text-align:center;flex:1;min-width:120px" }, el("div", { style: `font-size:26px;font-weight:700;color:${cor}` }, String(n)), el("div", { class: "note" }, l));
      body.append(el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px" }, kpi(r.criados, "criados", "#1baf7a"), kpi(r.atualizados, "atualizados", "#2a78d6"), kpi(r.ignorados, "ignorados", "#b45309")),
        el("p", { class: "note" }, `Lote "${st.opcoes.lote || "—"}". Os leads importados aparecem no funil na etapa informada` + (st.opcoes.iniciar_cadencia ? ", com a cadência da etapa iniciada." : "; cadências não foram iniciadas (use \"Iniciar cadência da etapa\" na ficha quando quiser).")));
      if (r.erros.length) body.append(el("details", { open: "" }, el("summary", {}, `Não importados (${r.erros.length})`), el("ul", { class: "note", style: "max-height:160px;overflow:auto" }, r.erros.map((e) => el("li", {}, `Linha ${e.linha}: ${e.motivo}`)))));
      if (r.avisos.length) body.append(el("details", {}, el("summary", {}, `Avisos (${r.avisos.length})`), el("ul", { class: "note", style: "max-height:160px;overflow:auto" }, r.avisos.map((e) => el("li", {}, `Linha ${e.linha}: ${e.motivo}`)))));
      acoes.append(btn("Importar outro arquivo", () => { Object.assign(st, { passo: 1, planilhas: [], mapa: {}, linhas: [], simulacao: null, resultado: null }); render(); }), btn("Fechar", () => { close(); window.PP_LEADS?.render?.(); }, "btn primary"));
    }
    render();
  }
  window.PP_IMPORTAR = { abrir, baixarModelo, CAMPOS };
})();
