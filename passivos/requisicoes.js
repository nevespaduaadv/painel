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
  catch(e){console.warn("requisicoes",e);toast("Não foi possível carregar as requisições")}finally{R.carregando=false}
  render();
}
const invalidar=()=>{R.ok=false;render()};
/* nova requisição (qualquer pessoa da equipe) */
function nova(){
  const meu=meuColab();if(!meu){toast("Seu usuário ainda não está vinculado a um colaborador — peça à administração.");return}
  const tipo=sel(TIPOS,"folga"),ini=inp("date",""),fim=inp("date",""),det=el("textarea",{rows:3,placeholder:"Ex.: semana de provas — preciso sair às 16h de segunda a sexta. / Consulta médica na quinta à tarde."});
  ini.onchange=()=>{if(!fim.value||fim.value<ini.value)fim.value=ini.value};
  const body=el("div",{class:"form"},field("rq-tipo","Tipo",tipo),field("rq-ini","De",ini),field("rq-fim","Até",fim),el("div",{class:"f full"},el("label",{},"Detalhe"),det,el("div",{class:"help"},"Vai para a administração/sócias aprovar. Você recebe a resposta no sino e aqui. Férias, folga, ausência, atestado e home office aprovados entram na sua agenda.")));
  modal("Nova requisição",body,async()=>{
    if(!ini.value)throw new Error("Informe a data inicial");if(!fim.value||fim.value<ini.value)throw new Error("Data final inválida");
    if(tipo.value==="outro"&&!det.value.trim())throw new Error("Descreva o pedido");
    const {error}=await SB.from("requisicoes").insert({colaborador_id:meu.id,tipo:tipo.value,data_inicio:ini.value,data_fim:fim.value,detalhe:det.value.trim()||null});
    if(error)throw new Error(error.message);toast("Requisição enviada");invalidar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Enviar";
}
async function decidir(r,status){
  const ta=el("textarea",{rows:3,placeholder:status==="aprovada"?"Opcional. Ex.: combinado; compense as horas na semana seguinte.":"Obrigatório. Ex.: período coincide com a audiência do dia 12 — pode ser na semana seguinte?"});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("b",{},r.colaborador_nome+" · "+r.tipo_nome+" · "+periodo(r)),r.detalhe?el("div",{class:"note",style:"white-space:pre-wrap;margin-top:4px"},r.detalhe):null),el("div",{class:"f full"},el("label",{},"Resposta"),ta));
  modal((status==="aprovada"?"Aprovar":"Negar")+" requisição",body,async()=>{
    if(status==="negada"&&!ta.value.trim())throw new Error("Diga o motivo");
    const {error}=await SB.from("requisicoes").update({status,resposta:ta.value.trim()||null}).eq("id",r.id);if(error)throw new Error(error.message);
    toast(status==="aprovada"?"Aprovada":"Negada");invalidar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent=status==="aprovada"?"Aprovar":"Negar";
}
async function cancelar(r){if(!confirm("Cancelar esta requisição?"))return;const {error}=await SB.from("requisicoes").update({status:"cancelada"}).eq("id",r.id);if(error){toast(error.message);return}toast("Cancelada");invalidar()}
function linha(r,{gestor=false}={}){
  const [st,cls]=STATUS[r.status]||[r.status,""];const meu=meuColab();
  return el("div",{class:"row",style:"cursor:default;align-items:flex-start"},
    el("div",{style:"min-width:0;flex:1"},el("div",{class:"n"},gestor?el("b",{},r.colaborador_nome+" · "):null,r.tipo_nome,el("span",{class:"pill "+cls,style:"margin-left:8px"},st)),
      el("div",{class:"s"},periodo(r)+" · pedido em "+fmtDT(r.created_at)),r.detalhe?el("div",{class:"s",style:"white-space:pre-wrap"},r.detalhe):null,
      r.decidido_em?el("div",{class:"s",style:"color:var(--muted)"},(r.status==="aprovada"?"Aprovada":"Negada")+(r.decidido_por_nome?" por "+r.decidido_por_nome:"")+" em "+fmtDT(r.decidido_em)+(r.resposta?" — "+r.resposta:"")):null),
    el("div",{style:"display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end"},
      gestor&&r.status==="pendente"?el("button",{class:"btn sm primary",onclick:()=>decidir(r,"aprovada")},"Aprovar"):null,
      gestor&&r.status==="pendente"?el("button",{class:"btn sm",onclick:()=>decidir(r,"negada")},"Negar"):null,
      !gestor&&r.status==="pendente"&&meu&&r.colaborador_id===meu.id?el("button",{class:"btn sm",onclick:()=>cancelar(r)},"Cancelar"):null));
}
/* tela Requisições: gestores veem tudo (fila pendente primeiro); demais veem as suas */
function renderTela(){
  const v=$("#view-requisicoes");if(!v)return;v.replaceChildren();const gestor=aprova();const meu=meuColab();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Equipe"),el("h1",{},"Requisições"),el("div",{class:"sub"},gestor?"Pedidos da equipe (férias, folgas, horário reduzido, ausências) para aprovar. Tudo fica registrado.":"Seus pedidos à administração: férias, folga, horário reduzido, ausência, atestado, home office.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:nova},"+ Requisição"))));
  if(!R.ok){if(!R.carregando)carregar();v.append(el("div",{class:"note"},"Carregando…"));return}
  const minhas=R.lista.filter(r=>meu&&r.colaborador_id===meu.id);
  if(gestor){
    const pend=R.lista.filter(r=>r.status==="pendente"),hist=R.lista.filter(r=>r.status!=="pendente");
    v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Pendentes"),el("span",{class:"note"},String(pend.length))),pend.length?el("div",{class:"list"},pend.map(r=>linha(r,{gestor:true}))):el("div",{class:"empty"},"Nenhuma requisição pendente.")));
    v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Histórico"),el("span",{class:"note"},String(hist.length))),hist.length?el("div",{class:"list"},hist.slice(0,100).map(r=>linha(r,{gestor:true}))):el("div",{class:"empty"},"Nada ainda.")));
  }
  if(!gestor||minhas.length)v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Minhas requisições"),el("span",{class:"note"},String(minhas.length))),minhas.length?el("div",{class:"list"},minhas.map(r=>linha(r))):el("div",{class:"empty"},"Você ainda não fez nenhuma requisição.")));
}
/* card no Hoje para quem aprova: pendentes */
function cardHoje(){
  if(!aprova())return null;if(!R.ok){if(!R.carregando)carregar();return null}
  const pend=R.lista.filter(r=>r.status==="pendente");if(!pend.length)return null;
  return el("div",{class:"card rq-hoje",style:"grid-column:1 / -1"},el("div",{class:"section-h",style:"padding:14px 18px;border-bottom:1px solid var(--line)"},el("h2",{},"Requisições para aprovar"),el("span",{class:"note"},String(pend.length))),
    el("div",{class:"list"},pend.slice(0,6).map(r=>el("button",{class:"row",onclick:()=>{S.tab="requisicoes";try{localStorage.setItem("pp-tab","requisicoes")}catch(_){}render()}},el("div",{style:"min-width:0"},el("div",{class:"n"},r.colaborador_nome+" · "+r.tipo_nome),el("div",{class:"s"},periodo(r)+(r.detalhe?" — "+r.detalhe.slice(0,120):""))),el("span",{class:"note num"},fmtDT(r.created_at).slice(0,5))))));
}
{const _r=render;render=function(){_r();const v=$("#view-requisicoes");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="requisicoes")S.tab="clientes";v.hidden=S.tab!=="requisicoes";if(S.tab==="requisicoes")renderTela();
  if(S.tab==="painel"&&eq){const vp=$("#view-painel");const old=vp?.querySelector(".rq-hoje");if(old)old.remove();const c=cardHoje();const grid=vp?.querySelector(".kpis");if(c&&grid)grid.after(c)}}}
window.PP_REQUISICOES={invalidar,nova};
})();
