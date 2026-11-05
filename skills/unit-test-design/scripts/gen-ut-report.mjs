#!/usr/bin/env node
// 由单元测试记录和运行记录生成部门模板格式的《XX 软件（VX.XX）单元测试报告》。
// 数字（用例数、通过/失败、覆盖率、未覆盖行）全部取自运行记录 last-run.json，不手算；
// 用例的测试目的、输入、预期、桩设置取自单元测试记录的用例表；疑似缺陷、未覆盖原因、局限取自记录。
// 叙述性的段落生成初稿，智能体再按实际情况修改（数字不要改）。
//
// 用法：node gen-ut-report.mjs --out <报告.md> [--software <软件名称>] [--version <VX.XX>] <单元测试记录1.md> [<单元测试记录2.md> ...]
//   每份记录对应一个被测单元（模块），记录“概述”中的“运行记录：<last-run.json 路径>”一行指明运行记录。
//   配置项有多个模块时，把各模块的记录都列上，生成一份汇总报告。
// 退出码：0 = 成功；2 = 用法或文件错误

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
const out = opt('--out')
let software = opt('--software')
let version = opt('--version')
const recs = args
if (!out || !recs.length) { console.error('用法：node gen-ut-report.mjs --out <报告.md> [--software <软件名称>] [--version <VX.XX>] <单元测试记录.md> ...'); process.exit(2) }

// —— Markdown 工具 ——
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let cur = ''
  let code = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (s[i] === '`') code = !code
    if (s[i] === '|' && !code) { cells.push(cur.trim()); cur = ''; continue }
    cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}
