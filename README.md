# 部门智能体入门工程（笔记本开发测试用）

在一台 Windows 笔记本上把 DSH（DeepSeek Harness）跑起来，并接入第一个部门工具（Cppcheck）和第一个部门 Skill（代码走查）。这是《部门级智能体落地实施方案》中“领域能力层”的最小样板，以后的 Skill 和 MCP 服务都按同样的方式添加。

> **注意：**现阶段接的是 DeepSeek 官方 API，代码会发送到云端。只能用 `sample` 里的示例代码或非敏感代码测试，**不要打开任何型号的真实代码**。以后切到内网模型只需改一行配置（见最后一节）。

## 目录结构

```text
astrolab-agent/
├── scripts/            安装、自检、启动、评测脚本（PowerShell）
├── config/
│   ├── local.env.example        本地环境变量模板（API Key 等）
│   └── cordis.patch.yml.template  DSH 部门补丁模板（注册 MCP 服务）
├── mcp/cppcheck/       Cppcheck 静态分析 MCP 服务（Node.js）
├── skills/code-walkthrough/     代码走查 Skill（含检查表）
├── sample/src/         示例代码：遥测帧打包/解析，故意埋了约 10 个缺陷
├── evals/              代码走查评测集（8 个用例、29 个缺陷）与自动打分
├── runtime/            setup.ps1 生成：DSH 安装目录和数据目录（不提交）
└── 部门级智能体落地实施方案.md / .docx
```

## 准备

| 项目 | 要求 | 检查方法 |
|---|---|---|
| Node.js | 22.19 及以上，或 24 LTS | PowerShell 中 `node -v` |
| DeepSeek API Key | 在 platform.deepseek.com 申请 | — |
| Cppcheck | 2.x，Windows 安装版即可（默认装到 `C:\Program Files\Cppcheck`） | `cppcheck --version` |
| PowerShell 7（推荐） | DSH 在 Windows 上用它执行命令；没有时退回系统自带的 5.1 | `pwsh -v` |

## 三步跑起来

在 PowerShell 中进入本目录（`D:\lixf\astrolab-agent`），依次执行：

```powershell
# 1. 安装 DSH（锁定 0.2.1-rc.2）、MCP 服务依赖，生成配置。首次几分钟。
#    官方 npm 源慢的话加参数：-Registry https://registry.npmmirror.com
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. 用记事本打开 config\local.env，填写 DEEPSEEK_API_KEY=sk-...，然后自检
powershell -ExecutionPolicy Bypass -File scripts\check.ps1

# 3. 启动，浏览器会自动打开 DSH 界面
powershell -ExecutionPolicy Bypass -File scripts\start-web.ps1
```

自检全部 `[OK]` 后再启动。启动窗口不要关，关掉即停止服务。

## 试一试

**先选工作区。**DSH 的 Web 界面有自己的工作区列表，新会话默认开在 `文档\deepseek-harness\default-workspace`，而不是启动脚本所在的目录。界面打开后，先在左侧添加文件夹，选择本目录下的 `sample`，再在该工作区中新建会话。否则模型会先在整个磁盘上找 `src`。

然后在对话框里输入：

```text
对 src 目录做代码走查，目标平台是 SPARC（BM3803），把报告保存到 review 目录。
```

预期过程：智能体加载 `code-walkthrough` Skill，调用 `mcp__cppcheck__run_cppcheck` 做静态分析，然后逐个函数按检查表阅读源码，输出问题清单，并写入 `sample\review\`。

**怎么判断效果：**`sample\src\tm_frame.c` 中每个缺陷旁都有“缺陷：”注释，共约 10 处。Cppcheck 只能报出其中 1 处（未初始化变量）。其余（越界、除零、缺 `volatile`、无超时、字节序、非对齐访问等）都要靠模型按检查表找。把报告和注释对照，就能直观看到“工具 + Skill + 模型”各自的贡献。

再试试：

- `cppcheck 报的 uninitvar 是真问题吗？` — 告警甄别
- `这段代码如果运行在 D2000 上，和 SPARC 相比有哪些需要注意的地方？` — 平台差异
- 界面左侧的会话记录和轨迹（Trajectory）视图：可以看到每一步模型看到了什么、调用了什么工具。这就是方案里说的审计能力。

## 量化评测

`sample` 里的示例代码带“缺陷：”提示注释，跑得好不代表真实代码上效果好。用 `evals\` 里的评测集来量化：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-evals.ps1 -Parallel 2 -Label 基线
```

8 个虚构用例（SPARC 5 个、D2000 3 个，其中一个无缺陷只用来测误报），共 29 个埋入缺陷，代码里**没有任何提示**。跑完自动生成 `evals\results\<时间>-<标签>\summary.md`，包含检出率、按平台/检查项的分类统计、漏检清单、误报清单，以及 token 用量。

