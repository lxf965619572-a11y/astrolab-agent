# Build the offline package on this (online) machine: stage-2 workbench (AstroLab.exe) + engine + tools. ASCII only (PowerShell 5.1).
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File packaging\build-offline.ps1 [-Out <dir>, default runtime\dist] [-Ucrt64 C:\msys64\ucrt64] [-Cppcheck <dir>] [-IncludeGit]
# Result: <Out>\AstroLab (the package) and two Windows Sandbox files: sandbox-offline.wsb, sandbox-online.wsb
param(
    [string]$Out = '',
    [string]$Ucrt64 = 'C:\msys64\ucrt64',
    [string]$Cppcheck = '',
    [switch]$IncludeGit
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $Root 'runtime\dist' }   # runtime\ is git-ignored
$Dist = Join-Path $Out 'AstroLab'
$log = New-Object System.Collections.Generic.List[string]
function Say($m) { Write-Host $m; $log.Add($m) }
function Robo($src, $dst, [string[]]$extra) {
    & robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 /MT:8 @extra | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $src" }
}
function SizeMB($p) {
    if (-not (Test-Path $p)) { return 0 }
    $s = (Get-ChildItem -Recurse -Force -File $p -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum
    return [Math]::Round($s / 1MB, 1)
}

if (Test-Path $Dist) { Say "Removing old $Dist"; Remove-Item -Recurse -Force $Dist }
New-Item -ItemType Directory -Force -Path (Join-Path $Dist 'app'), (Join-Path $Dist 'tools') | Out-Null

# 1. App files: tracked or new-but-not-ignored files (no local.env, no runtime data, no agent outputs)
Say '1/7 App files (git ls-files)'
$old = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$list = & git -C $Root -c core.quotepath=false ls-files --cached --others --exclude-standard -- config mcp skills sample spike evals packaging scripts README.md
[Console]::OutputEncoding = $old
$n = 0
foreach ($f in $list) {
    $src = Join-Path $Root $f
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
    $dst = Join-Path (Join-Path $Dist 'app') $f
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::Copy($src, $dst, $true); $n++
}
Say "   $n files"

# 2. Workbench (stage 2, Electron): build the UI, copy the app code, turn electron.exe into AstroLab.exe with our icon.
#    Layout: workbench\AstroLab.exe (+ Electron runtime), workbench\resources\app\package.json points at app\app\main\main.mjs.
#    The taskbar icon comes from the Start menu shortcut the app writes itself (AppUserModelID AstroLab + build\icon.ico);
#    rcedit additionally sets the icon and version info of the exe (Explorer, Task Manager, Alt+Tab before the shortcut exists).
Say '2/7 Workbench (AstroLab.exe)'
$AppSrc = Join-Path $Root 'app'
$electronDist = Join-Path $AppSrc 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) { throw "Missing $electronDist\electron.exe - run 'npm install' in app\ first" }
Push-Location $AppSrc
try {
    $o = & npm run build 2>&1
    foreach ($x in $o) { $log.Add("   $x") }
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed: $($o -join ' ')" }
} finally { Pop-Location }
$AppDst = Join-Path $Dist 'app\app'
foreach ($d in @('main', 'engine', 'dist', 'build', 'git-hooks')) { Robo (Join-Path $AppSrc $d) (Join-Path $AppDst $d) @() }
Copy-Item (Join-Path $AppSrc 'package.json') $AppDst
$Wb = Join-Path $Dist 'workbench'
Robo $electronDist $Wb @()
Move-Item (Join-Path $Wb 'electron.exe') (Join-Path $Wb 'AstroLab.exe')
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Wb 'resources\default_app.asar')
New-Item -ItemType Directory -Force -Path (Join-Path $Wb 'resources\app') | Out-Null
$ver = (Get-Content (Join-Path $AppSrc 'package.json') -Raw | ConvertFrom-Json).version
$pkg = '{ "name": "astrolab", "productName": "AstroLab", "version": "' + $ver + '", "type": "module", "main": "../../../app/app/main/main.mjs" }'
[IO.File]::WriteAllText((Join-Path $Wb 'resources\app\package.json'), $pkg, (New-Object Text.UTF8Encoding $false))
$rcdir = Join-Path $Root 'runtime\build-tools'
$rcedit = Join-Path $rcdir 'node_modules\rcedit\bin\rcedit-x64.exe'
if (-not (Test-Path $rcedit)) {
    Say '   fetching rcedit 4.0.1 (build machine only, not shipped)'
    & npm install --no-save --no-audit --no-fund --prefix $rcdir rcedit@4.0.1 2>&1 | Out-Null
}
if (Test-Path $rcedit) {
    & $rcedit (Join-Path $Wb 'AstroLab.exe') --set-icon (Join-Path $AppSrc 'build\icon.ico') --set-file-version $ver --set-product-version $ver `
        --set-version-string ProductName AstroLab --set-version-string FileDescription AstroLab --set-version-string CompanyName AstroLab `
        --set-version-string InternalName AstroLab --set-version-string OriginalFilename AstroLab.exe
    if ($LASTEXITCODE -eq 0) { Say "   AstroLab.exe: icon and version $ver set" }
    else { Say "   WARNING: rcedit failed ($LASTEXITCODE) - the exe keeps the Electron icon; the taskbar still uses the shortcut icon" }
} else { Say '   WARNING: rcedit not available (no npm access?) - the exe keeps the Electron icon; the taskbar still uses the shortcut icon' }
Say "   workbench $(SizeMB $Wb) MB, app code $(SizeMB $AppDst) MB"

