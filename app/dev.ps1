# AstroLab workbench, stage-2 development launcher. ASCII only: Windows PowerShell 5.1 reads scripts as ANSI.
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File app\dev.ps1            install if needed, build the UI, start the workbench (real engine)
#   powershell -ExecutionPolicy Bypass -File app\dev.ps1 -Mock      same, with the mock engine (no model calls)
#   powershell -ExecutionPolicy Bypass -File app\dev.ps1 -Install   force npm install first
#   powershell -ExecutionPolicy Bypass -File app\dev.ps1 -Mirror    download Electron from npmmirror if GitHub is slow
# The workbench reads config\local.env itself (model address and key, compilers).
# During development all user data goes to runtime\app-data (git-ignored, never uploaded): project list, task records,
# DSH sessions, the sample workspace copy, logs\main.log. The installed product uses %LOCALAPPDATA%\AstroLab instead.
# Launcher output: runtime\app-dev.log
param([switch]$Mock, [switch]$Install, [switch]$Mirror)
$ErrorActionPreference = 'Stop'
$App = $PSScriptRoot
$Root = Split-Path -Parent $App
$Log = Join-Path $Root 'runtime\app-dev.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Log) | Out-Null
Set-Content -Path $Log -Value "=== start $(Get-Date -Format s)" -Encoding UTF8
# Node prints UTF-8; read it as UTF-8 (not the console code page) and without color codes
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:FORCE_COLOR = '0'
$env:NO_COLOR = '1'
if (-not $env:ASTROLAB_DATA) { $env:ASTROLAB_DATA = Join-Path $Root 'runtime\app-data' }

function Write-Log([string]$s) { Add-Content -Path $Log -Value $s -Encoding UTF8 }
function Step([string]$msg) { Write-Host "`n== $msg" -ForegroundColor Cyan; Write-Log "== $msg" }

# Native tools (npm, node, electron) print warnings on stderr. Under ErrorActionPreference=Stop,
# Windows PowerShell 5.1 turns those lines into exceptions, so run them with Continue and log every line.
function Invoke-Native([string]$exe, [string[]]$argv) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $exe @argv 2>&1 | ForEach-Object {
            $s = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
            if ($s -and $s -ne 'System.Management.Automation.RemoteException') { Write-Host $s; Write-Log $s }
        }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
}

$npm = 'npm.cmd'
if (-not (Get-Command $npm -ErrorAction SilentlyContinue)) { $npm = 'npm' }

Push-Location $App
try {
    $exe = Join-Path $App 'node_modules\electron\dist\electron.exe'
    if ($Install -or -not (Test-Path (Join-Path $App 'node_modules\vite'))) {
        Step 'npm install (first run downloads Electron, about 100 MB)'
        if ($Mirror) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
        $code = Invoke-Native $npm @('install', '--no-audit', '--no-fund')
        if ($code -ne 0) { throw "npm install failed (exit $code)" }
    }
    if (-not (Test-Path $exe)) {
        Step 'download Electron'
        if ($Mirror) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
        $code = Invoke-Native 'node' @((Join-Path $App 'node_modules\electron\install.js'))
        if (-not (Test-Path $exe)) { throw "Electron was not downloaded (exit $code). Try: app\dev.ps1 -Mirror" }
    }
    Step 'build the UI'
    $code = Invoke-Native $npm @('run', 'build')
    if ($code -ne 0) { throw "build failed (exit $code)" }
    if ($Mock) { $env:ASTROLAB_MOCK_ENGINE = '1' } else { Remove-Item Env:ASTROLAB_MOCK_ENGINE -ErrorAction SilentlyContinue }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $label = 'start the workbench'
    if ($Mock) { $label += ' (mock engine)' }
    Step $label
    Write-Log "data: $env:ASTROLAB_DATA"
    $code = Invoke-Native $exe @($App)
    Write-Log "workbench exited ($code)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    Pop-Location
}
