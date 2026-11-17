// Conectores: o catálogo (conectores/catalogo.json) + as contas extras do usuário (~/ClaudeFlow/contas.json).
// Cada item da lista é uma "instância": a conta principal de cada conector do catálogo, mais as contas a mais dos
// conectores com multiContas (ex.: um segundo token da Apify, outra conta Google). Quem escolhe o que usar é o squad:
// todos os bots do squad recebem os mesmos conectores.
//
// Para cada turno monta o --mcp-config do bot: o servidor "flow" (squad, memória, notificação), o navegador
// (Playwright MCP ligado no Chrome do Claude Flow) e os conectores stdio/http ligados no squad. Os conectores da conta
// claude.ai (Gmail, Drive…) chegam sozinhos no CLI: os desligados no squad são bloqueados com --disallowedTools.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import spawn from 'cross-spawn';
import { REPO, HOME, IS_WIN, config, expandir, lerJSON, gravarJSON, segredos } from './config.js';
import { dirBot, conectoresDoBot } from './store.js';
import { perfilDoBot, endpoint } from './navegador.js';
import * as voicestudio from './voicestudio.js';

const require = createRequire(import.meta.url);
export const catalogo = () => lerJSON(path.join(REPO, 'conectores', 'catalogo.json'), { conectores: [] }).conectores;

