// Executor dos bots. Cada mensagem vira um turno do Claude CLI em modo headless:
//   claude -p --output-format stream-json --resume <sessão> --append-system-prompt-file <foto da sessão> --mcp-config <bot>
// O processo só existe durante o turno (bot parado não ocupa memória). Um turno por bot de cada vez; o resto espera
// na fila. A sessão do CLI continua de um turno para o outro até a compactação, que abre uma sessão nova.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn as spawnNode, spawnSync } from 'node:child_process';
import spawn from 'cross-spawn';
import { IS_WIN, REPO, HOME, config, expandir, segredos } from './config.js';
import { bots, squads, salvarBot, dirBot } from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import { emitir, notificar, alguemVendo } from './eventos.js';
import { montarMcp } from './conectores.js';
import { montarSnapshot } from './prompt.js';
import * as galaxia from './galaxia.js';
import * as codex from './codex.js';
import * as grok from './grok.js';
import * as voicestudio from './voicestudio.js';
import { template as templateDe } from './templates.js';
import * as demandas from './demandas.js';
import { conectoresDoBot } from './store.js';

const filas = new Map(); // bot -> [itens]
const ativos = new Map(); // bot -> { child, turno, item, inicio, sessao, parado }
export let limiteUso = null; // último rate_limit_event do CLI (janela de 5 h da assinatura)

// Ganchos que o index liga (evita importação circular com tarefas.js): turno que passou de 90 s vira cartão no
// kanban; no fim do turno o cartão vai para Revisão com o resultado.
export const ganchos = { turnoLongo: null, fimDoTurno: null };

// ---------- fila guardada em disco ----------
// Queda de energia, reinício do computador ou do servidor: a fila e o trabalho que estava rodando ficam em
// ~/ClaudeFlow/fila.json e voltam quando o servidor liga de novo (o que estava rodando é retomado de onde parou).
const ARQ_FILA = path.join(HOME, 'fila.json');
const serial = ({ aguardar, ...resto }) => resto; // a espera de outro bot não sobrevive ao reinício
let timerSalvar = null;
export function salvarFilas() {
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(() => {
    const dados = {};
    for (const id of new Set([...filas.keys(), ...ativos.keys()])) {
      const a = ativos.get(id);
      const fila = (filas.get(id) || []).map(serial);
      if (fila.length || a) dados[id] = { fila, ativo: a ? { item: serial(a.item), pid: a.child?.pid || codex.pidDoBot(id) || null } : null };
    }
    try {
      fs.writeFileSync(`${ARQ_FILA}.tmp`, JSON.stringify(dados));
      fs.renameSync(`${ARQ_FILA}.tmp`, ARQ_FILA);
    } catch (e) { console.error('[fila]', e.message); }
  }, 200);
}

// Processo do claude que ficou órfão (servidor caiu com o turno rodando): encerra para não rodar em dobro.
function matarOrfao(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      if (/claude|codex/i.test(r.stdout || '')) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (/claude|codex/i.test(cmd)) process.kill(pid, 'SIGTERM');
    }
  } catch {}
}

export function restaurarFilas() {
  try { db.fecharTurnosAbertos(); } catch (e) { console.error('[turnos]', e.message); }
  let dados = {};
  try { dados = JSON.parse(fs.readFileSync(ARQ_FILA, 'utf8')); } catch { return; }
  const retomados = [];
  for (const [id, d] of Object.entries(dados)) {
    const bot = bots.get(id);
    if (!bot) continue;
    const fila = [];
    if (d.ativo?.item) {
      matarOrfao(d.ativo.pid);
      const it = { ...d.ativo.item, retomada: (d.ativo.item.retomada || 0) + 1 };
      if (it.retomada > 2) {
        emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: 'O servidor reiniciou de novo no meio deste trabalho. Não retomei sozinho pela terceira vez: peça de novo quando quiser.' }));
      } else {
        fila.push(it);
        retomados.push(bot.nome);
        emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: 'O servidor reiniciou (queda de energia, reinício do computador ou atualização) no meio deste trabalho. Retomando de onde parou.' }));
      }
    }
    fila.push(...(d.fila || []));
    if (fila.length) filas.set(id, [...fila, ...(filas.get(id) || [])]);
  }
  for (const id of filas.keys()) setImmediate(() => proximo(id));
  salvarFilas();
  if (retomados.length) notificar({ titulo: 'Claude Flow voltou', texto: `Retomando o trabalho de ${retomados.join(', ')} de onde parou.`, forcar: true }).catch(() => {});
}

let FLOW_URL = 'http://127.0.0.1:4400';
export const definirUrl = (u) => { FLOW_URL = u; };

export function binClaude() {
  if (config.claudeBin) return expandir(config.claudeBin);
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  return 'claude';
}

export function estadoBot(bot) {
  const a = ativos.get(bot.id);
  const pesadoDe = esperandoPesado.has(bot.id) ? bots.get(pesadoAtivo())?.nome || null : null;
  const fila = filas.get(bot.id) || [];
  return {
    status: a ? 'trabalhando' : (fila.length ? 'na fila' : bot.status === 'erro' ? 'erro' : 'ocioso'), fila: fila.length, desde: a?.inicio || null,
    esperandoPesado: pesadoDe, pausado: !!bot.pausado,
    filaItens: fila.filter((it) => !it.especial).map((it) => ({ id: it.id, texto: String(it.texto || '').replace(/\s+/g, ' ').slice(0, 140), de: it.origem?.tipo === 'usuario' ? null : it.origem?.nome || it.origem?.tipo || null, criado: it.criado })),
  };
}

