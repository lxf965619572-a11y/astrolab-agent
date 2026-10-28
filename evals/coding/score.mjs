#!/usr/bin/env node
// 编码评测评分：对智能体在 AstroLab 示例工程 coding/<用例名> 中写的代码和编码说明做客观检查，结果写到
// evals/coding/results/<时间>-<用例名>/summary.md（同时保存代码和编码说明的副本）。
//   1. 隐藏测试（按详细设计推导，智能体看不到）：逐条 PASS/FAIL；
//   2. 严格告警编译（与 compile_check 工具相同的开关）；
//   3. Cppcheck（找得到才运行）；
//   4. 编码技能的自查脚本 check-code.mjs；
//   5. 过程要求：设计和头文件没被改、没写单元测试、编码说明的五部分、设计追溯；
//   6. 待确认问题的线索（启发式，只给“疑似提出”和原文位置，最后由人对照答案表判断）。
// 用法：node evals/coding/score.mjs [用例名，默认 thm_ctrl] [--ws <工作区目录>]
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { caseDir, HERE, loadLocalEnv, readText, ROOT, run, runHidden, sampleWorkspace, tmp, toolchain, walk, writeText } from './lib.mjs'

const argv = process.argv.slice(2)
const wsArg = argv.indexOf('--ws')
const name = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ws') || 'thm_ctrl'
const ws = wsArg >= 0 ? argv[wsArg + 1] : join(sampleWorkspace().dir, 'coding', name)
const dir = caseDir(name)
const inputs = join(dir, 'inputs')
if (!existsSync(inputs)) { console.error(`没有这个用例：${name}`); process.exit(2) }
if (!existsSync(ws)) { console.error(`工作区不存在：${ws}`); process.exit(2) }
loadLocalEnv(ROOT)
const tc = await toolchain()
if (!tc.ok) { console.error(tc.error); process.exit(2) }

const rel = (p) => relative(ws, p).replace(/\\/g, '/')
const all = walk(ws)
const inputRels = new Set(walk(inputs).map((f) => relative(inputs, f).replace(/\\/g, '/')))
const isTestFile = (p) => /(^|\/)(tests?|ut|unittest)\//i.test(rel(p)) || /(^|[_/])test[_.]|_test\.c$/i.test(rel(p))
const cFiles = all.filter((p) => /\.c$/i.test(p) && !isTestFile(p))
const hFiles = all.filter((p) => /\.h$/i.test(p) && !isTestFile(p))
const ownH = hFiles.filter((p) => !inputRels.has(rel(p)))
const testFiles = all.filter((p) => /\.(c|cpp|cc|h)$/i.test(p) && isTestFile(p))
const notes = all.filter((p) => /编码说明.*\.md$/i.test(basename(p)))
if (!cFiles.length) { console.error(`工作区里没有 .c 文件：${ws}\n（示例工程在别处时用 --ws <目录> 指定）`); process.exit(2) }

const L = []
const out = (s = '') => L.push(s)
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const resDir = join(HERE, 'results', `${stamp}-${name}`)

out(`# 编码评测结果：${name}`)
out()
out(`- 时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`)
out(`- 工作区：${ws}`)
out(`- 被测代码：${cFiles.map(rel).join('、')}${ownH.length ? `；新增头文件：${ownH.map(rel).join('、')}` : ''}`)
out(`- 编译器：${tc.cc}（gcc ${tc.version}）`)
out()

// ---------- 1 隐藏测试 ----------
const incDirs = [...new Set([join(ws, 'include'), ...hFiles.map(dirname)])]
const hidden = await runHidden({ cc: tc.cc, name, cFiles, incDirs, work: tmp('coding-score-') })
const total = 16
out('## 1 隐藏测试（按详细设计推导）')
out()
if (!hidden.ok) {
  out(`**编译或链接失败，0/${total}。**常见原因：改了头文件中的原型、缺函数、自己定义了 thm_hw.h 中的硬件函数。`)
  out(); out('```'); out(hidden.compileError); out('```')
} else {
  out(`**${hidden.pass}/${total} 通过**${hidden.crashed ? '（测试程序没有正常结束，后面的用例没有运行）' : ''}`)
  out(); out('| 用例 | 结果 | 原因 |'); out('|---|---|---|')
  for (const r of hidden.results) out(`| ${r.id} | ${r.pass ? '通过' : '**失败**'} | ${r.why.replace(/\|/g, '\\|')} |`)
}
out()

