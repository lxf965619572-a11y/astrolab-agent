// 流程图：Mermaid flowchart 子集 → 布局 → Word 图形（DrawingML 组合图形，Word 2010 及以上、WPS、LibreOffice 可显示和编辑）
//
// 支持的写法（自上而下）：
//   flowchart TD            （或 graph TD / TB）
//   A([开始])               开始/结束（圆角框）
//   B[处理步骤]             处理（矩形）
//   C{判断条件?}            判断（菱形）
//   D[/输入或输出/]         输入/输出（平行四边形）
//   E[[调用子函数]]         子程序（双竖边矩形）
//   A --> B                 连线；A -- 是 --> B、A -->|是| B 带标注；A --> B --> C 连写
//   %% 注释
// 不支持：subgraph、classDef/style、& 连写、其他方向（LR 等）。不支持的写法会报错，由调用方退回为代码块。

const SHAPES = [
  ['([', '])', 'terminal'],
  ['[[', ']]', 'subroutine'],
  ['[/', '/]', 'io'],
  ['((', '))', 'terminal'],
  ['{', '}', 'decision'],
  ['[', ']', 'process'],
  ['(', ')', 'terminal'],
]

export function parseFlowchart(src) {
  const lines = src.split(/\r?\n/).map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean)
  const errors = []
  if (!lines.length || !/^(flowchart|graph)\s+(TD|TB)\s*;?$/i.test(lines[0])) {
    return { errors: ['第一行应为 “flowchart TD”（只支持自上而下的流程图）'] }
  }
  const nodes = new Map()
  const edges = []
  const node = (id, shape, text) => {
    let n = nodes.get(id)
    if (!n) { n = { id, shape: 'process', text: id, defined: false, order: nodes.size }; nodes.set(id, n) }
    if (shape && !n.defined) { n.shape = shape; n.text = text; n.defined = true }
    return n
  }
  const unq = (t) => t.trim().replace(/^"(.*)"$/, '$1').replace(/<br\s*\/?>/gi, '\n')

  lines.slice(1).forEach((line, li) => {
    const ln = li + 2
    if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction)\b/.test(line)) { errors.push(`第 ${ln} 行：不支持 “${line.split(/\s/)[0]}”`); return }
    let s = line.replace(/;$/, '')
    let pos = 0
    const skip = () => { while (pos < s.length && /\s/.test(s[pos])) pos++ }
    const readNode = () => {
      skip()
      const m = /^[A-Za-z_一-龥][\w一-龥]*/.exec(s.slice(pos))
      if (!m) return null
      pos += m[0].length
      for (const [open, close, shape] of SHAPES) {
        if (s.startsWith(open, pos)) {
          const end = s.indexOf(close, pos + open.length)
          if (end < 0) { errors.push(`第 ${ln} 行：节点 ${m[0]} 缺少 “${close}”`); pos = s.length; return node(m[0]) }
          const text = unq(s.slice(pos + open.length, end))
          pos = end + close.length
          return node(m[0], shape, text)
        }
      }
      return node(m[0])
    }
    const readEdge = () => {
      skip()
      const rest = s.slice(pos)
      let m
      if ((m = /^--\s*([^-|>][^>]*?)\s*-->/.exec(rest))) { pos += m[0].length; return { label: unq(m[1]) } }
      if ((m = /^(-->|==>|-\.->|---)\s*(?:\|([^|]*)\|)?/.exec(rest))) { pos += m[0].length; return { label: m[2] ? unq(m[2]) : '' } }
      return null
    }
    let prev = readNode()
    if (!prev) { errors.push(`第 ${ln} 行：无法识别 “${line}”`); return }
    for (;;) {
      skip()
      if (pos >= s.length) break
      const e = readEdge()
      if (!e) { errors.push(`第 ${ln} 行：无法识别 “${s.slice(pos)}”（连线写作 -->、-- 标注 --> 或 -->|标注|）`); break }
      const next = readNode()
      if (!next) { errors.push(`第 ${ln} 行：连线后缺少节点`); break }
      edges.push({ from: prev.id, to: next.id, label: e.label, order: edges.length })
      prev = next
    }
  })
  if (!nodes.size) errors.push('没有节点')
  return { nodes: [...nodes.values()], edges, errors }
}

