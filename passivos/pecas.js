/* Peças por blocos — petição inicial revisional, embargos à execução e parecer ao cliente gerados em .docx a partir da revisão.
   Supabase: modelos_peca (seções com {{campos}} e {{BLOCOS:…}}), blocos_tese (fatos/fundamentos/pedidos/provas/parecer por tese),
   escritorio (qualificação), pecas_geradas (registro) — 0032. Tela Jurídico › Modelos de peças (admin edita).
   O .docx é montado no navegador com a biblioteca docx (CDN, carregada sob demanda). */
(()=>{
"use strict";
const DOCX_URL="https://cdn.jsdelivr.net/npm/docx@9.0.2/build/index.umd.js";
const JSZIP_URL="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const TIMBRADO_URL="modelos/papel-timbrado.docx";
const P={modelos:[],blocos:[],escritorio:null,ok:false,aba:"modelos",modelo:null,tese:null,peca:"inicial"};
const admin=()=>PP.perfil?.papel==="admin";
const brl=x=>x==null||!Number.isFinite(+x)?null:new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(+x);
const num=x=>{const v=parseFloat(String(x??"").replace(",","."));return Number.isFinite(v)?v:null};
const pct=(x,d=2)=>x==null||!Number.isFinite(+x)?null:(+x).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d})+"%";
const dBR=s=>s?String(s).slice(0,10).split("-").reverse().join("/"):null;
const hojeExtenso=()=>new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"});
const CAMPOS=[["cliente.nome","Razão social"],["cliente.cnpj","CNPJ"],["cliente.endereco","Endereço da sede"],["cliente.cidade","Cidade"],["cliente.uf","UF"],["cliente.porte","Porte (ME/EPP…)"],["cliente.representante","Representante legal"],["cliente.representante_cpf","CPF do representante"],["cliente.representante_qualificacao","Qualificação do representante"],
  ["banco","Credor"],["contrato.produto","Produto"],["contrato.data","Data da contratação"],["contrato.valor","Valor liberado"],["contrato.valor_financiado","Valor financiado"],["contrato.prazo","Prazo (meses)"],["contrato.parcela","Parcela"],["contrato.taxa_mensal","Taxa mensal"],["contrato.taxa_anual","Taxa anual"],["contrato.cet","CET anual"],["contrato.sistema","Sistema de amortização"],
  ["bacen.serie","Série SGS"],["bacen.nome","Nome da série"],["bacen.mes","Mês de referência"],["bacen.media_mensal","Média mensal"],["bacen.media_anual","Média anual"],["bacen.razao","Razão contratada ÷ média"],
  ["calc.juros_contratados","Juros totais contratados"],["calc.juros_media","Juros pela média"],["calc.dif_media","Diferença vs média"],["calc.dif_capitalizacao","Efeito da capitalização"],["calc.total_contratado","Total pago contratado"],["calc.total_media","Total pela média"],["calc.parcela_media","Parcela pela média"],["calc.duodecuplo","12× a taxa mensal"],["calc.equivalente","Taxa anual equivalente"],["calc.tir","Taxa implícita (TIR)"],["calc.tarifas_total","Tarifas totais"],["calc.repeticao","Repetição potencial"],["calc.iof_esperado","IOF esperado"],
  ["tarifas.tac","TAC"],["tarifas.tec","TEC"],["tarifas.cadastro","Tarifa de cadastro"],["tarifas.avaliacao","Tarifa de avaliação"],["tarifas.registro","Registro"],["tarifas.seguro","Seguro prestamista"],["tarifas.iof","IOF"],["mora.juros","Juros de mora"],["mora.multa","Multa"],
  ["escritorio.nome","Escritório"],["escritorio.cnpj","CNPJ do escritório"],["escritorio.endereco","Endereço do escritório"],["escritorio.cidade","Cidade do escritório"],["escritorio.uf","UF do escritório"],["advogado.nome","Advogado(a)"],["advogado.oab","OAB"],["hoje","Data de hoje"],["comarca","Comarca"],["valor_causa","Valor da causa"],["recomendacao","Recomendação (parecer)"],
  ["NOS","Parte do cliente (Autora / Embargante / Ré) — use com artigo: a {{NOS}}, da {{NOS}}"],["ELES","Parte do banco (Réu / Embargado / Autor) — o {{ELES}}, do {{ELES}}"],["calc.valor_expurgado","Valor financiado sem tarifas/seguro indevidos"],["BLOCOS:fatos","Blocos: fatos das teses"],["BLOCOS:fundamentos","Blocos: fundamentação por tese"],["BLOCOS:pedidos","Blocos: pedidos"],["BLOCOS:provas","Blocos: provas"],["BLOCOS:parecer","Blocos: parecer ao cliente"]];

