/* Laboratório da visão transversal Acompanhamento PJ em V3.1 (Fase 3). Playwright + Chromium locais; repositório servido por
   HTTP efêmero e TODA chamada a *.supabase.co interceptada com fixtures fictícias — nada sai da máquina, nada é escrito.
   Uso: NODE_PATH=<módulos> node docs/qa/acompanhamento-lab.cjs [pasta de saída]  (padrão /tmp/acompanhamento-lab)
   Verifica: rota e permissões (hash direto, perfil sem Clientes, V2, só leitura), item de menu só na V3.1, grupos por reunião
   (vencida / esta semana / próximas / sem agendamento / não iniciado / encerrados) e resumo, marcas e etapa, painel com os
   dados reais (ciclo, Raio-X, pendências, atas, reserva planejada × acumulada), formulários com o cliente explícito e troca
   de cliente sem vazar gravações, filtros, ARIA/teclado, capturas, aba da ficha intacta, ambiente sem a migração 0104. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http'); const { medirContraste, medirAlvos } = require(path.join(process.cwd(), 'docs/qa/_a11y.cjs')); // cwd = raiz do repositório (como RAIZ)
const RAIZ = process.cwd(); const OUT = process.argv[2] || '/tmp/acompanhamento-lab'; fs.mkdirSync(OUT, { recursive: true });
const REF = 'ksdwzljfjfucjevdqxvx';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
let BASE = '';
const servir = () => new Promise((res) => { const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); srv.listen(0, '127.0.0.1', () => { BASE = `http://127.0.0.1:${srv.address().port}`; res(srv); }); });

/* ---------- fixtures fictícias ---------- */
const hoje = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (n) => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n); return iso(d); };
const COLAB = [{ id: 'col-ana', perfil_id: 'u-admin', nome: 'Ana Teste', frente: 'estrategico', nucleo: 'socios', ativo: true }, { id: 'col-luc', perfil_id: 'u-luc', nome: 'Lucas Teste', frente: 'estrategico', nucleo: 'acompanhamento_pj', ativo: true }, { id: 'col-caio', perfil_id: 'u-jur', nome: 'Caio Teste', frente: null, nucleo: 'juridico', ativo: true }];
const cli = (id, nome, o = {}) => ({ id, nome, cnpj: '00.000.000/0001-0' + id.slice(1), status: 'ativo', segmento: o.seg || 'Indústria', cidade: o.cid || 'Franca/SP', pasta_drive_url: 'https://drive.example/' + id, resp_estrategico_id: o.resp || null, direcionamento: o.dir || null, direcionamento_em: o.dir ? dia(-20) : null, projeto_reserva: o.res || null, reservaAcumulada: o.acum || 0, regua: o.regua || null, data_onboarding: o.onb || null, created_at: '2026-01-10', ...(o.extra || {}) });
const CLIENTES = [
  cli('c1', 'Empresa Alfa Ltda', { resp: 'col-ana', dir: 'ambos', res: 'formada', acum: 180000, regua: 'ouro', onb: dia(-33), seg: 'Metalurgia' }),
  cli('c2', 'Beta Comércio ME', { resp: 'col-luc', seg: 'Varejo', cid: 'Batatais/SP', onb: dia(2) }),
  cli('c3', 'Gama Indústria SA', { resp: 'col-ana', dir: 'acordos', res: 'em_construcao', regua: 'prata', onb: dia(-120) }),
  cli('c4', 'Delta Transportes', { resp: 'col-luc', res: 'apresentado', regua: 'bronze', onb: dia(-90), seg: 'Logística' }),
  cli('c5', 'Épsilon Alimentos', { resp: 'col-luc', dir: 'acordos', res: 'formada', acum: 60000, regua: 'prata', onb: dia(-200) }),
  cli('c6', 'Zeta Serviços', { seg: 'Serviços' }),
  cli('c7', 'Eta Construções', { resp: 'col-ana', onb: dia(-300), extra: { status: 'encerrado' } }),
  cli('c8', 'Theta Agro', { resp: 'col-luc', dir: 'juridico', onb: dia(-10), seg: 'Agro', cid: 'Ituverava/SP' }),
];
const acomp = (cid, o) => ({ cliente_id: cid, fase: o.fase, onb_data: o.onb ?? null, onb_feita: !!o.onbF, r1_data: o.r1 ?? null, r1_feita: !!o.r1F, r2_data: o.r2 ?? null, r2_feita: !!o.r2F, r3_data: o.r3 ?? null, r3_feita: !!o.r3F, proxima_reuniao: o.prox ?? null, acordos_liberado: !!o.lib, acordos_liberado_em: o.lib ? dia(-15) + 'T12:00:00Z' : null, observacoes: o.obs || null, updated_at: '2026-11-01T12:00:00Z' });
const ACOMP = [
  acomp('c1', { fase: 'ciclo', onb: dia(-33), onbF: true, r1: dia(-18), r1F: true, r2: dia(-3), r3: dia(12), lib: true, obs: 'Cliente quer discutir a gestora na R2.' }),
  acomp('c2', { fase: 'onboarding', onb: dia(2) }),
  acomp('c3', { fase: 'mensal', onb: dia(-120), onbF: true, r1: dia(-105), r1F: true, r2: dia(-90), r2F: true, r3: dia(-75), r3F: true, prox: dia(10), lib: true }),
  acomp('c4', { fase: 'mensal', onb: dia(-90), onbF: true, r1: dia(-75), r1F: true, r2: dia(-60), r2F: true, r3: dia(-45), r3F: true, prox: null, lib: true }),
  acomp('c5', { fase: 'mensal', onb: dia(-200), onbF: true, r1: dia(-185), r1F: true, r2: dia(-170), r2F: true, r3: dia(-155), r3F: true, prox: dia(-8), lib: true }),
  acomp('c7', { fase: 'encerrado', onb: dia(-300), onbF: true, r1: dia(-285), r1F: true, r2: dia(-270), r2F: true, r3: dia(-255), r3F: true, lib: true }),
  acomp('c8', { fase: 'ciclo', onb: dia(-10), onbF: true, r1: dia(5), r2: dia(20), r3: dia(35) }),
];
const etapaAtual = (a) => !a || !a.onb_feita ? 'onb' : !a.r1_feita ? 'r1' : !a.r2_feita ? 'r2' : !a.r3_feita ? 'r3' : 'mensal';
const DIVIDAS = { c1: [{ id: 'd1', cliente_id: 'c1', banco: 'Santander', tipo: 'Capital de giro', valor: 480000, atraso_meses: 4, avalista: true, avalista_nome: 'Sócio A', garantia: false, ordem: 1 }, { id: 'd2', cliente_id: 'c1', banco: 'Itaú', tipo: 'Conta garantida', valor: 150000, atraso_meses: 0, avalista: false, garantia: true, garantia_descricao: 'Imóvel sede', ordem: 2 }], c3: [{ id: 'd3', cliente_id: 'c3', banco: 'Banco do Brasil', tipo: 'Capital de giro', valor: 800000, atraso_meses: 7, avalista: true, avalista_nome: 'Sócio G', garantia: false, ordem: 1 }] };
const ATAS = { c1: [{ id: 'a1', cliente_id: 'c1', tipo: 'r1', data: dia(-18), titulo: 'R1 — conexão', resumo: 'Mapeamos as dívidas e combinamos a reserva.', link_pasta: 'https://drive.example/c1/r1', autor_id: 'col-ana' }, { id: 'a2', cliente_id: 'c1', tipo: 'onb', data: dia(-33), resumo: 'Onboarding realizado.', autor_id: 'col-luc' }], c3: [{ id: 'a3', cliente_id: 'c3', tipo: 'mensal', data: dia(-20), resumo: 'Mensal de outubro.', autor_id: 'col-ana' }] };
const TAREFAS = [
  { id: 't1', cliente_id: 'c1', titulo: 'R2 — Empresa Alfa Ltda', prazo: dia(-3), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_nome: 'Ana Teste' },
  { id: 't2', cliente_id: 'c1', titulo: 'Follow-up (7 dias) — Empresa Alfa Ltda', prazo: dia(4), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_nome: 'Ana Teste' },
  { id: 't3', cliente_id: 'c3', titulo: 'Reunião mensal — Gama', prazo: dia(10), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_nome: 'Ana Teste' },
  { id: 't9', cliente_id: 'c1', titulo: 'Protocolar embargos', prazo: dia(1), status: 'aberta', prazo_fatal: true, nucleo: 'juridico', responsavel_nome: 'Caio Teste' },
];
const VIEW = () => CLIENTES.map(c => { const a = ACOMP.find(x => x.cliente_id === c.id); return { cliente_id: c.id, fase: a?.fase ?? null, onb_data: a?.onb_data ?? null, onb_feita: a?.onb_feita ?? null, r1_data: a?.r1_data ?? null, r1_feita: a?.r1_feita ?? null, r2_data: a?.r2_data ?? null, r2_feita: a?.r2_feita ?? null, r3_data: a?.r3_data ?? null, r3_feita: a?.r3_feita ?? null, proxima_reuniao: a?.proxima_reuniao ?? null, acordos_liberado: a?.acordos_liberado ?? false, acordos_liberado_em: a?.acordos_liberado_em ?? null, etapa_atual: etapaAtual(a), dividas: (DIVIDAS[c.id] || []).length, atas: (ATAS[c.id] || []).length, ultima_ata: (ATAS[c.id] || [])[0]?.data ?? null, observacoes: a?.observacoes ?? null }; });
const PERFIS = { admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] }, lucas: { id: 'u-luc', nome: 'Lucas Teste', papel: 'colaborador', acessos: ['clientes', 'juridico'] }, juridico: { id: 'u-jur', nome: 'Caio Teste', papel: 'colaborador', acessos: ['juridico'] } };
const sessao = (perfil) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: perfil.id, email: perfil.id + '@lab', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });

