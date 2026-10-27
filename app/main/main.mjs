// AstroLab 主进程（Electron）：窗口、项目、任务控制器、与界面之间的接口（IPC）、系统通知。
// 界面进程不接触 Node：contextIsolation + sandbox，只能调用 preload.cjs 暴露的接口；不加载任何网络内容。

import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'
import { engineEnv, modelConfig, prepareDshHome, resolvePaths } from './paths.mjs'
import { ensureSample, findMentions, listFiles, prepareProject, ProjectStore } from './projects.mjs'
import { STAGES, TaskController } from './task.mjs'
import { Library } from './library.mjs'
import { buildIndex, readEntry, search, writeEntry } from '../../mcp/knowledge/lib/kb.mjs'

const P = resolvePaths()
mkdirSync(P.data, { recursive: true })
app.setPath('userData', join(P.data, 'electron'))
app.setAppUserModelId('AstroLab')
const DEV_URL = process.env.ASTROLAB_DEV_URL || ''

if (!app.requestSingleInstanceLock()) app.quit()

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
let ctl = null
let lib = null
let notes = []

function send(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('astro:event', { type, payload })
}

// 每个项目一个引擎进程，任务之间共用；收发记录先写 engine-<时间>.jsonl，发起任务后改写到 <任务>.jsonl
function makeEngine(project) {
  const env = engineEnv(P)
  env.ASTROLAB_BRIDGE = bridge.path
  // 知识库工具服务用：我的库 + 全部共享库（还没克隆的也列上，同步后不用重启引擎就能查到）
  env.ASTROLAB_LIBRARIES = JSON.stringify(lib.sources().map((x) => ({ id: x.id, name: x.name, dir: x.dir, model: x.model || '', writable: !!x.writable })))
  const m = modelConfig(env)
  mkdirSync(P.logs, { recursive: true })
  return new Engine({
    dshBin: P.dshBin, nodePath: P.nodePath, cwd: project.path, env,
    logFile: join(P.logs, `engine-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.jsonl`),
    provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort,
    patches: P.mock ? [] : [writeEnginePatch(P.engineDir, { skillDirs: lib.skillDirs(), mcpServers: lib.mcpServers(P.nodePath) })],
  })
}

function appState() {
  const env = engineEnv(P)
  const m = modelConfig(env)
  return {
    platform: process.platform,
    mock: P.mock,
    installed: P.installed,
    model: { provider: m.provider, model: m.model, baseURL: m.baseURL, hasKey: m.hasKey },
    engineReady: P.mock || existsSync(P.dshBin),
    projects: store.list(),
    stages: STAGES.map((s) => ({ ...s, hasSkill: lib.skillDirs().some((d) => existsSync(join(d, s.skill))) })),
    libraryDir: lib.sources()[0].dir,
    notes,
    task: ctl.snapshotState(),
    items: ctl.items(),
  }
}

async function openProject(id) {
  const p = store.get(id)
  if (!p) throw new Error('项目不存在')
  if (!existsSync(p.path)) throw new Error(`项目文件夹不存在：${p.path}`)
  notes = await prepareProject(p, P)
  store.update(p.id, { ...p, lastOpenedAt: Date.now() })
  await ctl.setProject(store.get(id))
  return appState()
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
  if (ctl.busy) throw new Error('当前有任务在进行，结束后再创作')
  const dir = await lib.ensureMine()
  const p = store.findByPath(dir) || store.add(dir, { name: '我的库', library: true })
  await openProject(p.id)
  return ctl.start({ stage: kind === 'plugin' ? 'plugin' : 'skill', prompt, files: [], options: { report: false } })
}
function afterInstall() {
  const now = ctl.requestRestart()
  return { restarted: now }
}

