#!/usr/bin/env node
// 定时任务端到端验证：真的调度器（schedule.mjs）+ 同一份发起逻辑（schedule-launch.mjs）+ 启动条件（schedule-check.mjs）
// + 任务控制器（task.mjs）+ 引擎层和引擎桥，临时 Git 仓库当工程；只有模型换成模拟引擎（engine/mock-dsh.mjs，不花模型调用），
// 时钟可以拨（模拟“软件没开”“电脑睡眠”跨过运行时间）。
// 覆盖不了的是 Electron 外壳：托盘、系统通知、powerSaveBlocker、powerMonitor 的唤醒事件、开机自启——要在真机桌面上看。
//
// 用法：node app/test/schedule-e2e.mjs [记录文件.md]
//   每一步打印“期望 / 实际 / 结论”，最后写一份 Markdown 验证记录（默认 app/test/定时任务验证记录-<日期>.md）。退出码：有失败为 1。

import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, hostname, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineBridge } from '../engine/engine.mjs'
import { TaskController } from '../main/task.mjs'
import { Scheduler } from '../main/schedule.mjs'
import { createLauncher } from '../main/schedule-launch.mjs'
import * as git from '../main/git.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOCK = join(HERE, '..', 'engine', 'mock-dsh.mjs')
const pad = (n) => String(n).padStart(2, '0')
const fmt = (t) => { const d = new Date(t); return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
const today = (() => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` })()
const OUT = process.argv[2] || join(HERE, `定时任务验证记录-${today}.md`)

// ---------- 记录 ----------
const md = []
const results = []
let cur = null
const log = (s) => { console.log(s); if (cur) cur.lines.push(s) }
function scenario(id, title, why) { cur = { id, title, why, lines: [], checks: [] }; results.push(cur); console.log(`\n=== ${id} ${title}`) }
function check(what, ok, actual) {
  cur.checks.push({ what, ok: !!ok, actual: String(actual ?? '') })
  console.log(`  ${ok ? '通过' : '失败'}  ${what}${actual !== undefined ? ` —— 实际：${actual}` : ''}`)
}
const until = (f, ms = 15000) => new Promise((res, rej) => {
  const t0 = Date.now()
  const tick = setInterval(() => { if (f()) { clearInterval(tick); res() } else if (Date.now() - t0 > ms) { clearInterval(tick); rej(new Error('等待超时')) } }, 25)
})

// ---------- 环境：工程（Git 仓库）、数据目录、引擎桥、任务控制器 ----------
const ws = mkdtempSync(join(tmpdir(), 'astro-e2e-proj-'))
mkdirSync(join(ws, 'src'), { recursive: true })
mkdirSync(join(ws, 'utest', 'rt1553', 'src'), { recursive: true })
writeFileSync(join(ws, 'src', 'ocp.c'), 'int ocp_check(void) { return 0; }\n')
writeFileSync(join(ws, 'utest', 'rt1553', 'src', 'rt_drv.c'), 'int rt_reset(int t) { return 0; }\n')
await git.initRepo(ws, '示例工程初始版本')
// 只提交给出的文件（智能体在工作区写的东西不跟着提交，和人审核时只提交自己挑的一样）
const commit = async (msg, paths) => { await git.git(ws, ['add', '--', ...paths]); await git.git(ws, ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', 'commit', '-qm', msg]) }
const data = mkdtempSync(join(tmpdir(), 'astro-e2e-data-'))
const project = { id: 'p1', name: '示例工程（验证用副本）', path: ws, sample: true }
let projectGone = false

const bridge = new EngineBridge()
await bridge.listen()
const notes = []
const ctl = new TaskController({
  bridge, dataDir: data, logDir: join(data, 'logs'), warm: false,
  makeEngine: () => new Engine({ dshBin: MOCK, nodePath: process.execPath, cwd: ws, provider: 'mock', model: 'mock', env: { ...process.env, MOCK_DSH_SPEED: '0.02', ASTROLAB_BRIDGE: bridge.path } }),
})
ctl.on('notify', (n) => notes.push(n))
await ctl.setProject(project)
let created = 0
const launch = createLauncher({
  project: (id) => (id === project.id && !projectGone ? project : null),
  problem: (s) => (s.projectId !== project.id || projectGone ? '工程已经不在列表里，请编辑这个定时任务换一个工程' : null),
  controllerOf: () => ctl,
  isActive: () => false,
  createController: async () => { created++; return ctl },
  log: (s) => log(`  [发起] ${s}`),
})
const taskInfo = (pid, id) => {
  const t = ctl.task && ctl.task.id === id ? ctl.task : (() => { try { return JSON.parse(readFileSync(join(data, 'projects', pid, 'tasks', `${id}.json`), 'utf8')).task } catch { return null } })()
  return t ? { status: t.status, outcome: t.outcome || null, stopReason: t.stopReason || null, files: t.changeStat ? t.changeStat.files : null } : null
}

// 可以拨的时钟：从“今天 20:00”开始
const BASE = new Date(new Date().setHours(20, 0, 0, 0))
const clock = { t: BASE.getTime() }
const MIN = 60_000
const schedFile = join(data, 'schedules.json')
const makeScheduler = () => new Scheduler({ file: schedFile, now: () => clock.t, launch, taskInfo })
let sch = makeScheduler()
const lastRun = (id) => sch.get(id).runs[0]
const taskDone = () => until(() => ctl.task && ['done', 'stopped', 'error'].includes(ctl.status) && (!ctl.task.unattended || ctl.task.outcome || ctl.status !== 'done'))
/** 第 day 天（从开始那天算起）的 h:m */
const at = (h, m, day = 0) => new Date(BASE.getFullYear(), BASE.getMonth(), BASE.getDate() + day, h, m, 0, 0).getTime()

md.push(`# 定时任务端到端验证记录（${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}）`, '',
  `由 \`node app/test/schedule-e2e.mjs\` 生成，可以重跑。运行环境：${platform()}，Node ${process.version}，主机 ${hostname()}。`, '',
  '**测的是什么**：真的调度器、到点发起逻辑（和主进程同一份 `schedule-launch.mjs`）、启动条件、任务控制器、引擎层和引擎桥，临时 Git 仓库当工程；只有模型换成模拟引擎（不花模型调用），时钟可以拨，用来模拟“软件没开”“电脑睡眠”跨过运行时间。',
  '', '**测不了的**（Electron 外壳，要在解锁的桌面上看）：托盘常驻和菜单、系统通知、运行期间阻止睡眠、睡眠唤醒事件（powerMonitor）本身、开机自启。', '')

try {
  // ---------- S1 准点触发 ----------
  scenario('S1', '准点触发', '每天 20:30 的定时任务，到点后发起一个无人值守的新任务，做完分出“待审核”')
  const id1 = sch.upsert({ name: '每晚巡检（验证）', prompt: '对本工程做一次巡检，结果写到 巡检/ 下。', projectId: 'p1', trigger: { freq: 'daily', time: '20:30' }, condition: { kind: 'commits', exts: ['c', 'h'] } })
  log(`  时钟 ${fmt(clock.t)}，新建定时任务，下次运行 ${fmt(sch.get(id1).nextRunAt)}`)
  await sch.tick()
  check('没到点不运行', sch.get(id1).runs.length === 0, `${sch.get(id1).runs.length} 条运行记录`)
  clock.t = at(20, 30) + 15_000
  log(`  拨到 ${fmt(clock.t)}（晚 15 秒），检查一次`)
  await sch.tick()
  check('到点发起一次', lastRun(id1) && lastRun(id1).status === 'started', lastRun(id1) && lastRun(id1).status)
  check('不算补跑', lastRun(id1) && lastRun(id1).catchup === false, lastRun(id1) && lastRun(id1).catchup)
  check('第一条消息带无人值守约定、没有“提问”的约定', /【无人值守】/.test(ctl.task.firstMessage) && !/需要我拍板时用 ask_user_question 提问/.test(ctl.task.firstMessage), ctl.task.firstMessage.match(/【无人值守】[^\n]*/)[0].slice(0, 60))
  await taskDone()
  check('做完：改了文件 → 待审核', ctl.task.outcome === 'review', `${ctl.task.outcome}，改了 ${ctl.task.changeStat && ctl.task.changeStat.files} 个文件`)
  check('通知是“改了 N 个文件，等你审核”', notes.some((n) => /改了 \d+ 个文件，等你审核/.test(n.title)), notes.map((n) => n.title).at(-1))
  check('记下这次的 HEAD，下次比较“有没有新提交”', !!sch.get(id1).lastHead, (sch.get(id1).lastHead || '').slice(0, 8))
  check('下次运行排到明天 20:30', sch.get(id1).nextRunAt === at(20, 30, 1), fmt(sch.get(id1).nextRunAt))
  check('智能体没有提交（Git 里 HEAD 没变）', (await git.git(ws, ['rev-parse', 'HEAD'])).trim() === sch.get(id1).lastHead, '')

  // ---------- S2 启动条件：没有新提交 → 无事可做 ----------
  scenario('S2', '启动条件：没有新提交就不启动智能体', '“有新提交改了 .c .h 才跑”；只提交巡检结果或文档不算')
  const tasksBefore = ctl.task.id
  clock.t = at(20, 30, 1) + 10_000
  log(`  拨到 ${fmt(clock.t)}，期间没有提交`)
  await sch.tick()
  check('记“无事可做”', lastRun(id1).status === 'nothing', `${lastRun(id1).status}：${lastRun(id1).reason}`)
  check('没有启动智能体（没有新任务）', ctl.task.id === tasksBefore, '')
  mkdirSync(join(ws, '巡检', '静态分析'), { recursive: true })
  writeFileSync(join(ws, '巡检', '静态分析', 'r.c'), '/* 巡检结果里的代码片段 */\n')
  writeFileSync(join(ws, '说明.md'), '说明\n')
  await commit('人审核后提交巡检结果和说明', ['巡检', '说明.md'])
  log('  提交了 巡检/ 下的结果（含一个 .c 片段）和一份说明文档')
  clock.t = at(20, 30, 2) + 10_000
  log(`  拨到 ${fmt(clock.t)}`)
  await sch.tick()
  check('只改了巡检结果和文档：仍是无事可做', lastRun(id1).status === 'nothing', lastRun(id1).reason)
  writeFileSync(join(ws, 'src', 'ocp.c'), 'int ocp_check(void) { return 1; }\n')
  await commit('改 ocp.c', ['src/ocp.c'])
  log('  提交了 src/ocp.c 的改动')
  clock.t = at(20, 30, 3) + 10_000
  log(`  拨到 ${fmt(clock.t)}`)
  await sch.tick()
  check('改了 .c：照常运行', lastRun(id1).status === 'started', lastRun(id1).status)
  await taskDone()

  // ---------- S3 软件没开：错过后补跑最近一次 ----------
  scenario('S3', '软件没开时错过，下次打开补跑最近一次', '关掉工作台，跨过 3 次运行时间；重新打开（新的调度器实例读同一个 schedules.json）')
  const missedFrom = sch.get(id1).nextRunAt
  log(`  关闭工作台（调度器停用）时下次运行是 ${fmt(missedFrom)}`)
  writeFileSync(join(ws, 'src', 'ocp.c'), 'int ocp_check(void) { return 2; }\n')
  await commit('关着的时候又改了代码', ['src/ocp.c'])
  clock.t = at(9, 5, 7) // 错过第 4、5、6 天的 20:30，第 7 天早上打开
  sch = makeScheduler()
  log(`  ${fmt(clock.t)} 重新打开工作台，检查一次`)
  await sch.tick()
  const r3 = lastRun(id1)
  check('只补跑一次', sch.get(id1).runs.filter((r) => r.at === clock.t).length === 1, `${sch.get(id1).runs.filter((r) => r.at === clock.t).length} 次`)
  check('标为补跑，计划时间是最早错过的那次', r3.catchup === true && r3.due === missedFrom, `catchup=${r3.catchup}，计划 ${fmt(r3.due)}`)
  check('第一条消息说明是补跑', /补跑/.test(ctl.task.firstMessage), ctl.task.firstMessage.match(/这是补跑[^）]*/)?.[0])
  check('下次运行跳到当天 20:30（中间错过的不再补）', sch.get(id1).nextRunAt === at(20, 30, 7), fmt(sch.get(id1).nextRunAt))
  await taskDone()

  // ---------- S4 电脑睡眠：醒来补跑 ----------
  scenario('S4', '电脑睡眠跨过运行时间，醒来补跑', '同一个调度器实例，时钟一下跳过 20:30（睡眠期间不检查）；醒来时主进程收到唤醒事件马上检查一次——这里直接检查')
  writeFileSync(join(ws, 'src', 'ocp.c'), 'int ocp_check(void) { return 3; }\n')
  await commit('白天又改了代码', ['src/ocp.c'])
  clock.t = at(19, 50, 7)
  await sch.tick()
  log(`  ${fmt(clock.t)} 检查一次，没到点；然后电脑睡眠`)
  clock.t = at(23, 40, 7)
  log(`  ${fmt(clock.t)} 醒来（晚了 3 小时 10 分），检查一次`)
  await sch.tick()
  check('醒来后补跑', lastRun(id1).status === 'started' && lastRun(id1).catchup === true, `${lastRun(id1).status}，catchup=${lastRun(id1).catchup}`)
  await taskDone()
  clock.t = at(20, 38, 8)
  writeFileSync(join(ws, 'src', 'ocp.c'), 'int ocp_check(void) { return 4; }\n')
  await commit('改代码', ['src/ocp.c'])
  await sch.tick()
  check('晚 8 分钟（10 分钟内）：照常运行，不算补跑', lastRun(id1).status === 'started' && lastRun(id1).catchup === false, `catchup=${lastRun(id1).catchup}`)
  await taskDone()

  // ---------- S5 工程被占用：排队 ----------
  scenario('S5', '工程里有任务在进行：排队，做完再跑', '你在这个工程里做一个长任务时到点')
  const id5 = sch.upsert({ name: '周报（验证）', prompt: '写本周研制进展，结果写到 巡检/ 下。', projectId: 'p1', trigger: { freq: 'hourly', minute: 0 } })
  await ctl.start({ prompt: '[slow] 你自己在做的任务' })
  await until(() => ctl.status === 'running')
  clock.t = at(21, 0, 8) + 5_000
  log(`  ${fmt(clock.t)} 到点，你的任务还在做`)
  await sch.tick()
  check('排队，没有打断你的任务', !!sch.get(id5).pending && !ctl.task.unattended, sch.get(id5).pending && sch.get(id5).pending.reason)
  await ctl.stop()
  log('  你的任务做完（这里用停止代替）')
  clock.t += MIN
  await sch.tick()
  check('一分钟后再检查：开始运行', lastRun(id5).status === 'started' && ctl.task.unattended === true, lastRun(id5).status)
  await taskDone()
  sch.setEnabled(id5, false)

  // ---------- S6 无人值守时智能体提问 ----------
  scenario('S6', '无人值守时智能体还是提了问：自动回答，不卡住', '模拟引擎的 [ask] 剧本会用 ask_user_question 问两个问题')
  const id6 = sch.upsert({ name: '提问（验证）', prompt: '[ask] 做一次检查', projectId: 'p1', trigger: { freq: 'manual' } })
  const asks = notes.filter((n) => n.kind === 'ask').length
  await sch.runNow(id6)
  await taskDone()
  check('做完了，没有停在等回答', ctl.status === 'done', ctl.status)
  check('智能体收到的是“按最合理的做法继续”', /无人值守/.test(ctl.snapshotState().summary.lastAssistantText), ctl.snapshotState().summary.lastAssistantText.slice(0, 60))
  check('没有弹“需要你决定”', notes.filter((n) => n.kind === 'ask').length === asks, '')

  // ---------- S7 越界即停 ----------
  scenario('S7', '无人值守时想读工作区外的文件：第一次被拦就停止', '模拟引擎的 [fence] 剧本：读工作区外的文件被读取围栏拦下，然后接着找')
  const id7 = sch.upsert({ name: '越界（验证）', prompt: '[fence] 做一次检查', projectId: 'p1', trigger: { freq: 'manual' } })
  await sch.runNow(id7)
  await until(() => ['stopped', 'done', 'error'].includes(ctl.status))
  const globs = ctl.items().filter((i) => i.kind === 'tools').flatMap((i) => i.calls).filter((c) => c.name === 'glob').length
  check('任务停止，原因记为越界', ctl.status === 'stopped' && ctl.task.stopReason === 'fence', `${ctl.status}，${ctl.task.stopReason}`)
  check('没有接着在别处找完（剧本里还有 6 次查找）', globs < 6, `找了 ${globs} 次`)
  check('通知“越界，已停止”', notes.some((n) => /越界，已停止/.test(n.title)), '')
  check('运行记录显示越界停止', taskInfo('p1', lastRun(id7).taskId).stopReason === 'fence', '')

  // ---------- S8 设置本身有问题 ----------
  scenario('S8', '工程不在了：记“没能运行”并自动停用，不再每天失败', '工程从列表里移出后到点')
  projectGone = true
  clock.t = sch.get(id1).nextRunAt + 5_000
  await sch.tick()
  check('记没能运行，原因写清楚', lastRun(id1).status === 'failed' && /换一个工程/.test(lastRun(id1).reason), lastRun(id1).reason)
  check('自动停用', sch.get(id1).enabled === false, '')
  clock.t += 24 * 60 * MIN
  const n8 = sch.get(id1).runs.length
  await sch.tick()
  check('第二天不再失败', sch.get(id1).runs.length === n8, '')
  projectGone = false

  // ---------- S9 错过超过 7 天 ----------
  scenario('S9', '错过超过 7 天：只记“错过”，不补跑', '出差两周没开电脑')
  sch.setEnabled(id1, true)
  const due9 = sch.get(id1).nextRunAt
  clock.t = due9 + 14 * 24 * 60 * MIN
  sch = makeScheduler()
  const before9 = ctl.task.id
  await sch.tick()
  check('记错过', lastRun(id1).status === 'missed', `${lastRun(id1).status}：${lastRun(id1).reason}`)
  check('没有启动智能体', ctl.task.id === before9, '')

  // ---------- 落盘的样子 ----------
  scenario('S10', '存下来的数据', 'schedules.json 和任务记录')
  const saved = JSON.parse(readFileSync(schedFile, 'utf8')).schedules.find((x) => x.id === id1)
  log('  schedules.json 里“每晚巡检（验证）”最近的运行记录：')
  for (const r of saved.runs.slice(0, 10)) log(`    ${fmt(r.at)}  ${r.status}${r.catchup ? '（补跑）' : ''}${r.manual ? '（手动）' : ''}${r.reason ? `  ${r.reason}` : ''}${r.taskId ? `  ${r.taskId}` : ''}`)
  const recs = readdirSync(join(data, 'projects', 'p1', 'tasks')).length
  check('每次运行都有任务记录', recs >= 7, `${recs} 份`)
} catch (e) {
  check(`执行出错：${e.message}`, false, e.stack && e.stack.split('\n')[1])
} finally {
  await ctl.dispose().catch(() => {})
  await bridge.close().catch(() => {})
}

// ---------- 写记录 ----------
const all = results.flatMap((r) => r.checks)
const failed = all.filter((c) => !c.ok)
md.push(`## 结果：${all.length - failed.length} / ${all.length} 项通过${failed.length ? `，${failed.length} 项失败` : ''}`, '',
  '| 场景 | 内容 | 结果 |', '|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.title} | ${r.checks.every((c) => c.ok) ? '通过' : '**失败**'}（${r.checks.filter((c) => c.ok).length}/${r.checks.length}） |`), '')
for (const r of results) {
  md.push(`## ${r.id} ${r.title}`, '', r.why, '', '过程：', '', '```text', ...r.lines.map((l) => l.replace(/^ {2}/, '')), '```', '',
    '| 检查 | 结论 | 实际 |', '|---|---|---|', ...r.checks.map((c) => `| ${c.what} | ${c.ok ? '通过' : '**失败**'} | ${c.actual.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`), '')
}
md.push('## 还要在真机桌面上看的', '',
  '| 项目 | 怎么看 | 状态 |', '|---|---|---|',
  '| 关窗口缩到托盘 | 有启用的定时任务时点窗口的关闭，托盘出现图标，任务照常运行 | 用户 11-21 确认 |',
  '| 托盘菜单 | 右键托盘：打开、定时任务、下一个：…、退出 | 待看 |',
  '| 真实的睡眠唤醒 | 睡眠跨过运行时间 10 分钟以上，唤醒后几秒内开始运行，标“补跑”；日志 main.log 有“系统唤醒” | 待看（调度部分见 S4） |',
  '| 运行期间不让系统睡 | main.log 有“阻止系统睡眠 / 允许系统睡眠” | 11-19、11-21 两次手动运行日志里都有 |',
  '| 准点触发（真实时间） | main.log：11-19、11-20 两天 02:30 准时触发（当时因挂在“我的库”上被拦） | 已见到 |',
  '| 系统通知点开到那次任务 | 窗口不在前台时做完，点通知 | 待看 |',
  '| 开机自启（--hidden） | 安装版打开开关后重启电脑，只在托盘里启动 | 待安装包 |', '')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, md.join('\n'))
console.log(`\n${all.length - failed.length} / ${all.length} 项通过。记录：${OUT}`)
process.exit(failed.length ? 1 : 0)
