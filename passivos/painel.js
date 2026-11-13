/* Meu painel — tela inicial da equipe: o que vence (minhas tarefas / equipe), carteira, leads e atividade recente.
   Lê v_prazos (tarefas + processos + negociações), v_tarefas, v_leads (resumo), tarefa_eventos e os dados já carregados (S.clientes/S.contratos). */
(()=>{
"use strict";
const D={ok:false,carregando:false,prazos:[],tarefas:[],colab:[],eventos:[],leads:null,escopo:"minhas",cal:{ref:null,chave:null,agenda:[],carregando:false,dia:null},foco:{dia:null,modo:"dia"}};
try{D.escopo=localStorage.getItem("pp-painel-escopo")||"minhas"}catch(_){}
const meuColab=()=>D.colab.find(c=>c.perfil_id===PP.perfil?.id);
const fmtDT=v=>{if(!v)return"";const d=new Date(v);return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
async function carregar(){
  if(D.carregando)return;D.carregando=true;
  try{
    const [p,t,c,e,l,tk]=await Promise.all([
      SB.from("v_prazos").select("*").order("prazo"),
      SB.from("v_tarefas").select("id,titulo,status,prazo,prazo_fatal,responsavel_id,responsavel_nome,cliente_nome,faixa,created_by").in("status",["aberta","em_andamento"]),
      SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo"),
      SB.from("tarefa_eventos").select("*").order("criado_em",{ascending:false}).limit(80),
      SB.from("v_leads").select("id,nome,empresa,status,atraso,tarefas_vencidas,proprietario_id,fase_nome").eq("status","Aberto"),
      SB.from("v_tickets").select("*")]);
    if(p.error)throw p.error;
    D.prazos=p.data||[];D.tarefas=t.data||[];D.colab=c.data||[];D.eventos=e.data||[];D.leads=l.error?null:(l.data||[]);D.tickets=tk?.data||[];D.ok=true;
  }catch(err){console.warn("painel",err);toast("Não foi possível carregar o painel")}
  finally{D.carregando=false}
  if(S.tab==="painel")render();
}
function garantir(){if(!D.ok&&!D.carregando)carregar();return D.ok}
const EVENTO={criada:"abriu",reatribuida:"passou",prazo_alterado:"adiou o prazo de",status:"mudou o status de",concluida:"concluiu",reaberta:"reabriu",cancelada:"cancelou",comentario:"comentou em",editada:"editou"};
function cardPrazos(lista,titulo,vazio){
  const sem=f=>f==="atrasada"||f==="hoje"?"var(--crit)":f==="d7"?"var(--warn)":"var(--ok)";
  const abrir=z=>{if(z.origem==="tarefa"){window.PP_TAREFAS?.abrir(z.id);return}if(z.cliente_id){try{history.pushState(null,"","#clientes/"+encodeURIComponent(z.cliente_id)+"/"+(z.origem==="processo"?"processos":"negociacoes"))}catch(_){}if(aplicarHash())render()}};
  const quando=z=>z.faixa==="atrasada"?`${-z.dias_para_prazo}d atrás`:z.faixa==="hoje"?"hoje":z.dias_para_prazo===1?"amanhã":fmtD(parseD(z.prazo));
  return el("div",{class:"card"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{},titulo),el("span",{class:"note"},`${lista.length}`)),
    lista.length?el("div",{class:"list"},lista.slice(0,12).map(z=>el("button",{class:"row",onclick:()=>abrir(z)},
      el("div",{style:"display:flex;gap:10px;align-items:flex-start;min-width:0"},el("i",{style:`width:9px;height:9px;border-radius:50%;flex:none;margin-top:7px;background:${sem(z.faixa)}`}),
        el("div",{style:"min-width:0"},el("div",{class:"n"},z.descricao,z.prazo_fatal?el("span",{class:"pill e3",style:"margin-left:8px"},"fatal"):null),el("div",{class:"s"},[z.cliente_nome,z.responsavel_nome,z.origem==="processo"?"processo":z.origem==="negociacao"?"negociação":null].filter(Boolean).join(" · ")))),
      el("span",{class:"note num",style:"white-space:nowrap"},quando(z))))):el("div",{class:"empty"},vazio),
    lista.length>12?el("div",{class:"tbl-foot"},`+ ${lista.length-12} — ver em Tarefas e prazos`):null);
}
/* ---------- mini calendário do mês (prazos + compromissos) ---------- */
const isoD=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addDia=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const hojeD=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())};
async function carregarAgendaMes(ini,fim){
  const chave=isoD(ini);if(D.cal.chave===chave||D.cal.carregando)return;D.cal.carregando=true;
  try{const {data,error}=await SB.from("v_agenda").select("id,titulo,inicio,fim,dia_inteiro,colaborador_id,colaborador_nome,cliente_nome,tipo,origem,tarefa_id,lead_id,link").gte("inicio",ini.toISOString()).lt("inicio",fim.toISOString()).eq("cancelado",false).order("inicio");
    if(error)throw error;D.cal.agenda=data||[];D.cal.chave=chave}
  catch(e){console.warn("painel agenda",e)}finally{D.cal.carregando=false}
  if(S.tab==="painel")render();
}
/* itens (prazos + compromissos) por dia — base do "O que fazer" e do calendário */
function itensPorDia(prazos,meu){
  const hoje=isoD(hojeD());const comEvento=new Set(D.cal.agenda.filter(e=>e.tarefa_id).map(e=>e.tarefa_id));
  const evs=D.cal.agenda.filter(e=>D.escopo==="equipe"?true:(!meu||e.colaborador_id===meu.id||!e.colaborador_id));
  const porDia={};const add=(k,item)=>{(porDia[k]=porDia[k]||[]).push(item)};
  prazos.filter(z=>z.prazo&&!(z.origem==="tarefa"&&comEvento.has(z.id))).forEach(z=>add(z.prazo,{k:"prazo",z,titulo:z.descricao,sub:[z.cliente_nome,z.responsavel_nome].filter(Boolean).join(" · "),atrasada:z.faixa==="atrasada",fatal:z.prazo_fatal,dia:z.prazo}));
  evs.forEach(e=>{const s0=new Date(e.inicio);add(isoD(s0),{k:"evento",e,titulo:e.titulo,hora:e.dia_inteiro?null:String(s0.getHours()).padStart(2,"0")+":"+String(s0.getMinutes()).padStart(2,"0"),sub:[e.colaborador_nome,e.cliente_nome].filter(Boolean).join(" · "),atrasada:e.tipo==="prazo"&&isoD(s0)<hoje,fatal:e.tipo==="prazo",dia:isoD(s0)})});
  return porDia;
}
function abrirItemDia(i){if(i.k==="prazo"){const z=i.z;if(z.origem==="tarefa"){window.PP_TAREFAS?.abrir(z.id);return}if(z.cliente_id){try{history.pushState(null,"","#clientes/"+encodeURIComponent(z.cliente_id)+"/"+(z.origem==="processo"?"processos":"negociacoes"))}catch(_){}if(aplicarHash())render()}return}
  const e=i.e;if(e.origem==="tarefa"&&e.tarefa_id){window.PP_TAREFAS?.abrir(e.tarefa_id);return}if(e.lead_id){location.hash="#leads/"+e.lead_id;return}window.PP_AGENDA?.ir(new Date(e.inicio),"dia")}
