// N² 接口矩阵：对角线是节点（或分组），第 i 行第 j 列是从 i 流向 j 的内容。
// 没有连线，规模再大也不会重叠；用来核对接口是否齐全（谁只进不出、谁没有输入、哪对接口只有单向）。

import {
  EDGE_FS, GENERATED_MARK, KIND_ORDER, M, TITLE_FS, VERSION,
  escapeCell, escapeXml, fmt, kindStyle, measureText, wrapText,
} from './common.mjs'

function items(model, level) {
  if (level === 'group') {
    return model.groups.map((g, gi) => ({ id: g.id, label: g.label, note: `${g.nodes.length} 个节点`, color: g.color, gi, pending: g.nodes.some((n) => n.pending) }))
  }
  return model.nodes.map((n) => ({ id: n.id, label: n.label, note: n.note, color: model.groups[n.groupIndex].color, gi: n.groupIndex, pending: n.pending }))
}

/** 返回 { items, cells: Map('i|j' → flows[]), noIn, noOut, isolated } */
export function matrixData(model, level = 'node') {
  const its = items(model, level)
  const index = new Map(its.map((it, i) => [it.id, i]))
  const key = (id) => (level === 'group' ? model.groups[model.nodeMap.get(id).groupIndex].id : id)
  const cells = new Map()
  const inN = new Array(its.length).fill(0)
  const outN = new Array(its.length).fill(0)
  let inner = 0
  for (const f of model.flows) {
    const i = index.get(key(f.from))
    const j = index.get(key(f.to))
    if (i === j) { inner++; if (level === 'group') continue }
    const k = `${i}|${j}`
    if (!cells.has(k)) cells.set(k, [])
    cells.get(k).push(f)
    if (i !== j) { outN[i]++; inN[j]++ }
  }
  const noIn = its.filter((_, i) => inN[i] === 0 && outN[i] > 0)
  const noOut = its.filter((_, i) => outN[i] === 0 && inN[i] > 0)
  const isolated = its.filter((_, i) => inN[i] === 0 && outN[i] === 0)
  const oneWay = []
  for (const k of cells.keys()) {
    const [i, j] = k.split('|').map(Number)
    if (i !== j && !cells.has(`${j}|${i}`)) oneWay.push([its[i], its[j]])
  }
  return { items: its, cells, inN, outN, noIn, noOut, isolated, oneWay, inner }
}

