// Verificação de geração e paridade (Design System).
//
// Uso: node fontes/verificar-geracao.mjs --base <ref git> [--fase 0|1|3] [--gravar-inventario]
//
// Nunca altera arquivos versionados: o gerador roda numa cópia temporária do repositório e o inventário
// do menu só é gravado em docs/qa/nav-inventario.json com --gravar-inventario (sem a opção, é comparado).
//
// Verificações COMUNS (todas as fases):
//  G1 gerador roda nos modos normal (index.html + cliente/index.html) e espelho (beta/index.html), em pasta temporária
//  G2 saídas versionadas == saídas geradas agora (ignorando o carimbo ?v= que muda a cada execução)
//  G3 segurança das saídas: só a chave publicável conhecida; nenhuma chave de serviço; modo token sem menu da equipe
//  N1 inventário do menu (tab, label, cls, hash, tabs, grupo) == docs/qa/nav-inventario.json versionado
//  N2 com --base: nenhum item/grupo da referência perdido e nenhuma classe de permissão alterada
//  N3 conjunto de classes de permissão usadas na saída == conjunto da referência (nenhuma classe nova/sumida)
//  T1 com --base: tokens legados da referência presentes em fontes/tokens.css com os mesmos valores
//
// Verificações EXCLUSIVAS da Fase 0 (--fase 0):
//  F0.1 com --base: saídas geradas idênticas à referência fora do bloco de tokens (comparação estrita)
//  F0.2 nenhum consumidor de var(--np-*) em passivos/*.js nem em fontes/painel.html
//
// A partir da Fase 1 (--fase 1), F0.* não se aplicam: o frontend muda de propósito; o que segura a regressão
// são G*, N* e T1 (mais as capturas no espelho, fora deste script).
//
// A partir da Fase 3 (--fase 3, inclui as da Fase 1) — destinos novos só-V3.1 (ex.: Acompanhamento PJ):
//  F3.1 com --base: todo item de menu que não existe na referência carrega np-v3-only (não aparece no menu V2) e uma
//       classe de permissão (area-* / *-only / grp-*) — nenhum destino novo entra "aberto" ou silenciosamente na V2
//  F3.2 todo tab do NAV tem PP.TAB_AREA (área de permissão) e contêiner <div id="view-<tab>">; todo tab novo está em
//       window.PP_ROTAS (roteamento por hash) e é conhecido por passivos/casca.js (árvore V3.1)
//  F3.3 casca.css oculta .np-v3-only fora da casca V3.1
//  F3.4 cliente/index.html (modo token): sem rotas da equipe (PP_ROTAS.push), sem item de menu dos destinos novos, sem np-v3-only, sem seus scripts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const base = opt('--base');
const fase = Number(opt('--fase') ?? 0);
const gravar = args.includes('--gravar-inventario');
let falhas = 0;
const ok = (m) => console.log('  ok    ' + m);
const falha = (m) => { falhas++; console.log('  FALHA ' + m); };
const info = (m) => console.log('        ' + m);
const SAIDAS = ['index.html', 'cliente/index.html'];
const CHAVES_PUBLICAVEIS = ['sb_publishable_tt__gxUjGaujzylisID0KQ_qaeaU1-l', 'sb_publishable_dn6ljhAAaV3TxnAyXQB5TA_0DdvGl-W'];
const semCarimbo = (s) => s.replace(/\?v=[a-z0-9]+/g, '?v=…');
const lerRepo = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const git = (a) => execFileSync('git', a, { cwd: raiz, stdio: 'pipe' }).toString();
const lerBase = (f) => { try { return git(['show', `${base}:${f}`]); } catch { return null; } };
console.log(`verificar-geracao · fase ${fase}${base ? ` · referência ${base}` : ' · sem referência (--base ausente: N2, N3 e T1 não rodam)'}`);

