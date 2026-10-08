/* Autenticador — códigos 2FA (TOTP) sempre visíveis, trocando a cada período, como no celular.
   O segredo nunca chega ao navegador: o banco devolve uma janela de códigos (atual + próximos) via rpc totp_janela,
   e a tela avança sozinha; quando a janela acaba, pede outra. Tela "Autenticador" (Jurídico) lista todos os acessos com 2FA
   da carteira (v_autenticador); a ficha do cliente usa o mesmo widget. Só equipe. */
(()=>{
"use strict";
const A={lista:[],ok:false,carregando:false,busca:""};
const JANELA=10;

/* widget vivo: código grande + barra de tempo; refaz a janela quando acaba */
function widget(acessoId,{compacto=false}={}){
  const code=el("span",{class:"num totp-code"},"······");const bar=el("div",{class:"totp-bar"},el("div",{class:"totp-fill"}));const rest=el("span",{class:"totp-rest"},"");
  const box=el("div",{class:"totp"+(compacto?" sm":""),title:"Clique para copiar"},code,el("div",{class:"totp-meta"},bar,rest));
  let j=null,timer=null,vivo=true,atual="";
  const copiar=async()=>{if(!atual)return;try{await navigator.clipboard.writeText(atual);toast("Código copiado")}catch{}};box.onclick=copiar;
  async function pedir(){
    const {data,error}=await SB.rpc("totp_janela",{acesso_id:acessoId,qtd:JANELA});
    if(error||!data?.length){code.textContent="erro";rest.textContent=error?.message?.includes("não cadastrado")?"2FA não cadastrado":"indisponível";return false}
    j=data[0];return true;
  }
  function tick(){
    if(!vivo||!j)return;
    const now=Date.now()/1000;const idx=Math.floor((now-j.inicio)/j.periodo);const restam=j.periodo-((now-j.inicio)%j.periodo);
    if(idx<0||idx>=j.codigos.length){j=null;pedir().then(ok=>{if(ok)tick()});return}
    atual=j.codigos[idx];code.textContent=atual.replace(/(\d{3})(?=\d)/g,"$1 ");rest.textContent=Math.ceil(restam)+"s";
    bar.firstChild.style.width=(restam/j.periodo*100).toFixed(1)+"%";bar.firstChild.classList.toggle("warn",restam<=5);
  }
  pedir().then(ok=>{if(ok){tick();timer=setInterval(tick,1000)}});
  // para o relógio quando o elemento sai da tela
  const mo=new MutationObserver(()=>{if(!document.body.contains(box)){vivo=false;clearInterval(timer);mo.disconnect()}});mo.observe(document.body,{childList:true,subtree:true});
  return box;
}

async function carregar(){
  if(A.carregando)return;A.carregando=true;
  try{const {data,error}=await SB.from("v_autenticador").select("*").order("cliente_nome").order("sistema");if(error)throw error;A.lista=data||[];A.ok=true}
  catch(e){console.warn("autenticador",e);toast("Não foi possível carregar o autenticador")}
  finally{A.carregando=false}
  render();
}
const garantir=()=>{if(!A.ok&&!A.carregando)carregar();return A.ok};
const norm=s=>(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();

function renderAutenticador(){
  const v=$("#view-autenticador");v.replaceChildren();
  const ok=garantir();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Autenticador"),el("div",{class:"sub"},"Códigos 2FA dos acessos dos clientes, trocando a cada 30 segundos — como no celular, para a equipe toda. Para cadastrar ou remover um 2FA, use a ficha do cliente › Acessos a sistemas. Cada consulta fica registrada.")),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>{A.ok=false;carregar()}},"Atualizar lista"))));
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  if(!A.lista.length){v.append(el("div",{class:"card empty"},el("h3",{},"Nenhum 2FA cadastrado"),el("div",{},"Na ficha do cliente, em Acessos a sistemas, clique em “Configurar 2FA” e leia o QR ou cole a chave do sistema.")));return}
  const q=inp("search",A.busca,{placeholder:"Cliente, sistema, login…",id:"aut-q"});q.oninput=()=>{A.busca=q.value;render();const n=$("#aut-q");if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}};
  v.append(el("div",{class:"card",style:"padding:12px"},q));
  const nq=norm(A.busca.trim());const itens=A.lista.filter(x=>!nq||norm([x.cliente_nome,x.sistema,x.login,x.titular,x.totp_emissor].join(" ")).includes(nq));
  const grid=el("div",{class:"totp-grid"});
  for(const x of itens){
    grid.append(el("div",{class:"card totp-card"},
      el("div",{class:"totp-head"},el("div",{},el("div",{class:"n"},x.sistema,x.totp_emissor&&x.totp_emissor!==x.sistema?el("span",{class:"note"}," · "+x.totp_emissor):null),el("div",{class:"s"},x.cliente_nome),el("div",{class:"s num"},[x.titular,x.login].filter(Boolean).join(" · "))),
        el("a",{class:"btn sm",href:"#clientes/"+encodeURIComponent(x.cliente_id)+"/resumo",onclick:e=>{e.preventDefault();S.tab="clientes";S.sel=x.cliente_id;S.sub="resumo";render()}},"Ficha")),
      widget(x.id)));
  }
  if(!itens.length)grid.append(el("div",{class:"card empty"},"Nada encontrado."));
  v.append(grid);
}

const CSS=`.totp{display:inline-flex;flex-direction:column;gap:4px;cursor:pointer;user-select:none;min-width:150px}.totp .totp-code{font-size:26px;font-weight:700;letter-spacing:.08em;line-height:1.1;color:var(--ink,var(--text))}.totp.sm .totp-code{font-size:19px}.totp-meta{display:flex;align-items:center;gap:8px}.totp-bar{flex:1;height:5px;border-radius:3px;background:var(--line);overflow:hidden}.totp-fill{height:100%;background:var(--gold,#B8964A);transition:width 1s linear}.totp-fill.warn{background:var(--crit,#b4452f)}.totp-rest{font-size:11.5px;color:var(--muted);min-width:28px;text-align:right;font-variant-numeric:tabular-nums}.totp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:14px}.totp-card{padding:14px 16px;display:flex;flex-direction:column;gap:12px}.totp-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.totp-head .n{font-weight:700}.totp-head .s{font-size:12.5px;color:var(--muted)}`;
document.head.append(el("style",{},CSS));

window.PP_TOTP={widget,invalidar(){A.ok=false}};
{const _r=render;render=function(){_r();const va=$("#view-autenticador");if(!va)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="autenticador")S.tab="clientes";va.hidden=S.tab!=="autenticador";if(S.tab==="autenticador")renderAutenticador()}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("autenticador");ch.on("postgres_changes",{event:"*",schema:"public",table:"acessos_sistemas"},()=>{A.ok=false;if(S.tab==="autenticador")garantir()});ch.subscribe()}});
})();
