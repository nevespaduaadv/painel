/* Laboratório da correção de segurança 0111 no front — exclusão de CLIENTES e de BENS (V2 e V3.1, mesmos formulários).
   Reaproveita servidor, fixtures e contexto() do integracoes-lab; o banco é simulado (as regras reais estão em
   docs/qa/sql/0111-matriz.sql, em PostgreSQL 16 e 17). TODA chamada a *.supabase.co é interceptada; nada sai da máquina.
   Uso: NODE_PATH=<módulos> node docs/qa/exclusao-lab.cjs [pasta de saída]  (padrão /tmp/exclusao-lab)
   Verifica: botão de exclusão de cliente só para a administradora, com motivo, pela função do banco, e mensagem certa quando o
   banco recusa; nenhum "excluído" falso; bens: botão conforme quem conduz a proteção e a situação do bem; bem protegido só pela
   administradora com motivo; DELETE sem linha devolvida vira "nada foi excluído". */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/exclusao-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto } = M.exports;
const { chromium } = require('playwright'); require('./_popup.cjs');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };

const BENS = [
  { id: 'b0000000-0000-0000-0000-0000000000e1', cliente_id: 'c1', tipo: 'veiculo', descricao: 'Veículo exposto (fictício)', titular: 'PJ', protecao: 'exposto' },
  { id: 'b0000000-0000-0000-0000-0000000000e2', cliente_id: 'c1', tipo: 'imovel', descricao: 'Imóvel protegido (fictício)', titular: 'PF', protecao: 'protegido' }];
const EDITA_PROTECAO = { admin: true, lucas: true, acordos: false };

