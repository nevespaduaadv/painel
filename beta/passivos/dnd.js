/* Arrastar e soltar para kanbans (negociações, pautas…). HTML5 drag & drop no desktop e toque no celular.
   Uso: PP_DND.ativar(container,{card:".sel", coluna:".sel", chave:el=>key, aoSoltar:(cardEl, colKey)=>Promise}) */
(()=>{
"use strict";
function ativar(root,{card,coluna,chaveCol,chaveCard,aoSoltar,podeSoltar}){
  const cards=[...root.querySelectorAll(card)],cols=[...root.querySelectorAll(coluna)];
  let arrastando=null;
  const limpar=()=>{cols.forEach(c=>c.classList.remove("dnd-over","dnd-nao"));cards.forEach(c=>c.classList.remove("dnd-drag"))};
  for(const c of cards){
    c.setAttribute("draggable","true");
    c.addEventListener("dragstart",e=>{arrastando=c;c.classList.add("dnd-drag");e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",chaveCard(c))}catch(_){}});
    c.addEventListener("dragend",()=>{arrastando=null;limpar()});
    // toque: pressionar e arrastar
    let t0=null,ghost=null;
    c.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;t0=setTimeout(()=>{arrastando=c;c.classList.add("dnd-drag");ghost=c.cloneNode(true);ghost.className+=" dnd-ghost";document.body.append(ghost);const t=e.touches[0];move(t.clientX,t.clientY)},250)},{passive:true});
    const move=(x,y)=>{if(!ghost)return;ghost.style.left=(x-ghost.offsetWidth/2)+"px";ghost.style.top=(y-20)+"px";const alvo=document.elementFromPoint(x,y)?.closest(coluna);cols.forEach(k=>k.classList.toggle("dnd-over",k===alvo))};
    c.addEventListener("touchmove",e=>{if(!arrastando){clearTimeout(t0);return}e.preventDefault();const t=e.touches[0];move(t.clientX,t.clientY)},{passive:false});
    c.addEventListener("touchend",async e=>{clearTimeout(t0);if(!arrastando)return;const t=e.changedTouches[0];const alvo=document.elementFromPoint(t.clientX,t.clientY)?.closest(coluna);ghost?.remove();ghost=null;const el0=arrastando;arrastando=null;limpar();if(alvo&&alvo.contains(el0)===false)await soltar(el0,alvo)});
  }
  async function soltar(cardEl,colEl){
    const key=chaveCol(colEl);if(key==null)return;
    if(podeSoltar&&!podeSoltar(cardEl,key)){toast("Você não pode mover para esta coluna");return}
    cardEl.classList.add("dnd-salvando");
    try{await aoSoltar(cardEl,key)}finally{cardEl.classList.remove("dnd-salvando")}
  }
  for(const col of cols){
    col.addEventListener("dragover",e=>{if(!arrastando)return;e.preventDefault();e.dataTransfer.dropEffect="move";const ok=!podeSoltar||podeSoltar(arrastando,chaveCol(col));col.classList.toggle("dnd-over",ok);col.classList.toggle("dnd-nao",!ok)});
    col.addEventListener("dragleave",()=>col.classList.remove("dnd-over","dnd-nao"));
    col.addEventListener("drop",async e=>{e.preventDefault();const c=arrastando;limpar();if(!c||col.contains(c))return;await soltar(c,col)});
  }
}
document.head.append(el("style",{},`.dnd-drag{opacity:.45}.dnd-over{outline:2px dashed var(--gold);outline-offset:-2px;background:var(--gold-soft)!important}.dnd-nao{outline:2px dashed var(--crit);outline-offset:-2px}.dnd-salvando{opacity:.6;pointer-events:none}.dnd-ghost{position:fixed;z-index:9999;pointer-events:none;width:220px;opacity:.9;box-shadow:0 8px 24px rgba(0,0,0,.25)}[draggable=true]{cursor:grab}[draggable=true]:active{cursor:grabbing}`));
window.PP_DND={ativar};
})();
