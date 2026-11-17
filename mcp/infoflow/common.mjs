// 公共部分：图形常量、流向类型、文字测量和换行、转义。纯函数，不读写文件。

export const VERSION = '1.2.0'
// 生成文件里的标记：重新出图时，带这个标记的文件可以直接覆盖（它们是生成物，不是手写的）
export const GENERATED_MARK = 'info-flow-diagram:generated'

export const KINDS = {
  data: { label: '数据流', color: '#2563eb', width: 1.8, dash: null, arrow: '-->' },
  command: { label: '控制流', color: '#d97706', width: 2.6, dash: null, arrow: '==>' },
  event: { label: '事件流', color: '#7c3aed', width: 1.6, dash: '6 4', arrow: '-.->' },
}
export const KIND_ORDER = ['data', 'command', 'event']

// 分组配色：深色用于标题和节点边框，浅色由 fill-opacity 控制
export const GROUP_COLORS = [
  '#0f766e', '#7c3aed', '#b45309', '#be123c',
  '#0369a1', '#4d7c0f', '#9333ea', '#0e7490',
  '#a16207', '#155e75', '#9d174d', '#3f6212',
]

// 模型（全量规格）的上限：大型项目的完整模型可以很大，一张图能看清的规模另见 READABLE
export const LIMITS = { groups: 24, nodes: 300, flows: 800 }
// 一张图的可读性阈值（经验值）：超过时工具提醒拆成总图 + 分图 / 链路图
export const READABLE = { nodes: 30, flows: 45, minCrossings: 8, crossingsPerFlow: 0.9 }

export const NODE_W = 176
export const NODE_PAD_X = 12
export const NODE_PAD_Y = 10
export const LABEL_FS = 13
export const LABEL_LH = 17
export const NOTE_FS = 11
export const NOTE_LH = 14
export const TITLE_FS = 20
export const GROUP_FS = 13
export const EDGE_FS = 11
export const M = 32

const CJK_RE = /[⺀-鿿豈-﫿！-｠　-〿]/
const KIND_ALIASES = {
  data: ['data', '数据', '数据流', '信息', '遥测', 'telemetry'],
  command: ['command', 'cmd', 'control', '控制', '控制流', '指令', '遥控'],
  event: ['event', '事件', '事件流', '通知', '广播', '方式码'],
}

export function kindStyle(kind) {
  return KINDS[kind] || KINDS.data
}

export function normalizeKind(value) {
  if (value === undefined || value === null || value === '') return 'data'
  const s = String(value).trim().toLowerCase()
  for (const kind of KIND_ORDER) {
    if (KIND_ALIASES[kind].includes(s)) return kind
  }
  return null
}

export function isPending(text) {
  return /待确认|待补充|待定|不确定|【\s*待/.test(String(text || ''))
}

export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

export function clean(v) {
  return str(v).replace(/\r/g, '')
}

function charWidth(ch, fontSize) {
  if (ch === ' ') return fontSize * 0.33
  if (CJK_RE.test(ch)) return fontSize
  if (/[A-Z]/.test(ch)) return fontSize * 0.64
  if (/[a-z]/.test(ch)) return fontSize * 0.55
  if (/[0-9]/.test(ch)) return fontSize * 0.58
  if (/[.,:;'"!|/\\()[\]{}<>+=*_-]/.test(ch)) return fontSize * 0.38
  return fontSize * 0.6
}

export function measureText(text, fontSize) {
  let w = 0
  for (const ch of str(text)) w += charWidth(ch, fontSize)
  return w
}

// 按字符/英文单词换行；<br/> 和换行符都当作强制换行
export function wrapText(text, maxWidth, fontSize) {
  const width = Math.max(1, Number(maxWidth) || 1)
  const paragraphs = clean(text).split(/<br\s*\/?>|\n/i)
  const out = []
  for (const para of paragraphs) {
    if (para === '') {
      out.push('')
      continue
    }
    const tokens = para.match(/[A-Za-z0-9_]+(?:[-./:][A-Za-z0-9_]+)*|\s+|[\s\S]/g) || []
    let line = ''
    const flush = () => {
      if (line.trim()) out.push(line.trim())
      line = ''
    }
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line && !line.endsWith(' ')) line += ' '
        continue
      }
      if (measureText(token, fontSize) > width) {
        flush()
        for (const ch of token) {
          if (line && measureText(line + ch, fontSize) > width) {
            out.push(line)
            line = ''
          }
          line += ch
        }
        continue
      }
      const candidate = line + token
      if (line && measureText(candidate, fontSize) > width) {
        // 避免行首出现收尾标点：允许这一行稍微超宽
        if (/^[，。、；：！？）》】”’%]/.test(token)) {
          line = candidate
        } else {
          out.push(line.trim())
          line = token
        }
      } else {
        line = candidate
      }
    }
    flush()
  }
  return out.length ? out : ['']
}

export function escapeXml(value) {
  return clean(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Mermaid 标签里用全角符号代替会破坏语法的字符，避免不同 Mermaid 版本的转义差异
export function escapeMermaid(value) {
  return clean(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '＆')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/"/g, '＂')
    .replace(/\|/g, '｜')
    .replace(/\n/g, '<br/>')
}

// Markdown 表格单元格：竖线和换行会破坏表格
export function escapeCell(value) {
  return clean(value).replace(/\|/g, '｜').replace(/\n/g, ' ')
}

export function fmt(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0
}

export function summarizeNames(names, limit = 8) {
  if (names.length <= limit) return names.join('、')
  return `${names.slice(0, limit).join('、')} 等 ${names.length} 个`
}
