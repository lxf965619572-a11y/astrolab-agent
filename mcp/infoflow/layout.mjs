// 布局：分层图（Sugiyama）方法排泳道图，纯函数。
//
// 思路（为什么不会“线从节点后面穿过”）：
// 1. 泳道排序：auto 时把连线多的分组排在一起，跨越的泳道越少越好（同时尽量保持原来的顺序）。
// 2. 跨越多条泳道的连线，在中间每条泳道里预留一个“通道”（占位点，和节点一起排队）；
//    连线在泳道之间用曲线、在泳道内部沿通道直线穿过，所以永远不会压到节点。
// 3. 每条泳道里节点和通道的先后顺序用重心法 + 相邻交换反复调整，使相邻泳道之间的连线交叉最少。
// 4. 纵向位置：每个元素尽量对齐它相连的元素（保序的最小二乘，PAV 算法），线就尽量平直。
// 5. 同一节点同一侧的多条线分开端口，按另一端的位置排序，节点附近不交叉。
// 最后量出交叉数、穿过节点的线、重叠的标签，作为“这张图清不清楚”的客观指标。
//
// 坐标：u 是跨泳道方向（LR 时是 x），v 是沿泳道方向（LR 时是 y）；TB 时两者互换。

import {
  EDGE_FS, GROUP_FS, KIND_ORDER, LABEL_FS, LABEL_LH, M, NODE_PAD_X, NODE_PAD_Y, NODE_W, NOTE_FS, NOTE_LH, TITLE_FS,
  kindStyle, measureText, wrapText,
} from './common.mjs'

const LR_LANE_PAD = 27 // LR：泳道宽 = 节点宽 + 两边各 27
const ROW_GAP = 22 // 同一泳道里两个节点之间
const SLOT_GAP = 7 // 通道和相邻元素之间
const SLOT_SIZE = 10 // 不带标签的通道宽度
const PORT_MARGIN = 8
const PORT_STEP = 14
const COMPACT = 0.35 // 紧凑程度：越大越紧凑、越小线越直

export function sizeNode(node) {
  const labelLines = wrapText(node.label, NODE_W - NODE_PAD_X * 2, LABEL_FS)
  const noteLines = node.note ? wrapText(node.note, NODE_W - NODE_PAD_X * 2, NOTE_FS) : []
  const blockH = labelLines.length * LABEL_LH + (noteLines.length ? 4 + noteLines.length * NOTE_LH : 0)
  const tagH = node.tag || node.focus ? 13 : 0 // 左上角的小标签（所属分组 / 起点）
  return { w: NODE_W, h: Math.max(48, NODE_PAD_Y * 2 + blockH + tagH), labelLines, noteLines, blockH, tagH }
}

// ---------- 1. 泳道排序 ----------
// 代价 = Σ 流向条数 ×（跨越的泳道数 − 1）² + 0.5 × Σ |新位置 − 原位置|。插入式局部搜索，确定性。
export function laneOrder(model, mode = 'auto') {
  const n = model.groups.length
  const given = model.groups.map((_, i) => i)
  if (mode === 'given' || n <= 2) return given
  const w = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const f of model.flows) {
    const a = model.nodeMap.get(f.from).groupIndex
    const b = model.nodeMap.get(f.to).groupIndex
    if (a !== b) { w[a][b] += 1; w[b][a] += 1 }
  }
  const cost = (ord) => {
    const pos = new Array(n)
    ord.forEach((g, p) => { pos[g] = p })
    let c = 0
    for (let a = 0; a < n; a++) {
      c += 0.5 * Math.abs(pos[a] - a)
      for (let b = a + 1; b < n; b++) if (w[a][b]) c += w[a][b] * (Math.abs(pos[a] - pos[b]) - 1) ** 2
    }
    return c
  }
  let best = given.slice()
  let bestCost = cost(best)
  for (let iter = 0; iter < 60; iter++) {
    let improved = false
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const cand = best.slice()
        const [g] = cand.splice(i, 1)
        cand.splice(j, 0, g)
        const c = cost(cand)
        if (c < bestCost - 1e-9) { best = cand; bestCost = c; improved = true }
      }
    }
    if (!improved) break
  }
  return best
}

