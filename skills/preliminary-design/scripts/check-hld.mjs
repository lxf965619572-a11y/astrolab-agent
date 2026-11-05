#!/usr/bin/env node
// 概要设计自查脚本：把《软件概要设计说明》（部门模板 02-1）和《概要设计记录》对起来，按固定规则检查
// 章节结构、需求追踪（按标识逐条）、模块和接口、数据有效性、中断任务和共享资源、时序分析、堆栈和时间预算、
// 可靠性措施、数值出处、编号引用、流程图。只读。“必须处理”项要改正，“复核”项逐条判断。
//
// 用法：node check-hld.mjs <软件概要设计说明.md> [--record <概要设计记录.md>] [--srs <软件需求规格说明 .docx/.md/.pdf>]
//   --record：不给时自动找同目录下的“概要设计记录-*.md”
//   --srs：对照 SRS 原文件，核对记录 2.1 节是否摘录了全部需求
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
const srsFile = opt('--srs')
let recFile = opt('--record')
const file = args[0]
if (!file) { console.error('用法：node check-hld.mjs <软件概要设计说明.md> [--record <概要设计记录.md>] [--srs <软件需求规格说明>]'); process.exit(2) }
if (!recFile) {
  const dir = dirname(file)
  const date = (basename(file).match(/\d{8}/) || [''])[0]
  try {
    const list = readdirSync(dir).filter((f) => /概要设计记录/.test(f) && f.endsWith('.md'))
    const pick = list.find((f) => date && f.includes(date)) || list.sort().at(-1)
    if (pick) recFile = join(dir, pick)
  } catch { /* 忽略 */ }
}
const load = (f) => { try { return readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/) } catch (e) { console.error(`读不到文件：${f}（${e.message}）`); process.exit(2) } }
const notes = []

// —— 共用库：流程图解析器、文档读取 ——
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

// —— 需求标识（部门规则 XXYY-FREQnnn[-K/-N/-KN]、PREQa.b、RREQn、SREQn、IREQa.b；也兼容旧的 XXX-FUN-012）——
const REQ_SRC = String.raw`\b[A-Z][A-Z0-9]*-(?:[A-Z]{2,4}-\d{3}|FREQ\d{3}(?:-(?:KN|K|N))?|[PI]REQ\d+\.\d+|[RS]REQ\d+)(?![\w.])`
const REQ_RE = new RegExp(REQ_SRC, 'g')
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
const baseId = (id) => id.replace(/-(?:KN|K|N)$/, '')

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
  srsIds = new Set()
  let tblHeader = null
  for (const l of srsText.split(/\r?\n/)) {
    if (l.trim().startsWith('|')) {
      if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
      if (tblHeader === null) { tblHeader = l; continue }
      if (/文件编号|版本/.test(tblHeader) && !/需求标识/.test(tblHeader)) continue
    } else tblHeader = null
    if (/文件编号|文档编号/.test(l)) continue
    // 部门格式的标识很有辨识度：出现在任何位置都算（附录 B 的跟踪矩阵也只是同一批标识）
    for (const m of l.matchAll(/\b[A-Z][A-Z0-9]*-(?:FREQ\d{3}(?:-(?:KN|K|N))?|[PI]REQ\d+\.\d+|[RS]REQ\d+)(?![\w.])/g)) srsIds.add(baseId(m[0]))
    // 旧格式只取段首或表格第一列
    const m = /^\s*(?:[-*]\s*)?(?:\*\*|__)?\s*([A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{3})\b/.exec(l) || /^\s*\|\s*(?:\*\*)?([A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{3})\b/.exec(l)
    if (m) srsIds.add(m[1])
  }
  if (!srsIds.size) notes.push(`SRS 文件 ${srsFile} 中没有识别到需求标识，未核对需求摘录`)
}

// —— 文档解析 ——
function doc(lines, name) {
  const heads = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence
    if (fence) return
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (m) heads.push({ level: m[1].length, title: m[2].replace(/\*\*/g, '').trim(), line: i })
  })
  return { name, lines, heads }
}
const D = doc(load(file), '设计说明')
const R = recFile && existsSync(recFile) ? doc(load(recFile), '设计记录') : null
function section(d, pattern, within = null) {
  if (!d) return null
  const h = d.heads.find((x) => pattern.test(x.title) && (!within || (x.line > within.start && x.line < within.end)))
  if (!h) return null
  const next = d.heads.find((x) => x.line > h.line && x.level <= h.level)
  return { d, title: h.title, start: h.line, end: next ? next.line : d.lines.length }
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
    const l = sec.d.lines[i]
    if (!l.trim().startsWith('|')) { header = null; continue }
    if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
    const cells = splitRow(l)
    if (!header) { header = cells; continue }
    out.push({ line: i + 1, cells, header })
  }
  return headerHas ? out.filter((r) => r.header.some((h) => h.includes(headerHas))) : out
}
const col = (r, ...names) => { for (const n of names) { const k = r.header.findIndex((h) => h.includes(n)); if (k >= 0) return r.cells[k] ?? '' } return '' }
const secText = (sec) => (sec ? sec.d.lines.slice(sec.start, sec.end).join('\n') : '')
const inSec = (sec, i) => sec && i >= sec.start && i < sec.end
const empty = (s) => !s || /^(—|-|－|\/|…+|\.\.\.)$/.test(String(s).trim())
const isFiller = (r) => r.cells.every((c) => empty(c) || /^…+$|^\d+$/.test(c.trim()))