// ---------- 2 严格告警编译 ----------
process.env.DOC_ALLOWED_ROOTS = [ws, tmp('coding-cc-')].join(';')
const { compileCheck } = await import(pathToFileURL(join(ROOT, 'mcp', 'utest', 'tools.mjs')).href)
const cc = await compileCheck({ sources: cFiles, includeDirs: incDirs, std: 'c99', target: 'sparc' })
const ccData = cc.structuredContent || {}
const ccText = (cc.content || []).map((c) => c.text).join('\n')
out('## 2 严格告警编译（与 compile_check 相同）')
out()
if (cc.isError) out(`未能运行：${ccText}`)
else {
  out(`错误 ${ccData.errors}，告警 ${ccData.warnings}`)
  const diags = ccText.split('\n').slice(2)
  if (diags.length) { out(); out('```'); out(diags.slice(0, 40).join('\n')); out('```') }
}
out()

// ---------- 3 Cppcheck ----------
function findCppcheck() {
  if (process.env.CPPCHECK_PATH) return process.env.CPPCHECK_PATH
  if (process.platform === 'win32') for (const b of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (b && existsSync(join(b, 'Cppcheck', 'cppcheck.exe'))) return join(b, 'Cppcheck', 'cppcheck.exe')
  return 'cppcheck'
}
out('## 3 Cppcheck')
out()
const cpp = await run(findCppcheck(), ['--enable=warning,style,performance,portability', '--platform=unix32', '--std=c99', '--language=c', '--inconclusive', '--quiet',
  '--template={file}:{line}: {severity} [{id}] {message}', ...incDirs.map((d) => `-I${d}`), ...cFiles], { cwd: ws, timeoutMs: 300_000 })
let cppCount = null
if (cpp.spawnError || (cpp.code !== 0 && !cpp.stderr.includes(':'))) out('未运行（找不到 cppcheck；可设置 CPPCHECK_PATH）')
else {
  const lines = cpp.stderr.split(/\r?\n/).filter((l) => /: (error|warning|style|performance|portability|information) \[/.test(l) && !/missingInclude/.test(l))
  cppCount = lines.length
  out(`告警 ${lines.length} 条`)
  if (lines.length) { out(); out('```'); out(lines.slice(0, 40).map((l) => l.replace(ws, '.')).join('\n')); out('```') }
}
out()

// ---------- 4 自查脚本 ----------
const chk = await run(process.execPath, [join(ROOT, 'skills', 'coding', 'scripts', 'check-code.mjs'), ...cFiles, ...ownH], { cwd: ws })
const chkStat = (chk.stdout.match(/^统计：.*$/m) || ['（没有统计行）'])[0]
const mustFix = Number((chkStat.match(/必须处理 (\d+)/) || [])[1] ?? NaN)
out('## 4 编码技能自查脚本 check-code.mjs')
out()
out(chkStat)
const chkItems = chk.stdout.split(/\r?\n/).filter((l) => l.startsWith('- '))
if (chkItems.length) { out(); for (const l of chkItems.slice(0, 30)) out(l.replace(ws, '.')) }
out()

// ---------- 5 过程要求 ----------
const changed = [...inputRels].filter((r) => { const p = join(ws, r); return !existsSync(p) || readText(p) !== readText(join(inputs, r)) })
const code = cFiles.map(readText).join('\n')
const traced = [...new Set(code.match(/D-0\d/g) || [])].sort()
const designItems = [...new Set(readText(join(inputs, 'doc', `${name}-详细设计.md`)).match(/D-0\d/g) || [])].sort()
const note = notes.length ? notes.map(readText).join('\n\n') : ''
const sections = [
  ['实现清单', /实现清单/],
  ['偏离和待确认问题', /(偏离|待确认)/],
  ['编译结果', /编译结果|编译检查/],
  ['静态检查结果', /静态检查|Cppcheck/i],
  ['自查结果', /自查/],
]
const missingSec = note ? sections.filter(([, re]) => !re.test(note)).map(([n]) => n) : sections.map(([n]) => n)
const pubFns = [...readText(join(inputs, 'include', `${name}.h`)).matchAll(/^\s*\w[\w\s*]*?\b(thm_\w+)\s*\(/gm)].map((m) => m[1])
const fnMissingInNote = note ? pubFns.filter((f) => !note.includes(f)) : pubFns
const notedNA = /未运行/.test(note)
const proc = [
  ['设计文档和头文件没有改', !changed.length, changed.length ? `被改：${changed.join('、')}` : ''],
  ['没有写单元测试（技能规定不写）', !testFiles.length, testFiles.map(rel).join('、')],
  ['严格编译 0 错误', !cc.isError && ccData.errors === 0, cc.isError ? '未运行' : `${ccData.errors} 个错误`],
  ['自查脚本“必须处理”为 0', mustFix === 0, Number.isNaN(mustFix) ? '脚本没有输出统计' : `${mustFix} 项`],
  ['编码说明存在且五部分齐全', notes.length > 0 && !missingSec.length, !notes.length ? '没有找到 编码说明-*.md' : missingSec.length ? `缺：${missingSec.join('、')}` : notes.map(rel).join('、')],
  ['实现清单列出全部对外函数', notes.length > 0 && !fnMissingInNote.length, fnMissingInNote.length ? `没提到：${fnMissingInNote.join('、')}` : ''],
  ['代码里有全部设计条目的追溯', designItems.every((d) => traced.includes(d)), `代码中出现 ${traced.join('、') || '无'}；设计共 ${designItems.join('、')}`],
]
out('## 5 过程要求')
out()
out('| 要求 | 结果 | 说明 |'); out('|---|---|---|')
for (const [n, ok, why] of proc) out(`| ${n} | ${ok ? '满足' : '**不满足**'} | ${why} |`)
out()
if (notedNA) { out('编码说明中写了“未运行”的项：核对是否确实没有运行（工具不可用），而不是漏跑。'); out() }

// ---------- 6 待确认问题线索 ----------
// 在编码说明和代码注释里找；每条线索给出文件和行号，由人对照答案表判断是否“提出且处理正确”
// 代码只看注释行（代码本身按头文件注释写成 600 不算“提出问题”）
const commentsOnly = (t) => t.split('\n').map((l) => (/\/\*|\/\/|^\s*\*/.test(l) ? l : '')).join('\n')
const corpus = [...notes.map((p) => [rel(p), readText(p)]), ...cFiles.map((p) => [rel(p), commentsOnly(readText(p))])]
function clues(test) {
  const hits = []
  for (const [f, text] of corpus) {
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const win = lines.slice(Math.max(0, i - 1), i + 2).join(' ')
      if (test(lines[i], win)) hits.push(`${f}:${i + 1}  ${lines[i].trim().slice(0, 120)}`)
    }
  }
  return hits
}
const Q = [
  ['Q1 温度范围：头文件注释 -40～+60 ℃ 与设计 ±50 ℃ 矛盾', (l, w) => /(-?400\b|\b600\b|60(\.0)?\s*℃|\+60)/.test(l) && /(500|50(\.0)?\s*℃|设计)/.test(w)],
  ['Q2 两份传感器都不可用时加热器保持原状（可能持续加热到时限，或一直不加热）', (l, w) => /(两份|主备份?|主份和备份|主、备|双份|都)[^。\n|]{0,24}(故障|无效|不可用|失效)/.test(l) && /(加热|保持)/.test(w)],
  ['Q3 校验算法：头文件注释“异或”与设计“累加和”矛盾', (l, w) => /(异或|XOR)/i.test(l) && /(累加|和|设计)/.test(w)],
]
out('## 6 待确认问题线索（启发式，需人工确认）')
out()
for (const [title, test] of Q) {
  const h = clues(test)
  out(`- **${title}**：${h.length ? `疑似提出（${h.length} 处）` : '未发现'}`)
  for (const x of h.slice(0, 5)) out(`  - \`${x.replace(/`/g, "'")}\``)
}
out()
out('对照 `evals/coding/' + name + '/答案表.md` 评分：问题是否提出、是否引用了两处原文、实现是否仍按设计（隐藏测试 T02、T09、T15 会反映）。')
out()

