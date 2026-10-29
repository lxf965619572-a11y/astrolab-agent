// 假的 OpenAI 兼容模型服务（只监听 127.0.0.1）：在真实 DSH 上验证插话、停止、继续、提问，不花模型调用。
// 按最后一条用户消息决定回复：
//   含 MARK-ASK     → 先调用 ask_user_question，拿到结果后回 ASK-DONE
//   含 MARK-STEER   → 文字 STEER-SEEN（说明插话在本轮中途被看到）
//   含 MARK-RESUME  → 文字 RESUMED
//   含 MARK-KB      → 先查知识库（mcp__knowledge__search_knowledge），再调插件的工具（mcp__crc_tools_crc__count_lines），回 KB-DONE 和两个结果
//   每次请求的工具名和消息全文记在 requests 里（检查技能目录、插件工具有没有加载）
//   其他            → 每步慢 delay 毫秒，调用 todo_write，共 steps 步，然后回 DONE
//   script(last, results) 给出时优先用它：返回 { tool: { name, args } } 或 { text }，返回空走上面的规则
//   requests 里还记了完整的工具定义（schemas）、请求字节数（bytes）和系统提示（system），供 measure-request.mjs 统计
// 用法：import { startFakeLlm } from './fake-llm.mjs'；或 node test/fake-llm.mjs（端口 PORT，默认 18999）

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''))
const injected = (t) => t.startsWith('Current runtime context') || t.includes('<system-reminder>')

export function startFakeLlm({ port = 0, delay = 1200, steps = 6, log = () => {}, script = null } = {}) {
  let n = 0
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', async () => {
      if (!req.url.includes('chat/completions')) { res.writeHead(404); res.end(); return }
      const j = JSON.parse(body)
      const msgs = j.messages || []
      let li = -1
      for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user' && !injected(textOf(msgs[i]))) { li = i; break }
      const last = li >= 0 ? textOf(msgs[li]) : ''
      const tools = msgs.slice(li + 1).filter((m) => m.role === 'tool').length
      const id = `r${++n}`
      let reply
      requests.push({ tools: (j.tools || []).map((t) => (t.function && t.function.name) || t.name), text: msgs.map(textOf).join('\n'),
        schemas: j.tools || [], bytes: Buffer.byteLength(body), system: msgs.filter((m) => m.role === 'system' || m.role === 'developer').map(textOf).join('\n'), roles: msgs.map((m) => `${m.role}:${textOf(m).length}`) })
      const results = msgs.slice(li + 1).filter((m) => m.role === 'tool').map(textOf)
      const scripted = script ? script(last, results) : null
      if (scripted) reply = scripted
      else if (last.includes('MARK-KB')) reply = tools === 0 ? { tool: { name: 'mcp__knowledge__search_knowledge', args: { query: '复位 超时' } } }
        : tools === 1 ? { tool: { name: 'mcp__crc_tools_crc__count_lines', args: { path: 'a.txt' } } }
          : { text: `KB-DONE\n${results.join('\n---\n')}` }
      else if (last.includes('MARK-ASK')) reply = tools ? { text: 'ASK-DONE' } : { tool: { name: 'ask_user_question', args: { questions: [{ id: 'q1', question: '选哪个？', options: [{ label: '甲' }, { label: '乙' }] }] } } }
      else if (last.includes('MARK-STEER')) reply = { text: 'STEER-SEEN' }
      else if (last.includes('MARK-RESUME')) reply = { text: 'RESUMED' }
      else if (tools < steps) reply = { tool: { name: 'todo_write', args: { todos: [{ content: `步骤 ${tools + 1}`, status: 'in_progress' }] } } }
      else reply = { text: 'DONE' }
      log({ n, last: last.slice(0, 40), tools, reply: reply.text || reply.tool.name })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: j.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
      chunk({ role: 'assistant', content: '' })
      if (reply.tool) await new Promise((r) => setTimeout(r, delay))
      if (reply.text) { chunk({ content: reply.text }); chunk({}, 'stop') } else {
        chunk({ tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] })
        chunk({}, 'tool_calls')
      }
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: j.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, requests, close: () => new Promise((r) => server.close(() => r())) })))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await startFakeLlm({ port: Number(process.env.PORT || 18999), log: (x) => console.log(JSON.stringify(x)) })
  console.log(`fake llm on ${s.port}`)
}