const findings = []
const seen = new Set()
const add = (level, rule, where, line, msg) => {
  const key = `${rule}|${where}|${line}|${msg}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ level, rule, where, line, msg })
}

// —— HS1 章节结构 ——
const REQUIRED = [
  ['1', '引言'], ['1.1', '软件配置项基本信息'], ['1.2', '目的'], ['1.3', '缩略语定义'],
  ['2', '引用文件'], ['2.1', '规范性引用文件'], ['2.2', '研制依据引用文件'],
  ['3', '软件总体概述'], ['3.1', '系统组成'], ['3.2', '需求规定'], ['3.3', '运行环境'], ['3.3.1', '硬件环境'], ['3.3.2', '软件环境'],
  ['3.4', '编程编译环境'], ['3.4.1', '编程要求'], ['3.4.2', '编译要求'], ['3.5', '设计约束'],
  ['4', '关键问题及技术方案的选取'],
  ['5', '设计'], ['5.1', '体系结构设计'], ['5.1.1', '基本设计概念'], ['5.1.2', '软件结构'], ['5.1.2.1', '顶层任务调度'], ['5.1.2.2', '层次结构设计'], ['5.1.2.3', '源代码文件结构设计'], ['5.1.3', '产品集成顺序'],
  ['5.2', '接口设计'], ['5.2.1', '外部接口'], ['5.2.1.1', '外部硬件接口'], ['5.2.1.2', '外部软件接口'], ['5.2.1.3', '数据有效性判断设计'],
  ['5.2.2', '内部接口'], ['5.2.2.1', '软件相关的中断概述'], ['5.2.2.2', '软件相关的任务概述'], ['5.2.2.3', '中断和任务间共享资源分析'],
  ['5.3', '时间系统设计'], ['5.4', '运行设计'], ['5.4.1', '顶层运行设计'], ['5.4.2', '任务及中断运行设计'], ['5.4.3', '运行模块组合'], ['5.4.4', '空间与时间运行设计'],
  ['5.4.4.1', '内存空间分配'], ['5.4.4.2', '运行堆栈设计'], ['5.4.4.3', '运行时间设计'],
  ['5.5', '数据设计'], ['5.6', '可靠性安全性设计'], ['5.6.1', '系统可靠性安全性分析'], ['5.6.2', '系统可靠性安全性措施'], ['5.7', '可复用设计'], ['5.8', '待解决的问题'],
  ['附录A', '跟踪矩阵'], ['A.1', '逆向跟踪矩阵'], ['A.2', '正向跟踪矩阵'], ['附录B', '模块汇总表'], ['附录C', '更改记录'], ['附录D', '确认检查表'],
]
const norm = (s) => s.replace(/\s+/g, '').replace(/[《》]/g, '')
{
  const titles = D.heads.map((h) => norm(h.title))
  for (const [num, name] of REQUIRED) {
    const n = norm(num)
    const ok = titles.some((t) => (t.startsWith(n) && t.slice(n.length).replace(/^[.．、]/, '').startsWith(norm(name))) || (/^(附录|A\.)/.test(n) && t.startsWith(n) && t.includes(norm(name))))
    if (!ok) add('必须处理', 'HS1 章节结构', '设计说明', 0, titles.some((t) => t.replace(/^(附录)?[A-Z]?[\d.．]*/, '') === norm(name)) ? `“${num} ${name}”的章节号不对：部门模板要求编号为 ${num}` : `缺少“${num} ${name}”一节（按部门模板，没有内容也要保留并写“无”）`)
  }
  D.heads.forEach((h) => {
    if (/^5\.5\.[1-6]/.test(h.title)) add('必须处理', 'HS1 章节结构', '设计说明', h.line + 1, `“${h.title}”：部门模板已删除 5.5.1～5.5.6，数据设计只写表 5.5-1 数据构成列表（对外部的输入和输出数据）`)
    if (/^[6-9]\s|^1[0-9]\s/.test(h.title) && h.level <= 2) add('必须处理', 'HS1 章节结构', '设计说明', h.line + 1, `“${h.title}”：部门模板正文只有 1～5 章，后面是附录 A～D`)
  })
}
if (!R) add('必须处理', '结构', '设计记录', 0, '没有找到概要设计记录（同目录下的“概要设计记录-<软件简称>-<日期>.md”）：设计依据、时序分析、资源估算、待确认问题无从核对')

// —— 记录中的设计依据 ——
const secBasis = section(R, /设计依据/)
const secBasisReq = secBasis ? (section(R, /需求/, secBasis) || secBasis) : null
const secBasisHw = secBasis ? section(R, /硬件|接口|约束/, secBasis) : null
const secDec = section(R, /设计决策/)
const secTa = section(R, /时序分析/)
const secRes = section(R, /资源/)
const secQ = section(R, /待确认问题/)
const basisReqs = new Map()
for (const r of rows(secBasisReq)) for (const id of reqIds(r.cells[0])) if (!basisReqs.has(baseId(id))) basisReqs.set(baseId(id), r)
const clauseRows = rows(secBasisHw).filter((r) => r.cells[0] && !/^需求标识$/.test(r.header[0]))
if (R) {
  for (const [name, s] of [['设计依据', secBasis], ['设计决策', secDec], ['时序分析', secTa], ['资源估算', secRes], ['待确认问题', secQ]]) if (!s) add('必须处理', '结构', '设计记录', 0, `设计记录中没有“${name}”一章`)
  if (secBasis && !basisReqs.size) add('必须处理', 'H1 设计依据无需求', '设计记录', secBasis.start + 1, '设计依据中没有摘录 SRS 需求（| 需求标识 | 原文 | 表格）')
  if (secBasis && !secBasisHw) add('复核', 'H1 设计依据无硬件约束', '设计记录', secBasis.start + 1, '设计依据中没有“硬件和接口约束”一节：地址、中断、时序要从接口文件摘录')
}
if (srsIds && R) {
  const miss = [...srsIds].filter((id) => !basisReqs.has(id))
  if (miss.length) add('必须处理', 'H1 需求漏摘', '设计记录', secBasisReq ? secBasisReq.start + 1 : 1, `SRS 中有 ${miss.length} 条需求没有摘录到设计依据：${miss.join('、')}`)
  for (const [id, r] of basisReqs) if (!srsIds.has(id)) add('复核', 'H1 需求不在 SRS 中', '设计记录', r.line, `${id} 在 SRS 原文件中找不到，确认标识是否写错`)
}

// —— 模块：附录 B、5.1.2.2 模块表 ——
const secAppB = section(D, /^附录\s*B/)
const secLayer = section(D, /^5\.1\.2\.2\s*层次结构/)
const modules = new Map()
for (const r of rows(secAppB, '模块')) {
  if (isFiller(r)) continue
  const id = col(r, '模块名称', '模块').replace(/[`*]/g, '').replace(/\(\)$/, '').trim()
  if (id) modules.set(id, r)
}
if (secAppB && !modules.size) add('必须处理', 'H2 模块汇总表', '设计说明', secAppB.start + 1, '附录 B 中没有“| 序号 | 模块名称 | 功能 |”表格')
const modOf = (s) => [...modules.keys()].filter((m) => new RegExp(`(^|[^A-Za-z0-9_])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`).test(s))
const layerRows = rows(secLayer, '对外接口')
const layerMods = new Map()
for (const r of layerRows) {
  if (isFiller(r)) continue
  const id = col(r, '模块名称', '模块').replace(/[`*]/g, '').trim()
  layerMods.set(id, r)
  if (!modules.has(id)) add('必须处理', 'H2 模块不一致', '设计说明', r.line, `模块 ${id} 在 5.1.2.2 中出现，但附录 B 模块汇总表中没有`)
  for (const k of ['功能', '调用者', '执行环境']) if (empty(col(r, k))) add('必须处理', 'H2 模块信息不全', '设计说明', r.line, `模块 ${id} 的“${k}”为空`)
  const itf = col(r, '对外接口')
  if (empty(itf)) add('必须处理', 'H2 模块信息不全', '设计说明', r.line, `模块 ${id} 的“对外接口”为空（写函数原型；确实没有的写“无对外接口”）`)
  const rq = col(r, '对应需求')
  if (!reqIds(rq).size && !/D-\d{3}/.test(rq)) add('必须处理', 'H2 模块无需求依据', '设计说明', r.line, `模块 ${id} 的“对应需求”没有需求标识（基础模块追溯到约束、可靠性类需求或设计决策 D-xxx）`)
  for (const q of reqIds(rq)) if (basisReqs.size && !basisReqs.has(baseId(q))) add('必须处理', 'H2 需求不在依据中', '设计说明', r.line, `模块 ${id} 对应 ${q}，但设计依据中没有这条需求`)
}
if (secLayer && !layerRows.length) add('必须处理', 'H2 模块表', '设计说明', secLayer.start + 1, '5.1.2.2 中没有“| 模块名称 | 功能 | 对外接口 | 调用者 | 执行环境 | 对应需求 |”表格：模块的对外接口是详细设计的依据')
for (const [m, r] of modules) if (layerRows.length && !layerMods.has(m)) add('必须处理', 'H2 模块不一致', '设计说明', r.line, `附录 B 的模块 ${m} 在 5.1.2.2 各任务的模块表中没有出现`)

// —— 附录 A 跟踪矩阵（批注：按标识逐条追踪，不能追大章节）——
const secA1 = section(D, /^A\.1|逆向跟踪/)
const secA2 = section(D, /^A\.2|正向跟踪/)
const a1 = rows(secA1).filter((r) => !isFiller(r))
const a2 = rows(secA2).filter((r) => !isFiller(r))
const CHAPTER = /^(第\s*\d+\s*章|\d+(\.\d+)+\s*节?|见\s*\d+(\.\d+)*)$/
const a2Map = new Map()
for (const r of a2) {
  const ids = reqIds(col(r, '需求编号', '需求标识'))
  const m = col(r, '对应的模块', '模块')
  if (!ids.size) { if (CHAPTER.test(col(r, '需求编号', '需求标识').trim())) add('必须处理', 'H3 追踪到章节', '设计说明', r.line, `A.2 中“${col(r, '需求编号')}”是章节号：按需求标识逐条追踪，不能追大章节`); continue }
  for (const id of ids) a2Map.set(baseId(id), r)
  if (empty(m)) add('必须处理', 'H3 需求未分配', '设计说明', r.line, `A.2 中 ${[...ids].join('、')} 没有对应的模块`)
  else if (modules.size && !modOf(m).length && !/\d+\.\d+/.test(m)) add('必须处理', 'H3 模块不存在', '设计说明', r.line, `A.2 中对应的模块“${m}”不在附录 B 模块汇总表中`)
  const attr = col(r, '属性')
  for (const id of ids) {
    if (/-K/.test(id) && attr && !/K/.test(attr)) add('复核', 'H3 属性', '设计说明', r.line, `${id} 是安全关键功能，A.2 属性列应含 K`)
  }
}
for (const [id, r] of basisReqs) if (secA2 && !a2Map.has(id)) add('必须处理', 'H3 需求未追踪', '设计说明', secA2.start + 1, `设计依据中的 ${id} 没有出现在 A.2 正向跟踪矩阵中（功能、性能、可靠性、安全性、接口需求都要逐条追踪）`)
const a1Mods = new Set()
for (const r of a1) {
  const m = col(r, '模块名称', '模块').replace(/[`*]/g, '').trim()
  a1Mods.add(m)
  const ids = reqIds(col(r, '需求ID', '需求标识', '需求编号'))
  if (!ids.size) add('必须处理', 'H3 追踪到章节', '设计说明', r.line, `A.1 中模块 ${m} 没有对应的需求标识${CHAPTER.test(col(r, '需求ID').trim()) ? '（写的是章节号，不能追大章节）' : ''}`)
  for (const id of ids) if (basisReqs.size && !basisReqs.has(baseId(id))) add('必须处理', 'H3 需求不在依据中', '设计说明', r.line, `A.1 中 ${id} 在设计依据中找不到`)
}
for (const [m, r] of modules) if (secA1 && !a1Mods.has(m)) add('必须处理', 'H3 模块未追踪', '设计说明', r.line, `模块 ${m} 没有出现在 A.1 逆向跟踪矩阵中`)

