/* Avisos do escritório — mural: admins publicam (para todos ou por área), cada pessoa marca como lido; aviso no sino ao publicar.
   Supabase: avisos, avisos_leituras, v_avisos (0060). Card de não lidos no Meu painel. */
(()=>{
"use strict";
const AV={lista:[],ok:false,carregando:false,sel:null,alvo:null};
/* #avisos/<id> (links externos — Discord/WhatsApp): o roteador do núcleo normaliza o hash para "#avisos" no primeiro render, antes
   deste módulo renderizar; por isso o id é capturado aqui, no carregamento, e consumido uma vez (na V2 e na V3.1). */
try{const [t,id]=(location.hash||"").slice(1).split("/");if(t==="avisos"&&id)AV.alvo=id}catch(_){}
window.addEventListener("hashchange",()=>{try{const [t,id]=(location.hash||"").slice(1).split("/");if(t==="avisos"&&id)AV.alvo=id}catch(_){}});
const AREAS={clientes:"Clientes",juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",equipe:"Equipe"};
const admin=()=>PP.perfil?.papel==="admin";
const fmtDT=iso=>new Date(iso).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
async function carregar(){
  if(AV.carregando)return;AV.carregando=true;
  try{const {data,error}=await SB.from("v_avisos").select("*").order("fixado",{ascending:false}).order("publicado_em",{ascending:false}).limit(200);if(error)throw error;AV.lista=data||[];AV.ok=true}
  catch(e){console.warn("avisos",e)}finally{AV.carregando=false}
  render();
}
const garantir=()=>{if(!AV.ok&&!AV.carregando)carregar();return AV.ok};
const invalidar=()=>{AV.ok=false;garantir()};
async function marcarLida(a){if(a.lida)return;await SB.from("avisos_leituras").upsert({aviso_id:a.id,perfil_id:PP.perfil.id},{onConflict:"aviso_id,perfil_id"});a.lida=true;try{window.PP_NOTIF?.recarregar?.()}catch(_){}render()}
function cartao(a,compacto){
  const corpo=el("div",{class:"av-corpo",style:"white-space:pre-wrap"},a.texto);
  return el("div",{class:"card av"+(a.lida?"":" nova")+(a.fixado?" fixado":""),id:"aviso-"+a.id},
    el("div",{style:"display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap"},el("div",{style:"flex:1;min-width:200px"},el("div",{style:"display:flex;gap:6px;align-items:center;flex-wrap:wrap"},a.fixado?el("span",{class:"pill e2"},"Fixado"):null,!a.lida?el("span",{class:"pill e3"},"Novo"):null,el("h3",{style:"margin:0"},a.titulo)),
      el("div",{class:"note"},`${a.autor_nome||"Direção"} · ${fmtDT(a.publicado_em)}${a.areas?.length?" · "+a.areas.map(x=>AREAS[x]||x).join(", "):" · todo o escritório"}${a.expira_em?" · até "+fmtD(parseD(a.expira_em)):""}${admin()?` · ${a.leituras} leitura(s)`:""}`)),
      el("div",{style:"display:flex;gap:6px"},!a.lida?el("button",{class:"btn sm primary",onclick:()=>marcarLida(a)},"Marcar como lido"):null,admin()?el("button",{class:"btn sm",onclick:()=>openForm(a)},"Editar"):null)),
    compacto?el("div",{class:"note",style:"margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap"},a.texto):corpo);
}
function renderAvisos(){
  const v=$("#view-avisos");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Escritório"),el("h1",{},"Avisos"),el("div",{class:"sub"},"Comunicados da direção. Quem pode ver recebe no sino; marque como lido para sair do destaque do seu painel.")),
    el("div",{class:"actions"},admin()?el("button",{class:"btn primary",onclick:()=>openForm({})},"+ Aviso"):null)));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  if(admin())v.append(cardDiscord());
  const h=(location.hash||"").split("/")[1]||AV.alvo;AV.alvo=null;
  if(!AV.lista.length){v.append(el("div",{class:"card empty"},"Nenhum aviso publicado."));return}
  v.append(el("div",{style:"display:grid;gap:12px"},...AV.lista.map(a=>cartao(a,false))));
  if(h){const elx=document.getElementById("aviso-"+h);if(elx){elx.scrollIntoView({block:"center"});const a=AV.lista.find(x=>x.id===h);if(a&&!a.lida)marcarLida(a)}}
}
function openForm(a){
  const tit=inp("text",a.titulo||"",{placeholder:"Ex.: Recesso de fim de ano"}),txt=el("textarea",{rows:"6",placeholder:"Texto do aviso"},a.texto||""),fix=el("input",{type:"checkbox"});fix.checked=!!a.fixado;
  const exp=inp("date",a.expira_em||"");const chks=Object.fromEntries(Object.entries(AREAS).map(([k,l])=>{const i=el("input",{type:"checkbox"});i.checked=(a.areas||[]).includes(k);return [k,i]}));
  const body=el("div",{class:"form"},field("av-tit","Título",tit),field("av-txt","Texto",txt),el("div",{class:"f full"},el("label",{},"Para quem"),el("div",{class:"note"},"Sem marcar nada = todo o escritório."),el("div",{style:"display:flex;gap:12px;flex-wrap:wrap;margin-top:6px"},...Object.entries(AREAS).map(([k,l])=>el("label",{class:"switch"},chks[k]," "+l)))),
    el("div",{class:"f"},el("label",{},"Fixado no topo"),el("label",{class:"switch"},fix," manter em destaque")),field("av-exp","Expira em (opcional)",exp,"Depois dessa data o aviso some da lista."));
  const extra=a.id?el("button",{class:"btn danger",onclick:async()=>{if(!window.confirm("Excluir este aviso?"))return;await SB.from("avisos").delete().eq("id",a.id);$("#modalHost").replaceChildren();toast("Aviso excluído");invalidar()}},"Excluir"):null;
  modal(a.id?"Editar aviso":"Novo aviso",body,async()=>{
    if(!tit.value.trim()||!txt.value.trim())throw new Error("Informe título e texto");
    const areas=Object.keys(AREAS).filter(k=>chks[k].checked);
    const row={titulo:tit.value.trim(),texto:txt.value.trim(),areas:areas.length?areas:null,fixado:fix.checked,expira_em:exp.value||null,autor_id:a.id?undefined:PP.perfil.id,updated_at:new Date().toISOString()};
    if(row.autor_id===undefined)delete row.autor_id;
    const {error}=a.id?await SB.from("avisos").update(row).eq("id",a.id):await SB.from("avisos").insert(row);if(error)throw new Error(error.message);
    toast(a.id?"Aviso atualizado":"Aviso publicado — a equipe recebe no sino");invalidar();
  },extra);
}
/* integração Discord (admin): canal dos avisos, canal espelhado do chat Geral, ponte on/off */
function cardDiscord(){
  const card=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Discord"),el("div",{class:"note"},"Avisos publicados aqui também vão para o canal do Discord; o canal Geral do chat pode ser espelhado nos dois sentidos."))),el("div",{class:"note"},"Carregando…"));
  (async()=>{
    const [{data:e},{data:g}]=await Promise.all([SB.from("escritorio").select("dados").eq("id","discord").maybeSingle(),SB.from("chat_canais").select("id,discord_canal").eq("chave","geral").maybeSingle()]);
    const cfg=e?.dados||{};const avisos=inp("text",cfg.canal_avisos||"",{placeholder:"ID do canal #avisos (número)"}),geral=inp("text",g?.discord_canal||"",{placeholder:"ID do canal #geral (número)"});
    const ponte=el("input",{type:"checkbox"});ponte.checked=cfg.ponte_ativa!==false;
    const salvar=el("button",{class:"btn sm primary",onclick:async()=>{
      const a=avisos.value.replace(/\D/g,"")||null,gg=geral.value.replace(/\D/g,"")||null;
      const r1=await SB.from("escritorio").update({dados:{...cfg,canal_avisos:a,ponte_ativa:ponte.checked}}).eq("id","discord");
      const r2=g?await SB.from("chat_canais").update({discord_canal:gg}).eq("id",g.id):{error:null};
      if(r1.error||r2.error){toast("Não foi possível salvar");return}toast("Discord configurado");invalidar();
    }},"Salvar");
    card.replaceChildren(card.firstChild,el("div",{class:"form",style:"margin-top:8px"},field("dc-av","Canal dos avisos",avisos,"Discord → Modo desenvolvedor → botão direito no canal → Copiar ID."),field("dc-ge","Canal espelhado do chat Geral",geral,"Deixe vazio para não espelhar."),el("div",{class:"f"},el("label",{},"Ponte ativa"),el("label",{class:"switch"},ponte," importar mensagens do Discord para o chat (a cada minuto)"))),el("div",{style:"margin-top:8px"},salvar));
  })();
  return card;
}
/* card no Meu painel */
function cardPainel(){
  if(!garantir())return null;
  const nl=AV.lista.filter(a=>!a.lida);const fix=AV.lista.filter(a=>a.lida&&a.fixado).slice(0,2);
  if(!nl.length&&!fix.length)return null;
  return el("section",{class:"card section av-painel"},el("div",{class:"section-h"},el("div",{},el("h2",{},"📣 Avisos"),el("div",{class:"note"},nl.length?`${nl.length} não lido(s)`:"fixados")),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>irPara("avisos")},"Ver todos"))),
    el("div",{style:"display:grid;gap:8px;margin-top:8px"},...[...nl.slice(0,3),...fix].map(a=>cartao(a,true))));
}
document.head.append(el("style",{},`.av.nova{border-left:3px solid var(--gold)}.av.fixado h3::before{content:"📌 "}.av-painel .av{padding:10px 12px}`));

