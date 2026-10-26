# Stage-0 technical spike runner (sdk mode). ASCII only: Windows PowerShell 5.1 reads scripts as ANSI.
# Usage:
#   powershell -ExecutionPolicy Bypass -File spike\sdk\run.ps1             run scenarios S1-S5, report in runtime\spike\report-*.md
#   powershell -ExecutionPolicy Bypass -File spike\sdk\run.ps1 -Only S2,S5  run some scenarios
#   powershell -ExecutionPolicy Bypass -File spike\sdk\run.ps1 -Mode ui     minimal UI at http://127.0.0.1:3090
param(
    [ValidateSet('scenarios', 'ui')][string]$Mode = 'scenarios',
    [string]$Only = ''
)
. (Join-Path $PSScriptRoot '..\..\scripts\common.ps1')
$ErrorActionPreference = 'Continue'
if (-not (Test-Path $DshBin)) { Write-Host 'DSH is not installed. Run scripts\setup.ps1 first.'; exit 1 }
Import-LocalEnv
$env:DSH_HOME = $DshHome
$env:DSH_TELEMETRY_DISABLED = '1'
if (-not $env:DEPT_LLM_API_KEY -and $env:DEEPSEEK_API_KEY) { $env:DEPT_LLM_API_KEY = $env:DEEPSEEK_API_KEY }
$name = 'scenarios.mjs'
if ($Mode -eq 'ui') { $name = 'server.mjs' }
$nodeArgs = @((Join-Path $PSScriptRoot $name))
if ($Only) { $nodeArgs += @('--only', $Only) }
if ($Mode -eq 'ui') { Start-Process 'http://127.0.0.1:3090' }
& node @nodeArgs
