/* Laboratório da entrega visual V9 — Jurídico → Publicações em V3.1, com as marcas da integração AtendeDireito Sync.
   Playwright + Chromium locais; reaproveita o servidor e as fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co
   é interceptada; nada sai da máquina; nenhuma chamada ao fornecedor.
   Uso: NODE_PATH=<módulos> node docs/qa/publicacoes-lab.cjs [pasta de saída]  (padrão /tmp/publicacoes-lab)
   Dois cenários: (A) como o beta está hoje — sem a migração 0114: só DJEN, integração "não instalada", comandos desativados;
   (B) com a 0114 e dados fictícios do Sync: origem, prazo a conferir × conferido, fontes divergentes, conferência humana.
   Verifica também: nenhuma gravação ao navegar, só leitura, V2 intacta, as 8 combinações. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/publicacoes-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, dia, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright'); require('./_popup.cjs');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const b0 = { tribunal: 'TJSP', orgao: '2ª Vara Cível de Franca', tipo_comunicacao: 'Intimação', tipo_documento: 'Despacho', lida: true, ignorada: false, sem_vinculo: false, providencia: null, tarefas_atribuidas: 0, tarefas_atribuidas_abertas: 0, destinatarios: [{ nome: 'Empresa Alfa Ltda', polo: 'passivo' }], link: 'https://exemplo.invalid/doc' };
const PUB = [
  { ...b0, id: 101, data_disponibilizacao: dia(-6), numero_processo: '1000001-11.2026.8.26.0196', processo_id: 'p1', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', lida: false, dias_para_tratar: -2, prazo_tratamento: dia(-2), resumo: 'Manifeste-se a parte em 15 dias.', texto: 'Texto fictício da intimação 101. Manifeste-se a parte em 15 dias.', tarefa_id: 't-101', tarefa_status: 'aberta', tarefa_prazo: dia(-2) },
  { ...b0, id: 102, data_disponibilizacao: dia(-2), numero_processo: '2000002-22.2026.8.26.0196', processo_id: null, cliente_id: null, cliente_nome: null, sem_vinculo: true, cliente_sugerido_id: 'c3', cliente_sugerido_nome: 'Gama Comércio Ltda', dias_para_tratar: 0, prazo_tratamento: dia(0), resumo: 'Cite-se.', texto: 'Texto fictício 102.' },
  { ...b0, id: 105, data_disponibilizacao: dia(-1), numero_processo: '1000002-22.2026.8.26.0196', processo_id: 'p2', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', dias_para_tratar: 1, prazo_tratamento: dia(1), resumo: 'Sentença publicada.', texto: 'Texto fictício 105.', tarefa_id: 't-105', tarefa_status: 'aberta', tarefa_prazo: dia(12), tarefas_atribuidas: 1, tarefas_atribuidas_abertas: 1, atribuidas_para: 'Lucas Teste' },
  { ...b0, id: 103, data_disponibilizacao: dia(-9), numero_processo: '1000001-11.2026.8.26.0196', processo_id: 'p1', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', providencia: 'gerou_prazo', tratada_por_nome: 'Ana Teste', tratada_em: new Date(Date.now() - 8 * 864e5).toISOString(), tempestiva: true, resumo: 'Decisão.', texto: 'Texto fictício 103.' },
  { ...b0, id: 104, data_disponibilizacao: dia(-12), numero_processo: '3000003-33.2026.8.26.0196', processo_id: null, cliente_id: null, sem_vinculo: true, ignorada: true, resumo: 'Homônimo.', texto: 'Texto fictício 104.' },
];
const PUB_SYNC = [
  { ...b0, id: -1, data_disponibilizacao: dia(0), numero_processo: '1000001-11.2026.8.26.0196', processo_id: 'p1', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', lida: false, dias_para_tratar: 2, prazo_tratamento: dia(2), tipo_documento: 'Decisão', resumo: 'Rejeito os embargos.', texto: 'Texto fictício da intimação recebida pelo Sync.', link: null },
  { ...b0, id: -2, data_disponibilizacao: dia(-6), numero_processo: '1000001-11.2026.8.26.0196', processo_id: 'p1', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', dias_para_tratar: 1, prazo_tratamento: dia(1), resumo: 'Mesmo processo e dia, texto diferente.', texto: 'Texto fictício diferente.', link: null },
];
const FONTES = [
  { id: 1, publicacao_id: -1, fonte: 'sync', casamento: 'origem', divergencias: [], conciliada_em: null, primeira_vez: new Date().toISOString() },
  { id: 2, publicacao_id: 105, fonte: 'sync', casamento: 'identica', divergencias: [], conciliada_em: null, primeira_vez: new Date().toISOString() },
  { id: 3, publicacao_id: -2, fonte: 'sync', casamento: 'provavel', divergencias: [{ campo: 'possivel_duplicata', nosso: 101, fonte: 'x-2' }], conciliada_em: null, primeira_vez: new Date().toISOString() },
];
const PRAZOS = [
  { id: 11, publicacao_id: -1, origem: 'sync', rotulo: 'Embargos de declaração (5 dias)', data_sugerida: dia(7), estado: 'sugerido', data_conferida: null, fatal: null, tarefa_id: null },
  { id: 12, publicacao_id: -1, origem: 'sync', rotulo: 'Agravo de instrumento (15 dias)', data_sugerida: dia(21), estado: 'sugerido', data_conferida: null, fatal: null, tarefa_id: null },
  { id: 13, publicacao_id: 105, origem: 'sync', rotulo: 'Apelação (15 dias)', data_sugerida: dia(14), estado: 'corrigido', data_conferida: dia(12), fatal: true, conferido_por: 'u-outra', revisao_pendente: true, revisao_motivo: 'prazo fatal', conferido_por_nome: 'Ana Teste', conferido_em: new Date().toISOString(), observacao: 'Feriado local conferido nos autos.', tarefa_id: 't-105' },
];
const REL = [{ mes: '2026-11', tratada_por_nome: 'Ana Teste', publicacoes: 5, tratadas: 1, tempestivas: 1, pendentes_vencidas: 1, gerou_prazo: 1, nada_a_fazer: 0, duplicidade: 0, encaminhadas: 0, media_dias_para_tratar: 1 }];
const V = '#view-publicacoes';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#publicacoes', ...o, escrita: (m, p, c) => (o.escrita && o.escrita(m, p, c)) || (/rpc\/pode_conferir_prazo/.test(p) ? { status: 200, body: !o.semAtribuicao } : null) });
  const json = (rota, corpo, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  let falhar = o.erro || 0; const lista = o.vazio ? [] : o.sync ? [...PUB_SYNC, ...PUB] : PUB;
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_publicacoes|integracoes|publicacao_fontes|publicacao_prazos|publicacao_historico)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/v_publicacoes_resumo')) return json(rota, { ultimos_7d: 4, nao_lidas: 1, sem_vinculo: 1, ultima_busca: new Date().toISOString(), erros_recentes: 0, total: lista.length, ultima_data: dia(-1) });
    if (p.startsWith('/rest/v1/v_publicacoes_tempestividade')) return json(rota, REL);
    if (p.startsWith('/rest/v1/v_publicacoes')) { if (falhar > 0) { falhar--; return json(rota, { message: 'falha fictícia' }, 500); } return json(rota, lista); }
    if (p.startsWith('/rest/v1/integracoes')) return o.sync ? json(rota, { ativo: !!o.ativo, estado: o.ativo ? { conexao: 'ok', verificado_em: new Date().toISOString() } : {}, atualizado_em: null }) : json(rota, { code: '42P01', message: 'relation "public.integracoes" does not exist' }, 404);
    if (p.startsWith('/rest/v1/publicacao_fontes')) return json(rota, o.sync ? FONTES : []);
    if (p.startsWith('/rest/v1/publicacao_prazos')) return json(rota, o.sync ? PRAZOS : []);
    return json(rota, []);
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'publicacoes') { S.tab = 'publicacoes'; render(); } });
  if (o.erro || o.vazio) await r.pg.waitForFunction((V) => document.querySelector(V + ' .np-erro, ' + V + ' .np-vazio'), V, { timeout: 15000 });
  else if (o.casca !== 'v2') await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 });
  else await r.pg.waitForFunction((V) => document.querySelector(V + ' table tbody tr'), V, { timeout: 15000 });
  /* 25/11: a linha das integrações só aparece com falha ou por “Mais ações → Ver integrações”; os roteiros abaixo a conferem, então é aberta aqui */
  if (o.casca !== 'v2' && !o.erro && !o.vazio) { r.fontesPorPadrao = await r.pg.evaluate((V) => !!document.querySelector(V + ' .np-pub-fontes'), V); await r.pg.evaluate(() => window.PP_PUBLICACOES?.verIntegracoes?.(true)); await r.pg.waitForTimeout(150); }
  await r.pg.waitForTimeout(500);
  return r;
}
const estado = (pg) => pg.evaluate((V) => {
  const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  const linha = (id) => { const li = document.querySelector(`${V} li.np-it[data-id="${id}"]`); if (!li) return null; return { regua: [...li.classList].filter(c => /^r-/.test(c)).join(), naoLida: li.classList.contains('np-nao-lida'), prazo: t(li.querySelector('.np-it-prazo')), titulo: t(li.querySelector('.np-it-abrir .tx')), ctx: t(li.querySelector('.np-it-abrir .ctx')), marcas: [...li.querySelectorAll('.np-it-dir .np-marca')].map(m => m.textContent + '|' + [...m.classList].filter(c => c !== 'np-marca' && c !== 'np-so-largo').join()), quem: t(li.querySelector('.np-quem')) }; };
  return { resumo: t(document.querySelector(V + ' .np-resumo')), chips: [...document.querySelectorAll(V + ' .np-chipf')].map(c => t(c)), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h'))), ids: [...document.querySelectorAll(V + ' li.np-it')].map(li => li.dataset.id),
    fontes: t(document.querySelector(V + ' .np-pub-fontes')), rodape: t(document.querySelector(V + ' .np-rodape')), v2: !!document.querySelector(V + ' .kpis, ' + V + ' table, ' + V + ' .head'), pilulas: document.querySelectorAll(V + ' .pill').length,
    l101: linha('101'), l102: linha('102'), l105: linha('105'), s1: linha('-1'), s2: linha('-2') };
}, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling));
  return { titulo: t(p.querySelector('h2')), props, secoes: [...p.querySelectorAll('.np-sec h3')].map(t), botoes: [...p.querySelectorAll('.np-p-pe .np-btn, .np-painel-pe .np-btn')].map(t), todosBotoes: [...p.querySelectorAll('.np-btn')].map(t),
    prazos: [...p.querySelectorAll('.np-pub-pz > li')].map(li => ({ t: t(li.querySelector('.t')), dl: t(li.querySelector('dl')), ac: [...li.querySelectorAll('.ac .np-btn')].map(t) })), diverg: [...p.querySelectorAll('.np-pub-dv > li')].map(li => ({ tx: t(li), ac: [...li.querySelectorAll('.ac .np-btn')].map(t) })), texto: t(p.querySelector('.np-pub-texto')) }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== A. como o beta está hoje (sem a 0114) ==========
  rel.push('A. Publicações V3.1 sem a integração instalada — é o estado do beta hoje (perfil admin, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {});
    const e = await estado(pg);
    if (/^3 a analisar/.test(e.resumo) && /1 fora do prazo de análise/.test(e.resumo) && /1 sem processo/.test(e.resumo) && !/conferir/.test(e.resumo)) ok(`resumo: "${e.resumo}" (sem contagem de prazos a conferir enquanto a integração não existe)`); else falha('resumo: ' + e.resumo);
    if (JSON.stringify(e.grupos.map(g => g.replace(/\s*\d+$/, ''))) === JSON.stringify(['Análise fora do prazo', 'A analisar', 'Analisadas', 'Ignoradas'])) ok('grupos pela situação: fora do prazo → a analisar → analisadas → ignoradas'); else falha('grupos: ' + JSON.stringify(e.grupos));
    if (e.l101 && e.l101.regua === 'r-late' && e.l101.naoLida && /análise vencida há 2 d/.test(e.l101.prazo) && /Empresa Alfa Ltda · Despacho · TJSP/.test(e.l101.ctx)) ok(`101: régua de atraso, não lida em destaque, "${e.l101.prazo}"`); else falha('101: ' + JSON.stringify(e.l101));
    if (e.l102 && e.l102.regua === 'r-att' && e.l102.marcas.some(m => /^sem processo\|att/.test(m)) && /parece ser de Gama/.test(e.l102.ctx)) ok('102: analisar hoje, "sem processo", cliente sugerido no contexto'); else falha('102: ' + JSON.stringify(e.l102));
    if (e.l105 && /Lucas/.test(e.l105.quem || '') && !e.l105.marcas.some(m => /Sync/.test(m))) ok('105: tarefa atribuída aparece com o responsável; sem marca de origem (só DJEN)'); else falha('105: ' + JSON.stringify(e.l105));
    if (!e.chips.some(c => /Prazo a conferir|Fontes divergentes/.test(c)) && e.chips.some(c => /^A analisar\s*3$/.test(c)) && e.chips.some(c => /^Sem processo\s*1$/.test(c)) && !e.v2 && !e.pilulas) ok('filtros com contagem; sem filtros do Sync; nada da tela V2 (cartões, tabela, pílulas)'); else falha('chips: ' + JSON.stringify([e.chips, e.v2, e.pilulas]));
    if (/DJEN · última busca/.test(e.fontes) && /AtendeDireito Sync · não instalada neste ambiente/.test(e.fontes)) ok(`fontes: "${e.fontes}"`); else falha('fontes: ' + e.fontes);
    await pg.click(V + ' .np-pub-fontes .np-link'); await pg.waitForTimeout(300);
    const integ = await pg.evaluate(() => [...document.querySelectorAll('#np-pop .np-pub-integ-ac .np-btn')].map(x => x.textContent + ':' + x.disabled));
    if (JSON.stringify(integ) === JSON.stringify(['Testar conexão:true', 'Sincronizar agora:true', 'Ligar:true'])) ok('"Ver integração": Testar conexão, Sincronizar agora e Ligar aparecem DESATIVADOS'); else falha('integração: ' + JSON.stringify(integ));
    await pg.screenshot({ path: path.join(OUT, 'publicacoes-1440-light-integracao.png') }); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); await pg.evaluate(() => { if (document.querySelector('#np-pop.on')) window.NPUI?.fecharPop?.(); }); await pg.waitForTimeout(150); // no runner o Esc às vezes chega antes do foco voltar ao balão
    await pg.click(`${V} li.np-it[data-id="101"] .np-it-abrir`); await pg.waitForTimeout(700); const p = await painel(pg);
    if (p && p.titulo === '1000001-11.2026.8.26.0196' && /recebida/.test(p.props['Situação']) && p.props['Origem'].startsWith('DJEN') && /abrir no tribunal/.test(p.props['Origem']) && /Texto fictício da intimação 101/.test(p.texto) && !/sem processo/.test(p.props['Processo']) && !p.secoes.includes('Prazos')) ok(`painel 101: situação "${p.props['Situação']}", origem "${p.props['Origem']}", texto integral, sem seção de prazos`); else falha('painel 101: ' + JSON.stringify(p));
    if (p && ['Tratar', 'Atribuir tarefa', 'Marcar como lida'].every(x => p.todosBotoes.includes(x))) ok('ações do painel = as da tela atual: Tratar, Atribuir tarefa, Marcar como lida'); else falha('botões: ' + JSON.stringify(p && p.todosBotoes));
    await pg.screenshot({ path: path.join(OUT, 'publicacoes-1440-light-painel.png') });
    await pg.click(V + ' .np-seg button:has-text("Tempestividade")'); await pg.waitForTimeout(700);
    const relOk = await pg.evaluate((V) => /Tempestividade por mês/.test(document.querySelector(V + ' .np-pub-rel')?.textContent || '') && !document.querySelector(V + ' li.np-it'), V);
    if (relOk) ok('vista "Tempestividade": relatório do módulo atual, sem a lista'); else falha('tempestividade');
    await pg.click(V + ' .np-seg button:has-text("Publicações")'); await pg.waitForTimeout(400);
    if (!escritas.length) ok('nenhuma gravação ao listar, filtrar, abrir o painel e trocar de vista'); else falha('escritas: ' + JSON.stringify(escritas.slice(0, 3)));
    // ler não é tratar: marcar como lida muda só a leitura
    await pg.click(`${V} li.np-it[data-id="101"] .np-it-abrir`); await pg.waitForTimeout(500); const nL = escritas.length; await pg.click(`${V} .np-painel .np-btn:has-text("Marcar como lida")`); await pg.waitForTimeout(600);
    const wl = escritas.slice(nL); if (wl.length === 1 && /^PATCH \/rest\/v1\/publicacoes/.test(wl[0]) && /\{"lida":true\}/.test(wl[0]) && !/providencia|tratada/.test(wl[0])) ok('"Marcar como lida" grava só a leitura (lida = true): não registra providência nem tratamento'); else falha('lida: ' + JSON.stringify(wl));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3)));
    await ctx.close(); }
  // ========== B. com a 0114 e dados fictícios do Sync ==========
  rel.push('B. Com a integração instalada e desligada, e registros fictícios vindos do Sync');
  { const { ctx, pg, erros, escritas } = await abrir(b, { sync: true });
    const e = await estado(pg);
    if (/^5 a analisar/.test(e.resumo) && /1 prazo a conferir/.test(e.resumo) && /1 prazo em revisão/.test(e.resumo) && e.l105.marcas.some(m => /^prazo em revisão\|att/.test(m))) ok(`resumo: "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (e.chips.some(c => /^Prazo a conferir\s*1$/.test(c)) && e.chips.some(c => /^Fontes divergentes\s*1$/.test(c)) && /AtendeDireito Sync · desligada/.test(e.fontes)) ok('filtros "Prazo a conferir" e "Fontes divergentes"; integração mostrada como desligada'); else falha('chips: ' + JSON.stringify([e.chips, e.fontes]));
    if (e.s1 && e.s1.marcas.some(m => /^2 prazos a conferir\|att/.test(m)) && e.s1.marcas.some(m => /^Sync\|info/.test(m))) ok('recebida pelo Sync: marcas "2 prazos a conferir" e "Sync"'); else falha('-1: ' + JSON.stringify(e.s1));
    if (e.l105 && e.l105.marcas.some(m => /^DJEN \+ Sync\|info/.test(m)) && !e.l105.marcas.some(m => /conferir/.test(m))) ok('mesma comunicação nas duas fontes: UMA linha, marca "DJEN + Sync"; prazo já conferido não aparece como pendência'); else falha('105: ' + JSON.stringify(e.l105));
    if (e.s2 && e.s2.marcas.some(m => /^fontes divergentes\|att/.test(m))) ok('possível duplicata: linha própria com "fontes divergentes"'); else falha('-2: ' + JSON.stringify(e.s2));
    await pg.click(`${V} li.np-it[data-id="-1"] .np-it-abrir`); await pg.waitForTimeout(700); let p = await painel(pg);
    if (p && p.secoes.includes('Prazos') && p.prazos.length === 2 && /a conferir/.test(p.prazos[0].t) && /Sugerido pela plataforma/.test(p.prazos[0].dl) && !/Conferido/.test(p.prazos[0].dl) && JSON.stringify(p.prazos[0].ac) === JSON.stringify(['Confirmar', 'Corrigir', 'Descartar']) && p.props['Origem'] === 'Sync') ok('painel: duas hipóteses de prazo "a conferir", só com a data sugerida; ações Confirmar, Corrigir, Descartar'); else falha('painel -1: ' + JSON.stringify(p));
    await pg.screenshot({ path: path.join(OUT, 'publicacoes-1440-light-prazos.png') });
    await pg.click(`${V} .np-pub-pz > li:first-child .ac .np-btn:has-text("Confirmar")`); await pg.waitForTimeout(500);
    const antes = escritas.length; await pg.click('button.np-f-salvar'); await pg.waitForTimeout(800);
    const ch = escritas.slice(antes).filter(x => /rpc\/publicacao_prazo_conferir/.test(x));
    if (ch.length === 1 && /"p_prazo":11/.test(ch[0]) && /"p_decisao":"confirmar"/.test(ch[0]) && /"p_fatal":false/.test(ch[0])) ok('Confirmar → uma chamada de conferência (prazo 11, decisão "confirmar", fatal só se marcado); nada antes do clique'); else falha('conferir: ' + JSON.stringify(escritas.slice(antes)));
    if (escritas.slice(0, antes).every(x => /rpc\/(prazo_revisor|pode_conferir_prazo)/.test(x))) ok('nenhuma gravação até a pessoa registrar a conferência'); else falha('escritas antes: ' + JSON.stringify(escritas.slice(0, 3)));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(400);
    await pg.click(`${V} li.np-it[data-id="105"] .np-it-abrir`); await pg.waitForTimeout(700); p = await painel(pg);
    if (p && p.prazos.length === 1 && /corrigido/.test(p.prazos[0].t) && /fatal/.test(p.prazos[0].t) && /Conferido por\s*Ana Teste/.test(p.prazos[0].dl) && /Registrado\s*na tarefa/.test(p.prazos[0].dl) && /Feriado local/.test(p.prazos[0].dl) && /aguardando revisão/.test(p.prazos[0].t) && /Revisão\s*pendente · prazo fatal/.test(p.prazos[0].dl) && JSON.stringify(p.prazos[0].ac) === JSON.stringify(['Reabrir'])) ok('prazo conferido: sugerido × conferido lado a lado, "fatal" marcado pela pessoa, quem e quando, tarefa, observação; "aguardando revisão" visível; quem não é revisor só tem Reabrir'); else falha('painel 105: ' + JSON.stringify(p && p.prazos));
    await pg.screenshot({ path: path.join(OUT, 'publicacoes-1440-light-conferido.png') });
    await pg.click(`${V} li.np-it[data-id="-2"] .np-it-abrir`); await pg.waitForTimeout(700); p = await painel(pg);
    if (p && p.secoes.includes('Fontes divergentes') && /Pode ser a mesma comunicação da publicação 101/.test(p.diverg[0].tx) && JSON.stringify(p.diverg[0].ac) === JSON.stringify(['É a mesma comunicação', 'São comunicações diferentes'])) ok('fontes divergentes: explicação e conciliação humana ("é a mesma" / "são diferentes")'); else falha('painel -2: ' + JSON.stringify(p && p.diverg));
    await pg.screenshot({ path: path.join(OUT, 'publicacoes-1440-light-divergencia.png') });
    // modo só leitura (quem não tem acesso ao Jurídico não vê a aba; a recusa da conferência está nos testes do banco, casos de permissão da 0114)
    await pg.evaluate(() => { S.canWrite = false; render(); }); await pg.waitForTimeout(400);
    await pg.click(`${V} li.np-it[data-id="-1"] .np-it-abrir`); await pg.waitForTimeout(600); p = await painel(pg);
    if (p && !p.todosBotoes.some(x => /Tratar|Atribuir|Confirmar|Vincular|Marcar/.test(x))) ok('só leitura: painel sem ações'); else falha('só leitura: ' + JSON.stringify(p && p.todosBotoes));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3)));
    await ctx.close(); }
  { const { ctx, pg, escritas } = await abrir(b, { sync: true, semAtribuicao: true });
    await pg.click(`${V} li.np-it[data-id="-1"] .np-it-abrir`); await pg.waitForTimeout(1200); const p = await painel(pg);
    const nota = await pg.evaluate((V) => [...document.querySelectorAll(V + ' .np-pub-pz p.np-nota')].map(x => x.textContent).join(' '), V);
    if (p && p.prazos.length === 2 && p.prazos.every(z => !z.ac.length) && /cabe a quem responde por este processo/.test(nota) && escritas.some(x => /rpc\/pode_conferir_prazo/.test(x) && /"p_publicacao":-1/.test(x)) && !escritas.some(x => /publicacao_prazo_conferir/.test(x))) ok('pessoa do Jurídico SEM atribuição sobre a publicação: vê os prazos, não vê Confirmar, Corrigir nem Descartar, e a tela explica por quê (a consulta é feita ao banco por publicação)'); else falha('sem atribuição: ' + JSON.stringify([p && p.prazos, nota, escritas.slice(0, 4)]));
    await ctx.close(); }
  { const { ctx, pg, escritas } = await abrir(b, { sync: true, escrita: (m, p) => /rpc\/prazo_revisor/.test(p) ? { status: 200, body: true } : null });
    await pg.click(`${V} li.np-it[data-id="105"] .np-it-abrir`); await pg.waitForTimeout(700); const p = await painel(pg);
    if (p && JSON.stringify(p.prazos[0].ac) === JSON.stringify(['Aprovar revisão', 'Devolver', 'Reabrir'])) ok('revisora (outra pessoa que não quem conferiu): Aprovar revisão e Devolver'); else falha('revisora: ' + JSON.stringify(p && p.prazos));
    const n0 = escritas.length; await pg.click(`${V} .np-pub-pz .ac .np-btn:has-text("Aprovar revisão")`); await pg.waitForTimeout(700);
    const ch = escritas.slice(n0).filter(x => /rpc\/publicacao_prazo_revisar/.test(x));
    if (ch.length === 1 && /"p_prazo":13/.test(ch[0]) && /"p_decisao":"aprovar"/.test(ch[0])) ok('Aprovar revisão → uma chamada de revisão (prazo 13, "aprovar")'); else falha('revisar: ' + JSON.stringify(escritas.slice(n0)));
    await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { sync: true, ativo: true }); const e = await estado(pg);
    if (/AtendeDireito Sync · ligada/.test(e.fontes)) ok('integração ligada e com conexão conferida aparece como "ligada"'); else falha('ligada: ' + e.fontes); await ctx.close(); }
  // ========== C. erro, vazio, V2 ==========
  rel.push('C. Erro, vazio e tela V2');
  { const { ctx, pg, leituras } = await abrir(b, { erro: 1 }); const n0 = leituras.filter(x => /v_publicacoes\?/.test(x)).length; await pg.waitForTimeout(2500); const n1 = leituras.filter(x => /v_publicacoes\?/.test(x)).length;
    const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-erro')?.textContent, V);
    if (/Não foi possível carregar as publicações/.test(tx || '') && n1 === n0) ok('erro de carga: faixa com "Tentar de novo", sem repetir a consulta sozinha'); else falha(`erro: ${tx} (${n0}→${n1})`);
    await pg.click(V + ' .np-erro .lnk'); await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); ok('"Tentar de novo" recarrega a lista'); await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { vazio: true }); const tx = await pg.evaluate((V) => document.querySelector(V + ' .np-vazio')?.textContent, V);
    if (/Nenhuma publicação no período/.test(tx || '') && /Buscar período/.test(tx)) ok('vazio: diz o que acontece e oferece "Buscar período"'); else falha('vazio: ' + tx); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const v2 = await pg.evaluate((V) => ({ kpis: !!document.querySelector(V + ' .kpis'), linhas: document.querySelectorAll(V + ' table tbody tr').length, tratar: [...document.querySelectorAll(V + ' button')].some(x => x.textContent === 'Tratar'), abas: [...document.querySelectorAll(V + ' .actions button')].map(x => x.textContent).filter(x => /Tempestividade/.test(x)).length, v3: !!document.querySelector(V + ' .np-toolbar') }), V);
    if (v2.kpis && v2.linhas >= 4 && v2.tratar && v2.abas === 1 && !v2.v3 && !erros.length) ok(`V2 intacta: indicadores, tabela (${v2.linhas} linhas), "Tratar" e aba Tempestividade`); else falha('V2: ' + JSON.stringify([v2, erros.slice(0, 2)])); await ctx.close(); }
  // ========== D. as 8 combinações ==========
  rel.push('D. 375 / 768 / 1024 / 1440 × claro / escuro — lista e painel com prazos');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { sync: true, w, h: w < 800 ? 780 : 900, tema });
    const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número do resumo' }, { sel: V + ' .np-resumo span', nome: 'rótulo do resumo' }, { sel: V + ' .np-grp-h .t', nome: 'título do grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'título da linha' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-it-prazo', nome: 'data' }, { sel: V + ' li.np-it .np-marca', nome: 'marca' }, { sel: V + ' .np-pub-fontes', nome: 'fontes' }, { sel: V + ' .np-pub-fontes .np-marca', nome: 'situação da integração' }, { sel: V + ' .np-rodape', nome: 'rodapé' }, { sel: V + ' .np-chipf', nome: 'filtro' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `publicacoes-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="-1"] .np-it-abrir`); await pg.waitForTimeout(700);
    const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-painel .np-sec h3', nome: 'título da seção' }, { sel: V + ' .np-painel .np-sec p.np-nota', nome: 'nota' }, { sel: V + ' .np-pub-pz .t', nome: 'prazo' }, { sel: V + ' .np-pub-pz dt', nome: 'rótulo do prazo' }, { sel: V + ' .np-pub-pz dd', nome: 'data do prazo' }, { sel: V + ' .np-pub-pz .np-marca', nome: 'marca do prazo' }, { sel: V + ' .np-pub-texto', nome: 'texto' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `publicacoes-${w}-${tema}-painel.png`) });
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral (lista e painel), contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 5))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
