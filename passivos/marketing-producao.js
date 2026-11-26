/* Marketing → Produção de conteúdo e Automações (pedido da sócia, 26/11).
   Produção: quadro kanban (Ideias · Planejamento · Em produção · Aguardando aprovação). Cada cartão tem descrição, etiquetas,
   datas, checklist, membros, anexos (envio de arquivo sempre disponível) e comentários. Na última coluna, “Enviar para a pauta”
   cria a pauta em public.pautas com status “em_aprovacao” — ela aparece no calendário da Pauta de conteúdo aguardando aprovação,
   onde as sócias comentam e aprovam. Arrastar move o cartão; “Mover para…” faz o mesmo pelo teclado.
   Supabase: mkt_producao, mkt_producao_comentarios (0122); anexos no bucket "anexos" (pasta marketing/producao). Só equipe.
   Automações: página reservada (as skills de marketing entram aqui depois). */
(()=>{
"use strict";
const P={lista:[],colab:[],ok:false,carregando:false,erro:null,semTabela:false,aberto:null,coment:[],painel:null,obra:null,arrastando:null};
const COLS=[["ideias","Ideias"],["planejamento","Planejamento"],["producao","Em produção"],["aprovacao","Aguardando aprovação"]];
const COL_R=Object.fromEntries(COLS);
const CORES=[["verde","#2e7d4f"],["amarelo","#b8860b"],["laranja","#c2622d"],["vermelho","#a23b3b"],["roxo","#6a4fb3"],["azul","#2f6fb3"]];
const COR_R=Object.fromEntries(CORES);
const FORMATO={reels:"Reels",carrossel:"Carrossel",estatico:"Estático",story:"Story",artigo:"Artigo",email:"E-mail",video:"Vídeo",live:"Live",outro:"Outro"};
const CANAIS={instagram:"Instagram",linkedin:"LinkedIn",youtube:"YouTube",tiktok:"TikTok",blog:"Blog/site",whatsapp:"WhatsApp",email:"E-mail"};
const ST_PAUTA={ideia:"ideia",em_aprovacao:"aguardando aprovação",ajustar:"ajustar",aprovado:"aprovado para postar",em_producao:"em produção",agendado:"agendado",publicado:"publicado",cancelado:"cancelado"};
const ro=()=>{try{return readOnly()}catch(_){return false}};
const nomeC=id=>P.colab.find(c=>c.id===id)?.nome||null;
const meuColab=()=>P.colab.find(c=>c.perfil_id===PP.perfil?.id);
const dBR=s=>s?String(s).slice(0,10).split("-").reverse().join("/"):"";
const hojeISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};

async function carregar(){
  if(P.carregando)return;P.carregando=true;P.erro=null;
  try{
    const [c,k]=await Promise.all([SB.from("mkt_producao").select("*").eq("arquivado",false).order("ordem").order("created_at"),SB.from("colaboradores").select("id,perfil_id,nome,ativo").order("nome")]);
    if(c.error){P.semTabela=/mkt_producao|schema cache|does not exist|PGRST205/i.test(c.error.message||"");throw c.error}
    P.lista=c.data||[];P.colab=(k.data||[]).filter(x=>x.ativo!==false&&!/^(Distribui|Teste|Rob)/.test(x.nome||""));P.semTabela=false;
    // situação das pautas já enviadas (uma consulta só, pelos ids)
    const ids=[...new Set(P.lista.map(x=>x.pauta_id).filter(Boolean))];P.pautas=new Map();
    if(ids.length){const r=await SB.from("pautas").select("id,status,data_prevista").in("id",ids);for(const p of r.data||[])P.pautas.set(p.id,p)}
    P.ok=true}
  catch(e){P.erro=String(e?.message||e);P.ok=true;P.lista=[]}
  finally{P.carregando=false}
  if(S.tab==="mkt-producao")render();
}
const garantir=()=>{if(!P.ok&&!P.carregando)carregar();return P.ok};
async function salvar(id,patch){const {error}=await SB.from("mkt_producao").update({...patch,updated_at:new Date().toISOString()}).eq("id",id);if(error){toast("Não foi possível salvar");throw error}const c=P.lista.find(x=>x.id===id);if(c)Object.assign(c,patch)}
async function mover(c,coluna){if(ro()||c.coluna===coluna)return;const ult=Math.max(0,...P.lista.filter(x=>x.coluna===coluna).map(x=>x.ordem||0))+10;try{await salvar(c.id,{coluna,ordem:ult});toast(COL_R[coluna]);render();if(P.aberto===c.id)abrirCartao(c.id,null,true)}catch(_){}}

/* ---------- novo cartão ---------- */
function novoCartao(coluna){
  if(ro())return;const tit=inp("text","",{placeholder:"Ex.: Carrossel — 5 erros ao renegociar com o banco"}),desc=el("textarea",{rows:"4",placeholder:"Ideia, gancho, roteiro, referências…"}),col=sel(COL_R,coluna||"ideias"),ent=inp("date","");
  const body=el("div",{class:"form"},field("mp-tit","Título",tit),field("mp-col","Coluna",col),field("mp-ent","Data de entrega",ent),field("mp-desc","Descrição",desc));
  modal("Novo cartão de conteúdo",body,async()=>{if(!tit.value.trim())throw new Error("Informe o título");const meu=meuColab();
    const ult=Math.max(0,...P.lista.filter(x=>x.coluna===col.value).map(x=>x.ordem||0))+10;
    const {data,error}=await SB.from("mkt_producao").insert({titulo:tit.value.trim(),descricao:desc.value.trim()||null,coluna:col.value,data_entrega:ent.value||null,ordem:ult,membros:meu?[meu.id]:[]}).select("*").single();
    if(error)throw new Error(error.message);P.lista.push(data);toast("Cartão criado");render()},null,{confirmar:"Criar cartão"});
}

/* ---------- quadro ---------- */
function cartao(c){
  const feitos=(c.checklist||[]).filter(i=>i.ok).length,tot=(c.checklist||[]).length;const atras=c.data_entrega&&c.data_entrega<hojeISO()&&!c.pauta_id;const pa=c.pauta_id?P.pautas?.get(c.pauta_id):null;
  const el0=el("li",{class:"np-mp-card",draggable:ro()?null:"true","data-id":c.id},
    el("button",{type:"button",class:"np-mp-abrir",onclick:e=>abrirCartao(c.id,e.currentTarget)},
      (c.etiquetas||[]).length?el("span",{class:"np-mp-etqs"},...(c.etiquetas||[]).map(t=>el("i",{style:`background:${COR_R[t.cor]||"#8a8f98"}`,title:t.nome||t.cor},t.nome||""))):null,
      el("span",{class:"t"},c.titulo),
      el("span",{class:"m"},
        c.data_entrega?NPUI.marca("entrega "+dBR(c.data_entrega).slice(0,5),atras?"late":""):null,
        tot?NPUI.marca(`${feitos}/${tot}`,feitos===tot?"ok":""):null,
        (c.anexos||[]).length?NPUI.marca(`${c.anexos.length} anexo${c.anexos.length===1?"":"s"}`):null,
        c.pauta_id?NPUI.marca("na pauta"+(pa?": "+(ST_PAUTA[pa.status]||pa.status):""),pa?.status==="aprovado"?"ok":"info"):null),
      (c.membros||[]).length?el("span",{class:"q"},...(c.membros||[]).slice(0,3).map(id=>NPUI.quem(nomeC(id)||"?"))):null));
  if(!ro()){el0.addEventListener("dragstart",e=>{P.arrastando=c.id;el0.classList.add("arr");try{e.dataTransfer.setData("text/plain",c.id);e.dataTransfer.effectAllowed="move"}catch(_){}});el0.addEventListener("dragend",()=>{P.arrastando=null;el0.classList.remove("arr");document.querySelectorAll(".np-mp-col.alvo").forEach(x=>x.classList.remove("alvo"))})}
  return el0;
}
function renderProducao(){
  const v=$("#view-mkt-producao");v.replaceChildren();v.classList.add("np-v3","np-mp");
  if(!garantir()){v.append(NPUI.carregando(6));return}
  if(P.erro){v.append(P.semTabela?NPUI.vazio({titulo:"Produção de conteúdo ainda não ativada",texto:"Falta criar a estrutura no banco (migração 0122). Assim que ela for aplicada, o quadro aparece aqui."}):NPUI.faixaErro({texto:"Não foi possível carregar o quadro.",onAcao:()=>{P.ok=false;render()}}));return}
  const n=k=>P.lista.filter(c=>c.coluna===k).length;const atras=P.lista.filter(c=>c.data_entrega&&c.data_entrega<hojeISO()&&!c.pauta_id).length;const naPauta=P.lista.filter(c=>c.pauta_id).length;
  v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:P.lista.length,label:P.lista.length===1?"cartão":"cartões"},{n:n("producao"),label:"em produção"},{n:n("aprovacao"),label:"aguardando aprovação",tom:n("aprovacao")?"att":"zero"},atras?{n:atras,label:atras===1?"entrega atrasada":"entregas atrasadas",tom:"late"}:null,naPauta?{n:naPauta,label:"na pauta",tom:""}:null],{quadros:true}),
    direita:[NPUI.btn("Ver a pauta",{variante:"ghost",onclick:()=>irPara("marketing")}),ro()?null:NPUI.btn("Novo cartão",{variante:"pri",icone:"mais",onclick:()=>novoCartao("ideias")})]}));
  const obra=el("div",{class:"np-obra"});P.obra=obra;
  const quadro=el("div",{class:"np-mp-quadro"},...COLS.map(([k,l])=>{const itens=P.lista.filter(c=>c.coluna===k).sort((a,b)=>(a.ordem||0)-(b.ordem||0));
    const col=el("section",{class:"np-mp-col","data-col":k,"aria-label":l},
      el("div",{class:"np-mp-ch"},el("h2",{},l),el("span",{class:"n"},String(itens.length)),ro()?null:NPUI.ib("mais","Novo cartão em "+l,()=>novoCartao(k))),
      el("ul",{class:"np-mp-lista"},...(itens.length?itens.map(cartao):[el("li",{class:"np-mp-vazio"},k==="aprovacao"?"Nada aguardando aprovação.":"Nenhum cartão aqui.")])));
    if(!ro()){col.addEventListener("dragover",e=>{if(P.arrastando){e.preventDefault();col.classList.add("alvo")}});col.addEventListener("dragleave",e=>{if(!col.contains(e.relatedTarget))col.classList.remove("alvo")});col.addEventListener("drop",e=>{e.preventDefault();col.classList.remove("alvo");const c=P.lista.find(x=>x.id===P.arrastando);if(c)mover(c,k)})}
    return col}));
  obra.append(el("div",{class:"np-corpo"},quadro));v.append(obra);
  P.painel=NPUI.painel({obra,label:"Cartão de conteúdo",onClose:()=>{P.aberto=null}});
  if(P.aberto){if(P.lista.some(c=>c.id===P.aberto))abrirCartao(P.aberto,null,true);else P.aberto=null}
}

