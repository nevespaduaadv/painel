/* Comercial — metas do mês (meta / super / hiper), realizado × ritmo esperado e lançamento semanal.
   Supabase: metas_comerciais (admin edita), comercial_semanas (equipe lança), v_comercial_mes (0025).
   Regras: só contratos de Gestão de Passivos contam; proposta enviada = agendamento qualificado. */
(()=>{
"use strict";
const C={mes:null,nivel:"meta",metas:[],semanas:[],ok:false,carregando:false,edit:null};
const NIVEL={meta:"Meta",super:"Super meta",hiper:"Hiper meta"};
const COR={meta:"var(--gold)",super:"#2f6fb3",hiper:"#0c1f38"};
const admin=()=>PP.perfil?.papel==="admin";
const iso=d=>d.toISOString().slice(0,10);const parseD=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const mes1=d=>{const x=new Date(d.getFullYear(),d.getMonth(),1);return iso(x)};
const fmtMes=s=>{const t=parseD(s).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});return t.charAt(0).toUpperCase()+t.slice(1)};
const fmt=s=>s?parseD(s).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}):"";
const n0=v=>(+v||0).toLocaleString("pt-BR",{maximumFractionDigits:0});
const n1=v=>(+v||0).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1});
const pc=v=>isFinite(v)?Math.round(v*100)+"%":"—";
const brl=v=>BRL(+v||0);

async function carregar(){
  if(C.carregando)return;C.carregando=true;
  if(!C.mes)C.mes=mes1(new Date());
  try{
    const [m,s]=await Promise.all([SB.from("metas_comerciais").select("*").eq("mes",C.mes),SB.from("comercial_semanas").select("*").eq("mes",C.mes).order("semana")]);
    if(m.error)throw m.error;C.metas=m.data||[];C.semanas=s.data||[];C.ok=true;
  }catch(e){console.warn("comercial",e);toast("Não foi possível carregar as metas comerciais")}
  finally{C.carregando=false}
  render();
}
const garantir=()=>{if(!C.ok&&!C.carregando)carregar();return C.ok};
const invalidar=()=>{C.ok=false;if(S.tab==="comercial")garantir()};
const meta=niv=>C.metas.find(m=>m.nivel===(niv||C.nivel));

/* ---------- cálculo ---------- */
function totais(){
  const L=C.semanas.filter(s=>s.lancado);
  const sum=k=>L.reduce((a,s)=>a+(+s[k]||0),0);
  const dias=s=>+s.dias||((parseD(s.fim)-parseD(s.inicio))/864e5+1);
  const diasTot=C.semanas.reduce((a,s)=>a+dias(s),0)||1,diasLan=L.reduce((a,s)=>a+dias(s),0);
  const diasUteisTot=C.semanas.reduce((a,s)=>a+(+s.dias_uteis||0),0)||1,diasUteisLan=L.reduce((a,s)=>a+(+s.dias_uteis||0),0);
  return {leads:sum("leads"),agendamentos:sum("agendamentos"),propostas:sum("propostas"),contratos:sum("contratos"),valor:sum("valor"),investimento:sum("investimento"),diasTot,diasLan,diasUteisTot,diasUteisLan,ritmo:diasLan/diasTot,semanas:L.length};
}
const alvo=m=>m?{contratos:+m.contratos,valor:+m.contratos*+m.ticket,ticket:+m.ticket,propostas:+m.propostas,agendamentos:+m.agendamentos,leads:+m.leads,investimento:+m.investimento,agDia:0}:null;

