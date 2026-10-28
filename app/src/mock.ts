// 浏览器里的模拟接口：没有 Electron 时使用。按剧本生成与真实引擎相同格式的会话事件，
// 用真实的事件整理代码（engine/activity.mjs）得到活动记录，界面看到的数据与实机一致。
// 只用于开发和截图检查；URL 带 ?scene=task|review|ask|launch 可以直接进入某个画面。

import type { AppState, AstroApi, AstroEvent, CatalogItem, Change, Item, KbEntry, KbHit, KbMeta, LibSource, Question, SkillCard, StartInput, Task, TaskState } from './api'
// @ts-ignore 纯 JS 模块
import { applyEvent, createActivity, plainItem, summarize } from '../engine/activity.mjs'

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
  "summary": "任务书、ICD → 需求规格说明，标出说不清的地方",
  "title": "需求分析",
  "description": "依据单机软件研制任务书、技术要求、接口控制文件（ICD）等上级材料做航天嵌入式软件需求分析：划分配置项、梳理功能模块和外部接口，编写需求条目，做质量自查和上级追溯，列出待确认问题，按需输出 GJB 438B 软件需求规格说明初稿。当用户要求需求分析、梳理任务书或技术要求、编写软件需求规格说明、划分配置项、梳理接口、检查需求条目时使用。",
  "category": "需求",
  "keywords": [
   "需求",
   "任务书",
   "ICD",
   "需求规格"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：根据任务书第 3 章整理 RT 通信软件的需求规格",
  "hint": "会按部门需求规格模板逐条编号，并标出任务书里说得不清的地方",
  "report": "生成需求规格说明（部门模板）"
 },
 {
  "name": "preliminary-design",
  "summary": "需求 → 模块划分、接口定义和需求分配",
  "title": "概要设计",
  "description": "依据软件需求规格说明、硬件接口文件和通信协议（ICD），编写航天嵌入式软件配置项的概要设计说明：CSCI 级设计决策、模块划分和需求分配、执行方案（启动流程、主循环调度、中断）、最坏情况时序分析、共享数据保护、外部接口和模块接口、数据和存储分配、资源余量、可靠性安全性设计、需求追溯，并列出上级文件之间的矛盾和缺漏。当用户要求写概要设计、软件结构设计、体系结构设计、执行方案、模块划分或需求分配时使用。",
  "category": "设计",
  "keywords": [
   "概要设计",
   "模块划分",
   "接口"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：为 RT 通信软件划分模块并定义接口",
  "hint": "每个模块都会追溯到需求条目，缺口会单独列出",
  "report": "生成概要设计说明（部门模板）"
 },
 {
  "name": "detailed-design",
  "summary": "写到每个函数的处理步骤、异常和共享数据",
  "title": "详细设计",
  "description": "依据软件需求规格说明、概要设计说明和硬件接口文件，编写航天嵌入式软件模块的详细设计说明：写到每个函数（含 static）的原型、输入输出、处理步骤、异常处理、全局数据和共享数据保护、时序，关键函数画流程图，建立需求追溯。也支持已有代码时补写详细设计，并列出代码与需求、概要设计、接口文件不一致的地方。当用户要求写详细设计、软件单元设计、函数设计、程序流程图，或为已有代码补写设计文档时使用。",
  "category": "设计",
  "keywords": [
   "详细设计",
   "函数",
   "流程图"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：写 rt_drv 模块的详细设计，含流程图",
  "hint": "流程图会以 Word 可编辑的形式放进文档",
  "report": "生成详细设计说明（部门模板）"
 },
 {
  "name": "coding",
  "summary": "按详细设计写 C 代码，编译并跑 Cppcheck",
  "title": "编码",
  "description": "依据详细设计为航天嵌入式软件（SPARC BM3803/3823/3883 裸机、飞腾 D2000 Linux）编写或修改 C 代码：逐个函数对照设计实现，遵守部门 C 编码规则（GJB 8114 方向），写文件头和函数头注释并标注设计追溯，用严格告警编译、用 Cppcheck 检查，问题修完后按走查检查表自查，输出编码说明。当用户要求按设计写代码、实现某个函数或模块、按设计修改代码、修复走查或测试发现的问题时使用。",
  "category": "编码",
  "keywords": [
   "编码",
   "实现",
   "代码",
   "编译"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：按详细设计 4.2 实现 rt_reset 和 rt_stack_push",
  "hint": "写完会用平台编译器编译、跑 Cppcheck，问题修完再交给你",
  "report": "附编码说明和静态检查结果"
 },
 {
  "name": "unit-test-design",
  "summary": "设计用例、写驱动和桩，跑测试出报告",
  "title": "单元测试",
  "description": "依据详细设计为航天嵌入式 C 软件模块设计单元测试：分析被测函数，按等价类、边界值、判定/条件/MC/DC 设计用例，编写手写驱动和桩（SPARC 等裸机代码）或 gtest 用例（D2000 Linux 代码），在主机上编译运行并统计语句、分支、MC/DC 覆盖率，记录疑似缺陷和未覆盖项，输出单元测试报告。当用户要求单元测试、写测试用例、写驱动和桩、补覆盖率、分析 MC/DC 时使用。",
  "category": "测试",
  "keywords": [
   "单元测试",
   "测试用例",
   "覆盖率",
   "桩"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：为 rt_drv 和 rt_msg 设计并运行单元测试",
  "hint": "预期值只取自设计，失败不会改预期；疑似缺陷会单独列出",
  "report": "生成单元测试报告（部门模板）"
 },
 {
  "name": "code-walkthrough",
  "summary": "按 GJB 8114 和部门规范逐项走查",
  "title": "代码走查",
  "description": "按 GJB 8114 与部门 C 编码规范对嵌入式 C 代码（SPARC BM3803/3823/3883 或 D2000）进行走查，结合 Cppcheck 结果输出问题清单。当用户要求代码走查、代码审查、规范检查、静态分析告警甄别时使用。",
  "category": "走查",
  "keywords": [
   "走查",
   "审查",
   "规范检查",
   "Cppcheck"
  ],
  "source": "builtin",
  "pinned": true,
  "placeholder": "例如：走查 rt_msg.c，重点看中断和共享数据",
  "hint": "按部门走查单逐项检查，每条意见都给出行号和依据",
  "report": "生成走查记录（部门模板）"
 },
 {
  "name": "skill-authoring",
  "summary": "把一项工作的做法写成部门技能",
  "title": "技能创作",
  "description": "和用户一起把一项研发工作的做法写成部门技能（SKILL.md + 参考资料 + 检查脚本 + 试用用例），放进“我的库”的 skills/ 下，试用通过后再提交到共享库审核。当用户要求新建技能、把自己的做法或部门规范做成技能、改进已有技能时使用。",
  "category": "创作",
  "keywords": [
   "技能",
   "创作"
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
const REPORT = `# 单元测试报告 · rt_drv\n\n| 项目 | 结果 |\n|---|---|\n| 用例 | 39 个 |\n| 通过 | 30 个 |\n| 失败 | 9 个，归为 3 个疑似缺陷 |\n`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createMockApi(): AstroApi {
  const listeners = new Set<(e: AstroEvent) => void>()
  const emitUi = (e: AstroEvent) => listeners.forEach((l) => l(e))
  const project = { id: 'p1', name: '示例工程', path: 'C:\\Users\\demo\\AppData\\Local\\AstroLab\\workspace\\sample', sample: true, git: true, branch: 'main' }
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
    ev('assistant/message', { message: { role: 'assistant', content: [...(reason ? [{ type: 'reasoning', text: reason }] : []), { type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }] } })
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
    ev('assistant/message', { message: { role: 'assistant', content: [...(reason ? [{ type: 'reasoning', text: reason }] : []), { type: 'text', text }] } })
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
      await tool(r, 'write', { file_path: 'D:\\temp\\out.txt', content: 'log\n' }, 'sandbox denied: write outside the workspace is not permitted')
      await stepStart(r)
      await tool(r, 'todo_write', { todos: todos(3) }, 'ok')
      await tool(r, 'mcp__utest__run_unit_tests', { test_dir: 'utest/rt1553/test' }, async () => { await wait(2400); return '编译通过；39 个用例，30 通过，9 失败' })
      await stepStart(r)
      await tool(r, 'edit', { file_path: 'utest/rt1553/src/rt_drv.c', old_string: '    while (t < ticks) {', new_string: '    /* 测试桩接入点 */\n    while (t < ticks) {' }, 'ok')
      files.set('utest/rt1553/src/rt_drv.c', { before: RT_DRV_BEFORE, after: RT_DRV_BEFORE.replace('    while (t < ticks) {', '    /* 测试桩接入点 */\n    while (t < ticks) {') })
      await tool(r, 'todo_write', { todos: todos(4) }, 'ok')
      await tool(r, 'write', { file_path: 'utest/rt1553/test/单元测试报告-rt_drv.md', content: REPORT }, 'ok')
      files.set('utest/rt1553/test/单元测试报告-rt_drv.md', { before: null, after: REPORT })
      await tool(r, 'todo_write', { todos: todos(6) }, 'ok')
      await say(r, '单元测试做完了：39 个用例，30 通过，9 失败。\n\n失败的用例按设计核对后归为 3 个疑似缺陷：\n\n1. **复位第 10 tick 就绪时仍报超时**（TC-007～010）：设计 4.2.3 要求“大于或等于 10 tick 视为就绪”，代码用了 `>`。\n2. **描述符堆栈第 65 项没有回绕**（TC-021～024）。\n3. **字数为 0 的消息按 0 个字处理**（TC-033）：1553 协议中字数 0 表示 32 个字。\n\n报告在 `utest/rt1553/test/单元测试报告-rt_drv.md`。', '核对失败用例与设计条目，确认预期值都来自设计。')
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
      emitUi({ type: 'notify', payload: { level: 2, kind: 'done', title: '单元测试完成', body: '39 个用例，30 通过，9 失败' } })
    } catch { /* 停止 */ }
  }

  function appState(): AppState {
    return {
      platform: 'win32', mock: true, installed: false,
      model: { provider: 'dept-llm', model: 'deepseek-flash', baseURL: 'https://api.deepseek.com', hasKey: true },
      engineReady: true, projects: [project], stages: STAGES, skills: SKILLS, notes: [], task: state(), items: act.items.map(plainItem),
    }
  }

  // 知识库和技能库（浏览器里看界面用）
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

  const api: AstroApi = {
    platform: 'win32',
    async getState() { return appState() },
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb) },
    project: {
      async open() { return appState() },
      async add() { return null },
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
        files = new Map()
        questions = []
        queued = []
        task = { id: `t-${Date.now()}`, sessionId: 's', stage: stage.id, stageName: stage.name, skill: stage.skill, skills: picked.map((x) => x.name), category: first?.category, title: input.prompt.split('\n')[0].slice(0, 60), prompt: input.prompt, files: input.files, startedAt: Date.now(), endedAt: null, status: 'starting', snapshot: { commit: 'abc', tree: 'def' }, commit: null }
        history.unshift(task)
        status = 'starting'
        pushState()
        await wait(700)
        status = 'running'
        ev('user/message', { content: [{ type: 'text', text: input.prompt }], source: { kind: 'user' } })
        const r = ++run
        void drive(r, input.prompt)
        return task
      },
      async send(text) {
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
      async open(id) { const t = history.find((h) => h.id === id)!; return { task: t, items: act.items.map(plainItem) } },
      async history() { return history },
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
      async submissions() { return [{ branch: 'submit/lixf/fu-wei', library: 'dept', path: 'knowledge/经验/复位.md', title: '知识：1553B RT 复位用大于或等于判就绪', at: Date.now() - 3600_000, status: '待审核' }] },
      async pending() { return [{ ref: 'origin/submit/wang/crc', branch: 'submit/wang/crc', author: '王工', at: Date.now() - 7200_000, title: '插件：crc-tools', files: [{ status: 'A', path: 'plugins/crc-tools/plugin.json' }, { status: 'A', path: 'plugins/crc-tools/mcp/crc/server.mjs' }] }] },
      async pendingFile(_id, _ref, path) { return { path, before: null, after: '{\n  "name": "crc-tools"\n}\n' } },
      async approve(_id, ref) { await wait(900); return { branch: ref, title: '插件：crc-tools', merged: true } },
      async reject(_id, ref) { await wait(600); return { branch: ref, title: '插件：crc-tools', rejected: true } },
      async create(kind, prompt) { return api.task.start({ stage: kind, prompt, files: [], options: { report: false } }) },
    },
    sys: { async openPath() {}, async showItem() {} },
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
