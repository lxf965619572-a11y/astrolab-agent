// 智能体提问桥（阶段 1 技术验证）：运行在 DSH 进程里的 Cordis 插件。
//
// sdk 协议没有“服务端向客户端提问”的通道，ask_user_question 没有回答者时会直接报错。
// DSH 留了回答者挂接点：Cordis 瀑布事件 user-questions/request。本插件挂在这里，
// 把问题经本机命名管道（Windows）或 Unix 套接字转给工作台，等工作台回答后交回给智能体。
//
// 地址由环境变量 ASTROLAB_BRIDGE 给出（工作台启动引擎时设置）。没有地址、连不上或工作台选择不接时，
// 交给下一个回答者（next），行为与不装本插件相同。
//
// 管道上每行一条 JSON：
//   插件 → 工作台  {type:'hello', pid}
//                  {type:'question', id, questions, wait?, session?, agentKeys}
//                  {type:'abort', id, reason}          智能体那边取消了（例如轮次被中止）
//   工作台 → 插件  {type:'answer', id, answers:[{id, selected:[...], custom?}]}
//                  {type:'decline', id}                  不接，交给下一个回答者
//
// 只用 Node 内置模块，不导入 DSH 的包，DSH 升级时不受内部模块路径变化影响。

import { connect } from 'node:net'

export const name = 'astrolab-ask-bridge'
export const inject = ['userQuestions']

export function apply(ctx, config = {}) {
  const address = config.address || process.env.ASTROLAB_BRIDGE
  if (!address) return

  let socket = null
  let connecting = null
  let buffer = ''
  let seq = 0
  const waiting = new Map()

  const send = (msg) => { if (socket && !socket.destroyed) socket.write(JSON.stringify(msg) + '\n') }

  function ensure() {
    if (socket && !socket.destroyed) return Promise.resolve(socket)
    if (connecting) return connecting
    connecting = new Promise((resolve, reject) => {
      const s = connect(address)
      s.setEncoding('utf8')
      s.once('connect', () => {
        socket = s
        connecting = null
        send({ type: 'hello', pid: process.pid })
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
          if (!line) continue
          let msg
          try { msg = JSON.parse(line) } catch { continue }
          const w = waiting.get(msg.id)
          if (!w) continue
          if (msg.type === 'answer') w.resolve({ answers: Array.isArray(msg.answers) ? msg.answers : [] })
          else if (msg.type === 'decline') w.decline()
        }
      })
      s.on('close', () => {
        socket = null
        for (const w of [...waiting.values()]) w.reject(new Error('工作台连接已断开，问题没有得到回答'))
      })
    })
    return connecting
  }

  function sessionOf(agent) {
    if (!agent) return undefined
    try {
      const v = agent.session?.id ?? agent.sessionId ?? agent.session?.sessionId
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
        send({ type: 'abort', id, reason: String(signal?.reason?.message || signal?.reason || 'aborted') })
        reject(signal?.reason instanceof Error ? signal.reason : new Error('ask_user_question was aborted before the user answered'))
      }
      waiting.set(id, {
        resolve: (answer) => { done(); resolve(answer) },
        reject: (error) => { done(); reject(error) },
        decline: () => { done(); next().then(resolve, reject) },
      })
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      let agentKeys = []
      try { agentKeys = request.agent ? Object.keys(request.agent).slice(0, 40) : [] } catch { /* 只是诊断信息 */ }
      send({ type: 'question', id, questions: request.questions, wait: request.wait, session: sessionOf(request.agent), agentKeys })
    })
  })
}
