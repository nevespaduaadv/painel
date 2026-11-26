/* Publicações do DJEN (Diário de Justiça Eletrônico Nacional) por OAB — aba Publicações (Jurídico).
   Supabase: publicacoes, v_publicacoes, v_publicacoes_resumo, djen_requisicoes; RPCs djen_atualizar(), djen_buscar_periodo(inicio,fim). Só equipe. */
(()=>{
"use strict";
const U={lista:[],resumo:null,procs:[],colab:[],ok:false,carregando:false,periodo:"7",soNaoLidas:false,soSemVinculo:false,fCli:"",q:"",erro:null,aba:"lista",f:{pend:false,semProc:false,naoLidas:false,prazo:false,diverg:false,origem:""},
  sync:{instalada:false,ativo:false,estado:{},revisor:false,fontes:new Map(),prazos:new Map()}};
const hojeISO=(n=0)=>{const d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const nomeCli=id=>(S.clientes.find(c=>c.id===id)||{}).nome||id||"—";

const COLS_PUB=[{k:"data_disponibilizacao",t:"Disponibilizada",f:v=>v?v.split("-").reverse().join("/"):""},{k:"tribunal",t:"Tribunal"},{k:"orgao",t:"Órgão"},{k:"numero_processo",t:"Processo"},{k:"cliente_nome",t:"Cliente"},{k:"tipo_documento",t:"Documento",f:(v,l)=>v||l.tipo_comunicacao||""},{k:"providencia",t:"Providência"},{k:"tratada_por_nome",t:"Tratada por"},{k:"tratada_em",t:"Tratada em",f:v=>v?new Date(v).toLocaleDateString("pt-BR"):""},{k:"tempestiva",t:"No prazo",f:v=>v==null?"":v?"sim":"não"},{k:"atribuidas_para",t:"Tarefa para"},{k:"tarefa_prazo",t:"Prazo da tarefa",f:v=>v?v.split("-").reverse().join("/"):""},{k:"resumo",t:"Resumo",f:v=>(v||"").slice(0,300)}];

async function carregar(){
  if(U.carregando)return;U.carregando=true;
  try{
    let q=SB.from("v_publicacoes").select("*").order("data_disponibilizacao",{ascending:false}).order("id",{ascending:false}).limit(500);
    if(U.periodo!=="todos")q=q.gte("data_disponibilizacao",hojeISO(-Number(U.periodo)));
    const [a,b,c,d]=await Promise.all([q,SB.from("v_publicacoes_resumo").select("*").maybeSingle(),npTodas(()=>SB.from("processos").select("id,cliente_id,numero_cnj,tipo_acao,status").order("numero_cnj").order("id")),SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo").order("nome")]);
    if(a.error)throw a.error;U.lista=a.data||[];U.resumo=b.data||null;U.procs=c.data||[];U.colab=d.data||[];U.ok=true;U.erro=null;
    await carregarSync();
  }catch(e){console.warn("publicacoes",e);U.erro=e;toast("Não foi possível carregar as publicações")}
  finally{U.carregando=false}
  render();
}
/* Integração AtendeDireito Sync (migração 0114). Onde a migração não existe, a leitura falha e a tela segue só com o DJEN. */
async function carregarSync(){
  const y=U.sync;y.fontes=new Map();y.prazos=new Map();y.podeConf=new Map();
  try{
    const i=await SB.from("integracoes").select("ativo,estado,atualizado_em").eq("id","sync").maybeSingle();
    if(i.error||!i.data){y.instalada=false;y.ativo=false;y.estado={};return}
    y.instalada=true;y.ativo=!!i.data.ativo;y.estado=i.data.estado||{};
    try{const rv=await SB.rpc("prazo_revisor");y.revisor=rv.data===true}catch(e){y.revisor=false}   /* quem revisa as situações críticas; o banco confere de novo */
    const ids=U.lista.map(p=>p.id);if(!ids.length)return;
    const [f,z]=await Promise.all([SB.from("publicacao_fontes").select("id,publicacao_id,fonte,casamento,divergencias,conciliada_em,conciliacao,link,primeira_vez").in("publicacao_id",ids),
      SB.from("publicacao_prazos").select("id,publicacao_id,origem,rotulo,data_sugerida,estado,data_conferida,fatal,conferido_por,conferido_por_nome,conferido_em,observacao,tarefa_id,revisao_pendente,revisao_motivo,revisado_por_nome,revisado_em").in("publicacao_id",ids).order("data_sugerida")]);
    for(const r of f.data||[]){if(!y.fontes.has(r.publicacao_id))y.fontes.set(r.publicacao_id,[]);y.fontes.get(r.publicacao_id).push(r)}
    for(const r of z.data||[]){if(!y.prazos.has(r.publicacao_id))y.prazos.set(r.publicacao_id,[]);y.prazos.get(r.publicacao_id).push(r)}
  }catch(e){y.instalada=false}
}
const garantir=()=>{if(!U.ok&&!U.carregando&&!U.erro)carregar();return U.ok};
const recarregar=()=>{U.ok=false;U.erro=null;garantir()};

function renderPublicacoes(){
  const v=$("#view-publicacoes");v.replaceChildren();
  v.classList.toggle("np-v3",pubV3());if(pubV3())return renderPubV3(v);
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Publicações"),el("div",{class:"sub"},"Intimações e comunicações em nome da OAB do escritório. Chegam sozinhas 3× ao dia (dias úteis); quando o processo já está cadastrado, viram andamento e tarefa “Analisar publicação”.")),
    el("div",{class:"actions"},btnExportar("publicacoes",()=>U.lista||[],COLS_PUB),el("button",{class:"btn sm",onclick:buscarPeriodo},"Buscar período…"),el("button",{class:"btn sm primary",onclick:atualizar},"Atualizar agora"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const r=U.resumo||{};
  v.append(el("div",{class:"kpis"},kpi("Últimos 7 dias",String(r.ultimos_7d??0),r.ultima_data?"última em "+fmtD(parseD(r.ultima_data)):"nenhuma ainda"),kpi("Não lidas",String(r.nao_lidas??0),"pendentes de leitura"),
    kpi("Sem processo",String(r.sem_vinculo??0),"vincule ou ignore"),kpi("Última busca",r.ultima_busca?new Date(r.ultima_busca).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—",+(r.erros_recentes||0)?`${r.erros_recentes} erro(s) em 48h`:`${r.total??0} no total`)));
  if(+(r.erros_recentes||0))v.append(el("div",{class:"card section",style:"border-left:3px solid var(--crit)"},el("b",{},"Houve erro nas últimas buscas no DJEN. "),"Se persistir, a API pode estar fora do ar ou bloqueando o servidor; veja a tabela djen_requisicoes no Supabase."));
  const per=sel({"7":"Últimos 7 dias","30":"Últimos 30 dias","90":"Últimos 90 dias","todos":"Tudo"},U.periodo);per.onchange=()=>{U.periodo=per.value;recarregar()};
  const fc=sel({"":"Todos os clientes",...Object.fromEntries([...new Set(U.lista.map(p=>p.cliente_id).filter(Boolean))].map(id=>[id,nomeCli(id)]).sort((a,b)=>a[1].localeCompare(b[1])))},U.fCli);fc.onchange=()=>{U.fCli=fc.value;render()};
  const q=inp("search",U.q,{placeholder:"Buscar no texto, nº do processo ou parte…",style:"min-width:260px"});q.oninput=()=>{U.q=q.value;render()};
  const c1=chk("Só não lidas",U.soNaoLidas,v=>{U.soNaoLidas=v;render()}),c2=chk("Só sem processo",U.soSemVinculo,v=>{U.soSemVinculo=v;render()});
  v.append(el("div",{style:"display:flex;gap:10px;flex-wrap:wrap;align-items:center"},per,fc,q,c1,c2));
  const ql=U.q.trim().toLowerCase();
  const lista=U.lista.filter(p=>(!U.fCli||p.cliente_id===U.fCli)&&(!U.soNaoLidas||(!p.lida&&!p.ignorada))&&(!U.soSemVinculo||p.sem_vinculo)&&(!ql||[p.texto,p.numero_processo,p.orgao,p.cliente_nome,JSON.stringify(p.destinatarios)].join(" ").toLowerCase().includes(ql)));
  if(!lista.length){v.append(el("div",{class:"card empty"},el("h3",{},"Nenhuma publicação"),el("div",{},U.lista.length?"Nada com esses filtros.":"Ainda não há publicações importadas. Use “Buscar período…” para trazer o histórico ou aguarde a próxima busca automática.")));return}
  const grupos=new Map();for(const p of lista){const k=p.data_disponibilizacao;if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(p)}
  for(const [data,ps] of grupos){
    const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},fmtD(parseD(data))),el("span",{class:"note"},`${ps.length} publicaç${ps.length===1?"ão":"ões"}`)));
    sec.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Processo / cliente"),el("th",{},"Tipo"),el("th",{},"Órgão"),el("th",{},"Partes"),el("th",{},"Resumo"),el("th",{},"Tarefa"),el("th",{},""))),
      el("tbody",{},ps.map(p=>el("tr",{"data-pub-id":String(p.id),style:p.ignorada?"opacity:.5":(!p.lida?"font-weight:600":"")},
        el("td",{},el("div",{class:"num"},p.numero_processo||"—"),p.cliente_id?el("div",{class:"note"},p.cliente_nome):p.processo_id?el("span",{class:"pill g"},"fora da base"):p.cliente_sugerido_id?el("div",{},el("span",{class:"pill e2"},"sem processo"),el("div",{class:"note"},"parece ser de ",el("b",{},p.cliente_sugerido_nome))):el("span",{class:"pill e2"},"sem processo")),
        el("td",{},el("div",{},p.tipo_documento||p.tipo_comunicacao||"—"),p.tipo_documento&&p.tipo_comunicacao?el("div",{class:"note"},p.tipo_comunicacao):null),
        el("td",{},el("div",{},p.tribunal||"—"),el("div",{class:"note"},p.orgao||"")),
        el("td",{class:"note"},(p.destinatarios||[]).map(d=>d.nome).filter(Boolean).slice(0,3).join(", ")||"—"),
        el("td",{style:"max-width:380px"},el("div",{class:"note",style:"font-weight:400;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden"},p.resumo||"—")),
        el("td",{},p.tarefa_id?el("button",{class:"pill "+(p.tarefa_status==="concluida"?"e1":"e2"),style:"cursor:pointer;border:0;font:inherit",title:"Abrir a tarefa",onclick:()=>window.PP_TAREFAS?.abrir(p.tarefa_id)},p.tarefa_status==="concluida"?"analisada":"a analisar"+(p.tarefa_prazo?" · "+fmtD(parseD(p.tarefa_prazo)):"")):"—",
          +(p.tarefas_atribuidas||0)?el("div",{class:"note",style:"margin-top:3px"},+(p.tarefas_atribuidas_abertas||0)?"→ "+p.atribuidas_para:`${p.tarefas_atribuidas} tarefa(s) concluída(s)`):null),
        el("td",{},el("div",{style:"display:flex;gap:4px;flex-wrap:wrap"},el("button",{class:"btn sm",onclick:()=>abrir(p)},"Ler"),el("button",{class:"btn sm primary",onclick:()=>atribuir(p)},"Atribuir"),p.sem_vinculo?el("button",{class:"btn sm",onclick:()=>vincular(p)},"Vincular"):null,
          el("button",{class:"btn sm",onclick:()=>marcar(p,{lida:!p.lida})},p.lida?"Não lida":"Lida"),p.sem_vinculo?el("button",{class:"btn sm",onclick:()=>marcar(p,{ignorada:true,lida:true})},"Ignorar"):p.ignorada?el("button",{class:"btn sm",onclick:()=>marcar(p,{ignorada:false})},"Reativar"):null))))))));
    v.append(sec);
  }
}
const chk=(label,on,cb)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;margin:0;accent-color:var(--gold)"});i.checked=!!on;i.onchange=()=>cb(i.checked);return el("label",{style:"display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"},i,label)};
async function marcar(p,patch){const {error}=await SB.from("publicacoes").update(patch).eq("id",p.id);if(error)toast("Não foi possível salvar");else recarregar()}
function abrir(p){
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("div",{class:"note"},[p.tribunal,p.orgao,p.tipo_comunicacao,p.tipo_documento,p.classe].filter(Boolean).join(" · ")),el("div",{class:"num",style:"font-weight:700;margin-top:4px"},p.numero_processo||"—"),p.cliente_nome?el("div",{},"Cliente: ",el("b",{},p.cliente_nome)):null,
    (p.destinatarios||[]).length?el("div",{class:"note"},"Partes: "+(p.destinatarios||[]).map(d=>d.nome+(d.polo?` (${d.polo})`:"")).join("; ")):null,
    el("div",{style:"white-space:pre-wrap;margin-top:10px;max-height:50vh;overflow:auto;font-size:14px"},p.texto||"(sem texto)"),
    p.link?el("div",{style:"margin-top:10px"},el("a",{href:p.link,target:"_blank",rel:"noopener",style:"color:var(--info);font-weight:600"},"↗ abrir no tribunal")):null));
  modal("Publicação de "+fmtD(parseD(p.data_disponibilizacao)),body,async()=>{if(!p.lida)await SB.from("publicacoes").update({lida:true}).eq("id",p.id);recarregar()},el("button",{class:"btn",onclick:()=>atribuir(p)},"Atribuir tarefa…"));
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Marcar como lida";
}
/* Controladoria lê a publicação e abre a tarefa para quem vai tocar o prazo (fica no histórico da tarefa e a pessoa é avisada no sino) */
const TIPOS_TAREFA_PUB={prazo:"Cumprir prazo",manifestar:"Manifestar nos autos",recurso:"Analisar cabimento de recurso",audiencia:"Preparar audiência",cliente:"Comunicar o cliente",diligencia:"Diligência / providência",ciencia:"Só ciência (sem prazo)"};
function atribuir(p){
  const meu=U.colab.find(c=>c.perfil_id===PP.perfil?.id);
  const proc=U.procs.find(x=>x.id===p.processo_id);
  const tipo=sel(TIPOS_TAREFA_PUB,"prazo"),titulo=inp("text","",{placeholder:"Ex.: Contestar — prazo de 15 dias"}),resp=sel({"":"— escolha —",...Object.fromEntries(U.colab.filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},""),
        prazo=inp("date",""),fatal=el("input",{type:"checkbox",style:"width:16px;height:16px;margin:0;accent-color:var(--gold)"}),pri=sel({"1":"Alta","2":"Normal","3":"Baixa"},"1"),
        desc=el("textarea",{rows:5},`Publicação de ${fmtD(parseD(p.data_disponibilizacao))} · ${[p.tribunal,p.orgao,p.tipo_documento||p.tipo_comunicacao].filter(Boolean).join(" · ")}\nProcesso ${p.numero_processo||"s/ nº"}${p.cliente_nome?" · "+p.cliente_nome:""}\n\n${(p.resumo||"").slice(0,400)}`);
  const sug=()=>{if(!titulo.value.trim()||titulo.dataset.auto==="1"){titulo.value=`${TIPOS_TAREFA_PUB[tipo.value]} — ${p.numero_processo||"publicação"}`;titulo.dataset.auto="1"}};
  titulo.oninput=()=>{titulo.dataset.auto="0"};tipo.onchange=sug;sug();
  const body=el("div",{class:"form"},
    el("div",{class:"f full note"},`Publicação de ${fmtD(parseD(p.data_disponibilizacao))} · ${p.numero_processo||"sem número"}${p.cliente_nome?" · "+p.cliente_nome:" · sem cliente na base"}${proc?"":" · processo não vinculado (a tarefa fica sem processo)"}`),
    field("at-tipo","Tipo",tipo),field("at-resp","Para quem",resp),field("at-tit","Título da tarefa",titulo),field("at-prazo","Prazo (vencimento)",prazo),
    window.PP_PRAZOS?window.PP_PRAZOS.campo({alvo:prazo,base:p.data_disponibilizacao,uf:window.PP_PRAZOS.ufDoCnj(p.numero_processo),dias:15,tipo:"uteis"}):null,
    el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},fatal,"Prazo fatal")),field("at-pri","Prioridade",pri),
    field("at-desc","Instruções / comentário",desc,`Quem recebe vê isto na tarefa e é avisado no sino${meu?" como vindo de "+meu.nome:""}.`));
  modal("Atribuir tarefa a partir da publicação",body,async()=>{
    if(!resp.value)throw new Error("Escolha para quem vai a tarefa");
    if(tipo.value!=="ciencia"&&!prazo.value)throw new Error("Informe o prazo (ou marque “Só ciência”)");
    const row={titulo:titulo.value.trim()||TIPOS_TAREFA_PUB[tipo.value],descricao:desc.value.trim()||null,cliente_id:p.cliente_id||null,processo_id:p.processo_id||null,responsavel_id:resp.value,nucleo:"juridico",prazo:prazo.value||null,prazo_fatal:fatal.checked,prioridade:+pri.value,status:"aberta",publicacao_id:p.id};
    const {error}=await SB.from("tarefas").insert(row);if(error)throw new Error("Não foi possível criar a tarefa");
    await SB.from("publicacoes").update({lida:true}).eq("id",p.id);
    toast("Tarefa atribuída");recarregar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Atribuir tarefa";
}
function vincular(p){
  const opts={"":"— escolha o processo —"};for(const x of U.procs)opts[x.id]=`${x.numero_cnj||"s/ nº"} · ${nomeCli(x.cliente_id)}${x.tipo_acao?" · "+x.tipo_acao:""}`;
  const s=sel(opts,"");const cli=sel({"":"— ou crie o processo para o cliente —",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(c=>[c.id,c.nome]))},"");
  const body=el("div",{class:"form"},el("div",{class:"f full note"},"Publicação do processo "+(p.numero_processo||"sem número")+". Vincule a um processo já cadastrado ou crie o processo no cliente certo (o número vem preenchido)."),field("vp-proc","Processo existente",s),field("vp-cli","Criar processo novo no cliente",cli));
  modal("Vincular publicação",body,async()=>{
    if(s.value){const {error}=await SB.from("publicacoes").update({processo_id:s.value}).eq("id",p.id);if(error)throw error}
    else if(cli.value){const {error}=await SB.from("processos").insert({cliente_id:cli.value,numero_cnj:p.numero_processo||null,tribunal:p.tribunal||null,vara:p.orgao||null,tipo_acao:p.classe||null,polo:"passivo",status:"ativo",visivel_cliente:false,fonte:"djen"});if(error)throw new Error(error.code==="23505"?"Já existe processo com esse número — escolha-o na lista":"Não foi possível criar o processo")}
    else throw new Error("Escolha um processo ou um cliente");
    toast("Publicação vinculada");recarregar();
  });
}
async function atualizar(){toast("Verificando novas publicações…");const {data,error}=await SB.rpc("djen_atualizar");if(error){toast("Falha: "+(error.message||""));return}toast(data?`${data} publicação(ões) gravadas`:"Nada novo por enquanto — a busca é assíncrona; tente de novo em 1 minuto");recarregar()}
function buscarPeriodo(){
  const ini=inp("date",hojeISO(-30)),fim=inp("date",hojeISO());
  const body=el("div",{class:"form"},el("div",{class:"f full note"},"Busca todas as publicações da OAB no período (máx. 400 dias por pedido). As páginas chegam aos poucos; clique em “Atualizar agora” ou aguarde o processamento automático (a cada 10 min)."),field("bp-ini","De",ini),field("bp-fim","Até",fim));
  modal("Buscar período",body,async()=>{const {error}=await SB.rpc("djen_buscar_periodo",{inicio:ini.value,fim:fim.value});if(error)throw new Error(error.message||"Falha ao solicitar");toast("Pedido enviado")});
}

