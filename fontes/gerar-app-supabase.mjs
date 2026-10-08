// Gera passivos/index.html (painel com login) e cliente/index.html (acesso por token) a partir de fontes/painel.html.
// Uso: node fontes/gerar-app-supabase.mjs
import fs from 'fs';
import path from 'path';
const base = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] || path.join(base,'..','passivos','index.html');
const SUPABASE_URL = 'https://ksdwzljfjfucjevdqxvx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tt__gxUjGaujzylisID0KQ_qaeaU1-l';
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
.login{position:fixed;inset:0;background:var(--navy);display:flex;align-items:center;justify-content:center;padding:24px;z-index:50}
.login .card{width:min(420px,100%);padding:28px;display:flex;flex-direction:column;gap:14px}
.login .eyebrow{color:var(--gold)}
.login h1{font-size:26px}
.login .f input{padding:10px 12px}
.login .err{color:var(--crit);font-size:13px;min-height:18px}
.login .btn.primary{width:100%;padding:11px}
.modo-cliente .side,.modo-cliente .tabs,.modo-cliente .switch{display:none!important}
.modo-cliente .grid{grid-template-columns:1fr}
.nao-admin .admin-only{display:none!important}
.userbox{display:flex;align-items:center;gap:10px;color:#D7D2C6;font-size:13px}
.userbox .btn{background:transparent;color:#D7D2C6;border-color:#3B5074;padding:5px 10px;font-size:13px;text-decoration:none}
.pendente{text-align:center;padding:48px 20px;color:var(--muted)}
.pendente h2{color:var(--fg);margin-bottom:8px}
</style>`);

// 2) Cabeçalho: aba Usuários (admin) + caixa do usuário com Sair
must('<label class="switch edit-only">');
html = html.replace('<label class="switch edit-only"><input type="checkbox" id="viewClient"> Visão do cliente</label>',
  '<label class="switch edit-only"><input type="checkbox" id="viewClient"> Visão do cliente</label>\n  <div class="userbox" id="userbox" hidden><a class="btn" href="../">Portal</a><span id="userName"></span><button class="btn" id="btnSair">Sair</button></div>');
must('<div id="view-calibracao" hidden class="main"></div>');
must('/*NAV_JURIDICO*/');
html = html.replace('/*NAV_JURIDICO*/', '{tab:"tarefas",label:"Tarefas e prazos"},{tab:"negociacoes",label:"Negociações"},{tab:"monitoramento",label:"Monitoramento"},{tab:"publicacoes",label:"Publicações (DJEN)"},');
must('/*NAV_GRUPOS*/');
html = html.replace('/*NAV_GRUPOS*/', '{grupo:"equipe",label:"Equipe",cls:"edit-only",itens:[{tab:"equipe",label:"Colaboradores"},{tab:"horas",label:"Horas"},{tab:"usuarios",label:"Usuários",cls:"admin-only"}]},{link:"../gestao/",label:"Gestão",cls:"edit-only"}');
html = html.replace('<div id="view-calibracao" hidden class="main"></div>', '<div id="view-calibracao" hidden class="main"></div>\n  <div id="view-usuarios" hidden class="main"></div>\n  <div id="view-tarefas" hidden class="main"></div>\n  <div id="view-horas" hidden class="main"></div>\n  <div id="view-equipe" hidden class="main"></div>\n  <div id="view-negociacoes" hidden class="main"></div>\n  <div id="view-monitoramento" hidden class="main"></div>\n  <div id="view-publicacoes" hidden class="main"></div>');

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
    <div class="eyebrow">Neves Pádua Advocacia</div>
    <h1>Painel de Passivos Bancários</h1>
    <div class="f"><label for="l-email">E-mail</label><input id="l-email" type="email" autocomplete="username" placeholder="voce@empresa.com.br"></div>
    <div class="f"><label for="l-senha">Senha</label><input id="l-senha" type="password" autocomplete="current-password"></div>
    <div class="err" id="l-err"></div>
    <button class="btn primary" id="l-btn">Entrar</button>
    <div class="note">Acesso restrito à equipe do escritório e aos clientes convidados. Esqueceu a senha? Fale com o escritório.</div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
/* ---------- Runtime Supabase: mesma interface do banco do protótipo (doc/collection/onSnapshot) ---------- */
const SB = window.supabase.createClient(${JSON.stringify(SUPABASE_URL)}, ${JSON.stringify(SUPABASE_KEY)});
const PP = {perfil:null, listeners:{}, cache:{}};
const TABELAS = {clientes:"clientes", contratos:"contratos", historico:"historico"};
const NOTA_CAMPO = {clientes:"notasInternas", contratos:"notas"};
const FICHA_COLS = ["nome","ativo","cpf_titular","tipo_pessoa","nome_fantasia","cidade","uf","segmento","faturamento_mensal","funcionarios","historia","situacao_atual","origem","closer","data_fechamento","data_onboarding","plano","status","negativado","usa_maquininha","tem_consorcio","outros_cnpjs","assuntos_interesse","disponibilidade","observacoes_onboarding","proxima_reuniao","created_at","updated_at","estagio_registrado","etapa_fluxo","tem_divida_atraso","adimplente","possui_processos","projeto_reserva","regua","servico","tipos_dividas","responsavel_onboarding_id","notion_url"];
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
    if(S.tab==="usuarios"&&PP.perfil.papel!=="admin")S.tab="clientes";
    window.PP_ROTAS.push("usuarios","tarefas","horas","equipe","negociacoes","monitoramento","publicacoes");
    if(equipe())aplicarHash();
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
  v.append(el("div",{class:"head"},el("div",{},el("div",{class:"eyebrow"},"Acessos"),el("h1",{},"Usuários"),el("div",{class:"sub"},"Para criar um usuário novo: Supabase → Authentication → Users → Add user (com Auto Confirm). Ele aparece aqui como 'pendente'; defina o perfil e, se for cliente, a empresa."))));
  const {data:ps,error}=await SB.from("perfis").select("*").order("email");
  if(error){v.append(el("div",{class:"card empty"},"Não foi possível carregar os usuários."));return}
  const PAPEIS={admin:"Administrador",colaborador:"Colaborador",cliente:"Cliente",pendente:"Pendente (sem acesso)"};
  const clientes=[...S.clientes].sort((a,b)=>(a.nome||"").localeCompare(b.nome||""));
  const tb=el("table",{},el("thead",{},el("tr",{},el("th",{},"E-mail"),el("th",{},"Nome"),el("th",{},"Perfil"),el("th",{},"Empresa (se cliente)"),el("th",{},""))),
    el("tbody",{},ps.map(p=>{
      const nome=inp("text",p.nome||"");
      const papel=sel(PAPEIS,p.papel);
      const cli=sel({"":"—",...Object.fromEntries(clientes.map(c=>[c.id,c.nome]))},p.cliente_id||"");
      const salvar=el("button",{class:"btn sm primary",onclick:async()=>{
        const upd={nome:nome.value.trim(),papel:papel.value,cliente_id:papel.value==="cliente"?(cli.value||null):null};
        if(papel.value==="cliente"&&!cli.value){toast("Escolha a empresa do cliente");return}
        const {error}=await SB.from("perfis").update(upd).eq("id",p.id);
        if(error){toast("Não foi possível salvar");return}
        // equipe ganha (ou atualiza) o registro em colaboradores, usado como responsável na timeline e nos processos
        if(upd.papel==="admin"||upd.papel==="colaborador"){const {error:e2}=await SB.from("colaboradores").upsert({perfil_id:p.id,nome:upd.nome||p.email},{onConflict:"perfil_id"});if(e2)console.warn(e2)}
        toast("Usuário salvo");
      }},"Salvar");
      return el("tr",{},el("td",{},p.email||"—"),el("td",{},nome),el("td",{},papel),el("td",{},cli),el("td",{},salvar));
    })));
  v.append(el("div",{class:"card section"},el("div",{class:"tbl"},tb)));
}
{ const _render=render; render=function(){ _render(); const u=$("#view-usuarios"); if(u){u.hidden=S.tab!=="usuarios"; if(S.tab==="usuarios")renderUsuarios()} }; }
`;
if(modo!=='token'){const idx = html.lastIndexOf('</script>');html = html.slice(0,idx) + extra + html.slice(idx);}

// 6) Módulo da carteira (timeline + processos), arquivo separado ao lado do index
must('</body>');
html = html.replace('</body>', modo==='token' ? '<script src="../passivos/carteira.js"></script>\n<script src="../passivos/ficha.js"></script>\n</body>' : '<script src="carteira.js"></script>\n<script src="tarefas.js"></script>\n<script src="equipe.js"></script>\n<script src="ficha.js"></script>\n<script src="fluxo.js"></script>\n<script src="publicacoes.js"></script>\n</body>');
if(modo==='token'){
  html = html.replace('<title>Painel de Passivos</title>','<title>Área do cliente — Neves Pádua Advocacia</title>');
  html = html.replace('<div id="view-usuarios" hidden class="main"></div>','');
}
return html;
}

fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out, gerar('login')); console.log('ok', out);
fs.mkdirSync(path.dirname(outToken),{recursive:true}); fs.writeFileSync(outToken, gerar('token')); console.log('ok', outToken);
