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
const pontoV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
/* card em Meu perfil (só quem registra ponto) */
function cardPainel(){
  const me=meuColab();if(!me||!me.registra_ponto)return null;
  if(!PT.ok&&!PT.carregando)carregarMeu();
  const meus=PT.hoje.filter(p=>p.colaborador_id===me.id);const ultimo=meus.at(-1)?.tipo||"";const prox=PROX[ultimo];
  const dia=PT.dias.find(d=>d.dia===hojeISO());
  const status=ultimo===""?"Entrada ainda não registrada hoje.":ultimo==="saida"?"Jornada de hoje encerrada.":ultimo==="saida_intervalo"?"Em intervalo.":"Trabalhando.";
  const total=PT.dias.reduce((s,d)=>s+(+d.minutos||0),0),saldo=PT.dias.reduce((s,d)=>s+(+d.saldo_min||0),0);
  const confirmarBatida=(tipo,comHora)=>npConfirmar({
    titulo:`Registrar ${TIPO[tipo]}?`,
    mensagem:`Registrar “${TIPO[tipo]}” agora${comHora?` (${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})})`:""}?`,
    confirmar:`Registrar ${TIPO[tipo].toLowerCase()}`,
    onSim:()=>bater(tipo)
  });
  if(pontoV3()){
    const outros=Object.keys(TIPO).filter(t=>t!==prox).map(t=>({label:TIPO[t],onclick:()=>{confirmarBatida(t,false)}}));
    const btnMais=NPUI.btn("Outra marcação ▾",{variante:"ghost",onclick:e=>NPUI.pop(e.currentTarget,outros,{label:"Outra marcação",alinhar:"dir"})});
    return el("section",{class:"np-ponto-bar pt-painel"},
      el("div",{class:"info"},
        el("b",{},"Meu ponto · ",status),
        el("span",{},(meus.length?"Hoje: "+meus.map(p=>`${hm(p.momento)} ${TIPO[p.tipo]}`).join(" · "):"Sem marcações hoje")+(dia?` · ${horas(dia.minutos)} trabalhadas`:"")+` · Mês: ${horas(total)} · saldo ${horas(saldo)}`)),
      el("div",{class:"acoes"},
        NPUI.btn(TIPO[prox],{variante:"pri",onclick:()=>{confirmarBatida(prox,true)}}),
        btnMais,
        NPUI.btn("Espelho",{variante:"ghost",onclick:()=>irPara("ponto")})));
  }
  const btn=el("button",{class:"btn primary",style:"font-size:15px;padding:12px 22px",onclick:()=>{confirmarBatida(prox,true)}},"⏱ "+TIPO[prox]);
  const outros=Object.keys(TIPO).filter(t=>t!==prox).map(t=>el("button",{class:"btn sm",onclick:()=>{confirmarBatida(t,false)}},TIPO[t]));
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
function renderPontoV3(v){
  v.classList.add("np-v3");
  const me=meuColab();const gestor=podeEquipe();
  if(!PT.mes)PT.mes=mesISO();
  const mesInp=inp("month",PT.mes,{class:"np-tb-sel","aria-label":"Mês"});mesInp.onchange=()=>{PT.mes=mesInp.value;PT.ok=false;render()};
  const regs=(window.PP_EQUIPE?.lista||[]).filter(c=>c.registra_ponto);
  const quem=gestor?Object.assign(sel({"":"Todos que registram ponto",...Object.fromEntries(regs.map(c=>[c.id,c.nome]))},PT.colab),{className:"np-tb-sel",onchange:e=>{PT.colab=e.target.value;PT.ok=false;render()}}):null;
  const btnCsv=gestor?NPUI.btn("Exportar CSV",{onclick:exportar}):null;
  if(!gestor&&!(me&&me.registra_ponto)){
    v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"—",label:"ponto"}])}),NPUI.vazio({titulo:"Ponto não habilitado",texto:"Seu perfil não registra ponto."}));
    return;
  }
  if(!PT.ok){
    if(!PT.carregando)(gestor?carregarTodos:carregarMeu)();
    v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"—",label:"carregando"}]),direita:[quem,mesInp,btnCsv]}),NPUI.carregando(5));
    return;
  }
  const rows=gestor?PT.todos:PT.dias;
  const totMin=rows.reduce((s,d)=>s+(+d.minutos||0),0),totSaldo=rows.reduce((s,d)=>s+(+d.saldo_min||0),0);
  v.append(NPUI.toolbar({
    resumo:NPUI.resumo([
      {n:String(rows.length),label:rows.length===1?"dia":"dias"},
      {n:horas(totMin),label:"trabalhadas"},
      {n:horas(totSaldo),label:"saldo",tom:totSaldo<0?"crit":""}
    ]),
    direita:[quem,mesInp,btnCsv]
  }));
  if(me&&me.registra_ponto){const bar=cardPainel();if(bar)v.append(bar)}
  if(!rows.length){v.append(NPUI.vazio({titulo:"Nenhuma marcação neste mês",texto:"As marcações de entrada, intervalo e saída aparecerão aqui."}));return}
  const porColab={};for(const r of rows)(porColab[r.colaborador_nome]||=[]).push(r);
  for(const [nome,ds] of Object.entries(porColab)){
    const total=ds.reduce((s,d)=>s+(+d.minutos||0),0),saldo=ds.reduce((s,d)=>s+(+d.saldo_min||0),0);
    const linhas=ds.map(d=>el("tr",{},
      el("td",{class:"np-num"},fmtD(parseD(d.dia))+" "+["dom","seg","ter","qua","qui","sex","sáb"][parseD(d.dia).getDay()],!d.fechado?[" ",NPUI.marca("em aberto","att")]:null),
      el("td",{class:"np-num"},d.entrada?hm(d.entrada):"—"),
      el("td",{class:"np-num"},d.saida?hm(d.saida):"—"),
      el("td",{class:"r"},horas(d.intervalo_min)),
      el("td",{class:"r"},horas(d.minutos)),
      el("td",{class:"r",style:d.saldo_min<0?"color:var(--np-crit)":"color:var(--np-ok)"},horas(d.saldo_min)),
      el("td",{class:"np-ts-sub"},d.batidas_txt||""),
      el("td",{class:"r"},gestor&&admin()?NPUI.btn("Ajustar",{variante:"ghost",onclick:()=>ajustar(d)}):null)));
    v.append(el("section",{class:"np-cfg-sec"},
      el("div",{class:"np-cfg-sh"},el("h2",{},nome),el("span",{class:"desc np-num"},`${ds.length} dia(s) · ${horas(total)} · saldo ${horas(saldo)}`)),
      el("div",{class:"np-ts-tbl-wrap"},el("table",{class:"np-ts-tbl"},
        el("thead",{},el("tr",{},el("th",{},"Dia"),el("th",{},"Entrada"),el("th",{},"Saída"),el("th",{class:"r"},"Intervalo"),el("th",{class:"r"},"Trabalhado"),el("th",{class:"r"},"Saldo"),el("th",{},"Marcações"),el("th",{class:"r"},""))),
        el("tbody",{},linhas)))));
  }
}
function renderPonto(){
  const v=$("#view-ponto");v.replaceChildren();
  if(pontoV3()){renderPontoV3(v);return}
  v.classList.remove("np-v3");
  const me=meuColab();const gestor=podeEquipe();
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
      el("button",{class:"btn sm danger",onclick:()=>{npConfirmar({titulo:"Excluir marcação de ponto?",mensagem:`Remover a marcação de ${TIPO[p.tipo]||p.tipo} (${hm(p.momento)}) de ${d.colaborador_nome}?`,confirmar:"Excluir marcação",perigo:true,onSim:async()=>{const {error}=await SB.from("pontos").delete().eq("id",p.id);if(error)throw error;toast("Excluída");$("#modalHost").replaceChildren();PT.ok=false;render()}})}},"×"),p.ajustado_em?el("span",{class:"note"},"ajustada"):null))}
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
  if(S.tab==="perfil"&&eq){const vp=$("#view-perfil");const old=vp?.querySelector(".pt-painel");if(old)old.remove();const c=cardPainel();const head=vp?.querySelector(".head");if(c&&head)head.after(c)}}}
window.PP_PONTO={invalidar(){PT.ok=false;render()}};
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){window.PP_EQUIPE?.recarregar?.();SB.channel("ponto").on("postgres_changes",{event:"*",schema:"public",table:"pontos"},()=>{PT.ok=false;if(["perfil","ponto"].includes(S.tab))render()}).subscribe()}});
})();
