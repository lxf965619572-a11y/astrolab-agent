#!/usr/bin/env node
// DSH 升级检查：把候选版本装到单独的目录，逐项核对 AstroLab 和 DSH 的接触面，再在真实引擎上跑引擎桥和读取围栏的测试。
// 不动现有安装（runtime/dsh）和任何配置。全部通过、复核项都看过之后，才改 config/dsh.json，再运行 scripts\setup.ps1。
//
// 用法（仓库根目录）：node scripts/dsh-upgrade-check.mjs [<版本>] [--dir <安装目录>] [--registry <npm 源>] [--skip-runtime]
//   <版本>          候选版本，如 0.2.2-rc.1。不给时用 config/dsh.json 锁定的版本（确认检查本身在当前版本上全部通过）
//   --dir           候选版本装在哪里，默认 runtime/dsh-check/<版本>；已经装好的不重装
//   --registry      npm 源，官方源慢时用 https://registry.npmmirror.com
//   --skip-runtime  不跑真实引擎测试（app/test/real-dsh.mjs、real-dsh-fence.mjs），只做安装、组合配置和接触面检查
// 基线：runtime/dsh 里装的版本（setup.ps1 装的）。基线在、且和候选版本不同时，列出两版之间新增、去掉的插件和改动过的接触面包。
// 结果：打印出来，并写到 <安装目录>/检查报告.md。
//   必须处理：不改代码或补丁就会出问题（补丁失效、外发开关没关上、接口找不到、测试不通过）
//   复核：要人看过、在报告里写下结论（例如读某个包的改动）
// 退出码：0 = 没有“必须处理”项；1 = 有；2 = 用法错误或装不上
//
// 接触面清单（README“升级 DSH”一节的表）就是下面的 PRIVACY、TOUCH、KNOWN_OUTBOUND，改了接触面要同步改这里。

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PINNED = JSON.parse(readFileSync(join(ROOT, 'config', 'dsh.json'), 'utf8')).version

const args = process.argv.slice(2)
const flag = (n) => { const k = args.indexOf(n); if (k < 0) return false; args.splice(k, 1); return true }
const opt = (n) => { const k = args.indexOf(n); if (k < 0) return null; const v = args[k + 1]; args.splice(k, 2); return v }
const skipRuntime = flag('--skip-runtime')
const registry = opt('--registry')
const dirArg = opt('--dir')
const target = args[0] || PINNED
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(target)) {
  console.error(`版本号要写全，如 0.2.2-rc.1（不能用 latest 这类标签）：${target}`)
  console.error('用法：node scripts/dsh-upgrade-check.mjs [<版本>] [--dir <安装目录>] [--registry <npm 源>] [--skip-runtime]')
  process.exit(2)
}
const DIR = resolve(dirArg || join(ROOT, 'runtime', 'dsh-check', target))
const BASE = join(ROOT, 'runtime', 'dsh')
const scope = (d) => join(d, 'node_modules', '@deepseek-ai')
const binOf = (d) => join(scope(d), 'dsh', 'lib', 'bin.js')
const fwd = (p) => p.replace(/\\/g, '/')

// ---------- 接触面 ----------

// 不往外发数据：组合配置里这些插件必须是这个状态。missing = 插件不存在时算不算问题
const PRIVACY = [
  { id: 'session-telemetry-otel', test: /^\s+mode: DISABLED\s*$/m, want: 'config.mode: DISABLED', what: '会话遥测（点赞点踩时上传整段会话）', missing: 'must' },
  { id: 'session-log-deepseek', test: /^\s+enabled: false\s*$/m, want: 'config.enabled: false', what: '官方 API 请求附带的会话日志', missing: 'must' },
  { id: 'tool-web', test: /^\s+disabled: true\s*$/m, want: 'disabled: true', what: '联网搜索、抓网页工具', missing: 'must' },
  { id: 'product-analytics', test: /^\s+disabled: true\s*$/m, want: 'disabled: true', what: '产品埋点（设备号、用户号、硬件信息）', missing: 'ok' },
  { id: 'desktop-product-telemetry', test: /^\s+disabled: true\s*$/m, want: 'disabled: true', what: '桌面端产品埋点', missing: 'ok' },
]

