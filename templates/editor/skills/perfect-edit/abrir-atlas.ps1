# Abre o Atlas (Octo Edição) em http://localhost:4123. Quem chama é o "Abrir Atlas.cmd" (dois cliques).
# Se o servidor já estiver no ar (aberto pelo Claude com preview_start, por exemplo), só abre o navegador.
$Octo = Join-Path $HOME ("Octo Edi" + [char]0x00E7 + [char]0x00E3 + "o")
$Atlas = if ($env:PERFECT_EDIT_ATLAS) { $env:PERFECT_EDIT_ATLAS } else { Join-Path $Octo "Atlas" }
$env:PYTHONUTF8 = "1"; $env:PORTA = "4123"
if (-not $env:ESTUDIO_MODELOS) { $env:ESTUDIO_MODELOS = Join-Path $HOME ".cache\atlas-modelos" }

$c = New-Object Net.Sockets.TcpClient
try { $c.Connect("127.0.0.1", 4123); $noAr = $true } catch { $noAr = $false } finally { $c.Close() }
if ($noAr) { Start-Process "http://localhost:4123"; exit }

Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "Start-Sleep 3; Start-Process http://localhost:4123"
Write-Host "Atlas em http://localhost:4123 - deixe esta janela aberta enquanto usa (fechar = desligar o Atlas)."
& (Join-Path $Atlas ".venv\Scripts\python.exe") (Join-Path $Atlas "app\servidor.py")
