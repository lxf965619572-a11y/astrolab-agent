#!/usr/bin/env bash
# 打 Linux（银河麒麟桌面 V10/V11 等）离线安装包：工作台（Electron）+ 引擎（DSH）+ 工具服务 + Node.js，可选带离线的系统软件包。
# 在一台能上网（或能访问内网 npm 镜像）的 Linux 电脑上运行，x86_64 电脑也能打 aarch64 的包（只下载对应平台的预编译文件，不编译）。
#
# 用法（仓库根目录）：
#   bash packaging/linux/build-offline-linux.sh [--arch x64|arm64] [--out runtime/dist] [--node-version 22.20.0]
#        [--node-tar 文件] [--electron-zip 文件] [--debs 目录] [--update-dir /mnt/astrolab/release-kylin-arm64] [--registry URL]
#   --arch          目标 CPU：x64（海光、兆芯、Intel/AMD）或 arm64（飞腾、鲲鹏）；默认本机。龙芯（loongarch64）没有 Electron 和 DSH 的预编译包，不支持
#   --node-tar      离线时自带的 node-v<版本>-linux-<arch>.tar.xz；不给就从 NODE_MIRROR（默认 https://nodejs.org/dist）下载
#   --electron-zip  离线时自带的 electron-v<版本>-linux-<arch>.zip；不给就按 ELECTRON_MIRROR 下载（国内可设 https://npmmirror.com/mirrors/electron/）
#   --debs          collect-debs.sh 收集的离线软件包目录（gcc、cppcheck、git、bubblewrap 及依赖），原样放进安装包的 debs/
#   --update-dir    部门发布新版本的位置，写进 app/config/update.json（每种平台一个位置，不要和 Windows 的混用）
#   --registry      npm 源（例如 https://registry.npmmirror.com）
#   --protect       源码保护：主进程和工具服务编成 V8 字节码，桥/围栏/更新器压缩，包里不留可读源码（见 packaging/麒麟部署说明.md）
# 结果：<out>/AstroLab-linux-<arch>/（安装包目录）和 <out>/AstroLab-<版本>-linux-<arch>.tar.gz
# 发布更新：node packaging/release.mjs publish <out>/AstroLab-linux-<arch> <更新位置> --notes "..."
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
case "$(uname -m)" in aarch64|arm64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) ARCH="$(uname -m)" ;; esac
OUT="$ROOT/runtime/dist"; NODE_VERSION="$(node -p 'process.versions.node')"; NODE_TAR=""; ELECTRON_ZIP=""; DEBS=""; UPDATE_DIR=""; REGISTRY=""; PROTECT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --node-version) NODE_VERSION="$2"; shift 2 ;;
    --node-tar) NODE_TAR="$2"; shift 2 ;;
    --electron-zip) ELECTRON_ZIP="$2"; shift 2 ;;
    --debs) DEBS="$2"; shift 2 ;;
    --update-dir) UPDATE_DIR="$2"; shift 2 ;;
    --protect) PROTECT=1; shift ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$1"; exit 2 ;;
  esac
done
case "$ARCH" in x64|arm64) ;; *) echo "不支持的 CPU：$ARCH（只支持 x64、arm64）"; exit 2 ;; esac
for c in node npm git tar unzip xz; do command -v "$c" >/dev/null || { echo "缺少 $c"; exit 2; }; done
NPMARGS=(--no-audit --no-fund --loglevel=error --os=linux --cpu="$ARCH" --libc=glibc)
[ -n "$REGISTRY" ] && NPMARGS+=(--registry="$REGISTRY")

DIST="$OUT/AstroLab-linux-$ARCH"
LOG="$OUT/build-linux-$ARCH.log"
mkdir -p "$OUT"; : > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
size() { du -sm "$1" 2>/dev/null | cut -f1; }
rm -rf "$DIST"; mkdir -p "$DIST/app" "$DIST/tools"
VERSION="$(node -p "require('$ROOT/app/package.json').version")"
ELECTRON_VERSION="$(node -p "require('$ROOT/app/package.json').devDependencies.electron")"
DSH_VERSION="$(node -p "require('$ROOT/config/dsh.json').version")"
say "AstroLab $VERSION → linux-$ARCH（Electron $ELECTRON_VERSION，DSH $DSH_VERSION，Node $NODE_VERSION）"

