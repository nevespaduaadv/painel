/* Laboratório do início da V11 — Equipe e gestão → Cargos funcionais em V3.1 (depende da migração 0113).
   Playwright + Chromium locais; servidor e fixtures fictícias do integracoes-lab. TODA chamada a *.supabase.co é interceptada.
   Uso: NODE_PATH=<módulos> node docs/qa/cargos-lab.cjs [pasta de saída]  (padrão /tmp/cargos-lab)
   Verifica: ambiente sem a 0113 (mensagem, nenhuma ação), lista (vagos, pendência, ocupados, inativos), fila do cargo, painel,
   designar e encerrar pelas funções do banco, quem não é administradora não tem ação, a vista Pessoas segue como estava,
   nenhuma gravação ao navegar, as 8 combinações. */
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '/tmp/cargos-lab'; fs.mkdirSync(OUT, { recursive: true });
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8');
const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '').replace("const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });", "const OUT = '" + OUT.replace(/'/g, "\\'") + "';");
const M = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + '\nmodule.exports={servir,contexto,dia,medirContraste,medirAlvos};')(M, M, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto, medirContraste, medirAlvos } = M.exports;
const { chromium } = require('playwright');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const PES = [{ id: 'col-a', nome: 'Ana Teste', nucleo: 'socios', ativo: true, perfil_id: 'u-admin' }, { id: 'col-l', nome: 'Lucas Teste', nucleo: 'juridico', ativo: true, perfil_id: 'u-luc' }, { id: 'col-n', nome: 'Nina Teste', nucleo: 'juridico', ativo: true, perfil_id: 'u-nin' }, { id: 'col-m', nome: 'Mario Teste', nucleo: 'juridico', ativo: true, perfil_id: null }];
const oc = (id, cid, nome, x = {}) => ({ ocupacao_id: id, colaborador_id: cid, nome, tipo: 'titular', principal: true, ordem: 0, inicio: '2026-11-01T12:00:00Z', afastado_de: null, afastado_ate: null, pendencia: null, tarefas_abertas: 0, ...x });
const CARGOS = [
  { id: 'g1', codigo: 'responsavel_juridico', nome: 'Responsável Jurídico', nucleo: 'juridico', frente: 'juridico', acessos: ['clientes', 'juridico', 'tarefas_equipe'], responsavel_nucleo: true, responsavel_frente: true, responsabilidades: 'Responde pelos prazos e revisa as situações críticas.', ativo: true, modalidade: 'coordenacao', distribuicao: 'fila', vago: false, ocupante_id: 'col-l', ocupantes: [oc('o1', 'col-l', 'Lucas Teste', { tarefas_abertas: 4 })], tarefas_abertas: 4, monitoramentos: 1, na_fila: 0 },
  { id: 'g2', codigo: 'operador_juridico', nome: 'Operador Jurídico', nucleo: 'juridico', frente: 'juridico', acessos: ['clientes', 'juridico', 'superendividamento'], responsavel_nucleo: false, responsavel_frente: false, responsabilidades: null, ativo: true, modalidade: 'operacional', distribuicao: 'fila', vago: false, ocupantes: [oc('o2', 'col-n', 'Nina Teste', { tarefas_abertas: 2 }), oc('o3', 'col-m', 'Mario Teste', { pendencia: 'sem login', principal: false })], tarefas_abertas: 5, monitoramentos: 0, na_fila: 3 },
  { id: 'g3', codigo: 'responsavel_financeiro', nome: 'Responsável Financeiro', nucleo: 'administrativo', frente: null, acessos: ['financeiro'], responsavel_nucleo: false, responsavel_frente: false, responsabilidades: null, ativo: true, modalidade: 'coordenacao', distribuicao: 'fila', vago: true, ocupantes: [], tarefas_abertas: 0, monitoramentos: 0, na_fila: 0 },
  { id: 'g4', codigo: 'cargo_antigo', nome: 'Cargo antigo fictício', nucleo: 'juridico', frente: null, acessos: [], ativo: false, modalidade: 'coordenacao', distribuicao: 'fila', vago: true, ocupantes: [], tarefas_abertas: 0, monitoramentos: 0, na_fila: 0 },
];
const PEND = [
  { tabela: 'tarefas', registro: 't-1', descricao: 'Protocolar manifestação fictícia', cliente_id: 'c-x', prazo: '2026-12-20', prioridade: 1, cargo_id: 'g2', cargo: 'Operador Jurídico', created_at: '2026-11-10T12:00:00Z' },
  { tabela: 'tarefas', registro: 't-2', descricao: 'Recurso fictício com prazo fatal', cliente_id: 'c-x', prazo: '2026-12-05', prioridade: 3, cargo_id: 'g2', cargo: 'Operador Jurídico', created_at: '2026-11-11T12:00:00Z' },
  { tabela: 'monitoramentos', registro: 'm-1', descricao: 'Monitoramento do cliente', cliente_id: 'c-x', prazo: null, prioridade: null, cargo_id: 'g2', cargo: 'Operador Jurídico', created_at: '2026-11-12T12:00:00Z' },
  { tabela: 'tarefas', registro: 't-9', descricao: 'Fechamento fictício com prazo fatal', cliente_id: null, prazo: '2026-12-01', prioridade: 1, cargo_id: 'g3', cargo: 'Responsável Financeiro', created_at: '2026-11-12T12:00:00Z' },
  { tabela: 'tarefas', registro: 't-0', descricao: 'Sem cargo', cliente_id: null, prazo: null, prioridade: 1, cargo_id: null, cargo: null, created_at: '2026-11-12T12:00:00Z' }];
const HRESP = [{ tabela: 'tarefas', registro: 't-2', de: 'col-l', para: 'fila-g2', motivo: 'ocupação encerrada: mudança de função', quando: '2026-11-11T12:00:00Z' }];
const HIST = [{ id: 'h1', colaborador_id: 'col-n', tipo: 'titular', inicio: '2026-09-01T12:00:00Z', fim: '2026-10-31T12:00:00Z', motivo: 'início', motivo_fim: 'mudança de função' }];
const V = '#view-equipe';
async function abrir(b, o = {}) {
  const r = await contexto(b, { hash: '#equipe', ...o });
  const json = (rota, corpo, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: JSON.stringify(corpo) });
  await r.ctx.route(/supabase\.co\/rest\/v1\/(v_cargos|v_cargos_divergencias|v_distribuicao_pendente|responsavel_historico|tarefas\?select=id%2Cprazo_fatal|cargo_ocupacoes|v_colaboradores|v_perfis_sem_colaborador)/, (rota) => {
    const u = new URL(rota.request().url()); const p = u.pathname; if (rota.request().method() !== 'GET') return rota.fallback();
    if (p.startsWith('/rest/v1/v_cargos_divergencias')) return o.sem0113 ? json(rota, { code: '42P01', message: 'relation "public.v_cargos_divergencias" does not exist' }, 404) : json(rota, o.div ? [{ colaborador_id: 'col-n', nome: 'Nina Teste', acessos_gravados: ['clientes', 'financeiro'], acessos_dos_cargos: ['clientes', 'juridico'] }] : []);
    if (p.startsWith('/rest/v1/v_distribuicao_pendente')) return json(rota, o.semFila ? [] : PEND);
    if (p.startsWith('/rest/v1/responsavel_historico')) return json(rota, HRESP);
    if (p.startsWith('/rest/v1/tarefas')) return json(rota, [{ id: 't-1', prazo_fatal: false, prazo_hora: null }, { id: 't-2', prazo_fatal: true, prazo_hora: null }, { id: 't-9', prazo_fatal: true, prazo_hora: null }]);
    if (p.startsWith('/rest/v1/v_cargos')) return o.sem0113 ? json(rota, { code: 'PGRST205', message: "Could not find the table 'public.v_cargos' in the schema cache" }, 404) : json(rota, CARGOS);
    if (p.startsWith('/rest/v1/cargo_ocupacoes')) return json(rota, (u.searchParams.get('cargo_id') || '') === 'eq.g2' ? HIST : []);
    if (p.startsWith('/rest/v1/v_colaboradores')) return json(rota, PES);
    return json(rota, []);
  });
  await r.pg.reload({ waitUntil: 'load' });
  await r.pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined', null, { timeout: 20000 });
  await r.pg.evaluate(() => { if (S.tab !== 'equipe') { S.tab = 'equipe'; render(); } }); await r.pg.waitForTimeout(700);
  if (o.casca !== 'v2' && !o.ficarEmPessoas) { await r.pg.click(V + ' .np-eq-abas button:has-text("Cargos")'); await r.pg.waitForFunction((V) => document.querySelector(V + ' li.np-it, ' + V + ' .np-vazio, ' + V + ' .np-erro'), V, { timeout: 15000 }); await r.pg.waitForTimeout(400); }
  return r;
}
const t = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const estado = (pg) => pg.evaluate((V) => { const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const linha = (id) => { const li = document.querySelector(`${V} li.np-it[data-id="${id}"]`); return li ? { regua: [...li.classList].filter(c => /^r-/.test(c)).join(), titulo: t(li.querySelector('.tx')), ctx: t(li.querySelector('.ctx')), marcas: [...li.querySelectorAll('.np-it-dir .np-marca')].map(m => m.textContent + '|' + [...m.classList].filter(c => c !== 'np-marca').join()), quem: [...li.querySelectorAll('.np-quem')].map(t) } : null; };
  return { resumo: t(document.querySelector(V + ' .np-resumo')), grupos: [...document.querySelectorAll(V + ' .np-grp')].map(g => t(g.querySelector('.np-grp-h')) + ':' + [...g.querySelectorAll('li.np-it')].map(li => li.dataset.id).join(',')), g1: linha('g1'), g2: linha('g2'), g3: linha('g3'), aviso: t(document.querySelector(V + ' .np-corpo > .np-erro')) }; }, V);
