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
import * as tarefas from './tarefas.js';
import * as recursos from './recursos.js';
import * as rotinas from './rotinas.js';

// Repasses seguidos entre bots sem o usuário: passou do limite, pausa e avisa.
function proximaCadeia(bot, alvo) {
  const cadeia = (runner.turnoAtivo(bot.id)?.cadeia || 0) + 1;
  if (cadeia > config.squad.maxCadeia) {
    notificar({ titulo: 'Conversa entre bots pausada', texto: `${bot.nome} → ${alvo.nome}: ${config.squad.maxCadeia} repasses seguidos sem você. Abra o squad para continuar.`, bot: bot.id, forcar: true });
    throw new Error(`Limite de ${config.squad.maxCadeia} repasses seguidos entre bots sem o usuário. Pare aqui e diga ao usuário o que falta decidir.`);
  }
  return cadeia;
}

function tarefaDoSquad(bot, id) {
  const t = db.pegarTarefa(Number(id));
  if (!t || t.squad !== bot.squad) throw new Error(`Tarefa #${id} não existe no seu squad.`);
  return t;
}

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
  // espera por condição (ex.: tarefas_aguardar): confere a cada consulta
  if (!e.pronto && e.checar) {
    const r = e.checar();
    if (r) { e.aoTerminar?.(); concluir(id, r); }
  }
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
  if (ap.tipo === 'navegador') {
    concluir(ap.espera, permitir
      ? 'O usuário terminou no navegador (entrou na conta / resolveu a verificação). Recarregue a página ou tire uma foto da tela e continue de onde parou.'
      : 'O usuário não vai fazer isso agora. Não tente entrar sozinho: siga sem essa parte e diga no fim o que ficou faltando.');
    emitir('aprovacao', { id, decidida: true, permitir });
    return true;
  }
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

// Galeria: o mesmo arquivo ganha sempre o mesmo token (não cria um novo a cada vez que a galeria abre).
export function tokenDoCaminho(caminho, extra = {}) {
  const alvo = path.resolve(caminho).toLowerCase();
  for (const [t, e] of Object.entries(entregas)) if (path.resolve(e.caminho).toLowerCase() === alvo) return { token: t, ...e };
  return registrarArquivo(caminho, { galeria: true, ...extra });
}

