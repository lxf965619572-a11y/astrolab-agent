// 实施方案 Markdown → Word：封面、修订记录、目录、正文；版式照 V0.2 的 .docx（A4、宋体/黑体、页眉、页码）
// 用法：node scripts/plan-to-docx.js 部门级智能体落地实施方案.md 部门级智能体落地实施方案.docx（需要 npm 包 docx；修订记录表在下面 revision 里，改版时一起改）
const fs = require('fs')
const d = require('docx')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType,
  ShadingType, BorderStyle, TableOfContents, Header, Footer, PageNumber, PageBreak, ExternalHyperlink, LevelFormat,
} = d

const [src, out] = process.argv.slice(2)
const md = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n')
const lines = md.split('\n')

const FONT_BODY = '宋体', FONT_HEAD = '黑体', FONT_CODE = 'Consolas'
const CONTENT_W = 11906 - 1134 * 2

// ── 行内：**粗体**、`代码`、[文字](链接) ──────────────────────────────
function inline(text, base = {}) {
  const runs = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|<b>([^<]+)<\/b>)/g
  let last = 0, m
  const plain = (t, extra = {}) => t && runs.push(new TextRun({ text: t, ...base, ...extra }))
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index))
    if (m[2] !== undefined) plain(m[2], { bold: true })
    else if (m[3] !== undefined) runs.push(new TextRun({ text: m[3], ...base, font: FONT_CODE, size: base.size ? base.size - 1 : 19 }))
    else if (m[4] !== undefined) {
      if (/^https?:/.test(m[5])) runs.push(new ExternalHyperlink({ link: m[5], children: [new TextRun({ text: m[4], ...base, style: 'Hyperlink' })] }))
      else plain(m[4])
    } else if (m[6] !== undefined) plain(m[6], { bold: true })
    last = re.lastIndex
  }
  plain(text.slice(last))
  return runs
}
const urlRuns = (text, base) => (/^https?:\/\/\S+$/.test(text.trim())
  ? [new ExternalHyperlink({ link: text.trim(), children: [new TextRun({ text: text.trim(), ...base, style: 'Hyperlink' })] })]
  : inline(text, base))

