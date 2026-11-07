// Rotinas: uma instrução salva para um bot, que roda sozinha num horário (todo dia, em dias da semana, a cada X horas)
// ou quando alguém chama o link de disparo (webhook). Ficam em ~/ClaudeFlow/rotinas.json.
// O disparo só coloca a instrução na fila do bot, como uma mensagem; o resto (fila pesada, notificação) é o normal.
import crypto from 'node:crypto';
import path from 'node:path';
import { HOME, lerJSON, gravarJSON } from './config.js';
import { bots } from './store.js';
import * as runner from './runner.js';
import { emitir } from './eventos.js';

const ARQ = path.join(HOME, 'rotinas.json');
let lista = lerJSON(ARQ, []);
const salvar = () => { gravarJSON(ARQ, lista); emitir('rotinas', {}); };

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// quando: { tipo: 'diario' | 'semanal' | 'intervalo' | 'manual', hora: 'HH:MM', dias: [0..6], horas: N }
function limparQuando(q = {}) {
  const tipo = ['diario', 'semanal', 'intervalo', 'manual'].includes(q.tipo) ? q.tipo : 'diario';
  const hora = /^([01]?\d|2[0-3]):[0-5]\d$/.test(q.hora || '') ? q.hora.padStart(5, '0') : '09:00';
  const dias = [...new Set((q.dias || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  const horas = Math.min(168, Math.max(1, Number(q.horas) || 24));
  return { tipo, hora, dias: tipo === 'semanal' ? (dias.length ? dias : [1]) : [], horas };
}

export function descrever(q) {
  if (q.tipo === 'manual') return 'Só quando disparada';
  if (q.tipo === 'intervalo') return q.horas === 1 ? 'A cada hora' : `A cada ${q.horas} horas`;
  if (q.tipo === 'semanal') {
    const d = q.dias.length === 5 && q.dias.join() === '1,2,3,4,5' ? 'Dias úteis' : q.dias.map((x) => DIAS[x]).join(', ');
    return `${d} às ${q.hora}`;
  }
  return `Todo dia às ${q.hora}`;
}

// Próxima vez depois de "desde".
export function proxima(q, desde = Date.now(), ultima = 0) {
  if (q.tipo === 'manual') return null;
  if (q.tipo === 'intervalo') return Math.max(desde, (ultima || desde) + q.horas * 3600e3);
  const [hh, mm] = q.hora.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(desde);
    d.setDate(d.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= desde) continue;
    if (q.tipo === 'semanal' && !q.dias.includes(d.getDay())) continue;
    return d.getTime();
  }
  return null;
}

const publica = (r) => ({ ...r, descricao: descrever(r.quando), botNome: bots.get(r.bot)?.nome || r.bot });
export const listar = (botId = null) => lista.filter((r) => !botId || r.bot === botId).map(publica);
export const pegar = (id) => lista.find((r) => r.id === id) || null;

export function criar({ bot, nome, instrucao, quando, ativa = true }) {
  if (!bots.get(bot)) throw new Error('bot não encontrado');
  if (!String(nome || '').trim()) throw new Error('Dê um nome à rotina.');
  if (!String(instrucao || '').trim()) throw new Error('Escreva a instrução da rotina.');
  const q = limparQuando(quando);
  const r = {
    id: crypto.randomBytes(5).toString('hex'), bot, nome: String(nome).trim().slice(0, 80), instrucao: String(instrucao).trim().slice(0, 8000),
    quando: q, ativa: !!ativa, criado: Date.now(), ultima: 0, ultimaOrigem: null, proxima: proxima(q), gatilho: crypto.randomBytes(16).toString('hex'),
  };
  lista.push(r);
  salvar();
  return publica(r);
}

export function editar(id, campos = {}) {
  const r = pegar(id);
  if (!r) throw new Error('rotina não encontrada');
  if (campos.nome !== undefined) r.nome = String(campos.nome).trim().slice(0, 80) || r.nome;
  if (campos.instrucao !== undefined) r.instrucao = String(campos.instrucao).trim().slice(0, 8000) || r.instrucao;
  if (campos.quando) r.quando = limparQuando(campos.quando);
  if (campos.ativa !== undefined) r.ativa = !!campos.ativa;
  r.proxima = proxima(r.quando, Date.now(), r.ultima);
  salvar();
  return publica(r);
}

export function remover(id) {
  const i = lista.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('rotina não encontrada');
  lista.splice(i, 1);
  salvar();
}

export function disparar(id, { origem = 'manual', dados = null } = {}) {
  const r = pegar(id);
  if (!r) throw new Error('rotina não encontrada');
  const bot = bots.get(r.bot);
  if (!bot) throw new Error('o bot desta rotina não existe mais');
  // a mesma rotina não entra duas vezes na fila
  if (runner.itensNaFila(bot.id).some((it) => it.rotina === r.id)) return { ok: false, motivo: 'já está na fila' };
  if (runner.turnoAtivo(bot.id)?.item?.rotina === r.id) return { ok: false, motivo: 'já está rodando agora' };
  let texto = r.instrucao;
  if (dados && Object.keys(dados).length) texto += `\n\n[Dados recebidos pelo link de disparo]\n${JSON.stringify(dados, null, 2).slice(0, 6000)}`;
  runner.enviar(bot.id, { texto, origem: { tipo: 'rotina', nome: r.nome, id: r.id }, rotina: r.id, cadeia: 0 });
  r.ultima = Date.now();
  r.ultimaOrigem = origem;
  r.proxima = proxima(r.quando, Date.now(), r.ultima);
  salvar();
  return { ok: true };
}

export function porGatilho(token) {
  return lista.find((r) => r.gatilho && r.gatilho === token) || null;
}

function rodada() {
  const agora = Date.now();
  for (const r of lista) {
    if (!r.ativa || !r.proxima || r.proxima > agora) continue;
    // computador desligado na hora marcada: roda uma vez ao voltar, se o atraso for de até 3 h; senão pula
    if (agora - r.proxima > 3 * 3600e3) { r.proxima = proxima(r.quando, agora, r.ultima); continue; }
    try { disparar(r.id, { origem: 'horario' }); } catch (e) { console.error('[rotina]', r.nome, e.message); r.proxima = proxima(r.quando, agora, agora); }
  }
  gravarJSON(ARQ, lista);
}

export function iniciarRotinas() {
  // recalcula ao ligar (o arquivo pode ter sido editado à mão)
  for (const r of lista) { r.quando = limparQuando(r.quando); if (!r.proxima) r.proxima = proxima(r.quando, Date.now(), r.ultima); }
  setInterval(rodada, 30e3).unref();
  setTimeout(rodada, 5e3).unref();
}
