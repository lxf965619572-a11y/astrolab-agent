// Git 防护：每个智能体创建时（agent/created，串行事件，先于第一步），给它的工作区所在的 Git 仓库装上
// reference-transaction 钩子（../hooks/reference-transaction，与 AstroLab 共用）。智能体的命令行里有 DSH_SHELL，
// 钩子据此拦住提交、建分支和改引用；人用自己的 Git 工具照常提交——这就是“智能体不能提交，人审核后提交”。
// 仓库设置了 core.hooksPath、或已有别人的同名钩子时不动，只在引擎日志里写一句。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'astrolab-git-guard'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'reference-transaction')
// 旧版钩子（只放行 DEPT_UI_GIT=1，连人自己提交也拦），换行统一成 LF 后的 SHA-256
const OLD = new Set(['2379e7a011946f4cb033ce5897dd0bcadaa79a5301c73297998d4655506132b1'])
const digest = (t) => createHash('sha256').update(String(t).replace(/\r\n/g, '\n')).digest('hex')

const git = (cwd, args) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: 15000 })
  return r.status === 0 ? r.stdout.trim() : null
}

/** 给 dir 所在的仓库装钩子。返回 { ok, installed?, upgraded?, reason? } */
export function ensureGuard(dir, hookSrc = HOOK) {
  if (!dir || !existsSync(dir)) return { ok: false, reason: '工作区不存在' }
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (!top) return { ok: false, reason: '不是 Git 仓库（或找不到 git）' }
  const ours = readFileSync(hookSrc, 'utf8')
  const hooksPath = git(dir, ['config', '--get', 'core.hooksPath'])
  if (hooksPath) {
    const p = resolve(top, hooksPath, 'reference-transaction')
    if (existsSync(p) && readFileSync(p, 'utf8') === ours) return { ok: true, installed: false }
    return { ok: false, reason: `仓库设置了 core.hooksPath=${hooksPath}，没有自动安装` }
  }
  const gitDir = git(dir, ['rev-parse', '--absolute-git-dir'])
  if (!gitDir) return { ok: false, reason: '找不到 .git 目录' }
  const dst = join(gitDir, 'hooks', 'reference-transaction')
  let upgraded = false
  if (existsSync(dst)) {
    const cur = readFileSync(dst, 'utf8')
    if (cur === ours) return { ok: true, installed: false }
    if (!OLD.has(digest(cur))) return { ok: false, reason: '仓库已有别的 reference-transaction 钩子，没有覆盖' }
    upgraded = true
  }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(hookSrc, dst)
  try { chmodSync(dst, 0o755) } catch { /* Windows 不需要 */ }
  return { ok: true, installed: true, upgraded }
}

export function apply(ctx) {
  const seen = new Set()
  ctx.on('agent/created', ({ agent }) => {
    const dir = agent?.session?.header?.cwd
    if (!dir || seen.has(dir)) return
    seen.add(dir)
    try {
      const r = ensureGuard(dir)
      if (r.installed || !r.ok) process.stderr.write(`[git-guard] ${dir}：${r.ok ? (r.upgraded ? '防护钩子已升级' : '防护钩子已安装') : r.reason}\n`)
    } catch (e) { process.stderr.write(`[git-guard] ${dir}：${e?.message || e}\n`) }
  })
}
