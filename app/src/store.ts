// 界面状态：主进程推来的任务状态和活动记录，加上界面自己的视图、提示条、设置。

import { create } from 'zustand'
import type { AppState, AstroApi, AstroEvent, Item, KbMeta, LibSource, Question, SkillCard, Stage, TaskState, Project } from './api'
import { play, setSoundSettings } from './sound'
import { modeOf, type Mode } from './modes'

// launch/task 是任务模式（新任务 / 当前任务）；code-launch/code 是代码模式（新任务 / 当前任务）；其余是两种模式共用的页面：
// project 工程主页（当前工程：新建 + 它的全部任务），projects 工程列表，history 全部任务（所有工程），settings 设置
export type View = 'launch' | 'task' | 'code-launch' | 'code' | 'review' | 'project' | 'projects' | 'history' | 'knowledge' | 'library' | 'peek' | 'settings'
export interface Toast { id: number; text: string; tone?: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void } }

export type Theme = 'lavender' | 'cream' | 'mars'
interface Settings {
  sound: boolean; volume: number; notify: boolean; theme: Theme; reviewer: boolean
  /** 侧栏宽度、是否收成图标列；代码面板宽度（都有上下限，见 components/Panels） */
  sideW: number; sideCollapsed: boolean; codeW: number
  /** 右边的面板（任务模式：进度和产出；代码模式：环境和改动）开着还是收起 */
  panel: boolean
  /** 侧栏：置顶的任务 id；折叠起来的分组（'pinned' | 'recent' | 'other'） */
  pinned: string[]; sideFold: string[]
}
/** 发起页写了一半的任务：切到别的页面再回来还在（任务进行中可以先写好下一个） */
export interface Draft { prompt: string; files: string[]; report: boolean; dismissed: string[]; skills: string[] }

function loadSettings(): Settings {
  const d: Settings = { sound: true, volume: 0.3, notify: true, theme: 'lavender', reviewer: false, sideW: 248, sideCollapsed: false, codeW: 540, panel: true, pinned: [], sideFold: [] }
  try {
    const v = { ...d, ...JSON.parse(localStorage.getItem('astrolab.settings') || '{}') }
    if (!['lavender', 'cream', 'mars'].includes(v.theme)) v.theme = v.theme === 'clay' ? 'mars' : 'lavender' // 旧的“陶土”换成“黑橙”
    const n = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def)
    v.sideW = n(v.sideW, 200, 420, 248); v.codeW = n(v.codeW, 480, 1400, 540); delete v.chatW; v.sideCollapsed = !!v.sideCollapsed; v.panel = v.panel !== false
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [])
    v.pinned = strs(v.pinned).slice(0, 50); v.sideFold = strs(v.sideFold)
    return v
  } catch { return d }
}

