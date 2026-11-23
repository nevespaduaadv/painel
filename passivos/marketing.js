/* Marketing — pautas de conteúdo: calendário mensal, kanban por status e lista; fluxo de aprovação das sócias
   (Aprovar / Pedir ajuste), comentários, link do criativo e legenda. Supabase: pautas, pautas_comentarios, v_pautas,
   v_pautas_comentarios (0022). Só equipe; aprovação só admin (garantido no banco). */
(()=>{
"use strict";
const M={lista:[],colab:[],pedidos:[],ok:false,carregando:false,visao:"calendario",calModo:"mes",mes:null,sel:null,coment:[],fStatus:"",fResp:"",busca:""};
const STATUS={ideia:"Ideia",em_aprovacao:"Em aprovação",ajustar:"Ajustar",aprovado:"Aprovado",em_producao:"Em produção",agendado:"Agendado",publicado:"Publicado",cancelado:"Cancelado"};
const COR={ideia:"#8a8f98",em_aprovacao:"#b8964a",ajustar:"#b4452f",aprovado:"#2e7d4f",em_producao:"#2f6fb3",agendado:"#6a4fb3",publicado:"#0c1f38",cancelado:"#aaa"};
const FORMATO={reels:"Reels",carrossel:"Carrossel",estatico:"Estático",story:"Story",artigo:"Artigo",email:"E-mail",video:"Vídeo",live:"Live",outro:"Outro"};
const ICONE={reels:"🎬",carrossel:"🖼️",estatico:"📷",story:"⏱️",artigo:"📝",email:"✉️",video:"📹",live:"🔴",outro:"📌"};
const CANAIS={instagram:"Instagram",linkedin:"LinkedIn",youtube:"YouTube",tiktok:"TikTok",blog:"Blog/site",whatsapp:"WhatsApp",email:"E-mail"};
const PILARES=["Autoridade","Educativo","Prova social","Bastidores","Oferta","Institucional","Notícia/radar"];
const OBJETIVOS=["Atração","Autoridade","Conversão","Relacionamento"];
const KANBAN=["ideia","em_aprovacao","ajustar","aprovado","em_producao","agendado","publicado"];
const admin=()=>PP.perfil?.papel==="admin";
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;const parseD=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const fmt=s=>s?parseD(s).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}):"";
const fmtL=s=>s?parseD(s).toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"}):"sem data";
const meuColab=()=>M.colab.find(c=>c.perfil_id===PP.perfil?.id);
const pill=st=>el("span",{class:"pill",style:`background:${COR[st]}1a;color:${COR[st]};border:1px solid ${COR[st]}55`},STATUS[st]||st);

