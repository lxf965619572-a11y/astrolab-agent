// 任务控制器测试（模拟引擎 + 临时 Git 仓库）：发起、完成、审核改动、提交；提问；停止与继续；插话；引擎预热与共用。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineBridge } from '../engine/engine.mjs'
import { TaskController, composeFollowUp, followUpDisplay, listOutputs, searchTasks } from '../main/task.mjs'
import * as git from '../main/git.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOCK = join(HERE, '..', 'engine', 'mock-dsh.mjs')

async function setup(t, { env = {}, warm, bridgeOn = true, skillCards } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'astro-proj-'))
  mkdirSync(join(ws, 'utest', 'rt1553', 'src'), { recursive: true })
  writeFileSync(join(ws, 'utest', 'rt1553', 'src', 'rt_drv.c'), 'int rt_reset(int t) { return 0; }\n')
  await git.initRepo(ws, '示例工程初始版本')
  const data = mkdtempSync(join(tmpdir(), 'astro-data-'))
  const bridge = new EngineBridge()
  await bridge.listen()
  let made = 0
  const ctl = new TaskController({
    bridge, dataDir: data, logDir: join(data, 'logs'), warm, skillCards,
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
  // 改动统计按快照算：工具服务生成的文件（不经过 write）也算进去
  await until(() => ctl.task.changeStat)
  assert.equal(ctl.snapshotState().summary.files, 3)
  // 智能体交出的版本记成 refs/astrolab/ends/<任务>（知识整理拿它和提交的版本比）
  await until(() => ctl.task.end)
  assert.equal((await git.git(ws, ['rev-parse', `refs/astrolab/ends/${ctl.task.id}^{tree}`])).trim(), ctl.task.end.tree)
  writeFileSync(join(ws, 'utest', 'rt1553', 'test', '单元测试报告-rt_drv.docx'), 'docx')
  await ctl.refreshChangeStat()
  assert.equal(ctl.snapshotState().summary.files, 4, '工具服务写的 Word 也算')
  rmSync(join(ws, 'utest', 'rt1553', 'test', '单元测试报告-rt_drv.docx'))
  await ctl.refreshChangeStat()
  const v = await ctl.fileVersions('utest/rt1553/test/test_rt_drv.c')
  assert.equal(v.before, null)
  assert.match(v.after, /TC-RT-DRV-007/)
  const sha = await ctl.commit('单元测试：rt_drv')
  assert.ok(sha)
  assert.equal(ctl.task.commit.files, 3)
  assert.equal(ctl.task.commit.paths.length, 3)
  // 审核始终相对任务前的快照：提交后列表不变，界面按 task.commit 显示“已提交”
  assert.equal((await ctl.changes()).length, 3)
})

test('审核时列出改动后文件又变了：先拒绝并要求重看，重新列出后照常提交', async (t) => {
  const { ws, ctl } = await setup(t)
  await ctl.start({ stage: 'utest', prompt: '为 rt_drv 设计并运行单元测试', files: ['utest/rt1553/src/rt_drv.c'] })
  await until(() => ctl.status === 'done')
  const first = (await ctl.changes()).map((c) => c.path)
  // 用户在资源管理器里把报告改了名
  const { renameSync } = await import('node:fs')
  renameSync(join(ws, 'utest/rt1553/test/单元测试报告-rt_drv.md'), join(ws, 'utest/rt1553/test/报告.md'))
  await assert.rejects(ctl.commit('单元测试：rt_drv', first), (e) => e.code === 'STALE' && /请再看一眼/.test(e.message))
  assert.ok(!ctl.task.commit)
  const again = (await ctl.changes()).map((c) => c.path)
  assert.ok(again.includes('utest/rt1553/test/报告.md') && !again.includes('utest/rt1553/test/单元测试报告-rt_drv.md'))
  const sha = await ctl.commit('单元测试：rt_drv', again)
  assert.ok(sha)
  assert.equal(ctl.task.commit.files, 3)
})