// ---------- 几何小工具 ----------
function cubicPoint(p1, c1, c2, p2, t) {
  const mt = 1 - t
  return {
    x: mt * mt * mt * p1.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p2.x,
    y: mt * mt * mt * p1.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p2.y,
  }
}

export function sampleEdge(edge, perCurve = 16) {
  const pts = [edge.segs[0].p1]
  for (const s of edge.segs) {
    if (s.t === 'L') pts.push(s.p2)
    else for (let i = 1; i <= perCurve; i++) pts.push(cubicPoint(s.p1, s.c1, s.c2, s.p2, i / perCurve))
  }
  return pts
}

function pathD(segs) {
  const f = (n) => Math.round(n * 10) / 10
  let d = `M ${f(segs[0].p1.x)} ${f(segs[0].p1.y)}`
  for (const s of segs) {
    if (s.t === 'L') d += ` L ${f(s.p2.x)} ${f(s.p2.y)}`
    else d += ` C ${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p2.x)} ${f(s.p2.y)}`
  }
  return d
}

function boxesOverlap(a, b, pad = 0) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
}

function labelBoxAt(label, x, y) {
  const w = measureText(label, EDGE_FS) + 10
  return { x: x - w / 2, y: y - 9, w, h: 18, cx: x, cy: y }
}

// 线段严格相交（不算端点接触）
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

