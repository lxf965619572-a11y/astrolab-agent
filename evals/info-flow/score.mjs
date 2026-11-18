#!/usr/bin/env node
// 信息流评测评分：对智能体在示例工程里生成的信息流模型、视图文件和任务记录做客观检查，
// 结果写到 evals/info-flow/results/<时间>-<用例>[-<标签>]/summary.md 和 summary.json（同时存一份产出副本）。
//   一 过程：选了技能、读了两份输入、先校验再出图、出 N² 矩阵、没生成 Word、没联网、没手改生成文件、没改输入、覆盖前问过；
//   二 产出：模型文件、校验无错误、全图/总图/链路图/N² 矩阵齐全、图和模型一致、全图可读性（按模型重算）；
//   三 模型：泳道、主链、存储方向、待确认标记（不擅自定值）、粒度、依据；
//   四 汇报：跨文件冲突、读写闭环、N² 无输入/无输出的解释（关键词判断，疑似项列出原文行，供人工复核）；
//   五 记录：模型、用时、步数、用量、提问，以及和技能示例模型的相似度（用例与示例同材料时偏乐观）。
// 用法：node evals/info-flow/score.mjs [用例名，默认 pcu] [--task <任务 id>] [--ws <示例工程目录>] [--model-file <模型文件>] [--label <标签>]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  HERE, ROOT, cell, checkChain, conflictInModel, conflictInText, dataDirOf, finalReport, infoflow, infoflowCommon, isInfoFlowTask,
  loadCase, matchNodes, pct, readSessionLog, readText, sampleTasks, sampleWorkspace, sha1, short, similarity, slash, storageLoops,
  summarizeLog, toolIs, walk,
} from './lib.mjs'

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const wsArg = opt('--ws')
const taskArg = opt('--task')
const modelArg = opt('--model-file')
const label = opt('--label')
const name = argv[0] || 'pcu'
const cs = await loadCase(name)
if (!cs) { console.error(`没有这个用例：${name}（evals/info-flow/${name}/case.mjs）`); process.exit(2) }
const sw = wsArg ? { dir: resolve(wsArg), from: '--ws' } : sampleWorkspace()
const ws = sw.dir
if (!existsSync(ws)) { console.error(`示例工程不存在：${ws}`); process.exit(2) }
const dataDir = dataDirOf(ws)
const { buildDiagram, normalize, validateInfoFlow, matrixData } = await infoflow()
const { GENERATED_MARK } = await infoflowCommon()

const prepFile = join(HERE, 'results', `prepared-${name}.json`)
let prep = existsSync(prepFile) ? JSON.parse(readFileSync(prepFile, 'utf8')) : null
if (prep && resolve(prep.ws) !== ws) prep = null // 准备的是别的工作区

// ---------- 任务 ----------
const tasks = sampleTasks(dataDir)
let task = taskArg ? tasks.find((t) => t.id === taskArg) : null
if (taskArg && !task) { console.error(`示例工程里没有任务 ${taskArg}`); process.exit(2) }
if (!task) {
  const cands = tasks.filter(isInfoFlowTask).filter((t) => !prep || (t.startedAt || 0) >= prep.at - 5000)
  task = cands[cands.length - 1] || null
}
const log = task ? readSessionLog(dataDir, task.sessionId || task.id) : null
const L = log ? summarizeLog(log.events) : { calls: [], texts: [], model: null, steps: 0 }
const since = prep ? prep.at : task?.startedAt ?? 0

// ---------- 这次新增、改动的文件 ----------
const now = walk(ws)
const changed = now.filter((f) => {
  if (prep) { const o = prep.files[f.rel]; return !o || o.size !== f.size || Math.abs(o.mtimeMs - f.mtimeMs) > 1 }
  return f.mtimeMs >= since - 2000
})
const inDiag = changed.filter((f) => f.rel.startsWith('diagrams/'))
let modelFile = modelArg ? resolve(modelArg) : null
if (!modelFile) {
  const m = changed.filter((f) => /\.flow\.json$/i.test(f.rel)).sort((a, b) => (a.rel.startsWith('diagrams/') ? 0 : 1) - (b.rel.startsWith('diagrams/') ? 0 : 1) || b.mtimeMs - a.mtimeMs)
  modelFile = m[0]?.abs || null
}
const rel = (p) => slash(relative(ws, p))

