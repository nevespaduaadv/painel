/* Fluxo do cliente PJ, negociações (kanban de acordos) e monitoramento processual — espelho da operação do Notion.
   Supabase: clientes.etapa_fluxo/flags (0010), negociacoes, monitoramentos, v_negociacoes, v_monitoramentos.
   Carregado depois de ficha.js. Tudo aqui é só da equipe: o cliente nunca vê negociação nem monitoramento. */
(()=>{
"use strict";
const ETAPAS=["Contrato fechado / entrada paga","Cadastro no ADVBOX","Formulário de mapeamento enviado (D0)","Formulário preenchido","Auditoria de onboarding","Onboarding agendado (R1)","R1 realizada — Conexão","R2 realizada — Verificação","R3 realizada — Complemento","R4 realizada — Ciclo encerrado","Ciclo padrão mensal"];
const NEG_ETAPAS=[["iniciar","Iniciar acompanhamento"],["extrajudicial","Negociação extrajudicial"],["pos_judicializacao","Acordo após judicialização"],["minuta","Elaboração de minuta"],["formalizado","Acordo formalizado"],["pagamento_pendente","Pagamento pendente"],["concluido","Concluído"]];
const NEG_LABEL=Object.fromEntries(NEG_ETAPAS);
const TEMP={frio:"Frio",morno:"Morno",quente:"Quente"},TEMP_CLS={frio:"c",morno:"e2",quente:"e3"};
const DIRECIONAMENTO={acordos:"Acordos (extrajudicial)",juridico:"Jurídico PJ (peça)",ambos:"Acordos + Jurídico"};
const RESERVA={nao_iniciado:"Não iniciado",apresentado:"Apresentado ao cliente",em_construcao:"Em construção",formada:"Reserva formada — pronto p/ negociar"};
const REGUA={bronze:"Bronze (2x/mês)",prata:"Prata (1x/mês)",ouro:"Ouro (por marco)"};
const SERVICO={gestao_passivos:"Gestão de Passivos PJ",consultoria:"Consultoria",outro:"Outro"};
const STATUS={prospect:"Prospect",onboarding:"Em onboarding",ativo:"Ativo",pausado:"Pausado / em risco",encerrado:"Encerrado"};
const MON_STATUS={em_monitoramento:"Em monitoramento",nova_movimentacao:"Nova movimentação",pausado:"Pausado"};
const AVAL={nao:"Não",socio:"Sócio",terceiro:"Terceiro"};
const SITS=["Sem processo","Banco ajuizou ação","Cliente ajuizou ação","Execução em curso","Busca e apreensão","Acordo homologado"];
const X={neg:[],mon:[],colabs:[],ok:false,carregando:false,fCli:"",fResp:"",concluidas:false};
const hojeISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const addISO=(iso,n)=>{const d=parseD(iso)||hoje();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const tri=(v)=>sel({"":"—",true:"Sim",false:"Não"},v==null?"":String(v));
const triVal=(s)=>s.value===""?null:s.value==="true";
const check=(label,checked)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;return {wrap:el("label",{style:"display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg);cursor:pointer"},i,label),input:i}};
const flag=(l,v,cls)=>v==null?null:el("span",{class:"pill "+(v?cls:"g"),style:v?"":"opacity:.6"},l+": "+(v?"sim":"não"));
const colabSel=(v,vazio="—")=>sel({"":vazio,...Object.fromEntries(X.colabs.filter(c=>c.ativo||c.id===v).map(c=>[c.id,c.nome]))},v||"");
const nomeCli=id=>(S.clientes.find(c=>c.id===id)||{}).nome||id;

async function carregar(){
  if(X.carregando)return;X.carregando=true;
  try{
    const [n,m,c]=await Promise.all([SB.from("v_negociacoes").select("*").order("etapa_ordem").order("ordem").order("updated_at",{ascending:false}),
      SB.from("v_monitoramentos").select("*").order("proxima_checagem",{ascending:true,nullsFirst:false}),SB.from("colaboradores").select("id,nome,nucleo,ativo").order("nome")]);
    if(n.error)throw n.error;X.neg=n.data||[];X.mon=m.data||[];X.colabs=c.data||[];X.ok=true;
  }catch(e){console.warn("fluxo",e);toast("Não foi possível carregar negociações")}
  finally{X.carregando=false}
  render();
}
const garantir=()=>{if(!X.ok&&!X.carregando)carregar();return X.ok};
const recarregar=()=>{X.ok=false;garantir()};

/* ---------- Ficha: card do fluxo PJ ---------- */
function cardFluxo(c){
  const et=c.etapa_fluxo==null?null:+c.etapa_fluxo;
  const steps=el("div",{style:"display:flex;gap:4px;flex-wrap:wrap;align-items:flex-end"},ETAPAS.map((l,i)=>el("div",{title:`${i} · ${l}`,style:`flex:1;min-width:22px;height:8px;border-radius:4px;background:${et!=null&&i<=et?"var(--gold)":"var(--line)"}`})));
  const mon=X.ok?X.mon.find(m=>m.cliente_id===c.id):null;
  const abertas=X.ok?X.neg.filter(n=>n.cliente_id===c.id&&n.etapa!=="concluido"):[];
  const card=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Fluxo PJ"),el("div",{class:"note"},et==null?"Etapa ainda não definida — a mesma régua do Notion (0 a 10).":`Etapa ${et} · ${ETAPAS[et]}`)),
      el("div",{class:"actions edit-only"},et!=null&&et<10?el("button",{class:"btn sm",onclick:()=>avancar(c)},"Avançar etapa →"):null,el("button",{class:"btn sm primary",onclick:()=>openFluxoForm(c)},"Editar fluxo"))),
    steps,
    el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},c.status&&c.status!=="ativo"?el("span",{class:"pill e2"},STATUS[c.status]):null,flag("Dívida em atraso",c.tem_divida_atraso,"e3"),flag("Honorários em dia",c.adimplente,"e1"),flag("Processos",c.possui_processos,"e2"),
      c.projeto_reserva?el("span",{class:"pill "+(c.projeto_reserva==="formada"?"e1":"g")},"Reserva: "+RESERVA[c.projeto_reserva]):null,c.regua?el("span",{class:"pill g"},"Régua "+REGUA[c.regua].split(" ")[0]):null,c.servico?el("span",{class:"pill c"},SERVICO[c.servico]):null,
      flag("Registrato na pasta",c.registrato_ok,"e1"),c.direcionamento?el("span",{class:"pill e1",title:c.direcionamento_em?"direcionado em "+fmtD(parseD(c.direcionamento_em)):""},"→ "+DIRECIONAMENTO[c.direcionamento]):null),
    c.tipos_dividas?el("div",{class:"note"},el("b",{},"Dívidas mapeadas: "),c.tipos_dividas):null,
    el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"},
      el("div",{class:"kv"},el("div",{class:"k"},"Negociações abertas"),el("div",{class:"v"},X.ok?(abertas.length?el("a",{href:"#",style:"color:var(--info)",onclick:e=>{e.preventDefault();S.sub="negociacoes";render()}},`${abertas.length} · ${abertas.map(n=>NEG_LABEL[n.etapa]).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}`):"nenhuma"):"…")),
      el("div",{class:"kv"},el("div",{class:"k"},"Monitoramento"),el("div",{class:"v"},mon?[el("span",{class:"pill "+(mon.status==="nova_movimentacao"?"e2":"e1")},MON_STATUS[mon.status]),mon.proxima_checagem?` próxima checagem ${fmtD(parseD(mon.proxima_checagem))}`:""]:el("span",{class:"note"},"não iniciado"))),
      c.notion_url?el("div",{class:"kv"},el("div",{class:"k"},"Notion"),el("div",{class:"v"},el("a",{href:c.notion_url,target:"_blank",rel:"noopener",style:"color:var(--info)"},"↗ card no Notion"))):null));
  return card;
}
async function avancar(c){
  const et=Math.min(10,(+c.etapa_fluxo||0)+1);
  const {error}=await SB.from("clientes").update({etapa_fluxo:et}).eq("id",c.id);if(error){toast("Não foi possível avançar");return}
  await SB.from("entradas_timeline").insert({cliente_id:c.id,data:hojeISO(),tipo:"outro",descricao:`Fluxo PJ: etapa ${et} · ${ETAPAS[et]}`,visivel_cliente:false,automatica:true,fonte:"fluxo"});
  toast(`Etapa ${et}`);notificar("clientes");
}
function openFluxoForm(c){
  const et=sel({"":"—",...Object.fromEntries(ETAPAS.map((l,i)=>[String(i),`${i} · ${l}`]))},c.etapa_fluxo==null?"":String(c.etapa_fluxo)),st=sel(STATUS,c.status||"ativo"),div=tri(c.tem_divida_atraso),adi=tri(c.adimplente),pro=tri(c.possui_processos),
        res=sel({"":"—",...RESERVA},c.projeto_reserva||""),reg=sel({"":"—",...REGUA},c.regua||""),srv=sel({"":"—",...SERVICO},c.servico||""),tip=el("textarea",{placeholder:"Ex.: 3 créditos rurais Sicredi CPF; 1 capital de giro Sicoob CNPJ…"},c.tipos_dividas||""),
        onb=colabSel(c.responsavel_onboarding_id,"— responsável pelo onboarding —"),url=inp("url",c.notion_url||"",{placeholder:"https://www.notion.so/…"}),
        dir=sel({"":"— ainda não direcionado —",...DIRECIONAMENTO},c.direcionamento||""),regok=tri(c.registrato_ok);
  const body=el("div",{class:"form"},field("fl-et","Etapa do fluxo PJ",et,"Só avance quando a etapa anterior estiver 100% cumprida."),field("fl-st","Status",st),field("fl-div","Tem dívida em atraso?",div,"Sim → abre automaticamente o acompanhamento no setor de acordos."),field("fl-adi","Honorários em dia?",adi),field("fl-pro","Possui processos ajuizados?",pro),
    field("fl-res","Projeto de reserva",res,"Sem reserva não há poder de negociação. Verificar a partir da R2."),field("fl-reg","Régua de relacionamento",reg,"Bronze: silêncio de 3 dias já é risco. Prata: 20. Ouro: 45."),field("fl-srv","Serviço",srv),field("fl-onb","Responsável pelo onboarding",onb),field("fl-url","Card no Notion",url),field("fl-tip","Tipos de contratos / dívidas",tip),
    field("fl-regok","Registrato salvo na pasta?",regok,"Condição para o setor de acordos começar a negociar."),field("fl-dir","Direcionamento",dir,"Ao escolher, o sistema abre a tarefa no núcleo certo (Acordos e/ou Jurídico PJ) e garante a negociação. Só muda de novo se você alterar."));
  modal("Fluxo do cliente PJ",body,async()=>{
    const cols={etapa_fluxo:et.value===""?null:+et.value,status:st.value,tem_divida_atraso:triVal(div),adimplente:triVal(adi),possui_processos:triVal(pro),projeto_reserva:res.value||null,regua:reg.value||null,servico:srv.value||null,tipos_dividas:tip.value.trim()||null,responsavel_onboarding_id:onb.value||null,notion_url:url.value.trim()||null,registrato_ok:triVal(regok),direcionamento:dir.value||null};
    const {error}=await SB.from("clientes").update(cols).eq("id",c.id);if(error)throw new Error("Não foi possível salvar: "+(error.message||""));
    toast("Fluxo salvo");notificar("clientes");recarregar();
  });
}