export const prefixoClaudeAi = (servidor) => `mcp__${servidor.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

// ---------- contas extras e campos por conta ----------
const ARQ_CONTAS = path.join(HOME, 'contas.json');
const lerContas = () => ({ contas: [], campos: {}, ...lerJSON(ARQ_CONTAS, {}) });
const gravarContas = (d) => gravarJSON(ARQ_CONTAS, d);

// Chave de uma conta extra: APIFY_TOKEN da conta "apify-2" fica salva como APIFY_TOKEN__APIFY_2.
const sufixo = (instId) => instId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
export function nomeChave(inst, s) {
  return inst.extra && !s.compartilhado ? `${s.nome}__${sufixo(inst.id)}` : s.nome;
}

export function instancias() {
  const cat = catalogo();
  const { contas, campos } = lerContas();
  const porId = new Map(cat.map((c) => [c.id, c]));
  const lista = cat.map((c) => ({ ...c, base: c.id, extra: false, campos: campos[c.id] || {} }));
  for (const k of contas) {
    const c = porId.get(k.base);
    if (!c) continue;
    lista.push({ ...c, id: k.id, base: c.id, extra: true, rotuloConta: k.nome, nome: `${c.nome} · ${k.nome}`, campos: campos[k.id] || {} });
  }
  return lista;
}

export function criarConta({ base, nome }) {
  const c = catalogo().find((x) => x.id === base);
  if (!c) throw Object.assign(new Error('conector desconhecido'), { status: 400 });
  if (!c.multiContas) throw Object.assign(new Error(`${c.nome} não aceita mais de uma conta`), { status: 400 });
  const rotulo = String(nome || '').trim().slice(0, 40);
  if (!rotulo) throw Object.assign(new Error('dê um nome para a conta (ex.: Trabalho)'), { status: 400 });
  const d = lerContas();
  let n = 2;
  while (d.contas.some((k) => k.id === `${base}-${n}`)) n++;
  const conta = { id: `${base}-${n}`, base, nome: rotulo, criado: Date.now() };
  d.contas.push(conta);
  gravarContas(d);
  return conta;
}

export function renomearConta(id, nome) {
  const d = lerContas();
  const k = d.contas.find((x) => x.id === id);
  if (!k) throw Object.assign(new Error('conta não encontrada'), { status: 404 });
  k.nome = String(nome || '').trim().slice(0, 40) || k.nome;
  gravarContas(d);
  return k;
}

// Tira a conta extra da lista. Devolve os nomes das chaves dela, para o servidor apagar de segredos.env.
export function removerConta(id) {
  const d = lerContas();
  const k = d.contas.find((x) => x.id === id);
  if (!k) throw Object.assign(new Error('conta não encontrada'), { status: 404 });
  const inst = instancias().find((x) => x.id === id);
  d.contas = d.contas.filter((x) => x.id !== id);
  delete d.campos[id];
  gravarContas(d);
  return (inst?.segredos || []).filter((s) => !s.compartilhado).map((s) => nomeChave(inst, s));
}

export function gravarCampos(instId, campos = {}) {
  const inst = instancias().find((x) => x.id === instId);
  if (!inst) throw Object.assign(new Error('conector não encontrado'), { status: 404 });
  const d = lerContas();
  const aceitos = new Set((inst.camposConta || []).map((c) => c.nome));
  const novos = Object.fromEntries(Object.entries(campos).filter(([k]) => aceitos.has(k)).map(([k, v]) => [k, String(v ?? '').trim()]));
  d.campos[instId] = { ...(d.campos[instId] || {}), ...novos };
  gravarContas(d);
  return d.campos[instId];
}

// Valores que entram no ${...} de uma instância: as chaves (com as da própria conta no lugar), os campos dela
// (ex.: EMAIL) e ${PASTA_CONTA}, uma pasta só desta conta (logins/tokens que o servidor MCP guarda).
function valoresDaInstancia(inst, chaves) {
  const v = { ...chaves };
  for (const s of inst.segredos || []) v[s.nome] = chaves[nomeChave(inst, s)];
  Object.assign(v, inst.campos || {});
  v.PASTA_CONTA = path.join(HOME, 'contas', inst.id);
  v.CONTA = inst.id;
  return v;
}

function trocar(valor, chaves, faltando) {
  if (typeof valor === 'string') {
    return valor.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => {
      if (chaves[k] === undefined || chaves[k] === '') { faltando.add(k); return ''; }
      return chaves[k];
    });
  }
  if (Array.isArray(valor)) return valor.map((v) => trocar(v, chaves, faltando));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, trocar(v, chaves, faltando)]));
  return valor;
}

// uvx instalado depois que o servidor ligou não está no PATH dele: procura nos lugares de instalação conhecidos.
function acharUvx() {
  const exe = IS_WIN ? 'uvx.exe' : 'uvx';
  const locais = [path.join(os.homedir(), '.local', 'bin', exe), path.join(os.homedir(), '.cargo', 'bin', exe)];
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (IS_WIN && fs.existsSync(winget)) {
    for (const d of fs.readdirSync(winget)) if (d.startsWith('astral-sh.uv')) locais.push(path.join(winget, d, exe));
  }
  return locais.find((p) => fs.existsSync(p)) || null;
}

// No Windows, npx/uvx como servidor MCP precisam de "cmd /c" (uvx achado pelo caminho completo roda direto).
function comando(cmd, args) {
  if (cmd === 'uvx') { const uvx = acharUvx(); if (uvx) return { command: uvx, args }; }
  if (IS_WIN && ['npx', 'uvx', 'npm', 'pnpm'].includes(cmd)) return { command: 'cmd', args: ['/c', cmd, ...args] };
  return { command: cmd, args };
}

function playwrightCli() {
  try {
    const pkg = require.resolve('@playwright/mcp/package.json');
    const dir = path.dirname(pkg);
    const bin = lerJSON(pkg)?.bin;
    const rel = typeof bin === 'string' ? bin : bin && Object.values(bin)[0];
    return path.join(dir, rel || 'cli.js');
  } catch { return null; }
}

// Nome do servidor MCP de uma instância (vira o prefixo das ferramentas: mcp__<nome>__...).
const nomeServidor = (inst) => inst.id.replace(/[^a-zA-Z0-9_-]/g, '_');

export function montarMcp(bot, { flowUrl }) {
  const chaves = segredos();
  const ligados = new Set(conectoresDoBot(bot));
  const servidores = {
    flow: {
      type: 'stdio',
      command: process.execPath,
      args: [path.join(REPO, 'server', 'mcp', 'flow-mcp.js')],
      env: { FLOW_URL: flowUrl, FLOW_TOKEN: bot.token, FLOW_BOT: bot.id, FLOW_PERMISSAO: bot.autonomia === 'perguntar' ? '1' : '' },
    },
  };
  const bloquear = ['AskUserQuestion']; // no modo headless não há caixa de pergunta: o bot pergunta no texto
  const avisos = [];
  const ativos = [];

  for (const c of instancias()) {
    const on = ligados.has(c.id);
    if (c.tipo === 'claudeai') {
      if (on) ativos.push({ ...c, prefixo: prefixoClaudeAi(c.servidor) }); else bloquear.push(prefixoClaudeAi(c.servidor));
      continue;
    }
    if (!on) continue;
    if (c.tipo === 'navegador') {
      const perfil = perfilDoBot(bot);
      const cli = playwrightCli();
      if (!perfil) continue;
      if (!cli) { avisos.push('Navegador: pacote @playwright/mcp não instalado (rode npm install).'); continue; }
      servidores.navegador = {
        type: 'stdio',
        command: process.execPath,
        args: [cli, '--cdp-endpoint', endpoint(perfil), '--output-dir', path.join(dirBot(bot), 'trabalho', 'navegador')],
      };
      ativos.push({ ...c, prefixo: 'mcp__navegador' });
      continue;
    }
    if (c.tipo === 'atlas') { ativos.push(c); continue; }
    if (c.tipo === 'voicestudio') { // servidor local do VoiceStudio (o runner liga ele antes do turno)
      if (!voicestudio.onde().instalado) { avisos.push('VoiceStudio: não está instalado neste computador.'); continue; }
      servidores.voicestudio = { type: 'http', url: voicestudio.URL_MCP, headers: { 'X-OmniVoice-Client-Id': `claude-flow-${bot.id}` } };
      ativos.push({ ...c, prefixo: 'mcp__voicestudio' });
      continue;
    }
    if (c.tipo === 'integracao') { if ((c.segredos || []).every((x) => chaves[nomeChave(c, x)])) ativos.push(c); continue; } // chave vira variável (skill do bot usa)
    if (c.tipo === 'chatgpt') { ativos.push(c); continue; } // vem pelos apps da conta do ChatGPT
    if (c.tipo === 'grok') continue; // é motor, não conector
    const faltando = new Set();
    const valores = valoresDaInstancia(c, chaves);
    const nome = nomeServidor(c);
    if (c.tipo === 'stdio') {
      const { command, args } = comando(c.comando, trocar(c.args || [], valores, faltando));
      servidores[nome] = { type: 'stdio', command, args, env: trocar(c.env || {}, valores, faltando) };
      if (JSON.stringify(c.env || {}).includes('${PASTA_CONTA}')) fs.mkdirSync(valores.PASTA_CONTA, { recursive: true });
    } else if (c.tipo === 'http') {
      servidores[nome] = { type: 'http', url: trocar(c.url, valores, faltando), ...(c.headers ? { headers: trocar(c.headers, valores, faltando) } : {}) };
    }
    if (faltando.size) {
      delete servidores[nome];
      avisos.push(`${c.nome}: falta configurar ${[...faltando].join(', ')} (tela Conectores).`);
      continue;
    }
    ativos.push({ ...c, prefixo: `mcp__${nome}` });
  }

  const arq = path.join(dirBot(bot), '.flow', 'mcp.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ mcpServers: servidores }, null, 2), { mode: 0o600 });
  return { arquivo: arq, bloquear, avisos, ativos };
}

// ---------- status real dos conectores da conta claude.ai ("claude mcp list") ----------
let statusClaude = {}; // "claude.ai Gmail" -> connected | needs-auth | failed
let statusQuando = 0;
let consultando = null;

export function atualizarStatusClaude() {
  if (consultando) return consultando;
  consultando = new Promise((resolve) => {
    const bin = config.claudeBin ? expandir(config.claudeBin) : (process.env.CLAUDE_BIN || 'claude');
    const env = { ...process.env };
    delete env.CLAUDECODE;
    let saida = '';
    let p;
    try { p = spawn(bin, ['mcp', 'list'], { cwd: HOME, windowsHide: true, env }); } catch { consultando = null; resolve(statusClaude); return; }
    const fim = setTimeout(() => p.kill(), 90_000);
    p.stdout.on('data', (d) => { saida += d; });
    p.on('error', () => {});
    p.on('close', () => {
      clearTimeout(fim);
      const novo = {};
      for (const linha of saida.split(/\r?\n/)) {
        const m = linha.match(/^(claude\.ai [^:]+):.*\s-\s+(.+)$/);
        if (!m) continue;
        const t = m[2].toLowerCase();
        novo[m[1].trim()] = t.includes('connected') ? 'connected' : t.includes('auth') ? 'needs-auth' : 'failed';
      }
      if (Object.keys(novo).length) { statusClaude = novo; statusQuando = Date.now(); }
      consultando = null;
      resolve(statusClaude);
    });
  });
  return consultando;
}

// Situação de cada conector para o app (as chaves nunca saem daqui, só "salva" ou não):
// conectado | entrar (refazer login no claude.ai) | falhou | desconectado | verificando | configurar | login | local
// Grok Build (xAI): instalado em ~/.grok/bin e com login salvo em ~/.grok/auth.json (o "grok login" grava ali).
// Só olha se os arquivos existem; o conteúdo do login nunca é lido aqui.
export const grokBin = () => path.join(os.homedir(), '.grok', 'bin', IS_WIN ? 'grok.exe' : 'grok');
function situacaoGrok() {
  if (!fs.existsSync(grokBin())) return 'instalar';
  return fs.existsSync(path.join(os.homedir(), '.grok', 'auth.json')) ? 'conectado' : 'entrarGrok';
}

export function statusConectores() {
  const chaves = segredos();
  return instancias().map((c) => {
    const segs = (c.segredos || []).map((s) => ({ ...s, chave: nomeChave(c, s), salva: !!chaves[nomeChave(c, s)] }));
    const camposOk = (c.camposConta || []).every((k) => c.campos?.[k.nome]);
    let situacao;
    if (c.tipo === 'claudeai') {
      const st = statusClaude[c.servidor];
      situacao = st === 'connected' ? 'conectado' : st === 'needs-auth' ? 'entrar' : st === 'failed' ? 'falhou' : statusQuando ? 'desconectado' : 'verificando';
    } else if (c.tipo === 'navegador' || c.tipo === 'atlas') situacao = 'local';
    else if (c.tipo === 'voicestudio') situacao = voicestudio.onde().instalado ? 'local' : 'instalar';
    else if (c.tipo === 'chatgpt') situacao = 'chatgpt';
    else if (c.tipo === 'grok') situacao = situacaoGrok();
    else if (c.oauth) situacao = 'login';
    else situacao = segs.every((s) => s.salva) && camposOk ? 'conectado' : 'configurar';
    return { ...c, segredos: segs, chavesOk: segs.every((s) => s.salva), camposOk, situacao };
  });
}

export const idValido = (id) => instancias().some((c) => c.id === id);