let spec = null
let specErr = ''
if (modelFile) { try { spec = JSON.parse(readText(modelFile)) } catch (e) { specErr = e.message } }
const check = spec ? validateInfoFlow(spec) : null
const model = check?.ok ? normalize(spec) : null
const base = modelFile ? basename(modelFile).replace(/\.flow\.json$/i, '') : null
const mdir = modelFile ? dirname(modelFile) : null
const fileOf = (suffix, ext) => (mdir ? join(mdir, `${base}${suffix}.${ext}`) : null)

// 汇报：最后一次出图之后的助手文字 + diagrams 里这次新写的说明（不带生成标记的 .md）
const notesMd = inDiag.filter((f) => /\.md$/i.test(f.rel) && !readText(f.abs).includes(GENERATED_MARK))
const reportText = [log ? finalReport(L) : '', ...notesMd.map((f) => readText(f.abs))].join('\n\n')
const allText = [L.texts.map((x) => x.text).join('\n\n'), ...notesMd.map((f) => readText(f.abs))].join('\n\n')

// ---------- 检查项 ----------
const C = [] // { sec, id, name, ok: true|false|null, detail, kind: 'must'|'bonus' }
const add = (sec, id, nm, ok, detail = '', kind = 'must') => C.push({ sec, id, name: nm, ok, detail, kind })
const noLog = log ? null : '没有任务记录'

