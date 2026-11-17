#!/usr/bin/env bash
# 卸载 AstroLab（Linux）：删开始菜单和桌面图标、程序目录；用户数据（~/.local/share/AstroLab：设置、任务记录、工作区、我的库）默认保留。
DEST="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
DATA="$HOME/.local/share/AstroLab"
if pgrep -f "$DEST/workbench/AstroLab" >/dev/null 2>&1; then echo 'AstroLab 正在运行，先关掉再卸载。'; exit 1; fi
read -r -p "卸载 $DEST？[y/N] " a; [ "$a" = y ] || [ "$a" = Y ] || exit 0
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/astrolab.desktop"
for d in "$(xdg-user-dir DESKTOP 2>/dev/null)" "$HOME/桌面" "$HOME/Desktop"; do [ -n "$d" ] && rm -f "$d/AstroLab.desktop"; done
read -r -p "同时删除用户数据 $DATA（设置、任务记录、工作区、我的库）？默认保留 [y/N] " b
cd "$HOME" && rm -rf "$DEST"
if [ "$b" = y ] || [ "$b" = Y ]; then rm -rf "$DATA"; echo '已删除程序和用户数据。'; else echo "已删除程序，用户数据保留在 $DATA（重新安装后接着用）。"; fi
