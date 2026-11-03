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
  try{const [m,s]=await Promise.all([SB.from("motivos_reagendamento").select("*").order("ordem").order("motivo"),SB.from("sla_tickets").select("*")]);G.motivos=m.data||[];G.slas=s.data||[];if(m.error||s.error)toast((m.error||s.error).message)}
  finally{G.carregando=false}render();
}
const invalidar=()=>{G.motivos=null;G.slas=null;render()};
function formMotivo(m){
  const txt=inp("text",m?.motivo||"",{placeholder:"Ex.: Aguardando documentos do cliente"}),comp=check("Exige complemento escrito (ex.: “Outro”)",!!m?.exige_complemento),ativo=check("Ativo (aparece na lista)",m?m.ativo!==false:true),ordem=inp("number",m?.ordem??((G.motivos||[]).length+1)*10,{min:0});
  const body=el("div",{class:"form"},field("mt-txt","Motivo",txt),field("mt-ord","Ordem",ordem),el("div",{class:"f full"},comp.wrap),el("div",{class:"f full"},ativo.wrap));
  const extra=m?el("button",{class:"btn danger",onclick:async()=>{if(!confirm("Excluir este motivo? (os reagendamentos antigos continuam com o texto)"))return;const {error}=await SB.from("motivos_reagendamento").delete().eq("id",m.id);$("#modalHost").replaceChildren();if(error){toast(error.message);return}toast("Excluído");invalidar()}},"Excluir"):null;
  modal(m?"Editar motivo":"Novo motivo de reagendamento",body,async()=>{if(!txt.value.trim())throw new Error("Informe o motivo");const row={motivo:txt.value.trim(),exige_complemento:comp.input.checked,ativo:ativo.input.checked,ordem:+ordem.value||0};
    const q=m?SB.from("motivos_reagendamento").update(row).eq("id",m.id):SB.from("motivos_reagendamento").insert(row);const {error}=await q;if(error)throw new Error(error.message);toast("Salvo");invalidar()},extra);
}
function renderTela(){
  const v=$("#view-config-gestao");if(!v)return;v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Gestão"),el("h1",{},"Configurações"),el("div",{class:"sub"},"Regras que a gestão e a controladoria definem e a equipe usa no dia a dia: motivos de reagendamento e SLAs dos tickets."))));
  if(!pode()){v.append(el("div",{class:"note"},"Acesso restrito à gestão."));return}
  if(!G.motivos||!G.slas){if(!G.carregando)carregar();v.append(el("div",{class:"note"},"Carregando…"));return}
  // motivos
  v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Motivos de reagendamento"),el("div",{class:"note"},"Ao mudar o prazo de uma tarefa, a pessoa escolhe um destes motivos (obrigatório). Gestão e controladoria recebem o aviso.")),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>formMotivo()},"+ Motivo"))),
    el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Ordem"),el("th",{},"Motivo"),el("th",{},"Complemento"),el("th",{},"Situação"),el("th",{}))),
      el("tbody",{},G.motivos.length?G.motivos.map(m=>el("tr",{},el("td",{class:"num"},String(m.ordem)),el("td",{},m.motivo),el("td",{},m.exige_complemento?"obrigatório":"opcional"),el("td",{},el("span",{class:"pill "+(m.ativo?"g":"")},m.ativo?"Ativo":"Inativo")),el("td",{class:"r"},el("button",{class:"btn sm",onclick:()=>formMotivo(m)},"Editar")))):el("tr",{},el("td",{colspan:5,class:"note"},"Nenhum motivo cadastrado.")))))));
  // SLAs
  const linhas=Object.entries(AREAS).map(([k,l])=>{const s=G.slas.find(x=>x.area===k)||{area:k,dias_resposta:2,dias_critico:5};const r=inp("number",s.dias_resposta,{min:0,max:60,style:"width:80px"}),c=inp("number",s.dias_critico,{min:0,max:90,style:"width:80px"}),o=inp("text",s.observacao||"",{placeholder:"opcional"});
    const salvar=async()=>{const {error}=await SB.from("sla_tickets").upsert({area:k,dias_resposta:+r.value||0,dias_critico:Math.max(+c.value||0,+r.value||0),observacao:o.value.trim()||null,updated_at:new Date().toISOString(),updated_by:PP.perfil?.id},{onConflict:"area"});if(error){toast(error.message);return}toast("SLA de "+l+" salvo");G.slas=null;render()};
    return el("tr",{},el("td",{},el("b",{},l)),el("td",{},r),el("td",{},c),el("td",{},o),el("td",{class:"r"},el("button",{class:"btn sm",onclick:salvar},"Salvar")))});
  v.append(el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"SLAs dos tickets por área"),el("div",{class:"note"},"Dias que a área tem para responder um ticket. Até o prazo: azul; passou: amarelo (“SLA vencido”); a partir do crítico: vermelho. Vale também como referência para as requisições administrativas."))),
    el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Área"),el("th",{},"Dias para responder"),el("th",{},"Crítico a partir de"),el("th",{},"Observação"),el("th",{}))),el("tbody",{},linhas)))));
}
{const _r=render;render=function(){_r();const v=$("#view-config-gestao");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="config-gestao")S.tab="clientes";v.hidden=S.tab!=="config-gestao";if(S.tab==="config-gestao")renderTela()}}
window.PP_CONFIG_GESTAO={invalidar};
})();