// ---------- fila: pausar, retomar, cancelar, passar para a frente ----------
export const itensNaFila = (botId) => filas.get(botId) || [];
export function pausar(botId, pausado = true) {
  const bot = bots.get(botId);
  if (!bot) throw new Error('bot não encontrado');
  bot.pausado = !!pausado;
  salvarBot(bot);
  emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: pausado ? 'Fila pausada: o que está rodando termina, e as próximas mensagens esperam você retomar.' : 'Fila retomada.' }));
  avisarEstado(bot);
  if (!pausado) { if (limiteAte) { limiteAte = 0; avisadosLimite.clear(); } setImmediate(() => proximo(bot.id)); }
  return estadoBot(bot);
}
export function cancelarItem(botId, itemId) {
  const fila = filas.get(botId) || [];
  const i = fila.findIndex((it) => it.id === itemId);
  if (i < 0) throw new Error('essa mensagem já saiu da fila');
  const [it] = fila.splice(i, 1);
  salvarFilas();
  it.aguardar?.resolve?.({ erro: 'o usuário tirou esta mensagem da fila' });
  const bot = bots.get(botId);
  emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: `Tirado da fila: "${String(it.texto || '').replace(/\s+/g, ' ').slice(0, 80)}"` }));
  avisarEstado(bot);
  return estadoBot(bot);
}
export function passarNaFrente(botId, itemId) {
  const fila = filas.get(botId) || [];
  const i = fila.findIndex((it) => it.id === itemId);
  if (i < 0) throw new Error('essa mensagem já saiu da fila');
  const [it] = fila.splice(i, 1);
  // compactação pendente continua na frente
  const pos = fila.findIndex((x) => !x.especial);
  fila.splice(pos < 0 ? fila.length : pos, 0, it);
  salvarFilas();
  const bot = bots.get(botId);
  avisarEstado(bot);
  return estadoBot(bot);
}

// Bots de trabalho pesado (edição, render, transcrição): um de cada vez no computador inteiro. Os outros esperam a
// vez na fila; bots leves continuam normalmente. (Compactação de memória não conta como pesada.)
const esperandoPesado = new Set();
// "pesado" (um de cada vez no PC: corte, edição, render). Resultado que outro bot devolveu (conferir, subir no Drive)
// e as rondas do Head não são pesados: não esperam a vez.
const ehPesado = (botId, item) => !!bots.get(botId)?.pesado && !item?.especial
  && !(item?.origem?.tipo === 'bot' && !item?.tarefa) && item?.origem?.tipo !== 'rotina-head';
function pesadoAtivo() {
  for (const [id, a] of ativos) if (ehPesado(id, a.item)) return id;
  return null;
}
function liberarPesados() {
  for (const id of [...esperandoPesado]) { esperandoPesado.delete(id); setImmediate(() => proximo(id)); }
}

function avisarEstado(bot) {
  const e = estadoBot(bot);
  emitir('bot', { id: bot.id, ...e, ctxTokens: bot.ctxTokens, sessao: bot.sessao, sessaoInicio: bot.sessaoInicio, ultimaAtividade: bot.ultimaAtividade });
}

// ---------- entrada ----------
// item: { texto, origem: {tipo:'usuario'|'bot'|'sistema', id?, nome?}, anexos?, cadeia?, aguardar?, especial? }
export function enviar(botId, item) {
  const bot = bots.get(botId);
  if (!bot) throw new Error('bot não encontrado');
  const origem = item.origem || { tipo: 'usuario' };
  item.id = crypto.randomBytes(5).toString('hex');
  item.criado = Date.now();
  item.botId = bot.id;
  if (!item.especial) {
    const papel = { usuario: 'usuario', bot: 'entrada', rotina: 'rotina' }[origem.tipo] || 'sistema';
    const msg = db.addMensagem({
      bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel, de: origem.tipo === 'bot' ? origem.id || null : null, para: bot.id,
      texto: item.texto, meta: { anexos: item.anexos || [], deNome: origem.nome || null, aguardar: !!item.aguardar, rotina: item.rotina || null, sala: item.sala || null },
    });
    emitir('msg', msg);
    // pedido direto do usuário a este bot (fora da Galáxia): aparece no grupo também
    if (origem.tipo === 'usuario' && !item.sala && !item.retomada) { try { galaxia.aoPedidoDireto(bot, item.texto, { tarefa: item.tarefa }); } catch {} }
  }
  const fila = filas.get(bot.id) || [];
  if (item.frente) fila.unshift(item); else fila.push(item);
  filas.set(bot.id, fila);
  salvarFilas();
  // Bot livre: começa logo em seguida, sem anunciar "na fila" (a fila só aparece quando já tem algo rodando).
  // O setImmediate deixa a resposta do envio sair antes de abrir o processo do bot.
  if (!ativos.has(bot.id)) setImmediate(() => proximo(bot.id));
  else avisarEstado(bot);
  return estadoBot(bot);
}

export function parar(botId, { limparFila = false } = {}) {
  const a = ativos.get(botId);
  if (limparFila) {
    for (const it of filas.get(botId) || []) it.aguardar?.resolve?.({ erro: 'cancelado pelo usuário' });
    filas.set(botId, []);
    salvarFilas();
  }
  if (!a) { const b = bots.get(botId); if (b) avisarEstado(b); return false; }
  a.parado = true;
  if (a.interromper) a.interromper(); else matarArvore(a.child);
  return true;
}

