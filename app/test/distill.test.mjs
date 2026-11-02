// Obsidian 兼容（多行列表、忽略项、外部改动提交、共享库同步保留 .obsidian）和知识整理（素材、范围、待整理的采纳和丢弃）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Library } from '../main/library.mjs'
import { buildMaterial, distillPrompt, distillScope, pendingTasks, readState, writeState } from '../main/distill.mjs'
import * as git from '../main/git.mjs'
import { buildIndex, parseEntry, search } from '../../mcp/knowledge/lib/kb.mjs'

const run = (cwd, ...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, DEPT_UI_GIT: '1' } })
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }

function setup() {
  const t = mkdtempSync(join(tmpdir(), 'astro-distill-'))
  process.env.GIT_CONFIG_GLOBAL = join(t, 'gitconfig')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
  const root = join(t, 'root')
  mkdirSync(join(root, 'skills'), { recursive: true })
  return { t, root, lib: new Library({ dataDir: join(t, 'data'), root }) }
}

test('头信息：Obsidian 属性面板写的多行列表也认', () => {
  const { meta } = parseEntry('---\ntitle: "复位: 用大于等于"\nkind: 经验\ntags:\n  - 1553B\n  - "复位"\nsource:\nstatus: 候选\n---\n正文')
  assert.deepEqual(meta.tags, ['1553B', '复位'])
  assert.equal(meta.title, '复位: 用大于等于')
  assert.equal(meta.source, '')
  assert.deepEqual(parseEntry('---\ntags: [a, b]\nkeywords: [k1, k2]\n---\nx').meta.keywords, ['k1', 'k2'])
})

