// 交互版信息流图：一个自带全部内容的 HTML 文件（不联网、不引用外部脚本和字体），用浏览器打开即可。
// 里面有全图、总图、各分图和 N² 矩阵（都是本服务自己排版的 SVG），加上：
//   拖动平移、滚轮缩放、适合窗口；点一个方块高亮它的上下游和连线，右边列出流入、流出；
//   搜节点；按流向类型筛选；待确认清单；选起点和终点找最短路径并高亮。
// 大模型一张静态全图看不清，这里照样出全图：可以缩放、点选、只看一条链路。

import { GENERATED_MARK, VERSION, escapeXml, isPending, kindStyle } from './common.mjs'
import { buildDiagram, buildMatrix, normalize } from './diagram.mjs'

const KINDS = ['data', 'command', 'event']

/** 生成 HTML 文本 */
export function renderHtml(spec) {
  const full = normalize(spec)
  const views = []
  const add = (key, label, opts, note = '') => {
    try {
      const r = buildDiagram(spec, opts)
      views.push({
        key, label, note,
        svg: r.svg.replace(/^<\?xml[^>]*>\s*/, ''),
        edges: r.plan.edges.map((e) => ({ from: e.flow.from, to: e.flow.to, label: e.flow.label || '', kind: e.flow.kind, both: !!e.flow.both, weight: e.flow.weight || 1 })),
        metrics: r.metrics,
      })
    } catch (e) { views.push({ key, label, note, error: e.message, svg: '', edges: [] }) }
  }
  add('full', '全图', { view: 'full' }, '全部节点和流向；大图可以缩放，点方块只看它的上下游')
  if (full.groups.length > 1) add('overview', '总图', { view: 'overview' }, '每个分组一个方块，一对分组之间的流向合并成一条线（越粗条数越多）')
  for (const g of full.groups) add(`group:${g.id}`, g.label, { view: 'group', group: g.id }, `“${g.label}”和它的对外接口`)
  try {
    const m = buildMatrix(spec, 'node')
    views.push({ key: 'matrix', label: 'N² 矩阵', note: '行是发出方，列是接收方；格子里是流向', svg: m.svg.replace(/^<\?xml[^>]*>\s*/, ''), edges: [] })
  } catch { /* 矩阵失败不影响其他视图 */ }

  const data = {
    version: VERSION,
    title: full.title,
    source: full.source || '',
    groups: full.groups.map((g) => ({ id: g.id, label: g.label, color: g.color, nodes: g.nodes.map((n) => n.id) })),
    nodes: full.nodes.map((n) => ({ id: n.id, label: n.label, note: n.note || '', group: full.groups[n.groupIndex].id, pending: !!n.pending })),
    flows: full.flows.map((f) => ({ from: f.from, to: f.to, label: f.label || '', kind: f.kind, pending: isPending(f.label || '') })),
    kinds: Object.fromEntries(KINDS.map((k) => [k, { label: kindStyle(k).label, color: kindStyle(k).color }])),
    views,
  }
  // JSON 放进 <script type="application/json">：把 < 转义，标签里写了 </script> 也不会提前结束
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!DOCTYPE html>
<!-- ${GENERATED_MARK} ${VERSION} -->
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeXml(full.title)}（交互版）</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="title"><h1>${escapeXml(full.title)}</h1><span class="stats" id="stats"></span></div>
  <div class="tools">
    <div class="search"><input id="q" type="search" placeholder="搜节点（/）" autocomplete="off" aria-label="搜节点"><div id="hits" class="hits" hidden></div></div>
    <div class="kinds" id="kinds" role="group" aria-label="按流向类型筛选"></div>
    <div class="zoom"><button id="zin" title="放大（+）">＋</button><button id="zout" title="缩小（−）">－</button><button id="fit" title="适合窗口（0）">适合窗口</button></div>
  </div>
