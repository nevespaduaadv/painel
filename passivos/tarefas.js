/* Módulo de tarefas, prazos e timesheet (Supabase: tarefas, apontamentos_horas e views v_tarefas, v_apontamentos,
   v_tarefas_pontualidade). Carregado depois de carteira.js; usa os utilitários globais do painel. Só equipe. */
(()=>{
"use strict";
const NUCLEOS={juridico:"Jurídico",acordos:"Acordos",acompanhamento_pj:"Acompanhamento PJ",pos_vendas:"Pós-vendas",comercial:"Comercial",marketing:"Marketing",administrativo:"Administrativo",rh:"RH",socios:"Sócios"};
const STATUS={aberta:"Aberta",em_andamento:"Em andamento",concluida:"Concluída",cancelada:"Cancelada"};
const PRIORIDADE={1:"Alta",2:"Normal",3:"Baixa"};
const FAIXAS=[["atrasada","Atrasadas","e3"],["hoje","Hoje","e3"],["d7","Até 7 dias","e2"],["d15","Até 15 dias","g"],["d30","Até 30 dias","g"],["depois","Depois de 30 dias",""],["sem_prazo","Sem prazo",""],["fechada","Concluídas / canceladas",""]];
const TIPOS_ATIV={solicitacao_documentos:"Solicitação de documentos",requerimento_bacen:"Requerimento ao Bacen",analise_contrato:"Análise de contrato",parecer_tecnico:"Parecer técnico",contato_banco:"Contato com jurídico do banco",proposta_acordo:"Proposta de acordo",reuniao_cliente:"Reunião com cliente",ata:"Ata",protocolo:"Protocolo",andamento:"Andamento processual",peticao:"Petição",audiencia:"Audiência",atendimento:"Atendimento",interno:"Interno / administrativo",outro:"Outro"};
const hojeISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addD=(s,n)=>{const d=parseD(s);d.setDate(d.getDate()+n);return iso(d)};
const horasFmt=h=>{h=+h||0;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};

const T={tarefas:[],colab:[],processos:[],ok:false,carregando:false,f:{status:"abertas",resp:"",nucleo:"",cliente:"",fatais:false},
         ap:{data:hojeISO(),colab:null,semana:null,lista:[],periodoIni:null,periodoFim:null,rel:null,pont:[]}};

/* ---------- Dados ---------- */
async function carregar(){
  if(T.carregando)return;T.carregando=true;
  try{
    const [t,c,p]=await Promise.all([SB.from("v_tarefas").select("*").order("prazo",{ascending:true,nullsFirst:false}),SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo").order("nome"),SB.from("processos").select("id,cliente_id,numero_cnj,parte_contraria")]);
    if(t.error)throw t.error;
    T.tarefas=t.data;T.colab=c.data||[];T.processos=p.data||[];T.ok=true;
  }catch(e){console.warn("tarefas",e);toast("Não foi possível carregar as tarefas")}
  finally{T.carregando=false}
  render();
}
function garantir(){if(!T.ok&&!T.carregando)carregar();return T.ok}
let rtT=null;
function tempoReal(){
  const ch=SB.channel("tarefas");
  ch.on("postgres_changes",{event:"*",schema:"public",table:"tarefas"},()=>{clearTimeout(rtT);rtT=setTimeout(()=>{T.ok=false;garantir()},400)});
  ch.on("postgres_changes",{event:"*",schema:"public",table:"apontamentos_horas"},()=>{clearTimeout(rtT);rtT=setTimeout(()=>{T.ok=false;if(S.tab==="horas")carregarHoras();else garantir()},400)});
  ch.subscribe();
}
const meuColab=()=>T.colab.find(c=>c.perfil_id===PP.perfil?.id);
const nomeColab=id=>T.colab.find(c=>c.id===id)?.nome||"—";
const selColab=(v,vazio="—")=>sel({"":vazio,...Object.fromEntries(T.colab.filter(c=>c.ativo!==false||c.id===v).map(c=>[c.id,c.nome]))},v||"");
const selCliente=(v,vazio="— sem cliente —")=>sel({"":vazio,...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome]))},v||"");
const check=(label,checked,help)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;const w=el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},i,label),help?el("div",{class:"help"},help):null);return {wrap:w,input:i}};
function csv(nome,linhas,colunas){
  const esc=v=>{if(v==null)return"";v=typeof v==="object"?JSON.stringify(v):String(v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const txt="﻿"+[colunas.join(";"),...linhas.map(l=>colunas.map(c=>esc(l[c])).join(";"))].join("\r\n");
  const a=el("a",{href:URL.createObjectURL(new Blob([txt],{type:"text/csv;charset=utf-8"})),download:nome+".csv"});document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}

/* ---------- Lista de tarefas ---------- */
function filtrar(lista,f){
  return lista.filter(t=>(f.status==="abertas"?t.status==="aberta"||t.status==="em_andamento":f.status==="todas"?true:t.status===f.status)
    &&(!f.resp||t.responsavel_id===f.resp)&&(!f.nucleo||t.nucleo===f.nucleo)&&(!f.cliente||t.cliente_id===f.cliente)&&(!f.fatais||t.prazo_fatal));
}
function linhaTarefa(t,{mostrarCliente=true}={}){
  const done=el("input",{type:"checkbox",title:"Concluir",style:"width:18px;height:18px;accent-color:var(--gold);cursor:pointer;flex:none;margin-top:3px"});done.checked=t.status==="concluida";
  done.onchange=async()=>{const {error}=await SB.from("tarefas").update({status:done.checked?"concluida":"aberta"}).eq("id",t.id);if(error){toast("Não foi possível atualizar");done.checked=!done.checked}else toast(done.checked?"Tarefa concluída":"Tarefa reaberta")};
  const prazo=t.prazo?el("span",{class:"pill "+(t.faixa==="atrasada"||t.faixa==="hoje"?"e3":t.faixa==="d7"?"e2":"g")},fmtD(parseD(t.prazo)),t.prazo_fatal?" · FATAL":"",t.faixa==="atrasada"?` · ${-t.dias_para_prazo}d atrás`:t.faixa==="hoje"?" · hoje":t.dias_para_prazo<=30?` · em ${t.dias_para_prazo}d`:""):el("span",{class:"note"},"sem prazo");
  const meta=[mostrarCliente?t.cliente_nome:null,t.responsavel_nome,NUCLEOS[t.nucleo],t.numero_cnj?"Proc. "+t.numero_cnj:null,t.horas_apontadas>0?horasFmt(t.horas_apontadas)+" apontadas":null].filter(Boolean).join(" · ");
  return el("div",{class:"row",style:"cursor:default;align-items:flex-start"},
    el("div",{style:"display:flex;gap:10px;align-items:flex-start;min-width:0;flex:1"},done,
      el("div",{style:"min-width:0"},el("div",{class:"n",style:t.status==="concluida"||t.status==="cancelada"?"text-decoration:line-through;color:var(--muted)":""},t.prioridade===1?el("span",{class:"pill e3",style:"margin-right:6px"},"Alta"):null,t.titulo),
        el("div",{class:"s"},meta),t.descricao?el("div",{class:"s",style:"white-space:pre-wrap;margin-top:2px"},t.descricao):null)),
    el("div",{style:"display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap;justify-content:flex-end"},prazo,
      t.status==="em_andamento"?el("span",{class:"pill c"},"Em andamento"):null,
      el("button",{class:"btn sm",onclick:()=>openHorasForm({tarefa:t})},"+ Horas"),
      el("button",{class:"btn sm",onclick:()=>openTarefaForm(t)},"Editar")));
}
function listaAgrupada(lista,opts){
  const host=el("div",{style:"display:flex;flex-direction:column;gap:14px"});
  const grupos=FAIXAS.filter(([k])=>lista.some(t=>t.faixa===k));
  if(!grupos.length)return el("div",{class:"empty"},"Nenhuma tarefa com este filtro.");
  for(const [k,l,cls] of grupos){
    const ts=lista.filter(t=>t.faixa===k).sort((a,b)=>(a.prazo||"9999").localeCompare(b.prazo||"9999")||a.prioridade-b.prioridade);
    host.append(el("div",{},el("div",{class:"eyebrow",style:"margin-bottom:6px"},el("span",{class:cls?"pill "+cls:""},l," · ",String(ts.length))),el("div",{class:"card list"},ts.map(t=>linhaTarefa(t,opts)))));
  }
  return host;
}
function renderTarefas(){
  const v=$("#view-tarefas");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Escritório"),el("h1",{},"Tarefas e prazos"),el("div",{class:"sub"},"Prazos fatais em vermelho. Quem executa, lança na hora.")),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>csv("tarefas",T.tarefas,["titulo","cliente_nome","responsavel_nome","nucleo","prazo","prazo_fatal","status","prioridade","faixa","horas_apontadas","concluida_em","created_at"])},"CSV"),el("button",{class:"btn primary",onclick:()=>openTarefaForm({})},"+ Tarefa"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const abertas=T.tarefas.filter(t=>t.status==="aberta"||t.status==="em_andamento");
  const n=k=>abertas.filter(t=>t.faixa===k).length;
  const fat=abertas.filter(t=>t.prazo_fatal&&["atrasada","hoje","d7"].includes(t.faixa)).length;
  const K=(l,val,h,cls)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num",style:cls?`color:var(--${cls})`:""},String(val)),el("div",{class:"h"},h));
  v.append(el("div",{class:"kpis"},K("Atrasadas",n("atrasada"),"prazo já passou",n("atrasada")?"crit":""),K("Hoje",n("hoje"),"vencem hoje",n("hoje")?"crit":""),K("Próximos 7 dias",n("d7"),"além de hoje"),K("8 a 15 dias",n("d15"),""),K("16 a 30 dias",n("d30"),""),K("Fatais em 7 dias",fat,"inclui atrasados",fat?"crit":"")));
  const f=T.f;
  const fStatus=sel({abertas:"Abertas e em andamento",aberta:"Só abertas",em_andamento:"Só em andamento",concluida:"Concluídas",cancelada:"Canceladas",todas:"Todas"},f.status),fResp=selColab(f.resp,"Todos os responsáveis"),fNuc=sel({"":"Todos os núcleos",...NUCLEOS},f.nucleo),fCli=selCliente(f.cliente,"Todos os clientes"),fFat=check("Só prazos fatais",f.fatais);
  fStatus.onchange=()=>{f.status=fStatus.value;render()};fResp.onchange=()=>{f.resp=fResp.value;render()};fNuc.onchange=()=>{f.nucleo=fNuc.value;render()};fCli.onchange=()=>{f.cliente=fCli.value;render()};fFat.input.onchange=()=>{f.fatais=fFat.input.checked;render()};fFat.wrap.className="";
  v.append(el("div",{class:"card section",style:"flex-direction:row;flex-wrap:wrap;gap:10px;align-items:center"},fStatus,fResp,fNuc,fCli,fFat.wrap));
  v.append(listaAgrupada(filtrar(T.tarefas,f)));
}
function renderTarefasCliente(c,host){
  host.append(el("div",{class:"section-h"},el("h2",{},"Tarefas"),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>openTarefaForm({cliente_id:c.id})},"+ Tarefa"))));
  if(!garantir()){host.append(el("div",{class:"note"},"Carregando…"));return}
  const ts=T.tarefas.filter(t=>t.cliente_id===c.id);
  const abertas=ts.filter(t=>t.status==="aberta"||t.status==="em_andamento");
  host.append(el("div",{class:"note"},`${abertas.length} aberta${abertas.length===1?"":"s"} · ${ts.length-abertas.length} fechada${ts.length-abertas.length===1?"":"s"}`));
  host.append(listaAgrupada(ts.filter(t=>t.status==="aberta"||t.status==="em_andamento"),{mostrarCliente:false}));
  const fechadas=ts.filter(t=>t.status==="concluida"||t.status==="cancelada");
  if(fechadas.length){const d=el("details",{},el("summary",{style:"cursor:pointer;color:var(--muted)"},`Ver ${fechadas.length} concluída${fechadas.length===1?"":"s"}/cancelada${fechadas.length===1?"":"s"}`),el("div",{class:"card list",style:"margin-top:8px"},fechadas.map(t=>linhaTarefa(t,{mostrarCliente:false}))));host.append(d)}
}
function openTarefaForm(t={}){
  const meu=meuColab();
  const titulo=inp("text",t.titulo||"",{placeholder:"Ex.: Protocolar embargos à execução"}),desc=el("textarea",{},t.descricao||""),cli=selCliente(t.cliente_id),
        kon=sel({"":"— sem vínculo —"},""),pro=sel({"":"— sem vínculo —"},""),resp=selColab(t.responsavel_id||meu?.id),nuc=sel({"":"—",...NUCLEOS},t.nucleo||meu?.nucleo||""),
        prazo=inp("date",t.prazo||""),fatal=check("Prazo fatal",t.prazo_fatal,"Prazo processual ou contratual improrrogável."),pri=sel(PRIORIDADE,String(t.prioridade||2)),status=sel(STATUS,t.status||"aberta"),
        hr=inp("number","",{step:"0.25",min:0,placeholder:"0"});
  const vincular=()=>{const cid=cli.value;
    kon.replaceChildren(el("option",{value:""},"— sem vínculo —"),...S.contratos.filter(k=>k.clienteId===cid).map(k=>el("option",{value:k.id,selected:k.id===t.contrato_id?"":null},shortName(k))));
    pro.replaceChildren(el("option",{value:""},"— sem vínculo —"),...T.processos.filter(p=>p.cliente_id===cid).map(p=>el("option",{value:p.id,selected:p.id===t.processo_id?"":null},(p.numero_cnj||"(sem número)")+(p.parte_contraria?" · "+p.parte_contraria:""))));};
  cli.onchange=vincular;vincular();
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{for:"tf-tit"},"Título"),Object.assign(titulo,{id:"tf-tit"})),field("tf-cli","Cliente",cli),field("tf-resp","Responsável",resp),field("tf-nuc","Núcleo",nuc),
    field("tf-kon","Contrato",kon),field("tf-pro","Processo",pro),field("tf-prazo","Prazo",prazo),fatal.wrap,field("tf-pri","Prioridade",pri),field("tf-status","Status",status),
    field("tf-desc","Descrição",desc),t.id?null:field("tf-hr","Horas já gastas (opcional)",hr,"Cria um apontamento de hoje em seu nome."));
  const extra=t.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta tarefa?"))return;const {error}=await SB.from("tarefas").delete().eq("id",t.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir":"Tarefa excluída")}},"Excluir"):null;
  modal(t.id?"Editar tarefa":"Nova tarefa",body,async()=>{
    if(!titulo.value.trim())throw new Error("Informe o título");
    const row={titulo:titulo.value.trim(),descricao:desc.value.trim()||null,cliente_id:cli.value||null,contrato_id:kon.value||null,processo_id:pro.value||null,responsavel_id:resp.value||null,nucleo:nuc.value||null,prazo:prazo.value||null,prazo_fatal:fatal.input.checked,prioridade:+pri.value,status:status.value};
    let id=t.id;
    if(id){const {error}=await SB.from("tarefas").update(row).eq("id",id);if(error)throw error}
    else{const {data,error}=await SB.from("tarefas").insert(row).select("id").single();if(error)throw error;id=data.id;
      if(+hr.value>0){if(!meu)throw new Error("Tarefa salva, mas você não tem registro de colaborador para apontar horas");const {error:e2}=await SB.from("apontamentos_horas").insert({colaborador_id:meu.id,data:hojeISO(),horas:+hr.value,cliente_id:cli.value||null,tarefa_id:id,tipo_atividade:"outro",descricao:titulo.value.trim()});if(e2)throw e2}}
    toast("Tarefa salva");
  },extra);
}

