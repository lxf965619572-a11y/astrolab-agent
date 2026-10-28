// 界面与主进程之间的接口类型（与 main/preload.cjs、main/task.mjs、engine/activity.mjs 对应）。
// 在浏览器里单独打开界面时（没有 Electron），用 mock.ts 的模拟实现，便于开发和截图检查。

export type Status = 'idle' | 'starting' | 'running' | 'asking' | 'done' | 'stopped' | 'error'

export interface Project { id: string; path: string; name: string; sample?: boolean; library?: boolean; git?: boolean; branch?: string; lastOpenedAt?: number }
export interface Stage { id: string; name: string; skill: string; hasSkill: boolean; hidden?: boolean }
/** 发起任务时可选的技能（内置、已安装、我做的）；category 是研制环节类别，只用于筛选和图标 */
export interface SkillCard {
  name: string; title: string; description: string; summary?: string; category: string; icon?: string; keywords?: string[]
  source: 'builtin' | 'installed' | 'mine'; plugin?: string; pinned?: boolean
  placeholder?: string; hint?: string; report?: string
}
export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed' }

export interface Call {
  callId: string; name: string; summary: string; status: 'running' | 'done' | 'error' | 'interrupted'
  at: number; endedAt?: number; result?: string; isError?: boolean; denied?: boolean
  added?: number; removed?: number; path?: string; questions?: number; skill?: string; command?: string; hidden?: boolean
}

export type Item =
  | { id: string; kind: 'user'; at: number; text: string }
  | { id: string; kind: 'assistant'; at: number; text: string }
  | { id: string; kind: 'thinking'; at: number; ms: number | null; text: string }
  | { id: string; kind: 'tools'; at: number; group: string; calls: Call[]; denied?: boolean; hidden?: boolean; updatedAt?: number }
  | { id: string; kind: 'turn-end'; at: number; reason: string }

export interface Summary {
  steps: number; turn: number
  current: null | { kind: 'thinking' | 'tool'; since: number; name?: string; summary?: string; group?: string }
  todos: Todo[]; files: number; added: number; removed: number
  startedAt: number | null; endedAt: number | null; endReason: string | null; lastAssistantText: string
  /** 最近一次模型调用：used 是上下文大小（totalTokens）；calls 是累计调用次数 */
  usage?: Usage | null
}
export interface Usage { used: number; input: number; output: number; cacheRead: number; calls: number }

export interface Task {
  id: string; sessionId: string; stage: string; stageName: string; skill: string; skills?: string[]; category?: string; mode?: 'task' | 'code'; title: string; prompt: string
  files: string[]; startedAt: number; endedAt: number | null; status: Status
  snapshot: { commit: string; tree: string } | null
  commit: { sha: string; message: string; at: number; files: number } | null
  restoredAt?: number
  usage?: Usage | null
}

export interface QuestionItem { id: string; header?: string; question: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }
export interface Question { id: string; questions: QuestionItem[]; at: number }
export interface Answer { id: string; selected: string[]; custom?: string }

export type EngineState = 'off' | 'starting' | 'ready' | 'error'

export interface TaskState {
  project: Project | null; status: Status; error: string | null; task: Task | null; summary: Summary
  engine: { state: EngineState; error: string | null }
  questions: Question[]; queued: { id: string; text: string; at: number }[]
}

export interface AppState {
  platform: string; mock: boolean; installed: boolean
  model: { provider: string; model: string; baseURL: string; hasKey: boolean; contextWindow?: number }
  engineReady: boolean; projects: Project[]; stages: Stage[]; skills?: SkillCard[]; notes: string[]; libraryDir?: string
  task: TaskState; items: Item[]
}

export interface Change { path: string; status: 'A' | 'M' | 'D'; added: number | null; removed: number | null; binary: boolean }
export interface FileVersions { path: string; binary: boolean; before: string | null; after: string | null; existedBefore: boolean; existsNow: boolean }

export type AstroEvent =
  | { type: 'state'; payload: TaskState }
  | { type: 'activity'; payload: Item[] }
  | { type: 'question'; payload: Question }
  | { type: 'question-closed'; payload: { id: string; reason: 'answered' | 'lost' | 'aborted'; answers?: Answer[] } }
  | { type: 'queued'; payload: { id: string; text: string } }
  | { type: 'notify'; payload: { level: number; kind: 'done' | 'ask' | 'error'; title: string; body: string } }
  | { type: 'warn'; payload: string }
  | { type: 'library'; payload: LibSource[] }

export interface Mention { name: string; paths: string[] }

