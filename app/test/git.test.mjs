// Git 模块测试：快照、改动、差异、恢复、只提交指定文件、撤销提交、防护钩子拦住无标记的提交。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as g from '../main/git.mjs'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'git-hooks', 'reference-transaction')

async function repo() {
  const d = mkdtempSync(join(tmpdir(), 'astro-git-'))
  mkdirSync(join(d, 'src'))
  writeFileSync(join(d, 'src', 'a.c'), 'int a;\n')
  writeFileSync(join(d, 'src', 'b.c'), 'int b;\n')
  writeFileSync(join(d, '.gitignore'), 'build/\n')
  await g.initRepo(d, '初始版本')
  return d
}
const log = (d) => execFileSync('git', ['log', '--format=%s'], { cwd: d, encoding: 'utf8' }).trim().split('\n')

test('快照不动暂存区和分支；改动和差异相对快照计算', async () => {
  const d = await repo()
  writeFileSync(join(d, 'src', 'a.c'), 'int a; /* 用户任务前的改动 */\n')
  execFileSync('git', ['add', 'src/a.c'], { cwd: d })
  const snap = await g.snapshot(d, 't1')
  // 暂存区和分支不变
  assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }), /^M {2}src\/a\.c/m)
  assert.deepEqual(log(d), ['初始版本'])
  assert.ok(execFileSync('git', ['for-each-ref', 'refs/astrolab'], { cwd: d, encoding: 'utf8' }).includes('snapshots/t1'))
  // 智能体的改动
  writeFileSync(join(d, 'src', 'b.c'), 'int b;\nint b2;\n')
  unlinkSync(join(d, 'src', 'a.c'))
  mkdirSync(join(d, 'test'))
  writeFileSync(join(d, 'test', 't.c'), 'void t(void) {}\n')
  mkdirSync(join(d, 'build'))
  writeFileSync(join(d, 'build', 'x.o'), 'obj')
  const ch = await g.changes(d, snap.tree)
  const by = Object.fromEntries(ch.map((c) => [c.path, c]))
  assert.deepEqual(Object.keys(by).sort(), ['src/a.c', 'src/b.c', 'test/t.c'])
  assert.equal(by['src/a.c'].status, 'D')
  assert.equal(by['src/b.c'].status, 'M')
  assert.equal(by['src/b.c'].added, 1)
  assert.equal(by['test/t.c'].status, 'A')
  const v = await g.fileVersions(d, snap.tree, 'src/b.c')
  assert.equal(v.before, 'int b;\n')
  assert.equal(v.after, 'int b;\nint b2;\n')
  const v2 = await g.fileVersions(d, snap.tree, 'test/t.c')
  assert.equal(v2.existedBefore, false)
  // 恢复
  const n = await g.restore(d, snap.tree)
  assert.equal(n, 3)
  assert.equal(readFileSync(join(d, 'src', 'a.c'), 'utf8'), 'int a; /* 用户任务前的改动 */\n')
  assert.equal(readFileSync(join(d, 'src', 'b.c'), 'utf8'), 'int b;\n')
  assert.equal(existsSync(join(d, 'test')), false)
  assert.deepEqual(await g.changes(d, snap.tree), [])
})

test('只提交指定文件；撤销提交保留改动', async () => {
  const d = await repo()
  writeFileSync(join(d, 'src', 'a.c'), 'int a2;\n')
  execFileSync('git', ['add', 'src/a.c'], { cwd: d }) // 用户自己暂存的，不应被带进提交
  const snap = await g.snapshot(d, 't2')
  mkdirSync(join(d, 'test'))
  writeFileSync(join(d, 'test', 't.c'), 'x\n')
  writeFileSync(join(d, 'src', 'b.c'), 'int b3;\n')
  const ch = await g.changes(d, snap.tree)
  assert.deepEqual(ch.map((c) => c.path).sort(), ['src/b.c', 'test/t.c'])
  const sha = await g.commit(d, '单元测试：rt_drv', ch.map((c) => c.path))
  assert.equal(log(d)[0], '单元测试：rt_drv')
  const files = execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: d, encoding: 'utf8' }).trim().split('\n').sort()
  assert.deepEqual(files, ['src/b.c', 'test/t.c'])
  assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }), /^M {2}src\/a\.c/m)
  await g.undoCommit(d, sha)
  assert.deepEqual(log(d), ['初始版本'])
  assert.equal(readFileSync(join(d, 'test', 't.c'), 'utf8'), 'x\n')
})

