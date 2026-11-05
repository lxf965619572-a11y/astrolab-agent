#!/usr/bin/env node
// 详细设计自查脚本：把《软件详细设计说明》（部门模板 02-2）和《详细设计记录》对起来，按固定规则检查
// 章节结构、单元齐全、单元 6 个小节和表格、需求追溯、数值出处、可测试性、共享数据保护、流程图、跟踪矩阵，
// 逆向模式下核对代码中的函数是否都有设计、是否把代码当作设计依据。只读。“必须处理”项要改正，“复核”项逐条判断。
//
// 用法：node check-design.mjs <软件详细设计说明.md> [--record <详细设计记录.md>] [--module <模块标识>] [--code <源代码目录>]
//   --record：不给时自动找同目录下的“详细设计记录-*.md”
//   --module：只检查这个模块一章的单元（文档按模块逐步补充时用）；结构和附录照常检查
//   --code：逆向模式，核对代码中的函数（与 --module 合用时只取该模块的代码目录）
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
const codeDir = opt('--code')
const onlyModule = opt('--module')
let recFile = opt('--record')
const file = args[0]
if (!file) { console.error('用法：node check-design.mjs <软件详细设计说明.md> [--record <详细设计记录.md>] [--module <模块标识>] [--code <源代码目录>]'); process.exit(2) }
if (!recFile) {
  try { const pick = readdirSync(dirname(file)).filter((f) => /详细设计记录/.test(f) && f.endsWith('.md')).sort().at(-1); if (pick) recFile = join(dirname(file), pick) } catch { /* 忽略 */ }
}
const load = (f) => { try { return readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/) } catch (e) { console.error(`读不到文件：${f}（${e.message}）`); process.exit(2) } }
const notes = []

