// Recursos fixos de cada bot, que ele sempre enxerga:
//   links.json        links salvos (planilhas, pastas, documentos) com nome
//   modelos/<nome>.md modelos de referência (ex.: "Anúncio": o que todo anúncio precisa ter)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lerJSON, gravarJSON } from './config.js';
import { dirBot } from './store.js';

const arqLinks = (bot) => path.join(dirBot(bot), 'links.json');
const dirModelos = (bot) => path.join(dirBot(bot), 'modelos');

export const links = (bot) => lerJSON(arqLinks(bot), []);

export function salvarLink(bot, { nome, url, nota = '' }) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u) && !/^[a-z]:[\\/]/i.test(u) && !u.startsWith('~') && !u.startsWith('/')) {
    throw Object.assign(new Error('link precisa começar com http(s):// (ou ser um caminho de pasta/arquivo)'), { status: 400 });
  }
  const lista = links(bot);
  const existente = lista.find((l) => l.url === u);
  if (existente) { existente.nome = String(nome || existente.nome).trim().slice(0, 80); existente.nota = String(nota || existente.nota || '').slice(0, 300); }
  else lista.push({ id: crypto.randomBytes(5).toString('hex'), nome: String(nome || u).trim().slice(0, 80), url: u, nota: String(nota).slice(0, 300), criado: Date.now() });
  gravarJSON(arqLinks(bot), lista);
  return lista;
}

export function removerLink(bot, id) {
  const lista = links(bot).filter((l) => l.id !== id);
  gravarJSON(arqLinks(bot), lista);
  return lista;
}

const nomeArquivo = (nome) => {
  const n = String(nome || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.md$/i, '').slice(0, 60);
  if (!n) throw Object.assign(new Error('dê um nome ao modelo'), { status: 400 });
  return n;
};

export function modelos(bot) {
  const d = dirModelos(bot);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.md')).sort()
    .map((f) => ({ nome: f.slice(0, -3), arquivo: path.join(d, f), tamanho: fs.statSync(path.join(d, f)).size }));
}

export function lerModelo(bot, nome) {
  const arq = path.join(dirModelos(bot), `${nomeArquivo(nome)}.md`);
  if (!fs.existsSync(arq)) throw Object.assign(new Error('modelo não encontrado'), { status: 404 });
  return { nome: nomeArquivo(nome), texto: fs.readFileSync(arq, 'utf8'), arquivo: arq };
}

export function gravarModelo(bot, nome, texto, { nomeAntigo = null } = {}) {
  const n = nomeArquivo(nome);
  fs.mkdirSync(dirModelos(bot), { recursive: true });
  const arq = path.join(dirModelos(bot), `${n}.md`);
  fs.writeFileSync(arq, String(texto || '').trim() + '\n');
  if (nomeAntigo && nomeArquivo(nomeAntigo) !== n) {
    const velho = path.join(dirModelos(bot), `${nomeArquivo(nomeAntigo)}.md`);
    if (fs.existsSync(velho)) fs.renameSync(velho, path.join(dirModelos(bot), `.${nomeArquivo(nomeAntigo)}.md.antigo`));
  }
  return { nome: n, arquivo: arq };
}

// Tirar um modelo da lista: o arquivo vira .antigo (não some do disco).
export function arquivarModelo(bot, nome) {
  const n = nomeArquivo(nome);
  const arq = path.join(dirModelos(bot), `${n}.md`);
  if (!fs.existsSync(arq)) throw Object.assign(new Error('modelo não encontrado'), { status: 404 });
  fs.renameSync(arq, path.join(dirModelos(bot), `.${n}.md.antigo`));
}
