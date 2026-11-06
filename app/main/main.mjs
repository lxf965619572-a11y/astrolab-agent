// AstroLab 主进程（Electron）：窗口、项目、任务控制器、与界面之间的接口（IPC）、系统通知。
// 界面进程不接触 Node：contextIsolation + sandbox，只能调用 preload.cjs 暴露的接口；不加载任何网络内容。

import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, protocol, shell } from 'electron'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'
import { engineEnv, modelConfig, prepareDshHome, readLocalEnv, resolvePaths } from './paths.mjs'
import { UpdateService, updateDirOf } from './update.mjs'
import { ensureSample, findMentions, listFiles, prepareProject, ProjectStore, readProjectFile, updateSample } from './projects.mjs'
import { deleteTaskRecord, listOutputs, patchTaskRecord, readHistory, searchTasks, STAGES, TaskController } from './task.mjs'
import { INBOX, Library } from './library.mjs'
import { buildMaterial, distillPrompt, distillScope, pendingTasks, readState, writeState } from './distill.mjs'
import { git } from './git.mjs'
import { ReferenceService } from './reference.mjs'
import { chat } from './llm.mjs'
import { buildIndex, readEntry, search, writeEntry } from '../../mcp/knowledge/lib/kb.mjs'
import { buildRefIndex, listDocs, loadGlossary, searchRef } from '../../mcp/knowledge/lib/ref.mjs'

const P = resolvePaths()
mkdirSync(P.data, { recursive: true })
app.setPath('userData', join(P.data, 'electron'))
// 任务栏分组和图标用的 ID。开发时用单独的 ID：不和安装版混在一组，也避开 Windows 缓存过的旧图标（Electron 的）
const AUMID = P.installed ? 'AstroLab' : 'AstroLab.Dev'
app.setAppUserModelId(AUMID)
const DEV_URL = process.env.ASTROLAB_DEV_URL || ''

// 预览项目里的 HTML（比如信息流插件的交互版）：走单独的 astro-preview: 地址，带自己的 CSP——
// 允许页面里的脚本，但什么网也连不了；界面用 sandbox iframe（不给 allow-same-origin）显示，碰不到工作台和 preload。
// 不能用 srcdoc：它继承工作台的 CSP（script-src 'self'），页面里的脚本不运行。
const PREVIEW = 'astro-preview'
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"
protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW, privileges: { standard: true, secure: true } }])

// 只建快捷方式的调用（安装脚本）不占单实例锁：软件开着时也能执行
const SHORTCUTS_ONLY = process.argv.includes('--install-shortcuts') || process.argv.includes('--remove-shortcuts')
if (!SHORTCUTS_ONLY && !app.requestSingleInstanceLock()) app.quit()

// 主进程日志：启动信息和未处理的错误，排查问题时看 <用户数据>\logs\main.log
function mlog(...args) {
  try {
    mkdirSync(P.logs, { recursive: true })
    appendFileSync(join(P.logs, 'main.log'), `${new Date().toISOString()} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`)
  } catch { /* 写不了日志也不影响运行 */ }
}
process.on('uncaughtException', (e) => mlog('uncaughtException', e))
process.on('unhandledRejection', (e) => mlog('unhandledRejection', e))
mlog('start', { version: app.getVersion(), electron: process.versions.electron, root: P.root, data: P.data, mock: P.mock, installed: P.installed, dshBin: P.dshBin, nodePath: P.nodePath })

let win = null
let bridge = null
let store = null
// 任务控制器：每个项目（文件夹）一个，各有自己的引擎和当前任务。不同文件夹的任务可以同时进行；
// 同一个文件夹同一时间只有一个任务（几个智能体同时改一个文件夹会互相覆盖，审核也分不清是谁改的）。
// ctl 是界面上正在看的项目的控制器；切到别的项目时，有任务在进行的控制器留在后台接着做。
let ctl = null
const ctls = new Map() // 项目 id -> TaskController
/** 同时进行的任务上限：每个任务一个引擎进程，模型并发和本机资源都有限 */
const MAX_PARALLEL = Math.max(1, Number(process.env.ASTROLAB_MAX_PARALLEL) || 3)
let lib = null
let updates = null
let refs = null
let notes = []
/** 启动时的提醒（打开项目时 notes 会换成项目的，这些不跟着换） */
const bootNotes = []

function send(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('astro:event', { type, payload })
}

// 每个项目一个引擎进程，任务之间共用；收发记录先写 engine-<时间>.jsonl，发起任务后改写到 <任务>.jsonl
/**
 * 读取围栏允许的目录（工作区由 DSH 按会话给出，不在这里）：
 *   readRoots  技能目录（仓库的、已安装的、插件带的）——智能体要读技能的参考文件、运行技能的检查脚本
 *   toolRoots  命令里可以出现的工具链目录：node、gcc（到 ucrt64 一级）、Cppcheck、安装包的 tools、DSH 自己
 */
function fenceRoots(env) {
  const up = (f, n) => { let d = f; for (let i = 0; i < n; i++) d = dirname(d); return d }
  const exe = (f, n) => (f && /[\\/]/.test(f) ? up(f, n) : null)
  return {
    // 技能目录；utest 的测试框架头文件 utest.h（技能让智能体按 toolchain_info 给的路径去读）
    readRoots: [...lib.skillDirs(), join(P.root, 'mcp', 'utest', 'harness')],
    toolRoots: [exe(P.nodePath, 1), exe(env.UTEST_CC, 2), exe(env.CPPCHECK_PATH, 1), P.tools, join(P.root, 'runtime', 'dsh')],
  }
}