/* ---------- cartão aberto ---------- */
async function carregarComent(id){const {data}=await SB.from("mkt_producao_comentarios").select("*").eq("card_id",id).order("created_at");P.coment=data||[];if(P.aberto===id)abrirCartao(id,null,true)}
async function enviarArquivos(c,files){
  if(!files||!files.length)return;const novos=[];
  for(const f of files){if(f.size>25*1024*1024){toast(`${f.name}: acima de 25 MB`);continue}
    const limpo=f.name.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\w.\-]+/g,"_").slice(-80);const caminho=`marketing/producao/${c.id}/${Date.now()}-${limpo}`;
    const {error}=await SB.storage.from("anexos").upload(caminho,f,{contentType:f.type||undefined});if(error){toast("Falha ao enviar "+f.name);continue}
    novos.push({nome:f.name,caminho_storage:caminho,tamanho:f.size,tipo:f.type||null})}
  if(novos.length){try{await salvar(c.id,{anexos:[...(c.anexos||[]),...novos]});toast(novos.length===1?"Arquivo anexado":`${novos.length} arquivos anexados`);render()}catch(_){}}
}
async function abrirAnexo(a){const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);if(error||!data?.signedUrl){toast("Não foi possível abrir o anexo");return}window.open(data.signedUrl,"_blank","noopener")}
function abrirCartao(id,origem,silencioso){
  const c=P.lista.find(x=>x.id===id);if(!c||!P.painel)return;const novoAberto=P.aberto!==id;P.aberto=id;if(novoAberto){P.coment=[];carregarComent(id)}
  const leit=ro();const pa=c.pauta_id?P.pautas?.get(c.pauta_id):null;
  // título e descrição (salvam ao sair do campo)
  const tit=inp("text",c.titulo,{class:"np-mp-tit","aria-label":"Título do cartão",disabled:leit?"":null});tit.onchange=()=>{const t=tit.value.trim();if(!t){tit.value=c.titulo;return}salvar(c.id,{titulo:t}).then(()=>render(),()=>{})};
  const desc=el("textarea",{class:"np-mp-desc",rows:"5",placeholder:"Ideia, gancho, roteiro, referências…","aria-label":"Descrição",disabled:leit?"":null},c.descricao||"");desc.onchange=()=>{salvar(c.id,{descricao:desc.value.trim()||null}).then(()=>toast("Descrição salva"),()=>{})};
  // anexos — o envio fica sempre à vista, logo abaixo da descrição
  const file=el("input",{type:"file",multiple:"",hidden:"","aria-hidden":"true",tabindex:"-1"});file.onchange=()=>{enviarArquivos(c,[...file.files]);file.value=""};
  const btnArq=leit?null:NPUI.btn("Anexar arquivo",{icone:"mais",onclick:()=>file.click(),title:"Envie imagens, vídeos, PDFs e documentos (até 25 MB cada)"});
  const anexos=el("div",{class:"np-mp-anexos"},...(c.anexos||[]).map((a,i)=>el("span",{class:"np-mp-anx"},el("button",{type:"button",class:"lnk",onclick:()=>abrirAnexo(a),title:"Abrir "+a.nome},a.nome),leit?null:el("button",{type:"button",class:"np-mp-x","aria-label":"Remover "+a.nome,title:"Remover do cartão",onclick:()=>NPUI.confirmar({titulo:"Remover anexo?",texto:`“${a.nome}” sai deste cartão.`,rotuloSim:"Remover",perigo:true,onSim:async()=>{await SB.storage.from("anexos").remove([a.caminho_storage]).then(()=>{},()=>{});await salvar(c.id,{anexos:(c.anexos||[]).filter((_,j)=>j!==i)});render()}})},"×"))),btnArq,file);
  // etiquetas
  const etqs=el("div",{class:"np-mp-etqs g"},...(c.etiquetas||[]).map((t,i)=>el("span",{class:"np-mp-etq",style:`background:${COR_R[t.cor]||"#8a8f98"}`},t.nome||t.cor,leit?null:el("button",{type:"button","aria-label":"Remover etiqueta "+(t.nome||t.cor),onclick:()=>salvar(c.id,{etiquetas:(c.etiquetas||[]).filter((_,j)=>j!==i)}).then(()=>render(),()=>{})},"×"))),
    leit?null:NPUI.btn("Etiqueta",{variante:"ghost",icone:"mais",onclick:()=>{const nome=inp("text","",{placeholder:"Ex.: Reels, Urgente, Campanha de dezembro"}),cor=sel(Object.fromEntries(CORES.map(([k])=>[k,k.charAt(0).toUpperCase()+k.slice(1)])),"verde");
      modal("Nova etiqueta",el("div",{class:"form"},field("mp-en","Nome",nome),field("mp-ec","Cor",cor)),async()=>{if(!nome.value.trim())throw new Error("Informe o nome");await salvar(c.id,{etiquetas:[...(c.etiquetas||[]),{nome:nome.value.trim().slice(0,40),cor:cor.value}]});render()},null,{confirmar:"Adicionar"})}}));
  // datas
  const dIni=inp("date",c.data_inicio||"",{"aria-label":"Data de início",disabled:leit?"":null}),dEnt=inp("date",c.data_entrega||"",{"aria-label":"Data de entrega",disabled:leit?"":null});
  dIni.onchange=()=>salvar(c.id,{data_inicio:dIni.value||null}).then(()=>render(),()=>{});dEnt.onchange=()=>salvar(c.id,{data_entrega:dEnt.value||null}).then(()=>render(),()=>{});
  // membros e responsável pela gestão
  const membros=el("div",{class:"np-mp-membros"},...(c.membros||[]).map(mid=>el("span",{class:"np-mp-mb"},NPUI.quem(nomeC(mid)||"?"),leit?null:el("button",{type:"button",class:"np-mp-x","aria-label":"Remover "+(nomeC(mid)||"membro"),onclick:()=>salvar(c.id,{membros:(c.membros||[]).filter(x=>x!==mid)}).then(()=>render(),()=>{})},"×"))),
    leit?null:(()=>{const s=sel({"":"+ Adicionar membro",...Object.fromEntries(P.colab.filter(k=>!(c.membros||[]).includes(k.id)).map(k=>[k.id,k.nome]))},"");s.setAttribute("aria-label","Adicionar membro");s.onchange=()=>{if(s.value)salvar(c.id,{membros:[...(c.membros||[]),s.value]}).then(()=>render(),()=>{})};return s})());
  const gestor=sel({"":"— definir —",...Object.fromEntries(P.colab.map(k=>[k.id,k.nome]))},c.gestor_id||"");gestor.setAttribute("aria-label","Responsável pela gestão");if(leit)gestor.disabled=true;gestor.onchange=()=>salvar(c.id,{gestor_id:gestor.value||null}).then(()=>toast("Responsável pela gestão salvo"),()=>{});
  // checklist
  const chk=el("ul",{class:"np-mp-chk"},...(c.checklist||[]).map((it,i)=>{const cb=el("input",{type:"checkbox",id:"mp-ck-"+i,checked:it.ok?"":null,disabled:leit?"":null});cb.onchange=()=>salvar(c.id,{checklist:(c.checklist||[]).map((x,j)=>j===i?{...x,ok:cb.checked}:x)}).then(()=>render(),()=>{});
    return el("li",{class:it.ok?"ok":""},cb,el("label",{for:"mp-ck-"+i},it.t),leit?null:el("button",{type:"button",class:"np-mp-x","aria-label":"Remover item",onclick:()=>salvar(c.id,{checklist:(c.checklist||[]).filter((_,j)=>j!==i)}).then(()=>render(),()=>{})},"×"))}));
  const novoIt=inp("text","",{placeholder:"Novo item do checklist…","aria-label":"Novo item do checklist"});const addIt=()=>{const t=novoIt.value.trim();if(!t)return;salvar(c.id,{checklist:[...(c.checklist||[]),{t:t.slice(0,160),ok:false}]}).then(()=>render(),()=>{})};novoIt.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addIt()}};
  // comentários
  const ta=el("textarea",{rows:"2",placeholder:"Escreva um comentário…","aria-label":"Novo comentário"});
  const comentar=async()=>{const t=ta.value.trim();if(!t)return;const {error}=await SB.from("mkt_producao_comentarios").insert({card_id:c.id,autor_id:PP.perfil?.id||null,autor_nome:meuColab()?.nome||PP.perfil?.nome||null,texto:t});if(error){toast("Não foi possível comentar");return}ta.value="";carregarComent(c.id)};
  const coments=el("ul",{class:"np-mp-com"},...(P.coment.length?P.coment.map(k=>el("li",{},el("div",{class:"h"},el("b",{},k.autor_nome||"Equipe"),el("span",{},new Date(k.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}))),el("p",{},k.texto))):[el("li",{class:"np-mp-vazio"},"Sem comentários ainda.")]));
  const pautaInfo=c.pauta_id?el("div",{class:"np-mp-pauta",role:"status"},NPUI.marca("na pauta",pa?.status==="aprovado"?"ok":"info"),el("span",{},pa?`Situação: ${ST_PAUTA[pa.status]||pa.status}${pa.data_prevista?" · previsto para "+dBR(pa.data_prevista):""}.`:"Enviado para a Pauta de conteúdo."),el("button",{type:"button",class:"lnk",onclick:()=>irPara("marketing")},"Abrir a pauta")):null;
  const corpo=el("div",{class:"np-mp-det"},
    el("div",{class:"np-mp-p"},pautaInfo,tit,NPUI.secao("Descrição",desc),NPUI.secao(`Anexos${(c.anexos||[]).length?" ("+c.anexos.length+")":""}`,anexos),NPUI.secao(`Checklist${(c.checklist||[]).length?" ("+(c.checklist||[]).filter(i=>i.ok).length+"/"+c.checklist.length+")":""}`,chk,leit?null:el("div",{class:"np-mp-add"},novoIt,NPUI.btn("Adicionar",{onclick:addIt}))),NPUI.secao("Comentários",coments,leit?null:el("div",{class:"np-mp-add col"},ta,NPUI.btn("Comentar",{onclick:comentar})))),
    el("aside",{class:"np-mp-l"},NPUI.secao("Coluna",el("div",{},NPUI.marca(COL_R[c.coluna]||c.coluna,c.coluna==="aprovacao"?"att":""))),NPUI.secao("Etiquetas",etqs),NPUI.secao("Datas",el("div",{class:"np-mp-datas"},el("label",{},"Início",dIni),el("label",{},"Entrega",dEnt))),NPUI.secao("Membros",membros),NPUI.secao("Responsável pela gestão",gestor,el("p",{class:"np-mp-nota"},"Quem acompanha e aprova este conteúdo."))));
  const btnMover=leit?null:NPUI.btn("Mover para…",{onclick:e=>NPUI.pop(e.currentTarget,COLS.filter(([k])=>k!==c.coluna).map(([k,l])=>({label:l,onclick:()=>mover(c,k)})),{label:"Mover para"})});if(btnMover){btnMover.setAttribute("aria-haspopup","menu");btnMover.setAttribute("aria-expanded","false")}
  const btnPauta=!leit&&c.coluna==="aprovacao"&&!c.pauta_id?NPUI.btn("Enviar para a pauta",{variante:"pri",onclick:()=>enviarParaPauta(c)}):null;
  const mais=leit?null:NPUI.btn("Mais ações",{variante:"ghost",onclick:e=>NPUI.pop(e.currentTarget,[{label:"Arquivar cartão",onclick:()=>NPUI.confirmar({titulo:"Arquivar cartão?",texto:"O cartão sai do quadro. Os anexos e comentários ficam guardados.",rotuloSim:"Arquivar",onSim:async()=>{await salvar(c.id,{arquivado:true});P.lista=P.lista.filter(x=>x.id!==c.id);P.aberto=null;P.painel?.fechar?.();render()}})}],{label:"Mais ações",alinhar:"dir"})});if(mais){mais.setAttribute("aria-haspopup","menu");mais.setAttribute("aria-expanded","false")}
  P.painel.abrir({id:c.id,trilha:"Marketing · Produção de conteúdo",titulo:c.titulo,corpo,pe:[btnPauta,btnMover,mais].filter(Boolean),origem:silencioso?null:origem});
}

