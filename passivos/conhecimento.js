/* Base de conhecimento (Jurídico) — artigos em Markdown por tema: lista, busca (full-text no banco), leitura, edição com versões.
   Supabase: conteudos, conteudos_versoes, v_conteudos, rpc conhecimento_buscar. Markdown: marked (CDN) + sanitização própria; diagramas: mermaid (CDN, sob demanda). Só equipe. */
(()=>{
"use strict";
const K={lista:[],ok:false,carregando:false,sel:null,art:null,versoes:[],busca:"",resultados:null,resultadosDocs:null,editando:false,tema:""};
const DOCS=()=>window.PP_DOCS;
const ROTA_ART=()=>"#conhecimento"+(K.sel?"/"+K.sel:"");
let marked=null,mermaid=null;
const carregarLib=(src,glob)=>new Promise((res,rej)=>{if(window[glob])return res(window[glob]);const s=document.createElement("script");s.src=src;s.onload=()=>res(window[glob]);s.onerror=rej;document.head.append(s)});
async function libs(){if(!marked){await carregarLib("https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js","marked");marked=window.marked}return marked}

async function carregar(){
  if(K.carregando)return;K.carregando=true;
  try{const {data,error}=await SB.from("v_conteudos").select("*").order("tema").order("ordem").order("titulo");if(error)throw error;K.lista=data||[];K.ok=true}
  catch(e){console.warn("conhecimento",e);toast("Não foi possível carregar a base de conhecimento")}
  finally{K.carregando=false}
  render();
}
const garantir=()=>{if(!K.ok&&!K.carregando)carregar();return K.ok};
async function abrir(slug){
  K.sel=slug;K.editando=false;K.art=null;K.versoes=[];render();
  if(slug==="documentos")return;
  const {data}=await SB.from("conteudos").select("*").eq("slug",slug).maybeSingle();
  if(!data){toast("Artigo não encontrado");K.sel=null;render();return}
  K.art=data;const v=await SB.from("conteudos_versoes").select("id,versao,created_at,editado_por").eq("conteudo_id",data.id).order("versao",{ascending:false}).limit(20);K.versoes=v.data||[];
  render();
}

/* ---------- Markdown seguro ---------- */
const TAGS_OK=new Set(["P","BR","STRONG","B","EM","I","U","S","DEL","CODE","PRE","BLOCKQUOTE","UL","OL","LI","H1","H2","H3","H4","H5","H6","TABLE","THEAD","TBODY","TR","TH","TD","A","HR","DETAILS","SUMMARY","SPAN","DIV","IMG","SUP","SUB"]);
function sanitizar(html){
  const d=new DOMParser().parseFromString(html,"text/html");
  const walk=(n)=>{for(const c of [...n.children]){
    if(!TAGS_OK.has(c.tagName)){c.replaceWith(...c.childNodes);continue}
    for(const a of [...c.attributes]){const nm=a.name.toLowerCase();if(nm==="href"&&/^(https?:|mailto:|#)/i.test(a.value)){c.setAttribute("target","_blank");c.setAttribute("rel","noopener");continue}if(nm==="src"&&/^https:/i.test(a.value))continue;if(nm==="class"&&c.tagName==="PRE")continue;if(nm==="open"&&c.tagName==="DETAILS")continue;c.removeAttribute(a.name)}
    walk(c)}};
  walk(d.body);return d.body.innerHTML;
}
async function renderMd(md,host){
  const m=await libs();
  const html=m.parse(md||"",{gfm:true,breaks:true});
  host.innerHTML=sanitizar(html);host.classList.add("md");
  const blocos=[...host.querySelectorAll("pre > code")].filter(c=>/^language-mermaid$/.test(c.className||"")||/^\s*(flowchart|graph|mindmap|sequenceDiagram|gantt)\b/.test(c.textContent));
  if(blocos.length){try{if(!mermaid){await carregarLib("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js","mermaid");mermaid=window.mermaid;mermaid.initialize({startOnLoad:false,theme:document.documentElement.dataset.theme==="dark"||matchMedia("(prefers-color-scheme: dark)").matches?"dark":"neutral",securityLevel:"strict"})}
    for(const [i,c] of blocos.entries()){const pre=c.parentElement;const div=el("div",{class:"mermaid-box"});pre.replaceWith(div);try{const {svg}=await mermaid.render("mm"+Date.now()+i,c.textContent);div.innerHTML=svg}catch(e){div.append(el("pre",{},c.textContent))}}
  }catch(e){console.warn("mermaid",e)}}
}

/* ---------- Telas ---------- */
function renderConhecimento(){
  const v=$("#view-conhecimento");v.replaceChildren();
  const ok=garantir();DOCS()?.garantir();
  const temas=[...new Set(K.lista.map(c=>c.tema))];
  const head=el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Jurídico"),el("h1",{},"Base de conhecimento"),el("div",{class:"sub"},"Teses, procedimentos (POPs), produtos de crédito, negociação, proteção patrimonial. Qualquer pessoa da equipe edita; cada edição guarda a versão anterior.")),
    el("div",{class:"actions"},el("button",{class:"btn primary",onclick:()=>novoArtigo()},"+ Artigo")));
  v.append(head);
  if(!ok){v.append(el("div",{class:"note"},"Carregando…"));return}
  const grid=el("div",{style:"display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px"});
  // lateral: busca + temas
  const q=inp("search",K.busca,{placeholder:"Buscar na base…"});let t;q.oninput=()=>{K.busca=q.value;clearTimeout(t);t=setTimeout(buscar,350)};
  const side=el("aside",{class:"side"},q);
  const nDocs=DOCS()?.total||0;
  side.append(el("div",{class:"card list"},el("button",{class:"row","aria-current":String(K.sel==="documentos"),onclick:()=>abrir("documentos")},el("div",{},el("div",{class:"n"},"📁 Documentos base (Drive)"),el("div",{class:"s"},nDocs?`${nDocs} arquivos indexados — modelos, tópicos, jurisprudência`:"modelos, tópicos, jurisprudência")))));
  if(K.resultados){side.append(el("div",{class:"card list"},K.resultados.length?K.resultados.map(r=>el("button",{class:"row","aria-current":String(K.sel===r.slug),onclick:()=>{abrir(r.slug)}},el("div",{},el("div",{class:"n"},r.titulo),el("div",{class:"s"},r.tema),el("div",{class:"s",style:"white-space:normal"},Object.assign(el("span",{}),{innerHTML:sanitizar(r.trecho||"")})))))
    :el("div",{class:"empty"},"Nada encontrado nos artigos.")));
    if(K.resultadosDocs?.length)side.append(el("div",{class:"card list"},el("div",{style:"padding:8px 12px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)"},"Documentos (Drive)",el("span",{class:"cnt",style:"margin-left:6px"},String(K.resultadosDocs.length))),K.resultadosDocs.map(r=>el("a",{class:"row",href:r.url,target:"_blank",rel:"noopener",style:"text-decoration:none"},el("div",{},el("div",{class:"n"},r.titulo),el("div",{class:"s"},r.caminho||"JURÍDICO"),r.trecho&&r.trecho.trim()?el("div",{class:"s",style:"white-space:normal"},Object.assign(el("span",{}),{innerHTML:sanitizar(r.trecho)})):null)))))}
  else{
    const sel=el("select",{},el("option",{value:""},"Todos os temas"),temas.map(tm=>el("option",{value:tm,selected:K.tema===tm?"":null},tm)));sel.onchange=()=>{K.tema=sel.value;render()};
    side.append(sel);
    for(const tm of temas.filter(x=>!K.tema||x===K.tema)){
      const its=K.lista.filter(c=>c.tema===tm);
      side.append(el("div",{class:"card list"},el("div",{style:"padding:8px 12px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)"},tm,el("span",{class:"cnt",style:"margin-left:6px"},String(its.length))),
        its.map(c=>el("button",{class:"row","aria-current":String(K.sel===c.slug),onclick:()=>abrir(c.slug)},el("div",{},el("div",{class:"n"},c.titulo),el("div",{class:"s"},[c.publicado?null:"rascunho",`v${c.versao}`,c.autor_nome].filter(Boolean).join(" · ")))))));
    }
  }
  grid.append(side);
  const main=el("main",{class:"main"});grid.append(main);v.append(grid);
  if(!K.sel){main.append(el("div",{class:"card empty"},el("h3",{},"Escolha um artigo"),el("div",{},`${K.lista.length} artigos em ${temas.length} temas. Use a busca para encontrar por palavra (ex.: "prescrição intercorrente", "Pronampe", "leilão") — ela procura também nos documentos do Drive.`),el("div",{style:"margin-top:10px"},el("button",{class:"btn sm",onclick:()=>abrir("documentos")},"📁 Documentos base (Drive)"))));return}
  if(K.sel==="documentos"){if(DOCS()){DOCS().voltar=()=>{K.sel=null;render()};DOCS().render(main)}else main.append(el("div",{class:"note"},"Módulo de documentos indisponível."));return}
  if(!K.art){main.append(el("div",{class:"note"},"Carregando artigo…"));return}
  if(K.editando){renderEditor(main);return}
  const a=K.art;
  main.append(el("div",{class:"crumbs"},el("button",{onclick:()=>{K.sel=null;render()}},"Base de conhecimento"),el("span",{class:"sep"},"›"),el("span",{},a.tema),el("span",{class:"sep"},"›"),el("span",{},a.titulo)));
  main.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},a.tema),el("h1",{},a.titulo),el("div",{class:"sub"},[a.resumo,`versão ${a.versao}`,a.updated_at?"atualizado em "+new Date(a.updated_at).toLocaleDateString("pt-BR"):null,a.origem!=="manual"?"origem: "+a.origem:null].filter(Boolean).join(" · "))),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>{navigator.clipboard?.writeText(location.origin+location.pathname+ROTA_ART());toast("Link copiado")}},"Copiar link"),el("button",{class:"btn sm primary",onclick:()=>{K.editando=true;render()}},"Editar"))));
  if(a.tags?.length)main.append(el("div",{style:"display:flex;gap:6px;flex-wrap:wrap"},a.tags.map(t=>el("span",{class:"pill g"},t))));
  const corpo=el("section",{class:"card section"});main.append(corpo);renderMd(a.corpo_md,corpo);
  const rel=K.lista.filter(c=>c.id!==a.id&&(c.tema===a.tema||(c.tags||[]).some(t=>(a.tags||[]).includes(t)))).slice(0,8);
  if(rel.length)main.append(el("section",{class:"card section"},el("h2",{},"Relacionados"),el("ul",{style:"margin:0;padding-left:18px"},rel.map(c=>el("li",{},el("a",{href:"#conhecimento/"+c.slug,style:"color:var(--info)",onclick:e=>{e.preventDefault();abrir(c.slug)}},c.titulo),el("span",{class:"note"}," · "+c.tema))))));
  if(K.versoes.length)main.append(el("section",{class:"card section"},el("h2",{},"Versões anteriores"),el("div",{class:"note"},K.versoes.map(x=>`v${x.versao} (${new Date(x.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"})})`).join(" · ")),el("div",{class:"actions",style:"justify-content:flex-start"},K.versoes.slice(0,5).map(x=>el("button",{class:"btn sm",onclick:()=>verVersao(x)},"Ver v"+x.versao)))));
}
async function buscar(){
  const qq=K.busca.trim();if(qq.length<3){K.resultados=null;K.resultadosDocs=null;render();return}
  const [{data,error},docs]=await Promise.all([SB.rpc("conhecimento_buscar",{q:qq,lim:30}),DOCS()?DOCS().buscar(qq,12):Promise.resolve([])]);if(error){toast("Busca indisponível");return}
  K.resultados=data||[];K.resultadosDocs=docs;render();
}
function renderEditor(main){
  const a=K.art;const temas=[...new Set(K.lista.map(c=>c.tema))];
  const tit=inp("text",a.titulo),tema=inp("text",a.tema,{list:"temas-dl"}),dl=el("datalist",{id:"temas-dl"},temas.map(t=>el("option",{value:t}))),res=inp("text",a.resumo||"",{placeholder:"Uma linha que aparece na lista e na busca"}),tags=inp("text",(a.tags||[]).join(", "),{placeholder:"separadas por vírgula"}),pub=el("select",{},el("option",{value:"true",selected:a.publicado?"":null},"Publicado"),el("option",{value:"false",selected:a.publicado?null:""},"Rascunho"));
  const ta=el("textarea",{style:"min-height:60vh;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5"},a.corpo_md||"");
  const prev=el("div",{class:"card section",style:"min-height:60vh;overflow:auto"});let tp;const atualizar=()=>{clearTimeout(tp);tp=setTimeout(()=>renderMd(ta.value,prev),400)};ta.oninput=atualizar;atualizar();
  const salvar=async()=>{
    if(!tit.value.trim())return toast("Informe o título");
    const row={titulo:tit.value.trim(),tema:tema.value.trim()||a.tema,resumo:res.value.trim()||null,tags:tags.value.split(",").map(s=>s.trim()).filter(Boolean),publicado:pub.value==="true",corpo_md:ta.value};
    const {error}=a.id?await SB.from("conteudos").update(row).eq("id",a.id):await SB.from("conteudos").insert(row);
    if(error){toast("Não foi possível salvar: "+(error.message||""));return}
    toast("Artigo salvo");K.ok=false;K.editando=false;await carregar();
    if(!a.id){const n=K.lista.find(c=>c.titulo===row.titulo&&c.tema===row.tema);if(n)abrir(n.slug)}else abrir(a.slug);
  };
  const excluir=async()=>{if(!confirm("Excluir este artigo e todas as versões?"))return;const {error}=await SB.from("conteudos").delete().eq("id",a.id);if(error){toast("Só o administrador exclui");return}toast("Artigo excluído");K.sel=null;K.ok=false;carregar()};
  main.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},a.id?"Editando":"Novo artigo"),el("h1",{},a.id?a.titulo:"Novo artigo"),el("div",{class:"sub"},"Markdown: # títulos, **negrito**, listas, tabelas, > citações, ```mermaid para fluxogramas, <details><summary> para blocos recolhíveis.")),
    el("div",{class:"actions"},a.id&&PP.perfil?.papel==="admin"?el("button",{class:"btn danger",onclick:excluir},"Excluir"):null,el("button",{class:"btn",onclick:()=>{K.editando=false;if(!a.id)K.sel=null;render()}},"Cancelar"),el("button",{class:"btn primary",onclick:salvar},"Salvar"))));
  main.append(el("div",{class:"form",style:"grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"},field("kb-tit","Título",tit),el("div",{class:"f"},el("label",{for:"kb-tema"},"Tema"),el("div",{},Object.assign(tema,{id:"kb-tema"}),dl)),field("kb-res","Resumo",res),field("kb-tags","Tags",tags),field("kb-pub","Situação",pub)));
  main.append(el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:14px"},el("div",{},ta),prev));
}
function novoArtigo(){K.art={id:null,titulo:"",tema:K.tema||"Operação jurídica",resumo:"",tags:[],publicado:true,corpo_md:"# Título\n\nTexto…"};K.sel="novo";K.editando=true;render()}
async function verVersao(x){
  const {data}=await SB.from("conteudos_versoes").select("*").eq("id",x.id).single();if(!data)return;
  const host=el("div",{class:"f full"});renderMd(data.corpo_md,host);
  const body=el("div",{class:"form"},el("div",{class:"f full note"},`Versão ${data.versao} · ${new Date(data.created_at).toLocaleString("pt-BR")} · ${data.titulo||""}`),host);
  modal("Versão anterior",body,async()=>{const {error}=await SB.from("conteudos").update({corpo_md:data.corpo_md,titulo:data.titulo||K.art.titulo,resumo:data.resumo,tags:data.tags||[]}).eq("id",K.art.id);if(error)throw error;toast("Versão restaurada");K.ok=false;await carregar();abrir(K.art.slug)});
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Restaurar esta versão";
}

