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
  { id: 't10', cliente_id: 'c1', titulo: 'Ligar para o gerente da conta', prazo: dia(3), status: 'aberta', prazo_fatal: false, nucleo: 'acordos', responsavel_id: 'col-nat', responsavel_nome: 'Natasha Teste', cliente_nome: 'Empresa Alfa Ltda', created_by: 'u-nat' },
];
const faixa = (n) => n < 0 ? 'atrasada' : n === 0 ? 'hoje' : n <= 7 ? 'd7' : n <= 15 ? 'd15' : 'depois';
for (const t of TAREFAS) { if (t.prazo) { const n = Math.round((new Date(t.prazo + 'T12:00:00') - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12)) / 864e5); t.dias_para_prazo = n; t.faixa = faixa(n); } }
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
  // ========== 2. B3 — Tarefas ↔ Acompanhamento PJ ==========
  rel.push('2. B3 — Tarefas ↔ Acompanhamento PJ');
  { const { ctx, pg, erros, escritas, leituras } = await contexto(b, { hash: '#tarefas' });
    await pg.waitForFunction(() => window.PP_TAREFAS && window.PP_TAREFAS.lista().length >= 5 && document.querySelector('#view-tarefas .np-it[data-id]'), null, { timeout: 12000 });
    const marcas = await pg.evaluate(() => Object.fromEntries(['t1', 't10', 't9', 't-r1-c8'].map(id => { const li = document.querySelector(`#view-tarefas .np-it[data-id="${id}"]`); return [id, li ? [...li.querySelectorAll('.np-marca')].map(m => m.textContent) : 'ausente']; })));
    const temAcomp = (v) => Array.isArray(v) && v.includes('acomp');
    if (temAcomp(marcas.t1) && temAcomp(marcas['t-r1-c8']) && Array.isArray(marcas.t10) && !temAcomp(marcas.t10) && Array.isArray(marcas.t9) && !temAcomp(marcas.t9)) ok('linhas: marca "acomp" só nas tarefas do núcleo Acompanhamento PJ (t1, t-r1-c8); t10 (Acordos, mesmo cliente) e t9 (Jurídico) sem marca'); else falha('marcas: ' + JSON.stringify(marcas));
    // t1 = "R2 — Empresa Alfa Ltda": trilha Cliente · Acompanhamento PJ, bloco com o acompanhamento de c1
    await pg.evaluate(() => window.PP_TAREFAS.abrir('t1')); await esperaPainel(pg, '#view-tarefas'); await esperaSecao(pg, '#view-tarefas', 'Acompanhamento PJ'); const p1 = await painel(pg, '#view-tarefas');
    if (p1.titulo === 'R2 — Empresa Alfa Ltda' && /Empresa Alfa Ltda/.test(p1.trilha) && /Acompanhamento PJ/.test(p1.trilha) && p1.secs.includes('Acompanhamento PJ') && /Ciclo inicial/.test(p1.props.Fase) && /R2 · prevista/.test(p1.props['Próxima reunião']) && /liberado em/.test(p1.props.Acordos) && /Ana/.test(p1.props['Resp. estratégico'])) ok('painel de t1: trilha "Empresa Alfa Ltda · Acompanhamento PJ"; bloco com fase, R2 PREVISTA (vencida), acordos liberado, resp. estratégico — dados de c1'); else falha('t1: ' + JSON.stringify(p1));
    const lidas = leituras.filter(l => /v_acompanhamento_pj/.test(l)).length; if (lidas === 1) ok('lista do acompanhamento lida 1 vez, sob demanda, pelo próprio módulo'); else falha('leituras acomp: ' + lidas);
    // t10: mesmo cliente c1, núcleo Acordos → nenhum bloco; e nada é apresentado como vínculo com negociação
    await pg.evaluate(() => window.PP_TAREFAS.abrir('t10')); await esperaPainel(pg, '#view-tarefas'); await pg.waitForTimeout(400); const p10 = await painel(pg, '#view-tarefas');
    const txt10 = await pg.evaluate(() => document.querySelector('#view-tarefas .np-painel').textContent);
    if (p10.titulo === 'Ligar para o gerente da conta' && !p10.secs.includes('Acompanhamento PJ') && !/Negociaç|Santander|Itaú/.test(txt10)) ok('t10 (c1, núcleo Acordos): sem bloco de acompanhamento e sem qualquer menção a negociações/bancos — tarefa só do cliente não vira tarefa de negociação'); else falha('t10: ' + JSON.stringify([p10.secs, /Negociaç|Santander|Itaú/.test(txt10)]));
    // t-r1-c8: bloco de c8 (não de c1, aberto antes)
    await pg.evaluate(() => window.PP_TAREFAS.abrir('t-r1-c8')); await esperaPainel(pg, '#view-tarefas'); await esperaSecao(pg, '#view-tarefas', 'Acompanhamento PJ'); const p8 = await painel(pg, '#view-tarefas');
    if (p8.titulo === 'R1 — Theta Agro' && /Theta Agro/.test(p8.trilha) && /R1 · prevista/.test(p8.props['Próxima reunião']) && /aguarda a R1/.test(p8.props.Acordos) && /Lucas/.test(p8.props['Resp. estratégico'])) ok('t-r1-c8: bloco do acompanhamento de c8 (R1 prevista, aguarda R1, Lucas) — identidade preservada após c1'); else falha('t-r1-c8: ' + JSON.stringify(p8));
    // "Abrir acompanhamento" → #acompanhamento com o painel de c8
    await pg.click('#view-tarefas .np-painel button:has-text("Abrir acompanhamento")'); await pg.waitForFunction(() => S.tab === 'acompanhamento', null, { timeout: 8000 }); await esperaPainel(pg, '#view-acompanhamento'); await pg.waitForTimeout(400);
    const pa = await painel(pg, '#view-acompanhamento'); const ab = await pg.evaluate(() => document.querySelector('#view-acompanhamento li[aria-current="true"]')?.dataset.id);
    if (pa.titulo === 'Theta Agro' && ab === 'c8') ok('"Abrir acompanhamento" na tarefa → #acompanhamento com o painel de c8 (Theta Agro)'); else falha('abrir acomp de tarefa: ' + JSON.stringify([pa.titulo, ab]));
    // pendências do painel de c8 continuam apontando para Tarefas (volta já existente) e abrem t-r1-c8
    const pend = await pg.evaluate(() => [...document.querySelectorAll('#view-acompanhamento .np-painel button, #view-acompanhamento .np-painel a')].map(b => b.textContent.trim()).filter(t => /R1 — Theta Agro/.test(t)));
    if (pend.length >= 1) ok('painel de c8 lista a pendência "R1 — Theta Agro" (volta Acompanhamento → Tarefas preservada)'); else falha('pend c8: ' + JSON.stringify(pend));
    if (!escritas.length && !erros.length) ok('B3: nenhuma escrita, sem erros de página'); else falha('B3 escritas/erros: ' + JSON.stringify([escritas, erros]));
    await pg.evaluate(() => window.PP_TAREFAS.abrir('t1')); await pg.waitForFunction(() => S.tab === 'tarefas', null, { timeout: 8000 }); await esperaPainel(pg, '#view-tarefas'); await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(OUT, 'b3-tarefa-acomp-1440.png') });
    await ctx.close(); }
  { // perfil só-Jurídico: tarefa do núcleo acompanhamento_pj visível na lista, mas sem bloco nem marca, sem leitura de v_acompanhamento_pj
    const { ctx, pg, leituras } = await contexto(b, { perfil: 'juridico', hash: '#tarefas' });
    await pg.waitForFunction(() => window.PP_TAREFAS && window.PP_TAREFAS.lista().length >= 1 && document.querySelector('#view-tarefas .np-it[data-id]'), null, { timeout: 12000 });
    const ha = await pg.evaluate(() => !!window.PP_TAREFAS.lista().find(t => t.id === 't1'));
    if (ha) { await pg.evaluate(() => window.PP_TAREFAS.abrir('t1')); await esperaPainel(pg, '#view-tarefas'); await pg.waitForTimeout(500); const p = await painel(pg, '#view-tarefas'); const mk = await pg.evaluate(() => [...document.querySelectorAll('#view-tarefas .np-it[data-id="t1"] .np-marca')].map(m => m.textContent));
      if (!p.secs.includes('Acompanhamento PJ') && !mk.includes('acomp') && leituras.filter(l => /v_acompanhamento_pj/.test(l)).length === 0) ok('perfil só-Jurídico: t1 sem bloco "Acompanhamento PJ" e sem marca; v_acompanhamento_pj nunca lida'); else falha('perm B3: ' + JSON.stringify([p.secs, mk])); }
    else ok('perfil só-Jurídico: tarefas do núcleo Acompanhamento PJ não entram na lista deste perfil (nada a bloquear)');
    await ctx.close(); }
  // ========== 3. B4 — marcos previstos do Acompanhamento PJ na Agenda ==========
  rel.push('3. B4 — Agenda: marcos previstos × reuniões agendadas × realizadas');
  const dataLocal = (n) => { const [y, m, d] = dia(n).split('-').map(Number); return { y, m: m - 1, d }; };
  const irDia = async (pg, n) => { const o = dataLocal(n); await pg.evaluate(({ y, m, d }) => window.PP_AGENDA.ir(new Date(y, m, d), 'dia'), o); await pg.waitForFunction(() => S.tab === 'agenda' && document.querySelector('#view-agenda .np-grp'), null, { timeout: 8000 }); await pg.waitForTimeout(500); };
  const itensDia = (pg) => pg.evaluate(() => [...document.querySelectorAll('#view-agenda .np-grp .np-it[data-id]')].map(li => ({ id: li.dataset.id, titulo: li.querySelector('.tx')?.textContent.trim() || li.querySelector('.np-it-abrir')?.textContent.trim(), col: li.querySelector('.np-it-prazo')?.textContent.trim(), marcas: [...li.querySelectorAll('.np-marca')].map(m => m.textContent) })));
  const resumoAg = (pg) => pg.evaluate(() => [...document.querySelectorAll('#view-agenda .np-resumo > *')].map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  { const { ctx, pg, erros, escritas, leituras } = await contexto(b, { hash: '#agenda', extraLS: { 'pp-agenda-modo': 'dia', 'pp-agenda-quem': 'equipe' } });
    await pg.waitForFunction(() => document.querySelector('#view-agenda .np-grp'), null, { timeout: 10000 }); await pg.waitForTimeout(1500); // dá tempo ao carregamento sob demanda da lista do acompanhamento
    const lidas = leituras.filter(l => /v_acompanhamento_pj/.test(l)).length; if (lidas === 1) ok('lista do acompanhamento carregada 1 vez, sob demanda, pelo próprio módulo (Agenda só consome PP_ACOMP.marcos)'); else falha('leituras acomp agenda: ' + lidas);
    // dia(12): R3 PREVISTA de c1 (Alfa) + compromisso avulso "Visita à fábrica" do mesmo cliente no mesmo dia → os dois aparecem
    await irDia(pg, 12); let it = await itensDia(pg); let r = await resumoAg(pg);
    const r3 = it.find(x => /^marco:r3:c1:/.test(x.id)), vis = it.find(x => x.id === 'e-avulso-c1');
    if (r3 && r3.titulo === 'R3 — Empresa Alfa Ltda' && r3.col === 'previsto' && r3.marcas.includes('marco previsto') && vis && vis.titulo === 'Visita à fábrica' && r.some(x => /1 marco previsto/.test(x)) && r.some(x => /1 compromisso\b/.test(x))) ok('dia +12: marco "R3 — Empresa Alfa Ltda" (coluna "previsto", marca "marco previsto") E o compromisso "Visita à fábrica" do mesmo cliente — nenhum descartado; resumo: 1 compromisso + 1 marco previsto (previsão não conta como compromisso)'); else falha('dia+12: ' + JSON.stringify([it, r]));
    // painel do marco R3: situação prevista, lista o compromisso do dia, botões; "Marcar compromisso…" abre o formulário já com o cliente c1
    await pg.click(`#view-agenda .np-it[data-id="${r3.id}"] .np-it-abrir`); await esperaPainel(pg, '#view-agenda'); await pg.waitForTimeout(300); const pm = await painel(pg, '#view-agenda');
    const comp = await pg.evaluate(() => [...document.querySelectorAll('#view-agenda .np-painel .np-vinc button')].map(b => b.textContent));
    if (/Marco previsto/.test(pm.trilha) && pm.titulo === 'R3 — Empresa Alfa Ltda' && /sem horário/.test(pm.props.Quando) && pm.props.Marco === 'R3' && /não é compromisso confirmado/.test(pm.props['Situação']) && /Ana/.test(pm.props['Resp. estratégico']) && /não cria compromisso nem evento no Google/.test(pm.props.Origem) && comp.includes('Visita à fábrica') && pm.pe.includes('Abrir acompanhamento') && pm.pe.some(x => /Marcar compromisso/.test(x))) ok('painel do marco: "data prevista, sem horário", situação "prevista — não é compromisso confirmado", origem explícita, lista "Visita à fábrica" como compromisso do cliente no dia, ações Abrir acompanhamento / Marcar compromisso…'); else falha('painel marco: ' + JSON.stringify([pm, comp]));
    await pg.click('#view-agenda .np-painel button:has-text("Marcar compromisso")'); await pg.waitForTimeout(400);
    const form = await pg.evaluate(() => { const h = document.querySelector('#modalHost'); const sels = [...h.querySelectorAll('select')]; const inputs = [...h.querySelectorAll('input')]; return { aberto: !!h.children.length, cliente: sels.map(s => s.value).includes('c1'), tipo: sels.map(s => s.value).includes('reuniao'), titulo: inputs.find(i => i.type === 'text')?.value, data: inputs.find(i => i.type === 'date')?.value }; });
    if (form.aberto && form.cliente && form.tipo && form.titulo === 'R3 — Empresa Alfa Ltda' && form.data === dia(12)) ok('"Marcar compromisso…" abre o formulário EXISTENTE de compromisso com cliente c1, tipo reunião, título e data do marco pré-preenchidos (horário é escolha do usuário; nada gravado)'); else falha('form marco: ' + JSON.stringify(form));
    await pg.evaluate(() => document.querySelector('#modalHost .btn:not(.primary)')?.click()); await pg.waitForTimeout(200);
    // "Abrir acompanhamento" → painel de c1
    await pg.evaluate(() => document.querySelector('#view-agenda .np-painel button, #view-agenda .np-painel .np-btn') && [...document.querySelectorAll('#view-agenda .np-painel .np-btn')].find(b => b.textContent === 'Abrir acompanhamento').click()); await pg.waitForFunction(() => S.tab === 'acompanhamento', null, { timeout: 8000 }); await esperaPainel(pg, '#view-acompanhamento'); await pg.waitForTimeout(300);
    const pa = await painel(pg, '#view-acompanhamento'); if (pa.titulo === 'Empresa Alfa Ltda') ok('"Abrir acompanhamento" do marco → #acompanhamento com o painel de c1'); else falha('marco → acomp: ' + pa.titulo);
    // dia(-3): R2 de c1 tem a TAREFA DO CICLO "R2 — Empresa Alfa Ltda" (título gerado, mesmo cliente, núcleo, mesma data) → 1 linha (a tarefa), anotada "marco R2"; sem linha de marco duplicada
    await irDia(pg, -3); it = await itensDia(pg);
    const t1 = it.find(x => x.id === 'prazo:tarefa:t1'), dupR2 = it.find(x => /^marco:r2:c1:/.test(x.id));
    if (t1 && t1.marcas.includes('marco R2') && !dupR2 && it.filter(x => /Alfa/.test(x.titulo)).length === 1) ok('dia −3: tarefa do ciclo "R2 — Empresa Alfa Ltda" representa o marco (identificador: título gerado + cliente + núcleo + data) → uma linha só, com a marca "marco R2"'); else falha('dia-3: ' + JSON.stringify(it));
    await pg.click(`#view-agenda .np-it[data-id="prazo:tarefa:t1"] .np-it-abrir`); await esperaPainel(pg, '#view-agenda'); await esperaSecao(pg, '#view-agenda', 'Acompanhamento PJ'); const pt = await painel(pg, '#view-agenda');
    if (pt.secs.some(x => /Acompanhamento PJ · marco R2/.test(x)) && /Ciclo inicial/.test(pt.props.Fase) && pt.pe.includes('Abrir a tarefa')) ok('painel do prazo da tarefa do ciclo: bloco "Acompanhamento PJ · marco R2" (dados de c1) e a ação original "Abrir a tarefa" preservada'); else falha('painel t1 agenda: ' + JSON.stringify(pt));
    // dia(2): ONB de c2 PREVISTO + compromisso AGENDADO "Onboarding — Beta Comércio" (título diferente, sem tarefa_id) → os dois aparecem; o marco aponta o compromisso
    await irDia(pg, 2); it = await itensDia(pg);
    const onb = it.find(x => /^marco:onb:c2:/.test(x.id)), ev2 = it.find(x => x.id === 'e-onb-c2');
    if (onb && onb.titulo === 'Onboarding (ONB) — Beta Comércio ME' && ev2 && /reunião/.test(ev2.marcas.join())) ok('dia +2: marco "Onboarding (ONB) — Beta Comércio ME" (previsto) E a reunião agendada "Onboarding — Beta Comércio" (10h) — sem identificador comum, nada é fundido nem descartado'); else falha('dia+2: ' + JSON.stringify(it));
    await pg.click(`#view-agenda .np-it[data-id="${onb.id}"] .np-it-abrir`); await esperaPainel(pg, '#view-agenda'); await pg.waitForTimeout(300);
    const c2c = await pg.evaluate(() => [...document.querySelectorAll('#view-agenda .np-painel .np-vinc button')].map(b => b.textContent));
    if (c2c.includes('Onboarding — Beta Comércio')) ok('painel do marco ONB (c2) lista a reunião agendada do dia como contexto (clicável)'); else falha('c2 contexto: ' + JSON.stringify(c2c));
    // dia(5): R1 de c8 com tarefa do ciclo "R1 — Theta Agro" → só a tarefa, anotada
    await irDia(pg, 5); it = await itensDia(pg);
    const t8 = it.find(x => x.id === 'prazo:tarefa:t-r1-c8'), dupR1 = it.find(x => /^marco:r1:c8:/.test(x.id)); const dent = it.find(x => x.id === 'e-google');
    if (t8 && t8.marcas.includes('marco R1') && !dupR1 && dent) ok('dia +5: "R1 — Theta Agro" (tarefa do ciclo) anotada "marco R1", sem duplicata; evento do Google "Dentista" intacto'); else falha('dia+5: ' + JSON.stringify(it));
    // dia(10): mensal de c3 (prevista) + tarefa "Reunião mensal — Gama" (título NÃO gerado) → dois registros distintos
    await irDia(pg, 10); it = await itensDia(pg);
    const men = it.find(x => /^marco:mensal:c3:/.test(x.id)), t3 = it.find(x => x.id === 'prazo:tarefa:t3');
    if (men && men.titulo === 'Reunião mensal — Gama Indústria SA' && t3 && !t3.marcas.includes('marco Mensal')) ok('dia +10: marco "Reunião mensal — Gama Indústria SA" E a tarefa "Reunião mensal — Gama" (título parecido, não idêntico) — registros distintos preservados, sem anotação inferida'); else falha('dia+10: ' + JSON.stringify(it));
    // dia(-8): mensal de c5 prevista e não realizada → "previsto · não realizado" (atenção, não é prazo atrasado)
    await irDia(pg, -8); it = await itensDia(pg); r = await resumoAg(pg);
    const e5 = it.find(x => /^marco:mensal:c5:/.test(x.id));
    if (e5 && e5.marcas.includes('previsto · não realizado') && r.some(x => /0 atrasados/.test(x))) ok('dia −8: mensal de c5 vencida aparece como "previsto · não realizado" e NÃO entra em "atrasados" (não é prazo)'); else falha('dia-8: ' + JSON.stringify([it, r]));
    // dia(-33): ONB de c1 realizado → marca "realizada"
    await irDia(pg, -33); it = await itensDia(pg); const o1 = it.find(x => /^marco:onb:c1:/.test(x.id));
    if (o1 && o1.marcas.includes('realizada')) ok('dia −33: ONB de c1 realizado aparece como "realizada" (histórico), não como previsão'); else falha('dia-33: ' + JSON.stringify(it));
    // encerrado (c7) e sem próxima (c4): nenhum marco; semana/mês: os marcos entram na Lista e na Grade
    const nMar = await pg.evaluate(() => { const ids = []; for (const m of (window.PP_ACOMP.marcos() || [])) ids.push(m.cliente_id); return { c7: ids.includes('c7'), c4m: (window.PP_ACOMP.marcos() || []).some(m => m.cliente_id === 'c4' && m.chave === 'mensal') }; });
    if (!nMar.c7 && !nMar.c4m) ok('cliente encerrado (c7) não gera marcos; mensal sem data (c4) não gera marco'); else falha('c7/c4: ' + JSON.stringify(nMar));
    await pg.evaluate(() => { NPUI.pref.set('np-agenda-vista', 'grade'); window.PP_AGENDA.ir(null, 'semana'); }); await pg.waitForTimeout(600); await irDia(pg, 12).catch(() => {}); await pg.evaluate(() => window.PP_AGENDA.ir(null, 'semana')); await pg.waitForTimeout(600);
    const grade = await pg.evaluate(() => ({ chips: [...document.querySelectorAll('#view-agenda .ag-ev.marco')].map(c => c.textContent.trim()), legenda: document.querySelector('#view-agenda .ag-legenda')?.textContent })); 
    if (grade.chips.some(c => /R3 — Empresa Alfa/.test(c)) && /marco previsto/.test(grade.legenda)) ok('Grade (semana): marco "R3 — Empresa Alfa Ltda" como chip pontilhado de dia inteiro, legenda "marco previsto"'); else falha('grade: ' + JSON.stringify(grade));
    await pg.screenshot({ path: path.join(OUT, 'b4-agenda-grade-marco-1440.png') });
    await pg.evaluate(() => { NPUI.pref.set('np-agenda-vista', 'lista'); render(); }); await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(OUT, 'b4-agenda-lista-semana-1440.png') });
    const posts = escritas.filter(e => /agenda_eventos|functions\/v1|google/i.test(e));
    if (!escritas.length && !erros.length) ok('B4: nenhuma escrita (agenda_eventos, Google, notificações), sem erros de página'); else falha('B4 escritas/erros: ' + JSON.stringify([escritas, posts, erros]));
    await ctx.close(); }
  { // filtros de pessoa: "Minha agenda" (Ana) mostra marcos de c1 (resp. Ana) e não de c8/c2 (resp. Lucas); pessoa selecionada (Lucas) inverte
    const { ctx, pg } = await contexto(b, { hash: '#agenda', extraLS: { 'pp-agenda-modo': 'dia', 'pp-agenda-quem': 'minha' } });
    await pg.waitForFunction(() => document.querySelector('#view-agenda .np-grp'), null, { timeout: 10000 }); await pg.waitForTimeout(1200);
    await irDia(pg, 12); let it = await itensDia(pg); const minhaR3 = it.some(x => /^marco:r3:c1:/.test(x.id));
    await irDia(pg, 2); it = await itensDia(pg); const minhaOnb2 = it.some(x => /^marco:onb:c2:/.test(x.id));
    await pg.evaluate(() => { localStorage.setItem('pp-agenda-quem', 'col-luc'); location.reload(); }); await pg.waitForFunction(() => typeof PP !== 'undefined' && document.querySelector('#view-agenda .np-grp'), null, { timeout: 15000 }); await pg.waitForTimeout(1200);
    await irDia(pg, 2); it = await itensDia(pg); const lucOnb2 = it.some(x => /^marco:onb:c2:/.test(x.id)) && it.some(x => x.id === 'e-onb-c2');
    await irDia(pg, 12); it = await itensDia(pg); const lucR3 = it.some(x => /^marco:r3:c1:/.test(x.id));
    if (minhaR3 && !minhaOnb2 && lucOnb2 && !lucR3) ok('filtros preservados: "Minha agenda" (Ana) mostra o marco R3 de c1 e não o ONB de c2; pessoa "Lucas" mostra ONB de c2 (+ reunião agendada) e não R3 de c1'); else falha('quem: ' + JSON.stringify({ minhaR3, minhaOnb2, lucOnb2, lucR3 }));
    await ctx.close(); }
  { // perfil só-Jurídico: agenda sem marcos e sem leitura de v_acompanhamento_pj; V2 (casca off) sem marcos para o admin
    const { ctx, pg, leituras } = await contexto(b, { perfil: 'juridico', hash: '#agenda', extraLS: { 'pp-agenda-modo': 'semana', 'pp-agenda-quem': 'equipe' } });
    await pg.waitForFunction(() => document.querySelector('#view-agenda .np-grp'), null, { timeout: 10000 }); await pg.waitForTimeout(1000);
    const nm = await pg.evaluate(() => document.querySelectorAll('#view-agenda .np-it[data-id^="marco:"]').length + document.querySelectorAll('#view-agenda .ag-ev.marco').length);
    if (nm === 0 && leituras.filter(l => /v_acompanhamento_pj/.test(l)).length === 0) ok('perfil só-Jurídico: nenhum marco na Agenda e v_acompanhamento_pj nunca lida'); else falha('perm agenda: ' + JSON.stringify([nm, leituras.filter(l => /v_acompanhamento_pj/.test(l)).length]));
    await ctx.close();
    const v2 = await contexto(b, { casca: 'v2', hash: '#agenda', extraLS: { 'pp-agenda-modo': 'semana', 'pp-agenda-quem': 'equipe' } });
    await v2.pg.waitForFunction(() => document.querySelector('#view-agenda .ag-ev, #view-agenda .ag-grid, #view-agenda table'), null, { timeout: 10000 }).catch(() => {}); await v2.pg.waitForTimeout(800);
    const v2m = await v2.pg.evaluate(() => ({ marco: document.querySelectorAll('#view-agenda .ag-ev.marco, #view-agenda [data-id^="marco:"]').length, txt: /marco previsto/i.test(document.querySelector('#view-agenda')?.textContent || ''), v3: document.querySelector('#view-agenda')?.classList.contains('np-v3') }));
    const v2lidas = v2.leituras.filter(l => /v_acompanhamento_pj/.test(l)).length;
    if (v2m.marco === 0 && !v2m.txt && !v2m.v3 && v2lidas === 0) ok('V2 (casca desligada): Agenda sem marcos, sem texto "marco previsto" e sem leitura extra de v_acompanhamento_pj'); else falha('V2 agenda: ' + JSON.stringify([v2m, v2lidas]));
    await v2.ctx.close(); }
  // ========== 4. B5 — busca global integrada ==========
  rel.push('4. B5 — busca global: Negociações e Acompanhamento PJ (só V3.1, só com permissão)');
  const digitar = async (pg, q) => { await pg.waitForTimeout(300); /* o painel recém-aberto move o foco para o Fechar ~60 ms depois; espera antes de focar a busca */ await pg.fill('#buscaGlobal', ''); await pg.focus('#buscaGlobal'); await pg.type('#buscaGlobal', q, { delay: 20 }); await pg.waitForTimeout(350); };
  const lerBusca = (pg) => pg.evaluate(() => { const r = document.querySelector('#busca .res'); if (!r) return null; const grupos = {}; let g = null; for (const n of r.children) { if (n.classList.contains('grp-h')) { g = n.textContent; grupos[g] = []; } else if (n.classList.contains('np-busca-extra')) { for (const m of n.children) { if (m.classList.contains('grp-h')) { g = m.textContent; grupos[g] = []; } else if (g) grupos[g].push(m.firstChild?.textContent || m.textContent); } } else if (n.classList.contains('np-busca-est')) grupos._estado = n.textContent; else if (g) grupos[g].push(n.firstChild?.textContent || n.textContent); } return { grupos, proprio: r.classList.contains('np-busca-res'), tab: S.tab, hash: location.hash }; });
  { const { ctx, pg, erros, escritas, leituras } = await contexto(b, { hash: '#painel' });
    await pg.waitForTimeout(600);
    await digitar(pg, 'alfa'); let r = await lerBusca(pg);
    if (r && r.grupos.Clientes?.length === 1 && !r.grupos['Negociações'] && /Negociações: ainda não carregadas/.test(r.grupos._estado || '') && /Acompanhamento PJ: ainda não carregado/.test(r.grupos._estado || '') && r.tab === 'painel' && r.hash === '#painel') ok('"alfa": grupo Clientes do núcleo intacto; Negociações e Acompanhamento PJ ainda NÃO carregados aparecem como estado explícito com "carregar para buscar" — nenhuma consulta disparada e nenhuma mudança de rota ao digitar'); else falha('alfa 1: ' + JSON.stringify(r));
    let ln = leituras.filter(l => /v_negociacoes/.test(l)).length, la = leituras.filter(l => /v_acompanhamento_pj/.test(l)).length; if (ln === 0 && la === 0) ok('digitar não consulta v_negociacoes nem v_acompanhamento_pj'); else falha('consultas ao digitar: ' + JSON.stringify([ln, la]));
    // carregar negociações pelo botão (mecanismo do próprio módulo) → grupo aparece com as 3 negociações da Alfa (inclusive a concluída, identificada pela etapa)
    await pg.click('#busca .np-busca-est .np-busca-carregar >> nth=0'); await pg.waitForFunction(() => document.querySelector('#busca .res .np-busca-extra .grp-h') && [...document.querySelectorAll('#busca .res .grp-h')].some(h => h.textContent === 'Negociações'), null, { timeout: 8000 }); r = await lerBusca(pg);
    ln = leituras.filter(l => /v_negociacoes/.test(l)).length;
    if (r.grupos['Negociações']?.length === 3 && r.grupos['Negociações'].every(t => /Alfa/.test(t)) && ln === 1 && r.tab === 'painel' && /Acompanhamento PJ: ainda não carregado/.test(r.grupos._estado || '')) ok('"carregar para buscar" (Negociações) → 1 leitura de v_negociacoes pelo módulo; grupo "Negociações" com as 3 da Alfa (Santander, Itaú, Bradesco concluída); acompanhamento continua não carregado; rota inalterada'); else falha('alfa 2: ' + JSON.stringify([r, ln]));
    await digitar(pg, 'alfa'); await digitar(pg, 'itau'); r = await lerBusca(pg); ln = leituras.filter(l => /v_negociacoes/.test(l)).length;
    if (r.grupos['Negociações']?.length === 1 && /Itaú/.test(r.grupos['Negociações'][0]) && ln === 1) ok('"itau": só a negociação Itaú da Alfa; novas digitações não repetem a consulta (continua 1 leitura)'); else falha('itau: ' + JSON.stringify([r, ln]));
    await digitar(pg, 'mensal'); r = await lerBusca(pg);
    if (r && r.proprio && !Object.keys(r.grupos).some(k => k !== '_estado') && /Negociações: nenhum resultado/.test(r.grupos._estado) && /Acompanhamento PJ: ainda não carregado/.test(r.grupos._estado)) ok('"mensal" (nada carregado que combine): caixa própria só com os estados, porque há algo a carregar — "Negociações: nenhum resultado · Acompanhamento PJ: ainda não carregado · carregar para buscar"'); else falha('mensal estados: ' + JSON.stringify(r));
    await pg.click('#busca .np-busca-est .np-busca-carregar'); await pg.waitForFunction(() => [...document.querySelectorAll('#busca .res .grp-h')].some(h => h.textContent === 'Acompanhamento PJ'), null, { timeout: 8000 });
    r = await lerBusca(pg); la = leituras.filter(l => /v_acompanhamento_pj/.test(l)).length;
    if (r && r.grupos['Acompanhamento PJ']?.length === 3 && ['Gama Indústria SA', 'Delta Transportes', 'Épsilon Alimentos'].every(n => r.grupos['Acompanhamento PJ'].includes(n)) && la === 1) ok('"mensal" → "carregar para buscar" (Acompanhamento PJ) → 1 leitura de v_acompanhamento_pj; grupo com os 3 clientes em fase mensal (Gama, Delta, Épsilon)'); else falha('mensal: ' + JSON.stringify([r, la]));
    // abrir pelo clique → #negociacoes com o painel de n2
    await digitar(pg, 'itau'); await pg.click('#busca .res .np-busca-extra [role=option] >> nth=0'); await pg.waitForFunction(() => S.tab === 'negociacoes', null, { timeout: 8000 }); await esperaPainel(pg, '#view-negociacoes'); await pg.waitForTimeout(300);
    const pn = await painel(pg, '#view-negociacoes'); const lim = await pg.evaluate(() => ({ v: document.querySelector('#buscaGlobal').value, res: !!document.querySelector('#busca .res') }));
    if (pn.titulo === 'Alfa | Itaú | Conta garantida' && lim.v === '' && !lim.res) ok('clique no resultado → #negociacoes com o painel de n2; busca fechada e limpa'); else falha('abrir n2 busca: ' + JSON.stringify([pn.titulo, lim]));
    // caixa própria (núcleo sem resultado) + teclado: "sicoob" só existe em Negociações
    await digitar(pg, 'sicoob'); r = await lerBusca(pg);
    if (r && r.proprio && r.grupos['Negociações']?.length === 1 && /Gama/.test(r.grupos['Negociações'][0]) && !r.grupos.Clientes) ok('"sicoob" (nada no núcleo): caixa própria da V3.1 com a negociação da Gama'); else falha('sicoob: ' + JSON.stringify(r));
    await pg.keyboard.press('ArrowDown'); const sel0 = await pg.evaluate(() => document.querySelector('#busca .res [role=option][aria-selected="true"]')?.textContent); await pg.keyboard.press('Enter'); await pg.waitForFunction(() => S.tab === 'negociacoes' && document.querySelector('#view-negociacoes .np-painel h2')?.textContent.startsWith('Gama'), null, { timeout: 8000 });
    if (/Gama/.test(sel0 || '')) ok('teclado na caixa própria: ↓ seleciona, Enter abre a negociação da Gama (n4) — identidade preservada'); else falha('teclado busca: ' + sel0);
    // acompanhamento: carregar e buscar por fase/cliente
    await digitar(pg, 'gama'); r = await lerBusca(pg);
    if (r && r.grupos.Clientes?.length === 1 && r.grupos['Negociações']?.length === 1 && r.grupos['Acompanhamento PJ']?.length === 1 && r.grupos['Acompanhamento PJ'][0] === 'Gama Indústria SA' && !r.grupos._estado) ok('"gama": Clientes (núcleo) + Negociações + Acompanhamento PJ no mesmo listbox, sem linha de estado (tudo carregado e com resultado)'); else falha('gama: ' + JSON.stringify([r, await pg.evaluate(() => ({ val: document.querySelector('#buscaGlobal').value, foco: document.activeElement.id || document.activeElement.className, html: document.querySelector('#busca').innerHTML.length, tab: S.tab, casca: document.documentElement.className }))]));
    await pg.click('#busca .res .np-busca-extra [role=option] >> nth=-1'); await pg.waitForFunction(() => S.tab === 'acompanhamento', null, { timeout: 8000 }); await esperaPainel(pg, '#view-acompanhamento'); await pg.waitForTimeout(300); const pa = await painel(pg, '#view-acompanhamento');
    if (pa.titulo === 'Gama Indústria SA') ok('resultado de Acompanhamento PJ → #acompanhamento com o painel de c3 (Gama)'); else falha('abrir c3 busca: ' + pa.titulo);
    await digitar(pg, 'zeta'); r = await lerBusca(pg);
    if (r && r.grupos.Clientes?.length === 1 && /Negociações: nenhum resultado/.test(r.grupos._estado || '') && /Acompanhamento PJ: nenhum resultado/.test(r.grupos._estado || '')) ok('"zeta" (cliente sem negociações nem acompanhamento): "nenhum resultado" explícito nos dois grupos — distinto de "não carregado"'); else falha('zeta: ' + JSON.stringify(r));
    await digitar(pg, 'qwxz'); r = await lerBusca(pg);
    if (r === null) ok('"qwxz": nada em lugar nenhum → nenhuma caixa aberta (estados não abrem caixa sozinhos)'); else falha('qwxz: ' + JSON.stringify(r));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    ln = leituras.filter(l => /v_negociacoes/.test(l)).length; la = leituras.filter(l => /v_acompanhamento_pj/.test(l)).length;
    if (ln === 1 && la === 1 && !escritas.length && !erros.length) ok('B5: ao todo 1 leitura de cada lista, nenhuma escrita, sem erros'); else falha('B5 total: ' + JSON.stringify([ln, la, escritas, erros]));
    await digitar(pg, 'gama'); await pg.screenshot({ path: path.join(OUT, 'b5-busca-1440.png') }); await ctx.close(); }
  { // erro ao carregar → "indisponíveis"; permissões; V2 intacta
    const { ctx, pg } = await contexto(b, { hash: '#painel', negErro: true }); await pg.waitForTimeout(400);
    await digitar(pg, 'alfa'); await pg.click('#busca .np-busca-est .np-busca-carregar >> nth=0'); await pg.waitForFunction(() => /Negociações: indisponíveis/.test(document.querySelector('#busca .res .np-busca-est')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const e1 = await lerBusca(pg); if (e1 && /Negociações: indisponíveis/.test(e1.grupos._estado || '')) ok('erro na view de negociações: estado "Negociações: indisponíveis" (≠ não carregado ≠ nenhum resultado)'); else falha('erro busca: ' + JSON.stringify(e1));
    await ctx.close();
    const pc = await contexto(b, { perfil: 'clientes', hash: '#painel' }); await pc.pg.waitForTimeout(400); await digitar(pc.pg, 'alfa'); const rc = await lerBusca(pc.pg);
    if (rc && !/Negociações/.test(rc.grupos._estado || '') && !rc.grupos['Negociações'] && /Acompanhamento PJ/.test(rc.grupos._estado || '')) ok('perfil só-Clientes: nenhum grupo/estado de Negociações na busca; Acompanhamento PJ presente'); else falha('perm busca clientes: ' + JSON.stringify(rc));
    await pc.ctx.close();
    const pj = await contexto(b, { perfil: 'juridico', hash: '#painel' }); await pj.pg.waitForTimeout(400); await digitar(pj.pg, 'alfa'); const rj = await lerBusca(pj.pg);
    if (rj && !/Acompanhamento PJ/.test(rj.grupos._estado || '') && !rj.grupos['Acompanhamento PJ'] && /Negociações/.test(rj.grupos._estado || '')) ok('perfil só-Jurídico: nenhum grupo/estado de Acompanhamento PJ; Negociações presente'); else falha('perm busca juridico: ' + JSON.stringify(rj));
    await pj.ctx.close();
    const v2 = await contexto(b, { casca: 'v2', hash: '#painel' }); await v2.pg.waitForTimeout(400); await digitar(v2.pg, 'alfa'); const r2 = await v2.pg.evaluate(() => ({ cls: document.querySelectorAll('#busca .res .grp-h').length, extra: document.querySelectorAll('#busca .np-busca-extra, #busca .np-busca-est').length, txt: document.querySelector('#busca .res')?.textContent }));
    if (r2.cls === 1 && r2.extra === 0 && /Empresa Alfa/.test(r2.txt || '') && !/Negocia|Acompanhamento/.test(r2.txt || '')) ok('V2 (casca desligada): busca igual à de antes — só o grupo Clientes, nenhum grupo/estado novo'); else falha('V2 busca: ' + JSON.stringify(r2));
    await v2.ctx.close(); }
  // ========== 5. A4 — aba Acompanhamento PJ da ficha (V3.1) = blocos da visão transversal ==========
  rel.push('5. A4 — aba Acompanhamento PJ da ficha: paridade com a visão transversal');
  const lerAba = (pg) => pg.evaluate(() => { const host = document.querySelector('#view-clientes'); const props = {}; host.querySelectorAll('.np-v3-aba .np-props dt').forEach(dt => props[dt.textContent.trim()] = dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim()); return { props, secs: [...host.querySelectorAll('.np-v3-aba .np-sec h3')].map(h => h.textContent), acoes: [...host.querySelectorAll('.np-v3-aba-acoes .np-btn')].map(b => b.textContent.trim()), dividas: host.querySelectorAll('.np-v3-aba .np-tab tbody tr').length, atas: [...host.querySelectorAll('.np-v3-aba .np-sec')].find(s => s.querySelector('h3')?.textContent === 'Atas')?.querySelectorAll('li, .np-passo').length, pend: [...host.querySelectorAll('.np-v3-aba .np-sec')].find(s => /Pendências/.test(s.querySelector('h3')?.textContent))?.querySelectorAll('button.lnk').length, cardsV2: [...host.querySelectorAll('section h2')].map(h => h.textContent), raioXForm: !!host.querySelector('.np-v3-aba') && [...host.querySelectorAll('section h2, .card h2, .card h3')].some(h => /Raio-X/i.test(h.textContent)) }; });
  const abrirAba = async (pg, cid) => { await pg.evaluate((cid) => { S.tab = 'clientes'; S.sel = cid; S.sub = 'acompanhamento'; try { localStorage.setItem('pp-tab', 'clientes'); } catch (_) {} render(); }, cid); await pg.waitForFunction(() => document.querySelector('#view-clientes .np-v3-aba .np-sec h3') && !document.querySelector('#view-clientes .np-v3-aba .np-skel'), null, { timeout: 12000 }); await pg.waitForTimeout(300); };
  { const { ctx, pg, erros, escritas } = await contexto(b, { hash: '#acompanhamento' });
    await pg.waitForFunction(() => document.querySelectorAll('#view-acompanhamento li.np-it[data-id]').length >= 5, null, { timeout: 12000 });
    await abrirAcomp(pg, 'c1'); const pt = await painel(pg, '#view-acompanhamento');
    const ptx = await pg.evaluate(() => ({ dividas: document.querySelectorAll('#view-acompanhamento .np-painel .np-tab tbody tr').length, atas: [...document.querySelectorAll('#view-acompanhamento .np-painel .np-sec')].find(s => s.querySelector('h3')?.textContent === 'Atas')?.querySelectorAll('li, .np-passo').length }));
    await abrirAba(pg, 'c1'); const ab = await lerAba(pg);
    const iguais = ['Fase', 'Próxima reunião', 'Responsável', 'Acordos', 'Reserva', 'Direcionamento'].every(k => ab.props[k] === pt.props[k]);
    if (iguais && ab.secs.includes('Ciclo de acompanhamento') && ab.secs.includes('Raio-X · dívidas') && ab.secs.includes('Atas') && ab.dividas === 2 && ab.dividas === ptx.dividas && ab.atas === 2 && ab.atas === ptx.atas && ab.pend === 2 && !ab.cardsV2.includes('Status do acompanhamento')) ok('aba da ficha (c1, V3.1): Fase/Próxima reunião/Responsável/Acordos/Reserva/Direcionamento idênticos ao painel transversal; Raio-X com 2 dívidas, 2 atas e 2 pendências — sem os cards V2'); else falha('paridade aba: ' + JSON.stringify([ab, pt.props, ptx]));
    if (ab.acoes.includes('Registrar ata') && ab.acoes.some(a => /Atualizar ciclo/.test(a)) && ab.acoes.includes('Criar tarefas do ciclo') && ab.acoes.some(a => /Incluir dívida/.test(a)) && ab.acoes.includes('Ver na carteira')) ok('aba: as mesmas ações do painel (Registrar ata, Atualizar ciclo, Criar tarefas do ciclo, Incluir dívida no Raio-X) + "Ver na carteira"'); else falha('ações aba: ' + JSON.stringify(ab.acoes));
    // gravações existentes com o cliente correto: o formulário de ata abre para c1 (título/contexto) — e nada é gravado
    await pg.click('#view-clientes .np-v3-aba-acoes .np-btn:has-text("Registrar ata")'); await pg.waitForTimeout(400);
    // gravação pela MESMA função (formAta): o stub captura o INSERT e confere o cliente_id — fixture, nada sai da máquina
    const fa = await pg.evaluate(() => ({ t: document.querySelector('#modalHost h2, #modalHost h3')?.textContent, campos: document.querySelectorAll('#modalHost textarea').length }));
    await pg.fill('#modalHost textarea', 'Ata de teste do laboratório (fixture).'); const n0 = escritas.length; await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(700);
    const grav = escritas.slice(n0).filter(e => /atas_reuniao/.test(e));
    if (fa.t === 'Registrar ata' && grav.length === 1 && /"cliente_id":"c1"/.test(grav[0]) && /POST/.test(grav[0])) ok('"Registrar ata" na aba usa o formAta existente e grava com cliente_id = c1 (INSERT capturado pelo stub; 1 escrita)'); else falha('formAta aba: ' + JSON.stringify([fa, grav]));
    await pg.evaluate(() => document.querySelector('#modalHost')?.replaceChildren()); await pg.waitForTimeout(200);
    // troca de cliente na ficha: c3 → dados de c3 (não de c1)
    await abrirAba(pg, 'c3'); const a3 = await lerAba(pg);
    if (/Acompanhamento mensal/.test(a3.props.Fase) && /mensal/i.test(a3.props['Próxima reunião']) && a3.dividas === 1 && (a3.atas || 0) === 0 && a3.pend === 1) ok('troca para c3 na ficha: fase mensal, próxima Mensal, 1 dívida (Sicoob), 0 atas, 1 pendência — identidade preservada'); else falha('aba c3: ' + JSON.stringify(a3));
    await pg.click('#view-clientes .np-v3-aba-acoes .np-btn:has-text("Incluir dívida")'); await pg.waitForTimeout(400);
    await pg.fill('#modalHost input[type=text] >> nth=0', 'Banco Fixture'); await pg.fill('#modalHost input[type=number] >> nth=0', '1000'); const n1 = escritas.length; await pg.click('#modalHost .btn.primary'); await pg.waitForTimeout(700);
    const gd = escritas.slice(n1).filter(e => /dividas_raio_x/.test(e));
    if (gd.length === 1 && /"cliente_id":"c3"/.test(gd[0]) && !/"cliente_id":"c1"/.test(gd[0])) ok('"Incluir dívida" com c3 aberto (depois de c1) grava com cliente_id = c3 — a troca de contexto não grava no cliente anterior'); else falha('formDivida c3: ' + JSON.stringify(gd));
    await pg.evaluate(() => document.querySelector('#modalHost')?.replaceChildren()); await pg.waitForTimeout(200);
    // "Ver na carteira" → #acompanhamento com o painel de c3
    await pg.click('#view-clientes .np-v3-aba-acoes .np-btn:has-text("Ver na carteira")'); await pg.waitForFunction(() => S.tab === 'acompanhamento', null, { timeout: 8000 }); await esperaPainel(pg, '#view-acompanhamento'); await pg.waitForTimeout(300);
    const pv = await painel(pg, '#view-acompanhamento'); if (pv.titulo === 'Gama Indústria SA') ok('"Ver na carteira" → #acompanhamento com o painel de c3'); else falha('ver na carteira: ' + pv.titulo);
    // cliente sem acompanhamento (c6): aba mostra "não iniciado" + "Definir datas"
    await abrirAba(pg, 'c6'); const a6 = await lerAba(pg);
    if (/não iniciado/.test(a6.props.Fase) && a6.acoes.includes('Definir datas')) ok('c6 (sem acompanhamento): "acompanhamento não iniciado" e ação "Definir datas"'); else falha('aba c6: ' + JSON.stringify(a6));
    const outras = escritas.filter(e => !/atas_reuniao|dividas_raio_x/.test(e));
    if (!outras.length && escritas.length === 2 && !erros.length) ok('A4: só as 2 escritas provocadas de propósito (ata c1, dívida c3) — nenhuma outra; sem erros de página'); else falha('A4 escritas/erros: ' + JSON.stringify([escritas, erros]));
    await abrirAba(pg, 'c1'); await pg.screenshot({ path: path.join(OUT, 'a4-ficha-aba-1440.png'), fullPage: true }); await ctx.close(); }
  { // 375 px e V2
    const { ctx, pg, erros } = await contexto(b, { hash: '#clientes', w: 375, h: 760 });
    await abrirAba(pg, 'c1'); const m = await pg.evaluate(() => { const w = window.innerWidth; const larg = [...document.querySelectorAll('#view-clientes .np-v3-aba, #view-clientes .np-v3-aba *')].filter(e => !e.closest('.np-tab-w') && e.getBoundingClientRect().right > w + 1).map(e => e.className + ':' + Math.round(e.getBoundingClientRect().right)); const tabW = document.querySelector('#view-clientes .np-v3-aba .np-tab-w'); const fora = [...document.querySelectorAll('#view-clientes *')].filter(e => !e.closest('.np-v3-aba') && !e.closest('.np-tab-w') && e.offsetParent && e.getBoundingClientRect().right > w + 1).map(e => e.tagName + '.' + e.className.split(' ')[0] + ' [' + e.textContent.trim().slice(0, 24) + ']'); return { overflow: larg.length > 0, larg: larg.slice(0, 5), tabelaRola: (() => { let e = document.querySelector('#view-clientes .np-v3-aba .np-tab')?.parentElement; while (e && !e.classList.contains('np-v3-aba')) { if (/auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth && e.getBoundingClientRect().right <= w + 1) return true; e = e.parentElement; } return false; })(), fora: fora.slice(0, 3), acoes: document.querySelectorAll('#view-clientes .np-v3-aba-acoes .np-btn').length }; });
    const alvos = await pg.evaluate(() => [...document.querySelectorAll('#view-clientes .np-v3-aba-acoes .np-btn')].map(b => b.getBoundingClientRect().height).filter(h => h > 0));
    if (!m.overflow && m.tabelaRola && m.acoes >= 4 && alvos.every(h => h >= 36) && !erros.length) ok(`375 px: blocos da aba dentro da tela, tabela do Raio-X rola dentro do próprio contêiner, ${m.acoes} ações com alvos de ${Math.min(...alvos)} px${m.fora.length ? ' — fora da aba (pré-existente na ficha V2): ' + m.fora.join('; ') : ''}`); else falha('375 aba: ' + JSON.stringify([m, alvos, erros]));
    await pg.screenshot({ path: path.join(OUT, 'a4-ficha-aba-375.png'), fullPage: true }); await ctx.close();
    const v2 = await contexto(b, { casca: 'v2', hash: '#clientes' }); await v2.pg.evaluate(() => { S.tab = 'clientes'; S.sel = 'c1'; S.sub = 'acompanhamento'; render(); }); await v2.pg.waitForTimeout(1000);
    const r2 = await v2.pg.evaluate(() => ({ h2: [...document.querySelectorAll('#view-clientes section h2')].map(h => h.textContent), v3: document.querySelectorAll('#view-clientes .np-v3-aba').length, barra: document.querySelectorAll('#view-clientes .ciclo-barra .ciclo-passo').length }));
    if (r2.h2.includes('Status do acompanhamento') && r2.h2.includes('Dívidas (ponto de partida)') && r2.h2.includes('Atas das reuniões') && r2.v3 === 0 && r2.barra === 5) ok('V2 (casca desligada): aba da ficha exatamente como antes (Status do acompanhamento com 5 passos, Dívidas, Atas; nenhum bloco V3.1)'); else falha('V2 aba: ' + JSON.stringify(r2));
    await v2.ctx.close(); }
  await b.close(); srv.close();
  const txt = rel.join('\n') + '\n' + (falhas ? `${falhas} falha(s).` : 'Tudo certo.') + '\n'; fs.writeFileSync(path.join(OUT, 'relatorio-integracoes-lab.txt'), txt); console.log(txt); process.exit(falhas ? 1 : 0);
})().catch(e => { console.log(rel.join('\n')); console.error(e); process.exit(2); });
