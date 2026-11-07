// Banco local (SQLite embutido no Node, sem dependência nativa): histórico das conversas com busca de texto (FTS5),
// turnos (tempo, custo estimado, contexto) e inscrições de notificação.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HOME } from './config.js';

const db = new DatabaseSync(path.join(HOME, 'flow.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot TEXT NOT NULL,
  squad TEXT NOT NULL,
  sessao TEXT,
  papel TEXT NOT NULL,          -- usuario | bot | ferramenta | sistema | entrada (mensagem de outro bot recebida)
  de TEXT,                      -- id do bot que mandou (mensagens entre bots)
  para TEXT,
  texto TEXT NOT NULL,
  meta TEXT,
  criado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mensagens_bot ON mensagens(bot, id);
CREATE INDEX IF NOT EXISTS mensagens_squad ON mensagens(squad, papel, id);
CREATE VIRTUAL TABLE IF NOT EXISTS mensagens_fts USING fts5(
  texto, content='mensagens', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS mensagens_ai AFTER INSERT ON mensagens WHEN new.papel != 'ferramenta' BEGIN
  INSERT INTO mensagens_fts(rowid, texto) VALUES (new.id, new.texto);
END;
CREATE TRIGGER IF NOT EXISTS mensagens_ad AFTER DELETE ON mensagens WHEN old.papel != 'ferramenta' BEGIN
  INSERT INTO mensagens_fts(mensagens_fts, rowid, texto) VALUES ('delete', old.id, old.texto);
END;
CREATE TABLE IF NOT EXISTS turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot TEXT NOT NULL,
  sessao TEXT,
  origem TEXT,
  inicio INTEGER,
  fim INTEGER,
  status TEXT,
  custo REAL,
  contexto INTEGER,
  erro TEXT
);
CREATE TABLE IF NOT EXISTS push (
  endpoint TEXT PRIMARY KEY,
  dados TEXT NOT NULL,
  criado INTEGER NOT NULL
);
-- Tarefas (quadro kanban do squad): o usuário e os bots criam, repassam e movem.
CREATE TABLE IF NOT EXISTS tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  squad TEXT NOT NULL,
  bot TEXT,                     -- responsável (vazio = ninguém ainda)
  titulo TEXT NOT NULL,
  descricao TEXT,
  entregaveis TEXT,             -- o que é "pronto"
  status TEXT NOT NULL,         -- afazer | fazendo | revisao | feito
  criado_por TEXT,              -- "usuario" ou id do bot
  pai INTEGER,                  -- tarefa de onde esta saiu (repasse)
  ordem REAL,
  criado INTEGER NOT NULL,
  atualizado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tarefas_squad ON tarefas(squad, status);
CREATE TABLE IF NOT EXISTS tarefa_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarefa INTEGER NOT NULL,
  autor TEXT,                   -- "usuario" ou id do bot
  tipo TEXT NOT NULL,           -- criada | status | nota | repasse | enviada
  texto TEXT,
  criado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tarefa_eventos_t ON tarefa_eventos(tarefa, id);
`);

// ---------- tarefas ----------
const STATUS = ['afazer', 'fazendo', 'revisao', 'feito'];
export const statusValido = (s) => STATUS.includes(s);
const tarefaLinha = (r) => r && { id: Number(r.id), squad: r.squad, bot: r.bot, titulo: r.titulo, descricao: r.descricao || '', entregaveis: r.entregaveis || '',
  status: r.status, criadoPor: r.criado_por, pai: r.pai ? Number(r.pai) : null, ordem: r.ordem, criado: r.criado, atualizado: r.atualizado };

export function criarTarefa({ squad, bot = null, titulo, descricao = '', entregaveis = '', status = 'afazer', criadoPor = 'usuario', pai = null }) {
  const agora = Date.now();
  const r = db.prepare(`INSERT INTO tarefas (squad, bot, titulo, descricao, entregaveis, status, criado_por, pai, ordem, criado, atualizado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(squad, bot, titulo, descricao, entregaveis, statusValido(status) ? status : 'afazer', criadoPor, pai, agora, agora, agora);
  return pegarTarefa(Number(r.lastInsertRowid));
}
export const pegarTarefa = (id) => tarefaLinha(db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id));
export function atualizarTarefa(id, campos) {
  const map = { bot: 'bot', titulo: 'titulo', descricao: 'descricao', entregaveis: 'entregaveis', status: 'status', ordem: 'ordem' };
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(map)) if (campos[k] !== undefined) { sets.push(`${col} = ?`); vals.push(campos[k]); }
  if (!sets.length) return pegarTarefa(id);
  db.prepare(`UPDATE tarefas SET ${sets.join(', ')}, atualizado = ? WHERE id = ?`).run(...vals, Date.now(), id);
  return pegarTarefa(id);
}
export function apagarTarefa(id) {
  db.prepare('DELETE FROM tarefa_eventos WHERE tarefa = ?').run(id);
  db.prepare('DELETE FROM tarefas WHERE id = ?').run(id);
}
export const tarefasDoSquad = (squad) => db.prepare('SELECT * FROM tarefas WHERE squad = ? ORDER BY ordem, id').all(squad).map(tarefaLinha);
export const tarefasDoBot = (bot, { abertas = true } = {}) => db.prepare(`SELECT * FROM tarefas WHERE bot = ? ${abertas ? "AND status != 'feito'" : ''} ORDER BY ordem, id`).all(bot).map(tarefaLinha);
export function addEvento(tarefa, { autor = 'usuario', tipo, texto = '' }) {
  db.prepare('INSERT INTO tarefa_eventos (tarefa, autor, tipo, texto, criado) VALUES (?, ?, ?, ?, ?)').run(tarefa, autor, tipo, texto, Date.now());
}
export const eventosDaTarefa = (tarefa) => db.prepare('SELECT * FROM tarefa_eventos WHERE tarefa = ? ORDER BY id').all(tarefa)
  .map((e) => ({ id: Number(e.id), autor: e.autor, tipo: e.tipo, texto: e.texto, criado: e.criado }));
