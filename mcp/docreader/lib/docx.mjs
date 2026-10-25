// .docx → Markdown
// 处理：标题层级（样式名、大纲级别）、自动编号（章节号、列表号）、表格（横向/纵向合并）、
//       修订（按接受修订后的内容输出）、批注（附在文末）、脚注、文本框、公式文字。
// 跳过：目录域、页眉页脚、图片内容（只输出占位符）。

import { readZip } from '../../common/zip.mjs'
import { kid, kids, parseXml, path, val, walk } from '../../common/xml.mjs'

// —— 编号格式 ——
const CN = '零一二三四五六七八九'
function chineseNum(n) {
  if (n <= 0) return String(n)
  if (n < 10) return CN[n]
  if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '')
  if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '')
  return String(n)
}
function roman(n) {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = ''
  for (const [v, r] of t) while (n >= v) { s += r; n -= v }
  return s
}
const letters = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) } return s }
function fmtNum(n, fmt) {
  switch (fmt) {
    case 'decimalZero': return n < 10 ? '0' + n : String(n)
    case 'lowerLetter': return letters(n)
    case 'upperLetter': return letters(n).toUpperCase()
    case 'lowerRoman': return roman(n)
    case 'upperRoman': return roman(n).toUpperCase()
    case 'chineseCounting': case 'chineseCountingThousand': case 'taiwaneseCounting': case 'japaneseCounting': return chineseNum(n)
    case 'chineseLegalSimplified': return chineseNum(n).replace(/./g, (c) => '零壹贰叁肆伍陆柒捌玖拾'['零一二三四五六七八九十'.indexOf(c)] || c)
    case 'ideographTraditional': return '甲乙丙丁戊己庚辛壬癸'[n - 1] || String(n)
    case 'ideographZodiac': return '子丑寅卯辰巳午未申酉戌亥'[n - 1] || String(n)
    case 'decimalEnclosedCircle': case 'decimalEnclosedCircleChinese': return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`
    case 'decimalEnclosedParen': return `(${n})`
    case 'decimalFullWidth': case 'decimalFullWidth2': return String(n).replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)))
    case 'none': return ''
    default: return String(n)
  }
}

function loadStyles(zip) {
  const styles = new Map()
  let defaultPara
  const xml = zip.text('word/styles.xml')
  if (!xml) return { styles, defaultPara }
  for (const s of kids(parseXml(xml).root, 'w:style')) {
    if (s.attrs['w:type'] !== 'paragraph') continue
    const id = s.attrs['w:styleId']
    const pPr = kid(s, 'w:pPr')
    const numPr = kid(pPr, 'w:numPr')
    styles.set(id, {
      id,
      name: val(kid(s, 'w:name')) || id,
      basedOn: val(kid(s, 'w:basedOn')),
      outline: val(kid(pPr, 'w:outlineLvl')),
      numId: val(kid(numPr, 'w:numId')),
      ilvl: val(kid(numPr, 'w:ilvl')),
    })
    if (s.attrs['w:default'] === '1') defaultPara = id
  }
  return { styles, defaultPara }
}

function styleChain(styles, id) {
  const chain = []
  const seen = new Set()
  while (id && styles.has(id) && !seen.has(id)) { seen.add(id); const s = styles.get(id); chain.push(s); id = s.basedOn }
  return chain
}

function loadNumbering(zip) {
  const abstracts = new Map()
  const nums = new Map()
  const xml = zip.text('word/numbering.xml')
  if (!xml) return { abstracts, nums }
  const root = parseXml(xml).root
  for (const a of kids(root, 'w:abstractNum')) {
    const lvls = []
    for (const l of kids(a, 'w:lvl')) {
      lvls[Number(l.attrs['w:ilvl'])] = {
        start: Number(val(kid(l, 'w:start')) ?? 1),
        fmt: val(kid(l, 'w:numFmt')) || 'decimal',
        text: val(kid(l, 'w:lvlText')) ?? '',
        isLgl: !!kid(l, 'w:isLgl'),
        pStyle: val(kid(l, 'w:pStyle')),
      }
    }
    abstracts.set(a.attrs['w:abstractNumId'], { lvls, link: val(kid(a, 'w:numStyleLink')), styleLink: val(kid(a, 'w:styleLink')) })
  }
  for (const n of kids(root, 'w:num')) {
    const overrides = {}
    for (const o of kids(n, 'w:lvlOverride')) {
      const so = val(kid(o, 'w:startOverride'))
      if (so !== undefined) overrides[o.attrs['w:ilvl']] = Number(so)
    }
    nums.set(n.attrs['w:numId'], { abstractId: val(kid(n, 'w:abstractNumId')), overrides })
  }
  return { abstracts, nums }
}

function cellText(s) {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim()
}

export function docxToMarkdown(buf) {
  const zip = readZip(buf)
  const docXml = zip.text('word/document.xml')
  if (!docXml) throw new Error('不是 Word 文档：缺少 word/document.xml')
  const { styles, defaultPara } = loadStyles(zip)
  const { abstracts, nums } = loadNumbering(zip)
  const stats = { headings: 0, paragraphs: 0, tables: 0, images: 0, comments: 0, footnotes: 0, mergedTables: 0, revisions: false, tocSkipped: false }
  const warnings = []

  // —— 编号计数 ——
  const counters = new Map() // abstractId → number[]
  const seenNum = new Set()
  function numberFor(numId, ilvl, styleId) {
    if (!numId || numId === '0') return null
    const num = nums.get(numId)
    if (!num) return null
    let absId = num.abstractId
    let abs = abstracts.get(absId)
    if (abs && !abs.lvls.length && abs.link) {
      // numStyleLink：编号定义在另一个 abstractNum 中
      for (const [id, a] of abstracts) if (a.styleLink === abs.link) { absId = id; abs = a; break }
    }
    if (!abs) return null
    if (ilvl === undefined) {
      const i = abs.lvls.findIndex((l) => l && l.pStyle === styleId)
      ilvl = i >= 0 ? i : 0
    }
    ilvl = Number(ilvl)
    const lvl = abs.lvls[ilvl]
    if (!lvl) return null
    let c = counters.get(absId)
    if (!c) { c = []; counters.set(absId, c) }
    if (!seenNum.has(numId)) {
      seenNum.add(numId)
      for (const [l, v] of Object.entries(num.overrides)) c[Number(l)] = v - 1
    }
    c[ilvl] = c[ilvl] === undefined ? lvl.start : c[ilvl] + 1
    for (let k = ilvl + 1; k < c.length; k++) c[k] = undefined
    if (lvl.fmt === 'bullet') return { bullet: true, ilvl }
    const text = lvl.text.replace(/%(\d)/g, (_, d) => {
      const k = Number(d) - 1
      const lk = abs.lvls[k] || { start: 1, fmt: 'decimal' }
      const v = c[k] === undefined ? lk.start : c[k]
      return fmtNum(v, lvl.isLgl ? 'decimal' : lk.fmt)
    })
    return { bullet: false, ilvl, text }
  }

  // —— 批注与脚注 ——
  const comments = new Map()
  const footnotes = new Map()
  const usedFootnotes = []
  const openAnchors = new Set()
  const cx = zip.text('word/comments.xml')
  if (cx) {
    for (const c of kids(parseXml(cx).root, 'w:comment')) {
      const t = kids(c, 'w:p').map((p) => inlineText(p).text).filter(Boolean).join(' ')
      comments.set(c.attrs['w:id'], { author: c.attrs['w:author'] || '', text: t, anchor: '' })
    }
  }
  const fx = zip.text('word/footnotes.xml')
  if (fx) {
    for (const f of kids(parseXml(fx).root, 'w:footnote')) {
      if (f.attrs['w:type'] && f.attrs['w:type'] !== 'normal') continue
      footnotes.set(f.attrs['w:id'], kids(f, 'w:p').map((p) => inlineText(p).text).join(' ').trim())
    }
  }

  // 段落内文字（不处理段落属性）
  function inlineText(p) {
    const out = []
    const emit = (s) => {
      out.push(s)
      for (const id of openAnchors) { const c = comments.get(id); if (c) c.anchor += s }
    }
    const visit = (n) => {
      switch (n.name) {
        case 'w:t': case 'm:t': emit(n.children.map((c) => c.text ?? '').join('')); return
        case 'w:tab': case 'w:ptab': emit('\t'); return
        case 'w:br': if (n.attrs['w:type'] !== 'page' && n.attrs['w:type'] !== 'column') emit('\n'); return
        case 'w:cr': emit('\n'); return
        case 'w:noBreakHyphen': emit('-'); return
        case 'w:sym': {
          const code = parseInt(n.attrs['w:char'] || '', 16)
          if (code && (code < 0xe000 || code > 0xf8ff)) emit(String.fromCodePoint(code))
          return
        }
        case 'w:pPr': case 'w:rPr': case 'w:instrText': case 'w:delText': case 'w:delInstrText': return
        case 'w:del': case 'w:moveFrom': stats.revisions = true; return
        case 'w:ins': case 'w:moveTo': stats.revisions = true; break
        case 'w:commentRangeStart': openAnchors.add(n.attrs['w:id']); return
        case 'w:commentRangeEnd': openAnchors.delete(n.attrs['w:id']); return
        case 'w:footnoteReference': {
          const id = n.attrs['w:id']
          if (footnotes.has(id)) { usedFootnotes.push(id); emit(`[^${usedFootnotes.length}]`) }
          return
        }
        case 'mc:AlternateContent': {
          const choice = kid(n, 'mc:Choice') || kid(n, 'mc:Fallback')
          if (choice) choice.children.forEach(visit)
          return
        }
        case 'w:drawing': case 'w:pict': case 'w:object': {
          const boxes = []
          for (const d of walk(n)) {
            if (d.name === 'w:txbxContent') {
              const t = kids(d, 'w:p').map((pp) => inlineText(pp).text).filter(Boolean).join(' ')
              if (t) boxes.push(t)
            }
          }
          if (boxes.length) emit(`[文本框：${boxes.join('；')}]`)
          else { stats.images++; emit('[图片]') }
          return
        }
      }
      for (const c of n.children || []) if (c.name) visit(c)
    }
    for (const c of p.children) if (c.name) visit(c)
    return { text: out.join('').replace(/[  ]+$/g, '') }
  }

  function paraInfo(p) {
    const pPr = kid(p, 'w:pPr')
    const styleId = val(kid(pPr, 'w:pStyle')) || defaultPara
    const chain = styleChain(styles, styleId)
    const names = chain.map((s) => s.name)
    let level = null
    const direct = val(kid(pPr, 'w:outlineLvl'))
    if (direct !== undefined) level = Number(direct) < 9 ? Number(direct) + 1 : null
    else {
      for (const s of chain) {
        const m = /^(?:heading|标题)\s*(\d)$/i.exec(s.name)
        if (m) { level = Number(m[1]); break }
        if (s.outline !== undefined) { level = Number(s.outline) < 9 ? Number(s.outline) + 1 : null; break }
      }
    }
    const isTitle = names.some((n) => /^(title|标题)$/i.test(n))
    const isToc = names.some((n) => /^(toc\s*\d*|toc heading|目录\s*\d*)$/i.test(n))
    let numId, ilvl
    const numPr = kid(pPr, 'w:numPr')
    if (numPr) { numId = val(kid(numPr, 'w:numId')); ilvl = val(kid(numPr, 'w:ilvl')) }
    else for (const s of chain) if (s.numId !== undefined) { numId = s.numId; ilvl = s.ilvl; break }
    return { level, isTitle, isToc, numId, ilvl, styleId }
  }

  const blocks = []
  const outline = []

  function doPara(p) {
    const info = paraInfo(p)
    if (info.isToc) { stats.tocSkipped = true; return }
    let { text } = inlineText(p)
    const num = numberFor(info.numId, info.ilvl, info.styleId)
    if (!text.trim()) return
    text = text.trim()
    if (info.level) {
      const t = (num && !num.bullet && num.text ? num.text + ' ' : '') + text.replace(/\n/g, ' ')
      blocks.push({ type: 'h', md: `${'#'.repeat(Math.min(info.level, 6))} ${t.trim()}` })
      outline.push({ level: info.level, text: t.trim() })
      stats.headings++
      return
    }
    if (info.isTitle) { blocks.push({ type: 'h', md: `# ${text}` }); outline.push({ level: 1, text }); return }
    stats.paragraphs++
    const body = text.replace(/\n/g, '  \n')
    if (num) {
      const indent = '  '.repeat(num.ilvl)
      blocks.push({ type: 'li', md: num.bullet ? `${indent}- ${body}` : `${indent}${num.text} ${body}` })
    } else blocks.push({ type: 'p', md: body })
  }

  // 表格：返回二维文本数组
  function tableGrid(tbl) {
    const rows = []
    const header = []
    let merged = false
    for (const tr of kids(tbl, 'w:tr')) {
      const trPr = kid(tr, 'w:trPr')
      const row = []
      let col = Number(val(kid(trPr, 'w:gridBefore')) || 0)
      for (let i = 0; i < col; i++) row[i] = ''
      const cells = []
      for (const c of tr.children) {
        if (c.name === 'w:tc') cells.push(c)
        else if (c.name === 'w:sdt') cells.push(...kids(kid(c, 'w:sdtContent'), 'w:tc'))
      }
      for (const tc of cells) {
        const tcPr = kid(tc, 'w:tcPr')
        const span = Number(val(kid(tcPr, 'w:gridSpan')) || 1)
        const vm = kid(tcPr, 'w:vMerge')
        let t
        if (vm && vm.attrs['w:val'] !== 'restart') {
          merged = true
          const above = rows.length ? rows[rows.length - 1][col] : ''
          t = above ?? ''
        } else {
          const parts = []
          for (const c of tc.children) {
            if (c.name === 'w:p') { const x = inlineText(c).text.trim(); if (x) parts.push(x) }
            else if (c.name === 'w:tbl') parts.push(tableGrid(c).rows.map((r) => r.filter(Boolean).join(' / ')).join('；'))
            else if (c.name === 'w:sdt') for (const pp of kids(kid(c, 'w:sdtContent'), 'w:p')) { const x = inlineText(pp).text.trim(); if (x) parts.push(x) }
          }
          t = parts.join('\n')
        }
        if (span > 1) merged = true
        row[col] = t
        for (let k = 1; k < span; k++) row[col + k] = ''
        col += span
      }
      rows.push(row)
      header.push(!!kid(trPr, 'w:tblHeader'))
    }
    return { rows, header, merged }
  }

  function doTable(tbl) {
    const { rows, header, merged } = tableGrid(tbl)
    if (!rows.length) return
    stats.tables++
    if (merged) stats.mergedTables++
    const ncol = Math.max(...rows.map((r) => r.length))
    for (const r of rows) for (let i = 0; i < ncol; i++) if (r[i] === undefined) r[i] = ''
    if (ncol === 1 && rows.length === 1) {
      blocks.push({ type: 'p', md: rows[0][0].split('\n').map((l) => `> ${l}`).join('\n') })
      return
    }
    let nh = 0
    while (nh < rows.length && header[nh]) nh++
    if (nh === 0) nh = 1
    const head = []
    for (let i = 0; i < ncol; i++) {
      const vals = []
      for (let r = 0; r < nh; r++) if (rows[r][i] && !vals.includes(rows[r][i])) vals.push(rows[r][i])
      head.push(cellText(vals.join(' / ')) || ' ')
    }
    const lines = [`| ${head.join(' | ')} |`, `|${' --- |'.repeat(ncol)}`]
    for (const r of rows.slice(nh)) lines.push(`| ${r.map(cellText).join(' | ')} |`)
    blocks.push({ type: 'table', md: lines.join('\n') })
  }

  function doBody(node) {
    for (const c of node.children) {
      if (c.name === 'w:p') doPara(c)
      else if (c.name === 'w:tbl') doTable(c)
      else if (c.name === 'w:sdt') {
        // 内容控件；Word 自动目录通常放在这里
        const gallery = val(path(c, 'w:sdtPr', 'w:docPartObj', 'w:docPartGallery'))
        if (gallery && /table of contents/i.test(gallery)) { stats.tocSkipped = true; continue }
        const content = kid(c, 'w:sdtContent')
        if (content) doBody(content)
      } else if (c.name === 'w:customXml' || c.name === 'w:ins' || c.name === 'w:moveTo') doBody(c)
    }
  }

  const body = kid(parseXml(docXml).root, 'w:body')
  doBody(body)

  let md = ''
  for (let i = 0; i < blocks.length; i++) {
    if (i) md += blocks[i].type === 'li' && blocks[i - 1].type === 'li' ? '\n' : '\n\n'
    md += blocks[i].md
  }
  if (usedFootnotes.length) {
    md += '\n\n---\n\n' + usedFootnotes.map((id, i) => `[^${i + 1}]: ${footnotes.get(id)}`).join('\n')
    stats.footnotes = usedFootnotes.length
  }
  if (comments.size) {
    stats.comments = comments.size
    md += '\n\n## 批注\n\n' + [...comments.values()].map((c, i) =>
      `${i + 1}. ${c.author ? `（${c.author}）` : ''}${c.anchor.trim() ? `针对“${c.anchor.replace(/\s+/g, ' ').trim().slice(0, 80)}”：` : ''}${c.text}`).join('\n')
  }

  if (stats.revisions) warnings.push('文档含修订痕迹，已按“接受全部修订”后的内容输出')
  if (stats.mergedTables) warnings.push(`${stats.mergedTables} 个表格含合并单元格：纵向合并已把内容向下填充到每一行，横向合并的内容只保留在第一格`)
  if (stats.images) warnings.push(`${stats.images} 处图片只输出了“[图片]”占位符，图中的内容（框图、时序图等）需要人工查看`)
  if (stats.tocSkipped) warnings.push('已跳过文档中的目录')
  if (stats.comments) warnings.push(`文档含 ${stats.comments} 条批注，已附在文末“批注”一节`)
  return { markdown: md + '\n', outline, stats, warnings }
}
