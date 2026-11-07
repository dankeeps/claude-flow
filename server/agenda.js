// Rotinas de manutenção: compactação semanal das sessões paradas, limpeza do histórico velho e das transcrições
// brutas, e otimização do banco. Roda a cada 30 min; nada aqui gasta token, a não ser a compactação (um turno curto).
import { config } from './config.js';
import { bots } from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import * as runner from './runner.js';

let ultimaLimpeza = 0;

function rodada() {
  for (const bot of bots.values()) {
    if (runner.ocupado(bot.id)) continue;
    const motivo = mem.precisaCompactar(bot);
    // só compacta pela idade quando o bot está parado há 1 h (não atrapalha uma conversa em andamento)
    if (motivo && Date.now() - (bot.ultimaAtividade || 0) > 3600e3) runner.compactar(bot.id, motivo);
  }
  if (Date.now() - ultimaLimpeza > 24 * 3600e3) {
    ultimaLimpeza = Date.now();
    try {
      const apagadas = db.limparAntigas(config.memoria.manterMensagensDias);
      let arquivos = 0;
      for (const bot of bots.values()) arquivos += mem.limparArquivosVelhos(bot);
      if (new Date().getDay() === 0) db.compactarBanco();
      if (apagadas || arquivos) console.log(`[agenda] limpeza: ${apagadas} mensagens antigas, ${arquivos} transcrições velhas`);
    } catch (e) { console.error('[agenda]', e.message); }
  }
}

export function iniciarAgenda() {
  setTimeout(rodada, 60e3);
  setInterval(rodada, 30 * 60e3);
}
