#!/usr/bin/env node
// 详细设计说明自查脚本：按固定规则检查完整性、追溯、数值出处、可测试性、共享数据保护、流程图，
// 逆向模式下核对代码中的函数是否都有设计、是否把代码当作设计依据。
// 只读，不修改任何文件。“必须处理”项要改正，“复核”项逐条判断。
//
// 用法：node check-design.mjs <详细设计说明.md> [--code <源代码目录>]
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
const codeDir = opt('--code')
const file = args[0]
if (!file) { console.error('用法：node check-design.mjs <详细设计说明.md> [--code <源代码目录>]'); process.exit(2) }
let text
try { text = readFileSync(file, 'utf8').replace(/^﻿/, '') } catch (e) { console.error(`读不到文件：${file}（${e.message}）`); process.exit(2) }
const lines = text.split(/\r?\n/)
const notes = []

// —— 流程图解析器：与文档生成服务共用（找不到时跳过流程图语法检查）——
let parseFlowchart = null
{
  const here = dirname(fileURLToPath(import.meta.url))
  const cands = []
  if (process.env.ASTROLAB_ROOT) cands.push(join(process.env.ASTROLAB_ROOT, 'mcp', 'docgen', 'lib', 'flowchart.mjs'))
  let d = here
  for (let i = 0; i < 8; i++) { cands.push(join(d, 'mcp', 'docgen', 'lib', 'flowchart.mjs')); d = dirname(d) }
  const hit = cands.find((p) => existsSync(p))
  if (hit) {
    try { ({ parseFlowchart } = await import(pathToFileURL(hit).href)) } catch { /* 忽略 */ }
  }
  if (!parseFlowchart) notes.push('没有找到流程图解析器（mcp/docgen/lib/flowchart.mjs），流程图语法未检查')
}

// —— 文档解析 ——
const heads = []
let inFence = false
lines.forEach((l, i) => {
  if (/^\s*```/.test(l)) inFence = !inFence
  if (inFence) return
  const m = /^(#{2,4})\s+(.*)$/.exec(l)
  if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i })
})
function section(pattern, level = 2) {
  const h = heads.find((x) => x.level === level && pattern.test(x.title))
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
const inSec = (sec, i) => sec && i >= sec.start && i < sec.end

const findings = []
const seen = new Set()
const add = (level, rule, line, msg) => {
  const key = `${rule}|${line}|${msg}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ level, rule, line, msg })
}

// —— D0 章节 ——
const REQUIRED = [['设计依据', /设计依据/], ['模块总体设计', /总体设计|函数清单/], ['数据设计', /数据设计/], ['函数设计', /函数设计|单元.*设计/],
  ['设计决策', /设计决策/], ['需求追溯', /追溯|可追踪/], ['待确认问题', /待确认/], ['代码与上级文件不一致清单', /不一致/], ['统计', /统计/]]
const S = {}
for (const [name, re] of REQUIRED) {
  S[name] = section(re)
  if (!S[name]) add('必须处理', 'D0 缺少章节', 1, `没有“${name}”一章。没有内容也要保留章节并写“无”（正向设计的不一致清单写“不适用”）`)
}
const secBasis = S['设计依据']
const secFunc = S['函数设计']
const basisText = secText(secBasis)

