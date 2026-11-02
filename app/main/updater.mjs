// 软件更新（需求 FR-INS-03）：从部门配置的更新位置（内网共享文件夹）取新版本，不动用户数据、本机的技能和设置。
//
// 更新位置的布局（打包电脑上用 packaging/release.mjs publish 生成）：
//   <更新位置>\latest.json                  { version, date, notes, dir }  最新版本，dir 是版本文件夹名
//   <更新位置>\<版本>\manifest.json         { version, date, commit, files: { "相对路径": { size, sha256 } } }
//   <更新位置>\<版本>\files\...             这个版本的完整安装目录
// 安装目录根下也有一份 manifest.json（安装包带的），记着装的是哪个版本、每个文件的哈希。
//
// 三步：
//   check  读 latest.json，比版本号
//   stage  比较两份清单，只把变了的文件复制到 <用户数据>\update\<版本>\files，逐个核对 sha256；
//          同时把 node.exe 和本文件复制到 <版本>\runner（安装目录里的 node.exe 自己也可能要换）
//   apply  软件退出后由 runner 执行：等旧进程退出 → 逐个换文件（旧文件先挪到 backup）→ 删掉新版本不再有的文件
//          → 写新清单；任何一步失败就按记录全部换回去。结果写 <用户数据>\update\last-result.json，然后重新启动软件
// 清单里没有的文件（两个版本都没有）不碰。用户数据在 %LOCALAPPDATA%\AstroLab，不在安装目录，本来就不受影响。
//
// 只用 Node 内置模块：apply 时本文件被复制出去单独运行。

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANIFEST = 'manifest.json'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 版本号比较：按点分的数字逐段比（0.10.0 > 0.9.2）；非数字段按字符串比 */
export function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.+-]/), pb = String(b || '0').split(/[.+-]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0'
    const nx = Number(x), ny = Number(y)
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y)
    if (c) return c > 0 ? 1 : -1
  }
  return 0
}

export async function hashFile(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}

/** 列出目录下所有文件（相对路径，分隔符统一为 /） */
async function walk(root, dir = root, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(root, p, out)
    else if (e.isFile()) out.push(relative(root, p).split(sep).join('/'))
  }
  return out
}

/** 给安装目录（或打好的包）生成清单；清单自己不列在里面 */
export async function makeManifest(dir, { version, commit = '', date = new Date().toISOString() } = {}) {
  if (!version) throw new Error('缺少版本号')
  const files = {}
  for (const rel of (await walk(dir)).sort()) {
    if (rel === MANIFEST) continue
    const p = join(dir, ...rel.split('/'))
    files[rel] = { size: (await stat(p)).size, sha256: await hashFile(p) }
  }
  return { version, date, commit, files }
}

export function readManifest(dir) {
  const f = join(dir, MANIFEST)
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) } catch { return null }
}

/** 两份清单的差别：changed = 新增或内容变了的，removed = 旧版本有、新版本没有的。没有旧清单（早期的安装）时全部算新增、不删 */
export function planUpdate(installed, next) {
  const cur = (installed && installed.files) || {}
  const changed = [], removed = []
  let bytes = 0
  for (const [rel, f] of Object.entries(next.files || {})) {
    if (!cur[rel] || cur[rel].sha256 !== f.sha256) { changed.push(rel); bytes += f.size || 0 }
  }
  if (installed) for (const rel of Object.keys(cur)) if (!next.files[rel]) removed.push(rel)
  return { from: installed ? installed.version : null, to: next.version, changed, removed, bytes }
}

/** 相对路径不许跑出目录（清单来自共享文件夹，防止写错或被改坏的清单写到别处） */
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((s) => s === '..' || s === '' || s === '.')) {
    throw new Error(`清单里的路径不对：${rel}`)
  }
  return rel.split('/')
}

