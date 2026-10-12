/* Growth — Gestão → Growth: Meta Ads × CRM × Instagram, seguindo a skill head-of-growth (metrics, crm-tracking-rules, data-quality-gate,
   visual-dashboard). Lê growth_meta_conta_dia, growth_meta_anuncios_dia, growth_ig_dia, growth_ig_posts e v_growth_leads (0044).
   Período = últimos N dias completos (hoje excluído) vs. os N anteriores. Atribuição Meta × CRM pelo nome do anúncio/conjunto/campanha
   que o formulário do Meta grava no lead (chave explícita, nível 3). Os relatórios narrativos (Weekly/Monthly) entram depois. */
(()=>{
"use strict";
const G={ok:false,carregando:false,dias:30,nivel:"anuncio",conta:[],anuncios:[],ig:[],posts:[],leads:[],status:null,erro:null};
try{G.dias=+localStorage.getItem("pp-growth-dias")||30}catch(_){}
const ehAdmin=()=>PP.perfil?.papel==="admin";
const hojeBRT=()=>{const d=new Date(Date.now()-3*3600e3);return d.toISOString().slice(0,10)};
const addDias=(iso,n)=>{const d=new Date(iso+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const fmtDia=iso=>iso?iso.slice(8,10)+"/"+iso.slice(5,7):"";
const R$=v=>(v==null||!isFinite(v))?"—":v.toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:v<100?2:0});
const N=v=>(v==null||!isFinite(v))?"—":Math.round(v).toLocaleString("pt-BR");
const P=v=>(v==null||!isFinite(v))?"—":(v*100).toLocaleString("pt-BR",{maximumFractionDigits:1})+"%";
const div=(a,b)=>b>0?a/b:null;
const norm=s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const soma=(arr,k)=>arr.reduce((s,r)=>s+(+r[k]||0),0);

async function carregar(){
  if(G.carregando)return;G.carregando=true;G.erro=null;
  try{
    const desde=addDias(hojeBRT(),-190);
    const [c,a,i,p,l,st]=await Promise.all([
      SB.from("growth_meta_conta_dia").select("*").gte("data",desde).order("data"),
      SB.from("growth_meta_anuncios_dia").select("data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,objective,spend,impressions,reach,frequency,clicks,link_clicks,leads,conversas").gte("data",desde),
      SB.from("growth_ig_dia").select("*").gte("data",desde).order("data"),
      SB.from("growth_ig_posts").select("*").order("publicado_em",{ascending:false}).limit(60),
      SB.from("v_growth_leads").select("id,dia,origem,campanha,publico,anuncio,fase_id,fase_nome,status,motivo_perda,valor,qualificado,desqualificado,sem_contato,reuniao_agendada,reuniao_realizada,proposta,ganho").gte("dia",desde),
      SB.rpc("growth_status")]);
    for(const r of [c,a,i,p,l])if(r.error)throw r.error;
    G.conta=c.data||[];G.anuncios=a.data||[];G.ig=i.data||[];G.posts=p.data||[];G.leads=l.data||[];G.status=st.error?null:st.data;G.ok=true;
  }catch(e){console.warn("growth",e);G.erro=e.message||String(e)}
  finally{G.carregando=false}
  if(S.tab==="growth")render();
}
function garantir(){if(!G.ok&&!G.carregando&&!G.erro)carregar();return G.ok}

/* ---------- períodos e agregações ---------- */
function periodos(){
  const fim=addDias(hojeBRT(),-1),ini=addDias(fim,-(G.dias-1)),fimAnt=addDias(ini,-1),iniAnt=addDias(fimAnt,-(G.dias-1));
  return {ini,fim,iniAnt,fimAnt};
}
const entre=(d,a,b)=>d>=a&&d<=b;
function agregaMeta(linhas){
  const o={spend:soma(linhas,"spend"),impressions:soma(linhas,"impressions"),clicks:soma(linhas,"clicks"),link_clicks:soma(linhas,"link_clicks"),leads:soma(linhas,"leads"),conversas:soma(linhas,"conversas"),reach:soma(linhas,"reach"),dias:new Set(linhas.map(r=>r.data)).size};
  o.cpl=div(o.spend,o.leads);o.ctr=div(o.link_clicks,o.impressions);o.cpm=o.impressions?o.spend/o.impressions*1000:null;o.cpc=div(o.spend,o.link_clicks);o.freq=div(o.impressions,o.reach);
  return o;
}
function agregaCrm(leads){
  const o={leads:leads.length,qual:leads.filter(l=>l.qualificado).length,desq:leads.filter(l=>l.desqualificado).length,semContato:leads.filter(l=>l.sem_contato).length,
    reun:leads.filter(l=>l.reuniao_agendada).length,real:leads.filter(l=>l.reuniao_realizada).length,prop:leads.filter(l=>l.proposta).length,ganho:leads.filter(l=>l.ganho).length,
    comCampanha:leads.filter(l=>l.campanha).length,valorGanho:leads.filter(l=>l.ganho).reduce((s,l)=>s+(+l.valor||0),0)};
  o.avaliados=o.qual+o.desq;o.pend=o.leads-o.avaliados-o.semContato;o.txQual=div(o.qual,o.avaliados);o.txPend=div(o.pend,o.leads);
  return o;
}
// cruza leads do CRM com os anúncios do Meta pelo nome (campanha/conjunto/anúncio gravados pelo formulário)
function chaveNivel(r,nivel){return nivel==="campanha"?norm(r.campaign_name):nivel==="conjunto"?norm(r.adset_name):norm(r.ad_name)}
function chaveLead(l,nivel){return nivel==="campanha"?norm(l.campanha):nivel==="conjunto"?norm(l.publico):norm(l.anuncio)}
function porNivel(anuncios,leads,nivel){
  const m=new Map();
  for(const r of anuncios){const k=chaveNivel(r,nivel);if(!k)continue;const g=m.get(k)||{k,nome:nivel==="campanha"?r.campaign_name:nivel==="conjunto"?r.adset_name:r.ad_name,campanha:r.campaign_name,conjunto:r.adset_name,linhas:[],leadsCrm:[]};g.linhas.push(r);m.set(k,g)}
  const semMatch=[];
  for(const l of leads){const k=chaveLead(l,nivel);const g=k&&m.get(k);if(g)g.leadsCrm.push(l);else semMatch.push(l)}
  const out=[...m.values()].map(g=>{const meta=agregaMeta(g.linhas),crm=agregaCrm(g.leadsCrm);return {...g,meta,crm,cpql:crm.qual>0?meta.spend/crm.qual:null,custoReuniao:crm.reun>0?meta.spend/crm.reun:null,cac:crm.ganho>0?meta.spend/crm.ganho:null}});
  out.sort((a,b)=>b.meta.spend-a.meta.spend);
  return {itens:out,semMatch};
}

/* ---------- gráficos (SVG, sem dependências) ---------- */
const COR={a:"var(--ch-a)",b:"var(--ch-b)",ok:"var(--ok)",warn:"var(--warn)",crit:"var(--crit)",grid:"var(--ch-grid)",muted:"var(--muted)",fg:"var(--fg)"};
function graficoLinhaBarras({dias,barras,linha,rotBarra,rotLinha,fmtB=N,fmtL=N,altura=220}){
  const W=760,H=altura,ml=46,mr=46,mt=14,mb=28,xw=W-ml-mr,yh=H-mt-mb,n=dias.length;
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,class:"gw-svg",role:"img"});
  if(!n){svg.append(sv("text",{x:W/2,y:H/2,"text-anchor":"middle",fill:COR.muted},"Sem dados no período"));return svg}
  const maxB=Math.max(1,...barras),maxL=Math.max(1,...linha.filter(v=>v!=null));
  const bw=Math.max(2,xw/n*0.62),x=i=>ml+xw*(i+0.5)/n;
  [0,.5,1].forEach(f=>{svg.append(sv("line",{x1:ml,x2:W-mr,y1:mt+yh*(1-f),y2:mt+yh*(1-f),stroke:COR.grid}));svg.append(sv("text",{x:ml-6,y:mt+yh*(1-f)+4,"text-anchor":"end",class:"gw-ax"},fmtB(maxB*f)));svg.append(sv("text",{x:W-mr+6,y:mt+yh*(1-f)+4,class:"gw-ax"},fmtL(maxL*f)))});
  barras.forEach((v,i)=>svg.append(sv("rect",{x:x(i)-bw/2,y:mt+yh*(1-v/maxB),width:bw,height:yh*v/maxB,fill:COR.a,opacity:.75,rx:2},sv("title",{},`${fmtDia(dias[i])} · ${rotBarra}: ${fmtB(v)}`))));
  let d="";linha.forEach((v,i)=>{if(v==null)return;d+=(d?"L":"M")+x(i).toFixed(1)+" "+(mt+yh*(1-v/maxL)).toFixed(1)+" "});
  if(d)svg.append(sv("path",{d,fill:"none",stroke:COR.b,"stroke-width":2.2,"stroke-linejoin":"round"}));
  linha.forEach((v,i)=>{if(v==null)return;svg.append(sv("circle",{cx:x(i),cy:mt+yh*(1-v/maxL),r:3,fill:COR.b},sv("title",{},`${fmtDia(dias[i])} · ${rotLinha}: ${fmtL(v)}`)))});
  const passo=Math.ceil(n/8);dias.forEach((dd,i)=>{if(i%passo===0||i===n-1)svg.append(sv("text",{x:x(i),y:H-8,"text-anchor":"middle",class:"gw-ax"},fmtDia(dd)))});
  return svg;
}
function graficoBarrasH({itens,fmt=N,cor=COR.a,maxRot=38}){
  const n=itens.length,W=760,rh=26,H=Math.max(40,n*rh+8),ml=250,mr=itens.some(i=>i.extra)?215:80,xw=W-ml-mr;
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,class:"gw-svg",role:"img"});
  if(!n){svg.append(sv("text",{x:W/2,y:24,"text-anchor":"middle",fill:COR.muted},"Sem dados"));return svg}
  const max=Math.max(1,...itens.map(i=>+i.v||0));
  itens.forEach((it,i)=>{const y=4+i*rh,w=xw*((+it.v||0)/max);const rot=String(it.nome||"—");
    svg.append(sv("text",{x:ml-8,y:y+17,"text-anchor":"end",class:"gw-lbl"},sv("title",{},rot),rot.length>maxRot?rot.slice(0,maxRot-1)+"…":rot));
    svg.append(sv("rect",{x:ml,y:y+4,width:Math.max(w,1),height:rh-10,fill:typeof it.cor==="string"?it.cor:cor,rx:3,opacity:.85}));
    svg.append(sv("text",{x:ml+w+6,y:y+17,class:"gw-val"},fmt(it.v)+(it.extra?"  "+it.extra:"")))});
  return svg;
}
function funil(etapas){
  const max=Math.max(1,...etapas.map(e=>e.v));
  return el("div",{class:"gw-funil"},etapas.map((e,i)=>{const prev=etapas[i-1];const tx=prev&&prev.v>0?e.v/prev.v:null;
    return el("div",{class:"gw-fl"},el("div",{class:"gw-fn"},e.nome),el("div",{class:"gw-fb"},el("i",{style:`width:${Math.max(2,e.v/max*100)}%`})),el("div",{class:"gw-fv num"},N(e.v),tx!=null?el("span",{class:"note"}," · "+P(tx)):""))}));
}

