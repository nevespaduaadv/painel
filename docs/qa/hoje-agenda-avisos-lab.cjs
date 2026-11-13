/* Laboratório das telas fixas da casca em V3.1 (Fase 4A): Hoje (painel), Agenda e Avisos. Playwright + Chromium locais; o repositório
   é servido por um servidor HTTP efêmero (127.0.0.1) e TODA chamada a *.supabase.co é interceptada e respondida com fixtures
   fictícias — nada sai da máquina, nada é escrito de verdade (as escritas são capturadas e conferidas).
   Uso: NODE_PATH=<módulos> node docs/qa/hoje-agenda-avisos-lab.cjs [pasta de saída]  (padrão /tmp/hoje-lab)
   Verifica: V2 intacta sem a chave; com a chave as três telas em np-ui com os MESMOS dados (paridade de contagens com a V2),
   mesmas ações (Confirmar protocolo → concluirComNota; Marcar como lido → upsert em avisos_leituras; Compromisso → formEvento/
   agenda_eventos; Pausar → PP_TS), navegação entre as telas preservando o item aberto, permissões (perfil só leitura / sem equipe),
   375 px sem sobreposição, contraste e alvos, teclado/ARIA, capturas. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http'); const { medirContraste, medirAlvos } = require(path.join(process.cwd(), 'docs/qa/_a11y.cjs'));
const RAIZ = process.cwd(); const OUT = process.argv[2] || '/tmp/hoje-lab'; fs.mkdirSync(OUT, { recursive: true });
const REF = 'ksdwzljfjfucjevdqxvx';
let BASE = '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const servir = () => new Promise((res) => { const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); srv.listen(0, '127.0.0.1', () => { BASE = `http://127.0.0.1:${srv.address().port}`; res(srv); }); });
/* ---------- fixtures fictícias ---------- */
const hoje = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (n) => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n); return iso(d); };
const ts = (n, h, m = 0) => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n, h, m); return d.toISOString(); };
const COLAB = [{ id: 'col-ana', perfil_id: 'u-admin', nome: 'Ana Teste', nucleo: 'socios', ativo: true, agenda_sync: true, agenda_sync_em: ts(0, 8) }, { id: 'col-caio', perfil_id: 'u-jur', nome: 'Caio Teste', nucleo: 'juridico', ativo: true }, { id: 'col-bia', perfil_id: 'u-bia', nome: 'Bia Teste', nucleo: 'comercial', ativo: true }];
const CLIENTES = [{ id: 'c1', nome: 'Empresa Alfa Ltda', cnpj: '00.000.000/0001-01', cidade: 'Franca/SP', status: 'ativo' }, { id: 'c2', nome: 'Beta Comércio ME', cnpj: '00.000.000/0001-02', cidade: 'Ribeirão Preto/SP', status: 'ativo' }];
const faixa = (n) => n < 0 ? 'atrasada' : n === 0 ? 'hoje' : n <= 7 ? 'd7' : 'depois';
const prazo = (id, titulo, n, o = {}) => ({ id, origem: o.origem || 'tarefa', descricao: titulo, prazo: dia(n), prazo_fatal: !!o.fatal, faixa: faixa(n), dias_para_prazo: n, cliente_id: o.c || 'c1', cliente_nome: CLIENTES.find(x => x.id === (o.c || 'c1')).nome, responsavel_id: o.r || 'col-ana', responsavel_nome: COLAB.find(x => x.id === (o.r || 'col-ana')).nome, nucleo: o.nucleo || 'juridico', processo_id: o.p || null });
const PRAZOS = [
  prazo('t1', 'Embargos à execução — Santander', -3, { fatal: true }),            // atrasada fatal (minha)
  prazo('t2', 'Juntar procuração', -1),                                            // atrasada (minha)
  prazo('t3', 'Protocolar contestação', 0, { fatal: true }),                       // fatal hoje (minha)
  prazo('t4', 'Ligar para o gerente do Itaú', 0, { c: 'c2' }),                     // hoje
  prazo('t5', 'Revisar minuta de acordo', 2, { c: 'c2' }),                         // em 2 dias
  prazo('t6', 'Enviar relatório mensal', 5),                                       // em 5 dias
  prazo('t7', 'Audiência — processo 0001', 1, { origem: 'processo', r: 'col-caio', fatal: true }), // amanhã, do Caio (equipe)
  prazo('n1', 'Proposta ao banco vence', 12, { origem: 'negociacao', r: 'col-caio' }),
];
const TAREFAS = PRAZOS.filter(z => z.origem === 'tarefa').map(z => ({ id: z.id, titulo: z.descricao, status: 'aberta', prazo: z.prazo, prazo_fatal: z.prazo_fatal, responsavel_id: z.responsavel_id, responsavel_nome: z.responsavel_nome, cliente_id: z.cliente_id, cliente_nome: z.cliente_nome, faixa: z.faixa, created_by: 'u-admin', nucleo: z.nucleo, hora: null, descricao: 'fictícia' }));
const AGENDA = [
  { id: 'e1', titulo: 'Reunião R1 — Empresa Alfa', inicio: ts(0, 10), fim: ts(0, 11), dia_inteiro: false, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', tipo: 'reuniao', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'Google Meet', descricao: 'Pauta: Raio-X das dívidas.', cancelado: false, numero_cnj: null },
  { id: 'e2', titulo: 'Audiência de conciliação', inicio: ts(0, 14, 30), fim: ts(0, 15, 30), dia_inteiro: false, colaborador_id: 'col-caio', colaborador_nome: 'Caio Teste', cliente_id: 'c2', cliente_nome: 'Beta Comércio ME', tipo: 'audiencia', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'Fórum de Franca — sala 3', descricao: null, cancelado: false, numero_cnj: '0000001-11.2026.8.26.0196' },
  { id: 'e3', titulo: 'Almoço com contador (Google)', inicio: ts(1, 12), fim: ts(1, 13), dia_inteiro: false, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: null, cliente_nome: null, tipo: 'compromisso', origem: 'google', tarefa_id: null, lead_id: null, link: 'https://calendar.google.com/x', local: null, descricao: null, cancelado: false },
  { id: 'e4', titulo: 'Perícia contábil', inicio: ts(3, 0), fim: ts(4, 0), dia_inteiro: true, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', tipo: 'pericia', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: null, descricao: null, cancelado: false },
  { id: 'e5', titulo: 'Reunião com lead Gama', inicio: ts(2, 16), fim: ts(2, 17), dia_inteiro: false, colaborador_id: 'col-bia', colaborador_nome: 'Bia Teste', cliente_id: null, cliente_nome: null, tipo: 'reuniao', origem: 'lead', tarefa_id: null, lead_id: 'l1', link: null, local: null, descricao: null, cancelado: false },
];
const FERIADOS = [{ data: dia(4), nome: 'Feriado forense fictício', tipo: 'forense', uf: 'SP', comarca: null, ativo: true }];
const EVENTOS = [{ id: 'ev1', tarefa_id: 't3', tipo: 'criada', autor: 'u-jur', autor_nome: 'Caio Teste', criado_em: ts(0, 8, 5), de: null, para: null, nota: null }, { id: 'ev2', tarefa_id: 't2', tipo: 'prazo_alterado', autor: 'u-admin', autor_nome: 'Ana Teste', criado_em: ts(-1, 17, 40), de: dia(-2), para: dia(-1), nota: 'banco pediu mais tempo' }];
const AVISOS = [
  { id: 'a1', titulo: 'Recesso de fim de ano', texto: 'O escritório fecha de 24/12 a 02/01.\nPrazos fatais continuam monitorados pela controladoria.', areas: null, fixado: true, expira_em: null, publicado_em: ts(-2, 9), autor_nome: 'Direção', leituras: 3, lida: false },
  { id: 'a2', titulo: 'Novo modelo de ata', texto: 'A partir de hoje use o modelo da pasta Modelos → Atas.', areas: ['juridico'], fixado: false, expira_em: dia(20), publicado_em: ts(-1, 11), autor_nome: 'Direção', leituras: 1, lida: false },
  { id: 'a3', titulo: 'Confraternização', texto: 'Dia 19, às 19h.', areas: null, fixado: false, expira_em: null, publicado_em: ts(-10, 9), autor_nome: 'Direção', leituras: 9, lida: true },
];
const PERFIS = { admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] }, juridico: { id: 'u-jur', nome: 'Caio Teste', papel: 'colaborador', acessos: ['juridico', 'clientes'] } };
const sessao = (perfil) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: perfil.id, email: perfil.id + '@lab', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
async function contexto(b, { perfil = 'admin', casca = 'v3', w = 1440, h = 900, tema = 'light', hash = '#painel', extraLS = {}, cron = false } = {}) {
  const P = PERFIS[perfil]; const s = sessao(P); const escritas = []; const erros = []; const leituras = [];
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: w < 900 });
  await ctx.addInitScript(({ s, ref, casca, tema, extraLS }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)); if (casca === 'v3') localStorage.setItem('np-casca', 'v3'); localStorage.setItem('pp-tema', tema); for (const [k, v] of Object.entries(extraLS)) localStorage.setItem(k, v); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { s, ref: REF, casca, tema, extraLS });
  await ctx.route(/supabase\.co/, async (rota) => {
    const req = rota.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method(); const unico = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (b, status = 200, extra = {}) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...extra }, body: JSON.stringify(b) });
    if (m === 'GET') leituras.push(p + u.search);
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !p.startsWith('/auth/')) { escritas.push(m + ' ' + p + u.search + ' ' + (req.postData() || '').slice(0, 200));
      if (m === 'POST' && p.startsWith('/rest/v1/avisos_leituras')) { try { const c = JSON.parse(req.postData() || '{}'); const a = AVISOS.find(x => x.id === c.aviso_id); if (a) a.lida = true; } catch (_) {} }
      return json(m === 'POST' && /rpc/.test(p) ? null : (m === 'POST' ? [{ id: 'novo-' + Date.now() }] : []), m === 'POST' ? 201 : 200); }
    if (p.startsWith('/auth/v1/user')) return json(s.user); if (p.startsWith('/auth/v1/token')) return json(s); if (p.startsWith('/auth/v1/logout')) return json({}, 204);
    if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/rpc/')) return json(m === 'POST' ? [] : null);
    if (p.startsWith('/rest/v1/perfis')) return json(unico ? P : [P]);
    if (p.startsWith('/rest/v1/clientes')) return json(CLIENTES, 200, { 'content-range': `0-${CLIENTES.length - 1}/${CLIENTES.length}` });
    if (p.startsWith('/rest/v1/colaboradores')) { const pid = (u.searchParams.get('perfil_id') || '').replace('eq.', ''); const l = pid ? COLAB.filter(x => x.perfil_id === pid) : COLAB; if (unico) return l[0] ? json(l[0]) : json({ message: 'nenhum', code: 'PGRST116' }, 406); return json(l); }
    if (p.startsWith('/rest/v1/v_prazos')) return json(PRAZOS);
    if (p.startsWith('/rest/v1/v_tarefas')) { const id = (u.searchParams.get('id') || '').replace('eq.', ''); const l = id ? TAREFAS.filter(t => t.id === id) : TAREFAS; return unico ? (l[0] ? json(l[0]) : json(null)) : json(l); }
    if (p.startsWith('/rest/v1/v_agenda')) return json(AGENDA.filter(e => !e.cancelado));
    if (p.startsWith('/rest/v1/feriados')) return json(FERIADOS);
    if (p.startsWith('/rest/v1/tarefa_eventos')) return json(EVENTOS);
    if (p.startsWith('/rest/v1/v_avisos')) return json(AVISOS.map(a => ({ ...a })));
    if (p.startsWith('/rest/v1/ts_cronometros')) return cron ? json({ id: 'cr1', colaborador_id: 'col-ana', tarefa_id: 't3', inicio: ts(0, hoje.getHours() - 1 < 0 ? 0 : hoje.getHours() - 1), cliente_id: 'c1', descricao: null }) : json(null);
    if (p.startsWith('/rest/v1/v_leads') || p.startsWith('/rest/v1/v_tickets') || p.startsWith('/rest/v1/v_publicacoes') || p.startsWith('/rest/v1/solicitacoes_faturamento') || p.startsWith('/rest/v1/apontamentos_horas') || p.startsWith('/rest/v1/v_negociacoes') || p.startsWith('/rest/v1/processos') || p.startsWith('/rest/v1/escritorio') || p.startsWith('/rest/v1/chat_canais')) return unico ? json(null) : json([]);
    return unico ? json({ message: 'nenhum', code: 'PGRST116' }, 406) : json([]);
  });
  const pg = await ctx.newPage(); pg.on('pageerror', e => erros.push(e.message)); pg.on('console', msg => { if (msg.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(msg.text())) erros.push('console: ' + msg.text().slice(0, 160)); });
  await pg.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await pg.waitForTimeout(1200);
  return { ctx, pg, erros, escritas, leituras, perfil: P };
}
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const esperaPainel = (pg) => pg.waitForFunction(() => [...document.querySelectorAll('.np-painel')].some(p => !p.hidden && p.getAttribute('aria-busy') !== 'true'), null, { timeout: 10000 });
const ir = async (pg, tab) => { await pg.evaluate((t) => { location.hash = '#' + t; }, tab); await pg.waitForFunction((t) => !document.querySelector('#view-' + t)?.hidden, tab, { timeout: 10000 }); await pg.waitForTimeout(700); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. V2 intacta sem a chave ==========
  rel.push('1. V2 sem a chave');
  { const { ctx, pg, erros } = await contexto(b, { casca: 'v2', hash: '#painel' }); await pg.waitForTimeout(800);
    const r = await pg.evaluate(() => ({ v3: document.documentElement.classList.contains('np-casca-v3'), npv3: document.querySelectorAll('.np-v3').length, head: !!document.querySelector('#view-painel .head h1'), kpis: document.querySelectorAll('#view-painel .kpi').length, fazer: !!document.querySelector('#view-painel .duas'), avCard: !!document.querySelector('#view-painel .av-painel') }));
    if (!r.v3 && !r.npv3 && r.head && r.kpis >= 3 && r.fazer && r.avCard) ok(`Hoje V2 intacto (cabeçalho, ${r.kpis} KPIs, "O que fazer", cartão de avisos)`); else falha('Hoje V2: ' + JSON.stringify(r));
    await ir(pg, 'agenda'); const ag = await pg.evaluate(() => ({ grade: !!document.querySelector('#view-agenda .ag-grade, #view-agenda .ag-mes'), head: !!document.querySelector('#view-agenda .head h1'), np: document.querySelectorAll('#view-agenda .np-it').length }));
    if (ag.grade && ag.head && !ag.np) ok('Agenda V2 intacta (grade de horas, cabeçalho)'); else falha('Agenda V2: ' + JSON.stringify(ag));
    await ir(pg, 'avisos'); const av = await pg.evaluate(() => ({ cards: document.querySelectorAll('#view-avisos .card.av').length, np: document.querySelectorAll('#view-avisos .np-it').length }));
    if (av.cards === 3 && !av.np) ok('Avisos V2 intacto (3 cartões)'); else falha('Avisos V2: ' + JSON.stringify(av));
    if (!erros.length) ok('V2 sem erros de página'); else falha('erros V2: ' + JSON.stringify(erros)); await ctx.close(); }
  // ========== 2. Hoje V3.1 ==========
  rel.push('2. Hoje em V3.1 (admin, escopo Minhas)');
  { const { ctx, pg, erros, escritas } = await contexto(b, { casca: 'v3', hash: '#painel', extraLS: { 'pp-painel-escopo': 'minhas' } });
    await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 3, null, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate(() => { const g = {}; document.querySelectorAll('#view-painel .np-grp').forEach(x => g[x.dataset.g] = { n: +x.querySelector('.np-grp-h .n').textContent, aberto: x.dataset.aberto, itens: [...x.querySelectorAll('li.np-it[data-id]')].map(l => l.dataset.id) });
      return { v3: document.querySelector('#view-painel').classList.contains('np-v3'), toolbar: !!document.querySelector('#view-painel .np-toolbar'), resumo: document.querySelector('#view-painel .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...document.querySelectorAll('#view-painel .np-toolbar .np-chipf')].map(c => c.textContent.replace(/\d+$/, '').trim()), seg: [...document.querySelectorAll('#view-painel .np-seg button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')), h1: document.querySelector('#view-painel .np-hoje-h h1')?.textContent, g, head2: !!document.querySelector('#view-painel .head'), kpi: document.querySelectorAll('#view-painel .kpi').length, painel: !!document.querySelector('#view-painel .np-painel') }; });
    // esperado (Minhas = Ana): atrasados t1 (fatal) e t2; fatais hoje: t3; hoje: t3, t4 (prazos) + e1 (reunião 10h), e2 é do Caio (fora de Minhas); próximos 3 dias: t5 (+2), e3 (+1, Google, Ana), e4 (+3, dia inteiro)
    if (r.v3 && r.toolbar && !r.head2 && !r.kpi && r.painel) ok('Hoje renderiza em V3.1 (toolbar, obra, painel; sem cabeçalho/KPIs da V2)'); else falha('estrutura: ' + JSON.stringify(r));
    if (/2 fatais em 7 dias/.test(r.resumo) && /2 atrasadas/.test(r.resumo) && /2 vencem hoje/.test(r.resumo) && /1 compromisso hoje/.test(r.resumo) && /6 abertas/.test(r.resumo)) ok(`resumo com os mesmos números da V2: "${r.resumo}"`); else falha('resumo: ' + r.resumo);
    if (r.chips.join() === 'Minhas,Equipe' && r.seg.join() === 'Hoje:true,Semana:false,Mês:false') ok('chips de escopo (Minhas/Equipe) e segmento Hoje/Semana/Mês'); else falha('chips/seg: ' + JSON.stringify([r.chips, r.seg]));
    if (/^Bo[am]/.test(r.h1 || '') && /Ana Teste/.test(r.h1)) ok(`saudação em serifa: "${r.h1}"`); else falha('h1: ' + r.h1);
    const gf = r.g.fatais, ga = r.g.atrasados, gh = r.g.hoje, gp = r.g.prox, gav = r.g.avisos, gatv = r.g.atividade;
    if (gf && gf.n === 1 && gf.itens.join() === 'fatal:t3') ok('grupo "Prazos fatais de hoje" com t3 (régua fatal, botão Confirmar protocolo)'); else falha('fatais: ' + JSON.stringify(gf));
    if (ga && ga.n === 2 && ga.itens.join() === 'prazo:tarefa:t1,prazo:tarefa:t2') ok('grupo "Atrasados" com t1 (fatal primeiro) e t2'); else falha('atrasados: ' + JSON.stringify(ga));
    if (gh && gh.n === 3 && gh.itens.includes('prazo:tarefa:t3') && gh.itens.includes('prazo:tarefa:t4') && gh.itens.includes('evento:e1') && !gh.itens.includes('evento:e2')) ok('grupo "Para hoje": t3, t4 e a reunião e1 (e2 do Caio fora de "Minhas")'); else falha('hoje: ' + JSON.stringify(gh));
    if (gp && gp.n === 3 && gp.itens.includes('prazo:tarefa:t5') && gp.itens.includes('evento:e3') && gp.itens.includes('evento:e4') && !gp.itens.includes('prazo:processo:t7')) ok('grupo "Próximos 3 dias": t5, e3 (Google) e e4 (dia inteiro); t7 do Caio fora'); else falha('prox: ' + JSON.stringify(gp));
    if (gav && gav.n === 2 && gav.itens.join() === 'aviso:a1,aviso:a2') ok('grupo "Avisos" no topo com os 2 não lidos (mesmo conteúdo do cartão V2)'); else falha('avisos no Hoje: ' + JSON.stringify(gav));
    if (gatv && gatv.aberto === '0' && gatv.n === 2) ok('"Atividade recente" por último, recolhida, com 2 eventos'); else falha('atividade: ' + JSON.stringify(gatv));
    const ordem = Object.keys(r.g); if (ordem.indexOf('avisos') < ordem.indexOf('fatais') && ordem.indexOf('fatais') < ordem.indexOf('atrasados') && ordem.indexOf('atrasados') < ordem.indexOf('hoje') && ordem.indexOf('hoje') < ordem.indexOf('prox') && ordem[ordem.length - 1] === 'atividade') ok('ordem dos grupos: Avisos → Fatais → Atrasados → Hoje → Próximos → Atividade'); else falha('ordem: ' + ordem.join(','));
    // ações preservadas: Confirmar protocolo chama PP_TAREFAS.concluirComNota com a tarefa; Marcar como lido grava avisos_leituras
    await pg.evaluate(() => { window.__cc = []; const o = window.PP_TAREFAS.concluirComNota; window.PP_TAREFAS.concluirComNota = (z) => { window.__cc.push(z.id); }; window.__ab = []; const oa = window.PP_TAREFAS.abrir; window.PP_TAREFAS.abrir = (id) => { window.__ab.push(id); }; });
    await pg.click('#view-painel li[data-id="fatal:t3"] button.np-btn.pri'); const cc = await pg.evaluate(() => window.__cc);
    if (cc.join() === 't3') ok('"Confirmar protocolo" chama PP_TAREFAS.concluirComNota(t3) — mesma ação da V2'); else falha('confirmar: ' + JSON.stringify(cc));
    await pg.click('#view-painel li[data-id="prazo:tarefa:t2"] .np-it-abrir'); const ab = await pg.evaluate(() => window.__ab);
    if (ab.join() === 't2') ok('abrir um prazo de tarefa chama PP_TAREFAS.abrir(t2)'); else falha('abrir tarefa: ' + JSON.stringify(ab));
    await pg.click('#view-painel li[data-id="aviso:a2"] button.np-btn'); await pg.waitForTimeout(600);
    const esc1 = escritas.filter(e => /avisos_leituras/.test(e)); const gav2 = await pg.evaluate(() => [...document.querySelectorAll('#view-painel .np-grp[data-g="avisos"] li.np-it[data-id]')].map(l => l.dataset.id));
    if (esc1.length === 1 && /aviso_id":"a2"/.test(esc1[0]) && /perfil_id":"u-admin"/.test(esc1[0]) && gav2.join() === 'aviso:a1') ok(`"Marcar como lido" no Hoje = upsert em avisos_leituras (a2, u-admin); grupo reflete (${gav2.join(',')})`); else falha('lido no Hoje: ' + JSON.stringify([esc1, gav2]));
    // compromisso → painel de detalhe dentro do Hoje (só leitura)
    await pg.click('#view-painel li[data-id="evento:e1"] .np-it-abrir'); await esperaPainel(pg);
    const pn = await pg.evaluate(() => { const p = document.querySelector('#view-painel .np-painel'); const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim()); return { titulo: p.querySelector('h2').textContent, props, obs: p.querySelector('.np-txt')?.textContent, pe: [...p.querySelectorAll('.np-p-pe button, .np-p-pe a')].map(b => b.textContent.trim()), atual: document.querySelector('#view-painel li[aria-current="true"]')?.dataset.id }; });
    if (pn.titulo === 'Reunião R1 — Empresa Alfa' && /10h00–11h00/.test(pn.props.Quando) && pn.props.Tipo === 'Reunião' && pn.props.Cliente === 'Empresa Alfa Ltda' && pn.props.Local === 'Google Meet' && /Raio-X/.test(pn.obs) && pn.pe.join() === 'Abrir na agenda' && pn.atual === 'evento:e1') ok('painel do compromisso: quando/tipo/responsável/cliente/local/observações; ação "Abrir na agenda"; linha marcada aria-current'); else falha('painel evento: ' + JSON.stringify(pn));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
    // Semana e Mês
    await pg.click('#view-painel .np-seg button[data-k="semana"]'); await pg.waitForTimeout(600);
    const sem = await pg.evaluate(() => [...document.querySelectorAll('#view-painel .np-grp')].map(x => x.dataset.g + ':' + x.querySelector('.np-grp-h .n').textContent));
    if (sem.some(x => /^d\d{4}-\d\d-\d\d:/.test(x)) && sem.some(x => /^atrasados:2/.test(x))) ok(`vista Semana: grupos por dia (${sem.filter(x => /^d/.test(x)).length}) + Atrasados`); else falha('semana: ' + sem.join(','));
    await pg.click('#view-painel .np-seg button[data-k="mes"]'); await pg.waitForTimeout(600);
    const mes = await pg.evaluate(() => [...document.querySelectorAll('#view-painel .np-grp')].filter(x => /^d/.test(x.dataset.g)).length);
    if (mes >= 4) ok(`vista Mês: ${mes} dias com itens`); else falha('mês: ' + mes);
    await pg.click('#view-painel .np-seg button[data-k="dia"]'); await pg.waitForTimeout(500);
    // escopo Equipe: e2, t7 entram
    await pg.click('#view-painel .np-chipf:has-text("Equipe")'); await pg.waitForTimeout(700);
    const eq = await pg.evaluate(() => ({ hoje: [...document.querySelectorAll('#view-painel .np-grp[data-g="hoje"] li.np-it[data-id]')].map(l => l.dataset.id), prox: [...document.querySelectorAll('#view-painel .np-grp[data-g="prox"] li.np-it[data-id]')].map(l => l.dataset.id), resumo: document.querySelector('#view-painel .np-resumo').textContent.replace(/\s+/g, ' ') }));
    if (eq.hoje.includes('evento:e2') && eq.prox.includes('prazo:processo:t7') && eq.prox.includes('evento:e5') && /3 fatais/.test(eq.resumo)) ok('escopo Equipe: entram a audiência do Caio (e2), o prazo processual t7 e a reunião do lead (e5); resumo 3 fatais'); else falha('equipe: ' + JSON.stringify(eq));
    const esc2 = escritas.filter(e => !/avisos_leituras/.test(e)); if (!esc2.length && !erros.length) ok('nenhuma outra escrita; sem erros de página'); else falha('escritas/erros: ' + JSON.stringify([esc2, erros]));
    await pg.screenshot({ path: path.join(OUT, 'hoje-1440-light.png') });
    await ctx.close(); }
  // cronômetro rodando
  { const { ctx, pg } = await contexto(b, { casca: 'v3', hash: '#painel', cron: true }); await pg.waitForFunction(() => !!document.querySelector('#view-painel .np-agora'), null, { timeout: 8000 }).catch(() => {});
    const ag = await pg.evaluate(() => { const a = document.querySelector('#view-painel .np-agora'); return a ? { marca: a.querySelector('.np-marca')?.textContent, cron: /^\d\d:\d\d:\d\d$/.test(a.querySelector('.np-cron')?.textContent || ''), tx: a.querySelector('.tx')?.textContent, bts: [...a.querySelectorAll('button')].map(b => b.textContent) } : null; });
    if (ag && ag.marca === 'trabalhando agora' && ag.cron && ag.tx === 'Protocolar contestação' && ag.bts.join() === 'Abrir,Pausar') ok('faixa "Agora" com cronômetro, tarefa e as ações Abrir/Pausar (mesmas da V2)'); else falha('agora: ' + JSON.stringify(ag));
    await ctx.close(); }
  // ========== 3. Agenda V3.1 ==========
  rel.push('3. Agenda em V3.1');
  { const { ctx, pg, erros, escritas } = await contexto(b, { casca: 'v3', hash: '#agenda', extraLS: { 'pp-agenda-modo': 'semana', 'pp-agenda-quem': 'equipe' } });
    await pg.waitForFunction(() => document.querySelectorAll('#view-agenda .np-grp').length >= 5, null, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate(() => { const g = {}; document.querySelectorAll('#view-agenda .np-grp').forEach(x => g[x.dataset.g] = { n: +x.querySelector('.np-grp-h .n').textContent, itens: [...x.querySelectorAll('li.np-it[data-id]')].map(l => l.dataset.id), tom: x.className });
      return { v3: document.querySelector('#view-agenda').classList.contains('np-v3'), grade: !!document.querySelector('#view-agenda .ag-grade'), resumo: document.querySelector('#view-agenda .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...document.querySelectorAll('#view-agenda .np-chipf')].map(c => c.textContent.trim()), seg: [...document.querySelectorAll('#view-agenda .np-seg button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')), g, dir: [...document.querySelectorAll('#view-agenda .np-tb-dir button')].map(b => b.textContent.trim()).filter(Boolean) }; });
    if (r.v3 && !r.grade && Object.keys(r.g).length === 7) ok('Agenda em V3.1: 7 grupos (um por dia da semana), sem a grade de horas'); else falha('estrutura agenda: ' + JSON.stringify([r.v3, r.grade, Object.keys(r.g)]));
    if (r.seg.join() === 'Dia:false,Semana:true,Mês:false' && r.chips.slice(0, 2).join() === 'Minha agenda,Toda a equipe' && r.chips.includes('Pessoa…')) ok(`segmento e chips de agenda (${r.chips.join(' | ')})`); else falha('seg/chips agenda: ' + JSON.stringify([r.seg, r.chips]));
    if (r.dir.slice(-1).join() === 'Compromisso' && r.dir.includes('Hoje')) ok(`ações à direita: ${r.dir.join(' · ')} + "Mais ações" (Sincronizar, Feriados, CSV)`); else falha('dir agenda: ' + r.dir.join(','));
    await pg.click('#view-agenda .np-ib[aria-label="Mais ações"]'); await pg.waitForTimeout(300); const ma = await pg.evaluate(() => [...document.querySelectorAll('#np-pop [role=menuitem]')].map(b => b.textContent.trim())); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    if (ma.join() === 'Sincronizar com o Google,Feriados e suspensões de prazo,Exportar CSV') ok('"Mais ações": Sincronizar com o Google · Feriados · Exportar CSV (mesmas funções da V2)'); else falha('mais ações: ' + ma.join(','));
    await pg.evaluate(() => { window.__csv = null; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__csv = { nome: this.download }; fetch(this.href).then(r => r.text()).then(t => { window.__csv.cab = t.replace(/^\uFEFF/, '').split('\r\n')[0]; window.__csv.ls = t.split('\r\n').length - 1; }); return; } return oc.call(this); }; });
    await pg.click('#view-agenda .np-ib[aria-label="Mais ações"]'); await pg.waitForTimeout(200); await pg.click('#np-pop [role=menuitem]:has-text("Exportar CSV")'); await pg.waitForTimeout(600);
    const cs = await pg.evaluate(() => window.__csv); if (cs && /^agenda-\d{4}-\d\d-\d\d\.csv$/.test(cs.nome) && cs.ls >= 8 && cs.cab === 'Data;Hora;Tipo;Título;Responsável;Cliente;Processo;Local;Origem') ok(`Exportar CSV: arquivo ${cs.nome} com as 9 colunas da V2 e ${cs.ls} linhas visíveis`); else falha('csv: ' + JSON.stringify(cs));
    const hojeK = iso(hoje); const gh = r.g['d' + hojeK];
    // toda a equipe, hoje: e1 (10h), e2 (14h30) + prazos t3 (fatal), t4 (prazo) → 4 itens; dia +4: feriado forense (linha) sem itens
    if (gh && gh.n === 4 && gh.itens.includes('e1') && gh.itens.includes('e2') && gh.itens.includes('prazo:tarefa:t3') && gh.itens.includes('prazo:tarefa:t4')) ok('hoje na Agenda (equipe): reunião, audiência, prazo fatal t3 e prazo t4 — mesmos itens da V2 (compromissos + v_prazos)'); else falha('agenda hoje: ' + JSON.stringify(gh));
    await pg.click('#view-agenda .np-seg button[data-k="mes"]'); await pg.waitForTimeout(700);
    const gfer = await pg.evaluate((k) => { const g = document.querySelector('#view-agenda .np-grp[data-g="d' + k + '"]'); return g ? { itens: [...g.querySelectorAll('li.np-it[data-id]')].map(l => l.dataset.id), marca: g.querySelector('.np-marca')?.textContent, n: g.querySelector('.np-grp-h .n').textContent } : null; }, dia(4));
    if (gfer && gfer.itens.some(i => /^fer:/.test(i)) && gfer.marca === 'forense' && gfer.n === '0') ok('feriado forense aparece como linha do dia (marca "forense"), sem contar como compromisso'); else falha('feriado: ' + JSON.stringify(gfer));
    await pg.click('#view-agenda .np-seg button[data-k="semana"]'); await pg.waitForTimeout(700);
    if (/\d+ fatais/.test(r.resumo) && /prazos/.test(r.resumo) && /compromissos/.test(r.resumo)) ok(`resumo da agenda: "${r.resumo}"`); else falha('resumo agenda: ' + r.resumo);
    // painel: audiência (Caio) com processo; ações Editar + Abrir o cliente (admin)
    await pg.click('#view-agenda li[data-id="e2"] .np-it-abrir'); await esperaPainel(pg);
    const pn = await pg.evaluate(() => { const p = document.querySelector('#view-agenda .np-painel'); const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim()); return { titulo: p.querySelector('h2').textContent, props, pe: [...p.querySelectorAll('.np-p-pe button, .np-p-pe a')].map(b => b.textContent.trim()) }; });
    if (pn.titulo === 'Audiência de conciliação' && /14h30–15h30/.test(pn.props.Quando) && pn.props.Tipo === 'Audiência' && pn.props.Responsável === 'Caio Teste' && pn.props.Processo === '0000001-11.2026.8.26.0196' && /Fórum/.test(pn.props.Local) && pn.pe.join() === 'Editar,Abrir o cliente') ok('painel da audiência: quando, tipo, responsável, processo, local; ações Editar e Abrir o cliente'); else falha('painel audiência: ' + JSON.stringify(pn));
    // Editar abre o formEvento da V2 (modal) — mesma gravação
    await pg.click('#view-agenda .np-painel .np-p-pe button:has-text("Editar")'); await pg.waitForTimeout(400);
    const md = await pg.evaluate(() => ({ titulo: document.querySelector('#modalHost h2')?.textContent, campo: document.querySelector('#modalHost #ag-tit')?.value }));
    if (md.titulo === 'Editar compromisso' && md.campo === 'Audiência de conciliação') ok('"Editar" abre o formEvento atual (modal V2) preenchido — mesma gravação em agenda_eventos'); else falha('editar: ' + JSON.stringify(md));
    await pg.evaluate(() => { document.querySelector('#modalHost .btn.primary').click(); }); await pg.waitForTimeout(600);
    const esc = escritas.filter(e => /agenda_eventos/.test(e)); if (esc.length === 1 && /^PATCH/.test(esc[0]) && /id=eq\.e2/.test(esc[0])) ok('Salvar no modal = PATCH agenda_eventos id=e2 (mesma escrita da V2)'); else falha('escrita agenda: ' + JSON.stringify(esc));
    // Google: só leitura, link
    await pg.waitForFunction(() => document.querySelectorAll('#view-agenda .np-grp').length >= 5, null, { timeout: 10000 }).catch(() => {});
    await pg.click('#view-agenda li[data-id="e3"] .np-it-abrir'); await esperaPainel(pg);
    const pg3 = await pg.evaluate(() => { const p = document.querySelector('#view-agenda .np-painel'); return { pe: [...p.querySelectorAll('.np-p-pe button, .np-p-pe a')].map(b => b.textContent.trim()), href: p.querySelector('.np-p-pe a')?.getAttribute('href'), origem: [...p.querySelectorAll('.np-props dd')].map(d => d.textContent).find(t => /Google/.test(t)) }; });
    if (pg3.pe.join() === 'Abrir no Google' && pg3.href === 'https://calendar.google.com/x' && /edite por lá/.test(pg3.origem || '')) ok('evento do Google: só leitura, ação "Abrir no Google", origem explicada'); else falha('google: ' + JSON.stringify(pg3));
    // prazo de tarefa na agenda abre a tarefa
    await pg.evaluate(() => { window.__ab = []; window.PP_TAREFAS.abrir = (id) => { window.__ab.push(id); }; });
    await pg.click('#view-agenda li[data-id="prazo:tarefa:t3"] .np-it-abrir'); await esperaPainel(pg); await pg.click('#view-agenda .np-painel .np-p-pe button:has-text("Abrir a tarefa")'); const ab = await pg.evaluate(() => window.__ab);
    if (ab.join() === 't3') ok('prazo de tarefa na agenda: painel com "Abrir a tarefa" → PP_TAREFAS.abrir(t3)'); else falha('prazo→tarefa: ' + JSON.stringify(ab));
    // "Pessoa…" → popover com os outros colaboradores; escolher Caio filtra
    await pg.click('#view-agenda .np-chipf:has-text("Pessoa…")'); await pg.waitForTimeout(300);
    const pop = await pg.evaluate(() => [...document.querySelectorAll('#np-pop button')].map(b => b.textContent));
    if (pop.join() === 'Caio Teste,Bia Teste') ok('"Pessoa…" lista os outros colaboradores no popover'); else falha('pessoa pop: ' + pop.join(','));
    await pg.click('#np-pop button:has-text("Caio Teste")'); await pg.waitForTimeout(600);
    const caio = await pg.evaluate(() => ({ chips: [...document.querySelectorAll('#view-agenda .np-chipf[aria-pressed="true"]')].map(c => c.textContent.trim()), itens: [...document.querySelectorAll('#view-agenda li.np-it[data-id]')].map(l => l.dataset.id).filter(i => !/^fer:/.test(i)) }));
    if (caio.chips.join() === 'Caio Teste' && caio.itens.includes('e2') && caio.itens.includes('prazo:processo:t7') && !caio.itens.includes('e1')) ok('agenda do Caio: só os itens dele (e2, t7); chip da pessoa ativo'); else falha('caio: ' + JSON.stringify(caio));
    // Dia e Mês
    await pg.click('#view-agenda .np-chipf:has-text("Toda a equipe")'); await pg.waitForTimeout(300);
    await pg.click('#view-agenda .np-seg button[data-k="dia"]'); await pg.waitForTimeout(600);
    const d1 = await pg.evaluate(() => ({ g: document.querySelectorAll('#view-agenda .np-grp').length, n: document.querySelectorAll('#view-agenda li.np-it[data-id]').length }));
    if (d1.g === 1 && d1.n === 4) ok('vista Dia: 1 grupo (hoje) com 4 itens'); else falha('dia: ' + JSON.stringify(d1));
    await pg.click('#view-agenda .np-seg button[data-k="mes"]'); await pg.waitForTimeout(800);
    const m1 = await pg.evaluate(() => ({ g: document.querySelectorAll('#view-agenda .np-grp').length, vazios: document.querySelectorAll('#view-agenda .np-it-vazia').length }));
    if (m1.g >= 4 && m1.vazios === 0) ok(`vista Mês: só dias com itens (${m1.g}), sem linhas vazias`); else falha('mês agenda: ' + JSON.stringify(m1));
    if (!erros.length) ok('Agenda sem erros de página'); else falha('erros agenda: ' + JSON.stringify(erros));
    await pg.click('#view-agenda .np-seg button[data-k="semana"]'); await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(OUT, 'agenda-1440-light.png') });
    await ctx.close(); }
  // ========== 4. Avisos V3.1 ==========
  rel.push('4. Avisos em V3.1');
  { AVISOS.forEach(a => { a.lida = a.id === 'a3'; });
    const { ctx, pg, erros, escritas } = await contexto(b, { casca: 'v3', hash: '#avisos' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-avisos li.np-it[data-id]').length >= 2, null, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate(() => ({ v3: document.querySelector('#view-avisos').classList.contains('np-v3'), cards: document.querySelectorAll('#view-avisos .card.av').length, resumo: document.querySelector('#view-avisos .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...document.querySelectorAll('#view-avisos .np-chipf')].map(c => c.textContent.replace(/\d+$/, '').trim() + ':' + c.getAttribute('aria-pressed')), itens: [...document.querySelectorAll('#view-avisos li.np-it[data-id]')].map(l => l.dataset.id + ':' + (l.className.includes('r-att') ? 'att' : '-')), dir: [...document.querySelectorAll('#view-avisos .np-tb-dir button')].map(b => b.textContent.trim()) }));
    if (r.v3 && !r.cards && /2 não lidos/.test(r.resumo) && /1 fixado/.test(r.resumo) && /3 publicados/.test(r.resumo)) ok(`Avisos em V3.1: resumo "${r.resumo}", sem cartões V2`); else falha('avisos estrutura: ' + JSON.stringify(r));
    if (r.chips.join() === 'Não lidos:true,Fixados:false,Todos:false' && r.itens.join() === 'a1:att,a2:att' && r.dir.join() === 'Discord,Aviso') ok('filtro "Não lidos" ativo: a1 (fixado, primeiro) e a2 com régua de atenção; ações Discord e Aviso (admin)'); else falha('avisos chips/itens: ' + JSON.stringify([r.chips, r.itens, r.dir]));
    await pg.click('#view-avisos li[data-id="a1"] .np-it-abrir'); await esperaPainel(pg);
    const pn = await pg.evaluate(() => { const p = document.querySelector('#view-avisos .np-painel'); const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim()); return { titulo: p.querySelector('h2').textContent, props, txt: p.querySelector('.np-txt')?.textContent, pe: [...p.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()) }; });
    if (pn.titulo === 'Recesso de fim de ano' && pn.props.Para === 'todo o escritório' && pn.props.Leituras === '3' && /24\/12/.test(pn.txt) && /\n/.test(pn.txt) && pn.pe.join() === 'Marcar como lido,Editar') ok('painel do aviso: texto completo com quebras, publicado/por/para/leituras; ações Marcar como lido e Editar (admin)'); else falha('painel aviso: ' + JSON.stringify(pn));
    await pg.click('#view-avisos .np-painel .np-p-pe button:has-text("Marcar como lido")'); await pg.waitForTimeout(800);
    const esc = escritas.filter(e => /avisos_leituras/.test(e)); const dep = await pg.evaluate(() => ({ itens: [...document.querySelectorAll('#view-avisos li.np-it[data-id]')].map(l => l.dataset.id), resumo: document.querySelector('#view-avisos .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), pe: [...document.querySelectorAll('#view-avisos .np-painel .np-p-pe button')].map(b => b.textContent.trim()) }));
    if (esc.length === 1 && /aviso_id":"a1"/.test(esc[0]) && /on_conflict=aviso_id%2Cperfil_id|on_conflict=aviso_id,perfil_id/.test(esc[0]) && dep.itens.join() === 'a2' && /1 não lido/.test(dep.resumo)) ok('"Marcar como lido" = upsert avisos_leituras (a1, on_conflict aviso_id,perfil_id); lista e resumo refletem (fica só a2)'); else falha('lido: ' + JSON.stringify([esc, dep]));
    await pg.click('#view-avisos .np-chipf:has-text("Todos")'); await pg.waitForTimeout(500);
    const todos = await pg.evaluate(() => [...document.querySelectorAll('#view-avisos .np-grp')].map(x => x.dataset.g + ':' + [...x.querySelectorAll('li.np-it[data-id]')].map(l => l.dataset.id).join('+')));
    if (todos.join() === 'novos:a2,lidos:a1+a3') ok('"Todos": grupos Não lidos (a2) e Lidos (a1 fixado primeiro, a3)'); else falha('todos: ' + todos.join(','));
    await pg.click('#view-avisos .np-tb-dir button:has-text("Aviso")'); await pg.waitForTimeout(300);
    const nf = await pg.evaluate(() => document.querySelector('#modalHost h2')?.textContent); if (nf === 'Novo aviso') ok('"Aviso" (admin) abre o formulário atual (modal V2)'); else falha('novo aviso: ' + nf);
    await pg.evaluate(() => document.querySelector('#modalHost .btn:not(.primary)').click());
    if (!erros.length) ok('Avisos sem erros de página'); else falha('erros avisos: ' + JSON.stringify(erros));
    await pg.click('#view-avisos .np-chipf:has-text("Não lidos")'); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, 'avisos-1440-light.png') });
    await ctx.close(); AVISOS.forEach(a => { a.lida = a.id === 'a3'; }); }
  // ========== 5. permissões: colaborador do Jurídico (não admin) ==========
  rel.push('5. Perfil colaborador (Jurídico): escopo e ações restritas');
  { const { ctx, pg, erros } = await contexto(b, { perfil: 'juridico', casca: 'v3', hash: '#avisos' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-avisos li.np-it[data-id]').length >= 1, null, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate(() => ({ dir: [...document.querySelectorAll('#view-avisos .np-tb-dir button')].map(b => b.textContent.trim()), leituras: document.querySelectorAll('#view-avisos .np-num').length }));
    if (!r.dir.length && !r.leituras) ok('colaborador: sem "Aviso"/"Discord" e sem contagem de leituras (só admin)'); else falha('colab avisos: ' + JSON.stringify(r));
    await pg.click('#view-avisos li[data-id="a1"] .np-it-abrir'); await esperaPainel(pg); const pe = await pg.evaluate(() => [...document.querySelectorAll('#view-avisos .np-painel .np-p-pe button')].map(b => b.textContent.trim()));
    if (pe.join() === 'Marcar como lido') ok('colaborador: painel do aviso só com "Marcar como lido" (sem Editar)'); else falha('colab pe: ' + pe.join(','));
    await ir(pg, 'painel'); await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 2, null, { timeout: 10000 }).catch(() => {});
    const h = await pg.evaluate(() => ({ chips: [...document.querySelectorAll('#view-painel .np-chipf')].map(c => c.textContent.trim()), hoje: [...document.querySelectorAll('#view-painel .np-grp[data-g="hoje"] li.np-it[data-id]')].map(l => l.dataset.id), prox: [...document.querySelectorAll('#view-painel .np-grp[data-g="prox"] li.np-it[data-id]')].map(l => l.dataset.id) }));
    // Caio (Minhas): hoje = e2 (audiência dele); próximos = t7 (processo dele). Chips Minhas/Jurídico só se escopoTarefas permitir.
    if (h.hoje.join() === 'evento:e2' && h.prox.join() === 'prazo:processo:t7') ok('Hoje do Caio ("Minhas"): só a audiência e o prazo processual dele'); else falha('hoje caio: ' + JSON.stringify(h));
    if (!erros.length) ok('colaborador sem erros de página'); else falha('erros colab: ' + JSON.stringify(erros));
    await ctx.close(); }
  // ========== 6. 375 px: composição e sem rolagem horizontal; escuro ==========
  rel.push('6. Celular (375) claro/escuro, sem rolagem horizontal, três faixas');
  for (const [tab, sel] of [['painel', '#view-painel'], ['agenda', '#view-agenda'], ['avisos', '#view-avisos']]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await contexto(b, { casca: 'v3', w: 375, h: 760, tema, hash: '#' + tab, extraLS: { 'pp-agenda-quem': 'equipe', 'pp-agenda-modo': 'dia' } });
    await pg.waitForFunction((s) => document.querySelectorAll(s + ' li.np-it[data-id]').length >= 1, sel, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate((s) => { const sw = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth; const li = document.querySelector(s + ' li.np-it[data-id]'); const rects = li ? ['.np-it-prazo', '.np-it-abrir', '.np-it-dir'].map(c => { const e = li.querySelector(c); const r = e?.getBoundingClientRect(); return r ? [c, Math.round(r.top), Math.round(r.bottom), Math.round(r.right)] : [c, 0, 0, 0]; }) : []; const liR = li?.getBoundingClientRect(); return { sw, cw, rects, liRight: liR ? Math.round(liR.right) : 0, tema: getComputedStyle(document.body).backgroundColor }; }, sel);
    const faixas = r.rects.length === 3 && r.rects[0][2] <= r.rects[1][1] + 1 && r.rects[1][2] <= r.rects[2][1] + 1 && r.rects.every(x => x[3] <= r.liRight + 1);
    if (r.sw <= r.cw && faixas) ok(`${tab} 375 ${tema}: sem rolagem horizontal; linha em três faixas sem sobreposição (fundo ${r.tema})`); else falha(`${tab} 375 ${tema}: ` + JSON.stringify(r));
    if (!erros.length) ok(`${tab} 375 ${tema}: sem erros`); else falha(`${tab} 375 ${tema} erros: ` + JSON.stringify(erros));
    await pg.screenshot({ path: path.join(OUT, `${tab}-375-${tema}.png`), fullPage: false }); await ctx.close(); }
  // ========== 7. acessibilidade: contraste (texto 4,5:1; componentes 3:1) e alvos ≥ 44 px no toque ==========
  rel.push('7. Contraste e alvos de toque (painel aberto)');
  for (const tema of ['light', 'dark']) {
    const { ctx, pg } = await contexto(b, { casca: 'v3', w: 1440, tema, hash: '#painel' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 3, null, { timeout: 10000 }).catch(() => {});
    await pg.click('#view-painel li[data-id="evento:e1"] .np-it-abrir'); await esperaPainel(pg);
    const pares = [
      { sel: '#view-painel .np-hoje-h h1', nome: 'saudação' }, { sel: '#view-painel .np-hoje-d', nome: 'data' }, { sel: '#view-painel .np-resumo b', nome: 'resumo número' }, { sel: '#view-painel .np-resumo span', nome: 'resumo rótulo' },
      { sel: '#view-painel .np-chipf[aria-pressed="true"]', nome: 'chip ativo' }, { sel: '#view-painel .np-chipf[aria-pressed="false"]', nome: 'chip inativo' }, { sel: '#view-painel .np-seg button[aria-pressed="true"]', nome: 'segmento ativo' }, { sel: '#view-painel .np-seg button[aria-pressed="false"]', nome: 'segmento inativo' },
      { sel: '#view-painel .np-grp-h .t', nome: 'título do grupo' }, { sel: '#view-painel .np-grp-h .n', nome: 'contagem do grupo' }, { sel: '#view-painel .np-grp.crit .np-grp-h .t', nome: 'título grupo crítico' },
      { sel: '#view-painel li.np-it .np-it-prazo .d', nome: 'prazo data' }, { sel: '#view-painel li.np-it .np-it-prazo.crit .d', nome: 'prazo data crítico' }, { sel: '#view-painel li.np-it .np-it-prazo .r', nome: 'prazo relativo', opcional: true }, { sel: '#view-painel li.np-it .np-it-abrir .tx', nome: 'título da linha' }, { sel: '#view-painel li.np-it .np-it-abrir .ctx', nome: 'contexto da linha' },
      { sel: '#view-painel li.np-it .np-marca', nome: 'marca' }, { sel: '#view-painel li.np-it .np-marca.crit', nome: 'marca crítica' }, { sel: '#view-painel li.np-it .np-marca.att', nome: 'marca atenção' }, { sel: '#view-painel li.np-it .np-quem span', nome: 'responsável nome' }, { sel: '#view-painel li.np-it .np-quem b', nome: 'responsável iniciais' },
      { sel: '#view-painel li.np-it.r-fatal', nome: 'régua fatal', prop: 'borderLeftColor', minimo: 3 }, { sel: '#view-painel li.np-it.r-late', nome: 'régua atrasada', prop: 'borderLeftColor', minimo: 3 }, { sel: '#view-painel li.np-it.r-att', nome: 'régua hoje', prop: 'borderLeftColor', minimo: 3 },
      { sel: '#view-painel .np-btn.pri', nome: 'botão primário' }, { sel: '#view-painel .np-btn.ghost', nome: 'botão fantasma' }, { sel: '#view-painel .np-it-vazia .np-it-abrir', nome: 'linha vazia', opcional: true },
      { sel: '#view-painel .np-painel h2', nome: 'painel título' }, { sel: '#view-painel .np-painel .np-trilha-p span', nome: 'painel trilha' }, { sel: '#view-painel .np-props dt', nome: 'painel rótulo' }, { sel: '#view-painel .np-props dd', nome: 'painel valor' }, { sel: '#view-painel .np-painel .np-sec h3', nome: 'painel seção' }, { sel: '#view-painel .np-painel .np-txt', nome: 'painel texto' }, { sel: '#view-painel .np-painel .np-p-pe .np-btn', nome: 'painel ação' },
      { sel: '#view-painel .np-rodape span', nome: 'rodapé' }, { sel: '#view-painel .np-legenda span', nome: 'legenda' },
    ];
    const m = await medirContraste(pg, pares);
    if (!m.ruins.length && !m.ausentesObrigatorios.length) ok(`Hoje ${tema}: ${m.medidos.length} pares medidos ≥ mínimo (texto 4,5:1; componentes 3:1); menor razão ${m.minimo.toFixed(2)}:1`); else falha(`Hoje ${tema} contraste: ruins=${JSON.stringify(m.ruins.map(p => [p.nome, p.r.toFixed(2), p.fg, p.bg]))} ausentes=${JSON.stringify(m.ausentesObrigatorios)}`);
    await ctx.close();
    for (const tab of ['agenda', 'avisos']) { const c2 = await contexto(b, { casca: 'v3', w: 1440, tema, hash: '#' + tab, extraLS: { 'pp-agenda-quem': 'equipe', 'pp-agenda-modo': 'semana', 'np-avisos-f': 'todos' } }); const s = '#view-' + tab;
      await c2.pg.waitForFunction((s) => document.querySelectorAll(s + ' li.np-it[data-id]').length >= 1, s, { timeout: 10000 }).catch(() => {});
      await c2.pg.click(s + ' li.np-it[data-id]:not([data-id^="fer:"]) .np-it-abrir'); await esperaPainel(c2.pg);
      const p2 = [{ sel: s + ' .np-resumo b', nome: 'resumo número' }, { sel: s + ' .np-resumo span', nome: 'resumo rótulo' }, { sel: s + ' .np-chipf[aria-pressed="true"]', nome: 'chip ativo' }, { sel: s + ' .np-chipf[aria-pressed="false"]', nome: 'chip inativo' }, { sel: s + ' .np-grp-h .t', nome: 'título do grupo' }, { sel: s + ' li.np-it .np-it-prazo .d', nome: 'prazo data' }, { sel: s + ' li.np-it .np-it-abrir .tx', nome: 'título' }, { sel: s + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: s + ' li.np-it .np-marca', nome: 'marca' }, { sel: s + ' .np-painel h2', nome: 'painel título' }, { sel: s + ' .np-props dt', nome: 'painel rótulo' }, { sel: s + ' .np-props dd', nome: 'painel valor' }, { sel: s + ' .np-painel .np-p-pe .np-btn', nome: 'painel ação' }, { sel: s + ' .np-rodape span', nome: 'rodapé' }, { sel: s + ' li.np-it.r-att', nome: 'régua atenção', prop: 'borderLeftColor', minimo: 3 }];
      if (tab === 'agenda') p2.push({ sel: s + ' .np-ag-h h1', nome: 'título do período' }, { sel: s + ' .np-ag-s', nome: 'estado do Google' }, { sel: s + ' li.np-it.r-fatal', nome: 'régua fatal', prop: 'borderLeftColor', minimo: 3 });
      const m2 = await medirContraste(c2.pg, p2);
      if (!m2.ruins.length && !m2.ausentesObrigatorios.length) ok(`${tab} ${tema}: ${m2.medidos.length} pares ≥ mínimo; menor ${m2.minimo.toFixed(2)}:1`); else falha(`${tab} ${tema} contraste: ruins=${JSON.stringify(m2.ruins.map(p => [p.nome, p.r.toFixed(2)]))} ausentes=${JSON.stringify(m2.ausentesObrigatorios)}`);
      await c2.ctx.close(); }
  }
  { const { ctx, pg } = await contexto(b, { casca: 'v3', w: 375, h: 760, hash: '#painel' }); await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 3, null, { timeout: 10000 }).catch(() => {});
    const m = await medirContraste(pg, [{ sel: '#view-painel li.np-it .np-it-prazo .r', nome: 'prazo relativo (375)' }, { sel: '#view-painel li.np-it .np-it-prazo .d', nome: 'prazo data (375)' }]);
    if (!m.ruins.length && !m.ausentesObrigatorios.length) ok(`Hoje 375: relativo do prazo medido (${m.minimo.toFixed(2)}:1)`); else falha('Hoje 375 relativo: ' + JSON.stringify([m.ruins.map(p => p.nome), m.ausentesObrigatorios])); await ctx.close(); }
  for (const [tab, extra] of [['painel', {}], ['agenda', { 'pp-agenda-quem': 'equipe', 'pp-agenda-modo': 'semana' }], ['avisos', {}]]) for (const w of [375, 768, 1024, 1440]) {
    const { ctx, pg } = await contexto(b, { casca: 'v3', w, h: 900, hash: '#' + tab, extraLS: extra }); const s = '#view-' + tab;
    await pg.waitForFunction((s) => document.querySelectorAll(s + ' li.np-it[data-id]').length >= 1, s, { timeout: 10000 }).catch(() => {});
    await pg.click(tab === 'painel' ? '#view-painel li[data-id="evento:e1"] .np-it-abrir' : s + ' li.np-it[data-id]:not([data-id^="fer:"]) .np-it-abrir'); await esperaPainel(pg);
    const alvos = await medirAlvos(pg, s); const grosso = w < 900; const minimo = grosso ? 44 : 24;
    const ruins = alvos.filter(a => (grosso || !a.inline) && Math.min(a.w, a.h) < minimo && !(a.inline && !grosso));
    if (!ruins.length && alvos.length) ok(`${tab} ${w}px: ${alvos.length} alvos ≥ ${minimo} px${grosso ? ' (toque)' : ' (ponteiro fino; links inline isentos)'}`); else falha(`${tab} ${w}px alvos: ` + JSON.stringify(ruins.slice(0, 8)));
    await ctx.close(); }
  // ========== 8. teclado / ARIA ==========
  rel.push('8. Teclado e ARIA');
  { const { ctx, pg } = await contexto(b, { casca: 'v3', hash: '#painel' }); await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 3, null, { timeout: 10000 }).catch(() => {});
    const a = await pg.evaluate(() => ({ grp: [...document.querySelectorAll('#view-painel .np-grp-h')].every(h => h.hasAttribute('aria-expanded') && h.getAttribute('aria-controls')), inert: [...document.querySelectorAll('#view-painel .np-grp[data-aberto="0"] .np-grp-c')].every(c => c.hasAttribute('inert')), ib: [...document.querySelectorAll('#view-painel .np-ib')].every(b => b.getAttribute('aria-label')), seg: document.querySelector('#view-painel .np-seg')?.getAttribute('role') === 'group', status: document.querySelector('#view-painel .np-resumo')?.getAttribute('role') === 'status', lista: [...document.querySelectorAll('#view-painel .np-lst')].every(u => u.getAttribute('role') === 'list') }));
    if (Object.values(a).every(Boolean)) ok('grupos com aria-expanded/controls e inert quando recolhidos; botões só-ícone com aria-label; segmento role=group; resumo role=status; listas role=list'); else falha('aria: ' + JSON.stringify(a));
    await pg.focus('#view-painel li[data-id="evento:e1"] .np-it-abrir'); await pg.keyboard.press('Enter'); await esperaPainel(pg); await pg.waitForTimeout(400);
    const f1 = await pg.evaluate(() => document.activeElement?.closest('.np-painel') ? 'painel' : document.activeElement?.className);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); const f2 = await pg.evaluate(() => document.activeElement?.closest('li.np-it')?.dataset.id);
    if (f1 === 'painel' && f2 === 'evento:e1') ok('Enter abre o painel com foco dentro; Esc fecha e devolve o foco à linha de origem'); else falha('foco: ' + JSON.stringify([f1, f2]));
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.') + '\n'; fs.writeFileSync(path.join(OUT, 'relatorio-hoje-agenda-avisos-lab.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.log(rel.join('\n')); console.error(e); process.exit(2); });
