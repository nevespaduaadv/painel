/* Marketing — pautas de conteúdo: calendário mensal, kanban por status e lista; fluxo de aprovação das sócias
   (Aprovar / Pedir ajuste), comentários, link do criativo e legenda. Supabase: pautas, pautas_comentarios, v_pautas,
   v_pautas_comentarios (0022). Só equipe; aprovação só admin (garantido no banco). */
(()=>{
"use strict";
const M={lista:[],colab:[],ok:false,carregando:false,visao:"calendario",mes:null,sel:null,coment:[],fStatus:"",fResp:"",busca:""};
const STATUS={ideia:"Ideia",em_aprovacao:"Em aprovação",ajustar:"Ajustar",aprovado:"Aprovado",em_producao:"Em produção",agendado:"Agendado",publicado:"Publicado",cancelado:"Cancelado"};
const COR={ideia:"#8a8f98",em_aprovacao:"#b8964a",ajustar:"#b4452f",aprovado:"#2e7d4f",em_producao:"#2f6fb3",agendado:"#6a4fb3",publicado:"#0c1f38",cancelado:"#aaa"};
const FORMATO={reels:"Reels",carrossel:"Carrossel",estatico:"Estático",story:"Story",artigo:"Artigo",email:"E-mail",video:"Vídeo",live:"Live",outro:"Outro"};
const ICONE={reels:"🎬",carrossel:"🖼️",estatico:"📷",story:"⏱️",artigo:"📝",email:"✉️",video:"📹",live:"🔴",outro:"📌"};
const CANAIS={instagram:"Instagram",linkedin:"LinkedIn",youtube:"YouTube",tiktok:"TikTok",blog:"Blog/site",whatsapp:"WhatsApp",email:"E-mail"};
const PILARES=["Autoridade","Educativo","Prova social","Bastidores","Oferta","Institucional","Notícia/radar"];
const OBJETIVOS=["Atração","Autoridade","Conversão","Relacionamento"];
const KANBAN=["ideia","em_aprovacao","ajustar","aprovado","em_producao","agendado","publicado"];
const admin=()=>PP.perfil?.papel==="admin";
const iso=d=>d.toISOString().slice(0,10);const parseD=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const fmt=s=>s?parseD(s).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}):"";
const fmtL=s=>s?parseD(s).toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"}):"sem data";
const meuColab=()=>M.colab.find(c=>c.perfil_id===PP.perfil?.id);
const pill=st=>el("span",{class:"pill",style:`background:${COR[st]}1a;color:${COR[st]};border:1px solid ${COR[st]}55`},STATUS[st]||st);

