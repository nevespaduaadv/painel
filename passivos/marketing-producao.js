/* Marketing → Produção de conteúdo e Automações (pedido da sócia, 26/11).
   Produção: quadro kanban (Ideias · Planejamento · Em produção · Aguardando aprovação). Cada cartão tem descrição, etiquetas,
   datas, checklist, membros, anexos (envio de arquivo sempre disponível) e comentários. Na última coluna, “Enviar para a pauta”
   cria a pauta em public.pautas com status “em_aprovacao” — ela aparece no calendário da Pauta de conteúdo aguardando aprovação,
   onde as sócias comentam e aprovam. Arrastar move o cartão; “Mover para…” faz o mesmo pelo teclado.
   Supabase: mkt_producao, mkt_producao_comentarios (0122); anexos no bucket "anexos" (pasta marketing/producao). Só equipe.
   Automações: página reservada (as skills de marketing entram aqui depois). */
(()=>{
"use strict";
const P={lista:[],colab:[],ok:false,carregando:false,erro:null,semTabela:false,aberto:null,coment:[],painel:null,obra:null,arrastando:null,catalogo:[],sec:null,rascunho:"",add:null,listas:null,renomeando:null,novaLista:false,arrLista:null,ncom:new Map(),verArq:false,arq:null,etqEd:null,editDesc:false,editCom:null,rascDesc:null};
/* 26/11 (14h58): listas livres como no Trello — criar, renomear, reordenar e excluir. Só “Aguardando aprovação” é fixa e fica por último,
   porque é ela que libera o “Enviar para a pauta”. Sem a tabela mkt_listas (0125), valem as quatro listas de origem. */
const COLS_PADRAO=[["ideias","Ideias"],["planejamento","Planejamento"],["producao","Em produção"],["aprovacao","Aguardando aprovação"]];
let COLS=COLS_PADRAO.slice();let COL_R=Object.fromEntries(COLS);
function definirListas(rows){const l=(rows||[]).slice().sort((a,b)=>(a.chave==="aprovacao")-(b.chave==="aprovacao")||(a.ordem||0)-(b.ordem||0));P.listas=l.length?l:null;if(l.length&&!l.some(x=>x.chave==="aprovacao"))l.push({chave:"aprovacao",nome:"Aguardando aprovação",ordem:99999});COLS=l.length?l.map(x=>[x.chave,x.nome]):COLS_PADRAO.slice();COL_R=Object.fromEntries(COLS)}
const colDe=c=>COL_R[c.coluna]?c.coluna:COLS[0][0];
const CORES=[["verde","#2e7d4f"],["amarelo","#b8860b"],["laranja","#c2622d"],["vermelho","#a23b3b"],["roxo","#6a4fb3"],["azul","#2f6fb3"],["céu","#1f7f96"],["lima","#55801c"],["rosa","#b03f86"],["cinza","#5f6670"]];
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
    try{const l=await SB.from("mkt_listas").select("chave,nome,ordem").order("ordem");definirListas(l.error?[]:l.data)}catch(_){definirListas([])}
    try{const e=await SB.from("mkt_etiquetas").select("nome,cor").order("nome");P.catalogo=e.error?[]:(e.data||[])}catch(_){P.catalogo=[]}
    try{const q=await SB.from("mkt_producao_comentarios").select("card_id").eq("tipo","comentario");P.ncom=new Map();for(const r of q.data||[])P.ncom.set(r.card_id,(P.ncom.get(r.card_id)||0)+1)}catch(_){P.ncom=new Map()}
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
async function mover(c,coluna){if(ro()||colDe(c)===coluna)return;const ult=Math.max(0,...P.lista.filter(x=>colDe(x)===coluna).map(x=>x.ordem||0))+10;try{const de=COL_R[colDe(c)];await salvar(c.id,{coluna,ordem:ult});registrar(c.id,`moveu de ${de} para ${COL_R[coluna]}`);toast(COL_R[coluna]);render();if(P.aberto===c.id)abrirCartao(c.id,null,true)}catch(_){}}

/* ---------- novo cartão: direto na coluna, como no Trello (26/11, 14h39) ---------- */
async function criarCartao(coluna,titulo){
  const t=(titulo||"").trim();if(!t||ro())return null;
  const ult=Math.max(0,...P.lista.filter(x=>x.coluna===coluna).map(x=>x.ordem||0))+10;
  const {data,error}=await SB.from("mkt_producao").insert({titulo:t.slice(0,200),coluna,ordem:ult}).select("*").single();
  if(error){toast("Não foi possível criar o cartão");return null}
  P.lista.push(data);registrar(data.id,"adicionou este cartão a "+COL_R[data.coluna]);return data;
}
function abrirAdd(k){P.add=k;render();setTimeout(()=>{const i=document.querySelector(`.np-mp-col[data-col="${k}"] .np-mp-novo textarea`);if(i)i.focus()},0)}
function blocoAdd(k){
  if(ro())return null;
  if(P.add!==k)return el("button",{type:"button",class:"np-mp-addbtn",onclick:()=>abrirAdd(k)},"+ Adicionar um cartão");
  const ta=el("textarea",{rows:"2",placeholder:"Insira um título para o cartão…","aria-label":"Título do novo cartão em "+COL_R[k],maxlength:"200"});
  const criar=async()=>{const t=ta.value.trim();if(!t){ta.focus();return}ta.disabled=true;const c=await criarCartao(k,t);if(c)abrirAdd(k);else{ta.disabled=false;ta.focus()}};
  ta.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();criar()}else if(e.key==="Escape"){e.stopPropagation();P.add=null;render()}};
  return el("div",{class:"np-mp-novo"},ta,el("div",{class:"l"},NPUI.btn("Adicionar cartão",{variante:"pri",onclick:criar}),el("button",{type:"button",class:"np-mp-x","aria-label":"Cancelar",title:"Cancelar",onclick:()=>{P.add=null;render()}},"×")));
}

/* ---------- datas ---------- */
const LAPIS='<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>';
const MESES=["jan.","fev.","mar.","abr.","mai.","jun.","jul.","ago.","set.","out.","nov.","dez."];
const dCurta=iso=>{const [, m, d]=String(iso).slice(0,10).split("-");return `${+d} de ${MESES[+m-1]}`};
const hCurta=h=>h?String(h).slice(0,5):"";
const entregaEm=c=>c.data_entrega?new Date(`${String(c.data_entrega).slice(0,10)}T${hCurta(c.hora_entrega)||"23:59"}:00`):null;
function sitEntrega(c){const d=entregaEm(c);if(!d)return null;if(c.concluido_em)return ["Concluído","ok"];if(c.pauta_id)return null;const f=d-new Date();if(f<0)return ["Em atraso","late"];if(f<864e5)return ["Entregar em breve","att"];return null}
const atrasado=c=>sitEntrega(c)?.[0]==="Em atraso";

/* ---------- listas ---------- */
const livres=()=>(P.listas||[]).filter(x=>x.chave!=="aprovacao");
async function gravarOrdem(chaves){const ord=chaves.map((k,i)=>({k,o:(i+1)*10}));for(const {k,o} of ord){const x=P.listas.find(y=>y.chave===k);if(x&&x.ordem!==o){x.ordem=o;await SB.from("mkt_listas").update({ordem:o}).eq("chave",k).then(()=>{},()=>{})}}definirListas(P.listas);render()}
async function criarLista(nome){const chave="l"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);const ordem=Math.max(0,...livres().map(x=>x.ordem||0))+10;const {error}=await SB.from("mkt_listas").insert({chave,nome:nome.slice(0,60),ordem});if(error){toast("Não foi possível criar a lista");return}P.listas.push({chave,nome:nome.slice(0,60),ordem});definirListas(P.listas);P.novaLista=true;render()}
async function renomearLista(k,nome){const {error}=await SB.from("mkt_listas").update({nome:nome.slice(0,60)}).eq("chave",k);if(error){toast("Não foi possível renomear");render();return}const x=P.listas.find(y=>y.chave===k);if(x)x.nome=nome.slice(0,60);definirListas(P.listas);render()}
function moverLista(k,d){const ch=livres().map(x=>x.chave);const i=ch.indexOf(k),j=i+d;if(i<0||j<0||j>=ch.length)return;[ch[i],ch[j]]=[ch[j],ch[i]];gravarOrdem(ch)}
function posicionarLista(de,sobre){const ch=livres().map(x=>x.chave);const i=ch.indexOf(de),j=ch.indexOf(sobre);if(i<0||j<0)return;ch.splice(i,1);ch.splice(j,0,de);gravarOrdem(ch)}
function excluirLista(k,nome,qtd){
  if(qtd){NPUI.confirmar({titulo:"A lista tem cartões",texto:`“${nome}” tem ${qtd} ${qtd===1?"cartão":"cartões"}. Mova ou arquive os cartões antes de excluir a lista.`,rotuloSim:"Entendi",onSim:()=>{}});return}
  NPUI.confirmar({titulo:"Excluir lista?",texto:`“${nome}” sai do quadro. Cartões arquivados que eram dela voltam, se restaurados, para a primeira lista.`,rotuloSim:"Excluir",perigo:true,onSim:async()=>{const {error}=await SB.from("mkt_listas").delete().eq("chave",k);if(error){toast("Não foi possível excluir");return}P.listas=P.listas.filter(x=>x.chave!==k);definirListas(P.listas);render()}});
}

