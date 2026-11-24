/* Chat interno — botão no topo abre um painel lateral: canais por área (Geral, Jurídico, …), Sócias e conversas diretas.
   Tempo real (Supabase Realtime), não lidas no botão, @menções no sino (0061). Canal com ponte vai/vem do Discord. */
(()=>{
"use strict";
const C={aberto:false,canais:[],msgs:[],canal:null,ok:false,carregando:false,sub:null,subMsgs:null,pessoas:[]};
let btn,badge,panel;
const eq=()=>typeof equipe==="function"&&equipe();
const hm=iso=>new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
const dia=iso=>new Date(iso).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function fmtTexto(t){
  let h=esc(t);
  h=h.replace(/(https?:\/\/[^\s<]+)/g,u=>`<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  h=h.replace(/(^|\s)(#(?:clientes|tarefas|processos|leads|agenda|avisos)\/[\w-]+)/g,(m,p,l)=>`${p}<a href="${l}">${l}</a>`);
  h=h.replace(/@([\wÀ-ú]+)/g,'<b class="ch-men">@$1</b>');
  return h.replace(/\n/g,"<br>");
}
async function carregarCanais(){
  const {data}=await SB.from("v_chat_canais").select("*").order("ordem").order("ultima_em",{ascending:false,nullsFirst:false});
  C.canais=data||[];C.ok=true;atualizarBadge();if(C.aberto)renderLista();
}
function atualizarBadge(){const n=C.canais.reduce((s,c)=>s+(+c.nao_lidas||0),0);if(!badge)return;badge.textContent=n>99?"99+":String(n);badge.hidden=!n;if(btn)btn.title=n?`${n} mensagem(ns) não lida(s)`:"Chat da equipe"}
async function abrirCanal(id){
  C.canal=id;C.msgs=[];renderLista();renderMsgs();
  const {data}=await SB.from("chat_mensagens").select("*").eq("canal_id",id).eq("apagada",false).order("id",{ascending:false}).limit(80);
  C.msgs=(data||[]).reverse();renderMsgs(true);marcarLido();
}
async function marcarLido(){if(!C.canal)return;await SB.from("chat_leituras").upsert({canal_id:C.canal,perfil_id:PP.perfil.id,lida_ate:new Date().toISOString()},{onConflict:"canal_id,perfil_id"});const c=C.canais.find(x=>x.id===C.canal);if(c)c.nao_lidas=0;atualizarBadge();renderLista()}
async function enviar(texto){
  texto=texto.trim();if(!texto||!C.canal)return;
  const {error}=await SB.from("chat_mensagens").insert({canal_id:C.canal,autor_id:PP.perfil.id,texto});
  if(error)toast("Não foi possível enviar: "+(error.message||""));
}
async function novaDM(){
  if(!C.pessoas.length){const {data}=await SB.from("perfis").select("id,nome,email,papel").in("papel",["admin","colaborador"]).order("nome");C.pessoas=(data||[]).filter(p=>p.id!==PP.perfil.id)}
  const s=sel({"":"— pessoa —",...Object.fromEntries(C.pessoas.map(p=>[p.id,p.nome||p.email]))},"");
  const body=el("div",{class:"form"},field("ch-dm","Conversa direta com",s));
  modal("Nova conversa",body,async()=>{if(!s.value)throw new Error("Escolha a pessoa");const {data,error}=await SB.rpc("chat_dm",{p_outro:s.value});if(error)throw new Error(error.message);await carregarCanais();abrirCanal(data)});
}
function renderLista(){
  const l=panel?.querySelector(".ch-lista");if(!l)return;l.replaceChildren();
  const canais=C.canais.filter(c=>c.tipo==="canal"),dms=C.canais.filter(c=>c.tipo==="dm");
  const item=c=>el("button",{class:"ch-item"+(C.canal===c.id?" sel":""),onclick:()=>abrirCanal(c.id)},el("span",{class:"ch-nome"},(c.tipo==="canal"?"# ":"")+c.nome),c.nao_lidas>0?el("em",{class:"ch-nl"},String(c.nao_lidas)):null,c.discord_canal?el("span",{class:"ch-dc",title:"Espelhado no Discord"},"⇄"):null);
  l.append(el("div",{class:"ch-sec"},"Canais"),...canais.map(item),el("div",{class:"ch-sec"},"Conversas",el("button",{class:"btn sm",style:"margin-left:auto",onclick:novaDM},"+")),...(dms.length?dms.map(item):[el("div",{class:"note",style:"padding:4px 10px"},"Nenhuma conversa direta.")]));
}
function renderMsgs(scroll){
  const box=panel?.querySelector(".ch-msgs");if(!box)return;box.replaceChildren();
  const c=C.canais.find(x=>x.id===C.canal);panel.querySelector(".ch-titulo").textContent=c?(c.tipo==="canal"?"# ":"")+c.nome:"Escolha um canal";
  panel.querySelector(".ch-sub").textContent=c?.discord_canal?"Espelhado no Discord — o que você escreve aqui vai para lá, e o que escrevem lá chega aqui em até 1 min.":c?.tipo==="dm"?"Conversa direta — a pessoa recebe aviso no sino.":c?"Use @Nome para avisar alguém no sino; @todos avisa o canal.":"";
  if(!c){box.append(el("div",{class:"note",style:"padding:16px"},"Escolha um canal ou uma conversa à esquerda."));return}
  if(!C.msgs.length){box.append(el("div",{class:"note",style:"padding:16px"},"Sem mensagens ainda. Diga oi 👋"));return}
  let ultDia="";let ultAutor=null;
  for(const m of C.msgs){
    const d=dia(m.criado_em);if(d!==ultDia){box.append(el("div",{class:"ch-dia"},d));ultDia=d;ultAutor=null}
    const minha=m.autor_id===PP.perfil.id;const mesmo=ultAutor===(m.autor_id||m.autor_nome);
    const bolha=el("div",{class:"ch-m"+(minha?" minha":"")+(mesmo?" seq":"")},!mesmo?el("div",{class:"ch-a"},(m.autor_nome||"?")+(m.origem==="discord"?" · Discord":""),el("span",{class:"ch-h"},hm(m.criado_em))):null,el("div",{class:"ch-t",html:fmtTexto(m.texto)}),mesmo?el("span",{class:"ch-h ch-h2"},hm(m.criado_em)):null);
    box.append(bolha);ultAutor=m.autor_id||m.autor_nome;
  }
  if(scroll!==false)box.scrollTop=box.scrollHeight;
}
function montar(){
  const ub=document.querySelector("#userbox");if(!ub||btn||!eq())return;
  badge=el("span",{class:"ntf-badge",hidden:""});
  btn=el("button",{class:"ntf-btn",title:"Chat da equipe","aria-label":"Chat da equipe",onclick:e=>{e.stopPropagation();toggle()}},
    el("span",{html:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'}),badge);
  ub.insertBefore(el("div",{class:"ntf-wrap"},btn),ub.firstChild);
  const ta=el("textarea",{rows:"2",placeholder:"Escreva e pressione Enter (Shift+Enter quebra linha)"});
  ta.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();const t=ta.value;ta.value="";enviar(t)}};
  panel=el("aside",{class:"ch-panel",hidden:""},
    el("div",{class:"ch-head"},el("div",{},el("div",{class:"ch-titulo"},"Chat"),el("div",{class:"ch-sub note"},"")),el("button",{class:"btn sm",onclick:toggle},"✕")),
    el("div",{class:"ch-body"},el("div",{class:"ch-lista"}),el("div",{class:"ch-conv"},el("div",{class:"ch-msgs"}),el("div",{class:"ch-input"},ta,el("button",{class:"btn primary",onclick:()=>{const t=ta.value;ta.value="";enviar(t)}},"Enviar")))));
  document.body.append(panel);
  document.head.append(el("style",{},`
.ch-panel{position:fixed;top:56px;right:12px;width:min(760px,calc(100vw - 24px));height:min(560px,calc(100vh - 70px));background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);z-index:60;display:flex;flex-direction:column;overflow:hidden}
.ch-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}.ch-titulo{font-weight:600;font-size:15px}
.ch-body{display:grid;grid-template-columns:200px 1fr;flex:1;min-height:0}@media(max-width:640px){.ch-body{grid-template-columns:1fr}.ch-lista{display:none}}
.ch-lista{border-right:1px solid var(--line);overflow:auto;padding:6px;display:flex;flex-direction:column;gap:2px;background:var(--surface-2)}
.ch-sec{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:8px 10px 4px;display:flex;align-items:center}
.ch-item{display:flex;align-items:center;gap:6px;border:0;background:transparent;text-align:left;padding:7px 10px;border-radius:8px;font:inherit;font-size:13px;color:var(--fg);cursor:pointer}.ch-item:hover{background:var(--surface)}.ch-item.sel{background:var(--surface);font-weight:600}
.ch-nome{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ch-nl{background:var(--gold);color:#fff;border-radius:999px;font-size:10.5px;font-style:normal;padding:1px 6px}.ch-dc{color:var(--muted);font-size:12px}
.ch-conv{display:flex;flex-direction:column;min-height:0}.ch-msgs{flex:1;overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:2px}
.ch-dia{text-align:center;font-size:11px;color:var(--muted);margin:10px 0 6px}.ch-m{max-width:85%;padding:6px 10px;border-radius:10px;background:var(--surface-2);align-self:flex-start;margin-top:8px}.ch-m.seq{margin-top:2px}.ch-m.minha{align-self:flex-end;background:color-mix(in srgb,var(--gold) 18%,var(--surface))}
.ch-a{font-size:12px;font-weight:600;color:var(--muted);display:flex;gap:8px;align-items:baseline}.ch-h{font-size:10.5px;font-weight:400;color:var(--faint)}.ch-h2{display:block;text-align:right}.ch-t{font-size:13.5px;line-height:1.4;word-break:break-word}.ch-t a{color:var(--info)}.ch-men{color:var(--gold)}
.ch-input{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}.ch-input textarea{flex:1;font:inherit;font-size:13.5px;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface);color:var(--fg)}`));
  document.addEventListener("click",e=>{if(C.aberto&&panel&&!panel.contains(e.target)&&!btn.contains(e.target)&&!e.target.closest("#modalHost"))toggle(false)});
  carregarCanais();
  C.sub=SB.channel("chat-canais").on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_mensagens"},p=>{const m=p.new;if(m.canal_id===C.canal&&C.aberto){C.msgs.push(m);renderMsgs(true);marcarLido()}else{const c=C.canais.find(x=>x.id===m.canal_id);if(c&&m.autor_id!==PP.perfil.id){c.nao_lidas=(+c.nao_lidas||0)+1;atualizarBadge();if(C.aberto)renderLista()}}}).subscribe();
  setInterval(()=>{if(!C.aberto)carregarCanais()},120000);
}
function toggle(force){
  C.aberto=force===undefined?!C.aberto:force;panel.hidden=!C.aberto;
  if(C.aberto){carregarCanais().then(()=>{if(!C.canal){const g=C.canais.find(c=>c.chave==="geral")||C.canais[0];if(g)abrirCanal(g.id)}else{renderLista();abrirCanal(C.canal)}});panel.querySelector("textarea").focus()}
}
window.PP_CHAT={abrir(id){toggle(true);if(id)abrirCanal(id)}};
window.__PP_LOGIN?.then(()=>{if(eq())montar()});
// rota #chat/<id> (vinda do sino)
window.addEventListener("hashchange",()=>{const m=/^#chat\/([\w-]+)/.exec(location.hash||"");if(m&&eq()){window.PP_CHAT.abrir(m[1]);history.replaceState(null,"","#painel")}});
{const m=/^#chat\/([\w-]+)/.exec(location.hash||"");if(m)window.__PP_LOGIN?.then(()=>{setTimeout(()=>{window.PP_CHAT.abrir(m[1]);history.replaceState(null,"","#painel")},800)})}
})();