建议把第一次结果作为基线存档。以后**改 Skill、改检查表、换模型、切内网模型、升级 DSH**，都先跑一遍对比数字。详情见 [evals\README.md](evals/README.md)。

> 评测用例是虚构代码，用云端 API 跑没有泄密问题。用量参考：走查一次示例代码的实测会话约 170 万 token，其中 93% 是缓存命中，未缓存输入约 6 万、输出约 5 万。

## 换成自己的工作区

在界面左侧添加另一个文件夹作为工作区即可。工作区是智能体可以**写**的目录（默认沙箱模式：只能写工作区，越界写入会弹出审批）。

> **注意：读取不受工作区限制。**DSH 的沙箱只限制写入，不限制读取：智能体可以列出和读取当前 Windows 用户能访问的任何文件（第一次测试中它就列出了“文档”“桌面”“下载”和 D 盘的目录）。使用云端 API 时，这些内容会随对话发送到云端。所以笔记本上有敏感资料时不要用云端 API 测试；正式部署时靠“一用户一容器、只挂载授权目录”来限制读取范围。

## 怎么扩展

**加一个 Skill：**在 `skills\` 下新建目录，写一个 `SKILL.md`（开头是 `name` 和 `description`，其余是 Markdown 指令），重新运行 `setup.ps1`（只会复制配置，不会重装）。也可以直接放到工作区的 `.dsh\skills\` 下，只对该项目生效。名称必须是小写加连字符，如 `unit-test-design`。

**加一个 MCP 服务：**参考 `mcp\cppcheck\server.mjs` 写一个新服务，然后在 `config\cordis.patch.yml.template` 的 `insert:` 下仿照 `mcp-cppcheck` 再加一条（`id` 和 `serverName` 都要唯一），重新运行 `setup.ps1`。

**改了 `runtime\dsh-home\cordis.patch.yml` 之后**一般不用重启（DSH 会热重载）；若没生效，重启 `start-web.ps1`。

**加一个评测用例：**在 `evals\code-review\templates\` 下复制一个目录，按标记写法编写（说明见 `evals\README.md`），然后运行 `node evals\build-cases.mjs` 重新生成。尽量从部门历史问题单改编，评测才有参考价值。

## 以后切换到内网模型

当笔记本能访问内网模型网关后，在 `config\local.env` 中：

```ini
DEEPSEEK_BASE_URL=http://<内网网关地址>
DEEPSEEK_API_KEY=<内网网关签发的 Key>
```

DSH 内置的 DeepSeek 适配器使用 **Messages 协议**（Anthropic 风格的 `/v1/messages`），不是 OpenAI 的 `/v1/chat/completions`。如果昇腾上的 vLLM-Ascend 只提供 OpenAI 兼容接口，有两种办法：在模型网关上做协议转换（LiteLLM 等网关支持），或改用 DSH 的通用 `llm-pi-ai` 提供方（`openai-completions` 协议）。到那一步再按实际接口配置，届时把 `/v1/models` 和一次工具调用请求的返回给我看即可。

## 常见问题

| 现象 | 处理 |
|---|---|
| 运行脚本提示“禁止运行脚本” | 用上面带 `-ExecutionPolicy Bypass` 的写法，不需要改系统策略 |
| `npm install` 很慢或超时 | `setup.ps1 -Registry https://registry.npmmirror.com`；中断后直接重跑即可 |
| 界面打开了但模型不回答，提示 `MISSING_CREDENTIAL` | `config\local.env` 中 API Key 没填，或填完没重启 `start-web.ps1` |
| 智能体说没有 `mcp__cppcheck__*` 工具 | 运行 `check.ps1` 看哪一步失败；常见是 Cppcheck 未安装 |
| 浏览器打开后 401 | 地址要带启动时打印的 `?token=...`；重新从启动窗口复制完整地址 |
| 模型说“工作区下没有 src”，然后到处找文件 | 会话开在了默认工作区。在界面左侧添加 `sample` 文件夹作为工作区，在其中新建会话 |
| 想清空所有会话重新开始 | 停止服务后删除 `runtime\dsh-home\sessions` |

## 版本说明

- DSH 锁定为 `0.2.1-rc.2`（2026-10-17 发布的开发者预览版）。升级前先在测试目录验证，不要直接改成 latest。
- 2026-10-23 已在 Windows 笔记本 + DeepSeek 官方 API 上实测：走查示例代码约 3.5 分钟、27 次工具调用，报告覆盖了全部埋入的缺陷。示例代码带有“缺陷：”提示注释，这个结果偏乐观，不能代表真实代码上的效果。