export const contarEventos = (squad) => Object.fromEntries(db.prepare(`SELECT e.tarefa AS t, COUNT(*) AS n FROM tarefa_eventos e
  JOIN tarefas t ON t.id = e.tarefa WHERE t.squad = ? AND e.tipo = 'nota' GROUP BY e.tarefa`).all(squad).map((r) => [Number(r.t), Number(r.n)]));

const stInserir = db.prepare(`INSERT INTO mensagens (bot, squad, sessao, papel, de, para, texto, meta, criado)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

export function addMensagem({ bot, squad, sessao = null, papel, de = null, para = null, texto, meta = null }) {
  const criado = Date.now();
  const r = stInserir.run(bot, squad, sessao, papel, de, para, String(texto ?? ''), meta ? JSON.stringify(meta) : null, criado);
  return { id: Number(r.lastInsertRowid), bot, squad, sessao, papel, de, para, texto: String(texto ?? ''), meta, criado };
}

function linha(r) {
  return r && { ...r, meta: r.meta ? JSON.parse(r.meta) : null };
}

export function listarMensagens(bot, { antes = null, limite = 80 } = {}) {
  const rows = antes
    ? db.prepare('SELECT * FROM mensagens WHERE bot = ? AND id < ? ORDER BY id DESC LIMIT ?').all(bot, antes, limite)
    : db.prepare('SELECT * FROM mensagens WHERE bot = ? ORDER BY id DESC LIMIT ?').all(bot, limite);
  return rows.reverse().map(linha);
}

// Sala do squad: a conversa do usuário com o squad (bot = "sala:<squad>") e as mensagens trocadas entre os bots.
export function salaDoSquad(squad, limite = 200) {
  return db.prepare(`SELECT * FROM mensagens WHERE squad = ? AND (papel = 'entrada' OR bot = ?) ORDER BY id DESC LIMIT ?`)
    .all(squad, `sala:${squad}`, limite).reverse().map(linha);
}

function consultaFts(q) {
  return String(q).split(/\s+/).filter(Boolean).slice(0, 12).map((t) => `"${t.replace(/"/g, '')}"`).join(' ');
}

