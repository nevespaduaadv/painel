/* Revisional de contratos PJ — calculadora de encargos × taxa média do BACEN, checklist de teses e parecer preliminar.
   Supabase: bacen_series, bacen_taxas (cache), teses_revisionais, revisoes, revisao_teses, v_revisoes (0031).
   A taxa média vem da API pública do BACEN (SGS, CORS liberado) e é guardada em bacen_taxas para reprodutibilidade.
   Limite: triagem técnica, não parecer final — a abusividade é decisão do advogado (ver Tema 1.378/STJ). */
(()=>{
"use strict";
const V={series:[],teses:[],lista:[],ok:false,contrato:null,rev:null,ent:null,res:null,teseStatus:{},carregandoMedia:false,erroMedia:null,abrirContrato:null};
const BCB="https://api.bcb.gov.br/dados/serie/bcdata.sgs.";
const admin=()=>PP.perfil?.papel==="admin";
const num=x=>{const v=parseFloat(String(x??"").replace(",","."));return Number.isFinite(v)?v:null};
const pc=(x,d=2)=>x==null?"—":x.toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d})+"%";
const brl=x=>x==null?"—":BRL(x);
const p2=n=>String(n).padStart(2,"0");
const hoje=()=>new Date().toISOString().slice(0,10);
const mes1=s=>s?s.slice(0,7)+"-01":null;
const fmtMes=s=>{const [y,m]=s.split("-");return `${p2(m)}/${y}`};
const aa=am=>am==null?null:(Math.pow(1+am/100,12)-1)*100;           // mensal → anual equivalente
const amDe=a=>a==null?null:(Math.pow(1+a/100,1/12)-1)*100;           // anual → mensal equivalente
// série padrão por produto do contrato (prazo decide capital de giro)
const SERIE_POR_PRODUTO={cheque:25446,contagar:25445,cartao:25455,receb:25438,veiculo:25447,leasing:25450,imovel:25486,rural_custeio:25483,rural_invest:25483,pronampe:29978};
const serieGiro=prazo=>prazo&&prazo<=12?25441:25442;
const ROTATIVOS=new Set([25443,25445,25446,25455]);

// ---------- matemática financeira ----------
function price(P,i,n){if(!P||!n)return null;if(!i)return {parcela:P/n,total:P,juros:0};const im=i/100;const parcela=P*im/(1-Math.pow(1+im,-n));return {parcela,total:parcela*n,juros:parcela*n-P}}
function sac(P,i,n){if(!P||!n)return null;const im=(i||0)/100;const am=P/n;const juros=im*P*(n+1)/2;return {parcela:am+P*im,parcelaFinal:am+am*im,total:P+juros,juros}}
function tir(P,parcela,n){if(!P||!parcela||!n||parcela*n<=P)return null;let lo=0,hi=1;for(let k=0;k<80;k++){const mid=(lo+hi)/2;const pv=parcela*(1-Math.pow(1+mid,-n))/mid;if(pv>P)lo=mid;else hi=mid}return (lo+hi)/2*100}
function iofEsperado(P,dias){if(!P)return null;const d=Math.min(Math.max(dias||0,0),365);return P*(0.0038+0.000041*d)}

// ---------- dados ----------
async function carregar(){
  if(V.ok)return true;
  const [s,t,l]=await Promise.all([SB.from("bacen_series").select("*").eq("ativo",true).order("grupo").order("nome"),SB.from("teses_revisionais").select("*").eq("ativo",true).order("ordem"),SB.from("v_revisoes").select("*").order("updated_at",{ascending:false}).limit(200)]);
  V.series=s.data||[];V.teses=t.data||[];V.lista=l.data||[];V.ok=true;return true;
}
async function recarregarLista(){const {data}=await SB.from("v_revisoes").select("*").order("updated_at",{ascending:false}).limit(200);V.lista=data||[]}
// taxa média do mês (cache em bacen_taxas → API do BACEN)
async function taxaMedia(serie,mesIso){
  if(!serie||!mesIso)return null;
  const {data}=await SB.from("bacen_taxas").select("*").eq("serie",serie).eq("mes",mesIso).maybeSingle();
  if(data)return +data.valor;
  const [y,m]=mesIso.split("-").map(Number);const ini=`01/${p2(m)}/${y}`;const fimD=new Date(y,m,0);const fim=`${p2(fimD.getDate())}/${p2(m)}/${y}`;
  const r=await fetch(`${BCB}${serie}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`);
  if(!r.ok)throw new Error("BACEN respondeu "+r.status);
  const rows=await r.json();if(!Array.isArray(rows)||!rows.length)return null;
  const v=num(rows[rows.length-1].valor);if(v==null)return null;
  await SB.from("bacen_taxas").upsert({serie,mes:mesIso,valor:v});
  return v;
}
// contexto: 3 meses em volta (só para exibição)
async function contexto(serie,mesIso){try{const [y,m]=mesIso.split("-").map(Number);const a=new Date(y,m-3,1),b=new Date(y,m+1,0);const r=await fetch(`${BCB}${serie}/dados?formato=json&dataInicial=01/${p2(a.getMonth()+1)}/${a.getFullYear()}&dataFinal=${p2(b.getDate())}/${p2(b.getMonth()+1)}/${b.getFullYear()}`);const rows=r.ok?await r.json():[];return Array.isArray(rows)?rows.map(x=>({mes:x.data.slice(3),valor:num(x.valor)})):[]}catch(_){return []}}