// 一 过程
const S1 = '一 过程（任务记录）'
const argsText = (c) => c.raw || ''
const usedSkill = task && ((task.skills || []).includes('info-flow') || L.calls.some((c) => c.name === 'skill' && /info-flow/.test(argsText(c))))
add(S1, 'P1', '用了信息流梳理技能', task ? !!usedSkill : null, task ? `任务选的技能：${(task.skills || []).join('、') || '无'}` : noLog)
for (const inp of cs.inputs) {
  const fn = inp.split('/').pop()
  const reads = L.calls.filter((c) => argsText(c).includes(fn) && /docreader|read|pwsh|bash|shell|grep/.test(c.name))
  add(S1, 'P2', `读了 ${fn}`, log ? reads.length > 0 : null, log ? (reads.length ? `${reads.map((c) => c.name).join('、')}` : '没有读取它的工具调用') : noLog)
}
const vIdx = L.calls.findIndex((c) => toolIs(c, 'validate_info_flow'))
const rIdx = L.calls.findIndex((c) => toolIs(c, 'render_info_flow'))
add(S1, 'P3', '出图前先调 validate_info_flow 校验', log ? vIdx >= 0 && (rIdx < 0 || vIdx < rIdx) : null, log ? (vIdx < 0 ? '没有调用' : rIdx >= 0 && vIdx > rIdx ? '校验在出图之后' : '') : noLog)
const renders = L.calls.filter((c) => toolIs(c, 'render_info_flow'))
add(S1, 'P4', '用 render_info_flow 出图', log ? renders.length > 0 : null, log ? `${renders.length} 次：${renders.map((c) => c.args?.view || 'full').join('、')}` : noLog)
const matrixCalls = L.calls.filter((c) => toolIs(c, 'render_info_flow_matrix'))
const suggested = renders.some((c) => c.args?.view === 'suggested')
add(S1, 'P5', '出 N² 接口矩阵（render_info_flow_matrix 或 view=suggested）', log ? matrixCalls.length > 0 || suggested : null, log ? (matrixCalls.length ? `调用 ${matrixCalls.length} 次` : suggested ? 'suggested 一并生成' : '没有') : noLog)
const later = renders.slice(1)
add(S1, 'P6', '第一次之后换视图用 specFile', log ? (later.length ? later.every((c) => c.args?.specFile) : null) : null, later.length ? later.filter((c) => !c.args?.specFile).length ? '有重新给整份规格的出图' : '' : '只出过一次图（不适用）')
const docgen = L.calls.filter((c) => /docgen__render_docx|docgen__export/.test(c.name))
const newDocx = changed.filter((f) => /\.docx?$/i.test(f.rel) && !cs.inputs.includes(f.rel))
add(S1, 'P7', '没有生成 Word', docgen.length === 0 && newDocx.length === 0, [docgen.length ? `调了 ${docgen.map((c) => c.name).join('、')}` : '', newDocx.map((f) => f.rel).join('、')].filter(Boolean).join('；'))
const net = L.calls.filter((c) => /pwsh|bash|shell|powershell|cmd/.test(c.name) && /curl|wget|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b|https?:\/\//i.test(argsText(c)))
add(S1, 'P8', '没有联网', log ? net.length === 0 : null, net.map((c) => short(argsText(c), 60)).join('；') || (log ? '' : noLog))
const asks = L.calls.filter((c) => toolIs(c, 'ask_user_question'))
const ow = L.calls.filter((c) => c.args?.overwrite === true)
const owBad = ow.filter((c) => !asks.some((a) => a.seq < c.seq))
add(S1, 'P9', '覆盖模型（overwrite: true）之前问过用户', log ? (ow.length ? owBad.length === 0 : null) : null, ow.length ? `${ow.length} 次覆盖${owBad.length ? `，${owBad.length} 次之前没有提问` : ''}` : '没有覆盖（不适用）')
const handEdits = L.calls.filter((c) => /(^|__)(write|edit|multi_edit|apply_patch|write_file|edit_file)$/.test(c.name)).filter((c) => {
  const p = c.args?.file_path || c.args?.path || ''
  if (!p) return false
  const abs = resolve(ws, p)
  return /\.svg$/i.test(p) || (/\.(md|html)$/i.test(p) && readText(abs).includes(GENERATED_MARK)) || (base && slash(p).endsWith(`${base}.html`))
})
add(S1, 'P10', '没有手改生成的 .md / .svg / 交互版', log ? handEdits.length === 0 : null, handEdits.map((c) => `${c.name} ${c.args?.file_path || c.args?.path}`).join('；') || (log ? '' : noLog))
const seedChanged = cs.inputs.filter((r) => sha1(join(ws, r)) !== sha1(join(ROOT, cs.seedDir, r.split('/').pop())))
add(S1, 'P11', '没有改输入文件', seedChanged.length === 0, seedChanged.join('、'))

const peekAnswer = L.calls.filter((c) => cs.answerFiles.some((re) => re.test(argsText(c))))
const peekExample = L.calls.filter((c) => cs.contamination.files.some((re) => re.test(argsText(c))))

// 二 产出文件
const S2 = '二 产出文件'
add(S2, 'F1', '有模型文件 <名称>.flow.json', !!spec, modelFile ? rel(modelFile) + (specErr ? `（不是合法 JSON：${specErr}）` : '') : '这次没有新的 .flow.json')
add(S2, 'F2', '模型校验没有错误', check ? check.ok : false, check ? (check.ok ? `分组 ${check.stats.groups}、节点 ${check.stats.nodes}、流向 ${check.stats.flows}；提醒 ${check.warnings.length} 条` : check.errors.join('；')) : '')
const views = [
  ['F3', '全图', fileOf('', 'md'), fileOf('', 'svg'), { view: 'full' }],
  ['F4', '总图', fileOf('-总图', 'md'), fileOf('-总图', 'svg'), { view: 'overview' }],
  ['F6', 'N² 接口矩阵', fileOf('-N2', 'md'), fileOf('-N2', 'svg'), null],
]
for (const [id, nm, md, svg] of views) add(S2, id, `有${nm}（.md + .svg）`, !!(md && existsSync(md) && existsSync(svg)), md ? rel(md) : '')
const chainFiles = mdir ? walk(mdir).filter((f) => f.rel.startsWith(`${base}-链路-`) && f.rel.endsWith('.svg')) : []
const wantChain = chainFiles.filter((f) => cs.chainView.from.test(f.rel.split('-到-')[0] || '') && cs.chainView.to.test(f.rel.split('-到-')[1] || ''))
add(S2, 'F5', '有“间接指令 → 负载继电器”的链路图', wantChain.length > 0, chainFiles.length ? chainFiles.map((f) => f.rel).join('、') : '没有链路图')
const html = fileOf('', 'html')
add(S2, 'F7', '有交互版 .html', !!(html && existsSync(html)), html ? rel(html) : '', 'bonus')
const stale = []
if (model) for (const [, nm, , svg, opts] of views) {
  if (!opts || !svg || !existsSync(svg)) continue
  try { if (buildDiagram(spec, opts).svg.replace(/\r\n/g, '\n') !== readText(svg)) stale.push(nm) } catch (e) { stale.push(`${nm}（${e.message}）`) }
}
add(S2, 'F8', '图和模型一致（按模型重新生成，SVG 完全相同）', model ? stale.length === 0 : null, stale.length ? `不一致：${stale.join('、')}（手改过，或改了模型没重出图，或出图用了别的 order）` : '')
let fullMetrics = null
if (model) { try { const r = buildDiagram(spec, { view: 'full' }); fullMetrics = { ...r.metrics, readable: r.readable } } catch { /* 校验已报 */ } }
// 模型写得细（流向多）交叉自然多，所以“清晰”用工具的判定；固定的交叉上限只作加分
const fm = fullMetrics ? `交叉 ${fullMetrics.crossings}，穿过节点 ${fullMetrics.edgesThroughNodes}，重叠标签 ${fullMetrics.labelOverlaps}；工具判定${fullMetrics.readable.ok ? '清晰' : `偏密：${fullMetrics.readable.reasons.join('；')}`}` : ''
add(S2, 'F9', '全图清晰、没有线穿过节点（按模型重算；偏密时应改出总图/分图/链路图）',
  fullMetrics ? (fullMetrics.readable.ok ? fullMetrics.edgesThroughNodes <= cs.fullView.maxThrough : stale.length === 0 && existsSync(fileOf('-总图', 'svg') || '')) : null,
  fullMetrics ? `${fm}${fullMetrics.readable.ok ? '' : '（偏密，有总图就算通过）'}` : '')
add(S2, 'F10', `全图交叉不超过 ${cs.fullView.maxCrossings} 处`, fullMetrics ? fullMetrics.crossings <= cs.fullView.maxCrossings : null, fullMetrics ? `交叉 ${fullMetrics.crossings}，流向 ${model.flows.length}` : '', 'bonus')

// 三 模型内容
const S3 = '三 模型内容'
const na = model ? null : '没有可用的模型'
if (model) {
  const gl = model.groups.map((g) => g.label)
  const miss = cs.groups.filter((g) => !gl.some((l) => g.re.test(l)))
  add(S3, 'M1', `泳道齐全（${cs.groups.map((g) => g.name).join('、')}）`, miss.length === 0, miss.length ? `没对上：${miss.map((g) => g.name).join('、')}；模型的分组：${gl.join('、')}` : gl.join('、'))
  for (const ch of cs.chains) {
    const r = checkChain(model, cs, ch)
    const bad = r.segments.filter((s) => !s.ok).map((s) => `${s.from} → ${s.to}${s.missing === 'to' ? `（没有“${s.to}”类节点）` : s.missing === 'from' ? '（前一段没走通）' : `（${cs.maxHops} 步内没有通路）`}`)
    add(S3, 'M2', `主链：${ch.name}`, r.ok, bad.length ? bad.join('；') : r.matched.map(([k, v]) => `${k}=${v.slice(0, 3).join('/')}`).join('，'))
  }
  const mram = matchNodes(model, cs.nodes[cs.storage.paramToMram.to])
  const eep = matchNodes(model, cs.nodes[cs.storage.noInto])
  const ids = (a) => new Set(a.map((n) => n.id))
  const lab = (id) => model.nodeMap.get(id)?.label
  const toMram = model.flows.filter((f) => ids(mram).has(f.to) && cs.storage.paramToMram.re.test(`${f.label} ${lab(f.from)}`))
  add(S3, 'M3', '运行参数写入 MRAM（任务书 7）', toMram.length > 0, toMram.map((f) => `${lab(f.from)} → ${lab(f.to)}：${f.label}`).join('；') || (mram.length ? '有 MRAM，但没有参数写入的流向' : '没有 MRAM 节点'))
  const intoE = model.flows.filter((f) => ids(eep).has(f.to))
  add(S3, 'M4', 'EEPROM 没有流入（只读、只出默认参数）', eep.length ? intoE.length === 0 : null, intoE.map((f) => `${lab(f.from)} → ${lab(f.to)}：${f.label}`).join('；') || (eep.length ? '' : '没有 EEPROM 节点（不适用）'))
  const fromE = model.flows.filter((f) => ids(eep).has(f.from))
  add(S3, 'M5', 'EEPROM 提供默认参数', fromE.length > 0, fromE.map((f) => `${lab(f.from)} → ${lab(f.to)}：${f.label}`).join('；') || (eep.length ? '没有流出' : '没有 EEPROM 节点'))
  for (const c of cs.conflicts.filter((x) => x.inModel)) {
    const r = conflictInModel(model, c, cs.num)
    add(S3, 'M6', `待确认标出：${c.name}`, r.state === 'marked', r.state === 'marked' ? r.where.join('、') : r.state === 'picked' ? `**擅自定值**：${r.where.slice(0, 3).join('；')}` : '模型里没有提到')
  }
  const tw = model.nodes.filter((n) => cs.telemetryWords.test(n.label))
  add(S3, 'M7', 'ICD 遥测字没有逐个画成节点', tw.length <= cs.telemetryWordsMax, tw.length ? `像遥测字的节点 ${tw.length} 个：${tw.slice(0, 8).map((n) => n.label).join('、')}` : '')
  const [lo, hi] = cs.nodeRange
  add(S3, 'M8', `节点数在 ${lo}～${hi} 之间（按功能/接口合并）`, model.nodes.length >= lo && model.nodes.length <= hi, `${model.nodes.length} 个`)
  const refRe = /任务书|ICD|接口控制|表\s*\d|\d+\.\d+|性能要求|接口要求|可靠性|安全性|第\s*\d+\s*章/
  const withRef = model.nodes.filter((n) => refRe.test(n.note || '')).length
  add(S3, 'M9', '节点 note 写了依据章节（≥ 80%）', withRef / model.nodes.length >= 0.8, `${withRef}/${model.nodes.length}（${pct(withRef, model.nodes.length)}）`)
  const labeled = model.flows.filter((f) => f.label).length
  add(S3, 'M10', '流向有标签（≥ 90%）', labeled / Math.max(1, model.flows.length) >= 0.9, `${labeled}/${model.flows.length}`)
  const kinds = [...new Set(model.flows.map((f) => f.kind))]
  add(S3, 'M11', '流向区分了数据流和控制流', kinds.includes('data') && kinds.includes('command'), kinds.join('、'))
  add(S3, 'M12', '时间同步广播画成事件流（event）', model.flows.some((f) => f.kind === 'event'), '', 'bonus')
  add(S3, 'M13', '模型有依据（source）', !!(model.source && /任务书|ICD|接口控制/.test(model.source)), short(model.source, 80))
} else add(S3, 'M0', '模型内容', false, na)

// 四 汇报
const S4 = '四 汇报（关键词判断，需人工复核）'
const hasReport = reportText.trim().length > 0
for (const c of cs.conflicts) {
  const r = conflictInText(reportText, c, cs.num)
  const rAll = r.found ? r : conflictInText(allText, c, cs.num)
  add(S4, 'R1', `提出：${c.name}`, hasReport ? r.found : null,
    r.found ? `${r.twoSources ? '带两处出处' : '**没写两处出处**'}：${short(r.lines[0], 90)}` : rAll.found ? `只在过程中提到：${short(rAll.lines[0], 90)}` : hasReport ? '没有找到' : '没有汇报文字')
}
if (model) {
  const stores = new Set([...matchNodes(model, cs.nodes.mram), ...matchNodes(model, cs.nodes.eeprom)].map((n) => n.id))
  const loops = storageLoops(model, stores)
  const loopNames = loops.map(([a, s]) => `${model.nodeMap.get(a).label} ↔ ${model.nodeMap.get(s).label}`)
  const explained = loops.length && /(MRAM|存储)[^。\n]{0,60}(闭环|环|读写|回读|读回|历史)|(闭环|环|读写)[^。\n]{0,60}(MRAM|存储)/.test(reportText)
  add(S4, 'R2', '读写闭环解释为正常读写（不是改箭头消掉）', loops.length && hasReport ? !!explained : null, !hasReport ? '没有汇报文字' : loops.length ? `${loopNames.join('；')}${explained ? '' : '：汇报里没有解释'}` : '模型里没有经过存储的环（不适用）')
  const md = matrixData(model, 'node')
  const odd = [...md.noIn.map((n) => ['无输入', n]), ...md.noOut.map((n) => ['无输出', n]), ...md.isolated.map((n) => ['孤立', n])]
  const said = odd.filter(([, n]) => reportText.includes(n.label))
  const kw = /无输入|没有输入|无输出|没有输出|孤立|只有输出|只有输入|只输出|只输入|外部来源|终端/.test(reportText)
  add(S4, 'R3', 'N² 矩阵里无输入/无输出的节点逐个解释（≥ 80%）', odd.length && hasReport ? kw && said.length / odd.length >= 0.8 : null,
    odd.length ? `${said.length}/${odd.length} 个在汇报里提到${kw ? '' : '（汇报里没有“无输入/无输出”的说法）'}；没提到：${odd.filter((x) => !said.includes(x)).map(([k, n]) => `${n.label}（${k}）`).join('、') || '无'}` : '没有（不适用）')
}
add(S4, 'R4', '汇报给出了模型和视图文件的位置', hasReport ? /\.flow\.json|diagrams[\\/]/.test(reportText) : null, hasReport ? '' : '没有汇报文字')
for (const b of cs.bonus) {
  const r = conflictInText(reportText, b, cs.num)
  add(S4, b.id, `加分：${b.name}`, r.found, r.found ? short(r.lines[0], 90) : '', 'bonus')
}

// ---------- 汇总 ----------
const must = C.filter((c) => c.kind === 'must' && c.ok !== null)
const mustOk = must.filter((c) => c.ok).length
const bonus = C.filter((c) => c.kind === 'bonus')
const bonusOk = bonus.filter((c) => c.ok).length
let refModel = null
try { const rp = join(ROOT, cs.contamination.reference); if (existsSync(rp)) refModel = normalize(JSON.parse(readText(rp))) } catch { /* 示例模型读不了就不比 */ }
const sim = model && refModel ? similarity(model, refModel) : null
const simHigh = sim && sim.sameNodes / Math.max(1, sim.nodes) >= 0.7
const fmtMs = (ms) => (ms > 0 ? `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒` : '—')

const out = []
const o = (s = '') => out.push(s)
o(`# 信息流评测结果：${cs.title}${label ? `（${label}）` : ''}`)
o()
o(`- 时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`)
o(`- 示例工程：${ws}（${sw.from}）`)
o(`- 任务：${task ? `${task.id}（${task.status || '—'}）“${short(task.prompt, 60)}”` : '没有找到（用 --task <任务 id> 指定；任务记录在数据目录 projects/<示例工程>/tasks）'}`)
o(`- 模型：${L.model || '—'}；用时 ${fmtMs((task?.endedAt || 0) - (task?.startedAt || 0))}；步数 ${L.steps}；工具调用 ${L.calls.length}；提问 ${asks.length} 次`)
if (task?.usage) o(`- 用量：共 ${task.usage.used ?? '—'} token（输入 ${task.usage.input ?? '—'}、缓存命中 ${task.usage.cacheRead ?? '—'}、输出 ${task.usage.output ?? '—'}）`)
o(`- 模型文件：${modelFile ? rel(modelFile) : '—'}；评分依据的准备记录：${prep ? new Date(prep.at).toLocaleString('zh-CN', { hour12: false }) : '没有（按任务开始时间找新文件）'}`)
o()
if (peekAnswer.length) { o(`> **结果作废：读过答案文件**（${peekAnswer.map((c) => short(argsText(c), 60)).join('；')}）`); o() }
if (peekExample.length || simHigh) {
  o(`> **内容分偏乐观**：${peekExample.length ? '智能体读了技能示例 references/pcu-example.md，它和本用例是同一份材料' : ''}${peekExample.length && simHigh ? '；' : ''}${simHigh ? `模型和示例模型同名节点 ${sim.sameNodes}/${sim.nodes}` : ''}。这一项衡量“照着示例做对”，不衡量“从文档里梳理出来”。`)
  o()
}
o('## 汇总')
o()
o(`**客观项 ${mustOk}/${must.length}**（不适用的不计），加分 ${bonusOk}/${bonus.length}`)
o()
o('| 部分 | 通过 |'); o('|---|---|')
for (const s of [...new Set(C.map((c) => c.sec))]) {
  const xs = C.filter((c) => c.sec === s && c.kind === 'must' && c.ok !== null)
  o(`| ${s} | ${xs.filter((c) => c.ok).length}/${xs.length} |`)
}
if (sim) o(`| 和技能示例模型的相似度（参考） | 同名节点 ${sim.sameNodes}/${sim.nodes}（示例 ${sim.refNodes}），同名流向 ${sim.sameFlows}/${sim.flows}（示例 ${sim.refFlows}） |`)
o()
for (const s of [...new Set(C.map((c) => c.sec))]) {
  o(`## ${s}`)
  o()
  o('| 项 | 检查 | 结果 | 说明 |'); o('|---|---|---|---|')
  for (const c of C.filter((x) => x.sec === s)) o(`| ${c.id} | ${cell(c.name)} | ${c.ok === null ? '不适用' : c.ok ? '通过' : c.kind === 'bonus' ? '—' : '**不通过**'} | ${cell(c.detail)} |`)
  o()
}
if (check?.warnings?.length) { o('## 模型提醒（校验工具）'); o(); for (const w of check.warnings) o(`- ${w}`); o() }
if (asks.length) {
  o('## 智能体提的问题'); o()
  for (const a of asks) for (const q of a.args?.questions || [a.args]) o(`- ${short(q?.question || q?.prompt || JSON.stringify(q), 120)}`)
  o()
}
o('## 人工复核')
o()
o(`- 第四部分是关键词判断：逐条看“说明”里摘的原文，确认是真的提出了冲突、两处出处对得上；“没有找到”的再到任务记录里搜一遍。`)
o(`- 对照 \`evals/info-flow/${name}/答案表.md\` 第 3 节，看有没有编造的流向（文档里没有的）、方向画反的流向；这部分脚本判断不了。`)
o(`- 打开交互版或全图，看图是否能讲清楚主链。`)

const text = out.join('\n') + '\n'
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const resDir = join(HERE, 'results', `${stamp}-${name}${label ? `-${label.replace(/[\\/:*?"<>|\s]+/g, '_')}` : ''}`)
mkdirSync(resDir, { recursive: true })
writeFileSync(join(resDir, 'summary.md'), text, 'utf8')
writeFileSync(join(resDir, 'summary.json'), JSON.stringify({
  case: name, label, task: task?.id || null, model: L.model, durationMs: task ? (task.endedAt || 0) - (task.startedAt || 0) : null, steps: L.steps,
  toolCalls: L.calls.length, asks: asks.length, usage: task?.usage || null, modelFile: modelFile ? rel(modelFile) : null,
  score: { must: mustOk, mustTotal: must.length, bonus: bonusOk, bonusTotal: bonus.length }, void: peekAnswer.length > 0,
  optimistic: peekExample.length > 0 || !!simHigh, similarity: sim, fullMetrics, checks: C,
}, null, 1), 'utf8')
for (const f of inDiag) cpSync(f.abs, join(resDir, 'workspace', f.rel))
if (reportText.trim()) writeFileSync(join(resDir, '汇报.md'), reportText, 'utf8')
console.log(text)
console.log(`结果已保存：${resDir}`)
