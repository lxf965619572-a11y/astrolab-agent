// 技能：分类、图标、按描述在本地推荐技能（确定性，不靠模型）。
// 推荐用的是和知识库一样的分词：中文按相邻两字、英文按单词；技能名称权重 3、关键词 2、描述 1。

import type { SkillCard } from './api'

export const CATEGORIES: { id: string; name: string; icon: string }[] = [
  { id: '需求', name: '需求', icon: 'requirements' },
  { id: '设计', name: '设计', icon: 'hld' },
  { id: '编码', name: '编码', icon: 'coding' },
  { id: '测试', name: '测试', icon: 'utest' },
  { id: '走查', name: '走查', icon: 'review' },
  { id: '文档与图', name: '文档与图', icon: 'diagram' },
  { id: '创作', name: '创作', icon: 'sparkle' },
  { id: '其他', name: '其他', icon: 'skills' },
]

export function categoryOf(s: { category?: string }) {
  return CATEGORIES.find((c) => c.id === s.category) || CATEGORIES[CATEGORIES.length - 1]
}

export function skillIcon(s: SkillCard) {
  return s.icon || categoryOf(s).icon
}

const STOP = new Set(['一个', '一下', '这个', '那个', '我们', '你们', '进行', '可以', '需要', '时候', '用户', '使用', '根据'])

export function tokens(text: string): string[] {
  const out: string[] = []
  const s = String(text || '').toLowerCase()
  for (const m of s.matchAll(/[a-z0-9_]+|[一-鿿]+/g)) {
    const w = m[0]
    if (/^[a-z0-9_]+$/.test(w)) { if (w.length > 1) out.push(w); continue }
    if (w.length === 1) { out.push(w); continue }
    for (let i = 0; i + 1 < w.length; i++) {
      const bi = w.slice(i, i + 2)
      if (!STOP.has(bi)) out.push(bi)
    }
  }
  return out
}

/** 按描述推荐技能：返回得分最高的几个（得分太低不推荐） */
export function suggestSkills(prompt: string, skills: SkillCard[], limit = 3): { skill: SkillCard; score: number }[] {
  const q = [...new Set(tokens(prompt))]
  if (q.length < 2) return []
  const scored = skills.map((s) => {
    const fields: [string, number][] = [[`${s.title} ${s.name}`, 3], [(s.keywords || []).join(' '), 2], [s.description, 1]]
    let score = 0
    for (const [text, w] of fields) {
      const set = new Set(tokens(text))
      for (const t of q) if (set.has(t)) score += w
    }
    return { skill: s, score }
  }).filter((x) => x.score >= 4).sort((a, b) => b.score - a.score || a.skill.title.localeCompare(b.skill.title, 'zh'))
  return scored.slice(0, limit)
}
