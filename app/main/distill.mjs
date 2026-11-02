// 知识整理（蒸馏）的素材：从最近的任务记录里挑出值得总结的信号，写成一份素材，交给“知识整理”任务（技能 knowledge-distill）。
//
// 信号按分量排：人在审核时改了智能体的产物（任务结束时的版本和最后提交的差别）> 改动被整个恢复 > 人中途的插话和对提问的回答
// > 出错、被拒绝的操作 > 智能体最后的说明。普通的“做完、提交”只记一行。
// 候选写到我的库的 待整理/，人看过才移进 knowledge/（不主动入库的约定不变）。
//
// 范围：用公网接口（外网试用）时只取示例工程的任务——任务记录里有型号代码，不能发到云端。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.mjs'

const STATE = '.distill/state.json'
const cut = (s, n) => { s = String(s || '').trim(); return s.length > n ? `${s.slice(0, n)}…（截断）` : s }
const day = (ms) => new Date(ms).toISOString().slice(0, 10)
const STATUS = { done: '完成', stopped: '停止', error: '出错', interrupted: '中断' }

/** 整理范围：sample = 只取示例工程的任务；all = 全部。设置 ASTROLAB_DISTILL_SCOPE 优先，否则公网接口时为 sample */
export function distillScope(env, baseURL) {
  if (env.ASTROLAB_DISTILL_SCOPE === 'all' || env.ASTROLAB_DISTILL_SCOPE === 'sample') return env.ASTROLAB_DISTILL_SCOPE
  return /api\.deepseek\.com|openai\.com|anthropic\.com/i.test(String(baseURL || '')) ? 'sample' : 'all'
}

export function readState(mineDir) {
  try { return JSON.parse(readFileSync(join(mineDir, STATE), 'utf8')) } catch { return { lastRun: 0, runs: [] } }
}
export function writeState(mineDir, st) {
  mkdirSync(join(mineDir, '.distill'), { recursive: true })
  writeFileSync(join(mineDir, STATE), JSON.stringify(st, null, 1))
}

/** 候选任务：结束时间晚于 since、不是我的库里的任务（技能创作、整理本身）。返回 { tasks: [{ project, task, items }], skipped } */
export function pendingTasks({ dataDir, projects, since = 0, scope = 'all', limit = 30 }) {
  const out = []
  let skipped = 0
  for (const p of projects) {
    if (p.library) continue
    const dir = join(dataDir, 'projects', p.id, 'tasks')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      let rec
      try { rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
      const t = rec.task
      if (!t || !t.endedAt || t.endedAt <= since || t.stage === 'distill') continue
      if (scope === 'sample' && !p.sample) { skipped++; continue }
      out.push({ project: p, task: t, items: rec.items || [] })
    }
  }
  out.sort((a, b) => b.task.endedAt - a.task.endedAt)
  return { tasks: out.slice(0, limit), skipped, more: Math.max(0, out.length - limit) }
}

/** 人在审核时改了的地方：任务结束时的版本 → 提交的版本，只看提交的文件 */
async function humanEdits(project, t) {
  if (!t.end || !t.end.commit || !t.commit || !t.commit.sha || t.commit.auto) return ''
  try {
    const paths = Array.isArray(t.commit.paths) ? t.commit.paths : []
    const d = await git(project.path, ['diff', '--no-color', '-U1', t.end.commit, t.commit.sha, '--', ...(paths.length ? paths : ['.'])])
    return d.trim()
  } catch { return '' }
}