/* ---------- Horas (timesheet) ---------- */
function semanaDe(dStr){const d=parseD(dStr);const dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);const ini=iso(d);return {ini,fim:addD(ini,6)}}
async function carregarHoras(){
  const ap=T.ap;if(!T.ok)await carregar();
  if(!ap.colab)ap.colab=meuColab()?.id||null;
  ap.semana=semanaDe(ap.data);
  if(!ap.periodoIni){const h=hojeISO();ap.periodoIni=h.slice(0,8)+"01";ap.periodoFim=h}
  const [l,r,p]=await Promise.all([
    ap.colab?SB.from("v_apontamentos").select("*").eq("colaborador_id",ap.colab).gte("data",ap.semana.ini).lte("data",ap.semana.fim).order("data").order("created_at"):{data:[]},
    SB.from("v_apontamentos").select("colaborador_id,colaborador_nome,nucleo,cliente_id,cliente_nome,tipo_atividade,horas,data").gte("data",ap.periodoIni).lte("data",ap.periodoFim),
    SB.from("v_tarefas_pontualidade").select("*")]);
  ap.lista=l.data||[];ap.rel=r.data||[];ap.pont=p.data||[];
  if(S.tab==="horas")render();
}
function renderHoras(){
  const v=$("#view-horas");v.replaceChildren();const ap=T.ap;
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Timesheet"),el("h1",{},"Horas"),el("div",{class:"sub"},"Horas lançadas na timeline entram aqui automaticamente. Aqui você lança o restante e acompanha a produtividade.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:()=>openHorasForm({})},"+ Lançar horas"))));
  if(!ap.rel){v.append(el("div",{class:"note"},"Carregando…"));carregarHoras();return}
  /* Semana */
  const admin=PP.perfil?.papel==="admin";
  const nav=el("div",{class:"actions",style:"justify-content:flex-start;align-items:center"},
    el("button",{class:"btn sm",onclick:()=>{ap.data=addD(ap.data,-7);carregarHoras()}},"‹"),el("b",{},`${fmtD(parseD(ap.semana.ini))} – ${fmtD(parseD(ap.semana.fim))}`),el("button",{class:"btn sm",onclick:()=>{ap.data=addD(ap.data,7);carregarHoras()}},"›"),
    el("button",{class:"btn sm",onclick:()=>{ap.data=hojeISO();carregarHoras()}},"Hoje"),
    admin?Object.assign(selColab(ap.colab,"— colaborador —"),{onchange:e=>{ap.colab=e.target.value||null;carregarHoras()}}):el("span",{class:"note"},nomeColab(ap.colab)));
  const total=ap.lista.reduce((s,a)=>s+(+a.horas),0);
  const sem=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Semana"),el("span",{class:"note"},`${horasFmt(total)} na semana`)),nav);
  if(!ap.colab)sem.append(el("div",{class:"empty"},"Seu usuário ainda não está vinculado a um colaborador. Peça ao administrador para salvar seu perfil na aba Usuários."));
  else{
    const dias=[0,1,2,3,4,5,6].map(i=>addD(ap.semana.ini,i));
    const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"Dia"),el("th",{},"Cliente"),el("th",{},"Atividade"),el("th",{},"Descrição"),el("th",{class:"r"},"Horas"),el("th",{},""))),
      el("tbody",{},dias.flatMap(d=>{const ls=ap.lista.filter(a=>a.data===d);const tot=ls.reduce((s,a)=>s+(+a.horas),0);
        return [el("tr",{style:"background:var(--surface-2)"},el("td",{colspan:4},el("b",{},parseD(d).toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit"})),d===hojeISO()?el("span",{class:"pill g",style:"margin-left:8px"},"hoje"):null),el("td",{class:"r num"},tot?horasFmt(tot):""),el("td",{},el("button",{class:"btn sm",onclick:()=>openHorasForm({data:d})},"+"))),
          ...ls.map(a=>el("tr",{},el("td",{}),el("td",{},a.cliente_nome||"—"),el("td",{},TIPOS_ATIV[a.tipo_atividade]||a.tipo_atividade||"—",a.tarefa_titulo?el("div",{class:"note"},"Tarefa: "+a.tarefa_titulo):null),el("td",{},a.descricao||"",a.entrada_id?el("span",{class:"pill c",style:"margin-left:6px"},"timeline"):null),el("td",{class:"r num"},horasFmt(a.horas)),el("td",{},a.entrada_id?el("span",{class:"note",title:"Edite pela entrada da timeline"},"—"):el("button",{class:"btn sm",onclick:()=>openHorasForm({ap:a})},"Editar"))))]})));
    sem.append(el("div",{class:"tbl"},tb));
  }
  v.append(sem);
  /* Relatório do período */
  const ini=inp("date",ap.periodoIni),fim=inp("date",ap.periodoFim);
  const aplicar=()=>{ap.periodoIni=ini.value;ap.periodoFim=fim.value;carregarHoras()};
  const mes=(n)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+n);const i=iso(d);d.setMonth(d.getMonth()+1);d.setDate(0);ap.periodoIni=i;ap.periodoFim=iso(d);carregarHoras()};
  const rel=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Relatório de horas"),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>mes(0)},"Mês atual"),el("button",{class:"btn sm",onclick:()=>mes(-1)},"Mês anterior"),ini,fim,el("button",{class:"btn sm",onclick:aplicar},"Aplicar"),el("button",{class:"btn sm",onclick:()=>csv("horas",ap.rel,["data","colaborador_nome","nucleo","cliente_nome","tipo_atividade","horas"])},"CSV"))));
  const agrupar=(chave,rotulo)=>{const m=new Map();for(const a of ap.rel){const k=a[chave]||"—";m.set(k,(m.get(k)||0)+(+a.horas))}const tot=[...m.values()].reduce((s,x)=>s+x,0);
    const rows=[...m.entries()].sort((a,b)=>b[1]-a[1]);
    return el("div",{class:"tbl",style:"flex:1;min-width:240px"},el("table",{},el("thead",{},el("tr",{},el("th",{},rotulo),el("th",{class:"r"},"Horas"),el("th",{class:"r"},"%"))),el("tbody",{},rows.length?rows.map(([k,h])=>el("tr",{},el("td",{},chave==="tipo_atividade"?(TIPOS_ATIV[k]||k):k),el("td",{class:"r num"},horasFmt(h)),el("td",{class:"r num"},tot?Math.round(h/tot*100)+"%":"—"))):el("tr",{},el("td",{colspan:3,class:"note"},"Sem lançamentos no período")))))};
  const totP=ap.rel.reduce((s,a)=>s+(+a.horas),0);
  rel.append(el("div",{class:"note"},`${fmtD(parseD(ap.periodoIni))} – ${fmtD(parseD(ap.periodoFim))} · ${horasFmt(totP)} · ${ap.rel.length} lançamento${ap.rel.length===1?"":"s"}`),
    el("div",{style:"display:flex;gap:16px;flex-wrap:wrap"},agrupar("colaborador_nome","Por colaborador"),agrupar("cliente_nome","Por cliente"),agrupar("tipo_atividade","Por tipo de atividade")));
  v.append(rel);
  /* Pontualidade */
  const pont=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Tarefas: no prazo × atrasadas"),el("span",{class:"note"},"por responsável e núcleo, acumulado")));
  const agg=new Map();for(const r of ap.pont){const k=r.responsavel_nome||"Sem responsável";const a=agg.get(k)||{abertas:0,atrasadas:0,fatais_7d:0,concluidas:0,concluidas_no_prazo:0,concluidas_com_atraso:0};for(const f of Object.keys(a))a[f]+=+r[f]||0;agg.set(k,a)}
  pont.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Responsável"),el("th",{class:"r"},"Abertas"),el("th",{class:"r"},"Atrasadas"),el("th",{class:"r"},"Fatais 7d"),el("th",{class:"r"},"Concluídas"),el("th",{class:"r"},"No prazo"),el("th",{class:"r"},"Com atraso"))),
    el("tbody",{},agg.size?[...agg.entries()].map(([k,a])=>el("tr",{},el("td",{},k),el("td",{class:"r num"},String(a.abertas)),el("td",{class:"r num",style:a.atrasadas?"color:var(--crit);font-weight:600":""},String(a.atrasadas)),el("td",{class:"r num"},String(a.fatais_7d)),el("td",{class:"r num"},String(a.concluidas)),el("td",{class:"r num"},String(a.concluidas_no_prazo)),el("td",{class:"r num"},String(a.concluidas_com_atraso)))):el("tr",{},el("td",{colspan:7,class:"note"},"Nenhuma tarefa ainda"))))));
  v.append(pont);
}
function openHorasForm({ap,tarefa,data}={}){
  const a=ap||{};const admin=PP.perfil?.papel==="admin";const meu=meuColab();
  const colab=admin?selColab(a.colaborador_id||T.ap.colab||meu?.id,"— colaborador —"):null;
  const dt=inp("date",a.data||data||hojeISO()),hr=inp("number",a.horas||"",{step:"0.25",min:"0.25",max:24}),cli=selCliente(a.cliente_id||tarefa?.cliente_id),tar=sel({"":"— sem tarefa —"},""),
        tipo=sel(TIPOS_ATIV,a.tipo_atividade||"outro"),desc=inp("text",a.descricao||tarefa?.titulo||"",{placeholder:"Opcional"});
  const vincular=()=>{const cid=cli.value;const sel_=a.tarefa_id||tarefa?.id;tar.replaceChildren(el("option",{value:""},"— sem tarefa —"),...T.tarefas.filter(t=>(!cid||t.cliente_id===cid)&&(t.status==="aberta"||t.status==="em_andamento"||t.id===sel_)).map(t=>el("option",{value:t.id,selected:t.id===sel_?"":null},t.titulo)))};
  cli.onchange=vincular;vincular();
  const body=el("div",{class:"form"},colab?field("h-colab","Colaborador",colab):null,field("h-data","Data",dt),field("h-hr","Horas",hr,"Use frações: 0,5 = 30 min; 1,25 = 1h15."),field("h-cli","Cliente",cli),field("h-tar","Tarefa",tar),field("h-tipo","Tipo de atividade",tipo),field("h-desc","Descrição",desc));
  const extra=a.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este lançamento?"))return;const {error}=await SB.from("apontamentos_horas").delete().eq("id",a.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir":"Lançamento excluído");carregarHoras()}},"Excluir"):null;
  modal(a.id?"Editar lançamento":"Lançar horas",body,async()=>{
    const cid=colab?colab.value:(a.colaborador_id||meu?.id);
    if(!cid)throw new Error("Seu usuário não está vinculado a um colaborador. Peça ao administrador para salvar seu perfil na aba Usuários.");
    if(!(+hr.value>0))throw new Error("Informe as horas");
    const row={colaborador_id:cid,data:dt.value,horas:+hr.value,cliente_id:cli.value||null,tarefa_id:tar.value||null,tipo_atividade:tipo.value,descricao:desc.value.trim()||null};
    const {error}=a.id?await SB.from("apontamentos_horas").update(row).eq("id",a.id):await SB.from("apontamentos_horas").insert(row);
    if(error)throw new Error(error.code==="42501"?"Você só pode lançar horas em seu próprio nome":"Não foi possível salvar");
    toast("Horas lançadas");carregarHoras();
  },extra);
}

/* ---------- Integração ---------- */
window.PP_MOD=window.PP_MOD||{};
window.PP_MOD.tarefas=renderTarefasCliente;
{const _c=window.PP_MOD.contagens;window.PP_MOD.contagens=c=>{const r=_c?_c(c):{};if(!readOnly()&&garantir())r.tarefas=T.tarefas.filter(t=>t.cliente_id===c.id&&(t.status==="aberta"||t.status==="em_andamento")).length;return r}}
{const _r=render;render=function(){_r();const vt=$("#view-tarefas"),vh=$("#view-horas");if(!vt)return;
  const eq=typeof equipe==="function"&&equipe();
  if(!eq&&(S.tab==="tarefas"||S.tab==="horas"))S.tab="clientes";
  vt.hidden=S.tab!=="tarefas";vh.hidden=S.tab!=="horas";
  if(S.tab==="tarefas")renderTarefas();if(S.tab==="horas")renderHoras();}}
window.__PP_LOGIN.then(()=>{if(equipe())tempoReal()});
})();
