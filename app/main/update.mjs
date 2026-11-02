// 软件更新的主进程部分：状态（给界面）、检查、准备、重启并更新；启动时读上次更新的结果、清理准备目录。
// 具体怎么比较、复制、换文件在 updater.mjs。

import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { checkUpdate, readManifest, stageUpdate } from './updater.mjs'

/** 更新位置：设置文件（local.env）的 ASTROLAB_UPDATE_DIR 优先，其次 config\update.json 的 dir（部门打包时配好） */
export function updateDirOf(env, configFile) {
  if (env.ASTROLAB_UPDATE_DIR) return env.ASTROLAB_UPDATE_DIR
  try { return (JSON.parse(readFileSync(configFile, 'utf8').replace(/^﻿/, '')).dir || '').trim() } catch { return '' }
}

export class UpdateService {
  /**
   * o: { installRoot（未安装时为 null）, stageRoot, appVersion, updateDir(): string, nodeExe, relaunchExe,
   *      isBusy(): boolean, beforeQuit(): Promise, quit(), onState(state), log(...), pid?（runner 等它退出，默认本进程） }
   */
  constructor(o) {
    this.o = o
    this.check = null // { at, available, latest, error }
    this.staged = null // { version, changed, removed, bytes, dir }
    this.progress = null
    this.working = null // 'check' | 'stage' | 'apply'
    this.last = null
  }

  get version() { return (this.o.installRoot && (readManifest(this.o.installRoot) || {}).version) || this.o.appVersion }

  state() {
    const dir = this.o.updateDir()
    return {
      version: this.version, installed: !!this.o.installRoot, dir, configured: !!dir,
      working: this.working, check: this.check, staged: this.staged && { version: this.staged.version, changed: this.staged.changed, removed: this.staged.removed, bytes: this.staged.bytes, notes: this.staged.notes },
      progress: this.progress, last: this.last,
    }
  }

  emit() { try { this.o.onState(this.state()) } catch { /* 界面还没开 */ } }

  /** 启动时：上次更新的结果（runner 写的）变成一条提醒；清理准备目录（runner 已经退出） */
  boot() {
    const f = join(this.o.stageRoot, 'last-result.json')
    if (!existsSync(f)) return null
    try { this.last = JSON.parse(readFileSync(f, 'utf8')) } catch { this.last = null }
    try { renameSync(f, join(this.o.stageRoot, 'last-result.seen.json')) } catch { /* 下次再提醒也无妨 */ }
    try { for (const d of readdirSync(this.o.stageRoot)) if (/^v/.test(d)) rmSync(join(this.o.stageRoot, d), { recursive: true, force: true }) } catch (e) { this.o.log && this.o.log('update cleanup', e) }
    if (!this.last) return null
    return this.last.ok
      ? `已更新到 ${this.last.to}（换了 ${this.last.changed} 个文件）`
      : `更新到 ${this.last.to} 没有成功，已经换回 ${this.last.from || '原来的版本'}：${this.last.error}${this.last.rollbackError ? `；有文件没换回：${this.last.rollbackError}，请重新安装` : ''}`
  }

  async runCheck({ quiet = false } = {}) {
    const dir = this.o.updateDir()
    if (!dir) { if (quiet) return this.state(); throw new Error('没有配置更新位置：在设置文件 local.env 里填 ASTROLAB_UPDATE_DIR（部门的共享文件夹）') }
    if (this.working) return this.state()
    this.working = 'check'; this.emit()
    try {
      const r = await checkUpdate({ updateDir: dir, current: this.version })
      this.check = { at: Date.now(), available: r.available, latest: r.latest, error: null }
    } catch (e) {
      this.check = { at: Date.now(), available: false, latest: null, error: e.message }
      if (!quiet) { this.working = null; this.emit(); throw new Error(`检查更新失败：${e.message}`) }
    } finally { this.working = null; this.emit() }
    return this.state()
  }

  async runStage() {
    if (!this.o.installRoot) throw new Error('开发环境不用这里更新（用 git pull）')
    if (!this.check || !this.check.available) await this.runCheck()
    if (!this.check.available) return this.state()
    if (this.working) throw new Error('正在检查或准备更新，稍等')
    this.working = 'stage'; this.progress = null; this.emit()
    let last = 0
    try {
      const { dir, plan } = await stageUpdate({
        updateDir: this.o.updateDir(), latest: this.check.latest, installRoot: this.o.installRoot, stageRoot: this.o.stageRoot, nodeExe: this.o.nodeExe,
        onProgress: (p) => { this.progress = p; if (Date.now() - last > 250) { last = Date.now(); this.emit() } },
      })
      this.staged = { version: plan.to, changed: plan.changed.length, removed: plan.removed.length, bytes: plan.bytes, notes: this.check.latest.notes, dir }
    } catch (e) { throw new Error(`准备更新失败：${e.message}`) } finally { this.working = null; this.progress = null; this.emit() }
    return this.state()
  }

  /** 重启并更新：没有任务在跑时才行。先关引擎，再启动 runner（它等本进程退出），然后退出 */
  async apply() {
    if (!this.staged) throw new Error('还没有准备好更新')
    if (this.o.isBusy()) throw new Error('任务还在进行，结束或停止后再更新')
    const dir = this.staged.dir
    const runnerNode = join(dir, 'runner', process.platform === 'win32' ? 'node.exe' : 'node')
    const node = existsSync(runnerNode) ? runnerNode : this.o.nodeExe
    this.working = 'apply'; this.emit()
    await this.o.beforeQuit()
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(node, [join(dir, 'runner', 'updater.mjs'), 'apply', dir, this.o.installRoot, String(this.o.pid ?? process.pid), join(this.o.stageRoot, 'last-result.json'), this.o.relaunchExe || ''],
      { detached: true, stdio: 'ignore', windowsHide: true, cwd: join(dir, 'runner'), env })
    child.unref()
    this.o.log && this.o.log('update apply', { version: this.staged.version, runner: child.pid })
    this.o.quit()
    return true
  }
}
