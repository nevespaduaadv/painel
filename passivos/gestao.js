/* Gestão → Visão geral — dashboard de gestão dentro do app (porta de gestao/index.html): alertas, carteira, jurídico, equipe.
   Lê as views v_carteira_resumo, v_contratos_por_estagio/banco/produto, v_carteira_por_cliente, v_acordos_mes, v_juridico_resumo,
   v_processos_por_fase/tipo, v_prazos, v_processos, v_andamentos_mes, v_horas_*_mes, v_timeline_mes, v_equipe_resumo, v_clientes_sem_registro, v_tarefas_pontualidade. */
(()=>{
"use strict";
const PERIODOS=[["m0","Mês atual"],["m3","Últimos 3 meses"],["m6","Últimos 6 meses"],["m12","Últimos 12 meses"],["ano","Ano atual"],["tudo","Desde o início"]];
const V={periodo:"m3",ok:false,carregando:false,erro:null};
try{V.periodo=localStorage.getItem("pp-visao-periodo")||"m3"}catch(_){}
let host=null;
const BRLk=v=>{v=+v||0;return Math.abs(v)>=1e6?(v/1e6).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mi":Math.abs(v)>=1e3?Math.round(v/1e3).toLocaleString("pt-BR")+" mil":Math.round(v).toLocaleString("pt-BR")};
const pct=v=>(v==null||isNaN(v))?"—":Math.round(v*100)+"%";
const parseD=s=>{if(!s)return null;const [y,m,d]=s.slice(0,10).split("-").map(Number);return new Date(y,m-1,d)};
const fmtD=d=>d?d.toLocaleDateString("pt-BR"):"—";
const fmtMes=s=>{const d=parseD(s);return d?d.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}).replace(".",""):""};
const horasFmt=h=>{h=+h||0;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};
const trunc=(s,n)=>(s||"").length>n?s.slice(0,n-1)+"…":(s||"");
const TIPOS={solicitacao_documentos:"Solicitação de documentos",requerimento_bacen:"Requerimento ao Bacen",analise_contrato:"Análise de contrato",parecer_tecnico:"Parecer técnico",contato_banco:"Contato com banco",proposta_acordo:"Proposta de acordo",reuniao_cliente:"Reunião com cliente",ata:"Ata",protocolo:"Protocolo",mudanca_estagio:"Mudança de estágio",acordo_fechado:"Acordo fechado",andamento:"Andamento processual",peticao:"Petição",audiencia:"Audiência",atendimento:"Atendimento",interno:"Interno",outro:"Outro"};
const NUCLEOS={juridico:"Jurídico",acordos:"Acordos",acompanhamento_pj:"Acompanhamento PJ",pos_vendas:"Pós-vendas",comercial:"Comercial",administrativo:"Administrativo",socios:"Sócios"};
const PRODUTOS={giro:"Capital de giro",cheque:"Cheque especial / conta garantida",cartao:"Cartão PJ",antecipacao:"Antecipação de recebíveis",financiamento:"Financiamento / CDC",veiculo:"Veículo / bens",imobiliario:"Imobiliário",rural:"Crédito rural",pronampe:"Pronampe / FGI",outro:"Outro"};

/* tooltip */
let tipEl=null;
function tip(e,html){if(!tipEl){tipEl=el("div",{class:"tip"});document.body.append(tipEl)}tipEl.innerHTML=html;tipEl.hidden=false;tipEl.style.left=Math.min(e.clientX+14,window.innerWidth-290)+"px";tipEl.style.top=(e.clientY+14)+"px"}
function untip(){if(tipEl)tipEl.hidden=true}

/* ---------- gráficos (SVG) ---------- */
/* Barras horizontais: itens [{rotulo, valor, cor?, tip?}] — uma cor por padrão (magnitude); cores por item só quando o item é uma categoria com significado (estágio). */
function hbar(itens,{fmt=BRLk,cor="var(--gold)",fmtTip=BRL,max=null}={}){
  const W=560,rh=26,gap=8,L=150,R=70,H=itens.length*(rh+gap)+4;
  const mx=max??Math.max(1,...itens.map(i=>+i.valor||0));
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"});
  itens.forEach((it,i)=>{const y=i*(rh+gap)+2,w=Math.max(0,(+it.valor||0)/mx*(W-L-R));
    svg.append(sv("text",{x:L-8,y:y+rh/2+4,"text-anchor":"end",class:"lbl"},trunc(it.rotulo,22)));
    svg.append(sv("rect",{x:L,y,width:W-L-R,height:rh,fill:"var(--surface-2)",rx:4}));
    svg.append(sv("rect",{x:L,y,width:w,height:rh,fill:it.cor||cor,rx:4,class:"hit",onmousemove:e=>tip(e,it.tip||`<b>${it.rotulo}</b><br>${fmtTip(it.valor)}`),onmouseleave:untip}));
    svg.append(sv("text",{x:L+w+6,y:y+rh/2+4,class:"val num"},fmt(it.valor)));
  });
  return svg;
}
/* Barras verticais agrupadas por mês: series [{nome,cor,valores:[...]}] e rotulos (meses) */
function vbars(rotulos,series,{fmt=BRLk,fmtTip=BRL}={}){
  const W=600,H=220,L=8,B=28,T=10,n=rotulos.length,gw=(W-L-8)/Math.max(1,n),bw=Math.min(28,(gw-10)/series.length);
  const mx=Math.max(1,...series.flatMap(s=>s.valores.map(v=>+v||0)));
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"});
  for(const f of [0.5,1]){const y=T+(H-T-B)*(1-f);svg.append(sv("line",{x1:L,x2:W-8,y1:y,y2:y,stroke:"var(--line)","stroke-dasharray":"3 3"}))}
  rotulos.forEach((r,i)=>{const x0=L+i*gw+(gw-bw*series.length-2*(series.length-1))/2;
    series.forEach((s,j)=>{const v=+s.valores[i]||0,h=v/mx*(H-T-B),x=x0+j*(bw+2),y=H-B-h;
      svg.append(sv("rect",{x,y,width:bw,height:Math.max(h,v?2:0),fill:s.cor,rx:3,class:"hit",onmousemove:e=>tip(e,`<b>${r}</b><br>${s.nome}: ${fmtTip(v)}`),onmouseleave:untip}));
      if(v&&n<=8)svg.append(sv("text",{x:x+bw/2,y:y-4,"text-anchor":"middle",class:"val num",style:"font-size:11px"},fmt(v)));});
    svg.append(sv("text",{x:L+i*gw+gw/2,y:H-8,"text-anchor":"middle"},r));});
  return svg;
}
const legenda=series=>el("div",{class:"legend"},series.map(s=>el("span",{},el("i",{style:`background:${s.cor}`}),s.nome)));
const chart=(titulo,sub,corpo,...extra)=>el("div",{class:"card chart"},el("h3",{},titulo),sub?el("div",{class:"sub"},sub):null,corpo,...extra);
const kpiG=(l,v,h,cls)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num",style:cls?`color:var(--${cls})`:""},v),el("div",{class:"h"},h||""));
const tabelaG=(cols,linhas,vazio)=>el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},cols.map(c=>el("th",{class:c.r?"r":""},c.t)))),el("tbody",{},linhas.length?linhas.map(l=>el("tr",{},cols.map(c=>el("td",{class:c.r?"r num":""},c.f(l))))):el("tr",{},el("td",{colspan:cols.length,class:"note"},vazio||"Sem dados")))));
const faixaPill=(f,fatal)=>el("span",{class:"pill "+(f==="atrasada"||f==="hoje"?"e3":f==="d7"?(fatal?"e3":"e2"):"g")},{atrasada:"vencido",hoje:"hoje",d7:"7 dias",d15:"15 dias",d30:"30 dias",depois:"depois"}[f]||f,fatal?" · FATAL":"");

