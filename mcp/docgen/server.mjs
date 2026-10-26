#!/usr/bin/env node
// 文档生成 MCP 服务：把智能体写好的 Markdown 套用部门 Word 模板生成 .docx，把表格导出为 .xlsx。
// 传输方式：stdio（由 DSH 的 dsh-mcp-client 插件拉起）。
//
// 环境变量：
//   DOCGEN_TEMPLATE_DIR  模板目录，多个用分号分隔；默认 <工程>/config/templates
//   DOC_ALLOWED_ROOTS    允许写入的目录，多个用分号分隔；默认只允许写当前工作目录（启动 DSH 时的工作区）

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { hotHandler, hotModule } from '../common/hot.mjs'

// 工具实现修改后下一次调用自动生效，不用重启 DSH（见 ../common/hot.mjs）
const tools = hotModule(import.meta.url, 'tools.mjs')

const server = new McpServer({ name: 'dept-docgen', version: '0.1.0' }, {
  instructions:
    '部门文档生成服务。先用 Markdown 写好文档内容并保存为 .md 文件，再用 render_docx 套模板生成 Word；' +
    '需求条目表、追溯矩阵、问题清单等表格用 export_xlsx 导出 Excel。生成前用 list_templates 查看模板及其封面字段。' +
    '生成结果中的“注意”（缺少的字段、待确认标记）要如实告诉用户，不要自行编造字段值。',
})

server.registerTool('list_templates', {
  description: '列出可用的 Word 模板，以及每个模板的封面/页眉字段（{{字段名}}）、是否有正文和目录占位、标题样式与自动编号情况。',
  inputSchema: {},
}, hotHandler(tools, 'listTemplates'))

server.registerTool('render_docx', {
  description:
    '把 Markdown 套用 Word 模板生成 .docx：标题映射到模板的标题样式（模板带自动编号时去掉手写章节号）、表格加边框和重复表头、' +
    '“表 x-x”段落设为题注、【待确认】/【待补充】黄色高亮、{{目录}} 处插入目录域、{{字段}} 用 fields 填写。' +
    '```mermaid 代码块中的流程图（flowchart TD：([开始/结束])、[处理]、{判断}、[/输入输出/]、[[子程序]]、-- 是 --> 连线）转换为可编辑的 Word 图形，不支持的写法按代码块输出并在“注意”中说明。' +
    '文首唯一的一级标题会作为“文档名称”字段。不会覆盖已存在的文件，除非 overwrite=true。',
  inputSchema: {
    source: z.string().optional().describe('Markdown 源文件路径（与 markdown 二选一，推荐）'),
    markdown: z.string().optional().describe('直接给出的 Markdown 内容'),
    template: z.string().optional().describe('模板名称（list_templates 中的 name）或模板文件路径；只有一个模板时可省略'),
    output: z.string().describe('输出 .docx 路径（相对工作区或绝对路径），如 req/软件需求规格说明-初稿-20261024.docx'),
    fields: z.record(z.string()).optional().describe('模板字段，如 {"软件名称":"TMU 应用软件","文件编号":"…","版本":"V0.1"}；没有依据的字段不要填，留给用户补'),
    headingNumbers: z.enum(['auto', 'keep', 'strip']).optional().describe('标题中手写章节号的处理：auto=模板自动编号且顺序一致时去掉（默认）；keep=保留；strip=总是去掉'),
    overwrite: z.boolean().optional().describe('输出文件已存在时是否覆盖，默认 false'),
  },
}, hotHandler(tools, 'renderDocument'))

server.registerTool('export_xlsx', {
  description:
    '把 Markdown 中的表格导出为 .xlsx：表头相同的表格合并为一个工作表，工作表名取题注或标题；表头冻结并可筛选，含【待确认】的单元格标黄；' +
    '可在右侧追加空白评审列。适合导出需求条目表、追溯矩阵、待确认问题清单、测试用例表。',
  inputSchema: {
    source: z.string().optional().describe('Markdown 源文件路径（与 markdown 二选一）'),
    markdown: z.string().optional().describe('直接给出的 Markdown 内容'),
    output: z.string().describe('输出 .xlsx 路径'),
    include: z.string().optional().describe('只导出题注、所在标题或上一级标题包含该文字的表格，如“追溯”“需求条目”“待确认问题”'),
    merge: z.boolean().optional().describe('表头相同的表格合并为一个工作表，默认 true'),
    reviewColumns: z.array(z.string()).optional().describe('在右侧追加的空白列，供评审填写，如 ["评审意见","处理结果"] 或 ["答复","答复人","状态"]'),
    overwrite: z.boolean().optional().describe('输出文件已存在时是否覆盖，默认 false'),
  },
}, hotHandler(tools, 'exportTables'))

await server.connect(new StdioServerTransport())
