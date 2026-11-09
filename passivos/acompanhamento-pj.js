/* Acompanhamento PJ — aba do cliente (frente Estratégico / Acompanhamento PJ, todos leem). Passagem de bastão visual:
   1) Status do ciclo (ONB → R1 → R2 → R3 → mensal) — a "barra carregando";
   2) Raio-X da empresa (dados do formulário + R1) e a tabela de Dívidas como ponto de partida para Acordos/Jurídico;
   3) Fluxo PJ + Bens + Proteção patrimonial e operacional (cards vindos de fluxo.js / ficha.js / protecao.js);
   4) Atas das reuniões com link da pasta/gravação. Supabase (0104): acompanhamento_pj, dividas_raio_x, atas_reuniao, v_acompanhamento_pj. */
(()=>{
"use strict";
const A={cache:{},colab:null};
const ETAPAS=[["onb","Onboarding"],["r1","R1"],["r2","R2"],["r3","R3"],["mensal","Mensal"]];
const TIPO_ATA={onb:"Onboarding",r1:"R1",r2:"R2",r3:"R3",mensal:"Acompanhamento mensal",estrategia:"Núcleo de estratégia",outra:"Outra"};
const fmtD=s=>s?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"";
const hojeISO=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
const addDias=(iso,n)=>{const d=new Date(iso+"T12:00:00");d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
const meuColab=()=>A.colab?.find(c=>c.perfil_id===PP.perfil?.id);
const podeEditar=()=>{if(PP.perfil?.papel==="admin")return true;const m=meuColab();return !!m&&(m.frente==="estrategico"||["acompanhamento_pj","pos_vendas","socios"].includes(m.nucleo))||(PP.perfil?.acessos||[]).includes("protecao")};
const SN=v=>v===true?"Sim":v===false?"Não":"—";
const check=(label,checked)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;return {wrap:el("label",{style:"display:flex;gap:8px;align-items:center;font-size:14px;padding:8px 0"},i,label),input:i}};
const dl=(id,value,opcoes)=>{const i=inp("text",value,{list:id+"-dl"});return {wrap:el("div",{},i,el("datalist",{id:id+"-dl"},opcoes.map(o=>el("option",{value:o})))),input:i}};
const tri=v=>sel({"":"—",sim:"Sim",nao:"Não"},v===true?"sim":v===false?"nao":"");const triVal=s=>s.value==="sim"?true:s.value==="nao"?false:null;

async function carregar(cid,force){
  if(A.cache[cid]?.carregando)return;if(A.cache[cid]?.ok&&!force)return;A.cache[cid]={carregando:true};
  try{const [ac,dv,at,co]=await Promise.all([SB.from("acompanhamento_pj").select("*").eq("cliente_id",cid).maybeSingle(),SB.from("dividas_raio_x").select("*").eq("cliente_id",cid).order("ordem").order("created_at"),SB.from("atas_reuniao").select("*").eq("cliente_id",cid).order("data",{ascending:false}),A.colab?{data:A.colab}:SB.from("colaboradores").select("id,nome,perfil_id,frente,nucleo,ativo").order("nome")]);
    A.colab=co.data||[];A.cache[cid]={ok:true,ac:ac.data||null,dividas:dv.data||[],atas:at.data||[],erro:ac.error?.message||dv.error?.message||null}}
  catch(e){console.warn("acomp",e);A.cache[cid]={ok:true,ac:null,dividas:[],atas:[],erro:String(e.message||e)}}
  render();
}
const invalidar=cid=>{if(cid)delete A.cache[cid];else A.cache={};render()};
const selColab=v=>sel({"":"—",...Object.fromEntries((A.colab||[]).filter(c=>c.ativo!==false||c.id===v).map(c=>[c.id,c.nome]))},v||"");

/* ---------- 1) status do ciclo ---------- */
function etapaAtual(ac){if(!ac||!ac.onb_feita)return"onb";if(!ac.r1_feita)return"r1";if(!ac.r2_feita)return"r2";if(!ac.r3_feita)return"r3";return"mensal"}
function formCiclo(c,ac){
  ac=ac||{};const onb=inp("date",ac.onb_data||c.data_onboarding||""),r1=inp("date",ac.r1_data||""),r2=inp("date",ac.r2_data||""),r3=inp("date",ac.r3_data||""),prox=inp("date",ac.proxima_reuniao||""),fase=sel({onboarding:"Onboarding",ciclo:"Ciclo inicial (45 dias)",mensal:"Acompanhamento mensal",encerrado:"Encerrado"},ac.fase||"onboarding"),obs=el("textarea",{rows:3,placeholder:"Observações do acompanhamento (o que ficou combinado, pendências do cliente…)"},ac.observacoes||"");
  const fO=check("Onboarding realizado",!!ac.onb_feita),f1=check("R1 realizada",!!ac.r1_feita),f2=check("R2 realizada",!!ac.r2_feita),f3=check("R3 realizada",!!ac.r3_feita);
  const sugerir=el("button",{class:"btn sm",type:"button",onclick:()=>{if(!onb.value){toast("Informe a data do onboarding");return}r1.value=addDias(onb.value,15);r2.value=addDias(onb.value,30);r3.value=addDias(onb.value,45);toast("R1/R2/R3 sugeridas a cada 15 dias")}},"Sugerir R1/R2/R3 (15 em 15 dias)");
  const body=el("div",{class:"form"},field("ac-onb","Onboarding (ONB)",onb),el("div",{class:"f"},el("label",{}," "),fO.wrap),field("ac-r1","R1",r1),el("div",{class:"f"},el("label",{}," "),f1.wrap),field("ac-r2","R2",r2),el("div",{class:"f"},el("label",{}," "),f2.wrap),field("ac-r3","R3",r3),el("div",{class:"f"},el("label",{}," "),f3.wrap),
    el("div",{class:"f full"},sugerir),field("ac-fase","Fase",fase),field("ac-prox","Próxima reunião",prox,"Depois do ciclo inicial: a reunião mensal."),el("div",{class:"f full"},el("label",{},"Observações"),obs));
  modal("Ciclo de acompanhamento",body,async()=>{
    const row={cliente_id:c.id,onb_data:onb.value||null,onb_feita:fO.input.checked,r1_data:r1.value||null,r1_feita:f1.input.checked,r2_data:r2.value||null,r2_feita:f2.input.checked,r3_data:r3.value||null,r3_feita:f3.input.checked,fase:fase.value,proxima_reuniao:prox.value||null,observacoes:obs.value.trim()||null,updated_at:new Date().toISOString(),updated_by:PP.perfil?.id||null};
    if(row.r1_feita&&!ac.r1_feita){const st=A.cache[c.id];if(!(st?.dividas||[]).length)throw new Error("Para concluir a R1, preencha o Raio-X (ao menos uma dívida) — é o que libera Acordos.");row.acordos_liberado=true;row.acordos_liberado_em=new Date().toISOString()}
    if(row.r3_feita&&row.fase==="ciclo")row.fase="mensal";
    const {error}=await SB.from("acompanhamento_pj").upsert(row,{onConflict:"cliente_id"});if(error)throw new Error(error.message);
    // espelha no cadastro (campos legados usados em outras telas)
    await SB.from("clientes").update({data_onboarding:row.onb_data,proxima_reuniao:row.proxima_reuniao||row.r1_data||null}).eq("id",c.id).then(()=>{});
    toast("Ciclo atualizado");invalidar(c.id);window.PP_PROTECAO?.invalidar?.(c.id)});
}
async function criarTarefasCiclo(c,ac){
  if(!ac?.onb_data){toast("Defina a data do onboarding primeiro");return}
  const resp=c.resp_estrategico_id||c.responsavel_onboarding_id||meuColab()?.id||null;
  const {data:ex}=await SB.from("tarefas").select("titulo").eq("cliente_id",c.id).in("status",["aberta","em_andamento"]);
  const tem=t=>(ex||[]).some(x=>x.titulo.startsWith(t));
  const rows=[];const base={cliente_id:c.id,responsavel_id:resp,nucleo:"acompanhamento_pj",status:"aberta",prioridade:2,prazo_fatal:false};
  if(!ac.onb_feita&&!tem("Onboarding (ONB) —"))rows.push({...base,titulo:"Onboarding (ONB) — "+c.nome,prazo:ac.onb_data,descricao:"Reunião de onboarding. Ao concluir: registrar a ata no Acompanhamento e marcar ONB como realizado."});
  for(const [k,n,d] of [["r1","R1",ac.r1_data],["r2","R2",ac.r2_data],["r3","R3",ac.r3_data]]){if(!d||ac[k+"_feita"]||tem(n+" — "))continue;rows.push({...base,titulo:n+" — "+c.nome,prazo:d,descricao:k==="r1"?"Reunião R1. Ao concluir: preencher o Raio-X (dívidas, avalistas, garantias) — isso libera Acordos.":`Reunião ${n} do ciclo inicial. Ao concluir: atualizar status da proteção patrimonial e a ata.`})}
  // follow-ups de 7 dias entre as reuniões do ciclo
  const marcos=[ac.onb_data,ac.r1_data,ac.r2_data,ac.r3_data].filter(Boolean);
  for(let i=0;i<marcos.length-1;i++){const f=addDias(marcos[i],7);if(f<marcos[i+1]&&!tem("Follow-up (7 dias) — "+c.nome+" · "+fmtD(f)))rows.push({...base,titulo:"Follow-up (7 dias) — "+c.nome+" · "+fmtD(f),prazo:f,prioridade:3,descricao:"Checar com o cliente o que foi encaminhado na última reunião (gestora, escrow, contratos…) antes da próxima."})}
  if(!rows.length){toast("Nada a criar: as tarefas do ciclo já existem");return}
  const {error}=await SB.from("tarefas").insert(rows);if(error){toast(error.message);return}
  toast(`${rows.length} tarefa(s) do ciclo criada(s)`);window.PP_TAREFAS?.invalidar?.();
}
function cardCiclo(c,st){
  const ac=st.ac;const atual=etapaAtual(ac);const edita=podeEditar();const idx=ETAPAS.findIndex(e=>e[0]===atual);
  const passos=el("div",{class:"ciclo-barra"},...ETAPAS.map(([k,l],i)=>{const d=ac?.[k+"_data"];const feita=k==="mensal"?(ac?.fase==="mensal"||ac?.fase==="encerrado"):!!ac?.[k+"_feita"];const cls=feita?"feita":k===atual?"atual":"";
    return el("div",{class:"ciclo-passo "+cls},el("div",{class:"ciclo-dot"},feita?"✓":String(i+1)),el("div",{class:"ciclo-l"},l),el("div",{class:"ciclo-d"},k==="mensal"?(ac?.proxima_reuniao?"próx. "+fmtD(ac.proxima_reuniao):"—"):(d?fmtD(d):"—")))}));
  const faseTxt={onboarding:"Onboarding",ciclo:"Ciclo inicial (45 dias)",mensal:"Acompanhamento mensal",encerrado:"Encerrado"}[ac?.fase||"onboarding"];
  const dias=ac?.onb_data?Math.round((new Date(hojeISO())-new Date(ac.onb_data))/86400000):null;
  const sec=el("section",{class:"card section",id:"acomp-ciclo"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Status do acompanhamento"),el("div",{class:"note"},[faseTxt,dias!=null&&ac.fase!=="mensal"?`dia ${dias} de 45`:null,ac?.acordos_liberado?"Acordos liberado em "+fmtD((ac.acordos_liberado_em||"").slice(0,10)):"Acordos aguarda a R1 + Raio-X"].filter(Boolean).join(" · "))),
    el("div",{class:"actions"},edita?el("button",{class:"btn sm",onclick:()=>criarTarefasCiclo(c,ac)},"Criar tarefas do ciclo"):null,edita?el("button",{class:"btn sm primary",onclick:()=>formCiclo(c,ac)},ac?"Atualizar ciclo":"Definir datas"):null)),passos);
  if(ac?.observacoes)sec.append(el("div",{class:"note",style:"margin-top:8px;white-space:pre-wrap"},ac.observacoes));
  if(!ac)sec.append(el("div",{class:"note",style:"margin-top:8px"},"Defina a data do onboarding; o sistema sugere R1/R2/R3 a cada 15 dias e cria as tarefas."));
  return sec;
}

/* ---------- 2) Raio-X: dívidas ---------- */
function formDivida(c,d){
  d=d||{};const banco=inp("text",d.banco||"",{placeholder:"Ex.: Santander"}),tipo=dl("dv-tipo",d.tipo||"",["Capital de giro","Cheque especial","Conta garantida","Financiamento","Cartão","Consórcio","Antecipação de recebíveis","Crédito rural","Outro"]),valor=inp("number",d.valor??"",{step:"0.01",placeholder:"0,00"}),atraso=inp("number",d.atraso_meses??"",{min:0,placeholder:"meses (0 = em dia)"}),
    av=tri(d.avalista===true?true:d.avalista===false?false:null),avN=inp("text",d.avalista_nome||"",{placeholder:"Nome do avalista"}),avC=inp("text",d.avalista_cpf||"",{placeholder:"CPF"}),avB=tri(d.avalista_tem_bens),gar=tri(d.garantia===true?true:d.garantia===false?false:null),garD=inp("text",d.garantia_descricao||"",{placeholder:"Ex.: HB20 alienado; casa hipotecada"}),em=tri(d.contrato_em_maos),proc=tri(d.processo),obs=el("textarea",{rows:2},d.observacoes||"");
  const body=el("div",{class:"form"},field("dv-banco","Banco",banco),field("dv-tipo","Tipo de dívida",tipo.wrap),field("dv-valor","Valor (R$)",valor),field("dv-atraso","Tempo de atraso (meses)",atraso),
    field("dv-av","Tem avalista?",av),field("dv-avn","Avalista",avN),field("dv-avc","CPF do avalista",avC),field("dv-avb","Avalista tem bens?",avB,"Se sim, o sistema abre uma linha em Bens (titular avalista) para você detalhar."),
    field("dv-gar","Tem garantia?",gar),field("dv-gard","Qual garantia",garD),field("dv-em","Contrato em mãos?",em),field("dv-proc","Tem processo?",proc),el("div",{class:"f full"},el("label",{},"Observações"),obs));
  const extra=d.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirm("Excluir esta dívida do Raio-X?"))return;await SB.from("dividas_raio_x").delete().eq("id",d.id);$("#modalHost").replaceChildren();toast("Excluída");invalidar(c.id)}},"Excluir"):null;
  modal(d.id?"Editar dívida":"Incluir dívida",body,async()=>{
    if(!banco.value.trim())throw new Error("Informe o banco");
    const row={cliente_id:c.id,banco:banco.value.trim(),tipo:tipo.input.value.trim()||null,valor:valor.value===""?null:+valor.value,atraso_meses:atraso.value===""?null:+atraso.value,avalista:triVal(av)===true,avalista_nome:avN.value.trim()||null,avalista_cpf:avC.value.trim()||null,avalista_tem_bens:triVal(avB),garantia:triVal(gar)===true,garantia_descricao:garD.value.trim()||null,contrato_em_maos:triVal(em),processo:triVal(proc),observacoes:obs.value.trim()||null,updated_at:new Date().toISOString(),updated_by:PP.perfil?.id||null};
    const q=d.id?SB.from("dividas_raio_x").update(row).eq("id",d.id):SB.from("dividas_raio_x").insert({...row,created_by:PP.perfil?.id||null});const {error}=await q;if(error)throw new Error(error.message);
    if(row.avalista_tem_bens===true&&row.avalista_nome&&!(d.avalista_tem_bens===true)){const {data:ex}=await SB.from("bens").select("id").eq("cliente_id",c.id).eq("titular","avalista").ilike("descricao","%"+row.avalista_nome+"%").limit(1);
      if(!(ex||[]).length){await SB.from("bens").insert({cliente_id:c.id,tipo:"outro",descricao:"Bens do avalista "+row.avalista_nome+" — detalhar",titular:"avalista",protecao:"exposto",observacoes:"Criado automaticamente pelo Raio-X (dívida "+row.banco+"). Substitua pela descrição real do bem."});window.PP_FICHA?.recarregar?.();window.PP_PROTECAO?.invalidar?.(c.id)}}
    toast("Salvo");invalidar(c.id)},extra);
}
function cardDividas(c,st){
  const edita=podeEditar();const ds=st.dividas;const total=ds.reduce((s,d)=>s+(+d.valor||0),0);const atras=ds.filter(d=>(d.atraso_meses||0)>0).length;
  const sec=el("section",{class:"card section",id:"acomp-dividas"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Dívidas (ponto de partida)"),el("div",{class:"note"},ds.length?`${ds.length} dívida(s) · ${BRL(total)} · ${atras} em atraso · ${ds.filter(d=>d.avalista).length} com avalista · ${ds.filter(d=>d.garantia).length} com garantia`:"Perguntas norteadoras da R1: quais bancos e dívidas, tempo de atraso, avalista, garantia, contrato em mãos, processo.")),
    el("div",{class:"actions"},edita?el("button",{class:"btn sm primary",onclick:()=>formDivida(c,null)},"+ Dívida"):null)));
  if(!ds.length)sec.append(el("div",{class:"empty"},"Nenhuma dívida mapeada ainda.",edita?el("div",{class:"note"},"Preencha na R1 — é o que libera Acordos para começar."):null));
  else sec.append(el("div",{class:"tbl"},el("table",{},el("thead",{},el("tr",{},el("th",{},"Banco"),el("th",{},"Tipo"),el("th",{class:"num"},"Valor"),el("th",{},"Atraso"),el("th",{},"Avalista"),el("th",{},"Garantia"),el("th",{},"Contrato"),el("th",{},"Processo"),el("th",{}))),
    el("tbody",{},ds.map(d=>el("tr",{},el("td",{},el("b",{},d.banco),d.observacoes?el("div",{class:"note"},d.observacoes):null),el("td",{},d.tipo||"—"),el("td",{class:"num"},d.valor!=null?BRL(+d.valor):"—"),
      el("td",{},d.atraso_meses==null?"—":d.atraso_meses===0?el("span",{class:"pill g"},"em dia"):el("span",{class:"pill "+(d.atraso_meses>=6?"e3":"e2")},d.atraso_meses+" m")),
      el("td",{},d.avalista?el("span",{},el("b",{},d.avalista_nome||"sim"),d.avalista_cpf?el("div",{class:"note"},d.avalista_cpf):null,d.avalista_tem_bens===true?el("div",{class:"note"},"tem bens"):null):"não"),
      el("td",{},d.garantia?el("span",{class:"pill e3",title:d.garantia_descricao||""},d.garantia_descricao||"sim"):"não"),el("td",{},SN(d.contrato_em_maos)),el("td",{},SN(d.processo)),
      el("td",{class:"r"},edita?el("button",{class:"btn sm",onclick:()=>formDivida(c,d)},"Editar"):null)))))));
  return sec;
}

