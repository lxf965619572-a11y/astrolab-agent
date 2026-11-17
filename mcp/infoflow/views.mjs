// 视图：从一份完整模型生成总图、分图、链路图。纯函数。
// 模型是唯一的权威来源；视图只是取其中一部分（或按分组合并）重新布局，不改模型。

import { GROUP_COLORS, KIND_ORDER, READABLE, isPending, summarizeNames } from './common.mjs'

/** 由分组和流向组装模型（重新编号 groupIndex，建立 nodeMap） */
export function makeModel({ title, baseTitle, source, direction, order, groups, flows, view, plain }) {
  const gs = groups.map((g, gi) => ({
    id: g.id,
    label: g.label,
    color: g.color || GROUP_COLORS[gi % GROUP_COLORS.length],
    nodes: g.nodes.map((n) => ({ ...n, groupIndex: gi, pending: n.pending ?? isPending(`${n.label} ${n.note || ''}`) })),
  }))
  const nodes = gs.flatMap((g) => g.nodes)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  return {
    title,
    baseTitle: baseTitle || title,
    source,
    direction,
    order,
    groups: gs,
    nodes,
    nodeMap,
    flows: flows.map((f) => ({ weight: 1, ...f })),
    view: view || { kind: 'full', label: '全图' },
    plain: !!plain,
  }
}

const VIEW_KINDS = ['full', 'overview', 'group', 'chain']

/**
 * 按视图参数取子模型。
 * opts: { view: 'full'|'overview'|'group'|'chain', group, focus: string[], towards: 'down'|'up'|'both', depth }
 * 返回 { model, error }
 */
export function viewModel(model, opts = {}) {
  const view = opts.view || 'full'
  if (!VIEW_KINDS.includes(view)) return { error: `view 只能是 ${VIEW_KINDS.join(' / ')}` }
  if (view === 'full') return { model }
  if (view === 'overview') return { model: overview(model, opts) }
  if (view === 'group') return groupView(model, opts.group)
  return chainView(model, opts)
}

function findGroup(model, key) {
  const k = String(key || '').trim()
  return model.groups.find((g) => g.id === k) || model.groups.find((g) => g.label === k)
}

function findNode(model, key) {
  const k = String(key || '').trim()
  return model.nodeMap.get(k) || model.nodes.find((n) => n.label === k)
}

// 总图：每个分组一个方块；同一对分组之间的全部流向合并成一条线（线宽表示条数，双向时两头都有箭头）
const OVERVIEW_MAX_LINES = 15

function overview(model, opts = {}) {
  const gOf = (id) => model.nodeMap.get(id).groupIndex
  const inner = new Map()
  const agg = new Map()
  for (const f of model.flows) {
    const a = gOf(f.from)
    const b = gOf(f.to)
    if (a === b) { inner.set(a, (inner.get(a) || 0) + 1); continue }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (!agg.has(key)) agg.set(key, { a: Math.min(a, b), b: Math.max(a, b), fwd: 0, back: 0, labels: [], kinds: {} })
    const x = agg.get(key)
    if (a === x.a) x.fwd += 1
    else x.back += 1
    x.kinds[f.kind] = (x.kinds[f.kind] || 0) + 1
    if (f.label && !x.labels.includes(f.label)) x.labels.push(f.label)
  }
  const groups = model.groups.map((g, gi) => {
    const pend = g.nodes.filter((n) => n.pending).length
    const names = g.nodes.map((n) => n.label)
    const noteParts = [`${g.nodes.length} 个节点`]
    if (inner.get(gi)) noteParts.push(`组内流向 ${inner.get(gi)} 条`)
    if (pend) noteParts.push(`含 ${pend} 项待确认`)
    return {
      id: g.id,
      label: g.label,
      color: g.color,
      nodes: [{ id: `G:${g.id}`, label: names.length ? summarizeNames(names, 4) : '（空）', note: noteParts.join('；'), pending: pend > 0, summary: true }],
    }
  })
  let flows = [...agg.values()].map((x) => {
    const n = x.fwd + x.back
    const kind = Object.entries(x.kinds).sort((p, q) => q[1] - p[1] || KIND_ORDER.indexOf(p[0]) - KIND_ORDER.indexOf(q[0]))[0][0]
    const shown = x.labels.slice(0, 2).join('、')
    const label = n > 2 || x.labels.length > 2 ? `${shown || '流向'} 等 ${n} 条` : shown
    // 只有反方向的流向时，箭头按实际方向画
    const [from, to] = x.fwd === 0 ? [x.b, x.a] : [x.a, x.b]
    return { from: `G:${model.groups[from].id}`, to: `G:${model.groups[to].id}`, kind, label, weight: n, both: x.fwd > 0 && x.back > 0, counts: { fwd: x.fwd, back: x.back } }
  })
  // 线太多时只画主要连接：逐步提高“至少几条流向才画”的门槛，直到不超过 15 条线；省略的在图例和说明里写明，全部见 N² 矩阵
  let minWeight = Number(opts.minWeight) > 0 ? Math.floor(Number(opts.minWeight)) : 1
  if (!opts.minWeight) while (minWeight < 5 && flows.filter((f) => f.weight >= minWeight).length > OVERVIEW_MAX_LINES) minWeight++
  const drawn = flows.filter((f) => f.weight >= minWeight)
  const omitted = flows.length - drawn.length
  flows = drawn
  // 按流向分层：来源在左、去向在右（不是一组一条泳道，否则组多了线要横穿整张图）
  const nodes = groups.map((g) => ({ ...g.nodes[0], label: g.label, note: `${g.nodes[0].label}\n${g.nodes[0].note}`, color: g.color }))
  const layer = layerGraph(nodes.map((n) => n.id), flows.map((f) => ({ from: f.from, to: f.to, w: f.weight })))
  return makeModel({
    ...model,
    title: `${model.baseTitle} · 总图`,
    groups: byLayer(nodes, layer, () => ''),
    flows,
    plain: true,
    order: 'auto',
    view: { kind: 'overview', label: '总图', minWeight, omitted },
  })
}