function matarArvore(child) {
  if (!child?.pid) return;
  try {
    if (IS_WIN) spawnNode('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM');
  } catch { try { child.kill('SIGTERM'); } catch {} }
}

// ---------- montagem do prompt do turno ----------
function textoDoItem(item) {
  const o = item.origem || {};
  let t = String(item.texto || '');
  if (item.retomada) t = `[Retomada: o servidor reiniciou no meio deste trabalho (queda de energia, reinício do computador ou atualização). A conversa até o último passo salvo continua nesta sessão. Antes de refazer qualquer coisa, confira o que já existe na pasta (downloads, transcrições, projetos) e continue de onde parou. Avise com mcp__flow__progresso que retomou.]\n${t}`;
  if (o.tipo === 'rotina') t = `[Rotina "${o.nome}" — disparada sozinha, o usuário não está acompanhando agora. Faça o trabalho completo; se precisar de uma decisão dele, deixe a pergunta no fim. Ninguém responde a uma tela de login nesta hora: se cair numa, diga isso no resultado.]\n${t}`;
  if (item.sala) t = `${galaxia.TOM}\n[${item.salaOutros?.length ? `Enviada também para ${item.salaOutros.map((n) => '@' + n).join(', ')} (cada um dá a sua resposta). ` : ''}A sua resposta final aparece na Galáxia.]\n${t}`;
  if (o.tipo === 'bot') {
    t = `[Mensagem de @${o.nome} — bot do seu squad${item.aguardar ? '. Ele está esperando: a sua resposta final deste turno volta automaticamente para ele' : ''}]\n${t}`;
  }
  if (!item.rotina && !item.sala) { const ctx = demandas.contextoParaBot(item.botId || ''); if (ctx) t = `${ctx}\n\n${t}`; }
  if (item.anexos?.length) {
    t += `\n\n[Anexos enviados pelo usuário]\n${item.anexos.map((a) => `- ${a.caminho} (${(a.tamanho / 1e6).toFixed(1)} MB)`).join('\n')}`;
  }
  return t;
}

// ---------- turno ----------
// ---------- limite de uso do ChatGPT ----------
// Quando a conta bate no limite, cada pedido falharia na hora e sairia da fila. Em vez disso: o pedido volta para a
// frente da fila e as filas do motor do ChatGPT esperam até a hora que o próprio ChatGPT diz ("try again at 4:28 PM").
let limiteAte = 0;
let timerLimite = null;
const avisadosLimite = new Set();
export const ehLimiteDeUso = (erro) => /usage limit|hit your usage|limite de uso|rate limit|too many requests|\b429\b|quota/i.test(String(erro || ''));
function horaDoLimite(erro) {
  const m = String(erro).match(/try again at (\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if ((m[3] || '').toUpperCase() === 'PM') h += 12;
    if (!m[3] && Number(m[1]) >= 12) h = Number(m[1]);
    const d = new Date(); d.setHours(h, Number(m[2]) + 1, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return Date.now() + 15 * 60000; // sem hora no aviso: tenta de novo em 15 min
}
function segurarPorLimite(bot, item, erro) {
  const fila = filas.get(bot.id) || [];
  filas.set(bot.id, fila);
  fila.unshift(item);
  salvarFilas();
  const ate = horaDoLimite(erro);
  if (ate > limiteAte) {
    limiteAte = ate;
    clearTimeout(timerLimite);
    timerLimite = setTimeout(() => {
      limiteAte = 0;
      avisadosLimite.clear();
      for (const id of filas.keys()) setImmediate(() => proximo(id));
    }, Math.max(5000, ate - Date.now()));
  }
  if (!avisadosLimite.has(bot.id)) {
    avisadosLimite.add(bot.id);
    const hora = new Date(limiteAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema',
      texto: `O limite de uso do ChatGPT acabou. Nada se perdeu: este pedido e a fila ficaram guardados e voltam sozinhos às ${hora} (quando o limite renova). Para tentar antes, pause e retome a fila.` }));
    if (avisadosLimite.size === 1) notificar({ titulo: 'Limite do ChatGPT', texto: `As filas dos bots voltam sozinhas às ${hora}.`, forcar: true, tag: 'limite-chatgpt' }).catch(() => {});
  }
}

async function proximo(botId) {
  if (ativos.has(botId)) return;
  const fila = filas.get(botId) || [];
  // limite de uso do ChatGPT: a fila espera a renovação (retomar a fila na mão tenta de novo na hora)
  if (limiteAte > Date.now() && fila.length && !fila[0]?.especial && motorDo(bots.get(botId) || {}) === 'codex') { const b = bots.get(botId); if (b) avisarEstado(b); return; }
  // fila pausada: só a compactação de memória passa
  if (bots.get(botId)?.pausado && !fila[0]?.especial) { const b = bots.get(botId); if (b) avisarEstado(b); return; }
  if (fila.length && ehPesado(botId, fila[0])) {
    const outro = pesadoAtivo();
    if (outro && outro !== botId) {
      if (!esperandoPesado.has(botId)) {
        esperandoPesado.add(botId);
        const b = bots.get(botId);
        if (b) emitir('msg', db.addMensagem({ bot: b.id, squad: b.squad, sessao: b.sessao, papel: 'sistema', texto: `Esperando a vez: @${bots.get(outro)?.nome} está numa tarefa pesada. Começo assim que terminar.` }));
      }
      const b = bots.get(botId);
      if (b) avisarEstado(b);
      return;
    }
  }
  esperandoPesado.delete(botId);
  const item = fila.shift();
  salvarFilas();
  const bot = bots.get(botId);
  if (!item || !bot) { if (bot) avisarEstado(bot); return; }
  try {
    await executar(bot, item);
  } catch (e) {
    console.error(`[${bot.nome}]`, e);
    const msg = db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: `Erro ao rodar o turno: ${e.message}` });
    emitir('msg', msg);
    item.aguardar?.resolve?.({ erro: e.message });
  } finally {
    ativos.delete(bot.id);
    salvarFilas();
    avisarEstado(bot);
    setImmediate(() => proximo(bot.id));
    if (ehPesado(bot.id, item)) liberarPesados();
  }
}