async function carregar(){
  if(M.carregando)return;M.carregando=true;
  try{const [p,c,q]=await Promise.all([SB.from("v_pautas").select("*").order("data_prevista",{ascending:true,nullsFirst:false}).order("ordem"),SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo").order("nome"),SB.from("v_marketing_pedidos").select("*").order("created_at",{ascending:false}).limit(50)]);if(p.error)throw p.error;M.lista=p.data||[];M.colab=c.data||[];M.pedidos=q.data||[];M.ok=true}
  catch(e){console.warn("marketing",e);toast("Não foi possível carregar as pautas")}
  finally{M.carregando=false}
  render();
}
const garantir=()=>{if(!M.ok&&!M.carregando)carregar();return M.ok};
async function carregarComent(id){const {data}=await SB.from("v_pautas_comentarios").select("*").eq("pauta_id",id).order("created_at");M.coment=data||[];if(M.sel&&M.sel.id===id){if(marketingV3()&&M3.painel)renderPainelPautaV3(M.sel,{silencioso:true});else renderDetalhe()}}

/* ---------- tela ---------- */
function filtrados(){const q=(M.busca||"").toLowerCase();return M.lista.filter(p=>(!M.diaFiltro||p.data_prevista===M.diaFiltro)&&(!M.fStatus||p.status===M.fStatus)&&(!M.fResp||p.responsavel_id===M.fResp)&&(!q||[p.titulo,p.descricao,p.pilar,p.legenda].join(" ").toLowerCase().includes(q)))}
function renderMarketing(){
  const v=$("#view-marketing");v.replaceChildren();
  const ok=garantir();
  const aprov=M.lista.filter(p=>p.status==="em_aprovacao").length;
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Marketing"),el("h1",{},"Pautas de conteúdo"),el("div",{class:"sub"},"Ideias → aprovação das sócias → produção → agendamento → publicado. Calendário, kanban e lista.")),
    el("div",{class:"actions"},aprov&&admin()?el("button",{class:"btn sm",style:"border-color:var(--gold);color:var(--gold)",onclick:()=>{M.visao="kanban";M.fStatus="em_aprovacao";render()}},`${aprov} aguardando sua aprovação`):null,el("button",{class:"btn sm primary edit-only",onclick:()=>openPautaForm({})},"+ Pauta"))));
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  // barra: visão + filtros
  const tabs=el("div",{class:"tabs",style:"margin:0"},[["calendario","Calendário"],["kanban","Kanban"],["lista","Lista"],["robo","Máquina de ideias"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(M.visao===k),onclick:()=>{M.visao=k;M.diaFiltro=null;render()}},l)));
  const fs=sel({"":"Todos os status",...STATUS},M.fStatus);fs.onchange=()=>{M.fStatus=fs.value;render()};
  const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(M.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},M.fResp);fr.onchange=()=>{M.fResp=fr.value;render()};
  const q=inp("search",M.busca,{placeholder:"Buscar pauta…",id:"mk-q"});q.oninput=()=>{M.busca=q.value;render();const n=$("#mk-q");if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}};
  v.append(el("div",{class:"card",style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 12px;margin-bottom:14px"},tabs,el("span",{style:"flex:1"}),fs,fr,q));
  if(M.diaFiltro)v.append(el("div",{class:"note",style:"margin:-6px 0 10px"},"Mostrando só o dia "+fmtL(M.diaFiltro)+" ",el("button",{class:"btn sm",onclick:()=>{M.diaFiltro=null;render()}},"Limpar")));
  if(M.visao==="calendario")renderCalendario(v);else if(M.visao==="kanban")renderKanban(v);else if(M.visao==="robo")renderRobo(v);else renderLista(v);
}
function chip(p,{compacto=false}={}){
  return el("button",{class:"mk-chip",style:`border-left:3px solid ${COR[p.status]}`,title:`${p.titulo} · ${STATUS[p.status]}${p.responsavel_nome?" · "+p.responsavel_nome:""}`,onclick:()=>abrir(p)},
    el("span",{},ICONE[p.formato]||"📌"," ",p.hora_prevista?el("b",{},p.hora_prevista.slice(0,5)+" "):null,p.titulo),compacto?null:el("span",{class:"s"},[FORMATO[p.formato],p.responsavel_nome].filter(Boolean).join(" · ")));
}
function renderCalendario(v){
  const hoje=new Date();if(!M.mes)M.mes=new Date(hoje.getFullYear(),hoje.getMonth(),1);
  const y=M.mes.getFullYear(),m=M.mes.getMonth();const ini=new Date(y,m,1),fim=new Date(y,m+1,0);
  const nav=el("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:10px"},el("button",{class:"btn sm",onclick:()=>{M.mes=new Date(y,m-1,1);render()}},"‹"),el("h2",{style:"margin:0;min-width:180px;text-align:center"},ini.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase())),el("button",{class:"btn sm",onclick:()=>{M.mes=new Date(y,m+1,1);render()}},"›"),el("button",{class:"btn sm",onclick:()=>{M.mes=new Date(hoje.getFullYear(),hoje.getMonth(),1);render()}},"Hoje"),
    el("span",{class:"note",style:"margin-left:auto"},"Clique num dia para criar uma pauta nele."));
  v.append(nav);
  const grid=el("div",{class:"mk-cal"});for(const d of ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"])grid.append(el("div",{class:"mk-dow"},d));
  const dow=(ini.getDay()+6)%7;for(let i=0;i<dow;i++)grid.append(el("div",{class:"mk-dia vazio"}));
  const itens=filtrados();const hojeS=iso(new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate()));
  for(let d=1;d<=fim.getDate();d++){const ds=iso(new Date(y,m,d));const ps=itens.filter(p=>p.data_prevista===ds);
    const MAXD=3;const vis=ps.slice(0,MAXD),resto=ps.length-vis.length;
    const cel=el("div",{class:"mk-dia"+(ds===hojeS?" hoje":""),onclick:e=>{if(e.target===cel||e.target.classList.contains("mk-n"))openPautaForm({data_prevista:ds})}},el("div",{class:"mk-n"},String(d)),vis.map(p=>chip(p,{compacto:true})),
      resto>0?el("button",{class:"mk-mais",onclick:e=>{e.stopPropagation();M.visao="lista";M.busca="";M.fStatus="";M.diaFiltro=ds;render()}},`+${resto} mais`):null);
    grid.append(cel)}
  v.append(grid);
  const sem=itens.filter(p=>!p.data_prevista&&p.status!=="cancelado");
  if(sem.length)v.append(el("section",{class:"card section",style:"margin-top:14px"},el("h2",{},"Sem data ",el("span",{class:"cnt"},String(sem.length))),el("div",{style:"display:flex;flex-wrap:wrap;gap:6px"},sem.map(p=>chip(p)))));
}
function renderKanban(v){
  const itens=filtrados();const cols=el("div",{class:"mk-kanban"});
  for(const st of KANBAN){const ps=itens.filter(p=>p.status===st);
    cols.append(el("div",{class:"mk-col","data-st":st},el("div",{class:"mk-col-h",style:`border-top:3px solid ${COR[st]}`},STATUS[st],el("span",{class:"cnt"},String(ps.length))),
      ps.map(p=>el("div",{class:"card mk-card","data-id":p.id,onclick:()=>abrir(p)},el("div",{class:"n"},ICONE[p.formato]," ",p.titulo),el("div",{class:"s"},[fmtL(p.data_prevista)+(p.hora_prevista?" "+p.hora_prevista.slice(0,5):""),p.responsavel_nome].filter(Boolean).join(" · ")),p.status==="ajustar"&&p.ultimo_ajuste?el("div",{class:"s",style:"color:var(--crit);white-space:normal"},"✎ "+p.ultimo_ajuste):null,p.atrasada?el("div",{class:"s",style:"color:var(--crit)"},"atrasada"):null,
        st==="em_aprovacao"&&admin()?el("div",{class:"actions",style:"justify-content:flex-start;margin-top:6px"},el("button",{class:"btn sm primary",onclick:e=>{e.stopPropagation();aprovar(p)}},"Aprovar"),el("button",{class:"btn sm",onclick:e=>{e.stopPropagation();pedirAjuste(p)}},"Ajustar")):null))));}
  v.append(cols);
  if(window.PP_DND)PP_DND.ativar(cols,{card:".mk-card",coluna:".mk-col",chaveCol:c=>c.dataset.st,chaveCard:c=>c.dataset.id,podeSoltar:(c,st)=>st!=="aprovado"||admin(),
    aoSoltar:async(c,st)=>{const p=M.lista.find(x=>x.id===c.dataset.id);if(!p||p.status===st)return;if(st==="ajustar"&&admin()){pedirAjuste(p);return}if(st==="aprovado"){await comentar(p,"aprovacao","Aprovada");}await mudarStatus(p,st)}});
  v.append(el("div",{class:"note",style:"margin-top:6px"},"Arraste os cards entre as colunas para mudar o status."));
}
function renderRobo(v){
  const ideias=M.lista.filter(p=>p.origem==="ia"&&p.status==="ideia");
  v.append(el("div",{class:"card section",style:"border-left:3px solid var(--gold)"},el("h2",{},"🤖 Máquina de ideias"),el("div",{class:"note"},"O robô (Claude) propõe pautas toda segunda-feira com base no radar da semana e nos pilares de conteúdo, e atende pedidos específicos — tudo entra como “Ideia” marcada “sugerida por IA”, para vocês aprovarem ou descartarem. Ele não vê clientes nem dados do escritório: só esta área."),
    el("div",{class:"actions",style:"justify-content:flex-start;margin-top:10px"},el("button",{class:"btn sm primary",onclick:pedirRobo},"Pedir ideias ao robô"))));
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Sugestões aguardando triagem ",el("span",{class:"cnt"},String(ideias.length)))));
  if(!ideias.length)sec.append(el("div",{class:"note"},"Nenhuma sugestão pendente."));
  for(const p of ideias)sec.append(el("div",{class:"rh-reg",style:"display:flex;gap:10px;align-items:flex-start"},el("div",{style:"flex:1;min-width:0"},el("div",{style:"font-weight:700;cursor:pointer",onclick:()=>abrir(p)},ICONE[p.formato]," ",p.titulo),el("div",{class:"note"},[FORMATO[p.formato],p.pilar,p.data_prevista?fmtL(p.data_prevista):null].filter(Boolean).join(" · ")),p.descricao?el("div",{class:"note",style:"white-space:pre-wrap;margin-top:4px;max-height:80px;overflow:hidden"},p.descricao):null),
    el("div",{class:"actions",style:"flex-wrap:nowrap"},el("button",{class:"btn sm primary",onclick:()=>mudarStatus(p,"em_aprovacao")},"Levar p/ aprovação"),admin()?el("button",{class:"btn sm",onclick:()=>aprovar(p)},"Aprovar"):null,el("button",{class:"btn sm",onclick:()=>mudarStatus(p,"cancelado")},"Descartar"))));
  v.append(sec);
  const ped=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Pedidos ao robô")));
  if(!M.pedidos.length)ped.append(el("div",{class:"note"},"Nenhum pedido. Ex.: “5 ideias de reels sobre Pronampe para empresário do agro”, “legenda para a pauta X”."));
  for(const q of M.pedidos)ped.append(el("div",{class:"rh-reg"},el("div",{class:"s"},new Date(q.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+" · "+(q.autor_nome||"")+" · "+({pendente:"⏳ pendente",atendido:"✅ atendido",recusado:"recusado"})[q.status]+(q.pauta_titulo?" · pauta: "+q.pauta_titulo:"")),el("div",{style:"white-space:pre-wrap"},q.texto),q.resposta?el("div",{class:"note",style:"white-space:pre-wrap;margin-top:4px;border-left:2px solid var(--gold);padding-left:8px"},q.resposta):null));
  v.append(ped);
}
function pedirRobo(p){
  const ta=el("textarea",{rows:"4",placeholder:"Ex.: 5 ideias de carrossel sobre renegociação com o Sicredi para produtor rural; ou: escreva a legenda desta pauta no tom do escritório"});
  modal("Pedir ao robô",el("div",{class:"form"},el("div",{class:"f full note"},"O pedido é atendido na próxima rodada do robô (diária, de manhã). Para algo urgente, peça direto no chat com o Claude."),el("div",{class:"f full"},el("label",{},"Pedido"),ta)),async()=>{if(!ta.value.trim())throw new Error("Escreva o pedido");const {error}=await SB.from("marketing_pedidos").insert({texto:ta.value.trim(),pauta_id:p?.id||null});if(error)throw error;toast("Pedido registrado");M.ok=false;carregar()});
}
function renderLista(v){
  const itens=filtrados();
  if(!itens.length){v.append(el("div",{class:"card empty"},"Nenhuma pauta."));return}
  const linhas=itens.map(p=>el("tr",{style:"cursor:pointer",onclick:()=>abrir(p)},el("td",{class:"num"},fmt(p.data_prevista)||"—"),el("td",{},el("b",{},p.titulo),p.pilar?el("div",{class:"note"},p.pilar):null),el("td",{},FORMATO[p.formato]),el("td",{},(p.canais||[]).map(c=>CANAIS[c]||c).join(", ")),el("td",{},p.responsavel_nome||"—"),el("td",{},pill(p.status)),el("td",{},p.link_criativo?el("a",{class:"btn sm",href:p.link_criativo,target:"_blank",rel:"noopener",onclick:e=>e.stopPropagation()},"Criativo"):null)));
  v.append(el("div",{class:"card tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Data"),el("th",{},"Pauta"),el("th",{},"Formato"),el("th",{},"Canais"),el("th",{},"Responsável"),el("th",{},"Status"),el("th",{},""))),el("tbody",{},linhas))));
}

