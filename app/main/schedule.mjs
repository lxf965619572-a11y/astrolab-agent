// 定时任务（自动化）：到点在指定工程里发起一个任务，做完照常进审核。做法参照 Claude 的“定时任务”：
//   - 每次运行都是一个全新的任务（不接着上次的对话），所以“要做什么”要写成单独能看懂的一段话
//   - 软件开着（可以缩在托盘里）、电脑醒着才会运行。错过的不管几次只补跑最近一次（7 天内），记录和通知里注明“补跑”
//   - 工程里有任务在进行（你正在用，或别的定时任务）：等它结束再跑，最多等 2 小时；同一个定时任务上次的运行还没做完，这次跳过
//   - 无人值守：智能体不等人回答，按最合理的理解做，把假设写进“待确认”（约定见 task.mjs 的 unattendedNote）
//   - “只跑一次”的做完自己停用；“仅手动”的只在点“立即运行”时跑
//   - 启动条件（schedule-check.mjs）：到点先查有没有事可做（有某类文件、上次之后有新提交），没有就记“无事可做”，不启动智能体
//   - 发起结果三种：{ taskId } 开始了；{ wait } 工程被占用，过会儿再试；{ skip } 无事可做
// 与 Electron 无关：时钟、发起任务、查任务状态都由调用方给，测试里直接驱动。数据在 <数据目录>/schedules.json

import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describeCondition, normalizeCondition } from './schedule-check.mjs'

export const FREQS = ['hourly', 'daily', 'weekdays', 'weekly', 'once', 'manual']
export const FREQ_NAMES = { hourly: '每小时', daily: '每天', weekdays: '工作日', weekly: '每周', once: '只跑一次', manual: '仅手动' }
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** 到点后晚了多久算“错过”（电脑睡着、软件没开）：晚 10 分钟以内照常跑，不算补跑 */
export const LATE_GRACE = 10 * MIN
/** 错过太久就不补了，只记一条“错过” */
export const CATCHUP_MAX = 7 * DAY
/** 工程一直被占用，最多等多久 */
export const MAX_WAIT = 2 * HOUR
const MAX_RUNS = 30
const BUSY = ['starting', 'running', 'asking']

const pad = (n) => String(n).padStart(2, '0')
function parseTime(s, def = '09:00') {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || def).trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  return { h: +m[1], m: +m[2], text: `${pad(m[1])}:${m[2]}` }
}

