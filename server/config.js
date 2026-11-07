// Caminhos, configuração e segredos do Claude Flow.
// Tudo que é do usuário mora em CLAUDE_FLOW_HOME (padrão: ~/ClaudeFlow). O repositório só tem código e templates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = expandir(process.env.CLAUDE_FLOW_HOME || '~/ClaudeFlow');
export const IS_WIN = process.platform === 'win32';

export function expandir(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const PADRAO = {
  porta: 4400,
  host: '127.0.0.1', // nunca 0.0.0.0: o acesso de fora é pelo Tailscale (docs/pwa-e-celular.md)
  urlPublica: '', // ex.: https://meu-pc.tail1234.ts.net — usado nos links das notificações
  hostsPermitidos: [], // além de localhost/127.0.0.1 e do host da urlPublica
  modeloPadrao: 'sonnet',
  claudeBin: '', // vazio = procura "claude" no PATH
  memoria: {
    limiteMemoria: 6000, // caracteres da memória de cada bot (fatos duráveis)
    limiteUsuario: 3000, // perfil do usuário, compartilhado por todos os bots
    limiteQuadro: 4000, // quadro do squad
    limiteFuncao: 10000,
    contextoMax: 200000, // tokens da janela de contexto do modelo
    compactarEm: 0.6, // compacta quando a sessão passa de 60% da janela
    compactarDias: 7, // ou quando a sessão tem mais de 7 dias
    resumosNoContexto: 3, // resumos das últimas sessões que entram no começo de cada sessão nova
    manterMensagensDias: 180, // histórico pesquisável no banco
    manterTranscricoesDias: 30, // transcrição bruta do CLI, compactada em .gz
  },
  squad: {
    maxCadeia: 8, // mensagens bot→bot seguidas sem o usuário falar; passou disso, para e avisa
    esperaMaxMin: 30, // quanto um bot espera a resposta de outro (bot_enviar com aguardar)
  },
  atlas: {
    dir: '~/Octo Edição/Atlas',
    url: 'http://localhost:4123',
    urlPublica: '', // ex.: https://meu-pc.tail1234.ts.net:8443 (tailscale serve --https=8443 4123)
  },
  navegador: {
    chrome: '', // vazio = procura Chrome/Edge/Chromium instalado
    portaBase: 9330,
  },
  push: {
    assunto: 'https://github.com/dankeeps/claude-flow',
    terminouAposSeg: 20, // avisa "terminou" quando o turno passou disso (ou veio de outro bot / da agenda)
  },
  segredosExtras: [], // outros arquivos NOME=valor para ler (ex.: "~/octopus.env")
};

const ARQ = path.join(HOME, 'config.json');
export let config = carregarConfig();

function mesclar(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mesclar(base[k], v) : v;
  }
  return out;
}

function carregarConfig() {
  fs.mkdirSync(HOME, { recursive: true });
  let salvo = {};
  try { salvo = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch {}
  const c = mesclar(PADRAO, salvo);
  if (process.env.CLAUDE_FLOW_PORTA) c.porta = Number(process.env.CLAUDE_FLOW_PORTA);
  if (!fs.existsSync(ARQ)) gravarJSON(ARQ, c);
  return c;
}

export function atualizarConfig(parcial) {
  config = mesclar(config, parcial);
  gravarJSON(ARQ, config);
  return config;
}

// ---------- segredos (chaves de API dos conectores) ----------
const ARQ_SEGREDOS = path.join(HOME, 'segredos.env');

function lerEnv(arq) {
  const out = {};
  try {
    for (const linha of fs.readFileSync(expandir(arq), 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

export function segredos() {
  let s = {};
  for (const extra of config.segredosExtras || []) s = { ...s, ...lerEnv(extra) };
  return { ...s, ...lerEnv(ARQ_SEGREDOS) };
}

export function gravarSegredos(novos) {
  const atual = lerEnv(ARQ_SEGREDOS);
  for (const [k, v] of Object.entries(novos)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    if (v === null || v === '') delete atual[k]; else atual[k] = String(v).trim();
  }
  const txt = Object.entries(atual).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ARQ_SEGREDOS, txt, { mode: 0o600 });
  try { fs.chmodSync(ARQ_SEGREDOS, 0o600); } catch {}
}

// ---------- utilidades de arquivo ----------
export function gravarJSON(arq, dados) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, arq);
}

export function lerJSON(arq, padrao = null) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}

export function lerTexto(arq, padrao = '') {
  try { return fs.readFileSync(arq, 'utf8'); } catch { return padrao; }
}

export function gravarTexto(arq, txt) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, txt);
  fs.renameSync(tmp, arq);
}

export function slug(nome) {
  const base = String(nome || 'item').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
