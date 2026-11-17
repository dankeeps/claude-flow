// Página de destino de um anúncio: abre e classifica em vsl | quiz | whatsapp | loja | outro.
// Só VSL e quiz são resposta direta e entram na lista; o resto sai (marca institucional, loja, conversa).
//   node destino.mjs <url> [<url>...]      → JSON com o tipo, os sinais que decidiram e a plataforma de checkout
import { pathToFileURL } from 'node:url';
import { novaAba, fechar, esperar, lerArgs, saida, log } from './navegador.mjs';

// players de VSL (o vídeo da VSL quase nunca é um <video> simples)
const PLAYERS = [
  ['vturb', /converteai\.net|vturb|smartplayer|scripts\.converteai/i],
  ['panda', /pandavideo|player-vz-|b-vz-/i],
  ['vimeo', /player\.vimeo\.com|vimeocdn/i],
  ['wistia', /wistia\.(com|net)|fast\.wistia/i],
  ['youtube', /youtube\.com\/embed|youtube-nocookie|ytimg\.com\/vi\//i],
  ['bunny', /mediadelivery\.net|b-cdn\.net\/.*\.m3u8/i],
  ['jwplayer', /jwplayer|jwpcdn/i],
  ['vidalytics', /vidalytics/i],
  ['hls', /\.m3u8(\?|"|')/i],
];
const QUIZ = [
  ['inlead', /inlead\.(digital|com)/i],
  ['typebot', /typebot/i],
  ['heyflow', /heyflow/i],
  ['respondi', /respondi\.app/i],
  ['tally/typeform', /tally\.so|typeform\.com/i],
  ['xquiz', /xquiz\.|quizzes?\.(link|app)/i],
];
const QUIZ_TEXTO = /(pergunta \d+ de \d+|responda (as|a) pergunta|fa[çc]a o (teste|quiz)|come[çc]ar (o )?(teste|quiz)|qual (é )?a sua idade|selecione (uma|a) op[çc][ãa]o|question \d+ of \d+|take the quiz|start (the )?quiz|pregunta \d+ de \d+|comenzar (el )?(test|quiz))/i;
const LOJA = /cdn\.shopify|Shopify\.theme|woocommerce|adicionar ao carrinho|add to cart|a[ñn]adir al carrito|nuvemshop|vtex|yampi|lojaintegrada|carrinho de compras/i;
const CHECKOUT = [
  ['hotmart', /pay\.hotmart|hotmart\.com/i], ['kiwify', /kiwify/i], ['cakto', /cakto/i], ['monetizze', /monetizze/i],
  ['eduzz', /eduzz/i], ['braip', /braip/i], ['perfectpay', /perfectpay/i], ['ticto', /ticto/i], ['payt', /payt\.com/i],
  ['clickbank', /clickbank|hop\.clickbank|clkbank/i], ['digistore24', /digistore24/i], ['buygoods', /buygoods/i],
  ['maxweb', /maxweb/i], ['yampi', /yampi/i], ['pepper', /pepper\.com\.br/i], ['greenn', /greenn/i],
];

// l.facebook.com/l.php?u=… → o endereço de verdade
export function limparLink(u) {
  try {
    const x = new URL(u);
    if (/(^|\.)facebook\.com$/.test(x.hostname) && x.pathname.startsWith('/l.php') && x.searchParams.get('u')) return x.searchParams.get('u');
    return u;
  } catch { return u; }
}

export async function classificar(url, { pagina = null } = {}) {
  url = limparLink(url);
  if (!/^https?:\/\//i.test(url || '')) return { url, tipo: 'sem-link', sinais: [] };
  if (/wa\.me|api\.whatsapp\.com|whatsapp\.com\/send|chat\.whatsapp/i.test(url)) return { url, url_final: url, tipo: 'whatsapp', sinais: ['link direto do WhatsApp'] };
  if (/instagram\.com|facebook\.com|fb\.me|m\.me\//i.test(url)) return { url, url_final: url, tipo: 'outro', sinais: ['leva para rede social'] };
  const p = pagina || await novaAba();
  const pedidos = [];
  const ouvir = (r) => { if (pedidos.length < 400) pedidos.push(r.url()); };
  p.on('request', ouvir);
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await esperar(5000);
    await p.mouse.wheel(0, 1200).catch(() => {});
    await esperar(1500);
    const info = await p.evaluate(() => ({
      html: document.documentElement.outerHTML.slice(0, 600000),
      texto: (document.body?.innerText || '').slice(0, 20000),
      videos: document.querySelectorAll('video').length,
      iframes: [...document.querySelectorAll('iframe')].map((f) => f.src).filter(Boolean),
      links: [...document.querySelectorAll('a[href]')].map((a) => a.href).slice(0, 400),
      botoes: [...document.querySelectorAll('button, [role=button], input[type=radio], label')].length,
      titulo: document.title,
    })).catch(() => null);
    if (!info) return { url, tipo: 'erro', sinais: ['a página não abriu'] };
    const tudo = [info.html, info.iframes.join(' '), pedidos.join(' ')].join(' ');
    const sinais = [];
    const players = PLAYERS.filter(([, re]) => re.test(tudo)).map(([n]) => n);
    const quiz = QUIZ.filter(([, re]) => re.test(p.url() + ' ' + tudo)).map(([n]) => n);
    if (/[/.?=_-]quiz/i.test(p.url())) quiz.push('quiz no endereço');
    if (QUIZ_TEXTO.test(info.texto)) quiz.push('texto de quiz');
    const plataformas = CHECKOUT.filter(([, re]) => re.test(info.links.join(' ') + ' ' + tudo)).map(([n]) => n);
    const zap = info.links.filter((l) => /wa\.me|api\.whatsapp\.com|whatsapp\.com\/send/i.test(l)).length;
    const loja = LOJA.test(info.html + ' ' + info.texto);
    let tipo = 'outro';
    const lojaForte = loja && !players.length && !quiz.filter((q) => q !== 'texto de quiz').length;
    if (lojaForte) { tipo = 'loja'; sinais.push('loja virtual'); }
    else if (quiz.length) { tipo = 'quiz'; sinais.push('quiz: ' + quiz.join(', ')); }
    if (players.length || info.videos) {
      sinais.push('vídeo: ' + (players.join(', ') || `${info.videos} <video>`));
      if (tipo === 'outro') tipo = 'vsl';
    }
    if (tipo === 'outro' && zap) { tipo = 'whatsapp'; sinais.push(`${zap} link(s) de WhatsApp`); }
    if (tipo === 'outro' && loja) { tipo = 'loja'; sinais.push('loja virtual'); }
    // loja com vídeo de produto não é VSL
    if (tipo === 'vsl' && loja && !plataformas.length && !players.length) { tipo = 'loja'; sinais.push('loja virtual (vídeo de produto)'); }
    return { url, url_final: p.url(), titulo: info.titulo?.slice(0, 120), tipo, sinais, plataformas, players };
  } catch (e) {
    return { url, tipo: 'erro', sinais: [String(e?.message || e).split('\n')[0].slice(0, 160)] };
  } finally {
    p.off('request', ouvir);
    if (!pagina) await p.close().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { pos } = lerArgs(process.argv.slice(2));
  if (!pos.length) { log('uso: node destino.mjs <url> [<url>...]'); process.exit(2); }
  const out = [];
  for (const u of pos) { log('abrindo', u); out.push(await classificar(u)); }
  await fechar();
  saida(out.length === 1 ? out[0] : out);
}
