/* Superendividamento — plano de pagamento (Lei 14.181/2021; art. 104-A e 104-B do CDC).
   Entrada: renda, limite da renda disponível (ou mínimo existencial), dívidas por credor, prazo (≤ 60 meses), carência, juros.
   Saída: dois cenários — "5 anos" (saldo dividido no prazo, como a praxe) e "o que cabe" (parcela = renda disponível) — rateio por credor,
   tabela mês a mês, e documentos .docx no timbrado: relatório do cálculo, parecer ao cliente e petição de juntada do plano no processo.
   Persistência: planos_superendividamento (0041). Limite: é instrumento de cálculo; a proposta é decisão do advogado. */
(()=>{
"use strict";
const U={lista:[],ok:false,carregando:false,plano:null,ent:null,res:null,escritorio:null};
const PISO_MINIMO=600; // Decreto 11.150/2022 (art. 3º): R$ 600 — parâmetro editável na tela
const num=x=>{const v=parseFloat(String(x??"").replace(/\./g,"").replace(",","."));return Number.isFinite(v)?v:null};
const numSimples=x=>{const v=parseFloat(String(x??"").replace(",","."));return Number.isFinite(v)?v:null};
const brl2=v=>v==null?"—":v.toLocaleString("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v==null?"—":(v*100).toLocaleString("pt-BR",{maximumFractionDigits:2})+"%";
const hojeISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const addMeses=(iso,n)=>{const [y,m,d]=iso.split("-").map(Number);const x=new Date(y,m-1+n,1);const ult=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(d,ult));return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const addDias=(iso,n)=>{const [y,m,d]=iso.split("-").map(Number);const x=new Date(y,m-1,d+n);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const fmtISO=iso=>iso?fmtD(parseD(iso)):"—";
const TIPOS={consignado:"Empréstimo consignado",pessoal:"Empréstimo pessoal",cartao:"Cartão de crédito",cheque:"Cheque especial",financiamento:"Financiamento",conta:"Débito em conta",outro:"Outro"};

/* ---------- motor ---------- */
// PMT (Price); i = taxa mensal decimal; n parcelas; g = meses de carência (juros acumulam na carência)
const pmt=(P,i,n,g=0)=>{if(n<=0)return 0;const Pg=P*Math.pow(1+i,g);if(!i)return Pg/n;return Pg*i/(1-Math.pow(1+i,-n))};
// meses necessários para quitar P pagando p por mês à taxa i (null se nunca quita)
const mesesPara=(P,p,i)=>{if(p<=0)return null;if(!i)return Math.ceil(P/p-1e-9);if(p<=P*i)return null;return Math.ceil(-Math.log(1-P*i/p)/Math.log(1+i)-1e-9)};
function cronograma(P,parcela,i,n,dataBase,carenciaDias){
  const linhas=[];let saldo=P;const d0=addDias(dataBase,carenciaDias||0);
  for(let k=1;k<=n;k++){const juros=saldo*i;const amort=k===n?saldo:Math.min(parcela-juros,saldo);saldo=Math.max(0,saldo-amort);const valor=k===n?amort+juros:parcela;linhas.push({k,data:addMeses(d0,k),valor:Math.round(valor*100)/100,juros:Math.round(juros*100)/100,amort:Math.round(amort*100)/100,saldo:Math.round(saldo*100)/100})}
  return linhas;
}
function calcular(e){
  const renda=num(e.renda)||0,dividas=(e.dividas||[]).filter(d=>d.credor&&num(d.saldo)>0).map(d=>({...d,saldo:num(d.saldo)||0,parcela:num(d.parcela)||0}));
  const saldo=dividas.reduce((s,d)=>s+d.saldo,0),parcelas=dividas.reduce((s,d)=>s+d.parcela,0);
  const i=(numSimples(e.juros)||0)/100,n=Math.min(60,Math.max(1,parseInt(e.prazo)||60)),car=parseInt(e.carenciaDias)||0,g=Math.round(car/30);
  const limitePct=Math.min(100,Math.max(0,numSimples(e.limitePct)||0))/100;
  const disponivel=Math.round(renda*limitePct*100)/100,minimo=Math.round((renda-disponivel)*100)/100;
  const piso=num(e.minimoPiso)??PISO_MINIMO;
  const comprometimento=renda?parcelas/renda:null;
  const dataBase=e.dataCalculo||hojeISO();
  // cenário 1: prazo cheio (5 anos ou o informado)
  const parcelaCinco=Math.round(pmt(saldo,i,n,g)*100)/100;
  const cinco={meses:n,parcela:parcelaCinco,total:Math.round(parcelaCinco*n*100)/100,cabe:parcelaCinco<=disponivel+0.005,pctRenda:renda?parcelaCinco/renda:null,tabela:cronograma(saldo*Math.pow(1+i,g),parcelaCinco,i,n,dataBase,car)};
  // cenário 2: o que cabe na renda disponível
  const mCabe=mesesPara(saldo*Math.pow(1+i,g),disponivel,i);
  const cabe={parcela:disponivel,meses:mCabe,quitaEm60:mCabe!=null&&mCabe<=60,total:mCabe!=null?Math.round(Math.min(disponivel*mCabe,saldo*Math.pow(1+i,g)+disponivel*mCabe*i)*100)/100:null,
    tabela:mCabe!=null&&mCabe<=120?cronograma(saldo*Math.pow(1+i,g),disponivel,i,mCabe,dataBase,car):[]};
  // desconto necessário para a dívida caber em 60 meses com a parcela disponível (valor presente das 60 parcelas)
  const vp60=i?disponivel*(1-Math.pow(1+i,-60))/i:disponivel*60;
  const descontoNecessario=Math.max(0,Math.round((saldo-vp60)*100)/100);
  // rateio por credor (proporcional ao saldo) nos dois cenários
  const rateio=dividas.map(d=>{const prop=saldo?d.saldo/saldo:0;return {credor:d.credor,cnpj:d.cnpj||"",descricao:d.descricao||"",tipo:d.tipo||"",saldo:d.saldo,parcelaAtual:d.parcela,prop,parcelaCinco:Math.round(parcelaCinco*prop*100)/100,parcelaCabe:Math.round(disponivel*prop*100)/100,consignado:!!d.consignado}});
  const consignadoPct=renda?dividas.filter(d=>d.consignado).reduce((s,d)=>s+d.parcela,0)/renda:null;
  return {renda,saldo,parcelas,comprometimento,limitePct,disponivel,minimo,piso,minimoAbaixoPiso:minimo<piso,juros:i,prazo:n,carenciaDias:car,dataBase,cinco,cabe,descontoNecessario,rateio,consignadoPct,
    alertas:[minimo<piso?`O mínimo existencial calculado (${brl2(minimo)}) fica abaixo do piso de referência do Decreto 11.150/2022 (${brl2(piso)}).`:null,
             !cinco.cabe?`A parcela do plano em ${n} meses (${brl2(parcelaCinco)}) supera a renda disponível (${brl2(disponivel)}): seria preciso desconto de ${brl2(descontoNecessario)} no saldo, ou prazo maior que a lei permite.`:null,
             mCabe==null?"Com a renda disponível informada, a dívida não é amortizada (parcela não cobre os juros).":mCabe>60?`Pagando ${brl2(disponivel)}/mês a quitação levaria ${mCabe} meses — acima do teto legal de 5 anos.`:null,
             consignadoPct!=null&&consignadoPct>0.35?`Descontos consignados somam ${pct(consignadoPct)} da renda — acima do teto de 35% (Lei 10.820/2003).`:null].filter(Boolean)};
}

/* ---------- dados ---------- */
async function carregar(){
  if(U.carregando)return;U.carregando=true;
  try{const [a,e]=await Promise.all([SB.from("v_planos_superendividamento").select("*").order("updated_at",{ascending:false}),SB.from("escritorio").select("dados").eq("id","escritorio").maybeSingle()]);if(a.error)throw a.error;U.lista=a.data||[];U.escritorio=e.data?.dados||{};U.ok=true}
  catch(err){console.warn("superendividamento",err);toast("Não foi possível carregar os planos")}
  finally{U.carregando=false}
  if(S.tab==="superendividamento")render();
}
const garantir=()=>{if(!U.ok&&!U.carregando)carregar();return U.ok};
function entradasPadrao(){return {renda:"",limitePct:"30",minimoPiso:String(PISO_MINIMO),dividas:[{credor:"",cnpj:"",descricao:"",tipo:"consignado",saldo:"",parcela:"",consignado:true}],prazo:"60",carenciaDias:"0",juros:"0",dataCalculo:hojeISO(),comarca:"",processo:""}}
async function salvar(concluir){
  const p=U.plano;const e=U.ent;const r=calcular(e);
  const row={titulo:p.titulo||`${p.devedor?.nome||"Plano"} · ${fmtISO(e.dataCalculo)}`,cliente_id:p.cliente_id||null,devedor:p.devedor||{},entradas:e,resultado:{cinco:{parcela:r.cinco.parcela,meses:r.cinco.meses,total:r.cinco.total,cabe:r.cinco.cabe},cabe:{parcela:r.cabe.parcela,meses:r.cabe.meses,quitaEm60:r.cabe.quitaEm60},disponivel:r.disponivel,minimo:r.minimo,saldo:r.saldo,descontoNecessario:r.descontoNecessario},status:concluir?"concluido":(p.status||"rascunho")};
  const q=p.id?SB.from("planos_superendividamento").update(row).eq("id",p.id).select("id").single():SB.from("planos_superendividamento").insert(row).select("id").single();
  const {data,error}=await q;if(error){toast("Não foi possível salvar: "+error.message);return false}
  p.id=data.id;p.status=row.status;toast(concluir?"Plano concluído":"Plano salvo");U.ok=false;garantir();return true;
}

/* ---------- tela ---------- */
function renderSE(){
  const v=$("#view-superendividamento");v.replaceChildren();
  if(U.plano){renderPlano(v);return}
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Superendividamento"),el("div",{class:"sub"},"Plano de pagamento (Lei 14.181/2021): renda, mínimo existencial, dívidas por credor, até 60 meses. Gera relatório, parecer e petição de juntada.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:()=>{U.plano={titulo:"",cliente_id:null,devedor:{},status:"rascunho"};U.ent=entradasPadrao();render()}},"+ Novo plano"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const card=el("div",{class:"card"});
  card.append(tabela({cols:[
    {label:"Plano",r:x=>el("div",{},el("span",{class:"t"},x.titulo),el("span",{class:"sub"},[x.devedor_nome,x.cliente_nome].filter(Boolean).join(" · ")))},
    {label:"Renda",r:x=>brl2(+x.renda||0),num:true},{label:"Saldo total",r:x=>brl2(+x.saldo_total||0),num:true},{label:"Dívidas",r:x=>String(x.qtd_dividas),num:true},
    {label:"Parcela (prazo cheio)",r:x=>x.parcela_cinco?brl2(+x.parcela_cinco):"—",num:true},
    {label:"Status",r:x=>el("span",{class:"pill "+(x.status==="concluido"?"e1":"e2")},x.status==="concluido"?"concluído":"rascunho")},
    {label:"Atualizado",r:x=>el("span",{class:"note"},new Date(x.updated_at).toLocaleDateString("pt-BR")+(x.criado_por_nome?" · "+x.criado_por_nome:""))}],
    rows:U.lista,onRow:x=>abrir(x.id),vazio:"Nenhum plano ainda. Clique em “+ Novo plano”.",
    acts:x=>[btnIco("abrir","Abrir",()=>abrir(x.id)),btnIco("lixeira","Excluir (clique duas vezes)",async ev=>{const b=ev.currentTarget;if(b.dataset.ok!=="1"){b.dataset.ok="1";toast("Clique de novo para excluir");setTimeout(()=>{b.dataset.ok=""},3000);return}await SB.from("planos_superendividamento").delete().eq("id",x.id);U.ok=false;garantir()})]}));
  v.append(card);
}
async function abrir(id){const {data,error}=await SB.from("planos_superendividamento").select("*").eq("id",id).single();if(error){toast("Não foi possível abrir");return}U.plano={id:data.id,titulo:data.titulo,cliente_id:data.cliente_id,devedor:data.devedor||{},status:data.status};U.ent={...entradasPadrao(),...(data.entradas||{})};S.tab="superendividamento";render()}
function renderPlano(v){
  const p=U.plano,e=U.ent;const r=U.res=calcular(e);
  const voltar=()=>{U.plano=null;U.ent=null;render()};
  v.append(el("div",{class:"crumbs"},el("button",{class:"btn sm",onclick:voltar},"← Planos"),el("span",{},p.titulo||"Novo plano")));
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Superendividamento"),el("h1",{},p.devedor?.nome||p.titulo||"Novo plano"),el("div",{class:"sub"},"Preencha a situação atual e o plano; o resultado recalcula a cada alteração.")),
    el("div",{class:"actions"},el("button",{class:"btn",onclick:()=>salvar(false)},"Salvar rascunho"),el("button",{class:"btn primary",onclick:()=>salvar(true)},"Concluir"))));
  const rec=()=>{const out=$("#se-out");if(out){const novo=renderResultado();out.replaceWith(novo)}};
  // ---- 1. Devedor
  const d=p.devedor;const cli=sel({"":"— fora da base (informe os dados abaixo) —",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome]))},p.cliente_id||"");
  cli.onchange=()=>{p.cliente_id=cli.value||null;const c=S.clientes.find(x=>x.id===cli.value);if(c){d.nome=d.nome||c.nome;d.cpf=d.cpf||c.cnpj||c.cpf_titular||"";d.endereco=d.endereco||c.endereco||"";d.cidade=d.cidade||c.cidade||"";d.uf=d.uf||c.uf||""}render()};
  const dv=(k,label,ph)=>{const i=inp("text",d[k]||"",{placeholder:ph||""});i.oninput=()=>{d[k]=i.value;if(k==="nome"){const h=$("#view-superendividamento h1");if(h)h.textContent=i.value||"Novo plano"}};return field("se-"+k,label,i)};
  const tit=inp("text",p.titulo||"",{placeholder:"Ex.: Plano — Fulano · out/2026"});tit.oninput=()=>{p.titulo=tit.value};
  v.append(el("div",{class:"card section"},el("h2",{},"1. Devedor"),el("div",{class:"form"},field("se-tit","Nome do cálculo",tit),field("se-cli","Cliente da base",cli),dv("nome","Nome completo"),dv("cpf","CPF","000.000.000-00"),dv("rg","RG"),dv("nacionalidade","Nacionalidade","brasileiro(a)"),dv("estado_civil","Estado civil"),dv("profissao","Profissão"),dv("endereco","Endereço completo","Rua, nº, bairro, cidade/UF, CEP"))));
  // ---- 2. Situação atual
  const nf=(k,label,help,attrs={})=>{const i=inp("text",e[k]??"",{placeholder:"0,00",...attrs});i.onchange=()=>{e[k]=i.value;rec()};return field("se-"+k,label,i,help)};
  const sec2=el("div",{class:"card section"},el("h2",{},"2. Situação atual"));
  const dataC=inp("date",e.dataCalculo||hojeISO());dataC.onchange=()=>{e.dataCalculo=dataC.value;rec()};
  sec2.append(el("div",{class:"form"},nf("renda","Renda mensal líquida (R$)","Salário/benefício líquido, após descontos obrigatórios."),field("se-data","Data do cálculo",dataC),nf("comarca","Comarca do processo","Opcional — entra na petição.",{placeholder:"Ex.: Franca/SP"}),nf("processo","Nº do processo","Opcional — petição de juntada.",{placeholder:"0000000-00.0000.0.00.0000"})));
  const tb=el("div",{class:"tbl"});
  const linhasDiv=()=>{tb.replaceChildren(el("table",{},el("thead",{},el("tr",{},el("th",{},"Credor"),el("th",{},"CNPJ"),el("th",{},"Descrição"),el("th",{},"Tipo"),el("th",{class:"r"},"Saldo devedor"),el("th",{class:"r"},"Parcela atual"),el("th",{},"Consignado"),el("th",{}))),
    el("tbody",{},e.dividas.map((dv,idx)=>{const c=(k,w,ph)=>{const i=inp("text",dv[k]||"",{placeholder:ph||"",style:`width:${w}px`});i.onchange=()=>{dv[k]=i.value;rec()};return i};const t=sel(TIPOS,dv.tipo||"outro");t.style.width="150px";t.onchange=()=>{dv.tipo=t.value;dv.consignado=t.value==="consignado"?true:dv.consignado;linhasDiv();rec()};
      const ck=el("input",{type:"checkbox"});ck.checked=!!dv.consignado;ck.onchange=()=>{dv.consignado=ck.checked;rec()};
      return el("tr",{},el("td",{},c("credor",170,"Banco…")),el("td",{},c("cnpj",140,"00.000.000/0001-00")),el("td",{},c("descricao",160,"Contrato nº…")),el("td",{},t),el("td",{class:"r"},c("saldo",110,"0,00")),el("td",{class:"r"},c("parcela",100,"0,00")),el("td",{},ck),
        el("td",{},el("button",{class:"btn sm icon",title:"Remover",onclick:()=>{e.dividas.splice(idx,1);if(!e.dividas.length)e.dividas.push({credor:"",tipo:"outro"});linhasDiv();rec()},html:'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'})))}))))};
  linhasDiv();
  sec2.append(el("h3",{},"Dívidas"),tb,el("div",{class:"actions",style:"justify-content:flex-start"},el("button",{class:"btn sm",onclick:()=>{e.dividas.push({credor:"",tipo:"pessoal",consignado:false});linhasDiv()}},"+ Dívida")));
  v.append(sec2);
  // ---- 3. Plano
  const sec3=el("div",{class:"card section"},el("h2",{},"3. Plano de pagamento"));
  sec3.append(el("div",{class:"form"},nf("limitePct","Renda disponível para pagamento (%)","O restante é o mínimo existencial preservado. Praxe: 30%; consignado legal 35%+5%.",{placeholder:"30"}),nf("minimoPiso","Piso de referência do mínimo existencial (R$)","Decreto 11.150/2022: R$ 600. Só alerta; não altera a conta.",{placeholder:"600"}),
    nf("prazo","Prazo (meses, máx. 60)","Art. 104-A, §1º: plano de até 5 anos.",{placeholder:"60"}),nf("carenciaDias","Carência (dias)","Até a 1ª parcela.",{placeholder:"0"}),nf("juros","Juros do plano (% a.m.)","Praxe: 0% (só correção) — campo livre para a proposta.",{placeholder:"0"})));
  v.append(sec3);
  v.append(renderResultado());
}
function renderResultado(){
  const r=U.res=calcular(U.ent);
  const out=el("div",{id:"se-out",style:"display:flex;flex-direction:column;gap:18px"});
  const K=(l,val,h,cls)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v",style:cls?`color:var(--${cls})`:""},val),el("div",{class:"h"},h));
  out.append(el("div",{class:"kpis"},K("Renda mensal",brl2(r.renda),""),K("Comprometida hoje",r.comprometimento!=null?pct(r.comprometimento):"—",brl2(r.parcelas)+" em parcelas",r.comprometimento>0.3?"crit":""),K("Mínimo existencial",brl2(r.minimo),pct(1-r.limitePct)+" da renda",r.minimoAbaixoPiso?"warn":""),K("Renda disponível",brl2(r.disponivel),pct(r.limitePct)+" da renda"),K("Saldo devedor total",brl2(r.saldo),`${r.rateio.length} credor(es)`)));
  if(r.alertas.length)out.append(el("div",{class:"card section",style:"border-left:3px solid var(--warn)"},r.alertas.map(a=>el("div",{},"⚠️ ",a))));
  const cen=(titulo,sub,p,meses,total,ok,extra)=>el("div",{class:"card section",style:ok?"border-left:3px solid var(--ok)":"border-left:3px solid var(--crit)"},el("div",{class:"section-h"},el("h2",{},titulo),el("span",{class:"pill "+(ok?"e1":"e3")},ok?"cabe na renda":"não cabe")),el("div",{class:"note"},sub),
    el("div",{class:"kpis"},K("Parcela",brl2(p),""),K("Prazo",meses!=null?`${meses} meses`:"—",meses!=null?"até "+fmtISO(addMeses(addDias(r.dataBase,r.carenciaDias),meses)):""),K("Total pago",brl2(total),r.juros?`juros ${pct(r.juros)} a.m.`:"sem juros")),extra||null);
  const duas=el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:18px"});
  duas.append(cen(`Plano em ${r.prazo} meses`,"Saldo dividido no prazo (praxe do art. 104-A). Compare com a renda disponível.",r.cinco.parcela,r.cinco.meses,r.cinco.total,r.cinco.cabe,r.cinco.cabe?null:el("div",{class:"note"},`Para caber em ${r.prazo} meses: desconto de ${brl2(r.descontoNecessario)} no saldo (${r.saldo?pct(r.descontoNecessario/r.saldo):""}).`)));
  duas.append(cen("O que cabe na renda","Parcela igual à renda disponível; prazo é o necessário para quitar.",r.cabe.parcela,r.cabe.meses,r.cabe.total,r.cabe.quitaEm60,r.cabe.quitaEm60?null:el("div",{class:"note"},r.cabe.meses==null?"A parcela não cobre os juros — reduza os juros ou aumente o percentual.":`Passa de 60 meses (${r.cabe.meses}). Precisa de desconto de ${brl2(r.descontoNecessario)} ou renda disponível maior.`)));
  out.append(duas);
  // rateio
  out.append(el("div",{class:"card"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{},"Rateio por credor (proporcional ao saldo)")),
    tabela({cols:[{label:"Credor",r:x=>el("div",{},el("span",{class:"t"},x.credor),el("span",{class:"sub"},[x.descricao,TIPOS[x.tipo]].filter(Boolean).join(" · ")))},{label:"Saldo",r:x=>brl2(x.saldo),num:true},{label:"% do total",r:x=>pct(x.prop),num:true},{label:"Parcela atual",r:x=>brl2(x.parcelaAtual),num:true},{label:`Parcela em ${r.prazo} m`,r:x=>brl2(x.parcelaCinco),num:true},{label:"Parcela “o que cabe”",r:x=>brl2(x.parcelaCabe),num:true}],rows:r.rateio,vazio:"Informe as dívidas."})));
  // tabela mês a mês (prazo cheio)
  const det=el("details",{},el("summary",{style:"cursor:pointer;padding:12px 18px;font-weight:600"},`Tabela mês a mês — plano em ${r.prazo} meses`));
  det.append(tabela({cols:[{label:"#",r:l=>String(l.k),num:true,w:"50px"},{label:"Vencimento",r:l=>fmtISO(l.data)},{label:"Parcela",r:l=>brl2(l.valor),num:true},{label:"Juros",r:l=>brl2(l.juros),num:true},{label:"Amortização",r:l=>brl2(l.amort),num:true},{label:"Saldo",r:l=>brl2(l.saldo),num:true}],rows:r.cinco.tabela,vazio:"—"}));
  out.append(el("div",{class:"card"},det));
  out.append(el("div",{class:"card section"},el("h2",{},"Documentos"),el("div",{class:"note"},"Saem em .docx no papel timbrado. Escolha o cenário que vai para o parecer e para a petição."),
    (()=>{const c=sel({cinco:`Plano em ${r.prazo} meses`,cabe:"O que cabe na renda"},U.ent.cenario||"cinco");c.onchange=()=>{U.ent.cenario=c.value};c.style.maxWidth="320px";return el("div",{class:"form"},field("se-cen","Cenário proposto",c))})(),
    el("div",{class:"actions",style:"justify-content:flex-start"},el("button",{class:"btn",onclick:()=>gerar("relatorio")},"Relatório do cálculo"),el("button",{class:"btn",onclick:()=>gerar("parecer")},"Parecer ao cliente"),el("button",{class:"btn primary",onclick:()=>gerar("peticao")},"Petição de juntada do plano"))));
  return out;
}

