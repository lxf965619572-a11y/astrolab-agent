#!/usr/bin/env node
// C 源代码度量：规模、圈复杂度、扇入扇出、注释率（按函数，即静态分析报告中的“模块”）。
// 只读，不修改任何文件。部门工具（TESTBED 等）有结果时以工具结果为准；本脚本的结果在报告中注明“AstroLab metrics.mjs 统计”。
//
// 用法：node metrics.mjs <文件或目录>... [--json <输出.json>] [--md <输出.md>]
//
// 口径（写进报告）：
//   有效代码行：函数范围内含代码记号的行（不含纯注释行、空行；不做 TESTBED 的“规格化”重排，数值与 TESTBED 规格化行数不同）
//   圈复杂度 v(G)：1 + if、for、while、case、?: 的个数（&&、|| 不计；另给出计入 &&、|| 的扩展值）
//   基本复杂度 ev(G)：本脚本不计算，报告中写【待补充】；“非结构化跳转”一栏列出 goto、循环中的 break/continue、中途 return 的个数，供判断
//   扇出：函数调用的不同函数个数（含库函数、宏形式的调用）；扇入：被分析的代码中调用它的不同函数个数
//   注释率：（函数头注释行 + 函数体内注释行）÷（函数头注释行 + 函数总行数），按行计，一行既有代码又有注释时也计为注释行

import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { analyzeFile, collectFiles, C_KEYWORDS } from './c-lex.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const jsonOut = opt('--json'), mdOut = opt('--md')
if (!argv.length) { console.error('用法：node metrics.mjs <文件或目录>... [--json <输出.json>] [--md <输出.md>]'); process.exit(2) }
let files
try { files = collectFiles(argv) } catch (e) { console.error(e.message); process.exit(2) }

const LIMIT = { lines: 200, cc: 10, ev: 4, fanOut: 5, comment: 30 }
const all = files.map((f) => ({ ...analyzeFile(f), rel: relative(process.cwd(), f).replace(/\\/g, '/') }))
const modules = []
const fileStats = []

for (const a of all) {
  const { tokens: T, match: M, comments, lines, pp } = a
  const codeLines = new Set(T.map((t) => t.line))
  for (const p of pp) for (let l = p.line; l <= p.endLine; l++) codeLines.add(l)
  const cmtLines = new Set()
  for (const c of comments) for (let l = c.line; l <= c.endLine; l++) if (lines[l - 1]?.trim()) cmtLines.add(l)
  const total = lines.length - (lines[lines.length - 1] === '' ? 1 : 0)
  const blank = lines.slice(0, total).filter((l) => !l.trim()).length
  fileStats.push({ file: a.rel, total, code: codeLines.size, comment: cmtLines.size, blank, functions: a.fns.length })

  for (const fn of a.fns) {
    // 函数头注释：签名前紧挨着的注释（中间只隔空行）
    let headLines = 0
    let l = fn.sigLine - 1
    while (l >= 1 && !lines[l - 1].trim()) l--
    const c = comments.filter((x) => x.endLine === l && !codeLines.has(x.endLine)).pop()
    if (c) {
      let start = c.line
      // 连续的多段注释（// 行注释）
      for (;;) {
        const prev = comments.find((x) => x.endLine === start - 1 && !codeLines.has(x.line))
        if (!prev) break
        start = prev.line
      }
      headLines = l - start + 1
    }
    const span = fn.endLine - fn.sigLine + 1
    let code = 0, cmt = 0
    for (let k = fn.sigLine; k <= fn.endLine; k++) { if (codeLines.has(k)) code++; if (cmtLines.has(k)) cmt++ }
    let cc = 1, ccx = 1, unstructured = 0
    const calls = new Set()
    const loopStack = [] // 记录循环体的结束位置
    for (let i = fn.open + 1; i < fn.close; i++) {
      const v = T[i].v
      while (loopStack.length && i > loopStack[loopStack.length - 1].end) loopStack.pop()
      if (T[i].t === 'id') {
        if (['if', 'for', 'while', 'case'].includes(v)) { cc++; ccx++ }
        if ((v === 'for' || v === 'while') && T[i + 1]?.v === '(' && T[M[i + 1] + 1]?.v === '{') loopStack.push({ end: M[M[i + 1] + 1], kind: 'loop' })
        if (v === 'do' && T[i + 1]?.v === '{') loopStack.push({ end: M[i + 1], kind: 'loop' })
        if (v === 'switch' && T[i + 1]?.v === '(' && T[M[i + 1] + 1]?.v === '{') loopStack.push({ end: M[M[i + 1] + 1], kind: 'switch' })
        if (v === 'goto' || v === 'continue') unstructured++
        if (v === 'break' && loopStack.length && loopStack[loopStack.length - 1].kind === 'loop') unstructured++
        if (v === 'return') { let k = i; while (k < fn.close && T[k].v !== ';') k++; if (T.slice(k + 1, fn.close).some((t) => t.v !== '}')) unstructured++ }
        if (T[i + 1]?.v === '(' && !C_KEYWORDS.has(v) && T[i - 1]?.v !== '.' && T[i - 1]?.v !== '->') calls.add(v)
      } else if (v === '?') { cc++; ccx++ } else if (v === '&&' || v === '||') ccx++
    }
    modules.push({
      name: fn.name, file: a.rel, line: fn.line, static: fn.static,
      lines: span, code, commentLines: cmt + headLines, headComment: headLines,
      commentRate: Math.round((1000 * (cmt + headLines)) / (span + headLines)) / 10,
      cc, ccExt: ccx, ev: null, unstructured, calls: [...calls].sort(),
    })
  }
}
// 同名 static 函数在不同文件中：扇入按文件内解析
const byName = new Map()
for (const m of modules) { if (!byName.has(m.name)) byName.set(m.name, []); byName.get(m.name).push(m) }
for (const m of modules) {
  m.fanOut = m.calls.length
  m.callers = modules.filter((x) => x !== m && x.calls.includes(m.name) && (!m.static || x.file === m.file)).map((x) => x.name)
  m.fanIn = new Set(m.callers).size
}

