// 任务控制器测试（模拟引擎 + 临时 Git 仓库）：发起、完成、审核改动、提交；提问；停止与继续；插话；引擎预热与共用。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineBridge } from '../engine/engine.mjs'
import { TaskController } from '../main/task.mjs'
import * as git from '../main/git.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOCK = join(HERE, '..', 'engine', 'mock-dsh.mjs')

async function setup(t, { env = {}, warm, bridgeOn = true } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'astro-proj-'))
  mkdirSync(join(ws, 'utest', 'rt1553', 'src'), { recursive: true })
  writeFileSync(join(ws, 'utest', 'rt1553', 'src', 'rt_drv.c'), 'int rt_reset(int t) { return 0; }\n')
  await git.initRepo(ws, '示例工程初始版本')
  const data = mkdtempSync(join(tmpdir(), 'astro-data-'))
  const bridge = new EngineBridge()
  await bridge.listen()
  let made = 0
  const ctl = new TaskController({
    bridge, dataDir: data, logDir: join(data, 'logs'), warm,
    makeEngine: () => {
      made++
      const e = { ...process.env, MOCK_DSH_SPEED: '0.02', ...env }
      if (bridgeOn) e.ASTROLAB_BRIDGE = bridge.path
      return new Engine({ dshBin: MOCK, nodePath: process.execPath, cwd: ws, provider: 'mock', model: 'mock', env: e })
    },
  })
  await ctl.setProject({ id: 'p1', name: '示例', path: ws })
  t.after(async () => { await ctl.dispose(); await bridge.close() })
  return { ws, ctl, bridge, made: () => made }
}
const until = (f, ms = 8000) => new Promise((res, rej) => {
  const t0 = Date.now()
  const tick = setInterval(() => { if (f()) { clearInterval(tick); res() } else if (Date.now() - t0 > ms) { clearInterval(tick); rej(new Error('等待超时')) } }, 20)
})

test('发起任务 → 完成 → 审核改动 → 只提交任务改动', async (t) => {
  const { ws, ctl, bridge } = await setup(t)
  const states = []
  const notes = []
  ctl.on('state', (s) => states.push(s.status))
  ctl.on('notify', (n) => notes.push(n))
  const items = new Map()
  ctl.on('activity', (xs) => xs.forEach((x) => items.set(x.id, x)))
  const task = await ctl.start({ stage: 'utest', prompt: '为 rt_drv 设计并运行单元测试', files: ['utest/rt1553/src/rt_drv.c'] })
  assert.ok(task.snapshot && task.snapshot.tree)
  await until(() => ctl.status === 'done')
  assert.ok(states.includes('starting') && states.includes('running'))
  assert.equal(notes.at(-1).kind, 'done')
  const s = ctl.snapshotState()
  assert.equal(s.summary.todos.length, 6)
  assert.ok([...items.values()].some((i) => i.kind === 'assistant'))
  const ch = await ctl.changes()
  assert.deepEqual(ch.map((c) => c.path).sort(), ['utest/rt1553/test/stub_hw.c', 'utest/rt1553/test/test_rt_drv.c', 'utest/rt1553/test/单元测试报告-rt_drv.md'])
  const v = await ctl.fileVersions('utest/rt1553/test/test_rt_drv.c')
  assert.equal(v.before, null)
  assert.match(v.after, /TC-RT-DRV-007/)
  const sha = await ctl.commit('单元测试：rt_drv')
  assert.ok(sha)
  assert.equal(ctl.task.commit.files, 3)
  // 审核始终相对任务前的快照：提交后列表不变，界面按 task.commit 显示“已提交”
  assert.equal((await ctl.changes()).length, 3)
})

test('提问：状态变为等你决定，回答后继续并完成', async (t) => {
  const { ctl, bridge } = await setup(t)
  const asked = []
  ctl.on('question', (q) => { asked.push(q); setTimeout(() => ctl.answer(q.id, [{ id: 'lang', selected: ['英文'] }, { id: 'title', selected: [], custom: 'RT 通信测试' }]), 30) })
  const statuses = []
  ctl.on('state', (s) => statuses.push(s.status))
  await ctl.start({ stage: 'utest', prompt: '[ask] 先问我' })
  await until(() => ctl.status === 'done')
  assert.equal(asked.length, 1)
  assert.ok(statuses.includes('asking'))
  assert.match(ctl.snapshotState().summary.lastAssistantText, /英文/)
})

