/* Prazos processuais — contagem em dias úteis (CPC art. 219/224) ou corridos, com feriados (feriados) e suspensões (suspensoes_prazo, art. 220).
   Regras aplicadas:
   - Publicação no DJEN: considera-se publicada no 1º dia útil seguinte à disponibilização (Lei 11.419 art. 4º §3º; CPC 224 §2º).
   - Exclui o dia do começo (a publicação) e inclui o do vencimento (CPC 224); começa no 1º dia útil seguinte (224 §3º).
   - Dias úteis: sem sábado, domingo, feriado nacional/forense, estadual da UF, municipal da comarca, nem dias de suspensão.
   - Corridos: conta todos os dias; se o vencimento cair em dia não útil, prorroga para o 1º dia útil (224 §1º). Suspensão também para corridos (art. 220 §1º suspende prazos; vale para ambos).
   Expõe window.PP_PRAZOS = {calcular, campo, ehUtil, pronto}. Depende de 0037. */
(()=>{
"use strict";
const Z={feriados:[],susp:[],ok:false,carregando:null};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const pd=s=>{if(!s)return null;if(s instanceof Date)return new Date(s.getFullYear(),s.getMonth(),s.getDate());const [y,m,d]=String(s).slice(0,10).split("-").map(Number);return new Date(y,m-1,d)};
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const fmt=d=>d?d.toLocaleDateString("pt-BR"):"—";
const UF_CNJ={"01":"AC","02":"AL","03":"AP","04":"AM","05":"BA","06":"CE","07":"DF","08":"ES","09":"GO","10":"MA","11":"MT","12":"MS","13":"MG","14":"PA","15":"PB","16":"PR","17":"PE","18":"PI","19":"RJ","20":"RN","21":"RS","22":"RO","23":"RR","24":"SC","25":"SE","26":"SP","27":"TO"};
function ufDoCnj(n){const m=/\.(\d)\.(\d{2})\./.exec(String(n||""));if(!m)return null;if(m[1]==="8")return UF_CNJ[m[2]]||null;return null} // justiça estadual; federal/trabalho: só nacionais
async function carregar(){
  if(Z.carregando)return Z.carregando;
  Z.carregando=(async()=>{try{const [f,s]=await Promise.all([SB.from("feriados").select("*").eq("ativo",true),SB.from("suspensoes_prazo").select("*").eq("ativo",true)]);Z.feriados=f.data||[];Z.susp=s.data||[];Z.ok=true}catch(e){console.warn("prazos",e)}})();
  return Z.carregando;
}
function feriadoEm(d,uf,comarca){
  const k=iso(d);
  return Z.feriados.find(f=>f.data===k&&(f.tipo==="nacional"||f.tipo==="forense"||(f.tipo==="estadual"&&uf&&f.uf===uf)||(f.tipo==="municipal"&&comarca&&f.uf===uf&&String(f.comarca||"").toLowerCase()===String(comarca).toLowerCase())))||null;
}
function suspensoEm(d,uf){const k=iso(d);return Z.susp.find(s=>k>=s.inicio&&k<=s.fim&&(!s.uf||s.uf===uf))||null}
function ehUtil(d,uf,comarca){const w=d.getDay();return w!==0&&w!==6&&!feriadoEm(d,uf,comarca)}
function proximoUtil(d,uf,comarca){let x=new Date(d);while(!ehUtil(x,uf,comarca)||suspensoEm(x,uf))x=addD(x,1);return x}
/* base: data da disponibilização (DJEN) ou da intimação; dias; tipo 'uteis'|'corridos'; uf/comarca; baseEhPublicacao=true quando a base já é a publicação (não a disponibilização) */
function calcular({base,dias,tipo="uteis",uf=null,comarca=null,baseEhPublicacao=false}){
  const b=pd(base);const n=Number(dias)||0;if(!b||n<=0)return null;
  const notas=[];
  let publicacao=b;
  if(!baseEhPublicacao){publicacao=proximoUtil(addD(b,1),uf,comarca);notas.push(`disponibilizada ${fmt(b)} → publicada ${fmt(publicacao)}`)}
  // 1º dia do prazo: 1º dia útil após a publicação
  let d=addD(publicacao,1),cont=0,fim=null;const pulos=[];
  if(tipo==="uteis"){
    while(cont<n){
      const f=feriadoEm(d,uf,comarca),s=suspensoEm(d,uf),w=d.getDay();
      if(w===0||w===6){}
      else if(s){if(!pulos.some(p=>p.motivo===s.motivo))pulos.push({motivo:s.motivo,de:s.inicio,ate:s.fim})}
      else if(f){pulos.push({motivo:f.nome,data:iso(d)})}
      else{cont++;if(cont===n)fim=d}
      d=addD(d,1);
    }
  }else{
    // corridos: inicia no 1º dia útil após a publicação; suspensão não conta; vence no n-ésimo dia; prorroga se não útil
    let ini=proximoUtil(d,uf,comarca);if(ini>d)notas.push(`início prorrogado para ${fmt(ini)}`);
    d=ini;cont=0;
    while(cont<n){const s=suspensoEm(d,uf);if(s){if(!pulos.some(p=>p.motivo===s.motivo))pulos.push({motivo:s.motivo,de:s.inicio,ate:s.fim})}else{cont++;if(cont===n)fim=d}d=addD(d,1)}
    const pr=proximoUtil(fim,uf,comarca);if(pr>fim){notas.push(`vencimento ${fmt(fim)} não é dia útil → ${fmt(pr)}`);fim=pr}
  }
  for(const p of pulos)notas.push(p.data?`${p.motivo} (${fmt(pd(p.data))})`:`${p.motivo} (${fmt(pd(p.de))}–${fmt(pd(p.ate))})`);
  return {publicacao:iso(publicacao),inicio:iso(addD(publicacao,1)),fim:iso(fim),dias:n,tipo,uf,notas};
}
/* Campo de UI: dias + tipo + base → preenche um input[type=date] alvo e mostra a explicação. Retorna o elemento. */
function campo({alvo,base,uf=null,comarca=null,dias=15,tipo="uteis",baseEhPublicacao=false,onCalc}){
  const nDias=inp("number",String(dias),{min:1,style:"width:84px"}),sTipo=sel({uteis:"dias úteis (CPC)",corridos:"dias corridos"},tipo),_s1=(sTipo.style.width="auto"),dBase=inp("date",base||"",{style:"width:150px"}),
        sUf=sel({"":"só nacionais","AC":"AC","AL":"AL","AM":"AM","AP":"AP","BA":"BA","CE":"CE","DF":"DF","ES":"ES","GO":"GO","MA":"MA","MG":"MG","MS":"MS","MT":"MT","PA":"PA","PB":"PB","PE":"PE","PI":"PI","PR":"PR","RJ":"RJ","RN":"RN","RO":"RO","RR":"RR","RS":"RS","SC":"SC","SE":"SE","SP":"SP","TO":"TO"},uf||""),_s2=(sUf.style.width="auto"),
        out=el("div",{class:"help",style:"grid-column:1/-1"},Z.ok?"":"Carregando feriados…");
  const btn=el("button",{class:"btn sm",type:"button"},"Calcular");
  const recalc=()=>{if(!Z.ok){carregar().then(recalc);return}
    const r=calcular({base:dBase.value,dias:nDias.value,tipo:sTipo.value,uf:sUf.value||null,comarca,baseEhPublicacao});
    if(!r){out.textContent="Informe a data-base e o número de dias.";return}
    if(alvo){alvo.value=r.fim;alvo.dispatchEvent(new Event("change"))}
    out.replaceChildren(el("b",{},`Vence em ${fmt(pd(r.fim))}`)," — ",`${r.dias} ${r.tipo==="uteis"?"dias úteis":"dias corridos"}, contados de ${fmt(pd(r.inicio))}`,r.notas.length?el("div",{style:"margin-top:2px"},"Considerado: "+r.notas.join("; ")):null,
      el("div",{style:"margin-top:2px;color:var(--faint)"},"Conferir o prazo específico da intimação; a contagem exclui o dia da publicação e inclui o do vencimento (CPC 224)."));
    onCalc?.(r)};
  btn.onclick=recalc;for(const x of [nDias,sTipo,dBase,sUf])x.onchange=recalc;
  const wrap=el("div",{class:"f full"},el("label",{},"Contagem do prazo"),el("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"},nDias,sTipo,el("span",{class:"note"},"a partir de"),dBase,el("span",{class:"note"},"feriados de"),sUf,btn),out);
  if(Z.ok&&dBase.value)setTimeout(recalc,0);else carregar().then(()=>{if(dBase.value)recalc()});
  return wrap;
}
window.PP_PRAZOS={calcular,campo,ehUtil,ufDoCnj,pronto:carregar,recarregar:()=>{Z.carregando=null;Z.ok=false;return carregar()}};
window.__PP_LOGIN.then(()=>{if(typeof equipe==="function"&&equipe())carregar()});
})();