async function carregar(force){
  if(P.ok&&!force)return;
  const [m,b,e]=await Promise.all([SB.from("modelos_peca").select("*").order("ordem"),SB.from("blocos_tese").select("*"),SB.from("escritorio").select("*").eq("id","escritorio").maybeSingle()]);
  P.modelos=m.data||[];P.blocos=b.data||[];P.escritorio=e.data?.dados||{};P.ok=true;
}
const carregarScript=(url,nome)=>window[nome]?Promise.resolve(window[nome]):new Promise((ok,err)=>{const s=document.createElement("script");s.src=url;s.onload=()=>ok(window[nome]);s.onerror=()=>err(new Error("Não foi possível carregar "+nome));document.head.append(s)});
const carregarDocx=()=>carregarScript(DOCX_URL,"docx");const carregarJSZip=()=>carregarScript(JSZIP_URL,"JSZip");

// ---------- contexto de campos ----------
function campos(ctx){
  const {k,c,ent:e,res:r,extra}=ctx;const esc=P.escritorio||{};const adv=(esc.advogados||[])[0]||{};
  const sist={price:"Tabela Price",sac:"SAC",rotativo:"rotativo"}[e.sistema]||e.sistema;
  const porte={me_epp:"microempresa / empresa de pequeno porte",medio:"empresa de médio porte",grande:"empresa de grande porte"}[e.porte]||"";
  const partes=ctx.partes||{NOS:"Autora",ELES:"Réu"};
  const expurgado=(num(e.valorFinanciado)||num(e.valor)||0)-(r.repeticaoPotencial||0)-((r.tarifas&&r.tarifas.outras)||0);
  const v={
    "NOS":partes.NOS,"ELES":partes.ELES,
    "calc.valor_expurgado":expurgado>0?brl(expurgado):null,
    "cliente.nome":c.nome,"cliente.cnpj":c.cnpj,"cliente.endereco":c.endereco,"cliente.cidade":c.cidade,"cliente.uf":c.uf,"cliente.porte":porte,"cliente.representante":c.representante,"cliente.representante_cpf":c.representante_cpf,"cliente.representante_qualificacao":c.representante_qualificacao,
    "banco":k.banco,"contrato.produto":(PRODUTOS[k.produto]||k.produto||"").toLowerCase(),"contrato.data":dBR(e.data),"contrato.valor":brl(e.valor),"contrato.valor_financiado":brl(e.valorFinanciado||e.valor),"contrato.prazo":e.prazo?String(e.prazo):null,"contrato.parcela":brl(e.parcela),"contrato.taxa_mensal":pct(e.taxaMensal),"contrato.taxa_anual":pct(e.taxaAnual),"contrato.cet":pct(e.cet),"contrato.sistema":sist,
    "bacen.serie":e.serie?String(e.serie):null,"bacen.nome":r.serieNome,"bacen.mes":r.mes?r.mes.slice(5,7)+"/"+r.mes.slice(0,4):null,"bacen.media_mensal":pct(r.media),"bacen.media_anual":pct(r.mediaAA),"bacen.razao":r.razao!=null?r.razao.toLocaleString("pt-BR",{maximumFractionDigits:2}):null,
    "calc.juros_contratados":brl(r.contratada?.juros),"calc.juros_media":brl(r.pelaMedia?.juros),"calc.dif_media":brl(r.difMedia),"calc.dif_capitalizacao":brl(r.difCapitalizacao),"calc.total_contratado":brl(r.contratada?.total),"calc.total_media":brl(r.pelaMedia?.total),"calc.parcela_media":brl(r.pelaMedia?.parcela),"calc.duodecuplo":pct(r.duodecuplo),"calc.equivalente":pct(r.equivalente),"calc.tir":pct(r.tir,3),"calc.tarifas_total":brl(r.tarifas?Object.values(r.tarifas).reduce((a,b)=>a+b,0):null),"calc.repeticao":brl(r.repeticaoPotencial),"calc.iof_esperado":brl(r.iofEsperado),
    "tarifas.tac":brl(r.tarifas?.tac),"tarifas.tec":brl(r.tarifas?.tec),"tarifas.cadastro":brl(r.tarifas?.cadastro),"tarifas.avaliacao":brl(r.tarifas?.avaliacao),"tarifas.registro":brl(r.tarifas?.registro),"tarifas.seguro":brl(r.tarifas?.seguro),"tarifas.iof":brl(r.tarifas?.iof),"mora.juros":pct(e.moraJuros),"mora.multa":pct(e.multa),
    "escritorio.nome":esc.nome,"escritorio.cnpj":esc.cnpj,"escritorio.endereco":esc.endereco,"escritorio.cidade":esc.cidade,"escritorio.uf":esc.uf,"advogado.nome":adv.nome,"advogado.oab":adv.oab,"hoje":hojeExtenso(),"comarca":extra.comarca,"valor_causa":extra.valorCausa,"recomendacao":extra.recomendacao};
  return v;
}
// substitui {{campo}}; campo vazio vira «campo» (destacado no .docx para o advogado preencher)
function preencher(texto,v){return String(texto||"").replace(/\{\{([\w.]+)\}\}/g,(m,k)=>{const x=v[k];return x==null||x===""?"«"+(CAMPOS.find(c=>c[0]===k)?.[1]||k)+"»":String(x)})}

