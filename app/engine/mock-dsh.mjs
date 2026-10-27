#!/usr/bin/env node
// 模拟引擎：在 stdin/stdout 上按 DSH sdk 协议应答，按剧本推送会话事件，不调用模型。
// 用途：自动测试引擎层和任务控制器；开发界面时不花模型调用（环境变量 ASTROLAB_MOCK_ENGINE=1）。
//
// 剧本按用户消息里的标记选择：
//   [ask]    先用 ask_user_question 提两个问题（经真实的提问桥插件），按回答收尾
//   [fail]   第一个工具调用越界被拒绝
//   [slow]   每一步都慢，用于测试停止
//   其他     单元测试的典型过程：读设计和源码、思考、写测试和桩、编译运行、写报告、回复
// 写文件的步骤真的写到工作区（test/ 下），审核和 Git 提交可以照常测试。
// 与真实 DSH 一致的投递规则：session/prompt 排到下一轮（一轮一条）；经引擎桥 steer 的消息在下一步之前送到；
// 经引擎桥 cancel 中止当前轮（turn/end aborted），清掉待处理的消息，进程不退出。
// 节奏：MOCK_DSH_SPEED（默认 1；测试用 0.02 加快）。
//
// 只用 Node 内置模块。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEED = Number(process.env.MOCK_DSH_SPEED || 1)
let live = null // 正在进行的一轮 { sessionId, ac, steer: [] }
const sleep = (ms) => new Promise((resolve, reject) => {
  const signal = live && live.ac.signal
  if (signal && signal.aborted) return reject(signal.reason)
  const t = setTimeout(() => { signal && signal.removeEventListener('abort', onAbort); resolve() }, Math.max(1, ms * SPEED))
  const onAbort = () => { clearTimeout(t); reject(signal.reason) }
  signal && signal.addEventListener('abort', onAbort, { once: true })
})

let cwd = process.cwd()
let seq = 0
let busy = false
const queue = [] // 等待处理的用户消息 { sessionId, text, id }
const waiters = [] // session/wait

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const notify = (method, params) => out({ jsonrpc: '2.0', method, params })
const emit = (sessionId, type, data) => notify('session.event', { sessionId, event: { type, seq: seq++, time: Date.now(), data } })
const status = (sessionId, s) => notify('session.status', { sessionId, status: s })

// ---------- 引擎桥：加载真实的插件，用一个假的 Cordis 上下文（提问挂接点 + agents 服务）调用它 ----------
let askListener = null
let bridgeLoaded = false
const agents = {
  get(sessionId) {
    return {
      get status() { return live && live.sessionId === sessionId ? 'running' : 'idle' },
      get inbox() { return { get hasPending() { return queue.some((m) => m.sessionId === sessionId) || !!(live && live.sessionId === sessionId && live.steer.length) } } },
      steer(message) {
        const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        if (live && live.sessionId === sessionId && !live.ac.signal.aborted) {
          live.steer.push({ id: message.id, text })
          emit(sessionId, 'agent/inbox/spliced', { target: 'next-step', inserted: [{ id: message.id, role: 'user', content: [{ type: 'text', text }] }] })
        } else {
          queue.unshift({ sessionId, text, id: message.id })
          setTimeout(drain, 0)
        }
      },
      cancel() {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].sessionId === sessionId) queue.splice(i, 1)
        if (live && live.sessionId === sessionId) { live.steer = []; live.ac.abort({ kind: 'user' }) }
      },
    }
  },
}
async function loadBridge() {
  if (!process.env.ASTROLAB_BRIDGE || bridgeLoaded) return
  bridgeLoaded = true
  const mod = await import(pathToFileURL(join(HERE, 'bridge.mjs')).href)
  mod.apply({ agents, on: (name, fn) => { if (name === 'user-questions/request') askListener = fn } })
}
async function ask(sessionId, questions, signal) {
  if (!askListener) throw new Error('no user-questions answerer accepted the request')
  return askListener({ questions, agent: { session: { id: sessionId } }, signal }, () => Promise.reject(new Error('no user-questions answerer accepted the request')))
}