// —— H4 外部接口和数据有效性 ——
const secHwIf = section(D, /^5\.2\.1\.1/)
if (secHwIf && !rows(secHwIf, '接口类型').filter((r) => !isFiller(r)).length) add('必须处理', 'H4 外部硬件接口', '设计说明', secHwIf.start + 1, '5.2.1.1 没有“| 接口类型 | 接口内容 | 接口说明 |”表格（存储芯片、总线、IO、FPGA 寄存器接口都算外部硬件接口）')
const secValid = section(D, /^5\.2\.1\.3/)
const validRows = rows(secValid, '输入数据项').filter((r) => !isFiller(r))
if (secValid && !validRows.length) add('必须处理', 'H4 数据有效性', '设计说明', secValid.start + 1, '5.2.1.3 没有“| 序号 | 输入数据项 | 通讯状态判断 | 数据有效标志判断 | 数据有效范围判断 |”表格')
for (const r of validRows) {
  for (const k of ['通讯状态判断', '数据有效标志判断', '数据有效范围判断']) {
    const v = col(r, k)
    if (empty(v)) add('必须处理', 'H4 数据有效性', '设计说明', r.line, `输入数据项“${col(r, '输入数据项')}”的“${k}”为空（没有判断的写“无……判断”）`)
    else if (/？|\?/.test(v)) add('必须处理', 'H4 数据有效性', '设计说明', r.line, `输入数据项“${col(r, '输入数据项')}”的“${k}”还留着模板的提问，要逐个回答`)
  }
  if (!/直传浮点|浮点/.test(col(r, '数据有效范围判断'))) add('复核', 'H4 数据有效性', '设计说明', r.line, `输入数据项“${col(r, '输入数据项')}”没有回答“是否直传浮点数”`)
}

