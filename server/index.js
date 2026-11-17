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
import { listarTemplates, template as templateDe, criarBot, skillsDoBot, catalogoSkills, ligarSkill, ligarHabilidades, skillsComDescricao } from './templates.js';
import { statusConectores, atualizarStatusClaude, criarConta, renomearConta, removerConta, gravarCampos, idValido } from './conectores.js';
import { iniciarAgenda } from './agenda.js';
import * as tarefas from './tarefas.js';
import * as recursos from './recursos.js';
import * as rotinas from './rotinas.js';
import * as demandas from './demandas.js';
import * as sala from './sala.js';
import * as galeria from './galeria.js';
import * as codex from './codex.js';
import * as cerebro from './cerebro.js';
import * as sd from './squaddados.js';
import * as head from './head.js';
import * as ditado from './ditado.js';
import * as voz from './voz.js';
import * as grok from './grok.js';
import * as voicestudio from './voicestudio.js';

store.carregar();
// código novo pode ter mudado as regras do começo de sessão: cada bot remonta a dele na próxima mensagem
for (const b of store.bots.values()) b.snapshotSujo = true;
// habilidades do Claude Flow (habilidades/, ex.: baixar-do-drive) ficam em todos os bots, inclusive os já criados
for (const b of store.bots.values()) { try { ligarHabilidades(b); } catch (e) { console.error('habilidades', b.nome, e.message); } }
// O Atlas liga junto com o Claude Flow (já apontando para as pastas do Bot Editor dentro do ~/ClaudeFlow).
setTimeout(() => { if (atlas.onde().instalado) atlas.ligar().catch((e) => console.error('Atlas:', e.message)); }, 2000).unref();
// Rodando pelo supervisor (scripts/servico.js): se ele sumir (tarefa parada), este servidor sai junto.
if (process.env.FLOW_SUPERVISOR) {
  const pai = Number(process.env.FLOW_SUPERVISOR);
  setInterval(() => { try { process.kill(pai, 0); } catch { process.exit(0); } }, 3000).unref();
}
// Status real dos conectores da conta claude.ai: confere ao ligar e de 10 em 10 minutos (o app atualiza sozinho).
const verificarConectores = () => atualizarStatusClaude().then(() => emitir('estado', {})).catch(() => {});
setTimeout(verificarConectores, 3000).unref();
setInterval(verificarConectores, 10 * 60 * 1000).unref();

// Primeira vez: o squad Principal já nasce com o Bot Editor.
if (store.squads.size === 0) {
  const sq = store.criarSquad({ nome: 'Principal', descricao: 'Fluxo principal.' });
  criarBot({ squad: sq.id, nome: 'Editor', template: 'editor' });
  console.log('Squad "Principal" criado com o Editor.');
}