# 3. Node modules of the tool services
Say '3/7 Tool service dependencies'
foreach ($svc in @('cppcheck', 'docreader', 'docgen', 'utest')) {
    $nm = Join-Path $Root "mcp\$svc\node_modules"
    if (Test-Path $nm) { Robo $nm (Join-Path $Dist "app\mcp\$svc\node_modules") @() } else { Say "   WARNING: missing $nm (run scripts\setup.ps1)" }
}

# 4. DSH (pinned version, as installed by setup.ps1)
Say '4/7 DSH runtime'
Robo (Join-Path $Root 'runtime\dsh') (Join-Path $Dist 'app\runtime\dsh') @()

# 5. Node.js
Say '5/7 Node.js'
$nodeExe = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path (Join-Path $Dist 'tools\node') | Out-Null
Copy-Item $nodeExe (Join-Path $Dist 'tools\node\node.exe')
Say "   $nodeExe ($(& node -v))"

# 6. GCC (MSYS2 UCRT64), Cppcheck, optional Git
Say '6/7 GCC, Cppcheck, Git'
if (Test-Path (Join-Path $Ucrt64 'bin\gcc.exe')) {
    Robo $Ucrt64 (Join-Path $Dist 'tools\ucrt64') @('/XD', 'doc', 'man', 'info', 'locale', 'gtk-doc', 'help')
    Say "   GCC from $Ucrt64"
} else { Say "   WARNING: no gcc.exe under $Ucrt64 - unit tests will not compile" }
if (-not $Cppcheck) {
    $c = Get-Command cppcheck -ErrorAction SilentlyContinue
    if ($c) { $Cppcheck = Split-Path -Parent $c.Source } elseif (Test-Path "$env:ProgramFiles\Cppcheck\cppcheck.exe") { $Cppcheck = "$env:ProgramFiles\Cppcheck" }
}
if ($Cppcheck -and (Test-Path (Join-Path $Cppcheck 'cppcheck.exe'))) {
    Robo $Cppcheck (Join-Path $Dist 'tools\cppcheck') @()
    Say "   Cppcheck from $Cppcheck"
    # cppcheck.exe needs the Visual C++ runtime, which a clean Windows does not have (sandbox test: exit 0xC0000135 DLL not found).
    # Deploy the runtime DLLs next to the exe (app-local deployment), so no VC++ Redistributable install is needed.
    $vc = @('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'concrt140.dll')
    $copied = @()
    foreach ($d in $vc) {
        $src = Join-Path $env:WINDIR "System32\$d"
        if ((Test-Path $src) -and -not (Test-Path (Join-Path $Dist "tools\cppcheck\$d"))) { Copy-Item $src (Join-Path $Dist 'tools\cppcheck'); $copied += $d }
    }
    Say "   VC++ runtime DLLs added: $($copied -join ', ')"
}
else { Say '   WARNING: Cppcheck not found - code review will run without static analysis' }
if ($IncludeGit) {
    $g = Get-Command git -ErrorAction SilentlyContinue
    if ($g) { $gitRoot = Split-Path -Parent (Split-Path -Parent $g.Source); Robo $gitRoot (Join-Path $Dist 'tools\git') @(); Say "   Git from $gitRoot" }
}

# 7. Launchers and sandbox files
Say '7/7 Launchers, sandbox files'
Copy-Item (Join-Path $PSScriptRoot 'payload\*.cmd') $Dist
$results = Join-Path $Out 'results'
New-Item -ItemType Directory -Force -Path $results | Out-Null
foreach ($kind in @('offline', 'online')) {
    $net = 'Disable'; if ($kind -eq 'online') { $net = 'Default' }
    $wsb = @"
<Configuration>
  <Networking>$net</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$Dist</HostFolder>
      <SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\AstroLab</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$results</HostFolder>
      <SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\results</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
</Configuration>
"@
    [IO.File]::WriteAllText((Join-Path $Out "sandbox-$kind.wsb"), $wsb, (New-Object Text.UTF8Encoding $false))
}

$parts = [ordered]@{
    'app (skills, tools, samples)' = SizeMB (Join-Path $Dist 'app') ; 'app\runtime\dsh' = SizeMB (Join-Path $Dist 'app\runtime\dsh')
    'tools\node' = SizeMB (Join-Path $Dist 'tools\node'); 'tools\ucrt64 (GCC)' = SizeMB (Join-Path $Dist 'tools\ucrt64')
    'tools\cppcheck' = SizeMB (Join-Path $Dist 'tools\cppcheck'); 'tools\git' = SizeMB (Join-Path $Dist 'tools\git')
    'workbench (AstroLab.exe)' = SizeMB (Join-Path $Dist 'workbench')
}
$total = SizeMB $Dist
Say ''
Say 'Sizes (MB):'
foreach ($k in $parts.Keys) { Say ("   {0,-30} {1,8}" -f $k, $parts[$k]) }
Say ("   {0,-30} {1,8}" -f 'TOTAL', $total)
$commit = (& git -C $Root rev-parse --short HEAD)
Say "Built from commit $commit at $(Get-Date -Format s)"
[IO.File]::WriteAllLines((Join-Path $Dist 'manifest.txt'), $log)
[IO.File]::WriteAllLines((Join-Path $results 'build.log'), $log)
Say "Package: $Dist"
Say "Sandbox: double-click $Out\sandbox-offline.wsb, then run Desktop\AstroLab\install.cmd; start AstroLab from the Start menu or desktop"
