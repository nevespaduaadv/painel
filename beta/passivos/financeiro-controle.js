/* Controle financeiro v2 (especificação do setor financeiro, 10/11/2026). Quatro páginas no menu Financeiro:
   Visão geral · Régua de cobrança · Cobranças e retornos · Recuperação. Dados do Asaas (somente leitura) + registros da equipe.
   Supabase (0105): v_regua_cobranca, v_fin_recuperacao, v_fin_remanescentes, v_financeiro_mes, regua_etapas;
   rpcs cobranca_boleto_enviado, cobranca_registrar_mensagem, cobranca_registrar_retorno, cliente_cobranca_excluir, cobranca_criar_tarefa. */
(()=>{
"use strict";
const K={ok:false,carregando:false,regua:[],rec:[],rem:[],mesRow:null,mesCob:[],etapas:[],colab:[],sinc:null,erro:null,mes:null,q:"",fMsg:false,fVenc:false,fTarefa:false,fRet:"todos",sel:null,verTodos:{}};
const TABS=["fin-visao","fin-regua","fin-retornos","fin-recuperacao"];
const ETAPAS=["D-5","D-2","D-0","D+1","D+3","D+7"];
const NOME_ETAPA={"D-5":"Relatório mensal","D-2":"Aviso de vencimento + boleto","D-0":"Lembrete","D+1":"Primeiro contato de cobrança","D+3":"Solicitar previsão de pagamento","D+7":"Contato do supervisor",REMARCADO:"Remarcados",ANTES:"A vencer",REMARCACAO:"Após remarcação"};
const podeFin=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("financeiro");
const R$=v=>(v==null||isNaN(v))?"—":(+v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const hojeISO=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
const fmtD=s=>s?s.slice(8,10)+"/"+s.slice(5,7):"—";
const fmtDT=s=>s?new Date(s).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"—";
const mesLabel=m=>{const [y,mm]=m.split("-");return ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][+mm-1]+" de "+y};
const mesAdd=(m,n)=>{const d=new Date(m+"-01T12:00:00");d.setMonth(d.getMonth()+n);return d.toISOString().slice(0,7)};
const pct=(a,b)=>b?Math.round(a/b*100)+"%":"0%";
const soma=(xs,f)=>xs.reduce((s,x)=>s+(+(f?f(x):x)||0),0);
const vencTxt=r=>r.dias_para>0?`Vence em ${fmtD(r.venc_ef)}`:r.dias_para===0?"Vence hoje":`Venceu há ${r.dias_atraso} dia${r.dias_atraso===1?"":"s"}`;
const ir=(tab)=>{S.tab=tab;try{localStorage.setItem("pp-tab",tab)}catch(_){}render()};
const nomeCli=(id)=>{const r=K.regua.find(x=>x.cliente_id===id);return r?.cliente_nome||id};

async function carregar(){
  if(K.carregando)return;K.carregando=true;K.mes=K.mes||hojeISO().slice(0,7);
  try{const mes=K.mes;const ini=mes+"-01",fim=mesAdd(mes,1)+"-01";
    const [rg,rc,rm,mr,mc,et,co,si]=await Promise.all([SB.from("v_regua_cobranca").select("*").order("venc_ef"),SB.from("v_fin_recuperacao").select("*").eq("mes",mes),SB.from("v_fin_remanescentes").select("*").or(`mes_destino.eq.${mes},mes_origem.eq.${mes}`),
      SB.from("v_financeiro_mes").select("*").eq("mes",mes).maybeSingle(),SB.from("v_cobrancas").select("id,cliente_id,status,valor,valor_pago,vencimento,pago_em").gte("vencimento",ini).lt("vencimento",fim),
      SB.from("regua_etapas").select("*").eq("ativa",true).order("ordem"),SB.from("colaboradores").select("id,nome,nucleo,ativo").order("nome"),SB.from("asaas_sincronizacoes").select("*").order("id",{ascending:false}).limit(1).maybeSingle()]);
    K.erro=rg.error?.message||null;K.regua=rg.data||[];K.rec=rc.data||[];K.rem=rm.data||[];K.mesRow=mr.data||null;K.mesCob=mc.data||[];K.etapas=(et.data||[]).filter(e=>ETAPAS.includes(e.codigo));K.colab=co.data||[];K.sinc=si.data||null;K.ok=true}
  catch(e){console.warn("fin-controle",e);K.erro=String(e.message||e);K.ok=true}
  finally{K.carregando=false}
  render();
}
const garantir=()=>{if(!K.ok&&!K.carregando)carregar();return K.ok};
const invalidar=()=>{K.ok=false;garantir()};
const regua=()=>K.regua.filter(r=>!r.excluida);

/* ---------- cabeçalho comum ---------- */
function head(titulo,sub){
  const mesSel=el("select",{class:"btn sm",onchange:e=>{K.mes=e.target.value;invalidar()}},...[-2,-1,0,1].map(n=>{const m=mesAdd(hojeISO().slice(0,7),n);return el("option",{value:m,selected:m===K.mes?"":null},mesLabel(m))}));
  const sinc=K.sinc?(K.sinc.ok?"Asaas · "+fmtDT(K.sinc.inicio):"Não foi possível atualizar com o Asaas. Dados de "+fmtDT(K.sinc.inicio)):"Asaas · sem sincronização";
  return el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Financeiro"),el("h1",{},titulo),el("div",{class:"sub"},sub)),
    el("div",{class:"actions",style:"align-items:center"},mesSel,el("span",{class:"note",style:K.sinc&&!K.sinc.ok?"color:var(--crit)":""},sinc),el("button",{class:"btn sm",onclick:async()=>{try{toast("Atualizando com o Asaas…");await window.PP_FIN.edge({acao:"asaas_sincronizar"});window.PP_FIN.invalidar?.();invalidar()}catch(e){toast(e.message)}}},"Atualizar agora")));
}
const subnav=(atual)=>el("div",{class:"tabs",style:"margin-bottom:12px"},...[["fin-visao","Visão geral"],["fin-regua","Régua de cobrança"],["fin-retornos","Cobranças e retornos"],["fin-recuperacao","Recuperação"]].map(([t,l])=>el("button",{class:"tab"+(t===atual?" on":""),onclick:()=>ir(t)},l)));
const kpi=(l,v,h,onclick)=>el("div",{class:"card kpi"+(onclick?" clicavel":""),onclick,role:onclick?"button":null,tabindex:onclick?"0":null,onkeydown:onclick?e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onclick()}}:null},el("div",{class:"l"},l),el("div",{class:"v"},v),h?el("div",{class:"h"},h):null);
const pill=(t,cls)=>el("span",{class:"pill "+(cls||"")},t);

