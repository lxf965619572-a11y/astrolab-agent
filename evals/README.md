# 代码走查评测集

用来客观衡量“DSH + 模型 + code-walkthrough Skill + Cppcheck”这套组合的代码走查能力。以后**换模型、改 Skill、改检查表、切到内网模型、升级 DSH**，都先跑一遍评测，用数字判断是变好了还是变差了。

## 用例

8 个虚构的嵌入式 C 模块，共 29 个埋入缺陷。代码里**没有任何提示注释**，标准答案单独存放在 `case.json` 中。

| 用例 | 平台 | 内容 | 缺陷数 |
|---|---|---|---|
| sparc-01-uart-ringbuf | SPARC | UART 接收环形缓冲区与中断服务程序 | 5 |
| sparc-02-1553-rt | SPARC | 1553B 远程终端接收消息处理（含领域知识类缺陷） | 3 |
| sparc-03-tc-dispatch | SPARC | 遥控指令分发 | 4 |
| sparc-04-tmr-util | SPARC | 三模冗余表决与超时等待 | 4 |
| sparc-05-clean-bitutil | SPARC | **对照组，没有缺陷**，只用来统计误报 | 0 |
| d2000-01-tm-udp | D2000 | UDP 接收 SPARC 下位机遥测（字节序、结构体布局） | 5 |
| d2000-02-eventlog | D2000 | 事件日志文件操作 | 4 |
| d2000-03-sample-mgr | D2000 | 多线程采样管理（互斥锁、数据竞争） | 4 |

缺陷覆盖检查表 A–E 各类，另有 3 个需要 1553B 协议知识的“领域”缺陷。每个用例里还有若干确认无缺陷的“干净函数”，模型在其中报出“严重/一般”问题即计为误报。

Cppcheck（默认检查项）单独只能发现其中 1 个，所以检出率主要反映模型和 Skill 的能力。

## 运行

先确认 `scripts\check.ps1` 全部通过，然后：

```powershell
# 跑全部 8 个用例（每个约 3–5 分钟；用 -Parallel 2 可以同时跑两个）
powershell -ExecutionPolicy Bypass -File scripts\run-evals.ps1 -Parallel 2 -Label 基线

# 只跑某几个用例
powershell -ExecutionPolicy Bypass -File scripts\run-evals.ps1 -Cases sparc-01-uart-ringbuf,d2000-01-tm-udp

# 每个用例跑 3 次，看结果是否稳定
powershell -ExecutionPolicy Bypass -File scripts\run-evals.ps1 -Repeat 3 -Parallel 2 -Label 稳定性
```

评测用例是虚构代码，用 DeepSeek 官方 API 跑没有泄密问题。用量参考：README 中示例走查的一次实测会话共约 170 万 token，其中 93% 是缓存命中（每一步都重复携带前面的上下文），未缓存输入约 6 万、输出约 5 万。每次评测的实际用量会记录在 `summary.md` 中。

**并发不要开太大。**DeepSeek API 有并发限制，切到内网模型后也要和其他用户共享推理资源，一般 `-Parallel 2` 即可。

## 看结果

每次评测在 `evals\results\<时间>-<标签>\` 下生成一个目录：

| 文件 | 内容 |
|---|---|
| `summary.md` | **主要看这个**：总体检出率、分平台/分检查项统计、漏检清单、误报清单、额外发现 |
| `summary.json` | 同样内容的机器可读版，便于多次结果对比 |
| `runs\<用例>\review\` | 模型写的 `report.md`（人看的报告）和 `findings.json`（打分用） |
| `runs\<用例>\run.json` | 耗时、工具调用次数、是否加载了 Skill、是否调用了 Cppcheck |
| `runs\<用例>\dsh.stderr.txt` | DSH 的错误输出，用例失败时先看这里 |

几个指标的含义：

- **检出率**：命中标准答案的比例。模型报告的行号与答案相差 2 行以内、文件相同即算命中。
- **干净代码误报**：在无缺陷函数里报出“严重/一般”问题的次数（“建议”级不计）。
- **其他额外发现**：不在答案中、也不在干净函数里的问题。可能是模型发现的真实问题（说明答案需要补充），也可能是误报。**这一项需要人工逐条判断**，不能自动算作误报。
- **用了 Skill / 调了 Cppcheck**：如果出现“否”，说明模型没按 Skill 的流程走，应该检查 Skill 的描述是否清楚。

建议的使用方式：先跑一次作为基线，把 `summary.md` 存档；以后每次改动后再跑，对比检出率、误报和漏检清单的变化。模型输出有随机性，单次结果相差一两个缺陷是正常的，重要结论请用 `-Repeat 3` 确认。

## 防止“偷看答案”

DSH 的沙箱只限制写、不限制读。为防止模型读到标准答案：

- 每个用例在系统临时目录（`%TEMP%\dsh-evals\...`）中运行，远离 `evals` 目录。
- 运行后检查会话日志，若工具调用中出现 `case.json`、`meta.json`、`evals\results` 等路径，报告中会标注“可能读取过答案，结果作废”。

## 添加自己的用例

用例由 `code-review\templates\` 中带标记的模板生成：

1. 复制一个模板目录，改名（以 `sparc-` 或 `d2000-` 开头便于识别）。
2. 在 `src\` 中写代码。在缺陷所在行末尾加 `/*@D:缺陷ID*/`；一个缺陷涉及多行时，每行都加同一个 ID。
3. 把确认无缺陷的函数用单独成行的 `/*@CLEAN*/` 和 `/*@END*/` 包起来。
4. 在 `meta.json` 中写用例标题、目标平台（`sparc` 或 `d2000`），以及每个缺陷的检查项、严重程度、说明和几个关键词（关键词用于在同一行有多个缺陷时区分匹配）。
5. 运行 `node evals\build-cases.mjs` 重新生成 `code-review\cases\`。它会去掉所有标记、记录行号，并用 Cppcheck 标出哪些缺陷工具单独就能发现。

注意：

- **不要用真实型号代码做用例**，除非评测只在内网模型上跑。
- 写缺陷时尽量贴近部门真实出过的问题（可以从历史问题单里改编），这样评测结果才有参考价值。
- 修改提示词请编辑 `code-review\prompt.txt`。提示词、Skill、检查表的指纹会记录在每次结果里，方便追溯是哪个版本跑出的结果。
