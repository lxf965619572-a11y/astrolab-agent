# 编码 Skill 评估

用一个虚构模块 thm_ctrl（4 路加热回路：主备份热敏电阻、连续计数判故障和恢复、回差开关、10 min 加热时限、大端遥测帧）检验 coding Skill：按设计写代码、发现并提出矛盾、编译和静态检查、写编码说明。

| 文件 | 说明 |
|---|---|
| `sample/coding/thm_ctrl/` | 输入（由 `prepare.mjs` 放进 AstroLab 的示例工程）：`doc/thm_ctrl-详细设计.md`、`include/thm_ctrl.h`、`include/thm_hw.h`。头文件注释里埋了与设计矛盾的地方 |
| `thm_ctrl/inputs/` | 上述输入的原样，`prepare.mjs` 用它恢复工作区，`score.mjs` 用它检查有没有被改 |
| `thm_ctrl/hidden-test/` | 隐藏测试（16 个用例，按设计推导）和硬件桩，**不要给智能体看** |
| `thm_ctrl/reference/` | 参考实现：隐藏测试 16/16，严格编译 0 告警，自查脚本 0 项 |
| `thm_ctrl/mutants.json` | 26 个典型错误；`mutants.mjs` 检查每个都被隐藏测试抓到 |
| `thm_ctrl/答案表.md` | 必须提出的问题、考点、评分（**不要给智能体看**） |
| `prepare.mjs`、`score.mjs` | 准备工作区、评分 |

隐藏测试、参考实现和答案表都在 `evals\` 下，不在示例工程里，智能体读不到。

**示例工程在哪里**：AstroLab 第一次运行时把仓库的 `sample` 复制到数据目录的 `workspace\sample`，之后智能体读写的是这份副本（开发环境是 `runtime\app-data\workspace\sample`，安装后是 `%LOCALAPPDATA%\AstroLab\workspace\sample`）。`prepare.mjs` 和 `score.mjs` 按同样的规则找到它，并在开头打印路径；要指定别的目录，`score.mjs` 加 `--ws <目录>`。

## 步骤

1. 准备工作区（把输入放进示例工程的 `coding\thm_ctrl`；上一次的代码和编码说明移到 `evals\coding\results\`，输入恢复原样）：

   ```text
   node evals\coding\prepare.mjs
   ```

2. 在 AstroLab 中打开 `sample` 工作区，切到**编码**模式，选**编码**技能，新建任务，输入：

   ```text
   按 coding\thm_ctrl\doc\thm_ctrl-详细设计.md 实现 thm_ctrl 模块的全部函数。头文件在 coding\thm_ctrl\include，不要改；代码写到 coding\thm_ctrl\src\thm_ctrl.c。目标平台 BM3803，C99。
   ```

3. 智能体提问时，按 `thm_ctrl\答案表.md` 第 0 节回答，并记下它问了什么。
4. 完成后评分：

   ```text
   node evals\coding\score.mjs
   ```

   结果在 `evals\coding\results\<时间>-thm_ctrl\summary.md`，同时保存了代码和编码说明的副本。
5. 对照答案表：第 1 节 Q1～Q3（`summary.md` 第 6 节给出疑似位置，人工确认）；第 3 节两项人工核对；第 4 节加分项。写评估记录 `评估记录-thm_ctrl-<日期>.md`：环境、模型、用时、用量、提了哪些问题、各项得分、发现的技能问题。

每次评测之间都新建任务，并重新运行 `prepare.mjs`。

## 验证评测本身

修改隐藏测试、参考实现或 `mutants.json` 后运行：

```text
node evals\coding\mutants.mjs
```

要求参考实现全部通过、26 个变体全部被抓到。需要 gcc（`config\local.env` 中的 `UTEST_CC`，与单元测试相同）；Cppcheck 找不到时 `score.mjs` 该项记“未运行”。

## 说明

- 技能的“常见错误做法”表里有“连续 3 次校验失败”的例子，与 T06、T07 重叠，这两项结果会偏乐观。头文件与设计矛盾（Q1、Q3）在技能中没有提示；第 1 次评测后技能第 2 步加了“异常情况下输出处于什么状态”的检查，此后 Q2 的结果也会偏乐观。
- 第 6 节的线索是关键词匹配，只在编码说明和代码注释里找；“未发现”不等于没提出（可能只在对话中提问），以任务记录为准。
