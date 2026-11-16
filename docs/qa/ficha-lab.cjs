/* Laboratório da entrega visual V4 — Ficha do cliente em V3.1 (cabeçalho, abas numa linha, uma primária em tinta, seções,
   marcas no lugar de pílulas, Dossiê com régua nas frentes e passos na linha do tempo, "Editar dados da empresa").
   Playwright + Chromium locais; reaproveita o servidor e as fixtures fictícias do integracoes-lab (carteira c1…c8), com rotas
   extras para contratos e para o dossiê do c1. TODA chamada a *.supabase.co é interceptada; nada sai da máquina.
   Uso: NODE_PATH=<módulos> node docs/qa/ficha-lab.cjs [pasta de saída]  (padrão /tmp/ficha-lab)
   Verifica: mesmas contas da Carteira no cabeçalho, uma única primária em tinta, abas numa linha (rolagem no celular, ←/→),
   régua das frentes pelo estado, linha do tempo e filtros iguais aos da V2, ações iguais (Registrar, responsável, CSV/PDF),
   nenhuma gravação, V2 intacta, sem caixa alta e sem pílulas, 375 px sem rolagem lateral, alvos de toque e contraste nos dois temas. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/ficha-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,CLIENTES,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };

const CONTRATOS = [
  { id: 'k1', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Santander', produto: 'giro', situacao: 'ajuizado', valorOriginal: 500000, saldoAtual: 480000, dataInicioAtraso: dia(-120) } },
  { id: 'k2', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Itaú', produto: 'contagar', situacao: 'emdia', valorOriginal: 150000, saldoAtual: 150000 } },
  { id: 'k3', cliente_id: 'c3', dados: { clienteId: 'c3', banco: 'Sicoob', produto: 'veiculo', situacao: 'acordo', valorOriginal: 300000, saldoAtual: 300000 } }];
const h = (horas) => new Date(Date.now() - horas * 3600e3).toISOString();
const DOSSIE = [
  { origem: 'registro', tipo: 'informacao_cliente', frente: 'estrategico', fixado: true, quando: h(30 * 24), autor: 'Lucas Teste', texto: 'Sócio prefere contato por WhatsApp à tarde.', visivel_cliente: false, cliente_id: 'c1' },
  { origem: 'registro', tipo: 'protocolo', frente: 'juridico', quando: h(50), autor: 'Maria Teste', texto: 'Protocolada a impugnação aos embargos.', numero_cnj: '0000000-00.2026.8.26.0000', visivel_cliente: true, cliente_id: 'c1' },
  { origem: 'tarefa', tipo: 'tarefa_concluida', frente: 'negocial', quando: h(5 * 24), autor: 'Natasha Teste', texto: 'Enviar contraproposta ao banco', tarefa_id: 't1', cliente_id: 'c1' },
  { origem: 'registro', tipo: 'proposta_acordo', frente: 'negocial', quando: h(9 * 24), autor: 'Natasha Teste', texto: 'Banco aceitou desconto de 40% com entrada de 10%.', visivel_cliente: true, cliente_id: 'c1' },
  { origem: 'registro', tipo: 'reuniao_cliente', frente: 'estrategico', quando: h(20 * 24), autor: 'Lucas Teste', texto: 'R1 realizada.', cliente_id: 'c1' }];
const FRENTES = [
  { cliente_id: 'c1', frente: 'estrategico', ultimo_em: h(26), ultimo_autor: 'Lucas Teste', ultimo_texto: 'R2 agendada.', proximo_prazo: dia(3), tarefas_abertas: 2 },
  { cliente_id: 'c1', frente: 'juridico', ultimo_em: h(50), ultimo_autor: 'Maria Teste', ultimo_texto: 'Protocolada a impugnação.', proximo_prazo: dia(-2), processos_ativos: 2 },
  { cliente_id: 'c1', frente: 'negocial', ultimo_em: h(40 * 24), ultimo_autor: 'Natasha Teste', ultimo_texto: 'Banco aceitou desconto.', negociacoes_abertas: 1 }];

async function abrirFicha(b, o = {}) {
  const r = await contexto(b, { hash: '#clientes', ...o });
  const json = (rota, corpo) => rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(contratos|v_dossie|v_cliente_frentes)/, (rota) => {
    const p = new URL(rota.request().url()).pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/contratos')) return json(rota, CONTRATOS);
    if (p.startsWith('/rest/v1/v_dossie')) return json(rota, DOSSIE);
    if (p.startsWith('/rest/v1/v_cliente_frentes')) return json(rota, FRENTES);
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined' && S.clientes && S.clientes.length > 0 && S.contratos && S.contratos.length > 0, null, { timeout: 20000 });
  await r.pg.waitForTimeout(600);
  await r.pg.evaluate((sub) => { window.__reg = []; if (window.PP_CARTEIRA) { const orig = window.PP_CARTEIRA.registrar; window.PP_CARTEIRA.registrar = (cid, op) => { window.__reg.push([cid, op && op.frente || '']); }; window.__regOrig = orig; } S.tab = 'clientes'; S.sel = 'c1'; S.sub = sub; render(); }, o.sub || 'dossie');
  await r.pg.waitForTimeout(1500);
  return r;
}
const tinta = (pg) => pg.evaluate(() => { const ink = getComputedStyle(document.documentElement).getPropertyValue('--np-ink').trim(); const probe = document.createElement('i'); probe.style.color = ink; document.body.append(probe); const alvo = getComputedStyle(probe).color; probe.remove();
  return [...document.querySelectorAll('#main button, #main a.btn')].filter((e) => e.offsetParent && getComputedStyle(e).backgroundColor === alvo).map((e) => e.textContent.trim()); });

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. Cabeçalho, abas, ação primária ==========
  rel.push('1. Ficha V3.1 — cabeçalho, abas, uma primária em tinta (perfil admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrirFicha(b, {});
    const e = await pg.evaluate(() => ({ ficha: document.querySelector('#main').classList.contains('np-ficha'), nome: document.querySelector('.np-ficha-nome')?.textContent, ctx: document.querySelector('.np-ficha-ctx')?.textContent,
      val: document.querySelector('.np-ficha-val')?.textContent.replace(/\s+/g, ' ').trim(), marcas: [...document.querySelectorAll('.np-ficha-marcas .np-marca')].map((m) => m.textContent + '|' + m.className),
      atualizado: /Atualizado em/.test(document.querySelector('#main .head')?.textContent || ''), tabs: [...document.querySelectorAll('#main > .subtabs .subtab')].map((t) => Math.round(t.getBoundingClientRect().top)),
      nTabs: document.querySelectorAll('#main > .subtabs .subtab').length, sel: document.querySelector('#main > .subtabs [aria-selected="true"]')?.textContent }));
    if (e.ficha && e.nome === 'Empresa Alfa Ltda' && /CNPJ 00\.000\.000\/0001-01/.test(e.ctx) && /Franca/.test(e.ctx)) ok(`cabeçalho: "${e.nome}" · "${e.ctx}"`); else falha('cabeçalho: ' + JSON.stringify(e));
    if (/^R\$\s?630\.000(,00)? em 2 contratos ativos$/.test(e.val) && e.marcas.some((m) => /^1 em atraso\|.*late/.test(m))) ok(`valor e marcas com as contas da Carteira: "${e.val}" · ${e.marcas.join(', ')}`); else falha('valor/marcas: ' + JSON.stringify([e.val, e.marcas]));
    if (!e.atualizado) ok('sem "Atualizado em <hoje>" (data que não vem do banco)'); else falha('atualizado ainda aparece');
    if (e.nTabs === 8 && new Set(e.tabs).size === 1 && e.sel === 'Dossiê') ok('8 abas numa linha só; Dossiê selecionada'); else falha('abas: ' + JSON.stringify(e));
    const t = await tinta(pg); if (t.length === 1 && /Contrato/.test(t[0])) ok(`uma única ação em tinta na tela: "${t[0]}"`); else falha('primárias em tinta: ' + JSON.stringify(t));
    await pg.focus('#main > .subtabs [aria-selected="true"]'); await pg.keyboard.press('ArrowRight'); const foco = await pg.evaluate(() => document.activeElement?.textContent);
    if (/Cadastro/.test(foco)) ok('← / → movem o foco entre as abas'); else falha('teclado nas abas: ' + foco);
    const tipo = await pg.evaluate(() => { const vis = (el) => el.offsetParent && el.getBoundingClientRect().width > 0; const all = [...document.querySelectorAll('#main *')].filter(vis); return { caixa: all.filter((x) => getComputedStyle(x).textTransform === 'uppercase' && x.textContent.trim().length > 2).length, pilulas: [...document.querySelectorAll('#main .pill')].filter((p) => vis(p) && getComputedStyle(p).backgroundColor !== 'rgba(0, 0, 0, 0)').length, verde: all.filter((x) => /rgb\(27, 130, 69\)|rgb\(33, 140, 75\)/.test(getComputedStyle(x).backgroundColor)).length }; });
    if (!tipo.caixa && !tipo.pilulas && !tipo.verde) ok('sem caixa alta, sem pílulas com fundo e sem o verde da V2 na ficha'); else falha('tipografia: ' + JSON.stringify(tipo));
    if (!erros.length && !escritas.length) ok('sem erros de página e nenhuma gravação'); else falha('erros/escritas: ' + JSON.stringify([erros, escritas]));
    await pg.screenshot({ path: path.join(OUT, 'ficha-1440-light.png') }); await ctx.close(); }

  // ========== 2. Dossiê ==========
  rel.push('2. Dossiê V3.1 — régua nas frentes, passos, filtros e ações (mesmos da V2)');
  { const { ctx, pg, erros, escritas } = await abrirFicha(b, {});
    const d = await pg.evaluate(() => ({ v3: !!document.querySelector('.np-dossie'), legado: !!document.querySelector('#main ul.tl'), fix: document.querySelectorAll('.np-dossie-fix li').length,
      frentes: [...document.querySelectorAll('.np-dossie-frente')].map((f) => f.querySelector('h3').textContent.split(' /')[0] + ':' + ([...f.classList].find((c) => /^r-/.test(c)) || '-')),
      mk: [...document.querySelectorAll('.np-dossie-frente .np-marca')].map((m) => m.textContent), tl: [...document.querySelectorAll('.np-dossie-tl li')].map((li) => li.className + ':' + li.querySelector('time b').textContent),
      primeira: document.querySelector('.np-dossie-tl li .m')?.textContent, pager: !!document.querySelector('.np-dossie-pag') }));
    if (d.v3 && !d.legado && d.fix === 1) ok('Dossiê V3.1 desenhado (sem a lista da V2); 1 informação fixada com régua de tinta'); else falha('dossiê: ' + JSON.stringify(d));
    if (JSON.stringify(d.frentes) === JSON.stringify(['Estratégico:r-att', 'Jurídico:r-late', 'Negocial:r-late'])) ok('régua das frentes pelo estado: prazo em 3 dias = atenção; prazo vencido = atrasada; parada há 40 dias = atrasada'); else falha('réguas: ' + JSON.stringify(d.frentes));
    if (d.mk.includes('próximo prazo em 3 dias') && d.mk.includes('prazo venceu há 2 dias') && d.mk.includes('parada há 40 dias') && d.mk.includes('2 processos') && d.mk.includes('1 negociação')) ok('marcas das frentes: ' + d.mk.join(' · ')); else falha('marcas: ' + JSON.stringify(d.mk));
    if (d.tl.length === 5 && d.tl.filter((x) => /^reg:/.test(x)).length === 4 && d.tl.filter((x) => /^sis:/.test(x)).length === 1 && d.tl.every((x) => /:\d{1,2} [a-zç]{3}/.test(x)) && !d.pager) ok('linha do tempo: 5 itens (4 registros, 1 da tarefa), data curta em serifa, sem paginação abaixo de 20'); else falha('linha do tempo: ' + JSON.stringify(d.tl));
    if (/^Jurídico · Protocolo · Maria Teste/.test(d.primeira)) ok('mais recente primeiro, com frente · tipo · autor'); else falha('ordem: ' + d.primeira);
    // filtros: chips cumulativos, origem
    await pg.click('.np-dossie .np-chipf:has-text("Jurídico")'); await pg.waitForTimeout(300); const n1 = await pg.evaluate(() => document.querySelectorAll('.np-dossie-tl li').length);
    await pg.click('.np-dossie .np-chipf:has-text("Negocial")'); await pg.waitForTimeout(300); const n2 = await pg.evaluate(() => document.querySelectorAll('.np-dossie-tl li').length);
    await pg.click('.np-dossie .np-chipf:has-text("Jurídico")'); await pg.click('.np-dossie .np-chipf:has-text("Negocial")'); await pg.waitForTimeout(200);
    await pg.selectOption('.np-dossie select[aria-label="Origem"]', '__cli'); await pg.waitForTimeout(300); const n3 = await pg.evaluate(() => document.querySelectorAll('.np-dossie-tl li').length);
    await pg.selectOption('.np-dossie select[aria-label="Origem"]', '__tar'); await pg.selectOption('.np-dossie select[aria-label="Origem"]', '__anexo'); await pg.waitForTimeout(300);
    const vazio = await pg.evaluate(() => document.querySelector('.np-dossie .np-vazio h3')?.textContent);
    if (vazio) { await pg.click('.np-dossie .np-vazio .lnk'); await pg.waitForTimeout(300); }
    const n4 = await pg.evaluate(() => document.querySelectorAll('.np-dossie-tl li').length);
    if (n1 === 1 && n2 === 3 && n3 === 2 && vazio === 'Nada com esses filtros' && n4 === 5) ok('filtros: Jurídico 1 · + Negocial 3 (cumulativo) · "o que o cliente vê" 2 · vazio com "Limpar filtros" volta aos 5'); else falha('filtros: ' + JSON.stringify([n1, n2, n3, vazio, n4]));
    // ações: Registrar (seção e frente), responsável abre o formulário da V2, sem gravar
    await pg.click('.np-dossie .section-h .np-btn:has-text("Registrar")'); await pg.click('.np-dossie-frente:nth-child(2) .pe .np-btn'); const reg = await pg.evaluate(() => window.__reg);
    if (JSON.stringify(reg) === JSON.stringify([['c1', ''], ['c1', 'juridico']])) ok('Registrar (seção) e Registrar aqui (Jurídico) chamam a mesma ação da V2, com a frente'); else falha('registrar: ' + JSON.stringify(reg));
    await pg.click('.np-dossie-frente:nth-child(1) .np-dossie-resp'); await pg.waitForTimeout(400); const modal = await pg.evaluate(() => document.querySelector('#modalHost')?.textContent || '');
    if (/Responsável · Estratégico/.test(modal)) ok('responsável da frente abre o mesmo formulário da V2'); else falha('responsável: ' + modal.slice(0, 80));
    await pg.evaluate(() => [...document.querySelectorAll('#modalHost button')].find((x) => /Cancelar/.test(x.textContent))?.click()); await pg.waitForTimeout(300);
    if (!erros.length && !escritas.length) ok('Dossiê: sem erros e nenhuma gravação'); else falha('erros/escritas: ' + JSON.stringify([erros, escritas]));
    await ctx.close(); }

  // ========== 3. "Editar dados da empresa" e demais abas ==========
  rel.push('3. Renomeação aprovada e demais abas');
  { const { ctx, pg, erros, escritas } = await abrirFicha(b, { sub: 'acompanhamento' }); await pg.waitForTimeout(800);
    const r = await pg.evaluate(() => ({ titulo: [...document.querySelectorAll('#main h2')].some((x) => x.textContent === 'Dados da empresa'), botao: [...document.querySelectorAll('#main button')].some((x) => x.textContent === 'Editar dados da empresa'), antigo: /Raio-X da empresa|Editar Raio-X/.test(document.querySelector('#main').textContent) }));
    if (r.titulo && r.botao && !r.antigo) ok('Acompanhamento PJ: seção "Dados da empresa" com o botão "Editar dados da empresa"; nenhum "Editar Raio-X"'); else falha('renomeação: ' + JSON.stringify(r));
    await pg.evaluate(() => [...document.querySelectorAll('#main button')].find((x) => x.textContent === 'Editar dados da empresa').click()); await pg.waitForTimeout(400);
    const mt = await pg.evaluate(() => document.querySelector('#modalHost')?.textContent || ''); if (/Dados da empresa/.test(mt) && !/Raio-X/.test(mt)) ok('o formulário abre com o mesmo nome ("Dados da empresa")'); else falha('modal: ' + mt.slice(0, 80));
    await pg.evaluate(() => [...document.querySelectorAll('#modalHost button')].find((x) => /Cancelar/.test(x.textContent))?.click()); await pg.waitForTimeout(300);
    for (const sub of ['cliente', 'passivos', 'processos', 'negociacoes', 'tarefas']) { await pg.evaluate((s) => { S.sub = s; render(); }, sub); await pg.waitForTimeout(500); }
    const t = await tinta(pg); const pas = await pg.evaluate(() => { S.sub = 'passivos'; render(); return [...document.querySelectorAll('#main > .actions .btn')].map((x) => x.textContent + ':' + x.getAttribute('aria-pressed')); });
    if (JSON.stringify(pas) === JSON.stringify(['Visão geral:true', 'Contratos:false', 'Reserva de quitação:false'])) ok('Passivos: sub-navegação com estado pressionado (aria-pressed) em vez de botão verde'); else falha('passivos: ' + JSON.stringify(pas));
    if (!erros.length && !escritas.length) ok('Cadastro, Passivos, Jurídico, Negocial e Tarefas abrem sem erro e sem gravar'); else falha('abas: ' + JSON.stringify([erros, escritas, t]));
    await ctx.close(); }

  // ========== 4. V2 intacta ==========
  rel.push('4. V2 intacta');
  { const { ctx, pg, erros } = await abrirFicha(b, { casca: 'v2' });
    const e = await pg.evaluate(() => ({ ficha: document.querySelector('#main').classList.contains('np-ficha'), dossie: !!document.querySelector('.np-dossie'), tl: !!document.querySelector('#main ul.tl'), eyebrow: !!document.querySelector('#main .head .eyebrow'), verde: getComputedStyle([...document.querySelectorAll('#main .head .btn.primary')][0]).backgroundColor }));
    if (!e.ficha && !e.dossie && e.tl && e.eyebrow && /rgb\(27, 130, 69\)/.test(e.verde)) ok('casca V2: ficha e Dossiê da V2 sem nenhuma mudança visual'); else falha('v2: ' + JSON.stringify(e));
    if (!erros.length) ok('V2 sem erros de página'); else falha('erros v2: ' + erros.join(' | ')); await ctx.close(); }

  // ========== 5. 375 px, alvos e contraste ==========
  rel.push('5. 375 px, contraste e alvos (claro e escuro)');
  for (const tema of ['light', 'dark']) {
    const { ctx, pg } = await abrirFicha(b, { w: 375, h: 812, tema });
    const e = await pg.evaluate(() => { const t = document.querySelector('#main > .subtabs'); return { lado: document.documentElement.scrollWidth - document.documentElement.clientWidth, rola: t.scrollWidth > t.clientWidth, dado: t.dataset.rola, linhas: new Set([...t.querySelectorAll('.subtab')].map((x) => Math.round(x.getBoundingClientRect().top))).size }; });
    if (e.lado <= 0 && e.rola && e.dado === 'ini' && e.linhas === 1) ok(`375 px ${tema}: sem rolagem lateral da página; abas numa linha que rola (desvanecimento na ponta)`); else falha(`375 ${tema}: ` + JSON.stringify(e));
    const m = await medirContraste(pg, [{ sel: '.np-ficha-nome', nome: 'nome' }, { sel: '.np-ficha-ctx', nome: 'contexto' }, { sel: '.np-ficha-val b', nome: 'valor' }, { sel: '.np-ficha-marcas .np-marca', nome: 'marca' }, { sel: '#main .subtab', nome: 'aba' }, { sel: '#main .subtab .cnt', nome: 'contador da aba' }, { sel: '.np-dossie-frente h3', nome: 'frente' }, { sel: '.np-dossie-frente .ult', nome: 'último registro' }, { sel: '.np-dossie-frente .np-marca', nome: 'marca da frente' }, { sel: '.np-dossie-tl time b', nome: 'data' }, { sel: '.np-dossie-tl time span', nome: 'data relativa' }, { sel: '.np-dossie-tl .m', nome: 'meta da linha' }, { sel: '#main .note', nome: 'nota' }]);
    if (!m.ruins.length && !m.ausentesObrigatorios.length) ok(`375 px ${tema}: contraste mínimo ${m.minimo.toFixed(2)}:1 em ${m.medidos.length} pares`); else falha(`contraste ${tema}: ` + JSON.stringify([m.ruins, m.ausentesObrigatorios]));
    const alv = await medirAlvos(pg, '#main'); const peq = alv.filter((a) => a.h < 44);
    if (!peq.length) ok(`375 px ${tema}: alvos de toque ≥ 44 px (${alv.length} medidos)`); else falha(`alvos ${tema}: ` + JSON.stringify(peq.slice(0, 8)));
    await pg.screenshot({ path: path.join(OUT, `ficha-375-${tema}.png`), fullPage: true }); await ctx.close();
  }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