// 把节点按层号分成“列”（合成的分组），层号从 0 开始
function byLayer(nodes, layer, label) {
  const max = Math.max(0, ...nodes.map((n) => layer.get(n.id)))
  const cols = Array.from({ length: max + 1 }, (_, i) => ({ id: `L${i}`, label: label(i), color: '#64748b', nodes: [] }))
  for (const n of nodes) cols[layer.get(n.id)].nodes.push(n)
  return cols.filter((c) => c.nodes.length)
}

// 有环有向图分层：贪心定序（Eades）打断环 → 最长路径分层 → 让每个点靠近邻居，跨层尽量少
export function layerGraph(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]))
  const inc = new Map(ids.map((id) => [id, []]))
  for (const e of edges) {
    if (e.from === e.to) continue
    out.get(e.from).push(e)
    inc.get(e.to).push(e)
  }
  const left = new Set(ids)
  const s1 = []
  const s2 = []
  const wsum = (list, other) => list.filter((e) => left.has(other(e))).reduce((s, e) => s + (e.w || 1), 0)
  while (left.size) {
    let changed = true
    while (changed) {
      changed = false
      for (const v of ids) {
        if (!left.has(v)) continue
        if (wsum(out.get(v), (e) => e.to) === 0) { s2.unshift(v); left.delete(v); changed = true }
      }
      for (const v of ids) {
        if (!left.has(v)) continue
        if (wsum(inc.get(v), (e) => e.from) === 0) { s1.push(v); left.delete(v); changed = true }
      }
    }
    if (!left.size) break
    let best = null
    let bestD = -Infinity
    for (const v of ids) {
      if (!left.has(v)) continue
      const d = wsum(out.get(v), (e) => e.to) - wsum(inc.get(v), (e) => e.from)
      if (d > bestD) { bestD = d; best = v }
    }
    s1.push(best)
    left.delete(best)
  }
  const rank = new Map([...s1, ...s2].map((v, i) => [v, i]))
  const fwd = edges.filter((e) => e.from !== e.to && rank.get(e.from) < rank.get(e.to))
  const layer = new Map(ids.map((id) => [id, 0]))
  for (const v of [...s1, ...s2]) for (const e of fwd) if (e.from === v) layer.set(e.to, Math.max(layer.get(e.to), layer.get(v) + 1))
  for (let iter = 0; iter < 12; iter++) {
    for (const v of ids) {
      const preds = fwd.filter((e) => e.to === v).map((e) => layer.get(e.from))
      const succs = fwd.filter((e) => e.from === v).map((e) => layer.get(e.to))
      const lo = preds.length ? Math.max(...preds) + 1 : 0
      const hi = succs.length ? Math.min(...succs) - 1 : Math.max(lo, ...[...layer.values()])
      if (hi < lo) continue
      let bestL = layer.get(v)
      let bestC = Infinity
      for (let L = lo; L <= hi; L++) {
        let c = 0
        for (const e of edges) {
          if (e.from === v && e.to !== v) c += (e.w || 1) * Math.abs(layer.get(e.to) - L)
          else if (e.to === v && e.from !== v) c += (e.w || 1) * Math.abs(L - layer.get(e.from))
        }
        if (c < bestC - 1e-9 || (Math.abs(c - bestC) < 1e-9 && L === layer.get(v))) { bestC = c; bestL = L }
      }
      layer.set(v, bestL)
    }
  }
  const used = [...new Set(layer.values())].sort((a, b) => a - b)
  const remap = new Map(used.map((l, i) => [l, i]))
  for (const [k, v] of layer) layer.set(k, remap.get(v))
  return layer
}

