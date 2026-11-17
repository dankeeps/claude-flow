// Servidor como serviço (tarefa do Windows no boot). Este processo é o "supervisor": liga o servidor
// (server/index.js) como filho e:
//  - reinicia o servidor sozinho quando o código dele muda (atualizar o Claude Flow não precisa de reinício manual);
//  - liga de novo se o servidor cair;
//  - parar a tarefa para tudo: o servidor confere a cada 3 s se o supervisor ainda existe e, se não, sai.
// O que o servidor escreve vai para ~/ClaudeFlow/servidor.log.
//   node scripts/servico.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.env.CLAUDE_FLOW_HOME || path.join(os.homedir(), 'ClaudeFlow');
fs.mkdirSync(dir, { recursive: true });
const log = fs.createWriteStream(path.join(dir, 'servidor.log'), { flags: 'a' });
const escrever = (txt) => log.write(`${new Date().toISOString()} ${txt}\n`);

let filho = null;
let reiniciando = false;
let quedas = [];
let timerLigar = null; // religar depois de uma queda (só um pendente por vez)

function ligar() {
  clearTimeout(timerLigar); timerLigar = null;
  if (filho) return; // já tem um servidor rodando: não liga uma segunda cópia na mesma porta
  filho = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(REPO, 'server', 'index.js')], {
    cwd: REPO,
    env: { ...process.env, PYTHONUTF8: '1', FLOW_SUPERVISOR: String(process.pid) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  filho.stdout.on('data', (d) => log.write(d));
  filho.stderr.on('data', (d) => log.write(d));
  filho.on('exit', (codigo, sinal) => {
    filho = null;
    if (reiniciando) { reiniciando = false; ligar(); return; }
    // caiu sozinho: liga de novo (espera mais se estiver caindo sem parar)
    quedas = [...quedas.filter((t) => Date.now() - t < 60_000), Date.now()];
    const espera = quedas.length > 3 ? 15_000 : 2_000;
    escrever(`[supervisor] o servidor parou (${codigo ?? sinal}); ligando de novo em ${espera / 1000} s`);
    clearTimeout(timerLigar);
    timerLigar = setTimeout(ligar, espera);
  });
}

// Código mudou com bot trabalhando: espera ele terminar (até 40 min) para não interromper uma edição no meio.
let esperandoDesde = 0;
let timerEspera = null; // separado do timer do fs.watch: um aviso falso do Windows não pode cancelar a espera
async function algumBotTrabalhando() {
  try {
    const r = await fetch('http://127.0.0.1:4400/api/estado', { signal: AbortSignal.timeout(5000) });
    const e = await r.json();
    return (e.bots || []).filter((b) => b.status === 'trabalhando').map((b) => b.nome);
  } catch { return []; }
}
async function reiniciarQuandoLivre(motivo) {
  const ocupados = filho ? await algumBotTrabalhando() : [];
  if (ocupados.length && (!esperandoDesde || Date.now() - esperandoDesde < 40 * 60e3)) {
    if (!esperandoDesde) { esperandoDesde = Date.now(); escrever(`[supervisor] código mudou (${motivo}); esperando ${ocupados.join(', ')} terminar para reiniciar`); }
    clearTimeout(timerEspera);
    timerEspera = setTimeout(() => reiniciarQuandoLivre(motivo), 20e3);
    return;
  }
  esperandoDesde = 0;
  clearTimeout(timerEspera);
  reiniciar(motivo);
}
function reiniciar(motivo) {
  escrever(`[supervisor] reiniciando o servidor: ${motivo}`);
  if (!filho) return ligar();
  reiniciando = true;
  filho.kill();
}

// Código do servidor mudou (atualização, ajuste): reinicia depois de 1 s sem mudanças.
// O Windows às vezes avisa "mudou" sem mudança nenhuma (antivírus, indexação, leitura): só reinicia se o
// conteúdo do arquivo for outro de verdade (compara um hash com o da última vez).
const SERVER = path.join(REPO, 'server');
const CODIGO = /\.(js|mjs|json)$/i;
const hashDe = (arq) => { try { return crypto.createHash('sha1').update(fs.readFileSync(arq)).digest('hex'); } catch { return null; } };
const hashes = new Map();
(function varrer(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') varrer(p); } else if (CODIGO.test(e.name)) hashes.set(p, hashDe(p));
  }
})(SERVER);
let timer = null;
const pendentes = new Set();
fs.watch(SERVER, { recursive: true }, (_ev, nome) => {
  if (!nome || !CODIGO.test(String(nome))) return;
  pendentes.add(String(nome));
  clearTimeout(timer);
  timer = setTimeout(() => {
    const mudados = [];
    for (const n of pendentes) {
      const p = path.join(SERVER, n);
      const h = hashDe(p);
      if (h !== (hashes.has(p) ? hashes.get(p) : undefined)) { hashes.set(p, h); mudados.push(n); }
    }
    pendentes.clear();
    if (mudados.length) reiniciarQuandoLivre(`mudou server/${mudados.join(', server/')}`);
  }, 1000);
});

for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { filho?.kill(); process.exit(0); });
escrever('[supervisor] ligado');
ligar();