// —— 尺寸（单位 pt）——
const FONT = 9
const charW = (ch) => (/[⺀-￿]/.test(ch) ? FONT : FONT * 0.55)
const textW = (t) => [...t].reduce((a, c) => a + charW(c), 0)
function wrapLines(text, maxW) {
  const out = []
  for (const para of text.split('\n')) {
    let cur = '', w = 0
    // 汉字逐字可断；英文、数字、标识符整体不断开
    for (const tok of para.match(/[A-Za-z0-9_.+\-*\/=<>!&|^%~]+|\s+|./gu) || []) {
      const tw = textW(tok)
      if (w + tw > maxW && cur.trim()) { out.push(cur.trimEnd()); cur = ''; w = 0; if (/^\s+$/.test(tok)) continue }
      cur += tok; w += tw
    }
    out.push(cur.trimEnd())
  }
  return out
}
const LINE_H = 12

function sizeOf(n) {
  const tw = Math.max(...n.text.split('\n').map(textW), FONT * 2)
  if (n.shape === 'decision') {
    const w = Math.min(Math.max(tw + 56, 90), 180)
    const lines = wrapLines(n.text, w - 52).length
    return { w, h: Math.max(40, lines * LINE_H + 26), lines }
  }
  const pad = n.shape === 'io' ? 30 : n.shape === 'subroutine' ? 24 : 16
  const w = Math.min(Math.max(tw + pad, n.shape === 'terminal' ? 60 : 64), 160)
  const lines = wrapLines(n.text, w - pad).length
  return { w, h: Math.max(n.shape === 'terminal' ? 22 : 24, lines * LINE_H + 10), lines }
}

