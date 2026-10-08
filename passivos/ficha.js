/* Ficha do cliente — aba Resumo (identificação, história, situação, sócios/contatos, bens, documentos, indicadores).
   Supabase: colunas de ficha em clientes (0008), contatos, bens, documentos. Carregado depois de carteira.js e tarefas.js. */
(()=>{
"use strict";
const STATUS={prospect:"Prospect",onboarding:"Em onboarding",ativo:"Ativo",encerrado:"Encerrado"};
const PAPEIS={socio:"Sócio(a)",titular:"Titular",avalista:"Avalista",contador:"Contador(a)",financeiro:"Financeiro",conjuge:"Cônjuge",outro:"Outro"};
const TIPOS_BEM={veiculo:"Veículo",imovel:"Imóvel",maquinario:"Maquinário / equipamentos",rebanho:"Rebanho",safra:"Safra",consorcio:"Consórcio",outro:"Outro"};
const TITULARES_BEM={PJ:"Empresa",PF:"Pessoa física",terceiro:"Terceiro"};
const TIPOS_DOC={contrato_bancario:"Contrato bancário",contrato_honorarios:"Contrato de honorários",parecer:"Parecer",onboarding:"Onboarding",transcricao:"Transcrição",extrato:"Extrato",cartao_cnpj:"Cartão CNPJ",contrato_social:"Contrato social",procuracao:"Procuração",peticao:"Petição",decisao:"Decisão",acordo:"Acordo",outro:"Outro"};
const ORIGENS=["Meta Ads","Google","Indicação","Orgânico / Instagram","Parceiro","Base antiga","Outro"];
const PLANOS=["Gestão de Passivos Bancários PJ","Superendividamento","Revisional","Defesa em execução","Estruturação societária","Outro"];
const UFS="AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const F={cid:null,carregando:null,contatos:[],bens:[],documentos:[],acessos:[]};
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

/* ---------- Resumo ---------- */
function renderResumo(c,host,ind){
  const cliente=readOnly();
  const kv=(k,v)=>el("div",{class:"kv"},el("div",{class:"k"},k),el("div",{class:"v"},v==null||v===""?el("span",{class:"note"},"—"):v));
  const ok=garantir(c);
  // Identificação
  const ident=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Identificação"),el("div",{class:"note"},[STATUS[c.status]||"Ativo",c.plano].filter(Boolean).join(" · "))),
    cliente?null:el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openFichaForm(c)},"Editar ficha"))));
  ident.append(el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"},
    kv("Razão social",c.nome),kv("Nome fantasia",c.nome_fantasia),kv(c.tipo_pessoa==="PF"?"CPF":"CNPJ",cnpjMask(c.cnpj)),cliente?null:kv("CPF do titular",cnpjMask(c.cpf_titular)),
    kv("Cidade",[c.cidade,c.uf].filter(Boolean).join("/")),kv("Segmento",c.segmento),cliente?null:kv("Faturamento mensal",c.faturamento_mensal?BRL(+c.faturamento_mensal):null),cliente?null:kv("Funcionários",c.funcionarios),
    kv("Responsável no escritório",c.responsavel),cliente?null:kv("Closer",c.closer),cliente?null:kv("Origem",c.origem),cliente?null:kv("Fechamento",c.data_fechamento?fmtD(parseD(c.data_fechamento)):null),
    kv("Onboarding",c.data_onboarding?fmtD(parseD(c.data_onboarding)):null),kv("Próxima reunião",c.proxima_reuniao?fmtD(parseD(c.proxima_reuniao)):null)));
  host.append(ident);
  if(cliente){host.append(el("div",{class:"note"},"Dúvidas sobre o seu cadastro? Fale com o escritório."));return}
  // História e situação
  const hist=el("section",{class:"card section"},el("h2",{},"O que aconteceu"),c.historia?el("div",{style:"white-space:pre-wrap"},c.historia):el("div",{class:"note"},"Ainda não registrado. Use “Editar ficha” para contar a história do cliente em poucas linhas — o que levou ao endividamento e o que o closer/onboarding captou."));
  const sit=el("section",{class:"card section"},el("h2",{},"Situação atual"),c.situacao_atual?el("div",{style:"white-space:pre-wrap"},c.situacao_atual):el("div",{class:"note"},"Opera? Fatura? Está negativado? Registre aqui."),
    el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},pill("Negativado",c.negativado,"e3"),pill("Maquininha",c.usa_maquininha,"g"),pill("Consórcio",c.tem_consorcio,"g"),c.outros_cnpjs?el("span",{class:"pill g"},"Outros CNPJs: "+c.outros_cnpjs):null),
    c.assuntos_interesse?el("div",{class:"note"},el("b",{},"Quer discutir: "),c.assuntos_interesse):null,c.disponibilidade?el("div",{class:"note"},el("b",{},"Disponibilidade: "),c.disponibilidade):null);
  host.append(el("div",{class:"row2",style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px"},hist,sit));
  // Indicadores
  host.append(el("div",{class:"kpis"},
    kpi("Saldo em aberto",BRL(ind.saldoTotal),`${ind.ativos.length} contrato${ind.ativos.length===1?"":"s"} ativo${ind.ativos.length===1?"":"s"}`),
    kpi("Em negociação",BRL(ind.saldoNeg),"em atraso, com projeção"),
    kpi("Acordo projetado",BRL(ind.acordoTotal),ind.reservaTotal?`reserva sugerida ${BRL(ind.reservaTotal)}/mês`:""),
    kpi("Reserva acumulada",BRL(+c.reservaAcumulada||0),"informada pelo cliente")));
  // Sócios e contatos
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Sócios e contatos"),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openContatoForm(c)},"+ Contato"))));
  if(!ok)sec.append(el("div",{class:"note"},"Carregando…"));
  else if(!F.contatos.length)sec.append(el("div",{class:"note"},"Nenhum sócio ou contato cadastrado."));
  else sec.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Nome"),el("th",{},"Papel"),el("th",{},"CPF"),el("th",{},"Cargo"),el("th",{},"E-mail"),el("th",{},"Telefone"),el("th",{},"Login"),el("th",{},""))),
    el("tbody",{},F.contatos.map(x=>el("tr",{},el("td",{},el("b",{},x.nome),x.principal?el("span",{class:"pill g",style:"margin-left:6px"},"principal"):null,x.observacoes?el("div",{class:"note"},x.observacoes):null),el("td",{},PAPEIS[x.papel]||x.papel||"—",x.participacao?` · ${x.participacao}%`:""),el("td",{class:"num"},cnpjMask(x.cpf)||"—"),el("td",{},x.cargo||"—"),el("td",{},x.email||"—"),el("td",{},x.telefone||"—"),el("td",{},x.perfil_id?el("span",{class:"pill e1"},"tem acesso"):"—"),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openContatoForm(c,x)},"Editar"))))))));
  host.append(sec);
  // Bens
  const bens=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Bens declarados"),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openBemForm(c)},"+ Bem"))));
  if(ok&&!F.bens.length)bens.append(el("div",{class:"note"},"Nenhum bem declarado. Veículos, imóveis, maquinário e consórcios informados no onboarding entram aqui."));
  else if(ok)bens.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Tipo"),el("th",{},"Descrição"),el("th",{},"Titular"),el("th",{},"Ônus"),el("th",{class:"r"},"Valor est."),el("th",{},""))),
    el("tbody",{},F.bens.map(b=>el("tr",{},el("td",{},TIPOS_BEM[b.tipo]||b.tipo),el("td",{},b.descricao,b.observacoes?el("div",{class:"note"},b.observacoes):null),el("td",{},TITULARES_BEM[b.titular]||"—"),el("td",{},b.onus||"—"),el("td",{class:"r num"},b.valor_estimado?BRL(+b.valor_estimado):"—"),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openBemForm(c,b)},"Editar"))))))));
  host.append(bens);
  // Documentos
  const docs=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Documentos"),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openDocForm(c)},"+ Documento"))));
  if(ok&&!F.documentos.length)docs.append(el("div",{class:"note"},"Nenhum documento vinculado. Cole o link do Drive (contratos, pareceres, onboarding, cartão CNPJ)."));
  else if(ok)docs.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Título"),el("th",{},"Tipo"),el("th",{},"Data"),el("th",{},"Vínculo"),el("th",{},"Cliente vê"),el("th",{},""))),
    el("tbody",{},F.documentos.map(d=>el("tr",{},el("td",{},d.url?el("a",{href:d.url,target:"_blank",rel:"noopener",style:"color:var(--info);font-weight:600"},"↗ "+d.titulo):d.titulo,d.observacoes?el("div",{class:"note"},d.observacoes):null),el("td",{},TIPOS_DOC[d.tipo]||"—"),el("td",{},d.data?fmtD(parseD(d.data)):"—"),el("td",{},d.contrato_id?(S.contratos.find(k=>k.id===d.contrato_id)?shortName(S.contratos.find(k=>k.id===d.contrato_id)):"contrato"):d.processo_id?"processo":"—"),el("td",{},d.visivel_cliente?el("span",{class:"pill e1"},"sim"):el("span",{class:"pill e2"},"não")),el("td",{},el("button",{class:"btn sm edit-only",onclick:()=>openDocForm(c,d)},"Editar"))))))));
  host.append(docs);
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
function openFichaForm(c){
  const nome=inp("text",c.nome||""),fant=inp("text",c.nome_fantasia||""),tipo=sel({PJ:"Pessoa jurídica",PF:"Pessoa física"},c.tipo_pessoa||"PJ"),cnpj=inp("text",c.cnpj||"",{placeholder:"00.000.000/0001-00"}),cpf=inp("text",c.cpf_titular||""),
        cidade=inp("text",c.cidade||""),uf=sel({"":"—",...Object.fromEntries(UFS.map(u=>[u,u]))},c.uf||""),seg=inp("text",c.segmento||"",{placeholder:"Ex.: transportes, varejo de calçados"}),fat=inp("number",c.faturamento_mensal||"",{step:"1000"}),func=inp("number",c.funcionarios||"",{min:0}),
        resp=inp("text",c.responsavel||""),closer=inp("text",c.closer||""),origem=dl("f-origem",c.origem||"",ORIGENS),plano=dl("f-plano",c.plano||"",PLANOS),status=sel(STATUS,c.status||"ativo"),
        dfech=inp("date",c.data_fechamento||""),donb=inp("date",c.data_onboarding||""),prox=inp("date",c.proxima_reuniao||""),
        hist=el("textarea",{placeholder:"O que aconteceu com a empresa: expansão, queda de faturamento, inadimplência, execuções… em poucas linhas."},c.historia||""),sit=el("textarea",{placeholder:"Opera? Fatura? Em que conta recebe? Negativado?"},c.situacao_atual||""),
        neg=tri(c.negativado),maq=tri(c.usa_maquininha),cons=tri(c.tem_consorcio),outros=inp("text",c.outros_cnpjs||""),ass=inp("text",c.assuntos_interesse||""),disp=inp("text",c.disponibilidade||""),obs=el("textarea",{},c.observacoes_onboarding||""),
        res=inp("number",c.reservaAcumulada||0,{step:"100"});
  const body=el("div",{class:"form"},field("f-nome","Razão social / nome",nome),field("f-fant","Nome fantasia",fant),field("f-tipo","Tipo",tipo),field("f-cnpj","CNPJ / CPF",cnpj),field("f-cpf","CPF do titular / sócio",cpf),
    field("f-cid","Cidade",cidade),field("f-uf","UF",uf),field("f-seg","Segmento",seg),field("f-fat","Faturamento mensal (R$)",fat),field("f-func","Funcionários",func),
    field("f-resp","Responsável no escritório",resp),field("f-closer","Closer",closer),field("f-origem","Origem",origem.wrap),field("f-plano","Plano / serviço",plano.wrap),field("f-status","Status",status),
    field("f-dfech","Data do fechamento",dfech),field("f-donb","Data do onboarding",donb),field("f-prox","Próxima reunião",prox),field("f-res","Reserva acumulada (R$)",res),
    field("f-neg","Negativado",neg),field("f-maq","Usa maquininha",maq),field("f-cons","Tem consórcio",cons),field("f-outros","Outros CNPJs",outros),
    field("f-hist","O que aconteceu",hist),field("f-sit","Situação atual",sit),field("f-ass","Assuntos que quer discutir",ass),field("f-disp","Disponibilidade para reuniões",disp),field("f-obs","Respostas do onboarding (texto livre)",obs));
  modal("Ficha do cliente",body,async()=>{
    if(!nome.value.trim())throw new Error("Informe o nome");
    const cols={nome_fantasia:fant.value.trim()||null,tipo_pessoa:tipo.value,cnpj:cnpj.value.trim()||null,cpf_titular:cpf.value.trim()||null,cidade:cidade.value.trim()||null,uf:uf.value||null,segmento:seg.value.trim()||null,
      faturamento_mensal:fat.value===""?null:+fat.value,funcionarios:func.value===""?null:+func.value,closer:closer.value.trim()||null,origem:origem.input.value.trim()||null,plano:plano.input.value.trim()||null,status:status.value,
      data_fechamento:dfech.value||null,data_onboarding:donb.value||null,proxima_reuniao:prox.value||null,historia:hist.value.trim()||null,situacao_atual:sit.value.trim()||null,
      negativado:triVal(neg),usa_maquininha:triVal(maq),tem_consorcio:triVal(cons),outros_cnpjs:outros.value.trim()||null,assuntos_interesse:ass.value.trim()||null,disponibilidade:disp.value.trim()||null,observacoes_onboarding:obs.value.trim()||null};
    // nome, responsável, reserva e cnpj também vivem no jsonb (motor e páginas do cliente)
    const {data:cur}=await SB.from("clientes").select("dados").eq("id",c.id).single();
    const dados={...(cur?.dados||{}),nome:nome.value.trim(),cnpj:cols.cnpj||"",responsavel:resp.value.trim(),reservaAcumulada:+res.value||0};
    const {error}=await SB.from("clientes").update({...cols,dados}).eq("id",c.id);
    if(error)throw new Error("Não foi possível salvar: "+(error.message||""));
    toast("Ficha salva");notificar("clientes");
  });
}
function openContatoForm(c,x={}){
  const nome=inp("text",x.nome||""),papel=sel(PAPEIS,x.papel||"socio"),cpf=inp("text",x.cpf||""),part=inp("number",x.participacao||"",{min:0,max:100,step:"0.01"}),cargo=inp("text",x.cargo||""),email=inp("email",x.email||""),tel=inp("text",x.telefone||""),princ=check("Contato principal",x.principal),obs=el("textarea",{},x.observacoes||"");
  const body=el("div",{class:"form"},field("ct-nome","Nome",nome),field("ct-papel","Papel",papel),field("ct-cpf","CPF",cpf),field("ct-part","Participação (%)",part),field("ct-cargo","Cargo",cargo),field("ct-email","E-mail",email),field("ct-tel","Telefone / WhatsApp",tel),princ.wrap,field("ct-obs","Observações",obs));
  const extra=x.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este contato?"))return;await SB.from("contatos").delete().eq("id",x.id);$("#modalHost").replaceChildren();toast("Contato excluído");recarregar()}},"Excluir"):null;
  modal(x.id?"Editar contato":"Novo contato",body,async()=>{
    if(!nome.value.trim())throw new Error("Informe o nome");
    const row={cliente_id:c.id,nome:nome.value.trim(),papel:papel.value,cpf:cpf.value.trim()||null,participacao:part.value===""?null:+part.value,cargo:cargo.value.trim()||null,email:email.value.trim()||null,telefone:tel.value.trim()||null,principal:princ.input.checked,observacoes:obs.value.trim()||null};
    const {error}=x.id?await SB.from("contatos").update(row).eq("id",x.id):await SB.from("contatos").insert(row);if(error)throw error;
    toast("Contato salvo");recarregar();
  },extra);
}
function openBemForm(c,b={}){
  const tipo=sel(TIPOS_BEM,b.tipo||"veiculo"),desc=inp("text",b.descricao||"",{placeholder:"Ex.: Fiat Toro 2022 placa ABC1D23"}),tit=sel({"":"—",...TITULARES_BEM},b.titular||"PF"),onus=dl("b-onus",b.onus||"",["Livre","Financiado","Alienado fiduciariamente","Hipotecado","Penhorado","Bem de família","Usufruto","Vendido sem transferência"]),val=inp("number",b.valor_estimado||"",{step:"1000"}),obs=el("textarea",{},b.observacoes||"");
  const body=el("div",{class:"form"},field("b-tipo","Tipo",tipo),field("b-desc","Descrição",desc),field("b-tit","Titular",tit),field("b-onus","Ônus / situação",onus.wrap),field("b-val","Valor estimado (R$)",val),field("b-obs","Observações",obs));
  const extra=b.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este bem?"))return;await SB.from("bens").delete().eq("id",b.id);$("#modalHost").replaceChildren();toast("Bem excluído");recarregar()}},"Excluir"):null;
  modal(b.id?"Editar bem":"Novo bem",body,async()=>{
    if(!desc.value.trim())throw new Error("Descreva o bem");
    const row={cliente_id:c.id,tipo:tipo.value,descricao:desc.value.trim(),titular:tit.value||null,onus:onus.input.value.trim()||null,valor_estimado:val.value===""?null:+val.value,observacoes:obs.value.trim()||null};
    const {error}=b.id?await SB.from("bens").update(row).eq("id",b.id):await SB.from("bens").insert(row);if(error)throw error;
    toast("Bem salvo");recarregar();
  },extra);
}
function openDocForm(c,d={}){
  const tit=inp("text",d.titulo||""),tipo=sel(TIPOS_DOC,d.tipo||"outro"),url=inp("url",d.url||"",{placeholder:"https://drive.google.com/…"}),data=inp("date",d.data||""),kon=sel({"":"— sem vínculo —",...Object.fromEntries(S.contratos.filter(k=>k.clienteId===c.id).map(k=>[k.id,shortName(k)]))},d.contrato_id||""),vis=check("Visível ao cliente",d.visivel_cliente),obs=el("textarea",{},d.observacoes||"");
  const body=el("div",{class:"form"},field("d-tit","Título",tit),field("d-tipo","Tipo",tipo),field("d-url","Link (Drive, Notion, tribunal)",url),field("d-data","Data",data),field("d-kon","Contrato relacionado",kon),vis.wrap,field("d-obs","Observações",obs));
  const extra=d.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este documento?"))return;await SB.from("documentos").delete().eq("id",d.id);$("#modalHost").replaceChildren();toast("Documento excluído");recarregar()}},"Excluir"):null;
  modal(d.id?"Editar documento":"Novo documento",body,async()=>{
    if(!tit.value.trim())throw new Error("Informe o título");
    const row={cliente_id:c.id,titulo:tit.value.trim(),tipo:tipo.value,url:url.value.trim()||null,data:data.value||null,contrato_id:kon.value||null,visivel_cliente:vis.input.checked,observacoes:obs.value.trim()||null};
    const {error}=d.id?await SB.from("documentos").update(row).eq("id",d.id):await SB.from("documentos").insert(row);if(error)throw error;
    toast("Documento salvo");recarregar();
  },extra);
}


