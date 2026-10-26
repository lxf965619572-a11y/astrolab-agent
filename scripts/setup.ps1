# 一次性安装：DSH（锁定版本）+ Cppcheck MCP 服务依赖 + 部门配置
# 用法：在 astrolab-agent 目录下执行   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# 可选参数：-Registry https://registry.npmmirror.com   （国内镜像，官方源慢时使用）
param(
    [string]$Registry = ''
)
. (Join-Path $PSScriptRoot 'common.ps1')

$npmArgs = @('--no-audit', '--no-fund', '--loglevel=error')
if ($Registry) { $npmArgs += "--registry=$Registry" }

Write-Step '检查 Node.js'
$node = Get-NodeMajor
if (-not $node) { Write-Fail '未找到 node。请安装 Node.js 24 LTS 后重试。'; exit 1 }
if ($node.Major -lt 22 -or ($node.Major -eq 22 -and $node.Minor -lt 19) -or $node.Major -eq 23) {
    Write-Fail "Node.js 版本 $($node.Text) 不满足要求（需 22.19+ 或 24+）。"; exit 1
}
Write-Ok "Node.js $($node.Text)"

Write-Step "安装 DSH $DshVersion 到 runtime\dsh（约 300 个包，首次需要几分钟）"
New-Item -ItemType Directory -Force -Path $DshDir | Out-Null
$pkg = Join-Path $DshDir 'package.json'
if (-not (Test-Path $pkg)) {
    '{ "name": "dept-dsh-runtime", "private": true }' | Set-Content -Encoding UTF8 $pkg
}
Push-Location $DshDir
try {
    & npm install --save-exact @npmArgs "@deepseek-ai/dsh@$DshVersion"
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败（退出码 $LASTEXITCODE）" }
} finally { Pop-Location }
$ver = & node $DshBin --version
if ($ver.Trim() -ne $DshVersion) { Write-Fail "安装后的版本是 $ver，期望 $DshVersion"; exit 1 }
Write-Ok "dsh $ver"

Write-Step '安装 MCP 服务依赖（cppcheck、docreader、docgen、utest）'
foreach ($svc in @('cppcheck', 'docreader', 'docgen', 'utest')) {
    Push-Location (Join-Path $Root "mcp\$svc")
    try {
        & npm install @npmArgs
        if ($LASTEXITCODE -ne 0) { throw "mcp\$svc 的 npm install 失败（退出码 $LASTEXITCODE）" }
    } finally { Pop-Location }
    Write-Ok "mcp\$svc"
}
if (-not (Test-Path (Join-Path $Root 'mcp\docreader\node_modules\pdfjs-dist'))) {
    Write-Warn2 'PDF 解析组件 pdfjs-dist 未装上（可选依赖），读 PDF 会提示错误；Word/Excel 不受影响'
}

Write-Step '写入部门配置到 runtime\dsh-home'
New-Item -ItemType Directory -Force -Path $DshHome | Out-Null
# 模板中的 __STARTER_DIR__ 换成本目录（统一用正斜杠，YAML 中无需转义）
$rootFwd = $Root -replace '\\', '/'
$tpl = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'config\cordis.patch.yml.template')
[IO.File]::WriteAllText((Join-Path $DshHome 'cordis.patch.yml'), $tpl.Replace('__STARTER_DIR__', $rootFwd), (New-Object Text.UTF8Encoding $false))
Write-Ok 'cordis.patch.yml（注册 cppcheck、docreader、docgen、utest 四个 MCP 服务；Skill 目录指向本工程的 skills）'
# 部门 Skills：DSH 通过 cordis.patch.yml 中的 customSkillDirs 直接读取本工程的 skills 目录，不再复制。
# 以前版本复制到 runtime\dsh-home\skills 的旧副本会和工程中的同名 Skill 重复，这里删除（只删工程中有同名目录的）。
Remove-StaleSkillCopies
Write-Ok "skills（直接读取 skills\）：$((Get-ChildItem -Directory (Join-Path $Root 'skills')).Name -join ', ')"

if (-not (Test-Path $LocalEnv)) {
    Copy-Item (Join-Path $Root 'config\local.env.example') $LocalEnv
    Write-Warn2 '已生成 config\local.env，请打开它填写 DEEPSEEK_API_KEY'
} else {
    Write-Ok 'config\local.env 已存在，保留不动'
}

Write-Step 'Cppcheck'
Import-LocalEnv
$cpp = Find-Cppcheck
if ($cpp) { Write-Ok "找到 $cpp" }
else { Write-Warn2 '未找到 Cppcheck。请安装（https://cppcheck.sourceforge.io/）或在 config\local.env 填写 CPPCHECK_PATH。不装也能启动，只是走查时无法调用静态分析。' }

Write-Host "`n安装完成。下一步：填好 config\local.env 后运行  scripts\check.ps1  自检，再运行  scripts\start-web.ps1" -ForegroundColor Cyan
