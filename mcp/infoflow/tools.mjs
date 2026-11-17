// 四个工具的实现（不含 MCP 协议部分，selftest 可直接调用）。root 是工作区目录，默认 process.cwd()。

import { basename, join } from 'node:path'
import { buildDiagram, buildMatrix, checkModel, normalize, renderMarkdown, sizeReadable, suggestViews, validateInfoFlow } from './diagram.mjs'
import { resolveSpec, safeName, saveModel, workspace, writeGenerated } from './files.mjs'
import { renderHtml } from './html.mjs'

// 前缀已经以这个后缀结尾时不再加（比如 name 传成了“xx-总图”）
const join2 = (base, suffix) => (base.endsWith(suffix) ? base : `${base}${suffix}`)

function viewFileBase(base, model) {
  const v = model.view
  if (v.kind === 'overview') return join2(base, '-总图')
  if (v.kind === 'group') return join2(base, `-分图-${safeName(model.groups.find((g) => g.id === v.group)?.label || v.group)}`)
  if (v.kind === 'chain') {
    const name = (id) => safeName(model.nodeMap.get(id)?.label || id)
    const head = v.focus.map(name).join('、')
    const tail = v.to && v.to.length ? `-到-${v.to.map(name).join('、')}` : v.towards === 'up' ? '-上游' : v.towards === 'both' ? '-上下游' : '-下游'
    return safeName(join2(base, `-链路-${head}${tail}`), `${base}-链路`)
  }
  return base
}

function formatCheck(check) {
  const lines = [`信息流模型校验：${check.ok ? '通过' : '未通过'}`, `分组 ${check.stats.groups} 个，节点 ${check.stats.nodes} 个，流向 ${check.stats.flows} 条`]
  if (check.errors.length) lines.push('错误：', ...check.errors.map((e) => `- ${e}`))
  if (check.warnings.length) lines.push('提醒：', ...check.warnings.map((w) => `- ${w}`))
  if (check.suggestedViews && check.suggestedViews.length) lines.push('建议的视图（render_info_flow 的参数）：', ...check.suggestedViews.map((s) => `- ${describeView(s)}`))
  if (check.ok && !check.warnings.length) lines.push('没有发现结构问题。')
  return lines.join('\n')
}

function describeView(s) {
  const { why, ...args } = s
  return `${JSON.stringify(args)}：${why}`
}

export function validateTool(args = {}, root) {
  const ws = workspace(root)
  const r = resolveSpec(args, ws)
  const check = checkModel(r.spec)
  return {
    text: formatCheck(check),
    data: { ok: check.ok, errors: check.errors, warnings: check.warnings, stats: check.stats, suggestedViews: check.suggestedViews },
  }
}

function renderOne(r, viewOpts, ws, overwrite) {
  const res = buildDiagram(r.spec, viewOpts)
  const base = viewFileBase(r.base, res.model)
  const svgAbs = join(r.dir, `${base}.svg`)
  const mdAbs = join(r.dir, `${base}.md`)
  const md = renderMarkdown(res, { svgFile: basename(svgAbs), modelFile: basename(r.modelAbs) })
  const files = writeGenerated([{ abs: svgAbs, text: res.svg }, { abs: mdAbs, text: md }], overwrite, ws)
  return { res, files: { svg: files[0], markdown: files[1] } }
}

function renderMatrixOne(r, level, ws, overwrite) {
  const m = buildMatrix(r.spec, level)
  const base = join2(r.base, `-N2${level === 'group' ? '-分组' : ''}`)
  const svgAbs = join(r.dir, `${base}.svg`)
  const mdAbs = join(r.dir, `${base}.md`)
  const md = m.markdown({ svgFile: basename(svgAbs), modelFile: basename(r.modelAbs) })
  const files = writeGenerated([{ abs: svgAbs, text: m.svg }, { abs: mdAbs, text: md }], overwrite, ws)
  return { m, files: { svg: files[0], markdown: files[1] } }
}

function renderHtmlOne(r, ws, overwrite) {
  const abs = join(r.dir, `${r.base}.html`)
  const html = renderHtml(r.spec)
  const [file] = writeGenerated([{ abs, text: html }], overwrite, ws)
  return { file, bytes: Buffer.byteLength(html) }
}

function viewLine(res, files) {
  const mt = res.metrics
  const head = `${res.model.view.label}：${files.markdown}（图片 ${files.svg}）`
  const nums = `节点 ${res.stats.nodes}、流向 ${res.stats.flows}；交叉 ${mt.crossings} 处，穿过节点的线 ${mt.edgesThroughNodes} 条，重叠标签 ${mt.labelOverlaps} 个`
  const ok = res.readable.ok ? '清晰' : `偏密：${res.readable.reasons.join('；')}`
  const extra = res.model.view.omitted ? `；省略了 ${res.model.view.omitted} 对少量流向（见 N² 矩阵）` : ''
  return `- ${head}\n  ${nums}；${ok}${extra}`
}

