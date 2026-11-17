// Motor ChatGPT: os bots conversam com o Codex App Server (OpenAI), com o login da conta do ChatGPT do usuário
// (pasta própria em ~/ClaudeFlow/codex, separada de qualquer outro login do Codex neste computador).
//
// Um processo "codex app-server" por bot, aberto na primeira mensagem e mantido vivo enquanto ele trabalha
// (fecha sozinho depois de 15 min parado). Cada bot tem uma conversa (thread) que dura a sessão dele; o id fica
// em bot.sessao e é retomado depois de reinício. JSON-RPC: uma mensagem JSON por linha no stdin/stdout.
//
// Trava de exclusão: approvalPolicy "untrusted" faz o Codex pedir aprovação de todo comando que não é só leitura.
// Aqui o pedido é decidido na hora: o que não apaga nada passa direto; o que apaga (rm, del, Remove-Item, código
// que apaga, edição que remove arquivo, ferramenta de conector com trash/delete) abre a caixa "Confirmar exclusão"
// no app e espera o usuário — a mesma regra do gancho do Claude Code (exclusao.js).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { HOME, IS_WIN } from './config.js';
import { dirBot } from './store.js';
import { ehExclusaoComando, ehExclusaoFerramenta, exclusaoLivre } from './exclusao.js';

export const CODEX_HOME = process.env.FLOW_CODEX_HOME || path.join(HOME, 'codex');
const OCIOSO_MS = 15 * 60 * 1000;
const processos = new Map(); // botId -> Servidor

export function binCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (IS_WIN) {
    const npm = path.join(process.env.APPDATA || '', 'npm', 'codex.cmd');
    if (fs.existsSync(npm)) return npm;
  }
  return 'codex';
}

class Servidor {
  constructor(bot, env) {
    this.botId = bot.id;
    this.chaveEnv = JSON.stringify(env);
    this.id = 0;
    this.pendentes = new Map();
    this.ouvintes = new Set();
    this.vivo = true;
    const bin = binCodex();
    this.proc = spawn(bin, ['app-server'], {
      cwd: dirBot(bot), env: { ...env, CODEX_HOME }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      shell: IS_WIN && /\.cmd$/i.test(bin),
    });
    this.stderr = '';
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.stdin.on('error', () => {});
    this.proc.on('error', (e) => this.morrer(e.code === 'ENOENT' ? 'não achei o Codex instalado (npm install -g @openai/codex)' : e.message));
    this.proc.on('close', (code) => this.morrer(`o Codex fechou (código ${code}). ${this.stderr.trim().split('\n').slice(-2).join(' ')}`));
    readline.createInterface({ input: this.proc.stdout }).on('line', (l) => this.linha(l));
    this.pronto = this.pedir('initialize', { clientInfo: { name: 'claude-flow', title: 'Claude Flow', version: '1.0.0' } })
      .then(() => this.notificar('initialized'));
    this.usar();
  }

  linha(l) {
    let m; try { m = JSON.parse(l); } catch { return; }
    if (m.id !== undefined && !m.method && this.pendentes.has(m.id)) {
      const p = this.pendentes.get(m.id); this.pendentes.delete(m.id);
      return m.error ? p.no(new Error(m.error.message || JSON.stringify(m.error))) : p.ok(m.result);
    }
    for (const f of this.ouvintes) { try { f(m); } catch (e) { console.error('[codex]', e.message); } }
  }