// 基线 0.2.1-rc.2 里就有、试点时核对过的“名字像会往外连”的插件（见 dsh-dept/试点记录-20261029.md 第 3 节）。
// 候选版本里出现不在这里、又没有关掉的同类插件时要逐个确认；确认不外发的加到这里（提交时写明依据），会外发的在补丁里关掉。
const KNOWN_OUTBOUND = new Set([
  'deepseek-llm-api-extensions', 'session-log-deepseek', 'remote-access', 'plugin-package-inventory-deepseek', 'deepseek-account',
  'otel', 'session-telemetry-otel', 'command-feedback', 'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web',
  'llm-deepseek', 'llm-deepseek-account', 'desktop-product-telemetry', 'product-analytics',
  // 网页界面（web profile）
  'message-feedback', 'session-log-download', 'ui-settings-account', 'account-controller', 'api-remotes', 'ui-message-feedback',
  'ui-deepseek-model-label-1017', 'ui-settings-session-log', 'ui-settings-web-search', 'ui-settings-plugins', 'plugin-inventory',
  // 网页界面自己的本机服务（起网页服务、托管界面、界面里上传附件到本机），名字带 web/upload，不是外连
  'web-startup', 'webserver', 'web-runtime', 'file-upload',
])
const OUTBOUND = /telemetr|analytic|feedback|session-log|otel|remote|upload|crash|sentry|metric|account|market|update|sync|share|track|beacon|web|deepseek|cloud|report/i

// 代码里直接用到的 DSH 内部接口：在候选版本的这个包里找得到这段文字，才算接口还在（找到不等于行为没变，行为靠真实引擎测试）
const TOUCH = [
  { where: 'app/engine/bridge.mjs', what: '提问挂接点（Cordis 瀑布事件）', pkg: 'dsh-user-questions', needles: ['user-questions/request'] },
  { where: 'app/engine/bridge.mjs', what: '会话的智能体（ctx.agents）', pkg: 'dsh-agent', needles: ['agents'] },
  { where: 'app/engine/bridge.mjs', what: '插话 agent.steer、停止 agent.cancel', pkg: 'dsh-agent', needles: ['steer(', 'cancel('] },
  { where: 'app/engine/bridge.mjs', what: '建用户消息 createUserMessage', pkg: 'dsh-llm', needles: ['createUserMessage'] },
  { where: 'app/engine/read-fence.mjs', what: '工具流水线 ctx.tools.guard', pkg: 'dsh-tools', needles: ['.guard'] },
  { where: 'app/engine/read-fence.mjs', what: '服务 sandboxPolicy', pkg: 'dsh-sandbox-policy', needles: ['sandboxPolicy'] },
  { where: 'app/engine/read-fence.mjs', what: '服务 workingDirectory', pkg: 'dsh-working-directory', needles: ['workingDirectory'] },
  { where: 'dsh-dept/lib/conventions.mjs', what: '系统提示分节 section / getSectionOrder', pkg: 'dsh-system-prompt', needles: ['getSectionOrder', 'DEPLOYMENT_PERSONA_SUFFIX'] },
  { where: 'app/engine/engine.mjs', what: 'SDK 协议的方法和通知', pkg: 'dsh-sdk-protocol', needles: ['initialize', 'session/prompt', 'session/resume', 'session/wait', 'session.event', 'session.status'] },
  { where: 'app/engine/activity.mjs', what: '会话事件类型', pkg: 'dsh-agent', needles: ['turn/start', 'turn/end', 'step/start', 'assistant/message', 'user/message'] },
  { where: 'app/engine/activity.mjs', what: '会话事件类型（工具调用）', pkg: 'dsh-agent-loop', needles: ['tool/call', 'tool/result'] },
  { where: 'app/engine/activity.mjs', what: '工具名 str_replace_editor', pkg: 'dsh-tool-str-replace-editor', needles: ['str_replace_editor'] },
  { where: 'app/engine/activity.mjs', what: '工具名 todo_write（任务进度）', pkg: 'dsh-tool-todo', needles: ['todo_write'] },
  { where: 'app/engine/activity.mjs', what: '工具名 ask_user_question', pkg: 'dsh-tool-ask-user', needles: ['ask_user_question'] },
  { where: 'app/engine/activity.mjs', what: '工具名 read_image', pkg: 'dsh-tool-fs', needles: ['read_image'] },
  { where: 'app/engine/activity.mjs', what: '工具名 pwsh', pkg: 'dsh-tool-pwsh', needles: ["'pwsh'"] },
  { where: 'app/engine/engine.mjs', what: '技能目录配置 customSkillDirs、includeDefaultRoots', pkg: 'dsh-skill-filesystem', needles: ['customSkillDirs', 'includeDefaultRoots'] },
  { where: 'scripts/common.ps1、packaging/launch.ps1', what: '环境变量 DSH_TELEMETRY_MODE', pkg: 'dsh-base', needles: ['DSH_TELEMETRY_MODE'] },
]
// 代码里写死的包内文件
const FILES = [
  { where: 'app/main/paths.mjs、app/engine/engine.mjs', what: 'dsh 命令入口', path: 'dsh/lib/bin.js' },
  { where: 'app/main/paths.mjs（aclScript）', what: 'Windows 文件夹权限诊断脚本', path: 'dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1' },
]

