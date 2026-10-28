#!/usr/bin/env node
// 离线安装包自检（阶段 0）：不调用模型，检查安装包里的各部件在这台电脑上能否工作，结果写到用户数据目录。
// 由 launch.ps1 -Action check 调用，环境变量（PATH、DSH_HOME、UTEST_CC、CPPCHECK_PATH 等）已由它设好。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Engine } from '../spike/sdk/engine.mjs'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = process.env.ASTROLAB_DATA || join(APP, '..', 'data')
const WS = process.env.SPIKE_WORKSPACE || join(APP, 'sample')
const DSH_BIN = join(APP, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
mkdirSync(DATA, { recursive: true })

const rows = []
let bad = 0
function row(item, status, detail) {
  rows.push({ item, status, detail: String(detail || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').slice(0, 300) })
  if (status === '失败') bad++
  console.log(`[${status}] ${item}  ${String(detail || '').split(/\r?\n/)[0].slice(0, 160)}`)
}
function run(cmd, args, opts = {}) {
  const t0 = Date.now()
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: opts.timeout || 120000, cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) } })
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim(), error: r.error, ms: Date.now() - t0 }
}
const tail = (s, n = 200) => (s.length > n ? '…' + s.slice(-n) : s)

console.log(`安装目录：${resolve(APP, '..')}\n数据目录：${DATA}\n工作区：${WS}\n`)

// 1 运行环境
row('Node.js', process.versions.node.split('.')[0] >= 22 ? '通过' : '失败', `${process.version}（${process.execPath}）`)
// 工作台（AstroLab.exe）：Electron 程序和它指向的界面代码都在
{
  const wb = join(APP, '..', 'workbench')
  const exe = join(wb, process.platform === 'win32' ? 'AstroLab.exe' : 'AstroLab')
  const main = join(APP, 'app', 'main', 'main.mjs')
  const ui = join(APP, 'app', 'dist', 'index.html')
  const missing = [exe, join(wb, 'resources', 'app', 'package.json'), main, ui].filter((f) => !existsSync(f))
  row('工作台（AstroLab.exe）', missing.length ? '失败' : '通过', missing.length ? `缺少 ${missing.join('、')}` : exe)
}
const dv = run(process.execPath, [DSH_BIN, '--version'])
row('DSH', dv.code === 0 ? '通过' : '失败', dv.code === 0 ? dv.out : tail(dv.out))
const pw = run('where', ['pwsh'])
const ps51 = run('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])
row('PowerShell（DSH 执行命令用）', pw.code === 0 || ps51.code === 0 ? '通过' : '失败', pw.code === 0 ? `PowerShell 7：${pw.out.split(/\r?\n/)[0]}` : `只有 Windows PowerShell ${ps51.out}（DSH 会退回使用它）`)

// 2 外部程序
const gcc = process.env.UTEST_CC || 'gcc'
const g = run(gcc, ['--version'])
row('GCC（单元测试）', g.code === 0 ? '通过' : '失败', g.code === 0 ? `${gcc}：${g.out.split(/\r?\n/)[0]}` : `${gcc} 不可用 ${tail(g.out || String(g.error))}`)
const cpp = process.env.CPPCHECK_PATH || 'cppcheck'
const c = run(cpp, ['--version'])
row('Cppcheck（代码走查）', c.code === 0 ? '通过' : '失败', c.code === 0 ? `${cpp}：${c.out}` : `${cpp} 不可用`)
const gt = run('git', ['--version'])
row('Git', gt.code === 0 ? '通过' : '警告', gt.code === 0 ? gt.out : '没有找到 git：Git 相关功能不可用（安装包可选择带上 Git）')

// 3 工具服务自检（与 scripts\check.ps1 相同的三个自检）
const st = [
  ['单元测试服务 utest', join(APP, 'mcp', 'utest', 'selftest.mjs'), APP],
  ['文档服务 docgen + docreader', join(APP, 'mcp', 'docgen', 'selftest.mjs'), WS],
  ['静态分析服务 cppcheck', join(APP, 'mcp', 'cppcheck', 'selftest.mjs'), WS],
]
for (const [name, file, cwd] of st) {
  if (!existsSync(file)) { row(name, '失败', `缺少 ${file}`); continue }
  const r = run(process.execPath, [file], { cwd, timeout: 300000, env: { DOC_ALLOWED_ROOTS: WS } })
  row(name, r.code === 0 ? '通过' : r.code === 2 ? '警告' : '失败', `退出码 ${r.code}，${r.ms} ms；${tail(r.out, 240)}`)
}

// 4 引擎：sdk 模式启动和握手（会加载全部工具服务和技能目录，不调用模型）。连续启动两次：
//   第一次含冷启动（新电脑上杀毒软件首次扫描、Node 编译缓存），第二次接近日常启动速度
for (const round of [1, 2]) {
  const eng = new Engine({ dshBin: DSH_BIN, cwd: WS, env: process.env, logFile: join(DATA, 'selfcheck-engine.jsonl'), provider: process.env.SPIKE_PROVIDER || 'dept-llm', model: process.env.DEPT_LLM_MODEL || 'deepseek-flash', reasoningEffort: 'high' })
  try {
    const r = await Promise.race([eng.start(), new Promise((_, rej) => setTimeout(() => rej(new Error('initialize 超过 180 秒')), 180000))])
    row(`引擎（DSH sdk 模式）第 ${round} 次启动`, '通过', `initialize ${r.ms} ms`)
  } catch (e) {
    row(`引擎（DSH sdk 模式）第 ${round} 次启动`, '失败', `${e.message}；stderr：${tail(eng.stderrTail, 300)}`)
  } finally { await eng.shutdown() }
}
// 单独看一个工具服务模块在新进程里的加载时间（冷启动时 Node 和杀毒软件扫描的开销）
{
  const t0 = Date.now()
  const r = run(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(join(APP, 'mcp', 'utest', 'tools.mjs')).href)}).then(() => process.exit(0))`], { timeout: 60000 })
  row('工具服务模块加载（utest）', r.code === 0 ? '通过' : '警告', `${Date.now() - t0} ms${r.code === 0 ? '' : '；' + tail(r.out)}`)
}

// 5 模型连通（断网环境里预期不通，只记录）
{
  const base = (process.env.DEPT_LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  let detail
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(`${base}/models`, { signal: ctl.signal, headers: process.env.DEPT_LLM_API_KEY ? { authorization: `Bearer ${process.env.DEPT_LLM_API_KEY}` } : {} })
    clearTimeout(t)
    detail = `${base} 可以连通（HTTP ${res.status}）`
  } catch (e) { detail = `${base} 连不上（${e.name === 'AbortError' ? '8 秒超时' : e.cause?.code || e.message}）` }
  row('模型接口', '记录', detail)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const lines = [
  '# 安装包自检报告', '',
  `- 时间：${new Date().toISOString()}`, `- 计算机：${process.env.COMPUTERNAME || ''}，用户：${process.env.USERNAME || ''}`,
  `- 安装目录：${resolve(APP, '..')}`, `- 数据目录：${DATA}`, '',
  '| 项目 | 结果 | 说明 |', '|---|---|---|', ...rows.map((r) => `| ${r.item} | ${r.status} | ${r.detail} |`), '',
  bad ? `有 ${bad} 项失败。` : '除模型接口外全部通过。', '',
]
const file = join(DATA, `check-report-${stamp}.md`)
writeFileSync(file, lines.join('\n'))
console.log(`\n${bad ? `有 ${bad} 项失败` : '全部通过'}。报告：${file}`)
process.exit(bad ? 1 : 0)
