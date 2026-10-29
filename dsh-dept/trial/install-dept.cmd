@echo off
rem Install the department bundle (dsh-dept in the repo) into the trial desktop profile.
rem Quit DeepSeek Harness first (tray icon -> Quit): the desktop must not be running.
setlocal
set "TRIAL=%~dp0"
for %%I in ("%TRIAL%..\..") do set "REPO=%%~fI"
set "DSH_HOME=%TRIAL%home"
set "DSH=D:\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
if not exist "%DSH_HOME%\profiles\desktop\package.json" (
  echo Start the trial desktop once first: start-desktop-trial.cmd
  pause
  exit /b 1
)
echo Installing %REPO%\dsh-dept into %DSH_HOME%\profiles\desktop ...
call "%DSH%" plugin --profile desktop add "link:%REPO%\dsh-dept"
echo.
echo Exit code %errorlevel%. Tell Claude it is done.
pause
endlocal
