// 信息流评测公用函数：找示例工程和任务记录、读会话日志、分析信息流模型。
// 只用 Node 内置模块和仓库里的 mcp/infoflow（重算视图、指标和 N² 矩阵，和工具同一套代码）。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sampleWorkspace } from '../sample-ws.mjs'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')
export { sampleWorkspace }

export async function loadCase(name) {
  const f = join(HERE, name, 'case.mjs')
  if (!existsSync(f)) return null
  return (await import(pathToFileURL(f).href)).default
}

export const infoflow = () => import(pathToFileURL(join(ROOT, 'mcp', 'infoflow', 'diagram.mjs')).href)
export const infoflowCommon = () => import(pathToFileURL(join(ROOT, 'mcp', 'infoflow', 'common.mjs')).href)

export const sha1 = (p) => (existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex') : null)
export const readText = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n') : '')
export const slash = (p) => String(p).replace(/\\/g, '/')

const SKIP_DIRS = new Set(['.git', 'node_modules', '.utest', '.cppcheck', '.astrolab'])
/** 递归列文件：[{ abs, rel, size, mtimeMs }] */
export function walk(root, dir = root, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue
    const p = join(dir, n)
    let s
    try { s = statSync(p) } catch { continue }
    if (s.isDirectory()) walk(root, p, out)
    else out.push({ abs: p, rel: slash(relative(root, p)), size: s.size, mtimeMs: s.mtimeMs })
  }
  return out
}

// ---------- 任务记录和会话日志 ----------

/** 示例工程在 <数据目录>/workspace/sample；仓库里的种子没有数据目录 */
export function dataDirOf(sampleDir) {
  const d = resolve(sampleDir, '..', '..')
  return existsSync(join(d, 'projects.json')) ? d : null
}

/** 只看示例工程的任务（项目上下文第 5 条：别的项目的会话内容不看） */
export function sampleTasks(dataDir) {
  if (!dataDir) return []
  let projects
  try { projects = JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')).projects || [] } catch { return [] }
  const out = []
  for (const p of projects.filter((x) => x.sample)) {
    const dir = join(dataDir, 'projects', p.id, 'tasks')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((n) => /^t-.*\.json$/.test(n))) {
      try {
        const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        out.push({ ...(j.task || j), file: join(dir, f), items: j.items || [] })
      } catch { /* 写到一半的记录 */ }
    }
  }
  return out.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
}

export const isInfoFlowTask = (t) => (t.skills || []).includes('info-flow') || t.skill === 'info-flow' || /信息流|info-flow/.test(t.prompt || '')

/** 读 <数据目录>/logs/<任务 id>.jsonl：工作台和引擎之间的 JSON-RPC 帧，取出 session.event */
export function readSessionLog(dataDir, id) {
  const f = dataDir && join(dataDir, 'logs', `${id}.jsonl`)
  if (!f || !existsSync(f)) return null
  const events = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const ev = e.frame?.params?.event
    if (ev && ev.type) events.push(ev)
  }
  return { file: f, events }
}

/** 从事件里整理：工具调用、提问、各轮的助手文字、模型名、步数 */
export function summarizeLog(events) {
  const calls = []
  const byId = new Map()
  const texts = [] // { turn, seq, text }
  let model = null
  let steps = 0
  for (const e of events) {
    const d = e.data || {}
    if (e.type === 'tool/call') {
      let args = d.arguments
      if (typeof args === 'string') { try { args = JSON.parse(args) } catch { /* 保留原文 */ } }
      const c = { seq: e.seq, turn: d.turn, name: d.name, args, raw: typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments ?? '') }
      calls.push(c)
      byId.set(d.callId, c)
    } else if (e.type === 'tool/result') {
      const c = byId.get(d.message?.toolCallId || d.message?.source?.callId)
      if (c) {
        const content = d.message?.content || []
        c.result = content.map((x) => x.text || '').join('\n')
        c.isError = !!(d.message?.isError || d.isError)
      }
    } else if (e.type === 'assistant/message') {
      for (const b of d.message?.content || []) if (b.type === 'text' && b.text?.trim()) texts.push({ turn: d.turn, seq: e.seq, text: b.text })
    } else if (e.type === 'request/context') model = model || `${d.provider}/${d.model}`
    else if (e.type === 'step/end') steps++
  }
  return { calls, texts, model, steps }
}

/** 最后一次出图之后助手写的文字（技能第 11 步的汇报）；没有出图就取最后一轮的全部文字 */
export function finalReport(log) {
  const renders = log.calls.filter((c) => /(^|__)(render_info_flow|render_info_flow_matrix|export_info_flow_html)$/.test(c.name))
  const after = renders.length ? renders[renders.length - 1].seq : -1
  let t = log.texts.filter((x) => x.seq > after)
  if (!t.length && log.texts.length) { const last = log.texts[log.texts.length - 1].turn; t = log.texts.filter((x) => x.turn === last) }
  return t.map((x) => x.text).join('\n\n')
}

export const toolIs = (c, short) => new RegExp(`(^|__)${short}$`).test(c.name || '')

// ---------- 模型分析 ----------

/** 节点类别匹配：先按名字，名字没有一个对上再看 note */
export function matchNodes(model, m) {
  const ok = (n, text) => m.re.test(text) && (!m.not || !m.not.test(n.label)) && (!m.group || m.group.test(model.groups[n.groupIndex].label))
  let hit = model.nodes.filter((n) => ok(n, n.label))
  if (!hit.length) hit = model.nodes.filter((n) => ok(n, `${n.label} ${n.note || ''}`))
  return hit
}

