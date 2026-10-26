@echo off
rem AstroLab self-check (no model calls). Report goes to %LOCALAPPDATA%\AstroLab\check-report-*.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\packaging\launch.ps1" -Action check
pause
