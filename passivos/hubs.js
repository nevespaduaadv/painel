/* Hubs — pastas grandes com abas internas (beta). Um item no menu lateral ("Jurídico", "Financeiro") e, dentro da tela,
   uma faixa de abas que troca entre as telas do grupo. As telas continuam sendo os módulos de sempre (S.tab); este
   módulo só desenha a faixa e corrige o item ativo no menu. Carregar por último na lista de módulos. */
(() => {
  "use strict";
  const HUBS = {
    juridico: { label: "Jurídico", tabs: [["processos", "Processos e pastas"], ["publicacoes", "Publicações"], ["negociacoes", "Negociações"], ["historico", "Base de acordos"]] },
    financeiro: { label: "Financeiro", tabs: [["financeiro", "Cobranças"], ["faturamento", "Contratos e faturamento"], ["estoque", "Estoque"], ["inventario", "Inventário"]] },
  };
  const hubDe = (tab) => Object.entries(HUBS).find(([, h]) => h.tabs.some(([t]) => t === tab))?.[0];
  const acesso = (tab) => { if (PP.perfil?.papel === "admin") return true; if (typeof PP.temAcesso !== "function") return true; try { return PP.temAcesso(tab); } catch (_) { return true; } };
  const ir = (t) => { S.tab = t; try { localStorage.setItem("pp-tab", t); } catch (_) {} render(); };
  function faixa(hubId) {
    const h = HUBS[hubId]; const tabs = h.tabs.filter(([t]) => acesso(t)); if (tabs.length < 2) return null;
    return el("div", { class: "hub-tabs", role: "tablist" }, ...tabs.map(([t, l]) => el("button", { class: "hub-tab", role: "tab", "aria-selected": String(S.tab === t), onclick: () => ir(t) }, l)));
  }
  { const _r = render; render = function () { _r(); if (typeof equipe !== "function" || !equipe()) return; const hubId = hubDe(S.tab); if (!hubId) return;
      const v = $("#view-" + S.tab); if (!v || v.hidden) return; v.querySelector(":scope > .hub-tabs")?.remove(); const f = faixa(hubId); if (f) v.prepend(f); }; }
  document.head.append(el("style", {}, `.hub-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:-4px 0 14px;border-bottom:1px solid var(--line);padding-bottom:8px}
.hub-tab{border:0;background:transparent;font:inherit;font-size:13.5px;font-weight:500;color:var(--muted);padding:6px 12px;border-radius:999px;cursor:pointer}.hub-tab:hover{color:var(--fg);background:var(--surface-2)}.hub-tab[aria-selected=true]{background:var(--navy,#0C1F38);color:#fff}`));
  window.PP_HUBS = { HUBS, hubDe };
})();