// ---------- entradas ----------
function entradasPadrao(k){
  const prazo=+k.parcelasTotal||null;
  return {serie:SERIE_POR_PRODUTO[k.produto]||serieGiro(prazo),data:k.dataContrato||"",valor:+k.valorOriginal||null,prazo,sistema:ROTATIVOS.has(SERIE_POR_PRODUTO[k.produto])?"rotativo":"price",
    taxaMensal:null,taxaAnual:null,parcela:null,cet:null,clausulaCap:"nao_consta",capDiaria:"nao",
    moraJuros:1,multa:2,comissaoPerm:"nao",comissaoCumulada:"nao",
    tarifas:{tac:0,tec:0,cadastro:0,avaliacao:0,registro:0,seguro:0,iof:0,outras:0},
    relacionamentoAnterior:"nao_sei",seguroOpcional:"nao_sei",avaliacaoComprovada:"nao_sei",porte:"me_epp",prazoDias:null};
}

// ---------- cálculo ----------
function calcular(e,media,selic){
  const r={serie:e.serie,media,mes:mes1(e.data),avisos:[]};
  const s=V.series.find(x=>x.codigo===+e.serie);r.serieNome=s?s.nome:String(e.serie);
  const i=num(e.taxaMensal),ia=num(e.taxaAnual),P=num(e.valor),n=e.sistema==="rotativo"?null:(+e.prazo||null);
  // 1. média BACEN
  if(i!=null&&media!=null){r.razao=i/media;r.classe=r.razao>=1.5?"forte":r.razao>=1.2?"indicio":"dentro";r.mediaAA=aa(media)}
  if(i!=null)r.taxaAA=aa(i);
  // 1b. teto regulado (Pronampe)
  if(e.serie===29978||V.contrato?.produto==="pronampe"){if(selic!=null){const antes=e.data&&e.data<"2021-06-02";r.tetoPronampe={selic,spread:antes?1.25:6,aa:selic+(antes?1.25:6)};r.tetoPronampe.am=amDe(r.tetoPronampe.aa);if(i!=null)r.acimaTeto=i>r.tetoPronampe.am+0.005}else r.avisos.push("Selic do mês não disponível para calcular o teto do Pronampe.")}
  // 2. duodécuplo
  if(i!=null){r.duodecuplo=i*12;r.equivalente=aa(i);
    if(ia==null)r.capSituacao="sem_anual";
    else if(Math.abs(ia-r.duodecuplo)<0.01)r.capSituacao="proporcional";
    else if(ia>r.duodecuplo&&ia<=r.equivalente+0.02)r.capSituacao="presume";
    else if(ia>r.equivalente+0.02)r.capSituacao="acima_equivalente";
    else r.capSituacao="abaixo";}
  // 3. TIR
  const parc=num(e.parcela);if(P&&n&&parc){r.tir=tir(P,parc,n);if(r.tir!=null&&i!=null)r.tirDif=r.tir-i}
  // 4. CET
  const cet=num(e.cet);if(cet!=null&&i!=null){r.cetSituacao=cet+0.01<r.taxaAA?"abaixo_taxa":"ok"}else if(cet==null)r.cetSituacao="ausente";
  // 5. parcelas e totais
  if(P&&n&&i!=null){
    r.contratada=e.sistema==="sac"?sac(P,i,n):price(P,i,n);
    r.semCapitalizacao=sac(P,i,n);
    if(media!=null)r.pelaMedia=e.sistema==="sac"?sac(P,media,n):price(P,media,n);
    if(r.pelaMedia)r.difMedia=r.contratada.juros-r.pelaMedia.juros;
    r.difCapitalizacao=r.contratada.juros-r.semCapitalizacao.juros;
    if(r.tetoPronampe&&r.tetoPronampe.am!=null){const t=e.sistema==="sac"?sac(P,r.tetoPronampe.am,n):price(P,r.tetoPronampe.am,n);r.difTeto=r.contratada.juros-t.juros}
  }else if(P&&e.sistema==="rotativo"&&i!=null){r.rotativo={jurosMes:P*i/100,jurosMesMedia:media!=null?P*media/100:null,juros12:P*(Math.pow(1+i/100,12)-1),juros12Media:media!=null?P*(Math.pow(1+media/100,12)-1):null}}
  // 6. mora
  const mj=num(e.moraJuros),mu=num(e.multa);r.moraJurosAcima=mj!=null&&mj>1.0001;r.multaAcima=mu!=null&&mu>2.0001;
  r.comissao=e.comissaoPerm==="sim";r.comissaoCumulada=r.comissao&&e.comissaoCumulada==="sim";r.comissaoPos2017=r.comissao&&e.data&&e.data>="2017-09-01";
  // 7. tarifas
  const t=e.tarifas||{};const tv=k=>num(t[k])||0;
  r.tarifas={tac:tv("tac"),tec:tv("tec"),cadastro:tv("cadastro"),avaliacao:tv("avaliacao"),registro:tv("registro"),seguro:tv("seguro"),iof:tv("iof"),outras:tv("outras")};
  r.tacTecIndevida=(r.tarifas.tac+r.tarifas.tec)>0&&e.data>="2008-05-01";
  r.iofEsperado=iofEsperado(P,e.prazoDias||(n?n*30:365));r.iofAcima=r.tarifas.iof>0&&r.iofEsperado!=null&&r.tarifas.iof>r.iofEsperado*1.05;
  r.repeticaoPotencial=(r.tacTecIndevida?r.tarifas.tac+r.tarifas.tec:0)+(e.relacionamentoAnterior==="sim"?r.tarifas.cadastro:0)+(e.avaliacaoComprovada==="nao"?r.tarifas.avaliacao+r.tarifas.registro:0)+(e.seguroOpcional==="nao"?r.tarifas.seguro:0)+(r.iofAcima?r.tarifas.iof-r.iofEsperado:0);
  // 8. teses automáticas
  const st={};
  st.juros_media=r.classe==="forte"?"indicio":r.classe==="indicio"?"indicio":r.classe==="dentro"?"nao_aplica":"verificar";
  if(r.acimaTeto)st.juros_media="constatada";
  st.capitalizacao=r.capSituacao==="presume"||r.capSituacao==="acima_equivalente"?(e.clausulaCap==="sim"?"nao_aplica":"indicio"):r.capSituacao==="proporcional"||r.capSituacao==="sem_anual"?(e.clausulaCap==="sim"?"nao_aplica":"indicio"):"verificar";
  if(e.capDiaria==="sim")st.capitalizacao="indicio";
  st.taxa_divergente=r.tirDif!=null?(r.tirDif>0.05?"constatada":"nao_aplica"):"verificar";
  st.cet=r.cetSituacao==="abaixo_taxa"?"constatada":r.cetSituacao==="ausente"?"indicio":"nao_aplica";
  st.mora_juros=mj==null?"verificar":r.moraJurosAcima?"constatada":"nao_aplica";
  st.mora_multa=mu==null?"verificar":r.multaAcima?"constatada":"nao_aplica";
  st.comissao_permanencia=r.comissaoCumulada||r.comissaoPos2017?"constatada":r.comissao?"indicio":"nao_aplica";
  st.tac_tec=r.tacTecIndevida?"constatada":(r.tarifas.tac+r.tarifas.tec)>0?"indicio":"nao_aplica";
  st.tarifa_cadastro=r.tarifas.cadastro>0?(e.relacionamentoAnterior==="sim"?"constatada":"verificar"):"nao_aplica";
  st.tarifa_avaliacao_registro=(r.tarifas.avaliacao+r.tarifas.registro)>0?(e.avaliacaoComprovada==="nao"?"constatada":"verificar"):"nao_aplica";
  st.seguro_prestamista=r.tarifas.seguro>0?(e.seguroOpcional==="nao"?"constatada":"verificar"):"nao_aplica";
  st.iof_financiado=r.tarifas.iof>0?(r.iofAcima?"indicio":"nao_aplica"):"nao_aplica";
  const normalidade=["juros_media","capitalizacao","taxa_divergente"].some(k=>st[k]==="constatada")||st.capitalizacao==="indicio"&&r.classe==="forte";
  st.descaracterizacao_mora=normalidade?"indicio":"verificar";
  r.auto=st;
  const imp={juros_media:r.difMedia,capitalizacao:r.difCapitalizacao,tac_tec:r.tacTecIndevida?r.tarifas.tac+r.tarifas.tec:null,tarifa_cadastro:e.relacionamentoAnterior==="sim"?r.tarifas.cadastro:null,tarifa_avaliacao_registro:e.avaliacaoComprovada==="nao"?r.tarifas.avaliacao+r.tarifas.registro:null,seguro_prestamista:e.seguroOpcional==="nao"?r.tarifas.seguro:null,iof_financiado:r.iofAcima?r.tarifas.iof-r.iofEsperado:null};
  if(r.acimaTeto&&r.difTeto!=null)imp.juros_media=r.difTeto;
  r.impactos=imp;
  return r;
}

