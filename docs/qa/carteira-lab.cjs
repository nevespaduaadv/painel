/* Laboratório da entrega visual V3 — Clientes → Carteira em V3.1 (faixa, lista com régua, painel). Playwright + Chromium locais;
   reaproveita o servidor e as fixtures fictícias do integracoes-lab (mesma carteira c1…c8), com rotas extras para contratos em atraso,
   em acordo, PF, ficha de passagem e processos ativos. TODA chamada a *.supabase.co é interceptada; nada sai da máquina.
   Uso: NODE_PATH=<módulos> node docs/qa/carteira-lab.cjs [pasta de saída]  (padrão /tmp/carteira-lab)
   Verifica: mesmas contas da V2 (saldo, atraso, negociação), grupos, régua pelo próximo prazo, marcas sem pílula, filtros, painel
   (props, contratos, prazos, acompanhamento), ações iguais às da V2 (abrir ficha, editar cliente, exportar), nenhuma gravação,
   permissões (perfil sem Clientes não carrega o módulo), V2 intacta, 375 px sem rolagem lateral, contraste nos dois temas. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/carteira-lab'; fs.mkdirSync(OUT, { recursive: true });
// cabeçalho do integracoes-lab (servidor, fixtures, contexto) executado como módulo — a mesma carteira fictícia em todos os laboratórios
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,CLIENTES,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, CLIENTES, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright'); require('./_popup.cjs');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };

/* contratos: c1 com um em atraso (ajuizado) e um em dia; c3 em acordo; c4 em atraso (cobrança); c6 PF sem contrato */
const CONTRATOS = [
  { id: 'k1', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Santander', produto: 'giro', situacao: 'ajuizado', valorOriginal: 500000, saldoAtual: 480000, dataInicioAtraso: dia(-120) } },
  { id: 'k2', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Itaú', produto: 'contagar', situacao: 'emdia', valorOriginal: 150000, saldoAtual: 150000 } },
  { id: 'k3', cliente_id: 'c3', dados: { clienteId: 'c3', banco: 'Sicoob', produto: 'veiculo', situacao: 'acordo', valorOriginal: 300000, saldoAtual: 300000 } },
  { id: 'k4', cliente_id: 'c4', dados: { clienteId: 'c4', banco: 'Banco do Brasil', produto: 'cheque', situacao: 'cobranca', valorOriginal: 90000, saldoAtual: 95000, dataInicioAtraso: dia(-40) } },
  { id: 'k5', cliente_id: 'c5', dados: { clienteId: 'c5', banco: 'Caixa', produto: 'pronampe', situacao: 'quitado', valorOriginal: 70000, saldoAtual: 0 } },
];
const PASSAGEM = [{ cliente_id: 'c1', situacao: 'inadimplente' }, { cliente_id: 'c3', situacao: 'adimplente' }, { cliente_id: 'c4', situacao: 'vai_ficar_inadimplente' }];
const PROC = [{ cliente_id: 'c1', status: 'ativo' }, { cliente_id: 'c1', status: 'ativo' }, { cliente_id: 'c8', status: 'ativo' }];
async function abrirCarteira(b, o = {}) {
  const r = await contexto(b, { hash: '#clientes', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(contratos|v_cliente_passagem|processos|clientes)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/contratos')) return json(rota, CONTRATOS);
    if (p.startsWith('/rest/v1/v_cliente_passagem')) return json(rota, PASSAGEM);
    if (p.startsWith('/rest/v1/processos') && /status/.test(u.searchParams.get('select') || '')) return json(rota, PROC);
    if (p.startsWith('/rest/v1/clientes') && /tipo_pessoa/.test(u.searchParams.get('select') || '')) return json(rota, CLIENTES.map((c) => ({ id: c.id, nome: c.nome, ativo: true, status: c.status, tipo_pessoa: c.id === 'c6' ? 'PF' : 'PJ', cidade: c.cidade, segmento: c.segmento, etapa_fluxo: c.id === 'c2' ? 2 : 6 })));
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined' && (!PP.temAcesso('clientes') || (S.clientes && S.clientes.length > 0)), null, { timeout: 20000 });
  if (o.casca !== 'v2' && o.perfil !== 'juridico') { await r.pg.waitForFunction(() => document.querySelector('#np-carteira .np-qd') && window.PP_CARTEIRA_V3?.estado?.().prazos != null && window.PP_CLIENTES_VISAO?.dados?.(), null, { timeout: 15000 }); await r.pg.click('#np-carteira .np-qd'); /* 25/11: a lista abre pelo quadro “Todos os clientes” */ await r.pg.waitForSelector('#np-carteira li.np-it', { timeout: 15000 }); }
  await r.pg.waitForTimeout(400);
  return r;
}
const estadoLista = (pg) => pg.evaluate(() => {
  const lis = [...document.querySelectorAll('#np-carteira li.np-it')];
  return { resumo: [...document.querySelectorAll('#np-carteira .np-qd')].map(q => q.querySelector('.t').textContent.trim() + ' ' + q.querySelector('b').textContent.trim() + (q.classList.contains('on') ? '*' : '')).join(' | '), chips: [...document.querySelectorAll('#np-carteira .np-chipf')].map(c => c.textContent.replace(/\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')),
    grupos: document.querySelectorAll('#np-carteira .np-grp').length, nomes: lis.map(li => li.querySelector('.np-it-abrir .tx')?.textContent.trim()), ids: lis.map(li => li.dataset.id),
    texto: document.querySelector('#np-carteira')?.textContent || '', reguas: lis.filter(li => /(^| )r-/.test(li.className)).length,
    prazoVisivel: lis.some(li => { const x = li.querySelector('.np-it-prazo'); return x && getComputedStyle(x).display !== 'none'; }),
    rodape: document.querySelector('#np-carteira .np-rodape')?.textContent.replace(/\s+/g, ' ').trim(), legenda: !!document.querySelector('#np-carteira .np-legenda'),
    busca: !!document.querySelector('#np-carteira .np-busca-inline'), novo: [...document.querySelectorAll('button')].filter(b => /Novo/.test(b.textContent) && b.offsetParent).map(b => b.textContent.trim()).join('|') };
});
/* 25/11: Todos / PF / PJ viraram quadros no topo (clicar no quadro ativo recolhe a lista); a ordem segue como chip */
const clicarChip = (pg, re) => pg.evaluate((src) => { const r = new RegExp(src); const chip = [...document.querySelectorAll('#np-carteira .np-chipf')].find(c => r.test(c.textContent.trim())); if (chip) { chip.click(); return; } const alvo = /PF/.test(src) ? /PF$/ : /PJ/.test(src) ? /PJ$/ : /^Todos/; const q = [...document.querySelectorAll('#np-carteira .np-qd')].find(x => alvo.test(x.querySelector('.t').textContent.trim())); if (!q.classList.contains('on')) q.click(); }, re.source);
const ordenado = (a, sinal) => a.every((x, i) => !i || sinal * a[i - 1].localeCompare(x, 'pt-BR') <= 0);

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // Carteira simples (pedido das sócias, 23/11): só a lista dos clientes; situação, valores e prazos ficam na ficha e na Gestão
  rel.push('1. Carteira simples — só a lista (perfil admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrirCarteira(b, {});
    const e = await estadoLista(pg);
    if (e.resumo === 'Todos os clientes 8* | Carteira PF 1 | Carteira PJ 7') ok('quadros: Todos os clientes 8 (aberto), Carteira PF 1, Carteira PJ 7'); else falha('quadros: ' + e.resumo);
    if (!/R\$|em atraso|inadimplente|em negociação|em contratos|com atraso|Exigem atenção|Contratos em dia/i.test(e.texto)) ok('nenhum valor, atraso, inadimplência, negociação ou grupo por situação na tela'); else falha('sobrou situação/valor: ' + (e.texto.match(/R\$[^·]{0,20}|em atraso|inadimplente|em negociação|com atraso|Exigem atenção|Contratos em dia/i) || [])[0]);
    if (e.grupos === 0 && e.nomes.length === 8 && ordenado(e.nomes, 1)) ok('lista única, 8 clientes em ordem alfabética crescente'); else falha('lista: ' + JSON.stringify([e.grupos, e.nomes]));
    if (e.reguas === 0 && !e.prazoVisivel && !e.legenda) ok('sem régua, sem coluna de prazo, sem legenda'); else falha('régua/prazo: ' + JSON.stringify([e.reguas, e.prazoVisivel, e.legenda]));
    if (JSON.stringify(e.chips) === JSON.stringify(['A–Z'])) ok('filtros: só a ordem (A–Z); Todos/PF/PJ são os quadros'); else falha('chips: ' + JSON.stringify(e.chips));
    if (e.busca && e.novo) ok('busca por nome ou CNPJ e "+ Novo cliente" presentes'); else falha('busca/novo: ' + JSON.stringify([e.busca, e.novo]));
    await clicarChip(pg, /^A–Z$/); await pg.waitForTimeout(200); const z = await estadoLista(pg);
    if (ordenado(z.nomes, -1) && z.chips.includes('Z–A') && /decrescente/.test(z.rodape)) ok('ordem decrescente (Z–A) ao clicar; rodapé acompanha'); else falha('Z–A: ' + JSON.stringify([z.nomes, z.chips, z.rodape]));
    await clicarChip(pg, /^Z–A$/); await clicarChip(pg, /^PF/); await pg.waitForTimeout(200); const pf = await estadoLista(pg);
    if (pf.ids.length === 1 && pf.ids[0] === 'c6' && /1 de 8/.test(pf.rodape)) ok('filtro PF: só o cliente pessoa física'); else falha('PF: ' + JSON.stringify([pf.ids, pf.rodape]));
    await clicarChip(pg, /^PJ/); await pg.waitForTimeout(200); const pj = await estadoLista(pg);
    if (pj.ids.length === 7 && !pj.ids.includes('c6')) ok('filtro PJ: 7 clientes'); else falha('PJ: ' + JSON.stringify(pj.ids));
    await clicarChip(pg, /^Todos/); await pg.waitForTimeout(200);
    const alvo = e.nomes[2]; await pg.fill('#np-carteira .np-busca-inline', alvo.slice(0, 5)); await pg.waitForTimeout(700); const bq = await estadoLista(pg);
    if (bq.nomes.length >= 1 && bq.nomes.every(n => n.toLowerCase().includes(alvo.slice(0, 5).toLowerCase())) && await pg.evaluate(() => document.activeElement?.classList.contains('np-busca-inline'))) ok(`busca "${alvo.slice(0, 5)}": ${bq.nomes.length} resultado(s), foco mantido no campo`); else falha('busca: ' + JSON.stringify(bq.nomes));
    await pg.fill('#np-carteira .np-busca-inline', ''); await pg.waitForTimeout(700);
    await pg.screenshot({ path: path.join(OUT, 'carteira-1440.png') });
    await pg.click('#np-carteira li.np-it[data-id="c1"] .np-it-abrir'); await pg.waitForTimeout(700);
    const pn = await pg.evaluate(() => ({ sel: S.sel, lista: !!document.querySelector('#np-carteira'), painel: !!document.querySelector('.np-painel:not([hidden])') }));
    if (pn.sel === 'c1' && !pn.lista && !pn.painel) ok('clicar no cliente abre direto a ficha dele (sem resumo ao lado)'); else falha('clique: ' + JSON.stringify(pn));
    if (!escritas.length) ok('nenhuma gravação'); else falha('gravou: ' + JSON.stringify(escritas).slice(0, 200));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + erros.join(' | ').slice(0, 300));
    await ctx.close(); }
  rel.push('2. Casca antiga, permissões e 375 px');
  { const { ctx, pg, erros } = await abrirCarteira(b, { casca: 'v2' }); const e = await pg.evaluate(() => ({ v3: !!document.querySelector('#np-carteira') }));
    if (!e.v3 && !erros.length) ok('casca antiga: tela anterior, sem a lista nova e sem erros'); else falha('v2: ' + JSON.stringify([e, erros]).slice(0, 200)); await ctx.close(); }
  for (const tema of ['light', 'dark']) { const { ctx, pg, erros } = await abrirCarteira(b, { w: 375, h: 800, tema });
    const r = await pg.evaluate(() => ({ rol: document.documentElement.scrollWidth - document.documentElement.clientWidth, n: document.querySelectorAll('#np-carteira li.np-it').length }));
    if (r.rol <= 1 && r.n === 8 && !erros.length) ok(`375 px ${tema}: 8 clientes, sem rolagem lateral, sem erros`); else falha(`375 ${tema}: ` + JSON.stringify([r, erros]).slice(0, 200));
    await pg.screenshot({ path: path.join(OUT, `carteira-375-${tema}.png`) }); await ctx.close();
  }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