test('停止：只中止当前轮，问题失效，引擎不退出；继续接着做', async (t) => {
  const { ctl, made } = await setup(t)
  const closed = []
  ctl.on('question-closed', (c) => closed.push(c))
  await ctl.start({ stage: 'utest', prompt: '[ask] 先问我' })
  await until(() => ctl.status === 'asking')
  const pid = ctl.engine.pid
  const r = await ctl.stop()
  assert.ok(r.ms < 2000, `停止用时 ${r.ms}`)
  assert.equal(ctl.status, 'stopped')
  assert.equal(closed[0].reason, 'aborted')
  assert.equal(ctl.questions.size, 0)
  assert.equal(ctl.engine.pid, pid, '引擎进程不变')
  assert.equal(ctl.activity.items.at(-1).reason, 'aborted')
  await ctl.send('报告用英文，标题 RT 通信测试')
  await until(() => ctl.status === 'done')
  assert.equal(made(), 1, '只启动过一次引擎')
})

test('运行中插话：下一步之前送到（同一轮），接收后移出队列', async (t) => {
  const { ctl } = await setup(t)
  const queued = []
  ctl.on('queued', (q) => queued.push(q))
  await ctl.start({ stage: 'utest', prompt: '做单元测试' })
  await until(() => ctl.activity.steps >= 2)
  await ctl.send('复位超时的边界多测一个 9 tick')
  assert.equal(queued.length, 1)
  await until(() => ctl.queued.length === 0)
  assert.equal(ctl.status, 'running', '插话在这一轮中途被接收，任务还没结束')
  await until(() => ctl.status === 'done')
  const users = ctl.activity.items.filter((i) => i.kind === 'user')
  assert.equal(users.length, 2)
  assert.equal(ctl.activity.items.filter((i) => i.kind === 'turn-end').length, 1)
})

test('启动中插话：等第一条被接收后再送，顺序不乱', async (t) => {
  const { ctl } = await setup(t, { env: { MOCK_DSH_INIT_MS: '400' }, warm: false })
  const p = ctl.start({ stage: 'utest', prompt: '做单元测试' })
  await until(() => ctl.status === 'starting')
  await ctl.send('报告标题用 RT 通信测试')
  assert.equal(ctl.queued.length, 1)
  await p
  await until(() => ctl.status === 'done')
  const users = ctl.activity.items.filter((i) => i.kind === 'user').map((i) => i.text)
  assert.deepEqual(users, ['做单元测试', '报告标题用 RT 通信测试'])
  assert.equal(ctl.queued.length, 0)
})

test('引擎冷启动时停止：记为已停止（不是出错），继续时补发第一条', async (t) => {
  const { ctl } = await setup(t, { env: { MOCK_DSH_INIT_MS: '500' }, warm: false })
  const p = ctl.start({ stage: 'utest', prompt: '做单元测试' })
  await until(() => ctl.status === 'starting')
  await ctl.stop()
  assert.equal(ctl.status, 'stopped')
  await p
  assert.equal(ctl.status, 'stopped')
  assert.equal(ctl.task.firstSent, false)
  await ctl.resume()
  await until(() => ctl.status === 'done')
  assert.equal(ctl.activity.items.filter((i) => i.kind === 'user').length, 1)
})

test('打开项目就预热引擎，多个任务共用', async (t) => {
  const { ctl, made } = await setup(t)
  await until(() => ctl.engineState === 'ready')
  assert.equal(ctl.task, null)
  const pid = ctl.engine.pid
  await ctl.start({ stage: 'utest', prompt: '做单元测试' })
  await until(() => ctl.status === 'done')
  await ctl.reset()
  await ctl.start({ stage: 'review', prompt: '[fail] 走查' })
  await until(() => ctl.status === 'done')
  assert.equal(ctl.engine.pid, pid)
  assert.equal(made(), 1)
})

test('引擎桥不可用：停止退回结束进程，继续时重启并恢复会话', async (t) => {
  const { ctl, made } = await setup(t, { bridgeOn: false })
  await ctl.start({ stage: 'utest', prompt: '[slow] 做单元测试' })
  await until(() => ctl.status === 'running' && ctl.activity.steps >= 1)
  const pid = ctl.engine.pid
  await ctl.stop()
  assert.equal(ctl.status, 'stopped')
  await until(() => ctl.engineState === 'ready')
  assert.notEqual(ctl.engine.pid, pid, '后台重启了引擎')
  await ctl.send('[fail] 换个做法')
  await until(() => ctl.status === 'done')
  assert.equal(made(), 2)
})

test('历史：任务记录可以重新打开', async (t) => {
  const { ctl, bridge } = await setup(t)
  const task = await ctl.start({ stage: 'utest', prompt: '做单元测试' })
  await until(() => ctl.status === 'done')
  await ctl.dispose()
  const h = ctl.history()
  assert.equal(h[0].id, task.id)
  const rec = await ctl.openTask(task.id)
  assert.ok(rec.items.length > 5)
  assert.equal(ctl.status, 'done')
  await bridge.close()
})
