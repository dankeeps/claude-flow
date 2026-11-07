#!/bin/bash
# Instala o Claude Flow no Mac/Linux. Rode de dentro da pasta clonada:  bash install.sh
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
falta=0
command -v node >/dev/null || { echo "Falta o Node.js 22+: brew install node"; falta=1; }
command -v claude >/dev/null || { echo "Falta o Claude Code: curl -fsSL https://claude.ai/install.sh | bash  (depois rode 'claude' e faça login)"; falta=1; }
command -v ffmpeg >/dev/null || echo "Recomendado para o Bot Editor: brew install ffmpeg"
command -v yt-dlp >/dev/null || echo "Recomendado para o Bot Editor: brew install yt-dlp"
[ $falta = 1 ] && exit 1

echo "1/3 dependências (npm install)"
cd "$AQUI" && npm install --no-audit --no-fund

echo "2/3 Bot Editor: Perfect Edit + Atlas"
read -r -p "Instalar as ferramentas de edição agora? (S/n) " r
[ "$r" = "n" ] || node "$AQUI/scripts/instalar-editor.js"

echo "3/3 ligar junto com o Mac"
read -r -p "Ligar o Claude Flow sozinho quando você entrar no Mac? (S/n) " r
[ "$r" = "n" ] || bash "$AQUI/scripts/iniciar-com-o-mac.sh"

node "$AQUI/scripts/check.js"
echo "Pronto: npm start (ou o serviço que acabou de ser criado) e abra http://localhost:4400"