// —— 流程图解析器 ——
let parseFlowchart = null
{
  const here = dirname(fileURLToPath(import.meta.url))
  const cands = []
  if (process.env.ASTROLAB_ROOT) cands.push(join(process.env.ASTROLAB_ROOT, 'mcp', 'docgen', 'lib', 'flowchart.mjs'))
  let d = here
  for (let i = 0; i < 8; i++) { cands.push(join(d, 'mcp', 'docgen', 'lib', 'flowchart.mjs')); d = dirname(d) }
  const hit = cands.find((p) => existsSync(p))
  if (hit) { try { ({ parseFlowchart } = await import(pathToFileURL(hit).href)) } catch { /* 忽略 */ } }
  if (!parseFlowchart) notes.push('没有找到流程图解析器（mcp/docgen/lib/flowchart.mjs），流程图语法未检查')
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
function sec(d, h) { const next = d.heads.find((x) => x.line > h.line && x.level <= h.level); return { d, title: h.title, start: h.line, end: next ? next.line : d.lines.length } }
function section(d, pattern, within = null) {
  if (!d) return null
  const h = d.heads.find((x) => pattern.test(x.title) && (!within || (x.line > within.start && x.line < within.end)))
  return h ? sec(d, h) : null
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
function rows(s, headerHas = null) {
  if (!s) return []
  const out = []
  let header = null
  for (let i = s.start; i < s.end; i++) {
    const l = s.d.lines[i]
    if (!l.trim().startsWith('|')) { header = null; continue }
    if (/^\s*\|?\s*:?-{2,}/.test(l)) continue
    const cells = splitRow(l)
    if (!header) { header = cells; continue }
    out.push({ line: i + 1, cells, header })
  }
  return headerHas ? out.filter((r) => r.header.some((h) => h.includes(headerHas))) : out
}
const col = (r, ...names) => { for (const n of names) { const k = r.header.findIndex((h) => h.includes(n)); if (k >= 0) return r.cells[k] ?? '' } return '' }
const secText = (s) => (s ? s.d.lines.slice(s.start, s.end).join('\n') : '')
const inSec = (s, i) => s && i >= s.start && i < s.end
const empty = (s) => !s || /^(—|-|－|\/|…+)$/.test(String(s).trim())

const findings = []
const seen = new Set()
const add = (level, rule, where, line, msg) => {
  const key = `${rule}|${where}|${line}|${msg}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ level, rule, where, line, msg })
}

// —— DS1 章节结构 ——
const REQUIRED = [
  ['1', '范围'], ['1.1', '标识'], ['1.2', '系统概述'], ['1.3', '文档概述'], ['1.4', '术语和缩略语'], ['1.5', '技术状态变更'],
  ['2', '引用文件'], ['3', '总体设计'], ['3.1', '系统组成'], ['3.2', '软件开发环境及约束'], ['3.3', '运行环境'], ['3.3.1', '硬件环境'], ['3.3.2', '软件环境'],
  ['3.4', '软件功能描述'], ['3.5', '设计决策'], ['3.5.1', '设计决策'], ['3.5.2', '备选方案'], ['3.5.3', '选择准则'], ['3.5.4', '选取的最佳备选方案'], ['3.6', '复用说明'],
  ['4', 'CSCI详细设计'], ['4.1', '体系结构设计'], ['5', '其他设计'], ['5.1', '注释设计'], ['5.2', '编程编译规范性'], ['5.2.1', '编程规范要求'], ['5.2.2', '编译规范性要求'],
  ['附录A', '跟踪矩阵'], ['附录B', '更改记录'], ['附录C', '确认检查表'],
]
const norm = (s) => s.replace(/\s+/g, '').replace(/[《》]/g, '').replace(/其它/g, '其他')
{
  const titles = D.heads.map((h) => norm(h.title))
  for (const [num, name] of REQUIRED) {
    const n = norm(num)
    const ok = titles.some((t) => (t.startsWith(n) && t.slice(n.length).replace(/^[.．、]/, '').startsWith(norm(name))) || (n.startsWith('附录') && t.startsWith(n) && t.includes(norm(name))))
    if (!ok) add('必须处理', 'DS1 章节结构', '设计说明', 0, titles.some((t) => t.replace(/^(附录)?[A-Z]?[\d.．]*/, '') === norm(name)) ? `“${num} ${name}”的章节号不对：部门模板要求编号为 ${num}` : `缺少“${num} ${name}”一节（按部门模板，没有内容也要保留并写“无”）`)
  }
  for (const [bad, good] of [[/^2\s*引用文档/, '2 引用文件'], [/^3\.1\s*系统结构/, '3.1 系统组成'], [/软件开发环境及约定/, '3.2 软件开发环境及约束'], [/设计决策项/, '3.5.1 设计决策'], [/选择原则/, '3.5.3 选择准则'], [/^4\.1\s*系统结构设计/, '4.1 体系结构设计'], [/编程准确性/, '5.2 编程编译规范性'], [/修改记录/, '附录B 更改记录']]) {
    D.heads.forEach((h) => { if (bad.test(h.title)) add('必须处理', 'DS1 章节结构', '设计说明', h.line + 1, `“${h.title}”与部门模板不一致，应为“${good}”`) })
  }
}
if (!R) add('必须处理', '结构', '设计记录', 0, '没有找到详细设计记录（同目录下的“详细设计记录-<软件简称>.md”）：设计依据、待确认问题无从核对')

// —— 模块和单元 ——
const modules = D.heads.filter((h) => /^4\.\d+\s+\S+\s*模块详细设计/.test(h.title)).map((h) => {
  const m = /^4\.(\d+)\s+`?([A-Za-z_][\w]*)`?/.exec(h.title)
  return { idx: m ? Number(m[1]) : 0, id: m ? m[2] : h.title, ...sec(D, h) }
})
const sec4 = section(D, /^4\s*CSCI/i)
if (sec4 && !modules.length) add('必须处理', 'DS2 模块', '设计说明', sec4.start + 1, '第 4 章中没有“4.2 <模块标识> 模块详细设计”形式的模块一节')
if (onlyModule && !modules.some((m) => m.id === onlyModule)) { console.error(`文档中没有模块 ${onlyModule}（标题“4.x ${onlyModule} 模块详细设计”）`); process.exit(2) }
const units = []
for (const m of modules) {
  const md = D.heads.find((h) => h.line > m.start && h.line < m.end && new RegExp(`^4\\.${m.idx}\\.1\\s*模块设计`).test(h.title))
  m.design = md ? sec(D, md) : null
  if (!md) add('必须处理', 'DS2 模块设计', '设计说明', m.start + 1, `模块 ${m.id} 没有“4.${m.idx}.1 模块设计”一节`)
  for (const h of D.heads.filter((x) => x.line > m.start && x.line < m.end && new RegExp(`^4\\.${m.idx}\\.(\\d+)\\s`).test(x.title))) {
    const n = Number(new RegExp(`^4\\.${m.idx}\\.(\\d+)`).exec(h.title)[1])
    if (n < 2 || /^4\.\d+\.\d+\.\d+/.test(h.title)) continue
    const u = /^4\.\d+\.\d+\s+`?([A-Za-z_]\w*)`?\s*(?:\(\))?\s*(软件单元设计)?/.exec(h.title)
    if (!u || !u[2]) { add('必须处理', 'DS3 单元标题', '设计说明', h.line + 1, `“${h.title}”：单元一节的标题应为“4.${m.idx}.${n} <函数名> 软件单元设计”`); continue }
    units.push({ name: u[1], mod: m, num: `4.${m.idx}.${n}`, ...sec(D, h) })
  }
}
const active = (u) => !onlyModule || u.mod.id === onlyModule
const activeMod = (m) => !onlyModule || m.id === onlyModule

// 4.m.1 中的单元划分表和模块数据
for (const m of modules.filter(activeMod)) {
  if (!m.design) continue
  const listRows = rows(m.design, '单元标识')
  const listed = new Map(listRows.map((r) => [(/([A-Za-z_]\w*)/.exec(col(r, '单元标识')) || [])[1], r]).filter(([k]) => k))
  if (!listRows.length) add('必须处理', 'DS2 单元划分', '设计说明', m.design.start + 1, `模块 ${m.id} 的模块设计中没有“| 单元标识（DD） | 单元名称 | 类型 | 调用者 | 执行环境 |”表格`)
  const mine = units.filter((u) => u.mod === m)
  for (const [name, r] of listed) if (!mine.some((u) => u.name === name)) add('必须处理', 'DS3 单元缺少设计', '设计说明', r.line, `模块 ${m.id} 的单元 ${name} 没有“软件单元设计”一节`)
  for (const u of mine) if (listRows.length && !listed.has(u.name)) add('必须处理', 'DS3 单元划分不全', '设计说明', u.start + 1, `${u.name} 有设计一节，但不在 ${m.id} 的单元划分表中`)
  m.listed = listed
  if (!/```\s*mermaid/i.test(secText(m.design))) add('复核', 'DS2 调用关系图', '设计说明', m.design.start + 1, `模块 ${m.id} 的模块设计中没有调用关系图`)
}

// —— DS4 单元的 6 个小节 ——
const unitInfo = new Map()
for (const u of units.filter(active)) {
  const sub = (k) => { const h = D.heads.find((x) => x.line > u.start && x.line < u.end && new RegExp(`^${u.num.replace(/\./g, '\\.')}\\.${k}\\s`).test(x.title)); return h ? sec(D, h) : null }
  const S = { 简述: sub(1), 输入输出: sub(2), 局部变量: sub(3), 处理流程: sub(4), 限制条件: sub(5), 其他: sub(6) }
  const names = { 简述: '简述', 输入输出: '输入输出', 局部变量: '局部变量及数据结构', 处理流程: '处理流程', 限制条件: '限制条件', 其他: '其他' }
  for (const [k, s] of Object.entries(S)) {
    if (!s) add('必须处理', 'DS4 单元小节', '设计说明', u.start + 1, `${u.name} 缺少“${u.num}.${Object.keys(S).indexOf(k) + 1} ${names[k]}”`)
    else if (!s.d.lines.slice(s.start + 1, s.end).join('').trim()) add('必须处理', 'DS4 单元小节为空', '设计说明', s.start + 1, `${u.name} 的“${names[k]}”为空（没有的写“无”）`)
  }
  const brief = secText(S.简述)
  const item = (label) => { const m = new RegExp(`${label}\\s*[:：]\\s*(.*)`).exec(brief); return m ? m[1].trim() : null }
  for (const label of ['功能概述', '设计思路', '设计约束', '对应的需求']) { const v = item(label); if (S.简述 && (v === null || empty(v))) add('必须处理', 'DS4 简述', '设计说明', S.简述.start + 1, `${u.name} 的简述缺少“${label}”`) }
  const io = secText(S.输入输出)
  const proto = (/函数原型\s*[:：]\s*`?([^`\n]+)`?/.exec(io) || [])[1] || ''
  if (S.输入输出 && !proto) add('必须处理', 'DS4 函数原型', '设计说明', S.输入输出.start + 1, `${u.name} 的输入输出中没有“函数原型：\`...\`”`)
  if (proto && !new RegExp(`\\b${u.name}\\s*\\(`).test(proto)) add('必须处理', 'DS4 函数原型', '设计说明', S.输入输出.start + 1, `${u.name} 的函数原型“${proto}”中的函数名与标题不一致`)
  const t1 = rows(S.输入输出, '参数名称'), t2 = rows(S.输入输出, '数据来源'), t3 = rows(S.输入输出, '全局变量或资源'), t4 = rows(S.输入输出, '中断和信号量')
  for (const [t, nm, hdr] of [[t1, '函数的形参表和返回值', '类型 | 长度 | 参数名称 | 描述'], [t2, '数据元素表', '数据名称 | 数据来源 | 判断条件 | 有效性判断方法 | 判断结果生存时间 | 数据无效时的处理策略'], [t3, '全局变量或资源表', '全局变量或资源名称 | 使用方法 | 是否具有原子属性 | 防止原子属性被破坏的解决措施'], [t4, '中断和信号量表', '中断和信号量名称 | 发起或处理方法']]) {
    if (S.输入输出 && !t.length) add('必须处理', 'DS4 输入输出表', '设计说明', S.输入输出.start + 1, `${u.name} 缺少${nm}（| ${hdr} |），没有内容的写一行“无”`)
  }
  if (t2.length && t2[0].header.length < 6) add('必须处理', 'DS4 输入输出表', '设计说明', t2[0].line, `${u.name} 的数据元素表应为 6 列：数据名称 | 数据来源 | 判断条件 | 有效性判断方法 | 判断结果生存时间 | 数据无效时的处理策略`)
  if (t3.length && t3[0].header.length < 4) add('必须处理', 'DS4 输入输出表', '设计说明', t3[0].line, `${u.name} 的全局变量或资源表应为 4 列：全局变量或资源名称 | 使用方法 | 是否具有原子属性 | 防止原子属性被破坏的解决措施`)
  if (proto && !/^\s*(static\s+)?void\s+\w+\s*\(/.test(proto) && t1.length && !t1.some((r) => /返回值/.test(col(r, '参数名称')))) add('必须处理', 'DS4 返回值', '设计说明', t1[0].line, `${u.name} 有返回值，形参表中没有“返回值”一行（写出每种返回值及其条件）`)
  for (const r of t3) if (/是/.test(col(r, '原子')) && empty(col(r, '解决措施', '措施'))) add('必须处理', 'DS7 共享数据无保护', '设计说明', r.line, `${u.name}：${r.cells[0]} 具有原子属性，没有写防止原子属性被破坏的措施`)
  const flow = S.处理流程 ? D.lines.slice(S.处理流程.start, S.处理流程.end) : []
  const steps = flow.filter((l) => /^\s*(\d+[.、)]|\d+\.\d+)\s*\S/.test(l))
  if (S.处理流程 && !steps.length) add('必须处理', 'DS4 处理流程', '设计说明', S.处理流程.start + 1, `${u.name} 的处理流程没有编号的处理步骤`)
  unitInfo.set(u.name, { u, S, proto, env: item('设计约束') || '', trace: item('对应的需求') || '', steps, hasMermaid: flow.some((l) => /^\s*```\s*mermaid/i.test(l)), body: D.lines.slice(u.start, u.end).join('\n'), t3 })
}

// —— DS5 跟踪矩阵（附录 A）——
const secA = section(D, /^附录\s*A/)
const t61 = rows(secA).filter((r) => r.header.some((h) => /部件标识|PD/.test(h)) && r.header.findIndex((h) => /部件标识|PD/.test(h)) < r.header.findIndex((h) => /单元标识|DD/.test(h)))
const t62 = rows(secA).filter((r) => r.header.some((h) => /单元标识|DD/.test(h)) && r.header.findIndex((h) => /单元标识|DD/.test(h)) < r.header.findIndex((h) => /部件标识|PD/.test(h)))
const pick = (r, re) => r.cells[r.header.findIndex((h) => re.test(h))] || ''
for (const [t, nm] of [[t61, '表 6-1 软件部件与软件单元间的追踪关系'], [t62, '表 6-2 软件单元与软件部件间的追踪关系']]) {
  if (secA && !t.length) add('必须处理', 'DS5 跟踪矩阵', '设计说明', secA.start + 1, `附录 A 中没有${nm}`)
  const pairs = new Set(t.map((r) => `${pick(r, /部件标识|PD/).replace(/[`*]/g, '').trim()}|${pick(r, /单元标识|DD/).replace(/[`*()]/g, '').trim()}`))
  if (t.length) for (const u of units) if (!pairs.has(`${u.mod.id}|${u.name}`)) add('必须处理', 'DS5 跟踪矩阵', '设计说明', t[0].line, `${nm}中没有 ${u.mod.id} → ${u.name}`)
}

// —— DS6 附录 C 检查表 ——
const secC = section(D, /^附录\s*C/)
if (secC) {
  const all = rows(secC).filter((r) => /^\d+$/.test(r.cells[0].trim()))
  const common = all.filter((r) => r.header.some((h) => h.includes('要素名称')))
  const special = all.filter((r) => !r.header.some((h) => h.includes('要素名称')))
  if (common.length < 12) add('复核', 'DS6 确认检查表', '设计说明', secC.start + 1, `附录 C 通用要素只有 ${common.length} 项，部门模板为 12 项`)
  if (special.length < 23) add('复核', 'DS6 确认检查表', '设计说明', secC.start + 1, `专用要素确认检查表只有 ${special.length} 项，部门模板为 23 项（不适用的在章节号列写“不适用”）`)
  for (const r of [...common, ...special]) if (empty(col(r, '章节号'))) add('复核', 'DS6 确认检查表', '设计说明', r.line, `第 ${r.cells[0]} 项没有填章节号（不适用的写“不适用”）`)
}

// —— 记录：设计依据、问题、不一致 ——
const secBasis = section(R, /设计依据/)
const secQ = section(R, /待确认问题/)
const secN = section(R, /不一致/)
const secDec = section(D, /^3\.5\.1/)
const REQ_RE = /\b[A-Z][A-Z0-9]*-(?:[A-Z]{2,4}-\d{3}|FREQ\d{3}(?:-(?:KN|K|N))?|[PI]REQ\d+\.\d+|[RS]REQ\d+)(?![\w.])/g
const baseId = (id) => id.replace(/-(?:KN|K|N)$/, '')
const basisByMod = new Map()
if (secBasis) {
  for (const h of R.heads.filter((x) => x.line > secBasis.start && x.line < secBasis.end && x.level > R.heads.find((y) => y.line === secBasis.start).level)) {
    const m = /^[\d.]*\s*`?([A-Za-z_]\w*)`?/.exec(h.title)
    if (!m) continue
    const s = sec(R, h)
    const ids = new Set()
    for (const r of rows(s, '需求标识')) for (const x of r.cells[0].matchAll(REQ_RE)) ids.add(baseId(x[0]))
    basisByMod.set(m[1], { s, ids })
  }
}
if (R && !secBasis) add('必须处理', '结构', '设计记录', 0, '设计记录中没有“设计依据”一章')
if (R && !secQ) add('必须处理', '结构', '设计记录', 0, '设计记录中没有“待确认问题”一章')
const allBasisIds = new Set([...basisByMod.values()].flatMap((b) => [...b.ids]))
for (const m of modules.filter(activeMod)) {
  const b = basisByMod.get(m.id)
  if (R && !b) { add('必须处理', 'DS7 设计依据', '设计记录', secBasis ? secBasis.start + 1 : 0, `设计依据中没有模块 ${m.id} 的小节（### 2.x ${m.id}）`); continue }
  if (b && !b.ids.size) add('必须处理', 'DS7 设计依据无需求', '设计记录', b.s.start + 1, `模块 ${m.id} 的设计依据中没有摘录 SRS 需求（| 需求标识 | 原文 |）`)
  if (!b) continue
  const traced = new Set(units.filter((u) => u.mod === m).flatMap((u) => [...(unitInfo.get(u.name)?.trace || '').matchAll(REQ_RE)].map((x) => baseId(x[0]))))
  for (const id of b.ids) if (!traced.has(id)) add('必须处理', 'DS7 需求未落实', '设计说明', m.start + 1, `模块 ${m.id} 的设计依据中的 ${id} 没有出现在任何单元的“对应的需求”中`)
}
for (const [name, fi] of unitInfo) {
  const internal = /^\s*static\b/.test(fi.proto) || /内部(函数|单元)/.test(col(fi.u.mod.listed?.get(name) || { header: [], cells: [] }, '类型'))
  const ids = [...fi.trace.matchAll(REQ_RE)].map((x) => baseId(x[0]))
  if (!internal && !ids.length) add('必须处理', 'DS7 对外单元无追溯', '设计说明', fi.u.start + 1, `对外单元 ${name} 的“对应的需求”中没有需求标识`)
  if (internal && !ids.length && !/内部函数|支持/.test(fi.trace)) add('复核', 'DS7 内部单元追溯', '设计说明', fi.u.start + 1, `内部单元 ${name} 的“对应的需求”写“内部函数，支持 <对外函数>”`)
  for (const id of ids) if (allBasisIds.size && !allBasisIds.has(id)) add('必须处理', 'DS7 需求不在依据中', '设计说明', fi.u.start + 1, `${name} 对应 ${id}，但设计依据中没有摘录这条需求`)
}

// —— DS8 含糊词 ——
const VAGUE_MUST = /(适当(地)?(延时|等待|处理)|相应(的)?处理|必要的处理|视情况|酌情)/
const VAGUE_REVIEW = /(适当|合理的?|尽快|及时|必要时|若干|一定的|等等|左右|大约|尽量|一般情况下)/
for (const [name, fi] of unitInfo) {
  for (let i = fi.u.start; i < fi.u.end; i++) {
    const l = D.lines[i]
    if (/^\s*```/.test(l)) continue
    let m
    if ((m = VAGUE_MUST.exec(l))) add('必须处理', 'DS8 含糊表述', '设计说明', i + 1, `${name}：“${m[0]}”不可测试，写出具体的条件、数值和动作；上级文件没有规定的列为待确认问题`)
    else if ((m = VAGUE_REVIEW.exec(l))) add('复核', 'DS8 含糊表述', '设计说明', i + 1, `${name}：“${m[0]}”，确认是否写清了具体的条件或数值`)
  }
}

// —— DS9 数值出处 ——
const normNum = (s) => s.replace(/\s+/g, '').replace(/μs|us/gi, 'μs').toLowerCase()
const expandRanges = (t) => t.replace(/(\d+(?:\.\d+)?)\s*[～~\-–—至到]\s*(\d+(?:\.\d+)?)\s*(ms|μs|us|s|kHz|MHz|Hz|字节|位|bit|ns|路)/g, '$1 $3 $2 $3 $&')
const sourceText = normNum(expandRanges(secText(secBasis) + '\n' + secText(secDec)))
const numRe = /(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?)\s*(ms|μs|us|s|kHz|MHz|Hz|字节|位|bit|ns)(?![A-Za-z])/g
const hexRe = /\b0x[0-9A-Fa-f]{2,}\b/g
if (R) {
  let fence = false
  let tblHead = null
  const scope = onlyModule ? modules.find((m) => m.id === onlyModule) : section(D, /^4\s*CSCI/i)
  D.lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (l.trim().startsWith('|')) { if (tblHead === null) tblHead = l } else tblHead = null
    if (fence || !inSec(scope, i) || /^#/.test(l)) return
    if (tblHead && /长度/.test(tblHead) && /类型/.test(tblHead)) return // 形参表、局部变量表的“长度”列是类型宽度，不要求出处
    const t = l.replace(/`[^`]*`/g, '')
    if (/估计|估算|推算|待测|约/.test(t)) return
    for (const m of t.matchAll(numRe)) {
      if (/^(0|1)$/.test(m[1]) && !/ms|μs|us|s$/.test(m[2])) continue
      if (!sourceText.includes(normNum(m[0])) && !(m[2] === '位' && sourceText.includes(normNum(m[1])))) add('复核', 'DS9 数值无出处', '设计说明', i + 1, `“${m[0].trim()}”在设计依据和设计决策（3.5.1）中找不到，确认出处（上级文件条款或 D-xxx）`)
    }
    for (const m of t.matchAll(hexRe)) if (!sourceText.includes(m[0].toLowerCase())) add('复核', 'DS9 数值无出处', '设计说明', i + 1, `“${m[0]}”在设计依据和设计决策中找不到；寄存器地址、掩码要来自接口文件，或能由其直接推出（在设计决策中说明）`)
  })
}

// —— DS10 编号引用 ——
const ids = (s, re) => new Set(rows(s).map((r) => (re.exec(r.cells[0]) || [])[0]).filter(Boolean))
const qIds = ids(secQ, /Q-\d{3}/)
const dIds = ids(secDec, /D-\d{3}/)
const nIds = ids(secN, /N-\d{3}/)
if (R) for (const d of [D, R]) {
  const missing = new Set()
  d.lines.forEach((l, i) => {
    for (const [re, set, s, what] of [[/Q-\d{3}/g, qIds, secQ, '设计记录的待确认问题表'], [/\bD-\d{3}\b/g, dIds, secDec, '3.5.1 设计决策表'], [/\bN-\d{3}\b/g, nIds, secN, '设计记录的不一致清单']]) {
      if (s && s.d === d && inSec(s, i)) continue
      for (const m of l.matchAll(re)) if (!set.has(m[0]) && !missing.has(m[0])) { missing.add(m[0]); add('必须处理', 'DS10 编号不存在', d.name, i + 1, `引用了 ${m[0]}，但${what}中没有`) }
    }
    if (/【待确认】/.test(l) && !/Q-\d{3}/.test(l) && !(d === R && inSec(secQ, i))) add('必须处理', 'DS10 待确认未关联问题', d.name, i + 1, '有【待确认】但没有关联 Q-xxx')
  })
}
for (const r of rows(secDec)) {
  if (!/D-\d{3}/.test(r.cells[0])) continue
  if (empty(col(r, '理由'))) add('必须处理', 'DS10 设计决策无理由', '设计说明', r.line, `${r.cells[0]} 没有写理由`)
  if (/计入|只统计|计数(的含义|方式|规则|加\s*1)|故障时.{0,10}(断开|复位|停止)|故障处理方式|遥测内容|返回值含义/.test(col(r, '决策')) && !/Q-\d{3}/.test(r.cells.join(' '))) add('复核', 'DS10 设计决策涉及外部可见行为', '设计说明', r.line, `${r.cells[0]} 的决策涉及计数、故障处理或遥测等外部可见的行为：上级文件没有规定的应列为待确认问题，不由设计决策确定`)
}
for (const r of rows(secQ)) if (/Q-\d{3}/.test(r.cells[0]) && empty(col(r, '依据'))) add('复核', 'DS10 待确认问题无依据', '设计记录', r.line, `${r.cells[0]} 没有引用上级文件原文`)

// —— DS11 流程图 ——
const IN_ISR = /(在|于)[^，。；|]{0,10}中断(服务程序)?中(运行|执行|调用)?|中断服务程序(中|调用|内)|定时中断(调用|中|服务)|中断上下文|ISR/
for (const [name, fi] of unitInfo) {
  const isIsr = /_isr$/i.test(name) || (IN_ISR.test(fi.env) && !/中断(尚未|未)开/.test(fi.env))
  const flowText = fi.S.处理流程 ? secText(fi.S.处理流程) : ''
  const loops = /((?<![不无])等待|超时|(?<!主)循环|重试|状态机|直到)/.test(flowText.replace(/不等待|无等待/g, ''))
  const decisions = (flowText.match(/(若|如果|当.{0,20}时|否则|为真|为假|>=|<=|≥|≤|不等于|等于)/g) || []).length
  if (!fi.hasMermaid) {
    if (isIsr) add('必须处理', 'DS11 缺少流程图', '设计说明', fi.u.start + 1, `${name} 在中断中运行，必须有流程图`)
    else if (loops || decisions >= 4) add('复核', 'DS11 缺少流程图', '设计说明', fi.u.start + 1, `${name} 含${loops ? '等待/循环' : `较多判断（约 ${decisions} 处）`}，按规则应有流程图`)
  }
}
if (parseFlowchart) {
  let fence = null, buf = [], startLine = 0
  D.lines.forEach((l, i) => {
    if (fence === null && /^\s*```\s*mermaid/i.test(l)) { fence = 'm'; buf = []; startLine = i + 1; return }
    if (fence && /^\s*```/.test(l)) {
      const g = parseFlowchart(buf.join('\n'))
      const inFlow = [...unitInfo.values()].some((fi) => fi.S.处理流程 && inSec(fi.S.处理流程, startLine))
      if (g.errors?.length) add('必须处理', 'DS11 流程图语法', '设计说明', startLine, `流程图无法转换为 Word 图形：${g.errors.join('；')}（写法见 flowchart-guide.md）`)
      else if (inFlow && g.nodes.some((n) => n.shape === 'decision' || n.shape === 'terminal')) {
        for (const n of g.nodes) {
          const k = g.edges.filter((e) => e.from === n.id)
          if (n.shape === 'decision' && k.length < 2) add('必须处理', 'DS11 流程图判断出口', '设计说明', startLine, `判断节点“${n.text}”只有 ${k.length} 个出口`)
          if (n.shape === 'decision' && k.length >= 2 && k.some((e) => !e.label)) add('复核', 'DS11 流程图判断出口', '设计说明', startLine, `判断节点“${n.text}”有出口没有标注是/否`)
          if (n.shape !== 'terminal' && !k.length) add('必须处理', 'DS11 流程图断头', '设计说明', startLine, `节点“${n.text}”没有出线，每条路径应结束于“返回/结束”`)
        }
      }
      fence = null
      return
    }
    if (fence) buf.push(l)
  })
}

// —— DS12 共享数据保护（模块数据中的变量表）——
const fnEnv = new Map([...unitInfo].map(([n, fi]) => [n, fi.env]))
for (const m of modules.filter(activeMod)) {
  const varRows = rows(m.design, '读写者')
  for (const r of varRows) {
    const who = col(r, '读写')
    const prot = col(r, '保护')
    const names = [...who.matchAll(/[A-Za-z_]\w*/g)].map((x) => x[0])
    const envs = names.map((n) => fnEnv.get(n) || '').join(' ') + ' ' + who
    const isr = /中断|isr/i.test(envs)
    const main = /主循环|任务|main/i.test(envs) || names.some((n) => fnEnv.get(n) && !/中断|isr/i.test(fnEnv.get(n)))
    if (isr && main && (!prot || /^(无|—|-|不需要)$/.test(prot))) add('必须处理', 'DS12 共享数据无保护', '设计说明', r.line, `${r.cells[0]} 由中断和主循环共同访问，“保护”一栏要写明保护方式（关中断范围、volatile 等）`)
  }
  if (m.design && !varRows.length && !/无模块级|没有全局|无全局/.test(secText(m.design))) add('复核', 'DS12 变量表', '设计说明', m.design.start + 1, `模块 ${m.id} 的模块数据中没有含“读写者”列的全局和静态变量表（没有的写“无全局和静态变量”）`)
}

// —— DS13 自行裁决、以代码为依据、照抄示例 ——
const ADJ = /(取较(严|小|大|保守)的?值?|以\s*(概要设计|需求规格说明|SRS|任务书|接口文件|ICD)\s*为准|按\s*(概要设计|需求规格说明|SRS)\s*执行|两者取|统一(为|取)|按较(严|新)的?)/
const FROM_CODE = /(按|依据|根据|参照|沿用)(现有|已有|原有)?(代码|源码|程序|实现)|代码中(为|是|的值为|定义为)|见代码|与代码一致/
const EXAMPLE = /\b(ucXXXpara|iXXXpara|bXXXpara)\b|星务数据存储模块|GPS 原始测量数据/g
D.lines.forEach((l, i) => {
  let m
  if ((m = ADJ.exec(l)) && !/Q-\d{3}/.test(l)) add('必须处理', 'DS13 自行裁决', '设计说明', i + 1, `“${m[0]}”：上级文件之间矛盾时应列为待确认问题并引用两处原文，不在设计中选择`)
  if ((m = FROM_CODE.exec(l)) && !/^\s*#/.test(l) && !/1\.3/.test(D.heads.filter((h) => h.line <= i).at(-1)?.title || '')) add('必须处理', 'DS13 以代码为依据', '设计说明', i + 1, `“${m[0]}”：设计应描述上级文件要求的行为；代码的做法只写在记录的不一致清单或待确认问题的“现有代码的做法”中`)
  for (const x of l.matchAll(EXAMPLE)) add('必须处理', 'DS13 照抄模板示例', '设计说明', i + 1, `“${x[0]}”是部门模板示例中的内容，不能抄进文档`)
})

// —— DS14 逆向模式 ——
let codeFns = []
if (codeDir) {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
  let files = []
  try { files = walk(resolve(codeDir)).filter((p) => /\.(c|h)$/i.test(p)) } catch (e) { console.error(`读不到代码目录：${codeDir}（${e.message}）`); process.exit(2) }
  for (const p of files) {
    if (!/\.c$/i.test(p)) continue
    const t = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
    for (const m of t.matchAll(/^[A-Za-z_][\w \t\*]*?\b([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*\{/gm)) {
      if (/^(if|while|for|switch|return|sizeof)$/.test(m[1])) continue
      codeFns.push({ name: m[1], proto: m[0].replace(/\s*\{$/, '').replace(/\s+/g, ' ').trim(), file: basename(p) })
    }
  }
  const designed = new Map([...unitInfo].map(([n, fi]) => [n, fi]))
  for (const [name, fi] of designed) if (codeFns.length && !codeFns.some((c) => c.name === name)) add('复核', 'DS14 设计的单元代码中没有', '设计说明', fi.u.start + 1, `${name} 有设计，但代码中没有这个函数：是建议新增的（写入不一致清单），还是名字写错了？`)
  for (const f of codeFns) if (!designed.has(f.name)) add('必须处理', 'DS14 代码函数缺少设计', '设计说明', 0, `代码中的函数 ${f.name}（${f.file}）没有“软件单元设计”一节（static 函数也要写）`)
  if (!codeFns.length) notes.push(`代码目录 ${codeDir} 中没有找到函数定义`)
  const nRows = rows(secN).filter((r) => /N-\d{3}/.test(r.cells[0]))
  if (R && !nRows.length) add('复核', 'DS14 不一致清单为空', '设计记录', secN ? secN.start + 1 : 0, '逆向模式下没有列出任何代码与上级文件的不一致：确认已逐个函数对照过')
  for (const r of nRows) if (!/疑似代码缺陷|上级文件之间矛盾|上级文件未规定/.test(col(r, '结论'))) add('必须处理', 'DS14 结论', '设计记录', r.line, `${r.cells[0]} 的结论应为“疑似代码缺陷”“上级文件之间矛盾”“上级文件未规定”之一`)
  const normP = (s) => s.replace(/`/g, '').replace(/\s*([(),*])\s*/g, '$1').replace(/\s+/g, ' ').trim()
  for (const f of codeFns) { const fi = designed.get(f.name); if (fi && fi.proto && normP(fi.proto) !== normP(f.proto)) add('复核', 'DS14 原型与代码不同', '设计说明', fi.u.start + 1, `${f.name} 的原型与代码不同：设计“${fi.proto}”，代码“${f.proto}”。有意不同的（如代码与接口文件不一致）写入不一致清单`) }
} else if (rows(secN).some((r) => /N-\d{3}/.test(r.cells[0]))) notes.push('记录中有代码不一致清单，但没有指定 --code，未核对代码中的函数')

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1 }
findings.sort((a, b) => order[a.level] - order[b.level] || a.where.localeCompare(b.where) || a.line - b.line)
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log('# 详细设计自查结果\n')
console.log(`设计说明：${file}${onlyModule ? `（只查模块 ${onlyModule}）` : ''}`)
console.log(`设计记录：${R ? recFile : '（未找到）'}${codeDir ? `；逆向模式，代码：${codeDir}，函数 ${codeFns.length} 个` : ''}`)
console.log(`模块 ${modules.length} 个，单元 ${units.length} 个（本次检查 ${unitInfo.size} 个），设计依据中的需求 ${allBasisIds.size} 条，设计决策 ${dIds.size} 个，待确认问题 ${qIds.size} 个${codeDir ? `，代码不一致 ${nIds.size} 个` : ''}`)
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
