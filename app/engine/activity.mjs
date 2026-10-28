// 把 DSH 的会话事件整理成界面上的“活动”：一条条可读的记录，加上任务卡要显示的进度信息。
//
// 原则（需求 UX-AGT）：同类动作合并（连续读了 6 个文件显示为一条）、思考显示用时、越界拒绝单独标出、
// 写文件统计增删行数；进度优先用智能体自己的计划（todo_write），没有计划时只显示步数。
// 纯函数式的状态机：applyEvent 修改状态，返回本次新增或变化的记录，主进程把这些记录推给界面（按 id 覆盖）。

const MAX_TEXT = 4000

/** 工具名 → 分组。同组且相邻的调用合并为一条记录 */
export function toolGroup(name) {
  if (name === 'read' || name === 'read_image' || name === 'mcp__docreader__read_document') return 'read'
  if (name === 'glob' || name === 'grep') return 'search'
  if (name === 'write' || name === 'edit' || name === 'str_replace_editor') return 'write'
  if (name === 'pwsh' || name === 'bash' || name.startsWith('mcp__utest__') || name.startsWith('mcp__cppcheck__')) return 'run'
  if (name === 'skill') return 'skill'
  if (name === 'todo_write') return 'plan'
  if (name === 'ask_user_question') return 'ask'
  if (name.startsWith('mcp__docgen__')) return 'doc'
  return 'other'
}

const MERGEABLE = new Set(['read', 'search', 'write', 'run', 'doc', 'other'])
const ABORTED = /\b(aborted|was cancell?ed)\b/i
const DENY = /denied|not permitted|sandbox|outside (the )?(workspace|allowed)|拒绝|不允许|无权|access is denied/i

function parseArgs(s) {
  if (s && typeof s === 'object') return s
  try { return JSON.parse(s || '{}') } catch { return {} }
}

