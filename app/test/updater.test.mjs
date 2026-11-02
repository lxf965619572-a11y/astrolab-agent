// 软件更新：发布 → 检查 → 准备（只取变了的文件、核对哈希）→ 换文件（失败全部换回）→ runner 进程等旧程序退出后执行并重启
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { applyUpdate, checkUpdate, compareVersions, planUpdate, readManifest, stageUpdate } from '../main/updater.mjs'
import { publish, writePackageManifest } from '../../packaging/release.mjs'
import { UpdateService, updateDirOf } from '../main/update.mjs'

const tmp = (p) => mkdtempSync(join(tmpdir(), `astro-up-${p}-`))
function put(root, files) {
  for (const [rel, text] of Object.entries(files)) { const f = join(root, ...rel.split('/')); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text) }
}
const read = (root, rel) => readFileSync(join(root, ...rel.split('/')), 'utf8')
const quiet = () => {}

/** 两个版本的包、发布到更新位置，装上第一个版本（再加一个清单里没有的文件） */
async function fixture() {
  const v1 = tmp('v1'), v2 = tmp('v2'), share = tmp('share'), install = tmp('install'), stage = tmp('stage')
  put(v1, { 'app/app/package.json': '{"version":"0.1.0"}', 'app/a.txt': 'a1', 'app/sub/b.txt': 'b1', 'tools/same.bin': 'same' })
  put(v2, { 'app/app/package.json': '{"version":"0.2.0"}', 'app/a.txt': 'a2', 'app/c/d.txt': 'd2', 'tools/same.bin': 'same' })
  await writePackageManifest(v1, { commit: 'c1' })
  await writePackageManifest(v2, { commit: 'c2' })
  await publish(v1, share, { notes: '第一版', log: quiet })
  await publish(v2, share, { notes: '修了几个问题', log: quiet })
  cpSync(v1, install, { recursive: true })
  put(install, { 'app/本机加的.txt': 'mine' })
  return { v1, v2, share, install, stage }
}

test('版本号按数字逐段比', () => {
  assert.equal(compareVersions('0.10.0', '0.9.2'), 1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
})

test('发布：同一版本、更旧的版本拒绝；latest.json 指向最新', async () => {
  const f = await fixture()
  const latest = JSON.parse(read(f.share, 'latest.json'))
  assert.equal(latest.version, '0.2.0')
  assert.equal(latest.notes, '修了几个问题')
  await assert.rejects(publish(f.v2, f.share, { log: quiet }), /已经发布过/)
  put(f.v1, { 'app/app/package.json': '{"version":"0.1.5"}' }); await writePackageManifest(f.v1)
  await assert.rejects(publish(f.v1, f.share, { log: quiet }), /不比更新位置上的 0\.2\.0 新/)
})

test('检查、准备、换文件：只换变了的，删掉新版本没有的，清单外的文件不碰', async () => {
  const f = await fixture()
  const cur = readManifest(f.install).version
  const c = await checkUpdate({ updateDir: f.share, current: cur })
  assert.equal(c.available, true)
  assert.equal(c.latest.version, '0.2.0')
  assert.equal((await checkUpdate({ updateDir: f.share, current: '0.2.0' })).available, false)

  const progress = []
  const { dir, plan } = await stageUpdate({ updateDir: f.share, latest: c.latest, installRoot: f.install, stageRoot: f.stage, nodeExe: process.execPath, onProgress: (p) => progress.push(p) })
  assert.deepEqual(plan.changed.sort(), ['app/a.txt', 'app/app/package.json', 'app/c/d.txt'])
  assert.deepEqual(plan.removed, ['app/sub/b.txt'])
  assert.ok(!existsSync(join(dir, 'files', 'tools', 'same.bin')), '没变的文件不复制')
  assert.ok(existsSync(join(dir, 'runner', 'updater.mjs')))
  assert.equal(progress.at(-1).files, 3)
  // 再准备一次直接用已经准备好的
  assert.equal((await stageUpdate({ updateDir: f.share, latest: c.latest, installRoot: f.install, stageRoot: f.stage })).dir, dir)

  const r = await applyUpdate({ stageDir: dir, installRoot: f.install, waitPid: 0 })
  assert.equal(r.ok, true, r.error)
  assert.equal(read(f.install, 'app/a.txt'), 'a2')
  assert.equal(read(f.install, 'app/c/d.txt'), 'd2')
  assert.ok(!existsSync(join(f.install, 'app', 'sub', 'b.txt')))
  assert.equal(read(f.install, 'app/本机加的.txt'), 'mine')
  assert.equal(readManifest(f.install).version, '0.2.0')
  assert.equal(planUpdate(readManifest(f.install), readManifest(f.v2)).changed.length, 0)
})

test('换到一半失败：全部换回去，清单还是旧版本', async () => {
  const f = await fixture()
  const c = await checkUpdate({ updateDir: f.share, current: '0.1.0' })
  const { dir } = await stageUpdate({ updateDir: f.share, latest: c.latest, installRoot: f.install, stageRoot: f.stage })
  const r = await applyUpdate({ stageDir: dir, installRoot: f.install, waitPid: 0, failAt: 2 })
  assert.equal(r.ok, false)
  assert.match(r.error, /测试/)
  assert.equal(read(f.install, 'app/a.txt'), 'a1')
  assert.equal(read(f.install, 'app/sub/b.txt'), 'b1')
  assert.ok(!existsSync(join(f.install, 'app', 'c', 'd.txt')), '新加的文件删掉')
  assert.equal(read(f.install, 'app/app/package.json'), '{"version":"0.1.0"}')
  assert.equal(readManifest(f.install).version, '0.1.0')
})

test('更新位置的文件被改过：准备时校验不通过；清单里的路径跑出目录：拒绝', async () => {
  const f = await fixture()
  put(f.share, { '0.2.0/files/app/a.txt': 'tampered' })
  const c = await checkUpdate({ updateDir: f.share, current: '0.1.0' })
  await assert.rejects(stageUpdate({ updateDir: f.share, latest: c.latest, installRoot: f.install, stageRoot: f.stage }), /校验不通过/)
  const m = JSON.parse(read(f.share, '0.2.0/manifest.json'))
  m.files['../evil.txt'] = { size: 1, sha256: 'x' }
  writeFileSync(join(f.share, '0.2.0', 'manifest.json'), JSON.stringify(m))
  await assert.rejects(stageUpdate({ updateDir: f.share, latest: c.latest, installRoot: f.install, stageRoot: f.stage }), /路径不对/)
  await assert.rejects(checkUpdate({ updateDir: join(f.share, '没有这个目录'), current: '0.1.0' }), /ENOENT/)
})

test('runner：等旧程序退出后换文件，写结果，重新启动软件', { skip: process.platform === 'win32' && '重启脚本用 sh' }, async () => {
  const f = await fixture()
  const c = await checkUpdate({ updateDir: f.share, current: '0.1.0' })
  const { dir } = await stageUpdate({ updateDir: f.share, latest: c.latest, installRoot: f.install, stageRoot: f.stage, nodeExe: process.execPath })
  const old = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 800)'], { stdio: 'ignore' }) // 假装是还没退出的旧程序
  const marker = join(f.stage, 'relaunched')
  const relaunch = join(f.stage, 'relaunch.sh')
  writeFileSync(relaunch, `#!/bin/sh\necho ok > "${marker}"\n`); chmodSync(relaunch, 0o755)
  const resultFile = join(f.stage, 'last-result.json')
  const t0 = Date.now()
  const runner = spawn(join(dir, 'runner', 'node'), [join(dir, 'runner', 'updater.mjs'), 'apply', dir, f.install, String(old.pid), resultFile, relaunch], { stdio: 'ignore' })
  await new Promise((res) => runner.on('exit', res))
  assert.ok(Date.now() - t0 >= 600, '等到旧程序退出才换')
  const r = JSON.parse(readFileSync(resultFile, 'utf8'))
  assert.equal(r.ok, true, r.error)
  assert.equal(read(f.install, 'app/a.txt'), 'a2')
  for (let i = 0; i < 50 && !existsSync(marker); i++) await new Promise((res) => setTimeout(res, 50))
  assert.ok(existsSync(marker), '重新启动了')
  assert.match(readFileSync(join(f.stage, 'update.log'), 'utf8'), /更新完成：0\.1\.0 → 0\.2\.0/)
})

