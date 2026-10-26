@echo off
rem Start AstroLab (stage-0 prototype UI at http://127.0.0.1:3090)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\packaging\launch.ps1" -Action ui
pause
