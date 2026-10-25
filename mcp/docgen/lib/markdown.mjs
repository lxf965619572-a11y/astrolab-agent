// Markdown 块级解析：覆盖智能体生成文档时用到的语法。
// 块：标题、段落、列表（可嵌套）、GFM 表格、代码块、引用、分页（<!-- pagebreak -->）。
// 行内：**粗体**、*斜体*、`代码`、[链接](地址)、![图](地址)、<br>、反斜杠转义。

const isCJK = (ch) => !!ch && /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch)

/** 行内解析 → [{ text, b, i, code, br }] */
export function parseInline(src) {
  const out = []
  const push = (text, f = {}) => { if (text) out.push({ text, ...f }) }
  const re = /\\([\\`*_{}[\]()#+\-.!|<>~])|`([^`]+)`|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]*)[^)]*\)|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|<br\s*\/?>|<\/?(?:span|font|u|sup|sub)[^>]*>/gi
  let last = 0
  let m
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index))
    if (m[1] !== undefined) push(m[1])
    else if (m[2] !== undefined) push(m[2], { code: true })
    else if (m[3] !== undefined) push(`[图：${m[3] || '未命名'}]`)
    else if (m[4] !== undefined) { push(m[4]); if (m[5] && !m[5].startsWith('#') && m[5] !== m[4]) push(`（${m[5]}）`) }
    else if (m[6] !== undefined) for (const x of parseInline(m[6])) out.push({ ...x, b: true })
    else if (m[7] !== undefined) for (const x of parseInline(m[7])) out.push({ ...x, b: true })
    else if (m[8] !== undefined) for (const x of parseInline(m[8])) out.push({ ...x, i: true })
    else if (/^<br/i.test(m[0])) out.push({ br: true, text: '' })
    last = re.lastIndex
  }
  push(src.slice(last))
  return out
}

export const plainText = (inl) => inl.map((x) => (x.br ? '\n' : x.text)).join('')

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue }
    if (ch === '`') inCode = !inCode
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}
const SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
const LIST = /^(\s*)([-*+]|\d{1,3}[.)、])\s+(.*)$/
const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/

function joinLines(lines) {
  let s = ''
  for (const raw of lines) {
    const hard = / {2,}$/.test(raw) || /\\$/.test(raw)
    const l = raw.replace(/\\$/, '').trim()
    if (!s) s = l
    else if (s.endsWith('<br>')) s += l
    else if (isCJK(s[s.length - 1]) || isCJK(l[0])) s += l
    else s += ' ' + l
    if (hard) s += '<br>'
  }
  return s
}

/** 解析为块列表 */
export function parseMarkdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let para = []
  const flush = () => { if (para.length) { blocks.push({ type: 'paragraph', inlines: parseInline(joinLines(para)) }); para = [] } }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // HTML 注释（可跨行）；<!-- pagebreak --> 表示分页
    if (/^\s*<!--/.test(line)) {
      flush()
      let buf = line
      while (!buf.includes('-->') && i + 1 < lines.length) buf += '\n' + lines[++i]
      if (/<!--\s*(pagebreak|分页)\s*-->/i.test(buf)) blocks.push({ type: 'pagebreak' })
      i++
      continue
    }
    if (!line.trim()) { flush(); i++; continue }
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const body = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }
    const h = HEAD.exec(line)
    if (h) { flush(); blocks.push({ type: 'heading', level: h[1].length, inlines: parseInline(h[2]) }); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) && !para.length) { blocks.push({ type: 'hr' }); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && SEP.test(lines[i + 1]) && !para.length) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'))
      const rows = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]))
      const n = header.length
      blocks.push({
        type: 'table',
        align: Array.from({ length: n }, (_, k) => align[k] || 'left'),
        header: header.map(parseInline),
        rows: rows.map((r) => Array.from({ length: n }, (_, k) => parseInline(r[k] ?? ''))),
      })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const q = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      for (const part of q.join('\n').split(/\n\s*\n/)) if (part.trim()) blocks.push({ type: 'quote', inlines: parseInline(joinLines(part.split('\n'))) })
      continue
    }
    const li = LIST.exec(line)
    if (li && !para.length) {
      const items = []
      const indents = []
      while (i < lines.length) {
        const m = LIST.exec(lines[i])
        if (m) {
          const ind = m[1].replace(/\t/g, '    ').length
          while (indents.length && ind < indents[indents.length - 1]) indents.pop()
          if (!indents.length || ind > indents[indents.length - 1]) indents.push(ind)
          const ordered = /\d/.test(m[2])
          let text = m[3].replace(/^\[[ xX]\]\s+/, '')
          items.push({ level: indents.length - 1, ordered, marker: m[2], lines: [text] })
          i++
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].lines.push(lines[i].trim())
          i++
        } else break
      }
      blocks.push({ type: 'list', items: items.map((it) => ({ level: it.level, ordered: it.ordered, marker: it.marker, inlines: parseInline(joinLines(it.lines)) })) })
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return blocks
}
