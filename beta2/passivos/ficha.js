/* Ficha do cliente — aba Resumo (identificação, história, situação, sócios/contatos, bens, documentos, indicadores).
   Supabase: colunas de ficha em clientes (0008), contatos, bens, documentos. Carregado depois de carteira.js e tarefas.js. */
(()=>{
"use strict";
const STATUS={prospect:"Prospect",onboarding:"Em onboarding",ativo:"Ativo",encerrado:"Encerrado"};
const PAPEIS={socio:"Sócio(a)",titular:"Titular",avalista:"Avalista",contador:"Contador(a)",financeiro:"Financeiro",conjuge:"Cônjuge",outro:"Outro"};
const TIPOS_BEM={veiculo:"Veículo",imovel:"Imóvel",maquinario:"Maquinário / equipamentos",rebanho:"Rebanho",safra:"Safra",consorcio:"Consórcio",outro:"Outro"};
const TITULARES_BEM={PJ:"Empresa",PF:"Sócio / pessoa física",avalista:"Avalista",terceiro:"Terceiro"};
const TIPOS_DOC={contrato_bancario:"Contrato bancário",contrato_honorarios:"Contrato de honorários",parecer:"Parecer",onboarding:"Onboarding",transcricao:"Transcrição",extrato:"Extrato",cartao_cnpj:"Cartão CNPJ",contrato_social:"Contrato social",procuracao:"Procuração",peticao:"Petição",decisao:"Decisão",acordo:"Acordo",outro:"Outro"};
const ORIGENS=["Meta Ads","Google","Indicação","Orgânico / Instagram","Parceiro","Base antiga","Outro"];
const PLANOS=["Gestão de Passivos Bancários PJ","Superendividamento","Revisional","Defesa em execução","Estruturação societária","Outro"];
const UFS="AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const F={cid:null,carregando:null,contatos:[],bens:[],documentos:[],acessos:[],editaProtecao:null};
const SISTEMAS=["gov.br","e-CAC","Internet banking","Certificado digital","Serasa","Portal do tribunal","Outro"];
const horasFmt=h=>{h=+h||0;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};
const check=(label,checked,help)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;return {wrap:el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},i,label),help?el("div",{class:"help"},help):null),input:i}};
const tri=(v)=>sel({"":"—",true:"Sim",false:"Não"},v==null?"":String(v));
const triVal=(s)=>s.value===""?null:s.value==="true";
const dl=(id,value,opcoes,attrs={})=>{const i=inp("text",value,{list:id+"-dl",...attrs});return {wrap:el("div",{},i,el("datalist",{id:id+"-dl"},opcoes.map(o=>el("option",{value:o})))),input:i}};
const simNao=v=>v==null?"—":v?"Sim":"Não";
const cnpjMask=v=>{const d=(v||"").replace(/\D/g,"");return d.length===14?d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5"):d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"):(v||"")};

async function carregar(cid){
  if(F.carregando===cid)return;F.carregando=cid;
  try{
    if(F.editaProtecao==null&&equipe())SB.rpc("edita_protecao").then(({data})=>{F.editaProtecao=data===true;if(S.tab==="clientes"&&S.sel===cid)render()},()=>{F.editaProtecao=false});
    const [a,b,c,d]=await Promise.all([SB.from("contatos").select("*").eq("cliente_id",cid).order("principal",{ascending:false}).order("nome"),
      equipe()?SB.from("bens").select("*").eq("cliente_id",cid).order("tipo"):{data:[]},
      SB.from("documentos").select("*").eq("cliente_id",cid).order("data",{ascending:false,nullsFirst:false}),
      equipe()?SB.from("v_acessos_sistemas").select("*").eq("cliente_id",cid).order("sistema"):{data:[]}]);
    if(S.sel!==cid)return;
    F.cid=cid;F.contatos=a.data||[];F.bens=b.data||[];F.documentos=c.data||[];F.acessos=d.data||[];
  }catch(e){console.warn("ficha",e)}
  finally{if(F.carregando===cid)F.carregando=null}
  if(S.tab==="clientes"&&S.sel===cid)render();
}
const garantir=c=>{if(F.cid!==c.id&&F.carregando!==c.id)carregar(c.id);return F.cid===c.id};
const recarregar=()=>{if(F.cid){const cid=F.cid;F.cid=null;carregar(cid)}};

const fiV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const STATUS_TOM={ativo:"ok",onboarding:"att",prospect:"info",encerrado:"muted"};
const limparTrecho=s=>String(s||"").replace(/\s+/g," ").replace(/^[,;.\s]+|[,;.\s]+$/g,"");
function montarQualificacao(c){
  if(!c)return "";
  const nome=limparTrecho(c.nome);
  if(!nome)return "";
  const pf=c.tipo_pessoa==="PF"||((!c.tipo_pessoa)&&String(c.cnpj||"").replace(/\D/g,"").length===11);
  const docLimpo=cnpjMask(c.cnpj||c.cpf_titular||c.representante_cpf);
  const endBase=limparTrecho(c.endereco);
  const cidUf=[limparTrecho(c.cidade),limparTrecho(c.uf)].filter(Boolean).join("/");
  let endCompleto=endBase;
  if(cidUf&&(!endBase||!endBase.toLowerCase().includes(limparTrecho(c.cidade).toLowerCase()))){
    endCompleto=[endBase,cidUf].filter(Boolean).join(", ");
  }
  const repNome=limparTrecho(c.representante);
  const repQual=limparTrecho(c.representante_qualificacao);
  const repCpf=cnpjMask(c.representante_cpf||c.cpf_titular);
  const partes=[];
  if(pf){
    partes.push(nome);
    if(repQual)partes.push(repQual);
    if(docLimpo)partes.push("inscrito(a) no CPF sob o nº "+docLimpo);
    if(endCompleto)partes.push("residente e domiciliado(a) em "+endCompleto);
  }else{
    partes.push(nome);
    partes.push("pessoa jurídica de direito privado");
    if(docLimpo)partes.push("inscrita no CNPJ sob o nº "+docLimpo);
    if(endCompleto)partes.push("com sede em "+endCompleto);
    if(repNome){
      const repPartes=["neste ato representada por seu representante legal "+repNome];
      if(repQual)repPartes.push(repQual);
      if(repCpf)repPartes.push("inscrito(a) no CPF sob o nº "+repCpf);
      partes.push(repPartes.join(", "));
    }
  }
  return partes.filter(Boolean).join(", ").replace(/\s+/g," ").trim()+".";
}
function copiarTexto(txt,btn,rotuloOk,msgToast){
  const ok=()=>{
    if(btn){
      btn.dataset.copiado="1";
      const orig=btn.dataset.orig||btn.textContent;
      btn.dataset.orig=orig;
      btn.textContent=rotuloOk||"Copiado";
      clearTimeout(btn._tCopy);
      btn._tCopy=setTimeout(()=>{delete btn.dataset.copiado;btn.textContent=orig},1800);
    }
    toast(msgToast||"Copiado");
  };
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(txt).then(ok).catch(()=>{
      try{const ta=el("textarea",{style:"position:fixed;opacity:0"},txt);document.body.append(ta);ta.select();document.execCommand("copy");ta.remove();ok()}catch(_){toast("Não foi possível copiar")}
    });
  }else{
    try{const ta=el("textarea",{style:"position:fixed;opacity:0"},txt);document.body.append(ta);ta.select();document.execCommand("copy");ta.remove();ok()}catch(_){toast("Não foi possível copiar")}
  }
}
const errCampo=(campo,msg)=>{const e=new Error(msg);e.campo=campo;return e};

