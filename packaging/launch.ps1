# AstroLab launcher (stage-0 offline package prototype). ASCII only: Windows PowerShell 5.1 reads scripts as ANSI.
# Layout:  <install>\app\...   (config, mcp, skills, sample, spike, packaging, runtime\dsh)
#          <install>\tools\... (node, ucrt64 = GCC, cppcheck, git optional)
# User data lives in %LOCALAPPDATA%\AstroLab (settings, DSH home, sessions, workspace, reports), so updates never touch it.
# Usage: powershell -ExecutionPolicy Bypass -File app\packaging\launch.ps1 [-Action ui|check|diag]
param([ValidateSet('ui', 'check', 'diag')][string]$Action = 'ui')
$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
$Base = Split-Path -Parent $App
$Tools = Join-Path $Base 'tools'
$Data = Join-Path $env:LOCALAPPDATA 'AstroLab'
$node = Join-Path $Tools 'node\node.exe'
if (-not (Test-Path $node)) { Write-Host "Missing $node - the package is incomplete."; exit 1 }

$env:PATH = (@("$Tools\node", "$Tools\ucrt64\bin", "$Tools\cppcheck", "$Tools\git\cmd") -join ';') + ';' + $env:PATH
$env:ASTROLAB_HOME = $Base
$env:ASTROLAB_DATA = $Data
$env:DSH_HOME = Join-Path $Data 'dsh-home'
$env:DSH_TELEMETRY_DISABLED = '1'
New-Item -ItemType Directory -Force -Path $env:DSH_HOME | Out-Null

# Settings: %LOCALAPPDATA%\AstroLab\local.env (created from the example on first run)
$envFile = Join-Path $Data 'local.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $App 'config\local.env.example') $envFile }
foreach ($line in [IO.File]::ReadAllLines($envFile)) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim(); $v = $t.Substring($i + 1).Trim().Trim('"')
    if ($v -ne '') { Set-Item -Path "Env:$k" -Value $v }
}
if (-not $env:UTEST_CC -and (Test-Path "$Tools\ucrt64\bin\gcc.exe")) { $env:UTEST_CC = "$Tools\ucrt64\bin\gcc.exe" }
if (-not $env:CPPCHECK_PATH -and (Test-Path "$Tools\cppcheck\cppcheck.exe")) { $env:CPPCHECK_PATH = "$Tools\cppcheck\cppcheck.exe" }
if (-not $env:DEPT_LLM_API_KEY -and $env:DEEPSEEK_API_KEY) { $env:DEPT_LLM_API_KEY = $env:DEEPSEEK_API_KEY }

# DSH home patch, regenerated every start from the template (paths point into this install)
$tpl = [IO.File]::ReadAllText((Join-Path $App 'config\cordis.patch.yml.template'), [Text.Encoding]::UTF8)
[IO.File]::WriteAllText((Join-Path $env:DSH_HOME 'cordis.patch.yml'), $tpl.Replace('__STARTER_DIR__', ($App -replace '\\', '/')), (New-Object Text.UTF8Encoding $false))

# Workspace: a writable copy of the samples; prepare folder permissions once (requirement FR-PRJ-05)
$ws = Join-Path $Data 'workspace\sample'
if (-not (Test-Path $ws)) { Copy-Item -Recurse (Join-Path $App 'sample') $ws }
$mark = Join-Path $ws '.astrolab-acl-ok'
if (-not (Test-Path $mark)) {
    & icacls $ws /grant "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" /Q | Out-Null
    $fix = Join-Path $App 'runtime\dsh\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\assets\diagnose-windows-sandbox-acl\scripts\diagnose-windows-sandbox-acl.ps1'
    $ps = 'powershell'; if (Get-Command pwsh -ErrorAction SilentlyContinue) { $ps = 'pwsh' }
    & $ps -NoProfile -ExecutionPolicy Bypass -File $fix -Path $ws -AllowRoot $ws -Out (Join-Path $Data 'acl-recovery') | Out-Null
    if ($LASTEXITCODE -eq 0) { Set-Content -Path $mark -Value (Get-Date -Format s) }
}
$env:SPIKE_WORKSPACE = $ws
$env:SPIKE_LOGDIR = Join-Path $Data 'logs'

if ($Action -eq 'diag') {
    & $node (Join-Path $App 'packaging\diag-startup.mjs')
    exit $LASTEXITCODE
}
if ($Action -eq 'check') {
    & $node (Join-Path $App 'packaging\selfcheck.mjs')
    $code = $LASTEXITCODE
    # In Windows Sandbox a writable Desktop\results folder is mapped to the host: copy the report out
    $res = Join-Path $env:USERPROFILE 'Desktop\results'
    if (Test-Path $res) { Copy-Item (Join-Path $Data 'check-report-*.md'), (Join-Path $Data 'selfcheck-engine.jsonl') $res -Force -ErrorAction SilentlyContinue }
    exit $code
}
Start-Process 'http://127.0.0.1:3090'
& $node (Join-Path $App 'spike\sdk\server.mjs')