/* ---------- enviar para a pauta ---------- */
function enviarParaPauta(c){
  const fmt=sel(FORMATO,"carrossel"),canal=sel(CANAIS,"instagram"),data=inp("date",c.data_entrega||""),hora=inp("time",""),gest=sel({"":"— escolher —",...Object.fromEntries(P.colab.map(k=>[k.id,k.nome]))},c.gestor_id||""),resp=sel({"":"— ninguém —",...Object.fromEntries(P.colab.map(k=>[k.id,k.nome]))},(c.membros||[])[0]||meuColab()?.id||"");
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("div",{class:"help"},"O conteúdo entra no calendário da Pauta de conteúdo com a situação “aguardando aprovação”. Lá, a gestão comenta e marca como “aprovado para postar”.")),
    field("mp-pf","Formato",fmt),field("mp-pc","Canal",canal),field("mp-pd","Data prevista de publicação",data),field("mp-ph","Horário (opcional)",hora),field("mp-pr","Responsável pelo conteúdo",resp),field("mp-pg","Responsável pela gestão",gest,"Quem vai aprovar."));
  modal("Enviar para a pauta",body,async()=>{
    if(!data.value)throw new Error("Informe a data prevista");if(!gest.value)throw new Error("Escolha o responsável pela gestão");
    const anx=(c.anexos||[]).length;const descr=[c.descricao||"",anx?`Anexos no cartão de produção: ${(c.anexos||[]).map(a=>a.nome).join(", ")}.`:""].filter(Boolean).join("\n\n")||null;
    const {data:nova,error}=await SB.from("pautas").insert({titulo:c.titulo,descricao:descr,formato:fmt.value,canais:[canal.value],data_prevista:data.value,hora_prevista:hora.value||null,responsavel_id:resp.value||null,status:"em_aprovacao"}).select("id,status,data_prevista").single();
    if(error)throw new Error("Não foi possível criar a pauta: "+error.message);
    await SB.from("pautas_comentarios").insert({pauta_id:nova.id,autor_id:PP.perfil?.id||null,tipo:"comentario",texto:`Enviado da Produção de conteúdo para aprovação. Responsável pela gestão: ${nomeC(gest.value)||"—"}.`}).then(()=>{},()=>{});
    await salvar(c.id,{pauta_id:nova.id,gestor_id:gest.value});(P.pautas=P.pautas||new Map()).set(nova.id,nova);
    try{window.PP_MARKETING?.invalidar?.()}catch(_){}
    toast("Enviado para a pauta, aguardando aprovação");render()},null,{confirmar:"Enviar para a pauta"});
}

