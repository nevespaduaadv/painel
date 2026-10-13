/* Meu painel — tela inicial da equipe: o que vence (minhas tarefas / equipe), carteira, leads e atividade recente.
   Lê v_prazos (tarefas + processos + negociações), v_tarefas, v_leads (resumo), tarefa_eventos e os dados já carregados (S.clientes/S.contratos). */
(()=>{
"use strict";
const D={ok:false,carregando:false,prazos:[],tarefas:[],colab:[],eventos:[],leads:null,escopo:"minhas"};
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
function renderPainel(){
  const v=$("#view-painel");v.replaceChildren();
  const nome=(PP.perfil?.nome||"").split(" ").slice(0,2).join(" ");
  const h=new Date().getHours(),sauda=h<12?"Bom dia":h<18?"Boa tarde":"Boa noite";
  const esc=PP.escopoTarefas?.()||{tudo:true};if(!esc.tudo&&!esc.nucleos)D.escopo="minhas";
  const escopo=(esc.tudo||esc.nucleos)?el("div",{class:"tabs"},[["minhas","Minhas"],["equipe",esc.tudo?"Equipe":"Jurídico"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(D.escopo===k),onclick:()=>{D.escopo=k;try{localStorage.setItem("pp-painel-escopo",k)}catch(_){}render()}},l))):null;
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})),el("h1",{},`${sauda}${nome?", "+nome:""}`),el("div",{class:"sub"},"O que precisa da sua atenção hoje.")),
    el("div",{class:"actions"},escopo,el("button",{class:"btn",title:"Envia agora, no seu Discord/WhatsApp (conforme a sua ficha), o mesmo resumo que chega às 8h",onclick:enviarResumo},"Receber resumo agora"),el("button",{class:"btn primary",onclick:()=>window.PP_TAREFAS?.nova?.()},"+ Tarefa"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const meu=meuColab();const minhas=z=>D.escopo==="equipe"?(esc.tudo||(esc.nucleos||[]).includes(z.nucleo)||(meu&&z.responsavel_id===meu.id)):(!meu||z.responsavel_id===meu.id);
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
    (PP.temAcesso?.("clientes")??true)?K("Carteira",BRL(saldo),`${ativos.length} contratos · ${(S.clientes||[]).length} clientes`,"",irTab("clientes")):null,
    (leadsAtras==null||!(PP.temAcesso?.("leads")??true))?null:K("Leads atrasados",leadsAtras,`de ${D.leads.length} abertos`,leadsAtras?"warn":"",irTab("leads"))));
  const duas=el("div",{style:"display:grid;grid-template-columns:1.5fr 1fr;gap:18px"});
  duas.append(cardPrazos([...atrasadas,...hoje,...d7],"Vence até 7 dias","Nada vencendo nos próximos 7 dias."));
  const col=el("div",{style:"display:flex;flex-direction:column;gap:18px"});
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
function tempoReal(){const ch=SB.channel("painel");ch.on("postgres_changes",{event:"*",schema:"public",table:"tarefas"},()=>{clearTimeout(rt);rt=setTimeout(()=>{D.ok=false;if(S.tab==="painel")garantir()},500)});ch.subscribe()}
{const _r=render;render=function(){_r();const v=$("#view-painel");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="painel")S.tab="clientes";v.hidden=S.tab!=="painel";if(S.tab==="painel")renderPainel()}}
window.PP_PAINEL={recarregar:()=>{D.ok=false;garantir()}};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){tempoReal();let salvo=null;try{salvo=localStorage.getItem("pp-tab")}catch(_){}if(!location.hash&&!salvo){S.tab="painel";render()}}});
})();
