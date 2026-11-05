#!/usr/bin/env node
// 由部门文档模板（文档模板目录下的 .docx）生成 docgen 用的 Word 模板，放到 config/templates。
// 保留：封面、内容概要页、更改栏、修改历史、目录页、页面设置、样式；
// 改动：封面各栏和内容提要、主题词换成 {{字段}}；修改历史表清空示例行；目录页之后的模板正文换成 {{正文}} 一段。
// 部门原模板不改动。部门模板更新后重新运行本脚本。
//
// 用法：node mcp/docgen/make-dept-templates.mjs [部门模板目录] [输出目录]
//   默认：文档模板  config/templates

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readZip, writeZip } from '../common/zip.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const srcDir = resolve(process.argv[2] || join(root, '文档模板'))
const outDir = resolve(process.argv[3] || join(root, 'config', 'templates'))

// 部门模板文件 → 生成的模板名、说明
const LIST = [
  ['01-软件需求规格说明模板.docx', '部门-软件需求规格说明', '部门模板 01 软件需求规格说明（requirements-analysis 的正式文档）'],
  ['02-1软件概要设计说明模板.docx', '部门-软件概要设计说明', '部门模板 02-1 软件概要设计说明（preliminary-design 的正式文档）'],
  ['02-2软件详细设计说明模板.docx', '部门-软件详细设计说明', '部门模板 02-2 软件详细设计说明（detailed-design 的正式文档）'],
  ['02-3XX软件(VX.XX)静态分析报告模板.docx', '部门-静态分析报告', '部门模板 02-3 XX软件（VX.XX）静态分析报告（static-analysis 生成的报告）'],
  ['02-4软件单元测试报告模板.docx', '部门-单元测试报告', '部门模板 02-4 软件单元测试报告（unit-test-design 的 gen-ut-report 生成的报告）'],
  ['11-软件走查报告模板.docx', '部门-走查报告', '部门模板 11 软件走查报告（code-walkthrough 生成的报告）'],
  ['05-确认测试报告模板.docx', '部门-确认测试报告', '部门模板 05 软件确认测试报告（confirmation-test 生成的报告）'],
  ['07-软件研制总结报告(I类)模板.docx', '部门-研制总结报告-I类', '部门模板 07 软件研制总结报告（I类，完全沿用；dev-summary 生成的报告）'],
  ['09-软件研制总结报告(III、IV类)模板.docx', '部门-研制总结报告-III-IV类', '部门模板 09 软件研制总结报告（III、IV类；dev-summary 生成的报告）'],
]

// 封面栏目 → 字段名（文件名称用 docgen 自动填的“文档名称”：Markdown 文首一级标题）
const COVER = [['编号', '编号'], ['密级', '密级'], ['阶段标记', '阶段标记'], ['页数', '页数'], ['型号代号', '型号代号'], ['文件名称', '文档名称'], ['编制单位', '编制单位'], ['编写', '编写'], ['校对', '校对'], ['审核', '审核'], ['标审', '标审'], ['批准', '批准']]

const textOf = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
const norm = (s) => s.replace(/[\s　]/g, '')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** body 的顶层元素 */
function topLevel(body) {
  const out = []
  let i = 0
  const open = /<(w:p|w:tbl|w:sdt|w:sectPr|w:bookmarkStart|w:bookmarkEnd)\b/g
  while (true) {
    open.lastIndex = i
    const m = open.exec(body)
    if (!m) break
    const tag = m[1], s = m.index
    const selfClose = body.indexOf('>', s)
    if (body[selfClose - 1] === '/') { out.push({ tag, xml: body.slice(s, selfClose + 1) }); i = selfClose + 1; continue }
    const rx = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g')
    rx.lastIndex = s
    let depth = 0, e = -1, mm
    while ((mm = rx.exec(body))) {
      if (mm[1] === '/') { depth--; if (depth === 0) { e = mm.index + mm[0].length; break } }
      else if (mm[2] !== '/') depth++
    }
    if (e < 0) throw new Error(`XML 不完整：${tag}`)
    out.push({ tag, xml: body.slice(s, e) })
    i = e
  }
  return out
}

