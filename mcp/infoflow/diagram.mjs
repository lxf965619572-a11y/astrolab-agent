// 信息流图核心：规格校验、模型、Mermaid / SVG / Markdown 生成。
// 布局在 layout.mjs，视图（总图/分图/链路）在 views.mjs，N² 矩阵在 matrix.mjs。
// 本文件不读写文件、不联网，纯函数，便于 selftest.mjs 直接调用。

import {
  EDGE_FS, GENERATED_MARK, GROUP_FS, KIND_ORDER, LABEL_FS, LABEL_LH, LIMITS, M, NOTE_FS, NOTE_LH, TITLE_FS, VERSION,
  clean, escapeMermaid, escapeXml, fmt, isObject, isPending, kindStyle, measureText, normalizeKind, str, summarizeNames,
} from './common.mjs'
import { planDiagram } from './layout.mjs'
import { makeModel, readability, sizeReadable, suggestViews, viewModel } from './views.mjs'
import { renderMatrixMarkdown, renderMatrixSvg } from './matrix.mjs'

export {
  KINDS, KIND_ORDER, GROUP_COLORS, LIMITS, NODE_W, READABLE, VERSION,
  kindStyle, normalizeKind, isPending, measureText, wrapText, escapeXml, escapeMermaid,
} from './common.mjs'
export { planDiagram, laneOrder, sizeNode, measurePlan, sampleEdge } from './layout.mjs'
export { viewModel, suggestViews, readability, makeModel, sizeReadable, layerGraph } from './views.mjs'
export { matrixData } from './matrix.mjs'

function nodeName(nodeMap, id) {
  const n = nodeMap.get(id)
  return n ? n.label : id
}