// ---------- G1 ----------
console.log('G1 gerador em pasta temporária');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-verif-'));
const copiar = (de, para) => { for (const e of fs.readdirSync(de, { withFileTypes: true })) { if (e.name === '.git' || e.name === 'node_modules') continue; const a = path.join(de, e.name), b = path.join(para, e.name); if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copiar(a, b); } else fs.copyFileSync(a, b); } };
copiar(raiz, tmp);
const lerTmp = (f) => fs.readFileSync(path.join(tmp, f), 'utf8');
try {
  for (const env of [{}, { PP_ESPELHO: '1' }]) execFileSync(process.execPath, [path.join(tmp, 'fontes/gerar-app-supabase.mjs')], { cwd: tmp, env: { ...process.env, ...env }, stdio: 'pipe' });
  ok('index.html, cliente/index.html e beta/index.html gerados em ' + tmp + ' (repositório intocado)');
} catch (e) { falha('gerador abortou: ' + (e.stderr || e.message)); }

// ---------- G2 ----------
console.log('G2 saídas versionadas × geradas agora');
for (const f of SAIDAS) {
  if (!fs.existsSync(path.join(raiz, f))) { falha(f + ' não existe no repositório'); continue; }
  if (semCarimbo(lerTmp(f)) === semCarimbo(lerRepo(f))) ok(f + ' idêntico (ignorando ?v=)'); else falha(f + ' difere do que o gerador produz — regere e versione junto com os fontes');
}

