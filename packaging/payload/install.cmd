@echo off
rem AstroLab offline install: copy this folder to %LOCALAPPDATA%\Programs\AstroLab and create Start menu / desktop shortcuts.
rem No admin rights, no network. User data (settings, tasks, libraries) lives in %LOCALAPPDATA%\AstroLab and is kept on update.
setlocal
set "DEST=%LOCALAPPDATA%\Programs\AstroLab"
rem Only an AstroLab started from the install folder blocks the install (files in use). A copy that failed to start can linger
rem without a window: close it with Task Manager (Details tab, AstroLab.exe) or: taskkill /F /IM AstroLab.exe
powershell -NoProfile -Command "$d = Join-Path $env:LOCALAPPDATA 'Programs\AstroLab\'; if (Get-Process AstroLab -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) }) { exit 1 }"
if errorlevel 1 ( echo AstroLab is running. Quit it from the tray icon ^(right-click, Exit^), then run install.cmd again. & echo If it has no window or tray icon, end AstroLab.exe in Task Manager ^(Details tab^) or run: taskkill /F /IM AstroLab.exe & pause & exit /b 1 )
rem Check the package is complete before copying (an archive extracted with missing files once installed "fine" without AstroLab.exe)
if not exist "%~dp0workbench\AstroLab.exe" goto incomplete
if not exist "%~dp0tools\node\node.exe" goto incomplete
echo Checking the package ...
if exist "%~dp0app\packaging\verify-package.mjs" (
  "%~dp0tools\node\node.exe" "%~dp0app\packaging\verify-package.mjs" "%~dp0."
  if errorlevel 1 if not errorlevel 2 goto incomplete
)
echo Installing to %DEST% ...
robocopy "%~dp0." "%DEST%" /E /NFL /NDL /NJH /NP /R:1 /W:1 /XF install.cmd *.wsb
if %ERRORLEVEL% GEQ 8 ( echo Copy failed. & pause & exit /b 1 )
copy /Y "%~dp0start.cmd" "%DEST%\start.cmd" >nul
copy /Y "%~dp0check.cmd" "%DEST%\check.cmd" >nul
copy /Y "%~dp0diag.cmd" "%DEST%\diag.cmd" >nul
copy /Y "%~dp0uninstall.cmd" "%DEST%\uninstall.cmd" >nul
rem Shortcuts carry the AppUserModelID "AstroLab" and the app icon: this is what the taskbar shows
"%DEST%\workbench\AstroLab.exe" --install-shortcuts
echo Done. Start AstroLab from the Start menu or the desktop shortcut.
echo Self-check (no model calls): "%DEST%\check.cmd"   Uninstall: "%DEST%\uninstall.cmd"
pause
exit /b 0

:incomplete
echo.
echo The package is INCOMPLETE: files are missing (AstroLab.exe, Node or others). Nothing was installed.
echo Copy or extract the whole package again: use 7-Zip, extract to a short local path such as D:\AstroLab-pkg,
echo and check the folder has about 85,000 files (1.8 GB). Then run install.cmd again.
pause
exit /b 1
