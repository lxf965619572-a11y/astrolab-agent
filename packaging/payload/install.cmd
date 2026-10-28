@echo off
rem AstroLab offline install: copy this folder to %LOCALAPPDATA%\Programs\AstroLab and create Start menu / desktop shortcuts.
rem No admin rights, no network. User data (settings, tasks, libraries) lives in %LOCALAPPDATA%\AstroLab and is kept on update.
setlocal
set "DEST=%LOCALAPPDATA%\Programs\AstroLab"
tasklist /FI "IMAGENAME eq AstroLab.exe" 2>nul | find /i "AstroLab.exe" >nul && ( echo AstroLab is running. Close it first, then run install.cmd again. & pause & exit /b 1 )
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
