/* Ponto — estagiários (colaboradores.registra_ponto): botão no Meu painel (entrada → intervalo → volta → saída), espelho do mês;
   administração confere/ajusta em Equipe → Ponto. Supabase: pontos, v_ponto_dias, bater_ponto() (0060). */
(()=>{
"use strict";
const PT={hoje:[],dias:[],ok:false,carregando:false,mes:null,colab:"",todos:[]};
const admin=()=>PP.perfil?.papel==="admin";const podeEquipe=()=>admin()||(PP.perfil?.acessos||[]).includes("equipe");
const TIPO={entrada:"Entrada",saida_intervalo:"Saída para intervalo",volta_intervalo:"Volta do intervalo",saida:"Saída"};
const PROX={"":"entrada",entrada:"saida_intervalo",saida_intervalo:"volta_intervalo",volta_intervalo:"saida",saida:"entrada"};
const hm=iso=>new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const hojeISO=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
const mesISO=()=>hojeISO().slice(0,7);
const horas=min=>{min=Math.round(min||0);const s=min<0?"-":"";min=Math.abs(min);return `${s}${Math.floor(min/60)}h${String(min%60).padStart(2,"0")}`};
const meuColab=()=>window.PP_EQUIPE?.lista?.find(c=>c.perfil_id===PP.perfil?.id);
async function carregarMeu(){
  if(PT.carregando)return;PT.carregando=true;
  try{const mes=PT.mes||mesISO();const ini=mes+"-01";const fim=new Date(+mes.slice(0,4),+mes.slice(5,7),1).toISOString().slice(0,10);
    const [h,d]=await Promise.all([SB.from("pontos").select("*").gte("momento",hojeISO()+"T03:00:00Z").order("momento"),SB.from("v_ponto_dias").select("*").gte("dia",ini).lt("dia",fim).order("dia",{ascending:false})]);
    PT.hoje=h.data||[];PT.dias=d.data||[];PT.ok=true}
  catch(e){console.warn("ponto",e)}finally{PT.carregando=false}
  render();
}
async function bater(tipo){
  const {data,error}=await SB.rpc("bater_ponto",{p_tipo:tipo||null,p_obs:null});
  if(error){toast(error.message||"Não foi possível registrar");return}
  toast(`${TIPO[data.tipo]} registrada às ${hm(data.momento)}`);PT.ok=false;carregarMeu();
}
/* card no Meu painel (só quem registra ponto) */
function cardPainel(){
  const me=meuColab();if(!me||!me.registra_ponto)return null;
  if(!PT.ok&&!PT.carregando)carregarMeu();
  const meus=PT.hoje.filter(p=>p.colaborador_id===me.id);const ultimo=meus.at(-1)?.tipo||"";const prox=PROX[ultimo];
  const dia=PT.dias.find(d=>d.dia===hojeISO());
  const status=ultimo===""?"Você ainda não registrou a entrada hoje.":ultimo==="saida"?"Jornada de hoje encerrada.":ultimo==="saida_intervalo"?"Em intervalo.":"Trabalhando.";
  const btn=el("button",{class:"btn primary",style:"font-size:15px;padding:12px 22px",onclick:()=>{if(window.confirm(`Registrar "${TIPO[prox]}" agora (${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})})?`))bater(prox)}},"⏱ "+TIPO[prox]);
  const outros=Object.keys(TIPO).filter(t=>t!==prox).map(t=>el("button",{class:"btn sm",onclick:()=>{if(window.confirm(`Registrar "${TIPO[t]}" agora?`))bater(t)}},TIPO[t]));
  const total=PT.dias.reduce((s,d)=>s+(+d.minutos||0),0),saldo=PT.dias.reduce((s,d)=>s+(+d.saldo_min||0),0);
  return el("section",{class:"card section pt-painel"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Meu ponto"),el("div",{class:"note"},status)),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>irPara("ponto")},"Espelho do mês"))),
    el("div",{style:"display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px"},btn,el("div",{class:"note"},"Outra marcação: "),...outros),
    el("div",{class:"note",style:"margin-top:8px"},meus.length?"Hoje: "+meus.map(p=>`${hm(p.momento)} ${TIPO[p.tipo]}`).join(" · "):"Sem marcações hoje.",dia?` · ${horas(dia.minutos)} trabalhadas`:""),
    el("div",{class:"note"},`Mês: ${horas(total)} · saldo ${horas(saldo)} (jornada ${horas(me.jornada_minutos||360)}/dia)`));
}
/* tela: meu espelho (todos que registram) / conferência (equipe/admin) */
async function carregarTodos(){
  if(PT.carregando)return;PT.carregando=true;
  try{const mes=PT.mes||mesISO();const ini=mes+"-01";const fim=new Date(+mes.slice(0,4),+mes.slice(5,7),1).toISOString().slice(0,10);
    const q=SB.from("v_ponto_dias").select("*").gte("dia",ini).lt("dia",fim).order("colaborador_nome").order("dia",{ascending:false});
    const {data}=await (PT.colab?q.eq("colaborador_id",PT.colab):q);PT.todos=data||[];
    const h=await SB.from("pontos").select("*").gte("momento",hojeISO()+"T03:00:00Z").order("momento");PT.hoje=h.data||[];PT.ok=true}
  catch(e){console.warn("ponto",e)}finally{PT.carregando=false}
  render();
}
function renderPonto(){
  const v=$("#view-ponto");v.replaceChildren();const me=meuColab();const gestor=podeEquipe();
  if(!PT.mes)PT.mes=mesISO();
  const mesInp=inp("month",PT.mes);mesInp.onchange=()=>{PT.mes=mesInp.value;PT.ok=false;render()};
  const regs=(window.PP_EQUIPE?.lista||[]).filter(c=>c.registra_ponto);
  const quem=gestor?sel({"":"Todos que registram ponto",...Object.fromEntries(regs.map(c=>[c.id,c.nome]))},PT.colab):null;if(quem)quem.onchange=()=>{PT.colab=quem.value;PT.ok=false;render()};
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Equipe"),el("h1",{},gestor?"Ponto":"Meu ponto"),el("div",{class:"sub"},gestor?"Marcações dos estagiários. Clique no dia para ajustar ou incluir uma batida (fica registrado quem ajustou).":"Suas marcações do mês.")),
    el("div",{class:"actions"},quem,mesInp,gestor?el("button",{class:"btn",onclick:exportar},"Exportar CSV"):null)));
  if(!gestor&&!(me&&me.registra_ponto)){v.append(el("div",{class:"card empty"},"Seu perfil não registra ponto."));return}
  if(!PT.ok){if(!PT.carregando)(gestor?carregarTodos:carregarMeu)();v.append(el("div",{class:"note"},"Carregando…"));return}
  const rows=gestor?PT.todos:PT.dias;
  const porColab={};for(const r of rows)(porColab[r.colaborador_nome]||=[]).push(r);
  for(const [nome,ds] of Object.entries(porColab)){
    const total=ds.reduce((s,d)=>s+(+d.minutos||0),0),saldo=ds.reduce((s,d)=>s+(+d.saldo_min||0),0);
    const linhas=ds.map(d=>el("tr",{style:d.fechado?"":"color:var(--warn)"},el("td",{},fmtD(parseD(d.dia))+" "+["dom","seg","ter","qua","qui","sex","sáb"][parseD(d.dia).getDay()]),el("td",{},d.entrada?hm(d.entrada):"—"),el("td",{},d.saida?hm(d.saida):"—"),el("td",{},horas(d.intervalo_min)),el("td",{class:"num"},horas(d.minutos)),el("td",{class:"num",style:d.saldo_min<0?"color:var(--crit)":"color:var(--ok)"},horas(d.saldo_min)),el("td",{class:"note"},d.batidas_txt||""),
      el("td",{},gestor&&admin()?el("button",{class:"btn sm",onclick:()=>ajustar(d)},"Ajustar"):null)));
    v.append(el("div",{class:"card",style:"padding:0;overflow:auto;margin-bottom:14px"},el("div",{class:"section-h",style:"padding:12px 16px;border-bottom:1px solid var(--line)"},el("h2",{},nome),el("span",{class:"note"},`${ds.length} dia(s) · ${horas(total)} · saldo ${horas(saldo)}`)),
      el("table",{class:"tbl"},el("thead",{},el("tr",{},...["Dia","Entrada","Saída","Intervalo","Trabalhado","Saldo","Marcações",""].map(h=>el("th",{},h)))),el("tbody",{},linhas))));
  }
  if(!rows.length)v.append(el("div",{class:"card empty"},"Nenhuma marcação neste mês."));
}
async function ajustar(d){
  const {data:ps}=await SB.from("pontos").select("*").eq("colaborador_id",d.colaborador_id).gte("momento",d.dia+"T03:00:00Z").lt("momento",new Date(new Date(d.dia+"T03:00:00Z").getTime()+864e5).toISOString()).order("momento");
  const lista=el("div",{style:"display:grid;gap:6px"});
  for(const p of (ps||[])){const t=inp("time",new Date(p.momento).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}));const tp=sel(TIPO,p.tipo);
    lista.append(el("div",{style:"display:flex;gap:6px;align-items:center"},tp,t,el("button",{class:"btn sm",onclick:async()=>{const {error}=await SB.from("pontos").update({tipo:tp.value,momento:new Date(d.dia+"T"+t.value+":00-03:00").toISOString(),ajustado_por:PP.perfil.id,ajustado_em:new Date().toISOString()}).eq("id",p.id);toast(error?"Não foi possível":"Ajustado");PT.ok=false;render()}},"Salvar"),
      el("button",{class:"btn sm danger",onclick:async()=>{if(!window.confirm("Excluir esta marcação?"))return;await SB.from("pontos").delete().eq("id",p.id);toast("Excluída");$("#modalHost").replaceChildren();PT.ok=false;render()}},"×"),p.ajustado_em?el("span",{class:"note"},"ajustada"):null))}
  const nt=sel(TIPO,"entrada"),nh=inp("time","09:00"),obs=inp("text","",{placeholder:"motivo (ex.: esqueceu de bater)"});
  const body=el("div",{},el("div",{class:"note",style:"margin-bottom:8px"},`${d.colaborador_nome} — ${fmtD(parseD(d.dia))}`),lista,el("div",{class:"form",style:"margin-top:12px"},field("pt-nt","Incluir marcação",nt),field("pt-nh","Hora",nh),field("pt-obs","Observação",obs)));
  modal("Ajustar ponto",body,async()=>{const {error}=await SB.from("pontos").insert({colaborador_id:d.colaborador_id,tipo:nt.value,momento:new Date(d.dia+"T"+nh.value+":00-03:00").toISOString(),origem:"ajuste",obs:obs.value.trim()||null,ajustado_por:PP.perfil.id,ajustado_em:new Date().toISOString()});if(error)throw new Error(error.message);toast("Marcação incluída");PT.ok=false;render()});
}
function exportar(){
  const rows=PT.todos;if(!rows.length){toast("Nada para exportar");return}
  const csv=["colaborador;dia;entrada;saida;intervalo_min;trabalhado_min;saldo_min;marcacoes",...rows.map(d=>[d.colaborador_nome,d.dia,d.entrada?hm(d.entrada):"",d.saida?hm(d.saida):"",Math.round(d.intervalo_min||0),Math.round(d.minutos||0),d.saldo_min,(d.batidas_txt||"").replace(/;/g,",")].join(";"))].join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));a.download=`ponto-${PT.mes||mesISO()}.csv`;a.click();
}
{const _r=render;render=function(){_r();const v=$("#view-ponto");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="ponto")S.tab="clientes";v.hidden=S.tab!=="ponto";if(S.tab==="ponto")renderPonto();
  if(S.tab==="painel"&&eq){const vp=$("#view-painel");const old=vp?.querySelector(".pt-painel");if(old)old.remove();const c=cardPainel();const head=vp?.querySelector(".head");if(c&&head){const av=vp.querySelector(".av-painel");(av||head).after(c)}}}}
window.PP_PONTO={invalidar(){PT.ok=false;render()}};
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){window.PP_EQUIPE?.recarregar?.();SB.channel("ponto").on("postgres_changes",{event:"*",schema:"public",table:"pontos"},()=>{PT.ok=false;if(["painel","ponto"].includes(S.tab))render()}).subscribe()}});
})();
