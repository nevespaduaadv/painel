// Comparação visual da tela de login (sem credenciais, sem dados) entre uma referência exportada
// (ex.: git archive main | tar -x -C /tmp/np-main) e o repositório atual, em claro/escuro.
// Roda FORA do projeto (precisa de playwright e pngjs onde for executado):
//   NODE_PATH=<módulos> node docs/qa/comparar-visual.cjs /tmp/np-main [largura] [rodadas]
//
// Determinismo: neutraliza cursor, animações e transições, e só fotografa depois que TODAS as fontes
// usadas estão carregadas (document.fonts.check). Sem isso, a EB Garamond do Google Fonts chega por
// rede em momento variável e o h1 "Neves Pádua Advocacia" pode sair na fonte de reserva — foi a origem
// de uma diferença de ~512 px (faixa do h1, 19 px de altura) vista em 11/11/2026, reproduzida ao bloquear
// só o arquivo da EB Garamond 500. Se as fontes não carregarem em 10 s, a rodada é marcada INCONCLUSIVA.
const {chromium}=require('playwright');const {PNG}=require('pngjs');
const REF=process.argv[2]||'/tmp/np-main';const W=+(process.argv[3]||1440);const R=+(process.argv[4]||2);
// faces efetivamente usadas na tela de login (h1 em EB Garamond 500; texto em General Sans 400/500/600)
const FONTES=['400 14px "General Sans"','500 14px "General Sans"','600 14px "General Sans"','500 26px "EB Garamond"'];
(async()=>{const b=await chromium.launch();
async function shot(dir,cs){const ctx=await b.newContext({colorScheme:cs,viewport:{width:W,height:W===375?812:900}});const pg=await ctx.newPage();await pg.goto('file://'+dir+'/index.html',{waitUntil:'load'});
 let prontas=false;for(let i=0;i<50&&!prontas;i++){prontas=await pg.evaluate(async F=>{await Promise.all(F.map(f=>document.fonts.load(f).catch(()=>[])));await document.fonts.ready;return F.every(f=>document.fonts.check(f))},FONTES);if(!prontas)await pg.waitForTimeout(200)}
 await pg.evaluate(()=>document.activeElement&&document.activeElement.blur());await pg.addStyleTag({content:'*{caret-color:transparent!important;animation:none!important;transition:none!important}'});await pg.waitForTimeout(200);
 const png=PNG.sync.read(await pg.screenshot());await ctx.close();return {png,prontas}}
function diff(a,c){let d=0,minx=1e9,miny=1e9,maxx=0,maxy=0;for(let i=0;i<a.data.length;i+=4){if(a.data[i]!==c.data[i]||a.data[i+1]!==c.data[i+1]||a.data[i+2]!==c.data[i+2]){d++;const px=(i/4)%a.width,py=Math.floor(i/4/a.width);minx=Math.min(minx,px);maxx=Math.max(maxx,px);miny=Math.min(miny,py);maxy=Math.max(maxy,py)}}return d?{d,box:[minx,miny,maxx,maxy]}:{d}}
let inconclusivas=0,reais=0;
for(const cs of ['light','dark'])for(let r=0;r<R;r++){const m1=await shot(REF,cs),m2=await shot(REF,cs),f=await shot(process.cwd(),cs);
 if(!(m1.prontas&&m2.prontas&&f.prontas)){inconclusivas++;console.log(W+'px',cs,'rodada',r,'INCONCLUSIVA (fontes não carregaram em 10 s)');continue}
 const ruido=diff(m1.png,m2.png),real=diff(m1.png,f.png);if(real.d)reais++;console.log(W+'px',cs,'rodada',r,'fontes ok · ref×ref (ruído)',JSON.stringify(ruido),'· ref×atual',JSON.stringify(real))}
console.log(`resumo ${W}px: ${reais} rodada(s) com diferença real, ${inconclusivas} inconclusiva(s)`);await b.close();process.exit(reais?1:0)})();
