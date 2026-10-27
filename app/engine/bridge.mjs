// 引擎桥：运行在 DSH 进程里的 Cordis 插件（由 engine.mjs 写的引擎启动补丁加载），经本机命名管道（Windows）
// 或 Unix 套接字和工作台相连。sdk 协议缺的三样东西由它补上：
//
//   提问  sdk 没有“服务端向客户端提问”的通道。本插件挂到 DSH 留的回答者挂接点（Cordis 瀑布事件
//         user-questions/request），把 ask_user_question 的问题转给工作台，等回答后交回智能体
//   插话  sdk 的 session/prompt 只排到“下一轮”：智能体把整轮做完（可能十几分钟）才看到。本插件调用智能体的
//         steer，消息在下一步之前送到；智能体空闲时同样会唤醒它
//   停止  sdk 没有取消，只能结束进程。本插件调用智能体的 cancel，只中止当前这一轮，引擎进程照常运行，
//         “继续”不用重启引擎
//   steer、cancel 与 DSH 自己的网页界面走同一个接口（@deepseek-ai/dsh-api-session-controller）
//
// 地址由环境变量 ASTROLAB_BRIDGE 给出（工作台启动引擎时设置）。没有地址或连不上时：提问交给下一个回答者
// （行为与不装本插件相同），插话和停止由工作台退回原来的做法（排到下一轮；结束进程）。
//
// 管道上每行一条 JSON：
//   插件 → 工作台  {type:'hello', pid, features}
//                  {type:'question', id, questions, wait?, session?}
//                  {type:'abort', id, reason}                    智能体那边取消了提问（例如这一轮被停止）
//                  {type:'result', rid, ok, error?, ...}         对下面三种请求的应答
//   工作台 → 插件  {type:'answer', id, answers:[{id, selected:[...], custom?}]}
//                  {type:'decline', id}                          不接这个问题，交给下一个回答者
//                  {type:'steer', rid, session, text}            → {messageId, wasRunning}
//                  {type:'cancel', rid, session}                 → {wasRunning}
//                  {type:'state', rid, session}                  → {status, pending}
//
// 只用 Node 内置模块；建用户消息时优先用 DSH 自己的 createUserMessage（从 DSH 的安装目录解析），找不到再自己建。

import { connect } from 'node:net'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const name = 'astrolab-bridge'
export const inject = ['userQuestions', 'agents']

const FEATURES = ['ask', 'steer', 'cancel']

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v)) deepFreeze(v[k])
  }
  return v
}

let factory = null
/** 建一条来自用户的消息：与 sdk 的 session/prompt 建的消息相同（source.kind = 'user'） */
async function userMessage(text) {
  if (!factory) {
    factory = (content) => deepFreeze({ role: 'user', content: structuredClone(content), source: { kind: 'user' }, id: randomUUID() })
    try {
      const req = createRequire(process.argv[1] || import.meta.url)
      const mod = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm')).href)
      if (typeof mod.createUserMessage === 'function') factory = (content) => mod.createUserMessage({ content, source: { kind: 'user' } })
    } catch { /* 用上面自己建的 */ }
  }
  return factory([{ type: 'text', text }])
}

export function apply(ctx, config = {}) {
  const address = config.address || process.env.ASTROLAB_BRIDGE
  if (!address) return

  let socket = null
  let connecting = null
  let buffer = ''
  let seq = 0
  const waiting = new Map()

  const send = (msg) => { if (socket && !socket.destroyed) socket.write(JSON.stringify(msg) + '\n') }

  function agentOf(session) {
    const agents = ctx.agents
    const a = agents && typeof agents.get === 'function' ? agents.get(session) : undefined
    if (!a) throw new Error(`没有这个会话的智能体：${session}`)
    return a
  }

  async function control(msg) {
    const reply = (r) => send({ type: 'result', rid: msg.rid, ok: true, ...r })
    try {
      if (msg.type === 'steer') {
        const agent = agentOf(msg.session)
        const wasRunning = agent.status === 'running'
        const m = await userMessage(String(msg.text || ''))
        agent.steer(m)
        reply({ messageId: m.id, wasRunning })
      } else if (msg.type === 'cancel') {
        const agent = agentOf(msg.session)
        const wasRunning = agent.status === 'running'
        // 不保留待处理的消息：停止就是停下，还没送到的插话由工作台放回输入框
        agent.cancel({ kind: 'user' })
        reply({ wasRunning })
      } else if (msg.type === 'state') {
        const agent = agentOf(msg.session)
        let pending
        try { pending = agent.inbox ? !!agent.inbox.hasPending : undefined } catch { pending = undefined }
        reply({ status: agent.status, pending })
      }
    } catch (e) {
      send({ type: 'result', rid: msg.rid, ok: false, error: String((e && e.message) || e) })
    }
  }

  function onLine(line) {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    if (msg.type === 'steer' || msg.type === 'cancel' || msg.type === 'state') { void control(msg); return }
    const w = waiting.get(msg.id)
    if (!w) return
    if (msg.type === 'answer') w.resolve({ answers: Array.isArray(msg.answers) ? msg.answers : [] })
    else if (msg.type === 'decline') w.decline()
  }

  function ensure() {
    if (socket && !socket.destroyed) return Promise.resolve(socket)
    if (connecting) return connecting
    connecting = new Promise((resolve, reject) => {
      const s = connect(address)
      s.setEncoding('utf8')
      s.once('connect', () => {
        socket = s
        connecting = null
        send({ type: 'hello', pid: process.pid, features: FEATURES })
        resolve(s)
      })
      // 一直挂着 error 监听：连上之后工作台退出也会触发 error，没有监听会让 DSH 进程崩溃
      s.on('error', (e) => { if (socket !== s) { connecting = null; reject(e) } })
      s.on('data', (chunk) => {
        buffer += chunk
        let i
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim()
          buffer = buffer.slice(i + 1)
          if (line) onLine(line)
        }
      })
      s.on('close', () => {
        if (socket === s) socket = null
        buffer = ''
        for (const w of [...waiting.values()]) w.reject(new Error('工作台连接已断开，问题没有得到回答'))
      })
    })
    return connecting
  }

  // 一加载就连上：插话和停止要随时可用。连不上不影响引擎，提问时再试
  ensure().catch(() => {})

  function sessionOf(agent) {
    if (!agent) return undefined
    try {
      const v = agent.session?.id ?? agent.sessionId ?? agent.session?.sessionId ?? agent.id
      return typeof v === 'string' ? v : undefined
    } catch { return undefined }
  }

  ctx.on('user-questions/request', async (request, next) => {
    try { await ensure() } catch { return next() }
    const id = `q${process.pid}-${++seq}`
    const signal = request.signal
    return new Promise((resolve, reject) => {
      const done = () => { waiting.delete(id); signal?.removeEventListener('abort', onAbort) }
      const onAbort = () => {
        done()
        send({ type: 'abort', id, reason: String(signal?.reason?.message || signal?.reason?.kind || signal?.reason || 'aborted') })
        reject(signal?.reason instanceof Error ? signal.reason : new Error('ask_user_question was aborted before the user answered'))
      }
      waiting.set(id, {
        resolve: (answer) => { done(); resolve(answer) },
        reject: (error) => { done(); reject(error) },
        decline: () => { done(); next().then(resolve, reject) },
      })
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      send({ type: 'question', id, questions: request.questions, wait: request.wait, session: sessionOf(request.agent) })
    })
  })
}
