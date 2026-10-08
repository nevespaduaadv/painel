/* Módulo da carteira — Timeline e Processos por cliente, gravados nas tabelas do Supabase
   (entradas_timeline, processos, andamentos, anexos, colaboradores). Carregado por passivos/index.html
   depois do script principal; usa os utilitários globais do painel (S, el, modal, toast, BRL, fmtD…)
   e o cliente Supabase (SB, PP, equipe). Expõe window.PP_MOD = {timeline, processos, contagens}. */
(()=>{
"use strict";
const TIPOS={solicitacao_documentos:"Solicitação de documentos",requerimento_bacen:"Requerimento ao Bacen",analise_contrato:"Análise de contrato",parecer_tecnico:"Parecer técnico",contato_banco:"Contato com jurídico do banco",proposta_acordo:"Proposta de acordo",reuniao_cliente:"Reunião com cliente",ata:"Ata",protocolo:"Protocolo",mudanca_estagio:"Mudança de estágio",acordo_fechado:"Acordo fechado",andamento:"Andamento processual",outro:"Outro"};
const TIPOS_MANUAIS=Object.fromEntries(Object.entries(TIPOS).filter(([k])=>!["mudanca_estagio","acordo_fechado","andamento"].includes(k)));
const POLOS={passivo:"Passivo (cliente é réu/executado)",ativo:"Ativo (cliente é autor)"};
const STATUS_PROC={ativo:"Ativo",suspenso:"Suspenso",encerrado:"Encerrado"};
const FASES_PROC=["Conhecimento","Recursal","Execução / cumprimento de sentença","Embargos","Suspenso","Arquivado"];
const TIPOS_ACAO=["Execução de título extrajudicial","Busca e apreensão","Ação monitória","Ação revisional","Embargos à execução","Ação de cobrança","Ação declaratória","Recuperação judicial","Outra"];
const TIPOS_AND=["Despacho","Decisão","Sentença","Audiência","Petição protocolada","Citação","Intimação","Penhora","Bloqueio (Sisbajud)","Acordo homologado","Outro"];
const DIA=86400000;
const hojeISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};

const M={cid:null,carregando:null,timeline:[],processos:[],andamentos:[],anexos:[],colab:[],perfis:[],pessoasOk:false,filtroTipo:"",soVisiveis:false,procSel:null};

/* ---------- Dados ---------- */
async function carregarPessoas(){
  if(!equipe()||M.pessoasOk)return;
  const [{data:c},{data:p}]=await Promise.all([SB.from("colaboradores").select("id,perfil_id,nome,cargo,nucleo,ativo").order("nome"),SB.from("perfis").select("id,nome,email")]);
  M.colab=c||[];M.perfis=p||[];M.pessoasOk=true;
}
async function carregarCliente(cid,forcar=false){
  if(M.carregando===cid&&!forcar)return;
  M.carregando=cid;
  try{
    await carregarPessoas();
    const [tl,pr]=await Promise.all([
      SB.from("entradas_timeline").select("*").eq("cliente_id",cid).order("data",{ascending:false}).order("created_at",{ascending:false}),
      SB.from("processos").select("*").eq("cliente_id",cid).order("created_at")]);
    if(tl.error)throw tl.error;if(pr.error)throw pr.error;
    const pids=pr.data.map(p=>p.id), eids=tl.data.map(e=>e.id);
    const [an,ax]=await Promise.all([
      pids.length?SB.from("andamentos").select("*").in("processo_id",pids).order("data",{ascending:false}):{data:[]},
      eids.length?SB.from("anexos").select("*").in("entrada_id",eids):{data:[]}]);
    if(S.sel!==cid)return; // usuário já mudou de cliente
    M.cid=cid;M.timeline=tl.data;M.processos=pr.data;M.andamentos=an.data||[];M.anexos=ax.data||[];
    if(M.procSel&&!M.processos.some(p=>p.id===M.procSel))M.procSel=null;
  }catch(e){console.warn("carteira",e);toast("Não foi possível carregar timeline e processos")}
  finally{if(M.carregando===cid)M.carregando=null}
  if(S.tab==="clientes"&&S.sel===cid)render();
}
function garantirCarregado(c){if(M.cid!==c.id&&M.carregando!==c.id)carregarCliente(c.id);return M.cid===c.id}
let rtT=null;
function ligarTempoRealCarteira(){
  const ch=SB.channel("carteira");
  for(const t of ["entradas_timeline","processos","andamentos","anexos"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>{clearTimeout(rtT);rtT=setTimeout(()=>{if(M.cid)carregarCliente(M.cid,true)},400)});
  ch.on("postgres_changes",{event:"*",schema:"public",table:"colaboradores"},()=>{M.pessoasOk=false});
  ch.subscribe();
}
/* Admin sem registro em colaboradores ganha um automaticamente (para constar como responsável). */
async function garantirColaboradorProprio(){
  if(!PP.perfil||PP.perfil.papel!=="admin")return;
  const {data}=await SB.from("colaboradores").select("id").eq("perfil_id",PP.perfil.id).maybeSingle();
  if(!data){await SB.from("colaboradores").insert({perfil_id:PP.perfil.id,nome:PP.perfil.nome||PP.perfil.email||"Administrador",cargo:"Sócia(o)",nucleo:"socios"});M.pessoasOk=false}
}

/* ---------- Utilitários ---------- */
const nomeColab=id=>{const c=M.colab.find(x=>x.id===id);return c?c.nome:null};
const nomePerfil=id=>{const p=M.perfis.find(x=>x.id===id);return p?(p.nome||p.email):null};
const responsavelDe=r=>nomeColab(r.responsavel_id)||nomePerfil(r.created_by)||(r.automatica?"Automático":"—");
const meuColab=()=>M.colab.find(c=>c.perfil_id===PP.perfil?.id);
const contratoDe=id=>S.contratos.find(k=>k.id===id);
const nomeContrato=id=>{const k=contratoDe(id);return k?shortName(k):null};
const processoDe=id=>M.processos.find(p=>p.id===id);
const horasFmt=h=>{h=+h||0;if(!h)return null;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};
const check=(label,checked,help)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;const w=el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;justify-content:flex-start;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},i,label),help?el("div",{class:"help"},help):null);return {wrap:w,input:i}};
const datalistInput=(id,value,opcoes,attrs={})=>{const i=inp("text",value,{list:id+"-dl",...attrs});const dl=el("datalist",{id:id+"-dl"},opcoes.map(o=>el("option",{value:o})));return {wrap:el("div",{},i,dl),input:i}};
const selColab=(value)=>sel({"":"—",...Object.fromEntries(M.colab.filter(c=>c.ativo!==false||c.id===value).map(c=>[c.id,c.nome]))},value||"");
const selContrato=(c,value)=>sel({"":"— sem vínculo —",...Object.fromEntries(S.contratos.filter(k=>k.clienteId===c.id).map(k=>[k.id,shortName(k)]))},value||"");
const selProcesso=(value)=>sel({"":"— sem vínculo —",...Object.fromEntries(M.processos.map(p=>[p.id,(p.numero_cnj||"(sem número)")+(p.parte_contraria?" · "+p.parte_contraria:"")]))},value||"");
const linksParse=txt=>txt.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.split("|");if(m.length>1)return {titulo:m[0].trim(),url:m.slice(1).join("|").trim()};return {titulo:l.replace(/^https?:\/\//,"").slice(0,60),url:l}}).filter(x=>/^https?:\/\//i.test(x.url));
const linksTexto=links=>(links||[]).map(l=>`${l.titulo} | ${l.url}`).join("\n");
const diasAte=d=>{const x=parseD(d);return x?Math.round((x-hoje())/DIA):null};
function csv(nome,linhas,colunas){
  const esc=v=>{if(v==null)return"";v=typeof v==="object"?JSON.stringify(v):String(v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const txt="﻿"+[colunas.join(";"),...linhas.map(l=>colunas.map(c=>esc(l[c])).join(";"))].join("\r\n");
  baixar(nome+".csv",txt,"text/csv;charset=utf-8");
}
function baixar(nome,conteudo,mime){const a=el("a",{href:URL.createObjectURL(new Blob([conteudo],{type:mime})),download:nome});document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
const exportBtns=(nome,rows,cols)=>[el("button",{class:"btn sm edit-only",onclick:()=>csv(nome,rows,cols)},"CSV"),el("button",{class:"btn sm edit-only",onclick:()=>baixar(nome+".json",JSON.stringify(rows,null,2),"application/json")},"JSON")];
async function abrirAnexo(a){
  const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);
  if(error||!data){toast("Não foi possível abrir o anexo");return}
  window.open(data.signedUrl,"_blank","noopener");
}
async function enviarAnexos(entradaId,cid,files){
  for(const f of files){
    const nome=f.name.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\w.\-]+/g,"_");
    const caminho=`${cid}/${entradaId}/${Date.now().toString(36)}-${nome}`;
    const {error}=await SB.storage.from("anexos").upload(caminho,f,{contentType:f.type||undefined});
    if(error)throw new Error("Falha ao enviar "+f.name);
    const {error:e2}=await SB.from("anexos").insert({entrada_id:entradaId,nome:f.name,caminho_storage:caminho,tamanho:f.size,mime:f.type||null});
    if(e2)throw e2;
  }
}

/* ---------- Timeline ---------- */
function renderTimeline(c,host){
  const cliente=readOnly();
  host.append(el("div",{class:"section-h"},el("h2",{},cliente?"Andamento do trabalho":"Timeline"),
    el("div",{class:"actions"},
      cliente?null:Object.assign(sel({"":"Todos os tipos",...TIPOS},M.filtroTipo),{onchange:e=>{M.filtroTipo=e.target.value;render()}}),
      cliente?null:(()=>{const k=check("Só o que o cliente vê",M.soVisiveis);k.input.onchange=()=>{M.soVisiveis=k.input.checked;render()};k.wrap.className="";return k.wrap})(),
      ...exportBtns(`timeline-${(c.nome||c.id).replace(/\W+/g,"_")}`,M.timeline,["data","tipo","descricao","responsavel_id","horas","contrato_id","processo_id","visivel_cliente","automatica","links","created_at"]),
      el("button",{class:"btn sm primary edit-only",onclick:()=>openEntradaForm(c)},"+ Registrar atuação"))));
  if(!garantirCarregado(c)){host.append(el("div",{class:"note"},"Carregando…"));return}
  let evs=M.timeline;
  if(M.filtroTipo)evs=evs.filter(e=>e.tipo===M.filtroTipo);
  if(M.soVisiveis)evs=evs.filter(e=>e.visivel_cliente);
  if(!cliente){
    const horas=M.timeline.reduce((s,e)=>s+(+e.horas||0),0), vis=M.timeline.filter(e=>e.visivel_cliente).length;
    host.append(el("div",{class:"note"},`${M.timeline.length} registro${M.timeline.length===1?"":"s"} · ${vis} visíve${vis===1?"l":"is"} ao cliente · ${horasFmt(horas)||"0h"} apontadas`));
  }
  if(!evs.length){host.append(el("div",{class:"empty"},cliente?"Nenhuma atuação publicada ainda. Assim que o escritório registrar o trabalho, ele aparece aqui.":"Nenhuma atuação registrada com este filtro."));return}
  host.append(el("ul",{class:"tl"},evs.map(e=>{
    const anexos=M.anexos.filter(a=>a.entrada_id===e.id);
    const meta=[responsavelDe(e),horasFmt(e.horas),nomeContrato(e.contrato_id),e.processo_id?("Proc. "+(processoDe(e.processo_id)?.numero_cnj||"")):null].filter(Boolean).join(" · ");
    return el("li",{},
      el("div",{class:"d"},fmtD(parseD(e.data))," ",el("span",{class:"pill "+(e.automatica?"c":"g")},TIPOS[e.tipo]||e.tipo),cliente?null:el("span",{class:"pill "+(e.visivel_cliente?"e1":"e2"),style:"margin-left:6px"},e.visivel_cliente?"Visível ao cliente":"Interno")),
      el("div",{style:"white-space:pre-wrap"},e.descricao),
      meta?el("div",{class:"note"},meta):null,
      (e.links||[]).length||anexos.length?el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"},
        (e.links||[]).map(l=>el("a",{class:"btn sm",href:l.url,target:"_blank",rel:"noopener"},"↗ "+(l.titulo||l.url))),
        anexos.map(a=>el("button",{class:"btn sm",onclick:()=>abrirAnexo(a)},"📎 "+a.nome))):null,
      cliente?null:el("div",{class:"actions edit-only",style:"justify-content:flex-start;margin-top:6px"},
        el("button",{class:"btn sm",onclick:async()=>{const {error}=await SB.from("entradas_timeline").update({visivel_cliente:!e.visivel_cliente}).eq("id",e.id);toast(error?"Não foi possível alterar":(e.visivel_cliente?"Ocultado do cliente":"Publicado para o cliente"))}},e.visivel_cliente?"Ocultar do cliente":"Publicar para o cliente"),
        e.automatica?null:el("button",{class:"btn sm",onclick:()=>openEntradaForm(c,e)},"Editar")));
  })));
}
function openEntradaForm(c,e={}){
  const data=inp("date",e.data||hojeISO()),tipo=sel(TIPOS_MANUAIS,e.tipo||"outro"),resp=selColab(e.responsavel_id||meuColab()?.id),horas=inp("number",e.horas||"",{step:"0.25",min:0,placeholder:"0"}),
        kon=selContrato(c,e.contrato_id),pro=selProcesso(e.processo_id),desc=el("textarea",{placeholder:"O que foi feito, com quem, resultado e próximos passos."},e.descricao||""),
        links=el("textarea",{placeholder:"Um por linha. Ex.: Ata da reunião | https://drive.google.com/…"},linksTexto(e.links)),vis=check("Visível ao cliente",e.visivel_cliente,"Por padrão a atuação é interna. Marque para publicar na área do cliente."),
        arq=el("input",{type:"file",multiple:""});
  const anexosAtuais=e.id?M.anexos.filter(a=>a.entrada_id===e.id):[];
  const listaAnexos=el("div",{style:"display:flex;gap:6px;flex-wrap:wrap"},anexosAtuais.map(a=>el("span",{class:"pill g"},a.nome," ",el("button",{class:"btn sm danger",style:"padding:0 4px",title:"Remover anexo",onclick:async(ev)=>{ev.preventDefault();await SB.storage.from("anexos").remove([a.caminho_storage]);await SB.from("anexos").delete().eq("id",a.id);ev.target.closest(".pill").remove()}},"×"))));
  const body=el("div",{class:"form"},field("t-data","Data",data),field("t-tipo","Tipo",tipo),field("t-resp","Responsável",resp,M.colab.length?null:"Nenhum colaborador cadastrado ainda; o registro guarda quem lançou."),field("t-horas","Horas gastas",horas),
    field("t-con","Contrato vinculado",kon),field("t-pro","Processo vinculado",pro),field("t-desc","Descrição",desc),field("t-links","Links (Drive, ata, gravação)",links),
    el("div",{class:"f full"},el("label",{for:"t-arq"},"Anexos (upload opcional)"),Object.assign(arq,{id:"t-arq"}),listaAnexos),vis.wrap);
  const extra=e.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta atuação e seus anexos?"))return;
      const paths=anexosAtuais.map(a=>a.caminho_storage);if(paths.length)await SB.storage.from("anexos").remove(paths);
      const {error}=await SB.from("entradas_timeline").delete().eq("id",e.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir":"Atuação excluída")}},"Excluir"):null;
  modal(e.id?"Editar atuação":"Registrar atuação",body,async()=>{
    if(!desc.value.trim())throw new Error("Descreva a atuação");if(!data.value)throw new Error("Informe a data");
    const row={cliente_id:c.id,data:data.value,tipo:tipo.value,responsavel_id:resp.value||null,horas:+horas.value||0,contrato_id:kon.value||null,processo_id:pro.value||null,descricao:desc.value.trim(),links:linksParse(links.value),visivel_cliente:vis.input.checked};
    let id=e.id;
    if(id){const {error}=await SB.from("entradas_timeline").update(row).eq("id",id);if(error)throw error}
    else{const {data:ins,error}=await SB.from("entradas_timeline").insert(row).select("id").single();if(error)throw error;id=ins.id}
    if(arq.files.length)await enviarAnexos(id,c.id,[...arq.files]);
    toast("Atuação registrada");
  },extra);
}

/* ---------- Processos ---------- */
function prazoPill(p){
  if(!p.proximo_prazo)return el("span",{class:"note"},"—");
  const d=diasAte(p.proximo_prazo);const cls=d<0?"e3":d<=7?(p.prazo_fatal?"e3":"e2"):"g";
  return el("span",{class:"pill "+cls,title:p.prazo_fatal?"Prazo fatal":"Prazo interno"},fmtD(parseD(p.proximo_prazo)),p.prazo_fatal?" · fatal":"",d<0?" · vencido":d===0?" · hoje":d<=7?` · em ${d} dia${d===1?"":"s"}`:"");
}
function renderProcessos(c,host){
  const cliente=readOnly();
  host.append(el("div",{class:"section-h"},el("h2",{},"Processos"),el("div",{class:"actions"},
    ...exportBtns(`processos-${(c.nome||c.id).replace(/\W+/g,"_")}`,M.processos,["numero_cnj","tribunal","vara","tipo_acao","parte_contraria","banco","polo","fase","valor_causa","proximo_prazo","prazo_fatal","responsavel_id","status","visivel_cliente","contrato_id","created_at"]),
    el("button",{class:"btn sm primary edit-only",onclick:()=>openProcessoForm(c)},"+ Processo"))));
  if(!garantirCarregado(c)){host.append(el("div",{class:"note"},"Carregando…"));return}
  if(!M.processos.length){host.append(el("div",{class:"empty"},el("h3",{},"Nenhum processo vinculado"),el("div",{},cliente?"Não há processo judicial em andamento. O trabalho do escritório segue registrado na aba Andamento.":"Cadastre os processos do cliente para acompanhar prazos e andamentos. Clientes sem processo continuam normalmente.")));return}
  const ordem=[...M.processos].sort((a,b)=>(a.status==="encerrado")-(b.status==="encerrado")||(a.proximo_prazo||"9999").localeCompare(b.proximo_prazo||"9999"));
  const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"Nº CNJ"),el("th",{},"Ação"),el("th",{},"Tribunal / vara"),el("th",{},"Parte contrária"),el("th",{},"Banco / contrato"),el("th",{},"Fase"),el("th",{},"Próximo prazo"),cliente?null:el("th",{},"Responsável"),el("th",{},"Status"))),
    el("tbody",{},ordem.map(p=>el("tr",{style:"cursor:pointer"+(M.procSel===p.id?";background:var(--gold-soft)":""),onclick:()=>{M.procSel=M.procSel===p.id?null:p.id;render()}},
      el("td",{class:"num"},el("b",{},p.numero_cnj||"(sem número)"),cliente||p.visivel_cliente?null:el("div",{class:"pill e2"},"Oculto do cliente")),
      el("td",{},p.tipo_acao||"—",p.polo?el("div",{class:"note"},p.polo==="ativo"?"polo ativo":"polo passivo"):null),
      el("td",{},[p.tribunal,p.vara].filter(Boolean).join(" · ")||"—"),el("td",{},p.parte_contraria||"—"),
      el("td",{},p.banco||nomeContrato(p.contrato_id)||"—",p.contrato_id&&p.banco?el("div",{class:"note"},nomeContrato(p.contrato_id)):null),
      el("td",{},p.fase||"—"),el("td",{},prazoPill(p)),cliente?null:el("td",{},responsavelDe(p)),el("td",{},el("span",{class:"pill "+(p.status==="ativo"?"e1":p.status==="suspenso"?"e2":"g")},STATUS_PROC[p.status]||p.status))))));
  host.append(el("div",{class:"tbl"},tb));
  const p=M.processos.find(x=>x.id===M.procSel);
  if(p)host.append(detalheProcesso(c,p));
  else host.append(el("div",{class:"note"},"Clique em um processo para ver os andamentos."));
}
function detalheProcesso(c,p){
  const cliente=readOnly();
  const ands=M.andamentos.filter(a=>a.processo_id===p.id);
  const box=el("div",{class:"card",style:"padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:var(--surface-2)"},
    el("div",{class:"section-h"},el("div",{},el("div",{class:"eyebrow"},"Processo"),el("h3",{},p.numero_cnj||"(sem número)"),el("div",{class:"note"},[p.tipo_acao,p.parte_contraria?"× "+p.parte_contraria:null,p.valor_causa?"valor da causa "+BRL(+p.valor_causa):null].filter(Boolean).join(" · "))),
      el("div",{class:"actions edit-only"},el("button",{class:"btn sm",onclick:()=>openProcessoForm(c,p)},"Editar processo"),el("button",{class:"btn sm primary",onclick:()=>openAndamentoForm(p)},"+ Andamento"))),
    p.observacoes&&!cliente?el("div",{class:"note",style:"white-space:pre-wrap"},p.observacoes):null,
    el("h3",{style:"font-size:17px"},`Andamentos (${ands.length})`));
  if(!ands.length)box.append(el("div",{class:"note"},"Nenhum andamento registrado."));
  else box.append(el("ul",{class:"tl"},ands.map(a=>el("li",{},
    el("div",{class:"d"},fmtD(parseD(a.data)),a.tipo?" · "+a.tipo:"",cliente?null:el("span",{class:"pill "+(a.visivel_cliente?"e1":"e2"),style:"margin-left:6px"},a.visivel_cliente?"Visível ao cliente":"Interno"),a.fonte&&a.fonte!=="manual"?el("span",{class:"pill c",style:"margin-left:6px"},a.fonte):null),
    el("div",{style:"white-space:pre-wrap"},a.descricao),
    cliente?null:el("div",{class:"actions edit-only",style:"justify-content:flex-start;margin-top:4px"},el("button",{class:"btn sm",onclick:()=>openAndamentoForm(p,a)},"Editar"))))));
  return box;
}
function openProcessoForm(c,p={}){
  const cnj=inp("text",p.numero_cnj||"",{placeholder:"0000000-00.0000.0.00.0000"}),trib=inp("text",p.tribunal||"",{placeholder:"Ex.: TJSP"}),vara=inp("text",p.vara||"",{placeholder:"Ex.: 2ª Vara Cível de Campinas"}),
        acao=datalistInput("p-acao",p.tipo_acao||"",TIPOS_ACAO),parte=inp("text",p.parte_contraria||""),polo=sel(POLOS,p.polo||"passivo"),kon=selContrato(c,p.contrato_id),
        banco=datalistInput("p-banco",p.banco||"",Object.keys(S.regras.fatoresBanco||{})),fase=datalistInput("p-fase",p.fase||"",FASES_PROC),valor=inp("number",p.valor_causa||"",{step:"100"}),prazo=inp("date",p.proximo_prazo||""),
        fatal=check("Prazo fatal",p.prazo_fatal),resp=selColab(p.responsavel_id||meuColab()?.id),status=sel(STATUS_PROC,p.status||"ativo"),vis=check("Visível ao cliente",p.visivel_cliente!==false,"Desmarque para manter o processo fora da área do cliente."),
        obs=el("textarea",{},p.observacoes||"");
  kon.onchange=()=>{const k=contratoDe(kon.value);if(k&&!banco.input.value)banco.input.value=k.banco;if(k&&!parte.value)parte.value=k.banco};
  const body=el("div",{class:"form"},field("p-cnj","Número CNJ",cnj),field("p-acao","Tipo de ação",acao.wrap),field("p-trib","Tribunal",trib),field("p-vara","Vara / comarca",vara),
    field("p-parte","Parte contrária",parte),field("p-polo","Polo do cliente",polo),field("p-con","Contrato relacionado",kon),field("p-banco","Banco relacionado",banco.wrap),
    field("p-fase","Fase",fase.wrap),field("p-valor","Valor da causa (R$)",valor),field("p-prazo","Próximo prazo",prazo),fatal.wrap,field("p-resp","Responsável",resp),field("p-status","Status",status),vis.wrap,field("p-obs","Observações internas",obs));
  const extra=p.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este processo e todos os andamentos?"))return;const {error}=await SB.from("processos").delete().eq("id",p.id);$("#modalHost").replaceChildren();M.procSel=null;toast(error?"Não foi possível excluir":"Processo excluído")}},"Excluir"):null;
  modal(p.id?"Editar processo":"Novo processo",body,async()=>{
    if(!cnj.value.trim()&&!acao.input.value.trim())throw new Error("Informe o número CNJ ou o tipo de ação");
    const row={cliente_id:c.id,numero_cnj:cnj.value.trim()||null,tipo_acao:acao.input.value.trim()||null,tribunal:trib.value.trim()||null,vara:vara.value.trim()||null,parte_contraria:parte.value.trim()||null,polo:polo.value,contrato_id:kon.value||null,banco:banco.input.value.trim()||null,fase:fase.input.value.trim()||null,valor_causa:valor.value===""?null:+valor.value,proximo_prazo:prazo.value||null,prazo_fatal:fatal.input.checked,responsavel_id:resp.value||null,status:status.value,visivel_cliente:vis.input.checked,observacoes:obs.value.trim()||null};
    const q=p.id?SB.from("processos").update(row).eq("id",p.id):SB.from("processos").insert(row).select("id").single();
    const {data,error}=await q;if(error)throw new Error(error.code==="23505"?"Já existe um processo com este número CNJ":"Não foi possível salvar");
    if(data?.id)M.procSel=data.id;toast("Processo salvo");
  },extra);
}
function openAndamentoForm(p,a={}){
  const data=inp("date",a.data||hojeISO()),tipo=datalistInput("a-tipo",a.tipo||"",TIPOS_AND),desc=el("textarea",{placeholder:"Resumo do andamento e o que ele exige do escritório."},a.descricao||""),vis=check("Visível ao cliente",a.visivel_cliente,"O andamento também entra na timeline do cliente com esta mesma visibilidade.");
  const body=el("div",{class:"form"},field("a-data","Data",data),field("a-tipo","Tipo",tipo.wrap),field("a-desc","Descrição",desc),vis.wrap);
  const extra=a.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este andamento?"))return;const {error}=await SB.from("andamentos").delete().eq("id",a.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir":"Andamento excluído")}},"Excluir"):null;
  modal(a.id?"Editar andamento":"Novo andamento",body,async()=>{
    if(!desc.value.trim())throw new Error("Descreva o andamento");
    const row={processo_id:p.id,data:data.value,tipo:tipo.input.value.trim()||null,descricao:desc.value.trim(),visivel_cliente:vis.input.checked};
    const {error}=a.id?await SB.from("andamentos").update(row).eq("id",a.id):await SB.from("andamentos").insert(row);
    if(error)throw error;toast("Andamento registrado");
  },extra);
}

/* ---------- Integração com o painel ---------- */
window.PP_MOD={
  timeline:renderTimeline,
  processos:renderProcessos,
  contagens:c=>garantirCarregado(c)?{timeline:M.timeline.length,processos:M.processos.filter(p=>p.status!=="encerrado").length}:{}
};
const h=(location.hash||"").slice(1);if(["timeline","processos"].includes(h))S.sub=h;
window.__PP_LOGIN.then(async()=>{await garantirColaboradorProprio();ligarTempoRealCarteira()});
})();
