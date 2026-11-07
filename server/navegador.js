// Navegador próprio do Claude Flow: um Chrome (ou Edge/Chromium) com perfil separado do seu navegador pessoal,
// aberto com a porta de depuração (CDP) só em 127.0.0.1. Os bots usam esse navegador pelo Playwright MCP, e você
// pode abrir a mesma janela para entrar nas contas (TikTok, YouTube, Meta…): o login fica guardado no perfil.
//   perfil "principal"  compartilhado pelos bots que não pedem perfil próprio
//   perfil <id do bot>  quando o bot está com navegador "proprio"
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME, IS_WIN, config, expandir } from './config.js';

const RAIZ = path.join(HOME, 'navegador');
const processos = new Map();

export function perfilDoBot(bot) {
  if (!bot.navegador) return null;
  return bot.navegador === 'proprio' ? bot.id : bot.navegador;
}

export function porta(perfil) {
  if (perfil === 'principal') return config.navegador.portaBase;
  let h = 0;
  for (const c of perfil) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return config.navegador.portaBase + 1 + (h % 600);
}

export const endpoint = (perfil) => `http://127.0.0.1:${porta(perfil)}`;

export function acharChrome() {
  if (config.navegador.chrome) return expandir(config.navegador.chrome);
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidatos = IS_WIN ? [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidatos.find((c) => fs.existsSync(c)) || null;
}

async function versao(perfil) {
  try {
    const r = await fetch(`${endpoint(perfil)}/json/version`, { signal: AbortSignal.timeout(1000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export const ativo = async (perfil) => !!(await versao(perfil));

export async function ligar(perfil = 'principal', url = '') {
  if (await ativo(perfil)) {
    if (url) await fetch(`${endpoint(perfil)}/json/new?${encodeURI(url)}`, { method: 'PUT' }).catch(() => {});
    return { perfil, endpoint: endpoint(perfil), jaEstava: true };
  }
  const chrome = acharChrome();
  if (!chrome) throw new Error('Nenhum Chrome/Edge encontrado. Instale o Google Chrome ou defina navegador.chrome no config.json.');
  const dir = path.join(RAIZ, perfil);
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    `--remote-debugging-port=${porta(perfil)}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    url || 'about:blank',
  ];
  const p = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
  processos.set(perfil, p);
  for (let i = 0; i < 40; i++) {
    if (await ativo(perfil)) return { perfil, endpoint: endpoint(perfil), jaEstava: false };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('O navegador abriu, mas a porta de controle não respondeu em 10 s.');
}

export async function desligar(perfil = 'principal') {
  const v = await versao(perfil);
  if (!v) return false;
  await new Promise((resolve) => {
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    const fim = setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    ws.onmessage = () => { clearTimeout(fim); resolve(); };
    ws.onerror = () => { clearTimeout(fim); resolve(); };
  });
  processos.delete(perfil);
  return true;
}

export async function status() {
  fs.mkdirSync(RAIZ, { recursive: true });
  const perfis = new Set(['principal', ...fs.readdirSync(RAIZ)]);
  const out = [];
  for (const p of perfis) out.push({ perfil: p, porta: porta(p), ativo: await ativo(p) });
  return { chrome: acharChrome(), perfis: out };
}
