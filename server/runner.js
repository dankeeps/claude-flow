// Executor dos bots. Cada mensagem vira um turno do Claude CLI em modo headless:
//   claude -p --output-format stream-json --resume <sessão> --append-system-prompt-file <foto da sessão> --mcp-config <bot>
// O processo só existe durante o turno (bot parado não ocupa memória). Um turno por bot de cada vez; o resto espera
// na fila. A sessão do CLI continua de um turno para o outro até a compactação, que abre uma sessão nova.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn as spawnNode } from 'node:child_process';
import spawn from 'cross-spawn';
import { IS_WIN, config, expandir, segredos } from './config.js';
import { bots, squads, salvarBot, dirBot } from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import { emitir, notificar, alguemVendo } from './eventos.js';
import { montarMcp } from './conectores.js';
import { montarSnapshot } from './prompt.js';

const filas = new Map(); // bot -> [itens]
const ativos = new Map(); // bot -> { child, turno, item, inicio, sessao, parado }
export let limiteUso = null; // último rate_limit_event do CLI (janela de 5 h da assinatura)

let FLOW_URL = 'http://127.0.0.1:4400';
export const definirUrl = (u) => { FLOW_URL = u; };

function binClaude() {
  if (config.claudeBin) return expandir(config.claudeBin);
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  return 'claude';
}

export function estadoBot(bot) {
  const a = ativos.get(bot.id);
  return { status: a ? 'trabalhando' : (filas.get(bot.id)?.length ? 'na fila' : bot.status === 'erro' ? 'erro' : 'ocioso'), fila: filas.get(bot.id)?.length || 0, desde: a?.inicio || null };
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
  if (!item.especial) {
    const papel = origem.tipo === 'usuario' ? 'usuario' : origem.tipo === 'bot' ? 'entrada' : 'sistema';
    const msg = db.addMensagem({
      bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel, de: origem.id || null, para: bot.id,
      texto: item.texto, meta: { anexos: item.anexos || [], deNome: origem.nome || null, aguardar: !!item.aguardar },
    });
    emitir('msg', msg);
  }
  const fila = filas.get(bot.id) || [];
  if (item.frente) fila.unshift(item); else fila.push(item);
  filas.set(bot.id, fila);
  avisarEstado(bot);
  if (!ativos.has(bot.id)) setImmediate(() => proximo(bot.id));
  return estadoBot(bot);
}

export function parar(botId, { limparFila = false } = {}) {
  const a = ativos.get(botId);
  if (limparFila) {
    for (const it of filas.get(botId) || []) it.aguardar?.resolve?.({ erro: 'cancelado pelo usuário' });
    filas.set(botId, []);
  }
  if (!a) { const b = bots.get(botId); if (b) avisarEstado(b); return false; }
  a.parado = true;
  matarArvore(a.child);
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
  if (o.tipo === 'bot') {
    t = `[Mensagem de @${o.nome} — bot do seu squad${item.aguardar ? '. Ele está esperando: a sua resposta final deste turno volta automaticamente para ele' : ''}]\n${t}`;
  }
  if (item.anexos?.length) {
    t += `\n\n[Anexos enviados pelo usuário]\n${item.anexos.map((a) => `- ${a.caminho} (${(a.tamanho / 1e6).toFixed(1)} MB)`).join('\n')}`;
  }
  return t;
}

// ---------- turno ----------
async function proximo(botId) {
  if (ativos.has(botId)) return;
  const fila = filas.get(botId) || [];
  const item = fila.shift();
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
    avisarEstado(bot);
    setImmediate(() => proximo(bot.id));
  }
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
  for (const p of bot.pastas || []) if (p && fs.existsSync(expandir(p))) a.push('--add-dir', expandir(p));
  if (mcp.bloquear.length) a.push('--disallowedTools', mcp.bloquear.join(','));
  return a;
}

function envDoTurno(bot) {
  const env = { ...process.env, ...segredos(), ...(bot.env || {}) };
  env.FLOW_URL = FLOW_URL;
  env.FLOW_BOT = bot.id;
  env.MCP_TOOL_TIMEOUT = String(Math.max(30, config.squad.esperaMaxMin + 5) * 60 * 1000);
  env.PYTHONUTF8 = '1';
  delete env.CLAUDECODE; // se o servidor foi aberto de dentro de outra sessão do Claude Code
  return env;
}

function resumoFerramenta(nome, entrada = {}) {
  const e = entrada || {};
  const s = e.command || e.description || e.file_path || e.path || e.pattern || e.url || e.query || e.para || e.skill || e.prompt || '';
  return String(s).replace(/\s+/g, ' ').slice(0, 160);
}

function executar(bot, item, tentativa = 0) {
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
      rl.close();
      const dur = Date.now() - inicio;
      const final = resultado?.result ?? textos.at(-1) ?? '';
      const erroCli = !resultado && !estado.parado ? (stderr.trim().split('\n').slice(-3).join(' ') || `o CLI saiu com código ${code}`) : null;

      // sessão sumiu (apagada pela limpeza do CLI, outro computador…): começa uma nova com a mesma memória
      if (!nova && !resultado && /No conversation found|session.*not found/i.test(stderr) && tentativa === 0) {
        db.fecharTurno(turno, { status: 'refeito', erro: 'sessão não encontrada' });
        bot.sessao = null;
        ativos.delete(bot.id);
        return executar(bot, item, 1).then(resolve, reject);
      }

      if (resultado?.session_id) bot.sessao = resultado.session_id;
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
      await depoisDoTurno(bot, item, { final, dur, erroCli, parado: estado.parado });
      resolve();
    });
  });
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
