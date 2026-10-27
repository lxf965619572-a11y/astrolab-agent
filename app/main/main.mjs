// AstroLab 主进程（Electron）：窗口、项目、任务控制器、与界面之间的接口（IPC）、系统通知。
// 界面进程不接触 Node：contextIsolation + sandbox，只能调用 preload.cjs 暴露的接口；不加载任何网络内容。

import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'
import { engineEnv, modelConfig, prepareDshHome, resolvePaths } from './paths.mjs'
import { ensureSample, findMentions, listFiles, prepareProject, ProjectStore } from './projects.mjs'
import { STAGES, TaskController } from './task.mjs'

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
let notes = []

function send(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('astro:event', { type, payload })
}

// 每个项目一个引擎进程，任务之间共用；收发记录先写 engine-<时间>.jsonl，发起任务后改写到 <任务>.jsonl
function makeEngine(project) {
  const env = engineEnv(P)
  env.ASTROLAB_BRIDGE = bridge.path
  const m = modelConfig(env)
  mkdirSync(P.logs, { recursive: true })
  return new Engine({
    dshBin: P.dshBin, nodePath: P.nodePath, cwd: project.path, env,
    logFile: join(P.logs, `engine-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.jsonl`),
    provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort,
    patches: P.mock ? [] : [writeEnginePatch(P.engineDir)],
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
    stages: STAGES.map((s) => ({ ...s, hasSkill: existsSync(join(P.skillsDir, s.skill)) })),
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
  handle('sys:openPath', async (rel) => { const err = await shell.openPath(projectPath(rel)); if (err) throw new Error(err) })
  handle('sys:showItem', (rel) => shell.showItemInFolder(projectPath(rel)))
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1280, minHeight: 720,
    show: false, title: 'AstroLab', backgroundColor: '#F3F1F9',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#F6F4FB', symbolColor: '#3B3946', height: 48 } : false,
    icon: existsSync(join(P.appDir, 'build', 'icon.png')) ? join(P.appDir, 'build', 'icon.png') : undefined,
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
  ctl = new TaskController({ bridge, dataDir: P.data, logDir: P.logs, skillsDir: P.skillsDir, makeEngine })
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