/* ---------- Cofre: senha e 2FA (TOTP) — o segredo nunca chega ao navegador ---------- */
function celSenha(x){
  if(!x.tem_senha)return el("span",{class:"note"},"—");
  const sp=el("span",{class:"num"},"••••••••");let on=false,cache=null;
  const pegar=async(motivo)=>{if(cache)return cache;const {data,error}=await SB.rpc("acesso_senha",{acesso_id:x.id,motivo});if(error)throw error;cache=data;return data};
  const bt=el("button",{class:"btn sm",onclick:async()=>{try{if(!on){sp.textContent=await pegar("ver_senha")||"—"}else sp.textContent="••••••••";on=!on;bt.textContent=on?"Ocultar":"Mostrar"}catch(e){toast("Não foi possível obter a senha")}}},"Mostrar");
  const cp=el("button",{class:"btn sm",onclick:async()=>{try{await navigator.clipboard.writeText(await pegar("copiar_senha")||"");toast("Senha copiada")}catch{toast("Não foi possível copiar")}}},"Copiar");
  return el("div",{style:"display:flex;gap:6px;align-items:center"},sp,bt,cp);
}
function cel2fa(c,x){
  if(!x.tem_2fa)return el("button",{class:"btn sm edit-only",onclick:()=>open2faForm(c,x)},"Configurar 2FA");
  const w=window.PP_TOTP?window.PP_TOTP.widget(x.id,{compacto:true}):el("span",{class:"note"},"carregando…");
  return el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap"},w,el("button",{class:"btn sm edit-only",title:"Substituir ou remover o 2FA",onclick:()=>open2faForm(c,x)},"⚙"));
}
function open2faForm(c,x){
  const seg=el("textarea",{rows:"3",placeholder:"Cole a chave manual (ex.: gezd gnbv gy3t qojq …) ou a URI otpauth://totp/…",autocomplete:"off",spellcheck:"false"});
  const st=el("div",{class:"note"});
  const arq=inp("file","",{accept:"image/*"});arq.onchange=async()=>{const f=arq.files?.[0];if(!f)return;st.textContent="Lendo QR…";try{const r=await lerQrImagem(f);if(r){seg.value=r;st.textContent="QR lido. Confira e salve."}else st.textContent="Não encontrei um QR nessa imagem."}catch(e){st.textContent="Não foi possível ler a imagem."}};
  let stream=null,raf=null;const video=el("video",{style:"width:100%;max-height:260px;border-radius:8px;background:#000;display:none",playsinline:"",muted:""});
  const parar=()=>{if(raf)cancelAnimationFrame(raf);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.style.display="none"};
  const cam=el("button",{class:"btn sm",onclick:async()=>{if(stream){parar();cam.textContent="Ler com a câmera";return}try{await carregarJsQR();stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});video.srcObject=stream;video.style.display="block";await video.play();cam.textContent="Parar câmera";
      const cv=document.createElement("canvas");const ctx=cv.getContext("2d",{willReadFrequently:true});
      const tick=()=>{if(!stream)return;if(video.readyState===4){cv.width=video.videoWidth;cv.height=video.videoHeight;ctx.drawImage(video,0,0);const img=ctx.getImageData(0,0,cv.width,cv.height);const q=window.jsQR(img.data,img.width,img.height);if(q?.data){seg.value=q.data;st.textContent="QR lido. Confira e salve.";parar();cam.textContent="Ler com a câmera";return}}raf=requestAnimationFrame(tick)};tick();
    }catch(e){st.textContent="Câmera indisponível neste dispositivo/navegador. Use a chave manual ou uma imagem do QR."}}},"Ler com a câmera");
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`${x.sistema}${x.login?" · "+x.login:""}. No sistema do cliente, ative a verificação em duas etapas por aplicativo autenticador e use a chave/QR aqui — o painel passa a gerar os códigos para a equipe.`),
    el("div",{class:"f full"},el("label",{},"Chave ou QR"),seg),el("div",{class:"f full",style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center"},el("label",{class:"btn sm",style:"cursor:pointer"},"Ler QR de uma imagem",Object.assign(arq,{style:"display:none"})),cam),el("div",{class:"f full"},video),el("div",{class:"f full"},st));
  const extra=x.tem_2fa&&PP.perfil?.papel==="admin"?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Remover o 2FA deste acesso?"))return;const {error}=await SB.rpc("totp_remover",{acesso_id:x.id});if(error){toast("Não foi possível remover");return}parar();$("#modalHost").replaceChildren();toast("2FA removido");recarregar()}},"Remover 2FA"):null;
  modal(x.tem_2fa?"Substituir 2FA":"Configurar 2FA",body,async()=>{
    const v=seg.value.trim();if(!v)throw new Error("Cole a chave ou leia o QR");
    const {error}=await SB.rpc("totp_cadastrar",{acesso_id:x.id,segredo:v});if(error)throw new Error(error.message||"Segredo inválido");
    parar();toast("2FA cadastrado — o código já pode ser gerado");recarregar();
  },extra);
  const ob=new MutationObserver(()=>{if(!document.body.contains(body)){parar();ob.disconnect()}});ob.observe($("#modalHost"),{childList:true});
}
const carregarJsQR=()=>new Promise((res,rej)=>{if(window.jsQR)return res();const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";sc.onload=res;sc.onerror=rej;document.head.append(sc)});
async function lerQrImagem(file){
  await carregarJsQR();const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});
    for(const esc of [1,2,0.5]){const cv=document.createElement("canvas");cv.width=Math.round(img.width*esc);cv.height=Math.round(img.height*esc);const ctx=cv.getContext("2d");ctx.drawImage(img,0,0,cv.width,cv.height);const d=ctx.getImageData(0,0,cv.width,cv.height);const q=window.jsQR(d.data,d.width,d.height);if(q?.data)return q.data}
    return null}finally{URL.revokeObjectURL(url)}
}

