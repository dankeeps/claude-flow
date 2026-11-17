// Dados de cada squad que aparecem na sala (fora o kanban, que fica no banco):
//   spy.json         bibliotecas monitoradas (aba Spy) e a blacklist (anunciantes que nunca mais aparecem no spy)
//   relevantes.json  itens relevantes (relatórios e avisos que os bots publicam para o usuário olhar)
// Ficam em ~/ClaudeFlow/squads/<squad>/. Os bots mexem pelas ferramentas mcp__flow__spy_* e relevante_criar; o
// coletor da skill spy-ads lê o spy.json (variável FLOW_SPY) para pular a blacklist e conferir as monitoradas.
import path from 'node:path';
import crypto from 'node:crypto';
import { lerJSON, gravarJSON } from './config.js';
import { dirSquad } from './store.js';

const arqSpy = (sq) => path.join(dirSquad(sq), 'spy.json');
const arqRel = (sq) => path.join(dirSquad(sq), 'relevantes.json');
export const caminhoSpy = arqSpy;

const TIPOS = ['vsl', 'quiz', 'quiz+vsl'];
export function normalTipo(t) {
  const s = String(t || '').toLowerCase().replace(/\s+/g, '');
  if (/quiz/.test(s) && /vsl|v[ií]deo/.test(s)) return 'quiz+vsl';
  if (/quiz/.test(s)) return 'quiz';
  if (/vsl|v[ií]deo/.test(s)) return 'vsl';
  return TIPOS.includes(s) ? s : '';
}
const pid = (x) => String(x ?? '').trim();
const linkBiblioteca = (page_id, pais = 'BR') => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${pais}&media_type=video&search_type=page&view_all_page_id=${page_id}`;

// ---------- spy ----------
export function spy(sq) {
  const d = lerJSON(arqSpy(sq), {});
  return { monitoradas: d.monitoradas || [], blacklist: d.blacklist || [] };
}
const gravarSpy = (sq, d) => gravarJSON(arqSpy(sq), d);

export function monitorar(sq, x, { por = 'usuario' } = {}) {
  const id = pid(x.page_id);
  if (!id) throw Object.assign(new Error('falta o page_id da biblioteca'), { status: 400 });
  const d = spy(sq);
  if (d.blacklist.some((b) => b.page_id === id)) throw Object.assign(new Error(`${x.pagina || id} está na blacklist: tire de lá antes de monitorar`), { status: 400 });
  let m = d.monitoradas.find((y) => y.page_id === id);
  if (!m) { m = { page_id: id, adicionado: Date.now(), por, ativa: true, historico: [] }; d.monitoradas.push(m); }
  if (x.pagina) m.pagina = String(x.pagina).slice(0, 120);
  if (x.nicho) m.nicho = String(x.nicho).slice(0, 60);
  if (x.tipo) m.tipo = normalTipo(x.tipo) || m.tipo || '';
  if (x.destino) m.destino = String(x.destino).slice(0, 500);
  m.biblioteca = x.biblioteca || m.biblioteca || linkBiblioteca(id);
  if (x.ativos !== undefined && x.ativos !== null) registrar(m, Number(x.ativos));
  gravarSpy(sq, d);
  return m;
}

function registrar(m, ativos) {
  if (!Number.isFinite(ativos)) return;
  const dia = new Date().toISOString().slice(0, 10);
  m.historico = (m.historico || []).filter((h) => h.data !== dia);
  m.historico.push({ data: dia, ativos });
  m.historico = m.historico.slice(-120);
  m.ativos = ativos;
  m.conferido = Date.now();
}

// resultado de uma conferência (monitoramento): [{page_id, ativos}]
export function conferencias(sq, itens = []) {
  const d = spy(sq);
  const out = [];
  for (const it of itens) {
    const m = d.monitoradas.find((y) => y.page_id === pid(it.page_id));
    if (!m) continue;
    const antes = m.ativos ?? null;
    registrar(m, Number(it.ativos));
    out.push({ pagina: m.pagina, page_id: m.page_id, ativos: m.ativos, antes, variacao: antes === null ? null : m.ativos - antes });
  }
  gravarSpy(sq, d);
  return out;
}

export function alterarMonitorada(sq, id, campos) {
  const d = spy(sq);
  const m = d.monitoradas.find((y) => y.page_id === pid(id));
  if (!m) throw Object.assign(new Error('biblioteca não encontrada'), { status: 404 });
  if (campos.ativa !== undefined) m.ativa = !!campos.ativa;
  if (campos.tipo !== undefined) m.tipo = normalTipo(campos.tipo);
  if (campos.nicho !== undefined) m.nicho = String(campos.nicho).slice(0, 60);
  gravarSpy(sq, d);
  return m;
}

export function removerMonitorada(sq, id) {
  const d = spy(sq);
  d.monitoradas = d.monitoradas.filter((y) => y.page_id !== pid(id));
  gravarSpy(sq, d);
}

export function blacklistAdicionar(sq, x, { por = 'usuario' } = {}) {
  const id = pid(x.page_id);
  if (!id && !x.pagina) throw Object.assign(new Error('falta o page_id ou o nome da página'), { status: 400 });
  const d = spy(sq);
  if (!d.blacklist.some((b) => (id && b.page_id === id) || (!id && b.pagina === x.pagina))) {
    d.blacklist.push({ page_id: id, pagina: String(x.pagina || '').slice(0, 120), motivo: String(x.motivo || '').slice(0, 200), adicionado: Date.now(), por });
  }
  if (id) d.monitoradas = d.monitoradas.filter((y) => y.page_id !== id); // na blacklist não se monitora
  gravarSpy(sq, d);
  return d.blacklist;
}

export function blacklistRemover(sq, id) {
  const d = spy(sq);
  d.blacklist = d.blacklist.filter((b) => b.page_id !== pid(id) && b.pagina !== id);
  gravarSpy(sq, d);
}

// ---------- itens relevantes ----------
export const relevantes = (sq) => lerJSON(arqRel(sq), []);

export function relevanteCriar(sq, { titulo, texto, bot = null, tipo = '' }) {
  const t = String(titulo || '').trim().slice(0, 160);
  if (!t) throw Object.assign(new Error('dê um título ao item'), { status: 400 });
  const l = relevantes(sq);
  const item = { id: crypto.randomBytes(5).toString('hex'), titulo: t, texto: String(texto || '').slice(0, 20000), bot, tipo: String(tipo || '').slice(0, 40), criado: Date.now(), visto: false, arquivado: false };
  l.unshift(item);
  gravarJSON(arqRel(sq), l.slice(0, 500));
  return item;
}

export function relevanteAlterar(sq, id, campos) {
  const l = relevantes(sq);
  const it = l.find((x) => x.id === id);
  if (!it) throw Object.assign(new Error('item não encontrado'), { status: 404 });
  if (campos.visto !== undefined) it.visto = !!campos.visto;
  if (campos.arquivado !== undefined) it.arquivado = !!campos.arquivado;
  gravarJSON(arqRel(sq), l);
  return it;
}
