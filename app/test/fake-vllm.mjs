// 假的 vLLM（OpenAI 兼容）服务，模仿局域网上跑 Qwen3.8-27B 的样子：只监听 127.0.0.1，不调用任何模型。
// 用于模型探测（probe.test.mjs）和“真实 DSH 按 Qwen 的写法发请求”的检查（real-dsh-qwen.mjs）。
//
//   GET  /v1/models            → [{ id, owned_by: 'vllm', max_model_len }]
//   POST /v1/chat/completions  → 非流式或流式（SSE）
//     带 tools 且最后一条是用户消息 → 调用第一个工具（参数按工具名编）；有工具结果后 → 文字
//     chat_template_kwargs.enable_thinking 为真 → 先给一段思考（vLLM 放在 reasoning；opts.reasoningField 可改成 reasoning_content）
// 模拟服务端没配好：
//   noToolParser      没开 --enable-auto-tool-choice：带 tool_choice auto 时 400
//   rawToolCall       开了但没配对解析器：调用写在正文里（<tool_call>…）
//   noReasoningParser 思考混在正文里（<think>…</think>）
//   apiKey            要求 Authorization: Bearer <apiKey>
//   preferTool        有这个名字的工具就调用它（默认调用第一个）
// requests 记下每个请求的完整 body，检查发出去的参数。

import { createServer } from 'node:http'

export function startFakeVllm(opts = {}) {
  const o = { model: 'qwen3.8-27b', maxModelLen: 131072, reasoningField: 'reasoning', ...opts }
  const requests = []
  let n = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)) }
      if (o.apiKey && req.headers.authorization !== `Bearer ${o.apiKey}`) return send(401, { error: { message: 'Unauthorized' } })
      if (req.method === 'GET' && /\/v1\/models$/.test(req.url)) {
        return send(200, { object: 'list', data: [{ id: o.model, object: 'model', owned_by: 'vllm', root: '/models/Qwen3.8-27B', max_model_len: o.maxModelLen }] })
      }
      if (!(req.method === 'POST' && /\/v1\/chat\/completions$/.test(req.url))) return send(404, { error: { message: 'not found' } })
      const j = JSON.parse(body || '{}')
      requests.push(j)
      if (j.model !== o.model) return send(404, { error: { message: `The model \`${j.model}\` does not exist.` } })
      if (o.noToolParser && j.tools && j.tools.length && j.tool_choice === 'auto') return send(400, { error: { message: '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set' } })
      const think = !!(j.chat_template_kwargs && j.chat_template_kwargs.enable_thinking)
      const msgs = j.messages || []
      const last = msgs[msgs.length - 1] || {}
      const pick = j.tools && (j.tools.find((x) => x.function && x.function.name === o.preferTool) || j.tools[0])
      const tool = pick && last.role !== 'tool' ? pick.function : null
      const reasoning = think ? '先算 65536 - 65530 = 6，第 2 次加完是 65536 → 0……所以是第 2 次。' : ''
      let content = tool ? '' : o.doneText || (think ? '2' : '验证每个函数在隔离环境下按设计正确工作。')
      let calls = null
      if (tool) {
        const props = Object.keys((tool.parameters && tool.parameters.properties) || {})
        const args = Object.fromEntries(props.map((k) => [k, k === 'path' ? 'src/tm_udp.c' : k === 'todos' ? [{ content: '读需求', status: 'in_progress' }] : 'x']))
        if (o.rawToolCall) content = `<tool_call>\n<function=${tool.name}>\n${JSON.stringify(args)}\n</function>\n</tool_call>`
        else calls = [{ id: `chatcmpl-tool-${++n}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(args) } }]
      }
      if (think && o.noReasoningParser) content = `<think>${reasoning}</think>${content}`
      const message = { role: 'assistant', content: content || null, ...(calls ? { tool_calls: calls } : {}), ...(think && !o.noReasoningParser ? { [o.reasoningField]: reasoning } : {}) }
      const usage = { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 }
      const finish = calls ? 'tool_calls' : 'stop'
      if (!j.stream) return send(200, { id: `chatcmpl-${n}`, object: 'chat.completion', model: o.model, choices: [{ index: 0, message, finish_reason: finish }], usage })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta, fin = null) => res.write(`data: ${JSON.stringify({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', model: o.model, choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`)
      chunk({ role: 'assistant', content: '' })
      if (message[o.reasoningField]) chunk({ [o.reasoningField]: message[o.reasoningField] })
      if (content) chunk({ content })
      if (calls) chunk({ tool_calls: calls.map((c, index) => ({ index, ...c })) })
      chunk({}, finish)
      res.write(`data: ${JSON.stringify({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', model: o.model, choices: [], usage })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    resolve({ port, baseURL: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((r) => server.close(() => r())) })
  }))
}
