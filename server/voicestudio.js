// VoiceStudio (open source, github.com/debpalash/VoiceStudio): estúdio de voz local, alternativa ao ElevenLabs.
// Fica em ~/VoiceStudio (código-fonte da v0.5.7, sem o instalador .exe: ele não é assinado e o Controle Inteligente
// de Aplicativos do Windows barra). Roda pelo Python da .venv, só em 127.0.0.1:3900, e o Claude Flow liga o servidor
// sozinho quando um bot com o conector ligado vai trabalhar. Os bots usam o MCP dele em /mcp/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME, IS_WIN } from './config.js';

export const PORTA = 3900;
export const URL_BASE = `http://127.0.0.1:${PORTA}`;
export const URL_MCP = `${URL_BASE}/mcp/`;
export const DIR = path.join(os.homedir(), 'VoiceStudio');
// pasta de troca com os bots: o MCP só lê (áudio de referência) e só grava (áudio gerado) aqui dentro
export const PASTA = path.join(HOME, 'voicestudio');

export function onde() {
  const py = path.join(DIR, '.venv', IS_WIN ? 'Scripts/python.exe' : 'bin/python');
  return { dir: DIR, py, instalado: fs.existsSync(py) && fs.existsSync(path.join(DIR, 'backend', 'main.py')) };
}

export async function noAr() {
  try {
    const r = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

let ligando = null;
export function ligar() {
  if (!ligando) ligando = ligarAgora().finally(() => { ligando = null; });
  return ligando;
}

async function ligarAgora() {
  if (await noAr()) return { jaEstava: true, url: URL_BASE };
  const a = onde();
  if (!a.instalado) throw new Error(`VoiceStudio não encontrado em ${DIR}.`);
  fs.mkdirSync(path.join(PASTA, 'saidas'), { recursive: true });
  fs.mkdirSync(path.join(PASTA, 'referencias'), { recursive: true });
  fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true });
  const log = fs.openSync(path.join(HOME, 'logs', 'voicestudio.log'), 'a');
  // python -m uvicorn (e não o uvicorn.exe da .venv, que não é assinado e o Windows barra)
  const p = spawn(a.py, ['-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(PORTA)], {
    cwd: DIR, detached: true, windowsHide: true, stdio: ['ignore', log, log],
    env: {
      ...process.env, PYTHONUTF8: '1', OMNIVOICE_PORT: String(PORTA),
      OMNIVOICE_MCP_OUTPUT_MODE: 'files', OMNIVOICE_MCP_BASE_PATH: PASTA,
      // os modelos extras (VoxCPM2...) criam um ambiente Python 3.11 próprio: o Python que o uv baixa não é assinado e o
      // Windows barra, então ele usa só o Python oficial instalado (3.11 do python.org, assinado)
      UV_PYTHON_PREFERENCE: 'only-system',
    },
  });
  p.unref();
  for (let i = 0; i < 240; i++) { // a primeira vez carrega o PyTorch: pode levar uns minutos
    if (await noAr()) return { jaEstava: false, url: URL_BASE };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('O VoiceStudio não respondeu em 2 min. Veja ~/ClaudeFlow/logs/voicestudio.log.');
}
