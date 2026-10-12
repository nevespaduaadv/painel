/* Processos — lista geral (todos os clientes + processos sem cliente, fora da base). Lê v_processos; detalhe com andamentos.
   Criação/edição e andamentos reaproveitam os formulários de carteira.js (PP_CARTEIRA). Depende de 0035. */
(()=>{
"use strict";
const P={lista:[],ok:false,carregando:false,f:{q:"",cliente:"",status:"ativo",resp:"",semCliente:false},sel:null,ands:[],andsDe:null,colab:[]};
async function carregar(){
  if(P.carregando)return;P.carregando=true;
  try{
    const [a,c]=await Promise.all([SB.from("v_processos").select("*").order("proximo_prazo",{ascending:true,nullsFirst:false}),SB.from("colaboradores").select("id,perfil_id,nome,ativo").order("nome")]);
    if(a.error)throw a.error;P.lista=a.data||[];P.colab=c.data||[];P.ok=true;
  }catch(e){console.warn("processos",e);toast("Não foi possível carregar os processos")}
  finally{P.carregando=false}
  if(S.tab==="processos")render();
}
const garantir=()=>{if(!P.ok&&!P.carregando)carregar();return P.ok};
async function carregarAndamentos(pid){
  P.andsDe=pid;const {data}=await SB.from("andamentos").select("*").eq("processo_id",pid).order("data",{ascending:false});
  if(P.andsDe===pid){P.ands=data||[];if(S.tab==="processos")render()}
}
const prazoPill=p=>{if(!p.proximo_prazo)return el("span",{class:"note"},"—");const d=p.dias_para_prazo;const cls=d<0||d===0?"e3":d<=7?"e2":"g";return el("span",{class:"pill "+cls},fmtD(parseD(p.proximo_prazo)),p.prazo_fatal?" · fatal":"",d<0?` · ${-d}d atrás`:d===0?" · hoje":d<=30?` · em ${d}d`:"")};
function renderProcessos(){
  const v=$("#view-processos");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Processos"),el("div",{class:"sub"},"Todos os processos acompanhados, inclusive os de pessoas fora da base de clientes.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:()=>window.PP_CARTEIRA?.openProcessoForm(null,{})},"+ Processo"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const f=P.f;
  const ativos=P.lista.filter(p=>p.status==="ativo");
  const K=(l,val,h,cls)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v",style:cls?`color:var(--${cls})`:""},String(val)),el("div",{class:"h"},h));
  const semCli=ativos.filter(p=>!p.cliente_id).length,atras=ativos.filter(p=>p.dias_para_prazo!=null&&p.dias_para_prazo<0).length,semProv=ativos.filter(p=>p.sem_providencia).length;
  v.append(el("div",{class:"kpis"},K("Ativos",ativos.length,`${P.lista.length} no total`),K("Prazo vencido",atras,"próximo prazo já passou",atras?"crit":""),K("Sem providência",semProv,"30 dias sem andamento nem tarefa",semProv?"warn":""),K("Sem cliente na base",semCli,"pessoas fora do cadastro")));
  const q=el("input",{class:"search",placeholder:"Nº CNJ, parte, banco, cliente…",value:f.q,oninput:e=>{f.q=e.target.value;render()}});
  const fs=sel({ativo:"Ativos",suspenso:"Suspensos",encerrado:"Encerrados","":"Todos"},f.status);fs.onchange=()=>{f.status=fs.value;render()};
  const fr=sel({"":"Todos os responsáveis",...Object.fromEntries(P.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},f.resp);fr.onchange=()=>{f.resp=fr.value;render()};
  const fc=sel({"":"Todos os clientes","__sem":"Só sem cliente",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome]))},f.cliente);fc.onchange=()=>{f.cliente=fc.value;render()};
  const ql=f.q.trim().toLowerCase();
  const lista=P.lista.filter(p=>(!f.status||p.status===f.status)&&(!f.resp||p.responsavel_id===f.resp)&&(f.cliente==="__sem"?!p.cliente_id:!f.cliente||p.cliente_id===f.cliente)
    &&(!ql||[p.numero_cnj,p.parte_contraria,p.banco,p.cliente_nome,p.tipo_acao,p.tribunal,p.vara].join(" ").toLowerCase().includes(ql)));
  const card=el("div",{class:"card"},el("div",{class:"tbl-tools"},q,fs,fc,fr,el("div",{class:"sp"}),el("span",{class:"note"},`${lista.length} de ${P.lista.length}`)));
  card.append(tabela({cols:[
      {label:"Processo",r:p=>el("div",{},el("span",{class:"t num"},p.numero_cnj||"(sem número)"),el("span",{class:"sub"},[p.tipo_acao,p.tribunal,p.vara].filter(Boolean).join(" · ")))},
      {label:"Cliente",r:p=>p.cliente_id?p.cliente_nome:el("span",{class:"pill g"},"fora da base")},
      {label:"Parte contrária",r:p=>p.parte_contraria||p.banco||"—"},
      {label:"Fase",r:p=>p.fase||"—"},
      {label:"Último andamento",r:p=>p.ultimo_andamento?fmtD(parseD(p.ultimo_andamento)):el("span",{class:"note"},"—")},
      {label:"Próximo prazo",r:p=>prazoPill(p)},
      {label:"Responsável",r:p=>p.responsavel_nome||"—"},
      {label:"Status",r:p=>el("span",{class:"pill "+(p.status==="ativo"?"e1":p.status==="suspenso"?"e2":"g")},p.status)}],
    rows:lista,onRow:p=>{P.sel=P.sel===p.id?null:p.id;if(P.sel)carregarAndamentos(p.id);render()},vazio:"Nenhum processo com esses filtros.",
    acts:p=>[p.cliente_id?btnIco("abrir","Abrir na ficha do cliente",()=>window.PP_CARTEIRA?.abrirProcesso(p.cliente_id,p.id)):null,btnIco("editar","Editar",()=>window.PP_CARTEIRA?.openProcessoForm(null,p))]}));
  v.append(card);
  const p=P.lista.find(x=>x.id===P.sel);
  if(p){
    const ands=P.andsDe===p.id?P.ands:[];
    v.append(el("div",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("div",{class:"eyebrow"},p.cliente_nome||"Fora da base"),el("h2",{},p.numero_cnj||"(sem número)"),el("div",{class:"note"},[p.tipo_acao,p.parte_contraria?"× "+p.parte_contraria:null,p.valor_causa?"valor da causa "+BRL(+p.valor_causa):null,p.responsavel_nome?"resp. "+p.responsavel_nome:null].filter(Boolean).join(" · "))),
        el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>window.PP_CARTEIRA?.openProcessoForm(null,p)},"Editar processo"),el("button",{class:"btn sm",onclick:()=>window.PP_TAREFAS?.nova({processo_id:p.id,cliente_id:p.cliente_id||null,titulo:""})},"+ Tarefa"),el("button",{class:"btn sm primary",onclick:()=>window.PP_CARTEIRA?.openAndamentoForm(p)},"+ Andamento"))),
      p.observacoes?el("div",{class:"note",style:"white-space:pre-wrap"},p.observacoes):null,
      el("h3",{},`Andamentos (${ands.length})`),
      ands.length?el("ul",{class:"tl"},ands.map(a=>el("li",{},el("div",{class:"d"},fmtD(parseD(a.data)),a.tipo?" · "+a.tipo:"",a.fonte&&a.fonte!=="manual"?el("span",{class:"pill c",style:"margin-left:6px"},a.fonte):null),el("div",{style:"white-space:pre-wrap"},a.descricao),
        el("div",{class:"actions",style:"justify-content:flex-start;margin-top:4px"},el("button",{class:"btn sm",onclick:()=>window.PP_CARTEIRA?.openAndamentoForm(p,a)},"Editar"))))):el("div",{class:"note"},P.andsDe===p.id?"Nenhum andamento registrado.":"Carregando…")));
  }
}
let rt=null;
function tempoReal(){const ch=SB.channel("processos-lista");for(const t of ["processos","andamentos"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>{clearTimeout(rt);rt=setTimeout(()=>{P.ok=false;if(P.sel)carregarAndamentos(P.sel);if(S.tab==="processos")garantir()},500)});ch.subscribe()}
{const _h=window.aplicarHash;window.aplicarHash=function(){const h=(location.hash||"").slice(1);const m=/^processos\/([0-9a-f-]{36})$/i.exec(h);if(m){P.sel=m[1];carregarAndamentos(m[1])}return _h.apply(this,arguments)}}
window.PP_PROCESSOS={recarregar:()=>{P.ok=false;garantir()},abrir:id=>{P.sel=id;carregarAndamentos(id);S.tab="processos";render()}};
{const _r=render;render=function(){_r();const v=$("#view-processos");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="processos")S.tab="clientes";v.hidden=S.tab!=="processos";if(S.tab==="processos")renderProcessos()}}
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe())tempoReal()});
})();
