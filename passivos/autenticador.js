/* Autenticador — contas do escritório (tribunais, Receita, bancos… no nome da advogada) com códigos 2FA (TOTP) sempre visíveis,
   trocando a cada período como no celular, mais os acessos de clientes que tenham 2FA. Importa direto do Google Authenticator
   (QR de "Transferir contas", formato otpauth-migration) ou de um QR/chave individual.
   O segredo nunca chega ao navegador: rpc totp_janela devolve atual + próximos códigos; a tela avança sozinha.
   Supabase: acessos_sistemas (cliente_id nulo = escritório), v_contas_escritorio, v_autenticador, rpcs do cofre (0020/0021). Só equipe. */
(()=>{
"use strict";
const A={contas:[],clientes:[],ok:false,carregando:false,busca:""};
const JANELA=10;
const GRUPOS=["Tribunais","Receita / gov","Bancos","Cartórios","Outros"];
const norm=s=>(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();

/* ---------- widget vivo ---------- */
function widget(acessoId,{compacto=false}={}){
  const code=el("span",{class:"num totp-code"},"······");
  const R=compacto?11:15,C=2*Math.PI*R;const ring=el("div",{class:"totp-ring"});ring.innerHTML=`<svg viewBox="0 0 ${R*2+6} ${R*2+6}"><circle class="bg" cx="${R+3}" cy="${R+3}" r="${R}"/><circle class="fg" cx="${R+3}" cy="${R+3}" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><span class="s"></span>`;
  const fg=ring.querySelector(".fg"),rest=ring.querySelector(".s");
  let j=null,timer=null,vivo=true,atual="";
  const copiar=async(e)=>{e&&e.stopPropagation();if(!atual)return;try{await navigator.clipboard.writeText(atual);toast("Código copiado");btn.classList.add("ok");setTimeout(()=>btn.classList.remove("ok"),1200)}catch{toast("Não foi possível copiar")}};
  const btn=el("button",{class:"btn totp-copy",title:"Copiar código",onclick:copiar},el("span",{class:"ic"},"⧉"),el("span",{class:"tx"},"Copiar"));
  const box=el("div",{class:"totp"+(compacto?" sm":""),title:"Clique para copiar"},code,ring,btn);box.onclick=copiar;
  async function pedir(){const {data,error}=await SB.rpc("totp_janela",{acesso_id:acessoId,qtd:JANELA});if(error||!data?.length){code.textContent="—";rest.textContent="";ring.title=error?.message?.includes("não cadastrado")?"sem 2FA":"indisponível";return false}j=data[0];return true}
  function tick(){
    if(!vivo||!j)return;const now=Date.now()/1000;const idx=Math.floor((now-j.inicio)/j.periodo);const restam=j.periodo-((now-j.inicio)%j.periodo);
    if(idx<0||idx>=j.codigos.length){j=null;pedir().then(ok=>{if(ok)tick()});return}
    atual=j.codigos[idx];code.textContent=atual.replace(/(\d{3})(?=\d)/g,"$1 ");rest.textContent=Math.ceil(restam);
    fg.style.strokeDashoffset=(C*(1-restam/j.periodo)).toFixed(2);ring.classList.toggle("warn",restam<=5);
  }
  pedir().then(ok=>{if(ok){tick();timer=setInterval(tick,1000)}});
  const mo=new MutationObserver(()=>{if(!document.body.contains(box)){vivo=false;clearInterval(timer);mo.disconnect()}});mo.observe(document.body,{childList:true,subtree:true});
  return box;
}

/* ---------- senha (cofre) ---------- */
function celSenha(x){
  if(!x.tem_senha)return el("span",{class:"note"},"—");
  const sp=el("span",{class:"num"},"••••••••");let on=false,cache=null;
  const pegar=async(motivo)=>{if(cache)return cache;const {data,error}=await SB.rpc("acesso_senha",{acesso_id:x.id,motivo});if(error)throw error;cache=data;return data};
  const bt=el("button",{class:"btn sm",onclick:async()=>{try{if(!on){sp.textContent=await pegar("ver_senha")||"—"}else sp.textContent="••••••••";on=!on;bt.textContent=on?"Ocultar":"Mostrar"}catch(e){toast("Não foi possível obter a senha")}}},"Mostrar");
  const cp=el("button",{class:"btn sm",onclick:async()=>{try{await navigator.clipboard.writeText(await pegar("copiar_senha")||"");toast("Senha copiada")}catch{toast("Não foi possível copiar")}}},"Copiar");
  return el("div",{style:"display:flex;gap:6px;align-items:center"},sp,bt,cp);
}

/* ---------- QR ---------- */
const carregarJsQR=()=>new Promise((res,rej)=>{if(window.jsQR)return res();const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";sc.onload=res;sc.onerror=rej;document.head.append(sc)});
async function lerQrImagem(file){
  await carregarJsQR();const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});
    for(const esc of [1,2,0.5,3]){const cv=document.createElement("canvas");cv.width=Math.round(img.width*esc);cv.height=Math.round(img.height*esc);const ctx=cv.getContext("2d");ctx.drawImage(img,0,0,cv.width,cv.height);const d=ctx.getImageData(0,0,cv.width,cv.height);const q=window.jsQR(d.data,d.width,d.height);if(q?.data)return q.data}
    return null}finally{URL.revokeObjectURL(url)}
}
/* leitor: campo de texto + imagem + câmera; onLido(texto) é chamado a cada QR lido */
function leitorQr(onLido,{placeholder}={}){
  const seg=el("textarea",{rows:"3",placeholder:placeholder||"Cole a chave manual ou a URI otpauth://…",autocomplete:"off",spellcheck:"false"});
  const st=el("div",{class:"note"});
  const arq=inp("file","",{accept:"image/*",multiple:""});arq.onchange=async()=>{const fs=[...(arq.files||[])];if(!fs.length)return;st.textContent="Lendo QR…";let n=0;for(const f of fs){try{const r=await lerQrImagem(f);if(r){n++;onLido(r)}}catch(_){}}st.textContent=n?`${n} QR lido(s).`:"Não encontrei QR nas imagens."};
  let stream=null,raf=null;const video=el("video",{style:"width:100%;max-height:260px;border-radius:8px;background:#000;display:none",playsinline:"",muted:""});
  const parar=()=>{if(raf)cancelAnimationFrame(raf);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.style.display="none";cam.textContent="Ler com a câmera"};
  const cam=el("button",{class:"btn sm",onclick:async()=>{if(stream){parar();return}try{await carregarJsQR();stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});video.srcObject=stream;video.style.display="block";await video.play();cam.textContent="Parar câmera";
      const cv=document.createElement("canvas");const ctx=cv.getContext("2d",{willReadFrequently:true});let ultimo="";
      const tick=()=>{if(!stream)return;if(video.readyState===4){cv.width=video.videoWidth;cv.height=video.videoHeight;ctx.drawImage(video,0,0);const d=ctx.getImageData(0,0,cv.width,cv.height);const q=window.jsQR(d.data,d.width,d.height);if(q?.data&&q.data!==ultimo){ultimo=q.data;st.textContent="QR lido.";onLido(q.data);parar();return}}raf=requestAnimationFrame(tick)};tick();
    }catch(e){st.textContent="Câmera indisponível neste dispositivo/navegador. Use a chave manual ou uma imagem do QR."}}},"Ler com a câmera");
  seg.onchange=()=>{if(seg.value.trim())onLido(seg.value.trim())};
  const wrap=el("div",{class:"f full"},el("label",{},"Chave, URI ou QR"),seg,el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px"},el("label",{class:"btn sm",style:"cursor:pointer"},"Ler QR de imagem",Object.assign(arq,{style:"display:none"})),cam),video,st);
  return {wrap,seg,st,parar};
}

/* ---------- Google Authenticator (otpauth-migration://offline?data=…) ---------- */
function varint(b,p){let r=0n,s=0n,i=p;for(;;){const x=b[i++];r|=BigInt(x&127)<<s;if(!(x&128))break;s+=7n}return [r,i]}
function campos(b){const out=[];let p=0;while(p<b.length){let [k,np]=varint(b,p);p=np;const f=Number(k>>3n),t=Number(k&7n);if(t===0){const [v,q]=varint(b,p);p=q;out.push([f,v])}else if(t===2){const [l,q]=varint(b,p);p=q;out.push([f,b.slice(p,p+Number(l))]);p+=Number(l)}else if(t===5){p+=4}else if(t===1){p+=8}else break}return out}
function base32(bytes){const alf="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,v=0,s="";for(const x of bytes){v=(v<<8)|x;bits+=8;while(bits>=5){s+=alf[(v>>(bits-5))&31];bits-=5}}if(bits>0)s+=alf[(v<<(5-bits))&31];return s}
function decodificarMigracao(uri){
  const m=/[?&]data=([^&]+)/.exec(uri);if(!m)return [];
  const raw=atob(decodeURIComponent(m[1]).replace(/ /g,"+"));const b=Uint8Array.from(raw,c=>c.charCodeAt(0));const td=new TextDecoder();
  const contas=[];
  for(const [f,v] of campos(b)){if(f!==1||!(v instanceof Uint8Array))continue;
    const o={secret:"",name:"",issuer:"",alg:"sha1",digits:6,type:2};
    for(const [g,w] of campos(v)){if(g===1)o.secret=base32(w);else if(g===2)o.name=limpo(td.decode(w));else if(g===3)o.issuer=limpo(td.decode(w));else if(g===4)o.alg=({1:"sha1",2:"sha256",3:"sha512"})[Number(w)]||"sha1";else if(g===5)o.digits=Number(w)===2?8:6;else if(g===6)o.type=Number(w)}
    contas.push(o)}
  return contas;
}
const limpo=t=>{try{return decodeURIComponent((t||"").replace(/\+/g," "))}catch(_){return t||""}};
const uriDe=o=>`otpauth://totp/${encodeURIComponent(o.issuer?o.issuer+":"+o.name:o.name)}?secret=${o.secret}&digits=${o.digits}&algorithm=${o.alg.toUpperCase()}${o.issuer?"&issuer="+encodeURIComponent(o.issuer):""}`;

/* ---------- formulários ---------- */
function form2fa(x,onDone){
  const L=leitorQr(v=>{L.seg.value=v;L.st.textContent="Lido. Confira e salve."});
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`${x.sistema}${x.login?" · "+x.login:""}. No sistema, ative a verificação em duas etapas por aplicativo autenticador e use a chave/QR aqui — o painel passa a gerar os códigos para a equipe. Dica: mantenha o mesmo segredo no celular como reserva.`),L.wrap);
  const extra=x.tem_2fa&&PP.perfil?.papel==="admin"?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Remover o 2FA desta conta?"))return;const {error}=await SB.rpc("totp_remover",{acesso_id:x.id});if(error){toast("Não foi possível remover");return}L.parar();$("#modalHost").replaceChildren();toast("2FA removido");onDone&&onDone()}},"Remover 2FA"):null;
  modal(x.tem_2fa?"Substituir 2FA":"Configurar 2FA",body,async()=>{
    const v=L.seg.value.trim();if(!v)throw new Error("Cole a chave ou leia o QR");
    if(v.startsWith("otpauth-migration://"))throw new Error("Esse é o QR de exportação do Google Authenticator — use “Importar do Google Authenticator”.");
    const {error}=await SB.rpc("totp_cadastrar",{acesso_id:x.id,segredo:v});if(error)throw new Error(error.message||"Segredo inválido");
    L.parar();toast("2FA cadastrado");onDone&&onDone();
  },extra);
  const ob=new MutationObserver(()=>{if(!document.body.contains(body)){L.parar();ob.disconnect()}});ob.observe($("#modalHost"),{childList:true});
}
function formConta(x={}){
  const sis=inp("text",x.sistema||"",{placeholder:"ex.: TJSP e-SAJ, PJe TRF3, e-CAC"}),grp=inp("text",x.grupo||"",{list:"aut-grupos",placeholder:"Tribunais, Receita / gov, Bancos…"}),dl=el("datalist",{id:"aut-grupos"},[...new Set([...GRUPOS,...A.contas.map(c=>c.grupo).filter(Boolean)])].map(g=>el("option",{value:g}))),
    tit=inp("text",x.titular||"",{placeholder:"Quem é o titular (ex.: Dra. Maria Júlia)"}),login=inp("text",x.login||"",{autocomplete:"off"}),senha=inp("password","",{autocomplete:"new-password",placeholder:x.tem_senha?"•••••••• (deixe em branco para manter)":"opcional"}),obs=el("textarea",{placeholder:"Observações (certificado? perfil? link de acesso?)"},x.observacoes||"");
  const body=el("div",{class:"form"},field("ct-sis","Sistema",sis),el("div",{class:"f"},el("label",{for:"ct-grp"},"Grupo"),el("div",{},Object.assign(grp,{id:"ct-grp"}),dl)),field("ct-tit","Titular",tit),field("ct-login","Login",login),field("ct-senha","Senha",senha,x.tem_senha?"Guardada no cofre. Para trocar, digite a nova; para apagar, digite \"apagar\".":"Vai para o cofre criptografado."),field("ct-obs","Observações",obs));
  const extra=x.id&&PP.perfil?.papel==="admin"?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta conta (e o 2FA dela)?"))return;if(x.tem_2fa){await SB.rpc("totp_remover",{acesso_id:x.id})}await SB.from("acessos_sistemas").delete().eq("id",x.id);$("#modalHost").replaceChildren();toast("Conta excluída");A.ok=false;carregar()}},"Excluir"):null;
  modal(x.id?"Editar conta":"Nova conta do escritório",body,async()=>{
    if(!sis.value.trim())throw new Error("Informe o sistema");
    const row={cliente_id:null,sistema:sis.value.trim(),grupo:grp.value.trim()||null,titular:tit.value.trim()||null,login:login.value.trim()||null,observacoes:obs.value.trim()||null};
    let id=x.id;if(id){const {error}=await SB.from("acessos_sistemas").update(row).eq("id",id);if(error)throw error}else{const {data,error}=await SB.from("acessos_sistemas").insert(row).select("id").single();if(error)throw error;id=data.id}
    const sv=senha.value;if(sv){const {error}=await SB.rpc("acesso_senha_definir",{acesso_id:id,senha:sv.trim().toLowerCase()==="apagar"?"":sv});if(error)throw error}
    toast("Conta salva");A.ok=false;await carregar();
    if(!x.id&&!x.tem_2fa){const nova=A.contas.find(c=>c.id===id)||{id,sistema:row.sistema,login:row.login};setTimeout(()=>form2fa(nova,()=>{A.ok=false;carregar()}),50)}
  },extra);
}
function importarGoogle(){
  let contas=[];const lista=el("div",{class:"card list"});const grp=inp("text","Tribunais",{list:"aut-grupos2",placeholder:"Grupo para todas"}),dl=el("datalist",{id:"aut-grupos2"},GRUPOS.map(g=>el("option",{value:g})));
  const existentes=new Set(A.contas.map(c=>norm(c.sistema+"|"+(c.login||""))));
  const render=()=>{lista.replaceChildren();if(!contas.length){lista.append(el("div",{class:"empty"},"Nenhuma conta lida ainda."));return}
    for(const c of contas){const dup=existentes.has(norm((c.issuer||c.name)+"|"+c.name));lista.append(el("label",{class:"row",style:"display:flex;gap:10px;align-items:center;cursor:pointer"},Object.assign(inp("checkbox",""),{checked:c.sel,onchange:e=>{c.sel=e.target.checked}}),el("div",{},el("div",{class:"n"},c.issuer||c.name),el("div",{class:"s"},[c.name,c.type!==2?"HOTP (não suportado)":null,dup?"já existe":null,c.alg!=="sha1"?c.alg:null,c.digits!==6?c.digits+" dígitos":null].filter(Boolean).join(" · ")))))}};
  const L=leitorQr(v=>{if(!v.startsWith("otpauth-migration://")){if(v.startsWith("otpauth://")){L.st.textContent="Esse é um QR de conta única — use “+ Conta” e depois Configurar 2FA.";return}L.st.textContent="Não é um QR de exportação do Google Authenticator.";return}
    const novas=decodificarMigracao(v).map(c=>({...c,sel:c.type===2}));if(!novas.length){L.st.textContent="Não consegui ler contas desse QR.";return}
    for(const n of novas)if(!contas.some(c=>c.secret===n.secret))contas.push(n);L.st.textContent=`${contas.length} conta(s) lida(s). Se a exportação tiver mais de um QR, leia os demais.`;render()},{placeholder:"otpauth-migration://offline?data=… (cole aqui ou leia o QR de “Transferir contas”)"});
  render();
  const body=el("div",{class:"form"},el("div",{class:"f full note"},"No Google Authenticator: menu ⋮ › Transferir contas › Exportar contas › selecione as contas › aparece um QR (ou vários). Tire um print de cada QR ou aponte a câmera. Nada sai do seu celular além do que você escolher aqui."),L.wrap,el("div",{class:"f"},el("label",{},"Grupo"),el("div",{},grp,dl)),el("div",{class:"f full"},el("label",{},"Contas encontradas"),lista));
  modal("Importar do Google Authenticator",body,async()=>{
    const sel=contas.filter(c=>c.sel&&c.type===2);if(!sel.length)throw new Error("Selecione ao menos uma conta");
    let ok=0,falhas=[];
    for(const c of sel){try{
      const {data,error}=await SB.from("acessos_sistemas").insert({cliente_id:null,sistema:c.issuer||c.name,grupo:grp.value.trim()||null,login:c.name||null,titular:null,observacoes:"importado do Google Authenticator"}).select("id").single();if(error)throw error;
      const r=await SB.rpc("totp_cadastrar",{acesso_id:data.id,segredo:uriDe(c)});if(r.error)throw r.error;ok++}catch(e){falhas.push((c.issuer||c.name)+": "+(e.message||"erro"))}}
    L.parar();toast(`${ok} conta(s) importada(s)`+(falhas.length?` · ${falhas.length} falha(s)`:""));if(falhas.length)console.warn(falhas);A.ok=false;await carregar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Importar selecionadas";
  const ob=new MutationObserver(()=>{if(!document.body.contains(body)){L.parar();ob.disconnect()}});ob.observe($("#modalHost"),{childList:true});
}

/* ---------- dados e tela ---------- */
async function carregar(){
  if(A.carregando)return;A.carregando=true;
  try{const [c,a]=await Promise.all([SB.from("v_contas_escritorio").select("*").order("grupo").order("sistema"),SB.from("v_autenticador").select("*").not("cliente_id","is",null).order("cliente_nome").order("sistema")]);if(c.error)throw c.error;if(a.error)throw a.error;A.contas=c.data||[];A.clientes=a.data||[];A.ok=true}
  catch(e){console.warn("autenticador",e);toast("Não foi possível carregar o autenticador")}
  finally{A.carregando=false}
  render();
}
const garantir=()=>{if(!A.ok&&!A.carregando)carregar();return A.ok};

const OBS_IMPORT="importado do Google Authenticator";
function cardConta(x,{cliente=false}={}){
  const obs=x.observacoes&&x.observacoes!==OBS_IMPORT?x.observacoes:null;
  return el("div",{class:"card totp-row"},
    el("div",{class:"totp-info"},el("div",{class:"n"},limpo(x.sistema),x.totp_emissor&&norm(limpo(x.totp_emissor))!==norm(limpo(x.sistema))?el("span",{class:"note"}," · "+limpo(x.totp_emissor)):null),
      el("div",{class:"s"},[cliente?x.cliente_nome:x.titular,limpo(x.login)].filter(Boolean).join(" · ")),obs?el("div",{class:"s",style:"white-space:normal"},obs):null,
      x.tem_senha?el("div",{class:"s",style:"display:flex;gap:6px;align-items:center;margin-top:4px"},"Senha:",celSenha(x)):null),
    x.tem_2fa?widget(x.id):el("div",{class:"note"},"Sem 2FA cadastrado."),
    el("div",{class:"actions totp-acoes"},cliente?el("button",{class:"btn sm",onclick:()=>{S.tab="clientes";S.sel=x.cliente_id;S.sub="resumo";render()}},"Ficha"):el("button",{class:"btn sm edit-only",title:"Editar conta",onclick:()=>formConta(x)},"Editar"),!cliente?el("button",{class:"btn sm edit-only",title:x.tem_2fa?"Substituir ou remover 2FA":"Configurar 2FA",onclick:()=>form2fa(x,()=>{A.ok=false;carregar()})},x.tem_2fa?"⚙":"Configurar 2FA"):null));
}
function renderAutenticador(){
  const v=$("#view-autenticador");v.replaceChildren();
  const ok=garantir();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Autenticador"),el("div",{class:"sub"},"Contas do escritório (tribunais, Receita, bancos — no nome da advogada) com os códigos 2FA sempre visíveis, trocando a cada 30 segundos. Importe tudo de uma vez do Google Authenticator. Senhas e segredos ficam no cofre; cada consulta é registrada.")),
    el("div",{class:"actions edit-only"},el("button",{class:"btn sm",onclick:importarGoogle},"Importar do Google Authenticator"),el("button",{class:"btn sm primary",onclick:()=>formConta()},"+ Conta"))));
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  const q=inp("search",A.busca,{placeholder:"Sistema, grupo, login, cliente…",id:"aut-q"});q.oninput=()=>{A.busca=q.value;render();const n=$("#aut-q");if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}};
  v.append(el("div",{class:"card",style:"padding:12px"},q));
  const nq=norm(A.busca.trim());const f=x=>!nq||norm([x.sistema,x.grupo,x.login,x.titular,x.totp_emissor,x.cliente_nome,x.observacoes].join(" ")).includes(nq);
  const contas=A.contas.filter(f);
  if(!A.contas.length)v.append(el("div",{class:"card empty",style:"margin-top:14px"},el("h3",{},"Nenhuma conta do escritório ainda"),el("div",{},"Use “Importar do Google Authenticator” para trazer todas as contas de uma vez, ou “+ Conta” para cadastrar uma a uma.")));
  const grupos=[...new Set(contas.map(c=>c.grupo||"Sem grupo"))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
  for(const g of grupos){
    v.append(el("h2",{style:"margin:18px 0 8px;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)"},g,el("span",{class:"cnt",style:"margin-left:8px"},String(contas.filter(c=>(c.grupo||"Sem grupo")===g).length))));
    v.append(el("div",{class:"totp-lista"},contas.filter(c=>(c.grupo||"Sem grupo")===g).map(c=>cardConta(c))));
  }
  const cli=A.clientes.filter(f);
  if(cli.length){v.append(el("h2",{style:"margin:22px 0 8px;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)"},"Acessos de clientes com 2FA",el("span",{class:"cnt",style:"margin-left:8px"},String(cli.length))));
    v.append(el("div",{class:"totp-lista"},cli.map(c=>cardConta(c,{cliente:true}))))}
  if(nq&&!contas.length&&!cli.length)v.append(el("div",{class:"card empty",style:"margin-top:14px"},"Nada encontrado."));
}

