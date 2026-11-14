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
/* Relógio FIXO (determinismo): quarta-feira, 11/11/2026 10:00 em Brasília — nas fixtures (aritmética em UTC, sem depender do TZ do runner) e no navegador
   (timezoneId America/Sao_Paulo + clock.install no mesmo instante). A lógica de datas da aplicação (hojeISO em UTC-3, hojeLocal) não muda; só deixa de
   depender do dia/hora reais: resultados iguais em dia útil, fim de semana, qualquer fuso e qualquer horário. */
const FIXO = { ano: 2026, mes: 11, dia: 11, hora: 10, minuto: 0 }; const pad2 = (n) => String(n).padStart(2, '0');
const AGORA_ISO = `${FIXO.ano}-${pad2(FIXO.mes)}-${pad2(FIXO.dia)}T${pad2(FIXO.hora)}:${pad2(FIXO.minuto)}:00-03:00`; const AGORA = new Date(AGORA_ISO);
const hoje = { getFullYear: () => FIXO.ano, getMonth: () => FIXO.mes - 1, getDate: () => FIXO.dia, getHours: () => FIXO.hora }; // mesma interface usada nas fixtures
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const baseUTC = Date.UTC(FIXO.ano, FIXO.mes - 1, FIXO.dia);
const dia = (n) => { const d = new Date(baseUTC + n * 864e5); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const ts = (n, h, m = 0) => new Date(`${dia(n)}T${pad2(h)}:${pad2(m)}:00-03:00`).toISOString();
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
  { ...prazo('pr1', 'Execução · 0000002-22.2026.8.26.0196', 2, { origem: 'processo', r: 'col-caio', c: 'c2', p: 'p1' }), numero_cnj: '0000002-22.2026.8.26.0196' }, // prazo processual COM tarefa vinculada (t8)
  prazo('t8', 'Juntar cálculo na execução', 2, { r: 'col-caio', c: 'c2', p: 'p1' }),                                                   // tarefa vinculada ao processo p1
  { ...prazo('pr2', 'Monitória · 0000003-33.2026.8.26.0196', 0, { origem: 'processo', r: 'col-caio', c: 'c2', p: 'p2', fatal: true }), numero_cnj: '0000003-33.2026.8.26.0196' }, // prazo processual FATAL hoje, SEM tarefa
];
const TAREFAS = PRAZOS.filter(z => z.origem === 'tarefa').map(z => ({ id: z.id, titulo: z.descricao, status: 'aberta', prazo: z.prazo, prazo_fatal: z.prazo_fatal, responsavel_id: z.responsavel_id, responsavel_nome: z.responsavel_nome, cliente_id: z.cliente_id, cliente_nome: z.cliente_nome, faixa: z.faixa, created_by: 'u-admin', nucleo: z.nucleo, hora: null, descricao: 'fictícia' }));
const AGENDA = [
  { id: 'e1', titulo: 'Reunião R1 — Empresa Alfa', inicio: ts(0, 10), fim: ts(0, 11), dia_inteiro: false, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', tipo: 'reuniao', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'Google Meet', descricao: 'Pauta: Raio-X das dívidas.', cancelado: false, numero_cnj: null },
  { id: 'e2', titulo: 'Audiência de conciliação', inicio: ts(0, 14, 30), fim: ts(0, 15, 30), dia_inteiro: false, colaborador_id: 'col-caio', colaborador_nome: 'Caio Teste', cliente_id: 'c2', cliente_nome: 'Beta Comércio ME', tipo: 'audiencia', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'Fórum de Franca — sala 3', descricao: null, cancelado: false, numero_cnj: '0000001-11.2026.8.26.0196' },
  { id: 'e3', titulo: 'Almoço com contador (Google)', inicio: ts(1, 12), fim: ts(1, 13), dia_inteiro: false, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: null, cliente_nome: null, tipo: 'compromisso', origem: 'google', tarefa_id: null, lead_id: null, link: 'https://calendar.google.com/x', local: null, descricao: null, cancelado: false },
  { id: 'e4', titulo: 'Perícia contábil', inicio: ts(3, 0), fim: ts(4, 0), dia_inteiro: true, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', tipo: 'pericia', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: null, descricao: null, cancelado: false },
  { id: 'e5', titulo: 'Reunião com lead Gama', inicio: ts(2, 16), fim: ts(2, 17), dia_inteiro: false, colaborador_id: 'col-bia', colaborador_nome: 'Bia Teste', cliente_id: null, cliente_nome: null, tipo: 'reuniao', origem: 'lead', tarefa_id: null, lead_id: 'l1', link: null, local: null, descricao: null, cancelado: false },
  { id: 'e6', titulo: 'Ligação com o banco (sem término)', inicio: ts(0, 17), fim: null, dia_inteiro: false, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: 'c2', cliente_nome: 'Beta Comércio ME', tipo: 'compromisso', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: null, descricao: null, cancelado: false }, // sem horário de término
  { id: 'e7', titulo: 'Congresso de direito bancário', inicio: ts(1, 0), fim: ts(4, 0), dia_inteiro: true, colaborador_id: 'col-bia', colaborador_nome: 'Bia Teste', cliente_id: null, cliente_nome: null, tipo: 'compromisso', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'São Paulo', descricao: null, cancelado: false }, // atravessa 3 dias (+1, +2, +3)
];
const FERIADOS = [{ data: dia(4), nome: 'Feriado forense fictício', tipo: 'forense', uf: 'SP', comarca: null, ativo: true }];
const EVENTOS = [{ id: 'ev1', tarefa_id: 't3', tipo: 'criada', autor: 'u-jur', autor_nome: 'Caio Teste', criado_em: ts(0, 8, 5), de: null, para: null, nota: null }, { id: 'ev2', tarefa_id: 't2', tipo: 'prazo_alterado', autor: 'u-admin', autor_nome: 'Ana Teste', criado_em: ts(-1, 17, 40), de: dia(-2), para: dia(-1), nota: 'banco pediu mais tempo' }];
const AVISOS = [
  { id: 'a1', titulo: 'Recesso de fim de ano', texto: 'O escritório fecha de 24/12 a 02/01.\nPrazos fatais continuam monitorados pela controladoria.', areas: null, fixado: true, expira_em: null, publicado_em: ts(-2, 9), autor_nome: 'Direção', leituras: 3, lida: false },
  { id: 'a2', titulo: 'Novo modelo de ata', texto: 'A partir de hoje use o modelo da pasta Modelos → Atas.', areas: ['juridico'], fixado: false, expira_em: dia(20), publicado_em: ts(-1, 11), autor_nome: 'Direção', leituras: 1, lida: false },
  { id: 'a3', titulo: 'Confraternização', texto: 'Dia 19, às 19h.', areas: null, fixado: false, expira_em: null, publicado_em: ts(-10, 9), autor_nome: 'Direção', leituras: 9, lida: true },
];
const PERFIS = { admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] }, juridico: { id: 'u-jur', nome: 'Caio Teste', papel: 'colaborador', acessos: ['juridico', 'clientes'] } };
const sessao = (perfil) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Math.max(Date.now(), AGORA.getTime()) / 1000) + 86400 * 365, user: { id: perfil.id, email: perfil.id + '@lab', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
async function contexto(b, { perfil = 'admin', casca = 'v3', w = 1440, h = 900, tema = 'light', hash = '#painel', extraLS = {}, cron = false } = {}) {
  const P = PERFIS[perfil]; const s = sessao(P); const escritas = []; const erros = []; const leituras = [];
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: w < 900, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });
  await ctx.clock.install({ time: AGORA }); // Date/Timers do navegador partem do instante fixo e correm normalmente
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
const esperaPainel = (pg, raiz = '') => pg.waitForFunction((raiz) => [...document.querySelectorAll(raiz + ' .np-painel')].some(p => !p.hidden && p.getAttribute('aria-busy') !== 'true' && p.querySelector('h2')?.textContent && !p.closest('[hidden]')), raiz, { timeout: 10000 });
const ir = async (pg, tab) => { await pg.evaluate((t) => { location.hash = '#' + t; }, tab); await pg.waitForFunction((t) => !document.querySelector('#view-' + t)?.hidden, tab, { timeout: 10000 }); await pg.waitForTimeout(700); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. V2 intacta sem a chave ==========
  rel.push('1. V2 sem a chave');
  { const { ctx, pg, erros } = await contexto(b, { casca: 'v2', hash: '#painel', extraLS: { 'pp-painel-escopo': 'equipe' } }); await pg.waitForTimeout(800);
    const fv2 = await pg.evaluate(() => { const c = [...document.querySelectorAll('#view-painel .card')].find(x => /Prazos fatais de hoje/.test(x.textContent)); return c ? [...c.querySelectorAll('.list > .row')].map(r => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)) : null; });
    if (fv2 && fv2.length === 1 && /Protocolar contestação/.test(fv2[0])) ok('Hoje V2 (Equipe): cartão "Prazos fatais de hoje" continua só com tarefas (t3) — regra da V2 inalterada'); else falha('fatais V2: ' + JSON.stringify(fv2));
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
    if (/2 fatais em 7 dias/.test(r.resumo) && /2 atrasadas/.test(r.resumo) && /2 vencem hoje/.test(r.resumo) && /2 compromissos hoje/.test(r.resumo) && /6 abertas/.test(r.resumo)) ok(`resumo com os mesmos números da V2: "${r.resumo}"`); else falha('resumo: ' + r.resumo);
    if (r.chips.join() === 'Minhas,Equipe' && r.seg.join() === 'Hoje:true,Semana:false,Mês:false') ok('chips de escopo (Minhas/Equipe) e segmento Hoje/Semana/Mês'); else falha('chips/seg: ' + JSON.stringify([r.chips, r.seg]));
    if (/^Bo[am]/.test(r.h1 || '') && /Ana Teste/.test(r.h1)) ok(`saudação em serifa: "${r.h1}"`); else falha('h1: ' + r.h1);
    const gf = r.g.fatais, ga = r.g.atrasados, gh = r.g.hoje, gp = r.g.prox, gav = r.g.avisos, gatv = r.g.atividade;
    if (gf && gf.n === 1 && gf.itens.join() === 'fatal:tarefa:t3') ok('grupo "Prazos fatais de hoje" com t3 (régua fatal, botão Confirmar protocolo)'); else falha('fatais: ' + JSON.stringify(gf));
    if (ga && ga.n === 2 && ga.itens.join() === 'prazo:tarefa:t1,prazo:tarefa:t2') ok('grupo "Atrasados" com t1 (fatal primeiro) e t2'); else falha('atrasados: ' + JSON.stringify(ga));
    if (gh && gh.n === 3 && !gh.itens.includes('prazo:tarefa:t3') && gh.itens.includes('prazo:tarefa:t4') && gh.itens.includes('evento:e1') && gh.itens.includes('evento:e6') && !gh.itens.includes('evento:e2')) ok('grupo "Para hoje": t4, e1 e e6 — t3 só em "Prazos fatais" (sem repetição); e2 do Caio fora de "Minhas"'); else falha('hoje: ' + JSON.stringify(gh));
    if (gp && gp.n === 3 && gp.itens.includes('prazo:tarefa:t5') && gp.itens.includes('evento:e3') && gp.itens.includes('evento:e4') && !gp.itens.includes('prazo:processo:t7')) ok('grupo "Próximos 3 dias": t5, e3 (Google) e e4 (dia inteiro); t7 do Caio fora'); else falha('prox: ' + JSON.stringify(gp));
    if (gav && gav.n === 2 && gav.itens.join() === 'aviso:a1,aviso:a2') ok('grupo "Avisos" no topo com os 2 não lidos (mesmo conteúdo do cartão V2)'); else falha('avisos no Hoje: ' + JSON.stringify(gav));
    if (gatv && gatv.aberto === '0' && gatv.n === 2) ok('"Atividade recente" por último, recolhida, com 2 eventos'); else falha('atividade: ' + JSON.stringify(gatv));
    const ordem = Object.keys(r.g); if (ordem.indexOf('avisos') < ordem.indexOf('fatais') && ordem.indexOf('fatais') < ordem.indexOf('atrasados') && ordem.indexOf('atrasados') < ordem.indexOf('hoje') && ordem.indexOf('hoje') < ordem.indexOf('prox') && ordem[ordem.length - 1] === 'atividade') ok('ordem dos grupos: Avisos → Fatais → Atrasados → Hoje → Próximos → Atividade'); else falha('ordem: ' + ordem.join(','));
    // ações preservadas: Confirmar protocolo chama PP_TAREFAS.concluirComNota com a tarefa; Marcar como lido grava avisos_leituras
    await pg.evaluate(() => { window.__cc = []; const o = window.PP_TAREFAS.concluirComNota; window.PP_TAREFAS.concluirComNota = (z) => { window.__cc.push(z.id); }; window.__ab = []; const oa = window.PP_TAREFAS.abrir; window.PP_TAREFAS.abrir = (id) => { window.__ab.push(id); }; });
    await pg.click('#view-painel li[data-id="fatal:tarefa:t3"] button.np-btn.pri'); const cc = await pg.evaluate(() => window.__cc);
    if (cc.join() === 't3') ok('"Confirmar protocolo" chama PP_TAREFAS.concluirComNota(t3) — mesma ação da V2'); else falha('confirmar: ' + JSON.stringify(cc));
    await pg.click('#view-painel li[data-id="prazo:tarefa:t2"] .np-it-abrir'); const ab = await pg.evaluate(() => window.__ab);
    if (ab.join() === 't2') ok('abrir um prazo de tarefa chama PP_TAREFAS.abrir(t2)'); else falha('abrir tarefa: ' + JSON.stringify(ab));
    await pg.click('#view-painel li[data-id="aviso:a2"] button.np-btn'); await pg.waitForTimeout(600);
    const esc1 = escritas.filter(e => /avisos_leituras/.test(e)); const gav2 = await pg.evaluate(() => [...document.querySelectorAll('#view-painel .np-grp[data-g="avisos"] li.np-it[data-id]')].map(l => l.dataset.id));
    if (esc1.length === 1 && /aviso_id":"a2"/.test(esc1[0]) && /perfil_id":"u-admin"/.test(esc1[0]) && gav2.join() === 'aviso:a1') ok(`"Marcar como lido" no Hoje = upsert em avisos_leituras (a2, u-admin); grupo reflete (${gav2.join(',')})`); else falha('lido no Hoje: ' + JSON.stringify([esc1, gav2]));
    // aviso do Hoje → tela de Avisos com o aviso aberto no painel e marcado como lido (AV.alvo; o roteador normaliza o hash)
    await pg.click('#view-painel li[data-id="aviso:a1"] .np-it-abrir'); await esperaPainel(pg).catch(() => {}); await pg.waitForTimeout(600);
    const avh = await pg.evaluate(() => ({ tab: S.tab, titulo: document.querySelector('#view-avisos .np-painel h2')?.textContent }));
    const esc1b = escritas.filter(e => /avisos_leituras/.test(e) && /aviso_id":"a1"/.test(e));
    if (avh.tab === 'avisos' && avh.titulo === 'Recesso de fim de ano' && esc1b.length === 1) ok('abrir um aviso pelo Hoje leva a Avisos com o aviso aberto no painel e marcado como lido'); else falha('aviso via Hoje: ' + JSON.stringify([avh, esc1b]));
    await ir(pg, 'painel'); await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 3, null, { timeout: 10000 }).catch(() => {});
    // compromisso → painel de detalhe dentro do Hoje (só leitura)
    await pg.click('#view-painel li[data-id="evento:e1"] .np-it-abrir'); await esperaPainel(pg, '#view-painel');
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
    if (eq.hoje.includes('evento:e2') && eq.prox.includes('prazo:processo:t7') && eq.prox.includes('evento:e5') && eq.prox.includes('evento:e7') && eq.prox.includes('prazo:processo:pr1') && eq.prox.includes('prazo:tarefa:t8') && /4 fatais/.test(eq.resumo)) ok('escopo Equipe: entram a audiência do Caio (e2), prazos processuais t7/pr1, tarefa t8, lead e5 e o congresso e7; resumo 4 fatais'); else falha('equipe: ' + JSON.stringify(eq));
    const fq = await pg.evaluate(() => [...document.querySelectorAll('#view-painel .np-grp[data-g="fatais"] li.np-it[data-id]')].map(l => l.dataset.id + ':' + [...l.querySelectorAll('button.np-btn')].map(b => b.textContent.trim()).join('/') + ':' + [...l.querySelectorAll('.np-marca')].map(m => m.textContent).join('+')));
    if (fq.length === 2 && fq.includes('fatal:tarefa:t3:Confirmar protocolo:fatal') && fq.includes('fatal:processo:pr2:Abrir cliente · Processos:fatal+processo')) ok('fatais (Equipe): tarefa t3 com "Confirmar protocolo"; prazo processual pr2 com marca "processo" e "Abrir cliente · Processos" — sem confirmar protocolo (ação só de tarefa)'); else falha('fatais equipe: ' + JSON.stringify(fq));
    const dup = await pg.evaluate(() => { const ids = [...document.querySelectorAll('#view-painel .np-grp[data-g="fatais"] li.np-it[data-id], #view-painel .np-grp[data-g="hoje"] li.np-it[data-id]')].map(l => l.dataset.id.replace(/^fatal:/, 'prazo:')); return ids.filter((x, i) => ids.indexOf(x) !== i); });
    if (!dup.length) ok('nenhum item repetido entre "Prazos fatais de hoje" e "Para hoje"'); else falha('duplicados: ' + dup.join(','));
    const md = await pg.evaluate(() => ({ titulo: document.querySelector('#view-painel .np-grp[data-g="fatais"] .np-grp-h .t')?.textContent, rel: document.querySelector('#view-painel li[data-id="fatal:tarefa:t3"] .np-it-prazo .r')?.textContent, exata: document.querySelector('#view-painel li[data-id="fatal:tarefa:t3"] .np-it-prazo')?.getAttribute('title') || document.querySelector('#view-painel li[data-id="fatal:tarefa:t3"] .np-it-prazo time')?.getAttribute('title') || '' }));
    if (/rotina da controladoria: protocolar até 12h e confirmar/.test(md.titulo || '') && /meta interna/.test(md.rel || '') && /não é o horário legal/.test(md.exata)) ok('"meio-dia" apresentado como meta interna da controladoria (título do grupo, relativo e título da data), não como horário legal de vencimento'); else falha('meio-dia: ' + JSON.stringify(md));
    await pg.evaluate(() => { window.__hash = null; const op = history.pushState.bind(history); history.pushState = (a, b, u) => { window.__hash = u; return op(a, b, u); }; });
    await pg.click('#view-painel li[data-id="fatal:processo:pr2"] button.np-btn'); await pg.waitForTimeout(500);
    const dest = await pg.evaluate(() => ({ hash: window.__hash, tab: S.tab, sel: S.sel, sub: S.sub }));
    if (dest.hash === '#clientes/c2/processos' && dest.tab === 'clientes' && dest.sel === 'c2' && dest.sub === 'processos') ok('"Abrir cliente · Processos" leva exatamente a #clientes/c2/processos (ficha do cliente, aba Processos) — rótulo = destino'); else falha('destino processo: ' + JSON.stringify(dest));
    await ir(pg, 'painel'); await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 3, null, { timeout: 10000 }).catch(() => {});
    const esc2 = escritas.filter(e => !/avisos_leituras/.test(e)); if (!esc2.length && !erros.length) ok('nenhuma outra escrita; sem erros de página'); else falha('escritas/erros: ' + JSON.stringify([esc2, erros]));
    await pg.screenshot({ path: path.join(OUT, 'hoje-1440-light.png') });
    await ctx.close(); }
  // cronômetro rodando
  { const { ctx, pg, escritas } = await contexto(b, { casca: 'v3', hash: '#painel', cron: true }); await pg.waitForFunction(() => !!document.querySelector('#view-painel .np-agora'), null, { timeout: 8000 }).catch(() => {});
    const ag = await pg.evaluate(() => { const a = document.querySelector('#view-painel .np-agora'); return a ? { marca: a.querySelector('.np-marca')?.textContent, cron: /^\d\d:\d\d:\d\d$/.test(a.querySelector('.np-cron')?.textContent || ''), tx: a.querySelector('.tx')?.textContent, bts: [...a.querySelectorAll('button')].map(b => b.textContent) } : null; });
    if (ag && ag.marca === 'trabalhando agora' && ag.cron && ag.tx === 'Protocolar contestação' && ag.bts.join() === 'Abrir,Pausar') ok('faixa "Agora" com cronômetro, tarefa e as ações Abrir/Pausar (mesmas da V2)'); else falha('agora: ' + JSON.stringify(ag));
    await pg.evaluate(() => { window.__ts = []; window.PP_TS = { ...(window.PP_TS || {}), pararDireto: async (o) => { window.__ts.push(o); } }; });
    await pg.click('#view-painel .np-agora button:has-text("Pausar")'); await pg.waitForTimeout(600);
    const tsr = await pg.evaluate(() => ({ ch: window.__ts, toast: document.querySelector('#toast')?.textContent }));
    if (tsr.ch.length === 1 && /Tempo gravado/.test(tsr.toast || '')) ok('"Pausar" chama PP_TS.pararDireto({}) e avisa "Tempo gravado" (mesmo fluxo da V2); nenhuma escrita direta'); else falha('pausar: ' + JSON.stringify(tsr));
    // Receber resumo agora (sino) → POST na função chatguru/enviar {acao:"resumo"} (interceptado)
    await pg.click('#view-painel .np-ib[aria-label^="Receber resumo"]'); await pg.waitForTimeout(600);
    const er = escritas.filter(e => /functions\/v1\/chatguru\/enviar/.test(e));
    if (er.length === 1 && /"acao":"resumo"/.test(er[0])) ok('"Receber resumo agora" = POST functions/v1/chatguru/enviar {acao:"resumo"} (interceptado; nada enviado)'); else falha('resumo: ' + JSON.stringify(er));
    await ctx.close(); }
  // ========== 3. Agenda V3.1 ==========
  rel.push('3. Agenda em V3.1');
  { const { ctx, pg, erros, escritas } = await contexto(b, { casca: 'v3', hash: '#agenda', extraLS: { 'pp-agenda-modo': 'semana', 'pp-agenda-quem': 'equipe' } });
    await pg.waitForFunction(() => document.querySelectorAll('#view-agenda .np-grp').length >= 5, null, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate(() => { const g = {}; document.querySelectorAll('#view-agenda .np-grp').forEach(x => g[x.dataset.g] = { n: +x.querySelector('.np-grp-h .n').textContent, itens: [...x.querySelectorAll('li.np-it[data-id]')].map(l => l.dataset.id), tom: x.className });
      return { v3: document.querySelector('#view-agenda').classList.contains('np-v3'), grade: !!document.querySelector('#view-agenda .ag-grade'), resumo: document.querySelector('#view-agenda .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...document.querySelectorAll('#view-agenda .np-chipf')].map(c => c.textContent.trim()), seg: [...document.querySelectorAll('#view-agenda .np-seg button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')), g, dir: [...document.querySelectorAll('#view-agenda .np-tb-dir button')].map(b => b.textContent.trim()).filter(Boolean) }; });
    if (r.v3 && !r.grade && Object.keys(r.g).length === 7) ok('Agenda em V3.1: 7 grupos (um por dia da semana), sem a grade de horas'); else falha('estrutura agenda: ' + JSON.stringify([r.v3, r.grade, Object.keys(r.g)]));
    if (r.seg.join() === 'Lista:true,Grade:false,Dia:false,Semana:true,Mês:false' && r.chips.slice(0, 2).join() === 'Minha agenda,Toda a equipe' && r.chips.includes('Pessoa…')) ok(`segmentos Lista/Grade e Dia/Semana/Mês; chips (${r.chips.join(' | ')})`); else falha('seg/chips agenda: ' + JSON.stringify([r.seg, r.chips]));
    if (r.dir.slice(-1).join() === 'Compromisso' && r.dir.includes('Hoje')) ok(`ações à direita: ${r.dir.join(' · ')} + "Mais ações" (Sincronizar, Feriados, CSV)`); else falha('dir agenda: ' + r.dir.join(','));
    await pg.click('#view-agenda .np-ib[aria-label="Mais ações"]'); await pg.waitForTimeout(300); const ma = await pg.evaluate(() => [...document.querySelectorAll('#np-pop [role=menuitem]')].map(b => b.textContent.trim())); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    if (ma.join() === 'Sincronizar com o Google,Feriados e suspensões de prazo,Exportar CSV') ok('"Mais ações": Sincronizar com o Google · Feriados · Exportar CSV (mesmas funções da V2)'); else falha('mais ações: ' + ma.join(','));
    await pg.evaluate(() => { window.__csv = null; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__csv = { nome: this.download }; fetch(this.href).then(r => r.text()).then(t => { window.__csv.cab = t.replace(/^\uFEFF/, '').split('\r\n')[0]; window.__csv.ls = t.split('\r\n').length - 1; }); return; } return oc.call(this); }; });
    await pg.click('#view-agenda .np-ib[aria-label="Mais ações"]'); await pg.waitForTimeout(200); await pg.click('#np-pop [role=menuitem]:has-text("Exportar CSV")'); await pg.waitForTimeout(600);
    const cs = await pg.evaluate(() => window.__csv); if (cs && /^agenda-\d{4}-\d\d-\d\d\.csv$/.test(cs.nome) && cs.ls >= 8 && cs.cab === 'Data;Hora;Tipo;Título;Responsável;Cliente;Processo;Local;Origem') ok(`Exportar CSV: arquivo ${cs.nome} com as 9 colunas da V2 e ${cs.ls} linhas visíveis`); else falha('csv: ' + JSON.stringify(cs));
    const hojeK = iso(hoje); const gh = r.g['d' + hojeK];
    // toda a equipe, hoje: e1 (10h), e2 (14h30) + prazos t3 (fatal), t4 (prazo) → 4 itens; dia +4: feriado forense (linha) sem itens
    if (gh && gh.n === 6 && gh.itens.includes('e1') && gh.itens.includes('e2') && gh.itens.includes('e6') && gh.itens.includes('prazo:tarefa:t3') && gh.itens.includes('prazo:tarefa:t4') && gh.itens.includes('prazo:processo:pr2')) ok('hoje na Agenda (equipe): reunião, audiência, ligação sem término, prazos t3/t4 e prazo processual fatal pr2 — mesmos itens da V2'); else falha('agenda hoje: ' + JSON.stringify(gh));
    const e7g = Object.entries(r.g).filter(([k, g]) => g.itens.includes('e7')).map(([k]) => k); const e7t = await pg.evaluate(() => document.querySelector('#view-agenda li[data-id="e7"] .ctx')?.textContent);
    const semanaTem = [1, 2, 3].map(n => 'd' + dia(n)).filter(k => k in r.g);
    if (e7g.length === semanaTem.length && semanaTem.every(k => e7g.includes(k)) && /3 dias/.test(e7t || '')) ok(`evento de 3 dias (e7) aparece em cada dia da semana que cobre (${e7g.length}) com "3 dias (até …)" no contexto`); else falha('e7: ' + JSON.stringify([e7g, semanaTem, e7t]));
    const e6t = await pg.evaluate(() => document.querySelector('#view-agenda li[data-id="e6"]')?.textContent.replace(/\s+/g, ' '));
    if (e6t && /17h00/.test(e6t) && !/NaN/.test(e6t) && !/até/.test(e6t)) ok('compromisso sem término (e6): hora de início, sem "até", sem NaN'); else falha('e6: ' + e6t);
    await pg.click('#view-agenda li[data-id="e6"] .np-it-abrir'); await esperaPainel(pg);
    const q6 = await pg.evaluate(() => [...document.querySelectorAll('#view-agenda .np-props dd')].map(d => d.textContent).join(' | '));
    if (/17h00 \(sem horário de término\)/.test(q6) && !/NaN/.test(q6)) ok('painel de e6: "17h00 (sem horário de término)"'); else falha('painel e6: ' + q6);
    await pg.click('#view-agenda li[data-id="e7"] .np-it-abrir'); await esperaPainel(pg);
    const q7 = await pg.evaluate(() => document.querySelector('#view-agenda .np-props dd')?.textContent);
    if (/ a /.test(q7 || '') && !/NaN/.test(q7 || '')) ok(`painel de e7: período "${q7}"`); else falha('painel e7: ' + q7);
    // prazo processual com tarefa vinculada (pr1 ↔ t8) e sem (pr2)
    await pg.click('#view-agenda li[data-id="prazo:processo:pr1"] .np-it-abrir'); await esperaPainel(pg);
    await pg.evaluate(() => { window.__ab = []; window.PP_TAREFAS.abrir = (id) => { window.__ab.push(id); }; });
    const pv = await pg.evaluate(() => { const p = document.querySelector('#view-agenda .np-painel'); const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim()); return { props, vinc: [...p.querySelectorAll('.np-vinc button')].map(b => b.textContent.trim()), sec: p.querySelector('.np-sec h3')?.textContent, pe: [...p.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()) }; });
    if (pv.props.Processo === '0000002-22.2026.8.26.0196' && pv.sec === 'Tarefas do processo (1)' && pv.vinc.join() === 'Juntar cálculo na execução' && pv.pe.join() === 'Abrir cliente · Processos') ok('prazo processual pr1: número do processo, seção "Tarefas do processo (1)" com t8, ação "Abrir cliente · Processos"'); else falha('pr1: ' + JSON.stringify(pv));
    await pg.click('#view-agenda .np-vinc button'); const abv = await pg.evaluate(() => window.__ab); if (abv.join() === 't8') ok('tarefa vinculada abre por PP_TAREFAS.abrir(t8)'); else falha('vinc abrir: ' + JSON.stringify(abv));
    await pg.click('#view-agenda li[data-id="prazo:processo:pr2"] .np-it-abrir'); await esperaPainel(pg);
    const pv2 = await pg.evaluate(() => ({ sec: document.querySelector('#view-agenda .np-painel .np-sec h3')?.textContent || null, trilha: document.querySelector('#view-agenda .np-painel .np-trilha-p')?.textContent.replace(/\s+/g, ' ').trim() }));
    if (pv2.sec === null && /Prazo fatal/.test(pv2.trilha)) ok('prazo processual pr2 (sem tarefa): sem seção de tarefas; trilha "Prazo fatal"'); else falha('pr2: ' + JSON.stringify(pv2));
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
    if (d1.g === 1 && d1.n === 6) ok('vista Dia: 1 grupo (hoje) com 6 itens'); else falha('dia: ' + JSON.stringify(d1));
    // novo compromisso com data predefinida (dia em foco, 9h)
    await pg.click('#view-agenda .np-tb-dir .np-btn.pri'); await pg.waitForTimeout(300);
    const nf = await pg.evaluate(() => ({ t: document.querySelector('#modalHost h2')?.textContent, d: document.querySelector('#modalHost input[type=date]')?.value, h: [...document.querySelectorAll('#modalHost input[type=time]')].map(i => i.value) }));
    if (nf.t === 'Novo compromisso' && nf.d === iso(hoje) && nf.h.join() === '09:00,10:00') ok(`"Compromisso" abre o formulário atual com a data em foco (${nf.d}) e 9h–10h`); else falha('novo: ' + JSON.stringify(nf));
    await pg.evaluate(() => document.querySelector('#modalHost .btn:not(.primary)').click()); await pg.waitForTimeout(200);
    await pg.click('#view-agenda .np-seg button[data-k="mes"]'); await pg.waitForTimeout(800);
    const m1 = await pg.evaluate(() => ({ g: document.querySelectorAll('#view-agenda .np-grp').length, vazios: document.querySelectorAll('#view-agenda .np-it-vazia').length }));
    if (m1.g >= 4 && m1.vazios === 0) ok(`vista Mês: só dias com itens (${m1.g}), sem linhas vazias`); else falha('mês agenda: ' + JSON.stringify(m1));
    // ---- modo Grade (componente da V2 reutilizado dentro da V3.1)
    await pg.click('#view-agenda .np-seg button[data-k="grade"]'); await pg.waitForTimeout(700);
    const gm = await pg.evaluate(() => ({ mes: !!document.querySelector('#view-agenda .np-grade-w .ag-mes'), lista: document.querySelectorAll('#view-agenda .np-grp').length, chips: document.querySelectorAll('#view-agenda .ag-mes .ag-ev').length }));
    if (gm.mes && gm.lista === 0 && gm.chips >= 8) ok(`Grade + Mês: grade mensal da V2 (${gm.chips} chips) dentro da obra V3.1`); else falha('grade mês: ' + JSON.stringify(gm));
    await pg.click('#view-agenda .np-seg button[data-k="semana"]'); await pg.waitForTimeout(700);
    const gs = await pg.evaluate(() => { const chips = [...document.querySelectorAll('#view-agenda .ag-grade .ag-ev')]; return { grade: !!document.querySelector('#view-agenda .np-grade-w .ag-grade'), chips: chips.length, slots: document.querySelectorAll('#view-agenda .ag-grade .ag-slot').length, inteiros: document.querySelectorAll('#view-agenda .ag-grade .ag-inteiro .ag-ev').length, fora: document.querySelector('#view-agenda .np-fora')?.textContent || '' }; });
    await pg.click('#view-agenda .np-seg button[data-k="lista"]'); await pg.waitForTimeout(700);
    const ls = await pg.evaluate(() => document.querySelectorAll('#view-agenda li.np-it[data-id]:not([data-id^="fer:"])').length);
    if (gs.grade && gs.slots === 7 * 13 && gs.chips === ls) ok(`Grade + Semana: grade de horas 7h–20h (${gs.slots} células) com ${gs.chips} chips = ${ls} linhas da Lista (mesmo conjunto; ${gs.inteiros} de dia inteiro/prazos)`); else falha('grade semana: ' + JSON.stringify([gs, ls]));
    await pg.click('#view-agenda .np-seg button[data-k="grade"]'); await pg.waitForTimeout(700);
    await pg.click('#view-agenda .ag-grade .ag-ev[title^="Reunião R1"]'); await esperaPainel(pg);
    const gp = await pg.evaluate(() => ({ titulo: document.querySelector('#view-agenda .np-painel h2')?.textContent, modal: !!document.querySelector('#modalHost h2') }));
    if (gp.titulo === 'Reunião R1 — Empresa Alfa' && !gp.modal) ok('clicar num chip da grade abre o painel V3.1 (não o modal da V2)'); else falha('chip grade: ' + JSON.stringify(gp));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    await pg.evaluate(() => { const cels = [...document.querySelectorAll('#view-agenda .ag-grade .ag-slot')]; cels[7 * 3 + 2].click(); }); await pg.waitForTimeout(300); // 10h, 3º dia
    const gf = await pg.evaluate(() => ({ t: document.querySelector('#modalHost h2')?.textContent, h: document.querySelector('#modalHost input[type=time]')?.value }));
    if (gf.t === 'Novo compromisso' && gf.h === '10:00') ok('célula vazia da grade abre "Novo compromisso" no horário da célula (10h) — capacidade da V2 preservada'); else falha('célula: ' + JSON.stringify(gf));
    await pg.evaluate(() => document.querySelector('#modalHost .btn:not(.primary)').click()); await pg.waitForTimeout(200);
    await pg.click('#view-agenda .np-seg button[data-k="dia"]'); await pg.waitForTimeout(600);
    const gd = await pg.evaluate(() => ({ cols: getComputedStyle(document.querySelector('#view-agenda .ag-grade')).gridTemplateColumns.split(' ').length, chips: document.querySelectorAll('#view-agenda .ag-grade .ag-ev').length }));
    if (gd.cols === 2 && gd.chips === 6) ok('Grade + Dia: uma coluna com os 6 itens de hoje'); else falha('grade dia: ' + JSON.stringify(gd));
    await pg.click('#view-agenda .np-seg button[data-k="lista"]'); await pg.waitForTimeout(400);
    // Sincronizar (Mais ações) → POST functions/v1/chatguru/enviar {acao:"agenda"} (interceptado)
    await pg.click('#view-agenda .np-ib[aria-label="Mais ações"]'); await pg.waitForTimeout(200); await pg.click('#np-pop [role=menuitem]:has-text("Sincronizar")'); await pg.waitForTimeout(700);
    const sy = escritas.filter(e => /functions\/v1\/chatguru\/enviar/.test(e));
    if (sy.length === 1 && /"acao":"agenda"/.test(sy[0])) ok('"Sincronizar com o Google" = POST functions/v1/chatguru/enviar {acao:"agenda"} (interceptado; nenhuma sincronização real)'); else falha('sync: ' + JSON.stringify(sy));
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
    // Discord (admin): configuração atual dentro do painel; Salvar = PATCH escritorio id=eq.discord (interceptado)
    await pg.click('#view-avisos .np-tb-dir button:has-text("Discord")'); await pg.waitForFunction(() => !!document.querySelector('#view-avisos .np-painel #dc-av'), null, { timeout: 8000 }).catch(() => {});
    await pg.fill('#view-avisos .np-painel #dc-av', '123456789012345678'); await pg.click('#view-avisos .np-painel button:has-text("Salvar")'); await pg.waitForTimeout(700);
    const dc = escritas.filter(e => /escritorio|chat_canais/.test(e));
    if (dc.length === 1 && /^PATCH \/rest\/v1\/escritorio\?id=eq\.discord/.test(dc[0]) && /"canal_avisos":"123456789012345678"/.test(dc[0]) && /"ponte_ativa":true/.test(dc[0])) ok('Discord no painel: Salvar = PATCH escritorio id=eq.discord com canal_avisos e ponte_ativa (mesma gravação da V2; chat_canais só quando existe)'); else falha('discord: ' + JSON.stringify(dc));
    await pg.click('#view-avisos .np-tb-dir button:has-text("Aviso")'); await pg.waitForTimeout(300);
    const nf = await pg.evaluate(() => document.querySelector('#modalHost h2')?.textContent); if (nf === 'Novo aviso') ok('"Aviso" (admin) abre o formulário atual (modal V2)'); else falha('novo aviso: ' + nf);
    await pg.evaluate(() => document.querySelector('#modalHost .btn:not(.primary)').click());
    if (!erros.length) ok('Avisos sem erros de página'); else falha('erros avisos: ' + JSON.stringify(erros));
    await pg.click('#view-avisos .np-chipf:has-text("Não lidos")'); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, 'avisos-1440-light.png') });
    await ctx.close(); AVISOS.forEach(a => { a.lida = a.id === 'a3'; }); }
  // link direto #avisos/<id> abre o aviso no painel e marca como lido (como na V2)
  { const { ctx, pg, escritas } = await contexto(b, { casca: 'v3', hash: '#avisos/a2' }); await esperaPainel(pg).catch(() => {}); await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => ({ titulo: document.querySelector('#view-avisos .np-painel h2')?.textContent, pe: [...document.querySelectorAll('#view-avisos .np-painel .np-p-pe button')].map(b => b.textContent.trim()) }));
    const esc = escritas.filter(e => /avisos_leituras/.test(e));
    if (r.titulo === 'Novo modelo de ata' && esc.length === 1 && /aviso_id":"a2"/.test(esc[0])) ok('link direto #avisos/a2: painel aberto e upsert em avisos_leituras (a2) — comportamento da V2'); else falha('link direto: ' + JSON.stringify([r, esc]));
    await ctx.close(); AVISOS.forEach(a => { a.lida = a.id === 'a3'; }); }
  // ========== 4b. preferências isoladas entre / e /beta/ na mesma origem ==========
  rel.push('4b. Preferências: / e /beta/ na mesma origem');
  { const cp = require('child_process'); const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'np-esp-')); for (const d of ['fontes', 'passivos']) fs.cpSync(path.join(RAIZ, d), path.join(tmp, d), { recursive: true });
    try { cp.execFileSync(process.execPath, [path.join(tmp, 'fontes/gerar-app-supabase.mjs')], { cwd: tmp, stdio: 'pipe' }); cp.execFileSync(process.execPath, [path.join(tmp, 'fontes/gerar-app-supabase.mjs')], { cwd: tmp, stdio: 'pipe', env: { ...process.env, PP_ESPELHO: '1' } }); } catch (e) { falha('gerar espelho temporário: ' + String(e.stderr || e.message).slice(0, 300)); }
    const srv2 = await new Promise((res) => { const sv = http.createServer((q, r) => { const f = path.join(tmp, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(tmp) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); sv.listen(0, '127.0.0.1', () => res(sv)); });
    const base2 = `http://127.0.0.1:${srv2.address().port}`; const BASE0 = BASE; BASE = base2;
    const { ctx, pg, erros } = await contexto(b, { casca: 'v3', hash: '#avisos', extraLS: { 'np-casca-beta': 'v3', 'sb-ooynicwexxqqccihjiah-auth-token': JSON.stringify(sessao(PERFIS.admin)) } });
    await pg.waitForFunction(() => document.querySelectorAll('#view-avisos .np-chipf').length >= 3, null, { timeout: 10000 }).catch(() => {});
    await pg.click('#view-avisos .np-chipf:has-text("Todos")'); await pg.waitForTimeout(400);
    await pg.click('#view-avisos .np-grp-h'); await pg.waitForTimeout(200); // recolhe "Não lidos" (pref de grupo)
    const k1 = await pg.evaluate(() => Object.keys(localStorage).filter(k => /^np-/.test(k)).sort());
    await pg.goto(base2 + '/beta/index.html#avisos', { waitUntil: 'load' }); await pg.waitForFunction(() => document.querySelectorAll('#view-avisos .np-chipf').length >= 3, null, { timeout: 15000 }).catch(() => {});
    const rb = await pg.evaluate(() => ({ espelho: document.body.dataset.espelho, v3: document.documentElement.classList.contains('np-casca-v3'), on: document.querySelector('#view-avisos .np-chipf[aria-pressed="true"]')?.textContent.replace(/\d+$/, '').trim() }));
    if (rb.espelho === '1' && rb.v3 && rb.on === 'Não lidos') ok('beta (np-casca-beta) na mesma origem: filtro de Avisos volta ao padrão "Não lidos" — a escolha feita em / não vaza'); else falha('beta pref: ' + JSON.stringify(rb));
    await pg.click('#view-avisos .np-chipf:has-text("Fixados")'); await pg.waitForTimeout(400);
    const k2 = await pg.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /^np-avisos-f|^np-casca/.test(k))));
    if (k2['np-avisos-f'] === 'todos' && k2['np-avisos-f-beta'] === 'fixados' && k1.includes('np-avisos-f') && !k1.includes('np-avisos-f-beta')) ok('chaves separadas: np-avisos-f=todos (produção) e np-avisos-f-beta=fixados (espelho); grupos usam o mesmo sufixo'); else falha('chaves: ' + JSON.stringify([k1, k2]));
    await pg.goto(base2 + '/index.html#avisos', { waitUntil: 'load' }); await pg.waitForFunction(() => document.querySelectorAll('#view-avisos .np-chipf').length >= 3, null, { timeout: 15000 }).catch(() => {});
    const r0 = await pg.evaluate(() => document.querySelector('#view-avisos .np-chipf[aria-pressed="true"]')?.textContent.replace(/\d+$/, '').trim());
    if (r0 === 'Todos') ok('de volta a /: filtro "Todos" preservado (a escolha do beta não interferiu)'); else falha('volta: ' + r0);
    const leg = await pg.evaluate(() => Object.keys(localStorage).filter(k => /^pp-(agenda|painel)-/.test(k)));
    ok(`chaves legadas da V2 (${leg.join(', ') || 'nenhuma gravada neste fluxo'}) continuam únicas por origem, como já era na V2 (comportamento preservado, documentado)`);
    if (!erros.length) ok('sem erros em / e /beta/'); else falha('erros pref: ' + JSON.stringify(erros));
    await ctx.close(); srv2.close(); BASE = BASE0; fs.rmSync(tmp, { recursive: true, force: true }); }
  // ========== 5. permissões: colaborador do Jurídico (não admin) ==========
  rel.push('5. Perfil colaborador (Jurídico): escopo e ações restritas');
  { const { ctx, pg, erros } = await contexto(b, { perfil: 'juridico', casca: 'v3', hash: '#avisos' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-avisos li.np-it[data-id]').length >= 1, null, { timeout: 10000 }).catch(() => {});
    const r = await pg.evaluate(() => ({ dir: [...document.querySelectorAll('#view-avisos .np-tb-dir button')].map(b => b.textContent.trim()), leituras: document.querySelectorAll('#view-avisos .np-num').length }));
    if (!r.dir.length && !r.leituras) ok('colaborador: sem "Aviso"/"Discord" e sem contagem de leituras (só admin)'); else falha('colab avisos: ' + JSON.stringify(r));
    await pg.click('#view-avisos li[data-id="a1"] .np-it-abrir'); await esperaPainel(pg); const pe = await pg.evaluate(() => [...document.querySelectorAll('#view-avisos .np-painel .np-p-pe button')].map(b => b.textContent.trim()));
    if (pe.join() === 'Marcar como lido') ok('colaborador: painel do aviso só com "Marcar como lido" (sem Editar)'); else falha('colab pe: ' + pe.join(','));
    await ir(pg, 'painel'); await pg.waitForFunction(() => document.querySelectorAll('#view-painel .np-grp').length >= 2, null, { timeout: 10000 }).catch(() => {});
    const h = await pg.evaluate(() => ({ chips: [...document.querySelectorAll('#view-painel .np-chipf')].map(c => c.textContent.trim()), hoje: [...document.querySelectorAll('#view-painel .np-grp[data-g="hoje"] li.np-it[data-id]')].map(l => l.dataset.id), prox: [...document.querySelectorAll('#view-painel .np-grp[data-g="prox"] li.np-it[data-id]')].map(l => l.dataset.id), fatais: [...document.querySelectorAll('#view-painel .np-grp[data-g="fatais"] li.np-it[data-id]')].map(l => l.dataset.id + ':' + [...l.querySelectorAll('button.np-btn')].map(b => b.textContent.trim()).join('/')) }));
    // Caio (Minhas): fatais = pr2 (processo, sem "Confirmar protocolo"); hoje = e2; próximos = t7, pr1, t8 (tudo dele)
    if (h.hoje.join() === 'evento:e2' && h.prox.join() === 'prazo:processo:t7,prazo:processo:pr1,prazo:tarefa:t8' && h.fatais.join() === 'fatal:processo:pr2:Abrir cliente · Processos') ok('Hoje do Caio ("Minhas"): fatal processual pr2 (sem Confirmar protocolo), audiência e3 prazos dele; nada de outros'); else falha('hoje caio: ' + JSON.stringify(h));
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
