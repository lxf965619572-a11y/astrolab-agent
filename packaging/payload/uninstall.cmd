@echo off
rem Uninstall AstroLab: remove the shortcuts and %LOCALAPPDATA%\Programs\AstroLab.
rem Asks whether to also delete your data in %LOCALAPPDATA%\AstroLab (settings, tasks, libraries); default is to keep it.
setlocal
set "DEST=%LOCALAPPDATA%\Programs\AstroLab"
rem Run from a temporary copy, so the program folder (where this script lives) can be removed
if /i not "%~f0"=="%TEMP%\astrolab-uninstall.cmd" ( copy /Y "%~f0" "%TEMP%\astrolab-uninstall.cmd" >nul & "%TEMP%\astrolab-uninstall.cmd" & exit /b )
tasklist /FI "IMAGENAME eq AstroLab.exe" 2>nul | find /i "AstroLab.exe" >nul && ( echo AstroLab is running. Close it first. & pause & exit /b 1 )
if exist "%DEST%\workbench\AstroLab.exe" "%DEST%\workbench\AstroLab.exe" --remove-shortcuts
if exist "%DEST%" rmdir /s /q "%DEST%"
echo Removed %DEST%.
set "DATA=%LOCALAPPDATA%\AstroLab"
if not exist "%DATA%" goto done
echo.
echo Your data is in %DATA%: settings (local.env), task history, workspace copies, skill and knowledge libraries.
choice /C KD /N /M "Keep it [K] or delete it [D]? "
if errorlevel 2 ( rmdir /s /q "%DATA%" & echo Deleted %DATA%. & goto done )
if exist "%DATA%\update" rmdir /s /q "%DATA%\update"
echo Kept your data in %DATA%.
:done
pause