/* ---------- quadro ---------- */
function cartao(c){
  const feitos=(c.checklist||[]).filter(i=>i.ok).length,tot=(c.checklist||[]).length;const pa=c.pauta_id?P.pautas?.get(c.pauta_id):null;const sit=sitEntrega(c);const nc=P.ncom?.get(c.id)||0;
  const el0=el("li",{class:"np-mp-card"+(c.concluido_em?" ok":""),draggable:ro()?null:"true","data-id":c.id},bola(c),
    el("button",{type:"button",class:"np-mp-abrir",onclick:e=>abrirCartao(c.id,e.currentTarget)},
      (c.etiquetas||[]).length?el("span",{class:"np-mp-etqs"},...(c.etiquetas||[]).map(t=>el("i",{style:`background:${COR_R[t.cor]||"#8a8f98"}`,title:t.nome||t.cor},t.nome||""))):null,
      el("span",{class:"t"},c.titulo),
      el("span",{class:"m"},
        c.data_entrega?NPUI.marca(dCurta(c.data_entrega)+(c.hora_entrega?", "+hCurta(c.hora_entrega):""),sit?sit[1]:""):null,
        c.descricao?el("span",{class:"np-mp-ind",title:"Este cartão tem descrição","aria-label":"tem descrição"},"≡"):null,
        nc?el("span",{class:"np-mp-ind",title:nc===1?"1 comentário":nc+" comentários"},String(nc)+(nc===1?" comentário":" comentários")):null,
        tot?NPUI.marca(`${feitos}/${tot}`,feitos===tot?"ok":""):null,
        (c.anexos||[]).length?NPUI.marca(`${c.anexos.length} anexo${c.anexos.length===1?"":"s"}`):null,
        c.pauta_id?NPUI.marca("na pauta"+(pa?": "+(ST_PAUTA[pa.status]||pa.status):""),pa?.status==="aprovado"?"ok":"info"):null),
      (c.membros||[]).length?el("span",{class:"q"},...(c.membros||[]).slice(0,3).map(id=>NPUI.quem(nomeC(id)||"?"))):null));
  if(!ro()){el0.addEventListener("dragstart",e=>{P.arrastando=c.id;el0.classList.add("arr");try{e.dataTransfer.setData("text/plain",c.id);e.dataTransfer.effectAllowed="move"}catch(_){}});el0.addEventListener("dragend",()=>{P.arrastando=null;el0.classList.remove("arr");document.querySelectorAll(".np-mp-col.alvo").forEach(x=>x.classList.remove("alvo"))})}
  return el0;
}
/* cartões arquivados: restaurar ou excluir de vez */
async function carregarArq(){const {data}=await SB.from("mkt_producao").select("id,titulo,coluna,anexos,updated_at").eq("arquivado",true).order("updated_at",{ascending:false});P.arq=data||[];if(S.tab==="mkt-producao")render()}
/* 26/11 (23h20, sócia): excluir o cartão de vez, direto do cartão aberto (antes só dava para excluir depois de arquivar). Apaga os comentários
   (em cascata no banco) e os arquivos anexados; pede confirmação e não tem volta. Cartão que já foi para a pauta: a pauta continua, só o cartão sai. */