// ---------- 库：知识库、技能与插件 ----------
export type KbKind = '经验' | '设计' | '代码' | '问题'
export interface KbMeta { title: string; kind: KbKind; model?: string; tags: string[]; author?: string; date?: string; source?: string; status?: string }
export interface KbHit { id: string; title: string; kind: KbKind; model: string; tags: string[]; lib: string; libName: string; writable: boolean; path: string; date: string; author: string; status: string; source: string; score: number; snippet: string }
export interface KbEntry { id: string; lib: string; libName: string; writable: boolean; path: string; meta: KbMeta; body: string }
export interface LibSource { id: string; name: string; url: string; branch: string; model: string; preset: boolean; local: boolean; writable: boolean; cloned: boolean; syncing: boolean; lastSync: number | null; error: string }
export interface CatalogItem {
  key: string; kind: 'skill' | 'plugin'; name: string; title: string; description: string; version?: string; source: string; sourceName: string; path: string
  builtin?: boolean; mine?: boolean; installed: boolean; installedFrom?: string; update?: boolean; mcp?: string[]; skills?: string[]
  /** 我的库里的：和哪些共享库里的内容完全一样（不用再提交） */
  sameIn?: string[]
}
export interface Submission { branch: string; library: string; path: string; title: string; at: number; status: string }
export interface Pending { ref: string; branch: string; author: string; at: number; title: string; files: { status: string; path: string }[]; superseded?: boolean }

export interface StartInput { stage?: string; skills?: string[]; prompt: string; files: string[]; options: { report: boolean }; mode?: 'task' | 'code' }

export interface AstroApi {
  platform: string
  getState(): Promise<AppState>
  onEvent(cb: (e: AstroEvent) => void): () => void
  project: {
    open(id: string): Promise<AppState>; add(): Promise<AppState | null>; files(q: string): Promise<string[]>
    tree(): Promise<string[]>; read(path: string): Promise<{ path: string; binary: boolean; text: string | null; size: number; tooLarge?: boolean }>
    /** 一段话里提到的项目文件（按文件名匹配） */
    mentions(text: string): Promise<Mention[]>
  }
  task: {
    start(input: StartInput): Promise<Task>; send(text: string): Promise<void>; stop(): Promise<{ ms: number; unsent: string[] }>; resume(text?: string): Promise<void>
    answer(id: string, answers: Answer[]): Promise<boolean>; reset(): Promise<void>
    open(id: string): Promise<{ task: Task; items: Item[] }>; history(): Promise<Task[]>
  }
  review: {
    changes(): Promise<Change[]>; file(path: string): Promise<FileVersions>
    commit(message: string, paths?: string[]): Promise<string>; undo(): Promise<void>; restore(): Promise<number>
  }
  kb: {
    search(q: string, f?: { kind?: string; model?: string; lib?: string }): Promise<KbHit[]>; read(id: string): Promise<KbEntry>
    save(e: { id?: string; meta: KbMeta; body: string }): Promise<string>; remove(id: string): Promise<void>; publish(id: string, target: string): Promise<{ branch: string }>
  }
  skills: { list(): Promise<SkillCard[]>; pin(name: string, on: boolean): Promise<SkillCard[]> }
  lib: {
    state(): Promise<{ sources: LibSource[]; mine: string }>; sync(id?: string): Promise<LibSource[]>
    addSource(s: { name: string; url: string; branch?: string; model?: string }): Promise<LibSource[]>; removeSource(id: string): Promise<LibSource[]>
    catalog(): Promise<CatalogItem[]>; install(key: string): Promise<{ kind: string; name: string; restarted: boolean; skills?: SkillCard[] }>; uninstall(kind: string, name: string): Promise<{ restarted: boolean; skills?: SkillCard[] }>
    read(key: string): Promise<{ item: CatalogItem; text: string; readme: string }>; submit(key: string, target: string): Promise<{ branch: string }>
    submissions(): Promise<Submission[]>; pending(id: string): Promise<Pending[]>; pendingFile(id: string, ref: string, path: string): Promise<{ path: string; before: string | null; after: string | null }>
    approve(id: string, ref: string): Promise<{ branch: string; title: string; merged: boolean }>; reject(id: string, ref: string): Promise<{ branch: string; title: string; rejected: boolean }>; create(kind: 'skill' | 'plugin', prompt: string): Promise<Task>
  }
  sys: { openPath(rel: string): Promise<void>; showItem(rel: string): Promise<void>; titlebar?(c: { color: string; symbolColor: string }): Promise<void> }
}

declare global { interface Window { astro?: AstroApi } }

let api: AstroApi | null = null
export async function getApi(): Promise<AstroApi> {
  if (api) return api
  if (window.astro) api = window.astro
  else api = (await import('./mock')).createMockApi()
  return api
}