export function layoutFlowchart({ nodes, edges }) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) Object.assign(n, sizeOf(n))
  const out = new Map(nodes.map((n) => [n.id, edges.filter((e) => e.from === n.id)]))

  // 1. 深度优先找回边（指向祖先的边，即循环）
  const state = new Map()
  const disc = new Map()
  const visit = (id) => {
    state.set(id, 1)
    disc.set(id, disc.size)
    for (const e of out.get(id)) {
      const st = state.get(e.to)
      if (st === 1) e.back = true
      else if (!st) visit(e.to)
    }
    state.set(id, 2)
  }
  const roots = nodes.filter((n) => !edges.some((e) => e.to === n.id))
  for (const r of roots.length ? roots : [nodes[0]]) if (!state.get(r.id)) visit(r.id)
  for (const n of nodes) if (!state.get(n.id)) visit(n.id)
  const fwd = edges.filter((e) => !e.back)

  // 2. 分层：最长路径
  const rank = new Map(nodes.map((n) => [n.id, 0]))
  const topo = [...nodes].sort((a, b) => disc.get(a.id) - disc.get(b.id))
  for (let changed = true, guard = 0; changed && guard < nodes.length + 2; guard++) {
    changed = false
    for (const e of fwd) if (rank.get(e.to) < rank.get(e.from) + 1) { rank.set(e.to, rank.get(e.from) + 1); changed = true }
  }

  // 3. 列：后续路径最长的分支沿用父节点的列（主流程保持竖直），其余分支（如提前返回）依次放到右侧
  const height = new Map()
  const hOf = (id, seen = new Set()) => {
    if (height.has(id)) return height.get(id)
    if (seen.has(id)) return 0
    seen.add(id)
    let h = 0
    for (const e of out.get(id)) if (!e.back) h = Math.max(h, 1 + hOf(e.to, seen))
    height.set(id, h)
    return h
  }
  for (const n of nodes) hOf(n.id)
  const col = new Map()
  const fwdIn = (id) => edges.filter((e) => !e.back && e.to === id).length
  const order = [...nodes].sort((a, b) => rank.get(a.id) - rank.get(b.id) || disc.get(a.id) - disc.get(b.id))
  for (const n of order) {
    if (!col.has(n.id)) col.set(n.id, 0)
    const succ = out.get(n.id).filter((e) => !e.back)
      .map((e, i) => ({ e, i, h: height.get(e.to) + (out.get(e.to).length ? 0.5 : 0) }))
      .sort((x, y) => y.h - x.h || x.i - y.i)
    let k = 0
    for (const { e } of succ) {
      if (k === 0 && col.has(e.to) && col.get(n.id) < col.get(e.to)) col.set(e.to, col.get(n.id)) // 汇合点放在最左（主线）的前驱所在列
      if (!col.has(e.to)) {
        if (k === 0) col.set(e.to, col.get(n.id))
        else {
          // 侧分支：放在它所跨越的各层中已占用列的右侧，避免与其他侧分支叠在同一列
          const r1 = rank.get(e.to), r2 = r1 + height.get(e.to)
          // 汇合点（多个前驱）的列稍后还会左移，不计入占用
          const busy = nodes.filter((m) => col.has(m.id) && rank.get(m.id) >= r1 && rank.get(m.id) <= r2 && fwdIn(m.id) < 2).map((m) => col.get(m.id))
          col.set(e.to, Math.max(col.get(n.id) + k, ...busy.map((c) => c + 1)))
        }
      }
      k++
    }
  }
  // 同层同列的节点向右挤开
  const ranks = [...new Set(rank.values())].sort((a, b) => a - b)
  for (const r of ranks) {
    const inRank = order.filter((n) => rank.get(n.id) === r).sort((a, b) => col.get(a.id) - col.get(b.id) || disc.get(a.id) - disc.get(b.id))
    let last = -Infinity
    for (const n of inRank) { if (col.get(n.id) <= last) col.set(n.id, last + 1); last = col.get(n.id) }
  }

  // 4. 坐标
  const ncol = Math.max(...col.values()) + 1
  // 每列宽度取该列最宽的节点
  const colW = Array.from({ length: ncol }, (_, c) => Math.max(40, ...nodes.filter((n) => col.get(n.id) === c).map((n) => n.w)) + 26)
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, w) => a + w, 0))
  const GAP = 22
  const rankTop = new Map()
  const rankH = new Map()
  let y = 6
  for (const r of ranks) {
    const h = Math.max(...nodes.filter((n) => rank.get(n.id) === r).map((n) => n.h))
    rankTop.set(r, y); rankH.set(r, h); y += h + GAP
  }
  const H0 = y - GAP + 6

  // 回边走左侧或右侧的通道
  const backEdges = edges.filter((e) => e.back)
  const nodeAt = (r, c) => nodes.find((n) => rank.get(n.id) === r && col.get(n.id) === c)
  const sideOf = (e) => {
    const leftClear = (id) => !nodes.some((n) => rank.get(n.id) === rank.get(id) && col.get(n.id) < col.get(id))
    const rightClear = (id) => !nodes.some((n) => rank.get(n.id) === rank.get(id) && col.get(n.id) > col.get(id))
    if (leftClear(e.from) && leftClear(e.to)) return 'L'
    if (rightClear(e.from) && rightClear(e.to)) return 'R'
    return 'L'
  }
  for (const e of backEdges) e.side = sideOf(e)
  const nL = backEdges.filter((e) => e.side === 'L').length
  const LANE = 12
  const offX = nL * LANE + 8
  // 右侧通道：回边 + 被阻挡的前向边
  let laneR = 0

  for (const n of nodes) {
    const r = rank.get(n.id)
    n.cx = offX + colX[col.get(n.id)] + colW[col.get(n.id)] / 2
    n.x = n.cx - n.w / 2
    n.y = rankTop.get(r) + (rankH.get(r) - n.h) / 2
    n.cy = n.y + n.h / 2
    n.rank = r
    n.col = col.get(n.id)
  }
  const right0 = offX + colX[ncol - 1] + colW[ncol - 1]

  // 5. 连线
  const blockedCol = (c, r1, r2) => nodes.some((n) => n.col === c && n.rank > r1 && n.rank < r2)
  const blockedRow = (r, c1, c2) => nodes.some((n) => n.rank === r && n.col > Math.min(c1, c2) && n.col < Math.max(c1, c2))
  const lines = []
  const usedPorts = new Map() // 节点 → 已用出口
  let li = 0
  const sorted = [...edges].sort((x, y) => {
    const px = x.from === y.from ? (byId.get(x.to).col === byId.get(x.from).col && !x.back ? 0 : 1) - (byId.get(y.to).col === byId.get(y.from).col && !y.back ? 0 : 1) : 0
    return px || x.order - y.order
  })
  for (const e of sorted) {
    const a = byId.get(e.from), b = byId.get(e.to)
    const used = usedPorts.get(a.id) || new Set()
    usedPorts.set(a.id, used)
    let pts
    let lab
    if (e.back) {
      const k = e.side === 'L' ? li++ : null
      const jy = b.y - GAP / 2 // 并入目标上方的入线
      const exitL = !used.has('L') && e.side === 'L'
      const fromBottom = used.has(e.side === 'L' ? 'L' : 'R') && !used.has('B')
      if (e.side === 'L') {
        const lx = offX - LANE * (k + 1) + 4
        pts = fromBottom
          ? [[a.cx, a.y + a.h], [a.cx, a.y + a.h + GAP / 2], [lx, a.y + a.h + GAP / 2], [lx, jy], [b.cx, jy], [b.cx, b.y]]
          : [[a.x, a.cy], [lx, a.cy], [lx, jy], [b.cx, jy], [b.cx, b.y]]
        used.add(fromBottom ? 'B' : 'L')
        lab = fromBottom ? [a.cx + 4, a.y + a.h + 1] : [a.x - 26, a.cy - 13]
      } else {
        const rx = right0 + LANE * (++laneR) - 6
        pts = fromBottom
          ? [[a.cx, a.y + a.h], [a.cx, a.y + a.h + GAP / 2], [rx, a.y + a.h + GAP / 2], [rx, jy], [b.cx, jy], [b.cx, b.y]]
          : [[a.x + a.w, a.cy], [rx, a.cy], [rx, jy], [b.cx, jy], [b.cx, b.y]]
        used.add(fromBottom ? 'B' : 'R')
        lab = fromBottom ? [a.cx + 4, a.y + a.h + 1] : [a.x + a.w + 3, a.cy - 13]
      }
      void exitL
    } else if (a.col === b.col && !used.has('B') && !blockedCol(a.col, a.rank, b.rank)) {
      pts = [[a.cx, a.y + a.h], [b.cx, b.y]]
      used.add('B')
      lab = [a.cx + 4, a.y + a.h + 1]
    } else if (b.col > a.col && !used.has('R') && !blockedRow(a.rank, a.col, b.col) && !blockedCol(b.col, a.rank - 1, b.rank) && !nodeAt(a.rank, b.col)) {
      pts = [[a.x + a.w, a.cy], [b.cx, a.cy], [b.cx, b.y]]
      used.add('R')
      lab = [a.x + a.w + 3, a.cy - 13]
    } else if (b.col < a.col && !used.has('L') && !blockedRow(a.rank, a.col, b.col) && !blockedCol(b.col, a.rank - 1, b.rank) && !nodeAt(a.rank, b.col)) {
      pts = [[a.x, a.cy], [b.cx, a.cy], [b.cx, b.y]]
      used.add('L')
      lab = [a.x - 26, a.cy - 13]
    } else if (a.col === b.col && !used.has('R') && b.rank > a.rank) {
      // 同列但中间有节点挡住：从右侧出，贴着中间节点的右边绕过去，从上方进入目标
      const between = nodes.filter((n) => n.col === a.col && n.rank > a.rank && n.rank < b.rank)
      const xb = Math.max(a.x + a.w, ...between.map((n) => n.x + n.w)) + 8
      const y2 = b.y - GAP / 2
      const hit = nodes.some((n) => n !== a && n !== b && n.rank >= a.rank && n.rank < b.rank && n.x - 2 < xb && n.x + n.w + 2 > xb)
      if (!hit) {
        pts = [[a.x + a.w, a.cy], [xb, a.cy], [xb, y2], [b.cx, y2], [b.cx, b.y]]
      } else {
        const rx = right0 + LANE * (++laneR) - 6
        pts = [[a.x + a.w, a.cy], [rx, a.cy], [rx, y2], [b.cx, y2], [b.cx, b.y]]
      }
      used.add('R')
      lab = [a.x + a.w + 3, a.cy - 13]
    } else {
      // 从底部出，在下方通道横移，再沿目标列下行；被阻挡时改在目标上方通道横移；都被阻挡走右侧通道
      const y1 = rankTop.get(a.rank) + rankH.get(a.rank) + GAP / 2
      const y2 = b.y - GAP / 2
      const start = used.has('B') ? (used.has('R') ? [a.x, a.cy] : [a.x + a.w, a.cy]) : [a.cx, a.y + a.h]
      const sx = start[0]
      const pre = start[1] === a.cy ? [start, [sx === a.x ? a.x - 8 : a.x + a.w + 8, a.cy], [sx === a.x ? a.x - 8 : a.x + a.w + 8, y1]] : [start, [a.cx, y1]]
      const fromX = pre[pre.length - 1][0]
      if (!blockedCol(b.col, a.rank, b.rank)) pts = [...pre, [b.cx, y1], [b.cx, b.y]]
      else if (start[0] === a.cx && !blockedCol(a.col, a.rank, b.rank)) pts = [[a.cx, a.y + a.h], [a.cx, y2], [b.cx, y2], [b.cx, b.y]]
      else {
        const rx = right0 + LANE * (++laneR) - 6
        pts = [...pre, [rx, y1], [rx, y2], [b.cx, y2], [b.cx, b.y]]
      }
      void fromX
      used.add(start[1] === a.cy ? (start[0] === a.x ? 'L' : 'R') : 'B')
      lab = [start[0] + 4, start[1] + (start[1] === a.cy ? -13 : 1)]
    }
    lines.push({ pts: dedupe(pts), label: e.label, labelAt: lab })
  }
  const W = Math.max(right0 + laneR * LANE + 4, ...nodes.map((n) => n.x + n.w + 4))
  return { width: Math.ceil(W), height: Math.ceil(H0), nodes, lines }
}