/** 从 starts 出发，maxHops 步内能到达的 targets 中的节点（不含起点自身） */
export function reach(model, starts, targets, maxHops) {
  const out = new Map()
  for (const f of model.flows) { if (!out.has(f.from)) out.set(f.from, []); out.get(f.from).push(f.to) }
  const want = new Set(targets.map((n) => n.id))
  const got = new Set()
  for (const s of starts) {
    let frontier = [s.id]
    const seen = new Set([s.id])
    for (let h = 0; h < maxHops && frontier.length; h++) {
      const next = []
      for (const id of frontier) for (const t of out.get(id) || []) {
        if (seen.has(t)) continue
        seen.add(t); next.push(t)
        if (want.has(t)) got.add(t)
      }
      frontier = next
    }
  }
  return targets.filter((n) => got.has(n.id))
}

/** 主链：逐段求可达，返回 { ok, segments:[{from,to,ok}], matched } */
export function checkChain(model, cs, chain) {
  const sets = chain.path.map((k) => matchNodes(model, cs.nodes[k]))
  const segs = []
  let cur = sets[0]
  for (let i = 1; i < sets.length; i++) {
    const nxt = cur.length && sets[i].length ? reach(model, cur, sets[i], cs.maxHops) : []
    segs.push({ from: cs.nodes[chain.path[i - 1]].name, to: cs.nodes[chain.path[i]].name, ok: nxt.length > 0, missing: !cur.length ? 'from' : !sets[i].length ? 'to' : '' })
    cur = nxt
  }
  return { ok: segs.every((s) => s.ok), segments: segs, matched: sets.map((s, i) => [cs.nodes[chain.path[i]].name, s.map((n) => n.label)]) }
}

/** 模型里的文字条目：节点（名字 + note）和流向标签 */
export function modelTexts(model) {
  return [
    ...model.nodes.map((n) => ({ where: `节点“${n.label}”`, text: `${n.label} ${n.note || ''}`, pending: n.pending })),
    ...model.flows.map((f) => ({ where: `流向“${model.nodeMap.get(f.from)?.label} → ${model.nodeMap.get(f.to)?.label}”`, text: f.label || '', pending: /待确认|待定|不确定/.test(f.label || '') })),
  ]
}

/** 冲突在模型里怎么处理的：marked 待确认并写出两个值；picked 只写了一个值（擅自定值）；absent 没提 */
export function conflictInModel(model, c, num) {
  const items = modelTexts(model)
  const [a, b] = c.values
  const marked = items.filter((x) => x.pending && num(a).test(x.text) && num(b).test(x.text))
  if (marked.length) return { state: 'marked', where: marked.map((x) => x.where) }
  const picked = items.filter((x) => c.ctx.test(x.text) && (num(a).test(x.text) !== num(b).test(x.text)))
  if (picked.length) return { state: 'picked', where: picked.map((x) => `${x.where}：${x.text.trim().slice(0, 60)}`) }
  return { state: 'absent', where: [] }
}

/** 汇报文字里有没有提出某个冲突：同一行（或同一段）里出现两个值/全部关键词；有没有两处出处 */
export function conflictInText(text, c, num) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const refs = (l) => (l.match(/任务书|ICD|接口控制文件|表\s*\d+|\d+\.\d+(\.\d+)*|性能要求|接口要求|MIL-STD|GJB/g) || []).length
  // 出处多的行排在前面：摘给人看的那行就是判断“两处出处”的那行
  const hit = lines.filter((l) => (c.values ? c.values.every((v) => num(v).test(l)) && c.ctx.test(l) : c.all.every((re) => re.test(l)))).sort((a, b) => refs(b) - refs(a))
  return { found: hit.length > 0, twoSources: hit.length > 0 && refs(hit[0]) >= 2, lines: hit.slice(0, 3) }
}

/** 模型里有没有经过 MRAM（或任一存储）的二元环：X → S 且 S → X */
export function storageLoops(model, storeIds) {
  const has = new Set(model.flows.map((f) => `${f.from}|${f.to}`))
  const loops = []
  for (const f of model.flows) if (storeIds.has(f.to) && has.has(`${f.to}|${f.from}`)) loops.push([f.from, f.to])
  return loops
}

/** 和技能示例模型比：同名节点、同名流向（起点名 → 终点名）的比例 */
export function similarity(model, ref) {
  const key = (s) => String(s).replace(/[\s（）()／/、·]/g, '').toLowerCase()
  const nodeKeys = new Set(ref.nodes.map((n) => key(n.label)))
  const flowKey = (m, f) => `${key(m.nodeMap.get(f.from)?.label)}>${key(m.nodeMap.get(f.to)?.label)}`
  const flowKeys = new Set(ref.flows.map((f) => flowKey(ref, f)))
  const sameNodes = model.nodes.filter((n) => nodeKeys.has(key(n.label))).length
  const sameFlows = model.flows.filter((f) => flowKeys.has(flowKey(model, f))).length
  return { sameNodes, nodes: model.nodes.length, refNodes: ref.nodes.length, sameFlows, flows: model.flows.length, refFlows: ref.flows.length }
}

export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')
export const short = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
export const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
export { basename }