function makeEngine(project) {
  const env = engineEnv(P)
  env.ASTROLAB_BRIDGE = bridge.path
  // 知识库工具服务用：我的库 + 全部共享库（还没克隆的也列上，同步后不用重启引擎就能查到）
  env.ASTROLAB_LIBRARIES = JSON.stringify(lib.sources().map((x) => ({ id: x.id, name: x.name, dir: x.dir, model: x.model || '', writable: !!x.writable })))
  const m = modelConfig(env)
  // 资料库的许可：用公网接口时只开放公版资料（有版权的不发出去）；设置里写了 ASTROLAB_REFERENCE_SCOPE 就按设置
  if (!['public', 'all'].includes(env.ASTROLAB_REFERENCE_SCOPE)) env.ASTROLAB_REFERENCE_SCOPE = distillScope({}, m.baseURL) === 'sample' ? 'public' : 'all'
  mkdirSync(P.logs, { recursive: true })
  return new Engine({
    dshBin: P.dshBin, nodePath: P.nodePath, cwd: project.path, env,
    logFile: join(P.logs, `engine-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-${project.id}.jsonl`), // 多个项目同时启动引擎时不重名
    provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort,
    patches: P.mock ? [] : [writeEnginePatch(P.engineDir, { skillDirs: lib.skillDirs(), mcpServers: lib.mcpServers(P.nodePath), readFence: fenceRoots(env) })],
  })
}

function appState() {
  const env = engineEnv(P)
  const m = modelConfig(env)
  return {
    platform: process.platform,
    mock: P.mock,
    installed: P.installed,
    model: { provider: m.provider, model: m.model, baseURL: m.baseURL, hasKey: m.hasKey, contextWindow: m.contextWindow },
    engineReady: P.mock || existsSync(P.dshBin),
    projects: store.list(),
    stages: STAGES.map((s) => ({ ...s, hasSkill: lib.skillDirs().some((d) => existsSync(join(d, s.skill))) })),
    skills: lib.skillCards(),
    libraryDir: lib.sources()[0].dir,
    // 设置页和侧栏账户区用：本机用户名（没有登录）、版本、数据和日志目录
    user: (() => { try { return userInfo().username } catch { return '' } })(),
    versions: { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node },
    dataDir: P.data, logDir: P.logs,
    notes: [...bootNotes, ...notes],
    update: updates ? updates.state() : null,
    task: ctl.snapshotState(),
    items: ctl.items(),
    background: background(),
  }
}

// ---------- 多个项目并行 ----------
const anyBusy = () => [...ctls.values()].some((c) => c.busy)
const allCtls = () => [...ctls.values()]
/** 后台的任务（不是正在看的项目）：侧栏显示它们的状态，点一下切过去 */
function background() {
  return allCtls().filter((c) => c !== ctl && c.task && c.project).map((c) => ({
    projectId: c.project.id, projectName: c.project.name, status: c.status,
    task: { id: c.task.id, title: c.task.title, stageName: c.task.stageName, mode: c.task.mode, category: c.task.category, startedAt: c.task.startedAt },
    asking: c.questions.size > 0,
  }))
}
const sendBackground = () => send('background', background())
const norm = (x) => resolve(x).toLowerCase().replace(/[\\/]+$/, '')
/** 在 c 的项目里开始（或继续）任务之前：不超过并行上限；别的进行中的项目不能和它是包含关系（那样就是同一批文件） */
function checkParallel(c) {
  if (c.busy || !c.project) return
  const others = allCtls().filter((x) => x !== c && x.busy && x.project)
  if (others.length >= MAX_PARALLEL) throw new Error(`同时最多 ${MAX_PARALLEL} 个任务在进行：${others.map((x) => `${x.project.name}（${x.task ? x.task.stageName : ''}）`).join('、')}。等其中一个结束再开始`)
  const me = norm(c.project.path)
  const clash = others.find((x) => { const o = norm(x.project.path); return o === me || o.startsWith(me + sep) || me.startsWith(o + sep) })
  if (clash) throw new Error(`“${clash.project.name}”（${clash.project.path}）有任务在进行，它和这个项目是同一批文件（文件夹互相包含），同时改会互相覆盖。等那个任务结束再开始`)
}
function newController() {
  const c = new TaskController({ bridge, dataDir: P.data, logDir: P.logs, skillsDir: P.skillsDir, skillCards: () => lib.skillCards(), makeEngine, shared: true, knowledge: !P.mock && existsSync(join(P.root, 'mcp', 'knowledge', 'server.mjs')) })
  wireController(c)
  return c
}

async function openProject(id) {
  const p = store.get(id)
  if (!p) throw new Error('项目不存在')
  if (!existsSync(p.path)) throw new Error(`项目文件夹不存在：${p.path}`)
  notes = await prepareProject(p, P)
  store.update(p.id, { ...p, lastOpenedAt: Date.now() })
  const prev = ctl
  let c = ctls.get(p.id)
  if (!c) {
    c = newController()
    ctls.set(p.id, c)
    await c.setProject(store.get(id))
  } else c.project = store.get(id)
  ctl = c
  // 离开的项目没有任务在进行：关掉它的控制器和引擎（省资源，记录都已保存，回来时从历史打开）；有任务就留在后台接着做
  if (prev && prev !== c && !prev.busy) {
    if (prev.project && ctls.get(prev.project.id) === prev) ctls.delete(prev.project.id)
    void prev.dispose().catch((e) => mlog('dispose', e))
  }
  sendBackground()
  return appState()
}