/* ---------- Integração ---------- */
const CSS=`.md{line-height:1.6;font-size:15px}.md h1{font-size:24px;margin:18px 0 8px}.md h2{font-size:20px;margin:22px 0 8px;padding-top:10px;border-top:1px solid var(--line)}.md h3{font-size:17px;margin:16px 0 6px}.md p{margin:8px 0}.md ul,.md ol{margin:6px 0 10px;padding-left:22px}.md li{margin:3px 0}.md blockquote{margin:10px 0;padding:10px 14px;border-left:3px solid var(--gold);background:var(--gold-soft);border-radius:6px}.md table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13.5px}.md th,.md td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}.md th{background:var(--surface-2)}.md code{background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:13px}.md pre{background:var(--surface-2);padding:10px 12px;border-radius:8px;overflow:auto;font-size:13px}.md pre code{background:none;padding:0}.md details{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:10px 0;background:var(--surface)}.md summary{cursor:pointer;font-weight:700}.md details[open] summary{margin-bottom:8px}.md hr{border:0;border-top:1px solid var(--line);margin:16px 0}.md a{color:var(--info)}.md img{max-width:100%}.mermaid-box{margin:12px 0;overflow:auto;background:#fff;border-radius:8px;padding:8px}.mermaid-box svg{max-width:100%;height:auto}.md mark,.side mark{background:var(--gold-soft);padding:0 2px}@media (max-width:860px){#view-conhecimento>div[style*="grid-template-columns:300px"]{grid-template-columns:1fr!important}}`;
document.head.append(el("style",{},CSS));
{const _r=render;render=function(){_r();const vk=$("#view-conhecimento");if(!vk)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="conhecimento")S.tab="clientes";vk.hidden=S.tab!=="conhecimento";if(S.tab==="conhecimento"){renderConhecimento();const h=ROTA_ART();if(location.hash!==h&&K.sel!=="novo"){try{history.replaceState(null,"",h)}catch(_){}}}}}
// rota #conhecimento/<slug>
{const _a=window.aplicarHash;if(typeof _a==="function")window.aplicarHash=function(){const r=_a();const [tab,slug]=(location.hash||"").slice(1).split("/");if(tab==="conhecimento"&&slug&&slug!==K.sel){abrir(decodeURIComponent(slug))}return r}}
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe()){const [tab,slug]=(location.hash||"").slice(1).split("/");if(tab==="conhecimento"&&slug)abrir(decodeURIComponent(slug));const ch=SB.channel("conhecimento");ch.on("postgres_changes",{event:"*",schema:"public",table:"conteudos"},()=>{K.ok=false;if(S.tab==="conhecimento")garantir()});ch.subscribe()}});
})();
