/* Módulo Equipe (colaboradores — RH básico). Supabase: colaboradores, v_colaboradores, v_perfis_sem_colaborador.
   Carregado depois de tarefas.js; usa os utilitários globais do painel. Cadastro: admin; leitura: equipe. */
(()=>{
"use strict";
const NUCLEOS={juridico:"Jurídico",acordos:"Acordos",acompanhamento_pj:"Acompanhamento PJ",pos_vendas:"Pós-vendas",comercial:"Comercial",marketing:"Marketing",administrativo:"Administrativo",rh:"RH",socios:"Sócios"};
const PAPEIS={admin:"Administrador",colaborador:"Colaborador"};
const E={lista:[],semColab:[],ok:false,carregando:false,mostrarInativos:false};
const horasFmt=h=>{h=+h||0;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};
const admin=()=>PP.perfil?.papel==="admin";

async function carregar(){
  if(E.carregando)return;E.carregando=true;
  try{
    const [c,p]=await Promise.all([SB.from("v_colaboradores").select("*").order("ativo",{ascending:false}).order("nome"),admin()?SB.from("v_perfis_sem_colaborador").select("*").order("email"):{data:[]}]);
    if(c.error)throw c.error;E.lista=c.data;E.semColab=p.data||[];E.ok=true;
  }catch(e){console.warn("equipe",e);toast("Não foi possível carregar a equipe")}
  finally{E.carregando=false}
  render();
}
const garantir=()=>{if(!E.ok&&!E.carregando)carregar();return E.ok};
function csv(nome,linhas,colunas){
  const esc=v=>{if(v==null)return"";v=String(v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const txt="﻿"+[colunas.join(";"),...linhas.map(l=>colunas.map(c=>esc(l[c])).join(";"))].join("\r\n");
  const a=el("a",{href:URL.createObjectURL(new Blob([txt],{type:"text/csv;charset=utf-8"})),download:nome+".csv"});document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
const check=(label,checked)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;return {wrap:el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},i,label)),input:i}};

/* ---------- V11 (início) · Cargos funcionais em V3.1 — depende da migração 0113 (cargos, ocupações, filas) ----------
   Pessoas ocupam cargos; cargos têm permissões e responsabilidades; cada ação guarda o autor individual.
   Nesta etapa: lista de cargos, painel, designar pessoa (titular ou substituto) e encerrar ocupação — pelas funções do banco
   (cargo_designar, cargo_encerrar), que conferem a permissão. Onde a 0113 não existe, a tela diz isso e não oferece ação. */
const eqV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const K={aba:"pessoas",ok:false,carregando:false,erro:null,instalada:true,cargos:[],div:[],pend:[],hist:{},ant:{},aberta:null,fila:null,painel:null};
const hojeISO=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"});
const afastadoHoje=o=>!!o.afastado_de&&hojeISO()>=o.afastado_de&&(!o.afastado_ate||hojeISO()<=o.afastado_ate);
/* Nomenclatura: "titular" e "substituto" só em cargo de coordenação; em cargo operacional, todos são "ocupantes". */
const rotOc=(g,o)=>(g.modalidade==="operacional"?"ocupante":o.tipo==="substituto"?"substituto":"titular")+(o.principal?" · cargo principal da pessoa":"");
const MODAL_L={coordenacao:"Coordenação — um titular e, se houver, um substituto",operacional:"Operacional — um ou vários ocupantes ao mesmo tempo"};
const filaDe=g=>K.pend.filter(x=>x.cargo_id===g.id||(x.cargo_id==null&&x.cargo===g.nome&&x.na_fila));
const orfas=()=>K.pend.filter(x=>!x.na_fila).slice().sort((a,b)=>(b.fatal-a.fatal)||String(a.prazo||"9999").localeCompare(String(b.prazo||"9999")));
const fataisDe=g=>filaDe(g).filter(x=>x.fatal).length;
const elegiveis=g=>(g.ocupantes||[]).filter(o=>!o.pendencia&&!afastadoHoje(o));
const NUC_L={...NUCLEOS,financeiro:"Financeiro"};
const AREAS_L={clientes:"Clientes",juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",equipe:"Equipe",growth:"Growth",atendimento:"Atendimento",superendividamento:"Superendividamento",ferramentas:"Ferramentas",tarefas_equipe:"Tarefas da equipe",protecao:"Proteção patrimonial"};
const dataBR=iso=>iso?new Date(iso).toLocaleDateString("pt-BR"):"—";
async function carregarCargos(){
  if(K.carregando)return;K.carregando=true;
  try{
    const a=await SB.from("v_cargos").select("*").order("nome");
    if(a.error){if(/42P01|PGRST205|does not exist|not find/i.test((a.error.code||"")+" "+(a.error.message||""))){K.instalada=false;K.cargos=[];K.ok=true;K.erro=null;return}throw a.error}
    const d=await SB.from("v_cargos_divergencias").select("*");
    /* fila de distribuição: o que está com a fila de um cargo, sem pessoa. Prazo fatal vem da própria tarefa. */
    const f=await SB.from("v_distribuicao_pendente").select("tabela,registro,descricao,cliente_id,prazo,prioridade,cargo_id,cargo,created_at");
    let pend=(f.data||[]).map(x=>({...x,na_fila:!!(x.cargo_id||x.cargo),fatal:false}));
    const ids=pend.filter(x=>x.tabela==="tarefas").map(x=>x.registro).slice(0,300);
    if(ids.length){const t=await SB.from("tarefas").select("id,prazo_fatal,hora").in("id",ids);const m=new Map((t.data||[]).map(x=>[String(x.id),x]));pend=pend.map(x=>({...x,fatal:!!m.get(x.registro)?.prazo_fatal,hora:m.get(x.registro)?.hora||null}))}
    K.pend=pend;K.instalada=true;K.cargos=a.data||[];K.div=d.data||[];K.ok=true;K.erro=null;if(!E.ok&&!E.carregando)carregar();
  }catch(e){console.warn("cargos",e);K.erro=e}
  finally{K.carregando=false;render()}
}
const recarregarCargos=()=>{K.ok=false;K.erro=null;K.hist={};K.ant={};carregarCargos()};
const grupoK=g=>!g.ativo?"inativo":g.vago?"vago":(g.ocupantes||[]).some(o=>o.pendencia)||g.titular_afastado?"pend":"ok";
function linhaK(g){
  const oc=g.ocupantes||[],m=[];
  if(g.ativo&&g.vago)m.push(NPUI.marca("vago","crit"));
  const nFat=fataisDe(g);
  if(nFat)m.push(el("button",{type:"button",class:"np-marca crit np-fila-b",title:"Abrir as atividades com prazo fatal que aguardam distribuição",onclick:e=>{e.stopPropagation();abrirFila(g)}},`${nFat} com prazo fatal na fila`));
  if(+g.na_fila)m.push(el("button",{type:"button",class:"np-marca att np-fila-b",title:"Abrir as atividades na fila do cargo, sem pessoa atribuída",onclick:e=>{e.stopPropagation();abrirFila(g)}},`${g.na_fila} na fila`));
  if(oc.some(o=>o.pendencia))m.push(NPUI.marca("pendência","att"));
  const quem=oc.filter(o=>o.tipo==="titular").slice(0,3).map(o=>NPUI.quem(o.nome));
  if(oc.some(afastadoHoje))m.push(NPUI.marca("afastamento em curso","att"));
  const ctx=[NUC_L[g.nucleo]||g.nucleo||"sem núcleo",g.modalidade==="operacional"?"operacional · "+(oc.length===1?"1 ocupante":oc.length+" ocupantes")+" · "+(g.distribuicao==="rodizio"?"rodízio":"fila"):"coordenação"+(oc.some(o=>o.tipo==="substituto")?" · com substituto":""),`${(g.acessos||[]).length} ${(g.acessos||[]).length===1?"área":"áreas"} de acesso`,+g.tarefas_abertas?`${g.tarefas_abertas} tarefa(s) aberta(s)`:null].filter(Boolean).join(" · ");
  return NPUI.linha({id:g.id,regua:nFat?"fatal":g.ativo&&g.vago?"late":+g.na_fila?"att":null,atual:K.aberta===g.id,riscado:!g.ativo,titulo:g.nome,contexto:ctx,direita:[...m,...quem,oc.filter(o=>o.tipo==="titular").length>3?el("span",{class:"np-sem"},"+"+(oc.filter(o=>o.tipo==="titular").length-3)):null,!oc.length&&g.ativo?el("span",{class:"np-sem"},"— ninguém —"):null],titleAbrir:"Abrir o cargo",onOpen:li=>abrirCargo(g,{origem:li.querySelector(".np-it-abrir")})});
}
function renderCargosV3(v){
  K.painel=null;
  if(K.erro&&!K.carregando){v.append(NPUI.faixaErro({texto:"Não foi possível carregar os cargos. Confira a conexão.",onAcao:recarregarCargos}));return}
  if(!K.ok){if(!K.carregando)carregarCargos();v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(6));return}
  if(!K.instalada){v.append(NPUI.vazio({titulo:"Cargos funcionais ainda não instalados neste ambiente",texto:"A gestão por cargos depende da migração 0113, que ainda não foi aplicada aqui. Até lá, os acessos continuam sendo definidos por pessoa, em Pessoas."}));return}
  const at=K.cargos.filter(g=>g.ativo),nV=at.filter(g=>g.vago).length,nF=at.reduce((a,g)=>a+(+g.na_fila||0),0),nP=new Set(at.flatMap(g=>(g.ocupantes||[]).map(o=>o.colaborador_id))).size;
  v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:at.length,label:at.length===1?"cargo ativo":"cargos ativos"},{n:nP,label:nP===1?"pessoa em cargo":"pessoas em cargos"},{n:nV,label:nV===1?"cargo vago":"cargos vagos",tom:nV?"crit":"zero"},{n:nF,label:"na fila, sem pessoa",tom:nF?"att":"zero"},orfas().length?{n:orfas().length,label:"sem responsável e sem cargo",tom:orfas().some(x=>x.fatal)?"crit":"att"}:null,K.div.length?{n:K.div.length,label:"acesso divergente do cargo",tom:"crit"}:null]),
    direita:[NPUI.btn("Atualizar",{onclick:recarregarCargos}),admin()&&!(typeof readOnly==="function"&&readOnly())?NPUI.btn("Novo cargo",{variante:"pri",onclick:()=>editarCargo(null)}):null].filter(Boolean)}));
  const obra=el("div",{class:"np-obra"}),corpo=el("div",{class:"np-corpo"});
  if(K.div.length)corpo.append(el("div",{class:"np-erro",role:"alert"},el("i",{},`${K.div.length} pessoa(s) com acessos gravados diferentes dos acessos dos cargos que ocupam: `+K.div.map(d=>d.nome).join(", ")+".")));
  const comFatal=at.map(g=>[g,fataisDe(g)]).filter(x=>x[1]);
  if(comFatal.length)corpo.append(el("div",{class:"np-erro np-fila-fatal",role:"alert"},el("span",{},el("i",{},`${comFatal.reduce((a,x)=>a+x[1],0)} atividade(s) com prazo fatal aguardam distribuição, sem pessoa atribuída: `),...comFatal.flatMap(([g,n],i)=>[i?", ":"",el("button",{type:"button",class:"lnk",onclick:()=>abrirFila(g)},`${g.nome} (${n})`+(g.vago?" — cargo vago":""))]),".")));
  if(!K.cargos.length)corpo.append(NPUI.vazio({titulo:"Nenhum cargo cadastrado",texto:"Crie o primeiro cargo para começar a distribuir responsabilidades por função.",acao:admin()?"Novo cargo":null,onAcao:()=>editarCargo(null)}));
  else{for(const [k,l,tom] of [["vago","Vagos","crit"],["pend","Com pendência","att"],["ok","Ocupados",""],["inativo","Inativos",""]]){const its=K.cargos.filter(g=>grupoK(g)===k);if(its.length)corpo.append(NPUI.grupo({id:"cargo-"+k,titulo:l,n:its.length,tom,aberto:k!=="inativo",itens:its.map(linhaK)}))}
    const of=orfas();
    if(of.length)corpo.append(NPUI.grupo({id:"cargo-orfas",titulo:"Atividades sem responsável e sem cargo",n:of.length,tom:of.some(x=>x.fatal)?"crit":"att",aberto:of.some(x=>x.fatal),itens:of.slice(0,200).map(x=>NPUI.linha({id:"orf-"+x.registro,regua:x.fatal?"fatal":null,prazo:x.prazo?NPUI.prazoTxt(String(x.prazo).slice(0,10),x.hora):null,titulo:x.descricao||"Atividade",contexto:[x.tabela==="monitoramentos"?"Monitoramento":"Tarefa",nomeCliK(x.cliente_id)].join(" · "),direita:[x.fatal?NPUI.marca("prazo fatal","crit"):null,NPUI.marca("sem responsável","att")],titleAbrir:x.tabela==="tarefas"?"Abrir a tarefa":"Atividade sem responsável",onOpen:()=>{if(x.tabela==="tarefas")window.PP_TAREFAS?.abrir?.(x.registro)}}))}));
    corpo.append(NPUI.rodape(`${K.cargos.length} ${K.cargos.length===1?"cargo":"cargos"}`,[["fatal","prazo fatal na fila"],["late","cargo vago"],["att","há itens na fila do cargo"]]))}
  obra.append(corpo);v.append(obra);
  K.painel=NPUI.painel({obra,label:"Detalhe do cargo",onClose:()=>{K.aberta=null;K.fila=null}});
  if(K.aberta){const g=K.cargos.find(x=>x.id===K.aberta);if(g){if(K.fila===g.id)abrirFila(g,{silencioso:true});else abrirCargo(g,{silencioso:true})}else{K.aberta=null;K.fila=null}}
}
async function carregarHist(g){const {data}=await SB.from("cargo_ocupacoes").select("id,colaborador_id,tipo,inicio,fim,motivo,motivo_fim").eq("cargo_id",g.id).not("fim","is",null).order("fim",{ascending:false}).limit(20);K.hist[g.id]=data||[];if(K.aberta===g.id)render()}
function abrirCargo(g,{origem}={}){
  K.aberta=g.id;K.fila=null;if(!K.painel)return;const adm=admin()&&!(typeof readOnly==="function"&&readOnly()),oc=g.ocupantes||[];
  if(!K.hist[g.id]){K.hist[g.id]=null;carregarHist(g)}
  const props=NPUI.props([["Situação",[NPUI.marca(!g.ativo?"inativo":g.vago?"vago":"ocupado",!g.ativo?"":g.vago?"crit":"ok"),+g.na_fila?[" ",el("button",{type:"button",class:"np-marca att np-fila-b",title:"Abrir a fila do cargo",onclick:()=>abrirFila(g)},`${g.na_fila} na fila do cargo`)]:null,fataisDe(g)?[" ",NPUI.marca(`${fataisDe(g)} com prazo fatal`,"crit")]:null]],
    ["Núcleo / frente",[NUC_L[g.nucleo]||g.nucleo,g.frente].filter(Boolean).join(" · ")||null],
    ["Modalidade",g.modalidade==="operacional"?"Operacional — um ou vários ocupantes ao mesmo tempo; distribuição por "+(g.distribuicao==="rodizio"?"rodízio (o próximo da ordem recebe)":"fila (ninguém recebe automaticamente)"):"Coordenação — um titular e, se houver, um substituto"],
    ["Responde por",[g.responsavel_nucleo?"o núcleo":null,g.responsavel_frente?"a frente":null].filter(Boolean).join(" e ")||null],
    ["Acessos do cargo",(g.acessos||[]).length?(g.acessos||[]).map(a=>AREAS_L[a]||a).join(", "):"nenhum"],
    ["Responsabilidades",g.responsabilidades||null],["Em aberto",`${g.tarefas_abertas||0} tarefa(s) · ${g.monitoramentos||0} monitoramento(s)`]].filter(x=>x[1]!=null));
  const lista=oc.length?el("ul",{class:"np-cargo-oc"},oc.map(o=>el("li",{},el("div",{class:"q"},NPUI.quem(o.nome)," ",NPUI.marca(rotOc(g,o),""),o.pendencia?[" ",Object.assign(NPUI.marca("pendência","att"),{title:o.pendencia})]:null,o.afastado_de?[" ",NPUI.marca((afastadoHoje(o)?"afastado(a) desde ":"afastamento programado: ")+dataBR(o.afastado_de+"T12:00:00")+(o.afastado_ate?" a "+dataBR(o.afastado_ate+"T12:00:00"):" (sem data de volta)"),"att")]:null),
      el("div",{class:"d"},"desde "+dataBR(o.inicio)+(+o.tarefas_abertas?` · ${o.tarefas_abertas} tarefa(s) do cargo`:"")+(g.modalidade==="operacional"&&g.distribuicao==="rodizio"?` · ${oc.indexOf(o)+1}º no rodízio`:"")),adm?el("div",{class:"ac"},NPUI.btn("Encerrar ocupação",{variante:"ghost",onclick:()=>encerrarOcupacao(g,o)}),NPUI.btn(o.afastado_de?"Alterar afastamento":"Registrar afastamento",{variante:"ghost",onclick:()=>afastar(g,o)}),g.modalidade==="operacional"&&g.distribuicao==="rodizio"&&oc.length>1?NPUI.btn("Ordem no rodízio",{variante:"ghost",onclick:()=>ordemRodizio(g,o)}):null):null)))
    :el("p",{class:"np-nota"},g.modalidade==="operacional"?"Ninguém ocupa este cargo. O que chega vai para a fila do cargo, visível à gestão, sem ser atribuído a alguém.":"Ninguém ocupa este cargo.");
  const h=K.hist[g.id];
  const hist=NPUI.secao("Histórico de ocupações",h==null?NPUI.carregando(2):h.length?NPUI.passos(h.map(x=>({estado:"ok",el:el("span",{},el("b",{},(E.lista.find(c=>c.id===x.colaborador_id)||{}).nome||"pessoa")," · "+(g.modalidade==="operacional"?"ocupante":x.tipo==="substituto"?"substituto":"titular")+" · "+dataBR(x.inicio)+" a "+dataBR(x.fim)),sub:x.motivo_fim?["Motivo do encerramento: "+x.motivo_fim]:null}))):el("p",{class:"np-nota"},"Nenhuma ocupação encerrada."));
  K.painel.abrir({trilha:[el("span",{},"Cargo"),el("span",{class:"sep"}),el("span",{},g.codigo)],titulo:g.nome,corpo:[props,NPUI.secao(`Ocupantes (${oc.length})`,lista),hist],pe:[adm&&g.ativo?NPUI.btn("Designar pessoa",{variante:"pri",cls:"np-pri-local",onclick:()=>designar(g)}):null,+g.na_fila?NPUI.btn(`Ver a fila (${g.na_fila})`,{onclick:()=>abrirFila(g)}):null,adm?NPUI.btn("Editar cargo",{variante:"ghost",onclick:()=>editarCargo(g)}):null].filter(Boolean),origem,id:g.id});
}
function designar(g){
  const oc=g.ocupantes||[],ja=new Set(oc.map(o=>o.colaborador_id));
  const pes=sel({"":"— escolha —",...Object.fromEntries(E.lista.filter(c=>c.ativo!==false&&!ja.has(c.id)).map(c=>[c.id,c.nome+(c.perfil_id?"":" (sem login)")]))},"");
  const op=g.modalidade==="operacional";
  const tipo=sel(op?{titular:"Ocupante (atua junto com os demais)"}:{titular:"Titular",substituto:"Substituto (assume quando o titular está afastado)"},"titular"),princ=sel({"":"Manter como está","sim":"Sim — este passa a ser o cargo principal da pessoa","nao":"Não — é uma ocupação adicional"},""),mot=inp("text","",{placeholder:"Ex.: assume a carteira a partir de 24/11"});
  const sub=sel({"":"— não substitui ninguém —",...Object.fromEntries(oc.filter(o=>o.tipo==="titular").map(o=>[o.colaborador_id,o.nome]))},"");
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`Cargo: ${g.nome}. Os acessos e as responsabilidades passam a valer para a pessoa pela ocupação; o que ela fizer continua registrado em nome dela.`),
    field("cg-pes","Pessoa",pes,"Pessoa sem login pode ser designada, mas não recebe distribuição automática."),field("cg-tipo","Como",tipo,op?"Cargo operacional não tem titular nem substituto: todos os ocupantes atuam ao mesmo tempo.":null),field("cg-princ","É o cargo principal desta pessoa?",princ,"Cada pessoa tem um cargo principal; os demais são ocupações adicionais."),g.modalidade!=="operacional"&&oc.some(o=>o.tipo==="titular")?field("cg-sub","Substitui quem",sub,"Em cargo de coordenação, o titular anterior é encerrado e a carteira acompanha."):null,field("cg-mot","Motivo",mot));
  modal("Designar pessoa para o cargo",body,async()=>{
    if(!pes.value)throw new Error("Escolha a pessoa.");if(mot.value.trim().length<5)throw new Error("Informe o motivo.");
    const {error}=await SB.rpc("cargo_designar",{p_cargo:g.id,p_colab:pes.value,p_tipo:tipo.value,p_motivo:mot.value.trim(),p_principal:princ.value==="sim"?true:princ.value==="nao"?false:null,p_substitui:sub.value||null});
    if(error)throw new Error(error.message||"Não foi possível designar");toast("Pessoa designada");recarregarCargos()});
  botaoModal("Designar");
}
function encerrarOcupacao(g,o){
  const outros=elegiveis(g).filter(x=>x.ocupacao_id!==o.ocupacao_id&&x.tipo==="titular");
  const mot=inp("text","",{placeholder:"Ex.: mudança de função"}),para=sel({"":g.modalidade==="operacional"?"— fila do cargo (ninguém recebe automaticamente) —":"— acompanha o ocupante efetivo —",...Object.fromEntries(outros.map(x=>[x.colaborador_id,x.nome]))},"");
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`${o.nome} deixa de ocupar ${g.nome}. Os acessos exclusivos deste cargo deixam de valer para a pessoa na hora; os acessos de outros cargos que ela ocupa continuam. Nenhuma tarefa é apagada, e o histórico e a autoria do que ela fez são preservados.`+(+o.tarefas_abertas?` Ela tem ${o.tarefas_abertas} tarefa(s) aberta(s) deste cargo.`:"")),
    g.modalidade==="operacional"&&+o.tarefas_abertas?field("ce-para","Carteira aberta vai para",para):null,field("ce-mot","Motivo",mot));
  modal("Encerrar ocupação",body,async()=>{
    if(mot.value.trim().length<5)throw new Error("Informe o motivo.");
    const {error}=await SB.rpc("cargo_encerrar",{p_ocupacao:o.ocupacao_id,p_motivo:mot.value.trim(),p_para:para.value||null});
    if(error)throw new Error(error.message||"Não foi possível encerrar");toast("Ocupação encerrada");recarregarCargos()});
  botaoModal("Encerrar ocupação");
}
/* ---- afastamento, rodízio, criar e editar cargo, fila de distribuição ---- */
function botaoModal(t){const b=$("button.np-f-salvar")||$("#modalHost button.btn.primary");if(b)b.textContent=t}
function afastar(g,o){
  const de=inp("date",o.afastado_de||""),ate=inp("date",o.afastado_ate||"");
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`${o.nome} continua ocupando ${g.nome}, mas não recebe distribuições novas no período.`+(g.modalidade==="operacional"?" As atividades vão para os demais ocupantes ou para a fila do cargo.":" O substituto, se houver, assume as distribuições novas; sem substituto, elas ficam na fila do cargo, visíveis à gestão.")+" Deixe as duas datas em branco para encerrar o afastamento."),
    field("ca-de","Afastada(o) a partir de",de),field("ca-ate","Até (em branco = sem data de volta)",ate));
  modal(o.afastado_de?"Alterar afastamento":"Registrar afastamento",body,async()=>{
    if(!de.value&&ate.value)throw new Error("Informe a data de início do afastamento.");if(de.value&&ate.value&&ate.value<de.value)throw new Error("A volta não pode ser antes do início.");
    const {error}=await SB.rpc("cargo_afastar",{p_ocupacao:o.ocupacao_id,p_de:de.value||null,p_ate:ate.value||null});
    if(error)throw new Error(error.message||"Não foi possível registrar");toast(de.value?"Afastamento registrado":"Afastamento encerrado");recarregarCargos()});
  botaoModal("Salvar afastamento");
}
function ordemRodizio(g,o){
  const oc=g.ocupantes||[],atual=oc.indexOf(o),pos=sel(Object.fromEntries(oc.map((_,i)=>[String(i),`${i+1}º`])),String(Math.max(atual,0)));
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`No rodízio, cada atividade nova do cargo ${g.nome} vai para a próxima pessoa da ordem. Ordem atual: `+oc.map((x,i)=>`${i+1}º ${x.nome}`).join(", ")+"."),field("cr-pos",`Posição de ${o.nome}`,pos));
  modal("Ordem no rodízio",body,async()=>{const nova=oc.filter(x=>x!==o);nova.splice(+pos.value,0,o);
    for(let i=0;i<nova.length;i++){if((+nova[i].ordem||0)===i+1)continue;const {error}=await SB.rpc("cargo_ordem",{p_ocupacao:nova[i].ocupacao_id,p_ordem:i+1});if(error)throw new Error(error.message||"Não foi possível salvar")}
    toast("Ordem atualizada");recarregarCargos()});
  botaoModal("Salvar ordem");
}
function editarCargo(g){
  const n=!g;g=g||{ativo:true,modalidade:"coordenacao",distribuicao:"fila",acessos:[]};
  const nome=inp("text",g.nome||"",{placeholder:"Ex.: Responsável Jurídico"}),cod=inp("text",g.codigo||"",{placeholder:"gerado a partir do nome"}),nuc=sel({"":"— nenhum —",...NUCLEOS,financeiro:"Financeiro"},g.nucleo||""),fr=sel({"":"— nenhuma —",estrategico:"Estratégico / Consultivo",juridico:"Jurídico / Contencioso",negocial:"Negocial / Acordos"},g.frente||"");
  const mod=sel(MODAL_L,g.modalidade||"coordenacao"),dist=sel({fila:"Fila — a gestão distribui; ninguém recebe automaticamente",rodizio:"Rodízio — a próxima pessoa da ordem recebe"},g.distribuicao||"fila");
  const rn=check("Responde pelo núcleo",!!g.responsavel_nucleo,"Só cargo de coordenação. Um cargo por núcleo."),rf=check("Responde pela frente",!!g.responsavel_frente,"Só cargo de coordenação. Um cargo por frente."),ativo=check("Cargo ativo",g.ativo!==false),resp=el("textarea",{placeholder:"O que este cargo responde no dia a dia."},g.responsabilidades||"");
  const ac=Object.entries(AREAS_L).map(([k,l])=>[k,check(l,(g.acessos||[]).includes(k))]);
  if(!n)cod.disabled=true;
  const slug=t=>t.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40);
  if(n)nome.addEventListener("input",()=>{if(!cod.dataset.mexido)cod.value=slug(nome.value)});cod.addEventListener("input",()=>{cod.dataset.mexido="1"});
  const aj=()=>{const op=mod.value==="operacional";dist.disabled=!op;for(const c of [rn,rf]){c.input.disabled=op;if(op)c.input.checked=false}};mod.addEventListener("change",aj);aj();
  const nOc=(g.ocupantes||[]).length;
  const body=el("div",{class:"form"},el("div",{class:"f full note"},n?"O cargo guarda os acessos e as responsabilidades. As pessoas passam a tê-los ao ocupar o cargo e deixam de tê-los ao sair.":`As mudanças de acesso valem na hora para ${nOc===1?"a pessoa que ocupa":"as "+nOc+" pessoas que ocupam"} este cargo.`),
    field("ck-nome","Nome do cargo",nome),field("ck-cod","Código",cod,n?"Letras minúsculas, números e sublinhado. Não muda depois.":"O código não muda depois de criado."),field("ck-nuc","Núcleo",nuc),field("ck-fr","Frente",fr),
    field("ck-mod","Modalidade",mod),field("ck-dist","Distribuição das atividades",dist,"Vale para cargo operacional com mais de um ocupante."),rn.wrap,rf.wrap,
    el("div",{class:"f full"},el("span",{class:"np-f-leg"},"Acessos que o cargo concede"),el("div",{class:"np-cargo-ac"},ac.map(x=>x[1].wrap))),field("ck-resp","Responsabilidades",resp),ativo.wrap);
  modal(n?"Novo cargo":"Editar cargo",body,async()=>{
    if(nome.value.trim().length<3)throw new Error("Informe o nome do cargo.");const c=n?(cod.value||slug(nome.value)):g.codigo;if(!/^[a-z0-9_]{3,40}$/.test(c))throw new Error("Código: de 3 a 40 letras minúsculas, números ou sublinhado.");
    if(!n&&g.ativo!==false&&!ativo.input.checked&&nOc)throw new Error("Encerre as ocupações antes de desativar o cargo.");
    const {error}=await SB.rpc("cargo_salvar",{p_id:n?null:g.id,p_codigo:c,p_nome:nome.value.trim(),p_nucleo:nuc.value||null,p_frente:fr.value||null,p_acessos:ac.filter(x=>x[1].input.checked).map(x=>x[0]),p_responsavel_nucleo:rn.input.checked,p_responsavel_frente:rf.input.checked,p_responsabilidades:resp.value.trim()||null,p_ativo:ativo.input.checked,p_modalidade:mod.value,p_distribuicao:mod.value==="operacional"?dist.value:"fila"});
    if(error)throw new Error(error.message||"Não foi possível salvar o cargo");toast(n?"Cargo criado":"Cargo atualizado");recarregarCargos()});
  botaoModal(n?"Criar cargo":"Salvar cargo");
}
const nomeCliK=id=>id?((typeof S!=="undefined"&&S.clientes||[]).find(c=>c.id===id)||{}).nome||"cliente não carregado":"sem cliente";
async function carregarAnt(g,itens){
  const ids=itens.map(x=>x.registro).slice(0,200);K.ant[g.id]={};if(!ids.length){if(K.fila===g.id)render();return}
  const {data}=await SB.from("responsavel_historico").select("tabela,registro,de,para,motivo,quando").in("registro",ids).order("quando",{ascending:false}).limit(600);
  const m={};for(const h of data||[]){const k=h.tabela+":"+h.registro;if(m[k]||!h.de)continue;const c=E.lista.find(x=>x.id===h.de);if(c&&!c.fila_cargo_id)m[k]={nome:c.nome,quando:h.quando,motivo:h.motivo}}
  K.ant[g.id]=m;if(K.fila===g.id)render();
}
function abrirFila(g,{origem}={}){
  K.aberta=g.id;K.fila=g.id;if(!K.painel)return;const adm=admin()&&!(typeof readOnly==="function"&&readOnly());
  const itens=filaDe(g).slice().sort((a,b)=>(b.fatal-a.fatal)||String(a.prazo||"9999").localeCompare(String(b.prazo||"9999")));
  if(K.ant[g.id]===undefined){K.ant[g.id]=null;carregarAnt(g,itens)}
  const ant=K.ant[g.id]||{},hoje=hojeISO(),el8=elegiveis(g),nFat=itens.filter(x=>x.fatal).length;
  const aviso=!itens.length?null:el("p",{class:"np-nota"+(nFat?" np-fila-alerta":"")},nFat?`${nFat} com prazo fatal. `:"",g.vago?"O cargo está vago: estas atividades não estão com ninguém. Designe um ocupante ou distribua cada uma a outra pessoa pela tela da tarefa.":el8.length?"Estas atividades estão na fila do cargo, sem pessoa atribuída.":"Nenhum ocupante pode receber agora (afastamento ou pendência de acesso).");
  const lista=itens.length?el("ul",{class:"np-cargo-oc np-fila"},itens.map(x=>{
    const atras=x.prazo&&String(x.prazo).slice(0,10)<hoje,pz=x.prazo?NPUI.prazoTxt(String(x.prazo).slice(0,10),x.hora):null,a=ant[x.tabela+":"+x.registro];
    return el("li",{class:x.fatal?"fatal":atras?"late":""},el("div",{class:"q"},el("b",{},x.descricao||"Atividade"),x.fatal?[" ",NPUI.marca("prazo fatal","crit")]:null,atras?[" ",NPUI.marca("atrasada","crit")]:null,+x.prioridade>=3?[" ",NPUI.marca("prioridade alta","att")]:null),
      el("div",{class:"d"},[x.tabela==="monitoramentos"?"Monitoramento":"Tarefa",nomeCliK(x.cliente_id),x.prazo?"prazo "+(pz?.exata||pz?.curta||dataBR(String(x.prazo).slice(0,10)+"T12:00:00")):"sem prazo",a?"antes com "+a.nome:(K.ant[g.id]==null?"responsável anterior: carregando":"sem responsável anterior")].join(" · ")),
      adm&&el8.length?el("div",{class:"ac"},NPUI.btn("Distribuir",{variante:"ghost",onclick:()=>distribuir(g,x)})):null)}))
    :el("p",{class:"np-nota"},"Nada na fila deste cargo.");
  K.painel.abrir({trilha:[el("span",{},"Cargo"),el("span",{class:"sep"}),el("span",{},g.nome),el("span",{class:"sep"}),el("span",{},"Fila")],titulo:`Fila de distribuição (${itens.length})`,corpo:[aviso,NPUI.secao("Atividades sem pessoa atribuída",lista)].filter(Boolean),
    pe:[NPUI.btn("Voltar ao cargo",{onclick:()=>abrirCargo(g)}),adm&&g.ocupante_id&&itens.length?NPUI.btn("Distribuir tudo ao ocupante efetivo",{variante:"ghost",onclick:()=>distribuirTudo(g,itens.length)}):null].filter(Boolean),origem,id:g.id});
}
function distribuir(g,x){
  const el8=elegiveis(g),pes=sel({"":"— escolha —",...Object.fromEntries(el8.map(o=>[o.colaborador_id,o.nome+" ("+rotOc(g,o).split(" · ")[0]+(+o.tarefas_abertas?`, ${o.tarefas_abertas} aberta(s)`:"")+")"]))},el8.length===1?el8[0].colaborador_id:""),mot=inp("text","",{placeholder:"Ex.: distribuição da fila do cargo"});
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`"${x.descricao||"Atividade"}" (${nomeCliK(x.cliente_id)}${x.prazo?", prazo "+dataBR(String(x.prazo).slice(0,10)+"T12:00:00"):""}${x.fatal?", prazo fatal":""}) sai da fila do cargo ${g.nome} e passa à pessoa escolhida. A transferência fica registrada com o seu nome, a data e o motivo.`),
    field("cd-pes","Distribuir para",pes,"Só aparecem ocupantes do cargo que podem receber: com login, sem pendência e fora de afastamento."),field("cd-mot","Motivo",mot));
  modal("Distribuir atividade",body,async()=>{
    if(!pes.value)throw new Error("Escolha a pessoa.");if(mot.value.trim().length<5)throw new Error("Informe o motivo.");
    const {error}=await SB.rpc("atividade_transferir",{p_tabela:x.tabela,p_id:x.registro,p_para:pes.value,p_motivo:mot.value.trim()});
    if(error)throw new Error(error.message||"Não foi possível distribuir");toast("Atividade distribuída");recarregarCargos()});
  botaoModal("Confirmar distribuição");
}
function distribuirTudo(g,n){
  const quem=(g.ocupantes||[]).find(o=>o.colaborador_id===g.ocupante_id),conf=check(`Confirmo a distribuição de ${n} atividade(s) a ${quem?quem.nome:"quem ocupa o cargo"}`,false);
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`Tudo o que está na fila de ${g.nome} passa a ${quem?quem.nome:"quem ocupa o cargo"}, com registro no histórico de cada atividade. Para escolher pessoa por pessoa, use "Distribuir" em cada item.`),conf.wrap);
  modal("Distribuir toda a fila",body,async()=>{if(!conf.input.checked)throw new Error("Marque a confirmação.");const {error}=await SB.rpc("cargo_distribuir_pendentes",{p_cargo:g.id});if(error)throw new Error(error.message||"Não foi possível distribuir");toast("Fila distribuída");recarregarCargos()});
  botaoModal("Distribuir tudo");
}
function abasEquipe(){const g=NPUI.seg([["pessoas","Pessoas"],["cargos","Cargos"]],K.aba,k=>{K.aba=k;K.aberta=null;K.fila=null;render()},"Vista da equipe");return el("div",{class:"np-fin-sub np-eq-abas"},g)}
function renderEquipe(){
  const v=$("#view-equipe");v.replaceChildren();
  if(eqV3()){v.append(abasEquipe());if(K.aba==="cargos"){v.classList.add("np-v3");return renderCargosV3(v)}v.classList.remove("np-v3")}
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Escritório"),el("h1",{},"Equipe"),el("div",{class:"sub"},"Quem é quem, em qual núcleo, com qual usuário — base dos relatórios de produtividade.")),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>csv("equipe",E.lista,["nome","cargo","nucleo","data_admissao","data_desligamento","email","telefone","oab","login_email","login_papel","ativo","responsabilidades"])},"CSV"),admin()?el("button",{class:"btn primary",onclick:()=>openColabForm({})},"+ Colaborador"):null)));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  if(admin()&&E.semColab.length)v.append(el("div",{class:"card section",style:"border-left:3px solid var(--warn)"},el("div",{},el("b",{},`${E.semColab.length} usuário${E.semColab.length===1?"":"s"} da equipe sem cadastro de colaborador: `),E.semColab.map(p=>p.email).join(" · ")),el("div",{class:"actions",style:"justify-content:flex-start"},E.semColab.map(p=>el("button",{class:"btn sm",onclick:()=>openColabForm({perfil_id:p.id,nome:p.nome||"",email:p.email})},"Cadastrar "+(p.nome||p.email))))));
  const ativos=E.lista.filter(c=>c.ativo),inativos=E.lista.filter(c=>!c.ativo);
  const porNucleo=new Map();for(const c of ativos){const k=c.nucleo||"";porNucleo.set(k,(porNucleo.get(k)||0)+1)}
  v.append(el("div",{class:"kpis"},el("div",{class:"card kpi"},el("div",{class:"l"},"Ativos"),el("div",{class:"v num"},String(ativos.length)),el("div",{class:"h"},`${inativos.length} inativo${inativos.length===1?"":"s"}`)),
    ...[...porNucleo.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>el("div",{class:"card kpi"},el("div",{class:"l"},NUCLEOS[k]||"Sem núcleo"),el("div",{class:"v num"},String(n)),el("div",{class:"h"},"")))));
  const tog=check("Mostrar inativos",E.mostrarInativos);tog.input.onchange=()=>{E.mostrarInativos=tog.input.checked;render()};tog.wrap.className="";
  const lista=E.mostrarInativos?E.lista:ativos;
  const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"Nome"),el("th",{},"Cargo"),el("th",{},"Núcleo"),el("th",{},"Admissão"),el("th",{},"Usuário"),el("th",{class:"r"},"Horas 30d"),el("th",{class:"r"},"Registros 30d"),el("th",{class:"r"},"Tarefas"),el("th",{class:"r"},"Processos"),el("th",{},""))),
    el("tbody",{},lista.length?lista.map(c=>el("tr",{style:(c.ativo?"":"opacity:.6;")+"cursor:pointer",onclick:e=>{if(e.target.closest("button"))return;window.PP_RH?.abrir(c.id)}},
      el("td",{},el("b",{},c.nome),c.ativo?null:el("span",{class:"pill g",style:"margin-left:6px"},"inativo"),c.responsabilidades?el("div",{class:"note"},c.responsabilidades.slice(0,90)+(c.responsabilidades.length>90?"…":"")):null),
      el("td",{},c.cargo||"—",c.oab?el("div",{class:"note"},"OAB "+c.oab):null),el("td",{},NUCLEOS[c.nucleo]||"—"),el("td",{},c.data_admissao?fmtD(parseD(c.data_admissao)):"—",c.data_desligamento?el("div",{class:"note"},"saída "+fmtD(parseD(c.data_desligamento))):null),
      el("td",{},c.login_email?el("span",{},c.login_email,el("div",{class:"note"},PAPEIS[c.login_papel]||c.login_papel)):el("span",{class:"pill e2"},"sem login")),
      el("td",{class:"r num"},horasFmt(c.horas_30d)),el("td",{class:"r num"},String(c.registros_30d)),el("td",{class:"r num"},String(c.tarefas_abertas),c.tarefas_atrasadas>0?el("span",{class:"pill e3",style:"margin-left:4px"},c.tarefas_atrasadas+" atras."):null),el("td",{class:"r num"},String(c.processos_ativos)),
      el("td",{},el("div",{class:"actions",style:"flex-wrap:nowrap"},el("button",{class:"btn sm",onclick:()=>window.PP_RH?.abrir(c.id)},"Ficha"),(admin()||c.perfil_id===PP.perfil?.id)?el("button",{class:"btn sm",onclick:()=>openColabForm(c)},"Editar"):null)))):el("tr",{},el("td",{colspan:10,class:"note"},"Nenhum colaborador cadastrado. Use “+ Colaborador” ou cadastre a partir dos usuários acima."))));
  v.append(el("div",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Colaboradores"),tog.wrap),el("div",{class:"tbl"},tb)));
}
function openColabForm(c={}){
  const souAdmin=admin(),proprio=c.perfil_id&&c.perfil_id===PP.perfil?.id;
  const nome=inp("text",c.nome||""),cargo=inp("text",c.cargo||"",{placeholder:"Ex.: Advogada, Assistente jurídico"}),nuc=sel({"":"—",...NUCLEOS},c.nucleo||""),frente=sel({"":"— nenhuma —",estrategico:"Estratégico / Consultivo",juridico:"Jurídico / Contencioso",negocial:"Negocial / Acordos"},c.frente||""),adm=inp("date",c.data_admissao||""),desl=inp("date",c.data_desligamento||""),
        email=inp("email",c.email||""),tel=inp("text",c.telefone||""),zap=inp("text",c.whatsapp||"",{placeholder:"(16) 9 9999-9999"}),discord=inp("text",c.discord_user_id||"",{placeholder:"ID numérico do usuário (ex.: 123456789012345678)"}),canal=sel({discord:"Discord (DM)",whatsapp:"WhatsApp",ambos:"Discord e WhatsApp"},c.canal_resumo||"discord"),resumo=check("Receber resumo diário (8h, dias úteis)",c.resumo_diario!==false),gcal=inp("email",c.google_calendar_id||"",{placeholder:"vazio = usa o e-mail acima"}),gsync=check("Sincronizar agenda com o Google Calendar",c.agenda_sync===true,"Compromissos e tarefas com horário vão para a agenda Google desta pessoa; o que ela marcar lá aparece no painel."),oab=inp("text",c.oab||"",{placeholder:"Ex.: 123456/SP"}),resp=el("textarea",{placeholder:"O que esta pessoa cuida no dia a dia."},c.responsabilidades||""),pontoChk=check("Registra ponto (estagiário)",!!c.registra_ponto),jorn=inp("number",c.jornada_minutos!=null?String(Math.round(c.jornada_minutos/60)):"6",{min:"1",max:"12",step:"1"}),ativo=check("Ativo",c.ativo!==false),
        apelido=inp("text",c.apelido||"",{placeholder:"Como é chamado(a)"}),nasc=inp("date",c.data_nascimento||""),cidade=inp("text",c.cidade||""),linkedin=inp("url",c.linkedin||"",{placeholder:"https://linkedin.com/in/…"}),bio=el("textarea",{placeholder:"Sobre mim, em 2–3 linhas (aparece na ficha para a equipe)."},c.bio||"");
  const opcoesPerfil={"":"— sem usuário —",...Object.fromEntries(E.semColab.map(p=>[p.id,`${p.email}${p.nome?" · "+p.nome:""}`]))};
  if(c.perfil_id&&!opcoesPerfil[c.perfil_id])opcoesPerfil[c.perfil_id]=c.login_email||"(usuário vinculado)";
  const perfil=sel(opcoesPerfil,c.perfil_id||"");
  const ro=!souAdmin;if(ro){for(const i of [cargo,nuc,adm,desl,oab,resp,perfil,ativo.input,pontoChk.input,jorn])i.disabled=true}
  const v3=equipeV3();
  const body=v3
    ?el("div",{class:"form"},
      NPUI.secaoForm("Dados pessoais"),
      field("co-nome","Nome",nome),field("co-apelido","Apelido",apelido),field("co-email","E-mail",email),field("co-tel","Telefone",tel),field("co-zap","WhatsApp",zap,"Usado só se o canal do resumo for WhatsApp."),
      NPUI.secaoForm("Vínculo e atuação"),
      field("co-cargo","Cargo",cargo),field("co-nuc","Núcleo",nuc),field("co-frente","Frente (gestão de passivos)",frente,"Responsável padrão desta frente nos clientes."),field("co-adm","Data de admissão",adm),field("co-oab","OAB",oab),
      field("co-perfil","Usuário do sistema",perfil,souAdmin?"Só aparecem usuários da equipe ainda sem colaborador.":null),ativo.wrap,
      NPUI.maisCampos("Agenda, notificações, ponto e perfil",[
        field("co-canal","Canal do resumo diário",canal),resumo.wrap,
        field("co-discord","Discord (ID do usuário)",discord,"Configurações → Avançado → Modo desenvolvedor → Copiar ID."),
        field("co-gcal","Agenda Google (e-mail)",gcal,"Vazio = usa o e-mail principal."),gsync.wrap,
        pontoChk.wrap,field("co-jorn","Jornada diária (horas)",jorn),field("co-desl","Data de desligamento",desl),
        field("co-nasc","Nascimento",nasc,"Só dia e mês aparecem para a equipe."),field("co-cidade","Cidade",cidade),field("co-linkedin","LinkedIn",linkedin),
        field("co-bio","Sobre",bio),field("co-resp","Responsabilidades",resp)
      ],{contador:"auto"}))
    :el("div",{class:"form"},field("co-nome","Nome",nome),field("co-cargo","Cargo",cargo),field("co-nuc","Núcleo",nuc),field("co-frente","Frente (gestão de passivos)",frente,"Responsável padrão desta frente nos clientes. Exceções por cliente no Dossiê."),field("co-adm","Data de admissão",adm),field("co-desl","Data de desligamento",desl),
      field("co-email","E-mail",email),field("co-tel","Telefone",tel),field("co-zap","WhatsApp",zap,"Usado só se o canal do resumo for WhatsApp."),field("co-discord","Discord (ID do usuário)",discord,"No Discord: Configurações → Avançado → Modo desenvolvedor; depois clique com o direito no nome → Copiar ID do usuário."),field("co-canal","Canal do resumo diário",canal),resumo.wrap,field("co-gcal","Agenda Google (e-mail)",gcal,"Conta Workspace do escritório. Gmail pessoal só funciona se a agenda for compartilhada com a conta de serviço do painel."),gsync.wrap,field("co-oab","OAB",oab),field("co-apelido","Apelido",apelido),field("co-nasc","Nascimento",nasc,"Só dia e mês aparecem para a equipe (aniversariantes)."),field("co-cidade","Cidade",cidade),field("co-linkedin","LinkedIn",linkedin),field("co-bio","Sobre",bio),field("co-perfil","Usuário do sistema",perfil,souAdmin?"Só aparecem usuários da equipe ainda sem colaborador. Crie o usuário no Supabase e defina o perfil na aba Usuários.":null),ativo.wrap,pontoChk.wrap,field("co-jorn","Jornada diária (horas, para o ponto)",jorn),field("co-resp","Responsabilidades",resp));
  const extra=(c.id&&souAdmin)?el("button",{class:"btn danger",onclick:()=>{npConfirmar({titulo:"Excluir colaborador?",mensagem:`Remover ${c.nome||"este colaborador"}? Horas e tarefas vinculadas perdem o vínculo (prefira inativar).`,confirmar:"Excluir colaborador",perigo:true,onSim:async()=>{const {error}=await SB.from("colaboradores").delete().eq("id",c.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir (há registros vinculados? prefira inativar)":"Colaborador excluído");E.ok=false;garantir()}})}} ,"Excluir"):null;
  modal(c.id?"Editar colaborador":"Novo colaborador",body,async()=>{
    if(!nome.value.trim()){const e=new Error("Informe o nome");e.campo=nome;throw e}
    const basicos={apelido:apelido.value.trim()||null,data_nascimento:nasc.value||null,cidade:cidade.value.trim()||null,linkedin:linkedin.value.trim()||null,bio:bio.value.trim()||null};
    const row=ro?{nome:nome.value.trim(),email:email.value.trim()||null,telefone:tel.value.trim()||null,whatsapp:zap.value.trim()||null,discord_user_id:discord.value.trim()||null,canal_resumo:canal.value,resumo_diario:resumo.input.checked,google_calendar_id:gcal.value.trim()||null,agenda_sync:gsync.input.checked,...basicos}
      :{...basicos,nome:nome.value.trim(),cargo:cargo.value.trim()||null,nucleo:nuc.value||null,frente:frente.value||null,data_admissao:adm.value||null,data_desligamento:desl.value||null,email:email.value.trim()||null,telefone:tel.value.trim()||null,whatsapp:zap.value.trim()||null,discord_user_id:discord.value.trim()||null,canal_resumo:canal.value,resumo_diario:resumo.input.checked,google_calendar_id:gcal.value.trim()||null,agenda_sync:gsync.input.checked,oab:oab.value.trim()||null,responsabilidades:resp.value.trim()||null,perfil_id:perfil.value||null,ativo:ativo.input.checked&&!desl.value,registra_ponto:pontoChk.input.checked,jornada_minutos:jorn.value?Math.round(+jorn.value*60):null};
    const {error}=c.id?await SB.from("colaboradores").update(row).eq("id",c.id):await SB.from("colaboradores").insert(row);
    if(error)throw new Error(error.code==="23505"?"Este usuário já está vinculado a outro colaborador":"Não foi possível salvar");
    toast("Colaborador salvo");E.ok=false;garantir();window.PP_RH?.invalidar();
  },extra,{confirmar:c.id?"Salvar colaborador":"Cadastrar colaborador"});
}
window.PP_EQUIPE={openColabForm,get lista(){return E.lista},recarregar(){E.ok=false;garantir()},NUCLEOS};

/* ---------- Integração ---------- */
{const _r=render;render=function(){_r();const ve=$("#view-equipe");if(!ve)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="equipe")S.tab="clientes";ve.hidden=S.tab!=="equipe";if(S.tab==="equipe")renderEquipe()}}
window.__PP_LOGIN.then(()=>{if(equipe()){const ch=SB.channel("equipe");ch.on("postgres_changes",{event:"*",schema:"public",table:"colaboradores"},()=>{E.ok=false;if(S.tab==="equipe")garantir()});ch.subscribe()}});
})();