async function excluirCartao(c,depois){
  NPUI.confirmar({titulo:"Excluir cartão de vez?",texto:`“${c.titulo}” será apagado com os comentários e os arquivos anexados.`+(c.pauta_id?" O item que já está na pauta de conteúdo continua lá.":"")+" Não dá para desfazer. Para tirar do quadro sem apagar, use “Arquivar cartão”.",rotuloSim:"Excluir",perigo:true,onSim:async()=>{
    const arqs=(c.anexos||[]).filter(x=>x.caminho_storage).map(x=>x.caminho_storage);if(arqs.length)await SB.storage.from("anexos").remove(arqs).then(()=>{},()=>{});
    const {error}=await SB.from("mkt_producao").delete().eq("id",c.id);if(error){toast("Não foi possível excluir");return}
    toast("Cartão excluído");depois?.()}});
}
function renderArquivados(v){
  v.append(NPUI.toolbar({resumo:el("h2",{class:"np-mp-h2"},"Cartões arquivados"),direita:[NPUI.btn("Voltar ao quadro",{onclick:()=>{P.verArq=false;P.arq=null;render()}})]}));
  if(!P.arq){v.append(NPUI.carregando(4));carregarArq();return}
  if(!P.arq.length){v.append(NPUI.vazio({titulo:"Nenhum cartão arquivado",texto:"Os cartões arquivados pelo menu “Mais ações” aparecem aqui."}));return}
  v.append(el("ul",{class:"np-mp-arq"},...P.arq.map(a=>el("li",{},el("span",{class:"t"},a.titulo),el("span",{class:"c"},COL_R[a.coluna]||""),
    ro()?null:NPUI.btn("Restaurar",{onclick:async()=>{const {error}=await SB.from("mkt_producao").update({arquivado:false,updated_at:new Date().toISOString()}).eq("id",a.id);if(error){toast("Não foi possível restaurar");return}registrar(a.id,"restaurou este cartão");toast("Cartão de volta ao quadro");P.ok=false;P.arq=null;render()}}),
    ro()?null:NPUI.btn("Excluir",{variante:"ghost",onclick:()=>NPUI.confirmar({titulo:"Excluir cartão de vez?",texto:`“${a.titulo}” será apagado com os comentários e os arquivos anexados. Não dá para desfazer.`,rotuloSim:"Excluir",perigo:true,onSim:async()=>{const arqs=(a.anexos||[]).filter(x=>x.caminho_storage).map(x=>x.caminho_storage);if(arqs.length)await SB.storage.from("anexos").remove(arqs).then(()=>{},()=>{});const {error}=await SB.from("mkt_producao").delete().eq("id",a.id);if(error){toast("Não foi possível excluir");return}toast("Cartão excluído");P.arq=null;render()}})})))));
}
function renderProducao(){
  const v=$("#view-mkt-producao");v.replaceChildren();v.classList.add("np-v3","np-mp");
  if(!garantir()){v.append(NPUI.carregando(6));return}
  if(P.erro){v.append(P.semTabela?NPUI.vazio({titulo:"Produção de conteúdo ainda não ativada",texto:"Falta criar a estrutura no banco (migração 0122). Assim que ela for aplicada, o quadro aparece aqui."}):NPUI.faixaErro({texto:"Não foi possível carregar o quadro.",onAcao:()=>{P.ok=false;render()}}));return}
  if(P.verArq){renderArquivados(v);return}
  const n=k=>P.lista.filter(c=>colDe(c)===k).length;const atras=P.lista.filter(atrasado).length;const naPauta=P.lista.filter(c=>c.pauta_id).length;
  v.append(NPUI.toolbar({resumo:NPUI.resumo([{n:P.lista.length,label:P.lista.length===1?"cartão":"cartões"},{n:n("aprovacao"),label:"aguardando aprovação",tom:n("aprovacao")?"att":"zero"},atras?{n:atras,label:atras===1?"entrega atrasada":"entregas atrasadas",tom:"late"}:null,naPauta?{n:naPauta,label:"na pauta",tom:""}:null],{quadros:true}),
    direita:[NPUI.btn("Arquivados",{variante:"ghost",onclick:()=>{P.verArq=true;P.arq=null;render()}}),NPUI.btn("Ver a pauta",{variante:"ghost",onclick:()=>irPara("marketing")}),ro()?null:NPUI.btn("Novo cartão",{variante:"pri",icone:"mais",onclick:()=>abrirAdd("ideias")})]}));
  const obra=el("div",{class:"np-obra"});P.obra=obra;
  const quadro=el("div",{class:"np-mp-quadro"},...COLS.map(([k,l],idx)=>{const itens=P.lista.filter(c=>colDe(c)===k).sort((a,b)=>(a.ordem||0)-(b.ordem||0));const fixa=k==="aprovacao";const livre=!ro()&&!!P.listas;
    let cab;
    if(P.renomeando===k&&livre&&!fixa){const i=inp("text",l,{"aria-label":"Nome da lista",maxlength:"60",class:"np-mp-lnome"});let feito=false;const ok=()=>{if(feito)return;feito=true;const t=i.value.trim();P.renomeando=null;if(t&&t!==l)renomearLista(k,t);else render()};i.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();ok()}else if(e.key==="Escape"){e.stopPropagation();P.renomeando=null;render()}};i.onblur=ok;cab=i;setTimeout(()=>{i.focus();i.select()},0)}
    else cab=el("h2",{title:livre&&!fixa?"Arraste para reordenar":null},l);
    const menu=livre?NPUI.ib("pontos","Ações da lista "+l,e=>NPUI.pop(e.currentTarget,[fixa?null:{label:"Renomear lista",onclick:()=>{P.renomeando=k;render()}},fixa||idx===0?null:{label:"Mover para a esquerda",onclick:()=>moverLista(k,-1)},fixa||idx>=COLS.length-2?null:{label:"Mover para a direita",onclick:()=>moverLista(k,1)},fixa?{label:"Lista fixa: é ela que envia para a pauta",disabled:true}:{label:"Excluir lista",tom:"crit",onclick:()=>excluirLista(k,l,itens.length)}].filter(Boolean),{label:"Ações da lista",alinhar:"dir"})):null;if(menu){menu.setAttribute("aria-haspopup","menu");menu.setAttribute("aria-expanded","false")}
    const ch=el("div",{class:"np-mp-ch",draggable:livre&&!fixa&&P.renomeando!==k?"true":null},cab,el("span",{class:"n"},String(itens.length)),menu);
    if(livre&&!fixa){ch.addEventListener("dragstart",e=>{if(P.arrastando)return;P.arrLista=k;try{e.dataTransfer.setData("text/plain","lista:"+k);e.dataTransfer.effectAllowed="move"}catch(_){}});ch.addEventListener("dragend",()=>{P.arrLista=null;document.querySelectorAll(".np-mp-col.alvo").forEach(x=>x.classList.remove("alvo"))})}
    const col=el("section",{class:"np-mp-col","data-col":k,"aria-label":l},ch,
      el("ul",{class:"np-mp-lista"},...itens.map(cartao)),blocoAdd(k)||(itens.length?null:el("p",{class:"np-mp-vazio"},"Nenhum cartão aqui.")));
    if(!ro()){col.addEventListener("dragover",e=>{if(P.arrastando||(P.arrLista&&P.arrLista!==k&&!fixa)){e.preventDefault();col.classList.add("alvo")}});col.addEventListener("dragleave",e=>{if(!col.contains(e.relatedTarget))col.classList.remove("alvo")});col.addEventListener("drop",e=>{e.preventDefault();col.classList.remove("alvo");if(P.arrLista){const de=P.arrLista;P.arrLista=null;if(de!==k&&!fixa)posicionarLista(de,k)}else{const c=P.lista.find(x=>x.id===P.arrastando);if(c)mover(c,k)}})}
    return col}),
    !ro()&&P.listas?(P.novaLista?(()=>{const i=inp("text","",{placeholder:"Digite o nome da lista…","aria-label":"Nome da nova lista",maxlength:"60"});const ok=()=>{const t=i.value.trim();if(!t){i.focus();return}criarLista(t)};i.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();ok()}else if(e.key==="Escape"){e.stopPropagation();P.novaLista=false;render()}};setTimeout(()=>i.focus(),0);return el("section",{class:"np-mp-col nova","aria-label":"Nova lista"},i,el("div",{class:"l"},NPUI.btn("Adicionar lista",{variante:"pri",onclick:ok}),el("button",{type:"button",class:"np-mp-x","aria-label":"Cancelar",title:"Cancelar",onclick:()=>{P.novaLista=false;render()}},"×")))})():el("button",{type:"button",class:"np-mp-addlista",onclick:()=>{P.novaLista=true;render()}},"+ Adicionar outra lista")):null);
  obra.append(el("div",{class:"np-corpo"},quadro));v.append(obra);
  P.painel=NPUI.painel({obra,label:"Cartão de conteúdo",onClose:()=>{P.aberto=null}});
  if(P.aberto){if(P.lista.some(c=>c.id===P.aberto))abrirCartao(P.aberto,null,true);else P.aberto=null}
}

/* ---------- cartão aberto, no molde do Trello ---------- */
async function carregarComent(id){const {data}=await SB.from("mkt_producao_comentarios").select("*").eq("card_id",id).order("created_at",{ascending:false});P.coment=data||[];(P.ncom=P.ncom||new Map()).set(id,P.coment.filter(k=>k.tipo!=="atividade").length);if(P.aberto===id)abrirCartao(id,null,true)}
const meuNome=()=>meuColab()?.nome||PP.perfil?.nome||null;
const registrar=(id,texto)=>SB.from("mkt_producao_comentarios").insert({card_id:id,autor_id:PP.perfil?.id||null,autor_nome:meuNome(),texto,tipo:"atividade"}).then(()=>{if(P.aberto===id)carregarComent(id)},()=>{});
const quando=s=>new Date(s).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const chaveE=t=>(t.nome||"")+"|"+t.cor;
const catalogo=()=>{const m=new Map();for(const t of P.catalogo||[])m.set(chaveE(t),{nome:t.nome||"",cor:t.cor});for(const c of P.lista)for(const t of c.etiquetas||[])if(!m.has(chaveE(t)))m.set(chaveE(t),{nome:t.nome||"",cor:t.cor});return [...m.values()].sort((a,b)=>(a.nome||"￿").localeCompare(b.nome||"￿","pt-BR")||CORES.findIndex(x=>x[0]===a.cor)-CORES.findIndex(x=>x[0]===b.cor))};
async function concluir(c){if(ro())return;const feito=!c.concluido_em;try{await salvar(c.id,{concluido_em:feito?new Date().toISOString():null,concluido_por:feito?PP.perfil?.id||null:null});registrar(c.id,feito?"concluiu este cartão":"reabriu este cartão");toast(feito?"Cartão concluído":"Cartão reaberto");render()}catch(_){}}
function bola(c,grande){const ok=!!c.concluido_em;return el("button",{type:"button",class:"np-mp-bola"+(ok?" ok":"")+(grande?" g":""),role:"checkbox","aria-checked":String(ok),"aria-label":(ok?"Marcar como incompleto":"Marcar como concluído")+": "+c.titulo,title:ok?"Marcar como incompleto":"Marcar como concluído",disabled:ro()?"":null,onclick:e=>{e.stopPropagation();concluir(c)}})}
async function enviarArquivos(c,files){
  if(!files||!files.length)return;const novos=[];
  for(const f of files){if(f.size>25*1024*1024){toast(`${f.name}: acima de 25 MB`);continue}
    const limpo=f.name.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\w.\-]+/g,"_").slice(-80);const caminho=`marketing/producao/${c.id}/${Date.now()}-${limpo}`;
    const {error}=await SB.storage.from("anexos").upload(caminho,f,{contentType:f.type||undefined});if(error){toast("Falha ao enviar "+f.name);continue}
    novos.push({nome:f.name,caminho_storage:caminho,tamanho:f.size,tipo:f.type||null})}
  if(novos.length){try{P.sec=null;await salvar(c.id,{anexos:[...(c.anexos||[]),...novos]});registrar(c.id,"anexou "+novos.map(a=>a.nome).join(", "));toast(novos.length===1?"Arquivo anexado":`${novos.length} arquivos anexados`);render()}catch(_){}}
}
async function abrirAnexo(a){if(a.url){window.open(a.url,"_blank","noopener");return}const {data,error}=await SB.storage.from("anexos").createSignedUrl(a.caminho_storage,300);if(error||!data?.signedUrl){toast("Não foi possível abrir o anexo");return}window.open(data.signedUrl,"_blank","noopener")}
/* etiqueta do quadro: renomear/trocar a cor vale para todos os cartões; excluir tira de todos */
async function trocarEtiqueta(antiga,nova){
  const k=chaveE(antiga);const alvos=P.lista.filter(c=>(c.etiquetas||[]).some(x=>chaveE(x)===k));
  for(const c of alvos){const lst=[];for(const x of c.etiquetas||[]){if(chaveE(x)!==k)lst.push(x);else if(nova&&!lst.some(y=>chaveE(y)===chaveE(nova)))lst.push(nova)}await salvar(c.id,{etiquetas:lst}).catch(()=>{})}
  await SB.from("mkt_etiquetas").delete().eq("nome",antiga.nome||"").eq("cor",antiga.cor).then(()=>{},()=>{});P.catalogo=(P.catalogo||[]).filter(x=>chaveE(x)!==k);
  if(nova&&!(P.catalogo||[]).some(x=>chaveE(x)===chaveE(nova))){P.catalogo.push(nova);await SB.from("mkt_etiquetas").insert({nome:nova.nome||"",cor:nova.cor}).then(()=>{},()=>{})}
}
async function copiarCartao(c){
  const ult=Math.max(0,...P.lista.filter(x=>colDe(x)===colDe(c)).map(x=>x.ordem||0))+10;
  const {data,error}=await SB.from("mkt_producao").insert({titulo:(c.titulo+" (cópia)").slice(0,200),descricao:c.descricao||null,coluna:colDe(c),ordem:ult,etiquetas:c.etiquetas||[],checklist:(c.checklist||[]).map(i=>({...i,ok:false})),membros:c.membros||[],data_inicio:c.data_inicio||null,data_entrega:c.data_entrega||null,hora_entrega:c.hora_entrega||null}).select("*").single();
  if(error){toast("Não foi possível copiar");return}P.lista.push(data);registrar(data.id,`copiou este cartão de “${c.titulo}”`);toast("Cartão copiado");P.aberto=data.id;P.sec=null;render()}
