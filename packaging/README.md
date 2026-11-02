# 离线安装包

验证“一个安装包装齐所有东西，在断网的干净电脑上装上并跑通”（需求 FR-INS-01、FR-INS-02，关口 G0）。

| 文件 | 作用 |
|---|---|
| `build-offline.ps1` | 在开发电脑上打包：工作台（`workbench\AstroLab.exe`，带图标和版本信息）、本工程（只取 Git 管理的文件）、工具服务依赖、DSH、Node、GCC（MSYS2 UCRT64）、Cppcheck，可选 Git；生成两个 Windows 沙盒配置 |
| `payload\install.cmd` | 安装：复制到 `%LOCALAPPDATA%\Programs\AstroLab`，建开始菜单和桌面快捷方式；不需要管理员权限，不联网 |
| `payload\uninstall.cmd` | 卸载：删快捷方式和程序目录，再问用户数据（`%LOCALAPPDATA%\AstroLab`）保留还是删除，默认保留（FR-INS-04） |
| `payload\check.cmd`、`payload\start.cmd` | 自检（调用 `launch.ps1`）、启动工作台（和快捷方式一样） |
| `launch.ps1` | 设置 PATH 和环境变量；用户数据放在 `%LOCALAPPDATA%\AstroLab`（设置、DSH 数据、会话、工作区、报告），更新软件不影响；首次运行复制示例工作区并准备文件夹权限 |
| `release.mjs` | 软件更新的打包电脑一侧：`manifest` 给包写清单（打包最后一步自动做），`publish` 把包发布到更新位置（见下面“软件更新”） |
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

## 软件更新（FR-INS-03）

从部门的**更新位置**（内网共享文件夹，例如 `\\fileserver\astrolab\release`）取新版本。只换变了的文件，用户数据（`%LOCALAPPDATA%\AstroLab`：设置、任务记录、工作区、我的库和已安装的技能）不在安装目录里，不受影响。

**发布（打包电脑上）**

```powershell
# 1. 改 app\package.json 的 version（每次发布都要比上一次大），提交
# 2. 打包；-UpdateDir 写进包里的 app\config\update.json，装上就知道去哪里检查更新
powershell -ExecutionPolicy Bypass -File packaging\build-offline.ps1 -UpdateDir \\fileserver\astrolab\release
# 3. 发布：复制到 <更新位置>\<版本>\files，写 <版本>\manifest.json，最后写 latest.json
node packaging\release.mjs publish runtime\dist\AstroLab \\fileserver\astrolab\release --notes "- 修了 xxx`n- 新增 yyy"
```

更新位置的布局：`latest.json`（`version`、`date`、`notes`、`dir`）和每个版本一个文件夹（`manifest.json` 记着每个文件的大小和 sha256，`files\` 是完整的安装目录）。同一版本、或不比当前最新版本新的，`publish` 会拒绝（`--force` 跳过）。旧版本文件夹可以删，建议留最近两三个。软件只升不降：要让大家退回，把旧的代码改个更大的版本号重新发布（改 `latest.json` 指回旧版本不会生效）。

**用户这边**

- 更新位置：设置文件 `local.env` 的 `ASTROLAB_UPDATE_DIR` 优先，其次包里的 `app\config\update.json`。
- 软件启动 4 秒后安静地检查一次（连不上不提示）；标题栏的更新按钮看版本、手动检查。有新版本时按钮变成“新版本 x.y.z”。
- **下载更新**：比较安装目录和新版本的清单，只把变了的文件复制到 `%LOCALAPPDATA%\AstroLab\update\v<版本>\files`，逐个核对 sha256（复制不完整、更新位置的文件被改过都会停下）。
- **重启并更新**：没有任务在进行时才能点。软件关掉引擎、启动换文件的小程序（`update\v<版本>\runner`：复制出来的 `node.exe` 和 `app\main\updater.mjs`，不依赖安装目录），然后退出。小程序等软件进程退出，逐个换文件（旧文件挪到 `backup`，文件被占用会等最多 60 秒），删掉新版本不再有的文件，最后写新清单；**任何一步失败就全部换回去**。结果写 `update\last-result.json`、过程写 `update\update.log`，然后重新打开软件，启动时提示“已更新到 x.y.z”或失败原因，并清理准备目录。
- 两个版本清单里都没有的文件不碰。没有清单的早期安装（10-29 之前打的包）第一次更新时全部文件算新增、不删文件；也可以直接重新装一次。
- 开发环境（`npm start`）只显示版本、可以检查，不换文件（用 `git pull`）。

验证：`app\test\updater.test.mjs`（发布、检查、只取变了的文件、换文件、中途失败全部换回、被改过的文件和跑出目录的路径拒绝、runner 进程等旧程序退出后换文件并重启、下次启动提示结果）。在真实 Windows 安装上还要走一遍：装 0.1.0 的包 → 发布 0.1.1 → 软件里更新 → 确认版本和任务记录（见 `项目上下文.md` 待办）。
