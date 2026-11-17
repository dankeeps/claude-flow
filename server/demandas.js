// Demandas: trabalhos em etapas (ex.: "Novo roteiro": personagens → cenas → storyboard → …). O modelo fica no squad
// (nome, bot responsável, etapas com a instrução de cada uma). Iniciar cria uma execução: no chat do bot ela aparece
// como UM cartão só, que vai mudando de etapa, em vez de vários textos e quadros soltos. O bot entrega cada etapa no
// cartão (mcp__flow__demanda_etapa) e o usuário aprova, pede ajuste ou reabre uma etapa pelo próprio cartão.
// Tudo em ~/ClaudeFlow/demandas.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, lerJSON, gravarJSON } from './config.js';
import { bots } from './store.js';
import * as runner from './runner.js';
import * as db from './db.js';
import { emitir } from './eventos.js';

const ARQ = path.join(HOME, 'demandas.json');
const dados = { modelos: [], execucoes: [], ...lerJSON(ARQ, {}) };
const salvar = () => gravarJSON(ARQ, dados);
const novoId = () => crypto.randomBytes(5).toString('hex');
const corta = (s, n) => String(s ?? '').trim().slice(0, n);

// ---------- modelos ----------
function limparEtapas(etapas) {
  const l = (Array.isArray(etapas) ? etapas : []).map((e) => ({ nome: corta(e?.nome, 60), instrucao: corta(e?.instrucao, 4000) })).filter((e) => e.nome);
  if (!l.length) throw new Error('A demanda precisa de pelo menos uma etapa (com nome).');
  if (l.length > 15) throw new Error('No máximo 15 etapas.');
  return l;
}
const publicoModelo = (m) => ({ ...m, botNome: bots.get(m.bot)?.nome || m.bot });
export const listarModelos = (squad = null) => dados.modelos.filter((m) => !squad || m.squad === squad).map(publicoModelo);
export const pegarModelo = (id) => dados.modelos.find((m) => m.id === id) || null;

export function criarModelo({ bot, nome, descricao = '', instrucao = '', etapas, origem = null }) {
  const b = bots.get(bot);
  if (!b) throw new Error('bot não encontrado');
  if (!corta(nome, 80)) throw new Error('Dê um nome à demanda.');
  const m = { id: novoId(), squad: b.squad, bot: b.id, nome: corta(nome, 80), descricao: corta(descricao, 400), instrucao: corta(instrucao, 6000), etapas: limparEtapas(etapas), origem, criado: Date.now() };
  dados.modelos.push(m);
  salvar(); emitir('demandas', {});
  return publicoModelo(m);
}

export function editarModelo(id, c = {}) {
  const m = pegarModelo(id);
  if (!m) throw new Error('demanda não encontrada');
  if (c.nome !== undefined) m.nome = corta(c.nome, 80) || m.nome;
  if (c.descricao !== undefined) m.descricao = corta(c.descricao, 400);
  if (c.instrucao !== undefined) m.instrucao = corta(c.instrucao, 6000);
  if (c.etapas !== undefined) m.etapas = limparEtapas(c.etapas);
  if (c.bot !== undefined) { const b = bots.get(c.bot); if (!b || b.squad !== m.squad) throw new Error('bot de outro squad'); m.bot = b.id; }
  m.origem = null; // editado pelo usuário: o template não sobrescreve mais
  salvar(); emitir('demandas', {});
  return publicoModelo(m);
}

export function removerModelo(id) {
  const i = dados.modelos.findIndex((m) => m.id === id);
  if (i < 0) throw new Error('demanda não encontrada');
  dados.modelos.splice(i, 1);
  salvar(); emitir('demandas', {});
}

// Templates podem trazer modelos prontos (template.json "demandas"): entram no squad do bot uma vez.
export function garantirDoTemplate(bot, template) {
  if (!bot || !template?.demandas?.length) return;
  let mudou = false;
  for (const d of template.demandas) {
    const origem = `${template.id}:${d.nome}`;
    if (dados.modelos.some((m) => m.squad === bot.squad && (m.origem === origem || m.origemOriginal === origem))) continue;
    try {
      dados.modelos.push({ id: novoId(), squad: bot.squad, bot: bot.id, nome: corta(d.nome, 80), descricao: corta(d.descricao, 400), instrucao: corta(d.instrucao, 6000), etapas: limparEtapas(d.etapas), origem, origemOriginal: origem, criado: Date.now() });
      mudou = true;
    } catch (e) { console.error('[demandas] template', template.id, e.message); }
  }
  if (mudou) { salvar(); emitir('demandas', {}); }
}

// ---------- execuções ----------
const pegar = (id) => dados.execucoes.find((x) => x.id === id) || null;
export const ativaDoBot = (botId) => dados.execucoes.find((x) => x.bot === botId && x.status === 'andamento') || null;
export const publica = (x) => x && ({ ...x, botNome: bots.get(x.bot)?.nome || x.bot });
export const listarExecucoes = ({ squad = null, bot = null, limite = 40 } = {}) =>
  dados.execucoes.filter((x) => (!squad || x.squad === squad) && (!bot || x.bot === bot)).sort((a, b) => b.criado - a.criado).slice(0, limite).map(publica);
