# 自检：不调用模型，检查各部件是否就绪
# 用法：powershell -ExecutionPolicy Bypass -File scripts\check.ps1
. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Continue'
$bad = 0

Write-Step 'Node.js'
$node = Get-NodeMajor
if ($node) { Write-Ok $node.Text } else { Write-Fail '未找到 node'; $bad++ }

Write-Step 'DSH'
if (Test-Path $DshBin) { Write-Ok ("dsh " + (& node $DshBin --version)) } else { Write-Fail '未安装，运行 scripts\setup.ps1'; $bad++ }

Write-Step 'PowerShell（DSH 在 Windows 上用它执行命令）'
$pwsh7 = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwsh7) { Write-Ok "PowerShell 7：$($pwsh7.Source)" }
else { Write-Warn2 '未安装 PowerShell 7，DSH 会退回 Windows PowerShell 5.1（可用，但建议安装 PowerShell 7）' }

Write-Step 'config\local.env'
Import-LocalEnv
if (-not (Test-Path $LocalEnv)) { Write-Fail '不存在，运行 scripts\setup.ps1'; $bad++ }
elseif (-not $env:DEEPSEEK_API_KEY) { Write-Fail 'DEEPSEEK_API_KEY 未填写'; $bad++ }
else { Write-Ok ('DEEPSEEK_API_KEY 已填写（' + $env:DEEPSEEK_API_KEY.Substring(0, [Math]::Min(5, $env:DEEPSEEK_API_KEY.Length)) + '…）') }

Write-Step 'Cppcheck'
$cpp = Find-Cppcheck
if ($cpp) { Write-Ok ("$cpp  " + (& $cpp --version)) } else { Write-Warn2 '未找到（走查时无法调用静态分析）' }

Write-Step 'Cppcheck MCP 服务（直接对示例代码跑一次）'
if (-not (Test-Path (Join-Path $Root 'mcp\cppcheck\node_modules'))) { Write-Fail '依赖未安装，运行 scripts\setup.ps1'; $bad++ }
elseif ($cpp) {
    $env:CPPCHECK_PATH = $cpp
    Push-Location (Join-Path $Root 'sample')
    try { & node (Join-Path $Root 'mcp\cppcheck\selftest.mjs') } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { $bad++ }
}

Write-Step 'DSH 组合配置'
if (Test-Path $DshBin) {
    $env:DSH_HOME = $DshHome
    $env:DSH_TELEMETRY_DISABLED = '1'
    $dump = & node $DshBin --profile web --dump-config 2>$null | Out-String
    if ($dump -match 'id: mcp-cppcheck') { Write-Ok '已加载 mcp-cppcheck' } else { Write-Fail '组合配置中没有 mcp-cppcheck，检查 runtime\dsh-home\cordis.patch.yml'; $bad++ }
    $skill = Join-Path $DshHome 'skills\code-walkthrough\SKILL.md'
    if (Test-Path $skill) { Write-Ok 'Skill：code-walkthrough' } else { Write-Fail '缺少 Skill，重新运行 setup.ps1'; $bad++ }
}

if ($bad -eq 0) { Write-Host "`n全部通过，可以运行 scripts\start-web.ps1" -ForegroundColor Green }
else { Write-Host "`n有 $bad 项未通过，按上面提示处理" -ForegroundColor Red; exit 1 }