function dedupe(pts) {
  const out = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (q && Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) continue
    out.push(p)
  }
  return out
}

// —— 输出 Word 图形（DrawingML 组合：wpg/wps，Word 2010 及以上、WPS、LibreOffice 可显示和编辑）——
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const E = 12700 // 1 pt = 12700 EMU
const emu = (v) => Math.round(v * E)
// 形状轮廓用自定义几何，文字区域为整个形状框（预置的流程图形状文字区域太小，菱形只有中间一半）
function geom(shape, w, h) {
  const W = Math.max(1, emu(w)), H = Math.max(1, emu(h))
  const pt = (x, y) => `<a:pt x="${Math.round(x)}" y="${Math.round(y)}"/>`
  const mv = (x, y) => `<a:moveTo>${pt(x, y)}</a:moveTo>`
  const ln = (x, y) => `<a:lnTo>${pt(x, y)}</a:lnTo>`
  let paths
  if (shape === 'decision') paths = [`<a:path w="${W}" h="${H}">${mv(W / 2, 0)}${ln(W, H / 2)}${ln(W / 2, H)}${ln(0, H / 2)}<a:close/></a:path>`]
  else if (shape === 'io') { const k = Math.min(W * 0.18, emu(10)); paths = [`<a:path w="${W}" h="${H}">${mv(k, 0)}${ln(W, 0)}${ln(W - k, H)}${ln(0, H)}<a:close/></a:path>`] }
  else if (shape === 'subroutine') {
    const k = emu(6)
    paths = [`<a:path w="${W}" h="${H}">${mv(0, 0)}${ln(W, 0)}${ln(W, H)}${ln(0, H)}<a:close/></a:path>`,
      `<a:path w="${W}" h="${H}" fill="none">${mv(k, 0)}${ln(k, H)}${mv(W - k, 0)}${ln(W - k, H)}</a:path>`]
  } else if (shape === 'terminal') {
    const r = H / 2
    paths = [`<a:path w="${W}" h="${H}">${mv(r, 0)}${ln(W - r, 0)}<a:arcTo wR="${Math.round(r)}" hR="${Math.round(r)}" stAng="16200000" swAng="10800000"/>${ln(r, H)}<a:arcTo wR="${Math.round(r)}" hR="${Math.round(r)}" stAng="5400000" swAng="10800000"/><a:close/></a:path>`]
  } else return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${paths.join('')}</a:pathLst></a:custGeom>`
}

function para(text, sz) {
  return text.split('\n').map((t) => '<w:p><w:pPr><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' +
    '<w:ind w:left="0" w:right="0" w:firstLine="0" w:firstLineChars="0"/><w:jc w:val="center"/></w:pPr>' +
    `<w:r><w:rPr><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join('')
}

