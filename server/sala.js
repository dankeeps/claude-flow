// Sala do squad: o usuário escreve uma vez e a mensagem vai para quem deve responder.
//   "@Editor @Copy ..." → direto para os citados; "@todos ..." → todos os bots do squad;
//   squad com um bot só → ele; senão um roteador rápido (modelo pequeno, sem ferramentas) escolhe pelo assunto e a
//   escolha aparece na sala ("Vai para @Editor: é edição"), para o usuário corrigir se quiser.
// Cada bot recebe a mensagem no próprio chat (com a memória e as ferramentas dele) e a resposta final volta para a sala.
import spawn from 'cross-spawn';
import { HOME, config } from './config.js';
import { squads, botsDoSquad, acharNoSquad } from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import * as runner from './runner.js';
import { emitir } from './eventos.js';

export const idSala = (squadId) => `sala:${squadId}`;

function msgSala(squadId, { papel, texto, de = null, meta = null }) {
  const m = db.addMensagem({ bot: idSala(squadId), squad: squadId, papel, de, texto, meta });
  emitir('sala', { squad: squadId, msg: m });
  return m;
}

function funcaoCurta(b) {
  return (mem.ler(b, 'funcao') || '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).filter(Boolean).slice(0, 4).join(' ').slice(0, 300) || 'sem função definida';
}

// Pergunta a um modelo pequeno quem deve responder. Sem ferramentas nem conectores; ~3-8 s.
function rotear(squadId, texto) {
  const bs = botsDoSquad(squadId);
  const prompt = `Você distribui mensagens numa equipe de bots. Escolha quem deve responder a esta mensagem do usuário.
Regras: escolha só quem a mensagem toca de verdade. Assunto de um bot só (ou de nenhum) → o bot mais indicado, um só.
Pedido de opinião sobre um trabalho → os bots cujas áreas dão visões diferentes. Pedido para o grupo todo → todos.

Bots:
${bs.map((b) => `- id=${b.id} | @${b.nome} | ${funcaoCurta(b)}`).join('\n')}

Mensagem do usuário:
"""${String(texto).slice(0, 4000)}"""

Responda só com JSON, sem mais nada: {"bots": ["<id>", ...], "motivo": "<até 12 palavras, em português>"}`;
  return new Promise((ok) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(runner.binClaude(), ['-p', '--model', 'haiku', '--output-format', 'json', '--strict-mcp-config', '--disallowedTools', 'Bash,Edit,Write,Read,WebFetch,WebSearch,Task,Agent'], {
      cwd: HOME, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    const fim = setTimeout(() => { try { child.kill(); } catch {} }, 60e3);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(fim); ok(null); });
    child.on('close', () => {
      clearTimeout(fim);
      try {
        const r = JSON.parse(out).result || '';
        const j = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1));
        const ids = (j.bots || []).map((x) => acharNoSquad(squadId, x)?.id).filter(Boolean);
        ok(ids.length ? { ids: [...new Set(ids)], motivo: String(j.motivo || '').slice(0, 120) } : null);
      } catch { ok(null); }
    });
    child.stdin.end(prompt);
  });
}

// "@a @b texto" → { ids, resto }; "@todos" → todos.
function mencoes(squadId, texto) {
  const m = String(texto).match(/^\s*((?:@[\p{L}\p{N}_.-]+[\s,]*)+)/u);
  if (!m) return null;
  const nomes = m[1].match(/@[\p{L}\p{N}_.-]+/gu).map((x) => x.slice(1));
  if (nomes.some((n) => ['todos', 'todas', 'everyone', 'all'].includes(n.toLowerCase()))) return { ids: botsDoSquad(squadId).map((b) => b.id) };
  const ids = nomes.map((n) => acharNoSquad(squadId, n)?.id).filter(Boolean);
  return ids.length ? { ids: [...new Set(ids)] } : null;
}

export async function enviar(squadId, { texto, anexos = [] }) {
  const sq = squads.get(squadId);
  if (!sq) throw new Error('squad não encontrado');
  const bs = botsDoSquad(squadId);
  if (!bs.length) throw new Error('Este squad ainda não tem bots.');
  texto = String(texto || '').trim();
  if (!texto && !anexos.length) throw new Error('mensagem vazia');
  msgSala(squadId, { papel: 'usuario', texto, meta: { anexos } });

  let escolha = mencoes(squadId, texto);
  let roteado = false;
  if (!escolha && bs.length === 1) escolha = { ids: [bs[0].id] };
  // motor do ChatGPT: sem @, quem recebe é o Gestor de projetos (ou o líder do squad), que distribui
  if (!escolha && (config.motor || 'claude') === 'codex') {
    const g = bs.find((b) => b.template === 'gestor') || bs.find((b) => b.id === sq.lider);
    if (g) { escolha = { ids: [g.id], motivo: 'ninguém citado: o gestor recebe e distribui' }; roteado = true; }
  }
  if (!escolha) {
    emitir('sala', { squad: squadId, roteando: true });
    escolha = await rotear(squadId, texto);
    roteado = true;
    if (!escolha) {
      const lider = bs.find((b) => b.id === sq.lider) || bs[0];
      escolha = { ids: [lider.id], motivo: 'não deu para escolher pelo assunto; foi para o primeiro do squad' };
    }
  }
  const alvos = escolha.ids.map((id) => bs.find((b) => b.id === id)).filter(Boolean);
  if (roteado) {
    msgSala(squadId, { papel: 'roteamento', texto: `Vai para ${alvos.map((b) => '@' + b.nome).join(' e ')}${escolha.motivo ? `: ${escolha.motivo}` : ''}`, meta: { bots: alvos.map((b) => b.id) } });
  }
  for (const b of alvos) {
    runner.enviar(b.id, {
      texto, anexos, origem: { tipo: 'usuario' }, cadeia: 0, sala: squadId,
      salaOutros: alvos.filter((x) => x.id !== b.id).map((x) => x.nome),
      aguardar: {
        resolve: (r) => {
          if (r.erro) msgSala(squadId, { papel: 'sistema', texto: `@${b.nome} não respondeu: ${r.erro}`, de: b.id });
          else if (r.texto?.trim()) msgSala(squadId, { papel: 'bot', texto: r.texto, de: b.id });
        },
      },
    });
  }
  return { bots: alvos.map((b) => b.id) };
}
