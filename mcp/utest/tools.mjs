// 单元测试工具的实现（与 MCP 协议无关，便于单独测试）。
// 编译、链接、运行测试程序，解析测试结果，用 gcov 统计被测文件的覆盖率。

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedRoots, resolvePath } from '../common/paths.mjs'
import { readGcovJson, summarize } from './lib/coverage.mjs'
import { checkMcdc } from './lib/mcdc.mjs'
import { run, toolchain } from './lib/toolchain.mjs'

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), 'harness')
const ok = (result, text) => ({ content: [{ type: 'text', text: text ?? JSON.stringify(result, null, 2) }], structuredContent: result })
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] })
// Windows 下测试程序崩溃时的退出码（NTSTATUS）
const WIN_CRASH = { 0xC0000005: '访问违例：空指针、越界或访问了非法地址', 0xC00000FD: '栈溢出', 0xC0000094: '整数除以零', 0xC000001D: '非法指令', 0xC0000409: '栈缓冲区溢出检测' }
const winCrash = (code) => { const k = code < 0 ? code >>> 0 : code; return WIN_CRASH[k] ? `，${WIN_CRASH[k]}` : '' }
const sha1 = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 12)
const safeName = (s) => s.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'utest'

function buildRoot(name) {
  const root = allowedRoots()[0]
  const dir = join(root, '.utest', safeName(name))
  return dir
}

// —— 解析测试输出 ——
function parseHandwritten(out) {
  const cases = []
  const fails = []
  let summary = null
  for (const line of out.split(/\r?\n/)) {
    let m
    if ((m = /^\[CASE\]\s+(\S+)\s*(.*)$/.exec(line))) cases.push({ id: m[1], desc: m[2], result: '未结束' })
    else if ((m = /^\[PASS\]\s+(\S+)/.exec(line))) { const c = cases.findLast((x) => x.id === m[1]); if (c) c.result = '通过' }
    else if ((m = /^\[CASE-FAILED\]\s+(\S+)/.exec(line))) { const c = cases.findLast((x) => x.id === m[1]); if (c) c.result = '失败' }
    else if ((m = /^\[FAIL\]\s+(\S+)\s+(.*)$/.exec(line))) fails.push({ id: m[1], detail: m[2] })
    else if ((m = /^\[SUMMARY\]\s+cases=(\d+)\s+passed=(\d+)\s+failed=(\d+)\s+checks=(\d+)\s+failed_checks=(\d+)/.exec(line))) {
      summary = { cases: +m[1], passed: +m[2], failed: +m[3], checks: +m[4], failedChecks: +m[5] }
    }
  }
  return { cases, fails, summary }
}

