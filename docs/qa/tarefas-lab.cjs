/* Laboratório da tela Tarefas e prazos em V3.1 (Fase 2). Playwright + Chromium locais; o repositório é servido por um
   servidor HTTP efêmero (127.0.0.1) e TODA chamada a *.supabase.co é interceptada e respondida com fixtures fictícias —
   nenhuma requisição sai da máquina, nada é escrito. Perfis: admin (vê tudo) e colaborador do Jurídico com escopo restrito.
   Uso: NODE_PATH=<módulos> node docs/qa/tarefas-lab.cjs [pasta de saída]  (padrão /tmp/tarefas-lab)
   Verifica: paridade de dados V2 × V3.1 por filtro e perfil, paridade de ações (espiões), permissões/readOnly, prazos exatos +
   relativos, filtros completos, teclado/ARIA, contraste e toque, persistência, quadro (mover por teclado), capturas. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http');
const RAIZ = process.cwd(); const OUT = process.argv[2] || '/tmp/tarefas-lab'; fs.mkdirSync(OUT, { recursive: true });
const REF = 'ksdwzljfjfucjevdqxvx';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
let BASE = '';
const servir = () => new Promise((res) => { const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); srv.listen(0, '127.0.0.1', () => { BASE = `http://127.0.0.1:${srv.address().port}`; res(srv); }); });

/* ---------- fixtures fictícias ---------- */
const hoje = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (n) => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n); return iso(d); };
const faixa = (n) => n == null ? 'sem_prazo' : n < 0 ? 'atrasada' : n === 0 ? 'hoje' : n <= 7 ? 'd7' : n <= 15 ? 'd15' : n <= 30 ? 'd30' : 'depois';
const COLAB = [{ id: 'col-ana', perfil_id: 'u-admin', nome: 'Ana Teste', apelido: 'Ana', nucleo: 'socios', ativo: true }, { id: 'col-caio', perfil_id: 'u-jur', nome: 'Caio Teste', apelido: 'Caio', nucleo: 'juridico', ativo: true }, { id: 'col-maria', perfil_id: 'u-maria', nome: 'Maria Eduarda Teste', apelido: 'Duda', nucleo: 'acordos', ativo: true }];
const CLIENTES = [{ id: 'c1', nome: 'Empresa Alfa Ltda', nome_fantasia: 'Alfa', cnpj: '00.000.000/0001-01', cidade: 'Franca/SP', status: 'ativo', created_at: '2026-01-10' }, { id: 'c2', nome: 'Beta Comércio ME', nome_fantasia: 'Beta', cnpj: '00.000.000/0001-02', cidade: 'Batatais/SP', status: 'ativo', created_at: '2026-02-10' }, { id: 'c3', nome: 'Gama Indústria SA', nome_fantasia: 'Gama', cnpj: '00.000.000/0001-03', cidade: 'Ribeirão Preto/SP', status: 'onboarding', created_at: '2026-10-10' }];
let seq = 0; const uuid = () => { const h = (seq++).toString(16).padStart(12, '0'); return `00000000-0000-4000-8000-${h}`; };
const tarefa = (o) => { const n = o.dias; const id = uuid(); return { id, titulo: o.t, descricao: o.d || null, cliente_id: o.c || null, cliente_nome: o.c ? CLIENTES.find(x => x.id === o.c).nome : null, responsavel_id: o.r, responsavel_nome: COLAB.find(x => x.id === o.r)?.nome || null, nucleo: o.n || 'juridico', prazo: n == null ? null : dia(n), hora: o.h || null, prazo_fatal: !!o.f, status: o.s || 'aberta', prioridade: o.p || 2, faixa: o.s === 'concluida' || o.s === 'cancelada' ? 'fechada' : faixa(n), dias_para_prazo: n == null ? null : n, horas_apontadas: o.ha || 0, created_at: '2026-11-01T14:10:00Z', criado_por_nome: 'Maria Eulália Teste', created_by: 'u-admin', concluida_em: o.s === 'concluida' ? new Date(Date.now() - 86400000).toISOString() : null, concluida_por_nome: o.s === 'concluida' ? 'Caio Teste' : null, cadeia_id: o.cad || null, etapa_codigo: o.et || null, numero_cnj: o.cnj || null, processo_id: o.cnj ? 'p1' : null, contrato_id: null }; };
const CAD = 'cadeia-0001';
const TAREFAS = [
  tarefa({ t: 'Protocolar embargos à execução — Banco Sigma', c: 'c1', r: 'col-caio', dias: -3, f: true, h: '23:59:00', p: 1, cnj: '0000001-11.2026.8.26.0196', cad: CAD, et: 'protocolar', d: 'Embargos prontos; aguardando guia de custas.' }),
  tarefa({ t: 'Conferir protocolo dos embargos', c: 'c1', r: 'col-caio', dias: -1, cad: CAD, et: 'conferir', cnj: '0000001-11.2026.8.26.0196' }),
  tarefa({ t: 'Analisar cabimento de agravo — decisão de 03/11', c: 'c2', r: 'col-caio', dias: 0, f: true, p: 1 }),
  tarefa({ t: 'Enviar proposta ao Banco Ômega', c: 'c2', r: 'col-maria', n: 'acordos', dias: 0, h: '14:00:00', ha: 1.5 }),
  tarefa({ t: 'Reunião de acompanhamento mensal', c: 'c3', r: 'col-ana', n: 'acompanhamento_pj', dias: 2, h: '10:00:00' }),
  tarefa({ t: 'Recolher custas do agravo', c: 'c2', r: 'col-caio', dias: 4, cad: 'cadeia-0002', et: 'custas' }),
  tarefa({ t: 'Levantar contratos de capital de giro', c: 'c1', r: 'col-caio', dias: 6, s: 'em_andamento', ha: 3.25 }),
  tarefa({ t: 'Montar planilha de passivos — Gama', c: 'c3', r: 'col-maria', n: 'acordos', dias: 9 }),
  tarefa({ t: 'Pedir certidões atualizadas', c: 'c1', r: 'col-ana', n: 'administrativo', dias: 12 }),
  tarefa({ t: 'Preparar relatório mensal ao cliente', c: 'c2', r: 'col-ana', n: 'acompanhamento_pj', dias: 20 }),
  tarefa({ t: 'Revisar modelo de contestação', r: 'col-caio', dias: 40 }),
  tarefa({ t: 'Organizar pasta de modelos', r: 'col-ana', n: 'administrativo', dias: null }),
  tarefa({ t: 'Enviar boleto de novembro', c: 'c1', r: 'col-ana', n: 'administrativo', dias: -2, s: 'concluida' }),
  tarefa({ t: 'Agendar reunião com o Banco Delta', c: 'c2', r: 'col-maria', n: 'acordos', dias: 5, s: 'cancelada' }),
];
const PERFIS = { admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] }, juridico: { id: 'u-jur', nome: 'Caio Teste', papel: 'colaborador', acessos: ['juridico'] } };
const EVENTOS = (tid) => { const t = TAREFAS.find(x => x.id === tid); const ev = [{ id: 'ev1-' + tid, tarefa_id: tid, tipo: 'criada', autor_nome: 'Maria Eulália Teste', para: 'Caio Teste', criado_em: '2026-11-01T14:10:00Z' }]; if (!t?.cadeia_id) ev.push({ id: 'ev2-' + tid, tarefa_id: tid, tipo: 'comentario', autor_nome: 'Caio Teste', nota: 'Minuta pronta; falta a guia.', criado_em: '2026-11-05T09:30:00Z' }); return ev; };
const sessao = (perfil) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: perfil.id, email: perfil.id + '@lab.exemplo', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });

async function contexto(b, { perfil = 'admin', casca = 'v3', w = 1440, h = 900, tema = 'light', reduz = false, touch = false, extraLS = {} } = {}) {
  const P = PERFIS[perfil]; const s = sessao(P); const escritas = []; const erros = [];
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: touch || w < 900, isMobile: touch, reducedMotion: reduz ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(({ s, ref, casca, tema, extraLS }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)); if (casca === 'v3') localStorage.setItem('np-casca', 'v3'); localStorage.setItem('pp-tema', tema); localStorage.setItem('pp-tab', 'tarefas'); for (const [k, v] of Object.entries(extraLS)) localStorage.setItem(k, v); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { s, ref: REF, casca, tema, extraLS });
  await ctx.route(/supabase\.co/, async (rota) => {
    const req = rota.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method(); const unico = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (b, status = 200, extra = {}) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...extra }, body: JSON.stringify(b) });
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !p.startsWith('/auth/')) { escritas.push(m + ' ' + p + ' ' + (req.postData() || '').slice(0, 120));
      // simula o efeito da escrita na fixture (só em memória do laboratório) para que a tela recarregada reflita a mudança
      if (m === 'PATCH' && p.startsWith('/rest/v1/tarefas')) { try { const corpo = JSON.parse(req.postData() || '{}'); const id = (u.searchParams.get('id') || '').replace('eq.', ''); const t = TAREFAS.find(x => x.id === id); if (t && corpo.status) { t.status = corpo.status; t.faixa = corpo.status === 'concluida' || corpo.status === 'cancelada' ? 'fechada' : faixa(t.dias_para_prazo); t.concluida_em = corpo.status === 'concluida' ? new Date().toISOString() : null; } } catch (_) {} }
      return json(m === 'POST' && /rpc/.test(p) ? null : (m === 'POST' ? [{ id: 'novo-' + Date.now() }] : []), m === 'POST' ? 201 : 200); }
    if (p.startsWith('/auth/v1/user')) return json(s.user); if (p.startsWith('/auth/v1/token')) return json(s); if (p.startsWith('/auth/v1/logout')) return json({}, 204);
    if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/rpc/')) return json(m === 'POST' ? [] : null);
    if (p.startsWith('/rest/v1/perfis')) return json(unico ? P : [P]);
    if (p.startsWith('/rest/v1/clientes')) return json(CLIENTES, 200, { 'content-range': `0-${CLIENTES.length - 1}/${CLIENTES.length}` });
    if (p.startsWith('/rest/v1/v_tarefas')) { const cad = u.searchParams.get('cadeia_id'); const lista = cad ? TAREFAS.filter(t => t.cadeia_id === cad.replace('eq.', '')) : TAREFAS; return json(lista); }
    if (p.startsWith('/rest/v1/colaboradores')) { const pid = (u.searchParams.get('perfil_id') || '').replace('eq.', ''); const lista = pid ? COLAB.filter(x => x.perfil_id === pid) : COLAB; if (unico) return lista[0] ? json(lista[0]) : json({ message: 'nenhum', code: 'PGRST116' }, 406); return json(lista); }
    if (p.startsWith('/rest/v1/processos')) return json([{ id: 'p1', cliente_id: 'c1', numero_cnj: '0000001-11.2026.8.26.0196', parte_contraria: 'Banco Sigma' }]);
    if (p.startsWith('/rest/v1/v_tickets')) return json([]);
    if (p.startsWith('/rest/v1/motivos_reagendamento')) return json([{ id: 'm1', motivo: 'Pedido do cliente', exige_complemento: false, ativo: true, ordem: 1 }, { id: 'm2', motivo: 'Outro', exige_complemento: true, ativo: true, ordem: 9 }]);
    if (p.startsWith('/rest/v1/tarefa_eventos')) { const tid = (u.searchParams.get('tarefa_id') || '').replace('eq.', ''); const tipo = u.searchParams.get('tipo'); let ev = EVENTOS(tid); if (tipo) ev = ev.filter(e => e.tipo === tipo.replace('eq.', '')); return json(ev); }
    if (p.startsWith('/rest/v1/anexos')) return json([]);
    return unico ? json({ message: 'nenhum', code: 'PGRST116' }, 406) : json([]);
  });
  const pg = await ctx.newPage(); pg.on('pageerror', e => erros.push(e.message)); pg.on('console', msg => { if (msg.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(msg.text())) erros.push('console: ' + msg.text().slice(0, 160)); });
  await pg.goto(BASE + '/index.html#tarefas', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && window.PP_TAREFAS && window.PP_TAREFAS.lista().length > 0 && !document.querySelector('#view-tarefas')?.hidden, null, { timeout: 20000 });
  await pg.waitForTimeout(600);
  return { ctx, pg, erros, escritas, perfil: P };
}