/** 带超时读 JSON：共享文件夹连不上时可能卡很久 */
async function readJson(file, ms = 8000) {
  let timer
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`读取超时（${ms / 1000} 秒）：${file}`)), ms) })
  try { return JSON.parse((await Promise.race([readFile(file, 'utf8'), t])).replace(/^﻿/, '')) } finally { clearTimeout(timer) }
}

/** 检查更新：{ current, latest: { version, date, notes, dir }, available } */
export async function checkUpdate({ updateDir, current }) {
  if (!updateDir) throw new Error('没有配置更新位置')
  const latest = await readJson(join(updateDir, 'latest.json'))
  if (!latest || !latest.version) throw new Error('更新位置的 latest.json 里没有版本号')
  return { current, latest: { version: latest.version, date: latest.date || '', notes: latest.notes || '', dir: latest.dir || latest.version }, available: compareVersions(latest.version, current) > 0 }
}

/**
 * 准备更新：只复制变了的文件到 stageRoot/<版本>/files 并核对哈希；写 plan.json、manifest.json；准备 runner。
 * 返回 { dir, plan }。同一版本已经准备好（plan.json 在、文件都核对过）时直接返回。
 */
export async function stageUpdate({ updateDir, latest, installRoot, stageRoot, nodeExe, onProgress = () => {} }) {
  const rel = latest.dir || latest.version
  safeRel(rel)
  const src = join(updateDir, rel)
  const next = await readJson(join(src, MANIFEST), 30000)
  if (next.version !== latest.version) throw new Error(`版本对不上：latest.json 是 ${latest.version}，清单是 ${next.version}`)
  for (const r of Object.keys(next.files || {})) safeRel(r)
  const plan = planUpdate(readManifest(installRoot), next)
  const dir = join(stageRoot, `v${next.version}`)
  const done = join(dir, 'plan.json')
  if (existsSync(done)) {
    try { const p = JSON.parse(readFileSync(done, 'utf8')); if (p.to === plan.to && p.from === plan.from && p.changed.length === plan.changed.length) return { dir, plan: p } } catch { /* 重新准备 */ }
  }
  await rm(dir, { recursive: true, force: true })
  await mkdir(join(dir, 'files'), { recursive: true })
  let copied = 0, n = 0
  for (const r of plan.changed) {
    const parts = safeRel(r)
    const from = join(src, 'files', ...parts), to = join(dir, 'files', ...parts)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
    const h = await hashFile(to)
    if (h !== next.files[r].sha256) throw new Error(`文件校验不通过（复制不完整或更新位置的文件被改过）：${r}`)
    copied += next.files[r].size || 0
    onProgress({ files: ++n, total: plan.changed.length, bytes: copied, totalBytes: plan.bytes, file: r })
  }
  await writeFile(join(dir, MANIFEST), JSON.stringify(next, null, 1))
  // runner：apply 时从这里运行，不依赖安装目录里的任何文件
  await mkdir(join(dir, 'runner'), { recursive: true })
  await copyFile(fileURLToPath(import.meta.url), join(dir, 'runner', 'updater.mjs'))
  if (nodeExe) await copyFile(nodeExe, join(dir, 'runner', process.platform === 'win32' ? 'node.exe' : 'node'))
  await writeFile(done, JSON.stringify({ ...plan, notes: latest.notes || '', stagedAt: new Date().toISOString() }, null, 1))
  return { dir, plan }
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** 挪文件：Windows 上刚退出的进程可能还占着文件，忙就等一会儿再试；跨盘时改成复制再删 */
async function move(from, to, { waitMs = 60000 } = {}) {
  await mkdir(dirname(to), { recursive: true })
  const t0 = Date.now()
  for (;;) {
    try { await rename(from, to); return } catch (e) {
      if (e.code === 'EXDEV') { await copyFile(from, to); await unlink(from); return }
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code) || Date.now() - t0 > waitMs) throw e
      await sleep(500)
    }
  }
}