// ---------- 剧本 ----------
let turn = 0
let callN = 0
/** 步与步之间：中止就停下；有 steer 来的插话就先交给“模型”，它回一句收到 */
async function boundary(sessionId, t, n) {
  if (live && live.ac.signal.aborted) throw live.ac.signal.reason
  if (!live || !live.steer.length) return
  const ms = live.steer.splice(0)
  for (const m of ms) emit(sessionId, 'user/message', { content: [{ type: 'text', text: m.text }], source: { kind: 'user' }, role: 'user', id: m.id })
  emit(sessionId, 'step/start', { turn: t, step: n })
  await sleep(400)
  emit(sessionId, 'assistant/message', { turn: t, step: n, message: { role: 'assistant', content: [{ type: 'text', text: `收到：${ms.map((m) => m.text).join('；').slice(0, 60)}。接下来的步骤会照这个做。` }] } })
  emit(sessionId, 'step/end', { turn: t, step: n })
}
async function step(sessionId, s, n) {
  await boundary(sessionId, s.turn, n)
  emit(sessionId, 'step/start', { turn: s.turn, step: n })
  await sleep(s.think ?? 600)
}
async function tool(sessionId, t, n, name, args, run) {
  const callId = `call_${String(callN++).padStart(2, '0')}_mock`
  emit(sessionId, 'assistant/message', { turn: t, step: n, message: { role: 'assistant', content: [
    ...(args.__reason ? [{ type: 'reasoning', text: args.__reason }] : []),
    { type: 'tool-call', id: callId, name, arguments: JSON.stringify(strip(args)) },
  ] } })
  emit(sessionId, 'tool/call', { turn: t, step: n, callId, name, arguments: JSON.stringify(strip(args)) })
  let text = 'ok', isError = false
  try { text = (await run()) ?? 'ok' } catch (e) {
    if (live && live.ac.signal.aborted) {
      emit(sessionId, 'tool/result', { turn: t, step: n, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: `Error: ${(e && e.message) || 'tool call was aborted'}` }], isError: true } })
      emit(sessionId, 'step/end', { turn: t, step: n })
      throw live.ac.signal.reason
    }
    text = e.message; isError = true
  }
  emit(sessionId, 'tool/result', { turn: t, step: n, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError } })
  emit(sessionId, 'step/end', { turn: t, step: n })
}
const strip = (a) => { const { __reason, ...rest } = a; return rest }
async function say(sessionId, t, n, text, reasoning) {
  await boundary(sessionId, t, n)
  emit(sessionId, 'step/start', { turn: t, step: n })
  await sleep(500)
  emit(sessionId, 'assistant/message', { turn: t, step: n, message: { role: 'assistant', content: [
    ...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []), { type: 'text', text },
  ] } })
  emit(sessionId, 'step/end', { turn: t, step: n })
}