/**
 * 返回放在 <w:r> 中的 XML（mc:AlternateContent 包裹的 w:drawing）。
 * maxWidthPt：页面可用宽度，超过时整体按比例缩小，文字同比缩小（最小 7 磅）。
 * ids：{ next() } 生成文档内唯一的图形编号
 */
export function flowchartToDrawing(layout, { maxWidthPt = 450, ids, name = '流程图' } = {}) {
  let seq = 0
  const nextId = () => (ids ? ids.next() : 1000 + ++seq)
  const { width: W, height: H } = layout
  const scale = W > maxWidthPt ? maxWidthPt / W : 1
  const fsz = Math.max(14, Math.round(FONT * 2 * scale))
  const lsz = Math.max(12, Math.round(16 * scale))
  const line = '<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>'
  const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${Math.max(1, emu(w))}" cy="${Math.max(1, emu(h))}"/></a:xfrm>`
  const ins = (l, t, r, b) => `lIns="${emu(l)}" tIns="${emu(t)}" rIns="${emu(r)}" bIns="${emu(b)}"`
  let kids = ''
  for (const n of layout.nodes) {
    const id = nextId()
    const inset = n.shape === 'decision' ? ins(24, 2, 24, 2) : n.shape === 'io' ? ins(11, 1, 11, 1) : n.shape === 'subroutine' ? ins(9, 1, 9, 1) : n.shape === 'terminal' ? ins(6, 0, 6, 0) : ins(4, 1, 4, 1)
    kids += `<wps:wsp><wps:cNvPr id="${id}" name="${esc(n.id)}"/><wps:cNvSpPr/><wps:spPr>${xfrm(n.x, n.y, n.w, n.h)}` +
      `${geom(n.shape, n.w, n.h)}<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>${line}</wps:spPr>` +
      `<wps:txbx><w:txbxContent>${para(n.text, fsz)}</w:txbxContent></wps:txbx><wps:bodyPr ${inset} anchor="ctr"><a:noAutofit/></wps:bodyPr></wps:wsp>`
  }
  for (const l of layout.lines) {
    const xs = l.pts.map((p) => p[0]), ys = l.pts.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys)
    const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
    const pw = Math.max(1, emu(w)), ph = Math.max(1, emu(h))
    const path = l.pts.map((p, i) => `<a:${i ? 'lnTo' : 'moveTo'}><a:pt x="${emu(p[0] - x0)}" y="${emu(p[1] - y0)}"/></a:${i ? 'lnTo' : 'moveTo'}>`).join('')
    kids += `<wps:wsp><wps:cNvPr id="${nextId()}" name="连线"/><wps:cNvSpPr/><wps:spPr>${xfrm(x0, y0, w, h)}` +
      `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${pw}" h="${ph}">${path}</a:path></a:pathLst></a:custGeom>` +
      '<a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
    if (l.label) {
      const [lx, ly] = l.labelAt
      const lw = Math.max(textW(l.label) + 6, 14)
      kids += `<wps:wsp><wps:cNvPr id="${nextId()}" name="标注"/><wps:cNvSpPr txBox="1"/><wps:spPr>${xfrm(lx, ly, lw, 12)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>` +
        `<wps:txbx><w:txbxContent>${para(l.label, lsz)}</w:txbxContent></wps:txbx><wps:bodyPr ${ins(0, 0, 0, 0)} anchor="ctr"><a:noAutofit/></wps:bodyPr></wps:wsp>`
    }
  }
  const gid = nextId()
  const cx = emu(W * scale), cy = emu(H * scale)
  const xml = '<mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${gid}" name="${esc(name)} ${gid}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(W)}" cy="${emu(H)}"/></a:xfrm></wpg:grpSpPr>${kids}</wpg:wgp>` +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice></mc:AlternateContent>'
  return { xml, scaled: scale < 1, scale, tooSmall: FONT * 2 * scale < 14 }
}