function abrirCartao(id,origem,silencioso){
  const c=P.lista.find(x=>x.id===id);if(!c||!P.painel)return;const novoAberto=P.aberto!==id;P.aberto=id;if(novoAberto){P.coment=[];P.sec=null;P.rascunho="";P.editDesc=false;P.editCom=null;carregarComent(id)}
  const leit=ro();const pa=c.pauta_id?P.pautas?.get(c.pauta_id):null;const reabrir=()=>abrirCartao(id,null,true);const salvarE=(patch)=>salvar(c.id,patch).then(()=>render(),()=>{});
  const abre=k=>{P.sec=k;reabrir()};const alterna=k=>abre(P.sec===k?null:k);
  const tit=inp("text",c.titulo,{class:"np-mp-tit"+(c.concluido_em?" ok":""),"aria-label":"Título do cartão",disabled:leit?"":null});tit.onchange=()=>{const t=tit.value.trim();if(!t){tit.value=c.titulo;return}salvarE({titulo:t})};
  const file=el("input",{type:"file",multiple:"",hidden:"","aria-hidden":"true",tabindex:"-1"});file.onchange=()=>{enviarArquivos(c,[...file.files]);file.value=""};
  // barra: “Adicionar” lista tudo; ao lado ficam só os atalhos do que o cartão ainda não tem (igual ao Trello)
  const temE=(c.etiquetas||[]).length>0,temD=!!(c.data_inicio||c.data_entrega),temC=(c.checklist||[]).length>0,temM=(c.membros||[]).length>0;
  const bt=(k,rot)=>{const b=NPUI.btn(rot,{onclick:()=>alterna(k)});b.setAttribute("aria-expanded",String(P.sec===k));if(P.sec===k)b.classList.add("on");return b};
  const btAdd=NPUI.btn("Adicionar",{icone:"mais",onclick:e=>NPUI.pop(e.currentTarget,[{label:"Etiquetas",title:"Organize, categorize e priorize",onclick:()=>abre("etq")},{label:"Datas",title:"Data de início e data de entrega",onclick:()=>abre("datas")},{label:"Checklist",title:"Adicionar subtarefas",onclick:()=>abre("chk")},{label:"Membros",title:"Atribuir membros",onclick:()=>abre("mb")},{label:"Anexo",title:"Arquivos do computador ou links",onclick:()=>abre("anx")}],{label:"Adicionar ao cartão"})});btAdd.setAttribute("aria-haspopup","menu");btAdd.setAttribute("aria-expanded","false");
  const barra=leit?null:el("div",{class:"np-mp-barra",role:"toolbar","aria-label":"Adicionar ao cartão"},btAdd,temE?null:bt("etq","Etiquetas"),temD?null:bt("datas","Datas"),temC?null:bt("chk","Checklist"),temM?null:bt("mb","Membros"),bt("anx","Anexo"),file);
  const cabPop=(t,voltar)=>el("div",{class:"np-mp-poph"},voltar?el("button",{type:"button",class:"np-mp-x","aria-label":"Voltar",title:"Voltar",onclick:voltar},"‹"):null,el("h3",{},t),el("button",{type:"button",class:"np-mp-x","aria-label":"Fechar",title:"Fechar",onclick:()=>abre(null)},"×"));
  let quadro=null;
  if(!leit&&P.sec==="etq"){
    const tem=t=>(c.etiquetas||[]).some(x=>chaveE(x)===chaveE(t));
    const itens=catalogo().map((t,i)=>{const cb=el("input",{type:"checkbox",id:"mp-eq-"+i,checked:tem(t)?"":null,"aria-label":t.nome||"Etiqueta "+t.cor});cb.onchange=()=>salvarE({etiquetas:cb.checked?[...(c.etiquetas||[]),t]:(c.etiquetas||[]).filter(x=>chaveE(x)!==chaveE(t))});
      return el("li",{"data-b":(t.nome||"").toLowerCase()},cb,el("label",{for:"mp-eq-"+i,style:`background:${COR_R[t.cor]||"#8a8f98"}`,title:`Cor: ${t.cor}, título: ${t.nome||"nenhum"}`},t.nome||" "),NPUI.ib(LAPIS,"Editar etiqueta "+(t.nome||t.cor),()=>{P.etqEd={antiga:t,nome:t.nome||"",cor:t.cor};abre("etq-ed")}))});
    const busca=inp("search","",{placeholder:"Buscar etiquetas…","aria-label":"Buscar etiquetas"});const ul=el("ul",{class:"np-mp-eqs"},...itens);busca.oninput=()=>{const q=busca.value.trim().toLowerCase();for(const li of ul.children)li.hidden=!!q&&!li.dataset.b.includes(q)};
    quadro=el("div",{class:"np-mp-pop"},cabPop("Etiquetas"),itens.length?busca:null,itens.length?ul:el("p",{class:"np-mp-nota"},"Nenhuma etiqueta criada ainda."),NPUI.btn("Criar uma nova etiqueta",{onclick:()=>{P.etqEd={antiga:null,nome:"",cor:"verde"};abre("etq-ed")}}));
  }else if(!leit&&P.sec==="etq-ed"&&P.etqEd){
    const E=P.etqEd;const nome=inp("text",E.nome,{id:"mp-en","aria-label":"Título da etiqueta",maxlength:"40"});const prev=el("div",{class:"np-mp-prev",style:`background:${COR_R[E.cor]||"#8a8f98"}`},E.nome||" ");nome.oninput=()=>{E.nome=nome.value;prev.textContent=nome.value||" "};
    const cores=el("div",{class:"np-mp-cores",role:"radiogroup","aria-label":"Selecionar uma cor"},...CORES.map(([k,h])=>{const b=el("button",{type:"button",role:"radio","aria-checked":String(k===E.cor),"aria-label":k,title:k,style:`background:${h}`,onclick:()=>{E.cor=k;prev.style.background=h;cores.querySelectorAll("button").forEach(x=>x.setAttribute("aria-checked",String(x===b)))}});return b}));
    const gravar=async()=>{const nova={nome:E.nome.trim().slice(0,40),cor:E.cor};if(E.antiga){if(chaveE(E.antiga)!==chaveE(nova))await trocarEtiqueta(E.antiga,nova)}else{if(!catalogo().some(x=>chaveE(x)===chaveE(nova))){(P.catalogo=P.catalogo||[]).push(nova);SB.from("mkt_etiquetas").insert({nome:nova.nome,cor:nova.cor}).then(()=>{},()=>{})}if(!(c.etiquetas||[]).some(x=>chaveE(x)===chaveE(nova)))await salvar(c.id,{etiquetas:[...(c.etiquetas||[]),nova]}).catch(()=>{})}P.etqEd=null;P.sec="etq";render()};
    nome.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();gravar()}};
    quadro=el("div",{class:"np-mp-pop"},cabPop(E.antiga?"Editar etiqueta":"Criar etiqueta",()=>{P.etqEd=null;abre("etq")}),prev,el("label",{for:"mp-en",class:"np-mp-rot"},"Título"),nome,el("span",{class:"np-mp-rot"},"Selecionar uma cor"),cores,
      el("div",{class:"np-mp-acoes"},NPUI.btn(E.antiga?"Salvar":"Criar",{variante:"pri",onclick:gravar}),E.antiga?NPUI.btn("Excluir",{variante:"ghost",onclick:()=>NPUI.confirmar({titulo:"Excluir etiqueta?",texto:"Ela sai de todos os cartões do quadro. Não dá para desfazer.",rotuloSim:"Excluir",perigo:true,onSim:async()=>{await trocarEtiqueta(E.antiga,null);P.etqEd=null;P.sec="etq";render()}})}):null));
  }else if(!leit&&P.sec==="datas"){
    const dIni=inp("date",c.data_inicio||"",{id:"mp-di"}),dEnt=inp("date",c.data_entrega||"",{id:"mp-de"}),hEnt=inp("time",hCurta(c.hora_entrega),{id:"mp-he","aria-label":"Horário da entrega"});
    quadro=el("div",{class:"np-mp-pop"},cabPop("Datas"),el("p",{class:"np-mp-nota"},"Opcional. Preencha só quando o conteúdo tiver prazo."),el("div",{class:"np-mp-datas"},el("label",{for:"mp-di"},"Data de início",dIni),el("label",{for:"mp-de"},"Data de entrega",el("span",{class:"par"},dEnt,hEnt))),
      el("div",{class:"np-mp-acoes"},NPUI.btn("Salvar",{variante:"pri",onclick:()=>{P.sec=null;salvarE({data_inicio:dIni.value||null,data_entrega:dEnt.value||null,hora_entrega:dEnt.value&&hEnt.value?hEnt.value:null})}}),temD?NPUI.btn("Remover",{variante:"ghost",onclick:()=>{P.sec=null;salvarE({data_inicio:null,data_entrega:null,hora_entrega:null})}}):null));
  }else if(!leit&&P.sec==="mb"){
    quadro=el("div",{class:"np-mp-pop"},cabPop("Membros"),el("ul",{class:"np-mp-mbs"},...P.colab.map((k,i)=>{const cb=el("input",{type:"checkbox",id:"mp-mb-"+i,checked:(c.membros||[]).includes(k.id)?"":null});cb.onchange=()=>salvarE({membros:cb.checked?[...(c.membros||[]),k.id]:(c.membros||[]).filter(x=>x!==k.id)});return el("li",{},cb,el("label",{for:"mp-mb-"+i},k.nome))})));
  }else if(!leit&&P.sec==="anx"){
    const link=inp("url","",{id:"mp-al",placeholder:"Cole um link (https://…)"}),txt=inp("text","",{id:"mp-at",placeholder:"Texto a ser exibido (opcional)",maxlength:"80"});
    const inserir=()=>{const u=link.value.trim();if(!/^https?:\/\/\S+$/i.test(u)){toast("Cole um link começando com https://");link.focus();return}P.sec=null;const nome=txt.value.trim()||u.replace(/^https?:\/\//,"").slice(0,60);salvar(c.id,{anexos:[...(c.anexos||[]),{nome,url:u}]}).then(()=>{registrar(c.id,"anexou o link "+nome);render()},()=>{})};
    link.onkeydown=txt.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();inserir()}};
    quadro=el("div",{class:"np-mp-pop"},cabPop("Anexar"),el("b",{class:"np-mp-rot"},"Anexe um arquivo do seu computador"),el("p",{class:"np-mp-nota"},"Imagens, vídeos, PDFs e documentos, até 25 MB cada."),el("div",{},NPUI.btn("Escolher um arquivo",{onclick:()=>file.click()})),el("label",{for:"mp-al",class:"np-mp-rot"},"Ou cole um link"),link,el("label",{for:"mp-at",class:"np-mp-rot"},"Texto para exibição (opcional)"),txt,el("div",{class:"np-mp-acoes"},NPUI.btn("Inserir link",{variante:"pri",onclick:inserir})));
  }
  // linha de informações (só o que o cartão já tem): etiquetas, membros e data de entrega
  const sit=sitEntrega(c);const info=[];
  if(temE)info.push(el("div",{class:"np-mp-inf"},el("span",{class:"rot"},"Etiquetas"),el("div",{class:"v"},...(c.etiquetas||[]).map(t=>el("button",{type:"button",class:"np-mp-etq g",style:`background:${COR_R[t.cor]||"#8a8f98"}`,title:"Abrir etiquetas",disabled:leit?"":null,onclick:()=>abre("etq")},t.nome||" ")),leit?null:NPUI.ib("mais","Adicionar etiqueta",()=>abre("etq")))));
  if(temM)info.push(el("div",{class:"np-mp-inf"},el("span",{class:"rot"},"Membros"),el("div",{class:"v"},...(c.membros||[]).map(mid=>el("span",{class:"np-mp-mb",title:nomeC(mid)||""},NPUI.quem(nomeC(mid)||"?"))),leit?null:NPUI.ib("mais","Adicionar membro",()=>abre("mb")))));
  if(temD)info.push(el("div",{class:"np-mp-inf"},el("span",{class:"rot"},c.data_entrega?"Data de entrega":"Data de início"),el("div",{class:"v"},el("button",{type:"button",class:"np-mp-dt",disabled:leit?"":null,title:"Alterar datas",onclick:()=>abre("datas")},c.data_entrega?(c.data_inicio?dCurta(c.data_inicio)+" – ":"")+dCurta(c.data_entrega)+(c.hora_entrega?", "+hCurta(c.hora_entrega):""):dCurta(c.data_inicio)),sit?NPUI.marca(sit[0],sit[1]):null)));
  // descrição: leitura com “Editar”; edição com Salvar/Cancelar
  let secDesc;
  if(P.editDesc&&!leit){const ta=el("textarea",{class:"np-mp-desc",rows:"6",placeholder:"Adicione uma descrição mais detalhada…","aria-label":"Descrição"},P.rascDesc??c.descricao??"");ta.oninput=()=>{P.rascDesc=ta.value};
    secDesc=NPUI.secao("Descrição",ta,el("div",{class:"np-mp-acoes"},NPUI.btn("Salvar",{variante:"pri",onclick:()=>{const t=ta.value.trim()||null;P.editDesc=false;P.rascDesc=null;salvarE({descricao:t})}}),NPUI.btn("Cancelar",{variante:"ghost",onclick:()=>{P.editDesc=false;P.rascDesc=null;reabrir()}})));setTimeout(()=>{if(document.activeElement?.tagName!=="TEXTAREA"&&document.activeElement?.tagName!=="INPUT")ta.focus()},0)}
  else{const editar=()=>{P.editDesc=true;P.rascDesc=null;reabrir()};secDesc=NPUI.secao("Descrição",c.descricao?el("div",{class:"np-mp-desctx"},el("p",{},c.descricao),leit?null:NPUI.btn("Editar",{onclick:editar})):leit?el("p",{class:"np-mp-nota"},"Sem descrição."):el("button",{type:"button",class:"np-mp-descvazia",onclick:editar},"Adicione uma descrição mais detalhada…"))}
  const anexos=(c.anexos||[]).length?NPUI.secao(`Anexos (${c.anexos.length})`,el("div",{class:"np-mp-anexos"},...(c.anexos||[]).map((a,i)=>el("span",{class:"np-mp-anx"},el("button",{type:"button",class:"lnk",onclick:()=>abrirAnexo(a),title:(a.url?"Abrir o link ":"Abrir ")+a.nome},(a.url?"↗ ":"")+a.nome),leit?null:el("button",{type:"button",class:"np-mp-x","aria-label":"Remover "+a.nome,title:"Remover do cartão",onclick:()=>NPUI.confirmar({titulo:"Remover anexo?",texto:`“${a.nome}” sai deste cartão.`,rotuloSim:"Remover",perigo:true,onSim:async()=>{if(a.caminho_storage)await SB.storage.from("anexos").remove([a.caminho_storage]).then(()=>{},()=>{});await salvar(c.id,{anexos:(c.anexos||[]).filter((_,j)=>j!==i)});render()}})},"×"))))):null;
  let secChk=null;
  if(temC||P.sec==="chk"){
    const chk=el("ul",{class:"np-mp-chk"},...(c.checklist||[]).map((it,i)=>{const cb=el("input",{type:"checkbox",id:"mp-ck-"+i,checked:it.ok?"":null,disabled:leit?"":null});cb.onchange=()=>salvarE({checklist:(c.checklist||[]).map((x,j)=>j===i?{...x,ok:cb.checked}:x)});
      return el("li",{class:it.ok?"ok":""},cb,el("label",{for:"mp-ck-"+i},it.t),leit?null:el("button",{type:"button",class:"np-mp-x","aria-label":"Remover item",onclick:()=>salvarE({checklist:(c.checklist||[]).filter((_,j)=>j!==i)})},"×"))}));
    const novoIt=inp("text","",{placeholder:"Adicionar um item…","aria-label":"Novo item do checklist",class:"np-mp-novoit"});const addIt=()=>{const t=novoIt.value.trim();if(!t)return;P.sec="chk";salvarE({checklist:[...(c.checklist||[]),{t:t.slice(0,160),ok:false}]})};novoIt.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addIt()}};
    const feitos=(c.checklist||[]).filter(i=>i.ok).length,tot=(c.checklist||[]).length;
    secChk=NPUI.secao(`Checklist${tot?" ("+Math.round(feitos/tot*100)+"%)":""}`,tot?el("div",{class:"np-mp-prog",role:"progressbar","aria-valuemin":"0","aria-valuemax":String(tot),"aria-valuenow":String(feitos),"aria-label":"Itens concluídos"},el("i",{style:`width:${Math.round(feitos/tot*100)}%`})):null,chk,leit?null:el("div",{class:"np-mp-add"},novoIt,NPUI.btn("Adicionar",{onclick:addIt})));
  }
  const gestor=sel({"":"— definir —",...Object.fromEntries(P.colab.map(k=>[k.id,k.nome]))},c.gestor_id||"");gestor.setAttribute("aria-label","Responsável pela gestão");if(leit)gestor.disabled=true;gestor.onchange=()=>salvar(c.id,{gestor_id:gestor.value||null}).then(()=>toast("Responsável pela gestão salvo"),()=>{});
  // comentários e atividade
  const ta=el("textarea",{rows:"2",placeholder:"Escrever um comentário…","aria-label":"Novo comentário"},P.rascunho||"");const btCom=NPUI.btn("Salvar",{variante:"pri",onclick:()=>comentar()});btCom.disabled=!(P.rascunho||"").trim();ta.oninput=()=>{P.rascunho=ta.value;btCom.disabled=!ta.value.trim()};
  const comentar=async()=>{const t=ta.value.trim();if(!t)return;const {error}=await SB.from("mkt_producao_comentarios").insert({card_id:c.id,autor_id:PP.perfil?.id||null,autor_nome:meuNome(),texto:t});if(error){toast("Não foi possível comentar");return}P.rascunho="";await carregarComent(c.id);render()};
  ta.onkeydown=e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();comentar()}};
  const meuId=PP.perfil?.id;const admin=PP.perfil?.papel==="admin";
  const itemCom=k=>{
    if(k.tipo==="atividade")return el("li",{class:"atv"},el("p",{},el("b",{},k.autor_nome||"Equipe")," "+k.texto),el("span",{class:"q"},quando(k.created_at)));
    const meu=!leit&&k.autor_id&&k.autor_id===meuId;
    if(P.editCom===k.id&&meu){const e=el("textarea",{rows:"3","aria-label":"Editar comentário"},k.texto);return el("li",{},el("div",{class:"h"},el("b",{},k.autor_nome||"Equipe"),el("span",{},quando(k.created_at))),e,el("div",{class:"np-mp-acoes"},NPUI.btn("Salvar",{variante:"pri",onclick:async()=>{const t=e.value.trim();if(!t)return;const {error}=await SB.from("mkt_producao_comentarios").update({texto:t,editado_em:new Date().toISOString()}).eq("id",k.id);if(error){toast("Não foi possível salvar");return}P.editCom=null;carregarComent(c.id)}}),NPUI.btn("Cancelar",{variante:"ghost",onclick:()=>{P.editCom=null;reabrir()}})))}
    return el("li",{},el("div",{class:"h"},el("b",{},k.autor_nome||"Equipe"),el("span",{},quando(k.created_at)+(k.editado_em?" (editado)":""))),el("p",{class:"cx"},k.texto),
      (meu||(admin&&!leit))?el("div",{class:"np-mp-cl"},meu?el("button",{type:"button",class:"lnk",onclick:()=>{P.editCom=k.id;reabrir()}},"Editar"):null,meu?el("span",{"aria-hidden":"true"},"•"):null,el("button",{type:"button",class:"lnk",onclick:()=>NPUI.confirmar({titulo:"Excluir comentário?",texto:"O comentário é apagado do cartão.",rotuloSim:"Excluir",perigo:true,onSim:async()=>{const {error}=await SB.from("mkt_producao_comentarios").delete().eq("id",k.id);if(error){toast("Não foi possível excluir");return}await carregarComent(c.id);render()}})},"Excluir")):null)};
  const coments=el("ul",{class:"np-mp-com"},...(P.coment.length?P.coment.map(itemCom):[el("li",{class:"np-mp-vazio"},"Sem comentários ainda.")]));
  const pautaInfo=c.pauta_id?el("div",{class:"np-mp-pauta",role:"status"},NPUI.marca("na pauta",pa?.status==="aprovado"?"ok":"info"),el("span",{},pa?`Situação: ${ST_PAUTA[pa.status]||pa.status}${pa.data_prevista?" · previsto para "+dBR(pa.data_prevista):""}.`:"Enviado para a Pauta de conteúdo."),el("button",{type:"button",class:"lnk",onclick:()=>irPara("marketing")},"Abrir a pauta")):null;
  const corpo=el("div",{class:"np-mp-det"},
    el("div",{class:"np-mp-p"},pautaInfo,el("div",{class:"np-mp-cab"},bola(c,true),tit),barra,quadro,info.length?el("div",{class:"np-mp-infos"},...info):null,secDesc,anexos,secChk,NPUI.secao("Responsável pela gestão",gestor,el("p",{class:"np-mp-nota"},"Quem acompanha e aprova este conteúdo."))),
    el("aside",{class:"np-mp-l","aria-label":"Comentários e atividade"},el("h3",{},"Comentários e atividade"),leit?null:el("div",{class:"np-mp-add col"},ta,btCom),coments));
  const btnMover=leit?null:NPUI.btn("Mover para…",{onclick:e=>NPUI.pop(e.currentTarget,COLS.filter(([k])=>k!==colDe(c)).map(([k,l])=>({label:l,onclick:()=>mover(c,k)})),{label:"Mover para"})});if(btnMover){btnMover.setAttribute("aria-haspopup","menu");btnMover.setAttribute("aria-expanded","false")}
  const btnPauta=!leit&&colDe(c)==="aprovacao"&&!c.pauta_id?NPUI.btn("Enviar para a pauta",{variante:"pri",onclick:()=>enviarParaPauta(c)}):null;
  const mais=leit?null:NPUI.btn("Mais ações",{variante:"ghost",onclick:e=>NPUI.pop(e.currentTarget,[{label:"Copiar cartão",onclick:()=>copiarCartao(c)},{label:"Arquivar cartão",onclick:()=>NPUI.confirmar({titulo:"Arquivar cartão?",texto:"O cartão sai do quadro e fica em “Arquivados”, de onde pode ser restaurado.",rotuloSim:"Arquivar",onSim:async()=>{await salvar(c.id,{arquivado:true});registrar(c.id,"arquivou este cartão");P.lista=P.lista.filter(x=>x.id!==c.id);P.aberto=null;P.painel?.fechar?.();render()}})},
    {label:"Excluir cartão",perigo:true,onclick:()=>excluirCartao(c,()=>{P.lista=P.lista.filter(x=>x.id!==c.id);P.aberto=null;P.painel?.fechar?.();render()})}],{label:"Mais ações",alinhar:"dir"})});if(mais){mais.setAttribute("aria-haspopup","menu");mais.setAttribute("aria-expanded","false")}
  P.painel.abrir({id:c.id,trilha:"Marketing · Produção de conteúdo",titulo:COL_R[colDe(c)]||"Cartão",corpo,pe:[btnPauta,btnMover,mais].filter(Boolean),origem:silencioso?null:origem});
  const foco=P.sec==="chk"?".np-mp-novoit":P.sec==="etq-ed"?"#mp-en":null;if(foco){const i=corpo.querySelector(foco);if(i)setTimeout(()=>i.focus(),0)}
}