/* ---------- comparação e rótulos ---------- */
function delta(atual,ant,{menorMelhor=false,neutro=false}={}){
  if(atual==null||ant==null||!isFinite(atual)||!isFinite(ant)||ant===0)return {txt:"—",cls:"",rot:"INCONCLUSIVO"};
  const v=(atual-ant)/Math.abs(ant);const melhora=menorMelhor?v<0:v>0;const estavel=Math.abs(v)<0.05;const r=Math.round(v*100);
  const txt=(r>0?"+":"")+r+"%";
  if(neutro)return {txt,cls:"",rot:estavel?"ESTÁVEL":v>0?"SUBIU":"CAIU"};
  return {txt,cls:estavel?"":melhora?"ok":"crit",rot:estavel?"ESTÁVEL":melhora?"MELHOROU":"PIOROU"};
}
function kpi(l,val,h,d){return el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v"},val),el("div",{class:"h"},d?el("span",{class:"gw-d "+d.cls},d.txt+" · "+d.rot):null,d?" ":"",h||""))}
const card=(titulo,sub,...kids)=>el("div",{class:"card gw-card"},el("div",{class:"gw-ch"},el("h2",{},titulo),sub?el("div",{class:"note"},sub):null),...kids);

/* ---------- Data Quality Gate ---------- */
function gate(ctx){
  const probs=[];let nivel="verde";
  const ult=G.status?.ultima_coleta;const horas=ult?(Date.now()-new Date(ult.iniciado_em))/36e5:null;
  if(!ult||ult.ok===false){probs.push("Última coleta falhou"+(ult?.erro?": "+ult.erro.slice(0,120):".")+" Clique em Atualizar agora.");nivel="vermelho"}
  else if(horas>36){probs.push(`Dados do Meta com ${Math.round(horas)}h sem atualização (coleta diária às 06h40).`);nivel="amarelo"}
  if(ctx.meta.dias<G.dias&&ctx.meta.dias>0){probs.push(`Meta: só ${ctx.meta.dias} de ${G.dias} dias têm registro (dias sem entrega ou histórico não coletado).`);if(nivel==="verde")nivel="amarelo"}
  if(ctx.meta.dias===0){probs.push("Sem dados do Meta no período.");nivel="vermelho"}
  const semCamp=ctx.crm.leads-ctx.crm.comCampanha;
  if(ctx.crm.leads&&semCamp/ctx.crm.leads>0.2){probs.push(`${semCamp} de ${ctx.crm.leads} leads do CRM sem campanha (atribuição parcial).`);if(nivel==="verde")nivel="amarelo"}
  if(ctx.semMatch.length&&ctx.semMatch.length/Math.max(1,ctx.crm.leads)>0.2){probs.push(`${ctx.semMatch.length} leads com nome de ${G.nivel} que não bate com o Meta no período (importação atrasada ou nome editado).`);if(nivel==="verde")nivel="amarelo"}
  if(ctx.crm.leads&&ctx.crm.txPend>0.4){probs.push(`${P(ctx.crm.txPend)} dos leads ainda sem avaliação da SDR — taxa de qualificação e CPQL são provisórios.`);if(nivel==="verde")nivel="amarelo"}
  if(ctx.crm.leads&&Math.abs(ctx.crm.leads-ctx.meta.leads)/Math.max(1,ctx.meta.leads)>0.3)probs.push(`Meta registrou ${ctx.meta.leads} leads e o CRM tem ${ctx.crm.leads} no mesmo período — conferir importação da planilha.`);
  const cor=nivel==="verde"?"ok":nivel==="amarelo"?"warn":"crit";const rot=nivel==="verde"?"CONFIÁVEL":nivel==="amarelo"?"PARCIAL":"BLOQUEADO";
  return el("div",{class:"card gw-gate "+cor},el("div",{class:"gw-gate-h"},el("span",{class:"pill "+(nivel==="verde"?"e1":nivel==="amarelo"?"e2":"e3")},rot),el("b",{},"Qualidade dos dados"),el("span",{class:"note"},ult?`última coleta ${new Date(ult.iniciado_em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}`:"sem coleta")),
    probs.length?el("ul",{class:"gw-probs"},probs.slice(0,3).map(p=>el("li",{},p))):el("div",{class:"note"},"Nenhum problema crítico identificado. Hoje está excluído por estar incompleto."));
}

/* ---------- alertas por regra (sem IA) ---------- */
function alertas(ctx){
  const a=[];const {meta,metaAnt,crm,itens}=ctx;
  const d=(x,y)=>x!=null&&y?(x-y)/y:null;
  const cpl=d(meta.cpl,metaAnt.cpl);if(cpl!=null&&cpl>0.3)a.push({n:"crit",t:`CPL subiu ${P(cpl)} vs. período anterior (${R$(metaAnt.cpl)} → ${R$(meta.cpl)}).`,h:"Olhar primeiro criativos/conjuntos com gasto alto e poucos leads na tabela abaixo."});
  if(cpl!=null&&cpl<-0.2)a.push({n:"ok",t:`CPL caiu ${P(-cpl)} vs. período anterior (${R$(metaAnt.cpl)} → ${R$(meta.cpl)}).`,h:"Confirmar se a qualidade (MQL) acompanhou antes de escalar."});
  const ctr=d(meta.ctr,metaAnt.ctr);if(ctr!=null&&ctr<-0.25)a.push({n:"warn",t:`CTR caiu ${P(-ctr)} (${P(metaAnt.ctr)} → ${P(meta.ctr)}).`,h:"Sinal de criativo cansando ou público saturado — ver frequência."});
  if(meta.freq>3&&ctr!=null&&ctr<-0.1&&cpl!=null&&cpl>0.1)a.push({n:"warn",t:`Possível fadiga: frequência ${meta.freq.toFixed(1)}, CTR caindo e CPL subindo ao mesmo tempo.`,h:"Teste criativo novo antes de aumentar orçamento."});
  const gastoTotal=meta.spend;
  for(const it of itens.slice(0,10)){const g=it.meta.spend;if(g>gastoTotal*0.1&&it.meta.leads===0)a.push({n:"crit",t:`"${it.nome}" consumiu ${R$(g)} (${P(g/gastoTotal)} do total) sem nenhum lead.`,h:"Candidato a pausa."});
    if(g>gastoTotal*0.1&&it.meta.cpl&&meta.cpl&&it.meta.cpl>meta.cpl*1.6&&it.meta.leads>0)a.push({n:"warn",t:`"${it.nome}": CPL ${R$(it.meta.cpl)} — ${(it.meta.cpl/meta.cpl).toFixed(1)}× a média.`,h:"Comparar MQL/reuniões antes de cortar: CPL alto pode vir com lead melhor."});
    if(it.crm.avaliados>=5&&it.crm.txQual<0.25&&it.meta.spend>gastoTotal*0.1)a.push({n:"warn",t:`"${it.nome}": só ${P(it.crm.txQual)} dos leads avaliados viraram MQL (${it.crm.qual}/${it.crm.avaliados}).`,h:"Qualidade baixa com gasto relevante — revisar público/promessa do anúncio."})}
  if(crm.leads&&crm.txPend>0.4)a.push({n:"warn",t:`${crm.pend} leads (${P(crm.txPend)}) sem avaliação da SDR no período.`,h:"Backlog comercial: a leitura de qualidade fica provisória enquanto isso não baixa."});
  if(crm.semContato>0&&crm.semContato/Math.max(1,crm.leads)>0.3)a.push({n:"warn",t:`${P(crm.semContato/crm.leads)} dos leads perdidos por falta de contato (sem resposta/número errado).`,h:"Não é problema de qualidade do anúncio; é cadência/velocidade de primeiro contato."});
  const diasSem=ctx.diasPeriodo.filter(dd=>!ctx.contaPorDia.has(dd)||+ctx.contaPorDia.get(dd).spend===0);
  if(diasSem.length&&diasSem.length<G.dias)a.push({n:"warn",t:`${diasSem.length} dia(s) sem entrega no período (${diasSem.slice(0,4).map(fmtDia).join(", ")}${diasSem.length>4?"…":""}).`,h:"Orçamento pausado, reprovação ou falha de coleta."});
  if(!a.length)a.push({n:"ok",t:"Nenhum alerta pelas regras automáticas neste período.",h:""});
  return el("div",{class:"gw-alertas"},a.map(x=>el("div",{class:"gw-al "+x.n},el("div",{},x.t),x.h?el("div",{class:"note"},x.h):null)));
}

/* ---------- ações ---------- */
async function atualizarAgora(dias=3){
  try{const {data:{session}}=await SB.auth.getSession();if(!session)throw new Error("Faça login de novo");toast("Buscando no Meta e no Instagram…");
    const r=await fetch(SB_URL+"/functions/v1/chatguru/enviar",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify({acao:"growth",dias})});
    const j=await r.json().catch(()=>({ok:false,erro:"Resposta inválida"}));if(!r.ok||j.ok===false)throw new Error(j.erro||("HTTP "+r.status));
    toast(`Atualizado: ${j.anuncios} linhas de anúncio, ${j.ig_dias} dias de Instagram${j.avisos?.length?" · "+j.avisos.length+" aviso(s)":""}`);G.ok=false;carregar()}
  catch(e){toast("Não foi possível atualizar: "+e.message)}
}