/* ---------- documentos ---------- */
function cenarioEscolhido(r){const c=U.ent.cenario||"cinco";return c==="cabe"&&r.cabe.meses?{nome:"o que cabe na renda",parcela:r.cabe.parcela,meses:r.cabe.meses,total:r.cabe.total,tabela:r.cabe.tabela,campo:"parcelaCabe"}:{nome:`${r.prazo} meses`,parcela:r.cinco.parcela,meses:r.cinco.meses,total:r.cinco.total,tabela:r.cinco.tabela,campo:"parcelaCinco"}}
const ext=s=>s?`${s}`:"«a informar»";
function cabecalhoPartes(p){const d=p.devedor||{};return `${ext(d.nome)}, ${ext(d.nacionalidade)}, ${ext(d.estado_civil)}, ${ext(d.profissao)}, portador(a) do RG nº ${ext(d.rg)}, inscrito(a) no CPF sob o nº ${ext(d.cpf)}, residente e domiciliado(a) em ${ext(d.endereco)}`}
function docRelatorio(p,e,r){
  const c=cenarioEscolhido(r);const esc=U.escritorio||{};const adv=(esc.advogados||[])[0]||{};
  const it=[{tipo:"destaque",texto:"PLANO DE PAGAMENTO — SUPERENDIVIDAMENTO"},{tipo:"centro",texto:`${p.devedor?.nome||p.titulo} · cálculo de ${fmtISO(r.dataBase)}`},
    {tipo:"subtitulo",texto:"1. Situação atual"},
    {tipo:"tabela",cabecalho:["Item","Valor"],larguras:[55,45],num:[1],linhas:[["Renda mensal líquida",brl2(r.renda)],["Parcelas atuais (soma)",brl2(r.parcelas)+(r.comprometimento!=null?` (${pct(r.comprometimento)} da renda)`:"")],["Mínimo existencial preservado",brl2(r.minimo)+` (${pct(1-r.limitePct)})`],["Renda disponível para o plano",brl2(r.disponivel)+` (${pct(r.limitePct)})`],["Saldo devedor total",brl2(r.saldo)]]},
    {tipo:"subtitulo",texto:"2. Dívidas"},
    {tipo:"tabela",cabecalho:["Credor","Descrição","Saldo devedor","Parcela atual","% do total"],larguras:[28,27,15,15,15],num:[2,3,4],linhas:r.rateio.map(x=>[x.credor+(x.cnpj?` (${x.cnpj})`:""),[x.descricao,TIPOS[x.tipo]].filter(Boolean).join(" · "),brl2(x.saldo),brl2(x.parcelaAtual),pct(x.prop)])},
    {tipo:"subtitulo",texto:"3. Plano proposto"},
    {tipo:"tabela",cabecalho:["Parâmetro","Valor"],larguras:[55,45],num:[1],linhas:[["Cenário",c.nome],["Parcela mensal",brl2(c.parcela)],["Prazo",`${c.meses} meses`],["Carência",r.carenciaDias?`${r.carenciaDias} dias`:"—"],["Juros",r.juros?`${pct(r.juros)} a.m.`:"sem juros"],["Total do plano",brl2(c.total)],["1ª parcela",fmtISO(c.tabela[0]?.data)],["Última parcela",fmtISO(c.tabela.at(-1)?.data)]]},
    {tipo:"subtitulo",texto:"4. Rateio por credor"},
    {tipo:"tabela",cabecalho:["Credor","Saldo","% do total","Parcela mensal"],larguras:[45,20,15,20],num:[1,2,3],linhas:r.rateio.map(x=>[x.credor,brl2(x.saldo),pct(x.prop),brl2(x[c.campo])])},
    {tipo:"subtitulo",texto:"5. Cronograma"},
    {tipo:"tabela",cabecalho:["#","Vencimento","Parcela","Juros","Amortização","Saldo"],larguras:[8,20,18,18,18,18],num:[2,3,4,5],linhas:c.tabela.map(l=>[String(l.k),fmtISO(l.data),brl2(l.valor),brl2(l.juros),brl2(l.amort),brl2(l.saldo)])}];
  if(r.alertas.length)it.push({tipo:"subtitulo",texto:"6. Observações"},...r.alertas.map(a=>({tipo:"item",texto:"• "+a})));
  it.push({tipo:"espaco"},{tipo:"paragrafo",texto:`Cálculo elaborado em ${fmtISO(r.dataBase)} por ${adv.nome||esc.nome||"Neves Pádua Advocacia"}${adv.oab?" — OAB "+adv.oab:""}. Operações aritméticas sobre os saldos informados pelo devedor/credores; não substitui a conferência dos extratos.`});
  return it;
}
function docParecer(p,e,r){
  const c=cenarioEscolhido(r);const esc=U.escritorio||{};const adv=(esc.advogados||[])[0]||{};const d=p.devedor||{};
  return [{tipo:"destaque",texto:"PARECER — PLANO DE PAGAMENTO (SUPERENDIVIDAMENTO)"},{tipo:"centro",texto:`${d.nome||p.titulo} · ${fmtISO(r.dataBase)}`},
    {tipo:"subtitulo",texto:"I. Situação"},
    {tipo:"paragrafo",texto:`O(a) cliente possui ${r.rateio.length} dívida(s) de consumo com ${r.rateio.map(x=>x.credor).join(", ")}, que somam ${brl2(r.saldo)}. As parcelas contratadas totalizam ${brl2(r.parcelas)} por mês, o que corresponde a ${pct(r.comprometimento)} da renda líquida de ${brl2(r.renda)}.`},
    {tipo:"paragrafo",texto:`Preservando-se ${pct(1-r.limitePct)} da renda para as despesas de subsistência (mínimo existencial de ${brl2(r.minimo)}), restam ${brl2(r.disponivel)} mensais para o pagamento das dívidas.${r.minimoAbaixoPiso?` Atenção: esse mínimo fica abaixo do piso de referência do Decreto 11.150/2022 (${brl2(r.piso)}).`:""}`},
    {tipo:"subtitulo",texto:"II. Enquadramento"},
    {tipo:"paragrafo",texto:"A Lei 14.181/2021 incluiu no Código de Defesa do Consumidor o conceito de superendividamento (art. 54-A, §1º): a impossibilidade manifesta de o consumidor pessoa natural, de boa-fé, pagar a totalidade de suas dívidas de consumo exigíveis e vincendas sem comprometer o mínimo existencial. Para essa situação, o art. 104-A prevê a repactuação das dívidas por meio de plano de pagamento com prazo máximo de 5 anos, preservado o mínimo existencial, e o art. 104-B o plano judicial compulsório quando não há acordo."},
    {tipo:"paragrafo",texto:`O comprometimento de ${pct(r.comprometimento)} da renda com parcelas, em dívidas de consumo, caracteriza a situação descrita na lei e autoriza a proposta de plano.`},
    {tipo:"subtitulo",texto:"III. Plano proposto"},
    {tipo:"paragrafo",texto:`Cenário “${c.nome}”: parcela mensal de ${brl2(c.parcela)} durante ${c.meses} meses${r.carenciaDias?`, após carência de ${r.carenciaDias} dias`:""}${r.juros?`, com juros de ${pct(r.juros)} ao mês`:", sem juros remuneratórios"}, totalizando ${brl2(c.total)}. A parcela é rateada entre os credores na proporção de cada saldo:`},
    ...r.rateio.map(x=>({tipo:"item",texto:`• ${x.credor}: ${brl2(x[c.campo])}/mês (saldo ${brl2(x.saldo)}, ${pct(x.prop)} do total).`})),
    ...(r.cinco.cabe?[]:[{tipo:"paragrafo",texto:`Observação: dividir o saldo em ${r.prazo} meses resultaria em parcela de ${brl2(r.cinco.parcela)}, acima da renda disponível. Para o plano fechar em 5 anos seria necessário desconto de ${brl2(r.descontoNecessario)} no saldo consolidado — ponto a ser levado à conciliação com os credores.`}]),
    {tipo:"subtitulo",texto:"IV. Recomendação"},
    {tipo:"paragrafo",texto:"Apresentar o plano aos credores na audiência de conciliação (art. 104-A), com os extratos e comprovantes de renda que embasam o cálculo, requerendo, se necessário, a suspensão dos descontos que excedam a renda disponível até a repactuação. O(a) cliente deve evitar novas contratações de crédito durante o procedimento (art. 104-A, §4º, IV)."},
    {tipo:"espaco"},{tipo:"paragrafo",texto:`${fmtISO(r.dataBase)} — ${adv.nome||esc.nome||"Neves Pádua Advocacia"}${adv.oab?", OAB "+adv.oab:""}.`}];
}
function docPeticao(p,e,r){
  const c=cenarioEscolhido(r);const esc=U.escritorio||{};const adv=(esc.advogados||[])[0]||{};const d=p.devedor||{};
  return [{tipo:"titulo",texto:`AO JUÍZO DA ___ VARA CÍVEL DA COMARCA DE ${e.comarca||"«comarca»"}`},
    {tipo:"centro",texto:`Processo nº ${e.processo||"«número do processo»"}`},{tipo:"centro",texto:"Repactuação de dívidas — superendividamento (art. 104-A do CDC)"},
    {tipo:"paragrafo",texto:`${d.nome||"«nome do autor»"}, já qualificado(a) nos autos, por seus advogados, vem apresentar PLANO DE PAGAMENTO, nos termos do art. 104-A, §1º, do Código de Defesa do Consumidor, expondo e requerendo o que segue.`},
    {tipo:"subtitulo",texto:"1. Da situação de superendividamento"},
    {tipo:"paragrafo",texto:`O(a) requerente aufere renda líquida mensal de ${brl2(r.renda)} e mantém ${r.rateio.length} dívida(s) de consumo que somam ${brl2(r.saldo)}, cujas parcelas contratadas totalizam ${brl2(r.parcelas)} mensais — ${pct(r.comprometimento)} da renda —, comprometendo o mínimo existencial (art. 54-A, §1º, CDC).`},
    {tipo:"tabela",cabecalho:["Credor","Descrição","Saldo devedor","Parcela atual"],larguras:[32,28,20,20],num:[2,3],linhas:r.rateio.map(x=>[x.credor+(x.cnpj?` (${x.cnpj})`:""),[x.descricao,TIPOS[x.tipo]].filter(Boolean).join(" · "),brl2(x.saldo),brl2(x.parcelaAtual)])},
    {tipo:"subtitulo",texto:"2. Do mínimo existencial e da renda disponível"},
    {tipo:"paragrafo",texto:`Preservados ${pct(1-r.limitePct)} da renda para as despesas básicas de subsistência (${brl2(r.minimo)}), a renda disponível para o pagamento das dívidas é de ${brl2(r.disponivel)} mensais.`},
    {tipo:"subtitulo",texto:"3. Do plano de pagamento"},
    {tipo:"paragrafo",texto:`Propõe-se o pagamento de ${brl2(c.parcela)} por mês, durante ${c.meses} meses${r.carenciaDias?`, com carência de ${r.carenciaDias} dias`:""}${r.juros?`, acrescidos de juros de ${pct(r.juros)} ao mês`:", sem incidência de juros remuneratórios"}, totalizando ${brl2(c.total)}, com a primeira parcela em ${fmtISO(c.tabela[0]?.data)} e a última em ${fmtISO(c.tabela.at(-1)?.data)} — dentro do prazo máximo de 5 anos do art. 104-A, §1º. A parcela será rateada entre os credores na proporção de cada crédito:`},
    {tipo:"tabela",cabecalho:["Credor","Saldo","% do total","Parcela mensal"],larguras:[45,20,15,20],num:[1,2,3],linhas:r.rateio.map(x=>[x.credor,brl2(x.saldo),pct(x.prop),brl2(x[c.campo])])},
    {tipo:"paragrafo",texto:"O cronograma completo, com vencimentos e saldos, segue anexo (relatório do cálculo)."},
    ...(r.cinco.cabe?[]:[{tipo:"paragrafo",texto:`Registra-se que a divisão do saldo consolidado em ${r.prazo} meses resultaria em parcela de ${brl2(r.cinco.parcela)}, superior à renda disponível; a viabilidade do plano em 5 anos depende de desconto de ${brl2(r.descontoNecessario)} sobre o saldo, o que se submete à conciliação (art. 104-A, caput) ou, na sua falta, ao plano judicial compulsório (art. 104-B).`}]),
    {tipo:"subtitulo",texto:"4. Dos pedidos"},
    {tipo:"paragrafo",texto:"Diante do exposto, requer:"},
    {tipo:"item",texto:"a) a juntada do presente plano de pagamento e do relatório de cálculo anexo, com intimação dos credores para manifestação;"},
    {tipo:"item",texto:"b) a designação (ou manutenção) de audiência de conciliação com todos os credores, nos termos do art. 104-A do CDC;"},
    {tipo:"item",texto:`c) até a repactuação, a limitação dos descontos e cobranças ao montante de ${brl2(r.disponivel)} mensais, preservando-se o mínimo existencial (art. 104-A, §4º, c/c art. 300 do CPC);`},
    {tipo:"item",texto:"d) não havendo êxito na conciliação, a instauração do processo por superendividamento para revisão e integração dos contratos e repactuação das dívidas, com plano judicial compulsório (art. 104-B do CDC)."},
    {tipo:"paragrafo",texto:"Nestes termos, pede deferimento."},
    {tipo:"centro",texto:`${e.comarca?e.comarca.split("/")[0]:"«cidade»"}, ${fmtISO(r.dataBase)}.`},{tipo:"espaco"},
    {tipo:"centro",texto:adv.nome||"«advogado(a)»"},{tipo:"centro",texto:adv.oab?"OAB "+adv.oab:"«OAB»"}];
}
async function gerar(tipo){
  const p=U.plano,e=U.ent,r=U.res||calcular(e);
  if(!window.PP_PECAS?.gerarDocx){toast("Gerador de documentos indisponível");return}
  const itens=tipo==="relatorio"?docRelatorio(p,e,r):tipo==="parecer"?docParecer(p,e,r):docPeticao(p,e,r);
  const slug=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\w]+/g,"-").replace(/^-|-$/g,"").toLowerCase();
  toast("Gerando…");await window.PP_PECAS.gerarDocx(itens,`${tipo}-superendividamento-${slug(p.devedor?.nome||p.titulo||"plano")}.docx`);
}

/* ---------- integração ---------- */
window.PP_SUPERENDIVIDAMENTO={calcular,abrir,novo:(cliente_id)=>{U.plano={titulo:"",cliente_id:cliente_id||null,devedor:{},status:"rascunho"};U.ent=entradasPadrao();const c=S.clientes.find(x=>x.id===cliente_id);if(c){U.plano.devedor={nome:c.nome,cpf:c.cnpj||c.cpf_titular||"",endereco:c.endereco||"",cidade:c.cidade||"",uf:c.uf||""}}S.tab="superendividamento";render()}};
{const _h=window.aplicarHash;window.aplicarHash=function(){const h=(location.hash||"").slice(1);const m=/^superendividamento\/([0-9a-f-]{36})$/i.exec(h);if(m)abrir(m[1]);return _h.apply(this,arguments)}}
{const _r=render;render=function(){_r();const v=$("#view-superendividamento");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="superendividamento")S.tab="clientes";v.hidden=S.tab!=="superendividamento";if(S.tab==="superendividamento")renderSE()}}
})();