/* ---------- 4) atas ---------- */
function formAta(c,a){
  a=a||{};const tipo=sel(TIPO_ATA,a.tipo||"r1"),data=inp("date",a.data||hojeISO()),tit=inp("text",a.titulo||"",{placeholder:"Opcional"}),res=el("textarea",{rows:6,placeholder:"O que foi tratado, o que ficou combinado, pendências e próximos passos."},a.resumo||""),lp=inp("url",a.link_pasta||c.pasta_drive_url||"",{placeholder:"https://drive.google.com/… (pasta com gravação e transcrição)"}),lg=inp("url",a.link_gravacao||"",{placeholder:"Link direto da gravação (opcional)"}),part=inp("text",a.participantes||"",{placeholder:"Quem participou"});
  const body=el("div",{class:"form"},field("ata-tipo","Reunião",tipo),field("ata-data","Data",data),field("ata-tit","Título",tit),field("ata-part","Participantes",part),el("div",{class:"f full"},el("label",{},"Ata / resumo"),res),el("div",{class:"f full"},el("label",{},"Link da pasta"),lp,el("div",{class:"help"},"A gravação fica no Drive; aqui vai o link para quem precisar.")),el("div",{class:"f full"},el("label",{},"Link da gravação"),lg));
  const extra=a.id?el("button",{class:"btn danger",onclick:async()=>{if(!confirm("Excluir esta ata?"))return;await SB.from("atas_reuniao").delete().eq("id",a.id);$("#modalHost").replaceChildren();toast("Excluída");invalidar(c.id)}},"Excluir"):null;
  modal(a.id?"Editar ata":"Registrar ata",body,async()=>{
    if(!res.value.trim()&&!lp.value.trim()&&!lg.value.trim())throw new Error("Escreva a ata ou informe o link");
    const row={cliente_id:c.id,tipo:tipo.value,data:data.value||hojeISO(),titulo:tit.value.trim()||null,resumo:res.value.trim()||null,link_pasta:lp.value.trim()||null,link_gravacao:lg.value.trim()||null,participantes:part.value.trim()||null,autor_id:meuColab()?.id||null,updated_at:new Date().toISOString(),updated_by:PP.perfil?.id||null};
    const q=a.id?SB.from("atas_reuniao").update(row).eq("id",a.id):SB.from("atas_reuniao").insert({...row,created_by:PP.perfil?.id||null});const {error}=await q;if(error)throw new Error(error.message);
    toast(a.id?"Ata atualizada":"Ata registrada no dossiê");invalidar(c.id);window.PP_DOSSIE?.invalidar?.(c.id)},extra);
}
function cardAtas(c,st){
  const sec=el("section",{class:"card section",id:"acomp-atas"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Atas das reuniões"),el("div",{class:"note"},"Onboarding, R1, R2, R3 e mensais. Cada ata registrada entra no dossiê (frente Estratégico).")),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>formAta(c,null)},"+ Ata"))));
  if(!st.atas.length)sec.append(el("div",{class:"empty"},"Nenhuma ata registrada."));
  else sec.append(el("div",{class:"tl"},st.atas.map(a=>{const autor=A.colab.find(x=>x.id===a.autor_id)?.nome;return el("div",{class:"tl-item"},el("div",{class:"tl-h"},el("span",{class:"pill c"},TIPO_ATA[a.tipo]||a.tipo),el("b",{},fmtD(a.data)),a.titulo?el("span",{},a.titulo):null,autor?el("span",{class:"note"},"· "+autor):null,el("span",{style:"margin-left:auto;display:flex;gap:6px"},a.link_pasta?el("a",{class:"btn sm",href:a.link_pasta,target:"_blank",rel:"noopener"},"Pasta"):null,a.link_gravacao?el("a",{class:"btn sm",href:a.link_gravacao,target:"_blank",rel:"noopener"},"Gravação"):null,el("button",{class:"btn sm",onclick:()=>formAta(c,a)},"Editar"))),a.resumo?el("div",{class:"tl-b"},a.resumo):null,a.participantes?el("div",{class:"note"},"Participantes: "+a.participantes):null)})));
  return sec;
}

/* ---------- montagem da aba ---------- */
function renderAba(c,host,ind){
  const st=A.cache[c.id];if(!st?.ok){carregar(c.id);host.append(el("div",{class:"note"},"Carregando acompanhamento…"));return}
  if(st.erro&&/acompanhamento_pj|dividas_raio_x|atas_reuniao/.test(st.erro))host.append(el("div",{class:"card",style:"padding:10px 14px;border-left:3px solid var(--warn)"},"Rode a migração 0104 para ativar o Acompanhamento PJ."));
  host.append(cardCiclo(c,st));
  if(window.PP_FICHA?.cardRaioX)window.PP_FICHA.cardRaioX(c,host,ind);
  host.append(cardDividas(c,st));
  // Fluxo PJ e Proteção (com os bens) são anexados por fluxo.js / protecao.js (hooks em S.sub==="acompanhamento").
  host.append(cardAtas(c,st));
}
{const _r=window.PP_MOD?.resumo;if(window.PP_MOD)window.PP_MOD.resumo=(c,host,ind)=>{_r&&_r(c,host,ind);if(typeof readOnly==="function"&&readOnly())return;if(S.sub!=="acompanhamento")return;renderAba(c,host,ind)}}
const css=document.createElement("style");css.textContent=`
.ciclo-barra{display:grid;grid-template-columns:repeat(5,1fr);gap:0;margin-top:10px;position:relative}
.ciclo-barra::before{content:"";position:absolute;left:10%;right:10%;top:15px;height:2px;background:var(--line);z-index:0}
.ciclo-passo{position:relative;z-index:1;text-align:center;padding:0 4px}
.ciclo-dot{width:30px;height:30px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;background:var(--surface);border:2px solid var(--line);color:var(--muted)}
.ciclo-passo.feita .ciclo-dot{background:var(--ok);border-color:var(--ok);color:var(--on-dark)}
.ciclo-passo.atual .ciclo-dot{border-color:var(--gold);color:var(--fg);box-shadow:0 0 0 4px color-mix(in srgb,var(--gold) 25%,transparent)}
.ciclo-l{font-size:12.5px;font-weight:600;margin-top:6px}.ciclo-passo.atual .ciclo-l{color:var(--fg)}.ciclo-d{font-size:12px;color:var(--muted)}
.tl .tl-item{padding:10px 0;border-top:1px solid var(--line)}.tl .tl-item:first-child{border-top:0}.tl-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tl-b{white-space:pre-wrap;margin-top:6px;font-size:14px}
@media (max-width:600px){.ciclo-barra{grid-template-columns:repeat(5,1fr)}.ciclo-l{font-size:11px}.ciclo-d{font-size:11px}}`;document.head.append(css);
window.PP_ACOMP={invalidar,carregar};
})();
