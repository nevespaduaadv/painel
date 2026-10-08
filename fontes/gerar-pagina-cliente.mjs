// [LEGADO] Gera uma página fixa (sem login, sem banco) para UM cliente a partir de um snapshot JSON do banco antigo (artefato).
// Mantido só para referência: a área do cliente agora é a versão conectada ao Supabase (passivos/). Não use para novos clientes.
// Uso: node gerar-pagina-cliente.mjs <clienteId> <saida.html>
import fs from 'fs';
import path from 'path';
const [,, clienteId, out] = process.argv;
if(!clienteId||!out){console.error('uso: node gerar-pagina-cliente.mjs <clienteId> <saida.html>');process.exit(1)}
const base = path.dirname(new URL(import.meta.url).pathname);
const snap = path.join(base,'snapshot');
const readDir = d => fs.existsSync(path.join(snap,d)) ? fs.readdirSync(path.join(snap,d)).filter(f=>f.endsWith('.json')).map(f=>{const j=JSON.parse(fs.readFileSync(path.join(snap,d,f),'utf8'));const data=(j.data&&typeof j.data==="object"&&!Array.isArray(j.data))?j.data:j;return {id:j.id??f.replace(/\.json$/,''),...data}}) : [];
const clientes = readDir('clientes').filter(c=>c.id===clienteId);
if(!clientes.length){console.error('cliente não encontrado no snapshot:',clienteId);process.exit(1)}
const contratos = readDir('contratos').filter(k=>k.clienteId===clienteId).map(k=>({...k,notas:""})); // notas internas nunca saem
const historico = readDir('historico');
const regrasFile = path.join(snap,'config','regras.json');
const regras = fs.existsSync(regrasFile) ? (JSON.parse(fs.readFileSync(regrasFile,'utf8')).data ?? JSON.parse(fs.readFileSync(regrasFile,'utf8'))) : null;
const cliente = {...clientes[0], notasInternas:""};

let html = fs.readFileSync(path.join(base,'painel.html'),'utf8');
const gerado = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
// título específico
html = html.replace(/<title>[^<]*<\/title>/, `<title>Painel ${cliente.nome.split(' (')[0]}</title>`);
// CSS: esconde lista, abas e alternador; força uma coluna
html = html.replace('</style>', `
.side,.tabs,.switch{display:none!important}
.grid{grid-template-columns:1fr}
.stamp{font-size:12px;color:var(--faint);text-align:right;margin-top:-6px}
</style>`);
// dados embutidos + stub do runtime (sem banco): a página renderiza em modo somente leitura / visão do cliente
const mock = JSON.stringify({clientes:[cliente],contratos,historico,regras});
html = html.replace('<script>', `<script>
window.__SNAPSHOT=${mock};
window.__PP_RUNTIME={use:async(n)=>{
  if(n==="db")return {
    doc:(p)=>({onSnapshot:(cb)=>{cb({exists:p==="config/regras"&&window.__SNAPSHOT.regras,data:()=>window.__SNAPSHOT.regras})},set:async()=>{},update:async()=>{},delete:async()=>{}}),
    collection:(c)=>({onSnapshot:(cb)=>{const rows=window.__SNAPSHOT[c]||[];cb({docs:rows.map(r=>({id:r.id,data:()=>r}))})},add:async()=>({id:"x"})})
  };
  if(n==="user")return {can:async()=>false,id:async()=>null};
  return null;
}};
</script>
<script>`);
// o runtime do host pode redefinir window.claude depois do nosso script: o boot passa a ler o snapshot diretamente
const bootLine='const use=n=>(window.claude&&typeof claude.use==="function")?claude.use(n).catch(()=>null):Promise.resolve(null);';
if(!html.includes(bootLine)){console.error('linha de boot não encontrada em index.html');process.exit(1)}
html = html.replace(bootLine,'const use=n=>window.__PP_RUNTIME.use(n);');
// cabeçalho: data da posição em vez da data do cálculo
html = html.replace('`Atualizado em ${fmtD(hoje())}`', JSON.stringify('Posição de '+gerado.split(',')[0]));
// carimbo de geração no rodapé
html = html.replace('<div id="modalHost"></div>', `<div class="wrap" style="padding-block:0 24px"><div class="stamp">Posição gerada em ${gerado} · Neves Pádua Advocacia</div></div>\n<div id="modalHost"></div>`);
fs.writeFileSync(out, html);
console.log('ok', out, contratos.length, 'contratos');
