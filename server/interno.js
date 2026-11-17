// Ferramentas que os bots chamam pelo servidor MCP "flow" (server/mcp/flow-mcp.js). Cada chamada chega com o token
// do bot, e tudo é resolvido dentro do squad dele: um squad não enxerga o outro.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME, config, lerJSON, gravarJSON } from './config.js';
import { bots, squads, botsDoSquad, acharNoSquad, salvarBot, conectoresDoBot } from './store.js';
import * as nuvem from './nuvem.js';
import * as kie from './kie.js';
import { dirBot } from './store.js';
import * as db from './db.js';
import * as mem from './memoria.js';
import * as runner from './runner.js';
import * as nav from './navegador.js';
import { emitir, notificar } from './eventos.js';
import { template } from './templates.js';
import * as templates from './templates.js';
import * as demandas from './demandas.js';
import * as atlas from './atlas.js';
import * as tarefas from './tarefas.js';
import * as recursos from './recursos.js';
import * as rotinas from './rotinas.js';
import * as sd from './squaddados.js';
import * as galaxia from './galaxia.js';

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

// ---------- kie.ai ----------
function kieLigado(bot) { if (!conectoresDoBot(bot).includes(kie.ID)) throw new Error('O conector kie.ai não está ligado para este bot (Conectores do squad).'); }
const pastaKie = (bot) => path.join(dirBot(bot), 'trabalho', 'entregas', 'kie');
function kieResposta(r) {
  if (!r.pronto) return `Ainda gerando na kie.ai (estado: ${r.estado}${r.progresso ? `, ${r.progresso}%` : ''}). Chame kie_aguardar com taskId "${r.taskId}".`;
  return `Pronto (${r.modelo}, ${r.segundos ?? '?'} s, ${r.creditos ?? '?'} créditos). Arquivos salvos:\n${r.arquivos.join('\n')}\nMostre ao usuário com mcp__flow__arquivo_entregar ou quadro_entregar.`;
}

