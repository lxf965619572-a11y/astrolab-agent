#!/usr/bin/env node
// 确认测试执行记录表的导出和导入。实际结果只经过本脚本写进确认测试记录，智能体不手填。
//
// 导出（给测试人员现场填写，每个步骤一行）：
//   node ct-results.mjs --export <确认测试记录.md> --out <执行记录表.md>
//   然后用 mcp__docgen__export_xlsx 转成 Excel 交给测试人员。
// 导入（测试人员填好后）：
//   node ct-results.mjs --import <确认测试记录.md> --from <填好的执行记录表.md 或 .csv>
//   Excel 先用 mcp__docreader__read_document 读出并原样保存为 .md（不改内容）。
//   导入前把记录备份为 <记录>.bak；只写实际结果、测试结论、问题报告单、执行人、执行日期、复核人、复核日期、备注，
//   并在第 1 节写“执行记录来源”。
// 统计（第 10 节按记录内容重写，导入后自动执行）：
//   node ct-results.mjs --stats <确认测试记录.md>
// 退出码：0 = 完成；1 = 有对不上的行（列出）；2 = 用法或文件错误

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readRecord, readSRS, locate, computeStats, RESULT } from './ct-data.mjs'
import { readText, tables, cell } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const exp = opt('--export'), imp = opt('--import'), out = opt('--out'), from = opt('--from'), statsP = opt('--stats')
const COLS = ['用例标识', '步骤序号', '操作步骤', '期望结果', '实际结果', '测试结论', '问题报告单', '执行人', '执行日期', '复核人', '复核日期', '备注']

if (exp && out) {
  if (!existsSync(exp)) { console.error(`找不到：${exp}`); process.exit(2) }
  const R = readRecord(exp)
  const L = [`# ${R.info['软件名称'] || ''}（${R.info['被测版本'] || ''}）确认测试执行记录表`, '',
    '填写说明：每个步骤一行。“实际结果”写观察到的现象和数值，与期望结果一致也要写出实际值；“测试结论”填 通过 / 不通过 / 未执行（每个用例在第一个步骤行填写即可）；不通过的填问题报告单编号；未执行的在备注写原因。不要改动前四列。', '',
    '## 执行记录', '', `| ${COLS.join(' | ')} |`, `|${COLS.map(() => '---').join('|')}|`]
  for (const c of R.cases) {
    c.steps.forEach((s, k) => L.push(`| ${cell(c.id)} | ${cell(s.no)} | ${cell(s.op)} | ${cell(s.expect)} | ${cell(s.actual)} | ${k === 0 ? cell(c.result) : ''} | ${k === 0 ? cell(c.problem) : ''} | ${k === 0 ? cell(c.f['执行人'] || '') : ''} | ${k === 0 ? cell(c.f['执行日期'] || '') : ''} | ${k === 0 ? cell(c.f['复核人'] || '') : ''} | ${k === 0 ? cell(c.f['复核日期'] || '') : ''} | |`))
  }
  writeFileSync(out, L.join('\n') + '\n', 'utf8')
  console.log(`已导出 ${out}：用例 ${R.cases.length} 个，步骤 ${R.cases.reduce((s, c) => s + c.steps.length, 0)} 行。用 mcp__docgen__export_xlsx 转成 Excel 交给测试人员。`)
  process.exit(0)
}

/** 按记录内容重写第 10 节统计表 */
function writeStats(path) {
  const R = readRecord(path)
  const srsP = locate(path, R.info['需求规格说明'])
  const st = computeStats(R, srsP ? readSRS(srsP) : null)
  const lines = R.md.split('\n')
  const s10 = R.S.find((x) => x.num === '10')
  if (!s10) { console.log('记录没有第 10 节，统计未更新'); return }
  const body = ['', '| 项目 | 数量 |', '|---|---|', ...Object.entries(st).map(([k, n]) => `| ${k} | ${n === null ? '【待补充】' : n} |`), '']
  lines.splice(s10.start + 1, s10.end - s10.start - 1, ...body)
  writeFileSync(path, lines.join('\n'), 'utf8')
  console.log(`已更新 ${path} 第 10 节统计${srsP ? '' : '（找不到需求规格说明，需求相关的项为【待补充】）'}。`)
}
if (statsP) { if (!existsSync(statsP)) { console.error(`找不到：${statsP}`); process.exit(2) } writeStats(statsP); process.exit(0) }

if (!(imp && from)) { console.error('用法：node ct-results.mjs --export <记录.md> --out <执行记录表.md> | --import <记录.md> --from <填好的表.md|.csv> | --stats <记录.md>'); process.exit(2) }
for (const p of [imp, from]) if (!existsSync(p)) { console.error(`找不到：${p}`); process.exit(2) }