/* ---------- enviar para a pauta ---------- */
function enviarParaPauta(c){
  const fmt=sel(FORMATO,"carrossel"),canal=sel(CANAIS,"instagram"),data=inp("date",c.data_entrega||""),hora=inp("time",hCurta(c.hora_entrega)),gest=sel({"":"— escolher —",...Object.fromEntries(P.colab.map(k=>[k.id,k.nome]))},c.gestor_id||""),resp=sel({"":"— ninguém —",...Object.fromEntries(P.colab.map(k=>[k.id,k.nome]))},(c.membros||[])[0]||meuColab()?.id||"");
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
    registrar(c.id,"enviou para a Pauta de conteúdo");toast("Enviado para a pauta, aguardando aprovação");render()},null,{confirmar:"Enviar para a pauta"});
}

/* ---------- automações (página reservada) ---------- */
function renderAutomacoes(){
  const v=$("#view-mkt-automacoes");v.replaceChildren();v.classList.add("np-v3");
  v.append(el("div",{class:"np-ferr-h"},el("h1",{},"Automações de marketing"),el("p",{},"Espaço reservado para as automações do setor.")),
    NPUI.vazio({titulo:"Em preparação",texto:"As rotinas já desenvolvidas para o marketing (motor de conteúdo, carrosséis, radar de notícias) serão trazidas para cá. Por enquanto, a produção acontece no quadro de Produção de conteúdo e a aprovação na Pauta.",acao:"Abrir a Produção de conteúdo",onAcao:()=>irPara("mkt-producao")}));
}

