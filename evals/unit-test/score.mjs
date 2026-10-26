#!/usr/bin/env node
// 单元测试评分：用智能体（或人）写的测试，自动衡量三件事
//   1. 预期结果是否正确：在正确的参考版上，所有用例都应通过；失败的用例说明预期值写错了
//   2. 能否发现埋入的缺陷：逐个把缺陷放进参考版，看是否有新的用例失败
//   3. 检错能力：逐个应用变异体，被杀死（出现新的失败、崩溃或超时）的比例即变异得分
// 同时给出测试在参考版上的语句、分支、MC/DC 覆盖率。
//
// 用法：node evals/unit-test/score.mjs [用例名，默认 cmd_check] [测试目录，默认见 case.json 的 sampleTestDir] [--run <智能体的 last-run.json>]
// 需要 gcc（UTEST_CC），与 utest 服务相同。结果写到 evals/unit-test/results/<时间>-<用例名>/summary.md

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyPatches, buildSample, loadCase, loadLocalEnv, patchFile } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
// 用法：score.mjs [用例名] [测试目录] [--run <last-run.json>]…；--run 时沿用智能体运行时的宏定义和编译选项（多个测试程序时可以写多个 --run）
const argv = process.argv.slice(2)
const runRecs = []
for (let k = argv.indexOf('--run'); k >= 0; k = argv.indexOf('--run')) { runRecs.push(JSON.parse(readFileSync(argv[k + 1], 'utf8'))); argv.splice(k, 2) }
const uniq = (a) => [...new Set(a)]
const runDefines = uniq(runRecs.flatMap((r) => r.defines || []))
const runCflags = uniq(runRecs.flatMap((r) => r.cflags || []))
const name = argv[0] || 'cmd_check'
const caseDir = join(HERE, name)
if (!existsSync(join(caseDir, 'case.json'))) { console.error(`没有评测用例 ${name}（可选：${readdirSync(HERE, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(HERE, e.name, 'case.json'))).map((e) => e.name).join('、')}）`); process.exit(2) }
const cfg = loadCase(caseDir)
const testDir = resolve(argv[1] || join(ROOT, cfg.sampleTestDir))
if (!existsSync(testDir)) { console.error(`测试目录不存在：${testDir}`); process.exit(2) }
const isTestSrc = (f) => /\.(c|cpp|cc)$/i.test(f)

// 测试程序：用例配置了按单元分目录（testSubdir）且这些目录存在时，每个目录一个测试程序；
// 否则测试目录本身是一个测试程序，包含全部被测文件
let programs = cfg.programs.filter((p) => p.testSubdir && existsSync(join(testDir, p.testSubdir)) && readdirSync(join(testDir, p.testSubdir)).some(isTestSrc))
if (!programs.length) {
  if (!readdirSync(testDir).some(isTestSrc)) { console.error(`测试目录中没有 .c/.cpp 文件：${testDir}${cfg.programs.some((p) => p.testSubdir) ? `（也没有 ${cfg.programs.map((p) => p.testSubdir).join('、')} 子目录）` : ''}`); process.exit(2) }
  programs = [{ name, sources: cfg.files.map((f) => f.name), testSubdir: null }]
}
const missingProg = cfg.programs.filter((p) => p.testSubdir && !programs.includes(p))
for (const p of programs) p.tests = readdirSync(p.testSubdir ? join(testDir, p.testSubdir) : testDir).filter(isTestSrc)

loadLocalEnv(ROOT) // UTEST_CC 等编译器设置，与 start-web.ps1 读入的相同
const work = mkdtempSync(join(tmpdir(), 'utest-score-'))
process.env.DOC_ALLOWED_ROOTS = work
const { runUnitTests } = await import(pathToFileURL(join(ROOT, 'mcp', 'utest', 'tools.mjs')).href)

const defects = JSON.parse(readFileSync(join(caseDir, 'defects.json'), 'utf8')).defects
const mutants = JSON.parse(readFileSync(join(caseDir, 'mutants.json'), 'utf8')).mutants
// 工作区中的被测代码应与“参考版 + 埋入缺陷”完全一致；不一致说明测试过程中修改了被测代码
const modifiedFiles = cfg.files.filter((f) => {
  const p = join(ROOT, f.sample)
  return existsSync(p) && readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== buildSample(f.text, defects.filter((d) => patchFile(cfg, d) === f.name)).replace(/\r\n/g, '\n')
}).map((f) => f.sample)
const sampleModified = modifiedFiles.length > 0
const refSources = Object.fromEntries(cfg.files.map((f) => [f.name, f.text]))
const withPatch = (p) => ({ ...refSources, [patchFile(cfg, p)]: applyPatches(refSources[patchFile(cfg, p)], [p]) })

function headerDirs(root) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = join(d, e.name)
      if (readdirSync(p).some((f) => /\.(h|hpp)$/i.test(f))) out.push(p)
      walk(p)
    }
  }
  walk(root)
  return out
}

