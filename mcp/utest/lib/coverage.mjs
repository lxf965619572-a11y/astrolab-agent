// 解析 gcov JSON（gcov -j），统计语句、分支、条件（MC/DC）覆盖。
// 条件覆盖字段只有 GCC 14 及以上、编译时加 -fcondition-coverage、gcov 加 --conditions 时才有。

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import zlib from 'node:zlib'

export function readGcovJson(file) {
  const buf = readFileSync(file)
  const text = (buf[0] === 0x1f && buf[1] === 0x8b) ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')
  return JSON.parse(text)
}

const pct = (a, b) => (b ? Math.round((a * 1000) / b) / 10 : null)

/**
 * 汇总覆盖率。
 * @param {object[]} docs gcov JSON 文档
 * @param {(file: string) => boolean} want 只统计哪些源文件（被测文件）
 */
export function summarize(docs, want) {
  const files = new Map()
  for (const doc of docs) {
    for (const f of doc.files || []) {
      if (!want(f.file)) continue
      let entry = files.get(f.file)
      if (!entry) { entry = { file: f.file, functions: new Map(), lines: new Map() }; files.set(f.file, entry) }
      for (const fn of f.functions || []) {
        const name = fn.demangled_name || fn.name
        if (!entry.functions.has(name)) entry.functions.set(name, { name, start: fn.start_line, end: fn.end_line, calls: 0 })
        entry.functions.get(name).calls += fn.execution_count || 0
      }
      for (const ln of f.lines || []) {
        const prev = entry.lines.get(ln.line_number)
        if (!prev) {
          entry.lines.set(ln.line_number, {
            line: ln.line_number,
            fn: ln.function_name,
            count: ln.count || 0,
            branches: (ln.branches || []).filter((b) => !b.throw).map((b) => b.count || 0),
            conditions: ln.conditions ? ln.conditions.map((c) => ({ ...c })) : null,
          })
        } else {
          // 同一源文件被多个目标文件包含时合并
          prev.count += ln.count || 0
          ;(ln.branches || []).filter((b) => !b.throw).forEach((b, k) => { prev.branches[k] = (prev.branches[k] || 0) + (b.count || 0) })
        }
      }
    }
  }

  const out = []
  let tot = { lines: 0, linesHit: 0, br: 0, brHit: 0, cond: 0, condHit: 0, condMeasured: false }
  for (const entry of files.values()) {
    const perFn = new Map()
    const fnOf = (l) => {
      if (l.fn) return l.fn
      for (const f of entry.functions.values()) if (l.line >= f.start && l.line <= f.end) return f.name
      return '(文件级)'
    }
    for (const l of entry.lines.values()) {
      const name = fnOf(l)
      let s = perFn.get(name)
      if (!s) { s = { name, lines: 0, linesHit: 0, br: 0, brHit: 0, cond: 0, condHit: 0, condMeasured: false, uncoveredLines: [], untakenBranches: [], uncoveredConditions: [] }; perFn.set(name, s) }
      s.lines++
      if (l.count > 0) s.linesHit++
      else s.uncoveredLines.push(l.line)
      if (l.branches.length) {
        s.br += l.branches.length
        const hit = l.branches.filter((c) => c > 0).length
        s.brHit += hit
        if (hit < l.branches.length) s.untakenBranches.push({ line: l.line, taken: hit, total: l.branches.length })
      }
      if (l.conditions) {
        s.condMeasured = true
        for (const c of l.conditions) {
          s.cond += c.count || 0
          s.condHit += c.covered || 0
          if ((c.covered || 0) < (c.count || 0)) {
            s.uncoveredConditions.push({ line: l.line, covered: c.covered, total: c.count, notCoveredTrue: c.not_covered_true || [], notCoveredFalse: c.not_covered_false || [] })
          }
        }
      }
    }
    const functions = [...perFn.values()].sort((a, b) => (entry.functions.get(a.name)?.start ?? 0) - (entry.functions.get(b.name)?.start ?? 0)).map((s) => ({
      name: s.name,
      called: entry.functions.get(s.name)?.calls ?? null,
      statements: { covered: s.linesHit, total: s.lines, percent: pct(s.linesHit, s.lines) },
      branches: { covered: s.brHit, total: s.br, percent: pct(s.brHit, s.br) },
      mcdc: s.condMeasured ? { covered: s.condHit, total: s.cond, percent: pct(s.condHit, s.cond) } : null,
      uncoveredLines: s.uncoveredLines,
      untakenBranches: s.untakenBranches,
      uncoveredConditions: s.uncoveredConditions,
    }))
    const sum = functions.reduce((a, f) => {
      a.lines += f.statements.total; a.linesHit += f.statements.covered
      a.br += f.branches.total; a.brHit += f.branches.covered
      if (f.mcdc) { a.cond += f.mcdc.total; a.condHit += f.mcdc.covered; a.condMeasured = true }
      return a
    }, { lines: 0, linesHit: 0, br: 0, brHit: 0, cond: 0, condHit: 0, condMeasured: false })
    tot.lines += sum.lines; tot.linesHit += sum.linesHit; tot.br += sum.br; tot.brHit += sum.brHit
    tot.cond += sum.cond; tot.condHit += sum.condHit; tot.condMeasured ||= sum.condMeasured
    out.push({
      file: entry.file,
      name: basename(entry.file),
      statements: { covered: sum.linesHit, total: sum.lines, percent: pct(sum.linesHit, sum.lines) },
      branches: { covered: sum.brHit, total: sum.br, percent: pct(sum.brHit, sum.br) },
      mcdc: sum.condMeasured ? { covered: sum.condHit, total: sum.cond, percent: pct(sum.condHit, sum.cond) } : null,
      functions,
    })
  }
  return {
    files: out,
    total: {
      statements: { covered: tot.linesHit, total: tot.lines, percent: pct(tot.linesHit, tot.lines) },
      branches: { covered: tot.brHit, total: tot.br, percent: pct(tot.brHit, tot.br) },
      mcdc: tot.condMeasured ? { covered: tot.condHit, total: tot.cond, percent: pct(tot.condHit, tot.cond) } : null,
    },
  }
}
