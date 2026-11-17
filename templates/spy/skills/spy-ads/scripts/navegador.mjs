// Navegador do Spy: um Chromium próprio (Playwright), sem login, com o perfil na pasta do bot.
// Não é o navegador do Claude Flow (aquele está logado no Facebook do usuário e fica para a caça pesada).
// O Chromium fica em ~/ClaudeFlow/cache/navegadores (PLAYWRIGHT_BROWSERS_PATH, que o Claude Flow já passa).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = path.join(os.homedir(), 'ClaudeFlow', 'cache');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(CACHE, 'navegadores');
export const TRABALHO = process.env.FLOW_TRABALHO || path.join(process.cwd(), 'trabalho');
export const PASTA_SPY = path.join(TRABALHO, 'spy');
const PERFIL = path.join(PASTA_SPY, '.perfil-navegador');

let pw = null, contexto = null;

export async function abrir({ visivel = false } = {}) {
  if (contexto) return contexto;
  try { pw = await import('playwright'); }
  catch { throw new Error('Pacote playwright não encontrado. Rode "npm install" na pasta do Claude Flow.'); }
  fs.mkdirSync(PERFIL, { recursive: true });
  const opcoes = { headless: !visivel, locale: 'pt-BR', viewport: { width: 1400, height: 1000 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' };
  try {
    contexto = await pw.chromium.launchPersistentContext(PERFIL, { ...opcoes, channel: 'chromium' });
  } catch (e) {
    const m = String(e?.message || e);
    if (/Executable doesn't exist|browserType\.launch/i.test(m) && !/msedge/.test(m)) {
      // sem o Chromium do Playwright: tenta o Edge do Windows (perfil continua separado)
      try { contexto = await pw.chromium.launchPersistentContext(PERFIL, { ...opcoes, channel: 'msedge' }); }
      catch { throw new Error('Chromium do Spy não instalado. Rode: node node_modules/playwright/cli.js install chromium (na pasta do Claude Flow).'); }
    } else throw e;
  }
  return contexto;
}

export async function fechar() {
  const c = contexto; contexto = null;
  await c?.close().catch(() => {});
}

export async function novaAba() {
  const ctx = await abrir();
  return ctx.newPage();
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// argumentos "--chave valor" e "--flag" depois do comando
export function lerArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, o };
}

export const log = (...x) => console.error(...x);           // progresso vai para o stderr
export const saida = (obj) => console.log(JSON.stringify(obj, null, 1)); // resultado final no stdout

export function lerJSON(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}
export function gravarJSON(arq, dados) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(dados, null, 1));
}
