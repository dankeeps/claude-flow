// Servidor do Claude Flow: API + app (PWA) + tempo real. Escuta só em 127.0.0.1 (veja docs/pwa-e-celular.md para
// abrir no celular pelo Tailscale, sem expor o computador na rede).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { REPO, HOME, config, atualizarConfig, gravarSegredos, lerTexto, gravarTexto } from './config.js';
import * as store from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import * as runner from './runner.js';
import * as nav from './navegador.js';
import * as atlas from './atlas.js';
import * as interno from './interno.js';
import { abrirSSE, emitir, marcarPresenca, inscreverPush, chavePublicaPush, notificar } from './eventos.js';
import { listarTemplates, criarBot, skillsDoBot, catalogoSkills, ligarSkill } from './templates.js';
import { statusConectores } from './conectores.js';
import { iniciarAgenda } from './agenda.js';

store.carregar();

// Primeira vez: o squad Principal já nasce com o Bot Editor.
if (store.squads.size === 0) {
  const sq = store.criarSquad({ nome: 'Principal', descricao: 'Fluxo principal.' });
  criarBot({ squad: sq.id, nome: 'Bot Editor', template: 'editor' });
  console.log('Squad "Principal" criado com o Bot Editor.');
}

// ---------- utilidades HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.zip': 'application/zip',
};

function json(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(corpo);
}

async function corpoJSON(req) {
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > 5e6) throw Object.assign(new Error('corpo grande demais'), { status: 413 });
    partes.push(p);
  }
  if (!partes.length) return {};
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

function hostPermitido(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const ok = new Set(['localhost', '127.0.0.1', '::1', ...(config.hostsPermitidos || []).map((h) => h.toLowerCase())]);
  try { if (config.urlPublica) ok.add(new URL(config.urlPublica).hostname.toLowerCase()); } catch {}
  return ok.has(host) || host.endsWith('.ts.net');
}

