// Memória dos bots (ideia do Hermes Agent: memória curta, com limite, curada pelo próprio agente, mais busca no
// histórico inteiro). Cada bot tem:
//   funcao.md        a "inteligência matriz": o que ele é e faz. Muda quando o usuário diz "sua função é…".
//   memoria.md       fatos duráveis (preferências, decisões, caminhos, armadilhas). Limite em caracteres.
//   preferencias.md  preferências livres do usuário para este bot (as do template ficam no bot.json)
//   resumos/         um resumo por sessão encerrada (compactação)
//   arquivo/         transcrições brutas antigas do CLI, em .gz, apagadas depois de N dias
// E há dois arquivos compartilhados: ~/ClaudeFlow/usuario.md (todos os bots) e squads/<id>/quadro.md (o squad).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { HOME, config, lerTexto, gravarTexto } from './config.js';
import { dirBot, dirSquad } from './store.js';

export const ARQ_USUARIO = path.join(HOME, 'usuario.md');

export function arquivo(bot, nome) {
  if (nome === 'usuario') return ARQ_USUARIO;
  if (nome === 'quadro') return path.join(dirSquad(bot.squad), 'quadro.md');
  if (!['funcao', 'memoria', 'preferencias'].includes(nome)) throw new Error(`arquivo desconhecido: ${nome}`);
  return path.join(dirBot(bot), `${nome}.md`);
}

function limite(nome) {
  const m = config.memoria;
  return { memoria: m.limiteMemoria, usuario: m.limiteUsuario, quadro: m.limiteQuadro, funcao: m.limiteFuncao }[nome] || 20000;
}

export const ler = (bot, nome) => lerTexto(arquivo(bot, nome)).trim();

function gravarComLimite(bot, nome, texto) {
  const lim = limite(nome);
  if (texto.length > lim) {
    throw new Error(`${nome}.md ficaria com ${texto.length} caracteres (limite ${lim}). Consolide antes: junte fatos parecidos com `
      + `memoria_substituir, tire o que não vale mais com memoria_remover e tente de novo.`);
  }
  gravarTexto(arquivo(bot, nome), texto.trim() + '\n');
  return `${nome}.md salvo (${texto.trim().length}/${lim} caracteres). Vale a partir da próxima sessão; nesta você já sabe.`;
}

export function escrever(bot, nome, texto, modo = 'substituir') {
  const atual = ler(bot, nome);
  const novo = modo === 'acrescentar' && atual ? `${atual}\n\n${String(texto).trim()}` : String(texto);
  return gravarComLimite(bot, nome, novo);
}

export function adicionarFato(bot, nome, fato) {
  const f = String(fato).trim().replace(/^[-*]\s*/, '');
  if (!f) throw new Error('fato vazio');
  const atual = ler(bot, nome);
  if (atual.includes(f)) return 'Esse fato já está na memória.';
  const data = new Date().toISOString().slice(0, 10);
  return gravarComLimite(bot, nome, `${atual}\n- ${f} (${data})`.trim());
}

export function substituirTrecho(bot, nome, antigo, novo) {
  const atual = ler(bot, nome);
  const n = atual.split(antigo).length - 1;
  if (!antigo || n === 0) throw new Error('Trecho antigo não encontrado. Leia o arquivo e copie o trecho exato.');
  if (n > 1) throw new Error(`O trecho aparece ${n} vezes. Use um trecho maior, que seja único.`);
  return gravarComLimite(bot, nome, atual.replace(antigo, String(novo ?? '')));
}

export function removerTrecho(bot, nome, trecho) {
  return substituirTrecho(bot, nome, trecho, '');
}

// ---------- resumos de sessão ----------
const dirResumos = (bot) => path.join(dirBot(bot), 'resumos');

export function salvarResumo(bot, texto) {
  const agora = new Date();
  const nome = `${agora.toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${(bot.sessao || 'sessao').slice(0, 8)}.md`;
  gravarTexto(path.join(dirResumos(bot), nome), `# Sessão encerrada em ${agora.toLocaleString('pt-BR')}\n\n${String(texto).trim()}\n`);
  return nome;
}

export function ultimosResumos(bot, n = config.memoria.resumosNoContexto) {
  const dir = dirResumos(bot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().slice(-n)
    .map((f) => lerTexto(path.join(dir, f)).trim());
}

// ---------- compactação ----------
export function precisaCompactar(bot) {
  if (!bot.sessao || !bot.sessaoTurnos) return null;
  const m = config.memoria;
  if (bot.ctxTokens > m.contextoMax * m.compactarEm) return `a sessão chegou a ${Math.round(bot.ctxTokens / 1000)} mil tokens`;
  if (bot.sessaoInicio && Date.now() - bot.sessaoInicio > m.compactarDias * 86400e3) return `a sessão tem mais de ${m.compactarDias} dias`;
  return null;
}

export const PROMPT_COMPACTAR = `[Claude Flow · compactação da memória]
Esta sessão vai ser encerrada agora e uma nova começa já com a sua função, a sua memória e o resumo que você escrever.
Antes disso, sem fazer mais nada do trabalho:
1. Guarde em memória (mcp__flow__memoria_adicionar / memoria_substituir) o que vale para as próximas sessões: preferências e correções do usuário, decisões, caminhos de arquivos e pastas, armadilhas, o jeito certo de fazer. Não repita o que já está lá; consolide se estiver perto do limite.
2. Se aprendeu algo sobre o usuário que vale para todos os bots, use mcp__flow__usuario_atualizar.
3. Chame mcp__flow__sessao_resumir com um resumo de até 1500 caracteres: o que foi feito, o que ficou pendente, onde estão os arquivos e o próximo passo.
Responda só "Memória atualizada." no fim.`;

// Depois da compactação: a transcrição bruta do CLI vai para arquivo/<sessao>.jsonl.gz (ocupa ~10x menos) e o bot
// começa uma sessão nova no próximo turno.
export function arquivarTranscricao(bot, sessaoId) {
  const projetos = path.join(os.homedir(), '.claude', 'projects');
  if (!sessaoId || !fs.existsSync(projetos)) return null;
  for (const d of fs.readdirSync(projetos)) {
    const arq = path.join(projetos, d, `${sessaoId}.jsonl`);
    if (!fs.existsSync(arq)) continue;
    const destino = path.join(dirBot(bot), 'arquivo', `${sessaoId}.jsonl.gz`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, zlib.gzipSync(fs.readFileSync(arq)));
    fs.rmSync(arq);
    return destino;
  }
  return null;
}

export function limparArquivosVelhos(bot) {
  const dir = path.join(dirBot(bot), 'arquivo');
  if (!fs.existsSync(dir)) return 0;
  const limite = Date.now() - config.memoria.manterTranscricoesDias * 86400e3;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < limite) { fs.rmSync(p); n++; }
  }
  return n;
}
