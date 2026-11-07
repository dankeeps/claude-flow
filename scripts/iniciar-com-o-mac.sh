#!/bin/bash
# Cria um LaunchAgent que liga o Claude Flow quando você entra no Mac e religa se ele cair.
# Para desfazer: launchctl unload ~/Library/LaunchAgents/com.claudeflow.servidor.plist && rm esse arquivo.
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PLIST=~/Library/LaunchAgents/com.claudeflow.servidor.plist
mkdir -p ~/Library/LaunchAgents ~/ClaudeFlow/logs
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.claudeflow.servidor</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string><string>--disable-warning=ExperimentalWarning</string><string>$RAIZ/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$RAIZ</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH</string><key>PYTHONUTF8</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/ClaudeFlow/logs/servidor.log</string>
  <key>StandardErrorPath</key><string>$HOME/ClaudeFlow/logs/servidor.log</string>
</dict></plist>
EOF
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
echo "Claude Flow ligado como serviço (log em ~/ClaudeFlow/logs/servidor.log)."