function writeFile(rel, content) {
  const p = join(cwd, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
  return `wrote ${rel}`
}

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
`
const REPORT_MD = `# 单元测试报告 · rt_drv（模拟）

| 项目 | 结果 |
|---|---|
| 用例 | 39 个 |
| 通过 | 30 个 |
| 失败 | 9 个，归为 3 个疑似缺陷 |
`

async function scenario(sessionId, text, signal) {
  const t = ++turn
  emit(sessionId, 'turn/start', { turn: t })
  let n = 0
  const slow = /\[slow\]/.test(text)
  const S = { turn: t, think: slow ? 4000 : 600 }
  if (/\[ask\]/.test(text)) {
    await step(sessionId, S, ++n)
    let answerText = ''
    await tool(sessionId, t, n, 'ask_user_question', { questions: [
      { id: 'lang', header: '语言', question: '测试报告用什么语言写？', options: [{ label: '中文（推荐）' }, { label: '英文' }] },
      { id: 'title', header: '标题', question: '报告标题叫什么？' },
    ] }, async () => {
      const r = await ask(sessionId, [
        { id: 'lang', header: '语言', question: '测试报告用什么语言写？', options: [{ label: '中文（推荐）', description: '用中文撰写测试报告。' }, { label: '英文', description: '用英文撰写测试报告。' }] },
        { id: 'title', header: '标题', question: '报告标题叫什么？' },
      ], signal)
      const lang = r.answers.find((a) => a.id === 'lang')
      const title = r.answers.find((a) => a.id === 'title')
      answerText = `好的，用${(lang && (lang.custom || lang.selected[0])) || '中文'}写，标题为 ${(title && (title.custom || title.selected[0])) || '（未填）'}。`
      return JSON.stringify(r)
    })
    await say(sessionId, t, ++n, answerText || '没有得到回答。')
  } else if (/\[fail\]/.test(text)) {
    await step(sessionId, S, ++n)
    await tool(sessionId, t, n, 'write', { file_path: 'D:\\temp\\out.txt', content: 'x\n' }, async () => { throw new Error('sandbox denied: write outside the workspace is not permitted') })
    await say(sessionId, t, ++n, '写入 D:\\temp\\out.txt 被拒绝，已改为写到项目内。')
  } else {
    await step(sessionId, S, ++n)
    await tool(sessionId, t, n, 'skill', { name: 'unit-test-design', __reason: '先加载单元测试技能，按技能步骤做。' }, async () => 'skill loaded: unit-test-design')
    await step(sessionId, S, ++n)
    await tool(sessionId, t, n, 'todo_write', { todos: [
      { content: '读设计和源码', status: 'in_progress' }, { content: '设计用例', status: 'pending' }, { content: '写测试和桩', status: 'pending' },
      { content: '编译运行', status: 'pending' }, { content: '写报告', status: 'pending' }, { content: '自查', status: 'pending' },
    ] }, async () => 'todos updated')
    await step(sessionId, S, ++n)
    for (const f of ['utest/rt1553/doc/rt1553-详细设计.md', 'utest/rt1553/src/rt_drv.c', 'utest/rt1553/src/rt_hw.h']) {
      await tool(sessionId, t, n, 'read', { file_path: f }, async () => { await sleep(150); return `<path>${f}</path>…` })
    }
    await step(sessionId, { ...S, think: slow ? 6000 : 1500 }, ++n)
    await tool(sessionId, t, n, 'todo_write', { __reason: '寄存器头文件 rt_hw.h 与 rt_drv.c 同目录，用 test/hw 下的同名文件替换；复位等待按“大于或等于 10 tick”取边界 9、10、11。', todos: [
      { content: '读设计和源码', status: 'completed' }, { content: '设计用例', status: 'completed' }, { content: '写测试和桩', status: 'in_progress' },
      { content: '编译运行', status: 'pending' }, { content: '写报告', status: 'pending' }, { content: '自查', status: 'pending' },
    ] }, async () => 'todos updated')
    await step(sessionId, S, ++n)
    await tool(sessionId, t, n, 'write', { file_path: 'utest/rt1553/test/test_rt_drv.c', content: TEST_C }, async () => writeFile('utest/rt1553/test/test_rt_drv.c', TEST_C))
    await tool(sessionId, t, n, 'write', { file_path: 'utest/rt1553/test/stub_hw.c', content: STUB_C }, async () => writeFile('utest/rt1553/test/stub_hw.c', STUB_C))
    await step(sessionId, S, ++n)
    await tool(sessionId, t, n, 'mcp__utest__run_unit_tests', { test_dir: 'utest/rt1553/test' }, async () => { await sleep(1200); return '编译通过；39 个用例，30 通过，9 失败' })
    await step(sessionId, S, ++n)
    await tool(sessionId, t, n, 'write', { file_path: 'utest/rt1553/test/单元测试报告-rt_drv.md', content: REPORT_MD }, async () => writeFile('utest/rt1553/test/单元测试报告-rt_drv.md', REPORT_MD))
    await tool(sessionId, t, n, 'todo_write', { todos: [
      { content: '读设计和源码', status: 'completed' }, { content: '设计用例', status: 'completed' }, { content: '写测试和桩', status: 'completed' },
      { content: '编译运行', status: 'completed' }, { content: '写报告', status: 'completed' }, { content: '自查', status: 'completed' },
    ] }, async () => 'todos updated')
    await say(sessionId, t, ++n, '单元测试已完成：39 个用例，30 通过，9 失败。失败的用例按设计核对后归为 3 个疑似缺陷，详见报告。', '核对失败用例与设计条目，确认预期值来自设计。')
  }
  emit(sessionId, 'turn/end', { turn: t, reason: { kind: 'completed' } })
}

async function drain() {
  if (busy) return
  busy = true
  while (queue.length) {
    const m = queue.shift()
    status(m.sessionId, 'running')
    emit(m.sessionId, 'user/message', { content: [{ type: 'text', text: m.text }], source: { kind: 'user' }, role: 'user', id: m.id })
    const ac = new AbortController()
    live = { sessionId: m.sessionId, ac, steer: [] }
    try { await scenario(m.sessionId, m.text, ac.signal) } catch (e) {
      if (ac.signal.aborted) emit(m.sessionId, 'turn/end', { turn, reason: { kind: 'aborted', reason: ac.signal.reason } })
      else emit(m.sessionId, 'turn/end', { turn, reason: { kind: 'error', message: e.message } })
    }
    // 这一轮结束时还有 steer 来的插话：接着处理（真实 DSH 同样不会丢）
    if (live.steer.length && !ac.signal.aborted) queue.unshift(...live.steer.map((x) => ({ sessionId: m.sessionId, text: x.text, id: x.id })))
    live = null
    if (!queue.length) status(m.sessionId, 'idle')
  }
  busy = false
  while (waiters.length) waiters.shift()()
}

// ---------- JSON-RPC ----------
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id === undefined) continue
    const reply = (result) => out({ jsonrpc: '2.0', id: msg.id, result })
    const fail = (code, message) => out({ jsonrpc: '2.0', id: msg.id, error: { code, message } })
    const p = msg.params || {}
    switch (msg.method) {
      case 'initialize':
        cwd = p.cwd || cwd
        await loadBridge()
        await sleep(300)
        // 模拟冷启动（真实 DSH 首次启动要等工具服务和技能加载完，可能几十秒）
        if (process.env.MOCK_DSH_INIT_MS) await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DSH_INIT_MS)))
        reply({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: 'mock' } })
        break
      case 'session/prompt': {
        const id = randomUUID()
        const text = (p.contentBlocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        reply({ messageId: id })
        if (busy) emit(p.sessionId, 'agent/inbox/spliced', { target: 'next-turn', inserted: [{ id, role: 'user', content: [{ type: 'text', text }] }] })
        queue.push({ sessionId: p.sessionId, text, id })
        setTimeout(drain, 0)
        break
      }
      case 'session/wait':
        if (!busy && !queue.length) reply({})
        else waiters.push(() => reply({}))
        break
      case 'session/resume':
        if (!p.sessionId) fail(-32602, 'sessionId required')
        else reply({})
        break
      case 'shutdown':
        reply({})
        setTimeout(() => process.exit(0), 20)
        break
      default:
        fail(-32601, 'method not found')
    }
  }
})
process.stdin.on('end', () => process.exit(0))
