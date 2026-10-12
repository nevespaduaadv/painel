/* Publicações do DJEN (Diário de Justiça Eletrônico Nacional) por OAB — aba Publicações (Jurídico).
   Supabase: publicacoes, v_publicacoes, v_publicacoes_resumo, djen_requisicoes; RPCs djen_atualizar(), djen_buscar_periodo(inicio,fim). Só equipe. */
(()=>{
"use strict";
const U={lista:[],resumo:null,procs:[],colab:[],ok:false,carregando:false,periodo:"30",soNaoLidas:false,soSemVinculo:false,fCli:"",q:""};
const hojeISO=(n=0)=>{const d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const nomeCli=id=>(S.clientes.find(c=>c.id===id)||{}).nome||id||"—";

async function carregar(){
  if(U.carregando)return;U.carregando=true;
  try{
    let q=SB.from("v_publicacoes").select("*").order("data_disponibilizacao",{ascending:false}).order("id",{ascending:false}).limit(500);
    if(U.periodo!=="todos")q=q.gte("data_disponibilizacao",hojeISO(-Number(U.periodo)));
    const [a,b,c,d]=await Promise.all([q,SB.from("v_publicacoes_resumo").select("*").maybeSingle(),SB.from("processos").select("id,cliente_id,numero_cnj,tipo_acao,status").order("numero_cnj"),SB.from("colaboradores").select("id,perfil_id,nome,nucleo,ativo").order("nome")]);
    if(a.error)throw a.error;U.lista=a.data||[];U.resumo=b.data||null;U.procs=c.data||[];U.colab=d.data||[];U.ok=true;
  }catch(e){console.warn("publicacoes",e);toast("Não foi possível carregar as publicações")}
  finally{U.carregando=false}
  render();
}
const garantir=()=>{if(!U.ok&&!U.carregando)carregar();return U.ok};
const recarregar=()=>{U.ok=false;garantir()};

function renderPublicacoes(){
  const v=$("#view-publicacoes");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Publicações"),el("div",{class:"sub"},"Intimações e comunicações do DJEN em nome da OAB do escritório. Chegam sozinhas 3× ao dia (dias úteis); quando o processo já está cadastrado, viram andamento e tarefa “Analisar publicação”.")),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:buscarPeriodo},"Buscar período…"),el("button",{class:"btn sm primary",onclick:atualizar},"Atualizar agora"))));
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
      el("tbody",{},ps.map(p=>el("tr",{style:p.ignorada?"opacity:.5":(!p.lida?"font-weight:600":"")},
        el("td",{},el("div",{class:"num"},p.numero_processo||"—"),p.cliente_id?el("div",{class:"note"},p.cliente_nome):p.processo_id?el("span",{class:"pill g"},"fora da base"):el("span",{class:"pill e2"},"sem processo")),
        el("td",{},el("div",{},p.tipo_documento||p.tipo_comunicacao||"—"),p.tipo_documento&&p.tipo_comunicacao?el("div",{class:"note"},p.tipo_comunicacao):null),
        el("td",{},el("div",{},p.tribunal||"—"),el("div",{class:"note"},p.orgao||"")),
        el("td",{class:"note"},(p.destinatarios||[]).map(d=>d.nome).filter(Boolean).slice(0,3).join(", ")||"—"),
        el("td",{style:"max-width:380px"},el("div",{class:"note",style:"font-weight:400;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden"},p.resumo||"—")),
        el("td",{},p.tarefa_id?el("span",{class:"pill "+(p.tarefa_status==="concluida"?"e1":"e2")},p.tarefa_status==="concluida"?"analisada":"a analisar"+(p.tarefa_prazo?" · "+fmtD(parseD(p.tarefa_prazo)):"")):"—",
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
async function atualizar(){toast("Verificando respostas do DJEN…");const {data,error}=await SB.rpc("djen_atualizar");if(error){toast("Falha: "+(error.message||""));return}toast(data?`${data} publicação(ões) gravadas`:"Nada novo por enquanto — a busca é assíncrona; tente de novo em 1 minuto");recarregar()}
function buscarPeriodo(){
  const ini=inp("date",hojeISO(-30)),fim=inp("date",hojeISO());
  const body=el("div",{class:"form"},el("div",{class:"f full note"},"Pede ao DJEN todas as publicações da OAB no período (máx. 400 dias por pedido). As páginas chegam aos poucos; clique em “Atualizar agora” ou aguarde o processamento automático (a cada 10 min)."),field("bp-ini","De",ini),field("bp-fim","Até",fim));
  modal("Buscar período no DJEN",body,async()=>{const {error}=await SB.rpc("djen_buscar_periodo",{inicio:ini.value,fim:fim.value});if(error)throw new Error(error.message||"Falha ao solicitar");toast("Pedido enviado ao DJEN")});
}

/* ---------- Integração ---------- */
{const _c=window.PP_MOD.contagens;window.PP_MOD.contagens=c=>{const r=_c?_c(c):{};return r}}
{const _r=render;render=function(){_r();const vp=$("#view-publicacoes");if(!vp)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="publicacoes")S.tab="clientes";vp.hidden=S.tab!=="publicacoes";if(S.tab==="publicacoes")renderPublicacoes()}}
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("publicacoes");ch.on("postgres_changes",{event:"*",schema:"public",table:"publicacoes"},()=>{U.ok=false;if(S.tab==="publicacoes")garantir()});ch.subscribe()}});
})();