// —— 输出 SVG（预览和检查用）——
export function flowchartToSvg(layout) {
  const { width: W, height: H } = layout
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="SimSun, serif" font-size="${FONT}">`
  s += '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>'
  for (const n of layout.nodes) {
    const st = 'fill="white" stroke="black" stroke-width="0.75"'
    if (n.shape === 'decision') s += `<path d="M${n.cx},${n.y} L${n.x + n.w},${n.cy} L${n.cx},${n.y + n.h} L${n.x},${n.cy} Z" ${st}/>`
    else if (n.shape === 'terminal') s += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" ${st}/>`
    else if (n.shape === 'io') s += `<path d="M${n.x + n.w * 0.2},${n.y} L${n.x + n.w},${n.y} L${n.x + n.w * 0.8},${n.y + n.h} L${n.x},${n.y + n.h} Z" ${st}/>`
    else s += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" ${st}/>` + (n.shape === 'subroutine' ? `<path d="M${n.x + 6},${n.y} v${n.h} M${n.x + n.w - 6},${n.y} v${n.h}" stroke="black" stroke-width="0.75"/>` : '')
    const ls = wrapLines(n.text, n.w - (n.shape === 'decision' ? 48 : 16))
    ls.forEach((t, i) => { s += `<text x="${n.cx}" y="${n.cy + (i - (ls.length - 1) / 2) * LINE_H + 3}" text-anchor="middle">${esc(t)}</text>` })
  }
  for (const l of layout.lines) {
    s += `<polyline points="${l.pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="black" stroke-width="0.75" marker-end="url(#a)"/>`
    if (l.label) s += `<text x="${l.labelAt[0] + 2}" y="${l.labelAt[1] + 9}" font-size="8">${esc(l.label)}</text>`
  }
  return s + '</svg>'
}

