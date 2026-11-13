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
const invalidar=cid=>{if(cid)delete A.cache[cid];else A.cache={};if(typeof A3!=="undefined")A3.lista=null;render()};
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
/* ====================================================================================================================
   V3.1 (Design System, Fase 3) — Acompanhamento PJ: visão transversal da carteira (#acompanhamento), só com a casca V3.1
   (html.np-casca-v3) e np-ui. A aba da ficha acima continua intacta. Leitura: v_acompanhamento_pj (0104) + S.clientes
   (nomes/direcionamento/reserva — só clientes que o perfil já enxerga) + tarefas abertas do núcleo (contagem de pendências).
   Ações do painel chamam as MESMAS funções da aba (formAta, formCiclo, formDivida, criarTarefasCiclo), sempre com o cliente
   selecionado passado explicitamente. Permissão da rota = a mesma da aba (equipe, acesso a Clientes, não readOnly).
   ==================================================================================================================== */
const acompV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
/* falha fechada: só com equipe(), fora do modo só leitura e com PP.temAcesso("acompanhamento") respondendo exatamente true (função ausente, false ou exceção = sem acesso) */
const podeVerTransversal=()=>{try{if(typeof equipe!=="function"||!equipe())return false;if(readOnly())return false;if(typeof PP?.temAcesso!=="function")return false;return PP.temAcesso("acompanhamento")===true}catch(_){return false}};
const A3={lista:null,carregando:false,erro:null,esperando:null,pend:[],f:{escopo:"ativos",ciclo:false,mensal:false,pend:false,resp:"",fase:"",regua:""},painel:null,obra:null,aberta:null,grupos:null};
const FASE_L={onboarding:"Onboarding",ciclo:"Ciclo inicial (45 dias)",mensal:"Acompanhamento mensal",encerrado:"Encerrado"};
const DIREC_L={acordos:"Acordos",juridico:"Jurídico",ambos:"Acordos + Jurídico"};
const RESERVA_L={nao_iniciado:"não iniciada",apresentado:"apresentada ao cliente",em_construcao:"em construção",formada:"formada"};
const REGUA_L={bronze:"Bronze (2x/mês)",prata:"Prata (1x/mês)",ouro:"Ouro (por marco)"};
const gruposA3=()=>{if(!A3.grupos){try{A3.grupos=JSON.parse(NPUI.pref.get("np-acomp-grupos","{}"))||{}}catch(_){A3.grupos={}}}return A3.grupos};
async function carregarLista(force){
  if(!podeVerTransversal())return;if(A3.carregando)return;if(A3.lista&&!force)return;A3.carregando=true;
  try{const [v,co,tp]=await Promise.all([SB.from("v_acompanhamento_pj").select("*"),A.colab?{data:A.colab}:SB.from("colaboradores").select("id,nome,perfil_id,frente,nucleo,ativo").order("nome"),
      SB.from("v_tarefas").select("id,cliente_id,titulo,prazo,status,prazo_fatal,responsavel_nome").eq("nucleo","acompanhamento_pj").in("status",["aberta","em_andamento"])]);
    A.colab=co.data||[];A3.pend=tp.data||[];A3.erro=v.error?.message||null;A3.lista=v.data||[]}
  catch(e){console.warn("acomp lista",e);A3.erro=String(e.message||e);A3.lista=[]}
  finally{A3.carregando=false}
  render();
}
const diaISO=iso=>iso?iso.slice(0,10):null;
/* próxima reunião registrada: proxima_reuniao (mensal) ou, no ciclo inicial, a primeira reunião ainda não marcada como feita — só datas gravadas */
function proximaDe(a){
  if(!a)return null;const passos=[["onb","Onboarding",a.onb_data,a.onb_feita],["r1","R1",a.r1_data,a.r1_feita],["r2","R2",a.r2_data,a.r2_feita],["r3","R3",a.r3_data,a.r3_feita]];
  if(a.fase==="mensal"||a.fase==="encerrado")return a.proxima_reuniao?{data:diaISO(a.proxima_reuniao),rotulo:"mensal"}:null;
  for(const [k,l,d,f] of passos)if(d&&!f)return {data:diaISO(d),rotulo:l};
  return a.proxima_reuniao?{data:diaISO(a.proxima_reuniao),rotulo:"mensal"}:null;
}
const diasAte=iso=>iso?Math.round((parseD(iso)-new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()))/86400000):null;
const diaCiclo=a=>a?.onb_data?Math.round((new Date(hojeISO())-new Date(diaISO(a.onb_data)))/86400000):null;
/* registros da carteira: uma linha por cliente visível (S.clientes) que tenha acompanhamento ou seja cliente PJ ativo */
function registrosA3(){
  const porCli=new Map((A3.lista||[]).map(a=>[a.cliente_id,a]));const pendPor=new Map();for(const t of A3.pend){const l=pendPor.get(t.cliente_id)||[];l.push(t);pendPor.set(t.cliente_id,l)}
  return (S.clientes||[]).map(c=>{const a0=porCli.get(c.id)||null;const iniciado=!!(a0&&a0.fase);const a=iniciado?a0:null;const prox=proximaDe(a);const d=prox?diasAte(prox.data):null;const pend=pendPor.get(c.id)||[];
    const grupo=!iniciado?"sem_acomp":(a.fase==="encerrado")?"encerrado":d==null?"sem_data":d<0?"vencida":d<=6?"semana":a.fase==="mensal"?"mensal":"proxima";
    return {c,a,iniciado,prox,dias:d,pend,grupo,resp:(A.colab||[]).find(x=>x.id===c.resp_estrategico_id)||null}})
    .filter(r=>r.iniciado||r.c.status!=="encerrado");
}
function filtrarA3(regs){
  const f=A3.f;const meu=meuColab();
  return regs.filter(r=>{
    if(f.escopo==="ativos"&&(!r.iniciado||r.a.fase==="encerrado"))return false;if(f.escopo==="encerrados"&&!(r.iniciado&&r.a.fase==="encerrado"))return false;
    if(f.ciclo&&!(r.iniciado&&(r.a.fase==="onboarding"||r.a.fase==="ciclo")))return false;if(f.mensal&&!(r.iniciado&&r.a.fase==="mensal"))return false;if(f.pend&&!r.pend.length)return false;
    if(f.resp&&(f.resp==="eu"?!(meu&&r.c.resp_estrategico_id===meu.id):r.c.resp_estrategico_id!==f.resp))return false;if(f.fase&&(r.a?.fase||"")!==f.fase)return false;if(f.regua&&(r.c.regua||"")!==f.regua)return false;
    return true});
}
const GRUPOS_A3=[["vencida","Reunião vencida","crit"],["semana","Esta semana","att"],["proxima","Próximas reuniões do ciclo",""],["mensal","Acompanhamento mensal",""],["sem_data","Sem agendamento",""],["sem_acomp","Sem acompanhamento iniciado",""],["encerrado","Encerrados",""]];
const reguaA3=r=>r.grupo==="vencida"?"late":r.grupo==="semana"?"att":null;
function marcasA3(r){const m=[];if(r.iniciado&&r.a.fase==="mensal")m.push(NPUI.marca("mensal","info"));if(r.a?.acordos_liberado)m.push(NPUI.marca("acordos liberado","ok"));if(r.c.projeto_reserva==="formada")m.push(NPUI.marca("reserva formada","ok"));
  const venc=r.pend.filter(t=>t.prazo&&t.prazo<hojeISO()).length;if(r.pend.length)m.push(NPUI.marca(`${r.pend.length} pendência${r.pend.length===1?"":"s"}`,venc?"crit":"att"));return m}
