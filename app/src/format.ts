// 把活动记录变成中文说法：动词、合并后的标题、细节；时间和时长格式。

import type { Call, Item } from './api'

export function clock(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 1) return '不到 1 秒'
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

export function baseName(p: string) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

const MCP_LABEL: Record<string, string> = {
  mcp__utest__run_unit_tests: '编译运行单元测试',
  mcp__utest__coverage_detail: '统计覆盖率',
  mcp__utest__check_mcdc: '检查 MC/DC 覆盖',
  mcp__utest__toolchain_info: '查看编译器',
  mcp__cppcheck__run_cppcheck: '静态检查（Cppcheck）',
  mcp__cppcheck__explain_check: '查看检查项说明',
  mcp__cppcheck__cppcheck_version: '查看 Cppcheck 版本',
  mcp__docgen__render_docx: '按部门模板生成 Word',
  mcp__docgen__export_xlsx: '导出 Excel',
  mcp__docgen__list_templates: '查看 Word 模板',
  mcp__docreader__read_document: '读取文档',
  mcp__knowledge__search_knowledge: '查知识库',
  mcp__knowledge__read_knowledge: '读知识条目',
  mcp__knowledge__propose_knowledge: '提议存入知识库',
}

export function callLabel(c: Call) {
  if (c.name === 'mcp__knowledge__search_knowledge' && c.summary) return `查知识库“${c.summary}”`
  if (MCP_LABEL[c.name]) return MCP_LABEL[c.name]
  switch (c.name) {
    case 'read': case 'read_image': return `读 ${c.summary}`
    case 'write': return `写 ${c.summary}`
    case 'edit': case 'str_replace_editor': return `改 ${c.summary}`
    case 'glob': case 'grep': return `搜索 ${c.summary}`
    case 'pwsh': case 'bash': return c.summary || '运行命令'
    case 'skill': return `加载技能 ${c.skill || c.summary}`
    case 'ask_user_question': return `提了 ${c.questions || 1} 个问题`
    case 'subagent': case 'subagent_fork': return '分出子任务'
    case 'todo_write': return '更新步骤'
    default: return c.name
  }
}

/** 活动里正在做的事（任务卡“现在”一行） */
export function nowLabel(cur: { kind: string; name?: string; summary?: string } | null) {
  if (!cur) return ''
  if (cur.kind === 'thinking') return '思考中'
  const c = { name: cur.name || '', summary: cur.summary || '' } as Call
  if (MCP_LABEL[c.name]) return `正在${MCP_LABEL[c.name]}`
  switch (c.name) {
    case 'read': case 'read_image': return `正在读 ${c.summary}`
    case 'write': return `正在写 ${c.summary}`
    case 'edit': return `正在改 ${c.summary}`
    case 'pwsh': case 'bash': return `正在运行：${c.summary}`
    case 'ask_user_question': return '等你回答问题'
    default: return `正在${callLabel(c)}`
  }
}

const list = (xs: string[], n = 4) => (xs.length > n ? `${xs.slice(0, n).join('、')} 等` : xs.join('、'))

/** 一条合并后的工具记录：标题、细节、图标类型 */
export function toolsTitle(item: Extract<Item, { kind: 'tools' }>) {
  const calls = item.calls.filter((c) => !c.hidden)
  const n = calls.length
  const running = calls.some((c) => c.status === 'running')
  const denied = calls.find((c) => c.denied)
  if (denied) {
    const verb = denied.name === 'write' || denied.name === 'edit' ? '写入' : denied.name === 'read' ? '读取' : '执行'
    return { title: `想${verb} ${denied.path || denied.summary}，已自动拒绝`, detail: '超出项目目录。智能体会改用项目内的位置；确实需要时可以把该目录加入项目', tone: 'warn' as const }
  }
  const tone = calls.some((c) => c.status === 'error') ? 'err' as const : running ? 'run' as const : calls.some((c) => c.status === 'interrupted') ? 'idle' as const : 'ok' as const
  switch (item.group) {
    case 'read': return { title: running && n === 1 ? `正在读 ${calls[0].summary}` : `读了 ${n} 个文件`, detail: list(calls.map((c) => c.summary)), tone }
    case 'search': return { title: `搜索了 ${n} 次`, detail: list(calls.map((c) => c.summary), 3), tone }
    case 'write': {
      const paths = [...new Set(calls.map((c) => c.summary))]
      const add = calls.reduce((s, c) => s + (c.added || 0), 0)
      const rem = calls.reduce((s, c) => s + (c.removed || 0), 0)
      return { title: `写入 ${paths.length} 个文件`, detail: list(paths), tone, added: add, removed: rem }
    }
    case 'run': {
      if (n === 1) {
        const c = calls[0]
        const first = (c.result || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
        return { title: callLabel(c), detail: c.status === 'running' ? '' : first.slice(0, 160), tone }
      }
      return { title: `运行了 ${n} 条命令`, detail: list(calls.map((c) => callLabel(c)), 3), tone }
    }
    case 'skill': return { title: callLabel(calls[0]), detail: '', tone }
    case 'ask': {
      const c = calls[0]
      const detail = c.status === 'running' ? '等你回答' : c.status === 'interrupted' ? '引擎停止，问题已失效' : c.status === 'error' ? '没有得到回答' : '已回答'
      return { title: callLabel(c), detail, tone: c.status === 'running' ? 'ask' as const : tone }
    }
    case 'doc': return { title: n === 1 ? callLabel(calls[0]) : `生成了 ${n} 个文档`, detail: '', tone }
    default: return { title: n === 1 ? callLabel(calls[0]) : `调用了 ${n} 个工具`, detail: n === 1 ? '' : list(calls.map((c) => callLabel(c)), 3), tone }
  }
}
