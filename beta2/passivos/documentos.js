/* Documentos base (Drive) — seção da Base de conhecimento. Índice pesquisável dos arquivos da pasta JURÍDICO do Google Drive:
   os arquivos continuam no Drive (abre em nova aba); aqui ficam título, pasta, tipo, descrição, tags e destaque editáveis pela equipe,
   além de links adicionados à mão. Supabase: documentos_base, rpc documentos_base_buscar. Só equipe. Usado por conhecimento.js. */
(()=>{
"use strict";
const D={lista:[],ok:false,carregando:false,q:"",pasta:"",tipo:"",soDestaque:false};
const PASTA_RAIZ_URL="https://drive.google.com/drive/folders/1bq1-RObMlZPZsREXNJSJXOv_fjTDiTq5";
const norm=s=>(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const ICONE={docx:"📝",doc:"📝",odt:"📝",pdf:"📄",xlsx:"📊",xlsm:"📊",csv:"📊",rar:"🗜️",zip:"🗜️",folder:"📂",link:"🔗",pptx:"📽️",png:"🖼️",jpg:"🖼️"};
const icone=d=>ICONE[d.tipo]||"📎";
const semExt=t=>t.replace(/\.(docx?|odt|pdf|xlsx?|xlsm|rar|zip|pptx?)$/i,"");
const fmtData=s=>s?new Date(s+"T12:00:00").toLocaleDateString("pt-BR"):"";
const fmtTam=n=>!n?"":n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB";

async function carregar(){
  if(D.carregando)return;D.carregando=true;
  try{const {data,error}=await SB.from("documentos_base").select("*").eq("ativo",true).order("caminho").order("titulo");if(error)throw error;D.lista=data||[];D.ok=true}
  catch(e){console.warn("documentos",e);toast("Não foi possível carregar os documentos")}
  finally{D.carregando=false}
  render();
}
const garantir=()=>{if(!D.ok&&!D.carregando)carregar();return D.ok};
const caminhoCompleto=d=>d.tipo==="folder"?(d.caminho?d.caminho+" / ":"")+d.titulo:d.caminho;

/* pastas: url de cada caminho (para "abrir pasta") e pastas-folha sem conteúdo indexado (aulas, etc.) */
function pastas(){
  const urlPorCaminho={"":PASTA_RAIZ_URL};const comFilhos=new Set(D.lista.filter(d=>d.tipo!=="folder").map(d=>d.caminho));
  for(const d of D.lista.filter(d=>d.tipo==="folder"))urlPorCaminho[caminhoCompleto(d)]=d.url;
  const folhas=D.lista.filter(d=>d.tipo==="folder"&&!comFilhos.has(caminhoCompleto(d)));
  return {urlPorCaminho,folhas,caminhos:[...new Set([...comFilhos,...folhas.map(d=>d.caminho)])].sort((a,b)=>a.localeCompare(b,"pt-BR"))};
}
function filtrar(){
  const q=norm(D.q.trim());const {folhas}=pastas();
  const itens=[...D.lista.filter(d=>d.tipo!=="folder"),...folhas];
  return itens.filter(d=>{
    if(D.pasta&&!(d.caminho===D.pasta||d.caminho.startsWith(D.pasta+" / ")))return false;
    if(D.tipo&&d.tipo!==D.tipo&&!(D.tipo==="texto"&&/^(docx?|odt)$/.test(d.tipo)))return false;
    if(D.soDestaque&&!d.destaque)return false;
    if(q){const alvo=norm([d.titulo,d.caminho,d.descricao,(d.tags||[]).join(" ")].join(" "));if(!q.split(/\s+/).every(p=>alvo.includes(p)))return false}
    return true;
  });
}

function render(){if(typeof window.render==="function")window.render()}

function renderDocs(main){
  const ok=garantir();
  const ultima=D.lista.reduce((m,d)=>d.updated_at>m?d.updated_at:m,"");
  main.append(el("div",{class:"crumbs"},el("button",{onclick:()=>{window.PP_DOCS.voltar?.()}},"Base de conhecimento"),el("span",{class:"sep"},"›"),el("span",{},"Documentos base")));
  main.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico · Google Drive"),el("h1",{},"Documentos base"),
      el("div",{class:"sub"},"Modelos de peças, tópicos, jurisprudência, planilhas e materiais da pasta JURÍDICO. Arquivos do Drive abrem em preview aqui mesmo; manuais, POPs e materiais de leitura podem ser enviados para dentro do sistema (⬆). ",ultima?"Índice sincronizado em "+new Date(ultima).toLocaleDateString("pt-BR")+".":"")),
    el("div",{class:"actions"},el("a",{class:"btn sm",href:PASTA_RAIZ_URL,target:"_blank",rel:"noopener"},"Abrir pasta no Drive"),PP.perfil?.papel==="admin"?el("button",{class:"btn sm",onclick:importar},"Importar índice (JSON)"):null,el("button",{class:"btn sm",onclick:()=>editar(null)},"+ Adicionar link"),el("button",{class:"btn sm primary",onclick:enviar},"⬆ Enviar arquivo"))));
  if(!ok){main.append(el("div",{class:"note"},"Carregando documentos…"));return}
  const {urlPorCaminho,caminhos}=pastas();
  // filtros
  const q=inp("search",D.q,{placeholder:"Buscar por título, pasta, tag ou descrição…"});q.oninput=()=>{D.q=q.value;render();const n=$("#docs-q");if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length)}};q.id="docs-q";
  const selP=el("select",{},el("option",{value:""},"Todas as pastas"),caminhos.filter(Boolean).map(c=>el("option",{value:c,selected:D.pasta===c?"":null},c)));selP.onchange=()=>{D.pasta=selP.value;render()};
  const tipos=[["","Todos os tipos"],["texto","Texto (docx/odt)"],["pdf","PDF"],["xlsx","Planilhas"],["link","Links"],["folder","Pastas"]];
  const selT=el("select",{},tipos.map(([v,l])=>el("option",{value:v,selected:D.tipo===v?"":null},l)));selT.onchange=()=>{D.tipo=selT.value;render()};
  const chk=el("label",{class:"chk",style:"display:flex;align-items:center;gap:6px;white-space:nowrap"},Object.assign(inp("checkbox",""),{checked:D.soDestaque,onchange:e=>{D.soDestaque=e.target.checked;render()}}),"Só destaques ★");
  main.append(el("div",{class:"card docs-filtros"},q,selP,selT,chk));
  const itens=filtrar();
  const totalItens=D.lista.filter(d=>d.tipo!=="folder").length+pastas().folhas.length;
  main.append(el("div",{class:"note",style:"margin:6px 0 10px"},`${itens.length} de ${totalItens} itens`,D.q||D.pasta||D.tipo||D.soDestaque?el("button",{class:"btn sm",style:"margin-left:10px",onclick:()=>{D.q="";D.pasta="";D.tipo="";D.soDestaque=false;render()}},"Limpar filtros"):null));
  if(!itens.length){main.append(el("div",{class:"card empty"},"Nenhum documento com esses filtros."));return}
  // agrupado por pasta
  const grupos=new Map();for(const d of itens){const k=d.caminho||"";if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(d)}
  for(const [cam,ds] of [...grupos.entries()].sort((a,b)=>a[0].localeCompare(b[0],"pt-BR"))){
    const urlPasta=urlPorCaminho[cam];
    const card=el("section",{class:"card list"},el("div",{style:"display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line)"},
      el("div",{style:"font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)"},"📂 ",cam||"JURÍDICO (raiz)",el("span",{class:"cnt",style:"margin-left:6px"},String(ds.length))),
      urlPasta?el("a",{class:"btn sm",href:urlPasta,target:"_blank",rel:"noopener"},"Abrir pasta"):null));
    for(const d of ds)card.append(linha(d));
    main.append(card);
  }
}
function linha(d){
  const ehPasta=d.tipo==="folder";
  const meta=[ehPasta?"pasta (conteúdo não indexado)":d.tipo.toUpperCase(),fmtTam(d.tamanho),d.modificado_em?"modificado "+fmtData(d.modificado_em):null,d.origem==="link"?"link adicionado":d.origem==="arquivo"?"no sistema":null].filter(Boolean).join(" · ");
  return el("div",{class:"row docs-row"},
    el("div",{style:"font-size:18px;text-align:center"},icone(d)),
    el("div",{style:"min-width:0"},el("div",{class:"n",style:"white-space:normal"},d.destaque?"★ ":"",semExt(d.titulo)),
      d.descricao?el("div",{class:"s",style:"white-space:normal;color:var(--text)"},d.descricao):null,
      el("div",{class:"s",style:"white-space:normal"},meta,(d.tags||[]).length?el("span",{style:"margin-left:8px;display:inline-flex;gap:4px;flex-wrap:wrap;vertical-align:middle"},d.tags.map(t=>el("span",{class:"pill g",style:"font-size:10.5px"},t))):null)),
    el("div",{class:"actions docs-acoes"},
      el("button",{class:"btn sm",title:d.destaque?"Tirar destaque":"Marcar como destaque",onclick:()=>destaque(d)},d.destaque?"★":"☆"),
      el("button",{class:"btn sm",onclick:()=>editar(d)},"Editar"),
      ehPasta||(d.origem==="link"&&!previewUrl(d))?el("a",{class:"btn sm primary",href:d.url,target:"_blank",rel:"noopener"},"Abrir"):el("button",{class:"btn sm primary",onclick:()=>abrirDoc(d)},"Abrir")));
}
async function destaque(d){
  const {error}=await SB.from("documentos_base").update({destaque:!d.destaque}).eq("id",d.id);
  if(error){toast("Não foi possível salvar");return}d.destaque=!d.destaque;render();
}
function editar(d){
  if(d&&d.origem==="arquivo")return enviar(d);
  const novo=!d;const ehLink=novo||d.origem==="link";
  const {caminhos}=pastas();
  const tit=inp("text",d?.titulo||"",{placeholder:"Nome do documento"}),url=inp("url",d?.url||"",{placeholder:"https://drive.google.com/…",readonly:ehLink?null:""}),
    cam=inp("text",d?.caminho||D.pasta||"",{list:"docs-cam",placeholder:"Pasta (ex.: MODELOS DE PEÇAS / EMBARGOS)"}),dl=el("datalist",{id:"docs-cam"},caminhos.filter(Boolean).map(c=>el("option",{value:c}))),
    desc=el("textarea",{rows:"3",placeholder:"O que é, quando usar, cuidados (ex.: modelo-base para embargos com tese de taxa média BACEN; ajustar valores e jurisprudência)."},d?.descricao||""),
    tags=inp("text",(d?.tags||[]).join(", "),{placeholder:"separadas por vírgula"}),dest=el("select",{},el("option",{value:"false",selected:d?.destaque?null:""},"Normal"),el("option",{value:"true",selected:d?.destaque?"":null},"★ Destaque"));
  const body=el("div",{class:"form"},field("doc-tit","Título",tit),el("div",{class:"f full"},el("label",{for:"doc-url"},"Link"),Object.assign(url,{id:"doc-url"}),ehLink?null:el("div",{class:"note"},"Arquivo do Drive: o link e o nome vêm da sincronização.")),
    el("div",{class:"f full"},el("label",{for:"doc-cam"},"Pasta"),el("div",{},Object.assign(cam,{id:"doc-cam"}),dl)),el("div",{class:"f full"},el("label",{for:"doc-desc"},"Descrição"),Object.assign(desc,{id:"doc-desc"})),field("doc-tags","Tags",tags),field("doc-dest","Destaque",dest));
  if(!novo&&PP.perfil?.papel==="admin")body.append(el("div",{class:"f full"},el("button",{class:"btn danger sm",onclick:async()=>{if(!confirm("Remover este item do índice? (o arquivo no Drive não é apagado)"))return;const {error}=await SB.from("documentos_base").delete().eq("id",d.id);if(error){toast("Não foi possível remover");return}toast("Removido do índice");$("#modalHost .btn:not(.primary)")?.click();D.ok=false;carregar()}},"Remover do índice")));
  modal(novo?"Adicionar link":"Editar documento",body,async()=>{
    const row={titulo:tit.value.trim(),caminho:cam.value.trim().replace(/\s*\/\s*/g," / "),descricao:desc.value.trim()||null,tags:tags.value.split(",").map(s=>s.trim()).filter(Boolean),destaque:dest.value==="true"};
    if(!row.titulo)throw new Error("Informe o título");
    if(ehLink){if(!/^https?:\/\//i.test(url.value.trim()))throw new Error("Informe um link válido (https://…)");row.url=url.value.trim();row.origem="link";row.tipo=/drive\.google\.com\/drive\/folders/.test(row.url)?"folder":/docs\.google\.com\/document/.test(row.url)?"docx":/docs\.google\.com\/spreadsheets/.test(row.url)?"xlsx":/\.pdf(\?|$)/i.test(row.url)?"pdf":"link";row.area="juridico"}
    const {error}=novo?await SB.from("documentos_base").insert(row):await SB.from("documentos_base").update(row).eq("id",d.id);
    if(error)throw error;toast(novo?"Link adicionado":"Documento atualizado");D.ok=false;await carregar();
  });
}

/* Importação do índice (admin): arquivo juridico-indice.json gerado a partir do Drive. Upsert por drive_id em lotes;
   preserva descrição/tags/destaque já editados; o que sumiu do Drive vira ativo=false. */
function importar(){
  const f=inp("file","",{accept:"application/json,.json"});
  const info=el("div",{class:"note"},"Selecione o arquivo juridico-indice.json (gerado pelo mapeamento da pasta JURÍDICO). Pode ser repetido quando o Drive mudar: títulos, pastas e links são atualizados; descrições, tags e destaques editados aqui são preservados.");
  const prog=el("div",{class:"note"});
  modal("Importar índice do Drive",el("div",{class:"form"},el("div",{class:"f full"},el("label",{},"Arquivo"),f),el("div",{class:"f full"},info),el("div",{class:"f full"},prog)),async()=>{
    const file=f.files?.[0];if(!file)throw new Error("Escolha o arquivo JSON");
    let j;try{j=JSON.parse(await file.text())}catch(_){throw new Error("Arquivo inválido")}
    const itens=Array.isArray(j)?j:(j.itens||[]);const area=j.area||"juridico";
    if(!itens.length||!itens[0].drive_id||!itens[0].url)throw new Error("Formato inesperado: esperado {itens:[{drive_id,titulo,url,…}]}");
    prog.textContent="Lendo índice atual…";
    const {data:atuais,error:e0}=await SB.from("documentos_base").select("drive_id").eq("origem","drive").eq("area",area).not("drive_id","is",null);if(e0)throw e0;
    const existentes=new Set((atuais||[]).map(r=>r.drive_id));
    const base=x=>({area,origem:"drive",drive_id:x.drive_id,pasta_drive_id:x.pasta_drive_id||null,caminho:x.caminho||"",titulo:x.titulo,tipo:x.tipo||"",mime:x.mime||null,url:x.url,tamanho:x.tamanho||null,modificado_em:x.modificado_em||null,ativo:true});
    const novos=itens.filter(x=>!existentes.has(x.drive_id)).map(x=>({...base(x),tags:x.tags||[]}));
    const velhos=itens.filter(x=>existentes.has(x.drive_id)).map(base);
    let feitos=0;const total=novos.length+velhos.length;
    for(const lote of [novos,velhos])for(let i=0;i<lote.length;i+=100){
      const {error}=await SB.from("documentos_base").upsert(lote.slice(i,i+100),{onConflict:"drive_id"});if(error)throw error;
      feitos+=Math.min(100,lote.length-i);prog.textContent=`Gravando… ${feitos}/${total}`;
    }
    const ids=new Set(itens.map(x=>x.drive_id));const sumiram=[...existentes].filter(id=>!ids.has(id));
    for(let i=0;i<sumiram.length;i+=100){const {error}=await SB.from("documentos_base").update({ativo:false}).in("drive_id",sumiram.slice(i,i+100));if(error)throw error}
    toast(`Índice importado: ${novos.length} novos, ${velhos.length} atualizados, ${sumiram.length} inativados`);D.ok=false;await carregar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Importar";
}

/* ---------- Abrir dentro do sistema ---------- */
const EXT=t=>(t||"").toLowerCase();
function driveId(d){if(d.drive_id)return d.drive_id;const m=(d.url||"").match(/\/d\/([A-Za-z0-9_-]{15,})/)||(d.url||"").match(/[?&]id=([A-Za-z0-9_-]{15,})/);return m?m[1]:null}
function previewUrl(d){
  const id=driveId(d);if(!id)return null;const m=d.mime||"";
  if(m.includes("google-apps.document")||/docs\.google\.com\/document/.test(d.url||""))return `https://docs.google.com/document/d/${id}/preview`;
  if(m.includes("google-apps.spreadsheet")||/docs\.google\.com\/spreadsheets/.test(d.url||""))return `https://docs.google.com/spreadsheets/d/${id}/preview`;
  if(m.includes("google-apps.presentation")||/docs\.google\.com\/presentation/.test(d.url||""))return `https://docs.google.com/presentation/d/${id}/preview`;
  return `https://drive.google.com/file/d/${id}/preview`;
}
const carregarLib=(src,glob)=>new Promise((res,rej)=>{if(window[glob])return res(window[glob]);const s=document.createElement("script");s.src=src;s.onload=()=>res(window[glob]);s.onerror=rej;document.head.append(s)});
async function urlAssinada(d,baixar){
  const {data,error}=await SB.storage.from("conhecimento").createSignedUrl(d.caminho_storage,3600,baixar?{download:d.titulo}:undefined);
  if(error)throw error;return data.signedUrl;
}
async function abrirDoc(d){
  const box=el("div",{class:"doc-viewer"},el("div",{class:"note"},"Carregando…"));
  const acoes=el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"});
  modal(semExt(d.titulo),el("div",{},el("div",{class:"note",style:"margin-bottom:8px"},[d.caminho||null,d.tipo?d.tipo.toUpperCase():null,d.origem==="arquivo"?"guardado no sistema":"Google Drive"].filter(Boolean).join(" · ")),acoes,box),async()=>{});
  const host=$("#modalHost .card");if(host){host.classList.add("doc-modal");$("#modalHost button.btn.primary")?.remove()}
  try{
    if(d.origem==="arquivo"){
      const url=await urlAssinada(d,false);const ext=EXT(d.tipo);
      acoes.append(el("a",{class:"btn sm",href:await urlAssinada(d,true)},"⬇ Baixar"),el("a",{class:"btn sm",href:url,target:"_blank",rel:"noopener"},"Abrir em nova aba"));
      if(ext==="pdf")box.replaceChildren(el("iframe",{src:url+"#view=FitH",title:d.titulo}));
      else if(/^(png|jpe?g|gif|webp)$/.test(ext))box.replaceChildren(el("img",{src:url,alt:d.titulo,style:"max-width:100%"}));
      else if(/^docx?$/.test(ext)){
        await carregarLib("https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js","mammoth");
        const ab=await (await fetch(url)).arrayBuffer();const r=await window.mammoth.convertToHtml({arrayBuffer:ab});
        const div=el("div",{class:"md doc-html"});div.innerHTML=r.value.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/ on\w+="[^"]*"/gi,"");box.replaceChildren(div);
      }
      else if(/^(xlsx|xlsm|csv)$/.test(ext)){
        await carregarLib("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","XLSX");
        const ab=await (await fetch(url)).arrayBuffer();const wb=window.XLSX.read(ab,{type:"array"});
        const wrap=el("div",{class:"doc-html"});
        for(const n of wb.SheetNames.slice(0,6)){const t=el("div",{});t.innerHTML=window.XLSX.utils.sheet_to_html(wb.Sheets[n],{header:"",footer:""}).replace(/<script[\s\S]*?<\/script>/gi,"");wrap.append(el("h3",{},n),t)}
        box.replaceChildren(wrap);
      }
      else box.replaceChildren(el("div",{class:"note"},"Este tipo de arquivo não abre aqui — use ⬇ Baixar."));
    } else {
      const pv=previewUrl(d);
      acoes.append(el("a",{class:"btn sm",href:d.url,target:"_blank",rel:"noopener"},"Abrir no Drive"));
      if(pv)box.replaceChildren(el("iframe",{src:pv,title:d.titulo,allow:"autoplay"}),el("div",{class:"note",style:"margin-top:6px"},"Se aparecer “acesso negado”, entre na conta Google do escritório neste navegador ou use “Abrir no Drive”."));
      else box.replaceChildren(el("div",{class:"note"},"Sem preview para este link — use “Abrir no Drive”."));
    }
  }catch(e){console.warn("abrirDoc",e);box.replaceChildren(el("div",{class:"note"},"Não foi possível abrir: "+(e.message||e)))}
}

/* ---------- Enviar arquivo para o sistema ---------- */
const AREAS_KB={juridico:"Jurídico",comercial:"Comercial",financeiro:"Financeiro",administrativo:"Administrativo",marketing:"Marketing",geral:"Geral"};
const podeAreaKb=a=>{const p=PP.perfil||{};if(p.papel==="admin")return true;const ac=p.acessos||[];if(a==="geral")return true;if(a==="administrativo")return ac.includes("financeiro")||ac.includes("equipe");return ac.includes(a)};
function enviar(d){
  const novo=!d;const {caminhos}=pastas();
  const f=inp("file","",{accept:".pdf,.docx,.doc,.xlsx,.xlsm,.csv,.png,.jpg,.jpeg,.pptx"});
  const tit=inp("text",d?.titulo||"",{placeholder:"Título (se vazio, usa o nome do arquivo)"}),
    area=el("select",{},Object.entries(AREAS_KB).filter(([k])=>podeAreaKb(k)).map(([v,l])=>el("option",{value:v,selected:(d?.area||"juridico")===v?"":null},l))),
    cam=inp("text",d?.caminho||D.pasta||"",{list:"docs-cam2",placeholder:"Pasta/tema (ex.: Manuais / Atendimento)"}),dl=el("datalist",{id:"docs-cam2"},caminhos.filter(Boolean).map(c=>el("option",{value:c}))),
    desc=el("textarea",{rows:"3",placeholder:"O que é, quando usar."},d?.descricao||""),tags=inp("text",(d?.tags||[]).join(", "),{placeholder:"separadas por vírgula"}),
    dest=el("select",{},el("option",{value:"false",selected:d?.destaque?null:""},"Normal"),el("option",{value:"true",selected:d?.destaque?"":null},"★ Destaque")),prog=el("div",{class:"note"});
  const body=el("div",{class:"form"},el("div",{class:"f full"},el("label",{for:"doc-file"},novo?"Arquivo":"Substituir arquivo (opcional)"),Object.assign(f,{id:"doc-file"}),el("div",{class:"help"},"Até 50 MB. PDF, Word e planilhas abrem dentro do sistema; o acesso segue a área escolhida.")),
    field("doc-tit2","Título",tit),field("doc-area2","Área",area),el("div",{class:"f full"},el("label",{for:"doc-cam2"},"Pasta/tema"),el("div",{},Object.assign(cam,{id:"doc-cam2"}),dl)),
    el("div",{class:"f full"},el("label",{for:"doc-desc2"},"Descrição"),Object.assign(desc,{id:"doc-desc2"})),field("doc-tags2","Tags",tags),field("doc-dest2","Destaque",dest),el("div",{class:"f full"},prog));
  modal(novo?"Enviar arquivo para a base":"Editar arquivo",body,async()=>{
    const file=f.files?.[0];if(novo&&!file)throw new Error("Escolha o arquivo");
    if(file&&file.size>52428800)throw new Error("Arquivo acima de 50 MB");
    const row={titulo:tit.value.trim()||(file?file.name:d.titulo),area:area.value,caminho:cam.value.trim().replace(/\s*\/\s*/g," / "),descricao:desc.value.trim()||null,tags:tags.value.split(",").map(s=>s.trim()).filter(Boolean),destaque:dest.value==="true",origem:"arquivo",url:""};
    if(file){
      const ext=(file.name.split(".").pop()||"").toLowerCase();row.tipo=ext;row.mime=file.type||null;row.tamanho=file.size;row.modificado_em=new Date(file.lastModified).toISOString().slice(0,10);
      const limpo=file.name.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Za-z0-9._-]+/g,"_").slice(0,80);
      row.caminho_storage=`${row.area}/${crypto.randomUUID()}-${limpo}`;
      prog.textContent="Enviando…";
      const {error:eu}=await SB.storage.from("conhecimento").upload(row.caminho_storage,file,{contentType:file.type||undefined,upsert:false});if(eu)throw eu;
      if(!novo&&d.caminho_storage){await SB.storage.from("conhecimento").remove([d.caminho_storage])}
    }
    const {error}=novo?await SB.from("documentos_base").insert(row):await SB.from("documentos_base").update(row).eq("id",d.id);
    if(error){if(row.caminho_storage&&file)await SB.storage.from("conhecimento").remove([row.caminho_storage]);throw error}
    toast(novo?"Arquivo enviado":"Arquivo atualizado");D.ok=false;await carregar();
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent=novo?"Enviar":"Salvar";
}

async function buscar(q,lim=12){const {data,error}=await SB.rpc("documentos_base_buscar",{q,lim});return error?[]:(data||[])}

document.head.append(el("style",{},`.doc-modal{width:min(1100px,100%)!important}.doc-viewer{min-height:200px}.doc-viewer iframe{width:100%;height:min(78vh,900px);border:1px solid var(--line);border-radius:10px;background:#fff}.doc-html{max-height:78vh;overflow:auto;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.doc-html table{border-collapse:collapse;font-size:12.5px}.doc-html td,.doc-html th{border:1px solid var(--line);padding:3px 6px}.docs-filtros{display:grid;grid-template-columns:minmax(200px,2fr) minmax(160px,1.5fr) minmax(120px,1fr) auto;gap:10px;align-items:center;padding:12px}.docs-filtros select,.docs-filtros input{min-width:0;max-width:100%}.docs-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;cursor:default}.docs-row .n{overflow-wrap:anywhere}.docs-acoes{flex-wrap:nowrap}@media (max-width:860px){.docs-filtros{grid-template-columns:1fr}.docs-row{grid-template-columns:28px minmax(0,1fr)}.docs-acoes{grid-column:2;justify-content:flex-start}}`));
window.PP_DOCS={render:renderDocs,buscar,garantir,abrir:abrirDoc,get lista(){return D.lista},get total(){return D.lista.filter(d=>d.tipo!=="folder").length},abrirPasta(c){D.pasta=c||"";D.q="";},invalidar(){D.ok=false}};
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const ch=SB.channel("documentos");ch.on("postgres_changes",{event:"*",schema:"public",table:"documentos_base"},()=>{D.ok=false;if(S.tab==="conhecimento")garantir()});ch.subscribe()}});
})();
