// 定时任务的启动条件：有某类文件才跑；上次之后有新提交改了某类文件才跑（巡检/ 下的不算）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCondition, findFile, normalizeCondition } from '../main/schedule-check.mjs'
import * as gitm from '../main/git.mjs'

const commitAll = async (ws, msg) => { await gitm.git(ws, ['add', '-A']); await gitm.git(ws, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg]) }
const head = async (ws) => (await gitm.git(ws, ['rev-parse', 'HEAD'])).trim()

test('有这些文件才跑：跳过 .git、node_modules 和 巡检/', () => {
  const ws = mkdtempSync(join(tmpdir(), 'astro-cond-'))
  mkdirSync(join(ws, 'node_modules', 'x'), { recursive: true })
  writeFileSync(join(ws, 'node_modules', 'x', 'a.c'), '')
  mkdirSync(join(ws, '巡检'), { recursive: true })
  writeFileSync(join(ws, '巡检', 'b.c'), '')
  assert.equal(findFile(ws, ['c']), null)
  mkdirSync(join(ws, 'src', 'drv'), { recursive: true })
  writeFileSync(join(ws, 'src', 'drv', 'uart.C'), '')
  assert.equal(findFile(ws, ['c', 'h']), 'src/drv/uart.C')
})

test('条件的整理：类型写法宽松；“有这些文件”必须写类型', () => {
  assert.deepEqual(normalizeCondition({ kind: 'files', exts: '*.c, .H；cpp' }), { kind: 'files', exts: ['c', 'h', 'cpp'] })
  assert.deepEqual(normalizeCondition(undefined), { kind: 'none' })
  assert.throws(() => normalizeCondition({ kind: 'files', exts: ' ' }), /文件类型/)
})

test('有新提交才跑：第一次照常；没新提交跳过；只改了巡检结果或别的类型也跳过；改了 .c 才跑', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'astro-cond-git-'))
  mkdirSync(join(ws, 'src'), { recursive: true })
  writeFileSync(join(ws, 'src', 'a.c'), 'int a;\n')
  await gitm.initRepo(ws, 'init')
  const cond = normalizeCondition({ kind: 'commits', exts: 'c h' })
  const h1 = await head(ws)
  const first = await checkCondition(cond, ws, undefined)
  assert.equal(first.ok, true)
  assert.equal(first.head, h1)
  const same = await checkCondition(cond, ws, h1)
  assert.equal(same.ok, false)
  assert.match(same.reason, /没有新提交/)
  mkdirSync(join(ws, '巡检'), { recursive: true })
  writeFileSync(join(ws, '巡检', 'r.c'), 'x')
  writeFileSync(join(ws, 'README.md'), '说明')
  await commitAll(ws, '提交巡检结果和说明')
  const notCode = await checkCondition(cond, ws, h1)
  assert.equal(notCode.ok, false)
  assert.match(notCode.reason, /巡检/)
  writeFileSync(join(ws, 'src', 'a.c'), 'int a = 1;\n')
  await commitAll(ws, '改代码')
  const code = await checkCondition(cond, ws, h1)
  assert.equal(code.ok, true)
  assert.equal(code.changed, 1)
  // 上次的提交找不到了（改写过历史）：照常跑
  assert.equal((await checkCondition(cond, ws, '0123456789abcdef0123456789abcdef01234567')).ok, true)
  // 不是 Git 仓库：说明原因
  const plain = mkdtempSync(join(tmpdir(), 'astro-cond-plain-'))
  const r = await checkCondition(cond, plain, undefined)
  assert.equal(r.ok, false)
  assert.match(r.reason, /不是 Git 仓库/)
})