// ---------- montagem: lista de parágrafos tipados ----------
// item: {tipo:"titulo"|"subtitulo"|"paragrafo"|"item"|"centro"|"assinatura", texto}
function montar(modelo,blocos,teses,v,secoesAtivas){
  const peca=modelo.tipo==="parecer"?"inicial":modelo.tipo;
  const numerar=!!modelo.numerar;let nSec=0;
  const sel=teses.map(t=>({t,b:blocos.find(x=>x.tese===t.codigo&&x.peca===peca)})).filter(x=>x.b);
  const out=[];
  const caixaAlta=s=>s.length>10&&(s.replace(/[^A-ZÁÉÍÓÚÂÊÔÃÕÇ]/g,"").length/Math.max(1,s.replace(/[^A-Za-zÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõç]/g,"").length))>0.85;
  const citacao=s=>s.length>120&&/^["“]?[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 ,\.\-–—/§ºª()'"“”:;]{30,}/.test(s.slice(0,48))||/^(Súmula|Enunciado|Tema|Art\.|Parágrafo único|ORIENTAÇÃO)\s/.test(s)||/^["“].{60,}["”]\s*(\(.*\))?$/.test(s)||/\((TJ|STJ|STF|REsp|AgInt|AgRg)[^)]*\)\s*$/.test(s);
  const paras=(txt,tipo="paragrafo")=>String(txt||"").split(/\n/).map(s=>s.trim()).filter(Boolean).forEach(s=>out.push({tipo:tipo!=="paragrafo"?tipo:/^[A-Z]\)\s/.test(s)&&s.length<120?"subtitulo":caixaAlta(s)?"destaque":citacao(s)?"citacao":"paragrafo",texto:s}));
  const romano=["I","II","III","IV","V","VI","VII","VIII","IX","X"];
  for(const sec of modelo.secoes||[]){
    if(sec.opcional&&secoesAtivas&&!secoesAtivas.has(sec.chave))continue;
    if(sec.titulo){const t=preencher(sec.titulo,v);const fixo=/^(ROL DE DOCUMENTOS|PARECER)/.test(t);out.push({tipo:"titulo",texto:numerar&&!fixo?`${++nSec}. ${t}`:t})}
    const texto=preencher(sec.texto,v);
    const partes=texto.split(/(\{\{BLOCOS:\w+\}\})/);
    let letra=0;
    for(const parte of partes){
      const m=/^\{\{BLOCOS:(\w+)\}\}$/.exec(parte);
      if(!m){
        if(sec.chave==="pedidos"){for(const l of parte.split(/\n/).map(s=>s.trim()).filter(Boolean)){if(/;$/.test(l))out.push({tipo:"item",texto:String.fromCharCode(97+letra++)+") "+l});else out.push({tipo:/^(Dá-se|Nestes termos)/.test(l)?"paragrafo":/^\{\{|^[A-ZÁÉÍÓÚ][^a-z]{3,}$/.test(l)?"centro":"paragrafo",texto:l})}}
        else if(sec.chave==="enderecamento"||sec.chave==="cabecalho")paras(parte,"centro");
        else paras(parte);
        continue;
      }
      const tipo=m[1];
      if(tipo==="fatos"){sel.forEach(x=>paras(preencher(x.b.fatos,v)))}
      else if(tipo==="fundamentos"){if(!sel.length)out.push({tipo:"paragrafo",texto:"«Nenhuma tese selecionada.»"});sel.forEach((x,i)=>{const t=preencher(x.b.titulo||x.t.nome,v);out.push({tipo:"subtitulo",texto:numerar?`${String.fromCharCode(65+i)}) ${t}`:t.toUpperCase()});paras(preencher(x.b.fundamentos,v))})}
      else if(tipo==="pedidos"){sel.forEach(x=>String(preencher(x.b.pedidos,v)).split(/\n/).map(s=>s.trim()).filter(Boolean).forEach(l=>out.push({tipo:"item",texto:String.fromCharCode(97+letra++)+") "+l.replace(/[.;]?$/,";")})))}
      else if(tipo==="provas"){let k=(texto.slice(0,texto.indexOf("{{BLOCOS:provas}}")).match(/^\d+\./gm)||[]).length;sel.forEach(x=>String(preencher(x.b.provas||"",v)).split(/\n/).map(s=>s.trim()).filter(Boolean).forEach(l=>out.push({tipo:"paragrafo",texto:`${++k}. ${l.replace(/;?$/,";")}`})))}
      else if(tipo==="parecer"){if(!sel.length)out.push({tipo:"paragrafo",texto:"Com os dados disponíveis, não identificamos irregularidade objetiva no contrato."});sel.forEach(x=>{out.push({tipo:"subtitulo",texto:preencher(x.b.titulo||x.t.nome,v)+(x.t.status==="indicio"?" (indício a confirmar)":"")});paras(preencher(x.b.parecer||x.b.fatos,v))})}
    }
  }
  // assinatura: últimas linhas com nome/OAB
  return out;
}

// ---------- .docx ----------
async function gerarDocx(itens,nomeArquivo){
  const D=await carregarDocx();
  const {Document,Packer,Paragraph,TextRun,AlignmentType}=D;
  const runs=t=>{const parts=String(t).split(/(«[^»]*»)/);return parts.filter(Boolean).map(p=>/^«.*»$/.test(p)?new TextRun({text:p,highlight:"yellow",font:"Times New Roman",size:24}):new TextRun({text:p,font:"Times New Roman",size:24}))};
  const par=(it)=>{
    if(it.tipo==="titulo")return new Paragraph({children:[new TextRun({text:it.texto,bold:true,font:"Times New Roman",size:24})],alignment:AlignmentType.LEFT,spacing:{before:360,after:200,line:360}});
    if(it.tipo==="subtitulo")return new Paragraph({children:[new TextRun({text:it.texto,bold:true,font:"Times New Roman",size:24})],alignment:AlignmentType.LEFT,spacing:{before:240,after:120,line:360}});
    if(it.tipo==="destaque")return new Paragraph({children:[new TextRun({text:it.texto,bold:true,font:"Times New Roman",size:24})],alignment:AlignmentType.CENTER,spacing:{before:240,after:240,line:360}});
    if(it.tipo==="centro")return new Paragraph({children:runs(it.texto),alignment:AlignmentType.CENTER,spacing:{after:200,line:360}});
    if(it.tipo==="citacao")return new Paragraph({children:runs(it.texto).map(r=>r),alignment:AlignmentType.JUSTIFIED,indent:{left:2268},spacing:{after:160,line:276},style:undefined});
    if(it.tipo==="item")return new Paragraph({children:runs(it.texto),alignment:AlignmentType.JUSTIFIED,indent:{left:720,hanging:360},spacing:{after:120,line:360}});
    return new Paragraph({children:runs(it.texto),alignment:AlignmentType.JUSTIFIED,indent:{firstLine:1134},spacing:{after:200,line:360}});
  };
  const doc=new Document({styles:{default:{document:{run:{font:"Times New Roman",size:24}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1701,bottom:1134,left:1701,right:1134}}},children:itens.map(par)}]});
  let blob=await Packer.toBlob(doc);
  try{blob=await aplicarTimbrado(blob)}catch(e){console.warn("timbrado",e);toast("Papel timbrado não aplicado: "+(e.message||e))}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=nomeArquivo;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}