interface Store {
  api: AstroApi | null
  ready: boolean
  app: Omit<AppState, 'task' | 'items'> | null
  ts: TaskState | null
  items: Item[]
  index: Map<string, number>
  questions: Question[]
  view: View
  /** 只读查看的任务（当前任务进行中时看别的任务） */
  peek: null | { task: import('./api').Task; items: Item[] }
  /** 打开一个任务：当前任务进行中且不是它时只读查看，否则切换过去 */
  openTask(t: import('./api').Task): Promise<void>
  /** 切到另一个项目：它有任务（进行中或刚做完）就打开那个任务，没有就到新任务页。原项目进行中的任务在后台接着做 */
  openProject(id: string): Promise<void>
  /** 进工程主页：不是当前工程就先切过去（原工程进行中的任务在后台接着做） */
  openProjectHome(id: string): Promise<void>
  /** 侧栏：每个工作区最近的任务（按项目 id）；recentVer 变了侧栏就重新取 */
  recent: Record<string, import('./api').Task[]>
  loadRecent(): Promise<void>
  /** 打开某个工作区里的任务：不是当前工作区就先切过去 */
  openTaskIn(projectId: string, t: import('./api').Task): Promise<void>
  pinProject(id: string, on: boolean): Promise<void>
  /** 编辑对话：改名、归档、删除；改完侧栏和任务历史都重新取（histVer 加一） */
  renameTask(projectId: string, t: import('./api').Task, title: string): Promise<boolean>
  archiveTask(projectId: string, t: import('./api').Task, on: boolean): Promise<void>
  removeTask(projectId: string, t: import('./api').Task): Promise<void>
  histVer: number
  /** 搜索弹层（Ctrl K） */
  searchOpen: boolean
  setSearchOpen(on: boolean): void
  /** 设置页当前分栏 */
  settingsTab: string
  openSettings(tab?: string): void
  /** 需要确认的操作（删除）：显示一个对话框，点确定才做 */
  confirm: null | { title: string; body: string; ok: string; danger?: boolean; run: () => void | Promise<void> }
  askConfirm(c: NonNullable<Store['confirm']>): void
  closeConfirm(): void
  hideProject(id: string): Promise<void>
  /** 当前模式：跟着视图走（知识库、技能这些共用页面保持进来前的模式） */
  mode: Mode
  setMode(m: Mode): void
  draft: Draft
  chatDraft: string
  /** 知识条目编辑框：null 不显示；id 有值时是编辑我的库里的条目 */
  kbEditor: null | { id?: string; meta: KbMeta; body: string }
  libraries: LibSource[]
  kbVersion: number
  /** 资料翻译的进度（按节 id） */
  refJobs: Record<string, { done: number; total: number; at: number }>
  toasts: Toast[]
  settings: Settings
  lastError: string | null
  init(api: AstroApi): Promise<void>
  setView(v: View): void
  setDraft(d: Partial<Draft>): void
  setChatDraft(t: string): void
  openKbEditor(e: { id?: string; meta: Partial<KbMeta>; body: string }): void
  closeKbEditor(saved?: boolean): void
  toast(t: Omit<Toast, 'id'>, ms?: number): void
  dropToast(id: number): void
  setSettings(s: Partial<Settings>): void
  run<T>(f: (api: AstroApi) => Promise<T>, errPrefix?: string): Promise<T | undefined>
  applyAppState(s: AppState): void
  setSkills(skills: SkillCard[]): void
  /** 代码模式要打开的文件（从任务页点文件进来时设置） */
  codeFocus: string | null
  setCodeFocus(p: string | null): void
  openInCode(p: string): void
}

let toastSeq = 0

/** 换皮肤：根元素的 data-theme 切换颜色变量；Windows 上标题栏右侧的系统按钮区跟着换底色 */
export function applyTheme(theme: Theme) {
  const el = document.documentElement
  if (theme === 'lavender') delete el.dataset.theme
  else el.dataset.theme = theme
  const css = getComputedStyle(el)
  const color = css.getPropertyValue('--titlebar-bg').trim()
  const symbol = css.getPropertyValue('--ink-2').trim()
  try { window.astro?.sys.titlebar?.({ color, symbolColor: symbol }) } catch { /* 浏览器里没有标题栏 */ }
}

