// 项目：用户打开过的项目文件夹清单（保存在用户数据目录），以及加入项目时的准备工作。
//
// 加入项目时：
//   - Windows 上给项目目录加一条可继承的“本人完全控制”，再运行 DSH 随包的权限修复脚本（FR-PRJ-05，阶段 0 实测必需）
//   - 是 Git 仓库时安装防护钩子 reference-transaction（智能体不能自行提交）
// 示例工程：首次运行时把仓库里的 sample 复制到用户数据目录，建成 Git 仓库，作为第一个项目。

import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as git from './git.mjs'

export class ProjectStore {
  constructor(file) {
    this.file = file
    this.items = []
    try { this.items = JSON.parse(readFileSync(file, 'utf8')).projects || [] } catch { this.items = [] }
  }

  save() {
    mkdirSync(resolve(this.file, '..'), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ projects: this.items }, null, 1))
  }

  list() { return [...this.items].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)) }

  get(id) { return this.items.find((p) => p.id === id) || null }

  findByPath(path) {
    const n = resolve(path).toLowerCase()
    return this.items.find((p) => resolve(p.path).toLowerCase() === n) || null
  }

  add(path, extra = {}) {
    const existing = this.findByPath(path)
    if (existing) return existing
    const p = { id: `p${randomBytes(4).toString('hex')}`, path: resolve(path), name: basename(resolve(path)), addedAt: Date.now(), lastOpenedAt: Date.now(), ...extra }
    this.items.push(p)
    this.save()
    return p
  }

  update(id, patch) {
    const p = this.get(id)
    if (!p) return null
    Object.assign(p, patch)
    this.save()
    return p
  }

  remove(id) {
    this.items = this.items.filter((p) => p.id !== id)
    this.save()
  }
}

/** Windows：项目目录权限准备（只做一次，结果记在项目清单里） */
export function prepareAcl(dir, aclScript, outDir) {
  if (process.platform !== 'win32') return { ok: true, skipped: true }
  const who = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
  const g = spawnSync('icacls', [dir, '/grant', `${who}:(OI)(CI)F`, '/Q'], { windowsHide: true })
  if (g.status !== 0) return { ok: false, reason: `icacls 退出码 ${g.status}` }
  if (existsSync(aclScript)) {
    const ps = spawnSync('where', ['pwsh'], { windowsHide: true }).status === 0 ? 'pwsh' : 'powershell'
    const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', aclScript, '-Path', dir, '-AllowRoot', dir, '-Out', outDir], { windowsHide: true, timeout: 120000 })
    if (r.status !== 0) return { ok: false, reason: `权限修复脚本退出码 ${r.status}` }
  }
  return { ok: true }
}