export function renderTool(args = {}, root) {
  const ws = workspace(root)
  const r = resolveSpec(args, ws)
  const check = validateInfoFlow(r.spec)
  if (!check.ok) {
    const err = new Error(`图规格有错误，未生成文件：\n- ${check.errors.join('\n- ')}`)
    err.validation = check
    throw err
  }
  const model = saveModel(r, !!args.overwrite)
  const overwrite = !!args.overwrite
  const view = args.view || 'full'
  const lines = []
  const views = []
  if (model !== 'unchanged') lines.push(`模型文件：${ws.rel(r.modelAbs)}（${model === 'created' ? '新建' : '已更新'}）`)
  else lines.push(`模型文件：${ws.rel(r.modelAbs)}`)
  if (r.nameIgnored) lines.push('（用 specFile 出图时文件名跟模型走，没有用 name）')

  if (view === 'suggested') {
    // 一次出齐：全图（规模允许时）+ 建议的总图、分图、链路图 + N² 矩阵
    const full = normalize(r.spec)
    const list = sizeReadable(full).length ? [] : [{ view: 'full', why: '全图' }]
    list.push(...suggestViews(full))
    for (const s of list) {
      try {
        if (s.view === 'matrix') {
          const { m, files } = renderMatrixOne(r, 'node', ws, overwrite)
          views.push({ view: 'matrix', files, stats: m.stats })
          lines.push(`- N² 接口矩阵：${files.markdown}（图片 ${files.svg}）`)
        } else {
          const { why, ...opts } = s
          const { res, files } = renderOne(r, { ...opts, order: args.order }, ws, overwrite)
          views.push({ view: res.model.view, files, stats: res.stats, metrics: res.metrics, readable: res.readable })
          lines.push(viewLine(res, files))
        }
      } catch (e) {
        lines.push(`- ${describeView(s)} 失败：${e.message}`)
      }
    }
    if (sizeReadable(full).length) lines.push(`（整个模型 ${full.nodes.length} 个节点、${full.flows.length} 条流向，一张全图看不清，没有出静态全图；交互版里有全图，可以缩放、点选）`)
    // 一并出交互版：全部视图放进一个 HTML，浏览器里点方块高亮上下游、找路径
    try {
      const h = renderHtmlOne(r, ws, overwrite)
      views.push({ view: 'html', files: { html: h.file } })
      lines.push(`- 交互版：${h.file}（浏览器打开；点方块看上下游，搜节点，找两点之间的路径）`)
    } catch (e) { lines.push(`- 交互版失败：${e.message}`) }
  } else {
    const opts = { view, group: args.group, focus: args.focus, to: args.to, towards: args.towards, depth: args.depth, minWeight: args.minWeight, order: args.order }
    const { res, files } = renderOne(r, opts, ws, overwrite)
    views.push({ view: res.model.view, files, stats: res.stats, metrics: res.metrics, readable: res.readable })
    lines.push(viewLine(res, files))
    if (!res.readable.ok) {
      lines.push('这张图偏密，建议改看下面的视图（render_info_flow 的参数）：')
      for (const s of res.suggestedViews) lines.push(`- ${describeView(s)}`)
    }
  }
  if (check.warnings.length) lines.push('模型提醒：', ...check.warnings.map((w) => `- ${w}`))
  return {
    text: lines.join('\n'),
    data: {
      model: ws.rel(r.modelAbs),
      views: views.map((v) => ({ ...v, view: typeof v.view === 'string' ? v.view : v.view.kind, label: typeof v.view === 'string' ? 'N² 接口矩阵' : v.view.label })),
      warnings: check.warnings,
      modelStats: check.stats,
      suggestedViews: view === 'suggested' ? [] : (views[0] && views[0].readable && !views[0].readable.ok ? suggestViews(normalize(r.spec)) : []),
    },
  }
}

/** 交互版 HTML：全图、总图、分图、N² 矩阵放进一个文件，带点选高亮、搜索、筛选、找路径 */
export function htmlTool(args = {}, root) {
  const ws = workspace(root)
  const r = resolveSpec(args, ws)
  const check = validateInfoFlow(r.spec)
  if (!check.ok) throw new Error(`图规格有错误，未生成文件：\n- ${check.errors.join('\n- ')}`)
  const model = saveModel(r, !!args.overwrite)
  const h = renderHtmlOne(r, ws, !!args.overwrite)
  const full = normalize(r.spec)
  return {
    text: [
      `模型文件：${ws.rel(r.modelAbs)}${model === 'created' ? '（新建）' : model === 'updated' ? '（已更新）' : ''}`,
      `已生成交互版：${h.file}（${Math.round(h.bytes / 1024)} KB，不联网，浏览器直接打开）`,
      `里面有全图、${full.groups.length > 1 ? '总图、' : ''}${full.groups.length} 张分图和 N² 矩阵；点方块高亮上下游，搜节点，按类型筛选，选起点终点找路径`,
    ].join('\n'),
    data: { model: ws.rel(r.modelAbs), html: h.file, bytes: h.bytes },
  }
}

export function matrixTool(args = {}, root) {
  const ws = workspace(root)
  const r = resolveSpec(args, ws)
  const check = validateInfoFlow(r.spec)
  if (!check.ok) throw new Error(`图规格有错误，未生成文件：\n- ${check.errors.join('\n- ')}`)
  saveModel(r, !!args.overwrite)
  const level = args.level || 'node'
  const { m, files } = renderMatrixOne(r, level, ws, !!args.overwrite)
  const d = m.data
  const lines = [
    `已生成 N² 接口矩阵（${level === 'group' ? '分组之间' : '逐个节点'}）：${files.markdown}（图片 ${files.svg}）`,
    `${d.items.length} 行 × ${d.items.length} 列，有内容的格子 ${d.cells.size} 个`,
  ]
  if (d.noIn.length) lines.push(`没有输入：${d.noIn.map((x) => x.label).join('、')}`)
  if (d.noOut.length) lines.push(`没有输出：${d.noOut.map((x) => x.label).join('、')}`)
  if (d.isolated.length) lines.push(`孤立：${d.isolated.map((x) => x.label).join('、')}`)
  return {
    text: lines.join('\n'),
    data: {
      model: ws.rel(r.modelAbs),
      files,
      size: d.items.length,
      filledCells: d.cells.size,
      noInput: d.noIn.map((x) => x.label),
      noOutput: d.noOut.map((x) => x.label),
      isolated: d.isolated.map((x) => x.label),
    },
  }
}
