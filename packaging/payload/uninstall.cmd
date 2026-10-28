@echo off
rem Uninstall AstroLab: remove the shortcuts and %LOCALAPPDATA%\Programs\AstroLab.
rem Your settings, tasks and libraries in %LOCALAPPDATA%\AstroLab are kept (delete that folder yourself to remove them too).
setlocal
set "DEST=%LOCALAPPDATA%\Programs\AstroLab"
rem Run from a temporary copy, so the program folder (where this script lives) can be removed
if /i not "%~f0"=="%TEMP%\astrolab-uninstall.cmd" ( copy /Y "%~f0" "%TEMP%\astrolab-uninstall.cmd" >nul & "%TEMP%\astrolab-uninstall.cmd" & exit /b )
tasklist /FI "IMAGENAME eq AstroLab.exe" 2>nul | find /i "AstroLab.exe" >nul && ( echo AstroLab is running. Close it first. & pause & exit /b 1 )
if exist "%DEST%\workbench\AstroLab.exe" "%DEST%\workbench\AstroLab.exe" --remove-shortcuts
if exist "%DEST%" rmdir /s /q "%DEST%"
echo Removed %DEST%.
echo Kept your data in %LOCALAPPDATA%\AstroLab.
pause
