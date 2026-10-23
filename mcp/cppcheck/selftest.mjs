// 自检：以 MCP 客户端身份拉起 server.mjs，对当前目录的 src 跑一次 Cppcheck。
// 由 scripts\check.ps1 调用（工作目录为 sample）。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const server = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const client = new Client({ name: 'selftest', version: '0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env } }))
const tools = (await client.listTools()).tools.map((t) => t.name)
console.log(`   工具：${tools.join(', ')}`)
const r = await client.callTool({ name: 'run_cppcheck', arguments: { paths: ['src'], target: 'sparc', includeDirs: ['src'] } })
await client.close()
if (r.isError) {
  console.log(`   [X]  ${r.content[0].text}`)
  process.exit(1)
}
const s = r.structuredContent
console.log(`   [OK] run_cppcheck 返回 ${s.total} 条告警`)
for (const f of s.findings.slice(0, 5)) console.log(`        ${f.file}:${f.line} [${f.severity}] ${f.id}`)
