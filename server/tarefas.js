// Tarefas do squad (o kanban): o usuário e os bots criam, repassam, mudam de coluna e anotam.
// Repasse entre bots = uma tarefa nova com responsável, enviada a ele já com objetivo, "pronto quando" e uma pasta
// própria dentro da pasta de trabalho do bot. Quando o bot termina (revisão/feito), quem pediu recebe o aviso.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import * as runner from './runner.js';
import { bots, squads, dirBot } from './store.js';
import { emitir, notificar } from './eventos.js';
import { config } from './config.js';

export const ROTULO = { afazer: 'A fazer', fazendo: 'Fazendo', revisao: 'Revisão', feito: 'Feito' };

const simples = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tarefa';
export const nomeAutor = (a) => (a === 'usuario' ? 'você' : `@${bots.get(a)?.nome || a}`);

// Pasta da tarefa, dentro da pasta de trabalho do bot responsável (tudo fica no ~/ClaudeFlow).
export function pastaDaTarefa(t) {
  const b = bots.get(t.bot);
  if (!b) return null;
  const p = path.join(dirBot(b), 'trabalho', 'tarefas', `${t.id}-${simples(t.titulo)}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function textoDaTarefa(t, deQuem) {
  const pasta = pastaDaTarefa(t);
  return [
    `[Tarefa #${t.id} — ${deQuem}]`,
    `Título: ${t.titulo}`,
    t.descricao ? `Objetivo e contexto:\n${t.descricao}` : null,
    t.entregaveis ? `Pronto quando: ${t.entregaveis}` : null,
    pasta ? `Pasta desta tarefa (guarde aqui o que produzir): ${pasta}` : null,
    `Ao terminar: mcp__flow__tarefa_atualizar (id ${t.id}) com status "revisao" (para o usuário conferir) ou "feito" e uma nota curta do que entregou e onde. Para repassar uma parte a outro bot do squad: mcp__flow__tarefa_criar com para=<bot>.`,
  ].filter(Boolean).join('\n');
}

const avisar = (t) => emitir('tarefa', { squad: t.squad, id: t.id });

export function criar(dados, { autor = 'usuario' } = {}) {
  if (!squads.has(dados.squad)) throw Object.assign(new Error('squad não encontrado'), { status: 404 });
  const titulo = String(dados.titulo || '').trim().slice(0, 200);
  if (!titulo) throw Object.assign(new Error('dê um título à tarefa'), { status: 400 });
  const bot = dados.bot && bots.get(dados.bot)?.squad === dados.squad ? dados.bot : null;
  const t = db.criarTarefa({ ...dados, titulo, bot, criadoPor: autor });
  db.addEvento(t.id, { autor, tipo: 'criada', texto: bot ? `para @${bots.get(bot).nome}` : '' });
  avisar(t);
  return t;
}

// Manda a tarefa para o responsável começar (vira mensagem no chat dele, com tudo o que precisa).
export function enviar(t, { autor = 'usuario', cadeia = 0 } = {}) {
  const b = bots.get(t.bot);
  if (!b) throw Object.assign(new Error('escolha o bot responsável antes de enviar'), { status: 400 });
  const origem = autor === 'usuario' ? { tipo: 'usuario' } : { tipo: 'bot', id: autor, nome: bots.get(autor)?.nome };
  runner.enviar(b.id, { texto: textoDaTarefa(t, autor === 'usuario' ? 'pedida por você' : `repassada por ${nomeAutor(autor)}`), origem, cadeia, tarefa: t.id });
  if (t.status === 'afazer') db.atualizarTarefa(t.id, { status: 'fazendo' });
  db.addEvento(t.id, { autor, tipo: 'enviada', texto: `para @${b.nome}` });
  avisar(t);
  return db.pegarTarefa(t.id);
}

// Tarefas que algum bot está esperando com tarefas_aguardar (aí quem pediu não recebe o aviso como mensagem nova).
export const aguardadas = new Set();

export function mudarStatus(t, status, { autor = 'usuario', nota = '', cadeia = 0 } = {}) {
  if (!db.statusValido(status)) throw Object.assign(new Error('status inválido (afazer, fazendo, revisao, feito)'), { status: 400 });
  const antes = t.status;
  const nova = db.atualizarTarefa(t.id, { status });
  if (antes !== status) db.addEvento(t.id, { autor, tipo: 'status', texto: `${ROTULO[antes]} → ${ROTULO[status]}` });
  if (nota) db.addEvento(t.id, { autor, tipo: 'nota', texto: String(nota).slice(0, 4000) });
  avisar(t);
  if (antes !== status && ['revisao', 'feito'].includes(status) && autor !== 'usuario') {
    const pediu = t.criadoPor;
    // quem repassou (outro bot) recebe o resultado e continua o fluxo
    if (pediu && pediu !== 'usuario' && pediu !== autor && bots.has(pediu) && !aguardadas.has(t.id) && cadeia + 1 <= config.squad.maxCadeia) {
      runner.enviar(pediu, {
        texto: `[Tarefa #${t.id} "${t.titulo}" ${status === 'feito' ? 'concluída' : 'pronta para revisão'} por ${nomeAutor(autor)}]\n${nota || '(sem nota)'}`,
        origem: { tipo: 'bot', id: autor, nome: bots.get(autor)?.nome }, cadeia: cadeia + 1,
      });
    }
    if (status === 'revisao') notificar({ titulo: `Tarefa #${t.id} para revisar`, texto: `${t.titulo} · ${nomeAutor(autor)}`, bot: autor, forcar: true, tag: `tarefa-${t.id}` });
  }
  return nova;
}

export function anotar(t, texto, { autor = 'usuario' } = {}) {
  const txt = String(texto || '').trim();
  if (!txt) throw Object.assign(new Error('nota vazia'), { status: 400 });
  db.addEvento(t.id, { autor, tipo: 'nota', texto: txt.slice(0, 4000) });
  db.atualizarTarefa(t.id, {});
  avisar(t);
}

export function editar(t, campos, { autor = 'usuario' } = {}) {
  const ok = {};
  for (const k of ['titulo', 'descricao', 'entregaveis', 'ordem']) if (campos[k] !== undefined) ok[k] = k === 'ordem' ? Number(campos[k]) : String(campos[k]);
  if (campos.bot !== undefined) {
    const b = campos.bot ? bots.get(campos.bot) : null;
    if (campos.bot && b?.squad !== t.squad) throw Object.assign(new Error('esse bot não é deste squad'), { status: 400 });
    if ((t.bot || null) !== (campos.bot || null)) {
      ok.bot = campos.bot || null;
      db.addEvento(t.id, { autor, tipo: 'repasse', texto: b ? `responsável: @${b.nome}` : 'sem responsável' });
    }
  }
  let nova = db.atualizarTarefa(t.id, ok);
  if (campos.status && campos.status !== t.status) nova = mudarStatus(nova, campos.status, { autor });
  avisar(t);
  return nova;
}

export function comoTexto(t) {
  return `#${t.id} [${ROTULO[t.status]}] ${t.titulo}${t.bot ? ` · @${bots.get(t.bot)?.nome || t.bot}` : ' · sem responsável'}${t.criadoPor ? ` · pedida por ${nomeAutor(t.criadoPor)}` : ''}`;
}