/* ---------- render ---------- */
function renderGrowth(){
  const v=$("#view-growth");v.replaceChildren();
  const sel=el("select",{onchange:e=>{G.dias=+e.target.value;try{localStorage.setItem("pp-growth-dias",G.dias)}catch(_){}render()}},[7,14,30,60,90].map(n=>el("option",{value:n,selected:G.dias===n?"":null},`últimos ${n} dias`)));
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Gestão"),el("h1",{},"Growth"),el("div",{class:"sub"},"Meta Ads × CRM × Instagram — aquisição, qualidade comercial e decisão.")),
    el("div",{class:"actions"},sel,ehAdmin()?el("button",{class:"btn",title:"Busca os últimos 3 dias no Meta e no Instagram agora (a coleta automática roda às 06h40)",onclick:()=>atualizarAgora(3)},"Atualizar agora"):null)));
  if(!PP.podeGrowth&&!ehAdmin()){v.append(el("div",{class:"card",style:"padding:18px"},el("b",{},"Sem acesso ao Growth."),el("div",{class:"note"},"Peça a um administrador para marcar 'Growth' no seu usuário (Equipe → Usuários)."))); return}
  if(G.erro){v.append(el("div",{class:"card",style:"padding:18px"},el("b",{},"Não foi possível carregar o Growth."),el("div",{class:"note"},G.erro),el("button",{class:"btn",style:"margin-top:10px",onclick:()=>{G.erro=null;carregar()}},"Tentar de novo")));return}
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const pr=periodos();
  const diasPeriodo=[];for(let d=pr.ini;d<=pr.fim;d=addDias(d,1))diasPeriodo.push(d);
  const contaPer=G.conta.filter(r=>entre(r.data,pr.ini,pr.fim)),contaAnt=G.conta.filter(r=>entre(r.data,pr.iniAnt,pr.fimAnt));
  const anPer=G.anuncios.filter(r=>entre(r.data,pr.ini,pr.fim)),anAnt=G.anuncios.filter(r=>entre(r.data,pr.iniAnt,pr.fimAnt));
  const leadsPer=G.leads.filter(l=>entre(l.dia,pr.ini,pr.fim)),leadsAnt=G.leads.filter(l=>entre(l.dia,pr.iniAnt,pr.fimAnt));
  const meta=agregaMeta(contaPer),metaAnt=agregaMeta(contaAnt),crm=agregaCrm(leadsPer),crmAnt=agregaCrm(leadsAnt);
  const {itens,semMatch}=porNivel(anPer,leadsPer,G.nivel);
  const contaPorDia=new Map(G.conta.map(r=>[r.data,r]));
  const ctx={meta,metaAnt,crm,crmAnt,itens,semMatch,diasPeriodo,contaPorDia};
  const atribOk=crm.leads>0&&semMatch.length/crm.leads<0.3;
  const cpql=atribOk&&crm.qual>0?meta.spend/crm.qual:null,custoReun=atribOk&&crm.reun>0?meta.spend/crm.reun:null,cac=atribOk&&crm.ganho>0?meta.spend/crm.ganho:null;
  const cpqlAnt=crmAnt.qual>0?metaAnt.spend/crmAnt.qual:null,custoReunAnt=crmAnt.reun>0?metaAnt.spend/crmAnt.reun:null;
  const rotPer=`${fmtDia(pr.ini)}–${fmtDia(pr.fim)} vs. ${fmtDia(pr.iniAnt)}–${fmtDia(pr.fimAnt)}`;

  v.append(gate(ctx));

  // Aquisição
  v.append(el("div",{class:"section-h"},el("h2",{},"Aquisição (Meta Ads)"),el("span",{class:"note"},rotPer)));
  v.append(el("div",{class:"kpis"},
    kpi("Investimento",R$(meta.spend),`${meta.dias} dias com entrega`,delta(meta.spend,metaAnt.spend,{neutro:true})),
    kpi("Leads (Meta)",N(meta.leads),meta.conversas?`+ ${N(meta.conversas)} conversas`:"formulário nativo",delta(meta.leads,metaAnt.leads)),
    kpi("CPL",R$(meta.cpl),"investimento ÷ leads",delta(meta.cpl,metaAnt.cpl,{menorMelhor:true})),
    kpi("CTR (link)",P(meta.ctr),"cliques no link ÷ impressões",delta(meta.ctr,metaAnt.ctr)),
    kpi("CPM",R$(meta.cpm),"custo por mil impressões",delta(meta.cpm,metaAnt.cpm,{menorMelhor:true})),
    kpi("Frequência",meta.freq?meta.freq.toFixed(1):"—","impressões ÷ alcance",delta(meta.freq,metaAnt.freq,{menorMelhor:true}))));

  // Comercial (coorte = leads que entraram no CRM no período)
  v.append(el("div",{class:"section-h"},el("h2",{},"Qualidade comercial (CRM, mesma coorte)"),el("span",{class:"note"},"leads que entraram no período · avaliado = MQL ou desqualificado pela SDR")));
  v.append(el("div",{class:"kpis"},
    kpi("Leads no CRM",N(crm.leads),`${N(crm.comCampanha)} com campanha`,delta(crm.leads,crmAnt.leads,{neutro:true})),
    kpi("MQL (qualificados)",N(crm.qual),crm.avaliados?`${P(crm.txQual)} dos ${N(crm.avaliados)} avaliados`:"nenhum avaliado ainda",delta(crm.qual,crmAnt.qual)),
    kpi("Desqualificados",N(crm.desq),`+ ${N(crm.semContato)} sem contato`,null),
    kpi("Pendentes",N(crm.pend),`${P(crm.txPend)} sem avaliação`,null),
    kpi("CPQL",cpql!=null?R$(cpql):"não calculável",cpql!=null?"investimento ÷ MQL (provisório se pendência alta)":atribOk?"sem MQL no período":"atribuição insuficiente",cpql!=null?delta(cpql,cpqlAnt,{menorMelhor:true}):null),
    kpi("Reuniões",`${N(crm.reun)} / ${N(crm.real)}`,"agendadas / realizadas",delta(crm.reun,crmAnt.reun)),
    kpi("Custo por reunião",custoReun!=null?R$(custoReun):"—","investimento ÷ reuniões agendadas",custoReun!=null?delta(custoReun,custoReunAnt,{menorMelhor:true}):null),
    kpi("Contratos (Ganho)",N(crm.ganho),cac!=null?`CAC ${R$(cac)}`:"CAC não calculável",delta(crm.ganho,crmAnt.ganho))));

  // Tendência 42 dias
  const fim42=pr.fim,ini42=addDias(fim42,-41);const dias42=[];for(let d=ini42;d<=fim42;d=addDias(d,1))dias42.push(d);
  const gasto42=dias42.map(d=>+(contaPorDia.get(d)?.spend||0)),leads42=dias42.map(d=>+(contaPorDia.get(d)?.leads||0));
  const cpl7=dias42.map((d,i)=>{const w=dias42.slice(Math.max(0,i-6),i+1);const s=w.reduce((x,dd)=>x+ +(contaPorDia.get(dd)?.spend||0),0),l=w.reduce((x,dd)=>x+ +(contaPorDia.get(dd)?.leads||0),0);return l?s/l:null});
  const duas=el("div",{class:"gw-duas"});
  duas.append(card("Investimento e leads por dia","42 dias · barras = investimento (R$), linha = leads",graficoLinhaBarras({dias:dias42,barras:gasto42,linha:leads42,rotBarra:"Investimento",rotLinha:"Leads",fmtB:v=>R$(v)})));
  duas.append(card("CPL (média móvel 7 dias)","Está ficando mais caro ou mais barato gerar lead?",graficoLinhaBarras({dias:dias42,barras:leads42,linha:cpl7,rotBarra:"Leads",rotLinha:"CPL 7d",fmtL:v=>R$(v)})));
  v.append(duas);

  // Funil + composição
  const duas2=el("div",{class:"gw-duas"});
  duas2.append(card("Funil comercial da coorte","Lead → MQL → Reunião agendada → Realizada → Proposta → Ganho · % = passagem da etapa anterior (pipeline registrado)",
    funil([{nome:"Leads",v:crm.leads},{nome:"MQL",v:crm.qual},{nome:"Reunião agendada",v:crm.reun},{nome:"Reunião realizada",v:crm.real},{nome:"Proposta",v:crm.prop},{nome:"Ganho",v:crm.ganho}]),
    el("div",{class:"note",style:"margin-top:8px"},`Pendentes de avaliação: ${N(crm.pend)} · sem contato: ${N(crm.semContato)} · desqualificados: ${N(crm.desq)}`)));
  const porCamp=porNivel(anPer,leadsPer,"campanha").itens;
  duas2.append(card("Onde foi o investimento","Participação de cada campanha no período",graficoBarrasH({itens:porCamp.map(c=>({nome:c.nome,v:c.meta.spend,extra:`(${P(c.meta.spend/Math.max(1,meta.spend))} · ${N(c.meta.leads)} leads)`})),fmt:v=>R$(v)})));
  v.append(duas2);

  // Tabela por nível
  const nivelSel=el("div",{class:"tabs"},[["campanha","Campanhas"],["conjunto","Conjuntos"],["anuncio","Anúncios"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(G.nivel===k),onclick:()=>{G.nivel=k;render()}},l)));
  const cols=[{label:G.nivel==="campanha"?"Campanha":G.nivel==="conjunto"?"Conjunto":"Anúncio",w:"26%",r:r=>el("div",{},el("div",{class:"n"},r.nome||"—"),G.nivel!=="campanha"?el("div",{class:"s"},[r.campanha,G.nivel==="anuncio"?r.conjunto:null].filter(Boolean).join(" · ")):null)},
    {label:"Investimento",num:true,r:r=>R$(r.meta.spend)},{label:"Impr.",num:true,r:r=>N(r.meta.impressions)},{label:"CTR",num:true,r:r=>P(r.meta.ctr)},{label:"Freq.",num:true,r:r=>r.meta.freq?r.meta.freq.toFixed(1):"—"},
    {label:"Leads Meta",num:true,r:r=>N(r.meta.leads)},{label:"CPL",num:true,r:r=>R$(r.meta.cpl)},
    {label:"Leads CRM",num:true,r:r=>N(r.crm.leads)},{label:"MQL",num:true,r:r=>r.crm.avaliados?`${N(r.crm.qual)} (${P(r.crm.txQual)})`:N(r.crm.qual)},{label:"Pend.",num:true,r:r=>N(r.crm.pend)},
    {label:"CPQL",num:true,r:r=>r.cpql!=null?R$(r.cpql):"—"},{label:"Reun.",num:true,r:r=>N(r.crm.reun)},{label:"Ganho",num:true,r:r=>N(r.crm.ganho)}];
  v.append(card("Mídia × comercial por "+(G.nivel==="campanha"?"campanha":G.nivel==="conjunto"?"conjunto":"anúncio"),"CPL baixo não basta: compare com MQL, CPQL e reuniões da mesma linha. Cruzamento pelo nome gravado no lead pelo formulário do Meta.",
    nivelSel,tabela({cols,rows:itens,vazio:"Sem anúncios com entrega no período.",foot:semMatch.length?`${semMatch.length} lead(s) do CRM no período sem correspondência de ${G.nivel} no Meta (fora da atribuição acima).`:null})));

  // Alertas
  v.append(card("Alertas por regra","Sinais calculados automaticamente — FATO, não diagnóstico. A leitura narrativa (Weekly/Monthly) entra em etapa seguinte.",alertas(ctx)));

  // Instagram
  const igPer=G.ig.filter(r=>entre(r.data,pr.ini,pr.fim)),igAnt=G.ig.filter(r=>entre(r.data,pr.iniAnt,pr.fimAnt));
  const igS=x=>({reach:soma(x,"reach"),pv:soma(x,"profile_views"),eng:soma(x,"accounts_engaged"),inter:soma(x,"total_interactions"),novos:soma(x,"follower_count"),site:soma(x,"website_clicks")});
  const ig=igS(igPer),igA=igS(igAnt);const segAtual=[...G.ig].reverse().find(r=>r.followers_total)?.followers_total;
  v.append(el("div",{class:"section-h"},el("h2",{},"Instagram (@nevespaduaadvocacia)"),el("span",{class:"note"},"alcance da conta inclui mídia paga — não é alcance orgânico")));
  v.append(el("div",{class:"kpis"},
    kpi("Seguidores",N(segAtual),ig.novos?`+${N(ig.novos)} no período`:"",null),
    kpi("Contas alcançadas",N(ig.reach),"soma diária (contas únicas por dia)",delta(ig.reach,igA.reach)),
    kpi("Visitas ao perfil",N(ig.pv),"",delta(ig.pv,igA.pv)),
    kpi("Contas engajadas",N(ig.eng),"",delta(ig.eng,igA.eng)),
    kpi("Interações",N(ig.inter),"curtidas, comentários, salvos, compartilhamentos",delta(ig.inter,igA.inter)),
    kpi("Cliques no site",N(ig.site),"",delta(ig.site,igA.site))));
  const igPorDia=new Map(G.ig.map(r=>[r.data,r]));
  const posts=G.posts.filter(p=>p.publicado_em&&p.publicado_em.slice(0,10)>=pr.ini&&p.publicado_em.slice(0,10)<=pr.fim&&p.media_product_type!=="STORY");
  const duas3=el("div",{class:"gw-duas"});
  duas3.append(card("Alcance e visitas ao perfil por dia","42 dias · barras = alcance, linha = visitas ao perfil",graficoLinhaBarras({dias:dias42,barras:dias42.map(d=>+(igPorDia.get(d)?.reach||0)),linha:dias42.map(d=>igPorDia.get(d)?.profile_views??null),rotBarra:"Alcance",rotLinha:"Visitas"})));
  const topo=[...posts].sort((a,b)=>(b.reach||0)-(a.reach||0)).slice(0,8);
  duas3.append(card("Conteúdos com mais alcance","Posts e Reels publicados no período · engajamento = interações ÷ alcance do próprio conteúdo",
    graficoBarrasH({itens:topo.map(p=>({nome:(p.media_product_type==="REELS"?"▶ ":"")+(p.caption||"(sem legenda)").replace(/\s+/g," ").slice(0,60),v:p.reach||0,extra:p.total_interactions?`· ${N(p.total_interactions)} inter. (${P(div(p.total_interactions,p.reach))})`:""})),cor:COR.b})));
  v.append(duas3);
  if(posts.length)v.append(card("Publicações do período",`${posts.length} conteúdo(s)`,tabela({cols:[
    {label:"Data",r:p=>new Date(p.publicado_em).toLocaleDateString("pt-BR")},{label:"Tipo",r:p=>p.media_product_type==="REELS"?"Reel":p.media_type==="CAROUSEL_ALBUM"?"Carrossel":"Post"},
    {label:"Conteúdo",r:p=>el("a",{href:p.permalink,target:"_blank",rel:"noopener"},(p.caption||"(sem legenda)").replace(/\s+/g," ").slice(0,90))},
    {label:"Alcance",num:true,r:p=>N(p.reach)},{label:"Views",num:true,r:p=>N(p.views)},{label:"Curtidas",num:true,r:p=>N(p.like_count)},{label:"Coment.",num:true,r:p=>N(p.comments_count)},{label:"Salvos",num:true,r:p=>N(p.saved)},{label:"Compart.",num:true,r:p=>N(p.shares)},{label:"Engaj.",num:true,r:p=>P(div(p.total_interactions,p.reach))}],
    rows:[...posts].sort((a,b)=>b.publicado_em.localeCompare(a.publicado_em))})));
  v.append(el("div",{class:"note",style:"margin-top:6px"},"Definições: CPL = investimento ÷ leads do Meta · taxa de qualificação = MQL ÷ (MQL + desqualificados) · pendentes = sem avaliação · CPQL e custo por reunião só com a mesma coorte e atribuição ≥ 70% · CAC só com contrato ganho na coorte. Reunião realizada e ganho vêm do pipeline registrado no CRM."));
}
const css=document.createElement("style");css.textContent=`
#view-growth .section-h{display:flex;align-items:baseline;gap:12px;margin-top:6px}#view-growth .section-h h2{font-size:17px}
.gw-card{padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-width:0}.gw-ch h2{font-size:15.5px}.gw-ch .note{margin-top:2px}
.gw-svg{width:100%;height:auto;display:block;overflow:visible}.gw-ax{font-size:11px;fill:var(--muted)}.gw-lbl{font-size:12px;fill:var(--fg)}.gw-val{font-size:12px;fill:var(--muted);font-variant-numeric:tabular-nums}
.gw-duas{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:1100px){.gw-duas{grid-template-columns:1fr}}
.gw-d{font-weight:600;color:var(--muted)}.gw-d.ok{color:var(--ok)}.gw-d.crit{color:var(--crit)}
.gw-gate{padding:14px 18px;border-left:4px solid var(--line)}.gw-gate.ok{border-left-color:var(--ok)}.gw-gate.warn{border-left-color:var(--warn)}.gw-gate.crit{border-left-color:var(--crit)}
.gw-gate-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gw-probs{margin:8px 0 0;padding-left:18px;font-size:13.5px}.gw-probs li{margin:3px 0}
.gw-funil{display:flex;flex-direction:column;gap:7px}.gw-fl{display:grid;grid-template-columns:150px 1fr 120px;gap:10px;align-items:center;font-size:13.5px}.gw-fb{height:18px;background:color-mix(in srgb,var(--ch-a) 12%,transparent);border-radius:4px;overflow:hidden}.gw-fb i{display:block;height:100%;background:var(--ch-a);opacity:.8}.gw-fv{text-align:right}
.gw-alertas{display:flex;flex-direction:column;gap:8px}.gw-al{padding:10px 12px;border-radius:var(--r);border:1px solid var(--line);border-left-width:4px;font-size:13.5px}.gw-al.crit{border-left-color:var(--crit)}.gw-al.warn{border-left-color:var(--warn)}.gw-al.ok{border-left-color:var(--ok)}
#view-growth .kpi .h{display:flex;gap:6px;flex-wrap:wrap}`;document.head.append(css);
{const _r=render;render=function(){_r();const v=$("#view-growth");if(!v)return;v.hidden=S.tab!=="growth";if(S.tab==="growth")renderGrowth()}}
window.PP_GROWTH={recarregar:()=>{G.ok=false;garantir()},atualizar:atualizarAgora};
})();
