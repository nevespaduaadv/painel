/* RH — ficha do colaborador: foto, dados básicos (equipe vê), PDI (admin e o próprio), dados sensíveis/salário/histórico (só admin).
   Supabase: colaboradores (+foto_path…), colaboradores_rh, colaboradores_historico, pdi, pdi_registros, bucket 'fotos' (0023).
   Abre a partir da tela Equipe (clique na linha / botão Ficha); rota #equipe/<id>. */
(()=>{
"use strict";
const R={sel:null,aba:"pdi",dados:null,rh:null,hist:[],pdi:[],reg:[],fotos:{},carregando:false,aniv:null};
const admin=()=>PP.perfil?.papel==="admin";
const NUCLEOS=()=>window.PP_EQUIPE?.NUCLEOS||{};
const VINCULO={clt:"CLT",pj:"PJ",estagio:"Estágio",socio:"Sócio(a)",autonomo:"Autônomo",outro:"Outro"};
const HIST={admissao:"Admissão",promocao:"Promoção",reajuste:"Reajuste",mudanca_cargo:"Mudança de cargo",ferias:"Férias",feedback:"Feedback formal",advertencia:"Advertência",desligamento:"Desligamento",outro:"Outro"};
const PDI_ST={planejado:"Planejado",em_andamento:"Em andamento",concluido:"Concluído",cancelado:"Cancelado"};
const REG={one_on_one:"1:1",feedback:"Feedback",avaliacao:"Avaliação",nota:"Nota"};
const parseD=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const fmtD=s=>s?parseD(s).toLocaleDateString("pt-BR"):"—";
const brl=v=>v==null?"—":Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const tempoCasa=s=>{if(!s)return"";const d=parseD(s),n=new Date();let m=(n.getFullYear()-d.getFullYear())*12+n.getMonth()-d.getMonth();if(n.getDate()<d.getDate())m--;const a=Math.floor(m/12),mm=m%12;return [a?`${a} ano${a>1?"s":""}`:null,mm?`${mm} ${mm>1?"meses":"mês"}`:null].filter(Boolean).join(" e ")||"este mês"};
const iniciais=n=>(n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
const proprio=c=>c?.perfil_id&&c.perfil_id===PP.perfil?.id;

/* ---------- fotos ---------- */
async function fotoUrl(path){
  if(!path)return null;const c=R.fotos[path];if(c&&c.exp>Date.now())return c.url;
  const {data}=await SB.storage.from("fotos").createSignedUrl(path,3600);if(!data?.signedUrl)return null;R.fotos[path]={url:data.signedUrl,exp:Date.now()+3300e3};return data.signedUrl;
}
function avatar(c,tam=56){
  const box=el("div",{class:"rh-avatar",style:`width:${tam}px;height:${tam}px;font-size:${Math.round(tam/2.6)}px`},iniciais(c.apelido||c.nome));
  if(c.foto_path)fotoUrl(c.foto_path).then(u=>{if(u){box.replaceChildren();box.style.backgroundImage=`url("${u}")`}});
  return box;
}
async function enviarFoto(c,file){
  if(!file)return;if(file.size>5*1024*1024){toast("Foto acima de 5 MB");return}
  // redimensiona para 512px no navegador
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(file)});
  const cv=document.createElement("canvas");const esc=Math.min(1,512/Math.max(img.width,img.height));cv.width=Math.round(img.width*esc);cv.height=Math.round(img.height*esc);cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
  const blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",0.86));const path=`colaboradores/${c.id}.jpg`;
  const {error}=await SB.storage.from("fotos").upload(path,blob,{upsert:true,contentType:"image/jpeg"});if(error){toast("Não foi possível enviar a foto");return}
  delete R.fotos[path];const r=await SB.from("colaboradores").update({foto_path:path}).eq("id",c.id);if(r.error){toast("Foto enviada, mas não gravada");return}
  toast("Foto atualizada");window.PP_EQUIPE?.recarregar();R.dados=null;carregar(c.id);
}

/* ---------- dados ---------- */
async function carregar(id){
  if(R.carregando)return;R.carregando=true;
  try{
    const base=SB.from("v_colaboradores").select("*").eq("id",id).maybeSingle();
    const [c,p,g,rh,h]=await Promise.all([base,SB.from("pdi").select("*").eq("colaborador_id",id).order("status").order("prazo"),SB.from("pdi_registros").select("*").eq("colaborador_id",id).order("data",{ascending:false}),
      admin()?SB.from("colaboradores_rh").select("*").eq("colaborador_id",id).maybeSingle():{data:null},admin()?SB.from("colaboradores_historico").select("*").eq("colaborador_id",id).order("data",{ascending:false}):{data:[]}]);
    if(c.error)throw c.error;R.dados=c.data;R.pdi=p.data||[];R.reg=g.data||[];R.rh=rh.data||null;R.hist=h.data||[];
  }catch(e){console.warn("rh",e);toast("Não foi possível carregar a ficha")}
  finally{R.carregando=false}
  render();
}
async function carregarAniv(){const {data}=await SB.from("v_aniversarios").select("*");R.aniv=data||[];render()}
function abrir(id){R.sel=id;R.aba=admin()?"pdi":"pdi";R.dados=null;S.tab="equipe";render();carregar(id);try{history.replaceState(null,"","#equipe/"+id)}catch(_){}}
function fechar(){R.sel=null;R.dados=null;render();try{history.replaceState(null,"","#equipe")}catch(_){}}

/* ---------- ficha ---------- */
function renderFicha(v){
  const c=R.dados;
  v.replaceChildren();
  v.append(el("div",{class:"crumbs"},el("button",{onclick:fechar},"Equipe"),el("span",{class:"sep"},"›"),el("span",{},c?.nome||"…")));
  if(!c){v.append(el("div",{class:"note"},"Carregando ficha…"));return}
  const podeEditar=admin()||proprio(c);
  const foto=avatar(c,96);const fIn=inp("file","",{accept:"image/*",style:"display:none"});fIn.onchange=()=>enviarFoto(c,fIn.files?.[0]);
  const head=el("div",{class:"card rh-head"},
    el("div",{style:"position:relative"},foto,podeEditar?el("label",{class:"btn sm rh-foto-btn",title:"Trocar foto"},"📷",fIn):null),
    el("div",{style:"min-width:0;flex:1"},el("h1",{style:"margin:0 0 2px"},c.nome,c.apelido?el("span",{class:"note",style:"font-size:15px;font-weight:400"}," · "+c.apelido):null),
      el("div",{class:"sub"},[c.cargo,NUCLEOS()[c.nucleo],c.oab?"OAB "+c.oab:null].filter(Boolean).join(" · ")),
      el("div",{class:"rh-meta"},c.data_admissao?el("span",{},"Desde "+fmtD(c.data_admissao)+" ("+tempoCasa(c.data_admissao)+")"):null,c.cidade?el("span",{},"📍 "+c.cidade):null,c.data_nascimento?el("span",{},"🎂 "+parseD(c.data_nascimento).toLocaleDateString("pt-BR",{day:"2-digit",month:"long"})):null,c.email?el("a",{href:"mailto:"+c.email},c.email):null,c.telefone?el("span",{},c.telefone):null,c.linkedin?el("a",{href:c.linkedin,target:"_blank",rel:"noopener"},"LinkedIn"):null,!c.ativo?el("span",{class:"pill e3"},"inativo"):null),
      c.bio?el("div",{style:"margin-top:8px;white-space:pre-wrap"},c.bio):null,c.responsabilidades?el("div",{class:"note",style:"margin-top:6px"},"Responsabilidades: "+c.responsabilidades):null),
    el("div",{class:"actions"},podeEditar?el("button",{class:"btn sm",onclick:()=>window.PP_EQUIPE?.openColabForm(c)},"Editar dados"):null));
  v.append(head);
  const kp=el("div",{class:"kpis"},[["Horas 30d",(+c.horas_30d||0).toFixed(1).replace(".",",")+"h"],["Tarefas abertas",String(c.tarefas_abertas)],["Registros 30d",String(c.registros_30d)],["PDI em aberto",String(c.pdi_abertos)]].map(([l,x])=>el("div",{class:"card kpi"},el("div",{class:"l"},l),el("div",{class:"v num"},x))));
  v.append(kp);
  const abas=[["pdi","PDI e acompanhamento"]];if(admin())abas.push(["rh","Dados de RH (só sócias)"],["hist","Histórico"]);
  if(abas.length>1)v.append(el("div",{class:"tabs"},abas.map(([k,l])=>el("button",{class:"tab","aria-selected":String(R.aba===k),onclick:()=>{R.aba=k;render()}},l))));
  if(R.aba==="rh"&&admin())renderRH(v,c);else if(R.aba==="hist"&&admin())renderHist(v,c);else renderPDI(v,c);
}
function renderPDI(v,c){
  const podeVer=admin()||proprio(c);
  if(!podeVer){v.append(el("div",{class:"card empty"},"O PDI é visível para a pessoa e para as sócias."));return}
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Plano de desenvolvimento (PDI)"),el("div",{class:"actions"},admin()?el("button",{class:"btn sm primary",onclick:()=>openPdiForm(c,{})},"+ Meta"):null)));
  if(!R.pdi.length)sec.append(el("div",{class:"note"},"Nenhuma meta ainda."+(admin()?" Combine 2–3 metas por ciclo, com prazo e forma de medir.":"")));
  for(const m of R.pdi){
    const cor=m.status==="concluido"?"var(--ok,#2e7d4f)":m.status==="cancelado"?"var(--muted)":"var(--gold)";
    sec.append(el("div",{class:"rh-meta-item"},el("div",{style:"flex:1;min-width:0"},el("div",{class:"n"},m.titulo,el("span",{class:"pill g",style:"margin-left:8px"},PDI_ST[m.status])),m.descricao?el("div",{class:"note",style:"white-space:pre-wrap"},m.descricao):null,
        el("div",{class:"rh-prog"},el("div",{class:"rh-bar"},el("div",{style:`width:${m.progresso}%;background:${cor}`})),el("span",{class:"num"},m.progresso+"%"),m.prazo?el("span",{class:"note"},"até "+fmtD(m.prazo)):null)),
      el("div",{class:"actions",style:"flex-wrap:nowrap"},el("button",{class:"btn sm",onclick:()=>openPdiForm(c,m)},admin()?"Editar":"Atualizar"))));
  }
  v.append(sec);
  const regs=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Acompanhamento (1:1, feedbacks, avaliações)"),el("div",{class:"actions"},admin()?el("button",{class:"btn sm primary",onclick:()=>openRegForm(c)},"+ Registro"):null)));
  if(!R.reg.length)regs.append(el("div",{class:"note"},"Nenhum registro."));
  for(const r of R.reg)regs.append(el("div",{class:"rh-reg"},el("div",{class:"s"},fmtD(r.data)+" · "+(REG[r.tipo]||r.tipo)+(r.pdi_id?" · meta: "+(R.pdi.find(p=>p.id===r.pdi_id)?.titulo||""):"")+(admin()&&!r.visivel_colaborador?" · 🔒 só sócias":"")),el("div",{style:"white-space:pre-wrap"},r.texto),admin()?el("button",{class:"btn sm",style:"margin-top:4px",onclick:async()=>{if(!confirm("Excluir este registro?"))return;await SB.from("pdi_registros").delete().eq("id",r.id);carregar(c.id)}},"Excluir"):null));
  v.append(regs);
}
function openPdiForm(c,m){
  const souAdmin=admin();
  const tit=inp("text",m.titulo||"",{placeholder:"Ex.: Conduzir audiência de conciliação sozinho(a)"}),desc=el("textarea",{rows:"3",placeholder:"Competência, como medir, apoio necessário"},m.descricao||""),prazo=inp("date",m.prazo||""),st=sel(PDI_ST,m.status||"planejado"),prog=inp("range",String(m.progresso||0),{min:0,max:100,step:5});
  const progL=el("span",{class:"num"},(m.progresso||0)+"%");prog.oninput=()=>progL.textContent=prog.value+"%";
  if(!souAdmin){tit.disabled=true;desc.disabled=true;prazo.disabled=true}
  const body=el("div",{class:"form"},field("pdi-tit","Meta",tit),field("pdi-prazo","Prazo",prazo),field("pdi-st","Situação",st),el("div",{class:"f"},el("label",{},"Progresso"),el("div",{style:"display:flex;gap:10px;align-items:center"},prog,progL)),field("pdi-desc","Descrição",desc));
  const extra=m.id&&souAdmin?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir esta meta?"))return;await SB.from("pdi").delete().eq("id",m.id);$("#modalHost").replaceChildren();carregar(c.id)}},"Excluir"):null;
  modal(m.id?(souAdmin?"Editar meta":"Atualizar progresso"):"Nova meta",body,async()=>{
    if(!tit.value.trim())throw new Error("Informe a meta");
    const row=souAdmin?{colaborador_id:c.id,titulo:tit.value.trim(),descricao:desc.value.trim()||null,prazo:prazo.value||null,status:st.value,progresso:+prog.value}:{status:st.value,progresso:+prog.value};
    const {error}=m.id?await SB.from("pdi").update(row).eq("id",m.id):await SB.from("pdi").insert(row);if(error)throw error;
    toast("PDI salvo");carregar(c.id);window.PP_EQUIPE?.recarregar();
  },extra);
}
function openRegForm(c){
  const tipo=sel(REG,"one_on_one"),data=inp("date",new Date().toISOString().slice(0,10)),meta=sel({"":"— geral —",...Object.fromEntries(R.pdi.map(p=>[p.id,p.titulo]))},""),texto=el("textarea",{rows:"5",placeholder:"O que foi conversado, combinados, próximos passos"}),vis=el("input",{type:"checkbox",style:"width:16px;height:16px;accent-color:var(--gold)"});vis.checked=true;
  const body=el("div",{class:"form"},field("rg-tipo","Tipo",tipo),field("rg-data","Data",data),field("rg-meta","Meta relacionada",meta),field("rg-txt","Registro",texto),el("div",{class:"f full"},el("label",{style:"display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px"},vis,"Visível para o(a) colaborador(a)")));
  modal("Novo registro",body,async()=>{if(!texto.value.trim())throw new Error("Escreva o registro");const {error}=await SB.from("pdi_registros").insert({colaborador_id:c.id,pdi_id:meta.value||null,tipo:tipo.value,data:data.value,texto:texto.value.trim(),visivel_colaborador:vis.checked});if(error)throw error;toast("Registro salvo");carregar(c.id)});
}
function renderRH(v,c){
  const r=R.rh||{};
  const info=(l,x)=>el("div",{},el("div",{class:"eyebrow",style:"font-size:10.5px"},l),el("div",{},x||"—"));
  const docs=Array.isArray(r.documentos)?r.documentos:[];
  v.append(el("section",{class:"card section",style:"border-left:3px solid var(--gold)"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Dados de RH"),el("div",{class:"note"},"Visível só para as sócias. Toda alteração fica na auditoria.")),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>openRHForm(c,r)},r.colaborador_id?"Editar dados de RH":"Preencher"))),
    el("div",{style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px"},info("Vínculo",VINCULO[r.vinculo]),info("Salário",brl(r.salario)),info("Jornada",r.jornada),info("Benefícios",r.beneficios),info("CPF",r.cpf),info("RG",r.rg),info("PIS",r.pis),info("Estado civil",r.estado_civil),info("Endereço",r.endereco),info("Contato de emergência",r.contato_emergencia),info("Banco / PIX",r.banco_pix),r.vinculo==="pj"?info("PJ",[r.razao_social_pj,r.cnpj_pj].filter(Boolean).join(" · ")):null),
    r.observacoes?el("div",{class:"note",style:"margin-top:10px;white-space:pre-wrap"},r.observacoes):null,
    el("div",{style:"margin-top:12px"},el("div",{class:"eyebrow",style:"font-size:10.5px"},"Documentos"),docs.length?el("ul",{style:"margin:4px 0 0;padding-left:18px"},docs.map(d=>el("li",{},el("a",{href:d.url,target:"_blank",rel:"noopener",style:"color:var(--info)"},d.titulo||d.url)))):el("div",{class:"note"},"Nenhum link (contrato, RG, comprovantes… no Drive)."))));
}
function openRHForm(c,r){
  const f={cpf:inp("text",r.cpf||""),rg:inp("text",r.rg||""),pis:inp("text",r.pis||""),estado_civil:inp("text",r.estado_civil||""),endereco:inp("text",r.endereco||""),contato_emergencia:inp("text",r.contato_emergencia||"",{placeholder:"Nome · telefone"}),vinculo:sel({"":"—",...VINCULO},r.vinculo||""),jornada:inp("text",r.jornada||"",{placeholder:"44h, 30h…"}),salario:inp("number",r.salario??"",{step:"0.01",min:0}),beneficios:inp("text",r.beneficios||"",{placeholder:"VR, VT, plano…"}),cnpj_pj:inp("text",r.cnpj_pj||""),razao_social_pj:inp("text",r.razao_social_pj||""),banco_pix:inp("text",r.banco_pix||""),observacoes:el("textarea",{rows:"3"},r.observacoes||"")};
  const docs=Array.isArray(r.documentos)?[...r.documentos]:[];const lista=el("div",{});
  const rl=()=>{lista.replaceChildren(...docs.map((d,i)=>el("div",{style:"display:flex;gap:6px;align-items:center;margin:2px 0"},el("span",{style:"flex:1"},d.titulo||d.url),el("button",{class:"btn sm",onclick:()=>{docs.splice(i,1);rl()}},"×"))))};rl();
  const dt=inp("text","",{placeholder:"Título (ex.: Contrato de trabalho)"}),du=inp("url","",{placeholder:"https://drive.google.com/…"});
  const body=el("div",{class:"form"},field("rh-vinc","Vínculo",f.vinculo),field("rh-sal","Salário (R$)",f.salario),field("rh-jor","Jornada",f.jornada),field("rh-ben","Benefícios",f.beneficios),field("rh-cpf","CPF",f.cpf),field("rh-rg","RG",f.rg),field("rh-pis","PIS",f.pis),field("rh-ec","Estado civil",f.estado_civil),field("rh-end","Endereço",f.endereco),field("rh-em","Contato de emergência",f.contato_emergencia),field("rh-pix","Banco / PIX",f.banco_pix),field("rh-cnpj","CNPJ (PJ)",f.cnpj_pj),field("rh-rs","Razão social (PJ)",f.razao_social_pj),field("rh-obs","Observações",f.observacoes),
    el("div",{class:"f full"},el("label",{},"Documentos (links)"),lista,el("div",{style:"display:flex;gap:6px;margin-top:4px"},dt,du,el("button",{class:"btn sm",onclick:()=>{if(!du.value.trim())return;docs.push({titulo:dt.value.trim()||du.value.trim(),url:du.value.trim()});dt.value="";du.value="";rl()}},"Adicionar"))));
  modal("Dados de RH — "+c.nome,body,async()=>{
    const row={colaborador_id:c.id,documentos:docs};for(const [k,i] of Object.entries(f))row[k]=k==="salario"?(i.value===""?null:+i.value):(i.value.trim()||null);
    const {error}=await SB.from("colaboradores_rh").upsert(row,{onConflict:"colaborador_id"});if(error)throw error;toast("Dados de RH salvos");carregar(c.id);
  });
}
function renderHist(v,c){
  const sec=el("section",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Histórico"),el("div",{class:"actions"},el("button",{class:"btn sm primary",onclick:()=>openHistForm(c)},"+ Registro"))));
  if(!R.hist.length)sec.append(el("div",{class:"note"},"Nada registrado. Admissão, reajustes, promoções, férias, feedbacks formais, advertências."));
  for(const h of R.hist)sec.append(el("div",{class:"rh-reg"},el("div",{class:"s"},fmtD(h.data)+" · "+(HIST[h.tipo]||h.tipo)+(h.valor!=null?" · "+brl(h.valor):"")),h.descricao?el("div",{style:"white-space:pre-wrap"},h.descricao):null,el("button",{class:"btn sm",style:"margin-top:4px",onclick:async()=>{if(!confirm("Excluir?"))return;await SB.from("colaboradores_historico").delete().eq("id",h.id);carregar(c.id)}},"Excluir")));
  v.append(sec);
}
function openHistForm(c){
  const tipo=sel(HIST,"feedback"),data=inp("date",new Date().toISOString().slice(0,10)),valor=inp("number","",{step:"0.01",placeholder:"novo salário, se reajuste"}),desc=el("textarea",{rows:"4"});
  modal("Novo registro no histórico",el("div",{class:"form"},field("h-tipo","Tipo",tipo),field("h-data","Data",data),field("h-val","Valor (R$)",valor),field("h-desc","Descrição",desc)),async()=>{const {error}=await SB.from("colaboradores_historico").insert({colaborador_id:c.id,tipo:tipo.value,data:data.value,valor:valor.value?+valor.value:null,descricao:desc.value.trim()||null});if(error)throw error;toast("Registrado");carregar(c.id)});
}

/* ---------- aniversariantes (na tela Equipe) ---------- */
function cardAniversarios(){
  if(!R.aniv){carregarAniv();return null}
  const mes=new Date().getMonth()+1;const hoje=new Date().getDate();
  const ds=R.aniv.filter(a=>a.mes===mes).sort((a,b)=>a.dia-b.dia);if(!ds.length)return null;
  return el("div",{class:"card section",style:"display:flex;gap:14px;flex-wrap:wrap;align-items:center"},el("b",{},"🎂 Aniversariantes do mês:"),ds.map(a=>el("button",{class:"rh-aniv",onclick:()=>abrir(a.id)},avatar(a,28),el("span",{},(a.apelido||a.nome.split(" ")[0])+" · "+String(a.dia).padStart(2,"0")+(a.dia===hoje?" 🎉":"")))));
}

/* ---------- integração ---------- */
const CSS=`.rh-avatar{border-radius:50%;background:var(--surface-2) center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--gold);border:2px solid var(--line);flex:none}.rh-foto-btn{position:absolute;right:-4px;bottom:-4px;cursor:pointer;padding:2px 6px}.rh-head{display:flex;gap:18px;align-items:flex-start;padding:18px}.rh-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-top:6px}.rh-meta a{color:var(--info)}
.rh-meta-item{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}.rh-meta-item .n{font-weight:700}.rh-prog{display:flex;gap:10px;align-items:center;margin-top:6px;font-size:12.5px}.rh-bar{flex:1;max-width:320px;height:8px;border-radius:4px;background:var(--line);overflow:hidden}.rh-bar>div{height:100%;transition:width .3s}
.rh-reg{padding:10px 0;border-top:1px solid var(--line)}.rh-reg .s{font-size:12px;color:var(--muted);margin-bottom:3px}.rh-aniv{display:inline-flex;gap:8px;align-items:center;background:var(--surface-2);border:1px solid var(--line);border-radius:20px;padding:3px 10px 3px 3px;cursor:pointer;font-size:13px;color:var(--text)}
@media (max-width:860px){.rh-head{flex-direction:column;align-items:center;text-align:center}.rh-meta{justify-content:center}}`;
document.head.append(el("style",{},CSS));
window.PP_RH={abrir,invalidar(){R.dados=null;R.aniv=null;if(R.sel)carregar(R.sel)}};
{const _r=render;render=function(){_r();const ve=$("#view-equipe");if(!ve||S.tab!=="equipe")return;
  if(R.sel){renderFicha(ve);const h="#equipe/"+R.sel;if(location.hash!==h){try{history.replaceState(null,"",h)}catch(_){}}return}
  const an=cardAniversarios();if(an){const kp=ve.querySelector(".kpis");if(kp)kp.before(an)}}}
// rota #equipe/<id>
{const _a=window.aplicarHash;if(typeof _a==="function")window.aplicarHash=function(){const r=_a();const [tab,id]=(location.hash||"").slice(1).split("/");if(tab==="equipe"){if(id&&id!==R.sel){R.sel=id;R.dados=null;carregar(id)}else if(!id&&R.sel){R.sel=null;R.dados=null}}return r}}
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){const [tab,id]=(location.hash||"").slice(1).split("/");if(tab==="equipe"&&id)abrir(id)}});
})();