/* ============================================================================================================
   V3.1 (Design System, Fase 4A) — Avisos: mesma leitura (v_avisos), mesma marcação de lido (avisos_leituras upsert, marcarLida),
   mesmo formulário de admin (openForm). Lista com régua (novo = atenção) e painel com o texto completo. Na tela Hoje V3.1, os
   não lidos entram como grupo no topo da obra (no lugar do cartão da V2). Ativa só com html.np-casca-v3 + np-ui.
   ============================================================================================================ */
const ctxV3=a=>a.filter(Boolean).flatMap((x,i)=>i?[" · ",x]:[x]);
const avisosV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const V3A={obra:null,painel:null,aberta:null,f:"nao-lidos"}; // filtro persistido por NPUI.pref (chave isolada: "-beta" no espelho)
function linhaAvV3(a){
  const d=new Date(a.publicado_em);const p=NPUI.prazoTxt(d.toISOString().slice(0,10));p.rel="";
  const areas=a.areas?.length?a.areas.map(x=>AREAS[x]||x).join(", "):"todo o escritório";
  return NPUI.linha({id:a.id,regua:a.lida?null:"att",prazo:{...p,tom:a.lida?"":"att"},titulo:a.titulo,contexto:ctxV3([a.autor_nome||"Direção",areas,a.expira_em?"até "+fmtD(parseD(a.expira_em)):null]),
    direita:[!a.lida?NPUI.marca("novo","att"):null,a.fixado?NPUI.marca("fixado"):null,admin()?el("span",{class:"np-num",title:"leituras"},`${a.leituras} leitura${+a.leituras===1?"":"s"}`):null],atual:V3A.aberta===a.id,onOpen:li=>abrirPainelAvV3(a,li),titleAbrir:"Ler o aviso"});
}
function abrirPainelAvV3(a,li,{silencioso}={}){
  if(!V3A.painel)return;V3A.aberta=a.id;
  const areas=a.areas?.length?a.areas.map(x=>AREAS[x]||x).join(", "):"todo o escritório";
  const props=NPUI.props([["Publicado",fmtDT(a.publicado_em)],["Por",a.autor_nome||"Direção"],["Para",areas],a.expira_em?["Expira",fmtD(parseD(a.expira_em))]:null,admin()?["Leituras",String(a.leituras)]:null]);
  const texto=NPUI.secao("Aviso",el("p",{class:"np-txt"},a.texto));
  const pe=[!a.lida?NPUI.btn("Marcar como lido",{variante:"pri",icone:"check",onclick:async()=>{await marcarLida(a)}}):null,admin()?NPUI.btn("Editar",{onclick:()=>openForm(a)}):null];
  V3A.painel.abrir({id:a.id,trilha:[el("span",{},"Avisos"),el("span",{},a.fixado?"Fixado":a.lida?"Lido":"Novo")],titulo:a.titulo,corpo:[props,texto],pe,origem:silencioso?null:(li?.querySelector(".np-it-abrir")||li)});
}
function renderAvisosV3(){
  const v=$("#view-avisos");v.replaceChildren();v.classList.add("np-v3");V3A.obra=null;V3A.painel=null;
  if(!garantir()){v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(5));return}
  const nl=AV.lista.filter(a=>!a.lida),fx=AV.lista.filter(a=>a.fixado);
  const resumo=NPUI.resumo([{n:nl.length,label:nl.length===1?"não lido":"não lidos",tom:nl.length?"att":"zero"},{n:fx.length,label:fx.length===1?"fixado":"fixados"},{n:AV.lista.length,label:"publicados"}]);
  const chips=[];const C=o=>{const c=NPUI.chip(o);chips.push(c);return c};
  V3A.f=NPUI.pref.get("np-avisos-f",V3A.f);
  const F=(k,l,n)=>C({label:l,n,on:V3A.f===k,grupo:"f",onclick:()=>{V3A.f=k;NPUI.pref.set("np-avisos-f",k);render()}});
  F("nao-lidos","Não lidos",nl.length);F("fixados","Fixados",fx.length);F("todos","Todos",AV.lista.length);
  const direita=[admin()?NPUI.btn("Discord",{variante:"ghost",title:"Canal dos avisos e ponte do chat Geral",onclick:()=>{V3A.aberta="discord";V3A.painel.abrir({id:"discord",trilha:[el("span",{},"Avisos"),el("span",{},"Integração")],titulo:"Discord",corpo:[cardDiscord()],pe:[]})}}):null,admin()?NPUI.btn("Aviso",{variante:"pri",icone:"mais",onclick:()=>openForm({})}):null];
  v.append(NPUI.toolbar({resumo,filtros:chips,direita}));NPUI.reancorarPop();
  const obra=el("div",{class:"np-obra"});V3A.obra=obra;const corpo=el("div",{class:"np-corpo"});
  const lista=V3A.f==="nao-lidos"?nl:V3A.f==="fixados"?fx:AV.lista;
  const ordem=l=>[...l].sort((a,b)=>(b.fixado?1:0)-(a.fixado?1:0)||(a.publicado_em<b.publicado_em?1:-1));
  if(!AV.lista.length)corpo.append(NPUI.vazio({titulo:"Nenhum aviso publicado",texto:admin()?"Publique o primeiro comunicado da direção.":"Quando a direção publicar, aparece aqui e no sino.",acao:admin()?"Novo aviso":null,onAcao:admin()?()=>openForm({}):null}));
  else if(!lista.length)corpo.append(NPUI.vazio({titulo:V3A.f==="nao-lidos"?"Tudo lido":"Nenhum aviso fixado",texto:V3A.f==="nao-lidos"?"Você já leu todos os avisos.":"Nada em destaque no momento.",acao:"Ver todos",onAcao:()=>{V3A.f="todos";render()}}));
  else{
    if(V3A.f==="todos"){const novos=ordem(lista.filter(a=>!a.lida)),lidos=ordem(lista.filter(a=>a.lida));
      if(novos.length)corpo.append(NPUI.grupo({id:"novos",titulo:"Não lidos",n:novos.length,tom:"att",itens:novos.map(linhaAvV3)}));
      corpo.append(NPUI.grupo({id:"lidos",titulo:"Lidos",n:lidos.length,aberto:!novos.length||NPUI.pref.get("np-avisos-g-lidos","1")==="1",onToggle:ab=>NPUI.pref.set("np-avisos-g-lidos",ab?"1":"0"),itens:lidos.length?lidos.map(linhaAvV3):[el("li",{class:"np-it np-it-vazia"},el("span",{class:"np-it-chk np-it-chk-vazio","aria-hidden":"true"}),el("span",{class:"np-it-prazo"}),el("span",{class:"np-it-abrir np-sem"},"Nenhum lido ainda."))]}))}
    else corpo.append(el("ul",{class:"np-lst",role:"list"},ordem(lista).map(linhaAvV3)));
  }
  corpo.append(NPUI.rodape(`${lista.length} aviso${lista.length===1?"":"s"} com este filtro`,[["att","não lido"]]));
  obra.append(corpo);v.append(obra);
  V3A.painel=NPUI.painel({obra,label:"Aviso",onClose:()=>{V3A.aberta=null}});
  if(V3A.aberta&&V3A.aberta!=="discord"){const a=AV.lista.find(x=>x.id===V3A.aberta);if(a)abrirPainelAvV3(a,null,{silencioso:true});else V3A.aberta=null}
  const h=(location.hash||"").split("/")[1]||AV.alvo;AV.alvo=null;if(h){const a=AV.lista.find(x=>x.id===h);if(a){abrirPainelAvV3(a,null,{silencioso:true});if(!a.lida)marcarLida(a)}}
}
/* grupo "Avisos" na tela Hoje V3.1 — mesmo conteúdo do cartão da V2 (não lidos + até 2 fixados) */
function grupoHojeAvV3(){
  if(!garantir())return null;
  const nl=AV.lista.filter(a=>!a.lida);const fix=AV.lista.filter(a=>a.lida&&a.fixado).slice(0,2);
  if(!nl.length&&!fix.length)return null;
  const abrir=a=>{AV.alvo=a.id;try{history.pushState(null,"","#avisos/"+a.id)}catch(_){}irPara("avisos")};
  const itens=[...nl.slice(0,3),...fix].map(a=>{const d=new Date(a.publicado_em);const p=NPUI.prazoTxt(d.toISOString().slice(0,10));p.rel="";
    return NPUI.linha({id:"aviso:"+a.id,regua:a.lida?null:"att",prazo:{...p,tom:a.lida?"":"att"},titulo:a.titulo,contexto:ctxV3([a.autor_nome||"Direção",String(a.texto||"").replace(/\s+/g," ").slice(0,90)]),direita:[!a.lida?NPUI.marca("novo","att"):null,a.fixado?NPUI.marca("fixado"):null,!a.lida?NPUI.btn("Marcar como lido",{variante:"ghost",onclick:async()=>{await marcarLida(a)}}):null],onOpen:()=>abrir(a),titleAbrir:"Ler o aviso"})});
  const g=NPUI.grupo({id:"avisos",titulo:"Avisos",n:nl.length||fix.length,tom:nl.length?"att":null,aberto:true,itens});g.classList.add("np-hoje-avisos");return g;
}

{const _r=render;render=function(){_r();const v=$("#view-avisos");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="avisos")S.tab="clientes";v.hidden=S.tab!=="avisos";if(S.tab==="avisos"){if(avisosV3())renderAvisosV3();else{v.classList.remove("np-v3");renderAvisos()}}
  if(S.tab==="painel"&&eq){const vp=$("#view-painel");if(avisosV3()){const old=vp?.querySelector(".np-hoje-avisos");if(old)old.remove();const g=grupoHojeAvV3();const corpo=vp?.querySelector(".np-corpo");const ancora=corpo?.querySelector(".np-hoje-h");if(g&&corpo){const ag=corpo.querySelector(".np-agora");if(ag)ag.after(g);else if(ancora)ancora.after(g);else corpo.prepend(g)}}else{const old=vp?.querySelector(".av-painel");if(old)old.remove();const c=cardPainel();const head=vp?.querySelector(".head");if(c&&head)head.after(c)}}}}
window.PP_AVISOS={invalidar,v3:avisosV3};
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){SB.channel("avisos").on("postgres_changes",{event:"*",schema:"public",table:"avisos"},()=>invalidar()).subscribe()}});
})();