// —— H5 时序分析（记录） ——
const taRows = rows(secTa).filter((r) => /TA-\d/.test(r.cells[0]))
if (secTa && !taRows.length) add('必须处理', 'H5 时序分析表', '设计记录', secTa.start + 1, '时序分析中没有“| 编号 | 依据 | 时间要求 | 最坏情况路径 | 最坏情况时间 | 结论 |”表格')
const TIME_REQ = /(\d+(?:\.\d+)?)\s*(ms|μs|us|s|秒|毫秒|微秒)(?![A-Za-z])/
const taBasis = taRows.map((r) => col(r, '依据')).join(' ')
const taReqs = reqIds(taBasis)
for (const [id, r] of basisReqs) {
  const t = r.cells.slice(1).join(' ')
  if (TIME_REQ.test(t) && /内|不大于|不超过|小于|≤|周期|间隔|响应|超时|延时|时间/.test(t) && ![...taReqs].some((x) => baseId(x) === id)) add('必须处理', 'H5 时间要求未分析', '设计记录', r.line, `${id} 有时间要求（“${(TIME_REQ.exec(t) || [''])[0]}”），时序分析表中没有分析它`)
}
const HW_TIME = /(稳定时间|写周期|编程时间|超时|溢出|看门狗|喂狗|建立时间|保持时间|转换时间|间隔)[^。|]{0,20}\d/
for (const r of clauseRows) {
  const cid = r.cells[0]
  if (HW_TIME.test(r.cells.slice(1).join(' ')) && !taBasis.includes(cid)) add('复核', 'H5 硬件时间约束未分析', '设计记录', r.line, `${cid} 有时间约束，时序分析表中没有分析它：确认它对运行设计没有影响，或补充分析`)
}
const toUs = (s) => { const m = /(\d+(?:\.\d+)?)\s*(ms|μs|us|s|秒|毫秒|微秒)/.exec(String(s)); if (!m) return null; const v = Number(m[1]); return /^(ms|毫秒)$/.test(m[2]) ? v * 1000 : /^(s|秒)$/.test(m[2]) ? v * 1e6 : v }
for (const r of taRows) {
  const worst = col(r, '最坏情况时间')
  const concl = col(r, '结论')
  const req = col(r, '时间要求')
  if (empty(col(r, '依据'))) add('必须处理', 'H5 时序分析无依据', '设计记录', r.line, `${r.cells[0]} 没有写依据（需求标识或接口文件条款）`)
  if (empty(worst) || empty(col(r, '最坏情况路径'))) add('必须处理', 'H5 时序分析不全', '设计记录', r.line, `${r.cells[0]} 没有写最坏情况路径或最坏情况时间`)
  if (!/满足|不满足|待实测/.test(concl)) { add('必须处理', 'H5 时序结论', '设计记录', r.line, `${r.cells[0]} 的结论应为“满足”“不满足”“待实测”之一（估计的写“满足（估计，待实测）”）`); continue }
  const a = toUs(req), b = toUs(worst)
  const lower = /不小于|≥|>=|至少/.test(req)
  if (a !== null && b !== null && /^满足/.test(concl) && ((!lower && b > a) || (lower && b < a))) add('必须处理', 'H5 结论与数值不一致', '设计记录', r.line, `${r.cells[0]}：要求“${req}”，最坏情况“${worst}”，结论却是“${concl}”`)
  if (/^满足$/.test(concl.trim()) && !/估计|实测|保证|规定值/.test(r.cells.join(' '))) add('复核', 'H5 结论未注明估计', '设计记录', r.line, `${r.cells[0]} 结论为“满足”：设计阶段的执行时间是估计值时，写“满足（估计，待实测）”`)
}

