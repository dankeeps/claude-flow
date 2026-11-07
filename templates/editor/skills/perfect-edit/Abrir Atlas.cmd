@echo off
rem Abre o Atlas (Octo Edicao) em http://localhost:4123 - deixe a janela aberta enquanto usa.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0abrir-atlas.ps1"
if errorlevel 1 pause
