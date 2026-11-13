/* Laboratório da tela Negociações em V3.1 (Fase 3). Playwright + Chromium locais; o repositório é servido por um servidor
   HTTP efêmero (127.0.0.1) e TODA chamada a *.supabase.co é interceptada e respondida com fixtures fictícias — nada sai da
   máquina, nada é escrito. Perfis: admin e colaborador do Jurídico.
   Uso: NODE_PATH=<módulos> node docs/qa/negociacoes-lab.cjs [pasta de saída]  (padrão /tmp/negociacoes-lab)
   Verifica: paridade de dados V2 × V3.1 (mesma seleção por cliente/responsável/concluídas), paridade de ações (mover etapa =
   mesma escrita do kanban V2; Editar = modal atual; erro do banco = mesmo toast), filtros V3.1 client-side e "Mais filtros",
   painel com os campos reais (valores sem confundir cobrado/acordo; êxito só o gravado), só leitura, ARIA/teclado, capturas,
   V2 intacta sem a chave (Negociações, Fluxo PJ e Monitoramento). */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http'); const { medirContraste, medirAlvos } = require(path.join(process.cwd(), 'docs/qa/_a11y.cjs')); // cwd = raiz do repositório (como RAIZ)
const RAIZ = process.cwd(); const OUT = process.argv[2] || '/tmp/negociacoes-lab'; fs.mkdirSync(OUT, { recursive: true });
const REF = 'ksdwzljfjfucjevdqxvx';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
let BASE = '';
const servir = () => new Promise((res) => { const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); srv.listen(0, '127.0.0.1', () => { BASE = `http://127.0.0.1:${srv.address().port}`; res(srv); }); });

/* ---------- fixtures fictícias ---------- */
const hoje = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (n) => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n); return iso(d); };
const COLAB = [{ id: 'col-ana', perfil_id: 'u-admin', nome: 'Ana Teste', nucleo: 'socios', ativo: true }, { id: 'col-caio', perfil_id: 'u-jur', nome: 'Caio Teste', nucleo: 'juridico', ativo: true }, { id: 'col-nat', perfil_id: 'u-nat', nome: 'Natália Teste', nucleo: 'acordos', ativo: true }];
const CLIENTES = [{ id: 'c1', nome: 'Empresa Alfa Ltda', cnpj: '00.000.000/0001-01', cidade: 'Franca/SP', status: 'ativo', projeto_reserva: 'formada', reservaAcumulada: 180000, created_at: '2026-01-10' }, { id: 'c2', nome: 'Beta Comércio ME', cnpj: '00.000.000/0001-02', cidade: 'Batatais/SP', status: 'ativo', projeto_reserva: 'em_construcao', reservaAcumulada: 0, created_at: '2026-02-01' }, { id: 'c3', nome: 'Gama Indústria SA', cnpj: '00.000.000/0001-03', cidade: 'Ribeirão Preto/SP', status: 'ativo', created_at: '2026-03-15' }];
let seq = 0; const uuid = () => { const h = (seq++).toString(16).padStart(12, '0'); return `00000000-0000-4000-9000-${h}`; };
const ETAPAS = ['iniciar', 'extrajudicial', 'pos_judicializacao', 'minuta', 'formalizado', 'pagamento_pendente', 'concluido'];
const neg = (o) => { const id = uuid(); const prazo = o.dias == null ? null : dia(o.dias); return { id, cliente_id: o.c, cliente_nome: CLIENTES.find(x => x.id === o.c).nome, titulo: o.t, banco: o.b, etapa: o.e, etapa_ordem: ETAPAS.indexOf(o.e), ordem: 0, temperatura: o.temp || null, situacao_processual: o.sit || null, numero_processo: o.np || null, responsavel_id: o.r || null, responsavel_nome: COLAB.find(x => x.id === o.r)?.nome || null, adverso_contato: o.adv || null, valor_cobrado: o.vc ?? null, valor_acordo: o.va ?? null, alcada_autorizada: o.alc ?? null, percentual_exito: o.pex ?? null, data_acordo: o.da || null, prazo, atrasada: prazo != null && o.dias < 0 && o.e !== 'concluido', dias_parada: o.parada ?? 2, aguardando: o.ag || null, proximo_passo: o.pp || null, observacoes: o.obs || null, contrato_id: null, updated_at: new Date(Date.now() - (o.parada ?? 2) * 86400000).toISOString() }; };
const NEGS = [
  neg({ c: 'c1', t: 'Alfa | Santander | Capital de giro', b: 'Santander', e: 'extrajudicial', temp: 'quente', r: 'col-nat', dias: -3, vc: 480000, va: 210000, alc: 260000, pex: 20, sit: 'Banco ajuizou ação', np: '0000001-11.2026.8.26.0196', pp: 'Enviar contraproposta até sexta.', ag: 'retorno do banco', adv: 'Dr. Fulano — (16) 99999-0000' }),
  neg({ c: 'c1', t: 'Alfa | Itaú | Conta garantida', b: 'Itaú', e: 'iniciar', temp: 'frio', r: 'col-nat', dias: 4, vc: 150000, parada: 20 }),
  neg({ c: 'c2', t: 'Beta | Santander | Cheque especial', b: 'Santander', e: 'minuta', temp: 'morno', r: 'col-caio', dias: 1, vc: 92000, va: 60000, pex: 20, pp: 'Revisar minuta enviada pelo banco.' }),
  neg({ c: 'c2', t: 'Beta | Sicoob | Financiamento', b: 'Sicoob', e: 'pos_judicializacao', r: 'col-caio', dias: -10, vc: 300000, va: 240000, alc: 250000, pex: 15, sit: 'Execução em curso', parada: 18 }),
  neg({ c: 'c3', t: 'Gama | Banco do Brasil | Capital de giro', b: 'Banco do Brasil', e: 'formalizado', temp: 'quente', r: 'col-nat', dias: 12, vc: 800000, va: 420000, alc: 500000, pex: 20, da: dia(-2), ag: 'assinatura do sócio' }),
  neg({ c: 'c3', t: 'Gama | Santander | Antecipação', b: 'Santander', e: 'pagamento_pendente', r: 'col-ana', dias: 6, vc: 120000, va: 70000, pex: 20, da: dia(-9), ag: 'comprovante de quitação' }),
  neg({ c: 'c1', t: 'Alfa | Bradesco | Cartão PJ', b: 'Bradesco', e: 'iniciar', r: null, dias: null, vc: 45000 }),
  neg({ c: 'c2', t: 'Beta | Itaú | Veículo', b: 'Itaú', e: 'extrajudicial', temp: 'morno', r: 'col-nat', dias: 20, vc: 68000, va: 52000, parada: 30 }),
  neg({ c: 'c3', t: 'Gama | Sicoob | Capital de giro', b: 'Sicoob', e: 'concluido', r: 'col-nat', dias: -40, vc: 200000, va: 110000, pex: 20, da: dia(-30) }),
  neg({ c: 'c1', t: 'Alfa | Caixa | Giro', b: 'Caixa', e: 'concluido', r: 'col-caio', dias: -60, vc: 90000, va: 50000, da: dia(-50) }),
];
const PERFIS = { admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] }, juridico: { id: 'u-jur', nome: 'Caio Teste', papel: 'colaborador', acessos: ['juridico'] } };
const sessao = (perfil) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: perfil.id, email: perfil.id + '@lab', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });

