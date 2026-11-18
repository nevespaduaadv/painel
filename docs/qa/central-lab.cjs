/* Laboratório da V10 — Financeiro → Central de Cobranças em V3.1 (moldura e "Ações de hoje").
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/central-lab.cjs [pasta de saída]  (padrão /tmp/central-lab)
   Verifica: totais contra os registros, grupos, lembrete marcado (registro, sem envio de mensagem), registrar contato (validação e
   uma chamada à função do banco), marcar paga em dois passos, vistas antigas dentro da moldura, nenhuma chamada a régua ou a
   mensageria, V2 intacta e as 8 combinações. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/central-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const cob = (id, nome, valor, d, x = {}) => ({ id, cliente_nome: nome, chave_cliente: 'k-' + id, cliente_id: null, parcela_txt: 'Parcela ' + id + ' de 12', descricao: null, valor, venc_ef: dia(d), paga: false, check_hoje: false, regua_parada: false, regua_etapa_manual: null, regua_manual_motivo: null, negociada: false, vencimento_negociado: null, valor_negociado: null, tarefas: [], status: 'pendente', ...x });
const COBS = [cob(1, 'Alfa Fictícia Ltda', 1200, 5), cob(2, 'Beta Fictícia ME', 800, 2, { check_hoje: true }), cob(3, 'Gama Fictícia', 500, 0), cob(4, 'Delta Fictícia', 1500, -2, { tarefas: [{ id: 't1', titulo: 'Ligar', responsavel: 'Marina Teste', prazo: dia(1) }] }), cob(5, 'Épsilon Fictícia', 2500.5, -9), cob(6, 'Zeta Fictícia', 700, -4), cob(7, 'Eta Fictícia', 900, -6, { negociada: true, vencimento_negociado: dia(3), valor_negociado: 850 }), cob(8, 'Teta Fictícia', 300, 20)];
const LOG = [{ id: 'l1', cobranca_id: 6, data: dia(-1), desfecho: 'NAO_RESPONDE', observacao: 'Sem retorno', origem: 'painel', created_at: new Date().toISOString() }, { id: 'l2', cobranca_id: 7, data: dia(-2), desfecho: 'NEGOCIOU', observacao: 'Nova data', origem: 'painel', created_at: new Date().toISOString() }];
const V = '#view-financeiro';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#financeiro', extraLS: { 'pp-fin-sub': 'central' }, ...o });
  const json = (rota, corpo, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  let falhar = o.erro || 0;
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_central_cobrancas|v_cobranca_contatos|regua_etapas|regua_disparos|v_cobranca_historico|colaboradores\?select=id%2Cnome%2Cnucleo)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/v_central_cobrancas')) { if (falhar > 0) { falhar--; return json(rota, { message: 'falha fictícia' }, 500); } return json(rota, (u.searchParams.get('paga') || '') === 'eq.true' ? [] : (o.vazio ? [] : COBS)); }
    if (p.startsWith('/rest/v1/v_cobranca_contatos')) return json(rota, o.vazio ? [] : LOG);
    if (p.startsWith('/rest/v1/colaboradores')) return json(rota, [{ id: 'col-m', nome: 'Marina Teste', nucleo: 'financeiro', ativo: true }]);
    if (p.startsWith('/rest/v1/regua_etapas')) return json(rota, o.vazio ? [] : [{ id: 1, codigo: 'D-5', titulo: 'Relatório mensal', dias: 5, ativa: true, descricao: '5 dias antes do vencimento.', mensagem: 'Bom dia! Segue o boleto da parcela {parcela}.' }, { id: 2, codigo: 'D-2', titulo: 'Aviso de vencimento', dias: 2, ativa: true, mensagem: 'Sua parcela vence em {quando}.' }, { id: 3, codigo: 'D-0', titulo: 'Vence hoje', dias: 0, ativa: true }, { id: 4, codigo: 'D+3', titulo: 'Solicitar previsão', dias: -3, ativa: true }, { id: 5, codigo: 'D+7', titulo: 'Contato do supervisor', dias: -7, ativa: true }]);
    if (p.startsWith('/rest/v1/regua_disparos')) return json(rota, o.vazio ? [] : [{ id: 'd1', data: dia(0), etapa: 'D-2', status: 'aguardando_aprovacao', origem: 'botao', aptos: [{ cliente: 'Zeta Fictícia', parcela: '6 de 12', vencimento: '20/11/2026', valor: 'R$ 700,00', tel4: '1234', texto: 'Olá!' }], enviados: [], nao_enviados: [] }, { id: 'd2', data: dia(-1), etapa: 'D-5', status: 'concluida', origem: 'agendada', aptos: [], enviados: [{ cliente: 'Alfa Fictícia Ltda', parcela: '1 de 12', hora: '09:02' }], nao_enviados: [] }]);
    return json(rota, []);
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'financeiro') { S.tab = 'financeiro'; render(); } });
  if (o.casca === 'v2') await r.pg.waitForFunction((V) => document.querySelector(V + ' .head h1'), V, { timeout: 15000 });
  else await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it, ' + V + ' .np-vazio, ' + V + ' .np-erro'), V, { timeout: 15000 });
  await r.pg.waitForTimeout(600); return r;
}
const estado = (pg) => pg.evaluate((V) => { const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  const linha = (id) => { const li = document.querySelector(`${V} li.np-it[data-id="${id}"]`); if (!li) return null; return { regua: [...li.classList].filter(c => /^r-/.test(c)).join(), chk: li.querySelector('.np-check') ? (li.querySelector('.np-check').checked ? 'marcado' : 'desmarcado') : 'sem', titulo: t(li.querySelector('.tx')), ctx: t(li.querySelector('.ctx')), marcas: [...li.querySelectorAll('.np-it-dir .np-marca')].map(m => m.textContent), valor: t(li.querySelector('.np-valor')) }; };
  return { resumo: t(document.querySelector(V + ' .np-resumo')), sub: [...document.querySelectorAll(V + ' .np-fin-sub:not(.np-cc-abas) button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), abas: [...document.querySelectorAll(V + ' .np-cc-abas button')].map(x => t(x) + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), l1: linha(1), l2: linha(2), l4: linha(4), l5: linha(5), pilulas: document.querySelectorAll(V + ' .pill').length, h1v2: t(document.querySelector(V + ' .head h1')) }; }, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, botoes: [...p.querySelectorAll('.np-btn')].map(t), form: !!p.querySelector('.np-cc-form'), erro: t(p.querySelector('.np-cc-erro:not([hidden])')) }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const externas = (escritas) => escritas.filter(x => /functions\/v1|chatguru|regua_preparar|regua_aprovar|regua_definir|escritorio/.test(x));
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Central de Cobranças — Ações de hoje (perfil administradora, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {}); const e = await estado(pg);
    const somaFila = (1500 + 2500.5).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
    if (/^1\/3 lembretes de hoje enviados/.test(e.resumo) && /2 vencidas a contatar hoje/.test(e.resumo) && e.resumo.replace(/ /g, ' ').includes(somaFila + ' nessa fila') && /1 sem resposta/.test(e.resumo) && /1 negociação/.test(e.resumo)) ok(`totais conferem com os registros: "${e.resumo}"`); else falha('resumo: ' + e.resumo + ' · esperado ' + somaFila);
    if (JSON.stringify(e.grupos) === JSON.stringify(['Lembrete D-5 · relatório mensal0/1:1', 'Lembrete D-2 · aviso de vencimento1/1:2', 'Lembrete D-0 · vence hoje0/1:3', 'Vencidas — contatar hoje2:5,4', 'Sem resposta — em monitoramento1:6', 'Negociações em acompanhamento1:7'])) ok('grupos: três lembretes de pré-vencimento, vencidas a contatar (a mais atrasada primeiro), sem resposta e negociações (fechados); a cobrança que vence em 20 dias não aparece'); else falha('grupos: ' + JSON.stringify(e.grupos));
    if (e.l1 && e.l1.chk === 'desmarcado' && e.l2.chk === 'marcado' && e.l5.regua === 'r-late' && e.l5.chk === 'sem' && /nunca contatado/.test(e.l5.ctx) && e.l4.marcas.includes('1 tarefa') && /1\.500,00/.test(e.l4.valor) && !e.pilulas) ok('linhas: lembrete com caixa de marcar; vencida com régua, último contato, tarefa e valor; nenhuma pílula'); else falha('linhas: ' + JSON.stringify([e.l1, e.l2, e.l4, e.l5, e.pilulas]));
    if (e.sub.includes('Central de Cobranças*') && e.abas[0] === 'Ações de hoje*' && e.abas.length === 7) ok('barra de áreas do Financeiro e as 7 visões da Central presentes'); else falha('barras: ' + JSON.stringify([e.sub, e.abas]));
    await pg.screenshot({ path: path.join(OUT, 'central-1440-light.png') });
    await pg.click(`${V} li.np-it[data-id="5"] .np-it-abrir`); await pg.waitForTimeout(700); let p = await painel(pg);
    if (p && p.titulo === 'Épsilon Fictícia' && /2\.500,50/.test(p.props['Valor']) && /9 dia\(s\) de atraso/.test(p.props['Vencimento']) && /D\+7/.test(p.props['Etapa da régua']) && p.props['Último contato'] === 'nunca contatado' && JSON.stringify(p.botoes) === JSON.stringify(['Registrar contato', 'Criar tarefa', 'Mover na régua', 'Histórico do cliente'])) ok('painel da cobrança vencida: valor, atraso, etapa da régua, último contato e as quatro ações'); else falha('painel: ' + JSON.stringify(p));
    if (!escritas.length) ok('nenhuma gravação ao abrir a tela e o painel'); else falha('escritas: ' + JSON.stringify(escritas.slice(0, 3)));
    await pg.screenshot({ path: path.join(OUT, 'central-1440-light-painel.png') });
    let n0 = escritas.length; await pg.click(V + ' .np-painel .np-btn:has-text("Registrar contato")'); await pg.waitForTimeout(400);
    await pg.click(V + ' .np-cc-form .np-btn.pri'); await pg.waitForTimeout(300); let pf = await painel(pg); const semMedida = escritas.length === n0 && /medida tomada/.test(pf.erro || '');
    await pg.fill('#cc3-acao', 'Lembrete amigável'); await pg.click(V + ' .np-cc-form .np-btn.pri'); await pg.waitForTimeout(300); pf = await painel(pg); const semDesf = escritas.length === n0 && /desfecho/.test(pf.erro || '');
    await pg.click(V + ' .np-cc-desf button:has-text("Negociou")'); await pg.fill('#cc3-valor', 'abc'); await pg.click(V + ' .np-cc-form .np-btn.pri'); await pg.waitForTimeout(300); pf = await painel(pg); const valorRuim = escritas.length === n0 && /Valor acordado inválido/.test(pf.erro || '');
    await pg.screenshot({ path: path.join(OUT, 'central-1440-light-contato.png') });
    await pg.fill('#cc3-valor', '2.300,00'); await pg.fill('#cc3-data', dia(5)); await pg.fill('#cc3-ret', 'Paga na sexta'); await pg.click(V + ' .np-cc-form .np-btn.pri'); await pg.waitForTimeout(900); let w = escritas.slice(n0);
    if (semMedida && semDesf && valorRuim && w.length === 1 && /rpc\/cobranca_registrar_contato/.test(w[0]) && /"p_cobranca":5/.test(w[0]) && /"p_desfecho":"NEGOCIOU"/.test(w[0]) && /"p_valor_negociado":2300/.test(w[0]) && new RegExp('"p_nova_data":"' + dia(5) + '"').test(w[0]) && /"p_meio":"whatsapp"/.test(w[0]) && /"p_acao":"Lembrete amigável"/.test(w[0])) ok('Registrar contato: medida, desfecho e valor são validados na tela; uma única chamada à função do banco, com meio, medida, retorno, nova data e valor'); else falha('contato: ' + JSON.stringify([semMedida, semDesf, valorRuim, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(500);
    const e2 = await estado(pg); if (e2.sub.includes('Central de Cobranças*')) ok('depois de gravar, a barra de áreas do Financeiro continua na tela'); else falha('barra some depois de gravar: ' + JSON.stringify(e2.sub));
    n0 = escritas.length; await pg.click(`${V} li.np-it[data-id="1"] .np-check`); await pg.waitForTimeout(700); w = escritas.slice(n0);
    if (w.length === 1 && /POST \/rest\/v1\/cobranca_checks/.test(w[0]) && /"cobranca_id":1/.test(w[0]) && !externas(escritas).length) ok('marcar lembrete: um registro em cobranca_checks; nenhuma chamada a régua, mensageria ou configuração'); else falha('lembrete: ' + JSON.stringify([w, externas(escritas)]));
    await pg.click(V + ' .np-grp:has(.np-grp-h:has-text("Negociações")) .np-grp-h'); await pg.waitForTimeout(400); await pg.click(`${V} li.np-it[data-id="7"] .np-it-abrir`); await pg.waitForTimeout(600); p = await painel(pg);
    n0 = escritas.length; await pg.click(V + ' .np-painel .np-btn:has-text("Marcar como paga")'); await pg.waitForTimeout(400); const umClique = escritas.length === n0; const p2 = await painel(pg);
    await pg.click(V + ' .np-painel .np-btn:has-text("Confirmar: está paga")'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (p && /850,00/.test(p.props['Valor negociado'] || '') && !p.botoes.includes('Registrar contato') && umClique && p2.botoes.includes('Confirmar: está paga') && w.length === 1 && /"p_desfecho":"RECUPERADO"/.test(w[0]) && /"p_cobranca":7/.test(w[0])) ok('negociação: mostra a nova data e o valor negociado; marcar como paga exige dois cliques'); else falha('negociação: ' + JSON.stringify([p, umClique, p2 && p2.botoes, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(400);
    // V10 (18/11, 19h45): "Resumo do mês" unifica Resumo + Dashboard (7 visões); "Disparos da régua" em V3.1 — nenhuma vista antiga resta
    const abasC = await pg.evaluate((V) => [...document.querySelectorAll(V + ' .np-cc-abas button')].map(x => x.textContent.trim()), V);
    if (abasC.length === 7 && abasC.includes('Resumo do mês') && !abasC.includes('Dashboard') && !abasC.includes('Resumo')) ok('a Central tem sete visões; "Resumo" e "Dashboard" viraram "Resumo do mês"'); else falha('abas: ' + JSON.stringify(abasC));
    await pg.click(V + ' .np-cc-abas button:text-is("Resumo do mês")'); await pg.waitForTimeout(700);
    const rm = await pg.evaluate((V) => ({ legado: !!document.querySelector(V + ' .np-legado'), tabela: !!document.querySelector(V + ' table'), ind: [...document.querySelectorAll(V + ' .np-rm-i')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), cmp: document.querySelectorAll(V + ' .np-rm-cmp').length, defs: document.querySelectorAll(V + ' details.np-rm-def .np-props dt').length, linhas: document.querySelectorAll(V + ' li.np-it').length, botoes: [...document.querySelectorAll(V + ' .np-btn')].map(x => x.textContent.trim()) }), V);
    const rot = (re) => rm.ind.some(t => re.test(t));
    await pg.click(V + ' li.np-it .np-it-abrir'); await pg.waitForTimeout(600); const prm = await painel(pg); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    if (!rm.legado && !rm.tabela && rot(/já pago/) && rot(/^R\$[^a-z]*vencido e não pago/) && rot(/a vencer/) && rot(/recuperado/) && rot(/negociado em meses anteriores/) && rm.defs === 6 && rm.cmp >= 1 && rm.linhas > 0 && prm && rm.botoes.filter(t => /CSV|Exportar/.test(t)).length >= 2) ok(`Resumo do mês em V3.1: ${rm.ind.length} indicadores com rótulo próprio (recebido, vencido, a vencer, recuperado e negociado separados), comparação com o mês anterior, ${rm.linhas} cliente(s) que abrem o painel, duas exportações`); else falha('resumo do mês: ' + JSON.stringify({ rm, prm: !!prm }));
    await pg.click(V + ' .np-cc-abas button:text-is("Disparos da régua")'); await pg.waitForTimeout(700);
    const dp = await pg.evaluate((V) => ({ legado: !!document.querySelector(V + ' .np-legado'), tabela: !!document.querySelector(V + ' table'), grupos: [...document.querySelectorAll(V + ' .np-grp-h')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), linhas: document.querySelectorAll(V + ' li.np-it').length }), V);
    await pg.click(V + ' li.np-it[data-id="et:D-2"] .np-it-abrir'); await pg.waitForTimeout(600); const pd = await painel(pg); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    if (!dp.legado && !dp.tabela && dp.grupos.some(g => /^Aguardando a sua decisão1/.test(g)) && dp.grupos.some(g => /Demais etapas/.test(g)) && dp.grupos.some(g => /Histórico de disparos/.test(g)) && dp.linhas === 7 && pd && pd.botoes.some(t => /Revisar e aprovar/.test(t)) && !externas(escritas).length) ok('Disparos da régua em V3.1: etapas e histórico em grupos; o painel da etapa leva à revisão antes de qualquer envio; abrir e ler não chama a régua'); else falha('disparos: ' + JSON.stringify({ dp, pd, ex: externas(escritas) }));
    // V10 (18/11): Régua e Histórico por cliente em V3.1 — grupos por etapa, filtros, painel com as ações; histórico pede o cliente antes
    await pg.click(V + ' .np-cc-abas button:text-is("Régua")'); await pg.waitForTimeout(700);
    const rgua = await pg.evaluate((V) => ({ legado: !!document.querySelector(V + ' .np-legado'), tabela: !!document.querySelector(V + ' table'), chips: document.querySelectorAll(V + ' .np-cc-fl button').length, linhas: document.querySelectorAll(V + ' li.np-it').length, grupos: document.querySelectorAll(V + ' .np-grp').length }), V);
    await pg.click(V + ' li.np-it .np-it-abrir'); await pg.waitForTimeout(500); const pr = await painel(pg);
    const acoesR = await pg.evaluate((V) => [...document.querySelectorAll(V + ' .np-painel button')].map(x => x.textContent.trim()), V);
    if (!rgua.legado && !rgua.tabela && rgua.chips === 4 && rgua.linhas > 0 && rgua.grupos >= 1 && pr && acoesR.some(t => /Mover na régua|alterar/.test(t)) && acoesR.includes('Criar tarefa') && acoesR.includes('Histórico do cliente')) ok(`Régua em V3.1: ${rgua.linhas} cobrança(s) em ${rgua.grupos} grupo(s), 4 filtros; o painel traz mover na régua, criar tarefa e histórico; sem tabela antiga`); else falha('régua V3: ' + JSON.stringify({ rgua, pr: !!pr, acoesR }));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    await pg.click(V + ' .np-cc-abas button:text-is("Histórico por cliente")'); await pg.waitForTimeout(700);
    const hs = await pg.evaluate((V) => ({ legado: !!document.querySelector(V + ' .np-legado'), sel: !!document.querySelector('#cc3-hist-cli'), rot: document.querySelector('label[for="cc3-hist-cli"]')?.textContent, vazio: document.querySelector(V + ' .np-vazio')?.textContent.replace(/\s+/g, ' ').trim() || null, opcoes: document.querySelectorAll('#cc3-hist-cli option').length }), V);
    if (!hs.legado && hs.sel && hs.rot === 'Cliente' && /Escolha um cliente/.test(hs.vazio || '') && hs.opcoes > 1) ok('Histórico por cliente em V3.1: campo "Cliente" com rótulo e estado vazio orientando a escolha; sem apresentação antiga'); else falha('histórico V3: ' + JSON.stringify(hs));
    // V10 (18/11): Negociados e Registros de contato já na linguagem V3.1 — grupos por situação, painel de detalhe, filtro por desfecho; nada de tabela antiga
    await pg.click(V + ' .np-cc-abas button:text-is("Negociados")'); await pg.waitForTimeout(700);
    const ng = await pg.evaluate((V) => ({ legado: !!document.querySelector(V + ' .np-legado'), tabela: !!document.querySelector(V + ' table'), grupos: [...document.querySelectorAll(V + ' .np-grp-h')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), linhas: document.querySelectorAll(V + ' li.np-it').length, vazio: !!document.querySelector(V + ' .np-vazio') }), V);
    if (!ng.legado && !ng.tabela && (ng.vazio || (ng.linhas > 0 && ng.grupos.every(g => /Não cumpriu|Aguardando a data|Pagou/.test(g))))) ok('Negociados em V3.1: ' + (ng.vazio ? 'estado vazio' : ng.linhas + ' linha(s) em ' + ng.grupos.length + ' grupo(s) por situação') + ', sem tabela antiga'); else falha('negociados V3: ' + JSON.stringify(ng));
    if (!ng.vazio) { await pg.click(V + ' li.np-it .np-it-abrir'); await pg.waitForTimeout(500); const pn = await painel(pg); if (pn) ok('Negociados: a linha abre o mesmo painel de detalhe da cobrança'); else falha('negociados: painel não abriu'); }
    await pg.click(V + ' .np-cc-abas button:text-is("Registros de contato")'); await pg.waitForTimeout(700);
    const rg = await pg.evaluate((V) => ({ legado: !!document.querySelector(V + ' .np-legado'), tabela: !!document.querySelector(V + ' table'), chips: [...document.querySelectorAll(V + ' .np-cc-fl button')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), linhas: document.querySelectorAll(V + ' li.np-it').length }), V);
    await pg.click(V + ' .np-cc-fl button:has-text("Negociou")'); await pg.waitForTimeout(500);
    const rg2 = await pg.evaluate((V) => ({ linhas: document.querySelectorAll(V + ' li.np-it').length, marcas: [...document.querySelectorAll(V + ' li.np-it .np-marca')].map(x => x.textContent.trim()) }), V);
    if (!rg.legado && !rg.tabela && rg.chips.length === 6 && rg.linhas === LOG.length && rg2.linhas === LOG.filter(l => l.desfecho === 'NEGOCIOU').length && rg2.marcas.every(m => m === 'negociou')) ok(`Registros de contato em V3.1: ${rg.linhas} registro(s), filtro por desfecho (Negociou → ${rg2.linhas}), sem tabela antiga`); else falha('registros V3: ' + JSON.stringify({ rg, rg2 }));
    if (!externas(escritas).length) ok('em toda a sessão: nenhuma chamada a régua, mensageria, função externa ou configuração do escritório'); else falha('externas: ' + JSON.stringify(externas(escritas)));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3))); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { vazio: true }); const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-vazio')?.textContent, V);
    if (/Nada para fazer hoje/.test(tx || '') && !erros.length) ok('sem cobranças: estado vazio com a explicação'); else falha('vazio: ' + tx);
    const vz = [];
    for (const a of ['Disparos da régua', 'Régua', 'Negociados', 'Histórico por cliente', 'Registros de contato', 'Resumo do mês']) { await pg.click(V + ' .np-cc-abas button:text-is("' + a + '")'); await pg.waitForTimeout(500); vz.push(await pg.evaluate(([V, a]) => ({ a, legado: !!document.querySelector(V + ' .np-legado'), vazio: document.querySelector(V + ' .np-vazio')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) || null, nan: /NaN|undefined|Infinity/.test(document.querySelector(V).textContent) }), [V, a])); }
    if (vz.every(x => !x.legado && !x.nan && x.vazio) && !erros.length) ok('estados vazios: as outras seis visões explicam o vazio, sem NaN nem erro'); else falha('vazios: ' + JSON.stringify([vz, erros.slice(0, 2)]));
    await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { erro: 5 }); const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-erro')?.textContent, V);
    if (/Não foi possível carregar a Central/.test(tx || '')) ok('falha de carga: faixa de erro com "Tentar de novo"'); else falha('erro: ' + tx); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const e = await estado(pg);
    if (e.h1v2 === 'Central de Cobranças' && !e.abas.length && !erros.length) ok('V2 intacta: a Central segue como estava'); else falha('V2: ' + JSON.stringify([e.h1v2, e.abas, erros.slice(0, 2)])); await ctx.close(); }
  rel.push('2. 375 / 768 / 1024 / 1440 × claro / escuro — lista, painel e formulário de contato');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w, h: w < 800 ? 780 : 900, tema }); const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-resumo span', nome: 'rótulo' }, { sel: V + ' .np-grp-h .t', nome: 'grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'cliente' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-valor', nome: 'valor' }, { sel: V + ' .np-cc-abas .np-seg button', nome: 'vista' }, { sel: V + ' p.np-cc-escopo', nome: 'escopo' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$|np-check/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `central-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="5"] .np-it-abrir`); await pg.waitForTimeout(700); await pg.click(V + ' .np-painel .np-btn:has-text("Registrar contato")'); await pg.waitForTimeout(500); const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-cc-f > label', nome: 'rótulo do campo' }, { sel: V + ' .np-cc-desf .np-chipf', nome: 'desfecho' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `central-${w}-${tema}-contato.png`) });
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral, contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 6))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
