// Cérebro do Claude Flow: a memória de referência do usuário, compartilhada por todos os bots, em ~/ClaudeFlow/cerebro:
//   modelos/     padrões e templates de texto (ex.: estrutura de VSL, roteiro de anúncio)
//   biblioteca/  materiais de consulta (ex.: palavras-chave de spy por nicho)
//   agentes/     notas sobre cada tipo de agente (o que faz, como pedir)
// Todo bot sabe onde fica e pode ler (e acrescentar) quando precisar. Os itens "ativos" de um bot (bot.cerebro, que
// vem do template.json "cerebro") entram inteiros no começo da sessão dele: já fazem parte do contexto.
// O repositório traz um cérebro inicial (pasta cerebro/): arquivo que falta é copiado; o que o usuário mudou não é tocado.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, REPO } from './config.js';

export const DIR = path.join(HOME, 'cerebro');
const INICIAL = path.join(REPO, 'cerebro');
const SECOES = ['modelos', 'biblioteca', 'agentes'];
const MAX_ATIVO = 40_000; // caracteres por item ativo no contexto

function copiarFaltando(de, para) {
  if (!fs.existsSync(de)) return;
  for (const e of fs.readdirSync(de, { withFileTypes: true })) {
    const a = path.join(de, e.name), b = path.join(para, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copiarFaltando(a, b); }
    else if (!fs.existsSync(b)) { fs.mkdirSync(para, { recursive: true }); fs.copyFileSync(a, b); }
  }
}

export function garantir() {
  for (const s of SECOES) fs.mkdirSync(path.join(DIR, s), { recursive: true });
  copiarFaltando(INICIAL, DIR);
}

// Todos os itens: [{ caminho: 'biblioteca/Palavras-chave Spy.md', secao, nome, tamanho }]
export function listar() {
  garantir();
  const out = [];
  const andar = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) andar(path.join(d, e.name), r);
      else if (/\.(md|txt|json|csv)$/i.test(e.name)) {
        out.push({ caminho: r, secao: r.split('/')[0], nome: e.name.replace(/\.(md|txt)$/i, ''), tamanho: fs.statSync(path.join(d, e.name)).size });
      }
    }
  };
  andar(DIR, '');
  return out.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

const dentro = (rel) => {
  const p = path.resolve(DIR, rel);
  if (!p.startsWith(path.resolve(DIR) + path.sep)) throw Object.assign(new Error('caminho fora do cérebro'), { status: 400 });
  return p;
};

export function ler(rel) {
  const p = dentro(rel);
  if (!fs.existsSync(p)) throw Object.assign(new Error('item não encontrado no cérebro'), { status: 404 });
  return { caminho: rel, texto: fs.readFileSync(p, 'utf8') };
}

// Texto para o começo de sessão do bot
export function textoParaBot(bot) {
  const itens = listar();
  const ativos = (bot.cerebro || []).filter((c) => itens.some((i) => i.caminho === c));
  const porSecao = SECOES.map((s) => {
    const l = itens.filter((i) => i.secao === s);
    return `- ${s}/: ${l.length ? l.map((i) => i.caminho.slice(s.length + 1)).join(' · ') : '(vazio)'}`;
  }).join('\n');
  const blocos = ativos.map((c) => {
    let t = fs.readFileSync(dentro(c), 'utf8').trim();
    if (t.length > MAX_ATIVO) t = t.slice(0, MAX_ATIVO) + `\n…(cortado: o resto está em ${path.join(DIR, c)})`;
    return `### ${c}\n${t}`;
  });
  return `O cérebro é a memória de referência do usuário, a mesma para todos os bots: ${DIR}
${porSecao}
Leia o arquivo quando o assunto pedir. Pode acrescentar o que aprender (ex.: palavra-chave nova que funcionou), sem
apagar o que o usuário escreveu.${blocos.length ? '\n\nItens ativos para você (já fazem parte do seu contexto):\n\n' + blocos.join('\n\n') : ''}`;
}