async function contexto(b, { perfil = 'admin', casca = 'v3', w = 1440, h = 900, tema = 'light', reduz = false, touch = false, extraLS = {}, hash = '#negociacoes' } = {}) {
  const P = PERFIS[perfil]; const s = sessao(P); const escritas = []; const erros = []; const sim = { falharPatch: false };
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: touch || w < 900, isMobile: touch, reducedMotion: reduz ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(({ s, ref, casca, tema, extraLS }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)); if (casca === 'v3') localStorage.setItem('np-casca', 'v3'); localStorage.setItem('pp-tema', tema); for (const [k, v] of Object.entries(extraLS)) localStorage.setItem(k, v); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { s, ref: REF, casca, tema, extraLS });
  await ctx.route(/supabase\.co/, async (rota) => {
    const req = rota.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method(); const unico = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (b, status = 200, extra = {}) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...extra }, body: JSON.stringify(b) });
    if (sim.falharPatch && m === 'PATCH' && p.startsWith('/rest/v1/negociacoes')) { escritas.push(m + ' ' + p + u.search + ' (falha simulada)'); return json({ message: 'falha simulada do banco', code: 'LAB500' }, 500); }
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !p.startsWith('/auth/')) { escritas.push(m + ' ' + p + u.search + ' ' + (req.postData() || '').slice(0, 120));
      if (m === 'PATCH' && p.startsWith('/rest/v1/negociacoes')) { try { const corpo = JSON.parse(req.postData() || '{}'); const id = (u.searchParams.get('id') || '').replace('eq.', ''); const n = NEGS.find(x => x.id === id); if (n && corpo.etapa) { n.etapa = corpo.etapa; n.etapa_ordem = ETAPAS.indexOf(corpo.etapa); } } catch (_) {} }
      return json(m === 'POST' && /rpc/.test(p) ? null : [], m === 'POST' ? 201 : 200); }
    if (p.startsWith('/auth/v1/user')) return json(s.user); if (p.startsWith('/auth/v1/token')) return json(s); if (p.startsWith('/auth/v1/logout')) return json({}, 204);
    if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/rpc/')) return json(m === 'POST' ? [] : null);
    if (p.startsWith('/rest/v1/perfis')) return json(unico ? P : [P]);
    if (p.startsWith('/rest/v1/clientes')) return json(CLIENTES, 200, { 'content-range': `0-${CLIENTES.length - 1}/${CLIENTES.length}` });
    if (p.startsWith('/rest/v1/v_negociacoes')) return json(NEGS);
    if (p.startsWith('/rest/v1/v_monitoramentos')) return json([{ id: 'm1', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', status: 'em_monitoramento', documentos: ['00.000.000/0001-01'], ultima_checagem: dia(-1), proxima_checagem: dia(1), checagem_vencida: false, responsavel_nome: 'Caio Teste', processos_ativos: 1 }]);
    if (p.startsWith('/rest/v1/colaboradores')) { const pid = (u.searchParams.get('perfil_id') || '').replace('eq.', ''); const l = pid ? COLAB.filter(x => x.perfil_id === pid) : COLAB; if (unico) return l[0] ? json(l[0]) : json({ message: 'nenhum', code: 'PGRST116' }, 406); return json(l); }
    if (p.startsWith('/rest/v1/v_tarefas')) return json([]); if (p.startsWith('/rest/v1/v_tickets')) return json([]); if (p.startsWith('/rest/v1/processos')) return json([]);
    return unico ? json({ message: 'nenhum', code: 'PGRST116' }, 406) : json([]);
  });
  const pg = await ctx.newPage(); pg.on('pageerror', e => erros.push(e.message)); pg.on('console', msg => { if (msg.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(msg.text())) erros.push('console: ' + msg.text().slice(0, 160)); });
  await pg.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && window.PP_NEG && window.PP_NEG.lista().length > 0 && !document.querySelector('#view-negociacoes')?.hidden, null, { timeout: 20000 });
  await pg.waitForTimeout(600);
  return { ctx, pg, erros, escritas, perfil: P, sim };
}
const toastTxt = (pg) => pg.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent.trim() : ''; });
/* ids visíveis: V3.1 = linhas/cartões np-ui; V2 = cards .neg-card do kanban (abertas + concluídas quando ligadas) */
const idsV3 = (pg) => pg.evaluate(() => [...document.querySelectorAll('#view-negociacoes li.np-it[data-id], #view-negociacoes .np-cardq[data-id]')].map(e => e.dataset.id).sort());
const idsV2 = (pg) => pg.evaluate(() => [...document.querySelectorAll('#view-negociacoes .neg-card[data-id]')].map(e => e.dataset.id).sort());

