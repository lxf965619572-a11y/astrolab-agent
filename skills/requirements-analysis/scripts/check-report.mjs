#!/usr/bin/env node
// 需求分析报告自查脚本：用固定规则扫描报告，列出需要人（或智能体）复核的地方。
// 只读，不修改报告。规则是启发式的，列出的是“疑似”问题，逐条判断后改正或说明保留理由。
//
// 用法：node check-report.mjs <需求分析报告.md>
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('用法：node check-report.mjs <需求分析报告.md>'); process.exit(2) }
let text
try { text = readFileSync(file, 'utf8').replace(/^﻿/, '') } catch (e) { console.error(`读不到文件：${file}（${e.message}）`); process.exit(2) }
const lines = text.split(/\r?\n/)

// —— 按章节切分（按标题文字识别，不依赖章节号）——
const heads = []
lines.forEach((l, i) => { const m = /^(#{2,4})\s+(.*)$/.exec(l); if (m) heads.push({ level: m[1].length, title: m[2], line: i }) })
function section(pattern, level = 2) {
  const h = heads.find((x) => x.level === level && pattern.test(x.title))
  if (!h) return null
  const next = heads.find((x) => x.line > h.line && x.level <= level)
  return { title: h.title, start: h.line, end: next ? next.line : lines.length }
}
function splitRow(line) {
  let s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
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
// 取某一节中的表格行：返回 [{ line, cells, header }]
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

const findings = []
const seenFinding = new Set()
const add = (level, rule, line, msg) => {
  const key = `${line}|${msg}`
  if (seenFinding.has(key)) return
  seenFinding.add(key)
  findings.push({ level, rule, line, msg })
}
const PENDING = /【待确认】|【待补充】|【待定】/

const secClauses = section(/上级条款/)
const secReqs = section(/需求条目/)
const secTrace = section(/追溯/)
const secQ = section(/待确认问题/)
const secStat = section(/统计/)
// 没有“需求条目”表格章节时按 SRS 等普通文档处理：只查 R1（自行取舍）和 R5（依据可疑）
const textMode = !secReqs
if (textMode) {
  console.log('（未找到“需求条目”章节，按普通文档检查：只查自行取舍措辞和可疑依据）\n')
} else {
  for (const [name, s] of [['上级条款摘录', secClauses], ['追溯矩阵', secTrace], ['待确认问题清单', secQ]]) {
    if (!s) add('必须处理', '结构', 0, `没有找到“${name}”一章（按标题文字查找）`)
  }
}
if (textMode) {
  lines.forEach((l, i) => {
    const m = /取较严|取较宽|取严值|按较严|按较宽/.exec(l)
    if (m) add('必须处理', 'R1 自行裁决矛盾', i + 1, `“${m[0]}”：输入之间有矛盾时应写【待确认】并引用两处原文，不能自行取舍`)
  })
}

const clauseText = rows(secClauses).map((r) => r.cells.join(' ')).join('\n')
const inputText = clauseText + '\n' + lines.slice(0, secClauses ? secClauses.start : 0).join('\n')
const reqRows = rows(secReqs).filter((r) => /^[A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{2,4}$/.test(r.cells[0]))
const qRows = rows(secQ).filter((r) => /^Q-\d+/.test(r.cells[0]))
const qMap = new Map(qRows.map((r) => [r.cells[0], r]))

// R1 矛盾指标自行取舍
const PICK = /取较严|取较宽|取严值|按较严|按较宽|取其中|以[^，。；]{1,20}为准|按[^，。；]{1,12}执行较/
for (const r of reqRows) {
  const all = r.cells.join(' ')
  const m = PICK.exec(all)
  if (m) add('必须处理', 'R1 自行裁决矛盾', r.line, `${r.cells[0]} 含“${m[0]}”：输入之间有矛盾时需求应写【待确认】并引用两处原文，不能自行取舍`)
}

// R2 引用了待确认问题，但需求描述中没有【待确认】
for (const r of reqRows) {
  const desc = col(r, '需求描述', '描述')
  const src = col(r, '来源')
  const qs = [...new Set((src.match(/Q-\d+/g) || []))]
  if (!qs.length || PENDING.test(desc)) continue
  const qText = qs.map((q) => qMap.get(q)?.cells.slice(2, 5).join(' ') || '').join(' ')
  const unspecified = /未规定|未给|未明确|未说明|未定义|无依据|不明确|无判据|未提供/.test(qText)
  add(unspecified ? '必须处理' : '复核', 'R2 问题未关闭却已给答案', r.line,
    `${r.cells[0]} 引用了 ${qs.join('、')}${unspecified ? '（问题写明“未规定”）' : ''}，但需求描述中没有【待确认】。检查描述里的处理方式、数值、范围是不是自己定的：「${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}」`)
}

// R3 派生需求既没有【待确认】也没有关联问题
for (const r of reqRows) {
  const desc = col(r, '需求描述', '描述')
  const src = col(r, '来源')
  if (/派生/.test(src) && !/Q-\d+/.test(src) && !PENDING.test(desc)) {
    add('复核', 'R3 派生需求无依据', r.line, `${r.cells[0]} 是派生需求，既没有关联待确认问题也没有【待确认】：「${desc.slice(0, 60)}」。确认内容确实可由任务书推出，否则关联问题并改写`)
  }
}

// R4 需求描述中的数值找不到出处
const NUM = /(\d+(?:\.\d+)?)\s*(ms|μs|us|s|秒|毫秒|分钟|%|KB|MB|GB|bps|kbps|Mbps|字节|位|路|次|℃|V|mA|Hz|kHz|MHz)/g
for (const r of reqRows) {
  const desc = col(r, '需求描述', '描述')
  for (const m of desc.matchAll(NUM)) {
    const num = m[1]
    const re = new RegExp(`(^|[^\\d.])${num.replace('.', '\\.')}(?![\\d])`)
    if (!re.test(inputText)) add('复核', 'R4 数值无出处', r.line, `${r.cells[0]} 中的“${m[0]}”在上级条款摘录里找不到，确认能由上级条款算出，否则改为【待确认】`)
  }
}

// R5 依据可疑：输入材料里没有的“规定”
const BASIS = /按部门[^，。；|]{0,20}(规范|规定|要求|执行)|部门(文档|软件|配置管理)[^，。；|]{0,10}(规范|规定)|按\s*GJB\s*\d+[A-Z]?[^，。；|]{0,12}(要求|规定)|GJB\s*5000[AB]?[^，。；|]{0,12}(要求|补入|规定)|Visio|按部门正式模板|按惯例|按行业惯例|通常做法/g
const stdInInputs = new Set((clauseText.match(/GJB\s*\d+[A-Z]?/g) || []).map((s) => s.replace(/\s/g, '')))
lines.forEach((l, i) => {
  for (const m of l.matchAll(BASIS)) {
    const std = (m[0].match(/GJB\s*\d+[A-Z]?/) || [''])[0].replace(/\s/g, '')
    if (std && stdInInputs.has(std) && !/5000/.test(std)) continue
    add('必须处理', 'R5 依据可疑', i + 1, `“${m[0]}”：这条规定是否出现在输入材料中？没有的话删去，或改为待确认问题`)
  }
})

// R6 覆盖状态偏乐观：判为“已覆盖”但说明里还挂着待确认问题
for (const r of rows(secTrace)) {
  const status = col(r, '覆盖')
  const note = col(r, '说明')
  if (status === '已覆盖' && (/Q-\d+/.test(note) || PENDING.test(r.cells.join(' '))) && !/不在本次范围|不适用/.test(note)) {
    add('复核', 'R6 覆盖状态', r.line, `${r.cells[0]} 判为“已覆盖”，但说明中还有待确认问题（${note.slice(0, 40)}）。要求在现有材料下不能完全实现时应为“部分覆盖”`)
  }
}

// R10 上级条款是模糊表述，需求却写得很具体（且没有挂待确认问题）
const VAGUE = /尽快|及时|适当|合理|必要时|视情况|自主恢复|不宜|足够|具备[^，。]{0,10}能力|一般|尽可能|尽量/
const clauseMap = new Map(rows(secClauses).map((r) => [r.cells[0], r.cells.slice(1).join(' ')]))
const r2Flagged = new Set(findings.filter((f) => f.rule.startsWith('R2')).map((f) => f.line))
for (const r of reqRows) {
  if (r2Flagged.has(r.line)) continue
  const desc = col(r, '需求描述', '描述')
  const src = col(r, '来源')
  if (PENDING.test(desc)) continue
  const vague = (src.match(/[A-Z]+-[\d.]+-\d+/g) || []).map((id) => [id, VAGUE.exec(clauseMap.get(id) || '')]).filter(([, m]) => m)
  if (vague.length) {
    add('复核', 'R10 模糊条款被写具体', r.line, `${r.cells[0]} 的来源 ${vague.map(([id, m]) => `${id}（“${m[0]}”）`).join('、')} 是模糊表述，需求描述却没有【待确认】：「${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}」。具体内容若是自己定的，改为【待确认】并关联问题`)
  }
}

// R11 1553B 标准知识核对（与 references/mil-std-1553b.md 一致）
// 只核对几项容易记错、且一旦写错就会误导评审的数值
const MODE_TR = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 16: 1, 17: 0, 18: 1, 19: 1, 20: 0, 21: 0 }
const REF = '见 references/mil-std-1553b.md'
lines.forEach((l, i) => {
  if (!/1553|方式码|状态字|子地址/.test(l)) return
  // 响应时间范围
  for (const m of l.matchAll(/(\d+(?:\.\d+)?)\s*[～~\-–至到]\s*(\d+(?:\.\d+)?)\s*(μs|us|微秒)/g)) {
    if (!/响应|窗口|应答/.test(l)) continue
    if (Number(m[1]) !== 4 || Number(m[2]) !== 12) add('必须处理', 'R11 1553B 标准核对', i + 1, `写了“${m[0]}”：MIL-STD-1553B 规定的 RT 响应时间为 4～12 μs（${REF}）`)
  }
  // 方式码 T/R 位
  if (/T\/R/.test(l)) {
    const asserted = [...l.matchAll(/T\/R\s*位?\s*(?:应)?为\s*([01])/g)].map((m) => Number(m[1]))
    const codes = [...new Set([...l.matchAll(/方式码\s*(\d{1,2})(?:\s*[、和与,，]\s*(\d{1,2}))?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean).map(Number))]
    for (const tr of asserted) for (const c of codes) {
      if (c in MODE_TR && MODE_TR[c] !== tr) add('必须处理', 'R11 1553B 标准核对', i + 1, `称方式码 ${c} 的 T/R 位为 ${tr}，标准规定为 ${MODE_TR[c]}（${REF}）。若是在指出输入材料的错误，先核对参考文件再下结论`)
    }
  }
  // 每条消息数据字上限
  for (const m of l.matchAll(/(?:上限|最多|最大)[^。|]{0,8}?(\d+)\s*个?数据字/g)) {
    if (Number(m[1]) !== 32) add('必须处理', 'R11 1553B 标准核对', i + 1, `写了每条消息“${m[0]}”：MIL-STD-1553B 每条消息最多 32 个数据字（${REF}）`)
  }
  // 广播地址
  for (const m of l.matchAll(/广播地址\s*(?:为|是)?\s*(\d+)/g)) {
    if (Number(m[1]) !== 31) add('必须处理', 'R11 1553B 标准核对', i + 1, `写了“${m[0]}”：广播地址为 31（${REF}）`)
  }
  // 其他声称“标准规定”的句子：提示核对
  if (/(MIL-STD-1553B?|1553B)[^。|]{0,30}(规定|要求|保留|约定)/.test(l) && !/按\s*MIL-STD-1553B\s*规定的位序/.test(l)) {
    add('提示', 'R11 1553B 标准核对', i + 1, `引用了 1553B 标准规定，确认内容在 references/mil-std-1553b.md 或输入材料中能找到`)
  }
})

// R7 一条需求多个“应”
for (const r of reqRows) {
  const desc = col(r, '需求描述', '描述')
  const n = (desc.match(/应/g) || []).length
  if (n >= 3) add('提示', 'R7 一条多事', r.line, `${r.cells[0]} 含 ${n} 个“应”，考虑拆分`)
}

// R8 统计与正文一致
if (secStat) {
  const stat = lines.slice(secStat.start, secStat.end).join('\n')
  const num = (re) => { const m = re.exec(stat); return m ? Number(m[1]) : null }
  const nReq = num(/需求条目总数\s*\|\s*(\d+)/)
  const nQ = num(/待确认问题总数\s*\|\s*(\d+)/)
  if (nReq !== null && nReq !== reqRows.length) add('必须处理', 'R8 统计不一致', secStat.start + 1, `统计写需求条目 ${nReq} 条，正文实际 ${reqRows.length} 条`)
  if (nQ !== null && nQ !== qRows.length) add('必须处理', 'R8 统计不一致', secStat.start + 1, `统计写待确认问题 ${nQ} 个，正文实际 ${qRows.length} 个`)
}

// R9 需求或追溯中引用了不存在的问题编号
const qIds = new Set(qRows.map((r) => r.cells[0]))
const seenMissing = new Set()
lines.forEach((l, i) => {
  if (secQ && i >= secQ.start && i < secQ.end) return
  for (const m of l.matchAll(/Q-\d{3}/g)) if (!qIds.has(m[0]) && !seenMissing.has(m[0])) { seenMissing.add(m[0]); add('必须处理', 'R9 问题编号不存在', i + 1, `引用了 ${m[0]}，但待确认问题清单中没有`) }
})

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1, 提示: 2 }
findings.sort((a, b) => order[a.level] - order[b.level] || a.line - b.line)
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log(`# 需求分析报告自查结果\n`)
console.log(`文件：${file}`)
console.log(`需求条目 ${reqRows.length} 条，待确认问题 ${qRows.length} 个，上级条款 ${rows(secClauses).length} 条`)
console.log(`必须处理 ${count('必须处理')} 项，复核 ${count('复核')} 项，提示 ${count('提示')} 项\n`)
for (const lv of ['必须处理', '复核', '提示']) {
  const list = findings.filter((f) => f.level === lv)
  if (!list.length) continue
  console.log(`## ${lv}\n`)
  for (const f of list) console.log(`- 第 ${f.line} 行［${f.rule}］${f.msg}`)
  console.log('')
}
if (!findings.length) console.log('没有发现需要复核的地方。')
process.exit(count('必须处理') ? 1 : 0)
