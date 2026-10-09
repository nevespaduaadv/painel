/* Comercial — CRM de leads (portado de crm-leads): kanban por fase com arrastar-e-soltar, lista, ficha do lead
   (oportunidade, formulário, tags, observações, histórico/auditoria), importação de planilha (CSV/XLSX) e relatórios.
   Supabase: leads, fases, tags, lead_tags, observacoes, historico_fases, leads_auditoria, v_leads (0027). Só equipe. */
(()=>{
"use strict";
const L={leads:[],fases:[],perfis:[],tags:[],motivos:[],tarefas:[],hist:null,ok:false,carregando:false,modo:"kanban",visao:"abertas",ordem:"entrada_desc",
  f:{busca:"",proprietario:"",status:"",tag:"",campanha:"",anuncio:"",de:"",ate:"",atraso:false,semTarefa:false,vencida:false},tarefasSo:"minhas",sel:null,aba:"oportunidade",obs:[],histLead:[],audit:[],
  rel:{periodo:"30d",proprietario:"",campanha:""},recolhidas:new Set(JSON.parse(localStorage.getItem("pp.leads.recolhidas")||"[]"))};
const STATUS=["Aberto","Perdido","Ganho","Abandonado"];const FASE_GANHO=10,FASE_NO_SHOW=5;
const TIPO_TAREFA={ligar:"Ligar",whatsapp:"WhatsApp",social_selling:"Social selling",se_agendada:"SE agendada",se_realizada:"SE realizada",se_noshow:"SE no-show",segunda_call:"2ª call",follow_up:"Follow-up",prazo:"Prazo",tarefa:"Tarefa",email:"E-mail",pagar:"Cobrar pagamento"};
const DONO={sdr:"SDR",closer:"Closer",ambos:"SDR + Closer"};
const COR_STATUS={Aberto:"#2a78d6",Ganho:"#1baf7a",Perdido:"#4a3aa7",Abandonado:"#eda100"};
const ORIGEM={planilha:"Planilha (Meta Ads)",chatguru:"Chegou pelo ChatGuru",manual:"Cadastrado à mão"};
const CAMPOS_FORM=[["nome","Nome"],["email","E-mail"],["whatsapp","WhatsApp"],["empresa","Nome comercial / empresa"],["tipo_divida","Tipo de dívida"],["situacao_divida","Situação das dívidas"],["valor_divida","Valor da dívida (faixa)"],["outras_dividas","Além do Pronampe, o que mais tem?"],["melhor_horario","Melhor horário para contato"],["campanha","Campanha"],["publico","Público"],["anuncio","Anúncio"]];
const ROTULOS={...Object.fromEntries(CAMPOS_FORM),status:"Status",valor:"Valor",proprietario_id:"Proprietário",data_entrada:"Data de entrada",data_fechamento:"Data de fechamento",motivo_perda:"Motivo",link_chat:"Link do chat",reuniao_em:"Reunião",responsavel_chatguru:"Responsável ChatGuru",chatguru_chat_id:"ID do chat ChatGuru",origem:"Origem",fase_id:"Fase"};
const CAMPOS_IMPORT=[["data_entrada","Data de entrada",["data","f","data de entrada","created time","created_time"]],["nome","Nome",["nome","nome completo","full name","full_name"]],["email","E-mail",["email","e-mail"]],["whatsapp","WhatsApp *",["whatsapp","telefone","celular","phone","phone_number"]],["empresa","Empresa",["nome da empresa","empresa","nome comercial"]],["tipo_divida","Tipo de dívida",["tipo de divida"]],["situacao_divida","Situação das dívidas",["situacao das suas dividas","situacao das dividas"]],["valor_divida","Valor da dívida",["valor da divida"]],["outras_dividas","Além do Pronampe",["alem do pronampe, o que mais tem?","alem do pronampe"]],["melhor_horario","Melhor horário",["melhor horario para contato","melhor horario"]],["campanha","Campanha",["campanha","campaign_name"]],["publico","Público",["publico","adset_name"]],["anuncio","Anúncio",["anuncio","ad_name"]],["observacao","Observação (vira 1ª nota)",["status","observacao","observacoes"]]];
const admin=()=>PP.perfil?.papel==="admin";
const semAcento=s=>(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const normTxt=s=>semAcento(String(s??"")).trim().replace(/\s+/g," ");
const p2=n=>String(n).padStart(2,"0");
const dataLocal=v=>{const d=new Date(v);return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`};
const fmtD=v=>v?new Date(v).toLocaleDateString("pt-BR"):"—";
const semTarefa=l=>l.status==="Aberto"&&l.fase_id!==FASE_GANHO&&!(+l.tarefas_abertas);
const prazoTxt=l=>l.prazo_horas?(l.prazo_horas>=48?`${Math.round(l.horas_na_fase/24)}d/${l.prazo_horas/24}d`:`${l.horas_na_fase}h/${l.prazo_horas}h`):`${l.dias_na_fase}d`;
const fmtDH=v=>v?new Date(v).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const brl=v=>BRL(+v||0);const pc=v=>Math.round((v||0)*100)+"%";
const fone=w=>{const d=(w||"").replace(/\D/g,"");if(!d)return "";const n=d.startsWith("55")&&d.length>=12?d.slice(2):d;return n.length===11?`(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`:n.length===10?`(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`:w};
const waLink=w=>{let d=(w||"").replace(/\D/g,"");if(!d)return null;if(d.length<=11)d="55"+d;return "https://wa.me/"+d};
const nomePerfil=id=>{const p=L.perfis.find(p=>p.id===id);return p?(p.nome||p.email):null};
const faseDe=id=>L.fases.find(f=>f.id===id);
const toLocalInput=v=>{if(!v)return "";const d=new Date(v);return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`};

/* ---------- dados ---------- */
async function carregar(){
  if(L.carregando)return;L.carregando=true;
  try{
    const [f,p,t,m]=await Promise.all([SB.from("fases").select("*").order("ordem"),SB.from("perfis").select("id,nome,email,papel").in("papel",["admin","colaborador"]).order("nome"),SB.from("tags").select("*").order("nome"),SB.from("motivos_perda").select("*").eq("ativo",true).order("ordem")]);
    if(f.error)throw f.error;L.fases=f.data||[];L.perfis=p.data||[];L.tags=t.data||[];L.motivos=m.data||[];
    const todos=[];for(let i=0;;i+=1000){const {data,error}=await SB.from("v_leads").select("*").order("data_entrada",{ascending:false}).range(i,i+999);if(error)throw error;todos.push(...(data||[]));if(!data||data.length<1000)break}
    L.leads=todos.map(l=>({...l,valor:+l.valor||0,tags:l.tags||[]}));L.ok=true;
  }catch(e){console.warn("leads",e);toast("Não foi possível carregar os leads: "+(e.message||""))}
  finally{L.carregando=false}
  render();
}
const garantir=()=>{if(!L.ok&&!L.carregando)carregar();return L.ok};
const invalidar=()=>{L.ok=false;L.hist=null;if(S.tab==="leads")garantir()};
async function carregarHistorico(){const todos=[];for(let i=0;;i+=1000){const {data}=await SB.from("historico_fases").select("lead_id,para_fase_id,created_at").order("id").range(i,i+999);todos.push(...(data||[]));if(!data||data.length<1000)break}const m=new Map();for(const h of todos){if(!m.has(h.lead_id))m.set(h.lead_id,[]);m.get(h.lead_id).push(h.para_fase_id)}L.hist=m;L.histBruto=todos;return m}
async function carregarTarefas(){const q=SB.from("v_lead_tarefas").select("*").is("concluida_em",null).order("quando");const {data}=await (L.tarefasSo==="minhas"&&PP.perfil?q.eq("responsavel_id",PP.perfil.id):q);L.tarefas=data||[];L.tarefasOk=true;render()}
async function carregarTarefasLead(id){const {data}=await SB.from("v_lead_tarefas").select("*").eq("lead_id",id).order("concluida_em",{nullsFirst:true}).order("quando");L.tarefasLead=data||[];if(L.sel&&L.sel.id===id)renderDetalhe()}
async function concluirTarefa(t){const {error}=await SB.from("lead_tarefas").update({concluida_em:new Date().toISOString(),concluida_por:PP.perfil?.id||null}).eq("id",t.id);if(error){toast(error.message);return}toast("Tarefa concluída");L.tarefasOk=false;invalidar();if(L.sel)carregarTarefasLead(L.sel.id);else carregarTarefas()}
function formTarefa(l,aoSalvar){
  const tipo=sel(TIPO_TAREFA,"ligar"),q=inp("datetime-local",toLocalInput(new Date(Date.now()+36e5).toISOString())),resp=sel(Object.fromEntries(L.perfis.map(p=>[p.id,p.nome||p.email])),l.proprietario_id||PP.perfil?.id||""),tit=inp("text","",{placeholder:"Opcional: detalhe da tarefa"});
  const body=el("div",{class:"form"},field("t-tipo","Tipo",tipo),field("t-q","Quando",q),field("t-resp","Responsável",resp),field("t-tit","Detalhe",tit),el("div",{class:"f full note"},"Regra do funil: nenhum lead aberto termina o dia sem próxima tarefa, e nenhuma tarefa fica vencida."));
  modal("Nova tarefa — "+l.nome,body,async()=>{if(!q.value)throw new Error("Informe quando");const {error}=await SB.from("lead_tarefas").insert({lead_id:l.id,tipo:tipo.value,titulo:tit.value.trim()||null,quando:new Date(q.value).toISOString(),responsavel_id:resp.value||null});if(error)throw error;toast("Tarefa criada");L.tarefasOk=false;invalidar();aoSalvar&&aoSalvar()});
}
async function carregarDetalhe(id){const [o,h,a]=await Promise.all([SB.from("v_observacoes").select("*").eq("lead_id",id).order("created_at",{ascending:false}),SB.from("v_historico_fases").select("*").eq("lead_id",id).order("created_at",{ascending:false}),SB.from("leads_auditoria").select("*").eq("lead_id",id).order("created_at",{ascending:false}).limit(200)]);L.obs=o.data||[];L.histLead=h.data||[];L.audit=a.data||[];if(L.sel&&L.sel.id===id)renderDetalhe()}
async function atualizar(id,campos){const {data,error}=await SB.from("leads").update(campos).eq("id",id).select("id").single();if(error){toast(error.message);return false}invalidar();return true}

/* ---------- filtros ---------- */
function filtrados(){
  const f=L.f,b=semAcento(f.busca.trim()),dig=f.busca.replace(/\D/g,"");
  const r=L.leads.filter(l=>{
    if(L.visao==="abertas"&&(l.status==="Perdido"||l.status==="Abandonado"))return false;
    if(f.status&&l.status!==f.status)return false;
    if(f.proprietario==="sem_dono"&&l.proprietario_id)return false;
    if(f.proprietario&&f.proprietario!=="sem_dono"&&l.proprietario_id!==f.proprietario)return false;
    if(f.tag&&!l.tags.includes(f.tag))return false;
    if(f.campanha&&l.campanha!==f.campanha)return false;if(f.anuncio&&l.anuncio!==f.anuncio)return false;
    if(f.atraso&&l.atraso!=="estourado")return false;if(f.semTarefa&&!semTarefa(l))return false;if(f.vencida&&!(+l.tarefas_vencidas))return false;
    if(f.de&&dataLocal(l.data_entrada)<f.de)return false;if(f.ate&&dataLocal(l.data_entrada)>f.ate)return false;
    if(b){const t=semAcento(`${l.nome} ${l.empresa||""} ${l.email||""}`);if(!t.includes(b)&&!(dig.length>=4&&(l.whatsapp||"").replace(/\D/g,"").includes(dig)))return false}
    return true});
  const cmp={entrada_desc:(a,b)=>b.data_entrada.localeCompare(a.data_entrada),entrada_asc:(a,b)=>a.data_entrada.localeCompare(b.data_entrada),valor_desc:(a,b)=>b.valor-a.valor,valor_asc:(a,b)=>a.valor-b.valor,nome_asc:(a,b)=>a.nome.localeCompare(b.nome,"pt-BR")};
  return r.sort(cmp[L.ordem]);
}
const unicos=k=>[...new Set(L.leads.map(l=>l[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
const nFiltros=()=>["proprietario","status","tag","campanha","anuncio","de","ate","atraso","semTarefa","vencida"].filter(k=>L.f[k]).length;

/* ---------- tela ---------- */
function renderLeads(){
  const v=$("#view-leads");v.replaceChildren();
  const ok=garantir();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Comercial"),el("h1",{},"Leads"),el("div",{class:"sub"},"Funil de vendas (Empresário): arraste os cards entre as fases. Perdido e Abandonado exigem motivo; Ganho fecha a oportunidade.")),
    el("div",{class:"actions"},admin()?el("button",{class:"btn sm",title:"Confere as credenciais do ChatGuru sem enviar nada",onclick:testarChatguru},"Testar ChatGuru"):null,el("button",{class:"btn sm",onclick:()=>modalImportar()},"Importar planilha"),el("button",{class:"btn sm primary edit-only",onclick:()=>formNovo()},"+ Lead"))));
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  v.append(el("div",{class:"tabs",style:"margin:0 0 12px;justify-content:flex-start"},[["kanban","Kanban"],["lista","Lista"],["tarefas","Tarefas"],["relatorios","Relatórios"]].map(([k,l])=>el("button",{class:"tab cm-niv","aria-selected":String(L.modo===k),onclick:()=>{L.modo=k;if(k==="tarefas")L.tarefasOk=false;render()}},l))));
  if(L.modo==="relatorios"){renderRelatorios(v);return}
  if(L.modo==="tarefas"){renderTarefas(v);return}
  v.append(barraFiltros());
  const lista=filtrados();
  if(L.modo==="kanban")renderKanban(v,lista);else renderLista(v,lista);
}
function barraFiltros(){
  const i=(k,ph,type="text")=>inp(type,L.f[k],{placeholder:ph,oninput:e=>{L.f[k]=e.target.value;render()},...(type==="text"?{}:{onchange:e=>{L.f[k]=e.target.value;render()}})});
  const s=(k,opts,v)=>{const x=sel(opts,v);x.onchange=()=>{L.f[k]=x.value;render()};return x};
  const b=inp("search",L.f.busca,{placeholder:"Pesquisar nome, empresa ou telefone",class:"search",style:"max-width:280px"});b.oninput=e=>{L.f.busca=e.target.value;render()};
  const vis=sel({abertas:"Oportunidades abertas",todas:"Todas"},L.visao);vis.onchange=()=>{L.visao=vis.value;render()};
  const ord=sel({entrada_desc:"Mais recentes",entrada_asc:"Mais antigos",valor_desc:"Maior valor",valor_asc:"Menor valor",nome_asc:"Nome A–Z"},L.ordem);ord.onchange=()=>{L.ordem=ord.value;render()};
  const prop=s("proprietario",{"":"Todos os proprietários",sem_dono:"Sem proprietário",...Object.fromEntries(L.perfis.map(p=>[p.id,p.nome||p.email]))},L.f.proprietario);
  const st=s("status",{"":"Todos os status",...Object.fromEntries(STATUS.map(x=>[x,x]))},L.f.status);
  const tag=s("tag",{"":"Todas as tags",...Object.fromEntries(L.tags.map(t=>[t.nome,t.nome]))},L.f.tag);
  const camp=s("campanha",{"":"Todas as campanhas",...Object.fromEntries(unicos("campanha").map(c=>[c,c]))},L.f.campanha);
  const meu=L.perfis.find(p=>p.id===PP.perfil?.id)?el("button",{class:"btn sm",onclick:()=>{L.f.proprietario=L.f.proprietario===PP.perfil.id?"":PP.perfil.id;render()},"aria-pressed":String(L.f.proprietario===PP.perfil?.id)},"Meus leads"):null;
  const limpar=nFiltros()?el("button",{class:"btn sm",onclick:()=>{L.f={busca:L.f.busca,proprietario:"",status:"",tag:"",campanha:"",anuncio:"",de:"",ate:"",atraso:false,semTarefa:false,vencida:false};render()}},`Limpar filtros (${nFiltros()})`):null;
  const tg=(k,l,cls)=>el("button",{class:"btn sm "+(L.f[k]?cls:""),"aria-pressed":String(!!L.f[k]),onclick:()=>{L.f[k]=!L.f[k];render()}},l);
  const nEst=L.leads.filter(l=>l.atraso==="estourado"&&(L.visao==="todas"||l.status==="Aberto")).length,nSem=L.leads.filter(semTarefa).length,nVen=L.leads.filter(l=>+l.tarefas_vencidas&&l.status==="Aberto").length;
  return el("div",{class:"ld-filtros"},b,vis,ord,prop,st,tag,camp,el("label",{class:"ld-dt"},"Entrada de ",i("de","","date")),el("label",{class:"ld-dt"},"até ",i("ate","","date")),meu,tg("atraso",`⏱ Prazo estourado (${nEst})`,"ld-on-red"),tg("semTarefa",`Sem tarefa (${nSem})`,"ld-on-amber"),tg("vencida",`Tarefa vencida (${nVen})`,"ld-on-red"),limpar,el("span",{class:"note",style:"margin-left:auto"},`${filtrados().length} lead(s)`));
}
function card(l){
  const f=faseDe(l.fase_id);
  const c=el("div",{class:"ld-card"+(l.status==="Aberto"?(l.atraso==="estourado"?" ld-estourado":l.atraso==="alerta"?" ld-alerta":""):""),draggable:"true","data-id":l.id,onclick:e=>{if(e.target.closest("a,button"))return;abrirDetalhe(l)}},
    el("div",{class:"ld-top"},el("b",{},l.nome||"(sem nome)"),l.status!=="Aberto"?el("span",{class:"pill",style:`background:${COR_STATUS[l.status]}1a;color:${COR_STATUS[l.status]}`},l.status):null),
    l.empresa?el("div",{class:"note"},l.empresa):el("div",{class:"note",style:"opacity:.6"},"Sem empresa"),
    el("div",{class:"ld-meta"},el("span",{class:"num"},l.valor?brl(l.valor):"—"),el("span",{class:"note"},l.proprietario_nome||"Sem proprietário"),el("span",{class:"note ld-prazo",title:`${l.horas_na_fase}h na fase · prazo ${l.prazo_horas?l.prazo_horas+"h":"—"} · dono ${DONO[l.fase_dono]||"—"}`},"⏱ "+prazoTxt(l))),
    l.status==="Aberto"&&(semTarefa(l)||+l.tarefas_vencidas)?el("div",{class:"ld-tags"},semTarefa(l)?el("span",{class:"pill ld-pill-amber"},"sem tarefa"):null,+l.tarefas_vencidas?el("span",{class:"pill ld-pill-red"},`${l.tarefas_vencidas} tarefa(s) vencida(s)`):null,l.proxima_tarefa&&!+l.tarefas_vencidas?el("span",{class:"pill"},"próx. "+fmtDH(l.proxima_tarefa)):null):(l.proxima_tarefa&&l.status==="Aberto"?el("div",{class:"ld-tags"},el("span",{class:"pill"},"próx. "+fmtDH(l.proxima_tarefa))):null),
    l.tags.length?el("div",{class:"ld-tags"},l.tags.slice(0,3).map(t=>el("span",{class:"pill"},t)),l.tags.length>3?el("span",{class:"note"},`+${l.tags.length-3}`):null):null,
    el("div",{class:"ld-icons"},waLink(l.whatsapp)?el("a",{href:waLink(l.whatsapp),target:"_blank",title:"WhatsApp "+fone(l.whatsapp),rel:"noopener"},"💬"):el("span",{title:"Sem WhatsApp cadastrado",style:"opacity:.3"},"💬"),l.whatsapp?el("a",{href:"tel:+"+(l.whatsapp.replace(/\D/g,"").length<=11?"55":"")+l.whatsapp.replace(/\D/g,""),title:"Ligar"},"📞"):null,l.link_chat?el("a",{href:l.link_chat,target:"_blank",title:"Abrir no ChatGuru",rel:"noopener"},"🔗"):null,l.total_observacoes?el("span",{title:`${l.total_observacoes} observação(ões)`},`📝${l.total_observacoes}`):null,l.reuniao_em?el("span",{title:"Reunião "+fmtDH(l.reuniao_em)},"📅"):null,!l.proprietario_id&&PP.perfil?el("button",{class:"btn sm",style:"margin-left:auto",onclick:async()=>{await atualizar(l.id,{proprietario_id:PP.perfil.id});toast("Lead assumido")}},"Assumir"):null));
  return c;
}
function renderKanban(v,lista){
  const wrap=el("div",{class:"ld-kanban"});
  for(const f of L.fases){
    const dentro=lista.filter(l=>l.fase_id===f.id),total=dentro.reduce((a,l)=>a+l.valor,0),rec=L.recolhidas.has(f.id);
    const col=el("div",{class:"ld-col"+(rec?" rec":""),"data-st":String(f.id),style:`--cor:${f.cor}`},
      el("div",{class:"ld-col-h",onclick:()=>{rec?L.recolhidas.delete(f.id):L.recolhidas.add(f.id);localStorage.setItem("pp.leads.recolhidas",JSON.stringify([...L.recolhidas]));render()}},el("b",{},f.nome),el("span",{class:"note"},`${dentro.length} · ${brl(total)}`),rec?null:el("span",{class:"note"},[f.dono?DONO[f.dono]:null,f.prazo_horas?(f.prazo_horas>=48?`até ${f.prazo_horas/24}d`:`até ${f.prazo_horas}h`):null].filter(Boolean).join(" · ")||" ",(()=>{const n=dentro.filter(l=>l.atraso==="estourado"&&l.status==="Aberto").length;return n?el("b",{class:"ld-est",title:"prazo estourado"}," "+n+" ⏱"):null})())),
      rec?null:el("div",{class:"ld-col-b"},dentro.length?dentro.slice(0,60).map(card):el("div",{class:"note",style:"padding:8px"},"Nenhum lead nesta fase"),dentro.length>60?el("div",{class:"note"},`Mostrar mais (${dentro.length-60}) na lista`):null));
    wrap.append(col);
  }
  v.append(wrap);
  window.PP_DND?.ativar(wrap,{card:".ld-card",coluna:".ld-col",chaveCol:c=>+c.dataset.st,chaveCard:c=>c.dataset.id,aoSoltar:async(c,fase)=>{const l=L.leads.find(x=>x.id===c.dataset.id);if(!l||l.fase_id===fase)return;if(fase===FASE_GANHO&&l.status!=="Ganho"){/* Ganho pelo gatilho */}await atualizar(l.id,{fase_id:fase})}});
}
function renderLista(v,lista){
  v.append(el("div",{class:"card section"},el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},["Nome","Empresa","WhatsApp","Fase","Status","Valor","Proprietário","Entrada","Tags",""].map((h,i)=>el("th",{class:i===5?"r":""},h)))),
    el("tbody",{},lista.slice(0,500).map(l=>el("tr",{style:"cursor:pointer",onclick:e=>{if(e.target.closest("a,button"))return;abrirDetalhe(l)}},el("td",{},el("b",{},l.nome)),el("td",{},l.empresa||"—"),el("td",{},waLink(l.whatsapp)?el("a",{href:waLink(l.whatsapp),target:"_blank",rel:"noopener"},fone(l.whatsapp)):"—"),el("td",{},el("span",{class:"pill",style:`background:${l.fase_cor}`},l.fase_nome)),el("td",{},el("span",{style:`color:${COR_STATUS[l.status]};font-weight:600`},l.status)),el("td",{class:"r num"},brl(l.valor)),el("td",{},l.proprietario_nome||"—"),el("td",{},fmtD(l.data_entrada)),el("td",{},l.tags.join(", ")||"—"),el("td",{},el("button",{class:"btn sm",onclick:()=>abrirDetalhe(l)},"Abrir"))))))),lista.length>500?el("p",{class:"note"},`Mostrando 500 de ${lista.length}. Refine os filtros.`):null));
}

/* ---------- tarefas (SDR / closer) ---------- */
function renderTarefas(v){
  if(!L.tarefasOk){v.append(el("div",{class:"note"},"Carregando tarefas…"));carregarTarefas();return}
  const so=sel({minhas:"Minhas tarefas",todas:"Toda a equipe"},L.tarefasSo);so.onchange=()=>{L.tarefasSo=so.value;L.tarefasOk=false;render()};
  const hoje=dataLocal(new Date());const grupos={vencidas:[],hoje:[],proximas:[]};for(const t of L.tarefas){const d=dataLocal(t.quando);(d<hoje?grupos.vencidas:d===hoje?grupos.hoje:grupos.proximas).push(t)}
  const semTarefaLeads=L.leads.filter(semTarefa).filter(l=>L.tarefasSo==="todas"||l.proprietario_id===PP.perfil?.id||!l.proprietario_id);
  v.append(el("div",{class:"ld-filtros"},so,el("span",{class:"note"},`${grupos.vencidas.length} vencida(s) · ${grupos.hoje.length} hoje · ${grupos.proximas.length} próximas`)));
  const linha=t=>{const l=L.leads.find(x=>x.id===t.lead_id);return el("div",{class:"ld-tarefa"},el("button",{class:"btn sm",title:"Concluir",onclick:()=>concluirTarefa(t)},"✓"),el("div",{style:"flex:1;min-width:0"},el("div",{},el("b",{},TIPO_TAREFA[t.tipo]||t.tipo),t.titulo?" — "+t.titulo:"",el("span",{class:"note"},` · ${fmtDH(t.quando)}`)),el("div",{class:"note"},el("a",{href:"#leads/"+t.lead_id,onclick:e=>{e.preventDefault();if(l)abrirDetalhe(l)}},t.lead_nome),t.lead_empresa?" · "+t.lead_empresa:"",l?` · ${l.fase_nome}`:"",L.tarefasSo==="todas"?` · ${t.responsavel_nome||"sem responsável"}`:"")),waLink(t.lead_whatsapp)?el("a",{class:"btn sm",href:waLink(t.lead_whatsapp),target:"_blank",rel:"noopener"},"WhatsApp"):null)};
  const bloco=(titulo,lista,cls)=>el("div",{class:"card section"},el("h3",{class:cls},`${titulo} (${lista.length})`),lista.length?lista.map(linha):el("div",{class:"note"},"Nada aqui."));
  v.append(el("div",{class:"cm-grid",style:"grid-template-columns:1fr 1fr 1fr"},bloco("Vencidas",grupos.vencidas,"ld-h-red"),bloco("Hoje",grupos.hoje,""),bloco("Próximas",grupos.proximas,"")));
  v.append(el("div",{class:"card section"},el("h3",{class:"ld-h-amber"},`Leads abertos sem próxima tarefa (${semTarefaLeads.length})`),el("p",{class:"note"},"Regra do funil: todo lead aberto precisa ter uma tarefa programada."),semTarefaLeads.length?el("div",{class:"ld-tags"},semTarefaLeads.slice(0,60).map(l=>el("button",{class:"btn sm",onclick:()=>formTarefa(l)},`${l.nome} · ${l.fase_nome}`))):el("div",{class:"note"},"Nenhum — parabéns.")));
}

/* ---------- ficha do lead ---------- */
function abrirDetalhe(l){L.sel=l;L.aba="oportunidade";L.obs=[];L.histLead=[];L.audit=[];L.tarefasLead=[];renderDetalhe();carregarDetalhe(l.id);carregarTarefasLead(l.id)}
function renderDetalhe(){
  const l=L.leads.find(x=>x.id===L.sel.id)||L.sel;L.sel=l;
  const host=$("#modalHost");host.replaceChildren();const close=()=>{host.replaceChildren();L.sel=null};
  const body=el("div",{});
  const tabs=el("div",{class:"tabs",style:"justify-content:flex-start;margin-bottom:10px"},[["oportunidade","Oportunidade"],["tarefas",`Tarefas (${(L.tarefasLead||[]).filter(t=>!t.concluida_em).length})`],["formulario","Dados do formulário"],["observacoes",`Observações (${L.obs.length||l.total_observacoes||0})`],["historico","Histórico"]].map(([k,t])=>el("button",{class:"tab cm-niv","aria-selected":String(L.aba===k),onclick:()=>{L.aba=k;renderDetalhe()}},t)));
  body.append(tabs);
  if(L.aba==="oportunidade"){
    const fase=sel(Object.fromEntries(L.fases.map(f=>[f.id,f.nome])),String(l.fase_id)),status=sel(Object.fromEntries(STATUS.map(s=>[s,s])),l.status),valor=inp("number",l.valor,{step:"100",min:"0"}),prop=sel({"":"Sem proprietário",...Object.fromEntries(L.perfis.map(p=>[p.id,p.nome||p.email]))},l.proprietario_id||""),entrada=inp("date",dataLocal(l.data_entrada)),reuniao=inp("datetime-local",toLocalInput(l.reuniao_em)),motivo=(()=>{const opts={"":"— escolha —",...Object.fromEntries(L.motivos.map(m=>[m.rotulo,m.rotulo])),outro:"Outro (descrever)"};const s0=sel(opts,L.motivos.some(m=>m.rotulo===l.motivo_perda)?l.motivo_perda:(l.motivo_perda?"outro":""));const livre=inp("text",L.motivos.some(m=>m.rotulo===l.motivo_perda)?"":(l.motivo_perda||""),{placeholder:"Descreva o motivo",style:s0.value==="outro"?"":"display:none"});s0.onchange=()=>{livre.style.display=s0.value==="outro"?"":"none"};const w=el("div",{},s0,livre);w.get=()=>s0.value==="outro"?livre.value.trim()||null:(s0.value||null);return w})(),link=inp("url",l.link_chat,{placeholder:"https://…"});
    const fm=el("div",{class:"form"},field("ld-fase","Fase",fase),field("ld-status","Status",status),field("ld-valor","Valor da oportunidade (total do contrato)",valor),field("ld-prop","Proprietário",prop),field("ld-ent","Data de entrada",entrada),field("ld-reu","Reunião (data e hora)",reuniao),field("ld-mot","Motivo (Perdido/Abandonado)",motivo.firstChild),(()=>{const f=el("div",{class:"f"},el("label",{},"\u00a0"),motivo.lastChild);return f})(),field("ld-link","Link do chat (ChatGuru)",link),
      el("div",{class:"f full note"},`Fase: ${l.fase_nome} (${DONO[l.fase_dono]||"—"}, prazo ${l.prazo_horas?l.prazo_horas+"h":"—"}) · ${prazoTxt(l)} na fase${l.atraso==="estourado"?" — PRAZO ESTOURADO":l.atraso==="alerta"?" — perto do prazo":""} · `+`${ORIGEM[l.origem]||l.origem} · entrou em ${fmtDH(l.data_entrada)} · na fase há ${l.dias_na_fase} dia(s)`+(l.data_fechamento?` · fechado em ${fmtD(l.data_fechamento)}`:"")+(l.responsavel_chatguru?` · ChatGuru: ${l.responsavel_chatguru}`:"")));
    const tagsBox=el("div",{class:"f full"},el("label",{},"Tags"),el("div",{class:"ld-tags"},l.tags.map(t=>el("span",{class:"pill"},t," ",el("button",{class:"x",title:"Remover",onclick:async()=>{const tg=L.tags.find(x=>x.nome===t);if(tg){await SB.from("lead_tags").delete().eq("lead_id",l.id).eq("tag_id",tg.id);invalidar();setTimeout(renderDetalhe,400)}}},"×"))),(()=>{const i=inp("text","",{placeholder:"Nova tag + Enter",list:"ld-taglist",style:"width:160px"});i.onkeydown=async e=>{if(e.key!=="Enter")return;e.preventDefault();const nome=i.value.trim();if(!nome)return;let tg=L.tags.find(x=>x.nome.toLowerCase()===nome.toLowerCase());if(!tg){const {data,error}=await SB.from("tags").insert({nome}).select().single();if(error){toast(error.message);return}tg=data;L.tags.push(tg)}await SB.from("lead_tags").upsert({lead_id:l.id,tag_id:tg.id});invalidar();setTimeout(renderDetalhe,400)};return el("span",{},i,el("datalist",{id:"ld-taglist"},L.tags.map(t=>el("option",{value:t.nome}))))})()));
    fm.append(tagsBox);body.append(fm);
    body.append(el("div",{class:"actions",style:"margin-top:10px"},el("button",{class:"btn primary",onclick:async()=>{const campos={fase_id:+fase.value,status:status.value,valor:+valor.value||0,proprietario_id:prop.value||null,data_entrada:entrada.value?new Date(entrada.value+"T12:00:00").toISOString():l.data_entrada,reuniao_em:reuniao.value?new Date(reuniao.value).toISOString():null,motivo_perda:motivo.get(),link_chat:link.value||null};if(await atualizar(l.id,campos)){toast("Lead salvo");setTimeout(renderDetalhe,400)}}},"Salvar"),admin()?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este lead definitivamente?"))return;const {error}=await SB.from("leads").delete().eq("id",l.id);if(error){toast(error.message);return}close();invalidar();toast("Lead excluído")}},"Excluir"):null));
  }else if(L.aba==="tarefas"){
    const abertas=(L.tarefasLead||[]).filter(t=>!t.concluida_em),feitas=(L.tarefasLead||[]).filter(t=>t.concluida_em);
    body.append(el("div",{class:"actions",style:"margin-bottom:10px"},el("button",{class:"btn sm primary",onclick:()=>formTarefa(l,()=>carregarTarefasLead(l.id))},"+ Tarefa")),
      el("div",{class:"ld-timeline"},abertas.length?abertas.map(t=>el("div",{class:"ld-tarefa"+(new Date(t.quando)<new Date()?" ld-venc":"")},el("button",{class:"btn sm",onclick:()=>concluirTarefa(t)},"✓"),el("div",{},el("b",{},TIPO_TAREFA[t.tipo]||t.tipo),t.titulo?" — "+t.titulo:"",el("div",{class:"note"},`${fmtDH(t.quando)} · ${t.responsavel_nome||"sem responsável"}`)))):el("div",{class:"note ld-h-amber"},"Sem próxima tarefa — crie uma antes de encerrar o dia.")),
      feitas.length?el("details",{style:"margin-top:10px"},el("summary",{class:"note"},`Concluídas (${feitas.length})`),el("div",{class:"ld-timeline"},feitas.map(t=>el("div",{class:"ld-obs"},el("div",{class:"note"},`${TIPO_TAREFA[t.tipo]||t.tipo}${t.titulo?" — "+t.titulo:""} · marcada para ${fmtDH(t.quando)} · concluída em ${fmtDH(t.concluida_em)}`))))):null);
  }else if(L.aba==="formulario"){
    const F={};const fm=el("div",{class:"form"},CAMPOS_FORM.map(([k,r])=>field("ld-"+k,r,F[k]=inp(k==="email"?"email":"text",l[k]))));body.append(fm);
    body.append(el("div",{class:"actions",style:"margin-top:10px"},el("button",{class:"btn primary",onclick:async()=>{const c={};for(const k in F)c[k]=F[k].value.trim()||(k==="nome"?"Sem nome":null);if(await atualizar(l.id,c)){toast("Dados salvos");setTimeout(renderDetalhe,400)}}},"Salvar")));
  }else if(L.aba==="observacoes"){
    const ta=el("textarea",{placeholder:"Escreva uma observação…",rows:"3",style:"width:100%"});
    body.append(el("div",{},ta,el("div",{class:"actions",style:"margin:6px 0 12px"},el("button",{class:"btn sm primary",onclick:async()=>{const t=ta.value.trim();if(!t)return;const {error}=await SB.from("observacoes").insert({lead_id:l.id,texto:t,autor_id:PP.perfil.id});if(error){toast(error.message);return}ta.value="";carregarDetalhe(l.id);invalidar()}},"Adicionar observação"))),
      el("div",{class:"ld-timeline"},L.obs.length?L.obs.map(o=>el("div",{class:"ld-obs"},el("div",{class:"note"},`${o.autor_nome||"—"} · ${fmtDH(o.created_at)}`),el("div",{style:"white-space:pre-wrap"},/^(WhatsApp enviado pelo CRM|Anotação enviada ao ChatGuru|Automação do CRM):\n/.test(o.texto)?el("span",{class:"pill",style:"margin-right:6px"},o.texto.split(":\n")[0]):null,o.texto.replace(/^(WhatsApp enviado pelo CRM|Anotação enviada ao ChatGuru|Automação do CRM):\n/,"")))):el("div",{class:"note"},"Nenhuma observação ainda.")));
  }else{
    body.append(el("h3",{},"Fases"),el("div",{class:"ld-timeline"},L.histLead.map(h=>el("div",{class:"ld-obs"},el("div",{class:"note"},`${h.usuario_nome||"sistema"} · ${fmtDH(h.created_at)}`),el("div",{},h.de_fase?`${h.de_fase} → `:"",el("b",{},h.para_fase))))),
      el("h3",{style:"margin-top:12px"},"Auditoria de campos"),el("div",{class:"ld-timeline"},L.audit.length?L.audit.map(a=>el("div",{class:"ld-obs"},el("div",{class:"note"},fmtDH(a.created_at)),el("div",{},el("b",{},ROTULOS[a.campo]||a.campo),": ",el("s",{style:"opacity:.6"},a.campo==="proprietario_id"?nomePerfil(a.valor_antigo)||a.valor_antigo||"—":a.valor_antigo||"—")," → ",a.campo==="proprietario_id"?nomePerfil(a.valor_novo)||a.valor_novo||"—":a.valor_novo||"—"))):el("div",{class:"note"},"Sem alterações registradas.")));
  }
  const cardM=el("div",{class:"card ld-modal",role:"dialog","aria-modal":"true"},el("div",{class:"head"},el("div",{},el("h2",{style:"margin:0"},l.nome),el("div",{class:"note"},[l.empresa,fone(l.whatsapp),l.email].filter(Boolean).join(" · ")||"—")),el("div",{class:"actions"},l.whatsapp?el("button",{class:"btn sm gold",onclick:()=>modalChatguru(l,"mensagem")},"Enviar WhatsApp"):null,l.whatsapp?el("button",{class:"btn sm",onclick:()=>modalChatguru(l,"anotacao")},"Anotação interna"):null,l.whatsapp?el("button",{class:"btn sm",onclick:()=>abrirNoChatguru(l)},"Abrir no ChatGuru"):null,el("button",{class:"btn sm",onclick:close},"Fechar"))),body);
  host.append(el("div",{class:"modal",onclick:e=>{if(e.target.classList.contains("modal"))close()}},cardM));
}

/* ---------- ChatGuru (Edge Function "chatguru") ---------- */
async function chatguru(body){
  const {data:{session}}=await SB.auth.getSession();if(!session)throw new Error("Faça login de novo");
  const r=await fetch(SB_URL+"/functions/v1/chatguru/enviar",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({ok:false,erro:"Resposta inválida"}));if(!r.ok||j.ok===false)throw new Error(j.erro||("HTTP "+r.status));return j;
}
function modalChatguru(l,tipo){
  const ta=el("textarea",{rows:"5",placeholder:tipo==="mensagem"?"Mensagem para o WhatsApp do cliente":"Anotação para a equipe (fica só no ChatGuru)",style:"width:100%"});
  const body=el("div",{class:"form"},el("div",{class:"f full note"},tipo==="mensagem"?`Sai pelo WhatsApp do escritório para ${fone(l.whatsapp)}. Fica registrado nas observações do lead.`:"Anotação interna no chat do ChatGuru, visível só para a equipe."),el("div",{class:"f full"},ta));
  modal(tipo==="mensagem"?"Enviar WhatsApp pelo ChatGuru":"Anotação interna no ChatGuru",body,async()=>{const t=ta.value.trim();if(!t)throw new Error("Escreva o texto");const r=await chatguru({acao:tipo,lead_id:l.id,texto:t});toast(r.como==="conversa_iniciada"?"Conversa criada no ChatGuru e mensagem enviada":"Enviado");carregarDetalhe(l.id);invalidar()});
}
async function abrirNoChatguru(l){
  if(l.link_chat){window.open(l.link_chat,"_blank","noopener");return}
  try{const r=await chatguru({acao:"localizar",lead_id:l.id});if(r.como==="chat"){window.open(r.link,"_blank","noopener");invalidar()}else if(r.como==="lista"){toast("Sem campo link_crm no ChatGuru: abrindo a lista de chats; número copiado");navigator.clipboard?.writeText(r.numero);window.open(r.link,"_blank","noopener")}else toast("Este contato ainda não tem conversa no ChatGuru — envie a primeira mensagem")}catch(e){toast(e.message)}
}
async function testarChatguru(){try{const r=await chatguru({acao:"testar"});toast((r.ok?"✓ ":"✗ ")+r.descricao+(r.servidor?" ("+r.servidor+")":""))}catch(e){toast("ChatGuru: "+e.message)}}

/* ---------- novo lead ---------- */
function formNovo(){
  const nome=inp("text",""),wa=inp("text","",{placeholder:"(11) 99999-9999"}),emp=inp("text",""),email=inp("email",""),valor=inp("number","",{step:"100"}),fase=sel(Object.fromEntries(L.fases.map(f=>[f.id,f.nome])),"1"),prop=sel({"":"Sem proprietário",...Object.fromEntries(L.perfis.map(p=>[p.id,p.nome||p.email]))},PP.perfil?.id||"");
  const body=el("div",{class:"form"},field("n-nome","Nome",nome),field("n-wa","WhatsApp",wa),field("n-emp","Empresa",emp),field("n-email","E-mail",email),field("n-valor","Valor da oportunidade (R$)",valor),field("n-fase","Fase",fase),field("n-prop","Proprietário",prop));
  modal("Novo lead",body,async()=>{if(!nome.value.trim())throw new Error("Informe o nome");const {error}=await SB.from("leads").insert({nome:nome.value.trim(),whatsapp:wa.value.trim()||null,empresa:emp.value.trim()||null,email:email.value.trim()||null,valor:+valor.value||0,fase_id:+fase.value,proprietario_id:prop.value||null,origem:"manual"});if(error)throw new Error(error.code==="23505"?"Já existe um lead com este WhatsApp.":error.message);toast("Lead criado");invalidar()});
}

/* ---------- importação ---------- */
async function lerArquivo(file){
  const nome=file.name.toLowerCase();
  if(nome.endsWith(".csv")||nome.endsWith(".txt")){const txt=await file.text();const sep=(txt.match(/;/g)||[]).length>(txt.match(/,/g)||[]).length?";":",";return [{nome:file.name,linhas:csv(txt,sep)}]}
  if(!window.XLSX){await new Promise((ok,err)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";s.onload=ok;s.onerror=()=>err(new Error("Não foi possível carregar o leitor de Excel"));document.head.append(s)})}
  const wb=XLSX.read(await file.arrayBuffer(),{cellDates:true});
  return wb.SheetNames.map(n=>({nome:n,linhas:XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:null,blankrows:false})}));
}
function csv(txt,sep){const rows=[];let row=[],cell="",q=false;for(let i=0;i<txt.length;i++){const c=txt[i];if(q){if(c==='"'){if(txt[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}else if(c==='"')q=true;else if(c===sep){row.push(cell);cell=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&txt[i+1]==="\n")i++;row.push(cell);if(row.some(x=>x!==""))rows.push(row);row=[];cell=""}else cell+=c}row.push(cell);if(row.some(x=>x!==""))rows.push(row);return rows}
function converterData(v){if(v==null||v==="")return null;const iso=(a,m,d,h=0,mi=0,s=0)=>`${a}-${p2(m)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(s)}-03:00`;if(v instanceof Date)return isNaN(v)?null:iso(v.getFullYear(),v.getMonth()+1,v.getDate(),v.getHours(),v.getMinutes(),v.getSeconds());if(typeof v==="number"){const d=new Date(Math.round((v-25569)*864e5));return iso(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())}const s=String(v).trim();let m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);if(m){let a=+m[3];if(a<100)a+=2000;return iso(a,+m[2],+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0))}m=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);if(m)return iso(+m[1],+m[2],+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));return null}
const texto=v=>v==null?"":v instanceof Date?v.toLocaleString("pt-BR"):typeof v==="number"?(Number.isInteger(v)?v.toFixed(0):String(v)):String(v).trim();
function mapearAuto(cab){const nomes=cab.map(normTxt);const mapa={};for(const [campo,,sin] of CAMPOS_IMPORT){const i=nomes.findIndex(n=>sin.includes(n));if(i>=0&&!Object.values(mapa).includes(i))mapa[campo]=i}return mapa}
function modalImportar(){
  const file=inp("file","",{accept:".csv,.txt,.xlsx,.xls"});let planilhas=[],idx=0,mapa={};
  const area=el("div",{});const body=el("div",{class:"form"},field("imp-file","Importar leads (CSV ou Excel)",file,"Colunas da planilha do Meta Ads são reconhecidas sozinhas; ajuste o mapeamento se precisar. O WhatsApp é a chave: linha sem WhatsApp é ignorada e número repetido atualiza o lead."),el("div",{class:"f full"},area));
  const desenhar=()=>{area.replaceChildren();if(!planilhas.length)return;const pl=planilhas[idx];const cab=pl.linhas[0]||[];
    const aba=sel(Object.fromEntries(planilhas.map((p,i)=>[i,`${p.nome} (${Math.max(0,p.linhas.length-1)} linhas)`])),String(idx));aba.onchange=()=>{idx=+aba.value;mapa=mapearAuto(planilhas[idx].linhas[0]||[]);desenhar()};
    area.append(field("imp-aba","Aba da planilha",aba),el("h3",{},"Mapeamento de colunas (ajuste se necessário)"),el("div",{class:"form"},CAMPOS_IMPORT.map(([campo,rot])=>{const s=sel({"":"— não importar —",...Object.fromEntries(cab.map((c,i)=>[i,`${String.fromCharCode(65+i%26)}: ${texto(c)||"(vazio)"}`]))},mapa[campo]==null?"":String(mapa[campo]));s.onchange=()=>{if(s.value==="")delete mapa[campo];else mapa[campo]=+s.value};return field("imp-"+campo,rot,s)})))};
  file.onchange=async()=>{if(!file.files[0])return;try{planilhas=await lerArquivo(file.files[0]);idx=0;mapa=mapearAuto(planilhas[0]?.linhas[0]||[]);desenhar()}catch(e){toast(e.message)}};
  modal("Importar leads",body,async()=>{
    if(!planilhas.length)throw new Error("Escolha um arquivo");if(mapa.whatsapp==null)throw new Error("Mapeie a coluna de WhatsApp");
    const pl=planilhas[idx];const linhas=[];pl.linhas.slice(1).forEach((ln,i)=>{if(!ln||ln.every(c=>texto(c)===""))return;const r={_linha:i+2};for(const [campo,col] of Object.entries(mapa))r[campo]=campo==="data_entrada"?converterData(ln[col]):texto(ln[col]);linhas.push(r)});
    const tot={criados:0,atualizados:0,ignorados:0,erros:[]};
    for(let i=0;i<linhas.length;i+=200){const {data,error}=await SB.rpc("importar_leads",{linhas:linhas.slice(i,i+200)});if(error)throw error;tot.criados+=data.criados;tot.atualizados+=data.atualizados;tot.ignorados+=data.ignorados;tot.erros.push(...(data.erros||[]))}
    toast(`Importação: ${tot.criados} criados, ${tot.atualizados} atualizados, ${tot.ignorados} ignorados`+(tot.erros.length?`, ${tot.erros.length} erro(s)`:""));if(tot.erros.length)console.warn("importação",tot.erros);invalidar();
  });
}

/* ---------- relatórios ---------- */
const PERIODOS={"7d":"Últimos 7 dias","30d":"Últimos 30 dias","90d":"Últimos 90 dias",mes:"Este mês",mes_passado:"Mês passado",ano:"Este ano",tudo:"Todo o período"};
function intervalo(per){const h=new Date(),a=h.getFullYear(),m=h.getMonth(),d=h.getDate(),ate=dataLocal(new Date(a,m,d)),D=(x)=>dataLocal(x);switch(per){case "7d":return {de:D(new Date(a,m,d-6)),ate};case "30d":return {de:D(new Date(a,m,d-29)),ate};case "90d":return {de:D(new Date(a,m,d-89)),ate};case "mes":return {de:D(new Date(a,m,1)),ate};case "mes_passado":return {de:D(new Date(a,m-1,1)),ate:D(new Date(a,m,0))};case "ano":return {de:D(new Date(a,0,1)),ate};default:return {de:null,ate:null}}}
function calcular(leads,iv){
  const fases=[...L.fases].sort((a,b)=>a.ordem-b.ordem),ordem=new Map(fases.map(f=>[f.id,f.ordem])),ns=fases.find(f=>f.id===FASE_NO_SHOW);
  const antesNS=ns?Math.max(0,...fases.filter(f=>f.id!==FASE_NO_SHOW&&f.ordem<ns.ordem).map(f=>f.ordem)):0;
  const alc=l=>{const ids=[...(L.hist?.get(l.id)||[]),l.fase_id];let o=0,pns=false;for(const id of ids){if(id===FASE_NO_SHOW)pns=true;else o=Math.max(o,ordem.get(id)||0)}if(pns)o=Math.max(o,antesNS);return {ordem:o,pns}};
  const A=new Map(leads.map(l=>[l.id,alc(l)]));const total=leads.length,fr=(a,b)=>b>0?a/b:0;
  const porStatus=["Aberto","Ganho","Perdido","Abandonado"].map(s=>{const d=leads.filter(l=>l.status===s);return {status:s,quantidade:d.length,valor:d.reduce((x,l)=>x+l.valor,0)}});const g=porStatus[1];
  const etapas=fases.filter(f=>f.id!==FASE_NO_SHOW);const funil=[];for(const f of etapas){const q=leads.filter(l=>A.get(l.id).ordem>=f.ordem).length;const ant=funil.at(-1)?.quantidade??total;funil.push({fase:f,quantidade:q,acumulado:fr(q,total),conv:fr(q,ant)})}
  const agendadas=leads.filter(l=>A.get(l.id).ordem>=antesNS).length,noShows=leads.filter(l=>A.get(l.id).pns).length;
  const abertas=leads.filter(l=>l.status==="Aberto");const abertasPorEtapa=fases.map(f=>{const n=abertas.filter(l=>l.fase_id===f.id);return {fase:f,quantidade:n.length,valor:n.reduce((x,l)=>x+l.valor,0)}});
  const cm=new Map();for(const l of leads){if(l.status!=="Perdido"&&l.status!=="Abandonado")continue;const k=(l.motivo_perda||"").trim()||"Sem motivo informado";cm.set(k,(cm.get(k)||0)+1)}let motivos=[...cm].map(([motivo,quantidade])=>({motivo,quantidade})).sort((a,b)=>b.quantidade-a.quantidade);if(motivos.length>6){const r=motivos.slice(5).reduce((s,m)=>s+m.quantidade,0);motivos=[...motivos.slice(0,5),{motivo:"Outros",quantidade:r}]}
  const agrupar=(chave,nome)=>{const g2=new Map();for(const l of leads){const k=chave(l);g2.set(k,[...(g2.get(k)||[]),l])}return [...g2].map(([k,ls])=>{const gs=ls.filter(l=>l.status==="Ganho");return {nome:nome(k),leads:ls.length,reunioes:ls.filter(l=>A.get(l.id).ordem>=antesNS).length,ganhos:gs.length,conversao:fr(gs.length,ls.length),receita:gs.reduce((s,l)=>s+l.valor,0)}}).sort((a,b)=>b.leads-a.leads||b.receita-a.receita)};
  // entradas no tempo
  const datas=leads.map(l=>dataLocal(l.data_entrada)).sort();const de=iv.de||datas[0],ate=iv.ate||datas.at(-1);let entradas=[];let gran="dia";
  if(de&&ate){const D=s=>{const [a,m,d]=s.split("-").map(Number);return new Date(a,m-1,d)};const ini=D(de),fim=D(ate);const dias=Math.round((fim-ini)/864e5)+1;gran=dias<=31?"dia":dias<=183?"semana":"mes";
    const balde=d=>gran==="dia"?new Date(d.getFullYear(),d.getMonth(),d.getDate()):gran==="semana"?new Date(d.getFullYear(),d.getMonth(),d.getDate()-((d.getDay()+6)%7)):new Date(d.getFullYear(),d.getMonth(),1);
    const prox=d=>gran==="dia"?new Date(d.getFullYear(),d.getMonth(),d.getDate()+1):gran==="semana"?new Date(d.getFullYear(),d.getMonth(),d.getDate()+7):new Date(d.getFullYear(),d.getMonth()+1,1);
    const cnt=new Map();for(const s of datas){const k=dataLocal(balde(D(s)));cnt.set(k,(cnt.get(k)||0)+1)}
    for(let d=balde(ini);d<=fim;d=prox(d)){const k=dataLocal(d);entradas.push({rotulo:gran==="mes"?d.toLocaleDateString("pt-BR",{month:"short"})+"/"+String(d.getFullYear()).slice(2):`${p2(d.getDate())}/${p2(d.getMonth()+1)}`,quantidade:cnt.get(k)||0})}}
  // KPIs do material: Leads · MQL (chegou a Qualificado) · SE agendada · SE realizada
  const alc3=leads.filter(l=>A.get(l.id).ordem>=(ordem.get(3)||3)).length,alc4=leads.filter(l=>A.get(l.id).ordem>=(ordem.get(4)||4)).length,alc6=leads.filter(l=>A.get(l.id).ordem>=(ordem.get(6)||6)).length;
  // ciclo de vendas: data de entrada → fechamento (dias), geral / ganho / perdido+abandonado
  const dias=l=>{if(!l.data_fechamento||!l.data_entrada)return null;const f=String(l.data_fechamento);const d=(new Date(f.length===10?f+"T12:00:00":f)-new Date(l.data_entrada))/864e5;return Number.isFinite(d)?Math.max(0,d):null};
  const med=ls=>{const v=ls.map(dias).filter(x=>x!=null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  const ciclo={geral:med(leads.filter(l=>l.status!=="Aberto")),ganho:med(leads.filter(l=>l.status==="Ganho")),perdido:med(leads.filter(l=>l.status==="Perdido"||l.status==="Abandonado"))};
  // ganho por mês (últimos 12 meses, por data de fechamento) — todos os leads, não só a coorte
  const ganhoMes=[];{const h=new Date();for(let i=11;i>=0;i--){const d=new Date(h.getFullYear(),h.getMonth()-i,1);const k=`${d.getFullYear()}-${p2(d.getMonth()+1)}`;const ls=L.leads.filter(l=>l.status==="Ganho"&&(l.data_fechamento||"").startsWith(k));ganhoMes.push({rotulo:d.toLocaleDateString("pt-BR",{month:"short"})+"/"+String(d.getFullYear()).slice(2),quantidade:ls.length,valor:ls.reduce((s,l)=>s+l.valor,0)})}}
  // progresso: entradas em cada etapa por mês (histórico, últimos 6 meses)
  const prog=[];{const h=new Date();const fasesP=fases.filter(f=>f.id!==FASE_NO_SHOW);for(let i=5;i>=0;i--){const d=new Date(h.getFullYear(),h.getMonth()-i,1);const k=`${d.getFullYear()}-${p2(d.getMonth()+1)}`;const hs=(L.histBruto||[]).filter(x=>(x.created_at||"").startsWith(k));const visto=new Set();const por={};for(const x of hs){const kk=x.lead_id+":"+x.para_fase_id;if(visto.has(kk))continue;visto.add(kk);por[x.para_fase_id]=(por[x.para_fase_id]||0)+1}prog.push({rotulo:d.toLocaleDateString("pt-BR",{month:"short"})+"/"+String(d.getFullYear()).slice(2),por,total:Object.values(por).reduce((a,b)=>a+b,0),fases:fasesP})}}
  return {total,porStatus,valorTotal:porStatus.reduce((s,x)=>s+x.valor,0),ganhos:g.quantidade,receita:g.valor,taxa:fr(g.quantidade,total),ticket:fr(g.valor,g.quantidade),funil,noShow:{agendadas,noShows,taxa:fr(noShows,agendadas)},abertasPorEtapa,motivos,campanhas:agrupar(l=>(l.campanha||"").trim(),k=>k||"Sem campanha"),responsaveis:agrupar(l=>l.proprietario_id||"",k=>k?(nomePerfil(k)||"Usuário removido"):"Sem proprietário"),entradas,gran,kpis:{leads:total,mql:alc3,seAgendada:alc4,seRealizada:alc6},ciclo,ganhoMes,prog};
}
function renderRelatorios(v){
  if(!L.hist){v.append(el("div",{class:"note"},"Carregando histórico…"));Promise.all([carregarHistorico(),(async()=>{const d=new Date();const mes=`${d.getFullYear()}-${p2(d.getMonth()+1)}-01`;const {data}=await SB.from("metas_comerciais").select("*").eq("mes",mes).eq("nivel","meta").maybeSingle();L.metaMes=data||null})()]).then(()=>render());return}
  const R=L.rel,iv=intervalo(R.periodo);
  const leads=L.leads.filter(l=>{const e=dataLocal(l.data_entrada);if(iv.de&&e<iv.de)return false;if(iv.ate&&e>iv.ate)return false;if(R.proprietario==="sem_dono"&&l.proprietario_id)return false;if(R.proprietario&&R.proprietario!=="sem_dono"&&l.proprietario_id!==R.proprietario)return false;if(R.campanha&&(l.campanha||"")!==R.campanha)return false;return true});
  const r=calcular(leads,iv);
  const per=sel(PERIODOS,R.periodo);per.onchange=()=>{R.periodo=per.value;render()};const prop=sel({"":"Todos os proprietários",sem_dono:"Sem proprietário",...Object.fromEntries(L.perfis.map(p=>[p.id,p.nome||p.email]))},R.proprietario);prop.onchange=()=>{R.proprietario=prop.value;render()};const camp=sel({"":"Todas as campanhas",...Object.fromEntries(unicos("campanha").map(c=>[c,c]))},R.campanha);camp.onchange=()=>{R.campanha=camp.value;render()};
  v.append(el("div",{class:"ld-filtros"},per,prop,camp,el("span",{class:"note",style:"margin-left:auto"},"Base: leads que entraram no período (coorte)")));
  const kpi=(l,val,h)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num"},val),el("div",{class:"h"},h||""));
  const M=L.metaMes;const metaTxt=(k)=>M&&M[k]!=null?`meta do mês: ${M[k]}`:"";
  v.append(el("div",{class:"kpis cm-kpis"},kpi("Leads",String(r.kpis.leads),metaTxt("leads")),kpi("MQL (qualificados)",String(r.kpis.mql),`${pc(r.kpis.leads?r.kpis.mql/r.kpis.leads:0)} dos leads`),kpi("SE agendada",String(r.kpis.seAgendada),metaTxt("agendamentos")||`${pc(r.kpis.leads?r.kpis.seAgendada/r.kpis.leads:0)} dos leads`),kpi("SE realizada",String(r.kpis.seRealizada),`no-show ${pc(r.noShow.taxa)}`)));
  v.append(el("div",{class:"kpis cm-kpis",style:"margin-top:12px"},kpi("Ganhos",String(r.ganhos),`taxa de ganho ${pc(r.taxa)}`+(M&&M.contratos!=null?` · meta ${M.contratos}`:"")),kpi("Receita ganha",brl(r.receita),`ticket médio ${r.ganhos?brl(r.ticket):"—"}`),kpi("Ciclo de vendas",r.ciclo.geral!=null?`${r.ciclo.geral.toFixed(1)} dias`:"—",`ganho ${r.ciclo.ganho!=null?r.ciclo.ganho.toFixed(1)+"d":"—"} · perdido ${r.ciclo.perdido!=null?r.ciclo.perdido.toFixed(1)+"d":"—"}`),kpi("Valor das oportunidades",brl(r.valorTotal),r.porStatus.map(s=>`${s.status} ${s.quantidade}`).join(" · "))));
  // ganho por mês + progresso por etapa de entrada
  {const maxG=Math.max(1,...r.ganhoMes.map(x=>x.valor));const W=520,H=170,bw=(W-40)/12-4;let sv=`<svg viewBox="0 0 ${W} ${H}" class="cm-svg" role="img" aria-label="Valor ganho por mês">`;r.ganhoMes.forEach((x,i)=>{const h=(H-34)*x.valor/maxG,X=30+i*(bw+4);sv+=`<rect x="${X}" y="${H-24-h}" width="${bw}" height="${h}" fill="#1baf7a" opacity=".9"><title>${x.rotulo}: ${x.quantidade} ganho(s), ${brl(x.valor)}</title></rect><text x="${X+bw/2}" y="${H-10}" text-anchor="middle" class="cm-l" style="font-size:10px">${x.rotulo}</text>`;if(x.quantidade)sv+=`<text x="${X+bw/2}" y="${H-28-h}" text-anchor="middle" class="cm-n" style="font-size:10px">${x.quantidade}</text>`});sv+="</svg>";
   const maxP=Math.max(1,...r.prog.map(x=>x.total));const cores=["#8a8f98","#b8964a","#2f6fb3","#6a4fb3","#2e7d4f","#b4452f","#0c1f38","#1baf7a","#eda100"];let sp=`<svg viewBox="0 0 ${W} ${H}" class="cm-svg" role="img" aria-label="Negócios por etapa de entrada por mês">`;const bw2=(W-40)/6-8;r.prog.forEach((x,i)=>{let y=H-24;const X=30+i*(bw2+8);x.fases.forEach((f,j)=>{const n=x.por[f.id]||0;if(!n)return;const h=(H-34)*n/maxP;y-=h;sp+=`<rect x="${X}" y="${y}" width="${bw2}" height="${h}" fill="${cores[j%cores.length]}"><title>${x.rotulo} · ${f.nome}: ${n}</title></rect>`});sp+=`<text x="${X+bw2/2}" y="${H-10}" text-anchor="middle" class="cm-l" style="font-size:10px">${x.rotulo}</text>`;if(x.total)sp+=`<text x="${X+bw2/2}" y="${y-4}" text-anchor="middle" class="cm-n" style="font-size:10px">${x.total}</text>`});sp+="</svg>";
   v.append(el("div",{class:"cm-grid",style:"margin-top:16px"},el("div",{class:"card section"},el("h3",{},"Desempenho — valor ganho por mês"),el("div",{class:"note"},"Últimos 12 meses, por data de fechamento (todos os leads)"),el("div",{html:sv})),el("div",{class:"card section"},el("h3",{},"Progresso — negócios por etapa de entrada"),el("div",{class:"note"},"Entradas em cada etapa por mês (um lead conta uma vez por etapa)"),el("div",{html:sp}),el("div",{class:"ld-tags"},r.prog[0]?.fases.map((f,j)=>el("span",{class:"pill",style:`background:${cores[j%cores.length]}22;border-left:6px solid ${cores[j%cores.length]}`},f.nome))))));}
  const g=el("div",{class:"cm-grid"});
  // funil
  const maxF=Math.max(1,r.total);g.append(el("div",{class:"card section"},el("h3",{},"Funil por etapa"),el("div",{class:"ld-funil"},r.funil.map(e=>el("div",{class:"ld-frow"},el("span",{},e.fase.nome),el("div",{class:"cm-bar lg"},el("i",{style:`width:${e.quantidade/maxF*100}%;background:${e.fase.id===FASE_GANHO?"#1baf7a":"var(--navy)"}`})),el("span",{class:"num",title:"Em relação ao total de leads do período"},String(e.quantidade)),el("span",{class:"note",title:"Em relação à etapa anterior"},pc(e.conv))))),el("p",{class:"note"},`No-show: ${r.noShow.noShows} de ${r.noShow.agendadas} reuniões agendadas (${pc(r.noShow.taxa)}).`)));
  // entradas
  const maxE=Math.max(1,...r.entradas.map(p=>p.quantidade));const W=520,H=160,bw=Math.max(2,(W-40)/Math.max(1,r.entradas.length)-2);
  let svg=`<svg viewBox="0 0 ${W} ${H}" class="cm-svg" role="img" aria-label="Entrada de leads">`;r.entradas.forEach((p,i)=>{const h=(H-30)*p.quantidade/maxE,x=30+i*(bw+2);svg+=`<rect x="${x}" y="${H-20-h}" width="${bw}" height="${h}" fill="var(--navy)" opacity=".85"><title>${p.rotulo}: ${p.quantidade}</title></rect>`;if(r.entradas.length<=16||i%Math.ceil(r.entradas.length/12)===0)svg+=`<text x="${x+bw/2}" y="${H-6}" text-anchor="middle" class="cm-l" style="font-size:10px">${p.rotulo}</text>`});svg+=`<text x="2" y="12" class="cm-l">${maxE}</text></svg>`;
  g.append(el("div",{class:"card section"},el("h3",{},"Entrada de leads"),el("div",{html:svg}),el("h3",{style:"margin-top:8px"},"Oportunidades abertas por etapa"),el("div",{class:"note"},"Onde estão hoje as oportunidades em aberto"),el("div",{class:"ld-funil"},r.abertasPorEtapa.filter(e=>e.quantidade).map(e=>el("div",{class:"ld-frow"},el("span",{},e.fase.nome),el("span",{class:"num"},String(e.quantidade)),el("span",{class:"note"},brl(e.valor)))))));
  v.append(g);
  const tabela=(titulo,rows)=>el("div",{class:"card section"},el("h3",{},titulo),el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},["","Leads","Reuniões","Ganhos","Conversão","Receita"].map((h,i)=>el("th",{class:i?"r":""},h)))),el("tbody",{},rows.map(x=>el("tr",{},el("td",{},x.nome),el("td",{class:"r num"},String(x.leads)),el("td",{class:"r num"},String(x.reunioes)),el("td",{class:"r num"},String(x.ganhos)),el("td",{class:"r num"},pc(x.conversao)),el("td",{class:"r num"},brl(x.receita))))))));
  v.append(el("div",{class:"cm-grid"},tabela("Desempenho por campanha",r.campanhas),tabela("Desempenho por proprietário",r.responsaveis)));
  v.append(el("div",{class:"card section"},el("h3",{},"Motivos de perda"),el("div",{class:"note"},"Oportunidades perdidas e abandonadas"),r.motivos.length?el("div",{class:"ld-funil"},r.motivos.map(m=>el("div",{class:"ld-frow"},el("span",{},m.motivo),el("div",{class:"cm-bar lg"},el("i",{style:`width:${m.quantidade/Math.max(1,r.motivos[0].quantidade)*100}%;background:#4a3aa7`})),el("span",{class:"num"},String(m.quantidade))))):el("div",{class:"note"},"Nenhuma perda no período.")));
}