/* ---------- ações ---------- */
function registrarMensagem(r){
  const et=sel(Object.fromEntries(ETAPAS.map(e=>[e,e+" · "+NOME_ETAPA[e]])),ETAPAS.includes(r.etapa)?r.etapa:"D+1"),data=inp("date",hojeISO()),meio=sel({whatsapp:"WhatsApp",telefone:"Telefone",email:"E-mail",outro:"Outro"},"whatsapp"),obs=el("textarea",{rows:2,placeholder:"Opcional"});
  modal("Registrar mensagem — "+r.cliente_nome,el("div",{class:"form"},field("rm-et","Etapa",et),field("rm-data","Data",data),field("rm-meio","Meio",meio),el("div",{class:"f full"},el("label",{},"Observação"),obs)),async()=>{
    const {error}=await SB.rpc("cobranca_registrar_mensagem",{p_cobranca:r.id,p_etapa:et.value,p_data:data.value,p_observacao:obs.value.trim()||null,p_meio:meio.value});if(error)throw new Error(error.message);toast("Mensagem registrada");invalidar()});
}
function registrarRetorno(r){
  const tipo=sel({SEM_RETORNO:"Sem retorno",REMARCOU:"Remarcou pagamento"},"REMARCOU"),nova=inp("date",""),obs=el("textarea",{rows:3,placeholder:"Opcional"});const aviso=el("div",{class:"help"});
  const upd=()=>{nova.disabled=tipo.value!=="REMARCOU";aviso.textContent=tipo.value==="REMARCOU"&&nova.value&&nova.value.slice(0,7)>K.mes?"Nova data no mês seguinte: o valor passa para os remanescentes de "+mesLabel(nova.value.slice(0,7)).split(" de ")[0]+".":tipo.value==="REMARCOU"?"Quem remarcou continua contando como vencido até o pagamento ser confirmado no Asaas.":""};
  tipo.onchange=upd;nova.onchange=upd;upd();
  const hist=el("div",{class:"note",style:"margin-top:6px"},"Carregando histórico…");SB.from("cobranca_contatos").select("data,desfecho,retorno,nova_data,observacao").eq("cobranca_id",r.id).order("created_at",{ascending:false}).limit(8).then(({data})=>{hist.replaceChildren(el("b",{},"Histórico"),...(data||[]).map(h=>el("div",{},fmtD(h.data)+" · "+(h.retorno||h.desfecho)+(h.nova_data?" → "+fmtD(h.nova_data):"")+(h.observacao?" · "+h.observacao:""))),!(data||[]).length?el("div",{},"Sem registros."):null)});
  modal("Registrar retorno — "+r.cliente_nome,el("div",{class:"form"},field("rr-tipo","Retorno do cliente",tipo),field("rr-nova","Nova data",nova,"Obrigatória na remarcação."),el("div",{class:"f full"},aviso),el("div",{class:"f full"},el("label",{},"Observação"),obs),el("div",{class:"f full"},hist)),async()=>{
    const {error}=await SB.rpc("cobranca_registrar_retorno",{p_cobranca:r.id,p_tipo:tipo.value,p_nova_data:tipo.value==="REMARCOU"?(nova.value||null):null,p_observacao:obs.value.trim()||null});if(error)throw new Error(error.message);toast(tipo.value==="REMARCOU"?"Remarcação registrada":"Retorno registrado");invalidar()});
}
function marcarBoleto(r,desfazer){
  if(desfazer){SB.rpc("cobranca_boleto_enviado",{p_cobranca:r.id,p_desfazer:true}).then(({error})=>{if(error)toast(error.message);else{toast("Marcação desfeita");invalidar()}});return}
  const canal=sel({chatguru:"Chatguru",whatsapp:"WhatsApp manual",email:"E-mail",outro:"Outro"},"chatguru"),data=inp("datetime-local",new Date(Date.now()-3*3600e3).toISOString().slice(0,16));
  modal("Marcar boleto como enviado — "+r.cliente_nome,el("div",{class:"form"},field("mb-canal","Canal",canal),field("mb-data","Quando",data)),async()=>{const {error}=await SB.rpc("cobranca_boleto_enviado",{p_cobranca:r.id,p_canal:canal.value,p_data:new Date(data.value).toISOString()});if(error)throw new Error(error.message);toast("Boleto marcado como enviado");invalidar()});
}
function criarTarefa(rs,etapa){
  rs=[].concat(rs);const et=K.etapas.find(e=>e.codigo===(etapa||rs[0].etapa));const resp0=et?.executor_padrao_id||(et?.executor_nucleo?K.colab.find(c=>c.ativo!==false&&c.nucleo===et.executor_nucleo)?.id:"")||"";
  const tit=inp("text",rs.length===1?`${etapa||rs[0].etapa} · ${NOME_ETAPA[etapa||rs[0].etapa]||""} · ${rs[0].cliente_nome}`:`${etapa||rs[0].etapa} · ${NOME_ETAPA[etapa||rs[0].etapa]||""} · {cliente}`),resp=sel({"":"—",...Object.fromEntries(K.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},resp0),prazo=inp("date",hojeISO()),desc=el("textarea",{rows:3,placeholder:"Complemento (o resto é preenchido automaticamente: parcela, valor, atraso, fatura, últimos retornos)"});
  modal(rs.length===1?"Criar tarefa":`Criar tarefa para ${rs.length} cliente(s)`,el("div",{class:"form"},field("ct-tit","Título",tit,rs.length>1?"{cliente} vira o nome de cada cliente.":null),field("ct-resp","Responsável",resp),field("ct-prazo","Prazo",prazo),el("div",{class:"f full"},el("label",{},"Descrição"),desc)),async()=>{
    if(!resp.value)throw new Error("Escolha o responsável");let n=0;
    for(const r of rs){const d=`${r.parcela_txt} · ${R$(r.valor)} · ${r.dias_atraso?r.dias_atraso+" dia(s) de atraso":vencTxt(r)}${r.link_fatura?"\nFatura: "+r.link_fatura:""}${r.remarcado_para?"\nRemarcado para "+fmtD(r.remarcado_para)+" ("+r.remarcacoes+"ª remarcação)":""}${desc.value.trim()?"\n\n"+desc.value.trim():""}`;
      const {error}=await SB.rpc("cobranca_criar_tarefa",{p_cobranca:r.id,p_titulo:tit.value.replace("{cliente}",r.cliente_nome),p_responsavel:resp.value,p_prazo:prazo.value||null,p_descricao:d,p_nucleo:"financeiro",p_prioridade:2});if(error)throw new Error("A tarefa não foi criada no sistema de tarefas: "+error.message);n++}
    toast(`${n} tarefa(s) criada(s)`);invalidar();window.PP_TAREFAS?.invalidar?.()});
}
function excluirCliente(r){
  const tipo=sel({execucao:"Decidido para execução (sai da régua)",retirado:"Retirado do Asaas (sai de todas as contagens)"},"execucao"),mot=el("textarea",{rows:3,placeholder:"Motivo (obrigatório)"});
  modal("Excluir da régua — "+r.cliente_nome,el("div",{class:"form"},field("ex-tipo","Marcação",tipo),el("div",{class:"f full"},el("label",{},"Motivo"),mot)),async()=>{if(!r.cliente_id)throw new Error("Cobrança sem cliente vinculado no sistema");const {error}=await SB.rpc("cliente_cobranca_excluir",{p_cliente:r.cliente_id,p_tipo:tipo.value,p_motivo:mot.value.trim()});if(error)throw new Error(error.message);toast("Cliente marcado");invalidar()});
}
function menuCartao(r){
  const b=el("button",{class:"btn sm","aria-label":"Mais ações","aria-haspopup":"menu"},"···");
  b.onclick=e=>{e.stopPropagation();document.querySelectorAll(".fc-menu").forEach(m=>m.remove());const m=el("div",{class:"fc-menu",role:"menu"},
    r.link_fatura?el("a",{class:"fc-mi",href:r.link_fatura,target:"_blank",rel:"noopener",role:"menuitem"},"Ver fatura"):null,
    el("button",{class:"fc-mi",role:"menuitem",onclick:()=>registrarMensagem(r)},"Registrar mensagem"),
    el("button",{class:"fc-mi",role:"menuitem",onclick:()=>registrarRetorno(r)},"Registrar retorno"),
    el("button",{class:"fc-mi",role:"menuitem",onclick:()=>criarTarefa(r)},"Criar tarefa"),
    r.etapa==="D-2"||r.etapa==="D-0"?el("button",{class:"fc-mi",role:"menuitem",onclick:()=>marcarBoleto(r,r.boleto_enviado)},r.boleto_enviado?"Desfazer “boleto enviado”":"Marcar boleto como enviado"):null,
    r.cliente_id?el("button",{class:"fc-mi",role:"menuitem",onclick:()=>{S.sel=r.cliente_id;S.tab="clientes";S.sub="negocial";render()}},"Ver histórico do cliente"):null,
    r.cliente_id?el("button",{class:"fc-mi",role:"menuitem",onclick:()=>excluirCliente(r)},"Excluir da régua…"):null);
    document.body.append(m);const rc=b.getBoundingClientRect();m.style.top=(rc.bottom+4+window.scrollY)+"px";m.style.left=Math.min(rc.left,window.innerWidth-240)+"px";const fechar=ev=>{if(!m.contains(ev.target)){m.remove();document.removeEventListener("click",fechar)}};setTimeout(()=>document.addEventListener("click",fechar),0);m.querySelectorAll(".fc-mi").forEach(x=>x.addEventListener("click",()=>m.remove()))};
  return b;
}
const etiquetaTarefa=r=>{const ts=r.tarefas||[];if(!ts.length)return null;const ab=ts.find(t=>t.status==="aberta"||t.status==="em_andamento");const t=ab||ts[ts.length-1];const atras=ab&&ab.prazo&&ab.prazo<hojeISO();
  return el("button",{class:"pill "+(ab?(atras?"e3":"b"):"g"),style:"cursor:pointer;border:0",title:t.titulo,onclick:e=>{e.stopPropagation();window.PP_TAREFAS?.abrir(t.id)}},ab?(atras?"Tarefa atrasada · ":"Tarefa em aberto · ")+(t.responsavel||"—"):"Tarefa concluída")};

/* ---------- 1) Visão geral ---------- */
function renderVisao(v){
  v.append(head("Visão geral","Resumo do mês e pendências do dia."),subnav("fin-visao"));if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const rs=regua();const mesCob=K.mesCob;const excl=new Set(K.regua.filter(r=>r.excluida).map(r=>r.cliente_id));
  const mc=mesCob.filter(c=>!excl.has(c.cliente_id));
  const previsto=soma(mc,c=>c.valor),recebido=soma(mc.filter(c=>c.status==="paga"),c=>c.valor_pago||c.valor),aguard=mc.filter(c=>c.status==="pendente"),venc=mc.filter(c=>c.status==="atrasada");
  const recup=K.rec.filter(r=>r.situacao!=="aberto"),remDest=K.rem.filter(r=>r.mes_destino===K.mes);
  v.append(el("div",{class:"kpis",style:"grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"},
    kpi("Faturamento previsto do mês",R$(previsto),`${mc.length} cobrança(s) no Asaas`,()=>ir("fin-regua")),
    kpi("Recebido",R$(recebido),pct(recebido,previsto)+" do previsto",()=>{S.finSub="asaas";ir("financeiro")}),
    kpi("Aguardando pagamento",R$(soma(aguard,c=>c.valor)),`${new Set(aguard.map(c=>c.cliente_id)).size} cliente(s)`,()=>ir("fin-regua")),
    kpi("Vencido",R$(soma(venc,c=>c.valor)),`${new Set(venc.map(c=>c.cliente_id)).size} cliente(s) · inclui remarcados`,()=>{K.fRet="todos";ir("fin-retornos")}),
    kpi("Recuperado após cobrança",R$(soma(recup,r=>r.valor_pago||r.valor)),`${recup.length} cliente(s)`,()=>ir("fin-recuperacao")),
    kpi("Remanescente do mês anterior",R$(soma(remDest,r=>r.valor)),`recebido ${R$(soma(remDest.filter(r=>r.situacao==="pago"),r=>r.valor_pago||r.valor))} · a receber ${R$(soma(remDest.filter(r=>r.situacao!=="pago"),r=>r.valor))}`,()=>ir("fin-recuperacao"))));
  // clientes por etapa + pendências
  const porEtapa=[...ETAPAS,"REMARCADO"].map(e=>[e,rs.filter(r=>r.etapa===e)]);const max=Math.max(1,...porEtapa.map(([,x])=>x.length));
  const barras=el("section",{class:"card section"},el("h2",{},"Clientes por etapa da régua"),el("div",{class:"fc-bars"},...porEtapa.map(([e,x])=>el("button",{class:"fc-bar",onclick:()=>{K.destaque=e;ir("fin-regua")},title:`${x.length} cliente(s) · ${R$(soma(x,r=>r.valor))}`},el("span",{class:"fc-bar-l"},e==="REMARCADO"?"Remarcados":e),el("span",{class:"fc-bar-t"},el("span",{class:"fc-bar-f",style:`width:${Math.round(x.length/max*100)}%`})),el("span",{class:"fc-bar-n"},String(x.length))))));
  const hoje=hojeISO();const pend=[];
  const semBoleto=rs.filter(r=>(r.etapa==="D-2"||r.etapa==="D-0")&&!r.boleto_enviado);if(semBoleto.length)pend.push([`${semBoleto.length} boleto(s) não enviado(s) (D-2 / D-0)`,()=>{K.destaque="D-2";ir("fin-regua")}]);
  const semMsg=rs.filter(r=>ETAPAS.includes(r.etapa)&&!r.mensagem_enviada);if(semMsg.length)pend.push([`${semMsg.length} cliente(s) ainda sem a mensagem da etapa`,()=>{K.fMsg=true;ir("fin-regua")}]);
  const remHoje=rs.filter(r=>r.remarcado_para===hoje);if(remHoje.length)pend.push([`${remHoje.length} remarcação(ões) com nova data hoje`,()=>{K.fRet="REMARCOU";ir("fin-retornos")}]);
  const d7=new Date(hoje+"T12:00:00");d7.setDate(d7.getDate()+7);const remSem=remDest.filter(r=>r.situacao==="aguardando"&&r.nova_data<=d7.toISOString().slice(0,10));if(remSem.length)pend.push([`${remSem.length} remanescente(s) vence(m) nesta semana`,()=>ir("fin-recuperacao")]);
  const tAtras=rs.filter(r=>(r.tarefas||[]).some(t=>(t.status==="aberta"||t.status==="em_andamento")&&t.prazo&&t.prazo<hoje));if(tAtras.length)pend.push([`${tAtras.length} tarefa(s) da régua com prazo vencido`,()=>{K.fTarefa=true;ir("fin-regua")}]);
  const pendC=el("section",{class:"card section"},el("h2",{},"Pendências de hoje"),pend.length?el("ul",{class:"fc-pend"},...pend.map(([t,f])=>el("li",{},el("button",{class:"fc-link",onclick:f},t)))):el("div",{class:"empty"},"Nenhuma pendência hoje."));
  v.append(el("div",{style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px"},barras,pendC));
}

/* ---------- 2) Régua ---------- */
function cartao(r){
  const c=el("div",{class:"fc-card"+(r.venceu_de_novo?" fc-redo":"")},el("div",{class:"fc-top"},el("b",{},r.cliente_nome),menuCartao(r)),
    el("div",{class:"note"},`${r.parcela_txt} · ${R$(r.valor)}`),el("div",{class:"note"},r.etapa==="REMARCADO"?`Nova data ${fmtD(r.remarcado_para)} · ${r.remarcacoes}ª remarcação`:vencTxt(r)),
    el("div",{class:"fc-tags"},
      ETAPAS.includes(r.etapa)?pill(r.mensagem_enviada?"Mensagem enviada":"Mensagem pendente",r.mensagem_enviada?"g":"e2"):null,
      r.etapa==="D-2"?pill(r.boleto_enviado?"Boleto enviado":"Boleto não enviado",r.boleto_enviado?"g":"e2"):null,
      r.etapa==="D-0"&&!r.boleto_enviado?pill("Boleto não enviado","e3"):null,
      r.venceu_de_novo?pill("Venceu de novo","e3"):null,r.inadimplente_anterior&&r.etapa==="D-2"?pill("Cliente com parcela vencida","e3"):null,r.sem_contato?pill("Sem telefone — corrigir contato","e2"):null,
      etiquetaTarefa(r)));
  return c;
}
function renderRegua(v){
  v.append(head("Régua de cobrança","Onde cada cliente está, envio do boleto no D-2, mensagens e tarefas por etapa. O cliente muda de etapa sozinho, pela data."),subnav("fin-regua"));if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const q=inp("search",K.q,{placeholder:"Buscar cliente…"});q.oninput=()=>{K.q=q.value;render()};
  const tg=(k,l)=>el("button",{class:"btn sm"+(K[k]?" primary":""),"aria-pressed":K[k]?"true":"false",onclick:()=>{K[k]=!K[k];render()}},l);
  v.append(el("div",{class:"card",style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px;margin-bottom:12px"},q,tg("fMsg","Só com mensagem pendente"),tg("fVenc","Só vencidos"),tg("fTarefa","Só com tarefa aberta"),el("span",{class:"note",style:"margin-left:auto"},"Envio em massa pelo Chatguru: ",el("button",{class:"fc-link",onclick:()=>{S.finSub="central";try{localStorage.setItem("pp-fin-sub","central")}catch(_){}ir("financeiro")}},"Central de disparos"))));
  const ql=K.q.trim().toLowerCase();const rs=regua().filter(r=>(!ql||(r.cliente_nome||"").toLowerCase().includes(ql))&&(!K.fMsg||(ETAPAS.includes(r.etapa)&&!r.mensagem_enviada))&&(!K.fVenc||r.dias_atraso>0)&&(!K.fTarefa||r.tarefas_abertas>0));
  const cols=[...ETAPAS,"REMARCADO"].map(e=>[e,rs.filter(r=>r.etapa===e)]);
  const board=el("div",{class:"fc-board"},...cols.map(([e,x])=>{const et=K.etapas.find(k=>k.codigo===e);const rem=e==="REMARCADO";const ver=K.verTodos[e];const lista=ver?x:x.slice(0,8);
    let sub=null;if(e==="D-2"){const f=K.fD2||"todos";const fx=f==="env"?x.filter(r=>r.boleto_enviado):f==="nao"?x.filter(r=>!r.boleto_enviado):f==="semc"?x.filter(r=>r.sem_contato):x;sub=el("div",{class:"fc-sub"},...[["todos","Todos"],["env","Enviados"],["nao","Não enviados"],["semc","Não encontrados"]].map(([k,l])=>el("button",{class:"fc-chip"+(f===k?" on":""),onclick:()=>{K.fD2=k;render()}},l)));x=fx}
    const col=el("div",{class:"fc-col"+(K.destaque===e?" fc-dest":""),id:"fc-col-"+e.replace("+","mais")},el("div",{class:"fc-col-h"},el("div",{},el("b",{},rem?"Remarcados":e),el("div",{class:"note"},rem?"Aguardando a nova data":NOME_ETAPA[e]),el("div",{class:"note"},`${x.length} cliente(s) · ${R$(soma(x,r=>r.valor))}`)),
      el("div",{style:"display:flex;gap:4px;flex-direction:column"},!rem&&x.length?el("button",{class:"btn sm",onclick:()=>criarTarefa(x,e)},"Criar tarefa para esta etapa"):null,!rem&&x.some(r=>!r.mensagem_enviada)?el("button",{class:"btn sm",title:"Abre a Central de disparos na etapa",onclick:()=>{S.finSub="central";try{localStorage.setItem("pp-fin-sub","central")}catch(_){}ir("financeiro")}},"Enviar mensagem para todos os pendentes"):null)),sub,
      x.length?el("div",{class:"fc-cards"},...(ver?x:x.slice(0,8)).map(cartao),x.length>8&&!ver?el("button",{class:"fc-link",onclick:()=>{K.verTodos[e]=true;render()}},`Ver todos (${x.length})`):null):el("div",{class:"empty"},"Nenhum cliente nesta etapa hoje."));
    return col}));
  v.append(board);if(K.destaque){const d=K.destaque;K.destaque=null;setTimeout(()=>document.getElementById("fc-col-"+d.replace("+","mais"))?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}),50)}
}

/* ---------- 3) Cobranças e retornos ---------- */
function proximoPasso(r){
  if(r.remarcado_para&&r.remarcado_para>=hojeISO())return r.remarcado_para.slice(0,7)>K.mes?"Passa para os remanescentes de "+mesLabel(r.remarcado_para.slice(0,7)).split(" de ")[0]:"Conferir em "+fmtD(r.remarcado_para);
  if(r.venceu_de_novo)return"Venceu de novo — novo contato";
  if(!r.mensagem_enviada)return"Enviar mensagem";
  if(r.etapa==="D+1")return"Aguardar D+3";if(r.etapa==="D+3")return"Aguardar D+7";if(r.etapa==="D+7")return r.tarefas_abertas?"Supervisor em contato":"Criar tarefa para o supervisor";return"—";
}
function renderRetornos(v){
  v.append(head("Cobranças e retornos","Registro das mensagens de cobrança e dos retornos dos clientes vencidos."),subnav("fin-retornos"));if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const venc=regua().filter(r=>r.dias_atraso>0||r.etapa==="REMARCADO");const comMsg=venc.filter(r=>r.cobranca_msg_em),semMsg=venc.filter(r=>!r.cobranca_msg_em),rem=venc.filter(r=>r.remarcado_para),resp=rem;
  v.append(el("div",{class:"kpis",style:"grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"},kpi("Clientes vencidos",`${new Set(venc.map(r=>r.chave_cliente)).size}`,R$(soma(venc,r=>r.valor))),kpi("Já receberam cobrança",String(comMsg.length),`${semMsg.length} ainda sem mensagem`),kpi("Responderam",String(resp.length),`${comMsg.length-resp.length>0?comMsg.length-resp.length:0} sem retorno`),kpi("Remarcações",`${rem.filter(r=>r.remarcado_para.slice(0,7)<=K.mes).length} no mês`,`${rem.filter(r=>r.remarcado_para.slice(0,7)>K.mes).length} para o mês seguinte`)));
  const q=inp("search",K.q,{placeholder:"Buscar cliente…"});q.oninput=()=>{K.q=q.value;render()};
  const F=[["todos","Todos"],["semmsg","Mensagem não enviada"],["semret","Sem retorno"],["REMARCOU","Remarcou pagamento"],["redo","Venceu de novo"]];
  v.append(el("div",{class:"card",style:"display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 14px;margin-bottom:12px"},...F.map(([k,l])=>el("button",{class:"fc-chip"+(K.fRet===k?" on":""),onclick:()=>{K.fRet=k;render()}},l)),q,btnExportar("cobrancas-retornos",()=>linhas,[{k:"cliente_nome",t:"Cliente"},{k:"valor",t:"Valor vencido"},{k:"dias_atraso",t:"Dias de atraso"},{k:"etapa",t:"Etapa"},{k:"cobranca_msg_em",t:"Mensagem de cobrança",f:v=>v?"Enviada em "+fmtD(v):"Não enviada"},{k:"remarcado_para",t:"Retorno",f:(v,l)=>v?"Remarcou pagamento":l.cobranca_msg_em?"Sem retorno":""},{k:"remarcado_para",t:"Nova data",f:v=>v?fmtD(v):""}])));
  const ql=K.q.trim().toLowerCase();
  const linhas=venc.filter(r=>(!ql||(r.cliente_nome||"").toLowerCase().includes(ql))&&(K.fRet==="todos"||(K.fRet==="semmsg"&&!r.cobranca_msg_em)||(K.fRet==="semret"&&r.cobranca_msg_em&&!r.remarcado_para)||(K.fRet==="REMARCOU"&&r.remarcado_para&&!r.venceu_de_novo)||(K.fRet==="redo"&&r.venceu_de_novo)));
  v.append(el("section",{class:"card section"},linhas.length?el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Cliente"),el("th",{class:"num"},"Valor vencido"),el("th",{},"Atraso"),el("th",{},"Etapa"),el("th",{},"Mensagem de cobrança"),el("th",{},"Enviada em"),el("th",{},"Retorno do cliente"),el("th",{},"Nova data"),el("th",{},"Tarefa"),el("th",{},"Próximo passo"),el("th",{}))),
    el("tbody",{},...linhas.map(r=>el("tr",{},el("td",{},el("b",{},r.cliente_nome),el("div",{class:"note"},r.parcela_txt)),el("td",{class:"num"},R$(r.valor)),el("td",{},r.dias_atraso?`${r.dias_atraso} dia${r.dias_atraso===1?"":"s"}`:"—"),el("td",{},r.etapa==="REMARCADO"?"Remarcado":r.etapa),
      el("td",{},pill(r.cobranca_msg_em?"Enviada":"Não enviada",r.cobranca_msg_em?"g":"e2")),el("td",{},r.cobranca_msg_em?fmtD(r.cobranca_msg_em):"—"),el("td",{},r.remarcado_para?(r.venceu_de_novo?pill("Venceu de novo","e3"):pill("Remarcou pagamento","e2")):r.cobranca_msg_em?"Sem retorno":"—"),el("td",{},r.remarcado_para?fmtD(r.remarcado_para)+(r.remarcacoes>1?` (${r.remarcacoes}ª)`:""):"—"),el("td",{},etiquetaTarefa(r)||"—"),el("td",{class:"note"},proximoPasso(r)),
      el("td",{class:"r"},el("div",{style:"display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap"},el("button",{class:"btn sm",onclick:()=>registrarMensagem(r)},"Registrar mensagem"),el("button",{class:"btn sm",onclick:()=>registrarRetorno(r)},"Registrar retorno"),el("button",{class:"btn sm",onclick:()=>criarTarefa(r)},"Criar tarefa")))))))):el("div",{class:"empty"},"Nenhum cliente vencido neste filtro.")));
}

/* ---------- 4) Recuperação ---------- */
function segBar(partes,sel,onSel){ // partes: [{k,label,valor,n,cls}]
  const tot=soma(partes,p=>p.valor)||1;
  return el("div",{class:"fc-seg",role:"listbox","aria-label":"Partes do gráfico",tabindex:"0",onkeydown:e=>{const ks=partes.map(p=>p.k);let i=ks.indexOf(sel);if(e.key==="ArrowRight"){i=Math.min(ks.length-1,i+1);onSel(ks[i])}if(e.key==="ArrowLeft"){i=Math.max(0,i-1);onSel(ks[i])}if(e.key==="Enter"&&sel)onSel(sel)}},
    ...partes.map(p=>el("button",{class:"fc-seg-p "+p.cls+(sel&&sel!==p.k?" dim":"")+(sel===p.k?" on":""),style:`flex:${Math.max(p.valor/tot,0.04)}`,role:"option","aria-selected":sel===p.k?"true":"false",title:`${p.label}: ${R$(p.valor)}${p.n!=null?" · "+p.n+" cliente(s)":""}`,onclick:()=>onSel(p.k)},el("span",{class:"fc-seg-l"},p.label),el("span",{class:"fc-seg-v"},R$(p.valor)+(p.n!=null?` · ${p.n}`:"")+` · ${pct(p.valor,tot)}`))));
}
function renderRecuperacao(v){
  v.append(head("Recuperação","Valores recuperados após cobrança e remanescentes do mês anterior. Clique em uma parte do gráfico para ver os clientes."),subnav("fin-recuperacao"));if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const rec=K.rec;const cobrado=soma(rec,r=>r.valor),recup=soma(rec.filter(r=>r.situacao==="recuperado"),r=>r.valor_pago||r.valor),parcial=soma(rec.filter(r=>r.situacao==="parcial"),r=>r.valor_pago||0),aberto=cobrado-recup-parcial;
  const porEt=["D+1","D+3","D+7","REMARCACAO"].map(e=>[e,rec.filter(r=>r.pago_etapa===e&&r.situacao!=="aberto")]);const maxEt=Math.max(1,...porEt.map(([,x])=>soma(x,r=>r.valor_pago||r.valor)));
  const rem=K.rem.filter(r=>r.mes_destino===K.mes);const remT=soma(rem,r=>r.valor),remP=rem.filter(r=>r.situacao==="pago"),remA=rem.filter(r=>r.situacao==="aguardando"),remV=rem.filter(r=>r.situacao==="venceu_de_novo");
  const selA=K.sel?.startsWith("A:")?K.sel.slice(2):null,selB=K.sel?.startsWith("B:")?K.sel.slice(2):null;const setSel=k=>{K.sel=K.sel===k?null:k;render()};
  const A=el("section",{class:"card section"},el("h2",{},"A · Valores recuperados"),el("div",{class:"kpis",style:"grid-template-columns:repeat(3,1fr)"},kpi("Valor cobrado",R$(cobrado),`${rec.length} cobrança(s) com mensagem`,()=>setSel("A:todos")),kpi("Valor recuperado",R$(recup+parcial),null,()=>setSel("A:recuperado")),kpi("Taxa de recuperação",pct(recup+parcial,cobrado))),
    el("div",{class:"note",style:"margin:10px 0 4px"},"Cobrado"),segBar([{k:"recuperado",label:"Recuperado",valor:recup,n:rec.filter(r=>r.situacao==="recuperado").length,cls:"ok"},{k:"parcial",label:"Recuperado em parte",valor:parcial,n:rec.filter(r=>r.situacao==="parcial").length,cls:"warn"},{k:"aberto",label:"Ainda em aberto",valor:Math.max(aberto,0),n:rec.filter(r=>r.situacao==="aberto").length,cls:"crit"}],selA,k=>setSel("A:"+k)),
    el("div",{class:"note",style:"margin:14px 0 4px"},"Recuperado por etapa em que o cliente pagou"),el("div",{class:"fc-vbars"},...porEt.map(([e,x])=>{const val=soma(x,r=>r.valor_pago||r.valor);return el("button",{class:"fc-vbar"+(selA==="et:"+e?" on":"")+(selA&&selA!=="et:"+e&&selA.startsWith("et:")?" dim":""),onclick:()=>setSel("A:et:"+e),title:`${NOME_ETAPA[e]||e}: ${R$(val)} · ${x.length}`},el("span",{class:"fc-vbar-v"},R$(val)),el("span",{class:"fc-vbar-f",style:`height:${Math.round(val/maxEt*100)}%`}),el("span",{class:"fc-vbar-l"},e==="REMARCACAO"?"Após remarcação":e))})));
  const B=el("section",{class:"card section"},el("h2",{},"B · Remanescentes do mês anterior"),el("div",{class:"kpis",style:"grid-template-columns:repeat(3,1fr)"},kpi("Remarcado para este mês",R$(remT),`${rem.length} cliente(s)`,()=>setSel("B:todos")),kpi("Já recebido",R$(soma(remP,r=>r.valor_pago||r.valor)),`${remP.length} cliente(s)`,()=>setSel("B:pago")),kpi("Ainda a receber",R$(soma([...remA,...remV],r=>r.valor)),`${remA.length} aguardando · ${remV.length} venceu de novo`,()=>setSel("B:aguardando"))),
    el("div",{class:"note",style:"margin:10px 0 4px"},`Remarcado de ${mesLabel(mesAdd(K.mes,-1)).split(" de ")[0]} para ${mesLabel(K.mes).split(" de ")[0]}`),rem.length?segBar([{k:"pago",label:"Pago",valor:soma(remP,r=>r.valor),n:remP.length,cls:"ok"},{k:"aguardando",label:"Aguardando",valor:soma(remA,r=>r.valor),n:remA.length,cls:"warn"},{k:"venceu_de_novo",label:"Venceu de novo",valor:soma(remV,r=>r.valor),n:remV.length,cls:"crit"}],selB,k=>setSel("B:"+k)):el("div",{class:"empty"},"Nenhum remanescente do mês anterior."));
  v.append(el("div",{style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px"},A,B));
  // detalhamento
  if(K.sel){let titulo="",linhas=[],tipo="A";
    if(selA!=null){const f=selA==="todos"?()=>true:selA==="recuperado"?r=>r.situacao!=="aberto":selA.startsWith("et:")?r=>r.pago_etapa===selA.slice(3)&&r.situacao!=="aberto":r=>r.situacao===selA;linhas=rec.filter(f);titulo=(selA==="todos"?"Cobrado":selA==="recuperado"?"Recuperado":selA.startsWith("et:")?"Recuperado no "+(selA.slice(3)==="REMARCACAO"?"pós-remarcação":selA.slice(3)):{parcial:"Recuperado em parte",aberto:"Ainda em aberto"}[selA])+` · ${linhas.length} cliente(s) · ${R$(soma(linhas,r=>r.situacao==="aberto"?r.valor:(r.valor_pago||r.valor)))}`}
    else{tipo="B";linhas=rem.filter(r=>selB==="todos"||r.situacao===selB);titulo=({todos:"Remanescentes",pago:"Pago",aguardando:"Aguardando",venceu_de_novo:"Venceu de novo"})[selB]+` · ${linhas.length} cliente(s) · ${R$(soma(linhas,r=>r.valor))}`}
    const SIT={recuperado:"Recuperado",parcial:"Recuperado em parte",aberto:"Em aberto",pago:"Pago",aguardando:"Aguardando",venceu_de_novo:"Venceu de novo"};
    const colsA=[{k:"cliente_nome",t:"Cliente"},{k:"valor",t:"Valor cobrado"},{k:"cobranca_msg_em",t:"Cobrado em",f:fmtD},{k:"pago_etapa",t:"Etapa em que pagou",f:v=>v?(NOME_ETAPA[v]&&v==="REMARCACAO"?"Após remarcação":v):""},{k:"pago_em",t:"Pago em",f:fmtD},{k:"valor_pago",t:"Valor recuperado"},{k:"situacao",t:"Situação",f:v=>SIT[v]||v}];
    const colsB=[{k:"cliente_nome",t:"Cliente"},{k:"mes_origem",t:"Mês de origem"},{k:"valor",t:"Valor"},{k:"vencimento_original",t:"Vencimento original",f:fmtD},{k:"nova_data",t:"Nova data",f:fmtD},{k:"situacao",t:"Situação",f:v=>SIT[v]||v},{k:"situacao",t:"Voltou para a régua?",f:v=>v==="venceu_de_novo"?"Sim":"Não"}];
    const cols=tipo==="A"?colsA:colsB;
    v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Seleção: "+titulo),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>{K.sel=null;render()}},"Limpar seleção"),btnExportar("recuperacao",()=>linhas,cols))),
      linhas.length?el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},...cols.map(c=>el("th",{},c.t)),tipo==="B"?el("th",{},"Ação"):null)),el("tbody",{},...linhas.map(l=>el("tr",{},...cols.map(c=>el("td",{},(()=>{const x=c.f?c.f(l[c.k],l):l[c.k];return /valor/i.test(c.k)?R$(x):(x??"—")})())),tipo==="B"?el("td",{},l.status!=="paga"?el("button",{class:"btn sm",onclick:()=>{const r=K.regua.find(x=>x.id===l.id);if(r)registrarRetorno(r);else toast("Cobrança não está mais aberta")}},"Registrar retorno"):"—"):null))))):el("div",{class:"empty"},"Nenhum cliente nesta seleção.")));
  }
}