test('我的库：老库补上 Obsidian 的忽略项；在 Obsidian 里改的条目定时提交，.obsidian 不进 Git', async () => {
  const { t, root, lib } = setup()
  const mine = await lib.ensureMine()
  writeFileSync(join(mine, '.gitignore'), '.utest/\n') // 早先建的库
  run(mine, 'add', '-A'); run(mine, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', '老的忽略文件')
  const lib2 = new Library({ dataDir: join(t, 'data'), root })
  await lib2.ensureMine()
  const gi = readFileSync(join(mine, '.gitignore'), 'utf8')
  for (const x of ['.obsidian/', '.trash/', '.distill/']) assert.ok(gi.includes(x), x)
  assert.equal(run(mine, 'status', '--porcelain').trim(), '', '补忽略项也提交了')

  assert.equal(await lib2.commitExternal(), null, '没有改动')
  put(mine, 'knowledge/经验/2026-11-01-在obsidian里写的.md', '---\ntitle: 在 Obsidian 里写的\nkind: 经验\ntags:\n  - 测试\n---\n正文正文正文\n')
  put(mine, '.obsidian/app.json', '{}')
  const sha = await lib2.commitExternal()
  assert.ok(sha)
  assert.match(run(mine, 'log', '-1', '--name-only', '--pretty=format:%s'), /其他编辑器[\s\S]*在obsidian里写的/)
  assert.ok(!run(mine, 'ls-files').includes('.obsidian'), '.obsidian 不提交')
  const hits = search(buildIndex(lib2.available()), '测试', {})
  assert.ok(hits.some((h) => h.title === '在 Obsidian 里写的' && h.tags.includes('测试')))
})

test('共享库同步：丢掉本地改动，但 Obsidian 的设置留着', async () => {
  const { t, root } = setup()
  const server = join(t, 'server.git'); mkdirSync(server); run(server, 'init', '-q', '--bare', '-b', 'main')
  const seed = join(t, 'seed'); mkdirSync(seed); run(seed, 'init', '-q', '-b', 'main')
  put(seed, 'knowledge/经验/a.md', '---\ntitle: a\nkind: 经验\n---\n原文\n')
  run(seed, 'add', '-A'); run(seed, '-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-q', '-m', 'x'); run(seed, 'push', '-q', server, 'main')
  put(root, 'config/libraries.json', JSON.stringify({ sources: [{ id: 'dept', name: '部门通用库', url: server, branch: 'main' }] }))
  const lib = new Library({ dataDir: join(t, 'data'), root })
  await lib.sync('dept')
  const dir = lib.available().find((s) => s.id === 'dept').dir
  put(dir, '.obsidian/app.json', '{"x":1}')
  put(dir, 'knowledge/经验/a.md', '在 Obsidian 里改的')
  put(dir, 'knowledge/经验/新的.md', '新写的')
  await lib.sync('dept')
  assert.ok(existsSync(join(dir, '.obsidian', 'app.json')))
  assert.match(readFileSync(join(dir, 'knowledge/经验/a.md'), 'utf8'), /原文/)
  assert.ok(!existsSync(join(dir, 'knowledge/经验/新的.md')))
})

test('待整理：缺来源不能采纳；补上后移进 knowledge/、去掉“候选”、提交；丢弃报告', async () => {
  const { lib } = setup()
  const mine = await lib.ensureMine()
  put(mine, '待整理/2026-11-01/复位等待用大于等于.md', '---\ntitle: 复位等待用“大于或等于”判超时\nkind: 经验\ntags: [复位, 超时]\nstatus: 候选\n---\n\n## 结论\n设计写“≥ 10 tick 超时”时，代码用 >=，测试取 9、10、11。\n')
  put(mine, '待整理/2026-11-01-整理报告.md', '---\ntitle: 知识整理报告 2026-11-01\ndate: 2026-11-01\n---\n## 概况\n看了 2 个任务。\n')
  const ib = lib.inbox()
  assert.equal(ib.items.length, 1)
  assert.equal(ib.reports.length, 1)
  assert.deepEqual(ib.items[0].problems, ['缺来源（依据哪个任务、哪次提交或哪本书的哪一节）'])
  assert.ok(!buildIndex(lib.available()).docs.some((d) => d.title.startsWith('复位等待')), '候选不进检索')
  await assert.rejects(lib.acceptCandidate(ib.items[0].path), /缺来源/)
  const f = join(mine, ib.items[0].path)
  writeFileSync(f, readFileSync(f, 'utf8').replace('status: 候选', 'source: 任务 t-1（示例工程）\nstatus: 候选'))
  const id = await lib.acceptCandidate(ib.items[0].path)
  assert.match(id, /^mine:knowledge\/经验\/.+\.md$/)
  const e = parseEntry(readFileSync(join(mine, id.slice(5)), 'utf8'))
  assert.equal(e.meta.status, undefined)
  assert.equal(e.meta.source, '任务 t-1（示例工程）')
  assert.ok(!existsSync(f))
  assert.equal(run(mine, 'status', '--porcelain', '--', 'knowledge', ib.items[0].path).trim(), '', '采纳已提交')
  await lib.discardCandidate(ib.reports[0].path)
  assert.equal(lib.inbox().reports.length, 0)
  await assert.rejects(lib.acceptCandidate('knowledge/经验/x.md'), /不是待整理/)
  // 在 Obsidian 里把候选直接拖进 knowledge/：提交时去掉“候选”
  put(mine, 'knowledge/问题/拖进来的.md', '---\ntitle: 拖进来的候选\nkind: 问题\nsource: 任务 t-2\nstatus: 候选\n---\n正文正文正文正文正文\n')
  assert.ok(await lib.commitExternal())
  assert.equal(parseEntry(readFileSync(join(mine, 'knowledge/问题/拖进来的.md'), 'utf8')).meta.status, undefined)
  await assert.rejects(lib.acceptCandidate('待整理/../../etc.md'), /不是待整理/)
})

test('整理范围：公网接口只取示例工程；可以用设置改', () => {
  assert.equal(distillScope({}, 'https://api.deepseek.com'), 'sample')
  assert.equal(distillScope({}, 'http://10.1.2.3:8000/v1'), 'all')
  assert.equal(distillScope({ ASTROLAB_DISTILL_SCOPE: 'sample' }, 'http://10.1.2.3:8000/v1'), 'sample')
})

test('素材：人改过的地方（任务结束的版本 → 提交的版本）、插话、出错；只取上次之后、示例工程的', async () => {
  const { t } = setup()
  const data = join(t, 'data')
  const proj = join(t, 'sample-proj'); put(proj, 'src/rt.c', 'int x;\n'); await git.initRepo(proj, 'init')
  const snap = await git.snapshot(proj, 't-1')
  put(proj, 'src/rt.c', 'if (elapsed > 10) return TIMEOUT;\n') // 智能体交出的
  const out = {}; await git.changes(proj, snap.tree, out)
  const endCommit = await git.markEnd(proj, 't-1', out.tree, snap.commit)
  put(proj, 'src/rt.c', 'if (elapsed >= 10) return TIMEOUT;\n') // 人审核时改的
  const sha = await git.commit(proj, '改复位超时', ['src/rt.c'])
  const now = Date.now()
  const rec = (id, extra) => ({
    task: { id, title: `任务 ${id}`, prompt: '做单元测试', stage: 'utest', stageName: '单元测试', status: 'done', startedAt: now - 5000, endedAt: now - 1000, ...extra },
    items: [
      { kind: 'user', text: '做单元测试' },
      { kind: 'user', text: '复位超时按大于或等于判' },
      { kind: 'tools', calls: [{ name: 'bash', summary: 'make', status: 'error', result: 'gcc: not found' }, { name: 'ask_user_question', status: 'done', result: '{"answers":[{"id":"lang","selected":["中文"]}]}' }] },
      { kind: 'assistant', text: '做完了，9 个失败。' },
    ],
  })
  put(data, 'projects/p1/tasks/t-1.json', JSON.stringify(rec('t-1', { end: { tree: out.tree, commit: endCommit }, commit: { sha, files: 1, paths: ['src/rt.c'] } })))
  put(data, 'projects/p1/tasks/t-0.json', JSON.stringify(rec('t-0', { endedAt: now - 99999999 })))
  put(data, 'projects/p2/tasks/t-2.json', JSON.stringify(rec('t-2', {})))
  put(data, 'projects/lib/tasks/t-3.json', JSON.stringify(rec('t-3', { stage: 'distill' })))
  const projects = [{ id: 'p1', name: '示例工程', path: proj, sample: true }, { id: 'p2', name: '型号甲', path: join(t, 'x') }, { id: 'lib', name: '我的库', path: t, library: true }]
  const since = now - 60000
  const p = pendingTasks({ dataDir: data, projects, since, scope: 'sample' })
  assert.deepEqual(p.tasks.map((x) => x.task.id), ['t-1'])
  assert.equal(p.skipped, 1, '跳过非示例工程')
  assert.equal(pendingTasks({ dataDir: data, projects, since, scope: 'all' }).tasks.length, 2)

  const mine = join(t, 'mine'); mkdirSync(mine)
  const m = await buildMaterial({ dataDir: data, projects, mineDir: mine, since, scope: 'sample', known: ['看门狗只在主循环末尾喂（部门通用库）'], now })
  assert.equal(m.count, 1)
  const text = readFileSync(m.file, 'utf8')
  assert.match(text, /人在审核时改了的地方/)
  assert.match(text, /-if \(elapsed > 10\)[\s\S]*\+if \(elapsed >= 10\)/)
  assert.match(text, /复位超时按大于或等于判/)
  assert.match(text, /gcc: not found/)
  assert.match(text, /selected/)
  assert.match(text, /看门狗只在主循环末尾喂/)
  assert.match(text, /只取了示例工程的任务/)
  assert.ok(!text.includes('型号甲'))
  assert.match(m.rel, /^\.distill\/素材-/)
  assert.match(distillPrompt({ rel: m.rel, count: 1, date: '2026-11-01' }), /knowledge-distill[\s\S]*待整理\/2026-11-01\//)
  writeState(mine, { lastRun: now, runs: [] })
  assert.equal(readState(mine).lastRun, now)
})
