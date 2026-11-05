#!/usr/bin/env node
// 静态分析记录（和报告）检查：告警是否逐条甄别、超标模块是否逐个分析、统计是否一致、报告是否与记录一致。
// 只读。“必须处理”项要改正；“复核”项逐条判断。
//
// 用法：node check-sa.mjs <静态分析记录.md> [--metrics <json|csv>] [--scan <gjb-scan.json>] [--cppcheck <.cppcheck/last-run.json>] [--report <报告.md>]
//   不给的路径取记录第 1 节对应字段。
// 退出码：0 = 没有“必须处理”项；1 = 有；2 = 用法或文件错误

import { existsSync, readFileSync } from 'node:fs'
import { readRecord, readMetrics, locate, overLimits, LIMIT, blank } from './sa-data.mjs'
import { readText, sections } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
let metP = opt('--metrics'), scanP = opt('--scan'), ckP = opt('--cppcheck')
const repP = opt('--report')
if (argv.length !== 1) { console.error('用法：node check-sa.mjs <静态分析记录.md> [--metrics <json|csv>] [--scan <json>] [--cppcheck <json>] [--report <报告.md>]'); process.exit(2) }
const recP = argv[0]
if (!existsSync(recP)) { console.error(`找不到：${recP}`); process.exit(2) }

const out = []
const must = (id, msg) => out.push({ level: '必须处理', id, msg })
const review = (id, msg) => out.push({ level: '复核', id, msg })
const R = readRecord(recP)
metP = metP || locate(recP, R.info['度量结果'])
scanP = scanP || locate(recP, R.info['规则扫描结果'])
ckP = ckP || locate(recP, R.info['Cppcheck 运行记录'] || R.info['Cppcheck运行记录'])
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { console.error(`读不了 ${p}：${e.message}`); process.exit(2) } }
let M = null
if (metP) { try { M = readMetrics(metP) } catch (e) { must('S0', `读不了度量数据 ${metP}：${e.message}`) } } else must('S0', '没有度量数据：第 1 节写明“度量结果”的路径或加 --metrics')
const scan = scanP ? json(scanP) : null
const ck = ckP ? json(ckP) : null
if (!scanP) review('S0', '没有规则扫描结果（gjb-scan.mjs --json），无法核对 GS 告警是否逐条甄别')
if (!ckP) review('S0', '没有 Cppcheck 运行记录，无法核对 CK 告警是否逐条甄别')

// S1 章节和概述
for (const [n, t] of [['1', '概述'], ['2', '分析工具'], ['3', '度量超标分析'], ['4', '规则违反甄别'], ['5', '代码审查'], ['6', '待确认问题'], ['7', '统计']]) {
  if (!R.S.some((s) => s.num === n && s.title.includes(t.slice(0, 2)))) must('S1', `缺少章节“${n} ${t}”（照抄 references/sa-format.md）`)
}
for (const k of ['软件名称', '软件版本', '安全关键等级', '测试版本', '分析时间', '度量数据来源']) if (blank(R.info[k])) review('S1', `第 1 节缺“${k}”（不知道的写“【待补充】”）`)
if (M && M.source === 'tool' && /metrics\.mjs/.test(R.info['度量数据来源'] || '')) must('S1', '度量结果是 CSV（部门工具），但“度量数据来源”写的是 metrics.mjs')
if (M && M.source === 'script' && /TESTBED|SpecChecker|部门工具/i.test(R.info['度量数据来源'] || '')) must('S1', '度量结果是 metrics.mjs 的 JSON，但“度量数据来源”写的是部门工具')

// S2 超标模块
if (M) {
  const rows = R.over
  for (const m of M.modules) for (const o of overLimits(m)) {
    const key = o.item.slice(0, 3)
    if (!rows.some((r) => r['模块名'] === m.name && (r['超标项'] || '').includes(key))) must('S2', `模块 ${m.name} ${o.item}（${o.value}），第 3 节没有分析`)
  }
  for (const r of rows) {
    if (!M.modules.some((m) => m.name === r['模块名'])) review('S2', `第 3 节的模块 ${r['模块名']} 不在度量数据中`)
    if (blank(r['分析说明']) || r['分析说明'].length < 6) must('S2', `第 3 节模块 ${r['模块名']}（${r['超标项']}）没写分析说明`)
    if (blank(r['处理'])) must('S2', `第 3 节模块 ${r['模块名']}（${r['超标项']}）没写处理`)
  }
  if (M.modules.some((m) => m.ev == null) && M.modules.some((m) => m.cc > LIMIT.cc)) review('S2', '有圈复杂度超过 10 的模块但没有基本复杂度：报告中为【待补充】，告诉用户需要部门工具的数据')
}

