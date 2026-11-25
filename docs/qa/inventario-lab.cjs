/* Laboratório da V10 — Financeiro → Inventário em V3.1 (equipamentos, por pessoa, revisão, histórico).
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/inventario-lab.cjs [pasta de saída]  (padrão /tmp/inventario-lab)
   Verifica: totais contra os registros, grupos e filtros, painel do equipamento, conferência da revisão (localizado na hora;
   divergência só com descrição), por pessoa, histórico por dia, estados vazios, V2 intacta e as 8 combinações. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/inventario-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright'); require('./_popup.cjs');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const agora = new Date().toISOString();
const it = (id, pat, tipo, sit, resp, x = {}) => ({ id, patrimonio: pat, tipo, marca: 'Fictícia', modelo: 'M' + id, numero_serie: 'SN' + id, situacao: sit, ativo: true, responsavel_id: resp ? 'col-' + resp : null, responsavel_nome: resp ? resp + ' Teste' : null, departamento: resp ? 'Jurídico' : null, especificacoes: tipo === 'notebook' ? { ram: '16 GB' } : {}, ultima_revisao_em: null, ultima_revisao_resultado: null, valor: 1000, adquirido_em: dia(-200), ...x });
const ITENS = [it('i1', 'NP-001', 'notebook', 'em_uso', 'Ana'), it('i2', 'NP-002', 'monitor', 'em_uso', 'Ana'), it('i3', 'NP-003', 'notebook', 'disponivel', null), it('i4', 'NP-004', 'impressora', 'manutencao', null), it('i5', 'NP-005', 'mouse', 'baixado', null)];
const MOVS = [{ id: 'm1', item_id: 'i1', patrimonio: 'NP-001', tipo: 'atribuicao', para_nome: 'Ana Teste', autor_nome: 'Marina Teste', criado_em: agora }, { id: 'm2', item_id: 'i4', patrimonio: 'NP-004', tipo: 'situacao', de_situacao: 'em_uso', para_situacao: 'manutencao', autor_nome: 'Marina Teste', criado_em: new Date(Date.now() - 864e5).toISOString() }];
const V = '#view-inventario';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#inventario', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_inventario_movimentos|v_inventario|inventario_revisoes|escritorio\?select=dados|tarefas\?select=id%2Ctitulo%2Cstatus%2Cprazo%2Cresponsavel_id&titulo=like)/, (rota) => { const p = new URL(rota.request().url()).pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.endsWith('/v_inventario')) return json(rota, o.vazio ? [] : ITENS); if (p.endsWith('/v_inventario_movimentos')) return json(rota, o.vazio ? [] : MOVS);
    if (p.endsWith('/inventario_revisoes')) return json(rota, [{ item_id: 'i2', resultado: 'localizado', revisado_por_nome: 'Marina Teste', revisado_em: agora }]);
    if (p.endsWith('/escritorio')) return json(rota, { dados: { revisao_frequencia: 'trimestral' } });
    return json(rota, o.vazio || o.semRevisao ? null : { id: 'tr1', titulo: 'Revisão do inventário — 2026-T4', status: 'aberta', prazo: dia(10), responsavel_id: null }); });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'inventario') { S.tab = 'inventario'; render(); } });
  if (o.casca === 'v2') await r.pg.waitForFunction((V) => document.querySelector(V + ' .head h1') && document.querySelector(V + ' table'), V, { timeout: 15000 });
  else await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it, ' + V + ' .np-vazio'), V, { timeout: 15000 });
  await r.pg.waitForTimeout(600); return r;
}
const estado = (pg) => pg.evaluate((V) => { const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; return { resumo: t(document.querySelector(V + ' .np-resumo')), abas: [...document.querySelectorAll(V + ' .np-cc-abas button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), chips: [...document.querySelectorAll(V + ' .np-cc-fl button')].map(x => t(x)), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), rotulos: [...document.querySelectorAll(V + ' .np-inv-f label')].map(t), tabela: !!document.querySelector(V + ' table'), pilulas: document.querySelectorAll(V + ' .pill').length, vazio: t(document.querySelector(V + ' .np-vazio')), h1v2: t(document.querySelector(V + ' .head h1')), ruim: /NaN|undefined|Infinity|null/.test(document.querySelector(V).textContent) }; }, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, botoes: [...p.querySelectorAll('.np-btn')].map(t), itens: p.querySelectorAll('.np-ft-lst li').length }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const aba = async (pg, rot) => { await pg.click(V + ' .np-cc-abas button:text-is("' + rot + '")'); await pg.waitForTimeout(600); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Inventário — equipamentos, por pessoa, revisão e histórico (perfil administradora, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {}); let e = await estado(pg);
    if (/^4 equipamentos/.test(e.resumo) && /2 em uso/.test(e.resumo) && /1 disponível/.test(e.resumo) && /1 em manutenção/.test(e.resumo) && /3 a conferir na revisão aberta/.test(e.resumo)) ok(`totais conferem com os registros: "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (e.abas.join('|') === 'Equipamentos*|Por pessoa|Revisão|Histórico' && JSON.stringify(e.grupos) === JSON.stringify(['Em uso2:i1,i2', 'Disponível1:i3', 'Manutenção1:i4', 'Baixado1:i5']) && e.chips.length === 5 && e.rotulos.join('|') === 'Tipo|Responsável|Departamento' && !e.tabela && !e.pilulas && !e.ruim) ok('equipamentos em grupos por situação (baixados recolhidos), cinco filtros de situação e três campos com rótulo; sem tabela nem pílula'); else falha('lista: ' + JSON.stringify(e));
    await pg.click(`${V} li.np-it[data-id="i1"] .np-it-abrir`); await pg.waitForTimeout(700); let p = await painel(pg);
    if (p && p.titulo === 'Notebook Fictícia Mi1' && p.props['Responsável'] === 'Ana Teste' && p.props['Memória RAM'] === '16 GB' && /a conferir/.test(p.props['Revisão aberta']) && p.itens === 1 && p.botoes.join('|') === 'Transferir ou devolver|Editar') ok('painel do equipamento: situação, responsável, revisão, histórico e, recolhidos, série, valor e características com o nome do campo'); else falha('painel: ' + JSON.stringify(p));
    await pg.keyboard.press('Escape'); await aba(pg, 'Por pessoa'); e = await estado(pg);
    if (JSON.stringify(e.grupos) === JSON.stringify(['Ana Teste2:i1,i2', 'Sem responsável2:i3,i4'])) ok('por pessoa: quem está com o quê; sem responsável por último'); else falha('pessoas: ' + JSON.stringify(e.grupos));
    await aba(pg, 'Revisão'); e = await estado(pg);
    let n0 = escritas.length; await pg.click(`${V} li.np-it[data-id="i3"] .np-it-abrir`); await pg.waitForTimeout(700); p = await painel(pg);
    await pg.click(V + ' .np-painel .np-btn:text-is("Divergente")'); await pg.waitForTimeout(400); const semE = escritas.length === n0; await pg.click(V + ' .np-painel .np-btn:text-is("Confirmar a divergência")'); await pg.waitForTimeout(400); const semTexto = escritas.length === n0;
    await pg.fill('#inv3-pend', 'Está com outra pessoa'); await pg.click(V + ' .np-painel .np-btn:text-is("Confirmar a divergência")'); await pg.waitForTimeout(800); const w = escritas.slice(n0);
    if (JSON.stringify(e.grupos) === JSON.stringify(['A conferir3:i1,i3,i4', 'Localizados1:i2']) && p && p.botoes.join('|') === 'Localizado|Divergente|Não localizado' && semE && semTexto && w.length === 1 && /rpc\/inventario_revisar/.test(w[0]) && /"p_resultado":"divergente"/.test(w[0]) && /"p_pendencia":"Está com outra pessoa"/.test(w[0]) && /"p_item":"i3"/.test(w[0])) ok('revisão: a conferir primeiro, localizados recolhidos; a divergência só grava com a descrição preenchida, numa única chamada à função do banco'); else falha('revisão: ' + JSON.stringify([e.grupos, p && p.botoes, semE, semTexto, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(400); await pg.keyboard.press('Escape');
    await aba(pg, 'Histórico'); e = await estado(pg);
    if (e.grupos.length === 2 && /:m:m1$/.test(e.grupos[0]) && !e.tabela) ok('histórico agrupado por dia, do mais recente para o mais antigo'); else falha('histórico: ' + JSON.stringify(e.grupos));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3))); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { vazio: true }); const vz = [];
    for (const a of ['Equipamentos', 'Por pessoa', 'Revisão', 'Histórico']) { await aba(pg, a); const e = await estado(pg); vz.push({ a, vazio: (e.vazio || '').slice(0, 50), ruim: e.ruim, tabela: e.tabela }); }
    if (vz.every(x => x.vazio && !x.ruim && !x.tabela) && !erros.length) ok('sem registros: as quatro áreas explicam o vazio'); else falha('vazios: ' + JSON.stringify([vz, erros.slice(0, 2)])); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const e = await estado(pg);
    if (e.h1v2 === 'Inventário' && e.tabela && !e.abas.length && !erros.length) ok('V2 intacta: a tela segue como estava'); else falha('V2: ' + JSON.stringify([e.h1v2, e.tabela, e.abas, erros.slice(0, 2)])); await ctx.close(); }
  rel.push('2. 375 / 768 / 1024 / 1440 × claro / escuro — lista e painel');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w, h: w < 800 ? 780 : 900, tema }); const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-resumo span', nome: 'rótulo' }, { sel: V + ' .np-grp-h .t', nome: 'grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'equipamento' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-it-prazo', nome: 'patrimônio' }, { sel: V + ' .np-inv-f label', nome: 'rótulo do filtro' }, { sel: V + ' .np-cc-fl .np-chipf', nome: 'filtro' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$|np-check/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `inventario-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="i1"] .np-it-abrir`); await pg.waitForTimeout(800); const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `inventario-${w}-${tema}-painel.png`) });
    if (w === 1440 && tema === 'light') { await pg.keyboard.press('Escape'); await aba(pg, 'Revisão'); await pg.screenshot({ path: path.join(OUT, 'inventario-revisao.png') }); }
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral, contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 6))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
