#!/usr/bin/env node
// 文档读取 MCP 服务：把 Word / Excel / PDF 转成 Markdown 给智能体阅读。只读，不写文件。
// 传输方式：stdio（由 DSH 的 dsh-mcp-client 插件拉起）。
//
// 环境变量：
//   DOCREADER_MAX_MB   单个文件大小上限，默认 50

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { hotHandler, hotModule } from '../common/hot.mjs'

// 工具实现修改后下一次调用自动生效，不用重启 DSH（见 ../common/hot.mjs）
const tools = hotModule(import.meta.url, 'tools.mjs')

const server = new McpServer({ name: 'dept-docreader', version: '0.1.0' }, {
  instructions:
    '部门文档读取服务。任务书、ICD、需求规格说明等 Word/Excel/PDF 文件用 read_document 读取，不要用命令行去解析二进制文件。' +
    '长文档先用 mode="outline" 看目录结构，再分段读取；返回结果中的“注意”事项（合并单元格、图片、修订、扫描件）要在分析结论中考虑。',
})

server.registerTool('read_document', {
  description:
    '读取 .docx/.xlsx/.pdf/.md/.txt 文件，转换为 Markdown 返回：保留标题层级和章节编号、表格（含合并单元格）、列表编号、批注和脚注；图片输出为占位符。' +
    '内容较长时分段返回，按结果中的 nextOffset 继续读取。旧版 .doc/.xls/.wps 不支持，需要先另存为新格式。',
  inputSchema: {
    path: z.string().describe('文件路径（相对工作区或绝对路径）'),
    mode: z.enum(['full', 'outline']).optional().describe('full=正文（默认）；outline=只返回标题目录，用于先了解长文档结构'),
    offset: z.number().int().min(0).optional().describe('从第几个字符开始读，默认 0；续读时填上次返回的 nextOffset'),
    maxChars: z.number().int().min(1000).max(200000).optional().describe('本次最多返回的字符数，默认 40000'),
    sheet: z.string().optional().describe('仅 Excel：只读指定名称的工作表'),
    pages: z.object({ from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional() }).optional().describe('仅 PDF：页码范围'),
  },
}, hotHandler(tools, 'readDocument'))

await server.connect(new StdioServerTransport())
