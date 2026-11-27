/* Requisições administrativas — férias, folga, horário reduzido (semana de prova), ausência, atestado, home office, outros.
   Cada pessoa pede pelo sistema; administração (admin ou acesso "equipe") aprova/nega com resposta; tudo fica registrado e
   avisado no sino; ausência aprovada entra na agenda do colaborador. Supabase: requisicoes, v_requisicoes (0085). */
(()=>{
"use strict";
const R={lista:[],ok:false,carregando:false,filtro:"pendente"};
const TIPOS={ferias:"Férias",folga:"Folga",horario_reduzido:"Horário reduzido",ausencia:"Ausência",atestado:"Atestado",home_office:"Home office",outro:"Outro"};
const STATUS={pendente:["Pendente","e2"],aprovada:["Aprovada","g"],negada:["Negada","e3"],cancelada:["Cancelada",""]};
const aprova=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("equipe");
const meuColab=()=>window.PP_EQUIPE?.lista?.find(c=>c.perfil_id===PP.perfil?.id)||null;
const fmtD=s=>s?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"";
const fmtDT=iso=>iso?new Date(iso).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"";
const periodo=r=>r.data_inicio===r.data_fim?fmtD(r.data_inicio):fmtD(r.data_inicio)+" a "+fmtD(r.data_fim)+` (${r.dias} dia${r.dias>1?"s":""})`;
async function carregar(){
  if(R.carregando)return;R.carregando=true;
  try{const {data,error}=await SB.from("v_requisicoes").select("*").order("created_at",{ascending:false}).limit(300);if(error)throw error;R.lista=data||[];R.ok=true}
  catch(e){console.warn("requisicoes",e);R.erro=e.message||"erro";toast("Não foi possível carregar as requisições")}finally{R.carregando=false}
  render();
}
const invalidar=()=>{R.ok=false;R.erro=null;render()};
/* nova requisição (qualquer pessoa da equipe) */
function nova(){
  const meu=meuColab();if(!meu){toast("Seu usuário ainda não está vinculado a um colaborador — peça à administração.");return}
  const tipo=sel(TIPOS,"folga"),ini=inp("date",""),fim=inp("date",""),det=el("textarea",{rows:3,placeholder:"Ex.: semana de provas — preciso sair às 16h de segunda a sexta. / Consulta médica na quinta à tarde."}),arq=el("input",{type:"file",multiple:"",accept:".pdf,.jpg,.jpeg,.png,.doc,.docx"});
  ini.onchange=()=>{if(!fim.value||fim.value<ini.value)fim.value=ini.value};
  const body=el("div",{class:"form"},field("rq-tipo","Tipo",tipo),field("rq-ini","De",ini),field("rq-fim","Até",fim),el("div",{class:"f full"},el("label",{},"Detalhe"),det,el("div",{class:"help"},"Vai para a administração/sócias aprovar. Você recebe a resposta no sino e aqui. Férias, folga, ausência, atestado e home office aprovados entram na sua agenda.")),
    el("div",{class:"f full"},el("label",{},"Anexar (atestado, comprovante, declaração da faculdade…)"),arq,el("div",{class:"help"},"Só você e quem aprova veem o arquivo.")));
  modal("Nova requisição",body,async()=>{
    if(!ini.value)throw new Error("Informe a data inicial");if(!fim.value||fim.value<ini.value)throw new Error("Data final inválida");
    if(tipo.value==="outro"&&!det.value.trim())throw new Error("Descreva o pedido");
    if(tipo.value==="atestado"&&!arq.files.length)throw new Error("Anexe o atestado");
    const {data,error}=await SB.from("requisicoes").insert({colaborador_id:meu.id,tipo:tipo.value,data_inicio:ini.value,data_fim:fim.value,detalhe:det.value.trim()||null}).select("id").single();
    if(error)throw new Error(error.message);
    for(const f of arq.files){const nome=f.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w.\-]+/g,"_");const caminho=`requisicoes/${data.id}/${Date.now().toString(36)}-${nome}`;
      const up=await SB.storage.from("anexos").upload(caminho,f,{contentType:f.type||undefined});if(up.error)throw new Error("Falha ao enviar "+f.name+": "+up.error.message);
      const ins=await SB.from("anexos").insert({requisicao_id:data.id,nome:f.name,caminho_storage:caminho,tamanho:f.size,mime:f.type||null});if(ins.error)throw new Error(ins.error.message)}
    toast("Requisição enviada");invalidar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Enviar";
}
async function decidir(r,status){
  const ta=el("textarea",{rows:3,placeholder:status==="aprovada"?"Opcional. Ex.: combinado; compense as horas na semana seguinte.":"Obrigatório. Ex.: período coincide com a audiência do dia 12 — pode ser na semana seguinte?"});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("b",{},r.colaborador_nome+" · "+r.tipo_nome+" · "+periodo(r)),r.detalhe?el("div",{class:"note",style:"white-space:pre-wrap;margin-top:4px"},r.detalhe):null,
    (r.anexos||[]).length?el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"},...(r.anexos||[]).map(a=>el("button",{class:"btn sm",type:"button",onclick:async()=>{const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);if(error||!data?.signedUrl){toast("Não foi possível abrir o anexo");return}window.open(data.signedUrl,"_blank","noopener")}},"📎 "+a.nome))):null),el("div",{class:"f full"},el("label",{},"Resposta"),ta));
  modal((status==="aprovada"?"Aprovar":"Negar")+" requisição",body,async()=>{
    if(status==="negada"&&!ta.value.trim())throw new Error("Diga o motivo");
    const {error}=await SB.from("requisicoes").update({status,resposta:ta.value.trim()||null}).eq("id",r.id);if(error)throw new Error(error.message);
    toast(status==="aprovada"?"Aprovada":"Negada");invalidar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent=status==="aprovada"?"Aprovar":"Negar";
}
async function cancelar(r){const ok=await npConfirmar({titulo:"Cancelar requisição?",mensagem:`A requisição de ${r.tipo_nome||TIPOS[r.tipo]||"solicitação"} (${periodo(r)}) será marcada como cancelada.`,confirmar:"Cancelar requisição",perigo:true});if(!ok)return;const {error}=await SB.from("requisicoes").update({status:"cancelada"}).eq("id",r.id);if(error){toast(error.message);return}toast("Cancelada");invalidar()}
function linha(r,{gestor=false}={}){
  const [st,cls]=STATUS[r.status]||[r.status,""];const meu=meuColab();
  return el("div",{class:"row",style:"cursor:default;align-items:flex-start"},
    el("div",{style:"min-width:0;flex:1"},el("div",{class:"n"},gestor?el("b",{},r.colaborador_nome+" · "):null,r.tipo_nome,el("span",{class:"pill "+cls,style:"margin-left:8px"},st)),
      el("div",{class:"s"},periodo(r)+" · pedido em "+fmtDT(r.created_at)),r.detalhe?el("div",{class:"s",style:"white-space:pre-wrap"},r.detalhe):null,
      (r.anexos||[]).length?el("div",{class:"s",style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"},...(r.anexos||[]).map(a=>el("button",{class:"btn sm",style:"padding:1px 8px;font-size:12px",onclick:async()=>{const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);if(error||!data?.signedUrl){toast("Não foi possível abrir o anexo");return}window.open(data.signedUrl,"_blank","noopener")}},"📎 "+a.nome))):null,
      r.decidido_em?el("div",{class:"s",style:"color:var(--muted)"},(r.status==="aprovada"?"Aprovada":"Negada")+(r.decidido_por_nome?" por "+r.decidido_por_nome:"")+" em "+fmtDT(r.decidido_em)+(r.resposta?" — "+r.resposta:"")):null),
    el("div",{style:"display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end"},
      gestor&&r.status==="pendente"?el("button",{class:"btn sm primary",onclick:()=>decidir(r,"aprovada")},"Aprovar"):null,
      gestor&&r.status==="pendente"?el("button",{class:"btn sm",onclick:()=>decidir(r,"negada")},"Negar"):null,
      !gestor&&r.status==="pendente"&&meu&&r.colaborador_id===meu.id?el("button",{class:"btn sm",onclick:()=>cancelar(r)},"Cancelar"):null));
}
const reqV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const R3={painel:null,obra:null,aberto:null};
const statusReqV3=s=>NPUI.marca(({pendente:"pendente",aprovada:"aprovada",negada:"negada",cancelada:"cancelada"})[s]||s,s==="pendente"?"att":s==="aprovada"?"ok":s==="negada"?"crit":"muted");
function abrirPainelReqV3(r,{gestor=false,origem=null,silencioso=false}={}){
  if(!R3.painel)return;
  R3.aberto=r.id;
  const meu=meuColab();
  const props=NPUI.props([
    ["Colaborador",r.colaborador_nome||"—"],
    ["Tipo",r.tipo_nome||TIPOS[r.tipo]||r.tipo],
    ["Período",periodo(r),"serif"],
    ["Situação",STATUS[r.status]?.[0]||r.status],
    ["Solicitado em",fmtDT(r.created_at),"serif"],
    r.decidido_em?["Decisão",`${r.status==="aprovada"?"Aprovada":"Negada"}${r.decidido_por_nome?" por "+r.decidido_por_nome:""} em ${fmtDT(r.decidido_em)}`]:null
  ].filter(Boolean));
  const corpo=[props,
    r.detalhe?NPUI.secao("Detalhe",el("div",{style:"white-space:pre-wrap"},r.detalhe)):null,
    r.resposta?NPUI.secao("Resposta",el("div",{style:"white-space:pre-wrap"},r.resposta)):null,
    (r.anexos||[]).length?NPUI.secao(`Anexos (${r.anexos.length})`,el("div",{style:"display:flex;gap:6px;flex-wrap:wrap"},...(r.anexos||[]).map(a=>NPUI.btn("📎 "+a.nome,{onclick:async()=>{const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);if(error||!data?.signedUrl){toast("Não foi possível abrir o anexo");return}window.open(data.signedUrl,"_blank","noopener")}})))):null
  ];
  const pe=[];
  if(gestor&&r.status==="pendente"){
    pe.push(NPUI.btn("Aprovar",{variante:"pri",onclick:()=>decidir(r,"aprovada")}));
    pe.push(NPUI.btn("Negar",{onclick:()=>decidir(r,"negada")}));
  }else if(r.status==="pendente"&&meu&&r.colaborador_id===meu.id){
    pe.push(NPUI.btn("Cancelar requisição",{onclick:()=>cancelar(r)}));
  }
  R3.painel.abrir({id:r.id,trilha:"Equipe · Requisição",titulo:`${r.colaborador_nome||""} · ${r.tipo_nome||TIPOS[r.tipo]||""}`.replace(/^\s*·\s*/,""),corpo,pe,origem:silencioso?null:origem});
}
function renderTelaV3(v){
  v.classList.add("np-v3");
  const gestor=aprova();const meu=meuColab();
  const btnNova=NPUI.btn("+ Requisição",{variante:"pri",onclick:nova});
  if(!R.ok){
    if(!R.carregando&&!R.erro)carregar();
    v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"—",label:R.erro?"indisponível":"carregando"}]),direita:[btnNova]}),
      R.erro?NPUI.vazio({titulo:"Não foi possível carregar as requisições",texto:R.erro}):NPUI.carregando(5));
    return;
  }
  const pend=R.lista.filter(r=>r.status==="pendente");
  const hist=R.lista.filter(r=>r.status!=="pendente");
  const minhas=R.lista.filter(r=>meu&&r.colaborador_id===meu.id);
  if(!gestor&&R.filtro!=="minhas")R.filtro="minhas";
  const filtros=gestor?[
    NPUI.chip({label:"Pendentes",on:R.filtro==="pendente",n:pend.length,onclick:()=>{R.filtro="pendente";render()}}),
    NPUI.chip({label:"Histórico",on:R.filtro==="historico",n:hist.length,onclick:()=>{R.filtro="historico";render()}}),
    NPUI.chip({label:"Minhas",on:R.filtro==="minhas",n:minhas.length,onclick:()=>{R.filtro="minhas";render()}})
  ]:[NPUI.chip({label:"Minhas requisições",on:true,n:minhas.length,onclick:()=>{}})];
  v.append(NPUI.toolbar({
    resumo:NPUI.resumo(gestor?[
      {n:String(pend.length),label:pend.length===1?"pendente":"pendentes",tom:pend.length?"att":"zero"},
      {n:String(hist.length),label:"decididas",tom:"zero"}
    ]:[{n:String(minhas.length),label:minhas.length===1?"requisição":"requisições"}]),
    filtros,
    direita:[btnNova]
  }));
  const lista=R.filtro==="minhas"?minhas:R.filtro==="historico"?hist.slice(0,100):pend;
  const corpo=el("div",{class:"np-corpo"});
  const obra=el("div",{class:"np-obra"},corpo);
  R3.obra=obra;R3.painel=NPUI.painel({obra,label:"Detalhe da requisição",onClose:()=>{R3.aberto=null}});
  v.append(obra);
  if(!lista.length){
    corpo.append(NPUI.vazio({titulo:R.filtro==="pendente"?"Nenhuma requisição pendente":"Nenhuma requisição encontrada",texto:"Use “+ Requisição” para solicitar férias, folgas, ausências ou home office."}));
    return;
  }
  const ul=el("ul",{class:"np-lst"});
  for(const r of lista){
    const ctx=[periodo(r)];
    if(r.detalhe)ctx.push(r.detalhe.slice(0,80)+(r.detalhe.length>80?"…":""));
    if((r.anexos||[]).length)ctx.push(`${r.anexos.length} anexo(s)`);
    const direita=[statusReqV3(r.status)];
    if(gestor&&r.status==="pendente"&&R.filtro!=="minhas"){
      direita.push(NPUI.btn("Aprovar",{variante:"pri",onclick:e=>{e.stopPropagation();decidir(r,"aprovada")}}));
    }else if(r.status==="pendente"&&meu&&r.colaborador_id===meu.id){
      direita.push(NPUI.btn("Cancelar",{variante:"ghost",onclick:e=>{e.stopPropagation();cancelar(r)}}));
    }
    ul.append(NPUI.linha({
      id:r.id,
      regua:r.status==="pendente"?"att":r.status==="negada"?"late":null,
      prazo:{curta:fmtD(r.data_inicio).slice(0,5),exata:periodo(r),tom:r.status==="pendente"?"att":""},
      titulo:(gestor&&R.filtro!=="minhas"?`${r.colaborador_nome} · `:"")+(r.tipo_nome||TIPOS[r.tipo]||r.tipo),
      contexto:[ctx.join(" · ")],
      direita,
      atual:R3.aberto===r.id,
      onOpen:liEl=>abrirPainelReqV3(r,{gestor:gestor&&R.filtro!=="minhas",origem:liEl.querySelector(".np-it-abrir")})
    }));
  }
  corpo.append(ul);
  if(R3.aberto){const cur=R.lista.find(x=>x.id===R3.aberto);if(cur)abrirPainelReqV3(cur,{gestor:gestor&&R.filtro!=="minhas",silencioso:true});else R3.aberto=null}
}
/* tela Requisições: gestores veem tudo (fila pendente primeiro); demais veem as suas */
function renderTela(){
  const v=$("#view-requisicoes");if(!v)return;v.replaceChildren();
  if(reqV3()){renderTelaV3(v);return}
  v.classList.remove("np-v3");
  const gestor=aprova();const meu=meuColab();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Equipe"),el("h1",{},"Requisições"),el("div",{class:"sub"},"Pedidos da equipe (férias, folgas, horário reduzido, ausências) para aprovar, alterar e consultar. Os seus ficam em Meu perfil.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:nova},"+ Requisição"))));
  if(!R.ok){if(!R.carregando&&!R.erro)carregar();v.append(el("div",{class:"note"},R.erro?"Não foi possível carregar (o banco ainda não tem a tabela de requisições — rode a migração 0085).":"Carregando…"));return}
  const minhas=R.lista.filter(r=>meu&&r.colaborador_id===meu.id);
  if(gestor){
    const pend=R.lista.filter(r=>r.status==="pendente"),hist=R.lista.filter(r=>r.status!=="pendente");
    v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Pendentes"),el("span",{class:"note"},String(pend.length))),pend.length?el("div",{class:"list"},pend.map(r=>linha(r,{gestor:true}))):el("div",{class:"empty"},"Nenhuma requisição pendente.")));
    v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Histórico"),el("span",{class:"note"},String(hist.length))),hist.length?el("div",{class:"list"},hist.slice(0,100).map(r=>linha(r,{gestor:true}))):el("div",{class:"empty"},"Nada ainda.")));
  }
  if(!gestor||minhas.length)v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Minhas requisições"),el("span",{class:"note"},String(minhas.length))),minhas.length?el("div",{class:"list"},minhas.map(r=>linha(r))):el("div",{class:"empty"},"Você ainda não fez nenhuma requisição.")));
}
/* 26/11 (22h21, sócia): a gestão aprova as requisições no próprio perfil; a tela “Requisições (gestão)” saiu do menu (a rota continua, para o histórico) */
function secaoAprovar(){
  if(!aprova()||!R.ok)return null;const pend=R.lista.filter(r=>r.status==="pendente");
  const sec=el("section",{class:"card section rq-perfil rq-aprovar"});
  sec.append(el("div",{class:"section-h"},el("div",{},el("h2",{},"Requisições para aprovar"),el("div",{class:"note"},pend.length?"Pedidos da equipe aguardando a sua decisão.":"Nenhum pedido aguardando decisão.")),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>{R.filtro="historico";irPara("requisicoes")}},"Ver histórico"))));
  if(pend.length)sec.append(el("div",{class:"list"},pend.slice(0,30).map(r=>linha(r,{gestor:true}))));
  return sec;
}
/* seção em Meu perfil: as requisições da própria pessoa */
function secaoPerfil(){
  const meu=meuColab();const sec=el("section",{class:"card section rq-perfil"});
  sec.append(el("div",{class:"section-h"},el("div",{},el("h2",{},"Minhas requisições"),el("div",{class:"note"},"Férias, folga, horário reduzido, ausência, atestado, home office. A administração aprova e você recebe a resposta aqui e no sino.")),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:nova},"+ Requisição"))));
  if(!R.ok){if(!R.carregando&&!R.erro)carregar();sec.append(el("div",{class:"note"},R.erro?"Indisponível no momento.":"Carregando…"));return sec}
  const minhas=R.lista.filter(r=>meu&&r.colaborador_id===meu.id);
  sec.append(minhas.length?el("div",{class:"list"},minhas.slice(0,30).map(r=>linha(r))):el("div",{class:"empty"},"Você ainda não fez nenhuma requisição."));
  return sec;
}
/* card no Hoje para quem aprova: pendentes */
function cardHoje(){
  if(!aprova())return null;if(!R.ok){if(!R.carregando&&!R.erro)carregar();return null}
  const pend=R.lista.filter(r=>r.status==="pendente");if(!pend.length)return null;
  return el("div",{class:"card rq-hoje",style:"grid-column:1 / -1"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{},"Requisições para aprovar"),el("span",{class:"note"},String(pend.length))),
    el("div",{class:"list"},pend.slice(0,6).map(r=>el("button",{class:"row",onclick:()=>{irPara("perfil")}},el("div",{style:"min-width:0"},el("div",{class:"n"},r.colaborador_nome+" · "+r.tipo_nome),el("div",{class:"s"},periodo(r)+(r.detalhe?" — "+r.detalhe.slice(0,120):""))),el("span",{class:"note num"},fmtDT(r.created_at).slice(0,5))))));
}
{const _r=render;render=function(){_r();const v=$("#view-requisicoes");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="requisicoes")S.tab="clientes";v.hidden=S.tab!=="requisicoes";if(S.tab==="requisicoes")renderTela();
  if(S.tab==="painel"&&eq){const vp=$("#view-painel");const old=vp?.querySelector(".rq-hoje");if(old)old.remove();const c=cardHoje();const grid=vp?.querySelector(".kpis");if(c&&grid)grid.after(c)}
  if(S.tab==="perfil"&&eq){const vp=$("#view-perfil");if(vp&&!vp.querySelector(".note")?.textContent?.startsWith("Carregando")){vp.querySelectorAll(".rq-perfil").forEach(x=>x.remove());const sa=secaoAprovar();if(sa)vp.append(sa);vp.append(secaoPerfil())}}}}
window.PP_REQUISICOES={invalidar,nova};
})();