test('防护钩子：无标记的提交被拦住，界面的提交和快照照常', async () => {
  const d = await repo()
  const r = await g.installGuardHook(d, HOOK)
  assert.equal(r.ok, true)
  assert.equal(r.installed, true)
  assert.equal((await g.installGuardHook(d, HOOK)).installed, false)
  writeFileSync(join(d, 'n.txt'), 'n\n')
  execFileSync('git', ['add', '-A'], { cwd: d })
  const env = { ...process.env }
  delete env.DEPT_UI_GIT
  assert.throws(() => execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'agent'], { cwd: d, env, stdio: 'pipe' }))
  assert.deepEqual(log(d), ['初始版本'])
  const snap = await g.snapshot(d, 't3')
  assert.ok(snap.commit)
  await g.commit(d, '界面提交', ['n.txt'])
  assert.equal(log(d)[0], '界面提交')
})

test('路径越出项目时拒绝', async () => {
  const d = await repo()
  const snap = await g.snapshot(d, 't4')
  await assert.rejects(g.fileVersions(d, snap.tree, '../x'), /越出项目/)
})

test('项目是仓库的子目录：只看项目内的改动，路径相对项目', async () => {
  const d = await repo()
  mkdirSync(join(d, 'proj', 'src'), { recursive: true })
  writeFileSync(join(d, 'proj', 'src', 'x.c'), 'int x;\n')
  execFileSync('git', ['add', '-A'], { cwd: d })
  execFileSync('git', ['commit', '-q', '-m', 'proj'], { cwd: d, env: { ...process.env, DEPT_UI_GIT: '1' } })
  const p = join(d, 'proj')
  const snap = await g.snapshot(p, 't5')
  writeFileSync(join(p, 'src', 'x.c'), 'int x2;\n')
  writeFileSync(join(d, 'src', 'a.c'), 'outside\n') // 项目外的改动不算
  const ch = await g.changes(p, snap.tree)
  assert.deepEqual(ch.map((c) => c.path), ['src/x.c'])
  const v = await g.fileVersions(p, snap.tree, 'src/x.c')
  assert.equal(v.before, 'int x;\n')
  await g.restore(p, snap.tree, ch)
  assert.equal(readFileSync(join(p, 'src', 'x.c'), 'utf8'), 'int x;\n')
})

test('示例工程在另一个仓库目录里时，建成独立仓库', async () => {
  const { ensureSample } = await import('../main/projects.mjs')
  const outer = await repo()
  const src = join(outer, 'sample-src')
  mkdirSync(join(src, 'utest'), { recursive: true })
  writeFileSync(join(src, 'utest', 'a.c'), 'int a;\n')
  const data = join(outer, 'runtime', 'app-data')
  const dir = await ensureSample({ data, sampleSrc: src, root: join(outer, 'not-a-repo') })
  assert.ok(existsSync(join(dir, '.git')))
  assert.equal(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim().replace(/\\/g, '/'), dir.replace(/\\/g, '/'))
  assert.deepEqual(log(outer), ['初始版本'])
})

test('任务描述里提到的文件：按文件名识别，同名的列出全部，不误配', async () => {
  const { findMentions } = await import('../main/projects.mjs')
  const d = await repo()
  for (const f of ['utest/rt1553/src/rt_drv.c', 'utest/rt1553/doc/rt1553-详细设计.md', 'm1/x.c', 'm2/x.c', 'lib/a.c']) {
    mkdirSync(join(d, dirname(f)), { recursive: true })
    writeFileSync(join(d, f), 'x\n')
  }
  const m = await findMentions(d, '为rt_drv.c设计单元测试，依据“rt1553-详细设计.md”；x.c 也看看，data.c 不是 a.c')
  assert.deepEqual(m.map((x) => x.name), ['rt_drv.c', 'rt1553-详细设计.md', 'x.c', 'a.c'])
  assert.deepEqual(m[0].paths, ['utest/rt1553/src/rt_drv.c'])
  assert.equal(m[2].paths.length, 2)
  const none = await findMentions(d, '看看 data.c 和 RT_DRV.cpp')
  assert.deepEqual(none, [])
})
