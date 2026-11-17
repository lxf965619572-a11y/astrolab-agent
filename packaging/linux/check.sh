#!/usr/bin/env bash
# AstroLab 自检（Linux）：Node、DSH、bash、命令沙箱（bubblewrap / Landlock）、工作台依赖的系统库、GCC、Cppcheck、Git、
# 三个工具服务、引擎握手；模型服务连得上时再做模型探测。报告写到 ~/.local/share/AstroLab/check-report-*.md。
DEST="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
APP="$DEST/app"
NODE="$DEST/tools/node/bin/node"
[ -x "$NODE" ] || { echo "缺少 $NODE：安装包不完整"; exit 1; }
export ASTROLAB_DATA="$HOME/.local/share/AstroLab"
export DSH_HOME="$ASTROLAB_DATA/dsh-home"
export DSH_TELEMETRY_DISABLED=1 DSH_TELEMETRY_MODE=DISABLED
export PATH="$DEST/tools/node/bin:$DEST/tools/bin:$PATH"
mkdir -p "$DSH_HOME"
ENVF="$ASTROLAB_DATA/local.env"
[ -f "$ENVF" ] || cp "$APP/config/scenarios/kylin-lan-qwen.env" "$ENVF"
# 读设置文件（KEY=VALUE，# 开头是注释，空值跳过）
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"; t="${line#"${line%%[![:space:]]*}"}"
  case "$t" in ''|'#'*) continue ;; esac
  k="${t%%=*}"; v="${t#*=}"; k="${k//[[:space:]]/}"; v="${v%\"}"; v="${v#\"}"
  [ -n "$k" ] && [ -n "$v" ] && export "$k=$v"
done < "$ENVF"
[ -z "${DEPT_LLM_API_KEY:-}" ] && [ -n "${DEEPSEEK_API_KEY:-}" ] && export DEPT_LLM_API_KEY="$DEEPSEEK_API_KEY"
# DSH 数据目录的补丁：每次从模板重写（路径指向这次的安装）
sed "s|__STARTER_DIR__|$APP|g" "$APP/config/cordis.patch.yml.template" > "$DSH_HOME/cordis.patch.yml"
WS="$ASTROLAB_DATA/workspace/sample"
[ -d "$WS" ] || { mkdir -p "$(dirname "$WS")"; cp -a "$APP/sample" "$WS"; }
export SPIKE_WORKSPACE="$WS" SPIKE_LOGDIR="$ASTROLAB_DATA/logs"
exec "$NODE" "$APP/packaging/selfcheck.mjs"