/* ---------- integração com o shell ---------- */
{const _r=render;render=function(){_r();for(const t of TABS){const v=$("#view-"+t);if(!v)continue;if(!podeFin()&&S.tab===t)S.tab="clientes";v.hidden=S.tab!==t;if(S.tab===t){v.replaceChildren();if(K.erro&&/v_regua_cobranca|v_fin_/.test(K.erro))v.append(el("div",{class:"card",style:"padding:10px 14px;border-left:3px solid var(--warn);margin-bottom:10px"},"Rode a migração 0105 para ativar o controle financeiro."));({"fin-visao":renderVisao,"fin-regua":renderRegua,"fin-retornos":renderRetornos,"fin-recuperacao":renderRecuperacao})[t](v)}}}}
const css=document.createElement("style");css.textContent=`
.kpi.clicavel{cursor:pointer}.kpi.clicavel:hover{border-color:var(--gold)}
.fc-bars{display:flex;flex-direction:column;gap:6px;margin-top:8px}.fc-bar{display:grid;grid-template-columns:90px 1fr 36px;gap:10px;align-items:center;background:none;border:0;padding:4px 0;text-align:left;font:inherit;color:inherit;cursor:pointer}.fc-bar:hover .fc-bar-f{background:var(--ch-b)}
.fc-bar-l{font-size:13px;font-weight:600}.fc-bar-t{height:14px;background:var(--surface-2);border-radius:7px;overflow:hidden}.fc-bar-f{display:block;height:100%;background:var(--ch-a);border-radius:7px;min-width:2px}.fc-bar-n{text-align:right;font-variant-numeric:tabular-nums;font-size:13px}
.fc-pend{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px}.fc-link{background:none;border:0;padding:0;color:var(--info);cursor:pointer;font:inherit;text-decoration:underline;text-underline-offset:2px}
.fc-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(250px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px;align-items:start}
.fc-col{background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:10px;min-height:120px}.fc-col.fc-dest{outline:2px solid var(--gold)}.fc-col-h{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px}
.fc-sub{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}.fc-chip{border:1px solid var(--line);background:var(--surface);border-radius:100px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--fg)}.fc-chip.on{background:var(--navy);color:var(--on-dark);border-color:var(--navy)}
.fc-cards{display:flex;flex-direction:column;gap:8px}.fc-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px}.fc-card.fc-redo{border-color:var(--crit)}.fc-top{display:flex;justify-content:space-between;gap:8px;align-items:center}.fc-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.fc-menu{position:absolute;z-index:60;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-pop);min-width:220px;padding:4px;display:flex;flex-direction:column}.fc-mi{display:block;width:100%;text-align:left;background:none;border:0;padding:9px 12px;font:inherit;color:var(--fg);cursor:pointer;border-radius:6px;text-decoration:none}.fc-mi:hover,.fc-mi:focus-visible{background:var(--surface-2)}
.fc-seg{display:flex;gap:3px;height:52px;border-radius:8px;overflow:hidden}.fc-seg-p{border:0;cursor:pointer;display:flex;flex-direction:column;justify-content:center;padding:4px 8px;color:var(--on-dark);font:inherit;text-align:left;min-width:0;transition:opacity .18s}.fc-seg-p.ok{background:var(--ok)}.fc-seg-p.warn{background:var(--warn)}.fc-seg-p.crit{background:var(--crit)}.fc-seg-p.dim{opacity:.35}.fc-seg-p.on{outline:3px solid var(--gold);outline-offset:-3px}.fc-seg-l{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fc-seg-v{font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fc-vbars{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;height:150px;align-items:end;margin-top:4px}.fc-vbar{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;background:none;border:0;cursor:pointer;font:inherit;color:inherit;gap:4px}.fc-vbar-f{width:60%;background:var(--ch-a);border-radius:6px 6px 0 0;min-height:3px}.fc-vbar.on .fc-vbar-f{background:var(--gold)}.fc-vbar.dim{opacity:.4}.fc-vbar-v{font-size:11.5px;color:var(--muted)}.fc-vbar-l{font-size:12px;font-weight:600}
@media (max-width:700px){.fc-board{grid-auto-columns:85vw}.fc-vbars{height:120px}}`;document.head.append(css);
window.PP_FIN_CONTROLE={invalidar};
window.__PP_LOGIN?.then(()=>{if(podeFin()){const ch=SB.channel("fin-controle");let t;const re=()=>{clearTimeout(t);t=setTimeout(()=>{if(TABS.includes(S.tab))invalidar()},1500)};ch.on("postgres_changes",{event:"*",schema:"public",table:"cobrancas"},re).on("postgres_changes",{event:"*",schema:"public",table:"cobranca_contatos"},re).subscribe()}});
})();
