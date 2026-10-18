// Geração de documentos do fechamento (.docx) a partir dos modelos do escritório (bucket "modelos"):
// contrato de honorários (GP) e procurações (PJ + representante). Usa docxtemplater + pizzip (CDN) só quando chamado.
// Expõe window.PP_DOCXGEN = { extensoReais, dadosDocumentos, gerar }.
(() => {
  const U = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const ate999 = (n) => {
    if (n === 0) return "";
    if (n === 100) return "cem";
    const c = Math.floor(n / 100), r = n % 100, d = Math.floor(r / 10), u = r % 10;
    const partes = [];
    if (c) partes.push(C[c]);
    if (r < 20) { if (r) partes.push(U[r]); } else { partes.push(D[d] + (u ? " e " + U[u] : "")); }
    return partes.join(" e ");
  };
  // número inteiro por extenso (até bilhões), em português
  const extensoNumero = (valor) => {
    let n = Math.floor(Math.abs(valor));
    if (n === 0) return "zero";
    const grupos = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
    const partes = [];
    let i = 0;
    while (n > 0 && i < grupos.length) {
      const g = n % 1000;
      if (g) {
        const t = i === 1 && g === 1 ? "" : ate999(g);
        const nome = grupos[i][g === 1 ? 0 : 1];
        partes.unshift((t ? t + " " : "") + nome);
      }
      n = Math.floor(n / 1000); i++;
    }
    // "e" antes do último grupo quando ele é < 100 ou múltiplo de 100 (ex.: "mil e duzentos", "um milhão e cem")
    const ultimoGrupo = Math.floor(Math.abs(valor)) % 1000;
    let s = partes.join(", ");
    if (partes.length > 1 && ultimoGrupo && (ultimoGrupo < 100 || ultimoGrupo % 100 === 0)) {
      s = partes.slice(0, -1).join(", ") + " e " + partes[partes.length - 1];
    }
    return s.replace(/\s+/g, " ").trim();
  };
  const BRLf = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // "R$ 1.350,00 (um mil, trezentos e cinquenta reais)"
  const extensoReais = (v) => {
    v = Math.round(Number(v || 0) * 100) / 100;
    const reais = Math.floor(v), cent = Math.round((v - reais) * 100);
    let ext = reais ? extensoNumero(reais) + (reais === 1 ? " real" : " reais") : "";
    if (reais >= 1e6 && reais % 1e6 === 0) ext = ext.replace(/(milhão|milhões|bilhão|bilhões) reais$/, "$1 de reais");
    if (cent) ext += (ext ? " e " : "") + extensoNumero(cent) + (cent === 1 ? " centavo" : " centavos");
    return `${BRLf(v)} (${ext || "zero reais"})`;
  };
  const ordinalDia = (d) => `${d} (${extensoNumero(d)})`;
  const pctExt = (p) => { p = Number(p || 0); const s = String(p).replace(".", ","); return `${s}% (${extensoNumero(Math.floor(p))}${p % 1 ? " vírgula " + extensoNumero(Math.round((p % 1) * 10)) : ""} por cento)`; };
  const dataExt = (iso) => { const d = iso ? new Date(iso + "T12:00:00") : new Date(); const m = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]; return `${d.getDate()} de ${m[d.getMonth()]} de ${d.getFullYear()}`; };
  const PRODUTO_NOME = { giro: "capital de giro", pronampe: "Pronampe", cheque_especial: "cheque especial", cartao: "cartão de crédito", financiamento: "financiamento", conta_garantida: "conta garantida", antecipacao: "antecipação de recebíveis", consignado: "consignado", fgi: "FGI", outro: "" };
  const TITULAR_NOME = { PJ: "Pessoa Jurídica", PF: "Pessoa Física", ambos: "Pessoa Jurídica e Pessoa Física" };

  // Monta os campos dos modelos a partir do fechamento (fechamentos.dados) e do cliente.
  // f = {empresa:{...}, representante:{...}, dividas:[...], honorarios:{...}, condicoes:{...}}
  const dadosDocumentos = (f, extra = {}) => {
    const E = f.empresa || {}, R = f.representante || {}, H = f.honorarios || {}, Cn = f.condicoes || {};
    const pj = (E.tipo_pessoa || "PJ") !== "PF";
    const entrada = Number(H.entrada || 0), parcelas = Number(H.parcelas || 0), vParcela = Number(H.valor_parcela || 0);
    const remanescente = parcelas * vParcela, total = entrada + remanescente;
    const exito = Number(H.exito_pct || 0), mensalidade = Number(H.mensalidade || 0), dia = Number(H.vencimento_dia || 10);
    // dívidas agrupadas por banco (valor somado; produtos listados)
    const porBanco = {};
    for (const d of f.dividas || []) {
      const b = (d.banco || "Banco").trim();
      const g = porBanco[b] = porBanco[b] || { banco: b, valor: 0, produtos: new Set(), titulares: new Set() };
      g.valor += Number(d.saldo_atual || d.valor_original || 0);
      if (PRODUTO_NOME[d.produto]) g.produtos.add(PRODUTO_NOME[d.produto]);
      if (d.titular) g.titulares.add(d.titular);
    }
    const dividas = Object.values(porBanco).map((g) => {
      const prods = [...g.produtos].map((p, i) => i ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(", ");
      const tit = g.titulares.has("ambos") || (g.titulares.has("PJ") && g.titulares.has("PF")) ? TITULAR_NOME.ambos : g.titulares.has("PF") ? TITULAR_NOME.PF : g.titulares.size ? TITULAR_NOME.PJ : "";
      return { banco: g.banco, valor_ext: extensoReais(g.valor), descricao: [prods, tit].filter(Boolean).join(" – ") };
    });
    const endereco = [E.endereco, E.bairro].filter(Boolean).join(", ");
    return {
      pj, pf: !pj,
      empresa: (E.nome || "").trim(), cnpj: E.cnpj || "", endereco, cep: E.cep || "", cidade: E.cidade || "", uf: E.uf || "",
      cargo: R.cargo || "sócio(a) administrador(a)", representante: (R.nome || "").trim(),
      qualificacao: R.qualificacao || "brasileiro(a), empresário(a)", cpf: R.cpf || "", rg: R.rg || "",
      rep_endereco: R.endereco || endereco, rep_cep: R.cep || E.cep || "", rep_cidade: R.cidade || E.cidade || "", rep_uf: R.uf || E.uf || "", rep_email: R.email || "",
      dividas,
      total_ext: extensoReais(total), exito: exito > 0, exito_ext: pctExt(exito),
      entrada_ext: extensoReais(entrada), prazo_entrada: H.prazo_entrada || "12 (doze) horas",
      parcelado: parcelas > 0, remanescente_ext: extensoReais(remanescente), parcelas_ext: `${parcelas} (${extensoNumero(parcelas)})`,
      parcela_ext: extensoReais(vParcela), dia_ext: ordinalDia(dia),
      mensalidade: mensalidade > 0, mensalidade_ext: extensoReais(mensalidade),
      data_ext: dataExt(Cn.data_fechamento), ...extra,
    };
  };

  let libs;
  const carregarLibs = async () => {
    if (libs) return libs;
    const add = (src) => new Promise((ok, err) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => err(new Error("Falha ao carregar " + src)); document.head.appendChild(s); });
    if (!window.PizZip) await add("https://cdnjs.cloudflare.com/ajax/libs/pizzip/3.1.7/pizzip.min.js");
    if (!window.docxtemplater) await add("https://cdnjs.cloudflare.com/ajax/libs/docxtemplater/3.50.0/docxtemplater.js");
    return (libs = { PizZip: window.PizZip, Docxtemplater: window.docxtemplater });
  };
  // gera o .docx (Blob) a partir do modelo (ArrayBuffer) e dos dados
  const gerar = async (modeloArrayBuffer, dados) => {
    const { PizZip, Docxtemplater } = await carregarLibs();
    const zip = new PizZip(modeloArrayBuffer);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
    doc.render(dados);
    return doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  };
  const api = { extensoReais, extensoNumero, dadosDocumentos, gerar };
  if (typeof window !== "undefined") window.PP_DOCXGEN = api;
  if (typeof module !== "undefined") module.exports = api;
})();