/* ---------- automações (página reservada) ---------- */
function renderAutomacoes(){
  const v=$("#view-mkt-automacoes");v.replaceChildren();v.classList.add("np-v3");
  v.append(el("div",{class:"np-ferr-h"},el("h1",{},"Automações de marketing"),el("p",{},"Espaço reservado para as automações do setor.")),
    NPUI.vazio({titulo:"Em preparação",texto:"As rotinas já desenvolvidas para o marketing (motor de conteúdo, carrosséis, radar de notícias) serão trazidas para cá. Por enquanto, a produção acontece no quadro de Produção de conteúdo e a aprovação na Pauta.",acao:"Abrir a Produção de conteúdo",onAcao:()=>irPara("mkt-producao")}));
}

const CSS=`
html.np-casca-v3 .np-mp-quadro{display:grid;grid-template-columns:repeat(4,minmax(240px,1fr));gap:12px;align-items:start;overflow-x:auto;padding-bottom:8px}
html.np-casca-v3 .np-mp-col{background:var(--np-surface-2);border:1px solid var(--np-line);border-radius:var(--np-r-lg);padding:10px;min-width:0}
html.np-casca-v3 .np-mp-col.alvo{border-color:var(--np-ink);box-shadow:inset 0 0 0 1px var(--np-ink)}
html.np-casca-v3 .np-mp-ch{display:flex;align-items:center;gap:8px;margin:0 2px 8px}
html.np-casca-v3 .np-mp-ch h2{font:600 var(--np-fs-3)/1.3 var(--np-ui);margin:0;flex:1;color:var(--np-text)}
html.np-casca-v3 .np-mp-ch .n{font:500 var(--np-fs-1)/1 var(--np-ui);color:var(--np-text-3);font-variant-numeric:tabular-nums}
html.np-casca-v3 .np-mp-lista{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-height:44px}
html.np-casca-v3 .np-mp-card{background:var(--np-surface);border:1px solid var(--np-line);border-radius:var(--np-r);box-shadow:var(--np-sh-ctrl)}
html.np-casca-v3 .np-mp-card.arr{opacity:.5}
html.np-casca-v3 .np-mp-abrir{appearance:none;border:0;background:transparent;width:100%;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:6px;padding:10px 12px;color:var(--np-text);font:inherit;border-radius:var(--np-r);min-height:44px}
html.np-casca-v3 .np-mp-abrir:focus-visible{outline:none;box-shadow:var(--np-focus)}
html.np-casca-v3 .np-mp-abrir .t{font:500 var(--np-fs-3)/1.35 var(--np-ui)}
html.np-casca-v3 .np-mp-abrir .m,html.np-casca-v3 .np-mp-abrir .q{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
html.np-casca-v3 .np-mp-etqs{display:flex;gap:4px;flex-wrap:wrap}
html.np-casca-v3 .np-mp-etqs>i,html.np-casca-v3 .np-mp-etq{display:inline-flex;align-items:center;gap:4px;font:600 11px/1 var(--np-ui);color:#fff;padding:4px 8px;border-radius:999px;min-height:8px;min-width:28px}
html.np-casca-v3 .np-mp-etq button{appearance:none;border:0;background:transparent;color:#fff;cursor:pointer;font:inherit;padding:0 0 0 2px}
html.np-casca-v3 .np-mp-vazio{color:var(--np-text-3);font-size:var(--np-fs-1);padding:8px 4px;list-style:none}
html.np-casca-v3 .np-mp-det{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:20px}
html.np-casca-v3 .np-mp-p,html.np-casca-v3 .np-mp-l{display:flex;flex-direction:column;gap:16px;min-width:0}html.np-casca-v3 .np-mp-p>*,html.np-casca-v3 .np-mp-l>*{margin:0}
html.np-casca-v3 .np-mp-tit{width:100%;box-sizing:border-box;font:600 var(--np-fs-6)/1.3 var(--np-ui);border:1px solid transparent;border-radius:var(--np-r);padding:6px 8px;background:transparent;color:var(--np-text);margin:0 0 4px -8px}
html.np-casca-v3 .np-mp-tit:hover,html.np-casca-v3 .np-mp-tit:focus{border-color:var(--np-line);background:var(--np-surface-2);outline:none}
html.np-casca-v3 .np-mp-desc,html.np-casca-v3 .np-mp-add textarea,html.np-casca-v3 .np-mp-add input{width:100%;box-sizing:border-box;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface-2);color:var(--np-text);font:400 var(--np-fs-2)/1.45 var(--np-ui);padding:8px 10px}
html.np-casca-v3 .np-mp-desc{resize:vertical;min-height:110px}
html.np-casca-v3 .np-mp-anexos{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
html.np-casca-v3 .np-mp-anx,html.np-casca-v3 .np-mp-mb{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--np-line);border-radius:999px;background:var(--np-surface)}
html.np-casca-v3 .np-mp-x{appearance:none;border:0;background:transparent;color:var(--np-text-3);cursor:pointer;font:600 15px/1 var(--np-ui);padding:2px 4px;border-radius:4px}
html.np-casca-v3 .np-mp-x:hover{color:var(--np-crit)}
html.np-casca-v3 .np-mp-chk{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:6px}
html.np-casca-v3 .np-mp-chk li{display:flex;gap:8px;align-items:center}html.np-casca-v3 .np-mp-chk li.ok label{text-decoration:line-through;color:var(--np-text-3)}
html.np-casca-v3 .np-mp-chk label{flex:1}
html.np-casca-v3 .np-mp-add{display:flex;gap:8px;align-items:flex-start}html.np-casca-v3 .np-mp-add.col{flex-direction:column;align-items:stretch}html.np-casca-v3 .np-mp-add.col .np-btn{align-self:flex-end}
html.np-casca-v3 .np-mp-com{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:10px}
html.np-casca-v3 .np-mp-com .h{display:flex;gap:8px;align-items:baseline;font-size:var(--np-fs-1);color:var(--np-text-3)}html.np-casca-v3 .np-mp-com .h b{color:var(--np-text);font-size:var(--np-fs-2)}
html.np-casca-v3 .np-mp-com p{margin:2px 0 0;white-space:pre-wrap}
html.np-casca-v3 .np-mp-datas{display:flex;flex-direction:column;gap:8px}html.np-casca-v3 .np-mp-datas label{display:flex;flex-direction:column;gap:4px;font-size:var(--np-fs-1);color:var(--np-text-2)}
html.np-casca-v3 .np-mp-membros{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
html.np-casca-v3 .np-mp-l select,html.np-casca-v3 .np-mp-l input[type=date]{width:100%;box-sizing:border-box;height:34px;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:400 var(--np-fs-2)/1 var(--np-ui);padding:0 8px}
html.np-casca-v3 .np-mp-nota{margin:6px 0 0;font-size:var(--np-fs-1);color:var(--np-text-3)}
html.np-casca-v3 .np-mp-pauta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface-2);margin-bottom:10px}
@media (max-width:980px){html.np-casca-v3 .np-mp-det{grid-template-columns:minmax(0,1fr)}html.np-casca-v3 .np-mp-quadro{grid-template-columns:repeat(4,minmax(260px,80vw))}}
`;
document.head.append(el("style",{},CSS));
window.PP_MKT_PRODUCAO={invalidar(){P.ok=false},estado:()=>({n:P.lista.length,erro:P.erro})};
{const _r=render;render=function(){_r();const eq=typeof equipe==="function"&&equipe();
  for(const [t,fn] of [["mkt-producao",renderProducao],["mkt-automacoes",renderAutomacoes]]){const v=$("#view-"+t);if(!v)continue;if(S.tab===t&&(!eq||(PP.temAcesso&&!PP.temAcesso(t))))S.tab="clientes";v.hidden=S.tab!==t;if(S.tab===t)fn()}}}
})();
