// Instala o que o Bot Editor usa: roda o instalador do Perfect Edit que vem dentro do template
// (templates/editor/skills/perfect-edit). Ele cria a .venv do corte (faster-whisper + VAD), clona o Atlas
// (dankeeps/Atlas-interno, privado: precisa do gh logado) em ~/Octo Edição/Atlas se ainda não existir, cria a .venv do
// Atlas e os atalhos das skills em ~/.claude/skills.
//   npm run editor:instalar
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, IS_WIN } from '../server/config.js';

const pe = path.join(REPO, 'templates', 'editor', 'skills', 'perfect-edit');
const r = IS_WIN
  ? spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(pe, 'install.ps1')], { stdio: 'inherit', cwd: pe })
  : spawnSync(process.platform === 'darwin' ? 'zsh' : 'bash', [path.join(pe, 'install.sh')], { stdio: 'inherit', cwd: pe });
process.exit(r.status ?? 1);
