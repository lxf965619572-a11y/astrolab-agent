#!/usr/bin/env node
// <插件名> 的工具服务（stdio MCP，由 DSH 拉起，运行在用户电脑上、沙箱之外）。
// 只用 Node 内置模块和同目录的 mcp-lite.mjs；不联网；只读用户给的文件，写文件只写到 process.cwd()（工作区）下面。

import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { serve } from './mcp-lite.mjs'

// 路径只允许在工作区里（智能体传来的相对路径按工作区解析）
function inWorkspace(p) {
  const abs = resolve(process.cwd(), p)
  const rel = relative(process.cwd(), abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`路径不在工作区里：${p}`)
  return abs
}

serve({ name: 'example', version: '1.0.0' }, [
  {
    name: 'count_lines',
    description: '统计一个文本文件的行数（示例工具：说明它做什么、什么时候用、返回什么）。',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: '工作区里的文件路径' } }, required: ['path'] },
    handler: async ({ path }) => {
      const n = readFileSync(inWorkspace(path), 'utf8').split(/\r?\n/).length
      return { text: `${path}：${n} 行`, data: { path, lines: n } }
    },
  },
])
