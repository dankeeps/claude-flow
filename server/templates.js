// Templates de bot: cada pasta em templates/ tem template.json, funcao.md, instrucoes.md (opcional), memoria.md
// (opcional, fatos de partida) e skills/ (cada skill vira um atalho em <bot>/.claude/skills, então a .venv e os
// arquivos grandes ficam num lugar só, no repositório).
import fs from 'node:fs';
import path from 'node:path';
import { REPO, IS_WIN, config, expandir, lerJSON, lerTexto, gravarTexto, gravarJSON } from './config.js';
import { dirBot, novoBotBase, salvarBot, bots, limparAvatar } from './store.js';

const DIR = path.join(REPO, 'templates');

export function listarTemplates() {
  return fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'template.json'))).map((id) => {
    const t = lerJSON(path.join(DIR, id, 'template.json'));
    const skills = fs.existsSync(path.join(DIR, id, 'skills')) ? fs.readdirSync(path.join(DIR, id, 'skills')).filter((s) => !s.startsWith('.')) : [];
    return { id, ordem: 50, ...t, skills };
  }).sort((a, b) => a.ordem - b.ordem);
}

export const template = (id) => listarTemplates().find((t) => t.id === id) || null;
export const dirTemplate = (id) => path.join(DIR, id);

// {{atlas.dir}}, {{repo}}, {{template}} e ~ nos valores do template
function resolver(v, id) {
  if (typeof v !== 'string') return v;
  return expandir(v.replace(/\{\{repo\}\}/g, REPO).replace(/\{\{template\}\}/g, dirTemplate(id))
    .replace(/\{\{atlas\.dir\}\}/g, expandir(config.atlas.dir)).replace(/\{\{atlas\.url\}\}/g, config.atlas.url));
}

export function ligarSkill(origem, destino) {
  if (fs.existsSync(destino)) return;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.symlinkSync(origem, destino, IS_WIN ? 'junction' : 'dir');
  } catch {
    fs.cpSync(origem, destino, { recursive: true }); // sem permissão de atalho: copia
  }
}

export function criarBot({ squad, nome, template: tid = 'em-branco', funcao = '', modelo = '', avatar = null }) {
  const t = template(tid) || template('em-branco');
  const bot = novoBotBase({ squad, nome, template: t.id });
  bot.avatar = limparAvatar(avatar) || limparAvatar(t.avatar);
  bot.modelo = modelo || t.modelo || '';
  bot.esforco = t.esforco || '';
  bot.conectores = [...(t.conectores || [])];
  bot.navegador = t.navegador ?? 'principal';
  bot.autonomia = t.autonomia || 'total';
  bot.pastas = (t.pastas || []).map((p) => resolver(p, t.id));
  bot.env = Object.fromEntries(Object.entries(t.env || {}).map(([k, v]) => [k, resolver(v, t.id)]));
  bot.prefs = Object.fromEntries((t.preferencias || []).map((p) => [p.chave, p.padrao ?? '']));

  const dir = dirBot(bot);
  fs.mkdirSync(path.join(dir, 'trabalho'), { recursive: true });
  const base = dirTemplate(t.id);
  const troca = (s) => s.replace(/\{\{nome\}\}/g, bot.nome);
  gravarTexto(path.join(dir, 'funcao.md'), troca(funcao.trim() || lerTexto(path.join(base, 'funcao.md'))).trim() + '\n');
  gravarTexto(path.join(dir, 'memoria.md'), troca(lerTexto(path.join(base, 'memoria.md'))).trim() + '\n');
  gravarTexto(path.join(dir, 'preferencias.md'), '');
  gravarTexto(path.join(dir, 'CLAUDE.md'), troca(lerTexto(path.join(base, 'CLAUDE.md'), CLAUDE_MD_PADRAO)));
  gravarJSON(path.join(dir, '.claude', 'settings.json'), lerJSON(path.join(base, 'settings.json'), {}));
  for (const s of t.skills) ligarSkill(path.join(base, 'skills', s), path.join(dir, '.claude', 'skills', s));
  bot.skills = [...t.skills];

  salvarBot(bot);
  bots.set(bot.id, { ...bot, status: 'ocioso', fila: 0 });
  return bots.get(bot.id);
}

const CLAUDE_MD_PADRAO = `# Casa do bot {{nome}} (Claude Flow)

Esta pasta é do bot. O Claude Flow cuida de \`funcao.md\`, \`memoria.md\`, \`preferencias.md\` e \`resumos/\`:
não edite esses arquivos à mão, use as ferramentas \`mcp__flow__*\` (elas respeitam o limite de tamanho).
Arquivos de trabalho vão em \`trabalho/\`.
`;

export function skillsDoBot(bot) {
  const dir = path.join(dirBot(bot), '.claude', 'skills');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => !s.startsWith('.')) : [];
}

// Skills que dá para adicionar a qualquer bot: as de todos os templates.
export function catalogoSkills() {
  const out = [];
  for (const t of listarTemplates()) for (const s of t.skills) out.push({ nome: s, template: t.id, caminho: path.join(dirTemplate(t.id), 'skills', s) });
  return out;
}
