// 定时任务的启动条件：到点先查一下这次有没有事可做，没有就不启动智能体。
// 这样不花模型调用，也不产生要人审核的东西（评测里那次“缺输入”的运行用了 21 次模型调用才得出“这里没有代码”）。
//   none     不检查，到点就跑
//   files    工程里有这些类型的文件（例如 c h）才跑
//   commits  上次运行之后有新提交改了这些类型的文件才跑（没给类型就是任何文件）；巡检/ 下的改动不算
//            （审核后提交巡检结果不应触发下一次巡检）。第一次运行、或上次的提交找不到了（改写过历史）都照常跑
// 只用 Node 自带模块和 git.mjs；与 Electron 无关，测试直接调用。

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { git, repoInfo } from './git.mjs'

export const CONDITION_KINDS = ['none', 'files', 'commits']
/** 找文件时跳过的目录：版本库、依赖、生成物、工作台自己的巡检结果 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '巡检', 'runtime', 'dist', '.obsidian', '.trash'])
const OUTPUT_DIR = '巡检/'

/** 整理界面送来的条件：{ kind, exts: ['c','h'] } */
export function normalizeCondition(c) {
  const kind = c && CONDITION_KINDS.includes(c.kind) ? c.kind : 'none'
  if (kind === 'none') return { kind }
  const raw = Array.isArray(c.exts) ? c.exts.join(' ') : String(c.exts || '')
  const exts = [...new Set(raw.split(/[\s,，、;；]+/).map((x) => x.trim().replace(/^\*?\./, '').toLowerCase()).filter((x) => /^[a-z0-9_+-]{1,10}$/.test(x)))].slice(0, 12)
  if (kind === 'files' && !exts.length) throw new Error('“工程里有这些文件才跑”要写文件类型，例如 c h')
  return { kind, exts }
}

export function describeCondition(c) {
  const list = (c && c.exts && c.exts.length) ? c.exts.map((x) => `.${x}`).join(' ') : ''
  if (!c || c.kind === 'none') return ''
  if (c.kind === 'files') return `工程里有 ${list} 文件才跑`
  return list ? `有新提交改了 ${list} 才跑` : '有新提交才跑'
}

const extOf = (f) => { const i = f.lastIndexOf('.'); return i < 0 ? '' : f.slice(i + 1).toLowerCase() }

/** 工程里有没有这些类型的文件（广度优先，最多看 limit 个目录项）；有就返回第一个的相对路径 */
export function findFile(root, exts, limit = 50_000) {
  const want = new Set(exts)
  const queue = ['']
  let seen = 0
  while (queue.length) {
    const rel = queue.shift()
    let ents
    try { ents = readdirSync(join(root, rel), { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (++seen > limit) return null
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push(r) }
      else if (want.has(extOf(e.name))) return r
    }
  }
  return null
}

/**
 * 查启动条件。返回 { ok: true, head? } 或 { ok: false, reason, head? }。
 * head 是工程现在的 HEAD（是 Git 仓库时），调度器记在运行记录里，下次比较“有没有新提交”用
 */
export async function checkCondition(cond, projectPath, lastHead) {
  const c = cond && cond.kind ? cond : { kind: 'none' }
  let info = { repo: false }
  try { info = await repoInfo(projectPath) } catch { /* 不是仓库或 git 不可用 */ }
  const head = info.repo && info.head ? info.head : undefined
  if (c.kind === 'none') return { ok: true, head }
  if (c.kind === 'files') {
    const f = findFile(projectPath, c.exts)
    return f ? { ok: true, head } : { ok: false, reason: `工程里没有 ${c.exts.map((x) => `.${x}`).join(' ')} 文件`, head }
  }
  // commits
  if (!info.repo) return { ok: false, reason: '工程不是 Git 仓库，没法判断有没有新提交（把启动条件改成“不检查”或“有这些文件”）' }
  if (!head) return { ok: false, reason: '工程还没有任何提交' }
  if (!lastHead) return { ok: true, head }
  if (lastHead === head) return { ok: false, reason: `上次运行之后没有新提交（${head.slice(0, 7)}）`, head }
  let names
  try { names = (await git(projectPath, ['diff', '--name-only', '--no-renames', lastHead, head])).split('\n').map((x) => x.trim()).filter(Boolean) } catch { return { ok: true, head } } // 上次的提交找不到了：照常跑
  const hit = names.filter((n) => !n.startsWith(OUTPUT_DIR) && (!c.exts.length || c.exts.includes(extOf(n))))
  if (hit.length) return { ok: true, head, changed: hit.length }
  return { ok: false, reason: `上次运行之后的提交没有改${c.exts.length ? ` ${c.exts.map((x) => `.${x}`).join(' ')} ` : ''}文件（巡检/ 下的不算）`, head }
}
