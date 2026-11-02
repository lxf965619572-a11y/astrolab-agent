// 资料阅读器的高亮：按“引文 + 前后文”定位（原文改过一点也大多能找回位置），在渲染好的文字上包 <mark>。
// 一种语言的所有段落（对照视图里是一列格子）当成一整串文字处理，高亮可以跨段。

export interface Anchor { quote: string; prefix: string; suffix: string }
export interface Mark extends Anchor { id: string; color: string; note: string }

function textNodes(roots: Element[]): Text[] {
  const out: Text[] = []
  for (const r of roots) {
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text)
  }
  return out
}

function stream(roots: Element[]) {
  const nodes = textNodes(roots)
  const starts: number[] = []
  let text = ''
  for (const n of nodes) { starts.push(text.length); text += n.data }
  return { nodes, starts, text }
}

const commonTail = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i }
const commonHead = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }

/** 在整串文字里找引文：多处出现时按前后文最像的那处 */
export function locate(full: string, a: Anchor): [number, number] | null {
  if (!a.quote) return null
  let best = -1, score = -1
  for (let i = full.indexOf(a.quote); i >= 0; i = full.indexOf(a.quote, i + 1)) {
    const s = commonTail(full.slice(Math.max(0, i - a.prefix.length), i), a.prefix) + commonHead(full.slice(i + a.quote.length, i + a.quote.length + a.suffix.length), a.suffix)
    if (s > score) { score = s; best = i }
  }
  return best < 0 ? null : [best, best + a.quote.length]
}

/** 去掉之前包的 <mark> */
export function clearMarks(roots: Element[]) {
  for (const r of roots) {
    r.querySelectorAll('mark.hl').forEach((m) => { m.replaceWith(...Array.from(m.childNodes)) })
    r.normalize()
  }
}

/** 包上高亮；返回找不到位置的高亮 id（原文改得太多） */
export function applyMarks(roots: Element[], marks: Mark[]): string[] {
  clearMarks(roots)
  const lost: string[] = []
  // 一个一个包：每包一个，文字节点会被拆开，所以每次重新取
  for (const m of marks) {
    const { nodes, starts, text } = stream(roots)
    const at = locate(text, m)
    if (!at) { lost.push(m.id); continue }
    const [s, e] = at
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], ns = starts[i], ne = ns + n.data.length
      if (ne <= s || ns >= e) continue
      const a = Math.max(s, ns) - ns, b = Math.min(e, ne) - ns
      let target = n
      if (a > 0) target = target.splitText(a)
      if (b - a < target.data.length) target.splitText(b - a)
      const mark = document.createElement('mark')
      mark.className = `hl hl-${m.color}${m.note ? ' has-note' : ''}`
      mark.dataset.hid = m.id
      if (m.note) mark.title = m.note
      target.replaceWith(mark)
      mark.appendChild(target)
    }
  }
  return lost
}

/** 当前选区在这串文字里的位置：{ quote, prefix, suffix, rect }；不在里面或太短返回 null */
export function selectionAnchor(roots: Element[]): (Anchor & { rect: DOMRect }) | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!roots.some((r) => r.contains(range.startContainer)) || !roots.some((r) => r.contains(range.endContainer))) return null
  const { nodes, starts, text } = stream(roots)
  const pos = (node: Node, off: number) => {
    if (node.nodeType === Node.TEXT_NODE) { const i = nodes.indexOf(node as Text); return i < 0 ? -1 : starts[i] + off }
    // 选区端点在元素上：取这个元素里第 off 个子节点之前的文字长度
    const child = node.childNodes[off]
    const after = child ? nodes.findIndex((t) => child === t || child.contains(t)) : -1
    if (after >= 0) return starts[after]
    const inside = nodes.filter((t) => node.contains(t))
    return inside.length ? starts[nodes.indexOf(inside[inside.length - 1])] + inside[inside.length - 1].data.length : -1
  }
  const s = pos(range.startContainer, range.startOffset), e = pos(range.endContainer, range.endOffset)
  if (s < 0 || e <= s) return null
  const quote = text.slice(s, e)
  if (quote.trim().length < 2) return null
  // 去掉两头的空白（位置跟着挪）
  const lead = quote.length - quote.trimStart().length, trail = quote.length - quote.trimEnd().length
  const qs = s + lead, qe = e - trail
  return { quote: text.slice(qs, qe), prefix: text.slice(Math.max(0, qs - 40), qs), suffix: text.slice(qe, qe + 40), rect: range.getBoundingClientRect() }
}
