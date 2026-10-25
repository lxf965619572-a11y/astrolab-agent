// 自检：以 MCP 客户端身份拉起 docgen 和 docreader 两个服务，
// 把 sample\docs 下的示例任务书生成 Word，再读回来核对章节结构。
// 由 scripts\check.ps1 调用（工作目录为 sample）。生成的文件放在临时目录，结束后删除。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'astrolab-selftest-'))
const env = { ...process.env, DOC_ALLOWED_ROOTS: tmp }
let bad = 0

async function connect(server) {
  const c = new Client({ name: 'selftest', version: '0' })
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env }))
  return c
}
const say = (okay, msg) => { console.log(`   ${okay ? '[OK]' : '[X] '} ${msg}`); if (!okay) bad++ }

try {
  const gen = await connect(join(here, 'server.mjs'))
  const rd = await connect(join(here, '..', 'docreader', 'server.mjs'))
  console.log(`   docgen 工具：${(await gen.listTools()).tools.map((t) => t.name).join(', ')}`)
  console.log(`   docreader 工具：${(await rd.listTools()).tools.map((t) => t.name).join(', ')}`)

  const tl = await gen.callTool({ name: 'list_templates', arguments: {} })
  say(!tl.isError && tl.structuredContent.templates.length > 0, `模板 ${tl.isError ? tl.content[0].text : tl.structuredContent.templates.map((t) => t.name).join('、') || '（无）'}`)

  const docx = join(tmp, '任务书.docx')
  const r1 = await gen.callTool({ name: 'render_docx', arguments: { source: 'docs/软件研制任务书-示例.md', output: docx, fields: { 软件名称: '自检' } } })
  say(!r1.isError, r1.isError ? r1.content[0].text : `render_docx 生成 Word（${r1.structuredContent.stats.headings} 个标题，${r1.structuredContent.stats.tables} 个表格）`)

  const r2 = await rd.callTool({ name: 'read_document', arguments: { path: docx, mode: 'outline' } })
  const n = r2.isError ? 0 : r2.structuredContent.outline.length
  say(n >= 10, r2.isError ? r2.content[0].text : `read_document 读回 ${n} 个标题，首个：${r2.structuredContent.outline[0]?.text}`)

  const r3 = await gen.callTool({ name: 'export_xlsx', arguments: { source: 'docs/软件研制任务书-示例.md', output: join(tmp, '表格.xlsx') } })
  say(!r3.isError, r3.isError ? r3.content[0].text : `export_xlsx 导出 ${r3.structuredContent.sheets.length} 个工作表`)

  const r4 = await rd.callTool({ name: 'read_document', arguments: { path: join(tmp, '表格.xlsx') } })
  say(!r4.isError && r4.structuredContent.totalChars > 0, r4.isError ? r4.content[0].text : 'read_document 读回 Excel')

  // 流程图：Mermaid 代码块转为 Word 图形
  const fmd = join(tmp, '流程图.md')
  writeFileSync(fmd, '# 流程图自检\n\n```mermaid\nflowchart TD\n  S([开始]) --> A{条件?}\n  A -- 是 --> B[处理]\n  B --> A\n  A -- 否 --> E([返回])\n```\n\n图 1 自检流程图\n')
  const r5 = await gen.callTool({ name: 'render_docx', arguments: { source: fmd, output: join(tmp, '流程图.docx') } })
  const fw = (r5.structuredContent?.warnings || []).filter((w) => w.includes('流程图'))
  say(!r5.isError && r5.structuredContent.stats.flowcharts === 1 && !fw.length, r5.isError ? r5.content[0].text : `流程图转换为 Word 图形${fw.length ? `：${fw.join('；')}` : ''}`)

  await gen.close()
  await rd.close()
} catch (e) {
  say(false, e.message)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(bad ? 1 : 0)
