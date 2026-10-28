// 编码评测公用函数：用 utest 的编译器设置（UTEST_CC）编译“被测代码 + 隐藏测试 + 硬件桩”并运行
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')

const tcMod = () => import(pathToFileURL(join(ROOT, 'mcp', 'utest', 'lib', 'toolchain.mjs')).href)
export async function toolchain() { return (await tcMod()).toolchain() }
export async function run(cmd, args, opts) { return (await tcMod()).run(cmd, args, opts) }

// 与评测其他部分一样，从 config/local.env 补充 UTEST_* 编译器设置（只读 UTEST_ 开头的变量）
export { loadLocalEnv } from '../unit-test/lib.mjs'

export const caseDir = (name) => join(HERE, name)

/**
 * AstroLab 里“示例工程”的实际目录。应用首次运行时把仓库的 sample 复制到数据目录的 workspace/sample，
 * 之后智能体读写的是那份副本，不是仓库里的 sample。按应用的规则找数据目录（app/main/paths.mjs）：
 * ASTROLAB_DATA → 开发时的 runtime/app-data → %LOCALAPPDATA%\AstroLab（安装后）→ ~/.local/share/AstroLab；
 * 都没有示例工程时退回仓库的 sample。返回 { dir, from }
 */
export function sampleWorkspace() {
  const cands = [
    [process.env.ASTROLAB_DATA, 'ASTROLAB_DATA'],
    [join(ROOT, 'runtime', 'app-data'), '开发环境数据目录'],
    [process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'AstroLab') : join(homedir(), '.local', 'share', 'AstroLab'), '安装后的数据目录'],
  ]
  for (const [d, from] of cands) if (d && existsSync(join(d, 'workspace', 'sample'))) return { dir: join(d, 'workspace', 'sample'), from }
  return { dir: join(ROOT, 'sample'), from: '仓库（还没有运行过 AstroLab）' }
}
export const tmp = (p) => mkdtempSync(join(tmpdir(), p))

/** 编译并运行隐藏测试。cFiles 是被测 .c（绝对路径）；incDirs 是被测代码的头文件目录。返回 { ok, compileError, results:[{id,pass,why}], pass, fail, log } */
export async function runHidden({ cc, name = 'thm_ctrl', cFiles, incDirs, work }) {
  const ht = join(caseDir(name), 'hidden-test')
  const exe = join(work, `hidden${process.platform === 'win32' ? '.exe' : ''}`)
  const srcs = [...cFiles, join(ht, `test_${name}.c`), join(ht, `stub_${name.replace(/_ctrl$/, '')}_hw.c`)]
  const args = ['-std=c99', '-w', '-O0', ...incDirs.map((d) => `-I${d}`), `-I${ht}`, ...srcs, '-o', exe]
  const c = await run(cc, args, { cwd: work, timeoutMs: 120_000 })
  if (c.code !== 0) return { ok: false, compileError: (c.stderr || c.stdout).trim().split(/\r?\n/).slice(0, 40).join('\n'), results: [], pass: 0, fail: 0, log: '' }
  const r = await run(exe, [], { cwd: work, timeoutMs: 30_000 })
  const log = r.stdout
  const results = []
  for (const line of log.split(/\r?\n/)) {
    const m = /^(PASS|FAIL) (\S+)(?: (.*))?$/.exec(line)
    if (m) results.push({ id: m[2], pass: m[1] === 'PASS', why: m[3] || '' })
  }
  const crashed = !/^SUMMARY /m.test(log)
  return {
    ok: true, crashed, timedOut: !!r.timedOut, exitCode: r.code,
    results, pass: results.filter((x) => x.pass).length, fail: results.filter((x) => !x.pass).length,
    log: log + (crashed ? `\n（测试程序没有正常结束：退出码 ${r.code}${r.timedOut ? '，超时' : ''}；崩溃或死循环发生在最后一条输出之后的用例中）\n${(r.stderr || '').slice(0, 2000)}` : ''),
  }
}

/** 列出目录下的文件（递归），跳过 .utest、.git、node_modules */
export function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    if (['.utest', '.git', 'node_modules'].includes(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n/g, '\n')
export const readText = (p) => norm(readFileSync(p, 'utf8'))
export function writeText(p, s) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s, 'utf8') }
