# 启动 DSH Web 界面
# 用法：powershell -ExecutionPolicy Bypass -File scripts\start-web.ps1 [-Workspace <目录>] [-Port 3080]
# 默认工作区是 sample（示例代码）。工作区就是智能体能读写的目录。
param(
    [string]$Workspace = '',
    [int]$Port = 3080
)
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-Path $DshBin)) { Write-Fail '还没安装 DSH，请先运行 scripts\setup.ps1'; exit 1 }
if (-not $Workspace) { $Workspace = Join-Path $Root 'sample' }
$Workspace = (Resolve-Path $Workspace).Path

Import-LocalEnv
$env:DSH_HOME = $DshHome
$env:DSH_TELEMETRY_DISABLED = '1'
if (-not $env:DEEPSEEK_API_KEY) { Write-Warn2 'config\local.env 中没有 DEEPSEEK_API_KEY，界面能打开但模型无法回答。' }
if ($env:DEEPSEEK_BASE_URL) { Write-Ok "模型地址：$($env:DEEPSEEK_BASE_URL)" } else { Write-Warn2 '模型地址：DeepSeek 官方 API（代码会发送到云端，只用示例代码测试）' }

Write-Host "工作区：$Workspace"
Write-Warn2 "界面打开后，先在左侧添加文件夹作为工作区并选择上面这个目录（Web 会话默认开在 文档\deepseek-harness\default-workspace）"
Write-Host '浏览器会自动打开；关闭本窗口或按 Ctrl+C 停止。' -ForegroundColor Cyan
Push-Location $Workspace
try {
    & node $DshBin --profile web --port $Port
} finally { Pop-Location }