test('按技能发起：记下技能和类别；没选技能时让智能体自己判断；老的环节方式照常', async (t) => {
  const cards = [
    { name: 'unit-test-design', title: '单元测试', category: '测试', report: '生成单元测试报告' },
    { name: 'coding', title: '编码', category: '编码', report: '附编码说明' },
    { name: 'info-flow', title: '信息流梳理', category: '文档与图' },
  ]
  const { ctl } = await setup(t, { skillCards: () => cards })
  const a = await ctl.start({ skills: ['coding', 'unit-test-design'], prompt: '实现并测试 rt_reset', files: [], options: { report: false } })
  assert.deepEqual(a.skills, ['coding', 'unit-test-design'])
  assert.equal(a.category, '编码')
  assert.equal(a.mode, 'code', '编码类别默认属于代码模式')
  assert.equal(a.stageName, '编码 + 单元测试')
  assert.match(a.firstMessage, /【技能】编码 \+ 单元测试/)
  assert.match(a.firstMessage, /【技能】编码 \+ 单元测试\n\/coding \/unit-test-design\n/, '技能写成 /名字、单独一行：DSH 第一步之前就附上内容')
  assert.match(a.firstMessage, /不用再用 skill 工具加载/)
  assert.match(a.firstMessage, /不需要生成 Word 报告/)
  await until(() => ctl.status === 'done')
  const b = await ctl.start({ skills: ['info-flow'], prompt: '画信息流图', files: [], options: { report: false } })
  assert.match(b.firstMessage, /\n\/info-flow\n/)
  assert.equal(b.mode, 'task', '文档与图属于任务模式')
  assert.doesNotMatch(b.firstMessage, /Word 报告/, '不出报告的技能不提报告')
  await until(() => ctl.status === 'done')
  // “生成 Word”开关：开着要明说（技能都写“用户要求时才生成”）；任务描述里自己提了 Word 的以描述为准，开关不再加话
  const r1 = await ctl.start({ skills: ['unit-test-design'], prompt: '测试 rt_reset', files: [], options: { report: true } })
  assert.match(r1.firstMessage, /按部门模板生成 Word/)
  await until(() => ctl.status === 'done')
  const r2 = await ctl.start({ skills: ['unit-test-design'], prompt: '测试 rt_reset，并生成 Word', files: [], options: { report: false } })
  assert.doesNotMatch(r2.firstMessage, /不需要生成 Word|按部门模板生成 Word/, '和任务描述冲突时不加')
  await until(() => ctl.status === 'done')
  const c = await ctl.start({ prompt: '帮我看看这个工程', files: [], options: {}, mode: 'code' })
  assert.equal(c.mode, 'code', '在代码模式发起的通用任务属于代码模式')
  assert.equal(c.stage, 'general')
  assert.deepEqual(c.skills, [])
  assert.match(c.firstMessage, /【技能】未指定/)
  await until(() => ctl.status === 'done')
  const d = await ctl.start({ stage: 'utest', prompt: '做单元测试' })
  assert.equal(d.category, '测试')
  assert.deepEqual(d.skills, ['unit-test-design'])
  assert.match(d.firstMessage, /\n\/unit-test-design\n/)
  await until(() => ctl.status === 'done')
  await assert.rejects(ctl.start({ skills: ['nope'], prompt: 'x' }), /没有这个技能：nope/)
  await assert.rejects(ctl.start({ skills: ['a', 'b', 'c', 'd'], prompt: 'x' }), /最多选 3 个/)
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
  assert.ok(queued.length <= 1, '最多排队一次（接收比桥的回复先到时不进队列）')
  await until(() => ctl.queued.length === 0)
  assert.equal(ctl.status, 'running', '插话在这一轮中途被接收，任务还没结束')
  await until(() => ctl.status === 'done')
  const users = ctl.activity.items.filter((i) => i.kind === 'user')
  assert.equal(users.length, 2)
  assert.equal(ctl.activity.items.filter((i) => i.kind === 'turn-end').length, 1)
})

