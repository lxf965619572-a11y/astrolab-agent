# 概要设计 Skill 评估

用一个虚构的配置项“热控单元软件 TCUS”（BM3803，RS422 遥控遥测、32 路测温、16 路加热器、看门狗、EEPROM 三份参数、SRAM 刷新）检验 preliminary-design Skill。

| 文件 | 说明 |
|---|---|
| `sample/design/tcu/docs/` | 工作区中的输入：需求规格说明（25 条需求）、硬件接口说明（摘录）、与平台通信协议（.docx），文件之间埋有矛盾、缺漏和时序问题 |
| `tcu/docs-md/` | 上述文件的 Markdown 原稿 |
| `tcu/答案表.md` | 答案（**不要给智能体看**）：必须提出的问题 F1～F5、必须正确处理的 G1～G10、误报陷阱 T1～T6、加分项 B1～B7 |
| `tcu/reference/` | 人工编写的参考概要设计，用于验证检查脚本和 Word 转换 |
| `prepare.mjs` | 准备工作区：把上一次的输出移到 `results/` |
| `评估记录-tcu-20261025.md` | 第 1 次评估记录 |
| `评估记录-概要到详细衔接-htr_out-20261025.md` | 用概要设计的输出跑 htr_out 详细设计，检验两个 Skill 的衔接 |

**示例工程**：AstroLab 第一次运行时把仓库的 `sample` 复制到数据目录的 `workspace\sample`，智能体读写的是这份副本（开发环境 `runtime\app-data\workspace\sample`，安装后 `%LOCALAPPDATA%\AstroLab\workspace\sample`）。评测脚本自动找到它并在开头打印路径；下面命令里的 `$S` 是它的位置，先在 PowerShell 里运行 `$S = node evals\sample-ws.mjs`。仓库里的 `sample` 只是种子，新版本新增的示例文件由应用启动时补进示例工程。

## 步骤

1. `node evals\preliminary-design\prepare.mjs`
2. 在 `sample` 工作区**新建会话**（Skill 改动后不用重新运行 setup.ps1，新建会话即可），输入：

   ```text
   按 design\tcu\docs 下的软件需求规格说明、硬件接口说明和与平台通信协议，编写热控单元软件（TCUS）的概要设计说明，目标平台 BM3803，裸机，保存到 design\tcu\doc，并生成 Word，待确认问题导出 Excel。
   ```

3. 检查：

   ```powershell
   node skills\preliminary-design\scripts\check-hld.mjs $S\design\tcu\doc\概要设计说明-TCUS-<日期>.md --srs $S\design\tcu\docs\TCUS软件需求规格说明.docx
   ```

4. 对照 `tcu\答案表.md` 评分（第 5 节有评分方法），另外记录：检查脚本第一次运行的结果、需求追溯是否完整、时序分析的计算是否正确、有没有编造的数值。
5. 打开生成的 Word，看启动流程图、主循环流程图是否正常。

## 说明

- Skill 的检查表（architecture-checklist.md）、时序分析方法（timing-analysis.md）和“常见错误做法”是通用的嵌入式设计知识，其中“外设缓冲深度与服务间隔”“tick 计时等待要多等一个 tick”“看门狗不在中断中喂”“不能忙等，改为分步”“安全约束放在唯一出口”“资源要写估算方法”“遥测内容在帧中是否都有位置”等条目与 G1～G4、G7、G8、F2 重叠，这部分结果会偏乐观。F1、F3、F4、F5 在 Skill 中没有提示，这部分是真实的检验。
- 参考概要设计在检查脚本下的结果为 0 项（`--srs` 用 .docx 和 .md 都试过）；Word 中启动流程图、主循环流程图转换正常（LibreOffice 渲染核对）。
- 用参考设计改出 13 处问题（漏摘需求、需求未分配、时序结论与数值矛盾、时间要求未分析、共享数据无保护、“以 SRS 为准”、含糊词、无出处的地址、缺模块接口小节、中断中喂狗、资源余量不足却写满足、引用不存在的 Q、流程图判断少一个出口），检查脚本全部报出。
- 概要设计的输出可以直接作为详细设计的输入：每个模块在 5.2、6.2、6.5、7.2 中有职责、需求、执行环境、接口和共享数据。以后可以用本示例的输出接着跑详细设计，检验两个 Skill 能否衔接。
