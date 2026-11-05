/* Gestão → Configurações: o que a gestão/controladoria cadastra e a equipe usa.
   - Motivos de reagendamento de tarefa (lista fechada; "exige complemento" pede texto)
   - SLAs internos dos tickets por área (dias para responder / dias para ficar crítico)
   Supabase: motivos_reagendamento, sla_tickets (0091). Acesso: admin ou "equipe" (administrativo). */
(()=>{
"use strict";
const G={motivos:null,slas:null,carregando:false};
const AREAS={juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",atendimento:"Atendimento",administrativo:"Administrativo",socios:"Sócias"};
//
const check=(label,checked,help)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;const w=el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},i,label),help?el("div",{class:"help"},help):null);return {wrap:w,input:i}};
const pode=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("equipe");
async function carregar(){
  if(G.carregando)return;G.carregando=true;
  try{const [m,s,md]=await Promise.all([SB.from("motivos_reagendamento").select("*").order("ordem").order("motivo"),SB.from("sla_tickets").select("*"),SB.from("medidas_operacionais").select("*").order("ordem")]);G.motivos=m.data||[];G.slas=s.data||[];G.medidas=md.data||[];if(m.error||s.error)toast((m.error||s.error).message)}
  finally{G.carregando=false}render();
}
const invalidar=()=>{G.motivos=null;G.slas=null;G.medidas=null;render()};
function formMotivo(m){
  const txt=inp("text",m?.motivo||"",{placeholder:"Ex.: Aguardando documentos do cliente"}),comp=check("Exige complemento escrito (ex.: “Outro”)",!!m?.exige_complemento),ativo=check("Ativo (aparece na lista)",m?m.ativo!==false:true),ordem=inp("number",m?.ordem??((G.motivos||[]).length+1)*10,{min:0});
  const body=el("div",{class:"form"},field("mt-txt","Motivo",txt),field("mt-ord","Ordem",ordem),el("div",{class:"f full"},comp.wrap),el("div",{class:"f full"},ativo.wrap));
  const extra=m?el("button",{class:"btn danger",onclick:async()=>{if(!confirm("Excluir este motivo? (os reagendamentos antigos continuam com o texto)"))return;const {error}=await SB.from("motivos_reagendamento").delete().eq("id",m.id);$("#modalHost").replaceChildren();if(error){toast(error.message);return}toast("Excluído");invalidar()}},"Excluir"):null;
  modal(m?"Editar motivo":"Novo motivo de reagendamento",body,async()=>{if(!txt.value.trim())throw new Error("Informe o motivo");const row={motivo:txt.value.trim(),exige_complemento:comp.input.checked,ativo:ativo.input.checked,ordem:+ordem.value||0};
    const q=m?SB.from("motivos_reagendamento").update(row).eq("id",m.id):SB.from("motivos_reagendamento").insert(row);const {error}=await q;if(error)throw new Error(error.message);toast("Salvo");invalidar()},extra);
}
function renderTela(){
  const v=$("#view-config-gestao");if(!v)return;v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Gestão"),el("h1",{},"Configurações"),el("div",{class:"sub"},"Regras que a gestão e a controladoria definem e a equipe usa no dia a dia: motivos de reagendamento e medidas de proteção."))));
  if(!pode()){v.append(el("div",{class:"note"},"Acesso restrito à gestão."));return}
  if(!G.motivos||!G.slas||!G.medidas){if(!G.carregando)carregar();v.append(el("div",{class:"note"},"Carregando…"));return}
  // motivos
  v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Motivos de reagendamento"),el("div",{class:"note"},"Ao mudar o prazo de uma tarefa, a pessoa escolhe um destes motivos (obrigatório). Gestão e controladoria recebem o aviso.")),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>formMotivo()},"+ Motivo"))),
    el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Ordem"),el("th",{},"Motivo"),el("th",{},"Complemento"),el("th",{},"Situação"),el("th",{}))),
      el("tbody",{},G.motivos.length?G.motivos.map(m=>el("tr",{},el("td",{class:"num"},String(m.ordem)),el("td",{},m.motivo),el("td",{},m.exige_complemento?"obrigatório":"opcional"),el("td",{},el("span",{class:"pill "+(m.ativo?"g":"")},m.ativo?"Ativo":"Inativo")),el("td",{class:"r"},el("button",{class:"btn sm",onclick:()=>formMotivo(m)},"Editar")))):el("tr",{},el("td",{colspan:5,class:"note"},"Nenhum motivo cadastrado.")))))));
  // medidas operacionais (proteção)
  const formMedida=m=>{const nome=inp("text",m?.nome||"",{placeholder:"Ex.: Conta escrow"}),cod=inp("text",m?.codigo||"",{placeholder:"código curto, sem espaços (ex.: escrow)"}),desc=el("textarea",{rows:2},m?.descricao||""),ordem=inp("number",m?.ordem??((G.medidas||[]).length+1)*10),ativo=check("Ativa (aparece no cadastro dos clientes)",m?m.ativo!==false:true);if(m)cod.disabled=true;
    const body=el("div",{class:"form"},field("md-nome","Medida",nome),field("md-cod","Código",cod),field("md-ord","Ordem",ordem),el("div",{class:"f full"},el("label",{},"Descrição (ajuda para a equipe)"),desc),el("div",{class:"f full"},ativo.wrap));
    modal(m?"Editar medida":"Nova medida operacional",body,async()=>{if(!nome.value.trim())throw new Error("Informe o nome");const row={nome:nome.value.trim(),descricao:desc.value.trim()||null,ordem:+ordem.value||0,ativo:ativo.input.checked};if(!m){row.codigo=(cod.value.trim()||nome.value.trim()).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_")}
      const q=m?SB.from("medidas_operacionais").update(row).eq("id",m.id):SB.from("medidas_operacionais").insert(row);const {error}=await q;if(error)throw new Error(error.message);toast("Salvo");invalidar();window.PP_PROTECAO?.invalidar?.()})};
  v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Medidas de proteção operacional"),el("div",{class:"note"},"Checklist que aparece em Cadastro → Proteção patrimonial e operacional de cada cliente PJ (escrow, gestora, CNPJ espelho…). Desativar esconde sem apagar o histórico.")),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>formMedida()},"+ Medida"))),
    el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Ordem"),el("th",{},"Medida"),el("th",{},"Descrição"),el("th",{},"Situação"),el("th",{}))),
      el("tbody",{},(G.medidas||[]).length?G.medidas.map(m=>el("tr",{},el("td",{class:"num"},String(m.ordem)),el("td",{},el("b",{},m.nome),el("div",{class:"note"},m.codigo)),el("td",{class:"note"},m.descricao||"—"),el("td",{},el("span",{class:"pill "+(m.ativo?"g":"")},m.ativo?"Ativa":"Inativa")),el("td",{class:"r"},el("button",{class:"btn sm",onclick:()=>formMedida(m)},"Editar")))):el("tr",{},el("td",{colspan:5,class:"note"},"Nenhuma medida cadastrada (rode a migração 0092).")))))));
  // SLAs dos tickets: seção ocultada (tickets desativados em 05/11/2026)
}
{const _r=render;render=function(){_r();const v=$("#view-config-gestao");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="config-gestao")S.tab="clientes";v.hidden=S.tab!=="config-gestao";if(S.tab==="config-gestao")renderTela()}}
window.PP_CONFIG_GESTAO={invalidar};
})();