/* ---------- Ficha: card do onboarding (0052) ---------- */
const ONB_PERG={veiculos:"Veículos",imoveis:"Imóveis",maquinario_tem:"Maquinário/ativos relevantes?",maquinario:"Quais / garantia",contratos:"Contratos e dívidas",situacao:"Situação de cada um",garantia:"Garantias",maquininha:"Maquininha?",maquininha_qual:"Qual maquininha",consorcio:"Consórcio?",outros_cnpjs:"Outros CNPJs?",outros_cnpjs_quais:"Quais CNPJs / atividade",acao_judicial:"Ação judicial?",negativado:"Negativado?",assuntos:"Assuntos para a reunião",disponibilidade:"Disponibilidade",extra:"Mais detalhes"};
const ONB_ST={pendente:["Agendada","g"],processando:["Enviando","g"],enviada:["Enviada","e1"],erro:["Erro","e3"],cancelada:["Cancelada","c"]};
function cardOnboarding(c){
  const card=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Onboarding"),el("div",{class:"note"},"Boas-vindas, formulário de mapeamento e agendamento da R1 — automáticos pelo WhatsApp."))),el("div",{class:"note"},"Carregando…"));
  (async()=>{
    const {data:o,error}=await SB.from("v_onboarding_cliente").select("*").eq("cliente_id",c.id).maybeSingle();
    if(error||!o){card.lastChild.textContent="Não foi possível carregar.";return}
    const link=new URL("cliente/onboarding.html?t="+o.onboarding_token,document.baseURI).href;
    const reun=o.reuniao;const fmtDT=iso=>new Date(iso).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"});
    const kvs=el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"},
      el("div",{class:"kv"},el("div",{class:"k"},"Boas-vindas + formulário"),el("div",{class:"v"},o.onboarding_enviado_em?"enviado "+fmtDT(o.onboarding_enviado_em):el("span",{class:"note"},"não enviado"))),
      el("div",{class:"kv"},el("div",{class:"k"},"Formulário"),el("div",{class:"v"},o.formulario_em?[el("span",{class:"pill e1"},"respondido "+fmtDT(o.formulario_em)),o.conferido_em?" · conferido":""]:el("span",{class:"note"},"aguardando o cliente"))),
      el("div",{class:"kv"},el("div",{class:"k"},"Entrada"),el("div",{class:"v"},o.entrada_ok?[el("span",{class:"pill e1"},"confirmada"),el("div",{class:"note"},o.entrada_paga_em?"paga no Asaas em "+fmtD(parseD(String(o.entrada_paga_em).slice(0,10))):o.entrada_confirmada_em?"confirmada manualmente em "+fmtDT(o.entrada_confirmada_em):"")]:[el("span",{class:"pill e2"},"não confirmada"),el("div",{class:"note"},"a R1 só pode ser marcada depois")])),
      el("div",{class:"kv"},el("div",{class:"k"},"Reunião R1"),el("div",{class:"v"},reun?[fmtDT(reun.inicio)+(reun.colaborador?" · "+reun.colaborador:""),reun.link&&!String(reun.link).startsWith("#")?el("div",{class:"note"},el("a",{href:reun.link,target:"_blank",rel:"noopener",style:"color:var(--info)"},"link da chamada")):el("div",{class:"note"},"sem link da chamada — preencha no compromisso da Agenda")]:el("span",{class:"note"},"não agendada"))));
    const msgs=(o.mensagens||[]).slice(0,6).map(m=>el("div",{class:"note",style:"display:flex;gap:8px;align-items:center"},el("span",{class:"pill "+(ONB_ST[m.status]||["",""])[1],style:"min-width:72px;text-align:center"},(ONB_ST[m.status]||[m.status])[0]),el("span",{},(m.titulo||m.modelo)+" · "+fmtDT(m.enviar_em)+(m.status==="erro"&&m.resultado?" — "+m.resultado:"")),
      m.status==="pendente"?el("button",{class:"btn sm",style:"margin-left:auto",onclick:async()=>{await SB.from("mensagens_fila").update({status:"cancelada",resultado:"Cancelada pela equipe"}).eq("id",m.id);toast("Cancelada");recarregarFicha()}},"Cancelar"):null));
    const acts=el("div",{class:"actions edit-only",style:"display:flex;gap:6px;flex-wrap:wrap"},
      el("button",{class:"btn sm",onclick:()=>{navigator.clipboard?.writeText(link);toast("Link do formulário copiado")}},"Copiar link do formulário"),
      el("button",{class:"btn sm",onclick:()=>{navigator.clipboard?.writeText(link+"#agendar");toast("Link da agenda copiado")}},"Copiar link da agenda"),
      !o.entrada_ok?el("button",{class:"btn sm primary",onclick:async()=>{if(!window.confirm("Confirmar que a entrada foi paga e liberar o agendamento da R1? "+(o.formulario_em?"O cliente recebe o link da agenda por WhatsApp agora.":"Quando o cliente responder o formulário, já recebe o link da agenda."))) return;const {data,error}=await SB.rpc("onboarding_liberar_agenda",{p_cliente:c.id,p_origem:"manual"});if(error){toast("Não foi possível liberar");return}toast(data?.enviado?"Entrada confirmada — link da agenda enviado":"Entrada confirmada");recarregarFicha()}},"Confirmar entrada e liberar R1"):null,
      el("button",{class:"btn sm primary",onclick:async()=>{if(!window.confirm(o.onboarding_enviado_em?"Reenviar as boas-vindas com o link do formulário agora?":"Enviar as boas-vindas com o link do formulário agora?"))return;const {error}=await SB.rpc("onboarding_enviar_boas_vindas",{p_cliente:c.id,p_em:new Date().toISOString()});if(error){toast("Não foi possível enfileirar");return}toast("Mensagem agendada para envio");recarregarFicha()}},o.onboarding_enviado_em?"Reenviar boas-vindas":"Enviar boas-vindas"),
      o.respostas?el("button",{class:"btn sm",onclick:()=>{const body=el("div",{},Object.entries(ONB_PERG).filter(([k])=>o.respostas[k]).map(([k,l])=>el("div",{class:"kv",style:"margin-bottom:8px"},el("div",{class:"k"},l),el("div",{class:"v",style:"white-space:pre-wrap"},String(o.respostas[k])))));
        modal("Formulário de mapeamento — respostas do cliente",body,async()=>{await SB.from("onboarding_respostas").update({conferido_em:new Date().toISOString()}).eq("cliente_id",c.id).is("conferido_em",null);toast("Marcado como conferido");recarregarFicha()})}},"Ver respostas"+(o.conferido_em?"":" · conferir")):null);
    card.replaceChildren(card.firstChild,kvs,msgs.length?el("div",{style:"display:grid;gap:4px"},el("div",{class:"k"},"Mensagens WhatsApp"),...msgs):el("div",{class:"note"},"Nenhuma mensagem na fila."),acts);
  })();
  return card;
}
const recarregarFicha=()=>{try{notificar("clientes")}catch(_){}};

