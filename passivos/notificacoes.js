/* Sino de notificações — lê public.notificacoes (só as do usuário logado, por RLS), tempo real, marca como lida e abre o link.
   Montado no #userbox (cabeçalho). Depende de 0034. */
(()=>{
"use strict";
const N={lista:[],ok:false,aberto:false};
let btn=null,badge=null,pop=null;
const fmt=v=>{const d=new Date(v),h=(Date.now()-d)/36e5;if(h<1)return`${Math.max(1,Math.round(h*60))} min`;if(h<24)return`${Math.round(h)} h`;return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})};
async function carregar(){
  const {data,error}=await SB.from("notificacoes").select("*").order("criado_em",{ascending:false}).limit(30);
  if(error){console.warn("notificacoes",error);return}
  N.lista=data||[];N.ok=true;pintar();
}
function pintar(){
  if(!btn)return;
  const n=N.lista.filter(x=>!x.lida_em).length;
  badge.textContent=n>9?"9+":String(n);badge.hidden=!n;btn.title=n?`${n} notificação${n===1?"":"es"} não lida${n===1?"":"s"}`:"Notificações";
  if(pop&&N.aberto)renderPop();
}
async function marcar(ids){
  if(!ids.length)return;
  const agora=new Date().toISOString();
  N.lista.forEach(x=>{if(ids.includes(x.id))x.lida_em=x.lida_em||agora});pintar();
  await SB.from("notificacoes").update({lida_em:agora}).in("id",ids).is("lida_em",null);
}
function abrir(x){
  marcar([x.id]);fechar();
  if(!x.link)return;
  try{history.pushState(null,"",x.link)}catch(_){}
  if(typeof aplicarHash==="function"&&aplicarHash()){document.body.classList.remove("ro");render()}
}
function renderPop(){
  pop.replaceChildren();
  const naoLidas=N.lista.filter(x=>!x.lida_em).map(x=>x.id);
  pop.append(el("div",{class:"ntf-h"},el("b",{},"Notificações"),naoLidas.length?el("button",{class:"btn sm",onclick:()=>marcar(naoLidas)},"Marcar todas como lidas"):null));
  if(!N.lista.length){pop.append(el("div",{class:"ntf-vazio"},"Nada por aqui. Quando alguém abrir, passar ou concluir uma tarefa sua, aparece aqui."));return}
  pop.append(el("div",{class:"ntf-lista"},N.lista.map(x=>el("button",{class:"ntf-item"+(x.lida_em?"":" nova"),onclick:()=>abrir(x)},
    el("span",{class:"ntf-dot"}),el("span",{class:"ntf-txt"},el("b",{},x.titulo),el("span",{},x.texto||"")),el("span",{class:"ntf-q"},fmt(x.criado_em))))));
}
function fechar(){N.aberto=false;if(pop){pop.remove();pop=null}}
function toggle(e){
  e.stopPropagation();
  if(N.aberto){fechar();return}
  N.aberto=true;pop=el("div",{class:"ntf-pop",onclick:ev=>ev.stopPropagation()});renderPop();btn.parentElement.append(pop);
}
function montar(){
  const ub=document.querySelector("#userbox");if(!ub||btn)return;
  badge=el("span",{class:"ntf-badge",hidden:""});
  btn=el("button",{class:"ntf-btn",title:"Notificações","aria-label":"Notificações",onclick:toggle},
    el("span",{html:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'}),badge);
  const wrap=el("div",{class:"ntf-wrap"},btn);
  ub.insertBefore(wrap,ub.firstChild);
  document.addEventListener("click",fechar);
  const st=document.createElement("style");st.textContent=`
.ntf-wrap{position:relative}
.ntf-btn{position:relative;width:32px;height:32px;border-radius:999px;border:1px solid #3B5074;background:transparent;color:#D7D2C6;display:grid;place-items:center;cursor:pointer}
.ntf-btn:hover{background:rgba(255,255,255,.08)}
.ntf-badge{position:absolute;top:-5px;right:-6px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:var(--crit);color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center;border:2px solid var(--navy)}
.ntf-pop{position:absolute;right:0;top:calc(100% + 8px);width:min(380px,92vw);background:var(--surface);color:var(--fg);border:1px solid var(--line);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.28);z-index:40;overflow:hidden;font-size:13.5px}
.ntf-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.ntf-vazio{padding:18px 14px;color:var(--muted)}
.ntf-lista{max-height:min(60vh,420px);overflow:auto;display:flex;flex-direction:column}
.ntf-item{display:flex;gap:10px;align-items:flex-start;text-align:left;width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--fg);padding:10px 12px;cursor:pointer;font:inherit}
.ntf-item:hover{background:var(--surface-2)}
.ntf-item:last-child{border-bottom:0}
.ntf-dot{width:8px;height:8px;border-radius:50%;background:transparent;margin-top:6px;flex:none}
.ntf-item.nova .ntf-dot{background:var(--gold)}
.ntf-txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.ntf-txt b{font-weight:600}
.ntf-txt span{color:var(--muted);font-size:12.5px}
.ntf-q{color:var(--faint);font-size:11.5px;white-space:nowrap;margin-top:2px}`;
  document.head.append(st);
}
function tempoReal(){
  const ch=SB.channel("notificacoes");
  let t=null;
  ch.on("postgres_changes",{event:"*",schema:"public",table:"notificacoes"},()=>{clearTimeout(t);t=setTimeout(carregar,300)});
  ch.subscribe();
}
window.PP_NOTIF={montar,carregar,lista:()=>N.lista};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){montar();carregar();tempoReal()}});
})();
