@echo off
rem AstroLab offline install (prototype): copy this folder to %LOCALAPPDATA%\Programs\AstroLab. No admin rights, no network.
setlocal
set "DEST=%LOCALAPPDATA%\Programs\AstroLab"
echo Installing to %DEST% ...
robocopy "%~dp0." "%DEST%" /E /NFL /NDL /NJH /NP /R:1 /W:1 /XF install.cmd *.wsb
if %ERRORLEVEL% GEQ 8 ( echo Copy failed. & pause & exit /b 1 )
copy /Y "%~dp0start.cmd" "%DEST%\start.cmd" >nul
copy /Y "%~dp0check.cmd" "%DEST%\check.cmd" >nul
copy /Y "%~dp0diag.cmd" "%DEST%\diag.cmd" >nul
echo Done. Run "%DEST%\check.cmd" for the self-check, "%DEST%\start.cmd" to start.
pause
