/* Laboratório do Financeiro → Cobranças no Asaas (19/11, 12h).
   Decisão das sócias: na casca nova, o Financeiro tem só as quatro páginas da especificação do setor; as telas do Asaas (Cobranças,
   Clientes e Conta) saem da navegação, e a integração continua. Na casca antiga, nada muda (igual à produção).
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/cobrancas-lab.cjs [pasta de saída]  (padrão /tmp/cobrancas-lab)
   Verifica: casca nova sem as telas do Asaas (endereço antigo abre a Visão geral, sem gravar); casca antiga com as três telas e a Central. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/cobrancas-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const mes = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const b0 = { tipo: 'parcela', forma: 'BOLETO', status_asaas: 'PENDING', regua_enviadas: [], regua_parada: false, link_fatura: 'https://exemplo.invalid/fatura', link_boleto: null, asaas_id: 'pay_ficticio', asaas_cliente_id: 'cus_ficticio' };
const COB = [
  { ...b0, id: 'k1', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', descricao: 'Honorários — Gestão de Passivos', parcela: 3, total_parcelas: 12, valor: 1500, vencimento: dia(-8), status: 'atrasada', dias_atraso: 8, regua_enviadas: ['D-3', 'D0', 'D+1', 'D+5'] },
  { ...b0, id: 'k2', cliente_id: 'c3', cliente_nome: 'Gama Comércio Ltda', descricao: 'Entrada', tipo: 'entrada', valor: 4000, vencimento: dia(3), status: 'pendente' },
  { ...b0, id: 'k3', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', descricao: 'Honorários — Gestão de Passivos', parcela: 4, total_parcelas: 12, valor: 1500, vencimento: dia(22), status: 'pendente', regua_parada: true },
  { ...b0, id: 'k4', cliente_id: null, cliente_nome: null, descricao: 'Cobrança avulsa do Asaas', tipo: 'outro', valor: 320.5, vencimento: dia(40), status: 'pendente' },
  { ...b0, id: 'k5', cliente_id: 'c4', cliente_nome: 'Delta Serviços Ltda', descricao: 'Mensalidade', tipo: 'mensalidade', valor: 900, valor_liquido: 891.01, vencimento: dia(-12), status: 'paga', pago_em: dia(-13), status_asaas: 'RECEIVED' },
  { ...b0, id: 'k6', cliente_id: 'c4', cliente_nome: 'Delta Serviços Ltda', descricao: 'Mensalidade', tipo: 'mensalidade', valor: 900, vencimento: dia(-40), status: 'cancelada', status_asaas: 'DELETED' },
];
const ASC = [
  { asaas_id: 'cus_a', nome: 'Empresa Alfa Ltda', cpf_cnpj: '00.000.000/0001-00', telefone: '(16) 90000-0001', email: 'alfa@ficticio.test', cliente_id: 'c1' },
  { asaas_id: 'cus_b', nome: 'Gama Comércio Ltda', cpf_cnpj: '00.000.000/0002-00', telefone: '(16) 90000-0002', email: 'gama@ficticio.test', cliente_id: 'c3' },
  { asaas_id: 'cus_c', nome: 'Pessoa Avulsa Fictícia', cpf_cnpj: '000.000.000-00', telefone: null, email: null, cliente_id: null },
  { asaas_id: 'cus_d', nome: 'Delta Serviços Ltda', cpf_cnpj: '00.000.000/0004-00', telefone: '(16) 90000-0004', email: null, cliente_id: 'c4' },
];
const CCOB = [{ asaas_cliente_id: 'cus_a', cliente_id: 'c1', valor: 1500, venc_ef: dia(-8), paga: false }, { asaas_cliente_id: 'cus_a', cliente_id: 'c1', valor: 1500, venc_ef: dia(22), paga: false }, { asaas_cliente_id: 'cus_b', cliente_id: 'c3', valor: 4000, venc_ef: dia(3), paga: false }, { asaas_cliente_id: 'cus_c', cliente_id: null, valor: 320.5, venc_ef: dia(40), paga: false }, { asaas_cliente_id: 'cus_d', cliente_id: 'c4', valor: 900, venc_ef: dia(-12), paga: true }];
const CONTA = { ok: true, ambiente: 'produção', conta: { name: 'Escritório Fictício', cpfCnpj: '00.000.000/0009-00', email: 'financeiro@ficticio.test' }, saldo: { balance: 12345.67 }, taxas: { payment: { bankSlip: { defaultValue: 1.99 }, pix: { fixedValue: 0.99 }, creditCard: { operationValue: 0.49, oneInstallmentPercentage: 2.99 } }, transfer: { value: 5, monthlyTransfersWithoutFee: 30 }, notification: { emailNotification: 0, smsNotification: 0.99 } }, estatisticas_mes: { quantity: 14, value: 21000, netValue: 20700 } };
const V = '#view-financeiro';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#financeiro', extraLS: { 'pp-fin-sub': o.sub || 'asaas' }, escrita: (m, p) => /functions\/v1\/chatguru\/enviar/.test(p) ? (o.contaErro ? { status: 200, body: { ok: false, erro: 'falha fictícia' } } : { status: 200, body: CONTA }) : null, ...o });
  const json = (rota, corpo, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  let falhar = o.erro || 0; const cfg = { regua_whatsapp: false, multa: 2 };
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_cobrancas|v_financeiro_mes|asaas_sincronizacoes|escritorio|asaas_contatos|v_central_cobrancas)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/v_cobrancas')) { if (falhar > 0) { falhar--; return json(rota, { message: 'falha fictícia' }, 500); } const st = u.searchParams.get('status') || ''; return json(rota, o.vazio ? [] : COB.filter(c => /pendente/.test(st) ? ['pendente', 'atrasada'].includes(c.status) : !['pendente', 'atrasada'].includes(c.status))); }
    if (p.startsWith('/rest/v1/asaas_contatos')) return json(rota, ASC); if (p.startsWith('/rest/v1/v_central_cobrancas') && /chave_cliente/.test(u.searchParams.get('select') || '')) return json(rota, CCOB);
    if (p.startsWith('/rest/v1/v_financeiro_mes')) return json(rota, { mes, recebido: 900, n_pagas: 1 });
    if (p.startsWith('/rest/v1/asaas_sincronizacoes')) return json(rota, { id: 1, inicio: new Date().toISOString(), ok: true, cobrancas: 6, clientes: 4 });
    if (p.startsWith('/rest/v1/escritorio')) return (u.searchParams.get('id') || '') === 'eq.financeiro' ? json(rota, { dados: cfg }) : rota.fallback();
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'financeiro') { S.tab = 'financeiro'; render(); } });
  if (o.erro || o.vazio) await r.pg.waitForFunction((V) => document.querySelector(V + ' .np-erro, ' + V + ' .np-vazio'), V, { timeout: 15000 });
  else if (o.sub === 'conta') await r.pg.waitForFunction((V) => document.querySelector(V + (document.documentElement.classList.contains('np-casca-v3') ? ' .np-fin-cartao .np-props, ' + V + ' .np-fin-cartao .np-erro' : ' .card.section')), V, { timeout: 15000 });
  else if (o.casca !== 'v2') await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 });
  else await r.pg.waitForFunction((V) => document.querySelector(V + ' table tbody tr'), V, { timeout: 15000 });
  await r.pg.waitForTimeout(500);
  return r;
}
const estado = (pg) => pg.evaluate((V) => { const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  const linha = (id) => { const li = document.querySelector(`${V} li.np-it[data-id="${id}"]`); if (!li) return null; return { regua: [...li.classList].filter(c => /^r-/.test(c)).join(), prazo: t(li.querySelector('.np-it-prazo')), titulo: t(li.querySelector('.np-it-abrir .tx')), ctx: t(li.querySelector('.np-it-abrir .ctx')), marcas: [...li.querySelectorAll('.np-it-dir .np-marca')].map(m => m.textContent + '|' + [...m.classList].filter(c => c !== 'np-marca' && c !== 'np-so-largo').join()), valor: t(li.querySelector('.np-valor')) }; };
  return { resumo: t(document.querySelector(V + ' .np-resumo')), chips: [...document.querySelectorAll(V + ' .np-chipf')].map(c => t(c) + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), est: t(document.querySelector(V + ' .np-fin-estado')), v2: !!document.querySelector(V + ' .kpis, ' + V + ' table'), pilulas: document.querySelectorAll(V + ' .pill').length, pri: [...document.querySelectorAll('.np-btn.pri')].filter(b => b.offsetParent).map(t), k1: linha('k1'), k2: linha('k2'), k3: linha('k3'), k4: linha('k4'), k5: linha('k5') }; }, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, botoes: [...p.querySelectorAll('.np-btn')].map(t), obs: !!p.querySelector('textarea') }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Casca nova: telas do Asaas fora do Financeiro');
  for (const sub of ['asaas', 'clientes', 'conta']) { const r = await contexto(b, { hash: '#financeiro', extraLS: { 'pp-fin-sub': sub, 'pp-tab': 'financeiro' } });
    await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 }); await r.pg.evaluate(() => { S.tab = 'financeiro'; render(); }); await r.pg.waitForTimeout(900);
    const e = await r.pg.evaluate(() => ({ tab: S.tab, menu: [...document.querySelectorAll('#np-tree .tab[data-tab]')].map(b => b.dataset.tab), vis: !!document.querySelector('#view-financeiro:not([hidden])'), conta: performance.getEntriesByType('resource').some(x => /functions\/v1\/chatguru\/enviar/.test(x.name)) }));
    if (e.tab === 'fin-visao' && !e.menu.includes('financeiro') && !e.vis && !e.conta && !r.escritas.length && !r.erros.length) ok(`${sub}: o endereço antigo abre a Visão geral do Financeiro; nenhuma tela do Asaas no menu e nenhuma consulta à conta`);
    else falha(sub + ': ' + JSON.stringify([e, r.escritas.slice(0, 2), r.erros.slice(0, 2)])); await r.ctx.close(); }
  rel.push('2. Casca antiga igual à produção');
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const v2 = await pg.evaluate((V) => ({ kpis: !!document.querySelector(V + ' .kpis'), linhas: document.querySelectorAll(V + ' table tbody tr').length, nova: [...document.querySelectorAll(V + ' button')].some(x => /Nova cobrança/.test(x.textContent)), v3: !!document.querySelector(V + ' .np-toolbar'), subs: [...document.querySelectorAll(V + ' .tabs .tab')].map(x => x.textContent.trim()) }), V);
    if (v2.kpis && v2.linhas === 4 && v2.nova && !v2.v3 && v2.subs.includes('Central de Cobranças') && !erros.length) ok('Cobranças (Asaas): indicadores, tabela com as 4 abertas, "+ Nova cobrança" e a Central de Cobranças, como na produção'); else falha('V2: ' + JSON.stringify([v2, erros.slice(0, 2)])); await ctx.close(); }
  for (const sub of ['clientes', 'conta']) { const { ctx, pg, erros } = await abrir(b, { sub, casca: 'v2' }); const v2 = await pg.evaluate((V) => ({ head: document.querySelector(V + ' .head h1')?.textContent, v3: !!document.querySelector(V + ' .np-toolbar'), abas: document.querySelectorAll(V + ' .tabs .tab').length }), V);
    if (v2.head && !v2.v3 && v2.abas === 4 && !erros.length) ok(`"${v2.head}" como na produção`); else falha('V2 ' + sub + ': ' + JSON.stringify([v2, erros.slice(0, 2)])); await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