test('追问带技能和文件：拼进发给智能体的话，对话里只显示写的那句和一行说明', async (t) => {
  const msg = composeFollowUp('补测复位超时', { skills: ['unit-test-design'], files: ['utest/rt1553/src/rt_drv.c'] }, () => '单元测试')
  assert.match(msg, /【技能】单元测试\n这次请先用 skill 工具加载技能 unit-test-design/)
  assert.match(msg, /【相关文件】\n- utest\/rt1553\/src\/rt_drv\.c/)
  assert.equal(followUpDisplay(msg), '补测复位超时\n（技能：单元测试；文件：utest/rt1553/src/rt_drv.c）')
  assert.equal(followUpDisplay('普通的一句\n- 列表'), '普通的一句\n- 列表', '没带技能和文件的原样显示')
  const cards = [{ name: 'unit-test-design', title: '单元测试', category: '测试' }]
  const { ctl } = await setup(t, { skillCards: () => cards })
  await ctl.start({ stage: 'utest', prompt: '做单元测试' })
  await until(() => ctl.status === 'done')
  await ctl.send('补测复位超时', { skills: ['unit-test-design', 'no-such-skill'], files: ['utest/rt1553/src/rt_drv.c'] })
  await until(() => ctl.status === 'done' && ctl.activity.items.filter((i) => i.kind === 'user').length === 2)
  const users = ctl.activity.items.filter((i) => i.kind === 'user').map((i) => i.text)
  assert.equal(users[1], '补测复位超时\n（技能：单元测试；文件：utest/rt1553/src/rt_drv.c）')
  assert.ok(ctl.task.skills.includes('unit-test-design'), '追问用到的技能记到任务上')
  assert.ok(!ctl.task.skills.includes('no-such-skill'), '不认识的技能不带')
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

test('空闲时引擎自己退出：后台再热一个（下个任务不用等启动）；2 分钟内最多重来 3 次', async (t) => {
  const { ctl, made } = await setup(t)
  ctl.o.rewarmDelay = 50
  await until(() => ctl.engineState === 'ready')
  const first = made()
  ctl.engine.proc.kill('SIGKILL')
  await until(() => made() === first + 1 && ctl.engineState === 'ready')
  assert.equal(ctl.status, 'idle', '不影响任务状态')
  for (let i = 0; i < 3; i++) { await until(() => ctl.engineState === 'ready'); ctl.engine.proc.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 400)) }
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(made(), first + 3, '第 4 次退出后不再自动重启')
})

test('当前任务进行中时只读查看另一个任务：不切换当前任务；带技能的追问清掉上一项的步骤', async (t) => {
  const cards = [{ name: 'unit-test-design', title: '单元测试', category: '测试' }]
  const { ctl } = await setup(t, { skillCards: () => cards })
  const a = await ctl.start({ stage: 'utest', prompt: '第一个任务' })
  await until(() => ctl.status === 'done')
  assert.ok(ctl.snapshotState().summary.todos.length > 0)
  await ctl.reset()
  const b = await ctl.start({ stage: 'utest', prompt: '第二个任务' })
  await until(() => ctl.busy)
  const p = ctl.peekTask(a.id)
  assert.equal(p.task.id, a.id)
  assert.equal(p.current, false)
  assert.ok(p.items.some((i) => i.kind === 'user'))
  assert.equal(ctl.task.id, b.id, '查看不切换当前任务')
  assert.equal(ctl.peekTask(b.id).current, true)
  await until(() => ctl.status === 'done')
  assert.ok(ctl.snapshotState().summary.todos.length > 0)
  await ctl.send('再做一项', { skills: ['unit-test-design'] })
  assert.equal(ctl.snapshotState().summary.todos.length, 0, '带技能的追问：上一项的步骤清掉，等新列的')
  await until(() => ctl.status === 'done')
})

