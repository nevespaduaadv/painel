/* Laboratório da V10 — Financeiro → Contratos e faturamento em V3.1 (solicitações, contratos de honorários, comissões).
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/faturamento-lab.cjs [pasta de saída]  (padrão /tmp/faturamento-lab)
   Verifica: totais contra os registros, grupos e filtros, painel de cada área, faturar e cancelar em dois passos (uma chamada à
   função do banco), marcar comissão paga com data, estados vazios, V2 intacta e as 8 combinações. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/faturamento-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const agora = new Date().toISOString(), mes = agora.slice(0, 7);
const sf = (n, nome, status, valor, x = {}) => ({ id: 'sf' + n, codigo: 'SF-2026-000' + n, cliente_id: 'c' + n, cliente_nome: nome, contrato_id: n <= 2 ? 'ch1' : null, contrato_codigo: n <= 2 ? 'CH-2026-0001' : null, tipo: 'parcela', descricao: 'Honorários fictícios ' + n, valor_total: valor, qtd_parcelas: 3, vencimento_inicial: dia(10), forma: 'BOLETO', emitir_nf: false, solicitante_nome: 'Ana Teste', solicitante_id: 'col-a', created_by: 'outro', created_at: agora, status, parcelas_pagas: 0, valor_pago: 0, comissao_prevista: 0, rateio: [], ...x });
const SFS = [sf(1, 'Alfa Fictícia Ltda', 'em_analise', 3000), sf(2, 'Alfa Fictícia Ltda', 'autorizada', 1500, { autorizada_por_nome: 'Marina Teste', autorizada_em: agora }), sf(3, 'Beta Fictícia ME', 'faturada', 900, { faturada_em: agora, parcelas_pagas: 1, valor_pago: 300 }), sf(4, 'Gama Fictícia', 'cancelada', 400, { motivo: 'Pedido em duplicidade' })];
const CHS = [{ id: 'ch1', codigo: 'CH-2026-0001', cliente_id: 'c1', cliente_nome: 'Alfa Fictícia Ltda', tipo: 'gestao_passivos', status: 'ativo', entrada: 2000, parcelas: 10, valor_parcela: 500, vencimento_dia: 10, mensalidade: null, exito_pct: 10, valor_total: 7000, faturado: 4500, recebido: 300, vigencia_inicio: dia(-90), vigencia_fim: dia(270), indeterminado: false, responsavel_nome: 'Ana Teste', closer_nome: 'Marina Teste', descricao_servico: 'Gestão de passivos bancários (fictício).', created_at: agora },
  { id: 'ch2', codigo: 'CH-2026-0002', cliente_id: 'c2', cliente_nome: 'Beta Fictícia ME', tipo: 'partido', status: 'minuta', mensalidade: 800, valor_total: 9600, faturado: 0, recebido: 0, indeterminado: true, created_at: agora }];
const COMS = [{ id: 'k1', sf_id: 'sf3', sf_codigo: 'SF-2026-0003', cliente_nome: 'Beta Fictícia ME', colaborador_id: 'col-m', colaborador_nome: 'Marina Teste', papel: 'closer', pct: 8, base: 900, valor: 72, status: 'liberada', mes: mes + '-01' }, { id: 'k2', sf_id: 'sf2', sf_codigo: 'SF-2026-0002', cliente_nome: 'Alfa Fictícia Ltda', colaborador_id: 'col-m', colaborador_nome: 'Marina Teste', papel: 'closer', pct: 8, base: 1500, valor: 120, status: 'prevista', mes: mes + '-01' }];
const V = '#view-faturamento';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#faturamento', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_contratos_honorarios|v_solicitacoes_faturamento|v_comissoes|sf_parcelas|contratos_honorarios_aditivos|ts_tabelas_hora|colaboradores\?select=id%2Cperfil_id)/, (rota) => {
    const p = new URL(rota.request().url()).pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.endsWith('/v_contratos_honorarios')) return json(rota, o.vazio ? [] : CHS);
    if (p.endsWith('/v_solicitacoes_faturamento')) return json(rota, o.vazio ? [] : SFS);
    if (p.endsWith('/v_comissoes')) return json(rota, o.vazio ? [] : COMS);
    if (p.endsWith('/sf_parcelas')) return json(rota, [{ n: 1, valor: 300, vencimento: dia(-20), cobranca: { status: 'paga', pago_em: dia(-19) } }, { n: 2, valor: 300, vencimento: dia(10), cobranca: { status: 'pendente' } }, { n: 3, valor: 300, vencimento: dia(40), cobranca: null }]);
    if (p.endsWith('/contratos_honorarios_aditivos')) return json(rota, [{ id: 'a1', data: dia(-30), descricao: 'Inclusão de novo contrato bancário', valor_delta: 1000 }]);
    if (p.endsWith('/colaboradores')) return json(rota, [{ id: 'col-m', perfil_id: 'x', nome: 'Marina Teste', ativo: true }]);
    return json(rota, []);
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'faturamento') { S.tab = 'faturamento'; render(); } });
  if (o.casca === 'v2') await r.pg.waitForFunction((V) => document.querySelector(V + ' .head h1') && document.querySelector(V + ' table'), V, { timeout: 15000 });
  else await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it, ' + V + ' .np-vazio'), V, { timeout: 15000 });
  await r.pg.waitForTimeout(600); return r;
}
const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
const estado = (pg) => pg.evaluate((V) => { const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; return { resumo: t(document.querySelector(V + ' .np-resumo')), abas: [...document.querySelectorAll(V + ' .np-cc-abas button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), chips: [...document.querySelectorAll(V + ' .np-cc-fl button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), tabela: !!document.querySelector(V + ' table'), pilulas: document.querySelectorAll(V + ' .pill').length, vazio: t(document.querySelector(V + ' .np-vazio')), h1v2: t(document.querySelector(V + ' .head h1')), ruim: /NaN|undefined|Infinity/.test(document.querySelector(V).textContent) }; }, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, botoes: [...p.querySelectorAll('.np-btn')].map(t), secoes: [...p.querySelectorAll('.np-sec h3')].map(t), itens: p.querySelectorAll('.np-ft-lst li').length }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const aba = async (pg, rot) => { await pg.click(V + ' .np-cc-abas button:text-is("' + rot + '")'); await pg.waitForTimeout(600); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Contratos e faturamento — solicitações (perfil administradora, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {}); let e = await estado(pg);
    const R = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' '); const res = (e.resumo || '').replace(/\u00a0/g, ' ');
    if (/^1 solicitação em análise/.test(res) && res.includes(R(3000)) && /1 autorizada a faturar/.test(res) && res.includes(R(900) + ' faturado no mês') && res.includes(R(120) + ' em comissões previstas')) ok(`totais conferem com os registros: "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (e.abas.join('|') === 'Solicitações*|Contratos de honorários|Comissões' && e.chips[0] === 'Em aberto2*' && e.chips.length === 6 && e.grupos.length === 2 && /^Em análise/.test(e.grupos[0]) && /:sf:sf1$/.test(e.grupos[0]) && /^Autorizadas, a faturar/.test(e.grupos[1]) && !e.tabela && !e.pilulas && !e.ruim) ok('três áreas; seis filtros de situação; em aberto mostra "Em análise" e "Autorizadas, a faturar"; sem tabela nem pílula'); else falha('lista: ' + JSON.stringify(e));
    await pg.click(`${V} li.np-it[data-id="sf:sf2"] .np-it-abrir`); await pg.waitForTimeout(800); let p = await painel(pg);
    let n0 = escritas.length; await pg.click(V + ' .np-painel .np-btn:text-is("Faturar")'); await pg.waitForTimeout(500); const umClique = escritas.length === n0; const p2 = await painel(pg);
    await pg.click(V + ' .np-painel .np-btn:has-text("Confirmar: gerar 3 cobrança(s)")'); await pg.waitForTimeout(800); let w = escritas.slice(n0);
    if (p && p.titulo === 'Alfa Fictícia Ltda' && /1\.500,00 em 3 parcelas/.test(p.props['Valor']) && /Marina Teste/.test(p.props['Decisão']) && p.secoes.join('|') === 'Descrição|Parcelas|Comissões' && p.itens === 4 && p.botoes.join('|') === 'Faturar|Cancelar a solicitação' && umClique && w.length === 1 && /rpc\/sf_faturar/.test(w[0]) && /"p_id":"sf2"/.test(w[0])) ok('painel da solicitação autorizada: valor, decisão, parcelas e comissões; faturar exige dois cliques e faz uma única chamada à função do banco'); else falha('faturar: ' + JSON.stringify([p, p2 && p2.botoes, umClique, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(400);
    await pg.click(`${V} li.np-it[data-id="sf:sf1"] .np-it-abrir`); await pg.waitForTimeout(700); p = await painel(pg);
    n0 = escritas.length; await pg.click(V + ' .np-painel .np-btn:text-is("Cancelar a solicitação")'); await pg.waitForTimeout(500); const semEscrita = escritas.length === n0; await pg.fill('#ft3-mot', 'Teste fictício'); await pg.click(V + ' .np-painel .np-btn:text-is("Confirmar o cancelamento")'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (p && p.botoes.join('|') === 'Autorizar|Não autorizar|Cancelar a solicitação' && semEscrita && w.length === 1 && /rpc\/sf_cancelar/.test(w[0]) && /"p_motivo":"Teste fictício"/.test(w[0])) ok('solicitação em análise: autorizar, não autorizar e cancelar; o cancelamento pede o motivo no próprio painel antes de gravar'); else falha('cancelar: ' + JSON.stringify([p && p.botoes, semEscrita, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(400);
    await pg.click(V + ' .np-cc-fl button:has-text("Todas")'); await pg.waitForTimeout(500); e = await estado(pg);
    if (e.grupos.length === 4 && /^Faturadas/.test(e.grupos[2]) && /^Canceladas/.test(e.grupos[3])) ok('filtro "Todas": quatro situações em grupos, as encerradas fechadas'); else falha('todas: ' + JSON.stringify(e.grupos));
    rel.push('2. Contratos de honorários e comissões');
    await aba(pg, 'Contratos de honorários'); e = await estado(pg);
    await pg.click(`${V} li.np-it[data-id="ch:ch1"] .np-it-abrir`); await pg.waitForTimeout(800); p = await painel(pg);
    if (e.chips[0] === 'Ativos e assinados1*' && e.grupos.length === 1 && /^Ativo/.test(e.grupos[0]) && !e.tabela && p && p.titulo === 'Alfa Fictícia Ltda' && /7\.000,00/.test(p.props['Valor total']) && /10 × /.test(p.props['Parcelas']) && p.props['Êxito'] === '10%' && p.secoes.some(s => /^Aditivos · 1/.test(s)) && p.secoes.some(s => /^Solicitações de faturamento · 2/.test(s)) && p.botoes.join('|') === 'Solicitar faturamento|Editar|Novo aditivo') ok('contratos: filtro por situação, grupo por status; o painel traz honorários, vigência, aditivos, solicitações do contrato e as três ações'); else falha('contratos: ' + JSON.stringify([e.chips, e.grupos, p]));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await aba(pg, 'Comissões'); e = await estado(pg);
    await pg.click(`${V} li.np-it .np-it-abrir`); await pg.waitForTimeout(700); p = await painel(pg);
    n0 = escritas.length; await pg.click(V + ' .np-painel .np-btn:text-is("Marcar as liberadas como pagas")'); await pg.waitForTimeout(500); const semE = escritas.length === n0; const temData = await pg.evaluate(() => !!document.querySelector('#ft3-dt')?.value);
    await pg.click(V + ' .np-painel .np-btn:has-text("Confirmar:")'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (e.grupos.length === 1 && /liberado/.test(e.grupos[0]) && p && p.titulo === 'Marina Teste' && /72,00/.test(p.props['Liberada']) && /120,00/.test(p.props['Prevista']) && p.itens === 2 && semE && temData && w.length === 1 && /PATCH \/rest\/v1\/comissoes/.test(w[0]) && /"status":"paga"/.test(w[0]) && /k1/.test(w[0]) && !/k2/.test(w[0])) ok('comissões: uma linha por colaborador e mês com prevista, liberada e paga separadas; marcar pagas pede a data e altera só as liberadas'); else falha('comissões: ' + JSON.stringify([e.grupos, p, semE, temData, w]));
    if (!escritas.some(x => /functions\/v1|asaas|chatguru|regua_/.test(x))) ok('em toda a sessão: nenhuma chamada ao Asaas, à régua ou a mensageria'); else falha('externas: ' + JSON.stringify(escritas));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3))); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { vazio: true }); const vz = [];
    for (const a of ['Solicitações', 'Contratos de honorários', 'Comissões']) { await aba(pg, a); const e = await estado(pg); vz.push({ a, vazio: (e.vazio || '').slice(0, 50), ruim: e.ruim, tabela: e.tabela }); }
    if (vz.every(x => x.vazio && !x.ruim && !x.tabela) && !erros.length) ok('sem registros: as três áreas explicam o vazio e oferecem a próxima ação'); else falha('vazios: ' + JSON.stringify([vz, erros.slice(0, 2)])); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const e = await estado(pg);
    if (e.h1v2 === 'Contratos e faturamento' && e.tabela && !e.abas.length && !erros.length) ok('V2 intacta: a tela segue como estava'); else falha('V2: ' + JSON.stringify([e.h1v2, e.tabela, e.abas, erros.slice(0, 2)])); await ctx.close(); }
  rel.push('3. 375 / 768 / 1024 / 1440 × claro / escuro — lista e painel');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w, h: w < 800 ? 780 : 900, tema }); const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-resumo span', nome: 'rótulo' }, { sel: V + ' .np-grp-h .t', nome: 'grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'cliente' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-valor', nome: 'valor' }, { sel: V + ' .np-cc-abas .np-seg button', nome: 'área' }, { sel: V + ' .np-cc-fl .np-chipf', nome: 'filtro' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$|np-check/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `faturamento-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="sf:sf2"] .np-it-abrir`); await pg.waitForTimeout(800); const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-painel .np-ft-lst .a', nome: 'parcela' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `faturamento-${w}-${tema}-painel.png`) });
    if (w === 1440 && tema === 'light') { await pg.keyboard.press('Escape'); await aba(pg, 'Contratos de honorários'); await pg.click(`${V} li.np-it[data-id="ch:ch1"] .np-it-abrir`); await pg.waitForTimeout(800); await pg.screenshot({ path: path.join(OUT, 'faturamento-contratos.png') }); await pg.keyboard.press('Escape'); await aba(pg, 'Comissões'); await pg.click(`${V} li.np-it .np-it-abrir`); await pg.waitForTimeout(700); await pg.screenshot({ path: path.join(OUT, 'faturamento-comissoes.png') }); }
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral, contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 6))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
