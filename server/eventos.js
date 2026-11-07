// Tempo real para o app (Server-Sent Events), presença (quem está olhando qual bot) e notificações push.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { HOME, config, lerJSON, gravarJSON } from './config.js';
import * as db from './db.js';

// ---------- SSE ----------
const clientes = new Set();

export function abrirSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');
  clientes.add(res);
  const pulso = setInterval(() => res.write(': pulso\n\n'), 25000);
  req.on('close', () => { clearInterval(pulso); clientes.delete(res); });
}

export function emitir(tipo, dados) {
  const s = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) c.write(s);
}

// ---------- presença ----------
// O app manda a cada ~20 s qual bot está aberto e se a tela está visível. Notificação de um bot que alguém está
// olhando agora não é enviada (a pessoa já está vendo a resposta chegar).
const presenca = new Map();

export function marcarPresenca({ cliente, bot, visivel }) {
  presenca.set(String(cliente), { bot: bot || null, visivel: !!visivel, ts: Date.now() });
}

export function alguemVendo(botId) {
  const agora = Date.now();
  for (const p of presenca.values()) if (p.visivel && p.bot === botId && agora - p.ts < 45000) return true;
  return false;
}

// ---------- push ----------
const ARQ_VAPID = path.join(HOME, 'vapid.json');
let vapid = lerJSON(ARQ_VAPID);
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  gravarJSON(ARQ_VAPID, vapid);
  try { fs.chmodSync(ARQ_VAPID, 0o600); } catch {}
}
webpush.setVapidDetails(config.push.assunto, vapid.publicKey, vapid.privateKey);

export const chavePublicaPush = () => vapid.publicKey;

export function inscreverPush(sub) {
  if (!sub?.endpoint || !sub?.keys) throw new Error('inscrição inválida');
  db.pushSalvar(sub);
}

export async function notificar({ titulo, texto, bot = null, url = null, tag = null, forcar = false }) {
  emitir('aviso', { titulo, texto, bot });
  if (!forcar && bot && alguemVendo(bot)) return { enviados: 0, motivo: 'alguém está vendo este bot agora' };
  const payload = JSON.stringify({
    titulo: String(titulo).slice(0, 120),
    texto: String(texto || '').slice(0, 400),
    url: url || (bot ? `/#/bot/${bot}` : '/'),
    tag: tag || (bot ? `bot-${bot}` : 'claude-flow'),
  });
  let enviados = 0;
  for (const sub of db.pushListar()) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high' });
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.pushRemover(sub.endpoint);
      else console.error('[push]', e.statusCode || '', e.body || e.message);
    }
  }
  return { enviados };
}
