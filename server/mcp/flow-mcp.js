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
  ['tarefas_listar', 'Lista tarefas do kanban: escopo "minhas" (padrão, as suas abertas) ou "squad" (todas abertas do squad). status opcional: afazer, fazendo, revisao, feito.',
    s({ escopo: { type: 'string', enum: ['minhas', 'squad'] }, status: { type: 'string', enum: ['afazer', 'fazendo', 'revisao', 'feito'] } })],
  ['tarefa_ver', 'Mostra uma tarefa: descrição, "pronto quando", pasta e o histórico de notas.', s({ id: { type: 'number' } }, ['id'])],
  ['tarefa_criar', 'Cria uma tarefa no kanban do squad. Com para=<bot> é um REPASSE: a tarefa vai para aquele bot com objetivo, contexto e "pronto quando", e quando ele terminar o resultado volta para você. Sem para, registra uma tarefa sua.',
    s({ titulo: str('título curto'), descricao: str('objetivo e todo o contexto que o outro bot precisa (caminhos de arquivo, decisões, links)'), entregaveis: str('o que é "pronto" (o que entregar e onde)'),
      para: str('nome ou id do bot do squad (vazio = você mesmo)'), comecar: { type: 'boolean', description: 'enviar já para o bot começar (padrão true)' } }, ['titulo'])],
  ['tarefa_atualizar', 'Atualiza uma tarefa: status (afazer, fazendo, revisao = pronto para o usuário conferir, feito) e/ou uma nota (o que fez, o que entregou e onde).',
    s({ id: { type: 'number' }, status: { type: 'string', enum: ['afazer', 'fazendo', 'revisao', 'feito'] }, nota: str('nota curta') }, ['id'])],
  ['tarefas_aguardar', 'Espera (até 30 min) várias tarefas repassadas chegarem em revisão/feito e devolve as notas de todas. Use depois de repassar partes em paralelo.',
    s({ ids: { type: 'array', items: { type: 'number' } } }, ['ids'])],
  ['link_salvar', 'Salva um link fixo seu (planilha, pasta, documento) com nome, para todas as sessões. Use quando o usuário pedir para guardar um link.',
    s({ nome: str('nome curto, ex.: Planilha de métricas'), url: str('o link'), nota: str('para que serve (opcional)') }, ['nome', 'url'])],
  ['modelo_salvar', 'Cria ou atualiza um modelo de referência seu em markdown (ex.: "Anúncio": o que todo anúncio precisa ter). Use quando o usuário pedir para guardar um modelo/padrão.',
    s({ nome: str('nome do modelo'), conteudo: str('o modelo completo em markdown') }, ['nome', 'conteudo'])],
  ['navegador_assumir', 'Pede ao usuário que assuma o navegador: use quando cair numa tela de login, verificação ("não sou um robô"), código por SMS/e-mail ou qualquer coisa que só ele pode fazer. Aparece um cartão no app e uma notificação; você espera (até 30 min) ele avisar que terminou e então continua. Nunca digite senha nem tente contornar a verificação.',
    s({ motivo: str('o que ele precisa fazer, curto (ex.: "Entrar na conta do TikTok da Kellen")'), url: str('a página onde ele deve fazer isso') }, ['motivo'])],
  ['progresso', 'Avisa o usuário de uma etapa concluída num trabalho longo, numa frase curta e concreta ("Baixei os 6 brutos (4,2 GB)", "Transcrição pronta", "B-rolls escolhidos: 11"). Aparece no chat sem interromper o seu trabalho e vira nota no cartão do kanban. Use a cada etapa concluída, não para narrar o que vai fazer.',
    s({ texto: str('o que ficou pronto, uma frase') }, ['texto'])],
  ['rotinas_listar', 'Lista as suas rotinas (instruções que rodam sozinhas num horário).', s({})],
  ['rotina_criar', 'Cria uma rotina sua: uma instrução que roda sozinha. tipo: diario (todo dia na hora), semanal (nos dias 0=dom..6=sáb, na hora), intervalo (a cada N horas) ou manual (só quando disparada). Use quando o usuário pedir "todo dia/toda segunda faça…".',
    s({ nome: str('nome curto'), instrucao: str('a instrução completa, como se fosse uma mensagem do usuário (o que fazer, onde entregar)'),
      tipo: { type: 'string', enum: ['diario', 'semanal', 'intervalo', 'manual'] }, hora: str('HH:MM (diario/semanal)'),
      dias: { type: 'array', items: { type: 'number' }, description: '0=dom … 6=sáb (semanal)' }, horas: { type: 'number', description: 'a cada quantas horas (intervalo)' } }, ['nome', 'instrucao'])],
  ['rotina_atualizar', 'Muda uma rotina sua (nome, instrução, horário) ou pausa/retoma com ativa=false/true. Apagar rotina só o usuário, pelo app.',
    s({ id: str('id da rotina (rotinas_listar)'), nome: str('nome'), instrucao: str('instrução'), tipo: { type: 'string', enum: ['diario', 'semanal', 'intervalo', 'manual'] },
      hora: str('HH:MM'), dias: { type: 'array', items: { type: 'number' } }, horas: { type: 'number' }, ativa: { type: 'boolean' } }, ['id'])],
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
