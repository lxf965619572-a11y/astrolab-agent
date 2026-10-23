#!/usr/bin/env node
// 由 code-review/templates 中带标记的模板生成评测用例（code-review/cases）
//
// 模板写法（见 templates/ 下的例子）：
//   - 缺陷所在行末尾加  /*@D:缺陷ID*/   同一缺陷可标在多行（表示这几行都算命中）
//   - 无缺陷、用来统计误报的函数，前后各加一行  /*@CLEAN*/  和  /*@END*/
//   - meta.json 写用例标题、目标平台（sparc / d2000）和每个缺陷的说明、关键词
//
// 用法：node evals/build-cases.mjs        生成后会去掉所有标记，并记录行号到 case.json
// 若能找到 cppcheck（CPPCHECK_PATH 或 PATH），会同时记录哪些缺陷 Cppcheck 单独就能发现。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { EVAL_DIR, loadLocalEnv } from './lib.mjs'

const TARGET_TEXT = { sparc: 'SPARC（BM3803）', d2000: 'D2000（ARMv8，Ubuntu/openEuler）' }
const PLATFORM = { sparc: ['unix32', 'c99'], d2000: ['unix64', 'c11'] }
const srcRoot = path.join(EVAL_DIR, 'code-review', 'templates')
const outRoot = path.join(EVAL_DIR, 'code-review', 'cases')

loadLocalEnv()
function findCppcheck() {
  const cands = [process.env.CPPCHECK_PATH, 'cppcheck']
  if (process.platform === 'win32') for (const b of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (b) cands.push(path.join(b, 'Cppcheck', 'cppcheck.exe'))
  for (const c of cands.filter(Boolean)) if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return c
  return null
}
const cppcheck = findCppcheck()

function runCppcheck(dir, target) {
  const [plat, std] = PLATFORM[target]
  const r = spawnSync(cppcheck, ['--enable=warning,style,performance,portability', '--inconclusive', `--platform=${plat}`, `--std=${std}`,
    '--language=c', '--xml', '--xml-version=2', '--quiet', '-Isrc', 'src'], { cwd: dir, encoding: 'utf8' })
  const out = []
  for (const m of (r.stderr || '').matchAll(/<error\b([^>]*?)>([\s\S]*?)<\/error>/g)) {
    const id = m[1].match(/\bid="([^"]*)"/)?.[1]
    for (const l of m[2].matchAll(/<location\b[^>]*?file="([^"]*)"[^>]*?line="(\d+)"/g)) out.push({ file: `src/${path.basename(l[1].replace(/\\/g, '/'))}`, line: Number(l[2]), id })
  }
  return out
}

fs.rmSync(outRoot, { recursive: true, force: true })
let total = 0
let byCpp = 0
for (const caseId of fs.readdirSync(srcRoot).sort()) {
  const dir = path.join(srcRoot, caseId)
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  const defectLines = {}
  const clean = []
  const outSrc = path.join(outRoot, caseId, 'src')
  fs.mkdirSync(outSrc, { recursive: true })
  for (const name of fs.readdirSync(path.join(dir, 'src')).sort()) {
    const out = []
    let cleanStart = null
    for (const line of fs.readFileSync(path.join(dir, 'src', name), 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (t === '/*@CLEAN*/') { cleanStart = out.length + 1; continue }
      if (t === '/*@END*/') { clean.push({ file: `src/${name}`, from: cleanStart, to: out.length }); cleanStart = null; continue }
      let l = line
      for (const m of line.matchAll(/\s*\/\*@D:([\w-]+)\*\//g)) {
        defectLines[m[1]] ??= { file: `src/${name}`, lines: [] }
        if (defectLines[m[1]].file !== `src/${name}`) throw new Error(`${caseId}: 缺陷 ${m[1]} 跨了多个文件`)
        defectLines[m[1]].lines.push(out.length + 1)
        l = l.replace(m[0], '')
      }
      if (/@D:|@CLEAN|@END/.test(l)) throw new Error(`${caseId}/${name}: 标记写法有误：${line}`)
      out.push(l)
    }
    if (cleanStart !== null) throw new Error(`${caseId}/${name}: /*@CLEAN*/ 没有对应的 /*@END*/`)
    fs.writeFileSync(path.join(outSrc, name), out.join('\n'))
  }
  for (const id of Object.keys(defectLines)) if (!meta.defects[id]) throw new Error(`${caseId}: 标记 ${id} 在 meta.json 中没有说明`)
  const findings = cppcheck ? runCppcheck(path.join(outRoot, caseId), meta.target) : []
  const defects = Object.entries(meta.defects).map(([id, d]) => {
    if (!defectLines[id]) throw new Error(`${caseId}: meta.json 中的 ${id} 在代码里没有标记`)
    const { file, lines } = defectLines[id]
    const ids = [...new Set(findings.filter((f) => f.file === file && lines.some((L) => Math.abs(f.line - L) <= 1)).map((f) => f.id))]
    return { id, file, lines, ...d, cppcheck: cppcheck ? (ids.length ? ids : false) : null }
  })
  total += defects.length
  byCpp += defects.filter((d) => d.cppcheck).length
  const c = { id: caseId, title: meta.title, target: meta.target, targetText: TARGET_TEXT[meta.target], defects, clean, cppcheckFindings: findings }
  fs.writeFileSync(path.join(outRoot, caseId, 'case.json'), JSON.stringify(c, null, 2) + '\n')
  console.log(`${caseId.padEnd(26)} ${meta.target.padEnd(6)} 缺陷 ${String(defects.length).padStart(2)}  干净函数 ${clean.length}`)
}
console.log(`\n共 ${total} 个缺陷${cppcheck ? `，其中 Cppcheck 单独可检出 ${byCpp} 个` : '（未找到 cppcheck，未计算 Cppcheck 基线）'}`)
