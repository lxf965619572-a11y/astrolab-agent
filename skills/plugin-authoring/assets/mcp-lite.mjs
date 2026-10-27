// 不依赖任何包的最小 MCP 服务端（stdio，每行一条 JSON-RPC 消息）：initialize、tools/list、tools/call、ping。
// 知识库服务和插件里的工具服务都用它：断网安装时不用带 node_modules，插件作者也不用装 SDK。
// 插件里使用时把本文件复制到工具服务的目录（插件创作技能会做），保持插件自包含。
//
// 用法：
//   import { serve } from './mcp-lite.mjs'
//   serve({ name: 'spw', version: '1.0.0' }, [
//     { name: 'check_frame', description: '…', inputSchema: { type: 'object', properties: { hex: { type: 'string' } }, required: ['hex'] },
//       handler: async (args) => ({ text: '…', data: { … } }) },   // 返回 { text, data?, isError? }，或直接返回字符串
//   ])

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

export function serve(info, tools, { input = process.stdin, output = process.stdout } = {}) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const send = (msg) => output.write(JSON.stringify(msg) + '\n')
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  async function handle(msg) {
    const { id, method, params = {} } = msg
    if (id === undefined) return // 通知（notifications/initialized 等）不用回
    try {
      if (method === 'initialize') {
        const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0]
        return reply(id, { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: info.name, version: info.version || '0.0.0' } })
      }
      if (method === 'ping') return reply(id, {})
      if (method === 'tools/list') {
        return reply(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} } })) })
      }
      if (method === 'tools/call') {
        const t = byName.get(params.name)
        if (!t) return reply(id, { isError: true, content: [{ type: 'text', text: `没有这个工具：${params.name}` }] })
        let r
        try { r = await t.handler(params.arguments || {}) } catch (e) {
          return reply(id, { isError: true, content: [{ type: 'text', text: String((e && e.message) || e) }] })
        }
        if (typeof r === 'string') r = { text: r }
        const out = { content: [{ type: 'text', text: r.text ?? JSON.stringify(r.data ?? null, null, 2) }] }
        if (r.data !== undefined && r.data !== null && typeof r.data === 'object' && !Array.isArray(r.data)) out.structuredContent = r.data
        if (r.isError) out.isError = true
        return reply(id, out)
      }
      return error(id, -32601, `method not found: ${method}`)
    } catch (e) {
      return error(id, -32603, String((e && e.message) || e))
    }
  }

  let buf = ''
  input.setEncoding('utf8')
  input.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      void handle(msg)
    }
  })
  input.on('end', () => process.exit(0))
}