// 函数小节：函数设计章下的三级标题，标题中取 C 标识符
const funcSecs = secFunc ? heads.filter((h) => h.level === 3 && h.line > secFunc.start && h.line < secFunc.end).map((h) => {
  const next = heads.find((x) => x.line > h.line && x.level <= 3)
  const m = /([A-Za-z_]\w*)\s*(?:\(|$|（|\s)/.exec(h.title.replace(/^[\d.]+\s*/, ''))
  return { name: m ? m[1] : h.title, title: h.title, start: h.line, end: next ? Math.min(next.line, secFunc.end) : secFunc.end }
}) : []
if (secFunc && !funcSecs.length) add('必须处理', 'D0 函数设计格式', secFunc.start + 1, '函数设计一章中没有“### 6.x 函数名”形式的小节')

// 函数清单
const listRows = rows(S['模块总体设计']).filter((r) => r.header.some((h) => h.includes('函数')))
const listed = new Map(listRows.map((r) => [(/([A-Za-z_]\w*)/.exec(col(r, '函数')) || [])[1], r]).filter(([k]) => k))

// —— D1 函数齐全 ——
const designed = new Map(funcSecs.map((f) => [f.name, f]))
for (const [name, r] of listed) if (!designed.has(name)) add('必须处理', 'D1 函数缺少设计', r.line, `函数清单中的 ${name} 在函数设计一章中没有小节`)
for (const [name, f] of designed) if (listRows.length && !listed.has(name)) add('必须处理', 'D1 函数清单不全', f.start + 1, `${name} 有设计小节，但不在函数清单中`)

// 逆向：代码中的函数
let codeFns = []
const codeTexts = []
if (codeDir) {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
  let files = []
  try { files = walk(resolve(codeDir)).filter((p) => /\.(c|h)$/i.test(p)) } catch (e) { console.error(`读不到代码目录：${codeDir}（${e.message}）`); process.exit(2) }
  for (const p of files) {
    const t = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
    codeTexts.push({ p, t })
    if (!/\.c$/i.test(p)) continue
    for (const m of t.matchAll(/^[A-Za-z_][\w \t\*]*?\b([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*\{/gm)) {
      if (/^(if|while|for|switch|return|sizeof)$/.test(m[1])) continue
      const proto = m[0].replace(/\s*\{$/, '').replace(/\s+/g, ' ').trim()
      codeFns.push({ name: m[1], proto, file: basename(p) })
    }
  }
  for (const [name, f] of designed) if (codeFns.length && !codeFns.some((c) => c.name === name)) add('复核', 'D1 设计的函数代码中没有', f.start + 1, `${name} 有设计小节，但代码中没有这个函数：是建议新增的（写入不一致清单），还是名字写错了？`)
  for (const f of codeFns) if (!designed.has(f.name)) add('必须处理', 'D1 代码函数缺少设计', secFunc ? secFunc.start + 1 : 1, `代码中的函数 ${f.name}（${f.file}）没有设计小节（static 函数也要写）`)
  if (!codeFns.length) notes.push(`代码目录 ${codeDir} 中没有找到函数定义`)
}

// —— D2 函数小节的必填项 ——
const ITEMS = ['原型', '功能', '需求追溯', '调用者和执行环境', '输入', '输出', '读写的全局数据', '调用的函数', '异常处理', '时序和资源']
const fnInfo = new Map()
for (const f of funcSecs) {
  const sec = { start: f.start, end: f.end }
  const tr = rows(sec).filter((r) => r.header[0]?.includes('项目'))
  const get = (k) => tr.find((r) => r.cells[0].replace(/\s/g, '') === k.replace(/\s/g, ''))
  if (!tr.length) { add('必须处理', 'D2 函数格式', f.start + 1, `${f.name} 没有“| 项目 | 内容 |”表格（格式见 function-template.md）`); continue }
  for (const k of ITEMS) {
    const r = get(k)
    if (!r) add('必须处理', 'D2 缺少项目', f.start + 1, `${f.name} 缺少“${k}”`)
    else if (!r.cells[1] || /^[-—]$/.test(r.cells[1])) add('必须处理', 'D2 项目为空', r.line, `${f.name} 的“${k}”为空（没有的写“无”）`)
  }
  const body = lines.slice(f.start, f.end)
  const stepIdx = body.findIndex((l) => /处理步骤/.test(l))
  const steps = stepIdx >= 0 ? body.slice(stepIdx).filter((l) => /^\s*(\d+[.、)]|\d+\.\d+)\s*\S/.test(l)) : []
  if (!steps.length) add('必须处理', 'D2 缺少处理步骤', f.start + 1, `${f.name} 没有编号的“处理步骤”`)
  const env = get('调用者和执行环境')?.cells[1] || ''
  const hasMermaid = body.some((l) => /^\s*```\s*mermaid/i.test(l))
  fnInfo.set(f.name, { env, steps, hasMermaid, trace: get('需求追溯')?.cells[1] || '', proto: get('原型')?.cells[1] || '', sec: f, body: body.join('\n') })
}

// —— D3 含糊词 ——
const VAGUE_MUST = /(适当(地)?(延时|等待|处理)|相应(的)?处理|必要的处理|视情况|酌情)/
const VAGUE_REVIEW = /(适当|合理的?|尽快|及时|必要时|若干|一定的|等等|左右|大约|尽量|一般情况下)/
for (const [name, fi] of fnInfo) {
  for (let i = fi.sec.start; i < fi.sec.end; i++) {
    const l = lines[i]
    if (/^\s*```/.test(l)) continue
    let m
    if ((m = VAGUE_MUST.exec(l))) add('必须处理', 'D3 含糊表述', i + 1, `${name}：“${m[0]}”不可测试，写出具体的条件、数值和动作；上级文件没有规定的列为待确认问题`)
    else if ((m = VAGUE_REVIEW.exec(l))) add('复核', 'D3 含糊表述', i + 1, `${name}：“${m[0]}”，确认是否写清了具体的条件或数值`)
  }
}

// —— D4 数值出处 ——
const decText = secText(S['设计决策'])
const normNum = (s) => s.replace(/\s+/g, '').replace(/μs|us/gi, 'μs').toLowerCase()
// 范围写法“20～200 ms”展开，使两端的数值都能匹配
const expandRanges = (t) => t.replace(/(\d+(?:\.\d+)?)\s*[～~\-–—至到]\s*(\d+(?:\.\d+)?)\s*(ms|μs|us|s|kHz|MHz|Hz|字节|位|bit|ns|路)/g, '$1 $3 $2 $3 $&')
const sourceText = normNum(expandRanges(basisText + '\n' + decText))
const numRe = /(0x[0-9A-Fa-f]+|\d+(?:\.\d+)?)\s*(ms|μs|us|s|kHz|MHz|Hz|字节|位|bit|ns)(?![A-Za-z])/g
const hexRe = /\b0x[0-9A-Fa-f]{2,}\b/g
const checkNumbers = (i, l) => {
  for (const m of l.matchAll(numRe)) {
    const v = m[1]
    if (/^(0|1)$/.test(v) && !/ms|μs|us|s$/.test(m[2])) continue
    const a = normNum(m[0]), b = normNum(v)
    if (!sourceText.includes(a) && !(m[2] === '位' && sourceText.includes(b))) add('复核', 'D4 数值无出处', i + 1, `“${m[0].trim()}”在设计依据和设计决策中找不到，确认出处（上级文件条款或 D-xxx）`)
  }
  for (const m of l.matchAll(hexRe)) {
    if (!sourceText.includes(m[0].toLowerCase())) add('复核', 'D4 数值无出处', i + 1, `“${m[0]}”在设计依据和设计决策中找不到；寄存器地址、掩码要来自接口文件，或能由其直接推出（在设计决策中说明）`)
  }
}
{
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (fence || inSec(secBasis, i) || inSec(S['设计决策'], i) || inSec(S['待确认问题'], i) || inSec(S['代码与上级文件不一致清单'], i) || inSec(S['统计'], i)) return
    if (/^#/.test(l) || inSec(section(/范围/), i) || inSec(section(/引用文档/), i)) return
    checkNumbers(i, l.replace(/`[^`]*`/g, ''))
  })
}

// —— D5 需求追溯 ——
const REQ_RE = /\b[A-Z][A-Z0-9]*-[A-Z]{2,4}-\d{3}\b/g
const basisReqs = new Set()
for (const r of rows(section(/需求/, 3) && secBasis ? { start: secBasis.start, end: secBasis.end } : null)) for (const m of r.cells[0].matchAll(REQ_RE)) basisReqs.add(m[0])
if (secBasis && !basisReqs.size) add('必须处理', 'D5 设计依据无需求', secBasis.start + 1, '设计依据中没有摘录 SRS 需求（需求标识 + 原文）')
const traceRows = rows(S['需求追溯'])
const traced = new Map()
for (const r of traceRows) for (const m of r.cells[0].matchAll(REQ_RE)) traced.set(m[0], r)
for (const id of basisReqs) {
  const r = traced.get(id)
  if (!r) add('必须处理', 'D5 需求未追溯', S['需求追溯']?.start + 1 || 1, `设计依据中的 ${id} 在需求追溯表中没有出现`)
  else if (!/[A-Za-z_]\w*/.test(col(r, '函数')) || /^(无|—|-)$/.test(col(r, '函数'))) add('复核', 'D5 需求无实现函数', r.line, `${id} 没有实现它的函数，确认是否遗漏，或说明原因（如由其他模块实现）`)
}
for (const [name, fi] of fnInfo) {
  const ext = listed.get(name) ? /对外/.test(col(listed.get(name), '类型')) : !/^\s*`?\s*static\b/.test(fi.proto)
  if (ext && !REQ_RE.test(fi.trace)) add('必须处理', 'D5 对外函数无追溯', fi.sec.start + 1, `对外函数 ${name} 的需求追溯中没有需求标识`)
  REQ_RE.lastIndex = 0
  for (const m of fi.trace.matchAll(REQ_RE)) if (basisReqs.size && !basisReqs.has(m[0])) add('必须处理', 'D5 追溯的需求不在依据中', fi.sec.start + 1, `${name} 追溯到 ${m[0]}，但设计依据中没有摘录这条需求`)
}

// —— D6 编号引用 ——
const ids = (sec, re) => new Set(rows(sec).map((r) => (re.exec(r.cells[0]) || [])[0]).filter(Boolean))
const qIds = ids(S['待确认问题'], /Q-\d{3}/)
const dIds = ids(S['设计决策'], /D-\d{3}/)
const nIds = ids(S['代码与上级文件不一致清单'], /N-\d{3}/)
const missing = new Set()
lines.forEach((l, i) => {
  for (const [re, set, sec, what] of [[/Q-\d{3}/g, qIds, S['待确认问题'], '待确认问题表'], [/\bD-\d{3}\b/g, dIds, S['设计决策'], '设计决策表'], [/\bN-\d{3}\b/g, nIds, S['代码与上级文件不一致清单'], '不一致清单']]) {
    if (inSec(sec, i)) continue
    for (const m of l.matchAll(re)) if (!set.has(m[0]) && !missing.has(m[0])) { missing.add(m[0]); add('必须处理', 'D6 编号不存在', i + 1, `引用了 ${m[0]}，但${what}中没有`) }
  }
  if (/【待确认】/.test(l) && !/Q-\d{3}/.test(l) && !inSec(S['待确认问题'], i)) add('必须处理', 'D6 待确认未关联问题', i + 1, '有【待确认】但没有关联 Q-xxx')
})

// —— D7 流程图 ——
// 在中断中运行：函数名以 _isr 结尾，或执行环境写明在中断中运行/由中断调用（“中断尚未开放”“可能被中断打断”不算）
const IN_ISR = /(在|于)[^，。；|]{0,10}中断(服务程序)?中(运行|执行|调用)?|中断服务程序(中|调用|内)|定时中断(调用|中|服务)|中断上下文|ISR/
for (const [name, fi] of fnInfo) {
  const isIsr = /_isr$/i.test(name) || (IN_ISR.test(fi.env) && !/中断(尚未|未)开/.test(fi.env))
  const loops = /((?<![不无])等待|超时|(?<!主)循环|重试|状态机|直到)/.test(fi.body.replace(/不等待|无等待/g, ''))
  const decisions = (fi.body.match(/(若|如果|当.{0,20}时|否则|为真|为假|>=|<=|≥|≤|不等于|等于)/g) || []).length
  if (!fi.hasMermaid) {
    if (isIsr) add('必须处理', 'D7 缺少流程图', fi.sec.start + 1, `${name} 在中断中运行，必须有流程图`)
    else if (loops || decisions >= 4) add('复核', 'D7 缺少流程图', fi.sec.start + 1, `${name} 含${loops ? '等待/循环' : `较多判断（约 ${decisions} 处）`}，按规则应有流程图`)
  }
}
if (parseFlowchart) {
  let fence = null, buf = [], startLine = 0
  lines.forEach((l, i) => {
    if (fence === null && /^\s*```\s*mermaid/i.test(l)) { fence = 'm'; buf = []; startLine = i + 1; return }
    if (fence && /^\s*```/.test(l)) {
      const g = parseFlowchart(buf.join('\n'))
      if (g.errors?.length) add('必须处理', 'D7 流程图语法', startLine, `流程图无法转换为 Word 图形：${g.errors.join('；')}（写法见 flowchart-guide.md）`)
      else if (!inSec(secFunc, startLine) || !g.nodes.some((n) => n.shape === 'decision' || n.shape === 'terminal')) {
        // 调用关系图等结构图，不按流程图规则检查
      } else {
        for (const n of g.nodes) {
          const k = g.edges.filter((e) => e.from === n.id)
          if (n.shape === 'decision' && k.length < 2) add('必须处理', 'D7 流程图判断出口', startLine, `判断节点“${n.text}”只有 ${k.length} 个出口`)
          if (n.shape === 'decision' && k.length >= 2 && k.some((e) => !e.label)) add('复核', 'D7 流程图判断出口', startLine, `判断节点“${n.text}”有出口没有标注是/否`)
          if (n.shape !== 'terminal' && !k.length) add('必须处理', 'D7 流程图断头', startLine, `节点“${n.text}”没有出线，每条路径应结束于“返回/结束”`)
        }
      }
      fence = null
      return
    }
    if (fence) buf.push(l)
  })
}

// —— D8 共享数据保护 ——
const varRows = rows(section(/数据设计/)).filter((r) => r.header.some((h) => h.includes('读写')))
const fnEnv = new Map([...fnInfo].map(([n, fi]) => [n, fi.env]))
for (const r of varRows) {
  const who = col(r, '读写')
  const prot = col(r, '保护')
  const names = [...who.matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0])
  const envs = names.map((n) => fnEnv.get(n) || '').join(' ') + ' ' + who
  const isr = /中断|isr/i.test(envs)
  const main = /主循环|任务|main/i.test(envs) || names.some((n) => fnEnv.get(n) && !/中断|isr/i.test(fnEnv.get(n)))
  if (isr && main && (!prot || /^(无|—|-|不需要)$/.test(prot))) add('必须处理', 'D8 共享数据无保护', r.line, `${r.cells[0]} 由中断和主循环共同访问，“保护”一栏要写明保护方式（关中断范围、volatile 等）`)
}
if (S['数据设计'] && !varRows.length) add('复核', 'D8 变量表格式', S['数据设计'].start + 1, '数据设计中没有含“读写者”列的变量表，无法核对共享数据保护')

// —— D9 自行裁决 ——
const ADJ = /(取较(严|小|大|保守)的?值?|以(概要设计|需求规格说明|SRS|任务书|接口文件|ICD)为准|按(概要设计|需求规格说明|SRS)执行|两者取|统一(为|取)|按较(严|新)的?)/
lines.forEach((l, i) => {
  if (inSec(S['待确认问题'], i) || inSec(S['代码与上级文件不一致清单'], i)) return
  const m = ADJ.exec(l)
  if (m && !/Q-\d{3}/.test(l)) add('必须处理', 'D9 自行裁决', i + 1, `“${m[0]}”：上级文件之间矛盾时应列为待确认问题并引用两处原文，不在设计中选择`)
})

// —— D10 逆向模式 ——
const FROM_CODE = /(按|依据|根据|参照|沿用)(现有|已有|原有)?(代码|源码|程序|实现)|代码中(为|是|的值为|定义为)|见代码|与代码一致/
lines.forEach((l, i) => {
  if (inSec(S['代码与上级文件不一致清单'], i) || inSec(S['待确认问题'], i) || inSec(section(/范围/), i)) return
  const m = FROM_CODE.exec(l)
  if (m) add('必须处理', 'D10 以代码为依据', i + 1, `“${m[0]}”：设计应描述上级文件要求的行为；代码的做法只写在不一致清单或待确认问题的“现有代码的做法”中`)
})
if (codeDir) {
  const nRows = rows(S['代码与上级文件不一致清单']).filter((r) => /N-\d{3}/.test(r.cells[0]))
  if (!nRows.length) add('复核', 'D10 不一致清单为空', S['代码与上级文件不一致清单']?.start + 1 || 1, '逆向模式下没有列出任何代码与上级文件的不一致：确认已逐个函数对照过')
  for (const r of nRows) if (!/疑似代码缺陷|上级文件之间矛盾|上级文件未规定/.test(col(r, '结论'))) add('必须处理', 'D10 结论', r.line, `${r.cells[0]} 的结论应为“疑似代码缺陷”“上级文件之间矛盾”“上级文件未规定”之一`)
  // 原型核对
  const normP = (s) => s.replace(/`/g, '').replace(/\s*([(),*])\s*/g, '$1').replace(/\s+/g, ' ').trim()
  for (const f of codeFns) {
    const fi = fnInfo.get(f.name)
    if (fi && fi.proto && normP(fi.proto) !== normP(f.proto)) add('复核', 'D10 原型与代码不同', fi.sec.start + 1, `${f.name} 的原型与代码不同：设计“${fi.proto.replace(/`/g, '')}”，代码“${f.proto}”。有意不同的（如代码与接口文件不一致）写入不一致清单`)
  }
} else if (rows(S['代码与上级文件不一致清单']).some((r) => /N-\d{3}/.test(r.cells[0]))) notes.push('文档中有代码不一致清单，但没有指定 --code，未核对代码中的函数')

// —— D11 设计决策要有理由 ——
for (const r of rows(S['设计决策'])) {
  if (!/D-\d{3}/.test(r.cells[0])) continue
  if (!col(r, '理由') || /^(无|—|-)$/.test(col(r, '理由'))) add('必须处理', 'D11 设计决策无理由', r.line, `${r.cells[0]} 没有写理由`)
}

// —— D12 待确认问题要有原文依据 ——
for (const r of rows(S['待确认问题'])) {
  if (!/Q-\d{3}/.test(r.cells[0])) continue
  if (!col(r, '依据')) add('复核', 'D12 待确认问题无依据', r.line, `${r.cells[0]} 没有引用上级文件原文`)
}

// —— 输出 ——
const order = { 必须处理: 0, 复核: 1 }
findings.sort((a, b) => order[a.level] - order[b.level] || a.line - b.line)
const count = (lv) => findings.filter((f) => f.level === lv).length
console.log('# 详细设计说明自查结果\n')
console.log(`文件：${file}${codeDir ? `（逆向模式，代码：${codeDir}，函数 ${codeFns.length} 个）` : ''}`)
console.log(`函数小节 ${funcSecs.length} 个，函数清单 ${listed.size} 个，设计依据中的需求 ${basisReqs.size} 条，设计决策 ${dIds.size} 个，待确认问题 ${qIds.size} 个${codeDir ? `，代码不一致 ${nIds.size} 个` : ''}`)
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