export const useStore = create<Store>((set, get) => ({
  api: null,
  ready: false,
  app: null,
  ts: null,
  items: [],
  index: new Map(),
  questions: [],
  view: 'launch',
  peek: null,
  mode: 'task',
  draft: { prompt: '', files: [], report: true, dismissed: [], skills: [] },
  chatDraft: '',
  kbEditor: null,
  libraries: [],
  kbVersion: 0,
  refJobs: {},
  toasts: [],
  settings: loadSettings(),
  lastError: null,

  async init(api) {
    set({ api })
    setSoundSettings({ enabled: get().settings.sound, volume: get().settings.volume })
    applyTheme(get().settings.theme)
    api.onEvent((e) => onEvent(e))
    const s = await api.getState()
    get().applyAppState(s)
    const m = s.task.task ? modeOf(s.task.task) : 'task'
    set({ ready: true, mode: m, view: s.task.task ? (m === 'code' ? 'code' : 'task') : 'launch' })
  },

  codeFocus: null,
  setCodeFocus(p) { set({ codeFocus: p }) },
  // 对话里点文件：代码模式在右边代码面板打开；任务模式在右边“产出”里预览
  openInCode(p) { set({ codeFocus: p }) },
  setSkills(skills) { const app = get().app; if (app) set({ app: { ...app, skills } }) },
  applyAppState(s) {
    const { task, items, ...app } = s
    const index = new Map<string, number>()
    items.forEach((it, i) => index.set(it.id, i))
    set({ app, ts: task, items, index, questions: task.questions })
  },

  async openProject(id) {
    const s = await get().run((api) => api.project.open(id), '切换项目失败')
    if (!s) return
    get().applyAppState(s)
    const t = s.task.task
    get().setView(t ? (modeOf(t) === 'code' ? 'code' : 'task') : 'launch')
  },
  async openProjectHome(id) {
    if (get().ts?.project?.id !== id) {
      await get().openProject(id)
      if (get().ts?.project?.id !== id) return
    }
    get().setView('project')
  },
  recent: {},
  async loadRecent() {
    const r = await get().api?.task.recent(12).catch(() => null)
    if (r) set({ recent: r })
  },
  async openTaskIn(projectId, t) {
    if (get().ts?.project?.id !== projectId) {
      await get().openProject(projectId)
      if (get().ts?.project?.id !== projectId) return
    }
    await get().openTask(t)
  },
  async pinProject(id, on) {
    const list = await get().run((api) => api.project.pin(id, on), on ? '置顶失败' : '取消置顶失败')
    const app = get().app
    if (list && app) set({ app: { ...app, projects: list } })
  },
  async hideProject(id) {
    const s = await get().run((api) => api.project.hide(id), '移出工作区失败')
    if (s) { get().applyAppState(s); void get().loadRecent() }
  },
  histVer: 0,
  searchOpen: false,
  setSearchOpen(on) { set({ searchOpen: on }) },
  settingsTab: 'general',
  openSettings(tab) { set({ settingsTab: tab || get().settingsTab || 'general', searchOpen: false }); get().setView('settings') },
  confirm: null,
  askConfirm(c) { set({ confirm: c }) },
  closeConfirm() { set({ confirm: null }) },
  async renameTask(pid, t, title) {
    const name = title.replace(/\s+/g, ' ').trim()
    if (!name || name === t.title) return false
    const r = await get().run((api) => api.task.rename(pid, t.id, name), '改名失败')
    if (!r) return false
    set({ histVer: get().histVer + 1 })
    void get().loadRecent()
    return true
  },
  async archiveTask(pid, t, on) {
    const r = await get().run((api) => api.task.archive(pid, t.id, on), on ? '归档失败' : '取消归档失败')
    if (!r) return
    set({ histVer: get().histVer + 1 })
    void get().loadRecent()
    if (on) get().toast({ text: `已归档：${t.title}`, tone: 'ok', action: { label: '撤销', run: () => void get().archiveTask(pid, t, false) } }, 6000)
  },
  async removeTask(pid, t) {
    const st = get()
    const wasCur = st.ts?.project?.id === pid && st.ts?.task?.id === t.id
    const ok = await st.run((api) => api.task.remove(pid, t.id), '删除失败')
    if (!ok) return
    if (wasCur) {
      const s = await get().run((api) => api.getState())
      if (s) get().applyAppState(s)
      if (['task', 'code', 'peek'].includes(get().view)) get().setView(get().mode === 'code' ? 'code-launch' : 'launch')
    } else if (get().view === 'peek' && get().peek?.task.id === t.id) get().setView(get().mode === 'code' ? 'code-launch' : 'launch')
    set({ histVer: get().histVer + 1 })
    void get().loadRecent()
    get().toast({ text: `已删除：${t.title}`, tone: 'ok' })
  },
  async openTask(t) {
    const st = get()
    const target = modeOf(t) === 'code' ? 'code' : 'task'
    const cur = st.ts?.task?.id
    if (cur === t.id) { st.setView(target); return }
    const busy = st.ts ? ['starting', 'running', 'asking'].includes(st.ts.status) : false
    if (busy) {
      const p = await st.run((api) => api.task.peek(t.id), '打不开这个任务')
      if (p) set({ peek: { task: p.task, items: p.items }, view: 'peek' })
      return
    }
    const s = await st.run(async (api) => { await api.task.open(t.id); return api.getState() }, '打不开这个任务')
    if (s) { get().applyAppState(s); get().setView(target) }
  },
  setView(v) {
    const mode: Mode = v === 'code' || v === 'code-launch' || v === 'review' ? 'code' : v === 'launch' || v === 'task' ? 'task' : get().mode
    set({ view: v === 'review' ? 'code' : v, mode })
  },
  setMode(m) {
    const t = get().ts?.task
    const cur = t && modeOf(t) === m
    get().setView(m === 'code' ? (cur ? 'code' : 'code-launch') : (cur ? 'task' : 'launch'))
  },
  setDraft(d) { set({ draft: { ...get().draft, ...d } }) },
  setChatDraft(t) { set({ chatDraft: t }) },
  openKbEditor(e) { set({ kbEditor: { id: e.id, body: e.body, meta: { title: '', kind: '经验', tags: [], ...e.meta } } }) },
  closeKbEditor(saved) { set({ kbEditor: null, kbVersion: get().kbVersion + (saved ? 1 : 0) }) },

  toast(t, ms = 4000) {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { ...t, id }] })
    setTimeout(() => get().dropToast(id), ms)
  },
  dropToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }) },

  setSettings(s) {
    const settings = { ...get().settings, ...s }
    try { localStorage.setItem('astrolab.settings', JSON.stringify(settings)) } catch { /* 存不了就只在本次有效 */ }
    setSoundSettings({ enabled: settings.sound, volume: settings.volume })
    if (s.theme) applyTheme(settings.theme)
    set({ settings })
  },

  async run(f, errPrefix) {
    const api = get().api
    if (!api) return undefined
    try { return await f(api) } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ lastError: msg })
      get().toast({ text: errPrefix ? `${errPrefix}：${msg}` : msg, tone: 'err' }, 6000)
      play('error')
      return undefined
    }
  },
}))