/* ---------- Resumo ---------- */
function cardRaioX(c,host,ind){
  if(fiV3()){
    const sec=el("section",{class:"np-fc-sec"},
      el("div",{class:"np-fc-sec-h"},
        el("div",{},el("h2",{},"Dados da empresa"),el("p",{class:"np-fc-sec-sub"},"Resumo operacional do onboarding e R1 para Acordos e Jurídico.")),
        el("div",{class:"np-fc-sec-act edit-only"},NPUI.btn("Editar ficha",{variante:"pri",onclick:()=>openFichaForm(c,"raio")}))
      ),
      el("dl",{class:"np-pf-meta"},
        el("div",{class:"np-pf-kv"},el("dt",{},"Segmento"),el("dd",{},c.segmento||"—")),
        el("div",{class:"np-pf-kv"},el("dt",{},"Faturamento mensal"),el("dd",{},c.faturamento_mensal?BRL(+c.faturamento_mensal):"—")),
        el("div",{class:"np-pf-kv"},el("dt",{},"Funcionários"),el("dd",{},c.funcionarios!=null&&c.funcionarios!==""?String(c.funcionarios):"—")),
        el("div",{class:"np-pf-kv"},el("dt",{},"Reserva acumulada"),el("dd",{},c.reservaAcumulada?BRL(+c.reservaAcumulada):"—")),
        el("div",{class:"np-pf-kv"},el("dt",{},"Pasta no Drive"),el("dd",{},c.pasta_drive_url?el("a",{href:c.pasta_drive_url,target:"_blank",rel:"noopener"},"Abrir pasta ↗"):"—"))
      )
    );
    const flags=[
      c.negativado!=null?NPUI.marca("Negativado: "+(c.negativado?"sim":"não"),c.negativado?"crit":"muted"):null,
      c.usa_maquininha!=null?NPUI.marca("Maquininha: "+(c.usa_maquininha?"sim":"não"),c.usa_maquininha?"info":"muted"):null,
      c.tem_consorcio!=null?NPUI.marca("Consórcio: "+(c.tem_consorcio?"sim":"não"),c.tem_consorcio?"info":"muted"):null,
      c.outros_cnpjs?NPUI.marca("Outros CNPJs: "+c.outros_cnpjs,"muted"):null
    ].filter(Boolean);
    const ctxGrid=el("div",{class:"np-fc-ctx-grid"},
      el("div",{class:"np-fc-ctx-card"},el("h3",{},"O que aconteceu"),el("div",{class:"np-fc-ctx-txt"},c.historia||"Ainda não registrado. Use “Editar ficha” para registrar o histórico do cliente.")),
      el("div",{class:"np-fc-ctx-card"},el("h3",{},"Situação atual"),el("div",{class:"np-fc-ctx-txt"},c.situacao_atual||"Opera? Fatura? Está negativado? Registre na ficha."),
        flags.length?el("div",{class:"np-fc-flags"},...flags):null,
        c.assuntos_interesse?el("div",{class:"np-fc-row-sub"},el("b",{},"Quer discutir: "),c.assuntos_interesse):null,
        c.disponibilidade?el("div",{class:"np-fc-row-sub"},el("b",{},"Disponibilidade: "),c.disponibilidade):null)
    );
    const kpiBand=el("div",{class:"np-gestao-kpi-band"},
      [
        ["Saldo em aberto",BRL(ind.saldoTotal),`${ind.ativos.length} contrato${ind.ativos.length===1?"":"s"} ativo${ind.ativos.length===1?"":"s"}`],
        ["Em negociação",BRL(ind.saldoNeg),"em atraso, com projeção"],
        ["Acordo projetado",BRL(ind.acordoTotal),ind.reservaTotal?`reserva sugerida ${BRL(ind.reservaTotal)}/mês`:""],
        ["Reserva acumulada",BRL(+c.reservaAcumulada||0),"informada pelo cliente"]
      ].map(([l,v,h])=>el("div",{},el("div",{class:"k"},l),el("div",{class:"v"},v),h?el("div",{class:"h"},h):null))
    );
    host.append(sec,ctxGrid,kpiBand);
    return;
  }
  const kv=(k,v)=>el("div",{class:"kv"},el("div",{class:"k"},k),el("div",{class:"v"},v==null||v===""?el("span",{class:"note"},"—"):v));
  const hist=el("section",{class:"card section"},el("h2",{},"O que aconteceu"),c.historia?el("div",{style:"white-space:pre-wrap"},c.historia):el("div",{class:"note"},"Ainda não registrado. Use “Editar ficha” para contar a história do cliente em poucas linhas — o que levou ao endividamento e o que o closer/onboarding captou."));
  const sit=el("section",{class:"card section"},el("h2",{},"Situação atual"),c.situacao_atual?el("div",{style:"white-space:pre-wrap"},c.situacao_atual):el("div",{class:"note"},"Opera? Fatura? Está negativado? Registre aqui."),
    el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},pill("Negativado",c.negativado,"e3"),pill("Maquininha",c.usa_maquininha,"g"),pill("Consórcio",c.tem_consorcio,"g"),c.outros_cnpjs?el("span",{class:"pill g"},"Outros CNPJs: "+c.outros_cnpjs):null),
    c.assuntos_interesse?el("div",{class:"note"},el("b",{},"Quer discutir: "),c.assuntos_interesse):null,c.disponibilidade?el("div",{class:"note"},el("b",{},"Disponibilidade: "),c.disponibilidade):null);
  host.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Dados da empresa"),el("div",{class:"note"},"Fonte: formulário de onboarding + R1. O que Acordos e Jurídico precisam ver de bate-pronto.")),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openFichaForm(c,"raio")},"Editar dados da empresa"))),
    el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"},kv("Segmento",c.segmento),kv("Faturamento mensal",c.faturamento_mensal?BRL(+c.faturamento_mensal):null),kv("Funcionários",c.funcionarios),kv("Reserva acumulada",c.reservaAcumulada?BRL(+c.reservaAcumulada):null),kv("Pasta no Drive",c.pasta_drive_url?el("a",{href:c.pasta_drive_url,target:"_blank",rel:"noopener"},"abrir pasta"):null))));
  host.append(el("div",{class:"row2",style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px"},hist,sit));
  // Indicadores
  host.append(el("div",{class:"kpis"},
    kpi("Saldo em aberto",BRL(ind.saldoTotal),`${ind.ativos.length} contrato${ind.ativos.length===1?"":"s"} ativo${ind.ativos.length===1?"":"s"}`),
    kpi("Em negociação",BRL(ind.saldoNeg),"em atraso, com projeção"),
    kpi("Acordo projetado",BRL(ind.acordoTotal),ind.reservaTotal?`reserva sugerida ${BRL(ind.reservaTotal)}/mês`:""),
    kpi("Reserva acumulada",BRL(+c.reservaAcumulada||0),"informada pelo cliente")));
}
function cardBens(c){
  const ok=garantir(c);const host=el("div");
  if(fiV3()){
    const bens=el("section",{class:"np-fc-sec"},
      el("div",{class:"np-fc-sec-h"},
        el("div",{},el("h2",{},"Bens declarados"),el("p",{class:"np-fc-sec-sub"},ok&&F.bens.length?`${F.bens.length} bem(ns) registrado(s)`:"Veículos, imóveis, maquinário e consórcios informados no onboarding.")),
        el("div",{class:"np-fc-sec-act edit-only"},NPUI.btn("+ Bem",{variante:"pri",onclick:()=>openBemForm(c)}))
      )
    );
    if(!ok)bens.append(NPUI.carregando(2));
    else if(!F.bens.length)bens.append(el("div",{class:"np-fc-qual-vazio"},"Nenhum bem declarado."));
    else bens.append(el("ul",{class:"np-fc-list"},F.bens.map(b=>el("li",{class:"np-fc-row"},
      el("div",{class:"np-fc-row-main"},
        el("div",{class:"np-fc-row-top"},el("span",{class:"np-fc-row-t"},b.descricao||"—"),NPUI.marca(TIPOS_BEM[b.tipo]||b.tipo,"muted"),b.onus?NPUI.marca(b.onus,/penhor|alien|hipotec|financ/i.test(b.onus)?"att":"ok"):null),
        el("div",{class:"np-fc-row-sub"},[TITULARES_BEM[b.titular]||null,b.valor_estimado?BRL(+b.valor_estimado):null].filter(Boolean).join(" · ")||"—"),
        b.observacoes?el("div",{class:"np-fc-row-obs"},b.observacoes):null
      ),
      el("div",{class:"np-fc-row-ctrl edit-only"},NPUI.btn("Editar",{variante:"ghost",onclick:()=>openBemForm(c,b)}))
    ))));
    host.append(bens);
    return host.firstChild;
  }
  const bens=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Bens declarados"),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openBemForm(c)},"+ Bem"))));
  if(ok&&!F.bens.length)bens.append(el("div",{class:"note"},"Nenhum bem declarado. Veículos, imóveis, maquinário e consórcios informados no onboarding entram aqui."));
  else if(ok)bens.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Tipo"),el("th",{},"Descrição"),el("th",{},"Titular"),el("th",{},"Ônus"),el("th",{class:"r"},"Valor est."),el("th",{},""))),
    el("tbody",{},F.bens.map(b=>el("tr",{},el("td",{},TIPOS_BEM[b.tipo]||b.tipo),el("td",{},b.descricao,b.observacoes?el("div",{class:"note"},b.observacoes):null),el("td",{},TITULARES_BEM[b.titular]||"—"),el("td",{},b.onus||"—"),el("td",{class:"r num"},b.valor_estimado?BRL(+b.valor_estimado):"—"),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openBemForm(c,b)},"Editar"))))))));
  host.append(bens);
  return host.firstChild;
}
function renderResumoV3(c,host,ind){
  const cliente=readOnly();
  const ok=garantir(c);
  const kv=(k,v)=>el("div",{class:"np-pf-kv"},el("dt",{},k),el("dd",{},v==null||v===""?"—":v));
  const qualTxt=montarQualificacao(c);
  const btnCopQual=NPUI.btn("Copiar qualificação p/ peça",{
    variante:"pri",
    onclick:()=>{
      if(!qualTxt){toast("Preencha o nome e dados de qualificação na ficha");return}
      copiarTexto(qualTxt,btnCopQual,"Qualificação copiada","Qualificação copiada para a área de transferência");
    }
  });
  const docMascarado=cnpjMask(c.cnpj);
  const docCel=docMascarado?el("span",{class:"np-fc-doc-wrap"},el("span",{},docMascarado),(()=>{const b=el("button",{type:"button",class:"np-fc-copy-btn",onclick:()=>copiarTexto(docMascarado,b,"Copiado",(c.tipo_pessoa==="PF"?"CPF":"CNPJ")+" copiado")},"Copiar");return b})()):"—";
  const endDisplay=[c.endereco,[c.cidade,c.uf].filter(Boolean).join("/")].filter((x,i,a)=>x&&(i===0||!String(a[0]||"").toLowerCase().includes(String(c.cidade||"").toLowerCase()))).join(" · ");
  const repDisplay=[c.representante,cnpjMask(c.representante_cpf||c.cpf_titular)?("CPF "+cnpjMask(c.representante_cpf||c.cpf_titular)):null,c.representante_qualificacao].filter(Boolean).join(" · ");
  const grupoNome=String(c.dados?.grupo||c.grupo||"").trim();

  // Camada 2: Bloco unificado "Qualificação Jurídica"
  const secQual=el("section",{class:"np-fc-sec"},
    el("div",{class:"np-fc-sec-h"},
      el("div",{},
        el("h2",{},"Qualificação jurídica"),
        el("p",{class:"np-fc-sec-sub"},[STATUS[c.status]||"Ativo",c.plano].filter(Boolean).join(" · "))
      ),
      el("div",{class:"np-fc-sec-act"},
        !cliente?btnCopQual:null,
        !cliente?el("span",{class:"edit-only"},NPUI.btn("Editar ficha",{onclick:()=>openFichaForm(c,"cadastro")})):null
      )
    ),
    !cliente?(qualTxt
      ?el("div",{class:"np-fc-qual-box","aria-label":"Texto de qualificação para peças"},qualTxt)
      :el("div",{class:"np-fc-qual-vazio"},"Complete endereço, representante legal e qualificação em “Editar ficha” para copiar o parágrafo pronto para peças.")):null,
    el("dl",{class:"np-pf-meta"},
      kv("Razão social / nome",c.nome),
      c.nome_fantasia?kv("Nome fantasia",c.nome_fantasia):null,
      kv(c.tipo_pessoa==="PF"?"CPF":"CNPJ",docCel),
      kv("Endereço completo",endDisplay||"—"),
      !cliente?kv("Representante legal",repDisplay||"—"):null,
      !cliente?kv("Grupo econômico",grupoNome||"—"):null,
      kv("Serviço contratado",c.plano||"—"),
      kv("Status",NPUI.marca(STATUS[c.status]||"Ativo",STATUS_TOM[c.status||"ativo"]||"muted")),
      kv("Responsável no escritório",c.responsavel||"—"),
      !cliente&&c.data_fechamento?kv("Fechamento",fmtD(parseD(c.data_fechamento))):null,
      c.pasta_drive_url?kv("Pasta no Drive",el("a",{href:c.pasta_drive_url,target:"_blank",rel:"noopener"},"Abrir pasta ↗")):null,
      !cliente&&c.segmento?kv("Segmento",c.segmento):null,
      !cliente&&c.faturamento_mensal?kv("Faturamento mensal",BRL(+c.faturamento_mensal)):null,
      !cliente&&c.funcionarios!=null&&c.funcionarios!==""?kv("Funcionários",String(c.funcionarios)):null,
      !cliente&&c.reservaAcumulada?kv("Reserva acumulada",BRL(+c.reservaAcumulada)):null
    )
  );
  host.append(secQual);
  if(cliente){host.append(el("div",{class:"np-fc-qual-vazio"},"Dúvidas sobre o seu cadastro? Fale com o escritório."));return}

  // Camada 3A: Sócios e contatos em lista limpa .np-it
  const secCont=el("section",{class:"np-fc-sec"},
    el("div",{class:"np-fc-sec-h"},
      el("div",{},el("h2",{},"Sócios e contatos"),el("p",{class:"np-fc-sec-sub"},ok?`${F.contatos.length} contato${F.contatos.length===1?"":"s"} vinculado${F.contatos.length===1?"":"s"}`:"Carregando…")),
      el("div",{class:"np-fc-sec-act edit-only"},NPUI.btn("+ Contato",{variante:"pri",onclick:()=>openContatoForm(c)}))
    )
  );
  if(!ok)secCont.append(NPUI.carregando(2));
  else if(!F.contatos.length)secCont.append(el("div",{class:"np-fc-qual-vazio"},"Nenhum sócio ou contato cadastrado."));
  else secCont.append(el("ul",{class:"np-fc-list"},F.contatos.map(x=>{
    const papelTxt=(PAPEIS[x.papel]||x.papel||"")+(x.participacao?` (${x.participacao}%)`:"");
    const sub=[papelTxt||null,x.cargo||null,x.cpf?"CPF "+cnpjMask(x.cpf):null,x.email||null,x.telefone||null].filter(Boolean).join(" · ");
    return el("li",{class:"np-fc-row"},
      el("div",{class:"np-fc-row-main"},
        el("div",{class:"np-fc-row-top"},
          el("span",{class:"np-fc-row-t"},x.nome||"—"),
          x.principal?NPUI.marca("principal","ok"):null,
          x.perfil_id?NPUI.marca("tem acesso","info"):null
        ),
        sub?el("div",{class:"np-fc-row-sub"},sub):null,
        x.observacoes?el("div",{class:"np-fc-row-obs"},x.observacoes):null
      ),
      el("div",{class:"np-fc-row-ctrl edit-only"},NPUI.btn("Editar",{variante:"ghost",onclick:()=>openContatoForm(c,x)}))
    );
  })));
  host.append(secCont);

  // Camada 3B: Documentos resumo
  const nDocs=F.documentos.length,nCli=F.documentos.filter(d=>d.visivel_cliente).length;
  host.append(el("section",{class:"np-fc-sec"},
    el("div",{class:"np-fc-doc-bar"},
      el("div",{},el("h2",{style:"margin:0;font:600 var(--np-fs-3)/1.3 var(--np-ui)"},"Documentos"),el("p",{class:"np-fc-sec-sub"},ok?(nDocs?`${nDocs} documento(s) vinculado(s) · ${nCli} visível(is) ao cliente`:"Nenhum documento vinculado ainda."):"Carregando…")),
      el("div",{class:"np-fc-sec-act"},
        c.pasta_drive_url?el("a",{class:"np-fc-drive-link",href:c.pasta_drive_url,target:"_blank",rel:"noopener"},"Pasta no Drive ↗"):null,
        NPUI.btn("Abrir documentos →",{onclick:()=>{S.sub="documentos";render()}})
      )
    )
  ));

  // Camada 3C: Acessos a sistemas em lista limpa .np-it (preservando 100% do cofre PP_TOTP)
  const secAc=el("section",{class:"np-fc-sec"},
    el("div",{class:"np-fc-sec-h"},
      el("div",{},el("h2",{},"Acessos a sistemas"),el("p",{class:"np-fc-sec-sub"},"gov.br, e-CAC, bancos — senhas e segredos 2FA no cofre criptografado com auditoria.")),
      el("div",{class:"np-fc-sec-act edit-only"},NPUI.btn("+ Acesso",{variante:"pri",onclick:()=>openAcessoForm(c)}))
    )
  );
  if(!ok)secAc.append(NPUI.carregando(2));
  else if(!F.acessos.length)secAc.append(el("div",{class:"np-fc-qual-vazio"},"Nenhum acesso cadastrado."));
  else secAc.append(el("ul",{class:"np-fc-list"},F.acessos.map(x=>el("li",{class:"np-fc-row"},
    el("div",{class:"np-fc-row-main"},
      el("div",{class:"np-fc-row-top"},el("span",{class:"np-fc-row-t"},x.sistema||"—"),x.titular?el("span",{class:"np-fc-row-sub"},"· "+x.titular):null),
      el("div",{class:"np-fc-row-sub"},"Login: "+(x.login||"—")),
      x.observacoes?el("div",{class:"np-fc-row-obs"},x.observacoes):null
    ),
    el("div",{class:"np-fc-row-ctrl"},
      el("div",{class:"np-fc-vault"},celSenha(x),cel2fa(c,x)),
      el("span",{class:"edit-only"},NPUI.btn("Editar",{variante:"ghost",onclick:()=>openAcessoForm(c,x)}))
    )
  ))));
  host.append(secAc);

  // Camada 3D: Contexto empresarial e onboarding retrátil (NPUI.maisCampos)
  const flagsCtx=[
    c.negativado!=null?NPUI.marca("Negativado: "+(c.negativado?"sim":"não"),c.negativado?"crit":"muted"):null,
    c.usa_maquininha!=null?NPUI.marca("Maquininha: "+(c.usa_maquininha?"sim":"não"),c.usa_maquininha?"info":"muted"):null,
    c.tem_consorcio!=null?NPUI.marca("Consórcio: "+(c.tem_consorcio?"sim":"não"),c.tem_consorcio?"info":"muted"):null,
    c.outros_cnpjs?NPUI.marca("Outros CNPJs: "+c.outros_cnpjs,"muted"):null
  ].filter(Boolean);
  const camposCtxPreenchidos=[c.origem,c.closer,c.negativado,c.usa_maquininha,c.tem_consorcio,c.outros_cnpjs,c.assuntos_interesse,c.disponibilidade,c.historia,c.situacao_atual,c.observacoes_onboarding].filter(v=>v!=null&&String(v).trim()!=="").length;
  const blocoCtx=NPUI.maisCampos("Contexto empresarial e onboarding",[
    el("div",{class:"np-fc-ctx-grid"},
      el("dl",{class:"np-pf-meta full",style:"grid-column:1 / -1"},
        kv("Origem",c.origem||"—"),
        kv("Closer",c.closer||"—"),
        kv("Assuntos de interesse",c.assuntos_interesse||"—"),
        kv("Disponibilidade",c.disponibilidade||"—"),
        c.data_onboarding?kv("Data do onboarding",fmtD(parseD(c.data_onboarding))):null,
        c.proxima_reuniao?kv("Próxima reunião",fmtD(parseD(c.proxima_reuniao))):null
      ),
      flagsCtx.length?el("div",{class:"np-fc-flags",style:"grid-column:1 / -1"},...flagsCtx):null,
      c.historia?el("div",{class:"np-fc-ctx-card"},el("h3",{},"O que aconteceu"),el("div",{class:"np-fc-ctx-txt"},c.historia)):null,
      c.situacao_atual?el("div",{class:"np-fc-ctx-card"},el("h3",{},"Situação atual"),el("div",{class:"np-fc-ctx-txt"},c.situacao_atual)):null,
      c.observacoes_onboarding?el("div",{class:"np-fc-ctx-card full"},el("h3",{},"Respostas do onboarding"),el("div",{class:"np-fc-ctx-txt"},c.observacoes_onboarding)):null,
      !camposCtxPreenchidos?el("div",{class:"np-fc-qual-vazio",style:"grid-column:1 / -1"},"Nenhum dado adicional de contexto ou onboarding registrado."):null
    )
  ],{aberto:false,contador:camposCtxPreenchidos});
  host.append(blocoCtx);
}
function renderResumo(c,host,ind){
  if(fiV3()){renderResumoV3(c,host,ind);return}
  const cliente=readOnly();
  const kv=(k,v)=>el("div",{class:"kv"},el("div",{class:"k"},k),el("div",{class:"v"},v==null||v===""?el("span",{class:"note"},"—"):v));
  const ok=garantir(c);
  // Identificação
  const ident=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Identificação"),el("div",{class:"note"},[STATUS[c.status]||"Ativo",c.plano].filter(Boolean).join(" · "))),
    cliente?null:el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openFichaForm(c)},"Editar ficha"))));
  ident.append(el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"},
    kv("Razão social",c.nome),kv("Nome fantasia",c.nome_fantasia),kv(c.tipo_pessoa==="PF"?"CPF":"CNPJ",cnpjMask(c.cnpj)),cliente?null:kv("Sócio / titular",[c.representante,cnpjMask(c.cpf_titular||c.representante_cpf)].filter(Boolean).join(" · ")),
    kv("Cidade",[c.cidade,c.uf].filter(Boolean).join("/")),cliente?null:kv("Grupo / vinculadas",c.dados?.grupo||c.grupo),kv("Serviço",c.plano),kv("Status",STATUS[c.status]||c.status),
    cliente?null:kv("Fechamento",c.data_fechamento?fmtD(parseD(c.data_fechamento)):null),cliente?null:kv("Origem",c.origem),cliente?null:kv("Closer",c.closer),kv("Responsável no escritório",c.responsavel)));
  host.append(ident);
  if(cliente){host.append(el("div",{class:"note"},"Dúvidas sobre o seu cadastro? Fale com o escritório."));return}
  // Sócios e contatos
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Sócios e contatos"),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openContatoForm(c)},"+ Contato"))));
  if(!ok)sec.append(el("div",{class:"note"},"Carregando…"));
  else if(!F.contatos.length)sec.append(el("div",{class:"note"},"Nenhum sócio ou contato cadastrado."));
  else sec.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Nome"),el("th",{},"Papel"),el("th",{},"CPF"),el("th",{},"Cargo"),el("th",{},"E-mail"),el("th",{},"Telefone"),el("th",{},"Login"),el("th",{},""))),
    el("tbody",{},F.contatos.map(x=>el("tr",{},el("td",{},el("b",{},x.nome),x.principal?el("span",{class:"pill g",style:"margin-left:6px"},"principal"):null,x.observacoes?el("div",{class:"note"},x.observacoes):null),el("td",{},PAPEIS[x.papel]||x.papel||"—",x.participacao?` · ${x.participacao}%`:""),el("td",{class:"num"},cnpjMask(x.cpf)||"—"),el("td",{},x.cargo||"—"),el("td",{},x.email||"—"),el("td",{},x.telefone||"—"),el("td",{},x.perfil_id?el("span",{class:"pill e1"},"tem acesso"):"—"),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openContatoForm(c,x)},"Editar"))))))));
  host.append(sec);
  // Documentos: no Cadastro fica só o resumo + botão; a lista completa tem página própria (espelho da pasta do cliente no Drive)
  const nDocs=F.documentos.length,nCli=F.documentos.filter(d=>d.visivel_cliente).length;
  host.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Documentos"),el("div",{class:"note"},ok?(nDocs?`${nDocs} documento(s) vinculado(s) · ${nCli} visível(is) ao cliente`:"Nenhum documento vinculado ainda."):"Carregando…")),
    el("div",{class:"actions"},c.pasta_drive_url?el("a",{class:"btn sm",href:c.pasta_drive_url,target:"_blank",rel:"noopener"},"Pasta no Drive ↗"):null,el("button",{class:"btn sm primary",onclick:()=>{S.sub="documentos";render()}},"Abrir documentos →")))));
  // Acessos a sistemas (gov.br etc.) — só equipe; senha oculta até clicar
  const ac=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Acessos a sistemas"),el("div",{class:"note"},"gov.br, e-CAC, bancos — informados pelo cliente. Senhas e segredos 2FA ficam no cofre criptografado; cada consulta é registrada. Fora da área do cliente e do BI.")),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openAcessoForm(c)},"+ Acesso"))));
  if(ok&&!F.acessos.length)ac.append(el("div",{class:"note"},"Nenhum acesso cadastrado."));
  else if(ok)ac.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Sistema"),el("th",{},"Titular"),el("th",{},"Login"),el("th",{},"Senha"),el("th",{},"2FA"),el("th",{},"Observações"),el("th",{},""))),
    el("tbody",{},F.acessos.map(x=>el("tr",{},el("td",{},el("b",{},x.sistema)),el("td",{},x.titular||"—"),el("td",{class:"num"},x.login||"—"),el("td",{},celSenha(x)),el("td",{},cel2fa(c,x)),el("td",{},x.observacoes||"—"),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openAcessoForm(c,x)},"Editar"))))))));
  host.append(ac);
  if(c.observacoes_onboarding)host.append(el("section",{class:"card section"},el("h2",{},"Respostas do onboarding"),el("div",{class:"note",style:"white-space:pre-wrap"},c.observacoes_onboarding)));
}
const pill=(l,v,cls)=>v==null?null:el("span",{class:"pill "+(v?cls:"g"),style:v?"":"opacity:.6"},l+": "+(v?"sim":"não"));

