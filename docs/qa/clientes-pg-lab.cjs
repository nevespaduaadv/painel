/* Laboratório de cadastro de clientes contra um PostgreSQL REAL (correção 15/11: clientes.nome é coluna GERADA).
   O front real (Playwright + Chromium) grava em clientes/notas_internas e as requisições são executadas num PostgreSQL com o esquema
   do espelho (docs/beta/esquema-espelho.sql + supabase/migrations/beta/0001–0013 + trilha), como `authenticated` com a sessão de um
   admin — RLS, coluna gerada e gatilhos (tarefas automáticas, boas-vindas, auditoria) são os do banco. Demais leituras usam as
   fixtures do integracoes-lab. NÃO roda no CI (exige o banco local descartável); uso local:
     PGLAB_HOST=/var/tmp/pg-recon PGLAB_PORT=5499 PGLAB_UID=<uuid de um perfil admin no banco local> \
     NODE_PATH=<módulos> node docs/qa/clientes-pg-lab.cjs [pasta]
   Cobre, em V2 e V3.1: "+ Novo cliente" (nome na coluna gerada, tarefas com o nome do cliente), nome vazio, "Editar cliente" preservando
   chaves do jsonb que o formulário não mostra (grupo, ciclo_*) e colunas da ficha, CNPJ apagado, atualização parcial (timeline) e
   Ficha cadastral. Tudo dentro do banco descartável; os clientes de teste são removidos no início de cada execução. */
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const OUT = process.argv[2] || '/tmp/clientes-pg-lab'; fs.mkdirSync(OUT, { recursive: true });
const H = process.env.PGLAB_HOST, PORT = process.env.PGLAB_PORT || '5432', UID = process.env.PGLAB_UID;
if (!H || !UID) { console.log('PGLAB_HOST/PGLAB_UID ausentes: laboratório não executado (exige PostgreSQL local com o esquema do espelho).'); process.exit(2); }
const srcI = fs.readFileSync(path.join(process.cwd(), 'docs/qa/integracoes-lab.cjs'), 'utf8'); const headI = srcI.slice(0, srcI.indexOf('(async () => {')).replace(/^const rel = \[\].*$/m, '');
const L = {}; new Function('module', 'exports', 'require', '__dirname', 'process', headI + "\nmodule.exports={servir,contexto};")(L, L, require, path.join(process.cwd(), 'docs/qa'), process);
const { servir, contexto } = L.exports || L; const { chromium } = require('playwright'); require('./_popup.cjs');
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
// ---- psql: script por stdin, valores por -v (sem montar SQL com texto do usuário) ----
const psql = (script, vars = {}, { sessao = true } = {}) => {
  const args = ['-h', H, '-p', PORT, '-U', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1']; for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const corpo = sessao ? `\\set VERBOSITY verbose\nbegin;\nset local role authenticated;\n\\o /dev/null\nselect set_config('request.jwt.claim.sub', :'uid', true), set_config('request.jwt.claim.role', 'authenticated', true);\n\\o\n${script}\ncommit;\n` : `\\set VERBOSITY verbose\n${script}\n`;
  try { return { ok: true, out: execFileSync('psql', args.concat(sessao ? ['-v', `uid=${UID}`] : []), { input: corpo, encoding: 'utf8' }).trim() }; }
  catch (e) { const m = String(e.stderr || e.message).match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]+)/); return { ok: false, code: m ? m[1] : 'XX000', message: m ? m[2] : String(e.stderr || e.message).slice(0, 300) }; } };