const CSS=`.totp{display:inline-flex;align-items:center;gap:14px;cursor:pointer;user-select:none}.totp .totp-code{font-size:28px;font-weight:700;letter-spacing:.1em;line-height:1;color:var(--ink,var(--text));font-variant-numeric:tabular-nums}.totp.sm{gap:10px}.totp.sm .totp-code{font-size:20px}
.totp-ring{position:relative;width:40px;height:40px;flex:none}.totp.sm .totp-ring{width:32px;height:32px}.totp-ring svg{width:100%;height:100%;transform:rotate(-90deg)}.totp-ring circle{fill:none;stroke-width:3}.totp-ring .bg{stroke:var(--line)}.totp-ring .fg{stroke:var(--gold,#B8964A);transition:stroke-dashoffset 1s linear;stroke-linecap:round}.totp-ring.warn .fg{stroke:var(--crit,#b4452f)}.totp-ring .s{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.totp.sm .totp-ring .s{font-size:10px}
.totp-copy{display:inline-flex;align-items:center;gap:6px;padding:6px 10px}.totp-copy .ic{font-size:15px;line-height:1}.totp-copy.ok{background:var(--gold-soft);border-color:var(--gold)}.totp.sm .totp-copy .tx{display:none}.totp.sm .totp-copy{padding:4px 7px}
.totp-lista{display:flex;flex-direction:column;gap:8px}.totp-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:16px;align-items:center;padding:12px 16px}.totp-info{min-width:0}.totp-info .n{font-weight:700;overflow-wrap:anywhere}.totp-info .s{font-size:12.5px;color:var(--muted)}.totp-acoes{flex-wrap:nowrap}
@media (max-width:860px){.totp-row{grid-template-columns:1fr;gap:10px}.totp .totp-code{font-size:24px}}`;
document.head.append(el("style",{},CSS));

window.PP_TOTP={widget,form2fa,celSenha,leitorQr,decodificarMigracao,invalidar(){A.ok=false}};
{const _r=render;render=function(){_r();const va=$("#view-autenticador");if(!va)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="autenticador")S.tab="clientes";va.hidden=S.tab!=="autenticador";if(S.tab==="autenticador")renderAutenticador()}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("autenticador");ch.on("postgres_changes",{event:"*",schema:"public",table:"acessos_sistemas"},()=>{A.ok=false;if(S.tab==="autenticador")garantir()});ch.subscribe()}});
})();
