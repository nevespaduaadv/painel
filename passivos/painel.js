/* Meu painel — tela inicial da equipe: o que vence (minhas tarefas / equipe), carteira, leads e atividade recente.
   Lê v_prazos (tarefas + processos + negociações), v_tarefas, v_leads (resumo), tarefa_eventos e os dados já carregados (S.clientes/S.contratos). */
(()=>{
"use strict";
const D={ok:false,carregando:false,prazos:[],tarefas:[],colab:[],eventos:[],leads:null,escopo:"minhas",cal:{ref:null,chave:null,agenda:[],carregando:false,dia:null}};
try{D.escopo=localStorage.getItem("pp-painel-escopo")||"minhas"}catch(_){}
const meuColab=()=>D.colab.find(c=>c.perfil_id===PP.perfil?.id);
const fmtDT=v=>{if(!v)return"";const d=new Date(v);return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
async function carregar(){
  if(D.carregando)return;D.carregando=true;
  try{
    const [p,t,c,e,l]=await Promise.all([
      SB.from("v_prazos").select("*").order("prazo"),
      SB.from("v_tarefas").select("id,titulo,status,prazo,prazo_fatal,responsavel_id,responsavel_nome,cliente_nome,faixa,created_by").in("status",["aberta","em_andamento"]),
      SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo"),
      SB.from("tarefa_eventos").select("*").order("criado_em",{ascending:false}).limit(80),
      SB.from("v_leads").select("id,nome,empresa,status,atraso,tarefas_vencidas,proprietario_id,fase_nome").eq("status","Aberto")]);
    if(p.error)throw p.error;
    D.prazos=p.data||[];D.tarefas=t.data||[];D.colab=c.data||[];D.eventos=e.data||[];D.leads=l.error?null:(l.data||[]);D.ok=true;
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
    const cel=el("button",{class:"mc-d"+(d.getMonth()!==ref.getMonth()?" fora":"")+(k===hoje?" hoje":"")+(D.cal.dia===k?" sel":""),onclick:()=>{D.cal.dia=D.cal.dia===k?null:k;render()},title:lista.length?lista.length+" item(ns)":""},
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
function faixaAgora(meu){
  if(!AG.ok)carregarAgora(meu);
  const irTab=t=>()=>{S.tab=t;try{localStorage.setItem("pp-tab",t)}catch(_){}render()};
  const box=el("div",{class:"card",style:"padding:12px 16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:14px;border-color:var(--gold)"});
  const hFmt=h=>{h=+h||0;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};
  if(AG.cron){const t=D.tarefas.find(x=>x.id===AG.cron.tarefa_id);const rel=el("b",{style:"font-size:20px;font-variant-numeric:tabular-nums"},"00:00:00");
    const tick=()=>{const s=Math.max(0,Math.floor((Date.now()-new Date(AG.cron.inicio).getTime())/1000));rel.textContent=`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor(s%3600/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};tick();clearInterval(AG.t);AG.t=setInterval(tick,1000);
    box.append(el("div",{style:"display:flex;gap:10px;align-items:center"},el("span",{class:"pill e2"},"● trabalhando"),rel,el("div",{},el("b",{},t?t.titulo:(AG.cron.descricao||"atividade")),el("div",{class:"note"},(S.clientes||[]).find(c=>c.id===AG.cron.cliente_id)?.nome||"")),
      t?el("button",{class:"btn sm primary",onclick:()=>window.PP_TAREFAS?.abrir(t.id)},"Abrir tarefa"):null,el("button",{class:"btn sm",onclick:async()=>{try{await window.PP_TS?.pararDireto({});toast("Tempo gravado");AG.ok=false;render()}catch(e){toast(e.message)}}},"⏸ Pausar")));}
  else box.append(el("div",{class:"note"},meu?"Nenhum cronômetro rodando — abra uma tarefa e clique em “Iniciar trabalho”.":"Seu usuário não está vinculado a um colaborador."));
  const K=(l,v,cls,on)=>el("button",{class:"btn sm",style:"display:flex;flex-direction:column;align-items:flex-start;gap:0;padding:6px 12px;line-height:1.2"+(cls?";border-color:var(--"+cls+")":""),onclick:on},el("span",{class:"note",style:"font-size:11px"},l),el("b",{},v));
  const dir=el("div",{style:"display:flex;gap:8px;margin-left:auto;flex-wrap:wrap"});
  if(AG.horas!=null)dir.append(K("Horas na semana",hFmt(AG.horas),"",irTab("horas")));
  if(AG.pub)dir.append(K("Publicações a tratar",String(AG.pub.total)+(AG.pub.vencidas?` · ${AG.pub.vencidas} vencidas`:""),AG.pub.vencidas?"crit":"",irTab("publicacoes")));
  if(AG.sf)dir.append(K("Faturamento em análise",`${AG.sf.n} · ${BRL(AG.sf.valor)}`,AG.sf.n?"warn":"",irTab("faturamento")));
  box.append(dir);return box;
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
  v.append(faixaAgora(meu));const minhas=z=>D.escopo==="equipe"?(esc.tudo||(esc.nucleos||[]).includes(z.nucleo)||(meu&&z.responsavel_id===meu.id)):(!meu||z.responsavel_id===meu.id);
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
    K("Fatais em 7 dias",fatais.length,"inclui atrasados",fatais.length?"crit":"",irTab("tarefas")),
    (PP.perfil?.papel==="admin")?K("Carteira",BRL(saldo),`${ativos.length} contratos · ${(S.clientes||[]).length} clientes`,"",irTab("clientes")):null,
    (leadsAtras==null||!(PP.temAcesso?.("leads")??true))?null:K("Leads atrasados",leadsAtras,`de ${D.leads.length} abertos`,leadsAtras?"warn":"",irTab("leads"))));
  const duas=el("div",{style:"display:grid;grid-template-columns:1.5fr 1fr;gap:18px"});
  duas.append(cardPrazos([...atrasadas,...hoje,...d7],"Vence até 7 dias","Nada vencendo nos próximos 7 dias."));
  const col=el("div",{style:"display:flex;flex-direction:column;gap:18px"});
  col.append(cardCalendario(prazos,meu));
  const prox=prazos.filter(z=>z.faixa==="d15"||z.faixa==="d30");
  col.append(cardPrazos(prox,"Próximos 30 dias","Nada entre 8 e 30 dias."));
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
{const _r=render;render=function(){_r();const v=$("#view-painel");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="painel")S.tab="clientes";v.hidden=S.tab!=="painel";if(S.tab==="painel")renderPainel()}}
window.PP_PAINEL={recarregar:()=>{D.ok=false;AG.ok=false;garantir()}};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){tempoReal();let salvo=null;try{salvo=localStorage.getItem("pp-tab")}catch(_){}if(!location.hash&&!salvo){S.tab="painel";render()}}});
})();
