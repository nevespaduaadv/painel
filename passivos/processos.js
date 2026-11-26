/* Processos — lista geral (todos os clientes + processos sem cliente, fora da base). Lê v_processos; detalhe com andamentos.
   Criação/edição e andamentos reaproveitam os formulários de carteira.js (PP_CARTEIRA). Depende de 0035. */
(()=>{
"use strict";
const P={lista:[],ok:false,carregando:false,f:{q:"",cliente:"",status:"ativo",resp:"",area:"",semCliente:false,incompleto:false},sel:null,ands:[],andsDe:null,colab:[]};
async function carregar(){
  if(P.carregando)return;P.carregando=true;
  try{
    const [a,c]=await Promise.all([npTodas(()=>SB.from("v_processos").select("*").order("proximo_prazo",{ascending:true,nullsFirst:false}).order("id")),SB.from("colaboradores").select("id,perfil_id,nome,ativo").order("nome")]);
    if(a.error)throw a.error;P.lista=a.data||[];P.colab=c.data||[];P.ok=true;P.erro=null;
  }catch(e){console.warn("processos",e);P.erro=Date.now();toast("Não foi possível carregar os processos")}
  finally{P.carregando=false}
  if(S.tab==="processos")render();
}
const garantir=()=>{if(!P.ok&&!P.carregando&&!(P.erro&&Date.now()-P.erro<15000))carregar();return P.ok}; /* depois de uma falha, só tenta de novo sozinho após 15 s (antes: novas tentativas em laço) */
async function carregarAndamentos(pid){
  P.andsDe=pid;P.andsOk=null;const {data}=await SB.from("andamentos").select("*").eq("processo_id",pid).order("data",{ascending:false});
  if(P.andsDe===pid){P.ands=data||[];P.andsOk=pid;if(S.tab==="processos")render()}
}
const prazoPill=p=>{if(!p.proximo_prazo)return el("span",{class:"note"},"—");const d=p.dias_para_prazo;const cls=d<0||d===0?"e3":d<=7?"e2":"g";return el("span",{class:"pill "+cls},fmtD(parseD(p.proximo_prazo)),p.prazo_fatal?" · fatal":"",d<0?` · ${-d}d atrás`:d===0?" · hoje":d<=30?` · em ${d}d`:"")};
const COLS_EXP=[{k:"numero_cnj",t:"Processo"},{k:"pasta_codigo",t:"Pasta"},{k:"cliente_nome",t:"Cliente"},{k:"parte_contraria",t:"Parte contrária"},{k:"banco",t:"Banco"},{k:"tipo_acao",t:"Tipo de ação"},{k:"area",t:"Área"},{k:"polo",t:"Polo"},{k:"tribunal",t:"Tribunal"},{k:"comarca",t:"Comarca"},{k:"uf",t:"UF"},{k:"vara",t:"Vara"},{k:"fase",t:"Fase"},{k:"status",t:"Status"},{k:"valor_causa",t:"Valor da causa",f:v=>v==null?"":String(v).replace(".",",")},{k:"responsavel_nome",t:"Responsável"},{k:"proximo_prazo",t:"Próximo prazo",f:v=>v?v.split("-").reverse().join("/"):""},{k:"prazo_fatal",t:"Fatal",f:v=>v?"sim":""},{k:"ultimo_andamento",t:"Último andamento",f:v=>v?String(v).slice(0,10).split("-").reverse().join("/"):""},{k:"dias_sem_andamento",t:"Dias sem andamento"},{k:"tarefas_abertas",t:"Tarefas abertas"},{k:"data_distribuicao",t:"Distribuição",f:v=>v?v.split("-").reverse().join("/"):""}];
function renderProcessos(){
  const v=$("#view-processos");v.replaceChildren();v.classList.remove("np-v3");
  if(P.sel&&window.PP_PROCESSO?.ficha){
    if(!garantir()){if(procV3()){v.classList.add("np-v3");v.append(P.erro?erroP():NPUI.carregando(6))}else v.append(el("div",{class:"note"},"Carregando…"));return}
    const p=P.lista.find(x=>x.id===P.sel);if(!p){P.sel=null;if(procV3())toast("Processo não encontrado");render();return}
    const volta=P.voltar||{tab:"processos"};
    if(procV3()){v.classList.add("np-v3");
      const voltar=()=>{const id=P.sel;P.sel=null;P.voltar=null;if(volta.tab==="clientes"){S.tab="clientes";S.sel=volta.sel;S.sub=volta.sub||"processos"}else{S.tab="processos";V3.aberta=id;V3.focar=id}render()};
      v.append(el("div",{class:"np-pf-volta"},NPUI.btn(volta.tab==="clientes"?"← Cliente":"← Processos",{variante:"ghost",cls:"btn-voltar",title:"Voltar à lista",onclick:voltar})));
      v.append(window.PP_PROCESSO.ficha(p,{recarregar:()=>{P.ok=false;garantir()}}));return}
    v.append(el("div",{class:"crumbs",style:"margin-bottom:10px"},el("button",{class:"btn sm btn-voltar",onclick:()=>{P.sel=null;P.voltar=null;if(volta.tab==="clientes"){S.tab="clientes";S.sel=volta.sel;S.sub=volta.sub||"processos"}else{S.tab="processos"}render()}},volta.tab==="clientes"?"← Cliente":"← Processos"),
      el("span",{class:"note"},(p.cliente_nome||"Fora da base")+" › Processo "+(p.numero_cnj||"(sem número)")+(p.pasta_codigo?" › Pasta "+p.pasta_codigo:""))));
    v.append(window.PP_PROCESSO.ficha(p,{recarregar:()=>{P.ok=false;garantir()}}));
    return;
  }
  if(procV3())return renderProcessosV3(v);
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Processos"),el("div",{class:"sub"},"Todos os processos acompanhados, inclusive os de pessoas fora da base de clientes.")),
    el("div",{class:"actions"},btnExportar("processos",()=>P.filtrados||[],COLS_EXP),el("button",{class:"btn primary",onclick:()=>window.PP_CARTEIRA?.openProcessoForm(null,{})},"+ Processo"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const f=P.f;
  const ativos=P.lista.filter(p=>p.status==="ativo");
  const K=(l,val,h,cls)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v",style:cls?`color:var(--${cls})`:""},String(val)),el("div",{class:"h"},h));
  const semCli=ativos.filter(p=>!p.cliente_id).length,atras=ativos.filter(p=>p.dias_para_prazo!=null&&p.dias_para_prazo<0).length,semProv=ativos.filter(p=>p.sem_providencia).length,incompl=ativos.filter(p=>(p.campos_faltando||[]).length).length;
  v.append(el("div",{class:"kpis"},K("Ativos",ativos.length,`${P.lista.length} no total`),K("Prazo vencido",atras,"próximo prazo já passou",atras?"crit":""),K("Cadastro incompleto",incompl,"campos obrigatórios em branco",incompl?"warn":""),K("Sem providência",semProv,"30 dias sem andamento nem tarefa",semProv?"warn":""),K("Sem cliente na base",semCli,"pessoas fora do cadastro")));
  {const m=new Map();for(const p of ativos)m.set(p.area||"Sem área",(m.get(p.area||"Sem área")||0)+1);if(m.size>1)v.append(el("div",{class:"note",style:"margin:-4px 0 8px"},"Ativos por área: ",...[...m.entries()].sort((a,b)=>b[1]-a[1]).flatMap(([k,n],i)=>[i?" · ":"",el("a",{href:"#",onclick:ev=>{ev.preventDefault();f.area=k==="Sem área"?"__sem":k;render()}},`${k} ${n}`)])))}
  const q=el("input",{class:"search",placeholder:"Nº CNJ, parte, banco, cliente…",value:f.q,oninput:e=>{f.q=e.target.value;render()}});
  const fs=sel({ativo:"Ativos",suspenso:"Suspensos",encerrado:"Encerrados","":"Todos"},f.status);fs.onchange=()=>{f.status=fs.value;render()};
  const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(P.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},f.resp);fr.onchange=()=>{f.resp=fr.value;render()};
  const fc=sel({"":"Todos os clientes","__sem":"Só sem cliente",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome]))},f.cliente);fc.onchange=()=>{f.cliente=fc.value;render()};
  const areasAtivas=[...new Set(P.lista.map(p=>p.area).filter(Boolean))].sort();const fa=sel({"":"Todas as áreas","__sem":"Sem área",...Object.fromEntries(areasAtivas.map(a=>[a,a]))},f.area||"");fa.onchange=()=>{f.area=fa.value;render()};
  const ql=f.q.trim().toLowerCase();
  const lista=P.lista.filter(p=>(!f.status||p.status===f.status)&&(!f.resp||p.responsavel_id===f.resp)&&(f.area==="__sem"?!p.area:!f.area||p.area===f.area)&&(f.cliente==="__sem"?!p.cliente_id:!f.cliente||p.cliente_id===f.cliente)&&(!f.incompleto||(p.campos_faltando||[]).length)
    &&(!ql||[p.numero_cnj,p.parte_contraria,p.banco,p.cliente_nome,p.tipo_acao,p.tribunal,p.vara,p.pasta_codigo||(p.pasta_numero?String(p.pasta_numero).padStart(5,"0"):"")].join(" ").toLowerCase().includes(ql)));
  P.filtrados=lista;
  const fi=el("label",{class:"switch"},el("input",{type:"checkbox",checked:f.incompleto?"":null,onchange:e=>{f.incompleto=e.target.checked;render()}})," Só cadastro incompleto");
  const card=el("div",{class:"card"},el("div",{class:"tbl-tools"},q,fs,fc,fr,fa,fi,el("div",{class:"sp"}),el("span",{class:"note"},`${lista.length} de ${P.lista.length}`)));
  card.append(tabela({cols:[
      {label:"Pasta",r:p=>el("div",{},el("b",{},window.PP_PASTAS?.pastaTxt?.(p)||"—"),(p.campos_faltando||[]).length?el("div",{class:"pill e2",title:"Falta: "+p.campos_faltando.join(", ")},"incompleto"):null,p.qtd_relacionados?el("div",{class:"note"},p.qtd_relacionados+" relacionado(s)"):null)},
      {label:"Processo",r:p=>el("div",{},el("span",{class:"t num"},p.numero_cnj||"(sem número)"),el("span",{class:"sub"},[p.area,p.tipo_acao,p.tribunal,p.vara].filter(Boolean).join(" · ")))},
      {label:"Cliente",r:p=>p.cliente_id?p.cliente_nome:el("span",{class:"pill g"},"fora da base")},
      {label:"Parte contrária",r:p=>p.parte_contraria||p.banco||"—"},
      {label:"Fase",r:p=>p.fase||"—"},
      {label:"Último andamento",r:p=>p.ultimo_andamento?fmtD(parseD(p.ultimo_andamento)):el("span",{class:"note"},"—")},
      {label:"Próximo prazo",r:p=>prazoPill(p)},
      {label:"Responsável",r:p=>p.responsavel_nome||"—"},
      {label:"Status",r:p=>el("span",{class:"pill "+(p.status==="ativo"?"e1":p.status==="suspenso"?"e2":"g")},p.status)}],
    rows:lista,onRow:p=>{if(window.PP_PROCESSO?.ficha){window.PP_PROCESSOS.abrir(p.id);return}P.sel=P.sel===p.id?null:p.id;if(P.sel)carregarAndamentos(p.id);render()},vazio:"Nenhum processo com esses filtros.",
    acts:p=>[btnIco("abrir","Abrir o processo",()=>window.PP_PROCESSOS.abrir(p.id)),btnIco("editar","Editar",()=>window.PP_CARTEIRA?.openProcessoForm(null,p))]}));
  v.append(card);
  const p=P.lista.find(x=>x.id===P.sel);
  if(p){
    if(window.PP_PROCESSO?.ficha){v.append(window.PP_PROCESSO.ficha(p,{recarregar:()=>{P.ok=false;garantir()}}));return}
    const ands=P.andsDe===p.id?P.ands:[];
    v.append(el("div",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("div",{class:"eyebrow"},p.cliente_nome||"Fora da base"),el("h2",{},p.numero_cnj||"(sem número)"),el("div",{class:"note"},[p.tipo_acao,p.parte_contraria?"× "+p.parte_contraria:null,p.valor_causa?"valor da causa "+BRL(+p.valor_causa):null,p.responsavel_nome?"resp. "+p.responsavel_nome:null].filter(Boolean).join(" · "))),
        el("div",{class:"actions"},el("button",{class:"btn sm",title:p.datajud_erro?"Atualização: "+p.datajud_erro:p.datajud_atualizado_em?"Última atualização: "+new Date(p.datajud_atualizado_em).toLocaleString("pt-BR"):"Busca as movimentações do processo. Automático 1× por dia.",onclick:async(e)=>{const b=e.currentTarget;b.disabled=true;try{const {data,error}=await SB.rpc("datajud_atualizar",{p_processo:p.id});if(error)throw error;toast("Consulta enviada — as movimentações aparecem em alguns minutos");setTimeout(async()=>{await SB.rpc("datajud_atualizar",{p_processo:null}).catch(()=>{});P.ok=false;carregar();window.PP_PROCESSO_FICHA?.recarregar?.(p.id)},20000)}catch(err){toast(err.message||"Não foi possível consultar")}finally{b.disabled=false}}},p.datajud_erro?"Atualizar ⚠":"Atualizar andamentos"),el("button",{class:"btn sm",onclick:()=>window.PP_CARTEIRA?.openProcessoForm(null,p)},"Editar processo"),el("button",{class:"btn sm",onclick:()=>window.PP_TAREFAS?.nova({processo_id:p.id,cliente_id:p.cliente_id||null,titulo:""})},"+ Tarefa"),el("button",{class:"btn sm primary",onclick:()=>window.PP_CARTEIRA?.openAndamentoForm(p)},"+ Andamento"))),
      p.observacoes?el("div",{class:"note",style:"white-space:pre-wrap"},p.observacoes):null,
      window.PP_PASTAS?.secaoProcesso?window.PP_PASTAS.secaoProcesso(p,()=>{P.ok=false;garantir()}):null,
      el("h3",{},`Andamentos (${ands.length})`),
      ands.length?el("ul",{class:"tl"},ands.map(a=>el("li",{},el("div",{class:"d"},fmtD(parseD(a.data)),a.tipo?" · "+a.tipo:"",a.fonte&&a.fonte!=="manual"?el("span",{class:"pill c",style:"margin-left:6px"},a.fonte):null),el("div",{style:"white-space:pre-wrap"},a.descricao),
        el("div",{class:"actions",style:"justify-content:flex-start;margin-top:4px"},el("button",{class:"btn sm",onclick:()=>window.PP_CARTEIRA?.openAndamentoForm(p,a)},"Editar"))))):el("div",{class:"note"},P.andsDe===p.id?"Nenhum andamento registrado.":"Carregando…")));
  }
}
/* ============================================================================================================================
   V3.1 (entrega visual V8) — mesma lógica, outra apresentação. Ativa só com a casca V3.1 ligada (html.np-casca-v3).
   Lista agrupada pelo PRÓXIMO PRAZO (v_processos.dias_para_prazo), régua na linha, marcas sem pílula e painel lateral com os
   dados do processo, o DataJud e os andamentos. Mesmos dados, mesmos filtros, mesma exportação e as mesmas ações da V2
   (abrir a ficha completa, editar, + andamento, + processo). Nada é gravado por esta apresentação.
   ============================================================================================================================ */