/* ---------- Formulários ---------- */
function openFichaForm(c,modo="cadastro"){
  const nome=inp("text",c.nome||""),fant=inp("text",c.nome_fantasia||""),tipo=sel({PJ:"Pessoa jurídica",PF:"Pessoa física"},c.tipo_pessoa||"PJ"),cnpj=inp("text",c.cnpj||"",{placeholder:"00.000.000/0001-00"}),cpf=inp("text",c.cpf_titular||""),
        cidade=inp("text",c.cidade||""),uf=sel({"":"—",...Object.fromEntries(UFS.map(u=>[u,u]))},c.uf||""),seg=inp("text",c.segmento||"",{placeholder:"Ex.: transportes, varejo de calçados"}),grupo=inp("text",c.grupo||c.dados?.grupo||"",{placeholder:"Ex.: NASP / M.R. Galera (mesmos sócios, mesmo contrato)"}),fat=inp("number",c.faturamento_mensal||"",{step:"1000"}),func=inp("number",c.funcionarios||"",{min:0}),
        resp=inp("text",c.responsavel||""),closer=inp("text",c.closer||""),origem=dl("f-origem",c.origem||"",ORIGENS),plano=dl("f-plano",c.plano||"",PLANOS),status=sel(STATUS,c.status||"ativo"),
        dfech=inp("date",c.data_fechamento||""),donb=inp("date",c.data_onboarding||""),prox=inp("date",c.proxima_reuniao||""),pdrive=inp("url",c.pasta_drive_url||"",{placeholder:"https://drive.google.com/drive/folders/…"}),
        hist=el("textarea",{placeholder:"O que aconteceu com a empresa: expansão, queda de faturamento, inadimplência, execuções… em poucas linhas."},c.historia||""),sit=el("textarea",{placeholder:"Opera? Fatura? Em que conta recebe? Negativado?"},c.situacao_atual||""),
        neg=tri(c.negativado),maq=tri(c.usa_maquininha),cons=tri(c.tem_consorcio),outros=inp("text",c.outros_cnpjs||""),ass=inp("text",c.assuntos_interesse||""),disp=inp("text",c.disponibilidade||""),obs=el("textarea",{},c.observacoes_onboarding||""),
        res=inp("number",c.reservaAcumulada||0,{step:"100"}),
        ender=inp("text",c.endereco||"",{placeholder:"Rua, nº, bairro, cidade/UF, CEP"}),rep=inp("text",c.representante||""),repcpf=inp("text",c.representante_cpf||"",{placeholder:"000.000.000-00"}),repq=inp("text",c.representante_qualificacao||"",{placeholder:"brasileiro, casado, empresário"}),
        notasInt=el("textarea",{placeholder:"Anotações internas da equipe (não aparecem na área do cliente)."},c.notasInternas||c.dados?.notasInternas||"");
  const v3=fiV3();
  let body;
  if(v3){
    const ctxOpcional=NPUI.maisCampos("Contexto empresarial opcional",[
      field("f-origem","Origem",origem.wrap),field("f-closer","Closer",closer),
      field("f-neg","Negativado",neg),field("f-maq","Usa maquininha",maq),field("f-cons","Tem consórcio",cons),field("f-outros","Outros CNPJs",outros),
      field("f-hist","O que aconteceu",hist),field("f-sit","Situação atual",sit),
      field("f-ass","Assuntos que quer discutir",ass),field("f-disp","Disponibilidade para reuniões",disp),
      field("f-donb","Data do onboarding",donb),field("f-prox","Próxima reunião",prox),
      field("f-obs","Respostas do onboarding (texto livre)",obs),
      field("f-notas","Notas internas",notasInt)
    ],{aberto:modo==="raio",contador:"auto"});
    body=el("div",{class:"form"},
      NPUI.secaoForm("Identificação"),
      field("f-nome","Razão social / nome",nome),field("f-fant","Nome fantasia",fant),field("f-tipo","Tipo",tipo),field("f-cnpj","CNPJ / CPF",cnpj),field("f-cpf","CPF do titular / sócio",cpf),
      NPUI.secaoForm("Qualificação para peças","Usada no botão “Copiar qualificação p/ peça” e nos modelos jurídicos."),
      el("div",{class:"f full"},el("label",{for:"f-ender"},"Endereço completo"),Object.assign(ender,{id:"f-ender"})),
      field("f-cid","Cidade",cidade),field("f-uf","UF",uf),
      field("f-rep","Representante legal",rep),field("f-repcpf","CPF do representante",repcpf),
      el("div",{class:"f full"},el("label",{for:"f-repq"},"Qualificação do representante"),Object.assign(repq,{id:"f-repq"}),el("div",{class:"help"},"Nacionalidade, estado civil, profissão — entra na qualificação da peça.")),
      NPUI.secaoForm("Operação e grupo econômico"),
      field("f-grupo","Grupo / empresas vinculadas",grupo,"Mesmo nome de grupo em cada empresa liga as fichas no cabeçalho e no dossiê."),
      field("f-plano","Serviço contratado",plano.wrap),field("f-status","Status",status),field("f-resp","Responsável no escritório",resp),
      field("f-dfech","Data do fechamento",dfech),field("f-pdrive","Pasta do cliente no Drive",pdrive),
      field("f-seg","Segmento",seg),field("f-fat","Faturamento mensal (R$)",fat),field("f-func","Funcionários",func),field("f-res","Reserva acumulada (R$)",res),
      ctxOpcional
    );
  }else{
    const CAD=[field("f-nome","Razão social / nome",nome),field("f-fant","Nome fantasia",fant),field("f-tipo","Tipo",tipo),field("f-cnpj","CNPJ / CPF",cnpj),field("f-cpf","CPF do titular / sócio",cpf),
      el("div",{class:"f full"},el("label",{for:"f-ender"},"Endereço completo (usado nas peças)"),Object.assign(ender,{id:"f-ender"})),field("f-rep","Representante legal",rep),field("f-repcpf","CPF do representante",repcpf),
      field("f-cid","Cidade",cidade),field("f-uf","UF",uf),field("f-grupo","Grupo / empresas vinculadas",grupo,"Mesmo nome de grupo em cada empresa liga as fichas: o cabeçalho mostra as outras e o dossiê pode incluir os andamentos do grupo."),
      field("f-plano","Serviço contratado",plano.wrap),field("f-status","Status",status),field("f-dfech","Data do fechamento",dfech),
      field("f-origem","Origem",origem.wrap),field("f-closer","Closer",closer),field("f-resp","Responsável no escritório",resp)];
    const RAIO=[field("f-seg","Segmento",seg),field("f-fat","Faturamento mensal (R$)",fat),field("f-func","Funcionários",func),field("f-res","Reserva acumulada (R$)",res),
      field("f-neg","Negativado",neg),field("f-maq","Usa maquininha",maq),field("f-cons","Tem consórcio",cons),field("f-outros","Outros CNPJs",outros),
      field("f-hist","O que aconteceu",hist),field("f-sit","Situação atual",sit),field("f-ass","Assuntos que quer discutir",ass),field("f-disp","Disponibilidade para reuniões",disp),field("f-obs","Respostas do onboarding (texto livre)",obs),
      field("f-repq","Qualificação do representante",repq,"Nacionalidade, estado civil, profissão — entra na qualificação da peça."),field("f-pdrive","Pasta do cliente no Drive",pdrive)];
    body=el("div",{class:"form"},...(modo==="raio"?RAIO:CAD));
  }
  modal(v3?"Ficha do cliente":(modo==="raio"?"Dados da empresa":"Ficha cadastral"),body,async()=>{
    if(!nome.value.trim())throw errCampo(nome,"Informe o nome");
    const cols={endereco:ender.value.trim()||null,representante:rep.value.trim()||null,representante_cpf:repcpf.value.trim()||null,representante_qualificacao:repq.value.trim()||null,nome_fantasia:fant.value.trim()||null,tipo_pessoa:tipo.value,cnpj:cnpj.value.trim()||null,cpf_titular:cpf.value.trim()||null,cidade:cidade.value.trim()||null,uf:uf.value||null,segmento:seg.value.trim()||null,
      faturamento_mensal:fat.value===""?null:+fat.value,funcionarios:func.value===""?null:+func.value,closer:closer.value.trim()||null,origem:origem.input.value.trim()||null,plano:plano.input.value.trim()||null,status:status.value,
      data_fechamento:dfech.value||null,data_onboarding:donb.value||null,proxima_reuniao:prox.value||null,pasta_drive_url:pdrive.value.trim()||null,historia:hist.value.trim()||null,situacao_atual:sit.value.trim()||null,
      negativado:triVal(neg),usa_maquininha:triVal(maq),tem_consorcio:triVal(cons),outros_cnpjs:outros.value.trim()||null,assuntos_interesse:ass.value.trim()||null,disponibilidade:disp.value.trim()||null,observacoes_onboarding:obs.value.trim()||null};
    // nome, responsável, reserva e cnpj também vivem no jsonb (motor e páginas do cliente)
    const {data:cur}=await SB.from("clientes").select("dados").eq("id",c.id).single();
    const dados={...(cur?.dados||{}),nome:nome.value.trim(),cnpj:cols.cnpj||"",responsavel:resp.value.trim(),reservaAcumulada:+res.value||0,grupo:grupo.value.trim()||null};
    if(v3)dados.notasInternas=notasInt.value;
    const {error}=await SB.from("clientes").update({...cols,dados}).eq("id",c.id);
    if(error)throw new Error("Não foi possível salvar: "+(error.message||""));
    toast("Ficha salva");notificar("clientes");
  },null,{confirmar:"Salvar ficha do cliente"});
}
function openContatoForm(c,x={}){
  const nome=inp("text",x.nome||""),papel=sel(PAPEIS,x.papel||"socio"),cpf=inp("text",x.cpf||""),part=inp("number",x.participacao||"",{min:0,max:100,step:"0.01"}),cargo=inp("text",x.cargo||""),email=inp("email",x.email||""),tel=inp("text",x.telefone||""),princ=check("Contato principal",x.principal),obs=el("textarea",{},x.observacoes||"");
  const v3=fiV3();
  const body=v3
    ?el("div",{class:"form"},
      field("ct-nome","Nome",nome),field("ct-papel","Papel",papel),field("ct-email","E-mail",email),field("ct-tel","Telefone / WhatsApp",tel),princ.wrap,
      NPUI.maisCampos("CPF, cargo e observações",[field("ct-cpf","CPF",cpf),field("ct-part","Participação (%)",part),field("ct-cargo","Cargo",cargo),field("ct-obs","Observações",obs)],{contador:"auto"}))
    :el("div",{class:"form"},field("ct-nome","Nome",nome),field("ct-papel","Papel",papel),field("ct-cpf","CPF",cpf),field("ct-part","Participação (%)",part),field("ct-cargo","Cargo",cargo),field("ct-email","E-mail",email),field("ct-tel","Telefone / WhatsApp",tel),princ.wrap,field("ct-obs","Observações",obs));
  const extra=x.id?el("button",{class:"btn danger",onclick:()=>{npConfirmar({titulo:"Excluir contato?",mensagem:`Remover ${x.nome||"este contato"} da ficha de ${c.nome||"este cliente"}?`,confirmar:"Excluir contato",perigo:true,onSim:async()=>{const {error}=await SB.from("contatos").delete().eq("id",x.id);if(error)throw error;$("#modalHost").replaceChildren();toast("Contato excluído");recarregar()}})}} ,"Excluir"):null;
  modal(x.id?"Editar contato":"Novo contato",body,async()=>{
    if(!nome.value.trim())throw errCampo(nome,"Informe o nome");
    const row={cliente_id:c.id,nome:nome.value.trim(),papel:papel.value,cpf:cpf.value.trim()||null,participacao:part.value===""?null:+part.value,cargo:cargo.value.trim()||null,email:email.value.trim()||null,telefone:tel.value.trim()||null,principal:princ.input.checked,observacoes:obs.value.trim()||null};
    const {error}=x.id?await SB.from("contatos").update(row).eq("id",x.id):await SB.from("contatos").insert(row);if(error)throw error;
    toast("Contato salvo");recarregar();
  },extra,{confirmar:x.id?"Salvar contato":"Cadastrar contato"});
}
function openBemForm(c,b={}){
  const tipo=sel(TIPOS_BEM,b.tipo||"veiculo"),desc=inp("text",b.descricao||"",{placeholder:"Ex.: Fiat Toro 2022 placa ABC1D23"}),tit=sel({"":"—",...TITULARES_BEM},b.titular||"PF"),onus=dl("b-onus",b.onus||"",["Livre","Financiado","Alienado fiduciariamente","Hipotecado","Penhorado","Bem de família","Usufruto","Vendido sem transferência"]),val=inp("number",b.valor_estimado||"",{step:"1000"}),obs=el("textarea",{},b.observacoes||"");
  const body=el("div",{class:"form"},field("b-tipo","Tipo",tipo),field("b-desc","Descrição",desc),field("b-tit","Titular",tit),field("b-onus","Ônus / situação",onus.wrap),field("b-val","Valor estimado (R$)",val),field("b-obs","Observações",obs));
  /* 0111: excluir bem = quem conduz a proteção (edita_protecao) e só bem fora de proteção; bem em proteção ou protegido = só a
     administradora, com motivo (bem_excluir_protegido). O botão só aparece para quem pode; a resposta do banco é conferida. */
  const protegido=["em_protecao","protegido"].includes(b.protecao),admin=PP.perfil?.papel==="admin";
  const podeExcluir=b.id&&(protegido?admin:F.editaProtecao===true);
  const extra=podeExcluir?el("button",{class:"btn danger",onclick:async()=>{
    if(protegido){let mot=body.querySelector("#b-motivo");
      if(!mot){mot=el("textarea",{id:"b-motivo",rows:2,placeholder:"Ex.: bem vendido antes da proteção"});body.append(el("div",{class:"f full confirm"},el("label",{for:"b-motivo"},"Este bem está "+(b.protecao==="protegido"?"protegido":"em proteção")+". A exclusão exige autorização da administradora e fica registrada na auditoria e no dossiê. Motivo:"),mot));mot.focus();return}
      const motivo=mot.value.trim();if(motivo.length<10){toast("Informe o motivo (pelo menos 10 caracteres). Nada foi excluído.");mot.focus();return}
      const {error}=await SB.rpc("bem_excluir_protegido",{p_id:b.id,p_motivo:motivo});
      if(error){toast("Nada foi excluído: "+(error.message||"sem permissão"));return}
      $("#modalHost").replaceChildren();toast("Bem excluído com autorização");recarregar();return}
    if(!confirmInline(body,"Excluir este bem?"))return;
    const {data,error}=await SB.from("bens").delete().eq("id",b.id).select("id");
    if(error||!data?.length){toast(error?"Não foi possível excluir: "+(error.message||"erro")+". Nada foi excluído.":"Você não tem permissão para excluir este bem; nada foi excluído.");return}
    $("#modalHost").replaceChildren();toast("Bem excluído");recarregar()}},protegido?"Excluir (administradora)":"Excluir"):null;
  modal(b.id?"Editar bem":"Novo bem",body,async()=>{
    if(!desc.value.trim())throw errCampo(desc,"Descreva o bem");
    const row={cliente_id:c.id,tipo:tipo.value,descricao:desc.value.trim(),titular:tit.value||null,onus:onus.input.value.trim()||null,valor_estimado:val.value===""?null:+val.value,observacoes:obs.value.trim()||null};
    const {error}=b.id?await SB.from("bens").update(row).eq("id",b.id):await SB.from("bens").insert(row);if(error)throw error;
    toast("Bem salvo");recarregar();
  },extra,{confirmar:b.id?"Salvar bem":"Cadastrar bem"});
}
function openDocForm(c,d={}){
  const tit=inp("text",d.titulo||""),tipo=sel(TIPOS_DOC,d.tipo||"outro"),url=inp("url",d.url||"",{placeholder:"https://drive.google.com/…"}),data=inp("date",d.data||""),kon=sel({"":"— sem vínculo —",...Object.fromEntries(S.contratos.filter(k=>k.clienteId===c.id).map(k=>[k.id,shortName(k)]))},d.contrato_id||""),vis=check("Visível ao cliente",d.visivel_cliente),obs=el("textarea",{},d.observacoes||"");
  const body=el("div",{class:"form"},field("d-tit","Título",tit),field("d-tipo","Tipo",tipo),field("d-url","Link (Drive, Notion, tribunal)",url),field("d-data","Data",data),field("d-kon","Contrato relacionado",kon),vis.wrap,field("d-obs","Observações",obs));
  const extra=d.id?el("button",{class:"btn danger",onclick:()=>{npConfirmar({titulo:"Excluir documento?",mensagem:`Remover o vínculo de “${d.titulo||"este documento"}”? O arquivo no Drive não é apagado.`,confirmar:"Excluir documento",perigo:true,onSim:async()=>{const {error}=await SB.from("documentos").delete().eq("id",d.id);if(error)throw error;$("#modalHost").replaceChildren();toast("Documento excluído");recarregar()}})}} ,"Excluir"):null;
  modal(d.id?"Editar documento":"Novo documento",body,async()=>{
    if(!tit.value.trim())throw errCampo(tit,"Informe o título");
    const row={cliente_id:c.id,titulo:tit.value.trim(),tipo:tipo.value,url:url.value.trim()||null,data:data.value||null,contrato_id:kon.value||null,visivel_cliente:vis.input.checked,observacoes:obs.value.trim()||null};
    const {error}=d.id?await SB.from("documentos").update(row).eq("id",d.id):await SB.from("documentos").insert(row);if(error)throw error;
    toast("Documento salvo");recarregar();
  },extra,{confirmar:d.id?"Salvar documento":"Vincular documento"});
}


