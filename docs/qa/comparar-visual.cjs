// Comparação visual da tela de login (sem credenciais, sem dados) entre uma referência exportada
// (ex.: git archive main | tar -x -C /tmp/np-main) e o repositório atual, em claro/escuro.
// Roda FORA do projeto (precisa de playwright e pngjs instalados onde for executado):
//   NODE_PATH=<onde estão os módulos> node docs/qa/comparar-visual.cjs /tmp/np-main [largura]
// Neutraliza o que é dinâmico (cursor piscando, animações, transições) para que só diferença real conte.
const {chromium}=require('playwright');const {PNG}=require('pngjs');
const REF=process.argv[2]||'/tmp/np-main';const W=+(process.argv[3]||1440);
(async()=>{const b=await chromium.launch();
async function shot(dir,cs){const ctx=await b.newContext({colorScheme:cs,viewport:{width:W,height:W===375?812:900}});const pg=await ctx.newPage();await pg.goto('file://'+dir+'/index.html',{waitUntil:'load'});await pg.waitForTimeout(1500);await pg.evaluate(()=>document.activeElement&&document.activeElement.blur());await pg.addStyleTag({content:'*{caret-color:transparent!important;animation:none!important;transition:none!important}'});await pg.waitForTimeout(200);const png=PNG.sync.read(await pg.screenshot());await ctx.close();return png}
function diff(a,c){let d=0,minx=1e9,miny=1e9,maxx=0,maxy=0;for(let i=0;i<a.data.length;i+=4){if(a.data[i]!==c.data[i]||a.data[i+1]!==c.data[i+1]||a.data[i+2]!==c.data[i+2]){d++;const px=(i/4)%a.width,py=Math.floor(i/4/a.width);minx=Math.min(minx,px);maxx=Math.max(maxx,px);miny=Math.min(miny,py);maxy=Math.max(maxy,py)}}return {d,box:d?[minx,miny,maxx,maxy]:null}}
for(const cs of ['light','dark'])for(let r=0;r<2;r++){const m1=await shot(REF,cs),m2=await shot(REF,cs),f=await shot(process.cwd(),cs);console.log(W+'px',cs,'rodada',r,'ref×ref (ruído)',JSON.stringify(diff(m1,m2)),'ref×atual',JSON.stringify(diff(m1,f)))}
await b.close()})();