function origemOk(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

function servirArquivo(req, res, arq, { download = false } = {}) {
  let st;
  try { st = fs.statSync(arq); } catch { return json(res, 404, { erro: 'arquivo não encontrado' }); }
  const tipo = MIME[path.extname(arq).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  if (download) base['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(arq))}`;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const ini = range[1] ? Number(range[1]) : 0;
    const fim = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Content-Length': fim - ini + 1 });
    return fs.createReadStream(arq, { start: ini, end: fim }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': st.size });
  fs.createReadStream(arq).pipe(res);
}

function servirWeb(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const arq = path.join(REPO, 'web', path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!arq.startsWith(path.join(REPO, 'web'))) return json(res, 403, { erro: 'proibido' });
  if (!fs.existsSync(arq)) return json(res, 404, { erro: 'não encontrado' });
  const tipo = MIME[path.extname(arq)] || 'application/octet-stream';
  const cache = rel === '/sw.js' || rel === '/index.html' ? 'no-cache' : 'no-cache';
  res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': cache, ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  fs.createReadStream(arq).pipe(res);
}

// ---------- estado para o app ----------
function botPublico(b) {
  return { ...store.publicoBot(b), ...runner.estadoBot(b), skills: skillsDoBot(b) };
}

async function estadoGeral() {
  return {
    squads: [...store.squads.values()],
    bots: [...store.bots.values()].map(botPublico),
    templates: listarTemplates(),
    conectores: statusConectores(),
    aprovacoes: [...interno.aprovacoes.values()],
    limite: runner.limiteUso,
    atlas: { url: config.atlas.url, urlPublica: config.atlas.urlPublica, noAr: await atlas.noAr(), instalado: atlas.onde().instalado },
    config: {
      modeloPadrao: config.modeloPadrao, urlPublica: config.urlPublica, memoria: config.memoria, squad: config.squad,
      home: HOME,
    },
  };
}

function marcarSujo(bot) {
  bot.snapshotSujo = true;
  store.salvarBot(bot);
}

function sujarSquad(squadId) {
  for (const b of store.botsDoSquad(squadId)) marcarSujo(b);
}

// ---------- rotas ----------
const rotas = [];
const rota = (metodo, padrao, fn) => rotas.push({ metodo, re: new RegExp(`^${padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

const pegarBot = (id) => {
  const b = store.bots.get(id);
  if (!b) throw Object.assign(new Error('bot não encontrado'), { status: 404 });
  return b;
};
const pegarSquad = (id) => {
  const s = store.squads.get(id);
  if (!s) throw Object.assign(new Error('squad não encontrado'), { status: 404 });
  return s;
};

rota('GET', '/api/estado', async () => estadoGeral());

// squads
rota('POST', '/api/squads', async ({ corpo }) => {
  if (!corpo.nome?.trim()) throw Object.assign(new Error('dê um nome ao squad'), { status: 400 });
  const sq = store.criarSquad(corpo);
  emitir('estado', {});
  return sq;
});
rota('PATCH', '/api/squads/:id', async ({ p, corpo }) => {
  const sq = pegarSquad(p.id);
  if (corpo.nome) sq.nome = corpo.nome.trim();
  if (corpo.descricao !== undefined) sq.descricao = corpo.descricao;
  store.salvarSquad(sq);
  sujarSquad(sq.id);
  emitir('estado', {});
  return sq;
});
rota('DELETE', '/api/squads/:id', async ({ p }) => {
  const sq = pegarSquad(p.id);
  for (const b of store.botsDoSquad(sq.id)) runner.parar(b.id, { limparFila: true });
  const destino = store.apagarSquad(sq);
  emitir('estado', {});
  return { ok: true, lixeira: destino };
});
rota('GET', '/api/squads/:id/sala', async ({ p }) => {
  const sq = pegarSquad(p.id);
  return { mensagens: db.salaDoSquad(sq.id), quadro: lerTexto(path.join(store.dirSquad(sq.id), 'quadro.md')) };
});
rota('PUT', '/api/squads/:id/quadro', async ({ p, corpo }) => {
  const sq = pegarSquad(p.id);
  gravarTexto(path.join(store.dirSquad(sq.id), 'quadro.md'), String(corpo.texto || ''));
  sujarSquad(sq.id);
  return { ok: true };
});

// bots
rota('POST', '/api/bots', async ({ corpo }) => {
  pegarSquad(corpo.squad);
  if (!corpo.nome?.trim()) throw Object.assign(new Error('dê um nome ao bot'), { status: 400 });
  const bot = criarBot(corpo);
  sujarSquad(bot.squad);
  emitir('estado', {});
  return botPublico(bot);
});
rota('PATCH', '/api/bots/:id', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const campos = ['nome', 'modelo', 'esforco', 'autonomia', 'conectores', 'navegador', 'pastas', 'prefs', 'env'];
  for (const c of campos) if (corpo[c] !== undefined) bot[c] = corpo[c];
  if (corpo.squad && corpo.squad !== bot.squad) throw Object.assign(new Error('para mudar de squad, crie o bot no outro squad'), { status: 400 });
  marcarSujo(bot);
  if (corpo.nome) sujarSquad(bot.squad);
  emitir('estado', {});
  return botPublico(bot);
});
rota('DELETE', '/api/bots/:id', async ({ p }) => {
  const bot = pegarBot(p.id);
  runner.parar(bot.id, { limparFila: true });
  const destino = store.apagarBot(bot);
  sujarSquad(bot.squad);
  emitir('estado', {});
  return { ok: true, lixeira: destino };
});
rota('GET', '/api/bots/:id/mensagens', async ({ p, q }) => {
  pegarBot(p.id);
  return db.listarMensagens(p.id, { antes: q.get('antes') ? Number(q.get('antes')) : null, limite: Number(q.get('limite') || 80) });
});
rota('POST', '/api/bots/:id/mensagens', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const texto = String(corpo.texto || '').trim();
  const anexos = (corpo.anexos || []).map((t) => interno.arquivoPorToken(t)).filter(Boolean)
    .map((a) => ({ caminho: a.caminho, nome: a.nome, tamanho: a.tamanho }));
  if (!texto && !anexos.length) throw Object.assign(new Error('mensagem vazia'), { status: 400 });
  return runner.enviar(bot.id, { texto: texto || '(veja os anexos)', anexos, origem: { tipo: 'usuario' }, cadeia: 0 });
});
rota('POST', '/api/bots/:id/parar', async ({ p, corpo }) => ({ parado: runner.parar(pegarBot(p.id).id, { limparFila: !!corpo.limparFila }) }));
rota('POST', '/api/bots/:id/compactar', async ({ p }) => ({ ok: runner.compactar(pegarBot(p.id).id, 'pedido do usuário') }));
rota('POST', '/api/bots/:id/nova-sessao', async ({ p }) => {
  const bot = pegarBot(p.id);
  if (runner.ocupado(bot.id)) throw Object.assign(new Error('o bot está trabalhando: pare antes'), { status: 409 });
  const antiga = bot.sessao;
  bot.sessao = null; bot.ctxTokens = 0; bot.sessaoTurnos = 0;
  store.salvarBot(bot);
  try { mem.arquivarTranscricao(bot, antiga); } catch {}
  emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, papel: 'sistema', texto: 'Sessão nova (sem compactar). A função e a memória continuam.' }));
  return { ok: true };
});
rota('GET', '/api/bots/:id/arquivos', async ({ p }) => {
  const bot = pegarBot(p.id);
  const dirR = path.join(store.dirBot(bot), 'resumos');
  const resumos = fs.existsSync(dirR) ? fs.readdirSync(dirR).sort().reverse().slice(0, 20).map((f) => ({ nome: f, texto: lerTexto(path.join(dirR, f)) })) : [];
  return {
    funcao: mem.ler(bot, 'funcao'), memoria: mem.ler(bot, 'memoria'), preferencias: mem.ler(bot, 'preferencias'),
    usuario: mem.ler(bot, 'usuario'), resumos, skills: skillsDoBot(bot), catalogoSkills: catalogoSkills().map((s) => s.nome),
    limites: config.memoria, pasta: store.dirBot(bot), mcp: bot.mcp || [],
  };
});
rota('PUT', '/api/bots/:id/arquivos/:nome', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  if (!['funcao', 'memoria', 'preferencias', 'usuario'].includes(p.nome)) throw Object.assign(new Error('arquivo inválido'), { status: 400 });
  const r = mem.escrever(bot, p.nome, String(corpo.texto || ''), 'substituir');
  if (p.nome === 'usuario') for (const b of store.bots.values()) marcarSujo(b); else marcarSujo(bot);
  if (p.nome === 'funcao') sujarSquad(bot.squad);
  return { ok: true, msg: r };
});
rota('POST', '/api/bots/:id/skills', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const s = catalogoSkills().find((x) => x.nome === corpo.nome);
  if (!s) throw Object.assign(new Error('skill não encontrada no catálogo'), { status: 404 });
  ligarSkill(s.caminho, path.join(store.dirBot(bot), '.claude', 'skills', s.nome));
  return { skills: skillsDoBot(bot) };
});
rota('DELETE', '/api/bots/:id/skills/:nome', async ({ p }) => {
  const bot = pegarBot(p.id);
  const alvo = path.join(store.dirBot(bot), '.claude', 'skills', path.basename(p.nome));
  const st = fs.lstatSync(alvo, { throwIfNoEntry: false });
  if (!st) throw Object.assign(new Error('skill não está no bot'), { status: 404 });
  if (st.isSymbolicLink()) fs.unlinkSync(alvo);
  else {
    // junção do Windows aparece como pasta: rmdir sem recursão apaga só o atalho
    try { fs.rmdirSync(alvo); } catch { fs.rmSync(alvo, { recursive: true }); }
  }
  return { skills: skillsDoBot(bot) };
});

// busca no histórico
rota('GET', '/api/busca', async ({ q }) => db.buscar(q.get('q') || '', { bot: q.get('bot') || null, squad: q.get('squad') || null, limite: 30 }));

// usuário e configuração
rota('GET', '/api/usuario', async () => ({ texto: lerTexto(mem.ARQ_USUARIO) }));
rota('PUT', '/api/usuario', async ({ corpo }) => {
  gravarTexto(mem.ARQ_USUARIO, String(corpo.texto || '').trim() + '\n');
  for (const b of store.bots.values()) marcarSujo(b);
  return { ok: true };
});
rota('PATCH', '/api/config', async ({ corpo }) => {
  const permitido = ['modeloPadrao', 'urlPublica', 'memoria', 'squad', 'atlas', 'navegador', 'push', 'hostsPermitidos', 'claudeBin'];
  const parcial = Object.fromEntries(Object.entries(corpo).filter(([k]) => permitido.includes(k)));
  atualizarConfig(parcial);
  return { ok: true };
});
rota('GET', '/api/custos', async ({ q }) => db.custos(Date.now() - Number(q.get('dias') || 7) * 86400e3));

// conectores e chaves (as chaves nunca voltam para o app: só "salva" ou não)
rota('GET', '/api/conectores', async () => statusConectores());
rota('PUT', '/api/segredos', async ({ corpo }) => {
  gravarSegredos(corpo || {});
  for (const b of store.bots.values()) marcarSujo(b);
  return { ok: true, conectores: statusConectores() };
});

// navegador
rota('GET', '/api/navegador', async () => nav.status());
rota('POST', '/api/navegador/:perfil/abrir', async ({ p, corpo }) => {
  const r = await nav.ligar(p.perfil, corpo.url || '');
  emitir('navegador', await nav.status());
  return r;
});
rota('POST', '/api/navegador/:perfil/fechar', async ({ p }) => {
  const r = await nav.desligar(p.perfil);
  emitir('navegador', await nav.status());
  return { fechado: r };
});

// Atlas
rota('POST', '/api/atlas/ligar', async () => atlas.ligar());

// aprovações
rota('POST', '/api/aprovacoes/:id', async ({ p, corpo }) => ({ ok: interno.decidirAprovacao(p.id, !!corpo.permitir) }));

// push e presença
rota('GET', '/api/push/chave', async () => ({ chave: chavePublicaPush() }));
rota('POST', '/api/push/inscrever', async ({ corpo }) => { inscreverPush(corpo); return { ok: true }; });
rota('POST', '/api/push/teste', async () => notificar({ titulo: 'Claude Flow', texto: 'Notificações funcionando neste aparelho.', forcar: true }));
rota('POST', '/api/presenca', async ({ corpo }) => { marcarPresenca(corpo); return { ok: true }; });

// ---------- servidor ----------
async function tratar(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!hostPermitido(req)) return json(res, 403, { erro: 'host não permitido' });

  // ferramentas dos bots (servidor MCP "flow"): autenticadas pelo token do bot
  if (url.pathname.startsWith('/api/interno/')) {
    const bot = store.botPorToken(String(req.headers['x-flow-token'] || ''));
    if (!bot) return json(res, 401, { erro: 'token inválido' });
    const m = url.pathname.match(/^\/api\/interno\/(ferramenta|espera)\/([\w-]+)$/);
    if (!m) return json(res, 404, { erro: 'rota interna desconhecida' });
    if (m[1] === 'espera') return json(res, 200, interno.consultarEspera(m[2]));
    const corpo = await corpoJSON(req);
    const r = await interno.chamar(bot, m[2], corpo.args || {});
    return json(res, 200, typeof r === 'object' && r?.espera ? r : { texto: r });
  }

  if (url.pathname === '/api/eventos') return abrirSSE(req, res);

  // arquivo entregue por um bot ou anexado: o token na URL é a autorização (funciona em <video src>)
  const mArq = url.pathname.match(/^\/api\/arquivo\/([a-f0-9]{24})$/);
  if (mArq) {
    const a = interno.arquivoPorToken(mArq[1]);
    if (!a) return json(res, 404, { erro: 'arquivo não encontrado' });
    return servirArquivo(req, res, a.caminho, { download: url.searchParams.get('baixar') === '1' });
  }

  if (url.pathname.startsWith('/api/')) {
    // o app manda este cabeçalho; outro site aberto no navegador não consegue (bloqueio de CORS)
    if (req.method !== 'GET' && req.headers['x-claude-flow'] !== '1') return json(res, 403, { erro: 'cabeçalho x-claude-flow ausente' });
    if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });

    if (req.method === 'PUT' && url.pathname === '/api/upload') return receberUpload(req, res, url);

    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const corpo = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await corpoJSON(req) : {};
      const dados = await r.fn({ p: m.groups || {}, q: url.searchParams, corpo, req });
      return json(res, 200, dados ?? { ok: true });
    }
    return json(res, 404, { erro: 'rota não encontrada' });
  }
  return servirWeb(req, res, url);
}

async function receberUpload(req, res, url) {
  const nome = path.basename(String(url.searchParams.get('nome') || 'arquivo')).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 180) || 'arquivo';
  const dir = path.join(HOME, 'uploads', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  let destino = path.join(dir, nome);
  for (let i = 2; fs.existsSync(destino); i++) destino = path.join(dir, nome.replace(/(\.[^.]*)?$/, ` (${i})$1`));
  await new Promise((ok, falha) => {
    const w = fs.createWriteStream(destino);
    req.pipe(w);
    w.on('finish', ok);
    w.on('error', falha);
    req.on('error', falha);
  });
  const a = interno.registrarArquivo(destino, { upload: true });
  json(res, 200, { token: a.token, nome: a.nome, tamanho: a.tamanho, caminho: destino });
}

const servidor = http.createServer((req, res) => {
  tratar(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { erro: e.message });
    else res.end();
  });
});
servidor.requestTimeout = 0; // upload de vídeo grande pode levar minutos

servidor.listen(config.porta, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.porta}`;
  runner.definirUrl(`http://127.0.0.1:${config.porta}`);
  console.log(`\nClaude Flow no ar: ${url}`);
  console.log(`Dados em ${HOME}`);
  if (config.host !== '127.0.0.1') console.log('ATENÇÃO: o servidor está aberto para a rede (host no config.json).');
  iniciarAgenda();
});