/** 加入项目时的准备：权限、防护钩子。返回提示（界面显示） */
export async function prepareProject(project, paths) {
  const notes = []
  if (!project.aclAt) {
    const r = prepareAcl(project.path, paths.aclScript, join(paths.data, 'acl-recovery'))
    if (r.ok) project.aclAt = Date.now()
    else notes.push(`文件夹权限没有准备好（${r.reason}），智能体的命令可能起不来`)
  }
  const info = await git.repoInfo(project.path)
  project.git = info.repo
  project.branch = info.repo ? info.branch : ''
  if (info.repo) {
    const h = await git.installGuardHook(project.path, paths.hookSrc)
    if (!h.ok) notes.push(h.reason)
  } else notes.push('这个文件夹不是 Git 仓库：审核时看不到改动对比，也不能提交')
  return notes
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.utest', '.dsh', '.acl-recovery', '.vs', '.vscode', 'Debug', 'Release', 'build', 'out'])

/** 项目里的文件（相对路径，/ 分隔），用于发起任务时选文件和 @ 引用。Git 仓库按 Git 的忽略规则 */
export async function listFiles(dir, query = '', limit = 200) {
  let files = []
  if (await git.isRepo(dir)) {
    const out = await git.git(dir, ['ls-files', '-z', '-co', '--exclude-standard'])
    files = out.split('\0').filter(Boolean)
  } else {
    const { readdirSync } = await import('node:fs')
    const walk = (rel, depth) => {
      if (files.length > 20000 || depth > 12) return
      let entries = []
      try { entries = readdirSync(join(dir, rel), { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(r, depth + 1) } else files.push(r)
      }
    }
    walk('', 0)
  }
  const q = String(query || '').toLowerCase().trim()
  if (!q) return files.slice(0, limit)
  const terms = q.split(/\s+/)
  return files
    .map((f) => ({ f, l: f.toLowerCase() }))
    .filter(({ l }) => terms.every((t) => l.includes(t)))
    .sort((a, b) => (a.l.split('/').pop().includes(terms[0]) ? 0 : 1) - (b.l.split('/').pop().includes(terms[0]) ? 0 : 1) || a.f.length - b.f.length)
    .slice(0, limit)
    .map(({ f }) => f)
}

const READ_LIMIT = 2 * 1024 * 1024

/**
 * 代码模式看文件：读项目里的一个文件（只读）。路径必须在项目里；超过 2 MB 或是二进制（Word、Excel、目标文件）时不给内容。
 * 返回 { path, binary, text, size, tooLarge? }
 */
export function readProjectFile(dir, rel) {
  const abs = resolve(dir, String(rel || ''))
  const r = relative(resolve(dir), abs)
  if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`路径不在项目里：${rel}`)
  if (!existsSync(abs)) throw new Error(`文件不存在：${rel}`)
  const st = statSync(abs)
  if (!st.isFile()) throw new Error(`不是文件：${rel}`)
  if (st.size > READ_LIMIT) return { path: rel, binary: false, text: null, size: st.size, tooLarge: true }
  const buf = readFileSync(abs)
  const binary = buf.subarray(0, 8000).includes(0) || /\.(docx?|xlsx?|pptx?|pdf|zip|o|obj|elf|bin|hex|exe|dll|a|lib)$/i.test(abs)
  return { path: rel, binary, text: binary ? null : buf.toString('utf8'), size: st.size }
}

/**
 * 找出一段话里提到的项目文件：按文件名（含扩展名）匹配，前后不能紧挨着字母、数字等（避免 a.c 匹配到 data.c 里）。
 * 返回 [{ name, paths }]，按在文字里出现的先后排序；同名文件有多个时 paths 有多项，由界面让用户选。
 * 用户常在任务描述里直接写文件名，而不去点“添加文件”，这样两种写法效果一样。
 */
let mentionCache = { dir: '', at: 0, byName: null }
export async function findMentions(dir, text, max = 8) {
  text = String(text || '')
  if (!text.includes('.')) return []
  if (mentionCache.dir !== dir || Date.now() - mentionCache.at > 5000) {
    const byName = new Map()
    for (const f of await listFiles(dir, '', 50000)) {
      const b = f.split('/').pop()
      if (b.length < 3 || !b.includes('.') || b.startsWith('.')) continue
      if (!byName.has(b)) byName.set(b, [])
      byName.get(b).push(f)
    }
    mentionCache = { dir, at: Date.now(), byName }
  }
  const lower = text.toLowerCase()
  const found = []
  for (const [name, paths] of mentionCache.byName) {
    const n = name.toLowerCase()
    let i = lower.indexOf(n)
    while (i >= 0) {
      const before = text[i - 1]
      const after = text[i + n.length]
      if ((!before || !/[A-Za-z0-9_.-]/.test(before)) && (!after || !/[A-Za-z0-9_]/.test(after))) { found.push({ name, paths: paths.slice(0, 20), at: i }); break }
      i = lower.indexOf(n, i + 1)
    }
  }
  return found.sort((a, b) => a.at - b.at).slice(0, max).map(({ name, paths }) => ({ name, paths }))
}

const SAMPLE_IGNORE ='.utest/\n.dsh/\n.acl-recovery/\n.astrolab-acl-ok\n'

/** 首次运行：准备示例工程（复制、建 Git 仓库），返回目录 */
export async function ensureSample(paths) {
  const dir = join(paths.data, 'workspace', 'sample')
  if (!existsSync(dir)) {
    if (!existsSync(paths.sampleSrc)) return null
    mkdirSync(join(paths.data, 'workspace'), { recursive: true })
    // 开发时仓库的 sample 里有评测留下的输出（已被 .gitignore 忽略），只复制 Git 管理的文件；安装包里本来就只有这些
    let tracked = null
    if (await git.isRepo(paths.root)) {
      const out = await git.git(paths.root, ['ls-files', '-z', '--', 'sample'])
      tracked = new Set(out.split('\0').filter(Boolean).map((f) => resolve(paths.root, f).toLowerCase()))
    }
    cpSync(paths.sampleSrc, dir, {
      recursive: true,
      filter: (src) => {
        if (!tracked) return true
        const n = resolve(src).toLowerCase()
        if (tracked.has(n)) return true
        const prefix = n.endsWith('/') || n.endsWith('\\') ? n : n + (process.platform === 'win32' ? '\\' : '/')
        for (const t of tracked) if (t.startsWith(prefix)) return true // 目录：里面有被管理的文件
        return false
      },
    })
  }
  // 示例工程必须是独立的仓库：开发时数据目录在主仓库的 runtime 下，只看 isRepo 会把主仓库当成示例的仓库
  if (!existsSync(join(dir, '.git'))) {
    writeFileSync(join(dir, '.gitignore'), SAMPLE_IGNORE)
    await git.initRepo(dir, '示例工程初始版本')
  }
  return dir
}
