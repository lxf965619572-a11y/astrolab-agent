#!/usr/bin/env node
// 知识库工具服务（stdio MCP，由 DSH 拉起）：智能体检索部门经验、好的设计和代码，读条目全文，把新经验记成个人库里的草稿。
// 库的位置由工作台经环境变量 ASTROLAB_LIBRARIES 给出（个人库 + 已同步的部门库、型号库）；智能体记的草稿只写个人库，
// 由用户在工作台的“知识库”里确认、修改后再提交到共享库审核。
// 不依赖任何包（../common/mcp-lite.mjs），断网安装不用带 node_modules。

import { userInfo } from 'node:os'
import { serve } from '../common/mcp-lite.mjs'
import { KINDS, buildIndex, librariesFromEnv, readEntry, search, writeEntry } from './lib/kb.mjs'

const libs = () => librariesFromEnv()
const noLib = '知识库还没有配置（在工作台里使用时会自动配置）'

serve({ name: 'knowledge', version: '1.0.0' }, [
  {
    name: 'search_knowledge',
    description:
      '在部门知识库（个人库、部门通用库、型号库）里检索经验、好的设计、好的代码和问题记录。动手前先查一次：' +
      '用模块名、芯片或协议名、要做的事作关键词（如“1553B RT 复位 超时”）。返回标题、类别、型号、来源库、摘要和条目 id，' +
      '需要全文时用 read_knowledge。用到的条目在回复里注明标题和来源库。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，中英文都可以，空格分隔' },
        kind: { type: 'string', enum: KINDS, description: '只看某一类' },
        model: { type: 'string', description: '只看某个型号的条目（通用条目总会包含）' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: '最多返回几条，默认 8' },
      },
      required: ['query'],
    },
    handler: async ({ query, kind, model, limit = 8 }) => {
      const L = libs()
      if (!L.length) return { text: noLib, isError: true }
      const hits = search(buildIndex(L), query, { kind, model, limit })
      if (!hits.length) return { text: `没有找到与“${query}”相关的条目。`, data: { hits: [] } }
      const lines = hits.map((h, i) => `${i + 1}. 【${h.kind}】${h.title}（${h.libName}${h.model ? ` · ${h.model}` : ''}${h.status ? ` · ${h.status}` : ''}）\n   id: ${h.id}\n   ${h.snippet}`)
      return { text: lines.join('\n'), data: { hits } }
    },
  },
  {
    name: 'read_knowledge',
    description: '读一个知识库条目的全文（search_knowledge 返回的 id）。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async ({ id }) => {
      const L = libs()
      if (!L.length) return { text: noLib, isError: true }
      const e = readEntry(L, id)
      const head = [`# ${e.meta.title || e.path}`, `类别：${e.meta.kind || '经验'}　来源：${e.libName}${e.meta.model ? `　型号：${e.meta.model}` : ''}${e.meta.tags.length ? `　标签：${e.meta.tags.join('、')}` : ''}${e.meta.author ? `　作者：${e.meta.author}` : ''}${e.meta.date ? `　日期：${e.meta.date}` : ''}`]
      return { text: `${head.join('\n')}\n\n${e.body}`, data: { id: e.id, meta: e.meta } }
    },
  },
  {
    name: 'propose_knowledge',
    description:
      '只在用户明确要求把某个结论、经验或产物记入知识库（如“记到知识库”“入库”）时调用；不要在任务结束时主动记录。' +
      '记成个人库里的一条草稿（不会直接分享给别人，由用户确认后再提交审核）。' +
      '一条只写一件事：标题说清结论，正文写背景、做法、原因，代码放代码块；注明来源（任务、文件）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话结论，如“1553B RT 复位等待用大于或等于判就绪”' },
        kind: { type: 'string', enum: KINDS },
        body: { type: 'string', description: 'Markdown 正文' },
        tags: { type: 'array', items: { type: 'string' } },
        model: { type: 'string', description: '涉及具体型号时写型号名' },
        source: { type: 'string', description: '来源：文件路径、设计条目号等' },
      },
      required: ['title', 'kind', 'body'],
    },
    handler: async ({ title, kind, body, tags = [], model, source }) => {
      const mine = libs().find((l) => l.writable)
      if (!mine) return { text: '没有可写的个人库，草稿没有保存', isError: true }
      let author = ''
      try { author = userInfo().username } catch { /* 取不到就留空 */ }
      const rel = writeEntry(mine.dir, { title, kind, tags, model, source, author, status: '草稿' }, body)
      return { text: `已记为个人库草稿：${rel}。用户会在工作台的“知识库”里确认。`, data: { id: `${mine.id}:${rel}` } }
    },
  },
])