/* ---------- estilo e registro ---------- */
document.head.append(el("style",{},`
.ld-filtros{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.ld-filtros select,.ld-filtros input{padding:6px 8px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);font-size:13px}.ld-dt{font-size:12px;color:var(--muted);display:flex;gap:4px;align-items:center}
.ld-kanban{display:flex;gap:10px;overflow-x:auto;padding-bottom:12px;align-items:flex-start}.ld-col{flex:0 0 250px;background:var(--surface-2);border-radius:var(--r);border-top:4px solid var(--cor);min-height:120px}.ld-col.rec{flex-basis:46px;writing-mode:vertical-rl;min-height:220px}.ld-col.rec .ld-col-h{flex-direction:row;gap:8px}
.ld-col-h{padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;font-size:13px}.ld-col-b{display:flex;flex-direction:column;gap:8px;padding:0 8px 8px;max-height:72vh;overflow-y:auto}
.ld-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:8px 10px;font-size:13px;display:flex;flex-direction:column;gap:4px;cursor:grab}.ld-card:hover{border-color:var(--gold)}.ld-top{display:flex;justify-content:space-between;gap:6px;align-items:flex-start}
.ld-meta{display:flex;gap:8px;justify-content:space-between;font-size:12px}.ld-tags{display:flex;gap:4px;flex-wrap:wrap}.ld-tags .pill{font-size:11px;padding:1px 7px;background:var(--gold-soft)}.ld-tags .pill .x{border:0;background:none;cursor:pointer;font-weight:700;padding:0 2px}
.ld-icons{display:flex;gap:8px;align-items:center;font-size:14px}.ld-icons a{text-decoration:none}
.ld-modal{width:min(820px,96vw);max-height:92vh;overflow:auto}.ld-timeline{display:flex;flex-direction:column;gap:6px}.ld-obs{border-left:3px solid var(--line);padding:4px 10px}
.ld-card.ld-alerta{border-left:4px solid var(--warn)}.ld-card.ld-estourado{border-left:4px solid var(--crit);background:color-mix(in srgb,var(--crit) 7%,var(--surface))}.ld-est{color:var(--crit)}
.ld-pill-amber{background:color-mix(in srgb,var(--warn) 22%,transparent)!important;color:var(--warn)}.ld-pill-red{background:color-mix(in srgb,var(--crit) 18%,transparent)!important;color:var(--crit)}.ld-on-red{border-color:var(--crit);color:var(--crit)}.ld-on-amber{border-color:var(--warn);color:var(--warn)}
.ld-tarefa{display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:13px}.ld-tarefa.ld-venc{color:var(--crit)}.ld-h-red{color:var(--crit)}.ld-h-amber{color:var(--warn)}
.ld-funil{display:flex;flex-direction:column;gap:6px}.ld-frow{display:flex;align-items:center;gap:10px;font-size:13px}.ld-frow>span:first-child{width:170px}.ld-frow .num{width:40px;text-align:right}.ld-frow .note{width:48px}
`));
window.PP_LEADS={invalidar,render:renderLeads,get leads(){return L.leads},get hist(){return L.hist},carregarHistorico,get fases(){return L.fases}};
{const _h=window.aplicarHash;window.aplicarHash=function(){const h=(location.hash||"").slice(1);const m=/^leads\/([\w-]+)$/i.exec(h);if(m){L.abrirId=m[1]}return _h.apply(this,arguments)}}
{const _r=render;render=function(){_r();const vl=$("#view-leads");if(!vl)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="leads")S.tab="clientes";vl.hidden=S.tab!=="leads";if(S.tab==="leads"){renderLeads();if(L.abrirId&&L.ok){const l=L.leads.find(x=>x.id===L.abrirId);L.abrirId=null;if(l)abrirDetalhe(l)}}}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("leads");let t;const re=()=>{clearTimeout(t);t=setTimeout(invalidar,500)};ch.on("postgres_changes",{event:"*",schema:"public",table:"leads"},re);ch.on("postgres_changes",{event:"*",schema:"public",table:"observacoes"},()=>{if(L.sel)carregarDetalhe(L.sel.id)});ch.subscribe()}});
})();
