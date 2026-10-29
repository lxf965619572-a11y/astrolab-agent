// 读取围栏：运行在 DSH 进程里的 Cordis 插件（由 writeEnginePatch 写进引擎补丁加载），让智能体只读得到
// 当前工作区、技能目录、临时目录和工具链目录。
//
// 为什么要它：DSH 的沙箱只管写——文件工具的围栏“reads pass through”，Windows 上的 ACL 沙箱也只限制写
// （WRITE_RESTRICTED 只和写访问求交集）。所以智能体能读到电脑上的任何东西：别的工程（包括真实型号代码）、
// config\local.env（模型 Key）、evals\（评测答案）。用云端模型时，读到的内容会被发出去。
//
// 怎么做：用 DSH 工具流水线的 guard（ctx.tools.guard，在 tools/pre-execute 之后、工具执行之前运行，单调：
// 返回理由就拒绝，后面谁也改不回允许），检查每次工具调用（含 run_code、workflow 里嵌套的调用）的路径参数：
//   文件工具   read、read_image、grep、glob、working_directory、subagent 的 cwd、写和改的 file_path
//   MCP 工具   名字像路径的参数（path、sources、includeDirs……）和 cflags 里的 -I
//   命令行     bash、pwsh 的 command 和 workdir：绝对路径、往上跳出工作区的 ..、~、$HOME、$env:USERPROFILE 一类变量、网络路径
// 路径先展开目录联接和符号链接（realpath）再比较。说明、内容一类自由文本不检查（写在文档里的路径不是读取）。
//
// 局限（如实说明）：命令行检查是看命令文本，挡得住正常的“去仓库里找找”，挡不住刻意在运行时拼出来的路径；
// MCP 服务进程自己读文件不经过这里（我们自己的服务各自限制目录）。真正的内核级读隔离需要 AppContainer，DSH 目前没有。
//
// 配置（引擎补丁里给出）：
//   readRoots  除工作区外允许读的目录（技能目录、已安装技能和插件的目录）
//   toolRoots  命令里可以出现的工具链目录（node、gcc、Cppcheck、Git、DSH 自己）；系统目录和临时目录自动加上
//   log        true 时把拒绝写到 stderr（引擎日志里能看到）

import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const name = 'astrolab-read-fence'
export const inject = ['tools']

// 不当路径检查的参数：自由文本
const TEXT_KEYS = new Set(['content', 'old_string', 'new_string', 'prompt', 'description', 'message', 'questions', 'body', 'query', 'todos',
  'plan', 'objective', 'title', 'reason', 'justification', 'text', 'answer', 'summary', 'tags', 'kind', 'model', 'name', 'id', 'script', 'meta', 'args'])
// 名字像路径的参数
const PATH_KEY = /^(file_?path|path|paths|cwd|cd|workdir|dir|dirs|directory|file|files|sources?|tests?|include_?dirs?|includes?|root|input|inputs|output|out|template|model_?file|target_?dir)$/i
const SHELL_TOOLS = /^(bash|pwsh|powershell|shell|terminal)(_persistent)?$/i

function api(platform) { return platform === 'win32' ? path.win32 : path.posix }

/** 规范化目录：绝对、去掉末尾分隔符；Windows 小写比较 */
function canon(p, platform) {
  const P = api(platform)
  let r = P.resolve(p)
  // 展开联接和符号链接（存在的部分）：工作区里的联接指到外面也算外面
  if (platform === process.platform) {
    let cur = r
    const tail = []
    while (!existsSync(cur)) { const up = P.dirname(cur); if (up === cur) break; tail.unshift(P.basename(cur)); cur = up }
    try { r = P.join(realpathSync.native(cur), ...tail) } catch { /* 保留原样 */ }
  }
  r = r.replace(/[\\/]+$/, '') || r
  return platform === 'win32' ? r.toLowerCase() : r
}

function inside(child, root, platform) {
  const P = api(platform)
  const rel = P.relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel))
}

/**
 * 建一个检查器。roots：允许读的目录（含工作区）；tools：命令里允许出现的工具链目录。
 * 返回 check(name, args, cwd) → 拒绝理由（字符串）或 undefined。
 */
