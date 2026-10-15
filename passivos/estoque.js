/* Estoque de consumo — Financeiro → Estoque: produtos (Alimentícios/Escritório), entradas/retiradas com saldo automático,
   tarefa de reposição no sistema de tarefas, lista de compras, consumo médio e previsão. Supabase: estoque_produtos, v_estoque,
   v_estoque_movimentos, rpc estoque_movimentar (0064). Só quem tem acesso ao Financeiro. */
(()=>{
"use strict";
const E={ok:false,carregando:false,lista:[],movs:[],aba:"produtos",q:"",cat:"",so:""};
const podeFin=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("financeiro");
const CAT={alimenticios:"Alimentícios",escritorio:"Escritório"};
const UNID={un:"unidade",pct:"pacote",cx:"caixa",kg:"kg",g:"g",l:"litro",ml:"ml",resma:"resma",rolo:"rolo",frasco:"frasco",par:"par"};
const fmtDT=iso=>new Date(iso).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
const n=v=>(+v||0).toLocaleString("pt-BR",{maximumFractionDigits:2});
async function carregar(){
  if(E.carregando)return;E.carregando=true;
  try{const [p,m]=await Promise.all([SB.from("v_estoque").select("*").order("nome"),SB.from("v_estoque_movimentos").select("*").order("criado_em",{ascending:false}).limit(300)]);
    if(p.error)throw p.error;E.lista=p.data||[];E.movs=m.data||[];E.ok=true}
  catch(e){console.warn("estoque",e);toast("Não foi possível carregar o estoque")}finally{E.carregando=false}
  if(S.tab==="estoque")render();
}
const garantir=()=>{if(!E.ok&&!E.carregando)carregar();return E.ok};
const recarregar=()=>{E.ok=false;carregar()};
async function movimentar(p,tipo){
  const qtd=inp("number","",{min:"0",step:"0.5",placeholder:"0"}),obs=inp("text","",{placeholder:tipo==="entrada"?"Ex.: compra no Atacadão, NF 1234":"Ex.: retirada para a copa"});
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`${p.nome} · saldo atual ${n(p.saldo_atual)} ${p.unidade}${p.estoque_minimo?` · mínimo ${n(p.estoque_minimo)}`:""}`),
    field("em-q",tipo==="entrada"?"Quantidade que entrou":tipo==="retirada"?"Quantidade retirada":"Novo saldo (ajuste de contagem)",qtd),field("em-o","Observação",obs));
  modal(tipo==="entrada"?"Entrada: "+p.nome:tipo==="retirada"?"Retirada: "+p.nome:"Ajuste de saldo: "+p.nome,body,async()=>{
    const q=+qtd.value;if(!(q>=0)||(tipo!=="ajuste"&&!(q>0)))throw new Error("Informe a quantidade");
    const {data,error}=await SB.rpc("estoque_movimentar",{p_produto:p.id,p_tipo:tipo,p_quantidade:q,p_observacao:obs.value.trim()||null});
    if(error)throw new Error(error.message.replace(/^.*?:\s*/,""));
    toast(`Saldo de ${p.nome}: ${n(data.saldo)} ${p.unidade}`);recarregar();
  });
  setTimeout(()=>qtd.focus(),50);
}
function openProduto(p={}){
  const nome=inp("text",p.nome||"",{placeholder:"Ex.: Café em pó 500g"}),cat=sel(CAT,p.categoria||"escritorio"),un=sel(UNID,p.unidade||"un"),ini=inp("number",p.id?"":"0",{min:"0",step:"0.5"}),
    min=inp("number",p.estoque_minimo??"",{min:"0",step:"0.5"}),des=inp("number",p.qtd_desejada??"",{min:"0",step:"0.5"}),obs=el("textarea",{rows:2},p.observacoes||"");
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{},"Produto"),nome),field("ep-cat","Categoria",cat),field("ep-un","Unidade",un),
    p.id?null:field("ep-ini","Saldo inicial",ini,"Quantidade em mãos hoje. Depois o saldo só muda por entrada/retirada."),
    field("ep-min","Estoque mínimo",min,"Ao chegar neste valor, abre tarefa de reposição."),field("ep-des","Quantidade desejada após repor",des,"Base para a quantidade sugerida de compra."),field("ep-obs","Observações",obs));
  const extra=p.id?el("button",{class:"btn danger",onclick:async()=>{if(!window.confirm("Desativar este produto? O histórico fica guardado."))return;await SB.from("estoque_produtos").update({ativo:false}).eq("id",p.id);$("#modalHost").replaceChildren();toast("Produto desativado");recarregar()}},"Desativar"):null;
  modal(p.id?"Editar produto":"Novo produto",body,async()=>{
    if(!nome.value.trim())throw new Error("Informe o nome");
    const row={nome:nome.value.trim(),categoria:cat.value,unidade:un.value,estoque_minimo:+min.value||0,qtd_desejada:+des.value||0,observacoes:obs.value.trim()||null};
    const r=p.id?await SB.from("estoque_produtos").update(row).eq("id",p.id):await SB.from("estoque_produtos").insert({...row,saldo_inicial:+ini.value||0});
    if(r.error)throw new Error(/nome_uidx/.test(r.error.message)?"Já existe um produto com esse nome":r.error.message);
    toast("Produto salvo");recarregar();
  },extra);
}
function historico(p){
  const ms=E.movs.filter(m=>m.produto_id===p.id);
  const TIPO={entrada:["Entrada","e1"],retirada:["Retirada","e2"],ajuste:["Ajuste","c"],inicial:["Saldo inicial","g"]};
  const body=el("div",{},el("div",{class:"note",style:"margin-bottom:8px"},`Saldo atual ${n(p.saldo_atual)} ${p.unidade} · consumo médio ${n(p.consumo_semanal)}/semana · ${n(p.consumo_mensal)}/mês${p.previsao_confiavel?` · ~${p.dias_restantes} dia(s) de estoque`:" · previsão: dados insuficientes"}`),
    ms.length?el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Quando"),el("th",{},"Tipo"),el("th",{class:"num"},"Qtd"),el("th",{class:"num"},"Saldo após"),el("th",{},"Quem"),el("th",{},"Obs."))),
      el("tbody",{},ms.map(m=>el("tr",{},el("td",{class:"note"},fmtDT(m.criado_em)),el("td",{},el("span",{class:"pill "+(TIPO[m.tipo]||["",""])[1]},(TIPO[m.tipo]||[m.tipo])[0])),el("td",{class:"num"},n(m.quantidade)),el("td",{class:"num"},n(m.saldo_apos)),el("td",{class:"note"},m.autor_nome||"—"),el("td",{class:"note"},m.observacao||""))))):el("div",{class:"empty"},"Sem movimentações."));
  modal("Movimentações: "+p.nome,body,async()=>{});$("#modalHost button.btn.primary")?.remove();
}
function linha(p){
  const cls=p.zerado?"e3":p.abaixo_minimo?"e2":"e1";
  return el("tr",{style:p.abaixo_minimo?"background:color-mix(in srgb,var(--warn) 7%,transparent)":""},
    el("td",{},el("div",{style:"font-weight:600"},p.nome),el("div",{class:"note"},CAT[p.categoria]||p.categoria,p.observacoes?" · "+p.observacoes:"")),
    el("td",{class:"num"},el("span",{class:"pill "+cls,style:"font-size:13px"},n(p.saldo_atual)+" "+p.unidade)),
    el("td",{class:"num note"},n(p.estoque_minimo)),el("td",{class:"num note"},n(p.qtd_desejada)),
    el("td",{class:"note"},p.previsao_confiavel?`${n(p.consumo_semanal)}/sem · ~${p.dias_restantes}d`:p.consumo_semanal>0?`${n(p.consumo_semanal)}/sem`:"—"),
    el("td",{},p.tarefa_status?el("button",{class:"pill "+(p.tarefa_status==="concluida"?"e1":"e2"),style:"cursor:pointer;border:0;font:inherit",onclick:()=>window.PP_TAREFAS?.abrir(p.tarefa_reposicao_id)},"reposição "+(p.tarefa_status==="em_andamento"?"em andamento":"aberta")+(p.tarefa_responsavel_nome?" · "+p.tarefa_responsavel_nome.split(" ")[0]:"")):el("span",{class:"note"},"—")),
    el("td",{},el("div",{style:"display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"},el("button",{class:"btn sm",title:"Retirada",onclick:()=>movimentar(p,"retirada")},"−"),el("button",{class:"btn sm primary",title:"Entrada",onclick:()=>movimentar(p,"entrada")},"+"),el("button",{class:"btn sm",onclick:()=>historico(p)},"Histórico"),el("button",{class:"btn sm",onclick:()=>openProduto(p)},"Editar"))));
}
function renderEstoque(){
  const v=$("#view-estoque");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Financeiro / Administrativo"),el("h1",{},"Estoque"),el("div",{class:"sub"},"Produtos de consumo: + e − registram entrada e retirada; o saldo só muda por movimentação. Ao bater o mínimo, abre tarefa de reposição.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:()=>openProduto({})},"+ Produto"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const ativos=E.lista.filter(p=>p.ativo);
  const abaixo=ativos.filter(p=>p.abaixo_minimo),zer=ativos.filter(p=>p.zerado),tar=ativos.filter(p=>p.tarefa_status&&p.tarefa_status!=="concluida");
  const comprar=ativos.filter(p=>p.compra_sugerida>0&&(p.abaixo_minimo||p.tarefa_status));
  const K=(l,val,h,cls,aba)=>el("button",{class:"card kpi",style:"text-align:left;cursor:pointer",onclick:()=>{E.aba=aba||"produtos";E.so=aba==="produtos"?"abaixo":"";render()}},el("div",{class:"l"},l),el("div",{class:"v num",style:cls?`color:var(--${cls})`:""},String(val)),el("div",{class:"h"},h));
  v.append(el("div",{class:"kpis"},K("Abaixo do mínimo",abaixo.length,"precisam de reposição",abaixo.length?"warn":"","produtos"),K("Sem estoque",zer.length,"saldo zero",zer.length?"crit":"","produtos"),K("Reposições abertas",tar.length,"tarefas pendentes","","compras"),K("Lista de compras",comprar.length,"produto(s) a comprar","","compras")));
  const tabs=el("div",{class:"tabs"},[["produtos","Produtos"],["compras","Lista de compras"],["movimentos","Movimentações"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(E.aba===k),onclick:()=>{E.aba=k;render()}},l)));
  const q=inp("search",E.q,{placeholder:"Buscar produto…"});q.oninput=()=>{E.q=q.value;render();q.focus();q.setSelectionRange(q.value.length,q.value.length)};
  const fc=sel({"":"Todas as categorias",...CAT},E.cat);fc.onchange=()=>{E.cat=fc.value;render()};
  const fs=sel({"":"Todos","abaixo":"Abaixo do mínimo","ok":"Em dia"},E.so);fs.onchange=()=>{E.so=fs.value;render()};
  v.append(el("div",{class:"card section",style:"flex-direction:row;flex-wrap:wrap;gap:10px;align-items:center"},tabs,q,fc,E.aba==="produtos"?fs:null));
  const norm=x=>String(x||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
  const filtro=p=>(!E.q||norm(p.nome).includes(norm(E.q)))&&(!E.cat||p.categoria===E.cat);
  if(E.aba==="produtos"){
    const lista=ativos.filter(filtro).filter(p=>E.so==="abaixo"?p.abaixo_minimo:E.so==="ok"?!p.abaixo_minimo:true);
    if(!lista.length){v.append(el("div",{class:"card empty"},ativos.length?"Nenhum produto com esse filtro.":"Nenhum produto cadastrado. Comece pelo + Produto."));return}
    for(const [k,l] of Object.entries(CAT)){const ps=lista.filter(p=>p.categoria===k);if(!ps.length)continue;
      v.append(el("div",{class:"card",style:"overflow:auto"},el("div",{class:"section-h",style:"padding:12px 16px 4px"},el("h2",{},l),el("span",{class:"note"},String(ps.length))),
        el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Produto"),el("th",{class:"num"},"Saldo"),el("th",{class:"num"},"Mínimo"),el("th",{class:"num"},"Desejado"),el("th",{},"Consumo / previsão"),el("th",{},"Reposição"),el("th",{}))),el("tbody",{},ps.map(linha)))))}
  }else if(E.aba==="compras"){
    const lista=comprar.filter(filtro).sort((a,b)=>(a.categoria.localeCompare(b.categoria))||(b.zerado-a.zerado)||a.nome.localeCompare(b.nome));
    v.append(el("div",{class:"card",style:"overflow:auto"},el("div",{class:"section-h",style:"padding:12px 16px 4px"},el("h2",{},"Lista consolidada de compras"),el("span",{class:"note"},"quantidade sugerida = desejado − saldo atual; itens com reposição em andamento aparecem marcados")),
      lista.length?el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Produto"),el("th",{},"Categoria"),el("th",{class:"num"},"Saldo"),el("th",{class:"num"},"Mínimo"),el("th",{class:"num"},"Comprar"),el("th",{},"Tarefa"),el("th",{},""))),
        el("tbody",{},lista.map(p=>el("tr",{},el("td",{style:"font-weight:600"},p.nome),el("td",{class:"note"},CAT[p.categoria]),el("td",{class:"num"},n(p.saldo_atual)+" "+p.unidade),el("td",{class:"num note"},n(p.estoque_minimo)),el("td",{class:"num",style:"font-weight:700"},n(p.compra_sugerida)+" "+p.unidade),
          el("td",{},p.tarefa_status?el("button",{class:"pill "+(p.tarefa_status==="em_andamento"?"c":"e2"),style:"cursor:pointer;border:0;font:inherit",onclick:()=>window.PP_TAREFAS?.abrir(p.tarefa_reposicao_id)},p.tarefa_status==="em_andamento"?"em compra":"a comprar"):el("span",{class:"note"},"—")),
          el("td",{},el("button",{class:"btn sm primary",onclick:()=>movimentar(p,"entrada")},"Registrar entrada")))))):el("div",{class:"empty"},"Nada para comprar agora.")));
  }else{
    const ms=E.movs.filter(m=>(!E.q||norm(m.produto_nome).includes(norm(E.q)))&&(!E.cat||m.categoria===E.cat));
    const TIPO={entrada:["Entrada","e1"],retirada:["Retirada","e2"],ajuste:["Ajuste","c"],inicial:["Saldo inicial","g"]};
    v.append(el("div",{class:"card",style:"overflow:auto"},ms.length?el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Quando"),el("th",{},"Produto"),el("th",{},"Tipo"),el("th",{class:"num"},"Qtd"),el("th",{class:"num"},"Saldo após"),el("th",{},"Quem"),el("th",{},"Obs."))),
      el("tbody",{},ms.map(m=>el("tr",{},el("td",{class:"note"},fmtDT(m.criado_em)),el("td",{},m.produto_nome),el("td",{},el("span",{class:"pill "+(TIPO[m.tipo]||["",""])[1]},(TIPO[m.tipo]||[m.tipo])[0])),el("td",{class:"num"},n(m.quantidade)+" "+m.unidade),el("td",{class:"num"},n(m.saldo_apos)),el("td",{class:"note"},m.autor_nome||"—"),el("td",{class:"note"},m.observacao||""))))):el("div",{class:"empty"},"Sem movimentações.")));
  }
}
{const _r=render;render=function(){_r();const v=$("#view-estoque");if(!v)return;if(!podeFin()&&S.tab==="estoque")S.tab="clientes";v.hidden=S.tab!=="estoque";if(S.tab==="estoque")renderEstoque()}}
window.PP_ESTOQUE={recarregar};
window.__PP_LOGIN?.then(()=>{if(podeFin()){SB.channel("estoque").on("postgres_changes",{event:"*",schema:"public",table:"estoque_produtos"},()=>{E.ok=false;if(S.tab==="estoque")garantir()}).subscribe()}});
})();