// 每次运行建一个独立目录树：src/（被测文件目录的全部文件，含同目录的头文件）、include/、test/，保持测试文件中的相对 #include 有效
let seq = 0
async function runVariant(sources, label) {
  const dir = join(work, `v${++seq}`)
  cpSync(join(ROOT, cfg.sampleSrcDir), join(dir, 'src'), { recursive: true })
  cpSync(join(ROOT, cfg.sampleInclude), join(dir, 'include'), { recursive: true })
  cpSync(testDir, join(dir, 'test'), { recursive: true })
  for (const [n, text] of Object.entries(sources)) writeFileSync(join(dir, 'src', n), text)
  const res = { buildFailed: false, error: '', crashed: false, timedOut: false, failed: new Set(), cases: [], coverage: [], failures: [] }
  for (const p of programs) {
    const tdir = p.testSubdir ? join(dir, 'test', p.testSubdir) : join(dir, 'test')
    const r = await runUnitTests({
      sources: p.sources.map((n) => join(dir, 'src', n)),
      tests: p.tests.map((f) => join(tdir, f)),
      // 测试目录中含 .h 的子目录（如替换硬件头文件的 hw/）和测试目录放在被测头文件目录之前，替换头文件才能生效；
      // 与被测 .c 同目录的头文件由 run_unit_tests 自动替换
      includeDirs: [...headerDirs(tdir), tdir, join(dir, 'include')],
      defines: runDefines,
      cflags: runCflags,
      timeoutSec: 10,
      name: `${label}-${p.name}`,
    })
    const s = r.structuredContent || {}
    const tag = programs.length > 1 ? `${p.name}:` : ''
    if (r.isError) { res.buildFailed = true; res.error += `[${p.name}] ${r.content[0].text.slice(0, 800)}\n` }
    if (!r.isError && !s.summary && !s.timedOut) res.crashed = true
    if (s.timedOut) res.timedOut = true
    for (const c of s.cases || []) { res.cases.push({ ...c, id: tag + c.id }); if (c.result !== '通过') res.failed.add(tag + c.id) }
    for (const f of s.failures || []) res.failures.push({ ...f, id: tag + f.id })
    if (s.coverage) res.coverage.push({ program: p.name, ...s.coverage })
  }
  return res
}

const sumCov = (list, key) => {
  const parts = list.map((c) => c.total?.[key]).filter(Boolean)
  if (!parts.length) return null
  const covered = parts.reduce((a, c) => a + c.covered, 0), total = parts.reduce((a, c) => a + c.total, 0)
  return { covered, total, percent: total ? Math.round((covered * 1000) / total) / 10 : null }
}

