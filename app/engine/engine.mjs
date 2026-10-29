// AstroLab 引擎层：拉起 DSH 的 sdk 模式（`dsh --profile sdk`），在它的 stdin/stdout 上按行收发 JSON-RPC 2.0。
//
// 协议要点（DSH 0.2.1-rc.2，@deepseek-ai/dsh-sdk-protocol；阶段 0、S6 和阶段 2 实测）：
//   请求  initialize / session/prompt / session/resume / session/wait / shutdown
//   通知  session.event（每个持久事件）、session.status（running / idle）
//   initialize 要等 DSH 的全部插件（工具服务、技能）加载完才应答，冷启动可能要几十秒
//   session/prompt 只排到“下一轮”：运行中发的消息要等这一轮做完才被看到
//   没有取消、没有审批、没有提问通道
// 缺的三样由引擎桥补上（bridge.mjs，DSH 进程里的插件，经本机命名管道和工作台的 EngineBridge 相连）：
//   提问（ask_user_question 转给工作台）、插话（steer，下一步之前送到）、停止（cancel，只中止当前轮，进程不退出）
//   桥不可用时退回：插话排到下一轮，停止 = 结束整个引擎进程树，再用 session/resume 恢复会话
// 越界操作没有审批者时由 DSH 自动拒绝。
//
// 只用 Node 内置模块。

import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export class Engine extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dshBin     dsh 的 lib/bin.js（测试时可以是模拟引擎脚本）
   * @param {string} [o.nodePath] 运行 dsh 的 node.exe；在 Electron 主进程里必须给出（process.execPath 是 Electron 本身）
   * @param {string} o.cwd        工作区
   * @param {object} [o.env]      子进程环境变量
   * @param {string} [o.logFile]  收发的每一帧追加到这个 JSONL 文件
   * @param {string} o.provider   模型路由，如 dept-llm
   * @param {string} o.model
   * @param {string} [o.reasoningEffort]
   * @param {number} [o.maxTokens]
   * @param {string[]} [o.patches] 追加的 DSH 补丁文件（--patch）
   */
  constructor(o) {
    super()
    this.o = o
    this.proc = null
    this.alive = false
    this.nextId = 1
    this.pending = new Map()
    this.buf = ''
    this.stderrTail = ''
  }

  get pid() { return this.proc ? this.proc.pid : undefined }

  log(dir, frame) {
    if (!this.o.logFile) return
    try { appendFileSync(this.o.logFile, JSON.stringify({ t: Date.now(), dir, frame }) + '\n') } catch { /* 日志失败不影响运行 */ }
  }

  /** 拉起进程并完成 initialize，返回 { serverInfo, ms } */
  async start() {
    const t0 = Date.now()
    const { dshBin, cwd } = this.o
    const args = [dshBin, '--profile', 'sdk']
    for (const p of this.o.patches || []) args.push('--patch', p)
    this.proc = spawn(this.o.nodePath || process.execPath, args, {
      cwd, env: this.o.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    this.alive = true
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => this.onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (s) => {
      this.stderrTail = (this.stderrTail + s).slice(-8000)
      this.log('stderr', s)
    })
    this.proc.stdin.on('error', () => { /* 进程被结束时写入会失败，按退出处理 */ })
    this.proc.on('exit', (code, signal) => {
      this.alive = false
      for (const [, p] of this.pending) p.reject(new Error(`引擎进程已退出（code=${code}, signal=${signal}）`))
      this.pending.clear()
      this.emit('exit', { code, signal })
    })
    this.proc.on('error', (e) => {
      this.alive = false
      for (const [, p] of this.pending) p.reject(e)
      this.pending.clear()
      this.emit('error', e)
    })
    const params = { cwd, provider: this.o.provider, model: this.o.model }
    if (this.o.reasoningEffort) params.reasoningEffort = this.o.reasoningEffort
    if (this.o.maxTokens) params.maxTokens = this.o.maxTokens
    const r = await this.request('initialize', params)
    return { ...r, ms: Date.now() - t0 }
  }

  onData(chunk) {
    this.buf += chunk
    let i
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { this.log('bad-line', line.slice(0, 500)); continue }
      this.log('in', msg)
      if (msg.id !== undefined && msg.method) {
        // 服务端发来的请求（协议目前不用）：按协议回 -32601
        this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
      } else if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'JSON-RPC 错误'), { code: msg.error.code, data: msg.error.data }))
        else p.resolve(msg.result)
      } else if (msg.method) {
        this.emit('notification', msg.method, msg.params)
        this.emit(msg.method, msg.params)
      }
    }
  }

  send(msg) {
    this.log('out', msg)
    if (this.proc && this.alive) this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  request(method, params) {
    if (!this.alive) return Promise.reject(new Error('引擎未运行'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const msg = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params
      this.send(msg)
    })
  }

  /** 发一条用户消息（文字或内容块），返回 { messageId }，只表示已入队 */
  prompt(sessionId, content) {
    const contentBlocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content
    return this.request('session/prompt', { sessionId, contentBlocks })
  }

  wait(sessionId) { return this.request('session/wait', { sessionId }) }

  resume(sessionId) { return this.request('session/resume', { sessionId }) }

  /** 正常关闭：shutdown，超时则强制结束 */
  async shutdown(timeoutMs = 10000) {
    if (!this.alive) return
    const done = new Promise((r) => this.once('exit', r))
    try {
      await Promise.race([this.request('shutdown'), new Promise((_, rej) => setTimeout(() => rej(new Error('shutdown 超时')), timeoutMs))])
      await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs))])
    } catch { /* 走强制结束 */ }
    if (this.alive) await this.kill()
  }

  /** 停止：结束引擎进程及其子进程（工具服务、命令），返回用时 ms */
  async kill() {
    if (!this.proc) return 0
    const t0 = Date.now()
    const done = this.alive ? new Promise((r) => this.once('exit', r)) : Promise.resolve()
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { windowsHide: true })
    else this.proc.kill('SIGKILL')
    await Promise.race([done, new Promise((r) => setTimeout(r, 10000))])
    return Date.now() - t0
  }
}