# 1 程序文件：Git 管理的（含新加未忽略的），不含 local.env、runtime 数据
say '1/7 程序文件（git ls-files）'
n=0
while IFS= read -r -d '' f; do
  [ -f "$ROOT/$f" ] || continue
  mkdir -p "$DIST/app/$(dirname "$f")"; cp -p "$ROOT/$f" "$DIST/app/$f"; n=$((n + 1))
done < <(git -C "$ROOT" -c core.quotepath=false ls-files -z --cached --others --exclude-standard -- config mcp skills sample spike evals packaging scripts README.md)
rm -f "$DIST/app/config/local.env"
say "   $n 个文件"
[ -n "$UPDATE_DIR" ] && printf '{ "dir": %s }\n' "$(node -p "JSON.stringify(process.argv[1])" "$UPDATE_DIR")" > "$DIST/app/config/update.json" && say "   更新位置：$UPDATE_DIR"

# 2 工作台：编译界面，复制程序代码；Electron 换名 AstroLab，resources/app/package.json 指向 app/app/main/main.mjs（和 Windows 一样只有一份代码）
say '2/7 工作台（Electron）'
( cd "$ROOT/app" && [ -d node_modules/vite ] || ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=error ${REGISTRY:+--registry=$REGISTRY} ) >>"$LOG" 2>&1
( cd "$ROOT/app" && npm run build ) >>"$LOG" 2>&1 || { say '界面编译失败，见日志'; exit 1; }
mkdir -p "$DIST/app/app"
for d in main engine dist build git-hooks; do cp -a "$ROOT/app/$d" "$DIST/app/app/"; done
cp "$ROOT/app/package.json" "$DIST/app/app/"
if [ -z "$ELECTRON_ZIP" ]; then
  ELECTRON_ZIP="$(cd "$ROOT/app" && node --input-type=module -e "
    const { downloadArtifact } = await import('@electron/get')
    console.log(await downloadArtifact({ version: process.argv[1], platform: 'linux', arch: process.argv[2], artifactName: 'electron' }))" "$ELECTRON_VERSION" "$ARCH")"
fi
[ -f "$ELECTRON_ZIP" ] || { say "没有 Electron 压缩包：$ELECTRON_ZIP"; exit 1; }
WB="$DIST/workbench"; mkdir -p "$WB"
unzip -q -o "$ELECTRON_ZIP" -d "$WB"
mv "$WB/electron" "$WB/AstroLab"
rm -f "$WB/resources/default_app.asar"
mkdir -p "$WB/resources/app"
printf '{ "name": "astrolab", "productName": "AstroLab", "version": "%s", "type": "module", "main": "../../../app/app/main/main.mjs" }\n' "$VERSION" > "$WB/resources/app/package.json"
say "   workbench $(size "$WB") MB（$(basename "$ELECTRON_ZIP")）"

# 3 工具服务的依赖：按目标平台重新安装（docreader 的 PDF 渲染带平台相关的预编译库）
say '3/7 工具服务依赖'
for svc in cppcheck docreader docgen utest; do
  [ -f "$DIST/app/mcp/$svc/package.json" ] || continue
  ( cd "$DIST/app/mcp/$svc" && npm install --omit=dev "${NPMARGS[@]}" ) >>"$LOG" 2>&1 || { say "   mcp/$svc 安装失败，见日志"; exit 1; }
done

# 4 DSH：锁定的版本（config/dsh.json），按目标平台安装（Landlock 启动器等预编译包）
say '4/7 DSH'
mkdir -p "$DIST/app/runtime/dsh"
echo '{ "name": "dept-dsh-runtime", "private": true }' > "$DIST/app/runtime/dsh/package.json"
( cd "$DIST/app/runtime/dsh" && npm install --save-exact "${NPMARGS[@]}" "@deepseek-ai/dsh@$DSH_VERSION" ) >>"$LOG" 2>&1 || { say '   DSH 安装失败，见日志'; exit 1; }
[ -d "$DIST/app/runtime/dsh/node_modules/@deepseek-ai/node-addon-system-linux-$ARCH" ] && say "   含 node-addon-system-linux-$ARCH（Landlock 启动器）" || say "   注意：没有 node-addon-system-linux-$ARCH，命令沙箱只能用 bubblewrap"