/* ---------- Cofre: senha e 2FA (TOTP) — o segredo nunca chega ao navegador ---------- */
const celSenha=(x)=>window.PP_TOTP.celSenha(x);
function cel2fa(c,x){
  if(!x.tem_2fa)return el("button",{class:"btn sm edit-only",onclick:()=>open2faForm(c,x)},"Configurar 2FA");
  const w=window.PP_TOTP?window.PP_TOTP.widget(x.id,{compacto:true}):el("span",{class:"note"},"carregando…");
  return el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},w,el("button",{class:"btn sm edit-only",title:"Substituir ou remover o 2FA",onclick:()=>open2faForm(c,x)},"⚙"));
}
const open2faForm=(c,x)=>window.PP_TOTP.form2fa(x,recarregar);

function openAcessoForm(c,x={}){
  const sis=dl("ac-sis",x.sistema||"gov.br",SISTEMAS),tit=inp("text",x.titular||"",{placeholder:"Empresa / sócio"}),login=inp("text",x.login||"",{autocomplete:"off"}),senha=inp("password",""+"",{autocomplete:"new-password",placeholder:x.tem_senha?"•••••••• (deixe em branco para manter)":"opcional"}),obs=el("textarea",{placeholder:"2FA? qual telefone recebe o código? validade?"},x.observacoes||"");
  const body=el("div",{class:"form"},field("ac-sis","Sistema",sis.wrap),field("ac-tit","Titular do acesso",tit),field("ac-login","Login (CPF/CNPJ/usuário)",login),field("ac-senha","Senha",senha,x.tem_senha?"Guardada no cofre. Para trocar, digite a nova; para apagar, digite \"apagar\".":"Vai para o cofre criptografado, não fica na tabela."),field("ac-obs","Observações",obs));
  const extra=x.id?el("button",{class:"btn danger",onclick:()=>{npConfirmar({titulo:"Excluir acesso?",mensagem:`Remover o acesso ${x.sistema||""} (${x.login||"sem login"}) do cofre do cliente?`,confirmar:"Excluir acesso",perigo:true,onSim:async()=>{const {error}=await SB.from("acessos_sistemas").delete().eq("id",x.id);if(error)throw error;$("#modalHost").replaceChildren();toast("Acesso excluído");recarregar()}})}} ,"Excluir"):null;
  modal(x.id?"Editar acesso":"Novo acesso",body,async()=>{
    if(!sis.input.value.trim())throw errCampo(sis.input,"Informe o sistema");
    const row={cliente_id:c.id,sistema:sis.input.value.trim(),titular:tit.value.trim()||null,login:login.value.trim()||null,observacoes:obs.value.trim()||null};
    let id=x.id;if(id){const {error}=await SB.from("acessos_sistemas").update(row).eq("id",id);if(error)throw error}else{const {data,error}=await SB.from("acessos_sistemas").insert(row).select("id").single();if(error)throw error;id=data.id}
    const sv=senha.value;if(sv){const {error}=await SB.rpc("acesso_senha_definir",{acesso_id:id,senha:sv.trim().toLowerCase()==="apagar"?"":sv});if(error)throw error}
    toast("Acesso salvo");recarregar();
  },extra,{confirmar:x.id?"Salvar acesso":"Cadastrar acesso"});
}