function upsert(items: Item[]) {
  const st = useStore.getState()
  const next = st.items.slice()
  const index = new Map(st.index)
  for (const it of items) {
    const i = index.get(it.id)
    if (i === undefined) { index.set(it.id, next.length); next.push(it) } else next[i] = it
  }
  useStore.setState({ items: next, index })
}

function onEvent(e: AstroEvent) {
  const st = useStore.getState()
  switch (e.type) {
    case 'state': {
      const prev = st.ts
      const isNewTask = prev?.task?.id !== e.payload.task?.id
      if (isNewTask) useStore.setState({ items: [], index: new Map(), chatDraft: '' })
      useStore.setState({ ts: e.payload, questions: e.payload.questions })
      // 新任务启动（不论从哪里发起）时切到它所属模式的对话
      if (isNewTask && e.payload.task && e.payload.status === 'starting') useStore.getState().setView(modeOf(e.payload.task) === 'code' ? 'code' : 'task')
      break
    }
    case 'activity': upsert(e.payload); break
    case 'question': useStore.setState({ questions: [...st.questions.filter((q) => q.id !== e.payload.id), e.payload] }); break
    case 'question-closed': {
      useStore.setState({ questions: st.questions.filter((q) => q.id !== e.payload.id) })
      // 停止（aborted）时停止的提示已经说明；引擎意外退出（lost）才单独提示
      if (e.payload.reason === 'lost') st.toast({ text: '引擎退出了，刚才的问题失效。继续后可以直接在输入框里回答', tone: 'info' }, 6000)
      break
    }
    case 'queued': break
    case 'background': if (st.app) useStore.setState({ app: { ...st.app, background: e.payload } }); break
    case 'notify': {
      if (e.payload.kind === 'done') play('done')
      else if (e.payload.kind === 'ask') play('ask')
      else if (e.payload.kind === 'error') play('error')
      if (e.payload.kind === 'done') st.toast({ text: `${e.payload.title}，改动等你审核`, tone: 'ok' }, 6000)
      break
    }
    case 'warn': st.toast({ text: e.payload, tone: 'err' }); break
    case 'library': useStore.setState({ libraries: e.payload, kbVersion: st.kbVersion + 1 }); break
    case 'update': if (st.app) useStore.setState({ app: { ...st.app, update: e.payload } }); break
    case 'ref-translate': { const j = { ...st.refJobs }; if (e.payload.job) j[e.payload.id] = e.payload.job; else delete j[e.payload.id]; useStore.setState({ refJobs: j }); break }
  }
}

export const selectStage = (stages: Stage[] | undefined, id: string | undefined) => stages?.find((s) => s.id === id)
export const projectLabel = (p: Project | null | undefined) => (p ? p.name : '未打开项目')
