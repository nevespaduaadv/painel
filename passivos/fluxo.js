/* Fluxo do cliente PJ, negociações (kanban de acordos) e monitoramento processual — espelho da operação do Notion.
   Supabase: clientes.etapa_fluxo/flags (0010), negociacoes, monitoramentos, v_negociacoes, v_monitoramentos.
   Carregado depois de ficha.js. Tudo aqui é só da equipe: o cliente nunca vê negociação nem monitoramento. */
(()=>{
"use strict";
const ETAPAS=["Contrato fechado / entrada paga","Cadastro no ADVBOX","Formulário de mapeamento enviado (D0)","Formulário preenchido","Auditoria de onboarding","Onboarding agendado (R1)","R1 realizada — Conexão","R2 realizada — Verificação","R3 realizada — Complemento","R4 realizada — Ciclo encerrado","Ciclo padrão mensal"];
const NEG_ETAPAS=[["iniciar","Iniciar acompanhamento"],["extrajudicial","Negociação extrajudicial"],["pos_judicializacao","Acordo após judicialização"],["minuta","Elaboração de minuta"],["formalizado","Acordo formalizado"],["pagamento_pendente","Pagamento pendente"],["concluido","Concluído"]];
const NEG_LABEL=Object.fromEntries(NEG_ETAPAS);
const TEMP={frio:"Frio",morno:"Morno",quente:"Quente"},TEMP_CLS={frio:"c",morno:"e2",quente:"e3"};
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
      c.projeto_reserva?el("span",{class:"pill "+(c.projeto_reserva==="formada"?"e1":"g")},"Reserva: "+RESERVA[c.projeto_reserva]):null,c.regua?el("span",{class:"pill g"},"Régua "+REGUA[c.regua].split(" ")[0]):null,c.servico?el("span",{class:"pill c"},SERVICO[c.servico]):null),
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
        onb=colabSel(c.responsavel_onboarding_id,"— responsável pelo onboarding —"),url=inp("url",c.notion_url||"",{placeholder:"https://www.notion.so/…"});
  const body=el("div",{class:"form"},field("fl-et","Etapa do fluxo PJ",et,"Só avance quando a etapa anterior estiver 100% cumprida."),field("fl-st","Status",st),field("fl-div","Tem dívida em atraso?",div,"Sim → abre automaticamente o acompanhamento no setor de acordos."),field("fl-adi","Honorários em dia?",adi),field("fl-pro","Possui processos ajuizados?",pro),
    field("fl-res","Projeto de reserva",res,"Sem reserva não há poder de negociação. Verificar a partir da R2."),field("fl-reg","Régua de relacionamento",reg,"Bronze: silêncio de 3 dias já é risco. Prata: 20. Ouro: 45."),field("fl-srv","Serviço",srv),field("fl-onb","Responsável pelo onboarding",onb),field("fl-url","Card no Notion",url),field("fl-tip","Tipos de contratos / dívidas",tip));
  modal("Fluxo do cliente PJ",body,async()=>{
    const cols={etapa_fluxo:et.value===""?null:+et.value,status:st.value,tem_divida_atraso:triVal(div),adimplente:triVal(adi),possui_processos:triVal(pro),projeto_reserva:res.value||null,regua:reg.value||null,servico:srv.value||null,tipos_dividas:tip.value.trim()||null,responsavel_onboarding_id:onb.value||null,notion_url:url.value.trim()||null};
    const {error}=await SB.from("clientes").update(cols).eq("id",c.id);if(error)throw new Error("Não foi possível salvar: "+(error.message||""));
    toast("Fluxo salvo");notificar("clientes");recarregar();
  });
}

