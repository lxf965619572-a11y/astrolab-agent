// 浏览器里的模拟接口：没有 Electron 时使用。按剧本生成与真实引擎相同格式的会话事件，
// 用真实的事件整理代码（engine/activity.mjs）得到活动记录，界面看到的数据与实机一致。
// 只用于开发和截图检查；URL 带 ?scene=task|review|ask|launch 可以直接进入某个画面。

import type { AppState, Project, AstroApi, AstroEvent, CatalogItem, Change, Item, KbEntry, KbHit, KbMeta, LibSource, Question, SkillCard, StartInput, Task, TaskState, UpdateState, InboxItem, InboxReport, RefDoc, RefRead, RefTranslation, RefHighlight, ModelProbe, ModelProfile, ModelPreset, ModelList, Schedule, ScheduleState, ScheduleTemplate, WebState } from './api'
import { describeTrigger, nextRun } from './schedule'
// @ts-expect-error 纯 JS 模块（主进程用），没有类型声明
import { TEMPLATES } from '../main/schedule-templates.mjs'
const SCHEDULE_TEMPLATES = TEMPLATES as ScheduleTemplate[]
// @ts-ignore 纯 JS 模块
import { applyEvent, createActivity, plainItem, summarize } from '../engine/activity.mjs'
import { categoryMode } from './modes'

