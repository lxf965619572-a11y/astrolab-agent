#!/usr/bin/env node
// 概要设计说明自查脚本：按固定规则检查需求摘录和分配的完整性、模块接口、时序分析、中断和共享数据、
// 资源余量、数值出处、编号引用、流程图。只读，不修改任何文件。“必须处理”项要改正，“复核”项逐条判断。
//
// 用法：node check-hld.mjs <概要设计说明.md> [--srs <软件需求规格说明 .docx/.md/.pdf>]
//   --srs：对照 SRS 原文件，核对第 3.1 节是否摘录了全部需求
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
const srsFile = opt('--srs')
const file = args[0]
if (!file) { console.error('用法：node check-hld.mjs <概要设计说明.md> [--srs <软件需求规格说明>]'); process.exit(2) }
let text
try { text = readFileSync(file, 'utf8').replace(/^﻿/, '') } catch (e) { console.error(`读不到文件：${file}（${e.message}）`); process.exit(2) }
const lines = text.split(/\r?\n/)
const notes = []

// —— 工程中的共用库：流程图解析器、文档读取（找不到时跳过相应检查）——
const here = dirname(fileURLToPath(import.meta.url))
function findLib(rel) {
  const cands = []
  if (process.env.ASTROLAB_ROOT) cands.push(join(process.env.ASTROLAB_ROOT, rel))
  let d = here
  for (let i = 0; i < 8; i++) { cands.push(join(d, rel)); d = dirname(d) }
  return cands.find((p) => existsSync(p)) || null
}
let parseFlowchart = null
{
  const hit = findLib(join('mcp', 'docgen', 'lib', 'flowchart.mjs'))
  if (hit) { try { ({ parseFlowchart } = await import(pathToFileURL(hit).href)) } catch { /* 忽略 */ } }
  if (!parseFlowchart) notes.push('没有找到流程图解析器（mcp/docgen/lib/flowchart.mjs），流程图语法未检查')
}

