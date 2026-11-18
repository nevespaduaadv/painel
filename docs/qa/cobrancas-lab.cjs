/* Laboratório da entrega visual V10 (1ª tela) — Financeiro → Cobranças em V3.1.
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/cobrancas-lab.cjs [pasta de saída]  (padrão /tmp/cobrancas-lab)
   Verifica: mesmas contas da V2, grupos pelo vencimento, régua, valores, filtros, painel, ações iguais às da V2 (fatura, Pix,
   pausar régua, vincular, observação, nova cobrança, sincronizar), régua de WhatsApp só muda por ação explícita da administradora,
   nenhuma gravação ao navegar, só leitura, erro, vazio, V2 intacta, as 8 combinações. */
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
  rel.push('1. Cobranças V3.1 — resumo, grupos pelo vencimento, régua, valores (perfil admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {});
    const e = await estado(pg);
    if (/R\$\s?900,00 recebido no mês \(1\)/.test(e.resumo) && /R\$\s?1\.500,00 em atraso \(1 · 1 cliente\)/.test(e.resumo) && /R\$\s?7\.320,50 em aberto \(4\)/.test(e.resumo)) ok(`resumo com as contas da V2: "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (e.grupos.length === 3 && /^Em atraso · R\$\s?1\.500,00\s*1:k1$/.test(e.grupos[0]) && /^Vencem em até 7 dias · R\$\s?4\.000,00\s*1:k2$/.test(e.grupos[1]) && /^A vencer · R\$\s?1\.820,50\s*2:k3,k4$/.test(e.grupos[2])) ok('grupos pelo vencimento, com o total de cada um; por padrão só as abertas (como na V2)'); else falha('grupos: ' + JSON.stringify(e.grupos));
    if (e.k1 && e.k1.regua === 'r-late' && e.k1.titulo === 'Empresa Alfa Ltda' && /parcela 3\/12 · Parcela/.test(e.k1.ctx) && e.k1.marcas.some(m => /^régua: 4 msg/.test(m)) && /1\.500,00/.test(e.k1.valor)) ok(`k1: régua de atraso, "${e.k1.prazo}", parcela 3/12, régua com 4 mensagens, valor ${e.k1.valor}`); else falha('k1: ' + JSON.stringify(e.k1));
    if (e.k2 && e.k2.regua === 'r-att' && e.k3 && e.k3.regua === '' && e.k3.marcas.some(m => /^régua pausada/.test(m))) ok('k2: vence em 3 dias → régua âmbar; k3: sem régua, "régua pausada"'); else falha('k2/k3: ' + JSON.stringify([e.k2, e.k3]));
    if (e.k4 && e.k4.titulo === 'Sem cliente vinculado' && e.k4.marcas.some(m => /^sem cliente\|att/.test(m))) ok('k4: "Sem cliente vinculado" com a marca'); else falha('k4: ' + JSON.stringify(e.k4));
    if (e.chips.some(c => /^Em atraso\s*1$/.test(c)) && e.chips.some(c => /^Em aberto\s*3$/.test(c)) && e.chips.some(c => /^Pagas\s*1$/.test(c)) && e.chips.some(c => /^Sem cliente\s*1$/.test(c)) && !e.v2 && !e.pilulas && e.pri.includes('Nova cobrança')) ok('filtros com contagem; "Nova cobrança" é a ação primária; nada da tela V2 (cartões, tabela, pílulas)'); else falha('chips: ' + JSON.stringify([e.chips, e.v2, e.pilulas, e.pri]));
    if (/Asaas · última sincronização/.test(e.est) && /6 cobrança\(s\), 4 cliente\(s\)/.test(e.est) && /Régua por WhatsApp · desligada/.test(e.est)) ok(`estado: "${e.est}"`); else falha('estado: ' + e.est);
    await pg.click(V + ' .np-chipf:has-text("Pagas")'); await pg.waitForTimeout(300); const fp = (await estado(pg)); await pg.click(V + ' .np-chipf:has-text("Todas")'); await pg.waitForTimeout(300); const ft = await estado(pg); await pg.click(V + ' .np-chipf:has-text("Todas")'); await pg.waitForTimeout(300);
    if (fp.grupos.length === 1 && /Pagas.*:k5$/.test(fp.grupos[0]) && fp.k5.marcas.some(m => /^paga em /.test(m)) && ft.grupos.length === 5) ok('filtros: "Pagas" mostra só as pagas (com "paga em"); "Todas" mostra os cinco grupos'); else falha('filtros: ' + JSON.stringify([fp.grupos, ft.grupos]));
    await pg.click(`${V} li.np-it[data-id="k1"] .np-it-abrir`); await pg.waitForTimeout(700); const p = await painel(pg);
    if (p && p.titulo === 'Empresa Alfa Ltda' && /atrasada/.test(p.props['Situação']) && /8 dia\(s\) de atraso/.test(p.props['Situação']) && /1\.500,00/.test(p.props['Valor']) && p.props['Parcela'] === '3 de 12' && /D-3, D0/.test(p.props['Régua']) && p.obs) ok('painel: situação, valor, vencimento, parcela, régua e observações'); else falha('painel: ' + JSON.stringify(p));
    if (p && JSON.stringify(p.botoes) === JSON.stringify(['Salvar observação', 'Abrir fatura', 'Copiar Pix', 'Pausar régua'])) ok('ações do painel = as do detalhe da V2: Abrir fatura, Copiar Pix, Pausar régua, Salvar observação'); else falha('botões: ' + JSON.stringify(p && p.botoes));
    await pg.screenshot({ path: path.join(OUT, 'cobrancas-1440-light-painel.png') });
    if (!escritas.length) ok('nenhuma gravação ao listar, filtrar e abrir o painel'); else falha('escritas: ' + JSON.stringify(escritas.slice(0, 3)));
    const n0 = escritas.length; await pg.click(V + ' .np-painel .np-btn:has-text("Pausar régua")'); await pg.waitForTimeout(700); const w = escritas.slice(n0);
    if (w.length === 1 && /^PATCH \/rest\/v1\/cobrancas\?id=eq\.k1/.test(w[0]) && /"regua_parada":true/.test(w[0])) ok('"Pausar régua" faz a mesma gravação da V2 (só esta cobrança)'); else falha('pausar: ' + JSON.stringify(w));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(300);
    await pg.click(`${V} li.np-it[data-id="k4"] .np-it-abrir`); await pg.waitForTimeout(600); const p4 = await painel(pg);
    if (p4 && p4.botoes.includes('Vincular cliente') && /sem cliente vinculado/.test(p4.props['Cliente'])) ok('cobrança sem cliente: "Vincular cliente" no painel'); else falha('k4 painel: ' + JSON.stringify(p4));
    // régua geral: só muda por ação explícita
    const n1 = escritas.length; await pg.click(V + ' .np-fin-estado .np-link'); await pg.waitForTimeout(300);
    const pop = await pg.evaluate(() => ({ tx: document.querySelector('#np-pop .np-fin-regua')?.textContent, bt: [...document.querySelectorAll('#np-pop .np-btn')].map(x => x.textContent) }));
    if (/Hoje está desligada/.test(pop.tx || '') && pop.bt.includes('Ligar a régua') && escritas.length === n1) ok('régua por WhatsApp: abrir "Alterar" não grava nada; ligar exige um segundo clique explícito'); else falha('régua: ' + JSON.stringify([pop, escritas.slice(n1)]));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    if (escritas.length === n1) ok('fechar sem confirmar: a régua continua como estava'); else falha('régua alterada: ' + JSON.stringify(escritas.slice(n1)));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3)));
    await ctx.close(); }
  rel.push('2. Só leitura, erro, vazio, V2');
  { const { ctx, pg } = await abrir(b, {}); await pg.evaluate(() => { S.canWrite = false; render(); }); await pg.waitForTimeout(400); const e = await estado(pg);
    await pg.click(`${V} li.np-it[data-id="k1"] .np-it-abrir`); await pg.waitForTimeout(600); const p = await painel(pg);
    if (!e.pri.includes('Nova cobrança') && p && JSON.stringify(p.botoes) === JSON.stringify(['Abrir fatura']) && !p.obs) ok('só leitura: sem "Nova cobrança", painel só com "Abrir fatura", sem campo de observação'); else falha('só leitura: ' + JSON.stringify([e.pri, p]));
    await ctx.close(); }
  { const { ctx, pg, leituras } = await abrir(b, { erro: 2 }); const n0 = leituras.filter(x => /v_cobrancas\?/.test(x)).length; await pg.waitForTimeout(2500); const n1 = leituras.filter(x => /v_cobrancas\?/.test(x)).length; const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-erro')?.textContent, V);
    if (/Não foi possível carregar as cobranças/.test(tx || '') && n1 === n0) ok('erro de carga: aviso com "Tentar de novo", sem repetir sozinho'); else falha(`erro: ${tx} (${n0}→${n1})`);
    await pg.click(V + ' .np-erro .lnk'); await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); ok('"Tentar de novo" recarrega'); await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { vazio: true }); const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-vazio')?.textContent, V);
    if (/Nenhuma cobrança/.test(tx || '') && /Sincronizar com o Asaas/.test(tx)) ok('vazio: explica e oferece "Sincronizar com o Asaas"'); else falha('vazio: ' + tx); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const v2 = await pg.evaluate((V) => ({ kpis: !!document.querySelector(V + ' .kpis'), linhas: document.querySelectorAll(V + ' table tbody tr').length, nova: [...document.querySelectorAll(V + ' button')].some(x => /Nova cobrança/.test(x.textContent)), v3: !!document.querySelector(V + ' .np-toolbar') }), V);
    if (v2.kpis && v2.linhas === 4 && v2.nova && !v2.v3 && !erros.length) ok('V2 intacta: indicadores, tabela com as 4 abertas e "+ Nova cobrança"'); else falha('V2: ' + JSON.stringify([v2, erros.slice(0, 2)])); await ctx.close(); }
  rel.push('3. Clientes (Asaas) e Conta e parâmetros em V3.1');
  { const { ctx, pg, erros, escritas } = await abrir(b, { sub: 'clientes' });
    const e = await pg.evaluate((V) => { const t = (x) => x ? x.textContent.replace(/\s+/g, ' ').trim() : null; return { resumo: t(document.querySelector(V + ' .np-resumo')), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), sub: [...document.querySelectorAll(V + ' .np-fin-sub .np-seg button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), a: t(document.querySelector(V + ' li.np-it[data-id="cus_a"]')), c: [...document.querySelectorAll(V + ' li.np-it[data-id="cus_c"] .np-marca')].map(t), v2: !!document.querySelector(V + ' .kpis, ' + V + ' table, ' + V + ' .tabs') }; }, V);
    if (/^4 clientes no Asaas/.test(e.resumo) && /1 sem ficha vinculada/.test(e.resumo) && /1 com cobrança vencida/.test(e.resumo) && /7\.320,50 em aberto/.test(e.resumo)) ok(`clientes: resumo com as contas da V2: "${e.resumo}"`); else falha('clientes resumo: ' + e.resumo);
    if (/^Com cobrança vencida\s*1:cus_a$/.test(e.grupos[0]) && /^Com cobrança em aberto\s*2:cus_b,cus_c$/.test(e.grupos[1]) && /1 vencida/.test(e.a) && /3\.000,00/.test(e.a) && e.c.includes('sem ficha') && !e.v2) ok('clientes: grupos (vencida → em aberto → sem cobrança), marcas "1 vencida" e "sem ficha", valor em aberto; nada da V2'); else falha('clientes: ' + JSON.stringify(e));
    if (JSON.stringify(e.sub) === JSON.stringify(['Cobranças (Asaas)', 'Central de Cobranças', 'Clientes (Asaas)*', 'Conta Asaas · Parâmetros'])) ok('barra de subáreas no padrão V3.1, com a atual marcada'); else falha('sub: ' + JSON.stringify(e.sub));
    await pg.click(`${V} li.np-it[data-id="cus_a"] .np-it-abrir`); await pg.waitForTimeout(600); const p = await painel(pg);
    if (p && p.titulo === 'Empresa Alfa Ltda' && /2 · R\$\s?3\.000,00/.test(p.props['Em aberto']) && /^1/.test(p.props['Vencidas']) && JSON.stringify(p.botoes) === JSON.stringify(['Abrir no Asaas', 'Histórico de cobrança'])) ok('clientes: painel com ficha, em aberto, vencidas e as ações da V2 (Abrir no Asaas, Histórico)'); else falha('clientes painel: ' + JSON.stringify(p));
    await pg.screenshot({ path: path.join(OUT, 'clientes-asaas-1440-light-painel.png') });
    await pg.fill(V + ' .np-busca-inline', 'gama'); await pg.waitForTimeout(800); const nb = await pg.evaluate((V) => [...document.querySelectorAll(V + ' li.np-it')].map(li => li.dataset.id).join(), V);
    if (nb === 'cus_b' && !escritas.length && !erros.length) ok('clientes: busca filtra a lista; nenhuma gravação; sem erro de script'); else falha('clientes busca: ' + JSON.stringify([nb, escritas.slice(0, 2), erros.slice(0, 2)]));
    await ctx.close(); }
  { const { ctx, pg, erros, escritas } = await abrir(b, { sub: 'conta' }); await pg.waitForTimeout(600);
    const e = await pg.evaluate((V) => { const t = (x) => x ? x.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; document.querySelectorAll(V + ' .np-fin-cartao .np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { resumo: t(document.querySelector(V + ' .np-resumo')), titulos: [...document.querySelectorAll(V + ' .np-fin-cartao h3')].map(t), props, campos: [...document.querySelectorAll(V + ' .np-fin-form label')].map(t), multa: document.querySelector('#pr-multa')?.value, botoes: [...document.querySelectorAll(V + ' .np-btn')].filter(x => x.offsetParent).map(t), v2: !!document.querySelector(V + ' .kpis, ' + V + ' .head, ' + V + ' .pill') }; }, V);
    if (/12\.345,67 saldo disponível no Asaas/.test(e.resumo) && e.props['Titular'] === 'Escritório Fictício' && /1,99/.test(e.props['Boleto']) && /30 grátis por mês/.test(e.props['Transferência']) && e.props['Cobranças'] === '14' && /produção/.test(e.titulos.join())) ok('conta: saldo, titular, taxas e mês atual consultados como na V2'); else falha('conta: ' + JSON.stringify(e));
    if (e.campos.length === 7 && e.multa === '2' && e.botoes.includes('Salvar parâmetros') && e.botoes.includes('Consultar agora') && !e.v2) ok('parâmetros: os mesmos 7 campos da V2 com os valores salvos (multa 2%); nada da V2 na tela'); else falha('parâmetros: ' + JSON.stringify([e.campos, e.multa, e.botoes, e.v2]));
    const grav = escritas.filter(x => !/functions\/v1/.test(x)); if (!grav.length) ok('abrir a tela só consulta (conta no Asaas e parâmetros): nenhuma gravação'); else falha('conta gravações: ' + JSON.stringify(grav.slice(0, 2)));
    await pg.fill('#pr-dia', '15'); const n0 = escritas.length; await pg.click(V + ' .np-btn:has-text("Salvar parâmetros")'); await pg.waitForTimeout(700); const w = escritas.slice(n0);
    if (w.length === 1 && /^POST \/rest\/v1\/escritorio/.test(w[0]) && /"dia_vencimento_padrao":15/.test(w[0]) && /"multa_pct":2/.test(w[0]) && /"regua_whatsapp":false/.test(w[0])) ok('"Salvar parâmetros": a mesma gravação da V2, preservando o restante da configuração (régua continua desligada)'); else falha('salvar: ' + JSON.stringify(w));
    await pg.screenshot({ path: path.join(OUT, 'conta-1440-light.png') });
    if (!erros.length) ok('conta: sem erro de script'); else falha('conta erros: ' + JSON.stringify(erros.slice(0, 2)));
    await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { sub: 'conta', contaErro: true }); const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-fin-cartao .np-erro')?.textContent, V);
    if (/Não foi possível consultar a conta no Asaas: falha fictícia/.test(tx || '')) ok('conta: falha na consulta ao Asaas vira aviso com "Consultar de novo"; os parâmetros continuam editáveis'); else falha('conta erro: ' + tx); await ctx.close(); }
  for (const sub of ['clientes', 'conta']) { const { ctx, pg, erros } = await abrir(b, { sub, casca: 'v2' }); const v2 = await pg.evaluate((V) => ({ head: document.querySelector(V + ' .head h1')?.textContent, v3: !!document.querySelector(V + ' .np-toolbar'), abas: document.querySelectorAll(V + ' .tabs .tab').length }), V);
    if (v2.head && !v2.v3 && v2.abas === 4 && !erros.length) ok(`V2 intacta: "${v2.head}"`); else falha('V2 ' + sub + ': ' + JSON.stringify([v2, erros.slice(0, 2)])); await ctx.close(); }
  for (const sub of ['clientes', 'conta']) for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { sub, w, h: w < 800 ? 780 : 900, tema }); await pg.waitForTimeout(400);
    const l1 = await lateral(pg);
    const m = await medirContraste(pg, sub === 'clientes' ? [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-resumo span', nome: 'rótulo' }, { sel: V + ' .np-grp-h .t', nome: 'grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'título' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-valor', nome: 'valor' }, { sel: V + ' li.np-it .np-marca', nome: 'marca' }, { sel: V + ' .np-fin-sub .np-seg button', nome: 'subárea' }, { sel: V + ' .np-busca-inline', nome: 'busca' }]
      : [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-fin-cartao h3', nome: 'título' }, { sel: V + ' .np-fin-cartao .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-fin-cartao .np-props dd', nome: 'valor' }, { sel: V + ' .np-fin-form label', nome: 'rótulo do campo' }, { sel: V + ' .np-fin-form input', nome: 'campo' }, { sel: V + ' .np-fin-cartao p.np-nota', nome: 'nota' }, { sel: V + ' .np-fin-cartao .np-btn', nome: 'botão' }, { sel: V + ' .np-fin-bruto summary', nome: 'dados completos' }]);
    let alv = []; if (w === 375) { alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$/.test(a.nome)); const rotulo = await pg.evaluate(() => { const l = document.querySelector('label.np-fin-check'); return l ? l.getBoundingClientRect().height : 0; }); if (rotulo >= 44) alv = alv.filter(a => !(a.nome === 'input:' && a.w === 18)); /* a caixa de seleção fica dentro do rótulo, que é o alvo de toque (≥ 44 px) */ }
    await pg.screenshot({ path: path.join(OUT, `${sub === 'clientes' ? 'clientes-asaas' : 'conta'}-${w}-${tema}.png`), fullPage: sub === 'conta' && w === 375 });
    if (l1 <= 0 && !m.ruins.length && !m.ausentesObrigatorios.length && !alv.length && !erros.length) ok(`${sub} ${w} px ${tema}: sem rolagem lateral, contraste mínimo ${m.minimo.toFixed(2)}:1 em ${m.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${sub} ${w} ${tema}: lateral ${l1} · contraste ${JSON.stringify(m.ruins.slice(0, 4))} · ausentes ${JSON.stringify(m.ausentesObrigatorios)} · alvos ${JSON.stringify(alv.slice(0, 5))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  rel.push('4. Cobranças — 375 / 768 / 1024 / 1440 × claro / escuro — lista e painel');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w, h: w < 800 ? 780 : 900, tema });
    const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número do resumo' }, { sel: V + ' .np-resumo span', nome: 'rótulo do resumo' }, { sel: V + ' .np-grp-h .t', nome: 'título do grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'título da linha' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-it-prazo', nome: 'vencimento' }, { sel: V + ' li.np-it .np-valor', nome: 'valor' }, { sel: V + ' li.np-it .np-marca', nome: 'marca' }, { sel: V + ' .np-fin-estado', nome: 'estado' }, { sel: V + ' .np-rodape', nome: 'rodapé' }, { sel: V + ' .np-chipf', nome: 'filtro' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `cobrancas-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="k1"] .np-it-abrir`); await pg.waitForTimeout(700); const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-painel .np-sec h3', nome: 'título da seção' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `cobrancas-${w}-${tema}-painel.png`) });
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral (lista e painel), contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 5))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
