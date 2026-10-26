// Gera passivos/index.html (painel com login) e cliente/index.html (acesso por token) a partir de fontes/painel.html.
// Uso: node fontes/gerar-app-supabase.mjs
import fs from 'fs';
import path from 'path';
const base = path.dirname(new URL(import.meta.url).pathname);
// Espelho (beta): PP_ESPELHO=1 gera só o painel da equipe apontando para o projeto Supabase beta, em <raiz>/beta/
// (chaves publicáveis; o banco beta é uma cópia de teste — ver docs/beta/esquema-espelho.sql).
const ESPELHO = process.env.PP_ESPELHO === '1';
const out = process.argv[2] || path.join(base,'..', ESPELHO ? 'beta' : '', 'index.html');
const SUPABASE_URL = ESPELHO ? 'https://ooynicwexxqqccihjiah.supabase.co' : 'https://ksdwzljfjfucjevdqxvx.supabase.co';
const SUPABASE_KEY = ESPELHO ? 'sb_publishable_dn6ljhAAaV3TxnAyXQB5TA_0DdvGl-W' : 'sb_publishable_tt__gxUjGaujzylisID0KQ_qaeaU1-l';
const outToken = path.join(base,'..','cliente','index.html');

// Gera o painel em dois modos: 'login' (passivos/, equipe e clientes com usuário) e 'token' (cliente/?t=…, sem login,
// lê tudo de uma função SQL que entrega só o que o cliente pode ver).
function gerar(modo){
let html = fs.readFileSync(path.join(base,'painel.html'),'utf8');
const must=(needle)=>{if(!html.includes(needle)){console.error('âncora não encontrada:',needle.slice(0,60));process.exit(1)}};

// 1) CSS extra
must('</style>');
html = html.replace('</style>', `
[hidden]{display:none!important}
/* --- Supabase: login e modos --- */
.login{position:fixed;inset:0;background:radial-gradient(900px 600px at 20% 10%,#3A3F42 0%,var(--navy-2,#202426) 60%);display:flex;align-items:center;justify-content:center;padding:24px;z-index:50}
.login .card{width:min(440px,100%);padding:32px 32px 28px;display:flex;flex-direction:column;gap:12px;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.login .logo{width:120px;height:auto;margin:0 auto 8px;display:block}
:root[data-theme="dark"] .login .logo{filter:invert(1) brightness(1.6)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .login .logo{filter:invert(1) brightness(1.6)}}
.login .eyebrow{color:var(--gold);text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:600;text-align:center}
.login h1{font-size:26px;text-align:center;letter-spacing:-.02em}
.login .sub{color:var(--muted);text-align:center;margin-top:-6px;margin-bottom:6px}
.login .f input{padding:11px 13px;border-radius:10px}
.login .err{color:var(--crit);font-size:13px;min-height:18px}
.login .btn.primary{width:100%;padding:11px;font-size:15px;gap:10px;margin-top:2px}
.login .note{text-align:center;font-size:12.5px}
.modo-cliente .side,.modo-cliente .sb,.modo-cliente .sb-overlay,.modo-cliente .switch,.modo-cliente #btnSb,.modo-cliente .busca{display:none!important}
.modo-cliente .app{grid-template-columns:1fr}
.modo-cliente .grid{grid-template-columns:1fr}
.modo-cliente .top .area::before{content:"Neves Pádua Advocacia";display:block;font-family:var(--body);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:700}
.nao-admin .admin-only{display:none!important}
.sem-growth .growth-only{display:none!important}
.sem-financeiro .financeiro-only{display:none!important}
.nao-admin.sem-growth .gestao-only{display:none!important}
.sem-controle .controle-only{display:none!important}
.sem-clientes .area-clientes{display:none!important}
.sem-juridico .area-juridico{display:none!important}
.sem-superendividamento .area-superendividamento{display:none!important}
.sem-juridico.sem-superendividamento .grp-juridico{display:none!important}
.sem-atendimento .area-atendimento{display:none!important}
.sem-comercial .area-comercial{display:none!important}
.sem-marketing .area-marketing{display:none!important}
.sem-financeiro .area-financeiro{display:none!important}
.sem-equipe .area-equipe{display:none!important}
.sem-growth .area-growth{display:none!important}
.userbox{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;flex:none}
.userbox .btn{background:var(--surface);color:var(--fg);border-color:var(--line);padding:5px 10px;font-size:13px;text-decoration:none}
.userbox #userName{font-weight:600;color:var(--fg);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:600px){.userbox #userName,.userbox a.btn{display:none}}
.pendente{text-align:center;padding:48px 20px;color:var(--muted)}
.pendente h2{color:var(--fg);margin-bottom:8px}
</style>`);

// 2) Cabeçalho: aba Usuários (admin) + caixa do usuário com Sair
must('<label class="switch edit-only">');
html = html.replace('<label class="switch edit-only"><input type="checkbox" id="viewClient"> Visão do cliente</label>',
  '<label class="switch edit-only"><input type="checkbox" id="viewClient"> Visão do cliente</label>\n  <div class="userbox" id="userbox" hidden><span id="userName"></span><button class="btn" id="btnSair">Sair</button></div>');
must('<div id="view-calibracao" hidden class="main"></div>');
must('const NAV=[{tab:"clientes",label:"Clientes"},');
html = html.replace('const NAV=[{tab:"clientes",label:"Clientes"},', 'const NAV=[{tab:"painel",label:"Meu painel",cls:"edit-only"},{tab:"tarefas",label:"Tarefas e prazos",cls:"edit-only"},{tab:"agenda",label:"Agenda",cls:"edit-only"},{tab:"perfil",label:"Meu perfil",cls:"edit-only"},{tab:"avisos",label:"Avisos",cls:"edit-only"},{tab:"clientes",label:"Clientes",cls:"area-clientes"},');
must('/*NAV_JURIDICO*/');
html = html.replace('{tab:"historico",label:"Base de acordos"}', '{tab:"historico",label:"Base de acordos",cls:"area-juridico"}');
html = html.replace('{grupo:"juridico",label:"Jurídico",cls:"edit-only",itens:[', '{grupo:"juridico",label:"Jurídico",cls:"edit-only grp-juridico",itens:[');
html = html.replace('{tab:"historico",label:"Base de acordos"},{tab:"regras",label:"Regras de projeção"},{tab:"calibracao",label:"Calibração"}', '');
html = html.replace('/*NAV_JURIDICO*/', '{tab:"processos",label:"Processos",cls:"area-juridico"},{tab:"negociacoes",label:"Negociações",cls:"area-juridico"},{tab:"revisional",label:"Revisional de contratos",cls:"area-juridico"},{tab:"superendividamento",label:"Superendividamento",cls:"area-superendividamento"},{tab:"pecas",label:"Modelos de peças",cls:"area-juridico"},{tab:"monitoramento",label:"Monitoramento",cls:"area-juridico"},{tab:"publicacoes",label:"Publicações (DJEN)",cls:"area-juridico controle-only"},{tab:"conhecimento",label:"Base de conhecimento",cls:"area-juridico",hash:"#conhecimento/area:juridico",sel:()=>!window.PP_KB||["","juridico"].includes(window.PP_KB.area)},{tab:"autenticador",label:"Autenticador (2FA)",cls:"area-juridico"},');
if(ESPELHO){ must('<title>Sistema interno — Neves Pádua Advocacia</title>'); html = html.replace('<title>Sistema interno — Neves Pádua Advocacia</title>','<title>ESPELHO (beta) — Neves Pádua Advocacia</title>'); html = html.replace('</style>', '.pp-espelho{position:fixed;left:0;right:0;top:0;z-index:60;background:#B8964A;color:#0C1F38;font:700 12px/1 var(--body);text-align:center;padding:5px 0;letter-spacing:.08em;text-transform:uppercase}body{padding-top:22px}</style>',1); html = html.replace('<body', '<body data-espelho="1"',1); html = html.replace('</style>', '.espelho-only{display:none!important}</style>',1); html = html.replace('</body>', '<div class="pp-espelho">Espelho (beta) — ambiente de teste, dados copiados; nada aqui afeta o sistema real</div></body>'); }
must('const ICONES={');
html = html.replace('const ICONES={', 'const ICONES={atendimento:\'<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>\',');
must('/*NAV_GRUPOS*/');
html = html.replace('/*NAV_GRUPOS*/', '{grupo:"comercial",label:"Comercial",cls:"edit-only area-comercial",itens:[{tab:"leads",label:"Leads (CRM)",cls:"area-comercial"},{tab:"automacoes",label:"Automações",cls:"area-comercial"},{tab:"comercial",label:"Metas do mês",cls:"area-comercial"},{tab:"conhecimento",label:"Base de conhecimento",cls:"area-comercial",hash:"#conhecimento/area:comercial",sel:()=>window.PP_KB?.area==="comercial"}]},{grupo:"atendimento",label:"Atendimento",cls:"edit-only area-atendimento",itens:[{tab:"atendimento",label:"Conversas (WhatsApp)",cls:"area-atendimento"}]},{grupo:"marketing",label:"Marketing",cls:"edit-only area-marketing",itens:[{tab:"marketing",label:"Pautas de conteúdo",cls:"area-marketing"},{tab:"conhecimento",label:"Base de conhecimento",cls:"area-marketing",hash:"#conhecimento/area:marketing",sel:()=>window.PP_KB?.area==="marketing"}]},{grupo:"financeiro",label:"Financeiro",cls:"edit-only area-financeiro",itens:[{tab:"financeiro",label:"Cobranças (Asaas)",cls:"area-financeiro"},{tab:"estoque",label:"Estoque",cls:"area-financeiro"},{tab:"inventario",label:"Inventário",cls:"area-financeiro"},{tab:"conhecimento",label:"Base de conhecimento",cls:"area-financeiro",hash:"#conhecimento/area:financeiro",sel:()=>window.PP_KB?.area==="financeiro"}]},{grupo:"equipe",label:"Equipe",cls:"edit-only area-equipe",itens:[{tab:"equipe",label:"Colaboradores",cls:"area-equipe"},{tab:"horas",label:"Horas",cls:"area-equipe"},{tab:"ponto",label:"Ponto",cls:"area-equipe"},{tab:"usuarios",label:"Usuários",cls:"admin-only"}]},{grupo:"gestao",label:"Gestão",cls:"edit-only gestao-only",itens:[{tab:"visao",label:"Visão geral",cls:"admin-only"},{tab:"growth",label:"Growth",cls:"area-growth"},{tab:"espelho",label:"Espelho (beta)",cls:"admin-only espelho-only"}]}');
html = html.replace('<div id="view-calibracao" hidden class="main"></div>', '<div id="view-calibracao" hidden class="main"></div>\n  <div id="view-painel" hidden class="main"></div>\n  <div id="view-atendimento" hidden class="main"></div>\n  <div id="view-espelho" hidden class="main"></div>\n  <div id="view-automacoes" hidden class="main"></div>\n  <div id="view-processos" hidden class="main"></div>\n  <div id="view-superendividamento" hidden class="main"></div>\n  <div id="view-growth" hidden class="main"></div>\n  <div id="view-visao" hidden class="main"></div>\n  <div id="view-feriados" hidden class="main"></div>\n  <div id="view-agenda" hidden class="main"></div>\n  <div id="view-usuarios" hidden class="main"></div>\n  <div id="view-tarefas" hidden class="main"></div>\n  <div id="view-horas" hidden class="main"></div>\n  <div id="view-equipe" hidden class="main"></div>\n  <div id="view-negociacoes" hidden class="main"></div>\n  <div id="view-monitoramento" hidden class="main"></div>\n  <div id="view-publicacoes" hidden class="main"></div>\n  <div id="view-conhecimento" hidden class="main"></div>\n  <div id="view-autenticador" hidden class="main"></div>\n  <div id="view-marketing" hidden class="main"></div>\n  <div id="view-comercial" hidden class="main"></div>\n  <div id="view-leads" hidden class="main"></div>\n  <div id="view-revisional" hidden class="main"></div>\n  <div id="view-pecas" hidden class="main"></div>\n  <div id="view-financeiro" hidden class="main"></div>\n  <div id="view-perfil" hidden class="main"></div>\n  <div id="view-avisos" hidden class="main"></div>\n  <div id="view-ponto" hidden class="main"></div>\n  <div id="view-estoque" hidden class="main"></div>\n  <div id="view-inventario" hidden class="main"></div>');

// 3) Tela de login (antes de tudo) + runtime
must('<script>');
if(modo==='token'){
html = html.replace('<script>', `<div class="login" id="login"><div class="card"><div class="eyebrow">Neves Pádua Advocacia</div><h1>Área do cliente</h1><div class="note" id="l-msg">Carregando a sua posição…</div></div></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
/* ---------- Runtime por token: sem login. Os dados vêm de painel_por_token(t) (só o publicado para o cliente). ---------- */
const REAL = window.supabase.createClient(${JSON.stringify(SUPABASE_URL)}, ${JSON.stringify(SUPABASE_KEY)});
const PP = {perfil:null, listeners:{}, cache:{}};
const equipe = ()=>false;
let DADOS = null;
/* SB falso com a mesma interface de consulta usada pelo módulo da carteira (from/select/eq/in/order) */
const TAB = {entradas_timeline:()=>DADOS.entradas_timeline, processos:()=>DADOS.processos, andamentos:()=>DADOS.andamentos, anexos:()=>[], colaboradores:()=>[], perfis:()=>[], acordos:()=>DADOS.acordos, contatos:()=>[], bens:()=>[], documentos:()=>DADOS.documentos||[]};
function consulta(t){const f=[];const o={select(){return o},eq(k,v){f.push(r=>r[k]===v);return o},in(k,vs){f.push(r=>vs.includes(r[k]));return o},order(){return o},maybeSingle(){o._s=true;return o},single(){o._s=true;return o},
  then(res){const d=(TAB[t]?TAB[t]():[]).filter(r=>f.every(x=>x(r)));res({data:o._s?(d[0]||null):d,error:null})}};return o}
const SB = {from:consulta, channel:()=>({on(){return this},subscribe(){}}), storage:{from:()=>({createSignedUrl:async()=>({data:null,error:new Error("indisponível")})})}, auth:{signOut:async()=>{}}};
const refs = ()=>(DADOS.referencias||[]).filter(r=>r.desc!=null).map(r=>({id:r.id,credor:r.credor,grupo:r.grupo,forma:r.forma,status:r.status,data:r.data,divida:1,valorAcordo:1-Number(r.desc)}));
window.__PP_RUNTIME={use:async(n)=>{
  if(n==="db")return {
    doc:(p)=>({onSnapshot:(cb)=>{if(p==="config/regras")cb({exists:!!DADOS.regras,data:()=>DADOS.regras})},set:async()=>{},update:async()=>{},delete:async()=>{}}),
    collection:(col)=>({onSnapshot:(cb)=>{
      const rows=col==="clientes"?[{id:DADOS.cliente.id,...DADOS.cliente.dados,...(DADOS.ficha||{})}]:col==="contratos"?DADOS.contratos.map(k=>({id:k.id,...k.dados})):col==="historico"?refs():[];
      cb({docs:rows.map(r=>({id:r.id,data:()=>r}))})},add:async()=>{throw new Error("somente leitura")}})
  };
  if(n==="user")return {can:async()=>false,id:async()=>null};
  return null;
}};
window.__PP_LOGIN = (async()=>{
  const t=new URLSearchParams(location.search).get("t");
  const falha=(m)=>{document.querySelector("#l-msg").textContent=m;return new Promise(()=>{})};
  if(!t)return falha("Este link está incompleto. Peça ao escritório o link de acesso.");
  const {data,error}=await REAL.rpc("painel_por_token",{t});
  if(error||!data)return falha("Link inválido ou revogado. Peça ao escritório um link novo.");
  DADOS=data;REAL.rpc("registrar_acesso_token",{t}).then(()=>{},()=>{});
  PP.perfil={papel:"cliente",cliente_id:data.cliente.id};
  document.body.classList.add("modo-cliente","nao-admin");S.clientView=true;S.sel=data.cliente.id;S.tab="clientes";
  document.querySelector("#login").hidden=true;
  const ub=document.querySelector("#userbox");ub.hidden=false;ub.replaceChildren(document.createTextNode("Acesso por link · posição de "+new Date(data.gerado_em).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})));
  const h=(location.hash||"").slice(1);if(["reserva","timeline","processos","contratos"].includes(h))S.sub=h;
})();
</script>
<script>`);
} else {
html = html.replace('<script>', `<div class="login" id="login">
  <div class="card">
    <img class="logo" src="passivos/img/logo-escura.png" alt="">
    <div class="eyebrow">Sistema interno</div>
    <h1>Neves Pádua Advocacia</h1>
    <div class="sub">Painel interno do escritório.</div>
    <div class="f"><label for="l-email">E-mail</label><input id="l-email" type="email" autocomplete="username" placeholder="voce@empresa.com.br"></div>
    <div class="f"><label for="l-senha">Senha</label><input id="l-senha" type="password" autocomplete="current-password"></div>
    <div class="err" id="l-err"></div>
    <button class="btn primary" id="l-btn"><span class="seta"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>Entrar</button>
    <div class="note">Acesso restrito à equipe do escritório e aos clientes convidados. Esqueceu a senha? Fale com o escritório.</div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
/* ---------- Runtime Supabase: mesma interface do banco do protótipo (doc/collection/onSnapshot) ---------- */
const SB = window.supabase.createClient(${JSON.stringify(SUPABASE_URL)}, ${JSON.stringify(SUPABASE_KEY)});
const SB_URL = ${JSON.stringify(SUPABASE_URL)}, SB_KEY = ${JSON.stringify(SUPABASE_KEY)};
const PP = {perfil:null, listeners:{}, cache:{}};
const TABELAS = {clientes:"clientes", contratos:"contratos", historico:"historico"};
const NOTA_CAMPO = {clientes:"notasInternas", contratos:"notas"};
const FICHA_COLS = ["nome","ativo","endereco","representante","representante_cpf","representante_qualificacao","cpf_titular","tipo_pessoa","nome_fantasia","cidade","uf","segmento","faturamento_mensal","funcionarios","historia","situacao_atual","origem","closer","data_fechamento","data_onboarding","plano","status","negativado","usa_maquininha","tem_consorcio","outros_cnpjs","assuntos_interesse","disponibilidade","observacoes_onboarding","proxima_reuniao","created_at","updated_at","estagio_registrado","etapa_fluxo","tem_divida_atraso","adimplente","possui_processos","projeto_reserva","regua","servico","tipos_dividas","responsavel_onboarding_id","notion_url","direcionamento","direcionamento_em","registrato_ok"];
const equipe = ()=>PP.perfil && (PP.perfil.papel==="admin"||PP.perfil.papel==="colaborador");

async function carregar(col){
  if(col==="historico" && !equipe()){
    const {data,error}=await SB.from("referencias").select("*");
    if(error) throw error;
    // formato compatível com referencias(): divida/valorAcordo sintéticos a partir do desconto
    return data.filter(r=>r.desc!=null).map(r=>({id:r.id,credor:r.credor,grupo:r.grupo,forma:r.forma,status:r.status,data:r.data,divida:1,valorAcordo:1-Number(r.desc)}));
  }
  const {data,error}=await SB.from(TABELAS[col]).select("*").order("id");
  if(error) throw error;
  let notas={};
  if(NOTA_CAMPO[col] && equipe()){
    const {data:ns}=await SB.from("notas_internas").select("id,texto");
    for(const n of (ns||[])) notas[n.id]=n.texto;
  }
  return data.map(r=>{const d={id:r.id,...r.dados};
    if(col==="clientes"){for(const [k,v] of Object.entries(r)){if(!["id","dados","token","acesso_por_token","created_by","updated_by"].includes(k)&&v!=null)d[k]=v}} // colunas da ficha (0008)
    if(NOTA_CAMPO[col]){const n=notas[(col==="clientes"?"cliente:":"contrato:")+r.id];if(n!=null)d[NOTA_CAMPO[col]]=n}return d});
}
async function notificar(col){
  try{const rows=await carregar(col);PP.cache[col]=rows;for(const cb of (PP.listeners[col]||[]))cb({docs:rows.map(r=>({id:r.id,data:()=>r}))})}
  catch(e){console.warn("carregar",col,e);toast("Falha ao carregar "+col)}
}
async function notificarRegras(){
  const {data,error}=await SB.from("regras").select("dados").eq("id","regras").maybeSingle();
  if(error){console.warn(error);return}
  for(const cb of (PP.listeners.regras||[]))cb({exists:!!data,data:()=>data?data.dados:null});
}
function parseRef(p){const [col,id]=p.split("/");return {col,id}}
async function gravar(col,id,doc,{merge=false}={}){
  if(col==="config"){const {error}=await SB.from("regras").upsert({id:"regras",dados:doc});if(error)throw error;return}
  const d={...doc};delete d.id;
  const notaCampo=NOTA_CAMPO[col];let nota=null;
  if(notaCampo){nota=d[notaCampo]??"";delete d[notaCampo]}
  if(merge){const {data:cur}=await SB.from(TABELAS[col]).select("dados").eq("id",id).maybeSingle();Object.assign(d,{...(cur?cur.dados:{}),...d})}
  if(col==="clientes"){for(const k of FICHA_COLS)delete d[k]}   // colunas da ficha não vão para o jsonb
  const row={id,dados:d};if(col==="contratos")row.cliente_id=d.clienteId;if(col==="clientes"&&d.cnpj)row.cnpj=d.cnpj;
  const {error}=await SB.from(TABELAS[col]).upsert(row);if(error)throw error;
  if(notaCampo && !merge){
    const nid=(col==="clientes"?"cliente:":"contrato:")+id;
    const {error:e2}=await SB.from("notas_internas").upsert({id:nid,cliente_id:col==="clientes"?id:d.clienteId,contrato_id:col==="contratos"?id:null,texto:nota||""});
    if(e2)throw e2;
  }
}
const novoId=(col)=>col.slice(0,3)+"-"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
window.__PP_RUNTIME={use:async(n)=>{
  if(n==="db")return {
    doc:(p)=>{const {col,id}=parseRef(p);return {
      onSnapshot:(cb)=>{if(col==="config"){(PP.listeners.regras??=[]).push(cb);notificarRegras()}},
      set:async(doc)=>{await gravar(col,id,doc);await notificar(col)},
      update:async(partial)=>{await gravar(col,id,partial,{merge:true});await notificar(col)},
      delete:async()=>{const {error}=await SB.from(col==="config"?"regras":TABELAS[col]).delete().eq("id",id);if(error)throw error;await notificar(col)}
    }},
    collection:(col)=>({
      onSnapshot:(cb)=>{(PP.listeners[col]??=[]).push(cb);notificar(col)},
      add:async(doc)=>{const id=novoId(col);await gravar(col,id,doc);await notificar(col);return {id}}
    })
  };
  if(n==="user")return {can:async()=>equipe(),id:async()=>PP.perfil?.id||null};
  return null;
}};
/* tempo real: quando algo muda no banco, recarrega a coleção afetada */
function ligarTempoReal(){
  const mapa={clientes:"clientes",contratos:"contratos",historico:"historico",notas_internas:null,regras:"regras",perfis:"perfis"};
  const ch=SB.channel("painel");
  for(const t of Object.keys(mapa)){
    ch.on("postgres_changes",{event:"*",schema:"public",table:t},()=>{
      if(t==="regras")notificarRegras();
      else if(t==="notas_internas"){notificar("clientes");notificar("contratos")}
      else if(t==="perfis"){if(typeof renderUsuarios==="function"&&S.tab==="usuarios")renderUsuarios()}
      else notificar(mapa[t]);
    });
  }
  ch.subscribe();
}
/* ---------- Login e perfil ---------- */
window.__PP_LOGIN = new Promise(resolve=>{
  const show=(v)=>{document.querySelector("#login").hidden=!v};
  async function entrar(){
    const email=document.querySelector("#l-email").value.trim(), senha=document.querySelector("#l-senha").value;
    document.querySelector("#l-err").textContent="";
    const {error}=await SB.auth.signInWithPassword({email,password:senha});
    if(error){document.querySelector("#l-err").textContent="E-mail ou senha incorretos.";return}
  }
  document.querySelector("#l-btn").onclick=entrar;
  document.querySelector("#l-senha").onkeydown=e=>{if(e.key==="Enter")entrar()};
  document.querySelector("#btnSair").onclick=async()=>{await SB.auth.signOut();location.reload()};
  let iniciado=false;
  SB.auth.onAuthStateChange(async(ev,session)=>{
    if(!session){show(true);return}
    if(iniciado)return;iniciado=true;
    const {data:perfil}=await SB.from("perfis").select("*").eq("id",session.user.id).maybeSingle();
    PP.perfil=perfil||{id:session.user.id,papel:"pendente"};
    document.querySelector("#userbox").hidden=false;document.querySelector("#userName").textContent=perfil?.nome||session.user.email;
    show(false);
    if(PP.perfil.papel==="pendente"){
      document.body.classList.add("modo-cliente");
      document.querySelector("#main").innerHTML='<div class="card pendente"><h2>Acesso em análise</h2><div>Seu usuário foi criado, mas ainda não recebeu um perfil. Peça ao administrador do escritório para liberar o acesso.</div></div>';
      document.querySelector("#clientList").innerHTML="";
      return; // não resolve: nada carrega
    }
    if(PP.perfil.papel==="cliente"){document.body.classList.add("modo-cliente");S.clientView=true;S.sel=PP.perfil.cliente_id;S.tab="clientes"}
    if(PP.perfil.papel!=="admin")document.body.classList.add("nao-admin");
    PP.podeGrowth=PP.perfil.papel==="admin"||(PP.perfil.acessos||[]).includes("growth");if(!PP.podeGrowth)document.body.classList.add("sem-growth");
    PP.podeFinanceiro=PP.perfil.papel==="admin"||(PP.perfil.acessos||[]).includes("financeiro");if(!PP.podeFinanceiro)document.body.classList.add("sem-financeiro");
    PP.AREAS=["clientes","juridico","comercial","marketing","financeiro","equipe","growth","atendimento","superendividamento"];PP.TAB_AREA={clientes:"clientes",atendimento:"atendimento",historico:"juridico",regras:"admin",calibracao:"admin",processos:"juridico",negociacoes:"juridico",revisional:"juridico",superendividamento:"superendividamento",pecas:"juridico",monitoramento:"juridico",publicacoes:"controle",autenticador:"juridico",leads:"comercial",automacoes:"comercial",comercial:"comercial",marketing:"marketing",financeiro:"financeiro",estoque:"financeiro",inventario:"financeiro",equipe:"equipe",horas:"equipe",growth:"growth",visao:"admin",usuarios:"admin",espelho:"admin"};
    PP.escopoTarefas=()=>PP.perfil.papel==="admin"?{tudo:true}:(PP.perfil.acessos||[]).includes("tarefas_equipe")?{tudo:false,nucleos:["juridico","acordos","acompanhamento_pj"]}:{tudo:false,nucleos:null};
    PP.temAcesso=tab=>{const a=PP.TAB_AREA[tab];if(!a)return true;if(PP.perfil.papel==="admin")return true;if(a==="admin")return false;if(a==="controle")return (PP.perfil.acessos||[]).includes("tarefas_equipe")&&(PP.perfil.acessos||[]).includes("juridico");if(a==="superendividamento")return (PP.perfil.acessos||[]).includes("juridico")||(PP.perfil.acessos||[]).includes("superendividamento");return (PP.perfil.acessos||[]).includes(a)};
    for(const a of PP.AREAS)if(!PP.temAcesso({clientes:"clientes",juridico:"processos",comercial:"leads",marketing:"marketing",financeiro:"financeiro",equipe:"equipe",growth:"growth",atendimento:"atendimento",superendividamento:"superendividamento"}[a]))document.body.classList.add("sem-"+a);
    if(!PP.temAcesso("publicacoes"))document.body.classList.add("sem-controle");
    if(!PP.temAcesso(S.tab))S.tab="painel";
    if(S.tab==="usuarios"&&PP.perfil.papel!=="admin")S.tab="clientes";
    await PP.carregarModulos();
    window.PP_ROTAS.push("espelho","atendimento","painel","processos","superendividamento","growth","visao","feriados","agenda","usuarios","tarefas","horas","equipe","negociacoes","monitoramento","publicacoes","conhecimento","autenticador","marketing","comercial","leads","revisional","pecas","financeiro","perfil","avisos","ponto","estoque","inventario");
    if(equipe()&&aplicarHash())setTimeout(()=>{try{render()}catch(_){}},0);
    if(S.tab==="usuarios"&&PP.perfil.papel!=="admin")S.tab="clientes";
    ligarTempoReal();
    resolve();
  });
});

</script>
<script>`);
}

// 4) Boot: usa o runtime do Supabase e só inicia após login
must('const use=n=>(window.claude&&typeof claude.use==="function")?claude.use(n).catch(()=>null):Promise.resolve(null);');
html = html.replace('const use=n=>(window.claude&&typeof claude.use==="function")?claude.use(n).catch(()=>null):Promise.resolve(null);',
  'await window.__PP_LOGIN; const use=n=>window.__PP_RUNTIME.use(n);');

// 5) Login, perfil, modo cliente, aba Usuários — anexado ao fim do script principal
must('</script>\n');
const extra = `
/* ---------- Usuários (admin) ---------- */
async function renderUsuarios(){
  const v=$("#view-usuarios");v.replaceChildren();
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Acessos"),el("h1",{},"Usuários"),el("div",{class:"sub"},"Para criar um usuário novo: Supabase → Authentication → Users → Add user (com Auto Confirm). Ele aparece aqui como 'pendente'; defina o perfil, as áreas que a pessoa vê e, se for cliente, a empresa. Administradores veem tudo; Tarefas, Agenda e Meu painel são de todos."))));
  const {data:ps,error}=await SB.from("perfis").select("*").order("email");
  if(error){v.append(el("div",{class:"card empty"},"Não foi possível carregar os usuários."));return}
  const PAPEIS={admin:"Administrador",colaborador:"Colaborador",cliente:"Cliente",robo:"Robô (só pautas de marketing)",pendente:"Pendente (sem acesso)"};
  const clientes=[...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||""));
  const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"E-mail"),el("th",{},"Nome"),el("th",{},"Perfil"),el("th",{},"Empresa (se cliente)"),el("th",{},"Áreas (colaborador)"),el("th",{},""))),
    el("tbody",{},ps.map(p=>{
      const nome=inp("text",p.nome||"");
      const papel=sel(PAPEIS,p.papel);
      const cli=sel({"":"—",...Object.fromEntries(clientes.map(c=>[c.id,c.nome]))},p.cliente_id||"");
      const AREAS={clientes:"Clientes",juridico:"Jurídico",comercial:"Comercial",marketing:"Marketing",financeiro:"Financeiro",equipe:"Equipe",growth:"Growth",atendimento:"Atendimento (WhatsApp)",superendividamento:"Superendividamento (só a calculadora)",tarefas_equipe:"Controle do jurídico (tarefas da equipe, Publicações DJEN)"};
      const chks=Object.fromEntries(Object.keys(AREAS).map(a=>[a,el("input",{type:"checkbox",checked:(p.acessos||[]).includes(a)?"":null})]));
      const salvar=el("button",{class:"btn sm primary",onclick:async()=>{
        const acessos=Object.keys(AREAS).filter(a=>chks[a].checked);
        const upd={nome:nome.value.trim(),papel:papel.value,cliente_id:papel.value==="cliente"?(cli.value||null):null,acessos};
        if(papel.value==="cliente"&&!cli.value){toast("Escolha a empresa do cliente");return}
        const {error}=await SB.from("perfis").update(upd).eq("id",p.id);
        if(error){toast("Não foi possível salvar");return}
        // equipe ganha (ou atualiza) o registro em colaboradores, usado como responsável na timeline e nos processos
        if(upd.papel==="admin"||upd.papel==="colaborador"){const {error:e2}=await SB.from("colaboradores").upsert({perfil_id:p.id,nome:upd.nome||p.email},{onConflict:"perfil_id"});if(e2)console.warn(e2)}
        toast("Usuário salvo");
      }},"Salvar");
      return el("tr",{},el("td",{},p.email||"—"),el("td",{},nome),el("td",{},papel),el("td",{},cli),el("td",{},el("div",{style:"display:flex;gap:10px;flex-wrap:wrap"},...Object.entries(AREAS).map(([a,l])=>el("label",{class:"switch",title:a==="admin"?"":"Admins sempre veem tudo."},chks[a]," "+l)))),el("td",{},salvar));
    })));
  v.append(el("div",{class:"card section"},el("div",{class:"tbl"},tb)));
}
{ const _render=render; render=function(){ _render(); const u=$("#view-usuarios"); if(u){u.hidden=S.tab!=="usuarios"; if(S.tab==="usuarios")renderUsuarios()} }; }
`;
if(modo!=='token'){const idx = html.lastIndexOf('</script>');html = html.slice(0,idx) + extra + html.slice(idx);}

// 6) Módulo da carteira (timeline + processos), arquivo separado ao lado do index
must('</body>');
const V=`?v=${Date.now().toString(36)}`;
html = html.replace('</body>', (modo==='token' ? '' : '<script>{const _r=render;render=function(){if(PP.perfil&&PP.temAcesso&&!PP.temAcesso(S.tab)){S.tab="painel";try{localStorage.setItem("pp-tab","painel")}catch(_){}}_r()}}</script>\n') + '</body>');
// Módulos da equipe: lista ordenada (a ordem importa — ficha depende de carteira/tarefas, conhecimento de documentos,
// fechamento de docx-contrato…). Cada módulo diz a quais áreas pertence; o carregador (PP.carregarModulos) só baixa
// os de "core" + as áreas da pessoa (admin = todas; cliente = só carteira e ficha).
const MODULOS = [
  ['carteira','core','cliente'],['tarefas','core'],['prazos','core'],['feriados','core'],['agenda','core'],['notificacoes','core'],
  ['painel','core'],['equipe','equipe'],['rh','equipe'],['dnd','core'],['ficha','core','cliente'],['fluxo','juridico'],
  ['publicacoes','juridico'],['processos','juridico'],['pastas','juridico','clientes'],['publicacoes-tratamento','juridico'],['autenticador','juridico','clientes'],['marketing','marketing'],
  ['comercial','comercial'],['growth','growth'],['financeiro','financeiro'],['central-cobrancas','financeiro'],
  ['estoque','financeiro'],['inventario','financeiro'],['perfil','core'],['avisos','core'],['ponto','core'],['chat','core'],
  ['gestao','admin'],['leads','comercial'],['leads-importar','comercial'],['fluxos-mensagens','comercial'],['automacoes','comercial'],
  ['docx-contrato','comercial'],['fechamento','comercial'],['revisional','juridico'],['pecas','juridico','superendividamento'],
  ['superendividamento','juridico','superendividamento'],['documentos','core'],['conhecimento','core'],['atendimento','atendimento'],['espelho','admin'],
];
const loader = `<script>
PP.MODULOS=${JSON.stringify(MODULOS)};PP.MODULOS_V=${JSON.stringify(V)};PP.modulosCarregados=new Set();
PP.carregarModulos=async function(extra){
  const p=PP.perfil||{};const areas=new Set(extra||[]);
  if(p.papel==="cliente")areas.add("cliente");
  else{areas.add("core");if(p.papel==="admin"){["clientes","juridico","comercial","marketing","financeiro","equipe","growth","admin","atendimento","superendividamento"].forEach(a=>areas.add(a))}else (p.acessos||[]).forEach(a=>areas.add(a))}
  // baixa em paralelo, executa na ordem da lista (async=false)
  const esperas=[];
  for(const [nome,...tags] of PP.MODULOS){
    if(PP.modulosCarregados.has(nome)||!tags.some(t=>areas.has(t)))continue;
    PP.modulosCarregados.add(nome);
    esperas.push(new Promise((ok)=>{const s=document.createElement("script");s.src="passivos/"+nome+".js"+PP.MODULOS_V;s.async=false;s.onload=ok;s.onerror=()=>{console.warn("módulo não carregou:",nome);ok()};document.body.appendChild(s)}));
  }
  await Promise.all(esperas);
};
</script>
`;
html = html.replace('</body>', modo==='token' ? `<script src="../passivos/carteira.js${V}"></script>\n<script src="../passivos/ficha.js${V}"></script>\n</body>` : loader + '</body>');
if(modo==='token'){
  html = html.replace('<title>Sistema interno — Neves Pádua Advocacia</title>','<title>Área do cliente — Neves Pádua Advocacia</title>');
  html = html.replace('<div id="view-usuarios" hidden class="main"></div>','');
  html = html.replace(/url\(passivos\/fontes\//g,'url(../passivos/fontes/').replace(/src="passivos\/img\//g,'src="../passivos/img/');
}
return html;
}

fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out, gerar('login')); console.log('ok', out);
if(!ESPELHO){ fs.mkdirSync(path.dirname(outToken),{recursive:true}); fs.writeFileSync(outToken, gerar('token')); console.log('ok', outToken); }
else { // copia os módulos, fontes e imagens para beta/passivos
  const src = path.join(base,'..','passivos'), dst = path.join(path.dirname(out),'passivos');
  fs.rmSync(dst,{recursive:true,force:true}); fs.mkdirSync(dst,{recursive:true});
  for (const f of fs.readdirSync(src)) { const p = path.join(src,f); if (fs.statSync(p).isDirectory()) fs.cpSync(p, path.join(dst,f), {recursive:true}); else if (f.endsWith('.js')) fs.copyFileSync(p, path.join(dst,f)); }
  console.log('ok', dst);
}
