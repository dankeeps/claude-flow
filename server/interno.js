// Ferramentas que os bots chamam pelo servidor MCP "flow" (server/mcp/flow-mcp.js). Cada chamada chega com o token
// do bot, e tudo é resolvido dentro do squad dele: um squad não enxerga o outro.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME, config, lerJSON, gravarJSON } from './config.js';
import { bots, squads, botsDoSquad, acharNoSquad, salvarBot } from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import * as runner from './runner.js';
import * as nav from './navegador.js';
import { emitir, notificar } from './eventos.js';
import { template } from './templates.js';
import * as atlas from './atlas.js';

// ---------- esperas (bot aguardando outro bot, ou aprovação do usuário) ----------
// A ferramenta MCP recebe {espera: id} na hora e fica consultando /api/interno/espera/<id>: assim nenhuma conexão
// HTTP fica pendurada por minutos.
const esperas = new Map();
const esperando = new Map(); // bot -> bot que ele está aguardando (para achar ciclo A→B→A)

function novaEspera(extra = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  esperas.set(id, { id, pronto: false, texto: null, criado: Date.now(), ...extra });
  return esperas.get(id);
}

function concluir(id, texto) {
  const e = esperas.get(id);
  if (!e || e.pronto) return;
  e.pronto = true;
  e.texto = texto;
  setTimeout(() => esperas.delete(id), 10 * 60 * 1000);
}

export function consultarEspera(id) {
  const e = esperas.get(id);
  if (!e) return { pronto: true, texto: 'Espera não encontrada (o servidor pode ter reiniciado).' };
  const max = (e.max || config.squad.esperaMaxMin) * 60 * 1000;
  if (!e.pronto && Date.now() - e.criado > max) {
    e.aoExpirar?.();
    concluir(id, e.textoExpirou || 'Tempo de espera esgotado.');
  }
  return { pronto: e.pronto, texto: e.texto };
}

// ---------- aprovações (bot no modo "perguntar") ----------
export const aprovacoes = new Map();

export function decidirAprovacao(id, permitir) {
  const ap = aprovacoes.get(id);
  if (!ap) throw new Error('aprovação não encontrada');
  aprovacoes.delete(id);
  const r = permitir
    ? { behavior: 'allow', updatedInput: ap.entrada }
    : { behavior: 'deny', message: 'O usuário negou esta ação no Claude Flow.' };
  concluir(ap.espera, JSON.stringify(r));
  emitir('aprovacao', { id, decidida: true, permitir });
  return true;
}

// ---------- arquivos entregues (link no app, inclusive no celular) ----------
const ARQ_ENTREGAS = path.join(HOME, 'entregas.json');
const entregas = lerJSON(ARQ_ENTREGAS, {});

export function registrarArquivo(caminho, extra = {}) {
  const token = crypto.randomBytes(12).toString('hex');
  const st = fs.statSync(caminho);
  entregas[token] = { caminho, nome: path.basename(caminho), tamanho: st.size, criado: Date.now(), ...extra };
  gravarJSON(ARQ_ENTREGAS, entregas);
  return { token, ...entregas[token] };
}

export const arquivoPorToken = (t) => entregas[t] || null;

// ---------- as ferramentas ----------
function formatarBot(b) {
  const e = runner.estadoBot(b);
  return `- @${b.nome} (id: ${b.id}) [${e.status}${e.fila ? `, ${e.fila} na fila` : ''}] — ${(mem.ler(b, 'funcao').split('\n').find((l) => l.trim()) || 'sem função').replace(/^#+\s*/, '').slice(0, 160)}`;
}