// 规格校验：返回错误和提醒，不抛异常；错误不为空时不要出图
export function validateInfoFlow(spec) {
  const errors = []
  const warnings = []
  const stats = { groups: 0, nodes: 0, flows: 0 }
  if (!isObject(spec)) {
    return { ok: false, errors: ['图规格必须是一个 JSON 对象（包含 groups 和 flows）'], warnings, stats }
  }
  if (spec.title !== undefined && typeof spec.title !== 'string') errors.push('title 必须是字符串')
  if (spec.source !== undefined && typeof spec.source !== 'string') errors.push('source 必须是字符串')

  let direction = 'LR'
  if (spec.direction !== undefined) {
    direction = str(spec.direction).trim().toUpperCase()
    if (direction !== 'LR' && direction !== 'TB') errors.push('direction 只能是 "LR"（从左到右）或 "TB"（从上到下）')
  }
  if (spec.order !== undefined && !['auto', 'given'].includes(str(spec.order).trim())) {
    errors.push('order 只能是 "auto"（自动排列，交叉最少）或 "given"（按给出的顺序）')
  }

  if (!Array.isArray(spec.groups) || spec.groups.length === 0) {
    errors.push('groups 必须是非空数组，每个分组用 { id, label, nodes } 描述')
    return { ok: false, errors, warnings, stats }
  }
  if (spec.groups.length > LIMITS.groups) errors.push(`分组过多（${spec.groups.length} 个），最多 ${LIMITS.groups} 个；建议合并同类分组`)
  if (spec.flows !== undefined && !Array.isArray(spec.flows)) errors.push('flows 必须是数组')

  const groupIds = new Set()
  const groupLabels = new Map()
  const nodeIds = new Set()
  const nodeMap = new Map()
  const nodeLabels = new Map()
  let nodeCount = 0

  spec.groups.forEach((g, gi) => {
    if (!isObject(g)) {
      errors.push(`第 ${gi + 1} 个分组必须是对象`)
      return
    }
    const gid = str(g.id).trim()
    if (!gid) errors.push(`第 ${gi + 1} 个分组缺少 id`)
    else if (groupIds.has(gid)) errors.push(`分组 id 重复：${gid}`)
    else groupIds.add(gid)
    const glabel = g.label === undefined || g.label === '' ? gid : str(g.label)
    if (glabel) {
      if (groupLabels.has(glabel)) warnings.push(`分组名称重复：“${glabel}”，图中难以区分`)
      else groupLabels.set(glabel, gid)
    }
    if (!Array.isArray(g.nodes)) {
      errors.push(`分组“${glabel || gid}”的 nodes 必须是数组`)
      return
    }
    if (g.nodes.length === 0) warnings.push(`分组“${glabel || gid}”没有节点`)
    g.nodes.forEach((n, ni) => {
      if (!isObject(n)) {
        errors.push(`分组“${glabel || gid}”中第 ${ni + 1} 个节点必须是对象`)
        return
      }
      const nid = str(n.id).trim()
      if (!nid) {
        errors.push(`分组“${glabel || gid}”中第 ${ni + 1} 个节点缺少 id`)
        return
      }
      if (nid.startsWith('G:') || nid.startsWith('~')) errors.push(`节点 id 不能以“G:”或“~”开头（工具内部使用）：${nid}`)
      if (nodeIds.has(nid)) {
        errors.push(`节点 id 重复：${nid}（id 必须全图唯一）`)
        return
      }
      nodeIds.add(nid)
      nodeCount += 1
      const nlabel = n.label === undefined || n.label === '' ? nid : str(n.label)
      if (n.note !== undefined && typeof n.note !== 'string') errors.push(`节点“${nid}”的 note 必须是字符串`)
      if (nodeLabels.has(nlabel)) warnings.push(`节点名称重复：“${nlabel}”，建议在名称中区分`)
      else nodeLabels.set(nlabel, nid)
      nodeMap.set(nid, { id: nid, label: nlabel, groupIndex: gi, note: clean(n.note) })
    })
  })

  stats.groups = spec.groups.length
  stats.nodes = nodeCount
  if (nodeCount > LIMITS.nodes) errors.push(`节点过多（${nodeCount} 个），最多 ${LIMITS.nodes} 个；请按配置项拆成几个模型`)

  const flows = Array.isArray(spec.flows) ? spec.flows : []
  stats.flows = flows.length
  if (flows.length > LIMITS.flows) errors.push(`流向过多（${flows.length} 条），最多 ${LIMITS.flows} 条；建议合并同类流向或按配置项拆成几个模型`)

  const validFlows = []
  const flowKeys = new Set()
  const degree = new Map()
  for (const id of nodeIds) degree.set(id, { in: 0, out: 0 })
  flows.forEach((f, fi) => {
    if (!isObject(f)) {
      errors.push(`第 ${fi + 1} 条流向必须是对象`)
      return
    }
    const from = str(f.from).trim()
    const to = str(f.to).trim()
    const label = f.label === undefined ? '' : str(f.label).trim()
    if (!from || !to) {
      errors.push(`第 ${fi + 1} 条流向缺少 from 或 to`)
      return
    }
    if (f.label !== undefined && typeof f.label !== 'string') errors.push(`第 ${fi + 1} 条流向的 label 必须是字符串`)
    const kind = normalizeKind(f.kind)
    if (kind === null) {
      errors.push(`第 ${fi + 1} 条流向的 kind 不支持：“${f.kind}”；可选 data、command、event`)
      return
    }
    const fromKnown = nodeIds.has(from)
    const toKnown = nodeIds.has(to)
    if (!fromKnown) errors.push(`第 ${fi + 1} 条流向的起点不存在：${from}`)
    if (!toKnown) errors.push(`第 ${fi + 1} 条流向的终点不存在：${to}`)
    if (!fromKnown || !toKnown) return

    if (from === to) warnings.push(`节点“${nodeName(nodeMap, from)}”存在自环（${label || '无标签'}）`)
    const key = `${from}|${to}|${kind}|${label}`
    if (flowKeys.has(key)) warnings.push(`重复流向：${nodeName(nodeMap, from)} → ${nodeName(nodeMap, to)}（${label || '无标签'}）`)
    flowKeys.add(key)
    validFlows.push({ from, to, kind })
    degree.get(from).out += 1
    degree.get(to).in += 1
  })

  const isolated = [...nodeIds].filter((id) => degree.get(id).in === 0 && degree.get(id).out === 0)
  if (isolated.length) {
    warnings.push(`孤立节点（没有任何流向）：${summarizeNames(isolated.map((id) => nodeName(nodeMap, id)))}`)
  }

  // 环检测（不计自环，自环已单独提醒）
  const adj = new Map([...nodeIds].map((id) => [id, []]))
  for (const f of validFlows) if (f.from !== f.to) adj.get(f.from).push(f.to)
  const color = new Map()
  const cycles = []
  const stack = []
  const seenCycle = new Set()
  const dfs = (u) => {
    color.set(u, 1)
    stack.push(u)
    for (const v of adj.get(u) || []) {
      if (color.get(v) === 1) {
        const i = stack.indexOf(v)
        if (i >= 0) {
          const cycle = stack.slice(i).concat(v)
          const key = [...new Set(cycle)].sort().join('|')
          if (!seenCycle.has(key)) {
            seenCycle.add(key)
            cycles.push(cycle)
          }
        }
      } else if (!color.get(v)) {
        dfs(v)
      }
    }
    stack.pop()
    color.set(u, 2)
  }
  for (const id of nodeIds) if (!color.get(id)) dfs(id)
  if (cycles.length) {
    const text = cycles.slice(0, 2).map((c) => c.map((id) => nodeName(nodeMap, id)).join(' → ')).join('；')
    warnings.push(`信息流存在环：${text}${cycles.length > 2 ? ` 等 ${cycles.length} 个环` : ''}；请确认是否为反馈/控制闭环`)
  }

  return { ok: errors.length === 0, errors, warnings, stats, direction }
}

