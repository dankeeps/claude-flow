// O Atlas (Octo Edição) não faz parte deste repositório: ele já está instalado no computador (o instalador do
// Perfect Edit clona dankeeps/Atlas-interno em ~/Octo Edição/Atlas). Aqui o Claude Flow só confere se está no ar e
// liga o servidor dele separado dos turnos dos bots, para a timeline continuar aberta depois que o bot termina.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME, IS_WIN, config, expandir } from './config.js';

export async function noAr() {
  try {
    const r = await fetch(config.atlas.url, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch { return false; }
}

export function onde() {
  const dir = expandir(config.atlas.dir);
  const py = path.join(dir, '.venv', IS_WIN ? 'Scripts/python.exe' : 'bin/python');
  const servidor = path.join(dir, 'app', 'servidor.py');
  return { dir, py, servidor, instalado: fs.existsSync(py) && fs.existsSync(servidor) };
}

export async function ligar() {
  if (await noAr()) return { jaEstava: true, url: config.atlas.url };
  const a = onde();
  if (!a.instalado) throw new Error(`Atlas não encontrado em ${a.dir}. Rode "npm run editor:instalar" (instala o Perfect Edit e clona o Atlas) ou ajuste atlas.dir no config.json.`);
  const porta = new URL(config.atlas.url).port || '4123';
  fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true });
  const log = fs.openSync(path.join(HOME, 'logs', 'atlas.log'), 'a');
  const p = spawn(a.py, [a.servidor], {
    cwd: a.dir, detached: true, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, PORTA: porta, PYTHONUTF8: '1' },
  });
  p.unref();
  for (let i = 0; i < 60; i++) {
    if (await noAr()) return { jaEstava: false, url: config.atlas.url };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('O Atlas não respondeu em 30 s. Veja ~/ClaudeFlow/logs/atlas.log.');
}