console.log(`测试目录：${testDir}（${programs.map((p) => `${p.testSubdir ? p.testSubdir + '/' : ''}${p.tests.join('、')} → ${p.sources.join('、')}`).join('；')}）`)
const base = await runVariant(refSources, 'reference')
if (base.buildFailed) {
  console.error(`测试在参考版上编译或链接失败，无法评分：\n${base.error}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}
// 测试在正确的参考版上就崩溃或超时：后面每个变体也会崩溃，不能算“杀死”，缺陷检出和变异得分无效
const baseBroken = base.crashed || base.timedOut
const baseLast = base.cases.length ? base.cases[base.cases.length - 1] : null
const brokenNote = baseBroken
  ? `测试在**正确的参考版**上${base.timedOut ? '运行超时' : '异常结束（崩溃）'}${baseLast ? `，最后开始的用例是 ${baseLast.id}` : ''}。常见原因：被测代码访问了目标机的寄存器地址而测试没有替换寄存器访问；等待循环没有用桩控制退出。缺陷检出和变异得分无法计算。`
  : ''
const killedBy = (v) => {
  if (v.buildFailed) return null // 变异体无法编译，不计
  if (v.crashed || v.timedOut) return v.crashed ? '崩溃' : '超时'
  const extra = [...v.failed].filter((id) => !base.failed.has(id))
  return extra.length ? extra.slice(0, 4).join('、') + (extra.length > 4 ? ` 等 ${extra.length} 个` : '') : ''
}

const defectRows = []
if (!baseBroken) for (const d of defects) {
  const v = await runVariant(withPatch(d), d.id)
  defectRows.push({ ...d, by: killedBy(v) })
}
const mutantRows = []
if (!baseBroken) for (const m of mutants) {
  const v = await runVariant(withPatch(m), m.id)
  mutantRows.push({ ...m, by: killedBy(v) })
}
rmSync(work, { recursive: true, force: true })

const cov = base.coverage.length ? { statements: sumCov(base.coverage, 'statements'), branches: sumCov(base.coverage, 'branches'), mcdc: sumCov(base.coverage, 'mcdc') } : null
const f3 = (c, mcdc) => (c ? `${c.covered}/${c.total}（${c.percent}%）` : baseBroken || !cov ? '未取得（测试没有正常结束）' : mcdc ? '未测量（编译器不支持）' : '未测量')
const valid = mutantRows.filter((m) => m.by !== null)
const killed = valid.filter((m) => m.by)
const found = defectRows.filter((d) => d.by)
const casesTotal = base.cases.length

const L = []
L.push(`# 单元测试评分：${name}`, '')
L.push(`- 测试目录：\`${testDir}\``)
L.push(`- 时间：${new Date().toISOString()}`, '')
L.push('## 结论', '')
L.push('| 指标 | 结果 | 说明 |', '|---|---|---|')
L.push(`| 用例数 | ${casesTotal} | |`)
L.push(`| 预期结果错误 | **${base.failed.size}** | 在正确的参考版上失败的用例，说明预期值不是按设计推导的 |`)
L.push(baseBroken ? `| 埋入缺陷检出 | **无法评分** | 见下方说明 |` : `| 埋入缺陷检出 | **${found.length}/${defectRows.length}** | |`)
L.push(baseBroken ? `| 变异得分 | **无法评分** | 见下方说明 |` : `| 变异得分 | **${killed.length}/${valid.length}（${valid.length ? Math.round((killed.length * 100) / valid.length) : 0}%）** | 越高说明测试检错能力越强 |`)
L.push(`| 语句覆盖（参考版） | ${f3(cov?.statements)} | 要求 100% |`)
L.push(`| 分支覆盖（参考版） | ${f3(cov?.branches)} | 要求 100% |`)
L.push(`| MC/DC（参考版） | ${f3(cov?.mcdc, true)} | 尽可能高 |`)
L.push(`| 被测代码是否被修改 | ${sampleModified ? `**是**（${modifiedFiles.join('、')}）` : '否'} | 与 \`${cfg.sampleSrcDir}\` 中的原始版本比较；被修改是严重违规（恢复：node evals/unit-test/build-sample.mjs ${name}） |`, '')
if (programs.length > 1) {
  L.push('| 测试程序 | 被测文件 | 用例 | 语句 | 分支 |', '|---|---|---|---|---|')
  for (const p of programs) {
    const c = base.coverage.find((x) => x.program === p.name)?.total
    L.push(`| ${p.testSubdir}/ | ${p.sources.join('、')} | ${base.cases.filter((x) => x.id.startsWith(p.name + ':')).length} | ${f3(c?.statements)} | ${f3(c?.branches)} |`)
  }
  L.push('')
}
if (missingProg.length) L.push(`注意：测试目录中没有 ${missingProg.map((p) => `${p.testSubdir}/（测 ${p.sources.join('、')}）`).join('、')}，这些单元没有测试。`, '')
if (baseBroken) L.push('## 测试无法完成', '', brokenNote, '')
if (base.failed.size) {
  L.push('## 预期结果错误的用例', '')
  for (const f of base.failures) L.push(`- ${f.id} ${String(f.detail).split(work).join('<临时目录>')}`)
  for (const c of base.cases) if (c.result === '未结束') L.push(`- ${c.id} 没有结束（崩溃或超时）`)
  L.push('')
}
if (!baseBroken) L.push('## 埋入缺陷', '', '| 编号 | 缺陷 | 检出 | 检出的用例 |', '|---|---|---|---|')
for (const d of defectRows) L.push(`| ${d.id} | ${d.title} | ${d.by ? '是' : '**否**'} | ${d.by || `应设计：${d.detectBy}`} |`)
if (!baseBroken) L.push('', '## 变异体', '', '| 编号 | 变异 | 结果 |', '|---|---|---|')
for (const m of mutantRows) {
  // 显示第一处不同的行，避免多行补丁只显示相同的首行
  const fl = m.find.split('\n'), rl = m.replace.split('\n')
  let k = 0
  while (k < fl.length && fl[k] === rl[k]) k++
  if (k >= fl.length) k = 0
  const a = (fl[k] || '').trim(), b = (rl[k] || '').trim()
  let c = 0
  while (c < a.length && a[c] === b[c]) c++
  const from = Math.max(0, c - 25)
  const cut = (t) => (from ? '…' : '') + t.trim().slice(from, from + 60).replace(/\|/g, '\\|')
  const what = fl[k] === undefined || !fl[k].trim()
    ? `插入 \`${(rl[k] || '').trim().slice(0, 60)}\``
    : `\`${cut(fl[k])}\` → \`${rl[k] !== undefined && rl[k].trim() ? cut(rl[k]) : '（删除）'}\``
  L.push(`| ${m.id} | ${m.file ? m.file + '：' : ''}${what} | ${m.by === null ? '无法编译（不计）' : m.by ? `杀死（${m.by}）` : '**存活**'} |`)
}
const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)
const outDir = join(HERE, 'results', `${stamp}-${name}-${basename(testDir)}`)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'summary.md'), L.join('\n') + '\n')
{ const k = L.indexOf('## 埋入缺陷'); console.log(L.slice(0, k >= 0 ? k : L.length).join('\n')) }
console.log(`\n详细结果：${join(outDir, 'summary.md')}`)