/** 改任务记录：这个工作区开着（有控制器）就交给它，当前任务的标题会立刻更新；没开着就直接改记录文件 */
function editTask(pid, id, patch) {
  if (!store.get(pid)) throw new Error('项目不存在')
  const c = ctls.get(pid)
  const t = c && c.project ? c.patchTask(id, patch) : patchTaskRecord(P.data, pid, id, patch)
  if (c && c !== ctl) sendBackground()
  return t
}

function projectPath(rel) {
  if (!ctl.project) throw new Error('还没有打开项目')
  const abs = resolve(ctl.project.path, rel)
  const r = relative(ctl.project.path, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('路径越出项目')
  return abs
}

// 每个接口返回 { ok, data } 或 { ok:false, error }，界面拿到干净的错误信息
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) } } catch (e) {
      mlog(`ipc ${channel} failed`, e)
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  })
}

// ---------- 库：知识库、技能与插件 ----------
const mineLib = () => lib.sources()[0]
const kbLibs = () => lib.available()
function mineEntryPath(id) {
  const i = String(id).indexOf(':')
  if (String(id).slice(0, i) !== mineLib().id) throw new Error('只有我的库里的条目能改；共享库的条目先复制到我的库')
  return String(id).slice(i + 1)
}
async function kbSave({ id, meta, body }) {
  const mine = await lib.ensureMine()
  const path = id ? mineEntryPath(id) : undefined
  const rel = writeEntry(mine, meta, body, path)
  await lib.commitMine([rel], `知识库：${meta.title || rel}`)
  return `${mineLib().id}:${rel}`
}
async function kbDelete(id) {
  const rel = mineEntryPath(id)
  const { rmSync } = await import('node:fs')
  rmSync(join(mineLib().dir, rel), { force: true })
  await lib.commitMine([rel], `知识库：删除 ${rel}`)
}
/** 在“我的库”里发起技能或插件创作：我的库当作一个项目打开，智能体只能写这里 */
async function createInLibrary(kind, prompt) {
  const dir = await lib.ensureMine()
  const p = store.findByPath(dir) || store.add(dir, { name: '我的库', library: true })
  const lc = ctls.get(p.id)
  if (lc && lc.busy) throw new Error('我的库里有任务在进行，结束后再创作')
  await openProject(p.id)
  checkParallel(ctl)
  return ctl.start({ stage: kind === 'plugin' ? 'plugin' : 'skill', prompt, files: [], options: { report: false } })
}
// ---------- 知识整理（蒸馏）和 Obsidian ----------
function distillContext() {
  const env = engineEnv(P)
  const scope = distillScope(env, modelConfig(env).baseURL)
  const mine = mineLib().dir
  const st = readState(mine)
  return { scope, mine, st }
}
function distillInfo() {
  const { scope, mine, st } = distillContext()
  const { tasks, skipped, more } = pendingTasks({ dataDir: P.data, projects: store.list(), since: st.lastRun || 0, scope })
  return { lastRun: st.lastRun || 0, pending: tasks.length + more, skipped, scope, mine }
}
/** 整理最近的任务：生成素材，在我的库里发起“知识整理”任务（技能 knowledge-distill）；候选写到 待整理/ */
async function distillNow() {
  const mine = await lib.ensureMine()
  const { scope, st } = distillContext()
  const known = buildIndex(kbLibs()).docs.map((d) => `${d.title}（${d.libName}）`)
  const at = Date.now()
  const m = await buildMaterial({ dataDir: P.data, projects: store.list(), mineDir: mine, since: st.lastRun || 0, scope, known, now: at })
  if (!m.count) {
    throw new Error(scope === 'sample' && m.skipped
      ? `现在用的是公网接口，只整理示例工程的任务；上次整理之后有 ${m.skipped} 个其他工程的任务，换成部门模型后再整理`
      : '上次整理之后没有新结束的任务')
  }
  const p = store.findByPath(mine) || store.add(mine, { name: '我的库', library: true })
  const lc = ctls.get(p.id)
  if (lc && lc.busy) throw new Error('我的库里有任务在进行，结束后再整理')
  await openProject(p.id)
  checkParallel(ctl)
  const date = new Date(at).toISOString().slice(0, 10)
  const t = await ctl.start({ stage: 'distill', prompt: distillPrompt({ rel: m.rel, count: m.count, date }), files: [], options: { report: false } })
  t.distill = { at, tasks: m.tasks, material: m.rel, scope }
  ctl.save()
  return t
}
/** 整理任务做完：工作台提交 待整理/ 的候选（不走审核页），记下这次整理到哪里 */
async function afterDistill(task, c = ctl) {
  try {
    const sha = await lib.commitMine([INBOX], `知识整理：${task.distill ? task.distill.tasks.length : ''} 个任务的候选`)
    if (sha && c.task === task) {
      const paths = (await git(mineLib().dir, ['show', '--name-only', '--pretty=format:', sha])).split(/\r?\n/).filter(Boolean)
      c.markCommitted(sha, '知识整理的候选（工作台提交）', paths)
    }
    if (task.distill) {
      const st = readState(mineLib().dir)
      writeState(mineLib().dir, { lastRun: Math.max(st.lastRun || 0, task.distill.at), runs: [...(st.runs || []), { at: task.distill.at, taskId: task.id, tasks: task.distill.tasks.length, commit: sha || null }].slice(-30) })
    }
    send('library', lib.states())
  } catch (e) { mlog('distill finish', e) }
}
/** 在 Obsidian 里改的知识条目：定时提交进我的库（我的库里有任务在跑时等它结束） */
async function commitExternalEdits() {
  if (!lib || allCtls().some((c) => c.busy && c.project && c.project.library)) return
  try { if (await lib.commitExternal()) send('library', lib.states()) } catch (e) { mlog('commit external', e) }
}
/** Obsidian 记着的库：%APPDATA%\obsidian\obsidian.json 的 vaults。没装或没打开过返回 null */
function obsidianVaults() {
  try {
    const j = JSON.parse(readFileSync(join(app.getPath('appData'), 'obsidian', 'obsidian.json'), 'utf8'))
    return Object.entries(j.vaults || {}).map(([id, v]) => ({ id, path: v && v.path })).filter((v) => v.path)
  } catch { return null }
}
/** 在 Obsidian 里打开我的库（rel 给了就打开那个文件）。返回 { opened, installed, dir } */
async function openInObsidian(rel) {
  const mine = await lib.ensureMine()
  const target = rel ? resolve(mine, rel) : mine
  if (relative(mine, target).startsWith('..') || isAbsolute(relative(mine, target))) throw new Error('只能打开我的库里的文件')
  const vaults = obsidianVaults()
  const norm = (x) => resolve(x).toLowerCase().replace(/[\\/]+$/, '')
  const t = norm(target)
  const v = (vaults || []).filter((x) => t === norm(x.path) || t.startsWith(norm(x.path) + sep)).sort((a, b) => b.path.length - a.path.length)[0]
  if (!v) return { opened: false, installed: vaults !== null, dir: mine }
  await shell.openExternal(rel ? `obsidian://open?path=${encodeURIComponent(target)}` : `obsidian://open?vault=${encodeURIComponent(v.id)}`)
  return { opened: true, installed: true, dir: mine }
}

