/* Financeiro — cobranças do Asaas (entrada, parcelas, êxito): espelho das cobranças, criação pelo painel, baixa automática
   por webhook, inadimplência por cliente e régua de cobrança por WhatsApp. Supabase: cobrancas, v_cobrancas, v_financeiro_mes,
   asaas_clientes, asaas_sincronizacoes, escritorio('financeiro') (0055). Edge: /enviar acao asaas_* . */
(()=>{
"use strict";
const F={ok:false,carregando:false,rows:[],mes:[],sinc:null,cfg:null,fStatus:"abertas",fCli:"",fTipo:"",q:""};
const podeFin=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("financeiro");
const TIPO={entrada:"Entrada",parcela:"Parcela",exito:"Êxito",mensalidade:"Mensalidade",outro:"Outro"};
const ST={pendente:["Em aberto","g"],paga:["Paga","e1"],atrasada:["Atrasada","e3"],estornada:["Estornada","c"],cancelada:["Cancelada","c"],outra:["Outra","c"]};
const FORMA={UNDEFINED:"Boleto ou Pix (cliente escolhe)",BOLETO:"Boleto",PIX:"Pix",CREDIT_CARD:"Cartão"};
const R$=v=>(v==null||isNaN(v))?"—":(+v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const hojeISO=()=>new Date(Date.now()-3*3600e3).toISOString().slice(0,10);
const mesAtual=()=>hojeISO().slice(0,7);
const check=(label,checked)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;return {wrap:el("label",{style:"display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fg);cursor:pointer"},i,label),input:i}};
async function edge(body){
  const {data:{session}}=await SB.auth.getSession();if(!session)throw new Error("Faça login de novo");
  const r=await fetch(SB_URL+"/functions/v1/chatguru/enviar",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({ok:false,erro:"Resposta inválida"}));if(!r.ok||j.ok===false)throw new Error(j.erro||("HTTP "+r.status));return j;
}
async function carregar(){
  if(F.carregando)return;F.carregando=true;
  try{
    const desde=new Date(Date.now()-120*864e5).toISOString().slice(0,10);
    const pag=async(q)=>{const out=[];for(let i=0;i<10;i++){const {data,error}=await q.range(i*1000,i*1000+999);if(error)throw error;out.push(...(data||[]));if((data||[]).length<1000)break}return out};
    const [ab,pg,m,s,e]=await Promise.all([pag(SB.from("v_cobrancas").select("*").in("status",["pendente","atrasada"]).order("vencimento",{ascending:true})),
      pag(SB.from("v_cobrancas").select("*").in("status",["paga","estornada","cancelada"]).gte("vencimento",desde).order("vencimento",{ascending:false})),
      SB.from("v_financeiro_mes").select("*").eq("mes",mesAtual()).maybeSingle(),
      SB.from("asaas_sincronizacoes").select("*").order("id",{ascending:false}).limit(1).maybeSingle(),SB.from("escritorio").select("dados").eq("id","financeiro").maybeSingle()]);
    F.rows=[...ab,...pg];F.mes=m.data?[m.data]:[];F.sinc=s.data||null;F.cfg=e.data?.dados||{};F.ok=true;
  }catch(e){console.warn("financeiro",e);toast("Não foi possível carregar o financeiro")}
  finally{F.carregando=false}
  render();
}
const garantir=()=>{if(!F.ok&&!F.carregando)carregar();return F.ok};
const invalidar=()=>{F.ok=false;garantir()};

function renderFinanceiro(){
  const v=$("#view-financeiro");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Financeiro"),el("h1",{},"Cobranças"),el("div",{class:"sub"},"Entrada, parcelas e êxito cobrados pelo Asaas. Pagamentos dão baixa sozinhos (webhook) e marcam o cliente como adimplente ou não. A régua de cobrança por WhatsApp é opcional.")),
    el("div",{class:"actions"},el("button",{class:"btn",onclick:sincronizar},"Sincronizar com o Asaas"),el("button",{class:"btn primary",onclick:()=>openCobrancaForm(null)},"+ Nova cobrança"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const hoje=hojeISO(),mes=mesAtual();
  const abertas=F.rows.filter(r=>["pendente","atrasada"].includes(r.status));
  const atras=F.rows.filter(r=>r.status==="atrasada");
  const mesRow=F.mes.find(m=>m.mes===mes)||{};
  const aReceberMes=F.rows.filter(r=>r.status==="pendente"&&(r.vencimento||"").startsWith(mes)).reduce((a,r)=>a+(+r.valor||0),0);
  v.append(el("div",{class:"kpis fin-kpis"},kpi("Recebido no mês",R$(+mesRow.recebido||0),`${mesRow.n_pagas||0} cobrança(s) paga(s)`),kpi("A vencer no mês",R$(aReceberMes),"em aberto com vencimento neste mês"),
    kpi("Em atraso",R$(atras.reduce((a,r)=>a+(+r.valor||0),0)),`${atras.length} cobrança(s) · ${new Set(atras.map(r=>r.cliente_id)).size} cliente(s)`),kpi("Em aberto (total)",R$(abertas.reduce((a,r)=>a+(+r.valor||0),0)),`${abertas.length} cobrança(s)`)));
  // config + sincronização
  const regua=check("Régua de cobrança por WhatsApp (3 dias antes, no dia, +1, +5, +10 → tarefa para o administrativo)",!!F.cfg.regua_whatsapp);
  regua.input.disabled=PP.perfil?.papel!=="admin";
  regua.input.onchange=async()=>{const {error}=await SB.from("escritorio").update({dados:{...F.cfg,regua_whatsapp:regua.input.checked}}).eq("id","financeiro");if(error){toast("Não foi possível salvar");regua.input.checked=!regua.input.checked;return}F.cfg.regua_whatsapp=regua.input.checked;toast(regua.input.checked?"Régua ligada — roda todo dia às 9h10":"Régua desligada")};
  v.append(el("div",{class:"card",style:"display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between"},regua.wrap,
    el("div",{class:"note"},F.sinc?`Última sincronização: ${new Date(F.sinc.inicio).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})} · ${F.sinc.ok?`${F.sinc.cobrancas} cobrança(s), ${F.sinc.clientes} cliente(s) vinculados`:"erro: "+(F.sinc.erro||"")}`:"Ainda não sincronizado com o Asaas.")));
  // filtros
  const fs=sel({abertas:"Em aberto e atrasadas",atrasada:"Só atrasadas",pendente:"Só em aberto",paga:"Pagas (últimos 120 dias)",todas:"Todas (abertas + 120 dias)"},F.fStatus);fs.onchange=()=>{F.fStatus=fs.value;render()};
  const clis=[...new Map(F.rows.filter(r=>r.cliente_id).map(r=>[r.cliente_id,r.cliente_nome||r.cliente_id])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  const fc=sel({"":"Todos os clientes",sem:"— sem cliente vinculado —",...Object.fromEntries(clis)},F.fCli);fc.onchange=()=>{F.fCli=fc.value;render()};
  const ft=sel({"":"Todos os tipos",...TIPO},F.fTipo);ft.onchange=()=>{F.fTipo=ft.value;render()};
  const q=inp("search",F.q,{placeholder:"descrição, cliente…"});q.oninput=()=>{F.q=q.value;render()};
  v.append(el("div",{class:"filters",style:"display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"},fs,fc,ft,q));
  let rows=F.rows.filter(r=>F.fStatus==="todas"||(F.fStatus==="abertas"?["pendente","atrasada"].includes(r.status):r.status===F.fStatus));
  if(F.fCli==="sem")rows=rows.filter(r=>!r.cliente_id);else if(F.fCli)rows=rows.filter(r=>r.cliente_id===F.fCli);
  if(F.fTipo)rows=rows.filter(r=>r.tipo===F.fTipo);
  if(F.q){const t=F.q.toLowerCase();rows=rows.filter(r=>(r.descricao||"").toLowerCase().includes(t)||(r.cliente_nome||"").toLowerCase().includes(t))}
  rows.sort((a,b)=>(a.status==="atrasada"?0:1)-(b.status==="atrasada"?0:1)||(a.vencimento||"").localeCompare(b.vencimento||""));
  const LIM=400;const total=rows.length;rows=rows.slice(0,LIM);
  const semCli=F.rows.filter(r=>!r.cliente_id&&["pendente","atrasada"].includes(r.status)).length;
  if(semCli)v.append(el("div",{class:"note",style:"color:var(--warn);margin-bottom:8px"},`${semCli} cobrança(s) do Asaas sem cliente vinculado — o vínculo é automático pelo CNPJ/CPF da ficha; confira o CNPJ do cliente ou vincule pelo botão na linha.`));
  v.append(el("div",{class:"card",style:"padding:0;overflow:auto"},el("table",{class:"tbl"},el("thead",{},el("tr",{},...["Vencimento","Cliente","Descrição","Tipo","Valor","Status","Pago em","",""].map(h=>el("th",{},h)))),
    el("tbody",{},rows.length?rows.map(linha):el("tr",{},el("td",{colspan:"9",class:"note"},"Nenhuma cobrança neste filtro."))))),total>LIM?el("div",{class:"note",style:"margin-top:6px"},`Mostrando ${LIM} de ${total} — use os filtros para refinar.`):null);
}
function linha(r){
  const st=ST[r.status]||[r.status,"c"];
  return el("tr",{},el("td",{class:"num"},r.vencimento?fmtD(parseD(r.vencimento)):"—",r.dias_atraso?el("div",{class:"note",style:"color:var(--crit)"},`${r.dias_atraso}d`):null),
    el("td",{},r.cliente_id?el("a",{href:"#clientes/"+r.cliente_id,style:"color:var(--info)",onclick:e=>{e.preventDefault();S.sel=r.cliente_id;S.tab="clientes";S.sub="geral";render()}},r.cliente_nome||r.cliente_id):el("button",{class:"btn sm",onclick:()=>vincular(r)},"Vincular cliente")),
    el("td",{},r.descricao||"—",r.total_parcelas?el("div",{class:"note"},`parcela ${r.parcela||"?"}/${r.total_parcelas}`):r.parcela?el("div",{class:"note"},`parcela ${r.parcela}`):null),
    el("td",{},TIPO[r.tipo]||r.tipo),el("td",{class:"num"},R$(r.valor)),el("td",{},el("span",{class:"pill "+st[1]},st[0]),r.regua_parada?el("div",{class:"note"},"régua esgotada"):r.regua_enviadas?.length?el("div",{class:"note"},`régua: ${r.regua_enviadas.length} msg`):null),
    el("td",{class:"num"},r.pago_em?fmtD(parseD(r.pago_em)):"—"),
    el("td",{},r.link_fatura?el("a",{href:r.link_fatura,target:"_blank",rel:"noopener",class:"btn sm"},"Fatura"):null),
    el("td",{},el("button",{class:"btn sm",onclick:()=>openDetalhe(r)},"…")));
}
async function sincronizar(){
  toast("Sincronizando com o Asaas…");
  try{const j=await edge({acao:"asaas_sincronizar",dias:F.sinc?60:0});toast(`Asaas: ${j.cobrancas} cobrança(s), ${j.clientes} cliente(s) vinculado(s)`);invalidar()}
  catch(e){toast(e.message||"Falha na sincronização")}
}
async function vincular(r){
  const cli=sel({"":"— cliente —",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(x=>[x.id,x.nome]))},"");
  const body=el("div",{class:"form"},field("vc-cli","Cliente do sistema",cli,"Vincula esta cobrança e as demais do mesmo cliente no Asaas."));
  modal("Vincular cobrança a um cliente",body,async()=>{
    if(!cli.value)throw new Error("Escolha o cliente");
    const {error}=await SB.rpc("asaas_vincular_manual",{p_cliente:cli.value,p_asaas_cliente:r.asaas_cliente_id,p_cobranca:r.id});if(error)throw new Error(error.message);
    toast("Vinculado");invalidar();
  });
}
function openDetalhe(r){
  const st=ST[r.status]||[r.status,"c"];
  const kv=(k,v)=>el("div",{class:"kv"},el("div",{class:"k"},k),el("div",{class:"v"},v??"—"));
  const body=el("div",{},el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"},kv("Cliente",r.cliente_nome),kv("Descrição",r.descricao),kv("Tipo",TIPO[r.tipo]),kv("Valor",R$(r.valor)),kv("Líquido",R$(r.valor_liquido)),
    kv("Vencimento",r.vencimento?fmtD(parseD(r.vencimento)):null),kv("Status",el("span",{class:"pill "+st[1]},st[0]+(r.status_asaas?" · "+r.status_asaas:""))),kv("Pago em",r.pago_em?fmtD(parseD(r.pago_em)):null),kv("Forma",FORMA[r.forma]||r.forma),kv("Asaas",r.asaas_id),
    kv("Régua",r.regua_enviadas?.length?r.regua_enviadas.join(", "):"nenhuma mensagem")),
    el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:12px"},r.link_fatura?el("a",{href:r.link_fatura,target:"_blank",rel:"noopener",class:"btn sm"},"Abrir fatura"):null,r.link_boleto?el("a",{href:r.link_boleto,target:"_blank",rel:"noopener",class:"btn sm"},"Boleto PDF"):null,
      r.asaas_id&&["pendente","atrasada"].includes(r.status)?el("button",{class:"btn sm",onclick:async()=>{try{const j=await edge({acao:"asaas_pix",asaas_id:r.asaas_id});await navigator.clipboard?.writeText(j.payload||"");toast("Pix copia-e-cola copiado")}catch(e){toast(e.message)}}},"Copiar Pix"):null,
      ["pendente","atrasada"].includes(r.status)?el("button",{class:"btn sm",onclick:async()=>{const {error}=await SB.from("cobrancas").update({regua_parada:!r.regua_parada}).eq("id",r.id);if(error){toast("Não foi possível");return}toast(r.regua_parada?"Régua reativada":"Régua pausada para esta cobrança");$("#modalHost").replaceChildren();invalidar()}},r.regua_parada?"Reativar régua":"Pausar régua"):null));
  const obs=el("textarea",{placeholder:"Observações internas (ex.: cliente pediu nova data)"},r.observacoes||"");
  body.append(el("div",{class:"form",style:"margin-top:12px"},field("cb-obs","Observações",obs)));
  modal("Cobrança",body,async()=>{const {error}=await SB.from("cobrancas").update({observacoes:obs.value.trim()||null}).eq("id",r.id);if(error)throw new Error(error.message);toast("Salvo");invalidar()});
}
function openCobrancaForm(c){
  const cli=sel({"":"— cliente —",...Object.fromEntries([...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||"")).map(x=>[x.id,x.nome]))},c?c.id:"");if(c)cli.disabled=true;
  const tipo=sel(TIPO,"entrada"),valor=inp("number","",{step:"0.01",min:"1",placeholder:"0,00"}),venc=inp("date",""),forma=sel(FORMA,"UNDEFINED"),parc=inp("number","1",{min:"1",max:"60"}),desc=inp("text","",{placeholder:"Ex.: Entrada — honorários Gestão de Passivos"});
  const konWrap=el("div",{});const konSel=()=>{const ks=S.contratos.filter(k=>k.clienteId===cli.value);const s=sel({"":"— sem vínculo —",...Object.fromEntries(ks.map(k=>[k.id,(k.banco||"")+" · "+(k.produto||"")]))},"");konWrap.replaceChildren(s);return s};let kon=konSel();cli.onchange=()=>{kon=konSel()};
  const hint=el("div",{class:"note"});const calc=()=>{const v=+valor.value||0,n=+parc.value||1;hint.textContent=n>1&&v?`${n} parcelas de ${R$(v/n)} (total ${R$(v)}), vencendo a cada mês a partir da data acima`:v?`Cobrança única de ${R$(v)}`:""};valor.oninput=parc.oninput=calc;
  const body=el("div",{class:"form"},field("nc-cli","Cliente",cli),field("nc-tipo","Tipo",tipo),field("nc-val","Valor total (R$)",valor),field("nc-parc","Parcelas",parc,hint),field("nc-venc","Vencimento (da 1ª parcela)",venc),field("nc-forma","Forma",forma),field("nc-desc","Descrição (aparece no boleto)",desc),el("div",{class:"f"},el("label",{},"Contrato relacionado"),konWrap),
    el("div",{class:"note full"},"O cliente é criado no Asaas automaticamente pelo CNPJ/CPF da ficha (se ainda não existir). O boleto/Pix fica no Asaas; o link aparece aqui e pode ir pela régua de WhatsApp."));
  modal("Nova cobrança no Asaas",body,async()=>{
    if(!cli.value)throw new Error("Escolha o cliente");if(!(+valor.value>0))throw new Error("Informe o valor");if(!venc.value)throw new Error("Informe o vencimento");
    const j=await edge({acao:"asaas_cobrar",cliente_id:cli.value,tipo:tipo.value,valor:+valor.value,vencimento:venc.value,forma:forma.value,parcelas:+parc.value||1,descricao:desc.value.trim(),contrato_id:kon.value||null});
    toast(j.aviso||`${j.pagamentos} cobrança(s) criada(s)`);invalidar();try{notificar("clientes")}catch(_){}
  });
}
/* ---------- card na ficha do cliente ---------- */
function cardFinanceiro(c){
  const card=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Financeiro"),el("div",{class:"note"},"Cobranças do Asaas deste cliente.")),el("div",{class:"actions edit-only"},el("button",{class:"btn sm primary",onclick:()=>openCobrancaForm(c)},"+ Cobrança"))),el("div",{class:"note"},"Carregando…"));
  (async()=>{
    const {data,error}=await SB.from("v_cobrancas").select("*").eq("cliente_id",c.id).order("vencimento",{ascending:false}).limit(60);
    if(error){card.lastChild.textContent="Não foi possível carregar.";return}
    const rows=data||[];const ab=rows.filter(r=>["pendente","atrasada"].includes(r.status)),at=rows.filter(r=>r.status==="atrasada");
    const resumo=el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"},el("span",{class:"pill "+(at.length?"e3":"e1")},at.length?`${at.length} em atraso · ${R$(at.reduce((a,r)=>a+(+r.valor||0),0))}`:"Sem atraso"),el("span",{class:"pill g"},`${ab.length} em aberto · ${R$(ab.reduce((a,r)=>a+(+r.valor||0),0))}`),el("span",{class:"pill g"},`${rows.filter(r=>r.status==="paga").length} paga(s)`));
    const lista=rows.slice(0,12).map(r=>{const st=ST[r.status]||[r.status,"c"];return el("div",{class:"note",style:"display:flex;gap:8px;align-items:center;padding:3px 0;border-top:1px solid var(--line)"},el("span",{class:"pill "+st[1],style:"min-width:80px;text-align:center"},st[0]),el("span",{style:"min-width:70px"},r.vencimento?fmtD(parseD(r.vencimento)):"—"),el("span",{style:"flex:1"},(r.descricao||TIPO[r.tipo])+(r.total_parcelas?` (${r.parcela}/${r.total_parcelas})`:"")),el("b",{},R$(r.valor)),r.link_fatura?el("a",{href:r.link_fatura,target:"_blank",rel:"noopener",style:"color:var(--info)"},"fatura"):null,el("button",{class:"btn sm",onclick:()=>openDetalhe(r)},"…"))});
    card.replaceChildren(card.firstChild,resumo,lista.length?el("div",{},...lista):el("div",{class:"note"},"Nenhuma cobrança registrada. Sincronize com o Asaas em Financeiro ou crie a primeira."));
  })();
  return card;
}
/* ---------- estilo e registro ---------- */
document.head.append(el("style",{},`.fin-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:1000px){.fin-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}`));
window.PP_FINANCEIRO={invalidar,render:renderFinanceiro,cardFinanceiro};
{const _r=render;render=function(){_r();const vf=$("#view-financeiro");if(!vf)return;if(!podeFin()&&S.tab==="financeiro")S.tab="clientes";vf.hidden=S.tab!=="financeiro";if(S.tab==="financeiro")renderFinanceiro()}}
{const _r=window.PP_MOD.resumo;window.PP_MOD.resumo=(c,host,ind)=>{_r&&_r(c,host,ind);if(readOnly()||!podeFin())return;if(S.sub==="dossie"||S.sub==="cliente")return;host.append(cardFinanceiro(c))}}
window.__PP_LOGIN?.then(()=>{if(podeFin()){const ch=SB.channel("financeiro");let t;const re=()=>{clearTimeout(t);t=setTimeout(invalidar,500)};ch.on("postgres_changes",{event:"*",schema:"public",table:"cobrancas"},re);ch.subscribe()}});
})();
