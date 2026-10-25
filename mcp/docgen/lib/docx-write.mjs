// Markdown → .docx：套用 Word 模板（.docx/.dotx）的样式、页面设置、页眉页脚和封面。
//
// 模板约定（都可选）：
//   {{正文}}    单独一段，生成的正文插在这里；没有时替换模板的全部正文（保留页面设置和页眉页脚）
//   {{目录}}    单独一段，替换为 Word 目录域（打开文档时 Word 会提示更新域，生成目录）
//   {{字段名}}  封面、页眉页脚中的字段，用 fields 参数填写；未提供的填“【待补充】”
//   与模板同名的 .json 文件：样式映射，模板使用自定义样式名时配置（见 config/templates/README.md）

import { readZip, writeZip } from '../../common/zip.mjs'
import { cleanText, escAttr, escText, kid, kids, parseXml, serializeDoc, val, walk } from '../../common/xml.mjs'
import { parseMarkdown, plainText } from './markdown.mjs'
import { renderFlowchart } from './flowchart.mjs'

const MARKERS = /(【待确认】|【待补充】|【待定】|【TBD】)/
const FIELD_RE = /\{\{\s*([^{}]+?)\s*\}\}/g
const BODY_KEYS = new Set(['正文', 'BODY', 'body'])
const TOC_KEYS = new Set(['目录', 'TOC', 'toc'])

// —— 样式识别 ——
function loadStyles(zip) {
  const xml = zip.text('word/styles.xml')
  const list = []
  if (!xml) return list
  for (const s of kids(parseXml(xml).root, 'w:style')) {
    const pPr = kid(s, 'w:pPr')
    list.push({
      id: s.attrs['w:styleId'],
      type: s.attrs['w:type'],
      name: val(kid(s, 'w:name')) || '',
      isDefault: s.attrs['w:default'] === '1',
      basedOn: val(kid(s, 'w:basedOn')),
      outline: val(kid(pPr, 'w:outlineLvl')),
      numbered: !!kid(pPr, 'w:numPr'),
    })
  }
  return list
}

function resolveStyles(list, mapping = {}) {
  const byId = new Map(list.map((s) => [s.id, s]))
  const para = list.filter((s) => s.type === 'paragraph')
  const find = (...pats) => {
    for (const p of pats) {
      const hit = para.find((s) => (p instanceof RegExp ? p.test(s.name) : s.name.toLowerCase() === p.toLowerCase()))
      if (hit) return hit.id
    }
    return undefined
  }
  const byName = (v) => (v && (byId.has(v) ? v : para.find((s) => s.name === v)?.id))
  const chainHas = (id, prop) => {
    const seen = new Set()
    while (id && byId.has(id) && !seen.has(id)) { seen.add(id); const s = byId.get(id); if (s[prop] !== undefined && s[prop] !== false) return true; id = s.basedOn }
    return false
  }
  const m = mapping.styles || {}
  const st = {
    body: byName(m.body) || para.find((s) => s.isDefault)?.id || find('Normal', '正文'),
    heading: {},
    caption: byName(m.caption) || find('caption', '题注'),
    tableText: byName(m.tableText) || find('表格文字', '表格内容', 'Table Text', 'table text'),
    code: byName(m.code) || find('代码', 'Code', 'HTML Preformatted'),
    quote: byName(m.quote) || find('Quote', '引用'),
    list: byName(m.list) || find('List Paragraph', '列表段落'),
    tocHeading: byName(m.tocHeading) || find('TOC Heading', '目录标题'),
  }
  for (let n = 1; n <= 9; n++) {
    const id = byName(m[`heading${n}`]) || find(`heading ${n}`, new RegExp(`^标题\\s*${n}$`)) ||
      para.find((s) => s.outline === String(n - 1))?.id
    if (id) st.heading[n] = { id, numbered: chainHas(id, 'numbered'), hasOutline: chainHas(id, 'outline') }
  }
  const tables = list.filter((s) => s.type === 'table')
  st.table = byName(m.table) || tables.find((s) => /^(table grid|网格型)$/i.test(s.name))?.id
  return st
}

