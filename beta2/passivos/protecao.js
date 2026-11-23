/* Proteção patrimonial e operacional — bloco no Cadastro do cliente (abaixo do Fluxo PJ): status de proteção de cada bem,
   medidas operacionais (escrow, gestora, CNPJ espelho, recebíveis…) e encerramento do ciclo de 45 dias (R1/R2/R3) com a
   atualização final dos encaminhamentos. Tudo vira registro no dossiê (frente Estratégico), sem notificação; Acordos e
   Jurídico veem o resumo no cabeçalho do cliente e nas abas Negocial/Jurídico. Edita só a frente Estratégico / Acompanhamento PJ.
   Supabase: bens.protecao*, medidas_operacionais, cliente_medidas, v_protecao_cliente, ciclo_concluir() (0092). */
(()=>{
"use strict";
const P={cache:{},medidas:null,resumo:{},colab:null};
const ST_BEM={exposto:["Exposto","e3"],em_protecao:["Em proteção","e2"],protegido:["Protegido","g"],nao_protegivel:["Não protegível",""]};
const ST_MED={a_fazer:["A fazer","e2"],em_andamento:["Em andamento","c"],implementada:["Implementada","g"],nao_se_aplica:["Não se aplica",""]};
const INSTR={gestora:"Empresa gestora / holding",integralizacao:"Integralização de capital",doacao_reserva:"Doação com reserva de usufruto",alienacao:"Alienação",seguro:"Seguro",usufruto:"Usufruto",bem_familia:"Bem de família",outro:"Outro"};
const fmtD=s=>s?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"";
const hoje=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
const meuColab=()=>P.colab?.find(c=>c.perfil_id===PP.perfil?.id);
const podeEditar=()=>{if(PP.perfil?.papel==="admin")return true;const m=meuColab();return !!m&&(m.frente==="estrategico"||["acompanhamento_pj","pos_vendas","socios"].includes(m.nucleo))};
async function carregar(cid,force){
  if(P.cache[cid]?.carregando)return;if(P.cache[cid]?.ok&&!force)return;P.cache[cid]={carregando:true};
  try{const [b,m,cm,r,co]=await Promise.all([SB.from("bens").select("*").eq("cliente_id",cid).order("created_at"),P.medidas?{data:P.medidas}:SB.from("medidas_operacionais").select("*").eq("ativo",true).order("ordem"),SB.from("cliente_medidas").select("*").eq("cliente_id",cid),SB.from("v_protecao_cliente").select("*").eq("cliente_id",cid).maybeSingle(),P.colab?{data:P.colab}:SB.from("colaboradores").select("id,nome,perfil_id,nucleo,frente,ativo").order("nome")]);
    P.medidas=m.data||[];P.colab=co.data||[];P.cache[cid]={ok:true,bens:b.data||[],medidas:cm.data||[]};P.resumo[cid]=r.data||null}
  catch(e){console.warn("protecao",e);P.cache[cid]={ok:true,bens:[],medidas:[],erro:true}}
  render();
}
const invalidar=cid=>{if(cid)delete P.cache[cid];else P.cache={};render()};
const selColab=v=>sel({"":"—",...Object.fromEntries((P.colab||[]).filter(c=>c.ativo!==false||c.id===v).map(c=>[c.id,c.nome]))},v||"");
/* bem: status de proteção */
function formBem(c,b){
  const st=sel(Object.fromEntries(Object.entries(ST_BEM).map(([k,[l]])=>[k,l])),b.protecao||"exposto"),ins=sel({"":"—",...INSTR},b.protecao_instrumento||""),dt=inp("date",b.protecao_em||""),resp=selColab(b.protecao_responsavel_id||meuColab()?.id),nota=el("textarea",{rows:3,placeholder:"Ex.: imóvel integralizado na gestora (matrícula averbada em 10/11); veículo alienado a terceiro."},b.protecao_nota||"");
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("b",{},b.descricao),el("div",{class:"note"},[b.tipo,b.titular,b.onus].filter(Boolean).join(" · "))),field("pb-st","Situação",st),field("pb-ins","Instrumento",ins),field("pb-dt","Data",dt),field("pb-resp","Responsável",resp),el("div",{class:"f full"},el("label",{},"Nota"),nota,el("div",{class:"help"},"Ao mudar a situação, vira registro no dossiê do cliente (frente Estratégico).")));
  modal("Proteção do bem",body,async()=>{const {error}=await SB.from("bens").update({protecao:st.value,protecao_instrumento:ins.value||null,protecao_em:dt.value||null,protecao_responsavel_id:resp.value||null,protecao_nota:nota.value.trim()||null}).eq("id",b.id);if(error)throw new Error(error.message);toast("Salvo");invalidar(c.id);window.PP_DOSSIE?.invalidar?.(c.id)});
}
/* medida operacional */
function formMedida(c,m,atual){
  const st=sel(Object.fromEntries(Object.entries(ST_MED).map(([k,[l]])=>[k,l])),atual?.status||"a_fazer"),dt=inp("date",atual?.data||""),resp=selColab(atual?.responsavel_id||meuColab()?.id),nota=el("textarea",{rows:3,placeholder:"Ex.: conta escrow aberta no Sicoob; recebíveis da Stone migrados em 05/11."},atual?.nota||"");
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("b",{},m.nome),m.descricao?el("div",{class:"note"},m.descricao):null),field("pm-st","Situação",st),field("pm-dt","Data",dt),field("pm-resp","Responsável",resp),el("div",{class:"f full"},el("label",{},"Nota"),nota,el("div",{class:"help"},"Em andamento / implementada vira registro no dossiê.")));
  modal(m.nome,body,async()=>{const {error}=await SB.from("cliente_medidas").upsert({cliente_id:c.id,medida_id:m.id,status:st.value,data:dt.value||null,responsavel_id:resp.value||null,nota:nota.value.trim()||null},{onConflict:"cliente_id,medida_id"});if(error)throw new Error(error.message);toast("Salvo");invalidar(c.id);window.PP_DOSSIE?.invalidar?.(c.id)});
}
function concluirCiclo(c,st){
  const pend=P.medidas.filter(m=>!st.medidas.find(x=>x.medida_id===m.id)||st.medidas.find(x=>x.medida_id===m.id).status==="a_fazer");
  const ta=el("textarea",{rows:6,placeholder:"Resumo final para Acordos e Jurídico: o que foi protegido, o que ficou em andamento, o que não se aplica e por quê, próximos passos."});
  const body=el("div",{class:"form"},pend.length?el("div",{class:"f full",style:"color:var(--crit)"},`Ainda há ${pend.length} medida(s) sem situação definida: ${pend.map(m=>m.nome).join(", ")}. Marque cada uma (em andamento, implementada ou não se aplica) antes de concluir.`):null,el("div",{class:"f full"},el("label",{},"Atualização final dos encaminhamentos (obrigatório)"),ta,el("div",{class:"help"},"Fica gravada no cliente e no dossiê; marca a providência “Proteção patrimonial” como concluída.")));
  modal("Concluir ciclo de onboarding (45 dias)",body,async()=>{if(pend.length)throw new Error("Defina a situação das medidas pendentes");if(!ta.value.trim())throw new Error("Escreva a atualização final");const {error}=await SB.rpc("ciclo_concluir",{p_cliente:c.id,p_resumo:ta.value.trim()});if(error)throw new Error(error.message);toast("Ciclo concluído");invalidar(c.id);window.PP_DOSSIE?.invalidar?.(c.id);window.PP_PROVIDENCIAS?.invalidar?.(c.id);try{S.clientes&&(location.hash=location.hash)}catch(_){}});
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Concluir ciclo";
}
/* card no Cadastro */
function card(c){
  const st=P.cache[c.id];if(!st?.ok){carregar(c.id);return el("section",{class:"card section"},el("h2",{},"Proteção patrimonial e operacional"),el("div",{class:"note"},"Carregando…"))}
  const r=P.resumo[c.id]||{};const edita=podeEditar();const bens=st.bens;const prot=bens.filter(b=>b.protecao==="protegido").length,andB=bens.filter(b=>b.protecao==="em_protecao").length,expB=bens.filter(b=>b.protecao==="exposto").length;
  const medidas=P.medidas.map(m=>({m,a:st.medidas.find(x=>x.medida_id===m.id)}));const impl=medidas.filter(x=>x.a?.status==="implementada").length,andM=medidas.filter(x=>x.a?.status==="em_andamento").length,aFazer=medidas.filter(x=>!x.a||x.a.status==="a_fazer").length;
  const ciclo=r.ciclo_concluido_em?`Ciclo de onboarding concluído em ${fmtD(r.ciclo_concluido_em)}${r.ciclo_por?" por "+r.ciclo_por:""}`:(r.dias_de_ciclo!=null?`Ciclo de onboarding: dia ${r.dias_de_ciclo} de 45${r.dias_de_ciclo>45?" — prazo estourado":""}`:"Ciclo de onboarding: data do onboarding não informada no cadastro");
  const sec=el("section",{class:"card section",id:"protecao"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Proteção patrimonial e operacional"),el("div",{class:"note"},ciclo+(edita?"":" · só a frente Estratégico / Acompanhamento PJ edita"))),
    el("div",{class:"actions"},edita?el("button",{class:"btn sm",onclick:()=>window.PP_FICHA?.openBemForm?.(c)},"+ Bem"):null,edita&&!r.ciclo_concluido_em?el("button",{class:"btn sm primary",onclick:()=>concluirCiclo(c,st)},"Concluir ciclo de onboarding"):null,PP.perfil?.papel==="admin"&&r.ciclo_concluido_em?el("button",{class:"btn sm",onclick:async()=>{if(!confirm("Reabrir o ciclo?"))return;const {error}=await SB.rpc("ciclo_reabrir",{p_cliente:c.id});if(error){toast(error.message);return}invalidar(c.id)}},"Reabrir"):null)));
  // bens
  sec.append(el("h3",{style:"margin-top:8px"},"Bens",el("span",{class:"note",style:"margin-left:8px;font-weight:400"},bens.length?`${prot} protegido(s) · ${andB} em proteção · ${expB} exposto(s)`:"nenhum bem declarado — use “+ Bem”")));
  if(bens.length)sec.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Bem"),el("th",{},"Situação"),el("th",{},"Instrumento"),el("th",{},"Quando"),el("th",{},"Responsável"),el("th",{}))),
    el("tbody",{},bens.map(b=>{const [l,cls]=ST_BEM[b.protecao||"exposto"];const resp=P.colab.find(x=>x.id===b.protecao_responsavel_id)?.nome;return el("tr",{},el("td",{},el("b",{},b.descricao),el("div",{class:"note"},[b.titular,b.onus].filter(Boolean).join(" · ")),b.protecao_nota?el("div",{class:"note",style:"white-space:pre-wrap"},b.protecao_nota):null),el("td",{},el("span",{class:"pill "+cls},l)),el("td",{},INSTR[b.protecao_instrumento]||"—"),el("td",{class:"num"},b.protecao_em?fmtD(b.protecao_em):"—"),el("td",{},resp||"—"),el("td",{class:"r"},edita?el("button",{class:"btn sm",onclick:()=>formBem(c,b)},"Atualizar"):null))})))));
  // medidas
  sec.append(el("h3",{style:"margin-top:12px"},"Operação",el("span",{class:"note",style:"margin-left:8px;font-weight:400"},P.medidas.length?`${impl} implementada(s) · ${andM} em andamento · ${aFazer} a definir`:"nenhuma medida cadastrada (Gestão → Configurações)")));
  if(P.medidas.length)sec.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Medida"),el("th",{},"Situação"),el("th",{},"Quando"),el("th",{},"Responsável"),el("th",{},"Nota"),el("th",{}))),
    el("tbody",{},medidas.map(({m,a})=>{const [l,cls]=ST_MED[a?.status||"a_fazer"];const resp=P.colab.find(x=>x.id===a?.responsavel_id)?.nome;return el("tr",{style:a?.status==="nao_se_aplica"?"color:var(--muted)":""},el("td",{},el("b",{},m.nome),m.descricao?el("div",{class:"note"},m.descricao):null),el("td",{},el("span",{class:"pill "+cls},l)),el("td",{class:"num"},a?.data?fmtD(a.data):"—"),el("td",{},resp||"—"),el("td",{style:"white-space:pre-wrap;max-width:280px"},a?.nota||"—"),el("td",{class:"r"},edita?el("button",{class:"btn sm",onclick:()=>formMedida(c,m,a)},a?"Atualizar":"Definir"):null))})))));
  if(r.ciclo_resumo||c.ciclo_resumo)sec.append(el("div",{style:"margin-top:10px"},el("b",{},"Atualização final dos encaminhamentos"),el("div",{style:"white-space:pre-wrap;padding:8px 10px;background:var(--surface-2);border-radius:8px;margin-top:4px"},r.ciclo_resumo||c.ciclo_resumo)));
  return sec;
}
/* selo no cabeçalho + linha-resumo nas abas Negocial e Jurídico (leitura) */
function selo(c){
  const r=P.resumo[c.id];if(!r)return null;const tot=(+r.bens||0)+(+r.medidas_implementadas+ +r.medidas_em_andamento+ +r.medidas_a_fazer||0);
  const txt=[`${r.bens_protegidos}/${r.bens} bem(ns) protegido(s)`,`${r.medidas_implementadas} medida(s) implementada(s)`,r.ciclo_concluido_em?`ciclo concluído em ${fmtD(r.ciclo_concluido_em)}`:(r.dias_de_ciclo!=null?`ciclo: dia ${r.dias_de_ciclo}/45`:null)].filter(Boolean).join(" · ");
  const cls=r.ciclo_concluido_em?"g":(+r.bens_expostos>0||+r.medidas_a_fazer>0)?"e2":"c";
  return el("button",{class:"pill "+cls,style:"cursor:pointer;border:0",title:"Proteção patrimonial e operacional — clique para abrir",onclick:()=>{S.sub="acompanhamento";render();setTimeout(()=>document.getElementById("protecao")?.scrollIntoView({behavior:"smooth",block:"start"}),100)}},"Proteção: "+txt);
}
function linhaResumo(c){
  const r=P.resumo[c.id];if(!r)return null;
  const partes=[`Bens: ${r.bens_protegidos} protegido(s), ${r.bens_em_protecao} em proteção, ${r.bens_expostos} exposto(s)`,r.medidas_resumo?"Operação: "+r.medidas_resumo:"Operação: nada implementado ainda",r.ciclo_concluido_em?`Ciclo concluído em ${fmtD(r.ciclo_concluido_em)}`:null].filter(Boolean);
  return el("div",{class:"card",style:"padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;border-left:3px solid var(--gold)"},el("b",{style:"font-size:13px"},"Proteção patrimonial e operacional"),el("span",{class:"note"},partes.join(" · ")),el("button",{class:"btn sm",style:"margin-left:auto",onclick:()=>{S.sub="acompanhamento";render();setTimeout(()=>document.getElementById("protecao")?.scrollIntoView({behavior:"smooth",block:"start"}),100)}},"Ver detalhes"));
}
{const _r=window.PP_MOD?.resumo;if(window.PP_MOD)window.PP_MOD.resumo=(c,host,ind)=>{_r&&_r(c,host,ind);if(typeof equipe!=="function"||!equipe()||(typeof readOnly==="function"&&readOnly()))return;if(S.sub!=="acompanhamento")return;
  const cardP=card(c);const fluxo=[...host.children].find(x=>x.querySelector?.("h2")?.textContent==="Fluxo PJ");if(fluxo)fluxo.after(cardP);else host.append(cardP)};}
{const _r=render;render=function(){_r();if(typeof equipe!=="function"||!equipe())return;if(S.tab!=="clientes"||!S.sel)return;const c=(S.clientes||[]).find(x=>x.id===S.sel);if(!c)return;
  if(!P.resumo[c.id]&&!P.cache[c.id]?.carregando){carregar(c.id);return}
  const v=$("#view-clientes");const sub=v?.querySelector(".head .sub");if(sub&&!sub.querySelector(".pp-selo-prot")){const s=selo(c);if(s){s.classList.add("pp-selo-prot");sub.append(" ",s)}}
  if(S.sub==="processos"||S.sub==="negociacoes"){const tabs=v?.querySelector(".subtabs");if(tabs&&!v.querySelector(".pp-linha-prot")){const l=linhaResumo(c);if(l){l.classList.add("pp-linha-prot");tabs.after(l)}}}}}
window.PP_PROTECAO={invalidar};
})();