/** 规格 → 完整模型（全图） */
export function normalize(spec) {
  const direction = spec.direction === undefined ? 'LR' : str(spec.direction).trim().toUpperCase()
  const title = spec.title === undefined || spec.title === '' ? '信息流图' : str(spec.title)
  const groups = spec.groups.map((g) => {
    const id = str(g.id).trim()
    return {
      id,
      label: g.label === undefined || g.label === '' ? id : str(g.label),
      nodes: (g.nodes || []).map((n) => {
        const nid = str(n.id).trim()
        return { id: nid, label: n.label === undefined || n.label === '' ? nid : str(n.label), note: clean(n.note) }
      }),
    }
  })
  const flows = (spec.flows || []).map((f) => ({
    from: str(f.from).trim(),
    to: str(f.to).trim(),
    label: f.label === undefined ? '' : str(f.label).trim(),
    kind: normalizeKind(f.kind) || 'data',
  }))
  return makeModel({ title, source: clean(spec.source), direction, order: spec.order ? str(spec.order).trim() : 'auto', groups, flows })
}

export function renderMermaid(model) {
  const nodeAlias = new Map()
  model.nodes.forEach((n, i) => nodeAlias.set(n.id, `n${i}`))
  const lines = []
  lines.push(`%% ${escapeMermaid(normalizeComment(model.title))}`)
  if (model.source) lines.push(`%% 依据：${escapeMermaid(normalizeComment(model.source))}`)
  lines.push(`flowchart ${model.direction}`)
  const nodeText = (n) => {
    const head = n.tag ? `${escapeMermaid(n.tag)}：${escapeMermaid(n.label)}` : escapeMermaid(n.label)
    return n.note ? `${head}<br/>${escapeMermaid(n.note)}` : head
  }
  if (model.plain) for (const n of model.nodes) lines.push(`  ${nodeAlias.get(n.id)}["${nodeText(n)}"]`)
  model.groups.forEach((g, gi) => {
    if (model.plain) return
    lines.push(`  subgraph g${gi}["${escapeMermaid(g.label)}"]`)
    lines.push(`    direction ${model.direction === 'LR' ? 'TB' : 'LR'}`)
    for (const n of g.nodes) lines.push(`    ${nodeAlias.get(n.id)}["${nodeText(n)}"]`)
    lines.push('  end')
  })
  for (const f of model.flows) {
    const style = kindStyle(f.kind)
    const label = f.label ? `|${escapeMermaid(f.label)}|` : ''
    const arrow = f.both ? `<${style.arrow}` : style.arrow
    lines.push(`  ${nodeAlias.get(f.from)} ${arrow}${label} ${nodeAlias.get(f.to)}`)
  }
  if (!model.plain) model.groups.forEach((g, gi) => lines.push(`  style g${gi} fill:#f8fafc,stroke:${g.color},stroke-width:1px`))
  const byFlag = (flag) => model.nodes.filter((n) => n[flag]).map((n) => nodeAlias.get(n.id))
  lines.push('  classDef pending fill:#fffbeb,stroke:#b45309,stroke-width:1.5px,stroke-dasharray:5 3')
  if (byFlag('pending').length) lines.push(`  class ${byFlag('pending').join(',')} pending`)
  if (byFlag('ext').length) {
    lines.push('  classDef ext fill:#f8fafc,stroke:#94a3b8,color:#64748b,stroke-dasharray:3 3')
    lines.push(`  class ${byFlag('ext').join(',')} ext`)
  }
  if (byFlag('focus').length) {
    lines.push('  classDef focus stroke-width:3px')
    lines.push(`  class ${byFlag('focus').join(',')} focus`)
  }
  model.flows.forEach((f, i) => {
    const style = kindStyle(f.kind)
    const dash = style.dash ? `,stroke-dasharray:${style.dash}` : ''
    const w = f.weight > 1 ? style.width * (1 + 0.45 * Math.log2(f.weight)) : style.width
    lines.push(`  linkStyle ${i} stroke:${style.color},stroke-width:${fmt(w)}px${dash}`)
  })
  return lines.join('\n') + '\n'
}

