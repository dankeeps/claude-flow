// Squads e bots: metadados em JSON, um arquivo por squad e por bot, carregados na memória ao ligar.
//   ~/ClaudeFlow/squads/<squad>/squad.json
//   ~/ClaudeFlow/squads/<squad>/quadro.md            quadro compartilhado do squad
//   ~/ClaudeFlow/squads/<squad>/bots/<bot>/bot.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME, gravarJSON, lerJSON, slug } from './config.js';

export const squads = new Map();
export const bots = new Map();

const RAIZ = path.join(HOME, 'squads');
const LIXEIRA = path.join(HOME, 'lixeira');

export const dirSquad = (squadId) => path.join(RAIZ, squadId);
export const dirBot = (bot) => path.join(RAIZ, bot.squad, 'bots', bot.id);

// campos que só existem enquanto o servidor está ligado (não vão para o bot.json)
const RUNTIME = ['status', 'fila', 'mcp', 'turnoAtual'];

export function carregar() {
  fs.mkdirSync(RAIZ, { recursive: true });
  for (const s of fs.readdirSync(RAIZ)) {
    const sq = lerJSON(path.join(RAIZ, s, 'squad.json'));
    if (!sq) continue;
    squads.set(sq.id, sq);
    const dirBots = path.join(RAIZ, s, 'bots');
    if (!fs.existsSync(dirBots)) continue;
    for (const b of fs.readdirSync(dirBots)) {
      const bot = lerJSON(path.join(dirBots, b, 'bot.json'));
      if (bot) bots.set(bot.id, { ...bot, status: 'ocioso', fila: 0 });
    }
  }
}

export function salvarSquad(sq) {
  gravarJSON(path.join(dirSquad(sq.id), 'squad.json'), sq);
}

export function salvarBot(bot) {
  const limpo = Object.fromEntries(Object.entries(bot).filter(([k]) => !RUNTIME.includes(k)));
  gravarJSON(path.join(dirBot(bot), 'bot.json'), limpo);
}

export function criarSquad({ nome, descricao = '' }) {
  const sq = { id: slug(nome), nome: String(nome).trim(), descricao, criado: Date.now() };
  fs.mkdirSync(path.join(dirSquad(sq.id), 'bots'), { recursive: true });
  salvarSquad(sq);
  squads.set(sq.id, sq);
  return sq;
}

export function novoBotBase({ squad, nome, template }) {
  return {
    id: slug(nome),
    squad,
    nome: String(nome).trim(),
    template,
    avatar: null, // { glifo, cor, fundo } — desenhado pelo app (web/avatar.js)
    criado: Date.now(),
    modelo: '',
    esforco: '',
    autonomia: 'total', // total = bypassPermissions | perguntar = cada permissão vira aprovação no app
    conectores: [],
    navegador: 'principal', // perfil do navegador: "principal" (compartilhado) | "proprio" | "" (sem navegador)
    pastas: [], // pastas extras que o bot pode mexer (--add-dir)
    env: {},
    prefs: {},
    sessao: null,
    sessaoInicio: null,
    sessaoTurnos: 0,
    ctxTokens: 0,
    custoEstimado: 0,
    ultimaAtividade: Date.now(),
    token: crypto.randomBytes(24).toString('hex'),
  };
}

// O avatar é só três nomes curtos; qualquer outra coisa é descartada.
export function limparAvatar(av) {
  if (!av || typeof av !== 'object') return null;
  const id = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  const out = { glifo: id(av.glifo), cor: id(av.cor), fundo: av.fundo === 'escuro' ? 'escuro' : 'cor' };
  return out.glifo && out.cor ? out : null;
}

export function publicoBot(bot) {
  const { token, env, ...resto } = bot;
  return resto;
}

export function botsDoSquad(squadId) {
  return [...bots.values()].filter((b) => b.squad === squadId);
}

export function botPorToken(token) {
  if (!token) return null;
  for (const b of bots.values()) {
    if (b.token.length === token.length && crypto.timingSafeEqual(Buffer.from(b.token), Buffer.from(token))) return b;
  }
  return null;
}

// Bot de outro squad não existe para quem pergunta: a busca por nome/id é sempre dentro do squad.
export function acharNoSquad(squadId, ref) {
  const alvo = String(ref || '').replace(/^@/, '').trim().toLowerCase();
  const lista = botsDoSquad(squadId);
  return lista.find((b) => b.id === alvo) || lista.find((b) => b.nome.toLowerCase() === alvo)
    || lista.find((b) => b.nome.toLowerCase().startsWith(alvo));
}

function paraLixeira(origem, nome) {
  fs.mkdirSync(LIXEIRA, { recursive: true });
  const destino = path.join(LIXEIRA, `${new Date().toISOString().slice(0, 10)}-${nome}`);
  fs.renameSync(origem, destino);
  return destino;
}

export function apagarBot(bot) {
  bots.delete(bot.id);
  return paraLixeira(dirBot(bot), bot.id);
}

export function apagarSquad(sq) {
  for (const b of botsDoSquad(sq.id)) bots.delete(b.id);
  squads.delete(sq.id);
  return paraLixeira(dirSquad(sq.id), sq.id);
}
