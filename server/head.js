// Head: o gerente do squad. Enquanto um bot trabalha, de tempos em tempos o Head recebe uma "ronda" com o pedido que
// aquele bot está cumprindo e confere (pelas ferramentas bot_atividade e bot_regras) se ele está fazendo o que foi
// pedido, do jeito combinado. Quando o trabalho acaba, uma última conferência; depois não olha mais.
// As rondas são do servidor (sem IA): o Head só é chamado quando tem um bot trabalhando de verdade.
import { bots, botsDoSquad } from './store.js';
import * as runner from './runner.js';
import * as db from './db.js';

const INTERVALO = 10 * 60e3; // de quanto em quanto tempo o Head passa num mesmo trabalho
const MINIMO = 4 * 60e3;     // trabalho curto (menos de 4 min) não recebe ronda
const ultima = new Map();    // "<bot>:<item>" -> quando foi a última ronda
const rondados = new Set();  // itens que já tiveram pelo menos uma ronda (esses ganham a conferência final)

const headDo = (squad) => botsDoSquad(squad).find((b) => b.template === 'head' && !b.pausado);
const min = (ms) => Math.max(1, Math.round(ms / 60000));

function pedidoDe(item) {
  const t = item.tarefa ? db.pegarTarefa(item.tarefa) : null;
  const texto = String(item.texto || '').trim();
  return { t, texto: texto.length > 3500 ? texto.slice(0, 3500) + '\n…(cortado)' : texto };
}

function jaTemRonda(head, alvo) {
  const fila = runner.estadoBot(head).filaItens || [];
  return fila.some((x) => String(x.texto || '').includes('[Ronda') && String(x.texto || '').includes(`@${alvo.nome}`));
}

function mandar(head, alvo, item, { final = false, duracao = 0, resultado = '' } = {}) {
  const { t, texto } = pedidoDe(item);
  const quem = item.origem?.tipo === 'bot' ? `repassado por @${item.origem.nome || item.origem.id}` : item.origem?.tipo === 'rotina' ? `rotina "${item.origem.nome}"` : 'pedido do Daniel';
  const msg = [
    final
      ? `[Ronda final] @${alvo.nome} terminou um trabalho (${min(duracao)} min, ${quem}). Confira se entregou o que foi pedido, do jeito combinado.`
      : `[Ronda] @${alvo.nome} está trabalhando há ${min(duracao)} min (${quem}). Confira se está seguindo o pedido e as regras dele.`,
    t ? `Tarefa #${t.id}: ${t.titulo}` : null,
    `Pedido:\n"""\n${texto}\n"""`,
    final && resultado ? `Resposta final dele:\n"""\n${String(resultado).slice(0, 2000)}\n"""` : null,
    `Use mcp__flow__bot_atividade (bot="${alvo.nome}") para ver o que ele fez e mcp__flow__bot_regras para as regras dele.`,
  ].filter(Boolean).join('\n\n');
  runner.enviar(head.id, { texto: msg, origem: { tipo: 'rotina', nome: final ? 'Ronda final do Head' : 'Ronda do Head' } });
}

function ronda() {
  const agora = Date.now();
  for (const b of bots.values()) {
    if (b.template === 'head') continue;
    const a = runner.turnoAtivo(b.id);
    if (!a?.item || a.item.especial || agora - a.inicio < MINIMO) continue;
    const head = headDo(b.squad);
    if (!head) continue;
    const chave = `${b.id}:${a.item.id}`;
    if (agora - (ultima.get(chave) || 0) < INTERVALO) continue;
    if (jaTemRonda(head, b)) continue;
    ultima.set(chave, agora);
    rondados.add(chave);
    mandar(head, b, a.item, { duracao: agora - a.inicio });
  }
}

// fim de um turno: trabalho que teve ronda (ou que foi longo) ganha a conferência final
export function aoFimDoTurno(bot, item, { final, erro, parado, duracao = 0 } = {}) {
  if (!item || item.especial || parado || bot.template === 'head') return;
  const chave = `${bot.id}:${item.id}`;
  const teveRonda = rondados.delete(chave);
  ultima.delete(chave);
  if (!teveRonda && duracao < MINIMO) return;
  const head = headDo(bot.squad);
  if (!head) return;
  mandar(head, bot, item, { final: true, duracao, resultado: erro ? `(parou com erro: ${erro})` : final });
}

export function iniciar() {
  setInterval(() => { try { ronda(); } catch (e) { console.error('[head]', e.message); } }, 60e3);
}