const procV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const V3={aberta:null,obra:null,painel:null,grupos:null};
const GRUPOS_P=[["vencido","Prazo vencido","crit"],["semana","Próximos 7 dias","att"],["mes","Próximos 30 dias",""],["depois","Mais adiante",""],["sem","Sem prazo registrado",""]];
const grupoP=p=>{const d=p.dias_para_prazo;return !p.proximo_prazo||d==null?"sem":d<0?"vencido":d<=7?"semana":d<=30?"mes":"depois"};
const gruposAb=()=>{if(!V3.grupos){try{V3.grupos=JSON.parse(NPUI.pref.get("np-proc-grupos","{}"))||{}}catch(_){V3.grupos={}}}return V3.grupos};
const pastaP=p=>{const t=window.PP_PASTAS?.pastaTxt?.(p);return t&&t!=="—"?(/^pasta/i.test(t)?t:"Pasta "+t):(p.pasta_codigo?"Pasta "+p.pasta_codigo:"")};
const limparP=()=>{Object.assign(P.f,{q:"",cliente:"",status:"ativo",resp:"",area:"",incompleto:false,vencido:false,semProv:false})};
function filtrarP(){
  const f=P.f,ql=f.q.trim().toLowerCase();
  return P.lista.filter(p=>(!f.status||p.status===f.status)&&(!f.resp||p.responsavel_id===f.resp)&&(f.area==="__sem"?!p.area:!f.area||p.area===f.area)&&(f.cliente==="__sem"?!p.cliente_id:!f.cliente||p.cliente_id===f.cliente)
    &&(!f.incompleto||(p.campos_faltando||[]).length)&&(!f.vencido||(p.dias_para_prazo!=null&&p.dias_para_prazo<0))&&(!f.semProv||p.sem_providencia)
    &&(!ql||[p.numero_cnj,p.parte_contraria,p.banco,p.cliente_nome,p.tipo_acao,p.tribunal,p.vara,p.pasta_codigo||(p.pasta_numero?String(p.pasta_numero).padStart(5,"0"):"")].join(" ").toLowerCase().includes(ql)));
}
/* Processos simples (pedido das sócias, 23/11): só a lista dos processos da base, com a pasta de cada um. Prazos, pendências e alertas ficam na ficha do processo. */
function linhaP(p){
  const m=[];const pa=pastaP(p);if(pa)m.push(NPUI.marca(pa));
  if(p.status!=="ativo")m.push(NPUI.marca(p.status||"—"));
  const ctx=[p.cliente_nome||"Fora da base",(p.parte_contraria||p.banco)?"× "+(p.parte_contraria||p.banco):null,p.tipo_acao||p.area||null,[p.tribunal,p.vara].filter(Boolean).join(" ")||null].filter(Boolean).join(" · ");
  return NPUI.linha({id:p.id,riscado:p.status==="encerrado",titulo:p.numero_cnj||"(sem número)",contexto:ctx,direita:[...m,p.responsavel_nome?NPUI.quem(p.responsavel_nome):null],titleAbrir:"Abrir a ficha do processo",
    onOpen:()=>window.PP_PROCESSOS.abrir(p.id)});
}
function filtrosP(){
  const f=P.f,chips=[];
  const n=(st)=>P.lista.filter(p=>!st||p.status===st).length;
  for(const [k,l] of [["ativo","Ativos"],["suspenso","Suspensos"],["encerrado","Encerrados"],["","Todos"]]){if(k&&k!=="ativo"&&!n(k))continue;chips.push(NPUI.chip({label:l,n:n(k),on:f.status===k,grupo:"escopo",onclick:()=>{f.status=k;render()}}))}
  return {chips,fixos:[]};
}
const erroP=()=>NPUI.faixaErro({texto:"Não foi possível carregar os processos. Confira a conexão.",onAcao:()=>{P.erro=null;carregar();render()}});
function renderProcessosV3(v){
  v.classList.add("np-v3");V3.obra=null;V3.painel=null;
  if(!garantir()){if(P.erro&&!P.carregando){v.append(erroP());return}v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  Object.assign(P.f,{incompleto:false,vencido:false,semProv:false,resp:"",area:"",cliente:""});
  const lista=filtrarP().sort((a,b)=>(a.cliente_nome||"\uffff").localeCompare(b.cliente_nome||"\uffff","pt-BR")||(a.numero_cnj||"").localeCompare(b.numero_cnj||""));P.filtrados=lista;
  /* 25/11 (sócia): quadros por situação (clicar filtra) e distribuição por tribunal, fase e tipo — sempre sobre os processos ativos */
  const nSt=st=>P.lista.filter(p=>!st||p.status===st).length;
  const qdP=(k,t)=>({titulo:t,n:nSt(k),ativo:P.f.status===k,onclick:()=>{P.f.status=k;render()}});
  const quadrosP=NPUI.quadros([qdP("ativo","Processos ativos"),nSt("suspenso")?qdP("suspenso","Suspensos"):null,nSt("encerrado")?qdP("encerrado","Encerrados"):null,qdP("","Todos os processos")]);
  const conta=(f)=>{const m=new Map();for(const p of P.lista){if(p.status!=="ativo")continue;let k=String(f(p)||"").trim()||"Não informado";k=k.charAt(0).toUpperCase()+k.slice(1);m.set(k,(m.get(k)||0)+1)}return [...m].map(([rotulo,n])=>({rotulo,n}))};
  const FASE_R={conhecimento:"Conhecimento",recursal:"Recursal",execucao:"Execução",cumprimento:"Cumprimento de sentença",administrativo:"Administrativo",extrajudicial:"Extrajudicial"};
  const graficosP=el("div",{class:"np-barras-w"},NPUI.barras({titulo:"Por tribunal",itens:conta(p=>p.tribunal)}),NPUI.barras({titulo:"Por fase processual",itens:conta(p=>FASE_R[p.fase]||p.fase)}),NPUI.barras({titulo:"Por tipo de processo",itens:conta(p=>p.tipo_acao||p.area)}));
  let tq=null;const busca=el("input",{type:"search",class:"np-busca-inline",placeholder:"Buscar nº, cliente, parte, pasta…",value:P.f.q||"","aria-label":"Buscar processo",oninput:ev=>{P.f.q=ev.target.value;clearTimeout(tq);tq=setTimeout(()=>{render();const x=$("#view-processos .np-busca-inline");if(x){x.focus();x.setSelectionRange(x.value.length,x.value.length)}},300)}});
  const maisAc=NPUI.ib("pontos","Mais ações",()=>NPUI.pop(maisAc,[{label:"Exportar CSV (lista filtrada)",onclick:()=>{const ls=P.filtrados||[];if(!ls.length){toast("Nada para exportar");return}exportarCSV("processos",ls,COLS_EXP);toast(`${ls.length} linha(s) exportada(s)`)}}],{label:"Mais ações",alinhar:"dir",refoco:()=>$('#view-processos .np-ib[aria-label="Mais ações"]')}));
  maisAc.setAttribute("aria-haspopup","menu");maisAc.setAttribute("aria-expanded","false");
  const ro=typeof readOnly==="function"&&readOnly();
  const fl=filtrosP();
  v.append(quadrosP,graficosP);
  v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:lista.length,label:lista.length===1?"processo":"processos"}]),direita:[busca,maisAc,ro?null:NPUI.btn("Novo processo",{variante:"pri",icone:"mais",onclick:()=>window.PP_CARTEIRA?.openProcessoForm(null,{})})]}));
  if(V3.manterPop){V3.manterPop=false;NPUI.reancorarPop()}else NPUI.reancorarPop();
  const obra=el("div",{class:"np-obra"});V3.obra=obra;const corpo=el("div",{class:"np-corpo np-simples"});
  if(!lista.length){
    const semNada=!P.lista.length;
    corpo.append(NPUI.vazio(semNada?{titulo:"Nenhum processo cadastrado",texto:"Cadastre o primeiro processo.",acao:ro?null:"Novo processo",onAcao:()=>window.PP_CARTEIRA?.openProcessoForm(null,{})}
      :{titulo:"Nada com esses filtros",texto:"Tire um filtro para ver os demais processos.",acao:"Limpar filtros",onAcao:()=>{limparP();render()}}));
  }else{
    // 40 por página; mudar filtro ou busca volta para a primeira; ao voltar da ficha, abre a página onde está o processo
    const chave=JSON.stringify([P.f.q,P.f.status]);if(chave!==P.pgChave){P.pgChave=chave;P.pg=1}
    if(V3.focar){const i=lista.findIndex(x=>x.id===V3.focar);if(i>=0)P.pg=Math.floor(i/40)+1}
    const fa=NPUI.fatia(lista,P.pg,40);P.pg=fa.pagina;
    corpo.append(el("ul",{class:"np-lst"},fa.itens.map(linhaP)));
    const pag=NPUI.paginas({total:lista.length,pagina:fa.pagina,porPagina:40,rotulo:"processos",onIr:n=>{P.pg=n;render();window.scrollTo(0,0);$("#view-processos .np-corpo")?.scrollTo?.(0,0)}});
    if(pag)corpo.append(pag);
    corpo.append(NPUI.rodape(`${fa.paginas>1?`mostrando ${fa.de}–${fa.ate} · `:""}${lista.length} de ${P.lista.length} ${P.lista.length===1?"processo":"processos"} · por cliente, em ordem alfabética`));
  }
  obra.append(corpo);v.append(obra);
  V3.painel=NPUI.painel({obra,label:"Detalhe do processo",onClose:()=>{V3.aberta=null}});
  if(V3.aberta){const p=P.lista.find(x=>x.id===V3.aberta);if(p)abrirPainelP(p,{silencioso:true});else V3.aberta=null}
  if(V3.focar){const id=V3.focar;V3.focar=null;setTimeout(()=>{const li=v.querySelector(`li.np-it[data-id="${id}"]`);li?.scrollIntoView({block:"nearest"})},0)}
}
async function datajudP(p,b){
  b.disabled=true;
  try{const {error}=await SB.rpc("datajud_atualizar",{p_processo:p.id});if(error)throw error;toast("Consulta enviada — as movimentações aparecem em alguns minutos");
    setTimeout(async()=>{await SB.rpc("datajud_atualizar",{p_processo:null}).catch(()=>{});P.ok=false;carregar();if(V3.aberta===p.id)carregarAndamentos(p.id);window.PP_PROCESSO_FICHA?.recarregar?.(p.id)},20000)}
  catch(err){toast(err.message||"Não foi possível consultar")}finally{b.disabled=false}
}
function abrirPainelP(p,{origem}={}){
  V3.aberta=p.id;if(P.andsDe!==p.id){P.ands=[];carregarAndamentos(p.id)}
  const pz=p.proximo_prazo?NPUI.prazoTxt(p.proximo_prazo):null;const d=p.dias_para_prazo;const ro=typeof readOnly==="function"&&readOnly();
  const sit=[NPUI.marca(p.status||"—",p.status==="ativo"?"ok":""),p.fase?el("span",{},p.fase):null,p.polo?el("span",{class:"np-sem"},p.polo==="ativo"?"polo ativo":"polo passivo"):null].filter(Boolean);
  const props=NPUI.props([
    ["Situação",el("span",{style:"display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap"},...sit)],
    ["Próximo prazo",pz?[pz.exata," ",pz.rel?el("span",{class:"np-marca "+(d<0?"crit":d<=7?"att":"")},pz.rel):null,p.prazo_fatal?[" ",NPUI.marca("fatal","crit")]:null]:"sem prazo registrado","serif"],
    ["Cliente",p.cliente_id?el("a",{href:"#clientes/"+encodeURIComponent(p.cliente_id),onclick:e=>{e.preventDefault();S.tab="clientes";S.sel=p.cliente_id;S.sub="processos";render()}},p.cliente_nome||"Cliente"):"Fora da base"],
    ["Parte contrária",p.parte_contraria||p.banco||null],["Tipo de ação",[p.area,p.tipo_acao].filter(Boolean).join(" · ")||null],
    ["Tribunal / vara",[p.tribunal,p.vara].filter(Boolean).join(" · ")||null],["Comarca",p.comarca?p.comarca+(p.uf?"/"+p.uf:""):null],
    ["Valor da causa",p.valor_causa?BRL(+p.valor_causa):null],
    ["Responsável",p.responsavel_nome?NPUI.quem(p.responsavel_nome):el("span",{class:"np-sem"},"— ninguém —")],
    ["Pasta",pastaP(p)||null],
    (p.campos_faltando||[]).length?["Cadastro",NPUI.marca("falta: "+p.campos_faltando.join(", "),"att")]:null,
    p.sem_providencia?["Providência",NPUI.marca("30 dias sem andamento nem tarefa","att")]:null,
  ].filter(x=>x&&x[1]!=null));
  const bDJ=NPUI.btn("Atualizar andamentos",{title:"Busca as movimentações do processo. A consulta automática roda uma vez por dia.",onclick:e=>datajudP(p,e.currentTarget)});
  const dj=NPUI.secao("Atualização automática",el("p",{class:"np-nota"},p.datajud_erro?[NPUI.marca("erro na última consulta","att")," ",p.datajud_erro]:p.datajud_atualizado_em?"Movimentações atualizadas em "+new Date(p.datajud_atualizado_em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})+".":"Ainda sem consulta registrada para este processo."),ro||!p.numero_cnj?null:bDJ);
  const carregouA=P.andsDe===p.id&&P.andsOk===p.id;const ands=P.andsDe===p.id?P.ands:[];const MAXA=8;
  const andEl=!carregouA?NPUI.carregando(3):ands.length?NPUI.passos(ands.slice(0,MAXA).map(a=>({estado:"ok",el:el("span",{},el("b",{},fmtD(parseD(a.data))),a.tipo?" · "+a.tipo:"",a.fonte&&a.fonte!=="manual"?[" ",NPUI.marca("automático","info")]:null),
      sub:[el("span",{style:"white-space:pre-wrap"},a.descricao||""),ro?null:el("button",{type:"button",class:"np-link",onclick:()=>window.PP_CARTEIRA?.openAndamentoForm(p,a)},"Editar")].filter(Boolean)})))
    :el("p",{class:"np-nota"},"Nenhum andamento registrado.");
  const secA=NPUI.secao(`Andamentos${carregouA?" ("+ands.length+")":""}`,andEl,carregouA&&ands.length>MAXA?el("p",{class:"np-nota"},`Mais ${ands.length-MAXA} na ficha completa.`):null);
  const pe=[NPUI.btn("Abrir ficha completa",{variante:"pri",title:"Prazos, tarefas, pasta, publicações e todos os andamentos",onclick:()=>window.PP_PROCESSOS.abrir(p.id)}),
    ro?null:NPUI.btn("Editar",{onclick:()=>window.PP_CARTEIRA?.openProcessoForm(null,p)}),ro?null:NPUI.btn("+ Andamento",{variante:"ghost",onclick:()=>window.PP_CARTEIRA?.openAndamentoForm(p)})].filter(Boolean);
  if(!V3.painel)return;
  V3.painel.abrir({trilha:[el("span",{},p.cliente_nome||"Fora da base"),pastaP(p)?el("span",{class:"sep"}):null,pastaP(p)?el("span",{},pastaP(p)):null].filter(Boolean),titulo:p.numero_cnj||"(sem número)",
    corpo:[props,p.observacoes?NPUI.secao("Observações",el("p",{style:"white-space:pre-wrap"},p.observacoes)):null,dj,secA].filter(Boolean),pe,origem,id:p.id});
}
let rt=null;
function tempoReal(){const ch=SB.channel("processos-lista");for(const t of ["processos","andamentos"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>{clearTimeout(rt);rt=setTimeout(()=>{P.ok=false;if(P.sel)carregarAndamentos(P.sel);if(S.tab==="processos")garantir()},500)});ch.subscribe()}
{const _h=window.aplicarHash;window.aplicarHash=function(){const h=(location.hash||"").slice(1);const m=/^processos\/([0-9a-f-]{36})$/i.exec(h);if(m){P.sel=m[1];carregarAndamentos(m[1])}return _h.apply(this,arguments)}}
window.PP_PROCESSOS={lista:()=>{garantir();return P.lista},recarregar:()=>{P.ok=false;garantir()},abrir:(id,opts={})=>{P.sel=id;P.voltar=opts.voltar||null;S.tab="processos";try{localStorage.setItem("pp-tab","processos")}catch(_){}history.replaceState(null,"","#processos/"+id);render()}};
{const _r=render;render=function(){_r();const v=$("#view-processos");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="processos")S.tab="clientes";v.hidden=S.tab!=="processos";if(S.tab==="processos")renderProcessos()}}
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){tempoReal()}});
})();