const ferramentas = {
  squad_bots(bot) {
    const sq = squads.get(bot.squad);
    const outros = botsDoSquad(bot.squad).filter((b) => b.id !== bot.id);
    return `Squad ${sq?.nome}: ${outros.length ? '\n' + outros.map(formatarBot).join('\n') : 'nenhum outro bot por enquanto.'}`;
  },

  bot_enviar(bot, { para, mensagem, aguardar = false }) {
    const alvo = acharNoSquad(bot.squad, para);
    if (!alvo) throw new Error(`Não há bot "${para}" no seu squad. ${ferramentas.squad_bots(bot)}`);
    if (alvo.id === bot.id) throw new Error('Esse bot é você.');
    const cadeia = (runner.turnoAtivo(bot.id)?.cadeia || 0) + 1;
    if (cadeia > config.squad.maxCadeia) {
      notificar({ titulo: `⏸ Conversa entre bots pausada`, texto: `${bot.nome} → ${alvo.nome}: ${config.squad.maxCadeia} mensagens seguidas sem você. Abra o squad para continuar.`, bot: bot.id, forcar: true });
      throw new Error(`Limite de ${config.squad.maxCadeia} mensagens seguidas entre bots sem o usuário. Pare aqui e diga ao usuário o que falta decidir.`);
    }
    const origem = { tipo: 'bot', id: bot.id, nome: bot.nome };
    if (!aguardar) {
      const e = runner.enviar(alvo.id, { texto: mensagem, origem, cadeia });
      return `Entregue para @${alvo.nome} (${e.status}${e.fila > 1 ? `, ${e.fila} na fila` : ''}). Ele não responde automaticamente; se precisar da resposta, use aguardar=true.`;
    }
    for (let x = alvo.id, n = 0; x && n < 50; x = esperando.get(x), n++) {
      if (esperando.get(x) === bot.id || x === bot.id) {
        throw new Error(`@${alvo.nome} está esperando você (direta ou indiretamente): use aguardar=false para não travar os dois.`);
      }
    }
    esperando.set(bot.id, alvo.id);
    const esp = novaEspera({ aoExpirar: () => esperando.delete(bot.id), textoExpirou: `@${alvo.nome} não respondeu em ${config.squad.esperaMaxMin} min. Siga sem a resposta ou tente depois.` });
    runner.enviar(alvo.id, {
      texto: mensagem, origem, cadeia,
      aguardar: { resolve: (r) => { esperando.delete(bot.id); concluir(esp.id, r.erro ? `@${alvo.nome} não conseguiu responder: ${r.erro}` : `Resposta de @${alvo.nome}:\n${r.texto || '(vazia)'}`); } },
    });
    return { espera: esp.id };
  },

  squad_quadro_ler: (bot) => mem.ler(bot, 'quadro') || '(quadro vazio)',
  squad_quadro_escrever(bot, { texto, modo = 'acrescentar' }) {
    const r = mem.escrever(bot, 'quadro', modo === 'acrescentar' ? `- ${bot.nome}: ${texto}` : texto, modo);
    emitir('quadro', { squad: bot.squad });
    return r;
  },

  funcao_ler: (bot) => mem.ler(bot, 'funcao') || '(sem função definida)',
  funcao_atualizar(bot, { texto, modo = 'substituir' }) {
    const r = mem.escrever(bot, 'funcao', texto, modo);
    emitir('bot-arquivos', { bot: bot.id });
    return r;
  },

  memoria_ler: (bot) => {
    const t = mem.ler(bot, 'memoria');
    return `${t || '(vazia)'}\n\n[${t.length}/${config.memoria.limiteMemoria} caracteres]`;
  },
  memoria_adicionar: (bot, { fato }) => { const r = mem.adicionarFato(bot, 'memoria', fato); emitir('bot-arquivos', { bot: bot.id }); return r; },
  memoria_substituir: (bot, { antigo, novo }) => { const r = mem.substituirTrecho(bot, 'memoria', antigo, novo); emitir('bot-arquivos', { bot: bot.id }); return r; },
  memoria_remover: (bot, { trecho }) => { const r = mem.removerTrecho(bot, 'memoria', trecho); emitir('bot-arquivos', { bot: bot.id }); return r; },

  usuario_ler: (bot) => mem.ler(bot, 'usuario') || '(vazio)',
  usuario_atualizar(bot, { fato, antigo, novo }) {
    if (antigo) return mem.substituirTrecho(bot, 'usuario', antigo, novo);
    return mem.adicionarFato(bot, 'usuario', fato || novo);
  },

  preferencia_definir(bot, { chave, valor }) {
    const t = template(bot.template);
    const p = (t?.preferencias || []).find((x) => x.chave === chave || x.rotulo.toLowerCase() === String(chave).toLowerCase());
    if (p) {
      bot.prefs = { ...bot.prefs, [p.chave]: valor };
      salvarBot(bot);
      emitir('bot-arquivos', { bot: bot.id });
      return `Preferência "${p.rotulo}" = ${valor}.`;
    }
    const r = mem.escrever(bot, 'preferencias', `- ${chave}: ${valor}`, 'acrescentar');
    emitir('bot-arquivos', { bot: bot.id });
    return r;
  },

  historico_buscar(bot, { consulta, escopo = 'bot', limite = 10 }) {
    const rows = db.buscar(consulta, escopo === 'squad' ? { squad: bot.squad, limite } : { bot: bot.id, limite });
    if (!rows.length) return 'Nada encontrado no histórico.';
    return rows.map((r) => `[${new Date(r.criado).toLocaleString('pt-BR')}] ${r.papel}${r.bot !== bot.id ? ` (@${bots.get(r.bot)?.nome || r.bot})` : ''}: ${r.trecho}`).join('\n');
  },

  sessao_resumir(bot, { resumo }) {
    const nome = mem.salvarResumo(bot, resumo);
    runner.marcarResumo(bot.id);
    return `Resumo salvo (${nome}).`;
  },

  async notificar(bot, { titulo, texto }) {
    const r = await notificar({ titulo: `${bot.nome}: ${titulo}`, texto, bot: bot.id, forcar: true });
    return `Notificação enviada para ${r.enviados} aparelho(s).`;
  },

  arquivo_entregar(bot, { caminho, legenda = '' }) {
    if (!caminho || !fs.existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
    if (fs.statSync(caminho).isDirectory()) throw new Error('Isso é uma pasta: entregue um arquivo.');
    const a = registrarArquivo(caminho, { bot: bot.id });
    const m = db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'arquivo', texto: `${legenda} ${a.nome}`.trim(), meta: { token: a.token, nome: a.nome, tamanho: a.tamanho, legenda } });
    emitir('msg', m);
    return `Arquivo entregue no app: ${a.nome} (${(a.tamanho / 1e6).toFixed(1)} MB).`;
  },

  async navegador_ligar(bot, { url = '' }) {
    const perfil = nav.perfilDoBot(bot);
    if (!perfil || !(bot.conectores || []).includes('navegador')) throw new Error('O navegador não está ligado para este bot (Conectores do bot).');
    const r = await nav.ligar(perfil, url);
    emitir('navegador', await nav.status());
    return `Navegador "${perfil}" ${r.jaEstava ? 'já estava aberto' : 'aberto'} (${r.endpoint}). Pode usar as ferramentas mcp__navegador__*.`;
  },

  async atlas_ligar() {
    const r = await atlas.ligar();
    return `Atlas ${r.jaEstava ? 'já estava no ar' : 'ligado'} em ${r.url}. Ele fica aberto depois que o seu turno terminar.`;
  },

  aprovar(bot, { tool_name, input }) {
    const esp = novaEspera({ max: 30, textoExpirou: JSON.stringify({ behavior: 'deny', message: 'Sem resposta do usuário em 30 min.' }) });
    const id = esp.id;
    const resumo = JSON.stringify(input || {}).slice(0, 300);
    aprovacoes.set(id, { id, espera: id, bot: bot.id, botNome: bot.nome, ferramenta: tool_name, entrada: input, resumo, criado: Date.now() });
    esp.aoExpirar = () => aprovacoes.delete(id);
    emitir('aprovacao', aprovacoes.get(id));
    notificar({ titulo: `🔐 ${bot.nome} pede permissão`, texto: `${tool_name}: ${resumo}`, bot: bot.id, forcar: true, tag: `aprovacao-${id}` });
    return { espera: id };
  },
};

export async function chamar(bot, nome, args = {}) {
  const f = ferramentas[nome];
  if (!f) throw new Error(`ferramenta desconhecida: ${nome}`);
  return await f(bot, args || {});
}