const CSS=`
html.np-casca-v3 .np-mp-quadro{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:12px}html.np-casca-v3 .np-mp-quadro>.np-mp-col{flex:1 0 264px;max-width:340px}
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
html.np-casca-v3 .np-mp-card{display:flex;align-items:flex-start}html.np-casca-v3 .np-mp-card>.np-mp-abrir{flex:1;min-width:0;padding-left:6px}html.np-casca-v3 .np-mp-card>.np-mp-bola{margin:11px 0 0 10px}
html.np-casca-v3 .np-mp-card.ok .np-mp-abrir .t{text-decoration:line-through;color:var(--np-text-3)}
html.np-casca-v3 .np-mp-bola{appearance:none;flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--np-text-3);background:transparent;cursor:pointer;padding:0;position:relative;display:grid;place-items:center;color:#fff;font:700 11px/1 var(--np-ui)}
html.np-casca-v3 .np-mp-bola::before{content:"";position:absolute;inset:-13px}
html.np-casca-v3 .np-mp-bola.g{width:22px;height:22px;font-size:13px}
html.np-casca-v3 .np-mp-bola,html.np-casca-v3 .np-mp-etq button,html.np-casca-v3 .np-mp-fichas .np-mp-x,html.np-casca-v3 .np-mp-anx .np-mp-x{min-height:0!important;min-width:0!important}html.np-casca-v3 .np-mp-bola{height:18px!important}html.np-casca-v3 .np-mp-bola.g{height:22px!important}
html.np-casca-v3 .np-mp-etq button,html.np-casca-v3 .np-mp-fichas .np-mp-x,html.np-casca-v3 .np-mp-anx .np-mp-x{position:relative}html.np-casca-v3 .np-mp-etq button::before,html.np-casca-v3 .np-mp-fichas .np-mp-x::before,html.np-casca-v3 .np-mp-anx .np-mp-x::before{content:"";position:absolute;inset:-12px -8px}
html.np-casca-v3 .np-mp-bola:hover{border-color:var(--np-ok)}html.np-casca-v3 .np-mp-bola:focus-visible{outline:none;box-shadow:var(--np-focus)}
html.np-casca-v3 .np-mp-bola.ok{background:var(--np-ok);border-color:var(--np-ok)}html.np-casca-v3 .np-mp-bola.ok::after{content:"";width:28%;height:52%;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-12%) rotate(45deg)}
html.np-casca-v3 .np-mp-cab{display:flex;align-items:center;gap:10px}html.np-casca-v3 .np-mp-cab .np-mp-tit{margin:0}html.np-casca-v3 .np-mp-tit.ok{text-decoration:line-through;color:var(--np-text-3)}
html.np-casca-v3 .np-mp-barra{display:flex;gap:6px;flex-wrap:wrap}html.np-casca-v3 .np-mp-barra .np-btn{padding-inline:10px}html.np-casca-v3 .np-mp-barra .np-btn.on{background:var(--np-surface-2);border-color:var(--np-ink)}
html.np-casca-v3 .np-mp-pop{border:1px solid var(--np-line);border-radius:var(--np-r-lg);background:var(--np-surface);box-shadow:var(--np-sh-ctrl);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
html.np-casca-v3 .np-mp-pop h3,html.np-casca-v3 .np-mp-l h3{font:600 var(--np-fs-3)/1.3 var(--np-ui);margin:0;color:var(--np-text)}
html.np-casca-v3 .np-mp-eqs,html.np-casca-v3 .np-mp-mbs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto}
html.np-casca-v3 .np-mp-eqs li,html.np-casca-v3 .np-mp-mbs li{display:flex;align-items:center;gap:10px;min-height:32px}
html.np-casca-v3 .np-mp-eqs label{flex:1;color:#fff;font:600 var(--np-fs-1)/1.2 var(--np-ui);padding:8px 10px;border-radius:6px;cursor:pointer}html.np-casca-v3 .np-mp-mbs label{flex:1;cursor:pointer}
html.np-casca-v3 .np-mp-nova{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--np-line);padding-top:10px}html.np-casca-v3 .np-mp-nova .np-btn{align-self:flex-start}
html.np-casca-v3 .np-mp-nova input,html.np-casca-v3 .np-mp-pop input[type=date]{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:400 var(--np-fs-2)/1 var(--np-ui);padding:0 10px}
html.np-casca-v3 .np-mp-cores{display:flex;gap:8px;flex-wrap:wrap}html.np-casca-v3 .np-mp-cores button{appearance:none;width:36px;height:28px;border-radius:6px;border:2px solid transparent;cursor:pointer;padding:0}html.np-casca-v3 .np-mp-cores button[aria-checked=true]{border-color:var(--np-text);box-shadow:0 0 0 2px var(--np-surface) inset}
html.np-casca-v3 .np-mp-pop .np-mp-datas{flex-direction:row;gap:12px;flex-wrap:wrap}html.np-casca-v3 .np-mp-pop .np-mp-datas label{flex:1 1 160px}
html.np-casca-v3 .np-mp-fichas{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
html.np-casca-v3 .np-mp-det{grid-template-columns:minmax(0,1.6fr) minmax(250px,1fr)}
html.np-casca-v3 .np-mp-l{background:var(--np-surface-2);border:1px solid var(--np-line);border-radius:var(--np-r-lg);padding:12px 14px;align-self:start}
html.np-casca-v3 .np-mp-l textarea{background:var(--np-surface)}
html.np-casca-v3 .np-mp-com{max-height:46vh;overflow:auto}
html.np-casca-v3 .np-mp-com .cx{background:var(--np-surface);border:1px solid var(--np-line);border-radius:var(--np-r);padding:8px 10px;margin-top:4px}
html.np-casca-v3 .np-mp-com .atv p{margin:0;color:var(--np-text-2)}html.np-casca-v3 .np-mp-com .atv p b{color:var(--np-text)}html.np-casca-v3 .np-mp-com .atv .q{font-size:var(--np-fs-1);color:var(--np-text-3)}
html.np-casca-v3 .np-mp-ch[draggable=true]{cursor:grab}html.np-casca-v3 .np-mp-ch .np-ib{flex:none}
html.np-casca-v3 .np-mp-lnome,html.np-casca-v3 .np-mp-col.nova input{flex:1;min-width:0;width:100%;box-sizing:border-box;height:36px;border:1px solid var(--np-ink);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:600 var(--np-fs-3)/1 var(--np-ui);padding:0 10px}
html.np-casca-v3 .np-mp-col.nova{display:flex;flex-direction:column;gap:8px}html.np-casca-v3 .np-mp-col.nova .l{display:flex;gap:8px;align-items:center}html.np-casca-v3 .np-mp-col.nova .np-mp-x{font-size:20px;min-width:44px;min-height:44px}
html.np-casca-v3 .np-mp-addlista{appearance:none;flex:0 0 264px;text-align:left;border:1px dashed var(--np-line);border-radius:var(--np-r-lg);background:transparent;color:var(--np-text-2);font:500 var(--np-fs-2)/1.3 var(--np-ui);padding:12px 14px;min-height:44px;cursor:pointer}
html.np-casca-v3 .np-mp-addlista:hover{border-color:var(--np-ink);color:var(--np-text);background:var(--np-surface-2)}html.np-casca-v3 .np-mp-addlista:focus-visible{outline:none;box-shadow:var(--np-focus)}
html.np-casca-v3 .np-mp-addbtn{appearance:none;border:0;background:transparent;width:100%;text-align:left;cursor:pointer;color:var(--np-text-2);font:500 var(--np-fs-2)/1.3 var(--np-ui);padding:10px 8px;border-radius:var(--np-r);min-height:44px;margin-top:6px}
html.np-casca-v3 .np-mp-addbtn:hover{background:var(--np-surface);color:var(--np-text)}html.np-casca-v3 .np-mp-addbtn:focus-visible{outline:none;box-shadow:var(--np-focus)}
html.np-casca-v3 .np-mp-novo{display:flex;flex-direction:column;gap:8px;margin-top:8px}html.np-casca-v3 .np-mp-novo textarea{width:100%;box-sizing:border-box;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:400 var(--np-fs-3)/1.35 var(--np-ui);padding:10px 12px;resize:none;box-shadow:var(--np-sh-ctrl)}
html.np-casca-v3 .np-mp-novo .l{display:flex;gap:8px;align-items:center}html.np-casca-v3 .np-mp-novo .np-mp-x{font-size:20px;min-width:44px;min-height:44px}
html.np-casca-v3 .np-mp-lista{min-height:0}html.np-casca-v3 p.np-mp-vazio{margin:0}
html.np-casca-v3 .np-mp-ind{display:inline-flex;align-items:center;gap:4px;font:500 var(--np-fs-1)/1 var(--np-ui);color:var(--np-text-2)}
html.np-casca-v3 .np-mp-h2{font:600 var(--np-fs-5)/1.3 var(--np-ui);margin:0}
html.np-casca-v3 .np-mp-arq{list-style:none;margin:0;padding:0;border:1px solid var(--np-line);border-radius:var(--np-r-lg);background:var(--np-surface)}
html.np-casca-v3 .np-mp-arq li{display:flex;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid var(--np-line);flex-wrap:wrap}html.np-casca-v3 .np-mp-arq li:first-child{border-top:0}
html.np-casca-v3 .np-mp-arq .t{flex:1 1 220px;font-weight:500}html.np-casca-v3 .np-mp-arq .c{color:var(--np-text-3);font-size:var(--np-fs-1)}
html.np-casca-v3 .np-mp-poph{display:flex;align-items:center;gap:8px}html.np-casca-v3 .np-mp-poph h3{flex:1;text-align:center}html.np-casca-v3 .np-mp-poph .np-mp-x{font-size:20px;min-width:32px;min-height:32px}
html.np-casca-v3 .np-mp-pop input[type=search],html.np-casca-v3 .np-mp-pop input[type=text],html.np-casca-v3 .np-mp-pop input[type=url],html.np-casca-v3 .np-mp-pop input[type=time]{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:400 var(--np-fs-2)/1 var(--np-ui);padding:0 10px}
html.np-casca-v3 .np-mp-eqs label{min-height:16px}html.np-casca-v3 .np-mp-eqs .np-ib{flex:none}
html.np-casca-v3 .np-mp-prev{border-radius:6px;color:#fff;font:600 var(--np-fs-2)/1.2 var(--np-ui);padding:10px 12px;min-height:16px}
html.np-casca-v3 .np-mp-rot{font:600 var(--np-fs-1)/1.3 var(--np-ui);color:var(--np-text-2)}
html.np-casca-v3 .np-mp-acoes{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
html.np-casca-v3 .np-mp-datas .par{display:flex;gap:8px}html.np-casca-v3 .np-mp-datas .par input[type=time]{flex:0 0 110px}
html.np-casca-v3 .np-mp-infos{display:flex;gap:20px;flex-wrap:wrap}html.np-casca-v3 .np-mp-inf{display:flex;flex-direction:column;gap:6px;min-width:0}
html.np-casca-v3 .np-mp-inf .rot{font:600 var(--np-fs-1)/1.2 var(--np-ui);color:var(--np-text-2)}html.np-casca-v3 .np-mp-inf .v{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
html.np-casca-v3 button.np-mp-etq.g{appearance:none;border:0;cursor:pointer;border-radius:6px;padding:0 12px;min-width:44px;height:32px;font:600 var(--np-fs-1)/1 var(--np-ui);justify-content:center}html.np-casca-v3 button.np-mp-etq.g:focus-visible{outline:none;box-shadow:var(--np-focus)}
html.np-casca-v3 .np-mp-dt{appearance:none;border:1px solid var(--np-line);background:var(--np-surface-2);color:var(--np-text);font:500 var(--np-fs-2)/1 var(--np-ui);height:32px;padding:0 10px;border-radius:var(--np-r);cursor:pointer}html.np-casca-v3 .np-mp-dt:hover{border-color:var(--np-ink)}
html.np-casca-v3 .np-mp-desctx{display:flex;gap:10px;align-items:flex-start}html.np-casca-v3 .np-mp-desctx p{flex:1;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
html.np-casca-v3 .np-mp-descvazia{appearance:none;width:100%;text-align:left;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface-2);color:var(--np-text-3);font:400 var(--np-fs-2)/1.45 var(--np-ui);padding:10px 12px;min-height:56px;cursor:pointer}html.np-casca-v3 .np-mp-descvazia:hover{border-color:var(--np-ink);color:var(--np-text-2)}
html.np-casca-v3 .np-mp-prog{height:6px;border-radius:999px;background:var(--np-line);overflow:hidden;margin-bottom:8px}html.np-casca-v3 .np-mp-prog i{display:block;height:100%;background:var(--np-ok)}
html.np-casca-v3 .np-mp-com textarea{width:100%;box-sizing:border-box;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:400 var(--np-fs-2)/1.45 var(--np-ui);padding:8px 10px;margin:4px 0 6px}
html.np-casca-v3 .np-mp-p select{width:100%;max-width:320px;box-sizing:border-box;height:36px;border:1px solid var(--np-line);border-radius:var(--np-r);background:var(--np-surface);color:var(--np-text);font:400 var(--np-fs-2)/1 var(--np-ui);padding:0 8px}
html.np-casca-v3 .np-mp-cl{display:flex;gap:6px;align-items:center;font-size:var(--np-fs-1);color:var(--np-text-3);margin-top:2px}
@media (max-width:980px){html.np-casca-v3 .np-mp-det{grid-template-columns:minmax(0,1fr)}html.np-casca-v3 .np-mp-quadro>.np-mp-col{flex:0 0 min(80vw,300px)}}
`;
document.head.append(el("style",{},CSS));
window.PP_MKT_PRODUCAO={invalidar(){P.ok=false},estado:()=>({n:P.lista.length,erro:P.erro})};
{const _r=render;render=function(){_r();const eq=typeof equipe==="function"&&equipe();
  for(const [t,fn] of [["mkt-producao",renderProducao],["mkt-automacoes",renderAutomacoes]]){const v=$("#view-"+t);if(!v)continue;if(S.tab===t&&(!eq||(PP.temAcesso&&!PP.temAcesso(t))))S.tab="clientes";v.hidden=S.tab!==t;if(S.tab===t)fn()}}}
})();