async function abrir(b, o) {
  const chamadas = []; let resposta = o.resposta || (() => null);
  const r = await contexto(b, { hash: '#clientes', ...o, escrita: (m, p, body) => { chamadas.push(m + ' ' + p + ' ' + body); return resposta(m, p, body); } });
  const json = (rota, corpo, st = 200) => rota.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(bens|rpc\/edita_protecao)/, (rota) => {
    const p = new URL(rota.request().url()).pathname;
    if (p.startsWith('/rest/v1/rpc/edita_protecao')) return json(rota, EDITA_PROTECAO[o.perfil || 'admin'] === true);
    if (p.startsWith('/rest/v1/bens') && rota.request().method() === 'GET') return json(rota, BENS);
    return rota.fallback();
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined' && S.clientes && S.clientes.length > 0, null, { timeout: 20000 });
  await r.pg.evaluate(() => { S.tab = 'clientes'; S.sel = 'c1'; S.sub = 'cliente'; render(); }); await r.pg.waitForTimeout(1500);
  return { ...r, chamadas, trocar: (f) => { resposta = f; } };
}
const botoes = (pg) => pg.evaluate(() => [...document.querySelectorAll('#modalHost button')].map((x) => x.textContent.trim()).filter(Boolean));
const toastTxt = (pg) => pg.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent.trim() : ''; });
const clicar = (pg, txt) => pg.evaluate((t) => [...document.querySelectorAll('#modalHost button')].find((x) => x.textContent.trim() === t)?.click(), txt);
const abrirCliente = (pg) => pg.evaluate(() => { openClientForm(S.clientes.find((c) => c.id === 'c1')); });
const abrirBem = (pg, i) => pg.evaluate((i) => { window.PP_FICHA.openBemForm(S.clientes.find((c) => c.id === 'c1'), window.__BENS[i]); }, i);

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. Cliente: administradora ==========
  for (const casca of ['v3', 'v2']) {
    rel.push(`1. Excluir cliente — administradora (casca ${casca.toUpperCase()})`);
    const { ctx, pg, erros, chamadas, trocar } = await abrir(b, { perfil: 'admin', casca });
    await abrirCliente(pg); await pg.waitForTimeout(300);
    const bt = await botoes(pg);
    if (bt.includes('Excluir definitivamente') && !bt.includes('Excluir')) ok('o formulário mostra "Excluir definitivamente" (e não o "Excluir" antigo)'); else falha('botões: ' + JSON.stringify(bt));
    await clicar(pg, 'Excluir definitivamente'); await pg.waitForTimeout(200);
    const aviso = await pg.evaluate(() => !!document.querySelector('#modalHost #c-motivo') && /Encerrado/.test(document.querySelector('#modalHost .confirm')?.textContent || ''));
    if (aviso && !chamadas.length) ok('1º clique: explica o caminho do "Encerrado", pede o motivo e não chama o banco'); else falha('aviso: ' + JSON.stringify([aviso, chamadas]));
    await pg.fill('#c-motivo', 'engano'); await clicar(pg, 'Excluir definitivamente'); await pg.waitForTimeout(200);
    if (!chamadas.length && /Nada foi excluído/.test(await toastTxt(pg))) ok('motivo curto: não chama o banco; "Nada foi excluído"'); else falha('motivo curto: ' + JSON.stringify(chamadas));
    trocar((m, p) => /cliente_excluir_definitivo/.test(p) ? { status: 400, body: { code: '23503', message: 'Este cliente tem registros de trabalho' } } : null);
    await pg.fill('#c-motivo', 'cadastro duplicado por engano'); await clicar(pg, 'Excluir definitivamente'); await pg.waitForTimeout(400);
    const recusa = { toast: await toastTxt(pg), aberto: await pg.evaluate(() => !!document.querySelector('#modalHost .modal, #modalHost .card')), chamada: chamadas.find((x) => /cliente_excluir_definitivo/.test(x)) || '' };
    if (/Nada foi excluído: o cliente tem registros de trabalho/.test(recusa.toast) && recusa.aberto && /"p_id":"c1"/.test(recusa.chamada) && /"p_motivo":"cadastro duplicado por engano"/.test(recusa.chamada)) ok('banco recusa (23503): mensagem certa, formulário continua aberto; chamou a função com id e motivo');
    else falha('recusa: ' + JSON.stringify(recusa));
    const deletes = chamadas.filter((x) => /^DELETE /.test(x));
    trocar((m, p) => /cliente_excluir_definitivo/.test(p) ? { status: 200, body: { excluido: 'c1' } } : null);
    await clicar(pg, 'Excluir definitivamente'); await pg.waitForTimeout(500);
    const fim = { toast: await toastTxt(pg), aberto: await pg.evaluate(() => !!document.querySelector('#modalHost').children.length), sel: await pg.evaluate(() => S.sel) };
    if (/excluído definitivamente/.test(fim.toast) && !fim.aberto && fim.sel === null && !deletes.length && !chamadas.some((x) => /^DELETE \/rest\/v1\/clientes/.test(x))) ok('banco aceita: fecha, sai da ficha; nenhum DELETE direto em clientes');
    else falha('aceite: ' + JSON.stringify([fim, chamadas]));
    if (!erros.length) ok('sem erros de página'); else falha('erros: ' + erros.join(' | '));
    await ctx.close();
  }
  // ========== 2. Cliente: demais perfis ==========
  rel.push('2. Excluir cliente — colaboradores');
  for (const perfil of ['acordos', 'lucas']) {
    const { ctx, pg, erros } = await abrir(b, { perfil });
    await abrirCliente(pg); await pg.waitForTimeout(300); const bt = await botoes(pg);
    if (!bt.some((x) => /Excluir/.test(x)) && !erros.length) ok(`${perfil}: o formulário do cliente não oferece exclusão (o caminho é o status Encerrado)`); else falha(`${perfil}: ` + JSON.stringify([bt, erros]));
    await ctx.close();
  }
  // ========== 3. Bens ==========
  rel.push('3. Excluir bem — por perfil e situação do bem');
  { const { ctx, pg, chamadas, trocar } = await abrir(b, { perfil: 'lucas' });
    await pg.evaluate((B) => { window.__BENS = B; }, BENS); await pg.waitForFunction(() => window.PP_FICHA && true); await pg.waitForTimeout(500);
    await abrirBem(pg, 0); await pg.waitForTimeout(200); let bt = await botoes(pg);
    if (bt.includes('Excluir')) ok('quem conduz a proteção (Estratégico): "Excluir" no bem exposto'); else falha('lucas exposto: ' + JSON.stringify(bt));
    trocar((m, p) => m === 'DELETE' && /\/rest\/v1\/bens/.test(p) ? { status: 200, body: [] } : null); // RLS: nenhuma linha atingida
    await clicar(pg, 'Excluir'); await clicar(pg, 'Excluir'); await pg.waitForTimeout(400);
    const t = await toastTxt(pg); const aberto = await pg.evaluate(() => !!document.querySelector('#modalHost').children.length);
    if (/nada foi excluído/i.test(t) && !/Bem excluído/.test(t) && aberto) ok('DELETE sem linha devolvida: "nada foi excluído" (sem o "Bem excluído" falso), formulário aberto'); else falha('rls: ' + JSON.stringify([t, aberto]));
    await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren());
    await abrirBem(pg, 1); await pg.waitForTimeout(200); bt = await botoes(pg);
    if (!bt.some((x) => /Excluir/.test(x))) ok('bem protegido: Estratégico não vê botão de exclusão'); else falha('lucas protegido: ' + JSON.stringify(bt));
    await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { perfil: 'acordos' }); await pg.evaluate((B) => { window.__BENS = B; }, BENS); await pg.waitForTimeout(500);
    await abrirBem(pg, 0); await pg.waitForTimeout(200); const b0 = await botoes(pg); await pg.evaluate(() => document.querySelector('#modalHost').replaceChildren()); await abrirBem(pg, 1); await pg.waitForTimeout(200); const b1 = await botoes(pg);
    if (!b0.some((x) => /Excluir/.test(x)) && !b1.some((x) => /Excluir/.test(x)) && b0.some((x) => /^Salvar/.test(x))) ok('Acordos: edita o bem, mas não vê exclusão (exposto nem protegido)'); else falha('acordos: ' + JSON.stringify([b0, b1]));
    await ctx.close(); }
  { const { ctx, pg, chamadas, trocar } = await abrir(b, { perfil: 'admin' }); await pg.evaluate((B) => { window.__BENS = B; }, BENS); await pg.waitForTimeout(500);
    await abrirBem(pg, 1); await pg.waitForTimeout(200); const bt = await botoes(pg);
    if (bt.includes('Excluir (administradora)')) ok('administradora: bem protegido mostra "Excluir (administradora)"'); else falha('admin protegido: ' + JSON.stringify(bt));
    await clicar(pg, 'Excluir (administradora)'); await pg.waitForTimeout(200);
    const temMotivo = await pg.evaluate(() => !!document.querySelector('#modalHost #b-motivo'));
    trocar((m, p) => /bem_excluir_protegido/.test(p) ? { status: 200, body: null } : null);
    await pg.fill('#b-motivo', 'bem vendido antes da proteção'); await clicar(pg, 'Excluir (administradora)'); await pg.waitForTimeout(400);
    const ch = chamadas.find((x) => /bem_excluir_protegido/.test(x)) || ''; const t = await toastTxt(pg);
    if (temMotivo && /"p_id":"b0000000-0000-0000-0000-0000000000e2"/.test(ch) && /"p_motivo":"bem vendido antes da proteção"/.test(ch) && /autorização/.test(t) && !chamadas.some((x) => /^DELETE \/rest\/v1\/bens/.test(x))) ok('protegido: pede motivo e chama bem_excluir_protegido (nenhum DELETE direto)'); else falha('admin rpc: ' + JSON.stringify([temMotivo, ch, t, chamadas]));
    await abrirBem(pg, 0); await pg.waitForTimeout(200);
    trocar((m, p) => m === 'DELETE' && /\/rest\/v1\/bens/.test(p) ? { status: 200, body: [{ id: 'b0000000-0000-0000-0000-0000000000e1' }] } : null);
    await clicar(pg, 'Excluir'); await clicar(pg, 'Excluir'); await pg.waitForTimeout(400);
    if (/^Bem excluído/.test(await toastTxt(pg))) ok('exposto, banco devolve a linha: "Bem excluído"'); else falha('admin exposto: ' + await toastTxt(pg));
    await ctx.close(); }
  await b.close(); srv.close && srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