/**
 * 引擎桥的工作台一端：在本机命名管道（Windows）或 Unix 套接字上等 DSH 里的 bridge.mjs 插件连进来。
 * 一个桥先后服务多个引擎进程（重启引擎不用重建），按插件 hello 里的进程号区分。
 * 事件：hello {pid, features}、question {id, questions, session, pid}、abort {id}、lost {id}（引擎进程结束，问题失效）、
 *       gone {pid}（某个引擎的连接断开）
 */
export class EngineBridge extends EventEmitter {
  constructor(tag = `astrolab-${process.pid}-${Date.now()}`) {
    super()
    this.path = process.platform === 'win32' ? `\\\\.\\pipe\\${tag}` : join(tmpdir(), `${tag}.sock`)
    this.sockets = new Set()
    this.byPid = new Map() // 引擎进程号 -> { socket, features }
    this.open = new Map() // 问题 id -> socket
    this.calls = new Map() // 请求号 -> { resolve, reject, timer }
    this.rid = 0
    this.server = createServer((s) => this.onSocket(s))
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.path, () => resolve(this.path))
    })
  }

  onSocket(s) {
    this.sockets.add(s)
    s.setEncoding('utf8')
    let buf = ''
    let pid
    s.on('data', (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.type === 'hello') {
          pid = msg.pid
          this.byPid.set(pid, { socket: s, features: msg.features || ['ask'] })
          this.emit('hello', { pid, features: msg.features || ['ask'] })
        } else if (msg.type === 'question') {
          this.open.set(msg.id, s)
          this.emit('question', { ...msg, pid, receivedAt: Date.now() })
        } else if (msg.type === 'abort') {
          this.open.delete(msg.id)
          this.emit('abort', msg)
        } else if (msg.type === 'result') {
          const c = this.calls.get(msg.rid)
          if (!c) continue
          this.calls.delete(msg.rid)
          clearTimeout(c.timer)
          if (msg.ok) c.resolve(msg)
          else c.reject(new Error(msg.error || '引擎桥请求失败'))
        }
      }
    })
    s.on('error', () => { /* 引擎进程被结束时会出现，按断开处理 */ })
    s.on('close', () => {
      this.sockets.delete(s)
      if (pid !== undefined && this.byPid.get(pid)?.socket === s) { this.byPid.delete(pid); this.emit('gone', { pid }) }
      for (const [rid, c] of this.calls) {
        if (c.socket !== s) continue
        this.calls.delete(rid)
        clearTimeout(c.timer)
        c.reject(new Error('引擎桥连接已断开'))
      }
      for (const [id, owner] of this.open) {
        if (owner !== s) continue
        this.open.delete(id)
        this.emit('lost', { id })
      }
    })
  }

  /** 这个引擎进程的插件是否已连上并支持某项功能（steer、cancel、ask） */
  has(pid, feature) {
    const e = this.byPid.get(pid)
    return !!(e && !e.socket.destroyed && e.features.includes(feature))
  }

  /** 等某个引擎进程的插件连上；超时返回 false */
  waitFor(pid, ms = 5000) {
    if (this.byPid.has(pid)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const on = (h) => { if (h.pid === pid) { clearTimeout(t); this.off('hello', on); resolve(true) } }
      const t = setTimeout(() => { this.off('hello', on); resolve(false) }, ms)
      this.on('hello', on)
    })
  }

  call(pid, msg, ms = 4000) {
    const e = this.byPid.get(pid)
    if (!e || e.socket.destroyed) return Promise.reject(new Error('引擎桥未连接'))
    const rid = ++this.rid
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(rid); reject(new Error('引擎桥请求超时')) }, ms)
      this.calls.set(rid, { resolve, reject, timer, socket: e.socket })
      e.socket.write(JSON.stringify({ ...msg, rid }) + '\n')
    })
  }

  /** 插话：下一步之前送到智能体；空闲时唤醒它。返回 { messageId, wasRunning } */
  steer(pid, session, text) { return this.call(pid, { type: 'steer', session, text }) }

  /** 停止当前这一轮（引擎进程不退出），清掉还没送到的消息。返回 { wasRunning } */
  cancel(pid, session) { return this.call(pid, { type: 'cancel', session }) }

  /** 智能体状态：{ status: 'idle'|'running', pending } */
  state(pid, session) { return this.call(pid, { type: 'state', session }) }

  /** 回答一个问题；answers 每题一项 {id, selected:[标签...], custom?}。问题已失效时返回 false */
  answer(id, answers) { return this.reply(id, { type: 'answer', id, answers }) }

  /** 不接这个问题，让 DSH 按没有回答者处理 */
  decline(id) { return this.reply(id, { type: 'decline', id }) }

  reply(id, msg) {
    const s = this.open.get(id)
    if (!s || s.destroyed) return false
    this.open.delete(id)
    s.write(JSON.stringify(msg) + '\n')
    return true
  }

  close() {
    for (const s of this.sockets) s.destroy()
    return new Promise((r) => this.server.close(() => r()))
  }
}

