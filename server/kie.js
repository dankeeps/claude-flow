// kie.ai: gera vídeo e imagem com os créditos do usuário pela API (Kling, Seedance, Veo 3.1, Wan, Grok Imagine,
// Hailuo, Nano Banana…). A chave fica em segredos.env (tela Conectores) e nunca chega ao bot: o servidor chama a API.
// Resultado: baixado para trabalho/entregas/kie do bot (os links da kie.ai expiram em 14 dias).
import fs from 'node:fs';
import path from 'node:path';
import { segredos } from './config.js';

export const ID = 'kie-ai';
const API = 'https://api.kie.ai';
const UPLOAD = 'https://kieai.redpandaai.co';
const ESPERA_MAX = 4 * 60e3; // por chamada (o MCP do bot não segura uma resposta por mais de ~5 min)

const ERROS = {
  401: 'chave da kie.ai inválida ou ausente (tela Conectores > kie.ai)',
  402: 'créditos insuficientes na kie.ai',
  404: 'modelo ou endereço não encontrado',
  422: 'parâmetros inválidos',
  429: 'limite de pedidos da kie.ai (20 a cada 10 s): espere e tente de novo',
  433: 'limite de uso desta chave',
  455: 'kie.ai em manutenção',
  501: 'a geração falhou',
  505: 'recurso desativado na kie.ai',
};

function chave() {
  const k = (segredos().KIE_API_KEY || '').trim();
  if (!k) throw new Error('kie.ai sem configurar: cole a chave em Conectores > kie.ai (kie.ai/api-key).');
  return k;
}

async function api(metodo, caminho, corpo, base = API) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${chave()}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60e3),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`kie.ai respondeu ${r.status} sem JSON.`);
  if (j.code !== 200) throw new Error(`kie.ai: ${ERROS[j.code] || 'erro'} (${j.code}${j.msg ? `: ${j.msg}` : ''}).`);
  return j.data;
}

export const creditos = () => api('GET', '/api/v1/chat/credit');

// Sobe um arquivo local para a kie.ai (fica 24 h lá) e devolve o link que os modelos aceitam como entrada.
export async function enviarArquivo(caminho) {
  if (!caminho || !fs.existsSync(caminho) || fs.statSync(caminho).isDirectory()) throw new Error(`Arquivo não encontrado: ${caminho}`);
  const fd = new FormData();
  fd.append('file', await fs.openAsBlob(caminho), path.basename(caminho));
  fd.append('uploadPath', 'claude-flow');
  fd.append('fileName', path.basename(caminho).replace(/[^\w.-]+/g, '-'));
  const r = await fetch(`${UPLOAD}/api/file-stream-upload`, { method: 'POST', headers: { authorization: `Bearer ${chave()}` }, body: fd, signal: AbortSignal.timeout(10 * 60e3) });
  const j = await r.json().catch(() => null);
  if (!j || j.code !== 200 || !j.data?.downloadUrl) throw new Error(`Falha ao enviar ${path.basename(caminho)} para a kie.ai: ${j?.msg || r.status}`);
  return j.data.downloadUrl;
}

// Qualquer texto do input que seja um caminho local existente vira link da kie.ai (imagens de referência, primeiro
// quadro, áudio). Assim o bot passa "C:\\...\\cena-01.png" direto.
async function trocarCaminhos(v, cache = new Map()) {
  if (typeof v === 'string') {
    const local = /^([a-zA-Z]:[\\/]|\/|~[\\/])/.test(v) && !/^\/\//.test(v);
    if (!local) return v;
    const p = v.startsWith('~') ? path.join(process.env.USERPROFILE || process.env.HOME || '', v.slice(2)) : v;
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return v;
    if (!cache.has(p)) cache.set(p, await enviarArquivo(p));
    return cache.get(p);
  }
  if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await trocarCaminhos(x, cache)); return o; }
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await trocarCaminhos(x, cache); return o; }
  return v;
}

export async function criar(modelo, input = {}) {
  if (!modelo) throw new Error('Passe o modelo (ex.: "kling-3.0/video", "bytedance/seedance-2", "veo-3-1").');
  const entrada = await trocarCaminhos(input || {});
  const d = await api('POST', '/api/v1/jobs/createTask', { model: modelo, input: entrada });
  if (!d?.taskId) throw new Error('A kie.ai não devolveu o id da tarefa.');
  return d.taskId;
}

const lerJson = (s) => { if (!s) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return null; } };

// Todos os links de resultado, em qualquer formato que a API devolver.
function linksDoResultado(d) {
  const r = lerJson(d.resultJson) || d.response || {};
  const l = [r.resultUrls, r.data?.result_urls, r.result_urls, r.resultUrl].flat().filter((x) => typeof x === 'string' && /^https?:\/\//.test(x));
  return [...new Set(l)];
}

export async function consultar(taskId) {
  const d = await api('GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  return { estado: d.state, progresso: d.progress, creditos: d.creditsConsumed, erro: d.failMsg || '', codigoErro: d.failCode || '', links: d.state === 'success' ? linksDoResultado(d) : [], modelo: d.model, segundos: d.costTime };
}

async function baixar(url, pasta, base) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60e3) });
  if (!r.ok) throw new Error(`Não consegui baixar o resultado (${r.status}).`);
  const ext = (path.extname(new URL(url).pathname) || (r.headers.get('content-type')?.includes('video') ? '.mp4' : '.png')).slice(0, 6);
  fs.mkdirSync(pasta, { recursive: true });
  let arq = path.join(pasta, `${base}${ext}`);
  for (let i = 2; fs.existsSync(arq); i++) arq = path.join(pasta, `${base}-${i}${ext}`); // nunca sobrescreve
  fs.writeFileSync(arq, Buffer.from(await r.arrayBuffer()));
  return arq;
}

// Espera a tarefa (até ESPERA_MAX nesta chamada) e baixa o resultado para a pasta.
export async function aguardar(taskId, { pasta, nome = '' } = {}) {
  const fim = Date.now() + ESPERA_MAX;
  let espera = 3000;
  let s;
  for (;;) {
    s = await consultar(taskId);
    if (s.estado === 'success' || s.estado === 'fail') break;
    if (Date.now() + espera > fim) return { pronto: false, taskId, estado: s.estado, progresso: s.progresso };
    await new Promise((ok) => setTimeout(ok, espera));
    espera = Math.min(Math.round(espera * 1.5), 20e3);
  }
  if (s.estado === 'fail') throw new Error(`A geração falhou na kie.ai (${s.codigoErro || '?'}): ${s.erro || 'sem motivo informado'}. Créditos gastos: ${s.creditos ?? 0}.`);
  if (!s.links.length) throw new Error('A tarefa terminou mas não veio link de resultado.');
  const base = (String(nome || '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || `kie-${taskId.slice(-10)}`;
  const arquivos = [];
  for (const [i, url] of s.links.entries()) arquivos.push(await baixar(url, pasta, s.links.length > 1 ? `${base}-${i + 1}` : base));
  return { pronto: true, taskId, arquivos, creditos: s.creditos, segundos: s.segundos, modelo: s.modelo };
}
