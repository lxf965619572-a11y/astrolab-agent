#!/usr/bin/env node
// 知识库工具服务（stdio MCP，由 DSH 拉起）：智能体检索部门经验、好的设计和代码，读条目全文，把新经验记成个人库里的草稿。
// 库的位置由工作台经环境变量 ASTROLAB_LIBRARIES 给出（个人库 + 已同步的部门库、型号库）；智能体记的草稿只写个人库，
// 由用户在工作台的“知识库”里确认、修改后再提交到共享库审核。
// 不依赖任何包（../common/mcp-lite.mjs），断网安装不用带 node_modules。

import { userInfo } from 'node:os'
import { serve } from '../common/mcp-lite.mjs'
import { KINDS, buildIndex, librariesFromEnv, readEntry, search, writeEntry } from './lib/kb.mjs'
import { buildRefIndex, listDocs, loadGlossary, readRef, searchRef } from './lib/ref.mjs'

const libs = () => librariesFromEnv()
const noLib = '知识库还没有配置（在工作台里使用时会自动配置）'
// 资料的许可范围：工作台用公网模型时给 public（有版权的资料不发出去），部门模型时给 all
const refScope = () => (process.env.ASTROLAB_REFERENCE_SCOPE === 'public' ? 'public' : 'all')
const LIC = { public: '公版', internal: '仅部门内部' }

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
    name: 'search_reference',
    description:
      '在部门资料库（学习资料、标准原文，按节切开）里检索，找依据和细节。和知识库不同：知识库是部门提炼的结论，资料是出处。' +
      '资料原文多是英文：用英文术语检索最准（如“telemetry frame format”“requirement verification matrix”）；用中文时会按术语表补上英文。' +
      '返回资料名、节号、页码、摘要和 id，要看原文用 read_reference。引用资料时写出“资料名 §节号，第几页”，不要凭记忆补页码。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词，英文术语优先，空格分隔' },
        doc: { type: 'string', description: '只在某一份资料里找（list_references 返回的资料 id）' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '最多返回几条，默认 6' },
      },
      required: ['query'],
    },
    handler: async ({ query, doc, limit = 6 }) => {
      const L = libs()
      const idx = buildRefIndex(L, { scope: refScope() })
      if (!idx.secs.length) return { text: refScope() === 'public' ? '资料库里没有可用的公版资料（有版权的资料只在部门模型下可以检索）。' : '资料库里还没有资料。', data: { hits: [] } }
      const r = searchRef(idx, query, { doc, limit, glossary: loadGlossary(L) })
      if (!r.hits.length) return { text: `资料里没有找到与“${query}”相关的内容。试试英文术语。`, data: r }
      const lines = r.hits.map((h, i) => `${i + 1}. ${h.cite}（${LIC[h.license] || h.license}）\n   id: ${h.id}\n   ${h.snippet}`)
      return { text: `${r.expanded.length ? `（按术语表补上：${r.expanded.join(', ')}）\n` : ''}${lines.join('\n')}`, data: r }
    },
  },
  {
    name: 'read_reference',
    description: '读资料的一节原文（search_reference 或 list_references 返回的 id）。太长的节分几部分，用 part 读后面的部分。引用时用返回的 cite。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, part: { type: 'integer', minimum: 1 } }, required: ['id'] },
    handler: async ({ id, part = 1 }) => {
      const r = readRef(libs(), id, { part, scope: refScope() })
      const head = [`# ${r.meta.no} ${r.meta.title}`, `出处：${r.cite}${r.parts > 1 ? `　第 ${r.part}/${r.parts} 部分` : ''}`]
      const nav = [r.prev && `上一节：${r.prev.no} ${r.prev.title}（${r.prev.id}）`, r.next && `下一节：${r.next.no} ${r.next.title}（${r.next.id}）`].filter(Boolean)
      return { text: `${head.join('\n')}\n\n${r.text}\n\n${nav.join('\n')}`, data: { id: r.id, meta: r.meta, cite: r.cite, part: r.part, parts: r.parts } }
    },
  },
  {
    name: 'list_references',
    description: '列出资料库里有哪些资料；给了资料 id 时列出这份资料已导入的章节（节号、标题、页码、id）。',
    inputSchema: { type: 'object', properties: { doc: { type: 'string' } } },
    handler: async ({ doc } = {}) => {
      const scope = refScope()
      const docs = listDocs(libs()).filter((d) => scope !== 'public' || d.license === 'public')
      if (!docs.length) return { text: '资料库里还没有可用的资料。', data: { docs: [] } }
      if (doc) {
        const d = docs.find((x) => x.id === doc)
        if (!d) return { text: `没有这份资料：${doc}`, isError: true }
        return { text: [`${d.title}（${d.titleZh || ''}，${LIC[d.license] || d.license}）`, ...d.sections.map((s) => `- §${s.no} ${s.title}，第 ${s.pages} 页　id: ${d.lib}:${d.id}/${s.file}`)].join('\n'), data: { doc: d } }
      }
      return { text: docs.map((d) => `- ${d.id}：${d.title}（${d.titleZh || ''}，${LIC[d.license] || d.license}，已导入 ${d.sections.length} 节）`).join('\n'), data: { docs: docs.map(({ dir, ...x }) => x) } }
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
