/* Laboratório da entrega visual V8 — Jurídico → Processos em V3.1 (lista agrupada pelo próximo prazo + painel com DataJud).
   Playwright + Chromium locais; reaproveita o servidor e as fixtures fictícias do integracoes-lab, com rotas extras para
   v_processos, andamentos e colaboradores. TODA chamada a *.supabase.co é interceptada; nada sai da máquina.
   Uso: NODE_PATH=<módulos> node docs/qa/processos-lab.cjs [pasta de saída]  (padrão /tmp/processos-lab)
   Verifica: mesmas contas da V2 (ativos, prazo vencido, incompletos, sem providência), grupos por prazo, régua, marcas sem pílula,
   filtros, painel (props, DataJud, andamentos), ações iguais às da V2 (ficha completa, editar, exportar, + processo), nenhuma
   gravação ao navegar, V2 intacta, as 8 combinações (375/768/1024/1440 × claro/escuro) sem rolagem lateral, contraste e toque. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/processos-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,CLIENTES,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };

/* processos fictícios: p1 prazo vencido e fatal; p2 fatal em 3 dias; p3 em 20 dias, incompleto; p4 sem prazo, sem providência, erro no DataJud;
   p5 fora da base, em 60 dias; p6 encerrado; p7 suspenso */
const base = { area: 'Bancário', polo: 'passivo', tribunal: 'TJSP', vara: '2ª Vara Cível', comarca: 'Franca', uf: 'SP', campos_faltando: [], sem_providencia: false, prazo_fatal: false, tarefas_abertas: 0, qtd_relacionados: 0 };
const PROC = [
  { ...base, id: 'p1', numero_cnj: '1000001-11.2026.8.26.0196', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', parte_contraria: 'Banco Fictício S.A.', banco: 'Banco Fictício', tipo_acao: 'Embargos à execução', fase: 'conhecimento', status: 'ativo', valor_causa: 480000, responsavel_id: 'col-luc', responsavel_nome: 'Lucas Teste', proximo_prazo: dia(-3), dias_para_prazo: -3, prazo_fatal: true, ultimo_andamento: dia(-10), pasta_codigo: '00012', datajud_atualizado_em: new Date(Date.now() - 864e5).toISOString(), observacoes: 'Observação fictícia do processo.' },
  { ...base, id: 'p2', numero_cnj: '1000002-22.2026.8.26.0196', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', parte_contraria: 'Cooperativa Fictícia', tipo_acao: 'Monitória', fase: 'conhecimento', status: 'ativo', valor_causa: 90000, responsavel_id: 'col-luc', responsavel_nome: 'Lucas Teste', proximo_prazo: dia(3), dias_para_prazo: 3, prazo_fatal: true, ultimo_andamento: dia(-2) },
  { ...base, id: 'p3', numero_cnj: '1000003-33.2026.8.26.0196', cliente_id: 'c3', cliente_nome: 'Gama Comércio Ltda', parte_contraria: 'Banco Exemplo', tipo_acao: 'Revisional', fase: 'recurso', status: 'ativo', responsavel_id: null, responsavel_nome: null, proximo_prazo: dia(20), dias_para_prazo: 20, campos_faltando: ['vara', 'valor da causa'], vara: null },
  { ...base, id: 'p4', numero_cnj: '1000004-44.2026.8.26.0196', cliente_id: 'c4', cliente_nome: 'Delta Serviços Ltda', parte_contraria: 'Banco Modelo', tipo_acao: 'Execução', fase: 'execução', status: 'ativo', responsavel_id: 'col-luc', responsavel_nome: 'Lucas Teste', proximo_prazo: null, dias_para_prazo: null, sem_providencia: true, datajud_erro: 'processo não localizado no tribunal' },
  { ...base, id: 'p5', numero_cnj: '1000005-55.2026.8.26.0196', cliente_id: null, cliente_nome: null, parte_contraria: 'Financeira Fictícia', tipo_acao: 'Busca e apreensão', fase: 'conhecimento', status: 'ativo', responsavel_id: 'col-luc', responsavel_nome: 'Lucas Teste', proximo_prazo: dia(60), dias_para_prazo: 60 },
  { ...base, id: 'p6', numero_cnj: '1000006-66.2026.8.26.0196', cliente_id: 'c5', cliente_nome: 'Epsilon Ltda', parte_contraria: 'Banco Fictício S.A.', tipo_acao: 'Monitória', fase: 'arquivado', status: 'encerrado', proximo_prazo: null, dias_para_prazo: null },
  { ...base, id: 'p7', numero_cnj: '1000007-77.2026.8.26.0196', cliente_id: 'c5', cliente_nome: 'Epsilon Ltda', parte_contraria: 'Banco Exemplo', tipo_acao: 'Revisional', fase: 'suspenso', status: 'suspenso', proximo_prazo: null, dias_para_prazo: null },
];
const ANDS = { p1: [{ id: 'a1', processo_id: 'p1', data: dia(-10), tipo: 'Despacho', fonte: 'datajud', descricao: 'Intimação para manifestação em 15 dias.' }, { id: 'a2', processo_id: 'p1', data: dia(-30), tipo: 'Petição', fonte: 'manual', descricao: 'Protocolo dos embargos.' }] };
const COLAB = [{ id: 'col-luc', perfil_id: 'u-luc', nome: 'Lucas Teste', ativo: true }, { id: 'col-adm', perfil_id: 'u-admin', nome: 'Ana Teste', ativo: true }];
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#processos', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_processos|andamentos|colaboradores)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/v_processos')) return json(rota, PROC);
    if (p.startsWith('/rest/v1/andamentos')) return json(rota, ANDS[(u.searchParams.get('processo_id') || '').replace('eq.', '')] || []);
    if (p.startsWith('/rest/v1/colaboradores') && /perfil_id,nome,ativo/.test(u.searchParams.get('select') || '')) return json(rota, COLAB);
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'processos') { S.tab = 'processos'; render(); } });
  if (o.casca !== 'v2') await r.pg.waitForFunction(() => document.querySelector('#view-processos li.np-it'), null, { timeout: 15000 });
  else await r.pg.waitForFunction(() => document.querySelector('#view-processos table tbody tr'), null, { timeout: 15000 });
  await r.pg.waitForTimeout(400);
  return r;
}
const estado = (pg) => pg.evaluate(() => {
  const V = '#view-processos';
  const g = [...document.querySelectorAll(V + ' .np-grp')].map(x => x.querySelector('.np-grp-h .t')?.textContent + ':' + [...x.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(','));
  const linha = (id) => { const li = document.querySelector(`${V} li.np-it[data-id="${id}"]`); if (!li) return null; return { regua: [...li.classList].filter(c => /^r-/.test(c)).join(), prazo: li.querySelector('.np-it-prazo')?.textContent.replace(/\s+/g, ' ').trim(), titulo: li.querySelector('.np-it-abrir .tx')?.textContent, ctx: li.querySelector('.np-it-abrir .ctx')?.textContent, marcas: [...li.querySelectorAll('.np-it-dir .np-marca')].map(m => m.textContent + '|' + [...m.classList].filter(c => c !== 'np-marca').join()), quem: li.querySelector('.np-it-dir .np-quem')?.getAttribute('title') || li.querySelector('.np-it-dir .np-sem')?.textContent, pilulas: li.querySelectorAll('.pill').length }; };
  return { resumo: document.querySelector(V + ' .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...document.querySelectorAll(V + ' .np-chipf')].map(c => c.textContent.replace(/\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')), grupos: g, ids: [...document.querySelectorAll(V + ' li.np-it')].map(li => li.dataset.id), p1: linha('p1'), p2: linha('p2'), p3: linha('p3'), p4: linha('p4'), p5: linha('p5'), rodape: document.querySelector(V + ' .np-rodape')?.textContent.replace(/\s+/g, ' ').trim(), v2: !!document.querySelector(V + ' .kpis, ' + V + ' table'), primaria: document.querySelector(V + ' .np-tb-dir .np-btn')?.textContent.trim() || document.querySelector('.np-btn.pri')?.textContent.trim() };
});
const painel = (pg) => pg.evaluate(() => { const p = document.querySelector('#view-processos .np-painel'); if (!p || p.hidden) return null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { modo: p.dataset.modo, titulo: p.querySelector('.np-p-h h2')?.textContent, trilha: p.querySelector('.np-trilha-p')?.textContent.replace(/\s+/g, ' ').trim(), props, secoes: [...p.querySelectorAll('.np-sec h3')].map(h => h.textContent), datajud: [...p.querySelectorAll('.np-sec')].find(s => /DataJud/.test(s.querySelector('h3')?.textContent))?.textContent.replace(/\s+/g, ' ').trim(), ands: [...p.querySelectorAll('.np-passos li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()), botoes: [...p.querySelectorAll('.np-p-pe .np-btn')].map(b => b.textContent.trim()) }; });

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. Lista ==========
  rel.push('1. Processos V3.1 — resumo, grupos por prazo, régua, marcas (perfil admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {});
    const e = await estado(pg);
    if (/^5 processos ativos/.test(e.resumo) && /1 com prazo vencido/.test(e.resumo) && /1 cadastro incompleto/.test(e.resumo) && /1 sem providência/.test(e.resumo)) ok(`resumo: "${e.resumo}" (mesmas contas dos indicadores da V2)`); else falha('resumo: ' + e.resumo);
    if (JSON.stringify(e.grupos) === JSON.stringify(['Prazo vencido:p1', 'Próximos 7 dias:p2', 'Próximos 30 dias:p3', 'Mais adiante:p5', 'Sem prazo registrado:p4'])) ok('grupos pelo próximo prazo, na ordem vencido → 7 dias → 30 dias → adiante → sem prazo; por padrão só os ativos (como na V2)'); else falha('grupos: ' + JSON.stringify(e.grupos));
    if (e.p1 && e.p1.regua === 'r-late' && /há 3 dias|3 d/.test(e.p1.prazo) && e.p1.titulo === '1000001-11.2026.8.26.0196' && /Empresa Alfa Ltda · × Banco Fictício S\.A\. · Embargos à execução/.test(e.p1.ctx) && e.p1.marcas.some(m => /^fatal\|crit/.test(m)) && e.p1.quem === 'Lucas Teste' && e.p1.pilulas === 0) ok(`p1: régua de prazo vencido, "${e.p1.prazo}", marca "fatal", contexto "${e.p1.ctx}", sem pílulas`); else falha('p1: ' + JSON.stringify(e.p1));
    if (e.p2 && e.p2.regua === 'r-fatal' && !/—/.test(e.p2.ctx)) ok('p2: prazo fatal em 3 dias → régua fatal'); else falha('p2: ' + JSON.stringify(e.p2));
    if (e.p3 && e.p3.regua === '' && e.p3.marcas.some(m => /^incompleto\|att/.test(m)) && /ninguém/.test(e.p3.quem || '')) ok('p3: sem régua (20 dias), marca "incompleto", "— ninguém —"'); else falha('p3: ' + JSON.stringify(e.p3));
    if (e.p4 && e.p4.marcas.some(m => /^sem providência\|att/.test(m)) && e.p4.marcas.some(m => /^DataJud com erro\|att/.test(m)) && /—/.test(e.p4.prazo)) ok('p4: "sem providência" e "DataJud com erro"; coluna do prazo vazia'); else falha('p4: ' + JSON.stringify(e.p4));
    if (e.p5 && e.p5.marcas.some(m => /^fora da base/.test(m)) && /^Fora da base/.test(e.p5.ctx)) ok('p5: "fora da base"'); else falha('p5: ' + JSON.stringify(e.p5));
    if (e.chips.some(c => /^Prazo vencido\s*1$/.test(c)) && e.chips.some(c => /^Cadastro incompleto\s*1$/.test(c)) && e.chips.some(c => /^Sem providência\s*1$/.test(c)) && e.chips.some(c => /^Fora da base\s*1$/.test(c)) && e.chips.some(c => /^Mais filtros/.test(c)) && !e.v2) ok('filtros com contagem; nada da tela V2 (indicadores em cartão, tabela) na tela'); else falha('chips/v2: ' + JSON.stringify([e.chips, e.v2]));
    await pg.click('#view-processos .np-chipf:has-text("Prazo vencido")'); const f1 = (await estado(pg)).ids; await pg.click('#view-processos .np-chipf:has-text("Prazo vencido")');
    await pg.click('#view-processos .np-chipf:has-text("Fora da base")'); const f2 = (await estado(pg)).ids; await pg.click('#view-processos .np-chipf:has-text("Fora da base")');
    await pg.click('#view-processos .np-chipf[aria-haspopup="dialog"]'); await pg.selectOption('#np-pop select >> nth=0', ''); await pg.waitForTimeout(300); const f3 = (await estado(pg)).ids;
    await pg.fill('#np-pop input[type=search]', 'cooperativa'); await pg.waitForTimeout(600); const f4 = (await estado(pg)).ids; const popAberto = await pg.evaluate(() => !!document.querySelector('#np-pop.on'));
    await pg.click('#np-pop button:has-text("Limpar")'); await pg.waitForTimeout(300); const f5 = await estado(pg);
    if (f1.join() === 'p1' && f2.join() === 'p5' && f3.length === 7 && f4.join() === 'p2' && popAberto && f5.ids.length === 5 && /5 de 7 processos/.test(f5.rodape)) ok('filtros: Prazo vencido → p1; Fora da base → p5; situação "Todos" → 7; busca "cooperativa" → p2 sem fechar o filtro; Limpar volta aos 5 ativos'); else falha('filtros: ' + JSON.stringify([f1, f2, f3, f4, popAberto, f5.ids, f5.rodape]));
    // ========== 2. Painel ==========
    rel.push('2. Painel — dados, DataJud e andamentos');
    await pg.click('#view-processos li.np-it[data-id="p1"] .np-it-abrir'); await pg.waitForFunction(() => document.querySelectorAll('#view-processos .np-painel .np-passos li').length === 2, null, { timeout: 8000 }).catch(() => {});
    const p = await painel(pg);
    if (p && p.titulo === '1000001-11.2026.8.26.0196' && /Empresa Alfa Ltda/.test(p.trilha) && /fatal/.test(p.props['Próximo prazo'] || '') && p.props['Parte contrária'] === 'Banco Fictício S.A.' && /TJSP · 2ª Vara Cível/.test(p.props['Tribunal / vara'] || '') && /480\.000/.test(p.props['Valor da causa'] || '') && /Lucas/.test(p.props['Responsável'] || '')) ok('painel: número, cliente na trilha, próximo prazo com "fatal", parte contrária, tribunal, valor da causa e responsável'); else falha('painel: ' + JSON.stringify(p));
    if (p && /Movimentações atualizadas em \d{2}\/\d{2}\/\d{4}/.test(p.datajud || '') && /Atualizar no DataJud/.test(p.datajud || '')) ok('DataJud no painel: data da última atualização e o botão "Atualizar no DataJud"'); else falha('datajud: ' + (p && p.datajud));
    if (p && p.ands.length === 2 && /Despacho/.test(p.ands[0]) && /DataJud/.test(p.ands[0]) && /Intimação para manifestação/.test(p.ands[0]) && p.secoes.includes('Andamentos (2)') && p.secoes.includes('Observações')) ok('andamentos: 2, do mais recente para o mais antigo, com a origem (DataJud) marcada; observações do processo'); else falha('andamentos: ' + JSON.stringify(p && [p.ands, p.secoes]));
    if (p && JSON.stringify(p.botoes) === JSON.stringify(['Abrir ficha completa', 'Editar', '+ Andamento'])) ok('ações do painel: Abrir ficha completa, Editar, + Andamento (as mesmas da V2)'); else falha('botões: ' + JSON.stringify(p && p.botoes));
    await pg.click('#view-processos li.np-it[data-id="p4"] .np-it-abrir'); await pg.waitForTimeout(700); const p4 = await painel(pg);
    if (p4 && /erro na última consulta/.test(p4.datajud || '') && /processo não localizado/.test(p4.datajud || '') && /30 dias sem andamento/.test(p4.props['Providência'] || '') && p4.props['Próximo prazo'] === 'sem prazo registrado') ok('p4 no painel: erro do DataJud explicado, "sem providência" e "sem prazo registrado"'); else falha('p4 painel: ' + JSON.stringify(p4));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
    const foco = await pg.evaluate(() => document.querySelector('#view-processos .np-painel')?.hidden && document.activeElement?.closest('li.np-it')?.dataset.id);
    if (foco === 'p4') ok('Esc fecha o painel e devolve o foco à linha de origem'); else falha('esc: ' + foco);
    // teclado: Tab chega à linha, Enter abre
    await pg.focus('#view-processos li.np-it[data-id="p2"] .np-it-abrir'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(600); const pk = await painel(pg);
    if (pk && pk.titulo === '1000002-22.2026.8.26.0196') ok('teclado: Enter na linha abre o painel'); else falha('teclado: ' + JSON.stringify(pk));
    // ficha completa (mesma da V2) e volta
    await pg.click('#view-processos .np-painel .np-p-pe .np-btn:has-text("Abrir ficha completa")'); await pg.waitForTimeout(700);
    const fc = await pg.evaluate(() => ({ hash: location.hash, voltar: !!document.querySelector('#view-processos .btn-voltar'), ficha: !!document.querySelector('#view-processos .card.pf') }));
    if (fc.voltar && fc.ficha) ok('"Abrir ficha completa" leva à ficha do processo (a mesma da V2), com "← Processos" para voltar à lista'); else falha('ficha completa: ' + JSON.stringify(fc));
    await pg.click('#view-processos .btn-voltar'); await pg.waitForFunction(() => document.querySelector('#view-processos li.np-it'), null, { timeout: 8000 });
    if (!escritas.length) ok('nenhuma gravação ao listar, filtrar, abrir o painel e a ficha'); else falha('escritas: ' + JSON.stringify(escritas.slice(0, 3)));
    const errosRuins = erros.filter(x => !/favicon|net::ERR/.test(x)); if (!errosRuins.length) ok('nenhum erro de script'); else falha('erros: ' + JSON.stringify(errosRuins.slice(0, 3)));
    await pg.click('#view-processos li.np-it[data-id="p1"] .np-it-abrir'); await pg.waitForTimeout(800); await pg.screenshot({ path: path.join(OUT, 'processos-1440-light-painel.png') });
    await ctx.close(); }
  // ========== 3. V2 intacta ==========
  rel.push('3. V2 (padrão) intacta');
  { const { ctx, pg } = await abrir(b, { casca: 'v2' });
    const v = await pg.evaluate(() => ({ kpis: [...document.querySelectorAll('#view-processos .kpi')].map(k => k.querySelector('.l').textContent + '=' + k.querySelector('.v').textContent), linhas: document.querySelectorAll('#view-processos table tbody tr').length, v3: !!document.querySelector('#view-processos .np-toolbar'), exportar: !!document.querySelector('#view-processos .head .actions .btn.sm'), novo: document.querySelector('#view-processos .head .actions .btn.primary')?.textContent }));
    if (v.kpis.join() === 'Ativos=5,Prazo vencido=1,Cadastro incompleto=1,Sem providência=1,Sem cliente na base=1' && v.linhas === 5 && !v.v3 && v.exportar && v.novo === '+ Processo') ok('V2: indicadores, tabela com os 5 ativos, Exportar e "+ Processo" como antes; nada da V3.1'); else falha('V2: ' + JSON.stringify(v));
    await ctx.close(); }
  // ========== 4. Só leitura e 8 combinações ==========
  rel.push('4. As 8 combinações (375, 768, 1024 e 1440 px × claro e escuro)');
  for (const tema of ['light', 'dark']) for (const w of [375, 768, 1024, 1440]) {
    const { ctx, pg } = await abrir(b, { w, h: w < 900 ? 812 : 900, tema });
    const lado = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const m = await medirContraste(pg, [{ sel: '#view-processos .np-resumo b', nome: 'número do resumo' }, { sel: '#view-processos .np-resumo span', nome: 'rótulo do resumo' }, { sel: '#view-processos .np-grp-h .t', nome: 'título do grupo' }, { sel: '#view-processos li.np-it .np-it-abrir .tx', nome: 'título da linha' }, { sel: '#view-processos li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: '#view-processos li.np-it .np-it-prazo .d', nome: 'prazo' }, { sel: '#view-processos .np-marca.crit', nome: 'marca crítica' }, { sel: '#view-processos .np-marca.att', nome: 'marca atenção' }, { sel: '#view-processos .np-chipf', nome: 'filtro' }, { sel: '#view-processos .np-rodape', nome: 'rodapé' }]);
    const ruins = m.ruins.concat(m.ausentesObrigatorios.map(n => ({ ausente: n })));
    if (lado <= 0 && !ruins.length) ok(`${w} px ${tema}: sem rolagem lateral; contraste mínimo ${m.minimo.toFixed(2)}:1 em ${m.medidos.length} pares`); else falha(`${w} ${tema}: rolagem ${lado}, contraste ` + JSON.stringify(ruins.slice(0, 4)));
    if (w === 375) { const alv = await medirAlvos(pg, '#view-processos'); const peq = alv.filter(a => a.h < 44 && !/np-it$/.test(a.nome)); if (!peq.length) ok(`375 px ${tema}: alvos de toque ≥ 44 px (${alv.length} medidos)`); else falha(`alvos ${tema}: ` + JSON.stringify(peq.slice(0, 6))); }
    await pg.screenshot({ path: path.join(OUT, `processos-${w}-${tema}.png`) });
    await pg.click('#view-processos li.np-it[data-id="p1"] .np-it-abrir'); await pg.waitForFunction(() => document.querySelectorAll('#view-processos .np-painel .np-passos li').length === 2, null, { timeout: 8000 }).catch(() => {}); await pg.waitForTimeout(500);
    const pn = await painel(pg); const esperado = w <= 980 ? 'cheia' : w <= 1179 ? 'overlay' : 'split';
    const lado2 = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const mp = await medirContraste(pg, [{ sel: '#view-processos .np-painel .np-props dt', nome: 'rótulo' }, { sel: '#view-processos .np-painel .np-props dd', nome: 'valor' }, { sel: '#view-processos .np-painel .np-sec h3', nome: 'título da seção' }, { sel: '#view-processos .np-painel .np-sec p', nome: 'texto da seção' }, { sel: '#view-processos .np-painel .np-passos li', nome: 'andamento' }, { sel: '#view-processos .np-painel .np-link', nome: 'link Editar' }, { sel: '#view-processos .np-painel .np-p-pe .np-btn', nome: 'botão' }]);
    const ruinsP = mp.ruins.concat(mp.ausentesObrigatorios.map(n => ({ ausente: n })));
    if (pn && pn.modo === esperado && lado2 <= 0 && !ruinsP.length) ok(`${w} px ${tema}: painel em modo "${esperado}", sem rolagem lateral, contraste ok`); else falha(`${w} ${tema} painel: ` + JSON.stringify([pn && pn.modo, lado2, ruinsP.slice(0, 4)]));
    await pg.screenshot({ path: path.join(OUT, `processos-${w}-${tema}-painel.png`) });
    await ctx.close();
  }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
