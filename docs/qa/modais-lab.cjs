/* Laboratório da entrega visual V5 — modal() da V2 sob a casca V3.1 (NPUI.modalV3).
   Playwright + Chromium locais; reaproveita o servidor e as fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é
   interceptada; nada sai da máquina. Uso: NODE_PATH=<módulos> node docs/qa/modais-lab.cjs [pasta de saída]  (padrão /tmp/modais-lab)
   Verifica: diálogo acessível (role, aria-labelledby, foco inicial/preso/devolvido, #app inerte), Escape/fundo/X/Cancelar com
   "Descartar as alterações?" só quando a pessoa alterou algo, envio com trava (onSave uma vez por clique duplo, "Salvando…"),
   erro do banco traduzido no próprio diálogo sem fechar, compatibilidade com os módulos (Salvar renomeado/removido, .card com classe,
   #modalHost esvaziado, formulário aberto dentro do onSave), formulário real (Novo cliente) gravando uma vez, V2 intacta,
   375 px em tela cheia sem rolagem lateral, alvos de toque e contraste nos dois temas. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/modais-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const espera = (pg, ms) => pg.waitForTimeout(ms);

async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#clientes', ...o });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof modal === 'function', null, { timeout: 20000 });
  await espera(r.pg, 800);
  // modal sintético pelo modal() REAL (o mesmo que os módulos chamam); onSave controlado pelo teste
  await r.pg.evaluate(() => {
    const b = document.createElement('button'); b.id = 'lab-origem'; b.textContent = 'Abrir formulário (lab)'; document.querySelector('#main')?.prepend(b);
    window.__abrir = (op = {}) => { window.__cham = 0; const body = el('div', { class: 'form' }, field('lab-a', 'Assunto', inp('text', '')), field('lab-b', 'Prioridade', sel({ '': '—', alta: 'Alta', baixa: 'Baixa' }, '')), field('lab-c', 'Observações', el('textarea', {}, '')));
      const extra = op.extra ? el('button', { class: 'btn danger', onclick: () => { window.__extra = (window.__extra || 0) + 1; } }, 'Excluir') : null;
      modal(op.titulo || 'Formulário de laboratório', body, async () => { window.__cham++; await new Promise((r) => setTimeout(r, op.ms || 0)); if (op.encadear) modal('Segundo formulário', el('div', { class: 'form' }, field('lab-d', 'Campo', inp('text', ''))), async () => {});
        if (op.erro && window.__cham <= (op.vezes || 1)) throw op.erro; }, extra);
      if (op.renomear) { const btn = $('#modalHost button.btn.primary'); if (btn) btn.textContent = op.renomear; }
      if (op.remover) $('#modalHost button.btn.primary')?.remove();
      if (op.classe) $('#modalHost .card')?.classList.add(op.classe); };
  });
  return r;
}
const estado = (pg) => pg.evaluate(() => { const card = document.querySelector('#modalHost [role="dialog"]'); const a = document.activeElement;
  return { aberto: !!card, v3: !!card?.classList.contains('np-modal-v3'), modal: card?.getAttribute('aria-modal'), titulo: card ? document.getElementById(card.getAttribute('aria-labelledby') || '')?.textContent : null,
    inerte: document.querySelector('#app')?.hasAttribute('inert'), focoDentro: !!(card && card.contains(a)), foco: a?.id || a?.className || a?.tagName, confirm: !!document.querySelector('.np-f-confirm:not([hidden])'),
    confirmTxt: document.querySelector('.np-f-confirm:not([hidden]) p')?.textContent, geral: document.querySelector('#modalHost .np-f-geral:not([hidden]) b')?.textContent || null,
    salvar: document.querySelector('#modalHost .np-f-salvar')?.textContent, salvarOff: !!document.querySelector('#modalHost .np-f-salvar')?.disabled, busy: card?.getAttribute('aria-busy'), cham: window.__cham, dialogs: document.querySelectorAll('#modalHost [role="dialog"]').length }; });

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Diálogo acessível e fechamento (V3.1, admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {});
    await pg.click('#lab-origem'); await pg.evaluate(() => __abrir()); await espera(pg, 200);
    let e = await estado(pg);
    if (e.aberto && e.v3 && e.modal === 'true' && e.titulo === 'Formulário de laboratório' && e.inerte) ok('role=dialog, aria-modal, aria-labelledby = título, #app inerte'); else falha('diálogo: ' + JSON.stringify(e));
    if (e.foco === 'lab-a') ok('foco inicial no primeiro campo'); else falha('foco inicial: ' + e.foco);
    const compat = await pg.evaluate(() => ({ primario: $('#modalHost button.btn.primary')?.classList.contains('np-f-salvar'), card: $('#modalHost .card')?.getAttribute('role'), ordem: [...document.querySelectorAll('#modalHost .np-f-acoes button')].map((x) => x.textContent) }));
    if (compat.primario && compat.card === 'dialog' && compat.ordem.join('|') === 'Cancelar|Salvar') ok('compatível: 1º button.btn.primary = Salvar; 1º .card = diálogo; ações Cancelar · Salvar'); else falha('compat: ' + JSON.stringify(compat));
    let fora = 0; for (let i = 0; i < 14; i++) { await pg.keyboard.press('Tab'); if (!(await estado(pg)).focoDentro) fora++; } for (let i = 0; i < 5; i++) { await pg.keyboard.press('Shift+Tab'); if (!(await estado(pg)).focoDentro) fora++; }
    if (!fora) ok('Tab e Shift+Tab ficam presos no diálogo (19 passos)'); else falha('foco escapou ' + fora + 'x');
    await pg.screenshot({ path: path.join(OUT, 'v5-modal-1440-claro.png') });
    await pg.keyboard.press('Escape'); await espera(pg, 150); e = await estado(pg);
    if (!e.aberto && !e.inerte && e.foco === 'lab-origem') ok('Escape sem alteração fecha, #app volta, foco devolvido à origem'); else falha('Escape limpo: ' + JSON.stringify(e));
    // alteração feita pela pessoa → confirmação
    await pg.click('#lab-origem'); await pg.evaluate(() => __abrir()); await espera(pg, 150); await pg.keyboard.type('Revisar contrato'); await pg.keyboard.press('Escape'); await espera(pg, 150); e = await estado(pg);
    if (e.aberto && e.confirm && e.confirmTxt === 'Descartar as alterações?' && /np-f-conf-nao/.test(e.foco)) ok('Escape com alteração pergunta "Descartar as alterações?" (foco no botão seguro)'); else falha('confirmação: ' + JSON.stringify(e));
    await pg.keyboard.press('Enter'); await espera(pg, 150); e = await estado(pg); const val = await pg.inputValue('#lab-a');
    if (e.aberto && !e.confirm && e.foco === 'lab-a' && val === 'Revisar contrato') ok('"Continuar editando" devolve o foco ao campo, valor preservado'); else falha('continuar: ' + JSON.stringify([e, val]));
    await pg.mouse.click(5, 5); await espera(pg, 150); e = await estado(pg); if (e.confirm) ok('clique no fundo também pede confirmação'); else falha('fundo: ' + JSON.stringify(e));
    await pg.click('.np-f-conf-sim'); await espera(pg, 150); e = await estado(pg);
    if (!e.aberto && !e.inerte) ok('"Descartar" fecha'); else falha('descartar: ' + JSON.stringify(e));
    // mudança feita por código (não pela pessoa) não conta
    await pg.click('#lab-origem'); await pg.evaluate(() => { __abrir(); const s = document.querySelector('#lab-b'); s.value = 'alta'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await espera(pg, 100);
    await pg.click('#modalHost .np-f-x'); await espera(pg, 150); e = await estado(pg);
    if (!e.aberto) ok('preenchimento automático (evento sintético) não conta como alteração: X fecha direto'); else falha('sintético: ' + JSON.stringify(e));
    if (!escritas.length && !erros.length) ok('nenhuma escrita, sem erros de página'); else falha('escritas/erros: ' + JSON.stringify([escritas, erros]));
    await ctx.close(); }

  rel.push('2. Envio com trava e erro no próprio diálogo');
  { const { ctx, pg, erros } = await abrir(b, {});
    await pg.evaluate(() => __abrir({ ms: 700 })); await espera(pg, 100); await pg.fill('#lab-a', 'Tarefa');
    await pg.dblclick('#modalHost .np-f-salvar'); await espera(pg, 120); let e = await estado(pg);
    if (e.salvar === 'Salvando…' && e.salvarOff && e.busy === 'true') ok('durante o envio: "Salvando…", Salvar desabilitado, aria-busy'); else falha('travado: ' + JSON.stringify(e));
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Enter'); await espera(pg, 900); e = await estado(pg);
    if (!e.aberto && e.cham === 1) ok('clique duplo + Enter + Escape durante o envio: onSave chamado 1 vez, fecha ao concluir'); else falha('trava: ' + JSON.stringify(e));
    await pg.evaluate(() => __abrir({ erro: { code: '42501', message: 'new row violates row-level security policy', status: 403 }, renomear: 'Enviar' })); await espera(pg, 100); await pg.fill('#lab-a', 'x');
    await pg.click('#modalHost .np-f-salvar'); await espera(pg, 250); e = await estado(pg);
    if (e.aberto && e.geral === 'Sem permissão para gravar este registro. Nada foi gravado.' && e.salvar === 'Enviar' && !e.salvarOff && /np-f-geral/.test(e.foco)) ok('42501: diálogo continua aberto, mensagem traduzida, foco no aviso, botão renomeado ("Enviar") restaurado'); else falha('erro 42501: ' + JSON.stringify(e));
    const det = await pg.evaluate(() => document.querySelector('#modalHost .np-f-geral details code')?.textContent || ''); if (/HTTP 403 · código 42501/.test(det)) ok('detalhe técnico em "detalhes técnicos"'); else falha('detalhe: ' + det);
    await pg.click('#modalHost .np-f-salvar'); await espera(pg, 250); e = await estado(pg); if (!e.aberto && e.cham === 2) ok('nova tentativa livre: segunda chamada conclui e fecha'); else falha('retentativa: ' + JSON.stringify(e));
    await pg.evaluate(() => __abrir({ erro: new Error('Informe o nome do cliente') })); await espera(pg, 100); await pg.click('#modalHost .np-f-salvar'); await espera(pg, 200); e = await estado(pg);
    if (e.aberto && e.geral === 'Informe o nome do cliente') ok('validação do módulo (Error em português) aparece no diálogo'); else falha('erro do módulo: ' + JSON.stringify(e));
    await pg.evaluate(() => __abrir({ erro: { message: 'upstream connect error', status: 503 } })); await espera(pg, 100); await pg.click('#modalHost .np-f-salvar'); await espera(pg, 200); e = await estado(pg);
    if (e.aberto && /não foi possível confirmar/.test(e.geral || '')) ok('503: avisa que não foi possível confirmar e orienta conferir antes de repetir'); else falha('503: ' + JSON.stringify(e));
    await pg.screenshot({ path: path.join(OUT, 'v5-modal-erro.png') });
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + JSON.stringify(erros));
    await ctx.close(); }

  rel.push('3. Compatibilidade com os módulos');
  { const { ctx, pg, erros } = await abrir(b, {});
    await pg.click('#lab-origem'); await pg.evaluate(() => __abrir({ remover: true, classe: 'fc-modal' })); await espera(pg, 100);
    let c = await pg.evaluate(() => ({ salvar: !!document.querySelector('#modalHost .np-f-salvar'), classe: document.querySelector('#modalHost .card')?.classList.contains('fc-modal') }));
    await pg.click('#modalHost .np-f-cancelar'); await espera(pg, 150); let e = await estado(pg);
    if (!c.salvar && c.classe && !e.aberto && !e.inerte) ok('Salvar removido pelo módulo e classe no .card: Cancelar fecha normalmente'); else falha('remover/classe: ' + JSON.stringify([c, e]));
    await pg.click('#lab-origem'); await pg.evaluate(() => __abrir({ extra: true })); await espera(pg, 100); await pg.evaluate(() => $('#modalHost').replaceChildren()); await espera(pg, 150); e = await estado(pg);
    await pg.keyboard.press('Escape');
    if (!e.aberto && !e.inerte && e.foco === 'lab-origem') ok('#modalHost esvaziado por outro código (exclusões da V2): inert e ouvintes desfeitos, foco devolvido'); else falha('esvaziado: ' + JSON.stringify(e));
    await pg.evaluate(() => __abrir({ encadear: true })); await espera(pg, 100); await pg.click('#modalHost .np-f-salvar'); await espera(pg, 300); e = await estado(pg);
    if (e.aberto && e.titulo === 'Segundo formulário' && e.inerte && e.dialogs === 1) ok('formulário aberto dentro do onSave continua aberto (o primeiro não o apaga), #app inerte'); else falha('encadeado: ' + JSON.stringify(e));
    await pg.keyboard.press('Escape'); await espera(pg, 150); e = await estado(pg); if (!e.aberto && !e.inerte) ok('Escape fecha o segundo e libera o #app'); else falha('encadeado fechar: ' + JSON.stringify(e));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + JSON.stringify(erros));
    await ctx.close(); }

  rel.push('4. Formulário real: Novo cliente (clique duplo com banco lento)');
  { let posts = 0; const { ctx, pg, erros, escritas } = await abrir(b, { escrita: (m, p) => { if (m === 'POST' && p.startsWith('/rest/v1/clientes')) { posts++; return { status: 201, body: [{ id: 'cli-lab-novo' }], ms: 900 }; } return null; } });
    await pg.evaluate(() => openClientForm({})); await espera(pg, 200); let e = await estado(pg);
    if (e.aberto && e.v3 && e.titulo === 'Novo cliente' && e.foco === 'c-nome') ok('Novo cliente abre na V3.1 com foco no nome'); else falha('novo cliente: ' + JSON.stringify(e));
    await pg.screenshot({ path: path.join(OUT, 'v5-novo-cliente-1440.png') });
    await pg.click('#modalHost .np-f-salvar'); await espera(pg, 200); e = await estado(pg);
    if (e.aberto && e.geral === 'Informe o nome do cliente' && posts === 0) ok('sem nome: a validação do próprio formulário aparece no diálogo, nada enviado'); else falha('validação: ' + JSON.stringify([e, posts]));
    await pg.fill('#c-nome', 'Empresa Fictícia de Laboratório Ltda'); await pg.dblclick('#modalHost .np-f-salvar'); await pg.click('#modalHost .np-f-salvar').catch(() => {}); await espera(pg, 1600); e = await estado(pg);
    if (posts === 1 && !e.aberto) ok('clique duplo + terceiro clique: 1 POST em clientes, diálogo fecha ao concluir'); else falha('posts=' + posts + ' ' + JSON.stringify(e) + ' ' + JSON.stringify(escritas.slice(0, 3)));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + JSON.stringify(erros));
    await ctx.close(); }

  rel.push('5. V2 intacta (casca desligada)');
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' });
    await pg.evaluate(() => __abrir()); await espera(pg, 150);
    const v2 = await pg.evaluate(() => { const card = document.querySelector('#modalHost .modal > .card'); return { v3: !!document.querySelector('.np-modal-v3'), h2: card?.firstElementChild?.tagName, acoes: [...(card?.querySelectorAll(':scope > .actions button') || [])].map((x) => x.textContent), inerte: document.querySelector('#app')?.hasAttribute('inert') }; });
    await pg.keyboard.press('Escape'); await espera(pg, 100); const aindaAberto = await pg.evaluate(() => !!document.querySelector('#modalHost .modal'));
    if (!v2.v3 && v2.h2 === 'H2' && v2.acoes.join('|') === 'Cancelar|Salvar' && !v2.inerte && aindaAberto) ok('V2: mesmo modal de antes (h2 + corpo + Cancelar · Salvar, sem inert, Escape não fecha — comportamento anterior)'); else falha('V2: ' + JSON.stringify([v2, aindaAberto]));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + JSON.stringify(erros));
    await ctx.close(); }

  rel.push('6. 375 px e 1024 px, claro e escuro: tela cheia, alvos, contraste');
  for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w: 375, h: 760, tema });
    await pg.evaluate(() => openClientForm({})); await espera(pg, 250);
    const g = await pg.evaluate(() => { const r = document.querySelector('#modalHost .np-modal-v3').getBoundingClientRect(); const i = document.querySelector('#c-nome').getBoundingClientRect(); const pe = document.querySelector('#modalHost .np-f-acoes').getBoundingClientRect();
      return { w: Math.round(r.width), x: Math.round(r.left), campo: Math.round(i.height), lateral: document.documentElement.scrollWidth > innerWidth, pe: Math.round(pe.bottom), vh: innerHeight }; });
    if (g.w === 375 && g.x === 0 && g.campo >= 44 && !g.lateral) ok(`375 px ${tema}: tela cheia, campos ${g.campo} px, sem rolagem lateral`); else falha(`375 ${tema}: ` + JSON.stringify(g));
    const alv = await medirAlvos(pg, '#modalHost'); const peq = alv.filter((a) => a.h < 44);
    if (!peq.length) ok(`375 px ${tema}: alvos de toque ≥ 44 px (${alv.length} medidos)`); else falha(`alvos ${tema}: ` + JSON.stringify(peq.slice(0, 8)));
    const m = await medirContraste(pg, [{ sel: '#modalHost h2', nome: 'título' }, { sel: '#modalHost .f label', nome: 'rótulo' }, { sel: '#modalHost .help', nome: 'ajuda' }, { sel: '#modalHost input', nome: 'campo' }, { sel: '#modalHost .np-f-cancelar', nome: 'Cancelar' }, { sel: '#modalHost .np-f-salvar', nome: 'Salvar' }]);
    if (!m.ruins.length && !m.ausentesObrigatorios.length) ok(`375 px ${tema}: contraste mínimo ${m.minimo.toFixed(2)}:1 em ${m.medidos.length} pares`); else falha(`contraste ${tema}: ` + JSON.stringify([m.ruins, m.ausentesObrigatorios]));
    await pg.screenshot({ path: path.join(OUT, `v5-novo-cliente-375-${tema}.png`) });
    if (!erros.length) ok(`375 px ${tema}: sem erros de página`); else falha('erros: ' + JSON.stringify(erros));
    await ctx.close();
    const r2 = await abrir(b, { w: 1024, h: 768, tema }); await r2.pg.evaluate(() => openClientForm({})); await espera(r2.pg, 250);
    const m2 = await medirContraste(r2.pg, [{ sel: '#modalHost h2', nome: 'título' }, { sel: '#modalHost .f label', nome: 'rótulo' }, { sel: '#modalHost .help', nome: 'ajuda' }, { sel: '#modalHost .np-f-salvar', nome: 'Salvar' }]);
    if (!m2.ruins.length) ok(`1024 px ${tema}: contraste mínimo ${m2.minimo.toFixed(2)}:1`); else falha(`1024 ${tema}: ` + JSON.stringify(m2.ruins));
    await r2.pg.screenshot({ path: path.join(OUT, `v5-novo-cliente-1024-${tema}.png`) }); await r2.ctx.close();
  }
  { const { ctx, pg } = await abrir(b, { tema: 'dark' }); await pg.evaluate(() => openClientForm({})); await espera(pg, 250); await pg.screenshot({ path: path.join(OUT, 'v5-novo-cliente-1440-escuro.png') }); await ctx.close(); }

  await b.close(); srv.close();
  const txt = 'Laboratório V5 — modal() da V2 na casca V3.1\n' + rel.join('\n') + `\n\n${falhas ? falhas + ' FALHA(S)' : 'tudo ok'}\n`;
  fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
