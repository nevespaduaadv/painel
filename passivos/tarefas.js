/* Módulo de tarefas, prazos e timesheet (Supabase: tarefas, apontamentos_horas e views v_tarefas, v_apontamentos,
   v_tarefas_pontualidade). Carregado depois de carteira.js; usa os utilitários globais do painel. Só equipe. */
(()=>{
"use strict";
const NUCLEOS={juridico:"Jurídico",acordos:"Acordos",acompanhamento_pj:"Acompanhamento PJ",pos_vendas:"Pós-vendas",comercial:"Comercial",marketing:"Marketing",administrativo:"Administrativo",rh:"RH",socios:"Sócios"};
const STATUS={aberta:"A fazer",em_andamento:"Fazendo",concluida:"Feita",cancelada:"Cancelada"};
/* Tickets entre áreas: a tarefa fica "aguardando" outra área até alguém de lá responder */
const AREAS_TICKET={juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",atendimento:"Atendimento",administrativo:"Administrativo",socios:"Sócias"};
const minhasAreas=()=>{const p=PP.perfil||{};if(p.papel==="admin")return Object.keys(AREAS_TICKET);const a=new Set(p.acessos||[]);if(a.has("equipe"))a.add("administrativo");return Object.keys(AREAS_TICKET).filter(k=>a.has(k))};
const TICKETS_ATIVOS=false; // tickets desligados a pedido da gestão (05/11/2026); dados e rpcs continuam no banco
const ticketDe=t=>TICKETS_ATIVOS?(T.tickets?.[t.id]||null):null;
const diasAg=tk=>tk?.aguardando_desde?Math.floor((Date.now()-new Date(tk.aguardando_desde))/86400000):0;
const pillTicket=t=>{const tk=ticketDe(t);if(!tk)return null;const d=diasAg(tk);const sit=tk.sla_situacao||(d>=5?"critico":d>=2?"vencido":"no_prazo");return el("span",{class:"pill "+(sit==="critico"?"e3":sit==="vencido"?"e2":"c"),title:(tk.aguardando_motivo||"")+(tk.sla_dias!=null?` · SLA ${tk.sla_dias}d`:"")},"Aguardando "+(AREAS_TICKET[tk.aguardando_area]||tk.aguardando_area)+(d?` há ${d}d`:"")+(sit==="vencido"?" · SLA vencido":sit==="critico"?" · crítico":""))};
/* motivo de reagendamento: lista cadastrada pela gestão/controladoria (+ complemento quando o motivo pede) */
function campoMotivo(){
  const lista=T.motivos||[];const selM=sel({"":"— escolha o motivo —",...Object.fromEntries(lista.map(m=>[m.id,m.motivo]))},"");const comp=el("textarea",{rows:2,placeholder:"Complemento (opcional, ou obrigatório para “Outro”)",style:"margin-top:6px"});
  const wrap=el("div",{class:"f full",style:"display:none;border-left:3px solid var(--warn);padding-left:10px"},el("label",{},"Motivo do reagendamento (obrigatório)"),lista.length?selM:el("div",{class:"note"},"Nenhum motivo cadastrado — a gestão cadastra em Gestão → Configurações."),comp,el("div",{class:"help"},"Fica no histórico da tarefa; gestão e controladoria recebem o aviso."));
  const valor=()=>{const m=lista.find(x=>x.id===selM.value);if(!m)return null;if(m.exige_complemento&&!comp.value.trim())return null;return m.motivo+(comp.value.trim()?": "+comp.value.trim():"")};
  return {wrap,valor,mostrar:v=>{wrap.style.display=v?"":"none"}};
}
function encaminharArea(t,depois){
  const area=sel(AREAS_TICKET,minhasAreas().includes("financeiro")?"socios":"financeiro");const motivo=el("textarea",{rows:3,placeholder:"O que você precisa que a área faça ou decida? Ex.: aprovar a proposta de 40% do Itaú; confirmar se o boleto de outubro foi pago."});const arq=el("input",{type:"file",multiple:""});
  const body=el("div",{class:"form"},field("tk-area","Encaminhar para a área",area),el("div",{class:"f full"},el("label",{},"O que você precisa (obrigatório)"),motivo,el("div",{class:"help"},"A tarefa fica marcada como “aguardando” essa área, com o tempo parado visível para todos. Quem atende a área recebe aviso no sino e responde aqui mesmo. Você continua responsável pela tarefa.")),el("div",{class:"f full"},el("label",{},"Anexar (ex.: a minuta para aprovação)"),arq));
  modal("Abrir ticket: "+t.titulo,body,async()=>{if(!motivo.value.trim())throw new Error("Diga o que você precisa da área");const {error}=await SB.rpc("tarefa_encaminhar",{p_tarefa:t.id,p_area:area.value,p_motivo:motivo.value.trim()});if(error)throw new Error(error.message);if(arq.files.length)await comentar(t.id,"Anexo do ticket: "+[...arq.files].map(f=>f.name).join(", "),[...arq.files]);toast("Ticket aberto para "+AREAS_TICKET[area.value]);T.tickets=null;depois?.()});
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Abrir ticket";
}
function responderTicket(t,depois){
  const tk=ticketDe(t);const resp=el("textarea",{rows:3,placeholder:"Resposta/decisão da área. Ex.: aprovado até 45%; boleto pago em 30/10."});const arq=el("input",{type:"file",multiple:""});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{},"Pedido de "+(tk?.aguardando_por_nome||"—")+" para "+(AREAS_TICKET[tk?.aguardando_area]||"")),el("div",{style:"white-space:pre-wrap;padding:8px 10px;background:var(--bg-soft,#f6f5f2);border-radius:8px"},tk?.aguardando_motivo||"")),el("div",{class:"f full"},el("label",{},"Resposta (obrigatório)"),resp,el("div",{class:"help"},"Libera a tarefa; quem pediu e o responsável recebem a resposta no sino e no histórico.")),el("div",{class:"f full"},el("label",{},"Anexar (ex.: a minuta corrigida)"),arq));
  modal("Responder ticket: "+t.titulo,body,async()=>{if(!resp.value.trim())throw new Error("Escreva a resposta");const {error}=await SB.rpc("tarefa_responder",{p_tarefa:t.id,p_resposta:resp.value.trim()});if(error)throw new Error(error.message);if(arq.files.length)await comentar(t.id,"Anexo da resposta: "+[...arq.files].map(f=>f.name).join(", "),[...arq.files]);toast("Ticket respondido");T.tickets=null;depois?.()});
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Responder";
}
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
    const [t,c,p,tk,mo]=await Promise.all([SB.from("v_tarefas").select("*").order("prazo",{ascending:true,nullsFirst:false}),SB.from("colaboradores").select("id,perfil_id,nome,apelido,nucleo,ativo").order("nome"),SB.from("processos").select("id,cliente_id,numero_cnj,parte_contraria"),SB.from("v_tickets").select("*"),SB.from("motivos_reagendamento").select("*").eq("ativo",true).order("ordem")]);
    if(t.error)throw t.error;
    T.tarefas=t.data;T.colab=c.data||[];T.processos=p.data||[];T.tickets=Object.fromEntries((tk.data||[]).map(x=>[x.id,x]));T.motivos=mo.error?null:(mo.data||[]);T.ok=true;
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
const escopoOk=t=>{const e=PP.escopoTarefas?.()||{tudo:true};if(e.tudo)return true;const meu=T.colab.find(c=>c.perfil_id===PP.perfil?.id);const minha=(meu&&t.responsavel_id===meu.id)||t.created_by===PP.perfil?.id;return minha||(e.nucleos||[]).includes(t.nucleo)};
function filtrar(lista,f){
  return lista.filter(t=>escopoOk(t)&&(f.status==="abertas"?t.status==="aberta"||t.status==="em_andamento":f.status==="todas"?true:t.status===f.status)
    &&(!f.resp||t.responsavel_id===f.resp)&&(!f.nucleo||t.nucleo===f.nucleo)&&(!f.cliente||t.cliente_id===f.cliente)&&(!f.fatais||t.prazo_fatal)
    &&(!f.tickets||(f.tickets==="minhas"?(ticketDe(t)&&minhasAreas().includes(ticketDe(t).aguardando_area)):!!ticketDe(t))));
}
function linhaTarefa(t,{mostrarCliente=true}={}){
  const done=el("input",{type:"checkbox",title:"Concluir",style:"width:18px;height:18px;accent-color:var(--gold);cursor:pointer;flex:none;margin-top:3px"});done.checked=t.status==="concluida";
  done.onchange=async()=>{if(done.checked){done.checked=false;openTarefa(t);setTimeout(()=>$("#modalHost textarea")?.focus(),300);return}const {error}=await SB.from("tarefas").update({status:"aberta"}).eq("id",t.id);if(error){toast("Não foi possível atualizar");done.checked=true;return}toast("Tarefa reaberta")};
  const prazo=t.prazo?el("span",{class:"pill "+(t.faixa==="atrasada"||t.faixa==="hoje"?"e3":t.faixa==="d7"?"e2":"g")},fmtD(parseD(t.prazo)),t.hora?" "+String(t.hora).slice(0,5).replace(":","h"):"",t.prazo_fatal?" · FATAL":"",t.faixa==="atrasada"?` · ${-t.dias_para_prazo}d atrás`:t.faixa==="hoje"?" · hoje":t.dias_para_prazo<=30?` · em ${t.dias_para_prazo}d`:""):el("span",{class:"note"},"sem prazo");
  const meta=[mostrarCliente?t.cliente_nome:null,t.responsavel_nome,NUCLEOS[t.nucleo],t.numero_cnj?"Proc. "+t.numero_cnj:null,t.horas_apontadas>0?horasFmt(t.horas_apontadas)+" apontadas":null].filter(Boolean).join(" · ");
  const trilha=[t.criado_por_nome?`aberta por ${t.criado_por_nome} em ${fmtDT(t.created_at)}`:t.created_at?`aberta em ${fmtDT(t.created_at)}`:null,t.status==="concluida"&&t.concluida_em?`concluída${t.concluida_por_nome?" por "+t.concluida_por_nome:""} em ${fmtDT(t.concluida_em)}`:null].filter(Boolean).join(" · ");
  return el("div",{class:"row",style:"cursor:default;align-items:flex-start"},
    el("div",{style:"display:flex;gap:10px;align-items:flex-start;min-width:0;flex:1"},done,
      el("div",{style:"min-width:0;cursor:pointer",title:"Abrir a tarefa",onclick:()=>openTarefa(t)},el("div",{class:"n",style:t.status==="concluida"||t.status==="cancelada"?"text-decoration:line-through;color:var(--muted)":""},t.prioridade===1?el("span",{class:"pill e3",style:"margin-right:6px"},"Alta"):null,t.etapa_codigo?el("span",{class:"pill",style:"margin-right:6px;border-color:var(--line);color:var(--muted)",title:"Etapa de uma cadeia de prazo fracionado"},({analisar:"1 · Analisar",confeccionar:"Confeccionar",custas:"Custas",protocolar:"Protocolar",conferir:"Conferir protocolo"})[t.etapa_codigo]||t.etapa_codigo):null,t.titulo),
        el("div",{class:"s"},meta),trilha?el("div",{class:"s",style:"color:var(--faint);font-size:12px"},trilha):null,t.descricao?el("div",{class:"s",style:"white-space:pre-wrap;margin-top:2px"},t.descricao):null)),
    el("div",{style:"display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap;justify-content:flex-end"},prazo,pillTicket(t),
      t.status==="em_andamento"&&!ticketDe(t)?el("span",{class:"pill c"},"Fazendo"):null,
      el("button",{class:"btn sm primary",onclick:()=>openTarefa(t)},"Abrir")));
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
  if(T.abrir&&T.ok){const t=T.tarefas.find(x=>x.id===T.abrir);T.abrir=null;if(t)setTimeout(()=>openTarefa(t),0)}
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Escritório"),el("h1",{},"Tarefas e prazos"),el("div",{class:"sub"},"Prazos fatais em vermelho. Quem executa, lança na hora.")),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>csv("tarefas",T.tarefas,["titulo","cliente_nome","responsavel_nome","nucleo","prazo","prazo_fatal","status","prioridade","faixa","horas_apontadas","concluida_em","created_at"])},"CSV"),el("button",{class:"btn primary",onclick:()=>openTarefaForm({})},"+ Tarefa"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const abertas=T.tarefas.filter(t=>escopoOk(t)&&(t.status==="aberta"||t.status==="em_andamento"));
  const n=k=>abertas.filter(t=>t.faixa===k).length;
  const fat=abertas.filter(t=>t.prazo_fatal&&["atrasada","hoje","d7"].includes(t.faixa)).length;
  const K=(l,val,h,cls)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num",style:cls?`color:var(--${cls})`:""},String(val)),el("div",{class:"h"},h));
  v.append(el("div",{class:"kpis"},K("Atrasadas",n("atrasada"),"prazo já passou",n("atrasada")?"crit":""),K("Hoje",n("hoje"),"vencem hoje",n("hoje")?"crit":""),K("Próximos 7 dias",n("d7"),"além de hoje"),K("8 a 15 dias",n("d15"),""),K("16 a 30 dias",n("d30"),""),K("Fatais em 7 dias",fat,"inclui atrasados",fat?"crit":"")));
  const f=T.f;
  const fStatus=sel({abertas:"A fazer e fazendo",aberta:"Só a fazer",em_andamento:"Só fazendo",concluida:"Feitas",cancelada:"Canceladas",todas:"Todas"},f.status),fResp=selColab(f.resp,"Todos os responsáveis"),fNuc=sel({"":"Todos os núcleos",...NUCLEOS},f.nucleo),fCli=selCliente(f.cliente,"Todos os clientes"),fFat=check("Só prazos fatais",f.fatais);
  fStatus.onchange=()=>{f.status=fStatus.value;render()};fResp.onchange=()=>{f.resp=fResp.value;render()};fNuc.onchange=()=>{f.nucleo=fNuc.value;render()};fCli.onchange=()=>{f.cliente=fCli.value;render()};fFat.input.onchange=()=>{f.fatais=fFat.input.checked;render()};fFat.wrap.className="";
  const nTk=Object.keys(T.tickets||{}).length,nMeus=Object.values(T.tickets||{}).filter(x=>minhasAreas().includes(x.aguardando_area)).length;
  const fTk=sel({"":"Tickets: todos os estados",minhas:`Aguardando a minha área (${nMeus})`,todas:`Aguardando alguma área (${nTk})`},f.tickets||"");fTk.onchange=()=>{f.tickets=fTk.value;render()};
  const escT=PP.escopoTarefas?.()||{tudo:true};
  v.append(el("div",{class:"card section",style:"flex-direction:row;flex-wrap:wrap;gap:10px;align-items:center"},fStatus,(escT.tudo||escT.nucleos)?fResp:null,fNuc,fCli,fFat.wrap,TICKETS_ATIVOS?fTk:null,(!escT.tudo&&!escT.nucleos)?el("span",{class:"note"},"Você vê as tarefas atribuídas a você ou criadas por você."):(!escT.tudo?el("span",{class:"note"},"Você vê as suas tarefas e as do jurídico (controle)."):null)));
  const vista=T.vista||(()=>{try{return localStorage.getItem("pp-tarefas-vista")||"lista"}catch(_){return "lista"}})();T.vista=vista;
  const vistaBtns=el("div",{class:"tabs",style:"font-size:12px;margin-left:auto"},[["lista","Lista"],["kanban","Kanban"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(vista===k),onclick:()=>{T.vista=k;try{localStorage.setItem("pp-tarefas-vista",k)}catch(_){}render()}},l)));
  v.querySelector(".card.section")?.append(vistaBtns);
  if(vista==="kanban"){const fk={...f,status:"todas"};v.append(kanban(filtrar(T.tarefas,fk)));return}
  v.append(listaAgrupada(filtrar(T.tarefas,f)));
}
/* ---------- Kanban: A fazer · Fazendo · Aguardando área · Feitas (7 dias). Arrastar entre A fazer e Fazendo muda o status; para Feitas abre a tarefa (registro obrigatório) ---------- */
function kanban(lista){
  const hoje=hojeISO();const d7=addD(hoje,-7);
  const cols=[["aberta","A fazer",t=>t.status==="aberta"&&!ticketDe(t)],["em_andamento","Fazendo",t=>t.status==="em_andamento"&&!ticketDe(t)],["aguardando","Aguardando área",t=>!!ticketDe(t)&&(t.status==="aberta"||t.status==="em_andamento")],["concluida","Feitas (7 dias)",t=>t.status==="concluida"&&(t.concluida_em||"").slice(0,10)>=d7]].filter(c=>TICKETS_ATIVOS||c[0]!=="aguardando");
  const prazoPill=t=>t.prazo?el("span",{class:"pill "+(t.faixa==="atrasada"||t.faixa==="hoje"?"e3":t.faixa==="d7"?"e2":"g"),style:"font-size:11px"},fmtD(parseD(t.prazo))+(t.prazo_fatal?" · FATAL":"")+(t.faixa==="atrasada"?` · ${-t.dias_para_prazo}d atrás`:t.faixa==="hoje"?" · hoje":"")):el("span",{class:"note",style:"font-size:11px"},"sem prazo");
  const card=t=>{const c=el("div",{class:"kb-card",draggable:"true",onclick:()=>openTarefa(t)},el("div",{class:"n",style:"font-size:13px;font-weight:600;line-height:1.3"},t.prioridade===1?el("span",{class:"pill e3",style:"margin-right:6px;font-size:10px"},"Alta"):null,t.titulo),
    el("div",{class:"s",style:"font-size:12px;margin-top:3px"},[t.cliente_nome,t.responsavel_nome].filter(Boolean).join(" · ")),el("div",{style:"margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center"},prazoPill(t),pillTicket(t)));
    c.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",t.id);c.classList.add("arrastando")});c.addEventListener("dragend",()=>c.classList.remove("arrastando"));return c};
  const host=el("div",{class:"kb"});
  for(const [k,l,fn] of cols){const ts=lista.filter(fn).sort((a,b)=>(a.prazo||"9999").localeCompare(b.prazo||"9999")||a.prioridade-b.prioridade);
    const col=el("div",{class:"kb-col","data-st":k},el("div",{class:"kb-h"},el("span",{},l),el("span",{class:"note num"},String(ts.length))),el("div",{class:"kb-body"},ts.length?ts.map(card):el("div",{class:"note",style:"padding:10px;text-align:center"},"—")));
    col.addEventListener("dragover",e=>{e.preventDefault();col.classList.add("sobre")});col.addEventListener("dragleave",()=>col.classList.remove("sobre"));
    col.addEventListener("drop",async e=>{e.preventDefault();col.classList.remove("sobre");const id=e.dataTransfer.getData("text/plain");const t=T.tarefas.find(x=>x.id===id);if(!t)return;
      if(k==="aguardando"){if(!TICKETS_ATIVOS){toast("Tickets desativados");return}if(!ticketDe(t))encaminharArea(t,()=>{T.ok=false;carregar()});return}
      if(k==="concluida"){if(t.status!=="concluida"){openTarefa(t);setTimeout(()=>{toast("Escreva o que foi feito e clique em Concluir");$("#modalHost textarea")?.focus()},300)}return}
      if(ticketDe(t)){toast("Responda o ticket antes de mover");return}
      if(t.status===k)return;const {error}=await SB.from("tarefas").update({status:k}).eq("id",id);if(error){toast(error.message);return}T.ok=false;carregar()});
    host.append(col)}
  return host;
}
document.head.append(el("style",{},`.kb{display:grid;grid-template-columns:repeat(4,minmax(220px,1fr));gap:12px;align-items:start;overflow-x:auto}.kb-col{background:var(--surface-2);border:1px solid var(--line);border-radius:12px;min-height:120px}.kb-col.sobre{outline:2px dashed var(--gold)}.kb-h{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--line)}.kb-body{display:flex;flex-direction:column;gap:8px;padding:8px}.kb-card{background:var(--surface,#fff);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:grab}.kb-card:hover{border-color:var(--gold)}.kb-card.arrastando{opacity:.5}@media(max-width:1100px){.kb{grid-template-columns:repeat(2,minmax(220px,1fr))}}`));
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
const EVENTO={criada:"abriu a tarefa",reatribuida:"passou a tarefa",prazo_alterado:"alterou o prazo",status:"mudou o status",concluida:"concluiu",reaberta:"reabriu",cancelada:"cancelou",comentario:"comentou",editada:"editou título/descrição/prioridade",encaminhada:"abriu ticket para",respondida:"respondeu pelo(a)"};
const fmtDT=v=>{if(!v)return"";const d=new Date(v);return fmtD(d)+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
function linhaEvento(e){
  const quem=e.autor_nome||"Alguém";
  let txt=`${quem} ${EVENTO[e.tipo]||e.tipo}`;
  if(e.tipo==="criada"&&e.para)txt+=` para ${e.para}`;
  else if(e.tipo==="reatribuida")txt+=` de ${e.de||"—"} para ${e.para||"—"}`;
  else if(e.tipo==="prazo_alterado")txt+=` de ${e.de||"sem prazo"} para ${e.para||"sem prazo"}`;
  else if(e.tipo==="status")txt+=` de ${STATUS[e.de]||e.de} para ${STATUS[e.para]||e.para}`;
  else if(e.tipo==="encaminhada")txt+=` ${e.para||""}`;
  else if(e.tipo==="respondida")txt+=` ${e.de||""}`;
  if(e.tipo==="encaminhada"||e.tipo==="respondida")return el("li",{class:"ev-humano"},el("div",{class:"d"},fmtDT(e.criado_em)+" · "+txt),el("div",{style:"white-space:pre-wrap;margin-top:2px;padding:8px 12px;background:var(--surface-2);border-left:3px solid var(--gold);border-radius:8px;font-size:13.5px;line-height:1.45"},e.nota||""));
  if(e.tipo==="comentario"||e.tipo==="concluida"&&e.nota)return el("li",{class:"ev-humano"},el("div",{class:"d"},fmtDT(e.criado_em)+" · "+quem+(e.tipo==="concluida"?" · concluiu":"")),el("div",{style:"white-space:pre-wrap;margin-top:2px;padding:8px 12px;background:var(--surface-2);border-radius:8px;font-size:13.5px;line-height:1.45"},e.nota));
  return el("li",{class:"ev-sistema"},el("div",{class:"d"},fmtDT(e.criado_em)+" · "+txt,e.nota?el("div",{style:"white-space:pre-wrap;margin-top:2px"},e.nota):null));
}
async function historico(id,host){
  const [{data,error},ax]=await Promise.all([SB.from("tarefa_eventos").select("*").eq("tarefa_id",id).order("criado_em",{ascending:false}),SB.from("anexos").select("id,tarefa_evento_id,nome,caminho_storage").eq("tarefa_id",id)]);
  host.replaceChildren();
  if(error){host.append(el("div",{class:"note"},"Histórico indisponível"));return}
  if(!data.length){host.append(el("div",{class:"note"},"Sem registros ainda."));return}
  const porEv={};for(const a of (ax.data||[])){(porEv[a.tarefa_evento_id]=porEv[a.tarefa_evento_id]||[]).push(a)}
  host.append(el("ul",{class:"tl",style:"margin:0"},data.map(e=>{const li=linhaEvento(e);const as=porEv[e.id];if(as?.length)li.append(el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"},as.map(anexoPill)));return li})));
}
async function comentar(id,texto,files){
  const {data:ev,error}=await SB.from("tarefa_eventos").insert({tarefa_id:id,tipo:"comentario",nota:texto,autor:PP.perfil?.id,autor_nome:meuColab()?.nome||PP.perfil?.nome||null}).select("id").single();
  if(error)throw new Error("Não foi possível registrar o comentário");
  if(files&&files.length)await anexarEvento(id,ev.id,files);
  return ev.id;
}
async function anexarEvento(tarefaId,eventoId,files){
  for(const f of files){
    const nome=f.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w.\-]+/g,"_");
    const caminho=`tarefas/${tarefaId}/${eventoId}/${Date.now().toString(36)}-${nome}`;
    const {error}=await SB.storage.from("anexos").upload(caminho,f,{contentType:f.type||undefined});if(error)throw new Error("Falha ao enviar "+f.name);
    const {error:e2}=await SB.from("anexos").insert({tarefa_id:tarefaId,tarefa_evento_id:eventoId,nome:f.name,caminho_storage:caminho,tamanho:f.size,mime:f.type||null});if(e2)throw new Error(e2.message);
  }
}
async function abrirAnexoTarefa(a){const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);if(error||!data?.signedUrl){toast("Não foi possível abrir o anexo");return}window.open(data.signedUrl,"_blank","noopener")}
const anexoPill=a=>el("button",{class:"btn sm",style:"padding:1px 8px;font-size:12px",onclick:()=>abrirAnexoTarefa(a)},"📎 "+a.nome);
/* @menção: ao digitar "@" no comentário, sugere colaboradores; o banco notifica quem foi marcado (0046). */
const cssM=document.createElement("style");cssM.textContent=".menu-pop{position:relative;z-index:5;margin-top:-2px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:4px;display:flex;flex-direction:column;max-width:320px}.menu-pop .item{border:0;background:transparent;text-align:left;padding:7px 10px;border-radius:8px;cursor:pointer;font:inherit;color:inherit}.menu-pop .item:hover{background:var(--surface-2)}";document.head.append(cssM);
function mencoes(ta){
  const pop=el("div",{class:"menu-pop",hidden:""});
  const fechar=()=>{pop.hidden=true};
  const atual=()=>{const v=ta.value.slice(0,ta.selectionStart);const m=/@([^\s@]*)$/.exec(v);return m?{ini:v.length-m[0].length,q:m[1]}:null};
  const norm=x=>String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const render=()=>{const a=atual();if(!a){fechar();return}const q=norm(a.q);const lista=T.colab.filter(c=>c.ativo!==false&&c.perfil_id&&(!q||norm(c.nome).includes(q)||norm(c.apelido).includes(q))).slice(0,6);
    if(!lista.length){fechar();return}if(!pop.parentNode)ta.insertAdjacentElement("afterend",pop);pop.replaceChildren(...lista.map(c=>el("button",{type:"button",class:"item",onclick:()=>{const nome=c.apelido||c.nome.split(" ")[0];ta.value=ta.value.slice(0,a.ini)+"@"+nome+" "+ta.value.slice(ta.selectionStart);fechar();ta.focus()}},c.nome)));pop.hidden=false};
  ta.addEventListener("input",render);ta.addEventListener("keyup",e=>{if(e.key==="Escape")fechar()});ta.addEventListener("blur",()=>setTimeout(fechar,150));
}
/* concluir a partir da lista: "o que foi feito" é obrigatório (regra da controladoria — toda conclusão alimenta o histórico) */
function concluirComNota(t){
  const ta=el("textarea",{placeholder:"Ex.: petição protocolada (ID 1234); aguardando intimação. Cliente avisado por WhatsApp.",rows:3});const arq=el("input",{type:"file",multiple:""});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{},"O que foi feito?"),ta,el("div",{class:"help"},"Obrigatório. Vira o último registro do histórico e do dossiê; quem abriu a tarefa é avisado.")),el("div",{class:"f full"},el("label",{},"Anexar (opcional)"),arq));
  modal("Concluir: "+t.titulo,body,async()=>{if(!ta.value.trim())throw new Error("Escreva o que foi feito");await mudarStatus(t,"concluida",ta.value.trim(),[...arq.files]);toast("Tarefa concluída")});
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Concluir tarefa";
}
const comentarConclusao=concluirComNota;
/* ---------- Tela da tarefa: o que fazer, para quem passar, o que já aconteceu ---------- */
async function mudarStatus(t,status,nota,files){
  const {error}=await SB.from("tarefas").update({status}).eq("id",t.id);if(error)throw new Error("Não foi possível atualizar");
  if(nota||files?.length)await comentar(t.id,nota||"(anexo)",files);
}
function passarPara(t,recarregar){
  const meu=meuColab();const para=selColab(t.responsavel_id);const nota=el("textarea",{rows:3,placeholder:"O que a pessoa precisa saber para continuar? (ex.: já liguei para o banco, falta protocolar; prazo fatal 20/10)"});
  const arqP=el("input",{type:"file",multiple:""});
  const manter=check("Manter a data original"+(t.prazo?" ("+fmtD(parseD(t.prazo))+")":""),true);const prazoN=inp("date",t.prazo||"");prazoN.disabled=true;manter.input.onchange=()=>{prazoN.disabled=manter.input.checked;if(manter.input.checked)prazoN.value=t.prazo||""};
  const concluirMinha=check("Concluir a minha parte: sai da minha lista e abre uma nova tarefa para quem recebe, na data escolhida",false);
  const body=el("div",{class:"form"},field("pp-para","Passar para",para),
    el("div",{class:"f"},el("label",{},"Prazo para quem recebe"),prazoN,manter.wrap),
    el("div",{class:"f full"},concluirMinha.wrap,el("div",{class:"help"},"Desmarcado: a mesma tarefa só muda de responsável (você continua acompanhando). Marcado: a sua fica concluída e quem recebe ganha uma tarefa nova, com o seu recado na descrição.")),
    el("div",{class:"f full"},el("label",{},"Recado para quem recebe"+(concluirMinha.input.checked?" (obrigatório)":"")),nota,el("div",{class:"help"},"Quem recebe é avisado no sino e vê este recado no histórico da tarefa e no dossiê do cliente.")),el("div",{class:"f full"},el("label",{},"Anexar (ex.: a réplica para correção)"),arqP));
  modal("Passar a tarefa: "+t.titulo,body,async()=>{
    if(!para.value)throw new Error("Escolha para quem passar");if(para.value===t.responsavel_id&&!concluirMinha.input.checked)throw new Error("Essa pessoa já é a responsável");
    const quem=nomeColab(para.value);const novoPrazo=manter.input.checked?null:(prazoN.value||null);
    if(concluirMinha.input.checked){
      if(!nota.value.trim())throw new Error("Escreva o que você fez (vai na descrição da nova tarefa)");
      const {data,error}=await SB.rpc("tarefa_passar_concluindo",{p_tarefa:t.id,p_para:para.value,p_prazo:novoPrazo,p_nota:nota.value.trim()});if(error)throw new Error(error.message);
      if(arqP.files.length)await comentar(data,"Anexo recebido de "+(meu?.nome||"")+": "+[...arqP.files].map(f=>f.name).join(", "),[...arqP.files]);
      toast("Sua parte foi concluída; nova tarefa aberta para "+quem);$("#modalHost").replaceChildren();T.ok=false;carregar();return;
    }
    const up={responsavel_id:para.value,status:t.status==="concluida"?"aberta":t.status};
    if(novoPrazo&&novoPrazo!==t.prazo){up.prazo=novoPrazo;up.motivo_reagendamento="Passagem para "+quem+(nota.value.trim()?": "+nota.value.trim().slice(0,120):"")}
    const {error}=await SB.from("tarefas").update(up).eq("id",t.id);if(error)throw new Error("Não foi possível passar a tarefa: "+error.message);
    await comentar(t.id,`Passei para ${quem}${meu?" (de "+meu.nome.split(" ")[0]+")":""}.`+(novoPrazo&&novoPrazo!==t.prazo?` Novo prazo: ${fmtD(parseD(novoPrazo))}.`:"")+(nota.value.trim()?"\n"+nota.value.trim():""),[...arqP.files]);
    toast("Tarefa passada para "+quem);setTimeout(recarregar,300);
  });
}
/* Ao concluir "Analisar cabimento": pergunta se cabe. Se não cabe, cancela as demais etapas abertas da cadeia (ficam no histórico). */
function decidirCadeia(t){return new Promise(res=>{
  const host=$("#modalHost");const nome=(t.titulo||"").replace(/^Analisar cabimento de /i,"").replace(/ — .*$/,"");
  const fim=v=>{host.replaceChildren();res(v)};
  const naoCabe=async()=>{try{const {data}=await SB.from("tarefas").select("id").eq("cadeia_id",t.cadeia_id).neq("id",t.id).in("status",["aberta","em_andamento"]);
      const ids=(data||[]).map(x=>x.id);if(ids.length){const {error}=await SB.from("tarefas").update({status:"cancelada"}).in("id",ids);if(error)throw new Error(error.message);for(const id of ids)await comentar(id,"Cancelada: na análise foi decidido que não cabe "+nome+".")}
      toast(ids.length?`Não cabe — ${ids.length} etapa(s) cancelada(s)`:"Não cabe — nada a cancelar");fim(false)}catch(e){toast(e.message);fim(null)}};
  const card=el("div",{class:"card",role:"dialog","aria-modal":"true",style:"max-width:520px"},el("h2",{},`Cabe ${nome||"a medida"}?`),
    el("p",{class:"sub",style:"margin:8px 0 14px"},"Se cabe, as etapas Confeccionar → Protocolar → Conferir continuam abertas com as datas já calculadas. Se não cabe, elas são canceladas e ficam registradas no histórico."),
    el("div",{class:"actions",style:"justify-content:flex-end"},el("button",{class:"btn danger",onclick:naoCabe},"Não cabe — cancelar etapas"),el("button",{class:"btn primary",onclick:()=>{toast("Cadeia mantida");fim(true)}},"Cabe — manter a cadeia")));
  host.replaceChildren(el("div",{class:"modal"},card));
})}
function openTarefa(t){
  const meu=meuColab();const aberta=t.status==="aberta"||t.status==="em_andamento";
  const host=$("#modalHost");host.replaceChildren();const close=()=>{clearInterval(openTarefa._tick);host.replaceChildren()};
  const reabrirTela=()=>{T.ok=false;carregar().then(()=>{const n=T.tarefas.find(x=>x.id===t.id);if(n)openTarefa(n);else close()})};
  const prazoTxt=t.prazo?fmtD(parseD(t.prazo))+(t.hora?" às "+String(t.hora).slice(0,5):"")+(t.faixa==="atrasada"?` · ${-t.dias_para_prazo} dia(s) atrasada`:t.faixa==="hoje"?" · vence hoje":t.dias_para_prazo!=null&&t.dias_para_prazo<=30?` · em ${t.dias_para_prazo} dia(s)`:""):"sem prazo";
  const pill=(cls,txt)=>el("span",{class:"pill "+cls},txt);
  const cab=el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px"},
    pill(t.status==="concluida"?"g":t.status==="em_andamento"?"c":t.status==="cancelada"?"":"e2",STATUS[t.status]||t.status),t.prioridade===1?pill("e3","Prioridade alta"):null,t.prazo_fatal?pill("e3","PRAZO FATAL"):null,
    pill(t.faixa==="atrasada"||t.faixa==="hoje"?"e3":t.faixa==="d7"?"e2":"g","Prazo: "+prazoTxt),pillTicket(t));
  const meta=el("div",{class:"tf-meta"},
    el("div",{},el("b",{},"Responsável"),el("div",{},t.responsavel_nome||"— ninguém —")),
    el("div",{},el("b",{},"Cliente"),el("div",{},t.cliente_id?el("a",{href:"#clientes/"+encodeURIComponent(t.cliente_id),onclick:close},t.cliente_nome||t.cliente_id):"—")),
    el("div",{},el("b",{},"Núcleo"),el("div",{},NUCLEOS[t.nucleo]||"—")),
    t.numero_cnj?el("div",{},el("b",{},"Processo"),el("div",{},t.numero_cnj)):null,
    el("div",{},el("b",{},"Tempo trabalhado"),el("div",{},horasFmt(t.horas_apontadas||0))),
    el("div",{},el("b",{},"Aberta"),el("div",{},[t.criado_por_nome?"por "+t.criado_por_nome:null,t.created_at?"em "+fmtDT(t.created_at):null].filter(Boolean).join(" ")||"—")));
  const desc=t.descricao?el("div",{class:"tf-desc"},t.descricao):el("div",{class:"note"},"Sem descrição.");
  /* ---- concluir: o que foi feito é obrigatório; se o cronômetro desta tarefa estiver rodando, grava o tempo antes ---- */
  /* concluir sem janela extra: o texto da caixa "Andamento" (abaixo) é o registro do que foi feito e é obrigatório */
  let com,arqCom;const btnsConcluir=[];
  let temRegistro=false; // já existe andamento registrado por alguém nesta tarefa? então pode concluir sem escrever de novo
  const concluir=async()=>{
    const txt=(com?.value||"").trim();if(!txt&&!temRegistro){toast("Escreva na caixa de andamento o que foi feito antes de concluir");com?.focus();return}
    try{if(window.PP_TS&&cronDaTarefa())await window.PP_TS.pararDireto({descricao:t.titulo,atividade:ativSel?.value||null});
      await mudarStatus(t,"concluida",txt||null,[...(arqCom?.files||[])]);toast("Tarefa concluída");close();
      if(t.etapa_codigo==="analisar"&&t.cadeia_id)await decidirCadeia(t);
      T.ok=false;await carregar()}catch(e){toast(e.message)}
  };
  const btnConcluir=(cls)=>{const b=el("button",{class:cls,disabled:"",title:"Escreva o que foi feito na caixa de andamento para liberar",onclick:concluir},"✓ Concluir");btnsConcluir.push(b);return b};
  /* "Feito": encerra o que estava fazendo agora (pausa o cronômetro e grava o tempo; registra o texto da caixa de andamento, se houver) — a tarefa continua aberta */
  const feito=async()=>{try{const txt=(com?.value||"").trim();if(window.PP_TS&&cronDaTarefa())await window.PP_TS.pararDireto({descricao:t.titulo,atividade:ativSel?.value||null});
      if(txt||arqCom?.files?.length){await comentar(t.id,txt||"(anexo)",[...(arqCom?.files||[])]);com.value="";if(arqCom){arqCom.value="";btnArq.replaceChildren(ico("clip","Anexar arquivo"))}liberar()}
      toast(txt?"Andamento registrado — tarefa continua aberta":"Tempo gravado — tarefa continua aberta");cron=null;setTimeout(reabrirTela,200)}catch(e){toast(e.message)}};
  const btnFeito=(cls)=>el("button",{class:cls,title:"Encerra o que você estava fazendo agora (grava o tempo e o andamento) sem concluir a tarefa",onclick:feito},"✓ Feito");
  /* ---- trabalho: cronômetro dentro da tarefa (iniciar = em andamento; pausar grava o tempo; concluir grava e encerra) ---- */
  let cron=null,ativSel=null;const cronDaTarefa=()=>cron&&cron.tarefa_id===t.id?cron:null;
  const trabalho=el("div",{class:"tf-trab"});
  const desenharTrabalho=()=>{
    trabalho.replaceChildren();clearInterval(openTarefa._tick);
    if(!aberta||!window.PP_TS)return;
    const c=cronDaTarefa();
    if(c){
      const rel=el("b",{class:"tf-relogio"},"00:00:00");const tick=()=>{const s=Math.max(0,Math.floor((Date.now()-new Date(c.inicio).getTime())/1000));rel.textContent=`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor(s%3600/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};tick();openTarefa._tick=setInterval(tick,1000);
      ativSel=sel({outro:"Atividade…"},"outro");window.PP_TS.atividades().then(as=>{ativSel.replaceChildren(...as.map(a=>el("option",{value:a.codigo},a.nome)));ativSel.value=as.some(a=>a.codigo===(c.tipo_atividade||""))?c.tipo_atividade:(as.find(a=>a.codigo==="outro")?"outro":as[0]?.codigo)});
      trabalho.append(el("span",{class:"pill e2"},"● trabalhando"),rel,el("span",{class:"note"},"desde "+fmtDT(c.inicio)),ativSel,
        el("button",{class:"btn",onclick:async()=>{try{await window.PP_TS.pararDireto({descricao:t.titulo,atividade:ativSel.value});toast("Tempo gravado — tarefa continua em andamento");cron=null;setTimeout(reabrirTela,200)}catch(e){toast(e.message)}}},"⏸ Pausar"),
        btnFeito("btn primary"));
    }else{
      trabalho.append(el("button",{class:"btn primary",onclick:async()=>{try{
          if(cron&&cron.tarefa_id!==t.id){const outra=T.tarefas.find(x=>x.id===cron.tarefa_id);if(!confirm(`Você já está trabalhando em "${outra?outra.titulo:"outra tarefa"}". Pausar lá e começar aqui?`))return;await window.PP_TS.pararDireto({descricao:outra?.titulo||null})}
          cron=await window.PP_TS.iniciarDireto(t);if(t.status==="aberta")await SB.from("tarefas").update({status:"em_andamento"}).eq("id",t.id);
          toast("Cronômetro ligado");setTimeout(reabrirTela,200)}catch(e){toast(e.message)}}},"▶ Iniciar trabalho"),
        btnFeito("btn"),
        el("span",{class:"note"},t.status==="em_andamento"?"Em andamento (cronômetro pausado). Iniciar retoma a contagem.":"Iniciar liga o cronômetro e marca a tarefa como em andamento."));
    }
  };
  if(window.PP_TS&&aberta)window.PP_TS.cronAtual().then(c=>{cron=c;desenharTrabalho()});
  const acoes=el("div",{class:"tf-acoes"},
    aberta?trabalho:el("button",{class:"btn",onclick:async()=>{try{await mudarStatus(t,"aberta");toast("Tarefa reaberta");reabrirTela()}catch(e){toast(e.message)}}},"Reabrir"),
    el("span",{class:"sp",style:"flex:1"}),
    aberta?el("button",{class:"btn sm",onclick:()=>passarPara(t,reabrirTela)},"→ Passar para…"):null,
    aberta&&TICKETS_ATIVOS&&!ticketDe(t)?el("button",{class:"btn sm",title:"Precisa de uma decisão ou informação de outra área? Abra um ticket: a tarefa fica aguardando a área e o tempo parado aparece para todos.",onclick:()=>encaminharArea(t,reabrirTela)},"⇄ Ticket para área…"):null,
    aberta&&ticketDe(t)?el("button",{class:"btn sm primary",onclick:()=>responderTicket(t,reabrirTela)},"Responder ticket ("+(AREAS_TICKET[ticketDe(t).aguardando_area]||"")+")"):null,
    el("button",{class:"btn sm",onclick:()=>window.PP_TS?window.PP_TS.lancar({tarefa:t}):openHorasForm({tarefa:t})},"+ Horas manuais"),
    t.cliente_id?el("button",{class:"btn sm",title:"Decisão, informação do cliente ou motivo de não fazer — vai para o dossiê do cliente, não fica preso na tarefa",onclick:()=>window.PP_CARTEIRA?.registrar(t.cliente_id,{processo_id:t.processo_id||null,contrato_id:t.contrato_id||null,frente:({juridico:"juridico",acordos:"negocial",acompanhamento_pj:"estrategico",pos_vendas:"estrategico"})[t.nucleo]||""})},"Registrar no cliente"):null,
    el("button",{class:"btn sm",onclick:()=>openTarefaForm(t)},"Editar"));
  if(!window.PP_TS&&aberta)acoes.prepend(btnFeito("btn primary"));
  /* ---- andamento: registro no topo, comentários em destaque, eventos de sistema discretos ---- */
  const hist=el("div",{},el("div",{class:"note"},"Carregando…"));
  com=el("textarea",{rows:2,style:"flex:1;min-width:0",placeholder:aberta?"O que você fez? Vai para o histórico ao clicar em Feito ou Concluir (ou Ctrl+Enter para só registrar). Pode avisar alguém com @.":"Registrar ou avisar alguém com @. Ctrl+Enter envia."});
  arqCom=el("input",{type:"file",multiple:"",style:"display:none"});arqCom.onchange=()=>{btnArq.replaceChildren(ico("clip","Anexar arquivo"),arqCom.files.length?" "+arqCom.files.length:"")};
  const liberar=()=>{const ok=!!com.value.trim()||temRegistro;btnsConcluir.forEach(b=>{b.disabled=!ok;b.title=ok?(com.value.trim()?"Concluir com este registro":"Concluir (já há andamento registrado)"):"Escreva o que foi feito na caixa de andamento para liberar"})};com.addEventListener("input",liberar);
  SB.from("tarefa_eventos").select("id").eq("tarefa_id",t.id).eq("tipo","comentario").limit(1).then(({data})=>{temRegistro=!!(data&&data.length);liberar();const n=card.querySelector(".tf-nota-concluir");if(n)n.textContent=temRegistro?"Já há andamento registrado — pode concluir direto ou acrescentar um registro.":"Concluir exige o andamento preenchido (o que foi feito)."});
  const btnArq=el("button",{class:"btn sm",title:"Anexar arquivo ao registro",onclick:()=>arqCom.click()},"📎");
  const registrar=async()=>{if(!com.value.trim()&&!arqCom.files.length)return;try{await comentar(t.id,com.value.trim()||"(anexo)",[...arqCom.files]);com.value="";arqCom.value="";btnArq.replaceChildren(ico("clip","Anexar arquivo"));temRegistro=true;liberar();toast("Registrado");historico(t.id,hist)}catch(e){toast(e.message)}};
  com.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))registrar()});
  mencoes(com);
  const ETAPA_N={analisar:"Analisar cabimento",confeccionar:"Confeccionar",custas:"Recolher custas",protocolar:"Protocolar",conferir:"Conferir protocolo"};
  const cadeiaBox=t.cadeia_id?el("div",{class:"tf-cadeia"},el("div",{class:"tf-h"},"Cadeia do prazo"),el("div",{class:"note"},"Carregando etapas…")):null;
  if(cadeiaBox)SB.from("v_tarefas").select("id,titulo,prazo,prazo_fatal,status,etapa_codigo,responsavel_nome,faixa,dias_para_prazo").eq("cadeia_id",t.cadeia_id).order("prazo").then(({data})=>{const ts=data||[];
    cadeiaBox.replaceChildren(el("div",{class:"tf-h"},"Cadeia do prazo"),el("div",{class:"tf-cadeia-l"},...ts.map(x=>el("button",{class:"row"+(x.id===t.id?" atual":""),type:"button",onclick:()=>{if(x.id!==t.id){close();openTarefa({...x,cadeia_id:t.cadeia_id})}}},
      el("span",{class:"pill "+(x.status==="concluida"?"g":x.status==="cancelada"?"":x.faixa==="atrasada"||x.faixa==="hoje"?"e3":x.faixa==="d7"?"e2":"c"),style:"min-width:84px;justify-content:center"},x.prazo?fmtD(parseD(x.prazo)):"—"),
      el("span",{style:x.status==="concluida"||x.status==="cancelada"?"text-decoration:line-through;color:var(--muted)":""},ETAPA_N[x.etapa_codigo]||x.etapa_codigo||x.titulo,x.prazo_fatal?" · fatal":""),
      el("span",{class:"note",style:"margin-left:auto"},x.responsavel_nome||"")))))});
  const body=el("div",{class:"tf"},cab,meta,cadeiaBox,desc,acoes,
    el("div",{class:"tf-h"},"Andamento"),
    el("div",{style:"display:flex;gap:8px;align-items:flex-start;margin:6px 0 10px"},com,btnArq,arqCom),hist);
  const card=el("div",{class:"card",role:"dialog","aria-modal":"true",style:"max-width:860px;position:relative"},el("button",{class:"btn sm",title:"Fechar (Esc)",style:"position:absolute;top:12px;right:12px;padding:2px 9px;font-size:16px;line-height:1",onclick:close},"×"),
    el("h2",{style:(t.status==="concluida"?"text-decoration:line-through;color:var(--muted);":"")+"padding-right:40px"},t.titulo),body,
    el("div",{class:"actions"},aberta?el("span",{class:"note tf-nota-concluir",style:"margin-right:auto"},"Concluir exige o andamento preenchido (o que foi feito)."):null,aberta?btnConcluir("btn primary"):el("button",{class:"btn",onclick:close},"Fechar")));
  const esc=e=>{if(e.key==="Escape"){close();document.removeEventListener("keydown",esc)}};document.addEventListener("keydown",esc);
  host.append(el("div",{class:"modal",onclick:e=>{if(e.target.classList.contains("modal"))close()}},card));
  historico(t.id,hist);
}
document.head.append(el("style",{},`.tf-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 14px;font-size:13px;margin:6px 0 10px}.tf-meta b{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.tf-desc{white-space:pre-wrap;background:var(--surface-2);border-radius:8px;padding:10px 12px;font-size:13.5px;line-height:1.45;max-height:260px;overflow:auto}
.tf-acoes{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 14px;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.tf-h{font-weight:600;margin-top:4px}
.tf-cadeia{margin:4px 0 10px}.tf-cadeia-l{display:flex;flex-direction:column;gap:2px;margin-top:4px}.tf-cadeia-l .row{display:flex;gap:10px;align-items:center;padding:6px 8px;font-size:13px;border:1px solid transparent;border-radius:8px;background:transparent;text-align:left;width:100%}.tf-cadeia-l .row.atual{border-color:var(--gold);background:var(--surface-2)}
.tf-trab{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.tf-relogio{font-size:22px;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.tl li.ev-sistema{padding:2px 0 8px;opacity:.75}.tl li.ev-sistema::before{background:var(--line);width:8px;height:8px;left:-22px;top:9px}.tl li.ev-humano{padding:6px 0 12px}`));
/* Reagendou a etapa Protocolar: as outras etapas abertas da cadeia andam o mesmo número de dias (ajustando para dia útil anterior). */
async function cascatearCadeia(t,novoPrazo,motivo){
  try{const delta=Math.round((parseD(novoPrazo)-parseD(t.prazo))/86400000);if(!delta)return;
    const {data}=await SB.from("tarefas").select("id,prazo,etapa_codigo").eq("cadeia_id",t.cadeia_id).neq("id",t.id).in("status",["aberta","em_andamento"]).neq("etapa_codigo","analisar");
    let n=0;for(const x of data||[]){if(!x.prazo)continue;let d=parseD(x.prazo);d.setDate(d.getDate()+delta);
      if(window.PP_PRAZOS){let g=0;while(!window.PP_PRAZOS.ehUtil(d,null)&&g<10){d.setDate(d.getDate()+(x.etapa_codigo==="conferir"?1:-1));g++}}
      const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;const {error}=await SB.from("tarefas").update({prazo:iso,motivo_reagendamento:"Cadeia: "+(motivo||"reagendamento da etapa Protocolar")}).eq("id",x.id);if(!error)n++}
    if(n)toast(`Cadeia reagendada: ${n} etapa(s) ${delta>0?"adiada(s)":"antecipada(s)"} ${Math.abs(delta)} dia(s)`)}catch(e){toast("Cadeia: "+e.message)}
}
function openTarefaForm(t={}){
  const meu=meuColab();
  let anexoForm=null;
  const titulo=inp("text",t.titulo||"",{placeholder:"Ex.: Protocolar embargos à execução"}),desc=el("textarea",{},t.descricao||""),cli=selCliente(t.cliente_id),
        kon=sel({"":"— sem vínculo —"},""),pro=sel({"":"— sem vínculo —"},""),resp=selColab(t.responsavel_id||meu?.id),nuc=sel({"":"—",...NUCLEOS},t.nucleo||meu?.nucleo||""),
        prazo=inp("date",t.prazo||""),hora=inp("time",(t.hora||"").slice(0,5)),fatal=check("Prazo fatal",t.prazo_fatal,"Prazo processual ou contratual improrrogável."),pri=sel(PRIORIDADE,String(t.prioridade||2)),status=sel(STATUS,t.status||"aberta"),
        hr=inp("number","",{step:"0.25",min:0,placeholder:"0"});
  const vincular=()=>{const cid=cli.value;
    kon.replaceChildren(el("option",{value:""},"— sem vínculo —"),...S.contratos.filter(k=>k.clienteId===cid).map(k=>el("option",{value:k.id,selected:k.id===t.contrato_id?"":null},shortName(k))));
    pro.replaceChildren(el("option",{value:""},"— sem vínculo —"),...T.processos.filter(p=>p.cliente_id===cid||p.id===t.processo_id).map(p=>el("option",{value:p.id,selected:p.id===t.processo_id?"":null},(p.numero_cnj||"(sem número)")+(p.parte_contraria?" · "+p.parte_contraria:""))));};
  cli.onchange=vincular;vincular();
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{for:"tf-tit"},"Título"),Object.assign(titulo,{id:"tf-tit"})),field("tf-cli","Cliente",cli),field("tf-resp","Responsável",resp),field("tf-nuc","Núcleo",nuc),
    field("tf-kon","Contrato",kon),field("tf-pro","Processo",pro),field("tf-prazo","Prazo",prazo),field("tf-hora","Horário (opcional)",hora,"Audiência, reunião, perícia… Entra na agenda."),fatal.wrap,
    window.PP_PRAZOS?(()=>{const d=el("details",{class:"f full"},el("summary",{style:"cursor:pointer;color:var(--muted);font-size:13px"},"Calcular prazo a partir de uma publicação/intimação…"));d.addEventListener("toggle",()=>{if(d.open&&!d.dataset.ok){d.dataset.ok="1";const pr=T.processos.find(x=>x.id===pro.value);d.append(window.PP_PRAZOS.campo({alvo:prazo,base:hojeISO(),uf:window.PP_PRAZOS.ufDoCnj(pr?.numero_cnj),dias:15}))}});return d})():null,field("tf-pri","Prioridade",pri),field("tf-status","Status",status),
    field("tf-desc","Descrição",desc),t.id?null:field("tf-hr","Horas já gastas (opcional)",hr,"Cria um apontamento de hoje em seu nome."),
    (()=>{anexoForm=el("input",{type:"file",multiple:""});return el("div",{class:"f full"},el("label",{},"Anexar arquivo (PDF, Word, imagem…)"),anexoForm,el("div",{class:"help"},"Ex.: a petição inicial para o responsável corrigir; o despacho que gerou a tarefa. Fica no histórico da tarefa, visível para quem a recebe."))})());
  /* reagendar exige justificativa (controladoria): o campo aparece quando o prazo de uma tarefa já salva muda */
  const motivoC=campoMotivo();const motivoWrap=motivoC.wrap;
  if(t.id&&t.prazo){const prazoOrig=t.prazo;const chk=()=>motivoC.mostrar(prazo.value&&prazo.value!==prazoOrig);prazo.addEventListener("input",chk);prazo.addEventListener("change",chk);
    const pos=body.querySelector("#tf-prazo")?.closest(".f");if(pos)pos.after(motivoWrap);else body.append(motivoWrap)}
  if(t.id){
    const hist=el("div",{},el("div",{class:"note"},"Carregando histórico…"));const com=el("textarea",{rows:2,placeholder:"Comentar (ex.: liguei para o cliente, aguardando documentos)"});
    const btnCom=el("button",{class:"btn sm",onclick:async()=>{if(!com.value.trim())return;try{await comentar(t.id,com.value.trim());com.value="";toast("Comentário registrado");historico(t.id,hist)}catch(e){toast(e.message)}}},"Comentar");
    mencoes(com);
    body.append(el("div",{class:"f full",style:"margin-top:6px"},el("label",{},"Histórico"),el("div",{class:"help"},[t.criado_por_nome?`Aberta por ${t.criado_por_nome} em ${fmtDT(t.created_at)}.`:null,t.concluida_em?`Concluída${t.concluida_por_nome?" por "+t.concluida_por_nome:""} em ${fmtDT(t.concluida_em)}.`:null].filter(Boolean).join(" ")),hist,el("div",{style:"display:flex;gap:8px;align-items:flex-start;margin-top:6px"},com,btnCom)));
    historico(t.id,hist);
  }
  const extra=t.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta tarefa?"))return;const {error}=await SB.from("tarefas").delete().eq("id",t.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir":"Tarefa excluída")}},"Excluir"):null;
  modal(t.id?"Editar tarefa":"Nova tarefa",body,async()=>{
    if(!titulo.value.trim())throw new Error("Informe o título");
    const row={titulo:titulo.value.trim(),descricao:desc.value.trim()||null,cliente_id:cli.value||null,contrato_id:kon.value||null,processo_id:pro.value||null,responsavel_id:resp.value||null,nucleo:nuc.value||null,prazo:prazo.value||null,hora:prazo.value&&hora.value?hora.value:null,prazo_fatal:fatal.input.checked,prioridade:+pri.value,status:status.value};
    let id=t.id;
    if(id){const reag=t.prazo&&row.prazo!==t.prazo;if(reag){const mv=motivoC.valor();if(!mv)throw new Error("Escolha o motivo do reagendamento (e descreva, se for “Outro”)");row.motivo_reagendamento=mv}
      if(row.status==="concluida"&&t.status!=="concluida")throw new Error("Para concluir, use o botão “Concluir” e registre o que foi feito");
      const {error}=await SB.from("tarefas").update(row).eq("id",id);if(error)throw new Error(/motivo do reagendamento/.test(error.message)?"Informe o motivo do reagendamento":error.message)
      if(reag&&t.cadeia_id&&t.etapa_codigo==="protocolar")await cascatearCadeia(t,row.prazo,row.motivo_reagendamento)}
    else{const {data,error}=await SB.from("tarefas").insert(row).select("id").single();if(error)throw error;id=data.id;
      if(+hr.value>0){if(!meu)throw new Error("Tarefa salva, mas você não tem registro de colaborador para apontar horas");const {error:e2}=await SB.from("apontamentos_horas").insert({colaborador_id:meu.id,data:hojeISO(),horas:+hr.value,cliente_id:cli.value||null,tarefa_id:id,tipo_atividade:"outro",descricao:titulo.value.trim()});if(e2)throw e2}}
    if(anexoForm&&anexoForm.files.length)await comentar(id,"Arquivo anexado: "+[...anexoForm.files].map(f=>f.name).join(", "),[...anexoForm.files]);
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
  const [l,r,p,rg,ts]=await Promise.all([
    ap.colab?SB.from("v_apontamentos").select("*").eq("colaborador_id",ap.colab).gte("data",ap.semana.ini).lte("data",ap.semana.fim).order("data").order("created_at"):{data:[]},
    SB.from("v_apontamentos").select("colaborador_id,colaborador_nome,nucleo,cliente_id,cliente_nome,tipo_atividade,horas,data").gte("data",ap.periodoIni).lte("data",ap.periodoFim),
    SB.from("v_tarefas_pontualidade").select("*"),
    SB.from("v_reagendamentos_mes").select("*").eq("mes",hojeISO().slice(0,8)+"01"),
    PP.perfil?.papel==="admin"||PP.temAcesso?.("equipe")?SB.rpc("ts_dias_sem_lancamento",{p_ini:semanaDe(hojeISO()).ini,p_fim:semanaDe(hojeISO()).fim}):{data:[]}]);
  ap.lista=l.data||[];ap.rel=r.data||[];ap.pont=p.data||[];ap.reag=rg?.data||[];ap.semanaPend=(ts?.data||[]).filter(x=>(x.dias_faltando||[]).length);
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
  /* Timesheet da semana: quem ainda não lançou (regra: semana fechada até sexta; segunda a controladoria confere) */
  if(ap.semanaPend?.length){const fmtDia=d=>d.slice(8,10)+"/"+d.slice(5,7);
    v.append(el("section",{class:"card section",style:"border-color:var(--warn)"},el("div",{class:"section-h"},el("h2",{},"Timesheet da semana em aberto"),el("span",{class:"note"},`${ap.semanaPend.length} colaborador(es) · semana de ${fmtDia(semanaDe(hojeISO()).ini)}`)),
      el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Colaborador"),el("th",{class:"r"},"Dias úteis"),el("th",{class:"r"},"Lançados"),el("th",{},"Faltando"),el("th",{class:"r"},"Horas"))),
        el("tbody",{},ap.semanaPend.map(x=>el("tr",{},el("td",{},x.colaborador_nome),el("td",{class:"r num"},String(x.dias_uteis)),el("td",{class:"r num"},String(x.dias_lancados)),el("td",{style:"color:var(--warn)"},(x.dias_faltando||[]).map(fmtDia).join(", ")),el("td",{class:"r num"},horasFmt(+x.horas||0)||"0h")))))),
      el("div",{class:"note",style:"margin-top:8px"},"Aviso automático no sino toda sexta às 16h para quem estiver com dias em aberto.")));}
  /* Pontualidade */
  const pont=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Tarefas: no prazo × atrasadas"),el("span",{class:"note"},"por responsável e núcleo, acumulado")));
  const agg=new Map();for(const r of ap.pont){const k=r.responsavel_nome||"Sem responsável";const a=agg.get(k)||{abertas:0,atrasadas:0,fatais_7d:0,concluidas:0,concluidas_no_prazo:0,concluidas_com_atraso:0,reag:0,reag_sem:0};for(const f of ["abertas","atrasadas","fatais_7d","concluidas","concluidas_no_prazo","concluidas_com_atraso"])a[f]+=+r[f]||0;agg.set(k,a)}
  for(const r of (ap.reag||[])){const k=r.colaborador_nome||"Sistema";const a=agg.get(k)||{abertas:0,atrasadas:0,fatais_7d:0,concluidas:0,concluidas_no_prazo:0,concluidas_com_atraso:0,reag:0,reag_sem:0};a.reag+=+r.reagendamentos||0;a.reag_sem+=+r.sem_motivo||0;agg.set(k,a)}
  pont.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Responsável"),el("th",{class:"r"},"Abertas"),el("th",{class:"r"},"Atrasadas"),el("th",{class:"r"},"Fatais 7d"),el("th",{class:"r"},"Concluídas"),el("th",{class:"r"},"No prazo"),el("th",{class:"r"},"Com atraso"),el("th",{class:"r",title:"Reagendamentos feitos por esta pessoa no mês (prazo alterado em tarefas já com prazo)"},"Reagendou (mês)"))),
    el("tbody",{},agg.size?[...agg.entries()].map(([k,a])=>el("tr",{},el("td",{},k),el("td",{class:"r num"},String(a.abertas)),el("td",{class:"r num",style:a.atrasadas?"color:var(--crit);font-weight:600":""},String(a.atrasadas)),el("td",{class:"r num"},String(a.fatais_7d)),el("td",{class:"r num"},String(a.concluidas)),el("td",{class:"r num"},String(a.concluidas_no_prazo)),el("td",{class:"r num"},String(a.concluidas_com_atraso)),el("td",{class:"r num",style:a.reag>=3?"color:var(--warn);font-weight:600":""},String(a.reag)+(a.reag_sem?` (${a.reag_sem} sem motivo)`:"")))):el("tr",{},el("td",{colspan:8,class:"note"},"Nenhuma tarefa ainda"))))));
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
  if(S.tab==="tarefas")renderTarefas();if(S.tab==="horas"&&!window.PP_TS)renderHoras();}}
{const _h=window.aplicarHash;window.aplicarHash=function(){const h=(location.hash||"").slice(1);const m=/^tarefas\/([0-9a-f-]{36})$/i.exec(h);if(m){T.abrir=m[1];if(!T.ok)garantir()}return _h.apply(this,arguments)}}
window.PP_TAREFAS={lista:()=>T.tarefas,concluirComNota,abrir:id=>{T.abrir=id;S.tab="tarefas";try{localStorage.setItem("pp-tab","tarefas")}catch(_){}if(T.ok)render();else garantir()},nova:(t={})=>{if(!T.ok){garantir();setTimeout(()=>openTarefaForm(t),600);return}openTarefaForm(t)}};
window.__PP_LOGIN.then(()=>{if(equipe())tempoReal()});
})();
