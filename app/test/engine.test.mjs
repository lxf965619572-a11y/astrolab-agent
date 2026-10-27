// 引擎层测试：事件整理（用真实引擎日志片段）、引擎进程收发、引擎桥（提问、插话、停止）、恢复（用模拟引擎）。
// 真实 DSH 上的同类验证：node test/real-dsh.mjs（假的模型服务，不花模型调用）
// 运行：node --test app/test/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createActivity, applyEvent, summarize } from '../engine/activity.mjs'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOCK = join(HERE, '..', 'engine', 'mock-dsh.mjs')

function replay(name) {
  const st = createActivity()
  for (const line of readFileSync(join(HERE, 'fixtures', name), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.event) applyEvent(st, r.event)
  }
  return st
}

test('真实日志：基本任务整理为活动', () => {
  const st = replay('s1-basic.jsonl')
  const kinds = st.items.map((i) => i.kind)
  assert.equal(kinds[0], 'user')
  assert.equal(kinds.at(-1), 'turn-end')
  assert.equal(st.items.at(-1).reason, 'completed')
  const tools = st.items.filter((i) => i.kind === 'tools')
  assert.ok(tools.length >= 2)
  // 同一步里连续读 3 个文件合并成一条
  const reads = tools.find((i) => i.group === 'read')
  assert.ok(reads && reads.calls.length === 3, `读文件合并：${reads && reads.calls.length}`)
  assert.ok(reads.calls.every((c) => c.status === 'done'))
  assert.ok(st.items.some((i) => i.kind === 'thinking' && typeof i.ms === 'number'))
  const s = summarize(st)
  assert.equal(s.steps, 6)
  assert.equal(s.current, null)
  assert.ok(s.lastAssistantText.length > 0)
})

test('真实日志：提问工具单独成条', () => {
  const st = replay('s6-ask.jsonl')
  const ask = st.items.find((i) => i.kind === 'tools' && i.group === 'ask')
  assert.ok(ask)
  assert.equal(ask.calls[0].questions, 2)
  assert.equal(ask.calls[0].status, 'done')
})

test('真实日志：停止前的进行中调用', () => {
  const st = replay('s3-stopped.jsonl')
  const s = summarize(st)
  assert.ok(s.steps >= 1)
  assert.equal(s.endedAt, null) // 进程被结束，没有 turn/end
})

test('引擎补丁：关掉联网工具，加提问工具和引擎桥', () => {
  const f = writeEnginePatch(mkdtempSync(join(tmpdir(), 'astro-patch-')))
  const s = readFileSync(f, 'utf8')
  assert.match(s, /- id: tool-web\n {2}disabled: true/)
  assert.match(s, /@deepseek-ai\/dsh-tool-ask-user/)
  assert.match(s, /id: astrolab-bridge\n.*file:\/\/.*\/bridge\.mjs/)
})

function mockEngine(cwd, extra = {}) {
  return new Engine({
    dshBin: MOCK, nodePath: process.execPath, cwd, provider: 'mock', model: 'mock',
    env: { ...process.env, MOCK_DSH_SPEED: '0.02', ...extra.env }, ...extra,
  })
}

test('模拟引擎：完整任务、写文件、进度', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astro-ws-'))
  const eng = mockEngine(cwd)
  const st = createActivity()
  const statuses = []
  eng.on('session.event', (p) => applyEvent(st, p.event))
  eng.on('session.status', (p) => statuses.push(p.status))
  const init = await eng.start()
  assert.equal(init.serverInfo.name, 'deepseek-harness-sdk-runtime')
  const r = await eng.prompt('t1', '为 rt_drv 设计并运行单元测试')
  assert.ok(r.messageId)
  await eng.wait('t1')
  await eng.shutdown()
  assert.deepEqual(statuses, ['running', 'idle'])
  const s = summarize(st)
  assert.equal(s.files, 3)
  assert.ok(s.added > 10)
  assert.equal(s.todos.length, 6)
  assert.ok(s.todos.every((t) => t.status === 'completed'))
  assert.ok(existsSync(join(cwd, 'utest/rt1553/test/test_rt_drv.c')))
  assert.ok(st.items.some((i) => i.kind === 'tools' && i.group === 'skill'))
  assert.ok(!st.items.some((i) => i.kind === 'tools' && i.group === 'plan' && !i.hidden))
})

test('模拟引擎：越界被拒绝标出', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astro-ws-'))
  const eng = mockEngine(cwd)
  const st = createActivity()
  eng.on('session.event', (p) => applyEvent(st, p.event))
  await eng.start()
  await eng.prompt('t2', '[fail] 写个文件')
  await eng.wait('t2')
  await eng.shutdown()
  const w = st.items.find((i) => i.kind === 'tools' && i.group === 'write')
  assert.ok(w.denied)
  assert.ok(w.calls[0].denied)
})

test('模拟引擎 + 引擎桥：问题送到工作台，回答交回', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astro-ws-'))
  const bridge = new EngineBridge()
  await bridge.listen()
  const qs = []
  bridge.on('question', (q) => { qs.push(q); setTimeout(() => bridge.answer(q.id, [{ id: 'lang', selected: ['英文'] }, { id: 'title', selected: [], custom: 'RT 通信测试' }]), 30) })
  const eng = mockEngine(cwd, { env: { ASTROLAB_BRIDGE: bridge.path } })
  const st = createActivity()
  eng.on('session.event', (p) => applyEvent(st, p.event))
  await eng.start()
  await eng.prompt('t3', '[ask] 问我两个问题')
  await eng.wait('t3')
  await eng.shutdown()
  await bridge.close()
  assert.equal(qs.length, 1)
  assert.equal(qs[0].session, 't3')
  assert.equal(qs[0].questions.length, 2)
  assert.match(summarize(st).lastAssistantText, /英文.*RT 通信测试/)
})

