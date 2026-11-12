// Verificação de geração e paridade (Design System — Fase 0 em diante).
// Uso: node fontes/verificar-geracao.mjs [--base <ref git>]
//
// O que faz, sem tocar em nenhum arquivo do repositório:
//  1. Copia o repositório (sem .git) para uma pasta temporária e roda o gerador lá, nos modos
//     normal (index.html + cliente/index.html) e espelho (beta/index.html).
//  2. Confere que o que está versionado é idêntico ao que o gerador produz (fontes e saídas em sincronia).
//  3. Com --base <ref> (ex.: main): compara as saídas geradas com as da referência; a única diferença
//     permitida é o bloco de tokens (fontes/tokens.css no lugar do :root antigo). Qualquer outra linha = falha.
//  4. Confere, token a token, que os tokens legados da referência existem com o MESMO valor em fontes/tokens.css
//     (claro, escuro por preferência do sistema, escuro forçado, color-scheme).
//  5. Extrai o inventário do menu (tab, label, cls, hash, grupo) da saída gerada e grava docs/qa/nav-inventario.json;
//     com --base, compara com o inventário da referência: item a menos ou classe de permissão alterada = falha.
//  6. Fase 0: garante que nenhum módulo (passivos/*.js) nem o fonte do painel consome --np-* ainda.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null;
const fase0 = !args.includes('--fase1');
let falhas = 0;
const ok = (m) => console.log('  ok  ' + m);
const falha = (m) => { falhas++; console.log('  FALHA ' + m); };