// ---------- 结果 ----------
const items = []
const add = (level, area, text) => items.push({ level, area, text })
const must = (a, t) => add('必须处理', a, t)
const review = (a, t) => add('复核', a, t)
const ok = (a, t) => add('通过', a, t)
const step = (s) => console.log(`\n== ${s}`)

function version(bin) {
  if (!existsSync(bin)) return null
  const r = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8', timeout: 120000 })
  return r.status === 0 ? r.stdout.trim() : null
}

// ---------- 1 安装 ----------
step(`1 安装 DSH ${target} 到 ${DIR}`)
if (version(binOf(DIR)) === target) console.log('   已经装好，不重装')
else {
  mkdirSync(DIR, { recursive: true })
  if (!existsSync(join(DIR, 'package.json'))) writeFileSync(join(DIR, 'package.json'), '{ "name": "dsh-upgrade-check", "private": true }\n')
  const npmArgs = ['install', '--save-exact', '--no-audit', '--no-fund', '--loglevel=error', `@deepseek-ai/dsh@${target}`]
  if (registry) npmArgs.push(`--registry=${registry}`)
  const win = process.platform === 'win32'
  // Windows 上 npm 是 npm.cmd，Node 要经 shell 才能运行它；参数里只有校验过的版本号和用户给的源地址（加引号）
  const r = spawnSync(win ? 'npm.cmd' : 'npm', win ? npmArgs.map((a) => `"${a}"`) : npmArgs, { cwd: DIR, stdio: 'inherit', shell: win })
  if (r.status !== 0) { console.error(`npm install 失败（退出码 ${r.status}）。官方源慢时加 --registry https://registry.npmmirror.com`); process.exit(2) }
}
const got = version(binOf(DIR))
if (got !== target) { console.error(`装好后 dsh --version 是 ${got}，不是 ${target}`); process.exit(2) }
ok('安装', `dsh ${got}`)
const baseVer = version(binOf(BASE))
const hasBase = !!baseVer && baseVer !== target
console.log(`   基线：${baseVer ? `runtime/dsh ${baseVer}` : 'runtime/dsh 没有装（只做候选版本自身的检查）'}`)

// ---------- 2 组合配置 ----------
const { writeEnginePatch } = await import(pathToFileURL(join(ROOT, 'app', 'engine', 'engine.mjs')).href)
const work = mkdtempSync(join(tmpdir(), 'dsh-upgrade-check-'))