/* ---------- Negociações ---------- */
function negCard(n,compacto){
  const parada=n.dias_parada>15&&n.etapa!=="concluido";
  const mover=sel(Object.fromEntries(NEG_ETAPAS),n.etapa);mover.className="";mover.style.cssText="font-size:12px;padding:3px 6px;width:100%";
  mover.onchange=async()=>{const {error}=await SB.from("negociacoes").update({etapa:mover.value}).eq("id",n.id);if(error)toast("Não foi possível mover");else{toast(NEG_LABEL[mover.value]);recarregar()}};
  mover.onclick=e=>e.stopPropagation();
  return el("div",{class:"card neg-card","data-id":n.id,style:`padding:10px 12px;cursor:pointer;border-left:3px solid ${n.atrasada?"var(--crit)":parada?"var(--warn)":"var(--line)"}`,onclick:()=>openNegForm(null,n)},
    compacto?null:el("div",{style:"font-weight:700"},n.cliente_nome),
    el("div",{style:"font-size:13px"},n.titulo),
    el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"},n.banco?el("span",{class:"pill g"},n.banco):null,n.temperatura?el("span",{class:"pill "+TEMP_CLS[n.temperatura]},TEMP[n.temperatura]):null,n.situacao_processual?el("span",{class:"pill c"},n.situacao_processual):null),
    (n.valor_acordo||n.valor_cobrado||n.alcada_autorizada)?el("div",{class:"note num"},[n.valor_cobrado?`cobrado ${BRL(+n.valor_cobrado)}`:null,n.valor_acordo?`acordo ${BRL(+n.valor_acordo)}`:null,n.alcada_autorizada?`alçada ${BRL(+n.alcada_autorizada)}`:null].filter(Boolean).join(" · ")):null,
    n.proximo_passo?el("div",{class:"note",style:"margin-top:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden"},n.proximo_passo):null,
    n.aguardando?el("div",{class:"note"},el("b",{},"Aguardando: "),n.aguardando):null,
    el("div",{style:"margin-top:6px;font-size:12px;color:var(--muted)"},n.responsavel_nome||"sem responsável",n.prazo?el("span",{style:n.atrasada?"color:var(--crit);font-weight:700":""}," · prazo "+fmtD(parseD(n.prazo))):null,parada?` · parada há ${n.dias_parada}d`:null),compacto?null:el("div",{style:"margin-top:6px"},mover));
}
function renderNegociacoes(){
  if(negV3())return renderNegociacoesV3();
  const v=$("#view-negociacoes");v.replaceChildren();v.classList.remove("np-v3");
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Acordos"),el("h1",{},"Negociações"),el("div",{class:"sub"},"Kanban do setor de acordos: uma negociação por banco/contrato, da abertura ao acordo concluído. Clique no card para editar; arraste entre as colunas (ou use o seletor) para mudar a etapa.")),
    el("div",{class:"actions"},el("button",{class:"btn",onclick:()=>irPara("historico"),title:"Acordos já fechados: base para a projeção de desconto"},"Base de acordos"),PP.perfil?.papel==="admin"?el("button",{class:"btn",onclick:()=>irPara("regras")},"Regras de projeção"):null,PP.perfil?.papel==="admin"?el("button",{class:"btn",onclick:()=>irPara("calibracao")},"Calibração"):null,el("button",{class:"btn primary",onclick:()=>openNegForm(null,{})},"+ Negociação"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const fc=sel({"":"Todos os clientes",...Object.fromEntries([...new Set(X.neg.map(n=>n.cliente_id))].map(id=>[id,nomeCli(id)]).sort((a,b)=>a[1].localeCompare(b[1])))},X.fCli);fc.onchange=()=>{X.fCli=fc.value;render()};
  const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(X.colabs.filter(c=>c.ativo).map(c=>[c.id,c.nome]))},X.fResp);fr.onchange=()=>{X.fResp=fr.value;render()};
  const tg=check("Mostrar concluídas",X.concluidas);tg.input.onchange=()=>{X.concluidas=tg.input.checked;render()};
  const lista=X.neg.filter(n=>(!X.fCli||n.cliente_id===X.fCli)&&(!X.fResp||n.responsavel_id===X.fResp));
  const abertas=lista.filter(n=>n.etapa!=="concluido"),concl=lista.filter(n=>n.etapa==="concluido");
  v.append(el("div",{class:"kpis"},kpi("Abertas",String(abertas.length),`${new Set(abertas.map(n=>n.cliente_id)).size} cliente(s)`),kpi("Em valor cobrado",BRL(abertas.reduce((a,n)=>a+(+n.valor_cobrado||0),0)),"soma das negociações abertas"),
    kpi("Acordos concluídos",BRL(concl.reduce((a,n)=>a+(+n.valor_acordo||0),0)),`${concl.length} negociação(ões)`),kpi("Atrasadas / paradas",String(abertas.filter(n=>n.atrasada).length)+" / "+String(abertas.filter(n=>n.dias_parada>15).length),"prazo vencido · sem mexer há 15+ dias")));
  v.append(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center"},fc,fr,tg.wrap));
  const cols=NEG_ETAPAS.filter(([k])=>k!=="concluido"||X.concluidas);
  const kb=el("div",{style:"display:grid;grid-template-columns:repeat("+cols.length+",minmax(185px,1fr));gap:10px;overflow-x:auto;align-items:start"},cols.map(([k,l])=>{
    const its=lista.filter(n=>n.etapa===k);
    return el("div",{class:"neg-col","data-etapa":k,style:"display:flex;flex-direction:column;gap:8px;min-width:185px;min-height:120px;border-radius:8px"},el("div",{style:"display:flex;justify-content:space-between;align-items:center;padding:4px 2px;border-bottom:2px solid var(--gold)"},el("b",{style:"font-size:13px"},l),el("span",{class:"pill g"},String(its.length))),
      its.length?its.map(n=>negCard(n,false)):el("div",{class:"note",style:"padding:8px 2px"},"—"));
  }));
  v.append(kb);
  if(window.PP_DND)PP_DND.ativar(kb,{card:".neg-card",coluna:".neg-col",chaveCol:c=>c.dataset.etapa,chaveCard:c=>c.dataset.id,aoSoltar:async(c,etapa)=>{const {error}=await SB.from("negociacoes").update({etapa}).eq("id",c.dataset.id);if(error)toast("Não foi possível mover");else{toast(NEG_LABEL[etapa]);recarregar()}}});
}
function renderNegCliente(c,host){
  const ok=garantir();
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Negociações"),el("div",{class:"note"},"Acompanhamento do setor de acordos para este cliente.")),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openNegForm(c,{})},"+ Negociação"))));
  if(!ok)sec.append(el("div",{class:"note"},"Carregando…"));
  else{const its=X.neg.filter(n=>n.cliente_id===c.id);
    if(!its.length)sec.append(el("div",{class:"note"},"Nenhuma negociação. Marque “Tem dívida em atraso” no fluxo ou abra uma negociação por banco."));
    else sec.append(el("div",{style:"display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px"},its.map(n=>el("div",{},el("div",{class:"note",style:"margin-bottom:4px"},NEG_LABEL[n.etapa]),negCard(n,true)))))}
  host.append(sec);
  const m=ok?X.mon.find(x=>x.cliente_id===c.id):null;
  const mon=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Monitoramento processual"),el("div",{class:"note"},"Checagem periódica (Escavador) dos CPFs/CNPJs do cliente, sócios e avalistas.")),el("div",{class:"actions edit-only"},m?el("button",{class:"btn sm",onclick:()=>checar(m)},"Checado hoje"):null,el("button",{class:"btn sm primary",onclick:()=>openMonForm(c.id,m||{})},m?"Editar":"Iniciar monitoramento"))));
  if(ok&&m)mon.append(el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"},
    kv("Status",el("span",{class:"pill "+(m.status==="nova_movimentacao"?"e2":m.status==="pausado"?"g":"e1")},MON_STATUS[m.status])),kv("Documentos monitorados",(m.documentos||[]).join(", ")||"—"),kv("Última checagem",m.ultima_checagem?fmtD(parseD(m.ultima_checagem)):"—"),
    kv("Próxima checagem",m.proxima_checagem?el("span",{style:m.checagem_vencida?"color:var(--crit);font-weight:700":""},fmtD(parseD(m.proxima_checagem))):"—"),kv("Responsável",m.responsavel_nome||"—"),kv("Processos ativos",String(m.processos_ativos||0))),
    el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},flag("Tem processo",m.tem_processo,"e2"),flag("Foi citado",m.foi_citado,"e3"),flag("Tem garantia",m.tem_garantia,"e2"),m.avalistas?el("span",{class:"pill g"},"Avalistas: "+AVAL[m.avalistas]):null),m.observacoes?el("div",{class:"note",style:"white-space:pre-wrap"},m.observacoes):null);
  else if(ok)mon.append(el("div",{class:"note"},"Ainda não há monitoramento para este cliente."));
  host.append(mon);
}
const kv=(k,v)=>el("div",{class:"kv"},el("div",{class:"k"},k),el("div",{class:"v"},v==null||v===""?el("span",{class:"note"},"—"):v));
function openNegForm(c,n){
  const fixo=c||(n.cliente_id?{id:n.cliente_id}:null);
  const cli=sel({"":"— cliente —",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(x=>[x.id,x.nome]))},fixo?fixo.id:"");if(fixo)cli.disabled=true;
  const tit=inp("text",n.titulo||"",{placeholder:"Ex.: CL Comércio | Santander | Capital de giro"}),banco=inp("text",n.banco||"",{list:"bancos-neg"}),bdl=el("datalist",{id:"bancos-neg"},Object.keys(S.regras?.fatoresBanco||{}).map(b=>el("option",{value:b}))),
        et=sel(Object.fromEntries(NEG_ETAPAS),n.etapa||"iniciar"),temp=sel({"":"—",...TEMP},n.temperatura||""),sit=inp("text",n.situacao_processual||"",{list:"sits-neg"}),sdl=el("datalist",{id:"sits-neg"},SITS.map(s=>el("option",{value:s}))),
        npr=inp("text",n.numero_processo||"",{placeholder:"0000000-00.0000.0.00.0000"}),resp=colabSel(n.responsavel_id,"— responsável —"),adv=inp("text",n.adverso_contato||"",{placeholder:"Escritório adverso / gerente e telefone"}),
        vc=inp("number",n.valor_cobrado||"",{step:"100"}),va=inp("number",n.valor_acordo||"",{step:"100"}),alc=inp("number",n.alcada_autorizada||"",{step:"100"}),da=inp("date",n.data_acordo||""),pz=inp("date",n.prazo||""),
        ag=inp("text",n.aguardando||"",{placeholder:"Ex.: comprovante de quitação, retorno do banco"}),pp=el("textarea",{placeholder:"Próximo passo concreto e quem faz."},n.proximo_passo||""),obs=el("textarea",{},n.observacoes||"");
  const konSel=()=>{const ks=S.contratos.filter(k=>k.clienteId===cli.value);return sel({"":"— sem vínculo com contrato —",...Object.fromEntries(ks.map(k=>[k.id,shortName(k)]))},n.contrato_id||"")};
  let kon=konSel();const konWrap=el("div",{},kon);cli.onchange=()=>{kon=konSel();konWrap.replaceChildren(kon)};
  kon.onchange=()=>{const k=S.contratos.find(x=>x.id===kon.value);if(k&&!banco.value)banco.value=k.banco||"";if(k&&!vc.value&&k.saldoAtual)vc.value=k.saldoAtual};
  const pex=inp("number",n.percentual_exito??"",{step:"1",min:"0",max:"100",placeholder:"ex.: 20"}),alcHint=el("div",{class:"note"});
  const calcAlc=()=>{const vc=+vc_.value||0,va=+va_.value||0,p=+pex.value||0,a=+alc.value||0;if(!va){alcHint.textContent="Alçada = quanto o cliente pode desembolsar no total: valor do acordo + honorários de êxito.";return}
    const ex=p&&vc>va?(vc-va)*p/100:0,tot=va+ex;alcHint.textContent=`Desembolso total do cliente: ${BRL(tot)} (acordo ${BRL(va)}${ex?` + êxito ${BRL(ex)}`:""})`+(a?tot>a?` · ACIMA da alçada em ${BRL(tot-a)}`:` · dentro da alçada (sobra ${BRL(a-tot)})`:"");alcHint.style.color=a&&tot>a?"var(--crit)":"";};
  const vc_=vc,va_=va;[vc,va,alc,pex].forEach(i=>i.oninput=calcAlc);setTimeout(calcAlc,0);
  const body=el("div",{class:"form"},field("ng-cli","Cliente",cli),el("div",{class:"f"},el("label",{},"Contrato relacionado"),konWrap),field("ng-tit","Título",tit),el("div",{class:"f"},el("label",{for:"ng-banco"},"Banco"),el("div",{},Object.assign(banco,{id:"ng-banco"}),bdl)),
    field("ng-et","Etapa",et),field("ng-temp","Temperatura",temp),el("div",{class:"f"},el("label",{for:"ng-sit"},"Situação processual"),el("div",{},Object.assign(sit,{id:"ng-sit"}),sdl)),field("ng-npr","Nº do processo",npr),field("ng-resp","Responsável",resp),field("ng-adv","Escritório adverso / contato",adv),
    field("ng-vc","Valor cobrado (R$)",vc),field("ng-va","Valor do acordo (R$)",va),field("ng-pex","Honorários de êxito (%)",pex,"Sobre a economia obtida (cobrado − acordo)."),el("div",{class:"f"},el("label",{for:"ng-alc"},"Alçada autorizada pelo cliente (R$)"),el("div",{},Object.assign(alc,{id:"ng-alc"}),alcHint)),field("ng-da","Data do acordo",da),field("ng-pz","Prazo",pz),field("ng-ag","Aguardando",ag),field("ng-pp","Próximo passo",pp),field("ng-obs","Observações",obs));
  const extra=n.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta negociação?"))return;await SB.from("negociacoes").delete().eq("id",n.id);$("#modalHost").replaceChildren();toast("Negociação excluída");recarregar()}},"Excluir"):null;
  modal(n.id?"Editar negociação":"Nova negociação",body,async()=>{
    if(!cli.value)throw new Error("Escolha o cliente");
    const titulo=tit.value.trim()||[nomeCli(cli.value),banco.value.trim()].filter(Boolean).join(" | ");
    const row={cliente_id:cli.value,contrato_id:kon.value||null,titulo,banco:banco.value.trim()||null,etapa:et.value,temperatura:temp.value||null,situacao_processual:sit.value.trim()||null,numero_processo:npr.value.trim()||null,responsavel_id:resp.value||null,adverso_contato:adv.value.trim()||null,
      valor_cobrado:vc.value===""?null:+vc.value,valor_acordo:va.value===""?null:+va.value,alcada_autorizada:alc.value===""?null:+alc.value,percentual_exito:pex.value===""?null:+pex.value,data_acordo:da.value||null,prazo:pz.value||null,aguardando:ag.value.trim()||null,proximo_passo:pp.value.trim()||null,observacoes:obs.value.trim()||null};
    const {error}=n.id?await SB.from("negociacoes").update(row).eq("id",n.id):await SB.from("negociacoes").insert(row);if(error)throw new Error("Não foi possível salvar: "+(error.message||""));
    toast("Negociação salva");recarregar();
  },extra);
}

