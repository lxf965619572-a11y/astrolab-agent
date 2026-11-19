// 定时任务：下次运行时间、错过补跑最近一次、工程被占用时排队、上次没做完就跳过、只跑一次自动停用
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Scheduler, nextRun, normalizeTrigger, describeTrigger, TEMPLATES, LATE_GRACE, MAX_WAIT } from '../main/schedule.mjs'

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const MIN = 60_000
// 2026-11-18 是周三
const WED_7 = at(2026, 11, 18, 7, 0)

test('下次运行时间：每小时、每天、工作日、每周、一次、仅手动', () => {
  assert.equal(nextRun({ freq: 'hourly', minute: 15 }, at(2026, 11, 18, 7, 20)), at(2026, 11, 18, 8, 15))
  assert.equal(nextRun({ freq: 'hourly', minute: 15 }, at(2026, 11, 18, 7, 10)), at(2026, 11, 18, 7, 15))
  assert.equal(nextRun({ freq: 'daily', time: '09:00' }, WED_7), at(2026, 11, 18, 9, 0))
  assert.equal(nextRun({ freq: 'daily', time: '06:00' }, WED_7), at(2026, 11, 19, 6, 0))
  // 周五 22:00 之后的工作日 → 下周一
  assert.equal(nextRun({ freq: 'weekdays', time: '21:00' }, at(2026, 11, 20, 22, 0)), at(2026, 11, 23, 21, 0))
  // 每周一、周五 08:30，从周三出发 → 周五
  assert.equal(nextRun({ freq: 'weekly', days: [1, 5], time: '08:30' }, WED_7), at(2026, 11, 20, 8, 30))
  // 正好在那个时刻：严格晚于，所以是下一次
  assert.equal(nextRun({ freq: 'daily', time: '07:00' }, WED_7), at(2026, 11, 19, 7, 0))
  assert.equal(nextRun({ freq: 'once', at: WED_7 + MIN }, WED_7), WED_7 + MIN)
  assert.equal(nextRun({ freq: 'once', at: WED_7 - MIN }, WED_7), null)
  assert.equal(nextRun({ freq: 'manual' }, WED_7), null)
})

test('触发设置的检查和说明', () => {
  assert.throws(() => normalizeTrigger({ freq: 'daily', time: '25:00' }), /时:分/)
  assert.throws(() => normalizeTrigger({ freq: 'weekly', time: '09:00', days: [] }), /至少选一天/)
  assert.throws(() => normalizeTrigger({ freq: 'x' }), /频率/)
  assert.deepEqual(normalizeTrigger({ freq: 'weekly', time: '8:30', days: [5, 1, 5] }), { freq: 'weekly', time: '08:30', days: [1, 5] })
  assert.equal(describeTrigger({ freq: 'weekly', time: '08:30', days: [1, 5] }), '每周一、周五 08:30')
  assert.equal(describeTrigger({ freq: 'weekdays', time: '21:00' }), '工作日 21:00')
  for (const t of TEMPLATES) assert.doesNotThrow(() => normalizeTrigger(t.trigger), t.name)
})

function rig({ now = WED_7, launch } = {}) {
  const clock = { t: now }
  const tasks = new Map()
  const launched = []
  const file = join(mkdtempSync(join(tmpdir(), 'astro-sched-')), 'schedules.json')
  const sch = new Scheduler({
    file, now: () => clock.t,
    taskInfo: (pid, id) => tasks.get(id) || null,
    launch: launch || (async (s, slot) => {
      const id = `t${launched.length + 1}`
      launched.push({ s: s.id, slot })
      tasks.set(id, { status: 'running' })
      return { taskId: id, projectId: s.projectId }
    }),
  })
  return { clock, tasks, launched, sch, file }
}
const draft = (x = {}) => ({ name: '每晚巡检', prompt: '做一次静态分析', projectId: 'p1', trigger: { freq: 'daily', time: '09:00' }, ...x })

test('到点发起；没到点不动；存到文件里', async () => {
  const { clock, launched, sch, file } = rig()
  const id = sch.upsert(draft())
  assert.equal(sch.get(id).nextRunAt, at(2026, 11, 18, 9, 0))
  await sch.tick()
  assert.equal(launched.length, 0)
  clock.t = at(2026, 11, 18, 9, 0, ) + 20_000
  await sch.tick()
  assert.equal(launched.length, 1)
  assert.equal(launched[0].slot.catchup, false)
  assert.equal(sch.get(id).nextRunAt, at(2026, 11, 19, 9, 0))
  const saved = JSON.parse(readFileSync(file, 'utf8')).schedules[0]
  assert.equal(saved.runs[0].status, 'started')
  assert.equal(saved.runs[0].taskId, 't1')
})

test('电脑睡了三天：只补跑最近一次，标为补跑；超过 7 天只记错过', async () => {
  const { clock, launched, sch } = rig()
  const id = sch.upsert(draft())
  clock.t = at(2026, 11, 21, 14, 0)
  await sch.tick()
  assert.equal(launched.length, 1, '错过 4 次只跑一次')
  assert.equal(launched[0].slot.catchup, true)
  assert.equal(launched[0].slot.due, at(2026, 11, 18, 9, 0))
  assert.equal(sch.get(id).nextRunAt, at(2026, 11, 22, 9, 0))
  await sch.tick()
  assert.equal(launched.length, 1, '同一轮不会再跑')

  const r2 = rig()
  const id2 = r2.sch.upsert(draft())
  r2.clock.t = at(2026, 11, 30, 10, 0)
  await r2.sch.tick()
  assert.equal(r2.launched.length, 0)
  assert.equal(r2.sch.get(id2).runs[0].status, 'missed')
})