// 读填好的表
let rows = []
if (/\.csv$/i.test(from)) {
  const lines = readFileSync(from, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const parse = (l) => { const o = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch } else if (ch === '"') q = true; else if (ch === ',') { o.push(cur); cur = '' } else cur += ch } o.push(cur); return o.map((s) => s.trim()) }
  const head = parse(lines.shift())
  rows = lines.map((l) => Object.fromEntries(parse(l).map((v, i) => [head[i], v])))
} else {
  const t = tables(readText(from)).find((x) => x.header.some((h) => h.includes('用例标识')) && x.header.some((h) => h.includes('实际结果')))
  if (!t) { console.error(`${from} 中没有含“用例标识”“实际结果”列的表格`); process.exit(2) }
  rows = t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h.replace(/\s/g, ''), (r[i] ?? '').replace(/<br\s*\/?>/g, ' ').trim()])))
}
const get = (r, k) => (r[k] ?? '').trim()

const R = readRecord(imp)
const byCase = new Map()
const problems = []
for (const r of rows) {
  const id = get(r, '用例标识')
  if (!id) continue
  if (!R.cases.some((c) => c.id === id)) { problems.push(`执行记录表中的用例 ${id} 不在确认测试记录中`); continue }
  if (!byCase.has(id)) byCase.set(id, [])
  byCase.get(id).push(r)
}

let md = R.md.split('\n')
let updated = 0
// 从后往前改，行号不乱
for (const c of [...R.cases].reverse()) {
  const rs = byCase.get(c.id)
  if (!rs) continue
  // 用例的行范围
  const start = c.line - 1
  let end = md.length
  for (let k = start + 1; k < md.length; k++) if (/^#{1,3}\s/.test(md[k])) { end = k; break }
  const pick = (k) => rs.map((r) => get(r, k)).find((v) => v) || ''
  const result = pick('测试结论')
  if (result && !RESULT.test(result)) problems.push(`${c.id} 的测试结论“${result}”不是 通过/不通过/未执行，未导入结论`)
  for (let k = start; k < end; k++) {
    const line = md[k]
    const row = /^\|\s*([^|]+?)\s*\|/.exec(line)
    if (row && /^\d+$/.test(row[1])) {
      const step = rs.find((r) => get(r, '步骤序号') === row[1])
      if (step) {
        const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
        while (cells.length < 4) cells.push('')
        cells[3] = ` ${cell(get(step, '实际结果'))} `
        md[k] = `|${cells.join('|')}|`
      }
    }
    const fm = /^(\s*[-*]\s*)(测试结论|问题报告单|执行人|执行日期|复核人|复核日期|备注)([：:])(.*)$/.exec(line)
    if (fm) {
      const v = fm[2] === '测试结论' ? (RESULT.test(result) ? result : fm[4].trim()) : (pick(fm[2]) || fm[4].trim())
      md[k] = `${fm[1]}${fm[2]}：${v}`
    }
  }
  const stepNos = new Set(c.steps.map((s) => s.no))
  for (const r of rs) if (!stepNos.has(get(r, '步骤序号'))) problems.push(`${c.id} 的步骤 ${get(r, '步骤序号')} 在记录中不存在`)
  updated++
}
// 执行记录来源
const src = `${basename(from)}（ct-results.mjs 导入，${new Date().toISOString().slice(0, 10)}）`
const fi = md.findIndex((l) => /^\s*[-*]\s*执行记录来源[：:]/.test(l))
if (fi >= 0) md[fi] = `- 执行记录来源：${src}`
else {
  const s1 = md.findIndex((l) => /^##\s+1\s/.test(l))
  let k = s1 + 1
  while (k < md.length && !/^##\s/.test(md[k])) k++
  while (k > s1 + 1 && !md[k - 1].trim()) k--
  md.splice(k, 0, `- 执行记录来源：${src}`)
}
copyFileSync(imp, `${imp}.bak`)
writeFileSync(imp, md.join('\n'), 'utf8')
console.log(`已导入 ${updated} 个用例的执行结果到 ${imp}（原文件备份为 ${basename(imp)}.bak）。`)
const notRun = R.cases.filter((c) => !byCase.has(c.id)).map((c) => c.id)
if (notRun.length) console.log(`执行记录表中没有的用例 ${notRun.length} 个：${notRun.slice(0, 20).join('、')}${notRun.length > 20 ? '…' : ''}`)
writeStats(imp)
for (const p of problems) console.log(`- ${p}`)
process.exit(problems.length ? 1 : 0)