function contextoA3(r){
  const partes=[];if(r.c.segmento)partes.push(r.c.segmento);if(r.c.cidade)partes.push(r.c.cidade);
  if(r.iniciado){partes.push(FASE_L[r.a.fase]||r.a.fase);const dc=diaCiclo(r.a);if(dc!=null&&dc>=0&&(r.a.fase==="onboarding"||r.a.fase==="ciclo"))partes.push(`dia ${dc} de 45`)}
  if(r.c.direcionamento&&DIREC_L[r.c.direcionamento])partes.push("→ "+DIREC_L[r.c.direcionamento]);
  const out=[];partes.forEach((x,i)=>{if(i)out.push(" · ");out.push(x)});
  if(r.prox){const p=NPUI.prazoTxt(r.prox.data);out.push(el("span",{class:"sep"}," · "));out.push(el("span",{class:"rel "+(r.grupo==="vencida"?"late":r.grupo==="semana"?"att":"")},r.prox.rotulo+" "+p.rel))}
  return out;
}
const ETAPAS_PT=[["onb","ONB"],["r1","R1"],["r2","R2"],["r3","R3"],["mensal","Mensal"]];
function linhaA3(r){
  const p=r.prox?NPUI.prazoTxt(r.prox.data):null;
  return NPUI.linha({id:r.c.id,regua:reguaA3(r),atual:A3.aberta===r.c.id,
    prazo:p?{curta:p.curta,hora:"",rel:p.rel,exata:p.exata+" · "+r.prox.rotulo+" · "+p.rel,tom:r.grupo==="vencida"?"late":r.grupo==="semana"?"att":""}:{curta:"",exata:r.iniciado?"sem reunião agendada":"acompanhamento não iniciado"},
    titulo:r.c.nome,contexto:contextoA3(r),titleAbrir:"Abrir o acompanhamento",
    direita:[...marcasA3(r),r.iniciado?NPUI.etapa(ETAPAS_PT.map(([k,label])=>({k,label})),r.a.etapa_atual,{feitos:ETAPAS_PT.filter(([k])=>k==="mensal"?(r.a.fase==="mensal"||r.a.fase==="encerrado"):!!r.a[k+"_feita"]).map(([k])=>k)}):null,NPUI.quem(r.resp?.nome)],
    onOpen:li=>abrirPainelA3(r.c.id,{origem:li.querySelector(".np-it-abrir")})});
}
function listaA3(regs){
  const host=el("div",{class:"np-corpo"});const grupos=GRUPOS_A3.filter(([k])=>regs.some(r=>r.grupo===k));
  if(!grupos.length){host.append(NPUI.vazio({titulo:"Nada com esses filtros",texto:"Tire um filtro ou inicie o acompanhamento pela ficha do cliente.",acao:"Limpar filtros",onAcao:()=>{A3.f={escopo:"ativos",ciclo:false,mensal:false,pend:false,resp:"",fase:"",regua:""};render()}}));return host}
  const ab=gruposA3();
  for(const [k,l,tom] of grupos){const its=regs.filter(r=>r.grupo===k).sort((x,y)=>(x.prox?.data||"9999").localeCompare(y.prox?.data||"9999")||x.c.nome.localeCompare(y.c.nome));
    host.append(NPUI.grupo({id:k,titulo:l,n:its.length,tom,aberto:ab[k]!==false,onToggle:v=>{ab[k]=v;NPUI.pref.set("np-acomp-grupos",JSON.stringify(ab))},itens:its.map(linhaA3)}))}
  return host;
}
function filtrosA3(regs){
  const f=A3.f;const chips=[];const C=(o)=>{const c=NPUI.chip(o);chips.push(c);return c};const meu=meuColab();
  const ativos=regs.filter(r=>r.iniciado&&r.a.fase!=="encerrado");
  const esc=(k,l)=>C({label:l,on:f.escopo===k,grupo:"escopo",onclick:()=>{f.escopo=k;render()}});esc("ativos","Em acompanhamento");esc("encerrados","Encerrados");esc("todos","Todos os clientes");
  chips.push(NPUI.sepv());
  C({label:"Ciclo inicial",n:ativos.filter(r=>r.a.fase==="onboarding"||r.a.fase==="ciclo").length,on:f.ciclo,grupo:"attr",onclick:()=>{f.ciclo=!f.ciclo;if(f.ciclo)f.mensal=false;render()}});
  C({label:"Mensal",n:ativos.filter(r=>r.a.fase==="mensal").length,on:f.mensal,grupo:"attr",onclick:()=>{f.mensal=!f.mensal;if(f.mensal)f.ciclo=false;render()}});
  C({label:"Com pendência",n:ativos.filter(r=>r.pend.length).length,on:f.pend,grupo:"attr",onclick:()=>{f.pend=!f.pend;render()}}).classList.add("crit");
  if(meu)C({label:"Minhas",n:ativos.filter(r=>r.c.resp_estrategico_id===meu.id).length,on:f.resp==="eu",grupo:"attr",title:"Só os clientes em que sou o responsável estratégico",onclick:()=>{f.resp=f.resp==="eu"?"":"eu";render()}});
  const cont=new Map();for(const r of ativos){if(r.resp)cont.set(r.resp.id,(cont.get(r.resp.id)||0)+1)}
  const top=[...cont.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]).filter(id=>!(meu&&id===meu.id));
  if(top.length){chips.push(NPUI.sepv());for(const id of top){const co=(A.colab||[]).find(x=>x.id===id);if(co)C({label:NPUI.curto(co.nome),on:f.resp===id,grupo:"resp",onclick:()=>{f.resp=f.resp===id?"":id;render()}})}}
  const extras=[f.fase,f.regua,f.resp&&f.resp!=="eu"&&!top.includes(f.resp)].filter(Boolean).length;
  const mais=NPUI.chip({label:"Mais filtros",n:extras||null,on:extras>0,title:"Fase, responsável estratégico, régua",onclick:(e)=>NPUI.pop(e.currentTarget,()=>{
    const fFase=sel({"":"Todas as fases",...FASE_L},f.fase),fResp=sel({"":"Todos os responsáveis",...Object.fromEntries((A.colab||[]).filter(c=>c.ativo!==false).map(c=>[c.id,c.nome]))},f.resp==="eu"?(meu?.id||""):f.resp),fReg=sel({"":"Todas as réguas",...REGUA_L},f.regua);
    fFase.onchange=()=>{f.fase=fFase.value;render()};fResp.onchange=()=>{f.resp=fResp.value;render()};fReg.onchange=()=>{f.regua=fReg.value;render()};
    const L=(l,c)=>el("div",{},el("label",{},l),c);
    return [el("div",{class:"np-pop-form"},L("Fase",fFase),L("Responsável estratégico",fResp),L("Régua",fReg),
      el("div",{style:"display:flex;justify-content:space-between;gap:8px"},NPUI.btn("Limpar",{variante:"ghost",onclick:()=>{A3.f={escopo:"ativos",ciclo:false,mensal:false,pend:false,resp:"",fase:"",regua:""};NPUI.fecharPop();render()}}),NPUI.btn("Fechar",{onclick:()=>NPUI.fecharPop()})))]},{role:"dialog",label:"Mais filtros",alinhar:"dir",refoco:()=>$('#view-acompanhamento .np-chipf[aria-haspopup="dialog"]')})});
  mais.setAttribute("aria-haspopup","dialog");mais.setAttribute("aria-expanded","false");
  return {chips,fixos:[mais]};
}
function renderAcompanhamentoV3(){
  const v=$("#view-acompanhamento");if(!v)return;v.replaceChildren();v.classList.add("np-v3");A3.obra=null;A3.painel=null;
  if(!A3.lista){carregarLista();v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:"…",label:"carregando"}])}),NPUI.carregando(7));return}
  const regs=registrosA3();const ativos=regs.filter(r=>r.iniciado&&r.a.fase!=="encerrado");
  const nV=ativos.filter(r=>r.grupo==="vencida").length,nS=ativos.filter(r=>r.grupo==="semana").length,nSD=ativos.filter(r=>r.grupo==="sem_data").length,nP=ativos.reduce((s,r)=>s+r.pend.length,0),nM=ativos.filter(r=>r.a.fase==="mensal").length;
  const resumo=NPUI.resumo([{n:nV,label:"reuniões vencidas",tom:nV?"crit":"zero"},{n:nS,label:"esta semana",tom:nS?"att":"zero"},{n:nSD,label:"sem agendamento",tom:nSD?"att":"zero"},{n:nP,label:"pendências",tom:nP?"":"zero"},{n:nM,label:"no mensal"}]);
  const fl=filtrosA3(regs);
  v.append(NPUI.toolbar({resumo,filtros:fl.chips,filtrosFixos:fl.fixos,direita:[NPUI.btn("Clientes",{variante:"ghost",title:"Lista de clientes",onclick:()=>irPara("clientes")})]}));NPUI.reancorarPop();
  if(A3.erro&&/acompanhamento_pj|v_acompanhamento/.test(A3.erro))v.append(NPUI.faixaErro({texto:"Acompanhamento PJ indisponível neste ambiente: rode a migração 0104.",acao:"Tentar de novo",onAcao:()=>carregarLista(true)}));
  const obra=el("div",{class:"np-obra"});A3.obra=obra;const lista=filtrarA3(regs);const corpo=listaA3(lista);
  corpo.append(NPUI.rodape(`${lista.length} cliente${lista.length===1?"":"s"} com estes filtros`,[["late","reunião vencida"],["att","esta semana"]]));
  obra.append(corpo);v.append(obra);
  A3.painel=NPUI.painel({obra,label:"Acompanhamento do cliente",onClose:()=>{A3.aberta=null}});
  if(A3.aberta){if(regs.some(r=>r.c.id===A3.aberta))abrirPainelA3(A3.aberta,{silencioso:true});else A3.aberta=null}
}
/* painel: SEMPRE a partir do id → cliente atual de S.clientes + registro atual; as ações recebem esse `c` explicitamente */
function abrirPainelA3(cid,{origem,silencioso}={}){
  const c=(S.clientes||[]).find(x=>x.id===cid);if(!c){toast("Cliente não encontrado");return}
  A3.aberta=cid;const st=A.cache[cid];if(!st?.ok){A3.esperando=cid;carregar(cid);}
  const m=montarPainelA3(c);if(!m)return;
  A3.painel.abrir({id:cid,trilha:m.trilha,titulo:c.nome,corpo:m.corpo,pe:m.pe,origem:silencioso?null:origem});
}
/* conteúdo do painel a partir do cliente atual (S.clientes) e do registro atual — reutilizado na abertura e na atualização silenciosa */
function montarPainelA3(c){
  const cid=c.id;const st=A.cache[cid];
  const r=registrosA3().find(x=>x.c.id===cid);const a=r?.a||null;const edita=podeEditar()&&!readOnly();
  const prox=r?.prox;const pp=prox?NPUI.prazoTxt(prox.data):null;
  const props=NPUI.props([
    ["Fase",a?.fase?[FASE_L[a.fase]||a.fase,(a.fase==="onboarding"||a.fase==="ciclo")&&diaCiclo(a)!=null&&diaCiclo(a)>=0?el("small",{style:"margin-left:6px;color:var(--np-text-3)"},`dia ${diaCiclo(a)} de 45`):null]:el("span",{class:"np-sem"},"acompanhamento não iniciado")],
    ["Próxima reunião",pp?[pp.exata," ",el("span",{class:"np-marca "+(r.grupo==="vencida"?"crit":r.grupo==="semana"?"att":"")},prox.rotulo+" · "+pp.rel)]:el("span",{class:"np-sem"},a?"sem reunião agendada":"—"),"serif"],
    ["Responsável",r?.resp?NPUI.quem(r.resp.nome):el("span",{class:"np-sem"},"— ninguém —")],
    ["Direcionamento",c.direcionamento?"→ "+(DIREC_L[c.direcionamento]||c.direcionamento)+(c.direcionamento_em?" (em "+fmtD(diaISO(c.direcionamento_em))+")":""):el("span",{class:"np-sem"},"ainda não direcionado")],
    ["Régua",c.regua?REGUA_L[c.regua]:null],
    ["Acordos",a?(a.acordos_liberado?NPUI.marca("liberado em "+fmtD(diaISO(a.acordos_liberado_em||"")),"ok"):el("span",{class:"np-sem"},"aguarda a R1 + Raio-X")):null],
    ["Reserva",[el("span",{},"planejada: "+(c.projeto_reserva?RESERVA_L[c.projeto_reserva]:"não iniciada")),el("br"),el("span",{},"acumulada: "),c.reservaAcumulada?[el("b",{style:"font-family:var(--np-display)"},BRL(+c.reservaAcumulada)),el("small",{style:"margin-left:6px;color:var(--np-text-3)"},"informada pelo cliente")]:el("span",{class:"np-sem"},"não informada")]],
  ].filter(x=>x&&x[1]!=null));
  const passos=ETAPAS_PT.map(([k,label])=>{const d=k==="mensal"?diaISO(a?.proxima_reuniao):diaISO(a?.[k+"_data"]);const feita=k==="mensal"?(a?.fase==="mensal"||a?.fase==="encerrado"):!!a?.[k+"_feita"];return {label:k==="onb"?"Onboarding":label,data:d?fmtD(d):"—",feita,atual:a?a.etapa_atual===k:k==="onb"}});
  const secCiclo=NPUI.secao("Ciclo de acompanhamento",NPUI.ciclo(passos),a?.observacoes?el("div",{style:"margin-top:8px;white-space:pre-wrap;font-size:var(--np-fs-2)"},a.observacoes):null,!a?el("div",{class:"np-sem",style:"margin-top:8px"},"Defina a data do onboarding para começar."):null);
  const ds=st?.ok?st.dividas:null;
  const secRaio=NPUI.secao("Raio-X · dívidas",ds?NPUI.tabela([{k:"banco",label:"Banco"},{k:"tipo",label:"Tipo"},{k:"valor",label:"Valor",num:true,render:d=>d.valor!=null?BRL(+d.valor):null},{k:"atraso",label:"Atraso",render:d=>d.atraso_meses==null?null:d.atraso_meses===0?"em dia":d.atraso_meses+" m"},{k:"avalista",label:"Avalista",render:d=>d.avalista?(d.avalista_nome||"sim"):"não"},{k:"garantia",label:"Garantia",render:d=>d.garantia?(d.garantia_descricao||"sim"):"não"}],ds,{vazio:"Nenhuma dívida mapeada ainda (preenchida na R1; é o que libera Acordos).",label:"Dívidas do Raio-X"}):NPUI.carregando(2),
    ds&&ds.length?el("div",{class:"np-rodape",style:"padding:6px 0 0"},`${ds.length} dívida${ds.length===1?"":"s"} · ${BRL(ds.reduce((s,d)=>s+(+d.valor||0),0))} · ${ds.filter(d=>(d.atraso_meses||0)>0).length} em atraso`):null);
  const pend=(r?.pend||[]).slice().sort((x,y)=>(x.prazo||"9999").localeCompare(y.prazo||"9999"));
  const secPend=NPUI.secao("Pendências (tarefas do núcleo)",pend.length?NPUI.passos(pend.map(t=>{const p=NPUI.prazoTxt(t.prazo);const venc=t.prazo&&t.prazo<hojeISO();return {estado:venc?"crit":"",el:el("button",{type:"button",class:"lnk",style:"text-align:left",onclick:()=>{if(window.PP_TAREFAS?.abrir)PP_TAREFAS.abrir(t.id)}},t.titulo),sub:(t.prazo?p.exata+" · "+p.rel:"sem prazo")+(t.responsavel_nome?" · "+NPUI.curto(t.responsavel_nome):"")}})):el("div",{class:"np-sem"},"Nenhuma tarefa aberta do núcleo para este cliente."));
  const atas=st?.ok?st.atas:null;
  const secAtas=NPUI.secao("Atas",atas?(atas.length?NPUI.passos(atas.map(x=>({estado:"ok",el:el("span",{},el("b",{},TIPO_ATA[x.tipo]||x.tipo)," · ",fmtD(x.data),x.titulo?" · "+x.titulo:""),sub:[(A.colab.find(k=>k.id===x.autor_id)?.nome||""),x.link_pasta?el("a",{href:x.link_pasta,target:"_blank",rel:"noopener",style:"margin-left:8px"},"pasta"):null,x.link_gravacao?el("a",{href:x.link_gravacao,target:"_blank",rel:"noopener",style:"margin-left:8px"},"gravação"):null,edita?el("button",{type:"button",class:"lnk",style:"margin-left:8px",onclick:()=>formAta(c,x)},"editar"):null]}))):el("div",{class:"np-sem"},"Nenhuma ata registrada.")):NPUI.carregando(2));
  /* Negociações do cliente (B2) — lidas pelo id do cliente no módulo de Negociações; cada uma só com os próprios valores (nenhuma soma global) */
  const secNeg=(()=>{const NG=window.PP_NEG;if(!NG?.podeVer||NG.podeVer()!==true)return null;const lista=NG.porCliente(cid);
    if(lista===null){const e=NG.estado?.();if(e&&!e.carregado&&!e.carregando&&!e.erro)NG.carregar?.();/* com erro não insiste: evita laço de recarga */return NPUI.secao("Negociações",e?.erro?el("div",{class:"np-sem"},"Negociações indisponíveis no momento."):NPUI.carregando(2))}
    const abertas=lista.filter(n=>n.etapa!=="concluido"),concl=lista.length-abertas.length;const nova=edita&&!readOnly()&&NG.nova?NPUI.btn("Nova negociação",{variante:"ghost",icone:"mais",onclick:()=>NG.nova(c)}):null;
    return NPUI.secao(`Negociações${abertas.length?" · "+abertas.length+" aberta"+(abertas.length===1?"":"s"):""}`,
      abertas.length?el("div",{class:"np-vinc-l"},abertas.map(n=>NG.linhaCompacta(n))):el("div",{class:"np-sem"},"Nenhuma negociação aberta para este cliente."),
      el("div",{class:"np-rodape",style:"padding:6px 0 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"},concl?el("span",{},`${concl} concluída${concl===1?"":"s"}`):null,nova))})();
  const trilha=[el("span",{},"Clientes"),el("span",{class:"sep"}),el("span",{},"Acompanhamento PJ")];
  const pe=[edita?NPUI.btn("Registrar ata",{variante:"pri",onclick:()=>formAta(c,null)}):null,edita?NPUI.btn(a?"Atualizar ciclo":"Definir datas",{onclick:()=>formCiclo(c,a)}):null,
    (()=>{const m=NPUI.btn("Mais ações",{variante:"ghost",onclick:(e)=>NPUI.pop(e.currentTarget,[edita?{label:"Criar tarefas do ciclo",onclick:()=>criarTarefasCiclo(c,a)}:null,edita?{label:"Incluir dívida no Raio-X…",onclick:()=>formDivida(c,null)}:null,{label:"Abrir ficha do cliente",onclick:()=>{S.tab="clientes";S.sel=c.id;S.sub="acompanhamento";try{localStorage.setItem("pp-tab","clientes")}catch(_){}render()}}].filter(Boolean),{label:"Mais ações",alinhar:"dir"})});m.setAttribute("aria-haspopup","menu");m.setAttribute("aria-expanded","false");return m})()];
  return {trilha,corpo:[props,secCiclo,secNeg,secRaio,secPend,secAtas],pe};
}
/* rota #acompanhamento: só com a casca V3.1 e permissão; fora disso, volta para Clientes (ou Hoje) — inclusive quando aberta por hash/URL */
{const _r=render;render=function(){_r();const v=$("#view-acompanhamento");if(!v)return;
  if(S.tab==="acompanhamento"&&!(acompV3()&&podeVerTransversal())){S.tab=(typeof PP.temAcesso==="function"&&PP.temAcesso("clientes"))?"clientes":"painel";try{localStorage.setItem("pp-tab",S.tab)}catch(_){}v.hidden=true;setTimeout(()=>render(),0);return}
  v.hidden=S.tab!=="acompanhamento";if(S.tab!=="acompanhamento")return;
  if(A3.esperando&&A3.obra&&A3.painel&&A3.aberta===A3.esperando&&A.cache[A3.esperando]?.ok&&A3.lista){const c=(S.clientes||[]).find(x=>x.id===A3.esperando);A3.esperando=null;const m=c&&montarPainelA3(c);if(m){A3.painel.atualizar({corpo:m.corpo,pe:m.pe});return}}
  renderAcompanhamentoV3()}}
