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
`);

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

// Sala do squad: só as mensagens trocadas entre os bots.
export function salaDoSquad(squad, limite = 150) {
  return db.prepare(`SELECT * FROM mensagens WHERE squad = ? AND papel = 'entrada' ORDER BY id DESC LIMIT ?`)
    .all(squad, limite).reverse().map(linha);
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
