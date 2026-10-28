// 库的测试：用本机的裸仓库当“内网 Git 服务器”。同步、目录、安装、提交审核、通过、退回、知识检索。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Library } from '../main/library.mjs'
import { buildIndex, search, writeEntry } from '../../mcp/knowledge/lib/kb.mjs'

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, DEPT_UI_GIT: '1' } })
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
const SKILL = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\n步骤……\n`

function setup() {
  const t = mkdtempSync(join(tmpdir(), 'astro-lib-'))
  // 让测试不受本机 git 全局配置影响：没有 user.name 时用系统用户名
  process.env.GIT_CONFIG_GLOBAL = join(t, 'gitconfig')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
  const server = join(t, 'server', 'dept.git')
  mkdirSync(server, { recursive: true })
  run(server, 'init', '-q', '--bare', '-b', 'main')
  const seed = join(t, 'seed')
  mkdirSync(seed)
  run(seed, 'init', '-q', '-b', 'main')
  put(seed, 'skills/spw-review/SKILL.md', SKILL('spw-review', 'SpaceWire 报文走查'))
  put(seed, 'plugins/crc-tools/plugin.json', JSON.stringify({ name: 'crc-tools', title: 'CRC 工具', version: '1.0.0', description: '计算和核对 CRC', skills: ['skills'], mcp: [{ name: 'crc', command: 'node', args: ['mcp/crc/server.mjs'] }] }))
  put(seed, 'plugins/crc-tools/skills/crc-check/SKILL.md', SKILL('crc-check', '核对报文 CRC'))
  put(seed, 'plugins/crc-tools/mcp/crc/server.mjs', '// 工具服务\n')
  put(seed, 'knowledge/经验/2026-10-01-看门狗.md', '---\ntitle: 看门狗只在主循环末尾喂\nkind: 经验\ntags: [看门狗]\n---\n等待循环里无条件喂狗会掩盖死循环。\n')
  run(seed, 'add', '-A')
  run(seed, '-c', 'user.name=seed', '-c', 'user.email=s@x', 'commit', '-q', '-m', '初始内容')
  run(seed, 'push', '-q', server, 'main')
  const root = join(t, 'root')
  put(root, 'skills/coding/SKILL.md', SKILL('coding', '编码'))
  put(root, 'config/libraries.json', JSON.stringify({ sources: [{ id: 'dept', name: '部门通用库', url: server, branch: 'main' }] }))
  const lib = new Library({ dataDir: join(t, 'data'), root })
  return { t, server, root, lib }
}

test('同步共享库、目录、安装技能和插件', async () => {
  const { lib } = setup()
  await lib.ensureMine()
  const st = await lib.sync('dept')
  assert.equal(st.error, '')
  assert.ok(st.cloned)
  const cat = await lib.catalog()
  const keys = cat.map((c) => c.key)
  assert.ok(keys.includes('builtin:skill:coding'))
  assert.ok(keys.includes('dept:skill:spw-review'))
  assert.ok(keys.includes('dept:plugin:crc-tools'))
  await lib.install('dept:skill:spw-review')
  await lib.install('dept:plugin:crc-tools')
  const dirs = lib.skillDirs()
  assert.ok(dirs.some((d) => d.endsWith(join('installed', 'skills'))))
  assert.ok(dirs.some((d) => d.endsWith(join('crc-tools', 'skills'))))
  const mcp = lib.mcpServers('/usr/bin/node')
  assert.equal(mcp.length, 1)
  assert.equal(mcp[0].command, '/usr/bin/node')
  assert.ok(mcp[0].args[0].endsWith(join('crc-tools', 'mcp', 'crc', 'server.mjs')))
  assert.match(mcp[0].name, /^[A-Za-z0-9_-]{1,32}$/)
  const after = await lib.catalog()
  assert.ok(after.find((c) => c.key === 'dept:plugin:crc-tools').installed)
  await assert.rejects(lib.install('builtin:skill:coding'), /没有这个库/)
  lib.uninstall('plugin', 'crc-tools')
  assert.equal(lib.mcpServers('/n').length, 0)
})

test('提交审核：分支推到服务器，审核人通过后进主分支；退回的看得到状态', async () => {
  const { lib, server } = setup()
  const mine = await lib.ensureMine()
  await lib.sync('dept')
  const rel = writeEntry(mine, { title: '1553B RT 复位用大于或等于判就绪', kind: '经验', tags: ['1553B'], status: '草稿' }, '设计规定 elapsed >= 10 tick 超时。')
  await lib.commitMine([rel], '知识库：复位')
  const { branch } = await lib.submit('dept', rel, '知识：复位')
  assert.match(branch, /^submit\/[a-z0-9_-]+\/.+-\d{14}$/)
  assert.ok(run(server, 'branch', '--list', branch).trim())
  let subs = await lib.submissions()
  assert.equal(subs[0].status, '待审核')
  const pend = await lib.pending('dept')
  assert.equal(pend.length, 1)
  assert.deepEqual(pend[0].files.map((f) => f.path), [rel])
  const v = await lib.pendingFile('dept', pend[0].ref, rel)
  assert.equal(v.before, null)
  assert.match(v.after, /复位/)
  assert.doesNotMatch(v.after, /草稿/, '提交时去掉草稿状态')
  const ok = await lib.approve('dept', pend[0].ref)
  assert.deepEqual([ok.merged, ok.title], [true, '知识：复位'])
  assert.ok(existsSync(join(lib.source('dept').dir, rel)), '同步后主分支上有了')
  subs = await lib.submissions()
  assert.equal(subs[0].status, '已通过')
  // 已经通过、内容没变：再提交时直接说明，不报 git 的原始错误
  await assert.rejects(lib.submit('dept', rel, '知识：复位'), /已经是这个版本了/)
  // 退回
  put(mine, 'skills/my-skill/SKILL.md', SKILL('my-skill', '我的技能'))
  await lib.commitMine(['skills/my-skill'], '技能：my-skill')
  await lib.submit('dept', 'skills/my-skill', '技能：my-skill')
  const p2 = await lib.pending('dept')
  // 同一项又交了一次：旧的标为“已有更新的提交”
  await new Promise((r) => setTimeout(r, 1100))
  put(mine, 'skills/my-skill/SKILL.md', SKILL('my-skill', '我的技能（改过）'))
  await lib.submit('dept', 'skills/my-skill', '技能：my-skill')
  const p3 = await lib.pending('dept')
  assert.equal(p3.length, 2)
  assert.deepEqual(p3.map((p) => p.superseded), [false, true], '新的在前且有效，旧的标出来')
  await lib.reject('dept', p3[1].ref)
  const rj = await lib.reject('dept', p3[0].ref)
  assert.equal(rj.rejected, true)
  subs = await lib.submissions()
  assert.equal(subs[0].status, '已退回')
  assert.equal((await lib.pending('dept')).length, 0)
  // 知识检索覆盖我的库和共享库
  const hits = search(buildIndex(lib.available()), '复位 就绪')
  assert.ok(hits.length >= 1)
  assert.ok(hits.some((h) => h.lib === 'dept'))
  assert.ok(search(buildIndex(lib.available()), '看门狗').length >= 1)
})

test('技能卡片：内置、安装的、插件里的都列出；头信息字段和默认值；设为常用', async () => {
  const { lib, root } = setup()
  put(root, 'skills/coding/SKILL.md', '---\nname: coding\ndescription: 依据详细设计写代码。当用户要求编码时使用。\ntitle: 编码\ncategory: 编码\nsummary: 按设计写 C 代码\nkeywords: [编码, 实现]\npinned: true\nreport: 附编码说明\n---\n\n# 编码\n')
  await lib.ensureMine()
  await lib.sync('dept')
  await lib.install('dept:skill:spw-review')
  await lib.install('dept:plugin:crc-tools')
  const cards = lib.skillCards()
  const by = Object.fromEntries(cards.map((c) => [c.name, c]))
  assert.deepEqual(Object.keys(by).sort(), ['coding', 'crc-check', 'spw-review'])
  assert.deepEqual([by.coding.title, by.coding.category, by.coding.summary, by.coding.pinned, by.coding.source, by.coding.report], ['编码', '编码', '按设计写 C 代码', true, 'builtin', '附编码说明'])
  assert.deepEqual(by.coding.keywords, ['编码', '实现'])
  // 没写新字段的老技能：显示名取标题、类别是“其他”、一句话取描述第一句、不在常用里
  assert.equal(by['spw-review'].title, 'spw-review')
  assert.equal(by['spw-review'].category, '其他')
  assert.equal(by['spw-review'].summary, 'SpaceWire 报文走查')
  assert.equal(by['spw-review'].pinned, false)
  assert.equal(by['spw-review'].source, 'installed')
  assert.equal(by['crc-check'].plugin, 'crc-tools')
  // 设为常用 / 取消常用，覆盖头信息
  assert.equal(lib.setPinned('spw-review', true).find((c) => c.name === 'spw-review').pinned, true)
  assert.equal(lib.setPinned('coding', false).find((c) => c.name === 'coding').pinned, false)
  assert.equal(lib.skillCards().find((c) => c.name === 'coding').pinned, false, '偏好会保存')
})

test('连不上服务器：同步报错但不抛出，我的库照常可用', async () => {
  const { lib } = setup()
  lib.addSource({ name: 'xh-a', url: '/no/such/repo.git', model: '型号A' })
  const st = await lib.sync('xh-a')
  assert.ok(st.error)
  assert.equal(st.cloned, false)
  assert.ok(lib.available().some((l) => l.id === 'mine'))
  assert.ok(!lib.available().some((l) => l.id === 'xh-a'))
  assert.throws(() => lib.removeSource('dept'), /不能移除/)
  lib.removeSource('xh-a')
  assert.ok(!lib.sources().some((s) => s.id === 'xh-a'))
  void readFileSync
})

test('我的库里的和共享库里一样时标出来（不用再提交）；改过后就不一样了', async () => {
  const { lib } = setup()
  const mine = await lib.ensureMine()
  await lib.sync('dept')
  put(mine, 'skills/flow-skill/SKILL.md', SKILL('flow-skill', '画流程'))
  await lib.commitMine(['skills/flow-skill'], '技能：flow-skill')
  const sameOf = async () => (await lib.catalog()).find((i) => i.mine && i.name === 'flow-skill').sameIn
  assert.deepEqual(await sameOf(), [], '还没交')
  await lib.submit('dept', 'skills/flow-skill', '技能：flow-skill')
  const [p] = await lib.pending('dept')
  await lib.approve('dept', p.ref)
  assert.deepEqual(await sameOf(), ['dept'], '通过合进主分支后：和部门库一样')
  put(mine, 'skills/flow-skill/SKILL.md', SKILL('flow-skill', '画流程（改过）'))
  assert.deepEqual(await sameOf(), [], '改过就要再交')
})

test('换文件夹：写完新的才换掉旧的；写的时候出错旧的原样保留；临时目录不留', async () => {
  const { replaceDir, dirDigest } = await import('../main/library.mjs')
  const { readdirSync } = await import('node:fs')
  const base = mkdtempSync(join(tmpdir(), 'astro-replace-'))
  const dest = join(base, 'plugins', 'p')
  put(dest, 'a.txt', 'v1')
  replaceDir(dest, (tmp) => put(tmp, 'a.txt', 'v2'))
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8'), 'v2')
  assert.throws(() => replaceDir(dest, (tmp) => { put(tmp, 'a.txt', 'v3'); throw new Error('复制到一半失败') }), /复制到一半/)
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8'), 'v2', '失败时旧版本还在')
  assert.deepEqual(readdirSync(join(base, 'plugins')), ['p'], '不留 .new-/.old- 临时目录')
  // 指纹：Windows 检出的 CRLF 和 LF 算同一份；跳过 node_modules
  const x = join(base, 'x'), y = join(base, 'y')
  put(x, 'SKILL.md', 'a\r\nb\r\n'); put(y, 'SKILL.md', 'a\nb\n'); put(y, 'node_modules/k/i.js', 'z')
  assert.equal(dirDigest(x), dirDigest(y))
  put(y, 'SKILL.md', 'a\nc\n')
  assert.notEqual(dirDigest(x), dirDigest(y))
})
