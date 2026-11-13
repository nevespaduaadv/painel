/* Laboratório das integrações entre módulos em V3.1 (Fase 4B): Acompanhamento PJ ↔ Negociações, Tarefas ↔ Acompanhamento PJ,
   reuniões do ciclo na Agenda, busca global e a aba Acompanhamento PJ da ficha. Playwright + Chromium locais; servidor HTTP efêmero;
   TODA chamada a *.supabase.co é interceptada e respondida com fixtures fictícias (nada sai da máquina; escritas capturadas).
   Uso: NODE_PATH=<módulos> node docs/qa/integracoes-lab.cjs [pasta de saída]  (padrão /tmp/integracoes-lab)
   Verifica: identidade (cliente/negociação exatos em cada navegação, inclusive com painéis abertos e empresas com várias negociações/bancos),
   permissões falha-fechadas (nenhuma leitura indevida), contratos públicos (não carregado × vazio × erro), marcos previstos × reuniões
   agendadas × realizadas na Agenda sem suprimir registros legítimos, busca global por estado da lista, paridade da aba da ficha,
   cliente correto nas gravações existentes, 375 px, a11y, V2 e área do cliente intactas. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http'); const { medirContraste, medirAlvos } = require(path.join(process.cwd(), 'docs/qa/_a11y.cjs'));
const RAIZ = process.cwd(); const OUT = process.argv[2] || '/tmp/integracoes-lab'; fs.mkdirSync(OUT, { recursive: true });
const REF = 'ksdwzljfjfucjevdqxvx'; let BASE = '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const servir = () => new Promise((res) => { const srv = http.createServer((q, r) => { const f = path.join(RAIZ, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }); srv.listen(0, '127.0.0.1', () => { BASE = `http://127.0.0.1:${srv.address().port}`; res(srv); }); });
/* ---------- fixtures fictícias (mesma carteira do lab de Acompanhamento PJ + negociações, agenda e prazos) ---------- */
const hoje = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (n) => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n); return iso(d); };
const ts = (n, h, m = 0) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n, h, m).toISOString();
const COLAB = [{ id: 'col-ana', perfil_id: 'u-admin', nome: 'Ana Teste', frente: 'estrategico', nucleo: 'socios', ativo: true }, { id: 'col-luc', perfil_id: 'u-luc', nome: 'Lucas Teste', frente: 'estrategico', nucleo: 'acompanhamento_pj', ativo: true }, { id: 'col-caio', perfil_id: 'u-jur', nome: 'Caio Teste', frente: null, nucleo: 'juridico', ativo: true }, { id: 'col-nat', perfil_id: 'u-nat', nome: 'Natasha Teste', frente: null, nucleo: 'acordos', ativo: true }, { id: 'col-cli', perfil_id: 'u-cli', nome: 'Marina Teste', frente: null, nucleo: 'pos_vendas', ativo: true }];
const cli = (id, nome, o = {}) => ({ id, nome, cnpj: '00.000.000/0001-0' + id.slice(1), status: 'ativo', segmento: o.seg || 'Indústria', cidade: o.cid || 'Franca/SP', pasta_drive_url: 'https://drive.example/' + id, resp_estrategico_id: o.resp || null, direcionamento: o.dir || null, direcionamento_em: o.dir ? dia(-20) : null, projeto_reserva: o.res || null, reservaAcumulada: o.acum || null, regua: o.regua || null, data_onboarding: o.onb || null, ...(o.extra || {}) });
const CLIENTES = [
  cli('c1', 'Empresa Alfa Ltda', { resp: 'col-ana', dir: 'ambos', res: 'formada', acum: 180000, regua: 'ouro', onb: dia(-33), seg: 'Metalurgia' }),
  cli('c2', 'Beta Comércio ME', { resp: 'col-luc', seg: 'Varejo', cid: 'Batatais/SP', onb: dia(2) }),
  cli('c3', 'Gama Indústria SA', { resp: 'col-ana', dir: 'acordos', res: 'em_construcao', regua: 'prata', onb: dia(-120) }),
  cli('c4', 'Delta Transportes', { resp: 'col-luc', res: 'apresentado', regua: 'bronze', onb: dia(-90), seg: 'Logística' }),
  cli('c5', 'Épsilon Alimentos', { resp: 'col-luc', dir: 'acordos', res: 'formada', acum: 60000, regua: 'prata', onb: dia(-200) }),
  cli('c6', 'Zeta Serviços', { seg: 'Serviços' }),
  cli('c7', 'Eta Construções', { resp: 'col-ana', onb: dia(-300), extra: { status: 'encerrado' } }),
  cli('c8', 'Theta Agro', { resp: 'col-luc', dir: 'juridico', onb: dia(-10), seg: 'Agro', cid: 'Ituverava/SP' }),
];
const acomp = (cid, o) => ({ cliente_id: cid, fase: o.fase, onb_data: o.onb ?? null, onb_feita: !!o.onbF, r1_data: o.r1 ?? null, r1_feita: !!o.r1F, r2_data: o.r2 ?? null, r2_feita: !!o.r2F, r3_data: o.r3 ?? null, r3_feita: !!o.r3F, proxima_reuniao: o.prox ?? null, acordos_liberado: !!o.lib, acordos_liberado_em: o.lib ? dia(-15) + 'T12:00:00Z' : null, observacoes: o.obs || null, updated_at: dia(-1) + 'T12:00:00Z' });
const ACOMP = [
  acomp('c1', { fase: 'ciclo', onb: dia(-33), onbF: true, r1: dia(-18), r1F: true, r2: dia(-3), r3: dia(12), lib: true, obs: 'Cliente quer discutir a gestora na R2.' }),  // R2 prevista há 3 dias, não realizada (vencida); R3 prevista em 12 dias
  acomp('c2', { fase: 'onboarding', onb: dia(2) }),                                                                                                                    // ONB prevista em 2 dias — e há um compromisso AGENDADO no mesmo dia (e-onb-c2)
  acomp('c3', { fase: 'mensal', onb: dia(-120), onbF: true, r1: dia(-105), r1F: true, r2: dia(-90), r2F: true, r3: dia(-75), r3F: true, prox: dia(10), lib: true }),
  acomp('c4', { fase: 'mensal', onb: dia(-90), onbF: true, r1: dia(-75), r1F: true, r2: dia(-60), r2F: true, r3: dia(-45), r3F: true, prox: null, lib: true }),
  acomp('c5', { fase: 'mensal', onb: dia(-200), onbF: true, r1: dia(-185), r1F: true, r2: dia(-170), r2F: true, r3: dia(-155), r3F: true, prox: dia(-8), lib: true }),
  acomp('c7', { fase: 'encerrado', onb: dia(-300), onbF: true, r1: dia(-285), r1F: true, r2: dia(-270), r2F: true, r3: dia(-255), r3F: true, lib: true }),
  acomp('c8', { fase: 'ciclo', onb: dia(-10), onbF: true, r1: dia(5), r2: dia(20), r3: dia(35) }),                                                                     // R1 prevista em 5 dias — e há a TAREFA do ciclo "R1 — Theta Agro" no mesmo dia (t-r1-c8)
];
const etapaAtual = (a) => !a || !a.onb_feita ? 'onb' : !a.r1_feita ? 'r1' : !a.r2_feita ? 'r2' : !a.r3_feita ? 'r3' : 'mensal';
const DIVIDAS = { c1: [{ id: 'd1', cliente_id: 'c1', banco: 'Santander', tipo: 'Capital de giro', valor: 480000, atraso_meses: 4, avalista: true, avalista_nome: 'Sócio A', garantia: false, ordem: 1 }, { id: 'd2', cliente_id: 'c1', banco: 'Itaú', tipo: 'Conta garantida', valor: 150000, atraso_meses: 0, avalista: false, garantia: true, garantia_descricao: 'Imóvel', ordem: 2 }], c3: [{ id: 'd3', cliente_id: 'c3', banco: 'Sicoob', tipo: 'Financiamento', valor: 300000, atraso_meses: 2, avalista: false, garantia: false, ordem: 1 }] };
const ATAS = { c1: [{ id: 'a1', cliente_id: 'c1', tipo: 'r1', data: dia(-18), titulo: 'R1 — conexão', resumo: 'Mapeamos as dívidas e combinamos a reserva.', link_pasta: 'https://drive.example/c1/r1', autor_id: 'col-ana' }, { id: 'a2', cliente_id: 'c1', tipo: 'onb', data: dia(-33), resumo: 'Onboarding realizado.', autor_id: 'col-ana' }] };
const TAREFAS = [
  { id: 't1', cliente_id: 'c1', titulo: 'R2 — Empresa Alfa Ltda', prazo: dia(-3), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_id: 'col-ana', responsavel_nome: 'Ana Teste', cliente_nome: 'Empresa Alfa Ltda', created_by: 'u-admin', descricao: 'Reunião R2 do ciclo inicial.' },
  { id: 't2', cliente_id: 'c1', titulo: 'Follow-up (7 dias) — Empresa Alfa Ltda · ' + dia(4), prazo: dia(4), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_id: 'col-ana', responsavel_nome: 'Ana Teste', cliente_nome: 'Empresa Alfa Ltda', created_by: 'u-admin' },
  { id: 't3', cliente_id: 'c3', titulo: 'Reunião mensal — Gama', prazo: dia(10), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_id: 'col-ana', responsavel_nome: 'Ana Teste', cliente_nome: 'Gama Indústria SA', created_by: 'u-admin' },
  { id: 't-r1-c8', cliente_id: 'c8', titulo: 'R1 — Theta Agro', prazo: dia(5), status: 'aberta', prazo_fatal: false, nucleo: 'acompanhamento_pj', responsavel_id: 'col-luc', responsavel_nome: 'Lucas Teste', cliente_nome: 'Theta Agro', created_by: 'u-luc', descricao: 'Reunião R1. Ao concluir: preencher o Raio-X.' },
  { id: 't9', cliente_id: 'c1', titulo: 'Protocolar embargos', prazo: dia(1), status: 'aberta', prazo_fatal: true, nucleo: 'juridico', responsavel_id: 'col-caio', responsavel_nome: 'Caio Teste', cliente_nome: 'Empresa Alfa Ltda', created_by: 'u-jur' },
  { id: 't10', cliente_id: 'c1', titulo: 'Ligar para o gerente (sem vínculo com negociação)', prazo: dia(3), status: 'aberta', prazo_fatal: false, nucleo: 'acordos', responsavel_id: 'col-nat', responsavel_nome: 'Natasha Teste', cliente_nome: 'Empresa Alfa Ltda', created_by: 'u-nat' },
];
const VIEW = () => CLIENTES.map(c => { const a = ACOMP.find(x => x.cliente_id === c.id); return { cliente_id: c.id, fase: a?.fase ?? null, onb_data: a?.onb_data ?? null, onb_feita: a?.onb_feita ?? null, r1_data: a?.r1_data ?? null, r1_feita: a?.r1_feita ?? null, r2_data: a?.r2_data ?? null, r2_feita: a?.r2_feita ?? null, r3_data: a?.r3_data ?? null, r3_feita: a?.r3_feita ?? null, proxima_reuniao: a?.proxima_reuniao ?? null, acordos_liberado: a?.acordos_liberado ?? null, acordos_liberado_em: a?.acordos_liberado_em ?? null, observacoes: a?.observacoes ?? null, etapa_atual: etapaAtual(a), n_dividas: (DIVIDAS[c.id] || []).length, n_atas: (ATAS[c.id] || []).length }; });
const NEG_ETAPAS = ['iniciar', 'extrajudicial', 'pos_judicializacao', 'minuta', 'formalizado', 'pagamento_pendente', 'concluido'];
const neg = (id, o) => ({ id, cliente_id: o.c, cliente_nome: CLIENTES.find(x => x.id === o.c).nome, titulo: o.t, banco: o.b, etapa: o.e, etapa_ordem: NEG_ETAPAS.indexOf(o.e), ordem: 0, temperatura: o.temp || null, situacao_processual: o.sit || null, numero_processo: o.np || null, responsavel_id: o.r || null, responsavel_nome: COLAB.find(x => x.id === o.r)?.nome || null, adverso_contato: null, valor_cobrado: o.vc ?? null, valor_acordo: o.va ?? null, alcada_autorizada: o.alc ?? null, percentual_exito: o.pex ?? null, data_acordo: o.da || null, prazo: o.dias == null ? null : dia(o.dias), atrasada: o.dias != null && o.dias < 0 && o.e !== 'concluido', dias_parada: o.parada ?? 2, aguardando: null, proximo_passo: o.pp || null, observacoes: null, contrato_id: o.k || null, updated_at: new Date(Date.now() - (o.parada ?? 2) * 86400000).toISOString() });
const NEGS = [
  neg('n1', { c: 'c1', t: 'Alfa | Santander | Capital de giro', b: 'Santander', e: 'extrajudicial', temp: 'quente', r: 'col-nat', dias: -3, vc: 480000, va: 210000, alc: 260000, pex: 20, np: '0000001-11.2026.8.26.0196', pp: 'Enviar contraproposta até sexta.', k: 'k-alfa-1' }),
  neg('n2', { c: 'c1', t: 'Alfa | Itaú | Conta garantida', b: 'Itaú', e: 'iniciar', temp: 'frio', r: 'col-nat', dias: 4, vc: 150000, parada: 20, k: 'k-alfa-2' }),
  neg('n3', { c: 'c1', t: 'Alfa | Bradesco | Cartão (concluída)', b: 'Bradesco', e: 'concluido', r: 'col-nat', vc: 40000, va: 22000, da: dia(-40) }),
  neg('n4', { c: 'c3', t: 'Gama | Sicoob | Financiamento', b: 'Sicoob', e: 'minuta', temp: 'morno', r: 'col-nat', dias: 6, vc: 300000, va: 170000, pex: 15, pp: 'Aguardar minuta do banco.' }),
  neg('n5', { c: 'c8', t: 'Theta | Santander | Crédito rural', b: 'Santander', e: 'extrajudicial', temp: 'morno', r: 'col-nat', dias: 9, vc: 900000 }),
];
// contratos no formato da tabela (id, cliente_id, dados) — mesmo cliente c1 com dois bancos/contratos distintos
const CONTRATOS = [{ id: 'k-alfa-1', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Santander', titular: 'PJ', produto: 'giro', situacao: 'inadimplido', valorOriginal: 500000, saldoAtual: 480000 } }, { id: 'k-alfa-2', cliente_id: 'c1', dados: { clienteId: 'c1', banco: 'Itaú', titular: 'PJ', produto: 'contagar', situacao: 'em_dia', valorOriginal: 150000, saldoAtual: 150000 } }];
// agenda: um compromisso AGENDADO para o ONB de c2 (mesmo dia da data prevista), um compromisso avulso de c1 sem relação com o ciclo, um evento do Google
const AGENDA = [
  { id: 'e-onb-c2', titulo: 'Onboarding — Beta Comércio', inicio: ts(2, 10), fim: ts(2, 11), dia_inteiro: false, colaborador_id: 'col-luc', colaborador_nome: 'Lucas Teste', cliente_id: 'c2', cliente_nome: 'Beta Comércio ME', tipo: 'reuniao', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'Google Meet', descricao: null, cancelado: false },
  { id: 'e-avulso-c1', titulo: 'Visita à fábrica', inicio: ts(12, 14), fim: ts(12, 16), dia_inteiro: false, colaborador_id: 'col-ana', colaborador_nome: 'Ana Teste', cliente_id: 'c1', cliente_nome: 'Empresa Alfa Ltda', tipo: 'compromisso', origem: 'painel', tarefa_id: null, lead_id: null, link: null, local: 'Franca', descricao: null, cancelado: false }, // mesmo dia da R3 PREVISTA de c1, mas é outro compromisso — não pode ser suprimido nem substituir o marco
  { id: 'e-google', titulo: 'Dentista', inicio: ts(5, 9), fim: ts(5, 10), dia_inteiro: false, colaborador_id: 'col-luc', colaborador_nome: 'Lucas Teste', cliente_id: null, cliente_nome: null, tipo: 'compromisso', origem: 'google', tarefa_id: null, lead_id: null, link: 'https://calendar.google.com/x', local: null, descricao: null, cancelado: false },
];
const faixa = (n) => n < 0 ? 'atrasada' : n === 0 ? 'hoje' : n <= 7 ? 'd7' : 'depois';
const PRAZOS = TAREFAS.filter(t => t.prazo).map(t => { const n = Math.round((new Date(t.prazo + 'T12:00:00') - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12)) / 864e5); return { id: t.id, origem: 'tarefa', descricao: t.titulo, prazo: t.prazo, prazo_fatal: t.prazo_fatal, faixa: faixa(n), dias_para_prazo: n, cliente_id: t.cliente_id, cliente_nome: t.cliente_nome, responsavel_id: t.responsavel_id, responsavel_nome: t.responsavel_nome, nucleo: t.nucleo, processo_id: null }; });
const PERFIS = { admin: { id: 'u-admin', nome: 'Ana Teste', papel: 'admin', acessos: [] }, lucas: { id: 'u-luc', nome: 'Lucas Teste', papel: 'colaborador', acessos: ['clientes', 'juridico'] }, juridico: { id: 'u-jur', nome: 'Caio Teste', papel: 'colaborador', acessos: ['juridico'] }, clientes: { id: 'u-cli', nome: 'Marina Teste', papel: 'colaborador', acessos: ['clientes'] } };
const sessao = (perfil) => ({ access_token: 'lab', refresh_token: 'lab', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: perfil.id, email: perfil.id + '@lab', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
async function contexto(b, { perfil = 'admin', casca = 'v3', w = 1440, h = 900, tema = 'light', hash = '#acompanhamento', extraLS = {}, negErro = false, negLento = 0 } = {}) {
  const P = PERFIS[perfil]; const s = sessao(P); const escritas = []; const erros = []; const leituras = [];
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: tema, hasTouch: w < 900 });
  await ctx.addInitScript(({ s, ref, casca, tema, extraLS }) => { try { if (!sessionStorage.getItem('lab')) { localStorage.clear(); localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s)); if (casca === 'v3') localStorage.setItem('np-casca', 'v3'); localStorage.setItem('pp-tema', tema); for (const [k, v] of Object.entries(extraLS)) localStorage.setItem(k, v); sessionStorage.setItem('lab', '1'); } } catch (_) {} }, { s, ref: REF, casca, tema, extraLS });
  await ctx.route(/supabase\.co/, async (rota) => {
    const req = rota.request(); const u = new URL(req.url()); const p = u.pathname; const m = req.method(); const unico = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    const json = (b, status = 200, extra = {}) => rota.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...extra }, body: JSON.stringify(b) });
    if (m === 'GET') leituras.push(p + u.search);
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !p.startsWith('/auth/')) { escritas.push(m + ' ' + p + u.search + ' ' + (req.postData() || '').slice(0, 400)); return json(m === 'POST' && /rpc/.test(p) ? null : (m === 'POST' ? [{ id: 'novo-' + Date.now() }] : []), m === 'POST' ? 201 : 200); }
    if (p.startsWith('/auth/v1/user')) return json(s.user); if (p.startsWith('/auth/v1/token')) return json(s); if (p.startsWith('/auth/v1/logout')) return json({}, 204);
    if (p.startsWith('/realtime/')) return rota.abort(); if (p.startsWith('/rest/v1/rpc/')) return json(m === 'POST' ? [] : null);
    if (p.startsWith('/rest/v1/perfis')) return json(unico ? P : [P]);
    if (p.startsWith('/rest/v1/clientes')) return json(CLIENTES, 200, { 'content-range': `0-${CLIENTES.length - 1}/${CLIENTES.length}` });
    if (p.startsWith('/rest/v1/contratos')) return json(CONTRATOS, 200, { 'content-range': `0-${CONTRATOS.length - 1}/${CONTRATOS.length}` });
    if (p.startsWith('/rest/v1/v_acompanhamento_pj')) return json(VIEW());
    if (p.startsWith('/rest/v1/acompanhamento_pj')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); const a = ACOMP.find(x => x.cliente_id === cid) || null; return unico ? (a ? json(a) : json(null, 200)) : json(a ? [a] : []); }
    if (p.startsWith('/rest/v1/dividas_raio_x')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); return json(DIVIDAS[cid] || []); }
    if (p.startsWith('/rest/v1/atas_reuniao')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); return json(ATAS[cid] || []); }
    if (p.startsWith('/rest/v1/colaboradores')) { const pid = (u.searchParams.get('perfil_id') || '').replace('eq.', ''); const l = pid ? COLAB.filter(x => x.perfil_id === pid) : COLAB; if (unico) return l[0] ? json(l[0]) : json({ message: 'nenhum', code: 'PGRST116' }, 406); return json(l); }
    if (p.startsWith('/rest/v1/v_tarefas')) { const nuc = (u.searchParams.get('nucleo') || '').replace('eq.', ''); const id = (u.searchParams.get('id') || '').replace('eq.', ''); const l = TAREFAS.filter(t => (!nuc || t.nucleo === nuc) && (!id || t.id === id)); return unico ? (l[0] ? json(l[0]) : json(null)) : json(l); }
    if (p.startsWith('/rest/v1/tarefas')) { const cid = (u.searchParams.get('cliente_id') || '').replace('eq.', ''); return json(TAREFAS.filter(t => t.cliente_id === cid).map(t => ({ titulo: t.titulo }))); }
    if (p.startsWith('/rest/v1/v_negociacoes')) { if (negErro) return json({ code: '42P01', message: 'relation "public.v_negociacoes" does not exist' }, 404); if (negLento) await new Promise(r => setTimeout(r, negLento)); return json(NEGS); }
    if (p.startsWith('/rest/v1/v_agenda')) return json(AGENDA);
    if (p.startsWith('/rest/v1/v_prazos')) return json(PRAZOS);
    if (p.startsWith('/rest/v1/feriados')) return json([]);
    if (p.startsWith('/rest/v1/tarefa_eventos') || p.startsWith('/rest/v1/v_monitoramentos') || p.startsWith('/rest/v1/v_tickets') || p.startsWith('/rest/v1/processos') || p.startsWith('/rest/v1/bens') || p.startsWith('/rest/v1/v_avisos') || p.startsWith('/rest/v1/v_leads')) return json([]);
    return unico ? json({ message: 'nenhum', code: 'PGRST116' }, 406) : json([]);
  });
  const pg = await ctx.newPage(); pg.on('pageerror', e => erros.push(e.message)); pg.on('console', msg => { if (msg.type() === 'error' && !/supabase\.co|net::ERR|Failed to load resource|WebSocket/.test(msg.text())) erros.push('console: ' + msg.text().slice(0, 160)); });
  await pg.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof PP !== 'undefined' && PP.perfil && document.querySelector('#login')?.hidden && typeof S !== 'undefined' && (!PP.temAcesso('clientes') || (S.clientes && S.clientes.length > 0)), null, { timeout: 20000 });
  await pg.waitForTimeout(800);
  return { ctx, pg, erros, escritas, leituras, perfil: P };
}
const rel = []; let falhas = 0; const ok = (m) => rel.push('  ok    ' + m); const falha = (m) => { falhas++; rel.push('  FALHA ' + m); };
const esperaPainel = (pg, raiz) => pg.waitForFunction((raiz) => { const p = document.querySelector(raiz + ' .np-painel'); return p && !p.hidden && p.getAttribute('aria-busy') !== 'true' && p.querySelector('h2')?.textContent && !p.closest('[hidden]'); }, raiz, { timeout: 12000 });
const esperaSecao = (pg, raiz, titulo) => pg.waitForFunction(([raiz, t]) => [...document.querySelectorAll(raiz + ' .np-painel .np-sec h3')].some(h => h.textContent.startsWith(t)) && !document.querySelector(raiz + ' .np-painel .np-sec .np-skel, ' + raiz + ' .np-painel .np-sec .np-carregando'), [raiz, titulo], { timeout: 12000 });
const abrirAcomp = async (pg, cid) => { await pg.click(`#view-acompanhamento li.np-it[data-id="${cid}"] .np-it-abrir`); await esperaPainel(pg, '#view-acompanhamento'); await pg.waitForTimeout(400); };
const painel = (pg, raiz) => pg.evaluate((raiz) => { const p = document.querySelector(raiz + ' .np-painel'); if (!p) return null; const props = {}; p.querySelectorAll('.np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { titulo: p.querySelector('h2')?.textContent, trilha: p.querySelector('.np-trilha-p')?.textContent.replace(/\s+/g, ' ').trim(), props, secs: [...p.querySelectorAll('.np-sec h3')].map(h => h.textContent), pe: [...p.querySelectorAll('.np-p-pe button, .np-p-pe a')].map(b => b.textContent.trim()).filter(Boolean) }; }, raiz);
(async () => {
  const srv = await servir(); const b = await chromium.launch();
  // ========== 1. B2 — Acompanhamento PJ ↔ Negociações (admin) ==========
  rel.push('1. B2 — Acompanhamento PJ ↔ Negociações');
  { const { ctx, pg, erros, escritas, leituras } = await contexto(b, { hash: '#acompanhamento' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-acompanhamento li.np-it[data-id]').length >= 5, null, { timeout: 12000 });
    await abrirAcomp(pg, 'c1'); await esperaSecao(pg, '#view-acompanhamento', 'Negociações');
    const p1 = await painel(pg, '#view-acompanhamento');
    const negs = await pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento .np-painel .np-vinc-it')].map(x => ({ banco: x.querySelector('.np-vinc-h b')?.textContent, etapa: x.querySelector('.np-vinc-et')?.textContent, marcas: [...x.querySelectorAll('.np-marca')].map(m => m.textContent), val: x.querySelector('.np-val')?.textContent.replace(/\s+/g, ' ').trim(), pontos: x.querySelectorAll('.np-etapa i, .np-etapa span').length })));
    const rod = await pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento .np-painel .np-sec')].find(s => /Negociações/.test(s.querySelector('h3').textContent))?.querySelector('.np-rodape')?.textContent.replace(/\s+/g, ' ').trim());
    if (p1.titulo === 'Empresa Alfa Ltda' && p1.secs.includes('Negociações · 2 abertas') && negs.length === 2 && negs[0].banco === 'Santander' && /vencido/.test(negs[0].marcas.join()) && /210/.test(negs[0].val) && negs[1].banco === 'Itaú' && /parada/.test(negs[1].marcas.join()) && /1 concluída/.test(rod) && /Nova negociação/.test(rod)) ok('painel de c1 (Alfa): seção "Negociações · 2 abertas" com Santander (vencida, cobrado → proposta) e Itaú (parada); concluída só contada; "Nova negociação" (admin)'); else falha('secNeg c1: ' + JSON.stringify([p1.secs, negs, rod]));
    const lidas = leituras.filter(l => /v_negociacoes/.test(l)).length; if (lidas === 1) ok('negociações carregadas pelo módulo de Negociações (1 leitura de v_negociacoes, sob demanda, reaproveitada)'); else falha('leituras v_negociacoes: ' + lidas);
    // identidade: abrir a negociação Itaú de c1 → rota #negociacoes com o painel de n2 (cliente c1, contrato CC-002)
    await pg.click('#view-acompanhamento .np-painel .np-vinc-it:nth-child(2)'); await pg.waitForFunction(() => S.tab === 'negociacoes', null, { timeout: 8000 }); await esperaPainel(pg, '#view-negociacoes'); await pg.waitForTimeout(400);
    const pn = await painel(pg, '#view-negociacoes'); const aberta = await pg.evaluate(() => document.querySelector('#view-negociacoes li[aria-current="true"]')?.dataset.id);
    if (pn.titulo === 'Alfa | Itaú | Conta garantida' && /Empresa Alfa Ltda/.test(pn.trilha) && /Itaú/.test(pn.trilha) && pn.props.Cliente === 'Empresa Alfa Ltda' && /^Itaú · Conta garantida/.test(pn.props.Contrato || '') && aberta === 'n2') ok('clique na negociação Itaú → #negociacoes com o painel de n2 (cliente c1, contrato da própria negociação), linha n2 marcada'); else falha('abrir n2: ' + JSON.stringify([pn, aberta]));
    // bloco Acompanhamento PJ no painel da negociação
    await esperaSecao(pg, '#view-negociacoes', 'Acompanhamento PJ'); const pn2 = await painel(pg, '#view-negociacoes');
    if (pn2.secs.includes('Acompanhamento PJ') && /Ciclo inicial/.test(pn2.props.Fase) && /R2 · prevista/.test(pn2.props['Próxima reunião']) && /liberado em/.test(pn2.props.Acordos) && /Ana/.test(pn2.props['Resp. estratégico']) && /2 tarefas abertas/.test(pn2.props['Pendências'])) ok('painel da negociação: seção "Acompanhamento PJ" (fase, R2 PREVISTA vencida, acordos liberado, responsável estratégico, 2 pendências do núcleo)'); else falha('secAcomp n2: ' + JSON.stringify(pn2));
    // volta pelo bloco → painel de c1 no acompanhamento (identidade preservada)
    await pg.click('#view-negociacoes .np-painel button:has-text("Abrir acompanhamento")'); await pg.waitForFunction(() => S.tab === 'acompanhamento', null, { timeout: 8000 }); await esperaPainel(pg, '#view-acompanhamento'); await pg.waitForTimeout(400);
    const pa = await painel(pg, '#view-acompanhamento'); const ab2 = await pg.evaluate(() => document.querySelector('#view-acompanhamento li[aria-current="true"]')?.dataset.id);
    if (pa.titulo === 'Empresa Alfa Ltda' && ab2 === 'c1') ok('"Abrir acompanhamento" volta ao painel de c1 (não de outro cliente)'); else falha('volta c1: ' + JSON.stringify([pa.titulo, ab2]));
    // troca de contexto com painel aberto: c3 (Gama) → seção com Sicoob (minuta), não Santander/Itaú de c1
    await abrirAcomp(pg, 'c3'); await esperaSecao(pg, '#view-acompanhamento', 'Negociações');
    const n3 = await pg.evaluate(() => ({ titulo: document.querySelector('#view-acompanhamento .np-painel h2')?.textContent, bancos: [...document.querySelectorAll('#view-acompanhamento .np-painel .np-vinc-it .np-vinc-h b')].map(b => b.textContent) }));
    if (n3.titulo === 'Gama Indústria SA' && n3.bancos.join() === 'Sicoob') ok('troca para c3 (Gama) com painel aberto: só a negociação Sicoob de c3 (nada de c1)'); else falha('c3: ' + JSON.stringify(n3));
    // cliente sem negociações (c5) → vazio explícito; cliente c2 idem
    await abrirAcomp(pg, 'c5'); await esperaSecao(pg, '#view-acompanhamento', 'Negociações');
    const n5 = await pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento .np-painel .np-sec')].find(s => /Negociações/.test(s.querySelector('h3').textContent))?.textContent.replace(/\s+/g, ' '));
    if (/Nenhuma negociação aberta/.test(n5) && /Nova negociação/.test(n5)) ok('c5 (sem negociações): "Nenhuma negociação aberta" + "Nova negociação" (lista vazia ≠ não carregada)'); else falha('c5: ' + n5);
    // "Nova negociação" a partir de c5 → formulário com o cliente c5 fixo (não c1/c3 abertos antes)
    await pg.click('#view-acompanhamento .np-painel button:has-text("Nova negociação")'); await pg.waitForTimeout(400);
    const nf = await pg.evaluate(() => { const sel = document.querySelector('#modalHost select'); return { t: document.querySelector('#modalHost h2')?.textContent, cli: sel?.value, disabled: sel?.disabled }; });
    if (/Nova negociação|Negociação/.test(nf.t || '') && nf.cli === 'c5' && nf.disabled) ok('"Nova negociação" pelo painel de c5 abre o formulário atual com o cliente c5 fixo e travado'); else falha('nova neg c5: ' + JSON.stringify(nf));
    await pg.evaluate(() => document.querySelector('#modalHost .btn:not(.primary)')?.click()); await pg.waitForTimeout(200);
    // negociação de c8 → bloco com R1 prevista em 5 dias; negociação de c1 n1 mostra as pendências de c1 (não de c8)
    await pg.evaluate(() => { window.PP_NEG.abrir('n5'); }); await pg.waitForFunction(() => S.tab === 'negociacoes', null, { timeout: 8000 }); await esperaPainel(pg, '#view-negociacoes'); await esperaSecao(pg, '#view-negociacoes', 'Acompanhamento PJ');
    const p8 = await painel(pg, '#view-negociacoes');
    if (p8.titulo === 'Theta | Santander | Crédito rural' && /R1 · prevista/.test(p8.props['Próxima reunião']) && /aguarda a R1/.test(p8.props.Acordos) && /Lucas/.test(p8.props['Resp. estratégico']) && /1 tarefa aberta/.test(p8.props['Pendências'])) ok('negociação de c8 (Theta): acompanhamento de c8 (R1 prevista, acordos aguarda R1, Lucas, 1 pendência) — não o de c1'); else falha('n5 acomp: ' + JSON.stringify(p8));
    if (!escritas.length && !erros.length) ok('B2: nenhuma escrita, sem erros de página'); else falha('B2 escritas/erros: ' + JSON.stringify([escritas, erros]));
    await pg.screenshot({ path: path.join(OUT, 'b2-negociacao-acomp-1440.png') }); await ctx.close(); }
  // permissões B2
  rel.push('1b. B2 — permissões falha-fechadas');
  { // perfil só Clientes (sem juridico): vê Acompanhamento PJ, não vê Negociações — e nenhuma leitura de v_negociacoes
    const { ctx, pg, leituras, erros } = await contexto(b, { perfil: 'clientes', hash: '#acompanhamento' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-acompanhamento li.np-it[data-id]').length >= 5, null, { timeout: 12000 }).catch(() => {});
    await abrirAcomp(pg, 'c1'); await pg.waitForTimeout(600); const p = await painel(pg, '#view-acompanhamento');
    const lidas = leituras.filter(l => /v_negociacoes/.test(l)).length;
    // o módulo fluxo.js (tag juridico) nem é carregado para este perfil: o contrato PP_NEG fica AUSENTE e o consumidor precisa tolerar isso
    const pv = await pg.evaluate(() => window.PP_NEG ? { pode: window.PP_NEG.podeVer(), por: window.PP_NEG.porCliente('c1'), carregar: window.PP_NEG.carregar(), abrir: window.PP_NEG.abrir('n1'), nova: window.PP_NEG.nova({ id: 'c1' }) } : 'ausente');
    const seguro = pv === 'ausente' || (pv.pode === false && pv.por === null && pv.carregar === false && pv.abrir === false && pv.nova === false);
    if (p.titulo === 'Empresa Alfa Ltda' && !p.secs.some(s => /Negociações/.test(s)) && lidas === 0 && seguro) ok(`perfil só-Clientes: painel de c1 sem seção Negociações; v_negociacoes nunca lida; contrato PP_NEG ${pv === 'ausente' ? 'ausente (módulo não carregado para o perfil) e tolerado pelo consumidor' : 'responde false/null'}`); else falha('perm clientes: ' + JSON.stringify([p.secs, lidas, pv]));
    const lidas2 = leituras.filter(l => /v_negociacoes/.test(l)).length; if (lidas2 === 0 && !erros.length) ok('chamadas diretas ao contrato não provocaram leitura nem erro'); else falha('perm clientes 2: ' + JSON.stringify([lidas2, erros]));
    await ctx.close(); }
  { // perfil só Jurídico (sem clientes): vê Negociações, não vê Acompanhamento PJ — e nenhuma leitura de v_acompanhamento_pj
    const { ctx, pg, leituras, erros } = await contexto(b, { perfil: 'juridico', hash: '#negociacoes' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-negociacoes li.np-it[data-id]').length >= 3, null, { timeout: 12000 }).catch(() => {});
    await pg.click('#view-negociacoes li.np-it[data-id="n1"] .np-it-abrir'); await esperaPainel(pg, '#view-negociacoes'); await pg.waitForTimeout(600); const p = await painel(pg, '#view-negociacoes');
    const lidas = leituras.filter(l => /v_acompanhamento_pj|dividas_raio_x|atas_reuniao/.test(l)).length;
    const pv = await pg.evaluate(() => window.PP_ACOMP ? { pode: window.PP_ACOMP.podeVer(), por: window.PP_ACOMP.porCliente('c1'), marcos: window.PP_ACOMP.marcos(), carregar: window.PP_ACOMP.carregarLista(), abrir: window.PP_ACOMP.abrir('c1'), regs: window.PP_ACOMP.registros().length } : 'ausente');
    const seguro = pv === 'ausente' || (pv.pode === false && pv.por === null && pv.marcos === null && pv.carregar === false && pv.abrir === false && pv.regs === 0);
    if (p.titulo === 'Alfa | Santander | Capital de giro' && !p.secs.includes('Acompanhamento PJ') && lidas === 0 && seguro) ok(`perfil só-Jurídico: painel de n1 sem seção Acompanhamento PJ; v_acompanhamento_pj/dividas/atas nunca lidas; contrato PP_ACOMP ${pv === 'ausente' ? 'ausente (módulo não carregado para o perfil) e tolerado pelo consumidor' : 'responde false/null/[]'}`); else falha('perm juridico: ' + JSON.stringify([p.secs, lidas, pv]));
    if (leituras.filter(l => /v_acompanhamento_pj/.test(l)).length === 0 && !erros.length) ok('chamadas diretas ao contrato PP_ACOMP não provocaram leitura nem erro'); else falha('perm juridico 2');
    // função de permissão ausente / lançando exceção ⇒ false
    const rob = await pg.evaluate(() => { const o = PP.temAcesso; const r = {}; const sonda = () => [window.PP_NEG.podeVer(), window.PP_ACOMP ? window.PP_ACOMP.podeVer() : false, NPUI.permite('negociacoes'), NPUI.permite('acompanhamento')]; PP.temAcesso = () => { throw new Error('x'); }; r.exc = sonda(); PP.temAcesso = () => 1; r.naoEstrito = sonda(); PP.temAcesso = undefined; r.ausente = sonda(); PP.temAcesso = o; return r; });
    if ([...rob.exc, ...rob.naoEstrito, ...rob.ausente].every(x => x === false)) ok('permissão lançando exceção, respondendo 1 (não estrito) ou ausente ⇒ todos os contratos respondem false'); else falha('robustez: ' + JSON.stringify(rob));
    await ctx.close(); }
  { // estados do contrato: erro na view de negociações → seção informa indisponibilidade (não "vazio"), sem travar o painel
    const { ctx, pg, erros, leituras } = await contexto(b, { hash: '#acompanhamento', negErro: true });
    await pg.waitForFunction(() => document.querySelectorAll('#view-acompanhamento li.np-it[data-id]').length >= 5, null, { timeout: 12000 });
    await abrirAcomp(pg, 'c1'); await pg.waitForTimeout(2500);
    const r = await pg.evaluate(() => ({ e: window.PP_NEG.estado(), por: window.PP_NEG.porCliente('c1'), sec: [...document.querySelectorAll('#view-acompanhamento .np-painel .np-sec')].find(s => /Negociações/.test(s.querySelector('h3').textContent))?.textContent.replace(/\s+/g, ' '), titulo: document.querySelector('#view-acompanhamento .np-painel h2')?.textContent }));
    const tent = leituras.filter(l => /v_negociacoes/.test(l)).length;
    if (r.e.carregado === false && r.e.carregando === false && r.e.erro && r.por === null && /indisponíveis/.test(r.sec || '') && r.titulo === 'Empresa Alfa Ltda' && tent === 1) ok(`erro ao carregar negociações: estado {carregado:false, erro}, porCliente=null, seção "indisponíveis" (≠ vazio), 1 única tentativa (sem laço de recarga); painel do cliente continua`); else falha('estado erro: ' + JSON.stringify([r, tent]));
    await ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.') + '\n'; fs.writeFileSync(path.join(OUT, 'relatorio-integracoes-lab.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.log(rel.join('\n')); console.error(e); process.exit(2); });