/** 用工作台实际用的补丁组合出配置：profile sdk = 工作台（加引擎启动补丁），web = scripts\start-web.ps1 的网页界面 */
function compose(bin, profile) {
  const home = join(work, `${profile}-${createHash('sha1').update(bin).digest('hex').slice(0, 8)}`)
  mkdirSync(home, { recursive: true })
  const tpl = readFileSync(join(ROOT, 'config', 'cordis.patch.yml.template'), 'utf8')
  writeFileSync(join(home, 'cordis.patch.yml'), tpl.replaceAll('__STARTER_DIR__', fwd(ROOT)))
  const argv = [bin, '--profile', profile]
  if (profile === 'web') {
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), readFileSync(join(ROOT, 'config', 'web-profile.patch.yml'), 'utf8'))
  } else {
    const ws = join(work, 'ws')
    mkdirSync(ws, { recursive: true })
    argv.push('--patch', writeEnginePatch(join(home, 'engine'), { skillDirs: [join(ROOT, 'skills')], readFence: { readRoots: [ws], toolRoots: [] } }))
  }
  argv.push('--dump-config')
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED' }
  delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', env, timeout: 180000, maxBuffer: 64 << 20 })
  return { status: r.status, out: r.stdout || '', err: (r.stderr || '') + (r.error ? String(r.error) : ''), home }
}