test('两个项目同时各做一个任务（shared）：各用各的引擎，提问只交给自己的控制器，互不串', async (t) => {
  const bridge = new EngineBridge()
  await bridge.listen()
  const data = mkdtempSync(join(tmpdir(), 'astro-data-'))
  const mk = async (name) => {
    const ws = mkdtempSync(join(tmpdir(), `astro-${name}-`))
    writeFileSync(join(ws, 'readme.md'), name)
    await git.initRepo(ws, '初始版本')
    const c = new TaskController({
      bridge, dataDir: data, logDir: join(data, 'logs'), shared: true, warm: false,
      makeEngine: () => new Engine({ dshBin: MOCK, nodePath: process.execPath, cwd: ws, provider: 'mock', model: 'mock', env: { ...process.env, MOCK_DSH_SPEED: '0.02', ASTROLAB_BRIDGE: bridge.path } }),
    })
    await c.setProject({ id: name, name, path: ws })
    return c
  }
  const a = await mk('pa'), b = await mk('pb')
  // 没有控制器认领的问题由外面兜底拒绝（main.mjs 里的做法）
  const declined = []
  bridge.on('question', (q) => setImmediate(() => { if (![a, b].some((c) => c.questions.has(q.id))) { declined.push(q.id); bridge.decline(q.id) } }))
  t.after(async () => { await a.dispose(); await b.dispose(); await bridge.close() })
  const askedA = [], askedB = []
  a.on('question', (q) => { askedA.push(q.id); setTimeout(() => a.answer(q.id, [{ id: 'lang', selected: ['英文'] }, { id: 'title', selected: [], custom: 'A' }]), 30) })
  b.on('question', (q) => { askedB.push(q.id) })
  await Promise.all([a.start({ stage: 'utest', prompt: '[ask] 先问我' }), b.start({ stage: 'utest', prompt: '做单元测试' })])
  await until(() => a.busy && b.busy)
  assert.notEqual(a.engine.pid, b.engine.pid, '每个项目一个引擎')
  await until(() => a.status === 'done' && b.status === 'done', 15000)
  assert.equal(askedA.length, 1)
  assert.equal(askedB.length, 0, 'A 的问题没有跑到 B')
  assert.equal(declined.length, 0)
  assert.ok(a.activity.items.some((i) => i.kind === 'user' && /先问我/.test(i.text)))
  assert.ok(!b.activity.items.some((i) => i.kind === 'user' && /先问我/.test(i.text)), 'B 的对话里没有 A 的消息')
  assert.equal(a.history().length, 1)
  assert.equal(b.history().length, 1, '任务记录按项目分开')
})

test('列步骤：一轮里做了几步还没列就提醒一次；新一轮的话带提示，对话里不显示提示', async (t) => {
  const { ctl } = await setup(t)
  const sent = []
  const orig = ctl.deliver.bind(ctl)
  ctl.deliver = (text) => { sent.push(text); return orig(text) }
  await ctl.start({ stage: 'utest', prompt: '[noplan] 看几个文件' })
  await until(() => ctl.status === 'done' && sent.length >= 1)
  assert.equal(sent.filter((x) => x.includes('请先用 todo_write')).length, 1, '每轮最多提醒一次')
  await until(() => ctl.status === 'done')
  await ctl.send('[noplan] 再看一遍')
  await until(() => ctl.status === 'done' && ctl.activity.items.filter((i) => i.kind === 'user').length >= 3)
  const follow = sent.find((x) => x.startsWith('[noplan] 再看一遍'))
  assert.ok(follow && /todo_write/.test(follow), '新一轮的话带列步骤的提示')
  const users = ctl.activity.items.filter((i) => i.kind === 'user').map((i) => i.text)
  assert.ok(users.includes('[noplan] 再看一遍'), `对话里只显示用户写的那句：${JSON.stringify(users)}`)
})