/**
 * 写引擎启动补丁（通过 --patch 传给 DSH），返回文件路径。
 *   - 关掉 web_search、web_fetch：内网没有外网，智能体会白白尝试
 *   - 加 DSH 自带的 ask_user_question（阻塞模式：不回答就一直等）和引擎桥插件（提问、插话、停止）
 *   - skillDirs：技能目录（内置 + 从库里安装的 + 插件带的），覆盖数据目录补丁里 skill-filesystem 的目录列表
 *   - mcpServers：插件带的工具服务 [{ id, name, command, args, env, cwd, toolCallTimeoutMs }]
 * 提问工具用我们自己的条目 id；DSH 以后若在 sdk 中默认挂上提问工具，会出现两个同名工具，升级 DSH 时检查。
 */
// 精简：关掉部门用不上的 DSH 插件，少发给模型的工具定义（第一个请求约少 1 万字，见 app/test/measure-request.mjs）。
// 每项写明为什么用不上；要恢复哪个，从这里删掉即可。
export const TRIMMED_PLUGINS = [
  ['tool-workflow', 'workflow：脚本编排多个智能体；部门任务是一个智能体按技能做完'],
  ['workflow-ptc', 'workflow 的执行器'],
  ['tool-goal', 'create_goal / update_goal / get_goal：任务状态由工作台管'],
  ['command-goal', '/goal 命令：sdk 模式没有命令行'],
  ['plan-mode', 'exit_plan_mode：工作台不用计划模式'],
  ['mcp-resources', 'list_mcp_resources 等 3 个：我们的工具服务只提供工具，不提供资源'],
  // tool-subagent-control（send_message、interrupt_agent）不能关：subagent 的说明要子智能体用 send_message 报告结果
  ['tool-subagent-list-agents', 'list_agents：列出后台智能体；subagent 返回了编号，用不上'],
  ['tool-subagent-fork', 'subagent_fork：保留 subagent 一个委派工具就够'],
]