/** dump 的顶层条目：id → { id, name, text, disabled } */
function blocks(dump) {
  const map = new Map()
  let cur = null
  for (const line of dump.split(/\r?\n/)) {
    const m = /^- id: (\S+)\s*$/.exec(line)
    if (m) { cur = { id: m[1], lines: [] }; map.set(cur.id, cur); continue }
    if (line.startsWith('# ==')) { cur = null; continue }
    if (cur) cur.lines.push(line)
  }
  for (const b of map.values()) {
    b.text = b.lines.join('\n')
    b.name = (/^\s+name: (.+)$/m.exec(b.text) || [])[1]?.replace(/^['"]|['"]$/g, '') || ''
    b.disabled = /^\s+disabled: true\s*$/m.test(b.text)
  }
  return map
}

const dumps = {}
for (const profile of ['sdk', 'web']) {
  const area = profile === 'sdk' ? '组合配置（工作台，profile sdk）' : '组合配置（网页界面，profile web）'
  step(`2 ${area}`)
  const c = compose(binOf(DIR), profile)
  if (c.status !== 0) { must(area, `dsh --dump-config 失败（退出码 ${c.status}）：${c.err.trim().split('\n').slice(-5).join(' / ')}`); continue }
  const map = blocks(c.out)
  dumps[profile] = map
  ok(area, `组合出 ${map.size} 个插件条目`)
  // 补丁里写的插件 id 新版本没有了：DSH 只打一行提示、照常启动，补丁不生效
  const lost = [...c.err.matchAll(/\[([^\]]+)\] patch: entry "([^"]+)" not found/g)]
  for (const [, file, id] of lost) {
    const priv = PRIVACY.find((p) => p.id === id)
    must(area, `补丁里的插件 ${id} 在新版本里找不到，这一段补丁不生效${priv ? `（**${priv.what}的关闭开关失效**）` : ''}。改名了就改补丁，去掉了就删掉补丁里这一段。补丁文件：${relative(c.home, file).startsWith('..') ? file : relative(c.home, file)}`)
  }
  const other = c.err.split(/\r?\n/).filter((l) => l.trim() && !/patch: entry "[^"]+" not found/.test(l) && !/ExperimentalWarning|trace-warnings/.test(l))
  if (other.length) review(area, `组合配置时 DSH 的其他提示：${other.slice(0, 8).join(' / ')}`)
  // 外发开关
  for (const p of PRIVACY) {
    const b = map.get(p.id)
    if (!b) { if (p.missing === 'must' && !lost.some(([, , id]) => id === p.id)) must(area, `没有 ${p.id}（${p.what}）：确认它是改名了（要改补丁）还是去掉了`); continue }
    if (p.test.test(b.text)) ok(area, `不往外发：${p.id} ${p.want}`)
    else must(area, `不往外发：${p.id}（${p.what}）不是 ${p.want}`)
  }
  // 名字像会往外连、没关掉、又不在核对过的名单里的插件
  for (const b of map.values()) {
    if (b.disabled || KNOWN_OUTBOUND.has(b.id) || !OUTBOUND.test(b.id)) continue
    must(area, `新插件 ${b.id}（${b.name}）名字像会往外连，而且没有关掉：读它的代码确认是否外发数据。会外发的在补丁里关掉；不会的加进本脚本的 KNOWN_OUTBOUND（提交时写明依据）`)
  }
  if (profile === 'sdk') {
    const sf = map.get('skill-filesystem')
    if (!sf || sf.disabled || !sf.text.includes(fwd(join(ROOT, 'skills')))) must(area, 'skill-filesystem 没有指向工程的 skills 目录：技能加载不上')
    else ok(area, 'skill-filesystem 指向工程的 skills 目录')
    const llm = map.get('llm-pi-ai')
    if (!llm || !/^\s+dept-llm:\s*$/m.test(llm.text)) must(area, 'llm-pi-ai 里没有 dept-llm 路由：模型连不上')
    else ok(area, 'llm-pi-ai 里有 dept-llm 路由')
    for (const id of ['astrolab-bridge', 'astrolab-tool-ask-user', 'astrolab-read-fence', 'mcp-docgen', 'mcp-docreader', 'mcp-utest', 'mcp-cppcheck', 'mcp-knowledge']) {
      if (!map.has(id)) must(area, `组合配置里没有 ${id}`)
    }
  }
  // 补丁里引用的包都要在
  const patchText = readFileSync(join(ROOT, 'config', 'cordis.patch.yml.template'), 'utf8') + c.out
  const pkgs = new Set([...patchText.matchAll(/name: ['"]?@deepseek-ai\/([a-z0-9-]+)/g)].map((m) => m[1]))
  const missing = [...pkgs].filter((p) => !existsSync(join(scope(DIR), p, 'package.json')))
  if (missing.length) must(area, `配置里引用的包没有装上：${missing.join('、')}`)
}

// ---------- 3 代码里用到的内部接口 ----------
step('3 代码里用到的 DSH 内部接口')
const jsCache = new Map()
function pkgText(base, pkg) {
  const key = `${base}|${pkg}`
  if (jsCache.has(key)) return jsCache.get(key)
  let text = null
  const root = join(scope(base), pkg)
  if (existsSync(root)) {
    text = ''
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        // 接口声明常在类型文件（.d.ts），环境变量、默认配置在包自带的补丁（.yml）里
        else if (/\.(c|m)?js$|\.d\.ts$|\.ya?ml$/.test(e.name)) text += readFileSync(p, 'utf8') + '\n'
      }
    }
    walk(root)
  }
  jsCache.set(key, text)
  return text
}
const AREA3 = '内部接口'
for (const t of TOUCH) {
  const text = pkgText(DIR, t.pkg)
  if (text === null) { must(AREA3, `${t.what}（${t.where}）：新版本里没有 @deepseek-ai/${t.pkg} 这个包`); continue }
  const gone = t.needles.filter((n) => !text.includes(n))
  if (!gone.length) { ok(AREA3, `${t.what}（${t.pkg}）`); continue }
  const baseText = hasBase ? pkgText(BASE, t.pkg) : null
  const goneInBase = baseText ? gone.filter((n) => !baseText.includes(n)) : []
  if (goneInBase.length === gone.length) review(AREA3, `${t.what}：基线里也找不到 ${gone.join('、')}，是检查项本身写错了，改本脚本的 TOUCH`)
  else must(AREA3, `${t.what}（${t.where}）：新版本的 @deepseek-ai/${t.pkg} 里找不到 ${gone.join('、')}，可能改名或去掉了，读这个包的改动`)
}
for (const f of FILES) {
  if (existsSync(join(scope(DIR), ...f.path.split('/')))) ok(AREA3, `${f.what}：${f.path}`)
  else must(AREA3, `${f.what}（${f.where}）：新版本里没有 @deepseek-ai/${f.path}`)
}

// ---------- 4 和基线比较 ----------
step('4 和基线比较')
const AREA4 = `和基线 ${baseVer || '（无）'} 比较`
function hashPkg(base, pkg) {
  const root = join(scope(base), pkg)
  if (!existsSync(root)) return null
  const h = createHash('sha256')
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === 'node_modules') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name !== 'package.json') h.update(fwd(relative(root, p))).update(readFileSync(p))
    }
  }
  walk(root)
  return h.digest('hex')
}
if (!hasBase) ok(AREA4, baseVer ? '候选版本就是基线版本，不用比较' : '没有基线，跳过')
else {
  const baseDumps = { sdk: blocks(compose(binOf(BASE), 'sdk').out), web: blocks(compose(binOf(BASE), 'web').out) }
  for (const profile of ['sdk', 'web']) {
    if (!dumps[profile]) continue
    const now = dumps[profile]
    const before = baseDumps[profile]
    const added = [...now.values()].filter((b) => !before.has(b.id))
    const removed = [...before.keys()].filter((id) => !now.has(id))
    if (added.length) review(AREA4, `profile ${profile} 新增插件 ${added.length} 个：${added.map((b) => `${b.id}${b.disabled ? '（关）' : ''}`).join('、')}。逐个看是做什么的；工作台用不上的可以加进 engine.mjs 的 TRIMMED_PLUGINS`)
    if (removed.length) review(AREA4, `profile ${profile} 去掉插件 ${removed.length} 个：${removed.join('、')}`)
    if (!added.length && !removed.length) ok(AREA4, `profile ${profile} 插件列表没有变化`)
  }
  const list = (d) => (existsSync(scope(d)) ? readdirSync(scope(d)) : [])
  const nowPkgs = new Set(list(DIR))
  const basePkgs = new Set(list(BASE))
  const addedPkgs = [...nowPkgs].filter((p) => !basePkgs.has(p))
  const removedPkgs = [...basePkgs].filter((p) => !nowPkgs.has(p))
  if (addedPkgs.length || removedPkgs.length) review(AREA4, `@deepseek-ai 包：新增 ${addedPkgs.length} 个（${addedPkgs.join('、') || '无'}），去掉 ${removedPkgs.length} 个（${removedPkgs.join('、') || '无'}）`)
  // 接触面相关的包改了哪些：升级前要读这些包的改动
  const watch = new Set([...TOUCH.map((t) => t.pkg), 'dsh-sdk-app', 'dsh-sdk-jsonrpc-server', 'dsh-session-telemetry-otel', 'dsh-session-log-deepseek',
    'dsh-llm-pi-ai', 'dsh-mcp-client', 'dsh-user-questions', 'dsh-sandbox-windows-acl', 'dsh-sandbox', 'dsh-fs-sandbox', 'dsh-tool-web', 'dsh-api-session-controller', 'dsh-session-format'])
  const changed = [...watch].filter((p) => { const a = hashPkg(BASE, p); const b = hashPkg(DIR, p); return a && b && a !== b })
  if (changed.length) review(AREA4, `接触面相关的包里，代码改过的有 ${changed.length} 个，读它们的改动（重点看事件名、配置项、接口签名）：${changed.join('、')}`)
  else ok(AREA4, '接触面相关的包代码都没有变')
  // 官方桌面端用的部门组合包照抄了官方 standard 预设（dsh-dept/cordis.patch.yml），预设变了要重新照抄
  const preset = (d) => { const p = join(scope(d), 'dsh-web-app', 'presets', 'standard.patch.yml'); return existsSync(p) ? readFileSync(p, 'utf8') : null }
  const pa = preset(BASE)
  const pb = preset(DIR)
  if (pa !== null && pb !== null && pa !== pb) review(AREA4, '官方 standard 预设（dsh-web-app/presets/standard.patch.yml）改了：dsh-dept/cordis.patch.yml 里的部门预设要对照新版重新照抄')
}
// 部门组合包声明的适用版本
try {
  const engines = JSON.parse(readFileSync(join(ROOT, 'dsh-dept', 'package.json'), 'utf8')).engines?.dsh || ''
  if (!engines.split('||').map((s) => s.trim()).includes(target)) review('部门组合包', `dsh-dept/package.json 的 engines.dsh（${engines}）不含 ${target}：官方桌面端的部门组合包核对过后再加上`)
} catch { /* 没有这个文件就不查 */ }