// ---------- 主函数 ----------
export function planDiagram(model, opts = {}) {
  const lr = model.direction !== 'TB'
  const P = (u, v) => (lr ? { x: u, y: v } : { x: v, y: u })
  const nG = model.groups.length
  const mode = opts.order || model.order || 'auto'
  const order = laneOrder(model, mode)
  const keepNodeOrder = mode === 'given'

  const along = (s) => (lr ? s.h : s.w)
  const across = (s) => (lr ? s.w : s.h)

  // 泳道和元素（节点 + 通道）
  const lanes = order.map((gi, p) => ({ p, gi, group: model.groups[gi], items: [] }))
  const itemOf = new Map()
  for (const lane of lanes) {
    for (const n of lane.group.nodes) {
      const box = { ...n, ...sizeNode(n) }
      const it = { type: 'node', id: n.id, node: box, lane: lane.p, size: along(box), links: [], pos: lane.items.length }
      lane.items.push(it)
      itemOf.set(n.id, it)
    }
  }

  const gaps = Array.from({ length: Math.max(0, nG - 1) }, () => [])
  const edges = model.flows.map((flow, k) => {
    const a = itemOf.get(flow.from)
    const b = itemOf.get(flow.to)
    const style = kindStyle(flow.kind)
    const width = style.width * (flow.weight > 1 ? 1 + 0.45 * Math.log2(flow.weight) : 1)
    const e = { k, flow, style, width, a, b, type: a === b ? 'loop' : a.lane === b.lane ? 'same' : 'chain', chain: [] }
    if (e.type === 'chain') {
      const dir = b.lane > a.lane ? 1 : -1
      const span = Math.abs(b.lane - a.lane)
      const host = flow.label && span >= 2 ? Math.floor(span / 2) : -1
      const chain = [a]
      for (let q = a.lane + dir, i = 1; q !== b.lane; q += dir, i++) {
        const labelHere = i === host
        const size = labelHere ? (lr ? 22 : measureText(flow.label, EDGE_FS) + 18) : SLOT_SIZE
        const d = { type: 'slot', id: `~${k}.${i}`, edge: e, lane: q, size, label: labelHere, links: [], pos: 1e6 + k }
        lanes[q].items.push(d)
        chain.push(d)
      }
      chain.push(b)
      e.chain = chain
      e.dir = dir
      e.labelHost = host > 0 ? chain[host] : null
      for (let i = 0; i + 1 < chain.length; i++) {
        const x = chain[i]
        const y = chain[i + 1]
        const link = x.lane < y.lane ? { lo: x, hi: y, e } : { lo: y, hi: x, e }
        x.links.push(link)
        y.links.push(link)
        gaps[link.lo.lane].push(link)
      }
    }
    return e
  })

  // 同一泳道内的连线：两端排得越近越好（相邻时直接竖线连，不和任何线交叉）
  for (const lane of lanes) lane.same = edges.filter((e) => e.type === 'same' && e.a.lane === lane.p)
  const sameCost = (lane) => lane.same.reduce((s, e) => s + 2 * Math.max(0, Math.abs(e.a.pos - e.b.pos) - 1), 0)

  // ---------- 2. 交叉最少的顺序 ----------
  const reindex = () => { for (const l of lanes) l.items.forEach((it, i) => { it.pos = i }) }
  const crossGap = (p) => {
    const L = gaps[p]
    let c = 0
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        if ((L[i].lo.pos - L[j].lo.pos) * (L[i].hi.pos - L[j].hi.pos) < 0) c++
      }
    }
    return c
  }
  const totalCross = () => gaps.reduce((s, _, p) => s + crossGap(p), 0)
  const objective = () => totalCross() + lanes.reduce((s, l) => s + sameCost(l), 0)
  const other = (link, it) => (link.lo === it ? link.hi : link.lo)

  const reorder = (lane, side) => {
    const ref = lane.p + side
    const keyed = lane.items.map((it) => {
      const ns = it.links.map((l) => other(l, it)).filter((o) => o.lane === ref).map((o) => o.pos)
      let bary = ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : it.pos
      if (keepNodeOrder && it.type === 'node') bary = it.pos
      return { it, bary }
    })
    keyed.sort((x, y) => x.bary - y.bary || (x.it.type === y.it.type ? 0 : x.it.type === 'node' ? -1 : 1) || x.it.pos - y.it.pos)
    lane.items = keyed.map((x) => x.it)
  }

  reindex()
  const snapshot = () => lanes.map((l) => l.items.slice())
  let best = snapshot()
  let bestCross = objective()
  for (let iter = 0; iter < 24 && nG > 1; iter++) {
    if (iter % 2 === 0) for (let p = 1; p < nG; p++) reorder(lanes[p], -1)
    else for (let p = nG - 2; p >= 0; p--) reorder(lanes[p], 1)
    reindex()
    const c = objective()
    if (c < bestCross) { bestCross = c; best = snapshot() }
  }
  lanes.forEach((l, p) => { l.items = best[p] })
  reindex()
  // 相邻交换：只要能少一个交叉就换
  for (let pass = 0; pass < 6; pass++) {
    let improved = false
    for (const lane of lanes) {
      const local = () => (lane.p > 0 ? crossGap(lane.p - 1) : 0) + (lane.p < nG - 1 ? crossGap(lane.p) : 0) + sameCost(lane)
      for (let i = 0; i + 1 < lane.items.length; i++) {
        const x = lane.items[i]
        const y = lane.items[i + 1]
        if (keepNodeOrder && x.type === 'node' && y.type === 'node') continue
        const before = local()
        lane.items[i] = y
        lane.items[i + 1] = x
        x.pos = i + 1
        y.pos = i
        if (local() < before) improved = true
        else { lane.items[i] = x; lane.items[i + 1] = y; x.pos = i; y.pos = i + 1 }
      }
    }
    if (!improved) break
  }
  const orderCrossings = totalCross()

  // 同泳道连线分两种：两端相邻 → 直接连（conn）；不相邻 → 沿泳道内侧边距走（track）
  const connGap = new Set()
  for (const lane of lanes) {
    for (const e of lane.same) {
      e.route = Math.abs(e.a.pos - e.b.pos) === 1 ? 'conn' : 'track'
      if (e.route === 'conn' && e.flow.label) connGap.add([e.a.id, e.b.id].sort().join('|'))
    }
  }

  // ---------- 3. 沿泳道方向的位置：对齐相连元素，保序最小二乘 ----------
  const sep = (x, y) => {
    if (x.type === 'node' && y.type === 'node') {
      const labeled = connGap.has([x.id, y.id].sort().join('|'))
      return x.size / 2 + y.size / 2 + (labeled ? (lr ? 38 : 22 + 60) : ROW_GAP)
    }
    return x.size / 2 + y.size / 2 + SLOT_GAP
  }
  for (const lane of lanes) {
    let c = 0
    lane.items.forEach((it, i) => { c = i === 0 ? it.size / 2 : c + sep(lane.items[i - 1], it); it.c = c })
  }
  const place = (lane) => {
    const items = lane.items
    if (!items.length) return
    const off = [0]
    for (let i = 1; i < items.length; i++) off[i] = off[i - 1] + sep(items[i - 1], items[i])
    const blocks = []
    const lower = items[0].size / 2
    items.forEach((it, i) => {
      // 目标 = 相连元素的平均位置（线平直）和“从顶部紧凑排列”的位置（不留大片空白）的加权平均
      const ns = it.links.map((l) => other(l, it).c)
      const align = ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : it.c
      const wAlign = it.type === 'slot' ? 2 : ns.length ? 1 : 0
      const wPack = COMPACT
      const t = (wAlign * align + wPack * (lower + off[i])) / (wAlign + wPack)
      const wgt = wAlign + wPack
      blocks.push({ w: wgt, s: wgt * (t - off[i]), n: 1 })
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1]
        const a = blocks[blocks.length - 2]
        if (a.s / a.w <= b.s / b.w) break
        blocks.splice(blocks.length - 2, 2, { w: a.w + b.w, s: a.s + b.s, n: a.n + b.n })
      }
    })
    let i = 0
    for (const b of blocks) {
      const val = Math.max(lower, b.s / b.w)
      for (let j = 0; j < b.n; j++, i++) items[i].c = val + off[i]
    }
  }
  for (let iter = 0; iter < 40; iter++) {
    const seq = iter % 2 === 0 ? lanes : lanes.slice().reverse()
    for (const lane of seq) place(lane)
  }
  let minTop = Infinity
  let maxBottom = 0
  for (const lane of lanes) {
    for (const it of lane.items) { minTop = Math.min(minTop, it.c - it.size / 2) }
  }
  if (!Number.isFinite(minTop)) minTop = 0
  for (const lane of lanes) for (const it of lane.items) { it.c -= minTop; maxBottom = Math.max(maxBottom, it.c + it.size / 2) }
  const contentLen = Math.max(80, maxBottom)

  // ---------- 4. 泳道尺寸、间隔和表头 ----------
  const sameSide = (p) => (p < nG - 1 || nG === 1 ? 'hi' : 'lo')
  const gapLoad = gaps.map((g) => g.length)
  for (const e of edges) {
    if (e.type !== 'same' || e.route !== 'track') continue
    const p = e.a.lane
    const g = sameSide(p) === 'hi' ? p : p - 1
    if (g >= 0 && g < gapLoad.length) gapLoad[g] += 1
  }
  const gapBase = lr ? 64 : 46
  // 间隔还要放得下相邻两列之间连线的标签（LR 时标签横着放在间隔里；TB 时间隔是上下方向，只需要放下一行字）
  const labelNeed = gaps.map(() => 0)
  for (const e of edges) {
    if (e.type !== 'chain' || !e.flow.label || e.chain.length !== 2) continue
    const g = Math.min(e.a.lane, e.b.lane)
    labelNeed[g] = Math.max(labelNeed[g], lr ? measureText(e.flow.label, EDGE_FS) + 34 : 44)
  }
  const gapW = gapLoad.map((n, g) => Math.max(gapBase + Math.min(96, Math.max(0, n - 4) * 5), Math.min(lr ? 240 : 80, labelNeed[g])))
  const thick = lanes.map((l) => {
    if (lr) return NODE_W + LR_LANE_PAD * 2
    const hs = l.items.filter((it) => it.type === 'node').map((it) => it.node.h)
    return Math.max(80, (hs.length ? Math.max(...hs) : 48) + 30)
  })

  const titleBaseline = M + 14
  const laneTop = M + 40
  let headerH = 0
  let headerW = 0
  let labelLines
  if (model.plain) {
    // 无泳道背景（总图按流向分层）：不画表头
    labelLines = lanes.map(() => [])
  } else if (lr) {
    labelLines = lanes.map((l) => wrapText(l.group.label, thick[l.p] - 24, GROUP_FS))
    headerH = Math.max(46, Math.max(...labelLines.map((x) => x.length)) * 17 + 22)
  } else {
    const labelMax = Math.max(...lanes.map((l) => measureText(l.group.label, GROUP_FS)))
    headerW = Math.min(190, Math.max(110, labelMax + 28))
    labelLines = lanes.map((l) => wrapText(l.group.label, headerW - 24, GROUP_FS))
  }
  const vStart = model.plain ? (lr ? laneTop + 10 : M + 10) : lr ? laneTop + headerH + 14 : M + headerW + 28
  const uLane = []
  let u = lr ? M : laneTop
  lanes.forEach((l, p) => { uLane[p] = u; u += thick[p] + (p < nG - 1 ? gapW[p] : 0) })
  const uEnd = u
  const laneLen = model.plain ? contentLen + 20 : lr ? headerH + 14 + contentLen + 18 : headerW + 28 + contentLen + 28

  // 节点框
  const nodes = []
  for (const lane of lanes) {
    const uc = uLane[lane.p] + thick[lane.p] / 2
    for (const it of lane.items) {
      it.v = vStart + it.c
      if (it.type !== 'node') continue
      const n = it.node
      const c = P(uc, it.v)
      Object.assign(n, { x: c.x - n.w / 2, y: c.y - n.h / 2, cx: c.x, cy: c.y, groupIndex: n.groupIndex, laneIndex: lane.p })
      it.uc = uc
      nodes.push(n)
    }
  }
  const uSide = (it, side) => (side === 'hi' ? it.uc + across(it.node) / 2 : it.uc - across(it.node) / 2)

  // ---------- 5. 端口：同一侧的多条线按另一端位置分开 ----------
  const attach = new Map()
  const add = (it, side, rec) => {
    const key = `${it.id}|${side}`
    if (!attach.has(key)) attach.set(key, { it, list: [] })
    attach.get(key).list.push(rec)
  }
  const chainPorts = new Map()
  for (const e of edges) {
    if (e.type !== 'chain') continue
    e.startSide = e.dir > 0 ? 'hi' : 'lo'
    e.endSide = e.dir > 0 ? 'lo' : 'hi'
    add(e.a, e.startSide, { e, end: 'start', other: e.chain[1].v })
    add(e.b, e.endSide, { e, end: 'end', other: e.chain[e.chain.length - 2].v })
    for (const [id, side] of [[e.a.id, e.startSide], [e.b.id, e.endSide]]) chainPorts.set(`${id}|${side}`, (chainPorts.get(`${id}|${side}`) || 0) + 1)
  }
  for (const e of edges) {
    if (e.type !== 'same' || e.route !== 'track') continue
    // 走哪一侧：两端之间的节点在这一侧连出去的线越少越好（竖着走的这段会和它们交叉）
    const lane = lanes[e.a.lane]
    const lo = Math.min(e.a.pos, e.b.pos)
    const hi = Math.max(e.a.pos, e.b.pos)
    const cost = (side) => lane.items.slice(lo + 1, hi).reduce((s, it) => s + (chainPorts.get(`${it.id}|${side}`) || 0), 0)
      + (chainPorts.get(`${e.a.id}|${side}`) || 0) * 0.5 + (chainPorts.get(`${e.b.id}|${side}`) || 0) * 0.5
    const ch = cost('hi')
    const cl = cost('lo')
    const pref = e.a.lane === nG - 1 && nG > 1 ? 'lo' : 'hi'
    e.startSide = e.endSide = ch < cl ? 'hi' : cl < ch ? 'lo' : pref
    add(e.a, e.startSide, { e, end: 'start', other: e.b.v })
    add(e.b, e.endSide, { e, end: 'end', other: e.a.v })
  }
  for (const { it, list } of attach.values()) {
    list.sort((x, y) => x.other - y.other || x.e.k - y.e.k)
    const n = list.length
    const avail = along(it.node) - PORT_MARGIN * 2
    const step = n > 1 ? Math.min(PORT_STEP, avail / (n - 1)) : 0
    list.forEach((r, i) => {
      const v = it.v - (step * (n - 1)) / 2 + i * step
      if (r.end === 'start') r.e.startV = v
      else r.e.endV = v
    })
  }

  // ---------- 6. 连线几何 ----------
  const curve = (u1, v1, u2, v2) => {
    const du = (u2 - u1) * 0.5
    return { t: 'C', p1: P(u1, v1), c1: P(u1 + du, v1), c2: P(u2 - du, v2), p2: P(u2, v2) }
  }
  const sameCount = new Map()
  for (const e of edges) {
    if (e.type === 'chain') {
      const segs = []
      let cu = uSide(e.a, e.startSide)
      let cv = e.startV
      for (let i = 1; i < e.chain.length; i++) {
        const it = e.chain[i]
        if (it.type === 'slot') {
          const q = it.lane
          const entry = e.dir > 0 ? uLane[q] : uLane[q] + thick[q]
          const exit = e.dir > 0 ? uLane[q] + thick[q] : uLane[q]
          segs.push(curve(cu, cv, entry, it.v))
          segs.push({ t: 'L', p1: P(entry, it.v), p2: P(exit, it.v) })
          cu = exit
          cv = it.v
        } else {
          segs.push(curve(cu, cv, uSide(e.b, e.endSide), e.endV))
        }
      }
      e.segs = segs
    } else if (e.type === 'same' && e.route === 'conn') {
      // 相邻节点：在两个节点之间的空隙里直接连
      const sign = e.b.v > e.a.v ? 1 : -1
      const key = `conn:${[e.a.id, e.b.id].sort().join('|')}`
      const idx = sameCount.get(key) || 0
      sameCount.set(key, idx + 1)
      const du = idx === 0 ? 0 : (idx % 2 ? 1 : -1) * Math.ceil(idx / 2) * 14
      const va = e.a.v + sign * along(e.a.node) / 2
      const vb = e.b.v - sign * along(e.b.node) / 2
      e.segs = [{ t: 'L', p1: P(e.a.uc + du, va), p2: P(e.b.uc + du, vb) }]
    } else if (e.type === 'same') {
      // 不相邻：从节点侧面出来，沿泳道内侧边距竖着走，再进目标节点侧面；多条时由内向外排开
      const side = e.startSide
      const d = side === 'hi' ? 1 : -1
      const key = `track:${e.a.lane}|${side}`
      if (!sameCount.has(key)) {
        const list = edges.filter((x) => x.type === 'same' && x.route === 'track' && x.a.lane === e.a.lane && x.startSide === side)
          .sort((x, y) => Math.abs(x.b.v - x.a.v) - Math.abs(y.b.v - y.a.v) || x.k - y.k)
        sameCount.set(key, list)
      }
      const idx = sameCount.get(key).indexOf(e)
      const off = 8 + idx * 6
      const ua = uSide(e.a, side)
      const ub = uSide(e.b, side)
      const ut = Math.max(ua, ub) * (d > 0 ? 1 : 0) + Math.min(ua, ub) * (d > 0 ? 0 : 1) + d * off
      const sv = e.endV > e.startV ? 1 : -1
      const r = Math.min(6, off - 1, Math.abs(e.endV - e.startV) / 2)
      const corner = (u1, v1, uc, vc, u2, v2) => ({ t: 'C', p1: P(u1, v1), c1: P(uc, vc), c2: P(uc, vc), p2: P(u2, v2) })
      e.segs = [
        { t: 'L', p1: P(ua, e.startV), p2: P(ut - d * r, e.startV) },
        corner(ut - d * r, e.startV, ut, e.startV, ut, e.startV + sv * r),
        { t: 'L', p1: P(ut, e.startV + sv * r), p2: P(ut, e.endV - sv * r) },
        corner(ut, e.endV - sv * r, ut, e.endV, ut - d * r, e.endV),
        { t: 'L', p1: P(ut - d * r, e.endV), p2: P(ub, e.endV) },
      ]
    } else {
      const a = e.a.node
      e.segs = lr
        ? [{ t: 'C', p1: { x: a.x + a.w - 20, y: a.y }, c1: { x: a.x + a.w + 42, y: a.y - 52 }, c2: { x: a.x - 42, y: a.y - 52 }, p2: { x: a.x + 20, y: a.y } }]
        : [{ t: 'C', p1: { x: a.x + a.w, y: a.y + 18 }, c1: { x: a.x + a.w + 48, y: a.y + a.h + 34 }, c2: { x: a.x + a.w + 48, y: a.y - 34 }, p2: { x: a.x + a.w, y: a.y + a.h - 18 } }]
    }
    e.d = pathD(e.segs)
    e.p1 = e.segs[0].p1
    e.p2 = e.segs[e.segs.length - 1].p2
  }

  // ---------- 7. 泳道矩形和画布 ----------
  const laneRects = lanes.map((l, p) => (lr
    ? { x: uLane[p], y: laneTop, w: thick[p], h: laneLen, headerH, labelLines: labelLines[p], group: l.group, index: p }
    : { x: M, y: uLane[p], w: laneLen, h: thick[p], headerW, labelLines: labelLines[p], group: l.group, index: p }))
  const sameMargin = nG === 1 && edges.some((e) => e.type === 'same') ? 60 : 0
  const totalW = Math.max(
    640,
    (lr ? uEnd : M + laneLen) + M + sameMargin,
    M * 2 + measureText(model.title, TITLE_FS),
  )
  const contentBottom = lr ? laneTop + laneLen : uEnd + (lr ? 0 : sameMargin)
  const maxY = contentBottom + 50

  // ---------- 8. 连线标签 ----------
  const obstacles = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  if (!model.plain) for (const r of laneRects) obstacles.push(lr ? { x: r.x, y: r.y, w: r.w, h: r.headerH } : { x: r.x, y: r.y, w: r.headerW, h: r.h })
  const placed = []
  for (const e of edges) {
    if (!e.flow.label || !e.labelHost) continue
    const q = e.labelHost.lane
    const at = P(uLane[q] + thick[q] / 2, e.labelHost.v)
    e.labelAt = at
    placed.push(labelBoxAt(e.flow.label, at.x, at.y))
  }
  const ts = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]
  const offs = [0, 12, -12, 24, -24, 36, -36, 48, -48]
  for (const e of edges) {
    if (!e.flow.label || e.labelHost) continue
    const pts = sampleEdge(e, 24)
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    const total = cum[cum.length - 1] || 1
    const at = (t) => {
      const target = t * total
      let i = 1
      while (i < cum.length - 1 && cum[i] < target) i++
      const a = pts[i - 1]
      const b = pts[i]
      const seg = cum[i] - cum[i - 1] || 1
      const r = (target - cum[i - 1]) / seg
      return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r, dx: b.x - a.x, dy: b.y - a.y }
    }
    let bestL = { score: Infinity, at: at(0.5), box: null }
    for (const t of ts) {
      const p = at(t)
      const len = Math.hypot(p.dx, p.dy) || 1
      const nx = -p.dy / len
      const ny = p.dx / len
      for (const off of offs) {
        const c = { x: p.x + nx * off, y: p.y + ny * off }
        const box = labelBoxAt(e.flow.label, c.x, c.y)
        let score = Math.abs(t - 0.5) * 3 + Math.abs(off) * 0.6
        if (box.x < 2 || box.x + box.w > totalW - 2 || box.y < 34 || box.y + box.h > maxY) score += 1000
        for (const o of obstacles) if (boxesOverlap(box, o, 3)) score += 100
        for (const o of placed) if (boxesOverlap(box, o, 3)) score += 200
        if (score < bestL.score) bestL = { score, at: c, box }
      }
    }
    e.labelAt = bestL.at
    if (bestL.box) placed.push(bestL.box)
  }

  // ---------- 9. 图例和高度 ----------
  const usedKinds = KIND_ORDER.filter((k) => model.flows.some((f) => f.kind === k))
  const hasPending = model.nodes.some((n) => n.pending)
  const hasExt = model.nodes.some((n) => n.ext)
  const hasWeight = model.flows.some((f) => f.weight > 1)
  const hasFocus = model.nodes.some((n) => n.focus)
  const omitted = model.view && model.view.omitted ? model.view : null
  const hasLegend = usedKinds.length > 0 || hasPending || hasExt || hasWeight || hasFocus || !!omitted
  const legendY = contentBottom + 34
  const legendH = hasLegend ? 28 : 0
  const sourceY = contentBottom + 30 + legendH + (model.source ? 22 : 0)
  const height = Math.ceil(sourceY + (model.source ? 22 : 8))

  const plan = {
    lanes: laneRects,
    nodes,
    edges,
    laneOrder: order,
    titleBaseline,
    laneTop,
    totalW,
    contentBottom,
    width: Math.ceil(totalW),
    height,
    legend: { y: legendY, usedKinds, hasPending, hasExt, hasWeight, hasFocus, hasLegend, omitted },
    sourceY,
  }
  plan.metrics = measurePlan(plan, placed)
  plan.metrics.orderCrossings = orderCrossings
  return plan
}

