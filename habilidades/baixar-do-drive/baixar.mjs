#!/usr/bin/env node
// Baixa arquivos do Google Drive em paralelo: um curl por arquivo, todos ao mesmo tempo.
// Uso: node baixar.mjs <pasta destino> <ID>[=<nome>] [<ID>[=<nome>] ...]
// Confere o espaço livre antes e, depois, se cada arquivo é mesmo o arquivo (e não a página de login do Google).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const [destino, ...pedidos] = process.argv.slice(2);
if (!destino || !pedidos.length) {
  console.error('Uso: node baixar.mjs <pasta destino> <ID>[=<nome>] ...');
  process.exit(2);
}
fs.mkdirSync(destino, { recursive: true });
const url = (id) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
const gb = (n) => `${(n / 1e9).toFixed(2)} GB`;

function espacoLivre(pasta) {
  try {
    if (process.platform === 'win32') {
      const letra = path.resolve(pasta).slice(0, 1);
      const r = execSync(`powershell -NoProfile -Command "(Get-PSDrive ${letra}).Free"`, { encoding: 'utf8' });
      return Number(r.trim());
    }
    const r = execSync(`df -k "${pasta}" | tail -1`, { encoding: 'utf8' }).trim().split(/\s+/);
    return Number(r[3]) * 1024;
  } catch { return null; }
}

// Tamanho e nome que o Google informa (sem baixar o arquivo inteiro).
async function cabecalho(id) {
  try {
    const r = await fetch(url(id), { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } });
    const tipo = r.headers.get('content-type') || '';
    const total = Number((r.headers.get('content-range') || '').split('/')[1]) || Number(r.headers.get('content-length')) || 0;
    const nome = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(r.headers.get('content-disposition') || '')?.[1];
    try { await r.body?.cancel(); } catch {}
    return { tipo, total, nome: nome ? decodeURIComponent(nome) : null, pagina: tipo.includes('text/html') };
  } catch (e) { return { erro: e.message }; }
}

const itens = pedidos.map((p) => { const i = p.indexOf('='); return i > 0 ? { id: p.slice(0, i), nome: p.slice(i + 1) } : { id: p, nome: null }; });

// 1) teste rápido de cada arquivo (tipo, tamanho, nome) e espaço em disco
const infos = await Promise.all(itens.map((it) => cabecalho(it.id)));
let total = 0;
itens.forEach((it, k) => {
  const inf = infos[k];
  if (!it.nome) it.nome = inf.nome || `${it.id}.bin`;
  it.nome = it.nome.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  it.previsto = inf.total || 0;
  it.restrito = !!inf.pagina;
  total += it.previsto;
});
const livre = espacoLivre(destino);
console.log(`Arquivos: ${itens.length} · previsto: ${gb(total)}${livre != null ? ` · livre no disco: ${gb(livre)}` : ''}`);
if (livre != null && total && total > livre * 0.95) {
  console.error('Espaço em disco insuficiente para baixar tudo. Libere espaço ou baixe menos arquivos.');
  process.exit(1);
}
const restritos = itens.filter((it) => it.restrito);
for (const it of restritos) console.error(`RESTRITO: ${it.nome} (${it.id}) — veio uma página, não o arquivo. O link precisa estar como "qualquer pessoa com o link".`);

// 2) um curl por arquivo, todos ao mesmo tempo
const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
const inicio = Date.now();
const resultados = await Promise.all(itens.filter((it) => !it.restrito).map((it) => new Promise((ok) => {
  const saida = path.join(destino, it.nome);
  const p = spawn(curl, ['-sL', '--fail', '--retry', '3', '-o', saida, url(it.id)], { stdio: 'ignore', windowsHide: true });
  p.on('close', (code) => ok({ ...it, saida, code }));
  p.on('error', (e) => ok({ ...it, saida, code: -1, erro: e.message }));
})));

// 3) conferência: tamanho e se não é página HTML
let falhas = restritos.length;
for (const r of resultados) {
  let tam = 0, pagina = false;
  try {
    tam = fs.statSync(r.saida).size;
    const fd = fs.openSync(r.saida, 'r'); const buf = Buffer.alloc(200); fs.readSync(fd, buf, 0, 200, 0); fs.closeSync(fd);
    pagina = /<!doctype html|<html/i.test(buf.toString('utf8'));
  } catch {}
  const ok = r.code === 0 && tam > 0 && !pagina && (!r.previsto || tam >= r.previsto * 0.99);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${r.nome} · ${gb(tam)}${pagina ? ' · veio uma página (link restrito?)' : ''}${r.code ? ` · curl saiu com ${r.code}` : ''}`);
}
console.log(`Terminado em ${Math.round((Date.now() - inicio) / 1000)} s · pasta: ${path.resolve(destino)}`);
process.exit(falhas ? 1 : 0);
