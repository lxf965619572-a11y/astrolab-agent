// 任务控制器：一个项目同一时间一个任务。负责引擎进程的生命周期、任务状态、活动记录、提问、快照和审核数据。
// 与 Electron 无关，可以用模拟引擎直接测试；主进程把这里发出的事件转给界面。
//
// 状态：idle（没有任务）→ starting → running ⇄ asking → done（做完，待审核）
//                                  ↘ stopped（用户停止，可继续）  ↘ error（引擎出错，可继续）
// 事件：state（整体状态）、activity（新增或变化的活动记录）、question、question-closed、queued、notify
//
// 引擎：每个项目一个 DSH 进程，打开项目时就在后台启动（冷启动可能几十秒，藏在写任务的时间里），任务之间共用。
//   插话、继续：经引擎桥 steer，下一步之前送到（桥不可用时用 session/prompt，排到下一轮）
//   停止：经引擎桥 cancel，只中止当前轮，引擎不退出；桥不可用或 3 秒内停不下来，才结束进程
//   引擎意外退出后，下次用到时重启，并用 session/resume 恢复会话

import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { applyEvent, createActivity, plainItem, summarize } from '../engine/activity.mjs'
import * as git from './git.mjs'

export const STAGES = [
  { id: 'requirements', name: '需求分析', skill: 'requirements-analysis' },
  { id: 'hld', name: '概要设计', skill: 'preliminary-design' },
  { id: 'dd', name: '详细设计', skill: 'detailed-design' },
  { id: 'coding', name: '编码', skill: 'coding' },
  { id: 'utest', name: '单元测试', skill: 'unit-test-design' },
  { id: 'review', name: '代码走查', skill: 'code-walkthrough' },
]

