#!/usr/bin/env node
// 代码走查评测打分：把模型输出的 findings.json 与标准答案比对
// 用法：node evals/score.mjs <结果目录>      （run.mjs 跑完会自动调用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFindings } from './lib.mjs'

const LINE_TOL = 2   // 行号容差：模型报告的行号与答案相差不超过 2 行算命中

const base = (f) => path.posix.basename(String(f || '').replace(/\\/g, '/').replace(/:\d+.*$/, '')).toLowerCase()
const firstInt = (v) => { const m = String(v ?? '').match(/\d+/); return m ? Number(m[0]) : NaN }
const isMinor = (sev) => /建议|suggest|info|low|minor|style/i.test(String(sev || ''))
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—')
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function scoreRun(runDir) {
  const c = JSON.parse(fs.readFileSync(path.join(runDir, 'case.json'), 'utf8'))
  const fp = path.join(runDir, 'review', 'findings.json')
  const parsed = parseFindings(fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null)
  const findings = parsed.items.map((f, i) => ({
    idx: i,
    file: base(f.file ?? f.path ?? f.location),
    line: firstInt(f.line ?? f.lineNumber ?? f.location),
    severity: f.severity ?? f.level ?? '',
    checklist: f.checklist ?? f.rule ?? f.check ?? '',
    description: String(f.description ?? f.message ?? f.desc ?? ''),
  }))

  // 候选配对：同一文件、行号在容差内；描述命中关键词的优先
  const pairs = []
  for (const f of findings) {
    for (const d of c.defects) {
      if (f.file !== base(d.file) || Number.isNaN(f.line)) continue
      const dist = Math.min(...d.lines.map((L) => Math.abs(f.line - L)))
      if (dist > LINE_TOL) continue
      const text = `${f.description} ${f.checklist}`.toLowerCase()
      const kw = (d.keywords || []).some((k) => text.includes(k.toLowerCase()))
      pairs.push({ f, d, cost: dist - (kw ? 1.5 : 0) })
    }
  }
  pairs.sort((a, b) => a.cost - b.cost)
  const usedF = new Set()
  const hit = new Map()
  for (const p of pairs) {
    if (usedF.has(p.f.idx) || hit.has(p.d.id)) continue
    usedF.add(p.f.idx)
    hit.set(p.d.id, p.f)
  }

  const cleanHits = []
  const extras = []
  for (const f of findings) {
    if (usedF.has(f.idx)) continue
    const region = c.clean.find((r) => base(r.file) === f.file && f.line >= r.from && f.line <= r.to)
    if (region) cleanHits.push({ ...f, falsePositive: !isMinor(f.severity) })
    else extras.push(f)
  }

  const meta = fs.existsSync(path.join(runDir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')) : {}
  return {
    case: c.id,
    title: c.title,
    target: c.target,
    repeat: meta.repeat ?? 1,
    findingsOk: parsed.ok,
    findingsError: parsed.error,
    findingsCount: findings.length,
    expected: c.defects.length,
    detected: hit.size,
    defects: c.defects.map((d) => ({
      id: d.id, checklist: d.checklist, severity: d.severity, description: d.description,
      file: d.file, lines: d.lines, cppcheck: Boolean(d.cppcheck),
      detected: hit.has(d.id), matchedBy: hit.get(d.id) ?? null,
    })),
    falsePositives: cleanHits.filter((x) => x.falsePositive),
    cleanMinor: cleanHits.filter((x) => !x.falsePositive),
    extras,
    durationMs: meta.durationMs ?? null,
    timedOut: meta.timedOut ?? false,
    session: meta.session ?? null,
  }
}

export function scoreAll(outDir) {
  const runsDir = path.join(outDir, 'runs')
  const runs = fs.readdirSync(runsDir).sort().map((d) => scoreRun(path.join(runsDir, d)))
  const info = fs.existsSync(path.join(outDir, 'info.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'info.json'), 'utf8')) : {}

  const sum = (f) => runs.reduce((a, r) => a + f(r), 0)
  const expected = sum((r) => r.expected)
  const detected = sum((r) => r.detected)
  const cppBase = sum((r) => r.defects.filter((d) => d.cppcheck).length)
  const modelOnly = sum((r) => r.defects.filter((d) => d.detected && !d.cppcheck).length)
  const fps = sum((r) => r.falsePositives.length)
  const extras = sum((r) => r.extras.length)
  const bad = runs.filter((r) => !r.findingsOk).length
  const durs = runs.map((r) => r.durationMs).filter((x) => x != null)
  const calls = runs.map((r) => r.session?.toolCalls).filter((x) => x != null)
  const tok = (k) => runs.reduce((a, r) => a + (r.session?.tokens?.[k] || 0), 0)

  const group = (keyFn) => {
    const g = {}
    for (const r of runs) for (const d of r.defects) {
      const k = keyFn(r, d)
      g[k] ??= { expected: 0, detected: 0 }
      g[k].expected++
      if (d.detected) g[k].detected++
    }
    return g
  }
  const byTarget = group((r) => r.target)
  const bySeverity = group((r, d) => d.severity)
  const byChecklist = group((r, d) => d.checklist)

  // 多次重复时，每个缺陷的检出率
  const perDefect = {}
  for (const r of runs) for (const d of r.defects) {
    const k = `${r.case}/${d.id}`
    perDefect[k] ??= { case: r.case, id: d.id, description: d.description, runs: 0, hits: 0 }
    perDefect[k].runs++
    if (d.detected) perDefect[k].hits++
  }

  const summary = {
    generatedAt: new Date().toISOString(), info,
    totals: {
      runs: runs.length, expected, detected, recall: expected ? detected / expected : null,
      cppcheckBaseline: cppBase, modelOnlyDetected: modelOnly,
      falsePositives: fps, extras, invalidFindings: bad,
      avgDurationSec: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length / 1000 : null,
      avgToolCalls: calls.length ? calls.reduce((a, b) => a + b, 0) / calls.length : null,
      tokens: { input: tok('inputTokens'), cacheRead: tok('cacheReadTokens'), output: tok('outputTokens'), total: tok('totalTokens') },
    },
    byTarget, bySeverity, byChecklist, perDefect: Object.values(perDefect), runs,
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(outDir, 'summary.md'), renderMd(summary))
  return summary
}

function renderMd(s) {
  const t = s.totals
  const L = []
  L.push(`# 代码走查评测结果`, '')
  L.push(`| 项目 | 值 |`, `|---|---|`)
  L.push(`| 时间 | ${s.info.startedAt ?? s.generatedAt} |`)
  if (s.info.label) L.push(`| 标签 | ${cell(s.info.label)} |`)
  L.push(`| 模型 | ${cell(s.runs.find((r) => r.session?.model)?.session.model ?? s.info.model ?? '未知')}${s.info.baseUrl ? `（${cell(s.info.baseUrl)}）` : ''} |`)
  L.push(`| DSH 版本 | ${s.info.dshVersion ?? '—'} |`)
  L.push(`| Skill 指纹 | SKILL.md ${s.info.skillHash ?? '—'}，检查表 ${s.info.checklistHash ?? '—'}，提示词 ${s.info.promptHash ?? '—'} |`)
  L.push(`| 运行次数 | ${t.runs}（用例 × 重复次数） |`, '')

  L.push(`## 总体`, '')
  L.push(`| 指标 | 值 | 说明 |`, `|---|---|---|`)
  L.push(`| 检出率（召回率） | **${pct(t.detected, t.expected)}**（${t.detected}/${t.expected}） | 命中标准答案中的缺陷比例 |`)
  L.push(`| Cppcheck 单独可检出 | ${pct(t.cppcheckBaseline, t.expected)}（${t.cppcheckBaseline}/${t.expected}） | 只靠静态分析工具的基线 |`)
  L.push(`| 模型额外检出 | ${t.modelOnlyDetected} | Cppcheck 检不出、模型检出的缺陷数 |`)
  L.push(`| 干净代码误报 | ${t.falsePositives} | 在无缺陷函数中报出的“严重/一般”问题 |`)
  L.push(`| 其他额外发现 | ${t.extras} | 不在答案中、也不在干净区的发现，**需人工判断**真伪 |`)
  L.push(`| findings.json 无效 | ${t.invalidFindings} | 未生成或格式错误的次数 |`)
  L.push(`| 平均耗时 | ${t.avgDurationSec != null ? `${t.avgDurationSec.toFixed(0)} 秒` : '—'} | |`)
  L.push(`| 平均工具调用 | ${t.avgToolCalls != null ? t.avgToolCalls.toFixed(1) : '—'} 次 | |`)
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n))
  L.push(`| Token 合计 | ${t.tokens.total ? k(t.tokens.total) : '—'} | 未缓存输入 ${k(t.tokens.input)}、缓存命中 ${k(t.tokens.cacheRead)}、输出 ${k(t.tokens.output)} |`, '')

  const grp = (title, g) => {
    L.push(`### ${title}`, '', `| 分类 | 检出 | 检出率 |`, `|---|---|---|`)
    for (const [k, v] of Object.entries(g).sort()) L.push(`| ${cell(k)} | ${v.detected}/${v.expected} | ${pct(v.detected, v.expected)} |`)
    L.push('')
  }
  grp('按目标平台', s.byTarget)
  grp('按严重程度', s.bySeverity)
  grp('按检查项', s.byChecklist)

  L.push(`## 分用例`, '', `| 用例 | 平台 | 检出 | 误报 | 额外 | 发现数 | 耗时 | 工具调用 | 用了 Skill | 调了 Cppcheck | 备注 |`, `|---|---|---|---|---|---|---|---|---|---|---|`)
  for (const r of s.runs) {
    const note = [!r.findingsOk && r.findingsError, r.timedOut && '超时', r.session?.peeked && '**可能读取过答案，结果作废**'].filter(Boolean).join('；')
    L.push(`| ${r.case}${r.repeat > 1 ? ` #${r.repeat}` : ''} | ${r.target} | ${r.detected}/${r.expected} | ${r.falsePositives.length} | ${r.extras.length} | ${r.findingsCount} | ${r.durationMs != null ? Math.round(r.durationMs / 1000) + 's' : '—'} | ${r.session?.toolCalls ?? '—'} | ${r.session ? (r.session.usedSkill ? '是' : '**否**') : '—'} | ${r.session ? (r.session.usedCppcheck ? '是' : '**否**') : '—'} | ${cell(note)} |`)
  }
  L.push('')

  const reps = s.perDefect.some((d) => d.runs > 1)
  L.push(`## 漏检清单`, '')
  const missed = s.perDefect.filter((d) => d.hits < d.runs)
  if (!missed.length) L.push('无。', '')
  else {
    L.push(`| 用例 | 缺陷 | 说明 |${reps ? ' 检出次数 |' : ''}`, `|---|---|---|${reps ? '---|' : ''}`)
    for (const d of missed) L.push(`| ${d.case} | ${d.id} | ${cell(d.description)} |${reps ? ` ${d.hits}/${d.runs} |` : ''}`)
    L.push('')
  }

  L.push(`## 干净代码误报`, '')
  const fpl = s.runs.flatMap((r) => r.falsePositives.map((f) => ({ r, f })))
  if (!fpl.length) L.push('无。', '')
  else {
    L.push(`| 用例 | 位置 | 严重程度 | 描述 |`, `|---|---|---|---|`)
    for (const { r, f } of fpl) L.push(`| ${r.case} | ${f.file}:${f.line} | ${cell(f.severity)} | ${cell(f.description)} |`)
    L.push('')
  }

  L.push(`## 其他额外发现（需人工判断）`, '', `这些问题不在标准答案中。可能是模型发现的真实问题（应补充进答案），也可能是误报或重复。`, '')
  const ex = s.runs.flatMap((r) => r.extras.map((f) => ({ r, f })))
  if (!ex.length) L.push('无。', '')
  else {
    L.push(`| 用例 | 位置 | 严重程度 | 描述 |`, `|---|---|---|---|`)
    for (const { r, f } of ex) L.push(`| ${r.case} | ${f.file}:${Number.isNaN(f.line) ? '?' : f.line} | ${cell(f.severity)} | ${cell(f.description)} |`)
    L.push('')
  }
  return L.join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) { console.error('用法：node evals/score.mjs <结果目录>'); process.exit(2) }
  const s = scoreAll(dir)
  console.log(`检出率 ${pct(s.totals.detected, s.totals.expected)}（${s.totals.detected}/${s.totals.expected}），干净代码误报 ${s.totals.falsePositives}，额外发现 ${s.totals.extras}`)
  console.log(`详细结果：${path.join(dir, 'summary.md')}`)
}
