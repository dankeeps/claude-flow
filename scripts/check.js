// Diagnóstico: confere tudo que o Claude Flow e o Bot Editor precisam neste computador.
//   npm run check
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, expandir, HOME, IS_WIN } from '../server/config.js';
import { acharChrome } from '../server/navegador.js';

const linhas = [];
const ok = (cond, nome, detalhe = '', dica = '') => linhas.push(`${cond ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}${!cond && dica ? `\n     → ${dica}` : ''}`);
const aviso = (nome, detalhe) => linhas.push(`⚠️  ${nome} — ${detalhe}`);

function rodar(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: IS_WIN, timeout: 20000 });
  return r.status === 0 ? (r.stdout || r.stderr || '').trim().split('\n')[0] : null;
}

const [maior, menor] = process.versions.node.split('.').map(Number);
ok(maior > 22 || (maior === 22 && menor >= 13), 'Node.js', process.versions.node, 'instale o Node 22 LTS ou mais novo (winget install OpenJS.NodeJS.LTS)');

const claude = config.claudeBin ? expandir(config.claudeBin) : 'claude';
const vClaude = rodar(claude, ['--version']);
ok(!!vClaude, 'Claude Code CLI', vClaude || 'não encontrado', IS_WIN ? 'irm https://claude.ai/install.ps1 | iex   (depois: claude, e faça login com a conta da assinatura)' : 'curl -fsSL https://claude.ai/install.sh | bash');

ok(fs.existsSync(path.join(process.cwd(), 'node_modules', '@playwright', 'mcp')), 'Dependências (npm install)', '', 'npm install');
const chrome = acharChrome();
ok(!!chrome, 'Navegador para o Claude Flow', chrome || '', 'instale o Google Chrome (ou defina navegador.chrome no config.json)');

const atlas = expandir(config.atlas.dir);
const pyAtlas = path.join(atlas, '.venv', IS_WIN ? 'Scripts/python.exe' : 'bin/python');
ok(fs.existsSync(path.join(atlas, 'app', 'servidor.py')), 'Atlas (Octo Edição)', atlas, 'npm run editor:instalar (clona o Atlas e instala o Perfect Edit)');
ok(fs.existsSync(pyAtlas), 'Python do Atlas (.venv)', pyAtlas, 'npm run editor:instalar');
const pe = path.join(process.cwd(), 'templates', 'editor', 'skills', 'perfect-edit', '.venv');
ok(fs.existsSync(pe), 'Perfect Edit (.venv do corte)', pe, 'npm run editor:instalar');
ok(!!rodar('ffmpeg', ['-version']), 'ffmpeg', '', IS_WIN ? 'winget install --id Gyan.FFmpeg -e' : 'brew install ffmpeg');
ok(!!rodar('yt-dlp', ['--version']), 'yt-dlp (B-roll do YouTube)', '', IS_WIN ? 'winget install yt-dlp.yt-dlp' : 'brew install yt-dlp');
if (IS_WIN) ok(!!rodar('git', ['--version']), 'Git (o Claude Code no Windows usa o Git Bash)', '', 'winget install --id Git.Git -e');
if (!rodar('uvx', ['--version'])) aviso('uv/uvx', 'só precisa para o conector ElevenLabs (pip install uv)');
if (config.host !== '127.0.0.1') aviso('Servidor aberto para a rede', `host = ${config.host} no ${path.join(HOME, 'config.json')}`);

console.log(`\nClaude Flow — diagnóstico (dados em ${HOME})\n`);
console.log(linhas.join('\n'));
console.log('');