/* ---------- Monitoramento ---------- */
async function checar(m){
  const {error}=await SB.from("monitoramentos").update({ultima_checagem:hojeISO(),proxima_checagem:addISO(hojeISO(),1),status:m.status==="pausado"?"pausado":"em_monitoramento"}).eq("id",m.id);
  if(error)toast("Não foi possível registrar");else{toast("Checagem registrada");recarregar()}
}
function renderMonitoramento(){
  const v=$("#view-monitoramento");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Monitoramento processual"),el("div",{class:"sub"},"Uma linha por cliente: documentos monitorados no Escavador, última e próxima checagem. “Checado hoje” marca a verificação e agenda a próxima para amanhã."))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const hojeStr=hojeISO();
  const vencidos=X.mon.filter(m=>m.checagem_vencida),novas=X.mon.filter(m=>m.status==="nova_movimentacao");
  v.append(el("div",{class:"kpis"},kpi("Clientes monitorados",String(X.mon.filter(m=>m.status!=="pausado").length),`${X.mon.filter(m=>m.status==="pausado").length} pausado(s)`),kpi("A checar hoje",String(vencidos.length),"próxima checagem vencida ou hoje"),kpi("Nova movimentação",String(novas.length),"aguardando análise"),kpi("Sem monitoramento",String(S.clientes.filter(c=>c.ativo!==false&&!X.mon.some(m=>m.cliente_id===c.id)).length),"clientes ativos fora da lista")));
  const sem=S.clientes.filter(c=>c.ativo!==false&&!X.mon.some(m=>m.cliente_id===c.id));
  if(sem.length)v.append(el("div",{class:"card section",style:"border-left:3px solid var(--warn)"},el("div",{},el("b",{},"Sem monitoramento: "),sem.map(c=>c.nome).join(" · ")),el("div",{class:"actions",style:"justify-content:flex-start"},sem.slice(0,8).map(c=>el("button",{class:"btn sm",onclick:()=>openMonForm(c.id,{})},"Iniciar "+c.nome)))));
  const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"Cliente"),el("th",{},"Status"),el("th",{},"Documentos"),el("th",{class:"r"},"Processos"),el("th",{},"Citado"),el("th",{},"Última"),el("th",{},"Próxima"),el("th",{},"Responsável"),el("th",{},""))),
    el("tbody",{},X.mon.map(m=>el("tr",{},el("td",{},el("b",{},m.cliente_nome),m.observacoes?el("div",{class:"note"},m.observacoes):null),el("td",{},el("span",{class:"pill "+(m.status==="nova_movimentacao"?"e2":m.status==="pausado"?"g":"e1")},MON_STATUS[m.status])),
      el("td",{title:(m.documentos||[]).join("\n")},`${(m.documentos||[]).length} doc(s)`,el("div",{class:"note"},(m.documentos||[]).slice(0,2).join(", ")+((m.documentos||[]).length>2?"…":""))),el("td",{class:"r num"},String(m.processos_ativos||0)),el("td",{},m.foi_citado==null?"—":m.foi_citado?el("span",{class:"pill e3"},"sim"):"não"),
      el("td",{},m.ultima_checagem?fmtD(parseD(m.ultima_checagem)):"—"),el("td",{style:m.checagem_vencida?"color:var(--crit);font-weight:700":""},m.proxima_checagem?(m.proxima_checagem===hojeStr?"hoje":fmtD(parseD(m.proxima_checagem))):"—"),el("td",{},m.responsavel_nome||"—"),
      el("td",{},el("div",{style:"display:flex;gap:4px;flex-wrap:wrap"},el("button",{class:"btn sm",onclick:()=>checar(m)},"Checado hoje"),m.status!=="nova_movimentacao"?el("button",{class:"btn sm",onclick:async()=>{await SB.from("monitoramentos").update({status:"nova_movimentacao"}).eq("id",m.id);recarregar()}},"Nova mov."):el("button",{class:"btn sm",onclick:async()=>{await SB.from("monitoramentos").update({status:"em_monitoramento"}).eq("id",m.id);recarregar()}},"Analisada"),el("button",{class:"btn sm",onclick:()=>openMonForm(m.cliente_id,m)},"Editar")))))));
  v.append(el("section",{class:"card section"},el("div",{class:"tbl"},tb)));
}
function openMonForm(cid,m){
  const st=sel(MON_STATUS,m.status||"em_monitoramento"),docs=el("textarea",{placeholder:"Um CPF/CNPJ por linha (empresa, sócios, avalistas)."},(m.documentos||[]).join("\n")),tp=tri(m.tem_processo),fc=tri(m.foi_citado),tg=tri(m.tem_garantia),av=sel({"":"—",...AVAL},m.avalistas||""),
        ult=inp("date",m.ultima_checagem||""),prox=inp("date",m.proxima_checagem||""),resp=colabSel(m.responsavel_id,"— responsável —"),obs=el("textarea",{},m.observacoes||"");
  const body=el("div",{class:"form"},el("div",{class:"f full note"},"Cliente: "+nomeCli(cid)),field("mo-st","Status",st),field("mo-resp","Responsável",resp),field("mo-tp","Tem processo?",tp),field("mo-fc","Foi citado?",fc),field("mo-tg","Tem garantia?",tg),field("mo-av","Avalistas",av),field("mo-ult","Última checagem",ult),field("mo-prox","Próxima checagem",prox),field("mo-docs","Documentos monitorados",docs),field("mo-obs","Observações",obs));
  modal(m.id?"Editar monitoramento":"Iniciar monitoramento",body,async()=>{
    const row={cliente_id:cid,status:st.value,documentos:docs.value.split("\n").map(s=>s.trim()).filter(Boolean),tem_processo:triVal(tp),foi_citado:triVal(fc),tem_garantia:triVal(tg),avalistas:av.value||null,ultima_checagem:ult.value||null,proxima_checagem:prox.value||null,responsavel_id:resp.value||null,observacoes:obs.value.trim()||null};
    const {error}=await SB.from("monitoramentos").upsert(row,{onConflict:"cliente_id"});if(error)throw new Error("Não foi possível salvar: "+(error.message||""));
    toast("Monitoramento salvo");recarregar();
  });
}