function parseGtest(out) {
  const cases = []
  const fails = []
  let cur = null
  for (const line of out.split(/\r?\n/)) {
    let m
    if ((m = /^\[ RUN {6}\] (\S+)/.exec(line))) { cur = { id: m[1], desc: '', result: '未结束' }; cases.push(cur) }
    else if ((m = /^\[ {7}OK \] (\S+)/.exec(line))) { const c = cases.findLast((x) => x.id === m[1]); if (c) c.result = '通过' }
    else if ((m = /^\[ {2}FAILED {2}\] (\S+?)(?: \(|,|$)/.exec(line)) && cur && m[1] === cur.id) cur.result = '失败'
    else if ((m = /^(.+?):(\d+): Failure$/.exec(line)) && cur) fails.push({ id: cur.id, detail: `${m[1]}:${m[2]}` })
    else if (cur && fails.length && fails[fails.length - 1].id === cur.id && line.trim() && !line.startsWith('[')) {
      const f = fails[fails.length - 1]
      if (f.detail.length < 400) f.detail += ' ' + line.trim()
    }
  }
  const passed = cases.filter((c) => c.result === '通过').length
  return { cases, fails, summary: cases.length ? { cases: cases.length, passed, failed: cases.length - passed } : null }
}

function linkProblems(text) {
  const undef = new Set()
  const multi = new Set()
  for (const m of text.matchAll(/undefined reference to [`'‘]([^'’`]+)['’`]/g)) undef.add(m[1])
  for (const m of text.matchAll(/multiple definition of [`'‘]([^'’`]+)['’`]/g)) multi.add(m[1])
  return { undefined: [...undef], multiple: [...multi] }
}

const trimLog = (s, n = 4000) => (s.length > n ? s.slice(0, n) + `\n……（共 ${s.length} 字符，已截断）` : s)

// —— 被测 .c 同目录头文件的替换 ——
// #include "x.h" 先在包含它的文件所在目录查找，所以与被测 .c 同目录的头文件，不能靠 includeDirs 中的同名头文件替换。
// 检测到这种情况（includeDirs 中排在被测文件目录之前的目录里有同名头文件）时，把被测文件目录中的文件复制到
// 构建目录下的影子目录（不含被替换的头文件），编译影子目录中的副本；原目录追加到 includeDirs 最后，
// 使 "../xx/yy.h" 这类相对路径仍能找到。覆盖率按文件名统计，结果仍对应原文件。
const HEADER = /\.(h|hh|hpp|inc)$/i
const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))
function planShadows(srcAbs, incAbs, buildDir) {
  const plans = []
  for (const s of srcAbs) {
    const sdir = dirname(s)
    if (plans.some((p) => samePath(p.sdir, sdir))) continue
    let files = []
    try { files = readdirSync(sdir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) } catch { continue }
    const overridden = []
    for (const h of files.filter((f) => HEADER.test(f))) {
      for (const d of incAbs) {
        if (samePath(d, sdir)) break // 被测文件目录本身排在前面：用的就是它的头文件，不替换
        if (existsSync(join(d, h))) { overridden.push({ header: join(sdir, h), by: join(d, h) }); break }
      }
    }
    plans.push({ sdir, files, overridden, shadow: overridden.length ? join(buildDir, 'shadow', String(plans.length + 1)) : null })
  }
  for (const p of plans) {
    if (!p.shadow) continue
    mkdirSync(p.shadow, { recursive: true })
    const skip = new Set(p.overridden.map((o) => basename(o.header).toLowerCase()))
    for (const f of p.files) if (!skip.has(f.toLowerCase())) copyFileSync(join(p.sdir, f), join(p.shadow, f))
  }
  return plans.filter((p) => p.shadow)
}

export async function runUnitTests({ sources = [], tests = [], includeDirs = [], defines = [], cflags = [], framework = 'c', timeoutSec = 10, name }) {
  const tc = await toolchain()
  if (!tc.ok) return fail(tc.error)
  if (!sources.length) return fail('sources 不能为空：请给出被测源文件')
  if (!tests.length) return fail('tests 不能为空：请给出测试驱动和桩文件')
  const srcAbs = sources.map(resolvePath)
  const testAbs = tests.map(resolvePath)
  const missing = [...srcAbs, ...testAbs].filter((f) => !existsSync(f))
  if (missing.length) return fail(`文件不存在：${missing.join('、')}（相对路径按 ${process.cwd()} 解析）`)
  const overlap = testAbs.filter((t) => srcAbs.includes(t))
  if (overlap.length) return fail(`同一文件同时出现在 sources 和 tests 中：${overlap.join('、')}`)
  const incAbs = includeDirs.map(resolvePath)
  const cxx = framework === 'gtest'

  const runName = name || basename(srcAbs[0], extname(srcAbs[0]))
  const dir = buildRoot(runName)
  rmSync(dir, { recursive: true, force: true }) // 清掉上次的 .gcda，避免覆盖率累加
  const obj = join(dir, 'obj')
  mkdirSync(obj, { recursive: true })

  const shadows = planShadows(srcAbs, incAbs, dir)
  const shadowOf = (f) => { const p = shadows.find((x) => samePath(x.sdir, dirname(f))); return p ? { file: join(p.shadow, basename(f)), extraInc: [`-I${p.sdir}`] } : null }
  // 输出中的影子目录路径换回原目录，便于对照源码
  const unshadow = (t) => { let o = String(t ?? ''); for (const p of shadows) for (const v of [p.shadow, p.shadow.replace(/\\/g, '/')]) o = o.split(v).join(p.sdir); return o }

  const before = Object.fromEntries(srcAbs.map((f) => [f, sha1(f)]))
  const common = ['-O0', '-g', ...incAbs.map((d) => `-I${d}`), ...defines.map((d) => `-D${d}`)]
  const cov = ['--coverage', ...(tc.mcdc ? ['-fcondition-coverage'] : [])]
  const gtestRoot = process.env.UTEST_GTEST_ROOT
  const log = []
  const objects = []
  const instrumented = []
  const used = new Set()
  const objName = (f, prefix) => {
    let b = prefix + basename(f, extname(f))
    let k = 2
    while (used.has(b)) b = `${prefix}${basename(f, extname(f))}_${k++}`
    used.add(b)
    return join(obj, b + '.o')
  }

  // 测试文件中 #include 了被测 .c（为测试 static 函数）时，该测试文件也要插桩
  const includesProduct = (t) => {
    try {
      const txt = readFileSync(t, 'utf8')
      return srcAbs.some((s) => new RegExp(`#\\s*include\\s*["<][^">]*${basename(s).replace('.', '\\.')}[">]`).test(txt))
    } catch { return false }
  }

  // 测试文件 #include 了影子目录中的被测 .c 时，编译测试文件的副本，把这一行改为包含影子目录中的副本
  const testShadow = (t) => {
    if (!shadows.length) return null
    let txt
    try { txt = readFileSync(t, 'utf8') } catch { return null }
    let changed = false
    for (const s of srcAbs) {
      const sh = shadowOf(s)
      if (!sh) continue
      const re = new RegExp(`(#\\s*include\\s*)["<][^">]*${basename(s).replace('.', '\\.')}[">]`, 'g')
      if (re.test(txt)) { txt = txt.replace(re, (_, inc) => `${inc}"${sh.file.replace(/\\/g, '/')}"`); changed = true }
    }
    if (!changed) return null
    const d = join(dir, 'shadow', 'tests')
    mkdirSync(d, { recursive: true })
    const f = join(d, basename(t))
    writeFileSync(f, txt)
    return { file: f, extraInc: [`-I${dirname(t)}`] }
  }

  const compile = async (file, isTest) => {
    const isCpp = /\.(cc|cpp|cxx)$/i.test(file)
    const compiler = isCpp ? tc.cxx : tc.cc
    const o = objName(file, isTest ? 't_' : '')
    const instr = !isTest || includesProduct(file)
    const sh = isTest ? testShadow(file) : shadowOf(file)
    const args = ['-c', sh ? sh.file : file, '-o', o, ...common, ...(sh ? sh.extraInc : []), ...(isTest ? [`-I${HARNESS}`] : []), ...(instr ? cov : []),
      ...(isCpp && gtestRoot ? [`-I${join(gtestRoot, 'include')}`] : []), ...cflags]
    const r = await run(compiler, args, { cwd: dir })
    log.push(`$ ${basename(compiler)} ${args.join(' ')}\n${r.stderr}${r.stdout}`)
    if (instr) instrumented.push(o)
    objects.push(o)
    return { file, code: r.code, out: unshadow((r.stderr + r.stdout).trim()), spawnError: r.spawnError }
  }

  // 被测试文件 #include 的被测 .c 不再单独编译（否则重复定义），其覆盖率从测试文件的插桩结果中统计
  const includedByTest = srcAbs.filter((s) => testAbs.some((t) => {
    try { return new RegExp(`#\\s*include\\s*["<][^">]*${basename(s).replace('.', '\\.')}[">]`).test(readFileSync(t, 'utf8')) } catch { return false }
  }))
  const results = []
  for (const f of srcAbs) if (!includedByTest.includes(f)) results.push(await compile(f, false))
  for (const f of testAbs) results.push(await compile(f, true))
  const compileErrors = results.filter((r) => r.code !== 0)
  const warnings = results.filter((r) => r.code === 0 && /warning:/.test(r.out)).map((r) => ({ file: r.file, text: trimLog(r.out, 1500) }))
  if (compileErrors.length) {
    const result = { stage: '编译', ok: false, compiler: `${tc.cc} ${tc.version}`, errors: compileErrors.map((r) => ({ file: r.file, text: trimLog(r.out, 3000) })) }
    return { content: [{ type: 'text', text: `编译失败：\n${compileErrors.map((r) => `${r.file}\n${trimLog(r.out, 3000)}`).join('\n\n')}` }], structuredContent: result, isError: true }
  }

  const exe = join(dir, 'utest' + tc.exe)
  const linkArgs = [...objects, '-o', exe, '--coverage',
    ...(cxx ? [...(gtestRoot ? [`-L${join(gtestRoot, 'lib')}`] : []), '-lgtest', '-lgtest_main', ...(process.platform === 'win32' ? [] : ['-pthread'])] : [])]
  const lk = await run(cxx || testAbs.some((t) => /\.(cc|cpp|cxx)$/i.test(t)) ? tc.cxx : tc.cc, linkArgs, { cwd: dir })
  log.push(`$ link ${linkArgs.join(' ')}\n${lk.stderr}${lk.stdout}`)
  if (lk.code !== 0) {
    const p = linkProblems(lk.stderr + lk.stdout)
    const result = { stage: '链接', ok: false, undefinedSymbols: p.undefined, multipleDefinitions: p.multiple, log: trimLog(lk.stderr + lk.stdout, 3000) }
    let text = '链接失败。'
    if (p.undefined.length) text += `\n被测代码调用了以下外部函数或变量，测试工程中没有定义，需要编写桩：\n${p.undefined.map((s) => `- ${s}`).join('\n')}`
    if (p.multiple.length) text += `\n以下符号重复定义（常见原因：测试文件 #include 了被测 .c，又把它列在 sources 中；或桩与被测代码重名）：\n${p.multiple.map((s) => `- ${s}`).join('\n')}`
    text += `\n\n链接器输出：\n${trimLog(lk.stderr + lk.stdout, 2000)}`
    return { content: [{ type: 'text', text }], structuredContent: result, isError: true }
  }

  const rr = await run(exe, [], { cwd: dir, timeoutMs: Math.max(1, timeoutSec) * 1000 })
  const output = rr.stdout + (rr.stderr ? `\n[stderr]\n${rr.stderr}` : '')
  const parsed = cxx ? parseGtest(rr.stdout) : parseHandwritten(rr.stdout)
  let runNote = ''
  const lastCase = parsed.cases.length ? parsed.cases[parsed.cases.length - 1] : null
  const where = lastCase && lastCase.result === '未结束' ? `最后开始的用例是 ${lastCase.id}（${lastCase.desc}），问题出在该用例中。` : ''
  if (rr.timedOut) runNote = `测试程序运行超过 ${timeoutSec} 秒被终止。${where}常见原因：被测代码中的等待循环没有通过桩控制退出，或缺少超时处理（这本身可能是缺陷）。`
  else if (!parsed.summary) runNote = `测试程序异常结束（退出码 ${rr.code ?? '无，被信号终止'}${winCrash(rr.code)}），没有输出 [SUMMARY] 行。${where}可能是越界访问、空指针等导致崩溃，或驱动没有调用 UT_SUMMARY()。被测代码直接读写目标机的寄存器地址时，主机上也会崩溃：要替换寄存器访问（见 unit-test-design Skill 的 stub-driver-conventions.md 第 5 节）。`

  // —— 覆盖率 ——
  let coverage = null
  let covNote = ''
  if (!tc.gcovOk) covNote = tc.gcovError
  else {
    const docs = []
    for (const o of instrumented) {
      const gcda = o.replace(/\.o$/, '.gcda')
      if (!existsSync(gcda)) continue
      const g = await run(tc.gcov, ['-j', '-b', ...(tc.mcdc ? ['--conditions'] : []), basename(gcda)], { cwd: obj })
      log.push(`$ gcov -j -b ${tc.mcdc ? '--conditions ' : ''}${basename(gcda)}\n${g.stderr}${g.stdout}`)
    }
    for (const f of readdirSync(obj)) if (f.endsWith('.gcov.json.gz') || f.endsWith('.gcov.json')) {
      try { docs.push(readGcovJson(join(obj, f))) } catch (e) { covNote += `读取 ${f} 失败：${e.message}；` }
    }
    const srcBases = new Set(srcAbs.map((s) => basename(s).toLowerCase()))
    const want = (file) => srcBases.has(basename(file).toLowerCase())
    if (docs.length) {
      coverage = summarize(docs, want)
      for (const f of coverage.files) f.file = srcAbs.find((s) => basename(s).toLowerCase() === basename(f.file).toLowerCase()) || unshadow(f.file)
    }
    else covNote ||= '没有生成覆盖率数据（测试程序可能没有正常退出：崩溃或超时时 .gcda 不会写出）'
  }

  const after = Object.fromEntries(srcAbs.map((f) => [f, sha1(f)]))
  const modified = srcAbs.filter((f) => before[f] !== after[f])

  const result = {
    ok: !rr.timedOut && parsed.summary && parsed.summary.failed === 0,
    compiler: `${tc.cc} ${tc.version}`,
    mcdcMeasured: tc.mcdc,
    framework,
    buildDir: dir,
    exitCode: rr.code,
    timedOut: !!rr.timedOut,
    summary: parsed.summary,
    cases: parsed.cases,
    failures: parsed.fails,
    coverage,
    sourceHashes: after,
    sourcesModifiedDuringRun: modified,
    includedByTest,
    headerOverrides: shadows.flatMap((p) => p.overridden),
    notes: [runNote, covNote].filter(Boolean),
    compileWarnings: warnings,
  }
  writeFileSync(join(dir, 'last-run.json'), JSON.stringify({ ...result, time: new Date().toISOString(), sources: srcAbs, tests: testAbs, includeDirs: incAbs, defines, cflags }, null, 2))
  writeFileSync(join(dir, 'output.txt'), output)
  writeFileSync(join(dir, 'build.log'), log.join('\n\n'))

  // —— 文字摘要 ——
  const L = []
  L.push(`编译器：${tc.cc} ${tc.version}${tc.mcdc ? '（支持 MC/DC 测量）' : '（GCC 14 以下，不能测量 MC/DC，请用 check_mcdc 核对 MC/DC 分析表）'}`)
  for (const p of shadows) for (const o of p.overridden) L.push(`替换了被测文件同目录的头文件：${o.header} → ${o.by}（编译的是构建目录 shadow 中去掉该头文件的副本，被测文件本身没有改动，覆盖率仍对应原文件）`)
  if (parsed.summary) L.push(`用例：共 ${parsed.summary.cases} 个，通过 ${parsed.summary.passed}，失败 ${parsed.summary.failed}`)
  if (parsed.fails.length) L.push(`失败检查：\n${parsed.fails.slice(0, 30).map((f) => `- ${f.id} ${f.detail}`).join('\n')}${parsed.fails.length > 30 ? `\n……共 ${parsed.fails.length} 条` : ''}`)
  if (runNote) L.push(`注意：${runNote}`)
  if (coverage) {
    const f3 = (c) => (c ? `${c.covered}/${c.total}（${c.percent ?? '-'}%）` : '未测量')
    L.push(`覆盖率（被测文件合计）：语句 ${f3(coverage.total.statements)}，分支 ${f3(coverage.total.branches)}，MC/DC ${f3(coverage.total.mcdc)}`)
    for (const file of coverage.files) {
      L.push(`\n${file.name}：`)
      L.push('| 函数 | 语句 | 分支 | MC/DC | 未覆盖行 | 未全覆盖的分支行 |')
      L.push('|---|---|---|---|---|---|')
      for (const fn of file.functions) {
        L.push(`| ${fn.name} | ${f3(fn.statements)} | ${fn.branches.total ? f3(fn.branches) : '无分支'} | ${fn.mcdc ? (fn.mcdc.total ? f3(fn.mcdc) : '无条件') : '未测量'} | ${fn.uncoveredLines.join(', ') || '—'} | ${fn.untakenBranches.map((b) => `${b.line}（${b.taken}/${b.total}）`).join(', ') || '—'} |`)
      }
    }
    L.push('\n用 coverage_detail 查看未覆盖行的源码。')
  } else if (covNote) L.push(`覆盖率：${covNote}`)
  if (modified.length) L.push(`\n警告：运行期间被测文件发生了变化：${modified.join('、')}。单元测试不得修改被测代码。`)
  if (warnings.length) L.push(`\n编译警告 ${warnings.length} 处（见 structuredContent.compileWarnings）。`)
  L.push(`\n运行记录：${join(dir, 'last-run.json')}`)
  return ok(result, L.join('\n'))
}

export async function coverageDetail({ name, file, function: fn, context = 1 }) {
  const roots = join(allowedRoots()[0], '.utest')
  let dir
  if (name) dir = join(roots, safeName(name))
  else if (existsSync(roots)) {
    const dirs = readdirSync(roots).filter((d) => existsSync(join(roots, d, 'last-run.json')))
    if (dirs.length === 1) dir = join(roots, dirs[0])
    else return fail(dirs.length ? `有多次运行记录，请用 name 指定：${dirs.join('、')}` : '还没有运行记录，先调用 run_unit_tests')
  }
  const lastPath = join(dir || '', 'last-run.json')
  if (!dir || !existsSync(lastPath)) return fail(`没有找到运行记录：${lastPath}`)
  const last = JSON.parse(readFileSync(lastPath, 'utf8'))
  if (!last.coverage) return fail('上次运行没有覆盖率数据')
  const files = last.coverage.files.filter((f) => !file || basename(f.file).toLowerCase() === basename(file).toLowerCase())
  if (!files.length) return fail(`没有文件 ${file} 的覆盖率数据。可选：${last.coverage.files.map((f) => f.name).join('、')}`)
  const out = []
  for (const f of files) {
    const srcPath = last.sources.find((s) => basename(s).toLowerCase() === f.name.toLowerCase()) || f.file
    let src = []
    try { src = readFileSync(srcPath, 'utf8').split(/\r?\n/) } catch { /* 读不到源码时只列行号 */ }
    for (const g of f.functions) {
      if (fn && g.name !== fn) continue
      const bad = new Set([...g.uncoveredLines, ...g.untakenBranches.map((b) => b.line), ...g.uncoveredConditions.map((c) => c.line)])
      if (!bad.size) continue
      out.push(`### ${f.name} / ${g.name}`)
      const show = new Set()
      for (const l of bad) for (let k = l - context; k <= l + context; k++) if (k >= 1 && k <= src.length) show.add(k)
      let prev = 0
      for (const k of [...show].sort((a, b) => a - b)) {
        if (prev && k > prev + 1) out.push('   …')
        const tags = []
        if (g.uncoveredLines.includes(k)) tags.push('未执行')
        const b = g.untakenBranches.find((x) => x.line === k)
        if (b) tags.push(`分支 ${b.taken}/${b.total}`)
        const c = g.uncoveredConditions.find((x) => x.line === k)
        if (c) tags.push(`MC/DC ${c.covered}/${c.total}${c.notCoveredTrue.length ? `，条件 ${c.notCoveredTrue.join(',')} 缺“真”` : ''}${c.notCoveredFalse.length ? `，条件 ${c.notCoveredFalse.join(',')} 缺“假”` : ''}`)
        out.push(`${String(k).padStart(5)}${tags.length ? ' >>' : '   '} ${src[k - 1] ?? ''}${tags.length ? `    ← ${tags.join('；')}` : ''}`)
        prev = k
      }
      out.push('')
    }
  }
  return ok({ buildDir: dir, files: files.map((f) => f.name) }, out.length ? out.join('\n') : '指定范围内没有未覆盖的语句、分支或条件。')
}

export async function checkMcdcTool({ decision, vectors }) {
  try {
    const r = checkMcdc(decision, vectors)
    const L = [`判定：${r.decision}`, `条件：${r.conditions.join('、')}（向量按此顺序写 T/F/X）`, '',
      '| 向量 | 取值 | 实际求值的条件 | 结果 | 说明 |', '|---|---|---|---|---|']
    for (const v of r.vectors) L.push(`| ${v.id} | ${v.values} | ${v.evaluated || '—'} | ${v.outcome === null ? '—' : v.outcome ? '真' : '假'} | ${v.error || (v.expectedMismatch ? '与填写的预期结果不符' : '')} |`)
    L.push('', '| 条件 | 独立影响对 |', '|---|---|')
    for (const p of r.perCondition) L.push(`| ${p.condition} | ${p.covered ? p.pairs.map((x) => x.join(' / ')).join('；') : '**未满足**'} |`)
    L.push('', r.satisfied ? `结论：满足 MC/DC（${r.covered}/${r.total} 个条件）。` : `结论：不满足 MC/DC（${r.covered}/${r.total} 个条件有独立影响对）。`)
    for (const s of r.suggestions) L.push(s.pair ? `- 条件 ${s.condition}：可补充向量 ${s.pair[0]}（结果${s.outcomes[0] ? '真' : '假'}）与 ${s.pair[1]}（结果${s.outcomes[1] ? '真' : '假'}）` : `- ${s.note}`)
    L.push('', '准则：短路求值下的唯一原因 MC/DC。X 表示该条件因短路未被求值。')
    return ok(r, L.join('\n'))
  } catch (e) {
    return fail(`MC/DC 核对失败：${e.message}`)
  }
}

export async function toolchainInfo() {
  const tc = await toolchain()
  if (!tc.ok) return fail(tc.error)
  // 测试框架头文件的位置直接告诉智能体：不说的话它会在整个磁盘上搜（实测一次花了一分多钟，还找到了打包目录里的旧副本）
  const harness = { dir: HARNESS, utest: join(HARNESS, 'utest.h'), map: join(HARNESS, 'ut_map.h') }
  return ok({ ...tc, harness }, `C 编译器：${tc.cc}（${tc.version}）\nC++ 编译器：${tc.cxx}\ngcov：${tc.gcovOk ? tc.gcov : tc.gcovError}\nMC/DC 测量：${tc.mcdc ? '支持（-fcondition-coverage）' : '不支持（需要 GCC 14 及以上），用 check_mcdc 核对分析表'}\n构建目录：${join(allowedRoots()[0], '.utest')}\n测试框架头文件（编译测试文件时已自动加入头文件路径，需要看宏定义时直接读这两个文件，不用搜索）：\n  ${harness.utest}\n  ${harness.map}`)
}