test('搜索：按标题和描述找任务，按文件名找产出（工程内相对路径，去重，不要临时文件和工程外的）', () => {
  const data = mkdtempSync(join(tmpdir(), 'astro-search-'))
  try {
    const dir = join(data, 'projects', 'p1', 'tasks')
    mkdirSync(dir, { recursive: true })
    const calls = [
      { name: 'edit', path: 'out/a.md', added: 3 },
      { name: 'write', path: 'D:\\ws\\sample\\out\\a.md', added: 1 },
      { name: 'write', path: '.tmp_x.py', added: 1 },
      { name: 'write', path: 'E:\\other\\b.md', added: 1 },
      { name: 'mcp__docgen__render_docx', result: '已生成 d:\\ws\\sample\\out\\研制总结报告.docx（模板：部门）' },
    ]
    writeFileSync(join(dir, 't-1.json'), JSON.stringify({ task: { id: 't-1', title: '写研制总结', prompt: '数据包在 package', startedAt: 1 }, items: [{ kind: 'tools', calls }] }))
    writeFileSync(join(dir, 't-2.json'), JSON.stringify({ task: { id: 't-2', title: '确认测试', prompt: '按研制要求设计用例', startedAt: 2 }, items: [] }))
    const ps = [{ id: 'p1', name: '示例', path: 'D:\\ws\\sample' }]
    const r = searchTasks(data, ps, '研制')
    assert.deepEqual(r.tasks.map((x) => x.task.id), ['t-1', 't-2'])
    assert.equal(r.tasks[0].inTitle, true)
    assert.deepEqual(r.files.map((f) => f.path), ['out/研制总结报告.docx'])
    assert.deepEqual(searchTasks(data, ps, 'out').files.map((f) => f.path), ['out/a.md', 'out/研制总结报告.docx'])
    assert.equal(searchTasks(data, ps, '').tasks.length, 0)
    assert.equal(searchTasks(data, ps, '研制 用例').tasks.length, 1)
    // 产出：同一批记录，文件不在本机（工程路径是假的）也列出，标为不在
    const outs = listOutputs(data, ps)
    assert.deepEqual(outs.map((f) => f.path).sort(), ['out/a.md', 'out/研制总结报告.docx'])
    assert.ok(outs.every((f) => !f.exists && f.pname === '示例'))
  } finally { rmSync(data, { recursive: true, force: true }) }
})

test('工程说明和参考资料写进第一条消息；产出列出任务写过的文件', async (t) => {
  const { ctl, ws } = await setup(t)
  Object.assign(ctl.project, { notes: '目标平台 BM3803\n计数器满了回绕', refs: ['doc/任务书.md', 'utest/rt1553/src/rt_drv.c'] })
  const a = await ctl.start({ stage: 'utest', prompt: '做单元测试', files: ['utest/rt1553/src/rt_drv.c'] })
  assert.match(a.firstMessage, /【工程说明】[^\n]*\n目标平台 BM3803\n计数器满了回绕/)
  assert.match(a.firstMessage, /【参考资料】[^\n]*\n- doc\/任务书\.md/)
  assert.doesNotMatch(a.firstMessage.split('【参考资料】')[1], /rt_drv\.c/, '已在相关文件里的不重复列')
  await until(() => ctl.status === 'done')
  const outs = listOutputs(ctl.o.dataDir, [{ id: 'p1', name: '示例', path: ws }])
  assert.ok(outs.length >= 1, '列出写过的文件')
  assert.ok(outs.every((f) => f.pid === 'p1' && f.taskId === a.id && !f.path.includes('\\')), JSON.stringify(outs[0]))
  assert.ok(outs.some((f) => f.exists && f.size > 0))
  Object.assign(ctl.project, { notes: '', refs: [] })
  const b = await ctl.start({ stage: 'utest', prompt: '再测一遍' })
  assert.doesNotMatch(b.firstMessage, /【工程说明】|【参考资料】/, '没写就不加')
  await until(() => ctl.status === 'done')
})