export function createFence({ roots = [], tools = [], platform = process.platform, env = process.env } = {}) {
  const P = api(platform)
  const sys = platform === 'win32'
    ? [env.SystemRoot || env.windir || 'C:\\Windows', env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.TEMP, env.TMP]
    : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/etc/alternatives', '/dev/null', '/proc/self', '/tmp', '/var/tmp']
  const temp = platform === process.platform ? [tmpdir()] : []
  const readRoots = [...roots, ...temp].filter(Boolean).map((r) => canon(r, platform))
  const cmdRoots = [...readRoots, ...tools, ...sys].filter(Boolean).map((r) => canon(r, platform))
  const okRead = (abs) => readRoots.some((r) => inside(abs, r, platform))
  const okCmd = (abs) => cmdRoots.some((r) => inside(abs, r, platform))

  const resolveAt = (p, cwd) => canon(P.isAbsolute(p) ? p : P.resolve(cwd, p), platform)

  function checkPath(raw, cwd, ok = okRead) {
    if (typeof raw !== 'string' || !raw.trim()) return null
    let p = raw.trim().replace(/^["']|["']$/g, '')
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return null // URL（mcp 资源等）
    if (/^\\\\|^\/\//.test(p)) return p // 网络路径
    if (platform === 'win32' && /^[a-zA-Z]:$/.test(p)) p += '\\'
    if (/^~(?=$|[\\/])/.test(p)) return p
    // glob 模式：只看通配符之前的固定部分
    const g = p.search(/[*?[{]/)
    if (g >= 0) p = p.slice(0, g) || '.'
    const abs = resolveAt(p, cwd)
    return ok(abs) ? null : raw
  }

  // 命令文本里像路径的片段
  // 不带引号的片段里像路径的部分（路径在空白处断开）
  function scan(s) {
    const out = []
    if (platform === 'win32') {
      for (const m of s.matchAll(/(?<![\w$])([a-zA-Z]:(?:[\\/][^\s"'`;|&<>(){},]*)?)(?=$|[\s"'`;|&<>(){},])/g)) out.push(m[1])
      for (const m of s.matchAll(/(?<![\w:])\/([a-zA-Z])(?=\/)([^\s"'`;|&<>(){},]*)/g)) out.push(`${m[1]}:${m[2]}`) // msys 风格 /d/lixf
    } else {
      for (const m of s.matchAll(/(?<=^|[\s"'`=(;|&<>])(\/[^\s"'`;|&<>(){},]*)/g)) out.push(m[1]) // 不含冒号，免得把 URL 当路径
    }
    for (const m of s.matchAll(/(?<=^|[\s"'`=(;|&<>])(\\\\[^\s"'`;|&<>]+)/g)) out.push(m[1])
    for (const m of s.matchAll(/(?<=^|[\s"'`=(;|&<>,])((?:\.{1,2}[\\/])*\.\.(?:[\\/][^\s"'`;|&<>(){},]*)?)(?=$|[\s"'`;|&<>(){},])/g)) out.push(m[1])
    for (const m of s.matchAll(/(?<=^|[\s"'`=(;|&<>])(~(?:[\\/][^\s"'`;|&<>(){},]*)?)(?=$|[\s"'`;|&<>(){},])/g)) out.push(m[1])
    return out
  }
  const absLike = (t) => (platform === 'win32' ? /^(?:[a-zA-Z]:[\\/]|\\\\)/ : /^\//).test(t)

  // 命令文本里像路径的片段。引号里的整段算一个（路径里可以有空格，如 "D:\Program Files\nodejs\node.exe"），
  // 按分号分开（PATH 列表）；不像绝对路径的引号内容和引号外的部分按空白断开再找
  function shellPaths(cmd) {
    const out = []
    const quoted = []
    const rest = String(cmd).replace(/"([^"]*)"|'([^']*)'/g, (m, a, b) => { quoted.push(a ?? b); return ' ' })
    for (const q of quoted) {
      for (const piece of q.split(';')) {
        const t = piece.trim()
        if (absLike(t)) out.push(t)
        else out.push(...scan(t))
      }
    }
    out.push(...scan(rest))
    return out
  }
  const HOME_VARS = /\$(?:env:)?(USERPROFILE|HOMEPATH|HOMEDRIVE|HOMESHARE|LOCALAPPDATA|APPDATA|ProgramData|ALLUSERSPROFILE|PUBLIC|OneDrive\w*|SystemDrive)\b|%(USERPROFILE|HOMEPATH|HOMEDRIVE|LOCALAPPDATA|APPDATA|ProgramData|ALLUSERSPROFILE|PUBLIC|OneDrive\w*|SystemDrive)%|\$HOME\b|\$\{HOME\}|\[(?:System\.)?Environment\]::GetFolderPath|Get-PSDrive|\bnet\s+use\b|\bsubst\b/i

  function checkShell(cmd, cwd) {
    const v = HOME_VARS.exec(String(cmd))
    if (v) return v[0]
    for (const p of shellPaths(cmd)) { const bad = checkPath(p, cwd, okCmd); if (bad) return bad }
    return null
  }

  function walk(args, cwd, key, found) {
    if (found.length) return
    if (typeof args === 'string') { if (key && PATH_KEY.test(key)) { const b = checkPath(args, cwd); if (b) found.push(b) } return }
    if (Array.isArray(args)) {
      if (key && /^c(xx)?flags$/i.test(key)) {
        for (let i = 0; i < args.length; i++) {
          const f = String(args[i])
          const m = /^-(?:I|isystem|iquote|idirafter|include|L)(.*)$/.exec(f)
          if (m) { const b = checkPath(m[1] || String(args[i + 1] || ''), cwd); if (b) { found.push(b); return } }
        }
        return
      }
      for (const v of args) walk(v, cwd, key, found)
      return
    }
    if (args && typeof args === 'object') {
      for (const [k, v] of Object.entries(args)) { if (!TEXT_KEYS.has(k)) walk(v, cwd, k, found) }
    }
  }

  return function check(toolName, args, cwd) {
    const a = args && typeof args === 'object' ? args : {}
    if (SHELL_TOOLS.test(toolName)) {
      if (a.workdir) { const b = checkPath(a.workdir, cwd); if (b) return b }
      const wd = a.workdir ? (P.isAbsolute(a.workdir) ? a.workdir : P.resolve(cwd, a.workdir)) : cwd
      return checkShell(a.command || '', wd) || undefined
    }
    if (/^glob$/i.test(toolName) && typeof a.pattern === 'string') { const b = checkPath(a.pattern, a.path ? (P.isAbsolute(a.path) ? a.path : P.resolve(cwd, a.path)) : cwd); if (b) return b } // glob 的模式可以是绝对路径（grep 的是正则，不查）
    const found = []
    walk(a, cwd, '', found)
    return found[0]
  }
}

export const denial = (toolName, what, root) =>
  `[astrolab: 不允许读取工作区外的文件] ${toolName} 用到了 ${what}，它在当前工作区（${root}）和技能目录之外，这次调用没有执行。` +
  '需要工作区外的文件时，用 ask_user_question 请用户把文件复制到工作区里；不要到别的目录去找。'

/** Cordis 插件入口 */
export function apply(ctx, config = {}) {
  const extra = Array.isArray(config.readRoots) ? config.readRoots : []
  const tools = Array.isArray(config.toolRoots) ? config.toolRoots : []
  const fences = new Map() // 工作区 → 检查器
  const fenceFor = (root) => {
    let f = fences.get(root)
    if (!f) { f = createFence({ roots: [root, ...extra], tools }); fences.set(root, f) }
    return f
  }
  ctx.tools.guard((exec) => {
    try {
      const session = exec.agent?.session
      const policy = ctx.get('sandboxPolicy')
      const root = policy?.resolve(session ? { session } : {})?.workspaceRoot || process.cwd()
      let cwd = root
      try { const wd = session && ctx.get('workingDirectory'); if (wd) cwd = wd.get(session) || root } catch { /* 用工作区 */ }
      const bad = fenceFor(root)(exec.name, exec.arguments, cwd)
      if (!bad) return undefined
      if (config.log) process.stderr.write(`[read-fence] 拒绝 ${exec.name}：${bad}\n`)
      return denial(exec.name, bad, root)
    } catch (e) {
      // 检查本身出错时拒绝（宁可多拦一次，也不放过），理由里写明
      return `[astrolab: 读取检查出错，这次调用没有执行] ${e?.message || e}`
    }
  })
}
