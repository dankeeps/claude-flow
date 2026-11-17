// Motor Grok: os bots conversam com o Grok Build (xAI), com o login do plano do usuário (SuperGrok), que o próprio
// "grok login" salva em ~/.grok. Nenhuma chave paga: o Claude Flow só abre o programa e conversa com ele.
//
// Protocolo: "grok agent stdio" fala ACP (Agent Client Protocol) — JSON-RPC, uma mensagem JSON por linha. Um processo
// por turno: initialize → session/new (ou session/load para continuar a conversa do bot) → session/prompt. O id da
// conversa fica em bot.sessao, como nos outros motores.
//
// Trava de exclusão: o Grok roda sozinho só o que é leitura; para o resto ele pede permissão (session/request_permission)
// e quem responde é este arquivo. O que não apaga passa; o que apaga (rm, del, Remove-Item, código que apaga,
// ferramenta de conector com delete/trash) abre a caixa "Confirmar exclusão" no app e espera o usuário — a mesma
// regra do gancho do Claude Code e do motor do ChatGPT (exclusao.js). Recusou: o Grok encerra o turno.
//
// Imagem e vídeo: o Grok tem image_gen, image_edit, image_to_video e reference_to_video (do plano). O arquivo que ele
// gera fica na pasta da sessão dele (~/.grok/sessions); aqui ele é copiado para a pasta de entregas do bot e aparece
// no chat sozinho (cb.midia).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { IS_WIN } from './config.js';
import { dirBot } from './store.js';
import { ehExclusaoComando, ehExclusaoFerramenta, exclusaoLivre } from './exclusao.js';
import { limparComando } from './codex.js';

const DIR = path.join(os.homedir(), '.grok');
export const binGrok = () => path.join(DIR, 'bin', IS_WIN ? 'grok.exe' : 'grok');
export const instalado = () => fs.existsSync(binGrok());
export const logado = () => fs.existsSync(path.join(DIR, 'auth.json'));
const FERRAMENTAS_MIDIA = new Set(['image_gen', 'image_edit', 'image_to_video', 'reference_to_video']);
const ESFORCOS = new Set(['low', 'medium', 'high', 'xhigh']);