const invalidarLista=()=>{A3.lista=null};
window.__PP_LOGIN?.then?.(()=>{try{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("acomp-pj");for(const t of ["acompanhamento_pj","atas_reuniao","dividas_raio_x"])ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>{invalidarLista();if(S.tab==="acompanhamento")render()});ch.subscribe()}}catch(_){}});
window.PP_ACOMP={invalidar,carregar,filtro:(f={})=>{A3.f={escopo:"ativos",ciclo:false,mensal:false,pend:false,resp:"",fase:"",regua:"",...f};render()},filtroAtual:()=>({...A3.f}),registros:()=>podeVerTransversal()?registrosA3():[],podeVer:podeVerTransversal,
  estado:()=>({carregado:!!A3.lista,carregando:A3.carregando,erro:A3.erro,vazio:!!A3.lista&&!A3.lista.length,esperando:A3.esperando,aberta:A3.aberta,lista:!!A3.lista,cache:Object.fromEntries(Object.entries(A.cache).map(([k,v])=>[k,{ok:!!v.ok,carregando:!!v.carregando,erro:v.erro||null,dividas:v.dividas?.length,atas:v.atas?.length}]))}),
  /* ---- contrato público (Fase 4B) — falha-fechado ---- */
  carregarLista:()=>{if(!podeVerTransversal())return false;carregarLista();return true},
  // null = sem permissão ou lista ainda não carregada; {iniciado:false} = cliente visível sem acompanhamento; registro completo caso contrário
  porCliente:cid=>{if(!podeVerTransversal()||!A3.lista||!cid)return null;const r=registrosA3().find(x=>x.c.id===cid);return r||null},
  // marcos do ciclo com data gravada (previstos/realizados) — só leitura, para a Agenda; nunca cria nada
  marcos:()=>{if(!podeVerTransversal()||!A3.lista)return null;const out=[];for(const a of A3.lista){const c=(S.clientes||[]).find(x=>x.id===a.cliente_id);if(!c||!a.fase||a.fase==="encerrado")continue;
      for(const [k,l] of [["onb","Onboarding"],["r1","R1"],["r2","R2"],["r3","R3"]]){const d=diaISO(a[k+"_data"]);if(d)out.push({cliente_id:c.id,cliente_nome:c.nome,chave:k,rotulo:l,data:d,realizada:!!a[k+"_feita"],responsavel_id:c.resp_estrategico_id||null})}
      if(a.proxima_reuniao)out.push({cliente_id:c.id,cliente_nome:c.nome,chave:"mensal",rotulo:"Mensal",data:diaISO(a.proxima_reuniao),realizada:false,responsavel_id:c.resp_estrategico_id||null})}
    return out},
  abrir:cid=>{if(!podeVerTransversal())return false;const c=(S.clientes||[]).find(x=>x.id===cid);if(!c)return false;
    if(!acompV3()){S.tab="clientes";S.sel=cid;S.sub="acompanhamento";try{localStorage.setItem("pp-tab","clientes")}catch(_){}render();return true}
    const jaNaAba=S.tab==="acompanhamento";A3.aberta=cid;S.tab="acompanhamento";try{localStorage.setItem("pp-tab","acompanhamento")}catch(_){}
    if(jaNaAba&&A3.painel&&A3.lista){abrirPainelA3(cid);return true}render();return true}};
})();
