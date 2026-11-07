// Galeria do bot: tudo o que ele produziu de mídia — o que entregou no chat (arquivo_entregar) e o que está nas
// pastas de saída do trabalho dele (renders, cortados, entregas). Só aparece o que ainda existe no disco: apagou do
// computador, some da galeria. Brutos, B-rolls baixados, máscaras e prévias internas ficam de fora.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME } from './config.js';
import { dirBot } from './store.js';
import * as interno from './interno.js';

const VIDEO = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const IMAGEM = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const AUDIO = new Set(['.mp3', '.m4a', '.wav']);
const SAIDAS = new Set(['renders', 'cortados', 'entregas', 'saida', 'saidas', 'exports', 'galeria']);
const PULAR = new Set(['node_modules', '__pycache__', '.venv', 'masks', 'masks.novo', 'prev', '_pedacos', 'b-rolls', 'brutos', 'cache']);

const tipoDe = (arq) => {
  const e = path.extname(arq).toLowerCase();
  return VIDEO.has(e) ? 'video' : IMAGEM.has(e) ? 'imagem' : AUDIO.has(e) ? 'audio' : null;
};

// Arquivos de mídia dentro de uma pasta de saída (em qualquer profundidade do trabalho, até 7 níveis).
function varrer(dir, dentroDeSaida, prof, out) {
  if (prof > 7 || out.length > 400) return;
  let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of itens) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (PULAR.has(it.name.toLowerCase()) || it.name.startsWith('.')) continue;
      varrer(p, dentroDeSaida || SAIDAS.has(it.name.toLowerCase()), prof + 1, out);
    } else if (dentroDeSaida && tipoDe(it.name)) out.push(p);
  }
}

export function listar(bot) {
  const vistos = new Map();
  const add = (caminho, extra = {}) => {
    let st; try { st = fs.statSync(caminho); } catch { return; }
    if (!st.isFile() || !tipoDe(caminho)) return;
    const chave = path.resolve(caminho).toLowerCase();
    if (vistos.has(chave)) { Object.assign(vistos.get(chave), extra); return; }
    vistos.set(chave, { caminho, nome: path.basename(caminho), tamanho: st.size, data: st.mtimeMs, tipo: tipoDe(caminho), ...extra });
  };
  for (const e of interno.todasEntregas()) if (e.bot === bot.id && !e.galeria) add(e.caminho, { token: e.token, legenda: e.legenda, entregue: true });
  const achados = []; varrer(path.join(dirBot(bot), 'trabalho'), false, 0, achados);
  for (const a of achados) add(a);
  const lista = [...vistos.values()].sort((a, b) => b.data - a.data).slice(0, 300);
  for (const x of lista) if (!x.token) x.token = interno.tokenDoCaminho(x.caminho, { bot: bot.id }).token;
  return lista.map(({ caminho, ...x }) => ({ ...x, pasta: path.basename(path.dirname(caminho)) }));
}

// Capa (miniatura) de vídeo/imagem: um JPG de 360 px gerado uma vez pelo ffmpeg e guardado no cache.
const CAPAS = path.join(HOME, 'cache', 'capas');
const fazendo = new Map();
export function capa(token) {
  const a = interno.arquivoPorToken(token);
  if (!a || !fs.existsSync(a.caminho)) return Promise.resolve(null);
  const tipo = tipoDe(a.caminho);
  if (tipo !== 'video' && tipo !== 'imagem') return Promise.resolve(null);
  const st = fs.statSync(a.caminho);
  const arq = path.join(CAPAS, `${token}-${Math.round(st.mtimeMs)}.jpg`);
  if (fs.existsSync(arq)) return Promise.resolve(arq);
  if (fazendo.has(arq)) return fazendo.get(arq);
  fs.mkdirSync(CAPAS, { recursive: true });
  const args = ['-v', 'error', '-y', ...(tipo === 'video' ? ['-ss', '1'] : []), '-i', a.caminho, '-frames:v', '1',
    '-vf', "scale='min(360,iw)':-2", '-q:v', '4', arq];
  const p = new Promise((ok) => {
    const f = spawn('ffmpeg', args, { windowsHide: true, stdio: 'ignore' });
    f.on('error', () => ok(null));
    f.on('close', () => {
      if (fs.existsSync(arq)) return ok(arq);
      // vídeo com menos de 1 s: tenta o primeiro quadro
      const g = spawn('ffmpeg', args.filter((x, i) => !(x === '-ss' || args[i - 1] === '-ss')), { windowsHide: true, stdio: 'ignore' });
      g.on('error', () => ok(null)); g.on('close', () => ok(fs.existsSync(arq) ? arq : null));
    });
  }).finally(() => fazendo.delete(arq));
  fazendo.set(arq, p);
  return p;
}
