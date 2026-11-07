# Instala a Perfect Edit no Windows: a .venv do corte (faster-whisper + VAD), o Atlas (Octo Edição) com a .venv e os
# modelos dele, os atalhos das skills em ~/.claude/skills e o "atlas-editor" no ~/.claude/launch.json.
# Rode no PowerShell, de dentro da pasta clonada:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Pode rodar de novo quando quiser: o que já existe fica como está (só atualiza as dependências).
$ErrorActionPreference = "Stop"
$Aqui = $PSScriptRoot
# "Octo Edição" e "Edições" montados por código de caractere: funciona mesmo se o arquivo perder a codificação
$Octo = Join-Path $HOME ("Octo Edi" + [char]0x00E7 + [char]0x00E3 + "o")
$Edicoes = Join-Path $HOME ("Edi" + [char]0x00E7 + [char]0x00F5 + "es")
$Atlas = if ($env:PERFECT_EDIT_ATLAS) { $env:PERFECT_EDIT_ATLAS } else { Join-Path $Octo "Atlas" }
$Modelos = Join-Path $HOME ".cache\atlas-modelos"

function Tem($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Rodar {
    $exe, $resto = $args
    & $exe @resto
    if ($LASTEXITCODE) { throw "falhou ($LASTEXITCODE): $($args -join ' ')" }
}

Write-Host "0/6 conferindo o que precisa estar instalado"
$faltam = @()
if (-not (Tem git)) { $faltam += "winget install --id Git.Git -e" }
if (-not (Tem ffmpeg)) { $faltam += "winget install --id Gyan.FFmpeg -e" }
$PyExe = $null
if (Tem py) {
    # stderr redirecionado de programa externo vira erro no PowerShell 5.1 com "Stop": por isso o try
    try { $PyExe = & py -3.12 -c "import sys; print(sys.executable)" 2>$null } catch { $PyExe = $null }
    if ($LASTEXITCODE) { $PyExe = $null }
}
if (-not $PyExe) { $faltam += "winget install --id Python.Python.3.12 -e" }
if ($faltam) {
    Write-Host "Falta instalar. Rode cada linha abaixo, FECHE e abra um PowerShell novo e rode este instalador de novo:"
    $faltam | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "1/6 variáveis do usuário (UTF-8 no Python e modelos numa pasta sem acento)"
[Environment]::SetEnvironmentVariable("PYTHONUTF8", "1", "User"); $env:PYTHONUTF8 = "1"
if (-not [Environment]::GetEnvironmentVariable("ESTUDIO_MODELOS", "User")) {
    [Environment]::SetEnvironmentVariable("ESTUDIO_MODELOS", $Modelos, "User")
}
$env:ESTUDIO_MODELOS = [Environment]::GetEnvironmentVariable("ESTUDIO_MODELOS", "User")

Write-Host "2/6 corte: .venv da Perfect Edit"
$PyPE = Join-Path $Aqui ".venv\Scripts\python.exe"
if (-not (Test-Path $PyPE)) { Rodar $PyExe -m venv (Join-Path $Aqui ".venv") }
Rodar $PyPE -m pip install -q --upgrade pip
Rodar $PyPE -m pip install -q -r (Join-Path $Aqui "requirements.txt")
Rodar $PyPE -m pip install -q -r (Join-Path $Aqui "skills\motion-vox\requirements.txt")

Write-Host "3/6 edição: o Atlas (repositório privado dankeeps/Atlas-interno)"
if (-not (Test-Path (Join-Path $Atlas "lib"))) {
    New-Item -ItemType Directory -Force $Octo | Out-Null
    Rodar git clone https://github.com/dankeeps/Atlas-interno.git $Atlas
} else { Write-Host "  já está em $Atlas (para atualizar: git -C `"$Atlas`" pull)" }
$PyA = Join-Path $Atlas ".venv\Scripts\python.exe"
if (-not (Test-Path $PyA)) { Rodar $PyExe -m venv (Join-Path $Atlas ".venv") }
Rodar $PyA -m pip install -q --upgrade pip
Rodar $PyA -m pip install -q -r (Join-Path $Atlas "requirements.txt")

Write-Host "4/6 modelos do recorte da expert (RVM) e da pose (legenda abaixo do pescoço)"
Rodar $PyA (Join-Path $Atlas "lib\matte.py") --instalar mobilenetv3
Rodar $PyA (Join-Path $Atlas "lib\pose.py") --instalar

Write-Host "5/6 pastas de projetos e de B-roll"
New-Item -ItemType Directory -Force $Edicoes, (Join-Path $Octo "B-rolls\Principal") | Out-Null

Write-Host "6/6 skills do Claude Code e o atlas-editor no launch.json"
$Skills = Join-Path $HOME ".claude\skills"
New-Item -ItemType Directory -Force $Skills | Out-Null
function Ligar($nome, $alvo) {
    $dest = Join-Path $Skills $nome
    if (Test-Path $dest) { Write-Host "  ${nome}: já existe, deixei como está"; return }
    New-Item -ItemType Junction -Path $dest -Target $alvo | Out-Null
    Write-Host "  $nome -> $alvo"
}
Ligar "perfect-edit" $Aqui
Ligar "motion-vox" (Join-Path $Aqui "skills\motion-vox")
Ligar "criar-template" (Join-Path $Atlas ".claude\skills\criar-template")

$Launch = Join-Path $HOME ".claude\launch.json"
$j = if (Test-Path $Launch) { Get-Content $Launch -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{ version = "0.0.1"; configurations = @() } }
if (-not ($j.configurations | Where-Object { $_.name -eq "atlas-editor" })) {
    $cfg = [pscustomobject][ordered]@{
        name = "atlas-editor"; runtimeExecutable = $PyA; runtimeArgs = @((Join-Path $Atlas "app\servidor.py"))
        env = [pscustomobject]@{ PORTA = "4123"; PYTHONUTF8 = "1"; ESTUDIO_MODELOS = $env:ESTUDIO_MODELOS }; port = 4123
    }
    $j.configurations = @($j.configurations) + $cfg
    # sem BOM: o Claude lê o launch.json como JSON puro
    [IO.File]::WriteAllText($Launch, ($j | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
    Write-Host "  atlas-editor gravado em $Launch"
} else { Write-Host "  atlas-editor já estava no $Launch" }

if (-not (Tem whisper-cli)) { Write-Host "opcional: whisper.cpp para o repeticoes.py (README, seção 'Caçar repetição')" }
Write-Host ""
Write-Host "Pronto. Próximos passos:"
Write-Host "  1. Feche e abra o Claude Code (para ele ver as variáveis novas)."
Write-Host "  2. Dê dois cliques em 'Abrir Atlas.cmd' (nesta pasta) e ponha as chaves da Apify e da OpenRouter em Configurações."
Write-Host "  3. No Claude Code, aberto na sua pasta de usuário: /perfect-edit"
