#!/usr/bin/env node
// Gancho PreToolUse dos bots: toda ferramenta que EXCLUI alguma coisa para e pede confirmação ao usuário no app
// (caixa "Confirmar exclusão" + notificação no celular). O resto passa direto: os bots têm autonomia total.
// Exclusão = comando rm/del/Remove-Item/git clean/..., código que apaga (os.remove, shutil.rmtree, fs.rmSync...)
// e ferramentas de conector com delete/trash/remove no nome. Sem resposta em 30 min, ou servidor fora do ar: não exclui.
import process from 'node:process';

const URL_FLOW = process.env.FLOW_URL || 'http://127.0.0.1:4400';
const TOKEN = process.env.FLOW_TOKEN || '';

// Programas que apagam (o primeiro "pedaço" de um comando, sem caminho nem .exe).
const APAGAM = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'unlink', 'shred', 'rimraf', 'trash', 'trash-put', 'remove-item', 'ri',
  'clear-recyclebin', 'srm', 'wipe']);
// Apagar por dentro de um código (python -c, node -e, scripts inline).
const CODIGO = /\b(os\.(remove|unlink|rmdir|removedirs)|shutil\.rmtree|\.unlink\(|\.rmdir\(|fs\.(rm|rmdir|unlink)(Sync)?\b|rmSync|unlinkSync|rmdirSync|send2trash|\[System\.IO\.(File|Directory)\]::Delete|DeleteFile|Remove-ItemProperty)/i;
// Ferramentas de conector (MCP) que apagam: Gmail trash, Drive trash_file, Notion delete-pages, Meta *_delete...
const MCP_APAGA = /(delete|trash|remove|purge|destroy|erase|apagar|excluir|remover|deletar)/i;
const MCP_NAO = /(untrash|unlabel|remove_label|unlabel_)/i;

function pedacos(cmd) {
  return cmd.split(/[\s;&|(){}`]+/).filter(Boolean).map((p) => p.replace(/^["']+|["']+$/g, '').toLowerCase());
}

function ehExclusaoComando(cmd) {
  if (!cmd) return false;
  const ps = pedacos(cmd);
  for (let i = 0; i < ps.length; i++) {
    const nome = ps[i].split(/[\\/]/).pop().replace(/\.exe$/, '');
    if (APAGAM.has(nome)) return true;
    if (nome === 'git' && ['rm', 'clean'].includes(ps[i + 1])) return true;
    if (nome === 'git' && ps[i + 1] === 'branch' && ['-d', '-D', '--delete'].includes(ps[i + 2])) return true;
    if (nome === 'find' && ps.slice(i).some((x) => x === '-delete')) return true;
    if (nome === 'robocopy' && ps.slice(i).some((x) => x === '/mir' || x === '/purge')) return true;
  }
  return CODIGO.test(cmd);
}

function ehExclusao(tool, entrada) {
  if (tool === 'Bash' || tool === 'PowerShell') return ehExclusaoComando(String(entrada?.command || ''));
  if (tool.startsWith('mcp__') && !tool.startsWith('mcp__flow__')) {
    const nome = tool.split('__').slice(2).join('__');
    return MCP_APAGA.test(nome) && !MCP_NAO.test(nome);
  }
  return false;
}

function responder(decisao, motivo) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decisao, permissionDecisionReason: motivo } }));
  process.exit(0);
}

async function http(caminho, corpo) {
  const r = await fetch(`${URL_FLOW}/api/interno/${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-flow-token': TOKEN },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.erro) throw new Error(j.erro || `erro ${r.status}`);
  return j;
}

let bruto = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { bruto += d; });
process.stdin.on('end', async () => {
  let ev;
  try { ev = JSON.parse(bruto); } catch { process.exit(0); }
  const tool = String(ev.tool_name || '');
  const entrada = ev.tool_input || {};
  if (!ehExclusao(tool, entrada)) process.exit(0);

  const resumo = entrada.command ? String(entrada.command) : `${tool.replace(/^mcp__/, '').replace(/__/g, ' › ')} ${JSON.stringify(entrada)}`;
  try {
    const r = await http('ferramenta/aprovar', { args: { tool_name: tool, input: entrada, tipo: 'exclusao', resumo: resumo.slice(0, 600) } });
    const id = r.espera || r.resultado?.espera;
    if (!id) throw new Error('o servidor não abriu a confirmação');
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 2000));
      const e = await http(`espera/${id}`);
      if (!e.pronto) continue;
      let d = {};
      try { d = JSON.parse(e.texto); } catch {}
      if (d.behavior === 'allow') responder('allow', 'O usuário confirmou a exclusão no Claude Flow.');
      responder('deny', d.message || 'O usuário não confirmou a exclusão. Não apague nada; siga sem isso ou pergunte o que ele prefere.');
    }
  } catch (e) {
    responder('deny', `Exclusão bloqueada: não consegui pedir a confirmação do usuário (${e.message}). Não tente apagar por outro caminho.`);
  }
});