function openAcessoForm(c,x={}){
  const sis=dl("ac-sis",x.sistema||"gov.br",SISTEMAS),tit=inp("text",x.titular||"",{placeholder:"Empresa / sócio"}),login=inp("text",x.login||"",{autocomplete:"off"}),senha=inp("password",""+"",{autocomplete:"new-password",placeholder:x.tem_senha?"•••••••• (deixe em branco para manter)":"opcional"}),obs=el("textarea",{placeholder:"2FA? qual telefone recebe o código? validade?"},x.observacoes||"");
  const body=el("div",{class:"form"},field("ac-sis","Sistema",sis.wrap),field("ac-tit","Titular do acesso",tit),field("ac-login","Login (CPF/CNPJ/usuário)",login),field("ac-senha","Senha",senha,x.tem_senha?"Guardada no cofre. Para trocar, digite a nova; para apagar, digite \"apagar\".":"Vai para o cofre criptografado, não fica na tabela."),field("ac-obs","Observações",obs));
  const extra=x.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este acesso?"))return;await SB.from("acessos_sistemas").delete().eq("id",x.id);$("#modalHost").replaceChildren();toast("Acesso excluído");recarregar()}},"Excluir"):null;
  modal(x.id?"Editar acesso":"Novo acesso",body,async()=>{
    if(!sis.input.value.trim())throw new Error("Informe o sistema");
    const row={cliente_id:c.id,sistema:sis.input.value.trim(),titular:tit.value.trim()||null,login:login.value.trim()||null,observacoes:obs.value.trim()||null};
    let id=x.id;if(id){const {error}=await SB.from("acessos_sistemas").update(row).eq("id",id);if(error)throw error}else{const {data,error}=await SB.from("acessos_sistemas").insert(row).select("id").single();if(error)throw error;id=data.id}
    const sv=senha.value;if(sv){const {error}=await SB.rpc("acesso_senha_definir",{acesso_id:id,senha:sv.trim().toLowerCase()==="apagar"?"":sv});if(error)throw error}
    toast("Acesso salvo");recarregar();
  },extra);
}

/* ---------- Integração ---------- */
window.PP_MOD=window.PP_MOD||{};
window.PP_MOD.resumo=renderResumo;
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("ficha");for(const t of ["contatos","bens","documentos","acessos_sistemas"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>recarregar());ch.subscribe()}});
})();