/**
 * 换文件（runner 里执行，也可以在测试里直接调）。返回 { ok, from, to, error?, changed, removed }。
 * 先等 waitPid 退出；backup 记下每个被换掉的旧文件，失败时倒序换回、删掉新加的文件、恢复旧清单。
 */
export async function applyUpdate({ stageDir, installRoot, waitPid, log = () => {}, waitMs = 60000, failAt } = {}) {
  const plan = JSON.parse(await readFile(join(stageDir, 'plan.json'), 'utf8'))
  const result = { ok: false, from: plan.from, to: plan.to, changed: plan.changed.length, removed: plan.removed.length, at: new Date().toISOString() }
  const t0 = Date.now()
  while (alive(waitPid)) {
    if (Date.now() - t0 > 120000) { result.error = '旧程序两分钟内没有退出，没有更新'; return result }
    await sleep(300)
  }
  const backup = join(stageDir, 'backup')
  await rm(backup, { recursive: true, force: true })
  const journal = [] // { target, saved: 旧文件挪到哪（没有旧文件为 null） }
  const step = async (target, saved, put) => {
    const had = existsSync(target)
    if (had) await move(target, saved, { waitMs })
    journal.push({ target, saved: had ? saved : null })
    if (put) { await mkdir(dirname(target), { recursive: true }); await copyFile(put, target) }
  }
  try {
    let i = 0
    for (const r of plan.changed) {
      const parts = safeRel(r)
      if (failAt === i++) throw new Error(`测试：在第 ${failAt} 个文件处失败`)
      await step(join(installRoot, ...parts), join(backup, 'files', ...parts), join(stageDir, 'files', ...parts))
    }
    for (const r of plan.removed) {
      const parts = safeRel(r)
      if (existsSync(join(installRoot, ...parts))) await step(join(installRoot, ...parts), join(backup, 'files', ...parts), null)
    }
    await step(join(installRoot, MANIFEST), join(backup, MANIFEST), join(stageDir, MANIFEST))
    result.ok = true
    log(`更新完成：${plan.from || '（无清单）'} → ${plan.to}，换了 ${plan.changed.length} 个文件，删了 ${plan.removed.length} 个`)
  } catch (e) {
    result.error = e.message
    log(`更新失败，回退：${e.stack || e.message}`)
    for (const j of journal.reverse()) {
      try {
        if (existsSync(j.target)) await rm(j.target, { force: true })
        if (j.saved) await move(j.saved, j.target, { waitMs })
      } catch (e2) { result.rollbackError = `${j.target}：${e2.message}`; log(`回退出错：${result.rollbackError}`) }
    }
  }
  return result
}

/** runner 入口：node updater.mjs apply <stageDir> <installRoot> <pid> <结果文件> [重启的程序] */
async function cli(argv) {
  const [cmd, stageDir, installRoot, pid, resultFile, relaunch] = argv
  if (cmd !== 'apply') throw new Error('用法：updater.mjs apply <stageDir> <installRoot> <pid> <resultFile> [relaunch]')
  const logFile = join(dirname(resultFile), 'update.log')
  const log = (m) => appendFile(logFile, `${new Date().toISOString()} ${m}\n`).catch(() => {})
  await log(`开始：${stageDir} → ${installRoot}，等进程 ${pid} 退出`)
  const r = await applyUpdate({ stageDir, installRoot, waitPid: Number(pid) || 0, log })
  await writeFile(resultFile, JSON.stringify(r, null, 1))
  // 准备目录（含 backup）由软件下次启动时清理：runner 的 node.exe 正在运行，这里删不掉自己
  if (relaunch && existsSync(relaunch)) {
    spawn(relaunch, [], { detached: true, stdio: 'ignore', cwd: dirname(relaunch) }).unref()
    await log(`重新启动：${relaunch}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli(process.argv.slice(2)).catch(async (e) => { process.stderr.write(`${e.stack || e}\n`); process.exitCode = 1 })
}