// —— 生成 XML 片段 ——
function runs(inlines, ctx, base = {}) {
  let s = ''
  for (const x of inlines) {
    if (x.br) { s += '<w:r><w:br/></w:r>'; continue }
    for (const part of x.text.split(MARKERS)) {
      if (!part) continue
      const mark = MARKERS.test(part)
      if (mark) ctx.stats.markers++
      const b = x.b || base.b
      const code = x.code || base.code
      let rPr = ''
      if (code) rPr += '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>'
      if (b) rPr += '<w:b/><w:bCs/>'
      if (x.i) rPr += '<w:i/><w:iCs/>'
      if (base.sz) rPr += `<w:sz w:val="${base.sz}"/><w:szCs w:val="${base.sz}"/>`
      if (mark) rPr += '<w:highlight w:val="yellow"/>'
      const pieces = cleanText(part).split('\t')
      let t = ''
      pieces.forEach((p, k) => { if (k) t += '<w:tab/>'; if (p) t += `<w:t xml:space="preserve">${escText(p)}</w:t>` })
      s += `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t}</w:r>`
    }
  }
  return s
}

// pPr 子元素必须按架构顺序：pStyle, keepNext, numPr, spacing, ind, jc, outlineLvl
function pPr({ style, keepNext, noNum, spacing, ind, jc, outline } = {}) {
  let s = ''
  if (style) s += `<w:pStyle w:val="${escAttr(style)}"/>`
  if (keepNext) s += '<w:keepNext/>'
  if (noNum) s += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>'
  if (spacing) s += spacing
  if (ind) s += ind
  if (jc) s += `<w:jc w:val="${jc}"/>`
  if (outline !== undefined) s += `<w:outlineLvl w:val="${outline}"/>`
  return s ? `<w:pPr>${s}</w:pPr>` : ''
}
const NO_INDENT = '<w:ind w:firstLineChars="0" w:firstLine="0"/>'
const SINGLE = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'

// 显示宽度：汉字 2，大写字母和数字 1.25，其他 1（按半角字宽计）
const textWidth = (s) => [...s].reduce((n, ch) => n + (isWide(ch) ? 2 : /[A-Z0-9]/.test(ch) ? 1.25 : 1), 0)
const isWide = (ch) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)

const HEADING_NUM = /^\s*((\d+(\.\d+)*)\.?|附录\s*[A-Z]|第[一二三四五六七八九十\d]+[章节])[\s　]+/

