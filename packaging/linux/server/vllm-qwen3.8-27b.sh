#!/usr/bin/env bash
# 局域网模型服务器参考启动脚本：vLLM 部署 Qwen3.8-27B，给 AstroLab 工作台（智能体）用。由服务器管理员按机器情况改。
# 工作台对服务端的要求（模型探测 app/main/probe.mjs 会逐项检查）：
#   1 OpenAI 兼容接口 /v1/chat/completions、/v1/models
#   2 工具调用解析成结构化 tool_calls：--enable-auto-tool-choice --tool-call-parser qwen3_coder
#      （长任务里偶发“参数不是合法 JSON”时换 --tool-call-parser qwen3_xml）
#   3 思考单独返回：--reasoning-parser qwen3
#   4 上下文不小于 131072（智能体每一步都带工具定义和技能，约 1 万 tokens；文档类任务还要读多份材料）
#   5 --enable-prefix-caching：每一步的前缀（系统提示、工具定义、前面的对话）都一样，前缀缓存省掉大部分预填充
# 显存参考（BF16 权重约 55 GB）：1 张 H200/H100 80G 跑 FP8 权重，或 2 张 80G 卡 TP=2 跑 BF16；48G 卡用 FP8 + TP=2。
# 只做文字任务时加 --language-model-only 省下视觉编码器的显存（工作台设置里 DEPT_LLM_INPUT 保持 text）。
set -euo pipefail
MODEL_DIR="${MODEL_DIR:-/models/Qwen3.8-27B}"      # 或 Qwen3.8-27B-FP8
NAME="${NAME:-qwen3.8-27b}"                         # 工作台 local.env 的 DEPT_LLM_MODEL
PORT="${PORT:-8000}"
TP="${TP:-2}"
MAX_LEN="${MAX_LEN:-131072}"                        # 工作台 local.env 的 DEPT_LLM_CONTEXT_WINDOW
API_KEY="${API_KEY:-}"                              # 设了就要把同样的值填进工作台的 DEPT_LLM_API_KEY

exec vllm serve "$MODEL_DIR" \
  --served-model-name "$NAME" \
  --host 0.0.0.0 --port "$PORT" \
  --tensor-parallel-size "$TP" \
  --max-model-len "$MAX_LEN" \
  --gpu-memory-utilization 0.90 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --enable-prefix-caching \
  --max-num-seqs 16 \
  ${API_KEY:+--api-key "$API_KEY"}
# 可选：MTP 投机解码提速 --speculative-config '{"method":"mtp","num_speculative_tokens":1}'
# 验证（在任意一台麒麟电脑上）：~/.local/opt/AstroLab/tools/node/bin/node ~/.local/opt/AstroLab/app/app/main/probe.mjs --base http://<本机IP>:$PORT/v1