  pedir(method, params = {}) {
    if (!this.vivo) return Promise.reject(new Error('o Codex não está rodando'));
    return new Promise((ok, no) => {
      const id = ++this.id;
      this.pendentes.set(id, { ok, no });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  responder(id, result) { if (this.vivo) this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
  notificar(method, params = {}) { if (this.vivo) this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }

  usar() {
    clearTimeout(this.relogio);
    this.relogio = setTimeout(() => { if (!this.ocupado) this.fechar(); }, OCIOSO_MS);
  }

  morrer(motivo) {
    if (!this.vivo) return;
    this.vivo = false;
    clearTimeout(this.relogio);
    for (const p of this.pendentes.values()) p.no(new Error(motivo));
    this.pendentes.clear();
    for (const f of this.ouvintes) { try { f({ method: '__morreu', params: { motivo } }); } catch {} }
    if (processos.get(this.botId) === this) processos.delete(this.botId);
  }

  fechar() {
    this.vivo = false;
    clearTimeout(this.relogio);
    matarArvore(this.proc);
    if (processos.get(this.botId) === this) processos.delete(this.botId);
  }
}

function matarArvore(p) {
  if (!p?.pid) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else p.kill('SIGTERM');
  } catch {}
}

async function servidorDo(bot, env) {
  let s = processos.get(bot.id);
  // chaves/pastas mudaram (conector novo, segredo salvo): abre um processo novo com o ambiente atualizado
  if (s && s.vivo && s.chaveEnv !== JSON.stringify(env) && !s.ocupado) { s.fechar(); s = null; }
  if (!s || !s.vivo) {
    s = new Servidor(bot, env);
    processos.set(bot.id, s);
    await s.pronto;
    // skills do bot (Perfect Edit, Baixar do Drive…): as mesmas pastas SKILL.md que o Claude Code usa
    const skills = path.join(dirBot(bot), '.claude', 'skills');
    if (fs.existsSync(skills)) await s.pedir('skills/extraRoots/set', { extraRoots: [skills] }).catch(() => {});
    if (!cacheApps) listarApps(s).then((a) => { cacheApps = a; }).catch(() => {});
  }
  await s.pronto;
  return s;
}

export function fecharDoBot(botId) { processos.get(botId)?.fechar(); }
export function fecharTodos() { for (const s of processos.values()) s.fechar(); }
export const pidDoBot = (botId) => processos.get(botId)?.proc?.pid || null;

// ---------- conectores: o mcp.json do Claude Flow vira mcp_servers do Codex ----------
function mcpParaCodex(arquivo) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch {}
  const out = {};
  for (const [nome, s] of Object.entries(j.mcpServers || {})) {
    const base = { startup_timeout_sec: 60, tool_timeout_sec: 3600 };
    if (s.type === 'http') out[nome] = { ...base, url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) };
    else out[nome] = { ...base, command: s.command, args: s.args || [], ...(s.env ? { env: s.env } : {}) };
  }
  return out;
}

// ---------- modelos e conta (para o seletor do app) ----------
let cacheModelos = null;
export async function modelos(bot, env) {
  if (cacheModelos && Date.now() - cacheModelos.quando < 10 * 60 * 1000) return cacheModelos.lista;
  const s = await servidorDo(bot, env);
  const r = await s.pedir('model/list', {});
  const lista = (r.data || []).filter((m) => !m.hidden).map((m) => ({
    id: m.id, nome: m.displayName || m.id, descricao: m.description || '', padrao: !!m.isDefault,
    esforcos: (m.supportedReasoningEfforts || []).map((e) => e.reasoningEffort), esforcoPadrao: m.defaultReasoningEffort,
  }));
  cacheModelos = { lista, quando: Date.now() };
  return lista;
}
export const modelosEmCache = () => cacheModelos?.lista || null;
let cacheApps = null;
export const appsEmCache = () => cacheApps;

export async function conta(bot, env) {
  const s = await servidorDo(bot, env);
  const [c, lim, apps] = await Promise.all([
    s.pedir('account/read', { refreshToken: true }).catch(() => null),
    s.pedir('account/rateLimits/read', {}).catch(() => null),
    listarApps(s).catch(() => []),
  ]);
  cacheApps = apps;
  return { conta: c?.account || null, limites: lim?.rateLimits || null, apps };
}

async function listarApps(s) {
  const out = []; let cursor = null;
  do {
    const r = await s.pedir('app/list', { limit: 200, cursor });
    out.push(...(r.data || []).filter((a) => a.isAccessible).map((a) => ({ id: a.id, nome: a.name, descricao: a.description, ligado: a.isEnabled, logo: a.logoUrl })));
    cursor = r.nextCursor;
  } while (cursor && out.length < 400);
  return out;
}

// ---------- o turno ----------
// Devolve uma promessa com { final, sessao, ctx, ctxMax, erro, parado }. "cb" recebe os eventos para o runner
// gravar no banco e mandar para a tela, igual ao motor do Claude: delta(texto), texto(texto), ferramenta(id, nome,
// resumo, sub), ferramentaFim(id, erro), limite(info), pedirExclusao({ferramenta, entrada, resumo}) -> Promise<bool>.
export function turno(bot, { env, item, texto, instrucoes, mcpArquivo, cb, estado }) {
  return new Promise(async (resolve) => {
    let s;
    try { s = await servidorDo(bot, env); } catch (e) { return resolve({ erro: e.message }); }
    s.ocupado = true; s.usar();
    const modelo = bot.modelo && !/^(opus|sonnet|haiku|fable|claude)/i.test(bot.modelo) ? bot.modelo : null;
    const esforco = bot.esforco || null;
    const comum = {
      cwd: dirBot(bot),
      approvalPolicy: 'untrusted',
      sandbox: 'danger-full-access',
      developerInstructions: instrucoes,
      config: { mcp_servers: mcpParaCodex(mcpArquivo) },
      ...(modelo ? { model: modelo } : {}),
    };

    // Instruções mudaram (função, memória, conectores, regras do Claude Flow): retomar a conversa antiga manteria as
    // instruções velhas, então abre uma conversa nova (a memória e os resumos vêm nas instruções).
    const assinatura = String(instrucoes.length) + ':' + [...instrucoes].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
    let threadId = bot.sessao && bot.codexInstrucoes === assinatura ? bot.sessao : null;
    let nova = !threadId;
    try {
      if (threadId) {
        try { await s.pedir('thread/resume', { threadId, ...comum }); } catch { threadId = null; nova = true; }
      }
      if (!threadId) {
        const r = await s.pedir('thread/start', comum);
        threadId = r.thread?.id || r.threadId || r.id;
      }
    } catch (e) { s.ocupado = false; return resolve({ erro: `não consegui abrir a conversa no Codex: ${e.message}` }); }

    const itens = new Map(); // itemId -> item (para saber o que um pedido de aprovação vai fazer)
    const textos = [];
    let ctx = null, ctxMax = null, turnId = null, acabou = false;
    const fim = (r) => {
      if (acabou) return; acabou = true;
      s.ouvintes.delete(ouvinte);
      s.ocupado = false; s.usar();
      bot.codexInstrucoes = assinatura;
      resolve({ final: textos.at(-1) || '', sessao: threadId, nova, ctx, ctxMax, ...r });
    };
    estado.interromper = () => { if (turnId) s.pedir('turn/interrupt', { threadId, turnId }).catch(() => {}); else fim({ parado: true }); };

    const ouvinte = async (m) => {
      const p = m.params || {};
      if (m.method === '__morreu') return fim({ erro: p.motivo });
      if (p.threadId && p.threadId !== threadId) return;

      // ----- pedidos do Codex que esperam resposta (aprovações) -----
      if (m.id !== undefined && m.method) {
        try { s.responder(m.id, await decidir(m.method, p)); } catch (e) { s.responder(m.id, { decision: 'decline' }); }
        return;
      }

      switch (m.method) {
        case 'turn/started': turnId = p.turn?.id || turnId; break;
        case 'item/agentMessage/delta': cb.delta?.(p.delta); break;
        case 'item/started': {
          const it = p.item; itens.set(it.id, it);
          const f = ferramentaDe(it);
          if (f) cb.ferramenta?.(it.id, f.nome, f.resumo, f.sub);
          break;
        }
        case 'item/completed': {
          const it = p.item; itens.set(it.id, it);
          if (it.type === 'agentMessage' && it.text?.trim()) { textos.push(it.text); cb.texto?.(it.text); }
          else if (ferramentaDe(it)) cb.ferramentaFim?.(it.id, ['failed', 'declined', 'error'].includes(it.status) || it.success === false || !!it.error);
          break;
        }
        case 'thread/tokenUsage/updated': {
          const u = p.tokenUsage || {};
          ctx = u.last?.inputTokens ?? ctx;
          ctxMax = u.modelContextWindow ?? ctxMax;
          break;
        }
        case 'account/rateLimits/updated': cb.limite?.(p.rateLimits || p); break;
        case 'turn/completed': {
          const t = p.turn || {};
          if (t.status === 'interrupted') return fim({ parado: true });
          if (t.status === 'failed') return fim({ erro: t.error?.message || JSON.stringify(t.error || {}).slice(0, 300) || 'o turno falhou' });
          return fim({});
        }
        case 'error': if (p.willRetry === false || !('willRetry' in p)) cb.aviso?.(p.error?.message || p.message || 'erro no Codex'); break;
      }
    };
    s.ouvintes.add(ouvinte);

    // Decide cada pedido de aprovação: o que não apaga passa; o que apaga vai para o usuário confirmar.
    async function decidir(metodo, p) {
      if (metodo === 'item/commandExecution/requestApproval' || metodo === 'execCommandApproval') {
        const cmd = p.command || '';
        if (!ehExclusaoComando(cmd)) return { decision: 'accept' };
        // temporários do próprio bot dentro da pasta de trabalho dele: sem perguntar (cada comando roda na pasta do bot)
        if (exclusaoLivre(limparComando(cmd), { env, cwd: path.dirname(env.FLOW_TRABALHO || '') })) return { decision: 'accept' };
        const ok = await cb.pedirExclusao({ ferramenta: 'Comando', entrada: { command: cmd }, resumo: limparComando(cmd) });
        return { decision: ok ? 'accept' : 'decline' };
      }
      if (metodo === 'item/fileChange/requestApproval' || metodo === 'applyPatchApproval') {
        const it = itens.get(p.itemId);
        const apagados = (it?.changes || []).filter((c) => c.kind?.type === 'delete').map((c) => c.path);
        if (!apagados.length) return { decision: 'accept' };
        const ok = await cb.pedirExclusao({ ferramenta: 'Apagar arquivo', entrada: { arquivos: apagados }, resumo: `apagar ${apagados.join(', ')}` });
        return { decision: ok ? 'accept' : 'decline' };
      }
      if (metodo === 'mcpServer/elicitation/request') {
        const nome = `${p.serverName || ''} ${p.toolName || p.message || ''}`;
        if (!ehExclusaoFerramenta(nome)) return { action: 'accept', content: null };
        const ok = await cb.pedirExclusao({ ferramenta: nome.trim(), entrada: p, resumo: String(p.message || nome).slice(0, 300) });
        return { action: ok ? 'accept' : 'decline', content: null };
      }
      if (metodo === 'item/permissions/requestApproval') return { permissions: p.permissions, scope: 'turn' };
      if (metodo === 'item/tool/requestUserInput') {
        // não há caixa de pergunta aqui: o bot pergunta no texto, no fim da mensagem
        return { answers: {} };
      }
      return { decision: 'accept' };
    }

    try {
      const r = await s.pedir('turn/start', { threadId, input: [{ type: 'text', text: texto }], ...(esforco ? { effort: esforco } : {}), ...(modelo ? { model: modelo } : {}) });
      turnId = r.turn?.id || turnId;
    } catch (e) { fim({ erro: e.message }); }
  });
}

// Uma ferramenta de conector que apaga pode vir como chamada direta (sem pedido de aprovação). O Codex manda o
// item ANTES de rodar só para comandos/edições; para conectores, a proteção é: approvalPolicy pede elicitação
// para ações "consequentes" dos apps, e o resumo abaixo deixa tudo visível no chat.
function ferramentaDe(it) {
  switch (it.type) {
    case 'commandExecution': return { nome: 'Bash', resumo: limparComando(it.command) };
    case 'mcpToolCall': return { nome: `mcp__${it.server}__${it.tool}`, resumo: resumoArgs(it.arguments) };
    case 'fileChange': return { nome: 'Edit', resumo: (it.changes || []).map((c) => c.path).join(', ').slice(0, 160) };
    case 'webSearch': return { nome: 'WebSearch', resumo: it.query || '' };
    case 'imageView': return { nome: 'Read', resumo: it.path || '' };
    case 'imageGeneration': return { nome: 'GerarImagem', resumo: it.revisedPrompt || '' };
    case 'collabAgentToolCall': return { nome: 'Agent', resumo: String(it.prompt || '').slice(0, 160) };
    case 'dynamicToolCall': return { nome: it.tool || 'ferramenta', resumo: resumoArgs(it.arguments) };
    default: return null;
  }
}

// "powershell.exe -Command \"ls\"" -> "ls"
export function limparComando(cmd) {
  let c = Array.isArray(cmd) ? cmd.join(' ') : String(cmd || '');
  c = c.replace(/^"?[^"\s]*(powershell|pwsh|bash|cmd)(\.exe)?"?\s+(-NoProfile\s+)?(-Command|-c|\/c)\s+/i, '').replace(/^"(.*)"$/s, '$1');
  return c.replace(/\s+/g, ' ').slice(0, 160);
}

function resumoArgs(a) {
  if (!a) return '';
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return a.slice(0, 160); } }
  const v = a.query || a.q || a.texto || a.para || a.url || a.path || a.name || a.title || Object.values(a).find((x) => typeof x === 'string') || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 160);
}
