// 浏览器里的模拟接口：没有 Electron 时使用。按剧本生成与真实引擎相同格式的会话事件，
// 用真实的事件整理代码（engine/activity.mjs）得到活动记录，界面看到的数据与实机一致。
// 只用于开发和截图检查；URL 带 ?scene=task|review|ask|launch 可以直接进入某个画面。

import type { AppState, AstroApi, AstroEvent, Change, Item, Question, StartInput, Task, TaskState } from './api'
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
const FILES = [
  'utest/rt1553/doc/rt1553-详细设计.md', 'utest/rt1553/src/rt_drv.c', 'utest/rt1553/src/rt_msg.c', 'utest/rt1553/src/rt_hw.h',
  'utest/rt1553/include/rt_drv.h', 'utest/rt1553/include/rt_msg.h', 'utest/cmd_check/doc/cmd_check-详细设计.md',
  'utest/cmd_check/src/cmd_check.c', 'utest/uart_drv/src/uart_drv.c', 'docs/软件研制任务书-示例.docx',
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
  const history: Task[] = []
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
      engineReady: true, projects: [project], stages: STAGES, notes: [], task: state(), items: act.items.map(plainItem),
    }
  }

  const api: AstroApi = {
    platform: 'win32',
    async getState() { return appState() },
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb) },
    project: {
      async open() { return appState() },
      async add() { return null },
      async files(q) { const t = q.toLowerCase(); return FILES.filter((f) => f.toLowerCase().includes(t)) },
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
        const stage = STAGES.find((s) => s.id === input.stage) || STAGES[4]
        act = createActivity()
        files = new Map()
        questions = []
        queued = []
        task = { id: `t-${Date.now()}`, sessionId: 's', stage: stage.id, stageName: stage.name, skill: stage.skill, title: input.prompt.split('\n')[0].slice(0, 60), prompt: input.prompt, files: input.files, startedAt: Date.now(), endedAt: null, status: 'starting', snapshot: { commit: 'abc', tree: 'def' }, commit: null }
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
        return { path, binary: false, before: f?.before ?? null, after: f?.after ?? null, existedBefore: f?.before != null, existsNow: !!f }
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
