#!/usr/bin/env node
// 离线安装包自检：检查安装包里的各部件在这台电脑上能否工作，结果写到用户数据目录。
// Windows 由 launch.ps1 -Action check 调用；Linux（麒麟）由 check.sh 调用。环境变量（PATH、DSH_HOME、UTEST_CC、CPPCHECK_PATH 等）已由它们设好。
// 模型：只在连得上时做模型探测（app/main/probe.mjs，几次很短的模型调用），断网时只记录连不上。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, release, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 字节码（保护）包：工具服务是 server.jsc、引擎源码已并入工作台，自检改走 MCP 握手、跳过需要源码的深度检查
const PROTECTED = existsSync(join(APP, 'mcp', 'utest', 'server.jsc'))
let Engine = null
try { Engine = (await import(pathToFileURL(join(APP, 'spike', 'sdk', 'engine.mjs')).href)).Engine } catch { /* 保护包里没有 */ }
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
  // 字节码保护包里没有 main.mjs：入口是 main.cjs（加载桩）+ main.jsc（字节码），预加载是压缩的 preload.cjs
  const mains = PROTECTED ? ['main.cjs', 'main.jsc', 'preload.cjs'] : ['main.mjs', 'preload.cjs']
  const ui = join(APP, 'app', 'dist', 'index.html')
  const missing = [exe, join(wb, 'resources', 'app', 'package.json'), ...mains.map((m) => join(APP, 'app', 'main', m)), ui].filter((f) => !existsSync(f))
  row(process.platform === 'win32' ? '工作台（AstroLab.exe）' : '工作台（AstroLab）', missing.length ? '失败' : '通过', missing.length ? `缺少 ${missing.join('、')}` : exe)
}
const dv = run(process.execPath, [DSH_BIN, '--version'])
row('DSH', dv.code === 0 ? '通过' : '失败', dv.code === 0 ? dv.out : tail(dv.out))
if (process.platform === 'win32') {
  const pw = run('where', ['pwsh'])
  const ps51 = run('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])
  row('PowerShell（DSH 执行命令用）', pw.code === 0 || ps51.code === 0 ? '通过' : '失败', pw.code === 0 ? `PowerShell 7：${pw.out.split(/\r?\n/)[0]}` : `只有 Windows PowerShell ${ps51.out}（DSH 会退回使用它）`)
} else {
  // 操作系统（麒麟的版本写在 /etc/os-release 和 /etc/kylin-build）
  let os = ''
  try { os = (/^PRETTY_NAME="?([^"\n]*)/m.exec(readFileSync('/etc/os-release', 'utf8')) || [])[1] || '' } catch { /* 没有 os-release */ }
  row('操作系统', '记录', `${os || process.platform}，${process.arch}，内核 ${release()}`)
  const sh = run('bash', ['--version'])
  row('bash（DSH 执行命令用）', sh.code === 0 ? '通过' : '失败', sh.code === 0 ? sh.out.split(/\r?\n/)[0] : '没有 bash')
  // DSH 执行命令前要把命令关进沙箱（只读系统、只写工作区）：先试 bubblewrap，再试 Landlock（内核 5.13 以上）；都不行时 DSH 拒绝执行命令
  const bw = run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent', '--', 'true'], { timeout: 10000 })
  let ll = 'unusable'
  try {
    const mod = join(APP, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'node-addon-system', 'lib', 'index.js')
    if (existsSync(mod)) ll = (await import(pathToFileURL(mod).href)).probe(undefined, { timeoutMs: 10000 })
  } catch { /* 没装上对应平台的包 */ }
  const bwWhy = bw.error ? '没有安装 bubblewrap' : tail(bw.out || `退出码 ${bw.code}`, 120)
  row('命令沙箱（bubblewrap / Landlock）', bw.code === 0 || ll !== 'unusable' ? '通过' : '失败',
    bw.code === 0 ? 'bubblewrap 可用' : ll !== 'unusable' ? `Landlock ${ll === 'full' ? '完整' : '部分'}可用（bubblewrap：${bwWhy}）`
      : `都不可用，智能体不能执行命令。bubblewrap：${bwWhy}。处理：安装 bubblewrap（安装包 debs 目录或软件源），/proc/sys/kernel/unprivileged_userns_clone 为 0 时请管理员改为 1，或给 bwrap 加 setuid（chmod u+s /usr/bin/bwrap）`)
  // 工作台（Electron）依赖的系统库：缺哪个列出来
  const exe = join(APP, '..', 'workbench', 'AstroLab')
  if (existsSync(exe)) {
    const l = run('ldd', [exe])
    const miss = [...new Set((l.out.match(/^\s*(\S+) => not found/gm) || []).map((x) => x.trim().split(' ')[0]))]
    const glibc = [...new Set(l.out.match(/GLIBC_[\d.]+' not found/g) || [])]
    row('工作台依赖的系统库', miss.length || glibc.length ? '失败' : '通过', miss.length || glibc.length ? `缺少 ${[...miss, ...glibc].join('、')}（见 packaging/麒麟部署说明.md 的“依赖库”）` : '齐全')
    const sb = join(APP, '..', 'workbench', 'chrome-sandbox')
    const un = run('unshare', ['-Ur', 'true'], { timeout: 5000 })
    row('界面沙箱', '记录', un.code === 0 ? '用户命名空间可用' : existsSync(sb) ? 'chrome-sandbox 没有 setuid、用户命名空间不可用：start.sh 会加 --no-sandbox 启动（界面只加载本机文件）' : '')
  }
  // 麒麟安全中心的应用程序执行控制会拦未签名的程序（node、AstroLab、gcc 编出来的测试程序）
  const ks = run('getstatus', [], { timeout: 5000 })
  if (!ks.error && ks.code === 0) row('麒麟安全（KySec）', /exec.*(on|enable|开)/i.test(ks.out) ? '警告' : '记录', `${tail(ks.out.replace(/\s+/g, ' '), 160)}；执行控制开着时，请管理员把安装目录、工作区加入白名单，或设为警告模式`)
}

// 2 外部程序
const gcc = process.env.UTEST_CC || 'gcc'
const g = run(gcc, ['--version'])
row('GCC（单元测试）', g.code === 0 ? '通过' : '失败', g.code === 0 ? `${gcc}：${g.out.split(/\r?\n/)[0]}` : `${gcc} 不可用 ${tail(g.out || String(g.error))}`)
const cpp = process.env.CPPCHECK_PATH || 'cppcheck'
const c = run(cpp, ['--version'])
row('Cppcheck（代码走查）', c.code === 0 ? '通过' : '失败', c.code === 0 ? `${cpp}：${c.out}` : `${cpp} 不可用`)
if (process.platform !== 'win32') {
  const gv = run(process.env.UTEST_GCOV || 'gcov', ['--version'])
  row('gcov（覆盖率）', gv.code === 0 ? '通过' : '警告', gv.code === 0 ? gv.out.split(/\r?\n/)[0] : '没有 gcov：单元测试能跑，覆盖率统计不了（gcov 一般随 gcc 安装）')
}
const gt = run('git', ['--version'])
row('Git', gt.code === 0 ? '通过' : '警告', gt.code === 0 ? gt.out : '没有找到 git：Git 相关功能不可用（安装包可选择带上 Git）')

// 3 工具服务自检。保护包：对每个服务做 MCP 握手（启动 → initialize → tools/list，验证能起来并报出工具）；
//   普通包：运行各服务的 selftest.mjs（更全，含实际编译、生成文档）。
function mcpList(serverCjs, cwd, env) {
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selfcheck', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n'
  const r = spawnSync(process.execPath, [serverCjs], { input: msgs, cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } })
  const tools = []
  for (const line of (r.stdout || '').split('\n')) {
    try { const j = JSON.parse(line); if (j.id === 2 && j.result && Array.isArray(j.result.tools)) tools.push(...j.result.tools.map((t) => t.name)) } catch { /* 非 JSON 行 */ }
  }
  return { ok: tools.length > 0, tools, err: tail(r.stderr || '', 200) }
}
const st = [
  ['单元测试服务 utest', 'utest', APP],
  ['文档服务 docgen + docreader', 'docgen', WS],
  ['静态分析服务 cppcheck', 'cppcheck', WS],
  ['信息流图服务 infoflow', 'infoflow', WS],
]
for (const [name, svc, cwd] of st) {
  const dir = join(APP, 'mcp', svc)
  if (PROTECTED) {
    const r = mcpList(join(dir, 'server.cjs'), cwd, { DOC_ALLOWED_ROOTS: WS })
    row(name, r.ok ? '通过' : '失败', r.ok ? `MCP 握手正常，工具：${r.tools.join('、')}` : `起不来或没报出工具；${r.err}`)
    if (svc === 'docgen') { const rr = mcpList(join(APP, 'mcp', 'docreader', 'server.cjs'), cwd, { DOC_ALLOWED_ROOTS: WS }); row('文档读取服务 docreader', rr.ok ? '通过' : '失败', rr.ok ? `工具：${rr.tools.join('、')}` : rr.err) }
    continue
  }
  const file = join(dir, 'selftest.mjs')
  if (!existsSync(file)) { row(name, '失败', `缺少 ${file}`); continue }
  const r = run(process.execPath, [file], { cwd, timeout: 300000, env: { DOC_ALLOWED_ROOTS: WS } })
  row(name, r.code === 0 ? '通过' : r.code === 2 ? '警告' : '失败', `退出码 ${r.code}，${r.ms} ms；${tail(r.out, 240)}`)
}

// 4 引擎：sdk 模式启动和握手（会加载全部工具服务和技能目录，不调用模型）。连续启动两次：
//   第一次含冷启动（新电脑上杀毒软件首次扫描、Node 编译缓存），第二次接近日常启动速度
//   保护包里没有独立的引擎模块（已并入工作台的 main.jsc），这一步随工作台启动时验证，这里跳过
if (Engine) {
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
  const t0 = Date.now()
  const r = run(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(join(APP, 'mcp', 'utest', 'tools.mjs')).href)}).then(() => process.exit(0))`], { timeout: 60000 })
  row('工具服务模块加载（utest）', r.code === 0 ? '通过' : '警告', `${Date.now() - t0} ms${r.code === 0 ? '' : '；' + tail(r.out)}`)
} else {
  row('引擎（DSH sdk 模式）', '记录', '字节码保护包：引擎随工作台启动时验证；DSH 位于 ' + (existsSync(DSH_BIN) ? '安装目录' : '（缺失）'))
}

// 5 模型：连得上就做模型探测（模型名、上下文、工具调用、思考，和 local.env 对一遍）；断网时只记录
{
  const { probeModel } = await import(pathToFileURL(join(APP, 'app', 'main', 'probe.mjs')).href)
  const base = (process.env.DEPT_LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
  let reach = false
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    await fetch(`${base}/models`, { signal: ctl.signal, headers: process.env.DEPT_LLM_API_KEY ? { authorization: `Bearer ${process.env.DEPT_LLM_API_KEY}` } : {} })
    clearTimeout(t)
    reach = true
  } catch (e) { row('模型接口', '记录', `${base} 连不上（${e.name === 'AbortError' ? '8 秒超时' : e.cause?.code || e.message}）`) }
  if (reach) {
    const r = await probeModel({
      baseURL: base, apiKey: process.env.DEPT_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '', model: process.env.DEPT_LLM_MODEL || '',
      configured: { contextWindow: process.env.DEPT_LLM_CONTEXT_WINDOW, maxTokens: process.env.DEPT_LLM_MAX_TOKENS, thinkingFormat: process.env.DEPT_LLM_THINKING_FORMAT },
    })
    for (const c of r.checks) row(`模型：${c.item}`, c.status === 'ok' ? '通过' : c.status === 'warn' ? '警告' : '失败', c.fix ? `${c.detail}；→ ${c.fix}` : c.detail)
  }
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const lines = [
  '# 安装包自检报告', '',
  `- 时间：${new Date().toISOString()}`, `- 计算机：${process.env.COMPUTERNAME || hostname()}，用户：${process.env.USERNAME || (() => { try { return userInfo().username } catch { return '' } })()}`,
  `- 安装目录：${resolve(APP, '..')}`, `- 数据目录：${DATA}`, '',
  '| 项目 | 结果 | 说明 |', '|---|---|---|', ...rows.map((r) => `| ${r.item} | ${r.status} | ${r.detail} |`), '',
  bad ? `有 ${bad} 项失败。` : '全部通过。', '',
]
const file = join(DATA, `check-report-${stamp}.md`)
writeFileSync(file, lines.join('\n'))
console.log(`\n${bad ? `有 ${bad} 项失败` : '全部通过'}。报告：${file}`)
process.exit(bad ? 1 : 0)