test('晚了几分钟（10 分钟内）照常跑，不算补跑', async () => {
  const { clock, launched, sch } = rig()
  sch.upsert(draft())
  clock.t = at(2026, 11, 18, 9, 0) + LATE_GRACE - MIN
  await sch.tick()
  assert.equal(launched[0].slot.catchup, false)
})

test('工程被占用：排队，空出来再跑；一直占用 2 小时就跳过', async () => {
  let busy = true
  const launched = []
  const { clock, sch } = rig({
    launch: async (s, slot) => { if (busy) return { wait: '你正在这个工程里做任务' }; launched.push(slot); return { taskId: 'tX', projectId: 'p1' } },
  })
  const id = sch.upsert(draft())
  clock.t = at(2026, 11, 18, 9, 0)
  await sch.tick()
  assert.equal(launched.length, 0)
  assert.ok(sch.get(id).pending)
  clock.t += 30 * MIN
  busy = false
  await sch.tick()
  assert.equal(launched.length, 1)
  assert.equal(launched[0].due, at(2026, 11, 18, 9, 0))
  assert.equal(sch.get(id).pending, null)

  busy = true
  clock.t = at(2026, 11, 19, 9, 0)
  await sch.tick()
  clock.t += MAX_WAIT + MIN
  await sch.tick()
  assert.equal(sch.get(id).runs[0].status, 'skipped')
  assert.match(sch.get(id).runs[0].reason, /2 小时/)
  assert.equal(sch.get(id).pending, null)
})

test('上一次运行还没做完：这次跳过；立即运行也不叠着跑', async () => {
  const { clock, tasks, launched, sch } = rig({ now: at(2026, 11, 18, 7, 0) })
  const id = sch.upsert(draft({ trigger: { freq: 'hourly', minute: 0 } }))
  clock.t = at(2026, 11, 18, 8, 0)
  await sch.tick()
  assert.equal(launched.length, 1)
  clock.t = at(2026, 11, 18, 9, 0)
  await sch.tick()
  assert.equal(launched.length, 1)
  assert.equal(sch.get(id).runs[0].status, 'skipped')
  await assert.rejects(sch.runNow(id), /还没做完/)
  tasks.get('t1').status = 'done'
  clock.t = at(2026, 11, 18, 10, 0)
  await sch.tick()
  assert.equal(launched.length, 2)
})

test('只跑一次：跑完自己停用；时间已过不能启用', async () => {
  const { clock, launched, sch } = rig()
  const id = sch.upsert(draft({ trigger: { freq: 'once', at: WED_7 + 60 * MIN } }))
  clock.t = WED_7 + 61 * MIN
  await sch.tick()
  assert.equal(launched.length, 1)
  assert.equal(sch.get(id).enabled, false)
  assert.throws(() => sch.setEnabled(id, true), /已经过了/)
  assert.throws(() => sch.upsert(draft({ trigger: { freq: 'once', at: WED_7 - MIN } })), /以后/)
})

test('只跑一次碰上工程被占用：停用了也会在空出来后跑完这一次', async () => {
  let busy = true
  const launched = []
  const { clock, sch } = rig({ launch: async () => (busy ? { wait: '占用' } : (launched.push(1), { taskId: 't', projectId: 'p1' })) })
  const id = sch.upsert(draft({ trigger: { freq: 'once', at: WED_7 + MIN } }))
  clock.t = WED_7 + 2 * MIN
  await sch.tick()
  assert.equal(sch.get(id).enabled, false)
  busy = false
  clock.t += MIN
  await sch.tick()
  assert.equal(launched.length, 1)
})

test('仅手动：不会自己跑，立即运行可以；发起失败记下原因', async () => {
  const { clock, launched, sch } = rig()
  const id = sch.upsert(draft({ trigger: { freq: 'manual' } }))
  clock.t += 30 * 24 * 60 * MIN
  await sch.tick()
  assert.equal(launched.length, 0)
  await sch.runNow(id)
  assert.equal(launched.length, 1)
  assert.equal(sch.list()[0].runs[0].manual, true)

  const r = rig({ launch: async () => { throw new Error('项目文件夹不存在') } })
  const id2 = r.sch.upsert(draft())
  r.clock.t = at(2026, 11, 18, 9, 1)
  await r.sch.tick()
  assert.equal(r.sch.get(id2).runs[0].status, 'failed')
  assert.match(r.sch.get(id2).runs[0].reason, /不存在/)
})

test('停用后不跑，也清掉排队；列表带上任务的当前状态', async () => {
  const { clock, tasks, launched, sch } = rig()
  const id = sch.upsert(draft())
  sch.setEnabled(id, false)
  clock.t = at(2026, 11, 18, 9, 5)
  await sch.tick()
  assert.equal(launched.length, 0)
  sch.setEnabled(id, true)
  await sch.runNow(id)
  tasks.get('t1').status = 'done'
  assert.equal(sch.list()[0].runs[0].task.status, 'done')
  assert.equal(sch.list()[0].describe, '每天 09:00')
})
