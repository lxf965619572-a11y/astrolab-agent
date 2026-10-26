# 详细设计 Skill 评估

用一个虚构模块 oc_ctrl（OC 指令输出控制：GPIO 置位/清除寄存器、回读校验、1 ms 定时中断计时、安全模式限制、全部断开）检验 detailed-design Skill 的两种模式。

| 文件 | 说明 |
|---|---|
| `sample/design/oc_ctrl/docs/` | 工作区中的输入：需求规格说明、概要设计说明、OC 输出控制器接口说明的摘录（.docx），文件之间有埋入的矛盾和缺漏 |
| `oc_ctrl/docs-md/` | 上述文件的 Markdown 原稿 |
| `oc_ctrl/src/` | 逆向模式用的代码（按概要设计实现，另有 7 处缺陷），由 `prepare.mjs reverse` 复制到工作区 |
| `oc_ctrl/答案表.md` | 正向、逆向两种模式的答案（**不要给智能体看**） |
| `oc_ctrl/reference/` | 人工编写的参考详细设计（正向模式），用于验证检查脚本和 Word 转换 |
| `prepare.mjs` | 准备工作区 |

## 正向模式

1. `node evals\detailed-design\prepare.mjs forward`（删除工作区中的代码，上一次的输出移到 `evals\detailed-design\results\`）
2. 在 `sample` 工作区**新建会话**，输入：

   ```text
   按 design\oc_ctrl\docs 下的需求规格说明、概要设计说明和 OC 输出控制器接口说明，编写 oc_ctrl 模块的详细设计说明，正向设计，目标平台 BM3803，保存到 design\oc_ctrl\doc，并生成 Word。
   ```

3. 检查：`node skills\detailed-design\scripts\check-design.mjs sample\design\oc_ctrl\doc\详细设计说明-oc_ctrl-<日期>.md`
4. 对照 `oc_ctrl\答案表.md` 第 1 节评分：
   - 必须提出的问题 F1～F4（4 个）提出了几个，有没有不加说明地选择其中一方；
   - 必须正确处理的 F5～F11（7 个）处理了几个；
   - 误报陷阱 T1～T5 误报了几个；
   - 加分项 B1～B4；
   - 质量要求：函数是否齐全、处理步骤是否能直接推导单元测试预期、流程图是否与步骤一致。
5. 打开生成的 Word，看流程图是否正常。

## 逆向模式

1. `node evals\detailed-design\prepare.mjs reverse`（把代码复制到 `sample\design\oc_ctrl\src`、`include`）
2. **新建会话**，输入：

   ```text
   design\oc_ctrl 下已有代码（src、include），请按 docs 下的需求规格说明、概要设计说明和 OC 输出控制器接口说明，为 oc_ctrl 补写详细设计说明，逆向设计，目标平台 BM3803，保存到 design\oc_ctrl\doc。
   ```

3. 检查：`node skills\detailed-design\scripts\check-design.mjs sample\design\oc_ctrl\doc\详细设计说明-oc_ctrl-<日期>.md --code sample\design\oc_ctrl`
4. 对照答案表第 2 节：R1～R9（9 处）在不一致清单中列出了几处；有没有把代码行为写成设计（如“脉宽下限 10 ms”而不提 SRS 的 20 ms）。

两种模式之间要新建会话，并重新运行 `prepare.mjs`。

## 说明

- Skill 的设计检查表（design-checklist.md）包含“先断开输出再使能”“回读稳定时间”“全部断开时清除等待执行的指令”“定时精度”等通用检查项，与本示例的部分考点重叠，结果会偏乐观。答案表中的矛盾类问题（F1～F4）在 Skill 中没有提示。
- 参考详细设计在检查脚本下的结果为 0 项，Word 中流程图 3 幅、调用关系图 1 幅转换正常（LibreOffice 渲染核对）。
