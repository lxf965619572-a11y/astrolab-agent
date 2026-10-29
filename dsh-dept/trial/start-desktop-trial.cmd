@echo off
rem AstroLab desktop trial: run the official DeepSeek Harness desktop with a separate home
rem (department profile), so the personal C:\Users\<you>\.dsh is not touched.
setlocal
set "TRIAL=%~dp0"
for %%I in ("%TRIAL%..\..") do set "REPO=%%~fI"
rem Department bundle (dsh-dept) reads skills and tool servers from the repo.
set "ASTROLAB_ROOT=%REPO%"
set "DSH_HOME=%TRIAL%home"
rem Product analytics: send nowhere (dead local port) even before the profile patch disables it.
set "DSH_PRODUCT_ANALYTICS_OTLP_URL=http://127.0.0.1:9/v1/logs"
rem Session telemetry: FEEDBACK_ONLY (the default) uploads the session log, context included, to
rem DeepSeek whenever someone rates or comments on a reply. DISABLED builds no transport at all.
set "DSH_TELEMETRY_MODE=DISABLED"
set "DSH_TELEMETRY_OTLP_URL=http://127.0.0.1:9/v1/logs"
set "DSH_TELEMETRY_DISABLED=1"
rem Department model route and tool paths: read DEPT_LLM_*, UTEST_*, CPPCHECK_* from config\local.env.
if exist "%REPO%\config\local.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%REPO%\config\local.env") do (
    echo %%A| findstr /r /b "DEPT_LLM_ UTEST_ CPPCHECK_ DEEPSEEK_API_KEY" >nul && set "%%A=%%B"
  )
)
rem Only the department route is used: map DEEPSEEK_API_KEY to DEPT_LLM_API_KEY (as AstroLab does) and
rem do not pass DEEPSEEK_API_KEY on, so the official DeepSeek route (and its session-log upload) has no key.
if not defined DEPT_LLM_API_KEY if defined DEEPSEEK_API_KEY set "DEPT_LLM_API_KEY=%DEEPSEEK_API_KEY%"
set "DEEPSEEK_API_KEY="
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%"
set "EXE=D:\Programs\DeepSeek Harness\DeepSeek Harness.exe"
if not exist "%EXE%" (
  echo DeepSeek Harness not found at %EXE%
  pause
  exit /b 1
)
start "" "%EXE%"
endlocal