function registerIpc() {
  handle('app:state', () => appState())
  handle('project:open', (id) => openProject(id))
  handle('project:add', async () => {
    const r = await dialog.showOpenDialog(win, { title: '打开项目文件夹', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const p = store.add(r.filePaths[0])
    return openProject(p.id)
  })
  handle('project:files', (q) => (ctl.project ? listFiles(ctl.project.path, q) : []))
  handle('project:mentions', (text) => (ctl.project ? findMentions(ctl.project.path, text) : []))
  handle('task:start', (input) => ctl.start(input))
  handle('task:send', (text) => ctl.send(text))
  handle('task:stop', () => ctl.stop())
  handle('task:resume', (text) => ctl.resume(text))
  handle('task:answer', (id, answers) => ctl.answer(id, answers))
  handle('task:new', () => ctl.reset())
  handle('task:open', (id) => ctl.openTask(id))
  handle('task:history', () => ctl.history())
  handle('review:changes', () => ctl.changes())
  handle('review:file', (path) => ctl.fileVersions(path))
  handle('review:commit', (message, paths) => ctl.commit(message, paths))
  handle('review:undoCommit', () => ctl.undoCommit())
  handle('review:restore', () => ctl.restoreSnapshot())
  handle('kb:search', (q, f) => search(buildIndex(kbLibs()), q || '', { ...(f || {}), limit: 200 }))
  handle('kb:read', (id) => readEntry(kbLibs(), id))
  handle('kb:save', (e) => kbSave(e))
  handle('kb:delete', (id) => kbDelete(id))
  handle('kb:publish', async (id, target) => { const e = readEntry(kbLibs(), id); return lib.submit(target, mineEntryPath(id), `知识：${e.meta.title || e.path}`) })
  handle('lib:state', () => ({ sources: lib.states(), mine: mineLib().dir }))
  handle('lib:sync', async (id) => { if (id) await lib.sync(id); else await lib.syncAll(); return lib.states() })
  handle('lib:addSource', async (s) => { const id = lib.addSource(s); await lib.sync(id); ctl.requestRestart(); return lib.states() })
  handle('lib:removeSource', (id) => { lib.removeSource(id); ctl.requestRestart(); return lib.states() })
  handle('lib:catalog', () => lib.catalog())
  handle('lib:install', async (key) => ({ ...(await lib.install(key)), ...afterInstall() }))
  handle('lib:uninstall', (kind, name) => { lib.uninstall(kind, name); return afterInstall() })
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
  handle('lib:reject', (id, ref) => lib.reject(id, ref))
  handle('lib:create', (kind, prompt) => createInLibrary(kind, prompt))
  handle('sys:openPath', async (rel) => { const err = await shell.openPath(projectPath(rel)); if (err) throw new Error(err) })
  handle('sys:showItem', (rel) => shell.showItemInFolder(projectPath(rel)))
  // 皮肤：Windows 标题栏右侧的系统按钮区（最小化、关闭）跟着换底色
  handle('sys:titlebar', (c) => {
    const ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
    if (process.platform === 'win32' && win && !win.isDestroyed() && ok(c && c.color) && ok(c && c.symbolColor)) win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: 48 })
  })
}

function wireController() {
  ctl.on('state', (s) => send('state', s))
  ctl.on('activity', (items) => send('activity', items))
  ctl.on('question', (q) => send('question', q))
  ctl.on('question-closed', (c) => send('question-closed', c))
  ctl.on('queued', (q) => send('queued', q))
  ctl.on('warn', (w) => { mlog('warn', w); send('warn', w) })
  ctl.on('state', (s) => { if (s.status === 'error') mlog('task error', s.error) })
  let engineSince = 0
  ctl.on('engine', (e) => {
    if (e.state === 'starting') engineSince = Date.now()
    mlog('engine', e.state, e.state === 'ready' || e.state === 'error' ? `${Date.now() - engineSince} ms` : '', e.error || '', e.pid ? `pid ${e.pid}` : '')
  })
  bridge.on('hello', (h) => mlog('bridge hello', h))
  ctl.on('notify', (n) => {
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
  win.once('ready-to-show', () => win.show())
  win.on('focus', () => win.flashFrame(false))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!(url.startsWith('file:') || (DEV_URL && url.startsWith(DEV_URL)))) e.preventDefault()
  })
  win.on('close', (e) => {
    if (ctl && ctl.busy && !app.isQuitting) {
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

async function boot() {
  mkdirSync(P.logs, { recursive: true })
  prepareDshHome(P)
  bridge = new EngineBridge()
  await bridge.listen()
  store = new ProjectStore(join(P.data, 'projects.json'))
  lib = new Library({ dataDir: P.data, root: P.root })
  try { await lib.ensureMine() } catch (e) { notes.push(`我的库没有建好：${e.message}`) }
  ctl = new TaskController({ bridge, dataDir: P.data, logDir: P.logs, skillsDir: P.skillsDir, makeEngine, knowledge: !P.mock && existsSync(join(P.root, 'mcp', 'knowledge', 'server.mjs')) })
  wireController()
  registerIpc()
  if (!store.list().length) {
    try {
      const sample = await ensureSample(P)
      if (sample) store.add(sample, { sample: true, name: '示例工程' })
    } catch (e) { notes.push(`示例工程没有准备好：${e.message}`) }
  }
  const last = store.list()[0]
  if (last) {
    try { await openProject(last.id) } catch (e) { notes.push(e.message) }
  }
  await createWindow()
  // 共享库在后台同步（连不上内网 Git 服务器也不影响使用，状态在“知识库”和“技能与插件”里显示）
  void lib.syncAll().then(() => send('library', lib.states())).catch((e) => mlog('library sync', e))
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('before-quit', () => { app.isQuitting = true })
app.on('window-all-closed', async () => {
  try { if (ctl) await ctl.dispose() } catch { /* 退出时尽力而为 */ }
  try { if (bridge) await bridge.close() } catch { /* 同上 */ }
  app.quit()
})
app.whenReady().then(boot).catch((e) => {
  mlog('boot failed', e)
  dialog.showErrorBox('AstroLab 启动失败', e && e.stack ? e.stack : String(e))
  app.quit()
})
