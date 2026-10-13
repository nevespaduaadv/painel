/* Avisos do escritório — mural: admins publicam (para todos ou por área), cada pessoa marca como lido; aviso no sino ao publicar.
   Supabase: avisos, avisos_leituras, v_avisos (0060). Card de não lidos no Meu painel. */
(()=>{
"use strict";
const AV={lista:[],ok:false,carregando:false,sel:null};
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
  const h=(location.hash||"").split("/")[1];
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
/* card no Meu painel */
function cardPainel(){
  if(!garantir())return null;
  const nl=AV.lista.filter(a=>!a.lida);const fix=AV.lista.filter(a=>a.lida&&a.fixado).slice(0,2);
  if(!nl.length&&!fix.length)return null;
  return el("section",{class:"card section av-painel"},el("div",{class:"section-h"},el("div",{},el("h2",{},"📣 Avisos"),el("div",{class:"note"},nl.length?`${nl.length} não lido(s)`:"fixados")),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>irPara("avisos")},"Ver todos"))),
    el("div",{style:"display:grid;gap:8px;margin-top:8px"},...[...nl.slice(0,3),...fix].map(a=>cartao(a,true))));
}
document.head.append(el("style",{},`.av.nova{border-left:3px solid var(--gold)}.av.fixado h3::before{content:"📌 "}.av-painel .av{padding:10px 12px}`));
{const _r=render;render=function(){_r();const v=$("#view-avisos");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="avisos")S.tab="clientes";v.hidden=S.tab!=="avisos";if(S.tab==="avisos")renderAvisos();
  if(S.tab==="painel"&&eq){const vp=$("#view-painel");const old=vp?.querySelector(".av-painel");if(old)old.remove();const c=cardPainel();const head=vp?.querySelector(".head");if(c&&head)head.after(c)}}}
window.PP_AVISOS={invalidar};
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){SB.channel("avisos").on("postgres_changes",{event:"*",schema:"public",table:"avisos"},()=>invalidar()).subscribe()}});
})();
