/* Ferramentas — página de botões (pedido da sócia, 26/11): no menu, “Ferramentas” é um item só; a página mostra um quadro por
   ferramenta e a pessoa entra na que quiser. “Base de conhecimento” abre um segundo menu, por área.
   Não há dados próprios: cada quadro leva a uma tela que já existe e só aparece para quem tem acesso a ela. */
(()=>{
"use strict";
const F={sub:""}; // "" = ferramentas · "kb" = áreas da base de conhecimento
const IC={
  superendividamento:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M12 10h2M16 10h0M8 14h2M12 14h2M16 14h0M8 18h2M12 18h4"/>',
  pecas:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  monitoramento:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  autenticador:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  revisional:'<path d="M12 3v18M3 7h18M5 7l-3 7a4 4 0 0 0 8 0zM19 7l-3 7a4 4 0 0 0 8 0z"/>',
  conhecimento:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  area:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
const FERR=[["superendividamento","Superendividamento","Plano de pagamento e cálculo"],["pecas","Modelos de peças","Modelos e papel timbrado"],["monitoramento","Monitoramento","Processos acompanhados"],["autenticador","Autenticador (2FA)","Códigos de acesso do escritório"],["revisional","Revisional de contratos","Revisão e recálculo"],["conhecimento","Base de conhecimento","Procedimentos e materiais por área"]];
const AREAS_KB=[["geral","Geral"],["comercial","Comercial"],["financeiro","Financeiro"],["juridico","Jurídico"],["administrativo","Administrativo"],["marketing","Marketing"]];
const podeTab=t=>{try{return !!document.getElementById("view-"+t)&&(!PP.temAcesso||PP.temAcesso(t)===true)}catch(_){return false}};
const podeAreaKB=a=>{const p=PP.perfil||{};if(p.papel==="admin"||a==="geral")return true;const ac=p.acessos||[];if(a==="administrativo")return ac.includes("financeiro")||ac.includes("equipe");return ac.includes(a)};
const ico=d=>{const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("fill","none");s.setAttribute("stroke","currentColor");s.setAttribute("stroke-width","1.6");s.setAttribute("stroke-linecap","round");s.setAttribute("stroke-linejoin","round");s.setAttribute("aria-hidden","true");s.innerHTML=d;return s};
const quadro=(icone,titulo,sub,onclick)=>el("button",{type:"button",class:"np-ferr-q",onclick},el("span",{class:"i"},ico(icone)),el("span",{class:"t"},titulo),sub?el("span",{class:"s"},sub):null);
const irKB=a=>{try{history.pushState(null,"","#conhecimento/area:"+a)}catch(_){}if(typeof aplicarHash==="function"&&aplicarHash()){try{localStorage.setItem("pp-tab","conhecimento")}catch(_){}render()}else irPara("conhecimento")};
function renderFerramentas(){
  const v=$("#view-ferramentas");v.replaceChildren();v.classList.add("np-v3","np-ferr");
  if(F.sub==="kb"){
    const areas=AREAS_KB.filter(([a])=>podeAreaKB(a));
    v.append(el("div",{class:"np-ferr-h"},el("button",{type:"button",class:"lnk",onclick:()=>{F.sub="";render()}},"← Ferramentas"),el("h1",{},"Base de conhecimento"),el("p",{},"Escolha a área para abrir a base correspondente.")),
      el("div",{class:"np-ferr-g"},...areas.map(([a,l])=>quadro(IC.area,l,a==="marketing"?"Inclui pautas e transcrições de reuniões":null,()=>irKB(a)))));
    return}
  const itens=FERR.filter(([t])=>podeTab(t));
  v.append(el("div",{class:"np-ferr-h"},el("h1",{},"Ferramentas"),el("p",{},"Escolha a ferramenta que você quer abrir.")),
    itens.length?el("div",{class:"np-ferr-g"},...itens.map(([t,l,s])=>quadro(IC[t],l,s,()=>{if(t==="conhecimento"){F.sub="kb";render()}else irPara(t)}))):NPUI.vazio({titulo:"Nenhuma ferramenta liberada",texto:"Seu perfil não tem acesso a nenhuma ferramenta. Peça a liberação à gestão."}));
}
window.PP_FERRAMENTAS={tabs:FERR.map(x=>x[0]),abrir(sub){F.sub=sub||"";irPara("ferramentas")}};
{const _r=render;render=function(){_r();const v=$("#view-ferramentas");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="ferramentas")S.tab="clientes";v.hidden=S.tab!=="ferramentas";if(S.tab==="ferramentas")renderFerramentas();else F.sub=""}}
})();