// —— 需求标识 ——
const REQ_RE = /\b[A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{3}\b/g
// 展开“XXX-FUN-021～025”“XXX-FUN-021～XXX-FUN-025”这类范围写法
function reqIds(s) {
  const out = new Set()
  const t = String(s || '')
  for (const m of t.matchAll(/\b([A-Z][A-Z0-9]*-[A-Z]{2,4}-)(\d{3})\s*[～~–—至到]\s*(?:\1)?(\d{3})\b/g)) {
    const a = Number(m[2]), b = Number(m[3])
    if (b >= a && b - a <= 50) for (let k = a; k <= b; k++) out.add(m[1] + String(k).padStart(3, '0'))
  }
  for (const m of t.matchAll(REQ_RE)) out.add(m[0])
  return out
}

// —— SRS 原文件 ——
let srsIds = null
if (srsFile) {
  let srsText = null
  const ext = extname(srsFile).toLowerCase()
  try {
    if (['.md', '.txt'].includes(ext)) srsText = readFileSync(srsFile, 'utf8')
    else if (['.docx', '.docm'].includes(ext)) {
      const lib = findLib(join('mcp', 'docreader', 'lib', 'docx.mjs'))
      if (!lib) throw new Error('没有找到 mcp/docreader/lib/docx.mjs，无法读取 .docx；可以改用 SRS 的 .md 版本')
      const { docxToMarkdown } = await import(pathToFileURL(lib).href)
      srsText = docxToMarkdown(readFileSync(srsFile)).markdown
    } else if (ext === '.pdf') {
      const lib = findLib(join('mcp', 'docreader', 'lib', 'pdf.mjs'))
      if (!lib) throw new Error('没有找到 mcp/docreader/lib/pdf.mjs，无法读取 .pdf')
      const { pdfToMarkdown } = await import(pathToFileURL(lib).href)
      srsText = (await pdfToMarkdown(readFileSync(srsFile), {})).markdown
    } else throw new Error(`不支持的 SRS 文件类型 ${ext}（支持 .docx .md .txt .pdf）`)
  } catch (e) { console.error(`读不到 SRS 文件：${srsFile}（${e.message}）`); process.exit(2) }
  // 只取作为需求条目出现的标识：段首（可带加粗）或表格第一列；正文中引用的其他文件编号不算
  // 引用文档表（表头有“名称”“版本”）和“文件编号”行中的编号不是需求
  srsIds = new Set()
  let tblHeader = null
  for (const l of srsText.split(/\r?\n/)) {
    if (l.trim().startsWith('|')) {
      if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
      if (tblHeader === null) { tblHeader = l; continue }
      if (/名称|版本|文件编号/.test(tblHeader)) continue
    } else tblHeader = null
    if (/文件编号|文档编号/.test(l)) continue
    const m = /^\s*(?:[-*]\s*)?(?:\*\*|__)?\s*([A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{3})\b/.exec(l) || /^\s*\|\s*(?:\*\*)?([A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{3})\b/.exec(l)
    if (m) srsIds.add(m[1])
  }
  if (!srsIds.size) notes.push(`SRS 文件 ${srsFile} 中没有识别到需求标识（段首或表格第一列的“XXX-FUN-001”形式），未核对需求摘录`)
}

// —— 文档解析 ——
const heads = []
let inFence = false
lines.forEach((l, i) => {
  if (/^\s*```/.test(l)) inFence = !inFence
  if (inFence) return
  const m = /^(#{2,5})\s+(.*)$/.exec(l)
  if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i })
})
function section(pattern, level = 2, within = null) {
  const h = heads.find((x) => x.level === level && pattern.test(x.title) && (!within || (x.line > within.start && x.line < within.end)))
  if (!h) return null
  const next = heads.find((x) => x.line > h.line && x.level <= level)
  return { title: h.title, start: h.line, end: next ? next.line : lines.length }
}
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
function rows(sec, headerHas = null) {
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
  return headerHas ? out.filter((r) => r.header.some((h) => h.includes(headerHas))) : out
}
const col = (r, ...names) => { for (const n of names) { const k = r.header.findIndex((h) => h.includes(n)); if (k >= 0) return r.cells[k] ?? '' } return '' }
const secText = (sec) => (sec ? lines.slice(sec.start, sec.end).join('\n') : '')
const inSec = (sec, i) => sec && i >= sec.start && i < sec.end
const empty = (s) => !s || /^(无|—|-|－|\/|不适用)$/.test(String(s).trim())

const findings = []
const seen = new Set()
const add = (level, rule, line, msg) => {
  const key = `${rule}|${line}|${msg}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ level, rule, line, msg })
}

// —— H0 章节 ——
const REQUIRED = [['设计依据', /设计依据/], ['CSCI 级设计决策', /设计决策/], ['体系结构设计', /体系结构|软件结构/], ['执行方案', /执行方案|执行概念/],
  ['接口设计', /接口设计/], ['数据设计', /数据设计/], ['资源分配和余量', /资源/], ['可靠性和安全性设计', /可靠性|安全性/],
  ['需求追溯', /追溯|可追踪/], ['待确认问题', /待确认/], ['统计', /统计/]]
const S = {}
for (const [name, re] of REQUIRED) {
  S[name] = section(re)
  if (!S[name]) add('必须处理', 'H0 缺少章节', 1, `没有“${name}”一章。没有内容也要保留章节并写“无”`)
}
const secBasis = S['设计依据']
const secReq = secBasis ? (section(/需求/, 3, secBasis) || secBasis) : null
const secHw = secBasis ? section(/硬件|接口|约束/, 3, secBasis) : null
const secExec = S['执行方案']
const secIrq = secExec ? section(/中断/, 3, secExec) : null
const secTa = secExec ? section(/时序/, 3, secExec) : null
const secShared = secExec ? section(/共享/, 3, secExec) : null
const secSched = secExec ? section(/主循环|调度|任务/, 3, secExec) : null
const secIf = S['接口设计']
const secExt = secIf ? section(/外部/, 3, secIf) : null

// 设计依据中的需求和条款
const basisReqRows = rows(secReq).filter((r) => reqIds(r.cells[0]).size)
const basisReqs = new Map()
for (const r of basisReqRows) for (const id of reqIds(r.cells[0])) basisReqs.set(id, r)
const clauseRows = rows(secHw).filter((r) => r.cells[0] && !reqIds(r.cells[0]).size)
const clauseId = (r) => (/[A-Za-z][\w]*-[\d.]+[\w.-]*/.exec(r.cells[0].replace(/`/g, '')) || [r.cells[0]])[0]
if (secBasis && !basisReqs.size) add('必须处理', 'H1 设计依据无需求', secBasis.start + 1, '设计依据中没有摘录 SRS 需求（| 需求标识 | 原文 | 表格）')
if (secBasis && !secHw) add('复核', 'H1 设计依据无硬件约束', secBasis.start + 1, '设计依据中没有“硬件和接口约束”一节：地址、中断、时序要从接口文件摘录')

// —— H1 需求摘录完整（对照 SRS）——
if (srsIds && srsIds.size) {
  const miss = [...srsIds].filter((id) => !basisReqs.has(id))
  if (miss.length) add('必须处理', 'H1 需求漏摘', secReq ? secReq.start + 1 : 1, `SRS 中有 ${miss.length} 条需求没有摘录到设计依据：${miss.join('、')}`)
  for (const [id, r] of basisReqs) if (!srsIds.has(id)) add('复核', 'H1 需求不在 SRS 中', r.line, `${id} 在 SRS 原文件中找不到，确认标识是否写错`)
} else if (!srsFile) notes.push('没有指定 --srs，未对照 SRS 原文件核对需求是否摘录齐全')

// —— 模块表 ——
const secArch = S['体系结构设计']
const modRows = rows(secArch).filter((r) => r.header.some((h) => h.includes('标识')) && r.header.some((h) => h.includes('职责')))
const modId = (s) => (/[a-z][a-z0-9_]*/.exec(String(s).replace(/`/g, '')) || [])[0]
const modules = new Map()
for (const r of modRows) { const id = modId(col(r, '标识')); if (id) modules.set(id, r) }
if (secArch && !modRows.length) add('必须处理', 'H2 模块表', secArch.start + 1, '体系结构设计中没有“| 模块 | 标识 | 职责 | 执行环境 | 分配的需求 |”表格')
const modsIn = (s) => [...String(s).replace(/`/g, '').matchAll(/[a-z][a-z0-9_]*/g)].map((m) => m[0]).filter((x) => modules.has(x))

// —— H2 需求分配 ——
const modReqs = new Map()
for (const [id, r] of modules) {
  for (const k of ['职责', '执行环境', '分配的需求']) if (empty(col(r, k))) add('必须处理', 'H2 模块信息不全', r.line, `模块 ${id} 的“${k}”为空`)
  const ids = reqIds(col(r, '分配的需求', '需求'))
  modReqs.set(id, ids)
  if (!ids.size && !/D-\d{3}/.test(col(r, '分配的需求', '需求'))) add('必须处理', 'H2 模块无需求依据', r.line, `模块 ${id} 没有分配需求：每个模块都要有需求依据（基础模块追溯到约束、质量因素类需求或设计决策 D-xxx）`)
  for (const q of ids) if (basisReqs.size && !basisReqs.has(q)) add('必须处理', 'H2 分配的需求不在依据中', r.line, `模块 ${id} 分配了 ${q}，但设计依据中没有这条需求`)
}
const traceRows = rows(S['需求追溯']).filter((r) => reqIds(r.cells[0]).size)
const traced = new Map()
for (const r of traceRows) for (const id of reqIds(r.cells[0])) traced.set(id, r)
for (const [id] of basisReqs) {
  const r = traced.get(id)
  if (!r) { add('必须处理', 'H2 需求未分配', S['需求追溯'] ? S['需求追溯'].start + 1 : 1, `设计依据中的 ${id} 在需求追溯表中没有出现`); continue }
  const ms = modsIn(col(r, '模块'))
  if (!ms.length) { add('必须处理', 'H2 追溯的模块不存在', r.line, `${id} 的模块“${col(r, '模块')}”不在模块表中（写 5.2 节的模块标识）`); continue }
  for (const m of ms) if (modReqs.get(m) && !modReqs.get(m).has(id)) add('复核', 'H2 两表不一致', r.line, `需求追溯表中 ${id} 分配给 ${m}，但模块表中 ${m} 的“分配的需求”没有 ${id}`)
}
for (const [m, ids] of modReqs) for (const id of ids) {
  const r = traced.get(id)
  if (r && !modsIn(col(r, '模块')).includes(m)) add('复核', 'H2 两表不一致', modules.get(m).line, `模块表中 ${m} 分配了 ${id}，但需求追溯表中 ${id} 没有 ${m}`)
}

// —— H3 模块接口 ——
if (secIf) {
  const ifHeads = heads.filter((h) => h.line > secIf.start && h.line < secIf.end && h.level >= 3)
  for (const [id, r] of modules) {
    const h = ifHeads.find((x) => modsIn(x.title).includes(id) || x.title.replace(/`/g, '').includes(id))
    if (!h) { add('必须处理', 'H3 模块缺少接口小节', r.line, `模块 ${id} 在接口设计一章中没有小节（标题中写模块标识）`); continue }
    const next = heads.find((x) => x.line > h.line && x.level <= h.level)
    const sec = { start: h.line, end: next ? Math.min(next.line, secIf.end) : secIf.end }
    const ir = rows(sec).filter((x) => x.header.some((c) => c.includes('接口')) && x.header.some((c) => c.includes('调用者')))
    const body = secText(sec)
    if (!ir.length && !/无对外接口|没有对外接口|不提供/.test(body)) add('必须处理', 'H3 模块接口表', h.line + 1, `${id} 的接口小节中没有“| 接口 | 调用者 | 执行环境 | 说明 |”表格（没有对外接口的写“无对外接口”）`)
    for (const x of ir) {
      if (empty(col(x, '调用者'))) add('必须处理', 'H3 接口信息不全', x.line, `${id} 的接口“${x.cells[0]}”没有写调用者`)
      if (empty(col(x, '执行环境'))) add('必须处理', 'H3 接口信息不全', x.line, `${id} 的接口“${x.cells[0]}”没有写执行环境（主循环/中断/初始化）`)
    }
    if (!/使用的接口/.test(body)) add('复核', 'H3 未写使用的接口', h.line + 1, `${id} 的接口小节中没有“使用的接口”（其他模块的接口、寄存器）`)
  }
}

// —— H4 外部接口 ——
for (const r of rows(secExt).filter((x) => x.header.some((c) => c.includes('实现模块')))) {
  if (empty(col(r, '依据'))) add('必须处理', 'H4 外部接口无依据', r.line, `外部接口“${r.cells[0]}”没有写依据（需求标识或接口文件条款）`)
  if (!modsIn(col(r, '实现模块')).length) add('必须处理', 'H4 外部接口实现模块', r.line, `外部接口“${r.cells[0]}”的实现模块“${col(r, '实现模块')}”不在模块表中`)
}
if (secIf && !secExt) add('复核', 'H4 外部接口', secIf.start + 1, '接口设计中没有“外部接口”一节')

// —— 时间值解析 ——
const UNIT = { 'μs': 1, us: 1, 'ms': 1000, s: 1e6, '秒': 1e6, '毫秒': 1000, '微秒': 1, min: 6e7, '分钟': 6e7 }
const TIME_NUM = /(\d+(?:\.\d+)?)\s*(μs|us|ms|毫秒|微秒|秒|分钟|min|s)(?![A-Za-z])/
const toUs = (s) => { const m = TIME_NUM.exec(String(s)); return m ? Number(m[1]) * UNIT[m[2]] : null }
const TIME_REQ = /(\d+(?:\.\d+)?)\s*(ms|μs|us|s|秒|毫秒)\s*(内|以内)|不(大|多)于\s*\d+(?:\.\d+)?\s*(ms|μs|us|s)|不超过\s*\d+(?:\.\d+)?\s*(ms|μs|us|s)|每\s*\d+(?:\.\d+)?\s*(ms|μs|us|s|秒|分钟|min)|周期为?\s*\d/
const HW_TIME = /(\d+(?:\.\d+)?)\s*(ms|μs|us|ns)(?![A-Za-z])/

// —— H5 时序分析 ——
const taRows = rows(secTa).filter((r) => r.header.some((h) => h.includes('结论')))
if (secExec && !secTa) add('必须处理', 'H5 缺少时序分析', secExec.start + 1, '执行方案中没有“时序分析”一节')
else if (secTa && !taRows.length) add('必须处理', 'H5 时序分析表', secTa.start + 1, '时序分析一节中没有“| 编号 | 依据 | 时间要求 | 最坏情况路径 | 最坏情况时间 | 结论 |”表格')
const taBasis = taRows.map((r) => col(r, '依据') + ' ' + r.cells[0]).join(' ')
const taReqs = reqIds(taBasis)
for (const [id, r] of basisReqs) {
  const t = col(r, '原文')
  if (TIME_REQ.test(t) && !taReqs.has(id)) add('必须处理', 'H5 时间要求未分析', r.line, `${id} 有时间要求（“${(TIME_REQ.exec(t) || [''])[0]}”），时序分析表中没有分析它`)
}
for (const r of clauseRows) {
  const t = col(r, '原文')
  const cid = clauseId(r)
  if (HW_TIME.test(t) && !taBasis.includes(cid)) add('复核', 'H5 硬件时间约束未分析', r.line, `${cid} 有时间约束（“${(HW_TIME.exec(t) || [''])[0]}”），时序分析表中没有分析它：确认它对执行方案没有影响，或补充分析`)
}
for (const r of taRows) {
  const req = col(r, '时间要求'), worst = col(r, '最坏情况时间'), concl = col(r, '结论')
  if (empty(col(r, '依据'))) add('必须处理', 'H5 时序分析无依据', r.line, `${r.cells[0]} 没有写依据（需求标识或接口文件条款）`)
  if (empty(worst) || empty(col(r, '最坏情况路径'))) add('必须处理', 'H5 时序分析不全', r.line, `${r.cells[0]} 没有写最坏情况路径或最坏情况时间`)
  if (!/满足|不满足|待实测/.test(concl)) { add('必须处理', 'H5 时序结论', r.line, `${r.cells[0]} 的结论应为“满足”“不满足”“待实测”之一（估计的写“满足（估计，待实测）”）`); continue }
  const a = toUs(req), b = toUs(worst)
  if (a !== null && b !== null && /满足/.test(concl) && !/不满足/.test(concl)) {
    const lower = /不少于|不小于|至少|≥|>=|以上/.test(req)
    if ((!lower && b > a) || (lower && b < a)) add('必须处理', 'H5 结论与数值不一致', r.line, `${r.cells[0]}：要求“${req}”，最坏情况“${worst}”，结论却是“${concl}”`)
  }
  if (/^满足$/.test(concl.trim()) && !/估计|实测|保证|规定值/.test(r.cells.join(' '))) add('复核', 'H5 结论未注明估计', r.line, `${r.cells[0]} 结论为“满足”：设计阶段的执行时间是估计值时，写“满足（估计，待实测）”`)
}

// —— H6 中断和调度 ——
const irqRows = rows(secIrq).filter((r) => r.header.some((h) => h.includes('级别') || h.includes('优先级')))
if (secExec && !secIrq) add('复核', 'H6 中断', secExec.start + 1, '执行方案中没有“中断”一节：不使用中断的写“不使用中断”并说明外设的服务方式')
for (const r of irqRows) {
  for (const k of ['级别', '处理程序', '处理内容', '最长执行时间', '嵌套']) {
    const v = col(r, k === '级别' ? '级别' : k, k === '级别' ? '优先级' : k)
    if (!v) add('必须处理', 'H6 中断信息不全', r.line, `中断“${r.cells[0]}”的“${k}”为空`)
  }
  if (/喂狗/.test(col(r, '处理内容'))) add('复核', 'H6 中断中喂狗', r.line, `中断“${r.cells[0]}”中喂狗：主循环停止运行时中断仍在喂狗，看门狗失效`)
  const t = col(r, '最长执行时间')
  if (/\d/.test(t) && !/估计|实测|硬件/.test(t + col(r, '处理内容'))) add('复核', 'H6 执行时间未注明估计', r.line, `中断“${r.cells[0]}”的最长执行时间“${t}”：是估计值的注明“估计”`)
}
const schedRows = rows(secSched).filter((r) => r.header.some((h) => h.includes('最长执行时间')))
if (secExec && !schedRows.length) add('复核', 'H6 调度表', secSched ? secSched.start + 1 : secExec.start + 1, '执行方案中没有含“最长执行时间”列的主循环任务调度表')
for (const r of schedRows) {
  const t = col(r, '最长执行时间')
  if (empty(t)) add('必须处理', 'H6 任务执行时间', r.line, `任务“${r.cells[0]}”没有写最长执行时间（估计值注明“估计”）`)
  else if (/\d/.test(t) && !/估计|实测|硬件|HW-/.test(t + col(r, '说明'))) add('复核', 'H6 执行时间未注明估计', r.line, `任务“${r.cells[0]}”的最长执行时间“${t}”：是估计值的注明“估计”`)
  if (empty(col(r, '触发'))) add('必须处理', 'H6 任务触发', r.line, `任务“${r.cells[0]}”没有写触发方式`)
}

// —— H7 共享数据 ——
const shRows = rows(secShared).filter((r) => r.header.some((h) => h.includes('保护')))
if (irqRows.length && !shRows.length) add('必须处理', 'H7 共享数据', secShared ? secShared.start + 1 : (secExec ? secExec.start + 1 : 1), '使用了中断，但没有共享数据表（| 数据 | 写者 | 读者 | 保护 |）')
for (const r of shRows) if (empty(col(r, '保护'))) add('必须处理', 'H7 共享数据无保护', r.line, `共享数据“${r.cells[0]}”没有写保护方式（关中断范围、单写者 + 原子访问、volatile 等）`)
if (shRows.length) {
  const shText = shRows.map((r) => r.cells.join(' ')).join(' ')
  for (const r of irqRows) {
    const h = (/[A-Za-z_]\w*/.exec(col(r, '处理程序').replace(/`/g, '')) || [])[0]
    if (h && !shText.includes(h) && !/不访问|没有共享|无共享/.test(r.cells.join(' '))) add('复核', 'H7 中断不在共享数据表中', r.line, `中断处理程序 ${h} 没有出现在共享数据表中：它不与主循环共享任何数据吗？（不共享的在中断表中写明）`)
  }
}

// —— H8 资源 ——
const resRows = rows(S['资源分配和余量']).filter((r) => r.header.some((h) => h.includes('结论')))
if (S['资源分配和余量'] && !resRows.length) add('必须处理', 'H8 资源表', S['资源分配和余量'].start + 1, '资源一章中没有“| 资源 | 容量 | 估计使用量 | 余量 | 要求 | 结论 | 估计方法 |”表格')
for (const r of resRows) {
  const concl = col(r, '结论')
  if (!/满足|不满足|待实测/.test(concl)) add('必须处理', 'H8 资源结论', r.line, `资源“${r.cells[0]}”的结论应为“满足”“不满足”“待实测”之一`)
  if (empty(col(r, '估计方法', '方法'))) add('必须处理', 'H8 资源无估计方法', r.line, `资源“${r.cells[0]}”没有写估计方法`)
  const pct = (s) => { const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(s)); return m ? Number(m[1]) : null }
  const req = col(r, '要求'), rq = pct(req)
  if (rq !== null && /满足/.test(concl) && !/不满足/.test(concl)) {
    if (/≥|>=|不少于|不小于|至少/.test(req)) { const v = pct(col(r, '余量')); if (v !== null && v < rq) add('必须处理', 'H8 结论与数值不一致', r.line, `资源“${r.cells[0]}”余量 ${v}% 小于要求 ${rq}%，结论却是“${concl}”`) }
    else if (/≤|<=|不大于|不超过/.test(req)) { const v = pct(col(r, '估计使用量')); if (v !== null && v > rq) add('必须处理', 'H8 结论与数值不一致', r.line, `资源“${r.cells[0]}”估计使用 ${v}% 大于要求 ${rq}%，结论却是“${concl}”`) }
  }
}
if (resRows.length) {
  const names = resRows.map((r) => r.cells[0]).join(' ')
  for (const [k, re] of [['CPU 负荷', /CPU|处理器负荷|负荷/], ['程序存储器', /程序存储|PROM|Flash|FLASH|ROM/], ['数据存储器', /数据存储|SRAM|RAM/]]) {
    if (!re.test(names)) add('复核', 'H8 资源项缺少', S['资源分配和余量'].start + 1, `资源表中没有“${k}”一项`)
  }
}

// —— H9 可靠性和安全性 ——
const relText = secText(S['可靠性和安全性设计'])
for (const [id, r] of basisReqs) {
  if (/-(SAF|REL|RLB|SEC|SAFE)-/.test(id) && !relText.includes(id)) add('复核', 'H9 安全可靠性需求未落实', r.line, `${id} 是安全性/可靠性需求，在可靠性和安全性设计一章中没有出现`)
}

// —— H10 含糊词 ——
const VAGUE_MUST = /(适当(地)?(延时|等待|处理)|相应(的)?处理|必要的处理|视情况|酌情)/
const VAGUE_REVIEW = /(适当|尽快|及时|必要时|若干|一定的|左右|大约|尽量|很短|足够|很小)/
const designSecs = ['CSCI 级设计决策', '体系结构设计', '执行方案', '接口设计', '数据设计', '资源分配和余量', '可靠性和安全性设计'].map((k) => S[k]).filter(Boolean)
const inDesign = (i) => designSecs.some((s) => inSec(s, i))
{
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (fence || !inDesign(i) || /^#/.test(l)) return
    let m
    if ((m = VAGUE_MUST.exec(l))) add('必须处理', 'H10 含糊表述', i + 1, `“${m[0]}”不可验证，写出具体的条件、数值和动作；上级文件没有规定的列为待确认问题`)
    else if ((m = VAGUE_REVIEW.exec(l))) add('复核', 'H10 含糊表述', i + 1, `“${m[0]}”，确认是否写清了具体的条件或数值`)
  })
}

// —— H11 数值出处 ——
const decText = secText(S['CSCI 级设计决策'])
const normNum = (s) => s.replace(/\s+/g, '').replace(/μs|us/gi, 'μs').toLowerCase()
const expandRanges = (t) => t.replace(/(\d+(?:\.\d+)?)\s*[～~\-–—至到]\s*(\d+(?:\.\d+)?)\s*(ms|μs|us|s|kHz|MHz|Hz|bps|KB|MB|字节|位|bit|ns|路)/g, '$1 $3 $2 $3 $&')
const sourceText = normNum(expandRanges(secText(secBasis) + '\n' + decText))
const numRe = /(\d+(?:\.\d+)?)\s*(ms|μs|us|ns|s|kHz|MHz|Hz|kbps|Mbps|bps|KB|MB|字节)(?![A-Za-z])/g
const hexRe = /\b0x[0-9A-Fa-f]{4,}\b/g
// 推算、估计的数值不要求出处（但要写明怎么来的）
const DERIVED = /估计|估算|推算|计算|实测|折合|合计|约|≈|×|÷|\+|最坏|最长一轮|余量|使用量/
{
  let fence = false
  let tblHead = null // 表头写了“估计”的表格（如“执行时间（估计）”），其中的数值按估计值处理
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (l.trim().startsWith('|')) { if (tblHead === null) tblHead = l } else tblHead = null
    if (fence || !inDesign(i) || inSec(S['CSCI 级设计决策'], i) || /^#/.test(l)) return
    const t = l.replace(/`[^`]*`/g, '') + (tblHead && /估计|估算/.test(tblHead) && tblHead !== l ? ' 估计' : '')
    // 地址、掩码不论是否推算都要有出处
    for (const m of t.matchAll(hexRe)) if (!sourceText.includes(m[0].toLowerCase())) add('复核', 'H11 数值无出处', i + 1, `“${m[0]}”在设计依据和设计决策中找不到；地址要来自接口文件`)
    if (DERIVED.test(t)) return
    for (const m of t.matchAll(numRe)) {
      if (/^(0|1)$/.test(m[1]) && !/s$/.test(m[2])) continue
      if (!sourceText.includes(normNum(m[0]))) add('复核', 'H11 数值无出处', i + 1, `“${m[0].trim()}”在设计依据和设计决策中找不到：确认出处（需求、接口文件条款或 D-xxx）；推算值写明推算过程`)
    }
  })
}

// —— H12 自行裁决 ——
const ADJ = /(取较(严|小|大|保守)的?值?|以\s*(SRS|需求规格说明|任务书|接口文件|ICD|协议|硬件接口说明|[A-Z]{2,5}-[\d.]+)\s*为准|按\s*(SRS|需求规格说明|协议|ICD)\s*执行|两者取|统一(为|取)|按较(严|新)的?)/
lines.forEach((l, i) => {
  if (inSec(S['待确认问题'], i)) return
  const m = ADJ.exec(l)
  if (m && !/Q-\d{3}/.test(l)) add('必须处理', 'H12 自行裁决', i + 1, `“${m[0]}”：上级文件之间矛盾时应列为待确认问题并引用两处原文，不在设计中选择`)
})

// —— H13 编号引用 ——
const ids = (sec, re) => new Set(rows(sec).map((r) => (re.exec(r.cells[0]) || [])[0]).filter(Boolean))
const qIds = ids(S['待确认问题'], /Q-\d{3}/)
const dIds = ids(S['CSCI 级设计决策'], /D-\d{3}/)
const taIds = new Set(taRows.map((r) => (/TA-\d{2,3}/.exec(r.cells[0]) || [])[0]).filter(Boolean))
const missing = new Set()
lines.forEach((l, i) => {
  for (const [re, set, sec, what] of [[/Q-\d{3}/g, qIds, S['待确认问题'], '待确认问题表'], [/\bD-\d{3}\b/g, dIds, S['CSCI 级设计决策'], '设计决策表'], [/\bTA-\d{2,3}\b/g, taIds, secTa, '时序分析表']]) {
    if (inSec(sec, i)) continue
    for (const m of l.matchAll(re)) if (!set.has(m[0]) && !missing.has(m[0])) { missing.add(m[0]); add('必须处理', 'H13 编号不存在', i + 1, `引用了 ${m[0]}，但${what}中没有`) }
  }
  if (/【待确认】/.test(l) && !/Q-\d{3}/.test(l) && !inSec(S['待确认问题'], i)) add('必须处理', 'H13 待确认未关联问题', i + 1, '有【待确认】但没有关联 Q-xxx')
})
for (const r of rows(S['CSCI 级设计决策'])) {
  if (!/D-\d{3}/.test(r.cells[0])) continue
  if (empty(col(r, '理由'))) add('必须处理', 'H13 设计决策无理由', r.line, `${r.cells[0]} 没有写理由`)
  if (/计入|只统计|计数(的含义|方式|规则|加\s*1)|故障时.{0,10}(断开|复位|停止)|故障处理方式|遥测内容|返回值含义/.test(col(r, '决策')) && !/Q-\d{3}/.test(r.cells.join(' '))) add('复核', 'H13 设计决策涉及外部可见行为', r.line, `${r.cells[0]} 的决策涉及计数、故障处理或遥测等外部可见的行为：上级文件没有规定的应列为待确认问题（可以在建议中写方案），不由设计决策确定`)
}
for (const r of rows(S['待确认问题'])) {
  if (!/Q-\d{3}/.test(r.cells[0])) continue
  if (empty(col(r, '依据'))) add('复核', 'H13 待确认问题无依据', r.line, `${r.cells[0]} 没有引用上级文件原文`)
}

// —— H14 流程图 ——
let mermaidInExec = 0
if (parseFlowchart) {
  let fence = null, buf = [], startLine = 0
  lines.forEach((l, i) => {
    if (fence === null && /^\s*```\s*mermaid/i.test(l)) { fence = 'm'; buf = []; startLine = i + 1; return }
    if (fence && /^\s*```/.test(l)) {
      if (inSec(secExec, startLine)) mermaidInExec++
      const g = parseFlowchart(buf.join('\n'))
      if (g.errors?.length) add('必须处理', 'H14 流程图语法', startLine, `流程图无法转换为 Word 图形：${g.errors.join('；')}（写法见 flowchart-guide.md）`)
      else if (g.nodes.some((n) => n.shape === 'decision' || n.shape === 'terminal')) {
        for (const n of g.nodes) {
          const k = g.edges.filter((e) => e.from === n.id)
          if (n.shape === 'decision' && k.length < 2) add('必须处理', 'H14 流程图判断出口', startLine, `判断节点“${n.text}”只有 ${k.length} 个出口`)
          if (n.shape === 'decision' && k.length >= 2 && k.some((e) => !e.label)) add('复核', 'H14 流程图判断出口', startLine, `判断节点“${n.text}”有出口没有标注是/否`)
          if (n.shape !== 'terminal' && !k.length) add('必须处理', 'H14 流程图断头', startLine, `节点“${n.text}”没有出线：每条路径应结束于“结束/返回”，或回到主循环`)
        }
      }
      fence = null
      return
    }
    if (fence) buf.push(l)
  })
} else {
  lines.forEach((l, i) => { if (/^\s*```\s*mermaid/i.test(l) && inSec(secExec, i)) mermaidInExec++ })
}
if (secExec && !mermaidInExec) add('必须处理', 'H14 缺少流程图', secExec.start + 1, '执行方案中没有流程图：启动和初始化流程、主循环流程要画流程图')

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1 }
findings.sort((a, b) => order[a.level] - order[b.level] || a.line - b.line)
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log('# 概要设计说明自查结果\n')
console.log(`文件：${file}${srsFile ? `（对照 SRS：${srsFile}，需求 ${srsIds ? srsIds.size : 0} 条）` : ''}`)
console.log(`设计依据中的需求 ${basisReqs.size} 条、接口条款 ${clauseRows.length} 条，模块 ${modules.size} 个，时序分析 ${taRows.length} 项，中断 ${irqRows.length} 个，共享数据 ${shRows.length} 项，设计决策 ${dIds.size} 个，待确认问题 ${qIds.size} 个`)
for (const n of notes) console.log(`注意：${n}`)
console.log(`必须处理 ${count('必须处理')} 项，复核 ${count('复核')} 项\n`)
for (const lv of ['必须处理', '复核']) {
  const list = findings.filter((f) => f.level === lv)
  if (!list.length) continue
  console.log(`## ${lv}\n`)
  for (const f of list) console.log(`- 第 ${f.line} 行［${f.rule}］${f.msg}`)
  console.log('')
}
if (!findings.length) console.log('没有发现需要处理的地方。')
process.exit(count('必须处理') ? 1 : 0)
