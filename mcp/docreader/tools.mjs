// 文档读取工具的实现（与 MCP 协议无关，便于单独测试）。只读，不写任何文件。

import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { resolvePath } from '../common/paths.mjs'
import { docxToMarkdown } from './lib/docx.mjs'
import { pdfToMarkdown } from './lib/pdf.mjs'
import { xlsxToMarkdown } from './lib/xlsx.mjs'

const MAX_FILE = Number(process.env.DOCREADER_MAX_MB || 50) * 1024 * 1024
const DEFAULT_CHARS = 40_000

const ok = (result, text) => ({ content: [{ type: 'text', text: text ?? JSON.stringify(result, null, 2) }], structuredContent: result })
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] })

const FORMATS = {
  '.docx': 'docx', '.docm': 'docx', '.dotx': 'docx',
  '.xlsx': 'xlsx', '.xlsm': 'xlsx',
  '.pdf': 'pdf',
  '.md': 'text', '.txt': 'text', '.csv': 'text',
}
const LEGACY = { '.doc': 'Word 97-2003（.doc）', '.xls': 'Excel 97-2003（.xls）', '.wps': 'WPS 文字（.wps）', '.et': 'WPS 表格（.et）', '.ppt': 'PowerPoint 97-2003（.ppt）' }

// 同一文件的转换结果按修改时间缓存，分页读取时不重复解析
const cache = new Map()

async function convert(abs, fmt, opts) {
  const st = statSync(abs)
  const key = `${abs}|${st.mtimeMs}|${JSON.stringify(opts)}`
  if (cache.has(key)) return cache.get(key)
  if (st.size > MAX_FILE) throw new Error(`文件 ${(st.size / 1048576).toFixed(1)} MB，超过上限 ${MAX_FILE / 1048576} MB（DOCREADER_MAX_MB）`)
  const buf = readFileSync(abs)
  let r
  if (fmt === 'docx') r = docxToMarkdown(buf)
  else if (fmt === 'xlsx') r = xlsxToMarkdown(buf, { sheet: opts.sheet })
  else if (fmt === 'pdf') r = await pdfToMarkdown(buf, { pages: opts.pages })
  else {
    let text = buf.toString('utf8')
    if (text.includes('�')) {
      // 很可能是 GBK 编码的文本文件
      try { text = new TextDecoder('gbk').decode(buf) } catch { /* 保留 UTF-8 结果 */ }
    }
    r = { markdown: text, outline: [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() })), stats: {}, warnings: [] }
  }
  if (cache.size > 20) cache.delete(cache.keys().next().value)
  cache.set(key, r)
  return r
}

export async function readDocument({ path, mode = 'full', offset = 0, maxChars = DEFAULT_CHARS, sheet, pages }) {
  const abs = resolvePath(path)
  let st
  try { st = statSync(abs) } catch { return fail(`文件不存在：${abs}（相对路径按 ${process.cwd()} 解析）`) }
  if (st.isDirectory()) return fail(`${abs} 是目录，请指定文件`)
  const ext = extname(abs).toLowerCase()
  if (LEGACY[ext]) return fail(`不支持 ${LEGACY[ext]} 格式。请用 Word/WPS 打开后“另存为”.docx（表格另存为 .xlsx）再读取。`)
  const fmt = FORMATS[ext]
  if (!fmt) return fail(`不支持的文件类型 ${ext || '（无扩展名）'}。支持：${Object.keys(FORMATS).join(' ')}`)
  let r
  try {
    r = await convert(abs, fmt, { sheet, pages: pages ? [pages.from ?? 1, pages.to ?? Infinity] : undefined })
  } catch (err) {
    return fail(`读取 ${basename(abs)} 失败：${err.message}`)
  }
  if (mode === 'outline') {
    const result = { path: abs, format: fmt, mode, totalChars: r.markdown.length, stats: r.stats, warnings: r.warnings, outline: r.outline }
    const text = `文件：${abs}\n格式：${fmt}，全文 ${r.markdown.length} 字符\n` +
      (r.warnings.length ? `注意：\n${r.warnings.map((w) => `- ${w}`).join('\n')}\n` : '') +
      `\n目录结构：\n${r.outline.map((o) => `${'  '.repeat(Math.max(0, o.level - 1))}- ${o.text}`).join('\n') || '（没有识别到标题）'}`
    return ok(result, text)
  }
  const total = r.markdown.length
  const start = Math.max(0, Math.min(offset, total))
  let end = Math.min(total, start + Math.max(1000, maxChars))
  if (end < total) {
    // 尽量在段落边界截断
    const cut = r.markdown.lastIndexOf('\n\n', end)
    if (cut > start + Math.floor((end - start) / 2)) end = cut + 2
  }
  const chunk = r.markdown.slice(start, end)
  const nextOffset = end < total ? end : null
  const result = { path: abs, format: fmt, offset: start, chars: chunk.length, totalChars: total, nextOffset, stats: r.stats, warnings: r.warnings }
  const head = `<!-- 文件：${abs}｜格式：${fmt}｜第 ${start}–${end} 字符，共 ${total} 字符${nextOffset !== null ? `｜未读完，用 offset=${nextOffset} 继续读` : '｜已读完'} -->\n` +
    (r.warnings.length && start === 0 ? `<!-- 注意：${r.warnings.join('；')} -->\n` : '')
  return { content: [{ type: 'text', text: head + '\n' + chunk }], structuredContent: { ...result, markdown: chunk } }
}
