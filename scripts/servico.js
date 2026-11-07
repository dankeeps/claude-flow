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

function ligar() {
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
    setTimeout(ligar, espera);
  });
}

function reiniciar(motivo) {
  escrever(`[supervisor] reiniciando o servidor: ${motivo}`);
  if (!filho) return ligar();
  reiniciando = true;
  filho.kill();
}

// Código do servidor mudou (atualização, ajuste): reinicia depois de 1 s sem mudanças.
let timer = null;
fs.watch(path.join(REPO, 'server'), { recursive: true }, (_ev, nome) => {
  if (!nome || !/\.(js|mjs|json)$/i.test(String(nome))) return;
  clearTimeout(timer);
  timer = setTimeout(() => reiniciar(`mudou server/${nome}`), 1000);
});

for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { filho?.kill(); process.exit(0); });
escrever('[supervisor] ligado');
ligar();
