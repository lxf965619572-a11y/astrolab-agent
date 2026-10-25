#!/usr/bin/env node
// 单元测试报告自查脚本：对照测试代码和最后一次运行记录（last-run.json），按固定规则检查报告。
// 只读，不修改任何文件。列出的是疑似问题：“必须处理”项要改正，“复核”项逐条判断。
//
// 用法：node check-ut.mjs <单元测试报告.md> [--run <last-run.json>] [--tests <测试目录>]
//   --run    run_unit_tests 返回的“运行记录”路径。省略时在当前目录的 .utest/ 下找最近的一次
//   --tests  测试代码目录。省略时用运行记录中的测试文件
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
let runPath = opt('--run')
const testsDir = opt('--tests')
const file = args[0]
if (!file) { console.error('用法：node check-ut.mjs <单元测试报告.md> [--run <last-run.json>] [--tests <测试目录>]'); process.exit(2) }
let text
try { text = readFileSync(file, 'utf8').replace(/^﻿/, '') } catch (e) { console.error(`读不到报告：${file}（${e.message}）`); process.exit(2) }
const lines = text.split(/\r?\n/)

// —— 运行记录 ——
const notes = []
if (!runPath) {
  const root = resolve('.utest')
  if (existsSync(root)) {
    const cands = readdirSync(root).map((d) => join(root, d, 'last-run.json')).filter((p) => existsSync(p))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (cands.length) { runPath = cands[0]; notes.push(`未指定 --run，使用最近的运行记录：${runPath}`) }
  }
}
let run = null
if (runPath) {
  try { run = JSON.parse(readFileSync(runPath, 'utf8')) } catch (e) { console.error(`读不到运行记录：${runPath}（${e.message}）`); process.exit(2) }
} else notes.push('没有运行记录：与运行结果有关的检查（U4～U9）未执行。测试运行过的，用 --run 指定 last-run.json')

