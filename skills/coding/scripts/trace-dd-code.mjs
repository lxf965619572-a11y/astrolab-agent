#!/usr/bin/env node
// 生成《详细设计与代码追踪表》（部门模板：工作表“正向追踪”“逆向追踪”），并列出追踪不上的项。
// 设计侧取详细设计说明中的“4.m <模块标识> 模块详细设计”和“4.m.n <函数名> 软件单元设计”；
// 代码侧取每个函数头注释中的“设计：<条目号>”，没有写的按函数名对应。只读，不修改代码和设计。
//
// 用法：node trace-dd-code.mjs --design <软件详细设计说明.md> --out <详细设计与代码追踪表.md> <代码目录或文件>...
//   生成的 Markdown 用 mcp__docgen__export_xlsx（include: "追踪"）导出为 .xlsx。
// 退出码：0 = 全部追踪上；1 = 有未实现的单元、无设计的函数或条目号不一致；2 = 用法或文件错误

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { analyzeFile, collectFiles } from '../../code-walkthrough/scripts/c-lex.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const designP = opt('--design'), out = opt('--out')
if (!designP || !out || !argv.length) { console.error('用法：node trace-dd-code.mjs --design <软件详细设计说明.md> --out <追踪表.md> <代码目录或文件>...'); process.exit(2) }
if (!existsSync(designP)) { console.error(`找不到：${designP}`); process.exit(2) }

// 设计侧
const dd = readFileSync(designP, 'utf8').replace(/\r\n?/g, '\n')
const modules = [], units = []
for (const l of dd.split('\n')) {
  let m
  if ((m = /^#{2,4}\s+(4\.\d+)\s+(\S+?)\s*模块详细设计/.exec(l))) modules.push({ num: m[1], id: m[2] })
  else if ((m = /^#{3,5}\s+(4\.\d+\.\d+)\s+(\S+?)\s*软件单元设计/.exec(l))) units.push({ num: m[1], name: m[2], mod: m[1].replace(/\.\d+$/, '') })
}
if (!units.length) { console.error('详细设计说明中没有找到“4.m.n <函数名> 软件单元设计”形式的标题，无法追踪。'); process.exit(2) }

// 代码侧
let files
try { files = collectFiles(argv).filter((f) => /\.c$/i.test(f)) } catch (e) { console.error(e.message); process.exit(2) }
const funcs = []
for (const f of files) {
  const a = analyzeFile(f)
  for (const fn of a.fns) {
    // 函数头：签名前紧挨着的块注释
    let l = fn.sigLine - 1
    while (l >= 1 && !a.lines[l - 1].trim()) l--
    const c = a.comments.filter((x) => x.endLine === l).pop()
    const head = c ? c.text : ''
    const dm = /设计\s*[：:]\s*([^\n*]*)/.exec(head)
    const refText = dm ? dm[1].trim() : ''
    const none = /^无/.test(refText)
    const refs = none ? [] : [...refText.matchAll(/4(?:\.\d+){2}/g)].map((x) => x[0])
    funcs.push({ file: basename(f), name: fn.name, line: fn.line, refText, refs, none })
  }
}

const problems = []
const unitBy = new Map(units.map((u) => [u.num, u]))
const fwd = new Map(units.map((u) => [u.num, []]))
for (const fn of funcs) {
  let traced = []
  if (fn.refs.length) {
    for (const r of fn.refs) {
      const u = unitBy.get(r)
      if (!u) { problems.push(`${fn.file}/${fn.name} 的函数头写“设计：${r}”，详细设计说明中没有这个软件单元`); continue }
      if (u.name !== fn.name) problems.push(`${fn.file}/${fn.name} 的函数头写“设计：${r}”，但 ${r} 是 ${u.name} 的单元设计（确认是一个函数实现多个单元，还是条目号写错）`)
      traced.push(u)
    }
  } else if (!fn.none) {
    const u = units.find((x) => x.name === fn.name)
    if (u) { traced.push(u); problems.push(`${fn.file}/${fn.name} 的函数头没有写“设计：${u.num}”（按函数名对应到 ${u.num}）`) }
  }
  fn.units = traced
  for (const u of traced) fwd.get(u.num).push(fn)
  if (!traced.length) problems.push(fn.none ? `${fn.file}/${fn.name} 没有对应的单元设计（函数头：设计：${fn.refText}）：详细设计应补充该单元，或在所属单元的处理流程中写明` : `${fn.file}/${fn.name} 在详细设计说明中没有对应的软件单元`)
}
for (const u of units) if (!fwd.get(u.num).length) problems.push(`${u.num} ${u.name} 软件单元设计没有找到实现代码`)

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|')
const unitId = (u) => `${u.num} ${u.name}`
const codeId = (fn) => `${fn.file}/${fn.name}`
const modFiles = (num) => [...new Set(units.filter((u) => u.mod === num).flatMap((u) => fwd.get(u.num).map((f) => f.file)))]
const L = []
L.push('# 详细设计与代码追踪表', '')
L.push(`设计依据：${basename(designP)}；代码：${files.map((f) => basename(f)).join('、')}。由 trace-dd-code.mjs 生成，不手改；设计或代码改了就重新生成。`, '')
L.push('## 正向追踪', '', '| 详细设计中的单元/模块标识 | 代码单元/模块标识 |', '|---|---|')
for (const m of modules) {
  L.push(`| ${cell(`${m.num} ${m.id}（模块）`)} | ${cell(modFiles(m.num).join('、') || '未实现')} |`)
  for (const u of units.filter((x) => x.mod === m.num)) L.push(`| ${cell(unitId(u))} | ${cell(fwd.get(u.num).map(codeId).join('、') || '未实现')} |`)
}
for (const u of units.filter((x) => !modules.some((m) => m.num === x.mod))) L.push(`| ${cell(unitId(u))} | ${cell(fwd.get(u.num).map(codeId).join('、') || '未实现')} |`)
L.push('', '## 逆向追踪', '', '| 代码单元/模块标识 | 详细设计中的单元/模块标识 |', '|---|---|')
for (const f of [...new Set(funcs.map((x) => x.file))]) {
  const mods = [...new Set(funcs.filter((x) => x.file === f).flatMap((x) => x.units.map((u) => u.mod)))]
  L.push(`| ${cell(`${f}（模块）`)} | ${cell(mods.map((n) => { const m = modules.find((x) => x.num === n); return m ? `${m.num} ${m.id}` : n }).join('、') || '无对应设计')} |`)
  for (const fn of funcs.filter((x) => x.file === f)) L.push(`| ${cell(codeId(fn))} | ${cell(fn.units.map(unitId).join('、') || (fn.none ? `无对应单元（${fn.refText.replace(/^无\s*/, '').replace(/^[（(](.*)[）)]$/, '$1') || '函数头写“无”'}）` : '无对应设计'))} |`)
}
L.push('', '## 追踪问题', '')
if (problems.length) for (const p of problems) L.push(`- ${p}`)
else L.push('无：每个软件单元都有实现代码，每个函数都对应到软件单元。')
writeFileSync(out, L.join('\n') + '\n', 'utf8')
console.log(`已生成 ${out}：设计单元 ${units.length} 个（模块 ${modules.length} 个），代码函数 ${funcs.length} 个，追踪问题 ${problems.length} 个。`)
for (const p of problems) console.log(`- ${p}`)
process.exit(problems.length ? 1 : 0)