function baseName(p) {
  const s = String(p || '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

function lineCount(s) {
  if (!s) return 0
  const n = String(s).split('\n').length
  return String(s).endsWith('\n') ? n - 1 : n
}

/** 一次工具调用的简短说明（文件名、命令说明等），界面再配上中文动词 */
export function summarizeCall(name, args) {
  switch (name) {
    case 'read': case 'read_image': return baseName(args.file_path || args.path)
    case 'mcp__docreader__read_document': return baseName(args.path || args.file || args.file_path)
    case 'write': case 'edit': case 'str_replace_editor': return baseName(args.file_path || args.path)
    case 'glob': return args.pattern || ''
    case 'grep': return args.pattern || ''
    case 'pwsh': case 'bash': return args.description || String(args.command || '').slice(0, 120)
    case 'skill': return args.name || ''
    case 'mcp__knowledge__search_knowledge': return String(args.query || '').slice(0, 60)
    case 'mcp__knowledge__read_knowledge': return String(args.id || '').split('/').pop()
    case 'mcp__knowledge__propose_knowledge': return String(args.title || '').slice(0, 60)
    default: return ''
  }
}

function textOf(blocks) {
  return (blocks || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
}

export function createActivity() {
  return {
    items: [],
    byId: new Map(),
    calls: new Map(), // callId -> { item, call }
    seq: 0,
    turn: 0,
    steps: 0,
    stepStartAt: null,
    current: null, // { kind: 'thinking' | 'tool', since, name?, summary? }
    todos: [],
    files: new Map(), // 路径 -> { path, added, removed, op }
    lastAssistantText: '',
    startedAt: null,
    endedAt: null,
    endReason: null,
    usage: null, // 最近一次模型调用的用量（上下文有多大）+ 累计调用次数
  }
}

function add(st, item, changed) {
  item.id = item.id || `a${++st.seq}`
  st.items.push(item)
  st.byId.set(item.id, item)
  changed.push(item)
  return item
}

function lastItem(st) { return st.items[st.items.length - 1] }

/**
 * 处理一个会话事件。
 * @returns {object[]} 本次新增或变化的记录
 */
export function applyEvent(st, ev) {
  const changed = []
  const d = ev.data || {}
  const at = ev.time || Date.now()
  switch (ev.type) {
    case 'turn/start':
      st.turn = d.turn || st.turn + 1
      if (!st.startedAt) st.startedAt = at
      st.endedAt = null
      st.endReason = null
      st.current = { kind: 'thinking', since: at }
      break
    case 'step/start':
      st.steps += 1
      st.stepStartAt = at
      st.current = { kind: 'thinking', since: at }
      break
    case 'user/message': {
      const src = d.source && d.source.kind
      // 第一条消息里写了 /技能名：DSH 在第一步之前把技能内容附上。记成一条“加载技能”，界面和“用到的”照常显示
      if (src === 'skill-invocation') {
        const name = String(d.source.name || '')
        const item = add(st, { kind: 'tools', at, group: 'skill', calls: [{ callId: `inv-${name}-${at}`, name: 'skill', summary: name, skill: name, status: 'done', at, endedAt: at }] }, changed)
        item.closed = true
        break
      }
      if (src !== 'user') break // 系统注入的上下文、迟到的提问回复等不显示为“你说的话”
      add(st, { kind: 'user', at, text: textOf(d.content).slice(0, MAX_TEXT) }, changed)
      break
    }
    case 'assistant/message': {
      const blocks = (d.message && d.message.content) || []
      if (d.usage) {
        const u = d.usage
        const input = Number(u.inputTokens) || 0, output = Number(u.outputTokens) || 0, cacheRead = Number(u.cacheReadTokens) || 0
        // totalTokens 是这次调用的完整量（提示 + 输出），就是现在上下文的大小
        const used = Number(u.totalTokens) || input + cacheRead + output
        st.usage = { used, input, output, cacheRead, calls: (st.usage ? st.usage.calls : 0) + 1 }
      }
      const reasoning = blocks.filter((b) => b.type === 'reasoning' || b.type === 'thinking').map((b) => b.text || b.thinking || '').join('\n').trim()
      if (reasoning) {
        const ms = st.stepStartAt ? Math.max(0, at - st.stepStartAt) : null
        add(st, { kind: 'thinking', at, ms, text: reasoning.slice(0, MAX_TEXT) }, changed)
      }
      const text = textOf(blocks).trim()
      if (text) {
        st.lastAssistantText = text
        add(st, { kind: 'assistant', at, text: text.slice(0, MAX_TEXT) }, changed)
      }
      break
    }
    case 'tool/call': {
      const name = d.name || ''
      const args = parseArgs(d.arguments)
      const group = toolGroup(name)
      const call = { callId: d.callId, name, summary: summarizeCall(name, args), status: 'running', at }
      if (group === 'plan') {
        st.todos = Array.isArray(args.todos) ? args.todos.map((t) => ({ content: String(t.content || ''), status: t.status || 'pending' })) : st.todos
        call.hidden = true
      }
      if (group === 'write') {
        const path = args.file_path || args.path || ''
        const f = st.files.get(path) || { path, added: 0, removed: 0, op: name }
        if (name === 'write') { f.added += lineCount(args.content); f.op = f.op === 'edit' ? 'edit' : 'write' }
        else { f.added += lineCount(args.new_string); f.removed += lineCount(args.old_string); f.op = 'edit' }
        st.files.set(path, f)
        call.added = name === 'write' ? lineCount(args.content) : lineCount(args.new_string)
        call.removed = name === 'write' ? 0 : lineCount(args.old_string)
        call.path = path
      }
      if (group === 'ask') call.questions = Array.isArray(args.questions) ? args.questions.length : 0
      if (group === 'skill') call.skill = args.name || ''
      if (group === 'run' && (name === 'pwsh' || name === 'bash')) call.command = String(args.command || '').slice(0, 400)
      let item = lastItem(st)
      if (!(item && item.kind === 'tools' && item.group === group && MERGEABLE.has(group) && !item.closed)) {
        item = add(st, { kind: 'tools', group, at, calls: [], hidden: group === 'plan' }, changed)
      } else changed.push(item)
      item.calls.push(call)
      item.updatedAt = at
      st.calls.set(call.callId, { item, call })
      st.current = { kind: 'tool', since: at, name, summary: call.summary, group }
      break
    }
    case 'tool/result': {
      const m = d.message || {}
      const ref = st.calls.get(m.toolCallId)
      if (!ref) break
      const { item, call } = ref
      const text = textOf(m.content)
      call.isError = !!m.isError
      // 停止时被中止的调用（例如等回答的提问）记为“中断”，不算出错
      call.status = call.isError ? (ABORTED.test(text) ? 'interrupted' : 'error') : 'done'
      call.result = text.slice(0, MAX_TEXT)
      call.endedAt = at
      if (call.isError && DENY.test(text)) { call.denied = true; item.denied = true }
      item.updatedAt = at
      changed.push(item)
      if (item.calls.every((c) => c.status !== 'running')) st.current = { kind: 'thinking', since: at }
      break
    }
    case 'turn/end': {
      const reason = (d.reason && d.reason.kind) || 'completed'
      st.endedAt = at
      st.endReason = reason
      st.current = null
      // 被打断的调用（停止、出错）不再显示为“进行中”
      for (const { item, call } of st.calls.values()) {
        if (call.status === 'running') { call.status = 'interrupted'; changed.push(item) }
      }
      const last = lastItem(st)
      if (last && last.kind === 'tools') last.closed = true
      add(st, { kind: 'turn-end', at, reason }, changed)
      break
    }
    default:
      break
  }
  // 非工具记录出现后，之前的工具记录不再合并新调用
  const last = lastItem(st)
  if (last && last.kind !== 'tools') {
    const prev = st.items[st.items.length - 2]
    if (prev && prev.kind === 'tools') prev.closed = true
  }
  return [...new Set(changed)]
}

/** 任务卡要显示的汇总 */
export function summarize(st) {
  const files = [...st.files.values()]
  return {
    steps: st.steps,
    turn: st.turn,
    current: st.current,
    todos: st.todos,
    files: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    startedAt: st.startedAt,
    endedAt: st.endedAt,
    endReason: st.endReason,
    lastAssistantText: st.lastAssistantText.slice(0, 600),
    usage: st.usage,
  }
}

/** 处理器推给界面前去掉内部引用 */
export function plainItem(item) {
  const { closed, ...rest } = item
  return { ...rest, calls: item.calls ? item.calls.map((c) => ({ ...c })) : undefined }
}
