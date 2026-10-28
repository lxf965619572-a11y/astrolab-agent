// 界面状态：主进程推来的任务状态和活动记录，加上界面自己的视图、提示条、设置。

import { create } from 'zustand'
import type { AppState, AstroApi, AstroEvent, Item, KbMeta, LibSource, Question, SkillCard, Stage, TaskState, Project } from './api'
import { play, setSoundSettings } from './sound'
import { modeOf, type Mode } from './modes'

// launch/task 是任务模式（新任务 / 当前任务）；code-launch/code 是代码模式（新任务 / 当前任务）；其余是两种模式共用的页面
export type View = 'launch' | 'task' | 'code-launch' | 'code' | 'review' | 'history' | 'knowledge' | 'library'
export interface Toast { id: number; text: string; tone?: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void } }

export type Theme = 'lavender' | 'cream' | 'mars'
interface Settings {
  sound: boolean; volume: number; notify: boolean; theme: Theme; reviewer: boolean
  /** 侧栏宽度、是否收成图标列；代码面板宽度（都有上下限，见 components/Panels） */
  sideW: number; sideCollapsed: boolean; codeW: number
  /** 右边的面板（任务模式：进度和产出；代码模式：环境和改动）开着还是收起 */
  panel: boolean
}
/** 发起页写了一半的任务：切到别的页面再回来还在（任务进行中可以先写好下一个） */
export interface Draft { prompt: string; files: string[]; report: boolean; dismissed: string[]; skills: string[] }

function loadSettings(): Settings {
  const d: Settings = { sound: true, volume: 0.3, notify: true, theme: 'lavender', reviewer: false, sideW: 248, sideCollapsed: false, codeW: 540, panel: true }
  try {
    const v = { ...d, ...JSON.parse(localStorage.getItem('astrolab.settings') || '{}') }
    if (!['lavender', 'cream', 'mars'].includes(v.theme)) v.theme = v.theme === 'clay' ? 'mars' : 'lavender' // 旧的“陶土”换成“黑橙”
    const n = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def)
    v.sideW = n(v.sideW, 200, 420, 248); v.codeW = n(v.codeW, 480, 1400, 540); delete v.chatW; v.sideCollapsed = !!v.sideCollapsed; v.panel = v.panel !== false
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
  /** 当前模式：跟着视图走（知识库、技能这些共用页面保持进来前的模式） */
  mode: Mode
  setMode(m: Mode): void
  draft: Draft
  chatDraft: string
  /** 知识条目编辑框：null 不显示；id 有值时是编辑我的库里的条目 */
  kbEditor: null | { id?: string; meta: KbMeta; body: string }
  libraries: LibSource[]
  kbVersion: number
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
  mode: 'task',
  draft: { prompt: '', files: [], report: true, dismissed: [], skills: [] },
  chatDraft: '',
  kbEditor: null,
  libraries: [],
  kbVersion: 0,
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
    case 'notify': {
      if (e.payload.kind === 'done') play('done')
      else if (e.payload.kind === 'ask') play('ask')
      else if (e.payload.kind === 'error') play('error')
      if (e.payload.kind === 'done') st.toast({ text: `${e.payload.title}，改动等你审核`, tone: 'ok' }, 6000)
      break
    }
    case 'warn': st.toast({ text: e.payload, tone: 'err' }); break
    case 'library': useStore.setState({ libraries: e.payload, kbVersion: st.kbVersion + 1 }); break
  }
}

export const selectStage = (stages: Stage[] | undefined, id: string | undefined) => stages?.find((s) => s.id === id)
export const projectLabel = (p: Project | null | undefined) => (p ? p.name : '未打开项目')
