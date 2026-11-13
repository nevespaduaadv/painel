/* Medições de acessibilidade compartilhadas pelos laboratórios V3.1: contraste (texto ≥ 4,5:1; componentes não textuais ≥ 3:1)
   e alvos de toque (≥ 44 px em ponteiro grosso). Tudo medido no DOM renderizado, com o fundo efetivo (primeiro ancestral opaco). */
const lum = (c) => { const m = c.match(/-?\d*\.?\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const razao = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* pares: [{sel, nome, prop?: 'color'|'borderColor'|'backgroundColor', minimo?: 4.5|3, fundoDe?: seletor do elemento cujo fundo serve de base}] */
async function medirContraste(pg, pares) {
  const brutos = await pg.evaluate((pares) => {
    const rgb = (c) => { const n = (c.match(/-?\d*\.?\d+/g) || [0, 0, 0]).map(Number); if (/^color\(srgb/.test(c)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 }; return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; };
    const fmt = (k) => `rgb(${Math.round(k.r)}, ${Math.round(k.g)}, ${Math.round(k.b)})`;
    const fundo = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!c || c === 'transparent') continue; const k = rgb(c); if (k.a >= 0.99) return fmt(k); } return getComputedStyle(document.body).backgroundColor; };
    const out = [];
    for (const p of pares) { const e = document.querySelector(p.sel); if (!e || !e.getClientRects().length) { out.push({ nome: p.nome, ausente: true }); continue; }
      const cs = getComputedStyle(e); let fg = cs[p.prop || 'color']; const k = rgb(fg); if (k.a < 0.99) { // mistura com o fundo (alpha) para medir a cor efetiva
        const b = rgb(fundo(e.parentElement || e)); fg = fmt({ r: k.r * k.a + b.r * (1 - k.a), g: k.g * k.a + b.g * (1 - k.a), b: k.b * k.a + b.b * (1 - k.a) }); } else fg = fmt(k);
      const base = p.fundoDe ? document.querySelector(p.fundoDe) : (p.prop === 'backgroundColor' ? e.parentElement : (p.prop ? e.parentElement : e));
      out.push({ nome: p.nome, fg, bg: fundo(base || e), minimo: p.minimo || 4.5, px: parseFloat(cs.fontSize) }); }
    return out; }, pares);
  const medidos = brutos.filter(p => !p.ausente).map(p => ({ ...p, r: razao(p.fg, p.bg) }));
  return { medidos, ausentes: brutos.filter(p => p.ausente).map(p => p.nome), ruins: medidos.filter(p => p.r < p.minimo), minimo: medidos.length ? Math.min(...medidos.map(p => p.r)) : null };
}
/* alvos: elementos interativos visíveis dentro de `raiz` (+ popover aberto); mede o próprio elemento, ou o wrapper para checks */
async function medirAlvos(pg, raiz) {
  return pg.evaluate((raiz) => { const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const sel = `${raiz} button, ${raiz} input, ${raiz} select, ${raiz} a[href], ${raiz} .np-it, ${raiz} .np-cardq, #np-pop button, #np-pop select, #np-pop input, .np-painel button, .np-painel a[href]`;
    return [...new Set([...document.querySelectorAll(sel)])].filter(vis).map(e => { const r = e.matches('.np-check') ? e.parentElement.getBoundingClientRect() : e.getBoundingClientRect(); return { nome: (e.className && String(e.className).split(' ')[0] || e.tagName.toLowerCase()) + ':' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height), icone: e.matches('.np-ib,.np-check') || (!e.textContent.trim() && !!e.querySelector('svg')), inline: e.matches('.lnk, a') }; }); }, raiz);
}
module.exports = { medirContraste, medirAlvos, razao };
