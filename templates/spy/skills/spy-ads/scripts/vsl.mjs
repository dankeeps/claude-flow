// Baixa a VSL de uma página de vendas. A VSL quase nunca é um arquivo só (vturb/ConverteAI, Panda, Vimeo, Wistia,
// YouTube, HLS): abre a página, dá play, captura o endereço do stream e entrega ao yt-dlp.
//   node vsl.mjs <url da página> [--nome <arquivo>] [--pasta <dir>]
// Página que começa com quiz: responda o quiz no navegador do Claude Flow até a VSL e passe a URL final.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { novaAba, fechar, esperar, lerArgs, log, saida, PASTA_SPY } from './navegador.mjs';

const STREAM = /\.m3u8(\?|$)|\.mpd(\?|$)|\.mp4(\?|$)/i;
const IGNORA = /fbcdn|facebook|google|doubleclick|tiktok|analytics|hotjar|clarity|pixel/i;
const EMBED = [/youtube\.com\/embed\/([\w-]{6,})/i, /player\.vimeo\.com\/video\/\d+/i, /fast\.wistia\.(net|com)\/embed\/[\w/]+/i];

function ytdlp() {
  for (const c of [process.env.YTDLP, 'yt-dlp']) {
    if (!c) continue;
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0) return c;
  }
  throw new Error('yt-dlp não encontrado no PATH');
}

const { pos, o } = lerArgs(process.argv.slice(2));
const url = pos[0];
if (!url) { log('uso: node vsl.mjs <url> [--nome x] [--pasta dir]'); process.exit(2); }
const pasta = o.pasta || path.join(PASTA_SPY, 'vsl');
fs.mkdirSync(pasta, { recursive: true });
const nome = String(o.nome || `${new URL(url).hostname.replace(/^www\./, '')}-${new Date().toISOString().slice(0, 10)}`).replace(/[\\/:*?"<>|]+/g, '-');

const achados = new Map();
let paginaFinal = url;
try {
  const p = await novaAba();
  p.on('request', (r) => { const u = r.url(); if (STREAM.test(u) && !IGNORA.test(new URL(u).hostname)) achados.set(u, r.headers()); });
  log('[vsl] abrindo ' + url);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await esperar(5000);
  // play: clica no player (no meio do primeiro vídeo/iframe grande da página)
  const alvo = await p.evaluate(() => {
    const els = [...document.querySelectorAll('video, iframe, [id*=vid], [class*=player], [id*=player], vturb-smartplayer')]
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 200 && r.height > 120);
    const r = els[0]; return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }).catch(() => null);
  if (alvo) { await p.mouse.click(alvo.x, alvo.y).catch(() => {}); await esperar(6000); }
  paginaFinal = p.url();
  const html = await p.content().catch(() => '');
  const iframes = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src)).catch(() => []);
  for (const s of [html, ...iframes]) for (const re of EMBED) { const m = String(s).match(re); if (m) achados.set(m[0].startsWith('http') ? m[0] : 'https://' + m[0].replace(/^\/+/, ''), {}); }
} finally { await fechar(); }

// preferência: m3u8 (vídeo inteiro) > embed (YouTube/Vimeo/Wistia) > mp4 maior
const lista = [...achados.keys()];
const ordem = [...lista.filter((u) => /\.m3u8/i.test(u) && /master|playlist|main|index/i.test(u)), ...lista.filter((u) => /\.m3u8/i.test(u)),
  ...lista.filter((u) => EMBED.some((re) => re.test(u))), ...lista.filter((u) => /\.mpd/i.test(u)), ...lista.filter((u) => /\.mp4/i.test(u))];
const unicos = [...new Set(ordem)];
if (!unicos.length) { saida({ url, pagina_final: paginaFinal, erro: 'não achei o stream do vídeo (página com quiz? player que só carrega depois de interação?)' }); process.exit(1); }

const bin = ytdlp();
for (const s of unicos.slice(0, 4)) {
  log('[vsl] tentando ' + s.slice(0, 120));
  const destino = path.join(pasta, nome + '.%(ext)s');
  const args = ['--no-playlist', '--no-progress', '-N', '8', '--merge-output-format', 'mp4', '-o', destino,
    '--referer', paginaFinal, '--add-header', 'Origin:' + new URL(paginaFinal).origin, s];
  const r = spawnSync(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: false });
  const arq = fs.readdirSync(pasta).filter((f) => f.startsWith(nome + '.') && !/\.part$|\.ytdl$/.test(f)).map((f) => path.join(pasta, f))[0];
  if (r.status === 0 && arq) {
    const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq], { encoding: 'utf8' }).stdout.trim();
    saida({ url, pagina_final: paginaFinal, stream: s, arquivo: arq, mb: +(fs.statSync(arq).size / 1048576).toFixed(1), duracao_s: Math.round(Number(dur) || 0) });
    process.exit(0);
  }
}
saida({ url, pagina_final: paginaFinal, erro: 'o yt-dlp não conseguiu baixar nenhum dos streams', streams: unicos.slice(0, 6) });
process.exit(1);