// —— H6 中断、任务 ——
const secIrq = section(D, /^5\.2\.2\.1/)
const irqRows = rows(secIrq, '中断名称').filter((r) => !isFiller(r))
for (const r of irqRows) {
  for (const k of ['标识', '触发源', '优先级', '产生频率', '时序特征']) if (empty(col(r, k))) add('必须处理', 'H6 中断信息不全', '设计说明', r.line, `中断“${col(r, '中断名称')}”的“${k}”为空`)
  if (/喂狗/.test(r.cells.join(' '))) add('复核', 'H6 中断中喂狗', '设计说明', r.line, `中断“${col(r, '中断名称')}”中喂狗：主循环停止运行时中断仍在喂狗，看门狗失效`)
}
if (secIrq && !irqRows.length && !/不使用中断|无中断/.test(secText(secIrq))) add('必须处理', 'H6 中断', '设计说明', secIrq.start + 1, '5.2.2.1 没有中断列表；不使用中断的写“本软件不使用中断”并说明外设服务方式')
const secTask = section(D, /^5\.2\.2\.2/)
const taskRows = rows(secTask, '任务名称').filter((r) => !isFiller(r))
for (const r of taskRows) for (const k of ['标识', '调度方式', '调用周期', '时序特征']) if (empty(col(r, k))) add('必须处理', 'H6 任务信息不全', '设计说明', r.line, `任务“${col(r, '任务名称')}”的“${k}”为空`)
if (secTask && !taskRows.length) add('必须处理', 'H6 任务', '设计说明', secTask.start + 1, '5.2.2.2 没有任务列表（前后台软件把主循环列为任务）')

// —— H7 共享资源 ——
const secShare = section(D, /^5\.2\.2\.3/)
const shRows = rows(secShare, '共享数据分析').filter((r) => !isFiller(r))
if (irqRows.length && !shRows.length && !/无共享|不共享|没有共享/.test(secText(secShare))) add('必须处理', 'H7 共享资源', '设计说明', secShare ? secShare.start + 1 : 0, '使用了中断，但 5.2.2.3 没有访问冲突分析表（| 序号 | 中断/任务1 | 中断/任务2 | 共享数据分析（列出变量及设计措施） | 分析结论 |）')
for (const r of shRows) {
  const a = col(r, '共享数据分析')
  if (empty(a)) add('必须处理', 'H7 共享资源', '设计说明', r.line, '共享数据分析为空')
  else if (!/关中断|禁止中断|缓冲|标志|原子|单写|volatile|信号量|互斥|锁|双缓冲|拷贝|复制/.test(a)) add('复核', 'H7 共享资源无措施', '设计说明', r.line, `“${a.slice(0, 40)}”没有写出保护措施（关中断范围、缓冲 + 完成标志、单写者原子访问、volatile 等）`)
  if (empty(col(r, '分析结论'))) add('必须处理', 'H7 共享资源', '设计说明', r.line, '分析结论为空')
}

