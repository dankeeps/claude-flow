// Hubla: vendas, reembolsos, disputas e chargebacks pela API pública (só leitura).
// Docs: https://hubla.gitbook.io/docs/api-publica · Swagger: https://backend-bff-public-api.platform.hub.la/swagger/v1
// Chave em HUBLA_API_TOKEN (Conectores → Hubla no Claude Flow), mandada crua no header Authorization.
//
//   node hubla.mjs resumo [--horas 24]        o check diário: vendas pagas no período + reembolsos, disputas e
//                                             chargebacks NOVOS desde o último resumo + pedidos de reembolso abertos
//   node hubla.mjs vendas [--horas 24]        só as vendas pagas no período
//   node hubla.mjs problemas [--dias 30]      faturas reembolsadas, em disputa (in_protest) ou chargeback nos últimos N dias
//   node hubla.mjs pedidos                    pedidos de reembolso abertos (created, pending, processing)
// O "desde o último resumo" fica em $FLOW_TRABALHO/hubla/estado.json.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://backend-bff-public-api.platform.hub.la';
const TOKEN = process.env.HUBLA_API_TOKEN;
const ESTADO = path.join(process.env.FLOW_TRABALHO || path.join(process.cwd(), 'trabalho'), 'hubla', 'estado.json');

function args(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[argv[i].slice(2)] = true; else { o[argv[i].slice(2)] = v; i++; } }
    else pos.push(argv[i]);
  }
  return { pos, o };
}

async function api(caminho, corpo, tentativa = 0) {
  if (!TOKEN) throw new Error('falta o token da Hubla: Conectores → Hubla no Claude Flow (HUBLA_API_TOKEN)');
  const r = await fetch(BASE + caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: TOKEN, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (r.status === 429 && tentativa < 3) {
    const s = Number(r.headers.get('retry-after')) || 5;
    await new Promise((ok) => setTimeout(ok, s * 1000 + 500));
    return api(caminho, corpo, tentativa + 1);
  }
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (r.status < 200 || r.status > 299) {
    const dica = r.status === 401 ? ' — token inválido ou revogado' : '';
    throw new Error(`Hubla ${caminho}: HTTP ${r.status}${dica} ${typeof j === 'string' ? j.slice(0, 200) : JSON.stringify(j).slice(0, 300)}`);
  }
  return j;
}

// lista paginada (POST com filtros), até `max` itens
async function listar(caminho, filtros, max = 2000) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await api(caminho, { filters: filtros, pagination: { page, pageSize: 200 } });
    out.push(...(r.items || []));
    const pg = r.pagination || {};
    if (!r.items?.length || page >= (pg.lastPage || 1) || out.length >= max) break;
  }
  return out;
}

const reais = (c) => (c === null || c === undefined ? null : Math.round(c) / 100);
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : null);
function fatura(f) {
  return {
    id: f.id, status: f.status, produto: (f.items || []).map((i) => i.name).join(', '),
    valor: reais(f.amount?.totalCents), metodo: f.paymentMethod, parcelas: f.installments,
    comprador: f.payer ? `${f.payer.name || ''} <${f.payer.email || ''}>`.trim() : null,
    pago_em: quando(f.paidAt), reembolso_em: quando(f.refundedAt), disputa_em: quando(f.disputedAt), chargeback_em: quando(f.chargebackAt),
    utm: f.firstPaymentSession?.utm?.campaign || f.firstPaymentSession?.utm?.source || null,
  };
}
// quando o problema aconteceu (para saber se é novo)
const dataProblema = (f) => new Date(f.chargebackAt || f.disputedAt || f.refundedAt || f.modifiedAt || f.createdAt).getTime();

async function vendas(horas) {
  const fim = new Date(), ini = new Date(Date.now() - horas * 3600000);
  const l = await listar('/v1/invoices/list', { status: ['paid'], dateRangeBy: 'paidAt', dateStart: ini.toISOString(), dateEnd: fim.toISOString(), orderBy: 'paidAt', orderDir: 'DESC' });
  const total = l.reduce((a, f) => a + (f.amount?.totalCents || 0), 0);
  return { periodo: `${quando(ini)} a ${quando(fim)}`, quantidade: l.length, total: reais(total), vendas: l.slice(0, 50).map(fatura) };
}

async function problemas(dias) {
  const ini = new Date(Date.now() - dias * 86400000);
  // o filtro de data é pela criação da fatura: janela larga e ordem decrescente; o que conta é a data do problema
  const l = await listar('/v1/invoices/list', { status: ['refunded', 'in_protest', 'chargeback'], dateRangeBy: 'createdAt', dateStart: new Date(Date.now() - Math.max(dias, 120) * 86400000).toISOString(), dateEnd: new Date().toISOString(), orderDir: 'DESC' });
  return l.filter((f) => dataProblema(f) >= ini.getTime()).sort((a, b) => dataProblema(b) - dataProblema(a));
}

async function pedidos() {
  const out = [];
  for (const status of ['created', 'pending', 'processing']) {
    for (const p of await listar('/v1/refunds/list', { status }, 500)) out.push(p);
  }
  return out.map((p) => ({ id: p.id, fatura: p.invoiceId, status: p.status, valor: reais(p.amount), quem: p.requester ? `${p.requester.name || ''} <${p.requester.email || ''}>` : null,
    motivo: p.description || null, pedido_em: quando(p.createdAt), automatico: p.isAutoAccepted ?? null }));
}

async function resumo(horas) {
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  let est = {}; try { est = JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch {}
  const desde = est.ultimo || Date.now() - horas * 3600000;
  const [v, probs, peds] = [await vendas(horas), await problemas(45), await pedidos()];
  const novos = probs.filter((f) => dataProblema(f) > desde);
  const tipo = (f) => (f.status === 'chargeback' ? 'chargeback' : f.status === 'in_protest' ? 'disputa' : 'reembolso');
  const r = {
    desde: quando(desde),
    vendas: { quantidade: v.quantidade, total: v.total, periodo: v.periodo },
    novos: {
      reembolsos: novos.filter((f) => tipo(f) === 'reembolso').map(fatura),
      disputas: novos.filter((f) => tipo(f) === 'disputa').map(fatura),
      chargebacks: novos.filter((f) => tipo(f) === 'chargeback').map(fatura),
    },
    pedidos_de_reembolso_abertos: peds,
    em_disputa_agora: probs.filter((f) => f.status === 'in_protest').length,
  };
  r.alerta = r.novos.reembolsos.length + r.novos.disputas.length + r.novos.chargebacks.length + peds.length > 0;
  est.ultimo = Date.now();
  fs.writeFileSync(ESTADO, JSON.stringify(est));
  return r;
}

const { pos, o } = args(process.argv.slice(2));
try {
  const cmd = pos[0];
  const horas = Number(o.horas || 24);
  const out = cmd === 'resumo' ? await resumo(horas) : cmd === 'vendas' ? await vendas(horas)
    : cmd === 'problemas' ? (await problemas(Number(o.dias || 30))).map(fatura) : cmd === 'pedidos' ? await pedidos() : null;
  if (out === null) { console.error('comandos: resumo | vendas | problemas | pedidos (veja o começo do arquivo)'); process.exit(2); }
  console.log(JSON.stringify(out, null, 1));
} catch (e) {
  console.error('erro: ' + e.message);
  process.exit(1);
}
