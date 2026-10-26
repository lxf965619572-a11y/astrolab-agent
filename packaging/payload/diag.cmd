@echo off
rem AstroLab engine start-up diagnosis (about 5 minutes). Report goes to %LOCALAPPDATA%\AstroLab\diag\startup-diag-*.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\packaging\launch.ps1" -Action diag
pause