export const todasEntregas = () => Object.entries(entregas).map(([token, e]) => ({ token, ...e }));

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
    const cadeia = proximaCadeia(bot, alvo);
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

  // ---------- tarefas (kanban do squad) ----------
  tarefas_listar(bot, { escopo = 'minhas', status = '' }) {
    let lista = escopo === 'squad' ? db.tarefasDoSquad(bot.squad) : db.tarefasDoBot(bot.id, { abertas: !status });
    if (status) lista = lista.filter((t) => t.status === status);
    else if (escopo === 'squad') lista = lista.filter((t) => t.status !== 'feito');
    return lista.length ? lista.map(tarefas.comoTexto).join('\n') : 'Nenhuma tarefa.';
  },

  tarefa_ver(bot, { id }) {
    const t = tarefaDoSquad(bot, id);
    const ev = db.eventosDaTarefa(t.id).map((e) => `- ${new Date(e.criado).toLocaleString('pt-BR')} ${tarefas.nomeAutor(e.autor)} [${e.tipo}] ${e.texto || ''}`);
    return `${tarefas.comoTexto(t)}\n\n${t.descricao || '(sem descrição)'}${t.entregaveis ? `\n\nPronto quando: ${t.entregaveis}` : ''}\nPasta: ${tarefas.pastaDaTarefa(t) || '(sem responsável)'}\n\nHistórico:\n${ev.join('\n')}`;
  },

  tarefa_criar(bot, { titulo, descricao = '', entregaveis = '', para = '', comecar = true }) {
    const alvo = para ? acharNoSquad(bot.squad, para) : bot;
    if (!alvo) throw new Error(`Não há bot "${para}" no seu squad. ${ferramentas.squad_bots(bot)}`);
    const pai = runner.turnoAtivo(bot.id)?.item?.tarefa || null;
    const repasse = alvo.id !== bot.id;
    const cadeia = repasse && comecar ? proximaCadeia(bot, alvo) : 0;
    let t = tarefas.criar({ squad: bot.squad, bot: alvo.id, titulo, descricao, entregaveis, pai, status: repasse ? 'afazer' : 'fazendo' }, { autor: bot.id });
    if (repasse && comecar) t = tarefas.enviar(t, { autor: bot.id, cadeia });
    return repasse
      ? `Tarefa #${t.id} criada para @${alvo.nome}${comecar ? ' e enviada (ele começa assim que estiver livre)' : ' (ainda não enviada)'}. Quando ele marcar revisão/feito, você recebe o resultado aqui${comecar ? '' : ''}. Para esperar várias ao mesmo tempo: tarefas_aguardar.`
      : `Tarefa #${t.id} registrada para você, em "Fazendo". Atualize com tarefa_atualizar quando terminar.`;
  },

  tarefa_atualizar(bot, { id, status = '', nota = '' }) {
    const t = tarefaDoSquad(bot, id);
    const cadeia = runner.turnoAtivo(bot.id)?.cadeia || 0;
    if (status) tarefas.mudarStatus(t, status, { autor: bot.id, nota, cadeia });
    else tarefas.anotar(t, nota, { autor: bot.id });
    return `Tarefa #${t.id} atualizada${status ? ` (${tarefas.ROTULO[status]})` : ''}.`;
  },

  // Espera várias tarefas repassadas (trabalho em paralelo) chegarem em revisão/feito.
  tarefas_aguardar(bot, { ids = [] }) {
    const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number))].filter(Boolean);
    if (!lista.length) throw new Error('Informe os ids das tarefas.');
    for (const id of lista) { tarefaDoSquad(bot, id); tarefas.aguardadas.add(id); }
    const soltar = () => lista.forEach((id) => tarefas.aguardadas.delete(id));
    const esp = novaEspera({
      aoExpirar: soltar, aoTerminar: soltar,
      textoExpirou: `Nem todas terminaram em ${config.squad.esperaMaxMin} min. Veja com tarefas_listar e siga.`,
      checar: () => {
        const ts = lista.map((id) => db.pegarTarefa(id)).filter(Boolean);
        if (!ts.every((t) => ['revisao', 'feito'].includes(t.status))) return null;
        return ts.map((t) => {
          const notas = db.eventosDaTarefa(t.id).filter((e) => e.tipo === 'nota').map((e) => `  ${tarefas.nomeAutor(e.autor)}: ${e.texto}`);
          return `${tarefas.comoTexto(t)}\n${notas.join('\n') || '  (sem nota)'}`;
        }).join('\n\n');
      },
    });
    return { espera: esp.id };
  },

  // ---------- links e modelos do bot ----------
  link_salvar(bot, { nome, url, nota = '' }) {
    recursos.salvarLink(bot, { nome, url, nota });
    bot.snapshotSujo = true;
    emitir('bot-arquivos', { bot: bot.id });
    return `Link salvo: ${nome} (${url}). Fica fixo para você em todas as sessões.`;
  },
  modelo_salvar(bot, { nome, conteudo }) {
    const m = recursos.gravarModelo(bot, nome, conteudo);
    bot.snapshotSujo = true;
    emitir('bot-arquivos', { bot: bot.id });
    return `Modelo "${m.nome}" salvo em ${m.arquivo}.`;
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

  // Etapa concluída num trabalho longo ("Baixei os 6 brutos", "Transcrição pronta"): vira uma linha no chat (o
  // indicador "trabalhando" continua) e uma nota no cartão do kanban, se o trabalho tiver cartão.
  progresso(bot, { texto }) {
    const t = String(texto || '').trim().slice(0, 300);
    if (!t) throw new Error('Escreva o que ficou pronto.');
    const item = runner.turnoAtivo(bot.id)?.item;
    emitir('msg', db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'progresso', texto: t, meta: { tarefa: item?.tarefa || null } }));
    if (item?.tarefa) {
      const tf = db.pegarTarefa(item.tarefa);
      if (tf) { db.addEvento(tf.id, { autor: bot.id, tipo: 'nota', texto: t }); emitir('tarefa', { squad: tf.squad, id: tf.id }); }
    }
    return 'Aviso mostrado ao usuário. Continue o trabalho.';
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

  // Tela de login, verificação ("não sou um robô"), código por SMS: o usuário assume a janela do navegador do bot e
  // avisa quando terminou. O turno fica esperando (até 30 min). Rotina não pede: ninguém está olhando.
  navegador_assumir(bot, { motivo = '', url = '' }) {
    const item = runner.turnoAtivo(bot.id)?.item;
    if (item?.rotina) throw new Error('Isto é uma rotina e ninguém está olhando agora: não peça. Diga no resultado que precisa do login e siga sem essa parte.');
    const perfil = nav.perfilDoBot(bot) || 'principal';
    const esp = novaEspera({ max: 30, textoExpirou: 'O usuário não respondeu em 30 min. Siga sem essa parte e diga no fim o que ficou faltando.' });
    const id = esp.id;
    const resumo = String(motivo || 'Preciso que você entre na conta no navegador.').slice(0, 400);
    aprovacoes.set(id, { id, espera: id, tipo: 'navegador', bot: bot.id, botNome: bot.nome, perfil, url: String(url || '').slice(0, 500), resumo, criado: Date.now() });
    esp.aoExpirar = () => { aprovacoes.delete(id); emitir('aprovacao', { id, decidida: true, permitir: false }); };
    emitir('aprovacao', aprovacoes.get(id));
    notificar({ titulo: `${bot.nome} precisa de você no navegador`, texto: resumo.slice(0, 160), bot: bot.id, forcar: true, tag: `aprovacao-${id}` });
    return { espera: id };
  },

  // ---------- rotinas (instrução que roda sozinha num horário) ----------
  rotinas_listar(bot) {
    const l = rotinas.listar(bot.id);
    return l.length ? l.map((r) => `- [${r.id}] ${r.nome} — ${r.descricao}${r.ativa ? '' : ' (pausada)'}\n  ${r.instrucao.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n') : 'Você não tem rotinas.';
  },
  rotina_criar(bot, { nome, instrucao, tipo = 'diario', hora = '09:00', dias = [], horas = 24 }) {
    const r = rotinas.criar({ bot: bot.id, nome, instrucao, quando: { tipo, hora, dias, horas } });
    return `Rotina "${r.nome}" criada: ${r.descricao}. O usuário vê e muda na barra do bot (Rotinas).`;
  },
  rotina_atualizar(bot, { id, nome, instrucao, tipo, hora, dias, horas, ativa }) {
    const r = rotinas.pegar(id);
    if (!r || r.bot !== bot.id) throw new Error(`Rotina ${id} não é sua. ${ferramentas.rotinas_listar(bot)}`);
    const muda = { ...(tipo ? { tipo } : {}), ...(hora ? { hora } : {}), ...(dias ? { dias } : {}), ...(horas ? { horas } : {}) };
    const n = rotinas.editar(id, { nome, instrucao, quando: Object.keys(muda).length ? { ...r.quando, ...muda } : undefined, ativa });
    return `Rotina "${n.nome}" atualizada: ${n.descricao}${n.ativa ? '' : ' (pausada)'}.`;
  },

  async atlas_ligar() {
    const r = await atlas.ligar();
    return `Atlas ${r.jaEstava ? 'já estava no ar' : 'ligado'} em ${r.url}. Ele fica aberto depois que o seu turno terminar.`;
  },

  // tipo "exclusao": vem do gancho guarda-exclusao.js (qualquer bot, qualquer autonomia) antes de apagar algo.
  aprovar(bot, { tool_name, input, tipo, resumo: resumoDado }) {
    const exclusao = tipo === 'exclusao';
    const esp = novaEspera({ max: 30, textoExpirou: JSON.stringify({ behavior: 'deny', message: exclusao ? 'Sem confirmação do usuário em 30 min: nada foi excluído.' : 'Sem resposta do usuário em 30 min.' }) });
    const id = esp.id;
    const resumo = resumoDado ? String(resumoDado).slice(0, 600) : JSON.stringify(input || {}).slice(0, 300);
    aprovacoes.set(id, { id, espera: id, tipo: exclusao ? 'exclusao' : 'permissao', bot: bot.id, botNome: bot.nome, ferramenta: tool_name, entrada: input, resumo, criado: Date.now() });
    esp.aoExpirar = () => { aprovacoes.delete(id); emitir('aprovacao', { id, decidida: true, permitir: false }); };
    emitir('aprovacao', aprovacoes.get(id));
    notificar(exclusao
      ? { titulo: `${bot.nome} quer excluir algo`, texto: `Confirme no app: ${resumo.slice(0, 160)}`, bot: bot.id, forcar: true, tag: `aprovacao-${id}` }
      : { titulo: `${bot.nome} pede permissão`, texto: `${tool_name}: ${resumo}`, bot: bot.id, forcar: true, tag: `aprovacao-${id}` });
    return { espera: id };
  },
};

export async function chamar(bot, nome, args = {}) {
  const f = ferramentas[nome];
  if (!f) throw new Error(`ferramenta desconhecida: ${nome}`);
  return await f(bot, args || {});
}