function blockXml(blocks, ctx) {
  const { st } = ctx
  let out = ''
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        let level = b.level - ctx.shift
        if (level < 1) level = 1
        let inl = b.inlines
        const h = st.heading[Math.min(level, 9)]
        const hasNum = inl.length && inl[0].text && HEADING_NUM.test(inl[0].text)
        const strip = hasNum && (ctx.headingNumbers === 'strip' || (ctx.headingNumbers === 'auto' && h?.numbered && ctx.numbersMatch))
        // 手写章节号与模板自动编号对不上时，保留手写号并关闭该标题的自动编号，避免出现“2 3 需求”
        const noNum = !!(h?.numbered && hasNum && !strip && ctx.headingNumbers !== 'keepBoth')
        if (strip) { ctx.stats.numbersStripped++; inl = [{ ...inl[0], text: inl[0].text.replace(HEADING_NUM, '') }, ...inl.slice(1)] }
        if (noNum) ctx.stats.autoNumberOff++
        ctx.stats.headings++
        // 标题样式没有大纲级别时补上，否则 Word 目录收不到这些标题
        if (h) out += `<w:p>${pPr({ style: h.id, noNum, outline: h.hasOutline ? undefined : Math.min(level, 9) - 1 })}${runs(inl, ctx)}</w:p>`
        else {
          ctx.missing.add(`标题 ${level}`)
          out += `<w:p>${pPr({ style: st.body, keepNext: true, ind: NO_INDENT, outline: level - 1 })}${runs(inl, ctx, { b: true, sz: [0, 32, 28, 24, 24, 24, 24][level] || 24 })}</w:p>`
        }
        break
      }
      case 'paragraph': {
        const text = plainText(b.inlines).trim()
        ctx.stats.paragraphs++
        // “表 3-1 xxx”“图 2 xxx”识别为题注
        if (/^(表|图)\s*[A-Z]?\d+([-.．]\d+)*[\s　]+\S/.test(text) && text.length <= 80) {
          const inl = b.inlines.map((x) => ({ ...x, b: false }))
          out += `<w:p>${pPr({ style: st.caption || st.body, keepNext: text.startsWith('表'), ind: st.caption ? undefined : NO_INDENT, jc: 'center' })}${runs(inl, ctx)}</w:p>`
          ctx.stats.captions++
        } else out += `<w:p>${pPr({ style: st.body })}${runs(b.inlines, ctx)}</w:p>`
        break
      }
      case 'quote':
        out += `<w:p>${pPr({ style: st.quote || st.body, ind: st.quote ? undefined : '<w:ind w:leftChars="200" w:left="420" w:firstLineChars="0" w:firstLine="0"/>' })}${runs(b.inlines, ctx)}</w:p>`
        break
      case 'list':
        for (const it of b.items) {
          const marker = it.ordered ? it.marker.replace(/[.、]$/, '）').replace(/\)$/, '）') : ['•', '–', '·'][it.level % 3]
          const left = 420 * (it.level + 1)
          const ind = `<w:ind w:leftChars="${200 * (it.level + 1)}" w:left="${left}" w:firstLineChars="0" w:firstLine="0"/>`
          out += `<w:p>${pPr({ style: st.body, ind })}${runs([{ text: marker + ' ' }, ...it.inlines], ctx)}</w:p>`
          ctx.stats.paragraphs++
        }
        break
      case 'code':
        if (/^mermaid$/i.test(b.lang || '')) {
          // Mermaid 流程图 → Word 图形；不支持的写法退回为代码块
          const n = ++ctx.stats.flowcharts
          const r = renderFlowchart(b.text, { maxWidthPt: ctx.textWidth / 20, ids: ctx.drawingIds, name: `流程图 ${n}` })
          if (r.ok) {
            out += `<w:p>${pPr({ style: st.body, keepNext: true, spacing: SINGLE, ind: NO_INDENT, jc: 'center' })}<w:r>${r.xml}</w:r></w:p>`
            for (const w of r.warnings) ctx.flowWarnings.push(`第 ${n} 个流程图：${w}`)
            break
          }
          ctx.flowWarnings.push(`第 ${n} 个流程图没有转换（按代码块输出）：${r.errors.join('；')}`)
        }
        for (const line of b.text.split('\n')) {
          out += `<w:p>${pPr({ style: st.code || st.body, spacing: st.code ? undefined : SINGLE, ind: st.code ? undefined : NO_INDENT })}${runs([{ text: line || ' ' }], ctx, st.code ? {} : { code: true, sz: 18 })}</w:p>`
        }
        break
      case 'table':
        out += tableXml(b, ctx)
        ctx.stats.tables++
        break
      case 'pagebreak':
        out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        break
      case 'hr':
        break
    }
  }
  return out
}

// 手写章节号是否与逐级自动编号的结果一致（只看纯数字章节号）
function headingNumbersMatch(blocks, shift) {
  const c = []
  let any = false
  for (const b of blocks) {
    if (b.type !== 'heading') continue
    const level = Math.max(1, b.level - shift)
    c[level - 1] = (c[level - 1] || 0) + 1
    c.length = level
    for (let k = 0; k < level - 1; k++) if (!c[k]) c[k] = 1
    const m = /^\s*(\d+(?:\.\d+)*)\.?[\s\u3000]/.exec(b.inlines[0]?.text || '')
    if (!m) continue
    any = true
    if (m[1] !== c.join('.')) return false
  }
  return any
}