/**
 * 换技能或插件前先关引擎：引擎监视着技能目录，插件的工具服务是它的子进程，在 Windows 上这些都占着文件夹，
 * 不关就删不掉、换不了（“重新试用”报 EPERM，还会删掉一半）。装完 afterInstall 会在后台重启引擎。
 * 任务进行中不能关引擎，就等任务结束再装。
 */
async function freeInstalled() {
  if (anyBusy()) throw new Error('任务进行中：引擎正在用已安装的技能和插件，等任务结束后再安装、试用或卸载')
  for (const c of allCtls()) await c.closeEngine()
}

function afterInstall() {
  let now = true
  for (const c of allCtls()) now = c.requestRestart() && now
  return { restarted: now, skills: lib.skillCards() }
}

function registerIpc() {
  handle('app:state', () => appState())
  handle('project:open', (id) => openProject(id))
  handle('project:add', async () => {
    const r = await dialog.showOpenDialog(win, { title: '打开项目文件夹', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const p = store.add(r.filePaths[0])
    if (p.hidden) store.update(p.id, { hidden: false }) // 以前移出过列表的文件夹：重新打开就回来，任务记录还在
    return openProject(p.id)
  })
  // 工作区：置顶（侧栏和工作区菜单里排在前面）；移出列表（只是不显示，文件夹和任务记录都不动）
  handle('project:pin', (id, on) => { if (!store.update(id, { pinned: !!on })) throw new Error('项目不存在'); return store.list() })
  // 工程主页右栏：工程说明（写进每个任务的第一条消息）、参考资料（工程内的相对路径）
  handle('project:setInfo', (id, info) => {
    const patch = {}
    if (info && typeof info.notes === 'string') patch.notes = info.notes.slice(0, 4000)
    if (info && Array.isArray(info.refs)) {
      patch.refs = [...new Set(info.refs.map((x) => String(x || '').trim().replace(/\\/g, '/')).filter((x) => x && !isAbsolute(x) && !/^[A-Za-z]:/.test(x) && !x.split('/').includes('..')))].slice(0, 50)
    }
    const p = store.update(id, patch)
    if (!p) throw new Error('项目不存在')
    for (const c of allCtls()) if (c.project && c.project.id === id) Object.assign(c.project, patch)
    return store.list()
  })
  handle('project:hide', (id) => {
    if (ctl.project && ctl.project.id === id) throw new Error('正在用的工作区不能移出，先切到别的工作区')
    const c = ctls.get(id)
    if (c && c.busy) throw new Error('这个工作区有任务在进行，等它结束再移出')
    if (c) { ctls.delete(id); void c.dispose().catch((e) => mlog('dispose', e)); sendBackground() }
    if (!store.update(id, { hidden: true, pinned: false })) throw new Error('项目不存在')
    return appState()
  })
  handle('project:files', (q) => (ctl.project ? listFiles(ctl.project.path, q) : []))
  handle('project:mentions', (text) => (ctl.project ? findMentions(ctl.project.path, text) : []))
  // 代码模式：整个项目的文件（git 跟踪的 + 没被忽略的新文件，最多 5000 个）和只读看一个文件
  handle('project:tree', () => (ctl.project ? listFiles(ctl.project.path, '', 5000) : []))
  handle('project:read', (rel) => { if (!ctl.project) throw new Error('还没有打开项目'); return readProjectFile(ctl.project.path, rel) })
  handle('task:start', (input) => { checkParallel(ctl); return ctl.start(input) })
  handle('task:send', (text, extra) => { checkParallel(ctl); return ctl.send(text, extra) })
  handle('task:stop', () => ctl.stop())
  handle('task:resume', (text) => { checkParallel(ctl); return ctl.resume(text) })
  handle('task:answer', (id, answers) => ctl.answer(id, answers))
  handle('task:new', () => ctl.reset())
  handle('task:open', (id) => ctl.openTask(id))
  handle('task:history', () => ctl.history())
  // 侧栏按工作区列最近的任务：每个工作区（没移出列表的）各取最近几个；“全部任务”页取到 500 个
  handle('task:recent', (limit) => Object.fromEntries(store.list().filter((p) => !p.hidden).map((p) => [p.id, readHistory(P.data, p.id, Math.max(1, Math.min(500, Number(limit) || 12)))])))
  handle('task:peek', (id) => ctl.peekTask(id))
  // 搜索（Ctrl K）：所有工程（没移出列表的），或只搜当前工程
  // 产出页：所有工程的任务写过的文件
  handle('task:outputs', () => listOutputs(P.data, store.list().filter((p) => !p.hidden)))
  handle('task:search', (q, scope) => searchTasks(P.data, store.list().filter((p) => !p.hidden && (scope !== 'current' || p.id === ctl.project?.id)), q))
  // 设置页“测试连接”：用部门模型回一句话，量用时；密钥只在主进程里用
  handle('model:test', async () => {
    if (P.mock) return { ok: true, ms: 0, model: '模拟引擎', reply: '（模拟引擎不调用模型）' }
    const env = engineEnv(P)
    const m = modelConfig(env)
    const apiKey = env.DEPT_LLM_API_KEY || env.DEEPSEEK_API_KEY || ''
    if (!apiKey) return { ok: false, ms: 0, model: m.model, error: '没有配置密钥（config/local.env）' }
    const t0 = Date.now()
    try {
      const r = await chat({ baseURL: m.baseURL, apiKey, model: m.model, messages: [{ role: 'system', content: '只回复“连接正常”四个字。' }, { role: 'user', content: '测试' }], maxTokens: 64, timeoutMs: 30000 })
      return { ok: true, ms: Date.now() - t0, model: m.model, reply: String(r?.content || '').slice(0, 40) }
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, model: m.model, error: String(e?.message || e).replace(/(sk|key)[-_a-z0-9]{8,}/gi, '***').slice(0, 200) }
    }
  })
  // 编辑对话（侧栏和任务历史里的“⋯”菜单）：任何一个工作区的任务都能改，不用先切过去
  handle('task:rename', (pid, id, title) => {
    const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!t) throw new Error('名字不能为空')
    return editTask(pid, id, { title: t })
  })
  handle('task:archive', (pid, id, on) => editTask(pid, id, { archived: !!on }))
  handle('task:remove', async (pid, id) => {
    if (!store.get(pid)) throw new Error('项目不存在')
    const c = ctls.get(pid)
    if (c && c.task && c.task.id === id) {
      if (c.busy) throw new Error('任务进行中，先停止再删除')
      await c.reset() // 正在看的任务：先回到新任务页
    }
    deleteTaskRecord(P.data, pid, id)
    if (c && c !== ctl) sendBackground()
    return true
  })
  handle('review:changes', () => ctl.changes())
  handle('review:file', (path) => ctl.fileVersions(path))
  handle('review:commit', (message, paths) => ctl.commit(message, paths))
  handle('review:undoCommit', () => ctl.undoCommit())
  handle('review:restore', () => ctl.restoreSnapshot())
  handle('kb:search', (q, f) => search(buildIndex(kbLibs()), q || '', { ...(f || {}), limit: 200 }))
  handle('kb:read', (id) => readEntry(kbLibs(), id))
  handle('kb:save', (e) => kbSave(e))
  handle('kb:delete', (id) => kbDelete(id))
  // 资料库（人在界面上读：不按许可过滤，那是给发到公网模型的检索用的）
  handle('ref:docs', () => listDocs(kbLibs()).map(({ dir, ...d }) => d))
  handle('ref:search', (q, doc) => searchRef(buildRefIndex(kbLibs()), String(q || ''), { doc: doc || undefined, limit: 30, glossary: loadGlossary(kbLibs()) }))
  handle('ref:read', (id) => refs.read(String(id)))
  handle('ref:counts', (lib, doc) => refs.counts(String(lib), String(doc)))
  handle('ref:translate', (id) => refs.translate(String(id), { onProgress: (i, job) => send('ref-translate', { id: i, job }) }))
  handle('ref:saveTranslation', (id, paras) => refs.saveTranslation(String(id), paras))
  handle('ref:saveOriginal', (id, text) => refs.saveOriginal(String(id), String(text || '')))
  handle('ref:revert', (id, what) => refs.revert(String(id), what === 'translation' ? 'translation' : 'original'))
  handle('ref:submit', (id, what) => refs.submit(String(id), what === 'original' ? 'original' : 'translation'))
  handle('ref:addHighlight', (id, h) => refs.addHighlight(String(id), h || {}))
  handle('ref:updateHighlight', (id, hid, patch) => refs.updateHighlight(String(id), String(hid), patch || {}))
  handle('ref:removeHighlight', (id, hid) => refs.removeHighlight(String(id), String(hid)))
  handle('kb:inbox', async () => { await commitExternalEdits(); return { ...lib.inbox(), distill: distillInfo() } })
  handle('kb:accept', (rel) => lib.acceptCandidate(String(rel)))
  handle('kb:discard', (rel) => lib.discardCandidate(String(rel)))
  handle('kb:distill', () => distillNow())
  handle('kb:obsidian', (rel) => openInObsidian(rel ? String(rel) : ''))
  handle('kb:openMine', async () => { const err = await shell.openPath(await lib.ensureMine()); if (err) throw new Error(err) })
  handle('sys:copy', (text) => { clipboard.writeText(String(text || '')) })
  handle('kb:publish', async (id, target) => { const e = readEntry(kbLibs(), id); return lib.submit(target, mineEntryPath(id), `知识：${e.meta.title || e.path}`) })
  handle('lib:state', () => ({ sources: lib.states(), mine: mineLib().dir }))
  handle('lib:sync', async (id) => { if (id) await lib.sync(id); else await lib.syncAll(); return lib.states() })
  handle('lib:addSource', async (s) => { const id = lib.addSource(s); await lib.sync(id); allCtls().forEach((c) => c.requestRestart()); return lib.states() })
  handle('lib:removeSource', (id) => { lib.removeSource(id); allCtls().forEach((c) => c.requestRestart()); return lib.states() })
  handle('lib:catalog', () => lib.catalog())
  handle('lib:install', async (key) => { await freeInstalled(); return { ...(await lib.install(key)), ...afterInstall() } })
  handle('lib:uninstall', async (kind, name) => { await freeInstalled(); lib.uninstall(kind, name); return afterInstall() })
  handle('lib:readSkill', async (key) => {
    const items = await lib.catalog()
    const it = items.find((x) => x.key === key)
    if (!it) throw new Error('没有这一项')
    const base = it.builtin ? P.root : lib.available().find((l) => l.id === it.source).dir
    const { readFileSync } = await import('node:fs')
    const f = it.kind === 'skill' ? join(base, it.path, 'SKILL.md') : join(base, it.path, 'plugin.json')
    let extra = ''
    if (it.kind === 'plugin') { try { extra = readFileSync(join(base, it.path, 'README.md'), 'utf8') } catch { /* 没有说明 */ } }
    return { item: it, text: readFileSync(f, 'utf8'), readme: extra }
  })
  handle('lib:submit', async (key, target) => {
    const it = (await lib.catalog()).find((x) => x.key === key)
    if (!it || !it.mine) throw new Error('只有我的库里的技能和插件能提交')
    return lib.submit(target, it.path, `${it.kind === 'skill' ? '技能' : '插件'}：${it.name}`)
  })
  handle('lib:submissions', () => lib.submissions())
  handle('lib:pending', (id) => lib.pending(id))
  handle('lib:pendingFile', (id, ref, path) => lib.pendingFile(id, ref, path))
  handle('lib:approve', (id, ref) => lib.approve(id, ref))
  handle('lib:reject', (id, ref, reason) => lib.reject(id, ref, reason))
  handle('lib:create', (kind, prompt) => createInLibrary(kind, prompt))
  handle('skills:list', () => lib.skillCards())
  handle('update:state', () => updates.state())
  handle('update:check', () => updates.runCheck())
  handle('update:stage', () => updates.runStage())
  handle('update:apply', () => updates.apply())
  handle('skills:pin', (name, on) => lib.setPinned(String(name), !!on))
  handle('sys:openPath', async (rel) => { const err = await shell.openPath(projectPath(rel)); if (err) throw new Error(err) })
  handle('sys:showItem', (rel) => shell.showItemInFolder(projectPath(rel)))
  // 产出页：打开任意工程（不一定是当前工程）里的文件，或在资源管理器里定位；路径不许越出那个工程
  handle('sys:openIn', async (pid, rel, how) => {
    const p = store.get(pid)
    if (!p) throw new Error('工程不存在')
    const abs = resolve(p.path, String(rel || ''))
    const r = relative(p.path, abs)
    if (r.startsWith('..') || isAbsolute(r)) throw new Error('路径越出工程')
    if (!existsSync(abs)) throw new Error('文件已经不在了')
    if (how === 'show') { shell.showItemInFolder(abs); return }
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
  })
  // 皮肤：Windows 标题栏右侧的系统按钮区（最小化、关闭）跟着换底色
  handle('sys:titlebar', (c) => {
    const ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
    if (process.platform === 'win32' && win && !win.isDestroyed() && ok(c && c.color) && ok(c && c.symbolColor)) win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 48 })
  })
}

