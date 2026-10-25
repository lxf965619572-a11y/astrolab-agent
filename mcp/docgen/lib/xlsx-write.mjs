// Markdown 表格 → .xlsx：每个表格一个工作表，工作表名取表格前最近的标题或题注。
// 格式：表头加粗、灰底、冻结、自动筛选；全表细边框、自动换行；【待确认】等标记所在单元格黄底。

import { writeZip } from '../../common/zip.mjs'
import { cleanText, escAttr, escText } from '../../common/xml.mjs'
import { parseMarkdown, plainText } from './markdown.mjs'

const MARK = /【待确认】|【待补充】|【待定】|【TBD】/
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }
const width = (s) => [...s].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 2 : 1), 0)

function sheetName(raw, used) {
  let n = cleanText(raw).replace(/[\\/?*[\]:：]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || '表格'
  let k = 2
  const base = n
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)}(${k++})`
  used.add(n.toLowerCase())
  return n
}

/**
 * 从 Markdown 中取出表格。
 * include：只要题注、所在标题或上一级标题包含该文字的表格（如“需求条目”可匹配 6.1～6.11 下的全部表格）
 * merge：表头完全相同的表格合并为一个工作表（默认 true）
 * reviewColumns：在每个表格右侧追加的空白列，供评审时填写，如 ["评审意见", "处理结果"]
 */
export function extractTables(markdown, { include, merge = true, reviewColumns = [] } = {}) {
  const blocks = parseMarkdown(markdown)
  let tables = []
  const stack = [] // stack[level] = 标题文字
  let caption = ''
  for (const b of blocks) {
    if (b.type === 'heading') {
      stack[b.level] = plainText(b.inlines).trim()
      stack.length = b.level + 1
      caption = ''
    } else if (b.type === 'paragraph') {
      const t = plainText(b.inlines).trim()
      caption = /^(表|图)\s*[A-Z]?\d+([-.．]\d+)*[\s　]+\S/.test(t) && t.length <= 80 ? t : ''
    } else if (b.type === 'table') {
      const heads = stack.filter(Boolean)
      const heading = heads[heads.length - 1] || ''
      const parent = heads.length > 1 ? heads[heads.length - 2] : ''
      const title = caption || heading || `表格${tables.length + 1}`
      if (!include || [title, heading, parent].some((s) => s.includes(include))) {
        tables.push({ title, heading, parent, header: b.header.map((c) => plainText(c).trim()), rows: b.rows.map((r) => r.map((c) => plainText(c).trim())) })
      }
      caption = ''
    } else caption = ''
  }
  if (merge) {
    const groups = []
    for (const t of tables) {
      const key = t.header.join('\u0001')
      const g = groups.find((x) => x.key === key)
      if (g) g.items.push(t); else groups.push({ key, items: [t] })
    }
    tables = groups.map(({ items }) => {
      if (items.length === 1) return items[0]
      const parents = new Set(items.map((t) => t.parent))
      const title = parents.size === 1 && items[0].parent ? items[0].parent : `${items[0].title} 等 ${items.length} 个表`
      return { title, header: items[0].header, rows: items.flatMap((t) => t.rows), mergedFrom: items.map((t) => t.title) }
    })
  }
  if (reviewColumns.length) {
    for (const t of tables) {
      t.reviewFrom = t.header.length
      t.header = [...t.header, ...reviewColumns]
      t.rows = t.rows.map((r) => [...r, ...reviewColumns.map(() => '')])
    }
  }
  return tables
}

function sheetXml(t) {
  const ncol = t.header.length
  const all = [t.header, ...t.rows]
  const widths = Array.from({ length: ncol }, (_, k) => k >= (t.reviewFrom ?? Infinity) ? 30 :
    Math.min(60, Math.max(6, ...all.map((r) => Math.max(...String(r[k] ?? '').split('\n').map(width))) ) + 2))
  let rows = ''
  all.forEach((r, i) => {
    let cells = ''
    for (let k = 0; k < ncol; k++) {
      const v = String(r[k] ?? '')
      const ref = `${colName(k)}${i + 1}`
      const style = i === 0 ? 1 : MARK.test(v) ? 3 : 2
      if (i > 0 && /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v)) cells += `<c r="${ref}" s="${style}"><v>${v}</v></c>`
      else cells += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escText(cleanText(v))}</t></is></c>`
    }
    rows += `<row r="${i + 1}">${cells}</row>`
  })
  const last = `${colName(ncol - 1)}${all.length}`
  return `${DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    (t.rows.length ? `<autoFilter ref="A1:${last}"/>` : '') +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>'
}

const STYLES = `${DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="10.5"/><name val="宋体"/><charset val="134"/></font><font><b/><sz val="10.5"/><name val="宋体"/><charset val="134"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function definedNames(tables, names) {
  const items = tables.map((t, i) => (t.rows.length
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escText(names[i].replace(/'/g, "''"))}'!$A$1:$${colName(t.header.length - 1)}$${t.rows.length + 1}</definedName>`
    : '')).join('')
  return items ? `<definedNames>${items}</definedNames>` : ''
}

export function renderXlsx(tables) {
  const used = new Set()
  const names = tables.map((t) => sheetName(t.title, used))
  const files = [
    ['[Content_Types].xml', `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${escAttr(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      definedNames(tables, names) + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...tables.map((t, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(t)]),
  ]
  const markers = tables.reduce((n, t) => n + t.rows.flat().filter((v) => MARK.test(v)).length, 0)
  return { buffer: writeZip(files), sheets: names.map((n, i) => ({ name: n, rows: tables[i].rows.length, cols: tables[i].header.length })), markers }
}