/* ---------- detalhe ---------- */
async function abrir(p,origem){
  M.sel=p;M.coment=[];
  if(marketingV3()&&M3.painel){M3.aberta={tipo:"pauta",id:p.id};renderPainelPautaV3(p,{origem});await carregarComent(p.id);return}
  renderDetalhe();await carregarComent(p.id);
}
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
    el("div",{style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px"},info("Data prevista",fmtL(p.data_prevista)+(p.hora_prevista?" · "+p.hora_prevista.slice(0,5):"")),info("Responsável",p.responsavel_nome),info("Canais",(p.canais||[]).map(c=>CANAIS[c]||c).join(", ")),info("Pilar",p.pilar),info("Objetivo",p.objetivo),p.aprovado_em?info("Aprovada por",(p.aprovado_por_nome||"")+" em "+new Date(p.aprovado_em).toLocaleDateString("pt-BR")):null),
    p.descricao?el("div",{class:"card section",style:"white-space:pre-wrap;margin-bottom:10px"},p.descricao):null,
    p.legenda?el("details",{style:"margin-bottom:10px"},el("summary",{},"Legenda"),el("div",{style:"white-space:pre-wrap;padding:8px 0"},p.legenda,p.hashtags?"\n\n"+p.hashtags:"")):null,
    el("div",{class:"actions",style:"justify-content:flex-start;margin-bottom:12px"},p.link_criativo?el("a",{class:"btn sm",href:p.link_criativo,target:"_blank",rel:"noopener"},"Abrir criativo"):null,p.link_publicado?el("a",{class:"btn sm",href:p.link_publicado,target:"_blank",rel:"noopener"},"Ver publicado"):null,el("button",{class:"btn sm edit-only",onclick:()=>{close();openPautaForm(p)}},"Editar"),el("button",{class:"btn sm",title:"Pedir ao robô legenda, roteiro ou variações desta pauta",onclick:()=>pedirRobo(p)},"🤖 Pedir ao robô")),
    el("div",{class:"actions",style:"justify-content:flex-start;margin-bottom:14px;gap:6px"},acoes),
    el("h2",{style:"font-size:15px;margin:0 0 6px"},"Comentários"),
    el("div",{class:"mk-coment"},M.coment.length?M.coment.map(c=>el("div",{class:"mk-c "+c.tipo},el("div",{class:"s"},(c.autor_nome||"—")+" · "+new Date(c.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+(c.tipo==="ajuste"?" · pedido de ajuste":c.tipo==="aprovacao"?" · aprovação":"")),el("div",{style:"white-space:pre-wrap"},c.texto))):el("div",{class:"note"},"Sem comentários.")),
    (()=>{const ta=el("textarea",{rows:"2",placeholder:"Escreva um comentário…",style:"flex:1"});return el("div",{style:"display:flex;gap:8px;align-items:flex-end;margin-top:8px"},ta,el("button",{class:"btn sm",onclick:async()=>{if(!ta.value.trim())return;await comentar(p,"comentario",ta.value.trim());ta.value=""}},"Enviar"))})());
  host.append(el("div",{class:"modal",onclick:e=>{if(e.target.classList.contains("modal"))close()}},el("div",{class:"card",role:"dialog","aria-modal":"true",style:"max-width:720px"},el("h2",{},p.titulo),body,el("div",{class:"actions"},el("button",{class:"btn",onclick:close},"Fechar")))));
}
async function comentar(p,tipo,texto){const {error}=await SB.from("pautas_comentarios").insert({pauta_id:p.id,autor_id:PP.perfil?.id||null,tipo,texto});if(error){toast("Não foi possível comentar");return}await carregarComent(p.id)}
async function mudarStatus(p,st,extra={}){
  const {error}=await SB.from("pautas").update({status:st,...extra}).eq("id",p.id);if(error){toast(error.message||"Não foi possível mover");return}
  toast("Pauta: "+STATUS[st]);M.ok=false;await carregar();if(M.sel){M.sel=M.lista.find(x=>x.id===p.id)||M.sel;if(marketingV3()&&M3.painel)renderPainelPautaV3(M.sel,{silencioso:true});else renderDetalhe();carregarComent(p.id)}
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
    fmtS=sel(FORMATO,p.formato||"carrossel"),data=inp("date",p.data_prevista||""),hora=inp("time",(p.hora_prevista||"").slice(0,5)),resp=sel({"":"—",...Object.fromEntries(M.colab.filter(c=>c.ativo!==false||c.id===p.responsavel_id).map(c=>[c.id,c.nome]))},p.responsavel_id||(meu?.nucleo==="marketing"?meu.id:"")),
    pilar=inp("text",p.pilar||"",{list:"mk-pilares"}),dl1=el("datalist",{id:"mk-pilares"},PILARES.map(x=>el("option",{value:x}))),obj=sel({"":"—",...Object.fromEntries(OBJETIVOS.map(o=>[o,o]))},p.objetivo||""),
    link=inp("url",p.link_criativo||"",{placeholder:"Drive / Canva"}),linkp=inp("url",p.link_publicado||"",{placeholder:"link do post publicado"}),leg=el("textarea",{rows:"5",placeholder:"Legenda"},p.legenda||""),hash=inp("text",p.hashtags||"",{placeholder:"#direitobancario #empresario"}),
    status=sel(STATUS,p.status||"ideia");if(!admin()){status.querySelector('option[value="aprovado"]').disabled=true}
  const canais=Object.entries(CANAIS).map(([k,l])=>{const i=el("input",{type:"checkbox",value:k,style:"width:15px;height:15px;accent-color:var(--gold)"});i.checked=(p.canais||["instagram"]).includes(k);return el("label",{style:"display:inline-flex;gap:6px;align-items:center;margin:0 10px 4px 0;text-transform:none;letter-spacing:0;font-size:13.5px"},i,l)});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{for:"mk-tit"},"Título"),Object.assign(tit,{id:"mk-tit"})),field("mk-fmt","Formato",fmtS),field("mk-data","Data prevista",data),field("mk-hora","Horário",hora),field("mk-resp","Responsável",resp),field("mk-status","Status",status),
    el("div",{class:"f"},el("label",{for:"mk-pilar"},"Pilar"),el("div",{},Object.assign(pilar,{id:"mk-pilar"}),dl1)),field("mk-obj","Objetivo",obj),el("div",{class:"f full"},el("label",{},"Canais"),el("div",{},canais)),
    field("mk-desc","Ideia / roteiro",desc),field("mk-link","Link do criativo",link),field("mk-linkp","Link publicado",linkp),field("mk-leg","Legenda",leg),field("mk-hash","Hashtags",hash));
  const extra=p.id&&admin()?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta pauta?"))return;await SB.from("pautas").delete().eq("id",p.id);$("#modalHost").replaceChildren();toast("Pauta excluída");M.ok=false;carregar()}},"Excluir"):null;
  modal(p.id?"Editar pauta":"Nova pauta",body,async()=>{
    if(!tit.value.trim())throw new Error("Informe o título");
    const row={titulo:tit.value.trim(),descricao:desc.value.trim()||null,formato:fmtS.value,canais:canais.map(l=>l.querySelector("input")).filter(i=>i.checked).map(i=>i.value),data_prevista:data.value||null,hora_prevista:hora.value||null,responsavel_id:resp.value||null,pilar:pilar.value.trim()||null,objetivo:obj.value||null,link_criativo:link.value.trim()||null,link_publicado:linkp.value.trim()||null,legenda:leg.value.trim()||null,hashtags:hash.value.trim()||null,status:status.value};
    const {error}=p.id?await SB.from("pautas").update(row).eq("id",p.id):await SB.from("pautas").insert(row);if(error)throw new Error(error.message||"Não foi possível salvar");
    toast("Pauta salva");M.ok=false;carregar();
  },extra);
}

