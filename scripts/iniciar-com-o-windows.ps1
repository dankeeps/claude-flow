# Faz o Claude Flow ligar sozinho quando você entra no Windows (atalho minimizado na pasta Inicializar).
# Para desfazer: apague "Claude Flow.lnk" em shell:startup.
$Raiz = Split-Path $PSScriptRoot -Parent
$ws = New-Object -ComObject WScript.Shell
$pasta = [Environment]::GetFolderPath("Startup")
$atalho = $ws.CreateShortcut((Join-Path $pasta "Claude Flow.lnk"))
$atalho.TargetPath = Join-Path $Raiz "Abrir Claude Flow.cmd"
$atalho.WorkingDirectory = $Raiz
$atalho.WindowStyle = 7
$atalho.Save()
Write-Host "Claude Flow vai ligar junto com o Windows (atalho em $pasta)."
Write-Host "Para os bots trabalharem com você longe: Configurações > Sistema > Energia > Suspender = Nunca (na tomada)."
