/* Ficha de pessoa física — aba Cadastro. Mostra os dados pessoais (clientes.dados.pf) e, para quem veio do ADVBox, os
   atendimentos que não têm processo judicial (negociação, administrativo, consultoria: clientes.dados.advbox.atendimentos).
   Só leitura: não grava nada. Aparece para pessoa física que tenha esses dados; nos demais clientes nada muda. */
(() => {
  "use strict";
  const dBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : null; };
  const vazio = () => el("span", { style: "color:var(--faint)" }, "—");
  const campo = (rotulo, valor) => el("div", { style: "display:flex;flex-direction:column;gap:2px;min-width:0" },
    el("span", { style: "font-size:12px;color:var(--muted)" }, rotulo),
    el("span", { style: "overflow-wrap:anywhere" }, valor || vazio()));
  const grade = (...filhos) => el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px 20px" }, ...filhos);

  function dadosPessoais(c) {
    const p = c.pf || {};
    const doc = c.cnpj ? (typeof fmtDoc === "function" ? fmtDoc(c.cnpj) : c.cnpj) : null;
    const cidade = c.cidade ? c.cidade + (c.uf ? "/" + c.uf : "") : (c.uf || null);
    return el("section", { class: "card section", "data-np-pf": "dados" },
      el("div", { class: "section-h" }, el("h2", {}, "Dados pessoais")),
      grade(
        campo("Nome", c.nome), campo("CPF", doc), campo("RG", p.rg), campo("Nascimento", dBR(p.nascimento)),
        campo("Estado civil", p.estado_civil), campo("Profissão", p.profissao),
        campo("Celular", c.telefone), campo("Telefone fixo", p.telefone_fixo), campo("E-mail", c.email),
        campo("Endereço", c.endereco), campo("Cidade", cidade), campo("CEP", c.cep),
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

  const _r = window.PP_MOD?.resumo;
  if (window.PP_MOD) window.PP_MOD.resumo = (c, host, ind) => {
    _r && _r(c, host, ind);
    try {
      if (S.sub !== "cliente" || !c || c.tipo_pessoa !== "PF" || !(c.pf || c.advbox)) return;
      if (typeof readOnly === "function" && readOnly()) return;
      const at = atendimentos(c);
      host.prepend(...[dadosPessoais(c), at].filter(Boolean));
    } catch (e) { console.warn("ficha-pf:", e); }
  };
  window.PP_FICHA_PF = { dadosPessoais, atendimentos };
})();
