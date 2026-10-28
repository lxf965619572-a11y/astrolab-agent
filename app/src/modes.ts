// 两种模式（和 Claude 一样）：
// 任务模式 —— 需求、设计、文档与图这类“出文档”的工作；右边看进度、产出、用到了什么。
// 代码模式 —— 编码、单元测试、代码走查这类“改代码”的工作；右边看环境、上下文和代码改动。
// 每个任务属于发起时所在的模式（侧栏按模式分开列）；老任务按技能类别判断。和 main/task.mjs 的 modeOf 一致。

import type { Task } from './api'

export type Mode = 'task' | 'code'
export const CODE_CATEGORIES = ['编码', '测试', '走查']
export const modeOf = (t: Pick<Task, 'mode' | 'category'> | null | undefined): Mode =>
  t && (t.mode === 'code' || t.mode === 'task') ? t.mode : CODE_CATEGORIES.includes(t?.category || '') ? 'code' : 'task'
export const categoryMode = (category: string): Mode => (CODE_CATEGORIES.includes(category) ? 'code' : 'task')