const tot = fileStats.reduce((s, f) => ({ total: s.total + f.total, code: s.code + f.code, comment: s.comment + f.comment, blank: s.blank + f.blank }), { total: 0, code: 0, comment: 0, blank: 0 })
const over = {
  lines: modules.filter((m) => m.code > LIMIT.lines),
  cc: modules.filter((m) => m.cc > LIMIT.cc),
  fanOut: modules.filter((m) => m.fanOut > LIMIT.fanOut),
  comment: modules.filter((m) => m.commentRate < LIMIT.comment),
}
const L = []
L.push('# 代码度量结果（AstroLab metrics.mjs）', '')
L.push(`文件 ${fileStats.length} 个，函数（模块）${modules.length} 个；总行数 ${tot.total}，含代码的行 ${tot.code}，注释行 ${tot.comment}，空行 ${tot.blank}。`, '')
L.push('口径：有效代码行不做 TESTBED 的规格化重排；圈复杂度不计 &&、||（括号中是计入后的值）；基本复杂度不计算。部门工具有结果时以工具结果为准。', '')
L.push(`超过门限：有效代码行 > ${LIMIT.lines} 的 ${over.lines.length} 个；圈复杂度 > ${LIMIT.cc} 的 ${over.cc.length} 个；扇出 > ${LIMIT.fanOut} 的 ${over.fanOut.length} 个；注释率 < ${LIMIT.comment}% 的 ${over.comment.length} 个。`, '')
L.push('## 文件', '', '| 文件 | 总行数 | 含代码的行 | 注释行 | 空行 | 函数数 |', '|---|---|---|---|---|---|')
for (const f of fileStats) L.push(`| ${f.file} | ${f.total} | ${f.code} | ${f.comment} | ${f.blank} | ${f.functions} |`)
L.push('', '## 函数', '', '| 序号 | 模块名 | 文件:行号 | 有效代码行 | 圈复杂度 | 非结构化跳转 | 扇入 | 扇出 | 注释率（%） |', '|---|---|---|---|---|---|---|---|---|')
modules.forEach((m, k) => L.push(`| ${k + 1} | ${m.name} | ${m.file}:${m.line} | ${m.code} | ${m.cc}（${m.ccExt}） | ${m.unstructured} | ${m.fanIn} | ${m.fanOut} | ${m.commentRate.toFixed(1)} |`))
const md = L.join('\n') + '\n'
if (mdOut) writeFileSync(mdOut, md, 'utf8'); else process.stdout.write(md)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ tool: 'AstroLab metrics.mjs', version: 1, limits: LIMIT, totals: { files: fileStats.length, modules: modules.length, ...tot }, files: fileStats, modules }, null, 2), 'utf8')
if (mdOut || jsonOut) console.log(`度量 ${fileStats.length} 个文件、${modules.length} 个函数。${mdOut ? `结果：${mdOut}` : ''}${jsonOut ? ` 数据：${jsonOut}` : ''}`)