function normalizeComment(s) {
  return clean(s).replace(/\n/g, ' ')
}

function textBlock(node) {
  const top = node.y + (node.tagH || 0) + (node.h - (node.tagH || 0) - node.blockH) / 2
  let baseline = top + LABEL_FS * 0.82
  const labels = []
  for (const line of node.labelLines) {
    labels.push({ text: line, y: baseline })
    baseline += LABEL_LH
  }
  const notes = []
  if (node.noteLines.length) {
    baseline += 4 + NOTE_FS * 0.82
    for (const line of node.noteLines) {
      notes.push({ text: line, y: baseline })
      baseline += NOTE_LH
    }
  }
  return { labels, notes }
}

export function renderSvg(model, plan) {
  const width = plan.width
  const height = plan.height
  const out = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(model.title)}" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif">`)
  out.push(`  <!-- ${GENERATED_MARK} ${VERSION} -->`)
  out.push('  <defs>')
  for (const kind of KIND_ORDER) {
    const s = kindStyle(kind)
    out.push(`    <marker id="arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${s.color}"/></marker>`)
    out.push(`    <marker id="arrow-${kind}-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="${s.color}"/></marker>`)
  }
  out.push('  </defs>')
  out.push(`  <rect width="${width}" height="${height}" fill="#ffffff"/>`)
  out.push(`  <text x="${M}" y="${plan.titleBaseline}" font-size="${TITLE_FS}" font-weight="700" fill="#0f172a">${escapeXml(model.title)}</text>`)

  // 泳道背景和分组标题
  for (const lane of model.plain ? [] : plan.lanes) {
    const color = lane.group.color
    out.push(`  <g class="lane" data-group="${escapeXml(lane.group.id)}">`)
    out.push(`    <rect x="${fmt(lane.x)}" y="${fmt(lane.y)}" width="${fmt(lane.w)}" height="${fmt(lane.h)}" rx="14" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>`)
    if (model.direction === 'TB') {
      const hw = lane.headerW
      out.push(`    <path d="M ${fmt(lane.x + 14)} ${fmt(lane.y)} H ${fmt(lane.x + hw)} V ${fmt(lane.y + lane.h)} H ${fmt(lane.x + 14)} Q ${fmt(lane.x)} ${fmt(lane.y + lane.h)} ${fmt(lane.x)} ${fmt(lane.y + lane.h - 14)} V ${fmt(lane.y + 14)} Q ${fmt(lane.x)} ${fmt(lane.y)} ${fmt(lane.x + 14)} ${fmt(lane.y)} Z" fill="${color}" fill-opacity="0.12"/>`)
      const startY = lane.y + lane.h / 2 - (lane.labelLines.length - 1) * 8.5 + 4.5
      out.push(`    <text x="${fmt(lane.x + hw / 2)}" y="${fmt(startY)}" text-anchor="middle" font-size="${GROUP_FS}" font-weight="700" fill="${color}">`)
      lane.labelLines.forEach((line, i) => out.push(`      <tspan x="${fmt(lane.x + hw / 2)}" y="${fmt(startY + i * 17)}">${escapeXml(line)}</tspan>`))
      out.push('    </text>')
      out.push(`    <line x1="${fmt(lane.x + hw)}" y1="${fmt(lane.y + 6)}" x2="${fmt(lane.x + hw)}" y2="${fmt(lane.y + lane.h - 6)}" stroke="${color}" stroke-opacity="0.25"/>`)
    } else {
      out.push(`    <path d="M ${fmt(lane.x)} ${fmt(lane.y + 14)} Q ${fmt(lane.x)} ${fmt(lane.y)} ${fmt(lane.x + 14)} ${fmt(lane.y)} H ${fmt(lane.x + lane.w - 14)} Q ${fmt(lane.x + lane.w)} ${fmt(lane.y)} ${fmt(lane.x + lane.w)} ${fmt(lane.y + 14)} V ${fmt(lane.y + lane.headerH)} H ${fmt(lane.x)} Z" fill="${color}" fill-opacity="0.12"/>`)
      const startY = lane.y + lane.headerH / 2 - (lane.labelLines.length - 1) * 8.5 + 4.5
      out.push(`    <text x="${fmt(lane.x + lane.w / 2)}" y="${fmt(startY)}" text-anchor="middle" font-size="${GROUP_FS}" font-weight="700" fill="${color}">`)
      lane.labelLines.forEach((line, i) => out.push(`      <tspan x="${fmt(lane.x + lane.w / 2)}" y="${fmt(startY + i * 17)}">${escapeXml(line)}</tspan>`))
      out.push('    </text>')
    }
    out.push('  </g>')
  }

  // 连线：先画白色描边垫底，交叉处看得出谁在上面
  out.push('  <g class="edges">')
  // data-e 是连线序号（线、白底、标签同一个号），交互版 HTML 靠它把一条流向的几部分一起高亮
  plan.edges.forEach((e, i) => {
    out.push(`    <path class="halo" data-e="${i}" data-kind="${e.flow.kind}" d="${e.d}" fill="none" stroke="#ffffff" stroke-width="${fmt(e.width + 3)}" stroke-opacity="0.85" stroke-linecap="round"/>`)
    const dash = e.style.dash ? ` stroke-dasharray="${e.style.dash}"` : ''
    out.push(`    <path class="edge" data-e="${i}" data-kind="${e.flow.kind}" d="${e.d}" fill="none" stroke="${e.style.color}" stroke-width="${fmt(e.width)}"${dash} stroke-linecap="round" marker-end="url(#arrow-${e.flow.kind})"${e.flow.both ? ` marker-start="url(#arrow-${e.flow.kind}-start)"` : ''} data-from="${escapeXml(e.flow.from)}" data-to="${escapeXml(e.flow.to)}"/>`)
  })
  out.push('  </g>')

  // 连线标签（放在节点之前，避免遮住节点文字）
  out.push('  <g class="edge-labels">')
  plan.edges.forEach((e, i) => {
    if (!e.flow.label) return
    const tw = measureText(e.flow.label, EDGE_FS)
    const lx = e.labelAt.x
    const ly = e.labelAt.y
    out.push(`    <g class="elabel" data-e="${i}" data-kind="${e.flow.kind}">`)
    out.push(`      <rect x="${fmt(lx - tw / 2 - 5)}" y="${fmt(ly - 9)}" width="${fmt(tw + 10)}" height="18" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="#e2e8f0"/>`)
    out.push(`      <text x="${fmt(lx)}" y="${fmt(ly + 4)}" text-anchor="middle" font-size="${EDGE_FS}" fill="${e.style.color}">${escapeXml(e.flow.label)}</text>`)
    out.push('    </g>')
  })
  out.push('  </g>')

  // 节点
  out.push('  <g class="nodes">')
  for (const node of plan.nodes) {
    const gcolor = node.color || model.groups[node.groupIndex].color
    const cls = ['node', node.pending && 'pending', node.ext && 'ext', node.focus && 'focus'].filter(Boolean).join(' ')
    out.push(`    <g class="${cls}" data-id="${escapeXml(node.id)}">`)
    let fill = node.pending ? '#fffbeb' : '#ffffff'
    let stroke = gcolor
    let sw = node.focus ? 3 : 1.4
    let dash = node.pending ? ' stroke-dasharray="5 3"' : ''
    let ink = '#0f172a'
    let noteInk = '#475569'
    if (node.ext) {
      fill = '#f8fafc'
      stroke = '#94a3b8'
      sw = 1.2
      dash = ' stroke-dasharray="3 3"'
      ink = '#64748b'
      noteInk = '#94a3b8'
    }
    out.push(`      <rect x="${fmt(node.x)}" y="${fmt(node.y)}" width="${fmt(node.w)}" height="${fmt(node.h)}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`)
    if (node.pending) out.push(`      <circle cx="${fmt(node.x + node.w - 10)}" cy="${fmt(node.y + 10)}" r="3.2" fill="#d97706"/>`)
    const tag = [node.focus && '起点', node.tag].filter(Boolean).join(' · ')
    if (tag) out.push(`      <text x="${fmt(node.x + 8)}" y="${fmt(node.y + 14)}" font-size="10" font-weight="700" fill="${node.ext ? '#94a3b8' : gcolor}">${escapeXml(tag)}</text>`)
    const block = textBlock(node)
    if (block.labels.length) {
      out.push(`      <text x="${fmt(node.cx)}" text-anchor="middle" font-size="${LABEL_FS}" font-weight="${node.summary ? 400 : 600}" fill="${ink}">`)
      for (const line of block.labels) out.push(`        <tspan x="${fmt(node.cx)}" y="${fmt(line.y)}">${escapeXml(line.text)}</tspan>`)
      out.push('      </text>')
    }
    if (block.notes.length) {
      out.push(`      <text x="${fmt(node.cx)}" text-anchor="middle" font-size="${NOTE_FS}" fill="${noteInk}">`)
      for (const line of block.notes) out.push(`        <tspan x="${fmt(node.cx)}" y="${fmt(line.y)}">${escapeXml(line.text)}</tspan>`)
      out.push('      </text>')
    }
    out.push('    </g>')
  }
  out.push('  </g>')

  // 图例
  if (plan.legend.hasLegend) {
    let x = M + 44
    const y = plan.legend.y
    const item = (draw, label) => {
      out.push(draw(x))
      out.push(`    <text x="${fmt(x + 30)}" y="${fmt(y + 4)}" font-size="${EDGE_FS}" fill="#475569">${label}</text>`)
      x += 30 + measureText(label, EDGE_FS) + 22
    }
    out.push('  <g class="legend">')
    out.push(`    <text x="${M}" y="${fmt(y + 4)}" font-size="${EDGE_FS}" font-weight="700" fill="#334155">图例</text>`)
    for (const kind of plan.legend.usedKinds) {
      const s = kindStyle(kind)
      const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : ''
      item((x0) => `    <line x1="${x0}" y1="${y}" x2="${x0 + 24}" y2="${y}" stroke="${s.color}" stroke-width="${s.width}"${dash} marker-end="url(#arrow-${kind})"/>`, s.label)
    }
    if (plan.legend.hasPending) item((x0) => `    <rect x="${x0}" y="${fmt(y - 7)}" width="24" height="14" rx="4" fill="#fffbeb" stroke="#b45309" stroke-dasharray="5 3"/>`, '待确认')
    if (plan.legend.hasExt) item((x0) => `    <rect x="${x0}" y="${fmt(y - 7)}" width="24" height="14" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="3 3"/>`, '外部节点（本图范围之外）')
    if (plan.legend.hasFocus) item((x0) => `    <rect x="${x0}" y="${fmt(y - 7)}" width="24" height="14" rx="4" fill="#ffffff" stroke="#334155" stroke-width="2.5"/>`, '链路起点')
    if (plan.legend.hasWeight) item((x0) => `    <line x1="${x0}" y1="${y}" x2="${x0 + 24}" y2="${y}" stroke="#64748b" stroke-width="4"/>`, '一对分组之间的流向合并成一条，线越粗条数越多；两头箭头表示双向')
    if (plan.legend.omitted) {
      out.push(`    <text x="${fmt(x)}" y="${fmt(y + 4)}" font-size="${EDGE_FS}" fill="#b45309">只画了流向不少于 ${plan.legend.omitted.minWeight} 条的分组对；另有 ${plan.legend.omitted.omitted} 对的少量流向未画，见 N² 接口矩阵</text>`)
    }
    out.push('  </g>')
  }

  if (model.source) {
    out.push(`  <text x="${width - M}" y="${fmt(plan.sourceY + 10)}" text-anchor="end" font-size="10" fill="#64748b">依据：${escapeXml(model.source)}</text>`)
  }
  out.push('</svg>')
  return out.join('\n') + '\n'
}