export function renderMatrixSvg(model, level = 'node') {
  const d = matrixData(model, level)
  const n = d.items.length
  const CW = level === 'group' ? 150 : 128
  const CH = level === 'group' ? 70 : 62
  const bandTop = 28
  const bandLeft = 30
  const titleH = 64
  const x0 = M + bandLeft
  const y0 = M + titleH + bandTop
  const width = Math.max(640, x0 + n * CW + M, M * 2 + measureText(model.title, TITLE_FS) + 40)
  const legendY = y0 + n * CH + 30
  const height = legendY + (model.source ? 46 : 24)
  const out = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" role="img" aria-label="${escapeXml(model.title)}" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif">`)
  out.push(`  <!-- ${GENERATED_MARK} ${VERSION} -->`)
  out.push(`  <rect width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff"/>`)
  out.push(`  <text x="${M}" y="${M + 14}" font-size="${TITLE_FS}" font-weight="700" fill="#0f172a">${escapeXml(model.title)}</text>`)
  out.push(`  <text x="${M}" y="${M + 40}" font-size="12" fill="#475569">行是发出方，列是接收方；第 i 行第 j 列写从 i 流向 j 的内容。对角线是${level === 'group' ? '分组' : '节点'}本身。</text>`)

  // 分组色带（节点级）：上方和左侧标出每段属于哪个分组
  if (level === 'node') {
    let start = 0
    for (let i = 1; i <= n; i++) {
      if (i < n && d.items[i].gi === d.items[start].gi) continue
      const g = model.groups[d.items[start].gi]
      const len = i - start
      out.push(`  <rect x="${fmt(x0 + start * CW)}" y="${fmt(y0 - bandTop)}" width="${fmt(len * CW)}" height="${bandTop - 4}" rx="4" fill="${g.color}" fill-opacity="0.14"/>`)
      const lines = wrapText(g.label, len * CW - 12, 12)
      out.push(`  <text x="${fmt(x0 + start * CW + (len * CW) / 2)}" y="${fmt(y0 - bandTop / 2 + 2)}" text-anchor="middle" font-size="12" font-weight="700" fill="${g.color}">${escapeXml(lines[0])}</text>`)
      out.push(`  <rect x="${fmt(x0 - bandLeft)}" y="${fmt(y0 + start * CH)}" width="${bandLeft - 4}" height="${fmt(len * CH)}" rx="4" fill="${g.color}" fill-opacity="0.14"/>`)
      // 左侧竖排分组名（每字一行）
      const chars = [...g.label].slice(0, Math.max(1, Math.floor((len * CH - 8) / 14)))
      const cy = y0 + start * CH + (len * CH) / 2 - ((chars.length - 1) * 14) / 2 + 4
      chars.forEach((ch, k) => out.push(`  <text x="${fmt(x0 - bandLeft / 2 - 2)}" y="${fmt(cy + k * 14)}" text-anchor="middle" font-size="11" font-weight="700" fill="${g.color}">${escapeXml(ch)}</text>`))
      start = i
    }
  }

  // 格子
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = x0 + j * CW
      const y = y0 + i * CH
      if (i === j) {
        const it = d.items[i]
        const dash = it.pending ? ' stroke-dasharray="5 3"' : ''
        out.push(`  <rect x="${fmt(x + 2)}" y="${fmt(y + 2)}" width="${CW - 4}" height="${CH - 4}" rx="6" fill="${it.pending ? '#fffbeb' : '#ffffff'}" stroke="${it.color}" stroke-width="1.4"${dash}/>`)
        const lines = wrapText(it.label, CW - 16, 12).slice(0, 2)
        lines.forEach((ln, k) => out.push(`  <text x="${fmt(x + CW / 2)}" y="${fmt(y + 22 + k * 15)}" text-anchor="middle" font-size="12" font-weight="600" fill="#0f172a">${escapeXml(ln)}</text>`))
        const tags = []
        if (d.inN[i] === 0 && d.outN[i] === 0) tags.push('孤立')
        else if (d.inN[i] === 0) tags.push('无输入')
        else if (d.outN[i] === 0) tags.push('无输出')
        if (tags.length) out.push(`  <text x="${fmt(x + CW - 8)}" y="${fmt(y + CH - 9)}" text-anchor="end" font-size="10" fill="#b45309">${tags.join(' ')}</text>`)
        continue
      }
      const fs = d.cells.get(`${i}|${j}`)
      out.push(`  <rect x="${fmt(x)}" y="${fmt(y)}" width="${CW}" height="${CH}" fill="${fs ? '#f8fafc' : '#ffffff'}" stroke="#e2e8f0" stroke-width="0.8"/>`)
      if (!fs) continue
      const maxLines = level === 'group' ? 3 : 3
      const shown = fs.slice(0, fs.length > maxLines ? maxLines - 1 : maxLines)
      const lines = []
      if (level === 'group') lines.push({ text: `${fs.length} 条`, color: '#0f172a', bold: true })
      for (const f of shown) {
        const label = f.label || '（无标签）'
        const t = wrapText(label, CW - 14, EDGE_FS)[0]
        lines.push({ text: t + (t !== label ? '…' : ''), color: kindStyle(f.kind).color })
      }
      if (fs.length > shown.length) lines.push({ text: `… 共 ${fs.length} 条`, color: '#64748b' })
      const top = y + (CH - lines.length * 14) / 2 + 10
      lines.slice(0, 4).forEach((ln, k) => out.push(`  <text x="${fmt(x + CW / 2)}" y="${fmt(top + k * 14)}" text-anchor="middle" font-size="${EDGE_FS}"${ln.bold ? ' font-weight="700"' : ''} fill="${ln.color}">${escapeXml(ln.text)}</text>`))
    }
  }
  // 分组分界线
  if (level === 'node') {
    for (let i = 1; i < n; i++) {
      if (d.items[i].gi === d.items[i - 1].gi) continue
      out.push(`  <line x1="${fmt(x0 + i * CW)}" y1="${fmt(y0)}" x2="${fmt(x0 + i * CW)}" y2="${fmt(y0 + n * CH)}" stroke="#94a3b8" stroke-width="1.2"/>`)
      out.push(`  <line x1="${fmt(x0)}" y1="${fmt(y0 + i * CH)}" x2="${fmt(x0 + n * CW)}" y2="${fmt(y0 + i * CH)}" stroke="#94a3b8" stroke-width="1.2"/>`)
    }
  }
  out.push(`  <rect x="${fmt(x0)}" y="${fmt(y0)}" width="${n * CW}" height="${n * CH}" fill="none" stroke="#94a3b8" stroke-width="1.2"/>`)

  // 图例
  let lx = M + 44
  out.push(`  <text x="${M}" y="${fmt(legendY + 4)}" font-size="${EDGE_FS}" font-weight="700" fill="#334155">图例</text>`)
  for (const k of KIND_ORDER.filter((k) => model.flows.some((f) => f.kind === k))) {
    const s = kindStyle(k)
    out.push(`  <text x="${fmt(lx)}" y="${fmt(legendY + 4)}" font-size="${EDGE_FS}" fill="${s.color}">■ ${s.label}</text>`)
    lx += measureText(`■ ${s.label}`, EDGE_FS) + 20
  }
  out.push(`  <text x="${fmt(lx)}" y="${fmt(legendY + 4)}" font-size="${EDGE_FS}" fill="#b45309">无输入 / 无输出 / 孤立：请核对是否漏了接口</text>`)
  if (model.source) out.push(`  <text x="${fmt(width - M)}" y="${fmt(legendY + 30)}" text-anchor="end" font-size="10" fill="#64748b">依据：${escapeXml(model.source)}</text>`)
  out.push('</svg>')
  return { svg: out.join('\n') + '\n', data: d }
}

