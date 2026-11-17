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
    s({ para: str('nome ou id do bot'), mensagem: str('o pedido completo, com contexto e caminhos de arquivo'), aguardar: { type: 'boolean', description: 'esperar a resposta' }, na_frente: { type: 'boolean', description: 'entra na frente da fila dele (correção, aviso urgente)' } }, ['para', 'mensagem'])],
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
  ['quadro_entregar', 'Entrega VÁRIOS arquivos numa mensagem só, em grade numerada (personagens, storyboard, cenas para aprovar). Cada item é um arquivo separado (imagem ou vídeo) com título e descrição curta. Use no lugar de vários arquivo_entregar seguidos.',
    s({ titulo: str('título do quadro, ex.: "Storyboard: aprove ou peça ajuste"'), itens: { type: 'array', description: 'na ordem: [{ caminho, titulo, texto }]', items: s({ caminho: str('caminho absoluto do arquivo'), titulo: str('ex.: "Cena 1" ou "Personagem: Ana"'), texto: str('descrição curta') }, ['caminho']) } }, ['itens'])],
  ['nuvem_enviar', 'Só com o conector Cloudflare R2 ligado: sobe um arquivo local (vídeo, imagem) para o bucket R2 do usuário e devolve o LINK PÚBLICO direto, para usar onde precisa de URL (ex.: Meta Ads ads_creative_upload_media com upload_source URL, media_type VIDEO, media_url = o link). Nome único: nunca sobrescreve nem apaga nada.',
    s({ caminho: str('caminho absoluto do arquivo'), pasta: str('pasta no bucket, ex.: "anuncios" (opcional)') }, ['caminho'])],
  ['kie_gerar', 'Só com o conector kie.ai ligado: gera VÍDEO ou IMAGEM pela API da kie.ai com os créditos do usuário. Passe o id do modelo e o input do modelo (campos da documentação da kie.ai). Caminhos locais de arquivo no input (imagens de referência, primeiro quadro, áudio) sobem sozinhos. Espera até ~4 min e baixa o resultado para trabalho/entregas/kie; se ainda não terminou, devolve o taskId: chame kie_aguardar.',
    s({ modelo: str('id do modelo, ex.: "kling-3.0/video", "bytedance/seedance-2", "veo-3-1", "nano-banana-pro"'), input: { type: 'object', description: 'campos do modelo (prompt, image_urls, duration, aspect_ratio…)' }, nome: str('nome do arquivo salvo, ex.: "cena-03" (opcional)') }, ['modelo', 'input'])],
  ['kie_aguardar', 'Continua esperando uma geração da kie.ai (taskId de kie_gerar) e baixa o resultado quando ficar pronto. Não gasta crédito.',
    s({ taskId: str('id da tarefa'), nome: str('nome do arquivo salvo (opcional)') }, ['taskId'])],
  ['kie_creditos', 'Mostra quantos créditos restam na conta da kie.ai.', s({})],
  ['demanda_etapa', 'Só quando houver DEMANDA ABERTA (o aviso vem na mensagem): entrega/atualiza a etapa atual no cartão da demanda. status "aguardando" = pronta para o usuário aprovar (depois encerre o turno); "trabalhando" = progresso no meio; "pulada" = etapa não se aplica (a próxima começa na hora). itens substituem os da etapa.',
    s({ texto: str('resultado da etapa em markdown (curto e organizado: listas, tabelas)'), itens: { type: 'array', description: 'arquivos da etapa na ordem: [{ caminho, titulo, texto }]', items: s({ caminho: str('caminho absoluto'), titulo: str('ex.: "Cena 1"'), texto: str('descrição curta') }, ['caminho']) },
      status: { type: 'string', enum: ['aguardando', 'trabalhando', 'pulada'] }, progresso: str('ex.: "cena 4 de 12"') })],
  ['demanda_ver', 'Mostra a demanda aberta: etapas, status, o que já foi entregue e os ajustes pedidos.', s({})],
  ['atlas_ligar', 'Liga o servidor do Atlas (editor com timeline, localhost:4123) fora do seu turno, para a timeline continuar aberta para o usuário.', s({})],
  ['navegador_ligar','Abre (ou confirma aberto) o navegador do Claude Flow antes de usar as ferramentas mcp__navegador__*. url opcional abre uma aba.', s({ url: str('endereço para abrir') })],
  ['tarefas_listar', 'Lista tarefas do kanban: escopo "minhas" (padrão, as suas abertas) ou "squad" (todas abertas do squad). status opcional: afazer, fazendo, revisao, feito.',
    s({ escopo: { type: 'string', enum: ['minhas', 'squad'] }, status: { type: 'string', enum: ['afazer', 'fazendo', 'revisao', 'feito'] } })],
  ['tarefa_ver', 'Mostra uma tarefa: descrição, "pronto quando", pasta e o histórico de notas.', s({ id: { type: 'number' } }, ['id'])],
  ['tarefa_criar', 'Cria uma tarefa no kanban do squad. Com para=<bot> é um REPASSE: a tarefa vai para aquele bot com objetivo, contexto e "pronto quando", e quando ele terminar o resultado volta para você. Sem para, registra uma tarefa sua.',
    s({ titulo: str('título curto'), descricao: str('objetivo e todo o contexto que o outro bot precisa (caminhos de arquivo, decisões, links)'), entregaveis: str('o que é "pronto" (o que entregar e onde)'),
      para: str('nome ou id do bot do squad (vazio = você mesmo)'), comecar: { type: 'boolean', description: 'enviar já para o bot começar (padrão true)' },
      na_frente: { type: 'boolean', description: 'correção de um trabalho já entregue: entra na frente da fila dele' } }, ['titulo'])],
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
  ['bot_atividade', 'Mostra o que um bot do squad está fazendo: status, há quanto tempo, a tarefa e as notas dela, e a atividade recente (mensagens, progresso, comandos). Para o Head conferir o trabalho dos outros.',
    s({ bot: str('nome do bot'), limite: { type: 'number', description: 'quantas linhas de atividade (padrão 40, máx. 120)' } }, ['bot'])],
  ['bot_regras', 'Mostra a função, as preferências, a memória e as instruções de um bot do squad (as regras que ele deve seguir).', s({ bot: str('nome do bot') }, ['bot'])],
  ['spy_listar', 'Lista as bibliotecas da aba Spy do squad: lista "monitoradas" (padrão: página, page_id, tipo, nicho, anúncios ativos da última conferência, link) ou "blacklist" (anunciantes que nunca entram no spy).',
    s({ lista: { type: 'string', enum: ['monitoradas', 'blacklist'] } })],
  ['spy_monitorar', 'Põe (ou atualiza) uma biblioteca na aba Spy para ser monitorada. Só depois do OK do usuário. tipo: vsl, quiz ou quiz+vsl.',
    s({ page_id: str('page_id da biblioteca'), pagina: str('nome da página'), nicho: str('nicho'), tipo: { type: 'string', enum: ['vsl', 'quiz', 'quiz+vsl'] },
      biblioteca: str('link da biblioteca (view_all_page_id)'), destino: str('link da página de vendas'), ativos: { type: 'number', description: 'anúncios ativos agora' } }, ['page_id', 'pagina'])],
  ['spy_conferencias', 'Grava o resultado do monitoramento: anúncios ativos de cada biblioteca monitorada (o coletor monitorar já faz isso sozinho).',
    s({ itens: { type: 'array', items: { type: 'object', properties: { page_id: str('page_id'), ativos: { type: 'number' } }, required: ['page_id', 'ativos'] } } }, ['itens'])],
  ['spy_blacklist', 'Põe um anunciante na blacklist do spy (o usuário não quer ver de novo): some das buscas e do monitoramento.',
    s({ page_id: str('page_id'), pagina: str('nome da página'), motivo: str('por quê (opcional)') }, ['pagina'])],
  ['relevante_criar', 'Publica um item RELEVANTE na sala do squad (aba Relevantes), que o usuário sempre olha: relatório de triagem (anúncio faltando, trecho não gravado), relatório de criativos, alerta de reembolso/disputa, conta a pagar vencendo. Texto em markdown, completo. Não use para recados comuns.',
    s({ titulo: str('título curto e específico'), texto: str('o relatório completo em markdown'), tipo: str('ex.: triagem, criativos, spy, financeiro') }, ['titulo', 'texto'])],
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
