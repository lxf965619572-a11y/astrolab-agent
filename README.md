# 部门智能体入门工程（笔记本开发测试用）

在一台 Windows 笔记本上把 DSH（DeepSeek Harness）跑起来，并接入部门工具（Cppcheck 静态分析、Word/Excel/PDF 文档读取、按 Word 模板生成文档、单元测试编译运行与覆盖率统计）和部门 Skill（代码走查、需求分析、详细设计、单元测试设计）。这是《部门级智能体落地实施方案》中“领域能力层”的最小样板，以后的 Skill 和 MCP 服务都按同样的方式添加。

> **注意：**现阶段接的是 DeepSeek 官方 API，代码会发送到云端。只能用 `sample` 里的示例代码或非敏感代码测试，**不要打开任何型号的真实代码**。以后切到内网模型只需改一行配置（见最后一节）。

## 目录结构

```text
astrolab-agent/
├── scripts/            安装、自检、启动、评测脚本（PowerShell）
├── config/
│   ├── local.env.example        本地环境变量模板（API Key 等）
│   ├── cordis.patch.yml.template  DSH 部门补丁模板（注册 MCP 服务）
│   └── templates/               Word 模板（现为演示模板；内网放部门正式模板，说明见其中 README）
├── mcp/cppcheck/       Cppcheck 静态分析 MCP 服务（Node.js）
├── mcp/docreader/      文档读取 MCP 服务：Word/Excel/PDF 转 Markdown（只读）
├── mcp/docgen/         文档生成 MCP 服务：Markdown 套 Word 模板生成 .docx，表格导出 .xlsx
├── mcp/utest/          单元测试 MCP 服务：主机上编译运行手写驱动/桩或 gtest，gcov 统计语句、分支、MC/DC 覆盖率
├── mcp/common/         上面几个服务共用的 ZIP/XML/路径模块（只用 Node 自带模块）
├── skills/code-walkthrough/     代码走查 Skill（含检查表）
├── skills/requirements-analysis/ 需求分析 Skill（检查表、质量规则、报告格式、GJB 438B SRS 章节要求）
├── skills/detailed-design/      详细设计 Skill（正向/逆向，文档结构、函数格式、设计检查表、流程图写法、检查脚本）
├── skills/unit-test-design/     单元测试设计 Skill（用例设计方法、驱动和桩约定、报告格式、gtest 说明、报告检查脚本）
├── sample/src/         示例代码：遥测帧打包/解析，故意埋了约 10 个缺陷
├── sample/docs/        示例软件研制任务书（虚构，.docx 由同名 .md 生成），埋了 20 个需求问题
├── sample/design/      详细设计示例 oc_ctrl（虚构）：需求规格说明、概要设计说明、控制器接口说明的摘录
├── sample/utest/       单元测试示例模块（虚构）：cmd_check 指令检查（6 个缺陷）、uart_drv 串口驱动（7 个缺陷），各含详细设计
├── evals/              代码走查评测集（8 个用例、29 个缺陷）与自动打分
│   ├── requirements-analysis/  示例任务书的埋入问题对照表（人工对照用）
│   ├── detailed-design/        详细设计评测：答案表、逆向模式用的代码、参考详细设计
│   └── unit-test/              单元测试评分：正确的参考版、缺陷和变异体清单、参考测试、评分脚本
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
| gcc（单元测试用） | 带 gcov；GCC 14 及以上才能测量 MC/DC。安装方法见“单元测试”一节 | `gcc --version` |

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

### 需求分析

同样在 `sample` 工作区中新建会话，输入：

```text
对 docs\软件研制任务书-示例.docx 做需求分析，软件简称 TMUS，目标平台 SPARC（BM3803），只出需求分析报告，保存到 req 目录。
```

预期过程：智能体加载 `requirements-analysis` Skill，调用 `mcp__docreader__read_document` 读取 Word 任务书，摘录任务书条款，划分配置项和功能模块，梳理 RS-422 接口，按检查表逐项分析，输出需求条目、追溯矩阵和待确认问题清单，并写入 `sample\req\`。

**怎么判断效果：**任务书中埋了 20 个问题（模糊表述、前后矛盾、帧容量算不下、引用的 ICD 未提供、隐含需求缺失等），任务书里**没有提示**。对照表在 `evals\requirements-analysis\示例任务书-埋入问题.md`，放在工作区之外，避免智能体读到。重点看两点：必检的 14 个问题提出了多少；有没有**编造**数值，比如任务书没给初始化时间，报告却写了“不大于 500 ms”。编造比漏检更严重。第一次运行的评分和问题清单见 `evals\requirements-analysis\评估记录-20261024.md`。

**自查脚本：**`skills\requirements-analysis\scripts\check-report.mjs` 用固定规则扫描需求分析报告，列出疑似自行裁决（替上级做决定）、依据可疑、数值无出处、覆盖状态偏乐观、统计不一致的地方。Skill 要求智能体写完报告后运行它；人工评审前也可以自己跑一遍：

```powershell
node skills\requirements-analysis\scripts\check-report.mjs sample\req\需求分析报告-20261024.md
```

**改了 Skill 之后要开新会话。**Skill 在会话中第一次使用时加载，之后同一会话不会重新读取。修改 `skills\` 下的文件并运行 `setup.ps1` 后，要在界面里新建会话再测试，否则智能体用的还是旧版 Skill，还会照着上下文中的旧报告修补。

需求分析报告满意后，可以接着输入：

```text
按 GJB 438B 生成软件需求规格说明初稿，生成 Word；需求条目表、追溯矩阵和待确认问题清单导出 Excel。
```

智能体先写 Markdown，再调用 `mcp__docgen__render_docx` 套用 `config\templates` 中的模板生成 `.docx`，调用 `mcp__docgen__export_xlsx` 导出 `.xlsx`。打开 Word 时会提示“是否更新域”，选“是”生成目录。【待确认】【待补充】处是黄色高亮，评审前必须全部清除。

### 需求分析：示例 2（1553B RT，含 ICD）

示例 1 的错误例子已经写进了 Skill，用示例 1 复测会偏乐观。示例 2 是一份没见过的材料，用来检验 Skill 是否通用：电源控制单元（PCU）作为 MIL-STD-1553B 总线的 RT，这次提供了 Excel 格式的 ICD。

测试步骤：

1. 把上一次的 `sample\req` 改名（如 `req-示例1`）；
2. 在 DSH 界面**新建会话**，输入：

```text
对 docs\PCU软件研制任务书-示例2.docx 和 docs\PCU-1553B接口控制文件-示例2.xlsx 做需求分析，软件简称 PCUS，目标平台 SPARC（BM3823），只出需求分析报告，保存到 req 目录。
```

3. 对照 `evals\requirements-analysis\示例2\示例2-埋入问题.md` 评分：18 个必检问题、4 个加分问题，以及 10 个**误报陷阱**。误报陷阱是材料里已经写清楚的内容（如看门狗参数、ICD 已提供、1553B 自带字校验），报告把它们当作“缺失”提出，说明智能体在套用示例 1 的结论。

任务书和 ICD 的 Markdown 原稿也放在 `evals\requirements-analysis\示例2\` 下，不在工作区内。

### 详细设计

在 `sample` 工作区中新建会话。先准备工作区（正向模式不放代码）：

```powershell
node evals\detailed-design\prepare.mjs forward
```

然后输入：

```text
按 design\oc_ctrl\docs 下的需求规格说明、概要设计说明和 OC 输出控制器接口说明，编写 oc_ctrl 模块的详细设计说明，正向设计，目标平台 BM3803，保存到 design\oc_ctrl\doc，并生成 Word。
```

预期过程：智能体加载 `detailed-design` Skill，读三份文件，摘录设计依据，核对文件之间的一致性，逐函数（含 static）写原型、输入输出、处理步骤、异常处理、全局数据和中断共享数据的保护，关键函数画流程图，写设计决策、需求追溯和待确认问题，运行 `check-design.mjs` 自查，再生成 Word。

**流程图：**详细设计中的流程图用 Mermaid 写在 Markdown 里，`render_docx` 生成 Word 时自动转换成 Word 的流程图形状（开始/结束、处理、判断、输入输出、子程序）和连线，可以在 Word 里直接修改。只支持自上而下的流程图，写法见 `skills\detailed-design\references\flowchart-guide.md`。Word 2010 及以上、WPS 应能正常显示（开发环境中只用 LibreOffice 核对过，请在 Word/WPS 中确认）。

**怎么判断效果：**三份输入文件之间埋了 4 处矛盾或缺漏，文件里没有提示。好的详细设计应把它们列为待确认问题，而不是悄悄选一个。答案表和评分方法见 [evals\detailed-design\README.md](evals/detailed-design/README.md)。

**逆向模式（为已有代码补写详细设计）：**运行 `node evals\detailed-design\prepare.mjs reverse` 把示例代码放进工作区，新建会话后要求“为 oc_ctrl 补写详细设计说明，逆向设计”。代码中有 9 处与上级文件不一致，详细设计应把它们列入“代码与上级文件不一致清单”，不能照代码写成设计。

### 单元测试

**先装 gcc。**推荐 MSYS2（[msys2.org](https://www.msys2.org/) 下载安装，默认装到 `C:\msys64`），装好后打开开始菜单里的“MSYS2 UCRT64”，执行：

```bash
pacman -S mingw-w64-ucrt-x86_64-gcc      # gcc、g++、gcov，GCC 14 以上可测 MC/DC
pacman -S mingw-w64-ucrt-x86_64-gtest    # 可选：测 D2000 Linux 代码时用
```

然后在 `config\local.env` 中填 `UTEST_CC=C:\msys64\ucrt64\bin\gcc.exe`（g++ 和 gcov 自动取同一目录），重新运行 `setup.ps1`、`check.ps1`。自检中“单元测试服务 utest”一项会编译运行一个小例子，并显示是否支持 MC/DC 测量。没装 gcc 时这一项显示警告，智能体仍可设计用例、写测试代码，但不能编译运行。

在 `sample` 工作区中**新建会话**，输入：

```text
对 utest\cmd_check 做单元测试。被测代码在 src，详细设计是 doc\cmd_check-详细设计.md，目标平台 BM3803，用手写驱动和桩，测试代码放在 utest\cmd_check\test，最后写单元测试报告。
```

预期过程：智能体加载 `unit-test-design` Skill，按详细设计设计用例（等价类、边界值、判定和 MC/DC、检查优先级、计数回绕和饱和），用 `utest.h` 写驱动，调用 `mcp__utest__run_unit_tests` 编译运行，根据未覆盖的行补用例，对复合判定写 MC/DC 分析表并用 `mcp__utest__check_mcdc` 核对，最后写报告并运行 `check-ut.mjs` 自查。

**怎么判断效果：**`src\cmd_check.c` 中埋了 6 个缺陷（边界写错、缺括号、计数回绕、同步字只查一半等），代码里没有提示。好的测试应当有用例失败，并把它们列为疑似缺陷，而不是把预期改成代码的实际输出。智能体完成后，在本目录运行评分：

```powershell
node evals\unit-test\score.mjs cmd_check
```

评分脚本用**正确的参考版**源码运行智能体写的测试，给出：预期结果错误数（在正确代码上失败，说明预期是照着有缺陷的代码写的）、6 个缺陷检出了几个、22 个变异体杀死了几个、覆盖率，以及被测代码有没有被改动。人工写的参考测试成绩为：预期错误 0，缺陷 6/6，变异 22/22，语句、分支 100%。评分方法和报告的人工检查要点见 [evals\unit-test\README.md](evals/unit-test/README.md)。

**示例 2：串口驱动 uart_drv。**cmd_check 没有寄存器、下层函数和等待循环。`utest\uart_drv` 是一个 RS-422 串口收发驱动：寄存器通过读写宏访问，调用 `sys_ticks`（系统时间）和 `irq_lock`/`irq_unlock`（关中断），发送时带超时等待，接收在中断服务程序中进行。智能体要自己替换寄存器头文件、写寄存器模型和桩，主机上才能运行。埋了 7 个缺陷，其中写入顺序错误、tick 回绕、关中断不配对等，只看返回值和寄存器最终值是发现不了的。

```text
对 utest\uart_drv 做单元测试。被测代码在 src，头文件在 include，详细设计是 doc\uart_drv-详细设计.md，目标平台 BM3803，用手写驱动和桩，测试代码放在 utest\uart_drv\test，最后写单元测试报告。
```

```powershell
node evals\unit-test\score.mjs uart_drv --run sample\.utest\uart_drv\last-run.json
```

人工参考测试的成绩：31 个用例，预期错误 0，缺陷 7/7，变异 26/26，语句、分支 100%。

**MC/DC：**GCC 14 及以上，utest 服务用 `-fcondition-coverage` 直接测量；GCC 13 及以下不能测量，Skill 要求智能体为每个复合判定写 MC/DC 分析表（每个条件的独立影响对），用 `check_mcdc` 核对，报告中写“未测量，分析表核对……”，不写百分比。

**注意：**

- 测试在笔记本（x86，小端）上运行。字节序、`char` 符号、非对齐访问、寄存器和中断时序等与目标机有关的问题，主机测试发现不了，报告中会单独列出需要上目标机验证的项。
- 构建目录在工作区的 `.utest\` 下，每次运行会清空重建。
- 重测前把 `sample\utest\<模块>\test` 改名或删除，并新建会话。被测代码被改坏时，运行 `node evals\unit-test\build-sample.mjs <模块>` 恢复。
- GCC 16.2（MSYS2）的 MC/DC 测量已在笔记本上实测通过。gtest 还没有实测，第一次用时请把结果发给我核对。
- 评分脚本可以直接在 PowerShell 中运行，会自己读取 `config\local.env` 中的 `UTEST_CC`；报告检查脚本不需要编译器。

### 文档读写工具

两个文档服务也可以单独使用，例如：

- `读一下 docs\软件研制任务书-示例.docx 的目录结构` — 只看章节结构，适合长文档
- `把 req 下的需求分析报告生成 Word，模板用 demo-gjb438b` — 生成 Word
- `把需求分析报告里的待确认问题清单导出成 Excel` — 导出单个表格

| 服务 | 工具 | 说明 |
|---|---|---|
| docreader | `read_document` | 读 .docx/.xlsx/.pdf/.md/.txt，输出 Markdown：保留标题层级和自动编号的章节号、表格（合并单元格展开）、列表编号、批注、脚注；图片输出占位符；长文档分段读取。旧版 .doc/.xls/.wps 需先另存为新格式 |
| docgen | `list_templates` | 列出模板及其封面字段、标题样式识别结果 |
| docgen | `render_docx` | Markdown 套模板生成 Word：标题用模板样式（模板自动编号时去掉手写章节号）、表格加边框和重复表头、“表 x-x”段落设为题注、插入目录域、填写封面字段 |
| docgen | `export_xlsx` | Markdown 中的表格导出 Excel：表头相同的表合并为一个工作表，可在右侧追加评审列（如“评审意见”“答复”“状态”），表头冻结可筛选，待确认单元格标黄 |

**写入范围：**MCP 服务运行在 DSH 沙箱之外，所以 `docgen` 自己限制写入目录：默认只能写启动 DSH 时的工作区（`sample`），且不覆盖已有文件。在界面里换了其他工作区时，要在 `config\local.env` 的 `DOC_ALLOWED_ROOTS` 中加上该目录，然后重启 `start-web.ps1`。`docreader` 只读。

**进内网后换模板：**把部门正式模板放进 `config\templates`，在模板中加 `{{正文}}`、`{{目录}}`、`{{字段名}}` 占位符。部门模板使用自定义样式名时，另配一个同名 `.json` 映射文件。详见 [config\templates\README.md](config/templates/README.md)。

**依赖：**两个服务的 docx/xlsx 读写只用 Node 自带模块，额外依赖只有 Cppcheck 服务已在用的 MCP SDK 和 zod，导入内网时不增加需要审查的包。读 PDF 需要可选依赖 `pdfjs-dist`，内网 npm 镜像没有这个包时只影响 PDF，Word 和 Excel 照常可用。演示模板可用 `node mcp\docgen\make-demo-template.mjs` 重新生成。

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

**加一个 Skill：**可参考 `skills\requirements-analysis\` 的组织方式：`SKILL.md` 只写步骤和约束，检查表、规则、模板放在 `references\` 下。在 `skills\` 下新建目录，写一个 `SKILL.md`（开头是 `name` 和 `description`，其余是 Markdown 指令），重新运行 `setup.ps1`（只会复制配置，不会重装）。也可以直接放到工作区的 `.dsh\skills\` 下，只对该项目生效。名称必须是小写加连字符，如 `unit-test-design`。

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
| 智能体说没有 `mcp__utest__*` 工具，或自检提示找不到 C 编译器 | 重新运行 `setup.ps1`；在 `config\local.env` 中填 `UTEST_CC`（gcc.exe 的完整路径）后重启 `start-web.ps1` |
| 单元测试链接失败，提示 `undefined reference` | 被测代码调用了测试工程中没有的函数，需要写桩。工具会列出缺少的函数 |
| 智能体说没有 `mcp__docreader__*` / `mcp__docgen__*` 工具 | 更新本工程后要重新运行 `setup.ps1`（安装新服务的依赖、重新生成 `cordis.patch.yml`），再重启 `start-web.ps1` |
| 生成 Word 时提示“不允许写到……” | 输出目录不在 `DOC_ALLOWED_ROOTS` 中。在 `config\local.env` 中加上该目录后重启 `start-web.ps1` |
| 读 Word 提示“不是有效的 ZIP 文件” | 文件是旧版 .doc 或 WPS 的 .wps 格式，用 Word/WPS 另存为 .docx |
| 浏览器打开后 401 | 地址要带启动时打印的 `?token=...`；重新从启动窗口复制完整地址 |
| 模型说“工作区下没有 src”，然后到处找文件 | 会话开在了默认工作区。在界面左侧添加 `sample` 文件夹作为工作区，在其中新建会话 |
| 想清空所有会话重新开始 | 停止服务后删除 `runtime\dsh-home\sessions` |

## 版本说明

- DSH 锁定为 `0.2.1-rc.2`（2026-10-17 发布的开发者预览版）。升级前先在测试目录验证，不要直接改成 latest。
- 2026-10-23 已在 Windows 笔记本 + DeepSeek 官方 API 上实测：走查示例代码约 3.5 分钟、27 次工具调用，报告覆盖了全部埋入的缺陷。示例代码带有“缺陷：”提示注释，这个结果偏乐观，不能代表真实代码上的效果。