/* ---------- V9 · Publicações em V3.1 (lista por situação + painel) com as marcas da integração AtendeDireito Sync ----------
   A tela é UMA: publicações do DJEN e do Sync na mesma lista, com a origem marcada. Prazo vindo da plataforma aparece como
   "prazo a conferir" e só vira prazo do sistema pela conferência do Jurídico (rpc publicacao_prazo_conferir, migração 0114). */
const pubV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const V3={aberta:null,painel:null,manterPop:false};
const TR=()=>window.PP_PUB_TRAT||{};
const PROVL={gerou_prazo:"gerou prazo",nada_a_fazer:"nada a fazer",duplicidade:"duplicidade",encaminhada:"encaminhada",ciencia:"ciência"};
const ROT={djen:"DJEN",sync:"Sync",datajud:"DataJud"};
const dBR=iso=>iso?String(iso).slice(0,10).split("-").reverse().join("/"):"—";
const dhBR=iso=>iso?new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const fontesDe=p=>{const fs=new Set((U.sync.fontes.get(p.id)||[]).map(f=>f.fonte));fs.add(p.id>0?"djen":"sync");return fs};   /* publicação nascida no Sync tem id negativo (0114) */
const origemTxt=p=>["djen","sync","datajud"].filter(k=>fontesDe(p).has(k)).map(k=>ROT[k]).join(" + ");
const prazosDe=p=>U.sync.prazos.get(p.id)||[];
const aConferir=p=>prazosDe(p).filter(z=>z.estado==="sugerido").length;
const emRevisao=p=>prazosDe(p).filter(z=>z.revisao_pendente).length;
const divergDe=p=>(U.sync.fontes.get(p.id)||[]).filter(f=>!f.conciliada_em&&((f.divergencias||[]).length||f.casamento==="provavel"));
const sitP=p=>p.ignorada?"ignorada":p.providencia?"analisada":(p.dias_para_tratar!=null&&p.dias_para_tratar<0)?"vencida":"pendente";
const sitTxt=p=>p.ignorada?"ignorada":p.providencia?(p.providencia==="gerou_prazo"||p.providencia==="encaminhada"||p.tarefa_id?"com providência":"analisada"):p.lida?"pendente de análise":"recebida";
const GRUPOS_PUB=[["vencida","Análise fora do prazo","crit"],["pendente","A analisar","att"],["analisada","Analisadas",""],["ignorada","Ignoradas",""]];
const podeJur=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("juridico");
const limparPub=()=>{Object.assign(U.f,{pend:false,semProc:false,naoLidas:false,prazo:false,diverg:false,origem:""});U.q="";U.fCli=""};
function filtrarPub(){const f=U.f,ql=U.q.trim().toLowerCase();
  return U.lista.filter(p=>(!U.fCli||p.cliente_id===U.fCli)&&(!f.pend||(!p.providencia&&!p.ignorada))&&(!f.semProc||(p.sem_vinculo&&!p.ignorada))&&(!f.naoLidas||(!p.lida&&!p.ignorada))&&(!f.prazo||aConferir(p)>0)&&(!f.diverg||divergDe(p).length>0)&&(!f.origem||fontesDe(p).has(f.origem))
    &&(!ql||[p.texto,p.numero_processo,p.orgao,p.cliente_nome,JSON.stringify(p.destinatarios)].join(" ").toLowerCase().includes(ql)))}
