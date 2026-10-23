# 公共函数：被 setup.ps1 / start-web.ps1 / check.ps1 引用
$ErrorActionPreference = 'Stop'

$Script:Root     = Split-Path -Parent $PSScriptRoot           # astrolab-agent 根目录
$Script:DshDir   = Join-Path $Root 'runtime\dsh'              # DSH 安装目录
$Script:DshHome  = Join-Path $Root 'runtime\dsh-home'         # DSH 数据目录（会话、配置）
$Script:DshBin   = Join-Path $DshDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$Script:LocalEnv = Join-Path $Root 'config\local.env'
$Script:DshVersion = '0.2.1-rc.2'                              # 锁定版本，不要用 latest

function Write-Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "   [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   [X]  $msg" -ForegroundColor Red }

# 读取 config\local.env 到当前进程环境变量（空值跳过）
function Import-LocalEnv {
    if (-not (Test-Path $LocalEnv)) { return }
    foreach ($line in Get-Content -Encoding UTF8 $LocalEnv) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim().Trim('"')
        if ($v -ne '') { Set-Item -Path "Env:$k" -Value $v }
    }
}

function Get-NodeMajor {
    try { $v = (& node -v) 2>$null } catch { return $null }
    if ($v -match '^v(\d+)\.(\d+)') { return [pscustomobject]@{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Text = $v } }
    return $null
}

function Find-Cppcheck {
    if ($env:CPPCHECK_PATH -and (Test-Path $env:CPPCHECK_PATH)) { return $env:CPPCHECK_PATH }
    $cmd = Get-Command cppcheck -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($base) {
            $p = Join-Path $base 'Cppcheck\cppcheck.exe'
            if (Test-Path $p) { return $p }
        }
    }
    return $null
}