// ---------- 10. 客观指标 ----------
// crossings：两条线的交叉处数（不算同一节点出发/到达的线在节点旁边的接触）
// edgesThroughNodes：经过了别的节点框的线条数（目标是 0）
// labelOverlaps：压住节点或互相重叠的标签数
export function measurePlan(plan, labelBoxes) {
  const polys = plan.edges.map((e) => sampleEdge(e, 16))
  const CELL = 48
  const grid = new Map()
  const segs = []
  polys.forEach((pts, ei) => {
    const e = plan.edges[ei]
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const nearA = Math.hypot(a.x - e.p1.x, a.y - e.p1.y) < 14
      const nearB = Math.hypot(b.x - e.p2.x, b.y - e.p2.y) < 14
      const s = { ei, a, b, nearStart: nearA, nearEnd: nearB }
      const id = segs.length
      segs.push(s)
      const x0 = Math.floor(Math.min(a.x, b.x) / CELL)
      const x1 = Math.floor(Math.max(a.x, b.x) / CELL)
      const y0 = Math.floor(Math.min(a.y, b.y) / CELL)
      const y1 = Math.floor(Math.max(a.y, b.y) / CELL)
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const k = `${gx},${gy}`
          if (!grid.has(k)) grid.set(k, [])
          grid.get(k).push(id)
        }
      }
    }
  })
  const seen = new Set()
  let crossings = 0
  for (const ids of grid.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const s = segs[ids[i]]
        const t = segs[ids[j]]
        if (s.ei === t.ei) continue
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`
        if (seen.has(key)) continue
        seen.add(key)
        const es = plan.edges[s.ei].flow
        const et = plan.edges[t.ei].flow
        // 共用一个节点的两条线在该节点旁边相碰不算交叉
        const shareFrom = es.from === et.from && s.nearStart && t.nearStart
        const shareTo = es.to === et.to && s.nearEnd && t.nearEnd
        const shareMix = (es.from === et.to && s.nearStart && t.nearEnd) || (es.to === et.from && s.nearEnd && t.nearStart)
        if (shareFrom || shareTo || shareMix) continue
        if (segCross(s.a, s.b, t.a, t.b)) crossings++
      }
    }
  }
  let edgesThroughNodes = 0
  plan.edges.forEach((e, ei) => {
    const hit = plan.nodes.some((n) => n.id !== e.flow.from && n.id !== e.flow.to
      && polys[ei].some((p) => p.x > n.x + 1 && p.x < n.x + n.w - 1 && p.y > n.y + 1 && p.y < n.y + n.h - 1))
    if (hit) edgesThroughNodes++
  })
  let labelOverlaps = 0
  const boxes = labelBoxes || []
  boxes.forEach((b, i) => {
    const hitNode = plan.nodes.some((n) => boxesOverlap(b, n, 1))
    const hitLabel = boxes.some((o, j) => j !== i && boxesOverlap(b, o, 0))
    if (hitNode || hitLabel) labelOverlaps++
  })
  return { crossings, edgesThroughNodes, labelOverlaps }
}