const linhaItem=(i,{comDia=false}={})=>el("button",{class:"row",onclick:()=>abrirItemDia(i)},
  el("div",{style:"display:flex;gap:10px;align-items:flex-start;min-width:0"},el("i",{style:`width:9px;height:9px;border-radius:50%;flex:none;margin-top:7px;background:${i.atrasada||i.fatal?"var(--crit)":i.k==="evento"?"var(--info)":"var(--warn)"}`}),
    el("div",{style:"min-width:0"},el("div",{class:"n"},i.hora?el("b",{},i.hora+" "):null,i.titulo,i.fatal?el("span",{class:"pill e3",style:"margin-left:8px"},"fatal"):null,i.atrasada?el("span",{class:"pill e3",style:"margin-left:8px"},"atrasado"):null),i.sub?el("div",{class:"s"},i.sub):null)),
  comDia?el("span",{class:"note num",style:"white-space:nowrap"},i.dia.slice(8,10)+"/"+i.dia.slice(5,7)):null);
/* "O que fazer": hoje (com atrasados), ‹ › dia a dia, e visão da semana e do mês */
function cardFazer(prazos,meu){
  const hoje=isoD(hojeD());if(!D.foco.dia)D.foco.dia=hoje;const f=D.foco;const dsel=parseD(f.dia);
  // o calendário/agenda carregada acompanha o mês em foco
  if(!D.cal.ref||D.cal.ref.getMonth()!==dsel.getMonth()||D.cal.ref.getFullYear()!==dsel.getFullYear()){D.cal.ref=new Date(dsel.getFullYear(),dsel.getMonth(),1);D.cal.chave=null}
  const porDia=itensPorDia(prazos,meu);const ord=l=>[...l].sort((a,b)=>(a.atrasada?0:1)-(b.atrasada?0:1)||((a.hora||"99")<(b.hora||"99")?-1:1));
  const seg=(()=>{const x=new Date(dsel);x.setDate(x.getDate()-((x.getDay()+6)%7));return x})();
  const semDias=[...Array(7)].map((_,i)=>isoD(addDia(seg,i)));const mesK=f.dia.slice(0,7);
  const atrasados=Object.entries(porDia).filter(([k])=>k<hoje).flatMap(([,l])=>l.filter(i=>i.atrasada));
  const passo=f.modo==="dia"?1:f.modo==="semana"?7:0;
  const mover=n=>{const d=parseD(f.dia);if(f.modo==="mes")d.setMonth(d.getMonth()+n);else d.setDate(d.getDate()+n*passo);f.dia=isoD(d);render()};
  const tituloFoco=f.modo==="dia"?(f.dia===hoje?"Hoje":f.dia===isoD(addDia(hojeD(),1))?"Amanhã":f.dia===isoD(addDia(hojeD(),-1))?"Ontem":dsel.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}).replace(/^./,c=>c.toUpperCase()))
    :f.modo==="semana"?`Semana de ${seg.getDate()}/${String(seg.getMonth()+1).padStart(2,"0")} a ${addDia(seg,6).getDate()}/${String(addDia(seg,6).getMonth()+1).padStart(2,"0")}`
    :dsel.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase());
  const sub=f.modo==="dia"&&f.dia===hoje?dsel.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}):"";
  const modos=el("div",{class:"tabs",style:"font-size:12px"},[["dia","Dia"],["semana","Semana"],["mes","Mês"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(f.modo===k),onclick:()=>{f.modo=k;render()}},l)));
  const nav=el("div",{style:"display:flex;align-items:center;gap:4px"},el("button",{class:"btn sm",title:"Anterior",onclick:()=>mover(-1)},"‹"),el("button",{class:"btn sm",onclick:()=>{f.dia=hoje;render()}},"Hoje"),el("button",{class:"btn sm",title:"Próximo",onclick:()=>mover(1)},"›"));
  const card=el("div",{class:"card"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:8px"},el("div",{},el("h2",{},tituloFoco),sub?el("div",{class:"note"},sub):null),el("div",{class:"actions",style:"gap:8px"},modos,nav)));
  const bloco=(titulo,lista,vazio,opts)=>{const b=el("div",{});b.append(el("div",{class:"eyebrow",style:"padding:10px 18px 0"},titulo+(lista.length?" · "+lista.length:"")));b.append(lista.length?el("div",{class:"list"},lista.map(i=>linhaItem(i,opts))):el("div",{class:"empty",style:"padding:10px 18px"},vazio));return b};
  if(f.modo==="dia"){
    if(f.dia===hoje&&atrasados.length)card.append(bloco("Atrasados — resolver primeiro",ord(atrasados),"",{comDia:true}));
    card.append(bloco(f.dia===hoje?"Para hoje":"Neste dia",ord(porDia[f.dia]||[]),f.dia===hoje?"Nada vence hoje. Bom momento para adiantar a semana.":"Nada neste dia."));
    const prox=[1,2,3].map(n=>isoD(addDia(dsel,n))).flatMap(k=>porDia[k]||[]);
    if(f.dia===hoje&&prox.length)card.append(bloco("Próximos 3 dias",ord(prox),"",{comDia:true}));
  }else if(f.modo==="semana"){
    if(semDias.includes(hoje)&&atrasados.length)card.append(bloco("Atrasados",ord(atrasados),"",{comDia:true}));
    semDias.forEach(k=>{const l=porDia[k]||[];const d=parseD(k);const lbl=d.toLocaleDateString("pt-BR",{weekday:"short",day:"numeric"}).replace(".","")+(k===hoje?" · hoje":"");if(l.length||k===hoje)card.append(bloco(lbl,ord(l),"Nada."))});
    const tot=semDias.flatMap(k=>porDia[k]||[]).length;if(!tot)card.append(el("div",{class:"empty"},"Nada nesta semana."));
  }else{
    const dias=Object.keys(porDia).filter(k=>k.slice(0,7)===mesK).sort();const tot=dias.flatMap(k=>porDia[k]).length;
    card.append(el("div",{class:"note",style:"padding:10px 18px 0"},`${tot} item(ns) no mês · ${dias.length} dia(s) com algo marcado`));
    dias.forEach(k=>{const d=parseD(k);card.append(bloco(d.toLocaleDateString("pt-BR",{weekday:"short",day:"numeric"}).replace(".","")+(k===hoje?" · hoje":""),ord(porDia[k]),"",))});
    if(!tot)card.append(el("div",{class:"empty"},"Nada marcado neste mês."));
  }
  return card;
}
function cardCalendario(prazos,meu){
  if(!D.cal.ref){const h=hojeD();D.cal.ref=new Date(h.getFullYear(),h.getMonth(),1)}
  const ref=D.cal.ref,hoje=isoD(hojeD());
  const ini=(()=>{const x=new Date(ref);const dow=(x.getDay()+6)%7;x.setDate(x.getDate()-dow);return x})(),fim=addDia(ini,42);
  carregarAgendaMes(ini,fim);
  const comEvento=new Set(D.cal.agenda.filter(e=>e.tarefa_id).map(e=>e.tarefa_id));
  const evs=D.cal.agenda.filter(e=>D.escopo==="equipe"?true:(!meu||e.colaborador_id===meu.id||!e.colaborador_id));
  const porDia={};const add=(k,item)=>{(porDia[k]=porDia[k]||[]).push(item)};
  prazos.filter(z=>z.prazo&&!(z.origem==="tarefa"&&comEvento.has(z.id))).forEach(z=>add(z.prazo,{k:"prazo",z,titulo:z.descricao,sub:[z.cliente_nome,z.responsavel_nome].filter(Boolean).join(" · "),atrasada:z.faixa==="atrasada",fatal:z.prazo_fatal}));
  evs.forEach(e=>{const s=new Date(e.inicio);add(isoD(s),{k:"evento",e,titulo:e.titulo,hora:e.dia_inteiro?null:String(s.getHours()).padStart(2,"0")+":"+String(s.getMinutes()).padStart(2,"0"),sub:[e.colaborador_nome,e.cliente_nome].filter(Boolean).join(" · "),atrasada:e.tipo==="prazo"&&isoD(s)<hoje,fatal:e.tipo==="prazo"})});
  const nav=el("div",{style:"display:flex;align-items:center;gap:4px"},el("button",{class:"btn sm",onclick:()=>{D.cal.ref=new Date(ref.getFullYear(),ref.getMonth()-1,1);D.cal.dia=null;render()}},"‹"),el("button",{class:"btn sm",onclick:()=>{const h=hojeD();D.cal.ref=new Date(h.getFullYear(),h.getMonth(),1);D.cal.dia=hoje;render()}},"Hoje"),el("button",{class:"btn sm",onclick:()=>{D.cal.ref=new Date(ref.getFullYear(),ref.getMonth()+1,1);D.cal.dia=null;render()}},"›"));
  const g=el("div",{class:"mc-grade"});["S","T","Q","Q","S","S","D"].forEach(d=>g.append(el("div",{class:"mc-h"},d)));
  for(let d=new Date(ini);d<fim;d=addDia(d,1)){const k=isoD(d),lista=porDia[k]||[];const crit=lista.some(i=>i.atrasada||i.fatal),prazo=lista.some(i=>i.k==="prazo"||i.e?.tipo==="prazo");
    const cel=el("button",{class:"mc-d"+(d.getMonth()!==ref.getMonth()?" fora":"")+(k===hoje?" hoje":"")+(D.cal.dia===k?" sel":""),onclick:()=>{D.cal.dia=D.cal.dia===k?null:k;D.foco.dia=k;D.foco.modo="dia";render()},title:lista.length?lista.length+" item(ns)":""},
      el("span",{class:"mc-n"},String(d.getDate())),lista.length?el("span",{class:"mc-b "+(crit?"crit":prazo?"warn":"info")},String(lista.length)):null);g.append(cel)}
  const noMes=Object.entries(porDia).filter(([k])=>k.slice(0,7)===isoD(ref).slice(0,7)).flatMap(([,l])=>l);
  const seg=(()=>{const h=hojeD();const x=new Date(h);x.setDate(x.getDate()-((x.getDay()+6)%7));return x})(),semIni=isoD(seg),semFim=isoD(addDia(seg,7));
  const semana=Object.entries(porDia).filter(([k])=>k>=semIni&&k<semFim).flatMap(([,l])=>l);
  const resumo=el("div",{class:"note",style:"margin-top:6px"},`Esta semana: ${semana.length} item(ns)${semana.filter(i=>i.atrasada).length?" · "+semana.filter(i=>i.atrasada).length+" atrasado(s)":""} · No mês: ${noMes.length}`);
  const abrirItem=i=>{if(i.k==="prazo"){const z=i.z;if(z.origem==="tarefa"){window.PP_TAREFAS?.abrir(z.id);return}if(z.cliente_id){try{history.pushState(null,"","#clientes/"+encodeURIComponent(z.cliente_id)+"/"+(z.origem==="processo"?"processos":"negociacoes"))}catch(_){}if(aplicarHash())render()}return}
    const e=i.e;if(e.origem==="tarefa"&&e.tarefa_id){window.PP_TAREFAS?.abrir(e.tarefa_id);return}if(e.lead_id){location.hash="#leads/"+e.lead_id;return}window.PP_AGENDA?.ir(new Date(e.inicio),"dia")};
  let detalhe=null;
  if(D.cal.dia){const lista=(porDia[D.cal.dia]||[]).sort((a,b)=>(a.hora||"")<(b.hora||"")?-1:1);const d=parseD(D.cal.dia);
    detalhe=el("div",{style:"margin-top:8px;border-top:1px solid var(--line);padding-top:8px"},el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:8px"},el("b",{style:"font-size:13px"},d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})),el("button",{class:"btn sm",onclick:()=>window.PP_AGENDA?.ir(d,"dia")},"Abrir o dia")),
      lista.length?el("div",{class:"list",style:"margin-top:4px"},lista.map(i=>el("button",{class:"row",style:"padding:6px 4px",onclick:()=>abrirItem(i)},el("div",{style:"min-width:0"},el("div",{class:"n",style:"font-size:13px"},i.hora?el("b",{},i.hora+" "):null,i.titulo,i.fatal?el("span",{class:"pill e3",style:"margin-left:6px"},"fatal"):null,i.atrasada?el("span",{class:"pill e3",style:"margin-left:6px"},"atrasado"):null),i.sub?el("div",{class:"s"},i.sub):null)))):el("div",{class:"note",style:"margin-top:4px"},"Nada neste dia."))}
  return el("section",{class:"card section mc"},el("div",{class:"section-h"},el("div",{},el("h2",{},ref.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase())),el("div",{class:"note"},D.escopo==="equipe"?"prazos e compromissos da equipe":"seus prazos e compromissos")),el("div",{class:"actions"},nav,el("button",{class:"btn sm",onclick:()=>window.PP_AGENDA?.ir(ref,"mes")},"Agenda completa"))),g,resumo,detalhe);
}
document.head.append(el("style",{},`.mc-grade{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-top:8px}.mc-h{text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:2px 0}
.mc-d{position:relative;border:0;background:none;font:inherit;color:var(--fg);height:40px;border-radius:8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}.mc-d:hover{background:var(--surface-2)}.mc-d.fora{opacity:.35}.mc-d.sel{background:var(--surface-2);box-shadow:inset 0 0 0 1.5px var(--line)}
.mc-n{font-size:12.5px;line-height:1}.mc-d.hoje .mc-n{background:var(--btn-primary);color:#fff;border-radius:999px;width:22px;line-height:22px;text-align:center}
.mc-b{font-size:9.5px;line-height:14px;min-width:14px;padding:0 4px;border-radius:999px;color:#fff;background:var(--info)}.mc-b.warn{background:var(--warn)}.mc-b.crit{background:var(--crit)}`));
/* ---------- "Agora": cronômetro rodando, publicações pendentes, faturamento em análise, horas da semana (beta) ---------- */
const AG={ok:false,cron:null,pub:null,sf:null,horas:null,t:null};
async function carregarAgora(meu){
  if(AG.ok)return;AG.ok=true;
  const temJur=PP.temAcesso?.("processos")??true,temFin=PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("financeiro");
  const d=new Date();const dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);const ini=d.toISOString().slice(0,10);
  const [c,p,f,h]=await Promise.all([
    meu?SB.from("ts_cronometros").select("*").eq("colaborador_id",meu.id).maybeSingle():{data:null},
    temJur?SB.from("v_publicacoes").select("id,dias_para_tratar",{count:"exact"}).is("providencia",null).eq("ignorada",false).limit(500):{data:null,count:null},
    temFin?SB.from("solicitacoes_faturamento").select("id,valor_total").eq("status","em_analise"):{data:null},
    meu?SB.from("apontamentos_horas").select("horas").eq("colaborador_id",meu.id).gte("data",ini):{data:null}]);
  AG.cron=c.data||null;AG.pub=p.count==null?null:{total:p.count,vencidas:(p.data||[]).filter(x=>x.dias_para_tratar!=null&&x.dias_para_tratar<0).length};
  AG.sf=f.data?{n:f.data.length,valor:f.data.reduce((s,x)=>s+(+x.valor_total||0),0)}:null;AG.horas=h.data?h.data.reduce((s,x)=>s+(+x.horas||0),0):null;
  render();
}
function cardsAgora(meu){
  if(!AG.ok)carregarAgora(meu);
  const irTab=t=>()=>{S.tab=t;try{localStorage.setItem("pp-tab",t)}catch(_){}render()};
  const K=(l,val,h,cls,onclick)=>el("button",{class:"card kpi",style:"text-align:left;cursor:pointer;border-color:var(--line)",onclick},el("div",{class:"l"},l),el("div",{class:"v",style:cls?`color:var(--${cls})`:""},val),el("div",{class:"h"},h));
  const out=[];
  if(AG.cron){const t=D.tarefas.find(x=>x.id===AG.cron.tarefa_id);const rel=el("span",{style:"font-variant-numeric:tabular-nums"},"00:00:00");
    const tick=()=>{const s0=Math.max(0,Math.floor((Date.now()-new Date(AG.cron.inicio).getTime())/1000));rel.textContent=`${String(Math.floor(s0/3600)).padStart(2,"0")}:${String(Math.floor(s0%3600/60)).padStart(2,"0")}:${String(s0%60).padStart(2,"0")}`};tick();clearInterval(AG.t);AG.t=setInterval(tick,1000);
    const card=el("div",{class:"card kpi",style:"border-color:var(--gold);cursor:pointer",onclick:()=>{if(t)window.PP_TAREFAS?.abrir(t.id)}},el("div",{class:"l"},el("span",{class:"pill e2",style:"font-size:10px;margin-right:6px"},"● trabalhando"),"Agora"),el("div",{class:"v"},rel),
      el("div",{class:"h",style:"white-space:nowrap;overflow:hidden;text-overflow:ellipsis",title:t?t.titulo:(AG.cron.descricao||"")},(t?t.titulo:(AG.cron.descricao||"atividade"))+((S.clientes||[]).find(c=>c.id===AG.cron.cliente_id)?.nome?" · "+(S.clientes||[]).find(c=>c.id===AG.cron.cliente_id).nome:"")),
      el("div",{style:"display:flex;gap:6px;margin-top:6px"},t?el("button",{class:"btn sm primary",onclick:e=>{e.stopPropagation();window.PP_TAREFAS?.abrir(t.id)}},"Abrir"):null,el("button",{class:"btn sm",onclick:async e=>{e.stopPropagation();try{await window.PP_TS?.pararDireto({});toast("Tempo gravado");AG.ok=false;render()}catch(err){toast(err.message)}}},"⏸ Pausar")));
    out.push(card)}
  return out;
}
function renderPainel(){
  const v=$("#view-painel");v.replaceChildren();
  const nome=(PP.perfil?.nome||"").split(" ").slice(0,2).join(" ");
  const h=new Date().getHours(),sauda=h<12?"Bom dia":h<18?"Boa tarde":"Boa noite";
  const esc=PP.escopoTarefas?.()||{tudo:true};if(!esc.tudo&&!esc.nucleos)D.escopo="minhas";
  const escopo=(esc.tudo||esc.nucleos)?el("div",{class:"tabs"},[["minhas","Minhas"],["equipe",esc.tudo?"Equipe":"Jurídico"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(D.escopo===k),onclick:()=>{D.escopo=k;try{localStorage.setItem("pp-painel-escopo",k)}catch(_){}render()}},l))):null;
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})),el("h1",{},`${sauda}${nome?", "+nome:""}`),el("div",{class:"sub"},"O que precisa da sua atenção hoje.")),
    el("div",{class:"actions"},escopo,el("button",{class:"btn",title:"Envia agora, no seu Discord/WhatsApp (conforme a sua ficha), o mesmo resumo que chega às 8h",onclick:enviarResumo},"Receber resumo agora"),el("button",{class:"btn primary",onclick:()=>window.PP_TAREFAS?.nova?.()},"+ Tarefa"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const meu=meuColab();
  const minhas=z=>D.escopo==="equipe"?(esc.tudo||(esc.nucleos||[]).includes(z.nucleo)||(meu&&z.responsavel_id===meu.id)):(!meu||z.responsavel_id===meu.id);
  const prazos=D.prazos.filter(minhas);
  const atrasadas=prazos.filter(z=>z.faixa==="atrasada"),hoje=prazos.filter(z=>z.faixa==="hoje"),d7=prazos.filter(z=>z.faixa==="d7"),fatais=prazos.filter(z=>z.prazo_fatal&&["atrasada","hoje","d7"].includes(z.faixa));
  const tarefas=D.tarefas.filter(minhas);
  const ativos=(S.contratos||[]).filter(k=>k.situacao!=="quitado"),saldo=ativos.reduce((s,k)=>s+(+k.saldoAtual||+k.valorOriginal||0),0);
  const leadsAtras=D.leads?D.leads.filter(l=>l.atraso==="estourado"||l.tarefas_vencidas>0).length:null;
  const K=(l,val,h,cls,onclick)=>el("button",{class:"card kpi",style:"text-align:left;cursor:pointer;border-color:var(--line)",onclick},el("div",{class:"l"},l),el("div",{class:"v",style:cls?`color:var(--${cls})`:""},String(val)),el("div",{class:"h"},h));
  const irTab=t=>()=>{S.tab=t;try{localStorage.setItem("pp-tab",t)}catch(_){}render()};
  v.append(el("div",{class:"kpis"},
    K("Tarefas abertas",tarefas.length,D.escopo==="equipe"?(esc.tudo?"de toda a equipe":"do jurídico"):"atribuídas a você","",irTab("tarefas")),
    K("Atrasadas",atrasadas.length,"prazo já passou",atrasadas.length?"crit":"",irTab("tarefas")),
    K("Fatais em 7 dias",fatais.length,"inclui atrasados",fatais.length?"crit":"",irTab("tarefas")),...cardsAgora(meu)));
  // Carteira e Leads atrasados ficam nas próprias áreas (Clientes e Comercial) — pedido de 31/10
  const duas=el("div",{style:"display:grid;grid-template-columns:1.5fr 1fr;gap:18px"});
  /* Tickets aguardando a(s) minha(s) área(s) */
  if(false&&D.tickets?.length){const AR={juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",atendimento:"Atendimento",administrativo:"Administrativo",socios:"Sócias"};const p=PP.perfil||{};const minhas=p.papel==="admin"?Object.keys(AR):[...(p.acessos||[]),...((p.acessos||[]).includes("equipe")?["administrativo"]:[])];
    const meus=D.tickets.filter(x=>minhas.includes(x.aguardando_area));
    if(meus.length)duas.append(el("div",{class:"card",style:"grid-column:1 / -1;border-color:var(--gold)"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{},"Tickets aguardando a sua área"),el("span",{class:"note"},`${meus.length} · responda pela tarefa`)),
      el("div",{class:"list"},meus.sort((a,b)=>b.dias_aguardando-a.dias_aguardando).map(x=>{const d=Math.floor(+x.dias_aguardando||0);return el("button",{class:"row",onclick:()=>window.PP_TAREFAS?.abrir(x.id)},
        el("div",{style:"min-width:0"},el("div",{class:"n"},el("span",{class:"pill "+(d>=5?"e3":d>=2?"e2":"c"),style:"margin-right:8px"},AR[x.aguardando_area]||x.aguardando_area),x.titulo),el("div",{class:"s"},[x.aguardando_por_nome?"pedido de "+x.aguardando_por_nome:null,x.cliente_nome].filter(Boolean).join(" · ")+(x.aguardando_motivo?" — "+x.aguardando_motivo.slice(0,140):""))),
        el("span",{class:"note num",style:"white-space:nowrap"},d?`há ${d}d`:"hoje"))}))));}
  /* Prazos fatais de hoje: regra da controladoria — protocolo até meio-dia e confirmação do protocolo */
  const fataisHoje=D.tarefas.filter(minhas).filter(z=>z.prazo_fatal&&z.faixa==="hoje");
  if(fataisHoje.length){const tarde=new Date().getHours()>=12;
    duas.append(el("div",{class:"card",style:"grid-column:1 / -1;border-color:var(--crit)"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{style:"color:var(--crit)"},"Prazos fatais de hoje"),el("span",{class:"note"},tarde?"já passou do meio-dia — protocolar e confirmar agora":"protocolar até meio-dia")),
      el("div",{class:"list"},fataisHoje.map(z=>el("div",{class:"row",style:"display:flex;gap:10px;align-items:center;justify-content:space-between"},
        el("button",{class:"row",style:"flex:1;text-align:left;padding:0;border:0;background:none",onclick:()=>window.PP_TAREFAS?.abrir(z.id)},el("div",{class:"n"},z.titulo),el("div",{class:"s"},[z.cliente_nome,z.responsavel_nome].filter(Boolean).join(" · "))),
        el("button",{class:"btn sm primary",style:"flex:none",onclick:()=>window.PP_TAREFAS?.concluirComNota?.(z)},"Confirmar protocolo"))))));}
  duas.append(cardFazer(prazos,meu));
  const col=el("div",{style:"display:flex;flex-direction:column;gap:18px"});
  col.append(cardCalendario(prazos,meu));
  const SETORES={"":"Todos",juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",administrativo:"Administrativo"};const SETOR_DE={juridico:"juridico",acordos:"juridico",acompanhamento_pj:"juridico",comercial:"comercial",marketing:"marketing",administrativo:"administrativo",pos_vendas:"comercial",rh:"administrativo",socios:"administrativo"};
  const escAtv=PP.escopoTarefas?.()||{tudo:true};D.atvSetor=D.atvSetor??(()=>{try{return localStorage.getItem("pp-painel-atv")||""}catch(_){return ""}})();
  const atvOk=e=>{const t=D.tarefas.find(x=>x.id===e.tarefa_id);if(escAtv.tudo)return !D.atvSetor||(t&&SETOR_DE[t.nucleo]===D.atvSetor);if(!t)return false;const minha=(meu&&t.responsavel_id===meu.id)||t.created_by===PP.perfil?.id||e.autor===PP.perfil?.id;return minha||(escAtv.nucleos||[]).includes(t.nucleo)};
  const eventosVis=D.eventos.filter(atvOk).slice(0,12);
  const setorTabs=escAtv.tudo?el("div",{class:"tabs",style:"font-size:12px"},Object.entries(SETORES).map(([k,l])=>el("button",{class:"tab","aria-selected":String(D.atvSetor===k),onclick:()=>{D.atvSetor=k;try{localStorage.setItem("pp-painel-atv",k)}catch(_){}render()}},l))):null;
  col.append(el("div",{class:"card"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:8px"},el("h2",{},"Atividade recente"),setorTabs||el("span",{class:"note"},escAtv.nucleos?"suas e do jurídico":"só as suas")),
    eventosVis.length?el("ul",{class:"tl",style:"margin:14px 18px 14px 24px"},eventosVis.map(e=>{const t=D.tarefas.find(x=>x.id===e.tarefa_id);return el("li",{},el("div",{class:"d"},fmtDT(e.criado_em)),el("div",{style:"font-size:13.5px"},el("b",{},e.autor_nome||"Alguém")," ",EVENTO[e.tipo]||e.tipo," ",e.tipo==="prazo_alterado"?`${e.de||"—"} para ${e.para||"—"}`:e.tipo==="reatribuida"?`de ${e.de||"—"} para ${e.para||"—"}`:"",t?el("button",{class:"btn sm",style:"margin-left:6px",onclick:()=>window.PP_TAREFAS?.abrir(t.id)},t.titulo.slice(0,40)):"",e.nota?el("div",{class:"note",style:"margin-top:2px"},"“"+e.nota.slice(0,120)+"”"):null))})):el("div",{class:"empty"},"Sem movimentação ainda.")));
  duas.append(col);
  const st=document.createElement("style");st.textContent="@media(max-width:1000px){#view-painel .duas{grid-template-columns:1fr!important}}";duas.classList.add("duas");v.append(st,duas);
}
async function enviarResumo(){
  try{const {data:{session}}=await SB.auth.getSession();if(!session)throw new Error("Faça login de novo");toast("Enviando…");
    const r=await fetch(SB_URL+"/functions/v1/chatguru/enviar",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify({acao:"resumo"})});
    const j=await r.json().catch(()=>({ok:false,erro:"Resposta inválida"}));if(!r.ok||j.ok===false)throw new Error(j.erro||("HTTP "+r.status));toast("Resumo enviado por "+(j.canais||[]).join(" e ")+(j.avisos?.length?" · "+j.avisos.join(" · "):""))}
  catch(e){toast("Não foi possível enviar: "+e.message)}
}
let rt=null;
function tempoReal(){const ch=SB.channel("painel-tarefas");ch.on("postgres_changes",{event:"*",schema:"public",table:"tarefas"},()=>{clearTimeout(rt);rt=setTimeout(()=>{D.ok=false;if(S.tab==="painel")garantir()},500)});ch.on("postgres_changes",{event:"*",schema:"public",table:"ts_cronometros"},()=>{AG.ok=false;if(S.tab==="painel")render()});ch.subscribe()}

/* ============================================================================================================
   V3.1 (Design System, Fase 4A) — Hoje: mesma leitura (v_prazos, v_tarefas, v_agenda, tarefa_eventos), outra apresentação.
   Ativa só com a casca V3.1 (html.np-casca-v3) e np-ui. Nenhuma escrita nova: as ações continuam as da V2
   (PP_TAREFAS.abrir/nova/concluirComNota, PP_TS.pararDireto, enviarResumo). Sem cartões: grupos com régua, painel de detalhe para
   compromissos, resumo no topo. O que fazer hoje é a primeira coisa; a atividade recente fica por último, recolhida.
   ============================================================================================================ */
const ctxV3=a=>a.filter(Boolean).flatMap((x,i)=>i?[" · ",x]:[x]);
const hojeV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const H3={obra:null,painel:null,aberta:null,atv:false};
const fmtHoraV3=iso=>{const d=new Date(iso);return String(d.getHours()).padStart(2,"0")+"h"+String(d.getMinutes()).padStart(2,"0")};
/* um item (prazo ou compromisso) vira uma linha np-ui */
function linhaHojeV3(i,{comDia=true}={}){
  const hoje=isoD(hojeD());
  if(i.k==="prazo"){const z=i.z;const p=NPUI.prazoTxt(z.prazo);if(!comDia){p.curta=p.rel==="hoje"?"hoje":p.curta;p.rel=""}
    const regua=z.prazo_fatal&&["atrasada","hoje","d7"].includes(z.faixa)?"fatal":z.faixa==="atrasada"?"late":z.faixa==="hoje"?"att":null;
    const dir=[z.prazo_fatal?NPUI.marca("fatal","crit"):null,z.origem==="processo"?NPUI.marca("processo"):z.origem==="negociacao"?NPUI.marca("negociação"):null,NPUI.quem(z.responsavel_nome)];
    return NPUI.linha({id:"prazo:"+z.origem+":"+z.id,regua,prazo:{...p,tom:regua==="fatal"||regua==="late"?"crit":regua==="att"?"att":""},titulo:z.descricao,contexto:ctxV3([z.cliente_nome]),direita:dir,onOpen:()=>abrirItemDia(i),titleAbrir:z.origem==="tarefa"?"Abrir a tarefa":"Abrir no cliente"})}
  const e=i.e;const d0=new Date(e.inicio);const p=NPUI.prazoTxt(isoD(d0),e.dia_inteiro?null:String(d0.getHours()).padStart(2,"0")+":"+String(d0.getMinutes()).padStart(2,"0"));if(!comDia){p.curta=e.dia_inteiro?"dia inteiro":p.hora||"—";p.hora="";p.rel=""}
  const regua=i.atrasada?"late":e.tipo==="prazo"?"att":null;
  const TIPO={compromisso:"compromisso",audiencia:"audiência",reuniao:"reunião",pericia:"perícia",prazo:"prazo",outro:""};
  const dir=[TIPO[e.tipo]?NPUI.marca(TIPO[e.tipo],e.tipo==="audiencia"?"crit":""):null,e.origem==="google"?NPUI.marca("Google"):null,NPUI.quem(e.colaborador_nome)];
  return NPUI.linha({id:"evento:"+e.id,regua,prazo:{...p,tom:regua==="late"?"crit":regua==="att"?"att":""},titulo:e.titulo,contexto:ctxV3([e.cliente_nome,e.local]),direita:dir,onOpen:li=>abrirPainelHojeV3(i,li),titleAbrir:"Ver o compromisso",atual:H3.aberta==="evento:"+e.id});
}
/* painel de detalhe de um compromisso (só leitura aqui; editar continua pela Agenda) */
function abrirPainelHojeV3(i,li){
  if(!H3.painel)return;const e=i.e;H3.aberta="evento:"+e.id;
  const ini=new Date(e.inicio),fim=new Date(e.fim);const TIPO={compromisso:"Compromisso",audiencia:"Audiência",reuniao:"Reunião",pericia:"Perícia",prazo:"Prazo",outro:"Outro"};
  const quando=e.dia_inteiro?ini.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"}):`${ini.toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit"})} ${fmtHoraV3(e.inicio)}–${fmtHoraV3(e.fim)}`;
  const props=NPUI.props([["Quando",quando],["Tipo",TIPO[e.tipo]||e.tipo||"—"],["Responsável",e.colaborador_nome||"—"],e.cliente_nome?["Cliente",e.cliente_nome]:null,e.local?["Local",e.local]:null,["Origem",e.origem==="google"?"Google Calendar":e.origem==="tarefa"?"tarefa com horário":e.origem==="lead"?"CRM (lead)":"painel"]]);
  const desc=e.descricao?NPUI.secao("Observações",el("p",{class:"np-txt"},String(e.descricao).slice(0,1500))):null;
  const pe=[NPUI.btn("Abrir na agenda",{variante:"pri",onclick:()=>window.PP_AGENDA?.ir(new Date(e.inicio),"dia")}),e.origem==="tarefa"&&e.tarefa_id?NPUI.btn("Abrir a tarefa",{onclick:()=>window.PP_TAREFAS?.abrir(e.tarefa_id)}):null,e.lead_id?NPUI.btn("Abrir o lead",{onclick:()=>{location.hash="#leads/"+e.lead_id}}):null,e.link&&e.origem==="google"?el("a",{class:"np-btn",href:e.link,target:"_blank",rel:"noopener"},"Abrir no Google"):null];
  H3.painel.abrir({id:H3.aberta,trilha:[el("span",{},"Hoje"),el("span",{},"Compromisso")],titulo:e.titulo,corpo:[props,desc],pe,origem:li?.querySelector(".np-it-abrir")||li});
}
function grupoHojeV3(id,titulo,lista,{tom,aberto=true,vazio,comDia=true}={}){
  if(!lista.length&&!vazio)return null;
  const itens=lista.length?lista.map(i=>linhaHojeV3(i,{comDia})):[el("li",{class:"np-it np-it-vazia"},el("span",{class:"np-it-chk np-it-chk-vazio","aria-hidden":"true"}),el("span",{class:"np-it-prazo"}),el("span",{class:"np-it-abrir np-sem"},vazio))];
  return NPUI.grupo({id,titulo,n:lista.length,tom,aberto:NPUI.pref.get("np-hoje-g-"+id,aberto?"1":"0")==="1",onToggle:ab=>NPUI.pref.set("np-hoje-g-"+id,ab?"1":"0"),itens});
}
function renderPainelV3(){
  const v=$("#view-painel");v.replaceChildren();v.classList.add("np-v3");H3.obra=null;H3.painel=null;
  const nome=(PP.perfil?.nome||"").split(" ").slice(0,2).join(" ");const h=new Date().getHours(),sauda=h<12?"Bom dia":h<18?"Boa tarde":"Boa noite";
  const esc=PP.escopoTarefas?.()||{tudo:true};if(!esc.tudo&&!esc.nucleos)D.escopo="minhas";
  if(!garantir()){v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  const meu=meuColab();const hoje=isoD(hojeD());
  const minhas=z=>D.escopo==="equipe"?(esc.tudo||(esc.nucleos||[]).includes(z.nucleo)||(meu&&z.responsavel_id===meu.id)):(!meu||z.responsavel_id===meu.id);
  const prazos=D.prazos.filter(minhas);const tarefas=D.tarefas.filter(minhas);
  const atrasadas=prazos.filter(z=>z.faixa==="atrasada"),fatais=prazos.filter(z=>z.prazo_fatal&&["atrasada","hoje","d7"].includes(z.faixa));
  // agenda do mês em foco (mesma consulta da V2: v_agenda do mês), para compromissos de hoje/semana
  if(!D.foco.dia)D.foco.dia=hoje;const dsel=parseD(D.foco.dia);
  if(!D.cal.ref||D.cal.ref.getMonth()!==dsel.getMonth()||D.cal.ref.getFullYear()!==dsel.getFullYear()){D.cal.ref=new Date(dsel.getFullYear(),dsel.getMonth(),1);D.cal.chave=null}
  const ini=(()=>{const x=new Date(D.cal.ref);const dow=(x.getDay()+6)%7;x.setDate(x.getDate()-dow);return x})();carregarAgendaMes(ini,addDia(ini,42));
  const porDia=itensPorDia(prazos,meu);const ord=l=>[...l].sort((a,b)=>(a.atrasada?0:1)-(b.atrasada?0:1)||(a.fatal?0:1)-(b.fatal?0:1)||((a.hora||"99")<(b.hora||"99")?-1:1)||(a.dia<b.dia?-1:1));
  const evHoje=(porDia[hoje]||[]).filter(i=>i.k==="evento").length;
  const resumo=NPUI.resumo([{n:fatais.length,label:"fatais em 7 dias",tom:fatais.length?"crit":"zero"},{n:atrasadas.length,label:"atrasadas",tom:atrasadas.length?"crit":"zero"},{n:(porDia[hoje]||[]).filter(i=>i.k==="prazo").length,label:"vencem hoje",tom:(porDia[hoje]||[]).some(i=>i.k==="prazo")?"att":"zero"},{n:evHoje,label:evHoje===1?"compromisso hoje":"compromissos hoje",tom:evHoje?"":"zero"},{n:tarefas.length,label:"abertas"}]);
  const chips=[];const C=o=>{const c=NPUI.chip(o);chips.push(c);return c};
  if(esc.tudo||esc.nucleos){C({label:"Minhas",on:D.escopo==="minhas",grupo:"escopo",onclick:()=>{D.escopo="minhas";try{localStorage.setItem("pp-painel-escopo","minhas")}catch(_){}render()}});C({label:esc.tudo?"Equipe":"Jurídico",on:D.escopo==="equipe",grupo:"escopo",onclick:()=>{D.escopo="equipe";try{localStorage.setItem("pp-painel-escopo","equipe")}catch(_){}render()}})}
  const f=D.foco;const seg=NPUI.seg([["dia","Hoje"],["semana","Semana"],["mes","Mês"]],f.modo,k=>{f.modo=k;if(k==="dia")f.dia=hoje;NPUI.vt(()=>render())},"Período");
  const mover=n=>{const d=parseD(f.dia);if(f.modo==="mes")d.setMonth(d.getMonth()+n);else d.setDate(d.getDate()+n*(f.modo==="semana"?7:1));f.dia=isoD(d);render()};
  const nav=f.modo==="dia"&&f.dia===hoje?null:el("span",{class:"np-nav-per",role:"group","aria-label":"Navegar no período"},NPUI.ib("chevE","Anterior",()=>mover(-1)),NPUI.btn("Hoje",{variante:"ghost",onclick:()=>{f.dia=hoje;render()}}),NPUI.ib("chevD","Próximo",()=>mover(1)));
  const navSempre=f.modo==="dia"&&f.dia===hoje?el("span",{class:"np-nav-per",role:"group","aria-label":"Navegar no período"},NPUI.ib("chevE","Dia anterior",()=>mover(-1)),NPUI.ib("chevD","Próximo dia",()=>mover(1))):nav;
  const direita=[seg,navSempre,NPUI.ib("sino","Receber resumo agora (Discord/WhatsApp, o mesmo das 8h)",enviarResumo),readOnly()?null:NPUI.btn("Nova tarefa",{variante:"pri",icone:"mais",onclick:()=>window.PP_TAREFAS?.nova?.()})];
  v.append(NPUI.toolbar({resumo,filtros:chips.length?chips:null,direita}));NPUI.reancorarPop();
  const obra=el("div",{class:"np-obra"});H3.obra=obra;const corpo=el("div",{class:"np-corpo"});
  // saudação + data (serifa) — substitui o cabeçalho da V2
  corpo.append(el("div",{class:"np-hoje-h"},el("h1",{},`${sauda}${nome?", "+nome:""}`),el("span",{class:"np-hoje-d"},dsel.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}))));
  // cronômetro rodando (Agora) — mesma leitura e as mesmas ações da V2
  if(!AG.ok)carregarAgora(meu);
  if(AG.cron){const t=D.tarefas.find(x=>x.id===AG.cron.tarefa_id);const rel=el("b",{class:"np-cron"},"00:00:00");const tick=()=>{const s0=Math.max(0,Math.floor((Date.now()-new Date(AG.cron.inicio).getTime())/1000));rel.textContent=`${String(Math.floor(s0/3600)).padStart(2,"0")}:${String(Math.floor(s0%3600/60)).padStart(2,"0")}:${String(s0%60).padStart(2,"0")}`};tick();clearInterval(AG.t);AG.t=setInterval(tick,1000);
    const cli=(S.clientes||[]).find(c=>c.id===AG.cron.cliente_id)?.nome;
    corpo.append(el("div",{class:"np-agora",role:"status"},NPUI.marca("trabalhando agora","ok"),rel,el("span",{class:"tx"},t?t.titulo:(AG.cron.descricao||"atividade")),cli?el("span",{class:"ctx"},cli):null,el("span",{class:"np-agora-a"},t?NPUI.btn("Abrir",{variante:"ghost",onclick:()=>window.PP_TAREFAS?.abrir(t.id)}):null,NPUI.btn("Pausar",{variante:"ghost",onclick:async()=>{try{await window.PP_TS?.pararDireto({});toast("Tempo gravado");AG.ok=false;render()}catch(err){toast(err.message)}}}))))}
  const atrasados=Object.entries(porDia).filter(([k])=>k<hoje).flatMap(([,l])=>l.filter(i=>i.atrasada));
  const fataisHoje=D.tarefas.filter(minhas).filter(z=>z.prazo_fatal&&z.faixa==="hoje");
  const G=[];
  if(f.modo==="dia"){
    if(f.dia===hoje){
      // prazos fatais de hoje — regra da controladoria (protocolo até meio-dia + confirmação) preservada: botão "Confirmar protocolo" chama concluirComNota
      if(fataisHoje.length){const tarde=new Date().getHours()>=12;const itens=fataisHoje.map(z=>{const p=NPUI.prazoTxt(z.prazo);return NPUI.linha({id:"fatal:"+z.id,regua:"fatal",prazo:{curta:"hoje",rel:tarde?"passou do meio-dia":"até meio-dia",exata:p.exata,tom:"crit"},titulo:z.titulo,contexto:ctxV3([z.cliente_nome]),direita:[NPUI.marca("fatal","crit"),NPUI.quem(z.responsavel_nome),readOnly()?null:NPUI.btn("Confirmar protocolo",{variante:"pri",onclick:()=>window.PP_TAREFAS?.concluirComNota?.(z)})],onOpen:()=>window.PP_TAREFAS?.abrir(z.id),titleAbrir:"Abrir a tarefa"})});
        G.push(NPUI.grupo({id:"fatais",titulo:"Prazos fatais de hoje — protocolar"+(tarde?" e confirmar agora":" até meio-dia"),n:fataisHoje.length,tom:"crit",aberto:true,itens}))}
      if(atrasados.length)G.push(grupoHojeV3("atrasados","Atrasados — resolver primeiro",ord(atrasados),{tom:"crit"}));
      G.push(grupoHojeV3("hoje","Para hoje",ord(porDia[hoje]||[]),{vazio:"Nada vence hoje. Bom momento para adiantar a semana.",comDia:false}));
      const prox=[1,2,3].map(n=>isoD(addDia(dsel,n))).flatMap(k=>porDia[k]||[]);G.push(grupoHojeV3("prox","Próximos 3 dias",ord(prox),{vazio:"Nada nos próximos três dias."}));
    }else G.push(grupoHojeV3("dia","Neste dia",ord(porDia[f.dia]||[]),{vazio:"Nada neste dia.",comDia:false}));
  }else if(f.modo==="semana"){
    const seg0=(()=>{const x=new Date(dsel);x.setDate(x.getDate()-((x.getDay()+6)%7));return x})();const semDias=[...Array(7)].map((_,i)=>isoD(addDia(seg0,i)));
    if(semDias.includes(hoje)&&atrasados.length)G.push(grupoHojeV3("atrasados","Atrasados",ord(atrasados),{tom:"crit"}));
    semDias.forEach(k=>{const l=porDia[k]||[];const d=parseD(k);const lbl=d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric"}).replace(/^./,c=>c.toUpperCase())+(k===hoje?" · hoje":"");if(l.length||k===hoje)G.push(grupoHojeV3("d"+k,lbl,ord(l),{vazio:k===hoje?"Nada vence hoje.":null,comDia:false,aberto:k>=hoje}))});
    if(!G.length)corpo.append(NPUI.vazio({titulo:"Nada nesta semana",texto:"Nenhum prazo ou compromisso nesta semana."}));
  }else{
    const mesK=f.dia.slice(0,7);const dias=Object.keys(porDia).filter(k=>k.slice(0,7)===mesK).sort();
    dias.forEach(k=>{const d=parseD(k);G.push(grupoHojeV3("d"+k,d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric"}).replace(/^./,c=>c.toUpperCase())+(k===hoje?" · hoje":""),ord(porDia[k]),{comDia:false,aberto:k>=hoje}))});
    if(!dias.length)corpo.append(NPUI.vazio({titulo:"Nada marcado neste mês",texto:"Nenhum prazo ou compromisso no mês."}));
  }
  G.filter(Boolean).forEach(g=>corpo.append(g));
  // atividade recente — por último, recolhida por padrão (mesmo filtro de setor da V2)
  const SETORES={"":"Todos",juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",administrativo:"Administrativo"};const SETOR_DE={juridico:"juridico",acordos:"juridico",acompanhamento_pj:"juridico",comercial:"comercial",marketing:"marketing",administrativo:"administrativo",pos_vendas:"comercial",rh:"administrativo",socios:"administrativo"};
  const escAtv=PP.escopoTarefas?.()||{tudo:true};D.atvSetor=D.atvSetor??(()=>{try{return localStorage.getItem("pp-painel-atv")||""}catch(_){return ""}})();
  const atvOk=e=>{const t=D.tarefas.find(x=>x.id===e.tarefa_id);if(escAtv.tudo)return !D.atvSetor||(t&&SETOR_DE[t.nucleo]===D.atvSetor);if(!t)return false;const minha=(meu&&t.responsavel_id===meu.id)||t.created_by===PP.perfil?.id||e.autor===PP.perfil?.id;return minha||(escAtv.nucleos||[]).includes(t.nucleo)};
  const eventosVis=D.eventos.filter(atvOk).slice(0,12);
  const itensAtv=eventosVis.map(e=>{const t=D.tarefas.find(x=>x.id===e.tarefa_id);const d=new Date(e.criado_em);const p=NPUI.prazoTxt(isoD(d),String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"));
    const oque=(EVENTO[e.tipo]||e.tipo)+" "+(e.tipo==="prazo_alterado"?`${e.de||"—"} para ${e.para||"—"}`:e.tipo==="reatribuida"?`de ${e.de||"—"} para ${e.para||"—"}`:"");
    return NPUI.linha({id:"atv:"+e.id,prazo:p,titulo:[el("b",{},e.autor_nome||"Alguém")," ",oque.trim()," ",t?el("span",{class:"np-atv-t"},t.titulo):""],contexto:e.nota?["“"+String(e.nota).slice(0,120)+"”"]:null,direita:[],onOpen:()=>{if(t)window.PP_TAREFAS?.abrir(t.id)},titleAbrir:t?"Abrir a tarefa":"Sem tarefa"})});
  const atvHead=escAtv.tudo?el("div",{class:"np-atv-f"},Object.entries(SETORES).map(([k,l])=>NPUI.chip({label:l,on:D.atvSetor===k,grupo:"setor",onclick:()=>{D.atvSetor=k;try{localStorage.setItem("pp-painel-atv",k)}catch(_){}render()}}))):null;
  const gAtv=NPUI.grupo({id:"atividade",titulo:"Atividade recente"+(escAtv.tudo?"":escAtv.nucleos?" · suas e do jurídico":" · só as suas"),n:eventosVis.length,aberto:NPUI.pref.get("np-hoje-g-atividade","0")==="1",onToggle:ab=>NPUI.pref.set("np-hoje-g-atividade",ab?"1":"0"),itens:itensAtv.length?itensAtv:[el("li",{class:"np-it np-it-vazia"},el("span",{class:"np-it-chk np-it-chk-vazio","aria-hidden":"true"}),el("span",{class:"np-it-prazo"}),el("span",{class:"np-it-abrir np-sem"},"Sem movimentação ainda."))]});
  if(atvHead)gAtv.querySelector(".np-grp-c").prepend(atvHead);corpo.append(gAtv);
  const tot=Object.values(porDia).flat().length;corpo.append(NPUI.rodape(`${prazos.length} prazo${prazos.length===1?"":"s"} · ${tot} item${tot===1?"":"ns"} no período carregado`,[["crit","fatal"],["late","atrasado"],["att","hoje"]]));
  obra.append(corpo);v.append(obra);
  H3.painel=NPUI.painel({obra,label:"Compromisso",onClose:()=>{H3.aberta=null}});
  if(H3.aberta){const [,id]=H3.aberta.split(":");const e=D.cal.agenda.find(x=>x.id===id);if(e){const i={k:"evento",e,atrasada:false};abrirPainelHojeV3(i,null)}else H3.aberta=null}
}
document.head.append(el("style",{},`html.np-casca-v3 .np-hoje-h{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:6px 0 10px}html.np-casca-v3 .np-hoje-h h1{font:500 var(--np-fs-6)/1.15 var(--np-display);margin:0;color:var(--np-text)}html.np-casca-v3 .np-hoje-d{font:400 var(--np-fs-2)/1.3 var(--np-ui);color:var(--np-text-3)}
html.np-casca-v3 .np-agora{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;margin:0 0 10px;border:1px solid var(--np-line);border-left:3px solid var(--np-ok);border-radius:var(--np-r);background:var(--np-surface)}html.np-casca-v3 .np-agora .np-cron{font:500 var(--np-fs-3)/1 var(--np-display);font-variant-numeric:tabular-nums}html.np-casca-v3 .np-agora .tx{font:500 var(--np-fs-2)/1.3 var(--np-ui);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48ch}html.np-casca-v3 .np-agora .ctx{color:var(--np-text-3);font-size:var(--np-fs-1)}html.np-casca-v3 .np-agora-a{margin-left:auto;display:flex;gap:4px}
html.np-casca-v3 .np-nav-per{display:inline-flex;align-items:center;gap:2px}html.np-casca-v3 .np-atv-f{display:flex;gap:4px;flex-wrap:wrap;padding:6px 10px 2px}html.np-casca-v3 .np-atv-t{color:var(--np-text-2);font-weight:400}html.np-casca-v3 .np-atv-t::before{content:"— "}
html.np-casca-v3 .np-it-vazia{color:var(--np-text-3);cursor:default}html.np-casca-v3 .np-it-vazia .np-it-abrir{cursor:default;font-style:italic}html.np-casca-v3 .np-txt{white-space:pre-wrap;font:400 var(--np-fs-2)/1.5 var(--np-ui);margin:0}
@media (max-width:600px){html.np-casca-v3 .np-agora .np-agora-a{margin-left:0;width:100%}}`));

{const _r=render;render=function(){_r();const v=$("#view-painel");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="painel")S.tab="clientes";v.hidden=S.tab!=="painel";if(S.tab==="painel"){if(hojeV3())renderPainelV3();else{v.classList.remove("np-v3");renderPainel()}}}}
window.PP_PAINEL={recarregar:()=>{D.ok=false;AG.ok=false;garantir()},v3:hojeV3};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){tempoReal();let salvo=null;try{salvo=localStorage.getItem("pp-tab")}catch(_){}if(!location.hash&&!salvo){S.tab="painel";render()}}});
})();
