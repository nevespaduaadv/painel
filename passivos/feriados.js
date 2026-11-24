/* Jurídico → Feriados e prazos: cadastro de feriados (nacional / forense / estadual / municipal) e suspensões de prazo (recesso, art. 220 CPC).
   Equipe lê; admin edita (políticas de 0037). O cálculo de prazos (prazos.js) recarrega após cada alteração. */
(()=>{
"use strict";
const F={ok:false,carregando:false,feriados:[],susp:[],ano:new Date().getFullYear(),uf:"",tab:"feriados"};
const ehAdmin=()=>PP.perfil?.papel==="admin";
const TIPO={nacional:"Nacional",forense:"Forense (tribunais)",estadual:"Estadual",municipal:"Municipal / comarca"};
const UFS=["","AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const fmtBR=s=>s?new Date(s+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"}):"—";
async function carregar(){
  if(F.carregando)return;F.carregando=true;
  try{const [f,s]=await Promise.all([SB.from("feriados").select("*").order("data"),SB.from("suspensoes_prazo").select("*").order("inicio")]);if(f.error)throw f.error;F.feriados=f.data||[];F.susp=s.data||[];F.ok=true}
  catch(e){console.warn("feriados",e);toast("Não foi possível carregar os feriados")}
  finally{F.carregando=false}
  if(S.tab==="feriados")render();
}
function garantir(){if(!F.ok&&!F.carregando)carregar();return F.ok}
async function salvo(){F.ok=false;await carregar();try{window.PP_PRAZOS?.recarregar?.()}catch(_){}}

const feV3=()=>document.documentElement.classList.contains("np-casca-v3")&&!!window.NPUI;
const TIPO_TOM={nacional:"crit",forense:"att",estadual:"info",municipal:"ok"};

function formFeriado(f={}){
  const data=inp("date",f.data||`${F.ano}-01-01`),nome=inp("text",f.nome||"",{placeholder:"Ex.: Aniversário da cidade"});
  const tipo=sel(TIPO,f.tipo||"municipal"),uf=sel(Object.fromEntries(UFS.map(u=>[u,u||"—"])),f.uf||"SP"),comarca=inp("text",f.comarca||"",{placeholder:"Ex.: Franca"});
  const ativo=el("input",{type:"checkbox",checked:f.ativo===false?null:""});
  const ajusta=()=>{const t=tipo.value;uf.disabled=t==="nacional"||t==="forense";comarca.disabled=t!=="municipal";};tipo.onchange=ajusta;ajusta();
  const body=el("div",{class:"grid2"},field("fe-data","Data",data),field("fe-nome","Nome",nome),field("fe-tipo","Abrangência",tipo,"Nacional/forense valem para todos os tribunais; estadual só para a UF; municipal só para a comarca informada."),field("fe-uf","UF",uf),field("fe-com","Comarca",comarca),el("div",{class:"f"},el("label",{style:"display:inline-flex;gap:8px;align-items:center;margin-top:22px"},ativo," Ativo (conta no cálculo)")));
  const execExcluir=async()=>{const {error}=await SB.from("feriados").delete().eq("id",f.id);if(error){toast("Não foi possível excluir");throw error}$("#modalHost").replaceChildren();toast("Excluído");await salvo()};
  modal(f.id?"Editar feriado":"Novo feriado",body,async()=>{
    if(!data.value||!nome.value.trim())throw new Error("Informe data e nome");
    const t=tipo.value;const reg={data:data.value,nome:nome.value.trim(),tipo:t,uf:t==="nacional"||t==="forense"?null:(uf.value||null),comarca:t==="municipal"?(comarca.value.trim()||null):null,ativo:ativo.checked};
    if(t==="municipal"&&(!reg.uf||!reg.comarca))throw new Error("Feriado municipal precisa de UF e comarca");
    if(t==="estadual"&&!reg.uf)throw new Error("Feriado estadual precisa de UF");
    const q=f.id?SB.from("feriados").update(reg).eq("id",f.id):SB.from("feriados").insert(reg);const {error}=await q;
    if(error)throw new Error(/duplicate|unique/i.test(error.message)?"Já existe um feriado igual nessa data":error.message);
    toast("Feriado salvo");await salvo();
  },f.id&&ehAdmin()?el("button",{class:"btn danger",onclick:()=>{
    npConfirmar({titulo:"Excluir feriado?",mensagem:`Remover “${f.nome}” (${fmtBR(f.data)})? A contagem de prazos processuais será recalculada.`,confirmar:"Excluir feriado",perigo:true,onSim:execExcluir});
  }},"Excluir"):null);
}
function formSusp(s={}){
  const ini=inp("date",s.inicio||`${F.ano}-12-20`),fim=inp("date",s.fim||`${F.ano+1}-01-20`),motivo=inp("text",s.motivo||"",{placeholder:"Ex.: Recesso forense (art. 220 CPC)"}),uf=sel(Object.fromEntries(UFS.map(u=>[u,u||"Todos os tribunais"])),s.uf||"");
  const ativo=el("input",{type:"checkbox",checked:s.ativo===false?null:""});
  const body=el("div",{class:"grid2"},field("su-ini","Início",ini),field("su-fim","Fim",fim),field("su-mot","Motivo",motivo),field("su-uf","Abrangência",uf,"Vazio = vale para todos os tribunais."),el("div",{class:"f"},el("label",{style:"display:inline-flex;gap:8px;align-items:center;margin-top:22px"},ativo," Ativa")));
  const execExcluir=async()=>{const {error}=await SB.from("suspensoes_prazo").delete().eq("id",s.id);if(error){toast("Não foi possível excluir");throw error}$("#modalHost").replaceChildren();toast("Excluída");await salvo()};
  modal(s.id?"Editar suspensão de prazo":"Nova suspensão de prazo",body,async()=>{
    if(!ini.value||!fim.value||!motivo.value.trim())throw new Error("Informe início, fim e motivo");if(fim.value<ini.value)throw new Error("O fim é anterior ao início");
    const reg={inicio:ini.value,fim:fim.value,motivo:motivo.value.trim(),uf:uf.value||null,ativo:ativo.checked};
    const q=s.id?SB.from("suspensoes_prazo").update(reg).eq("id",s.id):SB.from("suspensoes_prazo").insert(reg);const {error}=await q;if(error)throw new Error(error.message);
    toast("Suspensão salva");await salvo();
  },s.id&&ehAdmin()?el("button",{class:"btn danger",onclick:()=>{
    npConfirmar({titulo:"Excluir suspensão de prazo?",mensagem:`Remover “${s.motivo}” (${fmtBR(s.inicio)} → ${fmtBR(s.fim)})? A contagem de prazos processuais será recalculada.`,confirmar:"Excluir suspensão",perigo:true,onSim:execExcluir});
  }},"Excluir"):null);
}

function renderFeriadosV3(v){
  v.classList.add("np-v3");
  const anos=[...new Set([F.ano,...F.feriados.map(f=>+f.data.slice(0,4)),...F.susp.map(s=>+s.inicio.slice(0,4))])].sort();
  const selAno=el("select",{class:"np-tb-sel","aria-label":"Ano"},...anos.map(a=>el("option",{value:String(a),selected:String(F.ano)===String(a)?"":null},String(a))));
  selAno.onchange=()=>{F.ano=+selAno.value;render()};
  const selUf=el("select",{class:"np-tb-sel","aria-label":"UF"},...UFS.map(u=>el("option",{value:u,selected:F.uf===u?"":null},u||"Todas as UFs")));
  selUf.onchange=()=>{F.uf=selUf.value;render()};

  const listaF=F.feriados.filter(f=>f.data.startsWith(String(F.ano))&&(!F.uf||!f.uf||f.uf===F.uf));
  const listaS=F.susp.filter(s=>s.inicio.startsWith(String(F.ano))||s.fim.startsWith(String(F.ano)));
  const kp=t=>listaF.filter(f=>f.tipo===t&&f.ativo!==false).length;

  const segTabs=NPUI.seg([["feriados","Feriados"],["susp","Suspensões de prazo"]],F.tab,k=>{F.tab=k;render()},"Feriados ou suspensões");
  const resumoItens=F.tab==="feriados"
    ?[{n:kp("nacional"),label:"nacionais"},{n:kp("forense"),label:"forenses"},{n:kp("estadual"),label:"estaduais"},{n:kp("municipal"),label:"municipais"}]
    :[{n:listaS.length,label:listaS.length===1?"suspensão":"suspensões"}];

  v.append(NPUI.toolbar({
    resumo:NPUI.resumo(resumoItens),
    direita:[
      segTabs,
      selAno,
      selUf,
      ehAdmin()?NPUI.btn("+ Suspensão",{onclick:()=>formSusp({})}):null,
      ehAdmin()?NPUI.btn("+ Feriado",{variante:"pri",onclick:()=>formFeriado({})}):null
    ].filter(Boolean)
  }));

  if(!garantir()){v.append(NPUI.carregando(5));return}

  if(F.tab==="feriados"){
    if(!listaF.length){
      v.append(NPUI.vazio({titulo:"Nenhum feriado neste filtro",texto:"Ajuste o ano ou a UF acima, ou cadastre um novo feriado."}));
    }else{
      const rows=listaF.map(f=>{
        const local=[f.uf,f.comarca].filter(Boolean).join(" · ")||"Todos os tribunais";
        const p=NPUI.prazoTxt?NPUI.prazoTxt(f.data):{curta:f.data.slice(5).split("-").reverse().join("/"),exata:fmtBR(f.data)};
        return NPUI.linha({
          id:String(f.id||f.data+f.nome),
          prazo:{curta:p.curta,exata:fmtBR(f.data)},
          titulo:f.nome,
          contexto:[fmtBR(f.data),local].join(" · "),
          direita:[
            f.ativo===false?NPUI.marca("Inativo",""):null,
            NPUI.marca(TIPO[f.tipo]||f.tipo,TIPO_TOM[f.tipo]||"")
          ].filter(Boolean),
          onOpen:ehAdmin()?()=>formFeriado(f):undefined
        });
      });
      v.append(NPUI.grupo({id:"fe-lista",titulo:`Feriados em ${F.ano}${F.uf?" · "+F.uf:""}`,n:rows.length,itens:rows}));
    }
  }else{
    if(!listaS.length){
      v.append(NPUI.vazio({titulo:"Nenhuma suspensão neste ano",texto:"Cadastre recesso forense ou suspensões locais (art. 220 CPC)."}));
    }else{
      const rows=listaS.map(s=>{
        const p=NPUI.prazoTxt?NPUI.prazoTxt(s.inicio):{curta:s.inicio};
        return NPUI.linha({
          id:String(s.id||s.inicio+s.motivo),
          prazo:{curta:p.curta,exata:`${fmtBR(s.inicio)} → ${fmtBR(s.fim)}`},
          titulo:s.motivo,
          contexto:[`${fmtBR(s.inicio)} → ${fmtBR(s.fim)}`,s.uf||"Todos os tribunais"].join(" · "),
          direita:[s.ativo===false?NPUI.marca("Inativa",""):NPUI.marca("Ativa","ok")],
          onOpen:ehAdmin()?()=>formSusp(s):undefined
        });
      });
      v.append(NPUI.grupo({id:"fe-susp",titulo:`Suspensões de prazo em ${F.ano}`,n:rows.length,itens:rows}));
    }
  }

  v.append(el("p",{class:"np-calc-nota np-form-leitura"},"Regra de contagem (CPC 219/220/224): publicação no DJEN é considerada publicada no 1º dia útil seguinte; o prazo inicia no dia útil subsequente; dias úteis excluem sábados, domingos, feriados e suspensões. "+(ehAdmin()?"Clique em uma linha para editar.":"Para incluir um feriado, peça a um administrador.")));
}

function renderFeriados(){
  const v=$("#view-feriados");v.replaceChildren();
  if(feV3()){renderFeriadosV3(v);return}
  v.classList.remove("np-v3");
  const anos=[...new Set([F.ano,...F.feriados.map(f=>+f.data.slice(0,4)),...F.susp.map(s=>+s.inicio.slice(0,4))])].sort();
  const selAno=sel(Object.fromEntries(anos.map(a=>[a,a])),String(F.ano));selAno.onchange=()=>{F.ano=+selAno.value;render()};
  const selUf=sel(Object.fromEntries(UFS.map(u=>[u,u||"Todas as UFs"])),F.uf);selUf.onchange=()=>{F.uf=selUf.value;render()};
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Agenda"),el("h1",{},"Feriados e prazos"),el("div",{class:"sub"},"Dias sem expediente forense e suspensões de prazo usados na contagem de prazos (CPC 219/220/224).")),
    el("div",{class:"actions"},selAno,selUf,ehAdmin()?el("button",{class:"btn",onclick:()=>formSusp({})},"+ Suspensão"):null,ehAdmin()?el("button",{class:"btn primary",onclick:()=>formFeriado({})},"+ Feriado"):null)));
  if(!garantir()){v.append(el("div",{class:"note"},"Carregando…"));return}
  const tabs=el("div",{class:"tabs"},[["feriados","Feriados"],["susp","Suspensões de prazo"]].map(([k,l])=>el("button",{class:"tab","aria-selected":String(F.tab===k),onclick:()=>{F.tab=k;render()}},l)));
  v.append(tabs);
  if(F.tab==="feriados"){
    const lista=F.feriados.filter(f=>f.data.startsWith(String(F.ano))&&(!F.uf||!f.uf||f.uf===F.uf));
    const kp=t=>lista.filter(f=>f.tipo===t&&f.ativo!==false).length;
    v.append(el("div",{class:"kpis"},el("div",{class:"card kpi"},el("div",{class:"l"},"Nacionais"),el("div",{class:"v"},String(kp("nacional")))),el("div",{class:"card kpi"},el("div",{class:"l"},"Forenses"),el("div",{class:"v"},String(kp("forense")))),el("div",{class:"card kpi"},el("div",{class:"l"},"Estaduais"),el("div",{class:"v"},String(kp("estadual")))),el("div",{class:"card kpi"},el("div",{class:"l"},"Municipais"),el("div",{class:"v"},String(kp("municipal"))))));
    v.append(el("div",{class:"card"},tabela({cols:[
      {label:"Data",r:f=>el("span",{class:"num"},fmtBR(f.data))},{label:"Feriado",r:f=>el("div",{},el("div",{class:"n"},f.nome),f.ativo===false?el("span",{class:"pill g"},"inativo"):null)},
      {label:"Abrangência",r:f=>el("span",{class:"pill "+(f.tipo==="nacional"?"e3":f.tipo==="forense"?"e2":f.tipo==="estadual"?"c":"e1")},TIPO[f.tipo]||f.tipo)},{label:"UF",r:f=>f.uf||"—"},{label:"Comarca",r:f=>f.comarca||"—"}],
      rows:lista,onRow:ehAdmin()?f=>formFeriado(f):null,vazio:"Nenhum feriado cadastrado para este filtro.",acts:ehAdmin()?f=>[btnIco("editar","Editar",e=>{e.stopPropagation();formFeriado(f)})]:null,
      foot:`${lista.length} feriado(s) em ${F.ano}${F.uf?" · "+F.uf:""} · Os de outras UFs só entram no cálculo quando o processo for daquela UF.`})));
  }else{
    const lista=F.susp.filter(s=>s.inicio.startsWith(String(F.ano))||s.fim.startsWith(String(F.ano)));
    v.append(el("div",{class:"card"},tabela({cols:[{label:"Período",r:s=>el("span",{class:"num"},fmtBR(s.inicio)+" → "+fmtBR(s.fim))},{label:"Motivo",r:s=>el("div",{},el("div",{class:"n"},s.motivo),s.ativo===false?el("span",{class:"pill g"},"inativa"):null)},{label:"Abrangência",r:s=>s.uf||"Todos os tribunais"}],
      rows:lista,onRow:ehAdmin()?s=>formSusp(s):null,vazio:"Nenhuma suspensão cadastrada para este ano.",acts:ehAdmin()?s=>[btnIco("editar","Editar",e=>{e.stopPropagation();formSusp(s)})]:null,
      foot:"Durante a suspensão os dias não contam em prazos úteis; prazos em dias corridos que vencerem dentro dela são empurrados para o 1º dia útil seguinte."})));
  }
  v.append(el("div",{class:"note",style:"margin-top:8px"},"Regra de contagem: publicação no DJEN → considerada publicada no 1º dia útil seguinte; prazo começa no dia útil seguinte à publicação; dias úteis excluem sábados, domingos, feriados e suspensões. "+(ehAdmin()?"Clique numa linha para editar.":"Para incluir um feriado, peça a um administrador.")));
}
{const _r=render;render=function(){_r();const v=$("#view-feriados");if(!v)return;v.hidden=S.tab!=="feriados";if(S.tab==="feriados")renderFeriados()}}
window.PP_FERIADOS={recarregar:()=>{F.ok=false;garantir()}};
})();
