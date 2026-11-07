# Instala o Claude Flow no Windows. Rode no PowerShell, de dentro da pasta clonada:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Pode rodar de novo quando quiser (atualiza as dependências e mantém seus bots em ~\ClaudeFlow).
$ErrorActionPreference = "Stop"
$Aqui = $PSScriptRoot
function Tem($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "1/5 conferindo o que precisa estar instalado"
$faltam = @()
if (-not (Tem node)) { $faltam += "winget install --id OpenJS.NodeJS.LTS -e" }
if (-not (Tem git)) { $faltam += "winget install --id Git.Git -e" }
if (-not (Tem ffmpeg)) { $faltam += "winget install --id Gyan.FFmpeg -e" }
if (-not (Tem yt-dlp)) { $faltam += "winget install --id yt-dlp.yt-dlp -e" }
if (-not (Tem gh)) { $faltam += "winget install --id GitHub.cli -e   (depois: gh auth login)" }
if ($faltam) {
    Write-Host "Falta instalar. Rode cada linha abaixo, FECHE e abra um PowerShell novo e rode este instalador de novo:"
    $faltam | ForEach-Object { Write-Host "  $_" }
    exit 1
}
if (-not (Tem claude)) {
    Write-Host "Falta o Claude Code. Rode:  irm https://claude.ai/install.ps1 | iex"
    Write-Host "Depois abra um PowerShell novo, rode 'claude' uma vez e entre com a conta da assinatura. Então rode este instalador de novo."
    exit 1
}

Write-Host "2/5 dependências do Claude Flow (npm install)"
Push-Location $Aqui
npm install --no-audit --no-fund
if ($LASTEXITCODE) { throw "npm install falhou" }
Pop-Location

Write-Host "3/5 Bot Editor: Perfect Edit + Atlas (pode demorar na primeira vez)"
$resp = Read-Host "Instalar as ferramentas de edição agora? (S/n)"
if ($resp -ne "n") { node "$Aqui\scripts\instalar-editor.js" }

Write-Host "4/5 atalho na Área de Trabalho"
$ws = New-Object -ComObject WScript.Shell
$atalho = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Claude Flow.lnk"))
$atalho.TargetPath = Join-Path $Aqui "Abrir Claude Flow.cmd"
$atalho.WorkingDirectory = $Aqui
$atalho.WindowStyle = 7
$atalho.IconLocation = "shell32.dll,13"
$atalho.Save()

Write-Host "5/5 ligar junto com o Windows"
$resp = Read-Host "Ligar o Claude Flow sozinho quando o Windows iniciar? (S/n)"
if ($resp -ne "n") { powershell -ExecutionPolicy Bypass -File "$Aqui\scripts\iniciar-com-o-windows.ps1" }

node "$Aqui\scripts\check.js"
Write-Host ""
Write-Host "Pronto. Abra pelo atalho 'Claude Flow' na Área de Trabalho (ou http://localhost:4400)."
Write-Host "Celular: veja docs\pwa-e-celular.md (Tailscale)."
