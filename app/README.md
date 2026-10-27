# AstroLab 工作台（阶段 2）

Electron + React 的桌面工作台。引擎是 DSH 的 sdk 模式（阶段 0、S6 验证通过），技能、工具服务、模型路由沿用本仓库的 `skills/`、`mcp/`、`config/`。

```powershell
powershell -ExecutionPolicy Bypass -File app\dev.ps1          # 实机：调用部门模型
powershell -ExecutionPolicy Bypass -File app\dev.ps1 -Mock    # 模拟引擎：不调用模型，看界面和流程
```

第一次运行会 `npm install`（下载 Electron 约 100 MB）。之后每次只重新编译界面（约 2 秒）再启动。

## 目录

| 目录或文件 | 作用 |
|---|---|
| `engine/engine.mjs` | 引擎进程（JSON-RPC over stdio）、引擎桥的管道服务端、引擎启动补丁（提问工具、引擎桥，关掉联网工具） |
| `engine/bridge.mjs` | 运行在 DSH 进程里的引擎桥插件：提问转给工作台；插话在下一步之前送到（steer）；停止只中止当前轮（cancel） |
| `engine/activity.mjs` | 把会话事件整理成活动记录（同类合并、思考用时、越界标出、写文件统计、计划进度） |
| `engine/mock-dsh.mjs` | 模拟引擎：按 sdk 协议回放剧本，测试和看界面用 |
| `main/main.mjs`、`preload.cjs` | Electron 主进程、界面能调用的全部接口 |
| `main/task.mjs` | 任务控制器：状态、停止与继续、插话、提问、快照、审核、提交、历史；打开项目就预热引擎，任务之间共用 |
| `main/git.mjs` | 任务前快照（不建分支、不动暂存区）、相对快照的改动和差异、恢复、只提交任务改动、防护钩子 |
| `main/projects.mjs` | 项目清单、加入项目时的文件夹权限和钩子、示例工程 |
| `main/paths.mjs` | 开发与安装两种布局、用户数据目录、设置文件、DSH 数据目录补丁 |
| `src/` | 界面（React + TypeScript）：发起、进行中、审核、历史；提问卡片、提示条、声音 |
| `test/` | `npm test`：引擎层、引擎桥、Git、任务控制器（模拟引擎 + 临时仓库），共 29 项；`node app/test/real-dsh.mjs`：在真实 DSH 上验证插话、停止、继续、提问（假的模型服务，不花模型调用） |

## 数据放在哪

- 用户数据：安装版在 `%LOCALAPPDATA%\AstroLab`；用 `dev.ps1` 开发时在仓库的 `runtime\app-data`（不提交）。内容：项目清单、任务记录、DSH 会话、示例工程副本、日志
- 示例工程：首次运行把仓库的 `sample` 复制到数据目录下的 `workspace\sample`，建成 Git 仓库
- 排查问题：数据目录下的 `logs\main.log`（主进程）、`logs\<任务>.jsonl`（引擎收发），以及 `runtime\app-dev.log`（dev.ps1 输出）

## 插话、停止和引擎启动

- 插话：经引擎桥 steer，在智能体的下一步之前送到（sdk 的 session/prompt 要等整轮做完才看到）
- 停止：经引擎桥 cancel，只中止当前这一轮，引擎进程不退出，继续不用重启；桥不可用或 3 秒内停不下来才结束进程
- 引擎：打开项目时在后台启动（冷启动要等工具服务和技能加载完，实测第一次超过 1 分钟），任务之间共用；状态栏显示引擎状态
- 主进程日志 `logs\main.log` 记录引擎每次启动用时和引擎桥连接

## 已知限制（M1）

- 只有浅色主题；命令面板（Ctrl K）、`@` 引用文件的弹出提示还没做
- 一次只运行一个任务（运行中可以切到其他环节，先写好下一个任务）；越界操作的“把该目录加入项目”按钮还没接
- 审核里的疑似缺陷清单需要技能输出结构化结果，现在显示智能体最后一条回复
