#!/usr/bin/env node
// Servidor MCP "flow", um por turno de bot (o CLI abre e fecha junto). Fala JSON-RPC por stdin/stdout e repassa cada
// ferramenta para o servidor do Claude Flow com o token do bot. Sem dependências.
import readline from 'node:readline';

const URL_FLOW = process.env.FLOW_URL || 'http://127.0.0.1:4400';
const TOKEN = process.env.FLOW_TOKEN || '';
const COM_PERMISSAO = !!process.env.FLOW_PERMISSAO;

const s = (props, req = []) => ({ type: 'object', properties: props, required: req });
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  ['squad_bots', 'Lista os outros bots do seu squad, com status e função.', s({})],
  ['bot_enviar', 'Manda uma mensagem para outro bot do seu squad. aguardar=true espera a resposta final dele (até 30 min) e devolve aqui; aguardar=false só entrega e segue.',
    s({ para: str('nome ou id do bot'), mensagem: str('o pedido completo, com contexto e caminhos de arquivo'), aguardar: { type: 'boolean', description: 'esperar a resposta' } }, ['para', 'mensagem'])],
  ['squad_quadro_ler', 'Lê o quadro compartilhado do squad (combinados, status, decisões de todos).', s({})],
  ['squad_quadro_escrever', 'Escreve no quadro do squad. modo acrescentar (padrão, entra com seu nome) ou substituir (reescreve tudo).',
    s({ texto: str('texto'), modo: { type: 'string', enum: ['acrescentar', 'substituir'] } }, ['texto'])],
  ['funcao_ler', 'Lê a sua função (o que você é e faz, vale para todas as sessões).', s({})],
  ['funcao_atualizar', 'Grava a sua função quando o usuário define ou muda o seu papel. modo substituir (padrão) ou acrescentar.',
    s({ texto: str('a função completa em markdown, ou o trecho a acrescentar'), modo: { type: 'string', enum: ['substituir', 'acrescentar'] } }, ['texto'])],
  ['memoria_ler', 'Lê a sua memória de fatos duráveis, com quantos caracteres ainda cabem.', s({})],
  ['memoria_adicionar', 'Guarda um fato durável (preferência, correção, decisão, caminho, armadilha). Uma linha.', s({ fato: str('o fato, curto e específico') }, ['fato'])],
  ['memoria_substituir', 'Troca um trecho da memória (para corrigir ou consolidar fatos).', s({ antigo: str('trecho exato atual'), novo: str('texto novo') }, ['antigo', 'novo'])],
  ['memoria_remover', 'Remove um trecho da memória que não vale mais.', s({ trecho: str('trecho exato') }, ['trecho'])],
  ['usuario_ler', 'Lê o perfil do usuário compartilhado por todos os bots.', s({})],
  ['usuario_atualizar', 'Acrescenta um fato ao perfil do usuário (fato) ou troca um trecho (antigo + novo). Só o que vale para todos os bots.',
    s({ fato: str('fato novo'), antigo: str('trecho atual (para trocar)'), novo: str('texto novo') })],
  ['preferencia_definir', 'Muda uma preferência do usuário para você (ex.: fonte de B-roll, renderizar ou não).', s({ chave: str('nome da preferência'), valor: str('valor') }, ['chave', 'valor'])],
  ['historico_buscar', 'Busca nas conversas passadas (todas as sessões). escopo bot (padrão) ou squad.',
    s({ consulta: str('palavras-chave'), escopo: { type: 'string', enum: ['bot', 'squad'] }, limite: { type: 'number' } }, ['consulta'])],
  ['sessao_resumir', 'Grava o resumo da sessão (usado na compactação da memória).', s({ resumo: str('até 1500 caracteres: feito, pendente, arquivos, próximo passo') }, ['resumo'])],
  ['notificar', 'Manda uma notificação para o celular/computador do usuário (aviso no meio de um trabalho longo ou pedido de decisão).', s({ titulo: str('título curto'), texto: str('texto') }, ['titulo'])],
  ['arquivo_entregar', 'Entrega um arquivo pronto ao usuário: vira um link que abre no app, inclusive no celular.', s({ caminho: str('caminho absoluto do arquivo'), legenda: str('o que é') }, ['caminho'])],
  ['atlas_ligar', 'Liga o servidor do Atlas (editor com timeline, localhost:4123) fora do seu turno, para a timeline continuar aberta para o usuário.', s({})],
  ['navegador_ligar','Abre (ou confirma aberto) o navegador do Claude Flow antes de usar as ferramentas mcp__navegador__*. url opcional abre uma aba.', s({ url: str('endereço para abrir') })],
];
if (COM_PERMISSAO) {
  TOOLS.push(['aprovar', 'Uso interno do Claude Flow: pede ao usuário, pelo app, permissão para uma ferramenta.', s({ tool_name: str('ferramenta'), input: { type: 'object' } }, ['tool_name'])]);
}

async function http(caminho, corpo) {
  const r = await fetch(`${URL_FLOW}/api/interno/${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-flow-token': TOKEN },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (!r.ok || j.erro) throw new Error(j.erro || `erro ${r.status}`);
  return j;
}

async function chamar(nome, args) {
  let r = await http(`ferramenta/${nome}`, { args });
  if (r.espera) {
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 2500));
      const e = await http(`espera/${r.espera}`);
      if (e.pronto) { r = { texto: e.texto }; break; }
    }
  }
  return r.texto ?? '';
}

function responder(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function erro(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (linha) => {
  let msg;
  try { msg = JSON.parse(linha); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notificação
  try {
    if (method === 'initialize') {
      responder(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'claude-flow', version: '0.1.0' } });
    } else if (method === 'tools/list') {
      responder(id, { tools: TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) });
    } else if (method === 'tools/call') {
      try {
        const texto = await chamar(params.name, params.arguments || {});
        responder(id, { content: [{ type: 'text', text: String(texto) }] });
      } catch (e) {
        responder(id, { content: [{ type: 'text', text: e.message }], isError: true });
      }
    } else if (method === 'ping') {
      responder(id, {});
    } else {
      erro(id, -32601, `método não suportado: ${method}`);
    }
  } catch (e) {
    erro(id, -32603, e.message);
  }
});
