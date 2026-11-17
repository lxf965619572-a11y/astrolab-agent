#!/usr/bin/env bash
# 收集离线系统软件包：gcc、g++、gcov、cppcheck、git、bubblewrap 和它们的依赖，供 build-offline-linux.sh --debs 带进安装包。
# 在一台能连麒麟软件源、和目标电脑同版本同架构（例如银河麒麟桌面 V10 SP1 2403 aarch64）、最好是新装的电脑上运行：
# 只下载这台电脑还没装的包，所以新装的电脑收集得最全。
#   bash packaging/linux/collect-debs.sh [输出目录，默认 runtime/debs-<架构>]
# 麒麟服务器版（yum/dnf）用 yumdownloader --resolve。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/runtime/debs-$(uname -m)}"
PKGS=(gcc g++ cppcheck git bubblewrap make)
mkdir -p "$OUT"
if command -v apt-get >/dev/null; then
  sudo apt-get update
  sudo apt-get install --download-only --reinstall -y -o Dir::Cache::archives="$OUT" "${PKGS[@]}"
  sudo chown -R "$(id -u):$(id -g)" "$OUT"; rm -rf "$OUT/partial" "$OUT/lock"
elif command -v yumdownloader >/dev/null; then
  yumdownloader --resolve --destdir "$OUT" gcc gcc-c++ cppcheck git bubblewrap make
else
  echo '没有 apt-get 或 yumdownloader'; exit 1
fi
{ echo "收集于 $(date -Iseconds)，$(. /etc/os-release; echo "$PRETTY_NAME") $(uname -m)"; ls "$OUT"; } > "$OUT/README.txt"
echo "已收集 $(ls "$OUT" | grep -c '\.\(deb\|rpm\)$') 个包到 $OUT"