// Gancho que vale em todo turno, em qualquer autonomia: antes de qualquer exclusão, o usuário confirma no app.
const GUARDA = path.join(REPO, 'server', 'hooks', 'guarda-exclusao.js').replace(/\\/g, '/');
function arquivoGanchos(bot) {
  const arq = path.join(dirBot(bot), '.flow', 'ganchos.json');
  const node = process.execPath.replace(/\\/g, '/');
  const conteudo = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell|mcp__.*', hooks: [{ type: 'command', command: `"${node}" "${GUARDA}"`, timeout: 1860 }] }] },
  }, null, 2);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  if (!fs.existsSync(arq) || fs.readFileSync(arq, 'utf8') !== conteudo) fs.writeFileSync(arq, conteudo);
  return arq;
}

function argsDoTurno(bot, { sessao, nova, snapshot, mcp }) {
  const a = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt-file', snapshot, '--mcp-config', mcp.arquivo];
  a.push(...(nova ? ['--session-id', sessao] : ['--resume', sessao]));
  const modelo = bot.modelo || config.modeloPadrao;
  if (modelo) a.push('--model', modelo);
  if (bot.esforco) a.push('--effort', bot.esforco);
  if (bot.autonomia === 'perguntar') a.push('--permission-mode', 'default', '--permission-prompt-tool', 'mcp__flow__aprovar');
  else a.push('--permission-mode', 'bypassPermissions');
  a.push('--settings', arquivoGanchos(bot));
  for (const p of bot.pastas || []) if (p && fs.existsSync(expandir(p))) a.push('--add-dir', expandir(p));
  if (mcp.bloquear.length) a.push('--disallowedTools', mcp.bloquear.join(','));
  return a;
}

// Tudo o que os bots geram fica no ~/ClaudeFlow: o trabalho na pasta do bot, os caches (modelos do Whisper e do
// Atlas, downloads de pacotes, temporários) em ~/ClaudeFlow/cache.
export function pastasCentrais() {
  const cache = path.join(HOME, 'cache');
  return {
    TEMP: path.join(cache, 'tmp'), TMP: path.join(cache, 'tmp'),
    HF_HOME: path.join(cache, 'huggingface'),
    PERFECT_CUT_MODELOS: path.join(cache, 'perfect-cut'),
    ESTUDIO_MODELOS: path.join(cache, 'atlas-modelos'),
    UV_CACHE_DIR: path.join(cache, 'uv'),
    PIP_CACHE_DIR: path.join(cache, 'pip'),
    PLAYWRIGHT_BROWSERS_PATH: path.join(cache, 'navegadores'),
  };
}
// {{bot}} nos valores de env do bot = pasta do bot (ex.: "{{bot}}/trabalho/edicoes").
export const expandirBot = (bot, v) => String(v).replace(/\{\{bot\}\}/g, dirBot(bot));

export function envDoTurno(bot) {
  const centrais = pastasCentrais();
  for (const p of new Set([centrais.TEMP])) fs.mkdirSync(p, { recursive: true });
  const proprios = Object.fromEntries(Object.entries(bot.env || {}).map(([k, v]) => [k, expandir(expandirBot(bot, v))]));
  const env = { ...process.env, ...centrais, ...segredos(), ...proprios };
  delete env.VOZ_OPENAI_KEY; // chave da conversa por voz: só o voz.js usa; os bots ficam no plano (Claude/Codex)
  delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; // nenhuma chave paga da OpenAI chega aos bots
  env.FLOW_TRABALHO = path.join(dirBot(bot), 'trabalho');
  env.FLOW_CEREBRO = path.join(HOME, 'cerebro');
  env.FLOW_SPY = path.join(HOME, 'squads', bot.squad, 'spy.json'); // aba Spy: monitoradas e blacklist do squad
  env.FLOW_URL = FLOW_URL;
  env.FLOW_BOT = bot.id;
  env.FLOW_TOKEN = bot.token; // o gancho guarda-exclusao.js abre a confirmação no app com ele
  env.MCP_TOOL_TIMEOUT = String(Math.max(30, config.squad.esperaMaxMin + 5) * 60 * 1000);
  env.PYTHONUTF8 = '1';
  // Git Bash no caminho (o motor do ChatGPT roda os comandos das skills com "bash -c"; o servidor, como serviço do
  // Windows, nem sempre herda o PATH do usuário)
  if (IS_WIN) {
    const git = ['C:\\Program Files\\Git\\bin', 'C:\\Program Files\\Git\\usr\\bin'].filter((p) => fs.existsSync(p));
    const chave = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
    const atual = env[chave] || '';
    const faltam = git.filter((p) => !atual.toLowerCase().includes(p.toLowerCase()));
    if (faltam.length) env[chave] = [...faltam, atual].join(';');
  }
  delete env.CLAUDECODE; // se o servidor foi aberto de dentro de outra sessão do Claude Code
  return env;
}