/** 把段落文字换成 text：保留段落属性和第一个文字 run 的格式 */
function setText(p, text) {
  const pPr = (/<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>/.exec(p) || [''])[0]
  const firstRun = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g
  let rPr = ''
  for (const r of p.matchAll(firstRun)) { if (/<w:t\b/.test(r[0])) { rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r[0]) || [''])[0]; break } }
  rPr = rPr.replace(/<w:u\b[^>]*\/>/g, '')
  const open = /^<w:p(?:\s[^>]*)?>/.exec(p)[0]
  return `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
}

function convert(buf) {
  const zip = readZip(buf)
  const doc = zip.text('word/document.xml')
  const b0 = doc.indexOf('<w:body>') + 8, b1 = doc.lastIndexOf('</w:body>')
  const els = topLevel(doc.slice(b0, b1))
  const notes = []
  const tocTitle = els.findIndex((e) => e.tag === 'w:p' && norm(textOf(e.xml)) === '目录')
  if (tocTitle < 0) throw new Error('找不到“目　　录”段落')
  let k = tocTitle + 1
  if (els[k] && /TOC\s\\/.test(els[k].xml)) k++
  else notes.push('目录页没有目录域，已加 {{目录}}')
  const hasToc = k > tocTitle + 1
  // 目录后的分页段落保留一个
  const pageBreak = els.slice(k).find((e) => e.tag === 'w:p' && /w:type="page"/.test(e.xml) && !norm(textOf(e.xml)))
  const sect = els.filter((e) => e.tag === 'w:sectPr').pop()
  const front = els.slice(0, k).map((e) => e.xml)
  // 封面字段
  const firstSect = els.findIndex((e) => /<w:sectPr/.test(e.xml))
  let filled = 0
  for (let i = 0; i < (firstSect > 0 ? firstSect : tocTitle); i++) {
    const e = els[i]
    if (e.tag !== 'w:p') continue
    const t = textOf(e.xml)
    const label = COVER.find(([l]) => norm(t).startsWith(`${l}：`) || norm(t).startsWith(`${l}:`))
    if (!label) continue
    const head = t.slice(0, Math.max(t.indexOf('：'), t.indexOf(':')) + 1)
    front[i] = setText(e.xml, `${head}{{${label[1]}}}`)
    filled++
  }
  // 内容提要、主题词
  const ab = els.findIndex((e) => norm(textOf(e.xml)).startsWith('内容提要'))
  if (ab >= 0) {
    // 部门原件（纸质）此页标题为“内容概要”，Word 版模板误为“内容提要”：只改显示的标题，字段名仍为 {{内容提要}}
    front[ab] = els[ab].xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (m, a, t, c) => a + t.replace('提', '概') + c)
    const nx = els.findIndex((e, i) => i > ab && e.tag === 'w:p' && norm(textOf(e.xml)))
    if (nx > 0 && !/^主题词/.test(norm(textOf(els[nx].xml)))) front[nx] = setText(els[nx].xml, '{{内容提要}}')
  }
  const kw = els.findIndex((e) => norm(textOf(e.xml)).startsWith('主题词'))
  if (kw >= 0) front[kw] = setText(els[kw].xml, '主题词：{{主题词}}')
  // 修改历史：清空示例行
  const hist = els.findIndex((e) => norm(textOf(e.xml)) === '修改历史')
  if (hist >= 0) {
    const ti = els.findIndex((e, i) => i > hist && e.tag === 'w:tbl')
    if (ti > 0 && ti < tocTitle) {
      let row = 0
      front[ti] = els[ti].xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => (row++ === 0 ? tr : tr.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, '$1$2')))
    }
  }
  const tocPara = '<w:p><w:r><w:t>{{目录}}</w:t></w:r></w:p>'
  const bodyPara = '<w:p><w:r><w:t>{{正文}}</w:t></w:r></w:p>'
  const parts = [...front, ...(hasToc ? [] : [tocPara]), ...(pageBreak ? [pageBreak.xml] : []), bodyPara, ...(sect ? [sect.xml] : [])]
  const out = doc.slice(0, b0) + parts.join('') + doc.slice(b1)
  const files = zip.names().filter((n) => !n.endsWith('/')).map((n) => [n, n === 'word/document.xml' ? Buffer.from(out, 'utf8') : zip.get(n)])
  files.sort((a, b) => (a[0] === '[Content_Types].xml' ? -1 : b[0] === '[Content_Types].xml' ? 1 : 0))
  return { buf: writeZip(files), filled, notes, removed: els.length - k }
}

mkdirSync(outDir, { recursive: true })
let n = 0
for (const [src, name, desc] of LIST) {
  const p = join(srcDir, src)
  if (!existsSync(p)) { console.log(`跳过（找不到）：${src}`); continue }
  try {
    const r = convert(readFileSync(p))
    writeFileSync(join(outDir, `${name}.docx`), r.buf)
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify({
      description: `${desc}。由 make-dept-templates.mjs 从 文档模板/${src} 生成：封面字段 {{编号}} {{密级}} {{阶段标记}} {{页数}} {{型号代号}} {{文档名称}} {{编制单位}} {{编写}} {{校对}} {{审核}} {{标审}} {{批准}}，内容概要页 {{内容提要}} {{主题词}}（页标题按原件改为“内容概要”），修改历史表已清空。`,
      styles: {},
    }, null, 2) + '\n', 'utf8')
    console.log(`${name}.docx：封面字段 ${r.filled} 个，删去模板正文 ${r.removed} 段/表${r.notes.length ? `；${r.notes.join('；')}` : ''}`)
    n++
  } catch (e) { console.log(`失败：${src}：${e.message}`) }
}
console.log(`生成 ${n} 个模板，在 ${outDir}`)