// Monta o corpo gerado dentro do papel timbrado do escritório (cabeçalho/rodapé/margens do modelo).
async function aplicarTimbrado(blobGerado){
  const JSZip=await carregarJSZip();
  const [tz,gz]=await Promise.all([fetch(TIMBRADO_URL+"?v="+Date.now()).then(r=>{if(!r.ok)throw new Error("modelo de papel timbrado não encontrado");return r.arrayBuffer()}).then(b=>JSZip.loadAsync(b)),JSZip.loadAsync(blobGerado)]);
  const tdoc=await tz.file("word/document.xml").async("string"),gdoc=await gz.file("word/document.xml").async("string");
  const corpo=gdoc.match(/<w:body>([\s\S]*?)<w:sectPr[\s\S]*<\/w:body>/);const sect=tdoc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  if(!corpo||!sect)throw new Error("estrutura do .docx inesperada");
  const novo=tdoc.replace(/<w:body>[\s\S]*<\/w:body>/,"<w:body>"+corpo[1]+sect[0]+"</w:body>");
  tz.file("word/document.xml",novo);
  return tz.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}
const slug=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^\w]+/g,"-").replace(/^-|-$/g,"").toLowerCase();

// ---------- diálogo de geração (chamado pela Revisional) ----------
async function abrir(ctx){
  await carregar();
  const {k,ent,res,teses,rev}=ctx;
  const {data:cli}=await SB.from("clientes").select("*").eq("id",k.clienteId).maybeSingle();
  const c={...(S.clientes.find(x=>x.id===k.clienteId)||{}),...(cli||{})};
  const modelo=sel(Object.fromEntries(P.modelos.filter(m=>m.ativo).map(m=>[m.id,m.nome])),P.modelos[0]?.id||"");
  const secOpc=el("div",{class:"pc-teses"});const secChecks=new Map();
  const montarOpcionais=()=>{secOpc.replaceChildren();secChecks.clear();const m=P.modelos.find(x=>x.id===modelo.value);(m?.secoes||[]).filter(s=>s.opcional).forEach(s=>{const cb=inp("checkbox","",{});cb.checked=s.padrao!==false;secChecks.set(s.chave,cb);secOpc.append(el("label",{class:"pc-tese"},cb,el("span",{},s.titulo||s.chave)))});};
  const comarca=inp("text",c.cidade?`${c.cidade}/${c.uf||""}`.replace(/\/$/,""):"",{placeholder:"Comarca"});
  const vc=inp("text",res.difMedia>0?BRL(res.difMedia):"",{placeholder:"R$"});
  const reco=el("textarea",{rows:"3"},recomendacaoPadrao(teses));
  const lista=el("div",{class:"pc-teses"});
  const ST={constatada:["e3","Constatada"],indicio:["e2","Indício"],verificar:["g","Verificar"],nao_aplica:["e1","Não se aplica"]};
  const checks=teses.filter(t=>t.status!=="nao_aplica").map(t=>{const cb=inp("checkbox","",{});cb.checked=t.status==="constatada"||t.status==="indicio";const bloco=P.blocos.find(b=>b.tese===t.codigo);return {t,cb,row:el("label",{class:"pc-tese"},cb,el("span",{class:"pill "+ST[t.status][0]},ST[t.status][1]),el("span",{},t.nome),bloco?.rascunho?el("span",{class:"pill g",title:"Bloco ainda não revisado pelo escritório"},"rascunho"):null,!bloco?el("span",{class:"note"},"sem bloco"):null)}});
  checks.forEach(x=>lista.append(x.row));
  const campoVC=field("pc-vc","Valor da causa",vc),campoCom=field("pc-com","Comarca",comarca),campoReco=field("pc-reco","Recomendação ao cliente",reco);
  const descr=el("div",{class:"note"});
  const ajustar=()=>{const m=P.modelos.find(x=>x.id===modelo.value);const parecer=m?.tipo==="parecer";campoVC.hidden=parecer;campoCom.hidden=parecer;campoReco.hidden=!parecer;descr.textContent=m?.descricao||"";montarOpcionais()};modelo.onchange=ajustar;
  const body=el("div",{class:"form"},field("pc-mod","Tipo de peça",modelo),el("div",{class:"f full"},descr),campoCom,campoVC,campoReco,el("div",{class:"f full"},el("label",{},"Seções opcionais"),secOpc),el("div",{class:"f full"},el("label",{},"Teses incluídas na peça"),lista),
    el("div",{class:"f full note"},"Campos sem valor saem destacados em amarelo («assim») para preenchimento. Blocos marcados como rascunho ainda não foram revisados pelo escritório — ajuste em Jurídico › Modelos de peças."));
  ajustar();
  modal("Gerar peça (.docx)",body,async()=>{
    const m=P.modelos.find(x=>x.id===modelo.value);if(!m)throw new Error("Escolha o modelo");
    const escolhidas=checks.filter(x=>x.cb.checked).map(x=>x.t);
    const v=campos({k,c,ent,res,partes:m.partes,extra:{comarca:comarca.value.trim()||null,valorCausa:vc.value.trim()||null,recomendacao:reco.value.trim()||null}});
    const ativas=new Set([...secChecks.entries()].filter(([k,cb])=>cb.checked).map(([k])=>k));
    const itens=montar(m,P.blocos,escolhidas,v,ativas);
    const nome=`${slug({parecer:"parecer",embargos:"embargos-execucao",monitoria:"embargos-monitorios",contestacao:"contestacao",inicial:"inicial-revisional"}[m.tipo]||m.tipo)}-${slug(c.nome).slice(0,40)}-${slug(k.banco)}.docx`;
    await gerarDocx(itens,nome);
    SB.from("pecas_geradas").insert({revisao_id:rev?.id||null,cliente_id:k.clienteId,modelo_id:m.id,teses:escolhidas.map(t=>t.codigo),arquivo:nome}).then(()=>{});
    toast("Peça gerada: "+nome);
  });
  const btn=$("#modalHost .btn.primary");if(btn)btn.textContent="Gerar .docx";
}
function recomendacaoPadrao(teses){const c=teses.filter(t=>t.status==="constatada").length,i=teses.filter(t=>t.status==="indicio").length;
  if(c)return "Há elementos objetivos para a revisão do contrato. Recomendamos reunir os documentos listados abaixo para a quantificação por perícia contábil e, em paralelo, uma tentativa de renegociação com o credor já com os cálculos em mãos; não havendo acordo, o ajuizamento da ação revisional.";
  if(i)return "Há indícios de irregularidade que dependem da análise do contrato integral e dos extratos. Recomendamos reunir os documentos abaixo antes de qualquer medida judicial; com eles confirmamos (ou afastamos) os pontos levantados.";
  return "Com os dados disponíveis, não identificamos irregularidade objetiva no contrato. Recomendamos a conferência do contrato integral e dos extratos antes de qualquer conclusão; a estratégia, neste caso, tende a ser a negociação do passivo e não a revisão judicial.";}

