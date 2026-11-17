#!/usr/bin/env bash
# AstroLab 离线安装（Linux：银河麒麟桌面 V10/V11 等）。不需要 root、不联网；装到 ~/.local/opt/AstroLab，
# 用户数据（设置、任务记录、工作区、我的库）在 ~/.local/share/AstroLab，重装和更新都不动它。
#
# 用法：./install.sh [--llm http://192.168.10.20:8000/v1] [--key EMPTY] [--prefix 目录] [--with-debs] [--system-sandbox]
#   --llm            局域网模型服务的地址：装好后做一次模型探测，把模型名、上下文、思考参数写进设置文件
#   --key            模型服务的密钥（vLLM 的 --api-key；没设可以不填）
#   --with-debs      用安装包里 debs/ 的离线包补装 gcc、cppcheck、git、bubblewrap（要输入 sudo 密码）
#   --system-sandbox 给界面的 chrome-sandbox 设 setuid（要 sudo）；不设时用户命名空间可用就不需要，否则 start.sh 以 --no-sandbox 启动
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/opt/AstroLab"; LLM=""; KEY=""; WITH_DEBS=0; SYS_SANDBOX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --llm) LLM="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --prefix) DEST="$2"; shift 2 ;;
    --with-debs) WITH_DEBS=1; shift ;;
    --system-sandbox) SYS_SANDBOX=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "不认识的参数：$1"; exit 2 ;;
  esac
done
DATA="$HOME/.local/share/AstroLab"
ok() { echo "  ✓ $*"; }
warn() { echo "  ! $*"; }

case "$(uname -m)" in aarch64|arm64) HERE=arm64 ;; x86_64|amd64) HERE=x64 ;; *) HERE="$(uname -m)" ;; esac
PKG_ARCH="$(basename "$SRC" | sed -n 's/.*linux-\(x64\|arm64\)$/\1/p')"
if [ -n "$PKG_ARCH" ] && [ "$PKG_ARCH" != "$HERE" ]; then echo "这个安装包是 $PKG_ARCH 的，这台电脑是 $HERE（$(uname -m)）。请换对应的安装包。"; exit 1; fi
if pgrep -f "$DEST/workbench/AstroLab" >/dev/null 2>&1; then echo 'AstroLab 正在运行，先关掉再安装。'; exit 1; fi

echo "安装 AstroLab 到 $DEST"
mkdir -p "$DEST"
# 覆盖安装：先删掉程序部分（用户数据不在这里）
rm -rf "$DEST/app" "$DEST/workbench" "$DEST/tools"
cp -a "$SRC/app" "$SRC/workbench" "$SRC/tools" "$DEST/"
for f in start.sh check.sh uninstall.sh astrolab.desktop.in manifest.json manifest.txt 麒麟部署说明.md; do [ -e "$SRC/$f" ] && cp -a "$SRC/$f" "$DEST/"; done
chmod +x "$DEST"/*.sh "$DEST/workbench/AstroLab" "$DEST/tools/node/bin/node"
ok '程序文件'

# 系统工具：gcc（单元测试）、cppcheck（代码走查）、git（审核和提交）、bubblewrap（智能体执行命令时的沙箱）
need=()
for c in gcc gcov cppcheck git bwrap; do command -v "$c" >/dev/null 2>&1 || need+=("$c"); done
if [ ${#need[@]} -gt 0 ]; then
  if [ $WITH_DEBS = 1 ] && ls "$SRC"/debs/*.deb >/dev/null 2>&1; then
    echo "  用离线包补装：${need[*]}（需要 sudo 密码）"
    sudo dpkg -i "$SRC"/debs/*.deb || sudo apt-get -f install -y --no-download || warn '离线包没有装全，见上面的输出'
  elif [ $WITH_DEBS = 1 ] && ls "$SRC"/debs/*.rpm >/dev/null 2>&1; then
    echo "  用离线包补装：${need[*]}（需要 sudo 密码）"
    sudo rpm -Uvh --replacepkgs "$SRC"/debs/*.rpm || warn '离线包没有装全，见上面的输出'
  else
    warn "缺少 ${need[*]}：运行 ./install.sh --with-debs，或请管理员 sudo apt install gcc cppcheck git bubblewrap"
  fi
else ok 'gcc、cppcheck、git、bubblewrap 都在'; fi

# 界面沙箱：chrome-sandbox 要 root 所有并带 setuid；用户命名空间可用时用不上它
if [ $SYS_SANDBOX = 1 ]; then
  sudo chown root:root "$DEST/workbench/chrome-sandbox" && sudo chmod 4755 "$DEST/workbench/chrome-sandbox" && ok 'chrome-sandbox 已设 setuid'
fi

# 设置文件：第一次安装时用“麒麟 + 局域网 Qwen”场景的设置；已有的不覆盖
mkdir -p "$DATA"
if [ ! -f "$DATA/local.env" ]; then
  cp "$DEST/app/config/scenarios/kylin-lan-qwen.env" "$DATA/local.env"
  chmod 600 "$DATA/local.env"
  ok "设置文件 $DATA/local.env（场景：麒麟 + 局域网 Qwen3.8-27B）"
else ok "设置文件已有，不覆盖：$DATA/local.env"; fi
if [ -n "$LLM" ]; then
  echo "  模型探测：$LLM"
  "$DEST/tools/node/bin/node" "$DEST/app/app/main/probe.mjs" --env "$DATA/local.env" --base "$LLM" ${KEY:+--key "$KEY"} --write | sed 's/^/    /' || warn '模型探测有失败项：按上面的提示处理后，可以再运行 '"$DEST"'/check.sh'
fi

# 开始菜单和桌面图标
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
sed -e "s|@DEST@|$DEST|g" "$DEST/astrolab.desktop.in" > "$APPS/astrolab.desktop"
chmod +x "$APPS/astrolab.desktop"
DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESK" ] && [ -d "$DESK" ] || { [ -d "$HOME/桌面" ] && DESK="$HOME/桌面" || DESK="$HOME/Desktop"; }
if [ -d "$DESK" ]; then
  cp "$APPS/astrolab.desktop" "$DESK/AstroLab.desktop"; chmod +x "$DESK/AstroLab.desktop"
  gio set "$DESK/AstroLab.desktop" metadata::trusted true >/dev/null 2>&1 || true
fi
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
ok '开始菜单和桌面图标'

echo
echo "装好了。从开始菜单或桌面的 AstroLab 打开，或运行 $DEST/start.sh"
echo "自检（不改任何东西）：$DEST/check.sh    卸载：$DEST/uninstall.sh"
[ -z "$LLM" ] && echo "还没有设置模型：编辑 $DATA/local.env 的 DEPT_LLM_BASE_URL，或重新运行 ./install.sh --llm http://<模型服务器>:8000/v1"
exit 0