// ---------- tela ----------
function renderRevisional(){
  const v=$("#view-revisional");if(!v)return;v.replaceChildren();
  if(!V.ok){v.append(el("div",{class:"note"},"Carregando…"));carregar().then(()=>{if(V.abrirContrato){abrirContrato(V.abrirContrato);V.abrirContrato=null}render()});return}
  if(V.contrato){renderCalculadora(v);return}
  v.append(el("div",{class:"section-h"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Revisional de contratos"),el("p",{class:"note"},"Compare os encargos do contrato com a taxa média do BACEN na data da contratação e marque as teses revisionais do escritório. Triagem técnica: o enquadramento final é do advogado.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:novaRevisao},"+ Nova revisão"))));
  const sec=el("section",{class:"card section"},el("h3",{},`Revisões (${V.lista.length})`));
  if(!V.lista.length)sec.append(el("div",{class:"empty"},"Nenhuma revisão ainda. Clique em “Nova revisão” ou abra um contrato e use “Revisional”."));
  else sec.append(el("table",{class:"tbl"},el("thead",{},el("tr",{},...["Cliente","Banco · produto","Título","Constatadas","Indícios","Status","Atualizada","Por"].map(h=>el("th",{},h)))),
    el("tbody",{},V.lista.map(r=>el("tr",{style:"cursor:pointer",onclick:()=>abrirRevisao(r)},el("td",{},r.cliente_nome||"—"),el("td",{},`${r.banco||"—"} · ${PRODUTOS[r.produto]||r.produto||""}`),el("td",{},r.titulo||"—"),el("td",{class:"num"},String(r.constatadas)),el("td",{class:"num"},String(r.indicios)),el("td",{},el("span",{class:"pill "+(r.status==="concluida"?"e1":"g")},r.status==="concluida"?"Concluída":"Rascunho")),el("td",{},new Date(r.updated_at).toLocaleDateString("pt-BR")),el("td",{},r.criado_por_nome||"—"))))));
  v.append(sec);
}
function novaRevisao(){
  const cli=sel({"":"— escolha o cliente —",...Object.fromEntries(S.clientes.slice().sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome||c.id]))},"");
  const kon=sel({"":"— escolha o contrato —"},"");
  cli.onchange=()=>{kon.replaceChildren();kon.append(el("option",{value:""},"— escolha o contrato —"));S.contratos.filter(k=>k.clienteId===cli.value).forEach(k=>kon.append(el("option",{value:k.id},`${k.banco||"Banco"} · ${PRODUTOS[k.produto]||k.produto||""} · ${BRL(+k.valorOriginal||0)}`)))};
  const body=el("div",{class:"form"},field("rv-cli","Cliente",cli),field("rv-kon","Contrato",kon));
  modal("Nova revisão",body,async()=>{if(!kon.value)throw new Error("Escolha o contrato");abrirContrato(kon.value)});
}
function abrirContrato(id){const k=S.contratos.find(x=>x.id===id);if(!k){toast("Contrato não encontrado");return}V.contrato=k;V.rev=null;V.ent=entradasPadrao(k);V.res=null;V.teseStatus={};S.tab="revisional";render();atualizarMedia()}
async function abrirRevisao(r){const k=S.contratos.find(x=>x.id===r.contrato_id);if(!k){toast("Contrato não encontrado no painel");return}
  const {data:ts}=await SB.from("revisao_teses").select("*").eq("revisao_id",r.id);
  V.contrato=k;V.rev=r;V.ent={...entradasPadrao(k),...(r.entradas||{})};V.res=null;V.teseStatus={};(ts||[]).forEach(t=>V.teseStatus[t.tese]={status:t.status,automatico:t.automatico,nota:t.nota||"",valor:t.valor_impacto});
  S.tab="revisional";render();atualizarMedia();}