function wireController(c) {
  const active = () => c === ctl
  const tag = (n) => (active() || !c.project ? n : { ...n, title: `${c.project.name}：${n.title}` })
  c.on('state', (st) => { if (active()) send('state', st); else sendBackground() })
  c.on('activity', (items) => { if (active()) send('activity', items) })
  c.on('question', (q) => { if (active()) send('question', q); else sendBackground() })
  c.on('question-closed', (q) => { if (active()) send('question-closed', q); else sendBackground() })
  c.on('queued', (q) => { if (active()) send('queued', q) })
  c.on('warn', (w) => { mlog('warn', w); if (active()) send('warn', w) })
  c.on('task-done', (t) => {
    if (t && t.stage === 'distill') void afterDistill(t, c)
    // 后台的任务做完了：引擎先关掉（省资源，切回来追问时会重新启动并恢复会话）
    if (!active()) void c.closeEngine().catch(() => {})
  })
  c.on('state', (st) => { if (st.status === 'error') mlog('task error', c.project && c.project.name, st.error) })
  let engineSince = 0
  c.on('engine', (e) => {
    if (e.state === 'starting') engineSince = Date.now()
    mlog('engine', c.project ? c.project.name : '', e.state, e.state === 'ready' || e.state === 'error' ? `${Date.now() - engineSince} ms` : '', e.error || '', e.pid ? `pid ${e.pid}` : '')
  })
  c.on('notify', (n0) => {
    const n = tag(n0)
    send('notify', n)
    if (!win || win.isDestroyed()) return
    // 窗口不在前台时才打扰：L2 任务栏闪一次，L3 一直闪到用户回来；系统通知不出声（声音由界面按设置播放）
    if (!win.isFocused()) {
      win.flashFrame(true)
      if (n.level === 2) setTimeout(() => { if (win && !win.isDestroyed()) win.flashFrame(false) }, 3000)
      if (Notification.isSupported()) {
        const note = new Notification({ title: `AstroLab · ${n.title}`, body: n.body || '', silent: true })
        note.on('click', () => { win.show(); win.focus() })
        note.show()
      }
    }
  })
}

