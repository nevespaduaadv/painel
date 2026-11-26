/* Desde 25/11 o detalhe (NPUI.painel) abre como pop-up central com véu: a lista atrás dele não recebe clique.
   Os roteiros dos labs foram escritos para o painel lateral (clicavam em outra linha com o painel aberto). Este apoio
   faz o que a pessoa faria: se o alvo do clique está fora do pop-up aberto, fecha o pop-up antes (botão ✕) e segue.
   Cliques dentro do pop-up, de menus (np-pop) e de modais não são tocados. Basta um require('./_popup.cjs') por lab. */
const { chromium } = require('playwright');
if (!chromium.__npPopup) {
  chromium.__npPopup = true;
  const liberar = async (pg, sel) => {
    try {
      const loc = pg.locator(sel).first(); if (!(await loc.count())) return;
      const dentro = await loc.evaluate((e) => !!e.closest('.np-painel, #np-pop, .np-pop, .modal, .np-modal-v3, dialog, .toast, #toast'));
      if (dentro) return;
      for (let i = 0; i < 4; i++) { // repete: uma recarga em curso pode reabrir o pop-up (a tela o restaura ao redesenhar)
        const fechou = await pg.evaluate(() => { const p = [...document.querySelectorAll('.np-painel[data-modo="centro"]')].find((x) => !x.hidden && x.getClientRects().length); if (!p) return false; p.querySelector('.np-p-h > .np-ib')?.click(); return true; });
        if (!fechou) break;
        await pg.waitForFunction(() => ![...document.querySelectorAll('.np-painel[data-modo="centro"]')].some((x) => !x.hidden && x.getClientRects().length), null, { timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(350); /* deixa a transição de fechar terminar antes do próximo clique */
      }
    } catch (_) { /* seletor que o locator não resolve: segue o clique normal */ }
  };
  const vestir = (pg) => { if (pg.__npPopup) return pg; pg.__npPopup = true; const click = pg.click.bind(pg); pg.click = async (sel, opts) => { /* tentativas curtas: uma recarga em curso pode restaurar o pop-up entre o fechar e o clique */ for (let i = 0; ; i++) { await liberar(pg, sel); try { return await click(sel, { ...(opts || {}), timeout: i < 9 ? 3000 : (opts && opts.timeout) || 30000 }); } catch (e) { if (i >= 9 || !/Timeout/.test(String(e && e.message))) throw e; } } }; return pg; };
  /* 25/11: na Agenda, Semana e Mês passaram a abrir em grade/calendário por padrão. Os roteiros foram escritos para a lista;
     por isso os labs começam com a preferência "lista" gravada (quem testa a grade troca a preferência no próprio roteiro). */
  const prefLista = () => { try { for (const m of ['semana', 'mes']) for (const suf of ['', '-beta']) { const k = 'np-agenda-vista-' + m + suf; if (localStorage.getItem(k) == null) localStorage.setItem(k, 'lista'); } } catch (_) {} };
  /* 26/11: o jsDelivr passou a responder com desafio (403) a máquinas de CI para o supabase-js@2, e a página não iniciava
     ("PP is not defined"). Os laboratórios são "sem rede": a biblioteca é servida de uma cópia local (docs/qa/vendor). */
  const SB_LOCAL = require('fs').readFileSync(require('path').join(__dirname, 'vendor', 'supabase-js-2.119.2.umd.js'));
  const semCdn = (alvo) => alvo.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SB_LOCAL })).catch(() => {});
  const vestirCtx = (ctx) => { semCdn(ctx); const ai = ctx.addInitScript.bind(ctx); ai(prefLista).catch(() => {}); ctx.addInitScript = async (...a) => { const r = await ai(...a); await ai(prefLista); return r; }; /* os labs limpam o localStorage no próprio init: a preferência é regravada depois de cada um */ const np = ctx.newPage.bind(ctx); ctx.newPage = async (...a) => vestir(await np(...a)); return ctx; };
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...a) => { const b = await launch(...a); const nc = b.newContext.bind(b); b.newContext = async (...x) => vestirCtx(await nc(...x)); const np = b.newPage.bind(b); b.newPage = async (...x) => { const pg = await np(...x); await semCdn(pg); await pg.addInitScript(prefLista).catch(() => {}); return vestir(pg); }; return b; };
}

/* para roteiros que usam a busca global com o pop-up aberto: fecha antes */
module.exports.fecharPopup = async (pg) => { await pg.evaluate(() => { const p = [...document.querySelectorAll('.np-painel[data-modo="centro"]')].find((x) => !x.hidden && x.getClientRects().length); p?.querySelector('.np-p-h > .np-ib')?.click(); }); await pg.waitForTimeout(450); };