async function carregar(){
  if(M.carregando)return;M.carregando=true;
  try{const [p,c]=await Promise.all([SB.from("v_pautas").select("*").order("data_prevista",{ascending:true,nullsFirst:false}).order("ordem"),SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo").order("nome")]);if(p.error)throw p.error;M.lista=p.data||[];M.colab=c.data||[];M.ok=true}
  catch(e){console.warn("marketing",e);toast("Não foi possível carregar as pautas")}
  finally{M.carregando=false}
  render();
}
const garantir=()=>{if(!M.ok&&!M.carregando)carregar();return M.ok};
async function carregarComent(id){const {data}=await SB.from("v_pautas_comentarios").select("*").eq("pauta_id",id).order("created_at");M.coment=data||[];if(M.sel&&M.sel.id===id)renderDetalhe()}

/* ---------- tela ---------- */
function filtrados(){const q=(M.busca||"").toLowerCase();return M.lista.filter(p=>(!M.fStatus||p.status===M.fStatus)&&(!M.fResp||p.responsavel_id===M.fResp)&&(!q||[p.titulo,p.descricao,p.pilar,p.legenda].join(" ").toLowerCase().includes(q)))}
function renderMarketing(){
  const v=$("#view-marketing");v.replaceChildren();
  const ok=garantir();
  const aprov=M.lista.filter(p=>p.status==="em_aprovacao").length;
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Marketing"),el("h1",{},"Pautas de conteúdo"),el("div",{class:"sub"},"Ideias → aprovação das sócias → produção → agendamento → publicado. Calendário, kanban e lista.")),
    el("div",{class:"actions"},aprov&&admin()?el("button",{class:"btn sm",style:"border-color:var(--gold);color:var(--gold)",onclick:()=>{M.visao="kanban";M.fStatus="em_aprovacao";render()}},`${aprov} aguardando sua aprovação`):null,el("button",{class:"btn sm primary edit-only",onclick:()=>openPautaForm({})},"+ Pauta"))));
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  // barra: visão + filtros
  const tabs=el("div",{class:"tabs",style:"margin:0"},[["calendario","Calendário"],["kanban","Kanban"],["lista","Lista"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(M.visao===k),onclick:()=>{M.visao=k;render()}},l)));
  const fs=sel({"":"Todos os status",...STATUS},M.fStatus);fs.onchange=()=>{M.fStatus=fs.value;render()};
  const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(M.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},M.fResp);fr.onchange=()=>{M.fResp=fr.value;render()};
  const q=inp("search",M.busca,{placeholder:"Buscar pauta…",id:"mk-q"});q.oninput=()=>{M.busca=q.value;render();const n=$("#mk-q");if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}};
  v.append(el("div",{class:"card",style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 12px;margin-bottom:14px"},tabs,el("span",{style:"flex:1"}),fs,fr,q));
  if(M.visao==="calendario")renderCalendario(v);else if(M.visao==="kanban")renderKanban(v);else renderLista(v);
}
function chip(p,{compacto=false}={}){
  return el("button",{class:"mk-chip",style:`border-left:3px solid ${COR[p.status]}`,title:`${p.titulo} · ${STATUS[p.status]}${p.responsavel_nome?" · "+p.responsavel_nome:""}`,onclick:()=>abrir(p)},
    el("span",{},ICONE[p.formato]||"📌"," ",p.titulo),compacto?null:el("span",{class:"s"},[FORMATO[p.formato],p.responsavel_nome].filter(Boolean).join(" · ")));
}
function renderCalendario(v){
  const hoje=new Date();if(!M.mes)M.mes=new Date(hoje.getFullYear(),hoje.getMonth(),1);
  const y=M.mes.getFullYear(),m=M.mes.getMonth();const ini=new Date(y,m,1),fim=new Date(y,m+1,0);
  const nav=el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:10px"},el("button",{class:"btn sm",onclick:()=>{M.mes=new Date(y,m-1,1);render()}},"‹"),el("h2",{style:"margin:0;min-width:180px;text-align:center;text-transform:capitalize"},ini.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})),el("button",{class:"btn sm",onclick:()=>{M.mes=new Date(y,m+1,1);render()}},"›"),el("button",{class:"btn sm",onclick:()=>{M.mes=new Date(hoje.getFullYear(),hoje.getMonth(),1);render()}},"Hoje"),
    el("span",{class:"note",style:"margin-left:auto"},"Clique num dia para criar uma pauta nele."));
  v.append(nav);
  const grid=el("div",{class:"mk-cal"});for(const d of ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"])grid.append(el("div",{class:"mk-dow"},d));
  const dow=(ini.getDay()+6)%7;for(let i=0;i<dow;i++)grid.append(el("div",{class:"mk-dia vazio"}));
  const itens=filtrados();const hojeS=iso(new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate()));
  for(let d=1;d<=fim.getDate();d++){const ds=iso(new Date(y,m,d));const ps=itens.filter(p=>p.data_prevista===ds);
    const cel=el("div",{class:"mk-dia"+(ds===hojeS?" hoje":""),onclick:e=>{if(e.target===cel||e.target.classList.contains("mk-n"))openPautaForm({data_prevista:ds})}},el("div",{class:"mk-n"},String(d)),ps.map(p=>chip(p,{compacto:true})));
    grid.append(cel)}
  v.append(grid);
  const sem=itens.filter(p=>!p.data_prevista&&p.status!=="cancelado");
  if(sem.length)v.append(el("section",{class:"card section",style:"margin-top:14px"},el("h2",{},"Sem data ",el("span",{class:"cnt"},String(sem.length))),el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},sem.map(p=>chip(p)))));
}
function renderKanban(v){
  const itens=filtrados();const cols=el("div",{class:"mk-kanban"});
  for(const st of KANBAN){const ps=itens.filter(p=>p.status===st);
    cols.append(el("div",{class:"mk-col"},el("div",{class:"mk-col-h",style:`border-top:3px solid ${COR[st]}`},STATUS[st],el("span",{class:"cnt"},String(ps.length))),
      ps.map(p=>el("div",{class:"card mk-card",onclick:()=>abrir(p)},el("div",{class:"n"},ICONE[p.formato]," ",p.titulo),el("div",{class:"s"},[fmtL(p.data_prevista),p.responsavel_nome].filter(Boolean).join(" · ")),p.status==="ajustar"&&p.ultimo_ajuste?el("div",{class:"s",style:"color:var(--crit);white-space:normal"},"✎ "+p.ultimo_ajuste):null,p.atrasada?el("div",{class:"s",style:"color:var(--crit)"},"atrasada"):null,
        st==="em_aprovacao"&&admin()?el("div",{class:"actions",style:"justify-content:flex-start;margin-top:6px"},el("button",{class:"btn sm primary",onclick:e=>{e.stopPropagation();aprovar(p)}},"Aprovar"),el("button",{class:"btn sm",onclick:e=>{e.stopPropagation();pedirAjuste(p)}},"Ajustar")):null))));}
  v.append(cols);
}
function renderLista(v){
  const itens=filtrados();
  if(!itens.length){v.append(el("div",{class:"card empty"},"Nenhuma pauta."));return}
  const linhas=itens.map(p=>el("tr",{style:"cursor:pointer",onclick:()=>abrir(p)},el("td",{class:"num"},fmt(p.data_prevista)||"—"),el("td",{},el("b",{},p.titulo),p.pilar?el("div",{class:"note"},p.pilar):null),el("td",{},FORMATO[p.formato]),el("td",{},(p.canais||[]).map(c=>CANAIS[c]||c).join(", ")),el("td",{},p.responsavel_nome||"—"),el("td",{},pill(p.status)),el("td",{},p.link_criativo?el("a",{class:"btn sm",href:p.link_criativo,target:"_blank",rel:"noopener",onclick:e=>e.stopPropagation()},"Criativo"):null)));
  v.append(el("div",{class:"card tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Data"),el("th",{},"Pauta"),el("th",{},"Formato"),el("th",{},"Canais"),el("th",{},"Responsável"),el("th",{},"Status"),el("th",{},""))),el("tbody",{},linhas))));
}

