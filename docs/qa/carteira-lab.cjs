/* Laboratório da entrega visual V3 — Clientes → Carteira em V3.1 (faixa, lista com régua, painel). Playwright + Chromium locais;
   reaproveita o servidor e as fixtures fictícias do integracoes-lab (mesma carteira c1…c8), com rotas extras para contratos em atraso,
   em acordo, PF, ficha de passagem e processos ativos. TODA chamada a *.supabase.co é interceptada; nada sai da máquina.
   Uso: NODE_PATH=<módulos> node docs/qa/carteira-lab.cjs [pasta de saída]  (padrão /tmp/carteira-lab)
   Verifica: mesmas contas da V2 (saldo, atraso, negociação), grupos, régua pelo próximo prazo, marcas sem pílula, filtros, painel
   (props, contratos, prazos, acompanhamento), ações iguais às da V2 (abrir ficha, editar cliente, exportar), nenhuma gravação,
   permissões (perfil sem Clientes não carrega o módulo), V2 intacta, 375 px sem rolagem lateral, contraste nos dois temas. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/carteira-lab'; fs.mkdirSync(OUT, { recursive: true });
// cabeçalho do integracoes-lab (servidor, fixtures, contexto) executado como módulo — a mesma carteira fictícia em todos os laboratórios
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,CLIENTES,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, CLIENTES, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };

/* contratos: c1 com um em atraso (ajuizado) e um em dia; c3 em acordo; c4 em atraso (cobrança); c6 PF sem contrato */
const CONTRATOS = [
  { id: 'k1', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Santander', produto: 'giro', situacao: 'ajuizado', valorOriginal: 500000, saldoAtual: 480000, dataInicioAtraso: dia(-120) } },
  { id: 'k2', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Itaú', produto: 'contagar', situacao: 'emdia', valorOriginal: 150000, saldoAtual: 150000 } },
  { id: 'k3', cliente_id: 'c3', dados: { clienteId: 'c3', banco: 'Sicoob', produto: 'veiculo', situacao: 'acordo', valorOriginal: 300000, saldoAtual: 300000 } },
  { id: 'k4', cliente_id: 'c4', dados: { clienteId: 'c4', banco: 'Banco do Brasil', produto: 'cheque', situacao: 'cobranca', valorOriginal: 90000, saldoAtual: 95000, dataInicioAtraso: dia(-40) } },
  { id: 'k5', cliente_id: 'c5', dados: { clienteId: 'c5', banco: 'Caixa', produto: 'pronampe', situacao: 'quitado', valorOriginal: 70000, saldoAtual: 0 } },
];
const PASSAGEM = [{ cliente_id: 'c1', situacao: 'inadimplente' }, { cliente_id: 'c3', situacao: 'adimplente' }, { cliente_id: 'c4', situacao: 'vai_ficar_inadimplente' }];
const PROC = [{ cliente_id: 'c1', status: 'ativo' }, { cliente_id: 'c1', status: 'ativo' }, { cliente_id: 'c8', status: 'ativo' }];
async function abrirCarteira(b, o = {}) {
  const r = await contexto(b, { hash: '#clientes', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(contratos|v_cliente_passagem|processos|clientes)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/contratos')) return json(rota, CONTRATOS);
    if (p.startsWith('/rest/v1/v_cliente_passagem')) return json(rota, PASSAGEM);
    if (p.startsWith('/rest/v1/processos') && /status/.test(u.searchParams.get('select') || '')) return json(rota, PROC);
    if (p.startsWith('/rest/v1/clientes') && /tipo_pessoa/.test(u.searchParams.get('select') || '')) return json(rota, CLIENTES.map((c) => ({ id: c.id, nome: c.nome, ativo: true, status: c.status, tipo_pessoa: c.id === 'c6' ? 'PF' : 'PJ', cidade: c.cidade, segmento: c.segmento, etapa_fluxo: c.id === 'c2' ? 2 : 6 })));
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined' && (!PP.temAcesso('clientes') || (S.clientes && S.clientes.length > 0)), null, { timeout: 20000 });
  if (o.casca !== 'v2' && o.perfil !== 'juridico') await r.pg.waitForFunction(() => document.querySelector('#np-carteira li.np-it') && window.PP_CARTEIRA_V3?.estado?.().prazos != null && window.PP_CLIENTES_VISAO?.dados?.(), null, { timeout: 15000 });
  await r.pg.waitForTimeout(400);
  return r;
}
const estadoLista = (pg) => pg.evaluate(() => {
  const g = [...document.querySelectorAll('#np-carteira .np-grp')].map(x => ({ t: x.querySelector('.np-grp-h .t')?.textContent, n: +x.querySelector('.np-grp-h .n')?.textContent, ids: [...x.querySelectorAll('li.np-it')].map(li => li.dataset.id) }));
  const linha = (id) => { const li = document.querySelector(`#np-carteira li.np-it[data-id="${id}"]`); if (!li) return null; return { regua: [...li.classList].filter(c => /^r-/.test(c)), prazo: li.querySelector('.np-it-prazo')?.textContent.replace(/\s+/g, ' ').trim(), titulo: li.querySelector('.np-it-abrir .tx, .np-it-abrir')?.textContent.replace(/\s+/g, ' ').trim(), marcas: [...li.querySelectorAll('.np-marca')].map(m => m.textContent + (m.className.includes(' ') ? '|' + m.className.split(' ').slice(1).join('.') : '')), val: li.querySelector('.np-cart-val')?.textContent.replace(/\s+/g, ' ') || null, quem: li.querySelector('.np-quem')?.textContent.replace(/\s+/g, ' ').trim(), pilulas: li.querySelectorAll('.pill').length }; };
  return { resumo: document.querySelector('#np-carteira .np-resumo')?.textContent.replace(/\s+/g, ' ').trim(), chips: [...document.querySelectorAll('#np-carteira .np-chipf')].map(c => c.textContent.replace(/\s+/g, ' ').trim() + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')), grupos: g, c1: linha('c1'), c4: linha('c4'), c6: linha('c6'), c3: linha('c3'), rodape: document.querySelector('#np-carteira .np-rodape')?.textContent.replace(/\s+/g, ' ').trim(), v2: !!document.querySelector('#main .kpis, #main table'), acao: document.querySelector('#np-acao .np-btn, #np-carteira .np-tb-dir .np-btn.pri')?.textContent.trim() || null };
});
const painel = (pg) => pg.evaluate(() => { const p = document.querySelector('#np-carteira .np-painel'); if (!p || p.hidden) return null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { titulo: p.querySelector('h2')?.textContent, trilha: p.querySelector('.np-trilha-p')?.textContent.replace(/\s+/g, ' ').trim(), props, secs: [...p.querySelectorAll('.np-sec h3')].map(h => h.textContent), contratos: [...p.querySelectorAll('.np-sec .np-tab tbody tr')].map(tr => [...tr.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')), prazos: [...p.querySelectorAll('.np-sec .np-passos li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()), total: p.querySelector('.np-cart-total')?.textContent.replace(/\s+/g, ' ').trim() || null, pe: [...p.querySelectorAll('.np-p-pe button')].map(b => b.textContent.trim()) }; });

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. Lista: mesmas contas da V2, grupos, régua, marcas ==========
  rel.push('1. Carteira V3.1 — faixa, grupos, régua, marcas (perfil admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrirCarteira(b, {});
    const e = await estadoLista(pg);
    if (/^8 clientes/.test(e.resumo) && /R\$ 1 mi em contratos/.test(e.resumo) && /2 com atraso/.test(e.resumo) && /1 inadimplentes/.test(e.resumo)) ok(`resumo: "${e.resumo}" (saldo exclui quitado; 2 clientes com atraso; inadimplentes da ficha de passagem)`); else falha('resumo: ' + e.resumo);
    const gt = e.grupos.map(g => g.t + ':' + g.ids.join(','));
    if (JSON.stringify(gt) === JSON.stringify(['Contratos em atraso:c4,c1', 'Em negociação ou acordo:c3', 'Sem contratos ativos:c2,c5,c7,c8,c6'])) ok('grupos na ordem atraso → negociação → sem contratos; dentro do grupo, ordem alfabética (Delta antes de Empresa Alfa; quitado não conta como ativo)'); else falha('grupos: ' + JSON.stringify(gt));
    if (e.c1 && e.c1.regua.includes('r-late') && /há 3 dias/.test(e.c1.prazo) && e.c1.val === 'R$ 630.000' && e.c1.marcas.some(m => /^1 em atraso\|late/.test(m)) && e.c1.marcas.some(m => /inadimplente com bancos\|crit/.test(m)) && e.c1.marcas.some(m => /^2 processos/.test(m)) && e.c1.pilulas === 0) ok(`c1: régua de prazo vencido (R2 há 3 dias), saldo R$ 630.000, marcas itálicas "1 em atraso" (vinho), "inadimplente com bancos", "2 processos"; nenhuma pílula`); else falha('c1: ' + JSON.stringify(e.c1));
    if (e.c3 && e.c3.marcas.some(m => /em negociação\|info/.test(m)) && e.c3.val === 'R$ 300.000') ok('c3: "em negociação" (azul) e saldo do contrato em acordo'); else falha('c3: ' + JSON.stringify(e.c3));
    if (e.c6 && e.c6.val === null && /ninguém/.test(e.c6.quem || '') && e.c6.regua.length === 0) ok('c6 (PF, sem contrato, sem prazo): sem valor, "— ninguém —", sem régua'); else falha('c6: ' + JSON.stringify(e.c6));
    if (e.chips.includes('Todos*') && e.chips.some(c => /^PF\s*1$/.test(c)) && e.chips.some(c => /^Em atraso\s*2$/.test(c)) && e.chips.some(c => /^Em negociação\s*1$/.test(c)) && e.chips.some(c => /^Com processo\s*2$/.test(c)) && e.chips.some(c => /^Inadimplentes\s*1$/.test(c)) && e.chips.some(c => /^Meus\s*3$/.test(c))) ok('filtros: Todos/PJ/PF (escopo) | Em atraso 2 · Em negociação 1 · Com processo 2 · Inadimplentes 1 · Meus 3'); else falha('chips: ' + JSON.stringify(e.chips));
    if (e.acao === '+ Novo cliente' && !e.v2) ok('ação primária "+ Novo cliente" (na lateral em ≥ 901 px); nada da lista V2 (cartões/tabela) na tela'); else falha('ação/v2: ' + JSON.stringify([e.acao, e.v2]));
    // filtros cumulativos e escopo
    await pg.click('#np-carteira .np-chipf:has-text("Em atraso")'); let f = await estadoLista(pg);
    const ids1 = f.grupos.flatMap(g => g.ids); await pg.click('#np-carteira .np-chipf:has-text("Inadimplentes")'); const f2 = await estadoLista(pg); const ids2 = f2.grupos.flatMap(g => g.ids);
    await pg.click('#np-carteira .np-chipf:has-text("Em atraso")'); await pg.click('#np-carteira .np-chipf:has-text("Inadimplentes")');
    await pg.click('#np-carteira .np-chipf:has-text("PF")'); const f3 = await estadoLista(pg); const ids3 = f3.grupos.flatMap(g => g.ids); await pg.click('#np-carteira .np-chipf:has-text("Todos")');
    if (ids1.join() === 'c4,c1' && ids2.join() === 'c1' && ids3.join() === 'c6' && /2 de 8 clientes com estes filtros/.test(f.rodape)) ok('Em atraso → c4, c1; + Inadimplentes → só c1 (cumulativo); escopo PF → c6; rodapé "2 de 8 clientes com estes filtros"'); else falha('filtros: ' + JSON.stringify([ids1, ids2, ids3, f.rodape]));
    // Mais filtros: busca por nome sem acento e por CNPJ
    await pg.click('#np-carteira .np-chipf[aria-haspopup="dialog"]'); await pg.fill('#np-pop input[type=search]', 'epsilon'); await pg.waitForTimeout(450); const b1 = (await estadoLista(pg)).grupos.flatMap(g => g.ids);
    await pg.fill('#np-pop input[type=search]', '0001-08'); await pg.waitForTimeout(450); const b2 = (await estadoLista(pg)).grupos.flatMap(g => g.ids);
    await pg.click('#np-pop button:has-text("Limpar")'); await pg.waitForTimeout(200); const b3 = (await estadoLista(pg)).grupos.flatMap(g => g.ids).length;
    if (b1.join() === 'c5' && b2.join() === 'c8' && b3 === 8) ok('Mais filtros: "epsilon" acha Épsilon (sem acento); "0001-08" acha pelo CNPJ (Theta); Limpar volta aos 8'); else falha('busca: ' + JSON.stringify([b1, b2, b3]));
    // ========== painel ==========
    await pg.click('#np-carteira li.np-it[data-id="c1"] .np-it-abrir'); await pg.waitForFunction(() => { const p = document.querySelector('#np-carteira .np-painel'); return p && !p.hidden && p.querySelector('h2')?.textContent; }, null, { timeout: 8000 }); await pg.waitForTimeout(700);
    const p = await painel(pg);
    if (p && p.titulo === 'Empresa Alfa Ltda' && /Clientes · Carteira/.test(p.trilha) && p.props.CNPJ === '00.000.000/0001-01' && p.props['Com os bancos'] === 'Inadimplente' && p.props['Processos ativos'] === '2' && /Estratégico: Ana Teste/.test(p.props.Frentes || '')) ok('painel de c1: trilha "Clientes · Carteira", CNPJ, situação com os bancos, processos, frente estratégica'); else falha('painel props: ' + JSON.stringify(p));
    if (p && p.contratos.length === 2 && /^Santander \| Capital de giro \| R\$ 480\.000 \| em atraso$/.test(p.contratos[0]) && /^Itaú \| Conta garantida \| R\$ 150\.000 \| Em dia$/.test(p.contratos[1]) && /R\$ 630\.000/.test(p.total || '')) ok('contratos ativos do próprio c1 (maior saldo primeiro), situação "em atraso" como marca, total R$ 630.000; quitado de outro cliente fora'); else falha('contratos: ' + JSON.stringify([p?.contratos, p?.total]));
    if (p && p.prazos.length === 4 && /R2 — Empresa Alfa/.test(p.prazos[0]) && /Protocolar embargos.*fatal/.test(p.prazos[1]) && p.secs.some(s => /^Acompanhamento PJ/.test(s))) ok('próximos prazos de c1 (4, do mais antigo; fatal indicado) + bloco do Acompanhamento PJ reaproveitado'); else falha('prazos: ' + JSON.stringify([p?.prazos, p?.secs]));
    if (p && JSON.stringify(p.pe) === JSON.stringify(['Abrir ficha', 'Editar cliente'])) ok('rodapé do painel: "Abrir ficha" e "Editar cliente" (as mesmas ações da V2)'); else falha('pé: ' + JSON.stringify(p?.pe));
    // trocar de linha com o painel aberto: identidade correta
    await pg.click('#np-carteira li.np-it[data-id="c4"] .np-it-abrir'); await pg.waitForTimeout(700); const p4 = await painel(pg);
    if (p4 && p4.titulo === 'Delta Transportes' && p4.contratos.length === 1 && /Banco do Brasil/.test(p4.contratos[0]) && p4.props['Com os bancos'] === 'Vai ficar inadimplente') ok('trocar para c4 com o painel aberto: dados de c4 (nada de c1)'); else falha('c4: ' + JSON.stringify(p4));
    // Editar cliente: abre o formulário atual com o cliente certo; nada é gravado
    await pg.click('#np-carteira .np-painel .np-p-pe button:has-text("Editar cliente")'); await pg.waitForTimeout(600);
    const mod = await pg.evaluate(() => { const m = document.querySelector('#modalHost .modal [role=dialog]'); return m ? m.textContent.replace(/\s+/g, ' ').slice(0, 200) + (m.querySelector('input')?.value === 'Delta Transportes' ? ' [nome=Delta Transportes]' : '') : null; });
    if (mod && /Editar cliente/.test(mod) && /\[nome=Delta Transportes\]/.test(mod)) ok('"Editar cliente" abre o formulário atual (openClientForm) com o cliente do painel'); else falha('editar: ' + mod);
    await pg.click('#modalHost button:has-text("Cancelar")'); await pg.waitForTimeout(300); // o modal V2 fecha por "Cancelar" (Esc no modal V2 é escopo da V5)
    // Abrir ficha
    await pg.evaluate(() => { const b = [...document.querySelectorAll('#np-carteira .np-painel .np-p-pe button')].find(x => /Abrir ficha/.test(x.textContent)); b && b.click(); }); await pg.waitForTimeout(800);
    const fic = await pg.evaluate(() => ({ sel: S.sel, h1: document.querySelector('#main h1')?.textContent, carteira: !!document.querySelector('#np-carteira') }));
    if (fic.sel === 'c4' && /Delta Transportes/.test(fic.h1 || '') && !fic.carteira) ok('"Abrir ficha" leva à ficha de c4 (S.sel), como o clique da V2'); else falha('ficha: ' + JSON.stringify(fic));
    await pg.evaluate(() => { S.sel = null; render(); }); await pg.waitForTimeout(500);
    const volta = await estadoLista(pg); if (volta.grupos.length === 3) ok('voltar da ficha: Carteira V3.1 de novo'); else falha('volta: ' + JSON.stringify(volta.grupos));
    // Exportar CSV pela lista filtrada (mesmas colunas da V2)
    const dl = pg.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await pg.click('#np-carteira .np-ib[aria-label="Mais ações"]'); await pg.click('#np-pop button:has-text("Exportar CSV")'); const d = await dl;
    if (d) { const txt = fs.readFileSync(await d.path(), 'utf8'); const linhas = txt.trim().split(/\r?\n/); if (linhas.length === 9 && /Saldo em contratos/.test(linhas[0]) && /Empresa Alfa Ltda/.test(txt)) ok('Exportar CSV: 8 clientes + cabeçalho, mesmas colunas da V2'); else falha('csv: ' + linhas.length + ' ' + linhas[0]); } else falha('csv: nenhum download');
    const contrato = await pg.evaluate(() => ['registrar', 'openAndamentoForm', 'openProcessoForm', 'abrirProcesso', 'processosDoCliente'].map(k => k + ':' + typeof window.PP_CARTEIRA?.[k]));
    if (contrato.every(x => /:function$/.test(x))) ok('contrato público da carteira V2 (PP_CARTEIRA: registrar, andamento, processo…) intacto — a V3 usa PP_CARTEIRA_V3'); else falha('PP_CARTEIRA: ' + contrato.join(' '));
    if (!escritas.length) ok('nenhuma gravação no banco'); else falha('escritas: ' + escritas.join(' || '));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + erros.join(' | '));
    await pg.screenshot({ path: path.join(OUT, 'carteira-1440.png') });
    await ctx.close(); }
  // ========== 2. Permissões e V2 ==========
  rel.push('2. Permissões e V2 intacta');
  { const { ctx, pg, erros } = await abrirCarteira(b, { casca: 'v2' }); const e = await pg.evaluate(() => ({ v3: !!document.querySelector('#np-carteira'), kpis: !!document.querySelector('#main .kpis'), tabela: document.querySelectorAll('#main table tbody tr').length }));
    if (!e.v3 && e.kpis && e.tabela === 8) ok('casca V2: lista V2 original (cartões + tabela de 8), sem nada da V3.1'); else falha('v2: ' + JSON.stringify(e));
    if (!erros.length) ok('V2 sem erros de página'); else falha('erros v2: ' + erros.join(' | ')); await ctx.close(); }
  { const { ctx, pg, leituras } = await abrirCarteira(b, { perfil: 'juridico' }); await pg.waitForTimeout(800); const e = await pg.evaluate(() => ({ tab: S.tab, carteira: !!document.querySelector('#np-carteira'), prazos: window.PP_CARTEIRA_V3 ? window.PP_CARTEIRA_V3.estado().prazos : null }));
    const lidas = leituras.filter(l => /v_tarefas\?select=id%2Ccliente_id%2Ctitulo%2Cprazo%2Cprazo_fatal/.test(l)).length;
    if (e.tab !== 'clientes' && !e.carteira && e.prazos === null && lidas === 0) ok(`perfil sem acesso a Clientes, mesmo abrindo #clientes: vai para "${e.tab}", nenhuma Carteira desenhada e nenhuma leitura da Carteira`); else falha('juridico: ' + JSON.stringify([e, lidas])); await ctx.close(); }
  { const { ctx, pg, erros } = await abrirCarteira(b, { perfil: 'acordos' }); const e = await estadoLista(pg);
    if (e.grupos.flatMap(g => g.ids).length === 8 && !erros.length) ok('perfil Acordos (acesso a Clientes): mesma carteira, sem erro'); else falha('acordos: ' + JSON.stringify([e.grupos, erros])); await ctx.close(); }
  // ========== 3. 375 px e contraste ==========
  rel.push('3. 375 px, contraste e alvos');
  for (const tema of ['light', 'dark']) {
    const { ctx, pg } = await abrirCarteira(b, { w: 375, h: 812, tema });
    const lado = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const m = await medirContraste(pg, [{ sel: '#np-carteira .np-resumo b', nome: 'número do resumo' }, { sel: '#np-carteira .np-resumo span', nome: 'rótulo do resumo' }, { sel: '#np-carteira .np-grp-h .t', nome: 'título do grupo' }, { sel: '#np-carteira li.np-it .np-it-abrir', nome: 'título da linha' }, { sel: '#np-carteira li.np-it .np-it-ctx, #np-carteira li.np-it .np-it-abrir .m', nome: 'secundário', opcional: true }, { sel: '#np-carteira .np-marca.crit', nome: 'marca crítica' }, { sel: '#np-carteira .np-marca.info', nome: 'marca info' }, { sel: '#np-carteira .np-cart-val b', nome: 'valor' }, { sel: '#np-carteira .np-it-prazo.late .d', nome: 'prazo vencido' }, { sel: '#np-carteira .np-chipf', nome: 'filtro' }]);
    if (lado <= 0 && !m.ruins.length && !m.ausentesObrigatorios.length) ok(`375 px ${tema}: sem rolagem lateral; contraste mínimo ${m.minimo.toFixed(2)}:1 em ${m.medidos.length} pares`); else falha(`375 ${tema}: lado=${lado} ruins=${JSON.stringify(m.ruins)} ausentes=${m.ausentesObrigatorios}`);
    const alv = await medirAlvos(pg, '#np-carteira'); const peq = alv.filter(a => a.h < 44 && !/np-it$/.test(a.nome));
    if (!peq.length) ok(`375 px ${tema}: alvos de toque ≥ 44 px (${alv.length} medidos)`); else falha(`alvos ${tema}: ` + JSON.stringify(peq.slice(0, 6)));
    await pg.click('#np-carteira li.np-it[data-id="c1"] .np-it-abrir'); await pg.waitForTimeout(800);
    const cheia = await pg.evaluate(() => { const p = document.querySelector('#np-carteira .np-painel'); return p && !p.hidden ? p.dataset.modo : null; });
    if (cheia === 'cheia') ok(`375 px ${tema}: painel em tela cheia`); else falha('painel 375: ' + cheia);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); const fechou = await pg.evaluate(() => document.querySelector('#np-carteira .np-painel')?.hidden && document.activeElement?.closest('li.np-it')?.dataset.id);
    if (fechou === 'c1') ok(`375 px ${tema}: Esc fecha o painel e devolve o foco à linha de origem`); else falha('esc: ' + fechou);
    await pg.screenshot({ path: path.join(OUT, `carteira-375-${tema}.png`) }); await ctx.close();
  }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