/** 视图的 Markdown：图片 + 可折叠的 Mermaid 源码 + 统计 + 待确认清单 */
export function renderMarkdown(result, { svgFile, modelFile }) {
  const { model, metrics, readable } = result
  const L = []
  L.push(`<!-- ${GENERATED_MARK} ${VERSION} -->`)
  L.push(`# ${model.title}`)
  L.push('')
  if (model.source) L.push(`> 依据：${model.source}`)
  L.push(`> 由模型 \`${modelFile}\` 生成（${model.view.label}）；要修改请改模型后重新出图，不要手改本文件和图片。`)
  L.push('')
  L.push(`![${model.title}](./${encodeURI(svgFile)})`)
  L.push('')
  L.push('<details><summary>Mermaid 源码</summary>')
  L.push('')
  L.push('```mermaid')
  L.push(result.mermaid.trimEnd())
  L.push('```')
  L.push('')
  L.push('</details>')
  L.push('')
  L.push('## 统计')
  L.push('')
  L.push(`- 分组 ${model.groups.length} 个，节点 ${model.nodes.length} 个，流向 ${model.flows.length} 条。`)
  L.push(`- 连线交叉 ${metrics.crossings} 处；从别的节点框上经过的线 ${metrics.edgesThroughNodes} 条；重叠的标签 ${metrics.labelOverlaps} 个。`)
  if (model.view.omitted) L.push(`- 总图只画了流向不少于 ${model.view.minWeight} 条的分组对；另有 ${model.view.omitted} 对分组之间的少量流向没有画，完整清单见 N² 接口矩阵。`)
  L.push(readable.ok ? '- 可读性：在一张图能看清的范围内。' : `- 可读性：偏密（${readable.reasons.join('；')}），建议看总图、分图或链路图。`)
  const pend = model.nodes.filter((n) => n.pending && !n.summary)
  if (pend.length) {
    L.push('')
    L.push('## 待确认')
    L.push('')
    for (const n of pend) L.push(`- ${n.label}：${n.note || '（见节点说明）'}`)
  }
  L.push('')
  return L.join('\n')
}