// 分图：一个分组的全部节点，加上和它直接相连的外部节点（画成灰色虚线框）
function groupView(model, key) {
  const g = findGroup(model, key)
  if (!g) return { error: `没有这个分组：${key || '（未给出）'}；可选：${model.groups.map((x) => `${x.id}（${x.label}）`).join('、')}` }
  const inG = new Set(g.nodes.map((n) => n.id))
  const flows = model.flows.filter((f) => inG.has(f.from) || inG.has(f.to))
  const keep = new Set(inG)
  for (const f of flows) { keep.add(f.from); keep.add(f.to) }
  const groups = model.groups
    .map((x) => ({ ...x, nodes: x.nodes.filter((n) => keep.has(n.id)).map((n) => (inG.has(n.id) ? n : { ...n, ext: true })) }))
    .filter((x) => x.nodes.length)
  return { model: makeModel({ ...model, title: `${model.baseTitle} · 分图：${g.label}`, groups, flows, view: { kind: 'group', label: `分图：${g.label}`, group: g.id } }) }
}

// 链路图：从起点沿流向往下游（或上游、两头）走，只画走到的节点和沿途的流向
function chainView(model, opts) {
  const keys = Array.isArray(opts.focus) ? opts.focus : opts.focus ? [opts.focus] : []
  if (!keys.length) return { error: 'view=chain 需要 focus：起点节点的 id 或名称（可以给多个）' }
  const starts = []
  for (const k of keys) {
    const n = findNode(model, k)
    if (!n) return { error: `没有这个节点：${k}` }
    starts.push(n.id)
  }
  const ends = []
  for (const k of Array.isArray(opts.to) ? opts.to : opts.to ? [opts.to] : []) {
    const n = findNode(model, k)
    if (!n) return { error: `没有这个节点：${k}` }
    ends.push(n.id)
  }
  const towards = ends.length ? 'down' : opts.towards || 'down'
  if (!['down', 'up', 'both'].includes(towards)) return { error: 'towards 只能是 down（下游）、up（上游）或 both（两头）' }
  const depth = Number.isFinite(Number(opts.depth)) && Number(opts.depth) > 0 ? Math.floor(Number(opts.depth)) : Infinity
  const walk = (dir) => {
    const dist = new Map(starts.map((s) => [s, 0]))
    let frontier = starts.slice()
    while (frontier.length) {
      const next = []
      for (const u of frontier) {
        const d = dist.get(u)
        if (d >= depth) continue
        for (const f of model.flows) {
          const [from, to] = dir === 'down' ? [f.from, f.to] : [f.to, f.from]
          if (from !== u || dist.has(to)) continue
          dist.set(to, d + 1)
          next.push(to)
        }
      }
      frontier = next
    }
    return dist
  }
  let down = towards !== 'up' ? walk('down') : new Map()
  let up = towards !== 'down' ? walk('up') : new Map()
  if (ends.length) {
    // 起点到终点：只取最短路径经过的环节（有反馈环时“所有路径”会把半个系统都带进来）
    const saved = starts.splice(0, starts.length, ...ends)
    const back = walk('up')
    starts.splice(0, starts.length, ...saved)
    const reach = ends.filter((e) => down.has(e))
    if (!reach.length) return { error: `从 ${starts.map((x) => model.nodeMap.get(x).label).join('、')} 沿流向走不到 ${ends.map((e) => model.nodeMap.get(e).label).join('、')}` }
    const len = Math.min(...reach.map((e) => down.get(e)))
    down = new Map([...down].filter(([id]) => back.has(id) && down.get(id) + back.get(id) === len))
    up = new Map()
  }
  // 列 = 步数：上游在左（负步数）、起点居中、下游在右；只保留相邻两步之间的流向
  const step = new Map()
  for (const [id, d] of up) step.set(id, -d)
  for (const [id, d] of down) step.set(id, d)
  const flows = model.flows.filter((f) => (down.has(f.from) && down.has(f.to) && down.get(f.to) === down.get(f.from) + 1)
    || (up.has(f.from) && up.has(f.to) && up.get(f.from) === up.get(f.to) + 1))
  const startSet = new Set(starts)
  const minStep = Math.min(...step.values())
  const layer = new Map([...step].map(([id, v]) => [id, v - minStep]))
  const nodes = model.nodes.filter((n) => step.has(n.id)).map((n) => ({
    ...n, focus: startSet.has(n.id), tag: model.groups[n.groupIndex].label, color: model.groups[n.groupIndex].color,
  }))
  const names = starts.map((x) => model.nodeMap.get(x).label).join('、')
  const word = ends.length ? `到 ${ends.map((e) => model.nodeMap.get(e).label).join('、')}` : { down: '下游', up: '上游', both: '上下游' }[towards]
  const stepLabel = (i) => {
    const k = i + minStep
    return k === 0 ? '起点' : k > 0 ? `第 ${k} 步` : `上游第 ${-k} 步`
  }
  return {
    model: makeModel({
      ...model,
      title: `${model.baseTitle} · 链路：${names}（${word}）`,
      groups: byLayer(nodes, layer, stepLabel),
      flows,
      order: 'given',
      view: { kind: 'chain', label: `链路：${names}（${word}）`, focus: starts, to: ends, towards },
    }),
  }
}

