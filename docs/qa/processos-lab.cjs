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
const TAR = { p1: [{ id: 't1', processo_id: 'p1', titulo: 'Protocolar manifestação', prazo: dia(-3), prazo_fatal: true, status: 'aberta', responsavel_nome: 'Lucas Teste' }, { id: 't2', processo_id: 'p1', titulo: 'Conferir cálculo', prazo: dia(5), prazo_fatal: false, status: 'em_andamento', responsavel_nome: 'Lucas Teste', horas_apontadas: 1.5 }, { id: 't3', processo_id: 'p1', titulo: 'Organizar documentos', prazo: null, status: 'aberta', responsavel_nome: null }, { id: 't4', processo_id: 'p1', titulo: 'Tarefa já feita', prazo: dia(-20), status: 'concluida', responsavel_nome: 'Lucas Teste' }] };
const REGS = { p1: [{ quando: new Date(Date.now() - 2 * 864e5).toISOString(), origem: 'registro', autor: 'Ana Teste', texto: 'Reunião fictícia com o cliente.', anexos: 0, processo_id: 'p1' }, { quando: new Date(Date.now() - 5 * 864e5).toISOString(), origem: 'tarefa', autor: 'Lucas Teste', texto: 'Tarefa aberta: Protocolar manifestação', tarefa_id: 't1', processo_id: 'p1' }] };
const COLAB = [{ id: 'col-luc', perfil_id: 'u-luc', nome: 'Lucas Teste', ativo: true }, { id: 'col-adm', perfil_id: 'u-admin', nome: 'Ana Teste', ativo: true }];
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#processos', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  r.leiturasProc = 0; let falhar = o.erroProc || 0;
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_processos|andamentos|colaboradores|v_tarefas|v_dossie)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    const pid = (u.searchParams.get('processo_id') || '').replace('eq.', '');
    if (p.startsWith('/rest/v1/v_processos')) { r.leiturasProc++; if (falhar > 0) { falhar--; return rota.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'falha fictícia' }) }); } return json(rota, o.vazio ? [] : o.muitos ? Array.from({ length: o.muitos }, (_, i) => ({ ...PROC[0], id: 'pm' + i, status: 'ativo', cliente_nome: 'Cliente ' + String(i + 1).padStart(3, '0'), numero_cnj: String(1000000 + i) + '-11.2026.8.26.0196' })) : PROC); }
    if (p.startsWith('/rest/v1/v_tarefas')) { if (!pid) return rota.fallback(); return json(rota, TAR[pid] || []); }
    if (p.startsWith('/rest/v1/v_dossie')) { if (!pid) return rota.fallback(); return json(rota, REGS[pid] || []); }
    if (p.startsWith('/rest/v1/andamentos')) return json(rota, ANDS[(u.searchParams.get('processo_id') || '').replace('eq.', '')] || []);
    if (p.startsWith('/rest/v1/colaboradores') && /perfil_id,nome,ativo/.test(u.searchParams.get('select') || '')) return json(rota, COLAB);
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'processos') { S.tab = 'processos'; render(); } });
  if (o.erroProc || o.vazio) await r.pg.waitForFunction(() => document.querySelector('#view-processos .np-erro, #view-processos .np-vazio'), null, { timeout: 15000 });
  else if (o.casca !== 'v2') await r.pg.waitForFunction(() => document.querySelector('#view-processos li.np-it'), null, { timeout: 15000 });
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
  rel.push('1. Processos simples — só a lista dos processos da base, com a pasta (pedido das sócias, 23/11; admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {});
    const e = await pg.evaluate(() => { const v = document.querySelector('#view-processos'); const lis = [...v.querySelectorAll('.np-simples li.np-it')];
      return { resumo: v.querySelector('.np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...v.querySelectorAll('.np-chipf')].map(c => c.textContent.replace(/\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')), n: lis.length, grupos: v.querySelectorAll('.np-grp').length, texto: v.textContent,
        reguas: lis.filter(li => /(^| )r-/.test(li.className)).length, prazoVisivel: lis.some(li => { const x = li.querySelector('.np-it-prazo'); return x && getComputedStyle(x).display !== 'none'; }), pastas: lis.filter(li => /Pasta/.test(li.querySelector('.np-it-dir')?.textContent || '')).length, legenda: !!v.querySelector('.np-legenda') }; });
    if (e.resumo === '5 processos') ok('resumo: só "5 processos" (os ativos)'); else falha('resumo: ' + e.resumo);
    if (!/prazo vencido|sem providência|incompleto|fatal|DataJud com erro/i.test(e.texto)) ok('nenhum alerta de prazo, pendência ou cadastro na lista (ficam na ficha do processo)'); else falha('sobrou alerta: ' + (e.texto.match(/prazo vencido|sem providência|incompleto|fatal|DataJud com erro/i) || [])[0]);
    if (e.grupos === 0 && e.n === 5 && e.reguas === 0 && !e.prazoVisivel && !e.legenda) ok('lista única com os 5 ativos, sem grupos, régua, prazo ou legenda'); else falha('lista: ' + JSON.stringify({ g: e.grupos, n: e.n, r: e.reguas, p: e.prazoVisivel, l: e.legenda }));
    if (e.pastas > 0) ok(`${e.pastas} processo(s) mostram a pasta`); else falha('nenhuma pasta à vista');
    if (/^Ativos.*\*$/.test(e.chips[0] || '') && e.chips.some(c => /^Todos/.test(c))) ok('filtros por situação: ' + e.chips.join(' · ')); else falha('chips: ' + JSON.stringify(e.chips));
    await pg.evaluate(() => [...document.querySelectorAll('#view-processos .np-chipf')].find(c => /^Todos/.test(c.textContent.trim())).click()); await pg.waitForTimeout(300);
    const nT = await pg.evaluate(() => document.querySelectorAll('#view-processos .np-simples li.np-it').length); if (nT === 7) ok('"Todos": 7 processos (com suspenso e encerrado)'); else falha('todos: ' + nT);
    await pg.evaluate(() => [...document.querySelectorAll('#view-processos .np-chipf')].find(c => /^Ativos/.test(c.textContent.trim())).click()); await pg.waitForTimeout(300);
    if (!escritas.length) ok('nenhuma gravação ao listar e filtrar'); else falha('escritas: ' + JSON.stringify(escritas.slice(0, 3)));
    // ========== 3. Ficha completa ==========
    rel.push('3. Ficha completa do processo em V3.1 — navegação, seções e ações');
    await pg.click('#view-processos li.np-it[data-id="p1"] .np-it-abrir'); await pg.waitForFunction(() => document.querySelectorAll('#view-processos .np-pf li.np-it').length === 3, null, { timeout: 8000 }).catch(() => {});
    if (await pg.evaluate(() => !!document.querySelector('#view-processos .np-pf') && !document.querySelector('#view-processos .np-simples'))) ok('clicar no processo abre direto a ficha completa (sem resumo ao lado)'); else falha('clique não abriu a ficha');
    const fichaEst = () => pg.evaluate(() => { const f = document.querySelector('#view-processos .np-pf'); if (!f) return null; const props = {}; f.querySelectorAll('.np-pf-dados .np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim());
      return { num: f.querySelector('.np-pf-num')?.textContent, trilha: f.querySelector('.np-pf-trilha')?.textContent, sub: f.querySelector('.np-pf-sub')?.textContent, marcas: [...f.querySelectorAll('.np-pf-marcas .np-marca')].map(m => m.textContent), acoes: [...f.querySelectorAll('.np-pf-acoes .np-btn')].map(b => b.textContent.trim()), props, abas: [...f.querySelectorAll('.np-pf-abas button')].map(b => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')), secao: f.querySelector('.np-pf-secao')?.dataset.secao, linhas: [...f.querySelectorAll('.np-pf-secao li.np-it')].map(li => [...li.classList].filter(c => /^r-/.test(c)).join() + '|' + li.querySelector('.tx')?.textContent + '|' + li.querySelector('.np-it-prazo')?.textContent.replace(/\s+/g, ' ').trim()), passos: [...f.querySelectorAll('.np-pf-secao .np-passos li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()), notas: [...f.querySelectorAll('.np-pf-secao .np-nota')].map(n => n.textContent), datajud: [...f.querySelectorAll('.np-sec')].find(x => /DataJud/.test(x.querySelector('h3')?.textContent))?.textContent.replace(/\s+/g, ' ').trim(), v2: !!document.querySelector('#view-processos .card.pf, #view-processos .crumbs'), voltar: document.querySelector('#view-processos .btn-voltar')?.textContent, legado: f.querySelector('.np-pf-legado')?.textContent.trim().length || 0 }; });
    const modal = () => pg.evaluate(() => { const h = document.querySelector('#modalHost'); return h && h.childElementCount > 0 ? (h.querySelector('h2,h3,.modal-h,.np-m-t')?.textContent || 'aberto').trim().slice(0, 60) : null; });
    const fecharModal = async () => { await pg.keyboard.press('Escape'); await pg.waitForTimeout(350); if (await modal()) { await pg.evaluate(() => { document.querySelector('#modalHost')?.replaceChildren(); document.querySelector('#app')?.removeAttribute('inert'); }); await pg.waitForTimeout(200); } };
    let fe = await fichaEst();
    if (fe && fe.num === '1000001-11.2026.8.26.0196' && /Empresa Alfa Ltda · Pasta 00012/.test(fe.trilha) && /Embargos à execução · × Banco Fictício S\.A\./.test(fe.sub) && fe.marcas.includes('ativo') && fe.marcas.includes('conhecimento') && !fe.v2 && fe.voltar === '← Processos') ok('cabeçalho: número, cliente e pasta, ação × parte, marcas (ativo, fase, área, polo); nada da ficha V2; "← Processos"'); else falha('ficha cabeçalho: ' + JSON.stringify(fe));
    if (fe && fe.props['Tribunal / vara'] === 'TJSP · 2ª Vara Cível' && fe.props['Comarca'] === 'Franca/SP' && /480\.000/.test(fe.props['Valor da causa'] || '') && /Lucas/.test(fe.props['Responsável'] || '') && /Movimentações atualizadas em/.test(fe.datajud || '')) ok('dados do processo e DataJud com a data da última atualização'); else falha('ficha dados: ' + JSON.stringify(fe && [fe.props, fe.datajud]));
    if (fe && JSON.stringify(fe.acoes) === JSON.stringify(['Prazo ou tarefa', '+ Andamento', 'Registrar', 'Editar', 'Abrir no cliente'])) ok('ações da ficha: Prazo ou tarefa, + Andamento, Registrar, Editar, Abrir no cliente (as mesmas da V2)'); else falha('ficha ações: ' + JSON.stringify(fe && fe.acoes));
    if (fe && JSON.stringify(fe.abas) === JSON.stringify(['Prazos e tarefas · 3*', 'Trabalho do escritório · 2', 'Andamentos · 2', 'Publicações', 'Pasta e relacionados'])) ok('as cinco seções da V2, com contagem'); else falha('ficha abas: ' + JSON.stringify(fe && fe.abas));
    if (fe && fe.linhas.length === 3 && /^r-late\|Protocolar manifestação\|.*fatal/.test(fe.linhas[0]) && /^r-att\|Conferir cálculo/.test(fe.linhas[1]) && /^\|Organizar documentos\|—/.test(fe.linhas[2]) && fe.notas.some(n => /1 tarefa\(s\) concluída\(s\)/.test(n))) ok('Prazos e tarefas: vencida e fatal primeiro (régua), depois a de 5 dias, depois a sem prazo; aviso da tarefa concluída'); else falha('ficha prazos: ' + JSON.stringify(fe && [fe.linhas, fe.notas]));
    await pg.click('#view-processos .np-pf-abas button:has-text("Andamentos")'); await pg.waitForTimeout(400); fe = await fichaEst();
    if (fe && fe.secao === 'andamentos' && fe.passos.length === 2 && /Despacho/.test(fe.passos[0]) && /interno/.test(fe.passos[0]) && /DataJud/.test(fe.passos[0]) && /Editar/.test(fe.passos[0])) ok('Andamentos: 2, com "interno"/"visível ao cliente", origem DataJud e "Editar"'); else falha('ficha andamentos: ' + JSON.stringify(fe && fe.passos));
    await pg.click('#view-processos .np-pf-secao .np-passos li >> nth=0 >> .np-link'); await pg.waitForTimeout(500); const mA = await modal(); await fecharModal();
    await pg.click('#view-processos .np-pf-acoes .np-btn:has-text("+ Andamento")'); await pg.waitForTimeout(500); const mB = await modal(); await fecharModal();
    await pg.click('#view-processos .np-pf-acoes .np-btn:has-text("Editar")'); await pg.waitForTimeout(500); const mC = await modal(); await fecharModal();
    if (mA && mB && mC) ok(`botões abrem os formulários existentes: editar andamento ("${mA}"), + Andamento ("${mB}"), Editar processo ("${mC}")`); else falha('formulários: ' + JSON.stringify([mA, mB, mC]));
    const antesDJ = escritas.length; await pg.click('#view-processos .np-pf .np-sec .np-btn:has-text("Atualizar no DataJud")'); await pg.waitForTimeout(700);
    const dj = escritas.slice(antesDJ).filter(x => /rpc\/datajud_atualizar/.test(x));
    if (dj.length === 1 && /"p_processo":"p1"/.test(dj[0])) ok('"Atualizar no DataJud" faz a mesma chamada da V2 (datajud_atualizar para este processo), uma vez'); else falha('datajud: ' + JSON.stringify(escritas.slice(antesDJ)));
    await pg.click('#view-processos .np-pf-abas button:has-text("Trabalho do escritório")'); await pg.waitForTimeout(400); fe = await fichaEst();
    if (fe && fe.passos.length === 2 && /Registro · Ana Teste/.test(fe.passos[0]) && /Reunião fictícia/.test(fe.passos[0]) && /Abrir tarefa/.test(fe.passos[1])) ok('Trabalho do escritório: registro manual e evento de tarefa, com "Abrir tarefa"'); else falha('ficha registros: ' + JSON.stringify(fe && fe.passos));
    await pg.click('#view-processos .np-pf-abas button:has-text("Pasta e relacionados")'); await pg.waitForTimeout(500); fe = await fichaEst(); const ladoF = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await pg.click('#view-processos .np-pf-abas button:has-text("Publicações")'); await pg.waitForTimeout(500); const fp = await fichaEst();
    if (fe && fe.secao === 'pasta' && fe.legado > 0 && fp && fp.secao === 'publicacoes' && fp.legado > 0 && ladoF <= 0) ok('Pasta e relacionados e Publicações: o conteúdo dos módulos existentes aparece dentro da ficha, sem rolagem lateral'); else falha('ficha pasta/publicações: ' + JSON.stringify([fe && [fe.secao, fe.legado], fp && [fp.secao, fp.legado], ladoF]));
    await pg.click('#view-processos .btn-voltar'); await pg.waitForFunction(() => document.querySelector('#view-processos li.np-it'), null, { timeout: 8000 }); await pg.waitForTimeout(600);
    const volta = await pg.evaluate(() => ({ atual: document.querySelector('#view-processos li.np-it[aria-current="true"]')?.dataset.id, painel: !document.querySelector('#view-processos .np-painel')?.hidden && document.querySelector('#view-processos .np-painel .np-p-h h2')?.textContent, ficha: !!document.querySelector('#view-processos .np-pf') }));
    if (volta.atual === 'p1' && volta.painel === '1000001-11.2026.8.26.0196' && !volta.ficha) ok('"← Processos" volta à lista com o painel aberto no mesmo processo (lista → painel → ficha → lista sem perder o lugar)'); else falha('volta: ' + JSON.stringify(volta));
    const outras = escritas.filter(x => !/rpc\/datajud_atualizar/.test(x)); if (!outras.length) ok('nenhuma gravação além da consulta ao DataJud pedida de propósito'); else falha('escritas: ' + JSON.stringify(outras.slice(0, 3)));
    const errosRuins = erros.filter(x => !/favicon|net::ERR/.test(x)); if (!errosRuins.length) ok('nenhum erro de script'); else falha('erros: ' + JSON.stringify(errosRuins.slice(0, 3)));
    await pg.click('#view-processos li.np-it[data-id="p1"] .np-it-abrir'); await pg.waitForTimeout(800); await pg.screenshot({ path: path.join(OUT, 'processos-1440-light-painel.png') });
    await ctx.close(); }
  // ========== 4. V2 intacta ==========
  rel.push('4. V2 (padrão) intacta');
  { const { ctx, pg } = await abrir(b, { casca: 'v2' });
    const v = await pg.evaluate(() => ({ kpis: [...document.querySelectorAll('#view-processos .kpi')].map(k => k.querySelector('.l').textContent + '=' + k.querySelector('.v').textContent), linhas: document.querySelectorAll('#view-processos table tbody tr').length, v3: !!document.querySelector('#view-processos .np-toolbar'), exportar: !!document.querySelector('#view-processos .head .actions .btn.sm'), novo: document.querySelector('#view-processos .head .actions .btn.primary')?.textContent }));
    if (v.kpis.join() === 'Ativos=5,Prazo vencido=1,Cadastro incompleto=1,Sem providência=1,Sem cliente na base=1' && v.linhas === 5 && !v.v3 && v.exportar && v.novo === '+ Processo') ok('V2: indicadores, tabela com os 5 ativos, Exportar e "+ Processo" como antes; nada da V3.1'); else falha('V2: ' + JSON.stringify(v));
    await pg.evaluate(() => window.PP_PROCESSOS.abrir('p1')); await pg.waitForTimeout(900);
    const f2 = await pg.evaluate(() => ({ v2: !!document.querySelector('#view-processos .card.pf'), crumbs: !!document.querySelector('#view-processos .crumbs .btn-voltar'), v3: !!document.querySelector('#view-processos .np-pf'), abas: [...document.querySelectorAll('#view-processos .card.pf .actions .btn.sm')].map(b => b.textContent.replace(/\d+$/, '').trim()).filter(t => /Prazos|Trabalho|Andamentos|Publicações|Pasta/.test(t)).length }));
    if (f2.v2 && f2.crumbs && !f2.v3 && f2.abas === 5) ok('V2: a ficha do processo continua a de antes (cartão, cinco abas, "← Processos")'); else falha('V2 ficha: ' + JSON.stringify(f2));
    await ctx.close(); }
  // ========== 5. Carregamento, erro, ausência de dados e permissões ==========
  rel.push('5. Estados: erro, vazio e só leitura');
  { const r = await abrir(b, { erroProc: 99 }); const { ctx, pg } = r; await pg.waitForTimeout(3500);
    const e1 = await pg.evaluate(() => ({ erro: document.querySelector('#view-processos .np-erro')?.textContent.replace(/\s+/g, ' ').trim(), esq: !!document.querySelector('#view-processos .np-esqueleto') }));
    if (/Não foi possível carregar os processos/.test(e1.erro || '') && /Tentar de novo/.test(e1.erro || '') && !e1.esq && r.leiturasProc <= 3) ok(`erro de carga: aviso com "Tentar de novo", sem ficar em "carregando" e sem tentativas em laço (${r.leiturasProc} leitura(s) em 3,5 s)`); else falha('erro: ' + JSON.stringify([e1, r.leiturasProc]));
    await ctx.close(); }
  { const r = await abrir(b, { erroProc: 1 }); const { ctx, pg } = r; await pg.click('#view-processos .np-erro .lnk'); await pg.waitForFunction(() => document.querySelector('#view-processos li.np-it'), null, { timeout: 8000 }).catch(() => {});
    const n = await pg.evaluate(() => document.querySelectorAll('#view-processos li.np-it').length); if (n === 5) ok('"Tentar de novo" recarrega e mostra a lista'); else falha('tentar de novo: ' + n); await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { vazio: true }); const vz = await pg.evaluate(() => document.querySelector('#view-processos .np-vazio')?.textContent.replace(/\s+/g, ' ').trim());
    if (/Nenhum processo cadastrado/.test(vz || '') && /Novo processo/.test(vz || '')) ok('sem processos: mensagem com a próxima ação ("Novo processo")'); else falha('vazio: ' + vz); await ctx.close(); }
  { const { ctx, pg, escritas } = await abrir(b, {}); await pg.evaluate(() => { S.canWrite = false; render(); }); await pg.waitForTimeout(400);
    const pri = await pg.evaluate(() => [...document.querySelectorAll('.np-btn.pri')].filter(b => b.offsetParent).map(b => b.textContent.trim()));
    await pg.click('#view-processos li.np-it[data-id="p1"] .np-it-abrir'); await pg.waitForTimeout(900);
    const fr = await pg.evaluate(() => ({ acoes: [...document.querySelectorAll('#view-processos .np-pf-acoes .np-btn')].map(b => b.textContent.trim()), links: document.querySelectorAll('#view-processos .np-pf .np-link').length, dj: !!document.querySelector('#view-processos .np-pf .np-sec .np-btn') }));
    if (!pri.some(t => /Novo processo/.test(t)) && JSON.stringify(fr.acoes) === JSON.stringify(['Abrir no cliente']) && !fr.dj && !escritas.length) ok('só leitura: sem "Novo processo"; ficha só com "Abrir no cliente", sem DataJud; nenhuma gravação'); else falha('só leitura: ' + JSON.stringify({ pri, fr, escritas: escritas.slice(0, 2) }));
    await ctx.close(); }
  // ========== 6. As 8 combinações ==========
  rel.push('6. As 8 combinações (375, 768, 1024 e 1440 px × claro e escuro) — lista e ficha completa');
  for (const tema of ['light', 'dark']) for (const w of [375, 768, 1024, 1440]) {
    const { ctx, pg } = await abrir(b, { w, h: w < 900 ? 812 : 900, tema });
    const lado = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const m = await medirContraste(pg, [{ sel: '#view-processos .np-resumo b', nome: 'número do resumo' }, { sel: '#view-processos .np-resumo span', nome: 'rótulo do resumo' }, { sel: '#view-processos li.np-it .np-it-abrir .tx', nome: 'título da linha' }, { sel: '#view-processos li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: '#view-processos li.np-it .np-marca', nome: 'pasta', opcional: true }, { sel: '#view-processos .np-chipf', nome: 'filtro' }, { sel: '#view-processos .np-rodape', nome: 'rodapé' }]);
    const ruins = m.ruins.concat(m.ausentesObrigatorios.map(n => ({ ausente: n })));
    if (lado <= 0 && !ruins.length) ok(`${w} px ${tema}: sem rolagem lateral; contraste mínimo ${m.minimo.toFixed(2)}:1 em ${m.medidos.length} pares`); else falha(`${w} ${tema}: rolagem ${lado}, contraste ` + JSON.stringify(ruins.slice(0, 4)));
    if (w === 375) { const alv = await medirAlvos(pg, '#view-processos'); const peq = alv.filter(a => a.h < 44 && !/np-it$/.test(a.nome)); if (!peq.length) ok(`375 px ${tema}: alvos de toque ≥ 44 px (${alv.length} medidos)`); else falha(`alvos ${tema}: ` + JSON.stringify(peq.slice(0, 6))); }
    await pg.screenshot({ path: path.join(OUT, `processos-${w}-${tema}.png`) });
    await pg.evaluate(() => window.PP_PROCESSOS.abrir('p1')); await pg.waitForFunction(() => document.querySelectorAll('#view-processos .np-pf li.np-it').length === 3, null, { timeout: 8000 }).catch(() => {}); await pg.waitForTimeout(400);
    const lado3 = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const mf = await medirContraste(pg, [{ sel: '#view-processos .np-pf-num', nome: 'número' }, { sel: '#view-processos .np-pf-trilha', nome: 'trilha' }, { sel: '#view-processos .np-pf-sub', nome: 'subtítulo' }, { sel: '#view-processos .np-pf-marcas .np-marca', nome: 'marca' }, { sel: '#view-processos .np-pf-dados dt', nome: 'rótulo' }, { sel: '#view-processos .np-pf-dados dd', nome: 'valor' }, { sel: '#view-processos .np-pf-abas button', nome: 'seção' }, { sel: '#view-processos .np-pf-abas button[aria-pressed="true"]', nome: 'seção atual' }, { sel: '#view-processos .np-pf-sec-h h3', nome: 'título da seção' }, { sel: '#view-processos .np-pf-secao .np-nota', nome: 'nota' }, { sel: '#view-processos .np-pf li.np-it .tx', nome: 'tarefa' }, { sel: '#view-processos .np-pf-acoes .np-btn', nome: 'botão' }, { sel: '#view-processos .np-pf-acoes .np-btn.pri', nome: 'botão primário' }]);
    const ruinsF = mf.ruins.concat(mf.ausentesObrigatorios.map(n => ({ ausente: n })));
    let alvF = []; if (w === 375) { alvF = (await medirAlvos(pg, '#view-processos')).filter(a => a.h < 44 && !/np-it$/.test(a.nome)); }
    if (lado3 <= 0 && !ruinsF.length && !alvF.length) ok(`${w} px ${tema}: ficha completa sem rolagem lateral, contraste mínimo ${mf.minimo.toFixed(2)}:1 em ${mf.medidos.length} pares` + (w === 375 ? ', alvos de toque ≥ 44 px' : '')); else falha(`${w} ${tema} ficha: ` + JSON.stringify([lado3, ruinsF.slice(0, 4), alvF.slice(0, 5)]));
    await pg.screenshot({ path: path.join(OUT, `processos-${w}-${tema}-ficha.png`), fullPage: w === 375 });
    await ctx.close();
  }
  // ---------- paginação: 40 por página ----------
  rel.push('paginação (95 processos fictícios, 40 por página)');
  { const r = await abrir(b, { muitos: 95 });
    const ler = () => r.pg.evaluate(() => ({ linhas: document.querySelectorAll('#view-processos li.np-it').length, primeiro: document.querySelector('#view-processos li.np-it')?.textContent.match(/Cliente \d+/)?.[0], pag: document.querySelector('#view-processos .np-paginas .np-num')?.textContent, faixa: document.querySelector('#view-processos .np-paginas .np-rodape')?.textContent, desab: [...document.querySelectorAll('#view-processos .np-paginas button')].filter(x => x.disabled).map(x => x.textContent) }));
    const p1 = await ler();
    if (p1.linhas === 40 && p1.pag === 'Página 1 de 3' && p1.primeiro === 'Cliente 001' && /^1–40 de 95 processos$/.test(p1.faixa) && p1.desab.join('|') === '« Primeira|‹ Anterior') ok(`página 1: 40 linhas, "${p1.pag}", "${p1.faixa}", Primeira/Anterior desabilitados`); else falha('página 1: ' + JSON.stringify(p1));
    await r.pg.click('#view-processos .np-paginas button:has-text("Próxima")'); await r.pg.waitForTimeout(250); const p2 = await ler();
    if (p2.linhas === 40 && p2.pag === 'Página 2 de 3' && p2.primeiro === 'Cliente 041' && !p2.desab.length) ok('Próxima: página 2 começa no 41º'); else falha('página 2: ' + JSON.stringify(p2));
    await r.pg.click('#view-processos .np-paginas button:has-text("Última")'); await r.pg.waitForTimeout(250); const p3 = await ler();
    if (p3.linhas === 15 && p3.pag === 'Página 3 de 3' && /^81–95 de 95/.test(p3.faixa) && p3.desab.join('|') === 'Próxima ›|Última »') ok('Última: 15 linhas restantes, Próxima/Última desabilitados'); else falha('página 3: ' + JSON.stringify(p3));
    await r.pg.fill('#view-processos .np-busca-inline', 'Cliente 09'); await r.pg.waitForTimeout(700); const b1 = await ler();
    if (b1.linhas === 6 && !b1.pag) ok('busca volta para a primeira página e some com a paginação quando cabe tudo (6 resultados)'); else falha('busca: ' + JSON.stringify(b1));
    await r.ctx.close(); }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