// ---------- G3 ----------
console.log('G3 segurança das saídas');
for (const f of [...SAIDAS, 'beta/index.html']) {
  const h = lerTmp(f);
  const chaves = [...new Set(h.match(/sb_[a-z]+_[A-Za-z0-9_-]+/g) || [])];
  const estranhas = chaves.filter(c => !CHAVES_PUBLICAVEIS.includes(c));
  if (/service_role|sb_secret_|eyJhbGciOi/.test(h)) falha(f + ': parece conter chave de serviço/JWT');
  else if (estranhas.length) falha(f + ': chave(s) não reconhecida(s): ' + estranhas.join(', '));
  else ok(f + ': só chave publicável (' + chaves.length + ')');
}
{ // modo token: só os módulos previstos para o cliente são carregados (os dados vêm de painel_por_token(); a RLS protege o resto)
  const mods = [...new Set([...lerTmp('cliente/index.html').matchAll(/src="\.\.\/passivos\/([a-z-]+\.js)/g)].map(m => m[1]))].sort();
  const esperados = ['carteira.js', 'ficha.js'];
  const bMods = base && lerBase('cliente/index.html') ? [...new Set([...lerBase('cliente/index.html').matchAll(/src="\.\.\/passivos\/([a-z-]+\.js)/g)].map(m => m[1]))].sort() : null;
  if (JSON.stringify(mods) !== JSON.stringify(esperados)) falha('cliente/index.html carrega módulos fora do previsto: ' + mods.join(', '));
  else if (bMods && JSON.stringify(bMods) !== JSON.stringify(mods)) falha('cliente/index.html: conjunto de módulos difere de ' + base + ': ' + bMods.join(', '));
  else ok('cliente/index.html (modo token) carrega só ' + mods.join(' e '));
  // a partir da Fase 1: nada da casca/componentes V3.1 chega ao cliente (CSS, boot ou scripts)
  if (fase >= 1) { const h = lerTmp('cliente/index.html'); const vaz = ['np-casca-v3', 'np-toolbar', 'np-tree', '#np-side{', 'np-ui.js', 'casca.js'].filter(k => h.includes(k));
    if (vaz.length) falha('cliente/index.html contém partes da V3.1: ' + vaz.join(', ')); else ok('cliente/index.html (modo token) sem CSS/boot/scripts da V3.1'); }
}

// ---------- utilidades de menu e tokens ----------
function inventario(html) {
  const i = html.indexOf('const NAV=['); if (i < 0) return null;
  let k = i + 'const NAV='.length, d = 0;
  for (; k < html.length; k++) { if (html[k] === '[') d++; else if (html[k] === ']' && --d === 0) break; }
  const txt = html.slice(i, k + 1); const itens = []; let grupo = null;
  for (const m of txt.matchAll(/\{(grupo|tab):"([^"]+)"((?:[^{}\[\]]|\[[^\[\]]*\])*?)(?=,itens:\[|\})/g)) {
    const c = Object.fromEntries([...m[3].matchAll(/(label|cls|hash):"([^"]*)"/g)].map(x => [x[1], x[2]]));
    const tabs = (m[3].match(/tabs:\[([^\]]*)\]/) || [])[1];
    if (m[1] === 'grupo') { grupo = m[2]; itens.push({ grupo: m[2], label: c.label || '', cls: c.cls || '' }); }
    else itens.push({ tab: m[2], label: c.label || '', cls: c.cls || '', hash: c.hash || '', em: grupo, ...(tabs ? { tabs: tabs.replace(/"/g, '').split(',') } : {}) });
  }
  return itens;
}
const chave = (i) => i.tab ? `tab:${i.tab}|${i.hash}|${(i.tabs || []).join('+')}` : `grupo:${i.grupo}`;
// classes de PERMISSÃO (area-*, *-only, grp-*…); `np-*` são sinalizadores de apresentação da casca V3.1 (ex.: np-v3-only = item só existe na V3.1) e não entram no conjunto
const classes = (inv) => new Set(inv.flatMap(i => i.cls.split(/\s+/).filter(Boolean)).filter(c => !/^np-/.test(c)));
function parseTokens(css) {
  const out = { light: {}, 'media-dark': {}, 'data-dark': {} };
  const re = /(@media \(prefers-color-scheme:\s*dark\)\s*\{\s*)?(:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?)\s*\{([\s\S]*?)\}/g; let m;
  while ((m = re.exec(css))) {
    const scope = m[1] ? 'media-dark' : (m[2].includes('data-theme="dark"') ? 'data-dark' : 'light');
    for (const d of m[3].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);?/g)) { const k = d[1]; if (k.startsWith('--np-')) continue; out[scope][k] = d[2].replace(/\s+/g, ' ').trim(); }
  }
  return out;
}
const tokensCss = fs.existsSync(path.join(raiz, 'fontes/tokens.css')) ? lerRepo('fontes/tokens.css').trim() : null;

// ---------- N1 ----------
console.log('N1 inventário do menu × docs/qa/nav-inventario.json');
const inv = inventario(lerTmp('index.html'));
const invPath = path.join(raiz, 'docs/qa/nav-inventario.json');
if (!inv) falha('NAV não encontrado em index.html');
else if (gravar) { fs.mkdirSync(path.dirname(invPath), { recursive: true }); fs.writeFileSync(invPath, JSON.stringify(inv, null, 1) + '\n'); ok(`inventário GRAVADO (--gravar-inventario): ${inv.filter(i => i.tab).length} itens, ${inv.filter(i => i.grupo).length} grupos`); }
else if (!fs.existsSync(invPath)) falha('docs/qa/nav-inventario.json não existe — rode com --gravar-inventario e versione o arquivo');
else {
  const vers = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  if (JSON.stringify(vers) === JSON.stringify(inv)) ok(`inventário versionado confere: ${inv.filter(i => i.tab).length} itens, ${inv.filter(i => i.grupo).length} grupos`);
  else { falha('o menu gerado difere de docs/qa/nav-inventario.json — se a mudança é intencional, rode com --gravar-inventario e revise o diff do JSON no PR'); const a = new Set(vers.map(chave)), b = new Set(inv.map(chave)); [...a].filter(x => !b.has(x)).forEach(x => info('saiu: ' + x)); [...b].filter(x => !a.has(x)).forEach(x => info('entrou: ' + x)); }
}

// ---------- F3 (fase ≥ 3): destinos novos só-V3.1 ----------
if (fase >= 3 && inv) {
  console.log('F3 destinos novos só-V3.1');
  const h = lerTmp('index.html'); const tabs = inv.filter(i => i.tab).map(i => i.tab);
  const b = base ? lerBase('index.html') : null; const invB = b ? inventario(b) : null; const tabsB = invB ? new Set(invB.filter(i => i.tab).map(i => i.tab)) : null;
  const novos = tabsB ? inv.filter(i => i.tab && !tabsB.has(i.tab)) : [];
  // F3.1
  if (tabsB) { const maus = novos.filter(i => !/\bnp-v3-only\b/.test(i.cls) || !/\b(area-[a-z_-]+|[a-z_-]+-only|grp-[a-z_-]+)\b/.test(i.cls.replace(/\bnp-v3-only\b/, '')));
    if (maus.length) falha('F3.1 destino(s) novo(s) sem np-v3-only ou sem classe de permissão: ' + maus.map(i => `${i.tab} ("${i.cls}")`).join(', ')); else ok(`F3.1 ${novos.length} destino(s) novo(s) em relação a ${base}${novos.length ? ' (' + novos.map(i => i.tab).join(', ') + ')' : ''}, todos só-V3.1 e com classe de permissão`); }
  else info('F3.1 sem --base: não dá para identificar destinos novos');
  // F3.2
  const mArea = h.match(/PP\.TAB_AREA=\{([^}]*)\}/); const areas = mArea ? new Set([...mArea[1].matchAll(/([a-z_]+):/g)].map(m => m[1])) : new Set();
  // tabs gerais (Hoje, Tarefas, Agenda…) não têm área por desenho (temAcesso libera sem TAB_AREA); todo destino NOVO precisa ter
  const semArea = novos.map(i => i.tab).filter(t => !areas.has(t)); if (semArea.length) falha('F3.2 destino(s) novo(s) sem PP.TAB_AREA (entrariam abertos): ' + semArea.join(', ')); else ok(`F3.2 destinos novos com área em PP.TAB_AREA (${novos.map(i => i.tab + '→' + ((mArea && (mArea[1].match(new RegExp(i.tab + ':"([a-z_]+)"')) || [])[1]) || '?')).join(', ') || 'nenhum novo'}); ${tabs.filter(t => areas.has(t)).length}/${tabs.length} tabs com área no total`);
  const semView = tabs.filter(t => !h.includes(`id="view-${t}"`)); if (semView.length) falha('F3.2 tabs sem contêiner view-*: ' + semView.join(', ')); else ok(`F3.2 ${tabs.length} tabs com contêiner <div id="view-…">`);
  const mRotas = h.match(/PP_ROTAS\.push\(([^)]*)\)/); const rotas = mRotas ? new Set([...mRotas[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1])) : new Set();
  const casca = fs.readFileSync(path.join(raiz, 'passivos/casca.js'), 'utf8');
  for (const i of novos) { if (!rotas.has(i.tab)) falha(`F3.2 destino novo ${i.tab} fora de PP_ROTAS`); else ok(`F3.2 ${i.tab} em PP_ROTAS`); if (!new RegExp(`"${i.tab}"`).test(casca)) falha(`F3.2 destino novo ${i.tab} desconhecido de passivos/casca.js`); else ok(`F3.2 ${i.tab} conhecido pela árvore (casca.js)`); }
  // F3.3
  const ccss = fs.readFileSync(path.join(raiz, 'fontes/casca.css'), 'utf8'); if (/html:not\(\.np-casca-v3\)\s*\.np-v3-only\s*\{[^}]*display:\s*none/.test(ccss)) ok('F3.3 casca.css oculta .np-v3-only fora da casca V3.1'); else falha('F3.3 casca.css não oculta .np-v3-only fora da V3.1');
  // F3.4
  const hc = lerTmp('cliente/index.html'); const vaz = []; const mRc = hc.match(/PP_ROTAS\.push\(([^)]*)\)/); if (mRc) vaz.push('PP_ROTAS.push(' + mRc[1].slice(0, 40) + '…)'); for (const i of novos) if (new RegExp(`tab:"${i.tab}"`).test(hc)) vaz.push('item de menu ' + i.tab); if (/np-v3-only/.test(hc)) vaz.push('np-v3-only'); for (const i of novos) { if (new RegExp(`passivos/[a-z-]*${i.tab.split('_')[0]}[a-z-]*\\.js`).test(hc)) vaz.push('script de ' + i.tab); }
  if (vaz.length) falha('F3.4 cliente/index.html contém: ' + vaz.join(', ')); else ok('F3.4 cliente/index.html (modo token) sem rotas, sem np-v3-only e sem scripts dos destinos novos');
}

// ---------- N2 / N3 / T1 (com --base) ----------
if (base && inv) {
  console.log(`N2 itens e permissões × ${base}`);
  const b = lerBase('index.html'); const invB = b ? inventario(b) : null;
  if (!invB) falha('não consegui ler o NAV de ' + base);
  else {
    const mapaB = new Map(invB.map(i => [chave(i), i])); let perdidos = 0, cls = 0;
    for (const [k, i] of mapaB) { const n = inv.find(x => chave(x) === k); if (!n) { perdidos++; info('perdido: ' + k); } else if (n.cls !== i.cls) { cls++; info(`permissão alterada em ${k}: "${i.cls}" → "${n.cls}"`); } }
    if (perdidos + cls === 0) ok(`todos os ${mapaB.size} itens/grupos de ${base} presentes, com as mesmas classes de permissão`); else falha(`${perdidos} perdido(s), ${cls} classe(s) de permissão alterada(s) — mudanças de menu intencionais precisam constar do PR`);
    console.log('N3 conjunto de classes de permissão');
    const ca = classes(invB), cb = classes(inv); const novas = [...cb].filter(x => !ca.has(x)), sumidas = [...ca].filter(x => !cb.has(x));
    if (!novas.length && !sumidas.length) ok(`${ca.size} classes, conjunto inalterado`); else falha(`classes novas: [${novas}] · sumidas: [${sumidas}]`);
  }
  console.log(`T1 tokens legados de ${base} × fontes/tokens.css`);
  const painelBase = lerBase('fontes/painel.html'); const tokensBase = lerBase('fontes/tokens.css');
  const antigos = tokensBase ? parseTokens(tokensBase) : parseTokens(painelBase.split('\n').slice(15, 37).join('\n'));
  const novos = parseTokens(tokensCss || ''); let dif = 0, total = 0;
  for (const s of Object.keys(antigos)) for (const [k, v] of Object.entries(antigos[s])) { total++; if (novos[s][k] !== v) { dif++; info(`${s} ${k}: ${v} → ${novos[s][k]}`); } }
  if (dif === 0) ok(`${total} declarações legadas (claro ${Object.keys(antigos.light).length}, escuro-sistema ${Object.keys(antigos['media-dark']).length}, escuro-forçado ${Object.keys(antigos['data-dark']).length}) com valores idênticos`); else falha(dif + ' divergência(s) em tokens legados — só admissível com decisão registrada no PR');
}

// ---------- Fase 0 ----------
if (fase === 0) {
  if (base) {
    console.log(`F0.1 saídas geradas × ${base} fora do bloco de tokens (estrito)`);
    const semTokens = (html) => { if (tokensCss && html.includes(tokensCss)) return html.replace(tokensCss, '«TOKENS»'); return html.replace(/:root\{\s*\/\* Paleta do site[\s\S]*?:root\[data-theme="dark"\]\{[\s\S]*?color-scheme:dark \}/, '«TOKENS»'); };
    for (const f of SAIDAS) {
      const b = lerBase(f); if (b == null) { ok(f + ' não existe em ' + base + ' (ignorado)'); continue; }
      const A = semCarimbo(semTokens(lerTmp(f))), B = semCarimbo(semTokens(b));
      if (A === B) ok(f + ': nenhuma diferença fora do bloco de tokens');
      else { const la = A.split('\n'), lb = B.split('\n'); let n = 0; for (let i = 0; i < Math.max(la.length, lb.length) && n < 5; i++) if (la[i] !== lb[i]) { n++; info(`linha ${i + 1}\n          ${base}: ${(lb[i] || '').slice(0, 120)}\n          agora: ${(la[i] || '').slice(0, 120)}`); } falha(f + ': há diferenças fora do bloco de tokens'); }
    }
  }
  console.log('F0.2 tokens novos ainda sem consumidores');
  const arquivos = fs.readdirSync(path.join(raiz, 'passivos')).filter(f => f.endsWith('.js')).map(f => 'passivos/' + f).concat(['fontes/painel.html', 'fontes/gerar-app-supabase.mjs']);
  const usos = arquivos.filter(f => /var\(--np-/.test(lerRepo(f)));
  if (!usos.length) ok('nenhum uso de var(--np-*) em ' + arquivos.length + ' arquivos'); else falha('usos de --np-* em: ' + usos.join(', '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
