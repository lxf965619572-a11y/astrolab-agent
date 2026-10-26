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

Write-Step '文档服务 docgen + docreader（示例任务书生成 Word 再读回）'
$docDeps = @('docreader', 'docgen') | Where-Object { -not (Test-Path (Join-Path $Root "mcp\$_\node_modules")) }
if ($docDeps) { Write-Fail "依赖未安装：mcp\$($docDeps -join '、mcp\')，运行 scripts\setup.ps1"; $bad++ }
else {
    Push-Location (Join-Path $Root 'sample')
    try { & node (Join-Path $Root 'mcp\docgen\selftest.mjs') } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { $bad++ }
}

Write-Step '单元测试服务 utest（编译运行自带的小例子）'
if (-not (Test-Path (Join-Path $Root 'mcp\utest\node_modules'))) { Write-Fail '依赖未安装，运行 scripts\setup.ps1'; $bad++ }
else {
    & node (Join-Path $Root 'mcp\utest\selftest.mjs')
    if ($LASTEXITCODE -eq 2) { Write-Warn2 '本机没有可用的 gcc：单元测试只能设计用例和写测试代码，不能编译运行。安装方法见 README“单元测试”一节' }
    elseif ($LASTEXITCODE -ne 0) { $bad++ }
}

Write-Step 'DSH 组合配置'
if (Test-Path $DshBin) {
    $env:DSH_HOME = $DshHome
    $env:DSH_TELEMETRY_DISABLED = '1'
    $dump = & node $DshBin --profile web --dump-config 2>$null | Out-String
    foreach ($id in @('mcp-cppcheck', 'mcp-docreader', 'mcp-docgen', 'mcp-utest')) {
        if ($dump -match "id: $id") { Write-Ok "已加载 $id" } else { Write-Fail "组合配置中没有 $id，重新运行 setup.ps1 或检查 runtime\dsh-home\cordis.patch.yml"; $bad++ }
    }
    # Skill：DSH 直接读取本工程的 skills 目录（customSkillDirs），不再复制
    $skillsDir = (Join-Path $Root 'skills') -replace '\\', '/'
    $i = $dump.IndexOf('id: skill-filesystem'); $blk = ''
    if ($i -ge 0) { $j = $dump.IndexOf('- id:', $i); $blk = if ($j -gt $i) { $dump.Substring($i, $j - $i) } else { $dump.Substring($i) } }
    if ($blk.Contains($skillsDir) -and $blk -notmatch 'disabled:\s*true') { Write-Ok "Skill 目录：$skillsDir" }
    else { Write-Fail "组合配置中 skill-filesystem 没有指向 $skillsDir，重新运行 setup.ps1"; $bad++ }
    foreach ($d in Get-ChildItem -Directory (Join-Path $Root 'skills')) {
        if (-not (Test-Path (Join-Path $d.FullName 'SKILL.md'))) { Write-Fail "skills\$($d.Name) 中没有 SKILL.md"; $bad++; continue }
        $stale = Join-Path $DshHome "skills\$($d.Name)"
        if (Test-Path $stale) { Write-Warn2 "Skill：$($d.Name)（runtime\dsh-home\skills 下还有以前复制的旧副本，运行一次 setup.ps1 删除）" }
        else { Write-Ok "Skill：$($d.Name)" }
    }
}

if ($bad -eq 0) { Write-Host "`n全部通过，可以运行 scripts\start-web.ps1" -ForegroundColor Green }
else { Write-Host "`n有 $bad 项未通过，按上面提示处理" -ForegroundColor Red; exit 1 }