// S3 规则违反甄别
const ids = new Map(R.rules.map((r) => [r['告警编号'], r]))
if (scan) for (const f of scan.findings) if (!ids.has(f.id)) must('S3', `gjb-scan 的 ${f.id}（${f.file}:${f.line} ${f.rule}）没有在第 4 节甄别`)
if (ck) { const n = (ck.findings || []).length, k = R.rules.filter((r) => /^CK-/.test(r['告警编号'])).length; if (n !== k) must('S3', `Cppcheck 运行记录有 ${n} 条告警，第 4 节 CK- 行有 ${k} 条`) }
for (const r of R.rules) {
  const id = r['告警编号'], j = r['判定']
  if (!/^(违反|特殊设计|误报|问题)$/.test(j)) must('S3', `${id} 的判定是“${j}”，只能是 违反 / 特殊设计 / 误报 / 问题`)
  if (/^(违反|特殊设计)$/.test(j)) {
    if (!/^R-\d+-\d+-\d+$/.test(r['规则编号'] || '')) must('S3', `${id} 判定为${j}，规则编号“${r['规则编号']}”不是 GJB 8114 编号`)
    if (!/^(强制|推荐)$/.test(r['规则类型'] || '')) must('S3', `${id} 的规则类型只能写 强制 / 推荐`)
  }
  if (/^(特殊设计|误报)$/.test(j) && (blank(r['分析说明']) || r['分析说明'].length < 8)) must('S3', `${id} 判定为${j}，分析说明没写清（特殊设计写设计依据和“不影响功能、性能”的理由）`)
  if (j === '特殊设计' && !/影响/.test(r['分析说明'] || '')) review('S3', `${id} 判定为特殊设计，分析说明中没写对软件功能、性能的影响`)
  if (j === '问题' && !R.review.some((x) => (x['文件:行号'] || '') === r['文件:行号'])) must('S3', `${id} 判定为问题，第 5 节代码审查中没有 ${r['文件:行号']} 的问题`)
}

// S4 统计
const viol = R.rules.filter((r) => /^(违反|特殊设计)$/.test(r['判定']))
const expect = {
  违反强制类规则: viol.filter((r) => r['规则类型'] === '强制').length,
  违反推荐类规则: viol.filter((r) => r['规则类型'] === '推荐').length,
  特殊设计: R.rules.filter((r) => r['判定'] === '特殊设计').length,
  误报: R.rules.filter((r) => r['判定'] === '误报').length,
  代码审查问题: R.review.length,
  待确认问题数: R.questions.length,
}
if (M) { expect['模块数'] = M.modules.length; expect['有效代码行'] = M.totalLines }
for (const [k, n] of Object.entries(expect)) {
  if (!(k in R.stats)) { must('S4', `第 7 节统计缺“${k}”一行`); continue }
  const got = Number(String(R.stats[k]).replace(/[^\d]/g, ''))
  if (got !== n) must('S4', `第 7 节“${k}”写 ${R.stats[k]}，按记录和度量数据应为 ${n}`)
}

// S5 报告
if (repP) {
  if (!existsSync(repP)) must('S5', `找不到报告 ${repP}`)
  else {
    const r = readText(repP), RS = sections(r)
    for (const [n, t] of [['1.1', '标识'], ['1.2', '系统概述'], ['1.3', '文档概述'], ['1.4', '术语和缩略语'], ['2', '引用文件'], ['3.1', '被测试软件说明'], ['3.2', '测试工作概述'], ['3.3', '测试数据及质量'], ['3.4', '测试结论'], ['3.5', '产品质量的评价和建议'], ['4.1', '软件规模统计分析'], ['4.2', '软件单元圈复杂度统计分析'], ['4.3', '软件单元的扇入、扇出数统计'], ['4.4', '软件单元源代码注释率统计'], ['4.5', '对编程约定执行情况统计分析'], ['4.6', '代码审查'], ['5', '测试工作总结']]) {
      if (!RS.some((s) => s.num === n && s.title.includes(t))) must('S5', `报告缺少“${n} ${t}”（报告应由 gen-sa-report.mjs 生成）`)
    }
    if (M) for (const m of M.modules) if (!r.includes(`| ${m.name} |`)) { must('S5', `报告表5-1～5-4 中没有模块 ${m.name}：度量数据变了要重新生成报告`); break }
    const mm = /违反强制类编程规则 (\d+) 处/.exec(r)
    if (mm && Number(mm[1]) !== expect['违反强制类规则']) must('S5', `报告写违反强制类规则 ${mm[1]} 处，记录中是 ${expect['违反强制类规则']} 处：重新生成报告`)
    const todo = r.split('\n').filter((l) => !l.trim().startsWith('<!--')).join('\n').split('【待补充】').length - 1
    if (todo) review('S5', `报告中还有 ${todo} 处【待补充】：有依据的填上，没有的告诉用户`)
    if (/本次测试通过/.test(r) && (expect['违反强制类规则'] - expect['特殊设计'] > 0 || R.review.some((x) => !/不更改|已修改|已更改/.test(x['处理更改'] || '')))) review('S5', '报告结论写“通过”，但仍有违反强制类规则或未处理的代码审查问题：核对结论')
  }
}

const n = out.filter((x) => x.level === '必须处理').length
console.log(`# 静态分析记录检查：${recP}\n`)
console.log(`模块 ${M ? M.modules.length : '?'} 个（度量来源：${M ? (M.source === 'tool' ? '部门工具 CSV' : 'metrics.mjs') : '无'}），甄别 ${R.rules.length} 条，超标分析 ${R.over.length} 行，代码审查问题 ${R.review.length} 个。`)
console.log(`必须处理 ${n} 项，复核 ${out.length - n} 项。\n`)
for (const lv of ['必须处理', '复核']) {
  const l = out.filter((x) => x.level === lv)
  if (!l.length) continue
  console.log(`## ${lv}\n`)
  for (const x of l) console.log(`- [${x.id}] ${x.msg}`)
  console.log('')
}
process.exit(n ? 1 : 0)