/** 一步完成：返回 { ok, xml, svg, errors, warnings } */
export function renderFlowchart(src, opts) {
  const g = parseFlowchart(src)
  if (g.errors?.length) return { ok: false, errors: g.errors }
  const warnings = []
  // 没有判断和开始/结束节点的是结构图（如调用关系图），不按流程图规则检查
  const structural = !g.nodes.some((n) => n.shape === 'decision' || n.shape === 'terminal')
  const noIn = g.nodes.filter((n) => !g.edges.some((e) => e.to === n.id))
  const noOut = g.nodes.filter((n) => !g.edges.some((e) => e.from === n.id))
  if (!structural && noIn.length > 1) warnings.push(`有 ${noIn.length} 个节点没有入线：${noIn.map((n) => n.id).join('、')}（只应有“开始”一个）`)
  for (const n of structural ? [] : g.nodes) {
    const k = g.edges.filter((e) => e.from === n.id).length
    if (n.shape === 'decision' && k < 2) warnings.push(`判断节点 ${n.id}（${n.text}）只有 ${k} 个出口`)
    if (n.shape === 'decision' && k >= 2 && g.edges.filter((e) => e.from === n.id && !e.label).length) warnings.push(`判断节点 ${n.id}（${n.text}）的出口没有标注“是/否”`)
    if (n.shape !== 'decision' && n.shape !== 'terminal' && k === 0) warnings.push(`节点 ${n.id}（${n.text}）没有出线`)
  }
  // 所有节点都有出线的是无限循环（如主循环），可以没有结束节点
  if (!structural && noOut.length && !noOut.some((n) => n.shape === 'terminal')) warnings.push('没有“结束/返回”节点')
  const layout = layoutFlowchart(g)
  const v = flowchartToDrawing(layout, opts)
  if (v.tooSmall && structural) warnings.push(`结构图（如调用关系图）宽度约为页面的 ${Math.round(100 / v.scale)}%，缩小后文字可能溢出图框；建议改用“调用者 | 被调用函数”表格，或按调用者拆成几张图`)
  else if (v.tooSmall) warnings.push(`流程图宽度约为页面的 ${Math.round(100 / v.scale)}%，缩小后文字可能溢出图框；建议减少并列分支，或缩短框内文字`)
  else if (v.scaled) warnings.push(`流程图宽度超过页面，已整体缩小到 ${Math.round(v.scale * 100)}%（文字同比缩小）`)
  return { ok: true, xml: v.xml, svg: flowchartToSvg(layout), warnings, nodes: g.nodes.length, edges: g.edges.length }
}