function resumoFerramenta(nome, entrada = {}) {
  const e = entrada || {};
  const s = e.command || e.description || e.file_path || e.path || e.pattern || e.url || e.query || e.para || e.skill || e.prompt || '';
  return String(s).replace(/\s+/g, ' ').slice(0, 160);
}

function executar(bot, item, tentativa = 0) {
  // VoiceStudio ligado no bot: sobe o servidor local antes do turno (o MCP dele precisa estar no ar)
  if (!item.vsConferido && conectoresDoBot(bot).includes('voicestudio') && voicestudio.onde().instalado) {
    item.vsConferido = true;
    return voicestudio.ligar().catch((e) => console.error('VoiceStudio:', e.message)).then(() => executar(bot, item, tentativa));
  }
  // repasse de outro bot: "recebi, já tô nessa" na Galáxia
  if (!tentativa && !item.retomada && item.tarefa && item.origem?.tipo === 'bot') { try { galaxia.aoComecar(db.pegarTarefa(item.tarefa), bot.id, item.origem.id); } catch {} }
  else if (!tentativa && !item.retomada && !item.especial && !item.sala && (item.origem?.tipo || 'usuario') === 'usuario' && !item.jaAvisouGalaxia) { item.jaAvisouGalaxia = true; try { galaxia.aoComecarDireto(bot); } catch {} }
  if (motorDo(bot) === 'codex' || motorDo(bot) === 'grok') return executarCodex(bot, item);
  return new Promise((resolve, reject) => {
    const nova = !bot.sessao;
    if (nova) {
      bot.sessao = crypto.randomUUID();
      bot.sessaoInicio = Date.now();
      bot.sessaoTurnos = 0;
      bot.ctxTokens = 0;
    }
    const mcp = montarMcp(bot, { flowUrl: FLOW_URL });
    // a foto da sessão é montada uma vez por sessão (cache do prompt); turnos seguintes reaproveitam o arquivo
    const snapArq = path.join(dirBot(bot), '.flow', 'sistema.md');
    // (snapshotSujo: o usuário mudou função/memória/conectores pelo app — vale já no próximo turno)
    const snapshot = nova || bot.snapshotSujo || !fs.existsSync(snapArq) ? montarSnapshot(bot, { conectores: mcp.ativos, avisos: mcp.avisos }) : snapArq;
    bot.snapshotSujo = false;
    const args = argsDoTurno(bot, { sessao: bot.sessao, nova, snapshot, mcp });
    const origemTxt = item.origem?.tipo === 'bot' ? `bot:${item.origem.id}` : item.origem?.tipo || 'usuario';
    const turno = db.iniciarTurno({ bot: bot.id, sessao: bot.sessao, origem: origemTxt });
    const inicio = Date.now();

    const child = spawn(binClaude(), args, {
      cwd: dirBot(bot), env: envDoTurno(bot), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN,
    });
    const estado = { child, turno, item, inicio, sessao: bot.sessao, parado: false, cadeia: item.cadeia || 0 };
    ativos.set(bot.id, estado);
    salvarFilas();
    const longo = setTimeout(() => { try { ganchos.turnoLongo?.(bot, item); } catch (e) { console.error('[turno longo]', e.message); } }, 90e3);
    bot.ultimaAtividade = inicio;
    avisarEstado(bot);
    emitir('turno', { bot: bot.id, inicio: true, turno });

    child.stdin.on('error', () => {});
    child.stdin.end(textoDoItem(item));

    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

    const textos = [];
    let resultado = null;
    let ctx = bot.ctxTokens;
    const ferramentas = new Map();

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (linha) => {
      let ev;
      try { ev = JSON.parse(linha); } catch { return; }
      if (ev.type === 'system' && ev.subtype === 'init') {
        bot.mcp = (ev.mcp_servers || []).map((m) => ({ nome: m.name, status: m.status }));
        emitir('mcp', { bot: bot.id, servidores: bot.mcp });
      } else if (ev.type === 'stream_event') {
        const d = ev.event?.delta;
        if (ev.event?.type === 'content_block_delta' && d?.type === 'text_delta' && !ev.parent_tool_use_id) {
          emitir('delta', { bot: bot.id, turno, texto: d.text });
        }
      } else if (ev.type === 'assistant' && ev.message) {
        const u = ev.message.usage;
        if (u && !ev.parent_tool_use_id) ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        for (const c of ev.message.content || []) {
          if (c.type === 'text' && c.text?.trim() && !ev.parent_tool_use_id) {
            textos.push(c.text);
            const m = db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'bot', texto: c.text, meta: { turno } });
            emitir('msg', m);
          } else if (c.type === 'tool_use') {
            const resumo = resumoFerramenta(c.name, c.input);
            const m = db.addMensagem({
              bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'ferramenta', texto: `${c.name} ${resumo}`.trim(),
              meta: { turno, nome: c.name, resumo, id: c.id, sub: !!ev.parent_tool_use_id },
            });
            ferramentas.set(c.id, m.id);
            emitir('msg', m);
          }
        }
      } else if (ev.type === 'user' && ev.message?.content) {
        for (const c of ev.message.content) {
          if (c.type === 'tool_result' && ferramentas.has(c.tool_use_id)) {
            emitir('ferramenta', { bot: bot.id, msg: ferramentas.get(c.tool_use_id), erro: !!c.is_error });
          }
        }
      } else if (ev.type === 'rate_limit_event') {
        limiteUso = { ...ev.rate_limit_info, visto: Date.now() };
        emitir('limite', limiteUso);
      } else if (ev.type === 'result') {
        resultado = ev;
      }
    });

    child.on('error', (e) => {
      db.fecharTurno(turno, { status: 'erro', erro: e.message });
      reject(new Error(e.code === 'ENOENT' ? `não achei o comando "${binClaude()}". Instale o Claude Code ou defina claudeBin no config.json.` : e.message));
    });

    child.on('close', async (code) => {
      clearTimeout(longo);
      rl.close();
      const dur = Date.now() - inicio;
      const final = resultado?.result ?? textos.at(-1) ?? '';
      // o CLI novo manda o erro dentro do "result" (is_error + errors), não só no stderr
      const errosResultado = resultado?.is_error && Array.isArray(resultado.errors) ? resultado.errors.join(' ') : '';
      const erroCli = estado.parado ? null : !resultado ? (stderr.trim().split('\n').slice(-3).join(' ') || `o CLI saiu com código ${code}`)
        : resultado.is_error && !String(resultado.result || '').trim() ? (errosResultado || resultado.subtype || 'o CLI devolveu erro') : null;

      // sessão sumiu (apagada pela limpeza do CLI, outro computador, troca de motor…): começa uma nova com a mesma memória
      if (!nova && (!resultado || resultado.is_error) && /No conversation found|session.*not found/i.test(`${stderr} ${errosResultado}`) && tentativa === 0) {
        db.fecharTurno(turno, { status: 'refeito', erro: 'sessão não encontrada' });
        bot.sessao = null;
        ativos.delete(bot.id);
        return executar(bot, item, 1).then(resolve, reject);
      }

      if (resultado?.session_id && motorDo(bot) === 'claude' && !resultado.is_error) bot.sessao = resultado.session_id;
      bot.ctxTokens = ctx;
      bot.sessaoTurnos = (bot.sessaoTurnos || 0) + 1;
      bot.custoEstimado = (bot.custoEstimado || 0) + (resultado?.total_cost_usd || 0);
      bot.ultimaAtividade = Date.now();
      bot.status = erroCli || resultado?.is_error ? 'erro' : 'ocioso';
      salvarBot(bot);
      db.fecharTurno(turno, {
        status: estado.parado ? 'parado' : erroCli || resultado?.is_error ? 'erro' : 'ok',
        custo: resultado?.total_cost_usd ?? null, contexto: ctx, erro: erroCli,
      });

      if (estado.parado) emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: 'Parado pelo usuário.' }));
      if (erroCli) emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: `O Claude CLI falhou: ${erroCli}` }));
      if (resultado?.permission_denials?.length) {
        const nomes = [...new Set(resultado.permission_denials.map((p) => p.tool_name))].join(', ');
        emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'sistema', texto: `Permissão negada para: ${nomes}.` }));
      }
      emitir('turno', { bot: bot.id, fim: true, turno, ms: dur, contexto: ctx });

      item.aguardar?.resolve?.({ texto: final, erro: erroCli });
      try { ganchos.fimDoTurno?.(bot, item, { final, erro: erroCli, parado: estado.parado, dur }); } catch (e) { console.error('[fim do turno]', e.message); }
      await depoisDoTurno(bot, item, { final, dur, erroCli, parado: estado.parado });
      resolve();
    });
  });
}