</header>
<nav class="tabs" id="tabs" role="tablist" aria-label="视图"></nav>
<main class="body">
  <section class="stage" id="stage" aria-label="图"><div class="note" id="vnote"></div><div class="canvas" id="canvas"></div><div class="tip" id="tip" hidden></div></section>
  <aside class="side" id="side" aria-label="详情"></aside>
</main>
<footer class="foot">由 AstroLab 信息流图 ${VERSION} 生成${full.source ? ` · 依据：${escapeXml(full.source)}` : ''} · 不联网，可以直接发给别人用浏览器打开</footer>
<script type="application/json" id="data">${json}</script>
<script>${JS}</script>
</body>
</html>
`
}

const CSS = `
:root { --ink:#0f172a; --ink2:#334155; --ink3:#64748b; --line:#e2e8f0; --bg:#f8fafc; --accent:#4f46e5; --accent-soft:#eef2ff; --warn:#b45309; --warn-soft:#fffbeb; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: grid; grid-template-rows: auto auto 1fr auto; font: 14px/1.5 "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; color: var(--ink); background: var(--bg); }
button, input { font: inherit; color: inherit; }
.top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 12px 18px 8px; background: #fff; }
.title { display: flex; align-items: baseline; gap: 12px; min-width: 0; flex: 1; }
.title h1 { margin: 0; font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats { color: var(--ink3); font-size: 12.5px; white-space: nowrap; }
.tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.search { position: relative; }
.search input { width: 200px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); outline: none; }
.search input:focus { border-color: var(--accent); background: #fff; }
.hits { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 280px; max-height: 320px; overflow: auto; padding: 4px; background: #fff; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(15,23,42,.14); }
.hits button { display: flex; flex-direction: column; width: 100%; padding: 6px 8px; border: 0; border-radius: 7px; background: transparent; text-align: left; cursor: pointer; }
.hits button:hover, .hits button.on { background: var(--accent-soft); }
.hits small { color: var(--ink3); }
.kinds { display: flex; gap: 6px; }
.kind { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; background: #fff; cursor: pointer; font-size: 12.5px; }
.kind i { width: 18px; height: 0; border-top: 2.5px solid currentColor; }
.kind.off { opacity: .4; text-decoration: line-through; }
.zoom { display: flex; gap: 4px; }
.zoom button, .side button.act { padding: 4px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; cursor: pointer; }
.zoom button:hover, .side button.act:hover { border-color: var(--accent); color: var(--accent); }
.tabs { display: flex; gap: 2px; padding: 0 14px; background: #fff; border-bottom: 1px solid var(--line); overflow-x: auto; }
.tabs button { flex: none; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ink3); cursor: pointer; white-space: nowrap; }
.tabs button.on { color: var(--ink); font-weight: 700; border-bottom-color: var(--accent); }
.tabs button:hover { color: var(--ink); }
.tabs .sep { width: 1px; margin: 8px 6px; background: var(--line); }
.body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; min-height: 0; }
.stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: repeating-linear-gradient(0deg, transparent 0 23px, rgba(148,163,184,.08) 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, rgba(148,163,184,.08) 23px 24px); }
.note { position: absolute; z-index: 2; left: 12px; bottom: 10px; padding: 3px 10px; border-radius: 8px; background: rgba(255,255,255,.9); color: var(--ink3); font-size: 12px; pointer-events: none; }
.canvas { position: absolute; inset: 0; cursor: grab; touch-action: none; }
.canvas.drag { cursor: grabbing; }
.canvas > svg { width: 100%; height: 100%; display: block; }
.canvas .err { padding: 60px 20px; text-align: center; color: var(--warn); }
.tip { position: absolute; z-index: 5; max-width: 340px; padding: 6px 10px; border-radius: 8px; background: var(--ink); color: #fff; font-size: 12.5px; pointer-events: none; }
svg .node { cursor: pointer; }
svg .node:hover rect:first-of-type { stroke-width: 2.4; }
svg .edge, svg .elabel { cursor: help; }
svg .node, svg .edge, svg .halo, svg .elabel { transition: opacity .15s ease-out; }
svg.dim .node:not(.hl) { opacity: .16; }
svg.dim .edge:not(.hl), svg.dim .halo:not(.hl), svg.dim .elabel:not(.hl) { opacity: .06; }
svg .node.sel > rect:first-of-type { stroke-width: 3.2; }
svg .edge.hl { stroke-width: 3; }
svg.hide-data [data-kind="data"], svg.hide-command [data-kind="command"], svg.hide-event [data-kind="event"] { display: none; }
.side { min-height: 0; overflow: auto; padding: 14px 16px 24px; background: #fff; border-left: 1px solid var(--line); }
.side h2 { margin: 0 0 4px; font-size: 16px; }
.side h3 { margin: 18px 0 6px; font-size: 12.5px; color: var(--ink3); font-weight: 600; }
.side .muted { color: var(--ink3); font-size: 12.5px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px; border-radius: 999px; font-size: 12px; background: var(--bg); }
.chip.warn { background: var(--warn-soft); color: var(--warn); }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.notebox { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--bg); font-size: 13px; white-space: pre-wrap; }
.flows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.flows li button { display: grid; grid-template-columns: 16px 1fr; gap: 2px 8px; width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; text-align: left; cursor: pointer; }
.flows li button:hover { border-color: var(--accent); }
.flows .arrow { grid-row: span 2; align-self: center; font-weight: 700; }
.flows .lbl { color: var(--ink3); font-size: 12px; }
.path { display: grid; gap: 8px; margin-top: 4px; }
.path select { width: 100%; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.pathlist { margin: 6px 0 0; padding-left: 20px; font-size: 13px; }
.pend li { margin: 3px 0; }
.pend button { border: 0; padding: 0; background: transparent; color: var(--warn); text-align: left; cursor: pointer; }
.pend button:hover { text-decoration: underline; }
.foot { padding: 6px 18px; font-size: 11.5px; color: var(--ink3); background: #fff; border-top: 1px solid var(--line); }
@media (max-width: 900px) { .body { grid-template-columns: 1fr; grid-template-rows: 1fr 40%; } .side { border-left: 0; border-top: 1px solid var(--line); } }
@media print { .top .tools, .tabs, .side, .foot, .note { display: none; } .body { display: block; } .stage { position: static; overflow: visible; background: none; } .canvas { position: static; } }
`

const JS = `
(() => {
  const D = JSON.parse(document.getElementById('data').textContent)
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const nodeById = new Map(D.nodes.map((n) => [n.id, n]))
  const groupById = new Map(D.groups.map((g) => [g.id, g]))
  const nameOf = (id) => id.startsWith('G:') ? (groupById.get(id.slice(2)) || {}).label || id : (nodeById.get(id) || {}).label || id
  const kindLabel = (k) => (D.kinds[k] || {}).label || k
  const S = { view: null, sel: null, path: null, off: new Set(), vb: null, size: null }

  // ---------- 顶部 ----------
  const pend = D.nodes.filter((n) => n.pending).length + D.flows.filter((f) => f.pending).length
  $('stats').textContent = D.groups.length + ' 个分组 · ' + D.nodes.length + ' 个节点 · ' + D.flows.length + ' 条流向' + (pend ? ' · 待确认 ' + pend + ' 处' : '')
  for (const k of Object.keys(D.kinds)) {
    if (!D.flows.some((f) => f.kind === k)) continue
    const b = document.createElement('button')
    b.className = 'kind'; b.type = 'button'; b.style.color = D.kinds[k].color
    b.innerHTML = '<i></i><span style="color:#334155">' + esc(D.kinds[k].label) + '</span>'
    b.title = '点一下隐藏 / 显示' + D.kinds[k].label
    b.onclick = () => { S.off.has(k) ? S.off.delete(k) : S.off.add(k); b.classList.toggle('off', S.off.has(k)); paint() }
    $('kinds').appendChild(b)
  }
  const tabs = $('tabs')
  D.views.forEach((v, i) => {
    if (i > 0 && (v.key.startsWith('group:') && !D.views[i - 1].key.startsWith('group:') || v.key === 'matrix')) { const s = document.createElement('span'); s.className = 'sep'; tabs.appendChild(s) }
    const b = document.createElement('button')
    b.type = 'button'; b.role = 'tab'; b.textContent = v.label; b.dataset.key = v.key
    b.title = v.note || ''
    b.onclick = () => show(v.key)
    tabs.appendChild(b)
  })

  // ---------- 视图、平移缩放 ----------
  const canvas = $('canvas')
  let svg = null
  function show(key, keep) {
    const v = D.views.find((x) => x.key === key) || D.views[0]
    S.view = v
    for (const b of tabs.querySelectorAll('button')) { b.classList.toggle('on', b.dataset.key === v.key); b.setAttribute('aria-selected', b.dataset.key === v.key) }
    $('vnote').textContent = v.note || ''
    canvas.innerHTML = v.error ? '<div class="err">这个视图没有生成：' + esc(v.error) + '</div>' : v.svg
    svg = canvas.querySelector('svg')
    if (svg) {
      const [x, y, w, h] = svg.getAttribute('viewBox').split(/\\s+/).map(Number)
      S.size = { x, y, w, h }
      svg.removeAttribute('width'); svg.removeAttribute('height')
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      fit()
    }
    paint()
    if (!keep) renderSide()
    try { history.replaceState(null, '', '#' + encodeURIComponent(v.key)) } catch (e) { /* 本地文件也能用 */ }
  }
  function setVb(vb) { S.vb = vb; if (svg) svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h) }
  function fit() { if (S.size) setVb({ ...S.size }) }
  function zoom(f, cx, cy) {
    if (!S.vb) return
    const r = canvas.getBoundingClientRect()
    const scale = Math.max(S.vb.w / r.width, S.vb.h / r.height)
    const ox = (r.width - S.vb.w / scale) / 2, oy = (r.height - S.vb.h / scale) / 2
    const px = cx === undefined ? S.vb.x + S.vb.w / 2 : S.vb.x + (cx - r.left - ox) * scale
    const py = cy === undefined ? S.vb.y + S.vb.h / 2 : S.vb.y + (cy - r.top - oy) * scale
    const w = Math.min(S.size.w * 4, Math.max(S.size.w / 20, S.vb.w / f)), h = S.vb.h * (w / S.vb.w)
    setVb({ x: px - (px - S.vb.x) * (w / S.vb.w), y: py - (py - S.vb.y) * (h / S.vb.h), w, h })
  }
  function centerOn(el) {
    if (!el || !S.vb) return
    const b = el.getBBox()
    const w = Math.min(S.size.w, Math.max(b.width * 5, S.size.w / 3)), h = S.vb.h * (w / S.vb.w)
    setVb({ x: b.x + b.width / 2 - w / 2, y: b.y + b.height / 2 - h / 2, w, h })
  }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY) }, { passive: false })
  let drag = null
  canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0 || !S.vb) return; drag = { x: e.clientX, y: e.clientY, vb: { ...S.vb }, moved: false }; canvas.setPointerCapture(e.pointerId) })
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const r = canvas.getBoundingClientRect(), scale = Math.max(drag.vb.w / r.width, drag.vb.h / r.height)
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; canvas.classList.add('drag') }
      if (drag.moved) setVb({ ...drag.vb, x: drag.vb.x - dx * scale, y: drag.vb.y - dy * scale })
      return
    }
    tip(e)
  })
  canvas.addEventListener('pointerup', (e) => {
    const was = drag; drag = null; canvas.classList.remove('drag')
    if (!was || was.moved) return
    const t = document.elementFromPoint(e.clientX, e.clientY)
    const n = t && t.closest('.node')
    if (n) select(n.dataset.id); else select(null)
  })
  canvas.addEventListener('pointerleave', () => { $('tip').hidden = true })
  $('zin').onclick = () => zoom(1.3); $('zout').onclick = () => zoom(1 / 1.3); $('fit').onclick = fit
  function tip(e) {
    const t = e.target.closest && e.target.closest('[data-e]')
    const el = $('tip')
    if (!t || !S.view.edges.length) { el.hidden = true; return }
    const f = S.view.edges[+t.dataset.e]
    if (!f) { el.hidden = true; return }
    const r = canvas.getBoundingClientRect()
    el.innerHTML = esc(nameOf(f.from)) + (f.both ? ' ⇄ ' : ' → ') + esc(nameOf(f.to)) + (f.label ? '：' + esc(f.label) : '') + '<br><span style="opacity:.7">' + esc(kindLabel(f.kind)) + (f.weight > 1 ? '，合并了 ' + f.weight + ' 条' : '') + '</span>'
    el.hidden = false
    el.style.left = Math.min(r.width - 350, e.clientX - r.left + 14) + 'px'
    el.style.top = (e.clientY - r.top + 14) + 'px'
  }

  // ---------- 选中和高亮 ----------
  // 当前视图里怎么找“选中的东西”：总图里节点换成它的分组
  const inView = (id) => {
    if (!id || !svg) return null
    if (svg.querySelector('.node[data-id="' + CSS.escape(id) + '"]')) return id
    const n = nodeById.get(id)
    if (n && svg.querySelector('.node[data-id="' + CSS.escape('G:' + n.group) + '"]')) return 'G:' + n.group
    return null
  }
  function paint() {
    if (!svg) return
    for (const k of Object.keys(D.kinds)) svg.classList.toggle('hide-' + k, S.off.has(k))
    for (const el of svg.querySelectorAll('.hl, .sel')) el.classList.remove('hl', 'sel')
    let any = false
    if (S.path && S.view.key === 'full') {
      any = true
      const pairs = new Set(S.path.slice(1).map((id, i) => S.path[i] + '>' + id))
      S.view.edges.forEach((f, i) => { if (pairs.has(f.from + '>' + f.to)) mark(i) })
      for (const id of S.path) markNode(id)
    } else if (S.sel) {
      const id = inView(S.sel)
      if (id) {
        any = true
        markNode(id, true)
        S.view.edges.forEach((f, i) => { if (f.from === id || f.to === id) { mark(i); markNode(f.from === id ? f.to : f.from) } })
      }
    }
    svg.classList.toggle('dim', any)
  }
  function mark(i) { for (const el of svg.querySelectorAll('[data-e="' + i + '"]')) el.classList.add('hl') }
  function markNode(id, sel) { const n = svg.querySelector('.node[data-id="' + CSS.escape(id) + '"]'); if (n) { n.classList.add('hl'); if (sel) n.classList.add('sel') } }
  function select(id, center) {
    S.sel = id; S.path = null
    if (id && !inView(id) && S.view.key !== 'full') show('full', true)
    paint(); renderSide()
    if (id && center) { const v = inView(id); centerOn(v && svg && svg.querySelector('.node[data-id="' + CSS.escape(v) + '"]')) }
  }

  // ---------- 右边 ----------
  const side = $('side')
  function flowItem(f, dir) {
    const peer = dir === 'in' ? f.from : f.to
    const color = (D.kinds[f.kind] || {}).color || '#64748b'
    return '<li><button type="button" data-go="' + esc(peer) + '"><span class="arrow" style="color:' + color + '">' + (dir === 'in' ? '←' : '→') + '</span><span>' + esc(nameOf(peer)) + '</span><span class="lbl">' + esc(f.label || '（无标签）') + ' · ' + esc(kindLabel(f.kind)) + (f.pending ? ' · <b style="color:#b45309">待确认</b>' : '') + '</span></button></li>'
  }
  function renderSide() {
    let h = ''
    if (S.sel && S.sel.startsWith('G:')) {
      const g = groupById.get(S.sel.slice(2))
      const ids = new Set(g ? g.nodes : [])
      const outs = D.flows.filter((f) => ids.has(f.from) && !ids.has(f.to)), ins = D.flows.filter((f) => ids.has(f.to) && !ids.has(f.from))
      h += '<h2>' + esc(g ? g.label : S.sel) + '</h2><span class="chip"><span class="dot" style="background:' + (g && g.color) + '"></span>分组 · ' + ids.size + ' 个节点</span>'
      h += '<h3>节点</h3><ul class="flows">' + [...ids].map((id) => '<li><button type="button" data-go="' + esc(id) + '"><span class="arrow">·</span><span>' + esc(nameOf(id)) + '</span><span class="lbl">' + esc((nodeById.get(id) || {}).note || '') + '</span></button></li>').join('') + '</ul>'
      h += '<h3>流入 ' + ins.length + ' 条</h3><ul class="flows">' + ins.map((f) => flowItem(f, 'in')).join('') + '</ul>'
      h += '<h3>流出 ' + outs.length + ' 条</h3><ul class="flows">' + outs.map((f) => flowItem(f, 'out')).join('') + '</ul>'
    } else if (S.sel) {
      const n = nodeById.get(S.sel), g = n && groupById.get(n.group)
      const ins = D.flows.filter((f) => f.to === S.sel), outs = D.flows.filter((f) => f.from === S.sel)
      h += '<h2>' + esc(n ? n.label : S.sel) + '</h2>'
      h += '<span class="chip"><span class="dot" style="background:' + (g && g.color) + '"></span>' + esc(g ? g.label : '') + '</span>' + (n && n.pending ? ' <span class="chip warn">待确认</span>' : '')
      if (n && n.note) h += '<div class="notebox">' + esc(n.note) + '</div>'
      h += '<h3>流入 ' + ins.length + ' 条</h3>' + (ins.length ? '<ul class="flows">' + ins.map((f) => flowItem(f, 'in')).join('') + '</ul>' : '<div class="muted">没有输入</div>')
      h += '<h3>流出 ' + outs.length + ' 条</h3>' + (outs.length ? '<ul class="flows">' + outs.map((f) => flowItem(f, 'out')).join('') + '</ul>' : '<div class="muted">没有输出</div>')
      h += '<p style="margin-top:14px"><button class="act" type="button" data-from="' + esc(S.sel) + '">从这里找路径…</button> <button class="act" type="button" data-clear>取消选中（Esc）</button></p>'
    } else {
      h += '<h2>怎么看</h2><div class="muted">点方块高亮它的上下游，右边列出流入和流出；拖动平移，滚轮缩放，“0”适合窗口；搜节点按“/”。</div>'
    }
    // 找路径
    const opts = (sel) => '<option value="">选节点</option>' + D.groups.map((g) => '<optgroup label="' + esc(g.label) + '">' + g.nodes.map((id) => '<option value="' + esc(id) + '"' + (id === sel ? ' selected' : '') + '>' + esc(nameOf(id)) + '</option>').join('') + '</optgroup>').join('')
    h += '<h3>找路径（起点到终点的最短流向链）</h3><div class="path"><select id="pfrom" aria-label="起点">' + opts(S.pfrom) + '</select><select id="pto" aria-label="终点">' + opts(S.pto) + '</select><button class="act" type="button" id="pgo">在全图上高亮</button></div><div id="pres">' + (S.pres || '') + '</div>'
    // 待确认
    const pn = D.nodes.filter((n) => n.pending), pf = D.flows.filter((f) => f.pending)
    if (pn.length || pf.length) {
      h += '<h3>待确认 ' + (pn.length + pf.length) + ' 处</h3><ul class="pend">'
      h += pn.map((n) => '<li><button type="button" data-go="' + esc(n.id) + '">' + esc(n.label) + '</button><div class="muted">' + esc(n.note) + '</div></li>').join('')
      h += pf.map((f) => '<li><button type="button" data-go="' + esc(f.from) + '">' + esc(nameOf(f.from)) + ' → ' + esc(nameOf(f.to)) + '</button><div class="muted">' + esc(f.label) + '</div></li>').join('')
      h += '</ul>'
    }
    side.innerHTML = h
  }
  side.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'); if (go) { select(go.dataset.go, true); return }
    if (e.target.closest('[data-clear]')) { select(null); return }
    const fr = e.target.closest('[data-from]'); if (fr) { S.pfrom = fr.dataset.from; renderSide(); const t = $('pto'); t && t.focus(); return }
    if (e.target.id === 'pgo') findPath()
  })
  side.addEventListener('change', (e) => { if (e.target.id === 'pfrom') S.pfrom = e.target.value; if (e.target.id === 'pto') S.pto = e.target.value })
  function findPath() {
    const a = S.pfrom, b = S.pto
    if (!a || !b) { S.pres = '<div class="muted">先选起点和终点</div>'; renderSide(); return }
    const next = new Map(); for (const f of D.flows) { if (!next.has(f.from)) next.set(f.from, []); next.get(f.from).push(f.to) }
    const prev = new Map([[a, null]]); const q = [a]
    while (q.length) { const x = q.shift(); if (x === b) break; for (const y of next.get(x) || []) if (!prev.has(y)) { prev.set(y, x); q.push(y) } }
    if (!prev.has(b)) { S.path = null; S.pres = '<div class="muted">没有从“' + esc(nameOf(a)) + '”到“' + esc(nameOf(b)) + '”的流向路径</div>'; S.sel = null; paint(); renderSide(); return }
    const path = []; for (let x = b; x !== null; x = prev.get(x)) path.unshift(x)
    S.sel = null; S.path = path
    S.pres = '<ol class="pathlist">' + path.map((id) => '<li>' + esc(nameOf(id)) + '</li>').join('') + '</ol><div class="muted">' + (path.length - 1) + ' 步；其他线已淡化，点空白处恢复</div>'
    if (S.view.key !== 'full') show('full', true)
    paint(); renderSide()
  }

  // ---------- 搜索、键盘 ----------
  const qi = $('q'), hits = $('hits')
  let hitSel = 0
  qi.addEventListener('input', () => {
    const k = qi.value.trim().toLowerCase()
    if (!k) { hits.hidden = true; return }
    const list = D.nodes.filter((n) => (n.label + ' ' + n.note + ' ' + n.id).toLowerCase().includes(k)).slice(0, 12)
    hitSel = 0
    hits.innerHTML = list.length ? list.map((n, i) => '<button type="button" data-go="' + esc(n.id) + '"' + (i === 0 ? ' class="on"' : '') + '><span>' + esc(n.label) + '</span><small>' + esc(groupById.get(n.group).label) + (n.note ? ' · ' + esc(n.note.slice(0, 40)) : '') + '</small></button>').join('') : '<div class="muted" style="padding:6px 8px">没有找到</div>'
    hits.hidden = false
  })
  qi.addEventListener('keydown', (e) => {
    const bs = [...hits.querySelectorAll('button')]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hitSel = (hitSel + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % Math.max(1, bs.length); bs.forEach((b, i) => b.classList.toggle('on', i === hitSel)) }
    if (e.key === 'Enter' && bs[hitSel]) { e.preventDefault(); bs[hitSel].click() }
    if (e.key === 'Escape') { qi.value = ''; hits.hidden = true; qi.blur() }
  })
  hits.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { hits.hidden = true; qi.value = ''; select(b.dataset.go, true) } })
  document.addEventListener('keydown', (e) => {
    if (e.target === qi || e.target.tagName === 'SELECT') return
    if (e.key === '/') { e.preventDefault(); qi.focus() }
    else if (e.key === 'Escape') select(null)
    else if (e.key === '0') fit()
    else if (e.key === '+' || e.key === '=') zoom(1.3)
    else if (e.key === '-') zoom(1 / 1.3)
  })
  window.addEventListener('resize', () => { if (S.vb) setVb(S.vb) })

  const start = decodeURIComponent((location.hash || '').slice(1))
  show(D.views.some((v) => v.key === start) ? start : D.views.length > 1 && D.views[0].metrics && D.views[0].metrics.crossings > 25 && D.views[1].key === 'overview' ? 'overview' : D.views[0].key)
})()
`