test('模拟引擎：session/prompt 发的后续排到下一轮（真实 DSH 的规则）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astro-ws-'))
  const eng = mockEngine(cwd)
  const st = createActivity()
  const spliced = []
  eng.on('session.event', (p) => { applyEvent(st, p.event); if (p.event.type === 'agent/inbox/spliced') spliced.push(p.event) })
  await eng.start()
  await eng.prompt('t4', '做单元测试')
  await new Promise((r) => setTimeout(r, 60))
  await eng.prompt('t4', '复位超时的边界多测一个 9 tick')
  await eng.wait('t4')
  await eng.shutdown()
  assert.equal(spliced.length, 1)
  assert.equal(st.items.filter((i) => i.kind === 'user').length, 2)
  assert.equal(st.items.filter((i) => i.kind === 'turn-end').length, 2)
})

test('模拟引擎：停止（结束进程）后恢复会话', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'astro-ws-'))
  let eng = mockEngine(cwd)
  await eng.start()
  await eng.prompt('t5', '[slow] 做单元测试')
  await new Promise((r) => setTimeout(r, 50))
  const ms = await eng.kill()
  assert.equal(eng.alive, false)
  assert.ok(ms < 5000)
  await assert.rejects(eng.prompt('t5', 'x'), /引擎未运行/)
  eng = mockEngine(cwd)
  await eng.start()
  await eng.resume('t5')
  await eng.shutdown()
})

async function bridged(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'astro-ws-'))
  const bridge = new EngineBridge()
  await bridge.listen()
  const eng = mockEngine(cwd, { env: { ASTROLAB_BRIDGE: bridge.path } })
  const st = createActivity()
  const events = []
  const statuses = []
  eng.on('session.event', (p) => { applyEvent(st, p.event); events.push(p.event) })
  eng.on('session.status', (p) => statuses.push(p.status))
  await eng.start()
  assert.ok(await bridge.waitFor(eng.pid, 3000), '插件应在启动时连上')
  t.after(async () => { await eng.shutdown(); await bridge.close() })
  return { cwd, bridge, eng, st, events, statuses }
}
const until = (f, ms = 8000) => new Promise((res, rej) => {
  const t0 = Date.now()
  const tick = setInterval(() => { if (f()) { clearInterval(tick); res() } else if (Date.now() - t0 > ms) { clearInterval(tick); rej(new Error('等待超时')) } }, 10)
})

test('引擎桥：插话（steer）在本轮的下一步之前送到', async (t) => {
  const { bridge, eng, st, events } = await bridged(t)
  assert.deepEqual(bridge.byPid.get(eng.pid).features, ['ask', 'steer', 'cancel'])
  await eng.prompt('s1', '做单元测试')
  await until(() => events.filter((e) => e.type === 'tool/result').length >= 2)
  const r = await bridge.steer(eng.pid, 's1', '复位超时的边界多测一个 9 tick')
  assert.equal(r.wasRunning, true)
  assert.ok(r.messageId)
  await eng.wait('s1')
  const users = events.filter((e) => e.type === 'user/message')
  assert.equal(users.length, 2)
  assert.equal(users[1].data.id, r.messageId)
  assert.equal(events.filter((e) => e.type === 'turn/start').length, 1, '同一轮')
  assert.ok(st.items.some((i) => i.kind === 'assistant' && /收到/.test(i.text)))
})

test('引擎桥：停止（cancel）只中止当前轮，进程不退出；继续用 steer 唤醒', async (t) => {
  const { bridge, eng, events, statuses } = await bridged(t)
  await eng.prompt('s2', '[slow] 做单元测试')
  await until(() => statuses.includes('running'))
  const r = await bridge.cancel(eng.pid, 's2')
  assert.equal(r.wasRunning, true)
  await until(() => statuses.at(-1) === 'idle')
  const end = events.find((e) => e.type === 'turn/end')
  assert.equal(end.data.reason.kind, 'aborted')
  assert.equal(eng.alive, true)
  const s = await bridge.state(eng.pid, 's2')
  assert.deepEqual([s.status, s.pending], ['idle', false])
  await bridge.steer(eng.pid, 's2', '[ask] 接着做')
  await until(() => events.filter((e) => e.type === 'turn/start').length === 2)
})

test('引擎桥：等回答时停止，问题失效（abort）', async (t) => {
  const { bridge, eng, statuses } = await bridged(t)
  const q = new Promise((r) => bridge.once('question', r))
  const ab = new Promise((r) => bridge.once('abort', r))
  await eng.prompt('s3', '[ask] 先问我')
  const asked = await q
  await bridge.cancel(eng.pid, 's3')
  const a = await ab
  assert.equal(a.id, asked.id)
  await until(() => statuses.at(-1) === 'idle')
  assert.equal(bridge.answer(asked.id, []), false)
})

test('引擎桥：插件没连上时请求立刻失败（工作台据此退回旧做法）', async () => {
  const bridge = new EngineBridge()
  await bridge.listen()
  assert.equal(bridge.has(12345, 'steer'), false)
  await assert.rejects(bridge.steer(12345, 'x', 'y'), /未连接/)
  assert.equal(await bridge.waitFor(12345, 50), false)
  await bridge.close()
})
