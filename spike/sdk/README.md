# 阶段 0 技术验证：DSH sdk 模式

验证工作台能否用 DSH 的 sdk 模式（JSON-RPC over stdio）作为引擎。只用 Node 内置模块，不需要 `npm install`。

| 文件 | 作用 |
|---|---|
| `engine.mjs` | 引擎适配层原型：拉起 `dsh --profile sdk`，收发 JSON-RPC；停止 = 结束进程树，继续 = 重启后 `session/resume` |
| `scenarios.mjs` | 自动跑 5 个场景并写报告（基本任务、越界写文件、停止后继续、技能和工具服务、Git 防护） |
| `server.mjs`、`index.html` | 最小界面：本机网页，实时显示事件，可停止、继续、新会话 |
| `git-hooks/reference-transaction` | Git 防护：只放行环境变量 `DEPT_UI_GIT=1` 的引用更新，`--no-verify` 跳不过 |
| `run.ps1` | Windows 上的启动脚本：读 `config\local.env`、设置 DSH 环境变量后运行上面的程序 |

```powershell
powershell -ExecutionPolicy Bypass -File spike\sdk\run.ps1             # 跑全部场景，报告在 runtime\spike\report-*.md
powershell -ExecutionPolicy Bypass -File spike\sdk\run.ps1 -Only S2    # 只跑某几个
powershell -ExecutionPolicy Bypass -File spike\sdk\run.ps1 -Mode ui    # 最小界面 http://127.0.0.1:3090
```

模型用 `config\local.env` 中的部门模型路由（`dept-llm`），与 DSH 网页界面相同。场景 S5 在 `runtime\spike-ws` 下建一个临时 Git 仓库，不会动本工程的仓库。原始收发记录在 `runtime\spike\` 下（不提交）。

已知：

- Git 钩子只保护提交历史和分支，不能阻止 `git reset --hard`、`git checkout -- .` 等丢弃未提交改动的命令；正式版在每个任务开始前记录工作区快照（不建引用，钩子不拦）。
- 钩子是防误操作，不是防恶意：知道 `DEPT_UI_GIT` 的人可以绕过。
