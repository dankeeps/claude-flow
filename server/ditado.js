// Ditado do microfone do app: o celular grava o áudio, manda para cá e recebe o texto de volta (para a caixa de
// digitar). Transcreve com o Whisper do Atlas na placa de vídeo. O processo fica de pé enquanto é usado e fecha
// sozinho depois de 5 min parado, para não segurar memória da placa durante as edições.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO, HOME } from './config.js';
import * as atlas from './atlas.js';

const OCIOSO = 5 * 60e3;
let proc = null, pronto = null, fila = Promise.resolve(), timer = null, buf = '', esperando = null;

function iniciar() {
  const { dir, py, instalado } = atlas.onde();
  if (!instalado) throw new Error('o Atlas não está instalado neste PC');
  const env = { ...process.env, ...atlas.envAtlas(), PYTHONIOENCODING: 'utf-8' };
  proc = spawn(py, [path.join(REPO, 'scripts', 'transcrever.py'), dir], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  buf = '';
  let avisarPronto;
  pronto = new Promise((ok, falha) => { avisarPronto = { ok, falha }; });
  let log = '';
  proc.stderr.on('data', (d) => { log = (log + d).slice(-2000); });
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!linha) continue;
      let j; try { j = JSON.parse(linha); } catch { continue; }
      if (j.pronto) avisarPronto.ok();
      else if (esperando) { const e = esperando; esperando = null; e(j); }
    }
  });
  proc.on('exit', () => {
    avisarPronto.falha(new Error('a transcrição não abriu: ' + log.trim().split('\n').pop()));
    if (esperando) { const e = esperando; esperando = null; e({ erro: 'a transcrição parou' }); }
    proc = null;
  });
}

function dormirDepois() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { proc?.stdin.end(); } catch {} }, OCIOSO);
}

export function transcrever(arquivo) {
  const vez = fila.then(async () => {
    if (!proc) iniciar();
    await pronto;
    const r = await new Promise((ok) => { esperando = ok; proc.stdin.write(arquivo + '\n'); });
    dormirDepois();
    if (r.erro) throw new Error(r.erro);
    return r.texto || '';
  });
  fila = vez.catch(() => {});
  return vez;
}

// recebe o áudio cru do app (PUT), transcreve e apaga o arquivo temporário
export async function receber(req) {
  const dir = path.join(HOME, 'cache', 'ditado');
  fs.mkdirSync(dir, { recursive: true });
  const tipo = String(req.headers['content-type'] || '');
  const ext = tipo.includes('mp4') || tipo.includes('m4a') || tipo.includes('aac') ? 'm4a' : tipo.includes('ogg') ? 'ogg' : tipo.includes('wav') ? 'wav' : 'webm';
  const arq = path.join(dir, `ditado-${Date.now()}.${ext}`);
  let tam = 0;
  await new Promise((ok, falha) => {
    const w = fs.createWriteStream(arq);
    req.on('data', (d) => { tam += d.length; if (tam > 50e6) { req.destroy(); falha(new Error('áudio grande demais')); } });
    req.pipe(w);
    w.on('finish', ok); w.on('error', falha); req.on('error', falha);
  });
  try { return { texto: await transcrever(arq) }; }
  finally { fs.rm(arq, { force: true }, () => {}); }
}
