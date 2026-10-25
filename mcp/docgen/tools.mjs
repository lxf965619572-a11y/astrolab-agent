// 文档生成工具的实现（与 MCP 协议无关，便于单独测试）。

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkOutput, resolvePath } from '../common/paths.mjs'
import { inspectTemplate, renderDocx } from './lib/docx-write.mjs'
import { extractTables, renderXlsx } from './lib/xlsx-write.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 模板目录：DOCGEN_TEMPLATE_DIR（多个用分号分隔），默认 <工程>/config/templates
export const templateDirs = () => (process.env.DOCGEN_TEMPLATE_DIR
  ? process.env.DOCGEN_TEMPLATE_DIR.split(';').map((s) => s.trim()).filter(Boolean)
  : [resolve(HERE, '..', '..', 'config', 'templates')])

const ok = (result, text) => ({ content: [{ type: 'text', text: text ?? JSON.stringify(result, null, 2) }], structuredContent: result })
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] })

function loadMapping(tplPath) {
  const json = tplPath.replace(/\.(docx|dotx)$/i, '.json')
  if (!existsSync(json)) return {}
  try { return JSON.parse(readFileSync(json, 'utf8')) } catch (e) { throw new Error(`样式映射文件格式错误：${json}：${e.message}`) }
}

function findTemplate(name) {
  if (!name) {
    const all = listTemplateFiles()
    if (all.length === 1) return all[0]
    throw new Error(all.length ? `有多个模板，请用 template 参数指定：${all.map((f) => basename(f, extname(f))).join('、')}` : `模板目录中没有 .docx/.dotx 模板：${templateDirs().join('；')}`)
  }
  if (isAbsolute(name) || /[\\/]/.test(name)) {
    const p = resolvePath(name)
    if (existsSync(p)) return p
    throw new Error(`模板不存在：${p}`)
  }
  for (const d of templateDirs()) for (const ext of ['', '.docx', '.dotx']) {
    const p = join(d, name + ext)
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  throw new Error(`找不到模板“${name}”。可用模板：${listTemplateFiles().map((f) => basename(f, extname(f))).join('、') || '（无）'}`)
}

function listTemplateFiles() {
  const out = []
  for (const d of templateDirs()) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) if (/\.(docx|dotx)$/i.test(f) && !f.startsWith('~$')) out.push(join(d, f))
  }
  return out
}

function readSource({ source, markdown }) {
  if (markdown) return markdown
  if (!source) throw new Error('请提供 source（Markdown 文件路径）或 markdown（正文内容）')
  const p = resolvePath(source)
  if (!existsSync(p)) throw new Error(`源文件不存在：${p}`)
  return readFileSync(p, 'utf8')
}

export async function listTemplates() {
  const files = listTemplateFiles()
  const templates = []
  for (const f of files) {
    try {
      const mapping = loadMapping(f)
      const info = inspectTemplate(readFileSync(f), mapping)
      templates.push({ name: basename(f, extname(f)), path: f, description: mapping.description || '', ...info })
    } catch (e) {
      templates.push({ name: basename(f, extname(f)), path: f, error: e.message })
    }
  }
  const result = { dirs: templateDirs(), templates }
  const text = templates.length
    ? templates.map((t) => t.error ? `- ${t.name}：无法解析（${t.error}）` :
      `- ${t.name}${t.description ? `：${t.description}` : ''}\n  字段：${t.fields.join('、') || '无'}\n  正文占位：${t.hasBodyPlaceholder ? '有' : '无（将替换全部正文）'}；目录占位：${t.hasTocPlaceholder ? '有' : '无'}；标题样式：${t.headingLevels.length ? `1–${Math.max(...t.headingLevels)} 级` : '未识别'}${t.headingAutoNumber ? '（自动编号）' : ''}`).join('\n')
    : `模板目录中没有模板：${templateDirs().join('；')}`
  return ok(result, text)
}

export async function renderDocument({ source, markdown, template, output, fields = {}, headingNumbers = 'auto', overwrite = false }) {
  try {
    const md = readSource({ source, markdown })
    const tpl = findTemplate(template)
    const out = checkOutput(output, '.docx', overwrite)
    const r = renderDocx(readFileSync(tpl), md, { fields, mapping: loadMapping(tpl), headingNumbers })
    writeFileSync(out, r.buffer)
    const result = { output: out, template: tpl, bytes: r.buffer.length, stats: r.stats, fieldsFilled: r.fieldsFilled, tocInserted: r.tocInserted, warnings: r.warnings, notes: r.notes }
    const text = `已生成 ${out}（模板：${basename(tpl)}）\n` +
      `标题 ${r.stats.headings} 个，段落 ${r.stats.paragraphs} 个，表格 ${r.stats.tables} 个，题注 ${r.stats.captions} 个${r.stats.flowcharts ? `，流程图 ${r.stats.flowcharts} 个` : ""}` +
      (r.tocInserted ? '，已插入目录域（Word 打开时会提示更新域）' : '') +
      (r.warnings.length ? `\n注意：\n${r.warnings.map((w) => `- ${w}`).join('\n')}` : '') +
      (r.notes.length ? `\n说明：\n${r.notes.map((w) => `- ${w}`).join('\n')}` : '')
    return ok(result, text)
  } catch (e) {
    return fail(`生成 Word 失败：${e.message}`)
  }
}

export async function exportTables({ source, markdown, output, include, merge = true, reviewColumns = [], overwrite = false }) {
  try {
    const md = readSource({ source, markdown })
    const tables = extractTables(md, { include, merge, reviewColumns })
    if (!tables.length) return fail(include ? `没有找到标题或题注包含“${include}”的表格` : '内容中没有 Markdown 表格')
    const out = checkOutput(output, '.xlsx', overwrite)
    const r = renderXlsx(tables)
    writeFileSync(out, r.buffer)
    const result = { output: out, sheets: r.sheets, markers: r.markers }
    const text = `已生成 ${out}，共 ${r.sheets.length} 个工作表：\n${r.sheets.map((s, i) => `- ${s.name}（${s.rows} 行 × ${s.cols} 列）${tables[i].mergedFrom ? `，由 ${tables[i].mergedFrom.length} 个表头相同的表合并` : ''}`).join('\n')}` +
      (r.markers ? `\n注意：有 ${r.markers} 个单元格含【待确认】/【待补充】，已标黄` : '')
    return ok(result, text)
  } catch (e) {
    return fail(`导出 Excel 失败：${e.message}`)
  }
}