/**
 * 校验并生成一张视图。opts：{ view, group, focus, towards, depth, order }
 * 返回 { model（视图模型）, full（完整模型）, plan, mermaid, svg, warnings, stats, metrics, readable, suggestedViews }
 */
export function buildDiagram(spec, opts = {}) {
  const check = validateInfoFlow(spec)
  if (!check.ok) {
    const err = new Error(`图规格有错误：\n- ${check.errors.join('\n- ')}`)
    err.validation = check
    throw err
  }
  const full = normalize(spec)
  const v = viewModel(full, opts)
  if (v.error) throw new Error(v.error)
  const model = v.model
  const plan = planDiagram(model, { order: opts.order })
  const readable = readability(model, plan.metrics)
  return {
    model,
    full,
    plan,
    mermaid: renderMermaid(model),
    svg: renderSvg(model, plan),
    warnings: check.warnings,
    stats: { groups: model.groups.length, nodes: model.nodes.length, flows: model.flows.length },
    modelStats: check.stats,
    metrics: plan.metrics,
    readable,
    suggestedViews: readable.ok ? [] : suggestViews(full),
  }
}

/** 校验 + 规模建议（不出图） */
export function checkModel(spec) {
  const check = validateInfoFlow(spec)
  if (!check.ok) return { ...check, suggestedViews: [] }
  const full = normalize(spec)
  const reasons = sizeReadable(full)
  const warnings = check.warnings.slice()
  if (reasons.length) warnings.push(`整个模型一张全图会看不清（${reasons.join('；')}）；请按 suggestedViews 出总图、分图、链路图和 N² 矩阵`)
  return { ...check, warnings, suggestedViews: reasons.length ? suggestViews(full) : [] }
}

/** N² 矩阵：level = 'node' | 'group' */
export function buildMatrix(spec, level = 'node') {
  const check = validateInfoFlow(spec)
  if (!check.ok) {
    const err = new Error(`图规格有错误：\n- ${check.errors.join('\n- ')}`)
    err.validation = check
    throw err
  }
  if (!['node', 'group'].includes(level)) throw new Error('level 只能是 node（逐个节点）或 group（分组之间）')
  const full = normalize(spec)
  const model = { ...full, title: `${full.baseTitle} · N² 接口矩阵${level === 'group' ? '（分组）' : ''}` }
  const { svg, data } = renderMatrixSvg(model, level)
  return {
    model,
    svg,
    data,
    markdown: (files) => renderMatrixMarkdown(model, data, { ...files, level }),
    warnings: check.warnings,
    stats: check.stats,
  }
}