// ---------- modelos (para o seletor do app) ----------
// Lidos da sessão do próprio Grok (o que a conta do usuário tem), guardados por 6 h.
const RESERVA = [
  { id: 'grok-4.7', nome: 'Grok 4.7', descricao: 'O mais capaz do Grok', esforcos: ['low', 'medium', 'high', 'xhigh'], padrao: true },
  { id: 'grok-4.7-build-fast', nome: 'Grok 4.7 Fast', descricao: 'Mais rápido (gasta o dobro do plano)', esforcos: ['low', 'medium', 'high', 'xhigh'] },
];
let cacheModelos = null;
export async function modelos() {
  if (cacheModelos && Date.now() - cacheModelos.quando < 6 * 3600e3) return cacheModelos.lista;
  if (!instalado() || !logado()) return RESERVA;
  try {
    const c = conexao(os.tmpdir(), process.env);
    await c.pedir('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const s = await c.pedir('session/new', { cwd: os.tmpdir(), mcpServers: [] });
    c.fechar();
    const atual = s.models?.currentModelId;
    const lista = (s.models?.availableModels || []).map((m) => ({
      id: m.modelId, nome: m.name || m.modelId,
      descricao: /Fast/i.test(m.name || '') ? 'Mais rápido (gasta o dobro do plano)' : m.modelId === atual ? 'O mais capaz do Grok' : 'Versão anterior',
      esforcos: (m._meta?.reasoningEfforts || []).map((e) => e.id).filter((e) => ESFORCOS.has(e)),
      padrao: m.modelId === atual,
    }));
    if (lista.length) cacheModelos = { quando: Date.now(), lista };
    return lista.length ? lista : RESERVA;
  } catch { return RESERVA; }
}
export const modelosEmCache = () => cacheModelos?.lista || RESERVA;

// ---------- conexão ACP com um processo "grok agent stdio" ----------
function conexao(cwd, env, extras = []) {
  const proc = spawn(binGrok(), ['agent', ...extras, 'stdio'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const esperando = new Map();
  const ouvintes = new Set();
  let id = 0, buf = '', stderr = '', morto = false;
  const escrever = (m) => { try { proc.stdin.write(JSON.stringify(m) + '\n'); } catch {} };
  const morrer = (motivo) => {
    if (morto) return; morto = true;
    for (const w of esperando.values()) w.erro(new Error(motivo));
    esperando.clear();
    for (const o of ouvintes) o({ method: '__morreu', params: { motivo } });
  };
  proc.stdout.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, n); buf = buf.slice(n + 1);
      if (!l.trim()) continue;
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.id !== undefined && !m.method) {
        const w = esperando.get(m.id); esperando.delete(m.id);
        if (w) m.error ? w.erro(new Error(m.error.message || JSON.stringify(m.error))) : w.ok(m.result);
      } else for (const o of ouvintes) o(m);
    }
  });
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-3000); });
  proc.stdin.on('error', () => {});
  proc.on('error', (e) => morrer(`o Grok não abriu: ${e.message}`));
  proc.on('exit', (c) => morrer(`o Grok fechou (${c ?? 'sinal'})${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400)}` : ''}`));
  return {
    proc, ouvintes,
    pedir: (method, params) => new Promise((ok, erro) => { if (morto) return erro(new Error('o Grok já fechou')); const i = ++id; esperando.set(i, { ok, erro }); escrever({ jsonrpc: '2.0', id: i, method, params }); }),
    avisar: (method, params) => escrever({ jsonrpc: '2.0', method, params }),
    responder: (i, result) => escrever({ jsonrpc: '2.0', id: i, result }),
    recusar: (i, message) => escrever({ jsonrpc: '2.0', id: i, error: { code: -32601, message } }),
    fechar: () => { morto = true; matarArvore(proc); },
  };
}

function matarArvore(p) {
  if (!p?.pid) return;
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else try { p.kill('SIGTERM'); } catch {}
}

// mcp.json do Claude Flow (formato do Claude) -> lista do ACP
function mcpParaAcp(arquivo) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch {}
  const lista = (o) => Object.entries(o || {}).map(([name, value]) => ({ name, value: String(value) }));
  return Object.entries(j.mcpServers || {}).map(([nome, s]) => (s.type === 'http'
    ? { type: 'http', name: nome, url: s.url, headers: lista(s.headers) }
    : { name: nome, command: s.command, args: s.args || [], env: lista(s.env) }));
}

const assinaturaDe = (t) => String(t.length) + ':' + [...t].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);

// ---------- o turno ----------
// Mesma forma do motor do ChatGPT: devolve { final, sessao, ctx, ctxMax, erro, parado }; "cb" recebe delta, texto,
// ferramenta, ferramentaFim, aviso, pedirExclusao e midia(caminho, legenda).
export function turno(bot, { env, texto, instrucoes, mcpArquivo, cb, estado }) {
  return new Promise(async (resolve) => {
    if (!instalado()) return resolve({ erro: 'O Grok não está instalado neste PC (Conectores › Grok).' });
    if (!logado()) return resolve({ erro: 'Falta entrar na conta do Grok: rode "grok login" no PowerShell (Conectores › Grok).' });
    const modelo = bot.modelo && /^grok/i.test(bot.modelo) ? bot.modelo : null;
    const esforco = ESFORCOS.has(bot.esforco) ? bot.esforco : null;
    const extras = [...(modelo ? ['-m', modelo] : []), ...(esforco ? ['--reasoning-effort', esforco] : [])];
    const cwd = dirBot(bot);
    const c = conexao(cwd, env, extras);
    const mcpServers = mcpParaAcp(mcpArquivo);
    const assinatura = assinaturaDe(instrucoes);

    let sessao = null, nova = false, carregando = false, acabou = false;
    let ctx = null, ctxMax = null, partes = [];
    const textos = [];
    const ferramentas = new Map(); // toolCallId -> { nome, entrada }
    const fim = (r) => {
      if (acabou) return; acabou = true;
      fecharTexto();
      c.fechar();
      bot.grokInstrucoes = assinatura;
      resolve({ final: textos.at(-1) || '', sessao, nova, ctx, ctxMax, ...r });
    };
    // o texto chega em pedaços; vira uma mensagem no chat quando vem uma ferramenta ou o fim
    function fecharTexto() {
      const t = partes.join('').trim(); partes = [];
      if (t) { textos.push(t); cb.texto?.(t); }
    }
    estado.interromper = () => { if (sessao) c.avisar('session/cancel', { sessionId: sessao }); setTimeout(() => fim({ parado: true }), 4000); };

    c.ouvintes.add(async (m) => {
      const p = m.params || {};
      if (m.method === '__morreu') return fim(acabou ? {} : { erro: p.motivo });
      // pedidos que esperam resposta
      if (m.id !== undefined && m.method) {
        if (m.method === 'session/request_permission') {
          let ok = false;
          try { ok = await decidir(p.toolCall || {}); } catch {}
          const op = (p.options || []).find((o) => o.kind === (ok ? 'allow_once' : 'reject_once'));
          return c.responder(m.id, { outcome: op ? { outcome: 'selected', optionId: op.optionId } : { outcome: 'cancelled' } });
        }
        return c.recusar(m.id, 'não suportado pelo Claude Flow');
      }
      if (carregando || (p.sessionId && sessao && p.sessionId !== sessao)) return; // session/load repete a conversa antiga
      const u = p.update || {};
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': {
          const t = u.content?.text || '';
          if (t) { partes.push(t); cb.delta?.(t); }
          break;
        }
        case 'tool_call': {
          fecharTexto();
          const nome = u._meta?.['x.ai/tool']?.name || u.title || 'ferramenta';
          const entrada = u.rawInput || {};
          ferramentas.set(u.toolCallId, { nome, entrada });
          cb.ferramenta?.(u.toolCallId, nomeAmigavel(nome), resumoDe(nome, entrada), false);
          break;
        }
        case 'tool_call_update': {
          if (!['completed', 'failed'].includes(u.status)) break;
          const f = ferramentas.get(u.toolCallId);
          cb.ferramentaFim?.(u.toolCallId, u.status === 'failed');
          if (f && u.status === 'completed' && FERRAMENTAS_MIDIA.has(f.nome)) {
            for (const arq of arquivosDe(u)) cb.midia?.(arq, String(f.entrada.prompt || '').replace(/\s+/g, ' ').slice(0, 120));
          }
          break;
        }
        case 'response_completed': {
          const us = u.usage || {};
          const total = (us.input_tokens || 0) + (us.cache_read_input_tokens || 0) + (us.cache_creation_input_tokens || 0);
          if (total) ctx = total;
          break;
        }
      }
    });

    // Decide cada pedido de permissão: o que não apaga passa; o que apaga vai para o usuário confirmar.
    async function decidir(tc) {
      const nome = tc._meta?.['x.ai/tool']?.name || tc.title || '';
      const ent = tc.rawInput || tc._meta?.['x.ai/tool']?.input || {};
      if (tc.kind === 'execute' || ent.command) {
        const cmd = String(ent.command || '');
        if (!ehExclusaoComando(cmd)) return true;
        if (exclusaoLivre(limparComando(cmd), { env, cwd: path.dirname(env.FLOW_TRABALHO || '') })) return true;
        return cb.pedirExclusao({ ferramenta: 'Comando', entrada: { command: cmd }, resumo: limparComando(cmd) });
      }
      if (tc.kind === 'delete') return cb.pedirExclusao({ ferramenta: 'Apagar arquivo', entrada: ent, resumo: `apagar ${ent.path || ent.target_file || JSON.stringify(ent).slice(0, 200)}` });
      const rotulo = `${nome} ${tc.title || ''}`;
      if (ehExclusaoFerramenta(rotulo)) return cb.pedirExclusao({ ferramenta: nome || 'Ferramenta', entrada: ent, resumo: String(tc.title || nome).slice(0, 300) });
      return true;
    }

    try {
      const ini = await c.pedir('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      void ini;
      // instruções mudaram (função, memória, conectores): conversa nova, com as instruções novas no começo
      if (bot.sessao && bot.grokInstrucoes === assinatura) {
        carregando = true;
        try { const r = await c.pedir('session/load', { sessionId: bot.sessao, cwd, mcpServers }); sessao = bot.sessao; ctxMax = maxDe(r, modelo) || ctxMax; }
        catch { sessao = null; }
        carregando = false;
      }
      if (!sessao) {
        const r = await c.pedir('session/new', { cwd, mcpServers });
        sessao = r.sessionId; nova = true;
        ctxMax = maxDe(r, modelo);
      }
      const corpo = nova
        ? `<instrucoes_do_claude_flow>\n${instrucoes}\n</instrucoes_do_claude_flow>\n\nSiga as instruções acima durante toda esta conversa. Agora, a mensagem:\n\n${texto}`
        : texto;
      const r = await c.pedir('session/prompt', { sessionId: sessao, prompt: [{ type: 'text', text: corpo }] });
      if (r?.stopReason === 'cancelled') {
        const cat = r._meta?.cancellationCategory;
        if (cat === 'PermissionRejected') { fecharTexto(); return fim({ recusado: true }); }
        return fim({ parado: true });
      }
      if (r?.stopReason === 'refusal') return fim({ erro: 'o Grok se recusou a responder' });
      fim({});
    } catch (e) { fim({ erro: e.message }); }
  });
}

function maxDe(r, modelo) {
  const ms = r?.models?.availableModels || [];
  const m = ms.find((x) => x.modelId === (modelo || r?.models?.currentModelId)) || ms[0];
  return m?._meta?.totalContextTokens || null;
}

// O arquivo que uma ferramenta de imagem/vídeo gerou: vem como JSON {"path": ...} no texto do resultado.
function arquivosDe(u) {
  const out = [];
  for (const ct of u.content || []) {
    const t = ct?.content?.text || ct?.text || '';
    let j = null; try { j = JSON.parse(t); } catch {}
    for (const p of [j?.path, ...(Array.isArray(j?.paths) ? j.paths : []), ...(Array.isArray(j?.files) ? j.files.map((f) => f?.path || f) : [])]) {
      if (typeof p === 'string' && fs.existsSync(p)) out.push(p);
    }
    if (!j) for (const mm of t.matchAll(/([A-Za-z]:\\[^"\n]+?\.(?:jpe?g|png|webp|gif|mp4|mov|webm))/gi)) if (fs.existsSync(mm[1])) out.push(mm[1]);
  }
  for (const l of u.locations || []) if (l?.path && /\.(jpe?g|png|webp|gif|mp4|mov|webm)$/i.test(l.path) && fs.existsSync(l.path)) out.push(l.path);
  return [...new Set(out)];
}

const NOMES = {
  run_terminal_command: 'Bash', read_file: 'Read', search_replace: 'Edit', write: 'Write', list_dir: 'LS', grep: 'Grep',
  web_search: 'WebSearch', web_fetch: 'WebFetch', spawn_subagent: 'Agent', todo_write: 'TodoWrite',
  image_gen: 'GerarImagem', image_edit: 'EditarImagem', image_to_video: 'GerarVideo', reference_to_video: 'GerarVideo',
};
const nomeAmigavel = (n) => NOMES[n] || n;
function resumoDe(nome, e = {}) {
  if (nome === 'run_terminal_command') return limparComando(e.command || '');
  const v = e.prompt || e.target_file || e.file_path || e.path || e.pattern || e.query || e.url || e.description || Object.values(e).find((x) => typeof x === 'string') || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 160);
}
