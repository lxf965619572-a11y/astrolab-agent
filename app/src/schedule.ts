// 定时任务在界面上用的小工具：触发说明、下次运行（编辑框里预览）、时间格式。
// 算法和 main/schedule.mjs 的 nextRun、describeTrigger 相同（那边是准的，这里只用来预览和模拟实现）。

import type { Freq, Schedule, ScheduleRun, Trigger } from './api'

export const FREQ_NAMES: Record<Freq, string> = { hourly: '每小时', daily: '每天', weekdays: '工作日', weekly: '每周', once: '只跑一次', manual: '仅手动' }
export const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/** 每周的选项按周一到周日排 */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const pad = (n: number) => String(n).padStart(2, '0')

export function describeTrigger(t: Trigger): string {
  switch (t.freq) {
    case 'hourly': return `每小时第 ${t.minute || 0} 分`
    case 'daily': return `每天 ${t.time}`
    case 'weekdays': return `工作日 ${t.time}`
    case 'weekly': return `每${(t.days || [1]).slice().sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)).map((d) => DAY_NAMES[d]).join('、')} ${t.time}`
    case 'once': { if (!t.at) return '只跑一次'; const d = new Date(t.at); return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())} 跑一次` }
    default: return '仅手动运行'
  }
}

export function nextRun(t: Trigger, after: number): number | null {
  if (t.freq === 'hourly') {
    const x = new Date(after)
    x.setMinutes(t.minute || 0, 0, 0)
    while (x.getTime() <= after) x.setHours(x.getHours() + 1)
    return x.getTime()
  }
  if (t.freq === 'daily' || t.freq === 'weekdays' || t.freq === 'weekly') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.time || '')
    if (!m) return null
    const ok = (d: number) => t.freq === 'daily' || (t.freq === 'weekdays' ? d >= 1 && d <= 5 : (t.days || [1]).includes(d))
    const b = new Date(after)
    for (let i = 0; i <= 8; i++) {
      const x = new Date(b.getFullYear(), b.getMonth(), b.getDate() + i, +m[1], +m[2], 0, 0)
      if (x.getTime() > after && ok(x.getDay())) return x.getTime()
    }
    return null
  }
  if (t.freq === 'once') return t.at && t.at > after ? t.at : null
  return null
}

/** “今天 21:00”“明天 08:30”“11月20日 周五 16:30” */
export function whenText(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0)
  const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - day0.getTime()) / 86400000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diff === 0) return `今天 ${hm}`
  if (diff === 1) return `明天 ${hm}`
  if (diff === -1) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${DAY_NAMES[d.getDay()]} ${hm}`
}

/** 一次运行的状态：给运行记录的小标签用 */
export function runState(r: ScheduleRun): { text: string; tone: 'run' | 'ok' | 'ask' | 'err' | 'idle' } {
  if (r.status === 'skipped') return { text: '跳过', tone: 'idle' }
  if (r.status === 'missed') return { text: '错过', tone: 'idle' }
  if (r.status === 'failed') return { text: '没能运行', tone: 'err' }
  const t = r.task
  if (!t) return { text: '记录已删除', tone: 'idle' }
  if (t.commit) return { text: '已提交', tone: 'ok' }
  if (t.restoredAt) return { text: '已恢复', tone: 'idle' }
  switch (t.status) {
    case 'starting': case 'running': return { text: '进行中', tone: 'run' }
    case 'asking': return { text: '等你决定', tone: 'ask' }
    case 'done': return { text: '待审核', tone: 'ask' }
    case 'stopped': return { text: '已停止', tone: 'idle' }
    case 'error': return { text: '出错', tone: 'err' }
    default: return { text: t.status, tone: 'idle' }
  }
}

/** 列表上的一句状态：下次运行、排队中、已停用 */
export function nextText(s: Schedule, now = Date.now()): string {
  if (s.pending) return `排队中：${s.pending.reason}`
  if (!s.enabled) return s.trigger.freq === 'once' && s.runs.length ? '已运行，自动停用' : '已停用'
  if (s.trigger.freq === 'manual') return '只在点“立即运行”时运行'
  return s.nextRunAt ? `下次 ${whenText(s.nextRunAt, now)}` : '没有下次运行'
}
