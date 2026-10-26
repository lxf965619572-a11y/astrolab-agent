# 离线安装包原型（阶段 0）

验证“一个安装包装齐所有东西，在断网的干净电脑上装上并跑通”（需求 FR-INS-01、FR-INS-02，关口 G0）。

| 文件 | 作用 |
|---|---|
| `build-offline.ps1` | 在开发电脑上打包：本工程（只取 Git 管理的文件）、工具服务依赖、DSH、Node、GCC（MSYS2 UCRT64）、Cppcheck，可选 Git；生成两个 Windows 沙盒配置 |
| `payload\install.cmd` | 安装：复制到 `%LOCALAPPDATA%\Programs\AstroLab`，不需要管理员权限，不联网 |
| `payload\check.cmd`、`payload\start.cmd` | 自检、启动（都调用 `launch.ps1`） |
| `launch.ps1` | 设置 PATH 和环境变量；用户数据放在 `%LOCALAPPDATA%\AstroLab`（设置、DSH 数据、会话、工作区、报告），更新软件不影响；首次运行复制示例工作区并准备文件夹权限 |
| `selfcheck.mjs` | 不调用模型的自检：Node、DSH、PowerShell、GCC、Cppcheck、Git、三个工具服务自检、引擎握手、模型接口连通 |

```powershell
# 1. 打包（在本工程根目录）
powershell -ExecutionPolicy Bypass -File packaging\build-offline.ps1
# 2. 双击 runtime\dist\sandbox-offline.wsb（断网的 Windows 沙盒）
# 3. 在沙盒里：桌面\AstroLab\install.cmd → 安装目录里的 check.cmd；报告自动复制到 runtime\dist\results
```

`sandbox-online.wsb` 是联网的同一套环境，用来测试模型任务（要先在沙盒里的 `%LOCALAPPDATA%\AstroLab\local.env` 填 Key）。界面仍是阶段 0 的最小界面，正式工作台在阶段 2 开发。
