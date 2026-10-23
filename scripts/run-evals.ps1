# 运行代码走查评测（参数原样传给 evals\run.mjs）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\run-evals.ps1 [-Cases a,b] [-Repeat 1] [-Parallel 1] [-TimeoutMin 20] [-Label 备注]
param(
    [string[]]$Cases = @(),
    [int]$Repeat = 1,
    [int]$Parallel = 1,
    [int]$TimeoutMin = 20,
    [string]$Label = ''
)
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-Path $DshBin)) { Write-Fail '还没安装 DSH，请先运行 scripts\setup.ps1'; exit 1 }
Import-LocalEnv
$env:DSH_HOME = $DshHome
$env:DSH_TELEMETRY_DISABLED = '1'
if (-not $env:DEEPSEEK_BASE_URL) { Write-Warn2 '使用 DeepSeek 官方 API：评测用例为虚构代码，可以发送到云端' }

$args2 = @((Join-Path $Root 'evals\run.mjs'), '--repeat', $Repeat, '--parallel', $Parallel, '--timeout-min', $TimeoutMin)
if ($Cases.Count -gt 0) { $args2 += @('--cases', ($Cases -join ',')) }
if ($Label) { $args2 += @('--label', $Label) }
& node @args2
exit $LASTEXITCODE