const ferramentas = {
  squad_bots(bot) {
    const sq = squads.get(bot.squad);
    const outros = botsDoSquad(bot.squad).filter((b) => b.id !== bot.id);
    return `Squad ${sq?.nome}: ${outros.length ? '\n' + outros.map(formatarBot).join('\n') : 'nenhum outro bot por enquanto.'}`;
  },

  bot_enviar(bot, { para, mensagem, aguardar = false, na_frente = false }) {
    const alvo = acharNoSquad(bot.squad, para);
    if (!alvo) throw new Error(`Não há bot "${para}" no seu squad. ${ferramentas.squad_bots(bot)}`);
    if (alvo.id === bot.id) throw new Error('Esse bot é você.');
    const cadeia = proximaCadeia(bot, alvo);
    const origem = { tipo: 'bot', id: bot.id, nome: bot.nome };
    if (!aguardar) {
      const e = runner.enviar(alvo.id, { texto: mensagem, origem, cadeia, frente: !!na_frente });
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

  tarefa_criar(bot, { titulo, descricao = '', entregaveis = '', para = '', comecar = true, na_frente = false }) {
    const alvo = para ? acharNoSquad(bot.squad, para) : bot;
    if (!alvo) throw new Error(`Não há bot "${para}" no seu squad. ${ferramentas.squad_bots(bot)}`);
    const pai = runner.turnoAtivo(bot.id)?.item?.tarefa || null;
    const repasse = alvo.id !== bot.id;
    const cadeia = repasse && comecar ? proximaCadeia(bot, alvo) : 0;
    let t = tarefas.criar({ squad: bot.squad, bot: alvo.id, titulo, descricao, entregaveis, pai, status: repasse ? 'afazer' : 'fazendo' }, { autor: bot.id });
    if (repasse && comecar) t = tarefas.enviar(t, { autor: bot.id, cadeia, frente: !!na_frente });
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

  // ---------- o que outro bot está fazendo (para o Head conferir) ----------
  bot_atividade(bot, { bot: quem, limite = 40 }) {
    const alvo = acharNoSquad(bot.squad, quem);
    if (!alvo) throw new Error(`Não há bot "${quem}" no seu squad.`);
    const a = runner.turnoAtivo(alvo.id);
    const e = runner.estadoBot(alvo);
    const linhas = [`@${alvo.nome}: ${e.status}${a ? ` há ${Math.round((Date.now() - a.inicio) / 60000)} min` : ''}, ${e.fila} na fila${e.pausado ? ' (fila pausada)' : ''}`];
    if (a?.item) {
      const t = a.item.tarefa ? db.pegarTarefa(a.item.tarefa) : null;
      linhas.push(`Trabalhando em: ${t ? `tarefa #${t.id} "${t.titulo}"` : 'pedido do chat'}`);
      if (t) {
        const notas = db.eventosDaTarefa(t.id).filter((x) => x.tipo === 'nota').slice(-6).map((x) => `  - ${tarefas.nomeAutor(x.autor)}: ${String(x.texto).replace(/\s+/g, ' ').slice(0, 300)}`);
        if (notas.length) linhas.push('Notas da tarefa:', ...notas);
      }
    }
    const desde = a?.inicio || Date.now() - 3 * 3600e3;
    const msgs = [].concat(db.listarMensagens(alvo.id, { limite: 400 })).filter((m) => m.criado >= desde - 1000 && ['bot', 'progresso', 'ferramenta', 'sistema', 'arquivo', 'quadro'].includes(m.papel)).slice(-Math.min(120, Number(limite) || 40));
    linhas.push(`Atividade (últimas ${msgs.length}):`);
    for (const m of msgs) linhas.push(`  ${new Date(m.criado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ${m.papel === 'ferramenta' ? '⚙' : m.papel}: ${String(m.texto).replace(/\s+/g, ' ').slice(0, m.papel === 'ferramenta' ? 220 : 500)}`);
    return linhas.join('\n');
  },
  bot_regras(bot, { bot: quem }) {
    const alvo = acharNoSquad(bot.squad, quem);
    if (!alvo) throw new Error(`Não há bot "${quem}" no seu squad.`);
    const t = template(alvo.template);
    const prefs = Object.entries(alvo.prefs || {}).map(([k, v]) => `- ${(t?.preferencias || []).find((p) => p.chave === k)?.rotulo || k}: ${v}`).join('\n');
    let instr = '';
    try { instr = fs.readFileSync(path.join(templates.dirTemplate(alvo.template), 'instrucoes.md'), 'utf8'); } catch {}
    return [`# Função de @${alvo.nome}`, mem.ler(alvo, 'funcao') || '(sem função)', '# Preferências', prefs || '(nenhuma)', '# Memória', mem.ler(alvo, 'memoria') || '(vazia)', '# Instruções do modelo dele', instr.slice(0, 9000) || '(nenhuma)'].join('\n\n');
  },

  // ---------- spy (aba Spy da sala do squad) ----------
  spy_listar(bot, { lista = 'monitoradas' }) {
    const d = sd.spy(bot.squad);
    if (lista === 'blacklist') return d.blacklist.length ? d.blacklist.map((b) => `- ${b.pagina || '(sem nome)'} · page_id ${b.page_id || '?'}${b.motivo ? ` · ${b.motivo}` : ''}`).join('\n') : '(blacklist vazia)';
    return d.monitoradas.length ? d.monitoradas.map((m) => `- ${m.pagina} · page_id ${m.page_id} · ${m.tipo || 'tipo ?'} · ${m.nicho || 'sem nicho'} · ${m.ativos ?? '?'} ativos${m.conferido ? ` em ${new Date(m.conferido).toLocaleDateString('pt-BR')}` : ''}${m.ativa === false ? ' · PAUSADA' : ''} · ${m.biblioteca}`).join('\n') : '(nenhuma biblioteca monitorada)';
  },
  spy_monitorar(bot, x) {
    const m = sd.monitorar(bot.squad, x, { por: bot.id });
    emitir('spy', { squad: bot.squad });
    return `${m.pagina || m.page_id} está na aba Spy (monitorada${m.ativos !== undefined ? `, ${m.ativos} ativos` : ''}).`;
  },
  spy_conferencias(bot, { itens = [] }) {
    const r = sd.conferencias(bot.squad, itens);
    emitir('spy', { squad: bot.squad });
    return r.length ? r.map((x) => `- ${x.pagina}: ${x.ativos} ativos${x.variacao === null ? '' : ` (${x.variacao >= 0 ? '+' : ''}${x.variacao})`}`).join('\n') : 'Nenhuma das bibliotecas informadas está monitorada.';
  },
  spy_blacklist(bot, x) {
    const l = sd.blacklistAdicionar(bot.squad, x, { por: bot.id });
    emitir('spy', { squad: bot.squad });
    return `${x.pagina || x.page_id} na blacklist (${l.length} no total): não aparece mais nas buscas.`;
  },

  // ---------- itens relevantes (sala do squad) ----------
  async relevante_criar(bot, { titulo, texto, tipo = '' }) {
    const it = sd.relevanteCriar(bot.squad, { titulo, texto, tipo, bot: bot.id });
    emitir('relevante', { squad: bot.squad, id: it.id });
    galaxia.aoRelevante(bot.squad, bot.id, it.titulo);
    await notificar({ titulo: `Relevante: ${it.titulo}`, texto: `${bot.nome} publicou na sala do squad`, bot: bot.id, forcar: true, tag: `relevante-${it.id}` });
    return `Publicado em Relevantes, na sala do squad: "${it.titulo}".`;
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

  // Quadro: uma mensagem só com vários arquivos lado a lado (personagens, storyboard, cenas). Cada item continua sendo
  // um arquivo separado no disco; o app mostra em grade, numerado, e abre cada um grande ao tocar.
  quadro_entregar(bot, { titulo = '', itens = [] }) {
    if (!Array.isArray(itens) || !itens.length) throw new Error('Passe itens: [{ caminho, titulo, texto }].');
    if (itens.length > 60) throw new Error('No máximo 60 itens por quadro: divida em mais de um.');
    const lista = itens.map((x, i) => {
      const caminho = String(x?.caminho || '');
      if (!caminho || !fs.existsSync(caminho) || fs.statSync(caminho).isDirectory()) throw new Error(`Item ${i + 1}: arquivo não encontrado: ${caminho}`);
      const a = registrarArquivo(caminho, { bot: bot.id });
      return { token: a.token, nome: a.nome, tamanho: a.tamanho, titulo: String(x.titulo || '').slice(0, 120), texto: String(x.texto || '').slice(0, 1500) };
    });
    const t = String(titulo || '').slice(0, 200);
    const m = db.addMensagem({ bot: bot.id, squad: bot.squad, sessao: bot.sessao, papel: 'quadro', texto: [t, ...lista.map((x) => `${x.titulo} ${x.nome}`)].join(' ').trim(), meta: { titulo: t, itens: lista } });
    emitir('msg', m);
    return `Quadro entregue no app: ${lista.length} itens.`;
  },

  async nuvem_enviar(bot, { caminho, pasta = '' }) {
    if (!conectoresDoBot(bot).includes(nuvem.ID)) throw new Error('O conector Cloudflare R2 não está ligado para este bot (Conectores do squad).');
    const r = await nuvem.enviar(caminho, { pasta });
    const c = await nuvem.conferir(r.url);
    const aviso = c.ok ? '' : ` ATENÇÃO: o link não abriu de fora (${c.status || c.erro}). Confira se o acesso público (r2.dev ou domínio) está ligado no bucket.`;
    return `Enviado para o R2 (${(r.tamanho / 1e6).toFixed(1)} MB, ${r.tipo}). Link público: ${r.url}${aviso}`;
  },

  async kie_gerar(bot, { modelo, input = {}, nome = '' }) {
    kieLigado(bot);
    const taskId = await kie.criar(modelo, input);
    return kieResposta(await kie.aguardar(taskId, { pasta: pastaKie(bot), nome }));
  },
  async kie_aguardar(bot, { taskId, nome = '' }) {
    kieLigado(bot);
    return kieResposta(await kie.aguardar(taskId, { pasta: pastaKie(bot), nome }));
  },
  async kie_creditos(bot) {
    kieLigado(bot);
    return `Créditos na kie.ai: ${await kie.creditos()}`;
  },

  demanda_etapa(bot, args) { return demandas.botAtualizar(bot, args || {}, registrarArquivo); },
  demanda_ver(bot) { return demandas.botVer(bot); },

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

// Para o motor do ChatGPT (codex.js): abre a caixa "Confirmar exclusão" no app e espera a resposta do usuário.
// true = ele confirmou. Sem resposta em 30 min, ou qualquer erro: false (nada é apagado).
export async function pedirExclusao(bot, { ferramenta, entrada, resumo }) {
  try {
    const { espera } = ferramentas.aprovar(bot, { tool_name: ferramenta, input: entrada, tipo: 'exclusao', resumo });
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const e = consultarEspera(espera);
      if (!e.pronto) continue;
      try { return JSON.parse(e.texto).behavior === 'allow'; } catch { return false; }
    }
  } catch { return false; }
}

export async function chamar(bot, nome, args = {}) {
  const f = ferramentas[nome];
  if (!f) throw new Error(`ferramenta desconhecida: ${nome}`);
  return await f(bot, args || {});
}