export const pegarExecucao = (id) => publica(pegar(id));
export const ativas = () => dados.execucoes.filter((x) => x.status === 'andamento').map(publica);

function mudou(x) { x.atualizado = Date.now(); salvar(); emitir('demanda', publica(x)); }

// O que o bot recebe junto de cada mensagem enquanto a demanda está aberta (não aparece no chat).
export function contextoParaBot(botId) {
  const x = ativaDoBot(botId);
  if (!x) return '';
  const e = x.etapas[x.atual];
  const lista = x.etapas.map((t, i) => `${i + 1}. ${t.nome}${i < x.atual ? ' (aprovada)' : i === x.atual ? ' ← AGORA' : ''}`).join('\n');
  return `[DEMANDA ABERTA: "${x.nome}"${x.titulo ? ` — ${x.titulo}` : ''}
Etapas:\n${lista}
Etapa atual: ${x.atual + 1} de ${x.etapas.length} — ${e.nome}.${e.instrucao ? `\nInstrução desta etapa: ${e.instrucao}` : ''}${x.instrucao ? `\nInstrução geral da demanda: ${x.instrucao}` : ''}
Como trabalhar numa demanda:
- O usuário acompanha tudo num CARTÃO da demanda no chat. O resultado da etapa vai no cartão com mcp__flow__demanda_etapa (texto em markdown + itens = arquivos de imagem/vídeo/áudio, cada um com título e descrição curta), NÃO em texto longo no chat e NÃO com quadro_entregar/arquivo_entregar.
- Etapa pronta para ele avaliar: demanda_etapa com status "aguardando" e encerre o turno. Ele aprova ou pede ajuste pelo cartão; não comece a próxima etapa sem a aprovação.
- Enquanto trabalha numa etapa longa, pode atualizar o cartão com status "trabalhando" e um progresso curto ("cena 4 de 12").
- Etapa que não se aplica a este pedido (ex.: o material já veio pronto): demanda_etapa com status "pulada" e o motivo no texto; a próxima etapa começa na hora.
- A resposta final do turno no chat: uma frase curta (ex.: "Storyboard pronto no cartão."). Pedido de ajuste: refaça só o que foi pedido e entregue a etapa de novo no cartão (os itens novos substituem os da etapa).]`;
}

export function iniciar(modeloId, { bot: botId = null, titulo = '', texto = '', anexos = [] } = {}) {
  const m = pegarModelo(modeloId);
  if (!m) throw new Error('demanda não encontrada');
  const bot = bots.get(botId || m.bot);
  if (!bot) throw new Error('o bot desta demanda não existe mais');
  if (ativaDoBot(bot.id)) throw new Error(`${bot.nome} já tem uma demanda aberta: aprove até o fim ou encerre antes de começar outra.`);
  const x = {
    id: novoId(), modelo: m.id, squad: bot.squad, bot: bot.id, nome: m.nome, titulo: corta(titulo, 120) || corta(texto.split('\n')[0], 80),
    instrucao: m.instrucao, atual: 0, status: 'andamento', criado: Date.now(), atualizado: Date.now(),
    etapas: m.etapas.map((e) => ({ nome: e.nome, instrucao: e.instrucao, status: 'pendente', texto: '', itens: [], progresso: '', ajustes: [] })),
  };
  x.etapas[0].status = 'trabalhando';
  dados.execucoes.push(x);
  // marcador no histórico: no lugar onde a demanda começou (o cartão em si fica no fim da conversa enquanto ela está aberta)
  const msg = db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'demanda', texto: `Demanda: ${x.nome} ${x.titulo}`.trim(), meta: { demanda: x.id } });
  emitir('msg', msg);
  mudou(x);
  runner.enviar(bot.id, { texto: corta(texto, 20000) || '(veja os anexos)', anexos, origem: { tipo: 'usuario' }, cadeia: 0 });
  return publica(x);
}

// ---------- o que o bot faz (ferramenta interna) ----------
export function botAtualizar(bot, { texto, itens, status = 'aguardando', progresso }, registrarArquivo) {
  const x = ativaDoBot(bot.id);
  if (!x) throw new Error('Você não tem demanda aberta agora: responda normalmente no chat.');
  const e = x.etapas[x.atual];
  if (texto !== undefined) e.texto = corta(texto, 12000);
  if (progresso !== undefined) e.progresso = corta(progresso, 200);
  if (Array.isArray(itens)) {
    if (itens.length > 60) throw new Error('No máximo 60 itens por etapa.');
    e.itens = itens.map((it, i) => {
      const caminho = String(it?.caminho || '');
      if (!caminho || !fs.existsSync(caminho) || fs.statSync(caminho).isDirectory()) throw new Error(`Item ${i + 1}: arquivo não encontrado: ${caminho}`);
      const a = registrarArquivo(caminho, { bot: bot.id });
      return { token: a.token, nome: a.nome, tamanho: a.tamanho, titulo: corta(it.titulo, 120), texto: corta(it.texto, 1500) };
    });
  }
  if (status === 'pulada') {
    e.status = 'pulada'; e.progresso = '';
    if (x.atual >= x.etapas.length - 1) { x.status = 'concluida'; x.fim = Date.now(); mudou(x); return 'Era a última etapa: demanda concluída.'; }
    x.atual += 1; x.etapas[x.atual].status = 'trabalhando';
    mudou(x);
    const p = x.etapas[x.atual];
    return `Etapa pulada. Agora a etapa ${x.atual + 1} de ${x.etapas.length}: ${p.nome}.${p.instrucao ? ` Instrução: ${p.instrucao}` : ''} Comece já.`;
  }
  e.status = status === 'trabalhando' ? 'trabalhando' : 'aguardando';
  if (e.status === 'aguardando') e.progresso = '';
  mudou(x);
  return e.status === 'aguardando'
    ? `Etapa "${e.nome}" no cartão, esperando o usuário. Encerre o turno com uma frase curta.`
    : 'Cartão atualizado.';
}

