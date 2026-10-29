# 离线安装包

验证“一个安装包装齐所有东西，在断网的干净电脑上装上并跑通”（需求 FR-INS-01、FR-INS-02，关口 G0）。

| 文件 | 作用 |
|---|---|
| `build-offline.ps1` | 在开发电脑上打包：工作台（`workbench\AstroLab.exe`，带图标和版本信息）、本工程（只取 Git 管理的文件）、工具服务依赖、DSH、Node、GCC（MSYS2 UCRT64）、Cppcheck，可选 Git；生成两个 Windows 沙盒配置 |
| `payload\install.cmd` | 安装：复制到 `%LOCALAPPDATA%\Programs\AstroLab`，建开始菜单和桌面快捷方式；不需要管理员权限，不联网 |
| `payload\uninstall.cmd` | 卸载：删快捷方式和程序目录，用户数据（`%LOCALAPPDATA%\AstroLab`）保留 |
| `payload\check.cmd`、`payload\start.cmd` | 自检（调用 `launch.ps1`）、启动工作台（和快捷方式一样） |
| `launch.ps1` | 设置 PATH 和环境变量；用户数据放在 `%LOCALAPPDATA%\AstroLab`（设置、DSH 数据、会话、工作区、报告），更新软件不影响；首次运行复制示例工作区并准备文件夹权限 |
| `selfcheck.mjs` | 不调用模型的自检：Node、DSH、PowerShell、GCC、Cppcheck、Git、三个工具服务自检、引擎握手、模型接口连通 |

```powershell
# 1. 打包（在本工程根目录）
powershell -ExecutionPolicy Bypass -File packaging\build-offline.ps1
# 2. 双击 runtime\dist\sandbox-offline.wsb（断网的 Windows 沙盒）
# 3. 在沙盒里：桌面\AstroLab\install.cmd → 安装目录里的 check.cmd；报告自动复制到 runtime\dist\results
```

`sandbox-online.wsb` 是联网的同一套环境，用来测试模型任务（要先在沙盒里的 `%LOCALAPPDATA%\AstroLab\local.env` 填 Key）。

**验证情况**：10-26 的验证记录是阶段 0 的包（最小界面）。装阶段 2 工作台（下一节）的包 10-29 在沙盒中复测可用（用户实测，没有留下自检报告）。关口 G4 还要按“新用户 30 分钟内装好、配置并跑完一个示例”计时验收。

## 工作台和任务栏图标（阶段 2）

- `workbench\AstroLab.exe` 是改了名的 Electron（打包时用 rcedit 换上 `app\build\icon.ico` 和版本信息；rcedit 只在打包电脑上用，从 npm 取，不进安装包）。`workbench\resources\app\package.json` 指向 `app\app\main\main.mjs`，界面和程序代码只有一份，和开发时一样。
- **任务栏图标**：Windows 按 AppUserModelID 找开始菜单里同一 ID 的快捷方式，用它的图标。程序每次启动都确认开始菜单里有 `AstroLab.lnk`（ID `AstroLab`、图标 `icon.ico`），安装脚本用 `AstroLab.exe --install-shortcuts` 顺带建桌面快捷方式。开发时（`npm start`）没有这个快捷方式，任务栏显示 Electron 的图标，是正常的。
- 首次运行在 `%LOCALAPPDATA%\AstroLab\local.env` 生成设置文件（从 `config\local.env.example` 复制），界面上会提示去填模型地址和 Key。
- 打包前在 `app\` 里 `npm install` 过（要用 `node_modules\electron\dist` 和 `npm run build`）。
