// Cloudflare R2: sobe um arquivo local para o bucket do usuário e devolve o link público (para o Meta Ads puxar o
// vídeo pela URL). Só envia (PUT) arquivo novo com nome único: nunca sobrescreve nem apaga nada do bucket.
// As chaves ficam em segredos.env (tela Conectores) e nunca chegam ao bot: quem assina o envio é o servidor.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { segredos } from './config.js';

export const ID = 'cloudflare-r2';
const LIMITE = 5 * 1024 ** 3; // PUT simples do R2 aceita até 5 GB

const TIPOS = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf' };

function cfg() {
  const s = segredos();
  const c = {
    conta: (s.CLOUDFLARE_R2_CONTA || '').trim(),
    chave: (s.CLOUDFLARE_R2_CHAVE_ID || '').trim(),
    segredo: (s.CLOUDFLARE_R2_SEGREDO || '').trim(),
    bucket: (s.CLOUDFLARE_R2_BUCKET || '').trim(),
    publica: (s.CLOUDFLARE_R2_URL_PUBLICA || '').trim().replace(/\/+$/, ''),
  };
  const falta = Object.entries({ 'ID da conta': c.conta, 'Access Key ID': c.chave, 'Secret Access Key': c.segredo, 'nome do bucket': c.bucket, 'URL pública': c.publica })
    .filter(([, v]) => !v).map(([k]) => k);
  if (falta.length) throw new Error(`Cloudflare R2 sem configurar: falta ${falta.join(', ')} (tela Conectores > Cloudflare R2).`);
  if (!/^https:\/\//.test(c.publica)) throw new Error('A URL pública do R2 precisa começar com https:// (ex.: https://pub-xxxx.r2.dev).');
  return c;
}

const hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const codificar = (k) => k.split('/').map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

// Nome do objeto: pasta do mês + data/hora + pedaço aleatório + nome limpo. Nunca repete, então nunca sobrescreve.
function nomeObjeto(arquivo, pasta = '') {
  const ext = path.extname(arquivo).toLowerCase();
  const base = path.basename(arquivo, path.extname(arquivo)).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'arquivo';
  const agora = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const dia = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}`;
  const carimbo = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  const sub = String(pasta || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return [sub || 'claude-flow', dia, `${carimbo}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`].join('/');
}

export async function enviar(arquivo, { pasta = '' } = {}) {
  if (!arquivo || !fs.existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);
  const st = fs.statSync(arquivo);
  if (st.isDirectory()) throw new Error('Isso é uma pasta: envie um arquivo.');
  if (st.size > LIMITE) throw new Error('Arquivo maior que 5 GB: o envio simples do R2 não aceita.');
  const c = cfg();
  const host = `${c.conta}.r2.cloudflarestorage.com`;
  const chave = nomeObjeto(arquivo, pasta);
  const caminho = `/${encodeURIComponent(c.bucket)}/${codificar(chave)}`;
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';

  const agora = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const data = agora.slice(0, 8);
  const cab = { 'content-length': String(st.size), 'content-type': tipo, host, 'if-none-match': '*', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': agora };
  const nomes = Object.keys(cab).sort();
  const canonico = ['PUT', caminho, '', ...nomes.map((k) => `${k}:${cab[k]}`), '', nomes.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const escopo = `${data}/auto/s3/aws4_request`;
  const assinar = ['AWS4-HMAC-SHA256', agora, escopo, hex(canonico)].join('\n');
  const k = hmac(hmac(hmac(hmac(`AWS4${c.segredo}`, data), 'auto'), 's3'), 'aws4_request');
  const assinatura = crypto.createHmac('sha256', k).update(assinar).digest('hex');
  const { host: _h, ...enviados } = cab;

  // https.request (e não fetch) para mandar Content-Length de verdade: o R2 recusa envio em pedaços sem tamanho.
  const r = await new Promise((resolve, reject) => {
    const req = https.request({ host, path: caminho, method: 'PUT', timeout: 30 * 60_000,
      headers: { ...enviados, authorization: `AWS4-HMAC-SHA256 Credential=${c.chave}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}` } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { if (corpo.length < 4000) corpo += d; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('timeout', () => req.destroy(new Error('O envio para o R2 passou de 30 minutos.')));
    req.on('error', reject);
    fs.createReadStream(arquivo).on('error', reject).pipe(req);
  });
  if (r.status < 200 || r.status >= 300) {
    const t = r.corpo.match(/<Code>([^<]+)<\/Code>/)?.[1] || '';
    if (r.status === 412) throw new Error('Já existe um arquivo com esse nome no bucket (não sobrescrevi). Tente de novo.');
    if (r.status === 403) throw new Error(`O R2 recusou as chaves (${t || '403'}): confira a chave e se ela tem permissão de escrita nesse bucket.`);
    if (r.status === 404) throw new Error(`Bucket "${c.bucket}" não encontrado nessa conta (${t || '404'}).`);
    throw new Error(`Falha ao enviar para o R2: ${r.status} ${t}`.trim());
  }
  const url = `${c.publica}/${codificar(chave)}`;
  return { url, chave, tamanho: st.size, tipo };
}

// Confere se o link público entrega o arquivo de verdade (o Meta precisa baixar sem login).
export async function conferir(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return { ok: r.ok, status: r.status, tipo: r.headers.get('content-type') || '' };
  } catch (e) { return { ok: false, status: 0, erro: e.message }; }
}
