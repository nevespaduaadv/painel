/* Inventário patrimonial — Financeiro → Inventário: equipamentos com ID patrimonial, características por tipo, responsável,
   departamento, histórico de movimentações e revisão periódica pelo sistema de tarefas. Supabase: inventario_itens, v_inventario,
   v_inventario_movimentos, inventario_revisoes, rpc inventario_gerar_revisao / inventario_revisar, escritorio('inventario') (0064). */
(()=>{
"use strict";
const I={ok:false,carregando:false,itens:[],movs:[],colab:[],cfg:null,revisao:null,revItens:[],aba:"itens",q:"",tipo:"",resp:"",dep:"",sit:""};
const podeFin=()=>PP.perfil?.papel==="admin"||(PP.perfil?.acessos||[]).includes("financeiro");
const TIPOS={notebook:"Notebook",desktop:"Desktop",monitor:"Monitor",mouse:"Mouse",teclado:"Teclado",headset:"Headset / fone",webcam:"Webcam",celular:"Celular",impressora:"Impressora",roteador:"Roteador / rede",cadeira:"Cadeira",mesa:"Mesa",outro:"Outro"};
const SIT={em_uso:["Em uso","e1"],disponivel:["Disponível","g"],manutencao:["Manutenção","e2"],baixado:["Baixado","c"]};
const ESPEC={notebook:[["processador","Processador"],["ram","Memória RAM"],["armazenamento","Armazenamento"],["tela","Tela"],["so","Sistema operacional"]],desktop:[["processador","Processador"],["ram","Memória RAM"],["armazenamento","Armazenamento"],["so","Sistema operacional"]],
  monitor:[["tamanho","Tamanho (pol.)"],["resolucao","Resolução"],["conexoes","Conexões"]],mouse:[["conexao","Conexão (fio/wireless)"]],teclado:[["conexao","Conexão (fio/wireless)"],["layout","Layout"]],headset:[["conexao","Conexão"],["microfone","Microfone"]],webcam:[["resolucao","Resolução"]],
  celular:[["imei","IMEI"],["linha","Linha / número"],["armazenamento","Armazenamento"]],impressora:[["tecnologia","Tecnologia (laser/jato)"],["conexao","Conexão"]],roteador:[["padrao","Padrão (Wi-Fi 5/6)"]],cadeira:[],mesa:[],outro:[]};
const DEPS=["Jurídico","Acordos","Comercial","Marketing","Financeiro / Administrativo","Sócias","Recepção","Copa","TI"];
const fmtDT=iso=>new Date(iso).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
async function carregar(){
  if(I.carregando)return;I.carregando=true;
  try{const [it,mv,co,cf,rv]=await Promise.all([SB.from("v_inventario").select("*").order("patrimonio"),SB.from("v_inventario_movimentos").select("*").order("criado_em",{ascending:false}).limit(400),
      SB.from("colaboradores").select("id,nome,nucleo,ativo").order("nome"),SB.from("escritorio").select("dados").eq("id","inventario").maybeSingle(),
      SB.from("tarefas").select("id,titulo,status,prazo,responsavel_id").like("titulo","Revisão do inventário — %").in("status",["aberta","em_andamento"]).order("created_at",{ascending:false}).limit(1).maybeSingle()]);
    if(it.error)throw it.error;I.itens=it.data||[];I.movs=mv.data||[];I.colab=co.data||[];I.cfg=cf.data?.dados||{revisao_frequencia:"trimestral"};I.revisao=rv.data||null;
    if(I.revisao){const ciclo=I.revisao.titulo.replace("Revisão do inventário — ","");const r=await SB.from("inventario_revisoes").select("*").eq("ciclo",ciclo);I.revItens=r.data||[]}else I.revItens=[];
    I.ok=true}
  catch(e){console.warn("inventario",e);toast("Não foi possível carregar o inventário")}finally{I.carregando=false}
  if(S.tab==="inventario")render();
}
const garantir=()=>{if(!I.ok&&!I.carregando)carregar();return I.ok};
const recarregar=()=>{I.ok=false;carregar()};
const nomeColab=id=>I.colab.find(c=>c.id===id)?.nome||"—";
const selColab=(v,vazio="— ninguém (disponível) —")=>sel({"":vazio,...Object.fromEntries(I.colab.filter(c=>c.ativo!==false||c.id===v).map(c=>[c.id,c.nome]))},v||"");
function proximoPatrimonio(){const ns=I.itens.map(i=>+(/(\d+)$/.exec(i.patrimonio||"")||[])[1]||0);return "NP-"+String((Math.max(0,...ns)+1)).padStart(3,"0")}
function openItem(it={}){
  const pat=inp("text",it.patrimonio||proximoPatrimonio(),{placeholder:"NP-001"}),tipo=sel(TIPOS,it.tipo||"notebook"),marca=inp("text",it.marca||""),modelo=inp("text",it.modelo||""),serie=inp("text",it.numero_serie||""),
    sit=sel(Object.fromEntries(Object.entries(SIT).map(([k,v])=>[k,v[0]])),it.situacao||(it.responsavel_id?"em_uso":"disponivel")),resp=selColab(it.responsavel_id),dep=inp("text",it.departamento||"",{list:"inv-deps",placeholder:"Ex.: Jurídico"}),
    adq=inp("date",it.adquirido_em||""),val=inp("number",it.valor??"",{step:"0.01",min:"0"}),obs=el("textarea",{rows:2},it.observacoes||"");
  const dl=el("datalist",{id:"inv-deps"},DEPS.map(d=>el("option",{value:d})));
  const espHost=el("div",{class:"f full",style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"});const esp={};
  const montaEsp=()=>{espHost.replaceChildren();const campos=ESPEC[tipo.value]||[];if(!campos.length){espHost.append(el("div",{class:"note"},"Sem características específicas para este tipo."));return}
    for(const [k,l] of campos){const i=inp("text",(it.especificacoes||{})[k]||esp[k]?.value||"");esp[k]=i;espHost.append(el("div",{},el("label",{},l),i))}};
  tipo.onchange=montaEsp;montaEsp();
  resp.onchange=()=>{if(resp.value&&sit.value==="disponivel")sit.value="em_uso";if(!resp.value&&sit.value==="em_uso")sit.value="disponivel"};
  const body=el("div",{class:"form"},dl,field("in-pat","ID patrimonial",pat,"Único. Cole a etiqueta no equipamento."),field("in-tipo","Tipo",tipo),field("in-marca","Marca",marca),field("in-mod","Modelo",modelo),field("in-ser","Número de série",serie),
    field("in-sit","Situação",sit),field("in-resp","Responsável atual",resp),field("in-dep","Departamento",dep),field("in-adq","Adquirido em",adq),field("in-val","Valor (R$)",val),
    el("div",{class:"f full"},el("label",{},"Características técnicas"),espHost),field("in-obs","Observações",obs));
  const extra=it.id?el("button",{class:"btn",onclick:()=>{$("#modalHost").replaceChildren();historico(it)}},"Histórico"):null;
  modal(it.id?"Editar equipamento "+it.patrimonio:"Novo equipamento",body,async()=>{
    if(!pat.value.trim())throw new Error("Informe o ID patrimonial");
    const row={patrimonio:pat.value.trim().toUpperCase(),tipo:tipo.value,marca:marca.value.trim()||null,modelo:modelo.value.trim()||null,numero_serie:serie.value.trim()||null,situacao:sit.value,responsavel_id:resp.value||null,departamento:dep.value.trim()||null,
      adquirido_em:adq.value||null,valor:val.value===""?null:+val.value,especificacoes:Object.fromEntries(Object.entries(esp).filter(([k])=>(ESPEC[tipo.value]||[]).some(([kk])=>kk===k)).map(([k,i])=>[k,i.value.trim()]).filter(([,v])=>v)),observacoes:obs.value.trim()||null};
    const r=it.id?await SB.from("inventario_itens").update(row).eq("id",it.id):await SB.from("inventario_itens").insert(row);
    if(r.error)throw new Error(/patrimonio/.test(r.error.message)?"Já existe um equipamento com esse ID patrimonial":r.error.message);
    toast("Equipamento salvo");recarregar();
  },extra);
}
function atribuir(it){
  const resp=selColab(it.responsavel_id),dep=inp("text",it.departamento||"",{list:"inv-deps2"}),nota=inp("text","",{placeholder:"Ex.: entrega para home office; com carregador e mochila"});
  const body=el("div",{class:"form"},el("datalist",{id:"inv-deps2"},DEPS.map(d=>el("option",{value:d}))),el("div",{class:"f full note"},`${it.patrimonio} · ${TIPOS[it.tipo]||it.tipo} ${it.marca||""} ${it.modelo||""} · hoje com ${it.responsavel_nome||"ninguém"}`),
    field("ia-resp","Passar para",resp,"Deixe vazio para registrar devolução."),field("ia-dep","Departamento",dep),field("ia-nota","Observação",nota));
  modal(it.responsavel_id?"Transferir / devolver "+it.patrimonio:"Atribuir "+it.patrimonio,body,async()=>{
    const row={responsavel_id:resp.value||null,departamento:dep.value.trim()||null,situacao:resp.value?"em_uso":(it.situacao==="em_uso"?"disponivel":it.situacao)};
    const {error}=await SB.from("inventario_itens").update(row).eq("id",it.id);if(error)throw new Error(error.message);
    if(nota.value.trim()){await SB.from("inventario_movimentos").insert({item_id:it.id,tipo:"alteracao",nota:nota.value.trim(),autor_nome:PP.perfil?.nome}).catch(()=>{})}
    toast(resp.value?"Atribuído a "+nomeColab(resp.value):"Devolução registrada");recarregar();
  });
}
function historico(it){
  const ms=I.movs.filter(m=>m.item_id===it.id);
  const T={cadastro:"Cadastrado",atribuicao:"Atribuído",devolucao:"Devolvido",transferencia:"Transferido",situacao:"Situação",alteracao:"Alteração",revisao:"Revisão"};
  const desc=m=>m.tipo==="atribuicao"?`para ${m.para_nome}`:m.tipo==="devolucao"?`de ${m.de_nome}`:m.tipo==="transferencia"?(m.de_nome||m.para_nome?`de ${m.de_nome||"—"} para ${m.para_nome||"—"}`:`de ${m.de_departamento||"—"} para ${m.para_departamento||"—"}`):m.tipo==="situacao"?`${(SIT[m.de_situacao]||[m.de_situacao])[0]} → ${(SIT[m.para_situacao]||[m.para_situacao])[0]}`:m.nota||"";
  const body=el("div",{},el("div",{class:"note",style:"margin-bottom:8px"},`${TIPOS[it.tipo]||it.tipo} ${it.marca||""} ${it.modelo||""} · ${(SIT[it.situacao]||[it.situacao])[0]} · ${it.responsavel_nome||"sem responsável"}${it.departamento?" · "+it.departamento:""}`),
    Object.keys(it.especificacoes||{}).length?el("div",{class:"note",style:"margin-bottom:8px"},Object.entries(it.especificacoes).map(([k,v])=>`${k}: ${v}`).join(" · ")):null,
    ms.length?el("ul",{class:"tl",style:"margin:0"},ms.map(m=>el("li",{},el("div",{class:"d"},fmtDT(m.criado_em)),el("div",{},el("b",{},T[m.tipo]||m.tipo)," ",desc(m),el("span",{class:"note"}," · "+(m.autor_nome||"—")))))):el("div",{class:"empty"},"Sem histórico."));
  modal("Histórico: "+it.patrimonio,body,async()=>{});$("#modalHost button.btn.primary")?.remove();
}
function configRevisao(){
  const freq=sel({mensal:"Mensal",trimestral:"Trimestral",semestral:"Semestral",anual:"Anual",nunca:"Desligada"},I.cfg.revisao_frequencia||"trimestral"),resp=selColab(I.cfg.responsavel_id,"— padrão do administrativo —");
  const body=el("div",{class:"form"},field("ir-f","Frequência da revisão",freq,"No 1º dia do ciclo o sistema abre a tarefa de revisão."),field("ir-r","Responsável pela revisão",resp));
  const extra=el("button",{class:"btn",onclick:async()=>{const {data,error}=await SB.rpc("inventario_gerar_revisao",{p_forcar:true});if(error){toast("Não foi possível abrir");return}$("#modalHost").replaceChildren();toast("Revisão aberta: tarefa criada");recarregar()}},"Abrir uma revisão agora");
  modal("Revisão periódica do inventário",body,async()=>{const {error}=await SB.from("escritorio").update({dados:{...I.cfg,revisao_frequencia:freq.value,responsavel_id:resp.value||null}}).eq("id","inventario");if(error)throw new Error(error.message);toast("Configuração salva");recarregar()},extra);
}
function renderRevisao(v){
  if(!I.revisao){v.append(el("div",{class:"card empty"},"Nenhuma revisão em andamento. Abra uma em \"Revisão periódica\" ou aguarde o próximo ciclo."));return}
  const ativos=I.itens.filter(i=>i.ativo&&i.situacao!=="baixado");const feitos=new Map(I.revItens.map(r=>[r.item_id,r]));
  const faltam=ativos.filter(i=>!feitos.has(i.id)).length,div=I.revItens.filter(r=>r.resultado!=="localizado").length;
  v.append(el("div",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},I.revisao.titulo),el("div",{class:"note"},`${ativos.length-faltam} de ${ativos.length} conferidos · ${div} divergência(s) · prazo ${I.revisao.prazo?fmtD(parseD(I.revisao.prazo)):"—"}`)),el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>window.PP_TAREFAS?.abrir(I.revisao.id)},"Abrir a tarefa")))));
  const marcar=async(it,res)=>{let pend="";if(res!=="localizado"){pend=window.prompt(res==="nao_localizado"?"Onde procurou / observação:":"Qual é a divergência? (responsável, dados, situação…)")||"";if(pend===null)return}
    const {error}=await SB.rpc("inventario_revisar",{p_tarefa:I.revisao.id,p_item:it.id,p_resultado:res,p_pendencia:pend||null});if(error){toast("Não foi possível registrar");return}recarregar()};
  v.append(el("div",{class:"card",style:"overflow:auto"},el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Patrimônio"),el("th",{},"Equipamento"),el("th",{},"Responsável / depto."),el("th",{},"Situação"),el("th",{},"Conferência"),el("th",{},"Pendência"))),
    el("tbody",{},ativos.map(it=>{const r=feitos.get(it.id);return el("tr",{style:r?(r.resultado==="localizado"?"opacity:.7":"background:color-mix(in srgb,var(--crit) 7%,transparent)"):""},
      el("td",{style:"font-weight:600"},it.patrimonio),el("td",{},`${TIPOS[it.tipo]||it.tipo} ${it.marca||""} ${it.modelo||""}`),el("td",{class:"note"},(it.responsavel_nome||"—")+(it.departamento?" · "+it.departamento:"")),el("td",{},el("span",{class:"pill "+(SIT[it.situacao]||["",""])[1]},(SIT[it.situacao]||[it.situacao])[0])),
      el("td",{},el("div",{style:"display:flex;gap:4px;flex-wrap:wrap"},el("button",{class:"btn sm"+(r?.resultado==="localizado"?" primary":""),onclick:()=>marcar(it,"localizado")},"✓ Localizado"),el("button",{class:"btn sm"+(r?.resultado==="divergente"?" primary":""),onclick:()=>marcar(it,"divergente")},"Divergente"),el("button",{class:"btn sm"+(r?.resultado==="nao_localizado"?" danger":""),onclick:()=>marcar(it,"nao_localizado")},"Não localizado"))),
      el("td",{class:"note"},r?.pendencia||(r?`por ${r.revisado_por_nome||"—"} em ${fmtDT(r.revisado_em)}`:"")))})))));
}
function renderInventario(){
  const v=$("#view-inventario");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Financeiro / Administrativo"),el("h1",{},"Inventário"),el("div",{class:"sub"},"Equipamentos e bens do escritório: quem está com o quê, histórico de cada item e revisão periódica.")),
    el("div",{class:"actions"},el("button",{class:"btn",onclick:configRevisao},"Revisão periódica"),el("button",{class:"btn primary",onclick:()=>openItem({})},"+ Equipamento"))));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const ativos=I.itens.filter(i=>i.ativo);
  const K=(l,val,h)=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num"},String(val)),el("div",{class:"h"},h));
  v.append(el("div",{class:"kpis"},K("Equipamentos",ativos.filter(i=>i.situacao!=="baixado").length,"ativos"),K("Em uso",ativos.filter(i=>i.situacao==="em_uso").length,"com responsável"),K("Disponíveis",ativos.filter(i=>i.situacao==="disponivel").length,"sem responsável"),K("Em manutenção",ativos.filter(i=>i.situacao==="manutencao").length,""),K("Revisão",I.revisao?"aberta":"—",I.revisao?`prazo ${I.revisao.prazo?fmtD(parseD(I.revisao.prazo)):"—"}`:"próximo ciclo: "+(I.cfg.revisao_frequencia||"trimestral"))));
  const tabs=el("div",{class:"tabs"},[["itens","Equipamentos"],["pessoas","Por pessoa"],["revisao","Revisão"],["movs","Histórico"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(I.aba===k),onclick:()=>{I.aba=k;render()}},l)));
  const q=inp("search",I.q,{placeholder:"Buscar por patrimônio, tipo, marca, modelo, série…"});q.oninput=()=>{I.q=q.value;render();q.focus();q.setSelectionRange(q.value.length,q.value.length)};
  const ft=sel({"":"Todos os tipos",...TIPOS},I.tipo);ft.onchange=()=>{I.tipo=ft.value;render()};
  const fr=selColab(I.resp,"Todos os responsáveis");fr.onchange=()=>{I.resp=fr.value;render()};
  const fd=sel({"":"Todos os departamentos",...Object.fromEntries([...new Set(ativos.map(i=>i.departamento).filter(Boolean))].sort().map(d=>[d,d]))},I.dep);fd.onchange=()=>{I.dep=fd.value;render()};
  const fs=sel({"":"Todas as situações",...Object.fromEntries(Object.entries(SIT).map(([k,v])=>[k,v[0]]))},I.sit);fs.onchange=()=>{I.sit=fs.value;render()};
  v.append(el("div",{class:"card section",style:"flex-direction:row;flex-wrap:wrap;gap:10px;align-items:center"},tabs,I.aba==="itens"?[q,ft,fr,fd,fs]:I.aba==="movs"?q:null));
  if(I.aba==="revisao"){renderRevisao(v);return}
  const norm=x=>String(x||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
  const filtro=i=>(!I.q||norm([i.patrimonio,i.tipo,TIPOS[i.tipo],i.marca,i.modelo,i.numero_serie,i.responsavel_nome,i.departamento].join(" ")).includes(norm(I.q)))&&(!I.tipo||i.tipo===I.tipo)&&(!I.resp||i.responsavel_id===I.resp)&&(!I.dep||i.departamento===I.dep)&&(!I.sit||i.situacao===I.sit);
  const linha=it=>el("tr",{},el("td",{style:"font-weight:600"},it.patrimonio),el("td",{},el("div",{},`${TIPOS[it.tipo]||it.tipo} ${it.marca||""} ${it.modelo||""}`),el("div",{class:"note"},[it.numero_serie?"S/N "+it.numero_serie:null,...Object.entries(it.especificacoes||{}).map(([k,v])=>v)].filter(Boolean).join(" · "))),
    el("td",{},it.responsavel_nome||el("span",{class:"note"},"—"),it.departamento?el("div",{class:"note"},it.departamento):null),el("td",{},el("span",{class:"pill "+(SIT[it.situacao]||["",""])[1]},(SIT[it.situacao]||[it.situacao])[0])),
    el("td",{class:"note"},it.ultima_revisao_em?`${it.ultima_revisao_resultado==="localizado"?"✓":"⚠"} ${fmtD(new Date(it.ultima_revisao_em))}`:"—"),
    el("td",{},el("div",{style:"display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"},el("button",{class:"btn sm primary",onclick:()=>atribuir(it)},it.responsavel_id?"Transferir":"Atribuir"),el("button",{class:"btn sm",onclick:()=>historico(it)},"Histórico"),el("button",{class:"btn sm",onclick:()=>openItem(it)},"Editar"))));
  if(I.aba==="itens"){
    const lista=ativos.filter(filtro);
    v.append(el("div",{class:"card",style:"overflow:auto"},lista.length?el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Patrimônio"),el("th",{},"Equipamento"),el("th",{},"Responsável"),el("th",{},"Situação"),el("th",{},"Última revisão"),el("th",{}))),el("tbody",{},lista.map(linha))):el("div",{class:"empty"},ativos.length?"Nenhum equipamento com esse filtro.":"Nenhum equipamento cadastrado. Comece pelo + Equipamento.")));
  }else if(I.aba==="pessoas"){
    const grupos=new Map();for(const it of ativos.filter(i=>i.situacao!=="baixado")){const k=it.responsavel_nome||"— sem responsável —";(grupos.get(k)||grupos.set(k,[]).get(k)).push(it)}
    for(const [nome,its] of [...grupos.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      v.append(el("div",{class:"card",style:"overflow:auto"},el("div",{class:"section-h",style:"padding:12px 16px 4px"},el("h2",{},nome),el("span",{class:"note"},`${its.length} item(ns)`)),el("table",{class:"tbl"},el("tbody",{},its.map(linha)))))}
    if(!grupos.size)v.append(el("div",{class:"card empty"},"Nenhum equipamento cadastrado."));
  }else{
    const T={cadastro:"Cadastrado",atribuicao:"Atribuído",devolucao:"Devolvido",transferencia:"Transferido",situacao:"Situação",alteracao:"Alteração",revisao:"Revisão"};
    const ms=I.movs.filter(m=>!I.q||norm([m.patrimonio,m.item_tipo,m.marca,m.modelo,m.de_nome,m.para_nome,m.nota].join(" ")).includes(norm(I.q)));
    v.append(el("div",{class:"card",style:"overflow:auto"},ms.length?el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Quando"),el("th",{},"Patrimônio"),el("th",{},"O quê"),el("th",{},"Detalhe"),el("th",{},"Quem"))),
      el("tbody",{},ms.map(m=>el("tr",{},el("td",{class:"note"},fmtDT(m.criado_em)),el("td",{style:"font-weight:600"},m.patrimonio),el("td",{},T[m.tipo]||m.tipo),el("td",{class:"note"},m.tipo==="atribuicao"?"para "+m.para_nome:m.tipo==="devolucao"?"de "+m.de_nome:m.tipo==="transferencia"?`${m.de_nome||m.de_departamento||"—"} → ${m.para_nome||m.para_departamento||"—"}`:m.tipo==="situacao"?`${(SIT[m.de_situacao]||[m.de_situacao])[0]} → ${(SIT[m.para_situacao]||[m.para_situacao])[0]}`:m.nota||""),el("td",{class:"note"},m.autor_nome||"—"))))):el("div",{class:"empty"},"Sem histórico.")));
  }
}
{const _r=render;render=function(){_r();const v=$("#view-inventario");if(!v)return;if(!podeFin()&&S.tab==="inventario")S.tab="clientes";v.hidden=S.tab!=="inventario";if(S.tab==="inventario")renderInventario()}}
window.PP_INVENTARIO={recarregar};
})();