/* conjunto de tarefas visíveis (ids) na tela atual, V2 ou V3 */
const idsVisiveis = (pg) => pg.evaluate(() => { const vis = (e) => { for (let x = e; x && x !== document; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || x.hidden) return false; } return e.getClientRects().length > 0; };
  document.querySelectorAll('#np-tree .np-g, #view-tarefas .np-grp').forEach(g => { if (g.dataset.aberto !== '1') g.querySelector('.np-gh, .np-grp-h')?.click(); });
  const v3 = [...document.querySelectorAll('#view-tarefas .np-it[data-id]')].filter(vis).map(e => e.dataset.id);
  if (v3.length) return v3.sort();
  const l = window.PP_TAREFAS.lista(); return [...document.querySelectorAll('#view-tarefas .card.list .row')].filter(vis).map(r => { const tit = r.querySelector('.n')?.textContent || ''; return l.find(t => tit.includes(t.titulo))?.id; }).filter(Boolean).sort(); });

(async () => {
  const srv = await servir(); const b = await chromium.launch(); const rel = []; let falhas = 0;
  const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { rel.push('  FALHA ' + m); falhas++; }; const obs = (m) => rel.push('  obs   ' + m);
  // ---------- 1. paridade de dados V2 × V3.1 por perfil e filtro ----------
  rel.push('1. paridade de dados V2 × V3.1 (mesmo T.f ⇒ mesmas tarefas)');
  const FILTROS = [{ status: 'abertas' }, { status: 'todas' }, { status: 'concluida' }, { status: 'cancelada' }, { status: 'aberta' }, { status: 'em_andamento' }, { status: 'abertas', fatais: true }, { status: 'abertas', nucleo: 'acordos' }, { status: 'todas', cliente: 'c1' }, { status: 'abertas', resp: 'col-caio' }, { status: 'abertas', resp: 'col-ana', nucleo: 'administrativo' }];
  for (const perfil of ['admin', 'juridico']) {
    const res = {};
    for (const casca of ['v2', 'v3']) { const { ctx, pg, erros } = await contexto(b, { perfil, casca }); res[casca] = {};
      for (const f of FILTROS) { await pg.evaluate((f) => { window.PP_TAREFAS.filtro(f); }, f); await pg.waitForTimeout(80); res[casca][JSON.stringify(f)] = await idsVisiveis(pg); }
      res[casca].erros = erros; await ctx.close(); }
    const dif = FILTROS.map(f => JSON.stringify(f)).filter(k => JSON.stringify(res.v2[k]) !== JSON.stringify(res.v3[k]));
    const tot = FILTROS.map(f => res.v3[JSON.stringify(f)].length);
    if (!dif.length) ok(`${perfil}: ${FILTROS.length} combinações de filtro com conjuntos idênticos (tamanhos ${tot.join('/')})`); else falha(`${perfil}: conjuntos diferentes em ` + dif.map(k => `${k}: V2=${res.v2[k].length} V3=${res.v3[k].length}`).join('; '));
    if (!res.v2.erros.length && !res.v3.erros.length) ok(`${perfil}: sem erros de página (V2 e V3.1)`); else falha(`${perfil}: erros ` + JSON.stringify({ v2: res.v2.erros, v3: res.v3.erros }));
  }
  // ---------- 2. resumo, prazos exatos+relativos, marcas, régua ----------
  rel.push('2. toolbar, prazos e marcas (admin, 1440)');
  { const { ctx, pg, erros, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const r = await pg.evaluate(() => { const L = window.PP_TAREFAS.lista(); const ab = L.filter(t => t.status === 'aberta' || t.status === 'em_andamento'); const n = k => ab.filter(t => t.faixa === k).length; const fat = ab.filter(t => t.prazo_fatal && ['atrasada', 'hoje', 'd7'].includes(t.faixa)).length;
      const res = [...document.querySelectorAll('#view-tarefas .np-resumo span')].map(s => s.textContent.trim()); return { res, esperado: [`${fat} fatais em 7 dias`, `${n('atrasada')} atrasadas`, `${n('hoje')} hoje`, `${n('d7')} até 7 dias`, `${ab.length} abertas`], head: !!document.querySelector('#view-tarefas .head'), kpis: !!document.querySelector('#view-tarefas .kpis'), toolbarH: document.querySelector('#view-tarefas .np-toolbar').getBoundingClientRect().height }; });
    if (JSON.stringify(r.res) === JSON.stringify(r.esperado) && !r.head && !r.kpis) ok(`resumo em serifa = contagens dos KPIs da V2 (${r.res.join(' · ')}); sem .head/.kpis`); else falha('resumo: ' + JSON.stringify(r));
    if (r.toolbarH <= 46) ok(`toolbar em uma linha em 1440 (${Math.round(r.toolbarH)} px)`); else falha('toolbar com mais de uma linha em 1440: ' + Math.round(r.toolbarH) + ' px');
    const pz = await pg.evaluate(() => { const L = window.PP_TAREFAS.lista(); const fatal = L.find(t => t.prazo_fatal && t.faixa === 'atrasada'); const li = document.querySelector(`.np-it[data-id="${fatal.id}"]`); const hojeT = L.find(t => t.faixa === 'hoje' && t.hora); const li2 = document.querySelector(`.np-it[data-id="${hojeT.id}"]`);
      return { fatal: { regua: getComputedStyle(li, '::before').backgroundColor, cls: li.className, data: li.querySelector('.np-it-prazo .d').textContent, hora: li.querySelector('.np-it-prazo .h')?.textContent, title: li.querySelector('.np-it-prazo').title, rel: li.querySelector('.ctx .rel')?.textContent, marcas: [...li.querySelectorAll('.np-marca')].map(m => m.textContent), quem: li.querySelector('.np-quem span')?.textContent, prazoIso: fatal.prazo, horaIso: fatal.hora }, hoje: { cls: li2.className, data: li2.querySelector('.np-it-prazo .d').textContent, hora: li2.querySelector('.np-it-prazo .h')?.textContent, rel: li2.querySelector('.ctx .rel')?.textContent } }; });
    const d = new Date(pz.fatal.prazoIso + 'T00:00:00'); const esperadoCurta = `${d.getDate()} ${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][d.getMonth()]}`;
    const okF = pz.fatal.cls.includes('r-fatal') && pz.fatal.data.startsWith(esperadoCurta) && pz.fatal.hora === '23h59' && /\d{2}\/\d{2}\/\d{4} às 23:59 · há 3 dias/.test(pz.fatal.title) && pz.fatal.rel === 'há 3 dias' && pz.fatal.marcas.includes('fatal') && pz.fatal.marcas.includes('alta') && pz.fatal.quem === 'Caio';
    if (okF) ok(`fatal atrasada: régua vermelha cheia, data exata "${pz.fatal.data} ${pz.fatal.hora}" + título "${pz.fatal.title}", relativo "${pz.fatal.rel}", marcas ${pz.fatal.marcas.join('/')}, responsável "${pz.fatal.quem}"`); else falha('linha fatal: ' + JSON.stringify(pz.fatal));
    if (pz.hoje.cls.includes('r-att') && pz.hoje.hora === '14h00' && pz.hoje.rel === 'hoje') ok(`vence hoje: régua âmbar, hora exata ${pz.hoje.hora}, relativo "${pz.hoje.rel}"`); else falha('linha hoje: ' + JSON.stringify(pz.hoje));
    const grp = await pg.evaluate(() => [...document.querySelectorAll('#view-tarefas .np-grp')].map(g => ({ g: g.dataset.g, t: g.querySelector('.t').textContent, n: g.querySelector('.n').textContent, tom: g.className.replace('np-grp', '').trim(), aberto: g.dataset.aberto, inert: g.querySelector('.np-grp-c').hasAttribute('inert') })));
    const ordem = grp.map(g => g.g).join(',');
    if (/^atrasada,hoje,d7,d15,d30,depois,sem_prazo$/.test(ordem) && grp[0].tom === 'crit' && grp[1].tom === 'att' && grp.every(g => g.aberto === '1' && !g.inert)) ok(`grupos na ordem das FAIXAS da V2 (${grp.map(g => g.t + ' ' + g.n).join(' · ')}), tons crítico/atenção`); else falha('grupos: ' + JSON.stringify(grp));
    if (!escritas.length) ok('nenhuma escrita no Supabase durante a renderização'); else falha('escritas: ' + escritas.join(' | '));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + erros.join(' | '));
    await pg.screenshot({ path: path.join(OUT, 'v3-light-1440-lista.png') });
    await ctx.close(); }
  // ---------- 3. paridade de ações (espiões): cada ação do painel chama a função da V2 ----------
  rel.push('3. paridade de ações no painel (espiões nas funções existentes; sem escrita real)');
  { const { ctx, pg, erros, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const t0 = await pg.evaluate(() => window.PP_TAREFAS.lista().find(t => t.cadeia_id && t.etapa_codigo === 'protocolar').id);
    await pg.click(`.np-it[data-id="${t0}"] .np-it-abrir`); await pg.waitForTimeout(700);
    const pa = await pg.evaluate(() => { const p = document.querySelector('#view-tarefas .np-painel'); const props = Object.fromEntries([...p.querySelectorAll('.np-props dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent.trim()])); return { hidden: p.hidden, inert: p.hasAttribute('inert'), modo: p.dataset.modo, titulo: p.querySelector('h2').textContent, trilha: p.querySelector('.np-trilha-p').textContent, props, secoes: [...p.querySelectorAll('.np-sec h3')].map(h => h.textContent), passos: p.querySelectorAll('.np-passos li').length, hist: p.querySelectorAll('.tl li').length, foco: document.activeElement.getAttribute('aria-label'), atual: document.querySelector('.np-it[aria-current="true"]')?.dataset.id, aberta: document.querySelector('.np-obra').classList.contains('np-aberta'), largura: document.querySelector('.np-painel').getBoundingClientRect().width, pe: [...p.querAll || p.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()), concluirDesab: p.querySelector('.np-p-pe .np-btn.pri')?.disabled }; });
    const okPa = !pa.hidden && !pa.inert && pa.modo === 'split' && /Protocolar embargos/.test(pa.titulo) && /Empresa Alfa/.test(pa.trilha) && /\d{2}\/\d{2}\/\d{4} às 23:59/.test(pa.props.Prazo) && /há 3 dias/.test(pa.props.Prazo) && /fatal/.test(pa.props.Prazo) && pa.props.Responsável.includes('Caio') && pa.secoes.includes('Cadeia do prazo') && pa.secoes.includes('Descrição') && pa.secoes.includes('Andamento') && pa.passos === 2 && pa.hist === 1 && pa.foco === 'Fechar (Esc)' && pa.atual === t0 && pa.aberta && Math.round(pa.largura) === 440 && pa.pe.includes('Concluir') && pa.pe.includes('Feito') && pa.pe.includes('Mais ações') && pa.concluirDesab === true;
    if (okPa) ok(`painel split 440 px: trilha, título, prazo exato + relativo + fatal, cadeia (${pa.passos} etapas), descrição, andamento, histórico (${pa.hist} evento), foco no Fechar, linha marcada aria-current, Concluir desabilitado até haver andamento`); else falha('painel: ' + JSON.stringify(pa));
    // Concluir libera ao digitar; liga aos mesmos fluxos: mudarStatus/comentar (espiões em SB.from('tarefas').update e insert tarefa_eventos)
    await pg.fill('#view-tarefas .np-painel textarea', 'Protocolado sob o nº 123.'); await pg.waitForTimeout(100);
    const lib = await pg.evaluate(() => !document.querySelector('.np-p-pe .np-btn.pri').disabled); if (lib) ok('Concluir libera ao escrever no andamento (regra da controladoria preservada)'); else falha('Concluir não liberou');
    const antes = escritas.length; await pg.click('.np-p-pe .np-btn.pri'); await pg.waitForTimeout(900);
    const esc = escritas.slice(antes);
    if (esc.some(e => /PATCH \/rest\/v1\/tarefas .*concluida/.test(e)) && esc.some(e => /POST \/rest\/v1\/tarefa_eventos .*comentario/.test(e))) ok('Concluir → mesma sequência da V2: PATCH tarefas{status:concluida} + POST tarefa_eventos{comentario} (interceptados, nada gravado)'); else falha('Concluir: escritas ' + JSON.stringify(esc));
    const feito = await pg.evaluate(() => ({ faixa: document.querySelector('.np-it-feita .np-feito')?.textContent, reabrir: !!document.querySelector('.np-it-feita .lnk'), painelFechado: document.querySelector('#view-tarefas .np-painel')?.hidden ?? true }));
    if (feito.faixa && /feita/.test(feito.faixa) && feito.reabrir) ok(`feedback no lugar (sobrevive ao recarregamento): "${feito.faixa.trim()}" com ação Reabrir (fluxo de reabertura existente, não "desfazer")`); else falha('faixa feita não observada: ' + JSON.stringify(feito));
    // Mais ações: itens e ligação com as funções da V2 (modal abre)
    await pg.waitForTimeout(500); const t1 = await pg.evaluate(() => window.PP_TAREFAS.lista().find(t => t.status === 'aberta' && !t.cadeia_id && t.cliente_id).id);
    await pg.click(`.np-it[data-id="${t1}"] .np-it-abrir`); await pg.waitForTimeout(500);
    await pg.click('.np-p-pe .np-btn.ghost'); await pg.waitForTimeout(250);
    const menu = await pg.evaluate(() => ({ role: document.querySelector('#np-pop')?.getAttribute('role'), itens: [...document.querySelectorAll('#np-pop [role="menuitem"]')].map(b => b.textContent.trim()), foco: document.activeElement.getAttribute('role') }));
    const esperados = ['Passar para…', 'Editar / reagendar…', 'Horas manuais…', 'Registrar no dossiê do cliente…', 'Abrir em janela'];
    if (menu.role === 'menu' && esperados.every(x => menu.itens.includes(x)) && menu.foco === 'menuitem') ok(`Mais ações (menu, foco no 1º item): ${menu.itens.join(' · ')}`); else falha('menu: ' + JSON.stringify(menu));
    await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
    const modal = await pg.evaluate(() => ({ modal: !!document.querySelector('#modalHost .modal'), titulo: document.querySelector('#modalHost h2')?.textContent })); if (modal.modal && /Editar|Tarefa/i.test(modal.titulo || '')) ok(`"Editar / reagendar…" abre o modal existente (${modal.titulo}) — reagendamento com motivo preservado`); else falha('editar: ' + JSON.stringify(modal));
    await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren()); await pg.waitForTimeout(200);
    await pg.click('.np-p-pe .np-btn.ghost'); await pg.waitForTimeout(200); await pg.click('#np-pop [role="menuitem"]:nth-child(1)'); await pg.waitForTimeout(400);
    const passar = await pg.evaluate(() => document.querySelector('#modalHost h2')?.textContent || ''); if (/Passar a tarefa/.test(passar)) ok('"Passar para…" abre passarPara() da V2'); else falha('passar: ' + passar); await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren());
    // check da linha: marcar abre o painel com foco no andamento; desmarcar de uma feita reabre (PATCH aberta)
    await pg.waitForTimeout(200); const tc = await pg.evaluate(() => window.PP_TAREFAS.lista().find(t => t.status === 'concluida').id);
    await pg.evaluate(() => { window.PP_TAREFAS.filtro({ status: 'todas' }); }); await pg.waitForTimeout(300);
    const antes2 = escritas.length; await pg.click(`.np-it[data-id="${tc}"] .np-check`); await pg.waitForTimeout(500);
    if (escritas.slice(antes2).some(e => /PATCH \/rest\/v1\/tarefas .*"status":"aberta"/.test(e))) ok('desmarcar uma feita → PATCH tarefas{status:aberta} (reabrir, como na V2)'); else falha('reabrir: ' + JSON.stringify(escritas.slice(antes2)));
    const ta = await pg.evaluate(() => window.PP_TAREFAS.lista().find(t => t.status === 'aberta' && t.faixa === 'd15').id);
    await pg.click(`.np-it[data-id="${ta}"] .np-check`); await pg.waitForTimeout(500);
    const chk = await pg.evaluate((id) => ({ foco: document.activeElement.tagName, noPainel: !!document.activeElement.closest('.np-painel'), checked: document.querySelector(`.np-it[data-id="${id}"] .np-check`).checked, titulo: document.querySelector('.np-painel h2').textContent }), ta);
    if (chk.foco === 'TEXTAREA' && chk.noPainel && !chk.checked) ok('marcar uma aberta → não conclui direto: abre o painel com foco no andamento (nota obrigatória, como na V2)'); else falha('check: ' + JSON.stringify(chk));
    // Nova tarefa e CSV existem
    const tb = await pg.evaluate(() => [...document.querySelectorAll('#view-tarefas .np-tb-dir button')].map(b => b.textContent.trim())); if (tb.includes('Nova tarefa') && tb.includes('CSV') && tb.includes('Lista') && tb.includes('Quadro')) ok(`toolbar: ${tb.join(' · ')}`); else falha('toolbar dir: ' + JSON.stringify(tb));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + erros.join(' | '));
    await ctx.close(); }
  // ---------- 4. filtros: chips = mesmo T.f; Mais filtros tem todos os seletores ----------
  rel.push('4. filtros (chips e "Mais filtros" alteram o mesmo estado da V2)');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const chips = await pg.evaluate(() => [...document.querySelectorAll('#view-tarefas .np-chipf')].map(c => c.textContent.replace(/\d+$/, '').trim()));
    if (['Abertas', 'Feitas', 'Todas', 'Fatais', 'Cadeias', 'Minhas', 'Mais filtros'].every(x => chips.includes(x))) ok(`chips: ${chips.join(' · ')}`); else falha('chips: ' + JSON.stringify(chips));
    await pg.click('#view-tarefas .np-chipf:has-text("Fatais")'); await pg.waitForTimeout(200);
    const f1 = await pg.evaluate(() => ({ f: window.PP_TAREFAS.filtroAtual(), n: document.querySelectorAll('#view-tarefas .np-it').length, esperado: window.PP_TAREFAS.lista().filter(t => (t.status === 'aberta' || t.status === 'em_andamento') && t.prazo_fatal).length }));
    if (f1.f.fatais === true && f1.n === f1.esperado) ok(`chip Fatais → T.f.fatais=true, ${f1.n} linhas (= filtro da V2)`); else falha('fatais: ' + JSON.stringify(f1));
    await pg.click('#view-tarefas .np-chipf:has-text("Fatais")'); await pg.click('#view-tarefas .np-chipf:has-text("Minhas")'); await pg.waitForTimeout(200);
    const f2 = await pg.evaluate(() => ({ resp: window.PP_TAREFAS.filtroAtual().resp, n: document.querySelectorAll('#view-tarefas .np-it').length }));
    if (f2.resp === 'col-ana' && f2.n === 4) ok('chip Minhas → T.f.resp = meu colaborador (4 tarefas abertas)'); else falha('minhas: ' + JSON.stringify(f2));
    await pg.click('#view-tarefas .np-chipf:has-text("Minhas")');
    await pg.click('#view-tarefas .np-chipf:has-text("Mais filtros")'); await pg.waitForTimeout(250);
    const mf = await pg.evaluate(() => ({ role: document.querySelector('#np-pop')?.getAttribute('role'), labels: [...document.querySelectorAll('#np-pop label')].map(l => l.textContent), statusOpts: [...document.querySelectorAll('#np-pop select')][0]?.options.length, focoDentro: !!document.activeElement.closest('#np-pop') }));
    if (mf.role === 'dialog' && ['Status', 'Responsável', 'Núcleo', 'Cliente'].every(x => mf.labels.includes(x)) && mf.statusOpts === 6 && mf.focoDentro) ok(`Mais filtros (dialog): ${mf.labels.join(', ')}; status com as 6 opções da V2`); else falha('mais filtros: ' + JSON.stringify(mf));
    await pg.selectOption('#np-pop select >> nth=0', 'em_andamento'); await pg.waitForTimeout(250);
    const f3 = await pg.evaluate(() => ({ st: window.PP_TAREFAS.filtroAtual().status, n: document.querySelectorAll('#view-tarefas .np-it').length, extras: document.querySelector('#view-tarefas .np-chipf:has(.n)[aria-pressed="true"]')?.textContent }));
    if (f3.st === 'em_andamento' && f3.n === 1) ok('status "Só fazendo" pelo popover → T.f.status=em_andamento, 1 linha'); else falha('status: ' + JSON.stringify(f3));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150); const pf = await pg.evaluate(() => ({ pop: !!document.querySelector('#np-pop'), foco: document.activeElement.textContent.trim().slice(0, 12) })); if (!pf.pop && /Mais filtros/.test(pf.foco)) ok('Esc fecha o popover e devolve o foco ao chip'); else falha('esc popover: ' + JSON.stringify(pf));
    await ctx.close(); }
  // ---------- 5. quadro ----------
  rel.push('5. quadro (4 colunas da V2, régua, mover por teclado)');
  { const { ctx, pg, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    await pg.click('#view-tarefas .np-seg button:has-text("Quadro")'); await pg.waitForTimeout(500);
    const q = await pg.evaluate(() => ({ cols: [...document.querySelectorAll('.np-colq h3 > span:first-child')].map(s => s.textContent), ns: [...document.querySelectorAll('.np-colq h3 .n')].map(s => +s.textContent), cards: document.querySelectorAll('.np-cardq').length, reguas: document.querySelectorAll('.np-cardq[class*="r-"]').length, por: document.querySelector('.np-colq h3 .por')?.textContent, vista: localStorage.getItem('np-tarefas-vista'), legado: localStorage.getItem('pp-tarefas-vista') }));
    const L = TAREFAS; const esperado = [L.filter(t => t.status === 'aberta').length, L.filter(t => t.status === 'em_andamento').length, 0, L.filter(t => t.status === 'concluida').length];
    if (JSON.stringify(q.cols) === JSON.stringify(['A fazer', 'Fazendo', 'Aguardando área', 'Feitas (7 dias)']) && JSON.stringify(q.ns) === JSON.stringify(esperado) && q.reguas >= 3 && q.vista === 'quadro' && q.legado === 'kanban') ok(`quadro: colunas ${q.cols.join(' · ')} com ${q.ns.join('/')} cartões (= regras da V2); ${q.reguas} cartões com régua; contagem por responsável "${q.por}"; preferência gravada (e a legada pp-tarefas-vista=kanban)`); else falha('quadro: ' + JSON.stringify({ q, esperado }));
    await pg.click('.np-colq[data-st="aberta"] .np-cardq .np-ib'); await pg.waitForTimeout(250);
    const mv = await pg.evaluate(() => [...document.querySelectorAll('#np-pop [role="menuitem"]')].map(b => b.textContent.trim() + (b.disabled ? ' (desab.)' : '') + (b.classList.contains('atual') ? ' (atual)' : '')));
    if (mv.length === 4 && /A fazer \(atual\)/.test(mv[0]) && /Aguardando área \(desab\.\)/.test(mv[2])) ok(`"Mover para…" por teclado/popover: ${mv.join(' · ')}`); else falha('mover: ' + JSON.stringify(mv));
    const antes = escritas.length; await pg.click('#np-pop [role="menuitem"]:nth-child(2)'); await pg.waitForTimeout(600);
    if (escritas.slice(antes).some(e => /PATCH \/rest\/v1\/tarefas .*em_andamento/.test(e))) ok('mover para Fazendo → PATCH tarefas{status:em_andamento} (mesma regra do drop da V2)'); else falha('mover: ' + JSON.stringify(escritas.slice(antes)));
    await pg.screenshot({ path: path.join(OUT, 'v3-light-1440-quadro.png') });
    await ctx.close(); }
  // ---------- 6. permissões e readOnly ----------
  rel.push('6. permissões (escopo restrito) e modo só leitura');
  { const { ctx, pg } = await contexto(b, { perfil: 'juridico', casca: 'v3' });
    const r = await pg.evaluate(() => { const esc = PP.escopoTarefas?.() || { tudo: true }; const chips = [...document.querySelectorAll('#view-tarefas .np-chipf')].map(c => c.textContent.replace(/\d+$/, '').trim()); const ids = [...document.querySelectorAll('.np-it[data-id]')].map(e => e.dataset.id); const L = window.PP_TAREFAS.lista(); const foraEscopo = ids.filter(id => { const t = L.find(x => x.id === id); return t.responsavel_id !== 'col-caio' && t.created_by !== 'u-jur' && !(esc.nucleos || []).includes(t.nucleo); }); return { esc, chips, n: ids.length, foraEscopo, nota: document.querySelector('#view-tarefas .np-filtros .np-rodape')?.textContent || '' }; });
    if (!r.esc.tudo && r.foraEscopo.length === 0 && r.n > 0) ok(`colaborador Jurídico: ${r.n} tarefas, todas dentro de escopoOk (${JSON.stringify(r.esc)})`); else falha('escopo: ' + JSON.stringify(r));
    await ctx.close();
    const c2 = await contexto(b, { perfil: 'admin', casca: 'v3' }); await c2.pg.evaluate(() => { S.canWrite = false; render(); }); await c2.pg.waitForTimeout(300);
    const ro = await c2.pg.evaluate(() => ({ checks: document.querySelectorAll('#view-tarefas .np-check').length, nova: !!document.querySelector('#view-tarefas .np-tb-dir .np-btn.pri'), drag: document.querySelector('.np-cardq')?.getAttribute('draggable') }));
    await c2.pg.click('#view-tarefas .np-it .np-it-abrir'); await c2.pg.waitForTimeout(400);
    const roP = await c2.pg.evaluate(() => [...document.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()));
    if (ro.checks === 0 && !ro.nova && !roP.includes('Concluir') && !roP.includes('Feito') && roP.includes('Mais ações')) ok(`só leitura (readOnly): sem checks, sem Nova tarefa, painel sem Concluir/Feito (${roP.join(' · ')})`); else falha('readOnly: ' + JSON.stringify({ ro, roP }));
    await c2.ctx.close(); }
  // ---------- 7. teclado, ARIA, atalhos não disparam em campos ----------
  rel.push('7. teclado e ARIA');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const a = await pg.evaluate(() => ({ listas: document.querySelectorAll('#view-tarefas ul.np-lst[role="list"]').length, li: document.querySelectorAll('#view-tarefas li.np-it').length, tab: document.querySelectorAll('#view-tarefas [role="tab"],#view-tarefas [role="tablist"]').length, pressed: [...document.querySelectorAll('.np-chipf')].every(c => /^(true|false)$/.test(c.getAttribute('aria-pressed'))), grp: [...document.querySelectorAll('.np-grp-h')].every(h => /^(true|false)$/.test(h.getAttribute('aria-expanded')) && document.getElementById(h.getAttribute('aria-controls'))), checksLabel: [...document.querySelectorAll('.np-check')].every(c => c.getAttribute('aria-label')), painelLabel: document.querySelector('.np-painel').getAttribute('aria-label'), status: document.querySelector('.np-resumo').getAttribute('role') }));
    if (a.listas >= 5 && a.li > 10 && a.tab === 0 && a.pressed && a.grp && a.checksLabel && a.painelLabel && a.status === 'status') ok(`ARIA: ${a.listas} listas com ${a.li} itens, chips aria-pressed, grupos aria-expanded/controls, checks rotulados, painel rotulado, resumo role=status; sem tab/tablist`); else falha('aria: ' + JSON.stringify(a));
    // Enter abre; Esc fecha e devolve o foco; "c" só fora de campos
    await pg.focus('.np-it[data-id] .np-it-abrir'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
    const k1 = await pg.evaluate(() => ({ aberto: !document.querySelector('.np-painel').hidden, foco: document.activeElement.getAttribute('aria-label') }));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
    const k2 = await pg.evaluate(() => ({ fechado: document.querySelector('.np-painel').hidden, foco: document.activeElement.className }));
    if (k1.aberto && k1.foco === 'Fechar (Esc)' && k2.fechado && /np-it-abrir/.test(k2.foco)) ok('Enter abre o painel (foco no Fechar); Esc fecha e devolve o foco à linha'); else falha('teclado painel: ' + JSON.stringify({ k1, k2 }));
    await pg.focus('.np-it[data-id] .np-it-abrir'); await pg.keyboard.press('c'); await pg.waitForTimeout(400);
    const k3 = await pg.evaluate(() => ({ aberto: !document.querySelector('.np-painel').hidden, foco: document.activeElement.tagName })); if (k3.aberto && k3.foco === 'TEXTAREA') ok('"c" na linha focada abre o painel com foco no andamento (concluir com nota)'); else falha('atalho c: ' + JSON.stringify(k3));
    await pg.keyboard.type('c'); const k4 = await pg.evaluate(() => ({ v: document.querySelector('.np-painel textarea').value, painel1: document.querySelectorAll('.np-painel').length })); if (k4.v === 'c' && k4.painel1 === 1) ok('digitar "c" dentro do campo escreve no campo (atalho não dispara em formulários)'); else falha('atalho em campo: ' + JSON.stringify(k4));
    await pg.keyboard.press('Escape');
    // foco visível e Tab order dentro da toolbar
    await pg.focus('#view-tarefas .np-chipf'); const anel = await pg.evaluate(() => getComputedStyle(document.activeElement).boxShadow !== 'none'); if (anel) ok('anel de foco visível nos chips'); else falha('sem anel de foco');
    await ctx.close(); }
  // ---------- 8. contraste e toque ----------
  rel.push('8. contraste (≥ 4,5:1) e alvos de toque (≥ 44 px)');
  const lum = (c) => { const m = c.match(/-?\d*\.?\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const tema of ['light', 'dark']) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', tema });
    await pg.click('.np-it[data-id] .np-it-abrir'); await pg.waitForTimeout(500);
    const pares = await pg.evaluate(() => { const rgb = (c) => { const n = c.match(/-?\d*\.?\d+/g).map(Number); if (/^color\(srgb/.test(c)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 }; return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; }; const fundo = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!c || c === 'transparent') continue; const k = rgb(c); if (k.a >= 0.99) return `rgb(${Math.round(k.r)}, ${Math.round(k.g)}, ${Math.round(k.b)})`; } return getComputedStyle(document.body).backgroundColor; }; const cor = (sel, nome) => { const e = document.querySelector(sel); if (!e) return null; return { nome, fg: getComputedStyle(e).color, bg: fundo(e), px: parseFloat(getComputedStyle(e).fontSize) }; };
      return [cor('.np-resumo b', 'número do resumo'), cor('.np-resumo span', 'rótulo do resumo'), cor('.np-chipf[aria-pressed="true"]', 'chip ativo'), cor('.np-chipf[aria-pressed="false"]', 'chip inativo'), cor('.np-chipf .n', 'contagem do chip'), cor('.np-grp-h .t', 'cabeça de grupo'), cor('.np-grp.crit .np-grp-h .t', 'cabeça Atrasadas'), cor('.np-grp-h .n', 'contagem do grupo'), cor('.np-it-prazo .d', 'prazo'), cor('.np-it-prazo.crit .d', 'prazo fatal'), cor('.np-it-prazo .h', 'hora'), cor('.np-it-abrir .tx', 'título da linha'), cor('.np-it-abrir .ctx', 'contexto da linha'), cor('.ctx .rel', 'relativo do prazo'), cor('.ctx .rel.crit', 'relativo crítico'), cor('.np-marca.crit', 'marca fatal'), cor('.np-marca.info', 'marca fazendo'), cor('.np-quem span', 'responsável'), cor('.np-quem b', 'iniciais'), cor('.np-rodape', 'rodapé'), cor('.np-painel h2', 'título do painel'), cor('.np-props dt', 'rótulo de prop'), cor('.np-props dd', 'valor de prop'), cor('.np-sec h3', 'título de seção'), cor('.np-trilha-p', 'trilha do painel'), cor('.np-btn.pri', 'botão primário'), cor('.np-btn.ghost', 'botão fantasma'), cor('.np-passos li small', 'sub dos passos')].filter(Boolean); });
    const hex2rgb = (h) => /^#/.test(h) ? 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')' : h;
    const ruins = pares.map(p => ({ ...p, r: razao(hex2rgb(p.fg), hex2rgb(p.bg)) })).filter(p => p.r < 4.5);
    if (!ruins.length) ok(`${tema}: ${pares.length} pares de texto ≥ 4,5:1 (mínimo ${Math.min(...pares.map(p => razao(hex2rgb(p.fg), hex2rgb(p.bg)))).toFixed(2)})`); else falha(`${tema}: contraste insuficiente: ` + ruins.map(p => `${p.nome} ${p.r.toFixed(2)}:1 (${p.fg} sobre ${p.bg})`).join('; '));
    await pg.screenshot({ path: path.join(OUT, `v3-${tema}-1440-painel.png`) }); await ctx.close(); }
  for (const [w, h, rotulo] of [[375, 812, 'celular'], [1024, 768, 'tablet']]) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w, h, touch: true });
    const alvos = await pg.evaluate(() => { const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; return [...document.querySelectorAll('#view-tarefas button, #view-tarefas input, #view-tarefas .np-it')].filter(vis).map(e => { const r = e.getBoundingClientRect(); const chk = e.matches('.np-check') ? e.parentElement.getBoundingClientRect() : r; return { nome: e.className.split(' ')[0] + ':' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 14), w: Math.round(chk.width), h: Math.round(chk.height), icone: e.matches('.np-ib,.np-check') }; }); });
    const pequenos = alvos.filter(a => a.h < 44 || (a.icone && a.w < 44)); const sx = await pg.evaluate(() => document.documentElement.scrollWidth);
    if (!pequenos.length && sx <= w) ok(`${rotulo} ${w}px: ${alvos.length} alvos ≥ 44 px; sem rolagem horizontal (${sx}px)`); else falha(`${rotulo} ${w}px: alvos < 44: ` + pequenos.map(a => `${a.nome} ${a.w}×${a.h}`).join(', ') + ` sx=${sx}`);
    await pg.click('.np-it[data-id] .np-it-abrir'); await pg.waitForTimeout(500);
    const pm = await pg.evaluate(() => ({ modo: document.querySelector('.np-painel').dataset.modo, role: document.querySelector('.np-painel').getAttribute('role'), modal: document.querySelector('.np-painel').getAttribute('aria-modal'), w: Math.round(document.querySelector('.np-painel').getBoundingClientRect().width) }));
    if ((w === 375 && pm.modo === 'cheia' && pm.role === 'dialog' && pm.modal === 'true' && pm.w === 375) || (w === 1024 && pm.modo === 'overlay' && pm.w <= 480)) ok(`${rotulo}: painel em modo ${pm.modo} (${pm.w}px${pm.role ? ', role=dialog aria-modal' : ''})`); else falha(`${rotulo} painel: ` + JSON.stringify(pm));
    await pg.screenshot({ path: path.join(OUT, `v3-light-${w}-painel.png`) }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, `v3-light-${w}-lista.png`) }); await ctx.close(); }
  // ---------- 9. persistência e V2 intacta ----------
  rel.push('9. persistência (grupos, vista) e V2 intacta sem a chave');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    await pg.click('.np-grp[data-g="d15"] .np-grp-h'); await pg.waitForTimeout(200); await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => window.PP_TAREFAS && document.querySelector('#view-tarefas .np-grp'), null, { timeout: 20000 }); await pg.waitForTimeout(400);
    const p = await pg.evaluate(() => ({ d15: document.querySelector('.np-grp[data-g="d15"]').dataset.aberto, inert: document.querySelector('.np-grp[data-g="d15"] .np-grp-c').hasAttribute('inert'), ls: localStorage.getItem('np-tarefas-grupos') }));
    if (p.d15 === '0' && p.inert && /d15/.test(p.ls)) ok('grupo recolhido persiste após recarregar (np-tarefas-grupos) e fica inert'); else falha('persistência grupos: ' + JSON.stringify(p));
    await ctx.close();
    const c2 = await contexto(b, { perfil: 'admin', casca: 'v2' });
    const v2 = await c2.pg.evaluate(() => ({ head: !!document.querySelector('#view-tarefas .head'), kpis: document.querySelectorAll('#view-tarefas .kpis .kpi').length, np: document.querySelectorAll('#view-tarefas [class^="np-"]').length, rows: document.querySelectorAll('#view-tarefas .card.list .row').length }));
    if (v2.head && v2.kpis === 6 && v2.np === 0 && v2.rows > 0) ok(`sem a chave: V2 intacta (.head, 6 KPIs, ${v2.rows} linhas, 0 elementos np-*)`); else falha('V2: ' + JSON.stringify(v2));
    await c2.pg.screenshot({ path: path.join(OUT, 'v2-light-1440-lista.png') }); await c2.ctx.close();
    for (const w of [375, 1024]) { const c3 = await contexto(b, { perfil: 'admin', casca: 'v2', w, h: w === 375 ? 812 : 768 }); await c3.pg.screenshot({ path: path.join(OUT, `v2-light-${w}-lista.png`) }); await c3.ctx.close(); }
    const c4 = await contexto(b, { perfil: 'admin', casca: 'v3', reduz: true }); const rm = await c4.pg.evaluate(() => getComputedStyle(document.querySelector('.np-grp-c')).transitionDuration); if (parseFloat(rm) < 0.01) ok('prefers-reduced-motion: grupos sem transição (' + rm + ')'); else falha('reduced motion: ' + rm); await c4.ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); console.log(txt); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