# 5 Node.js（官方 Linux 压缩包，glibc 2.28 起）
say '5/7 Node.js'
NODE_NAME="node-v$NODE_VERSION-linux-$ARCH"
if [ -z "$NODE_TAR" ]; then
  NODE_TAR="$OUT/$NODE_NAME.tar.xz"
  [ -f "$NODE_TAR" ] || curl -fL --retry 3 -o "$NODE_TAR" "${NODE_MIRROR:-https://nodejs.org/dist}/v$NODE_VERSION/$NODE_NAME.tar.xz" >>"$LOG" 2>&1
fi
mkdir -p "$DIST/tools/node"
tar -xJf "$NODE_TAR" -C "$DIST/tools/node" --strip-components=1
rm -rf "$DIST/tools/node/include" "$DIST/tools/node/share"
say "   $(basename "$NODE_TAR")"

# 6 离线系统软件包（可选）：gcc、gcov、cppcheck、git、bubblewrap 和依赖
say '6/7 离线系统软件包'
if [ -n "$DEBS" ] && [ -d "$DEBS" ]; then mkdir -p "$DIST/debs"; cp -a "$DEBS"/. "$DIST/debs/"; say "   $(ls "$DIST/debs" | wc -l) 个文件（$(size "$DIST/debs") MB）"
else say '   没有带：目标电脑要能从麒麟软件源装 gcc cppcheck git bubblewrap（见 packaging/麒麟部署说明.md）'; fi

# 7 安装、启动、自检、卸载脚本和桌面图标
say '7/7 脚本'
for f in install.sh uninstall.sh start.sh check.sh; do cp "$ROOT/packaging/linux/$f" "$DIST/$f"; chmod +x "$DIST/$f"; done
cp "$ROOT/packaging/linux/astrolab.desktop.in" "$DIST/"
cp "$ROOT/packaging/麒麟部署说明.md" "$DIST/" 2>/dev/null || true
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
{ echo "AstroLab $VERSION linux-$ARCH，提交 $COMMIT，$(date -Iseconds)"; echo "Electron $ELECTRON_VERSION，DSH $DSH_VERSION，Node $NODE_VERSION"; } > "$DIST/manifest.txt"

# 源码保护（--protect）：把主进程、工具服务换成 V8 字节码，桥/围栏/更新器压缩，删掉所有可读源码。
# 用安装包自带的 Electron、node 编译（和运行时同一套 V8）；esbuild、bytenode 装在临时目录。在计算更新清单之前做。
if [ "$PROTECT" = 1 ]; then
  say '7.5/8 源码保护（字节码 + 压缩）'
  PT="$OUT/.protect-tools"
  if [ ! -d "$PT/node_modules/esbuild" ]; then
    mkdir -p "$PT"; (cd "$PT" && echo '{"name":"pt","private":true}' > package.json && npm i --no-audit --no-fund --loglevel=error ${REGISTRY:+--registry=$REGISTRY} esbuild@0.25.0 bytenode@1.5.7 >>"$LOG" 2>&1)
  fi
  NODE_PATH="$PT/node_modules" node "$ROOT/packaging/linux/protect.mjs" "$DIST" | tee -a "$LOG" || { say '源码保护失败，见日志'; exit 1; }
fi
say "   大小（MB）：app $(size "$DIST/app")（其中 DSH $(size "$DIST/app/runtime/dsh")），workbench $(size "$WB")，node $(size "$DIST/tools/node")，合计 $(size "$DIST")"

# 更新用的清单（每个文件的 sha256，带平台）；最后写，覆盖上面所有文件
node "$ROOT/packaging/release.mjs" manifest "$DIST" --commit "$COMMIT" --platform "linux-$ARCH" | tee -a "$LOG"
TGZ="$OUT/AstroLab-$VERSION-linux-$ARCH.tar.gz"
tar -C "$OUT" -czf "$TGZ" "$(basename "$DIST")"
say "安装包：$TGZ（$(du -m "$TGZ" | cut -f1) MB）"
say "在麒麟电脑上：tar xzf $(basename "$TGZ") && cd $(basename "$DIST") && ./install.sh --llm http://<模型服务器>:8000/v1"
