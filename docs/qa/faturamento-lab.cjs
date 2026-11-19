/* Laboratório do Financeiro → Contratos e faturamento (19/11, 12h).
   Decisão das sócias: na casca nova, o Financeiro tem só as quatro páginas da especificação do setor; Contratos e faturamento sai da
   navegação. Na casca antiga, nada muda (igual à produção).
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/faturamento-lab.cjs [pasta de saída]  (padrão /tmp/faturamento-lab)
   Verifica: casca nova sem a tela (endereço antigo abre a Visão geral, sem gravar); casca antiga com a tela como estava. */
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
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, botoes: [...p.querySelectorAll('.np-btn')].map(t), secoes: [...p.querySelectorAll('.np-sec h3')].map(t), mais: t(p.querySelector('details.np-ft-mais > summary')), principais: (() => { const o = {}; const dl = p.querySelector('.np-props'); dl && dl.querySelectorAll('dt').forEach(dt => o[t(dt)] = 1); return o; })(), itens: p.querySelectorAll('.np-ft-lst li').length }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const aba = async (pg, rot) => { await pg.click(V + ' .np-cc-abas button:text-is("' + rot + '")'); await pg.waitForTimeout(600); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Casca nova: Contratos e faturamento fora do Financeiro');
  { const r = await contexto(b, { hash: '#faturamento', extraLS: { 'pp-tab': 'faturamento' } });
    await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 }); await r.pg.evaluate(() => { S.tab = 'faturamento'; render(); }); await r.pg.waitForTimeout(900);
    const e = await r.pg.evaluate(() => ({ tab: S.tab, menu: [...document.querySelectorAll('#np-tree .tab[data-tab]')].map(b => b.dataset.tab), vis: !!document.querySelector('#view-faturamento:not([hidden])') }));
    if (e.tab === 'fin-visao' && !e.menu.includes('faturamento') && !e.vis && !r.escritas.length && !r.erros.length) ok('o endereço antigo abre a Visão geral do Financeiro; Contratos e faturamento fora do menu'); else falha('casca nova: ' + JSON.stringify([e, r.escritas.slice(0, 2), r.erros.slice(0, 2)])); await r.ctx.close(); }
  rel.push('2. Casca antiga igual à produção');
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const e = await estado(pg);
    if (e.h1v2 === 'Contratos e faturamento' && e.tabela && !e.abas.length && !erros.length) ok('Contratos e faturamento: a tela segue como estava'); else falha('V2: ' + JSON.stringify([e.h1v2, e.tabela, e.abas, erros.slice(0, 2)])); await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
