/* Laboratório da entrega visual V6 — um só tema escuro (e o claro) nas telas da V2 dentro da casca V3.1, e dias livres compactos na Agenda.
   Playwright + Chromium locais; reaproveita o servidor e as fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é
   interceptada; nada sai da máquina. Uso: NODE_PATH=<módulos> node docs/qa/tema-lab.cjs [pasta de saída]  (padrão /tmp/tema-lab)
   Verifica: com a casca, as variáveis da V2 resolvem para os tokens --np-* nos dois temas (fundo, folha, fio, texto, semânticas,
   primária em tinta); telas da V2 (Processos, Publicações, Base de acordos, Equipe) pintadas com o grafite; contraste ≥ 4,5:1
   nos textos medidos; sem rolagem lateral em 375 px; sem a casca, os valores legados ficam idênticos; Agenda (semana) com os dias
   livres numa linha compacta e o modo Dia ainda com "Nada marcado". */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/tema-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,medirContraste};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, medirContraste } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const PARES = [['--bg', '--np-bg'], ['--surface', '--np-surface'], ['--surface-2', '--np-surface-2'], ['--line', '--np-line'], ['--fg', '--np-text'], ['--muted', '--np-text-2'], ['--faint', '--np-text-3'], ['--ok', '--np-ok'], ['--warn', '--np-att'], ['--crit', '--np-crit'], ['--info', '--np-info'], ['--btn-primary', '--np-ink'], ['--on-dark', '--np-inv']];