test('更新位置：设置文件优先，其次 config/update.json', () => {
  const d = tmp('cfg'), cfg = join(d, 'update.json')
  writeFileSync(cfg, '\uFEFF{"dir": "\\\\\\\\srv\\\\rel"}')
  assert.equal(updateDirOf({}, cfg), '\\\\srv\\rel')
  assert.equal(updateDirOf({ ASTROLAB_UPDATE_DIR: 'X:\\up' }, cfg), 'X:\\up')
  assert.equal(updateDirOf({}, join(d, 'none.json')), '')
})

test('主进程：任务进行时不更新；先关引擎再交给 runner；下次启动提示结果、清理准备目录', async () => {
  const f = await fixture()
  let busy = true, quit = 0, disposed = 0
  const mk = () => new UpdateService({ installRoot: f.install, stageRoot: f.stage, appVersion: '9.9.9', updateDir: () => f.share, nodeExe: process.execPath, relaunchExe: '', pid: 0,
    isBusy: () => busy, beforeQuit: async () => { disposed++ }, quit: () => { quit++ }, onState: () => {} })
  const svc = mk()
  assert.equal(svc.version, '0.1.0', '装好的版本取安装目录的清单')
  assert.equal(svc.boot(), null, '没有更新过')
  await svc.runStage()
  assert.equal(svc.state().staged.version, '0.2.0')
  await assert.rejects(svc.apply(), /任务还在进行/)
  busy = false
  await svc.apply()
  assert.deepEqual([disposed, quit], [1, 1])
  const rf = join(f.stage, 'last-result.json')
  for (let i = 0; i < 100 && !existsSync(rf); i++) await new Promise((res) => setTimeout(res, 50))
  await new Promise((res) => setTimeout(res, 200)) // runner 写完结果后退出
  const next = mk()
  assert.match(next.boot(), /已更新到 0\.2\.0/)
  assert.equal(next.version, '0.2.0')
  assert.ok(!existsSync(join(f.stage, 'v0.2.0')), '准备目录清理掉')
  assert.equal(next.boot(), null, '只提示一次')
  const none = new UpdateService({ installRoot: f.install, stageRoot: f.stage, appVersion: '0', updateDir: () => '', isBusy: () => false, onState: () => {} })
  assert.equal((await none.runCheck({ quiet: true })).configured, false)
  await assert.rejects(none.runCheck(), /没有配置更新位置/)
})