export function buscar(q, { bot = null, squad = null, limite = 12 } = {}) {
  const m = consultaFts(q);
  if (!m) return [];
  const filtro = bot ? 'AND m.bot = ?' : squad ? 'AND m.squad = ?' : '';
  const params = [m, ...(bot ? [bot] : squad ? [squad] : []), limite];
  return db.prepare(`SELECT m.id, m.bot, m.papel, m.de, m.sessao, m.criado,
      snippet(mensagens_fts, 0, '«', '»', ' … ', 24) AS trecho
    FROM mensagens_fts JOIN mensagens m ON m.id = mensagens_fts.rowid
    WHERE mensagens_fts MATCH ? ${filtro}
    ORDER BY rank LIMIT ?`).all(...params);
}

export function iniciarTurno({ bot, sessao, origem }) {
  const r = db.prepare('INSERT INTO turnos (bot, sessao, origem, inicio, status) VALUES (?, ?, ?, ?, ?)')
    .run(bot, sessao, origem, Date.now(), 'rodando');
  return Number(r.lastInsertRowid);
}

export function fecharTurno(id, { status, custo = null, contexto = null, erro = null }) {
  db.prepare('UPDATE turnos SET fim = ?, status = ?, custo = ?, contexto = ?, erro = ? WHERE id = ?')
    .run(Date.now(), status, custo, contexto, erro, id);
}

// Turnos que ficaram "rodando" porque o servidor caiu no meio: viram "interrompido" quando ele liga de novo.
export function fecharTurnosAbertos() {
  return Number(db.prepare("UPDATE turnos SET status = 'interrompido', fim = ? WHERE status = 'rodando'").run(Date.now()).changes);
}

// Contexto da sessão: o do primeiro turno é o "fixo" (instruções, ferramentas, função, memória) que toda sessão carrega.
export function contextoDaSessao(bot, sessao) {
  if (!sessao) return { base: 0, turnos: 0 };
  const r = db.prepare(`SELECT COUNT(*) AS turnos, MIN(id) AS primeiro FROM turnos WHERE bot = ? AND sessao = ? AND contexto IS NOT NULL`).get(bot, sessao);
  const base = r?.primeiro ? db.prepare('SELECT contexto FROM turnos WHERE id = ?').get(r.primeiro)?.contexto || 0 : 0;
  return { base, turnos: r?.turnos || 0 };
}

export function custos(desde) {
  return db.prepare(`SELECT bot, COUNT(*) AS turnos, SUM(custo) AS custo, SUM(fim - inicio) AS ms
    FROM turnos WHERE inicio >= ? GROUP BY bot`).all(desde);
}

export function pushListar() {
  return db.prepare('SELECT endpoint, dados FROM push').all().map((r) => JSON.parse(r.dados));
}
export function pushSalvar(sub) {
  db.prepare('INSERT OR REPLACE INTO push (endpoint, dados, criado) VALUES (?, ?, ?)').run(sub.endpoint, JSON.stringify(sub), Date.now());
}
export function pushRemover(endpoint) {
  db.prepare('DELETE FROM push WHERE endpoint = ?').run(endpoint);
}

export function limparAntigas(dias) {
  const limite = Date.now() - dias * 86400e3;
  const r = db.prepare('DELETE FROM mensagens WHERE criado < ?').run(limite);
  db.prepare('DELETE FROM turnos WHERE inicio < ?').run(limite);
  return Number(r.changes);
}

export function compactarBanco() {
  db.exec("INSERT INTO mensagens_fts(mensagens_fts) VALUES ('optimize'); VACUUM;");
}

export function apagarDoBot(bot) {
  db.prepare('DELETE FROM mensagens WHERE bot = ?').run(bot);
}
