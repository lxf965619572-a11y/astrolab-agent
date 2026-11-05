#!/usr/bin/env node
// 需求分析自查脚本：把《软件需求规格说明》（部门模板）和《需求分析记录》对起来，用固定规则列出需要复核的地方。
// 只读，不修改文件。规则是启发式的，列出的是“疑似”问题，逐条判断后改正或说明保留理由。
//
// 用法：node check-report.mjs <软件需求规格说明.md> [--record <需求分析记录.md>]
//       不给 --record 时，自动找同目录下日期相同的“需求分析记录-*.md”。
//       也可以只给分析记录（文件名含“分析记录”），这时自动找同目录的规格说明。
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

// —— 参数 ——
const args = process.argv.slice(2)
let srsFile = null
let recFile = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--record') recFile = args[++i]
  else if (args[i] === '--srs') srsFile = args[++i]
  else if (!srsFile && !/分析记录/.test(basename(args[i]))) srsFile = args[i]
  else if (!recFile) recFile = args[i]
}
if (!srsFile && !recFile) { console.error('用法：node check-report.mjs <软件需求规格说明.md> [--record <需求分析记录.md>]'); process.exit(2) }
function sibling(file, pattern) {
  const dir = dirname(file)
  const date = (basename(file).match(/\d{8}/) || [''])[0]
  let list = []
  try { list = readdirSync(dir).filter((f) => pattern.test(f) && f.endsWith('.md')) } catch { return null }
  const same = list.find((f) => date && f.includes(date))
  const pick = same || list.sort().at(-1)
  return pick ? join(dir, pick) : null
}
if (srsFile && !recFile) recFile = sibling(srsFile, /需求分析记录/)
if (recFile && !srsFile) srsFile = sibling(recFile, /需求规格说明/)
function load(file) {
  try { return readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/) } catch (e) { console.error(`读不到文件：${file}（${e.message}）`); process.exit(2) }
}
if (srsFile && !existsSync(srsFile)) { console.error(`读不到文件：${srsFile}`); process.exit(2) }
const S = srsFile ? doc(load(srsFile), '规格说明') : null
const R = recFile && existsSync(recFile) ? doc(load(recFile), '分析记录') : null

// —— 文档解析工具 ——
function doc(lines, name) {
  const heads = []
  lines.forEach((l, i) => { const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l); if (m) heads.push({ level: m[1].length, title: m[2].replace(/\*\*/g, '').trim(), line: i }) })
  return { name, lines, heads }
}
function section(d, pattern) {
  if (!d) return null
  const h = d.heads.find((x) => pattern.test(x.title))
  if (!h) return null
  const next = d.heads.find((x) => x.line > h.line && x.level <= h.level)
  return { d, title: h.title, start: h.line, end: next ? next.line : d.lines.length }
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
    const l = sec.d.lines[i]
    if (!l.trim().startsWith('|')) { header = null; continue }
    if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
    const cells = splitRow(l)
    if (!header) { header = cells; continue }
    out.push({ line: i + 1, cells, header })
  }
  return out
}
const col = (r, ...names) => { for (const n of names) { const k = r.header.findIndex((h) => h.includes(n)); if (k >= 0) return r.cells[k] ?? '' } return '' }
const text = (sec) => (sec ? sec.d.lines.slice(sec.start, sec.end).join('\n') : '')