async function contexto(b, { perfil = 'admin', casca = 'v3', w = 1440, h = 900, tema = 'light', hash = '#acompanhamento', esperar = true, sem0104 = false } = {}) {
  const P = PERFIS[perfil]; const s = sessao(P); const escritas = []; const erros = []; const leituras = [];
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: w < 900 });
  await ctx.addInitScript(({ s, ref, casca, tema }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)); if (casca === 'v3') localStorage.setItem('np-casca', 'v3'); localStorage.setItem('pp-tema', tema); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { s, ref: REF, casca, tema });
  await ctx.route(/supabase\.co/, async (rota) => {
    const req = rota.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method(); const unico = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (b, status = 200, extra = {}) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...extra }, body: JSON.stringify(b) });
    if (m === 'GET') leituras.push(p + u.search);
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !p.startsWith('/auth/')) { escritas.push(m + ' ' + p + u.search + ' ' + (req.postData() || '').slice(0, 300)); return json(m === 'POST' && /rpc/.test(p) ? null : (m === 'POST' ? [{ id: 'novo-' + Date.now() }] : []), m === 'POST' ? 201 : 200); }
    if (p.startsWith('/auth/v1/user')) return json(s.user); if (p.startsWith('/auth/v1/token')) return json(s); if (p.startsWith('/auth/v1/logout')) return json({}, 204);
    if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/rpc/')) return json(m === 'POST' ? [] : null);
    if (p.startsWith('/rest/v1/perfis')) return json(unico ? P : [P]);
    if (p.startsWith('/rest/v1/clientes')) return json(CLIENTES, 200, { 'content-range': `0-${CLIENTES.length - 1}/${CLIENTES.length}` });
    if (p.startsWith('/rest/v1/v_acompanhamento_pj')) return sem0104 ? json({ code: '42P01', message: 'relation "public.v_acompanhamento_pj" does not exist' }, 404) : json(VIEW());
    if (p.startsWith('/rest/v1/acompanhamento_pj')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); const a = ACOMP.find(x => x.cliente_id === cid) || null; return unico ? (a ? json(a) : json(null, 200)) : json(a ? [a] : []); }
    if (p.startsWith('/rest/v1/dividas_raio_x')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); return json(DIVIDAS[cid] || []); }
    if (p.startsWith('/rest/v1/atas_reuniao')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); return json(ATAS[cid] || []); }
    if (p.startsWith('/rest/v1/colaboradores')) { const pid = (u.searchParams.get('perfil_id') || '').replace('eq.', ''); const l = pid ? COLAB.filter(x => x.perfil_id === pid) : COLAB; if (unico) return l[0] ? json(l[0]) : json({ message: 'nenhum', code: 'PGRST116' }, 406); return json(l); }
    if (p.startsWith('/rest/v1/v_tarefas')) { const nuc = (u.searchParams.get('nucleo') || '').replace('eq.', ''); return json(nuc ? TAREFAS.filter(t => t.nucleo === nuc) : TAREFAS); }
    if (p.startsWith('/rest/v1/tarefas')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); return json(TAREFAS.filter(t => t.cliente_id === cid).map(t => ({ titulo: t.titulo }))); }
    if (p.startsWith('/rest/v1/v_negociacoes') || p.startsWith('/rest/v1/v_monitoramentos') || p.startsWith('/rest/v1/v_tickets') || p.startsWith('/rest/v1/processos') || p.startsWith('/rest/v1/bens')) return json([]);
    return unico ? json({ message: 'nenhum', code: 'PGRST116' }, 406) : json([]);
  });
  const pg = await ctx.newPage(); pg.on('pageerror', e => erros.push(e.message)); pg.on('console', msg => { if (msg.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(msg.text())) erros.push('console: ' + msg.text().slice(0, 160)); });
  await pg.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && (window.PP_ACOMP || (typeof PP.temAcesso === 'function' && !PP.temAcesso('acompanhamento'))) && (!PP.temAcesso('clientes') || (S.clientes && S.clientes.length > 0)), null, { timeout: 20000 });
  if (esperar) await pg.waitForFunction(() => !document.querySelector('#view-acompanhamento')?.hidden && document.querySelectorAll('#view-acompanhamento li.np-it').length > 0, null, { timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(500);
  return { ctx, pg, erros, escritas, leituras, perfil: P };
}
const ids = (pg) => pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento li.np-it[data-id]')].map(e => e.dataset.id).sort());
/* abre o painel de um cliente e espera os dados dele chegarem (sem esqueleto aria-busy) — no CI o carregamento é mais lento que um tempo fixo */
const abrirPainel = async (pg, id) => { await pg.click(`li.np-it[data-id="${id}"] .np-it-abrir`); await pg.waitForFunction(() => { const P = document.querySelector('.np-painel'); return P && !P.hidden && !P.querySelector('[aria-busy="true"]'); }, null, { timeout: 15000 }); await pg.waitForTimeout(250); };
const grupos = (pg) => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#view-acompanhamento .np-grp')].map(g => [g.dataset.g, [...g.querySelectorAll('li.np-it')].map(l => l.dataset.id)])));
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ---------- 1. rota, permissões e menu ----------
  rel.push('1. rota #acompanhamento: permissões e menu');
  { // admin + casca V3.1: tela abre pelo hash; item de menu sob Clientes com aria-current
    const { ctx, pg, erros, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const r = await pg.evaluate(() => ({ tab: S.tab, vis: !document.querySelector('#view-acompanhamento').hidden, item: !!document.querySelector('#np-tree .tab[data-tab="acompanhamento"]'), filho: document.querySelector('#np-tree .tab[data-tab="acompanhamento"]')?.classList.contains('np-filho'), atual: document.querySelector('#np-tree .tab[data-tab="acompanhamento"]')?.getAttribute('aria-current'), depoisDe: (() => { const t = [...document.querySelectorAll('#np-tree .np-top')].map(b => b.dataset.tab); return t.indexOf('acompanhamento') === t.indexOf('clientes') + 1; })(), titulo: document.querySelector('.np-crumb h1, .top h1, #np-brand')?.textContent || '' }));
    if (r.tab === 'acompanhamento' && r.vis && r.item && r.filho && r.atual === 'page' && r.depoisDe && erros.length === 0 && escritas.length === 0) ok('admin (V3.1): #acompanhamento abre a visão transversal; item "Acompanhamento PJ" logo abaixo de Clientes na árvore, marcado como atual; nenhuma escrita'); else falha('rota admin: ' + JSON.stringify({ r, erros, escritas }));
    await ctx.close(); }
  { // colaborador com acesso a Clientes (Lucas): abre
    const { ctx, pg } = await contexto(b, { perfil: 'lucas', casca: 'v3' }); const r = await pg.evaluate(() => ({ tab: S.tab, n: document.querySelectorAll('#view-acompanhamento li.np-it').length }));
    if (r.tab === 'acompanhamento' && r.n > 0) ok(`colaborador com acesso a Clientes: abre (${r.n} clientes)`); else falha('lucas: ' + JSON.stringify(r)); await ctx.close(); }
  { // colaborador SEM acesso a Clientes (Jurídico): hash direto não abre; vai para Hoje; nenhuma leitura da view
    const { ctx, pg, leituras } = await contexto(b, { perfil: 'juridico', casca: 'v3', esperar: false }); await pg.waitForTimeout(800);
    const r = await pg.evaluate(() => ({ tab: S.tab, vis: !document.querySelector('#view-acompanhamento').hidden, item: (() => { const e = document.querySelector('#np-tree .tab[data-tab="acompanhamento"]'); return !!e && e.offsetParent !== null; })(), conteudo: document.querySelector('#view-acompanhamento').children.length }));
    if (r.tab !== 'acompanhamento' && !r.vis && !r.item && r.conteudo === 0 && !leituras.some(l => /v_acompanhamento_pj/.test(l))) ok(`perfil sem acesso a Clientes: hash direto é recusado (vai para "${r.tab}"), sem item no menu, sem leitura de v_acompanhamento_pj`); else falha('juridico: ' + JSON.stringify({ r, leituras: leituras.filter(l => /acomp/.test(l)) })); await ctx.close(); }
  { // V2 (sem a chave): rota não existe na prática; menu V2 sem o item
    const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v2', esperar: false }); await pg.waitForTimeout(800);
    const r = await pg.evaluate(() => ({ tab: S.tab, vis: !document.querySelector('#view-acompanhamento').hidden, itemVis: (() => { const e = document.querySelector('#nav .tab[data-tab="acompanhamento"]'); return !!e && e.offsetParent !== null; })(), aba: true }));
    if (r.tab === 'clientes' && !r.vis && !r.itemVis) ok('V2 (sem a chave): #acompanhamento volta para Clientes; item invisível no menu V2 (np-v3-only)'); else falha('v2: ' + JSON.stringify(r)); await ctx.close(); }
  { // só leitura: recusa
    const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' }); await pg.evaluate(() => { S.canWrite = false; render(); }); await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ({ tab: S.tab, vis: !document.querySelector('#view-acompanhamento').hidden })); if (r.tab !== 'acompanhamento' && !r.vis) ok('só leitura (readOnly): a visão transversal é recusada como a aba'); else falha('readOnly: ' + JSON.stringify(r)); await ctx.close(); }
  // falha fechada: PP.temAcesso ausente / false / exceção — nada é lido, rota recusada, item some
  { // unidade: a função de permissão com PP.temAcesso ausente / false / exceção / true-não-estrito
    const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', hash: '#clientes', esperar: false }); await pg.waitForTimeout(300);
    const u = await pg.evaluate(() => { const orig = PP.temAcesso; const res = {}; const teste = (nome, f) => { PP.temAcesso = f; try { res[nome] = window.PP_ACOMP.podeVer(); } catch (e) { res[nome] = 'lançou'; } }; teste('ausente', undefined); teste('nulo', null); teste('false', () => false); teste('excecao', () => { throw new Error('boom'); }); teste('truthy', () => 1); teste('string', () => 'true'); teste('true', () => true); PP.temAcesso = orig; res.original = window.PP_ACOMP.podeVer(); return res; });
    if (u.ausente === false && u.nulo === false && u.false === false && u.excecao === false && u.truthy === false && u.string === false && u.true === true && u.original === true) ok(`podeVerTransversal falha fechada: ausente/nulo/false/exceção/1/"true" → false; só true estrito → true (${JSON.stringify(u)})`); else falha('unidade permissão: ' + JSON.stringify(u));
    await ctx.close(); }
  // integração: o guarda global do app (render) continua respondendo true; só a chamada feita pelo módulo (pilha com acompanhamento-pj.js) recebe ausência/false/exceção —
  // assim o teste prova que o PRÓPRIO módulo recusa, mesmo quando o resto do app deixaria passar
  const SO_MODULO = (corpo) => `const _o = PP.temAcesso; PP.temAcesso = (t) => { if (t === "acompanhamento" && /podeVerTransversal/.test(String(new Error().stack).split("\\n")[2] || "")) { ${corpo} } return t === "acompanhamento" ? true : _o(t); }`;
  for (const [nome, patch] of [['resposta indefinida', SO_MODULO('return undefined;')], ['retorno false', SO_MODULO('return false;')], ['exceção', SO_MODULO('throw new Error("boom");')]]) {
    const { ctx, pg, leituras, erros } = await contexto(b, { perfil: 'admin', casca: 'v3', hash: '#clientes', esperar: false }); await pg.waitForTimeout(400);
    const n0 = leituras.length; await pg.evaluate((code) => { eval(code); window.PP_ACOMP.filtro({}); S.tab = 'acompanhamento'; try { localStorage.setItem('pp-tab', 'acompanhamento'); } catch (_) {} render(); }, patch); await pg.waitForTimeout(900);
    const novas = leituras.slice(n0).filter(l => /v_acompanhamento_pj|v_tarefas|acompanhamento_pj|dividas_raio_x|atas_reuniao/.test(l));
    const r = await pg.evaluate(() => ({ tab: S.tab, vis: !document.querySelector('#view-acompanhamento').hidden, conteudo: document.querySelector('#view-acompanhamento').children.length, item: (() => { const e = document.querySelector('#np-tree .tab[data-tab="acompanhamento"]'); return !!e && e.offsetParent !== null; })(), pp: localStorage.getItem('pp-tab') }));
    if (r.tab !== 'acompanhamento' && !r.vis && r.conteudo === 0 && novas.length === 0 && r.pp !== 'acompanhamento' && erros.length === 0) ok(`falha fechada (${nome}, só para o módulo; o app diria sim): rota recusada (→ "${r.tab}"), vista vazia e oculta, nenhuma leitura de v_acompanhamento_pj / v_tarefas / dados do cliente`); else falha(`falha fechada (${nome}): ` + JSON.stringify({ r, novas, erros }));
    // mesmo chamando o carregamento por fora, nada é lido
    const n1 = leituras.length; await pg.evaluate(() => { try { window.PP_ACOMP.abrir('c1'); } catch (_) {} }); await pg.waitForTimeout(500);
    const novas2 = leituras.slice(n1).filter(l => /v_acompanhamento_pj|v_tarefas\?.*nucleo/.test(l)); if (!novas2.length) ok(`falha fechada (${nome}): PP_ACOMP não carrega a lista`); else falha(`falha fechada (${nome}) abrir: ` + JSON.stringify(novas2));
    await ctx.close(); }
  // escopo efetivo das consultas (sem tocar no banco): a lista lê v_acompanhamento_pj (security_invoker → RLS sou_equipe), colaboradores, v_tarefas filtrada por núcleo; o painel lê as três tabelas filtradas por cliente_id; clientes só de S.clientes
  { const { ctx, pg, leituras } = await contexto(b, { perfil: 'lucas', casca: 'v3' }); await abrirPainel(pg, 'c1');
    const L = leituras.filter(l => /v_acompanhamento_pj|v_tarefas|acompanhamento_pj\?|dividas_raio_x|atas_reuniao|colaboradores/.test(l)).map(l => l.replace(/select=[^&]*&?/, '').replace(/&$/, ''));
    const okEsc = L.some(l => /^\/rest\/v1\/v_acompanhamento_pj\??$/.test(l)) && L.some(l => /v_tarefas.*nucleo=eq\.acompanhamento_pj.*status=in/.test(l)) && ['acompanhamento_pj', 'dividas_raio_x', 'atas_reuniao'].every(t => L.some(l => new RegExp('^/rest/v1/' + t + '\\?.*cliente_id=eq\\.c1').test(l))) && !L.some(l => /v_tarefas\??$/.test(l));
    if (okEsc) ok('escopo das consultas: v_acompanhamento_pj inteira (RLS sou_equipe via security_invoker, como a aba), v_tarefas só do núcleo e abertas, tabelas do cliente só por cliente_id; clientes vêm de S.clientes (já filtrados ao perfil)'); else falha('escopo: ' + JSON.stringify(L));
    await ctx.close(); }
  // ---------- 2. grupos, resumo, marcas, etapa ----------
  rel.push('2. grupos por reunião, resumo, marcas e indicador de etapa');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const g = await grupos(pg); const resumo = await pg.evaluate(() => document.querySelector('.np-resumo').textContent.replace(/\s+/g, ' ').trim());
    const esp = { vencida: ['c1', 'c5'], semana: ['c2', 'c8'], mensal: ['c3'], sem_data: ['c4'] };
    const okG = Object.entries(esp).every(([k, v]) => JSON.stringify((g[k] || []).slice().sort()) === JSON.stringify(v)) && !g.sem_acomp && !g.encerrado && !g.proxima;
    if (okG && /2 reuniões vencidas/.test(resumo) && /2 esta semana/.test(resumo) && /1 sem agendamento/.test(resumo) && /3 pendências/.test(resumo) && /3 no mensal/.test(resumo)) ok(`grupos: vencida [c1 R2, c5 mensal] · esta semana [c2 ONB, c8 R1] · acompanhamento mensal [c3] · sem agendamento [c4]; vencida/esta semana têm prioridade sobre a fase; escopo padrão exclui não iniciados e encerrados; resumo "${resumo}"`); else falha('grupos: ' + JSON.stringify({ g, resumo }));
    const l1 = await pg.evaluate(() => { const li = document.querySelector('li.np-it[data-id="c1"]'); return { regua: li.className, prazo: li.querySelector('.np-it-prazo').title, ctx: li.querySelector('.ctx').textContent, marcas: [...li.querySelectorAll('.np-marca')].map(m => m.textContent), etapa: li.querySelector('.np-etapa')?.getAttribute('aria-label'), pontos: [...li.querySelectorAll('.np-etapa li')].map(x => x.className), quem: li.querySelector('.np-quem')?.textContent }; });
    if (/r-late/.test(l1.regua) && /R2 · há 3 dias/.test(l1.prazo) && /Metalurgia · Franca\/SP · Ciclo inicial \(45 dias\) · dia 33 de 45 · → Acordos \+ Jurídico/.test(l1.ctx) && l1.marcas.includes('acordos liberado') && l1.marcas.includes('reserva formada') && l1.marcas.includes('2 pendências') && /etapa 3 de 5: R2/.test(l1.etapa) && JSON.stringify(l1.pontos) === JSON.stringify(['ok', 'ok', 'atual', '', '']) && /Ana/.test(l1.quem)) ok(`linha c1: régua vencida; prazo "${l1.prazo}"; contexto "${l1.ctx}"; marcas ${l1.marcas.join('/')}; etapa "${l1.etapa}" (●●◉○○); responsável Ana`); else falha('linha c1: ' + JSON.stringify(l1));
    const l5 = await pg.evaluate(() => { const li = document.querySelector('li.np-it[data-id="c5"]'); return { marcas: [...li.querySelectorAll('.np-marca')].map(m => m.textContent), prazo: li.querySelector('.np-it-prazo').title, ctx: li.querySelector('.ctx').textContent }; });
    if (l5.marcas.includes('mensal') && /mensal · há 8 dias/.test(l5.prazo) && /Acompanhamento mensal/.test(l5.ctx) && !/dia \d+ de 45/.test(l5.ctx)) ok(`linha c5 (mensal vencida): marca "mensal", prazo "${l5.prazo}", sem "dia n de 45"`); else falha('linha c5: ' + JSON.stringify(l5));
    const l4 = await pg.evaluate(() => { const li = document.querySelector('li.np-it[data-id="c4"]'); return { prazo: li.querySelector('.np-it-prazo').title, d: li.querySelector('.np-it-prazo .d').textContent }; });
    if (l4.prazo === 'sem reunião agendada' && l4.d === '—') ok('linha c4 (mensal sem data): "sem reunião agendada", sem inventar data'); else falha('linha c4: ' + JSON.stringify(l4));
    await pg.evaluate(() => window.PP_ACOMP.filtro({ escopo: 'todos' })); await pg.waitForTimeout(250); const g2 = await grupos(pg);
    if (JSON.stringify(g2.sem_acomp) === JSON.stringify(['c6']) && JSON.stringify(g2.encerrado) === JSON.stringify(['c7'])) ok('"Todos os clientes": grupos "Sem acompanhamento iniciado" [c6] e "Encerrados" [c7] aparecem; cliente encerrado sem acompanhamento não entra'); else falha('todos: ' + JSON.stringify(g2));
    await ctx.close(); }
  // ---------- 3. painel ----------
  rel.push('3. painel: dados reais do cliente selecionado');
  { const { ctx, pg, escritas, leituras } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    await abrirPainel(pg, 'c1');
    const p = await pg.evaluate(() => { const P = document.querySelector('.np-painel'); const props = {}; P.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { titulo: P.querySelector('h2').textContent, trilha: P.querySelector('.np-trilha-p').textContent, props, secoes: [...P.querySelectorAll('.np-sec h3')].map(h => h.textContent), ciclo: [...P.querySelectorAll('.np-ciclo li')].map(l => l.className.trim() + ':' + l.querySelector('.d').textContent), raio: [...P.querySelectorAll('.np-tab tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join('|')), pend: [...P.querySelectorAll('.np-sec')].find(s => /Pendências/.test(s.textContent))?.querySelectorAll('.np-passos li').length, pendCrit: [...P.querySelectorAll('.np-sec')].find(s => /Pendências/.test(s.textContent))?.querySelectorAll('.np-passos li.crit').length, atas: [...P.querySelectorAll('.np-sec')].find(s => /Atas/.test(s.textContent))?.querySelectorAll('.np-passos li').length, pe: [...P.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()) }; });
    const pr = p.props;
    const okP = p.titulo === 'Empresa Alfa Ltda' && /Ciclo inicial/.test(pr['Fase']) && /dia 33 de 45/.test(pr['Fase']) && /R2 · há 3 dias/.test(pr['Próxima reunião']) && /Ana/.test(pr['Responsável']) && /Acordos \+ Jurídico/.test(pr['Direcionamento']) && /Ouro/.test(pr['Régua']) && /liberado em/.test(pr['Acordos']) && /planejada: formada/.test(pr['Reserva']) && /acumulada: R\$\s?180\.000\s*informada pelo cliente/.test(pr['Reserva']);
    const okC = JSON.stringify(p.ciclo.map(x => x.split(':')[0])) === JSON.stringify(['ok', 'ok', 'atual', '', '']) && p.ciclo[2].endsWith(dia(-3).split('-').reverse().join('/'));
    if (okP && okC && p.raio.length === 2 && /Santander\|Capital de giro\|R\$\s?480\.000\|4 m\|Sócio A\|não/.test(p.raio[0]) && p.pend === 2 && p.pendCrit === 1 && p.atas === 2 && p.pe.join() === 'Registrar ata,Atualizar ciclo,Mais ações' && escritas.length === 0) ok(`painel c1: fase/próxima reunião/responsável/direcionamento/régua/acordos; reserva planejada (formada) × acumulada (R$ 180.000, informada pelo cliente); ciclo ●●◉○○ com datas; Raio-X 2 dívidas; 2 pendências (1 vencida, só do núcleo — a tarefa jurídica não entra); 2 atas; pé: ${p.pe.join(' · ')}; nenhuma escrita`); else falha('painel c1: ' + JSON.stringify(p));
    if (leituras.filter(l => /acompanhamento_pj\?.*cliente_id=eq\.c1|dividas_raio_x\?.*cliente_id=eq\.c1|atas_reuniao\?.*cliente_id=eq\.c1/.test(l)).length >= 3) ok('painel carregou acompanhamento_pj, dividas_raio_x e atas_reuniao do cliente c1 (mesmas consultas da aba)'); else falha('leituras: ' + JSON.stringify(leituras.filter(l => /acomp|divid|atas/.test(l))));
    // cliente não iniciado (c6) via Todos: painel sem inventar estado
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.evaluate(() => window.PP_ACOMP.filtro({ escopo: 'todos' })); await pg.waitForTimeout(250); await abrirPainel(pg, 'c6');
    const p6 = await pg.evaluate(() => { const P = document.querySelector('.np-painel'); const props = {}; P.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { props, pe: [...P.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()), ciclo: [...P.querySelectorAll('.np-ciclo li')].map(l => l.className.trim()) }; });
    if (/não iniciado/.test(p6.props['Fase']) && !('Acordos' in p6.props) && /não iniciada/.test(p6.props['Reserva']) && p6.pe[1] === 'Definir datas' && JSON.stringify(p6.ciclo) === JSON.stringify(['atual', '', '', '', ''])) ok('painel c6 (não iniciado): "acompanhamento não iniciado", sem Acordos, reserva "não iniciada", botão "Definir datas", ciclo sem passo feito'); else falha('painel c6: ' + JSON.stringify(p6));
    await ctx.close(); }
  // ---------- 4. formulários com o cliente explícito; troca de cliente ----------
  rel.push('4. formulários recebem o cliente selecionado; trocar de cliente não vaza gravações');
  { const { ctx, pg, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const modalInfo = () => pg.evaluate(() => ({ h2: document.querySelector('#modalHost h2')?.textContent, urls: [...document.querySelectorAll('#modalHost input[type=url]')].map(i => i.value), dates: [...document.querySelectorAll('#modalHost input[type=date]')].map(i => i.value), aberto: !!document.querySelector('#modalHost .modal') }));
    const fecharModal = () => pg.evaluate(() => document.querySelector('#modalHost').replaceChildren());
    await abrirPainel(pg, 'c1'); await pg.click('.np-p-pe button:has-text("Registrar ata")'); await pg.waitForTimeout(300); const m1 = await modalInfo(); await fecharModal();
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    await abrirPainel(pg, 'c2'); await pg.click('.np-p-pe button:has-text("Registrar ata")'); await pg.waitForTimeout(300); const m2 = await modalInfo();
    if (m1.h2 === 'Registrar ata' && m1.urls[0] === 'https://drive.example/c1' && m2.h2 === 'Registrar ata' && m2.urls[0] === 'https://drive.example/c2') ok('Registrar ata: modal da aba (formAta) pré-preenchido com a pasta do cliente aberto — c1 e depois c2, sem resíduo'); else falha('ata modal: ' + JSON.stringify({ m1, m2 }));
    // salvar a ata de c2: a escrita leva cliente_id c2
    await pg.fill('#modalHost textarea', 'Onboarding realizado com a Beta.'); const antes = escritas.length; await pg.click('#modalHost .modal .btn.primary, #modalHost .modal button[type=submit], #modalHost .modal .actions .btn.primary'); await pg.waitForTimeout(700);
    const w = escritas.slice(antes); const ata = w.find(e => /POST \/rest\/v1\/atas_reuniao/.test(e));
    if (ata && /"cliente_id":"c2"/.test(ata) && !w.some(e => /"cliente_id":"c1"/.test(e))) ok('salvar ata com c2 aberto: POST atas_reuniao{cliente_id:c2}; nada gravado em c1'); else falha('ata gravação: ' + JSON.stringify(w));
    // Atualizar ciclo em c2 (onboarding): datas do c2 no modal; salvar → upsert acompanhamento_pj{cliente_id:c2} + clientes id=eq.c2
    await pg.waitForTimeout(500); await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren());
    const aberto2 = await pg.evaluate(() => !document.querySelector('.np-painel').hidden && document.querySelector('.np-painel h2').textContent); if (aberto2 !== 'Beta Comércio ME') { await abrirPainel(pg, 'c2'); }
    await pg.click('.np-p-pe button:has-text("Atualizar ciclo"), .np-p-pe button:has-text("Definir datas")'); await pg.waitForTimeout(300); const mc = await modalInfo();
    const antes2 = escritas.length; await pg.click('#modalHost .modal .btn.primary, #modalHost .modal .actions .btn.primary'); await pg.waitForTimeout(700); const w2 = escritas.slice(antes2);
    if (mc.h2 === 'Ciclo de acompanhamento' && mc.dates[0] === dia(2) && w2.some(e => /POST \/rest\/v1\/acompanhamento_pj.*"cliente_id":"c2"/.test(e)) && w2.some(e => /PATCH \/rest\/v1\/clientes\?id=eq\.c2/.test(e)) && !w2.some(e => /c1/.test(e))) ok(`Atualizar ciclo em c2: modal com a data de onboarding do c2 (${mc.dates[0]}); salvar → upsert acompanhamento_pj{cliente_id:c2} + PATCH clientes?id=eq.c2; nada em c1`); else falha('ciclo: ' + JSON.stringify({ mc, w2 }));
    // Criar tarefas do ciclo em c8 (ciclo com R1/R2/R3 futuras): consulta e inserções só com cliente_id c8
    await pg.waitForTimeout(500); await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren()); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    await abrirPainel(pg, 'c8'); await pg.click('.np-p-pe button:has-text("Mais ações")'); await pg.waitForTimeout(200); const antes3 = escritas.length; await pg.click('#np-pop [role="menuitem"]:has-text("Criar tarefas do ciclo")'); await pg.waitForTimeout(800);
    const w3 = escritas.slice(antes3); const ins = w3.find(e => /POST \/rest\/v1\/tarefas[ ?]/.test(e)); const t3 = await pg.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent.trim() : ''; });
    if (ins && /"cliente_id":"c8"/.test(ins) && !/"cliente_id":"c[^8]"/.test(ins) && /"nucleo":"acompanhamento_pj"/.test(ins) && /tarefa\(s\) do ciclo criada/.test(t3)) ok(`Criar tarefas do ciclo em c8: POST tarefas só com cliente_id c8 (núcleo acompanhamento_pj); toast "${t3}"`); else falha('tarefas ciclo: ' + JSON.stringify({ w3, t3 }));
    // Incluir dívida em c3: modal + gravação com c3
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await abrirPainel(pg, 'c3'); await pg.click('.np-p-pe button:has-text("Mais ações")'); await pg.waitForTimeout(200); await pg.click('#np-pop [role="menuitem"]:has-text("Incluir dívida")'); await pg.waitForTimeout(300);
    await pg.fill('#modalHost input[placeholder="Ex.: Santander"]', 'Sicoob'); const antes4 = escritas.length; await pg.click('#modalHost .modal .btn.primary, #modalHost .modal .actions .btn.primary'); await pg.waitForTimeout(700); const w4 = escritas.slice(antes4);
    if (w4.some(e => /POST \/rest\/v1\/dividas_raio_x.*"cliente_id":"c3".*"banco":"Sicoob"/.test(e)) && !w4.some(e => /"cliente_id":"c[^3]"/.test(e))) ok('Incluir dívida com c3 aberto: POST dividas_raio_x{cliente_id:c3}'); else falha('dívida: ' + JSON.stringify(w4));
    const todas = escritas.filter(e => /POST|PATCH/.test(e)); const clientesTocados = [...new Set(todas.flatMap(e => [...e.matchAll(/"cliente_id":"(c\d)"|id=eq\.(c\d)/g)].map(m => m[1] || m[2])))].sort();
    if (JSON.stringify(clientesTocados) === JSON.stringify(['c2', 'c3', 'c8'])) ok(`em toda a sessão, as gravações tocaram só os clientes em que as ações foram disparadas: ${clientesTocados.join(', ')} (c1 foi aberto e nunca gravado)`); else falha('clientes tocados: ' + JSON.stringify({ clientesTocados, todas }));
    await ctx.close(); }
  // ---------- 5. filtros ----------
  rel.push('5. filtros e "Mais filtros"');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const chips = await pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento .np-chipf')].map(c => c.textContent.replace(/\d+$/, '').trim()));
    const clicar = async (l) => { await pg.click(`#view-acompanhamento .np-chipf:text-is("${l}")`); await pg.waitForTimeout(150); return ids(pg); };
    const a = await clicar('Ciclo inicial'), bq = await clicar('Mensal'), c = await clicar('Com pendência'), d = await clicar('Com pendência'), e = await clicar('Mensal'), f = await clicar('Minhas'), g = await clicar('Minhas'), h = await clicar('Lucas');
    const J = JSON.stringify;
    if (['Em acompanhamento', 'Encerrados', 'Todos os clientes', 'Ciclo inicial', 'Mensal', 'Com pendência', 'Minhas', 'Lucas', 'Mais filtros'].every(x => chips.includes(x)) && J(a) === J(['c1', 'c2', 'c8']) && J(bq) === J(['c3', 'c4', 'c5']) && J(c) === J(['c3']) && J(d) === J(['c3', 'c4', 'c5']) && J(e) === J(['c1', 'c2', 'c3', 'c4', 'c5', 'c8']) && J(f) === J(['c1', 'c3']) && J(g).length > 0 && J(h) === J(['c2', 'c4', 'c5', 'c8'])) ok('chips consecutivos: Ciclo inicial [c1,c2,c8] → Mensal (exclusivo) [c3,c4,c5] → +Com pendência [c3] → … → Minhas [c1,c3] → Lucas [c2,c4,c5,c8]'); else falha('chips: ' + J({ chips, a, bq, c, d, e, f, g, h }));
    await pg.evaluate(() => window.PP_ACOMP.filtro({})); await pg.waitForTimeout(150); await pg.click('#view-acompanhamento .np-chipf:has-text("Mais filtros")'); await pg.waitForTimeout(250);
    const troca = async (idx, v) => { await pg.evaluate(({ idx, v }) => { const s = document.querySelectorAll('#np-pop select')[idx]; s.focus(); s.value = v; s.dispatchEvent(new Event('change')); }, { idx, v }); await pg.waitForTimeout(250); return pg.evaluate(() => ({ pop: !!document.querySelector('#np-pop.on'), foco: !!document.activeElement.closest('#np-pop'), ids: [...document.querySelectorAll('#view-acompanhamento li.np-it[data-id]')].map(e => e.dataset.id).sort() })); };
    const r1 = await troca(0, 'mensal'), r2 = await troca(2, 'prata'), r3 = await troca(1, 'col-luc');
    if ([r1, r2, r3].every(r => r.pop && r.foco) && J(r1.ids) === J(['c3', 'c4', 'c5']) && J(r2.ids) === J(['c3', 'c5']) && J(r3.ids) === J(['c5'])) ok('"Mais filtros": fase mensal → régua prata → responsável Lucas, popover e foco mantidos, conjuntos corretos'); else falha('mais filtros: ' + J({ r1, r2, r3 }));
    await pg.keyboard.press('Escape'); await ctx.close(); }
  // ---------- 6. ARIA, teclado, capturas ----------
  rel.push('6. ARIA, teclado e capturas 375/768/1024/1440 × claro/escuro');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const a = await pg.evaluate(() => ({ listas: document.querySelectorAll('#view-acompanhamento ul.np-lst[role="list"]').length, tab: [...document.querySelectorAll('#view-acompanhamento [role="tab"]')].filter(e => e.offsetParent !== null).length, pressed: [...document.querySelectorAll('#view-acompanhamento .np-chipf')].every(c => /^(true|false)$/.test(c.getAttribute('aria-pressed'))), status: document.querySelector('.np-resumo').getAttribute('role'), etapa: document.querySelector('li.np-it[data-id="c1"] .np-etapa [aria-current="step"]')?.textContent }));
    await pg.focus('li.np-it[data-id="c1"] .np-it-abrir'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(600); const k1 = await pg.evaluate(() => ({ aberto: !document.querySelector('.np-painel').hidden, foco: document.activeElement.getAttribute('aria-label'), ciclo: document.querySelector('.np-painel .np-ciclo [aria-current="step"] .l')?.textContent }));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); const k2 = await pg.evaluate(() => ({ fechado: document.querySelector('.np-painel').hidden, foco: document.activeElement.className }));
    if (a.listas > 0 && a.tab === 0 && a.pressed && a.status === 'status' && a.etapa === 'R2' && k1.aberto && k1.foco === 'Fechar (Esc)' && k1.ciclo === 'R2' && k2.fechado && /np-it-abrir/.test(k2.foco)) ok(`ARIA: listas, aria-pressed, resumo role=status, etapa aria-current=step "${a.etapa}"; Enter abre (foco no Fechar; ciclo com passo atual "${k1.ciclo}"), Esc devolve o foco`); else falha('aria: ' + JSON.stringify({ a, k1, k2 }));
    await ctx.close(); }

  // composição em 375 px: três faixas sem sobreposição (prazo+urgência / título+contexto / marcas+responsável+progresso+valor) e nada ultrapassa a linha
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 375, h: 812 });
    const comp = await pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento li.np-it[data-id]')].map(li => { const r = (e) => e ? e.getBoundingClientRect() : null; const L = r(li), P = r(li.querySelector('.np-it-prazo')), T = r(li.querySelector('.np-it-abrir')), D = r(li.querySelector('.np-it-dir')); const filhos = [...li.querySelectorAll('.np-it-dir > *')].map(r);
      return { id: li.dataset.id, ok: P.bottom <= T.top + 1 && T.bottom <= D.top + 1 && D.right <= L.right + 1 && P.right <= L.right + 1 && filhos.every(f => f.right <= L.right + 1 && f.left >= L.left - 1), titulo: getComputedStyle(li.querySelector('.np-it-abrir .tx')).whiteSpace !== 'nowrap', sx: document.documentElement.scrollWidth }; }));
    const ruins = comp.filter(c => !c.ok || !c.titulo);
    if (comp.length && !ruins.length && comp[0].sx <= 375) ok(`375 px: ${comp.length} linhas em três faixas (prazo+urgência / título+contexto / marcas+responsável+progresso+valor) sem sobreposição nem estouro; título com quebra`); else falha('composição 375: ' + JSON.stringify(ruins.slice(0, 3)));
    await pg.screenshot({ path: path.join(OUT, 'v3-light-375-composicao.png') }); await ctx.close(); }
  // ---------- 6b. acessibilidade específica: contraste e alvos (marcas, etapa, ciclo, tabela, popover, painel) ----------
  rel.push('6b. contraste (texto 4,5:1; componentes 3:1) e alvos de toque (44 px) em 375/768/1024/1440');
  for (const tema of ['light', 'dark']) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', tema });
    await abrirPainel(pg, 'c1'); await pg.click('.np-p-pe button:has-text("Mais ações")'); await pg.waitForTimeout(250);
    const pares = [
      { sel: '.np-resumo b', nome: 'número do resumo' }, { sel: '.np-resumo b.crit', nome: 'número crítico' }, { sel: '.np-resumo b.att', nome: 'número atenção' }, { sel: '.np-resumo span', nome: 'rótulo do resumo' },
      { sel: '.np-chipf[aria-pressed="true"]', nome: 'chip ativo' }, { sel: '.np-chipf[aria-pressed="false"]', nome: 'chip inativo' }, { sel: '.np-grp.crit .np-grp-h .t', nome: 'cabeça Reunião vencida' }, { sel: '.np-grp.att .np-grp-h .t', nome: 'cabeça Esta semana' }, { sel: '.np-grp-h .n', nome: 'contagem do grupo' },
      { sel: '.np-it-prazo.late .d', nome: 'reunião vencida' }, { sel: '.np-it-prazo.att .d', nome: 'reunião esta semana' }, { sel: '.np-it-prazo .r', nome: 'relativo (celular)', opcional: true }, // oculto ≥ 900 px por desenho; medido no contexto de 375 abaixo { sel: '.np-it-abrir .tx', nome: 'nome do cliente' }, { sel: '.np-it-abrir .ctx', nome: 'contexto' }, { sel: '.ctx .rel.late', nome: 'relativo vencido' }, { sel: '.ctx .rel.att', nome: 'relativo esta semana' },
      { sel: '.np-marca.info', nome: 'marca mensal' }, { sel: '.np-marca.ok', nome: 'marca acordos liberado' }, { sel: '.np-marca.att', nome: 'marca pendências' }, { sel: '.np-marca.crit', nome: 'marca pendência vencida' },
      { sel: '.np-quem span', nome: 'responsável' }, { sel: '.np-quem b', nome: 'iniciais' },
      { sel: '.np-etapa li:not(.ok):not(.atual)', nome: 'ponto de etapa (borda)', prop: 'borderColor', minimo: 3 }, { sel: '.np-etapa li.ok', nome: 'ponto feito', prop: 'backgroundColor', minimo: 3 }, { sel: '.np-etapa li.atual', nome: 'ponto atual', prop: 'backgroundColor', minimo: 3 },
      { sel: '.np-painel h2', nome: 'título do painel' }, { sel: '.np-props dt', nome: 'rótulo de prop' }, { sel: '.np-props dd', nome: 'valor de prop' }, { sel: '.np-props dd small', nome: 'complemento de prop' }, { sel: '.np-props dd .np-marca.ok', nome: 'acordos liberado (painel)' }, { sel: '.np-sec h3', nome: 'título de seção' },
      { sel: '.np-ciclo .l', nome: 'rótulo do ciclo' }, { sel: '.np-ciclo li.atual .l', nome: 'rótulo do passo atual' }, { sel: '.np-ciclo .d', nome: 'data do ciclo' }, { sel: '.np-ciclo li:not(.ok):not(.atual) .dot', nome: 'número do passo' }, { sel: '.np-ciclo li.ok .dot', nome: 'passo feito (fundo)', prop: 'backgroundColor', minimo: 3 }, { sel: '.np-ciclo li:not(.ok) .dot', nome: 'borda do passo', prop: 'borderColor', minimo: 3 }, { sel: '.np-ciclo li.atual .dot', nome: 'borda do passo atual', prop: 'borderColor', minimo: 3 },
      { sel: '.np-tab th', nome: 'cabeçalho da tabela' }, { sel: '.np-tab td', nome: 'célula da tabela' }, { sel: '.np-tab td.num', nome: 'número da tabela' },
      { sel: '.np-passos li.crit', nome: 'pendência vencida (passos)' }, { sel: '.np-passos li small', nome: 'sub dos passos' }, { sel: '.np-passos .lnk', nome: 'link de pendência' },
      { sel: '#np-pop .np-pop-i', nome: 'item do popover' }, { sel: '.np-btn.pri', nome: 'botão primário' }, { sel: '.np-btn.ghost', nome: 'botão fantasma' }, { sel: '.np-btn:not(.pri):not(.ghost)', nome: 'botão secundário' },
    ];
    const m = await medirContraste(pg, pares); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    if (!m.ruins.length && !m.ausentesObrigatorios.length) ok(`${tema} 1440: ${m.medidos.length} pares obrigatórios encontrados e medidos ≥ mínimo; menor razão ${m.minimo.toFixed(2)}:1${m.ausentesOpcionais.length ? ' · ocultos pela responsividade (medidos a 375): ' + m.ausentesOpcionais.join(', ') : ''}`); else falha(`${tema}: ` + (m.ruins.length ? 'contraste insuficiente: ' + m.ruins.map(p => `${p.nome} ${p.r.toFixed(2)}:1 (${p.fg} sobre ${p.bg})`).join('; ') : '') + (m.ausentesObrigatorios.length ? ' · OBRIGATÓRIOS não encontrados: ' + m.ausentesObrigatorios.join(', ') : ''));
    await ctx.close();
    const c375 = await contexto(b, { perfil: 'admin', casca: 'v3', tema, w: 375, h: 812 });
    const m375 = await medirContraste(c375.pg, [{ sel: '.np-it-prazo .r', nome: 'relativo junto à reunião (celular)' }, { sel: '.np-it-prazo.late .r', nome: 'relativo vencido (celular)' }, { sel: '.np-it-prazo.att .r', nome: 'relativo esta semana (celular)' }, { sel: '.np-it-dir .np-marca', nome: 'marca na 3ª faixa (celular)' }, { sel: '.np-it-dir .np-etapa li.atual', nome: 'ponto atual (celular)', prop: 'backgroundColor', minimo: 3 }, { sel: '.np-it-dir .np-quem b', nome: 'iniciais (celular)' }]);
    if (!m375.ruins.length && !m375.ausentesObrigatorios.length) ok(`${tema} 375: ${m375.medidos.length} pares exclusivos do celular medidos; menor ${m375.minimo.toFixed(2)}:1`); else falha(`${tema} 375: ` + m375.ruins.map(p => `${p.nome} ${p.r.toFixed(2)}:1`).join('; ') + (m375.ausentesObrigatorios.length ? ' · OBRIGATÓRIOS não encontrados: ' + m375.ausentesObrigatorios.join(', ') : ''));
    await c375.ctx.close(); }
  for (const [w, h] of [[375, 812], [768, 1024], [1024, 768], [1440, 900]]) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w, h }); await pg.evaluate(() => {});
    const a1 = await medirAlvos(pg, '#view-acompanhamento'); await abrirPainel(pg, 'c1'); await pg.click('.np-p-pe button:has-text("Mais ações")'); await pg.waitForTimeout(250); const a2 = await medirAlvos(pg, '.np-painel'); await pg.keyboard.press('Escape');
    const todos = [...a1, ...a2]; const pequenos = todos.filter(a => w < 900 ? (a.h < 44 || (a.icone && a.w < 44)) : (!a.inline && (a.h < 24 || (a.icone && a.w < 24)))); // toque (≤ 900): 44 px; ponteiro fino: WCAG 2.5.8 (24 px, links inline no texto isentos)
    if (!pequenos.length) ok(`${w}px: ${todos.length} alvos conferidos (${w < 900 ? '≥ 44 px no toque' : '≥ 24 px no ponteiro fino, links inline isentos'}) — lista, chips, painel, links de pendência/atas, popover`); else falha(`${w}px: alvos pequenos: ` + [...new Set(pequenos.map(a => `${a.nome} ${a.w}×${a.h}`))].join(', '));
    await ctx.close(); }
  for (const tema of ['light', 'dark']) for (const w of [375, 768, 1024, 1440]) {
    const { ctx, pg, erros } = await contexto(b, { perfil: 'admin', casca: 'v3', w, h: 900, tema });
    const sx = await pg.evaluate(() => document.documentElement.scrollWidth); await pg.screenshot({ path: path.join(OUT, `v3-${tema}-${w}-lista.png`) });
    if (w >= 1024 || tema === 'light') { await abrirPainel(pg, 'c1'); await pg.screenshot({ path: path.join(OUT, `v3-${tema}-${w}-painel.png`) }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
    if (sx <= w && erros.length === 0) ok(`${tema} ${w}px: sem rolagem horizontal, sem erros`); else falha(`${tema} ${w}px: scrollWidth=${sx} erros=${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  // ---------- 7. aba da ficha intacta (com a chave) e V2 ----------
  rel.push('7. aba Acompanhamento PJ da ficha do cliente continua igual');
  for (const casca of ['v3', 'v2']) { const { ctx, pg, erros } = await contexto(b, { perfil: 'admin', casca, hash: '#clientes', esperar: false }); await pg.evaluate(() => { S.tab = 'clientes'; S.sel = 'c1'; S.sub = 'acompanhamento'; render(); }); await pg.waitForTimeout(900);
    const r = await pg.evaluate(() => ({ h2: [...document.querySelectorAll('#view-clientes section h2')].map(h => h.textContent), barra: document.querySelectorAll('#view-clientes .ciclo-barra .ciclo-passo').length, np: document.querySelectorAll('#view-clientes .np-toolbar, #view-clientes li.np-it').length }));
    if (r.h2.includes('Status do acompanhamento') && r.h2.includes('Dívidas (ponto de partida)') && r.h2.includes('Atas das reuniões') && r.barra === 5 && r.np === 0 && erros.length === 0) ok(`${casca}: aba da ficha com Status do acompanhamento (5 passos), Dívidas e Atas — renderização V2 intacta`); else falha(`aba ${casca}: ` + JSON.stringify({ r, erros })); await ctx.close(); }
  // ---------- 8. ambiente sem a migração 0104 (beta hoje) ----------
  rel.push('8. ambiente sem a 0104: aviso claro, sem quebrar');
  { const { ctx, pg, erros } = await contexto(b, { perfil: 'admin', casca: 'v3', sem0104: true, esperar: false }); await pg.waitForTimeout(1200);
    const r = await pg.evaluate(() => ({ erro: document.querySelector('#view-acompanhamento .np-erro')?.textContent || '', linhas: document.querySelectorAll('#view-acompanhamento li.np-it').length, vazio: document.querySelector('#view-acompanhamento .np-vazio h3')?.textContent || '' }));
    if (/0104/.test(r.erro) && r.linhas === 0 && erros.length === 0) ok(`sem v_acompanhamento_pj: faixa "${r.erro.slice(0, 70)}…", lista vazia, sem erro de página`); else falha('sem 0104: ' + JSON.stringify({ r, erros })); await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.') + '\n'; fs.writeFileSync(path.join(OUT, 'relatorio-acompanhamento-lab.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