// 窗口和任务栏图标：Windows 用多尺寸的 .ico（任务栏 24/32 像素、Alt+Tab 48 像素各取合适的一张，不会糊），其他系统用 png。
// 由 app/scripts/make-icon.cjs 从 app/build/icon.svg 生成
function appIcon() {
  const f = join(P.appDir, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  if (existsSync(f)) return f
  mlog(`找不到应用图标 ${f}，用 Electron 默认图标`)
  return undefined
}

// Windows 任务栏不用窗口的 icon，而是按 ID 找开始菜单快捷方式，找不到就用 exe 的图标（开发时是 electron.exe，显示成 Electron 的）。
// 直接在窗口上写任务栏属性（图标 + 重新启动命令，三项都要有 Windows 才认），开发时没有快捷方式也显示自己的图标。
function setTaskbarDetails(w) {
  if (process.platform !== 'win32') return
  const icon = join(P.appDir, 'build', 'icon.ico')
  if (!existsSync(icon)) return
  const q = (x) => `"${x}"`
  const relaunchCommand = process.defaultApp ? `${q(process.execPath)} ${q(P.appDir)}` : q(process.execPath)
  try {
    w.setAppDetails({ appId: AUMID, appIconPath: icon, appIconIndex: 0, relaunchCommand, relaunchDisplayName: 'AstroLab' })
  } catch (e) { mlog('任务栏图标', e) }
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1280, minHeight: 720,
    show: false, title: 'AstroLab', backgroundColor: '#F3F1F9',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#F6F4FB', symbolColor: '#3B3946', height: 48 } : false,
    icon: appIcon(),
    webPreferences: {
      preload: join(P.appDir, 'main', 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
    },
  })
  setTaskbarDetails(win)
  win.once('ready-to-show', () => win.show())
  win.on('focus', () => win.flashFrame(false))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!(url.startsWith('file:') || (DEV_URL && url.startsWith(DEV_URL)))) e.preventDefault()
  })
  // 预览框里的页面只能停在预览地址上，不能跳去别的网址
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !e.url.startsWith(`${PREVIEW}:`) && e.url !== 'about:blank') e.preventDefault()
  })
  win.on('close', (e) => {
    if (anyBusy() && !app.isQuitting) {
      const r = dialog.showMessageBoxSync(win, {
        type: 'question', buttons: ['停止任务并退出', '取消'], defaultId: 1, cancelId: 1,
        title: 'AstroLab', message: '任务还在进行', detail: '退出会停止任务。对话和已写的文件都会保留，下次打开可以继续。',
      })
      if (r !== 0) e.preventDefault()
    }
  })
  if (DEV_URL) await win.loadURL(DEV_URL)
  else await win.loadFile(join(P.appDir, 'dist', 'index.html'))
}

