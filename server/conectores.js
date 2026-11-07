// Monta, para cada turno, o arquivo --mcp-config do bot: o servidor "flow" (squad, memória, notificação), o
// navegador (Playwright MCP ligado no Chrome do Claude Flow) e os conectores stdio/http que o bot tem ligados.
// Os conectores da conta claude.ai (Gmail, Drive…) chegam sozinhos no CLI: os que o bot NÃO tem ligados são
// bloqueados com --disallowedTools mcp__claude_ai_<Nome>.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO, IS_WIN, lerJSON, segredos } from './config.js';
import { dirBot } from './store.js';
import { perfilDoBot, endpoint } from './navegador.js';

const require = createRequire(import.meta.url);
export const catalogo = () => lerJSON(path.join(REPO, 'conectores', 'catalogo.json'), { conectores: [] }).conectores;

export const prefixoClaudeAi = (servidor) => `mcp__${servidor.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

function trocar(valor, chaves, faltando) {
  if (typeof valor === 'string') {
    return valor.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => {
      if (chaves[k] === undefined) { faltando.add(k); return ''; }
      return chaves[k];
    });
  }
  if (Array.isArray(valor)) return valor.map((v) => trocar(v, chaves, faltando));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, trocar(v, chaves, faltando)]));
  return valor;
}

// No Windows, npx/uvx como servidor MCP precisam de "cmd /c".
function comando(cmd, args) {
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

export function montarMcp(bot, { flowUrl }) {
  const chaves = segredos();
  const ligados = new Set(bot.conectores || []);
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

  for (const c of catalogo()) {
    const on = ligados.has(c.id);
    if (c.tipo === 'claudeai') {
      if (on) ativos.push(c); else bloquear.push(prefixoClaudeAi(c.servidor));
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
      ativos.push(c);
      continue;
    }
    if (c.tipo === 'atlas') { ativos.push(c); continue; }
    const faltando = new Set();
    if (c.tipo === 'stdio') {
      const { command, args } = comando(c.comando, trocar(c.args || [], chaves, faltando));
      servidores[c.id] = { type: 'stdio', command, args, env: trocar(c.env || {}, chaves, faltando) };
    } else if (c.tipo === 'http') {
      servidores[c.id] = { type: 'http', url: trocar(c.url, chaves, faltando), ...(c.headers ? { headers: trocar(c.headers, chaves, faltando) } : {}) };
    }
    if (faltando.size) {
      delete servidores[c.id];
      avisos.push(`${c.nome}: falta a chave ${[...faltando].join(', ')} (Conectores > Chaves).`);
      continue;
    }
    ativos.push(c);
  }

  const arq = path.join(dirBot(bot), '.flow', 'mcp.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ mcpServers: servidores }, null, 2), { mode: 0o600 });
  return { arquivo: arq, bloquear, avisos, ativos };
}

export function statusConectores() {
  const chaves = segredos();
  return catalogo().map((c) => ({
    ...c,
    chavesOk: (c.segredos || []).every((s) => chaves[s.nome]),
    segredos: (c.segredos || []).map((s) => ({ ...s, salva: !!chaves[s.nome] })),
  }));
}