function tableXml(b, ctx) {
  const { st } = ctx
  const ncol = b.header.length
  // 列宽：先保证每列能放下约 6 个汉字（内容更短时按内容），剩余宽度按各列超出部分的比例分配
  const unit = 105 // 五号字一个半角字宽约 105 缇
  const pad = 220
  const need = Array.from({ length: ncol }, (_, k) => {
    const all = [b.header[k], ...b.rows.map((r) => r[k])].map((inl) => Math.max(...plainText(inl || []).split('\n').map(textWidth), 0))
    return Math.ceil(Math.max(...all, 2) * unit + pad)
  })
  const floor = need.map((n) => Math.min(n, 14 * unit + pad))
  let widths
  const sumFloor = floor.reduce((a, c) => a + c, 0)
  if (sumFloor >= ctx.textWidth) widths = floor.map((f) => Math.floor((f * ctx.textWidth) / sumFloor))
  else {
    const extra = need.map((n, k) => n - floor[k])
    const sumExtra = extra.reduce((a, c) => a + c, 0)
    const rest = ctx.textWidth - sumFloor
    widths = floor.map((f, k) => Math.floor(f + (sumExtra ? (rest * extra[k]) / sumExtra : (rest * f) / sumFloor)))
  }
  const cellP = (inl, { header, align }) => {
    const parts = []
    let cur = []
    for (const x of inl) { if (x.br) { parts.push(cur); cur = [] } else cur.push(x) }
    parts.push(cur)
    return parts.map((p) => `<w:p>${pPr({
      style: st.tableText || st.body,
      spacing: st.tableText ? undefined : SINGLE,
      ind: st.tableText ? undefined : NO_INDENT,
      jc: header ? 'center' : align === 'center' ? 'center' : align === 'right' ? 'right' : undefined,
    })}${runs(p, ctx, { b: header, sz: st.tableText ? undefined : 21 })}</w:p>`).join('')
  }
  const border = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`
  let s = '<w:tbl><w:tblPr>'
  if (st.table) s += `<w:tblStyle w:val="${escAttr(st.table)}"/>`
  s += '<w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/>'
  s += `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
  s += '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar>'
  s += '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
  s += `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
  const row = (cells, header) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${cells.map((inl, k) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[k]}" w:type="dxa"/>${header ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${cellP(inl, { header, align: b.align[k] })}</w:tc>`).join('')}</w:tr>`
  s += row(b.header, true)
  for (const r of b.rows) s += row(r, false)
  s += '</w:tbl>'
  // 表格后加一个空段落，避免两个表格粘连
  return s + `<w:p>${pPr({ style: st.body, spacing: SINGLE })}</w:p>`
}

function tocXml(ctx) {
  const levels = ctx.tocLevels || '1-3'
  return `<w:p>${pPr({ style: ctx.st.body, ind: NO_INDENT })}` +
    '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> TOC \\o "${levels}" \\h \\z \\u </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>（目录：打开文档时选择“是”更新域，或右键此处选择“更新域”）</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
}

// —— 段落内的 {{字段}} 替换（字段可能被 Word 拆到多个 run 中）——
function paragraphText(p) {
  const ts = []
  for (const n of walk(p)) if (n.name === 'w:t') ts.push(n)
  return ts
}
function setT(t, s) { t.children = s ? [{ text: s }] : []; t.attrs['xml:space'] = 'preserve' }
function replaceFields(p, fields, report) {
  const ts = paragraphText(p)
  const full = () => ts.map((t) => t.children.map((c) => c.text ?? '').join('')).join('')
  let text = full()
  if (!text.includes('{{')) return
  const matches = [...text.matchAll(FIELD_RE)].reverse()
  let missing = false
  for (const m of matches) {
    const key = m[1]
    if (BODY_KEYS.has(key) || TOC_KEYS.has(key)) continue
    let value = fields[key]
    if (value === undefined || value === null || value === '') { value = '【待补充】'; missing = true; report.missingFields.add(key) } else report.filled.add(key)
    const start = m.index
    const end = start + m[0].length
    // 找出起止所在的 w:t
    let pos = 0
    let first = -1, last = -1, firstOff = 0, lastOff = 0
    const lens = ts.map((t) => t.children.map((c) => c.text ?? '').join('').length)
    for (let k = 0; k < ts.length; k++) {
      if (first < 0 && start < pos + lens[k]) { first = k; firstOff = start - pos }
      if (end <= pos + lens[k]) { last = k; lastOff = end - pos; break }
      pos += lens[k]
    }
    if (first < 0 || last < 0) continue
    const tx = (k) => ts[k].children.map((c) => c.text ?? '').join('')
    if (first === last) {
      const s = tx(first)
      setT(ts[first], s.slice(0, firstOff) + value + s.slice(lastOff))
    } else {
      const a = tx(first)
      const z = tx(last)
      setT(ts[first], a.slice(0, firstOff) + String(value))
      for (let k = first + 1; k < last; k++) setT(ts[k], '')
      setT(ts[last], z.slice(lastOff))
    }
  }
  if (missing) highlightMarkers(p)
}

// 把段落中含【待补充】的 run 拆开，标记部分加黄色高亮（rPr 子元素须按架构顺序插入）
const AFTER_HIGHLIGHT = new Set(['w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'])
function highlightMarkers(p) {
  const visit = (node) => {
    if (!node.children) return
    const out = []
    for (const c of node.children) {
      if (c.name !== 'w:r') { visit(c); out.push(c); continue }
      const tNodes = c.children.filter((x) => x.name === 'w:t')
      const rPr = c.children.find((x) => x.name === 'w:rPr')
      const text = tNodes.map((t) => t.children.map((x) => x.text ?? '').join('')).join('')
      if (tNodes.length !== 1 || !MARKERS.test(text) || rPr?.children.some((x) => x.name === 'w:highlight')) { out.push(c); continue }
      for (const part of text.split(MARKERS)) {
        if (!part) continue
        const r = JSON.parse(JSON.stringify(c))
        r.children = r.children.filter((x) => x.name !== 'w:t')
        const t = { name: 'w:t', attrs: { 'xml:space': 'preserve' }, children: [{ text: part }] }
        const idx = r.children.findIndex((x) => x.name === 'w:rPr')
        r.children.splice(idx + 1, 0, t)
        if (MARKERS.test(part)) {
          let pr = r.children.find((x) => x.name === 'w:rPr')
          if (!pr) { pr = { name: 'w:rPr', attrs: {}, children: [] }; r.children.unshift(pr) }
          const hl = { name: 'w:highlight', attrs: { 'w:val': 'yellow' }, children: [] }
          const at = pr.children.findIndex((x) => AFTER_HIGHLIGHT.has(x.name))
          if (at < 0) pr.children.push(hl); else pr.children.splice(at, 0, hl)
        }
        out.push(r)
      }
    }
    node.children = out
  }
  visit(p)
}

function onlyKey(p) {
  const t = paragraphText(p).map((n) => n.children.map((c) => c.text ?? '').join('')).join('').trim()
  const m = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(t)
  return m ? m[1] : null
}

function fragment(xml) {
  return parseXml(`<x>${xml}</x>`).root.children
}

/** 扫描模板：占位符、样式识别结果 */
export function inspectTemplate(buf, mapping) {
  const zip = readZip(buf)
  const keys = new Set()
  for (const name of zip.names()) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue
    const root = parseXml(zip.text(name)).root
    for (const n of walk(root)) {
      if (n.name !== 'w:p') continue
      const text = paragraphText(n).map((t) => t.children.map((c) => c.text ?? '').join('')).join('')
      for (const m of text.matchAll(FIELD_RE)) keys.add(m[1])
    }
  }
  const st = resolveStyles(loadStyles(zip), mapping)
  return {
    fields: [...keys].filter((k) => !BODY_KEYS.has(k) && !TOC_KEYS.has(k)),
    hasBodyPlaceholder: [...keys].some((k) => BODY_KEYS.has(k)),
    hasTocPlaceholder: [...keys].some((k) => TOC_KEYS.has(k)),
    headingLevels: Object.keys(st.heading).map(Number),
    headingAutoNumber: !!st.heading[1]?.numbered,
    styles: { body: st.body, caption: st.caption || null, tableText: st.tableText || null, code: st.code || null, table: st.table || null },
  }
}

/**
 * 生成 docx。
 * @param {Buffer} templateBuf 模板
 * @param {string} markdown 正文
 * @param {object} opts { fields, mapping, headingNumbers: 'auto'|'keep'|'strip', titleAsField: true, tocLevels }
 */
export function renderDocx(templateBuf, markdown, opts = {}) {
  const zip = readZip(templateBuf)
  const fields = { ...(opts.fields || {}) }
  const st = resolveStyles(loadStyles(zip), opts.mapping || {})
  const ctx = {
    st,
    headingNumbers: opts.headingNumbers || 'auto',
    tocLevels: opts.tocLevels,
    shift: 0,
    stats: { headings: 0, paragraphs: 0, tables: 0, captions: 0, markers: 0, numbersStripped: 0, autoNumberOff: 0, flowcharts: 0 },
    flowWarnings: [],
    numbersMatch: true,
    missing: new Set(),
    textWidth: 8306,
  }
  const notes = []

  let blocks = parseMarkdown(markdown)
  // 文首唯一的一级标题当作文档名称：填入字段，正文标题整体提升一级
  const h1 = blocks.filter((b) => b.type === 'heading' && b.level === 1)
  if (opts.titleAsField !== false && h1.length === 1 && blocks.findIndex((b) => b.type === 'heading') === blocks.indexOf(h1[0])) {
    const title = plainText(h1[0].inlines).trim()
    if (!fields['文档名称'] && !fields['标题']) { fields['文档名称'] = title; fields['标题'] = title }
    blocks = blocks.filter((b) => b !== h1[0])
    if (blocks.some((b) => b.type === 'heading')) ctx.shift = 1
    notes.push(`文首一级标题“${title}”已作为文档名称，其余标题各提升一级`)
  }

  ctx.numbersMatch = headingNumbersMatch(blocks, ctx.shift)

  const docXml = zip.text('word/document.xml')
  if (!docXml) throw new Error('模板不是 Word 文档：缺少 word/document.xml')
  const doc = parseXml(docXml)
  // 流程图用 DrawingML 组合图形，确保根元素声明了命名空间；图形编号避开模板中已有的
  Object.assign(doc.root.attrs, Object.fromEntries(Object.entries({
    'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'xmlns:wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'xmlns:wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    'xmlns:wpg': 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  }).filter(([k]) => !doc.root.attrs[k])))
  let maxId = 0
  for (const m of docXml.matchAll(/\b(?:wp:docPr|pic:cNvPr|wps:cNvPr|wpg:cNvPr)\b[^>]*\bid="(\d+)"/g)) maxId = Math.max(maxId, Number(m[1]))
  ctx.drawingIds = { n: maxId + 100, next() { return ++this.n } }
  const body = kid(doc.root, 'w:body')
  const sect = [...body.children].reverse().find((c) => c.name === 'w:sectPr')
  if (sect) {
    const pg = kid(sect, 'w:pgSz')
    const mar = kid(sect, 'w:pgMar')
    const w = Number(pg?.attrs['w:w'])
    const l = Number(mar?.attrs['w:left'])
    const r = Number(mar?.attrs['w:right'])
    if (w && !Number.isNaN(l) && !Number.isNaN(r)) ctx.textWidth = Math.max(3000, w - l - r - Number(mar?.attrs['w:gutter'] || 0))
  }

  const content = fragment(blockXml(blocks, ctx))
  const report = { missingFields: new Set(), filled: new Set() }

  // 正文、目录占位段落
  let bodyPlaced = false
  let tocPlaced = false
  const replaceIn = (container) => {
    for (let k = 0; k < container.children.length; k++) {
      const c = container.children[k]
      if (c.name === 'w:p') {
        const key = onlyKey(c)
        if (key && BODY_KEYS.has(key) && !bodyPlaced) {
          container.children.splice(k, 1, ...content); k += content.length - 1; bodyPlaced = true
        } else if (key && TOC_KEYS.has(key)) {
          const toc = fragment(tocXml(ctx)); container.children.splice(k, 1, ...toc); tocPlaced = true
        }
      } else if (c.name === 'w:sdt') replaceIn(kid(c, 'w:sdtContent') || { children: [] })
    }
  }
  replaceIn(body)
  if (!bodyPlaced) {
    body.children = [...content, ...(sect ? [sect] : [])]
    notes.push('模板中没有 {{正文}} 占位段落，已用生成内容替换模板全部正文（保留页面设置和页眉页脚）')
  }

  for (const n of walk(body)) if (n.name === 'w:p') replaceFields(n, fields, report)
  const files = new Map()
  files.set('word/document.xml', serializeDoc(doc))
  for (const name of zip.names()) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue
    const part = parseXml(zip.text(name))
    for (const n of walk(part.root)) if (n.name === 'w:p') replaceFields(n, fields, report)
    files.set(name, serializeDoc(part))
  }

  // 有目录域时，让 Word 打开文档时提示更新域
  if (tocPlaced && zip.has('word/settings.xml')) {
    const s = parseXml(zip.text('word/settings.xml'))
    if (!kid(s.root, 'w:updateFields')) {
      const after = ['w:hdrShapeDefaults', 'w:footnotePr', 'w:endnotePr', 'w:compat', 'w:docVars', 'w:rsids', 'm:mathPr', 'w:attachedSchema', 'w:themeFontLang', 'w:clrSchemeMapping', 'w:doNotIncludeSubdocsInStats', 'w:doNotAutoCompressPictures', 'w:forceUpgrade', 'w:captions', 'w:readModeInkLockDown', 'w:smartTagType', 'sl:schemaLibrary', 'w:shapeDefaults', 'w:doNotEmbedSmartTags', 'w:decimalSymbol', 'w:listSeparator']
      let idx = s.root.children.findIndex((c) => after.includes(c.name))
      if (idx < 0) idx = s.root.children.findIndex((c) => c.name && /^w1[45]:/.test(c.name))
      const node = { name: 'w:updateFields', attrs: { 'w:val': 'true' }, children: [] }
      if (idx < 0) s.root.children.push(node); else s.root.children.splice(idx, 0, node)
    }
    files.set('word/settings.xml', serializeDoc(s))
  }

  // .dotx 模板：主文档内容类型改为 .docx
  let ct = zip.text('[Content_Types].xml')
  ct = ct.replace('application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    .replace('application/vnd.ms-word.template.macroEnabledTemplate.main+xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
  files.set('[Content_Types].xml', ct)

  const out = [['[Content_Types].xml', files.get('[Content_Types].xml')]]
  for (const name of zip.names()) {
    if (name === '[Content_Types].xml' || name.endsWith('/')) continue
    if (/^word\/vbaProject\.bin$|^word\/vbaData\.xml$/.test(name)) continue
    out.push([name, files.has(name) ? files.get(name) : zip.get(name)])
  }

  const warnings = []
  if (report.missingFields.size) warnings.push(`以下模板字段没有提供，已填“【待补充】”：${[...report.missingFields].join('、')}`)
  if (ctx.missing.size) warnings.push(`模板中没有这些样式，已用正文样式加粗代替：${[...ctx.missing].join('、')}。可在模板同名 .json 中配置样式映射`)
  warnings.push(...ctx.flowWarnings)
  if (ctx.stats.markers) warnings.push(`文档中有 ${ctx.stats.markers} 处【待确认】/【待补充】标记（已黄色高亮），评审前必须全部清除`)
  if (ctx.stats.autoNumberOff) notes.push(`标题中手写的章节号与模板自动编号的顺序不一致（如跳过了某章），已保留手写章节号，并关闭了 ${ctx.stats.autoNumberOff} 个标题的自动编号`)
  if (ctx.stats.numbersStripped) notes.push(`模板标题样式带自动编号，已去掉 ${ctx.stats.numbersStripped} 个标题中手写的章节号，避免重复`)
  return {
    buffer: writeZip(out),
    stats: ctx.stats,
    fieldsFilled: [...report.filled],
    warnings,
    notes,
    tocInserted: tocPlaced,
  }
}
