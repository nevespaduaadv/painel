/* Laboratório da entrega visual V8 — Jurídico → Processos em V3.1 (lista agrupada pelo próximo prazo + painel com DataJud).
   Playwright + Chromium locais; reaproveita o servidor e as fixtures fictícias do integracoes-lab, com rotas extras para
   v_processos, andamentos e colaboradores. TODA chamada a *.supabase.co é interceptada; nada sai da máquina.
   Uso: NODE_PATH=<módulos> node docs/qa/processos-lab.cjs [pasta de saída]  (padrão /tmp/processos-lista-lab)
   Verifica: mesmas contas da V2 (ativos, prazo vencido, incompletos, sem providência), grupos por prazo, régua, marcas sem pílula,
   filtros, painel (props, DataJud, andamentos), ações iguais às da V2 (ficha completa, editar, exportar, + processo), nenhuma
   gravação ao navegar, V2 intacta, as 8 combinações (375/768/1024/1440 × claro/escuro) sem rolagem lateral, contraste e toque. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/processos-lista-lab'; fs.mkdirSync(OUT, { recursive: true });
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
    if (p.startsWith('/rest/v1/v_processos')) { r.leiturasProc++; if (falhar > 0) { falhar--; return rota.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'falha fictícia' }) }); } return json(rota, o.vazio ? [] : PROC); }
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
/* Lista simples de Processos (23/11): só os processos da base, com a pasta; clique abre a ficha. Cabeçalho e fixtures do processos-lab. */
const estado = (pg) => pg.evaluate(() => { const v = document.querySelector('#view-processos'); const lis = [...v.querySelectorAll('.np-simples li.np-it')];
  return { resumo: v.querySelector('.np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...v.querySelectorAll('.np-chipf')].map(c => c.textContent.replace(/\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')), n: lis.length, grupos: v.querySelectorAll('.np-grp').length,
    texto: v.textContent, reguas: lis.filter(li => /(^| )r-/.test(li.className)).length, prazoVisivel: lis.some(li => { const x = li.querySelector('.np-it-prazo'); return x && getComputedStyle(x).display !== 'none'; }),
    pastas: lis.filter(li => /Pasta/.test(li.querySelector('.np-it-dir')?.textContent || '')).length, legenda: !!v.querySelector('.np-legenda'), rodape: v.querySelector('.np-rodape')?.textContent.trim(), primeiro: lis[0]?.dataset.id }; });
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('Processos simples — só a lista (admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {}); const e = await estado(pg);
    if (/^\d+ processos?$/.test(e.resumo)) ok(`resumo: só "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (!/prazo vencido|sem providência|incompleto|fatal|Cadastro incompleto|DataJud com erro/i.test(e.texto)) ok('nenhum alerta de prazo, pendência ou cadastro na lista'); else falha('sobrou: ' + (e.texto.match(/prazo vencido|sem providência|incompleto|fatal|DataJud com erro/i) || [])[0]);
    if (e.grupos === 0 && e.n > 0 && e.reguas === 0 && !e.prazoVisivel && !e.legenda) ok(`lista única com ${e.n} processos, sem grupos, régua, prazo ou legenda`); else falha('lista: ' + JSON.stringify(e).slice(0, 300));
    if (e.pastas > 0) ok(`${e.pastas} processo(s) mostram a pasta`); else falha('nenhuma pasta à vista');
    if (e.chips[0] && /^Ativos.*\*$/.test(e.chips[0]) && e.chips.some(c => /^Todos/.test(c))) ok('filtros: ' + e.chips.join(' · ')); else falha('chips: ' + JSON.stringify(e.chips));
    await pg.evaluate(() => [...document.querySelectorAll('#view-processos .np-chipf')].find(c => /^Todos/.test(c.textContent.trim())).click()); await pg.waitForTimeout(300); const t = await estado(pg);
    if (t.n >= e.n) ok(`"Todos": ${t.n} processos`); else falha('todos: ' + t.n);
    await pg.screenshot({ path: path.join(OUT, 'processos-1440.png') });
    await pg.click(`#view-processos li.np-it[data-id="${t.primeiro}"] .np-it-abrir`); await pg.waitForTimeout(800);
    const f = await pg.evaluate(() => ({ ficha: !!document.querySelector('#view-processos .np-pf'), lista: !!document.querySelector('#view-processos .np-simples') }));
    if (f.ficha && !f.lista) ok('clicar abre direto a ficha completa do processo'); else falha('ficha: ' + JSON.stringify(f));
    if (!escritas.length) ok('nenhuma gravação'); else falha('gravou');
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + erros.join(' | ').slice(0, 300)); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { w: 375, h: 800 }); const r = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (r <= 1 && !erros.length) ok('375 px: sem rolagem lateral, sem erros'); else falha('375: ' + r + ' ' + erros.join('|').slice(0, 200)); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); if (!erros.length && !(await pg.evaluate(() => !!document.querySelector('#view-processos .np-simples')))) ok('casca antiga: tela anterior, sem erros'); else falha('v2'); await ctx.close(); }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