/* 26/11 (sócia): publicação pendente abre direto numa tela só — o conteúdo e as opções de tratamento juntos (era: pop-up de leitura → “Tratar” → segunda tela).
   Ao registrar, a tela fecha, a lista é atualizada e o foco vai para a próxima publicação pendente. Publicação já tratada (ou quem só consulta) segue abrindo o detalhe. */
function abrirPubOuTratar(p,origem){
  const ro=typeof readOnly==="function"&&readOnly();
  if(ro||p.providencia||p.ignorada||!podeJur()||!TR().modalTratar){abrirPainelPub(p,{origem});return}
  const ordem=V3.ordem||[];const i=ordem.indexOf(p.id);const prox=ordem.slice(i+1).concat(ordem.slice(0,Math.max(0,i))).map(id=>U.lista.find(x=>x.id===id)).find(x=>x&&!x.providencia&&!x.ignorada&&x.id!==p.id);
  TR().modalTratar(p,{aoRegistrar:()=>{V3.aberta=null;V3.focar=prox?prox.id:null;V3.tratada=p.id},detalhes:()=>abrirPainelPub(p,{origem})});
}
function linhaPub(p){
  const st=sitP(p),d=p.dias_para_tratar,m=[];
  if(p.sem_vinculo&&!p.ignorada)m.push(NPUI.marca("sem processo","att"));
  const nz=aConferir(p);if(nz){const k=NPUI.marca(nz===1?"prazo a conferir":nz+" prazos a conferir","att");k.title="Prazo sugerido automaticamente. Só vale depois da conferência do Jurídico.";m.push(k)}
  if(emRevisao(p)){const k=NPUI.marca("prazo em revisão","att");k.title="Conferido, aguardando a revisão de quem responde pelo Jurídico";m.push(k)}
  if(divergDe(p).length){const k=NPUI.marca("fontes divergentes","att");k.title="As fontes trazem informações diferentes. Abra para conciliar.";m.push(k)}
  /* 26/11: a marca de origem (DJEN, Sync) saiu da lista — quem trata não precisa saber de onde veio; a origem segue em “Ver integrações” e no histórico */
  if(p.providencia){m.push(NPUI.marca(PROVL[p.providencia]||p.providencia,p.providencia==="gerou_prazo"?"ok":""));if(p.tempestiva===false){const k=NPUI.marca("fora do prazo","crit");k.classList.add("np-so-largo");m.push(k)}}
  const rel=st==="vencida"?`análise vencida há ${-d} d`:st==="pendente"?(d===0?"analisar hoje":p.prazo_tratamento?"analisar até "+dBR(p.prazo_tratamento).slice(0,5):""):"";
  const ctx=[p.cliente_nome||(p.cliente_sugerido_nome?"parece ser de "+p.cliente_sugerido_nome:null),p.tipo_documento||p.tipo_comunicacao,[p.tribunal,p.orgao].filter(Boolean).join(" ")||null,(p.resumo||"").slice(0,140)||null].filter(Boolean).join(" · ");
  const li=NPUI.linha({id:String(p.id),regua:st==="vencida"?"late":st==="pendente"&&d===0?"att":null,atual:V3.aberta===p.id,riscado:!!p.ignorada,
    prazo:{curta:dBR(p.data_disponibilizacao).slice(0,5),rel,exata:"Disponibilizada em "+dBR(p.data_disponibilizacao)+(p.prazo_tratamento&&!p.providencia?" · analisar até "+dBR(p.prazo_tratamento):""),tom:st==="vencida"?"late":""},
    titulo:p.numero_processo||"(sem número)",contexto:ctx,direita:[...m,p.atribuidas_para&&+(p.tarefas_atribuidas_abertas||0)?NPUI.quem(p.atribuidas_para,{title:"Tarefa com "+p.atribuidas_para}):null],titleAbrir:"Abrir a publicação",
    onOpen:x=>abrirPubOuTratar(p,x.querySelector(".np-it-abrir"))});
  if(!p.lida&&!p.ignorada)li.classList.add("np-nao-lida");
  return li;
}
/* estado das fontes: DJEN (busca automática) e Sync (integração). Sem a integração instalada, os comandos do Sync ficam desativados. */
/* 25/11 (sócia): a linha das integrações sai da tela; volta sozinha quando há falha (erro de busca no DJEN ou de conexão com o Sync) ou por “Mais ações → Ver integrações” */
const fontesComProblema=()=>+(U.resumo?.erros_recentes||0)>0||(U.sync?.instalada&&U.sync?.ativo&&U.sync?.estado?.conexao==="erro");
function fontesPub(){
  const r=U.resumo||{},y=U.sync;
  const sync=!y.instalada?["não instalada neste ambiente",""]:!y.ativo?["desligada",""]:y.estado?.conexao==="ok"?["ligada","ok"]:y.estado?.conexao==="erro"?["ligada, com erro de conexão","crit"]:["ligada","att"];
  const b=el("button",{type:"button",class:"np-link","aria-haspopup":"dialog","aria-expanded":"false",onclick:e=>NPUI.pop(e.currentTarget,()=>{
    const adm=PP.perfil?.papel==="admin",inst=!!y.instalada;
    const off=!inst?"A integração não está instalada neste ambiente.":"";
    const chamar=async(rota)=>{const {data:{session}}=await SB.auth.getSession();if(!session)throw new Error("Faça login de novo");
      const r=await fetch(SB_URL+"/functions/v1/sync/"+rota,{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:"{}"});
      const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.erro==="so_administradora"?"Só a administradora pode fazer isso.":j?.erro==="so_juridico"?"Só quem tem acesso ao Jurídico pode sincronizar.":"A integração não respondeu ("+r.status+").");return j||{}};
    const ocupar=async(btn,rotulo,fn)=>{const orig=btn.textContent;btn.disabled=true;btn.textContent=rotulo;try{await fn()}catch(e){toast(e.message||"Não foi possível concluir")}finally{btn.disabled=false;btn.textContent=orig}};
    const testar=e=>ocupar(e.currentTarget,"Testando…",async()=>{const j=await chamar("testar");toast(j.ok?"Conexão com o Sync funcionando":"O Sync recusou a conexão"+(j.categoria?" ("+j.categoria+")":""));await carregarSync()});
    const sincronizar=e=>ocupar(e.currentTarget,"Sincronizando…",async()=>{const j=await chamar("puxar");const z=j.resumo||{};
      if(j.status==="desligada"){toast("A integração está desligada.");return}
      if(j.status==="aguardando_contrato"){toast("A integração ainda não foi liberada para trazer publicações.");return}
      toast(j.status==="erro"?"A sincronização falhou"+(j.categoria?" ("+j.categoria+")":""):`Sincronizado: ${z.novas||0} nova(s), ${z.prazos_sugeridos||0} prazo(s) sugerido(s)`+(j.status==="parcial"?" (parcial)":""));
      NPUI.fecharPop();await recarregar();
      /* autos (capa, partes, movimentos, documentos, audiências): em lotes, até acabar ou o servidor parar de avançar */
      try{let voltas=0,tot=0;for(;;){const k=await chamar("carteira");const zz=k.resumo||{};tot+=zz.atualizados||0;if(k.status==="erro"||!(zz.restantes>0)||!(zz.atualizados>0)||++voltas>=12)break}
        if(tot){toast(`Autos atualizados em ${tot} processo(s)`);window.PP_PROCESSO_SYNC?.invalidar?.();window.PP_PROCESSOS?.recarregar?.()}}catch(_){}});
    const alternar=e=>{const btn=e.currentTarget,ligar=!y.ativo;NPUI.confirmar({titulo:ligar?"Ligar a integração com o Sync?":"Desligar a integração com o Sync?",
      texto:ligar?"O sistema volta a buscar intimações e prazos sugeridos no AtendeDireito Sync.":"O sistema para de buscar no Sync. O que já foi trazido continua no sistema.",rotuloSim:ligar?"Ligar":"Desligar",origem:btn,
      onSim:async()=>{const {error}=await SB.rpc("sync_definir",{p_ativo:ligar,p_config:null});if(error){toast("Não foi possível alterar: "+(error.message||""));return}toast(ligar?"Integração ligada":"Integração desligada");NPUI.fecharPop();await carregarSync();render()}})};
    return [el("div",{class:"np-pop-form np-pub-integ"},el("h4",{},"AtendeDireito Sync"),
      NPUI.props([["Situação",NPUI.marca(sync[0],sync[1])],["Última verificação",y.estado?.verificado_em?dhBR(y.estado.verificado_em):"nunca"],["O que traz","intimações, prazos sugeridos e a origem de cada registro"],["Prazos","sempre como sugestão; só valem depois da conferência do Jurídico"]]),
      el("div",{class:"np-pub-integ-ac"},NPUI.btn("Testar conexão",inst&&adm?{onclick:testar}:{disabled:true,title:off||"Só a administradora testa a conexão."}),NPUI.btn("Sincronizar agora",inst&&y.ativo?{onclick:sincronizar}:{disabled:true,title:off||"Ligue a integração para sincronizar."}),NPUI.btn(y.ativo?"Desligar":"Ligar",inst&&adm?{onclick:alternar}:{disabled:true,title:off||"Só a administradora liga ou desliga a integração."})),
      el("p",{class:"np-nota"},!inst?"Comandos desativados: a integração só é ligada com credencial configurada no servidor e autorização específica.":"A sincronização automática roda de hora em hora, das 8h às 19h. Prazos entram sempre como sugestão."),
      el("div",{style:"display:flex;justify-content:flex-end"},NPUI.btn("Fechar",{onclick:()=>NPUI.fecharPop()})))]},{role:"dialog",label:"Integração AtendeDireito Sync",alinhar:"dir",refoco:()=>$("#view-publicacoes .np-pub-fontes .np-link")})},"Ver integração");
  return el("div",{class:"np-pub-fontes"},el("span",{},el("b",{},"DJEN")," · última busca ",r.ultima_busca?dhBR(r.ultima_busca):"—",+(r.erros_recentes||0)?[" · ",NPUI.marca(`${r.erros_recentes} erro(s) em 48h`,"crit")]:null),
    el("span",{},el("b",{},"AtendeDireito Sync")," · ",NPUI.marca(sync[0],sync[1])," ",b));
}
function filtrosPub(){
  const f=U.f,vivos=U.lista.filter(p=>!p.ignorada),n=fn=>vivos.filter(fn).length,chips=[];const C=o=>{const c=NPUI.chip(o);chips.push(c);return c};
  C({label:"A analisar",n:n(p=>!p.providencia),on:f.pend,grupo:"attr",title:"Ainda sem providência registrada",onclick:()=>{f.pend=!f.pend;render()}});
  C({label:"Sem processo",n:n(p=>p.sem_vinculo),on:f.semProc,grupo:"attr",title:"Publicações de processos que não estão cadastrados",onclick:()=>{f.semProc=!f.semProc;render()}});
  C({label:"Não lidas",n:n(p=>!p.lida),on:f.naoLidas,grupo:"attr",onclick:()=>{f.naoLidas=!f.naoLidas;render()}});
  if(U.sync.instalada){
    C({label:"Prazo a conferir",n:n(p=>aConferir(p)>0),on:f.prazo,grupo:"attr",title:"Prazo sugerido automaticamente, aguardando a conferência do Jurídico",onclick:()=>{f.prazo=!f.prazo;render()}});
    C({label:"Fontes divergentes",n:n(p=>divergDe(p).length>0),on:f.diverg,grupo:"attr",title:"As fontes trazem informações diferentes",onclick:()=>{f.diverg=!f.diverg;render()}});
  }
  const extras=[U.q.trim(),U.fCli,f.origem,U.periodo!=="7"?"p":""].filter(Boolean).length;
  const mais=NPUI.chip({label:"Mais filtros",n:extras||null,on:extras>0,title:"Busca, período, cliente, origem",onclick:e=>NPUI.pop(e.currentTarget,()=>{
    let t=null;const q=el("input",{type:"search",placeholder:"Texto, nº do processo ou parte…",value:U.q,"aria-label":"Buscar publicação",oninput:ev=>{U.q=ev.target.value;clearTimeout(t);t=setTimeout(()=>{V3.manterPop=true;render()},300)}});
    const per=sel({"7":"Últimos 7 dias","30":"Últimos 30 dias","90":"Últimos 90 dias","todos":"Tudo"},U.periodo);per.onchange=()=>{U.periodo=per.value;NPUI.fecharPop();recarregar();render()};
    const fc=sel({"":"Todos os clientes",...Object.fromEntries([...new Set(U.lista.map(p=>p.cliente_id).filter(Boolean))].map(id=>[id,nomeCli(id)]).sort((a,b)=>a[1].localeCompare(b[1])))},U.fCli);fc.onchange=()=>{U.fCli=fc.value;render()};
    const fo=sel({"":"Todas as origens",djen:"DJEN",sync:"AtendeDireito Sync"},f.origem);fo.onchange=()=>{f.origem=fo.value;render()};
    const L=(l,c)=>el("div",{},el("label",{},l),c);
    return [el("div",{class:"np-pop-form"},L("Buscar",q),L("Período",per),L("Cliente",fc),
      el("div",{style:"display:flex;justify-content:space-between;gap:8px"},NPUI.btn("Limpar",{variante:"ghost",onclick:()=>{limparPub();NPUI.fecharPop();render()}}),NPUI.btn("Fechar",{onclick:()=>NPUI.fecharPop()})))]},{role:"dialog",label:"Mais filtros",alinhar:"dir",refoco:()=>$('#view-publicacoes .np-chipf[aria-haspopup="dialog"]')})});
  mais.setAttribute("aria-haspopup","dialog");mais.setAttribute("aria-expanded","false");
  return {chips,fixos:[mais]};
}
function renderPubV3(v){
  V3.painel=null;
  if(!garantir()){if(U.erro&&!U.carregando){v.append(NPUI.faixaErro({texto:"Não foi possível carregar as publicações. Confira a conexão.",onAcao:()=>{recarregar();render()}}));return}v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  const vivos=U.lista.filter(p=>!p.ignorada),nP=vivos.filter(p=>!p.providencia).length,nV=vivos.filter(p=>sitP(p)==="vencida").length,nS=vivos.filter(p=>p.sem_vinculo).length,nZ=vivos.filter(p=>aConferir(p)>0).length,nR=vivos.filter(p=>emRevisao(p)>0).length;
  const resumo=NPUI.resumo([{n:nP,label:"a analisar",tom:nP?"":"zero"},{n:nV,label:"fora do prazo de análise",tom:nV?"crit":"zero"},{n:nS,label:"sem processo",tom:nS?"att":"zero"},U.sync.instalada?{n:nZ,label:nZ===1?"prazo a conferir":"prazos a conferir",tom:nZ?"att":"zero"}:null,U.sync.instalada&&nR?{n:nR,label:nR===1?"prazo em revisão":"prazos em revisão",tom:"att"}:null],{quadros:true});
  const lista=filtrarPub();
  const itensAc=[{label:"Buscar período…",onclick:buscarPeriodo},{label:U.verFontes?"Ocultar integrações":"Ver integrações",onclick:()=>{U.verFontes=!U.verFontes;render()}},{label:"Exportar CSV (lista filtrada)",onclick:()=>{if(!lista.length){toast("Nada para exportar");return}exportarCSV("publicacoes",lista,COLS_PUB);toast(`${lista.length} linha(s) exportada(s)`)}},
    PP.perfil?.papel==="admin"&&TR().limparAntigas?{label:"Dar ciência em lote…",onclick:()=>TR().limparAntigas()}:null].filter(Boolean);
  const maisAc=NPUI.ib("pontos","Mais ações",()=>NPUI.pop(maisAc,itensAc,{label:"Mais ações",alinhar:"dir",refoco:()=>$('#view-publicacoes .np-ib[aria-label="Mais ações"]')}));maisAc.setAttribute("aria-haspopup","menu");maisAc.setAttribute("aria-expanded","false");
  const seg=NPUI.seg([["lista","Publicações"],["rel","Tempestividade"]],U.aba,k=>{U.aba=k;V3.aberta=null;render()},"Vista");
  const fl=U.aba==="lista"?filtrosPub():{chips:[],fixos:[]};
  v.append(NPUI.toolbar({resumo,filtros:U.aba==="lista"?fl.chips:null,filtrosFixos:U.aba==="lista"?fl.fixos:null,direita:[seg,maisAc,NPUI.btn("Atualizar agora",{variante:"pri",title:"Confere agora se chegaram publicações novas",onclick:atualizar})]}),(U.verFontes||fontesComProblema())?fontesPub():null);
  NPUI.reancorarPop();V3.manterPop=false;
  if(U.aba==="rel"){const w=el("div",{class:"np-pf-legado np-pub-rel"});v.append(w);TR().renderRelatorio?TR().renderRelatorio(w):w.append(el("p",{class:"np-nota"},"Relatório indisponível."));return}
  const obra=el("div",{class:"np-obra"}),corpo=el("div",{class:"np-corpo"});
  if(!lista.length)corpo.append(NPUI.vazio(!U.lista.length?{titulo:"Nenhuma publicação no período",texto:"As publicações chegam sozinhas três vezes por dia. Para trazer um período anterior, use “Buscar período”.",acao:"Buscar período",onAcao:buscarPeriodo}
    :{titulo:"Nada com esses filtros",texto:"Tire um filtro para ver as demais publicações.",acao:"Limpar filtros",onAcao:()=>{limparPub();render()}}));
  else{
    let ab={};try{ab=JSON.parse(NPUI.pref.get("np-pub-grupos")||"{}")||{}}catch(e){}
    V3.ordem=GRUPOS_PUB.flatMap(([k])=>lista.filter(p=>sitP(p)===k).map(p=>p.id));
    for(const [k,l,tom] of GRUPOS_PUB){const its=lista.filter(p=>sitP(p)===k);if(!its.length)continue;
      corpo.append(NPUI.grupo({id:"pub-"+k,titulo:l,n:its.length,tom,aberto:ab[k]!=null?ab[k]!==false:(k==="vencida"||k==="pendente"),onToggle:x=>{ab[k]=x;NPUI.pref.set("np-pub-grupos",JSON.stringify(ab))},itens:its.map(linhaPub)}))}
    const fora=U.lista.length-lista.length;
    corpo.append(NPUI.rodape(`${lista.length} ${lista.length===1?"publicação":"publicações"} na lista`+(fora?` · ${fora} fora dos filtros aplicados`:"")+` · ${U.periodo==="todos"?"todo o período":"últimos "+U.periodo+" dias"}`,[["late","análise fora do prazo"],["att","analisar hoje"]]));
  }
  obra.append(corpo);v.append(obra);
  V3.painel=NPUI.painel({obra,label:"Detalhe da publicação",onClose:()=>{V3.aberta=null}});
  if(V3.aberta!=null){const p=U.lista.find(x=>x.id===V3.aberta);if(p)abrirPainelPub(p,{silencioso:true});else V3.aberta=null}
  // depois de um tratamento: foco e destaque na próxima pendente (só quando a lista já foi recarregada e a publicação tratada saiu das pendentes)
  if(V3.focar!=null&&!U.carregando&&!(()=>{const t=U.lista.find(x=>x.id===V3.tratada);return t&&!t.providencia&&!t.ignorada})()){const alvo=v.querySelector(`li[data-id="${CSS.escape(String(V3.focar))}"]`);V3.focar=null;if(alvo){alvo.classList.add("np-pub-prox");const b=alvo.querySelector(".np-it-abrir");requestAnimationFrame(()=>{try{alvo.scrollIntoView({block:"center"});b?.focus({preventScroll:true})}catch(_){}})}}
}
/* conferência humana do prazo sugerido: confirmar, corrigir, descartar ou reabrir */
function conferirPrazo(p,z,dec){
  const data=inp("date",dec==="corrigir"?(z.data_sugerida||""):(z.data_sugerida||"")),fatal=el("input",{type:"checkbox"}),obs=el("textarea",{rows:"3",placeholder:dec==="confirmar"?"Observação (opcional)":"Motivo (obrigatório)"});
  if(dec!=="corrigir")data.disabled=true;
  const T={confirmar:"Confirmar o prazo sugerido",corrigir:"Corrigir o prazo",descartar:"Descartar a sugestão",reabrir:"Reabrir a conferência"}[dec];
  const body=el("div",{class:"form"},el("div",{class:"f full note"},(z.rotulo||"Prazo")+" · sugerido automaticamente: "+dBR(z.data_sugerida)+". A sugestão é automática. Confira nos autos o tipo de ato, a regra processual aplicável e o calendário do juízo antes de registrar. Prazo fatal, data posterior à sugerida e descarte passam por revisão de quem responde pelo Jurídico."),
    dec==="confirmar"||dec==="corrigir"?el("div",{class:"f"},el("label",{},"Data do prazo"),data):null,
    dec==="confirmar"||dec==="corrigir"?el("div",{class:"f"},el("label",{style:"display:flex;gap:8px;align-items:center"},fatal,"Prazo fatal")):null,
    el("div",{class:"f full"},el("label",{},dec==="confirmar"?"Observação":"Motivo"),obs));
  modal(T,body,async()=>{
    if(dec!=="confirmar"&&obs.value.trim().length<5)throw new Error("Informe o motivo.");
    const {error}=await SB.rpc("publicacao_prazo_conferir",{p_prazo:z.id,p_decisao:dec,p_data:dec==="corrigir"?data.value||null:null,p_fatal:fatal.checked,p_obs:obs.value.trim()||null,p_tarefa:true,p_responsavel:null});
    if(error)throw new Error(error.message||"Não foi possível registrar a conferência");
    toast(dec==="descartar"?"Sugestão descartada":dec==="reabrir"?"Conferência reaberta":"Prazo conferido");recarregar()});
  const b=$("button.np-f-salvar")||$("#modalHost button.btn.primary");if(b)b.textContent=dec==="descartar"?"Descartar":dec==="reabrir"?"Reabrir":"Registrar conferência";
}
function revisarPrazo(z,dec){
  if(dec==="aprovar"){SB.rpc("publicacao_prazo_revisar",{p_prazo:z.id,p_decisao:"aprovar",p_obs:null}).then(({error})=>{if(error){toast(error.message||"Não foi possível registrar a revisão");return}toast("Revisão registrada");recarregar()});return}
  const obs=el("textarea",{rows:"3",placeholder:"Motivo (obrigatório)"});
  modal("Devolver para nova conferência",el("div",{class:"form"},el("div",{class:"f full note"},(z.rotulo||"Prazo")+" · conferido por "+(z.conferido_por_nome||"—")+". O prazo volta a “a conferir”; a tarefa não é apagada."),el("div",{class:"f full"},el("label",{},"Motivo"),obs)),async()=>{
    if(obs.value.trim().length<5)throw new Error("Informe o motivo.");
    const {error}=await SB.rpc("publicacao_prazo_revisar",{p_prazo:z.id,p_decisao:"devolver",p_obs:obs.value.trim()});if(error)throw new Error(error.message||"Não foi possível devolver");toast("Devolvido para nova conferência");recarregar()});
  const b=$("button.np-f-salvar")||$("#modalHost button.btn.primary");if(b)b.textContent="Devolver";
}
async function conciliarFonte(f,dec){const {error}=await SB.rpc("publicacao_fonte_conciliar",{p_fonte:f.id,p_decisao:dec});if(error){toast(error.message||"Não foi possível conciliar");return}toast("Conciliação registrada");recarregar()}
function abrirPainelPub(p,{origem}={}){
  V3.aberta=p.id;if(!V3.painel)return;
  const ro=typeof readOnly==="function"&&readOnly(),jur=podeJur()&&!ro;
  const proc=U.procs.find(x=>x.id===p.processo_id);
  const props=NPUI.props([
    ["Situação",[NPUI.marca(sitTxt(p),p.providencia?"ok":sitP(p)==="vencida"?"crit":"att"),p.providencia?el("span",{class:"np-sem"}," · "+(PROVL[p.providencia]||p.providencia)+(p.tratada_por_nome?" · por "+p.tratada_por_nome+" em "+dhBR(p.tratada_em):"")):null,p.tempestiva===false?[" ",NPUI.marca("fora do prazo","crit")]:null]],
    !p.providencia&&p.prazo_tratamento?["Analisar até",dBR(p.prazo_tratamento),"serif"]:null,
    ["Disponibilizada",dBR(p.data_disponibilizacao),"serif"],
    ["Processo",p.processo_id?el("a",{href:"#processos",title:"Abrir a ficha do processo",onclick:e=>{e.preventDefault();window.PP_PROCESSOS?.abrir?.(p.processo_id)}},p.numero_processo||(proc&&proc.numero_cnj)||"abrir"):[p.numero_processo||"—"," ",NPUI.marca("sem processo","att")]],
    ["Cliente",p.cliente_nome||(p.cliente_sugerido_nome?"parece ser de "+p.cliente_sugerido_nome:null)],
    ["Tribunal / órgão",[p.tribunal,p.orgao].filter(Boolean).join(" · ")||null],["Tipo",[p.tipo_comunicacao,p.tipo_documento,p.classe].filter(Boolean).join(" · ")||null],
    ["Partes",(p.destinatarios||[]).map(d=>d.nome+(d.polo?` (${d.polo})`:"")).filter(Boolean).join("; ")||null],
    ["Link",p.link?el("a",{href:p.link,target:"_blank",rel:"noopener"},"abrir no tribunal"):null],
    p.tarefa_id?["Tarefa",el("button",{type:"button",class:"np-link",onclick:()=>window.PP_TAREFAS?.abrir(p.tarefa_id)},(p.tarefa_status==="concluida"?"concluída":"aberta")+(p.tarefa_prazo?" · prazo "+dBR(p.tarefa_prazo):""))]:null,
    +(p.tarefas_atribuidas_abertas||0)?["Atribuída a",NPUI.quem(p.atribuidas_para)]:null,
  ].filter(x=>x&&x[1]!=null));
  /* prazos: sugerido pela plataforma × conferido pelo advogado × registrado (tarefa) */
  const pzs=prazosDe(p);
  /* quem confere: só quem tem atribuição sobre esta publicação (0114b). O banco confere de novo. Sem a 0114b, vale o acesso ao Jurídico. */
  const yc=U.sync;yc.podeConf=yc.podeConf||new Map();let podeConf=yc.podeConf.get(p.id);
  if(pzs.length&&jur&&podeConf===undefined){yc.podeConf.set(p.id,null);SB.rpc("pode_conferir_prazo",{p_publicacao:p.id}).then(({data,error})=>{yc.podeConf.set(p.id,error?true:data===true);if(V3.aberta===p.id)abrirPainelPub(p)},()=>{yc.podeConf.set(p.id,true);if(V3.aberta===p.id)abrirPainelPub(p)})}
  const secPz=pzs.length?NPUI.secao("Prazos",el("p",{class:"np-nota"},"A data sugerida é automática e não é prazo do escritório. Vale a data conferida por alguém do Jurídico."),
    el("ul",{class:"np-pub-pz"},pzs.map(z=>{const conf=z.estado==="confirmado"||z.estado==="corrigido";
      return el("li",{class:"e-"+z.estado},el("div",{class:"t"},el("b",{},z.rotulo||"Prazo")," ",z.estado==="sugerido"?NPUI.marca("a conferir","att"):z.estado==="descartado"?NPUI.marca("descartado"):NPUI.marca(z.estado==="corrigido"?"corrigido":"confirmado","ok"),conf&&z.fatal?[" ",NPUI.marca("fatal","crit")]:null,z.revisao_pendente?[" ",NPUI.marca("aguardando revisão","att")]:null),
        el("dl",{},el("dt",{},"Sugerido"),el("dd",{},dBR(z.data_sugerida)),conf?[el("dt",{},"Conferido"),el("dd",{class:"serif"},dBR(z.data_conferida))]:null,
          z.conferido_em?[el("dt",{},z.estado==="descartado"?"Descartado por":"Conferido por"),el("dd",{},(z.conferido_por_nome||"—")+" em "+dhBR(z.conferido_em))]:null,
          conf?[el("dt",{},"Registrado"),el("dd",{},z.tarefa_id?el("button",{type:"button",class:"np-link",onclick:()=>window.PP_TAREFAS?.abrir(z.tarefa_id)},"na tarefa"):"sem tarefa")]:null,
          z.observacao?[el("dt",{},"Observação"),el("dd",{},z.observacao)]:null,
          z.revisao_pendente?[el("dt",{},"Revisão"),el("dd",{},"pendente · "+(z.revisao_motivo||"situação crítica"))]:z.revisado_em?[el("dt",{},"Revisado por"),el("dd",{},(z.revisado_por_nome||"—")+" em "+dhBR(z.revisado_em))]:null),
        jur&&podeConf===false&&z.estado==="sugerido"?el("p",{class:"np-nota"},"A conferência cabe a quem responde por este processo ou pela carteira de publicações."):null,
        jur&&(podeConf===true||(z.revisao_pendente&&U.sync.revisor&&z.conferido_por!==PP.perfil?.id))?el("div",{class:"ac"},z.estado==="sugerido"?[NPUI.btn("Confirmar",{onclick:()=>conferirPrazo(p,z,"confirmar")}),NPUI.btn("Corrigir",{variante:"ghost",onclick:()=>conferirPrazo(p,z,"corrigir")}),NPUI.btn("Descartar",{variante:"ghost",onclick:()=>conferirPrazo(p,z,"descartar")})]:[...(z.revisao_pendente&&U.sync.revisor&&z.conferido_por!==PP.perfil?.id?[NPUI.btn("Aprovar revisão",{onclick:()=>revisarPrazo(z,"aprovar")}),NPUI.btn("Devolver",{variante:"ghost",onclick:()=>revisarPrazo(z,"devolver")})]:[]),podeConf===true?NPUI.btn("Reabrir",{variante:"ghost",onclick:()=>conferirPrazo(p,z,"reabrir")}):null].filter(Boolean)):null)}))):null;
  const dvs=divergDe(p);
  const secDv=dvs.length?NPUI.secao("Fontes divergentes",el("ul",{class:"np-pub-dv"},dvs.map(f=>el("li",{},el("div",{},el("b",{},ROT[f.fonte]||f.fonte)," · recebida em "+dhBR(f.primeira_vez)),
    el("ul",{},(f.divergencias||[]).map(x=>el("li",{},x.campo==="possivel_duplicata"?"Pode ser a mesma comunicação da publicação "+x.nosso+" (mesmo processo e mesmo dia, texto diferente).":[el("b",{},x.campo),": aqui “",String(x.nosso??"—").slice(0,160),"” · na fonte “",String(x.fonte??"—").slice(0,160),"”"]))),
    jur?el("div",{class:"ac"},NPUI.btn("É a mesma comunicação",{variante:"ghost",onclick:()=>conciliarFonte(f,"mesma")}),NPUI.btn("São comunicações diferentes",{variante:"ghost",onclick:()=>conciliarFonte(f,"outra")})):null)))):null;
  const texto=NPUI.secao("Texto",el("div",{class:"np-pub-texto"},p.texto||"(sem texto)"));
  const pe=ro?[]:[!p.providencia&&TR().modalTratar?NPUI.btn("Tratar",{variante:"pri",title:"Ler, vincular e registrar a providência",onclick:()=>TR().modalTratar(p)}):null,
    NPUI.btn("Atribuir tarefa",{onclick:()=>atribuir(p)}),p.sem_vinculo?NPUI.btn("Vincular",{onclick:()=>vincular(p)}):null,
    p.providencia&&TR().modalHistorico?NPUI.btn("Histórico",{variante:"ghost",onclick:()=>TR().modalHistorico(p)}):null,p.providencia&&TR().reabrir?NPUI.btn("Reabrir",{variante:"ghost",onclick:()=>TR().reabrir(p)}):null,
    NPUI.btn(p.lida?"Marcar como não lida":"Marcar como lida",{variante:"ghost",onclick:()=>marcar(p,{lida:!p.lida})}),
    p.sem_vinculo&&!p.ignorada?NPUI.btn("Ignorar",{variante:"ghost",onclick:()=>marcar(p,{ignorada:true,lida:true})}):p.ignorada?NPUI.btn("Reativar",{variante:"ghost",onclick:()=>marcar(p,{ignorada:false})}):null].filter(Boolean);
  V3.painel.abrir({trilha:[el("span",{},p.cliente_nome||"Sem cliente"),el("span",{class:"sep"}),el("span",{},dBR(p.data_disponibilizacao))],titulo:p.numero_processo||"(sem número)",corpo:[props,secPz,secDv,texto].filter(Boolean),pe,origem,id:String(p.id)});
}

/* ---------- Integração ---------- */
{const _c=window.PP_MOD.contagens;window.PP_MOD.contagens=c=>{const r=_c?_c(c):{};return r}}
{const _r=render;render=function(){_r();const vp=$("#view-publicacoes");if(!vp)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="publicacoes")S.tab="clientes";vp.hidden=S.tab!=="publicacoes";if(S.tab==="publicacoes")renderPublicacoes()}}
window.PP_PUBLICACOES={abrirDetalhe:id=>{const p=U.lista.find(x=>String(x.id)===String(id));if(p)abrirPainelPub(p)},verIntegracoes:(v=true)=>{U.verFontes=!!v;render()},abrirId:id=>{V3.aberta=id;if(S.tab!=="publicacoes"){S.tab="publicacoes";try{location.hash="#publicacoes"}catch(_){}}render()},sync:()=>U.sync,lista:()=>U.lista,colab:()=>U.colab,procs:()=>U.procs,recarregar,abrir,atribuir,vincular,marcar,TIPOS_TAREFA_PUB};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("publicacoes");ch.on("postgres_changes",{event:"*",schema:"public",table:"publicacoes"},()=>{U.ok=false;if(S.tab==="publicacoes")garantir()});ch.subscribe()}});
})();
