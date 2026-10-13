/* Meu perfil — para toda a equipe: foto, dados pessoais/contato (edita os próprios), troca de senha, áreas de acesso.
   Supabase: v_colaboradores (política colab_self), bucket 'fotos', auth.updateUser. */
(()=>{
"use strict";
const M={dados:null,carregando:false,fotoUrl:null};
const AREAS={clientes:"Clientes",juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",equipe:"Equipe",growth:"Growth"};
async function carregar(){
  if(M.carregando)return;M.carregando=true;
  try{const {data}=await SB.from("v_colaboradores").select("*").eq("perfil_id",PP.perfil.id).maybeSingle();M.dados=data||null;
    if(M.dados?.foto_path){const {data:s}=await SB.storage.from("fotos").createSignedUrl(M.dados.foto_path,3600);M.fotoUrl=s?.signedUrl||null}else M.fotoUrl=null}
  catch(e){console.warn("perfil",e)}finally{M.carregando=false}
  render();
}
async function enviarFoto(file){
  const c=M.dados;if(!c||!file)return;if(file.size>5*1024*1024){toast("Foto acima de 5 MB");return}
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(file)});
  const cv=document.createElement("canvas");const esc=Math.min(1,512/Math.max(img.width,img.height));cv.width=Math.round(img.width*esc);cv.height=Math.round(img.height*esc);cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
  const blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",0.86));const path=`colaboradores/${c.id}.jpg`;
  const {error}=await SB.storage.from("fotos").upload(path,blob,{upsert:true,contentType:"image/jpeg"});if(error){toast("Não foi possível enviar a foto");return}
  const r=await SB.from("colaboradores").update({foto_path:path}).eq("id",c.id);if(r.error){toast("Foto enviada, mas não gravada");return}
  toast("Foto atualizada");M.dados=null;window.PP_EQUIPE?.recarregar();window.PP_RH?.invalidar();carregar();
}
function renderPerfil(){
  const v=$("#view-perfil");v.replaceChildren();
  const p=PP.perfil||{};const areas=p.papel==="admin"?Object.values(AREAS):(p.acessos||[]).map(a=>AREAS[a]||a);
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Minha conta"),el("h1",{},"Meu perfil"),el("div",{class:"sub"},"Seus dados, foto e senha. Cargo, núcleo e datas de admissão só a administração altera."))));
  if(M.dados===null&&!M.carregando){carregar()}
  const c=M.dados;
  if(c===undefined||M.carregando){v.append(el("div",{class:"note"},"Carregando…"));return}
  const foto=el("div",{style:"width:112px;height:112px;border-radius:50%;background:var(--surface-2) center/cover no-repeat;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:36px;color:var(--muted);flex:none"+(M.fotoUrl?`;background-image:url("${M.fotoUrl}")`:"")},M.fotoUrl?"":((c?.nome||p.nome||"?").trim()[0]||"?").toUpperCase());
  const file=el("input",{type:"file",accept:"image/*",style:"display:none"});file.onchange=()=>enviarFoto(file.files[0]);
  const kv=(k,val)=>el("div",{class:"kv"},el("div",{class:"k"},k),el("div",{class:"v"},val||el("span",{class:"note"},"—")));
  const card=el("section",{class:"card section"},
    el("div",{style:"display:flex;gap:20px;align-items:center;flex-wrap:wrap"},foto,el("div",{style:"flex:1;min-width:220px"},el("h2",{},c?.nome||p.nome||p.email),el("div",{class:"note"},[c?.cargo,c?.nucleo?window.PP_EQUIPE?.NUCLEOS?.[c.nucleo]||c.nucleo:null].filter(Boolean).join(" · ")||"Sem cargo definido"),el("div",{class:"note"},p.email),
      el("div",{style:"margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"},c?el("button",{class:"btn sm",onclick:()=>file.click()},M.fotoUrl?"Trocar foto":"Enviar foto"):null,c?el("button",{class:"btn sm primary",onclick:()=>window.PP_EQUIPE?.openColabForm(c)},"Editar meus dados"):null,file))),
    c?el("div",{class:"ct-b",style:"padding:0;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:16px"},kv("Apelido",c.apelido),kv("Telefone",c.telefone),kv("WhatsApp",c.whatsapp),kv("Cidade",c.cidade),kv("Aniversário",c.data_nascimento?fmtD(parseD(c.data_nascimento)):null),kv("Admissão",c.data_admissao?fmtD(parseD(c.data_admissao)):null),kv("LinkedIn",c.linkedin?el("a",{href:c.linkedin,target:"_blank",rel:"noopener",style:"color:var(--info)"},"abrir"):null),kv("Resumo diário",c.resumo_diario?({discord:"Discord",whatsapp:"WhatsApp",ambos:"Discord e WhatsApp"})[c.canal_resumo||"discord"]:"desligado"),kv("Agenda Google",c.agenda_sync?"sincronizando":"não ligada"))
     :el("div",{class:"note",style:"margin-top:12px"},"Seu usuário ainda não está vinculado a um registro de colaborador — peça à administração para vincular em Equipe → Colaboradores."),
    c?.bio?el("div",{class:"note",style:"margin-top:10px;white-space:pre-wrap"},c.bio):null);
  v.append(card);
  // acessos
  v.append(el("section",{class:"card section"},el("h2",{},"Meu acesso"),el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"},el("span",{class:"pill e1"},p.papel==="admin"?"Administrador(a)":"Colaborador(a)"),...areas.map(a=>el("span",{class:"pill g"},a))),el("div",{class:"note",style:"margin-top:8px"},"Tarefas, Agenda e Meu painel são de todos. Para mudar as áreas, fale com a administração.")));
  // senha
  const s1=inp("password","",{autocomplete:"new-password",placeholder:"mínimo 8 caracteres"}),s2=inp("password","",{autocomplete:"new-password"}),msg=el("div",{class:"note"});
  const btn=el("button",{class:"btn primary",onclick:async()=>{
    if(s1.value.length<8){msg.textContent="A senha precisa ter pelo menos 8 caracteres.";msg.className="note";msg.style.color="var(--crit)";return}
    if(s1.value!==s2.value){msg.textContent="As duas senhas não conferem.";msg.style.color="var(--crit)";return}
    btn.disabled=true;const {error}=await SB.auth.updateUser({password:s1.value});btn.disabled=false;
    if(error){msg.textContent="Não foi possível trocar: "+(error.message||"");msg.style.color="var(--crit)";return}
    s1.value=s2.value="";msg.textContent="Senha alterada. Use a nova senha no próximo login.";msg.style.color="var(--ok)";toast("Senha alterada");
  }},"Trocar senha");
  v.append(el("section",{class:"card section"},el("h2",{},"Trocar senha"),el("div",{class:"form",style:"margin-top:8px"},field("pf-s1","Nova senha",s1),field("pf-s2","Repita a nova senha",s2)),el("div",{style:"display:flex;gap:10px;align-items:center;margin-top:8px"},btn,msg)));
}
{const _r=render;render=function(){_r();const v=$("#view-perfil");if(!v)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="perfil")S.tab="clientes";v.hidden=S.tab!=="perfil";if(S.tab==="perfil")renderPerfil()}}
window.PP_PERFIL={recarregar(){M.dados=null;carregar()}};
window.__PP_LOGIN?.then(()=>{if(typeof equipe==="function"&&equipe()){SB.channel("perfil-proprio").on("postgres_changes",{event:"UPDATE",schema:"public",table:"colaboradores"},()=>{if(S.tab==="perfil"){M.dados=null;carregar()}}).subscribe()}});
})();
