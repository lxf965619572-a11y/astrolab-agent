// 界面状态：主进程推来的任务状态和活动记录，加上界面自己的视图、提示条、设置。

import { create } from 'zustand'
import type { AppState, AstroApi, AstroEvent, Item, Question, Stage, TaskState, Project } from './api'
import { play, setSoundSettings } from './sound'

export type View = 'launch' | 'task' | 'review' | 'history'
export interface Toast { id: number; text: string; tone?: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void } }

interface Settings { sound: boolean; volume: number; notify: boolean }
/** 发起页写了一半的任务：切到别的页面再回来还在（任务进行中可以先写好下一个） */
export interface Draft { prompt: string; files: string[]; report: boolean; dismissed: string[] }

function loadSettings(): Settings {
  try { return { sound: true, volume: 0.3, notify: true, ...JSON.parse(localStorage.getItem('astrolab.settings') || '{}') } } catch { return { sound: true, volume: 0.3, notify: true } }
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
  launchStage: string
  draft: Draft
  chatDraft: string
  toasts: Toast[]
  settings: Settings
  lastError: string | null
  init(api: AstroApi): Promise<void>
  setView(v: View): void
  setLaunchStage(id: string): void
  setDraft(d: Partial<Draft>): void
  setChatDraft(t: string): void
  toast(t: Omit<Toast, 'id'>, ms?: number): void
  dropToast(id: number): void
  setSettings(s: Partial<Settings>): void
  run<T>(f: (api: AstroApi) => Promise<T>, errPrefix?: string): Promise<T | undefined>
  applyAppState(s: AppState): void
}

let toastSeq = 0

export const useStore = create<Store>((set, get) => ({
  api: null,
  ready: false,
  app: null,
  ts: null,
  items: [],
  index: new Map(),
  questions: [],
  view: 'launch',
  launchStage: 'utest',
  draft: { prompt: '', files: [], report: true, dismissed: [] },
  chatDraft: '',
  toasts: [],
  settings: loadSettings(),
  lastError: null,

  async init(api) {
    set({ api })
    setSoundSettings({ enabled: get().settings.sound, volume: get().settings.volume })
    api.onEvent((e) => onEvent(e))
    const s = await api.getState()
    get().applyAppState(s)
    set({ ready: true, view: s.task.task ? 'task' : 'launch' })
  },

  applyAppState(s) {
    const { task, items, ...app } = s
    const index = new Map<string, number>()
    items.forEach((it, i) => index.set(it.id, i))
    set({ app, ts: task, items, index, questions: task.questions })
  },

  setView(v) { set({ view: v }) },
  setLaunchStage(id) { set({ launchStage: id }) },
  setDraft(d) { set({ draft: { ...get().draft, ...d } }) },
  setChatDraft(t) { set({ chatDraft: t }) },

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
      // 新任务启动（不论从哪里发起）时切到任务页
      if (isNewTask && e.payload.task && e.payload.status === 'starting') useStore.setState({ view: 'task' })
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
      if (e.payload.kind === 'done') st.toast({ text: `${e.payload.title}，改动等你审核`, tone: 'ok', action: { label: '去审核', run: () => useStore.getState().setView('review') } }, 6000)
      break
    }
    case 'warn': st.toast({ text: e.payload, tone: 'err' }); break
  }
}

export const selectStage = (stages: Stage[] | undefined, id: string | undefined) => stages?.find((s) => s.id === id)
export const projectLabel = (p: Project | null | undefined) => (p ? p.name : '未打开项目')