function section(n, { project, task: t, items }, edits) {
  const L = []
  const result = t.restoredAt ? '改动被整个恢复（没有采用）'
    : t.commit ? `已提交 ${t.commit.files} 个文件${edits ? '，提交前人改过' : ''}`
      : '没有提交'
  L.push(`## 任务 ${n}：${t.title || t.prompt.split('\n')[0]}`)
  L.push(`- 记录：${project.name} / ${t.id}，${day(t.endedAt)}，技能：${t.stageName || '通用'}，${STATUS[t.status] || t.status}，${result}`)
  L.push('', '### 要求', cut(t.prompt, 800))
  const users = items.filter((i) => i.kind === 'user').slice(1).map((i) => cut(i.text, 300))
  if (users.length) L.push('', '### 人在中途说的话', ...users.slice(0, 6).map((u) => `- ${u.replace(/\n+/g, ' ')}`))
  const calls = items.filter((i) => i.kind === 'tools').flatMap((i) => i.calls || [])
  const asks = calls.filter((c) => c.name === 'ask_user_question' || c.questions).filter((c) => c.result)
  if (asks.length) L.push('', '### 提问和回答', ...asks.slice(0, 4).map((c) => `- ${cut(c.result, 400).replace(/\n+/g, ' ')}`))
  const errs = calls.filter((c) => c.status === 'error')
  if (errs.length) L.push('', `### 出错和被拒绝的操作（${errs.length} 次）`, ...errs.slice(0, 6).map((c) => `- ${c.name} ${cut(c.summary, 80)}：${cut(c.result, 200).replace(/\n+/g, ' ')}`))
  const last = [...items].reverse().find((i) => i.kind === 'assistant')
  if (last) L.push('', '### 智能体最后的说明', cut(last.text, 1500))
  if (edits) L.push('', '### 人在审核时改了的地方（智能体交出的版本 → 提交的版本）', '```diff', cut(edits, 2500), '```')
  return L.join('\n')
}

/**
 * 写素材文件，返回 { file, rel, tasks: [id], count, skipped, chars }。
 * known：已有条目的标题（我的库和共享库），用来避免重复和找可以合并的。
 */
export async function buildMaterial({ dataDir, projects, mineDir, since, scope, known = [], maxChars = 60000, now = Date.now() }) {
  const { tasks, skipped, more } = pendingTasks({ dataDir, projects, since, scope })
  const parts = []
  let chars = 0
  const used = []
  for (const x of tasks) {
    const s = section(used.length + 1, x, await humanEdits(x.project, x.task))
    if (chars + s.length > maxChars && used.length) break
    parts.push(s); chars += s.length; used.push(x.task.id)
  }
  const head = [
    `# 知识整理素材 ${day(now)}`,
    '',
    `- 范围：${since ? `${day(since)} 之后` : '最近'}结束的 ${used.length} 个任务${more + tasks.length - used.length > 0 ? `（还有 ${more + tasks.length - used.length} 个下次再整理）` : ''}${scope === 'sample' ? '；用的是公网接口，只取了示例工程的任务' : ''}${skipped ? `，跳过 ${skipped} 个非示例工程的任务` : ''}`,
    '- 素材只给整理用：不要原样抄进候选条目，型号代码和数据不要写进条目（规则和方法可以）。',
    '',
    '## 已有的知识条目（标题）',
    ...(known.length ? known.slice(0, 300).map((t) => `- ${t}`) : ['（还没有）']),
    '',
  ].join('\n')
  const text = `${head}\n${parts.join('\n\n')}\n`
  const rel = `.distill/素材-${day(now)}-${String(now).slice(-6)}.md`
  mkdirSync(join(mineDir, '.distill'), { recursive: true })
  writeFileSync(join(mineDir, rel), text)
  return { file: join(mineDir, rel), rel, tasks: used, count: used.length, skipped, chars: text.length }
}

/** 发给智能体的那句话（技能的步骤在 knowledge-distill 里） */
export function distillPrompt({ rel, count, date }) {
  return [
    `整理最近 ${count} 个任务的经验，按 knowledge-distill 技能做。`,
    `素材：${rel}`,
    `候选条目写到 待整理/${date}/，每条一个文件；整理报告写到 待整理/${date}-整理报告.md。`,
    '不要改 knowledge/ 下已有的条目，要合并或删除的写进报告由我决定。',
  ].join('\n')
}
