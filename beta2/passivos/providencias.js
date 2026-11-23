/* Providências do cliente — checklist com status (a fazer / em andamento / concluída / não se aplica), responsável, prazo e
   observação, na aba Jurídico do cliente. Mostra de relance o que já foi feito (ex.: proteção patrimonial concluída) para o
   jurídico e para quem pega o caso numa execução. Concluir registra no dossiê. Supabase: providencias, v_providencias,
   providencias_padrao() (0086). */
(()=>{
"use strict";
const PV={por:{},carregando:{},colab:null};
const ST={a_fazer:["A fazer","e2"],em_andamento:["Em andamento","c"],concluida:["Concluída","g"],nao_aplicavel:["Não se aplica",""]};
const CAT={estrategico:"Estratégico",patrimonial:"Patrimonial",juridico:"Jurídico",negocial:"Negocial",documentos:"Documentos",outro:"Outro"};
const fmtD=s=>s?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"";
const hoje=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
async function carregar(cid,force){
  if(PV.carregando[cid])return;if(PV.por[cid]&&!force)return;PV.carregando[cid]=true;
  try{const {data,error}=await SB.from("v_providencias").select("*").eq("cliente_id",cid).order("ordem").order("created_at");if(error)throw error;PV.por[cid]=data||[]}
  catch(e){console.warn("providencias",e);PV.por[cid]=[]}finally{PV.carregando[cid]=false}
  render();
}
async function padrao(cid){const {data,error}=await SB.rpc("providencias_padrao",{p_cliente:cid});if(error){toast(error.message);return}toast(data?`${data} providência(s) criada(s)`:"Checklist já estava completo");carregar(cid,true)}
async function form(cid,p){
  if(!PV.colab){const {data}=await SB.from("colaboradores").select("id,nome,perfil_id,ativo").order("nome");PV.colab=data||[]}
  const meu=PV.colab.find(c=>c.perfil_id===PP.perfil?.id);
  const tit=inp("text",p?.titulo||"",{placeholder:"Ex.: Proteção patrimonial"}),cat=sel(CAT,p?.categoria||"juridico"),st=sel(Object.fromEntries(Object.entries(ST).map(([k,[l]])=>[k,l])),p?.status||"a_fazer"),
        resp=sel({"":"—",...Object.fromEntries(PV.colab.filter(c=>c.ativo!==false||c.id===p?.responsavel_id).map(c=>[c.id,c.nome]))},p?.responsavel_id||meu?.id||""),prazo=inp("date",p?.prazo||""),obs=el("textarea",{rows:3,placeholder:"O que foi feito / o que falta. Ex.: holding constituída em 10/10; falta registrar a doação das cotas."},p?.observacao||"");
  const body=el("div",{class:"form"},field("pv-tit","Providência",tit),field("pv-cat","Categoria",cat),field("pv-st","Status",st),field("pv-resp","Responsável",resp),field("pv-prazo","Prazo",prazo),el("div",{class:"f full"},el("label",{},"Observação"),obs,el("div",{class:"help"},"Ao marcar como concluída, vira registro no dossiê do cliente (interno).")));
  const extra=p?el("button",{class:"btn danger",onclick:async()=>{if(!confirm("Excluir esta providência?"))return;const {error}=await SB.from("providencias").delete().eq("id",p.id);$("#modalHost").replaceChildren();if(error){toast(error.message);return}toast("Excluída");carregar(cid,true)}},"Excluir"):null;
  modal(p?"Editar providência":"Nova providência",body,async()=>{
    if(!tit.value.trim())throw new Error("Informe a providência");
    const row={cliente_id:cid,titulo:tit.value.trim(),categoria:cat.value,status:st.value,responsavel_id:resp.value||null,prazo:prazo.value||null,observacao:obs.value.trim()||null};
    const q=p?SB.from("providencias").update(row).eq("id",p.id):SB.from("providencias").insert({...row,ordem:((PV.por[cid]||[]).reduce((m,x)=>Math.max(m,x.ordem),0)||0)+10});
    const {error}=await q;if(error)throw new Error(error.message);toast("Salvo");carregar(cid,true);
  },extra);
}
async function mudar(cid,p,status){
  if(status==="concluida"){const ta=el("textarea",{rows:3,placeholder:"O que foi feito? Ex.: holding constituída; bens integralizados em 10/10."},p.observacao||"");
    modal("Concluir: "+p.titulo,el("div",{class:"form"},el("div",{class:"f full"},el("label",{},"O que foi feito (obrigatório)"),ta,el("div",{class:"help"},"Vai para o dossiê do cliente."))),async()=>{if(!ta.value.trim())throw new Error("Escreva o que foi feito");const {error}=await SB.from("providencias").update({status,observacao:ta.value.trim()}).eq("id",p.id);if(error)throw new Error(error.message);toast("Concluída");carregar(cid,true)});return}
  const {error}=await SB.from("providencias").update({status}).eq("id",p.id);if(error){toast(error.message);return}carregar(cid,true);
}
/* seção na aba Jurídico do cliente */
function secao(c){
  const cid=c.id;const lista=PV.por[cid];if(!lista){carregar(cid);return el("section",{class:"card section"},el("h2",{},"Providências"),el("div",{class:"note"},"Carregando…"))}
  const n=lista.length,ok=lista.filter(p=>p.status==="concluida").length,and=lista.filter(p=>p.status==="em_andamento").length,atr=lista.filter(p=>p.status==="a_fazer"&&p.prazo&&p.prazo<hoje()).length;
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Providências"),el("div",{class:"note"},n?`${ok} de ${n} concluída(s) · ${and} em andamento${atr?` · ${atr} atrasada(s)`:""}`:"O que já foi feito e o que falta para este cliente.")),
    el("div",{class:"actions"},n?null:el("button",{class:"btn sm",onclick:()=>padrao(cid)},"Checklist padrão PJ"),el("button",{class:"btn sm primary",onclick:()=>form(cid)},"+ Providência"))));
  if(n){const barra=el("div",{style:"height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:8px 0 10px"},el("div",{style:`width:${Math.round(ok/n*100)}%;height:100%;background:var(--ok)`}));sec.append(barra);
    sec.append(el("div",{class:"list"},lista.map(p=>{const [sl,cls]=ST[p.status]||[p.status,""];const atrasada=p.status==="a_fazer"&&p.prazo&&p.prazo<hoje();
      return el("div",{class:"row",style:"cursor:default;align-items:flex-start"},
        el("div",{style:"min-width:0;flex:1;cursor:pointer",onclick:()=>form(cid,p)},el("div",{class:"n",style:p.status==="concluida"?"color:var(--muted)":""},el("span",{class:"pill "+cls,style:"margin-right:8px"},sl),p.titulo),
          el("div",{class:"s"},[CAT[p.categoria],p.responsavel_nome,p.prazo?(atrasada?"prazo "+fmtD(p.prazo)+" (atrasada)":"prazo "+fmtD(p.prazo)):null,p.concluida_em?"concluída em "+fmtD(p.concluida_em.slice(0,10)):null].filter(Boolean).join(" · ")),
          p.observacao?el("div",{class:"s",style:"white-space:pre-wrap"},p.observacao):null),
        el("div",{style:"display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end"},
          p.status==="a_fazer"?el("button",{class:"btn sm",onclick:()=>mudar(cid,p,"em_andamento")},"Iniciar"):null,
          p.status!=="concluida"&&p.status!=="nao_aplicavel"?el("button",{class:"btn sm primary",onclick:()=>mudar(cid,p,"concluida")},"Concluir"):null,
          p.status==="concluida"?el("button",{class:"btn sm",onclick:()=>mudar(cid,p,"em_andamento")},"Reabrir"):null))})));}
  else sec.append(el("div",{class:"empty"},"Nenhuma providência ainda. Use o checklist padrão PJ ou adicione uma."));
  return sec;
}
window.PP_PROVIDENCIAS={secao,invalidar:cid=>{delete PV.por[cid];render()}};
})();