// ---------- pedido do chat que demora vira cartão no kanban ----------
// Passou de 90 s e não é tarefa, repasse nem manutenção: entra em "Fazendo" com o pedido como título; os avisos
// de progresso do bot viram notas do cartão; no fim, vai para "Revisão" com o resultado (ou fica com o erro).
const tituloDoPedido = (txt) => {
  const l = String(txt || '').split('\n').map((x) => x.trim()).find((x) => x && !/^\[/.test(x)) || 'Pedido no chat';
  return l.length > 90 ? `${l.slice(0, 87).replace(/\s+\S*$/, '')}…` : l;
};
runner.ganchos.turnoLongo = (bot, item) => {
  if (item.especial || item.tarefa || item.origem?.tipo === 'bot') return;
  const t = tarefas.criar({ squad: bot.squad, bot: bot.id, titulo: tituloDoPedido(item.texto), descricao: String(item.texto || '').slice(0, 3000), status: 'fazendo' },
    { autor: 'usuario' });
  db.addEvento(t.id, { autor: bot.id, tipo: 'nota', texto: item.origem?.tipo === 'rotina' ? `Rotina "${item.origem.nome}" em andamento.` : 'Em andamento (pedido feito no chat).' });
  item.tarefa = t.id;
  item.tarefaAuto = t.id;
  runner.salvarFilas(); // o vínculo com o cartão sobrevive a um reinício
  emitir('tarefa', { squad: t.squad, id: t.id });
};
runner.ganchos.fimDoTurno = (bot, item, { final, erro, parado, dur }) => {
  try { head.aoFimDoTurno(bot, item, { final, erro, parado, duracao: dur || 0 }); } catch (e) { console.error('[head]', e.message); }
  if (!item.tarefaAuto) return;
  const t = db.pegarTarefa(item.tarefaAuto);
  if (!t || t.status !== 'fazendo') return; // o bot já moveu o cartão sozinho
  if (parado) db.addEvento(t.id, { autor: 'usuario', tipo: 'nota', texto: 'Parado por você.' });
  else if (erro) db.addEvento(t.id, { autor: bot.id, tipo: 'nota', texto: `Parou com erro: ${String(erro).slice(0, 500)}` });
  else {
    db.atualizarTarefa(t.id, { status: 'revisao' });
    db.addEvento(t.id, { autor: bot.id, tipo: 'status', texto: 'Fazendo → Revisão' });
    if (final) db.addEvento(t.id, { autor: bot.id, tipo: 'nota', texto: String(final).slice(0, 1500) });
  }
  emitir('tarefa', { squad: t.squad, id: t.id });
};

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
  // Nada do app fica guardado no caminho (navegador, celular, Cloudflare): toda versão nova aparece no próximo
  // recarregar, em qualquer aparelho. Além disso, index.html e app.js saem com ?v=<versão> nos arquivos que chamam.
  const semCache = { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store' };
  const cab = { 'Content-Type': tipo, ...semCache, ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) };
  if (rel === '/index.html' || /\.js$/.test(rel)) {
    const v = versaoWeb();
    let txt = fs.readFileSync(arq, 'utf8');
    if (rel === '/index.html') txt = txt.replace(/(href|src)="\/(style\.css|app\.js)"/g, `$1="/$2?v=${v}"`);
    else txt = txt.replace(/(from\s+['"]\.\/[\w-]+\.js)(['"])/g, `$1?v=${v}$2`);
    res.writeHead(200, cab);
    return res.end(txt);
  }
  res.writeHead(200, cab);
  fs.createReadStream(arq).pipe(res);
}

// Versão do app = última modificação dos arquivos de web/ (muda sozinha quando o app é atualizado).
function versaoWeb() {
  let maior = 0;
  for (const f of fs.readdirSync(path.join(REPO, 'web'))) {
    try { maior = Math.max(maior, fs.statSync(path.join(REPO, 'web', f)).mtimeMs); } catch {}
  }
  return Math.round(maior).toString(36);
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
    demandas: demandas.ativas(),
    voicestudio: { noAr: await voicestudio.noAr(), instalado: voicestudio.onde().instalado, pasta: voicestudio.PASTA },
    config: {
      modeloPadrao: config.modeloPadrao, motor: config.motor || 'claude', urlPublica: config.urlPublica, memoria: config.memoria, squad: config.squad,
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
// conectores do squad: todos os bots do squad usam os mesmos
rota('PUT', '/api/squads/:id/conectores', async ({ p, corpo }) => {
  const sq = pegarSquad(p.id);
  sq.conectores = [...new Set((corpo?.conectores || []).map(String))].filter(idValido);
  store.salvarSquad(sq);
  sujarSquad(sq.id);
  emitir('estado', {});
  return sq;
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
  try { demandas.garantirDoTemplate(bot, templateDe(bot.template)); } catch (e) { console.error('[demandas]', e.message); }
  store.garantirConectoresNoSquad(bot.squad, bot.conectores); // o que o template precisa passa a valer no squad
  sujarSquad(bot.squad);
  emitir('estado', {});
  return botPublico(bot);
});
rota('PATCH', '/api/bots/:id', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const campos = ['nome', 'modelo', 'esforco', 'autonomia', 'pesado', 'conectores', 'navegador', 'pastas', 'prefs', 'env', 'cerebro', 'motor'];
  if (corpo.motor !== undefined && !['claude', 'codex', 'grok', ''].includes(corpo.motor)) throw Object.assign(new Error('motor: claude, codex ou grok'), { status: 400 });
  // trocou de motor: a sessão de um não serve no outro (a memória, a função e os resumos continuam)
  if (corpo.motor !== undefined && (corpo.motor || null) !== (bot.motor || null)) { bot.sessao = null; bot.ctxTokens = 0; bot.sessaoTurnos = 0; bot.codexInstrucoes = null; bot.grokInstrucoes = null; }
  for (const c of campos) if (corpo[c] !== undefined) bot[c] = corpo[c];
  if (corpo.avatar !== undefined) bot.avatar = store.limparAvatar(corpo.avatar);
  if (typeof bot.nome === 'string') bot.nome = bot.nome.trim().slice(0, 40) || 'Bot';
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
// barra de informações do bot: função, tarefas abertas, links e modelos
rota('GET', '/api/bots/:id/info', async ({ p }) => {
  const bot = pegarBot(p.id);
  return {
    funcao: mem.ler(bot, 'funcao'), limiteFuncao: config.memoria.limiteFuncao,
    tarefas: db.tarefasDoBot(bot.id), links: recursos.links(bot),
    modelos: recursos.modelos(bot).map(({ nome, tamanho }) => ({ nome, tamanho })),
    pasta: path.join(store.dirBot(bot), 'trabalho'),
    rotinas: rotinas.listar(bot.id),
    habilidades: skillsComDescricao(bot),
  };
});
// contexto da sessão (o "Contexto X%" ao lado do seletor de modelo)
rota('GET', '/api/bots/:id/contexto', async ({ p }) => {
  const bot = pegarBot(p.id);
  const { base, turnos } = db.contextoDaSessao(bot.id, bot.sessao);
  return {
    usado: bot.ctxTokens || 0, maximo: bot.ctxMax || config.memoria.contextoMax, compactarEm: config.memoria.compactarEm, compactarDias: config.memoria.compactarDias,
    base: Math.min(base, bot.ctxTokens || 0), turnos, inicio: bot.sessao ? bot.sessaoInicio || null : null, sessao: !!bot.sessao,
    resumos: mem.ultimosResumos(bot).length, ocupado: runner.ocupado(bot.id),
  };
});
// fila: pausar/retomar, tirar uma mensagem, passar uma mensagem para a frente
rota('POST', '/api/bots/:id/pausar', async ({ p, corpo }) => runner.pausar(pegarBot(p.id).id, corpo.pausado !== false));
rota('DELETE', '/api/bots/:id/fila/:item', async ({ p }) => runner.cancelarItem(pegarBot(p.id).id, p.item));
rota('POST', '/api/bots/:id/fila/:item/frente', async ({ p }) => runner.passarNaFrente(pegarBot(p.id).id, p.item));

// rotinas
const pegarRotina = (id) => {
  const r = rotinas.pegar(id);
  if (!r) throw Object.assign(new Error('rotina não encontrada'), { status: 404 });
  return r;
};
const comLink = (r) => ({ ...r, link: `${config.urlPublica || `http://127.0.0.1:${config.porta}`}/api/gatilho/${r.gatilho}` });
// todas as rotinas de um squad (ou de todos), para a aba Rotinas
rota('GET', '/api/rotinas', async ({ q }) => { const sq = q.get('squad'); return rotinas.listar().filter((r) => !sq || store.bots.get(r.bot)?.squad === sq).map(comLink); });
rota('POST', '/api/rotinas', async ({ corpo }) => { pegarBot(corpo.bot); return comLink(rotinas.criar(corpo)); });
rota('GET', '/api/rotinas/:id', async ({ p }) => comLink({ ...pegarRotina(p.id), descricao: rotinas.descrever(pegarRotina(p.id).quando) }));
rota('PATCH', '/api/rotinas/:id', async ({ p, corpo }) => { pegarRotina(p.id); return comLink(rotinas.editar(p.id, corpo || {})); });
rota('POST', '/api/rotinas/:id/rodar', async ({ p }) => { pegarRotina(p.id); return rotinas.disparar(p.id, { origem: 'manual' }); });
// demandas (modelos no squad + execuções)
const pegarModeloDem = (id) => { const m = demandas.pegarModelo(id); if (!m) throw Object.assign(new Error('demanda não encontrada'), { status: 404 }); return m; };
rota('GET', '/api/demandas', async ({ q }) => ({ modelos: demandas.listarModelos(q.get('squad')), execucoes: demandas.listarExecucoes({ squad: q.get('squad'), bot: q.get('bot') }) }));
rota('POST', '/api/demandas', async ({ corpo }) => { pegarBot(corpo.bot); return demandas.criarModelo(corpo); });
rota('PATCH', '/api/demandas/:id', async ({ p, corpo }) => { pegarModeloDem(p.id); return demandas.editarModelo(p.id, corpo || {}); });
rota('DELETE', '/api/demandas/:id', async ({ p }) => { pegarModeloDem(p.id); demandas.removerModelo(p.id); return { ok: true }; });
rota('POST', '/api/demandas/:id/iniciar', async ({ p, corpo }) => {
  pegarModeloDem(p.id);
  const anexos = (corpo.anexos || []).map((t) => interno.arquivoPorToken(t)).filter(Boolean).map((a) => ({ caminho: a.caminho, nome: a.nome, tamanho: a.tamanho }));
  return demandas.iniciar(p.id, { bot: corpo.bot, titulo: corpo.titulo, texto: String(corpo.texto || ''), anexos });
});
rota('GET', '/api/execucoes/:id', async ({ p }) => { const x = demandas.pegarExecucao(p.id); if (!x) throw Object.assign(new Error('demanda não encontrada'), { status: 404 }); return x; });
rota('POST', '/api/execucoes/:id/aprovar', async ({ p }) => demandas.aprovar(p.id));
rota('POST', '/api/execucoes/:id/ajuste', async ({ p, corpo }) => demandas.ajuste(p.id, corpo.texto));
rota('POST', '/api/execucoes/:id/reabrir', async ({ p, corpo }) => demandas.reabrir(p.id, corpo.etapa, corpo.texto));
rota('POST', '/api/execucoes/:id/encerrar', async ({ p }) => demandas.encerrar(p.id));
rota('DELETE', '/api/rotinas/:id', async ({ p }) => { pegarRotina(p.id); rotinas.remover(p.id); return { ok: true }; });

// sala do squad: o usuário escreve e a mensagem vai para quem deve responder
rota('POST', '/api/squads/:id/sala', async ({ p, corpo }) => {
  const sq = pegarSquad(p.id);
  const anexos = (corpo.anexos || []).map((t) => interno.arquivoPorToken(t)).filter(Boolean)
    .map((a) => ({ caminho: a.caminho, nome: a.nome, tamanho: a.tamanho }));
  return sala.enviar(sq.id, { texto: corpo.texto, anexos });
});
rota('POST', '/api/bots/:id/links', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const lista = recursos.salvarLink(bot, corpo || {});
  marcarSujo(bot);
  return lista;
});
rota('DELETE', '/api/bots/:id/links/:link', async ({ p }) => {
  const bot = pegarBot(p.id);
  const lista = recursos.removerLink(bot, p.link);
  marcarSujo(bot);
  return lista;
});
rota('GET', '/api/bots/:id/modelos/:nome', async ({ p }) => recursos.lerModelo(pegarBot(p.id), decodeURIComponent(p.nome)));
rota('PUT', '/api/bots/:id/modelos/:nome', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const m = recursos.gravarModelo(bot, corpo?.nome || decodeURIComponent(p.nome), corpo?.texto, { nomeAntigo: decodeURIComponent(p.nome) });
  marcarSujo(bot);
  return m;
});
rota('POST', '/api/bots/:id/modelos', async ({ p, corpo }) => {
  const bot = pegarBot(p.id);
  const m = recursos.gravarModelo(bot, corpo?.nome, corpo?.texto || `# ${corpo?.nome || 'Modelo'}\n`);
  marcarSujo(bot);
  return m;
});
rota('DELETE', '/api/bots/:id/modelos/:nome', async ({ p }) => {
  const bot = pegarBot(p.id);
  recursos.arquivarModelo(bot, decodeURIComponent(p.nome));
  marcarSujo(bot);
  return { ok: true };
});

// tarefas (kanban do squad)
const pegarTarefa = (id) => {
  const t = db.pegarTarefa(Number(id));
  if (!t) throw Object.assign(new Error('tarefa não encontrada'), { status: 404 });
  return t;
};
// aba Spy: bibliotecas monitoradas e blacklist
rota('GET', '/api/squads/:id/spy', async ({ p }) => { pegarSquad(p.id); return sd.spy(p.id); });
rota('PATCH', '/api/squads/:id/spy/monitoradas/:pid', async ({ p, corpo }) => { pegarSquad(p.id); const m = sd.alterarMonitorada(p.id, p.pid, corpo || {}); emitir('spy', { squad: p.id }); return m; });
rota('DELETE', '/api/squads/:id/spy/monitoradas/:pid', async ({ p }) => { pegarSquad(p.id); sd.removerMonitorada(p.id, p.pid); emitir('spy', { squad: p.id }); return { ok: true }; });
rota('POST', '/api/squads/:id/spy/blacklist', async ({ p, corpo }) => { pegarSquad(p.id); sd.blacklistAdicionar(p.id, corpo || {}); emitir('spy', { squad: p.id }); return sd.spy(p.id); });
rota('DELETE', '/api/squads/:id/spy/blacklist/:pid', async ({ p }) => { pegarSquad(p.id); sd.blacklistRemover(p.id, decodeURIComponent(p.pid)); emitir('spy', { squad: p.id }); return { ok: true }; });
// itens relevantes da sala
rota('GET', '/api/squads/:id/relevantes', async ({ p }) => { pegarSquad(p.id); return { itens: sd.relevantes(p.id) }; });
rota('PATCH', '/api/squads/:id/relevantes/:item', async ({ p, corpo }) => { pegarSquad(p.id); const it = sd.relevanteAlterar(p.id, p.item, corpo || {}); emitir('relevante', { squad: p.id, id: it.id }); return it; });
rota('GET', '/api/squads/:id/tarefas', async ({ p }) => {
  const sq = pegarSquad(p.id);
  return { tarefas: db.tarefasDoSquad(sq.id), notas: db.contarEventos(sq.id) };
});
rota('POST', '/api/tarefas', async ({ corpo }) => {
  let t = tarefas.criar(corpo || {}, { autor: 'usuario' });
  // começar agora (início imediato); com início agendado quem manda é o agendador; tarefa do Keeps não vai para bot
  if (corpo?.enviar && t.bot && t.bot !== db.KEEPS && !t.inicio) t = tarefas.enviar(t, { autor: 'usuario' });
  return t;
});
rota('GET', '/api/tarefas/:id', async ({ p }) => {
  const t = pegarTarefa(p.id);
  return { tarefa: t, eventos: db.eventosDaTarefa(t.id), pasta: t.bot ? tarefas.pastaDaTarefa(t) : null };
});
rota('PATCH', '/api/tarefas/:id', async ({ p, corpo }) => tarefas.editar(pegarTarefa(p.id), corpo || {}, { autor: 'usuario' }));
rota('POST', '/api/tarefas/:id/enviar', async ({ p }) => tarefas.enviar(pegarTarefa(p.id), { autor: 'usuario' }));
rota('POST', '/api/tarefas/:id/notas', async ({ p, corpo }) => { tarefas.anotar(pegarTarefa(p.id), corpo?.texto, { autor: 'usuario' }); return { ok: true }; });
rota('DELETE', '/api/tarefas/:id', async ({ p }) => {
  const t = pegarTarefa(p.id);
  db.apagarTarefa(t.id);
  emitir('tarefa', { squad: t.squad, id: t.id, apagada: true });
  return { ok: true };
});

// Modelos do seletor: os do ChatGPT (lidos da conta pelo Codex) ou os do Claude.
const MODELOS_CLAUDE = [
  { id: 'fable', nome: 'Fable 5.1', descricao: 'O mais capaz, para o trabalho mais difícil' },
  { id: 'opus', nome: 'Opus 5.5', descricao: 'Raciocínio forte para trabalho complexo' },
  { id: 'sonnet', nome: 'Sonnet 5.5', descricao: 'Equilíbrio entre qualidade e velocidade' },
  { id: 'haiku', nome: 'Haiku 5.5', descricao: 'O mais rápido, para tarefas simples' },
].map((m) => ({ ...m, esforcos: ['low', 'medium', 'high', 'xhigh', 'max'] }));
// cérebro: itens (modelos, biblioteca, agentes) e o texto de um item
rota('GET', '/api/cerebro', async () => ({ pasta: cerebro.DIR, itens: cerebro.listar() }));
rota('GET', '/api/cerebro/item', async ({ q }) => cerebro.ler(q.get('caminho') || ''));
rota('GET', '/api/modelos', async () => {
  if ((config.motor || 'claude') !== 'codex') return { motor: 'claude', modelos: MODELOS_CLAUDE };
  const b = [...store.bots.values()][0];
  if (!b) return { motor: 'codex', modelos: codex.modelosEmCache() || [] };
  return { motor: 'codex', modelos: await codex.modelos(b, runner.envDoTurno(b)) };
});
rota('GET', '/api/modelos/grok', async () => ({ motor: 'grok', instalado: grok.instalado(), logado: grok.logado(), modelos: await grok.modelos() }));
rota('GET', '/api/conta-chatgpt', async () => {
  const b = [...store.bots.values()][0];
  if (!b) return { conta: null, apps: [] };
  return codex.conta(b, runner.envDoTurno(b));
});

rota('GET', '/api/bots/:id/galeria', async ({ p }) => ({ itens: galeria.listar(pegarBot(p.id)) }));

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
  const permitido = ['motor', 'modeloPadrao', 'urlPublica', 'memoria', 'squad', 'atlas', 'navegador', 'push', 'hostsPermitidos', 'claudeBin'];
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
  emitir('estado', {});
  return { ok: true, conectores: statusConectores() };
});
// confere de novo a conta claude.ai (depois de conectar algo lá)
rota('POST', '/api/conectores/verificar', async () => {
  await atualizarStatusClaude();
  emitir('estado', {});
  return statusConectores();
});
// campos de uma conta que não são segredo (ex.: o e-mail da conta Google)
rota('PUT', '/api/conectores/:id/campos', async ({ p, corpo }) => {
  const campos = gravarCampos(p.id, corpo || {});
  for (const b of store.bots.values()) marcarSujo(b);
  emitir('estado', {});
  return { ok: true, campos };
});
// contas a mais de um mesmo conector (ex.: outro token da Apify, outra conta Google)
rota('POST', '/api/contas', async ({ corpo }) => {
  const conta = criarConta(corpo || {});
  emitir('estado', {});
  return conta;
});
rota('PATCH', '/api/contas/:id', async ({ p, corpo }) => {
  const conta = renomearConta(p.id, corpo?.nome);
  for (const b of store.bots.values()) marcarSujo(b);
  emitir('estado', {});
  return conta;
});
rota('DELETE', '/api/contas/:id', async ({ p }) => {
  const chaves = removerConta(p.id);
  if (chaves.length) gravarSegredos(Object.fromEntries(chaves.map((k) => [k, null])));
  for (const sq of store.squads.values()) {
    if (!(sq.conectores || []).includes(p.id)) continue;
    sq.conectores = sq.conectores.filter((x) => x !== p.id);
    store.salvarSquad(sq);
    sujarSquad(sq.id);
  }
  emitir('estado', {});
  return { ok: true };
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
rota('POST', '/api/voicestudio/ligar', async () => voicestudio.ligar());

// conversa ao vivo por voz (voz.js)
rota('GET', '/api/voz', async () => voz.estado());
rota('PUT', '/api/voz/chave', async ({ corpo }) => voz.salvarChave(corpo.chave));
rota('POST', '/api/voz/:id/chamada', async ({ p, corpo }) => voz.chamada(pegarBot(p.id), corpo.sdp));
rota('POST', '/api/voz/:id/pedir', async ({ p, corpo }) => voz.pedir(pegarBot(p.id), corpo.pedido));
rota('POST', '/api/voz/:id/fim', async ({ p, corpo }) => voz.encerrar(pegarBot(p.id), corpo || {}));

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

  // link de disparo de uma rotina (webhook): o token longo na URL é a autorização; o corpo JSON vai junto para o bot
  const mGat = url.pathname.match(/^\/api\/gatilho\/([a-f0-9]{32})$/);
  if (mGat) {
    const r = rotinas.porGatilho(mGat[1]);
    if (!r) return json(res, 404, { erro: 'link de rotina não encontrado' });
    if (req.method !== 'POST') return json(res, 405, { erro: 'use POST' });
    let dados = null;
    try { dados = await corpoJSON(req); } catch { dados = null; }
    return json(res, 200, rotinas.disparar(r.id, { origem: 'link', dados }));
  }

  // arquivo entregue por um bot ou anexado: o token na URL é a autorização (funciona em <video src>)
  // capa (miniatura) para a galeria do bot
  const mCapa = url.pathname.match(/^\/api\/arquivo\/([a-f0-9]{24})\/capa$/);
  if (mCapa) {
    const arq = await galeria.capa(mCapa[1]);
    if (!arq) return json(res, 404, { erro: 'sem capa' });
    return servirArquivo(req, res, arq);
  }
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
    if (req.method === 'PUT' && url.pathname === '/api/ditado') return json(res, 200, await ditado.receber(req));

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
  rotinas.iniciarRotinas();
  try { demandas.iniciarDemandas(templateDe); } catch (e) { console.error('[demandas]', e.message); }
  tarefas.iniciarAgendador();
  head.iniciar();
  // a fila e o trabalho interrompido (queda de energia, reinício) voltam de onde pararam
  setTimeout(() => runner.restaurarFilas(), 1500);
});