// ---------- tela: Modelos de peças ----------
function renderPecas(){
  const v=$("#view-pecas");if(!v)return;v.replaceChildren();
  if(!P.ok){v.append(el("div",{class:"note"},"Carregando…"));carregar().then(()=>render());return}
  v.append(el("div",{class:"section-h"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Modelos de peças"),el("p",{class:"note"},"Modelos (estrutura da peça com campos automáticos) e blocos por tese (fatos, fundamentos, pedidos, provas e texto do parecer). A peça é gerada na tela Revisional com as teses marcadas."))));
  v.append(el("div",{class:"tabs",style:"margin:0 0 12px;justify-content:flex-start"},[["modelos","Modelos"],["blocos","Blocos por tese"],["escritorio","Escritório"],["campos","Campos disponíveis"]].map(([k,l])=>el("button",{class:"tab cm-niv","aria-selected":String(P.aba===k),onclick:()=>{P.aba=k;render()}},l))));
  if(P.aba==="modelos")renderModelos(v);else if(P.aba==="blocos")renderBlocos(v);else if(P.aba==="escritorio")renderEscritorio(v);else renderCampos(v);
}
function renderModelos(v){
  const m=P.modelos.find(x=>x.id===P.modelo)||P.modelos[0];if(!m){v.append(el("div",{class:"empty"},"Nenhum modelo cadastrado."));return}P.modelo=m.id;
  const sm=sel(Object.fromEntries(P.modelos.map(x=>[x.id,x.nome])),m.id);sm.onchange=()=>{P.modelo=sm.value;render()};
  v.append(el("div",{class:"ld-filtros"},sm,el("span",{class:"note"},m.descricao||"")));
  const sec=el("section",{class:"card section"});
  const secoes=structuredClone(m.secoes||[]);
  const lista=el("div",{class:"pc-secoes"});
  const desenhar=()=>{lista.replaceChildren();secoes.forEach((s,i)=>{const tit=inp("text",s.titulo,{placeholder:"Título da seção (vazio = sem título)"});const txt=el("textarea",{rows:String(Math.min(18,Math.max(4,(s.texto||"").split("\n").length+1)))},s.texto||"");tit.oninput=()=>s.titulo=tit.value;txt.oninput=()=>s.texto=txt.value;
    lista.append(el("div",{class:"pc-secao"},el("div",{class:"pc-secao-h"},el("span",{class:"note"},`#${i+1} · ${s.chave}`),el("div",{class:"actions"},admin()?el("button",{class:"btn sm",onclick:()=>{if(i>0){[secoes[i-1],secoes[i]]=[secoes[i],secoes[i-1]];desenhar()}}},"↑"):null,admin()?el("button",{class:"btn sm",onclick:()=>{if(i<secoes.length-1){[secoes[i+1],secoes[i]]=[secoes[i],secoes[i+1]];desenhar()}}},"↓"):null,admin()?el("button",{class:"btn sm danger",onclick:()=>{secoes.splice(i,1);desenhar()}},"Remover"):null)),tit,txt))})};
  desenhar();
  sec.append(lista);
  if(admin())sec.append(el("div",{class:"actions",style:"margin-top:10px"},el("button",{class:"btn sm",onclick:()=>{secoes.push({chave:"secao"+(secoes.length+1),titulo:"",texto:""});desenhar()}},"+ Seção"),el("button",{class:"btn primary",onclick:async()=>{const {error}=await SB.from("modelos_peca").update({secoes,updated_at:new Date().toISOString()}).eq("id",m.id);if(error){toast(error.message);return}m.secoes=secoes;toast("Modelo salvo")}},"Salvar modelo")));
  else sec.append(el("div",{class:"note"},"Somente administradores editam os modelos."));
  v.append(sec);
}
function renderBlocos(v){
  const teses=(window.PP_REVISIONAL?.teses?.()||[]);const lista=teses.length?teses:[...new Set(P.blocos.map(b=>b.tese))].map(c=>({codigo:c,nome:c}));
  const t=lista.find(x=>x.codigo===P.tese)||lista[0];if(!t){v.append(el("div",{class:"empty"},"Nenhuma tese."));return}P.tese=t.codigo;
  const st=sel(Object.fromEntries(lista.map(x=>[x.codigo,x.nome])),t.codigo);st.onchange=()=>{P.tese=st.value;render()};
  const sp=sel({inicial:"Petição inicial / parecer",embargos:"Embargos à execução",monitoria:"Embargos monitórios",contestacao:"Contestação (cobrança)"},P.peca);sp.onchange=()=>{P.peca=sp.value;render()};
  v.append(el("div",{class:"ld-filtros"},st,sp));
  const b=P.blocos.find(x=>x.tese===t.codigo&&x.peca===P.peca)||{tese:t.codigo,peca:P.peca,rascunho:true};
  const f=(k,rows)=>{const ta=el("textarea",{rows:String(rows)},b[k]||"");ta.oninput=()=>b[k]=ta.value;return ta};
  const tit=inp("text",b.titulo||"");tit.oninput=()=>b.titulo=tit.value;
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h3",{},t.nome),b.rascunho?el("span",{class:"pill g"},"rascunho — ainda não revisado"):el("span",{class:"pill e1"},"revisado pelo escritório")),
    el("div",{class:"form"},field("b-tit","Título do tópico na peça",tit),field("b-fatos","Fatos (parágrafos para “Dos fatos”)",f("fatos",5)),field("b-fund","Fundamentação jurídica",f("fundamentos",12)),field("b-ped","Pedidos (um por linha)",f("pedidos",3)),field("b-prov","Provas / documentos (um por linha)",f("provas",2)),field("b-par","Texto para o parecer ao cliente (linguagem simples)",f("parecer",4))));
  if(admin())sec.append(el("div",{class:"actions",style:"margin-top:10px"},el("button",{class:"btn primary",onclick:async()=>{const row={tese:b.tese,peca:b.peca,titulo:b.titulo||null,fatos:b.fatos||null,fundamentos:b.fundamentos||null,pedidos:b.pedidos||null,provas:b.provas||null,parecer:b.parecer||null,rascunho:false,updated_at:new Date().toISOString()};const {error}=await SB.from("blocos_tese").upsert(row);if(error){toast(error.message);return}await carregar(true);toast("Bloco salvo (marcado como revisado)");render()}},"Salvar bloco"),el("button",{class:"btn",onclick:async()=>{const outra=prompt("Copiar para qual peça? (inicial, embargos, monitoria, contestacao)",P.peca==="inicial"?"embargos":"inicial");if(!outra||!["inicial","embargos","monitoria","contestacao"].includes(outra))return;const row={tese:b.tese,peca:outra,titulo:b.titulo||null,fatos:b.fatos||null,fundamentos:b.fundamentos||null,pedidos:b.pedidos||null,provas:b.provas||null,parecer:b.parecer||null,rascunho:false,updated_at:new Date().toISOString()};const {error}=await SB.from("blocos_tese").upsert(row);if(error){toast(error.message);return}await carregar(true);toast("Copiado para "+outra)}},"Copiar para a outra peça")));
  v.append(sec);
}
function renderEscritorio(v){
  const e=structuredClone(P.escritorio||{});const adv=(e.advogados||[])[0]||{};
  const i=(k,val)=>{const x=inp("text",val||"");x.oninput=()=>e[k]=x.value;return x};
  const an=inp("text",adv.nome||""),ao=inp("text",adv.oab||"");
  const sec=el("section",{class:"card section"},el("h3",{},"Qualificação do escritório (usada nas peças)"),el("div",{class:"form"},field("e-nome","Razão social",i("nome",e.nome)),field("e-cnpj","CNPJ",i("cnpj",e.cnpj)),field("e-end","Endereço",i("endereco",e.endereco)),field("e-cid","Cidade",i("cidade",e.cidade)),field("e-uf","UF",i("uf",e.uf)),field("e-cep","CEP",i("cep",e.cep)),field("e-mail","E-mail",i("email",e.email)),field("e-adv","Advogado(a) signatário(a)",an),field("e-oab","OAB",ao)));
  if(admin())sec.append(el("div",{class:"actions",style:"margin-top:10px"},el("button",{class:"btn primary",onclick:async()=>{e.advogados=[{nome:an.value.trim(),oab:ao.value.trim()}];const {error}=await SB.from("escritorio").upsert({id:"escritorio",dados:e,updated_at:new Date().toISOString()});if(error){toast(error.message);return}P.escritorio=e;toast("Escritório salvo")}},"Salvar")));
  v.append(sec);
}
function renderCampos(v){
  v.append(el("section",{class:"card section"},el("h3",{},"Campos automáticos"),el("p",{class:"note"},"Use entre chaves duplas nos modelos e blocos, por exemplo {{cliente.nome}} ou {{bacen.media_mensal}}. Texto entre « » fica destacado em amarelo no .docx para preenchimento manual."),
    el("table",{class:"tbl"},el("thead",{},el("tr",{},el("th",{},"Campo"),el("th",{},"O que insere"))),el("tbody",{},CAMPOS.map(([k,l])=>el("tr",{},el("td",{},el("code",{},"{{"+k+"}}")),el("td",{},l)))))));
}

// ---------- integração ----------
{const _r=render;render=function(){_r();const vp=$("#view-pecas");if(!vp)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="pecas")S.tab="clientes";vp.hidden=S.tab!=="pecas";if(S.tab==="pecas")renderPecas()}}
window.PP_PECAS={abrir,recarregar:()=>carregar(true)};
const css=document.createElement("style");css.textContent=`
.pc-teses{display:flex;flex-direction:column;gap:6px}.pc-tese{display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer}.pc-tese input{width:16px;height:16px;accent-color:var(--gold)}
.pc-secoes{display:flex;flex-direction:column;gap:12px}.pc-secao{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}.pc-secao-h{display:flex;justify-content:space-between;align-items:center}.pc-secao textarea{width:100%;font-family:inherit;font-size:13px}`;
document.head.append(css);
})();
