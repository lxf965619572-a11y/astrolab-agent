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

# 删除以前版本复制到 runtime\dsh-home\skills 的旧副本（只删工程 skills\ 中有同名目录的，DSH 自带或用户另放的不动）
function Remove-StaleSkillCopies {
    $old = Join-Path $DshHome 'skills'
    if (-not (Test-Path $old)) { return }
    foreach ($d in Get-ChildItem -Directory (Join-Path $Root 'skills')) {
        $p = Join-Path $old $d.Name
        if (Test-Path $p) { Remove-Item -Recurse -Force $p; Write-Ok "已删除旧副本 runtime\dsh-home\skills\$($d.Name)" }
    }
}

# 不往外发数据（DSH 0.2.1 默认开的上传，见 dsh-dept\试点记录-20261029.md 第 3 节）。
# 会话遥测认的是 DSH_TELEMETRY_MODE；DSH_TELEMETRY_DISABLED 它不认，留着无害。补丁里也关了（config\cordis.patch.yml.template）
function Set-DshPrivacyEnv {
    $env:DSH_TELEMETRY_MODE = 'DISABLED'
    $env:DSH_TELEMETRY_DISABLED = '1'
}

# 网页界面的产品埋点：只在 web profile 里有，追加到它自己的用户层 runtime\dsh-home\profiles\web\cordis.patch.yml。
# DSH 只在文件不存在时才生成用户层，先写好不影响它；文件里已有的内容（界面保存的设置）原样保留
function Set-WebProfilePrivacy {
    $dir = Join-Path $DshHome 'profiles\web'
    $p = Join-Path $dir 'cordis.patch.yml'
    $block = [IO.File]::ReadAllText((Join-Path $Root 'config\web-profile.patch.yml'), [Text.Encoding]::UTF8)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $cur = ''
    if (Test-Path $p) { $cur = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
    if ($cur -match '(?m)^- id: product-analytics\s*$') { return }
    $cur = ($cur -replace '(?m)^\[\]\s*$', '').TrimEnd()
    if ($cur) { $cur += "`n" }
    [IO.File]::WriteAllText($p, $cur + $block, (New-Object Text.UTF8Encoding $false))
}