// ---------- 汇总 ----------
const procOk = proc.filter(([, ok]) => ok).length
out('## 汇总')
out()
out(`| 项目 | 结果 |`); out('|---|---|')
out(`| 隐藏测试 | ${hidden.ok ? hidden.pass : 0}/${total} |`)
out(`| 严格编译 | ${cc.isError ? '未运行' : `${ccData.errors} 错误，${ccData.warnings} 告警`} |`)
out(`| Cppcheck | ${cppCount === null ? '未运行' : `${cppCount} 条`} |`)
out(`| 自查脚本 | ${chkStat.replace(/^统计：/, '')} |`)
out(`| 过程要求 | ${procOk}/${proc.length} |`)
out(`| 待确认问题线索 | ${Q.map(([t, f]) => `${t.slice(0, 2)}${clues(f).length ? '有' : '无'}`).join('，')} |`)

const text = L.join('\n') + '\n'
mkdirSync(resDir, { recursive: true })
writeText(join(resDir, 'summary.md'), text)
if (hidden.log) writeText(join(resDir, 'hidden-test.log'), hidden.log)
for (const p of [...cFiles, ...ownH, ...notes]) cpSync(p, join(resDir, 'workspace', rel(p)))
console.log(text)
console.log(`结果已保存：${resDir}`)
