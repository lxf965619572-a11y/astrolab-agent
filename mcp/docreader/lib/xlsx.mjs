// .xlsx → Markdown：每个工作表一节，内容为 Markdown 表格。
// 处理：共享字符串、富文本、内联字符串、布尔、错误值、日期格式、合并单元格（内容填充到合并区域每一格）。
// 不计算公式，使用文件中缓存的计算结果；没有缓存结果的公式单元格输出“=公式”。

import { readZip } from '../../common/zip.mjs'
import { kid, kids, parseXml, textOf, val } from '../../common/xml.mjs'

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
function excelDate(serial, withTime) {
  const ms = Math.round((serial - 25569) * 86400000)
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  return withTime ? `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : day
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim()

export function xlsxToMarkdown(buf, { sheet: onlySheet } = {}) {
  const zip = readZip(buf)
  const wb = zip.text('xl/workbook.xml')
  if (!wb) throw new Error('不是 Excel 文档：缺少 xl/workbook.xml')
  const rels = new Map()
  const relXml = zip.text('xl/_rels/workbook.xml.rels')
  if (relXml) for (const r of kids(parseXml(relXml).root, 'Relationship')) rels.set(r.attrs.Id, r.attrs.Target)

  const shared = []
  const ss = zip.text('xl/sharedStrings.xml')
  if (ss) for (const si of kids(parseXml(ss).root, 'si')) shared.push(textOf(si, (n) => n.name === 'rPh' || n.name === 'phoneticPr'))

  // 样式：找出日期格式的 xf 序号
  const dateXf = new Set()
  const st = zip.text('xl/styles.xml')
  if (st) {
    const root = parseXml(st).root
    const custom = new Map()
    for (const f of kids(kid(root, 'numFmts'), 'numFmt')) custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode || '')
    kids(kid(root, 'cellXfs'), 'xf').forEach((xf, i) => {
      const id = Number(xf.attrs.numFmtId || 0)
      const code = custom.get(id)
      if (BUILTIN_DATE.has(id) || (code && /[ymd]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]*$/.test(code))) dateXf.add(i)
    })
  }

  const sheets = kids(kid(parseXml(wb).root, 'sheets'), 'sheet')
  const parts = []
  const outline = []
  const stats = { sheets: 0, rows: 0, merged: 0 }
  for (const sh of sheets) {
    const name = sh.attrs.name
    if (onlySheet && onlySheet !== name) continue
    if (sh.attrs.state === 'hidden' || sh.attrs.state === 'veryHidden') continue
    let target = rels.get(sh.attrs['r:id']) || ''
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
    const xml = zip.text(target)
    if (!xml) continue
    const root = parseXml(xml).root
    const grid = []
    for (const row of kids(kid(root, 'sheetData'), 'row')) {
      let autoC = 0
      const rIdx = row.attrs.r ? Number(row.attrs.r) - 1 : grid.length
      for (const c of kids(row, 'c')) {
        const ref = c.attrs.r ? parseRef(c.attrs.r) : { r: rIdx, c: autoC }
        autoC = ref.c + 1
        const t = c.attrs.t
        const v = textOf(kid(c, 'v'))
        let out = ''
        if (t === 's') out = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') out = textOf(kid(c, 'is'), (n) => n.name === 'rPh')
        else if (t === 'b') out = v === '1' ? 'TRUE' : 'FALSE'
        else if (t === 'str' || t === 'e') out = v
        else if (v !== '') {
          const num = Number(v)
          out = dateXf.has(Number(c.attrs.s || 0)) && Number.isFinite(num) ? excelDate(num, num % 1 !== 0) : v
        } else if (kid(c, 'f')) out = '=' + textOf(kid(c, 'f'))
        if (out === '') continue
        ;(grid[ref.r] ||= [])[ref.c] = out
      }
    }
    for (const m of kids(kid(root, 'mergeCells'), 'mergeCell')) {
      const [a, b] = (m.attrs.ref || '').split(':').map(parseRef)
      if (!a || !b) continue
      stats.merged++
      const v = grid[a.r]?.[a.c] ?? ''
      for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) (grid[r] ||= [])[c] = v
    }
    // 去掉空行，确定列数
    const rows = grid.filter((r) => r && r.some((x) => x !== undefined && x !== ''))
    if (!rows.length) { parts.push(`## ${name}\n\n（空工作表）`); outline.push({ level: 2, text: name }); continue }
    let ncol = 0
    for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (r[i] !== undefined && r[i] !== '') { ncol = Math.max(ncol, i + 1); break }
    let first = 0
    while (first < ncol && rows.every((r) => r[first] === undefined || r[first] === '')) first++
    const norm = rows.map((r) => Array.from({ length: ncol - first }, (_, i) => cell(r[i + first] ?? '')))
    const lines = [`| ${norm[0].map((x) => x || ' ').join(' | ')} |`, `|${' --- |'.repeat(ncol - first)}`]
    for (const r of norm.slice(1)) lines.push(`| ${r.join(' | ')} |`)
    parts.push(`## ${name}\n\n${lines.join('\n')}`)
    outline.push({ level: 2, text: `${name}（${rows.length} 行 × ${ncol - first} 列）` })
    stats.sheets++
    stats.rows += rows.length
  }
  const warnings = []
  if (stats.merged) warnings.push(`含 ${stats.merged} 处合并单元格，内容已填充到合并区域的每一格`)
  if (onlySheet && !stats.sheets) throw new Error(`没有名为“${onlySheet}”的工作表。可选：${sheets.map((s) => s.attrs.name).join('、')}`)
  return { markdown: parts.join('\n\n') + '\n', outline, stats, warnings }
}
