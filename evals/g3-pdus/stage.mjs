#!/usr/bin/env node
// 把 G3 全流程验收（PDUS Ⅲ类更改）的材料按阶段放进示例工程，并打印该阶段要在工作台上发起的任务。
// 材料分阶段放，是为了不让前一环节看到后一环节的答案（例如需求待确认问题的答复）。
//
// 用法：node evals/g3-pdus/stage.mjs <1～7> [--ws <示例工程目录>] [--force]
//       node evals/g3-pdus/stage.mjs list            列出各阶段
//       node evals/g3-pdus/stage.mjs reset --yes     删除示例工程中的 g3-pdus 目录（含智能体的产出），重新开始
// 阶段 4、6 由 make-exec.mjs 按智能体导出的执行记录表生成测试结果。

import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, sampleWorkspace } from '../sample-ws.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true }
const sample = resolve(opt('--ws') || sampleWorkspace().dir)
const force = flag('--force'), yes = flag('--yes')
const dst = join(sample, 'g3-pdus')
const MAT = join(ROOT, 'evals', 'g3-pdus', 'materials')

const STAGES = [
  { n: '1', dir: '1-需求', tasks: [
    ['需求分析（任务模式）', '按 g3-pdus/input 下的任务书、通信协议和硬件接口说明，以 g3-pdus/baseline/XY-7-V1.00 的需求规格说明为基线做适应性更改，写 XY-9 卫星配电单元软件的需求规格说明。软件简称 PDUS，Ⅲ类，B 级，需求标识前缀沿用 PDUS。产出放在 g3-pdus/out/需求。'],
  ] },
  { n: '2', dir: '2-设计', note: '总体已答复需求待确认问题，发布了需求规格说明 V1.1（g3-pdus/released）。', tasks: [
    ['详细设计（任务模式）', '以 g3-pdus/baseline/XY-7-V1.00/doc 下的详细设计说明为基础，按 g3-pdus/released 下的需求规格说明 V1.1 和问题答复单，更新 cmd、ocp、tm 模块的详细设计，出 XY-9 PDUS V1.01 的详细设计说明。产出放在 g3-pdus/out/设计。'],
  ] },
  { n: '3', dir: '3-代码', note: '开发方交来 V1.01 代码（g3-pdus/dev/V1.01），发布的详细设计说明 V1.01 在 g3-pdus/released。下面五个任务分别发起，互不依赖。', tasks: [
    ['代码走查（代码模式）', '对照 g3-pdus/released 下的详细设计说明 V1.01 和需求规格说明 V1.1，走查开发方交来的 g3-pdus/dev/V1.01（本次更改的是 ocp.c、cmd.c、tm.c），目标平台 BM3803，出走查报告。产出放在 g3-pdus/out/走查。'],
    ['静态分析（代码模式）', '对 g3-pdus/dev/V1.01 做静态分析，出 XY-9 卫星配电单元软件（V1.01）静态分析报告。没有部门工具的度量结果。详细设计说明在 g3-pdus/released。产出放在 g3-pdus/out/静态分析。'],
    ['编码 / 追踪表（代码模式）', '生成 g3-pdus/dev/V1.01 的代码与 g3-pdus/released 下详细设计说明 V1.01 的详细设计与代码追踪表，追踪不上的列出来。不要修改代码和设计文档。产出放在 g3-pdus/out/追踪表。'],
    ['单元测试（代码模式）', '对 g3-pdus/dev/V1.01/src/ocp.c 中的 ocp_check 和 ocp_set_threshold 做单元测试。详细设计是 g3-pdus/released 下的详细设计说明 V1.01（4.4.3、4.4.7），B 级软件要求语句、分支、MC/DC 覆盖 100%，目标平台 BM3803，用手写驱动和桩（BSP 函数打桩）。测试代码和报告放在 g3-pdus/out/单元测试。'],
    ['确认测试设计（任务模式）', '按 g3-pdus/released 下的需求规格说明 V1.1，为 XY-9 PDUS V1.01 设计确认测试用例，测试环境为 PDU 软平台和 PDU 电性件，导出执行记录表给测试人员。产出放在 g3-pdus/out/确认测试。'],
  ] },
  { n: '4', dir: null, exec: 'V1.01', note: '测试人员按智能体导出的执行记录表执行了 V1.01 确认测试（由 make-exec.mjs 生成，放在 g3-pdus/exec）。', tasks: [
    ['确认测试报告（任务模式）', '测试人员已执行完 V1.01 确认测试，填好的执行记录表是 g3-pdus/exec/确认测试执行记录表-PDUS-V1.01-已填写.xlsx。导入结果，出 V1.01 确认测试报告。产出放在 g3-pdus/out/确认测试。'],
  ] },
  { n: '5', dir: '5-V1.02', note: '开发方交来 V1.02（g3-pdus/dev/V1.02，修改见其中的问题处理说明）。', tasks: [
    ['回归测试设计（任务模式）', '开发方已交 V1.02（g3-pdus/dev/V1.02，修改内容见其中的问题处理说明）。在 V1.01 确认测试的基础上设计 V1.02 的确认回归测试用例，导出执行记录表。产出放在 g3-pdus/out/确认测试。'],
  ] },
  { n: '6', dir: null, exec: 'V1.02', note: '测试人员执行了 V1.02 回归测试（由 make-exec.mjs 生成）。', tasks: [
    ['回归测试报告（任务模式）', '测试人员已执行完 V1.02 回归测试，填好的执行记录表是 g3-pdus/exec/确认测试执行记录表-PDUS-V1.02-已填写.xlsx。导入结果，出 V1.02 回归测试报告。产出放在 g3-pdus/out/确认测试。'],
  ] },
  { n: '7', dir: '7-数据包', note: '数据包放在 g3-pdus/package。智能体第一次问完问题、你回答之后，再发一句：“单机测试报告上的日期写错了，实际是 2026-08-12。”', tasks: [
    ['研制总结（任务模式）', '写 XY-9 卫星配电单元软件 V1.02 的研制总结报告，Ⅲ类。数据包在 g3-pdus/package，前面各环节的产出在 g3-pdus/out，需求规格说明在 g3-pdus/released。产出放在 g3-pdus/out/研制总结。'],
  ] },
]