/* ---------- tela ---------- */
function renderComercial(){
  const v=$("#view-comercial");v.replaceChildren();
  const ok=garantir();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Comercial"),el("h1",{},"Metas do mês"),el("div",{class:"sub"},"Meta, super e hiper · realizado × ritmo esperado · lançamento semanal. Só contratos de Gestão de Passivos contam; proposta enviada = agendamento qualificado.")),
    el("div",{class:"actions"},
      el("button",{class:"btn sm",onclick:()=>{const d=parseD(C.mes);d.setMonth(d.getMonth()-1);C.mes=iso(d);C.ok=false;render()}},"‹"),
      el("strong",{style:"min-width:150px;text-align:center"},fmtMes(C.mes||mes1(new Date()))),
      el("button",{class:"btn sm",onclick:()=>{const d=parseD(C.mes);d.setMonth(d.getMonth()+1);C.mes=iso(d);C.ok=false;render()}},"›"),
      admin()?el("button",{class:"btn sm primary",onclick:()=>formMetas()},C.metas.length?"Editar metas":"+ Definir metas"):null)));
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  if(!C.metas.length){v.append(el("div",{class:"card section"},el("h3",{},"Sem metas para este mês"),el("p",{class:"note"},admin()?"Defina a meta, a super meta e a hiper meta em \"Definir metas\". Dica: copie do mês anterior e ajuste.":"As sócias ainda não definiram as metas deste mês."),admin()&&C.semanas.length===0?el("button",{class:"btn sm",onclick:gerarSemanas},"Gerar semanas do mês"):null));return}
  const T=totais(),A=alvo(meta());
  // seletor de nível
  v.append(el("div",{class:"tabs",style:"margin:0 0 12px;justify-content:flex-start"},Object.entries(NIVEL).map(([k,l])=>{const m=meta(k);return el("button",{class:"tab cm-niv","aria-selected":String(C.nivel===k),onclick:()=>{C.nivel=k;render()}},`${l} · ${m?brl(m.contratos*m.ticket):"—"}`)})));
  // tiles
  const tile=(l,real,alv,fmtF,inv)=>{const esp=alv*T.ritmo;const r=alv?real/alv:0;const ok=inv?real<=esp||!T.semanas:real>=esp*0.95;return el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num"},fmtF(real)),el("div",{class:"h"},`${pc(r)} da meta de ${fmtF(alv)}`),el("div",{class:"cm-bar"},el("i",{style:`width:${Math.min(100,r*100)}%;background:${ok?"var(--ok)":"var(--crit)"}`}),el("b",{style:`left:${Math.min(100,T.ritmo*100)}%`,title:"ritmo esperado hoje"})),T.semanas?el("div",{class:"note"},`esperado até aqui: ${fmtF(esp)}`):null)};
  const ticketReal=T.contratos?T.valor/T.contratos:0,taxa=T.propostas?T.contratos/T.propostas:0,taxaAlvo=A.propostas?A.contratos/A.propostas:0;
  v.append(el("div",{class:"kpis cm-kpis"},
    tile("Contratos GP",T.contratos,A.contratos,n0),tile("Valor contratado",T.valor,A.valor,brl),
    el("div",{class:"card kpi"},el("div",{class:"l"},"Ticket médio"),el("div",{class:"v num"},T.contratos?brl(ticketReal):"—"),el("div",{class:"h"},`meta ${brl(A.ticket)}`)),
    tile("Propostas (qualificados)",T.propostas,A.propostas,n0),tile("Agendamentos",T.agendamentos,A.agendamentos,n0),tile("Leads (Meta)",T.leads,A.leads,n0),
    tile("Investimento",T.investimento,A.investimento,brl,true),
    el("div",{class:"card kpi"},el("div",{class:"l"},"Proposta → contrato"),el("div",{class:"v num"},T.propostas?pc(taxa):"—"),el("div",{class:"h"},`meta ${pc(taxaAlvo)} · CPL ${T.leads?brl(T.investimento/T.leads):"—"} (plan. ${meta()?.cpl?brl(meta().cpl):"—"})`))));
  // funil + SDR + semanas
  const g=el("div",{class:"cm-grid"});
  g.append(el("div",{class:"card section"},el("h3",{},"Funil do mês — realizado × meta"),funil(T,A),el("p",{class:"note"},`Taxas-base: lead → agendamento 35% · agendamento → proposta 70% · proposta → contrato ${pc(taxaAlvo)}. Linha dourada = ritmo esperado (${pc(T.ritmo)} do mês lançado, em dias corridos).`)));
  g.append(el("div",{class:"card section"},el("h3",{},"Ritmo da SDR"),sdr(T,A)));
  v.append(g);
  v.append(semanasCard(T,A));
}
function funil(T,A){
  const etapas=[["Leads",T.leads,A.leads],["Agendamentos",T.agendamentos,A.agendamentos],["Propostas",T.propostas,A.propostas],["Contratos",T.contratos,A.contratos]];
  const W=520,H=etapas.length*44+10,maxA=Math.max(...etapas.map(e=>e[2]),1);
  let s=`<svg viewBox="0 0 ${W} ${H}" class="cm-svg" role="img" aria-label="Funil realizado versus meta">`;
  etapas.forEach(([l,r,a],i)=>{const y=i*44+8,x0=130,w=W-x0-60,wa=w*a/maxA,wr=w*Math.min(r,a*1.3)/maxA,xr=x0+wa*T.ritmo;
    s+=`<text x="${x0-10}" y="${y+19}" text-anchor="end" class="cm-l">${l}</text><rect x="${x0}" y="${y}" width="${wa}" height="26" rx="4" fill="var(--line)"/><rect x="${x0}" y="${y}" width="${wr}" height="26" rx="4" fill="${r>=a*T.ritmo*0.95?"#2e7d4f":"#b4452f"}" opacity=".85"/><line x1="${xr}" x2="${xr}" y1="${y-3}" y2="${y+29}" stroke="var(--gold)" stroke-width="2"/><text x="${x0+wa+8}" y="${y+19}" class="cm-n">${n0(r)} / ${n0(a)}</text>`});
  return el("div",{html:s+"</svg>"});
}
function sdr(T,A){
  const diaAlvo=A.agendamentos/(T.diasUteisTot||1);
  const rows=C.semanas.map(s=>{const d=s.lancado&&s.dias_uteis?s.agendamentos/s.dias_uteis:null;return el("div",{class:"cm-sdr-row"},el("span",{},`S${s.semana}`,el("small",{}," "+fmt(s.inicio)+"–"+fmt(s.fim))),el("div",{class:"cm-bar lg"},d!=null?el("i",{style:`width:${Math.min(100,d/(diaAlvo*1.5)*100)}%;background:${d>=diaAlvo?"#2e7d4f":"#b4452f"}`}):null,el("b",{style:`left:${Math.min(100,1/1.5*100)}%`})),el("span",{class:"num"},d!=null?n1(d)+"/dia":"—"))});
  return el("div",{},el("div",{class:"cm-sdr-head"},el("div",{},el("div",{class:"v num",style:"font-size:28px"},n1(diaAlvo)),el("div",{class:"h"},"agendamentos por dia útil (meta)")),el("div",{},el("div",{class:"v num",style:"font-size:28px"},n0(diaAlvo*5)),el("div",{class:"h"},"por semana cheia (5 dias)")),el("div",{},el("div",{class:"v num",style:"font-size:28px"},n0(A.propostas)),el("div",{class:"h"},"propostas no mês (70% dos agendamentos)"))),...rows,el("p",{class:"note"},"Linha dourada = meta diária. Em setembro: 37 agendamentos (1,8/dia), com uma semana de 13 — a meta é fazer dessa semana o padrão."));
}
function semanasCard(T,A){
  const podeEditar=typeof equipe==="function"&&equipe();
  const cab=["Semana","Dias úteis","Leads","Agend.","Propostas","Contratos","Valor GP (R$)","Invest. (R$)",""];
  const rows=C.semanas.map(s=>{const ed=C.edit===s.id;const f={};const cell=(k,step="1")=>ed?el("td",{},f[k]=inp("number",s[k],{step,min:"0",style:"width:90px"})):el("td",{class:"num r"},k==="valor"||k==="investimento"?(s.lancado?brl(s[k]):"—"):(s.lancado?n0(s[k]):"—"));
    return el("tr",{class:s.lancado?"":"cm-pend"},el("td",{},el("b",{},`S${s.semana}`),el("div",{class:"note"},fmt(s.inicio)+" – "+fmt(s.fim))),ed?el("td",{},f.dias_uteis=inp("number",s.dias_uteis,{min:"0",max:"7",style:"width:60px"})):el("td",{class:"num r"},s.dias_uteis),
      cell("leads"),cell("agendamentos"),cell("propostas"),cell("contratos"),cell("valor","100"),cell("investimento","10"),
      el("td",{class:"r"},!podeEditar?null:ed?[el("button",{class:"btn sm primary",onclick:async()=>{const up={};for(const k in f)up[k]=+f[k].value||0;up.lancado=true;const {error}=await SB.from("comercial_semanas").update(up).eq("id",s.id);if(error){toast(error.message);return}C.edit=null;toast("Semana salva");invalidar()}},"Salvar")," ",el("button",{class:"btn sm",onclick:()=>{C.edit=null;render()}},"Cancelar")]:el("button",{class:"btn sm",onclick:()=>{C.edit=s.id;render()}},s.lancado?"Editar":"Lançar")))});
  return el("div",{class:"card section"},el("div",{class:"head",style:"margin:0 0 8px"},el("div",{},el("h3",{},"Lançamento semanal"),el("p",{class:"note",style:"margin:0"},"Semanas em dias corridos (leads e investimento contam sábado e domingo); dias úteis só para o ritmo da SDR. Preencha ao fim de cada semana. Leads = formulários do Meta · Agendamentos = marcados pela SDR · Propostas = qualificados · Contratos e Valor = só Gestão de Passivos · Investimento = gasto Meta da semana.")),admin()&&!C.semanas.length?el("button",{class:"btn sm",onclick:gerarSemanas},"Gerar semanas do mês"):null),
    el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},cab.map((h,i)=>el("th",{class:i>0&&i<8?"r":""},h)))),el("tbody",{},rows.length?rows:el("tr",{},el("td",{colspan:"9",class:"note"},"Nenhuma semana cadastrada para este mês."))))),
    T.semanas?el("p",{class:"note"},`${T.semanas} de ${C.semanas.length} semanas lançadas · ${T.diasLan} de ${T.diasTot} dias (${pc(T.ritmo)} do mês) · ${T.diasUteisLan} de ${T.diasUteisTot} dias úteis.`):null);
}

