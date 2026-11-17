// Galáxia: a sala do squad como um grupo de conversa. Além das respostas dos bots às mensagens do usuário, os bots
// "falam" ali sozinhos nos momentos de passagem de trabalho (repasse, recebi, pronto, relevante), em frases curtas e
// informais com emoji, como colegas de equipe. Frases prontas (sem IA): não gastam cota.
import * as db from './db.js';
import { bots } from './store.js';
import { emitir } from './eventos.js';

export const idSala = (squadId) => `sala:${squadId}`;
const sorteio = (l) => l[Math.floor(Math.random() * l.length)];
const nome = (id) => (id === 'usuario' ? 'Daniel' : bots.get(id)?.nome || id);
const marca = (id) => (id === 'usuario' ? 'Daniel' : `@${nome(id)}`);

const FRASES = {
  repasse: [
    '{para}, estou te mandando "{titulo}", ok?',
    '{para}, te mandei "{titulo}" agora. Tá tudo na tarefa, ok?',
  ],
  recebi: [
    'Ok {de}, já recebi aqui 👍',
    'Recebido, {de}! Já começo 👍',
  ],
  diretoRecebi: [
    'Ok Daniel, já recebi aqui 👍',
    'Recebido, Daniel! Já tô vendo 👍',
  ],
  pronto: [
    '{para}, terminei "{titulo}" ✅',
    '{para}, "{titulo}" pronto ✅ Deixei os detalhes na tarefa.',
  ],
  revisaoUsuario: [
    'Daniel, terminei "{titulo}" ✅ Tá em Revisão pra você conferir.',
  ],
  relevante: [
    '📌 Publiquei em Relevantes: "{titulo}"',
  ],
};

function montar(chave, v) {
  return sorteio(FRASES[chave]).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
}

// Uma fala de um bot na Galáxia (papel "bot", marcada como automática).
export function falar(squadId, botId, texto) {
  if (!squadId || !botId || !texto) return null;
  const m = db.addMensagem({ bot: idSala(squadId), squad: squadId, papel: 'bot', de: botId, texto, meta: { auto: true } });
  emitir('sala', { squad: squadId, msg: m });
  return m;
}

// ---------- momentos de passagem de trabalho ----------
export function aoRepassar(t, deBot) {
  if (!bots.has(deBot) || !bots.has(t.bot) || deBot === t.bot) return;
  falar(t.squad, deBot, montar('repasse', { para: marca(t.bot), titulo: t.titulo }));
}
export function aoComecar(t, botId, deQuem, { naFila = false } = {}) {
  if (!t || !bots.has(botId) || !deQuem || deQuem === botId || deQuem === 'usuario') return; // só repasse entre bots
  falar(t.squad, botId, montar(naFila ? 'fila' : 'recebi', { de: marca(deQuem), titulo: t.titulo }));
}
export function aoTerminar(t, botId, status) {
  if (!bots.has(botId) || !['revisao', 'feito'].includes(status)) return;
  const pediu = t.criadoPor;
  if (pediu && pediu !== 'usuario' && pediu !== botId && bots.has(pediu)) falar(t.squad, botId, montar('pronto', { para: marca(pediu), titulo: t.titulo }));
  else falar(t.squad, botId, montar('revisaoUsuario', { titulo: t.titulo }));
}
export function aoRelevante(squadId, botId, titulo) {
  if (bots.has(botId)) falar(squadId, botId, montar('relevante', { titulo }));
}

// Instrução de tom para mensagens que chegam pela Galáxia (vai no começo do pedido ao bot).
export const TOM = '[Mensagem do Daniel na Galáxia (o grupo do squad). Responda como colega de equipe num grupo de conversa: curto (1 a 4 frases), direto, informal, com 1 ou 2 emojis, sem títulos, tabelas nem listas longas. Se a mensagem pede trabalho, faça o trabalho de verdade (com suas ferramentas, repassando a um colega se for dele) e conte o resultado nesse tom; os detalhes técnicos ficam no seu chat e nas tarefas. Para chamar um colega no grupo, use @nome.]';

// Pedido que o usuário mandou direto no chat de um bot: aparece no grupo como mensagem dele, curta.
export function aoPedidoDireto(bot, texto, { tarefa = null } = {}) {
  if (!bot) return;
  const t = tarefa ? db.pegarTarefa(tarefa) : null;
  const corpo = t ? `estou te mandando a tarefa "${t.titulo}", ok?`
    : String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 280) + (String(texto || '').length > 280 ? '…' : '');
  if (!corpo) return;
  const m = db.addMensagem({ bot: idSala(bot.squad), squad: bot.squad, papel: 'usuario', texto: `@${bot.nome} ${corpo}`, meta: { direto: bot.id, auto: true } });
  emitir('sala', { squad: bot.squad, msg: m });
}
export function aoComecarDireto(bot) {
  if (bot) falar(bot.squad, bot.id, sorteio(FRASES.diretoRecebi));
}