/* ====================================================================================================================
   V3.1 (Design System, Fase 3) — Negociações: mesma lógica, outra apresentação. Ativa só com a casca V3.1 (html.np-casca-v3)
   e np-ui carregado; fora disso, renderNegociacoes() acima continua intacta. Nenhuma função acima é alterada: o painel chama
   openNegForm (editar/excluir), e mover etapa reproduz 1:1 o aoSoltar do kanban V2 (update negociacoes{etapa} → toast → recarregar).
   Filtros V3.1 são client-side sobre X.neg (mesma consulta); os seletores da V2 (cliente, responsável, concluídas) continuam em "Mais filtros".
   ==================================================================================================================== */
const negV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const N3={escopo:"abertas",atrasadas:false,paradas:false,minhas:false,bancos:new Set(),painel:null,obra:null,aberta:null,grupos:null,vista:null};
const TEMP_TOM={frio:"info",morno:"att",quente:"crit"};
const NEG_FASE_ACORDO=["formalizado","pagamento_pendente","concluido"]; // a partir daqui o valor do acordo deixa de ser proposta em negociação
const paradaN=n=>n.dias_parada>15&&n.etapa!=="concluido";
const gruposN3=()=>{if(!N3.grupos){try{N3.grupos=JSON.parse(NPUI.pref.get("np-neg-grupos","{}"))||{}}catch(_){N3.grupos={}}}return N3.grupos};
const vistaN3=()=>{if(!N3.vista)N3.vista=NPUI.pref.get("np-neg-vista",null)||"lista";return N3.vista};
const meuColabN=()=>X.colabs.find(c=>c.perfil_id===PP.perfil?.id)||(typeof meuColab==="function"?null:null);
/* mesma seleção da V2 (fCli/fResp) + atributos V3.1 (client-side) */
function listaBaseN3(){return X.neg.filter(n=>(!X.fCli||n.cliente_id===X.fCli)&&(!X.fResp||n.responsavel_id===X.fResp))}
function filtrarN3(lista){
  const meu=meuColabN();
  return lista.filter(n=>{
    if(N3.escopo==="abertas"&&n.etapa==="concluido")return false;if(N3.escopo==="concluidas"&&n.etapa!=="concluido")return false;
    if(N3.atrasadas&&!n.atrasada)return false;if(N3.paradas&&!paradaN(n))return false;if(N3.minhas&&!(meu&&n.responsavel_id===meu.id))return false;
    if(N3.bancos.size&&!N3.bancos.has((n.banco||"").trim()))return false;return true})
}
const reguaN3=n=>n.etapa==="concluido"?null:n.atrasada?"late":paradaN(n)?"att":null;
const tomPrazoN3=n=>n.atrasada&&n.etapa!=="concluido"?"late":"";
function marcasN3(n){const m=[];if(n.temperatura&&TEMP[n.temperatura])m.push(NPUI.marca(TEMP[n.temperatura].toLowerCase(),TEMP_TOM[n.temperatura]));if(paradaN(n))m.push(NPUI.marca(`parada há ${n.dias_parada}d`,"att"));if(n.etapa==="concluido")m.push(NPUI.marca("concluída","ok"));return m}
function contextoN3(n){
  const p=NPUI.prazoTxt(n.prazo);const partes=[];
  if(n.cliente_nome)partes.push(el("b",{},n.cliente_nome));if(n.banco)partes.push(n.banco);if(n.situacao_processual)partes.push(n.situacao_processual);if(n.aguardando)partes.push("aguardando "+n.aguardando);
  const out=[];partes.forEach((x,i)=>{if(i)out.push(" · ");out.push(x)});
  if(p.rel&&n.etapa!=="concluido"&&n.prazo){if(out.length)out.push(el("span",{class:"sep"}," · "));out.push(el("span",{class:"rel "+tomPrazoN3(n)},p.rel))}
  return out;
}
function linhaN3(n){
  const p=NPUI.prazoTxt(n.prazo);const ab=n.etapa!=="concluido";
  return NPUI.linha({id:n.id,regua:reguaN3(n),riscado:false,atual:N3.aberta===n.id,
    prazo:n.prazo?{curta:p.curta,hora:"",rel:ab?p.rel:"",exata:p.exata+(p.rel?" · "+p.rel:""),tom:tomPrazoN3(n)}:{curta:"",exata:"sem prazo"},
    titulo:n.titulo||[n.cliente_nome,n.banco].filter(Boolean).join(" | "),contexto:contextoN3(n),titleAbrir:"Abrir a negociação",
    direita:[...marcasN3(n),NPUI.val({cobrado:n.valor_cobrado,acordo:n.valor_acordo}),NPUI.quem(n.responsavel_nome)],
    onOpen:li=>abrirPainelN3(n,{origem:li.querySelector(".np-it-abrir")})});
}
function listaN3(lista){
  const host=el("div",{class:"np-corpo"});const grupos=NEG_ETAPAS.filter(([k])=>lista.some(n=>n.etapa===k));
  if(!grupos.length){host.append(NPUI.vazio({titulo:"Nada com esses filtros",texto:"Tire um filtro ou abra uma negociação pela ficha do cliente.",acao:"Limpar filtros",onAcao:()=>{limparN3();render()}}));return host}
  const ab=gruposN3();
  for(const [k,l] of grupos){const its=lista.filter(n=>n.etapa===k);const abertoPadrao=k!=="concluido";
    host.append(NPUI.grupo({id:k,titulo:l,n:its.length,tom:"",aberto:ab[k]!=null?ab[k]!==false:abertoPadrao,onToggle:v=>{ab[k]=v;NPUI.pref.set("np-neg-grupos",JSON.stringify(ab))},itens:its.map(linhaN3)}))}
  return host;
}
/* mover etapa: cópia 1:1 do aoSoltar do kanban V2 (e do seletor do card) — mesma escrita, mesmo toast, mesma recarga */
async function moverN3(n,etapa){
  if(n.etapa===etapa)return;if(readOnly()){toast("Só leitura");return}
  const {error}=await SB.from("negociacoes").update({etapa}).eq("id",n.id);if(error)toast("Não foi possível mover");else{toast(NEG_LABEL[etapa]);recarregar()}
}
function cardN3(n){
  const p=NPUI.prazoTxt(n.prazo);const r=reguaN3(n);
  const mover=readOnly()?null:NPUI.ib("pontos","Mover "+(n.titulo||"negociação"),(e)=>{e.stopPropagation();NPUI.pop(e.currentTarget,NEG_ETAPAS.map(([k,l])=>({label:l,atual:n.etapa===k,onclick:()=>moverN3(n,k)})),{label:"Mover etapa"})});
  const c=el("div",{class:"np-cardq neg-card"+(r?" r-"+r:""),"data-id":n.id,tabindex:"0",role:"button","aria-label":n.titulo||"",onclick:()=>abrirPainelN3(n,{origem:c}),onkeydown:e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();abrirPainelN3(n,{origem:c})}}},
    el("div",{class:"tx"},n.titulo||[n.cliente_nome,n.banco].filter(Boolean).join(" | ")),el("div",{class:"ctx"},[n.cliente_nome,n.banco].filter(Boolean).join(" · ")),
    el("div",{class:"pe"},el("span",{class:"pz "+tomPrazoN3(n),title:n.prazo?p.exata+" · "+p.rel:"sem prazo"},n.prazo?p.curta:"sem prazo"),el("span",{style:"display:flex;gap:4px;align-items:center"},...marcasN3(n),mover)),
    (n.valor_cobrado!=null||n.valor_acordo!=null)?el("div",{class:"ctx"},NPUI.val({cobrado:n.valor_cobrado,acordo:n.valor_acordo})):null);
  if(readOnly())c.setAttribute("draggable","false");
  return c;
}
function quadroN3(lista){
  const cols=NEG_ETAPAS.filter(([k])=>k!=="concluido"||X.concluidas); // mesma regra do kanban V2
  const host=el("div",{class:"np-quadro np-quadro-neg",style:"--n:"+cols.length});
  for(const [k,l] of cols){const its=lista.filter(n=>n.etapa===k);
    host.append(el("div",{class:"np-colq neg-col","data-st":k,"data-etapa":k},el("h3",{},el("span",{},l),el("span",{class:"n"},String(its.length))),el("div",{class:"np-colq-b"},its.length?its.map(cardN3):el("div",{class:"np-rodape",style:"justify-content:center"},"—"))))}
  if(window.PP_DND&&!readOnly())PP_DND.ativar(host,{card:".np-cardq",coluna:".np-colq",chaveCol:c=>c.dataset.etapa,chaveCard:c=>c.dataset.id,aoSoltar:async(c,etapa)=>{const n=X.neg.find(x=>x.id===c.dataset.id);if(n)await moverN3(n,etapa)}});
  return host;
}
function limparN3(){X.fCli="";X.fResp="";X.concluidas=false;N3.escopo="abertas";N3.atrasadas=false;N3.paradas=false;N3.minhas=false;N3.bancos=new Set()}
function filtrosN3(){
  const chips=[];const C=(o)=>{const c=NPUI.chip(o);chips.push(c);return c};const base=listaBaseN3();const abertas=base.filter(n=>n.etapa!=="concluido");const meu=meuColabN();
  const esc=(k,l,n)=>C({label:l,n,on:N3.escopo===k,grupo:"escopo",onclick:()=>{N3.escopo=k;X.concluidas=k!=="abertas";render()}});
  esc("abertas","Abertas",null);esc("concluidas","Concluídas",base.filter(n=>n.etapa==="concluido").length||null);esc("todas","Todas",null);
  chips.push(NPUI.sepv());
  C({label:"Atrasadas",n:abertas.filter(n=>n.atrasada).length,on:N3.atrasadas,grupo:"attr",title:"Prazo vencido",onclick:()=>{N3.atrasadas=!N3.atrasadas;render()}}).classList.add("crit");
  C({label:"Paradas",n:abertas.filter(paradaN).length,on:N3.paradas,grupo:"attr",title:"Sem movimentação há mais de 15 dias",onclick:()=>{N3.paradas=!N3.paradas;render()}});
  if(meu)C({label:"Minhas",n:abertas.filter(n=>n.responsavel_id===meu.id).length,on:N3.minhas,grupo:"attr",title:"Só as minhas (responsável = eu)",onclick:()=>{N3.minhas=!N3.minhas;render()}});
  /* bancos: os 3 mais frequentes entre as abertas; os demais em "Mais filtros" */
  const cont=new Map();for(const n of abertas){const b=(n.banco||"").trim();if(b)cont.set(b,(cont.get(b)||0)+1)}
  const bancos=[...cont.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(x=>x[0]);const top=bancos.slice(0,3);
  if(top.length){chips.push(NPUI.sepv());for(const b of top)C({label:b,on:N3.bancos.has(b),grupo:"banco",onclick:()=>{if(N3.bancos.has(b))N3.bancos.delete(b);else N3.bancos.add(b);render()}})}
  const extras=[X.fCli,X.fResp&&!(meu&&N3.minhas&&X.fResp===meu.id),[...N3.bancos].some(b=>!top.includes(b))].filter(Boolean).length;
  const mais=NPUI.chip({label:"Mais filtros",n:extras||null,on:extras>0,title:"Cliente, responsável, banco",onclick:(e)=>NPUI.pop(e.currentTarget,()=>{
    const fc=sel({"":"Todos os clientes",...Object.fromEntries([...new Set(X.neg.map(n=>n.cliente_id))].map(id=>[id,nomeCli(id)]).sort((a,b)=>a[1].localeCompare(b[1])))},X.fCli);fc.onchange=()=>{X.fCli=fc.value;render()};
    const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(X.colabs.filter(c=>c.ativo).map(c=>[c.id,c.nome]))},X.fResp);fr.onchange=()=>{X.fResp=fr.value;render()};
    const todosB=[...new Set(X.neg.map(n=>(n.banco||"").trim()).filter(Boolean))].sort();const fb=sel({"":"Todos os bancos",...Object.fromEntries(todosB.map(b=>[b,b]))},N3.bancos.size===1?[...N3.bancos][0]:"");fb.onchange=()=>{N3.bancos=fb.value?new Set([fb.value]):new Set();render()};
    const L=(l,c)=>el("div",{},el("label",{},l),c);
    return [el("div",{class:"np-pop-form"},L("Cliente",fc),L("Responsável",fr),L("Banco",fb),
      el("div",{style:"display:flex;justify-content:space-between;gap:8px"},NPUI.btn("Limpar",{variante:"ghost",onclick:()=>{limparN3();NPUI.fecharPop();render()}}),NPUI.btn("Fechar",{onclick:()=>NPUI.fecharPop()})))]},{role:"dialog",label:"Mais filtros",alinhar:"dir",refoco:()=>$('#view-negociacoes .np-chipf[aria-haspopup="dialog"]')})});
  mais.setAttribute("aria-haspopup","dialog");mais.setAttribute("aria-expanded","false");
  return {chips,fixos:[mais]};
}
function renderNegociacoesV3(){
  const v=$("#view-negociacoes");v.replaceChildren();v.classList.add("np-v3");N3.obra=null;N3.painel=null;
  if(!garantir()){v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  if(N3.escopo!=="abertas"&&!X.concluidas)X.concluidas=true;
  const base=listaBaseN3();const abertas=base.filter(n=>n.etapa!=="concluido"),concl=base.filter(n=>n.etapa==="concluido");
  const nAtr=abertas.filter(n=>n.atrasada).length,nPar=abertas.filter(paradaN).length;
  const resumo=NPUI.resumo([{n:abertas.length,label:"abertas"},{n:nAtr,label:"atrasadas",tom:nAtr?"crit":"zero"},{n:nPar,label:"paradas",tom:nPar?"att":"zero"},{n:BRL(abertas.reduce((a,n)=>a+(+n.valor_cobrado||0),0)),label:"em valor cobrado"}]);
  const vista=vistaN3();
  const seg=NPUI.seg([["lista","Lista"],["quadro","Quadro"]],vista,k=>{N3.vista=k;NPUI.pref.set("np-neg-vista",k);NPUI.vt(()=>render())});
  const maisAcoes=NPUI.btn("Mais ações",{variante:"ghost",onclick:(e)=>NPUI.pop(e.currentTarget,[{label:"Base de acordos",onclick:()=>irPara("historico")},PP.perfil?.papel==="admin"?{label:"Regras de projeção",onclick:()=>irPara("regras")}:null,PP.perfil?.papel==="admin"?{label:"Calibração",onclick:()=>irPara("calibracao")}:null].filter(Boolean),{label:"Mais ações",alinhar:"dir"})});
  maisAcoes.setAttribute("aria-haspopup","menu");maisAcoes.setAttribute("aria-expanded","false");
  const direita=[seg,maisAcoes,readOnly()?null:NPUI.btn("Nova negociação",{variante:"pri",icone:"mais",onclick:()=>openNegForm(null,{})})];
  const fl=filtrosN3();v.append(NPUI.toolbar({resumo,filtros:fl.chips,filtrosFixos:fl.fixos,direita}));NPUI.reancorarPop();
  const obra=el("div",{class:"np-obra"});N3.obra=obra;
  const lista=filtrarN3(base);
  const corpo=vista==="quadro"?el("div",{class:"np-corpo"},quadroN3(filtrarN3(base).concat(N3.escopo==="abertas"&&X.concluidas?[]:[]))):listaN3(lista);
  const somaC=lista.filter(n=>n.etapa==="concluido").reduce((a,n)=>a+(+n.valor_acordo||0),0);
  corpo.append(NPUI.rodape(`${lista.length} negociaç${lista.length===1?"ão":"ões"} com estes filtros`+(N3.escopo!=="abertas"&&somaC?` · ${BRL(somaC)} em acordos concluídos`:""),[["late","prazo vencido"],["att","parada há 15+ dias"]]));
  obra.append(corpo);v.append(obra);
  N3.painel=NPUI.painel({obra,label:"Detalhe da negociação",onClose:()=>{N3.aberta=null}});
  if(N3.aberta){const n=X.neg.find(x=>x.id===N3.aberta);if(n)abrirPainelN3(n,{silencioso:true});else N3.aberta=null}
}
/* painel: os campos reais do formulário (openNegForm), em leitura; ações = Mover etapa (mesma escrita do kanban), Editar (modal atual), Abrir cliente */
function abrirPainelN3(n,{origem,silencioso}={}){
  N3.aberta=n.id;const c=S.clientes.find(x=>x.id===n.cliente_id)||null;const p=NPUI.prazoTxt(n.prazo);const ab=n.etapa!=="concluido";
  const etapaEl=el("span",{style:"display:inline-flex;gap:8px;align-items:center"},NPUI.etapa(NEG_ETAPAS.map(([k,l])=>({k,label:l})),n.etapa),el("span",{},NEG_LABEL[n.etapa]||n.etapa));
  const trilha=[el("span",{},n.cliente_nome||"Sem cliente"),el("span",{class:"sep"}),el("span",{},n.banco||"banco não informado")];
  const kon=n.contrato_id?(S.contratos||[]).find(k=>k.id===n.contrato_id):null;
  const props=NPUI.props([
    ["Etapa",etapaEl],
    ["Prazo",n.prazo?[p.exata," ",ab&&p.rel?el("span",{class:"np-marca "+tomPrazoN3(n)},p.rel):null,n.atrasada&&ab?[" ",NPUI.marca("vencido","crit")]:null]:"sem prazo","serif"],
    ["Instituição",n.banco||null],["Cliente",c?el("a",{href:"#",onclick:e=>{e.preventDefault();abrirClienteN3(c.id,"negociacoes")}},c.nome):n.cliente_nome||null],
    ["Temperatura",n.temperatura?NPUI.marca(TEMP[n.temperatura].toLowerCase(),TEMP_TOM[n.temperatura]):null],
    ["Responsável",n.responsavel_nome?NPUI.quem(n.responsavel_nome):el("span",{class:"np-sem"},"— ninguém —")],
    ["Situação",n.situacao_processual||null],["Processo",n.numero_processo||null],["Contrato",kon?shortName(kon):null],["Adverso",n.adverso_contato||null],
    paradaN(n)?["Parada",NPUI.marca(`há ${n.dias_parada} dias sem movimentação`,"att")]:null,
  ].filter(x=>x&&(x[1]!=null)));
  /* valores: cobrado × acordo (proposta até a formalização) × alçada; êxito = o percentual gravado nesta negociação (nenhum padrão fixo) */
  const vc=n.valor_cobrado!=null?+n.valor_cobrado:null,va=n.valor_acordo!=null?+n.valor_acordo:null,alc=n.alcada_autorizada!=null?+n.alcada_autorizada:null,pex=n.percentual_exito!=null?+n.percentual_exito:null;
  const emNeg=!NEG_FASE_ACORDO.includes(n.etapa);
  const exito=pex!=null&&vc!=null&&va!=null&&vc>va?(vc-va)*pex/100:null;const desembolso=va!=null?va+(exito||0):null;
  const valores=NPUI.props([
    ["Cobrado",vc!=null?BRL(vc):null,"serif"],
    [emNeg?"Acordo (proposta)":"Acordo",va!=null?[BRL(va),vc&&va<vc?el("small",{style:"margin-left:6px;color:var(--np-ok)"},`−${Math.round((1-va/vc)*100)}% sobre o cobrado`):null,emNeg?el("small",{style:"margin-left:6px;color:var(--np-text-3)"},"ainda em negociação"):null]:null,"serif"],
    ["Alçada",alc!=null?[BRL(alc),desembolso!=null?el("small",{style:"margin-left:6px;color:desembolso>alc?'var(--np-crit)':'var(--np-text-3)'"},desembolso>alc?`acima em ${BRL(desembolso-alc)}`:`dentro (sobra ${BRL(alc-desembolso)})`):null]:null,"serif"],
    ["Êxito",pex!=null?[pex+"%",el("small",{style:"margin-left:6px;color:var(--np-text-3)"},exito!=null?`≈ ${BRL(exito)} sobre a economia`:"sobre a economia (cobrado − acordo)")]:null],
    ["Desembolso",desembolso!=null&&exito!=null?[BRL(desembolso),el("small",{style:"margin-left:6px;color:var(--np-text-3)"},"acordo + êxito")]:null,"serif"],
    ["Data do acordo",n.data_acordo?fmtD(parseD(n.data_acordo)):null],
  ].filter(x=>x[1]!=null));
  const reserva=c?NPUI.props([
    ["Planejada",c.projeto_reserva?RESERVA[c.projeto_reserva]:el("span",{class:"np-sem"},"não iniciada")],
    ["Acumulada",c.reservaAcumulada?[BRL(+c.reservaAcumulada),el("small",{style:"margin-left:6px;color:var(--np-text-3)"},"informada pelo cliente")]:el("span",{class:"np-sem"},"não informada"),"serif"],
  ]):null;
  const corpo=[props,NPUI.secao("Valores",valores.children.length?valores:el("div",{class:"np-sem"},"Sem valores informados")),
    c?NPUI.secao("Reserva financeira do cliente",reserva):null,
    n.proximo_passo?NPUI.secao("Próximo passo",el("div",{style:"white-space:pre-wrap"},n.proximo_passo)):null,
    n.aguardando?NPUI.secao("Aguardando",el("div",{},n.aguardando)):null,
    n.observacoes?NPUI.secao("Observações",el("div",{style:"white-space:pre-wrap"},n.observacoes)):null,
    NPUI.rodape(n.updated_at?"Atualizada em "+fmtD(parseD(n.updated_at.slice(0,10))):"")];
  const btnMover=readOnly()?null:NPUI.btn("Mover etapa…",{variante:"pri",onclick:(e)=>NPUI.pop(e.currentTarget,NEG_ETAPAS.map(([k,l])=>({label:l,atual:n.etapa===k,onclick:()=>moverN3(n,k)})),{label:"Mover etapa"})});
  if(btnMover){btnMover.setAttribute("aria-haspopup","menu");btnMover.setAttribute("aria-expanded","false")}
  const btnEditar=readOnly()?null:NPUI.btn("Editar",{onclick:()=>openNegForm(null,n)});
  const mais=NPUI.btn("Mais ações",{variante:"ghost",onclick:(e)=>NPUI.pop(e.currentTarget,[c?{label:"Abrir cliente",onclick:()=>abrirClienteN3(c.id,"negociacoes")}:null,{label:"Base de acordos",onclick:()=>irPara("historico")}].filter(Boolean),{label:"Mais ações",alinhar:"dir"})});
  mais.setAttribute("aria-haspopup","menu");mais.setAttribute("aria-expanded","false");
  N3.painel.abrir({id:n.id,trilha,titulo:n.titulo||[n.cliente_nome,n.banco].filter(Boolean).join(" | "),corpo,pe:[btnMover,btnEditar,mais],origem:silencioso?null:origem});
}
function abrirClienteN3(cid,sub){S.tab="clientes";S.sel=cid;S.sub=sub||"resumo";try{localStorage.setItem("pp-tab","clientes")}catch(_){}render()}
window.PP_NEG={lista:()=>X.neg,filtro:(f={})=>{limparN3();if(f.cliente!=null)X.fCli=f.cliente;if(f.resp!=null)X.fResp=f.resp;if(f.escopo)N3.escopo=f.escopo;if(f.concluidas!=null)X.concluidas=f.concluidas;if(f.atrasadas!=null)N3.atrasadas=f.atrasadas;if(f.paradas!=null)N3.paradas=f.paradas;if(f.minhas!=null)N3.minhas=f.minhas;if(f.bancos)N3.bancos=new Set(f.bancos);render()},filtroAtual:()=>({cliente:X.fCli,resp:X.fResp,concluidas:X.concluidas,escopo:N3.escopo,atrasadas:N3.atrasadas,paradas:N3.paradas,minhas:N3.minhas,bancos:[...N3.bancos]}),etapas:NEG_ETAPAS};

/* ---------- Integração ---------- */
window.PP_MOD=window.PP_MOD||{};
window.PP_MOD.negociacoes=renderNegCliente;
{const _r=window.PP_MOD.resumo;window.PP_MOD.resumo=(c,host,ind)=>{_r&&_r(c,host,ind);if(readOnly()||S.sub!=="acompanhamento")return;garantir();const card=cardFluxo(c);const first=host.children[0];if(first&&first.nextSibling)host.insertBefore(card,first.nextSibling);else host.append(card);card.after(cardOnboarding(c))}}
{const _c=window.PP_MOD.contagens;window.PP_MOD.contagens=c=>{const r=_c?_c(c):{};if(!readOnly()&&X.ok)r.negociacoes=X.neg.filter(n=>n.cliente_id===c.id&&n.etapa!=="concluido").length;return r}}
{const _r=render;render=function(){_r();const vn=$("#view-negociacoes"),vm=$("#view-monitoramento");if(!vn)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&(S.tab==="negociacoes"||S.tab==="monitoramento"))S.tab="clientes";vn.hidden=S.tab!=="negociacoes";vm.hidden=S.tab!=="monitoramento";if(S.tab==="negociacoes")renderNegociacoes();if(S.tab==="monitoramento")renderMonitoramento()}}
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("fluxo");for(const t of ["negociacoes","monitoramentos"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>recarregar());ch.subscribe()}});
})();