/** 整理界面送来的触发设置；不合法时抛出说明 */
export function normalizeTrigger(t = {}) {
  const freq = FREQS.includes(t.freq) ? t.freq : null
  if (!freq) throw new Error('请选择运行频率')
  const out = { freq }
  if (freq === 'hourly') {
    const minute = Number(t.minute ?? 0)
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('每小时的第几分钟要在 0～59 之间')
    out.minute = minute
  } else if (freq === 'daily' || freq === 'weekdays' || freq === 'weekly') {
    const tm = parseTime(t.time)
    if (!tm) throw new Error('时间写成 时:分，例如 09:00')
    out.time = tm.text
    if (freq === 'weekly') {
      const days = [...new Set((Array.isArray(t.days) ? t.days : [1]).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort()
      if (!days.length) throw new Error('每周至少选一天')
      out.days = days
    }
  } else if (freq === 'once') {
    const at = typeof t.at === 'number' ? t.at : Date.parse(t.at)
    if (!Number.isFinite(at)) throw new Error('请填写运行的日期和时间')
    out.at = at
  }
  return out
}

/** 下一次运行的时间（本地时间）：严格晚于 after；没有下一次（仅手动、一次已过）返回 null */
export function nextRun(trig, after) {
  switch (trig.freq) {
    case 'hourly': {
      const x = new Date(after)
      x.setMinutes(trig.minute || 0, 0, 0)
      while (x.getTime() <= after) x.setHours(x.getHours() + 1)
      return x.getTime()
    }
    case 'daily': case 'weekdays': case 'weekly': {
      const tm = parseTime(trig.time)
      const ok = (d) => trig.freq === 'daily' || (trig.freq === 'weekdays' ? d >= 1 && d <= 5 : (trig.days || [1]).includes(d))
      const base = new Date(after)
      for (let i = 0; i <= 8; i++) {
        const x = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, tm.h, tm.m, 0, 0)
        if (x.getTime() > after && ok(x.getDay())) return x.getTime()
      }
      return null
    }
    case 'once': return trig.at > after ? trig.at : null
    default: return null
  }
}

/** 触发设置的一句话说明：“工作日 21:00”“每周一、周五 08:30” */
export function describeTrigger(trig) {
  switch (trig.freq) {
    case 'hourly': return `每小时第 ${trig.minute || 0} 分`
    case 'daily': return `每天 ${trig.time}`
    case 'weekdays': return `工作日 ${trig.time}`
    case 'weekly': return `每${(trig.days || [1]).map((d) => DAY_NAMES[d]).join('、')} ${trig.time}`
    case 'once': { const d = new Date(trig.at); return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())} 跑一次` }
    default: return '仅手动运行'
  }
}

export { TEMPLATES } from './schedule-templates.mjs'

const newId = () => `s${randomBytes(4).toString('hex')}`

export class Scheduler extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.file                 schedules.json
   * @param {() => number} [o.now]          时钟（测试用）
   * @param {(s: object, slot: object) => Promise<{taskId: string, projectId: string} | {wait: string}>} o.launch
   *        发起一次运行：成功返回任务 id；工程被占用返回 { wait: 原因 }（过一会儿再试）；出错抛出
   * @param {(projectId: string, taskId: string) => object | null} [o.taskInfo]  查任务记录（状态、标题、结束时间、提交）
   * @param {(...a: any[]) => void} [o.log]
   */
  constructor(o) {
    super()
    this.o = o
    this.now = o.now || Date.now
    this.items = []
    this.ticking = null
    this.timer = null
    try { this.items = JSON.parse(readFileSync(o.file, 'utf8')).schedules || [] } catch { this.items = [] }
  }

  save() {
    mkdirSync(dirname(this.o.file), { recursive: true })
    const tmp = `${this.o.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ schedules: this.items }, null, 1))
    renameSync(tmp, this.o.file)
    this.emit('change')
  }

  get(id) { return this.items.find((s) => s.id === id) || null }
  get enabledCount() { return this.items.filter((s) => s.enabled).length }

  /** 给界面：带上触发说明、运行记录里任务的当前状态 */
  list() {
    const info = this.o.taskInfo || (() => null)
    return this.items.map((s) => ({
      ...s,
      describe: describeTrigger(s.trigger),
      describeCondition: describeCondition(s.condition),
      // 只查最近 10 次的任务状态（每次要读任务记录文件）
      runs: (s.runs || []).map((r, i) => (r.taskId && i < 10 ? { ...r, task: info(r.projectId, r.taskId) } : r)),
    }))
  }

  /** 新建或修改：{ id?, name, prompt, projectId, skills?, mode?, options?, trigger, enabled? } */
  upsert(d) {
    const name = String(d.name || '').trim()
    const prompt = String(d.prompt || '').trim()
    if (!name) throw new Error('请给定时任务起个名字')
    if (!prompt) throw new Error('请写清楚每次运行要做什么')
    if (!d.projectId) throw new Error('请选择在哪个工程里运行')
    const trigger = normalizeTrigger(d.trigger)
    const t = this.now()
    const old = d.id ? this.get(d.id) : null
    if (d.id && !old) throw new Error('这个定时任务已经删除')
    const enabled = d.enabled !== false
    if (trigger.freq === 'once' && enabled && trigger.at <= t) throw new Error('只跑一次的时间要在以后')
    const s = {
      ...(old || { id: newId(), createdAt: t, runs: [] }),
      name: name.slice(0, 60), prompt, projectId: String(d.projectId),
      skills: Array.isArray(d.skills) ? d.skills.map(String).slice(0, 3) : [],
      mode: d.mode === 'code' ? 'code' : 'task',
      options: d.options && typeof d.options === 'object' ? { report: d.options.report === true } : {},
      trigger, enabled, updatedAt: t, pending: null,
      condition: normalizeCondition(d.condition),
    }
    s.nextRunAt = enabled ? nextRun(trigger, t) : null
    // 换了工程：上次运行时的提交是别的仓库的，“有没有新提交”从头算
    if (old && old.projectId !== s.projectId) delete s.lastHead
    if (old) this.items[this.items.indexOf(old)] = s
    else this.items.push(s)
    this.save()
    return s.id
  }

  remove(id) {
    const before = this.items.length
    this.items = this.items.filter((s) => s.id !== id)
    if (this.items.length !== before) this.save()
    return this.items.length !== before
  }

  setEnabled(id, on) {
    const s = this.get(id)
    if (!s) throw new Error('这个定时任务已经删除')
    const t = this.now()
    if (on && s.trigger.freq === 'once' && s.trigger.at <= t) throw new Error('只跑一次的时间已经过了，先编辑改个时间')
    s.enabled = !!on
    s.pending = null
    s.nextRunAt = on ? nextRun(s.trigger, t) : null
    this.save()
  }

  record(s, run) {
    s.runs = [{ id: `r${randomBytes(3).toString('hex')}`, ...run }, ...(s.runs || [])].slice(0, MAX_RUNS)
    s.lastRunAt = run.at
  }

  /** 上一次运行的任务还在做吗（同一个定时任务不叠着跑） */
  previousBusy(s) {
    const last = (s.runs || []).find((r) => r.status === 'started')
    if (!last || !this.o.taskInfo) return false
    const t = this.o.taskInfo(last.projectId, last.taskId)
    return !!(t && BUSY.includes(t.status))
  }

  /** 发起一次运行。slot：{ due 计划时间, catchup 是否补跑, manual 是否手动, since 开始等的时间 } */
  async fire(s, slot) {
    const t = this.now()
    if (!slot.manual && this.previousBusy(s)) {
      s.pending = null
      this.record(s, { at: t, due: slot.due, status: 'skipped', reason: '上一次运行还没做完', catchup: !!slot.catchup })
      this.emit('skipped', { schedule: s, reason: '上一次运行还没做完' })
      return null
    }
    try {
      const r = await this.o.launch(s, slot)
      if (r && r.wait) {
        if (slot.manual) throw new Error(r.wait)
        s.pending = { due: slot.due, catchup: !!slot.catchup, since: slot.since ?? t, reason: r.wait }
        return null
      }
      s.pending = null
      if (r && r.skip) {
        // 无事可做：不启动智能体，只记一条
        const run = { at: t, due: slot.due, status: 'nothing', reason: r.skip, catchup: !!slot.catchup }
        this.record(s, run)
        this.emit('nothing', { schedule: s, run })
        return run
      }
      if (r.head) s.lastHead = r.head
      const run = { at: t, due: slot.due, status: 'started', taskId: r.taskId, projectId: r.projectId, catchup: !!slot.catchup, manual: !!slot.manual, ...(r.head ? { head: r.head } : {}) }
      this.record(s, run)
      this.emit('run', { schedule: s, run })
      return run
    } catch (e) {
      s.pending = null
      let reason = e && e.message ? e.message : String(e)
      // 设置本身的问题（工程不在了、不能用于定时任务）：不是一时的，停用，免得每天到点都失败一次；改好再启用
      if (e && e.config && s.enabled) { s.enabled = false; s.nextRunAt = null; reason += '。已停用，改好后再启用' }
      this.record(s, { at: t, due: slot.due, status: 'failed', reason, catchup: !!slot.catchup, manual: !!slot.manual })
      this.emit('failed', { schedule: s, reason })
      if (slot.manual) throw e
      return null
    } finally {
      this.save()
    }
  }

  /** 立即运行一次（不改下次运行时间）；工程被占用时直接报错，不排队 */
  async runNow(id) {
    const s = this.get(id)
    if (!s) throw new Error('这个定时任务已经删除')
    if (this.previousBusy(s)) throw new Error('这个定时任务上一次的运行还没做完')
    return this.fire(s, { due: this.now(), manual: true })
  }

  /** 检查一遍：到点的发起，排着队的再试。每 30 秒一次，电脑从睡眠醒来时也调用 */
  tick() {
    if (this.ticking) return this.ticking
    // 没有到点的任务时整个检查是同步做完的：标记要在赋值之后再清（.finally 在下一个微任务里执行）
    const p = this.runTick().finally(() => { if (this.ticking === p) this.ticking = null })
    this.ticking = p
    return p
  }

  async runTick() {
    try {
      for (const s of [...this.items]) {
        if (!this.get(s.id)) continue
        const t = this.now()
        // 排队等工程空出来的先处理（“只跑一次”的到点时已经停用，但这次还要跑完；手动停用会清掉排队）
        if (s.pending) {
          if (t - s.pending.since > MAX_WAIT) {
            const reason = `等了 2 小时，工程一直有任务在进行（${s.pending.reason}）`
            this.record(s, { at: t, due: s.pending.due, status: 'skipped', reason, catchup: s.pending.catchup })
            s.pending = null
            this.emit('skipped', { schedule: s, reason })
            this.save()
          } else await this.fire(s, s.pending)
          continue
        }
        if (!s.enabled) continue
        if (s.nextRunAt == null) { s.nextRunAt = nextRun(s.trigger, t); if (s.nextRunAt == null) continue }
        if (s.nextRunAt > t) continue
        const due = s.nextRunAt
        const late = t - due
        // 中间错过的不管几次，都跳到“现在之后”的下一次
        s.nextRunAt = nextRun(s.trigger, t)
        if (s.trigger.freq === 'once') s.enabled = false
        if (late > CATCHUP_MAX) {
          this.record(s, { at: t, due, status: 'missed', reason: '错过超过 7 天，不再补跑' })
          this.save()
          continue
        }
        await this.fire(s, { due, catchup: late > LATE_GRACE, since: t })
      }
    } catch (e) {
      if (this.o.log) this.o.log('schedule tick', e)
    }
  }

  start(intervalMs = 30_000) {
    this.stop()
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
    if (this.timer.unref) this.timer.unref()
    void this.tick()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  /** 下一个要运行的（托盘提示用） */
  upcoming() {
    return this.items.filter((s) => s.enabled && s.nextRunAt).sort((a, b) => a.nextRunAt - b.nextRunAt)[0] || null
  }
}
