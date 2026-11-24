/* Laboratório da V10 — Financeiro → Estoque em V3.1 (produtos, lista de compras, movimentações).
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/estoque-lab.cjs [pasta de saída]  (padrão /tmp/estoque-lab)
   Verifica: totais contra os registros, grupos e filtros, − e + na linha, painel do produto, desativar em dois passos,
   lista de compras, movimentações por dia, estados vazios, V2 intacta e as 8 combinações. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/estoque-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const agora = new Date().toISOString();
const pr = (id, nome, cat, saldo, min, x = {}) => ({ id, nome, categoria: cat, unidade: 'un', ativo: true, saldo_atual: saldo, estoque_minimo: min, qtd_desejada: min * 3, zerado: saldo === 0, abaixo_minimo: saldo <= min, compra_sugerida: saldo <= min ? min * 3 - saldo : 0, consumo_semanal: 1, consumo_mensal: 4, previsao_confiavel: saldo > 0, dias_restantes: saldo * 7, tarefa_status: null, observacoes: null, ...x });
const PRODS = [pr('p1', 'Café fictício 500 g', 'alimenticios', 0, 2, { tarefa_status: 'aberta', tarefa_reposicao_id: 't1', tarefa_responsavel_nome: 'Marina Teste' }), pr('p2', 'Açúcar fictício', 'alimenticios', 6, 2), pr('p3', 'Papel A4 fictício', 'escritorio', 2, 3, { unidade: 'resma' }), pr('p4', 'Caneta fictícia', 'escritorio', 40, 10), { ...pr('p5', 'Inativo fictício', 'escritorio', 1, 1), ativo: false }];
const MOVS = [{ id: 'm1', produto_id: 'p2', produto_nome: 'Açúcar fictício', categoria: 'alimenticios', unidade: 'un', tipo: 'retirada', quantidade: 1, saldo_apos: 6, autor_nome: 'Ana Teste', observacao: 'Copa', criado_em: agora }, { id: 'm2', produto_id: 'p4', produto_nome: 'Caneta fictícia', categoria: 'escritorio', unidade: 'un', tipo: 'entrada', quantidade: 20, saldo_apos: 40, autor_nome: 'Marina Teste', observacao: null, criado_em: new Date(Date.now() - 864e5).toISOString() }];
const V = '#view-estoque';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#estoque', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_estoque_movimentos|v_estoque)/, (rota) => { const p = new URL(rota.request().url()).pathname; if (rota.request().method() !== 'GET') return rota.fallback(); return json(rota, o.vazio ? [] : p.endsWith('/v_estoque') ? PRODS : MOVS); });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'estoque') { S.tab = 'estoque'; render(); } });
  if (o.casca === 'v2') await r.pg.waitForFunction((V) => document.querySelector(V + ' .head h1') && document.querySelector(V + ' table'), V, { timeout: 15000 });
  else await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it, ' + V + ' .np-vazio'), V, { timeout: 15000 });
  await r.pg.waitForTimeout(600); return r;
}
const estado = (pg) => pg.evaluate((V) => { const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; return { resumo: t(document.querySelector(V + ' .np-resumo')), abas: [...document.querySelectorAll(V + ' .np-cc-abas button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), chips: [...document.querySelectorAll(V + ' .np-cc-fl button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), l1: (() => { const li = document.querySelector(V + ' li.np-it[data-id="p1"]'); return li ? { regua: [...li.classList].filter(c => /^r-/.test(c)).join(), saldo: t(li.querySelector('.np-it-prazo')), marcas: [...li.querySelectorAll('.np-marca')].map(t), bts: [...li.querySelectorAll('.np-est-b')].map(x => x.getAttribute('aria-label')) } : null; })(), tabela: !!document.querySelector(V + ' table'), pilulas: document.querySelectorAll(V + ' .pill').length, vazio: t(document.querySelector(V + ' .np-vazio')), h1v2: t(document.querySelector(V + ' .head h1')), ruim: /NaN|undefined|Infinity/.test(document.querySelector(V).textContent) }; }, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, botoes: [...p.querySelectorAll('.np-btn')].map(t), itens: p.querySelectorAll('.np-ft-lst li').length }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const aba = async (pg, rot) => { await pg.click(V + ' .np-cc-abas button:text-is("' + rot + '")'); await pg.waitForTimeout(600); };
/* o painel guarda as ações além das três primeiras no menu "Mais ações" (⋯) do rodapé — desenho do AI Studio, 23/11 */
const pePainel = async (pg, V, rotulo) => { const direto = pg.locator(`${V} .np-painel .np-btn:text-is("${rotulo}")`); if (await direto.count() && await direto.first().isVisible()) return direto.first().click(); await pg.click(V + ' .np-painel .np-p-mais'); await pg.waitForTimeout(200); await pg.click(`#np-pop [role="menuitem"]:has-text("${rotulo}")`); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Estoque — produtos, compras e movimentações (perfil administradora, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {}); let e = await estado(pg);
    if (/^1 sem estoque/.test(e.resumo) && /2 abaixo do mínimo/.test(e.resumo) && /1 reposição aberta/.test(e.resumo) && /2 produtos a comprar/.test(e.resumo)) ok(`totais conferem com os registros: "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (e.abas.join('|') === 'Produtos*|Lista de compras|Movimentações' && JSON.stringify(e.grupos) === JSON.stringify(['Alimentícios2:p1,p2', 'Escritório2:p3,p4']) && e.l1 && e.l1.regua === 'r-late' && /^0/.test(e.l1.saldo) && e.l1.marcas.includes('sem estoque') && e.l1.marcas.some(m => /reposição aberta com Marina/.test(m)) && e.l1.bts.join('|') === 'Registrar retirada de Café fictício 500 g|Registrar entrada de Café fictício 500 g' && !e.tabela && !e.pilulas && !e.ruim) ok('produtos em grupos por categoria, o sem estoque primeiro; saldo à esquerda, situação e reposição em palavras; − e + com nome acessível; produto inativo fora; sem tabela nem pílula'); else falha('lista: ' + JSON.stringify(e));
    await pg.click(V + ' .np-cc-fl button:has-text("Abaixo do mínimo")'); await pg.waitForTimeout(500); const f = await estado(pg);
    if (JSON.stringify(f.grupos) === JSON.stringify(['Alimentícios1:p1', 'Escritório1:p3'])) ok('filtro "Abaixo do mínimo": só os dois produtos que precisam de reposição'); else falha('filtro: ' + JSON.stringify(f.grupos));
    await pg.click(V + ' .np-cc-fl button:has-text("Todos")'); await pg.waitForTimeout(400);
    await pg.click(`${V} li.np-it[data-id="p2"] .np-it-abrir`); await pg.waitForTimeout(700); const p = await painel(pg);
    let n0 = escritas.length; await pePainel(pg, V, 'Desativar'); await pg.waitForTimeout(400); const umClique = escritas.length === n0; const p2 = await painel(pg);
    await pg.click(V + ' .np-painel .np-btn:text-is("Voltar")'); await pg.waitForTimeout(400);
    if (p && p.titulo === 'Açúcar fictício' && /^6 un/.test(p.props['Saldo']) && /1 por semana/.test(p.props['Consumo médio']) && /42 dia/.test(p.props['Previsão']) && p.itens === 1 && ['Registrar retirada|Registrar entrada|Editar|Desativar', 'Registrar retirada|Registrar entrada' /* Editar e Desativar no menu "Mais ações" */].includes(p.botoes.join('|')) && umClique && p2.botoes.join('|') === 'Confirmar: desativar o produto|Voltar' && escritas.length === n0) ok('painel do produto: saldo, mínimo, consumo, previsão e movimentações; desativar pede confirmação e voltar não grava nada'); else falha('painel: ' + JSON.stringify([p, p2, umClique, escritas.slice(n0)]));
    await pg.click(`${V} li.np-it[data-id="p2"] .np-est-b[title="Registrar retirada"]`); await pg.waitForTimeout(500); const md = await pg.evaluate(() => document.querySelector('#modalHost')?.textContent.replace(/\s+/g, ' ').slice(0, 80)); await pg.fill('#modalHost input[type=number]', '2'); const pv1 = await pg.evaluate(() => document.querySelector('.np-est-prev')?.textContent); await pg.fill('#modalHost input[type=number]', '9'); const pv2 = await pg.evaluate(() => document.querySelector('.np-est-prev')?.textContent); await pg.click('#modalHost button.btn.primary'); await pg.waitForTimeout(500); const recusou = escritas.length === n0; const rotB = await pg.evaluate(() => document.querySelector('#modalHost button.btn.primary')?.textContent); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.evaluate(() => document.querySelector('#modalHost')?.replaceChildren());
    if (/Retirada: Açúcar fictício/.test(md || '') && /passa de 6 para 4 un/.test(pv1 || '') && /maior que o saldo registrado/.test(pv2 || '') && recusou && rotB === 'Registrar retirada' && escritas.length === n0) ok('− na linha abre o registro de retirada: mostra o saldo que vai ficar, avisa a autoria e recusa na tela a retirada maior que o saldo, sem chamar o banco'); else falha('retirada: ' + JSON.stringify([md, pv1, pv2, recusou, rotB]));
    await pg.keyboard.press('Escape'); await aba(pg, 'Lista de compras'); e = await estado(pg);
    if (JSON.stringify(e.grupos) === JSON.stringify(['Alimentícios1:p1', 'Escritório1:p3']) && !e.tabela) ok('lista de compras: os dois produtos a repor, por categoria, com a quantidade sugerida à esquerda'); else falha('compras: ' + JSON.stringify(e.grupos));
    await aba(pg, 'Movimentações'); e = await estado(pg);
    if (e.grupos.length === 2 && /:m:m1$/.test(e.grupos[0]) && /:m:m2$/.test(e.grupos[1]) && !e.tabela) ok('movimentações agrupadas por dia, da mais recente para a mais antiga'); else falha('movimentos: ' + JSON.stringify(e.grupos));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3))); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { vazio: true }); const vz = [];
    for (const a of ['Produtos', 'Lista de compras', 'Movimentações']) { await aba(pg, a); const e = await estado(pg); vz.push({ a, vazio: (e.vazio || '').slice(0, 50), ruim: e.ruim, tabela: e.tabela }); }
    if (vz.every(x => x.vazio && !x.ruim && !x.tabela) && !erros.length) ok('sem registros: as três áreas explicam o vazio'); else falha('vazios: ' + JSON.stringify([vz, erros.slice(0, 2)])); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const e = await estado(pg);
    if (e.h1v2 === 'Estoque' && e.tabela && !e.abas.length && !erros.length) ok('V2 intacta: a tela segue como estava'); else falha('V2: ' + JSON.stringify([e.h1v2, e.tabela, e.abas, erros.slice(0, 2)])); await ctx.close(); }
  rel.push('2. 375 / 768 / 1024 / 1440 × claro / escuro — lista e painel');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w, h: w < 800 ? 780 : 900, tema }); const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-resumo span', nome: 'rótulo' }, { sel: V + ' .np-grp-h .t', nome: 'grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'produto' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-it-prazo', nome: 'saldo' }, { sel: V + ' .np-est-b', nome: 'mais e menos' }, { sel: V + ' .np-cc-fl .np-chipf', nome: 'filtro' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$|np-check/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `estoque-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="p1"] .np-it-abrir`); await pg.waitForTimeout(800); const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `estoque-${w}-${tema}-painel.png`) });
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral, contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 6))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