/* ---------- detalhe ---------- */
async function abrir(p){M.sel=p;M.coment=[];renderDetalhe();await carregarComent(p.id)}
function renderDetalhe(){
  const p=M.lista.find(x=>x.id===M.sel?.id)||M.sel;if(!p)return;
  const host=$("#modalHost");host.replaceChildren();const close=()=>{host.replaceChildren();M.sel=null};
  const acoes=[];
  const mover=(st,label,cls="btn sm")=>el("button",{class:cls,onclick:()=>mudarStatus(p,st)},label);
  if(p.status==="ideia"||p.status==="ajustar")acoes.push(mover("em_aprovacao","Enviar para aprovação","btn sm primary"));
  if(p.status==="em_aprovacao"&&admin()){acoes.push(el("button",{class:"btn sm primary",onclick:()=>aprovar(p)},"✓ Aprovar"),el("button",{class:"btn sm",onclick:()=>pedirAjuste(p)},"✎ Pedir ajuste"))}
  if(p.status==="aprovado")acoes.push(mover("em_producao","Em produção","btn sm primary"));
  if(p.status==="em_producao")acoes.push(mover("agendado","Agendado","btn sm primary"));
  if(["agendado","em_producao","aprovado"].includes(p.status))acoes.push(mover("publicado","Publicado ✓"));
  if(p.status!=="cancelado"&&p.status!=="publicado")acoes.push(mover("cancelado","Cancelar pauta"));
  const info=(l,v)=>v?el("div",{},el("div",{class:"eyebrow",style:"font-size:10.5px"},l),el("div",{},v)):null;
  const body=el("div",{},
    el("div",{style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"},pill(p.status),el("span",{class:"note"},ICONE[p.formato]+" "+FORMATO[p.formato]),p.atrasada?el("span",{class:"pill",style:"background:#b4452f1a;color:#b4452f"},"atrasada"):null,p.origem==="ia"?el("span",{class:"pill g"},"sugerida por IA"):null),
    el("div",{style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px"},info("Data prevista",fmtL(p.data_prevista)),info("Responsável",p.responsavel_nome),info("Canais",(p.canais||[]).map(c=>CANAIS[c]||c).join(", ")),info("Pilar",p.pilar),info("Objetivo",p.objetivo),p.aprovado_em?info("Aprovada por",(p.aprovado_por_nome||"")+" em "+new Date(p.aprovado_em).toLocaleDateString("pt-BR")):null),
    p.descricao?el("div",{class:"card section",style:"white-space:pre-wrap;margin-bottom:10px"},p.descricao):null,
    p.legenda?el("details",{style:"margin-bottom:10px"},el("summary",{},"Legenda"),el("div",{style:"white-space:pre-wrap;padding:8px 0"},p.legenda,p.hashtags?"\n\n"+p.hashtags:"")):null,
    el("div",{class:"actions",style:"justify-content:flex-start;margin-bottom:12px"},p.link_criativo?el("a",{class:"btn sm",href:p.link_criativo,target:"_blank",rel:"noopener"},"Abrir criativo"):null,p.link_publicado?el("a",{class:"btn sm",href:p.link_publicado,target:"_blank",rel:"noopener"},"Ver publicado"):null,el("button",{class:"btn sm edit-only",onclick:()=>{close();openPautaForm(p)}},"Editar")),
    el("div",{class:"actions",style:"justify-content:flex-start;margin-bottom:14px;gap:6px"},acoes),
    el("h2",{style:"font-size:15px;margin:0 0 6px"},"Comentários"),
    el("div",{class:"mk-coment"},M.coment.length?M.coment.map(c=>el("div",{class:"mk-c "+c.tipo},el("div",{class:"s"},(c.autor_nome||"—")+" · "+new Date(c.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+(c.tipo==="ajuste"?" · pedido de ajuste":c.tipo==="aprovacao"?" · aprovação":"")),el("div",{style:"white-space:pre-wrap"},c.texto))):el("div",{class:"note"},"Sem comentários.")),
    (()=>{const ta=el("textarea",{rows:"2",placeholder:"Escreva um comentário…",style:"flex:1"});return el("div",{style:"display:flex;gap:8px;align-items:flex-end;margin-top:8px"},ta,el("button",{class:"btn sm",onclick:async()=>{if(!ta.value.trim())return;await comentar(p,"comentario",ta.value.trim());ta.value=""}},"Enviar"))})());
  host.append(el("div",{class:"modal",onclick:e=>{if(e.target.classList.contains("modal"))close()}},el("div",{class:"card",role:"dialog","aria-modal":"true",style:"max-width:720px"},el("h2",{},p.titulo),body,el("div",{class:"actions"},el("button",{class:"btn",onclick:close},"Fechar")))));
}
async function comentar(p,tipo,texto){const {error}=await SB.from("pautas_comentarios").insert({pauta_id:p.id,autor_id:PP.perfil?.id||null,tipo,texto});if(error){toast("Não foi possível comentar");return}await carregarComent(p.id)}
async function mudarStatus(p,st,extra={}){
  const {error}=await SB.from("pautas").update({status:st,...extra}).eq("id",p.id);if(error){toast(error.message||"Não foi possível mover");return}
  toast("Pauta: "+STATUS[st]);M.ok=false;await carregar();if(M.sel){M.sel=M.lista.find(x=>x.id===p.id)||M.sel;renderDetalhe();carregarComent(p.id)}
}
async function aprovar(p){await comentar(p,"aprovacao","Aprovada");await mudarStatus(p,"aprovado")}
function pedirAjuste(p){
  const ta=el("textarea",{rows:"4",placeholder:"O que precisa mudar? (vai para o responsável)"});
  modal("Pedir ajuste",el("div",{class:"form"},el("div",{class:"f full"},el("label",{},p.titulo),ta)),async()=>{if(!ta.value.trim())throw new Error("Escreva o que ajustar");await comentar(p,"ajuste",ta.value.trim());await mudarStatus(p,"ajustar")});
  const b=$("#modalHost button.btn.primary");if(b)b.textContent="Enviar pedido";
}

/* ---------- formulário ---------- */
function openPautaForm(p={}){
  const meu=meuColab();
  const tit=inp("text",p.titulo||"",{placeholder:"Ex.: 3 erros que o empresário comete quando o banco liga"}),desc=el("textarea",{rows:"4",placeholder:"Ideia, gancho, roteiro, referências…"},p.descricao||""),
    fmtS=sel(FORMATO,p.formato||"carrossel"),data=inp("date",p.data_prevista||""),resp=sel({"":"—",...Object.fromEntries(M.colab.filter(c=>c.ativo!==false||c.id===p.responsavel_id).map(c=>[c.id,c.nome]))},p.responsavel_id||(meu?.nucleo==="marketing"?meu.id:"")),
    pilar=inp("text",p.pilar||"",{list:"mk-pilares"}),dl1=el("datalist",{id:"mk-pilares"},PILARES.map(x=>el("option",{value:x}))),obj=sel({"":"—",...Object.fromEntries(OBJETIVOS.map(o=>[o,o]))},p.objetivo||""),
    link=inp("url",p.link_criativo||"",{placeholder:"Drive / Canva"}),linkp=inp("url",p.link_publicado||"",{placeholder:"link do post publicado"}),leg=el("textarea",{rows:"5",placeholder:"Legenda"},p.legenda||""),hash=inp("text",p.hashtags||"",{placeholder:"#direitobancario #empresario"}),
    status=sel(STATUS,p.status||"ideia");if(!admin()){status.querySelector('option[value="aprovado"]').disabled=true}
  const canais=Object.entries(CANAIS).map(([k,l])=>{const i=el("input",{type:"checkbox",value:k,style:"width:15px;height:15px;accent-color:var(--gold)"});i.checked=(p.canais||["instagram"]).includes(k);return el("label",{style:"display:inline-flex;gap:6px;align-items:center;margin:0 10px 4px 0;text-transform:none;letter-spacing:0;font-size:13.5px"},i,l)});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{for:"mk-tit"},"Título"),Object.assign(tit,{id:"mk-tit"})),field("mk-fmt","Formato",fmtS),field("mk-data","Data prevista",data),field("mk-resp","Responsável",resp),field("mk-status","Status",status),
    el("div",{class:"f"},el("label",{for:"mk-pilar"},"Pilar"),el("div",{},Object.assign(pilar,{id:"mk-pilar"}),dl1)),field("mk-obj","Objetivo",obj),el("div",{class:"f full"},el("label",{},"Canais"),el("div",{},canais)),
    field("mk-desc","Ideia / roteiro",desc),field("mk-link","Link do criativo",link),field("mk-linkp","Link publicado",linkp),field("mk-leg","Legenda",leg),field("mk-hash","Hashtags",hash));
  const extra=p.id&&admin()?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta pauta?"))return;await SB.from("pautas").delete().eq("id",p.id);$("#modalHost").replaceChildren();toast("Pauta excluída");M.ok=false;carregar()}},"Excluir"):null;
  modal(p.id?"Editar pauta":"Nova pauta",body,async()=>{
    if(!tit.value.trim())throw new Error("Informe o título");
    const row={titulo:tit.value.trim(),descricao:desc.value.trim()||null,formato:fmtS.value,canais:canais.map(l=>l.querySelector("input")).filter(i=>i.checked).map(i=>i.value),data_prevista:data.value||null,responsavel_id:resp.value||null,pilar:pilar.value.trim()||null,objetivo:obj.value||null,link_criativo:link.value.trim()||null,link_publicado:linkp.value.trim()||null,legenda:leg.value.trim()||null,hashtags:hash.value.trim()||null,status:status.value};
    const {error}=p.id?await SB.from("pautas").update(row).eq("id",p.id):await SB.from("pautas").insert(row);if(error)throw new Error(error.message||"Não foi possível salvar");
    toast("Pauta salva");M.ok=false;carregar();
  },extra);
}

/* ---------- integração ---------- */
const CSS=`.mk-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.mk-dow{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:4px 6px}.mk-dia{min-height:96px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:3px;cursor:pointer}.mk-dia.vazio{background:transparent;border-color:transparent;cursor:default}.mk-dia.hoje{border-color:var(--gold);box-shadow:inset 0 0 0 1px var(--gold)}.mk-n{font-size:12px;color:var(--muted);padding:0 2px}.mk-dia.hoje .mk-n{color:var(--gold);font-weight:700}
.mk-chip{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:12px;line-height:1.25;cursor:pointer;max-width:100%;color:var(--text)}.mk-chip>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.mk-chip .s{font-size:10.5px;color:var(--muted)}.mk-chip:hover{border-color:var(--gold)}
.mk-kanban{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:10px;overflow-x:auto;padding-bottom:8px}.mk-col{background:var(--surface-2);border-radius:10px;padding:8px;min-height:200px}.mk-col-h{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 6px 8px;display:flex;justify-content:space-between}.mk-card{padding:10px 12px;margin-bottom:8px;cursor:pointer}.mk-card .n{font-weight:700;font-size:13.5px}.mk-card .s{font-size:12px;color:var(--muted);margin-top:2px}
.mk-coment{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}.mk-c{padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:13.5px}.mk-c.ajuste{border-left:3px solid #b4452f}.mk-c.aprovacao{border-left:3px solid #2e7d4f}.mk-c.status{background:transparent;color:var(--muted);font-size:12px;padding:2px 10px}.mk-c .s{font-size:11.5px;color:var(--muted);margin-bottom:2px}
@media (max-width:860px){.mk-cal{grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}.mk-dia{min-height:56px;padding:2px}.mk-chip>span:first-child{font-size:10px}.mk-chip .s{display:none}}`;
document.head.append(el("style",{},CSS));
{const _r=render;render=function(){_r();const vm=$("#view-marketing");if(!vm)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="marketing")S.tab="clientes";vm.hidden=S.tab!=="marketing";if(S.tab==="marketing")renderMarketing()}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("marketing");let t;ch.on("postgres_changes",{event:"*",schema:"public",table:"pautas"},()=>{clearTimeout(t);t=setTimeout(()=>{M.ok=false;if(S.tab==="marketing")garantir()},400)});ch.on("postgres_changes",{event:"*",schema:"public",table:"pautas_comentarios"},()=>{if(M.sel)carregarComent(M.sel.id)});ch.subscribe()}});
})();
