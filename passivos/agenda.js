/* Agenda — Jurídico → Agenda: semana/dia com compromissos do painel (audiências, reuniões, perícias), tarefas com horário / prazos fatais
   e eventos vindos do Google Calendar de cada colaborador (0047). Eventos do Google são somente leitura aqui (abrem no Google). */
(()=>{
"use strict";
const A={ok:false,carregando:false,eventos:[],prazos:[],colab:[],feriados:[],modo:"semana",ref:hojeLocal(),quem:"minha",ini:null,fim:null};
try{A.quem=localStorage.getItem("pp-agenda-quem")||"minha";A.modo=localStorage.getItem("pp-agenda-modo")||"semana"}catch(_){}
function hojeLocal(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const hm=d=>String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
const segunda=d=>{const x=new Date(d);const dow=(x.getDay()+6)%7;x.setDate(x.getDate()-dow);return x};
const meuColab=()=>A.colab.find(c=>c.perfil_id===PP.perfil?.id);
const TIPO={compromisso:"Compromisso",audiencia:"Audiência",reuniao:"Reunião",pericia:"Perícia",prazo:"Prazo",outro:"Outro"};
const COR={audiencia:"var(--crit)",prazo:"var(--warn)",reuniao:"var(--info)",pericia:"#7A5AA6",compromisso:"var(--ch-a)",outro:"var(--muted)",marco:"var(--muted)"};
const DIAS=["seg","ter","qua","qui","sex","sáb","dom"];
function intervalo(){if(A.modo==="mes"){const ini=segunda(new Date(A.ref.getFullYear(),A.ref.getMonth(),1));return {ini,fim:addD(ini,42)}}const ini=A.modo==="semana"?segunda(A.ref):new Date(A.ref);const fim=addD(ini,A.modo==="semana"?7:1);return {ini,fim}}
/* prazos (tarefas sem horário, processos, negociações) viram itens de dia inteiro na agenda */
function prazoParaEvento(z){const d=parseD(z.prazo);return {id:"prazo:"+z.origem+":"+z.id,titulo:(z.prazo_fatal?"PRAZO FATAL: ":"")+z.descricao,inicio:d.toISOString(),fim:addD(d,1).toISOString(),dia_inteiro:true,colaborador_id:z.responsavel_id,colaborador_nome:z.responsavel_nome,cliente_id:z.cliente_id,cliente_nome:z.cliente_nome,processo_id:z.processo_id,numero_cnj:z.numero_cnj||null,nucleo:z.nucleo||null,tipo:"prazo",origem:"prazo",prazo_origem:z.origem,prazo_id:z.id,prazo_fatal:z.prazo_fatal,atrasada:z.faixa==="atrasada",faixa:z.faixa}}
async function carregar(){
  if(A.carregando)return;A.carregando=true;
  try{const {ini,fim}=intervalo();const de=addD(ini,-7),ate=addD(fim,7);
    const [e,c,f,z]=await Promise.all([SB.from("v_agenda").select("*").gte("inicio",de.toISOString()).lt("inicio",ate.toISOString()).eq("cancelado",false).order("inicio"),
      A.colab.length?Promise.resolve({data:A.colab}):SB.from("colaboradores").select("id,perfil_id,nome,apelido,email,nucleo,ativo,agenda_sync,google_calendar_id,agenda_sync_em,agenda_sync_erro").order("nome"),
      SB.from("feriados").select("data,nome,tipo,uf,comarca,ativo").gte("data",iso(de)).lt("data",iso(ate)),
      SB.from("v_prazos").select("*").gte("prazo",iso(de)).lt("prazo",iso(ate))]);
    if(e.error)throw e.error;A.eventos=e.data||[];
    const comEvento=new Set(A.eventos.filter(x=>x.tarefa_id).map(x=>x.tarefa_id));
    A.prazos=(z.data||[]).filter(x=>!(x.origem==="tarefa"&&comEvento.has(x.id))).map(prazoParaEvento);A.colab=c.data||[];A.feriados=(f.data||[]).filter(x=>x.ativo!==false);A.ini=de;A.fim=ate;A.ok=true}
  catch(err){console.warn("agenda",err);toast("Não foi possível carregar a agenda")}
  finally{A.carregando=false}
  if(S.tab==="agenda")render();
}
function garantir(){const {ini,fim}=intervalo();if(A.ok&&A.ini&&ini>=A.ini&&fim<=A.fim)return true;if(!A.carregando)carregar();return false}
const recarregar=()=>{A.ok=false;carregar()};

/* Fase 4B · B4 — marcos previstos do Acompanhamento PJ (ONB/R1/R2/R3 gravados e próxima reunião mensal) como itens de dia inteiro, SÓ na V3.1 e só leitura.
   Previsto ≠ agendado ≠ realizado: o marco é uma data do planejamento — sem horário, sem evento no banco ou no Google, não conta como compromisso.
   Deduplicação só por identificador efetivo: a tarefa do ciclo criada por criarTarefasCiclo (mesmo cliente, núcleo acompanhamento_pj, título gerado
   idêntico e mesma data) — ou o compromisso derivado dessa tarefa (tarefa_id) — já representa o marco e recebe a anotação; compromissos do mesmo
   cliente no mesmo dia NUNCA são descartados: aparecem como contexto no painel do marco. */
const MARCO_T={onb:"Onboarding (ONB)",r1:"R1",r2:"R2",r3:"R3",mensal:"Reunião mensal"};
function marcosAgenda(){
  if(typeof agendaV3!=="function"||!agendaV3())return [];const AC=window.PP_ACOMP;let pode=false;try{pode=AC?.podeVer?.()===true}catch(_){pode=false}if(!pode)return [];
  let ms=null;try{ms=AC.marcos()}catch(_){ms=null}
  if(ms===null){const e=AC.estado?.();if(e&&!e.carregado&&!e.carregando&&!e.erro)AC.carregarLista?.();return []}
  const hoje=iso(hojeLocal());const out=[];
  for(const m of ms){if(!m.data||!MARCO_T[m.chave])continue;const d=parseD(m.data);const titulo=MARCO_T[m.chave]+" — "+m.cliente_nome;
    const mesmoDia=x=>iso(new Date(x.inicio))===m.data&&x.cliente_id===m.cliente_id&&String(x.titulo||"")===titulo;
    const z=A.prazos.find(x=>x.prazo_origem==="tarefa"&&x.nucleo==="acompanhamento_pj"&&mesmoDia(x))||A.eventos.find(x=>x.tarefa_id&&mesmoDia(x));
    if(z){z.marco=m;continue}
    const col=A.colab.find(c=>c.id===m.responsavel_id);
    out.push({id:"marco:"+m.chave+":"+m.cliente_id+":"+m.data,titulo,inicio:d.toISOString(),fim:addD(d,1).toISOString(),dia_inteiro:true,colaborador_id:m.responsavel_id||null,colaborador_nome:col?.nome||null,cliente_id:m.cliente_id,cliente_nome:m.cliente_nome,tipo:"marco",origem:"acompanhamento",marco:m,vencido:!m.realizada&&m.data<hoje})}
  return out;
}
const todosItens=()=>[...A.eventos,...A.prazos,...marcosAgenda()];
function visiveis(){
  const meu=meuColab();
  const todos=todosItens();
  return todos.filter(ev=>A.quem==="equipe"||(A.quem==="minha"?(!meu||ev.colaborador_id===meu.id||!ev.colaborador_id):ev.colaborador_id===A.quem));
}
function abrir(ev){
  if(ev.origem==="tarefa"&&ev.tarefa_id){window.PP_TAREFAS?.abrir(ev.tarefa_id);return}
  if(ev.origem==="prazo"){if(ev.prazo_origem==="tarefa"){window.PP_TAREFAS?.abrir(ev.prazo_id);return}
    if(ev.cliente_id){try{history.pushState(null,"","#clientes/"+encodeURIComponent(ev.cliente_id)+"/"+(ev.prazo_origem==="processo"?"processos":"negociacoes"))}catch(_){}if(aplicarHash())render()}return}
  if(ev.lead_id){
    const body=el("div",{class:"form"},el("div",{class:"f full"},el("div",{class:"note"},`${fmtQuando(ev)}${ev.colaborador_nome?" · "+ev.colaborador_nome:""}`),ev.descricao?el("div",{class:"help",style:"white-space:pre-wrap;margin-top:8px"},ev.descricao.slice(0,1500)):null,el("div",{class:"help",style:"margin-top:10px"},"Reunião marcada no CRM — para mudar data/hora, altere o campo \"Reunião\" na ficha do lead.")));
    modal(ev.titulo,body,async()=>{},el("a",{class:"btn",href:"#leads/"+ev.lead_id,onclick:()=>{$("#modalHost").replaceChildren()}},"Abrir o lead"));
    $("#modalHost button.btn.primary")?.remove();return;
  }
  if(ev.origem==="google"){
    const body=el("div",{class:"form"},el("div",{class:"f full"},el("div",{class:"note"},`${fmtQuando(ev)}${ev.colaborador_nome?" · "+ev.colaborador_nome:""}`),ev.local?el("div",{},"📍 "+ev.local):null,ev.descricao?el("div",{class:"help",style:"white-space:pre-wrap;margin-top:8px"},ev.descricao.slice(0,1500)):null,el("div",{class:"help",style:"margin-top:10px"},"Evento criado no Google Calendar — edite por lá; a alteração chega aqui na próxima sincronização.")));
    modal(ev.titulo,body,async()=>{},ev.link?el("a",{class:"btn",href:ev.link,target:"_blank",rel:"noopener"},"Abrir no Google"):null);
    $("#modalHost button.btn.primary")?.remove();return;
  }
  formEvento(ev);
}
const fmtQuando=ev=>{const i=new Date(ev.inicio),f=new Date(ev.fim);return ev.dia_inteiro?i.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"}):`${i.toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit"})} ${hm(i)}–${hm(f)}`};
function formEvento(ev={},padrao={}){
  const i=ev.inicio?new Date(ev.inicio):(padrao.inicio||new Date(A.ref.getFullYear(),A.ref.getMonth(),A.ref.getDate(),9,0));const f=ev.fim?new Date(ev.fim):addMin(i,60);
  const titulo=inp("text",ev.titulo||"",{placeholder:"Ex.: Audiência de conciliação — RD Oliveira"}),tipo=sel(TIPO,ev.tipo||padrao.tipo||"compromisso"),data=inp("date",iso(i)),hIni=inp("time",hm(i)),hFim=inp("time",hm(f)),
    inteiro=el("input",{type:"checkbox",checked:ev.dia_inteiro?"":null}),colab=sel({"":"—",...Object.fromEntries(A.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},ev.colaborador_id||meuColab()?.id||""),
    cli=sel({"":"—",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome]))},ev.cliente_id||""),local=inp("text",ev.local||"",{placeholder:"Fórum, sala, link da videoconferência…"}),desc=el("textarea",{rows:3},ev.descricao||"");
  const pro=sel({"":"—"},"");const vincula=()=>{const lista=(window.PP_PROCESSOS?.lista?.()||[]).filter(p=>!cli.value||p.cliente_id===cli.value);pro.replaceChildren(el("option",{value:""},"—"),...lista.map(p=>el("option",{value:p.id,selected:p.id===ev.processo_id?"":null},(p.numero_cnj||"(sem número)")+(p.parte_contraria?" · "+p.parte_contraria:""))))};cli.onchange=vincula;vincula();
  const ajusta=()=>{hIni.disabled=hFim.disabled=inteiro.checked};inteiro.onchange=ajusta;ajusta();
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{for:"ag-tit"},"Título"),Object.assign(titulo,{id:"ag-tit"})),field("ag-tipo","Tipo",tipo),field("ag-colab","Responsável / agenda de",colab,"Vai para o Google Calendar dessa pessoa, se a sincronização dela estiver ligada."),
    field("ag-data","Data",data),el("div",{class:"f"},el("label",{},"Horário"),el("div",{style:"display:flex;gap:8px;align-items:center"},hIni,el("span",{class:"note"},"às"),hFim),el("label",{style:"display:inline-flex;gap:6px;align-items:center;margin-top:6px;font-size:13px"},inteiro," dia inteiro")),
    field("ag-cli","Cliente",cli),field("ag-pro","Processo",pro),field("ag-local","Local / link",local),field("ag-desc","Observações",desc));
  const extra=ev.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirm("Cancelar este compromisso?"))return;const {error}=await SB.from("agenda_eventos").update({cancelado:true}).eq("id",ev.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível cancelar":"Compromisso cancelado");recarregar()}},"Cancelar compromisso"):null;
  modal(ev.id?"Editar compromisso":"Novo compromisso",body,async()=>{
    if(!titulo.value.trim())throw new Error("Informe o título");if(!data.value)throw new Error("Informe a data");
    let ini,fim;if(inteiro.checked){ini=new Date(data.value+"T00:00:00");fim=addD(ini,1)}else{if(!hIni.value||!hFim.value)throw new Error("Informe o horário");ini=new Date(data.value+"T"+hIni.value+":00");fim=new Date(data.value+"T"+hFim.value+":00");if(fim<=ini)fim=addMin(ini,60)}
    const row={titulo:titulo.value.trim(),tipo:tipo.value,inicio:ini.toISOString(),fim:fim.toISOString(),dia_inteiro:inteiro.checked,colaborador_id:colab.value||null,cliente_id:cli.value||null,processo_id:pro.value||null,local:local.value.trim()||null,descricao:desc.value.trim()||null};
    const q=ev.id?SB.from("agenda_eventos").update(row).eq("id",ev.id):SB.from("agenda_eventos").insert({...row,origem:"painel"});const {error}=await q;if(error)throw error;
    toast("Compromisso salvo");recarregar();
  },extra);
}
const addMin=(d,n)=>new Date(d.getTime()+n*60000);
async function sincronizarAgora(){
  try{const {data:{session}}=await SB.auth.getSession();if(!session)throw new Error("Faça login de novo");toast("Sincronizando com o Google…");
    const r=await fetch(SB_URL+"/functions/v1/chatguru/enviar",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify({acao:"agenda"})});
    const j=await r.json().catch(()=>({ok:false,erro:"Resposta inválida"}));if(!r.ok||j.ok===false)throw new Error(j.erro||("HTTP "+r.status));
    const cs=j.colaboradores||[];const erros=cs.flatMap(c=>c.erros||[]);toast(cs.length?`${cs.length} agenda(s): ${cs.reduce((s,c)=>s+(c.enviados||0),0)} enviados, ${cs.reduce((s,c)=>s+(c.recebidos||0),0)} recebidos${erros.length?" · "+erros.length+" erro(s)":""}`:"Ninguém com sincronização ligada (Equipe → Colaboradores)");
    if(erros.length)console.warn("agenda sync",erros);A.colab=[];recarregar()}
  catch(e){toast("Não foi possível sincronizar: "+e.message)}
}

/* grade de horas (7h–20h) — componente único, usado pela V2 e pelo modo "Grade" da V3.1; clicar numa célula vazia abre o formulário
   no horário (comportamento existente), clicar num chip abre o compromisso (modal na V2, painel na V3.1) */
function montarGrade(dias,porDia,evs){
  const H0=7,H1=20;const grade=el("div",{class:"ag-grade",style:`grid-template-columns:52px repeat(${dias.length},1fr)`});
  const feriadosDe=d=>A.feriados.filter(f=>f.data===iso(d));
  const marcaFeriado=d=>{const fs=feriadosDe(d);if(!fs.length)return null;const nac=fs.find(f=>f.tipo==="nacional");const f=nac||fs[0];
    return el("div",{class:"ag-fer"+(nac?" nac":""),title:fs.map(x=>`${x.nome} (${x.tipo}${x.uf?" "+x.uf:""}${x.comarca?" · "+x.comarca:""})`).join("\n")+(nac?"\nFeriado nacional: folga no escritório":"\nTrabalhamos normalmente; conta para prazos forenses")},(nac?"🏖 ":"⚖ ")+f.nome)};
  grade.append(el("div",{class:"ag-c"}));dias.forEach(d=>grade.append(el("div",{class:"ag-c ag-h"+(iso(d)===iso(hojeLocal())?" hoje":"")+(feriadosDe(d).some(f=>f.tipo==="nacional")?" folga":"")},el("div",{class:"ag-dow"},DIAS[(d.getDay()+6)%7]),el("div",{class:"ag-dn"},String(d.getDate())),marcaFeriado(d))));
  grade.append(el("div",{class:"ag-c ag-lbl"},"dia"));dias.forEach(d=>{const cel=el("div",{class:"ag-c ag-inteiro",onclick:e=>{if(e.target===cel)formEvento({},{inicio:new Date(d.getFullYear(),d.getMonth(),d.getDate(),9,0)})}});porDia(d).filter(e=>e.dia_inteiro).forEach(e=>cel.append(chip(e)));grade.append(cel)});
  for(let h=H0;h<H1;h++){grade.append(el("div",{class:"ag-c ag-lbl"},String(h).padStart(2,"0")+"h"));dias.forEach(d=>{const cel=el("div",{class:"ag-c ag-slot",onclick:e=>{if(e.target===cel)formEvento({},{inicio:new Date(d.getFullYear(),d.getMonth(),d.getDate(),h,0)})}});porDia(d).filter(e=>!e.dia_inteiro&&new Date(e.inicio).getHours()===h).forEach(e=>cel.append(chip(e,true)));grade.append(cel)})}
  const fora=evs.filter(e=>!e.dia_inteiro&&(new Date(e.inicio).getHours()<H0||new Date(e.inicio).getHours()>=H1)&&dias.some(d=>iso(d)===iso(new Date(e.inicio))));
  return {grade,fora};
}

/* ---------- render ---------- */
function renderAgenda(){
  const v=$("#view-agenda");v.replaceChildren();
  const {ini,fim}=intervalo();
  const rot=A.modo==="mes"?A.ref.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}):A.modo==="semana"?`${ini.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} – ${addD(fim,-1).toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"})}`:A.ref.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const nav=el("div",{class:"ag-nav"},el("button",{class:"btn sm",onclick:()=>{A.ref=A.modo==="mes"?new Date(A.ref.getFullYear(),A.ref.getMonth()-1,1):addD(A.ref,A.modo==="semana"?-7:-1);render()}},"‹"),el("button",{class:"btn sm",onclick:()=>{A.ref=hojeLocal();render()}},"Hoje"),el("button",{class:"btn sm",onclick:()=>{A.ref=A.modo==="mes"?new Date(A.ref.getFullYear(),A.ref.getMonth()+1,1):addD(A.ref,A.modo==="semana"?7:1);render()}},"›"),el("b",{style:"margin-left:6px"},rot));
  const modo=el("div",{class:"tabs"},[["mes","Mês"],["semana","Semana"],["dia","Dia"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(A.modo===k),onclick:()=>{A.modo=k;try{localStorage.setItem("pp-agenda-modo",k)}catch(_){}render()}},l)));
  const quem=sel({minha:"Minha agenda",equipe:"Toda a equipe",...Object.fromEntries(A.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},A.quem);quem.onchange=()=>{A.quem=quem.value;try{localStorage.setItem("pp-agenda-quem",A.quem)}catch(_){}render()};
  const meu=meuColab();const sync=meu?.agenda_sync?el("span",{class:"note",title:meu.agenda_sync_erro||""},meu.agenda_sync_erro?"⚠️ Google: "+meu.agenda_sync_erro.slice(0,60):meu.agenda_sync_em?"Google sincronizado "+new Date(meu.agenda_sync_em).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"Google: aguardando 1ª sincronização"):el("span",{class:"note"},"Google Calendar desligado para você (Equipe → Colaboradores)");
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Agenda"),el("h1",{},"Agenda"),el("div",{class:"sub"},"Audiências, reuniões, perícias e prazos — do painel e do Google Calendar de cada pessoa. Feriados aparecem no cabeçalho do dia: nacional = folga; estadual, municipal e forense = trabalhamos, mas contam para prazos.")),
    el("div",{class:"actions"},quem,modo,el("button",{class:"btn",onclick:sincronizarAgora,title:"Envia os compromissos pendentes ao Google e busca o que mudou lá (automático a cada 15 min)"},"Sincronizar"),el("button",{class:"btn",onclick:()=>irPara("feriados"),title:"Cadastro de feriados e suspensões de prazo"},"Feriados e prazos"),btnExportar("agenda",()=>visiveis().slice().sort((x,y)=>x.inicio<y.inicio?-1:1),[{k:"inicio",t:"Data",f:v=>v?new Date(v).toLocaleDateString("pt-BR"):""},{k:"inicio",t:"Hora",f:(v,l)=>l.dia_inteiro?"dia inteiro":new Date(v).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})},{k:"tipo",t:"Tipo"},{k:"titulo",t:"Título"},{k:"colaborador_nome",t:"Responsável"},{k:"cliente_nome",t:"Cliente"},{k:"numero_cnj",t:"Processo"},{k:"local",t:"Local"},{k:"origem",t:"Origem"}]),el("button",{class:"btn primary",onclick:()=>formEvento({})},"+ Compromisso"))));
  v.append(el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"},nav,sync));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const evs=visiveis();
  const dias=[];for(let d=new Date(ini);d<fim;d=addD(d,1))dias.push(d);
  const porDia=d=>{const k=iso(d);return evs.filter(e=>{const s=new Date(e.inicio);return e.dia_inteiro?iso(s)<=k&&iso(addD(new Date(e.fim),-1))>=k:iso(s)===k})};
  if(A.modo==="mes"){renderMes(v,dias,porDia);return}
  const {grade,fora}=montarGrade(dias,porDia,evs);
  v.append(el("div",{class:"card",style:"overflow:auto"},grade));
  if(fora.length)v.append(el("div",{class:"note"},"Fora do horário exibido (7h–20h): "+fora.map(e=>`${hm(new Date(e.inicio))} ${e.titulo}`).join(" · ")));
  if(A.modo==="dia"){const lista=porDia(A.ref);v.append(el("div",{class:"card"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{},"Compromissos do dia"),el("span",{class:"note"},String(lista.length))),lista.length?el("div",{class:"list"},lista.map(e=>el("button",{class:"row",onclick:()=>abrir(e)},el("div",{},el("div",{class:"n"},el("i",{style:`display:inline-block;width:9px;height:9px;border-radius:50%;background:${COR[e.tipo]||COR.outro};margin-right:8px`}),e.titulo),el("div",{class:"s"},[e.dia_inteiro?"dia inteiro":hm(new Date(e.inicio))+"–"+hm(new Date(e.fim)),e.colaborador_nome,e.cliente_nome,e.local].filter(Boolean).join(" · "))),el("span",{class:"pill g"},e.origem==="google"?"Google":e.origem==="tarefa"?"tarefa":TIPO[e.tipo]||e.tipo)))):el("div",{class:"empty"},"Nada marcado para este dia.")))}
  v.append(el("div",{class:"ag-legenda"},Object.entries(TIPO).map(([k,l])=>el("span",{},el("i",{style:`background:${COR[k]||COR.outro}`}),l)),el("span",{},el("i",{style:"background:transparent;border:1.5px dashed var(--muted)"}),"do Google")));
}
function montarMes(dias,porDia){
  const hoje=iso(hojeLocal()),mes=A.ref.getMonth();
  const g=el("div",{class:"ag-mes"});DIAS.forEach(d=>g.append(el("div",{class:"ag-mh"},d)));
  const feriadosDe=d=>A.feriados.filter(f=>f.data===iso(d));
  dias.forEach(d=>{const k=iso(d),lista=porDia(d).sort((a,b)=>(a.dia_inteiro?0:1)-(b.dia_inteiro?0:1)||a.inicio.localeCompare(b.inicio));const fs=feriadosDe(d);const nac=fs.find(f=>f.tipo==="nacional");
    const cel=el("div",{class:"ag-mc"+(d.getMonth()!==mes?" fora":"")+(k===hoje?" hoje":"")+(nac?" folga":""),onclick:e=>{if(e.target===cel||e.target.classList.contains("ag-mn"))formEvento({},{inicio:new Date(d.getFullYear(),d.getMonth(),d.getDate(),9,0)})}},
      el("div",{class:"ag-mn"},el("span",{class:"ag-dn"},String(d.getDate())),fs.length?el("span",{class:"ag-mf"+(nac?" nac":""),title:fs.map(x=>x.nome+" ("+x.tipo+")").join("\n")},nac?"🏖":"⚖"):null,lista.length?el("span",{class:"ag-mq"},String(lista.length)):null));
    lista.slice(0,4).forEach(e=>cel.append(chip(e,!e.dia_inteiro)));
    if(lista.length>4)cel.append(el("button",{class:"ag-mais",onclick:e=>{e.stopPropagation();A.modo="dia";A.ref=new Date(d);render()}},"+ "+(lista.length-4)+" mais"));
    g.append(cel)});
  const no=dias.filter(d=>d.getMonth()===mes).flatMap(d=>porDia(d));const atras=no.filter(e=>e.atrasada).length,fat=no.filter(e=>e.prazo_fatal).length;
  const nota=`${no.length} item(ns) no mês · ${no.filter(e=>e.tipo==="prazo").length} prazos${fat?" ("+fat+" fatais)":""} · ${no.filter(e=>e.tipo!=="prazo").length} compromissos${atras?" · "+atras+" atrasado(s)":""}`;
  return {g,nota};
}
function renderMes(v,dias,porDia){
  const {g,nota}=montarMes(dias,porDia);
  v.append(el("div",{class:"card",style:"overflow:auto"},g));
  v.append(el("div",{class:"note"},nota));
  v.append(el("div",{class:"ag-legenda"},Object.entries(TIPO).map(([k,l])=>el("span",{},el("i",{style:`background:${COR[k]||COR.outro}`}),l)),el("span",{},el("i",{style:"background:var(--crit)"}),"atrasado"),el("span",{},el("i",{style:"background:transparent;border:1.5px dashed var(--muted)"}),"do Google")));
}
const abrirEv=e=>(typeof agendaV3==="function"&&agendaV3()&&G3.painel)?abrirPainelAgV3(e,null):abrir(e);
function chip(e,comHora){
  const c=el("button",{class:"ag-ev"+(e.origem==="google"?" google":"")+(e.tipo==="marco"?" marco":"")+(e.atrasada?" atrasada":"")+(e.prazo_fatal?" fatal":""),style:`--c:${COR[e.tipo]||COR.outro}`,title:`${e.titulo}\n${fmtQuando(e)}${e.colaborador_nome?"\n"+e.colaborador_nome:""}`,onclick:ev=>{ev.stopPropagation();abrirEv(e)}},
    comHora?el("b",{},hm(new Date(e.inicio))+" "):null,e.titulo,A.quem==="equipe"&&e.colaborador_nome?el("small",{}," · "+e.colaborador_nome.split(" ")[0]):null);
  return c;
}
const css=document.createElement("style");css.textContent=`
.ag-nav{display:flex;align-items:center;gap:6px}
.ag-grade{display:grid;min-width:720px;font-size:12.5px}.ag-c{border-bottom:1px solid var(--line);border-right:1px solid var(--line);min-height:38px;padding:2px 3px;display:flex;flex-direction:column;gap:2px}
.ag-h{text-align:center;padding:8px 2px;background:var(--surface-2)}.ag-h.hoje .ag-dn{background:var(--btn-primary);color:#fff;border-radius:999px;display:inline-block;width:26px;line-height:26px}
.ag-dow{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.ag-dn{font-weight:600;font-size:15px}
.ag-fer{font-size:10.5px;line-height:1.2;margin-top:3px;padding:2px 5px;border-radius:6px;background:var(--surface);border:1px dashed var(--muted);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.ag-fer.nac{background:color-mix(in srgb,var(--crit) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--crit) 40%,transparent);color:var(--crit)}.ag-h.folga{background:color-mix(in srgb,var(--crit) 6%,var(--surface-2))}
.ag-lbl{color:var(--muted);font-size:11px;justify-content:flex-start;align-items:flex-end;padding-right:6px;background:var(--surface-2)}
.ag-inteiro{background:color-mix(in srgb,var(--surface-2) 50%,transparent);min-height:30px}.ag-slot{cursor:pointer;min-height:40px}.ag-slot:hover{background:color-mix(in srgb,var(--btn-primary) 5%,transparent)}
.ag-ev{border:0;max-width:100%;min-width:0;border-left:3px solid var(--c);background:color-mix(in srgb,var(--c) 13%,var(--surface));color:var(--fg);text-align:left;border-radius:6px;padding:3px 6px;font:inherit;font-size:12px;cursor:pointer;line-height:1.25;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ag-ev:hover{filter:brightness(.96)}.ag-ev b{font-weight:600}.ag-ev.google{border-left-style:dashed;background:var(--surface);border:1px dashed var(--muted);border-left:3px dashed var(--c)}
.ag-ev.atrasada{--c:var(--crit);background:color-mix(in srgb,var(--crit) 16%,var(--surface))}.ag-ev.fatal{font-weight:600}
.ag-mes{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:720px;font-size:12.5px}.ag-mh{text-align:center;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:8px 2px;background:var(--surface-2);border-bottom:1px solid var(--line)}
.ag-mc{min-height:104px;min-width:0;border-bottom:1px solid var(--line);border-right:1px solid var(--line);padding:4px;display:flex;flex-direction:column;gap:2px;cursor:pointer}.ag-mc:hover{background:color-mix(in srgb,var(--btn-primary) 4%,transparent)}.ag-mc.fora{opacity:.45}.ag-mc.folga{background:color-mix(in srgb,var(--crit) 6%,var(--surface-2))}
.ag-mn{display:flex;align-items:center;gap:6px;margin-bottom:2px}.ag-mn .ag-dn{font-size:13px}.ag-mc.hoje .ag-dn{background:var(--btn-primary);color:#fff;border-radius:999px;display:inline-block;width:24px;line-height:24px;text-align:center}
.ag-mq{margin-left:auto;font-size:10.5px;color:var(--muted);background:var(--surface-2);border-radius:999px;padding:0 6px}.ag-mf{font-size:11px}.ag-mais{border:0;background:none;color:var(--muted);font:inherit;font-size:11.5px;text-align:left;cursor:pointer;padding:2px 4px}.ag-mais:hover{color:var(--fg)}
.ag-legenda{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.ag-legenda i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}`;document.head.append(css);