/** 一张图按规模是否还看得清（只看数量；出图后再结合实测交叉数判断） */
export function sizeReadable(model) {
  const reasons = []
  if (model.nodes.length > READABLE.nodes) reasons.push(`节点 ${model.nodes.length} 个（建议一张图不超过 ${READABLE.nodes} 个）`)
  if (model.flows.length > READABLE.flows) reasons.push(`流向 ${model.flows.length} 条（建议一张图不超过 ${READABLE.flows} 条）`)
  return reasons
}

/** 出图后的可读性判断：规模 + 实测交叉数 + 穿过节点的线 */
export function readability(model, metrics) {
  const reasons = sizeReadable(model)
  const allowed = Math.max(READABLE.minCrossings, Math.round(model.flows.length * READABLE.crossingsPerFlow))
  if (metrics && metrics.crossings > allowed) reasons.push(`连线交叉 ${metrics.crossings} 处（这张图建议不超过 ${allowed} 处）`)
  if (metrics && metrics.edgesThroughNodes > 0) reasons.push(`${metrics.edgesThroughNodes} 条线从别的节点框上经过`)
  return { ok: reasons.length === 0, reasons }
}

/** 拆图建议：总图看分组之间，节点多的分组各出一张分图，再给几条主要链路 */
export function suggestViews(model) {
  const out = [{ view: 'overview', why: '先看分组之间的关系（同一对分组之间的流向合并成一条线）' }]
  const outDeg = new Map(model.nodes.map((n) => [n.id, 0]))
  const inDeg = new Map(model.nodes.map((n) => [n.id, 0]))
  for (const f of model.flows) {
    outDeg.set(f.from, outDeg.get(f.from) + 1)
    inDeg.set(f.to, inDeg.get(f.to) + 1)
  }
  const groupsBySize = model.groups
    .map((g) => ({ g, n: g.nodes.length }))
    .filter((x) => x.n >= 3)
    .sort((a, b) => b.n - a.n)
  for (const { g, n } of groupsBySize.slice(0, 6)) out.push({ view: 'group', group: g.id, why: `“${g.label}”${n} 个节点和它的对外接口` })
  // 链路起点：没有输入、输出最多的节点（通常是外部来的指令或请求）
  const sources = model.nodes
    .filter((n) => inDeg.get(n.id) === 0 && outDeg.get(n.id) > 0)
    .sort((a, b) => outDeg.get(b.id) - outDeg.get(a.id))
  // 下游几乎一样的起点只留一个（比如几种指令都经同一个接收节点进来）
  const reach = (id) => {
    const seen = new Set([id])
    let fr = [id]
    while (fr.length) {
      const nx = []
      for (const u of fr) for (const f of model.flows) if (f.from === u && !seen.has(f.to)) { seen.add(f.to); nx.push(f.to) }
      fr = nx
    }
    return seen
  }
  const chosen = []
  for (const n of sources) {
    if (chosen.length >= 3) break
    const r = reach(n.id)
    r.delete(n.id)
    const similar = chosen.some((c) => {
      const inter = [...r].filter((x) => c.has(x)).length
      return inter / Math.max(1, Math.min(r.size, c.size)) > 0.7
    })
    if (similar) continue
    chosen.push(r)
    out.push({ view: 'chain', focus: [n.id], towards: 'down', why: `“${n.label}”往下游走到哪里` })
  }
  out.push({ view: 'matrix', why: 'N² 接口矩阵：没有连线，核对接口是否齐全' })
  return out
}