// ---------- motor ChatGPT (Codex App Server) ----------
// O motor de cada bot: bot.motor ("codex" | "claude" | "grok") ou o padrão do config.json ("motor"). Tudo o que vem depois do
// turno (fila, kanban, notificação, compactação, retomada) é o mesmo para os dois.
export const motorDo = (bot) => bot.motor || config.motor || 'claude';

const NOTA_CODEX = `

## Ferramentas neste motor (ChatGPT)
- As ferramentas citadas acima como mcp__flow__<nome> são as do servidor "flow" (ex.: mcp__flow__progresso = flow/progresso); mcp__navegador__* = navegador/*. Use-as do mesmo jeito.
- Os apps da conta do ChatGPT do usuário (Gmail, Drive, Agenda…) aparecem como ferramentas próprias; quando o pedido for sobre e-mail, agenda ou arquivos dele, use esses apps. Mais de uma conta conectada: use a que ele disser; se não disser, pergunte no fim.
- Para olhar uma imagem (folha de quadros, captura de tela), use a ferramenta de ver imagem com o caminho do arquivo.
- Skills: as da sua pasta .claude/skills estão disponíveis; quando o pedido for o caso de uma delas, leia o SKILL.md e siga.
- TERMINAL: as skills (perfect-edit, broll-youtube, baixar-do-drive, motion-vox) e as instruções do seu modelo foram escritas para o **Git Bash** ($FLOW_TRABALHO, export, aspas, ls/tail, heredoc). Rode esses comandos **dentro do bash**, sem traduzir para PowerShell: bash -c '<comando da skill>' (o bash do Git já está no PATH). Variáveis de ambiente (FLOW_TRABALHO, PERFECT_EDIT_ATLAS, ESTUDIO_RAIZ, ESTUDIO_BROLLS…) já vêm prontas no bash. Os scripts de uma skill ficam na pasta dela: .claude/skills/<skill>/ (ex.: .claude/skills/perfect-edit/scripts/corte, com o Python em .claude/skills/perfect-edit/.venv/Scripts/python.exe); o Atlas fica em $PERFECT_EDIT_ATLAS, com o Python em .venv/Scripts/python.exe.
- Comando curto que não é de skill pode ser PowerShell. Apagar qualquer coisa abre a confirmação do usuário no app: use o comando direto e espere.
`;

