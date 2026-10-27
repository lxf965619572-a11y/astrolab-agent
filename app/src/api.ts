// 界面与主进程之间的接口类型（与 main/preload.cjs、main/task.mjs、engine/activity.mjs 对应）。
// 在浏览器里单独打开界面时（没有 Electron），用 mock.ts 的模拟实现，便于开发和截图检查。

export type Status = 'idle' | 'starting' | 'running' | 'asking' | 'done' | 'stopped' | 'error'

export interface Project { id: string; path: string; name: string; sample?: boolean; git?: boolean; branch?: string; lastOpenedAt?: number }
export interface Stage { id: string; name: string; skill: string; hasSkill: boolean }
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
}

export interface Task {
  id: string; sessionId: string; stage: string; stageName: string; skill: string; title: string; prompt: string
  files: string[]; startedAt: number; endedAt: number | null; status: Status
  snapshot: { commit: string; tree: string } | null
  commit: { sha: string; message: string; at: number; files: number } | null
  restoredAt?: number
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
  model: { provider: string; model: string; baseURL: string; hasKey: boolean }
  engineReady: boolean; projects: Project[]; stages: Stage[]; notes: string[]
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

export interface Mention { name: string; paths: string[] }

export interface StartInput { stage: string; prompt: string; files: string[]; options: { report: boolean } }

export interface AstroApi {
  platform: string
  getState(): Promise<AppState>
  onEvent(cb: (e: AstroEvent) => void): () => void
  project: {
    open(id: string): Promise<AppState>; add(): Promise<AppState | null>; files(q: string): Promise<string[]>
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
  sys: { openPath(rel: string): Promise<void>; showItem(rel: string): Promise<void> }
}

declare global { interface Window { astro?: AstroApi } }

let api: AstroApi | null = null
export async function getApi(): Promise<AstroApi> {
  if (api) return api
  if (window.astro) api = window.astro
  else api = (await import('./mock')).createMockApi()
  return api
}