// —— H8 资源：记录中的估算 + 设计说明中的堆栈和时间预算 ——
const resRows = rows(secRes).filter((r) => r.cells[0] && !isFiller(r))
if (secRes && !resRows.length) add('必须处理', 'H8 资源表', '设计记录', secRes.start + 1, '资源估算中没有“| 资源 | 容量 | 估计使用量 | 余量 | 要求 | 结论 | 估计方法 |”表格')
const pct = (s) => { const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(s)); return m ? Number(m[1]) : null }
for (const r of resRows) {
  const concl = col(r, '结论')
  if (!/满足|不满足|待实测/.test(concl)) add('必须处理', 'H8 资源结论', '设计记录', r.line, `资源“${r.cells[0]}”的结论应为“满足”“不满足”“待实测”之一`)
  if (empty(col(r, '估计方法', '方法'))) add('必须处理', 'H8 资源无估计方法', '设计记录', r.line, `资源“${r.cells[0]}”没有写估计方法`)
  const req = col(r, '要求'), rq = pct(req)
  if (rq !== null && /^满足/.test(concl)) {
    if (/≥|>=|不少于|不小于|至少/.test(req)) { const v = pct(col(r, '余量')); if (v !== null && v < rq) add('必须处理', 'H8 结论与数值不一致', '设计记录', r.line, `资源“${r.cells[0]}”余量 ${v}% 小于要求 ${rq}%，结论却是“${concl}”`) }
    else if (/≤|<=|不大于|不超过/.test(req)) { const v = pct(col(r, '估计使用量')); if (v !== null && v > rq) add('必须处理', 'H8 结论与数值不一致', '设计记录', r.line, `资源“${r.cells[0]}”估计使用 ${v}% 大于要求 ${rq}%，结论却是“${concl}”`) }
  }
}
if (resRows.length) for (const [k, re] of [['CPU 负荷', /CPU|负荷|处理器/], ['程序存储器', /程序|代码|ROM|Flash|PROM/i], ['数据存储器', /数据|RAM|栈/i]]) if (!re.test(resRows.map((r) => r.cells[0]).join(' '))) add('复核', 'H8 资源项缺少', '设计记录', secRes.start + 1, `资源估算中没有“${k}”一项`)
const num = (s) => { const m = /(\d+(?:\.\d+)?)/.exec(String(s)); return m ? Number(m[1]) : null }
for (const [re, a, b, what] of [[/^5\.4\.4\.2/, '预算', '分配', '堆栈'], [/^5\.4\.4\.3/, '预算', '分配', '运行时间']]) {
  const sec = section(D, re)
  const rs = rows(sec, a).filter((r) => !isFiller(r))
  if (sec && !rs.length) add('必须处理', 'H8 预算表', '设计说明', sec.start + 1, `${sec.title} 没有“软部件名称 | ……预算 | ……分配”表格`)
  for (const r of rs) {
    const x = num(col(r, a)), y = num(col(r, b))
    if (x === null || y === null) { if (!/待|【/.test(r.cells.join(' '))) add('复核', 'H8 预算表', '设计说明', r.line, `“${r.cells[0]}”的${what}预算或分配没有数值`); continue }
    if (x >= y) add('必须处理', 'H8 预算超分配', '设计说明', r.line, `“${r.cells[0]}”的${what}预算 ${x} 不小于分配 ${y}：预算应小于分配，否则改设计或调整分配`)
  }
}

// —— H9 可靠性安全性 ——
const secRel1 = section(D, /^5\.6\.1/)
const secRel2 = section(D, /^5\.6\.2/)
const relText = secText(secRel1) + secText(secRel2)
for (const [id, r] of basisReqs) if ((/-(RREQ|SREQ)\d/.test(id) || /-(SAF|REL|RLB|SEC|SAFE)-/.test(id)) && !relText.includes(id)) add('复核', 'H9 安全可靠性需求未罗列', '设计说明', secRel1 ? secRel1.start + 1 : 0, `${id} 是可靠性/安全性需求，5.6.1 没有罗列它（批注：首先罗列需求规格说明中的内容，再补充新增的）`)
for (const r of rows(secRel2, '可靠性设计').filter((x) => !isFiller(x))) {
  const d = col(r, '可靠性设计')
  if (empty(d)) add('必须处理', 'H9 可靠性措施', '设计说明', r.line, '可靠性设计为空')
  else if (/^(要求|应|需要|软件应)/.test(d.trim()) || d.trim() === col(r, '可靠性要求').trim()) add('复核', 'H9 可靠性措施不具体', '设计说明', r.line, `“${d.slice(0, 40)}”像是在复述要求。批注：要写具体措施——哪些变量三取二、不一致怎么处理、标志用 0x55/0xAA 而不是全 0 全 1 等`)
  else if (/三取二|多数表决|冗余/.test(d) && !/[A-Za-z_]\w*|变量|字|标志/.test(d.replace(/三取二|多数表决/g, ''))) add('复核', 'H9 可靠性措施不具体', '设计说明', r.line, '三取二/冗余措施没有写出是哪些变量')
}
const secReuse = section(D, /^5\.7/)
for (const r of rows(secReuse, '构件库').filter((x) => !isFiller(x))) {
  const v = col(r, '构件库')
  if (empty(v) || /^XX|XXX/.test(v)) add('复核', 'H9 构件库版本', '设计说明', r.line, `“${r.cells[1] || r.cells[0]}”的构件库及版本写“${v}”：批注要求写出实际的库及版本，不知道的写【待补充】`)
}

// —— H10 含糊词 ——
const VAGUE_MUST = /(适当(地)?(延时|等待|处理)|相应(的)?处理|必要的处理|视情况|酌情)/
const VAGUE_REVIEW = /(适当|尽快|及时|必要时|若干|一定的|左右|大约|尽量|很短|足够|很小)/
const secDesign = section(D, /^5\s*设计$/) || section(D, /^5\s/)
{
  let fence = false
  D.lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (fence || !inSec(secDesign, i) || /^#/.test(l)) return
    if (/^\s*(识别临界资源|分析的原则|采用矩阵表格法)/.test(l)) return
    let m
    if ((m = VAGUE_MUST.exec(l))) add('必须处理', 'H10 含糊表述', '设计说明', i + 1, `“${m[0]}”不可验证，写出具体的条件、数值和动作；上级文件没有规定的列为待确认问题`)
    else if ((m = VAGUE_REVIEW.exec(l))) add('复核', 'H10 含糊表述', '设计说明', i + 1, `“${m[0]}”，确认是否写清了具体的条件或数值`)
  })
}

