#!/bin/zsh
# Instala a Perfect Edit no Mac/Linux (no Windows: install.ps1): .venv do corte (faster-whisper + VAD), o Atlas (Octo Edição) do GitHub com a .venv dele,
# e o atalho em ~/.claude/skills/perfect-edit. Precisa: python3 >= 3.10, ffmpeg (brew install ffmpeg) e gh logado.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)
echo "1/3 corte: .venv"
"$PY" -m venv "$AQUI/.venv"; "$AQUI/.venv/bin/pip" install -q --upgrade pip; "$AQUI/.venv/bin/pip" install -q -r "$AQUI/requirements.txt"
ATLAS=~/"Octo Edição/Atlas"
if [ ! -d "$ATLAS/lib" ]; then
  echo "2/3 edição: clonando o Atlas (repositório privado dankeeps/Atlas-interno)"
  mkdir -p ~/"Octo Edição"; gh repo clone dankeeps/Atlas-interno "$ATLAS"
else echo "2/3 edição: Atlas já está em $ATLAS"; fi
[ -e ~/"Editor Atlas" ] || ln -s "$ATLAS" ~/"Editor Atlas"
if [ ! -x "$ATLAS/.venv/bin/python" ]; then "$PY" -m venv "$ATLAS/.venv"; "$ATLAS/.venv/bin/pip" install -q -r "$ATLAS/requirements.txt"; fi
"$AQUI/.venv/bin/pip" install -q -r "$AQUI/skills/motion-vox/requirements.txt"
echo "3/3 atalhos das skills"
mkdir -p ~/.claude/skills; [ -e ~/.claude/skills/perfect-edit ] || ln -s "$AQUI" ~/.claude/skills/perfect-edit
[ -e ~/.claude/skills/motion-vox ] || ln -s "$AQUI/skills/motion-vox" ~/.claude/skills/motion-vox
[ -e ~/.claude/skills/criar-template ] || ln -s "$ATLAS/.claude/skills/criar-template" ~/.claude/skills/criar-template
command -v ffmpeg >/dev/null || echo "atenção: instale o ffmpeg (brew install ffmpeg)"
command -v whisper-cli >/dev/null || echo "opcional: brew install whisper-cpp + modelo ggml em ~/whisper-models (repeticoes.py)"
echo "Pronto. Abra o Atlas, ponha as chaves da Apify e da OpenRouter em ⚙ Configurações, e no Claude Code use /perfect-edit"
