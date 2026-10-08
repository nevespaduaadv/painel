/* Módulo Equipe (colaboradores — RH básico). Supabase: colaboradores, v_colaboradores, v_perfis_sem_colaborador.
   Carregado depois de tarefas.js; usa os utilitários globais do painel. Cadastro: admin; leitura: equipe. */
(()=>{
"use strict";
const NUCLEOS={juridico:"Jurídico",acordos:"Acordos",acompanhamento_pj:"Acompanhamento PJ",pos_vendas:"Pós-vendas",comercial:"Comercial",marketing:"Marketing",administrativo:"Administrativo",rh:"RH",socios:"Sócios"};
const PAPEIS={admin:"Administrador",colaborador:"Colaborador"};
const E={lista:[],semColab:[],ok:false,carregando:false,mostrarInativos:false};
const horasFmt=h=>{h=+h||0;const hh=Math.floor(h),mm=Math.round((h-hh)*60);return mm?`${hh}h${String(mm).padStart(2,"0")}`:`${hh}h`};
const admin=()=>PP.perfil?.papel==="admin";

async function carregar(){
  if(E.carregando)return;E.carregando=true;
  try{
    const [c,p]=await Promise.all([SB.from("v_colaboradores").select("*").order("ativo",{ascending:false}).order("nome"),admin()?SB.from("v_perfis_sem_colaborador").select("*").order("email"):{data:[]}]);
    if(c.error)throw c.error;E.lista=c.data;E.semColab=p.data||[];E.ok=true;
  }catch(e){console.warn("equipe",e);toast("Não foi possível carregar a equipe")}
  finally{E.carregando=false}
  render();
}
const garantir=()=>{if(!E.ok&&!E.carregando)carregar();return E.ok};
function csv(nome,linhas,colunas){
  const esc=v=>{if(v==null)return"";v=String(v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const txt="﻿"+[colunas.join(";"),...linhas.map(l=>colunas.map(c=>esc(l[c])).join(";"))].join("\r\n");
  const a=el("a",{href:URL.createObjectURL(new Blob([txt],{type:"text/csv;charset=utf-8"})),download:nome+".csv"});document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
const check=(label,checked)=>{const i=el("input",{type:"checkbox",style:"width:16px;height:16px;flex:none;margin:0;accent-color:var(--gold)"});i.checked=!!checked;return {wrap:el("div",{class:"f",style:"justify-content:center"},el("label",{style:"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg);cursor:pointer;min-height:38px"},i,label)),input:i}};

function renderEquipe(){
  const v=$("#view-equipe");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Escritório"),el("h1",{},"Equipe"),el("div",{class:"sub"},"Quem é quem, em qual núcleo, com qual usuário — base dos relatórios de produtividade.")),
    el("div",{class:"actions"},el("button",{class:"btn sm",onclick:()=>csv("equipe",E.lista,["nome","cargo","nucleo","data_admissao","data_desligamento","email","telefone","oab","login_email","login_papel","ativo","responsabilidades"])},"CSV"),admin()?el("button",{class:"btn primary",onclick:()=>openColabForm({})},"+ Colaborador"):null)));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  if(admin()&&E.semColab.length)v.append(el("div",{class:"card section",style:"border-left:3px solid var(--warn)"},el("div",{},el("b",{},`${E.semColab.length} usuário${E.semColab.length===1?"":"s"} da equipe sem cadastro de colaborador: `),E.semColab.map(p=>p.email).join(" · ")),el("div",{class:"actions",style:"justify-content:flex-start"},E.semColab.map(p=>el("button",{class:"btn sm",onclick:()=>openColabForm({perfil_id:p.id,nome:p.nome||"",email:p.email})},"Cadastrar "+(p.nome||p.email))))));
  const ativos=E.lista.filter(c=>c.ativo),inativos=E.lista.filter(c=>!c.ativo);
  const porNucleo=new Map();for(const c of ativos){const k=c.nucleo||"";porNucleo.set(k,(porNucleo.get(k)||0)+1)}
  v.append(el("div",{class:"kpis"},el("div",{class:"card kpi"},el("div",{class:"l"},"Ativos"),el("div",{class:"v num"},String(ativos.length)),el("div",{class:"h"},`${inativos.length} inativo${inativos.length===1?"":"s"}`)),
    ...[...porNucleo.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>el("div",{class:"card kpi"},el("div",{class:"l"},NUCLEOS[k]||"Sem núcleo"),el("div",{class:"v num"},String(n)),el("div",{class:"h"},"")))));
  const tog=check("Mostrar inativos",E.mostrarInativos);tog.input.onchange=()=>{E.mostrarInativos=tog.input.checked;render()};tog.wrap.className="";
  const lista=E.mostrarInativos?E.lista:ativos;
  const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"Nome"),el("th",{},"Cargo"),el("th",{},"Núcleo"),el("th",{},"Admissão"),el("th",{},"Usuário"),el("th",{class:"r"},"Horas 30d"),el("th",{class:"r"},"Registros 30d"),el("th",{class:"r"},"Tarefas"),el("th",{class:"r"},"Processos"),el("th",{},""))),
    el("tbody",{},lista.length?lista.map(c=>el("tr",{style:c.ativo?"":"opacity:.6"},
      el("td",{},el("b",{},c.nome),c.ativo?null:el("span",{class:"pill g",style:"margin-left:6px"},"inativo"),c.responsabilidades?el("div",{class:"note"},c.responsabilidades.slice(0,90)+(c.responsabilidades.length>90?"…":"")):null),
      el("td",{},c.cargo||"—",c.oab?el("div",{class:"note"},"OAB "+c.oab):null),el("td",{},NUCLEOS[c.nucleo]||"—"),el("td",{},c.data_admissao?fmtD(parseD(c.data_admissao)):"—",c.data_desligamento?el("div",{class:"note"},"saída "+fmtD(parseD(c.data_desligamento))):null),
      el("td",{},c.login_email?el("span",{},c.login_email,el("div",{class:"note"},PAPEIS[c.login_papel]||c.login_papel)):el("span",{class:"pill e2"},"sem login")),
      el("td",{class:"r num"},horasFmt(c.horas_30d)),el("td",{class:"r num"},String(c.registros_30d)),el("td",{class:"r num"},String(c.tarefas_abertas),c.tarefas_atrasadas>0?el("span",{class:"pill e3",style:"margin-left:4px"},c.tarefas_atrasadas+" atras."):null),el("td",{class:"r num"},String(c.processos_ativos)),
      el("td",{},(admin()||c.perfil_id===PP.perfil?.id)?el("button",{class:"btn sm",onclick:()=>openColabForm(c)},"Editar"):null))):el("tr",{},el("td",{colspan:10,class:"note"},"Nenhum colaborador cadastrado. Use “+ Colaborador” ou cadastre a partir dos usuários acima."))));
  v.append(el("div",{class:"card section"},el("div",{class:"section-h"},el("h2",{},"Colaboradores"),tog.wrap),el("div",{class:"tbl"},tb)));
}
function openColabForm(c={}){
  const souAdmin=admin(),proprio=c.perfil_id&&c.perfil_id===PP.perfil?.id;
  const nome=inp("text",c.nome||""),cargo=inp("text",c.cargo||"",{placeholder:"Ex.: Advogada, Assistente jurídico"}),nuc=sel({"":"—",...NUCLEOS},c.nucleo||""),adm=inp("date",c.data_admissao||""),desl=inp("date",c.data_desligamento||""),
        email=inp("email",c.email||""),tel=inp("text",c.telefone||""),oab=inp("text",c.oab||"",{placeholder:"Ex.: 123456/SP"}),resp=el("textarea",{placeholder:"O que esta pessoa cuida no dia a dia."},c.responsabilidades||""),ativo=check("Ativo",c.ativo!==false);
  const opcoesPerfil={"":"— sem usuário —",...Object.fromEntries(E.semColab.map(p=>[p.id,`${p.email}${p.nome?" · "+p.nome:""}`]))};
  if(c.perfil_id&&!opcoesPerfil[c.perfil_id])opcoesPerfil[c.perfil_id]=c.login_email||"(usuário vinculado)";
  const perfil=sel(opcoesPerfil,c.perfil_id||"");
  const ro=!souAdmin;if(ro){for(const i of [cargo,nuc,adm,desl,oab,resp,perfil,ativo.input])i.disabled=true}
  const body=el("div",{class:"form"},field("co-nome","Nome",nome),field("co-cargo","Cargo",cargo),field("co-nuc","Núcleo",nuc),field("co-adm","Data de admissão",adm),field("co-desl","Data de desligamento",desl),
    field("co-email","E-mail",email),field("co-tel","Telefone",tel),field("co-oab","OAB",oab),field("co-perfil","Usuário do sistema",perfil,souAdmin?"Só aparecem usuários da equipe ainda sem colaborador. Crie o usuário no Supabase e defina o perfil na aba Usuários.":null),ativo.wrap,field("co-resp","Responsabilidades",resp));
  const extra=(c.id&&souAdmin)?el("button",{class:"btn danger",onclick:async()=>{if(!confirmInline(body,"Excluir este colaborador? Horas e tarefas dele perdem o vínculo."))return;const {error}=await SB.from("colaboradores").delete().eq("id",c.id);$("#modalHost").replaceChildren();toast(error?"Não foi possível excluir (há registros vinculados? prefira inativar)":"Colaborador excluído");E.ok=false;garantir()}},"Excluir"):null;
  modal(c.id?"Editar colaborador":"Novo colaborador",body,async()=>{
    if(!nome.value.trim())throw new Error("Informe o nome");
    const row=ro?{nome:nome.value.trim(),email:email.value.trim()||null,telefone:tel.value.trim()||null}
      :{nome:nome.value.trim(),cargo:cargo.value.trim()||null,nucleo:nuc.value||null,data_admissao:adm.value||null,data_desligamento:desl.value||null,email:email.value.trim()||null,telefone:tel.value.trim()||null,oab:oab.value.trim()||null,responsabilidades:resp.value.trim()||null,perfil_id:perfil.value||null,ativo:ativo.input.checked&&!desl.value};
    const {error}=c.id?await SB.from("colaboradores").update(row).eq("id",c.id):await SB.from("colaboradores").insert(row);
    if(error)throw new Error(error.code==="23505"?"Este usuário já está vinculado a outro colaborador":"Não foi possível salvar");
    toast("Colaborador salvo");E.ok=false;garantir();
  },extra);
}

/* ---------- Integração ---------- */
{const _r=render;render=function(){_r();const ve=$("#view-equipe");if(!ve)return;const eq=typeof equipe==="function"&&equipe();if(!eq&&S.tab==="equipe")S.tab="clientes";ve.hidden=S.tab!=="equipe";if(S.tab==="equipe")renderEquipe()}}
window.__PP_LOGIN.then(()=>{if(equipe()){const ch=SB.channel("equipe");ch.on("postgres_changes",{event:"*",schema:"public",table:"colaboradores"},()=>{E.ok=false;if(S.tab==="equipe")garantir()});ch.subscribe()}});
})();