export function writeEnginePatch(dir, { ask = true, disableWeb = true, skillDirs = null, mcpServers = [], readFence = null, trim = true } = {}) {
  mkdirSync(dir, { recursive: true })
  const q = (v) => JSON.stringify(String(v)) // YAML 的双引号字符串与 JSON 转义兼容
  const lines = ['# 由 AstroLab 生成，每次启动引擎时重写']
  if (disableWeb) lines.push('- id: tool-web', '  disabled: true')
  if (trim) for (const [id] of TRIMMED_PLUGINS) lines.push(`- id: ${id}`, '  disabled: true')
  // 不往外发：会话遥测（默认 FEEDBACK_ONLY，有人点赞点踩时上传会话记录）、官方 API 的会话日志附带上传
  // （session-log-deepseek，默认开，只在用官方 deepseek 路由时生效；我们用 dept-llm，这里关掉作双保险）
  lines.push('- id: session-telemetry-otel', '  config:', '    mode: DISABLED', '- id: session-log-deepseek', '  config:', '    enabled: false')
  if (skillDirs && skillDirs.length) {
    lines.push('- id: skill-filesystem', '  disabled: false', '  config:', '    providerName: dept-skills', '    includeDefaultRoots: false',
      `    customSkillDirs: [${skillDirs.map((d) => q(d.replace(/\\/g, '/'))).join(', ')}]`)
  }
  const inserts = []
  if (ask) {
    const url = pathToFileURL(join(HERE, 'bridge.mjs')).href
    inserts.push('    - id: astrolab-tool-ask-user', "      name: '@deepseek-ai/dsh-tool-ask-user'", '    - id: astrolab-bridge', `      name: ${q(url)}`)
  }
  // 读取围栏（read-fence.mjs）：只读得到工作区、技能目录、临时目录和工具链目录
  if (readFence) {
    const url = pathToFileURL(join(HERE, 'read-fence.mjs')).href
    const list = (a) => `[${(a || []).filter(Boolean).map((d) => q(String(d).replace(/\\/g, '/'))).join(', ')}]`
    inserts.push('    - id: astrolab-read-fence', `      name: ${q(url)}`, '      config:', `        readRoots: ${list(readFence.readRoots)}`, `        toolRoots: ${list(readFence.toolRoots)}`)
    if (readFence.log) inserts.push('        log: true')
  }
  for (const m of mcpServers) {
    inserts.push(`    - id: ${q(m.id)}`, "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', `        serverName: ${q(m.name)}`, '        transport: stdio',
      `        command: ${q(m.command)}`, `        args: [${m.args.map(q).join(', ')}]`)
    if (m.cwd) inserts.push(`        cwd: ${q(m.cwd)}`)
    if (m.env && Object.keys(m.env).length) inserts.push(`        env: {${Object.entries(m.env).map(([k, v]) => `${q(k)}: ${q(v)}`).join(', ')}}`)
    if (m.toolCallTimeoutMs) inserts.push(`        toolCallTimeoutMs: ${Number(m.toolCallTimeoutMs)}`)
  }
  if (inserts.length) lines.push('- insert:', ...inserts)
  const file = join(dir, 'astrolab-engine.patch.yml')
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}