export function botVer(bot) {
  const x = ativaDoBot(bot.id);
  if (!x) return 'Nenhuma demanda aberta.';
  return JSON.stringify({ nome: x.nome, titulo: x.titulo, etapaAtual: x.atual + 1, etapas: x.etapas.map((e, i) => ({ n: i + 1, nome: e.nome, status: e.status, texto: e.texto.slice(0, 600), itens: e.itens.map((it) => it.titulo || it.nome), ajustes: e.ajustes.map((a) => a.texto) })) }, null, 1);
}

// ---------- o que o usuário faz no cartão ----------
function avisarBot(x, texto) {
  runner.enviar(x.bot, { texto, origem: { tipo: 'usuario' }, cadeia: 0 });
}

export function aprovar(id) {
  const x = pegar(id);
  if (!x || x.status !== 'andamento') throw new Error('demanda não está aberta');
  const e = x.etapas[x.atual];
  e.status = 'aprovada'; e.progresso = '';
  if (x.atual >= x.etapas.length - 1) {
    x.status = 'concluida'; x.fim = Date.now();
    mudou(x);
    avisarBot(x, `✓ Aprovei a última etapa (${e.nome}). Demanda "${x.nome}" concluída.`);
    return publica(x);
  }
  x.atual += 1;
  x.etapas[x.atual].status = 'trabalhando';
  mudou(x);
  avisarBot(x, `✓ Aprovei a etapa ${e.nome}. Pode seguir para ${x.etapas[x.atual].nome}.`);
  return publica(x);
}

export function ajuste(id, texto) {
  const x = pegar(id);
  if (!x || x.status !== 'andamento') throw new Error('demanda não está aberta');
  const t = corta(texto, 4000);
  if (!t) throw new Error('Escreva o que mudar.');
  const e = x.etapas[x.atual];
  e.ajustes.push({ texto: t, criado: Date.now() });
  e.status = 'trabalhando';
  mudou(x);
  avisarBot(x, `Ajuste na etapa ${e.nome}: ${t}`);
  return publica(x);
}

// Volta para uma etapa já aprovada (refazer): as seguintes voltam a "pendente" (o que já foi feito nelas fica visível).
export function reabrir(id, etapa, texto = '') {
  const x = pegar(id);
  if (!x) throw new Error('demanda não encontrada');
  const n = Number(etapa);
  if (!(n >= 0 && n < x.etapas.length)) throw new Error('etapa inválida');
  if (x.status === 'andamento' && n >= x.atual) throw new Error('essa etapa ainda não foi aprovada');
  if (ativaDoBot(x.bot) && ativaDoBot(x.bot).id !== x.id) throw new Error('o bot já está em outra demanda aberta');
  x.status = 'andamento'; delete x.fim;
  x.atual = n;
  x.etapas.forEach((e, i) => { if (i === n) e.status = 'trabalhando'; else if (i > n && e.status !== 'pulada') e.status = 'pendente'; });
  const t = corta(texto, 4000);
  if (t) x.etapas[n].ajustes.push({ texto: t, criado: Date.now() });
  mudou(x);
  avisarBot(x, `Reabri a etapa ${x.etapas[n].nome}${t ? `: ${t}` : '. Refaça essa etapa'} (as etapas seguintes vão precisar de aprovação de novo).`);
  return publica(x);
}

export function encerrar(id) {
  const x = pegar(id);
  if (!x || x.status !== 'andamento') throw new Error('demanda não está aberta');
  x.status = 'encerrada'; x.fim = Date.now();
  for (const e of x.etapas) if (e.status === 'trabalhando' || e.status === 'aguardando') e.status = 'pendente';
  mudou(x);
  emitir('msg', db.addMensagem({ bot: x.bot, squad: x.squad, papel: 'sistema', texto: `Demanda "${x.nome}" encerrada sem concluir.` }));
  return publica(x);
}

export function iniciarDemandas(templateDe) {
  // modelos que vêm dos templates dos bots que já existem
  for (const b of bots.values()) { try { garantirDoTemplate(b, templateDe(b.template)); } catch {} }
  // modelos de bot que não existe mais ficam (o usuário troca o bot no editor ou apaga pela aba Demandas)
}