const NOTA_GROK = `

## Ferramentas neste motor (Grok)
- Você está rodando no Grok (xAI), com o plano do usuário. As ferramentas citadas acima como mcp__flow__<nome> são as do servidor MCP "flow"; mcp__navegador__* = navegador. Use-as do mesmo jeito.
- Os conectores do claude.ai (Gmail, Drive, Notion… da conta do Claude) NÃO existem neste motor. Se o pedido depender deles, diga isso no fim e sugira passar o bot para o Claude.
- IMAGEM E VÍDEO: você tem image_gen (gerar imagem), image_edit (editar uma imagem), image_to_video (animar uma imagem) e reference_to_video (vídeo a partir de referências). Use quando o usuário pedir imagem, foto, arte, criativo, animação ou vídeo gerado. O arquivo gerado aparece no chat do usuário sozinho: não precisa copiar nem entregar; só diga em uma frase o que foi feito.
- Skills: as da sua pasta .claude/skills estão disponíveis; quando o pedido for o caso de uma delas, leia o SKILL.md e siga.
- TERMINAL: as skills e as instruções do seu modelo foram escritas para o **Git Bash** ($FLOW_TRABALHO, export, aspas, ls/tail, heredoc). Rode esses comandos dentro do bash: bash -c '<comando da skill>' (o bash do Git já está no PATH; as variáveis FLOW_* já vêm prontas).
- Apagar qualquer coisa abre a confirmação do usuário no app. Se ele recusar, o turno para: não tente apagar de outro jeito.
`;