/* ============================================================================================================
   V3.1 (Onda 3B) — Marketing · Pautas de conteúdo com Calendário Único V3.1 (mesma grade e tokens de agenda.js),
   capitalização PT-BR correta ("Novembro de 2026") e painel lateral .np-painel (440 px) sem quebrar a grade.
   Ativo só com html.np-casca-v3 && window.NPUI; V2 permanece intacta.
   ============================================================================================================ */
const marketingV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const M3={obra:null,painel:null,aberta:null};
const STATUS_TOM={ideia:"",em_aprovacao:"att",ajustar:"crit",aprovado:"ok",em_producao:"info",agendado:"info",publicado:"ok",cancelado:""};
const STATUS_VAR={ideia:"var(--np-text-3)",em_aprovacao:"var(--np-att)",ajustar:"var(--np-crit)",aprovado:"var(--np-ok)",em_producao:"var(--np-info)",agendado:"var(--np-accent)",publicado:"var(--np-ink)",cancelado:"var(--np-text-3)"};
const DIAS_SEM=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const inicioSem=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
function rotuloMkV3(ref,modo){
  if(window.PP_AGENDA?.rotuloPeriodo)return window.PP_AGENDA.rotuloPeriodo(ref,modo);
  if(modo==="semana"){const s0=inicioSem(ref),s1=addD(s0,6);return s0.getMonth()===s1.getMonth()?`${s0.getDate()} a ${s1.getDate()} de ${s1.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}`:`${s0.getDate()} de ${s0.toLocaleDateString("pt-BR",{month:"long"})} a ${s1.getDate()} de ${s1.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}`}
  return ref.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase());
}
function chipPautaV3(p){
  const btn=el("button",{
    class:"ag-ev"+(p.atrasada?" atrasada":""),
    style:`--c:${STATUS_VAR[p.status]||"var(--np-ink)"}`,
    title:`${p.titulo}\n${STATUS[p.status]||p.status}${p.responsavel_nome?" · "+p.responsavel_nome:""}`,
    onclick:e=>{e.stopPropagation();abrir(p,e.currentTarget)}
  },p.hora_prevista?el("b",{},p.hora_prevista.slice(0,5)+" "):null,p.titulo);
  return btn;
}
function abrirPainelDiaV3(ds,origem){
  M3.aberta={tipo:"dia",ds};M.sel=null;
  const d=parseD(ds);
  const tit=d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}).replace(/^./,c=>c.toUpperCase());
  const ps=filtrados().filter(p=>p.data_prevista===ds);
  const lista=ps.length
    ?el("ul",{class:"np-lst"},ps.map(p=>NPUI.linha({
      id:p.id,regua:p.atrasada?"late":p.status==="ajustar"?"fatal":p.status==="em_aprovacao"?"att":null,
      prazo:{curta:p.hora_prevista?p.hora_prevista.slice(0,5):"dia",exata:fmtL(ds)},
      titulo:p.titulo,
      contexto:[FORMATO[p.formato],p.pilar,p.responsavel_nome].filter(Boolean).join(" · "),
      direita:[NPUI.marca((STATUS[p.status]||p.status).toLowerCase(),STATUS_TOM[p.status])],
      onOpen:li=>abrir(p,li.querySelector(".np-it-abrir")),titleAbrir:"Abrir pauta"
    })))
    :NPUI.vazio({titulo:"Nenhuma pauta neste dia",texto:"Crie uma pauta prevista para esta data."});
  const pe=readOnly()?[]:[NPUI.btn("Nova pauta neste dia",{variante:"pri",icone:"mais",onclick:()=>openPautaForm({data_prevista:ds})})];
  M3.painel.abrir({id:"dia:"+ds,trilha:[el("span",{},"Marketing"),el("span",{},"Pautas do dia")],titulo:tit,corpo:[lista],pe,origem});
}
function renderPainelPautaV3(p,{origem,silencioso}={}){
  const cur=M.lista.find(x=>x.id===p?.id)||p;if(!cur||!M3.painel)return;
  M.sel=cur;M3.aberta={tipo:"pauta",id:cur.id};
  const props=NPUI.props([
    ["Status",NPUI.marca((STATUS[cur.status]||cur.status).toLowerCase(),STATUS_TOM[cur.status])],
    ["Data prevista",cur.data_prevista?[fmtL(cur.data_prevista),cur.hora_prevista?" · "+cur.hora_prevista.slice(0,5):"",cur.atrasada?[" ",NPUI.marca("atrasada","crit")]:null]:el("span",{class:"np-sem"},"sem data"),"serif"],
    ["Formato",FORMATO[cur.formato]||cur.formato],
    ["Canais",(cur.canais||[]).map(c=>CANAIS[c]||c).join(", ")||null],
    ["Responsável",cur.responsavel_nome?NPUI.quem(cur.responsavel_nome):el("span",{class:"np-sem"},"— ninguém —")],
    ["Pilar",cur.pilar||null],
    ["Objetivo",cur.objetivo||null],
    cur.aprovado_em?["Aprovada por",`${cur.aprovado_por_nome||"—"} em ${new Date(cur.aprovado_em).toLocaleDateString("pt-BR")}`]:null,
    cur.origem==="ia"?["Origem",NPUI.marca("sugerida por IA","info")]:null,
  ].filter(x=>x&&x[1]!=null));
  const secDesc=cur.descricao?NPUI.secao("Ideia / roteiro",el("p",{class:"np-txt"},cur.descricao)):null;
  const secLeg=cur.legenda?NPUI.secao("Legenda",el("p",{class:"np-txt"},cur.legenda+(cur.hashtags?"\n\n"+cur.hashtags:""))):null;
  const cmts=el("div",{class:"np-mk-cmt-list"},
    M.coment.length?M.coment.map(c=>el("div",{class:"np-mk-cmt"},
      el("div",{class:"meta"},`${c.autor_nome||"—"} · ${new Date(c.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}${c.tipo==="ajuste"?" · pedido de ajuste":c.tipo==="aprovacao"?" · aprovação":""}`),
      el("div",{style:"white-space:pre-wrap"},c.texto)
    )):el("div",{class:"np-sem"},"Sem comentários ainda."));
  const inpCmt=el("input",{type:"text",placeholder:"Escrever comentário…","aria-label":"Escrever comentário"});
  const formCmt=readOnly()?null:el("div",{class:"np-mk-cmt-form"},inpCmt,NPUI.btn("Enviar",{onclick:async()=>{if(!inpCmt.value.trim())return;const txt=inpCmt.value.trim();inpCmt.value="";await comentar(cur,"comentario",txt)}}));
  const secCmt=NPUI.secao(`Comentários (${M.coment.length})`,el("div",{},cmts,formCmt));
  // Rodapé em linha única <= 3 controles (principal + secundária + ⋯)
  const pe=[];
  if(!readOnly()){
    if(cur.status==="em_aprovacao"&&admin()){
      pe.push(NPUI.btn("Aprovar",{variante:"pri",onclick:()=>aprovar(cur)}));
      pe.push(NPUI.btn("Pedir ajuste",{onclick:()=>pedirAjuste(cur)}));
    }else if(cur.status==="ideia"||cur.status==="ajustar"){
      pe.push(NPUI.btn("Enviar p/ aprovação",{variante:"pri",onclick:()=>mudarStatus(cur,"em_aprovacao")}));
      pe.push(NPUI.btn("Editar",{onclick:()=>openPautaForm(cur)}));
    }else if(cur.status==="aprovado"){
      pe.push(NPUI.btn("Em produção",{variante:"pri",onclick:()=>mudarStatus(cur,"em_producao")}));
      pe.push(NPUI.btn("Editar",{onclick:()=>openPautaForm(cur)}));
    }else if(cur.status==="em_producao"){
      pe.push(NPUI.btn("Agendar",{variante:"pri",onclick:()=>mudarStatus(cur,"agendado")}));
      pe.push(NPUI.btn("Editar",{onclick:()=>openPautaForm(cur)}));
    }else if(cur.status==="agendado"){
      pe.push(NPUI.btn("Marcar publicado",{variante:"pri",onclick:()=>mudarStatus(cur,"publicado")}));
      pe.push(NPUI.btn("Editar",{onclick:()=>openPautaForm(cur)}));
    }else{
      pe.push(NPUI.btn("Editar",{variante:"pri",onclick:()=>openPautaForm(cur)}));
    }
  }
  const maisItens=[
    !readOnly()&&cur.status==="em_aprovacao"&&admin()?{label:"Editar pauta",onclick:()=>openPautaForm(cur)}:null,
    cur.link_criativo?{label:"Abrir criativo ↗",onclick:()=>window.open(cur.link_criativo,"_blank","noopener")}:null,
    cur.link_publicado?{label:"Ver publicado ↗",onclick:()=>window.open(cur.link_publicado,"_blank","noopener")}:null,
    !readOnly()?{label:"Pedir ao robô",onclick:()=>pedirRobo(cur)}:null,
    !readOnly()&&["agendado","em_producao","aprovado"].includes(cur.status)&&cur.status!=="agendado"?{label:"Marcar publicado",onclick:()=>mudarStatus(cur,"publicado")}:null,
    !readOnly()&&cur.status!=="cancelado"&&cur.status!=="publicado"?{label:"Cancelar pauta",tom:"crit",onclick:()=>mudarStatus(cur,"cancelado")}:null,
  ].filter(Boolean);
  if(maisItens.length){
    const mBtn=NPUI.ib("pontos","Mais ações da pauta",e=>NPUI.pop(e.currentTarget,maisItens,{label:"Ações da pauta",alinhar:"dir"}));
    mBtn.classList.add("np-p-mais");pe.push(mBtn);
  }
  M3.painel.abrir({id:"pauta:"+cur.id,trilha:[el("span",{},"Marketing"),el("span",{},FORMATO[cur.formato]||"Pauta")],titulo:cur.titulo,corpo:[props,secDesc,secLeg,secCmt],pe,origem:silencioso?null:origem});
}
function montarCalendarioUnicoV3(itens){
  const hoje=new Date();const hojeS=iso(hoje);
  if(!M.mes)M.mes=new Date(hoje.getFullYear(),hoje.getMonth(),1);
  const modo=M.calModo==="semana"?"semana":"mes";
  const ref=M.mes;
  const dias=[];
  if(modo==="semana"){
    const s0=inicioSem(ref);
    for(let i=0;i<7;i++)dias.push(addD(s0,i));
  }else{
    const pri=new Date(ref.getFullYear(),ref.getMonth(),1);
    const s0=inicioSem(pri);
    for(let i=0;i<42;i++)dias.push(addD(s0,i));
  }
  const mesAtual=ref.getMonth();
  const g=el("div",{class:modo==="semana"?"ag-mes np-mk-sem":"ag-mes"});
  DIAS_SEM.forEach(d=>g.append(el("div",{class:"ag-mh"},d)));
  const maxEv=modo==="semana"?8:4;
  for(const d of dias){
    const ds=iso(d);
    const ps=itens.filter(p=>p.data_prevista===ds);
    const fora=modo==="mes"&&d.getMonth()!==mesAtual;
    const selDia=M3.aberta?.tipo==="dia"&&M3.aberta.ds===ds;
    const cel=el("div",{
      class:"ag-mc"+(fora?" fora":"")+(ds===hojeS?" hoje":"")+(selDia?" np-mk-sel":""),
      onclick:e=>{if(e.target===cel||e.target.classList.contains("ag-mn")||e.target.classList.contains("ag-dn"))abrirPainelDiaV3(ds,cel)}
    },
      el("div",{class:"ag-mn"},
        el("span",{class:"ag-dn"},String(d.getDate())),
        ps.length?el("span",{class:"ag-mq"},String(ps.length)):null
      )
    );
    ps.slice(0,maxEv).forEach(p=>cel.append(chipPautaV3(p)));
    if(ps.length>maxEv){
      cel.append(el("button",{class:"ag-mais",onclick:e=>{e.stopPropagation();abrirPainelDiaV3(ds,e.currentTarget)}},`+ ${ps.length-maxEv} mais`));
    }
    g.append(cel);
  }
  return {g,rotulo:rotuloMkV3(ref,modo)};
}
function renderKanbanV3(itens){
  const host=el("div",{class:"np-quadro np-quadro-neg",style:`--n:${KANBAN.length}`});
  for(const st of KANBAN){
    const ps=itens.filter(p=>p.status===st);
    const col=el("div",{class:"np-colq","data-st":st},
      el("h3",{},el("span",{},STATUS[st]),el("span",{class:"n"},String(ps.length))),
      el("div",{class:"np-colq-b"},ps.length?ps.map(p=>{
        const r=p.atrasada?"late":st==="ajustar"?"fatal":st==="em_aprovacao"?"att":null;
        const mover=readOnly()?null:NPUI.ib("pontos","Mover "+p.titulo,e=>{
          e.stopPropagation();
          NPUI.pop(e.currentTarget,KANBAN.filter(k=>k!=="aprovado"||admin()).map(k=>({label:STATUS[k],atual:p.status===k,onclick:()=>{if(k==="ajustar"&&admin())pedirAjuste(p);else if(k==="aprovado")aprovar(p);else mudarStatus(p,k)}})),{label:"Mover status"});
        });
        return el("div",{class:"np-cardq"+(r?" r-"+r:""),"data-id":p.id,tabindex:"0",role:"button",onclick:e=>abrir(p,e.currentTarget),onkeydown:e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();abrir(p,e.currentTarget)}}},
          el("div",{class:"tx"},p.titulo),
          el("div",{class:"ctx"},[FORMATO[p.formato],p.responsavel_nome].filter(Boolean).join(" · ")),
          p.status==="ajustar"&&p.ultimo_ajuste?el("div",{class:"ctx",style:"color:var(--np-crit)"},"Ajuste: "+p.ultimo_ajuste):null,
          el("div",{class:"pe"},
            el("span",{class:"pz"+(p.atrasada?" crit":"")},p.data_prevista?fmt(p.data_prevista)+(p.hora_prevista?" "+p.hora_prevista.slice(0,5):""):"sem data"),
            el("span",{style:"display:flex;gap:4px;align-items:center"},p.atrasada?NPUI.marca("atrasada","crit"):null,mover)
          )
        );
      }):el("div",{class:"np-rodape",style:"justify-content:center"},"—"))
    );
    host.append(col);
  }
  if(window.PP_DND&&!readOnly())PP_DND.ativar(host,{card:".np-cardq",coluna:".np-colq",chaveCol:c=>c.dataset.st,chaveCard:c=>c.dataset.id,podeSoltar:(c,st)=>st!=="aprovado"||admin(),
    aoSoltar:async(c,st)=>{const p=M.lista.find(x=>x.id===c.dataset.id);if(!p||p.status===st)return;if(st==="ajustar"&&admin()){pedirAjuste(p);return}if(st==="aprovado"){await aprovar(p);return}await mudarStatus(p,st)}});
  return host;
}
function renderListaV3(itens){
  if(!itens.length)return NPUI.vazio({titulo:"Nenhuma pauta com estes filtros",texto:"Ajuste os filtros ou crie uma nova pauta.",acao:"Limpar filtros",onAcao:()=>{M.fStatus="";M.fResp="";M.busca="";M.diaFiltro=null;render()}});
  const grupos=KANBAN.concat(["cancelado"]).filter(st=>itens.some(p=>p.status===st));
  const box=el("div",{});
  for(const st of grupos){
    const ps=itens.filter(p=>p.status===st);
    box.append(NPUI.grupo({
      id:"mk-"+st,titulo:STATUS[st],n:ps.length,tom:STATUS_TOM[st],aberto:st!=="publicado"&&st!=="cancelado",
      itens:ps.map(p=>NPUI.linha({
        id:p.id,regua:p.atrasada?"late":st==="ajustar"?"fatal":st==="em_aprovacao"?"att":null,
        atual:M3.aberta?.tipo==="pauta"&&M3.aberta.id===p.id,
        prazo:p.data_prevista?{curta:fmt(p.data_prevista),hora:p.hora_prevista?p.hora_prevista.slice(0,5):"",exata:fmtL(p.data_prevista),tom:p.atrasada?"crit":""}:{curta:"",exata:"sem data"},
        titulo:p.titulo,
        contexto:[FORMATO[p.formato],p.pilar,(p.canais||[]).map(c=>CANAIS[c]||c).join(", ")].filter(Boolean).join(" · "),
        direita:[p.atrasada?NPUI.marca("atrasada","crit"):null,NPUI.quem(p.responsavel_nome)],
        onOpen:li=>abrir(p,li.querySelector(".np-it-abrir")),titleAbrir:"Abrir pauta"
      }))
    }));
  }
  return box;
}
function renderRoboV3(){
  const ideias=M.lista.filter(p=>p.origem==="ia"&&p.status==="ideia");
  const wrap=el("div",{class:"np-mk-ideias"});
  wrap.append(el("div",{class:"np-gestao-card"},
    el("div",{class:"np-ana-sh"},
      el("h3",{},"Máquina de ideias"),
      readOnly()?null:NPUI.btn("Pedir ideias ao robô",{variante:"pri",onclick:()=>pedirRobo(null)})
    ),
    el("p",{class:"sub"},"Sugestões semanais baseadas nos pilares editoriais entram como Ideia para triagem e aprovação. O robô acessa apenas esta área.")
  ));
  wrap.append(NPUI.grupo({
    id:"mk-ia-triagem",titulo:"Sugestões aguardando triagem",n:ideias.length,aberto:true,
    itens:ideias.length?ideias.map(p=>NPUI.linha({
      id:"ia-"+p.id,prazo:{curta:p.data_prevista?fmt(p.data_prevista):"ideia",exata:fmtL(p.data_prevista)},
      titulo:p.titulo,
      contexto:[FORMATO[p.formato],p.pilar].filter(Boolean).join(" · "),
      direita:[
        NPUI.btn("Enviar p/ aprovação",{variante:"ghost",onclick:e=>{e.stopPropagation();mudarStatus(p,"em_aprovacao")}}),
        admin()?NPUI.btn("Aprovar",{variante:"ghost",onclick:e=>{e.stopPropagation();aprovar(p)}}):null,
        NPUI.btn("Descartar",{variante:"ghost",onclick:e=>{e.stopPropagation();mudarStatus(p,"cancelado")}})
      ].filter(Boolean),
      onOpen:li=>abrir(p,li.querySelector(".np-it-abrir")),titleAbrir:"Abrir sugestão"
    })):[el("li",{class:"np-it np-it-vazia"},el("span",{class:"np-it-chk np-it-chk-vazio","aria-hidden":"true"}),el("span",{class:"np-it-prazo"}),el("span",{class:"np-it-abrir np-sem"},"Nenhuma sugestão pendente."))]
  }));
  wrap.append(NPUI.grupo({
    id:"mk-ia-pedidos",titulo:"Pedidos ao robô",n:M.pedidos.length,aberto:true,
    itens:M.pedidos.length?M.pedidos.map(q=>NPUI.linha({
      id:"ped-"+q.id,
      prazo:{curta:new Date(q.created_at).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}),exata:new Date(q.created_at).toLocaleString("pt-BR")},
      titulo:q.texto,
      contexto:[q.autor_nome,q.pauta_titulo?"pauta: "+q.pauta_titulo:null,q.resposta?q.resposta.slice(0,90):null].filter(Boolean).join(" · "),
      direita:[NPUI.marca(q.status==="atendido"?"atendido":q.status==="recusado"?"recusado":"pendente",q.status==="atendido"?"ok":q.status==="pendente"?"att":"")],
      onOpen:()=>{}
    })):[el("li",{class:"np-it np-it-vazia"},el("span",{class:"np-it-chk np-it-chk-vazio","aria-hidden":"true"}),el("span",{class:"np-it-prazo"}),el("span",{class:"np-it-abrir np-sem"},"Nenhum pedido registrado ainda."))]
  }));
  return wrap;
}
function renderMarketingV3(){
  const v=$("#view-marketing");v.replaceChildren();v.classList.add("np-v3");M3.obra=null;M3.painel=null;
  if(!garantir()){v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  const ativas=M.lista.filter(p=>p.status!=="cancelado");
  const nAprov=ativas.filter(p=>p.status==="em_aprovacao").length;
  const nAtr=ativas.filter(p=>p.atrasada).length;
  const nPub=ativas.filter(p=>p.status==="publicado").length;
  const resumo=NPUI.resumo([
    {n:ativas.length,label:"pautas"},
    {n:nAprov,label:"em aprovação",tom:nAprov?"att":"zero"},
    {n:nAtr,label:"atrasadas",tom:nAtr?"crit":"zero"},
    {n:nPub,label:"publicadas",tom:nPub?"":"zero"},
  ]);
  const chips=[];const C=o=>{const c=NPUI.chip(o);chips.push(c);return c};
  C({label:"Todas",on:!M.fStatus,grupo:"st",onclick:()=>{M.fStatus="";render()}});
  C({label:"Em aprovação",n:nAprov||null,on:M.fStatus==="em_aprovacao",grupo:"st",onclick:()=>{M.fStatus=M.fStatus==="em_aprovacao"?"":"em_aprovacao";render()}});
  C({label:"Ajustar",n:ativas.filter(p=>p.status==="ajustar").length||null,on:M.fStatus==="ajustar",grupo:"st",onclick:()=>{M.fStatus=M.fStatus==="ajustar"?"":"ajustar";render()}});
  C({label:"Em produção",n:ativas.filter(p=>p.status==="em_producao").length||null,on:M.fStatus==="em_producao",grupo:"st",onclick:()=>{M.fStatus=M.fStatus==="em_producao"?"":"em_producao";render()}});
  const extras=[M.fResp,M.fStatus&&!["em_aprovacao","ajustar","em_producao"].includes(M.fStatus)].filter(Boolean).length;
  const maisF=NPUI.chip({label:"Mais filtros",n:extras?`(${extras})`:null,on:extras>0,title:"Status completo e responsável",onclick:e=>NPUI.pop(e.currentTarget,()=>{
    const fs=sel({"":"Todos os status",...STATUS},M.fStatus);fs.onchange=()=>{M.fStatus=fs.value;render()};
    const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(M.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},M.fResp);fr.onchange=()=>{M.fResp=fr.value;render()};
    const L=(l,c)=>el("div",{},el("label",{},l),c);
    return [el("div",{class:"np-pop-form"},L("Status",fs),L("Responsável",fr),
      el("div",{style:"display:flex;justify-content:space-between;gap:8px"},
        NPUI.btn("Limpar",{variante:"ghost",onclick:()=>{M.fStatus="";M.fResp="";M.busca="";NPUI.fecharPop();render()}}),
        NPUI.btn("Fechar",{onclick:()=>NPUI.fecharPop()})))];
  },{role:"dialog",label:"Mais filtros",alinhar:"dir"})});
  maisF.setAttribute("aria-haspopup","dialog");
  const busca=el("input",{type:"search",class:"np-tb-busca",id:"mk-q-v3",value:M.busca||"",placeholder:"Buscar pauta…","aria-label":"Buscar pauta"});
  busca.oninput=()=>{M.busca=busca.value;render();const n=$("#mk-q-v3");if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}};
  const segVista=NPUI.seg([["calendario","Grade"],["kanban","Quadro"],["lista","Lista"]],M.visao==="robo"?"calendario":M.visao,k=>{M.visao=k;M.diaFiltro=null;NPUI.vt(()=>render())},"Visualização");
  const btnIdeias=NPUI.btn("Ideias IA",{variante:M.visao==="robo"?"":"ghost",onclick:()=>{M.visao=M.visao==="robo"?"calendario":"robo";render()}});
  if(M.visao==="robo")btnIdeias.setAttribute("aria-pressed","true");
  const direita=[segVista,btnIdeias,readOnly()?null:NPUI.btn("Nova pauta",{variante:"pri",icone:"mais",onclick:()=>openPautaForm({})})];
  v.append(NPUI.toolbar({resumo,filtros:chips,filtrosFixos:[maisF,busca],direita}));NPUI.reancorarPop();
  const obra=el("div",{class:"np-obra"});M3.obra=obra;const corpo=el("div",{class:"np-corpo"});
  const itens=filtrados();
  if(M.visao==="calendario"){
    const hoje=new Date();if(!M.mes)M.mes=new Date(hoje.getFullYear(),hoje.getMonth(),1);
    const {g,rotulo}=montarCalendarioUnicoV3(itens);
    const mover=n=>{M.mes=M.calModo==="semana"?addD(M.mes,n*7):new Date(M.mes.getFullYear(),M.mes.getMonth()+n,1);render()};
    const nav=el("span",{class:"np-nav-per",role:"group","aria-label":"Navegar no período"},
      NPUI.ib("chevE","Período anterior",()=>mover(-1)),
      NPUI.btn("Hoje",{variante:"ghost",onclick:()=>{M.mes=M.calModo==="semana"?new Date(hoje.getFullYear(),hoje.getMonth(),hoje.getDate()):new Date(hoje.getFullYear(),hoje.getMonth(),1);render()}}),
      NPUI.ib("chevD","Próximo período",()=>mover(1)));
    const segPer=NPUI.seg([["mes","Mês"],["semana","Semana"]],M.calModo||"mes",k=>{M.calModo=k;NPUI.vt(()=>render())},"Período do calendário");
    corpo.append(
      el("div",{class:"np-mk-bar"},
        el("div",{class:"np-ag-h"},el("h1",{},rotulo),el("span",{class:"np-ag-s"},"Clique em um dia ou pauta para abrir no painel")),
        el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"},segPer,nav)
      ),
      el("div",{class:"np-grade-w"},g),
      el("div",{class:"ag-legenda"},KANBAN.map(st=>el("span",{},el("i",{style:`background:${STATUS_VAR[st]}`}),STATUS[st])))
    );
    const sem=itens.filter(p=>!p.data_prevista&&p.status!=="cancelado");
    if(sem.length){
      corpo.append(NPUI.grupo({
        id:"mk-sem-data",titulo:"Sem data definida",n:sem.length,aberto:false,
        itens:sem.map(p=>NPUI.linha({
          id:p.id,prazo:{curta:"—",exata:"sem data"},titulo:p.titulo,
          contexto:[FORMATO[p.formato],p.pilar].filter(Boolean).join(" · "),
          direita:[NPUI.marca((STATUS[p.status]||p.status).toLowerCase(),STATUS_TOM[p.status]),NPUI.quem(p.responsavel_nome)],
          onOpen:li=>abrir(p,li.querySelector(".np-it-abrir")),titleAbrir:"Abrir pauta"
        }))
      }));
    }
    corpo.append(NPUI.rodape(`${itens.length} pauta${itens.length===1?"":"s"} com estes filtros`,[["crit","ajuste / atrasada"],["att","em aprovação"]]));
  }else if(M.visao==="kanban"){
    corpo.append(renderKanbanV3(itens),NPUI.rodape(`${itens.length} pauta${itens.length===1?"":"s"} · arraste entre colunas para mover o status`,[["crit","ajuste / atrasada"],["att","em aprovação"]]));
  }else if(M.visao==="robo"){
    corpo.append(renderRoboV3());
  }else{
    corpo.append(renderListaV3(itens),NPUI.rodape(`${itens.length} pauta${itens.length===1?"":"s"} com estes filtros`,[["crit","ajuste / atrasada"],["att","em aprovação"]]));
  }
  obra.append(corpo);v.append(obra);
  M3.painel=NPUI.painel({obra,label:"Detalhe da pauta",onClose:()=>{M3.aberta=null;M.sel=null}});
  if(M3.aberta){
    if(M3.aberta.tipo==="pauta"){const p=M.lista.find(x=>x.id===M3.aberta.id);if(p)renderPainelPautaV3(p,{silencioso:true});else M3.aberta=null}
    else if(M3.aberta.tipo==="dia"){abrirPainelDiaV3(M3.aberta.ds,null)}
  }
}

