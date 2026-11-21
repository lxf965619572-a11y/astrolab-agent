// 定时任务到点发起一次运行（调度器的 launch）。从 main.mjs 抽出来，依赖都由调用方给，
// 主进程和端到端验证（test/schedule-e2e.mjs）用的是同一份逻辑。
//
// 返回给调度器的结果：
//   { taskId, projectId, head }  开始了
//   { wait: 原因 }               工程被占用、并行已满、你正对着这个工程：过一会儿再试（最多 2 小时）
//   { skip: 原因, head }          启动条件不满足：无事可做，不启动智能体
//   抛出 config 错误              设置本身的问题（工程不在了、不能用）：调度器记“没能运行”并停用

import { existsSync } from 'node:fs'
import { checkCondition } from './schedule-check.mjs'

/**
 * @param {object} d
 * @param {(id: string) => object | null} d.project            按 id 取工程
 * @param {(s: object) => string | null} d.problem             定时任务设置本身的问题
 * @param {(pid: string) => object | null} d.controllerOf      这个工程已有的任务控制器
 * @param {(c: object) => boolean} [d.isActive]                是不是界面正看着的控制器
 * @param {() => boolean} [d.userPresent]                      人在电脑前
 * @param {(c: object) => void} [d.checkParallel]              并行限制，超了抛出
 * @param {(p: object) => Promise<object>} d.createController  新建控制器并打开工程
 * @param {() => void} [d.onStarted]                           开始后（通知界面刷新）
 * @param {(...a: any[]) => void} [d.log]
 */
export function createLauncher(d) {
  const log = d.log || (() => {})
  return async function launch(s, slot) {
    const problem = d.problem(s)
    if (problem) throw Object.assign(new Error(problem), { config: true })
    const p = d.project(s.projectId)
    if (!existsSync(p.path)) throw new Error(`工程文件夹不存在：${p.path}`)
    let c = d.controllerOf(p.id)
    const active = !!(c && d.isActive && d.isActive(c))
    if (c && c.busy) return { wait: active ? '你正在这个工程里做任务' : `工程里有任务在进行：${c.task ? c.task.title : ''}` }
    // 你正对着这个工程（会把你在看的任务换掉）：等你走开或切到别的工程。手动“立即运行”不等
    if (c && active && c.task && !slot.manual && d.userPresent && d.userPresent()) return { wait: '你正在看这个工程' }
    try { if (d.checkParallel) d.checkParallel(c || { busy: false, project: p }) } catch (e) { return { wait: e.message } }
    // 启动条件：没有要做的事就不启动智能体（手动“立即运行”不查，只记下现在的提交）
    const cond = await checkCondition(slot.manual ? { kind: 'none' } : s.condition, p.path, s.lastHead)
    if (!cond.ok) return { skip: cond.reason, head: cond.head }
    if (!c) c = await d.createController(p)
    log(`定时任务开始：${s.name}（${p.name}）${slot.catchup ? '，补跑' : ''}${slot.manual ? '，手动' : ''}`)
    const task = await c.start({
      prompt: s.prompt, skills: s.skills, mode: s.mode, options: s.options, files: [], title: s.name,
      unattended: true, schedule: { id: s.id, name: s.name, due: slot.due, catchup: !!slot.catchup, manual: !!slot.manual },
    })
    if (d.onStarted) d.onStarted()
    return { taskId: task.id, projectId: p.id, head: cond.head }
  }
}