// ── 表格 ────────────────────────────────────────────────────────────
const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const vis = (s) => [...s.replace(/\*\*|`/g, '')].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)
function table(rows) {
  const header = rows[0], body = rows.slice(2)
  const n = header.length
  const all = [header, ...body]
  // 列宽按内容长度（开平方压缩差距），每列至少 900
  const weight = Array.from({ length: n }, (_, i) => Math.sqrt(Math.max(4, ...all.map((r) => Math.min(vis(r[i] || ''), 120)))))
  const sum = weight.reduce((a, b) => a + b, 0)
  let widths = weight.map((w) => Math.max(900, Math.round((w / sum) * CONTENT_W)))
  const k = CONTENT_W / widths.reduce((a, b) => a + b, 0)
  widths = widths.map((w) => Math.floor(w * k))
  widths[n - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0)
  const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const mk = (cells, head) => new TableRow({
    tableHeader: head,
    children: Array.from({ length: n }, (_, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders,
      shading: head ? { type: ShadingType.CLEAR, fill: 'E7E6E6', color: 'auto' } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: (cells[i] || '').split(/<br\s*\/?>/).map((part) => new Paragraph({
        spacing: { before: 0, after: 0, line: 280 },
        alignment: head ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: urlRuns(part, { size: 18, bold: head || undefined }),
      })),
    })),
  })
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: [mk(header, true), ...body.map((r) => mk(r, false))] })
}

// ── 正文 ────────────────────────────────────────────────────────────
const body = []
let i = 0
// 跳过标题、开头的版本说明块和 Markdown 目录：正文从“## 1 ”开始
while (i < lines.length && !/^## 1 /.test(lines[i])) i++
let olInstance = 0
const para = (children, opts = {}) => new Paragraph({ children, spacing: { after: 120, line: 340 }, ...opts })

while (i < lines.length) {
  const l = lines[i]
  if (!l.trim()) { i++; continue }
  let m
  if ((m = /^(#{2,4}) (.*)$/.exec(l))) {
    const level = { 2: HeadingLevel.HEADING_1, 3: HeadingLevel.HEADING_2, 4: HeadingLevel.HEADING_3 }[m[1].length]
    if (m[1].length === 2 && body.length) body.push(new Paragraph({ children: [new PageBreak()] }))
    body.push(new Paragraph({ heading: level, children: [new TextRun(m[2])] }))
    i++; continue
  }
  if (l.startsWith('```')) {
    const code = []
    i++
    while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
    i++
    code.forEach((c, j) => body.push(new Paragraph({
      spacing: { before: j === 0 ? 60 : 0, after: j === code.length - 1 ? 160 : 0, line: 260 },
      shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
      indent: { left: 120, right: 120 },
      keepNext: true,
      keepLines: true,
      children: [new TextRun({ text: c || ' ', font: FONT_CODE, size: 16 })],
    })))
    continue
  }
  if (l.startsWith('|')) {
    const rows = []
    while (i < lines.length && lines[i].startsWith('|')) rows.push(cellsOf(lines[i++]))
    body.push(table(rows))
    body.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    continue
  }
  if (l.startsWith('>')) {
    const q = []
    while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''))
    q.join('\n').split(/\n\s*\n/).forEach((t) => body.push(para(inline(t.replace(/\n/g, ''), { size: 20 }), {
      indent: { left: 360 },
      shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: '7F7F7F', space: 8 } },
    })))
    continue
  }
  if (/^\s*- /.test(l)) {
    while (i < lines.length && /^\s*- /.test(lines[i])) {
      const lvl = lines[i].match(/^\s*/)[0].length >= 2 ? 1 : 0
      body.push(para(inline(lines[i].replace(/^\s*- /, '')), { numbering: { reference: 'bullets', level: lvl }, spacing: { after: 60, line: 340 } }))
      i++
    }
    continue
  }
  if (/^\d+\. /.test(l)) {
    olInstance++
    while (i < lines.length && /^\d+\. /.test(lines[i])) {
      body.push(para(inline(lines[i].replace(/^\d+\. /, '')), { numbering: { reference: 'ordered', level: 0, instance: olInstance }, spacing: { after: 60, line: 340 } }))
      i++
    }
    continue
  }
  if ((m = /^\*\*(表 [^*]+)\*\*$/.exec(l.trim())) || (m = /^<p align="center"><b>([^<]+)<\/b><\/p>$/.exec(l.trim()))) {
    body.push(para([new TextRun({ text: m[1], bold: true, font: FONT_HEAD, size: 20 })], { alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 80 } }))
    i++; continue
  }
  // 普通段落：连续的非空行合成一段
  const p = []
  while (i < lines.length && lines[i].trim() && !/^(#{2,4} |```|\||>|\s*- |\d+\. )/.test(lines[i])) p.push(lines[i++])
  body.push(para(inline(p.join('')), { indent: { firstLine: 420 } }))
}

// ── 封面、修订记录、目录 ─────────────────────────────────────────────
const center = (text, size, opts = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, ...opts, children: [new TextRun({ text, size, font: opts.font || FONT_HEAD, bold: opts.bold })] })
const revision = [
  ['版本', '日期', '修订内容', '修订人'],
  ['---', '---', '---', '---'],
  ['V0.1', '2026-10-22', '初稿，供内部讨论', ''],
  ['V0.2', '2026-10-22', '按已确认情况修订：推理硬件改为昇腾 910，复用现有 DeepSeek-V4-Flash；增加 Windows 开发机使用方式；按 SPARC 与 D2000 两类目标平台设计工具链与单元测试；静态分析采用 Cppcheck', ''],
  ['V0.3', '2026-10-29', '按 10-26 确定的部署条件和《部门研发智能体工作台 需求规格说明》修订：使用形态改为 AstroLab 桌面工作台单机安装；推理硬件改为工控网 4 张 H200 上的 vLLM；第 8 章改为离线安装包；第 10 章改按开发阶段和关口 G0～G5；各章补入外网样机的实现情况和评测结果', ''],
]
const cover = [
  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: '密级：________（按实际填写）', size: 24 })] }),
  ...Array.from({ length: 6 }, () => new Paragraph({ children: [] })),
  center('基于 DeepSeek Harness 的', 44, { bold: true }),
  center('部门级智能体落地实施方案', 56, { bold: true, spacing: { after: 600 } }),
  center('—— 航天嵌入式软件部门 · 内网离线部署 ——', 28, { font: FONT_BODY }),
  ...Array.from({ length: 6 }, () => new Paragraph({ children: [] })),
  center('版本：V0.3（讨论稿）', 28, { font: FONT_BODY }),
  center('编制日期：2026 年 10 月', 28, { font: FONT_BODY, spacing: { after: 800 } }),
  center('编制：________    审核：________    批准：________', 24, { font: FONT_BODY }),
  new Paragraph({ children: [new PageBreak()] }),
  center('文档修订记录', 32, { bold: true }),
  table(revision),
  new Paragraph({ children: [new PageBreak()] }),
  center('目  录', 32, { bold: true }),
  new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),
]
if (body[0] instanceof Paragraph && false) body.shift()

const doc = new Document({
  creator: 'astrolab-agent',
  title: '基于 DeepSeek Harness 的部门级智能体落地实施方案',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: FONT_BODY }, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { ascii: 'Times New Roman', eastAsia: FONT_HEAD }, size: 32, bold: true }, paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { ascii: 'Times New Roman', eastAsia: FONT_HEAD }, size: 26, bold: true }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { ascii: 'Times New Roman', eastAsia: FONT_HEAD }, size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2, keepNext: true } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
      ] },
      { reference: 'ordered', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ] },
    ],
  },
  sections: [{
    properties: {
      titlePage: true,
      page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1134, bottom: 1440, left: 1134, header: 708, footer: 708 } },
    },
    headers: {
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '808080', space: 4 } }, children: [new TextRun({ text: '部门级智能体落地实施方案（讨论稿）', size: 18 })] })] }),
      first: new Header({ children: [new Paragraph({ children: [] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页'], size: 18 })] })] }),
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
    },
    children: [...cover, ...body],
  }],
})
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(out, b); console.log('ok', out, b.length) })
