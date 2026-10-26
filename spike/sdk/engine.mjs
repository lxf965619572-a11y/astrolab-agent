// 引擎适配层原型（阶段 0 技术验证）：拉起 `dsh --profile sdk`，在它的 stdin/stdout 上按行收发 JSON-RPC 2.0。
//
// sdk 协议（DSH 0.2.1-rc.2，见 @deepseek-ai/dsh-sdk-protocol）：
//   请求  initialize / session/prompt / session/resume / session/wait / shutdown 等
//   通知  session.event（每个持久事件）、session.status（running/idle）、subagent.started/finished
// 协议没有取消和审批：停止 = 结束整个引擎进程（含它拉起的工具服务），再用 session/resume 恢复会话；
// 越界操作由 DSH 的沙箱和审批服务处理，没有应答者时自动拒绝。
//
// 只用 Node 内置模块，不需要 npm install。

import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync } from 'node:fs'

export class Engine extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dshBin   dsh 的 lib/bin.js
   * @param {string} o.cwd      工作区（智能体能写的目录）
   * @param {object} [o.env]    子进程环境变量
   * @param {string} [o.logFile] 收发的每一帧追加到这个 JSONL 文件
   * @param {string} o.provider 模型路由，如 dept-llm
   * @param {string} o.model
   * @param {string} [o.reasoningEffort]
   * @param {number} [o.maxTokens]
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

  log(dir, frame) {
    if (!this.o.logFile) return
    try { appendFileSync(this.o.logFile, JSON.stringify({ t: Date.now(), dir, frame }) + '\n') } catch { /* 日志失败不影响运行 */ }
  }

  /** 拉起进程并完成 initialize，返回 { serverInfo, ms } */
  async start() {
    const t0 = Date.now()
    const { dshBin, cwd, env } = this.o
    this.proc = spawn(process.execPath, [dshBin, '--profile', 'sdk'], { cwd, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.alive = true
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => this.onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (s) => {
      this.stderrTail = (this.stderrTail + s).slice(-8000)
      this.log('stderr', s)
    })
    this.proc.on('exit', (code, signal) => {
      this.alive = false
      for (const [, p] of this.pending) p.reject(new Error(`引擎进程已退出（code=${code}, signal=${signal}）`))
      this.pending.clear()
      this.emit('exit', { code, signal })
    })
    this.proc.on('error', (e) => this.emit('error', e))
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
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
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

  /** 发一条用户消息，返回 { messageId }（只表示已入队） */
  prompt(sessionId, text) {
    return this.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text }] })
  }

  /** 等会话及其子任务空闲 */
  wait(sessionId) { return this.request('session/wait', { sessionId }) }

  /** 恢复已持久化的会话（不发新输入） */
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

/** 从一个会话事件中取出界面要显示的内容 */
export function describeEvent(ev) {
  const d = ev.data || {}
  switch (ev.type) {
    case 'assistant/message': {
      const blocks = (d.message && d.message.content) || []
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      const thinking = blocks.filter((b) => b.type === 'thinking' || b.type === 'reasoning').map((b) => b.text || b.thinking || '').join('\n')
      const calls = blocks.filter((b) => b.type === 'tool-call').map((b) => b.name)
      return { kind: 'assistant', text, thinking, calls }
    }
    case 'tool/call': return { kind: 'tool-call', name: d.name, args: String(d.arguments || '').slice(0, 300), callId: d.callId }
    case 'tool/result': {
      const m = d.message || {}
      const text = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      return { kind: 'tool-result', callId: m.toolCallId, text: text.slice(0, 600), isError: !!(m.isError || d.isError) }
    }
    case 'turn/start': return { kind: 'turn-start', turn: d.turn }
    case 'turn/end': return { kind: 'turn-end', turn: d.turn, reason: d.reason && d.reason.kind }
    default: return { kind: 'other', type: ev.type }
  }
}