const painel = (pg) => pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); if (!p || p.hidden) return null; const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[t(dt)] = t(dt.nextElementSibling)); return { titulo: t(p.querySelector('h2')), props, secoes: [...p.querySelectorAll('.np-sec h3')].map(t), ocup: [...p.querySelectorAll('.np-cargo-oc > li')].map(li => ({ tx: t(li), ac: [...li.querySelectorAll('.np-btn')].map(t) })), botoes: [...p.querySelectorAll('.np-btn')].map(t), hist: t(p.querySelector('.np-passos')) }; }, V);
const lateral = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

(async () => {
  const srv = await servir(); const b = await chromium.launch();
  rel.push('1. Ambiente sem a migração 0113 (beta e produção hoje)');
  { const { ctx, pg, erros, escritas } = await abrir(b, { sem0113: true }); const tx = await t(pg, V + ' .np-vazio');
    if (/ainda não instalados neste ambiente/.test(tx || '') && /migração 0113/.test(tx) && !(await pg.$(V + ' .np-btn.pri')) && !escritas.length && !erros.length) ok('sem a 0113: a tela explica, não mostra ação nenhuma e não grava nada'); else falha('sem 0113: ' + JSON.stringify([tx, escritas.slice(0, 2), erros.slice(0, 2)]));
    await pg.screenshot({ path: path.join(OUT, 'cargos-1440-light-sem-0113.png') }); await ctx.close(); }
  rel.push('2. Cargos — lista, painel e ações (perfil administradora, 1440 px)');
  { const { ctx, pg, erros, escritas } = await abrir(b, {}); const e = await estado(pg);
    if (/^3 cargos ativos/.test(e.resumo) && /3 pessoas em cargos/.test(e.resumo) && /1 cargo vago/.test(e.resumo) && /3 na fila, sem pessoa/.test(e.resumo) && /1 sem responsável e sem cargo/.test(e.resumo)) ok(`resumo: "${e.resumo}"`); else falha('resumo: ' + e.resumo);
    if (JSON.stringify(e.grupos) === JSON.stringify(['Vagos1:g3', 'Com pendência1:g2', 'Ocupados1:g1', 'Inativos1:g4', 'Atividades sem responsável e sem cargo1:orf-t-0'])) ok('grupos: vagos → com pendência → ocupados → inativos (fechado) → atividades sem responsável e sem cargo (nada fica invisível)'); else falha('grupos: ' + JSON.stringify(e.grupos));
    if (e.g3 && e.g3.regua === 'r-fatal' && e.g3.marcas.some(m => /^vago\|crit/.test(m)) && e.g3.marcas.some(m => /^1 com prazo fatal na fila\|crit/.test(m)) && e.g2 && e.g2.regua === 'r-fatal' && e.g2.marcas.some(m => /^3 na fila\|att/.test(m)) && e.g2.marcas.some(m => /^1 com prazo fatal na fila\|crit/.test(m)) && e.g2.quem.length === 2 && /operacional · 2 ocupantes · fila/.test(e.g2.ctx) && /2 atividade\(s\) com prazo fatal aguardam distribuição/.test(e.aviso || '') && /Responsável Financeiro \(1\) — cargo vago/.test(e.aviso) && e.g1 && /coordenação · 3 áreas de acesso/.test(e.g1.ctx)) ok('linhas: cargo vago em destaque; operacional com "2 ocupantes" e "3 na fila"; prazo fatal na fila aparece na linha e em aviso no topo, inclusive no cargo vago'); else falha('linhas: ' + JSON.stringify([e.aviso, e.g1, e.g2, e.g3]));
    await pg.click(`${V} li.np-it[data-id="g2"] .np-it-abrir`); await pg.waitForTimeout(900); let p = await painel(pg);
    if (p && p.titulo === 'Operador Jurídico' && /ninguém recebe automaticamente/.test(p.props['Modalidade']) && /Clientes, Jurídico, Superendividamento/.test(p.props['Acessos do cargo']) && p.ocup.length === 2 && /sem login|pendência/.test(p.ocup[1].tx) && JSON.stringify(p.ocup[0].ac) === JSON.stringify(['Encerrar ocupação', 'Registrar afastamento']) && /Nina ocupante · cargo principal da pessoa/.test(p.ocup[0].tx) && !/titular/.test(p.ocup.map(x => x.tx).join(' ')) && /Nina Teste · ocupante/.test(p.hist || '') && /mudança de função/.test(p.hist) && p.botoes.includes('Designar pessoa')) ok('painel: cargo operacional chama as pessoas de "ocupante" (nunca "titular"), marca o cargo principal, mostra pendência e histórico com motivo; ações Designar, Encerrar, Afastamento'); else falha('painel: ' + JSON.stringify(p));
    await pg.screenshot({ path: path.join(OUT, 'cargos-1440-light-painel.png') });
    if (!escritas.length) ok('nenhuma gravação ao listar e abrir o painel'); else falha('escritas: ' + JSON.stringify(escritas.slice(0, 2)));
    await pg.click(V + ' .np-painel .np-btn:has-text("Designar pessoa")'); await pg.waitForTimeout(500);
    const opc = await pg.evaluate(() => [...document.querySelectorAll('#cg-pes option')].map(o => o.textContent));
    await pg.selectOption('#cg-pes', 'col-l'); let n0 = escritas.length; await pg.click('button.np-f-salvar'); await pg.waitForTimeout(500);
    const semMotivo = escritas.length === n0; await pg.fill('#cg-mot', 'Reforço da equipe'); await pg.click('button.np-f-salvar'); await pg.waitForTimeout(800); let w = escritas.slice(n0);
    if (!opc.some(x => /Nina|Mario/.test(x)) && opc.some(x => /Lucas/.test(x)) && semMotivo && w.length === 1 && /rpc\/cargo_designar/.test(w[0]) && /"p_cargo":"g2"/.test(w[0]) && /"p_colab":"col-l"/.test(w[0]) && /"p_tipo":"titular"/.test(w[0]) && /"p_motivo":"Reforço da equipe"/.test(w[0])) ok('Designar: quem já ocupa não aparece; motivo obrigatório; uma chamada à função do banco (cargo, pessoa, titular, motivo)'); else falha('designar: ' + JSON.stringify([opc, semMotivo, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(500);
    await pg.click(`${V} li.np-it[data-id="g2"] .np-it-abrir`); await pg.waitForTimeout(700); await pg.click(V + ' .np-cargo-oc > li:first-child .np-btn'); await pg.waitForTimeout(500);
    const temPara = !!(await pg.$('#ce-para')); n0 = escritas.length; await pg.fill('#ce-mot', 'Mudança de função'); await pg.click('button.np-f-salvar'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (temPara && w.length === 1 && /rpc\/cargo_encerrar/.test(w[0]) && /"p_ocupacao":"o2"/.test(w[0]) && /"p_motivo":"Mudança de função"/.test(w[0]) && /"p_para":null/.test(w[0])) ok('Encerrar ocupação: pergunta para onde vai a carteira aberta (padrão: fila do cargo, ninguém recebe automaticamente); uma chamada com o motivo'); else falha('encerrar: ' + JSON.stringify([temPara, w]));
    // --- fila clicável, distribuição, afastamento, criar cargo
    await pg.click(`${V} li.np-it[data-id="g2"] .np-it-dir button.np-fila-b.att`); await pg.waitForTimeout(1200);
    const f = await pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; return { titulo: t(p.querySelector('h2')), nota: t(p.querySelector('.np-nota')), itens: [...p.querySelectorAll('.np-fila > li')].map(li => ({ cls: li.className, tx: t(li), ac: [...li.querySelectorAll('.np-btn')].map(t) })), pe: [...p.querySelectorAll('.np-btn')].map(t).filter(x => !/^Distribuir$/.test(x)) }; }, V);
    if (f.titulo === 'Fila de distribuição (3)' && f.itens.length === 3 && f.itens[0].cls === 'fatal' && /Recurso fictício com prazo fatal prazo fatal prioridade alta/.test(f.itens[0].tx) && /antes com Lucas Teste/.test(f.itens[0].tx) && /prazo /.test(f.itens[0].tx) && /sem responsável anterior/.test(f.itens[1].tx) && /Monitoramento/.test(f.itens[2].tx) && f.itens.every(i => i.ac.join() === 'Distribuir') && /1 com prazo fatal/.test(f.nota) && f.pe.join() === 'Voltar ao cargo') ok('"3 na fila" é clicável: abre as 3 atividades, prazo fatal primeiro e em destaque, com cliente, prazo, urgência e responsável anterior; sem ocupante único, não há "distribuir tudo"'); else falha('fila: ' + JSON.stringify(f));
    await pg.screenshot({ path: path.join(OUT, 'cargos-1440-light-fila.png') });
    n0 = escritas.length; await pg.click(V + ' .np-fila > li:first-child .np-btn'); await pg.waitForTimeout(500);
    const dest = await pg.evaluate(() => [...document.querySelectorAll('#cd-pes option')].map(o => o.textContent));
    await pg.click('button.np-f-salvar'); await pg.waitForTimeout(400); const semEscolha = escritas.length === n0;
    await pg.selectOption('#cd-pes', 'col-n'); await pg.fill('#cd-mot', 'Distribuição da fila'); await pg.click('button.np-f-salvar'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (dest.length === 2 && /Nina Teste \(ocupante/.test(dest[1]) && !dest.some(x => /Mario/.test(x)) && semEscolha && w.length === 1 && /rpc\/atividade_transferir/.test(w[0]) && /"p_tabela":"tarefas"/.test(w[0]) && /"p_id":"t-2"/.test(w[0]) && /"p_para":"col-n"/.test(w[0]) && /"p_motivo":"Distribuição da fila"/.test(w[0])) ok('Distribuir: só ocupante elegível aparece (quem está sem login não); pessoa e motivo obrigatórios; uma chamada à função do banco, que registra a auditoria'); else falha('distribuir: ' + JSON.stringify([dest, semEscolha, w]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(600);
    await pg.click(`${V} li.np-it[data-id="g3"] .np-it-dir button.np-fila-b.crit`); await pg.waitForTimeout(900);
    const fv = await pg.evaluate((V) => { const p = document.querySelector(V + ' .np-painel'); const t = (e) => e ? e.textContent.replace(/\s+/g, ' ').trim() : null; return { nota: t(p.querySelector('.np-nota')), n: p.querySelectorAll('.np-fila > li').length, ac: p.querySelectorAll('.np-fila .np-btn').length }; }, V);
    if (fv.n === 1 && /O cargo está vago: estas atividades não estão com ninguém/.test(fv.nota) && fv.ac === 0) ok('cargo vago: a atividade com prazo fatal continua visível, com o aviso de que não está com ninguém'); else falha('fila do vago: ' + JSON.stringify(fv));
    await pg.click(`${V} li.np-it[data-id="g1"] .np-it-abrir`); await pg.waitForTimeout(800); p = await painel(pg);
    const titularOk = p && /Lucas titular · cargo principal da pessoa/.test(p.ocup[0].tx) && /um titular e, se houver, um substituto/.test(p.props['Modalidade']);
    n0 = escritas.length; await pg.click(V + ' .np-cargo-oc > li:first-child .np-btn:has-text("Registrar afastamento")'); await pg.waitForTimeout(500);
    await pg.fill('#ca-de', '2026-12-01'); await pg.fill('#ca-ate', '2026-11-20'); await pg.click('button.np-f-salvar'); await pg.waitForTimeout(400); const invalido = escritas.length === n0;
    await pg.fill('#ca-ate', '2026-12-15'); await pg.click('button.np-f-salvar'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (titularOk && invalido && w.length === 1 && /rpc\/cargo_afastar/.test(w[0]) && /"p_ocupacao":"o1"/.test(w[0]) && /"p_de":"2026-12-01"/.test(w[0]) && /"p_ate":"2026-12-15"/.test(w[0])) ok('cargo de coordenação usa "titular"; afastamento: período inválido é recusado na tela; uma chamada com as duas datas'); else falha('afastar: ' + JSON.stringify([titularOk, invalido, w, p && p.ocup]));
    await pg.waitForFunction((V) => document.querySelector(V + ' li.np-it'), V, { timeout: 15000 }); await pg.waitForTimeout(600);
    n0 = escritas.length; await pg.click('.np-btn.pri:has-text("Novo cargo")'); await pg.waitForTimeout(500);
    await pg.fill('#ck-nome', 'Controladoria Jurídica'); const codAuto = await pg.inputValue('#ck-cod'); await pg.selectOption('#ck-mod', 'operacional'); const travado = await pg.evaluate(() => [...document.querySelectorAll('.np-cargo-ac input, #modalHost input[type=checkbox], .np-modal input[type=checkbox]')].length);
    await pg.selectOption('#ck-dist', 'rodizio'); await pg.evaluate(() => { const l = [...document.querySelectorAll('.np-cargo-ac label')].find(x => /^Jurídico/.test(x.textContent.trim())); (l.querySelector('input') || document.getElementById(l.getAttribute('for'))).click(); });
    await pg.click('button.np-f-salvar'); await pg.waitForTimeout(800); w = escritas.slice(n0);
    if (codAuto === 'controladoria_juridica' && travado > 5 && w.length === 1 && /rpc\/cargo_salvar/.test(w[0]) && /"p_id":null/.test(w[0]) && /"p_codigo":"controladoria_juridica"/.test(w[0]) && /"p_modalidade":"operacional"/.test(w[0]) && /"p_distribuicao":"rodizio"/.test(w[0]) && /"p_acessos":\["juridico"\]/.test(w[0]) && /"p_responsavel_nucleo":false/.test(w[0])) ok('Novo cargo: código gerado do nome, modalidade operacional com rodízio, acessos marcados; uma chamada à função do banco, sem SQL'); else falha('novo cargo: ' + JSON.stringify([codAuto, travado, w]));
    if (!erros.length) ok('sem erro de script'); else falha('erros: ' + JSON.stringify(erros.slice(0, 3)));
    await ctx.close(); }
  { const { ctx, pg } = await abrir(b, { div: true }); const e = await estado(pg);
    if (/1 acesso divergente do cargo/.test(e.resumo) && /Nina Teste/.test(e.aviso || '')) ok('divergência entre acessos gravados e cargos aparece em destaque, com o nome da pessoa'); else falha('divergência: ' + JSON.stringify([e.resumo, e.aviso])); await ctx.close(); }
  { const { ctx, pg } = await abrir(b, {}); await pg.evaluate(() => { PP.perfil = { ...PP.perfil, papel: 'colaborador', acessos: ['equipe', 'clientes'] }; render(); }); await pg.waitForTimeout(500);
    const visivel = await pg.$(`${V} li.np-it[data-id="g2"] .np-it-abrir`); if (visivel) { await pg.click(`${V} li.np-it[data-id="g2"] .np-it-abrir`); await pg.waitForTimeout(700); }
    const p = await painel(pg); if (p && JSON.stringify(p.botoes) === JSON.stringify(['Ver a fila (3)'])) ok('quem não é administradora vê os cargos e os ocupantes, sem nenhuma ação (o banco também recusa)'); else falha('não admin: ' + JSON.stringify(p && p.botoes)); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { ficarEmPessoas: true }); const r = await pg.evaluate((V) => ({ abas: [...document.querySelectorAll(V + ' .np-eq-abas button')].map(x => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')), h1: document.querySelector(V + ' .head h1')?.textContent, linhas: document.querySelectorAll(V + ' table tbody tr').length }), V);
    if (JSON.stringify(r.abas) === JSON.stringify(['Pessoas*', 'Cargos']) && r.h1 === 'Equipe' && r.linhas >= 4 && !erros.length) ok('vista Pessoas: continua a tela atual de Equipe, com as mesmas pessoas (ainda na apresentação V2)'); else falha('pessoas: ' + JSON.stringify([r, erros.slice(0, 2)])); await ctx.close(); }
  { const { ctx, pg, erros } = await abrir(b, { casca: 'v2' }); const r = await pg.evaluate((V) => ({ h1: document.querySelector(V + ' .head h1')?.textContent, abas: !!document.querySelector(V + ' .np-eq-abas') }), V);
    if (r.h1 === 'Equipe' && !r.abas && !erros.length) ok('V2 intacta: Equipe sem a vista de cargos'); else falha('V2: ' + JSON.stringify(r)); await ctx.close(); }
  rel.push('3. 375 / 768 / 1024 / 1440 × claro / escuro — lista e painel');
  for (const w of [375, 768, 1024, 1440]) for (const tema of ['light', 'dark']) {
    const { ctx, pg, erros } = await abrir(b, { w, h: w < 800 ? 780 : 900, tema }); const l1 = await lateral(pg);
    const m = await medirContraste(pg, [{ sel: V + ' .np-resumo b', nome: 'número' }, { sel: V + ' .np-resumo span', nome: 'rótulo' }, { sel: V + ' .np-grp-h .t', nome: 'grupo' }, { sel: V + ' li.np-it .np-it-abrir .tx', nome: 'cargo' }, { sel: V + ' li.np-it .np-it-abrir .ctx', nome: 'contexto' }, { sel: V + ' li.np-it .np-marca', nome: 'marca' }, { sel: V + ' .np-eq-abas .np-seg button', nome: 'vista' }, { sel: V + ' .np-rodape', nome: 'rodapé' }]);
    let alv = []; if (w === 375) alv = (await medirAlvos(pg, V)).filter(a => a.h < 44 && !/np-it$/.test(a.nome));
    await pg.screenshot({ path: path.join(OUT, `cargos-${w}-${tema}.png`) });
    await pg.click(`${V} li.np-it[data-id="g2"] .np-it-abrir`); await pg.waitForTimeout(800); const l2 = await lateral(pg);
    const mp = await medirContraste(pg, [{ sel: V + ' .np-painel .np-props dt', nome: 'rótulo' }, { sel: V + ' .np-painel .np-props dd', nome: 'valor' }, { sel: V + ' .np-painel .np-sec h3', nome: 'seção' }, { sel: V + ' .np-cargo-oc .d', nome: 'desde' }, { sel: V + ' .np-cargo-oc .np-marca', nome: 'marca do ocupante' }, { sel: V + ' .np-painel .np-btn', nome: 'botão' }, { sel: V + ' .np-painel .np-passos li', nome: 'histórico' }]);
    let alvP = []; if (w === 375) alvP = (await medirAlvos(pg, V + ' .np-painel')).filter(a => a.h < 44);
    await pg.screenshot({ path: path.join(OUT, `cargos-${w}-${tema}-painel.png`) });
    const ruins = [...m.ruins, ...mp.ruins], aus = [...m.ausentesObrigatorios, ...mp.ausentesObrigatorios];
    if (l1 <= 0 && l2 <= 0 && !ruins.length && !aus.length && !alv.length && !alvP.length && !erros.length) ok(`${w} px ${tema}: sem rolagem lateral (lista e painel), contraste mínimo ${Math.min(m.minimo, mp.minimo).toFixed(2)}:1 em ${m.medidos.length + mp.medidos.length} medições${w === 375 ? ', alvos de toque ≥ 44 px' : ''}`);
    else falha(`${w} ${tema}: lateral ${l1}/${l2} · contraste ${JSON.stringify(ruins.slice(0, 4))} · ausentes ${JSON.stringify(aus)} · alvos ${JSON.stringify([...alv, ...alvP].slice(0, 5))} · erros ${JSON.stringify(erros.slice(0, 2))}`);
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.'); fs.writeFileSync(path.join(OUT, 'relatorio.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