export function renderMatrixMarkdown(model, data, { svgFile, modelFile, level }) {
  const d = data
  const kindName = (k) => kindStyle(k).label
  const L = []
  L.push(`<!-- ${GENERATED_MARK} ${VERSION} -->`)
  L.push(`# ${model.title}`)
  L.push('')
  if (model.source) L.push(`> 依据：${model.source}`)
  L.push(`> 行是发出方，列是接收方。由模型 \`${modelFile}\` 生成；要修改请改模型后重新出图，不要手改本文件。`)
  L.push('')
  L.push(`![N² 接口矩阵](./${encodeURI(svgFile)})`)
  L.push('')
  // 分组之间的矩阵总是给出（规模小，表格放得下）
  const g = level === 'group' ? d : matrixData(model, 'group')
  L.push('## 分组之间')
  L.push('')
  L.push(`| 从 ＼ 到 | ${g.items.map((x) => escapeCell(x.label)).join(' | ')} |`)
  L.push(`|---|${g.items.map(() => '---').join('|')}|`)
  g.items.forEach((row, i) => {
    const cells = g.items.map((_, j) => {
      if (i === j) return '—'
      const fs = g.cells.get(`${i}|${j}`)
      if (!fs) return ''
      const labels = [...new Set(fs.map((f) => f.label).filter(Boolean))]
      return escapeCell(`${fs.length} 条${labels.length ? `：${labels.slice(0, 3).join('、')}${labels.length > 3 ? '…' : ''}` : ''}`)
    })
    L.push(`| **${escapeCell(row.label)}** | ${cells.join(' | ')} |`)
  })
  L.push('')
  if (level !== 'group') {
    L.push('## 逐个节点的接口')
    L.push('')
    const gname = (id) => model.groups[model.nodeMap.get(id).groupIndex].label
    for (const grp of model.groups) {
      L.push(`### ${grp.label}`)
      L.push('')
      for (const n of grp.nodes) {
        L.push(`**${n.label}**${n.note ? `（${n.note}）` : ''}`)
        const outs = model.flows.filter((f) => f.from === n.id)
        const ins = model.flows.filter((f) => f.to === n.id)
        const fmtF = (f, other) => `${model.nodeMap.get(other).label}〔${gname(other)}〕：${f.label || '（无标签）'}（${kindName(f.kind)}）`
        L.push(`- 输出：${outs.length ? outs.map((f) => `→ ${fmtF(f, f.to)}`).join('；') : '无'}`)
        L.push(`- 输入：${ins.length ? ins.map((f) => `← ${fmtF(f, f.from)}`).join('；') : '无'}`)
        L.push('')
      }
    }
  }
  L.push('## 完整性提醒')
  L.push('')
  const names = (xs) => xs.map((x) => x.label).join('、')
  const any = d.noIn.length || d.noOut.length || d.isolated.length
  if (d.noIn.length) L.push(`- 没有输入（只发出）：${names(d.noIn)}。外部来源属正常，其余请核对是否漏了输入。`)
  if (d.noOut.length) L.push(`- 没有输出（只接收）：${names(d.noOut)}。终端执行或存储属正常，其余请核对结果去了哪里。`)
  if (d.isolated.length) L.push(`- 孤立（没有任何流向）：${names(d.isolated)}。`)
  if (!any) L.push('- 每个节点都有输入和输出。')
  if (level === 'group' && d.oneWay.length) L.push(`- 只有单向流向的分组对：${d.oneWay.map(([a, b]) => `${a.label} → ${b.label}`).join('；')}（请确认是否需要应答或状态回报）。`)
  L.push('')
  return L.join('\n')
}