/* ---------- formulários ---------- */
function formMetas(){
  const niv=Object.keys(NIVEL),campos=[["contratos","Contratos GP","1"],["ticket","Ticket médio (R$)","500"],["propostas","Propostas (qualificados)","1"],["agendamentos","Agendamentos","1"],["leads","Leads","1"],["investimento","Investimento Meta (R$)","100"],["taxa_prop_contrato","Proposta → contrato (%)","1"],["cpl","CPL planejado (R$)","1"]];
  const F={};niv.forEach(n=>F[n]={});
  const tbl=el("table",{class:"cm-form"},el("thead",{},el("tr",{},el("th",{},""),niv.map(n=>el("th",{},NIVEL[n])))),el("tbody",{},campos.map(([k,l,step])=>el("tr",{},el("td",{},l),niv.map(n=>el("td",{},F[n][k]=inp("number",meta(n)?.[k]??"",{step,min:"0",style:"width:110px"})))))));
  const obs=el("textarea",{placeholder:"Observações (premissas, ressalvas)"},meta("meta")?.observacoes||"");
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("div",{class:"note"},`Metas de ${fmtMes(C.mes)}. Valor contratado = contratos × ticket. Sugestão de progressão: contratos 6 / 8 / 10, ticket 28 / 30 / 32k.`),tbl),field("mc-obs","Observações",obs));
  const extra=el("button",{class:"btn",onclick:async()=>{const d=parseD(C.mes);d.setMonth(d.getMonth()-1);const {data}=await SB.from("metas_comerciais").select("*").eq("mes",iso(d));if(!data?.length){toast("Mês anterior sem metas");return}data.forEach(m=>{for(const [k] of campos)if(F[m.nivel]?.[k])F[m.nivel][k].value=m[k]??""});toast("Copiado do mês anterior — ajuste e salve")}},"Copiar do mês anterior");
  modal("Metas comerciais — "+fmtMes(C.mes),body,async()=>{
    const rows=niv.map(n=>{const r={mes:C.mes,nivel:n,observacoes:n==="meta"?obs.value||null:(meta(n)?.observacoes||null)};for(const [k] of campos){const v=F[n][k].value;r[k]=v===""?(["taxa_prop_contrato","cpl"].includes(k)?null:0):+v}return r});
    const {error}=await SB.from("metas_comerciais").upsert(rows,{onConflict:"mes,nivel"});if(error)throw error;
    if(!C.semanas.length)await gerarSemanas(true);
    toast("Metas salvas");invalidar();
  },extra);
}
async function gerarSemanas(silencioso){
  const ini=parseD(C.mes),fim=new Date(ini.getFullYear(),ini.getMonth()+1,0);
  const rows=[];let d=new Date(ini),n=1;
  while(d<=fim){const s0=new Date(d);let dias=0;
    do{const w=d.getDay();if(w!==0&&w!==6)dias++;d.setDate(d.getDate()+1)}while(d<=fim&&d.getDay()!==1);  // até domingo (ou fim do mês)
    const s1=new Date(d);s1.setDate(s1.getDate()-1);
    rows.push({mes:C.mes,semana:n++,inicio:iso(s0),fim:iso(s1),dias_uteis:dias});}
  const nd=r=>(parseD(r.fim)-parseD(r.inicio))/864e5+1;
  if(rows.length>1&&nd(rows[0])<3){rows[1].inicio=rows[0].inicio;rows[1].dias_uteis+=rows[0].dias_uteis;rows.shift()}
  if(rows.length>1&&nd(rows.at(-1))<3){const u=rows.pop();rows.at(-1).fim=u.fim;rows.at(-1).dias_uteis+=u.dias_uteis}
  rows.forEach((r,i)=>r.semana=i+1);
  const {error}=await SB.from("comercial_semanas").upsert(rows,{onConflict:"mes,semana",ignoreDuplicates:true});
  if(error){toast(error.message);return}
  if(!silencioso){toast("Semanas geradas — ajuste os dias úteis se houver feriado");invalidar()}
}