/* ---------- Integração ---------- */

/* ---------- Página Documentos do cliente (aberta pelo botão do Cadastro) ---------- */
function paginaDocumentos(c,host){
  const ok=garantir(c.id);
  host.append(el("div",{class:"actions",style:"justify-content:flex-start;margin:-4px 0 6px"},el("button",{class:"btn sm",onclick:()=>{S.sub="cliente";render()}},"← Cadastro")));
  const docs=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Documentos de "+(c.nome_fantasia||c.nome)),el("div",{class:"note"},"Espelho da pasta do cliente: cada item aponta para o arquivo no Drive (contratos, pareceres, onboarding, cartão CNPJ, transcrições). Marque “cliente vê” para aparecer na área do cliente.")),
    el("div",{class:"actions edit-only"},c.pasta_drive_url?el("a",{class:"btn sm",href:c.pasta_drive_url,target:"_blank",rel:"noopener"},"Pasta no Drive ↗"):null,el("button",{class:"btn sm primary",onclick:()=>openDocForm(c)},"+ Documento"))));
  if(!ok)docs.append(el("div",{class:"note"},"Carregando…"));
  else if(!F.documentos.length)docs.append(el("div",{class:"empty"},"Nenhum documento vinculado. Cole o link do Drive (contratos, pareceres, onboarding, cartão CNPJ)."));
  else{const grupos={};F.documentos.forEach(d=>{(grupos[TIPOS_DOC[d.tipo]||"Outros"]=grupos[TIPOS_DOC[d.tipo]||"Outros"]||[]).push(d)});
    for(const [g,lista] of Object.entries(grupos).sort()){docs.append(el("div",{class:"eyebrow",style:"margin-top:10px"},g+" · "+lista.length));
      docs.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Título"),el("th",{},"Data"),el("th",{},"Vínculo"),el("th",{},"Cliente vê"),el("th",{},""))),
        el("tbody",{},lista.sort((a,b)=>(b.data||"").localeCompare(a.data||"")).map(d=>el("tr",{},el("td",{},d.url?el("a",{href:d.url,target:"_blank",rel:"noopener",style:"color:var(--info);font-weight:600"},"↗ "+d.titulo):d.titulo,d.observacoes?el("div",{class:"note"},d.observacoes):null),el("td",{},d.data?fmtD(parseD(d.data)):"—"),el("td",{},d.contrato_id?(S.contratos.find(k=>k.id===d.contrato_id)?shortName(S.contratos.find(k=>k.id===d.contrato_id)):"contrato"):d.processo_id?"processo":"—"),el("td",{},d.visivel_cliente?el("span",{class:"pill e1"},"sim"):el("span",{class:"pill e2"},"não")),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openDocForm(c,d)},"Editar"))))))))}}
  host.append(docs);
}
window.PP_FICHA=Object.assign(window.PP_FICHA||{},{paginaDocumentos,cardRaioX,cardBens,openBemForm,openFichaForm,montarQualificacao,recarregar});
window.PP_MOD=window.PP_MOD||{};
window.PP_MOD.resumo=(c,host,ind)=>{if(S.sub==="dossie"||S.sub==="financeiro"||S.sub==="acompanhamento")return;renderResumo(c,host,ind)};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("ficha");for(const t of ["contatos","bens","documentos","acessos_sistemas"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>recarregar());ch.subscribe()}});
})();