async function executarCodex(bot, item) {
  const nova = !bot.sessao;
  if (nova) { bot.sessaoInicio = Date.now(); bot.sessaoTurnos = 0; bot.ctxTokens = 0; }
  const mcp = montarMcp(bot, { flowUrl: FLOW_URL });
  const snapArq = path.join(dirBot(bot), '.flow', 'sistema.md');
  // os conectores do claude.ai (Gmail, Drive… da conta do Claude) não existem neste motor: no lugar deles, os apps da
  // conta do ChatGPT, que o Codex já entrega como ferramentas
  const nomeMotor = motorDo(bot);
  const ehGrok = nomeMotor === 'grok';
  const apps = ehGrok ? [] : (codex.appsEmCache() || []).filter((x) => x.ligado).map((x) => x.nome);
  const conectores = [...mcp.ativos.filter((c) => c.tipo !== 'claudeai'),
    ...(apps.length ? [{ nome: 'Apps da conta do ChatGPT', descricao: apps.join(', ') + '.' }] : [])];
  const snapshot = nova || bot.snapshotSujo || !fs.existsSync(snapArq) ? montarSnapshot(bot, { conectores, avisos: mcp.avisos }) : snapArq;
  bot.snapshotSujo = false;
  const instrucoes = fs.readFileSync(snapshot, 'utf8') + (ehGrok ? NOTA_GROK : NOTA_CODEX);
  const origemTxt = item.origem?.tipo === 'bot' ? `bot:${item.origem.id}` : item.origem?.tipo || 'usuario';
  const turno = db.iniciarTurno({ bot: bot.id, sessao: bot.sessao, origem: origemTxt });
  const inicio = Date.now();
  const estado = { child: null, turno, item, inicio, sessao: bot.sessao, parado: false, cadeia: item.cadeia || 0, motor: nomeMotor };
  ativos.set(bot.id, estado);
  salvarFilas();
  const longo = setTimeout(() => { try { ganchos.turnoLongo?.(bot, item); } catch (e) { console.error('[turno longo]', e.message); } }, 90e3);
  bot.ultimaAtividade = inicio;
  avisarEstado(bot);
  emitir('turno', { bot: bot.id, inicio: true, turno });

  const ferramentas = new Map();
  const add = (papel, texto, meta) => db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel, texto, meta });
  const r = await (ehGrok ? grok : codex).turno(bot, {
    env: envDoTurno(bot), item, texto: textoDoItem(item), instrucoes, mcpArquivo: mcp.arquivo, estado,
    cb: {
      delta: (t) => emitir('delta', { bot: bot.id, turno, texto: t }),
      texto: (t) => emitir('msg', add('bot', t, { turno })),
      ferramenta: (id, nome, resumo, sub) => {
        const m = add('ferramenta', `${nome} ${resumo}`.trim(), { turno, nome, resumo, id, sub: !!sub });
        ferramentas.set(id, m.id); emitir('msg', m);
      },
      ferramentaFim: (id, erro) => { if (ferramentas.has(id)) emitir('ferramenta', { bot: bot.id, msg: ferramentas.get(id), erro }); },
      limite: (info) => { limiteUso = { ...info, motor: nomeMotor, visto: Date.now() }; emitir('limite', limiteUso); },
      aviso: (t) => console.error(`[${bot.nome}] ${nomeMotor}:`, t),
      // Grok gerou imagem/vídeo: copia para as entregas do bot e mostra no chat
      midia: (arq, legenda) => {
        try {
          const dest = path.join(dirBot(bot), 'trabalho', 'entregas', 'grok');
          fs.mkdirSync(dest, { recursive: true });
          const nome = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${path.basename(arq)}`;
          const final = path.join(dest, nome);
          fs.copyFileSync(arq, final);
          if (templateDe(bot.template)?.midiaNoChat === false) return; // este bot entrega em quadro, do jeito dele
          import('./interno.js').then((i) => i.chamar(bot, 'arquivo_entregar', { caminho: final, legenda })).catch((e) => console.error('[grok midia]', e.message));
        } catch (e) { console.error('[grok midia]', e.message); }
      },
      pedirExclusao: async (x) => (await import('./interno.js')).pedirExclusao(bot, x),
    },
  });
  clearTimeout(longo);
  const dur = Date.now() - inicio;
  const parado = estado.parado || !!r.parado;
  const erro = r.erro && !parado ? r.erro : null;
  if (r.sessao && motorDo(bot) === nomeMotor) bot.sessao = r.sessao; // trocaram o motor durante o turno: não regrava
  if (r.ctx != null) bot.ctxTokens = r.ctx;
  if (r.ctxMax) bot.ctxMax = r.ctxMax;
  bot.sessaoTurnos = (bot.sessaoTurnos || 0) + 1;
  bot.ultimaAtividade = Date.now();
  bot.status = erro ? 'erro' : 'ocioso';
  salvarBot(bot);
  db.fecharTurno(turno, { status: parado ? 'parado' : erro ? 'erro' : 'ok', custo: null, contexto: bot.ctxTokens || null, erro });
  if (erro && ehLimiteDeUso(erro) && !item.especial) {
    bot.status = 'ocioso';
    salvarBot(bot);
    emitir('turno', { bot: bot.id, fim: true, turno, ms: dur, contexto: bot.ctxTokens });
    segurarPorLimite(bot, item, erro);
    return;
  }
  if (parado) emitir('msg', add('sistema', 'Parado pelo usuário.'));
  if (r.recusado && !parado) emitir('msg', add('sistema', 'Exclusão recusada: o Grok parou este turno sem apagar nada.'));
  if (erro) emitir('msg', add('sistema', `${ehGrok ? 'O Grok' : 'O ChatGPT (Codex)'} falhou: ${erro}`));
  emitir('turno', { bot: bot.id, fim: true, turno, ms: dur, contexto: bot.ctxTokens });
  const final = r.final || '';
  item.aguardar?.resolve?.({ texto: final, erro });
  try { ganchos.fimDoTurno?.(bot, item, { final, erro, parado, dur }); } catch (e) { console.error('[fim do turno]', e.message); }
  await depoisDoTurno(bot, item, { final, dur, erroCli: erro, parado });
}

async function depoisDoTurno(bot, item, { final, dur, erroCli, parado }) {
  // compactação terminou: guarda o resumo (se o bot não chamou sessao_resumir) e abre sessão nova no próximo turno
  if (item.especial === 'compactar') {
    if (!item.resumoFeito && final && !parado) mem.salvarResumo(bot, final);
    const antiga = bot.sessao;
    bot.sessaoAnterior = antiga;
    bot.sessao = null;
    bot.ctxTokens = 0;
    bot.sessaoTurnos = 0;
    salvarBot(bot);
    try { mem.arquivarTranscricao(bot, antiga); } catch (e) { console.error('[arquivo]', e.message); }
    emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, papel: 'sistema', texto: `Memória compactada (${item.motivo}). A próxima mensagem já começa numa sessão nova, com a função, a memória e o resumo.` }));
    return;
  }
  if (parado) return;

  const veioDeFora = item.origem?.tipo !== 'usuario';
  if (erroCli) {
    await notificar({ titulo: `${bot.nome} parou com erro`, texto: erroCli, bot: bot.id });
  } else if (veioDeFora || dur > config.push.terminouAposSeg * 1000 || !alguemVendo(bot.id)) {
    const resumo = final.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
    await notificar({ titulo: `${bot.nome} terminou`, texto: resumo || 'Turno concluído.', bot: bot.id });
  }

  const motivo = mem.precisaCompactar(bot);
  if (motivo) compactar(bot.id, motivo);
}

export function compactar(botId, motivo = 'pedido do usuário') {
  const bot = bots.get(botId);
  if (!bot?.sessao) return false;
  if ((filas.get(botId) || []).some((i) => i.especial === 'compactar')) return false;
  enviar(botId, { texto: mem.PROMPT_COMPACTAR, origem: { tipo: 'sistema' }, especial: 'compactar', motivo, frente: true });
  return true;
}

export function marcarResumo(botId) {
  const a = ativos.get(botId);
  if (a?.item?.especial === 'compactar') a.item.resumoFeito = true;
}

export const turnoAtivo = (botId) => ativos.get(botId) || null;
export const ocupado = (botId) => ativos.has(botId) || (filas.get(botId)?.length || 0) > 0;
export const squadDoBot = (botId) => squads.get(bots.get(botId)?.squad);