function parse(text) {
  const lines = text.split(/\r?\n/)
  const heads = []
  lines.forEach((l, i) => { const m = /^(#{1,4})\s+(.*)$/.exec(l); if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i }) })
  const section = (re) => { const h = heads.find((x) => x.level === 2 && re.test(x.title)); if (!h) return null; const n = heads.find((x) => x.line > h.line && x.level <= 2); return { start: h.line, end: n ? n.line : lines.length } }
  const rows = (s) => {
    if (!s) return []
    const o = []
    let header = null
    for (let i = s.start; i < s.end; i++) {
      const l = lines[i]
      if (!l.trim().startsWith('|')) { header = null; continue }
      if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
      const cells = splitRow(l)
      if (!header) { header = cells; continue }
      o.push({ cells, header })
    }
    return o
  }
  const text2 = (s) => (s ? lines.slice(s.start + 1, s.end).join('\n').trim() : '')
  return { lines, section, rows, text: text2 }
}
const col = (r, ...names) => { for (const n of names) { const k = r.header.findIndex((h) => h.includes(n)); if (k >= 0) return (r.cells[k] ?? '').trim() } return '' }
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
const pct = (c) => (c && c.total ? `${(100 * c.covered / c.total).toFixed(1)}%` : '—')
const pctOf = (a, b) => (b ? `${(100 * a / b).toFixed(2)}%（${a}/${b}）` : '—')
const norm = (id) => String(id).trim().toUpperCase().replace(/[._]/g, '-')

// —— 读记录和运行记录 ——
const units = []
for (const f of recs) {
  if (!existsSync(f)) { console.error(`读不到单元测试记录：${f}`); process.exit(2) }
  const P = parse(readFileSync(f, 'utf8').replace(/^﻿/, ''))
  const ov = P.lines.slice(0, (P.section(/被测单元|用例表/) || { start: 40 }).start).join('\n')
  const field = (k) => ((new RegExp(`${k}\\s*[:：]\\s*(.+)`).exec(ov) || [])[1] || '').replace(/`/g, '').trim()
  let runPath = field('运行记录')
  if (runPath && !isAbsolute(runPath)) runPath = resolve(dirname(f), runPath)
  if (!runPath || !existsSync(runPath)) { console.error(`${f}：概述中的“运行记录：”指向的文件不存在（${runPath || '未写'}）`); process.exit(2) }
  const run = JSON.parse(readFileSync(runPath, 'utf8'))
  const title = (P.lines.find((l) => /^#\s/.test(l)) || '').replace(/^#\s*/, '').replace(/单元测试(记录|报告).*/, '').trim()
  units.push({
    file: f, P, run, runPath, name: title || basename(f),
    field,
    cases: P.rows(P.section(/用例表/)).filter((r) => r.header.some((h) => h.includes('用例标识')) && /UT[-_]/i.test(col(r, '用例标识'))),
    defs: P.rows(P.section(/疑似缺陷/)).filter((r) => /DEF-\d{3}/.test(r.cells[0])),
    unc: P.rows(P.section(/未覆盖/)).filter((r) => r.header.some((h) => h === '行' || h.includes('行号'))),
    lim: P.rows(P.section(/局限/)).filter((r) => r.cells.join('').trim() && !/^无$/.test(r.cells[0])),
    stat: P.text(P.section(/统计/)),
  })
}
const first = units[0]
software = software || first.field('软件名称') || 'XX'
version = version || first.field('软件版本') || first.field('版本') || 'VX.XX'

// —— 汇总 ——
const files = []
for (const u of units) for (const f of u.run.coverage?.files || []) files.push({ ...f, unit: u })
const fnFile = new Map()
for (const f of files) for (const fn of f.functions || []) fnFile.set(fn.name, f)
const allCases = units.flatMap((u) => (u.run.cases || []).map((c) => ({ ...c, unit: u })))
const sum = (k) => units.reduce((a, u) => a + (u.run.summary?.[k] || 0), 0)
const total = { cases: sum('cases'), passed: sum('passed'), failed: sum('failed') }
const notFinished = allCases.filter((c) => c.result === '未结束').length
const failedOnly = allCases.filter((c) => c.result === '失败').length
const executed = allCases.filter((c) => c.result !== '未运行').length
const totCov = (k) => units.reduce((a, u) => { const c = u.run.coverage?.total?.[k]; return c ? { covered: a.covered + c.covered, total: a.total + c.total } : a }, { covered: 0, total: 0 })
const mcdcMeasured = units.every((u) => u.run.mcdcMeasured)
const fns = files.flatMap((f) => f.functions || [])
const tested = fns.filter((fn) => fn.called > 0)
const untested = fns.filter((fn) => !fn.called)
const recCase = new Map(units.flatMap((u) => u.cases.map((r) => [norm(col(r, '用例标识')), { r, u }])))
const caseFn = (c) => { const rc = recCase.get(norm(c.id)); return rc ? col(rc.r, '被测函数').split(/[、,，\s]+/).filter(Boolean) : [] }
const exec = (list) => `${list.filter((c) => c.result !== '未运行').length}/${list.filter((c) => c.result === '失败').length}/${list.filter((c) => c.result === '未结束').length}/${list.length}`
const srcLines = units.flatMap((u) => u.run.sources || []).reduce((a, s) => a + (existsSync(s) ? readFileSync(s, 'utf8').split(/\r?\n/).length : 0), 0)
const defs = units.flatMap((u) => u.defs.map((r) => ({ r, u })))
const compilers = [...new Set(units.map((u) => (u.run.compiler || '').replace(/^.*[\\/]/, '')).filter(Boolean))]
const framework = [...new Set(units.map((u) => (u.run.framework === 'gtest' ? 'GoogleTest' : '手写驱动（utest.h）')))].join('、')
const P = (s) => `【待补充：${s}】`

// —— 生成 ——
const L = []
const T = (header, rows) => { L.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`); for (const r of rows) L.push(`| ${r.map(esc).join(' | ')} |`); L.push('') }
L.push(`# ${software}（${version}）单元测试报告`, '')
L.push('<!-- 本报告由 gen-ut-report.mjs 依据单元测试记录和运行记录生成。数字取自运行记录，不要手改；【待补充】处和叙述性段落按实际情况修改。 -->', '')
L.push('## 1 范围', '', '### 1.1 标识', '')
L.push(`软件名称：${software}`, '', `软件代号：${first.field('软件代号') || P('R/产品代号/区别号')}`, '', `交办方：${first.field('交办方') || P('产品总体单位')}`, '', `承制方：${first.field('承制方') || P('承制单位')}`, '', `安全关键等级：${first.field('安全关键等级') || P('A/B/C/D 级')}`, '', `软件类型：${first.field('软件类型') || '星载嵌入式软件'}`, '')
L.push('### 1.2 系统概述', '', P('概述本文档所适用系统和软件的用途、软件在系统内承担的工作、运行环境，与需求规格说明保持一致'), '')
L.push('### 1.3 文档概述', '', `本文档依据${units.map((u) => `《${u.field('设计依据').replace(/[（(].*$/, '') || '详细设计说明'}》`).filter((v, i, a) => a.indexOf(v) === i).join('、')}对软件进行单元测试，并记录测试过程和结果，以对软件的质量进行评价，为软件设计与编码人员提供测试问题的依据，也作为进行下一步工作（软件集成与集成测试）的依据。`, '', '本文档的主要读者是软件设计人员、编码人员。', '')
L.push('### 1.4 术语和缩略语', '', 'MC/DC：修正条件/判定覆盖，Modified Condition/Decision Coverage。', '')
L.push('## 2 引用文件', '')
for (const v of [...new Set(units.map((u) => u.field('设计依据')).filter(Boolean))]) L.push(`${v}`, '')
L.push(P('单元测试计划、单元测试说明（如有），写编号、名称、版本'), '')
L.push('## 3 测试过程概述', '', '### 3.1 被测试软件说明', '', P('概述被测试软件的功能、性能和特点'), '')
L.push(`表 3.1-1 ${software}情况表`, '')
T(['项目', '内容'], [['安全关键等级', first.field('安全关键等级') || P('等级')], ['编程语言', 'C 语言'], ['代码行数', `${srcLines} 行（被测源文件物理行数）`], ['开发环境', first.field('开发环境') || P('开发环境')], ['软件规模', P('小型/中型/大型')], ['模块数量', `${fns.length}（函数）`]])
L.push('### 3.2 测试工作概述', '')
T(['序号', '测试对象', '版本', '测试环境', '版本', '说明'], units.map((u, i) => [i + 1, u.name, `源文件 SHA-1 ${Object.values(u.run.sourceHashes || {}).join('、') || '—'}`, `${framework}；${(u.run.compiler || '').replace(/^.*[\\/]/, '')}`, u.run.time ? u.run.time.slice(0, 10) : '—', u.field('说明') || '首次提交']))
L.push('### 3.3 测试数据及度量分析', '')
L.push(`使用 ${compilers.join('、') || '主机编译器'} 的覆盖率工具（gcov）和单元测试工作台（${framework}）在主机上对被测软件进行单元测试。单元测试从程序的内部结构出发设计测试用例，采用白盒测试方法，主要从以下 5 个方面进行测试：`, '')
L.push('- 模块接口——对被测的模块，信息能否正常无误地流入和流出；', '- 局部数据结构——在模块工作过程中，其内部的数据能否保持其完整性，包括内部数据的内容、形式及相互关系不发生错误；', '- 边界条件——在为限制数据加工而设置的边界处，模块是否能够正常工作；', `- 覆盖条件——模块的运行能否达到满足特定的语句累计覆盖率、分支累计覆盖率、MC/DC 覆盖率（A/B 级软件单元测试 100%）的要求；`, '- 错误处理——模块工作中发生了一个错误，其中的错误处理措施是否有效。', '')
L.push(`共设计用例 ${total.cases} 个，执行 ${executed} 个，通过 ${total.passed} 个，失败 ${total.failed} 个。语句覆盖率 ${pct(totCov('statements'))}，分支覆盖率 ${pct(totCov('branches'))}，MC/DC 覆盖率 ${mcdcMeasured ? pct(totCov('mcdc')) : '未测量'}。预期结果全部依据详细设计推导，失败用例按设计判为疑似缺陷，未修改预期。`, '')
L.push('### 3.4 不可测试项仿真', '')
const limRows = units.flatMap((u) => u.lim.map((r) => [col(r, '内容') || r.cells[1], col(r, '原因') || r.cells[2], col(r, '验证方式') || r.cells[3], '在目标机或真实硬件上验证', '未执行', '待目标机验证']))
if (limRows.length) T(['项目', '不可测试项内容', '步骤', '预期结果', '实际结果', '结论'], limRows)
else L.push('无。', '')
L.push('### 3.5 测试结论', '')
L.push(`共测试函数 ${tested.length} 个${untested.length ? `（另有 ${untested.length} 个函数未被调用：${untested.map((f) => f.name).join('、')}）` : ''}，执行用例 ${executed} 个，通过 ${total.passed} 个，失败 ${total.failed} 个；语句覆盖率 ${pct(totCov('statements'))}，分支覆盖率 ${pct(totCov('branches'))}，MC/DC 覆盖率 ${mcdcMeasured ? pct(totCov('mcdc')) : '未测量'}。`, '')
L.push(defs.length ? `测试中发现疑似缺陷 ${defs.length} 个（见 4.4），需开发人员确认处理后进行回归测试。本次测试未通过，有遗留问题。` : `测试中未发现问题。${totCov('statements').covered === totCov('statements').total && totCov('branches').covered === totCov('branches').total ? '本次测试通过，无遗留问题。' : '未覆盖项见 4.3。'}`, '')
L.push('### 3.6 测试环境的影响', '')
L.push('测试在主机（x86，小端）上编译运行，与目标机在字节序、char 符号、long 和指针宽度、对齐、寄存器和中断时序上不同。需要在目标机或真实硬件上验证的项目：', '')
if (units.some((u) => u.lim.length)) T(['序号', '内容', '原因', '验证方式'], units.flatMap((u) => u.lim.map((r) => r.cells.slice(0, 4))))
else L.push('无。', '')
L.push('### 3.7 产品质量的评价和建议', '')
L.push(defs.length ? `针对疑似缺陷的改进建议：${defs.map(({ r }) => `${r.cells[0]}：${col(r, '建议') || '—'}`).join('；')}。` : P('对产品质量进行评价，提出改进建议'), '')
L.push('## 4 详细测试结果', '', `针对 ${software} 的全部被测函数设计了测试用例，附录 A 记录了 ${total.cases} 个用例的测试结果。`, '')
L.push('### 4.1 测试结果概述', '', '表 4.1-1 单元测试结果', '')
T(['项目', '测试结果', '备注'], [
  ['已测函数个数', tested.length, ''], ['未测函数个数', untested.length, untested.map((f) => f.name).join('、')], ['测试用例个数', total.cases, ''], ['执行用例个数', executed, ''],
  ['错误用例个数', notFinished, '崩溃或超时未结束'], ['失败用例个数', failedOnly, ''], ['用例执行率', pctOf(executed, total.cases), ''], ['测试通过率', pctOf(total.passed, total.cases), ''],
  ['语句覆盖率', pct(totCov('statements')), `${totCov('statements').covered}/${totCov('statements').total}`], ['分支覆盖率', pct(totCov('branches')), `${totCov('branches').covered}/${totCov('branches').total}`],
  ['MC/DC覆盖率', mcdcMeasured ? `${pct(totCov('mcdc'))}（${totCov('mcdc').covered}/${totCov('mcdc').total}）` : '未测量', mcdcMeasured ? '' : '编译器不支持 MC/DC 测量，见单元测试记录的 MC/DC 分析表'],
])
L.push('### 4.2 测试结果统计', '', '用例执行情况的格式为“执行用例数/失败用例数/错误用例数/用例总数”。', '', '#### 4.2.1 文件测试结果统计', '', '表 4.2-1 被测文件说明', '')
const casesOfFile = (f) => allCases.filter((c) => c.unit === f.unit && caseFn(c).some((n) => (f.functions || []).some((fn) => fn.name === n)))
T(['序号', '文件名', '函数个数', '用例执行情况', '语句覆盖率', '分支覆盖率', 'MC/DC覆盖率'], files.map((f, i) => [i + 1, f.name, (f.functions || []).length, exec(casesOfFile(f)), pct(f.statements), pct(f.branches), mcdcMeasured ? pct(f.mcdc) : '未测量']))
L.push('#### 4.2.2 函数测试结果统计', '')
files.forEach((f, i) => {
  L.push(`${i + 1}）文件 ${f.name} 函数说明如下表所示。`, '', `表 4.2-${i + 2} 文件 ${f.name} 中函数说明`, '')
  T(['序号', '函数名', '用例执行情况', '语句覆盖率', '分支覆盖率', 'MC/DC覆盖率'], (f.functions || []).map((fn, k) => [k + 1, fn.name, exec(allCases.filter((c) => c.unit === f.unit && caseFn(c).includes(fn.name))), pct(fn.statements), pct(fn.branches), mcdcMeasured ? (fn.mcdc?.total ? pct(fn.mcdc) : '无') : '未测量']))
})
L.push('### 4.3 未覆盖测试情况说明', '')
let anyUnc = false
files.forEach((f, i) => {
  const items = []
  for (const fn of f.functions || []) {
    for (const l of fn.uncoveredLines || []) items.push({ fn: fn.name, line: l, kind: '语句', desc: '无' })
    for (const b of fn.untakenBranches || []) items.push({ fn: fn.name, line: b.line, kind: '分支', desc: `${b.taken}/${b.total} 个分支已执行` })
    for (const c of fn.uncoveredConditions || []) items.push({ fn: fn.name, line: c.line, kind: 'MC/DC', desc: c.text || c.condition || '条件未独立影响判定' })
  }
  if (!items.length) return
  anyUnc = true
  const why = (line) => { const r = f.unit.unc.find((x) => [...col(x, '行').matchAll(/(\d+)\s*(?:[-～~—]\s*(\d+))?/g)].some((m) => line >= Number(m[1]) && line <= Number(m[2] || m[1])) && (!col(x, '文件') || col(x, '文件').includes(f.name))); return r ? [`${col(r, '原因类别')}：${col(r, '说明')}`, col(r, '处理')] : [P('原因，见单元测试记录未覆盖项说明'), ''] }
  L.push(`${i + 1}）文件 ${f.name} 测试未覆盖情况说明如下表所示。`, '', `表 4.3-${i + 1} 文件 ${f.name} 中测试未覆盖情况说明`, '')
  T(['序号', '所属函数', '起止行', '未覆盖类别', '未覆盖描述', '未覆盖原因', '说明'], items.map((it, k) => [k + 1, it.fn, `${it.line}-${it.line}`, it.kind, it.desc, ...why(it.line)]))
})
if (!anyUnc) L.push('所有被测函数的语句、分支' + (mcdcMeasured ? '、MC/DC ' : '') + '均已覆盖，无未覆盖项。', '')
L.push('### 4.4 测试问题统计', '')
L.push(`测试中共测到问题 ${defs.length} 个，其中错误问题 ${notFinished ? Math.min(notFinished, defs.length) : 0} 个，失败问题 ${defs.length - (notFinished ? Math.min(notFinished, defs.length) : 0)} 个，已确认问题 0 个，未确认问题 ${defs.length} 个（均为疑似缺陷，待开发人员确认）。`, '')
const defFile = ({ r }) => { const loc = col(r, '疑似位置'); const m = /([\w.]+\.c)/i.exec(loc); return m ? m[1] : (files.find((f) => (f.functions || []).some((fn) => loc.includes(fn.name)))?.name || '—') }
const byFile = new Map()
for (const d of defs) { const k = defFile(d); if (!byFile.has(k)) byFile.set(k, []); byFile.get(k).push(d) }
if (!defs.length) T(['序号', '问题现象', '所属文件', '所属函数', '所属用例', '是否确认', '审查人', '确认时间', '问题描述', '确认结论'], [['1', '无', '无', '无', '无', '无', '无', '无', '无', '无']])
let fi = 0
for (const [fname, list] of byFile) {
  fi++
  L.push(`${fi}）文件 ${fname} 测试问题列表。`, '')
  T(['序号', '问题现象', '所属文件', '所属函数', '所属用例', '是否确认', '审查人', '确认时间', '问题描述', '确认结论'], list.map(({ r }, k) => {
    const caseIds = [...r.cells.join(' ').matchAll(/UT[-_][A-Z0-9]+(?:[-_.][A-Z0-9]+)*[-_]\d{3}/gi)].map((m) => m[0])
    const fnName = (files.flatMap((f) => f.functions || []).find((fn) => col(r, '疑似位置').includes(fn.name) || caseIds.some((id) => caseFn({ id }).includes(fn.name))) || {}).name || '—'
    return [k + 1, `${r.cells[0]}：${col(r, '现象')}`, fname, fnName, caseIds.join('、') || col(r, '用例'), '否', '', '', `设计依据：${col(r, '设计依据')}；疑似位置：${col(r, '疑似位置')}`, '']
  }))
}
L.push('## 5 测试工作总结', '')
L.push(`本次单元测试共执行用例 ${executed} 个，通过 ${total.passed} 个，失败 ${total.failed} 个；语句覆盖率 ${pct(totCov('statements'))}，分支覆盖率 ${pct(totCov('branches'))}，MC/DC 覆盖率 ${mcdcMeasured ? pct(totCov('mcdc')) : '未测量'}。${defs.length ? `发现疑似缺陷 ${defs.length} 个，待开发人员确认处理后回归。` : ''}`, '')
L.push(P('总结本次测试工作过程、经验教训，并对测试过程提出改进建议'), '')
L.push('## 附录A 单元测试用例记录', '', '各用例的测试记录如下。语句覆盖率、分支覆盖率为被测函数在全部用例下的累计覆盖率（主机 gcov 统计）。', '')
const failDetail = new Map(units.flatMap((u) => (u.run.failures || []).map((x) => [norm(x.id), x.detail.replace(/^.*?:\d+:\s*/, '')])))
for (const c of allCases) {
  const rc = recCase.get(norm(c.id))
  const r = rc?.r
  const fnNames = caseFn(c)
  const cov = fnNames.map((n) => fnFile.get(n)?.functions?.find((x) => x.name === n)).filter(Boolean)
  const actual = c.result === '通过' ? `与期望输出一致${r ? `（${col(r, '预期结果', '预期')}）` : ''}` : c.result === '未结束' ? '用例未结束（崩溃或超时）' : (failDetail.get(norm(c.id)) || '失败')
  L.push(`表 A-${allCases.indexOf(c) + 1} ${c.id}`, '')
  T(['项目', '内容'], [
    ['用例名称', r ? col(r, '测试目的') : c.desc], ['用例标识', c.id], ['被测函数', fnNames.join('、') || '—'], ['测试目的', r ? col(r, '测试目的') : c.desc],
    ['测试输入：重复次数', r ? (col(r, '重复次数') || '1') : '1'], ['测试输入：全局变量', r ? (col(r, '全局变量') || '无') : '—'], ['测试输入：函数参数', r ? (col(r, '函数参数') || col(r, '输入') || '—') : '—'], ['测试输入：其他输入', r ? (col(r, '其他输入') || '无') : '—'],
    ['期望输出', r ? col(r, '预期结果', '预期') : '—'], ['实际输出', actual], ['桩函数设置', r ? (col(r, '桩函数设置', '桩') || '无') : '—'],
    ['语句覆盖率', cov.map((x) => `${x.name} ${pct(x.statements)}`).join('；') || '—'], ['分支覆盖率', cov.map((x) => `${x.name} ${pct(x.branches)}`).join('；') || '—'],
    ['测试结果', c.result === '通过' ? '通过' : c.result === '未结束' ? '错误（未结束）' : `失败${(defs.find(({ r: d }) => norm(d.cells.join(' ')).includes(norm(c.id)))?.r.cells[0] ? `（${defs.find(({ r: d }) => norm(d.cells.join(' ')).includes(norm(c.id))).r.cells[0]}）` : '')}`],
  ])
}
writeFileSync(out, L.join('\n'), 'utf8')
const missing = allCases.filter((c) => !recCase.has(norm(c.id))).map((c) => c.id)
console.log(`已生成：${out}`)
console.log(`单元 ${units.length} 个，文件 ${files.length} 个，函数 ${fns.length} 个，用例 ${total.cases} 个（通过 ${total.passed}，失败 ${total.failed}），疑似缺陷 ${defs.length} 个`)
if (missing.length) console.log(`注意：运行记录中有 ${missing.length} 个用例在单元测试记录的用例表中找不到（附录 A 中这些用例的输入和期望输出为“—”）：${missing.slice(0, 10).join('、')}${missing.length > 10 ? '……' : ''}`)
console.log(`报告中有 ${L.join('\n').match(/【待补充/g)?.length || 0} 处【待补充】，按实际情况填写；数字不要手改，测试重新运行后重新生成。`)