const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ---------- 1. paridade de dados V2 × V3.1 ----------
  rel.push('1. paridade de dados V2 × V3.1 (mesma seleção por cliente/responsável/concluídas)');
  for (const perfil of ['admin', 'juridico']) {
    const COMB = [{}, { cliente: 'c1' }, { cliente: 'c2', resp: 'col-caio' }, { resp: 'col-nat' }, { concluidas: true, escopo: 'todas' }, { cliente: 'c3', concluidas: true, escopo: 'todas' }];
    const res = {};
    for (const casca of ['v2', 'v3']) { const { ctx, pg, erros } = await contexto(b, { perfil, casca }); res[casca] = {};
      for (const f of COMB) {
        if (casca === 'v3') { await pg.evaluate((f) => { window.PP_NEG.filtro(f); }, f); await pg.waitForTimeout(120); res.v3[JSON.stringify(f)] = await idsV3(pg); }
        else { await pg.evaluate((f) => { const sels = [...document.querySelectorAll('#view-negociacoes select')]; const fc = sels[0], fr = sels[1]; const tg = document.querySelector('#view-negociacoes input[type=checkbox]'); fc.value = f.cliente || ''; fc.dispatchEvent(new Event('change')); }, f); await pg.waitForTimeout(80);
          await pg.evaluate((f) => { const sels = [...document.querySelectorAll('#view-negociacoes select')]; sels[1].value = f.resp || ''; sels[1].dispatchEvent(new Event('change')); }, f); await pg.waitForTimeout(80);
          await pg.evaluate((f) => { const tg = document.querySelector('#view-negociacoes input[type=checkbox]'); if (tg.checked !== !!f.concluidas) { tg.checked = !!f.concluidas; tg.dispatchEvent(new Event('change')); } }, f); await pg.waitForTimeout(80);
          res.v2[JSON.stringify(f)] = await idsV2(pg); } }
      if (erros.length) falha(`${perfil}/${casca}: erros de página ${JSON.stringify(erros.slice(0, 3))}`); else ok(`${perfil}/${casca}: sem erros de página`);
      await ctx.close(); }
    for (const f of COMB) { const k = JSON.stringify(f); if (JSON.stringify(res.v2[k]) === JSON.stringify(res.v3[k]) && res.v3[k].length > 0) ok(`${perfil} ${k}: ${res.v3[k].length} negociações idênticas na V2 e na V3.1`); else falha(`${perfil} ${k}: V2=${JSON.stringify(res.v2[k])} V3=${JSON.stringify(res.v3[k])}`); }
  }
  // ---------- 2. toolbar: resumo = KPIs da V2; régua/marcas/valores ----------
  rel.push('2. toolbar, resumo, régua, marcas e valores');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const r = await pg.evaluate(() => { const L = window.PP_NEG.lista(); const ab = L.filter(n => n.etapa !== 'concluido'); return { resumo: document.querySelector('.np-resumo').textContent.replace(/\s+/g, ' ').trim(), esperado: { ab: ab.length, atr: ab.filter(n => n.atrasada).length, par: ab.filter(n => n.dias_parada > 15).length, concl: L.length - ab.length }, grupos: [...document.querySelectorAll('.np-grp .np-grp-h .t')].map(e => e.textContent), fechados: [...document.querySelectorAll('.np-grp[data-aberto="0"]')].map(g => g.dataset.g), reguas: { late: document.querySelectorAll('li.np-it.r-late').length, att: document.querySelectorAll('li.np-it.r-att').length }, marcas: [...document.querySelectorAll('li.np-it .np-marca')].map(m => m.textContent), vals: document.querySelectorAll('li.np-it .np-val').length, seta: document.querySelectorAll('li.np-it .np-val .seta').length, pct: [...document.querySelectorAll('li.np-it .np-val small')].map(s => s.textContent) }; });
    const okR = r.resumo.includes(`${r.esperado.ab} abertas`) && r.resumo.includes(`${r.esperado.atr} atrasadas`) && r.resumo.includes(`${r.esperado.par} paradas`) && r.resumo.includes('em valor cobrado');
    if (okR && r.grupos.length >= 5 && !r.grupos.includes('Concluído') && r.reguas.late === 2 && r.reguas.att >= 2 && r.marcas.includes('quente') && r.marcas.some(m => /parada há \d+d/.test(m)) && r.vals === r.esperado.ab && r.seta >= 5 && r.pct.includes('−56%') && r.pct.includes('proposta')) ok(`resumo "${r.resumo}" = KPIs da V2 (concluídas viram contagem no chip e soma no rodapé); grupos por etapa (${r.grupos.join(' · ')}); régua: ${r.reguas.late} vencidas, ${r.reguas.att} paradas; marcas ${[...new Set(r.marcas)].join('/')}; valor em todas as linhas, cobrado → acordo com % (ex.: ${r.pct[0]})`); else falha('toolbar: ' + JSON.stringify(r));
    await pg.evaluate(() => window.PP_NEG.filtro({ escopo: 'todas', concluidas: true })); await pg.waitForTimeout(200);
    const g2 = await pg.evaluate(() => ({ grupos: [...document.querySelectorAll('.np-grp')].map(g => g.dataset.g + ':' + g.dataset.aberto), ordem: [...document.querySelectorAll('.np-grp')].map(g => g.dataset.g) }));
    if (g2.grupos.includes('concluido:0') && g2.ordem[g2.ordem.length - 1] === 'concluido' && g2.ordem.indexOf('iniciar') < g2.ordem.indexOf('minuta')) ok('com "Todas": grupo Concluído por último e fechado por padrão; ordem = NEG_ETAPAS'); else falha('grupos: ' + JSON.stringify(g2));
    await ctx.close(); }
  // ---------- 3. painel: campos reais, valores sem confundir conceitos ----------
  rel.push('3. painel de detalhe');
  { const { ctx, pg, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const id = NEGS[0].id; await pg.click(`li.np-it[data-id="${id}"] .np-it-abrir`); await pg.waitForTimeout(600);
    const p = await pg.evaluate(() => { const P = document.querySelector('.np-painel'); const props = {}; P.querySelectorAll('.np-props').forEach(dl => { const dts = dl.querySelectorAll('dt'); dts.forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); }); return { aberto: !P.hidden, titulo: P.querySelector('h2').textContent, trilha: P.querySelector('.np-trilha-p').textContent, props, secoes: [...P.querySelectorAll('.np-sec h3')].map(h => h.textContent), pe: [...P.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()), etapa: P.querySelector('.np-etapa')?.getAttribute('aria-label') }; });
    const pr = p.props;
    const okCampos = p.aberto && /Alfa/.test(p.trilha) && /Santander/.test(p.trilha) && /etapa 2 de 7: Negociação extrajudicial/.test(p.etapa) && /Natália/.test(pr['Responsável']) && pr['Instituição'] === 'Santander' && /quente/.test(pr['Temperatura']) && /Banco ajuizou/.test(pr['Situação']) && /0000001-11/.test(pr['Processo']) && /vencido/.test(pr['Prazo']);
    const okValores = /480\.000/.test(pr['Cobrado']) && /210\.000/.test(pr['Proposta de acordo']) && /valor proposto · ainda em negociação/.test(pr['Proposta de acordo']) && /desconto proposto −56%/.test(pr['Proposta de acordo']) && /260\.000/.test(pr['Alçada informada']) && /20%/.test(pr['Êxito gravado']) && /54\.000/.test(pr['Êxito gravado']) && /264\.000/.test(pr['Desembolso estimado']) && /estimativa R\$\s?4\.000 acima da alçada informada/.test(pr['Alçada informada']) && !/autoriz|dentro da alçada/.test(JSON.stringify(pr));
    const okReserva = /Reserva formada/.test(pr['Planejada']) && /180\.000/.test(pr['Acumulada']) && /informada pelo cliente/.test(pr['Acumulada']);
    if (okCampos && okValores && okReserva && p.secoes.includes('Valores') && p.secoes.includes('Próximo passo') && p.secoes.includes('Aguardando') && p.pe.join() === 'Mover etapa…,Editar,Mais ações' && escritas.length === 0) ok(`painel: instituição/cliente/etapa/responsável/temperatura/situação/processo; valores: cobrado 480 mil → PROPOSTA de acordo 210 mil ("valor proposto · ainda em negociação", desconto proposto −56%); êxito gravado 20% ≈ 54 mil; desembolso estimado 264 mil; alçada informada 260 mil → "estimativa R$ 4.000 acima da alçada informada" (sem "autorizado/dentro"); reserva planejada "formada" × acumulada 180 mil "informada pelo cliente"; nenhuma escrita ao abrir`); else falha('painel: ' + JSON.stringify(p));
    // negociação formalizada: rótulo "Acordo" sem "proposta"; sem êxito gravado → nenhum percentual inventado
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.evaluate(() => window.PP_NEG.filtro({ escopo: 'todas', concluidas: true })); await pg.waitForTimeout(200);
    await pg.click('.np-grp[data-g="concluido"] .np-grp-h'); await pg.waitForTimeout(300); await pg.click(`li.np-it[data-id="${NEGS[9].id}"] .np-it-abrir`); await pg.waitForTimeout(500);
    const p2 = await pg.evaluate(() => { const P = document.querySelector('.np-painel'); const props = {}; P.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { props, pe: [...P.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()) }; });
    if (p2.props['Acordo'] && /concluído/.test(p2.props['Acordo']) && !p2.props['Proposta de acordo'] && !('Êxito gravado' in p2.props) && !('Desembolso estimado' in p2.props) && !('Alçada informada' in p2.props)) ok('negociação concluída: rótulo "Acordo · concluído" (sem "proposta"); sem êxito/alçada gravados → nenhuma linha inventada'); else falha('painel concluída: ' + JSON.stringify(p2));
    // alçada: estimativa ABAIXO (c2 Sicoob: 240k + 15% de 60k = 249k × 250k) + nota de alçada possivelmente global (c2 tem 2 outras abertas); formalizada: "Acordo · acordo formalizado", desconto "sobre o cobrado"
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.click(`li.np-it[data-id="${NEGS[3].id}"] .np-it-abrir`); await pg.waitForTimeout(500);
    const p3 = await pg.evaluate(() => { const P = document.querySelector('.np-painel'); const props = {}; P.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { props, nota: [...P.querySelectorAll('.np-sec')].find(s => /Valores/.test(s.textContent))?.querySelector('.np-rodape')?.textContent || '' }; });
    if (/estimativa R\$\s?1\.000 abaixo da alçada informada/.test(p3.props['Alçada informada']) && /9\.000/.test(p3.props['Êxito gravado']) && /249\.000/.test(p3.props['Desembolso estimado']) && /2 outras negociações abertas; a alçada pode ser global/.test(p3.nota) && /estimativa, não autorização/.test(p3.nota)) ok(`alçada abaixo: "${p3.props['Alçada informada']}"; nota: "${p3.nota.slice(0, 120)}…"`); else falha('alçada abaixo: ' + JSON.stringify(p3));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.click(`li.np-it[data-id="${NEGS[4].id}"] .np-it-abrir`); await pg.waitForTimeout(500);
    const p4 = await pg.evaluate(() => { const props = {}; document.querySelectorAll('.np-painel .np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return props; });
    if (p4['Acordo'] && /acordo formalizado/.test(p4['Acordo']) && /−48% sobre o cobrado/.test(p4['Acordo']) && !/proposto/.test(p4['Acordo']) && /496\.000/.test(p4['Desembolso estimado']) && /76\.000/.test(p4['Êxito gravado'])) ok('negociação formalizada: "Acordo · acordo formalizado", desconto "−48% sobre o cobrado" (não "proposto"); êxito gravado 20% ≈ 76k; desembolso estimado 496k'); else falha('formalizada: ' + JSON.stringify(p4));
    // sem percentual de êxito e sem proposta (c1 Bradesco): só Cobrado; nenhuma estimativa
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.click(`li.np-it[data-id="${NEGS[6].id}"] .np-it-abrir`); await pg.waitForTimeout(500);
    const p5 = await pg.evaluate(() => { const props = {}; document.querySelectorAll('.np-painel .np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return props; });
    if (/45\.000/.test(p5['Cobrado']) && !('Proposta de acordo' in p5) && !('Êxito gravado' in p5) && !('Desembolso estimado' in p5) && !('Alçada informada' in p5)) ok('sem proposta, sem êxito, sem alçada: só "Cobrado"; nenhum percentual ou estimativa inventados'); else falha('sem êxito: ' + JSON.stringify(p5));
    // múltiplas negociações do mesmo cliente (c1: Santander, Itaú, Bradesco abertas + Caixa concluída): cada painel mostra só os seus valores; a reserva (do cliente) é a mesma
    const lerVal = async (id) => { await pg.keyboard.press('Escape'); await pg.waitForTimeout(250); await pg.click(`li.np-it[data-id="${id}"] .np-it-abrir`); await pg.waitForTimeout(450); return pg.evaluate(() => { const props = {}; document.querySelectorAll('.np-painel .np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { cob: props['Cobrado'], prop: props['Proposta de acordo'] || props['Acordo'] || null, alc: props['Alçada informada'] || null, acum: props['Acumulada'], t: document.querySelector('.np-painel h2').textContent }; }); };
    const m1 = await lerVal(NEGS[0].id), m2 = await lerVal(NEGS[1].id), m3 = await lerVal(NEGS[6].id);
    if (/480/.test(m1.cob) && /150/.test(m2.cob) && /45/.test(m3.cob) && m1.alc && !m2.alc && !m3.alc && m1.prop && !m2.prop && !m3.prop && m1.acum === m2.acum && m2.acum === m3.acum && /180\.000/.test(m1.acum)) ok(`múltiplas negociações do mesmo cliente: cada painel só com os próprios valores (${m1.t.split('|')[1].trim()} 480k/alçada; ${m2.t.split('|')[1].trim()} 150k sem alçada; ${m3.t.split('|')[1].trim()} 45k) e a mesma reserva do cliente (R$ 180.000); nenhum total global calculado`); else falha('múltiplas: ' + JSON.stringify({ m1, m2, m3 }));
    // Editar abre o modal da V2 (openNegForm) com a negociação certa
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.click(`li.np-it[data-id="${NEGS[2].id}"] .np-it-abrir`); await pg.waitForTimeout(400); await pg.click('.np-p-pe button:has-text("Editar")'); await pg.waitForTimeout(400);
    const md = await pg.evaluate(() => ({ h2: document.querySelector('#modalHost h2')?.textContent, tit: document.querySelector('#modalHost input[placeholder*="Ex.: CL"]')?.value, cli: document.querySelector('#modalHost select')?.value, cliDesab: document.querySelector('#modalHost select')?.disabled })); await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren());
    if (md.h2 === 'Editar negociação' && md.tit === NEGS[2].titulo && md.cli === 'c2' && md.cliDesab) ok(`Editar → modal "Editar negociação" da V2 com a negociação certa (${md.tit}), cliente fixo`); else falha('editar: ' + JSON.stringify(md));
    if (escritas.length === 0) ok('nenhuma escrita durante leitura/abertura de painéis e do modal'); else falha('escritas: ' + JSON.stringify(escritas));
    await ctx.close(); }
  // ---------- 4. mover etapa: mesma escrita do kanban V2; erro; mesma coluna ----------
  rel.push('4. mover etapa (lista, quadro e V2)');
  { const { ctx, pg, escritas, sim } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const id = NEGS[1].id; await pg.click(`li.np-it[data-id="${id}"] .np-it-abrir`); await pg.waitForTimeout(400);
    await pg.click('.np-p-pe button:has-text("Mover etapa")'); await pg.waitForTimeout(200);
    const mv = await pg.evaluate(() => [...document.querySelectorAll('#np-pop [role="menuitem"]')].map(b => b.textContent.trim() + (b.classList.contains('atual') ? ' (atual)' : '')));
    let antes = escritas.length; await pg.click('#np-pop [role="menuitem"]:has-text("Negociação extrajudicial")'); await pg.waitForTimeout(600);
    const w1 = escritas.slice(antes); const t1 = await toastTxt(pg);
    if (mv.length === 7 && /Iniciar acompanhamento \(atual\)/.test(mv[0]) && w1.length === 1 && new RegExp('PATCH /rest/v1/negociacoes\\?id=eq\\.' + id + ' .*"etapa":"extrajudicial"').test(w1[0]) && t1 === 'Negociação extrajudicial') ok(`"Mover etapa…": 7 etapas, atual marcada; mover → PATCH negociacoes{etapa} no id certo + toast "${t1}" (= aoSoltar da V2)`); else falha('mover: ' + JSON.stringify({ mv, w1, t1 }));
    // mesma etapa: nenhuma escrita
    await pg.waitForTimeout(400); const li2 = await pg.evaluate(() => !!document.querySelector('.np-painel:not([hidden])')); if (!li2) { await pg.click(`li.np-it[data-id="${id}"] .np-it-abrir`); await pg.waitForTimeout(400); }
    await pg.click('.np-p-pe button:has-text("Mover etapa")'); await pg.waitForTimeout(200); antes = escritas.length; await pg.click('#np-pop [role="menuitem"].atual'); await pg.waitForTimeout(400);
    if (escritas.length === antes) ok('mover para a etapa atual: nenhuma escrita'); else falha('mesma etapa: ' + JSON.stringify(escritas.slice(antes)));
    // erro do banco
    sim.falharPatch = true; await pg.click('.np-p-pe button:has-text("Mover etapa")'); await pg.waitForTimeout(200); antes = escritas.length; await pg.click('#np-pop [role="menuitem"]:has-text("Elaboração de minuta")'); await pg.waitForTimeout(500);
    const tE = await toastTxt(pg); const etapaDepois = await pg.evaluate((id) => window.PP_NEG.lista().find(n => n.id === id).etapa, id);
    if (tE === 'Não foi possível mover' && etapaDepois === 'extrajudicial') ok(`erro do banco: toast "${tE}" (mesmo da V2), nada muda`); else falha('erro: ' + JSON.stringify({ tE, etapaDepois })); sim.falharPatch = false;
    // quadro: colunas = NEG_ETAPAS sem Concluído (X.concluidas=false), cartões = abertas; arrastar via PP_DND gera a mesma escrita
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); await pg.click('#view-negociacoes .np-seg button:has-text("Quadro")'); await pg.waitForTimeout(500);
    const q = await pg.evaluate(() => ({ cols: [...document.querySelectorAll('.np-colq')].map(c => c.dataset.etapa), cards: document.querySelectorAll('.np-cardq').length, drag: [...document.querySelectorAll('.np-cardq')].every(c => c.getAttribute('draggable') === 'true') }));
    antes = escritas.length; await pg.dragAndDrop(`.np-cardq[data-id="${NEGS[6].id}"]`, '.np-colq[data-etapa="extrajudicial"] .np-colq-b'); await pg.waitForTimeout(600);
    const wD = escritas.slice(antes);
    if (q.cols.length === 6 && !q.cols.includes('concluido') && q.cards === 8 && q.drag && wD.length === 1 && /PATCH \/rest\/v1\/negociacoes\?id=eq\.\S+ .*"etapa":"extrajudicial"/.test(wD[0])) ok(`quadro: 6 colunas (sem Concluído, como a V2 sem "mostrar concluídas"), ${q.cards} cartões arrastáveis (PP_DND); arrastar → ${wD[0].split(' ')[0]} negociacoes{etapa}`); else falha('quadro: ' + JSON.stringify({ q, wD }));
    await pg.evaluate(() => window.PP_NEG.filtro({ escopo: 'todas', concluidas: true })); await pg.waitForTimeout(300);
    const q2 = await pg.evaluate(() => [...document.querySelectorAll('.np-colq')].map(c => c.dataset.etapa));
    if (q2.length === 7 && q2[6] === 'concluido') ok('com concluídas ligadas: 7ª coluna Concluído (regra da V2)'); else falha('quadro concluídas: ' + JSON.stringify(q2));
    await ctx.close();
    // V2: arrastar produz exatamente a mesma escrita
    const c2 = await contexto(b, { perfil: 'admin', casca: 'v2' }); const a2 = c2.escritas.length;
    await c2.pg.dragAndDrop(`.neg-card[data-id="${NEGS[7].id}"]`, '.neg-col[data-etapa="minuta"]'); await c2.pg.waitForTimeout(600);
    const w2 = c2.escritas.slice(a2).map(e => e.replace(/id=eq\.[^ ]+/, 'id=eq.X')); const w3 = wD.map(e => e.replace(/id=eq\.[^ ]+/, 'id=eq.X').replace('"extrajudicial"', '"minuta"'));
    if (w2.length === 1 && w2[0] === w3[0]) ok(`V2 (arrastar) e V3.1 geram a mesma escrita: ${w2[0]}`); else falha('paridade escrita: ' + JSON.stringify({ w2, w3 }));
    const colsV2 = await c2.pg.evaluate(() => [...document.querySelectorAll('.neg-col')].map(c => c.dataset.etapa)); if (JSON.stringify(colsV2) === JSON.stringify(q.cols)) ok('colunas V2 = colunas V3.1'); else falha('colunas: ' + JSON.stringify({ colsV2, v3: q.cols }));
    await c2.ctx.close(); }
  // ---------- 5. filtros V3.1 e "Mais filtros" ----------
  rel.push('5. filtros (chips client-side) e "Mais filtros"');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const chips = await pg.evaluate(() => [...document.querySelectorAll('#view-negociacoes .np-chipf')].map(c => c.textContent.replace(/\d+$/, '').trim()));
    const L = NEGS.filter(n => n.etapa !== 'concluido'); const cont = {}; L.forEach(n => cont[n.banco] = (cont[n.banco] || 0) + 1); const top = Object.entries(cont).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(x => x[0]);
    if (['Abertas', 'Concluídas', 'Todas', 'Atrasadas', 'Paradas', 'Minhas', 'Mais filtros'].every(c => chips.includes(c)) && top.every(b => chips.includes(b)) && !chips.includes('Caixa') && !chips.includes('Bradesco')) ok(`chips: Abertas · Concluídas · Todas | Atrasadas · Paradas · Minhas | bancos ${top.join(' · ')} (3 mais frequentes; Caixa/Bradesco só em Mais filtros)`); else falha('chips: ' + JSON.stringify({ chips, top }));
    const esperado = (f) => { const meu = 'col-ana'; return NEGS.filter(n => (!f.cliente || n.cliente_id === f.cliente) && (!f.resp || n.responsavel_id === f.resp) && (f.escopo === 'todas' || (f.escopo === 'concluidas' ? n.etapa === 'concluido' : n.etapa !== 'concluido')) && (!f.atrasadas || n.atrasada) && (!f.paradas || (n.dias_parada > 15 && n.etapa !== 'concluido')) && (!f.minhas || n.responsavel_id === meu) && (!f.bancos || f.bancos.includes(n.banco))).map(n => n.id).sort(); };
    const clicar = async (label) => { await pg.click(`#view-negociacoes .np-chipf:text-is("${label}")`); await pg.waitForTimeout(150); };
    const passos = [['Atrasadas', { escopo: 'abertas', atrasadas: true }], ['Santander', { escopo: 'abertas', atrasadas: true, bancos: ['Santander'] }], ['Atrasadas', { escopo: 'abertas', bancos: ['Santander'] }], ['Paradas', { escopo: 'abertas', bancos: ['Santander'], paradas: true }], ['Paradas', { escopo: 'abertas', bancos: ['Santander'] }], ['Santander', { escopo: 'abertas' }], ['Minhas', { escopo: 'abertas', minhas: true }], ['Minhas', { escopo: 'abertas' }], ['Concluídas', { escopo: 'concluidas' }], ['Abertas', { escopo: 'abertas' }]];
    let okC = true, det = [];
    for (const [l, f] of passos) { await clicar(l); const got = await idsV3(pg); const exp = esperado(f); if (JSON.stringify(got) !== JSON.stringify(exp)) { okC = false; det.push({ l, got, exp }); } }
    if (okC) ok('chips consecutivos (Atrasadas, banco, Paradas, Minhas, Concluídas, Abertas): conjunto esperado em cada passo'); else falha('chips: ' + JSON.stringify(det));
    // Mais filtros: trocas consecutivas sem perder o popover nem o foco
    await pg.click('#view-negociacoes .np-chipf:has-text("Mais filtros")'); await pg.waitForTimeout(250);
    const troca = async (idx, v) => { await pg.evaluate(({ idx, v }) => { const s = document.querySelectorAll('#np-pop select')[idx]; s.focus(); s.value = v; s.dispatchEvent(new Event('change')); }, { idx, v }); await pg.waitForTimeout(250); return pg.evaluate(() => ({ pop: !!document.querySelector('#np-pop.on'), foco: !!document.activeElement.closest('#np-pop'), ids: [...document.querySelectorAll('#view-negociacoes li.np-it[data-id]')].map(e => e.dataset.id).sort() })); };
    const r1 = await troca(0, 'c2'), r2 = await troca(1, 'col-caio'), r3 = await troca(2, 'Sicoob'), r4 = await troca(0, '');
    const e1 = esperado({ escopo: 'abertas', cliente: 'c2' }), e2 = esperado({ escopo: 'abertas', cliente: 'c2', resp: 'col-caio' }), e3 = esperado({ escopo: 'abertas', cliente: 'c2', resp: 'col-caio', bancos: ['Sicoob'] }), e4 = esperado({ escopo: 'abertas', resp: 'col-caio', bancos: ['Sicoob'] });
    const J = JSON.stringify;
    if ([r1, r2, r3, r4].every(r => r.pop && r.foco) && J(r1.ids) === J(e1) && J(r2.ids) === J(e2) && J(r3.ids) === J(e3) && J(r4.ids) === J(e4)) ok('"Mais filtros": cliente → responsável → banco → limpar cliente, popover aberto e foco dentro em todas, conjuntos corretos'); else falha('mais filtros: ' + J({ r1, r2, r3, r4, e1, e2, e3, e4 }));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); const f2 = await pg.evaluate(() => ({ pop: !!document.querySelector('#np-pop'), foco: document.activeElement.textContent.trim() })); if (!f2.pop && /Mais filtros/.test(f2.foco)) ok('Esc fecha "Mais filtros" e devolve o foco ao botão'); else falha('esc: ' + J(f2));
    await ctx.close(); }
  // ---------- 6. só leitura ----------
  rel.push('6. só leitura');
  { const { ctx, pg, escritas } = await contexto(b, { perfil: 'admin', casca: 'v3' }); await pg.evaluate(() => { S.canWrite = false; render(); }); await pg.waitForTimeout(300);
    const ro = await pg.evaluate(() => ({ nova: !!document.querySelector('#view-negociacoes .np-tb-dir .np-btn.pri'), n: document.querySelectorAll('li.np-it').length }));
    await pg.click('#view-negociacoes li.np-it .np-it-abrir'); await pg.waitForTimeout(400); const pe = await pg.evaluate(() => [...document.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); await pg.click('#view-negociacoes .np-seg button:has-text("Quadro")'); await pg.waitForTimeout(400);
    const roQ = await pg.evaluate(() => ({ drag: [...document.querySelectorAll('.np-cardq')].every(c => c.getAttribute('draggable') === 'false'), mover: document.querySelectorAll('.np-cardq .np-ib').length }));
    if (!ro.nova && ro.n > 0 && !pe.includes('Mover etapa…') && !pe.includes('Editar') && pe.includes('Mais ações') && roQ.drag && roQ.mover === 0 && escritas.length === 0) ok(`só leitura: sem Nova negociação, painel sem Mover/Editar (${pe.join(' · ')}), quadro sem arrastar nem "Mover"`); else falha('readOnly: ' + JSON.stringify({ ro, pe, roQ }));
    await ctx.close(); }
  // ---------- 7. teclado e ARIA ----------
  rel.push('7. teclado e ARIA');
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3' });
    const a = await pg.evaluate(() => ({ listas: document.querySelectorAll('#view-negociacoes ul.np-lst[role="list"]').length, tab: [...document.querySelectorAll('#view-negociacoes [role="tab"],#view-negociacoes [role="tablist"]')].filter(e => e.offsetParent !== null).length, hubOculto: !!document.querySelector('#view-negociacoes > .hub-tabs') && document.querySelector('#view-negociacoes > .hub-tabs').offsetParent === null, pressed: [...document.querySelectorAll('.np-chipf')].every(c => /^(true|false)$/.test(c.getAttribute('aria-pressed'))), grp: [...document.querySelectorAll('.np-grp-h')].every(h => /^(true|false)$/.test(h.getAttribute('aria-expanded'))), etapaAria: !!document.querySelector('.np-painel .np-etapa') || true, status: document.querySelector('.np-resumo').getAttribute('role') }));
    await pg.focus('#view-negociacoes li.np-it .np-it-abrir'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
    const k1 = await pg.evaluate(() => ({ aberto: !document.querySelector('.np-painel').hidden, foco: document.activeElement.getAttribute('aria-label'), atual: document.querySelectorAll('li.np-it[aria-current="true"]').length, step: document.querySelector('.np-painel .np-etapa [aria-current="step"]')?.textContent }));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); const k2 = await pg.evaluate(() => ({ fechado: document.querySelector('.np-painel').hidden, foco: document.activeElement.className }));
    if (a.listas > 0 && a.tab === 0 && a.pressed && a.grp && a.status === 'status' && k1.aberto && k1.foco === 'Fechar (Esc)' && k1.atual === 1 && k1.step && k2.fechado && /np-it-abrir/.test(k2.foco)) ok(`ARIA: listas, chips aria-pressed, grupos aria-expanded, resumo role=status, sem tablist; Enter abre o painel (foco no Fechar, aria-current na linha, etapa com aria-current=step "${k1.step}"); Esc devolve o foco`); else falha('aria: ' + JSON.stringify({ a, k1, k2 }));
    // Mover etapa por teclado: ↓ e Enter
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(400); await pg.click('.np-p-pe button:has-text("Mover etapa")'); await pg.waitForTimeout(200); await pg.keyboard.press('ArrowDown'); const fo = await pg.evaluate(() => document.activeElement.getAttribute('role')); await pg.keyboard.press('Escape');
    if (fo === 'menuitem') ok('"Mover etapa…" navegável por teclado (↑/↓ entre menuitems, Esc fecha)'); else falha('teclado mover: ' + fo);
    await ctx.close(); }
  // ---------- 7b. acessibilidade específica: contraste (texto 4,5:1; componentes 3:1) e alvos (44 px) em 375/768/1024/1440 ----------
  rel.push('7b. contraste e alvos de toque dos componentes novos (marcas, valor, etapa, popover, painel, quadro)');
  for (const tema of ['light', 'dark']) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', tema });
    await pg.evaluate(() => window.PP_NEG.filtro({ escopo: 'todas', concluidas: true })); await pg.waitForTimeout(250); await pg.click('.np-grp[data-g="concluido"] .np-grp-h'); await pg.waitForTimeout(300); // Concluído aberto: a marca "concluída" (ok) tem de existir
    await pg.click(`li.np-it[data-id="${NEGS[0].id}"] .np-it-abrir`); await pg.waitForTimeout(500); await pg.click('.np-p-pe button:has-text("Mover etapa")'); await pg.waitForTimeout(250);
    const pares = [
      { sel: '.np-resumo b', nome: 'número do resumo' }, { sel: '.np-resumo b.crit', nome: 'número crítico' }, { sel: '.np-resumo b.att', nome: 'número atenção' }, { sel: '.np-resumo span', nome: 'rótulo do resumo' },
      { sel: '.np-chipf[aria-pressed="true"]', nome: 'chip ativo' }, { sel: '.np-chipf[aria-pressed="false"]', nome: 'chip inativo' }, { sel: '.np-chipf.crit', nome: 'chip Atrasadas' },
      { sel: '.np-grp-h .t', nome: 'cabeça de grupo' }, { sel: '.np-it-prazo .d', nome: 'prazo' }, { sel: '.np-it-prazo.late .d', nome: 'prazo vencido' }, { sel: '.np-it-abrir .tx', nome: 'título' }, { sel: '.np-it-abrir .ctx', nome: 'contexto' }, { sel: '.ctx .rel.late', nome: 'relativo vencido' },
      { sel: '.np-marca.crit', nome: 'marca quente' }, { sel: '.np-marca.att', nome: 'marca morno/parada' }, { sel: '.np-marca.info', nome: 'marca frio' }, { sel: '.np-marca.ok', nome: 'marca ok' },
      { sel: '.np-val b:not(.de)', nome: 'valor (acordo)' }, { sel: '.np-val b.de', nome: 'valor cobrado (riscado)' }, { sel: '.np-val small:not(.sub)', nome: '% de desconto' }, { sel: '.np-val small.sub', nome: '"proposta"' }, { sel: '.np-val .seta', nome: 'seta', minimo: 3 },
      { sel: '.np-quem span', nome: 'responsável' }, { sel: '.np-quem b', nome: 'iniciais' },
      { sel: '.np-painel h2', nome: 'título do painel' }, { sel: '.np-props dt', nome: 'rótulo de prop' }, { sel: '.np-props dd', nome: 'valor de prop' }, { sel: '.np-props dd small', nome: 'complemento de prop' }, { sel: '.np-sec h3', nome: 'título de seção' }, { sel: '.np-trilha-p', nome: 'trilha' }, { sel: '.np-painel .np-rodape', nome: 'nota da alçada' },
      { sel: '.np-etapa li:not(.ok):not(.atual)', nome: 'ponto de etapa (borda)', prop: 'borderColor', minimo: 3 }, { sel: '.np-etapa li.ok', nome: 'ponto feito', prop: 'backgroundColor', minimo: 3 }, { sel: '.np-etapa li.atual', nome: 'ponto atual', prop: 'backgroundColor', minimo: 3 },
      { sel: '#np-pop .np-pop-i', nome: 'item do popover' }, { sel: '#np-pop .np-pop-i.atual', nome: 'item atual do popover' }, { sel: '.np-btn.pri', nome: 'botão primário' }, { sel: '.np-btn.ghost', nome: 'botão fantasma' }, { sel: '.np-btn:not(.pri):not(.ghost)', nome: 'botão secundário' },
    ];
    const m = await medirContraste(pg, pares); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    await pg.click('#view-negociacoes .np-seg button:has-text("Quadro")'); await pg.waitForTimeout(400);
    const mq = await medirContraste(pg, [{ sel: '.np-cardq .tx', nome: 'título do cartão' }, { sel: '.np-cardq .ctx', nome: 'contexto do cartão' }, { sel: '.np-cardq .pz', nome: 'prazo do cartão' }, { sel: '.np-cardq .pz.late', nome: 'prazo vencido do cartão' }, { sel: '.np-colq h3 > span:first-child', nome: 'título da coluna' }, { sel: '.np-colq h3 .n', nome: 'contagem da coluna' }]);
    const ruins = [...m.ruins, ...mq.ruins]; const n = m.medidos.length + mq.medidos.length; const faltam = [...m.ausentesObrigatorios, ...mq.ausentesObrigatorios];
    if (!ruins.length && !faltam.length) ok(`${tema} 1440: ${n} pares obrigatórios encontrados e medidos ≥ mínimo (texto 4,5:1, componentes 3:1); menor razão ${Math.min(m.minimo, mq.minimo).toFixed(2)}:1`); else falha(`${tema}: ` + (ruins.length ? 'contraste insuficiente: ' + ruins.map(p => `${p.nome} ${p.r.toFixed(2)}:1 (${p.fg} sobre ${p.bg})`).join('; ') : '') + (faltam.length ? ' · OBRIGATÓRIOS não encontrados: ' + faltam.join(', ') : ''));
    await ctx.close();
    // 375 px: o que só existe no celular (relativo junto ao prazo, valor compacto com "proposta", etapa na 3ª faixa)
    const c375 = await contexto(b, { perfil: 'admin', casca: 'v3', tema, w: 375, h: 812 });
    const m375 = await medirContraste(c375.pg, [{ sel: '.np-it-prazo .r', nome: 'relativo junto ao prazo (celular)' }, { sel: '.np-it-prazo.late .r', nome: 'relativo vencido (celular)' }, { sel: '.np-it-dir .np-val b', nome: 'valor compacto (celular)' }, { sel: '.np-it-dir .np-val small.sub', nome: '"proposta" (celular)' }, { sel: '.np-it-dir .np-marca', nome: 'marca na 3ª faixa (celular)' }, { sel: '.np-it-dir .np-quem b', nome: 'iniciais (celular)' }]);
    if (!m375.ruins.length && !m375.ausentesObrigatorios.length) ok(`${tema} 375: ${m375.medidos.length} pares exclusivos do celular medidos; menor ${m375.minimo.toFixed(2)}:1`); else falha(`${tema} 375: ` + m375.ruins.map(p => `${p.nome} ${p.r.toFixed(2)}:1`).join('; ') + (m375.ausentesObrigatorios.length ? ' · OBRIGATÓRIOS não encontrados: ' + m375.ausentesObrigatorios.join(', ') : ''));
    await c375.ctx.close(); }
  for (const [w, h] of [[375, 812], [768, 1024], [1024, 768], [1440, 900]]) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w, h, touch: true });
    const a1 = await medirAlvos(pg, '#view-negociacoes'); await pg.click('li.np-it .np-it-abrir'); await pg.waitForTimeout(500); await pg.click('.np-p-pe button:has-text("Mover etapa")'); await pg.waitForTimeout(250);
    const a2 = await medirAlvos(pg, '.np-painel'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    await pg.click('#view-negociacoes .np-seg button:has-text("Quadro")'); await pg.waitForTimeout(400); await pg.click('.np-cardq .np-ib'); await pg.waitForTimeout(250); const a3 = await medirAlvos(pg, '#view-negociacoes'); await pg.keyboard.press('Escape');
    const todos = [...a1, ...a2, ...a3]; const pequenos = todos.filter(a => a.h < 44 || (a.icone && a.w < 44));
    if (!pequenos.length) ok(`${w}px (toque): ${todos.length} alvos ≥ 44 px (lista, chips, painel, popover "Mover etapa", quadro e "Mover")`); else falha(`${w}px: alvos < 44: ` + [...new Set(pequenos.map(a => `${a.nome} ${a.w}×${a.h}`))].join(', '));
    await ctx.close(); }

  // composição em 375 px: três faixas sem sobreposição (prazo+urgência / título+contexto / marcas+responsável+progresso+valor) e nada ultrapassa a linha
  { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v3', w: 375, h: 812 });
    const comp = await pg.evaluate(() => [...document.querySelectorAll('#view-negociacoes li.np-it[data-id]')].map(li => { const r = (e) => e ? e.getBoundingClientRect() : null; const L = r(li), P = r(li.querySelector('.np-it-prazo')), T = r(li.querySelector('.np-it-abrir')), D = r(li.querySelector('.np-it-dir')); const filhos = [...li.querySelectorAll('.np-it-dir > *')].map(r);
      return { id: li.dataset.id, ok: P.bottom <= T.top + 1 && T.bottom <= D.top + 1 && D.right <= L.right + 1 && P.right <= L.right + 1 && filhos.every(f => f.right <= L.right + 1 && f.left >= L.left - 1), titulo: getComputedStyle(li.querySelector('.np-it-abrir .tx')).whiteSpace !== 'nowrap', sx: document.documentElement.scrollWidth }; }));
    const ruins = comp.filter(c => !c.ok || !c.titulo);
    if (comp.length && !ruins.length && comp[0].sx <= 375) ok(`375 px: ${comp.length} linhas em três faixas (prazo+urgência / título+contexto / marcas+responsável+progresso+valor) sem sobreposição nem estouro; título com quebra`); else falha('composição 375: ' + JSON.stringify(ruins.slice(0, 3)));
    await pg.screenshot({ path: path.join(OUT, 'v3-light-375-composicao.png') }); await ctx.close(); }
  // ---------- 8. capturas e responsivo ----------
  rel.push('8. capturas 375/768/1024/1440 × claro/escuro, sem rolagem horizontal');
  for (const tema of ['light', 'dark']) for (const w of [375, 768, 1024, 1440]) {
    const { ctx, pg, erros } = await contexto(b, { perfil: 'admin', casca: 'v3', w, h: w < 900 ? 900 : 900, tema });
    const sx = await pg.evaluate(() => document.documentElement.scrollWidth); await pg.screenshot({ path: path.join(OUT, `v3-${tema}-${w}-lista.png`) });
    if (w >= 1024 || tema === 'light') { await pg.click('#view-negociacoes li.np-it .np-it-abrir'); await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(OUT, `v3-${tema}-${w}-painel.png`) }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
    if (w === 1440) { await pg.click('#view-negociacoes .np-seg button:has-text("Quadro")'); await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `v3-${tema}-${w}-quadro.png`) }); }
    if (sx <= w && erros.length === 0) ok(`${tema} ${w}px: sem rolagem horizontal, sem erros`); else falha(`${tema} ${w}px: scrollWidth=${sx} erros=${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  for (const w of [375, 1440]) for (const tema of ['light', 'dark']) { const { ctx, pg } = await contexto(b, { perfil: 'admin', casca: 'v2', w, tema }); await pg.screenshot({ path: path.join(OUT, `v2-${tema}-${w}-kanban.png`) }); await ctx.close(); }
  // ---------- 9. V2 intacta; Fluxo PJ e Monitoramento não tocados ----------
  rel.push('9. V2 intacta sem a chave; Monitoramento e ficha do cliente (Fluxo PJ / Negociações) iguais');
  { const { ctx, pg, erros } = await contexto(b, { perfil: 'admin', casca: 'v2' });
    const v2 = await pg.evaluate(() => ({ kpis: document.querySelectorAll('#view-negociacoes .kpis .kpi, #view-negociacoes .kpis > div').length, cards: document.querySelectorAll('#view-negociacoes .neg-card').length, cols: document.querySelectorAll('#view-negociacoes .neg-col').length, np: document.querySelectorAll('#view-negociacoes .np-toolbar, #view-negociacoes .np-it').length, head: document.querySelector('#view-negociacoes h1')?.textContent }));
    if (v2.kpis >= 4 && v2.cards === 8 && v2.cols === 6 && v2.np === 0 && v2.head === 'Negociações') ok(`V2 sem a chave: cabeçalho, ${v2.kpis} KPIs, ${v2.cols} colunas, ${v2.cards} cards; nenhum componente np-ui`); else falha('v2: ' + JSON.stringify(v2));
    await pg.evaluate(() => { S.tab = 'monitoramento'; render(); }); await pg.waitForTimeout(300); const mon = await pg.evaluate(() => ({ vis: !document.querySelector('#view-monitoramento').hidden, txt: document.querySelector('#view-monitoramento').textContent.slice(0, 40) }));
    if (mon.vis && /Monitoramento/.test(mon.txt)) ok('Monitoramento processual continua renderizando pela V2'); else falha('monitoramento: ' + JSON.stringify(mon));
    if (!erros.length) ok('sem erros de página na V2'); else falha('erros V2: ' + JSON.stringify(erros));
    await ctx.close();
    // com a chave, a ficha do cliente (Negociações do cliente, cardFluxo) continua V2
    const c3 = await contexto(b, { perfil: 'admin', casca: 'v3' }); await c3.pg.evaluate(() => { S.tab = 'clientes'; S.sel = 'c1'; S.sub = 'negociacoes'; render(); }); await c3.pg.waitForTimeout(500);
    const fx = await c3.pg.evaluate(() => ({ sec: [...document.querySelectorAll('#view-clientes section h2')].map(h => h.textContent), cards: document.querySelectorAll('#view-clientes .neg-card').length }));
    if (fx.sec.includes('Negociações') && fx.sec.includes('Monitoramento processual') && fx.cards === 4) ok(`ficha do cliente com a chave: aba Negociações da V2 intacta (${fx.cards} cards do cliente)`); else falha('ficha: ' + JSON.stringify(fx));
    await c3.ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.') + '\n'; fs.writeFileSync(path.join(OUT, 'relatorio-negociacoes-lab.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