function servePreview() {
  protocol.handle(PREVIEW, (req) => {
    const deny = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    try {
      const u = new URL(req.url)
      if (u.hostname !== 'project' || !ctl || !ctl.project) return deny(404, '没有打开项目')
      const rel = decodeURIComponent(u.pathname.replace(/^\//, ''))
      if (!/\.html?$/i.test(rel)) return deny(403, '只预览 HTML')
      const abs = projectPath(rel)
      if (!existsSync(abs) || statSync(abs).size > 30 * 1024 * 1024) return deny(404, '文件不存在或太大')
      return new Response(readFileSync(abs), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
    } catch (e) { return deny(403, e.message) }
  })
}

async function boot() {
  mkdirSync(P.logs, { recursive: true })
  servePreview()
  ensureLocalEnv()
  ensureShortcuts()
  prepareDshHome(P)
  bridge = new EngineBridge()
  await bridge.listen()
  store = new ProjectStore(join(P.data, 'projects.json'))
  lib = new Library({ dataDir: P.data, root: P.root })
  try { await lib.ensureMine() } catch (e) { notes.push(`我的库没有建好：${e.message}`) }
  bridge.on('hello', (h) => mlog('bridge hello', h))
  // 提问按引擎进程分给各项目的控制器；没有控制器认领的（引擎已换掉）拒绝掉，免得智能体一直等
  bridge.on('question', (q) => setImmediate(() => { if (!allCtls().some((c) => c.questions.has(q.id))) bridge.decline(q.id) }))
  ctl = newController()
  // 软件更新：更新位置是部门的共享文件夹；装好的软件才换文件（开发时只显示版本、可以检查）
  updates = new UpdateService({
    installRoot: P.installed ? resolve(P.root, '..') : null,
    stageRoot: join(P.data, 'update'),
    appVersion: app.getVersion(),
    updateDir: () => updateDirOf(readLocalEnv(P.localEnv), join(P.root, 'config', 'update.json')),
    nodeExe: P.nodePath,
    relaunchExe: P.installed ? process.execPath : '',
    isBusy: () => anyBusy(),
    beforeQuit: async () => {
      for (const c of allCtls()) { try { await c.dispose() } catch (e) { mlog('update dispose', e) } }
      try { if (bridge) await bridge.close() } catch { /* 退出前尽力而为 */ }
    },
    quit: () => app.quit(),
    onState: (s) => send('update', s),
    log: mlog,
  })
  // 资料阅读：翻译直接调部门模型（模拟引擎时用假的译文，不调模型）
  refs = new ReferenceService({
    libs: () => kbLibs(), mineDir: () => mineLib().dir, dataDir: P.data,
    model: () => {
      const env = engineEnv(P)
      const m = modelConfig(env)
      const scope = ['public', 'all'].includes(env.ASTROLAB_REFERENCE_SCOPE) ? env.ASTROLAB_REFERENCE_SCOPE : distillScope({}, m.baseURL) === 'sample' ? 'public' : 'all'
      return { baseURL: m.baseURL, apiKey: env.DEPT_LLM_API_KEY || env.DEEPSEEK_API_KEY || '', model: m.model, scope }
    },
    chat: P.mock
      ? async ({ messages }) => ({ content: messages[1].content.includes('【') ? [...messages[1].content.matchAll(/【(\d+)】([^\n]*)/g)].map((x) => `【${x[1]}】（模拟译文）${x[2].slice(0, 60)}`).join('\n\n') : '（模拟译文）' })
      : chat,
    commit: (paths, msg) => lib.commitMine(paths, msg),
    submit: (libId, rel, title) => lib.submit(libId, rel, title),
  })
  const upNote = updates.boot()
  if (upNote) bootNotes.push(upNote)
  registerIpc()
  if (!store.list().length) {
    try {
      const sample = await ensureSample(P)
      if (sample) store.add(sample, { sample: true, name: '示例工程' })
    } catch (e) { notes.push(`示例工程没有准备好：${e.message}`) }
  }
  // 新版本带来的示例文件补进已有的示例工程（不覆盖、不恢复用户删掉的）
  for (const p of store.list().filter((x) => x.sample)) {
    try {
      const added = await updateSample(P, p.path)
      if (added.length) {
        const groups = [...new Set(added.map((f) => f.split('/').slice(0, 2).join('/')))]
        bootNotes.push(`示例工程新增了 ${added.length} 个示例文件：${groups.slice(0, 4).join('、')}${groups.length > 4 ? ' 等' : ''}`)
      }
    } catch (e) { mlog('sample update', e) }
  }
  const last = store.list()[0]
  if (last) {
    try { await openProject(last.id) } catch (e) { notes.push(e.message) }
  }
  await createWindow()
  // 在 Obsidian 里改的知识条目：启动时和每 3 分钟提交一次
  void commitExternalEdits()
  setInterval(() => { void commitExternalEdits() }, 3 * 60 * 1000)
  // 启动后安静地检查一次更新（共享文件夹连不上不提示，点“检查更新”时才报错）
  setTimeout(() => { void updates.runCheck({ quiet: true }).catch((e) => mlog('update check', e)) }, 4000)
  // 共享库在后台同步（连不上内网 Git 服务器也不影响使用，状态在“知识库”和“技能与插件”里显示）
  void lib.syncAll().then(() => send('library', lib.states())).catch((e) => mlog('library sync', e))
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('before-quit', () => { app.isQuitting = true })
app.on('window-all-closed', async () => {
  for (const c of allCtls()) { try { await c.dispose() } catch { /* 退出时尽力而为 */ } }
  try { if (bridge) await bridge.close() } catch { /* 同上 */ }
  app.quit()
})
// ---------- 安装后：快捷方式、首次运行的设置文件 ----------
// 任务栏图标：Windows 按 AppUserModelID 找开始菜单里同一个 ID 的快捷方式，用它的图标和名字（没有就用 exe 的，开发时是 Electron 的）。
// 所以安装后的程序每次启动都确认开始菜单里有带 ID 和图标的快捷方式；安装脚本用 --install-shortcuts 顺带建桌面快捷方式。
function shortcutPaths() {
  return {
    menu: join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AstroLab.lnk'),
    desktop: join(app.getPath('desktop'), 'AstroLab.lnk'),
  }
}
function writeShortcut(file) {
  const icon = join(P.appDir, 'build', 'icon.ico')
  return shell.writeShortcutLink(file, existsSync(file) ? 'replace' : 'create', {
    target: process.execPath, cwd: dirname(process.execPath), description: 'AstroLab 部门研发智能体工作台',
    icon: existsSync(icon) ? icon : process.execPath, iconIndex: 0, appUserModelId: AUMID,
  })
}
function ensureShortcuts({ desktop = false } = {}) {
  if (process.platform !== 'win32' || !P.installed) return
  const s = shortcutPaths()
  try { mkdirSync(dirname(s.menu), { recursive: true }); if (!writeShortcut(s.menu)) mlog('开始菜单快捷方式没建好') } catch (e) { mlog('开始菜单快捷方式', e) }
  if (desktop) { try { writeShortcut(s.desktop) } catch (e) { mlog('桌面快捷方式', e) } }
}
/** 安装后第一次运行：用户数据目录里还没有设置文件时从示例复制（模型地址、Key 在这里填） */
function ensureLocalEnv() {
  if (!P.installed || existsSync(P.localEnv) || !existsSync(P.localEnvExample)) return
  try { mkdirSync(dirname(P.localEnv), { recursive: true }); copyFileSync(P.localEnvExample, P.localEnv); bootNotes.push(`已生成设置文件 ${P.localEnv}：填上部门模型的地址和 Key 后重启软件`) } catch (e) { mlog('local.env', e) }
}
// 安装 / 卸载脚本调用：只建（删）快捷方式，不开窗口
if (SHORTCUTS_ONLY) {
  app.whenReady().then(() => {
    if (process.argv.includes('--remove-shortcuts')) { for (const f of Object.values(shortcutPaths())) rmSync(f, { force: true }) }
    else ensureShortcuts({ desktop: true })
    app.exit(0)
  })
} else app.whenReady().then(boot).catch((e) => {
  mlog('boot failed', e)
  dialog.showErrorBox('AstroLab 启动失败', e && e.stack ? e.stack : String(e))
  app.quit()
})
