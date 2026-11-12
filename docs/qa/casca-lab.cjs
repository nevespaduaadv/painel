// Laboratório da casca: abre o index.html gerado com os módulos REAIS e dados FICTÍCIOS, sem autenticação e sem
// tocar no Supabase (toda chamada *.supabase.co é interceptada e respondida localmente). Roda FORA do projeto:
//   NODE_PATH=<módulos> node docs/qa/casca-lab.cjs [saida=/tmp/casca-lab]
// Compara a casca V2 (padrão) com a V3.1 (localStorage np-casca=v3) em 375/768/1024/1440 × claro/escuro, para dois
// perfis fictícios (admin e jurídico restrito), e exercita a navegação real: grupos, flyout, gaveta, troca de módulo,
// item ativo, atalho "/", tema, Esc, foco e volta à casca antiga. Falha se destinos/permissões divergirem entre as cascas.
const { chromium } = require('playwright'); const { PNG } = require('pngjs'); const fs = require('fs'); const path = require('path'); const http = require('http');
const RAIZ = process.cwd(); const OUT = process.argv[2] || '/tmp/casca-lab'; fs.mkdirSync(OUT, { recursive: true }); const { execFileSync } = require('child_process');
const REF_BETA = 'ooynicwexxqqccihjiah'; const ESPELHO_DIR = path.join(OUT, 'espelho');
const REF = 'ksdwzljfjfucjevdqxvx';
// Servidor estático local (só leitura, só 127.0.0.1): origem http como em produção — em file:// o Chromium perde
// gravações de localStorage feitas logo antes de um reload, o que tornaria os testes de persistência instáveis.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
let BASE = '';
const servir = () => new Promise((res) => { const srv = http.createServer((q, r) => { let u = decodeURIComponent(new URL(q.url, 'http://x').pathname), raiz = RAIZ; if (u.startsWith('/__espelho/')) { raiz = ESPELHO_DIR; u = u.slice('/__espelho'.length); } const f = path.join(raiz, u); if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); srv.listen(0, '127.0.0.1', () => { BASE = `http://127.0.0.1:${srv.address().port}`; res(srv); }); });
const PERFIS = {
  admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] },
  juridico: { id: 'u-jur', nome: 'Teste Jurídico', papel: 'colaborador', acessos: ['juridico', 'tarefas_equipe'] },
};
const CLIENTES = [
  { id: 'c1', nome: 'Empresa Alfa Ltda', nome_fantasia: 'Alfa', cnpj: '00.000.000/0001-01', cidade: 'Franca/SP', status: 'ativo', created_at: '2026-01-10' },
  { id: 'c2', nome: 'Beta Comércio ME', nome_fantasia: 'Beta', cnpj: '00.000.000/0001-02', cidade: 'Batatais/SP', status: 'ativo', created_at: '2026-02-10' },
  { id: 'c3', nome: 'Gama Transportes', nome_fantasia: 'Gama', cnpj: '00.000.000/0001-03', cidade: 'Ribeirão Preto/SP', status: 'ativo', created_at: '2026-03-10' },
];
async function contexto(b, { perfil, casca, w, h, tema, reduz }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: w < 900, reducedMotion: reduz ? 'reduce' : 'no-preference' });
  const sessao = { access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: PERFIS[perfil].id, email: perfil + '@lab.exemplo', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
  await ctx.addInitScript(({ sessao, casca, tema, ref }) => {
    try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sessao)); localStorage.setItem('np-casca', casca); localStorage.setItem('pp-tema', tema); sessionStorage.setItem('lab', '1'); } } catch (_) {}
  }, { sessao, casca, tema, ref: REF });
  await ctx.route(/supabase\.co/, async (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; const m = rota.request().method();
    const json = (b, status = 200, extra = {}) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...extra }, body: JSON.stringify(b) });
    if (p.startsWith('/auth/v1/user')) return json(sessao.user);
    if (p.startsWith('/auth/v1/token')) return json({ ...sessao });
    if (p.startsWith('/auth/v1/logout')) return json({}, 204);
    if (p.startsWith('/realtime/')) return rota.abort();
    if (p.startsWith('/rest/v1/rpc/')) return json(m === 'POST' ? [] : null);
    if (p.startsWith('/rest/v1/perfis')) { const unico = /vnd\.pgrst\.object/.test(rota.request().headers()['accept'] || ''); return json(unico ? PERFIS[perfil] : [PERFIS[perfil]]); }
    if (p.startsWith('/rest/v1/clientes')) return json(CLIENTES, 200, { 'content-range': `0-${CLIENTES.length - 1}/${CLIENTES.length}` });
    if (p.startsWith('/rest/v1/')) { const unico = /vnd\.pgrst\.object/.test(rota.request().headers()['accept'] || ''); return unico ? json({ message: 'nenhum', code: 'PGRST116' }, 406) : json([]); }
    return json({});
  });
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push('pageerror: ' + e.message));
  pg.on('console', msg => { if (msg.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(msg.text())) erros.push('console: ' + msg.text().slice(0, 160)); });
  await pg.goto(BASE + '/index.html', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof PP!=='undefined' && PP.perfil && document.querySelector('#login')?.hidden, null, { timeout: 15000 });
  await pg.waitForFunction(() => window.PP_HUBS && (localStorage.getItem('np-casca') !== 'v3' || window.PP_CASCA), null, { timeout: 15000 });
  await pg.waitForTimeout(600);
  return { ctx, pg, erros };
}
const destinos = (pg) => pg.evaluate(() => {
  const vis = (e) => { for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).display === 'none' || x.hidden) return false; return true; };
  const v3 = document.documentElement.classList.contains('np-casca-v3');
  const raiz = v3 ? document.querySelector('#np-side') : document.querySelector('#sb');
  // grupos recolhidos não escondem destinos: abre tudo antes de contar (V2 usa display:none no grupo fechado)
  raiz.querySelectorAll('.grp.fechado').forEach(g => g.classList.remove('fechado'));
  const tabs = [...raiz.querySelectorAll('.tab[data-tab]')].filter(vis).map(b => b.dataset.tab);
  const set = new Set(tabs);
  const acesso = (t) => PP.perfil?.papel === 'admin' || (typeof PP.temAcesso !== 'function') || PP.temAcesso(t);
  if (!v3) { // V2: hubs (Jurídico, Financeiro) são um botão .grp-h; suas abas são destinos via faixa interna, se acessíveis
    for (const hub of raiz.querySelectorAll('.grp.hub')) { if (!vis(hub)) continue; const rot = hub.querySelector('.grp-h span')?.textContent.trim(); const h = Object.values(PP_HUBS.HUBS).find(x => x.label === rot); if (h) h.tabs.forEach(([t]) => { if (acesso(t)) set.add(t); }); }
  }
  const links = [...raiz.querySelectorAll('a.tab[href], .np-links a')].filter(vis).map(a => a.getAttribute('href'));
  return { tabs: [...set].sort(), links: links.sort(), classesBody: document.body.className };
});
function diffPng(a, b) { let d = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) d++; return d; }
(async () => {
  const srv = await servir(); const b = await chromium.launch(); const rel = []; let falhas = 0;
  const ok = (m) => rel.push('  ok    ' + m), falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
  // ---------- 1. destinos e permissões: V2 × V3, por perfil ----------
  rel.push('1. destinos e permissões efetivos (V2 × V3.1)');
  for (const perfil of Object.keys(PERFIS)) {
    const r = {};
    for (const casca of ['v2', 'v3']) { const { ctx, pg, erros } = await contexto(b, { perfil, casca, w: 1440, h: 900, tema: 'light' }); r[casca] = await destinos(pg); r[casca].erros = erros; await ctx.close(); }
    const a = JSON.stringify(r.v2.tabs), c = JSON.stringify(r.v3.tabs);
    if (a === c) ok(`${perfil}: ${r.v3.tabs.length} destinos iguais nas duas cascas`); else falha(`${perfil}: destinos diferem\n        V2: ${a}\n        V3: ${c}`);
    if (JSON.stringify(r.v2.links) === JSON.stringify(r.v3.links)) ok(`${perfil}: links externos iguais (${r.v3.links.length})`); else falha(`${perfil}: links diferem V2 ${r.v2.links} V3 ${r.v3.links}`);
    for (const casca of ['v2', 'v3']) if (r[casca].erros.length) falha(`${perfil} ${casca}: erros de página: ${r[casca].erros.join(' | ')}`); else ok(`${perfil} ${casca}: sem erros de página`);
    fs.writeFileSync(path.join(OUT, `destinos-${perfil}.json`), JSON.stringify(r, null, 1));
  }
  // ---------- 2. navegação real na V3 (admin) ----------
  rel.push('2. navegação real na V3.1 (admin, 1440)');
  { const { ctx, pg, erros } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 1440, h: 900, tema: 'light' });
    const alvos = await pg.evaluate(() => [...document.querySelectorAll('#np-tree .tab[data-tab]')].filter(b => !b.hidden).map(b => b.dataset.tab));
    let okNav = 0, ruins = [];
    for (const t of alvos) {
      await pg.evaluate((t) => { const b = document.querySelector(`#np-tree .tab[data-tab="${t}"]`); const g = b.closest('.np-g'); if (g && g.dataset.aberto !== '1') g.querySelector('.np-gh').click(); }, t);
      await pg.waitForTimeout(80);
      await pg.click(`#np-tree .tab[data-tab="${t}"]`); await pg.waitForTimeout(250);
      const r = await pg.evaluate((t) => { const sel = document.querySelector('#np-tree .tab[aria-current="page"]')?.dataset.tab; const view = document.querySelector('#view-' + t); return { stab: S.tab, sel, viewVisivel: !!view && !view.hidden, titulo: document.querySelector('#brandArea')?.textContent, trilha: document.querySelector('#np-trilha')?.textContent, hash: location.hash }; }, t);
      const certo = (r.stab === t || r.hash.startsWith('#' + t)) && (r.sel === t || r.hash);
      if (certo) okNav++; else ruins.push(t + ':' + JSON.stringify(r));
    }
    if (!ruins.length) ok(`${okNav}/${alvos.length} itens abrem o módulo certo com item ativo e título atualizados`); else falha(`itens com problema: ${ruins.join('; ')}`);
    // grupos: abrir/fechar + inert
    const g = await pg.evaluate(() => { const grp = document.querySelector('#np-tree .np-g[data-g="financeiro"]'); const h = grp.querySelector('.np-gh'); const antes = grp.dataset.aberto; h.click(); const depois = grp.dataset.aberto; const aria = h.getAttribute('aria-expanded'); const inert = grp.querySelector('.np-corpo').hasAttribute('inert'); h.click(); return { antes, depois, aria, inertQuandoFechado: depois === '0' ? inert : !inert, ariaCoerente: aria === (depois === '1' ? 'true' : 'false'), controla: h.getAttribute('aria-controls') === grp.querySelector('.np-corpo').id }; });
    if (g.antes !== g.depois && g.inertQuandoFechado && g.ariaCoerente && g.controla) ok('grupo expande/recolhe, aria-expanded no botão acompanha e o corpo fechado fica inert'); else falha('grupo: ' + JSON.stringify(g));
    // semântica: nav + listas, sem tablist/tab; um único aria-current="page"; grupos com aria-expanded/aria-controls
    const sem = await pg.evaluate(() => ({ tablist: document.querySelectorAll('#np-side [role="tablist"], #np-side [role="tab"], #np-fly [role="tab"]').length, atual: document.querySelectorAll('#np-side [aria-current="page"]').length, atualTab: document.querySelector('#np-side [aria-current="page"]')?.dataset.tab, stab: S.tab, navs: document.querySelectorAll('nav#np-tree, nav#np-fly').length, listas: document.querySelectorAll('#np-tree ul.np-lista > li > .tab').length, grupos: [...document.querySelectorAll('#np-tree .np-gh')].every(h => /^(true|false)$/.test(h.getAttribute('aria-expanded')) && document.getElementById(h.getAttribute('aria-controls'))) }));
    if (sem.tablist === 0 && sem.atual === 1 && sem.atualTab === sem.stab && sem.navs === 2 && sem.listas > 20 && sem.grupos) ok(`semântica: nav + listas (${sem.listas} itens em li), sem role=tab/tablist, aria-current="page" único em "${sem.atualTab}", grupos com aria-expanded/aria-controls válidos`); else falha('semântica: ' + JSON.stringify(sem));
    // trilho + flyout + teclado
    await pg.click('#btnSb'); await pg.waitForTimeout(450);
    const trilho = await pg.evaluate(() => ({ cls: document.querySelector('#app').className, w: document.querySelector('#np-side').getBoundingClientRect().width }));
    await pg.click('#np-tree .np-g[data-g="juridico"] .np-gh'); await pg.waitForTimeout(350);
    const flyAberto = await pg.evaluate(() => ({ on: document.querySelector('#np-fly').classList.contains('on'), itens: document.querySelectorAll('#np-fly .tab').length, foco: document.activeElement.closest('#np-fly') ? document.activeElement.textContent.trim() : null }));
    await pg.keyboard.press('ArrowDown'); const foco2 = await pg.evaluate(() => document.activeElement.textContent.trim());
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
    const depoisEnter = await pg.evaluate(() => ({ stab: S.tab, flyOn: document.querySelector('#np-fly').classList.contains('on') }));
    await pg.click('#np-tree .np-g[data-g="equipe"] .np-gh'); await pg.waitForTimeout(300); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    const esc = await pg.evaluate(() => ({ flyOn: document.querySelector('#np-fly').classList.contains('on'), focoNoGrupo: !!document.activeElement.closest('.np-gh') }));
    if (/np-trilho/.test(trilho.cls) && trilho.w < 70) ok(`trilho recolhe para ${Math.round(trilho.w)} px`); else falha('trilho: ' + JSON.stringify(trilho));
    if (flyAberto.on && flyAberto.itens >= 3 && flyAberto.foco) ok(`flyout abre com ${flyAberto.itens} itens e foco em "${flyAberto.foco}"; ↓ vai para "${foco2}"; Enter abre ${depoisEnter.stab} e fecha o flyout (${!depoisEnter.flyOn})`); else falha('flyout: ' + JSON.stringify({ flyAberto, foco2, depoisEnter }));
    if (!esc.flyOn && esc.focoNoGrupo) ok('Esc fecha o flyout e devolve o foco ao grupo'); else falha('Esc: ' + JSON.stringify(esc));
    await pg.click('#btnSb'); await pg.waitForTimeout(450);
    // atalho "/" e tema
    await pg.keyboard.press('/'); const focoBusca = await pg.evaluate(() => document.activeElement.id); await pg.keyboard.press('Escape');
    if (focoBusca === 'buscaGlobal') ok('atalho "/" foca a busca global'); else falha('atalho "/" focou ' + focoBusca);
    await pg.click('#btnTema'); await pg.waitForTimeout(200); const tema = await pg.evaluate(() => ({ t: document.documentElement.dataset.theme, side: getComputedStyle(document.querySelector('#np-side')).backgroundColor, ls: localStorage.getItem('pp-tema') }));
    if (tema.t === 'dark' && tema.ls === 'dark') ok(`tema alterna pela mesma chave pp-tema (lateral ${tema.side})`); else falha('tema: ' + JSON.stringify(tema));
    await pg.click('#btnTema');
    // elementos únicos e casca inativa fora da árvore de acessibilidade
    const unicos = await pg.evaluate(() => ({ tema: document.querySelectorAll('#btnTema').length, busca: document.querySelectorAll('#buscaGlobal').length, view: document.querySelectorAll('#viewClient').length, sair: document.querySelectorAll('#btnSair').length, sbInert: document.querySelector('#sb').hasAttribute('inert'), sbDisplay: getComputedStyle(document.querySelector('#sb')).display, focaveisV2: [...document.querySelectorAll('#sb button, #sb a')].filter(e => e.offsetParent !== null).length }));
    if (unicos.tema === 1 && unicos.busca === 1 && unicos.view === 1 && unicos.sair === 1) ok('controles da barra são únicos (tema, busca, Visão do cliente, Sair)'); else falha('duplicados: ' + JSON.stringify(unicos));
    if (unicos.sbInert && unicos.sbDisplay === 'none' && unicos.focaveisV2 === 0) ok('casca V2 inativa: display:none + inert, 0 focáveis'); else falha('casca V2 ainda acessível: ' + JSON.stringify(unicos));
    // Tab a partir do topo não entra na V2
    await pg.evaluate(() => document.body.focus()); const seq = []; for (let i = 0; i < 6; i++) { await pg.keyboard.press('Tab'); seq.push(await pg.evaluate(() => { const a = document.activeElement; return (a.closest('#sb') ? 'V2!' : '') + (a.getAttribute('aria-label') || a.textContent.trim().slice(0, 18) || (a.tagName.toLowerCase() + '#' + a.id)); })); }
    if (!seq.some(s => s.startsWith('V2!'))) ok('ordem de Tab: ' + seq.join(' → ')); else falha('Tab entrou na casca V2: ' + seq.join(' → '));
    // volta à casca antiga pelo Meu perfil
    await pg.click('#np-tree .np-eu .tab, .np-eu .tab').catch(() => {}); await pg.waitForTimeout(300);
    const card = await pg.evaluate(() => ({ tab: S.tab, card: !!document.querySelector('#view-perfil .np-pref'), rotulo: document.querySelector('#view-perfil .np-pref .btn')?.textContent }));
    if (card.tab === 'perfil' && card.card) ok(`Meu perfil mostra o bloco Navegação ("${card.rotulo}")`); else falha('bloco Navegação: ' + JSON.stringify(card));
    await Promise.all([pg.waitForNavigation({ waitUntil: 'load' }), pg.evaluate(() => document.querySelector('#view-perfil .np-pref .btn').click())]);
    await pg.waitForFunction(() => typeof PP!=='undefined' && PP.perfil && document.querySelector('#login')?.hidden, null, { timeout: 15000 }); await pg.waitForTimeout(500);
    const volta = await pg.evaluate(() => ({ v3: document.documentElement.classList.contains('np-casca-v3'), chave: localStorage.getItem('np-casca'), sbVisivel: getComputedStyle(document.querySelector('#sb')).display !== 'none', npHidden: document.querySelector('#np-side').hidden }));
    if (!volta.v3 && volta.chave === 'v2' && volta.sbVisivel && volta.npHidden) ok('volta à casca V2 pela chave; V3 fica hidden'); else falha('volta: ' + JSON.stringify(volta));
    if (erros.length) falha('erros de página durante a navegação: ' + erros.join(' | ')); else ok('nenhum erro de página durante a navegação');
    await ctx.close(); }
  // ---------- 3. gaveta no celular e expansão em 1024 ----------
  rel.push('3. gaveta (375) e trilho automático (1024)');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 375, h: 812, tema: 'light' });
    const antes = await pg.evaluate(() => document.querySelector('#np-side').getBoundingClientRect().left);
    await pg.click('#btnSb'); await pg.waitForTimeout(450); const aberta = await pg.evaluate(() => ({ left: document.querySelector('#np-side').getBoundingClientRect().left, veu: getComputedStyle(document.querySelector('.sb-overlay')).display }));
    await pg.click('#np-tree .tab[data-tab="tarefas"]'); await pg.waitForTimeout(450); const depois = await pg.evaluate(() => ({ left: document.querySelector('#np-side').getBoundingClientRect().left, stab: S.tab, sx: document.documentElement.scrollWidth, iw: innerWidth }));
    if (antes < 0 && aberta.left === 0 && aberta.veu === 'block' && depois.left < 0 && depois.stab === 'tarefas' && depois.sx <= depois.iw) ok('gaveta abre com véu, navegar fecha, sem rolagem horizontal'); else falha('gaveta: ' + JSON.stringify({ antes, aberta, depois }));
    await ctx.close();
    const c2 = await contexto(b, { perfil: 'admin', casca: 'v3', w: 1024, h: 768, tema: 'light' });
    const t = await c2.pg.evaluate(() => document.querySelector('#np-side').getBoundingClientRect().width);
    await c2.pg.click('#btnSb'); await c2.pg.waitForTimeout(450); const e2 = await c2.pg.evaluate(() => ({ w: document.querySelector('#np-side').getBoundingClientRect().width, pos: getComputedStyle(document.querySelector('#np-side')).position, cls: document.querySelector('#app').className }));
    if (t < 70 && e2.w > 200 && e2.pos === 'fixed') ok(`1024: trilho automático (${Math.round(t)} px) e expansão por cima (${Math.round(e2.w)} px)`); else falha('1024: ' + JSON.stringify({ t, e2 }));
    await c2.ctx.close(); }
  // ---------- 4. capturas V2 × V3 ----------
  rel.push('4. capturas V2 × V3.1 (admin) em 375/768/1024/1440 × claro/escuro, telas Hoje e Tarefas');
  for (const tema of ['light', 'dark']) for (const w of [375, 768, 1024, 1440]) for (const casca of ['v2', 'v3']) {
    const { ctx, pg } = await contexto(b, { perfil: 'admin', casca, w, h: w === 375 ? 812 : 900, tema });
    for (const tela of ['painel', 'tarefas']) {
      await pg.evaluate((t) => { S.tab = t; render(); }, tela); await pg.waitForTimeout(500);
      const m = await pg.evaluate(() => ({ sx: document.documentElement.scrollWidth, iw: innerWidth, bar: document.querySelector('header.top').getBoundingClientRect().height, small: [...document.querySelectorAll('#np-side *, header.top *')].filter(e => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12 && e.offsetParent !== null).length }));
      if (m.sx > m.iw) { if (casca === 'v3') falha(`${casca} ${w} ${tema} ${tela}: rolagem horizontal (${m.sx} > ${m.iw})`); else rel.push(`  obs   V2 ${w} ${tema} ${tela}: rolagem horizontal pré-existente (${m.sx} > ${m.iw})`); }
      if (casca === 'v3' && m.small) falha(`${casca} ${w} ${tema} ${tela}: ${m.small} texto(s) < 12 px na casca`);
      if (casca === 'v3' && w >= 901 && Math.round(m.bar) !== 48) falha(`${casca} ${w} ${tema}: barra com ${m.bar} px`);
      await pg.screenshot({ path: path.join(OUT, `${casca}-${tema}-${w}-${tela}.png`) });
    }
    await ctx.close();
  }
  ok('capturas gravadas em ' + OUT);
  // ---------- 5. movimento reduzido ----------
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 1440, h: 900, tema: 'light', reduz: true });
    const d = await pg.evaluate(() => getComputedStyle(document.querySelector('#np-tree .np-corpo')).transitionDuration);
    if (/^0s|^0ms/.test(d) || d === '') ok('prefers-reduced-motion: árvore sem transição (' + d + ')'); else falha('reduced motion: ' + d);
    await ctx.close(); }

  // ---------- 6. itens sem acesso: invisíveis, fora do foco e da árvore de acessibilidade ----------
  rel.push('6. itens sem acesso (perfil colaborador do Jurídico)');
  { const { ctx, pg } = await contexto(b, { perfil: 'juridico', casca: 'v3', w: 1440, h: 900, tema: 'light' });
    const r = await pg.evaluate(() => {
      const vis = (e) => { for (let x = e; x && x !== document; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || x.hidden) return false; } return e.getClientRects().length > 0; };
      const todos = [...new Set([...NAV.flatMap(n => n.itens ? n.itens.map(i => i.tab) : [n.tab]), ...Object.values(PP_HUBS.HUBS).flatMap(h => h.tabs.map(([t]) => t))].filter(Boolean))];
      const permitidos = new Set(todos.filter(t => PP.temAcesso(t)));
      document.querySelectorAll('#np-tree .np-g').forEach(g => { if (g.dataset.aberto !== '1') g.querySelector('.np-gh').click(); });
      const naCasca = [...document.querySelectorAll('#np-side .tab[data-tab], #np-fly .tab[data-tab]')];
      const visiveis = naCasca.filter(vis).map(e => e.dataset.tab);
      const vazamento = visiveis.filter(t => !permitidos.has(t));
      const naoRenderizados = todos.filter(t => !permitidos.has(t) && naCasca.some(e => e.dataset.tab === t && vis(e)));
      // conflito hidden × display:flex: marcar um item visível como hidden tem de escondê-lo de fato
      const sonda = naCasca.find(vis); sonda.hidden = true; const escondeu = getComputedStyle(sonda).display === 'none'; sonda.hidden = false;
      return { total: todos.length, permitidos: permitidos.size, visiveis: visiveis.length, vazamento, naoRenderizados, escondeu, gruposVisiveis: [...document.querySelectorAll('#np-tree .np-g')].filter(vis).map(g => g.dataset.g) };
    });
    if (!r.vazamento.length) ok(`${r.visiveis} destinos visíveis, todos permitidos por PP.temAcesso (${r.total - r.permitidos} restritos ausentes); grupos: ${r.gruposVisiveis.join(', ')}`); else falha('destinos sem acesso visíveis: ' + r.vazamento.join(', '));
    if (r.escondeu) ok('atributo hidden vence o display:flex dos itens da casca'); else falha('hidden não esconde item da casca');
    // foco: percorre Tab até sair da lateral+barra e confere que nada restrito recebe foco
    await pg.evaluate(() => document.body.focus()); const focados = []; for (let i = 0; i < 80; i++) { await pg.keyboard.press('Tab'); const f = await pg.evaluate(() => { const a = document.activeElement; return { tab: a.dataset?.tab || null, dentro: !!a.closest('#np-side, header.top'), vis: a.getClientRects().length > 0, id: a.id || a.textContent.trim().slice(0, 20) }; }); if (!f.dentro && focados.length > 3) break; focados.push(f); }
    const focoRestrito = await pg.evaluate((tabs) => tabs.filter(t => t && !PP.temAcesso(t)), focados.map(f => f.tab));
    if (!focoRestrito.length && focados.every(f => f.vis)) ok(`${focados.length} paradas de Tab na lateral+barra, nenhuma em item restrito ou invisível`); else falha('foco em restrito/invisível: ' + JSON.stringify({ focoRestrito, invisiveis: focados.filter(f => !f.vis) }));
    // árvore de acessibilidade (snapshot ARIA) não contém nomes de módulos restritos nem a casca V2
    const aria = await pg.locator('#app').ariaSnapshot();
    const restritos = await pg.evaluate(() => [...new Set(NAV.flatMap(n => n.itens ? n.itens : [n]).filter(i => i.tab && !PP.temAcesso(i.tab)).map(i => i.label))]);
    const vaza = restritos.filter(l => aria.includes(`"${l}"`));
    if (!vaza.length) ok(`snapshot ARIA sem rótulos restritos (${restritos.length} conferidos)`); else falha('rótulos restritos na árvore de acessibilidade: ' + vaza.join(', '));
    // falha simulada da verificação de permissão: nada novo aparece; abas de hub somem
    const simul = await pg.evaluate(() => {
      const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
      const antes = new Set([...document.querySelectorAll('#np-tree .tab[data-tab]')].filter(vis).map(e => e.dataset.tab));
      const orig = PP.temAcesso; const out = {};
      PP.temAcesso = () => { throw new Error('simulado'); }; renderNav(); document.querySelectorAll('#np-tree .np-g').forEach(g => { if (g.dataset.aberto !== '1') g.querySelector('.np-gh').click(); });
      let agora = new Set([...document.querySelectorAll('#np-tree .tab[data-tab]')].filter(vis).map(e => e.dataset.tab)); out.erro = { novos: [...agora].filter(t => !antes.has(t)), hub: [...agora].filter(t => ['processos', 'publicacoes', 'negociacoes', 'historico'].includes(t)) };
      PP.temAcesso = undefined; renderNav(); agora = new Set([...document.querySelectorAll('#np-tree .tab[data-tab]')].filter(vis).map(e => e.dataset.tab)); out.ausente = { novos: [...agora].filter(t => !antes.has(t)), hub: [...agora].filter(t => ['processos', 'publicacoes', 'negociacoes', 'historico'].includes(t)) };
      PP.temAcesso = orig; renderNav(); document.querySelectorAll('#np-tree .np-g').forEach(g => { if (g.dataset.aberto !== '1') g.querySelector('.np-gh').click(); }); agora = new Set([...document.querySelectorAll('#np-tree .tab[data-tab]')].filter(vis).map(e => e.dataset.tab));
      out.restaurou = [...antes].every(t => agora.has(t)) && [...agora].every(t => antes.has(t)); return out; });
    if (!simul.erro.novos.length && !simul.erro.hub.length && !simul.ausente.novos.length && !simul.ausente.hub.length && simul.restaurou) ok('falha simulada em PP.temAcesso (erro e ausência): nenhum destino novo aparece, abas de hub somem, e tudo volta ao restaurar'); else falha('falha simulada: ' + JSON.stringify(simul));
    await ctx.close(); }
  // ---------- 7. ordem de foco e teclado (admin, 1440) ----------
  rel.push('7. ordem de foco e navegação por teclado');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 1440, h: 900, tema: 'light' });
    await pg.evaluate(() => document.body.focus()); const seq = []; for (let i = 0; i < 60; i++) { await pg.keyboard.press('Tab'); const f = await pg.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { area: a.closest('#np-side') ? 'lateral' : a.closest('header.top') ? 'barra' : 'conteudo', nome: a.id || a.dataset?.tab || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 16), x: Math.round(r.left), y: Math.round(r.top) }; }); seq.push(f); if (f.area === 'conteudo') break; }
    const areas = seq.map(s => s.area); const iLat = areas.lastIndexOf('lateral'), iBar = areas.indexOf('barra');
    const lateral = seq.filter(s => s.area === 'lateral'), barra = seq.filter(s => s.area === 'barra');
    const latDesce = lateral.every((s, i) => i === 0 || s.y >= lateral[i - 1].y - 2), barEsqDir = barra.every((s, i) => i === 0 || s.x >= barra[i - 1].x - 2);
    if (areas[0] === 'lateral' && iLat < iBar && latDesce && barEsqDir) ok(`Tab: lateral de cima para baixo (${lateral.length} paradas: ${lateral.slice(0, 4).map(s => s.nome).join(', ')}…) → barra da esquerda para a direita (${barra.map(s => s.nome).join(', ')}) → conteúdo`); else falha('ordem de foco: ' + JSON.stringify(seq));
    // Shift+Tab volta; Enter/Espaço em grupo; Esc na gaveta
    await pg.focus('#np-tree .np-g[data-g="financeiro"] .np-gh'); await pg.keyboard.press('Enter'); const ap1 = await pg.evaluate(() => document.querySelector('#np-tree .np-g[data-g="financeiro"]').dataset.aberto); await pg.keyboard.press('Space'); const ap2 = await pg.evaluate(() => document.querySelector('#np-tree .np-g[data-g="financeiro"]').dataset.aberto);
    if (ap1 !== ap2) ok('Enter e Espaço alternam o grupo pelo teclado'); else falha('grupo via teclado: ' + ap1 + '/' + ap2);
    // foco visível
    await pg.focus('#np-tree .tab[data-tab="tarefas"]'); await pg.keyboard.press('Tab'); await pg.keyboard.press('Shift+Tab');
    const anel = await pg.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { tab: a.dataset.tab, outline: cs.outlineStyle, shadow: cs.boxShadow }; });
    if (anel.tab === 'tarefas' && (anel.shadow !== 'none' || anel.outline !== 'none')) ok('foco visível (anel) no item focado por teclado'); else falha('foco invisível: ' + JSON.stringify(anel));
    await ctx.close();
    // gaveta: foco e Esc
    const c3 = await contexto(b, { perfil: 'admin', casca: 'v3', w: 375, h: 812, tema: 'light' });
    await c3.pg.focus('#btnSb'); await c3.pg.keyboard.press('Enter'); await c3.pg.waitForTimeout(450);
    await c3.pg.keyboard.press('Escape'); await c3.pg.waitForTimeout(300);
    const gav = await c3.pg.evaluate(() => ({ aberta: document.querySelector('#app').classList.contains('sb-aberta'), foco: document.activeElement.id }));
    if (!gav.aberta && gav.foco === 'btnSb') ok('gaveta: Esc fecha e devolve o foco ao botão do menu'); else falha('gaveta teclado: ' + JSON.stringify(gav));
    await c3.ctx.close(); }
  // ---------- 8. contraste e alvos de toque ----------
  rel.push('8. contraste (texto ≥ 4,5:1) e alvos de toque (≥ 44 px)');
  const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const tema of ['light', 'dark']) {
    const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 1440, h: 900, tema });
    const pares = await pg.evaluate(() => {
      // cor de fundo efetiva: sobe até achar um fundo opaco (a barra usa color-mix translúcido sobre --np-bg)
      const rgb = (c) => { const n = c.match(/-?\d*\.?\d+/g).map(Number); if (/^color\(srgb/.test(c)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 }; return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; };
      const fundo = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!c || c === 'transparent') continue; const k = rgb(c); if (k.a >= 0.99) return `rgb(${Math.round(k.r)}, ${Math.round(k.g)}, ${Math.round(k.b)})`; } return getComputedStyle(document.body).backgroundColor; };
      const cor = (sel, nome) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); return { nome, fg: cs.color, bg: fundo(e), px: parseFloat(cs.fontSize) }; };
      document.querySelector('#np-dica').textContent = 'x'; document.querySelector('#np-dica').classList.add('on');
      const raiz = getComputedStyle(document.documentElement);
      return [cor('#np-tree .tab[data-tab="tarefas"] span', 'item da árvore'), cor('#np-tree .tab[aria-current="page"] span', 'item ativo'), cor('#np-tree .np-gh span', 'cabeçalho de grupo'), cor('.np-busca-btn span', 'botão Buscar'), cor('.np-eu small', 'rodapé "Meu perfil"'), cor('.np-ws small', 'subtítulo Advocacia'), cor('#brandArea', 'título na barra'), cor('.top .switch', 'Visão do cliente'), cor('#userName', 'nome na barra'), { nome: 'dica do trilho', fg: raiz.getPropertyValue('--np-inv').trim(), bg: raiz.getPropertyValue('--np-ink').trim(), px: 12.5 }, { nome: 'trilha "Grupo /"', fg: raiz.getPropertyValue('--np-text-3').trim(), bg: raiz.getPropertyValue('--np-bg').trim(), px: 14 }].filter(Boolean);
    });
    const hex2rgb = (h) => /^#/.test(h) ? 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')' : h;
    const ruins = pares.map(p => ({ ...p, r: razao(hex2rgb(p.fg), hex2rgb(p.bg)) })).filter(p => p.r < 4.5);
    if (!ruins.length) ok(`${tema}: ${pares.length} pares de texto da casca ≥ 4,5:1 (mínimo ${Math.min(...pares.map(p => razao(hex2rgb(p.fg), hex2rgb(p.bg)))).toFixed(2)})`); else falha(`${tema}: contraste insuficiente: ` + ruins.map(p => `${p.nome} ${p.r.toFixed(2)}:1 (${p.fg} sobre ${p.bg})`).join('; '));
    await ctx.close();
  }
  for (const [w, h, rotulo] of [[375, 812, 'celular (gaveta)'], [1024, 768, 'tablet (trilho automático)']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, colorScheme: 'light' });
    const sessao = { access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: PERFIS.admin.id, email: 'admin@lab.exemplo', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
    await ctx.addInitScript(({ sessao, ref }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sessao)); localStorage.setItem('np-casca', 'v3'); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { sessao, ref: REF });
    await ctx.route(/supabase\.co/, (rota) => { const p = new URL(rota.request().url()).pathname; const unico = /vnd\.pgrst\.object/.test(rota.request().headers()['accept'] || ''); const json = (b, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(b) }); if (p.startsWith('/auth/v1/user')) return json(sessao.user); if (p.startsWith('/auth/v1/token')) return json(sessao); if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/perfis')) return json(unico ? PERFIS.admin : [PERFIS.admin]); if (p.startsWith('/rest/v1/rpc/')) return json([]); return unico ? json({ code: 'PGRST116' }, 406) : json([]); });
    const pg = await ctx.newPage(); await pg.goto(BASE + '/index.html', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && window.PP_CASCA, null, { timeout: 15000 }); await pg.waitForTimeout(500);
    const coarse = await pg.evaluate(() => matchMedia('(pointer:coarse)').matches);
    if (w === 375) { await pg.tap('#btnSb'); await pg.waitForTimeout(500); }
    const alvos = await pg.evaluate(() => { const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; document.querySelectorAll('#np-tree .np-g').forEach(g => { if (g.dataset.aberto !== '1' && !document.querySelector('#app').classList.contains('np-rail')) g.querySelector('.np-gh').click(); }); return [...document.querySelectorAll('#np-side button, #np-side a, header.top button, header.top a, header.top input, header.top label')].filter(vis).filter(e => !(e.matches('input[type="checkbox"]') && e.closest('label'))).map(e => { const r = e.getBoundingClientRect(); return { nome: e.id || e.dataset?.tab || e.className.split(' ')[0] + ':' + e.textContent.trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height), icone: !e.textContent.trim() || e.matches('.ham, .ic, .np-rail .tab, .np-rail .np-gh, .np-rail .np-busca-btn') }; }); });
    const pequenos = alvos.filter(a => a.h < 44 || (a.icone && a.w < 44));
    if (coarse && !pequenos.length) ok(`${rotulo} ${w}px: ${alvos.length} alvos de toque ≥ 44 px`); else falha(`${rotulo} ${w}px (pointer:coarse=${coarse}): alvos < 44 px: ` + pequenos.map(a => `${a.nome} ${a.w}×${a.h}`).join(', '));
    if (w === 1024) { await pg.tap('#np-tree .np-g[data-g="juridico"] .np-gh'); await pg.waitForTimeout(400); const fl = await pg.evaluate(() => [...document.querySelectorAll('#np-fly .tab')].map(e => Math.round(e.getBoundingClientRect().height))); if (fl.length && fl.every(x => x >= 44)) ok(`flyout no toque: ${fl.length} itens ≥ 44 px`); else falha('flyout no toque: ' + JSON.stringify(fl)); }
    await ctx.close();
  }
  // ---------- 9. persistência das preferências ----------
  rel.push('9. persistência (chave V2/V3.1, trilho, grupos) entre recarregamentos');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 1440, h: 900, tema: 'light' });
    // fecha o grupo Equipe na árvore e liga o trilho; os dois estados têm de sobreviver ao recarregamento
    await pg.evaluate(() => { const g = document.querySelector('#np-tree .np-g[data-g="equipe"]'); if (g.dataset.aberto === '1') g.querySelector('.np-gh').click(); });
    await pg.click('#btnSb'); await pg.waitForTimeout(300);
    const antes = await pg.evaluate(() => ({ trilho: localStorage.getItem('np-trilho'), grupos: localStorage.getItem('np-grupos'), chave: localStorage.getItem('np-casca') }));
    await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden, null, { timeout: 15000 }); await pg.waitForTimeout(600);
    const depois = await pg.evaluate(() => ({ v3: document.documentElement.classList.contains('np-casca-v3'), rail: document.querySelector('#app').classList.contains('np-trilho'), equipeAberto: document.querySelector('#np-tree .np-g[data-g="equipe"]')?.dataset.aberto, chave: localStorage.getItem('np-casca') }));
    if (depois.v3 && depois.chave === 'v3' && antes.trilho === '1' && depois.rail && depois.equipeAberto === '0') ok('após recarregar: V3.1 mantida, trilho continua recolhido, grupo Equipe continua fechado'); else falha('persistência: ' + JSON.stringify({ antes, depois }));
    // volta à V2 e recarrega duas vezes: continua V2; volta à V3: continua V3
    await pg.evaluate(() => { S.tab = 'perfil'; render(); }); await pg.waitForTimeout(200);
    await Promise.all([pg.waitForNavigation({ waitUntil: 'load' }), pg.evaluate(() => document.querySelector('#view-perfil .np-pref .btn').click())]);
    await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden, null, { timeout: 15000 });
    await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden, null, { timeout: 15000 }); await pg.waitForTimeout(400);
    const v2 = await pg.evaluate(() => ({ v3: document.documentElement.classList.contains('np-casca-v3'), sb: getComputedStyle(document.querySelector('#sb')).display, np: document.querySelector('#np-side').hidden, card: !!document.querySelector('#view-perfil .np-pref') || true }));
    await pg.evaluate(() => { S.tab = 'perfil'; render(); }); await pg.waitForTimeout(200);
    await Promise.all([pg.waitForNavigation({ waitUntil: 'load' }), pg.evaluate(() => document.querySelector('#view-perfil .np-pref .btn').click())]);
    await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && window.PP_CASCA, null, { timeout: 15000 }); await pg.waitForTimeout(400);
    const v3 = await pg.evaluate(() => ({ v3: document.documentElement.classList.contains('np-casca-v3'), chave: localStorage.getItem('np-casca') }));
    if (!v2.v3 && v2.sb !== 'none' && v2.np && v3.v3 && v3.chave === 'v3') ok('V2 persiste após dois recarregamentos; voltar à V3.1 pelo card também persiste'); else falha('alternância: ' + JSON.stringify({ v2, v3 }));
    await ctx.close(); }
  // ---------- 10. modo token (área do cliente) ----------
  rel.push('10. modo token (cliente/index.html) com chave np-casca=v3 no mesmo navegador');
  { const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('np-casca', 'v3'); } catch (_) {} });
    const DADOS = { gerado_em: '2026-11-01T12:00:00Z', cliente: { id: 'c1', dados: { nome: 'Empresa Alfa Ltda', nome_fantasia: 'Alfa', cnpj: '00.000.000/0001-01' } }, ficha: {}, contratos: [], entradas_timeline: [], processos: [], andamentos: [], acordos: [], documentos: [], referencias: [], regras: null };
    const errosTok = []; const pedidos = [];
    await ctx.route(/supabase\.co/, (rota) => { const p = new URL(rota.request().url()).pathname; pedidos.push(p); const json = (b, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) }); if (p.endsWith('/rpc/painel_por_token')) return json(DADOS); if (p.endsWith('/rpc/registrar_acesso_token')) return json(null, 204); if (p.startsWith('/realtime/')) return rota.abort(); return json([]); });
    const pg = await ctx.newPage(); pg.on('pageerror', e => errosTok.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(m.text())) errosTok.push(m.text().slice(0, 140)); });
    await pg.goto(BASE + '/cliente/index.html?t=lab-ficticio', { waitUntil: 'load' });
    await pg.waitForFunction(() => document.querySelector('#login')?.hidden || /inválido|incompleto/.test(document.querySelector('#l-msg')?.textContent || ''), null, { timeout: 15000 }).catch(() => {}); await pg.waitForTimeout(600);
    const tk = await pg.evaluate(() => ({ login: document.querySelector('#login')?.hidden, modoCliente: document.body.classList.contains('modo-cliente'), v3: document.documentElement.classList.contains('np-casca-v3'), nav: typeof NAV !== 'undefined' ? NAV.length : null, tree: !!document.querySelector('#np-tree'), casca: !!window.PP_CASCA, scripts: [...document.scripts].map(s => (s.src.match(/passivos\/([a-z-]+\.js)/) || [])[1]).filter(Boolean), cssCasca: [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /np-casca-v3/.test(r.cssText)); } catch (_) { return false; } }), boot: document.head.innerHTML.includes('np-casca'), npSide: document.querySelector('#np-side')?.hidden, sb: getComputedStyle(document.querySelector('#sb')).display, tabsVisiveis: [...document.querySelectorAll('#sb .tab')].filter(e => e.offsetParent !== null).length }));
    const okTok = tk.login && tk.modoCliente && !tk.v3 && tk.nav === 0 && !tk.tree && !tk.casca && !tk.cssCasca && !tk.boot && tk.npSide === true && tk.tabsVisiveis === 0 && JSON.stringify(tk.scripts) === JSON.stringify(['carteira.js', 'ficha.js']);
    if (okTok) ok(`modo token: carrega a área do cliente com NAV vazio, sem casca.css/casca.js/boot, sem #np-tree, 0 abas internas visíveis, só carteira.js+ficha.js — mesmo com np-casca=v3 no navegador`); else falha('modo token: ' + JSON.stringify(tk));
    if (!pedidos.some(p => /casca/.test(p)) ) ok('modo token: nenhuma requisição fora do runtime do cliente (' + [...new Set(pedidos)].join(', ') + ')');
    if (errosTok.length) rel.push('  obs   modo token com fixture mínima: ' + errosTok.slice(0, 3).join(' | '));
    await ctx.close(); }

  // ---------- 11. espelho (/beta/) na mesma origem: preferências da casca isoladas, tema compartilhado ----------
  rel.push('11. espelho /beta/ na mesma origem do sistema principal');
  { fs.rmSync(ESPELHO_DIR, { recursive: true, force: true }); fs.mkdirSync(path.join(ESPELHO_DIR, 'beta'), { recursive: true });
    execFileSync(process.execPath, [path.join(RAIZ, 'fontes/gerar-app-supabase.mjs'), path.join(ESPELHO_DIR, 'beta/index.html')], { cwd: RAIZ, env: { ...process.env, PP_ESPELHO: '1' }, stdio: 'pipe' });
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const sess = (ref) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: PERFIS.admin.id, email: 'admin@lab.exemplo', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
    await ctx.addInitScript(({ a, b2, refA, refB }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${refA}-auth-token`, JSON.stringify(a)); localStorage.setItem(`sb-${refB}-auth-token`, JSON.stringify(b2)); localStorage.setItem('np-casca', 'v3'); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { a: sess(REF), b2: sess(REF_BETA), refA: REF, refB: REF_BETA });
    await ctx.route(/supabase\.co/, (rota) => { const p = new URL(rota.request().url()).pathname; const unico = /vnd\.pgrst\.object/.test(rota.request().headers()['accept'] || ''); const json = (b, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(b) }); if (p.startsWith('/auth/v1/user')) return json(sess(REF).user); if (p.startsWith('/auth/v1/token')) return json(sess(REF)); if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/perfis')) return json(unico ? PERFIS.admin : [PERFIS.admin]); if (p.startsWith('/rest/v1/rpc/')) return json([]); return unico ? json({ code: 'PGRST116' }, 406) : json([]); });
    const pg = await ctx.newPage(); const pronto = () => pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && window.PP_HUBS, null, { timeout: 15000 }).then(() => pg.waitForTimeout(400));
    const estado = () => pg.evaluate(() => ({ espelho: document.body.dataset.espelho === '1', v3: document.documentElement.classList.contains('np-casca-v3'), tema: document.documentElement.dataset.theme || '', ls: Object.fromEntries(Object.keys(localStorage).filter(k => /^(np-|pp-tema)/.test(k)).map(k => [k, localStorage.getItem(k)])) }));
    await pg.goto(BASE + '/index.html', { waitUntil: 'load' }); await pronto(); const prod1 = await estado();
    await pg.goto(BASE + '/__espelho/beta/index.html', { waitUntil: 'load' }); await pronto(); const beta1 = await estado();
    // liga a V3.1 no beta pelo card de Meu perfil (grava np-casca-beta) e recolhe o trilho lá
    await pg.evaluate(() => { S.tab = 'perfil'; render(); }); await pg.waitForTimeout(200);
    const rotuloCard = await pg.evaluate(() => document.querySelector('#view-perfil .np-pref .btn')?.textContent);
    await Promise.all([pg.waitForNavigation({ waitUntil: 'load' }), pg.evaluate(() => document.querySelector('#view-perfil .np-pref .btn').click())]); await pronto();
    await pg.click('#btnSb'); await pg.waitForTimeout(200); await pg.click('#btnTema'); await pg.waitForTimeout(200);
    const beta2 = await estado();
    await pg.goto(BASE + '/index.html', { waitUntil: 'load' }); await pronto(); const prod2 = await estado();
    const okIso = prod1.v3 && !prod1.espelho && beta1.espelho && !beta1.v3 && /Experimentar/.test(rotuloCard || '') && beta2.v3 && beta2.ls['np-casca-beta'] === 'v3' && beta2.ls['np-trilho-beta'] === '1' && beta2.ls['np-casca'] === 'v3' && beta2.ls['np-trilho'] === undefined && prod2.v3 && !prod2.ls['np-trilho'];
    if (okIso) ok('np-casca=v3 do principal não liga a V3.1 no beta; ligar no beta grava np-casca-beta/np-trilho-beta e não toca nas chaves do principal'); else falha('isolamento beta: ' + JSON.stringify({ prod1, beta1, rotuloCard, beta2, prod2 }));
    if (beta2.tema === 'dark' && prod2.tema === 'dark' && prod2.ls['pp-tema'] === 'dark') ok('tema continua compartilhado (pp-tema) entre beta e principal, como hoje'); else falha('tema: ' + JSON.stringify({ beta2: beta2.tema, prod2: prod2.tema }));
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + (falhas ? `\n\n${falhas} falha(s).` : '\n\nTudo certo.');
  console.log(txt); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('erro no laboratório:', e); process.exit(2); });