// ---------- 1. gerar em pasta temporária ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'np-verif-'));
const copiar = (de, para) => {
  for (const e of fs.readdirSync(de, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const a = path.join(de, e.name), b = path.join(para, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copiar(a, b); } else fs.copyFileSync(a, b);
  }
};
copiar(raiz, tmp);
const gerar = (env) => execFileSync(process.execPath, [path.join(tmp, 'fontes/gerar-app-supabase.mjs')], { cwd: tmp, env: { ...process.env, ...env }, stdio: 'pipe' }).toString();
console.log('1. gerador em pasta temporária: ' + tmp);
try { gerar({}); gerar({ PP_ESPELHO: '1' }); ok('gerou index.html, cliente/index.html e beta/index.html sem tocar no repositório'); }
catch (e) { falha('gerador abortou: ' + (e.stderr || e.message)); }
// beta/index.html e beta/passivos/ são publicados a partir do ramo `beta` por fontes/publicar-beta.sh;
// aqui só confirmamos que o modo espelho gera sem erro (o gerador em modo espelho também copia passivos/ → beta/passivos/,
// por isso ele NUNCA é rodado dentro do repositório por este script).
const SAIDAS = ['index.html', 'cliente/index.html'];
// o gerador carimba ?v=<base36 do relógio> nos scripts a cada execução; isso não é diferença de conteúdo
const semCarimbo = (s) => s.replace(/\?v=[a-z0-9]+/g, '?v=…');
const lerTmp = (f) => fs.readFileSync(path.join(tmp, f), 'utf8');
const lerRepo = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

// ---------- 2. versionado == gerado ----------
console.log('2. saídas versionadas × geradas agora');
for (const f of SAIDAS) {
  if (!fs.existsSync(path.join(raiz, f))) { falha(f + ' não existe no repositório'); continue; }
  if (semCarimbo(lerTmp(f)) === semCarimbo(lerRepo(f))) ok(f + ' idêntico (ignorando o carimbo ?v=)'); else falha(f + ' difere do que o gerador produz (regere e versione junto)');
}

// ---------- utilidades ----------
const git = (a) => execFileSync('git', a, { cwd: raiz, stdio: 'pipe' }).toString();
const lerBase = (f) => { try { return git(['show', `${base}:${f}`]); } catch { return null; } };
const tokensCss = fs.existsSync(path.join(raiz, 'fontes/tokens.css')) ? fs.readFileSync(path.join(raiz, 'fontes/tokens.css'), 'utf8').trim() : null;

// remove o bloco de tokens de uma saída (antigo: três blocos :root iniciais; novo: conteúdo de tokens.css)
function semTokens(html) {
  if (tokensCss && html.includes(tokensCss)) return html.replace(tokensCss, '«TOKENS»');
  const re = /:root\{\s*\/\* Paleta do site[\s\S]*?:root\[data-theme="dark"\]\{[\s\S]*?color-scheme:dark \}/;
  return html.replace(re, '«TOKENS»');
}
function parseTokens(css) {
  const out = { light: {}, 'media-dark': {}, 'data-dark': {} };
  const re = /(@media \(prefers-color-scheme:\s*dark\)\s*\{\s*)?(:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?)\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const scope = m[1] ? 'media-dark' : (m[2].includes('data-theme="dark"') ? 'data-dark' : 'light');
    const body = m[3].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const d of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);?/g)) {
      const k = d[1], v = d[2].replace(/\s+/g, ' ').trim();
      if (k.startsWith('--np-')) continue;
      out[scope][k] = v;
    }
  }
  return out;
}
function inventario(html) {
  const i = html.indexOf('const NAV=[');
  if (i < 0) return null;
  let k = i + 'const NAV='.length, d = 0;
  for (; k < html.length; k++) { if (html[k] === '[') d++; else if (html[k] === ']' && --d === 0) break; }
  const txt = html.slice(i, k + 1);
  const itens = [];
  let grupo = null;
  // campos de um item: até o próximo "}" ou ",itens:[" fora de colchetes (tabs:[...] e sel:()=>… são tolerados)
  for (const m of txt.matchAll(/\{(grupo|tab):"([^"]+)"((?:[^{}\[\]]|\[[^\[\]]*\])*?)(?=,itens:\[|\})/g)) {
    const campos = Object.fromEntries([...m[3].matchAll(/(label|cls|hash):"([^"]*)"/g)].map(x => [x[1], x[2]]));
    const tabs = (m[3].match(/tabs:\[([^\]]*)\]/) || [])[1];
    if (tabs) campos.tabs = tabs.replace(/"/g, '').split(',');
    if (m[1] === 'grupo') { grupo = m[2]; itens.push({ grupo: m[2], label: campos.label || '', cls: campos.cls || '' }); }
    else itens.push({ tab: m[2], label: campos.label || '', cls: campos.cls || '', hash: campos.hash || '', em: grupo, ...(campos.tabs ? { tabs: campos.tabs } : {}) });
  }
  return itens;
}

// ---------- 3. com --base: só o bloco de tokens pode diferir ----------
if (base) {
  console.log(`3. saídas geradas × ${base} (fora do bloco de tokens)`);
  for (const f of SAIDAS) {
    const b = lerBase(f); if (b == null) { ok(f + ' não existe em ' + base + ' (ignorado)'); continue; }
    const A = semCarimbo(semTokens(lerTmp(f))), B = semCarimbo(semTokens(b));
    if (A === B) ok(f + ': nenhuma diferença fora do bloco de tokens');
    else {
      const la = A.split('\n'), lb = B.split('\n'); let n = 0;
      for (let i = 0; i < Math.max(la.length, lb.length) && n < 5; i++) if (la[i] !== lb[i]) { n++; console.log(`     linha ${i + 1}:\n       ${base}: ${(lb[i] || '').slice(0, 140)}\n       agora: ${(la[i] || '').slice(0, 140)}`); }
      falha(f + ': há diferenças fora do bloco de tokens');
    }
  }
  // ---------- 4. tokens legados ----------
  console.log(`4. tokens legados de ${base} × fontes/tokens.css`);
  const painelBase = lerBase('fontes/painel.html');
  const antigos = parseTokens(painelBase.split('\n').slice(15, 37).join('\n'));
  const novos = parseTokens(tokensCss || '');
  let dif = 0, total = 0;
  for (const s of Object.keys(antigos)) for (const [k, v] of Object.entries(antigos[s])) { total++; if (novos[s][k] !== v) { dif++; console.log(`     ${s} ${k}: ${v}  →  ${novos[s][k]}`); } }
  for (const s of Object.keys(novos)) for (const k of Object.keys(novos[s])) if (!(k in antigos[s])) { dif++; console.log(`     ${s} ${k}: não existia em ${base}`); }
  if (dif === 0) ok(`${total} declarações legadas (claro ${Object.keys(antigos.light).length}, escuro-sistema ${Object.keys(antigos['media-dark']).length}, escuro-forçado ${Object.keys(antigos['data-dark']).length}) com valores idênticos`);
  else falha(dif + ' divergência(s) nos tokens legados');
}

// ---------- 5. inventário do menu ----------
console.log('5. inventário do menu');
const inv = inventario(lerTmp('index.html'));
if (!inv) falha('NAV não encontrado em index.html');
else {
  fs.mkdirSync(path.join(raiz, 'docs/qa'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs/qa/nav-inventario.json'), JSON.stringify(inv, null, 1) + '\n');
  ok(`${inv.filter(i => i.tab).length} itens e ${inv.filter(i => i.grupo).length} grupos gravados em docs/qa/nav-inventario.json`);
  if (base) {
    const b = lerBase('index.html'); const invB = b ? inventario(b) : null;
    if (invB) {
      const chave = (i) => i.tab ? `tab:${i.tab}|${i.hash}|${(i.tabs || []).join('+')}` : `grupo:${i.grupo}`;
      const mapaB = new Map(invB.map(i => [chave(i), i]));
      let perdidos = 0, cls = 0;
      for (const [k, i] of mapaB) { const n = inv.find(x => chave(x) === k); if (!n) { perdidos++; console.log('     perdido: ' + k); } else if (n.cls !== i.cls) { cls++; console.log(`     permissão alterada em ${k}: "${i.cls}" → "${n.cls}"`); } }
      if (perdidos + cls === 0) ok(`todos os ${mapaB.size} itens/grupos de ${base} presentes, com as mesmas classes de permissão`); else falha(`${perdidos} item(ns) perdido(s), ${cls} classe(s) de permissão alterada(s)`);
    }
  }
}

// ---------- 6. Fase 0: ninguém consome --np-* ----------
if (fase0) {
  console.log('6. Fase 0: tokens novos ainda sem consumidores');
  const arquivos = fs.readdirSync(path.join(raiz, 'passivos')).filter(f => f.endsWith('.js')).map(f => 'passivos/' + f).concat(['fontes/painel.html', 'fontes/gerar-app-supabase.mjs']);
  const usos = arquivos.filter(f => /var\(--np-/.test(lerRepo(f)));
  if (usos.length === 0) ok('nenhum uso de var(--np-*) em ' + arquivos.length + ' arquivos'); else falha('usos de --np-* em: ' + usos.join(', '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
