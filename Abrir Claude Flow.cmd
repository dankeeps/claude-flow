@echo off
rem Liga o servidor do Claude Flow e abre o app no navegador. Fechar esta janela desliga os bots.
cd /d "%~dp0"
set PYTHONUTF8=1
start "" cmd /c "timeout /t 3 >nul & start http://localhost:4400"
node --disable-warning=ExperimentalWarning server\index.js
pause