const cmd = argv[0]
if (cmd === 'list' || !cmd) {
  for (const s of STAGES) console.log(`${s.n}  ${s.tasks.map((t) => t[0]).join('、')}`)
  if (!cmd) console.log('\n用法：node evals/g3-pdus/stage.mjs <1～7> | list | reset --yes')
  process.exit(0)
}
if (cmd === 'reset') {
  if (!yes) { console.error(`将删除 ${dst}（含智能体的全部产出）。确认后加 --yes。`); process.exit(2) }
  rmSync(dst, { recursive: true, force: true })
  console.log(`已删除 ${dst}`)
  process.exit(0)
}
const st = STAGES.find((s) => s.n === cmd)
if (!st) {
  // 常见的混淆：把评分的环节名传给了 stage.mjs
  const SCORE = ['需求', '设计', '走查', '静态分析', '追踪表', '单元测试', '确认测试', '回归测试', '研制总结']
  if (SCORE.includes(cmd)) console.error(`stage.mjs 只接受阶段号 1～7（放材料、打印任务）。“${cmd}”是评分的环节名，评分请运行：\n  node evals/g3-pdus/score.mjs ${cmd}`)
  else console.error(`没有阶段 ${cmd}。阶段号是 1～7，运行 node evals/g3-pdus/stage.mjs list 查看`)
  process.exit(2)
}
console.log(`示例工程：${sample}`)

// 工作台的任务在“当前工程”中运行。最近打开的不是示例工程时（例如刚用过我的库），智能体会找不到材料
function currentProjectWarning() {
  const pj = join(sample, '..', '..', 'projects.json')
  if (!existsSync(pj)) return
  try {
    const list = (JSON.parse(readFileSync(pj, 'utf8')).projects || []).filter((p) => p.lastOpenedAt)
    const cur = list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
    const norm = (p) => String(p).replace(/[\\/]+/g, '/').toLowerCase().split('/').slice(-3).join('/')  // 只比最后三级，Windows 路径和虚拟机挂载路径都能比
    if (cur && norm(cur.path) !== norm(sample)) console.log(`\n注意：工作台最近打开的工程是“${cur.name}”（${cur.path}），不是示例工程。发起任务前先在工作台左上角把工程切换到“示例工程”，否则智能体在“${cur.name}”里找不到 g3-pdus。`)
  } catch { /* 读不了就不提示 */ }
}

// 后面阶段的材料已经在工作区里（例如提前运行了 stage.mjs 5），会把后面的答案泄露给这一阶段的任务
function laterLeaks(n) {
  const found = []
  for (const s of STAGES.filter((x) => Number(x.n) > Number(n) && x.dir)) {
    const src = join(MAT, s.dir, 'g3-pdus')
    if (!existsSync(src)) continue
    const walk = (d, rel = '') => { for (const e of readdirSync(d, { withFileTypes: true })) { const r = join(rel, e.name); if (e.isDirectory()) walk(join(d, e.name), r); else if (existsSync(join(dst, r)) && !existsSync(join(MAT, st.dir || '', 'g3-pdus', r))) found.push(`${r}（阶段 ${s.n}）`) } }
    walk(src)
  }
  return found
}
const leaks = laterLeaks(st.n)
if (leaks.length) console.log(`\n注意：后面阶段的材料已经在工作区里，会把答案泄露给这一阶段的任务。发起任务前先把它们移出 g3-pdus：\n${leaks.slice(0, 8).map((x) => `  ${x}`).join('\n')}${leaks.length > 8 ? `\n  ……共 ${leaks.length} 个文件` : ''}`)

if (st.dir) {
  const src = join(MAT, st.dir, 'g3-pdus')
  if (!existsSync(src)) { console.error(`找不到材料：${src}`); process.exit(2) }
  const clash = []
  const walk = (d, rel = '') => { for (const n of readdirSync(d, { withFileTypes: true })) { const r = join(rel, n.name); if (n.isDirectory()) walk(join(d, n.name), r); else if (existsSync(join(dst, r)) && !readFileSync(join(dst, r)).equals(readFileSync(join(d, n.name)))) clash.push(r) } }  // 内容一样的不算冲突（重复运行只为看任务描述）
  walk(src)
  if (clash.length && !force) { console.error(`以下文件已存在且和材料不同（被改过？），确认后加 --force 用材料覆盖：\n${clash.join('\n')}`); process.exit(2) }
  cpSync(src, dst, { recursive: true, force: true })
  console.log(`已放入阶段 ${st.n} 的材料 → ${dst}`)
}
if (st.exec) {
  const r = spawnSync(process.execPath, [join(ROOT, 'evals', 'g3-pdus', 'make-exec.mjs'), st.exec, '--ws', dst], { stdio: 'inherit' })
  if (r.status === 2) process.exit(2)
}
if (st.note) console.log(`\n${st.note}`)
currentProjectWarning()
console.log('\n在工作台上发起（先确认工作台当前工程是“示例工程”；每个任务新建一次，技能按括号中的模式选）：')
st.tasks.forEach(([name, text], k) => console.log(`\n${k + 1}. ${name}\n${text}`))
console.log(`\n做完后评分：node evals/g3-pdus/score.mjs <环节>（node evals/g3-pdus/score.mjs list 查看环节名）`)
