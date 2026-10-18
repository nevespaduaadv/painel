/* Formulário de fechamento (comercial → carteira). Aberto do lead (aba "Fechamento"): empresa, representante, dívidas por banco,
   honorários e condições. Ao confirmar, rpc lead_fechar cria o cliente, contatos, contratos, tarefas (contrato de honorários,
   cobrança da entrada), marca o lead como Ganho e avisa o Discord; o gatilho de cliente novo abre o onboarding (boas-vindas + formulário).
   Opcional: emite a cobrança da entrada no Asaas na hora (Edge /enviar asaas_cobrar). Supabase: fechamentos, v_fechamentos (0068). */
(()=>{
"use strict";
const VENC={"":"— escolher —","1":"Dia 01","5":"Dia 05","10":"Dia 10","20":"Dia 20"};
const FORMAS_PG={boleto:"Boleto",pix:"Pix",cartao:"Cartão",transferencia:"Transferência",outro:"Outro"};
const ESTADOS_CIVIS={"":"—",solteiro:"solteiro(a)",casado:"casado(a)",divorciado:"divorciado(a)",viuvo:"viúvo(a)",uniao:"união estável"};
const UFS=["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const num=v=>{const n=parseFloat(String(v??"").replace(/\./g,"").replace(",","."));return isNaN(n)?0:n};
const brl=v=>(typeof BRL==="function")?BRL(v):"R$ "+(+v||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
const irCliente=id=>{try{history.pushState(null,"","#clientes/"+encodeURIComponent(id))}catch(_){}if(typeof aplicarHash==="function"&&aplicarHash()){document.body.classList.remove("ro");if(typeof render==="function")render()}};
const soDigitos=s=>(s||"").replace(/\D/g,"");
const fmtCNPJ=s=>{const d=soDigitos(s);return d.length===14?d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5"):d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"):s};
const fmtCPF=s=>{const d=soDigitos(s);return d.length===11?d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"):s};
const validaCNPJ=s=>{const d=soDigitos(s);if(d.length!==14||/^(\d)\1+$/.test(d))return false;const calc=n=>{let soma=0,pos=n-7;for(let i=n;i>=1;i--){soma+=+d[n-i]*pos--;if(pos<2)pos=9}const r=soma%11;return r<2?0:11-r};return calc(12)===+d[12]&&calc(13)===+d[13]};
const validaCPF=s=>{const d=soDigitos(s);if(d.length!==11||/^(\d)\1+$/.test(d))return false;const calc=n=>{let soma=0;for(let i=0;i<n;i++)soma+=+d[i]*(n+1-i);const r=(soma*10)%11;return (r===10?0:r)};return calc(9)===+d[9]&&calc(10)===+d[10]};

function linhaDivida(d={}){
  const tr=el("tr",{class:"fc-div"});
  const banco=inp("text",d.banco||"",{placeholder:"Banco",list:"bancos"}),tit=sel(TITULARES,d.titular||"PJ"),prod=sel(PRODUTOS,d.produto||"giro"),gar=sel(GARANTIAS,d.garantia||"nenhuma"),sit=sel(SITUACOES,d.situacao||"cobranca"),
    vo=inp("number",d.valor_original||"",{step:"100",min:"0",placeholder:"0"}),sa=inp("number",d.saldo_atual||"",{step:"100",min:"0",placeholder:"= contratado"}),da=inp("date",d.data_inicio_atraso||""),pt=inp("number",d.parcelas_total||"",{min:"0",placeholder:"nº"});
  tr.dados=()=>({banco:banco.value.trim(),titular:tit.value,produto:prod.value,garantia:gar.value,situacao:sit.value,valor_original:vo.value,saldo_atual:sa.value,data_inicio_atraso:da.value,parcelas_total:pt.value});
  tr.append(...[banco,tit,prod,gar,sit,vo,sa,da,pt].map(x=>el("td",{},x)),el("td",{},el("button",{class:"btn sm",title:"Remover",onclick:()=>tr.remove()},"×")));
  return tr;
}

function abrir(lead){
  const l=lead||{};
  if(l.cliente_id){toast("Este lead já virou cliente");return}
  // --- empresa
  const E={nome:inp("text",l.empresa||"",{placeholder:"Razão social"}),nome_fantasia:inp("text",l.empresa||""),cnpj:inp("text","",{placeholder:"00.000.000/0000-00"}),tipo_pessoa:sel({PJ:"Pessoa jurídica",PF:"Pessoa física / MEI"},"PJ"),
    endereco:inp("text","",{placeholder:"Rua, nº, bairro"}),cidade:inp("text",""),uf:sel(Object.fromEntries([["",""],...UFS.map(u=>[u,u])]),"SP"),cep:inp("text","",{placeholder:"00000-000"}),email:inp("email",l.email||""),telefone:inp("text",l.whatsapp||""),
    segmento:inp("text","",{placeholder:"Ex.: comércio, indústria, agro"}),faturamento_mensal:inp("number","",{step:"1000",min:"0"}),funcionarios:inp("number","",{min:"0"})};
  E.cnpj.onblur=()=>{E.cnpj.value=fmtCNPJ(E.cnpj.value);E.cnpj.style.borderColor=E.cnpj.value&&!validaCNPJ(E.cnpj.value)&&!validaCPF(E.cnpj.value)?"var(--crit)":""};
  // --- representante
  const R={nome:inp("text",l.nome||""),cpf:inp("text","",{placeholder:"000.000.000-00"}),estado_civil:sel(ESTADOS_CIVIS,""),qualificacao:inp("text","",{placeholder:"brasileiro(a), empresário(a)…"}),email:inp("email",l.email||""),telefone:inp("text",l.whatsapp||"")};
  R.cpf.onblur=()=>{R.cpf.value=fmtCPF(R.cpf.value);R.cpf.style.borderColor=R.cpf.value&&!validaCPF(R.cpf.value)?"var(--crit)":""};
  // --- dívidas
  const tbody=el("tbody",{});tbody.append(linhaDivida({}));
  const tabela=el("div",{class:"tbl fc-tbl"},el("table",{},el("thead",{},el("tr",{},["Banco","Titular","Tipo","Garantia","Situação","Contratado (R$)","Saldo atual (R$)","Início do atraso","Parcelas",""].map(h=>el("th",{},h)))),tbody));
  const dl=el("datalist",{id:"bancos"},Object.keys((S.regras||{}).fatoresBanco||{}).map(b=>el("option",{value:b})));
  const totalBox=el("div",{class:"note"});const recalc=()=>{let t=0,n=0;for(const tr of tbody.querySelectorAll("tr.fc-div")){const d=tr.dados();n++;t+=num(d.saldo_atual)||num(d.valor_original)}totalBox.textContent=n?`${n} dívida(s) · saldo informado ${brl(t)}`:""};tbody.addEventListener("input",recalc);
  // --- honorários
  const H={entrada:inp("number","",{step:"100",min:"0",placeholder:"0"}),parcelas:inp("number","",{min:"0",placeholder:"0"}),valor_parcela:inp("number","",{step:"50",min:"0",placeholder:"0"}),vencimento_dia:sel(VENC,""),exito_pct:inp("number","",{step:"1",min:"0",max:"100",placeholder:"%"}),mensalidade:inp("number","",{step:"50",min:"0",placeholder:"0"}),forma:sel(FORMAS_PG,"boleto"),observacoes:el("textarea",{rows:"2",placeholder:"Condições especiais, descontos, datas combinadas…"})};
  const totalHon=el("div",{class:"note"});const calcHon=()=>{const t=num(H.entrada.value)+num(H.parcelas.value)*num(H.valor_parcela.value);totalHon.textContent=t?`Total do contrato: ${brl(t)}${H.mensalidade.value?` + ${brl(H.mensalidade.value)}/mês`:""}${H.exito_pct.value?` · êxito ${H.exito_pct.value}% sobre a economia`:""}`:""};[H.entrada,H.parcelas,H.valor_parcela,H.mensalidade,H.exito_pct].forEach(x=>x.oninput=calcHon);
  const emitir=inp("checkbox","");emitir.checked=false;
  // --- condições
  const C={data_fechamento:inp("date",new Date().toISOString().slice(0,10)),plano:sel({gestao_passivos:"Gestão de passivos bancários",consultoria:"Consultoria",outro:"Outro"},"gestao_passivos"),historia:el("textarea",{rows:"2",placeholder:"O que aconteceu com a empresa (resumo da call)"}),observacoes:el("textarea",{rows:"2",placeholder:"Notas internas (não aparecem para o cliente)"})};

  const sec=(t,...kids)=>el("section",{class:"card section",style:"margin:0 0 12px"},el("h3",{style:"margin:0 0 8px"},t),...kids);
  const body=el("div",{class:"fc-body"},
    sec("Empresa",el("div",{class:"form"},field("fc-nome","Razão social",E.nome),field("fc-nf","Nome fantasia",E.nome_fantasia),field("fc-cnpj","CNPJ (ou CPF se MEI/PF)",E.cnpj),field("fc-tp","Tipo",E.tipo_pessoa),el("div",{class:"f full"},el("label",{for:"fc-end"},"Endereço"),Object.assign(E.endereco,{id:"fc-end"})),field("fc-cid","Cidade",E.cidade),field("fc-uf","UF",E.uf),field("fc-cep","CEP",E.cep),field("fc-em","E-mail da empresa",E.email),field("fc-tel","Telefone / WhatsApp",E.telefone),field("fc-seg","Segmento",E.segmento),field("fc-fat","Faturamento mensal (R$)",E.faturamento_mensal),field("fc-fun","Funcionários",E.funcionarios))),
    sec("Representante / sócio que assina",el("div",{class:"form"},field("fc-rn","Nome completo",R.nome),field("fc-rc","CPF",R.cpf),field("fc-rec","Estado civil",R.estado_civil),field("fc-rq","Qualificação (como vai no contrato)",R.qualificacao),field("fc-rem","E-mail",R.email),field("fc-rt","WhatsApp",R.telefone),el("div",{class:"note full"},"Vira o contato principal do cliente: é para esse WhatsApp que o sistema manda as boas-vindas e o formulário de onboarding.")),dl),
    sec("Dívidas por banco",tabela,el("div",{class:"actions",style:"margin-top:6px;justify-content:space-between"},el("button",{class:"btn sm",onclick:()=>{tbody.append(linhaDivida({}));recalc()}},"+ Dívida"),totalBox)),
    sec("Honorários",el("div",{class:"form"},field("fc-he","Entrada (R$)",H.entrada),field("fc-hp","Parcelas (qtd.)",H.parcelas),field("fc-hv","Valor de cada parcela (R$)",H.valor_parcela),field("fc-hd","Vencimento",H.vencimento_dia),field("fc-hx","Honorários de êxito (%)",H.exito_pct,"Sobre a economia obtida nos acordos."),field("fc-hm","Mensalidade (R$), se houver",H.mensalidade),field("fc-hf","Forma de pagamento",H.forma),el("div",{class:"f full"},el("label",{for:"fc-ho"},"Observações"),Object.assign(H.observacoes,{id:"fc-ho"})),el("div",{class:"f full"},totalHon),el("label",{class:"f full",style:"display:flex;gap:8px;align-items:center"},emitir,"Emitir agora a cobrança da entrada no Asaas (boleto/Pix). Se desmarcado, abre uma tarefa para o financeiro emitir."))),
    sec("Condições",el("div",{class:"form"},field("fc-cd","Data do fechamento",C.data_fechamento),field("fc-cp","Serviço contratado",C.plano),el("div",{class:"f full"},el("label",{for:"fc-ch"},"História / situação da empresa"),Object.assign(C.historia,{id:"fc-ch"})),el("div",{class:"f full"},el("label",{for:"fc-co"},"Notas internas"),Object.assign(C.observacoes,{id:"fc-co"})))),
    el("div",{class:"note"},"Ao confirmar: cliente criado na carteira com os contratos acima · lead marcado como Ganho · tarefas de onboarding, contrato de honorários e cobrança da entrada abertas · boas-vindas com o formulário vão para o WhatsApp do representante em 5 minutos · aviso no Discord (sem valores)."));

  modal("Fechamento — "+(l.nome||"lead"),body,async()=>{
    if(!E.nome.value.trim())throw new Error("Informe a razão social");
    if(E.cnpj.value&&!validaCNPJ(E.cnpj.value)&&!validaCPF(E.cnpj.value))throw new Error("CNPJ/CPF da empresa inválido");
    if(R.cpf.value&&!validaCPF(R.cpf.value))throw new Error("CPF do representante inválido");
    const dividas=[...tbody.querySelectorAll("tr.fc-div")].map(tr=>tr.dados()).filter(d=>d.banco);
    if(!dividas.length)throw new Error("Informe pelo menos uma dívida (banco)");
    for(const d of dividas){if(!num(d.valor_original)&&!num(d.saldo_atual))throw new Error(`Informe o valor da dívida com ${d.banco}`)}
    const p={empresa:Object.fromEntries(Object.entries(E).map(([k,x])=>[k,x.value.trim()])),representante:Object.fromEntries(Object.entries(R).map(([k,x])=>[k,x.value.trim()])),dividas,
      honorarios:Object.fromEntries(Object.entries(H).map(([k,x])=>[k,x.value.trim()])),condicoes:Object.fromEntries(Object.entries(C).map(([k,x])=>[k,x.value.trim()])),emitir_cobranca:emitir.checked?"true":"false"};
    const {data,error}=await SB.rpc("lead_fechar",{p_lead:l.id,p});
    if(error)throw new Error(error.message);
    const cid=data.cliente_id;
    toast(`Cliente criado · ${data.dividas} contrato(s)`);
    if(emitir.checked&&num(H.entrada.value)>0){
      try{
        const venc=(()=>{const d=new Date();const dia=+H.vencimento_dia.value||((d.getDate()+3));let x=new Date(d.getFullYear(),d.getMonth(),dia);if(x<=d)x=new Date(d.getFullYear(),d.getMonth()+1,dia);return x.toISOString().slice(0,10)})();
        const session=(await SB.auth.getSession()).data.session;
        const r=await fetch(SB_URL+"/functions/v1/chatguru/enviar",{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify({acao:"asaas_cobrar",cliente_id:cid,tipo:"entrada",valor:num(H.entrada.value),vencimento:venc,forma:H.forma.value==="pix"?"PIX":H.forma.value==="cartao"?"CREDIT_CARD":H.forma.value==="boleto"?"BOLETO":"UNDEFINED",parcelas:1,descricao:"Entrada — honorários "+(C.plano.value==="gestao_passivos"?"Gestão de Passivos Bancários":"serviços jurídicos")})});
        const j=await r.json();if(!r.ok||j.erro)throw new Error(j.erro||j.message||("HTTP "+r.status));toast("Cobrança da entrada emitida no Asaas");
      }catch(e){console.warn(e);toast("Cliente criado, mas a cobrança no Asaas falhou: "+e.message+". Emita pela tela Financeiro.")}
    }
    try{window.PP_LEADS?.invalidar?.()}catch(_){}
    setTimeout(()=>irCliente(cid),300);
  });
  const btn=$("#modalHost button.btn.primary");if(btn)btn.textContent="Confirmar fechamento";
  const card=$("#modalHost .card");if(card)card.classList.add("fc-modal");
}

/* resumo na ficha do cliente (aba/card "Fechamento") */
async function cardFechamento(c){
  const card=el("section",{class:"card section"},el("div",{class:"section-h"},el("div",{},el("h2",{},"Fechamento"),el("div",{class:"note"},"Formulário preenchido pelo comercial ao fechar o contrato."))),el("div",{class:"note"},"Carregando…"));
  const {data}=await SB.from("v_fechamentos").select("*").eq("cliente_id",c.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  const box=card.lastChild;
  if(!data){box.textContent="Cliente cadastrado sem formulário de fechamento (cadastro manual ou anterior ao sistema).";return card}
  const d=data.dados||{},h=d.honorarios||{},e=d.empresa||{},r=d.representante||{};
  const tot=num(h.entrada)+num(h.parcelas)*num(h.valor_parcela);
  box.replaceChildren(el("div",{class:"kv"},
    el("div",{},el("b",{},"Fechado em "),fmtD(parseD((d.condicoes||{}).data_fechamento||data.created_at.slice(0,10)))," · closer ",data.closer_nome||"—"),
    el("div",{},el("b",{},"Honorários: "),`entrada ${brl(h.entrada)}${num(h.parcelas)?` + ${h.parcelas}× ${brl(h.valor_parcela)}`:""}${h.vencimento_dia?` (dia ${h.vencimento_dia})`:""}${h.exito_pct?` · êxito ${h.exito_pct}%`:""}${num(h.mensalidade)?` · mensalidade ${brl(h.mensalidade)}`:""} — total ${brl(tot)}`),
    el("div",{},el("b",{},"Representante: "),[r.nome,r.cpf?"CPF "+r.cpf:null,r.qualificacao].filter(Boolean).join(" · ")||"—"),
    el("div",{},el("b",{},"Dívidas informadas: "),`${(d.dividas||[]).length} · saldo ${brl((d.resumo||{}).saldo_total||0)}`),
    h.observacoes?el("div",{},el("b",{},"Condições: "),h.observacoes):null,
    data.contrato_url?el("div",{},el("b",{},"Contrato: "),el("a",{href:data.contrato_url,target:"_blank",rel:"noopener"},"abrir")):el("div",{class:"note"},"Contrato de honorários ainda não gerado (botão fica disponível quando o modelo .docx estiver cadastrado).")));
  return card;
}

document.head.append(el("style",{},`.fc-modal{width:min(1100px,100%)!important}.fc-body .form{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}.fc-tbl table{min-width:980px;font-size:12.5px}.fc-tbl input,.fc-tbl select{min-width:0;width:100%;font-size:12.5px;padding:4px 6px}.fc-tbl td{padding:3px 4px}.fc-tbl th{white-space:nowrap}.kv>div{margin:4px 0}`));
window.PP_FECHAMENTO={abrir,cardFechamento,irCliente};
})();
{const _r=window.PP_MOD.resumo;window.PP_MOD.resumo=(c,host,ind)=>{_r&&_r(c,host,ind);if(typeof readOnly==="function"&&readOnly())return;if(!(typeof equipe==="function"&&equipe()))return;window.PP_FECHAMENTO.cardFechamento(c).then(card=>{if(S.sel===c.id)host.append(card)})}}