const STAGES = [
  { id: 'requirements', name: '需求分析', skill: 'requirements-analysis', hasSkill: true },
  { id: 'hld', name: '概要设计', skill: 'preliminary-design', hasSkill: true },
  { id: 'dd', name: '详细设计', skill: 'detailed-design', hasSkill: true },
  { id: 'coding', name: '编码', skill: 'coding', hasSkill: false },
  { id: 'utest', name: '单元测试', skill: 'unit-test-design', hasSkill: true },
  { id: 'review', name: '代码走查', skill: 'code-walkthrough', hasSkill: false },
]
// 技能卡片（取自各技能 SKILL.md 的头信息）
const SKILLS: SkillCard[] = [
 {
  "name": "requirements-analysis",
  "summary": "任务书、ICD → 需求规格说明（部门模板），标出说不清的地方",
  "title": "需求分析",
  "description": "依据单机软件研制任务书、技术要求、接口控制文件（ICD）等上级材料做航天嵌入式软件需求分析，按部门模板编写《软件需求规格说明》：功能分解（数据流图）、IPO 格式的功能需求、性能/可靠性/安全性/接口需求、专项分析（时序、数据访问冲突、时间系统、数据有效性）、测试要求、安全关键功能要求、数据字典和跟踪矩阵，同时写需求分析记录（上级条款摘录、覆盖分析、待确认问题）。当用户要求需求分析、梳理任务书或技术要求、编写软件需求规格说明、划分配置项、梳理接口、检查需求条目时使用。",
  "category": "需求",
  "keywords": [
   "需求",
   "任务书",
   "ICD",
   "需求规格",
   "追溯"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：根据任务书第 3 章整理 RT 通信软件的需求规格",
  "hint": "按部门需求规格说明模板逐条编号，并标出任务书里说得不清的地方",
  "report": "生成需求规格说明（部门模板）"
 },
 {
  "name": "preliminary-design",
  "summary": "需求 → 模块划分、接口和运行设计（部门模板）",
  "title": "概要设计",
  "description": "依据软件需求规格说明、硬件接口文件和通信协议（ICD），按部门模板编写航天嵌入式软件配置项的《软件概要设计说明》：总体概述、关键问题及技术方案、体系结构（任务调度、层次结构、源文件结构、集成顺序）、外部接口和数据有效性判断、中断任务和共享资源分析、时间系统、运行设计（顶层流程、堆栈和时间预算、内存分配）、数据构成、可靠性安全性措施、可复用设计、需求跟踪矩阵；同时写概要设计记录（设计依据摘录、设计决策、最坏情况时序分析、资源估算、待确认问题）。当用户要求写概要设计、软件结构设计、体系结构设计、模块划分或需求分配时使用。",
  "category": "设计",
  "keywords": [
   "概要设计",
   "模块划分",
   "接口",
   "架构"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：为 RT 通信软件划分模块并定义接口",
  "hint": "每个模块都会按标识逐条追溯到需求，缺口会单独列出",
  "report": "生成概要设计说明（部门模板）"
 },
 {
  "name": "detailed-design",
  "summary": "写到每个软件单元的输入输出、处理流程和限制条件（部门模板）",
  "title": "详细设计",
  "description": "依据软件需求规格说明、概要设计说明和硬件接口文件，按部门模板编写航天嵌入式软件配置项的《软件详细设计说明》（每个配置项一份，第 4 章按模块逐步补充）：模块设计（单元划分、调用关系、模块数据），每个软件单元（含 static 函数）的简述、输入输出（形参和返回值、数据元素、全局变量或资源、中断和信号量）、局部变量、处理流程和流程图、限制条件，设计决策、复用说明、跟踪矩阵和确认检查表；同时写详细设计记录（设计依据摘录、待确认问题、代码与上级文件不一致清单）。也支持已有代码时补写详细设计。当用户要求写详细设计、软件单元设计、函数设计、程序流程图，或为已有代码补写设计文档时使用。",
  "category": "设计",
  "keywords": [
   "详细设计",
   "函数",
   "流程图",
   "数据结构"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：写 rt_drv 模块的详细设计，含流程图",
  "hint": "每个配置项一份文档，按模块逐步补充；流程图以 Word 可编辑的形式放进文档",
  "report": "生成详细设计说明（部门模板）"
 },
 {
  "name": "coding",
  "summary": "按详细设计写 C 代码，编译并跑 Cppcheck",
  "title": "编码",
  "description": "依据详细设计为航天嵌入式软件（SPARC BM3803/3823/3883 裸机、飞腾 D2000 Linux）编写或修改 C 代码：逐个函数对照设计实现，遵守 GJB 8114-2013 强制准则和部门 C 编码规则，写文件头和函数头注释并标注设计追溯，用严格告警编译、用 Cppcheck 检查，问题修完后按走查检查表自查，输出编码说明和详细设计与代码追踪表。当用户要求按设计写代码、实现某个函数或模块、按设计修改代码、修复走查或测试发现的问题时使用。",
  "category": "编码",
  "keywords": [
   "编码",
   "实现",
   "代码",
   "编译",
   "修复"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：按详细设计 4.2 实现 rt_reset 和 rt_stack_push",
  "hint": "写完会用平台编译器编译、跑 Cppcheck，问题修完再交给你",
  "report": "附编码说明、静态检查结果和追踪表"
 },
 {
  "name": "unit-test-design",
  "summary": "设计用例、写驱动和桩，跑测试出报告",
  "title": "单元测试",
  "description": "依据详细设计为航天嵌入式 C 软件模块设计单元测试：分析被测函数，按等价类、边界值、判定/条件/MC/DC 设计用例，编写手写驱动和桩（SPARC 等裸机代码）或 gtest 用例（D2000 Linux 代码），在主机上编译运行并统计语句、分支、MC/DC 覆盖率，记录疑似缺陷和未覆盖项，写单元测试记录，并按部门模板生成单元测试报告。当用户要求单元测试、写测试用例、写驱动和桩、补覆盖率、分析 MC/DC 时使用。",
  "category": "测试",
  "keywords": [
   "单元测试",
   "测试用例",
   "覆盖率",
   "桩",
   "驱动"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：为 rt_drv 和 rt_msg 设计并运行单元测试",
  "hint": "预期值只取自设计，失败不会改预期；疑似缺陷会单独列出",
  "report": "生成单元测试报告（部门模板）"
 },
 {
  "name": "code-walkthrough",
  "summary": "按 GJB 8114 和部门检查表走查，出走查报告",
  "title": "代码走查",
  "description": "按 GJB 8114-2013 编程规则和部门嵌入式检查表对 C 代码（SPARC BM3803/3823/3883 或 D2000）进行走查：运行 Cppcheck、GJB 8114 规则扫描和代码度量，逐条甄别告警，逐函数人工走查，做数据访问冲突、数据有效性、单粒子防护、时序等专项检查，写走查记录，并按部门模板生成软件走查报告（含问题报告单）。当用户要求代码走查、代码审查、规范检查、告警甄别时使用。",
  "category": "走查",
  "keywords": [
   "走查",
   "审查",
   "规范检查",
   "GJB 8114",
   "Cppcheck",
   "专项检查"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：走查 rt_msg.c，重点看中断和共享数据",
  "hint": "每条告警都要甄别，每个问题都有行号、规则和严重等级",
  "report": "生成走查报告（部门模板）"
 },
 {
  "name": "static-analysis",
  "summary": "度量和规则检查，出静态分析报告",
  "title": "静态分析",
  "description": "对嵌入式 C 软件（SPARC BM3803/3823/3883 或 D2000）做静态分析：统计规模、圈复杂度、扇入扇出、注释率，按 GJB 8114-2013 检查编程规则执行情况，逐条甄别 Cppcheck 和规则扫描告警，分析超标模块，写静态分析记录，并按部门模板生成静态分析报告。部门工具（TESTBED、SpecChecker）有结果时以工具结果为准。当用户要求静态分析、代码度量、圈复杂度统计、编程规范符合性检查时使用。",
  "category": "走查",
  "keywords": [
   "静态分析",
   "圈复杂度",
   "扇入扇出",
   "注释率",
   "代码度量",
   "GJB 8114"
  ],
  "source": "builtin",
  "pinned": false,
  "placeholder": "例如：对 src 做静态分析，出 V1.00 的静态分析报告",
  "hint": "度量数据有出处，每条告警都要甄别，超标模块逐个分析",
  "report": "生成静态分析报告（部门模板）"
 },
 {
  "name": "confirmation-test",
  "summary": "按需求设计确认测试用例，执行后出确认测试报告",
  "title": "确认测试",
  "description": "依据软件需求规格说明为航天嵌入式软件配置项设计确认测试（配置项测试）用例：按需求、测试要点、安全关键功能和部门健壮性要求设计可判定的用例，列出不可测试项，导出执行记录表给测试人员在半物理仿真或软平台上执行，导入执行结果后按部门模板 05 生成确认测试报告（统计、测试要点跟踪、不可测试项跟踪、安全关键功能、问题报告单、正向逆向跟踪矩阵）。当用户要求确认测试、配置项测试、设计测试用例、写确认测试报告时使用。",
  "category": "测试",
  "keywords": [
   "确认测试",
   "配置项测试",
   "测试用例",
   "测试要点",
   "跟踪矩阵",
   "确认测试报告"
  ],
  "source": "builtin",
  "pinned": false,
  "placeholder": "例如：按 req 下的需求规格说明设计 TCU 软件 V1.00 的确认测试用例",
  "hint": "每条需求都有用例或列为不可测试项；实际结果只从测试人员的执行记录导入",
  "report": "生成确认测试报告（部门模板）"
 },
 {
  "name": "dev-summary",
  "summary": "汇总研制过程，按Ⅰ、Ⅲ、Ⅳ类出研制总结报告",
  "title": "研制总结",
  "description": "为航天嵌入式软件配置项编写软件研制总结报告（部门模板 07 Ⅰ类沿用软件、09 Ⅲ类适应性更改和Ⅳ类全新研制）：先生成研制信息表，从工作区文档自动预填，再从数据包文件逐项摘录并标出处，缺的问用户；然后按研制类型生成报告，并按部门评审要点检查版本、日期、实测值、更改、数据包、覆盖性、产保确认合计、固化和结论。当用户要求写研制总结、研制总结报告、软件验收总结时使用。",
  "category": "文档与图",
  "keywords": [
   "研制总结",
   "研制总结报告",
   "软件验收",
   "沿用软件",
   "产品保证",
   "数据包"
  ],
  "source": "builtin",
  "pinned": false,
  "placeholder": "例如：TCU 软件是Ⅲ类，数据包在 package 目录下，写 V1.01 的研制总结报告",
  "hint": "每个事实都要有出处；找不到的写【待补充】问用户，不编日期和数字",
  "report": "生成研制总结报告（部门模板）"
 },
 {
  "name": "skill-authoring",
  "summary": "把一项工作的做法写成部门技能",
  "title": "技能创作",
  "description": "和用户一起把一项研发工作的做法写成部门技能（SKILL.md + 参考资料 + 检查脚本 + 试用用例），放进“我的库”的 skills/ 下，试用通过后再提交到共享库审核。当用户要求新建技能、把自己的做法或部门规范做成技能、改进已有技能时使用。",
  "category": "创作",
  "keywords": [
   "技能",
   "创作",
   "做法"
  ],
  "source": "builtin",
  "pinned": false,
  "placeholder": "例如：把我们做 FPGA 接口走查的方法写成技能",
  "hint": "智能体会先问你几个问题，再把技能写进我的库"
 },
 {
  "name": "plugin-authoring",
  "summary": "技能 + 工具服务打成一个插件",
  "title": "插件创作",
  "description": "和用户一起做一个部门插件：把一项工作需要的技能、工具服务（MCP，给智能体调用的检查、计算、转换工具）和模板打成一个包，放进“我的库”的 plugins/ 下，试用通过后提交到共享库审核，大家一键安装。当用户要求做插件、给智能体加一个新工具、把一个检查程序或计算脚本接给智能体用时使用。",
  "category": "创作",
  "keywords": [
   "插件",
   "工具",
   "MCP"
  ],
  "source": "builtin",
  "pinned": false,
  "placeholder": "例如：做一个计算和核对 CRC 的插件",
  "hint": "技能 + 工具服务打成一个包，试用通过后提交共享库"
 },
 {
  "name": "info-flow",
  "summary": "文档 → 信息流模型，出总图、链路图和 N² 矩阵",
  "title": "信息流梳理",
  "description": "把任务书、需求规格说明、ICD 等材料梳理成信息流模型，出泳道信息流图（全图、总图、分图、链路图）和 N² 接口矩阵，列出依据和待确认问题。用户说“画信息流图”“梳理一下项目的信息流”“给需求文档画一张总体图”“画模块/接口关系图”“把数据流向画出来”“这条指令经过哪些环节”“核对接口齐不齐”时使用。",
  "category": "文档与图",
  "keywords": [
   "信息流",
   "流程图",
   "接口关系",
   "N2"
  ],
  "source": "mine",
  "plugin": "info-flow-diagram",
  "pinned": true,
  "placeholder": "例如：根据任务书和 ICD 画 PCU 软件的总体信息流",
  "hint": "先建信息流模型，再出全图、总图、链路图和 N² 接口矩阵"
 },
 {
  "name": "spw-review",
  "summary": "按部门规范走查 SpaceWire 报文和超时",
  "title": "SpaceWire 报文走查",
  "description": "按部门 SpaceWire 通信设计规范走查报文头、长度、CRC 和超时处理。用户要求走查 SpaceWire 报文或通信程序时使用。",
  "category": "走查",
  "keywords": [
   "SpaceWire",
   "报文",
   "CRC"
  ],
  "source": "installed"
 }
]

// 很宽很长的文件（像信息流插件画的 SVG）：用来检查长行不会把页面撑宽
const LONG_SVG = ['<svg xmlns="http://www.w3.org/2000/svg" width="1480" height="620" viewBox="0 0 1480 620" font-family="Microsoft YaHei, sans-serif">',
  ...Array.from({ length: 160 }, (_, i) => `  <rect x="${274 + i}" y="${114.5 + i}" width="137.3" height="18" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#e2e8f0"/><text x="${342.6 + i}" y="127.5" text-anchor="middle" font-size="11" fill="#d97706">遥测请求、指令码 等 ${i} 条，这一行故意写得很长很长，用来检查横向滚动只在代码区域里发生，而不会把整个页面撑宽</text>`), '</svg>'].join('\n')
const FILES = [
  'utest/rt1553/doc/rt1553-详细设计.md', 'utest/rt1553/src/rt_drv.c', 'utest/rt1553/src/rt_msg.c', 'utest/rt1553/src/rt_hw.h',
  'utest/rt1553/include/rt_drv.h', 'utest/rt1553/include/rt_msg.h', 'utest/cmd_check/doc/cmd_check-详细设计.md',
  'utest/cmd_check/src/cmd_check.c', 'utest/uart_drv/src/uart_drv.c', 'docs/软件研制任务书-示例.docx',
  'diagrams/PCU-软件总体信息流（示例）-总图.svg',
]
const TEST_C = `#include "ut_assert.h"
#include "rt_drv.h"
#include "stub_hw.h"

/* TC-RT-DRV-007 复位等待：9 tick 仍未就绪，应返回超时 */
static void tc_reset_wait_9(void)
{
    stub_hw_ready_after(10);
    UT_EQ(RT_ERR_TIMEOUT, rt_reset(9));
}

/* TC-RT-DRV-008 复位等待：第 10 tick 就绪，应返回成功 */
static void tc_reset_wait_10(void)
{
    stub_hw_ready_after(10);
    UT_EQ(RT_OK, rt_reset(10));
}

/* TC-RT-DRV-021 描述符堆栈：连续写 65 项，第 65 项应回到第 0 项 */
static void tc_stack_wrap(void)
{
    for (int i = 0; i < 65; i++) rt_stack_push(i);
    UT_EQ(0u, rt_stack_index());
}
`
const STUB_C = `/* 硬件桩：模拟复位后的就绪位，只在主机测试中使用 */
#include "stub_hw.h"

static unsigned s_ready_tick;
static unsigned s_now;

void stub_hw_ready_after(unsigned tick)
{
    s_ready_tick = tick;
    s_now = 0u;
}

unsigned hw_read_status(void)
{
    s_now++;
    return (s_now >= s_ready_tick) ? HW_ST_READY : 0u;
}
`
const RT_DRV_BEFORE = `int rt_reset(unsigned ticks)
{
    unsigned t = 0;
    while (t < ticks) {
        if (hw_read_status() & HW_ST_READY) return RT_OK;
        t++;
    }
    return RT_ERR_TIMEOUT;
}
`
// 任务模式的示例产出：信息流总图（SVG）和说明（Markdown），右边“产出”里能直接预览
const FLOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="300" viewBox="0 0 760 300" font-family="Microsoft YaHei, sans-serif" font-size="13">
  <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker></defs>
  <rect width="760" height="300" fill="#ffffff"/>
  <g fill="#fff" stroke-width="1.4">
    <rect x="30" y="40" width="170" height="64" rx="8" stroke="#0f766e"/><rect x="300" y="40" width="170" height="64" rx="8" stroke="#2563eb"/>
    <rect x="570" y="40" width="160" height="64" rx="8" stroke="#d97706"/><rect x="300" y="190" width="170" height="64" rx="8" stroke="#2563eb"/>
    <rect x="570" y="190" width="160" height="64" rx="8" stroke="#d97706"/>
  </g>
  <g text-anchor="middle" fill="#0f172a">
    <text x="115" y="77">星务计算机（BC）</text><text x="385" y="70">PCU 软件</text><text x="385" y="88" font-size="11" fill="#475569">1553B RT · 子地址 1～6</text>
    <text x="650" y="77">电源控制单元</text><text x="385" y="220">遥测组帧</text><text x="385" y="238" font-size="11" fill="#475569">每 1 s 一帧</text><text x="650" y="227">执行机构</text>
  </g>
  <g stroke="#64748b" stroke-width="1.4" fill="none" marker-end="url(#ar)">
    <path d="M200 62H300"/><path d="M300 84H200"/><path d="M470 72H570"/><path d="M385 104V190"/><path d="M470 222H570"/>
  </g>
  <g font-size="11" fill="#2563eb" text-anchor="middle">
    <text x="250" y="56">遥控指令 6 条</text><text x="250" y="100">遥测 8 条</text><text x="520" y="64">电压/电流、温度</text><text x="420" y="150">采样值</text><text x="520" y="214">OC 指令</text>
  </g>
</svg>`
const FLOW_MD = `# PCU 软件信息流说明\n\n依据：《PCU 软件研制任务书（示例）》、《PCU-1553B 接口控制文件（示例2）》。\n\n## 外部接口\n\n| 对端 | 方向 | 信息 | 周期 |\n|---|---|---|---|\n| 星务计算机（BC） | 收 | 遥控指令 6 条 | 按需 |\n| 星务计算机（BC） | 发 | 遥测 8 条 | 1 s |\n| 电源控制单元 | 收 | 电压/电流、温度 | 100 ms |\n| 执行机构 | 发 | OC 指令、负载继电器 | 按需 |\n\n## 待确认\n\n1. ICD 第 4.3 节遥测第 7 条的字数与任务书不一致（6 字 / 8 字）。\n`

const REPORT = `# 单元测试报告 · rt_drv

| 项目 | 结果 |
|---|---|
| 用例 | 39 个 |
| 通过 | 30 个 |
| 失败 | 9 个，归为 3 个疑似缺陷 |

## 覆盖率（gcov，主机上编译运行）

| 准则 | 覆盖率 | 口径 |
|---|---|---|
| 语句 | 97.8% | 180/184 |
| 分支 | 91.2% | 62/68 |
| MC/DC | 100% | 判定条件全覆盖 |

未覆盖的 4 条语句在复位超时分支（缺陷 1 修复后补用例）。
`

// 需求分析产出：软件需求规格说明（部门模板节选）
const SRS_MD = `# 软件需求规格说明 · PDUS（配电单元软件）

> 依据《XY-9 卫星配电单元软件研制任务书》《XY-9 配电单元与数管分系统通信协议 V1.1》

## 3 功能需求（IPO）

| 编号 | 功能 | 输入 | 处理 | 输出 |
|---|---|---|---|---|
| PDUS-FREQ-012 | 遥控指令接收 | 1553B 子地址 1 | 校验帧头、字数、校验和 | 指令入队 / 拒绝计数 |
| PDUS-FREQ-018 | 配电通道控制 | 通道号、通断 | 查互锁表、驱动继电器 | OC 输出、状态回读 |
| PDUS-FREQ-023 | 遥测组帧 | 采集量、状态 | 按 1 s 周期组帧 | 遥测帧 8 条 |

## 4 性能 / 安全性需求（RREQ）

- PDUS-RREQ-004 指令响应 ≤ 50 ms；遥测周期 1 s ± 10 ms
- PDUS-RREQ-009 母线过流时 2 个周期内断开对应通道（安全关键）

## 7 跟踪矩阵（上级 → 需求）

| 任务书条款 | 需求条目 |
|---|---|
| 3.2.1 配电控制 | PDUS-FREQ-018、PDUS-RREQ-009 |
| 3.3 遥测遥控 | PDUS-FREQ-012、PDUS-FREQ-023 |

**待确认 2 处**：母线过流阈值任务书与协议不一致（见需求分析记录 Q-03）；掉电保持通道清单待型号确认。
`

// 详细设计产出（节选）
const DD_MD = `# 软件详细设计说明 · thm_ctrl（热控输出控制器）

## 4.2.2 软件单元 thm_ctrl_step

- **功能**：每个控制周期读温度、按阈值和滞回决定加热器通断
- **输入**：当前温度 temp（0.1℃）、通道配置 cfg
- **处理**：temp < on_th → 开；temp > off_th → 关；中间保持（滞回防抖）
- **输出**：加热器通断位、本周期动作计数

> 约束：on_th 必须小于 off_th（滞回带 ≥ 2℃）；单元内无动态内存、无递归（GJB 8114）。
`

// 编码产出：按详细设计生成的 C 代码
const THM_C = `#include "thm_ctrl.h"

/* 热控输出控制：带滞回的阈值控制，防止在阈值附近频繁通断 */
uint8_t thm_ctrl_step(int16_t temp, const thm_cfg_t *cfg, thm_state_t *st)
{
    if (temp < cfg->on_th) {
        st->heater = 1U;            /* 低于下限：加热 */
    } else if (temp > cfg->off_th) {
        st->heater = 0U;            /* 高于上限：停止 */
    }                               /* 滞回带内：保持上一状态 */
    st->actions += (uint16_t)(st->heater != st->last);
    st->last = st->heater;
    return st->heater;
}
`

// 研制总结产出（Ⅲ、Ⅳ类，部门模板 09 节选）
const SUMMARY_MD = `# 软件研制总结报告 · PDUS（Ⅲ、Ⅳ类）

## 1 研制信息表（事实逐项标出处）

| 项目 | 内容 | 出处 |
|---|---|---|
| 软件名称 | 配电单元软件 PDUS | 〔任务书〕 |
| 规模 | 源代码 4 120 行，配置项 1 个 | 〔自动·cloc〕 |
| 需求条目 | 功能 23、性能/安全 11 | 〔需求规格说明〕 |
| 单元测试 | 39 用例，语句 97.8%、MC/DC 100% | 〔单元测试报告〕 |
| 第三方评测 | 通过，遗留问题 0 | 〔评审纪要·2026-11-10〕 |

## 5 研制过程（按评审要点）

5.1.1 走查、5.1.4 单元测试、5.1.5 确认测试均已通过并归档。

**待补充 1 处**：配置项测试报告编号待档案室回填〔用户提供〕。
`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 浏览器里看界面时的部署场景：默认是 Windows + 部门模型；地址带 ?scenario=kylin-qwen 时模拟麒麟系统 + 局域网 Qwen3.8-27B（演示、截图用）
const KYLIN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('scenario') === 'kylin-qwen'
// 录演示视频时再加 &demo=1：界面上不写“模拟引擎”，按配好的部门模型显示（视频里要另行说明画面是回放）
const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')
const HOME = KYLIN ? '/home/zhangsan/.local/share/AstroLab' : 'C:\\Users\\demo\\AppData\\Local\\AstroLab'
const MOCK_MODEL = KYLIN
  ? { provider: 'dept-llm', model: 'qwen3.8-27b', baseURL: 'http://192.168.10.20:8000/v1', hasKey: true, contextWindow: 131072, maxTokens: 32768, thinkingFormat: 'qwen-chat-template' }
  : { provider: 'dept-llm', model: 'deepseek-flash', baseURL: 'https://api.deepseek.com', hasKey: true, contextWindow: 1048576 }
const MOCK_PROBE: ModelProbe = KYLIN
  ? {
      ok: true, baseURL: MOCK_MODEL.baseURL, server: 'vLLM', model: 'qwen3.8-27b', models: ['qwen3.8-27b'], family: 'Qwen（通义千问）', maxModelLen: 131072, tokPerSec: 46, ms: 9400,
      envFile: HOME + '/local.env', suggest: {},
      checks: [
        { item: '服务和模型', status: 'ok', detail: 'vLLM · qwen3.8-27b · 上下文 128K · Qwen（通义千问）（38 ms）' },
        { item: '上下文窗口', status: 'ok', detail: 'local.env 131072，服务端 131072' },
        { item: '对话', status: 'ok', detail: '1180 ms，约 46 tokens/秒（含首字等待）：验证每个函数在隔离环境下按设计正确工作。' },
        { item: '工具调用', status: 'ok', detail: '结构化 tool_calls：read_file("src/tm_udp.c")（960 ms）' },
        { item: '思考', status: 'ok', detail: '思考内容单独返回（612 字，6200 ms），答案：2' },
        { item: '思考参数写法', status: 'ok', detail: 'qwen-chat-template' },
      ],
    }
  : {
      ok: true, baseURL: MOCK_MODEL.baseURL, server: 'OpenAI 兼容接口', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-pro'], family: 'DeepSeek', maxModelLen: null, tokPerSec: 60, ms: 3100, suggest: {},
      checks: [
        { item: '服务和模型', status: 'ok', detail: 'OpenAI 兼容接口 · deepseek-flash · DeepSeek（120 ms）' },
        { item: '对话', status: 'ok', detail: '900 ms，约 60 tokens/秒（含首字等待）：验证每个函数在隔离环境下按设计正确工作。' },
        { item: '工具调用', status: 'ok', detail: '结构化 tool_calls：read_file("src/tm_udp.c")（1100 ms）' },
      ],
    }

export function createMockApi(): AstroApi {
  const listeners = new Set<(e: AstroEvent) => void>()
  const emitUi = (e: AstroEvent) => listeners.forEach((l) => l(e))
  // URL 带 ?multi：演示多个工作区（侧栏按工作区列任务、工作区菜单、置顶和移出）
  const multi = new URLSearchParams(location.search).has('multi')
  const projects: Project[] = [
    { id: 'p1', name: '示例工程', path: KYLIN ? HOME + '/workspace/sample' : 'C:\\Users\\demo\\AppData\\Local\\AstroLab\\workspace\\sample', sample: true, git: true, branch: 'main', pinned: multi },
    ...(multi ? [
      { id: 'p2', name: 'g3-pdus', path: KYLIN ? '/home/zhangsan/work/g3-pdus' : 'D:\\work\\g3-pdus', git: true, branch: 'dev', pinned: true },
      { id: 'p3', name: 'oc_ctrl', path: KYLIN ? '/home/zhangsan/work/design/oc_ctrl' : 'D:\\work\\design\\oc_ctrl', git: true, branch: 'main' },
      { id: 'p4', name: 'tcu', path: KYLIN ? '/home/zhangsan/work/design/tcu' : 'D:\\work\\design\\tcu', git: false },
    ] : []),
  ]
  let project = projects[0]
  let act = createActivity()
  let task: Task | null = null
  let status: TaskState['status'] = 'idle'
  let error: string | null = null
  let questions: Question[] = []
  let queued: { id: string; text: string; at: number }[] = []
  let files = new Map<string, { before: string | null; after: string }>()
  // 侧栏“最近”演示用的历史任务
  const past = (h: number, skill: string, title: string, status: Task['status'], committed?: number): Task => {
    const sk = SKILLS.find((x) => x.name === skill)!
    const at = Date.now() - h * 3600_000
    return { id: `t-past-${h}`, sessionId: 's', stage: sk.name, stageName: sk.title, skill, skills: [skill], category: sk.category, title, prompt: title, files: [], startedAt: at, endedAt: at + 900_000, status,
      snapshot: { commit: 'a', tree: 'b' }, commit: committed ? { sha: '8fa01be', message: title, at: at + 1000_000, files: committed } : null }
  }
  const history: Task[] = new URLSearchParams(location.search).has('nohist') ? [] : [
    past(1.2, 'info-flow', '按 tests/pcu-demo/expected.md 画一次图', 'done', 11),
    past(3, 'unit-test-design', '为 rt_drv 和 rt_msg 设计并运行单元测试', 'done', 3),
    past(5, 'coding', '按详细设计 4.2 实现 rt_reset 和 rt_stack_push', 'stopped'),
    past(26, 'detailed-design', '写 rt_drv 模块的详细设计，含流程图', 'done', 2),
    past(30, 'requirements-analysis', '根据任务书第 3 章整理 RT 通信软件的需求规格', 'done', 1),
    past(54, 'code-walkthrough', '走查 rt_msg.c，重点看中断和共享数据', 'done'),
    past(75, 'preliminary-design', '为 RT 通信软件划分模块并定义接口', 'done', 2),
  ]
  const others: Record<string, Task[]> = multi ? {
    p2: [past(2, 'code-walkthrough', '对 g3-pdus/dev/V1.01/src/ocp.c 中的 ocp_check 做走查', 'done'), past(6, 'requirements-analysis', '对 g3-pdus/dev/V1.01 做静态分析，出 GJB 8114 报告', 'done', 4), past(9, 'requirements-analysis', '按 g3-pdus/input 下的任务书、通信协议做需求分析', 'done', 2)].map((t, i) => ({ ...t, id: `p2-${i}` })),
    p3: [past(200, 'detailed-design', '按 design/oc_ctrl/docs 下的需求规格做详细设计', 'done', 3)].map((t) => ({ ...t, id: 'p3-0' })),
    p4: [past(220, 'preliminary-design', '按 design/tcu/docs 下的软件需求规格做概要设计', 'done', 2)].map((t) => ({ ...t, id: 'p4-0' })),
  } : {}
  const historyOf = (id: string) => (id === 'p1' ? history : others[id] || [])
  let seq = 0
  let turn = 0
  let run = 0 // 每次停止加一，旧剧本发现后退出
  let answerWaiter: ((a: { id: string; selected: string[]; custom?: string }[]) => void) | null = null
  const speed = Number(new URLSearchParams(location.search).get('speed') || 1)
  const wait = (ms: number) => sleep(ms * speed)

  const state = (): TaskState => ({ project, status, error, task: task && { ...task, status }, engine: { state: 'ready', error: null }, summary: summarize(act), questions, queued })
  const pushState = () => { if (task) task.status = status; emitUi({ type: 'state', payload: state() }) }
  const ev = (type: string, data: object) => {
    const changed = applyEvent(act, { type, seq: seq++, time: Date.now(), data })
    if (changed.length) emitUi({ type: 'activity', payload: changed.map(plainItem) as Item[] })
    if (['turn/start', 'step/start', 'tool/call', 'tool/result', 'turn/end', 'user/message'].includes(type)) pushState()
  }
  let callN = 0
  async function tool(r: number, name: string, args: Record<string, unknown>, result: string | (() => Promise<string>), reason?: string) {
    if (r !== run) throw new Error('stopped')
    const callId = `c${callN++}`
    ev('assistant/message', { message: { role: 'assistant', content: [...(reason ? [{ type: 'reasoning', text: reason }] : []), { type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }] }, usage: nextUsage() })
    ev('tool/call', { callId, name, arguments: JSON.stringify(args) })
    const text = typeof result === 'string' ? (await wait(250), result) : await result()
    if (r !== run) throw new Error('stopped')
    const denied = /sandbox denied/.test(text)
    ev('tool/result', { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError: denied } })
  }
  async function stepStart(r: number, think = 700) {
    if (r !== run) throw new Error('stopped')
    ev('step/start', {})
    await wait(think)
  }
  async function say(r: number, text: string, reason?: string) {
    await stepStart(r, 600)
    ev('assistant/message', { message: { role: 'assistant', content: [...(reason ? [{ type: 'reasoning', text: reason }] : []), { type: 'text', text }] }, usage: nextUsage() })
  }
  // 模拟用量：上下文每次调用涨一些，大部分命中缓存（和真实日志的形状一样）
  let ctx = 0
  function nextUsage() {
    const prev = ctx
    ctx = (ctx || 9800) + 1400 + Math.round(Math.random() * 900)
    const output = 120 + Math.round(Math.random() * 300)
    return { inputTokens: ctx - prev - output > 0 ? ctx - Math.max(prev, 0) - output : 600, outputTokens: output, totalTokens: ctx, cacheReadTokens: Math.max(0, prev - 200) }
  }
  const todos = (done: number) => ['读设计和源码', '设计用例', '写测试和桩', '编译运行', '写报告', '自查'].map((content, i) => ({ content, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' }))

  async function scenario(r: number, text: string) {
    turn++
    ev('turn/start', { turn })
    if (/问我|\[ask\]/.test(text)) {
      await stepStart(r)
      let reply = ''
      await tool(r, 'ask_user_question', { questions: [{ id: 'hw' }, { id: 'lang' }] }, async () => {
        const q: Question = { id: `q${Date.now()}`, at: Date.now(), questions: [
          { id: 'hw', header: '头文件', question: 'src 和 bsp 下各有一个 rt_hw.h，内容不同。测试按哪个来？', options: [{ label: 'src/rt_hw.h（推荐）', description: '与详细设计 3.4 一致' }, { label: 'bsp/rt_hw.h', description: '板级包里的新版本' }] },
          { id: 'lang', header: '报告', question: '测试报告用什么语言写？', options: [{ label: '中文（推荐）' }, { label: '英文' }] },
        ] }
        questions = [q]
        status = 'asking'
        pushState()
        emitUi({ type: 'question', payload: q })
        emitUi({ type: 'notify', payload: { level: 3, kind: 'ask', title: '需要你决定', body: q.questions[0].question } })
        const answers = await new Promise<{ id: string; selected: string[]; custom?: string }[]>((res) => { answerWaiter = res })
        reply = `好的：按 ${answers[0]?.custom || answers[0]?.selected[0] || 'src/rt_hw.h'} 测试，报告用${answers[1]?.custom || answers[1]?.selected[0] || '中文'}写。`
        return JSON.stringify({ answers })
      })
      await say(r, reply)
    } else if (task?.skills?.includes('requirements-analysis')) {
      const s = (d: number) => ['读任务书和 ICD', '功能分解、写需求条目', '跟踪矩阵', '自查'].map((content, i) => ({ content, status: i < d ? 'completed' : i === d ? 'in_progress' : 'pending' }))
      await stepStart(r)
      await tool(r, 'skill', { name: 'requirements-analysis' }, 'skill loaded', '按部门模板做需求分析：从任务书和 ICD 抽需求，写规格说明和跟踪矩阵。')
      await tool(r, 'todo_write', { todos: s(0) }, 'ok')
      await tool(r, 'mcp__docreader__read_document', { path: 'docs/XY-9配电单元软件研制任务书.docx' }, '任务书：配电控制、遥测遥控……')
      await tool(r, 'mcp__docreader__read_document', { path: 'docs/XY-9配电单元通信协议-V1.1.docx' }, 'ICD：1553B 子地址、帧格式……')
      await stepStart(r, 1800)
      await tool(r, 'todo_write', { todos: s(2) }, 'ok', '任务书 3.2.1 配电控制 → PDUS-FREQ-018；母线过流阈值任务书与协议不一致，记为待确认 Q-03。')
      await tool(r, 'write', { file_path: 'docs/软件需求规格说明-PDUS.md', content: SRS_MD }, 'ok')
      files.set('docs/软件需求规格说明-PDUS.md', { before: null, after: SRS_MD })
      await tool(r, 'todo_write', { todos: s(4) }, 'ok')
      await say(r, '需求分析完成：23 条功能需求、11 条性能/安全需求，跟踪矩阵对齐任务书。\n\n**2 处待确认**：母线过流阈值任务书与协议不一致（Q-03）；掉电保持通道清单待型号确认。\n\n《软件需求规格说明》在右边产出里。', '条款摘录、覆盖分析、待确认问题都写进了需求分析记录。')
    } else if (task?.skills?.includes('detailed-design')) {
      const s = (d: number) => ['读需求和概要设计', '单元划分、画流程图', '写详细设计', '自查'].map((content, i) => ({ content, status: i < d ? 'completed' : i === d ? 'in_progress' : 'pending' }))
      await stepStart(r)
      await tool(r, 'skill', { name: 'detailed-design' }, 'skill loaded', '每个配置项一份详细设计，按模块逐个软件单元写；含流程图。')
      await tool(r, 'todo_write', { todos: s(0) }, 'ok')
      await tool(r, 'read', { file_path: 'docs/软件需求规格说明-PDUS.md' }, 'ok')
      await stepStart(r, 1600)
      await tool(r, 'todo_write', { todos: s(2) }, 'ok', 'thm_ctrl_step 用滞回防抖；约束 on_th < off_th、无动态内存、无递归（GJB 8114）。')
      await tool(r, 'write', { file_path: 'design/thm_ctrl-详细设计.md', content: DD_MD }, 'ok')
      files.set('design/thm_ctrl-详细设计.md', { before: null, after: DD_MD })
      await tool(r, 'write', { file_path: 'diagrams/thm_ctrl-流程图.svg', content: FLOW_SVG }, 'ok')
      files.set('diagrams/thm_ctrl-流程图.svg', { before: null, after: FLOW_SVG })
      await tool(r, 'todo_write', { todos: s(4) }, 'ok')
      await say(r, '详细设计完成：按概要设计把配置项拆成 6 个软件单元，每个函数一份设计 + 流程图。关键单元 thm_ctrl_step 用滞回防止阈值附近频繁通断。\n\n产出：《详细设计说明》和流程图。')
    } else if (task?.skills?.includes('coding') || /编码|写代码|生成代码/.test(text)) {
      const s = (d: number) => ['读详细设计和头文件', '按设计写代码', '交叉编译检查', '对照追踪表自查'].map((content, i) => ({ content, status: i < d ? 'completed' : i === d ? 'in_progress' : 'pending' }))
      await stepStart(r)
      await tool(r, 'todo_write', { todos: s(0) }, 'ok')
      await tool(r, 'read', { file_path: 'design/thm_ctrl-详细设计.md' }, 'ok')
      await tool(r, 'read', { file_path: 'src/include/thm_ctrl.h' }, 'ok')
      await stepStart(r, 1800)
      await tool(r, 'todo_write', { todos: s(1) }, 'ok', '严格照详细设计 4.2.2：滞回带内保持；动作计数按状态变化累加。')
      await tool(r, 'write', { file_path: 'src/thm_ctrl.c', content: THM_C }, 'ok')
      files.set('src/thm_ctrl.c', { before: null, after: THM_C })
      await tool(r, 'todo_write', { todos: s(2) }, 'ok')
      await tool(r, 'mcp__cppcheck__run_cppcheck', { paths: 'src/thm_ctrl.c' }, async () => { await wait(1200); return '0 errors, 0 warnings' })
      await tool(r, 'compile_check', { cc: 'sparc-gaisler-elf-gcc', file: 'src/thm_ctrl.c' }, async () => { await wait(1400); return '目标机交叉编译通过（-Wall -Wextra 无告警）' })
      await tool(r, 'todo_write', { todos: s(4) }, 'ok')
      await say(r, '编码完成：按详细设计生成 `src/thm_ctrl.c`，SPARC 目标机交叉编译通过、Cppcheck 无告警。逐函数对照了详细设计与代码追踪表，一一对应。\n\n代码在右边产出里。', '每个函数对照详细设计条目，确认与设计一致、符合 GJB 8114。')
    } else if (task?.skills?.includes('dev-summary') || /研制总结/.test(text)) {
      const s = (d: number) => ['生成研制信息表', '逐项标出处', '脚本生成报告', '自查'].map((content, i) => ({ content, status: i < d ? 'completed' : i === d ? 'in_progress' : 'pending' }))
      await stepStart(r)
      await tool(r, 'skill', { name: 'dev-summary' }, 'skill loaded', '研制总结几乎全是事实：先出研制信息表、逐项标出处，报告由脚本从信息表生成。')
      await tool(r, 'todo_write', { todos: s(0) }, 'ok')
      await tool(r, 'read', { file_path: 'docs/软件需求规格说明-PDUS.md' }, 'ok')
      await tool(r, 'read', { file_path: 'utest/rt1553/test/单元测试报告-rt_drv.md' }, 'ok')
      await tool(r, 'mcp__knowledge__search_reference', { query: '研制总结 Ⅲ类 评审要点' }, '1 条：模板 09 第 5 章按评审要点编号' )
      await stepStart(r, 1600)
      await tool(r, 'todo_write', { todos: s(2) }, 'ok', '规模 cloc 自动取、需求数来自规格说明、覆盖率来自单元测试报告；配置项测试报告编号缺，标〔用户提供〕。')
      await tool(r, 'write', { file_path: 'docs/软件研制总结报告-PDUS.md', content: SUMMARY_MD }, 'ok')
      files.set('docs/软件研制总结报告-PDUS.md', { before: null, after: SUMMARY_MD })
      await tool(r, 'todo_write', { todos: s(4) }, 'ok')
      await say(r, '研制总结报告生成完毕（Ⅲ、Ⅳ类，部门模板 09）。研制信息表每项都标了出处：〔自动〕规模、〔来源〕需求数和覆盖率、〔用户提供〕待回填的档案编号。\n\n**1 处待补充**：配置项测试报告编号待档案室回填。报告在右边产出里。', '研制总结几乎全是事实，编错一个数字评审要逐项核对，所以每项都标了出处。')
    } else if (task?.skills?.includes('info-flow') || /信息流/.test(text)) {
      const steps = (done: number) => ['读任务书和 ICD', '抽取接口和信息', '建信息流模型', '出总图和说明', '自查'].map((content, i) => ({ content, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' }))
      await stepStart(r)
      await tool(r, 'skill', { name: 'info-flow' }, 'skill loaded', '用信息流梳理技能：先从文档抽接口，再建模型、出图。')
      await tool(r, 'todo_write', { todos: steps(0) }, 'ok')
      await tool(r, 'mcp__docreader__read_document', { path: 'docs/软件研制任务书-示例.docx' }, '任务书：PCU 软件……')
      await tool(r, 'mcp__knowledge__search_knowledge', { query: 'PCU 1553B 子地址分配' }, '1 条：型号A 1553B 子地址分配')
      await tool(r, 'read', { file_path: 'utest/rt1553/doc/rt1553-详细设计.md' }, 'ok')
      await stepStart(r, 1800)
      await tool(r, 'todo_write', { todos: steps(2) }, 'ok', '任务书和 ICD 对得上的接口 4 个；遥测第 7 条两份文件字数不一致，记为待确认。')
      await tool(r, 'write', { file_path: 'diagrams/PCU-软件总体信息流（示例）-总图.svg', content: FLOW_SVG }, 'ok')
      files.set('diagrams/PCU-软件总体信息流（示例）-总图.svg', { before: null, after: FLOW_SVG })
      await tool(r, 'todo_write', { todos: steps(3) }, 'ok')
      await tool(r, 'write', { file_path: 'diagrams/PCU-信息流说明.md', content: FLOW_MD }, 'ok')
      files.set('diagrams/PCU-信息流说明.md', { before: null, after: FLOW_MD })
      await tool(r, 'todo_write', { todos: steps(5) }, 'ok')
      await say(r, '信息流梳理完了：4 个外部接口、19 条信息，总图和说明已生成。\n\n有 **1 处待确认**：ICD 第 4.3 节遥测第 7 条的字数与任务书不一致（6 字 / 8 字），图里先按 ICD 画，标了虚线。\n\n产出在右边，点开就能看图。')
    } else {
      await stepStart(r)
      await tool(r, 'skill', { name: 'unit-test-design' }, 'skill loaded', '先加载单元测试技能，按技能步骤做。')
      await tool(r, 'todo_write', { todos: todos(0) }, 'ok')
      await stepStart(r)
      for (const f of ['utest/rt1553/doc/rt1553-详细设计.md', 'utest/rt1553/src/rt_drv.c', 'utest/rt1553/src/rt_msg.c', 'utest/rt1553/src/rt_hw.h', 'utest/rt1553/include/rt_drv.h', 'utest/rt1553/include/sys.h']) {
        await tool(r, 'read', { file_path: f }, `<path>${f}</path>`)
      }
      await stepStart(r, 2600)
      await tool(r, 'todo_write', { todos: todos(2) }, 'ok', '寄存器头文件 rt_hw.h 与 rt_drv.c 同目录，用 test/hw 下的同名文件替换；复位等待按“大于或等于 10 tick”取边界 9、10、11；描述符堆栈连续取 65 个验证回绕。')
      await stepStart(r)
      for (const [p, c] of [['utest/rt1553/test/test_rt_drv.c', TEST_C], ['utest/rt1553/test/stub_hw.c', STUB_C]] as const) {
        await tool(r, 'write', { file_path: p, content: c }, `wrote ${p}`)
        files.set(p, { before: null, after: c })
      }
      await stepStart(r)
      await tool(r, 'write', { file_path: KYLIN ? '/home/zhangsan/out.txt' : 'D:\\temp\\out.txt', content: 'log\n' }, 'sandbox denied: write outside the workspace is not permitted')
      await stepStart(r)
      await tool(r, 'todo_write', { todos: todos(3) }, 'ok')
      await tool(r, 'mcp__utest__run_unit_tests', { test_dir: 'utest/rt1553/test', coverage: 'mcdc' }, async () => { await wait(2400); return '编译通过；39 个用例，30 通过，9 失败；覆盖率 语句 97.8%、分支 91.2%、MC/DC 100%' })
      await stepStart(r)
      await tool(r, 'edit', { file_path: 'utest/rt1553/src/rt_drv.c', old_string: '    while (t < ticks) {', new_string: '    /* 测试桩接入点 */\n    while (t < ticks) {' }, 'ok')
      files.set('utest/rt1553/src/rt_drv.c', { before: RT_DRV_BEFORE, after: RT_DRV_BEFORE.replace('    while (t < ticks) {', '    /* 测试桩接入点 */\n    while (t < ticks) {') })
      await tool(r, 'todo_write', { todos: todos(4) }, 'ok')
      await tool(r, 'write', { file_path: 'utest/rt1553/test/单元测试报告-rt_drv.md', content: REPORT }, 'ok')
      files.set('utest/rt1553/test/单元测试报告-rt_drv.md', { before: null, after: REPORT })
      await tool(r, 'todo_write', { todos: todos(6) }, 'ok')
      await say(r, '单元测试做完了：39 个用例，30 通过，9 失败；覆盖率语句 97.8%、分支 91.2%、MC/DC 100%。\n\n失败的用例按设计核对后归为 3 个疑似缺陷：\n\n1. **复位第 10 tick 就绪时仍报超时**（TC-007～010）：设计 4.2.3 要求“大于或等于 10 tick 视为就绪”，代码用了 `>`。\n2. **描述符堆栈第 65 项没有回绕**（TC-021～024）。\n3. **字数为 0 的消息按 0 个字处理**（TC-033）：1553 协议中字数 0 表示 32 个字。\n\n报告在 `utest/rt1553/test/单元测试报告-rt_drv.md`。', '核对失败用例与设计条目，确认预期值都来自设计。')
    }
    ev('turn/end', { turn, reason: { kind: 'completed' } })
  }

  async function drive(r: number, text: string) {
    try {
      await scenario(r, text)
      while (queued.length && r === run) {
        const q = queued.shift()!
        ev('user/message', { content: [{ type: 'text', text: q.text }], source: { kind: 'user' } })
        turn++
        ev('turn/start', { turn })
        await say(r, `收到。已按你的要求补充：${q.text}`)
        ev('turn/end', { turn, reason: { kind: 'completed' } })
      }
      if (r !== run) return
      status = 'done'
      if (task) task.endedAt = Date.now()
      pushState()
      emitUi({ type: 'notify', payload: { level: 2, kind: 'done', title: `${task?.stageName || '任务'}完成`, body: '' } })
    } catch { /* 停止 */ }
  }

  // 软件更新（浏览器里看界面用）：检查发现 0.2.0，准备时模拟复制进度
  let up: UpdateState = { version: '0.1.0', installed: true, dir: '\\\\fileserver\\astrolab\\release', configured: true, working: null, check: null, staged: null, progress: null, last: null }
  const upEmit = () => emitUi({ type: 'update', payload: { ...up } })
  const LATEST = { version: '0.2.0', date: '2026-10-29T09:00:00Z', notes: '- 提交后页头显示“已提交”\n- 产出文件数按实际改动计\n- 命令说明用中文' }
  // 模型配置（浏览器里看界面用）：部门默认 + 自定义模型
  const PRESETS_MOCK: ModelPreset[] = [
    { id: 'lan-qwen', name: '局域网 Qwen3.8-27B（vLLM）', baseURL: 'http://192.168.10.20:8000/v1', model: 'qwen3.8-27b', thinkingFormat: 'qwen-chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', defaultKey: 'EMPTY', note: '地址换成你们服务器的；模型名是 vLLM 的 --served-model-name' },
    { id: 'intranet-deepseek', name: '内网 DeepSeek（vLLM）', baseURL: 'http://10.0.0.10:8000/v1', model: 'deepseek-v4', thinkingFormat: 'chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', defaultKey: 'EMPTY', note: '内网 4×H200 上的 vLLM' },
    { id: 'deepseek-api', name: 'DeepSeek 官方接口', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', thinkingFormat: 'deepseek', contextWindow: 1048576, maxTokens: 65536, input: 'text', defaultKey: '', note: '公网接口：只能用示例代码和非敏感内容' },
    { id: 'openai-compatible', name: '其他 OpenAI 兼容接口', baseURL: 'http://', model: '', thinkingFormat: 'chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', defaultKey: '', note: '填好地址后点“获取模型列表”，再点“检测”' },
  ]
  const deptModel: ModelProfile = { id: 'dept', name: '部门默认（local.env）', baseURL: MOCK_MODEL.baseURL, model: MOCK_MODEL.model, thinkingFormat: MOCK_MODEL.thinkingFormat || 'deepseek', contextWindow: MOCK_MODEL.contextWindow, maxTokens: MOCK_MODEL.maxTokens || 65536, input: 'text', hasKey: true, builtin: true }
  let customModels: ModelProfile[] = []
  let activeModelId = 'dept'
  const modelList = (): ModelList => ({ active: activeModelId, locked: false, presets: PRESETS_MOCK, models: [deptModel, ...customModels].map((x) => ({ ...x, active: x.id === activeModelId })) })
  const activeModel = () => {
    const x = [deptModel, ...customModels].find((m) => m.id === activeModelId) || deptModel
    return { provider: 'dept-llm', model: x.model, baseURL: x.baseURL, hasKey: x.hasKey, contextWindow: x.contextWindow, maxTokens: x.maxTokens, thinkingFormat: x.thinkingFormat, name: x.id === 'dept' ? '部门默认' : x.name, activeId: x.id }
  }
  function appState(): AppState {
    return {
      platform: KYLIN ? 'linux' : 'win32', mock: !DEMO, installed: DEMO,
      model: activeModel(),
      engineReady: true, projects: [...projects], stages: STAGES, skills: SKILLS, notes: [], task: state(), items: act.items.map(plainItem), update: { ...up },
      user: 'zhangsan', versions: { app: '0.1.0', electron: '44.9.3', node: '22.20.0' }, dataDir: HOME, logDir: KYLIN ? HOME + '/logs' : HOME + '\\logs',
    }
  }

  // 资料库（浏览器里看界面用）
  const sec = (no: string, title: string, chapter: string, pages: string) => ({ no, title, chapter, pages, file: `${no}.md` })
  const refDocs: RefDoc[] = [
    { id: 'sse4', lib: 'ref', libName: '部门资料库', title: 'Spacecraft Systems Engineering (4th ed.)', titleZh: '航天器系统工程（第四版，英文原版）', year: 2011, license: 'internal', sections: [
      sec('9.6', 'ACS Computation', '9 Attitude Control', '321-326'),
      sec('13.1', 'Introduction', '13 Telemetry, Command, Data Handling and Processing', '439-440'), sec('13.2', 'System Architecture', '13 Telemetry, Command, Data Handling and Processing', '440-442'),
      sec('13.3', 'Telemetry Data Formatting', '13 Telemetry, Command, Data Handling and Processing', '442-449'), sec('13.4', 'Telecommand', '13 Telemetry, Command, Data Handling and Processing', '449-455'),
      sec('13.6', 'On-Board Data Handling (OBDH) and Processing', '13 Telemetry, Command, Data Handling and Processing', '458-464'),
      sec('19.9', 'Software Product Assurance', '19 Product Assurance', '638-640'),
    ] },
    { id: 'nasa-se-hb', lib: 'ref', libName: '部门资料库', title: 'NASA Systems Engineering Handbook (NASA/SP-2016-6105 Rev2)', titleZh: 'NASA 系统工程手册（2016 修订版 2）', year: 2016, license: 'public', sections: [
      sec('4.2', 'Technical Requirements Definition', '4 System Design Processes', '54-62'), sec('5.3', 'Product Verification', '5 Product Realization', '88-99'),
      sec('App.C', 'How to Write a Good Requirement— Checklist', 'Appendices', '197-200'),
    ] },
  ]
  const refZh: Record<string, RefTranslation | undefined> = {}
  const refEdit: Record<string, string> = {}
  const refHl: Record<string, RefHighlight[]> = {}
  const hlKey = (id: string) => { const [, d, f] = /^ref:([^/]+)\/(.+)$/.exec(id) || []; return `${d}|${f}` }
  function refRead(id: string): RefRead {
    const [, docId, file] = /^ref:([^/]+)\/(.+)$/.exec(id) || []
    const d = refDocs.find((x) => x.id === docId)!
    const i = d.sections.findIndex((s) => s.file === file)
    const s = d.sections[i]
    const sib = (j: number) => (d.sections[j] ? { id: `ref:${d.id}/${d.sections[j].file}`, no: d.sections[j].no, title: d.sections[j].title } : null)
    const text = refEdit[id] ?? refText[s.no] ?? 'This section describes …'
    return { id, meta: { doc: d.id, docTitle: d.title, docTitleZh: d.titleZh || '', lib: d.lib, libName: d.libName, no: s.no, title: s.title, chapter: s.chapter, pages: s.pages, license: d.license }, cite: `${d.title} §${s.no} ${s.title}，第 ${s.pages} 页`,
      paragraphs: text.split(/\n{2,}/), edited: id in refEdit, translation: refZh[id] || null, translating: null, highlights: refHl[hlKey(id)] || [], prev: sib(i - 1), next: sib(i + 1) }
  }
  const refText: Record<string, string> = {
    '13.3': '#### 13.3.1 Telemetry frame\n\nThe telemetry data are organized into frames, each beginning with a synchronization word so that the ground station can locate the start of the frame. The frame length is fixed for a given format, and a frame counter allows lost frames to be detected.\n\n*Figure 13.3 Telemetry frame format*\n\nPackets of variable length are multiplexed into the fixed-length frames …',
    'App.C': '### C.1 Use of Correct Terms\n\n• Shall = requirement\n\n• Will = facts or declaration of purpose\n\n• Should = goal\n\n### C.2 Editorial Checklist\n\nThe requirement is in the form “product ABC shall XYZ.” …',
  }
  // 知识库和技能库（浏览器里看界面用）
  let inbox: InboxItem[] = [
    { path: '待整理/2026-11-01/复位等待按大于或等于判超时.md', problems: [], meta: { title: '复位等待按“大于或等于”判超时，边界取 N-1、N、N+1', kind: '经验', tags: ['复位', '超时', '边界值'], source: '任务 t-20261029-0932（示例工程）；提交 3f2a91c', status: '候选' }, body: '## 结论\n设计写“≥ N tick 视为超时”时，代码用 `>=`，单元测试取 N-1、N、N+1 三个点。\n\n## 依据\n智能体把判断写成 `elapsed > 10`，审核时人改成 `>=`，并补了第 10 tick 的用例。\n\n## 怎么用\n凡是设计里写“达到/超过”的阈值，先确认是否包含等号，再定代码和用例。' },
    { path: '待整理/2026-11-01/gcc 不在 PATH 时先用 UTEST_CC.md', problems: ['缺来源（依据哪个任务、哪次提交或哪本书的哪一节）'], meta: { title: '编译单元测试前先确认 UTEST_CC，不要直接调 gcc', kind: '问题', tags: ['单元测试', '编译', '环境'], status: '候选' }, body: '## 结论\n命令行里直接调 gcc 会因为 PATH 不同失败（出现 2 次），先用 utest 工具服务，它按 UTEST_CC 找编译器。' },
  ]
  let reports: InboxReport[] = [
    { path: '待整理/2026-11-01-整理报告.md', title: '知识整理报告 2026-11-01', date: '2026-11-01', body: '## 概况\n看了 4 个任务（示例工程），出了 2 条候选。\n\n## 候选\n- 复位等待按“大于或等于”判超时 —— 审核时人改了判断 —— 把握：高\n- 编译单元测试前先确认 UTEST_CC —— 同一错误出现 2 次 —— 把握：中\n\n## 已有条目的建议\n- 无\n\n## 没有记的\n- 需求分析时人补了一条“上电自检”的需求，只出现一次，等再出现。' },
  ]
  const mkEntry = (lib: string, libName: string, meta: KbMeta, body: string): KbEntry => ({ id: `${lib}:knowledge/${meta.kind}/${meta.title}.md`, lib, libName, writable: lib === 'mine', path: `knowledge/${meta.kind}/${meta.title}.md`, meta, body })
  let kbEntries: KbEntry[] = [
    mkEntry('mine', '我的库', { title: '复位等待用“大于或等于”判就绪', kind: '经验', tags: ['1553B', '复位', '超时'], date: '2026-10-27', author: '智能体', status: '草稿', source: '单元测试任务 · rt_drv.c' }, 'rt_drv 的复位等待，设计 4.2.3 规定 **elapsed ≥ 10 tick** 视为超时。代码用了 `>`，第 10 tick 就绪时仍报超时。\n\n```c\nif (elapsed >= RT_RESET_TMO_TICKS) {\n    return RT_ERR_TIMEOUT;\n}\n```'),
    mkEntry('dept', '部门通用库', { title: '串口接收中断只放进环形缓冲区', kind: '设计', tags: ['UART', '中断'], date: '2026-09-12', author: '李工' }, '中断服务程序只把字节放进环形缓冲区并计数，帧解析放在主循环。缓冲区读写指针分开，主循环读之前不用关中断。'),
    mkEntry('dept', '部门通用库', { title: '看门狗只在主循环末尾喂', kind: '经验', tags: ['看门狗'], date: '2026-08-30', author: '张工' }, '在等待循环里无条件喂狗，会掩盖死循环。'),
    mkEntry('xh-a', '型号A 库', { title: '型号A 1553B 子地址分配', kind: '设计', model: '型号A', tags: ['1553B'], date: '2026-07-02', author: '王工' }, '子地址 1～3 收遥控，4～6 发遥测。'),
  ]
  let libSources: LibSource[] = [
    { id: 'mine', name: '我的库', url: '', branch: '', model: '', preset: false, local: true, writable: true, cloned: true, syncing: false, lastSync: null, error: '' },
    { id: 'dept', name: '部门通用库', url: 'http://git.intra/astrolab/library.git', branch: 'main', model: '', preset: true, local: false, writable: false, cloned: true, syncing: false, lastSync: Date.now() - 600_000, error: '' },
    { id: 'xh-a', name: '型号A 库', url: 'http://git.intra/xh-a/library.git', branch: 'main', model: '型号A', preset: true, local: false, writable: false, cloned: true, syncing: false, lastSync: Date.now() - 600_000, error: '' },
  ]
  const catalog: CatalogItem[] = [
    ...STAGES.filter((st) => st.hasSkill).map((st): CatalogItem => ({ key: `builtin:skill:${st.skill}`, kind: 'skill', name: st.skill, title: `${st.name}`, description: `${st.name}的部门技能`, source: 'builtin', sourceName: '内置', path: `skills/${st.skill}`, builtin: true, installed: true })),
    { key: 'dept:skill:spw-review', kind: 'skill', name: 'spw-review', title: '', description: '按部门 SpaceWire 通信设计规范走查报文头、长度、CRC 和超时处理。', source: 'dept', sourceName: '部门通用库', path: 'skills/spw-review', installed: false },
    { key: 'dept:plugin:crc-tools', kind: 'plugin', name: 'crc-tools', title: 'CRC 计算与核对', version: '1.2.0', description: '按通信协议计算 CRC-16/CCITT、CRC-32，核对报文里的 CRC 字段。', source: 'dept', sourceName: '部门通用库', path: 'plugins/crc-tools', installed: true, update: true, mcp: ['crc'] },
    { key: 'mine:skill:fpga-reg-check', kind: 'skill', name: 'fpga-reg-check', title: '', description: '核对 FPGA 寄存器配置表与驱动代码里的地址、位定义是否一致。', source: 'mine', sourceName: '我的库', path: 'skills/fpga-reg-check', mine: true, installed: false },
  ]

  // 定时任务：URL 带 ?nosched 时从空的开始（看空状态和模板）
  const H = 3600_000
  const sNow = Date.now()
  const schedules: Schedule[] = new URLSearchParams(location.search).has('nosched') ? [] : [
    { id: 's1', name: '每晚静态分析巡检', prompt: SCHEDULE_TEMPLATES[0].prompt, projectId: 'p1', skills: ['static-analysis'], mode: 'code', options: {}, trigger: { freq: 'weekdays', time: '21:00' }, condition: { kind: 'commits', exts: ['c', 'h'] }, enabled: true,
      nextRunAt: nextRun({ freq: 'weekdays', time: '21:00' }, sNow), createdAt: sNow - 200 * H, updatedAt: sNow - 200 * H, pending: null, describe: '工作日 21:00', lastRunAt: sNow - 10 * H,
      runs: [
        { id: 'r3', at: sNow - 10 * H, due: sNow - 10 * H, status: 'started', taskId: 't-past-1.2', projectId: 'p1', task: { status: 'done', title: '每晚静态分析巡检', startedAt: sNow - 10 * H, endedAt: sNow - 9.7 * H, commit: null, restoredAt: null } },
        { id: 'r2', at: sNow - 30 * H, due: sNow - 34 * H, status: 'started', catchup: true, taskId: 't-past-26', projectId: 'p1', task: { status: 'done', title: '每晚静态分析巡检', startedAt: sNow - 30 * H, endedAt: sNow - 29.6 * H, commit: { sha: '8fa01be', message: '静态分析巡检', at: sNow - 20 * H, files: 2 }, restoredAt: null } },
        { id: 'r0', at: sNow - 34 * H, due: sNow - 34 * H, status: 'nothing', reason: '上次运行之后没有新提交（8fa01be）' },
        { id: 'r1', at: sNow - 58 * H, due: sNow - 58 * H, status: 'skipped', reason: '上一次运行还没做完' },
      ] },
    { id: 's2', name: '每周研制进展', prompt: SCHEDULE_TEMPLATES[2].prompt, projectId: multi ? 'p2' : 'p1', skills: [], mode: 'task', options: {}, trigger: { freq: 'weekly', days: [5], time: '16:30' }, enabled: false,
      nextRunAt: null, createdAt: sNow - 100 * H, updatedAt: sNow - 100 * H, pending: null, describe: '每周五 16:30', runs: [] },
  ]
  let loginOn = false
  const webSt: WebState = { enabled: true, running: true, port: 8620, lan: true, token: 'k3Vq9xLm2Pd7', urls: ['http://119.80.252.59:8620'], clients: 1, error: null,
    sessions: 2, subnets: ['119.80.252.59/255.255.255.0'], logins: [{ ip: '119.80.252.55', at: Date.now() - 120_000, ok: true }, { ip: '119.80.252.55', at: Date.now() - 150_000, ok: false }, { ip: '127.0.0.1', at: Date.now() - 600_000, ok: true }] }
  // URL 带 ?public：模拟用公网模型（定时任务只能在示例工程和标为非敏感的工程里跑）
  const scope: 'sample' | 'all' = new URLSearchParams(location.search).has('public') ? 'sample' : 'all'
  const blockedOf = (p: Project) => (p.library ? '“我的库”是做技能和插件用的，定时任务请选一个工程' : scope === 'sample' && !p.sample && !p.cloudOk ? `现在用的是公网模型，定时任务只能在示例工程或标为“非敏感”的工程里运行；“${p.name}”没有标过` : null)
  const condText = (c?: { kind: string; exts?: string[] }) => (!c || c.kind === 'none' ? '' : c.kind === 'files' ? `工程里有 ${(c.exts || []).map((x) => `.${x}`).join(' ')} 文件才跑` : (c.exts || []).length ? `有新提交改了 ${(c.exts || []).map((x) => `.${x}`).join(' ')} 才跑` : '有新提交才跑')
  const schedState = (): ScheduleState => ({ schedules: schedules.map((x) => { const pj = projects.find((p) => p.id === x.projectId); return { ...x, describe: describeTrigger(x.trigger), describeCondition: condText(x.condition), projectName: pj?.name || '', problem: pj ? blockedOf(pj) : '工程已经不在列表里，请编辑这个定时任务换一个工程' } }), templates: SCHEDULE_TEMPLATES, login: { supported: true, on: loginOn }, tray: schedules.some((x) => x.enabled), now: Date.now(),
    scope, blocked: Object.fromEntries(projects.map((p) => [p.id, blockedOf(p)]).filter(([, r]) => r)) as Record<string, string> })
  const schedOf = (id: string) => { const x = schedules.find((y) => y.id === id); if (!x) throw new Error('这个定时任务已经删除'); return x }

  const api: AstroApi = {
    platform: KYLIN ? 'linux' : 'win32',
    async getState() { return appState() },
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb) },
    project: {
      async open(id) {
        const p = projects.find((x) => x.id === id)
        if (p && p !== project) { project = p; task = null; act = createActivity(); status = 'idle'; questions = []; queued = [] }
        return appState()
      },
      async add() { return null },
      async addPath() { throw new Error('模拟实现里不能打开文件夹') },
      async pin(id, on) { const p = projects.find((x) => x.id === id); if (p) p.pinned = on; return [...projects] },
      async setInfo(id, info) { const p = projects.find((x) => x.id === id); if (p) Object.assign(p, info); return [...projects] },
      async hide(id) { if (id === project.id) throw new Error('正在用的工作区不能移出，先切到别的工作区'); const p = projects.find((x) => x.id === id); if (p) { p.hidden = true; p.pinned = false }; return appState() },
      async files(q) { const t = q.toLowerCase(); return FILES.filter((f) => f.toLowerCase().includes(t)) },
      async tree() { return [...new Set([...FILES, ...files.keys()])].sort() },
      async read(path) {
        const f = files.get(path)
        if (/\.(docx?|xlsx?)$/i.test(path)) return { path, binary: true, text: null, size: 9876 }
        const text = f ? f.after : path.endsWith('rt_drv.c') ? RT_DRV_BEFORE
          : path.endsWith('.h') ? `/* ${path.split('/').pop()}：接口声明（示例） */\n#ifndef RT_DRV_H\n#define RT_DRV_H\n\n#define RT_RESET_TMO_TICKS  10U\n\nint rt_reset(unsigned ticks);\nint rt_stack_push(unsigned short word);\n\n#endif\n`
          : path.endsWith('.svg') ? LONG_SVG
          : path.endsWith('.md') ? `# ${path.split('/').pop()?.replace(/\.md$/, '')}\n\n## 4.2 复位\n\n复位后等待就绪位，elapsed ≥ 10 tick 视为超时，返回 RT_ERR_TIMEOUT。\n`
          : `/* ${path} */\n`
        return { path, binary: false, text, size: text.length }
      },
      async mentions(text) {
        const out: { name: string; paths: string[]; at: number }[] = []
        const names = new Map<string, string[]>()
        for (const f of FILES) { const b = f.split('/').pop()!; names.set(b, [...(names.get(b) || []), f]) }
        for (const [name, paths] of names) { const at = text.indexOf(name); if (at >= 0 && !/[A-Za-z0-9_.-]/.test(text[at - 1] || '') && !/[A-Za-z0-9_]/.test(text[at + name.length] || '')) out.push({ name, paths, at }) }
        return out.sort((a, b) => a.at - b.at).map(({ name, paths }) => ({ name, paths }))
      },
    },
    task: {
      async start(input: StartInput) {
        const picked = (input.skills || []).map((n) => SKILLS.find((x) => x.name === n)).filter(Boolean) as SkillCard[]
        const first = picked[0]
        const legacy = STAGES.find((s) => s.id === input.stage)
        const stage = first ? { id: first.name, name: picked.map((x) => x.title).join(' + '), skill: first.name } : legacy || { id: 'general', name: '通用', skill: '' }
        act = createActivity()
        ctx = 0
        files = new Map()
        questions = []
        queued = []
        task = { id: `t-${Date.now()}`, sessionId: 's', stage: stage.id, stageName: stage.name, skill: stage.skill, skills: picked.map((x) => x.name), category: first?.category, mode: input.mode || categoryMode(first?.category || '其他'), title: input.prompt.split('\n')[0].slice(0, 60), prompt: input.prompt, files: input.files, startedAt: Date.now(), endedAt: null, status: 'starting', snapshot: { commit: 'abc', tree: 'def' }, commit: null }
        historyOf(project.id).unshift(task)
        status = 'starting'
        pushState()
        await wait(700)
        status = 'running'
        ev('user/message', { content: [{ type: 'text', text: input.prompt }], source: { kind: 'user' } })
        const r = ++run
        void drive(r, input.prompt)
        return task
      },
      async send(text, extra) {
        // 模拟引擎：追问带的技能和文件只在显示上体现
        const note = [extra?.skills?.length ? `技能：${extra.skills.join(' + ')}` : '', extra?.files?.length ? `文件：${extra.files.join('、')}` : ''].filter(Boolean).join('；')
        if (note) text = `${text}\n（${note}）`
        if (status === 'running' || status === 'asking') {
          const q = { id: `u${Date.now()}`, text, at: Date.now() }
          queued.push(q)
          emitUi({ type: 'queued', payload: { id: q.id, text } })
          pushState()
          return
        }
        if (!task) return
        if (status === 'stopped' || status === 'error') return api.task.resume(text)
        status = 'running'
        ev('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' } })
        const r = ++run
        void (async () => {
          try {
            turn++
            ev('turn/start', { turn })
            await say(r, `收到：${text}`)
            ev('turn/end', { turn, reason: { kind: 'completed' } })
            status = 'done'
            pushState()
          } catch { /* 停止 */ }
        })()
      },
      async stop() {
        run++
        answerWaiter = null
        for (const q of questions) emitUi({ type: 'question-closed', payload: { id: q.id, reason: 'aborted' } })
        questions = []
        const unsent = queued.map((q) => q.text)
        queued = []
        act.current = null
        for (const { item, call } of act.calls.values()) if (call.status === 'running') { call.status = 'interrupted'; emitUi({ type: 'activity', payload: [plainItem(item)] }) }
        status = 'stopped'
        pushState()
        return { ms: 40, unsent }
      },
      async resume(text) {
        status = 'starting'
        pushState()
        await wait(900)
        status = 'running'
        ev('user/message', { content: [{ type: 'text', text: text || '刚才的任务被中断了，请从中断的地方接着做。' }], source: { kind: 'user' } })
        const r = ++run
        void drive(r, text || '')
      },
      async answer(id, answers) {
        questions = questions.filter((q) => q.id !== id)
        emitUi({ type: 'question-closed', payload: { id, reason: 'answered', answers } })
        status = 'running'
        pushState()
        const w = answerWaiter
        answerWaiter = null
        w?.(answers)
        return true
      },
      async reset() { task = null; act = createActivity(); status = 'idle'; questions = []; queued = []; pushState() },
      async open(id) { const t = historyOf(project.id).find((h) => h.id === id)!; return { task: t, items: act.items.map(plainItem) } },
      async history() { return historyOf(project.id) },
      async rename(pid, id, title) { const t = (task?.id === id ? task : null) || historyOf(pid).find((h) => h.id === id); if (!t) throw new Error('找不到这个任务的记录'); t.title = title; if (task?.id === id) { task.title = title; pushState() } return t },
      async archive(pid, id, on) { const t = (task?.id === id ? task : null) || historyOf(pid).find((h) => h.id === id); if (!t) throw new Error('找不到这个任务的记录'); t.archived = on; return t },
      async remove(pid, id) { if (task?.id === id) { if (['starting', 'running', 'asking'].includes(status)) throw new Error('任务进行中，先停止再删除'); task = null; act = createActivity(); status = 'idle'; pushState() } const l = historyOf(pid); const i = l.findIndex((h) => h.id === id); if (i >= 0) l.splice(i, 1); return true },
      async recent(limit = 12) { return Object.fromEntries(projects.filter((p) => !p.hidden).map((p) => [p.id, historyOf(p.id).slice(0, limit)])) },
      async peek(id) { const t = historyOf(project.id).find((h) => h.id === id)!; return { task: t, items: act.items.map(plainItem), current: false } },
      async peekIn(pid, id) {
        if (task && task.id === id) return { task: { ...task }, items: act.items.map(plainItem), live: ['starting', 'running', 'asking'].includes(status), summary: summarize(act) }
        const t = historyOf(pid).find((h) => h.id === id)
        if (!t) throw new Error('找不到这个任务的记录')
        return { task: t, items: [
          { id: 'u1', kind: 'user', at: t.startedAt, text: t.prompt },
          { id: 'a1', kind: 'assistant', at: t.startedAt + 60_000, text: '这次巡检对 12 个 .c 文件做了 Cppcheck 和 GJB 8114 规则扫描，结果写在 `巡检/静态分析/2026-11-18/`。和上次比，新增 2 个问题、消失 1 个。\n\n## 待确认\n\n1. 工程里有两份 `rt_drv.c`（src/ 和 backup/），只分析了 src/ 下的，backup/ 看起来是旧版本。' },
          { id: 'e1', kind: 'turn-end', at: t.startedAt + 61_000, reason: 'completed' },
        ], live: false, summary: null }
      },
      async outputs() {
        const exts: Record<string, string[]> = { 需求分析: ['md', 'docx'], 概要设计: ['md', 'docx'], 详细设计: ['md', 'docx'], 单元测试: ['c', 'md'], 代码走查: ['md', 'xlsx'], 信息流梳理: ['svg', 'md'], 编码: ['c'] }
        return projects.filter((p) => !p.hidden).flatMap((p) => historyOf(p.id).filter((t) => !t.archived).flatMap((t) => (exts[t.stageName] || ['md']).map((e, i) => ({
          pid: p.id, pname: p.name, taskId: t.id, taskTitle: t.title, stageName: t.stageName, startedAt: t.startedAt,
          path: `doc/${t.stageName}-${t.id.slice(-4)}.${e}`, exists: i < 2, size: 12000 + i * 3000, mtime: t.startedAt + 600000,
        })))).sort((a, b) => b.mtime - a.mtime)
      },
      async search(q, scope = 'all') {
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
        const ps = projects.filter((p) => !p.hidden && (scope === 'all' || p.id === project.id))
        const tasks = ps.flatMap((p) => historyOf(p.id).filter((t) => terms.length && terms.every((x) => `${t.title}\n${t.prompt}`.toLowerCase().includes(x))).map((t) => ({ pid: p.id, pname: p.name, task: t, inTitle: terms.every((x) => t.title.toLowerCase().includes(x)) })))
        const fileList = ps.flatMap((p) => historyOf(p.id).flatMap((t) => [`doc/${t.stageName}-${t.id.slice(-4)}.md`, `doc/${t.stageName}-${t.id.slice(-4)}.docx`].map((path) => ({ pid: p.id, pname: p.name, taskId: t.id, taskTitle: t.title, path }))))
        return { tasks: tasks.slice(0, 30), files: terms.length ? fileList.filter((f) => terms.every((x) => f.path.toLowerCase().includes(x))).slice(0, 30) : [] }
      },
    },
    web: {
      async state() { return webSt },
      async set(p) { Object.assign(webSt, p.port ? { port: p.port } : {}, p.lan !== undefined ? { lan: p.lan } : {}, p.enabled !== undefined ? { enabled: p.enabled, running: p.enabled } : {}, p.newToken ? { token: Math.random().toString(36).slice(2, 14) } : {}); webSt.urls = webSt.lan ? [`http://192.168.1.23:${webSt.port}`] : [`http://127.0.0.1:${webSt.port}`]; return { ...webSt } },
    },
    schedule: {
      async list() { return schedState() },
      async save(d) {
        if (!d.name.trim()) throw new Error('请给定时任务起个名字')
        if (!d.prompt.trim()) throw new Error('请写清楚每次运行要做什么')
        const pj = projects.find((p) => p.id === d.projectId)
        const bl = pj && blockedOf(pj)
        if (bl && d.enabled !== false) throw new Error(bl)
        if (d.trigger.freq === 'once' && d.enabled !== false && (!d.trigger.at || d.trigger.at <= Date.now())) throw new Error('只跑一次的时间要在以后')
        const old = d.id ? schedOf(d.id) : null
        const x: Schedule = { ...(old || { id: `s${Date.now()}`, createdAt: Date.now(), runs: [] }), name: d.name.trim(), prompt: d.prompt.trim(), projectId: d.projectId, skills: d.skills, mode: d.mode, options: d.options,
          trigger: d.trigger, condition: d.condition, enabled: d.enabled !== false, updatedAt: Date.now(), pending: null, describe: describeTrigger(d.trigger), nextRunAt: d.enabled !== false ? nextRun(d.trigger, Date.now()) : null }
        if (old) schedules[schedules.indexOf(old)] = x
        else schedules.push(x)
        return { id: x.id, state: schedState() }
      },
      async remove(id) { const i = schedules.findIndex((x) => x.id === id); if (i >= 0) schedules.splice(i, 1); return schedState() },
      async enable(id, on) { const x = schedOf(id); x.enabled = on; x.nextRunAt = on ? nextRun(x.trigger, Date.now()) : null; return schedState() },
      async runNow(id) {
        const x = schedOf(id)
        const t = await api.task.start({ prompt: x.prompt, skills: x.skills, files: [], options: { report: !!x.options.report }, mode: x.mode })
        t.title = x.name
        t.schedule = { id: x.id, name: x.name, due: Date.now(), catchup: false, manual: true }
        t.unattended = true
        const run = { id: `r${Date.now()}`, at: Date.now(), due: Date.now(), status: 'started' as const, manual: true, taskId: t.id, projectId: project.id, task: { status: 'running' as const, title: x.name, startedAt: Date.now(), endedAt: null, commit: null, restoredAt: null } }
        x.runs = [run, ...x.runs]
        x.lastRunAt = run.at
        return { run, state: schedState() }
      },
      async login(on) { loginOn = on; return schedState() },
    },
    model: {
      async test() { await new Promise((r) => setTimeout(r, 600)); return { ok: true, ms: 600, model: MOCK_MODEL.model, reply: '连接正常（模拟）' } },
      async probe() { await sleep(KYLIN ? 2400 : 1200); return MOCK_PROBE },
      async list() { return modelList() },
      async save(d) {
        await wait(300)
        if (!d.name.trim()) throw new Error('给模型起个名字')
        if (!/^https?:\/\/[^\s/]+/.test(d.baseURL)) throw new Error('地址要以 http:// 或 https:// 开头')
        if (!d.model.trim()) throw new Error('填模型名')
        const old = customModels.find((x) => x.id === d.id)
        const rec: ModelProfile = { id: old ? old.id : `m${customModels.length + 1}`, name: d.name, baseURL: d.baseURL.replace(/\/+$/, ''), model: d.model, thinkingFormat: d.thinkingFormat, contextWindow: d.contextWindow, maxTokens: d.maxTokens, input: d.input, hasKey: !!d.key || !!old?.hasKey, builtin: false }
        if (old) Object.assign(old, rec); else customModels.push(rec)
        if (d.use) activeModelId = rec.id
        return modelList()
      },
      async remove(id) { customModels = customModels.filter((x) => x.id !== id); if (activeModelId === id) activeModelId = 'dept'; return modelList() },
      async activate(id) { activeModelId = id; return modelList() },
      async probeDraft(d) {
        const ds = /deepseek/i.test(d.model) || /10\.0\.0\.10/.test(d.baseURL)
        const id = d.model || (ds ? 'deepseek-v4' : 'qwen3.8-27b')
        if (d.listOnly) {
          await wait(500)
          const listMeta = ds ? [{ id: 'deepseek-v4', maxModelLen: 131072, family: 'deepseek' }] : [{ id: 'qwen3.8-27b', maxModelLen: 131072, family: 'qwen' }]
          return { ...MOCK_PROBE, baseURL: d.baseURL, model: listMeta[0].id, models: listMeta.map((x) => x.id), listMeta, checks: [{ item: '服务和模型', status: 'ok' as const, detail: `vLLM · ${listMeta.length} 个模型（21 ms）` }], suggest: {} }
        }
        await wait(1600)
        const fam = ds ? 'DeepSeek' : 'Qwen（通义千问）'
        return {
          ok: true, baseURL: d.baseURL, server: 'vLLM', model: id, models: [id], family: fam, maxModelLen: d.contextWindow, tokPerSec: ds ? 38 : 46, ms: 7200, suggest: {},
          checks: [
            { item: '服务和模型', status: 'ok' as const, detail: `vLLM · ${id} · 上下文 ${Math.round(d.contextWindow / 1024)}K · ${fam}（24 ms）` },
            { item: '上下文窗口', status: 'ok' as const, detail: `设置 ${d.contextWindow}，服务端 ${d.contextWindow}` },
            { item: '对话', status: 'ok' as const, detail: `${ds ? 1420 : 1180} ms，约 ${ds ? 38 : 46} tokens/秒（含首字等待）` },
            { item: '工具调用', status: 'ok' as const, detail: '结构化 tool_calls：read_file("src/tm_udp.c")（1030 ms）' },
            { item: '思考', status: 'ok' as const, detail: '思考内容单独返回（540 字，5800 ms），答案：2' },
          ],
        }
      },
    },
    review: {
      async changes(): Promise<Change[]> {
        return [...files.entries()].map(([path, f]) => {
          const a = f.after.split('\n').length - 1
          const b = f.before ? f.before.split('\n').length - 1 : 0
          return { path, status: f.before === null ? 'A' : 'M', added: f.before === null ? a : 1, removed: f.before === null ? 0 : Math.max(0, b - a + 1 - 1), binary: false }
        })
      },
      async file(path) {
        const f = files.get(path)
        if (!f) { // 没改过的文件：前后一样，和真实主进程一致
          const r = await api.project.read(path)
          return { path, binary: r.binary, before: r.text, after: r.text, existedBefore: true, existsNow: true }
        }
        return { path, binary: false, before: f.before ?? null, after: f.after ?? null, existedBefore: f.before != null, existsNow: true }
      },
      async commit(message, paths) {
        await wait(400)
        if (task) task.commit = { sha: 'a3f9c21e5d', message, at: Date.now(), files: paths?.length || files.size }
        pushState()
        return 'a3f9c21e5d'
      },
      async undo() { if (task) task.commit = null; pushState() },
      async restore() { const n = files.size; files = new Map(); if (task) task.restoredAt = Date.now(); pushState(); return n },
    },
    kb: {
      async inbox() { return { dir: 'C:\\Users\\lixf\\AppData\\Local\\AstroLab\\library\\mine\\待整理', items: inbox.map((x) => ({ ...x })), reports: reports.map((x) => ({ ...x })), distill: { lastRun: Date.now() - 6 * 86400000, pending: 4, skipped: 0, scope: 'sample' as const, mine: 'C:\\Users\\lixf\\AppData\\Local\\AstroLab\\library\\mine' } } },
      async accept(path: string) {
        const i = inbox.findIndex((x) => x.path === path)
        if (i < 0) throw new Error('这个候选已经不在了')
        if (inbox[i].problems.length) throw new Error(`先改一下再采纳：${inbox[i].problems.join('；')}`)
        const [c] = inbox.splice(i, 1)
        const meta = { ...c.meta }; delete meta.status
        const e: KbEntry = { id: `mine:knowledge/${meta.kind}/${Date.now()}.md`, lib: 'mine', libName: '我的库', writable: true, path: '', meta, body: c.body }
        kbEntries.unshift(e)
        return e.id
      },
      async discard(path: string) { inbox = inbox.filter((x) => x.path !== path); reports = reports.filter((x) => x.path !== path) },
      async distill() { throw new Error('浏览器预览里不能整理（要在工作台里运行）') },
      async obsidian() { return { opened: false, installed: true, dir: 'C:\\Users\\lixf\\AppData\\Local\\AstroLab\\library\\mine' } },
      async openMine() {},
      async search(q, f) {
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
        return kbEntries.filter((e) => (!f?.kind || e.meta.kind === f.kind) && (!f?.lib || e.lib === f.lib) && terms.every((t) => `${e.meta.title} ${e.meta.tags.join(' ')} ${e.body}`.toLowerCase().includes(t)))
          .map((e): KbHit => ({ id: e.id, title: e.meta.title, kind: e.meta.kind, model: e.meta.model || '', tags: e.meta.tags, lib: e.lib, libName: e.libName, writable: e.writable, path: e.path, date: e.meta.date || '', author: e.meta.author || '', status: e.meta.status || '', source: e.meta.source || '', score: 1, snippet: (e.body.split('\n').find((l) => l.trim() && !l.startsWith('```')) || '').replace(/\*\*|`/g, '') }))
      },
      async read(id) { const e = kbEntries.find((x) => x.id === id); if (!e) throw new Error('没有这个条目'); return e },
      async save({ id, meta, body }) {
        const old = id ? kbEntries.find((x) => x.id === id) : null
        if (old) { old.meta = meta; old.body = body; return old.id }
        const e: KbEntry = { id: `mine:knowledge/${meta.kind}/${Date.now()}.md`, lib: 'mine', libName: '我的库', writable: true, path: '', meta: { ...meta, date: '2026-10-27', author: 'lixf' }, body }
        kbEntries.unshift(e)
        return e.id
      },
      async remove(id) { kbEntries = kbEntries.filter((x) => x.id !== id) },
      async publish() { await wait(300); return { branch: 'submit/lixf/x-20261027' } },
    },
    ref: {
      async docs() { return refDocs },
      async search(q: string, doc?: string) {
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
        const hits = refDocs.flatMap((d) => d.sections.map((s) => ({ d, s }))).filter(({ d, s }) => (!doc || d.id === doc) && terms.some((t) => `${s.title} ${refText[s.no] || ''}`.toLowerCase().includes(t) || (t.includes('遥测') && s.no === '13.3') || (t.includes('需求') && /App\.C|4\.2/.test(s.no))))
        return { expanded: q.includes('遥测') ? ['telemetry', 'TM'] : q.includes('需求') ? ['requirement'] : [], hits: hits.map(({ d, s }) => ({ id: `ref:${d.id}/${s.file}`, doc: d.id, docTitle: d.title, no: s.no, title: s.title, chapter: s.chapter, pages: s.pages, license: d.license, score: 1, snippet: (refText[s.no] || 'This section describes …').slice(0, 160), cite: `${d.title} §${s.no} ${s.title}，第 ${s.pages} 页` })) }
      },
      async read(id: string) { return refRead(id) },
      async counts(_lib: string, doc: string) { const out: Record<string, number> = {}; for (const [k, v] of Object.entries(refHl)) { const [d, f] = k.split('|'); if (d === doc && v.length) out[f] = v.length } return out },
      async translate(id: string) {
        const r = refRead(id)
        for (let i = 1; i <= 3; i++) { emitUi({ type: 'ref-translate', payload: { id, job: { done: i - 1, total: 3, at: Date.now() } } }); await sleep(400) }
        refZh[id] = { from: 'mine', title: '（模拟）' + r.meta.title, model: 'deepseek-flash', at: '2026-11-02 10:40', edited: false, stale: false, paragraphs: r.paragraphs.map((p) => p.startsWith('#') ? p.replace(/^(#+ [\d.]+ ).*/, '$1遥测帧') : p.startsWith('*') ? '*图 13.3 遥测帧格式*' : '遥测数据按帧组织，每帧以同步字开头，地面站据此找到帧的起点。对一种格式，帧长固定，帧计数用来发现丢帧。') }
        emitUi({ type: 'ref-translate', payload: { id, job: null } })
        return refRead(id)
      },
      async saveTranslation(id: string, paras: string[]) { refZh[id] = { ...refZh[id]!, paragraphs: paras, edited: true, stale: false }; return refRead(id) },
      async saveOriginal(id: string, text: string) { refEdit[id] = text; if (refZh[id]) refZh[id] = { ...refZh[id]!, stale: true }; return refRead(id) },
      async revert(id: string, what: 'original' | 'translation') { if (what === 'original') delete refEdit[id]; else delete refZh[id]; return refRead(id) },
      async submit() { return { branch: 'submit/lixf/ref-20261102' } },
      async addHighlight(id: string, h) { const k = hlKey(id); const item: RefHighlight = { id: `h${Date.now()}`, at: Date.now(), ...h, note: h.note || '' }; (refHl[k] ||= []).push(item); return item },
      async updateHighlight(id: string, hid: string, patch) { const h = (refHl[hlKey(id)] || []).find((x) => x.id === hid)!; Object.assign(h, patch); return h },
      async removeHighlight(id: string, hid: string) { refHl[hlKey(id)] = (refHl[hlKey(id)] || []).filter((x) => x.id !== hid); return true },
    },
    update: {
      async state() { return { ...up } },
      async check() { up = { ...up, working: 'check' }; upEmit(); await sleep(700); up = { ...up, working: null, check: { at: Date.now(), available: true, latest: LATEST, error: null } }; upEmit(); return { ...up } },
      async stage() {
        const total = 23, totalBytes = 4_800_000
        for (let i = 1; i <= total; i++) { up = { ...up, working: 'stage', progress: { files: i, total, bytes: Math.round(totalBytes * i / total), totalBytes } }; upEmit(); await sleep(60) }
        up = { ...up, working: null, progress: null, staged: { version: '0.2.0', changed: total, removed: 2, bytes: totalBytes, notes: LATEST.notes } }; upEmit(); return { ...up }
      },
      async apply() { up = { ...up, working: 'apply' }; upEmit(); return true },
    },
    skills: {
      async list() { return SKILLS },
      async pin(name: string, on: boolean) { const x = SKILLS.find((k) => k.name === name); if (x) x.pinned = on; return SKILLS.map((k) => ({ ...k })) },
    },
    lib: {
      async state() { return { sources: libSources, mine: 'D:\\…\\library\\mine' } },
      async sync() { await wait(400); return libSources },
      async addSource(x) { libSources.push({ id: x.name, name: x.name, url: x.url, branch: x.branch || 'main', model: x.model || '', preset: false, local: false, writable: false, cloned: true, syncing: false, lastSync: Date.now(), error: '' }); return libSources },
      async removeSource(id) { libSources = libSources.filter((x) => x.id !== id); return libSources },
      async catalog() { return catalog },
      async install(key) { const i = catalog.find((c) => c.key === key)!; i.installed = true; return { kind: i.kind, name: i.name, restarted: true } },
      async uninstall(kind, name) { const i = catalog.find((c) => c.kind === kind && c.name === name); if (i) i.installed = false; return { restarted: true } },
      async read(key) { const i = catalog.find((c) => c.key === key)!; return { item: i, text: `---\nname: ${i.name}\n---\n\n# ${i.title || i.name}\n\n${i.description}\n\n## 步骤\n\n1. 确认输入……`, readme: '' } },
      async submit() { await wait(300); return { branch: 'submit/lixf/x' } },
      async submissions() { return [{ branch: 'submit/lixf/fu-wei', library: 'dept', path: 'knowledge/经验/复位.md', title: '知识：1553B RT 复位用大于或等于判就绪', at: Date.now() - 3600_000, status: '待审核' }, { branch: 'submit/lixf/crc-tools-20261028', library: 'dept', path: 'plugins/crc-tools', title: '插件：crc-tools', at: Date.now() - 86400_000, status: '已退回', reason: '工具服务代码有风险（联网 / 执行外部命令 / 写项目外）；server.mjs 第 40 行用 child_process 调了外部命令，请改成只读文件', rejectedBy: '王工', rejectedAt: Date.now() - 7200_000 }] },
      async pending() { return [{ ref: 'origin/submit/wang/crc', branch: 'submit/wang/crc', author: '王工', at: Date.now() - 7200_000, title: '插件：crc-tools', files: [{ status: 'A', path: 'plugins/crc-tools/plugin.json' }, { status: 'A', path: 'plugins/crc-tools/mcp/crc/server.mjs' }] }] },
      async pendingFile(_id, _ref, path) { return { path, before: null, after: '{\n  "name": "crc-tools"\n}\n' } },
      async approve(_id, ref) { await wait(900); return { branch: ref, title: '插件：crc-tools', merged: true } },
      async reject(_id, ref) { await wait(600); return { branch: ref, title: '插件：crc-tools', rejected: true, reasonSaved: true } },
      async create(kind, prompt) { return api.task.start({ stage: kind, prompt, files: [], options: { report: false } }) },
    },
    sys: { async openPath() {}, async showItem() {}, async copy() {}, async openIn() {} },
  }

  // 截图检查用：直接进入某个画面
  const scene = new URLSearchParams(location.search).get('scene')
  if (scene && scene !== 'launch') {
    setTimeout(async () => {
      await api.task.start({ stage: 'utest', prompt: scene === 'ask' ? '先问我再做' : '为 rt_drv 和 rt_msg 设计并运行单元测试', files: ['utest/rt1553/doc/rt1553-详细设计.md', 'utest/rt1553/src/rt_drv.c'], options: { report: true } })
    }, 50)
  }
  return api
}
