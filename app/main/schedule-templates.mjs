// 定时任务的部门模板。不依赖 Node，主进程（schedule.mjs）和界面的模拟实现（src/mock.ts）共用。

/**
 * 部门模板：点一下带到新建框里，改改工程和时间就能用。
 * 提示词写成单独能看懂的一段（每次运行都是新任务）；结果都写在工程的“巡检/”下，不改源代码和设计，便于审核时一眼看完。
 */
export const TEMPLATES = [
  {
    id: 'static-nightly', name: '每晚静态分析巡检', icon: 'shield', mode: 'code', skills: ['static-analysis'],
    trigger: { freq: 'weekdays', time: '21:00' }, condition: { kind: 'commits', exts: ['c', 'h'] },
    summary: '工作日晚上，C 代码有新提交时做静态分析，和上次比，列出新增的问题。',
    prompt: '对本工程的 C 源代码做一次静态分析（Cppcheck、GJB 8114 规则扫描和度量）。结果写到 `巡检/静态分析/<今天的日期>/`：分析记录和问题清单。`巡检/静态分析/` 下有以前的结果时，和最近一次比较，在记录开头单独列出新增的问题和已经消失的问题。不要修改源代码，不用生成 Word。',
  },
  {
    id: 'walkthrough-changes', name: '改动代码走查', icon: 'review', mode: 'code', skills: ['code-walkthrough'],
    trigger: { freq: 'weekdays', time: '20:30' }, condition: { kind: 'commits', exts: ['c', 'h'] },
    summary: '工作日晚上，C 代码有新提交时走查改动的函数；没提交就不启动。',
    prompt: '走查最近一天里改动过的 C 代码：用 git log --since="1 day ago" 和 git diff 找出改过的 .c、.h 文件和改动的函数。有改动就按部门走查检查表和 GJB 8114 规则只走查改动的函数，问题写进 `巡检/走查/<今天的日期>-走查记录.md`，严重等级按Ⅰ～Ⅴ级。不要修改源代码。',
  },
  {
    id: 'weekly-review', name: '每周研制进展', icon: 'history', mode: 'task', skills: [],
    trigger: { freq: 'weekly', days: [5], time: '16:30' }, condition: { kind: 'none' },
    summary: '周五下午汇总这一周工程里的提交、文档和代码变化，写成周报。',
    prompt: '汇总这个工程最近 7 天的研制进展：Git 提交（谁、改了什么）、新增和修改的文档与代码、各环节产物（需求、设计、代码、测试、走查）现在的状态，以及看到的风险和下周可能要做的事。写成 `巡检/周报/<今天的日期>-研制周报.md`，开头用三五句话写摘要。只读工程里的文件，除了周报不改别的文件。',
  },
  {
    id: 'design-code-sync', name: '设计与代码一致性', icon: 'dd', mode: 'task', skills: ['detailed-design'],
    trigger: { freq: 'weekly', days: [1], time: '08:30' }, condition: { kind: 'files', exts: ['c', 'h'] },
    summary: '每周一早上核对详细设计和代码是否一致，列出对不上的地方。',
    prompt: '核对本工程的详细设计说明和代码是否一致：逐个软件单元（函数）比较设计里的接口（名称、参数、返回值）、处理流程和代码实现，列出对不上的地方（设计有代码没有、代码有设计没有、写法不一致），并说明哪边可能是对的。写成 `巡检/设计代码一致性/<今天的日期>.md`。不要改设计和代码。',
  },
]
