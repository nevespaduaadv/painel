/* Ficha de pessoa física — aba Cadastro. Mostra os dados pessoais (colunas do cliente + clientes.dados.pf), permite editá-los e,
   para quem veio do ADVBox, lista os atendimentos sem processo judicial (clientes.dados.advbox.atendimentos, só leitura).
   Em pessoa física, tira da tela o que só faz sentido para empresa: linhas repetidas ou de PJ na qualificação (razão social,
   representante legal, grupo econômico, endereço), o título "Sócios e contatos" vira "Contatos" e o bloco de contexto empresarial some
   quando está vazio. Nos demais clientes nada muda. */
(() => {
  "use strict";
  const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
  const dBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : null; };
  const dig = (s) => String(s || "").replace(/\D/g, "");
  const cpfValido = (c) => { const d = dig(c); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false; for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); if (((s * 10) % 11) % 10 !== +d[n]) return false; } return true; };
  const cpfMasc = (c) => { const d = dig(c); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(c || "").trim(); };
  const vazio = () => el("span", { style: "color:var(--faint)" }, "—");
  const campo = (rotulo, valor) => el("div", { style: "display:flex;flex-direction:column;gap:2px;min-width:0" },
    el("span", { style: "font-size:12px;color:var(--muted)" }, rotulo),
    el("span", { style: "overflow-wrap:anywhere" }, valor || vazio()));
  const grade = (...filhos) => el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px 20px" }, ...filhos);

  function editar(c) {
    const p = c.pf || {}, t = (v) => inp("text", v || "");
    const nome = t(c.nome), cpf = t(c.cnpj ? cpfMasc(c.cnpj) : ""), rg = t(p.rg), nasc = inp("date", /^\d{4}-\d{2}-\d{2}/.test(p.nascimento || "") ? p.nascimento.slice(0, 10) : ""),
      civil = sel({ "": "—", "Solteiro(a)": "Solteiro(a)", "Casado(a)": "Casado(a)", "União estável": "União estável", "Divorciado(a)": "Divorciado(a)", "Separado(a)": "Separado(a)", "Viúvo(a)": "Viúvo(a)", ...(p.estado_civil ? { [p.estado_civil]: p.estado_civil } : {}) }, p.estado_civil || ""),
      prof = t(p.profissao), cel = t(c.telefone), fixo = t(p.telefone_fixo), email = inp("email", c.email || ""), ender = t(c.endereco), bairro = t(p.bairro), cidade = t(c.cidade),
      uf = sel({ "": "—", ...Object.fromEntries(UFS.map((u) => [u, u])) }, c.uf || ""), cep = t(c.cep);
    const body = el("div", { class: "form" }, field("pf-nome", "Nome completo", nome), field("pf-cpf", "CPF", cpf), field("pf-rg", "RG", rg), field("pf-nasc", "Nascimento", nasc), field("pf-civil", "Estado civil", civil), field("pf-prof", "Profissão", prof),
      field("pf-cel", "Celular / WhatsApp", cel), field("pf-fixo", "Telefone fixo", fixo), field("pf-email", "E-mail", email), field("pf-end", "Endereço (rua e número)", ender), field("pf-bairro", "Bairro", bairro), field("pf-cid", "Cidade", cidade), field("pf-uf", "UF", uf), field("pf-cep", "CEP", cep));
    modal("Dados pessoais", body, async () => {
      const erro = (el0, msg) => { const e = new Error(msg); e.campo = el0; try { el0.focus(); } catch (_) {} return e; };
      if (!nome.value.trim()) throw erro(nome, "Informe o nome");
      const doc = cpf.value.trim(); if (doc && !cpfValido(doc)) throw erro(cpf, "CPF inválido: confira os dígitos");
      const n = (v) => v.trim() || null;
      // lê o jsonb atual e só troca o que o formulário cobre: o que mais existir em dados (advbox, notas, etc.) fica como está
      const { data: cur, error: e0 } = await SB.from("clientes").select("dados,cnpj,cpf_titular").eq("id", c.id).single(); if (e0) throw new Error("Não foi possível ler o cadastro: " + (e0.message || ""));
      const d0 = cur?.dados || {}, docFmt = doc ? cpfMasc(doc) : null;
      const pf = { ...(d0.pf || {}), rg: n(rg.value), nascimento: nasc.value || null, estado_civil: civil.value || null, profissao: n(prof.value), bairro: n(bairro.value), telefone_fixo: n(fixo.value) };
      const cols = { cnpj: docFmt, email: n(email.value), telefone: n(cel.value), endereco: n(ender.value), cidade: n(cidade.value), uf: uf.value || null, cep: n(cep.value) };
      // o CPF do titular acompanha o CPF do cliente quando eram o mesmo (ou estava vazio)
      if (!cur?.cpf_titular || dig(cur.cpf_titular) === dig(cur.cnpj)) cols.cpf_titular = docFmt;
      const { error } = await SB.from("clientes").update({ ...cols, dados: { ...d0, nome: nome.value.trim(), cnpj: docFmt || "", pf } }).eq("id", c.id);
      if (error) throw new Error("Não foi possível salvar: " + (error.message || ""));
      toast("Dados pessoais salvos"); if (typeof notificar === "function") notificar("clientes");
    }, null, { confirmar: "Salvar dados pessoais" });
  }

  function dadosPessoais(c) {
    const p = c.pf || {};
    const doc = c.cnpj ? (typeof fmtDoc === "function" ? fmtDoc(c.cnpj) : c.cnpj) : null;
    const cidade = c.cidade ? c.cidade + (c.uf ? "/" + c.uf : "") : (c.uf || null);
    const btn = window.NPUI?.btn ? window.NPUI.btn("Editar dados pessoais", { onclick: () => editar(c) }) : el("button", { class: "btn sm", onclick: () => editar(c) }, "Editar dados pessoais");
    return el("section", { class: "card section", "data-np-pf": "dados" },
      el("div", { class: "section-h" }, el("h2", {}, "Dados pessoais"), el("span", { class: "edit-only" }, btn)),
      grade(
        campo("Nome", c.nome), campo("CPF", doc), campo("RG", p.rg), campo("Nascimento", dBR(p.nascimento)),
        campo("Estado civil", p.estado_civil), campo("Profissão", p.profissao),
        campo("Celular", c.telefone), campo("Telefone fixo", p.telefone_fixo), campo("E-mail", c.email),
        campo("Endereço", [c.endereco, p.bairro].filter(Boolean).join(" · ") || null), campo("Cidade", cidade), campo("CEP", c.cep),
        campo("Origem", c.origem)
      ));
  }

  function atendimentos(c) {
    const lista = c.advbox?.atendimentos || [];
    if (!lista.length) return null;
    return el("section", { class: "card section", "data-np-pf": "atendimentos" },
      el("div", { class: "section-h" }, el("h2", {}, "Atendimentos sem processo judicial"), el("span", { class: "note" }, `${lista.length} · trazidos do ADVBox`)),
      el("div", { style: "display:flex;flex-direction:column" }, ...lista.map((a, i) => el("div", { style: "padding:10px 0;" + (i ? "border-top:1px solid var(--line)" : "") },
        el("div", { style: "font-weight:600" }, [a.tipo, a.fase].filter(Boolean).join(" · ") || "Atendimento"),
        el("div", { class: "note" }, [a.etapa ? "Etapa: " + a.etapa : null, a.cadastro ? "Aberto em " + dBR(a.cadastro) : null, a.responsavel_advbox ? "Responsável no ADVBox: " + a.responsavel_advbox : null, a.parte_contraria ? "Parte contrária: " + a.parte_contraria : null].filter(Boolean).join(" · ")),
        a.ultimo_andamento ? el("div", { style: "margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere" }, a.ultimo_andamento) : null,
        a.anotacoes ? el("div", { class: "note", style: "margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere" }, a.anotacoes) : null))));
  }

  // tira da ficha (já desenhada) o que é só de empresa ou repete os dados pessoais
  const SO_PJ = new Set(["Razão social / nome", "Endereço completo", "Representante legal", "Grupo econômico"]);
  function enxugar(c, host) {
    for (const dt of host.querySelectorAll(".np-pf-kv > dt")) if (SO_PJ.has(dt.textContent.trim())) dt.parentElement.remove();
    for (const h of host.querySelectorAll("h2")) if (h.textContent.trim() === "Sócios e contatos") h.textContent = "Contatos";
    for (const v of host.querySelectorAll(".np-fc-qual-vazio")) {
      if (v.textContent.trim() === "Nenhum sócio ou contato cadastrado.") v.textContent = "Nenhum contato cadastrado.";
    }
    const temCtx = [c.closer, c.negativado, c.usa_maquininha, c.tem_consorcio, c.outros_cnpjs, c.assuntos_interesse, c.disponibilidade, c.historia, c.situacao_atual, c.observacoes_onboarding].some((v) => v != null && String(v).trim() !== "");
    if (!temCtx) for (const f of host.children) if (!f.hasAttribute("data-np-pf") && /^\s*Contexto empresarial e onboarding/.test(f.textContent || "")) f.remove();
  }

  const _r = window.PP_MOD?.resumo;
  if (window.PP_MOD) window.PP_MOD.resumo = (c, host, ind) => {
    _r && _r(c, host, ind);
    try {
      if (S.sub !== "cliente" || !c || c.tipo_pessoa !== "PF") return;
      if (typeof readOnly === "function" && readOnly()) return;
      enxugar(c, host);
      const at = atendimentos(c);
      host.prepend(...[dadosPessoais(c), at].filter(Boolean));
    } catch (e) { console.warn("ficha-pf:", e); }
  };
  window.PP_FICHA_PF = { dadosPessoais, atendimentos, editar, cpfValido };
})();
