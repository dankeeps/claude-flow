// O que conta como EXCLUSÃO (regra fixa do Claude Flow: o usuário confirma no app antes de qualquer coisa ser apagada).
// Usado pelo gancho do Claude Code (hooks/guarda-exclusao.js) e pelo motor do ChatGPT (codex.js), para a regra ser
// a mesma nos dois.

// Programas que apagam (o primeiro "pedaço" de um comando, sem caminho nem .exe).
const APAGAM = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'unlink', 'shred', 'rimraf', 'trash', 'trash-put', 'remove-item', 'ri',
  'clear-recyclebin', 'srm', 'wipe']);
// Apagar por dentro de um código (python -c, node -e, scripts inline).
const CODIGO = /\b(os\.(remove|unlink|rmdir|removedirs)|shutil\.rmtree|\.unlink\(|\.rmdir\(|fs\.(rm|rmdir|unlink)(Sync)?\b|rmSync|unlinkSync|rmdirSync|send2trash|\[System\.IO\.(File|Directory)\]::Delete|DeleteFile|Remove-ItemProperty)/i;
// Ferramentas de conector (MCP / apps) que apagam: Gmail trash, Drive trash_file, Notion delete-pages, Meta *_delete...
const MCP_APAGA = /(delete|trash|remove|purge|destroy|erase|apagar|excluir|remover|deletar)/i;
const MCP_NAO = /(untrash|unlabel|remove_label|unlabel_)/i;

function pedacos(cmd) {
  return cmd.split(/[\s;&|(){}`]+/).filter(Boolean).map((p) => p.replace(/^["']+|["']+$/g, '').toLowerCase());
}

export function ehExclusaoComando(cmd) {
  if (!cmd) return false;
  if (Array.isArray(cmd)) cmd = cmd.join(' ');
  cmd = String(cmd);
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

// Nome de ferramenta de conector (sem o servidor): "trash_message", "gmail.trash_thread", "delete-pages"...
export function ehExclusaoFerramenta(nome) {
  const n = String(nome || '');
  return MCP_APAGA.test(n) && !MCP_NAO.test(n);
}

// ---------- exceção: temporários do próprio bot ----------
// O bot pode apagar sem perguntar os arquivos temporários que ele mesmo gera DENTRO da pasta de trabalho dele
// (prévias, folhas e quadros de conferência, json/txt/legendas, áudio intermediário, Shorts candidatos). Continua
// pedindo confirmação: vídeo final/render, brutos, cortados, entregas, biblioteca de B-roll, qualquer coisa fora da
// pasta de trabalho, pasta inteira que não seja temporária, e todo comando que não dê para entender com certeza.
const PROTEGIDAS = new Set(['brutos', 'bruto', 'cortados', 'entregas', 'entrega', 'renders', 'render', 'b-rolls', 'biblioteca', 'editados', 'final', 'finais', 'master', 'arquivo']);
const TEMPORARIAS = /^(prev|previa|previas|prévias|tmp|temp|cache|folhas?|folhas_.*|quadros?|quadros_.*|frames?|thumbs?|capas?|shorts|baixados|candidatos|busca|proxy|masks?|teste|testes|conferencia|conferência)$/i;
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mxf)$/i;
const APAGAM_SIMPLES = new Set(['rm', 'del', 'erase', 'remove-item', 'ri', 'unlink', 'rmdir', 'rd']);

const barra = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
// /c/Users/... (Git Bash) → C:/Users/...
const doBash = (p) => barra(p).replace(/^\/([a-zA-Z])\//, (_, l) => `${l.toUpperCase()}:/`);

function normalizar(p) {
  const partes = [];
  for (const x of doBash(p).split('/')) {
    if (x === '' && partes.length) continue;
    if (x === '.') continue;
    if (x === '..') { if (partes.length > 1) partes.pop(); else return null; continue; }
    partes.push(x);
  }
  return partes.join('/');
}
const absoluto = (p) => /^[a-zA-Z]:\//.test(p) || p.startsWith('/');

// divide um comando em segmentos (; && || | e quebra de linha), respeitando aspas
function segmentos(cmd) {
  const out = []; let atual = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === q) q = null; atual += c; continue; }
    if (c === '"' || c === "'") { q = c; atual += c; continue; }
    if (c === ';' || c === '\n' || (c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) { out.push(atual); atual = ''; if (c !== ';' && c !== '\n') i++; continue; }
    if (c === '|') { out.push(atual); atual = ''; continue; }
    atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim()).filter(Boolean);
}
// palavras de um segmento, tirando aspas
function palavras(seg) {
  const out = []; let atual = ''; let q = null; let tem = false;
  for (const c of seg) {
    if (q) { if (c === q) q = null; else atual += c; continue; }
    if (c === '"' || c === "'") { q = c; tem = true; continue; }
    if (/\s/.test(c)) { if (atual || tem) out.push(atual); atual = ''; tem = false; continue; }
    atual += c;
  }
  if (atual || tem) out.push(atual);
  return out;
}

export function exclusaoLivre(cmd, { env = {}, cwd = '', cwdConfiavel = true } = {}) {
  if (!cmd) return false;
  if (Array.isArray(cmd)) cmd = cmd.join(' ');
  cmd = String(cmd);
  if (CODIGO.test(cmd)) return false; // apagar por dentro de código: sempre pergunta
  const trabalho = normalizar(env.FLOW_TRABALHO || '');
  if (!trabalho) return false;
  const vars = { ...env };
  const expandir = (s) => {
    let r = String(s);
    for (let i = 0; i < 4; i++) {
      const n = r.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a, b) => (vars[a || b] !== undefined ? vars[a || b] : m));
      if (n === r) break; r = n;
    }
    if (/\$[A-Za-z_{(]|`/.test(r)) return null; // sobrou variável desconhecida ou subcomando: não dá para saber
    return r.replace(/^~(?=\/|$)/, barra(env.USERPROFILE || env.HOME || '~'));
  };
  let dir = normalizar(cwd || '') || '';
  let dirCerto = cwdConfiavel && !!dir; // sem cwd confiável, caminho relativo só vale depois de um cd absoluto
  const alvos = [];
  for (const seg of segmentos(cmd)) {
    const ps = palavras(seg);
    if (!ps.length) continue;
    // VAR=valor (sozinho) ou export VAR=valor
    const atrib = ps.length === 1 ? ps[0] : ps[0] === 'export' && ps.length === 2 ? ps[1] : null;
    if (atrib && /^[A-Za-z_]\w*=/.test(atrib)) {
      const [k, ...v] = atrib.split('=');
      const val = expandir(v.join('='));
      if (val === null) return false;
      vars[k] = val; continue;
    }
    const prog = ps[0].split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
    if (prog === 'cd') { const d = expandir(ps[1] || ''); if (d === null) return false; const nd = normalizar(absoluto(doBash(d)) ? d : `${dir}/${d}`); if (!nd) return false; dir = nd; if (absoluto(doBash(d))) dirCerto = true; continue; }
    if (!APAGAM_SIMPLES.has(prog)) {
      if (ehExclusaoComando(seg)) return false; // outro jeito de apagar (find -delete, git clean, robocopy...): pergunta
      continue;
    }
    const recursivo = ps.slice(1).some((a) => /^-[a-zA-Z]*r/i.test(a) || /^-recurse$/i.test(a) || a === '/s') || prog === 'rmdir' || prog === 'rd';
    const args = ps.slice(1).filter((a) => !/^-/.test(a) && !/^\/[a-z]$/i.test(a) && !/^\d?>/.test(a) && a !== '/dev/null');
    if (!args.length) return false;
    for (const a of args) {
      const e = expandir(a);
      if (e === null) return false;
      if (!absoluto(doBash(e)) && !dirCerto) return false;
      const p = normalizar(absoluto(doBash(e)) ? e : `${dir}/${e}`);
      if (!p) return false;
      alvos.push({ p, recursivo });
    }
  }
  if (!alvos.length) return false;
  const raiz = trabalho.toLowerCase() + '/';
  for (const { p, recursivo } of alvos) {
    if (!p.toLowerCase().startsWith(raiz)) return false; // fora da pasta de trabalho do bot
    const rel = p.slice(raiz.length).split('/').filter(Boolean);
    if (rel.length < 2) return false; // algo solto na raiz do trabalho ou a pasta de trabalho em si
    const dirs = rel.slice(0, -1).map((x) => x.toLowerCase());
    const nome = rel[rel.length - 1];
    if (dirs.some((d) => PROTEGIDAS.has(d)) || PROTEGIDAS.has(nome.toLowerCase())) return false;
    const temporario = dirs.some((d) => TEMPORARIAS.test(d)) || TEMPORARIAS.test(nome);
    if (recursivo && !TEMPORARIAS.test(nome.replace(/[*?].*$/, '')) && !dirs.some((d) => TEMPORARIAS.test(d))) return false; // pasta inteira não temporária
    if (/^[*?]+$/.test(nome) && !temporario) return false; // "apaga tudo" numa pasta que não é temporária
    if ((VIDEO.test(nome) || /\*$/.test(nome) || /\*\.\*$/.test(nome)) && !temporario) return false; // vídeo (ou tudo) fora de pasta temporária
  }
  return true;
}