// ---------- 5 真实引擎测试 ----------
if (skipRuntime) review('真实引擎测试', '这次没有跑（--skip-runtime）：改版本号之前必须跑一次')
else {
  for (const [file, what, log] of [['real-dsh.mjs', '引擎桥：插话、停止、继续、提问、任务控制器、知识库和插件工具', 'real-dsh-check.log'], ['real-dsh-fence.mjs', '读取围栏：工作区外的文件读不到', 'real-dsh-fence.log']]) {
    step(`5 真实引擎测试 ${file}（模型是本机的假服务，不花模型调用）`)
    const env = { ...process.env, ASTROLAB_DSH: binOf(DIR) }
    delete env.ELECTRON_RUN_AS_NODE
    const r = spawnSync(process.execPath, [join(ROOT, 'app', 'test', file)], { cwd: ROOT, env, encoding: 'utf8', timeout: 10 * 60000, maxBuffer: 64 << 20 }) // 正常两三分钟；卡住（例如问题送不到）时到点算不通过
    const out = (r.stdout || '') + (r.stderr || '')
    process.stdout.write(out.split('\n').slice(-25).join('\n') + '\n')
    const last = out.trim().split('\n').filter(Boolean).slice(-1)[0] || ''
    if (r.status === 0) ok('真实引擎测试', `${file}（${what}）：${last}`)
    else must('真实引擎测试', `${file}（${what}）没有通过（退出码 ${r.status ?? r.signal}）：${last}。详细见 runtime/${log}`)
  }
}
try { rmSync(work, { recursive: true, force: true }) } catch { /* 临时目录，留着也无妨 */ }