/* ---------- integração ---------- */
const CSS=`.mk-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.mk-dow{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:4px 6px}.mk-dia{min-height:96px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:3px;cursor:pointer}.mk-dia.vazio{background:transparent;border-color:transparent;cursor:default}.mk-dia.hoje{border-color:var(--gold);box-shadow:inset 0 0 0 1px var(--gold)}.mk-n{font-size:12px;color:var(--muted);padding:0 2px}.mk-dia.hoje .mk-n{color:var(--gold);font-weight:700}
.mk-chip{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:12px;line-height:1.25;cursor:pointer;max-width:100%;color:var(--text)}.mk-chip>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.mk-chip .s{font-size:10.5px;color:var(--muted)}.mk-chip:hover{border-color:var(--gold)}.mk-mais{background:none;border:0;color:var(--info);font-size:11.5px;cursor:pointer;text-align:left;padding:1px 4px}
.mk-kanban{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);gap:10px;overflow-x:auto;padding-bottom:8px}.mk-col{background:var(--surface-2);border-radius:10px;padding:8px;min-height:200px}.mk-col-h{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 6px 8px;display:flex;justify-content:space-between}.mk-card{padding:10px 12px;margin-bottom:8px;cursor:pointer}.mk-card .n{font-weight:700;font-size:13.5px}.mk-card .s{font-size:12px;color:var(--muted);margin-top:2px}
.mk-coment{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}.mk-c{padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:13.5px}.mk-c.ajuste{border-left:3px solid #b4452f}.mk-c.aprovacao{border-left:3px solid #2e7d4f}.mk-c.status{background:transparent;color:var(--muted);font-size:12px;padding:2px 10px}.mk-c .s{font-size:11.5px;color:var(--muted);margin-bottom:2px}
@media (max-width:860px){.mk-cal{grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}.mk-dia{min-height:56px;padding:2px}.mk-chip>span:first-child{font-size:10px}.mk-chip .s{display:none}}`;
document.head.append(el("style",{},CSS));
window.PP_MARKETING={v3:marketingV3,render:()=>marketingV3()?renderMarketingV3():renderMarketing(),rotulo:rotuloMkV3};
{const _r=render;render=function(){_r();const vm=$("#view-marketing");if(!vm)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="marketing")S.tab="clientes";vm.hidden=S.tab!=="marketing";if(S.tab==="marketing"){if(marketingV3())renderMarketingV3();else{vm.classList.remove("np-v3");renderMarketing()}}}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("marketing");let t;ch.on("postgres_changes",{event:"*",schema:"public",table:"pautas"},()=>{clearTimeout(t);t=setTimeout(()=>{M.ok=false;if(S.tab==="marketing")garantir()},400)});ch.on("postgres_changes",{event:"*",schema:"public",table:"pautas_comentarios"},()=>{if(M.sel)carregarComent(M.sel.id)});ch.on("postgres_changes",{event:"*",schema:"public",table:"marketing_pedidos"},()=>{M.ok=false;if(S.tab==="marketing")garantir()});ch.subscribe()}});
})();