async function atualizarMedia(){
  const e=V.ent;const mes=mes1(e.data);V.erroMedia=null;
  if(!mes||!e.serie){V.media=null;V.ctx=[];recalcular();return}
  V.carregandoMedia=true;const out=$("#rv-out");if(out)out.firstChild.replaceWith(renderResultado(V.res||{}));else render();
  try{const [m,ctx]=await Promise.all([taxaMedia(+e.serie,mes),contexto(+e.serie,mes)]);V.media=m;V.ctx=ctx;
    V.selic=null;if(+e.serie===29978||V.contrato?.produto==="pronampe"){V.selic=await taxaMedia(432,mes).catch(()=>null)}
    if(m==null)V.erroMedia="Sem taxa média publicada para "+fmtMes(mes)+" nesta série.";}
  catch(err){V.media=null;V.erroMedia="Não foi possível consultar o BACEN: "+(err.message||"");}
  V.carregandoMedia=false;recalcular();
}
function recalcular(){V.res=calcular(V.ent,V.media,V.selic);const out=$("#rv-out");if(out&&!V.carregandoMedia){out.replaceChildren(renderResultado(V.res),renderTeses(V.res))}else render()}

function renderCalculadora(v){
  const k=V.contrato,e=V.ent,r=V.res||{};const c=S.clientes.find(x=>x.id===k.clienteId);
  v.append(el("div",{class:"section-h"},el("div",{},el("div",{class:"eyebrow"},"Jurídico · Revisional"),el("h1",{},`${c?.nome||"Cliente"} — ${k.banco||"Banco"}`),el("p",{class:"note"},`${PRODUTOS[k.produto]||k.produto||""} · ${GARANTIAS[k.garantia]||""} · valor original ${BRL(+k.valorOriginal||0)}${k.dataContrato?" · contratado em "+k.dataContrato.split("-").reverse().join("/"):""}`)),
    el("div",{class:"actions"},el("button",{class:"btn",onclick:()=>{V.contrato=null;V.rev=null;render()}},"← Revisões"),el("button",{class:"btn",onclick:()=>{S.tab="clientes";S.sel=k.clienteId;S.sub="contratos";render()}},"Abrir cliente"),el("button",{class:"btn",onclick:parecer},"Parecer preliminar"),el("button",{class:"btn primary",onclick:()=>salvar(false)},"Salvar"),el("button",{class:"btn gold",onclick:()=>salvar(true)},"Concluir revisão"))));
  v.append(renderEntradas());
  v.append(el("div",{id:"rv-out",style:"display:contents"},renderResultado(r),renderTeses(r)));
  v.append(el("div",{class:"disclaimer"},"A comparação com a taxa média é um indicador inicial, não uma conclusão (Tema 27/STJ; Tema 1.378/STJ pendente). Para cliente PJ, o CDC só se aplica com vulnerabilidade demonstrada. A quantificação de capitalização e excesso depende de perícia contábil sobre a evolução do saldo."));
}
function campo(label,input,help){return field("rv-"+label.replace(/\W+/g,"-").toLowerCase(),label,input,help)}
function renderEntradas(){
  const e=V.ent;const on=(inpt,fn)=>{inpt.addEventListener("change",()=>{fn(inpt.value);recalcular()});return inpt};
  const serie=sel(Object.fromEntries(V.series.filter(s=>s.grupo!=="referencia").map(s=>[s.codigo,`${s.codigo} · ${s.nome}`])),String(e.serie));serie.onchange=()=>{e.serie=+serie.value;atualizarMedia()};
  const data=inp("date",e.data);data.onchange=()=>{e.data=data.value;atualizarMedia()};
  const sistema=on(sel({price:"Price (parcelas fixas)",sac:"SAC (amortização constante)",rotativo:"Rotativo (limite / conta)"},e.sistema),v=>e.sistema=v);
  const n=(k,attrs={})=>on(inp("number",e[k]??"",{step:"0.01",min:"0",...attrs}),v=>e[k]=v===""?null:+v);
  const t=(k)=>on(inp("number",e.tarifas[k]||"",{step:"0.01",min:"0"}),v=>e.tarifas[k]=+v||0);
  const o3=(k,opts)=>on(sel(opts,e[k]),v=>e[k]=v);
  const SNN={sim:"Sim",nao:"Não",nao_sei:"Não sei / verificar"};
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h3",{},"1. Dados do contrato"),el("span",{class:"note"},"Taxas em % · valores em R$")));
  sec.append(el("div",{class:"form"},campo("Série do BACEN (modalidade)",serie,"Taxa média mensal, recursos livres, PJ"),campo("Data da contratação",data),campo("Valor liberado",n("valor",{step:"100"})),campo("Sistema",sistema),campo("Prazo (meses)",n("prazo",{step:"1"})),
    campo("Taxa mensal contratada (%)",n("taxaMensal",{step:"0.0001"})),campo("Taxa anual contratada (%)",n("taxaAnual",{step:"0.0001"}),"Como consta no contrato"),campo("Parcela contratual (R$)",n("parcela",{step:"0.01"}),"Opcional: para a taxa implícita (TIR)"),campo("CET anual informado (%)",n("cet",{step:"0.0001"})),
    campo("Cláusula expressa de capitalização",o3("clausulaCap",{sim:"Sim, expressa (mensal)",nao:"Não há",nao_consta:"Não verifiquei ainda"})),campo("Capitalização diária prevista",o3("capDiaria",{nao:"Não",sim:"Sim"})),campo("Porte da empresa",o3("porte",{me_epp:"ME / EPP",medio:"Médio porte",grande:"Grande porte"}),"Afeta CET e CDC")));
  sec.append(el("h3",{style:"margin-top:14px"},"2. Encargos de inadimplência"),el("div",{class:"form"},campo("Juros de mora (% a.m.)",n("moraJuros",{step:"0.01"})),campo("Multa moratória (%)",n("multa",{step:"0.01"})),campo("Comissão de permanência prevista",o3("comissaoPerm",{nao:"Não",sim:"Sim"})),campo("Cumulada com juros/multa/correção",o3("comissaoCumulada",{nao:"Não",sim:"Sim"}))));
  sec.append(el("h3",{style:"margin-top:14px"},"3. Tarifas e produtos embutidos (R$)"),el("div",{class:"form"},campo("TAC (abertura de crédito)",t("tac")),campo("TEC (emissão de boleto/carnê)",t("tec")),campo("Tarifa de cadastro",t("cadastro")),campo("Tarifa de avaliação do bem",t("avaliacao")),campo("Registro do contrato",t("registro")),campo("Seguro prestamista",t("seguro")),campo("IOF financiado",t("iof")),campo("Outras tarifas",t("outras")),
    campo("Cliente já tinha relacionamento com o banco",o3("relacionamentoAnterior",SNN)),campo("Avaliação/registro comprovados (laudo, registro)",o3("avaliacaoComprovada",SNN)),campo("Seguro com livre escolha / possibilidade de recusa",o3("seguroOpcional",SNN))));
  return sec;
}
const PILL={forte:["e3","Indício forte"],indicio:["e2","Indício"],dentro:["e1","Dentro da média"]};
function renderResultado(r){
  const e=V.ent;const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h3",{},"4. Resultado"),el("span",{class:"note"},r.serieNome?`Série ${e.serie} · ${r.serieNome}`:"")));
  if(V.carregandoMedia){sec.append(el("div",{class:"note"},"Consultando o BACEN…"));return sec}
  if(V.erroMedia)sec.append(el("div",{class:"note",style:"color:var(--crit)"},V.erroMedia));
  const kpi=(l,v,h)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v"},v),h?el("div",{class:"h"},h):null);
  const mes=r.mes?fmtMes(r.mes):"—";
  sec.append(el("div",{class:"kpis rv-kpis"},
    kpi("Taxa contratada",pc(num(e.taxaMensal),2)+" a.m.",r.taxaAA!=null?`${pc(r.taxaAA,2)} a.a. equivalente`:"informe a taxa mensal"),
    kpi(`Média BACEN · ${mes}`,r.media!=null?pc(r.media,2)+" a.m.":"—",r.mediaAA!=null?`${pc(r.mediaAA,2)} a.a. · ${(V.ctx||[]).map(x=>`${x.mes.slice(0,2)}: ${x.valor?.toFixed(2)}`).join(" · ")}`:"sem dado do mês"),
    kpi("Razão contratada ÷ média",r.razao!=null?r.razao.toLocaleString("pt-BR",{maximumFractionDigits:2})+"×":"—",r.classe?el("span",{class:"pill "+PILL[r.classe][0]},PILL[r.classe][1]):"—"),
    r.tetoPronampe?kpi("Teto Pronampe",pc(r.tetoPronampe.am,2)+" a.m.",`Selic ${pc(r.tetoPronampe.selic,2)} + ${r.tetoPronampe.spread}% a.a. · ${r.acimaTeto?"ACIMA do teto":"dentro do teto"}`):
    kpi("Capitalização (duodécuplo)",r.duodecuplo!=null?`12× = ${pc(r.duodecuplo,2)}`:"—",r.capSituacao?({sem_anual:"Contrato sem taxa anual: falta de transparência",proporcional:"Anual = 12× mensal: capitalização NÃO presumida",presume:`Anual entre 12× e ${pc(r.equivalente,2)}: presume pactuação (Súm. 541)`,acima_equivalente:`Anual acima da equivalente (${pc(r.equivalente,2)}): inconsistência, verificar`,abaixo:"Anual abaixo de 12× a mensal: verificar"})[r.capSituacao]:"")));
  const linhas=[];
  if(r.contratada){const cen=[["Contratada ("+(e.sistema==="sac"?"SAC":"Price")+")",r.contratada],["Sem capitalização (juros simples sobre saldo, SAC)",r.semCapitalizacao],r.pelaMedia?[`Pela média BACEN (${pc(r.media,2)} a.m.)`,r.pelaMedia]:null].filter(Boolean);
    linhas.push(el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Cenário"),el("th",{},"1ª parcela"),el("th",{},"Total pago"),el("th",{},"Juros"),el("th",{},"Diferença"))),el("tbody",{},cen.map(([l,x])=>el("tr",{},el("td",{},l),el("td",{class:"num"},brl(x.parcela)),el("td",{class:"num"},brl(x.total)),el("td",{class:"num"},brl(x.juros)),el("td",{class:"num"},x===r.contratada?"—":brl(r.contratada.juros-x.juros)))))));
    if(r.tir!=null)linhas.push(el("div",{class:"note"},`Taxa implícita da parcela informada (TIR): ${pc(r.tir,3)} a.m. — ${r.tirDif>0.05?"acima da contratada em "+pc(r.tirDif,3)+" p.p.: indício de cobrança divergente":"compatível com a contratada"}.`));
  }else if(r.rotativo){linhas.push(el("div",{class:"note"},`Rotativo: juros de ${brl(r.rotativo.jurosMes)}/mês sobre ${brl(num(e.valor))} (${brl(r.rotativo.juros12)} em 12 meses)${r.rotativo.jurosMesMedia!=null?` · pela média seriam ${brl(r.rotativo.jurosMesMedia)}/mês (${brl(r.rotativo.juros12Media)} em 12 meses)`:""}.`))}
  else linhas.push(el("div",{class:"note"},"Informe valor, prazo e taxa mensal para simular as parcelas."));
  const tar=r.tarifas?Object.values(r.tarifas).reduce((a,b)=>a+b,0):0;
  if(tar)linhas.push(el("div",{class:"note"},`Tarifas e produtos embutidos: ${brl(tar)} · repetição potencial com as respostas atuais: ${brl(r.repeticaoPotencial||0)}${r.iofEsperado!=null&&r.tarifas.iof?` · IOF esperado ≈ ${brl(r.iofEsperado)}${r.iofAcima?" (cobrado acima)":""}`:""}.`));
  sec.append(el("div",{style:"display:flex;flex-direction:column;gap:10px;margin-top:12px"},linhas));
  return sec;
}
const ST={constatada:["e3","Constatada"],indicio:["e2","Indício"],nao_aplica:["e1","Não se aplica"],verificar:["g","Verificar"]};
const ACOL={alto:"acolhimento alto",medio_alto:"acolhimento médio-alto",medio:"acolhimento médio",em_queda:"acolhimento em queda",informativo:"informativo"};
function statusDe(t,r){const m=V.teseStatus[t.codigo];if(m&&!m.automatico)return m.status;return (r.auto&&r.auto[t.codigo])||(m?m.status:"verificar")}
function renderTeses(r){
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h3",{},"5. Teses revisionais"),el("span",{class:"note"},"Automáticas vêm da calculadora; as demais o advogado marca. Alterar manualmente sobrepõe o automático.")));
  const grupos=[["encargos","Encargos do período de normalidade"],["mora","Encargos de inadimplência"],["tarifas","Tarifas e produtos embutidos"],["processual","Título, procedimento e garantias"]];
  for(const [g,label] of grupos){const ts=V.teses.filter(t=>t.grupo===g);if(!ts.length)continue;
    sec.append(el("h4",{style:"margin:14px 0 6px"},label));
    sec.append(el("div",{class:"rv-teses"},ts.map(t=>{const st=statusDe(t,r);const m=V.teseStatus[t.codigo]||{};const auto=r.auto&&t.codigo in r.auto;
      const s=sel(Object.fromEntries(Object.entries(ST).map(([k,v])=>[k,v[1]])),st);s.onchange=()=>{V.teseStatus[t.codigo]={...m,status:s.value,automatico:false};const out=$("#rv-out");if(out)out.lastChild.replaceWith(renderTeses(V.res||{}));else render()};
      const nota=el("textarea",{rows:"1",placeholder:"Nota / fundamento do caso"},m.nota||"");nota.onchange=()=>{V.teseStatus[t.codigo]={...(V.teseStatus[t.codigo]||{status:st,automatico:auto&&!m.status}),nota:nota.value}};
      const imp=r.impactos&&r.impactos[t.codigo];
      return el("div",{class:"rv-tese rv-"+st},el("div",{class:"rv-tese-h"},el("span",{class:"pill "+ST[st][0]},ST[st][1]),el("b",{},t.nome),auto&&!(m.status&&!m.automatico)?el("span",{class:"pill c"},"auto"):null,t.acolhimento?el("span",{class:"note"},ACOL[t.acolhimento]):null,imp!=null?el("span",{class:"note num"},`· impacto ≈ ${brl(imp)}`):null),
        el("div",{class:"note"},t.fundamento),t.descricao?el("div",{class:"note",style:"color:var(--faint)"},t.descricao):null,t.alerta?el("div",{class:"note",style:"color:var(--warn)"},"⚠ "+t.alerta):null,
        el("div",{class:"rv-tese-f"},s,nota))})));
  }
  return sec;
}

// ---------- persistência ----------
async function salvar(concluir){
  const k=V.contrato,r=V.res||{};const c=S.clientes.find(x=>x.id===k.clienteId);
  const row={contrato_id:k.id,cliente_id:k.clienteId,titulo:V.rev?.titulo||`${k.banco||"Banco"} · ${PRODUTOS[k.produto]||k.produto||""}`,entradas:V.ent,resultado:{...r,auto:undefined,impactos:undefined,calculadoEm:new Date().toISOString(),media:r.media,serie:r.serie,mes:r.mes},status:concluir?"concluida":(V.rev?.status==="concluida"?"concluida":"rascunho")};
  let id=V.rev?.id;
  if(id){const {error}=await SB.from("revisoes").update(row).eq("id",id);if(error){toast(error.message);return}}
  else{const {data,error}=await SB.from("revisoes").insert(row).select("id").single();if(error){toast(error.message);return}id=data.id}
  const linhas=V.teses.map(t=>{const m=V.teseStatus[t.codigo]||{};const st=statusDe(t,r);const auto=!(m.status&&!m.automatico);return {revisao_id:id,tese:t.codigo,status:st,automatico:auto,nota:m.nota||null,valor_impacto:r.impactos&&r.impactos[t.codigo]!=null?Math.round(r.impactos[t.codigo]*100)/100:null}});
  const {error:e2}=await SB.from("revisao_teses").upsert(linhas);if(e2){toast(e2.message);return}
  await recarregarLista();V.rev=V.lista.find(x=>x.id===id)||{id,...row};toast(concluir?"Revisão concluída":"Revisão salva");render();
}

// ---------- parecer preliminar (impressão) ----------
function parecer(){
  const k=V.contrato,e=V.ent,r=V.res||{};const c=S.clientes.find(x=>x.id===k.clienteId);
  const esc=s=>String(s??"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
  const teses=V.teses.map(t=>({t,st:statusDe(t,r),m:V.teseStatus[t.codigo]||{}}));
  const cons=teses.filter(x=>x.st==="constatada"),ind=teses.filter(x=>x.st==="indicio"),ver=teses.filter(x=>x.st==="verificar");
  const li=x=>`<li><b>${esc(x.t.nome)}</b> <span class="f">(${esc(x.t.fundamento||"")})</span>${r.impactos&&r.impactos[x.t.codigo]!=null?` — impacto estimado ${esc(brl(r.impactos[x.t.codigo]))}`:""}${x.m.nota?`<br><i>${esc(x.m.nota)}</i>`:""}</li>`;
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Parecer preliminar — ${esc(c?.nome||"")}</title>
<style>@page{size:A4;margin:22mm 20mm}body{font:12.5px/1.55 Georgia,"Times New Roman",serif;color:#1b1a14;margin:0;padding:24px;max-width:800px}h1,h2{font-family:Georgia,serif;color:#0C1F38}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #B8964A;padding-bottom:3px}.eyebrow{font:700 10px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#B8964A}.meta{color:#555;font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}th{background:#f3f0e8}td.n{text-align:right}.f{color:#666;font-size:11.5px}.box{border-left:3px solid #B8964A;background:#faf8f2;padding:8px 12px;font-size:12px;margin:10px 0}ul{padding-left:18px}li{margin:4px 0}.btn{position:fixed;top:10px;right:10px;font:13px Arial;padding:6px 12px}@media print{.btn{display:none}}</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / salvar PDF</button>
<div class="eyebrow">Neves Pádua Advocacia · Gestão de Passivos Bancários</div>
<h1>Parecer preliminar — revisão contratual</h1>
<div class="meta">Cliente: <b>${esc(c?.nome||"")}</b> · Credor: <b>${esc(k.banco||"")}</b> · Produto: ${esc(PRODUTOS[k.produto]||k.produto||"")} · Contratação: ${esc(e.data?e.data.split("-").reverse().join("/"):"—")} · Emitido em ${new Date().toLocaleDateString("pt-BR")}</div>
<h2>1. O que analisamos</h2>
<p>Contrato de ${esc(brl(num(e.valor)))}${e.prazo?` em ${esc(String(e.prazo))} meses (${esc(e.sistema==="sac"?"SAC":e.sistema==="rotativo"?"rotativo":"Tabela Price")})`:""}, com juros de ${esc(pc(num(e.taxaMensal),2))} ao mês${num(e.taxaAnual)!=null?` (${esc(pc(num(e.taxaAnual),2))} ao ano, conforme o contrato)`:""}. A taxa foi comparada com a taxa média de mercado divulgada pelo Banco Central para a modalidade <i>${esc(r.serieNome||"")}</i> (série ${esc(String(e.serie))}) em ${esc(r.mes?fmtMes(r.mes):"—")}: <b>${esc(r.media!=null?pc(r.media,2)+" ao mês":"não disponível")}</b>.</p>
${r.razao!=null?`<div class="box">A taxa contratada equivale a <b>${esc(r.razao.toLocaleString("pt-BR",{maximumFractionDigits:2}))}×</b> a média de mercado da época — ${esc({forte:"patamar substancialmente superior à média, que configura indício forte de abusividade",indicio:"patamar acima da média, que configura indício a ser confirmado com a análise do contrato e perícia",dentro:"patamar compatível com a média de mercado"}[r.classe])}.${r.acimaTeto?" A taxa também supera o teto regulamentar do Pronampe (Selic + "+esc(String(r.tetoPronampe.spread))+"% a.a.)."
:""}</div>`:""}
${r.contratada?`<table><tr><th>Cenário</th><th>1ª parcela</th><th>Total pago</th><th>Juros</th><th>Diferença</th></tr>
<tr><td>Como contratado</td><td class="n">${esc(brl(r.contratada.parcela))}</td><td class="n">${esc(brl(r.contratada.total))}</td><td class="n">${esc(brl(r.contratada.juros))}</td><td class="n">—</td></tr>
${r.pelaMedia?`<tr><td>Pela média de mercado</td><td class="n">${esc(brl(r.pelaMedia.parcela))}</td><td class="n">${esc(brl(r.pelaMedia.total))}</td><td class="n">${esc(brl(r.pelaMedia.juros))}</td><td class="n">${esc(brl(r.difMedia))}</td></tr>`:""}
<tr><td>Sem capitalização de juros</td><td class="n">${esc(brl(r.semCapitalizacao.parcela))}</td><td class="n">${esc(brl(r.semCapitalizacao.total))}</td><td class="n">${esc(brl(r.semCapitalizacao.juros))}</td><td class="n">${esc(brl(r.difCapitalizacao))}</td></tr></table>`:""}
<h2>2. O que constatamos</h2>
${cons.length?`<ul>${cons.map(li).join("")}</ul>`:"<p>Nenhuma irregularidade constatada de forma objetiva até o momento.</p>"}
<h2>3. Indícios a confirmar</h2>
${ind.length?`<ul>${ind.map(li).join("")}</ul>`:"<p>Nenhum.</p>"}
${ver.length?`<h2>4. Pontos que dependem de documentos</h2><ul>${ver.map(li).join("")}</ul>`:""}
<h2>${ver.length?5:4}. Recomendação</h2>
<p>${cons.length||ind.length?"Há elementos para a revisão do contrato. Recomendamos reunir os documentos listados acima (contrato integral, extratos desde a origem, planilha de evolução do débito e comprovantes das tarifas) para a quantificação por perícia contábil e a definição da estratégia (revisional, embargos ou negociação com o credor).":"Com os dados disponíveis, não identificamos irregularidade objetiva. Recomendamos a conferência do contrato integral e dos extratos antes de qualquer conclusão."}</p>
<div class="box">Este parecer é preliminar e se baseia nas informações fornecidas e nas taxas médias publicadas pelo Banco Central. A comparação com a média de mercado é um indicador, não uma conclusão (Tema 27/STJ; Tema 1.378/STJ pendente de julgamento). A quantificação final depende de perícia contábil.</div>
</body></html>`;
  const w=window.open("","_blank");if(!w){toast("Permita pop-ups para abrir o parecer");return}w.document.write(html);w.document.close();
}

// ---------- integração com o painel ----------
{const _r=render;render=function(){_r();const vr=$("#view-revisional");if(!vr)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="revisional")S.tab="clientes";vr.hidden=S.tab!=="revisional";if(S.tab==="revisional")renderRevisional()}}
{const _h=window.aplicarHash;window.aplicarHash=function(){const h=(location.hash||"").slice(1);const m=/^revisional\/(.+)$/i.exec(h);if(m){V.abrirContrato=decodeURIComponent(m[1]);if(V.ok){abrirContrato(V.abrirContrato);V.abrirContrato=null}}return _h.apply(this,arguments)}}
window.PP_REVISIONAL={abrir:abrirContrato};
const css=document.createElement("style");css.textContent=`
.rv-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:1000px){.rv-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.rv-teses{display:flex;flex-direction:column;gap:8px}.rv-tese{border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;background:var(--surface)}
.rv-tese.rv-constatada{border-left-color:var(--crit)}.rv-tese.rv-indicio{border-left-color:var(--warn)}.rv-tese.rv-nao_aplica{border-left-color:var(--ok);opacity:.75}.rv-tese.rv-verificar{border-left-color:var(--faint)}
.rv-tese-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.rv-tese-f{display:grid;grid-template-columns:180px 1fr;gap:8px;margin-top:4px}.rv-tese-f textarea{min-height:32px}
@media(max-width:700px){.rv-tese-f{grid-template-columns:1fr}}`;
document.head.append(css);
})();