// —— 报告解析（按标题文字识别章节）——
const heads = []
lines.forEach((l, i) => { const m = /^(#{2,4})\s+(.*)$/.exec(l); if (m) heads.push({ level: m[1].length, title: m[2], line: i }) })
function section(pattern) {
  const h = heads.find((x) => x.level === 2 && pattern.test(x.title))
  if (!h) return null
  const next = heads.find((x) => x.line > h.line && x.level <= 2)
  return { title: h.title, start: h.line, end: next ? next.line : lines.length }
}
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}
function rows(sec) {
  if (!sec) return []
  const out = []
  let header = null
  for (let i = sec.start; i < sec.end; i++) {
    const l = lines[i]
    if (!l.trim().startsWith('|')) { header = null; continue }
    if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
    const cells = splitRow(l)
    if (!header) { header = cells; continue }
    out.push({ line: i + 1, cells, header })
  }
  return out
}
const col = (r, ...names) => { for (const n of names) { const k = r.header.findIndex((h) => h.includes(n)); if (k >= 0) return r.cells[k] ?? '' } return '' }
const secText = (sec) => (sec ? lines.slice(sec.start, sec.end).join('\n') : '')

const findings = []
const seen = new Set()
const add = (level, rule, line, msg) => {
  const key = `${rule}|${line}|${msg}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ level, rule, line, msg })
}

// 用例标识归一化：UT-CMD-SUM-001、UT_CMD.SUM_001 都变成 UT-CMD-SUM-001
const norm = (id) => String(id).trim().toUpperCase().replace(/[._]/g, '-')
const ID_RE = /UT[-_][A-Z0-9]+(?:[-_.][A-Z0-9]+)*[-_]\d{3}\b/gi
const ID_ONE = new RegExp(ID_RE.source, 'i')

// —— U0 必需章节 ——
const REQUIRED = [['概述', /概述/], ['用例表', /用例表/], ['运行结果', /运行结果/], ['疑似缺陷', /疑似缺陷/], ['未覆盖项说明', /未覆盖/],
  ['MC/DC 分析', /MC\/?DC/i], ['待确认问题', /待确认/], ['主机测试局限', /局限/], ['统计', /统计/]]
const S = {}
for (const [name, re] of REQUIRED) {
  S[name] = section(re)
  if (!S[name]) add('必须处理', 'U0 缺少章节', 1, `报告没有“${name}”一章。没有内容也要保留章节并写“无”`)
}
const caseRows = rows(S['用例表']).filter((r) => r.header.some((h) => h.includes('用例标识')))
if (S['用例表'] && !caseRows.length) add('必须处理', 'U0 用例表格式', S['用例表'].start + 1, '用例表中没有找到表头含“用例标识”的表格')
const defRows = rows(S['疑似缺陷']).filter((r) => /DEF-\d{3}/.test(r.cells[0]))
const uncRows = rows(S['未覆盖项说明']).filter((r) => r.header.some((h) => h === '行' || h.includes('行号')))
const qRows = rows(S['待确认问题']).filter((r) => /Q-\d{3}/.test(r.cells[0]))
const fixRows = rows(section(/用例修正/))

// —— 测试代码 ——
let testFiles = []
if (testsDir) {
  try { testFiles = readdirSync(testsDir).filter((f) => /\.(c|cc|cpp|cxx|h|hpp)$/i.test(f)).map((f) => join(testsDir, f)) }
  catch (e) { console.error(`读不到测试目录：${testsDir}（${e.message}）`); process.exit(2) }
} else if (run?.tests) testFiles = run.tests.filter((f) => existsSync(f))
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
const codeIds = new Map() // 归一化标识 → 文件:行
const testTexts = []
for (const f of testFiles) {
  const raw = readFileSync(f, 'utf8')
  const t = stripComments(raw)
  testTexts.push({ f, t })
  const lineOf = (idx) => t.slice(0, idx).split('\n').length
  for (const m of t.matchAll(/UT_CASE\s*\(\s*"([^"]+)"/g)) codeIds.set(norm(m[1]), `${basename(f)}:${lineOf(m.index)}`)
  for (const m of t.matchAll(/\bTEST(?:_F|_P)?\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g)) codeIds.set(norm(`${m[1]}.${m[2]}`), `${basename(f)}:${lineOf(m.index)}`)
}

// —— U1 用例标识一致 ——
const tableIds = new Map()
for (const r of caseRows) {
  const id = col(r, '用例标识')
  if (!id) continue
  if (!/^UT-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/.test(id)) add('复核', 'U1 用例标识格式', r.line, `“${id}”不符合 UT-<模块简称>-<函数简称>-<3 位序号>`)
  if (tableIds.has(norm(id))) add('必须处理', 'U1 用例标识重复', r.line, `${id} 在用例表中出现了不止一次`)
  tableIds.set(norm(id), r)
}
if (testFiles.length) {
  for (const [id, where] of codeIds) if (!tableIds.has(id)) add('必须处理', 'U1 用例标识不一致', S['用例表']?.start + 1 || 1, `测试代码中的用例 ${id}（${where}）不在报告用例表中`)
  for (const [id, r] of tableIds) if (!codeIds.has(id)) add('必须处理', 'U1 用例标识不一致', r.line, `用例表中的 ${col(r, '用例标识')} 在测试代码中找不到`)
} else notes.push('没有找到测试代码：U1（用例标识一致）、U10、U11 未执行')

// —— U2 预期依据、U3 预期结果写法 ——
const FROM_CODE = /代码|源码|源程序|实现|实际输出|实际值|运行结果|程序逻辑/
for (const r of caseRows) {
  const id = col(r, '用例标识')
  const basis = col(r, '依据')
  const exp = col(r, '预期结果', '预期')
  if (!basis || /^[-—无]$/.test(basis)) add('必须处理', 'U2 预期无依据', r.line, `${id} 的依据为空：预期结果必须来自设计文件的章节`)
  else if (FROM_CODE.test(basis) && !/设计未规定/.test(basis)) add('必须处理', 'U2 预期来自代码', r.line, `${id} 的依据为“${basis}”：预期结果不能依据代码或运行结果推导`)
  else if (!/\d/.test(basis) && !/Q-\d{3}/.test(basis)) add('复核', 'U2 依据无章节号', r.line, `${id} 的依据“${basis}”没有章节号，确认依据在设计文件中的位置`)
  if (!exp) add('必须处理', 'U3 预期结果为空', r.line, `${id} 没有写预期结果`)
  else if (/^(正常|正确|成功|通过|符合设计|与设计一致|满足要求)[。.]?$/.test(exp)) add('必须处理', 'U3 预期结果含糊', r.line, `${id} 的预期结果“${exp}”不具体，写出具体的返回值或状态`)
}

// —— 编号引用 ——
const qIds = new Set(qRows.map((r) => r.cells[0].match(/Q-\d{3}/)[0]))
const defIds = new Set(defRows.map((r) => r.cells[0].match(/DEF-\d{3}/)[0]))
const missQ = new Set(), missD = new Set()
lines.forEach((l, i) => {
  if (S['待确认问题'] && i >= S['待确认问题'].start && i < S['待确认问题'].end) return
  for (const m of l.matchAll(/Q-\d{3}/g)) if (!qIds.has(m[0]) && !missQ.has(m[0])) { missQ.add(m[0]); add('必须处理', 'U3 问题编号不存在', i + 1, `引用了 ${m[0]}，但待确认问题表中没有`) }
  if (S['疑似缺陷'] && i >= S['疑似缺陷'].start && i < S['疑似缺陷'].end) return
  for (const m of l.matchAll(/DEF-\d{3}/g)) if (!defIds.has(m[0]) && !missD.has(m[0])) { missD.add(m[0]); add('必须处理', 'U3 缺陷编号不存在', i + 1, `引用了 ${m[0]}，但疑似缺陷表中没有`) }
})

// —— 与运行记录核对 ——
if (run) {
  const runCases = new Map((run.cases || []).map((c) => [norm(c.id), c]))
  const failedRun = [...runCases.values()].filter((c) => c.result !== '通过')
  const defText = defRows.map((r) => norm(r.cells.join(' '))).join('\n')

  // U4 失败用例必须列为疑似缺陷；用例表结果与运行一致
  for (const c of failedRun) {
    if (!defText.includes(norm(c.id))) add('必须处理', 'U4 失败用例未列为疑似缺陷', S['疑似缺陷']?.start + 1 || 1,
      `${c.id} 在最后一次运行中${c.result === '未结束' ? '没有结束（崩溃或超时）' : '失败'}，但疑似缺陷表中没有它。用例确实写错的，改正后重新运行；否则列为疑似缺陷，不改预期`)
  }
  for (const [id, r] of tableIds) {
    const c = runCases.get(id)
    const res = col(r, '结果')
    if (!c) { if (testFiles.length && codeIds.has(id)) add('复核', 'U4 用例未运行', r.line, `${col(r, '用例标识')} 在代码中有，但最后一次运行中没有执行到`); continue }
    if (c.result === '通过' && /失败/.test(res)) add('必须处理', 'U4 结果与运行不一致', r.line, `${col(r, '用例标识')} 在最后一次运行中通过，用例表写“${res}”`)
    if (c.result !== '通过' && /通过/.test(res) && !/失败/.test(res)) add('必须处理', 'U4 结果与运行不一致', r.line, `${col(r, '用例标识')} 在最后一次运行中${c.result}，用例表写“${res}”`)
  }
  // U5 疑似缺陷表中的用例在运行中通过
  for (const r of defRows) {
    const ids = [...r.cells.join(' ').matchAll(ID_RE)].map((m) => norm(m[0]))
    for (const id of ids) if (runCases.get(id)?.result === '通过') add('复核', 'U5 缺陷用例已通过', r.line, `${r.cells[0]} 关联的 ${id} 在最后一次运行中通过：是否改过预期？改过的要写入用例修正记录并说明设计依据`)
  }

  // U6 未覆盖项逐行说明，U7 原因类别
  const unc = []
  for (const f of run.coverage?.files || []) for (const fn of f.functions || []) {
    for (const l of fn.uncoveredLines || []) unc.push({ file: basename(f.name), fn: fn.name, line: l, kind: '语句' })
    for (const b of fn.untakenBranches || []) unc.push({ file: basename(f.name), fn: fn.name, line: b.line, kind: `分支（${b.taken}/${b.total}）` })
  }
  const explained = []
  for (const r of uncRows) {
    const nums = []
    for (const m of col(r, '行').matchAll(/(\d+)\s*(?:[-～~—]\s*(\d+))?/g)) {
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
      for (let k = a; k <= b && k - a < 500; k++) nums.push(k)
    }
    explained.push({ file: col(r, '文件'), nums })
    const cat = col(r, '原因类别', '原因')
    if (!/防御性代码不可达|需目标机或硬件|设计未规定|编译器生成/.test(cat)) add('必须处理', 'U7 原因类别', r.line, `原因类别“${cat}”不在规定的四类中（防御性代码不可达、需目标机或硬件、设计未规定、编译器生成）`)
    const why = r.cells.join(' ')
    if (/遗漏|来不及|后续补充|以后补充|时间不够|暂未|未设计用例/.test(why)) add('必须处理', 'U7 不是可接受的原因', r.line, `“${why.slice(0, 60)}”：这种情况应补充用例，不能作为未覆盖的原因`)
    if (/设计未规定/.test(cat) && !/Q-\d{3}/.test(why)) add('必须处理', 'U7 未关联问题', r.line, '原因为“设计未规定”，但没有关联 Q-xxx')
  }
  const missing = unc.filter((u) => !explained.some((e) => e.nums.includes(u.line) && (!e.file || e.file.includes(u.file) || !e.file.includes('.'))))
  const byKey = new Map()
  for (const u of missing) { const k = `${u.file}:${u.line}`; if (!byKey.has(k)) byKey.set(k, u) }
  for (const u of byKey.values()) add('必须处理', 'U6 未覆盖项未说明', S['未覆盖项说明']?.start + 1 || 1, `${u.file} 第 ${u.line} 行（${u.fn}，${u.kind}）未覆盖，未覆盖项说明中没有这一行。能补用例的补用例，不能的说明原因`)

  // U8 运行结果数字与运行记录一致
  const rt = secText(S['运行结果'])
  const sm = run.summary
  const m1 = /共\s*(\d+)\s*个[，,、\s]*通过\s*(\d+)\s*个[，,、\s]*失败\s*(\d+)/.exec(rt)
  if (!sm) add('必须处理', 'U8 运行未完成', S['运行结果']?.start + 1 || 1, '运行记录中没有统计行（测试程序崩溃或超时），报告不能写成运行完成')
  else if (!m1) add('必须处理', 'U8 运行结果格式', S['运行结果']?.start + 1 || 1, '运行结果中没有“用例：共 N 个，通过 M 个，失败 K 个”')
  else if (Number(m1[1]) !== sm.cases || Number(m1[2]) !== sm.passed || Number(m1[3]) !== sm.failed)
    add('必须处理', 'U8 统计不一致', S['运行结果'].start + 1, `报告写共 ${m1[1]}、通过 ${m1[2]}、失败 ${m1[3]}，运行记录为共 ${sm.cases}、通过 ${sm.passed}、失败 ${sm.failed}`)
  const tot = run.coverage?.total
  for (const [label, key] of [['语句覆盖', 'statements'], ['分支覆盖', 'branches']]) {
    const m = new RegExp(`${label}[：:]\\s*(\\d+)\\s*/\\s*(\\d+)`).exec(rt)
    const c = tot?.[key]
    if (!c) continue
    if (!m) add('必须处理', 'U8 运行结果格式', S['运行结果']?.start + 1 || 1, `运行结果中没有“${label}：已覆盖/总数（百分比）”`)
    else if (Number(m[1]) !== c.covered || Number(m[2]) !== c.total) add('必须处理', 'U8 统计不一致', S['运行结果'].start + 1, `报告${label} ${m[1]}/${m[2]}，运行记录为 ${c.covered}/${c.total}`)
  }

  // U9 MC/DC 写法
  if (!run.mcdcMeasured) {
    lines.forEach((l, i) => {
      if (/MC\/?DC[^|\n]{0,24}?\d+(?:\.\d+)?\s*[%％]/i.test(l) || /MC\/?DC[^|\n]{0,12}?\d+\s*\/\s*\d+\s*（/i.test(l))
        add('必须处理', 'U9 MC/DC 写法', i + 1, '编译器没有测量 MC/DC，不能写覆盖率百分比。写“MC/DC：未测量；分析表核对 N 个判定，满足 M 个”')
    })
  } else if (tot?.mcdc) {
    const m = /MC\/?DC[：:]\s*(\d+)\s*\/\s*(\d+)/i.exec(rt)
    if (m && (Number(m[1]) !== tot.mcdc.covered || Number(m[2]) !== tot.mcdc.total)) add('必须处理', 'U8 统计不一致', S['运行结果'].start + 1, `报告 MC/DC ${m[1]}/${m[2]}，运行记录为 ${tot.mcdc.covered}/${tot.mcdc.total}`)
  }

  // U10 被测代码与测试代码在运行前后是否变化
  for (const f of run.sourcesModifiedDuringRun || []) add('必须处理', 'U10 被测代码被修改', 1, `运行期间被测文件发生变化：${f}`)
  for (const [f, h] of Object.entries(run.sourceHashes || {})) {
    if (!existsSync(f)) continue
    const now = createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, h.length)
    if (now !== h) add('必须处理', 'U10 被测代码被修改', 1, `${f} 在最后一次运行之后被修改。单元测试不得修改被测代码；如果是开发者改的，重新运行测试并更新报告`)
  }
  const runTime = run.time ? Date.parse(run.time) : statSync(runPath).mtimeMs
  for (const f of testFiles) if (statSync(f).mtimeMs > runTime + 2000) add('必须处理', 'U10 测试代码在运行后修改', 1, `${basename(f)} 在最后一次运行之后被修改，报告不是按最后的测试代码运行的结果。重新运行并更新报告`)
}

// —— U11 测试代码中的可疑写法 ——
if (testTexts.length) {
  const productFns = new Set()
  for (const s of run?.sources || []) {
    if (!existsSync(s)) continue
    const t = stripComments(readFileSync(s, 'utf8'))
    for (const m of t.matchAll(/^[A-Za-z_][\w \t\*]*?\b([A-Za-z_]\w*)\s*\([^;{}()]*\)\s*\{/gm)) if (!/^(if|while|for|switch|return)$/.test(m[1])) productFns.add(m[1])
  }
  const callsProduct = (s) => [...productFns].find((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(s))
  const splitArgs = (s, start) => { // 从左括号后开始，按顶层逗号切分参数
    const out = []; let depth = 0, cur = '', i = start
    for (; i < s.length; i++) {
      const ch = s[i]
      if (ch === '(') depth++
      else if (ch === ')') { if (depth === 0) break; depth-- }
      else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur)
    return out.map((x) => x.trim())
  }
  for (const { f, t } of testTexts) {
    const lineOf = (idx) => t.slice(0, idx).split('\n').length
    if (/#\s*define\s+(static|private|protected|const|volatile)\b/.test(t)) add('必须处理', 'U11 改变被测代码语义', 1, `${basename(f)} 中重定义了 C 关键字（如 #define static）：这样测的不是原来的代码，改用 #include 被测 .c`)
    for (const m of t.matchAll(/\b(UT_CHECK_EQ_INT|UT_CHECK_EQ_UINT|UT_CHECK_NEAR|UT_CHECK_EQ_MEM)\s*\(/g)) {
      const a = splitArgs(t, m.index + m[0].length)
      const fn = a[1] && callsProduct(a[1])
      if (fn) add('复核', 'U11 预期调用被测函数', `${basename(f)}:${lineOf(m.index)}`, `${m[1]} 的预期值调用了被测函数 ${fn}()：预期应为常量或独立计算的结果`)
    }
    for (const m of t.matchAll(/\b(EXPECT|ASSERT)_(EQ|NE|LT|LE|GT|GE|FLOAT_EQ|DOUBLE_EQ|NEAR)\s*\(/g)) {
      const a = splitArgs(t, m.index + m[0].length)
      const f1 = a[0] && callsProduct(a[0]), f2 = a[1] && callsProduct(a[1])
      if (f1 && f2) add('复核', 'U11 预期调用被测函数', `${basename(f)}:${lineOf(m.index)}`, `${m[1]}_${m[2]} 两边都调用了被测函数（${f1}、${f2}）：预期应为常量或独立计算的结果`)
    }
    if (/\bDISABLED_\w+|GTEST_SKIP\s*\(/.test(t)) add('必须处理', 'U11 跳过用例', 1, `${basename(f)} 中有 DISABLED_ 或 GTEST_SKIP：不能跳过失败的用例`)
  }
}

// —— U12 用例修正记录要有设计依据 ——
for (const r of fixRows) {
  if (!r.cells.some((c) => ID_ONE.test(c))) continue
  const basis = col(r, '设计依据', '依据')
  if (!basis || FROM_CODE.test(basis)) add('必须处理', 'U12 修正无设计依据', r.line, `用例修正记录“${r.cells[0]}”的设计依据为“${basis || '空'}”：只有证明用例与设计不符才能修正预期`)
}

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1 }
findings.sort((a, b) => order[a.level] - order[b.level] || String(a.line).localeCompare(String(b.line), undefined, { numeric: true }))
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log('# 单元测试报告自查结果\n')
console.log(`报告：${file}`)
if (run) console.log(`运行记录：${runPath}（用例 ${run.summary ? `${run.summary.cases} 个，失败 ${run.summary.failed} 个` : '未完成'}，MC/DC ${run.mcdcMeasured ? '已测量' : '未测量'}）`)
console.log(`测试代码：${testFiles.length ? testFiles.map((f) => basename(f)).join('、') : '未找到'}；用例表 ${caseRows.length} 行，疑似缺陷 ${defRows.length} 个，未覆盖项说明 ${uncRows.length} 行，待确认问题 ${qRows.length} 个`)
for (const n of notes) console.log(`注意：${n}`)
console.log(`必须处理 ${count('必须处理')} 项，复核 ${count('复核')} 项\n`)
for (const lv of ['必须处理', '复核']) {
  const list = findings.filter((f) => f.level === lv)
  if (!list.length) continue
  console.log(`## ${lv}\n`)
  for (const f of list) console.log(`- ${typeof f.line === 'number' ? `第 ${f.line} 行` : f.line}［${f.rule}］${f.msg}`)
  console.log('')
}
if (!findings.length) console.log('没有发现需要处理的地方。')
process.exit(count('必须处理') ? 1 : 0)