// —— H11 数值出处 ——
const normNum = (s) => s.replace(/\s+/g, '').replace(/μs|us/gi, 'μs').toLowerCase()
const expandRanges = (t) => t.replace(/(\d+(?:\.\d+)?)\s*[～~\-–—至到]\s*(\d+(?:\.\d+)?)\s*(ms|μs|us|s|kHz|MHz|Hz|bps|KB|MB|字节|位|bit|ns|路)/g, '$1 $3 $2 $3 $&')
const sourceText = normNum(expandRanges(secText(secBasis) + '\n' + secText(secDec)))
const numRe = /(\d+(?:\.\d+)?)\s*(ms|μs|us|ns|s|kHz|MHz|Hz|kbps|Mbps|bps|KB|MB|字节)(?![A-Za-z])/g
const hexRe = /\b0x[0-9A-Fa-f]{4,}\b/g
const DERIVED = /估计|估算|推算|计算|实测|折合|合计|约|≈|×|÷|\+|最坏|余量|使用量|预算|分配/
if (R) {
  let fence = false
  let tblHead = null
  D.lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (l.trim().startsWith('|')) { if (tblHead === null) tblHead = l } else tblHead = null
    if (fence || !inSec(secDesign, i) || /^#/.test(l)) return
    const t = l.replace(/`[^`]*`/g, '') + (tblHead && /估计|估算|预算|分配/.test(tblHead) && tblHead !== l ? ' 估计' : '')
    for (const m of t.matchAll(hexRe)) if (!sourceText.includes(m[0].toLowerCase())) add('复核', 'H11 数值无出处', '设计说明', i + 1, `“${m[0]}”在设计依据和设计决策中找不到；地址要来自接口文件`)
    if (DERIVED.test(t)) return
    for (const m of t.matchAll(numRe)) {
      if (/^(0|1)$/.test(m[1]) && !/s$/.test(m[2])) continue
      if (!sourceText.includes(normNum(m[0]))) add('复核', 'H11 数值无出处', '设计说明', i + 1, `“${m[0].trim()}”在设计依据和设计决策中找不到：确认出处（需求、接口文件条款或 D-xxx）；推算值写明推算过程`)
    }
  })
}

// —— H12 自行裁决 ——
const ADJ = /(取较(严|小|大|保守)的?值?|以\s*(SRS|需求规格说明|任务书|接口文件|ICD|协议|硬件接口说明|[A-Z]{2,5}-[\d.]+)\s*为准|按\s*(SRS|需求规格说明|协议|ICD)\s*执行|两者取|统一(为|取)|按较(严|新)的?)/
for (const d of [D, R].filter(Boolean)) d.lines.forEach((l, i) => {
  if (d === R && inSec(secQ, i)) return
  const m = ADJ.exec(l)
  if (m && !/Q-\d{3}/.test(l)) add('必须处理', 'H12 自行裁决', d.name, i + 1, `“${m[0]}”：上级文件之间矛盾时应列为待确认问题并引用两处原文，不在设计中选择`)
})

// —— H13 编号引用 ——
const ids = (sec, re) => new Set(rows(sec).map((r) => (re.exec(r.cells[0]) || [])[0]).filter(Boolean))
const qIds = ids(secQ, /Q-\d{3}/)
const dIds = ids(secDec, /D-\d{3}/)
const taIds = new Set(taRows.map((r) => (/TA-\d{2,3}/.exec(r.cells[0]) || [])[0]).filter(Boolean))
if (R) for (const d of [D, R]) {
  const missing = new Set()
  d.lines.forEach((l, i) => {
    for (const [re, set, sec, what] of [[/Q-\d{3}/g, qIds, secQ, '待确认问题表'], [/\bD-\d{3}\b/g, dIds, secDec, '设计决策表'], [/\bTA-\d{2,3}\b/g, taIds, secTa, '时序分析表']]) {
      if (d === R && inSec(sec, i)) continue
      for (const m of l.matchAll(re)) if (!set.has(m[0]) && !missing.has(m[0])) { missing.add(m[0]); add('必须处理', 'H13 编号不存在', d.name, i + 1, `引用了 ${m[0]}，但设计记录的${what}中没有`) }
    }
    if (/【待确认】/.test(l) && !/Q-\d{3}/.test(l) && !(d === R && inSec(secQ, i))) add('必须处理', 'H13 待确认未关联问题', d.name, i + 1, '有【待确认】但没有关联 Q-xxx')
  })
}
for (const r of rows(secDec)) {
  if (!/D-\d{3}/.test(r.cells[0])) continue
  if (empty(col(r, '理由'))) add('必须处理', 'H13 设计决策无理由', '设计记录', r.line, `${r.cells[0]} 没有写理由`)
  if (/计入|只统计|计数(的含义|方式|规则|加\s*1)|故障时.{0,10}(断开|复位|停止)|故障处理方式|遥测内容|返回值含义/.test(col(r, '决策')) && !/Q-\d{3}/.test(r.cells.join(' '))) add('复核', 'H13 设计决策涉及外部可见行为', '设计记录', r.line, `${r.cells[0]} 的决策涉及计数、故障处理或遥测等外部可见的行为：上级文件没有规定的应列为待确认问题，不由设计决策确定`)
}

// —— H14 流程图 ——
const secTop = section(D, /^5\.4\.1/)
let mermaidInTop = 0
{
  let fence = null, buf = [], startLine = 0
  D.lines.forEach((l, i) => {
    if (fence === null && /^\s*```\s*mermaid/i.test(l)) { fence = 'm'; buf = []; startLine = i + 1; return }
    if (fence && /^\s*```/.test(l)) {
      if (inSec(secTop, startLine)) mermaidInTop++
      if (parseFlowchart) {
        const g = parseFlowchart(buf.join('\n'))
        if (g.errors?.length) add('必须处理', 'H14 流程图语法', '设计说明', startLine, `流程图无法转换为 Word 图形：${g.errors.join('；')}（写法见 flowchart-guide.md）`)
        else if (g.nodes.some((n) => n.shape === 'decision' || n.shape === 'terminal')) {
          for (const n of g.nodes) {
            const k = g.edges.filter((e) => e.from === n.id)
            if (n.shape === 'decision' && k.length < 2) add('必须处理', 'H14 流程图判断出口', '设计说明', startLine, `判断节点“${n.text}”只有 ${k.length} 个出口`)
            if (n.shape === 'decision' && k.length >= 2 && k.some((e) => !e.label)) add('复核', 'H14 流程图判断出口', '设计说明', startLine, `判断节点“${n.text}”有出口没有标注是/否`)
            if (n.shape !== 'terminal' && !k.length) add('必须处理', 'H14 流程图断头', '设计说明', startLine, `节点“${n.text}”没有出线：每条路径应结束于“结束/返回”，或回到主循环`)
          }
        }
      }
      fence = null
      return
    }
    if (fence) buf.push(l)
  })
}
if (secTop && !mermaidInTop) add('必须处理', 'H14 缺少流程图', '设计说明', secTop.start + 1, '5.4.1 顶层运行设计没有流程图（图 5.4-1 顶层运行时序图）')
if (secLayer && !/```\s*mermaid/i.test(secText(secLayer))) add('复核', 'H14 缺少结构图', '设计说明', secLayer.start + 1, '5.1.2.2 没有层次结构图（图 5.1-1 软件顶层任务调用结构图及各任务的结构图）')

// —— H15 照抄模板示例 ——
const EXAMPLE = /\b(Ttcm|Torb|80C32E|SIP2115|BM2842|MatrixAdd|MatrixIdentity33|CheckSumfor32|Checksumfor08|mTAInput\w*|mTGPSInput\w*|mStarTime\w*|jb20_param|OSTM0|OSTM1|XX_Req001)\b|基础公共运算库\s*V1\.05|SAOS/g
const srcAll = secText(secBasis)
D.lines.forEach((l, i) => { for (const m of l.matchAll(EXAMPLE)) if (!srcAll.includes(m[0])) add('必须处理', 'H15 照抄模板示例', '设计说明', i + 1, `“${m[0]}”是部门模板示例中的内容，设计依据里没有。示例只是写法示范`) })

// —— H16 附录 D ——
const secAppD = section(D, /^附录\s*D/)
if (secAppD) {
  const dr = rows(secAppD, '要素').filter((r) => /^\d+$/.test(r.cells[0].trim()))
  if (dr.length < 13) add('复核', 'H16 确认检查表', '设计说明', secAppD.start + 1, `附录 D 只有 ${dr.length} 项，部门模板通用要素为 13 项`)
  for (const r of dr) { const c = col(r, '对应章节'); if (/^\s*$/.test(c)) add('复核', 'H16 确认检查表', '设计说明', r.line, `第 ${r.cells[0]} 项没有填“对应章节”`) }
  if (dr.length && !dr[0].header.some((h) => /产保工程师/.test(h))) add('必须处理', 'H16 确认检查表', '设计说明', dr[0].line, '附录 D 最后一列应为“产保工程师检查确认结果”')
}

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1 }
findings.sort((a, b) => order[a.level] - order[b.level] || a.where.localeCompare(b.where) || a.line - b.line)
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log('# 概要设计自查结果\n')
console.log(`设计说明：${file}`)
console.log(`设计记录：${R ? recFile : '（未找到）'}${srsFile ? `；对照 SRS：${srsFile}（需求 ${srsIds ? srsIds.size : 0} 条）` : ''}`)
console.log(`设计依据中的需求 ${basisReqs.size} 条、接口条款 ${clauseRows.length} 条，模块 ${modules.size} 个，中断 ${irqRows.length} 个，任务 ${taskRows.length} 个，共享资源分析 ${shRows.length} 项，时序分析 ${taRows.length} 项，设计决策 ${dIds.size} 个，待确认问题 ${qIds.size} 个`)
for (const n of notes) console.log(`注意：${n}`)
console.log(`必须处理 ${count('必须处理')} 项，复核 ${count('复核')} 项\n`)
for (const lv of ['必须处理', '复核']) {
  const list = findings.filter((f) => f.level === lv)
  if (!list.length) continue
  console.log(`## ${lv}\n`)
  for (const f of list) console.log(`- ${f.where}${f.line ? ` 第 ${f.line} 行` : ''}［${f.rule}］${f.msg}`)
  console.log('')
}
if (!findings.length) console.log('没有发现需要处理的地方。')
process.exit(count('必须处理') ? 1 : 0)