const findings = []
const seen = new Set()
const add = (level, rule, where, line, msg) => {
  const key = `${where}|${line}|${msg}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ level, rule, where, line, msg })
}
const PENDING = /【待确认】|【待补充】|【待定】/
const ID = /\b([A-Z][A-Z0-9]*-(?:FREQ\d{3}(?:-(?:K|N|KN))?|PREQ\d+\.\d+|RREQ\d+|SREQ\d+|IREQ\d+\.\d+))(?![\w.])/g
const IDLIKE = /\b[A-Z][A-Z0-9]*-[A-Z]REQ[\w.-]*/g

// —— S1 规格说明章节结构 ——
const REQUIRED = [
  ['1', '引言'], ['1.1', '配置项基本信息'], ['1.2', '编写目的'], ['1.3', '缩略语定义'],
  ['2', '引用文件'], ['2.1', '规范性引用文件'], ['2.2', '研制依据引用文件'],
  ['3', '概述'], ['3.1', '系统组成'], ['3.2', '软件概述'], ['3.3', '设计约束'],
  ['4', '运行环境规定'], ['4.1', '运行方案和场景'], ['4.2', '硬件环境'], ['4.2.1', '宿主计算机'], ['4.2.2', '中断设置'], ['4.2.3', '看门狗'], ['4.2.4', '存储器'], ['4.2.5', '定时器'],
  ['4.3', '软件编程编译要求'], ['4.3.1', '编程要求'], ['4.3.2', '编译要求'], ['4.4', '接口'], ['4.4.1', '软件接口'], ['4.4.2', '硬件接口'],
  ['5', '软件详细需求'], ['5.1', '功能分解'], ['5.2', '功能需求'], ['5.3', '性能需求'], ['5.3.1', '精度需求'], ['5.3.2', '空间需求'], ['5.3.3', '时间特性需求'],
  ['5.4', '故障处理要求'], ['5.5', '可靠性及安全性需求'], ['5.5.1', '可靠性要求'], ['5.5.2', '安全性要求'], ['5.6', '复用需求分析'], ['5.7', '可维护性需求'],
  ['6', '专项分析'], ['6.1', '时序分析'], ['6.1.1', '接口时序分析'], ['6.1.2', '中断/任务分析'], ['6.1.3', '中断对时间性能影响分析'], ['6.2', '数据访问冲突分析'], ['6.3', '时间系统分析'], ['6.4', '数据有效性判断'],
  ['7', '测试要求'], ['7.1', '测试环境差异性'], ['7.2', '健壮性测试'], ['7.3', '不可测试项'], ['7.4', '测试要点'],
  ['8', '安全关键功能专项要求'], ['8.1', '安全关键功能对设计的要求'], ['8.2', '安全关键功能对测试的要求'], ['9', '其他要求'],
  ['附录A', '数据字典'], ['附录B', '需求跟踪矩阵'], ['附录B.1', '逆向跟踪矩阵'], ['附录B.2', '正向跟踪矩阵'], ['附录C', '分配需求更动记录'], ['附录D', '确认检查表'],
]
const norm = (s) => s.replace(/\s+/g, '').replace(/[《》]/g, '')
if (S) {
  const titles = S.heads.map((h) => norm(h.title))
  for (const [num, name] of REQUIRED) {
    const n = norm(num)
    const ok = titles.some((t) => t.startsWith(n) && t.slice(n.length).replace(/^[.．、]/, '').startsWith(norm(name)) || (n.startsWith('附录') && t.startsWith(n) && t.includes(norm(name))))
    if (!ok) {
      const loose = titles.some((t) => t.replace(/^(附录)?[A-Z]?[\d.．]*/, '') === norm(name))
      add('必须处理', 'S1 章节结构', '规格说明', 0, loose ? `“${num} ${name}”的章节号不对：部门模板要求编号为 ${num}` : `缺少“${num} ${name}”一节（按部门模板，不适用也要保留标题并写理由）`)
    }
  }
  for (const [bad, good] of [[/软件功能需求/, '5 软件详细需求'], [/精度要求/, '5.3.1 精度需求'], [/时间特性要求/, '5.3.3 时间特性需求'], [/分配需求更改记录/, '附录C 分配需求更动记录'], [/内容提要/, '内容概要']]) {
    S.heads.forEach((h) => { if (bad.test(h.title)) add('必须处理', 'S1 章节结构', '规格说明', h.line + 1, `标题“${h.title}”与部门模板不一致，应为“${good}”`) })
  }
}

// —— 需求清单：从规格说明中抽取 ——
const reqs = new Map() // id -> { line, text }
const idLines = []
if (S) {
  const body = section(S, /^附录\s*A/) // 正文到附录 A 之前
  const bodyEnd = body ? body.start : S.lines.length
  // IPO 块：“需求标识：ID”开始，到下一个需求标识或标题为止
  for (let i = 0; i < bodyEnd; i++) {
    const l = S.lines[i]
    const m = /需求标识\s*[:：]\s*\**\s*([A-Z][\w.-]+)/.exec(l)
    if (m && !l.trim().startsWith('|')) {
      let j = i + 1
      while (j < bodyEnd && !/需求标识\s*[:：]/.test(S.lines[j]) && !/^#{1,6}\s/.test(S.lines[j])) j++
      const block = S.lines.slice(i, j).join('\n')
      idLines.push({ id: m[1], line: i + 1, text: block, kind: 'ipo' })
      i = j - 1
    }
  }
  // 表格行：带需求标识的行。第 6～9 章（专项分析、测试要求、安全关键功能专项要求）的表格是引用已定义的需求，不算定义
  const tableSecs = []
  const refOnly = (i) => { const h = S.heads.filter((x) => x.line <= i).pop(); return !!h && /^[6-9](\.|\s|$)/.test(h.title) }
  S.lines.slice(0, bodyEnd).forEach((l, i) => {
    if (!l.trim().startsWith('|')) return
    if (refOnly(i)) return
    if (/^\s*\|?\s*:?-{2,}/.test(l)) return
    const cells = splitRow(l)
    const idCell = cells.find((c) => /^[A-Z][A-Z0-9]*-[A-Z]REQ/.test(c))
    if (idCell) idLines.push({ id: idCell.replace(/\*/g, '').trim(), line: i + 1, text: cells.join(' | '), kind: 'table' })
  })
  // 正文段落里以“XXYY-RREQn：”开头的条目（如 3.3、5.4、5.7 用列表写的）
  S.lines.slice(0, bodyEnd).forEach((l, i) => {
    if (l.trim().startsWith('|') || /需求标识\s*[:：]/.test(l) || refOnly(i)) return
    const m = /^\s*(?:[-*]|\d+[.)、]|[a-z][.)])?\s*\**([A-Z][A-Z0-9]*-[A-Z]REQ[\w.-]*)\**\s*[:：]/.exec(l)
    if (m) idLines.push({ id: m[1], line: i + 1, text: l, kind: 'item' })
  })
  for (const r of idLines) {
    if (!new RegExp(`^${ID.source}$`).test(r.id)) {
      add('必须处理', 'S2 标识格式', '规格说明', r.line, `需求标识“${r.id}”不符合部门规则（FREQnnn[-K/-N/-KN]、PREQa.b、RREQn、SREQn、IREQa.b）`)
    }
    if (reqs.has(r.id)) add('必须处理', 'S2 标识重复', '规格说明', r.line, `需求标识 ${r.id} 重复（第一次出现在第 ${reqs.get(r.id).line} 行）`)
    else reqs.set(r.id, r)
  }
  // IPO 块必须有 a～f 六项
  for (const r of idLines.filter((x) => x.kind === 'ipo')) {
    const miss = ['功能描述', '调用条件', '输入', '输出', '处理'].filter((k) => !new RegExp(`${k}\\s*[:：]`).test(r.text))
    if (miss.length) add('必须处理', 'S3 IPO 不完整', '规格说明', r.line, `${r.id} 缺少：${miss.join('、')}（模板格式 a.需求标识 b.功能描述 c.调用条件 d.输入 e.输出 f.处理）`)
    if (!/FREQ/.test(r.id)) add('复核', 'S3 IPO 标识', '规格说明', r.line, `${r.id} 用 IPO 格式写，但不是功能需求（FREQ）。性能、可靠性、安全性需求按模板写在 5.3、5.5 的表格里`)
  }
  // 5.2 中的 FREQ 应写在 IPO 里
  const s52 = section(S, /^5\.2\s*功能需求/)
  if (s52 && !idLines.some((r) => r.kind === 'ipo' && r.line > s52.start && r.line <= s52.end)) add('必须处理', 'S3 IPO 不完整', '规格说明', s52.start + 1, '5.2 功能需求中没有按“a. 需求标识：…… f. 处理：……”格式写的需求')
}
const reqList = [...reqs.values()]
const reqText = (r) => r.text.replace(/需求标识\s*[:：]\s*\S+/, '')

// —— 跟踪矩阵 ——
const secB1 = S && (section(S, /附录\s*B\.1/) || section(S, /逆向跟踪/))
const secB2 = S && (section(S, /附录\s*B\.2/) || section(S, /正向跟踪/))
const b1 = rows(secB1).filter((r) => /REQ/.test(col(r, '需求标识')))
const b2 = rows(secB2).filter((r) => col(r, '任务标识', '任务').trim() && !/^[-—…]+$/.test(col(r, '任务标识', '任务')))
const b1Map = new Map(b1.map((r) => [col(r, '需求标识').replace(/\*/g, '').trim(), r]))
if (S) {
  if (!secB1) add('必须处理', 'S4 跟踪矩阵', '规格说明', 0, '没有找到“附录B.1 逆向跟踪矩阵”')
  if (!secB2) add('必须处理', 'S4 跟踪矩阵', '规格说明', 0, '没有找到“附录B.2 正向跟踪矩阵（跟踪任务书）”')
  if (secB1 && b1.length && !b1[0].header.some((h) => h.includes('属性'))) add('必须处理', 'S4 跟踪矩阵', '规格说明', b1[0].line, '附录 B.1 缺少“属性”列（R/M/N/K），附录 D 第 1、2 项要求在属性列标识新状态和安全关键功能')
  for (const r of reqList) if (secB1 && !b1Map.has(r.id)) add('必须处理', 'S4 跟踪矩阵', '规格说明', r.line, `${r.id} 没有出现在附录 B.1 逆向跟踪矩阵中`)
  for (const [id, r] of b1Map) {
    if (!reqs.has(id)) add('必须处理', 'S4 跟踪矩阵', '规格说明', r.line, `附录 B.1 中的 ${id} 在正文中找不到`)
    const attr = col(r, '属性')
    if (/-K/.test(id) && !/K/.test(attr)) add('必须处理', 'S4 跟踪矩阵', '规格说明', r.line, `${id} 是安全关键功能（-K），B.1 属性列应含 K`)
    if (/-K?N$/.test(id) && !/N/.test(attr)) add('必须处理', 'S4 跟踪矩阵', '规格说明', r.line, `${id} 是新状态功能（-N），B.1 属性列应含 N`)
    const src = col(r, '任务需求标识', '任务')
    if (!src.trim()) add('必须处理', 'S4 跟踪矩阵', '规格说明', r.line, `${id} 在 B.1 中没有填“任务需求标识”（派生需求写“派生”）`)
  }
  // 安全关键功能要在第 8 章出现
  const s8 = section(S, /^8\s*安全关键功能专项要求/)
  const kIds = reqList.filter((r) => /-K/.test(r.id)).map((r) => r.id)
  if (s8 && kIds.length) for (const id of kIds) if (!text(s8).includes(id.replace(/-K?N?$/, ''))) add('复核', 'S5 安全关键功能', '规格说明', s8.start + 1, `${id} 是安全关键功能，第 8 章没有提到它的设计和测试要求`)
}

// —— 分析记录 ——
const secClauses = section(R, /上级条款/)
const secCover = section(R, /覆盖/)
const secDerived = section(R, /派生/)
const secQ = section(R, /待确认问题/)
const secStat = section(R, /统计/)
if (R) for (const [name, s] of [['上级条款摘录', secClauses], ['覆盖分析', secCover], ['派生需求', secDerived], ['待确认问题清单', secQ], ['统计', secStat]]) if (!s) add('必须处理', '结构', '分析记录', 0, `分析记录中没有找到“${name}”一章`)
if (S && !R) add('必须处理', '结构', '分析记录', 0, '没有找到需求分析记录（同目录下的“需求分析记录-<日期>.md”），上级条款、覆盖情况、待确认问题无从核对')

const clauseRows = rows(secClauses).filter((r) => r.cells[0] && !/^[-—…]+$/.test(r.cells[0]))
const clauseText = clauseRows.map((r) => r.cells.join(' ')).join('\n')
const clauseMap = new Map(clauseRows.map((r) => [r.cells[0], r.cells.slice(1).join(' ')]))
const inputText = clauseText + '\n' + (R ? R.lines.slice(0, secClauses ? secClauses.start : 0).join('\n') : '')
const qRows = rows(secQ).filter((r) => /^Q-\d+/.test(r.cells[0]))
const qMap = new Map(qRows.map((r) => [r.cells[0], r]))
const coverRows = rows(secCover).filter((r) => r.cells[0] && !/^[-—…]+$/.test(r.cells[0]))
const derivedRows = rows(secDerived).filter((r) => /REQ/.test(r.cells[0]))
const derivedIds = new Set(derivedRows.map((r) => r.cells[0].trim()))

if (R && S) {
  // 每条上级条款都要有覆盖分析和 B.2 行
  const coverIds = new Set(coverRows.map((r) => r.cells[0].trim()))
  const b2Ids = new Set(b2.map((r) => col(r, '任务标识', '任务').trim()))
  for (const c of clauseRows) {
    const id = c.cells[0].trim()
    if (secCover && !coverIds.has(id)) add('必须处理', 'S6 覆盖', '分析记录', c.line, `上级条款 ${id} 没有出现在覆盖分析中`)
    if (secB2 && !b2Ids.has(id)) add('必须处理', 'S6 覆盖', '规格说明', secB2.start + 1, `上级条款 ${id} 没有出现在附录 B.2 正向跟踪矩阵中`)
  }
  // B.1 的任务需求标识要能在上级条款里找到；派生要有理由
  for (const [id, r] of b1Map) {
    const src = col(r, '任务需求标识', '任务')
    if (/派生/.test(src)) { if (secDerived && !derivedIds.has(id)) add('必须处理', 'S6 派生', '分析记录', secDerived.start + 1, `${id} 在 B.1 中标为派生，但分析记录“派生需求”中没有写理由`); continue }
    for (const cid of src.split(/[、,，;；\s]+/).filter(Boolean)) if (!clauseMap.has(cid) && /-/.test(cid)) add('必须处理', 'S6 覆盖', '规格说明', r.line, `${id} 的任务需求标识 ${cid} 在分析记录的上级条款摘录中找不到`)
  }
  // 覆盖分析与 B.2 一致
  const b2Map = new Map(b2.map((r) => [col(r, '任务标识', '任务').trim(), col(r, '需求标识')]))
  for (const c of coverRows) {
    const cid = c.cells[0].trim()
    const ids = (col(c, '对应需求', '需求标识').match(ID) || [])
    const b2ids = ((b2Map.get(cid) || '').match(ID) || [])
    const miss = ids.filter((x) => !b2ids.includes(x))
    if (b2Map.has(cid) && miss.length) add('复核', 'S6 覆盖', '规格说明', c.line, `条款 ${cid}：覆盖分析写对应 ${miss.join('、')}，附录 B.2 中没有`)
    for (const x of ids) if (!reqs.has(x)) add('必须处理', 'S6 覆盖', '分析记录', c.line, `覆盖分析中 ${cid} 对应的 ${x} 在规格说明正文中找不到`)
  }
}

// —— 内容规则（原 R1～R11，作用在规格说明的需求文本上） ——
const PICK = /取较严|取较宽|取严值|按较严|按较宽|取其中|以[^，。；|]{1,20}为准|按[^，。；|]{1,12}执行较/
if (S) S.lines.forEach((l, i) => { const m = PICK.exec(l); if (m) add('必须处理', 'R1 自行裁决矛盾', '规格说明', i + 1, `“${m[0]}”：输入之间有矛盾时应写【待确认】并引用两处原文，不能自行取舍`) })

for (const r of reqList) {
  const t = reqText(r)
  const qs = [...new Set(t.match(/Q-\d+/g) || [])]
  if (!qs.length || PENDING.test(t)) continue
  const qText = qs.map((q) => qMap.get(q)?.cells.slice(2, 5).join(' ') || '').join(' ')
  const unspecified = /未规定|未给|未明确|未说明|未定义|无依据|不明确|无判据|未提供/.test(qText)
  add(unspecified ? '必须处理' : '复核', 'R2 问题未关闭却已给答案', '规格说明', r.line,
    `${r.id} 引用了 ${qs.join('、')}${unspecified ? '（问题写明“未规定”）' : ''}，但描述中没有【待确认】。检查处理方式、数值、范围是不是自己定的`)
}

for (const id of derivedIds) {
  const r = reqs.get(id)
  if (r && !/Q-\d+/.test(r.text) && !PENDING.test(r.text)) add('复核', 'R3 派生需求无依据', '规格说明', r.line, `${id} 是派生需求，既没有关联待确认问题也没有【待确认】。确认内容确实可由任务书推出，否则改为【待确认】并关联问题`)
}

if (R) {
  const NUM = /(\d+(?:\.\d+)?)\s*(ms|μs|us|s|秒|毫秒|分钟|%|KB|MB|GB|kB|bps|kbps|Mbps|字节|位|路|次|℃|V|mA|Hz|kHz|MHz)/g
  for (const r of reqList) {
    for (const m of reqText(r).matchAll(NUM)) {
      const num = m[1]
      const re = new RegExp(`(^|[^\\d.])${num.replace('.', '\\.')}(?![\\d])`)
      if (!re.test(inputText)) add('复核', 'R4 数值无出处', '规格说明', r.line, `${r.id} 中的“${m[0]}”在上级条款摘录里找不到，确认能由上级条款算出，否则改为【待确认】`)
    }
  }
}

const BASIS = /按部门[^，。；|]{0,20}(规范|规定|要求|执行)|部门(文档|软件|配置管理)[^，。；|]{0,10}(规范|规定)|按\s*GJB\s*\d+[A-Z]?[^，。；|]{0,12}(要求|规定)|GJB\s*5000[AB]?[^，。；|]{0,12}(要求|补入|规定)|按惯例|按行业惯例|通常做法|一般情况下要求/g
const stdInInputs = new Set((clauseText.match(/(GJB|Q\/W-Q)[\s-]*[\d.A-Z-]+/g) || []).map((s) => s.replace(/\s/g, '')))
for (const d of [S, R].filter(Boolean)) {
  const appD = d === S ? section(S, /^附录\s*D/) : null
  d.lines.forEach((l, i) => {
    if (appD && i >= appD.start && i < appD.end) return
    for (const m of l.matchAll(BASIS)) {
      const std = (m[0].match(/GJB\s*\d+[A-Z]?/) || [''])[0].replace(/\s/g, '')
      if (std && stdInInputs.has(std) && !/5000/.test(std)) continue
      add('必须处理', 'R5 依据可疑', d.name, i + 1, `“${m[0]}”：这条规定是否出现在输入材料中？没有的话删去，或改为待确认问题`)
    }
  })
}

for (const r of coverRows) {
  const status = col(r, '覆盖情况', '覆盖')
  const note = col(r, '说明')
  const ids = col(r, '对应需求', '需求标识').match(ID) || []
  const pendingReq = ids.some((x) => reqs.has(x) && PENDING.test(reqs.get(x).text))
  if (status === '已覆盖' && ((/Q-\d+/.test(note) || PENDING.test(r.cells.join(' '))) && !/不在本次范围|不适用/.test(note) || pendingReq)) {
    add('复核', 'R6 覆盖状态', '分析记录', r.line, `${r.cells[0]} 判为“已覆盖”，但${pendingReq ? '对应需求中还有【待确认】' : '说明中还有待确认问题'}。要求在现有材料下不能完全实现时应为“部分覆盖”`)
  }
}

const VAGUE = /尽快|及时|适当|合理|必要时|视情况|自主恢复|不宜|足够|具备[^，。]{0,10}能力|一般|尽可能|尽量/
for (const r of reqList) {
  const b = b1Map.get(r.id)
  if (!b || PENDING.test(r.text)) continue
  const srcIds = col(b, '任务需求标识', '任务').split(/[、,，;；\s]+/).filter((x) => clauseMap.has(x))
  const vague = srcIds.map((id) => [id, VAGUE.exec(clauseMap.get(id))]).filter(([, m]) => m)
  if (vague.length) add('复核', 'R10 模糊条款被写具体', '规格说明', r.line, `${r.id} 的来源 ${vague.map(([id, m]) => `${id}（“${m[0]}”）`).join('、')} 是模糊表述，需求却没有【待确认】。具体内容若是自己定的，改为【待确认】并关联问题`)
}

// R12 计数满了以后的处理：部门约定是回绕（模 256 等），不用出处；写成饱和、保持最大值等别的处理，上级条款里这个计数附近没有写的，提示复核
// R13 时间指标的计时起点和终点：“自……起”“至……止”上级条款里找不到的，提示复核
if (R) {
  const flat = (x) => String(x || '').replace(/\s+/g, '')
  const inFlat = flat(inputText)
  const WRAP = /饱和|保持\s*(为|在)?\s*(255|65535|最大值)|不再(增加|累加|加\s*1)|停止计数|溢出后/
  for (const r of reqList) {
    reqText(r).split('\n').forEach((l, k) => {
      if (PENDING.test(l)) return
      const m = WRAP.exec(l)
      if (!m) return
      const before = l.slice(0, m.index)
      const subj = [...before.matchAll(/[一-龥A-Za-z]{0,8}(计数|次数|计次)/g)].pop()
      if (!subj) return
      const full = flat(subj[0]).replace(/^(第?\d*字节|的)/, '')
      const terms = []
      for (let n = full.length; n >= 3; n--) terms.push(full.slice(-n))  // “该通道的过流断电计数”→ 过流断电计数、断电计数、电计数、……
      const said = (term) => { let i = inFlat.indexOf(term); while (i >= 0) { if (WRAP.test(inFlat.slice(Math.max(0, i - 60), i + term.length + 60))) return true; i = inFlat.indexOf(term, i + 1) } return false }
      if (!terms.some(said)) add('复核', 'R12 计数溢出处理无出处', '规格说明', r.line + k, `${r.id}：“${subj[0]}”写了“${m[0]}”，上级条款里这个计数附近没有这样写。部门约定计数满了回绕（模 256 等）；要保持最大值等别的处理，得有任务书、协议或总体答复的出处，没有就按回绕写`)
    })
  }
  const TIME = /\d+(?:\.\d+)?\s*(ms|μs|us|s|秒|毫秒)/
  for (const r of reqList) {
    const t = reqText(r)
    if (!TIME.test(t)) continue
    t.split('\n').forEach((l, k) => {
      if (PENDING.test(l) || !TIME.test(l)) return
      for (const [re, what] of [[/(?:自|从)([^，。；|（）()]{2,30}?)(?:起|开始)/g, '计时起点'], [/至([^，。；|（）()]{2,30}?)止/g, '计时终点']]) {
        for (const m of l.matchAll(re)) {
          if (!inFlat.includes(flat(m[1]))) add('复核', 'R13 计时起止点无出处', '规格说明', r.line + k, `${r.id}：${what}“${m[1]}”在上级条款里找不到。任务书只给了时间上限、没说从哪里算到哪里时，起止点写【待确认】并列问题（时间指标没有起止点就不可测）`)
        }
      }
    })
  }
}

// R11 1553B 标准知识核对（与 references/mil-std-1553b.md 一致）
const MODE_TR = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 16: 1, 17: 0, 18: 1, 19: 1, 20: 0, 21: 0 }
const REF = '见 references/mil-std-1553b.md'
for (const d of [S, R].filter(Boolean)) d.lines.forEach((l, i) => {
  if (!/1553|方式码|状态字|子地址/.test(l)) return
  for (const m of l.matchAll(/(\d+(?:\.\d+)?)\s*[～~\-–至到]\s*(\d+(?:\.\d+)?)\s*(μs|us|微秒)/g)) {
    if (!/响应|窗口|应答/.test(l)) continue
    if (Number(m[1]) !== 4 || Number(m[2]) !== 12) add('必须处理', 'R11 1553B 标准核对', d.name, i + 1, `写了“${m[0]}”：MIL-STD-1553B 规定的 RT 响应时间为 4～12 μs（${REF}）`)
  }
  if (/T\/R/.test(l)) {
    const asserted = [...l.matchAll(/T\/R\s*位?\s*(?:应)?为\s*([01])/g)].map((m) => Number(m[1]))
    const codes = [...new Set([...l.matchAll(/方式码\s*(\d{1,2})(?:\s*[、和与,，]\s*(\d{1,2}))?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean).map(Number))]
    for (const tr of asserted) for (const c of codes) if (c in MODE_TR && MODE_TR[c] !== tr) add('必须处理', 'R11 1553B 标准核对', d.name, i + 1, `称方式码 ${c} 的 T/R 位为 ${tr}，标准规定为 ${MODE_TR[c]}（${REF}）`)
  }
  for (const m of l.matchAll(/(?:上限|最多|最大)[^。|]{0,8}?(\d+)\s*个?数据字/g)) if (Number(m[1]) !== 32) add('必须处理', 'R11 1553B 标准核对', d.name, i + 1, `写了每条消息“${m[0]}”：MIL-STD-1553B 每条消息最多 32 个数据字（${REF}）`)
  for (const m of l.matchAll(/广播地址\s*(?:为|是)?\s*(\d+)/g)) if (Number(m[1]) !== 31) add('必须处理', 'R11 1553B 标准核对', d.name, i + 1, `写了“${m[0]}”：广播地址为 31（${REF}）`)
  if (/(MIL-STD-1553B?|1553B)[^。|]{0,30}(规定|要求|保留|约定)/.test(l) && !/按\s*MIL-STD-1553B\s*规定的位序/.test(l)) add('提示', 'R11 1553B 标准核对', d.name, i + 1, '引用了 1553B 标准规定，确认内容在 references/mil-std-1553b.md 或输入材料中能找到')
})

for (const r of reqList) {
  const n = (reqText(r).match(/应/g) || []).length
  if (n >= 3) add('提示', 'R7 一条多事', '规格说明', r.line, `${r.id} 含 ${n} 个“应”，考虑拆分`)
}

// R12 模板示例被照抄（这些词只出现在模板示例里）
const EXAMPLE = /SoC2008|AOCC|SYS_Hook|AppTask1|NotWDT|XXCurrent|YYAngle|B65170S6RH|光纤陀螺|星敏不可见|UART1RxErr|SSP0DMADone|DMACIntErrClr|2019-6-1/g
if (S) S.lines.forEach((l, i) => { for (const m of l.matchAll(EXAMPLE)) if (!inputText.includes(m[0])) add('必须处理', 'R12 照抄模板示例', '规格说明', i + 1, `“${m[0]}”是部门模板示例中的内容，输入材料里没有。示例只是写法示范，不能抄进文档`) })

// R8 统计与正文一致
if (secStat) {
  const stat = text(secStat)
  const num = (label) => { const m = new RegExp(`${label}\\s*\\|\\s*(\\d+)`).exec(stat); return m ? Number(m[1]) : null }
  const checks = [
    ['需求条目总数', reqList.length], ['功能需求', reqList.filter((r) => /FREQ/.test(r.id)).length], ['性能需求', reqList.filter((r) => /PREQ/.test(r.id)).length],
    ['可靠性需求', reqList.filter((r) => /RREQ/.test(r.id)).length], ['安全性需求', reqList.filter((r) => /SREQ/.test(r.id)).length], ['接口需求', reqList.filter((r) => /IREQ/.test(r.id)).length],
    ['安全关键需求', reqList.filter((r) => /-K/.test(r.id)).length], ['派生需求', derivedIds.size], ['待确认问题总数', qRows.length], ['上级条款总数', clauseRows.length],
  ]
  for (const [label, actual] of checks) {
    const v = num(label)
    if (v === null) add('复核', 'R8 统计', '分析记录', secStat.start + 1, `统计中没有“${label}”一行`)
    else if (S && v !== actual) add('必须处理', 'R8 统计不一致', '分析记录', secStat.start + 1, `统计写${label} ${v}，实际 ${actual}`)
  }
}

// R9 引用了不存在的问题编号
const qIds = new Set(qRows.map((r) => r.cells[0]))
if (R) for (const d of [S, R].filter(Boolean)) {
  const seenQ = new Set()
  d.lines.forEach((l, i) => {
    if (d === R && secQ && i >= secQ.start && i < secQ.end) return
    for (const m of l.matchAll(/Q-\d{3}/g)) if (!qIds.has(m[0]) && !seenQ.has(m[0])) { seenQ.add(m[0]); add('必须处理', 'R9 问题编号不存在', d.name, i + 1, `引用了 ${m[0]}，但待确认问题清单中没有`) }
  })
}

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1, 提示: 2 }
findings.sort((a, b) => order[a.level] - order[b.level] || a.where.localeCompare(b.where) || a.line - b.line)
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log('# 需求分析自查结果\n')
console.log(`规格说明：${srsFile || '（未找到）'}`)
console.log(`分析记录：${recFile && R ? recFile : '（未找到）'}`)
console.log(`需求 ${reqList.length} 条（功能 ${reqList.filter((r) => /FREQ/.test(r.id)).length}、性能 ${reqList.filter((r) => /PREQ/.test(r.id)).length}、可靠性 ${reqList.filter((r) => /RREQ/.test(r.id)).length}、安全性 ${reqList.filter((r) => /SREQ/.test(r.id)).length}、接口 ${reqList.filter((r) => /IREQ/.test(r.id)).length}），上级条款 ${clauseRows.length} 条，待确认问题 ${qRows.length} 个`)
console.log(`必须处理 ${count('必须处理')} 项，复核 ${count('复核')} 项，提示 ${count('提示')} 项\n`)
for (const lv of ['必须处理', '复核', '提示']) {
  const list = findings.filter((f) => f.level === lv)
  if (!list.length) continue
  console.log(`## ${lv}\n`)
  for (const f of list) console.log(`- ${f.where}${f.line ? ` 第 ${f.line} 行` : ''}［${f.rule}］${f.msg}`)
  console.log('')
}
if (!findings.length) console.log('没有发现需要复核的地方。')
process.exit(count('必须处理') ? 1 : 0)