/* ============================================================================================================
   V3.1 (Design System, Fase 4A) — Agenda: mesma leitura (v_agenda + v_prazos + feriados + colaboradores), outra apresentação:
   lista por dia com régua e painel de detalhe (split/overlay/cheia) em vez da grade de horas. Novo/editar compromisso continua
   no formEvento (mesma gravação em agenda_eventos); Google e lead continuam só leitura. Ativa só com html.np-casca-v3 + np-ui.
   ============================================================================================================ */
const ctxV3=a=>a.filter(Boolean).flatMap((x,i)=>i?[" · ",x]:[x]);
const agendaV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const G3={obra:null,painel:null,aberta:null};
const TIPO_M={compromisso:"compromisso",audiencia:"audiência",reuniao:"reunião",pericia:"perícia",prazo:"prazo",outro:""};
const hmV3=d=>String(d.getHours()).padStart(2,"0")+"h"+String(d.getMinutes()).padStart(2,"0");
function linhaAgV3(e,{comDia=false}={}){
  const i=new Date(e.inicio);const p=NPUI.prazoTxt(iso(i),e.dia_inteiro?null:hm(i));
  if(!comDia){p.curta=e.tipo==="marco"?"previsto":e.origem==="prazo"?"prazo":e.dia_inteiro?"dia inteiro":p.hora||"—";p.hora="";p.rel=""}else p.rel="";
  if(!e.dia_inteiro&&comDia)p.hora=hmV3(i);
  const regua=e.atrasada?"late":e.prazo_fatal?"fatal":e.tipo==="prazo"?"att":null;
  const dir=[e.prazo_fatal?NPUI.marca("fatal","crit"):e.origem==="prazo"?(e.prazo_origem==="processo"?NPUI.marca("processo"):e.prazo_origem==="negociacao"?NPUI.marca("negociação"):null):TIPO_M[e.tipo]?NPUI.marca(TIPO_M[e.tipo],e.tipo==="audiencia"?"crit":""):null,e.origem==="google"?NPUI.marca("Google"):e.origem==="tarefa"?NPUI.marca("tarefa"):e.origem==="lead"?NPUI.marca("CRM"):null,
    e.tipo==="marco"?NPUI.marca(e.marco.realizada?"realizada":e.vencido?"previsto · não realizado":"marco previsto",e.marco.realizada?"ok":e.vencido?"att":""):e.marco?NPUI.marca("marco "+e.marco.rotulo):null,NPUI.quem(e.colaborador_nome)];
  const fimOk=e.fim&&!isNaN(new Date(e.fim));const fimTxt=!e.dia_inteiro&&fimOk?"até "+hmV3(new Date(e.fim)):null;
  const nDias=e.dia_inteiro&&fimOk?Math.round((new Date(e.fim)-new Date(e.inicio))/864e5):1;const diasTxt=nDias>1?`${nDias} dias (até ${addD(new Date(e.fim),-1).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})})`:null;
  return NPUI.linha({id:e.id,regua,prazo:{...p,tom:regua==="late"||regua==="fatal"?"crit":regua==="att"?"att":""},titulo:String(e.titulo||"").replace(/^PRAZO FATAL:\s*/,""),contexto:ctxV3([e.cliente_nome,e.local,fimTxt,diasTxt]),direita:dir,atual:G3.aberta===e.id,onOpen:li=>abrirPainelAgV3(e,li),titleAbrir:"Ver o compromisso"});
}
function abrirPainelAgV3(e,li,{silencioso}={}){
  if(!G3.painel){abrir(e);return}G3.aberta=e.id;
  if(e.tipo==="marco"){abrirPainelMarco(e,li,{silencioso});return}
  const i=new Date(e.inicio),f=e.fim?new Date(e.fim):null;const fimOk=f&&!isNaN(f);const TIPO_L={compromisso:"Compromisso",audiencia:"Audiência",reuniao:"Reunião",pericia:"Perícia",prazo:"Prazo",outro:"Outro"};
  const dl=d=>d.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"});
  const quando=e.dia_inteiro?(fimOk&&Math.round((f-i)/864e5)>1?`${dl(i)} a ${dl(addD(f,-1))}`:dl(i)):`${dl(i)} · ${hmV3(i)}${fimOk?"–"+hmV3(f):" (sem horário de término)"}`;
  const origem=e.origem==="google"?"Google Calendar (edite por lá; chega aqui na próxima sincronização)":e.origem==="tarefa"?"tarefa com horário":e.origem==="lead"?"reunião marcada no CRM (altere na ficha do lead)":e.origem==="prazo"?(e.prazo_origem==="tarefa"?"prazo de tarefa":e.prazo_origem==="processo"?"prazo processual":"prazo de negociação"):"compromisso do painel";
  const props=NPUI.props([["Quando",quando],["Tipo",e.prazo_fatal?"Prazo fatal":TIPO_L[e.tipo]||e.tipo||"—"],["Responsável",e.colaborador_nome||"—"],e.cliente_nome?["Cliente",e.cliente_nome]:null,e.numero_cnj?["Processo",e.numero_cnj]:null,e.local?["Local",e.local]:null,["Origem",origem]]);
  const desc=e.descricao?NPUI.secao("Observações",el("p",{class:"np-txt"},String(e.descricao).slice(0,1500))):null;
  const acomp=e.marco&&e.cliente_id&&window.PP_ACOMP?.bloco?window.PP_ACOMP.bloco(e.cliente_id,{titulo:"Acompanhamento PJ · marco "+e.marco.rotulo}):null; // tarefa/compromisso que representa um marco do ciclo (Fase 4B)
  const pe=[];
  // prazo processual: tarefas com prazo vinculadas ao mesmo processo (linhas próprias em v_prazos) aparecem aqui como atalho
  const vinc=e.origem==="prazo"&&e.prazo_origem==="processo"&&e.processo_id?A.prazos.filter(x=>x.prazo_origem==="tarefa"&&x.processo_id===e.processo_id):[];
  const secVinc=vinc.length?NPUI.secao(`Tarefas do processo (${vinc.length})`,el("ul",{class:"np-vinc"},vinc.map(x=>el("li",{},NPUI.btn(String(x.titulo||"").replace(/^PRAZO FATAL:\s*/,""),{variante:"ghost",onclick:()=>window.PP_TAREFAS?.abrir(x.prazo_id)}),el("span",{class:"np-sem"}," · "+parseD(x.inicio.slice(0,10)).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})))))):null;
  if(e.origem==="prazo"){if(e.prazo_origem==="tarefa")pe.push(NPUI.btn("Abrir a tarefa",{variante:"pri",onclick:()=>window.PP_TAREFAS?.abrir(e.prazo_id)}));else if(e.cliente_id)pe.push(NPUI.btn(e.prazo_origem==="processo"?"Abrir cliente · Processos":"Abrir cliente · Negociações",{variante:"pri",title:"Abre a ficha do cliente na aba correspondente",onclick:()=>{try{history.pushState(null,"","#clientes/"+encodeURIComponent(e.cliente_id)+"/"+(e.prazo_origem==="processo"?"processos":"negociacoes"))}catch(_){}if(aplicarHash())render()}}))}
  else if(e.origem==="tarefa"&&e.tarefa_id)pe.push(NPUI.btn("Abrir a tarefa",{variante:"pri",onclick:()=>window.PP_TAREFAS?.abrir(e.tarefa_id)}));
  else if(e.lead_id)pe.push(NPUI.btn("Abrir o lead",{variante:"pri",onclick:()=>{location.hash="#leads/"+e.lead_id}}));
  else if(e.origem==="google"){if(e.link)pe.push(el("a",{class:"np-btn pri",href:e.link,target:"_blank",rel:"noopener"},"Abrir no Google"))}
  else if(!readOnly())pe.push(NPUI.btn("Editar",{variante:"pri",onclick:()=>formEvento(e)}));
  if(e.cliente_id&&e.origem!=="prazo")pe.push(NPUI.btn("Abrir o cliente",{onclick:()=>{try{history.pushState(null,"","#clientes/"+encodeURIComponent(e.cliente_id))}catch(_){}if(aplicarHash())render()}}));
  G3.painel.abrir({id:e.id,trilha:[el("span",{},"Agenda"),el("span",{},e.origem==="prazo"?(e.prazo_fatal?"Prazo fatal":"Prazo"):"Compromisso")],titulo:String(e.titulo||"").replace(/^PRAZO FATAL:\s*/,""),corpo:[props,secVinc,acomp,desc],pe,origem:silencioso?null:(li?.querySelector(".np-it-abrir")||li)});
}
/* painel do marco previsto: só dados do Acompanhamento PJ; mostra (sem descartar) os compromissos e tarefas do mesmo cliente no dia; nada é gravado daqui */
function abrirPainelMarco(e,li,{silencioso}={}){
  const m=e.marco;const d=new Date(e.inicio);const k=iso(d);const hoje=iso(hojeLocal());
  const dl=d.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"});
  const situ=m.realizada?NPUI.marca("realizada — registrada no acompanhamento","ok"):e.vencido?NPUI.marca("prevista, ainda não registrada como realizada","att"):NPUI.marca("prevista no planejamento — não é compromisso confirmado");
  const props=NPUI.props([["Quando",dl+" (data prevista, sem horário)"],["Marco",m.rotulo],["Situação",situ],["Cliente",e.cliente_nome||"—"],["Resp. estratégico",e.colaborador_nome||"— ninguém —"],["Origem","data gravada no Acompanhamento PJ (planejamento); não cria compromisso nem evento no Google"]]);
  const abrirItem=x=>()=>{const li2=G3.obra?.querySelector(`.np-it[data-id="${x.id}"]`);abrirPainelAgV3(x,li2||null)};
  const comp=A.eventos.filter(x=>x.cliente_id===e.cliente_id&&!x.cancelado&&iso(new Date(x.inicio))===k);
  const secComp=NPUI.secao(`Compromissos do cliente neste dia (${comp.length})`,comp.length?el("ul",{class:"np-vinc"},comp.map(x=>el("li",{},NPUI.btn(String(x.titulo||""),{variante:"ghost",onclick:abrirItem(x)}),el("span",{class:"np-sem"}," · "+(x.dia_inteiro?"dia inteiro":hmV3(new Date(x.inicio)))+(x.origem==="google"?" · Google":""))))):el("div",{class:"np-sem"},"Nenhum compromisso marcado para este cliente neste dia."));
  const tz=A.prazos.filter(x=>x.prazo_origem==="tarefa"&&x.cliente_id===e.cliente_id&&x.nucleo==="acompanhamento_pj");
  const secTz=tz.length?NPUI.secao(`Tarefas do ciclo deste cliente no período (${tz.length})`,el("ul",{class:"np-vinc"},tz.map(x=>el("li",{},NPUI.btn(String(x.titulo||"").replace(/^PRAZO FATAL:\s*/,""),{variante:"ghost",onclick:()=>window.PP_TAREFAS?.abrir(x.prazo_id)}),el("span",{class:"np-sem"}," · "+parseD(x.inicio.slice(0,10)).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})))))):null;
  const pe=[NPUI.btn("Abrir acompanhamento",{variante:"pri",onclick:()=>window.PP_ACOMP?.abrir?.(e.cliente_id)})];
  if(!readOnly()&&!m.realizada)pe.push(NPUI.btn("Marcar compromisso…",{title:"Abre o formulário de compromisso já com cliente e título; você define o horário",onclick:()=>formEvento({titulo:e.titulo,tipo:"reuniao",cliente_id:e.cliente_id,colaborador_id:e.colaborador_id||meuColab()?.id||null},{inicio:new Date(d.getFullYear(),d.getMonth(),d.getDate(),9,0)})}));
  G3.painel.abrir({id:e.id,trilha:[el("span",{},"Agenda"),el("span",{},"Marco previsto")],titulo:e.titulo,corpo:[props,secComp,secTz],pe,origem:silencioso?null:(li?.querySelector(".np-it-abrir")||li)});
}
function renderAgendaV3(){
  const v=$("#view-agenda");v.replaceChildren();v.classList.add("np-v3");G3.obra=null;G3.painel=null;
  const {ini,fim}=intervalo();const hoje=iso(hojeLocal());
  const fimS=addD(fim,-1);const rot=A.modo==="mes"?A.ref.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}):A.modo==="semana"?(ini.getMonth()===fimS.getMonth()?`${ini.getDate()} a ${fimS.getDate()} de ${fimS.toLocaleDateString("pt-BR",{month:"long"})}`:`${ini.getDate()} de ${ini.toLocaleDateString("pt-BR",{month:"long"})} a ${fimS.getDate()} de ${fimS.toLocaleDateString("pt-BR",{month:"long"})}`):A.ref.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"});
  if(!garantir()){v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  const evs=visiveis();const dias=[];for(let d=new Date(ini);d<fim;d=addD(d,1))dias.push(d);
  const porDia=d=>{const k=iso(d);return evs.filter(e=>{const s0=new Date(e.inicio);return e.dia_inteiro?iso(s0)<=k&&iso(addD(new Date(e.fim),-1))>=k:iso(s0)===k}).sort((a,b)=>(a.dia_inteiro?0:1)-(b.dia_inteiro?0:1)||a.inicio.localeCompare(b.inicio))};
  const no=dias.flatMap(d=>porDia(d));const nPr=no.filter(e=>e.tipo==="prazo").length,nFat=no.filter(e=>e.prazo_fatal).length,nAtr=no.filter(e=>e.atrasada).length,nMar=no.filter(e=>e.tipo==="marco").length,nComp=no.length-nPr-nMar;
  const resumo=NPUI.resumo([{n:nFat,label:"fatais",tom:nFat?"crit":"zero"},{n:nAtr,label:"atrasados",tom:nAtr?"crit":"zero"},{n:nPr,label:"prazos",tom:nPr?"att":"zero"},{n:nComp,label:nComp===1?"compromisso":"compromissos"}].filter(Boolean)); // marcos previstos NÃO entram no resumo (não são compromissos) — a contagem vai no rodapé, para não empurrar os chips Minha agenda / Toda a equipe
  const meu=meuColab();const chips=[];const C=o=>{const c=NPUI.chip(o);chips.push(c);return c};
  const quem=(k,l,n)=>C({label:l,n,on:A.quem===k,grupo:"quem",onclick:()=>{A.quem=k;try{localStorage.setItem("pp-agenda-quem",k)}catch(_){}render()}});
  quem("minha","Minha agenda");quem("equipe","Toda a equipe");
  const outros=A.colab.filter(c=>c.ativo!==false&&c.id!==meu?.id);
  if(outros.length){chips.push(NPUI.sepv());const sel0=outros.find(c=>c.id===A.quem);if(sel0)quem(sel0.id,sel0.nome);
    const mais=NPUI.chip({label:"Pessoa…",on:false,grupo:"quem",title:"Agenda de outra pessoa"});mais.setAttribute("aria-haspopup","menu");mais.setAttribute("aria-expanded","false");mais.onclick=()=>NPUI.pop(mais,outros.map(c=>({label:c.nome,atual:A.quem===c.id,onclick:()=>{A.quem=c.id;try{localStorage.setItem("pp-agenda-quem",c.id)}catch(_){}render()}})),{label:"Agenda de",refoco:()=>document.querySelector('#view-agenda .np-chipf[aria-haspopup]')});chips.push(mais)}
  const seg=NPUI.seg([["dia","Dia"],["semana","Semana"],["mes","Mês"]],A.modo,k=>{A.modo=k;try{localStorage.setItem("pp-agenda-modo",k)}catch(_){}NPUI.vt(()=>render())},"Período");
  const vista=NPUI.pref.get("np-agenda-vista","lista");const segV=NPUI.seg([["lista","Lista"],["grade","Grade"]],vista,k=>{NPUI.pref.set("np-agenda-vista",k);NPUI.vt(()=>render())},"Visualização");
  const mover=n=>{A.ref=A.modo==="mes"?new Date(A.ref.getFullYear(),A.ref.getMonth()+n,1):addD(A.ref,n*(A.modo==="semana"?7:1));render()};
  const nav=el("span",{class:"np-nav-per",role:"group","aria-label":"Navegar no período"},NPUI.ib("chevE","Anterior",()=>mover(-1)),NPUI.btn("Hoje",{variante:"ghost",onclick:()=>{A.ref=hojeLocal();render()}}),NPUI.ib("chevD","Próximo",()=>mover(1)));
  const sync=meu?.agenda_sync?(meu.agenda_sync_erro?"Google: "+meu.agenda_sync_erro.slice(0,60):meu.agenda_sync_em?"Google sincronizado "+new Date(meu.agenda_sync_em).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"Google: aguardando 1ª sincronização"):"Google Calendar desligado para você";
  const mais=NPUI.ib("pontos","Mais ações",()=>NPUI.pop(mais,[{label:"Sincronizar com o Google",title:"Envia os compromissos pendentes ao Google e busca o que mudou lá (automático a cada 15 min)",onclick:sincronizarAgora},{label:"Feriados e suspensões de prazo",onclick:()=>irPara("feriados")},{label:"Exportar CSV",onclick:()=>{const ls=visiveis().slice().sort((x,y)=>x.inicio<y.inicio?-1:1);if(!ls.length){toast("Nada para exportar");return}exportarCSV("agenda",ls,[{k:"inicio",t:"Data",f:v=>v?new Date(v).toLocaleDateString("pt-BR"):""},{k:"inicio",t:"Hora",f:(v,l)=>l.dia_inteiro?"dia inteiro":new Date(v).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})},{k:"tipo",t:"Tipo"},{k:"titulo",t:"Título"},{k:"colaborador_nome",t:"Responsável"},{k:"cliente_nome",t:"Cliente"},{k:"numero_cnj",t:"Processo"},{k:"local",t:"Local"},{k:"origem",t:"Origem"}]);toast(`${ls.length} linha(s) exportada(s)`)}}],{label:"Mais ações",alinhar:"dir",refoco:()=>document.querySelector('#view-agenda .np-ib[aria-label="Mais ações"]')}));mais.setAttribute("aria-haspopup","menu");mais.setAttribute("aria-expanded","false");
  const direita=[segV,seg,nav,mais,readOnly()?null:NPUI.btn("Compromisso",{variante:"pri",icone:"mais",onclick:()=>formEvento({},{inicio:new Date(A.ref.getFullYear(),A.ref.getMonth(),A.ref.getDate(),9,0)})})];
  v.append(NPUI.toolbar({resumo,filtros:chips,direita}));NPUI.reancorarPop();
  const obra=el("div",{class:"np-obra"});G3.obra=obra;const corpo=el("div",{class:"np-corpo"});
  corpo.append(el("div",{class:"np-ag-h"},el("h1",{},rot.replace(/^./,c=>c.toUpperCase())),el("span",{class:"np-ag-s"},sync)));
  if(vista==="grade"){ // mesma grade da V2 (horários livres, conflitos, sobreposições); chips abrem o painel; célula vazia abre o formulário no horário
    if(A.modo==="mes"){const {g,nota}=montarMes(dias,porDia);corpo.append(el("div",{class:"np-grade-w"},g),NPUI.rodape(nota,[["crit","fatal / atrasado"],["att","prazo"]]))}
    else{const {grade,fora}=montarGrade(dias,porDia,evs);corpo.append(el("div",{class:"np-grade-w"},grade));if(fora.length)corpo.append(el("p",{class:"np-sem np-fora"},"Fora do horário exibido (7h–20h): "+fora.map(e=>`${hm(new Date(e.inicio))} ${e.titulo}`).join(" · ")));corpo.append(NPUI.rodape(`${no.length} ${no.length===1?"item":"itens"} no período${nMar?` · ${nMar} marco${nMar===1?" previsto":"s previstos"} (Acompanhamento PJ)`:""} · ${evs.length} carregados`,[["crit","fatal / atrasado"],["att","prazo"]]))}
    corpo.append(el("div",{class:"ag-legenda"},Object.entries(TIPO).map(([k,l])=>el("span",{},el("i",{style:`background:${COR[k]||COR.outro}`}),l)),el("span",{},el("i",{style:"background:transparent;border:1.5px dashed var(--muted)"}),"do Google"),window.PP_ACOMP?.podeVer?.()===true?el("span",{},el("i",{style:"background:transparent;border:1.5px dotted var(--muted)"}),"marco previsto (Acompanhamento PJ)"):null));
    obra.append(corpo);v.append(obra);G3.painel=NPUI.painel({obra,label:"Compromisso",onClose:()=>{G3.aberta=null}});
    if(G3.aberta){const e=todosItens().find(x=>x.id===G3.aberta);if(e)abrirPainelAgV3(e,null,{silencioso:true});else G3.aberta=null}
    return}
  const feriadosDe=d=>A.feriados.filter(f=>f.data===iso(d));
  const grupos=[];
  dias.forEach(d=>{const k=iso(d);const l=porDia(d);const fs=feriadosDe(d);const nac=fs.find(f=>f.tipo==="nacional");
    if(A.modo==="mes"&&!l.length&&!fs.length)return;
    if(A.modo==="mes"&&d.getMonth()!==A.ref.getMonth())return;
    const lbl=d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:A.modo==="dia"?"long":undefined}).replace(/^./,c=>c.toUpperCase())+(k===hoje?" · hoje":"");
    const itens=[];
    fs.forEach(f=>itens.push(NPUI.linha({id:"fer:"+f.data+":"+f.nome,prazo:{curta:"feriado",rel:"",exata:f.nome},titulo:f.nome,contexto:ctxV3([(f.tipo||"")+(f.uf?" "+f.uf:"")+(f.comarca?" · "+f.comarca:""),f.tipo==="nacional"?"folga no escritório":"trabalhamos; conta para prazos"]),direita:[NPUI.marca(f.tipo==="nacional"?"folga":"forense",f.tipo==="nacional"?"crit":"")],titleAbrir:"Feriado",onOpen:()=>irPara("feriados")})));
    l.forEach(e=>itens.push(linhaAgV3(e)));
    if(!itens.length)itens.push(el("li",{class:"np-it np-it-vazia"},el("span",{class:"np-it-chk np-it-chk-vazio","aria-hidden":"true"}),el("span",{class:"np-it-prazo"}),el("span",{class:"np-it-abrir np-sem"},"Nada marcado."+(readOnly()?"":" Clique em Compromisso para marcar."))));
    grupos.push(NPUI.grupo({id:"d"+k,titulo:lbl,n:l.length,tom:nac?"crit":null,aberto:A.modo!=="mes"||k>=hoje,itens}))});
  if(!grupos.length)corpo.append(NPUI.vazio({titulo:"Nada neste período",texto:"Nenhum compromisso, prazo ou feriado."}));grupos.forEach(g=>corpo.append(g));
  corpo.append(NPUI.rodape(`${no.length} ${no.length===1?"item":"itens"} no período${nMar?` · ${nMar} marco${nMar===1?" previsto":"s previstos"} (Acompanhamento PJ)`:""} · ${evs.length} carregados`,[["crit","fatal / atrasado"],["att","prazo"]]));
  obra.append(corpo);v.append(obra);
  G3.painel=NPUI.painel({obra,label:"Compromisso",onClose:()=>{G3.aberta=null}});
  if(G3.aberta){const e=todosItens().find(x=>x.id===G3.aberta);if(e)abrirPainelAgV3(e,null,{silencioso:true});else G3.aberta=null}
}
document.head.append(el("style",{},`html.np-casca-v3 .np-ag-h{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:6px 0 10px}html.np-casca-v3 .np-ag-h h1{font:500 var(--np-fs-6)/1.15 var(--np-display);margin:0;color:var(--np-text)}html.np-casca-v3 .np-ag-s{font:400 var(--np-fs-1)/1.3 var(--np-ui);color:var(--np-text-3)}
html.np-casca-v3 .ag-ev.marco{background:transparent;border:1px dotted var(--muted);border-left:3px dotted var(--c);color:var(--np-text-2)}
html.np-casca-v3 .np-grade-w{overflow:auto;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);margin:0 0 10px}html.np-casca-v3 .np-fora{margin:0 0 8px;font-size:var(--np-fs-1)}html.np-casca-v3 .np-vinc{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}html.np-casca-v3 .np-vinc li{display:flex;align-items:center;gap:4px;flex-wrap:wrap}`));

{const _r=render;render=function(){_r();const v=$("#view-agenda");if(!v)return;v.hidden=S.tab!=="agenda";if(S.tab==="agenda"){if(agendaV3())renderAgendaV3();else{v.classList.remove("np-v3");renderAgenda()}}}}
window.PP_AGENDA={recarregar,novo:formEvento,sincronizar:sincronizarAgora,v3:agendaV3,abrir:id=>{const e=todosItens().find(x=>x.id===id);if(e&&agendaV3()&&G3.painel)abrirPainelAgV3(e,null);else if(e)abrir(e)},ir:(d,modo)=>{if(d)A.ref=new Date(d.getFullYear(),d.getMonth(),d.getDate());if(modo){A.modo=modo;try{localStorage.setItem("pp-agenda-modo",modo)}catch(_){}}irPara("agenda")}};
})();