// ---------- 报告 ----------
const count = (l) => items.filter((i) => i.level === l).length
const nMust = count('必须处理')
const nReview = count('复核')
const lines = [
  `# DSH 升级检查：${target}`,
  '',
  `- 时间：${new Date().toISOString()}`,
  `- 候选版本：${target}（${DIR}）`,
  `- 基线：${baseVer ? `${baseVer}（runtime/dsh）` : '无'}；config/dsh.json 锁定 ${PINNED}`,
  `- 结果：必须处理 ${nMust} 项，复核 ${nReview} 项，通过 ${count('通过')} 项`,
  '',
]
for (const level of ['必须处理', '复核', '通过']) {
  const list = items.filter((i) => i.level === level)
  if (!list.length) continue
  lines.push(`## ${level}（${list.length}）`, '', '| 方面 | 内容 |', '|---|---|')
  for (const i of list) lines.push(`| ${i.area} | ${i.text.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
  lines.push('')
}
lines.push('## 下一步', '')
if (target === PINNED) lines.push('候选版本就是现在锁定的版本：这次检查确认的是检查脚本本身。')
else if (nMust) lines.push('先处理“必须处理”的各项（改补丁或代码），再运行一次本脚本。')
else {
  lines.push(
    '1. 逐项看过“复核”，在这一节下面写结论。',
    `2. 把 config/dsh.json 的 version 改成 ${target}，运行 scripts\\setup.ps1，再运行 scripts\\check.ps1。`,
    '3. 用真实模型跑 evals 做回归，和升级前的分数比较；在外网样机上核对会话记录、网络连接，确认没有外发。',
    '4. 用 packaging\\build-offline.ps1 打包，release.mjs 发布；先发一两台试点电脑，没问题再全部推送。',
  )
}
const report = join(DIR, '检查报告.md')
writeFileSync(report, lines.join('\n') + '\n')
console.log('\n' + lines.slice(0, 6).join('\n'))
for (const i of items.filter((x) => x.level !== '通过')) console.log(`[${i.level}] ${i.area}：${i.text}`)
console.log(`\n报告：${report}`)
process.exit(nMust ? 1 : 0)