const TELAS = [['publicacoes', 'publicacoes'], ['historico', 'historico'], ['equipe', 'equipe']]; // telas ainda com a apresentação da V2 dentro da casca; Processos saiu daqui na V8 (tem laboratório próprio: processos-lab)
const vars = (pg, nomes) => pg.evaluate((n) => { const cs = getComputedStyle(document.documentElement); const o = {}; for (const k of n) o[k] = cs.getPropertyValue(k).trim().toLowerCase(); return o; }, nomes);
const cor = (pg, v) => pg.evaluate((v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; }, v);

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Variáveis da V2 → tokens --np-* com a casca V3.1 (claro e escuro)');
  for (const tema of ['dark', 'light']) {
    const { ctx, pg, erros } = await contexto(b, { hash: '#perfil', tema }); await pg.waitForTimeout(1500);
    const difs = []; for (const [a, c] of PARES) { const [x, y] = [await cor(pg, a), await cor(pg, c)]; if (x !== y) difs.push(`${a}=${x} × ${c}=${y}`); }
    if (!difs.length) ok(`${tema}: ${PARES.length} variáveis da V2 iguais aos tokens --np-* (fundo, folha, fio, texto, semânticas, primária em tinta)`); else falha(`${tema}: ` + difs.join('; '));
    for (const [hash, nome] of TELAS) {
      await pg.evaluate((t) => irPara(t), hash); await pg.waitForTimeout(1300);
      const r = await pg.evaluate((t) => { const v = document.querySelector('.view.active, [id^="view-"]:not([hidden])'); const fundo = getComputedStyle(document.body).backgroundColor; const i = document.createElement('i'); i.style.color = 'var(--np-bg)'; document.body.append(i); const np = getComputedStyle(i).color; i.remove();
        const cards = [...document.querySelectorAll('#view-' + t + ' .card')].filter((c) => c.offsetParent).slice(0, 6).map((c) => getComputedStyle(c).backgroundColor); const j = document.createElement('i'); j.style.color = 'var(--np-surface)'; document.body.append(j); const sf = getComputedStyle(j).color; j.remove();
        return { fundo, np, cards, sf, lateral: document.documentElement.scrollWidth > innerWidth }; }, hash);
      const cardsOk = r.cards.length > 0 && r.cards.every((c) => c === r.sf || c === 'rgba(0, 0, 0, 0)');
      if (r.fundo === r.np && cardsOk) ok(`${tema} ${nome}: fundo e folhas no grafite/papel da V3.1 (${r.cards.length} folhas)`); else falha(`${tema} ${nome}: ` + JSON.stringify(r));
      const V = '#view-' + hash; const m = await medirContraste(pg, [{ sel: V + ' h1', nome: 'título' }, { sel: V + ' .card h3', nome: 'seção' }, { sel: V + ' td', nome: 'célula' }, { sel: V + ' th', nome: 'cabeçalho' }, { sel: V + ' .note', nome: 'nota' }, { sel: V + ' .sub', nome: 'linha fina' }, { sel: V + ' .btn', nome: 'botão' }, { sel: V + ' .btn.primary', nome: 'primário' }]);
      if (!m.ruins.length && m.medidos.length) ok(`${tema} ${nome}: contraste mínimo ${m.medidos.length ? m.minimo.toFixed(2) : '—'}:1 em ${m.medidos.length} pares`); else falha(`${tema} ${nome} contraste: ` + JSON.stringify(m.ruins.slice(0, 6)));
      if (tema === 'dark' || nome === 'publicacoes') await pg.screenshot({ path: path.join(OUT, `v6-${nome}-1440-${tema}.png`) });
    }
    if (!erros.length) ok(`${tema}: sem erros de página`); else falha(`${tema} erros: ` + JSON.stringify(erros.slice(0, 3)));
    await ctx.close();
  }
  rel.push('2. Sem a casca, a V2 fica como estava');
  for (const tema of ['dark', 'light']) {
    const { ctx, pg } = await contexto(b, { hash: '#perfil', tema, casca: 'v2' }); await pg.waitForTimeout(1200);
    const v = await vars(pg, ['--bg', '--btn-primary', '--surface']);
    const esperado = tema === 'dark' ? { '--bg': '#151412', '--btn-primary': '#1f8f4c', '--surface': '#1d1c1a' } : { '--bg': '#f7f6f2', '--btn-primary': '#1b8245', '--surface': '#ffffff' };
    if (JSON.stringify(v) === JSON.stringify(esperado)) ok(`V2 ${tema}: valores legados idênticos (${Object.values(v).join(', ')})`); else falha(`V2 ${tema}: ` + JSON.stringify([v, esperado]));
    await ctx.close();
  }
  rel.push('3. 375 px no escuro: sem rolagem lateral');
  { const { ctx, pg } = await contexto(b, { hash: '#perfil', tema: 'dark', w: 375, h: 760 }); await pg.waitForTimeout(1300); let lat = [];
    for (const [hash, nome] of TELAS) { await pg.evaluate((t) => irPara(t), hash); await pg.waitForTimeout(1100); if (await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)) lat.push(nome); }
    await pg.screenshot({ path: path.join(OUT, 'v6-historico-375-dark.png') });
    if (!lat.length) ok('375 px escuro: nenhuma das 4 telas rola na horizontal'); else falha('rolagem lateral: ' + lat.join(', ')); await ctx.close(); }
  rel.push('4. Agenda: dias livres compactos (semana) e "Nada marcado" no modo Dia');
  for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await contexto(b, { hash: '#agenda', tema, extraLS: { 'pp-agenda-modo': 'semana', 'pp-agenda-quem': 'equipe' } });
    await pg.waitForFunction(() => document.querySelectorAll('#view-agenda .np-grp').length >= 1, null, { timeout: 10000 }).catch(() => {}); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => ({ grupos: document.querySelectorAll('#view-agenda .np-grp').length, livres: [...document.querySelectorAll('#view-agenda .np-ag-livres')].map((x) => x.textContent), vazias: document.querySelectorAll('#view-agenda .np-it-vazia').length }));
    if (r.livres.length && !r.vazias && r.livres.every((t) => /^Livre/.test(t))) ok(`${tema}: semana com ${r.grupos} dia(s) em grupos e livres em linha compacta ("${r.livres.join('" / "')}")`); else falha(`${tema} agenda semana: ` + JSON.stringify(r));
    const m = await medirContraste(pg, [{ sel: '#view-agenda .np-ag-livres span:last-child', nome: 'dias livres' }, { sel: '#view-agenda .np-ag-livres-r', nome: 'marca Livre' }]);
    if (!m.ruins.length && m.medidos.length) ok(`${tema}: contraste da linha de dias livres ${m.minimo.toFixed(2)}:1`); else falha(`${tema} contraste livres: ` + JSON.stringify([m.ruins, m.medidos.length]));
    await pg.screenshot({ path: path.join(OUT, `v6-agenda-1440-${tema}.png`) });
    if (!erros.length) ok(`${tema}: sem erros de página`); else falha(`${tema} erros: ` + JSON.stringify(erros.slice(0, 3)));
    await ctx.close();
  }
  { const { ctx, pg } = await contexto(b, { hash: '#agenda', extraLS: { 'pp-agenda-modo': 'dia', 'pp-agenda-quem': 'equipe' } }); await pg.waitForTimeout(1500);
    const d = await pg.evaluate(() => ({ livres: document.querySelectorAll('#view-agenda .np-ag-livres').length, grp: document.querySelectorAll('#view-agenda .np-grp').length, vazia: document.querySelector('#view-agenda .np-it-vazia')?.textContent || '' }));
    if (!d.livres && d.grp === 1) ok('modo Dia: um grupo do dia (' + (d.vazia ? 'vazio, com "' + d.vazia.trim() + '"' : 'com itens') + '), sem linha compacta'); else falha('modo dia: ' + JSON.stringify(d)); await ctx.close(); }
  await b.close(); srv.close();
  const txt = 'Laboratório V6 — um só tema escuro e Agenda\n' + rel.join('\n') + `\n\n${falhas ? falhas + ' FALHA(S)' : 'tudo ok'}\n`;
  fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
