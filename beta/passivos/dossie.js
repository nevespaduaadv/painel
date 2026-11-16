/* Dossiê do cliente — as três frentes se encontram aqui (beta 0008).
   No Resumo do cliente: "Informações relevantes" (registros fixados), três colunas (Estratégico · Jurídico · Negocial: responsável,
   último registro, próximo prazo, abertas) e a linha do tempo única (v_dossie: registros, andamentos, tarefas feitas, publicações
   tratadas, negociações, cobranças), com filtro por frente. Botão "Registrar" (PP_CARTEIRA.registrar) em todo lugar.
   Supabase: v_dossie, v_cliente_frentes, entradas_timeline(frente, fixado), clientes.resp_*_id, colaboradores.frente. */
(() => {
  "use strict";
  const D = { cache: {}, filtro: {} };
  const FRENTES = { estrategico: "Estratégico / Consultivo", juridico: "Jurídico / Contencioso", negocial: "Negocial / Acordos" };
  const ORIGEM = { registro: "Registro", tarefa: "Tarefa", negociacao: "Negociação" };
  const TIPO_TAREFA = { tarefa_criada: "Tarefa aberta", tarefa_reatribuida: "Tarefa passada", tarefa_comentario: "Registro na tarefa", tarefa_concluida: "Tarefa concluída", tarefa_reaberta: "Tarefa reaberta", tarefa_cancelada: "Tarefa cancelada" };
  const TIPO = { registro: "Registro", informacao_cliente: "Informação do cliente", decisao: "Decisão", nao_feito: "Não feito — motivo", contato_cliente: "Contato com o cliente", contato_banco: "Contato com o banco", reuniao_cliente: "Reunião", proposta_acordo: "Proposta de acordo", parecer_tecnico: "Parecer", analise_contrato: "Análise de contrato", solicitacao_documentos: "Solicitação de documentos", requerimento_bacen: "Requerimento ao Bacen", ata: "Ata", protocolo: "Protocolo", tarefa_feita: "Tarefa concluída", outro: "Registro" };
  const fmtDH = (s) => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtD = (s) => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—";
  const dias = (iso) => iso ? Math.round((Date.now() - new Date(iso).getTime()) / 864e5) : null;
  const invalidar = (cid) => { if (cid) delete D.cache[cid]; else D.cache = {}; };
  async function carregar(cid) {
    D.cache[cid] = { ok: false, itens: [], frentes: [], colab: [] };
    const cli = (S.clientes || []).find((x) => x.id === cid); const grupo = (cli?.grupo || "").trim(); const doGrupo = grupo && D.grupo?.[cid];
    const [a, b, c] = await Promise.all([doGrupo ? SB.from("v_dossie_grupo").select("*").eq("grupo", grupo).order("quando", { ascending: false }).limit(1500) : SB.from("v_dossie").select("*").eq("cliente_id", cid).order("quando", { ascending: false }).limit(1000), SB.from("v_cliente_frentes").select("*").eq("cliente_id", cid), SB.from("colaboradores").select("id,nome,frente,ativo").order("nome")]);
    if (a.error && doGrupo) { toast("Dossiê do grupo indisponível (migração 0095)"); D.grupo[cid] = false; return carregar(cid); }
    const vistos = new Set(); const itens = (a.data || []).map((i) => ({ ...i, outra_empresa: doGrupo && i.cliente_id !== cid ? i.de_cliente_nome : null })).filter((i) => { const k = [i.origem, i.processo_id, String(i.quando).slice(0, 10), (i.texto || "").slice(0, 300)].join("|"); if (i.origem !== "registro" && vistos.has(k)) return false; vistos.add(k); return true; });
    D.cache[cid] = { ok: true, itens, frentes: b.data || [], colab: c.data || [] }; render();
  }
  const rotuloTipo = (it) => it.origem === "registro" ? (TIPO[it.tipo] || it.tipo) : it.origem === "tarefa" ? (TIPO_TAREFA[it.tipo] || "Tarefa") : it.origem === "negociacao" ? "Negociação" : ORIGEM[it.origem] || it.origem;
  function definirResp(c, frente, atual, colab) {
    const s = sel({ "": "— padrão (quem é da frente) —", ...Object.fromEntries(colab.filter((x) => x.ativo !== false).map((x) => [x.id, x.nome + (x.frente ? " · " + FRENTES[x.frente].split(" /")[0] : "")])) }, atual || "");
    modal("Responsável · " + FRENTES[frente], el("div", { class: "form" }, el("div", { class: "f full note" }, "Só preencha quando este cliente fugir da regra. Em branco, vale a frente de cada pessoa no cadastro de colaboradores."), field("rf", "Responsável neste cliente", s)), async () => {
      const col = { estrategico: "resp_estrategico_id", juridico: "resp_juridico_id", negocial: "resp_negocial_id" }[frente];
      const { error } = await SB.from("clientes").update({ [col]: s.value || null }).eq("id", c.id); if (error) throw new Error(error.message); c[col] = s.value || null; toast("Salvo"); invalidar(c.id); render();
    });
  }
  // ---------- exportar linha do tempo ----------
  function exportarCSV(c, itens) {
    const cols = ["quando", "frente", "origem", "tipo", "autor", "numero_cnj", "texto", "visivel_cliente"]; const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const txt = [cols.join(";"), ...itens.map((i) => cols.map((k) => esc(k === "quando" ? fmtDH(i.quando) : k === "frente" ? (FRENTES[i.frente] || "") : k === "tipo" ? rotuloTipo(i) : i[k])).join(";"))].join("\n");
    const u = URL.createObjectURL(new Blob(["\ufeff" + txt], { type: "text/csv;charset=utf-8" })); const a = el("a", { href: u, download: `dossie_${(c.nome || c.id).replace(/\W+/g, "_")}.csv` }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  }
  function exportarPDF(c, itens, fl) {
    const e = (s) => String(s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
    const linhas = itens.map((i) => `<tr><td class=d>${fmtDH(i.quando)}</td><td>${e(i.frente ? FRENTES[i.frente].split(" /")[0] : "—")}</td><td>${e(rotuloTipo(i))}${i.numero_cnj ? `<div class=n>${e(i.numero_cnj)}</div>` : ""}</td><td class=t>${e(i.texto)}</td><td class=n>${e(i.autor || "")}</td></tr>`).join("");
    const html = `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><title>Dossiê — ${e(c.nome)}</title><style>body{font-family:Georgia,serif;color:#0C1F38;margin:28px 36px;font-size:12.5px}.cab{display:flex;justify-content:space-between;border-bottom:2px solid #B8964A;padding-bottom:10px;margin-bottom:16px}.marca{font-weight:700;letter-spacing:.04em}.marca small{display:block;font-family:Arial,sans-serif;font-weight:400;font-size:11px;color:#555}h1{font-size:18px;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px}th{text-align:left;background:#0C1F38;color:#fff;padding:6px 8px}td{padding:6px 8px;border-bottom:1px solid #e4e4e4;vertical-align:top}.d{white-space:nowrap}.t{white-space:pre-wrap;max-width:420px}.n{color:#666;font-size:10.5px}@media print{body{margin:14mm 12mm}}</style></head><body><div class=cab><div class=marca>NEVES PÁDUA ADVOCACIA<small>OAB/SP 488.803 · Dossiê do cliente${fl && FRENTES[fl] ? " · " + FRENTES[fl] : ""}</small></div><div style="text-align:right;font-family:Arial,sans-serif;font-size:11px"><b>${e(c.nome)}</b><br>Emitido em ${new Date().toLocaleDateString("pt-BR")} · ${itens.length} registro(s)</div></div><h1>Linha do tempo</h1><table><thead><tr><th>Quando</th><th>Frente</th><th>Tipo</th><th>Registro</th><th>Quem</th></tr></thead><tbody>${linhas}</tbody></table><script>setTimeout(()=>window.print(),400)</script></body></html>`;
    const w = window.open("", "_blank"); if (!w) { toast("Permita pop-ups para gerar o PDF"); return; } w.document.write(html); w.document.close();
  }
  /* ---------- V3.1 (entrega V4): mesma leitura, mesmos filtros e ações; régua nas frentes, passos na linha do tempo ---------- */
  const v3 = () => document.documentElement.classList.contains("np-casca-v3") && !!window.NPUI;
  const pad = (n) => String(n).padStart(2, "0");
  const diaLocal = (ts) => { const d = new Date(ts); return isNaN(d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const nomeFrente = (k) => (FRENTES[k] || "").split(" /")[0] || "Sem frente";
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  function cardDossieV3(c) {
    const st = D.cache[c.id]; if (!st) carregar(c.id);
    const box = el("section", { class: "card section np-dossie", "aria-busy": st && st.ok ? null : "true" });
    box.append(el("div", { class: "section-h" }, el("div", {}, el("h2", {}, "Dossiê"), el("div", { class: "note" }, "O que o escritório sabe e faz por este cliente, nas três frentes. Andamentos e publicações ficam na página de cada processo.")),
      el("div", { class: "actions edit-only" }, NPUI.btn("Registrar", { onclick: () => window.PP_CARTEIRA?.registrar(c.id, {}) }))));
    if (!st || !st.ok) { box.append(NPUI.carregando(4)); return box; }
    // informações relevantes (fixadas): régua de tinta = o que o escritório marcou como essencial
    const fix = st.itens.filter((i) => i.fixado);
    box.append(NPUI.secao("Informações relevantes", fix.length
      ? el("ul", { class: "np-dossie-fix" }, ...fix.map((i) => el("li", {}, el("p", {}, i.texto), el("small", {}, [i.autor, fmtD(i.quando)].filter(Boolean).join(" · ")))))
      : el("p", { class: "note" }, "Nada fixado. Ao registrar uma “Informação do cliente”, marque “Fixar no perfil”.")));
    // três frentes: a régua diz o estado (prazo vencido ou frente parada = atrasada; prazo em até 7 dias = atenção)
    const porF = Object.fromEntries(st.frentes.map((f) => [f.frente, f]));
    const frentes = el("div", { class: "np-dossie-frentes", role: "list", "aria-label": "Frentes do cliente" });
    for (const [k, nome] of Object.entries(FRENTES)) {
      const f = porF[k] || {}; const resp = f.responsavel_id ? st.colab.find((x) => x.id === f.responsavel_id)?.nome : null;
      const padrao = st.colab.filter((x) => x.frente === k && x.ativo !== false).map((x) => NPUI.curto(x.nome));
      const d = dias(f.ultimo_em); const p = f.proximo_prazo ? NPUI.prazoTxt(f.proximo_prazo) : null;
      const regua = p && p.dias < 0 ? "late" : d != null && d > 30 ? "late" : p && p.dias <= 7 ? "att" : null;
      const mk = [
        p ? NPUI.marca((p.dias < 0 ? "prazo venceu " : "próximo prazo ") + (p.dias === 0 ? "hoje" : p.rel), p.dias < 0 ? "late" : p.dias <= 7 ? "att" : "") : null,
        +f.tarefas_abertas ? NPUI.marca(plural(+f.tarefas_abertas, "tarefa aberta", "tarefas abertas")) : null,
        k === "juridico" && +f.processos_ativos ? NPUI.marca(plural(+f.processos_ativos, "processo", "processos")) : null,
        k === "negocial" && +f.negociacoes_abertas ? NPUI.marca(plural(+f.negociacoes_abertas, "negociação", "negociações")) : null,
        d != null && d > 30 ? NPUI.marca(`parada há ${d} dias`, "late") : null].filter(Boolean);
      const respTxt = resp ? NPUI.curto(resp) : padrao.length ? padrao.join(", ") : "sem responsável";
      frentes.append(el("div", { class: "np-dossie-frente" + (regua ? " r-" + regua : ""), role: "listitem" },
        el("div", { class: "cab" }, el("h3", {}, nome),
          el("button", { type: "button", class: "np-btn ghost edit-only np-dossie-resp", title: "Responsável por esta frente neste cliente", "aria-label": `Responsável pela frente ${nomeFrente(k)}: ${respTxt}. Alterar`, onclick: () => definirResp(c, k, f.responsavel_id, st.colab) }, respTxt)),
        el("p", { class: "ult" }, f.ultimo_em ? [el("span", { class: "q", title: fmtDH(f.ultimo_em) }, d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`), f.ultimo_autor ? " · " + f.ultimo_autor : ""] : "Sem registro nesta frente"),
        f.ultimo_texto ? el("p", { class: "txt" }, f.ultimo_texto) : null,
        mk.length ? el("p", { class: "mk" }, ...mk) : null,
        el("div", { class: "pe edit-only" }, NPUI.btn("Registrar aqui", { variante: "ghost", onclick: () => window.PP_CARTEIRA?.registrar(c.id, { frente: k }) }))));
    }
    box.append(frentes);
    // linha do tempo: filtros cumulativos de frente (chips), origem, ordem, exportar, 20 por página
    const F = D.filtro[c.id] = D.filtro[c.id] && typeof D.filtro[c.id] === "object" ? D.filtro[c.id] : { frentes: new Set(), origem: "", ordem: "recente", pagina: 1 };
    const cont = Object.fromEntries(Object.keys(FRENTES).map((k) => [k, st.itens.filter((i) => i.frente === k).length]));
    const chips = el("div", { class: "np-filtros", role: "group", "aria-label": "Frentes" }, ...Object.keys(FRENTES).map((k) => NPUI.chip({ label: nomeFrente(k), n: cont[k], on: F.frentes.has(k), grupo: "frente", title: "Combine frentes", onclick: () => { if (F.frentes.has(k)) F.frentes.delete(k); else F.frentes.add(k); F.pagina = 1; render(); } })));
    const fo = sel({ "": "Tudo", "__reg": "Só registros manuais", "__tar": "Só tarefas", "__anexo": "Só com anexo", "__cli": "Só o que o cliente vê" }, F.origem); fo.onchange = () => { F.origem = fo.value; F.pagina = 1; render(); }; fo.setAttribute("aria-label", "Origem");
    const ord = sel({ recente: "Mais recentes primeiro", antiga: "Mais antigos primeiro", frente: "Por frente, depois data", tipo: "Por tipo, depois data", autor: "Por quem registrou" }, F.ordem); ord.onchange = () => { F.ordem = ord.value; F.pagina = 1; render(); }; ord.setAttribute("aria-label", "Ordem");
    const cliG = (S.clientes || []).find((x) => x.id === c.id); const grupoNome = (cliG?.grupo || "").trim();
    const gChk = grupoNome ? el("label", { class: "np-dossie-grupo" }, (() => { const i = el("input", { type: "checkbox" }); i.checked = !!D.grupo?.[c.id]; i.onchange = () => { D.grupo = D.grupo || {}; D.grupo[c.id] = i.checked; invalidar(c.id); render(); }; return i; })(), "Incluir as empresas do grupo “" + grupoNome + "”") : null;
    let itens = st.itens.filter((i) => !F.frentes.size || F.frentes.has(i.frente));
    itens = itens.filter((i) => F.origem === "__reg" ? i.origem === "registro" : F.origem === "__tar" ? i.origem === "tarefa" : F.origem === "__anexo" ? (i.anexos && i.anexos.length) || i.tem_anexo : F.origem === "__cli" ? i.visivel_cliente : true);
    const cmpQ = (a, b) => String(b.quando).localeCompare(String(a.quando));
    itens = [...itens].sort(F.ordem === "antiga" ? (a, b) => -cmpQ(a, b) : F.ordem === "frente" ? (a, b) => String(a.frente || "z").localeCompare(String(b.frente || "z")) || cmpQ(a, b) : F.ordem === "tipo" ? (a, b) => rotuloTipo(a).localeCompare(rotuloTipo(b)) || cmpQ(a, b) : F.ordem === "autor" ? (a, b) => String(a.autor || "z").localeCompare(String(b.autor || "z")) || cmpQ(a, b) : cmpQ);
    const POR = 20, total = itens.length, paginas = Math.max(1, Math.ceil(total / POR)); if (F.pagina > paginas) F.pagina = paginas; const ini = (F.pagina - 1) * POR; const pag = itens.slice(ini, ini + POR);
    const filtrado = F.frentes.size || F.origem;
    const lista = el("ol", { class: "np-dossie-tl" }, ...pag.map((i) => {
      const sistema = i.origem !== "registro"; const q = NPUI.prazoTxt(diaLocal(i.quando));
      const meta = [nomeFrente(i.frente), rotuloTipo(i), i.autor].filter(Boolean).join(" · ");
      return el("li", { class: sistema ? "sis" : "reg" },
        el("time", { datetime: i.quando, title: fmtDH(i.quando) }, el("b", {}, q.curta), el("span", {}, q.dias === 0 ? "hoje" : q.dias === -1 ? "ontem" : q.rel)),
        el("div", { class: "c" },
          el("p", { class: "m" }, meta, i.outra_empresa ? [" · ", el("span", { class: "emp" }, i.outra_empresa)] : null,
            i.numero_cnj ? [" · ", el("button", { type: "button", class: "lnk", onclick: () => { S.sub = "processos"; render(); } }, i.numero_cnj)] : null,
            i.fixado ? [" ", NPUI.marca("fixado")] : null, i.visivel_cliente ? [" ", NPUI.marca("cliente vê", "info")] : null),
          el("p", { class: "t" }, i.texto),
          i.tarefa_id && sistema ? el("button", { type: "button", class: "lnk", onclick: () => window.PP_TAREFAS?.abrir(i.tarefa_id) }, "Abrir tarefa") : null));
    }));
    const pager = paginas > 1 ? el("nav", { class: "np-dossie-pag", "aria-label": "Páginas da linha do tempo" },
      NPUI.btn("Anterior", { variante: "ghost", disabled: F.pagina <= 1, onclick: () => { F.pagina--; render(); } }),
      ...Array.from({ length: paginas }, (_, k) => k + 1).filter((n) => n === 1 || n === paginas || Math.abs(n - F.pagina) <= 2).reduce((acc, n, idx, arr) => { if (idx && n - arr[idx - 1] > 1) acc.push(el("span", { class: "reti", "aria-hidden": "true" }, "…")); const b = NPUI.btn(String(n), { variante: "ghost", onclick: () => { F.pagina = n; render(); } }); if (n === F.pagina) b.setAttribute("aria-current", "page"); b.setAttribute("aria-label", "Página " + n); acc.push(b); return acc; }, []),
      NPUI.btn("Próxima", { variante: "ghost", disabled: F.pagina >= paginas, onclick: () => { F.pagina++; render(); } }),
      el("span", { class: "note" }, `${ini + 1}–${Math.min(ini + POR, total)} de ${total}`)) : null;
    const itensF = itens;
    box.append(el("div", { class: "np-dossie-linha" },
      el("div", { class: "np-dossie-tlh" }, el("h3", {}, "Linha do tempo ", el("span", { class: "n" }, String(total))),
        el("div", { class: "fer" }, gChk, fo, ord, NPUI.btn("CSV", { variante: "ghost", title: "Exportar a linha do tempo filtrada (CSV)", onclick: () => exportarCSV(c, itensF) }), NPUI.btn("PDF", { variante: "ghost", title: "Gerar PDF da linha do tempo filtrada", onclick: () => exportarPDF(c, itensF, [...F.frentes].join(",")) }))),
      chips,
      total ? lista : filtrado ? NPUI.vazio({ titulo: "Nada com esses filtros", texto: "Tire um filtro para ver a linha do tempo inteira.", acao: "Limpar filtros", onAcao: () => { F.frentes.clear(); F.origem = ""; F.pagina = 1; render(); } })
        : NPUI.vazio({ titulo: "Nenhum registro ainda", texto: "Use “Registrar” para contar o que foi feito com este cliente." }),
      pager));
    return box;
  }
  function cardDossie(c) {
    if (v3()) return cardDossieV3(c);
    const st = D.cache[c.id]; if (!st) { carregar(c.id); }
    const box = el("section", { class: "card section", style: "display:flex;flex-direction:column;gap:12px" });
    box.append(el("div", { class: "section-h" }, el("div", {}, el("h2", {}, "Dossiê"), el("div", { class: "note" }, "O que o escritório sabe e faz por este cliente, nas três frentes. Andamentos e publicações ficam na página de cada processo.")), el("div", { class: "actions edit-only" }, el("button", { class: "btn sm primary", onclick: () => window.PP_CARTEIRA?.registrar(c.id, {}) }, "+ Registrar"))));
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
    // filtro combinável de frentes + origem, ordenação e paginação de 20 em 20
    const F = D.filtro[c.id] = D.filtro[c.id] || { frentes: new Set(), origem: "", ordem: "recente", pagina: 1 }; if (typeof F === "string") { D.filtro[c.id] = { frentes: new Set(), origem: "", ordem: "recente", pagina: 1 }; return cardDossie(c); }
    const chip = (k, l, cls) => el("button", { class: "pill " + (F.frentes.has(k) ? cls : ""), style: "cursor:pointer;border:1px solid var(--line)" + (F.frentes.has(k) ? "" : ";background:transparent;color:var(--muted)"), title: "Clique para combinar frentes", onclick: () => { if (F.frentes.has(k)) F.frentes.delete(k); else F.frentes.add(k); F.pagina = 1; render(); } }, l);
    const chips = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" }, el("span", { class: "note" }, "Frentes:"), ...Object.entries(FRENTES).map(([k, nome]) => chip(k, nome.split(" /")[0], k === "juridico" ? "e3" : k === "negocial" ? "e2" : "c")), F.frentes.size ? el("button", { class: "btn sm", onclick: () => { F.frentes.clear(); F.pagina = 1; render(); } }, "limpar") : null);
    const fo = sel({ "": "Tudo", "__reg": "Só registros manuais", "__tar": "Só tarefas", "__anexo": "Só com anexo", "__cli": "Só o que o cliente vê" }, F.origem); fo.onchange = () => { F.origem = fo.value; F.pagina = 1; render(); };
    const cliG = (S.clientes || []).find((x) => x.id === c.id); const grupoNome = (cliG?.grupo || "").trim();
    const gChk = grupoNome ? el("label", { style: "display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer" }, (() => { const i = el("input", { type: "checkbox", style: "width:15px;height:15px;margin:0;accent-color:var(--gold)" }); i.checked = !!D.grupo?.[c.id]; i.onchange = () => { D.grupo = D.grupo || {}; D.grupo[c.id] = i.checked; invalidar(c.id); }; return i; })(), "Incluir empresas do grupo “" + grupoNome + "”") : null;
    const ord = sel({ recente: "Mais recentes primeiro", antiga: "Mais antigos primeiro", frente: "Por frente, depois data", tipo: "Por tipo, depois data", autor: "Por quem registrou" }, F.ordem); ord.onchange = () => { F.ordem = ord.value; F.pagina = 1; render(); };
    let itens = st.itens.filter((i) => !F.frentes.size || F.frentes.has(i.frente));
    itens = itens.filter((i) => F.origem === "__reg" ? i.origem === "registro" : F.origem === "__tar" ? i.origem === "tarefa" : F.origem === "__anexo" ? (i.anexos && i.anexos.length) || i.tem_anexo : F.origem === "__cli" ? i.visivel_cliente : true);
    const cmpQ = (a, b) => String(b.quando).localeCompare(String(a.quando));
    itens = [...itens].sort(F.ordem === "antiga" ? (a, b) => -cmpQ(a, b) : F.ordem === "frente" ? (a, b) => String(a.frente || "z").localeCompare(String(b.frente || "z")) || cmpQ(a, b) : F.ordem === "tipo" ? (a, b) => rotuloTipo(a).localeCompare(rotuloTipo(b)) || cmpQ(a, b) : F.ordem === "autor" ? (a, b) => String(a.autor || "z").localeCompare(String(b.autor || "z")) || cmpQ(a, b) : cmpQ);
    const POR = 20, total = itens.length, paginas = Math.max(1, Math.ceil(total / POR)); if (F.pagina > paginas) F.pagina = paginas; const ini = (F.pagina - 1) * POR; const pag = itens.slice(ini, ini + POR);
    const lista = el("ul", { class: "tl", style: "margin-top:6px" }, ...pag.map((i) => el("li", { class: i.origem === "registro" ? "" : "ev-sistema" }, el("div", { class: "d" }, fmtDH(i.quando), " · ", el("span", { class: "pill " + (i.frente === "juridico" ? "e3" : i.frente === "negocial" ? "e2" : "c"), style: "margin:0 4px" }, i.frente ? FRENTES[i.frente].split(" /")[0] : "—"), i.outra_empresa ? el("span", { class: "pill e1", style: "margin-right:4px" }, i.outra_empresa) : null, rotuloTipo(i), i.autor ? " · " + i.autor : "", i.numero_cnj ? el("a", { href: "#processos", style: "margin-left:6px", onclick: (e) => { e.preventDefault(); S.sub = "processos"; render(); } }, i.numero_cnj) : null),
      el("div", { style: "white-space:pre-wrap;font-size:13.5px" + (i.origem === "registro" ? ";padding:6px 10px;background:var(--surface-2);border-radius:8px;margin-top:2px" : "") }, i.texto),
      i.tarefa_id && i.origem !== "registro" ? el("div", { class: "actions", style: "justify-content:flex-start;margin-top:2px" }, el("button", { class: "btn sm", onclick: () => window.PP_TAREFAS?.abrir(i.tarefa_id) }, "Abrir tarefa")) : null)));
    const pager = paginas > 1 ? el("div", { style: "display:flex;gap:6px;align-items:center;justify-content:center;margin-top:10px;flex-wrap:wrap" }, el("button", { class: "btn sm", disabled: F.pagina <= 1 ? "" : null, onclick: () => { F.pagina--; render(); } }, "‹ Anterior"),
      ...Array.from({ length: paginas }, (_, k) => k + 1).filter((n) => n === 1 || n === paginas || Math.abs(n - F.pagina) <= 2).reduce((acc, n, idx, arr) => { if (idx && n - arr[idx - 1] > 1) acc.push(el("span", { class: "note" }, "…")); acc.push(el("button", { class: "btn sm" + (n === F.pagina ? " primary" : ""), onclick: () => { F.pagina = n; render(); } }, String(n))); return acc; }, []),
      el("button", { class: "btn sm", disabled: F.pagina >= paginas ? "" : null, onclick: () => { F.pagina++; render(); } }, "Próxima ›"), el("span", { class: "note", style: "margin-left:8px" }, `${ini + 1}–${Math.min(ini + POR, total)} de ${total}`)) : null;
    const itensF = itens;
    box.append(el("div", {}, el("div", { class: "section-h", style: "flex-wrap:wrap;gap:8px" }, el("h3", { style: "margin:0;font-size:15px" }, `Linha do tempo (${total})`), el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, gChk, fo, ord, el("button", { class: "btn sm", onclick: () => exportarCSV(c, itensF) }, "CSV"), el("button", { class: "btn sm", onclick: () => exportarPDF(c, itensF, [...F.frentes].join(",")) }, "PDF"))), chips, total ? lista : el("div", { class: "empty" }, "Nada com este filtro."), pager));
    return box;
  }
  { const _r = window.PP_MOD?.resumo; if (window.PP_MOD) window.PP_MOD.resumo = (c, host, ind) => { if (S.sub === "cliente" || S.sub === "financeiro") { _r && _r(c, host, ind); return; } if (typeof equipe === "function" && equipe() && !(typeof readOnly === "function" && readOnly())) host.append(cardDossie(c)); _r && _r(c, host, ind); }; }
  window.PP_DOSSIE = { invalidar, FRENTES };
  window.__PP_LOGIN?.then(() => { if (typeof equipe === "function" && equipe()) { const ch = SB.channel("dossie"); for (const t of ["entradas_timeline", "andamentos", "tarefas", "negociacoes"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (m) => { const cid = m.new?.cliente_id || m.old?.cliente_id; if (cid) invalidar(cid); else invalidar(); if (S.tab === "clientes") render(); }); ch.subscribe(); } });
})();
