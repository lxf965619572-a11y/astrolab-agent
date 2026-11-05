#!/usr/bin/env node
// 扮演测试人员：按智能体导出的确认测试执行记录表和确认测试记录，填写“执行结果”，生成 Excel 交给智能体导入。
// 结果按答案规定的缺陷和陷阱填写（见 README 第 5 节 C1～C3），其余用例按期望结果填“与期望一致”。
//
// 用法：node evals/g3-pdus/make-exec.mjs <V1.01|V1.02> [--ws <g3-pdus 目录>] [--table <执行记录表.md>] [--record <确认测试记录.md>]
//   默认在示例工程 g3-pdus/out 下找最新的“确认测试执行记录表-*<版本>*.md”和“确认测试记录-*<版本>*.md”。
//   输出：<ws>/exec/确认测试执行记录表-PDUS-<版本>-已填写.xlsx；同时在 evals/g3-pdus/results 留一份 .md 和 .json（评分用）。
// 退出码：0 = 生成；1 = 有陷阱没能布置（智能体没有设计对应的用例，记入评分）；2 = 用法或文件错误

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ROOT, sampleWorkspace } from '../sample-ws.mjs'
import { readRecord } from '../../skills/confirmation-test/scripts/ct-data.mjs'
import { readText, tables, cell } from '../../skills/confirmation-test/scripts/md-lib.mjs'
import { exportTables } from '../../mcp/docgen/tools.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const ws = resolve(opt('--ws') || join(sampleWorkspace().dir, 'g3-pdus'))
let tableP = opt('--table'), recP = opt('--record')
const ver = argv[0]
if (!/^V1\.0[12]$/.test(ver || '')) { console.error('用法：node evals/g3-pdus/make-exec.mjs <V1.01|V1.02> [--ws <g3-pdus 目录>] [--table <表.md>] [--record <记录.md>]'); process.exit(2) }

function walk(d, re, out = []) {
  if (!existsSync(d)) return out
  for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p, re, out); else if (re.test(n)) out.push({ p, t: s.mtimeMs }) }
  return out
}
const latest = (re) => walk(join(ws, 'out'), re).sort((a, b) => b.t - a.t)[0]?.p
const vre = ver.replace('.', '\\.')
tableP = tableP || latest(new RegExp(`^确认测试执行记录表.*${vre}.*\\.md$`))
recP = recP || latest(new RegExp(`^确认测试记录.*${vre}.*\\.md$`))
if (!tableP || !existsSync(tableP)) { console.error(`找不到 ${ver} 的执行记录表（智能体应已用 ct-results.mjs --export 导出到 g3-pdus/out 下）`); process.exit(2) }
if (!recP || !existsSync(recP)) { console.error(`找不到 ${ver} 的确认测试记录`); process.exit(2) }
console.log(`执行记录表：${tableP}\n确认测试记录：${recP}`)

const R = readRecord(recP)
const byId = new Map(R.cases.map((c) => [c.id, c]))
const t = tables(readText(tableP)).find((x) => x.header.some((h) => h.includes('用例标识')) && x.header.some((h) => h.includes('实际结果')))
if (!t) { console.error('执行记录表中没有含“用例标识”“实际结果”列的表格'); process.exit(2) }
const H = t.header.map((h) => h.replace(/\s/g, ''))
const col = (name) => H.indexOf(name)
const rows = t.rows.map((r) => H.map((_, i) => (r[i] ?? '').trim()))

// 按用例分组
const groups = []
for (const r of rows) {
  const id = r[col('用例标识')]
  let g = groups.find((x) => x.id === id)
  if (!g) { g = { id, rows: [], c: byId.get(id) }; groups.push(g) }
  g.rows.push(r)
}
const text = (g) => [g.c?.title, g.c?.purpose, ...g.rows.map((r) => `${r[col('操作步骤')]} ${r[col('期望结果')]}`)].join(' ')
const has = (g, id) => (g.c?.reqs || []).some((x) => x.includes(id))

const armed = { C1_nonconsec: null, C1_boundary: [], C1prime_response: null, C1_notexec: null, C2_emptyActual: null }
const problems = []
const V1 = ver === 'V1.01'
const date0 = V1 ? [2026, 6, 10] : [2026, 8, 4]
const fmt = (k) => { const d = new Date(Date.UTC(date0[0], date0[1] - 1, date0[2] + k)); return d.toISOString().slice(0, 10) }

let notExecPick = null, emptyPick = null
if (V1) {
  notExecPick = groups.find((g) => has(g, 'PREQ1.1')) || groups.find((g) => has(g, 'FREQ011') && !/AD\s*故障|无效|0xFFFF/i.test(text(g)))
  emptyPick = groups.find((g) => has(g, 'FREQ004'))
}