/* ---------- Negociações ---------- */
function negCard(n,compacto){
  const parada=n.dias_parada>15&&n.etapa!=="concluido";
  const mover=sel(Object.fromEntries(NEG_ETAPAS),n.etapa);mover.className="";mover.style.cssText="font-size:12px;padding:3px 6px;width:100%";
  mover.onchange=async()=>{const {error}=await SB.from("negociacoes").update({etapa:mover.value}).eq("id",n.id);if(error)toast("Não foi possível mover");else{toast(NEG_LABEL[mover.value]);recarregar()}};
  mover.onclick=e=>e.stopPropagation();
  return el("div",{class:"card",style:`padding:10px 12px;cursor:pointer;border-left:3px solid ${n.atrasada?"var(--crit)":parada?"var(--warn)":"var(--line)"}`,onclick:()=>openNegForm(null,n)},
    compacto?null:el("div",{style:"font-weight:700"},n.cliente_nome),
    el("div",{style:"font-size:13px"},n.titulo),
    el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"},n.banco?el("span",{class:"pill g"},n.banco):null,n.temperatura?el("span",{class:"pill "+TEMP_CLS[n.temperatura]},TEMP[n.temperatura]):null,n.situacao_processual?el("span",{class:"pill c"},n.situacao_processual):null),
    (n.valor_acordo||n.valor_cobrado||n.alcada_autorizada)?el("div",{class:"note num"},[n.valor_cobrado?`cobrado ${BRL(+n.valor_cobrado)}`:null,n.valor_acordo?`acordo ${BRL(+n.valor_acordo)}`:null,n.alcada_autorizada?`alçada ${BRL(+n.alcada_autorizada)}`:null].filter(Boolean).join(" · ")):null,
    n.proximo_passo?el("div",{class:"note",style:"margin-top:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden"},n.proximo_passo):null,
    n.aguardando?el("div",{class:"note"},el("b",{},"Aguardando: "),n.aguardando):null,
    el("div",{style:"margin-top:6px;font-size:12px;color:var(--muted)"},n.responsavel_nome||"sem responsável",n.prazo?el("span",{style:n.atrasada?"color:var(--crit);font-weight:700":""}," · prazo "+fmtD(parseD(n.prazo))):null,parada?` · parada há ${n.dias_parada}d`:null),compacto?null:el("div",{style:"margin-top:6px"},mover));
}
function renderNegociacoes(){
  const v=$("#view-negociacoes");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Acordos"),el("h1",{},"Negociações"),el("div",{class:"sub"},"Kanban do setor de acordos: uma negociação por banco/contrato, da abertura ao acordo concluído. Clique no card para editar; mude a etapa no seletor.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:()=>openNegForm(null,{})},"+ Negociação"))));
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
  v.append(el("div",{style:"display:grid;grid-template-columns:repeat("+cols.length+",minmax(185px,1fr));gap:10px;overflow-x:auto;align-items:start"},cols.map(([k,l])=>{
    const its=lista.filter(n=>n.etapa===k);
    return el("div",{style:"display:flex;flex-direction:column;gap:8px;min-width:185px"},el("div",{style:"display:flex;justify-content:space-between;align-items:center;padding:4px 2px;border-bottom:2px solid var(--gold)"},el("b",{style:"font-size:13px"},l),el("span",{class:"pill g"},String(its.length))),
      its.length?its.map(n=>negCard(n,false)):el("div",{class:"note",style:"padding:8px 2px"},"—"));
  })));
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
  const body=el("div",{class:"form"},field("ng-cli","Cliente",cli),el("div",{class:"f"},el("label",{},"Contrato relacionado"),konWrap),field("ng-tit","Título",tit),el("div",{class:"f"},el("label",{for:"ng-banco"},"Banco"),el("div",{},Object.assign(banco,{id:"ng-banco"}),bdl)),
    field("ng-et","Etapa",et),field("ng-temp","Temperatura",temp),el("div",{class:"f"},el("label",{for:"ng-sit"},"Situação processual"),el("div",{},Object.assign(sit,{id:"ng-sit"}),sdl)),field("ng-npr","Nº do processo",npr),field("ng-resp","Responsável",resp),field("ng-adv","Escritório adverso / contato",adv),
    field("ng-vc","Valor cobrado (R$)",vc),field("ng-va","Valor do acordo (R$)",va),field("ng-alc","Alçada autorizada pelo cliente (R$)",alc),field("ng-da","Data do acordo",da),field("ng-pz","Prazo",pz),field("ng-ag","Aguardando",ag),field("ng-pp","Próximo passo",pp),field("ng-obs","Observações",obs));
  const extra=n.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta negociação?"))return;await SB.from("negociacoes").delete().eq("id",n.id);$("#modalHost").replaceChildren();toast("Negociação excluída");recarregar()}},"Excluir"):null;
  modal(n.id?"Editar negociação":"Nova negociação",body,async()=>{
    if(!cli.value)throw new Error("Escolha o cliente");
    const titulo=tit.value.trim()||[nomeCli(cli.value),banco.value.trim()].filter(Boolean).join(" | ");
    const row={cliente_id:cli.value,contrato_id:kon.value||null,titulo,banco:banco.value.trim()||null,etapa:et.value,temperatura:temp.value||null,situacao_processual:sit.value.trim()||null,numero_processo:npr.value.trim()||null,responsavel_id:resp.value||null,adverso_contato:adv.value.trim()||null,
      valor_cobrado:vc.value===""?null:+vc.value,valor_acordo:va.value===""?null:+va.value,alcada_autorizada:alc.value===""?null:+alc.value,data_acordo:da.value||null,prazo:pz.value||null,aguardando:ag.value.trim()||null,proximo_passo:pp.value.trim()||null,observacoes:obs.value.trim()||null};
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

/* ---------- Integração ---------- */
window.PP_MOD=window.PP_MOD||{};
window.PP_MOD.negociacoes=renderNegCliente;
{const _r=window.PP_MOD.resumo;window.PP_MOD.resumo=(c,host,ind)=>{_r&&_r(c,host,ind);if(readOnly())return;garantir();const card=cardFluxo(c);const first=host.children[0];if(first&&first.nextSibling)host.insertBefore(card,first.nextSibling);else host.append(card)}}
{const _c=window.PP_MOD.contagens;window.PP_MOD.contagens=c=>{const r=_c?_c(c):{};if(!readOnly()&&X.ok)r.negociacoes=X.neg.filter(n=>n.cliente_id===c.id&&n.etapa!=="concluido").length;return r}}
{const _r=render;render=function(){_r();const vn=$("#view-negociacoes"),vm=$("#view-monitoramento");if(!vn)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&(S.tab==="negociacoes"||S.tab==="monitoramento"))S.tab="clientes";vn.hidden=S.tab!=="negociacoes";vm.hidden=S.tab!=="monitoramento";if(S.tab==="negociacoes")renderNegociacoes();if(S.tab==="monitoramento")renderMonitoramento()}}
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("fluxo");for(const t of ["negociacoes","monitoramentos"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>recarregar());ch.subscribe()}});
})();