const ident = (c) => { if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error('coluna inválida ' + c); return c; };
const sql1 = (q, vars) => { const r = psql(q, vars, { sessao: false }); if (!r.ok) throw new Error(r.code + ' ' + r.message); return r.out; };
// ---- emulação mínima do PostgREST para clientes e notas_internas ----
async function rotaPG(rota) {
  const req = rota.request(); const u = new URL(req.url()); const tab = u.pathname.replace('/rest/v1/', ''); const m = req.method();
  const json = (b, status = 200) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: b == null ? '' : (typeof b === 'string' ? b : JSON.stringify(b)) });
  const erro = (r) => json({ code: r.code, message: r.message, details: null, hint: null }, r.code === '42501' ? 403 : 400);
  const unico = /vnd\.pgrst\.object/.test(req.headers()['accept'] || ''); const rep = /return=representation/.test(req.headers()['prefer'] || '');
  const idEq = (u.searchParams.get('id') || '').replace(/^eq\./, '');
  if (m === 'GET') { const r = psql(`select coalesce(json_agg(t order by t.id), '[]'::json) from public.${tab} t ${idEq ? "where t.id = :'id'" : ''};`, idEq ? { id: idEq } : {}); if (!r.ok) return erro(r); const ls = JSON.parse(r.out || '[]'); if (unico) return ls.length === 1 ? json(ls[0]) : json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 406); return json(ls); }
  let corpo = {}; try { corpo = JSON.parse(req.postData() || '{}'); } catch (_) {} const linhas = Array.isArray(corpo) ? corpo : [corpo]; const cols = Object.keys(linhas[0] || {}).map(ident);
  if (m === 'POST') { // upsert (Prefer: resolution=merge-duplicates), como o supabase-js
    const upd = cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ');
    const r = psql(`with r as (insert into public.${tab} (${cols.join(', ')}) select ${cols.join(', ')} from json_populate_recordset(null::public.${tab}, :'j'::json) on conflict (id) do ${upd ? 'update set ' + upd : 'nothing'} returning *) select coalesce(json_agg(r), '[]'::json) from r;`, { j: JSON.stringify(linhas) });
    if (!r.ok) return erro(r); return rep ? json(r.out, 201) : json(null, 201); }
  if (m === 'PATCH') {
    const r = psql(`with r as (update public.${tab} set ${cols.map(c => `${c} = s.${c}`).join(', ')} from json_populate_record(null::public.${tab}, :'j'::json) s where ${tab}.id = :'id' returning ${tab}.*) select coalesce(json_agg(r), '[]'::json) from r;`, { j: JSON.stringify(linhas[0]), id: idEq });
    if (!r.ok) return erro(r); return rep ? json(r.out) : json(null, 204); }
  return rota.fallback();
}
const linhaPG = (id) => JSON.parse(sql1(`select coalesce(row_to_json(c), 'null'::json) from public.clientes c where id = :'id';`, { id }) || 'null');
const tarefasPG = (id) => JSON.parse(sql1(`select coalesce(json_agg(titulo order by titulo), '[]'::json) from public.tarefas where cliente_id = :'id';`, { id }) || '[]');
(async () => {
  // limpeza dos clientes de teste de execuções anteriores (cascade: tarefas, timeline, fila, notas)
  sql1(`alter table public.clientes disable trigger user; delete from public.clientes where id like 'cli-pglab-%' or dados->>'nome' like 'PG Lab %'; alter table public.clientes enable trigger user;`);
  // cliente "antigo": jsonb com chaves que o formulário Editar cliente não mostra + colunas da ficha
  const ANTIGO = { nome: 'PG Lab Antigo Ltda', cnpj: '11.111.111/0001-11', responsavel: 'Ana', reservaAcumulada: 5000, createdAt: '2026-01-10T12:00:00.000Z', timeline: [{ id: 'ev1', data: '2026-02-01', texto: 'Atuação antiga' }], grupo: 'Grupo PG Lab', ciclo_concluido_em: '2026-03-01', ciclo_resumo: 'Resumo do ciclo', ciclo_por: 'Ana' };
  sql1(`alter table public.clientes disable trigger user; insert into public.clientes (id, dados, cnpj, cidade, segmento, data_onboarding) values ('cli-pglab-antigo', :'d'::jsonb, '11.111.111/0001-11', 'Franca/SP', 'Metalurgia', '2026-01-15'); alter table public.clientes enable trigger user;`, { d: JSON.stringify(ANTIGO) });
  const srv = await servir(); const b = await chromium.launch();
  for (const casca of ['v2', 'v3']) {
    // cada passada parte do mesmo cliente antigo (o passo de timeline da passada anterior acrescenta uma atuação)
    sql1(`alter table public.clientes disable trigger user; update public.clientes set dados = :'d'::jsonb, cnpj = '11.111.111/0001-11', cidade = 'Franca/SP', segmento = 'Metalurgia', data_onboarding = '2026-01-15' where id = 'cli-pglab-antigo'; alter table public.clientes enable trigger user;`, { d: JSON.stringify(ANTIGO) });
    rel.push(`${casca === 'v2' ? '1' : '2'}. ${casca.toUpperCase()} — cadastro e edição de clientes no PostgreSQL real`);
    const { ctx, pg, erros } = await contexto(b, { casca, hash: '#clientes' }); await pg.route(/supabase\.co\/rest\/v1\/(clientes|notas_internas)(\?|$)/, rotaPG);
    await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && S.clientes && S.clientes.some(c => c.id === 'cli-pglab-antigo'), null, { timeout: 20000 });
    const toast = () => pg.evaluate(() => (document.querySelector('#toast')?.textContent || '').trim());
    // (a) nome vazio
    await pg.evaluate(() => { S.tab = 'clientes'; S.sel = null; render(); }); await pg.waitForTimeout(500); await pg.click('#view-clientes .btn:has-text("+ Novo cliente") >> visible=true'); await pg.waitForTimeout(300); await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(400);
    const tv = await toast(); const aberto = await pg.evaluate(() => !!document.querySelector('#modalHost .card'));
    if (/Informe o nome do cliente/.test(tv) && aberto) ok('nome vazio recusado no formulário; nada enviado'); else falha('nome vazio: ' + JSON.stringify([tv, aberto]));
    // (b) novo cliente
    const nome = `PG Lab Novo ${casca.toUpperCase()}`; await pg.fill('#c-nome', `  ${nome}  `); await pg.fill('#c-cnpj', '22.222.222/0001-22'); await pg.fill('#c-resp', 'Lucas'); await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(1500);
    const tn = await toast(); const novo = await pg.evaluate((n) => (S.clientes || []).find(c => c.nome === n) || null, nome); const row = novo ? linhaPG(novo.id) : null; const tars = novo ? tarefasPG(novo.id) : [];
    if (/Cliente salvo/.test(tn) && row && row.nome === nome && row.dados.nome === nome && row.cnpj === '22.222.222/0001-22' && row.dados.responsavel === 'Lucas') ok(`"+ Novo cliente": gravado no PostgreSQL — coluna gerada nome = "${nome}" (derivada de dados.nome, aparado), cnpj na coluna; lista recarregada com o cliente`); else falha('novo: ' + JSON.stringify([tn, novo && novo.id, row]));
    if (tars.length >= 1 && tars.every(t => !t.includes(novo.id)) && tars.some(t => t.includes(nome))) ok(`gatilhos do INSERT criaram ${tars.length} tarefa(s) automática(s) com o nome do cliente (nenhuma com o id): ${tars.map(t => t.slice(0, 48)).join(' | ')}`); else falha('tarefas: ' + JSON.stringify([novo && novo.id, tars]));
    // (c) Editar cliente no cliente antigo: troca o responsável; chaves e colunas que o formulário não mostra ficam
    await pg.evaluate(() => { const c = S.clientes.find(x => x.id === 'cli-pglab-antigo'); openClientForm(c); }); await pg.waitForTimeout(300); await pg.fill('#c-resp', `Natasha ${casca}`); await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(1200);
    const ta = await toast(); const ra = linhaPG('cli-pglab-antigo'); const d = ra.dados;
    if (/Cliente salvo/.test(ta) && d.responsavel === `Natasha ${casca}` && d.nome === ANTIGO.nome && ra.nome === ANTIGO.nome && d.grupo === 'Grupo PG Lab' && d.ciclo_concluido_em === '2026-03-01' && d.ciclo_resumo === 'Resumo do ciclo' && Array.isArray(d.timeline) && d.timeline.length === 1 && ra.cidade === 'Franca/SP' && ra.segmento === 'Metalurgia' && ra.data_onboarding === '2026-01-15' && ra.cnpj === ANTIGO.cnpj) ok('"Editar cliente" (responsável): grupo, ciclo_concluido_em/resumo/por, timeline, nome e as colunas cidade/segmento/data_onboarding/cnpj preservados no banco'); else falha('editar: ' + JSON.stringify([ta, ra]));
    // (d) apagar o CNPJ no Editar cliente limpa coluna e jsonb
    await pg.evaluate(() => { const c = S.clientes.find(x => x.id === 'cli-pglab-antigo'); openClientForm(c); }); await pg.waitForTimeout(300); await pg.fill('#c-cnpj', ''); await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(1200); const rc = linhaPG('cli-pglab-antigo');
    if (rc.cnpj === null && rc.dados.cnpj === '' && rc.dados.grupo === 'Grupo PG Lab') ok('CNPJ apagado no formulário: coluna cnpj = null e dados.cnpj vazio (antes a coluna ficava com o valor antigo); demais chaves intactas'); else falha('cnpj: ' + JSON.stringify(rc));
    sql1(`update public.clientes set cnpj = '11.111.111/0001-11', dados = dados || jsonb_build_object('cnpj', '11.111.111/0001-11') where id = 'cli-pglab-antigo';`);
    await pg.evaluate(() => { const c = S.clientes.find(x => x.id === 'cli-pglab-antigo'); c.cnpj = '11.111.111/0001-11'; });
    // (e) atualização parcial (registrar atuação → update({timeline}))
    await pg.evaluate(async () => { const c = S.clientes.find(x => x.id === 'cli-pglab-antigo'); await S.db.doc('clientes/' + c.id).update({ timeline: [...(c.timeline || []), { id: 'ev2', data: '2026-11-15', texto: 'Atuação PG Lab' }] }); }); await pg.waitForTimeout(800); const rt = linhaPG('cli-pglab-antigo');
    if (rt.dados.timeline.length >= 2 && rt.dados.grupo === 'Grupo PG Lab' && rt.nome === ANTIGO.nome && rt.cnpj === '11.111.111/0001-11') ok('atualização parcial (timeline): acrescenta a atuação e mantém nome, grupo e cnpj'); else falha('timeline: ' + JSON.stringify(rt));
    // (f) Ficha cadastral (PATCH colunas + jsonb): troca o nome
    const nome2 = `PG Lab Antigo Renomeado ${casca.toUpperCase()}`;
    await pg.evaluate(() => { const c = S.clientes.find(x => x.id === 'cli-pglab-antigo'); PP_FICHA.openFichaForm(c, 'cadastro'); }); await pg.waitForTimeout(400); await pg.fill('#f-nome', nome2); await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(1200); const rf = linhaPG('cli-pglab-antigo'); const tf = await toast();
    if (/Ficha salva/.test(tf) && rf.nome === nome2 && rf.dados.nome === nome2 && rf.dados.grupo === 'Grupo PG Lab' && rf.dados.ciclo_concluido_em === '2026-03-01' && rf.cidade === 'Franca/SP') ok(`Ficha cadastral: nome trocado na coluna gerada e no jsonb ("${nome2}"); grupo, ciclo e cidade preservados`); else falha('ficha: ' + JSON.stringify([tf, rf]));
    sql1(`update public.clientes set dados = dados || jsonb_build_object('nome', :'n') where id = 'cli-pglab-antigo';`, { n: ANTIGO.nome });
    if (!erros.length) ok(`${casca.toUpperCase()}: sem erros de página`); else falha(`${casca} erros: ` + JSON.stringify(erros));
    await ctx.close();
  }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.') + '\n'; fs.writeFileSync(path.join(OUT, 'relatorio-clientes-pg-lab.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.log(rel.join('\n')); console.error(e); process.exit(2); });
