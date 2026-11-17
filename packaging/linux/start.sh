#!/usr/bin/env bash
# 启动 AstroLab（Linux）。开始菜单和桌面图标调用它。
# 工作台自己读设置文件 ~/.local/share/AstroLab/local.env、找安装目录里的 node 和 DSH；这里只决定 Electron 的启动参数。
DEST="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
DATA="$HOME/.local/share/AstroLab"
mkdir -p "$DATA/logs"
EXE="$DEST/workbench/AstroLab"
FLAGS=(--ozone-platform-hint=auto)
# 界面沙箱：chrome-sandbox 有 setuid，或用户命名空间可用，就照常；都不行时只能 --no-sandbox（界面只加载本机文件，不访问网络）
SB="$DEST/workbench/chrome-sandbox"
# root 用户（测试机上常见）Electron 也要求 --no-sandbox
if [ "$(id -u)" = 0 ] || { ! { [ -u "$SB" ] && [ "$(stat -c %u "$SB" 2>/dev/null)" = 0 ]; } && ! unshare -Ur true >/dev/null 2>&1; }; then
  FLAGS+=(--no-sandbox)
fi
# Wayland 会话（麒麟 V11 等）下的中文输入法
[ -n "${WAYLAND_DISPLAY:-}" ] && FLAGS+=(--enable-wayland-ime)
# 设置文件里的显示开关（ASTROLAB_DISABLE_GPU 也由程序自己读，这里再加一层命令行，覆盖更早的 GPU 初始化）
if grep -qs '^ASTROLAB_DISABLE_GPU=1' "$DATA/local.env"; then FLAGS+=(--disable-gpu); fi
exec "$EXE" "${FLAGS[@]}" "$@" >>"$DATA/logs/workbench-stdout.log" 2>&1