/* ---------- estilo e registro ---------- */
document.head.append(el("style",{},`
.cm-niv{border-color:var(--line);color:var(--fg)}.cm-niv[aria-selected="true"]{background:var(--navy);color:#fff;border-color:var(--navy)}
.cm-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:1000px){.cm-niv{border-color:var(--line);color:var(--fg)}.cm-niv[aria-selected="true"]{background:var(--navy);color:#fff;border-color:var(--navy)}
.cm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cm-bar{position:relative;height:6px;background:var(--line);border-radius:3px;margin-top:8px;overflow:visible}.cm-bar i{display:block;height:100%;border-radius:3px}.cm-bar b{position:absolute;top:-3px;width:2px;height:12px;background:var(--gold)}.cm-bar.lg{height:10px;flex:1;margin:0}
.cm-grid{display:grid;grid-template-columns:3fr 2fr;gap:16px;margin:16px 0}@media(max-width:900px){.cm-grid{grid-template-columns:1fr}}
.cm-svg{width:100%;height:auto}.cm-l{font-size:13px;fill:var(--muted)}.cm-n{font-size:12px;fill:var(--fg);font-variant-numeric:tabular-nums}
.cm-sdr-head{display:flex;gap:18px;margin-bottom:12px;flex-wrap:wrap}.cm-sdr-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px solid var(--line);font-size:13px}.cm-sdr-row>span:first-child{width:118px}.cm-sdr-row small{color:var(--muted)}.cm-sdr-row .num{width:64px;text-align:right}
tr.cm-pend td{color:var(--muted)}.cm-form td,.cm-form th{padding:4px 6px;text-align:left}.cm-form th{font-size:12px;color:var(--muted)}
`));
window.PP_COMERCIAL={invalidar,render:renderComercial};
{const _r=render;render=function(){_r();const vc=$("#view-comercial");if(!vc)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="comercial")S.tab="clientes";vc.hidden=S.tab!=="comercial";if(S.tab==="comercial")renderComercial()}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("comercial");let t;const re=()=>{clearTimeout(t);t=setTimeout(invalidar,400)};ch.on("postgres_changes",{event:"*",schema:"public",table:"comercial_semanas"},re);ch.on("postgres_changes",{event:"*",schema:"public",table:"metas_comerciais"},re);ch.subscribe()}});
})();