groups.forEach((g, k) => {
  const day = Math.floor(k / 5)
  const exec = { 执行人: '测试员甲（虚构）', 执行日期: fmt(day), 复核人: '测试员乙（虚构）', 复核日期: fmt(day + 1), 备注: '' }
  let result = '通过', problem = ''
  const actual = g.rows.map((r) => `与期望一致：${r[col('期望结果')].replace(/。$/, '')}`)
  const tx = text(g)
  if (V1 && has(g, 'FREQ012') && /间断|不连续|恢复正常|中间.*(正常|未超)|未超限.*再|再次超限|累计|交替/.test(tx)) {
    let idx = g.rows.map((r, i) => (/不断开|保持接通|仍接通|仍为接通|未断开|不应断开|不动作|不置/.test(r[col('期望结果')]) ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) idx = [g.rows.length - 1]
    for (const i of idx) actual[i] = '通道断开，过流标志置位，断电计数加 1'
    result = '不通过'; problem = 'PDUS-V1.01BUG-001'
    armed.C1_nonconsec = g.id
    problems.push([problem, g.id, '超限 2 次、恢复正常 1 次、再超限后，通道在累计第 3 次超限时断开（期望连续 3 次才断开）', '严重问题', '程序问题'])
  }
  if (V1 && has(g, 'FREQ005')) {
    g.rows.forEach((r, i) => {
      const op = r[col('操作步骤')], ex = r[col('期望结果')]
      const edge = /0\.50\s*A|5\.00\s*A|0x00\s*0x32|0x01\s*0xF4|0x0032|0x01F4|00\s32|01\sF4|阈值\s*50\b|阈值\s*500\b|=\s*50\b|=\s*500\b|（50）|（500）/i.test(op)
      const out = /0\.49|5\.01|0x31\b|0x01\s*0xF5|0x01F5|\b49\b|\b501\b/i.test(op)
      // 期望是“接受”：写法多样（“接收”“阈值为 0.50 A”“第 17～18 字节为 00 32，第 14 字节加 1”），所以只排除“拒收”的写法
      const reject = /拒收|拒绝|不接收|错误计数.{0,3}加|第\s*15\s*字节.{0,3}加|仍为|不变|保持/.test(ex)
      if (edge && !out && !reject) {
        actual[i] = '拒收：遥控错误计数加 1，遥测中该通道阈值不变'
        result = '不通过'; problem = 'PDUS-V1.01BUG-002'
        if (!armed.C1_boundary.includes(g.id)) armed.C1_boundary.push(g.id)
      }
    })
    if (problem === 'PDUS-V1.01BUG-002' && !problems.some((p) => p[0] === problem)) problems.push([problem, g.id, '注入 0.50 A、5.00 A 被拒收，遥控错误计数加 1', '一般问题', '程序问题'])
  }
  if (!problem && (has(g, 'PREQ3.2') || (has(g, 'FREQ012') && /响应时间/.test(tx)))) {
    const i = g.rows.findIndex((r) => /ms|毫秒/.test(r[col('期望结果')]))
    const j = i >= 0 ? i : g.rows.length - 1
    actual[j] = V1 ? '实测 215 ms' : '实测 165 ms'
    if (V1) armed.C1prime_response = g.id
  }
  if (V1 && g === notExecPick && !problem) {
    result = '未执行'; for (let i = 0; i < actual.length; i++) actual[i] = ''
    exec.备注 = '程控电子负载故障，本轮未执行'; exec.执行人 = ''; exec.执行日期 = ''; exec.复核人 = ''; exec.复核日期 = ''
    armed.C1_notexec = g.id
  }
  if (V1 && g === emptyPick && !problem && g !== notExecPick) {
    actual[0] = ''
    armed.C2_emptyActual = g.id
  }
  g.rows.forEach((r, i) => {
    r[col('实际结果')] = actual[i]
    const first = i === 0
    if (col('测试结论') >= 0) r[col('测试结论')] = first ? result : ''
    if (col('问题报告单') >= 0) r[col('问题报告单')] = first ? problem : ''
    for (const k of ['执行人', '执行日期', '复核人', '复核日期', '备注']) if (col(k) >= 0) r[col(k)] = first ? exec[k] : ''
  })
})

const L = [`# PDUS ${ver} 确认测试执行记录（测试人员填写）`, '', `执行地点：PDU 软平台、PDU 电性件；执行时间：${fmt(0)} 起。`, '', '## 执行记录', '',
  `| ${t.header.join(' | ')} |`, `|${t.header.map(() => '---').join('|')}|`,
  ...groups.flatMap((g) => g.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)), '']
if (problems.length) {
  L.push('## 问题记录', '', '| 问题编号 | 用例标识 | 现象 | 严重等级 | 问题类别 |', '|---|---|---|---|---|', ...problems.map((p) => `| ${p.map(cell).join(' | ')} |`), '')
}
const md = L.join('\n')
mkdirSync(join(ws, 'exec'), { recursive: true })
const xlsx = join(ws, 'exec', `确认测试执行记录表-PDUS-${ver}-已填写.xlsx`)
const r = await exportTables({ markdown: md, output: xlsx, merge: false, overwrite: true })
if (r.isError) { console.error(r.content[0].text); process.exit(2) }
const resDir = join(ROOT, 'evals', 'g3-pdus', 'results')
mkdirSync(resDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
writeFileSync(join(resDir, `${stamp}-执行记录-${ver}.md`), md, 'utf8')
writeFileSync(join(resDir, `${stamp}-执行记录-${ver}.json`), JSON.stringify({ ver, table: tableP, record: recP, cases: groups.length, armed }, null, 2), 'utf8')
console.log(r.content[0].text)
console.log(`用例 ${groups.length} 个。布置的陷阱：${JSON.stringify(armed)}`)
const missing = V1 ? Object.entries({ 间断超限用例: armed.C1_nonconsec, 阈值边界用例: armed.C1_boundary.length, 响应时间用例: armed.C1prime_response, 未执行用例: armed.C1_notexec, 实际结果为空用例: armed.C2_emptyActual }).filter(([, v]) => !v).map(([k]) => k) : []
if (missing.length) { console.log(`没能布置：${missing.join('、')}（智能体没有设计对应的用例，或用例写法脚本识别不了；先人工看一下用例，确实没有的记入确认测试设计的评分）`); process.exit(1) }