const RESUME_TEXT = '刚才的任务被中断了，请从中断的地方接着做；已经完成的步骤不要重做。'

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export class TaskController extends EventEmitter {
  /**
   * @param {object} o
   * @param {(project: object) => import('../engine/engine.mjs').Engine} o.makeEngine
   * @param {import('../engine/engine.mjs').EngineBridge} o.bridge
   * @param {string} o.dataDir    任务记录保存在 <dataDir>/projects/<项目>/tasks
   * @param {string} [o.logDir]   引擎收发记录 <logDir>/<任务>.jsonl
   * @param {string} [o.skillsDir] 判断技能是否存在
   * @param {boolean} [o.warm]    打开项目时就在后台启动引擎（默认是）
   */
  constructor(o) {
    super()
    this.o = o
    this.project = null
    this.engine = null
    this.engineStarting = null // 正在启动的 Promise
    this.engineState = 'off' // off / starting / ready / error
    this.engineError = null
    this.liveSessions = new Set() // 在当前引擎进程里已打开的会话
    this.task = null
    this.activity = createActivity()
    this.status = 'idle'
    this.error = null
    this.questions = new Map()
    this.queued = [] // 已发出、智能体还没接收的插话 { id, messageId?, text, at }
    this.stopping = false
    this.idleWaiters = []
    o.bridge.on('question', (q) => this.onQuestion(q))
    o.bridge.on('abort', (m) => this.closeQuestion(m.id, 'aborted'))
    o.bridge.on('lost', (m) => this.closeQuestion(m.id, 'lost'))
  }

  // ---------- 状态 ----------
  snapshotState() {
    return {
      project: this.project,
      status: this.status,
      error: this.error,
      task: this.task && { ...this.task },
      engine: { state: this.engineState, error: this.engineError },
      summary: summarize(this.activity),
      questions: [...this.questions.values()],
      queued: this.queued.map((q) => ({ id: q.id, text: q.text, at: q.at })),
    }
  }

  setStatus(s, error = null) {
    this.status = s
    this.error = error
    if (this.task) this.task.status = s
    this.emit('state', this.snapshotState())
  }

  get busy() { return ['starting', 'running', 'asking'].includes(this.status) }

  async setProject(project) {
    if (this.busy) throw new Error('任务进行中，不能切换项目')
    const same = this.project && project && this.project.path === project.path
    if (!same) await this.closeEngine()
    this.project = project
    this.task = null
    this.activity = createActivity()
    this.questions.clear()
    this.queued = []
    this.setStatus('idle')
    if (this.o.warm !== false) this.warm()
  }

  // ---------- 引擎 ----------
  setEngine(state, error = null) {
    this.engineState = state
    this.engineError = error
    this.emit('engine', { state, error, pid: this.engine && this.engine.pid })
    this.emit('state', this.snapshotState())
  }

  /** 在后台把引擎准备好（失败不抛出，开始任务时会再试） */
  warm() {
    if (!this.project) return
    this.ensureEngine().catch(() => { /* 状态里有错误信息 */ })
  }

  /** 返回可用的引擎；没有就启动一个（并发调用共用同一次启动） */
  ensureEngine() {
    if (this.engine && this.engine.alive && this.engineState === 'ready') return Promise.resolve(this.engine)
    if (this.engineStarting) return this.engineStarting
    if (!this.project) return Promise.reject(new Error('还没有打开项目'))
    const eng = this.o.makeEngine(this.project)
    if (this.task) eng.o.logFile = this.logFile(this.task)
    eng.on('session.event', (p) => this.onEvent(p))
    eng.on('session.status', (p) => this.onStatus(p))
    eng.on('exit', () => this.onExit(eng))
    this.engine = eng
    this.liveSessions = new Set()
    this.setEngine('starting')
    const p = (async () => {
      try {
        await eng.start()
        // 引擎桥插件在加载阶段就连上，通常已经到了；等不到也能用（插话排到下一轮、停止结束进程）
        if (this.o.bridge.waitFor) await this.o.bridge.waitFor(eng.pid, 3000)
        if (this.engine !== eng) throw new Error('引擎已关闭')
        this.setEngine('ready')
        return eng
      } catch (e) {
        if (this.engine === eng) {
          this.engine = null
          this.setEngine('error', e.message + (eng.stderrTail ? `。最后的输出：${eng.stderrTail.slice(-300)}` : ''))
        }
        if (eng.alive) await eng.kill().catch(() => {})
        throw e
      } finally {
        if (this.engineStarting === p) this.engineStarting = null
      }
    })()
    this.engineStarting = p
    return p
  }

  async closeEngine() {
    const eng = this.engine
    this.engine = null
    this.engineStarting = null
    this.liveSessions = new Set()
    if (eng && eng.alive) await eng.shutdown(5000)
    if (this.engineState !== 'off') this.setEngine('off')
  }

  logFile(task) { return this.o.logDir ? join(this.o.logDir, `${task.id}.jsonl`) : undefined }

  get canSteer() { return !!(this.engine && this.o.bridge.has && this.o.bridge.has(this.engine.pid, 'steer')) }

  /** 把一句话交给智能体：桥可用时 steer（下一步之前送到，空闲时唤醒），否则 session/prompt（排到下一轮） */
  async deliver(text) {
    const eng = await this.ensureEngine()
    const sid = this.task.sessionId
    if (!this.liveSessions.has(sid)) {
      if (this.task.firstSent) await eng.resume(sid)
      this.liveSessions.add(sid)
    }
    if (!this.task.firstSent) {
      // 发起时还没送出第一条（例如引擎启动中就停止了）：先补发第一条，这句话等第一条被接收后再送
      const r = await eng.prompt(sid, this.task.firstMessage)
      this.task.firstSent = true
      this.task.firstMessageId = r && r.messageId
      if (text !== RESUME_TEXT) {
        const q = { id: `q${Date.now()}`, messageId: null, text, at: Date.now() }
        this.queued.push(q)
        ;(this.early ||= []).push(q)
        this.emit('queued', { id: q.id, text })
      }
      return r
    }
    if (this.canSteer) {
      try { return await this.o.bridge.steer(eng.pid, sid, text) } catch { /* 退回 session/prompt */ }
    }
    return eng.prompt(sid, text)
  }

  onEvent(p) {
    if (!this.task || p.sessionId !== this.task.sessionId) return
    const ev = p.event
    if (ev.type === 'user/message' && ev.data && ev.data.source && ev.data.source.kind === 'user') {
      // 插话被智能体接收：从“已排队”移到对话里
      const id = ev.data.id
      this.queued = this.queued.filter((q) => q.messageId !== id)
      // 第一条被接收后，再送启动中写下的插话（太早送会排在第一条前面）
      if (id && id === this.task.firstMessageId) this.flushEarly()
    }
    const changed = applyEvent(this.activity, ev)
    // 发给智能体的第一条消息带了环节、技能、约定等说明；对话里只显示用户自己写的那句
    for (const it of changed) {
      if (it.kind === 'user' && this.task.firstMessage && it.text.trim() === this.task.firstMessage.trim()) it.text = this.task.prompt
      else if (it.kind === 'user' && it.text === RESUME_TEXT) it.text = '继续'
    }
    if (changed.length) this.emit('activity', changed.map(plainItem))
    if (['turn/start', 'step/start', 'tool/call', 'tool/result', 'turn/end', 'user/message'].includes(ev.type)) {
      this.emit('state', this.snapshotState())
    }
  }

  onStatus(p) {
    if (!this.task || p.sessionId !== this.task.sessionId) return
    if (p.status === 'idle') { const w = this.idleWaiters; this.idleWaiters = []; w.forEach((f) => f()) }
    if (this.stopping) return
    if (p.status === 'running') {
      if (this.status !== 'asking') this.setStatus('running')
    } else if (p.status === 'idle' && this.busy && this.status !== 'starting') {
      this.task.endedAt = Date.now()
      this.setStatus('done')
      this.save()
      this.emit('notify', { level: 2, kind: 'done', title: `${this.task.stageName}完成`, body: summarize(this.activity).lastAssistantText.slice(0, 120) })
    }
  }

  onExit(eng) {
    if (eng !== this.engine) return
    this.engine = null
    this.liveSessions = new Set()
    this.setEngine('off')
    for (const id of [...this.questions.keys()]) this.closeQuestion(id, 'lost')
    if (this.stopping) return
    if (this.busy) {
      this.setStatus('error', `引擎进程意外退出。${eng.stderrTail ? `最后的输出：${eng.stderrTail.slice(-400)}` : ''}`)
      this.save()
      this.emit('notify', { level: 3, kind: 'error', title: '任务中断', body: '引擎进程意外退出，对话和已写的文件都保留，可以继续' })
    }
  }

  // ---------- 任务 ----------
  composeFirstMessage(t) {
    const hasSkill = !this.o.skillsDir || existsSync(join(this.o.skillsDir, t.skill))
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // 约定放最前面：放在末尾时智能体的第一句话仍是英文
    const parts = [`【约定】全程用中文回复。今天是 ${today}。需要我拍板时用 ask_user_question 提问，不要猜；不要提交或推送 Git，改动由我在工作台审核后提交。`, `【环节】${t.stageName}`]
    if (t.skill && hasSkill) parts.push(`请先用 skill 工具加载技能 ${t.skill}，按技能的步骤完成。`)
    parts.push(`【要求】${t.prompt}`)
    if (t.files && t.files.length) parts.push(`【相关文件】\n${t.files.map((f) => `- ${f}`).join('\n')}`)
    if (t.options && t.options.report === false) parts.push('这次不需要生成 Word 报告。')
    return parts.join('\n\n')
  }

  /** 发起任务：{ stage, prompt, files?, options? } */
  async start(input) {
    if (!this.project) throw new Error('还没有打开项目')
    if (this.busy) throw new Error('已有任务在进行')
    const stage = STAGES.find((s) => s.id === input.stage) || STAGES[4]
    const prompt = String(input.prompt || '').trim()
    if (!prompt) throw new Error('请写一句要做什么')
    const id = `t-${stamp()}-${randomBytes(2).toString('hex')}`
    this.task = {
      id, sessionId: id, stage: stage.id, stageName: stage.name, skill: stage.skill,
      title: prompt.split('\n')[0].slice(0, 60), prompt, files: input.files || [], options: input.options || {},
      startedAt: Date.now(), endedAt: null, status: 'starting', snapshot: null, commit: null,
      firstSent: false, firstMessageId: null,
    }
    this.task.firstMessage = this.composeFirstMessage(this.task)
    this.activity = createActivity()
    this.questions.clear()
    this.queued = []
    this.early = []
    this.setStatus('starting')
    try {
      if (await git.isRepo(this.project.path)) this.task.snapshot = await git.snapshot(this.project.path, id)
    } catch (e) { this.task.snapshotError = e.message }
    const task = this.task
    try {
      const eng = await this.ensureEngine()
      if (this.task !== task || this.status !== 'starting') return task // 启动中被停止
      eng.o.logFile = this.logFile(task)
      const r = await eng.prompt(task.sessionId, task.firstMessage)
      task.firstSent = true
      task.firstMessageId = r && r.messageId
      this.liveSessions.add(task.sessionId)
      if (this.status === 'starting') this.setStatus('running')
      this.save()
    } catch (e) {
      if (this.task !== task || this.status === 'stopped') return task
      this.setStatus('error', `引擎启动失败：${e.message}`)
      this.save()
      throw e
    }
    return task
  }

  /** 启动中写下的插话：第一条被接收后再送 */
  async flushEarly() {
    const early = this.early || []
    this.early = []
    for (const q of early) {
      try {
        const r = await this.deliver(q.text)
        q.messageId = r && r.messageId
      } catch (e) { this.emit('warn', `插话没有送到：${e.message}`) }
    }
  }

  /** 插话或追问：运行中下一步之前送到；已停止或出错时接着做 */
  async send(text) {
    text = String(text || '').trim()
    if (!text || !this.task) return
    if (this.status === 'starting' && !this.task.firstSent) {
      const q = { id: `q${Date.now()}`, messageId: null, text, at: Date.now() }
      this.queued.push(q)
      ;(this.early ||= []).push(q)
      this.emit('queued', { id: q.id, text })
      this.emit('state', this.snapshotState())
      return
    }
    if (!this.busy) return this.resume(text)
    const r = await this.deliver(text)
    const q = { id: `q${Date.now()}`, messageId: r && r.messageId, text, at: Date.now() }
    this.queued.push(q)
    this.emit('queued', { id: q.id, text })
    this.emit('state', this.snapshotState())
  }

  /** 停止：只中止当前这一轮，对话和已写的文件都保留。返回 { ms, unsent }：unsent 是还没送到的插话，界面放回输入框 */
  async stop() {
    if (!this.task || !this.busy) return { ms: 0, unsent: [] }
    const t0 = Date.now()
    const unsent = this.queued.map((q) => q.text)
    this.stopping = true
    try {
      const eng = this.engine
      if (this.status === 'starting' && !this.task.firstSent) {
        // 引擎还在启动：放弃这次发起，引擎接着启动（下次用）
      } else if (eng && eng.alive && this.o.bridge.has && this.o.bridge.has(eng.pid, 'cancel')) {
        const idle = new Promise((r) => { this.idleWaiters.push(r) })
        let ok = false
        try {
          const r = await this.o.bridge.cancel(eng.pid, this.task.sessionId)
          // 智能体本来就空闲（例如刚好做完）就不用等
          ok = !r.wasRunning || await Promise.race([idle.then(() => true), new Promise((res) => setTimeout(() => res(false), 3000))])
        } catch { ok = false }
        if (!ok) await this.killEngine()
      } else if (eng) {
        await this.killEngine()
      }
    } finally {
      this.stopping = false
    }
    for (const id of [...this.questions.keys()]) this.closeQuestion(id, 'aborted')
    this.queued = []
    this.early = []
    this.activity.current = null
    for (const { item, call } of this.activity.calls.values()) {
      if (call.status === 'running') { call.status = 'interrupted'; this.emit('activity', [plainItem(item)]) }
    }
    this.setStatus('stopped')
    this.save()
    return { ms: Date.now() - t0, unsent }
  }

  /** 结束引擎进程树（停止的最后手段），然后在后台重启，下次继续不用等 */
  async killEngine() {
    const eng = this.engine
    if (!eng) return
    await eng.kill()
    if (this.engine === eng) { this.engine = null; this.liveSessions = new Set(); this.setEngine('off') }
    this.warm()
  }

  /** 继续：接着做（引擎不在就重启并恢复会话），可以带一句话（默认让它从中断处接着做） */
  async resume(text) {
    if (!this.task) throw new Error('没有可继续的任务')
    if (this.busy) return this.send(text)
    const prev = this.status
    this.setStatus('starting')
    try {
      const eng = await this.ensureEngine()
      if (this.status !== 'starting') return // 引擎启动中被停止
      eng.o.logFile = this.logFile(this.task)
      await this.deliver(text || RESUME_TEXT)
      if (this.status === 'starting') this.setStatus('running')
    } catch (e) {
      if (this.status === 'stopped') return
      this.setStatus('error', `${prev === 'done' ? '发送失败' : '继续失败'}：${e.message}`)
      throw e
    }
  }

  // ---------- 提问 ----------
  onQuestion(q) {
    if (!this.task || (q.session && q.session !== this.task.sessionId)) return this.o.bridge.decline(q.id)
    const item = { id: q.id, questions: q.questions || [], at: Date.now() }
    this.questions.set(q.id, item)
    this.setStatus('asking')
    this.emit('question', item)
    this.emit('notify', { level: 3, kind: 'ask', title: '需要你决定', body: (item.questions[0] && item.questions[0].question) || '' })
  }

  answer(id, answers) {
    const ok = this.o.bridge.answer(id, answers)
    this.closeQuestion(id, ok ? 'answered' : 'lost', answers)
    return ok
  }

  closeQuestion(id, reason, answers) {
    if (!this.questions.has(id)) return
    this.questions.delete(id)
    this.emit('question-closed', { id, reason, answers })
    if (this.status === 'asking' && this.questions.size === 0 && !this.stopping) this.setStatus(this.engine && this.engine.alive ? 'running' : this.status)
  }

  // ---------- 审核 ----------
  async changes() {
    if (!this.task || !this.task.snapshot) return []
    return git.changes(this.project.path, this.task.snapshot.tree)
  }

  async fileVersions(path) {
    if (!this.task || !this.task.snapshot) throw new Error('这个任务没有快照')
    return git.fileVersions(this.project.path, this.task.snapshot.tree, path)
  }

  async restoreSnapshot() {
    if (this.busy) throw new Error('任务进行中，先停止再恢复')
    if (!this.task || !this.task.snapshot) throw new Error('这个任务没有快照')
    const n = await git.restore(this.project.path, this.task.snapshot.tree)
    this.task.restoredAt = Date.now()
    this.save()
    this.emit('state', this.snapshotState())
    return n
  }

  async commit(message, paths) {
    if (this.busy) throw new Error('任务进行中，等它做完再提交')
    const list = paths && paths.length ? paths : (await this.changes()).map((c) => c.path)
    const sha = await git.commit(this.project.path, message, list)
    this.task.commit = { sha, message, at: Date.now(), files: list.length }
    this.save()
    this.emit('state', this.snapshotState())
    return sha
  }

  async undoCommit() {
    if (!this.task || !this.task.commit) throw new Error('没有可撤销的提交')
    await git.undoCommit(this.project.path, this.task.commit.sha)
    this.task.commit = null
    this.save()
    this.emit('state', this.snapshotState())
  }

  // ---------- 记录 ----------
  tasksDir(projectId = this.project && this.project.id) {
    return join(this.o.dataDir, 'projects', projectId, 'tasks')
  }

  save() {
    if (!this.task || !this.project) return
    try {
      const dir = this.tasksDir()
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${this.task.id}.json`), JSON.stringify({ task: this.task, items: this.activity.items.map(plainItem) }, null, 1))
    } catch (e) { this.emit('warn', `保存任务记录失败：${e.message}`) }
  }

  history(limit = 50) {
    if (!this.project) return []
    const dir = this.tasksDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit).map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), 'utf8')).task } catch { return null }
    }).filter(Boolean)
  }

  /** 打开历史任务（只读查看；继续对话时恢复会话） */
  async openTask(id) {
    if (this.busy) throw new Error('任务进行中')
    const f = join(this.tasksDir(), `${id}.json`)
    const rec = JSON.parse(readFileSync(f, 'utf8'))
    this.task = rec.task
    if (this.task.firstSent === undefined) this.task.firstSent = true // 旧记录
    this.activity = createActivity()
    for (const it of rec.items) { this.activity.items.push(it); this.activity.byId.set(it.id, it) }
    this.activity.seq = rec.items.length + 1000
    this.questions.clear()
    this.queued = []
    this.status = ['running', 'asking', 'starting'].includes(rec.task.status) ? 'stopped' : rec.task.status
    this.emit('state', this.snapshotState())
    return { task: this.task, items: rec.items }
  }

  /** 回到“发起任务”：当前任务已结束或已停止时清空（记录已保存） */
  async reset() {
    if (this.busy) throw new Error('任务进行中，先停止')
    this.save()
    this.task = null
    this.activity = createActivity()
    this.questions.clear()
    this.queued = []
    this.setStatus('idle')
  }

  items() { return this.activity.items.map(plainItem) }

  async dispose() {
    this.stopping = true
    await this.closeEngine()
  }
}