/* ---------- dados ---------- */
const D={};
function periodo(){
  const v=V.periodo;const d=new Date();d.setDate(1);
  if(v==="tudo")return null;if(v==="ano"){return `${d.getFullYear()}-01-01`}
  const n={m0:0,m3:2,m6:5,m12:11}[v];d.setMonth(d.getMonth()-n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}
async function carregarDados(){
  const ini=periodo();const mes=(q)=>ini?q.gte("mes",ini):q;
  const qs={
    carteira:SB.from("v_carteira_resumo").select("*").single(),
    estagios:SB.from("v_contratos_por_estagio").select("*"),
    bancos:SB.from("v_contratos_por_banco").select("*").limit(10),
    produtos:SB.from("v_contratos_por_produto").select("*"),
    clientes:SB.from("v_carteira_por_cliente").select("*").order("saldo",{ascending:false}),
    acordosMes:mes(SB.from("v_acordos_mes").select("*")).order("mes"),
    juridico:SB.from("v_juridico_resumo").select("*").single(),
    fases:SB.from("v_processos_por_fase").select("*"),
    tipos:SB.from("v_processos_por_tipo").select("*"),
    prazos:SB.from("v_prazos").select("*").in("faixa",["atrasada","hoje","d7","d15","d30"]).order("prazo"),
    semProv:SB.from("v_processos").select("id,numero_cnj,cliente_nome,tipo_acao,fase,responsavel_nome,dias_sem_andamento,ultimo_andamento").eq("sem_providencia",true).order("dias_sem_andamento",{ascending:false}),
    andMes:mes(SB.from("v_andamentos_mes").select("*")).order("mes"),
    horasColab:mes(SB.from("v_horas_colaborador_mes").select("*")),
    horasTipo:mes(SB.from("v_horas_tipo_mes").select("*")),
    horasCli:mes(SB.from("v_horas_cliente_mes").select("*")),
    tlMes:mes(SB.from("v_timeline_mes").select("*")),
    equipe:SB.from("v_equipe_resumo").select("*").eq("ativo",true).order("nome"),
    semRegistro:SB.from("v_clientes_sem_registro").select("*").order("dias_sem_registro",{ascending:false}),
    pont:SB.from("v_tarefas_pontualidade").select("*"),
  };
  const res=await Promise.all(Object.entries(qs).map(async([k,q])=>{const {data,error}=await q;if(error)console.warn(k,error);return [k,data]}));
  for(const [k,v] of res)D[k]=v;
  D.ini=ini;
}
const soma=(arr,k)=>(arr||[]).reduce((s,x)=>s+(+x[k]||0),0);
const agrupar=(arr,k,v)=>{const m=new Map();for(const x of (arr||[]))m.set(x[k],(m.get(x[k])||0)+(+x[v]||0));return [...m.entries()].sort((a,b)=>b[1]-a[1])};

/* ---------- render ---------- */
function renderConteudo(){
  const perTxt=PERIODOS.find(p=>p[0]===V.periodo)[1].toLowerCase();
  host.querySelector(".sub-periodo").textContent=`Posição de hoje · indicadores de período: ${perTxt}`;
  /* Alertas */
  const al=host.querySelector("#s-alertas");al.replaceChildren(el("h2",{},"Alertas"));
  const semReg=(D.semRegistro||[]).filter(c=>c.alerta);const lim=(D.semRegistro||[])[0]?.limite_dias??15;
  const atras=(D.prazos||[]).filter(p=>p.faixa==="atrasada");const fatais=(D.prazos||[]).filter(p=>p.prazo_fatal&&["hoje","d7"].includes(p.faixa));
  const itens=[];
  if(semReg.length)itens.push(el("div",{class:"alerta"},el("div",{},el("b",{},`${semReg.length} cliente${semReg.length===1?"":"s"} sem registro na timeline há mais de ${lim} dias`),el("div",{class:"note"},semReg.map(c=>`${c.cliente_nome} (${c.dias_sem_registro}d)`).join(" · "))),el("a",{class:"btn",href:"#clientes"},"Abrir painel")));
  if(atras.length)itens.push(el("div",{class:"alerta"},el("div",{},el("b",{},`${atras.length} prazo${atras.length===1?"":"s"} vencido${atras.length===1?"":"s"}`),el("div",{class:"note"},atras.slice(0,5).map(p=>`${p.cliente_nome}: ${trunc(p.descricao,40)} (${fmtD(parseD(p.prazo))})`).join(" · "))),el("a",{class:"btn",href:"#tarefas"},"Ver tarefas")));
  if(fatais.length)itens.push(el("div",{class:"alerta"},el("div",{},el("b",{},`${fatais.length} prazo${fatais.length===1?"":"s"} fata${fatais.length===1?"l":"is"} nos próximos 7 dias`),el("div",{class:"note"},fatais.map(p=>`${p.cliente_nome}: ${trunc(p.descricao,40)} (${fmtD(parseD(p.prazo))})`).join(" · "))),el("a",{class:"btn",href:"#tarefas"},"Ver prazos")));
  if((D.semProv||[]).length)itens.push(el("div",{class:"alerta"},el("div",{},el("b",{},`${D.semProv.length} processo${D.semProv.length===1?"":"s"} sem providência`),el("div",{class:"note"},"ativo, sem andamento em 30 dias e sem tarefa aberta"))));
  al.append(itens.length?el("div",{style:"display:flex;flex-direction:column;gap:8px"},itens):el("div",{class:"alerta ok"},el("b",{},"Nenhum alerta: clientes com registro recente, prazos em dia e processos com providência.")));

  /* Carteira */
  const c=D.carteira||{};const ca=host.querySelector("#s-carteira");ca.replaceChildren(el("h2",{},"Carteira"));
  const acordosP=D.acordosMes||[];const econO=soma(acordosP,"economia_obtida"),econP=soma(acordosP,"economia_projetada"),nAc=soma(acordosP,"acordos");
  ca.append(el("div",{class:"kpis"},
    kpiG("Clientes ativos",String(c.clientes_ativos??"—"),`${c.clientes_com_contrato_ativo??0} com contrato ativo`),
    kpiG("Saldo sob gestão",BRL(c.saldo_sob_gestao),`${c.contratos_ativos??0} contratos ativos`),
    kpiG("Em estágio 3",BRL(c.saldo_estagio3),`${c.contratos_estagio3??0} contratos · inadimplidos >90 dias`,c.contratos_estagio3?"crit":""),
    kpiG("Negociável hoje",BRL(c.saldo_negociavel_hoje),`${c.contratos_negociaveis_hoje??0} contratos com janela aberta`),
    kpiG("Acordos no período",String(nAc),nAc?`${BRL(soma(acordosP,"valor_pago"))} pagos · desconto médio ${pct(acordosP.length?soma(acordosP,"desconto_medio")/acordosP.length:null)}`:"nenhum acordo no período"),
    kpiG("Economia obtida",BRL(econO),nAc?`projetada: ${BRL(econP)} · ${econP?pct(econO/econP):"—"} do previsto`:"",econO>0?"ok":"")));
  const EST={1:["Estágio 1","var(--ok)"],2:["Estágio 2","var(--warn)"],3:["Estágio 3","var(--crit)"]};
  const estItens=[1,2,3].map(e=>{const r=(D.estagios||[]).find(x=>+x.estagio===e)||{contratos:0,saldo:0};return {rotulo:EST[e][0],valor:+r.saldo,cor:EST[e][1],tip:`<b>${EST[e][0]}</b><br>${BRL(r.saldo)} · ${r.contratos} contrato${r.contratos==1?"":"s"} · ${r.clientes||0} cliente${r.clientes==1?"":"s"}`}});
  const meses=acordosP.map(a=>fmtMes(a.mes));
  ca.append(el("div",{class:"row2"},
    chart("Saldo por estágio","Res. CMN 4.966: 1 em dia/≤30d · 2 atraso 31–90d · 3 inadimplido >90d",hbar(estItens),el("div",{class:"note"},`${c.contratos_estagio1??0} · ${c.contratos_estagio2??0} · ${c.contratos_estagio3??0} contratos`)),
    chart("Saldo por banco","contratos ativos, maiores credores",(D.bancos||[]).length?hbar((D.bancos||[]).map(b=>({rotulo:b.banco||"—",valor:+b.saldo,tip:`<b>${b.banco}</b><br>${BRL(b.saldo)} · ${b.contratos} contrato${b.contratos==1?"":"s"} · ${b.em_estagio3} em estágio 3`}))):el("div",{class:"empty"},"Sem contratos ativos")),
    chart("Acordos por mês","economia obtida × projetada pelo motor na data do acordo",acordosP.length?vbars(meses,[{nome:"Economia obtida",cor:"var(--gold)",valores:acordosP.map(a=>a.economia_obtida)},{nome:"Economia projetada",cor:"var(--s1)",valores:acordosP.map(a=>a.economia_projetada)}]):el("div",{class:"empty"},"Nenhum acordo fechado no período"),legenda([{nome:"Economia obtida",cor:"var(--gold)"},{nome:"Economia projetada",cor:"var(--s1)"}])),
    chart("Saldo por produto","contratos ativos",(D.produtos||[]).length?hbar((D.produtos||[]).map(p=>({rotulo:PRODUTOS[p.produto]||p.produto||"—",valor:+p.saldo,tip:`<b>${PRODUTOS[p.produto]||p.produto}</b><br>${BRL(p.saldo)} · ${p.contratos} contrato${p.contratos==1?"":"s"}`}))):el("div",{class:"empty"},"Sem contratos ativos"))));
  ca.append(el("div",{class:"card chart"},el("h3",{},"Por cliente"),tabelaG([
    {t:"Cliente",f:r=>el("span",{},r.cliente_nome,r.ativo?null:el("span",{class:"pill g",style:"margin-left:6px"},"inativo"))},{t:"Contratos",r:1,f:r=>String(r.contratos_ativos)},{t:"Saldo",r:1,f:r=>BRL(r.saldo)},{t:"Estágio 3",r:1,f:r=>BRL(r.saldo_estagio3)},{t:"Negociável",r:1,f:r=>BRL(r.saldo_negociavel)},{t:"Reserva acum.",r:1,f:r=>BRL(r.reserva_acumulada)},{t:"Acordos",r:1,f:r=>String(r.acordos_fechados)},{t:"Processos",r:1,f:r=>String(r.processos_ativos)},{t:"Tarefas",r:1,f:r=>String(r.tarefas_abertas)},{t:"Último registro",f:r=>r.ultimo_registro?fmtD(parseD(r.ultimo_registro)):el("span",{class:"pill e2"},"nunca")}],
    (D.clientes||[]).filter(r=>r.ativo||r.contratos_ativos>0),"Nenhum cliente")));

  /* Jurídico */
  const j=D.juridico||{};const ju=host.querySelector("#s-juridico");ju.replaceChildren(el("h2",{},"Jurídico"));
  const andP=D.andMes||[];
  ju.append(el("div",{class:"kpis"},
    kpiG("Processos ativos",String(j.processos_ativos??0),`${j.processos_suspensos??0} suspensos · ${j.processos_encerrados??0} encerrados`),
    kpiG("Valor em causa",BRL(j.valor_causa_ativo),"processos ativos"),
    kpiG("Prazos vencidos",String(j.prazos_vencidos??0),"processos com próximo prazo no passado",j.prazos_vencidos?"crit":""),
    kpiG("Prazos em 7 dias",String(j.prazos_7d??0),`${j.fatais_7d??0} fatais`,j.fatais_7d?"crit":""),
    kpiG("Sem providência",String(j.sem_providencia??0),"sem andamento em 30d e sem tarefa",j.sem_providencia?"warn":""),
    kpiG("Andamentos no período",String(soma(andP,"andamentos")),`${soma(andP,"visiveis_cliente")} visíveis ao cliente`)));
  ju.append(el("div",{class:"row2"},
    chart("Processos por fase","ativos",(D.fases||[]).length?hbar((D.fases||[]).map(f=>({rotulo:f.fase,valor:+f.processos,tip:`<b>${f.fase}</b><br>${f.processos} processo${f.processos==1?"":"s"} · ${BRL(f.valor_causa)} em causa`})),{fmt:v=>String(v),fmtTip:v=>v+" processos"}):el("div",{class:"empty"},"Nenhum processo ativo")),
    chart("Processos por tipo de ação","ativos · polo do cliente",(D.tipos||[]).length?hbar((D.tipos||[]).map(t=>({rotulo:t.tipo_acao,valor:+t.processos,tip:`<b>${t.tipo_acao}</b><br>${t.processos} · polo ${t.polo||"?"}`})),{fmt:v=>String(v),fmtTip:v=>v+" processos"}):el("div",{class:"empty"},"Nenhum processo ativo"))));
  ju.append(el("div",{class:"card chart"},el("h3",{},"Prazos nos próximos 30 dias"),el("div",{class:"sub"},"tarefas abertas com prazo + próximo prazo de cada processo ativo"),tabelaG([
    {t:"Prazo",f:r=>fmtD(parseD(r.prazo))},{t:"",f:r=>faixaPill(r.faixa,r.prazo_fatal)},{t:"Cliente",f:r=>r.cliente_nome},{t:"O quê",f:r=>r.descricao},{t:"Origem",f:r=>r.origem==="tarefa"?"Tarefa":"Processo"},{t:"Responsável",f:r=>r.responsavel_nome||"—"}],D.prazos||[],"Nenhum prazo nos próximos 30 dias")));
  if((D.semProv||[]).length)ju.append(el("div",{class:"card chart"},el("h3",{},"Processos sem providência"),tabelaG([
    {t:"Processo",f:r=>r.numero_cnj||"(sem nº)"},{t:"Cliente",f:r=>r.cliente_nome},{t:"Ação",f:r=>r.tipo_acao||"—"},{t:"Fase",f:r=>r.fase||"—"},{t:"Responsável",f:r=>r.responsavel_nome||"—"},{t:"Dias sem andamento",r:1,f:r=>String(r.dias_sem_andamento)}],D.semProv)));

  /* Equipe */
  const eq=host.querySelector("#s-equipe");eq.replaceChildren(el("h2",{},"Equipe e produtividade"));
  const hc=agrupar(D.horasColab,"colaborador_nome","horas"),ht=agrupar(D.horasTipo,"tipo_atividade","horas"),hcl=agrupar(D.horasCli,"cliente_nome","horas"),tt=agrupar(D.tlMes,"tipo","entradas");
  const totH=hc.reduce((s,x)=>s+x[1],0),totTl=tt.reduce((s,x)=>s+x[1],0);
  const pont=D.pont||[];const abertas=soma(pont,"abertas"),atrasadas=soma(pont,"atrasadas"),concl=soma(pont,"concluidas"),noPrazo=soma(pont,"concluidas_no_prazo"),comAtraso=soma(pont,"concluidas_com_atraso");
  eq.append(el("div",{class:"kpis"},
    kpiG("Horas no período",horasFmt(totH),`${hc.length} colaborador${hc.length===1?"":"es"} com lançamento`),
    kpiG("Registros na timeline",String(totTl),"no período"),
    kpiG("Tarefas abertas",String(abertas),`${atrasadas} atrasada${atrasadas===1?"":"s"}`,atrasadas?"crit":""),
    kpiG("Concluídas no prazo",noPrazo+comAtraso?pct(noPrazo/(noPrazo+comAtraso)):"—",`${concl} concluídas · ${comAtraso} com atraso`)));
  const hf={fmt:v=>horasFmt(v),fmtTip:v=>horasFmt(v)};
  eq.append(el("div",{class:"row2"},
    chart("Horas por colaborador","no período",hc.length?hbar(hc.map(([n,h])=>({rotulo:n,valor:h})),hf):el("div",{class:"empty"},"Sem horas lançadas no período")),
    chart("Horas por tipo de atividade","no período",ht.length?hbar(ht.map(([n,h])=>({rotulo:TIPOS[n]||n,valor:h})),hf):el("div",{class:"empty"},"Sem horas lançadas no período")),
    chart("Horas por cliente","no período",hcl.length?hbar(hcl.slice(0,10).map(([n,h])=>({rotulo:n||"(interno)",valor:h})),hf):el("div",{class:"empty"},"Sem horas lançadas no período")),
    chart("Atividade registrada por tipo","entradas na timeline no período",tt.length?hbar(tt.map(([n,v])=>({rotulo:TIPOS[n]||n,valor:v})),{fmt:v=>String(v),fmtTip:v=>v+" registros"}):el("div",{class:"empty"},"Sem registros no período"))));
  eq.append(el("div",{class:"card chart"},el("h3",{},"Por colaborador"),el("div",{class:"sub"},"posição de hoje"),tabelaG([
    {t:"Colaborador",f:r=>r.nome},{t:"Núcleo",f:r=>NUCLEOS[r.nucleo]||"—"},{t:"Horas mês atual",r:1,f:r=>horasFmt(r.horas_mes_atual)},{t:"Horas 30d",r:1,f:r=>horasFmt(r.horas_30d)},{t:"Registros 30d",r:1,f:r=>String(r.registros_30d)},{t:"Tarefas abertas",r:1,f:r=>String(r.tarefas_abertas)},{t:"Atrasadas",r:1,f:r=>r.tarefas_atrasadas>0?el("span",{class:"pill e3"},String(r.tarefas_atrasadas)):"0"},{t:"Concluídas no mês",r:1,f:r=>String(r.concluidas_mes)},{t:"Processos",r:1,f:r=>String(r.processos_ativos)}],D.equipe||[],"Nenhum colaborador cadastrado")));
}


async function atualizar(){
  if(V.carregando)return;V.carregando=true;V.erro=null;
  try{await carregarDados();V.ok=true}catch(e){console.warn("visao",e);V.erro=e.message||String(e)}
  finally{V.carregando=false}
  if(S.tab==="visao")render();
}
function renderVisao(){
  const v=$("#view-visao");v.replaceChildren();host=v;
  const sel=el("select",{onchange:e=>{V.periodo=e.target.value;try{localStorage.setItem("pp-visao-periodo",V.periodo)}catch(_){}V.ok=false;atualizar()}},PERIODOS.map(([k,l])=>el("option",{value:k,selected:V.periodo===k?"":null},l)));
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Gestão"),el("h1",{},"Visão geral"),el("div",{class:"sub sub-periodo"},"Posição de hoje")),
    el("div",{class:"actions"},sel,el("button",{class:"btn",onclick:()=>{V.ok=false;atualizar()}},"Atualizar"))));
  if(V.erro){v.append(el("div",{class:"card",style:"padding:18px"},el("b",{},"Não foi possível carregar."),el("div",{class:"note"},V.erro)));return}
  if(!V.ok){if(!V.carregando)atualizar();v.append(el("div",{class:"note"},"Carregando…"));return}
  for(const id of ["s-alertas","s-carteira","s-juridico","s-equipe"])v.append(el("section",{class:"sec",id}));
  renderConteudo();
  v.append(el("div",{class:"note",style:"border-top:1px solid var(--line);padding-top:12px"},"Fonte: views SQL do Supabase (as mesmas que o Power BI / Looker podem ler). Estágios conforme Res. CMN 4.966/2021."));
}
const css=document.createElement("style");css.textContent=`
#view-visao{--s1:var(--ch-a)}
#view-visao .sec{display:flex;flex-direction:column;gap:12px;margin-top:8px}#view-visao .sec>h2{font-size:17px}
#view-visao .row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
#view-visao .chart{padding:16px 18px;display:flex;flex-direction:column;gap:8px;min-width:0}#view-visao .chart h3{font-size:15.5px}#view-visao .chart .sub{font-size:13px;color:var(--muted)}
#view-visao .chart svg{width:100%;height:auto;display:block;overflow:visible}#view-visao .chart text{font-family:var(--body);fill:var(--muted);font-size:12px}#view-visao .chart .lbl{fill:var(--fg);font-weight:600}#view-visao .chart .val{fill:var(--fg)}
#view-visao .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted)}#view-visao .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
#view-visao .hit:hover{opacity:.85}#view-visao .empty{padding:22px;text-align:center;color:var(--muted)}
#view-visao .alerta{border-left:3px solid var(--crit);padding:10px 14px;background:var(--surface);border-radius:var(--r);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}#view-visao .alerta.ok{border-left-color:var(--ok)}
.tip{position:fixed;pointer-events:none;background:var(--navy);color:#fff;font-size:12.5px;padding:7px 10px;border-radius:8px;z-index:40;max-width:280px;line-height:1.35}`;document.head.append(css);
{const _r=render;render=function(){_r();const v=$("#view-visao");if(!v)return;v.hidden=S.tab!=="visao";if(S.tab==="visao")renderVisao()}}
window.PP_VISAO={recarregar:()=>{V.ok=false;atualizar()}};
})();
