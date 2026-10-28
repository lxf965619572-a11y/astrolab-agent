// 库：知识库、技能库、插件库共用的底层。一个“库”是一个 Git 仓库，内容按目录分：
//   knowledge/<类别>/*.md        知识条目（格式见 mcp/knowledge/lib/kb.mjs）
//   skills/<名字>/SKILL.md …     技能
//   plugins/<名字>/plugin.json …  插件：技能 + 工具服务（MCP）+ 模板，一起安装
//
// 来源：
//   我的库      <数据目录>/library/mine，本机的 Git 仓库，不共享；智能体记的经验草稿、自己做的技能和插件都先放这里
//   共享库      内网 Git 服务器上的仓库（部门通用库、各型号库），克隆到 <数据目录>/library/<id>，只读使用，按需同步
//               部门预置的列表在 <安装目录>/config/libraries.json，用户自己加的在 <数据目录>/library/sources.json
// 权限靠 Git 服务器：型号库只给有权限的人开，克隆不了就看不到。
//
// 分享要审核：提交 = 把条目从我的库复制到共享库的一个新分支 submit/<用户>/<名字>-<时间> 并推送；
// 审核人在工作台（或 Git 服务器的合并请求页面）看改动，通过 = 合并进主分支并删分支，退回 = 删分支。
// 大家只用主分支上的内容，所以没审核的东西不会出现在别人那里。
//
// 安装：把技能或插件从库里复制到 <数据目录>/installed/，引擎下次启动时加载（技能目录、插件的工具服务由引擎补丁加上）。
// 只用 Node 内置模块和系统的 git。

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { git, isRepo } from './git.mjs'
import { parseEntry, serializeEntry } from '../../mcp/knowledge/lib/kb.mjs'

const MINE = 'mine'
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 1)) }
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/** SKILL.md 的头信息（name、description） */
export function skillInfo(dir) {
  try {
    const { meta, body } = parseEntry(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
    const title = (body.match(/^#\s+(.+)$/m) || [])[1] || ''
    return { name: meta.name || basename(dir), description: meta.description || '', title }
  } catch { return null }
}

// 技能的研制环节类别：只用于发起页分组、任务历史筛选和图标，不是导航
export const SKILL_CATEGORIES = ['需求', '设计', '编码', '测试', '走查', '文档与图', '创作', '其他']

const list1 = (v) => (Array.isArray(v) ? v : String(v || '').replace(/^\[|\]$/g, '').split(/[,，]/)).map((x) => String(x).trim().replace(/^["']|["']$/g, '')).filter(Boolean)
const truthy = (v) => v === true || /^(true|yes|是)$/i.test(String(v || '').trim())

/**
 * 发起页用的技能卡片：SKILL.md 头信息里除了 name、description，还可以写
 * title（显示名）、category（类别）、summary（一句话）、keywords、pinned（默认放进常用）、placeholder、hint、report。
 * 没写的按 name / description 推出来，老技能不用改也能用。
 */
export function skillCard(dir) {
  try {
    const { meta, body } = parseEntry(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
    const name = String(meta.name || basename(dir))
    const description = String(meta.description || '')
    const h1 = (body.match(/^#\s+(.+)$/m) || [])[1] || ''
    const first = description.split(/[。；]/)[0]
    const category = SKILL_CATEGORIES.includes(String(meta.category || '').trim()) ? String(meta.category).trim() : '其他'
    const card = {
      name,
      title: String(meta.title || h1 || name).trim(),
      description,
      summary: String(meta.summary || (first.length > 40 ? `${first.slice(0, 38)}…` : first)).trim(),
      category,
      keywords: list1(meta.keywords),
      pinned: truthy(meta.pinned),
    }
    for (const k of ['placeholder', 'hint', 'report', 'icon']) if (meta[k]) card[k] = String(meta[k]).trim()
    return card
  } catch { return null }
}

/** plugin.json：{ name, title, version, description, author, skills: [目录], mcp: [{ name, command, args, env }], templates: [] } */
export function pluginInfo(dir) {
  const j = readJson(join(dir, 'plugin.json'), null)
  if (!j || !j.name) return null
  return {
    name: String(j.name), title: String(j.title || j.name), version: String(j.version || '0.0.0'), description: String(j.description || ''), author: String(j.author || ''),
    skills: Array.isArray(j.skills) ? j.skills.map(String) : (existsSync(join(dir, 'skills')) ? ['skills'] : []),
    mcp: Array.isArray(j.mcp) ? j.mcp.filter((m) => m && m.name && m.args).map((m) => ({ name: String(m.name), command: String(m.command || 'node'), args: m.args.map(String), env: m.env && typeof m.env === 'object' ? m.env : {}, toolCallTimeoutMs: Number(m.toolCallTimeoutMs) || undefined })) : [],
    templates: Array.isArray(j.templates) ? j.templates.map(String) : [],
  }
}

/** 换文件夹时的临时目录（xxx.new-abc123 / xxx.old-abc123）不算技能或插件 */
const TEMP_DIR = /\.(new|old)-[0-9a-f]{6}$/
const list = (dir) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !TEMP_DIR.test(e.name)).map((e) => e.name) } catch { return [] } }

export class Library {
  /**
   * @param {object} o
   * @param {string} o.dataDir      用户数据目录
   * @param {string} o.root         安装目录（或仓库根目录）：内置技能 <root>/skills，部门预置的库列表 <root>/config/libraries.json
   */
  constructor(o) {
    this.o = o
    this.base = join(o.dataDir, 'library')
    this.installedDir = join(o.dataDir, 'installed')
    this.status = new Map() // 库 id -> { syncing, lastSync, error, head }
    // 上次换文件夹没删掉的旧版本（当时被占用），启动时引擎还没起来，这时清掉
    for (const sub of ['skills', 'plugins']) {
      const d = join(this.installedDir, sub)
      try { for (const n of readdirSync(d)) if (TEMP_DIR.test(n)) { try { rmDir(join(d, n)) } catch { /* 下次再清 */ } } } catch { /* 还没装过 */ }
    }
  }

  // ---------- 身份 ----------
  async identity() {
    if (this.who) return this.who
    let name = '', email = ''
    try { name = (await git(this.base, ['config', '--global', 'user.name'])).trim() } catch { /* 没配 */ }
    try { email = (await git(this.base, ['config', '--global', 'user.email'])).trim() } catch { /* 没配 */ }
    let user = 'user'
    try { user = userInfo().username || user } catch { /* 取不到 */ }
    this.who = { name: name || user, email: email || `${user}@astrolab.local`, user: safeId(user) || 'user' }
    return this.who
  }
  async gitId() { const w = await this.identity(); return ['-c', `user.name=${w.name}`, '-c', `user.email=${w.email}`] }

  // ---------- 来源 ----------
  presetSources() { return (readJson(join(this.o.root, 'config', 'libraries.json'), { sources: [] }).sources || []).map((s) => ({ ...s, preset: true })) }
  userSources() { return readJson(join(this.base, 'sources.json'), { sources: [] }).sources || [] }

  sources() {
    const seen = new Set()
    const out = [{ id: MINE, name: '我的库', dir: join(this.base, MINE), writable: true, local: true }]
    for (const s of [...this.presetSources(), ...this.userSources()]) {
      const id = safeId(s.id || s.name)
      if (!id || id === MINE || seen.has(id) || !s.url) continue
      seen.add(id)
      out.push({ id, name: String(s.name || id), url: String(s.url), branch: String(s.branch || 'main'), model: s.model ? String(s.model) : '', preset: !!s.preset, dir: join(this.base, id) })
    }
    return out
  }
  source(id) { const s = this.sources().find((x) => x.id === id); if (!s) throw new Error(`没有这个库：${id}`); return s }

  addSource({ name, url, branch = 'main', model = '' }) {
    if (!name || !url) throw new Error('库的名字和地址都要填')
    const id = safeId(name) || `lib-${randomBytes(2).toString('hex')}`
    const cur = this.userSources().filter((s) => safeId(s.id || s.name) !== id)
    cur.push({ id, name, url, branch, model })
    writeJson(join(this.base, 'sources.json'), { sources: cur })
    return id
  }
  removeSource(id) {
    const s = this.source(id)
    if (s.preset || s.local) throw new Error('部门预置的库和我的库不能移除')
    writeJson(join(this.base, 'sources.json'), { sources: this.userSources().filter((x) => safeId(x.id || x.name) !== id) })
    rmSync(s.dir, { recursive: true, force: true })
  }

  /** 我的库：没有就建（本机 Git 仓库） */
  async ensureMine() {
    const dir = join(this.base, MINE)
    mkdirSync(join(dir, 'knowledge'), { recursive: true })
    mkdirSync(join(dir, 'skills'), { recursive: true })
    mkdirSync(join(dir, 'plugins'), { recursive: true })
    if (!existsSync(join(dir, '.git'))) {
      writeFileSync(join(dir, 'README.md'), '# 我的库\n\n个人的经验、好的设计和代码（knowledge/），自己做的技能（skills/）和插件（plugins/）。\n这里的内容只在本机；要分享给大家，在工作台里“提交到共享库”，审核通过后大家才能看到。\n')
      writeFileSync(join(dir, '.gitignore'), '.utest/\n.dsh/\n.acl-recovery/\n.astrolab-acl-ok\nnode_modules/\n')
      for (const d of ['knowledge', 'skills', 'plugins']) writeFileSync(join(dir, d, '.gitkeep'), '')
      await git(dir, ['init', '-q', '-b', 'main']).catch(() => git(dir, ['init', '-q']))
      await git(dir, [...(await this.gitId()), 'add', '-A'])
      await git(dir, [...(await this.gitId()), 'commit', '-q', '-m', '建立我的库'])
    }
    return dir
  }

  /** 同步一个共享库（没克隆就克隆）；返回状态 */
  async sync(id) {
    const s = this.source(id)
    if (s.local) return this.state(id)
    const st = { ...(this.status.get(id) || {}), syncing: true, error: '' }
    this.status.set(id, st)
    try {
      mkdirSync(this.base, { recursive: true })
      if (!existsSync(join(s.dir, '.git'))) {
        rmSync(s.dir, { recursive: true, force: true })
        await git(this.base, ['clone', '-q', '--branch', s.branch, '--single-branch', s.url, s.dir])
      } else {
        await git(s.dir, ['fetch', '-q', 'origin', `+refs/heads/${s.branch}:refs/remotes/origin/${s.branch}`])
        await git(s.dir, ['reset', '-q', '--hard', `origin/${s.branch}`])
        await git(s.dir, ['clean', '-qfd'])
      }
      st.head = (await git(s.dir, ['rev-parse', 'HEAD'])).trim()
      st.lastSync = Date.now()
    } catch (e) {
      st.error = /Authentication|could not read Username|403|401/i.test(e.message) ? '没有权限或需要登录 Git 服务器' : /resolve host|Could not resolve|unable to access|Connection/i.test(e.message) ? '连不上 Git 服务器' : e.message.slice(0, 300)
    } finally { st.syncing = false }
    this.status.set(id, st)
    return this.state(id)
  }
  async syncAll() { for (const s of this.sources()) if (!s.local) await this.sync(s.id) }

  state(id) {
    const s = this.source(id)
    const st = this.status.get(id) || {}
    return { id: s.id, name: s.name, url: s.url || '', branch: s.branch || '', model: s.model || '', preset: !!s.preset, local: !!s.local, writable: !!s.writable,
      cloned: existsSync(join(s.dir, '.git')), syncing: !!st.syncing, lastSync: st.lastSync || null, error: st.error || '' }
  }
  states() { return this.sources().map((s) => this.state(s.id)) }

  /** 可用的库（已克隆的共享库 + 我的库），给知识库检索和技能目录用 */
  available() {
    return this.sources().filter((s) => s.local || existsSync(join(s.dir, '.git'))).map((s) => ({ id: s.id, name: s.name, dir: s.dir, model: s.model || '', writable: !!s.writable }))
  }

  // ---------- 我的库里的改动 ----------
  /** 我的库：把某些路径的改动提交（界面上的保存、删除、确认草稿） */
  async commitMine(paths, message) {
    const dir = await this.ensureMine()
    await git(dir, ['add', '-A', '--', ...paths])
    const staged = (await git(dir, ['diff', '--cached', '--name-only'])).trim()
    if (!staged) return null
    await git(dir, [...(await this.gitId()), 'commit', '-q', '-m', message])
    return (await git(dir, ['rev-parse', 'HEAD'])).trim()
  }

  // ---------- 提交审核 ----------
  /**
   * 把我的库里的一项（知识条目文件，或 skills/<名>、plugins/<名> 目录）提交到共享库待审核。
   * 返回 { branch }。
   */
  async submit(targetId, relPath, title) {
    const target = this.source(targetId)
    if (target.local) throw new Error('要选一个共享库')
    const mine = await this.ensureMine()
    const src = resolve(mine, relPath)
    if (relative(mine, src).startsWith('..') || !existsSync(src)) throw new Error(`我的库里没有：${relPath}`)
    await this.sync(targetId)
    const st = this.status.get(targetId)
    if (st && st.error) throw new Error(`同步“${target.name}”失败：${st.error}`)
    const who = await this.identity()
    const slug = safeId(basename(relPath).replace(/\.md$/, '')) || randomBytes(3).toString('hex')
    const branch = `submit/${who.user}/${slug}-${stamp()}`
    const wt = join(tmpdir(), `astrolab-submit-${randomBytes(4).toString('hex')}`)
    await git(target.dir, ['worktree', 'add', '-q', '--detach', wt, `origin/${target.branch}`])
    try {
      const dest = join(wt, relPath)
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(join(dest, '..'), { recursive: true })
      if (statSync(src).isDirectory()) cpSync(src, dest, { recursive: true, filter: (p) => !/[\\/](node_modules|\.utest|\.git)([\\/]|$)/.test(p) })
      else {
        // 知识条目：去掉“草稿”状态，型号库补上型号
        const { meta, body } = parseEntry(readFileSync(src, 'utf8'))
        delete meta.status
        if (target.model && !meta.model) meta.model = target.model
        writeFileSync(dest, serializeEntry(meta, body))
      }
      await git(wt, ['add', '-A', '--', relPath])
      // 和共享库里现在的版本一模一样（比如已经通过审核了），没什么可提交的，直接说清楚
      if (!(await git(wt, ['diff', '--cached', '--name-only'])).trim()) throw new Error(`“${target.name}”里已经是这个版本了，不用再提交。改过内容再提交即可。`)
      await git(wt, [...(await this.gitId()), 'commit', '-q', '-m', title || `提交：${relPath}`])
      await git(wt, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`])
    } finally {
      await git(target.dir, ['worktree', 'remove', '--force', wt]).catch(() => rmSync(wt, { recursive: true, force: true }))
    }
    const subs = readJson(join(this.base, 'submissions.json'), [])
    subs.unshift({ branch, library: targetId, path: relPath, title: title || relPath, at: Date.now() })
    writeJson(join(this.base, 'submissions.json'), subs.slice(0, 200))
    return { branch }
  }

  /** 我提交过的：待审核 / 已通过 / 已退回 */
  async submissions() {
    const subs = readJson(join(this.base, 'submissions.json'), [])
    const out = []
    for (const s of subs) {
      let status = '未知'
      const extra = {}
      try {
        const src = this.source(s.library)
        if (existsSync(join(src.dir, '.git'))) {
          const remote = (await git(src.dir, ['ls-remote', '--heads', 'origin', s.branch])).trim()
          if (remote) status = '待审核'
          else {
            await git(src.dir, ['fetch', '-q', 'origin', `+refs/heads/${src.branch}:refs/remotes/origin/${src.branch}`]).catch(() => {})
            const merged = (await git(src.dir, ['log', '-1', '--format=%H', `--grep=${s.branch}`, '--fixed-strings', `origin/${src.branch}`])).trim()
            status = merged ? '已通过' : '已退回'
            if (!merged) Object.assign(extra, await this.rejection(src, s.branch))
          }
        }
      } catch { status = '查不到' }
      out.push({ ...s, status, ...extra })
    }
    return out
  }

  /** 退回原因：rejected/… 分支顶上那个提交（谁、什么时候、为什么） */
  async rejection(src, branch) {
    const rb = rejectedBranch(branch)
    try {
      if (!(await git(src.dir, ['ls-remote', '--heads', 'origin', rb])).trim()) return {}
      await git(src.dir, ['fetch', '-q', 'origin', `+refs/heads/${rb}:refs/remotes/origin/${rb}`])
      const out = await git(src.dir, ['log', '-1', '--format=%an%x09%at%x09%B', `origin/${rb}`])
      const [by, at, ...body] = out.split('\t')
      const text = body.join('\t').trim()
      const reason = text.replace(/^退回：[^\n]*\n*/, '').trim()
      return { rejectedBy: by, rejectedAt: Number(at) * 1000, reason: reason === '（没有写原因）' ? '' : reason }
    } catch { return {} }
  }

  // ---------- 审核（审核人用）----------
  async pending(id) {
    const s = this.source(id)
    if (s.local) return []
    if (!existsSync(join(s.dir, '.git'))) await this.sync(id)
    await git(s.dir, ['fetch', '-q', '--prune', 'origin', '+refs/heads/submit/*:refs/remotes/origin/submit/*', `+refs/heads/${s.branch}:refs/remotes/origin/${s.branch}`])
    const refs = (await git(s.dir, ['for-each-ref', 'refs/remotes/origin/submit', '--format=%(refname:short)%09%(authorname)%09%(committerdate:unix)%09%(subject)'])).trim()
    const out = []
    for (const line of refs ? refs.split('\n') : []) {
      const [ref, author, at, subject] = line.split('\t')
      const files = (await git(s.dir, ['diff', '--name-status', '--no-renames', `origin/${s.branch}...${ref}`])).trim().split('\n').filter(Boolean).map((l) => { const [st, ...p] = l.split('\t'); return { status: st, path: p.join('\t') } })
      out.push({ ref, branch: ref.replace(/^origin\//, ''), author, at: Number(at) * 1000, title: subject, files })
    }
    // 同一个人对同一项提交了好几次（改了再交、或者连点了两下）：只有最新的一次有效，旧的标出来，建议退回
    const key = (b) => b.replace(/-\d{14}$/, '')
    const latest = new Map()
    for (const p of out) if (!latest.has(key(p.branch)) || latest.get(key(p.branch)) < p.branch) latest.set(key(p.branch), p.branch)
    for (const p of out) p.superseded = latest.get(key(p.branch)) !== p.branch
    return out.sort((a, b) => b.at - a.at || (a.branch < b.branch ? 1 : -1))
  }

  async pendingFile(id, ref, path) {
    const s = this.source(id)
    const show = async (spec) => { try { return await git(s.dir, ['show', spec]) } catch { return null } }
    return { path, before: await show(`origin/${s.branch}:${path}`), after: await show(`${ref}:${path}`) }
  }

  async approve(id, ref) {
    const s = this.source(id)
    const branch = ref.replace(/^origin\//, '')
    const subject = (await git(s.dir, ['log', '-1', '--format=%s', ref])).trim()
    const wt = join(tmpdir(), `astrolab-review-${randomBytes(4).toString('hex')}`)
    await git(s.dir, ['fetch', '-q', 'origin', `+refs/heads/${s.branch}:refs/remotes/origin/${s.branch}`])
    await git(s.dir, ['worktree', 'add', '-q', '--detach', wt, `origin/${s.branch}`])
    try {
      await git(wt, [...(await this.gitId()), 'merge', '-q', '--no-ff', '-m', `合并 ${branch}：${subject}`, ref])
      try { await git(wt, ['push', '-q', 'origin', `HEAD:refs/heads/${s.branch}`]) } catch (e) {
        throw new Error(/protected|denied|403|not allowed/i.test(e.message) ? '没有合并权限：请让 Git 服务器管理员给你主分支的推送权限，或在服务器的合并请求页面合并' : e.message)
      }
      await git(wt, ['push', '-q', 'origin', '--delete', branch]).catch(() => {})
    } finally {
      await git(s.dir, ['worktree', 'remove', '--force', wt]).catch(() => rmSync(wt, { recursive: true, force: true }))
    }
    await this.sync(id)
    return { branch, title: subject, merged: true }
  }

  /**
   * 退回：提交分支 submit/<人>/<项>-<时间> 改存成 rejected/<人>/<项>-<时间>，顶上加一个空提交写退回原因
   * （提交人：审核人；时间：退回时间）。原因跟着共享库走，提交人在自己电脑上的“我的提交”里就能看到，退回的内容也还在。
   * 存不了（服务器不让推 rejected/ 分支）时照样退回，只是看不到原因，返回 reasonSaved: false。
   */
  async reject(id, ref, reason = '') {
    const s = this.source(id)
    const branch = ref.replace(/^origin\//, '')
    let title = branch
    try { title = (await git(s.dir, ['log', '-1', '--format=%s', ref])).trim() } catch { /* 分支已不在 */ }
    const why = String(reason || '').trim().slice(0, 2000)
    let reasonSaved = false
    try {
      const tree = (await git(s.dir, ['rev-parse', `${ref}^{tree}`])).trim()
      const msg = `退回：${title}\n\n${why || '（没有写原因）'}`
      const sha = (await git(s.dir, [...(await this.gitId()), 'commit-tree', tree, '-p', ref, '-m', msg])).trim()
      await git(s.dir, ['push', '-q', 'origin', `${sha}:refs/heads/${rejectedBranch(branch)}`])
      reasonSaved = true
    } catch { /* 原因没存上：下面照样退回 */ }
    await git(s.dir, ['push', '-q', 'origin', '--delete', branch])
    await git(s.dir, ['fetch', '-q', '--prune', 'origin', '+refs/heads/submit/*:refs/remotes/origin/submit/*']).catch(() => {})
    return { branch, title, rejected: true, reasonSaved }
  }

  // ---------- 技能与插件 ----------
  installed() { return readJson(join(this.installedDir, 'installed.json'), []) }

  /** 全部技能和插件：内置的、各库里的、我的库里的，带安装状态 */
  async catalog() {
    const inst = this.installed()
    const items = []
    for (const name of list(join(this.o.root, 'skills'))) {
      const info = skillInfo(join(this.o.root, 'skills', name))
      if (info) items.push({ key: `builtin:skill:${name}`, kind: 'skill', name: info.name, title: info.title, description: info.description, source: 'builtin', sourceName: '内置', installed: true, builtin: true, path: `skills/${name}` })
    }
    // 我的库里的东西和共享库里同一路径的内容一样：提交按钮显示“已是最新”，不用点了才告诉人
    const shared = this.available().filter((l) => !l.writable && existsSync(l.dir))
    const digests = new Map()
    const digestOf = (dir) => { if (!digests.has(dir)) digests.set(dir, existsSync(dir) ? dirDigest(dir) : ''); return digests.get(dir) }
    for (const lib of this.available()) {
      let head = ''
      try { head = (await git(lib.dir, ['rev-parse', 'HEAD'])).trim() } catch { /* 我的库可能还没提交 */ }
      for (const name of list(join(lib.dir, 'skills'))) {
        const info = skillInfo(join(lib.dir, 'skills', name))
        if (!info) continue
        items.push(await this.item(lib, 'skill', name, info, inst))
      }
      for (const name of list(join(lib.dir, 'plugins'))) {
        const info = pluginInfo(join(lib.dir, 'plugins', name))
        if (!info) continue
        items.push(await this.item(lib, 'plugin', name, info, inst))
      }
      void head
    }
    for (const it of items) {
      if (!it.mine) continue
      const mineLib = this.available().find((l) => l.id === it.source)
      if (!mineLib) continue
      const d = digestOf(join(mineLib.dir, it.path))
      it.sameIn = shared.filter((l) => d && digestOf(join(l.dir, it.path)) === d).map((l) => l.id)
    }
    return items
  }

  async item(lib, kind, dirName, info, inst) {
    const path = `${kind === 'skill' ? 'skills' : 'plugins'}/${dirName}`
    let commit = ''
    try { commit = (await git(lib.dir, ['log', '-1', '--format=%H', '--', path])).trim() } catch { /* 没提交 */ }
    const rec = inst.find((r) => r.kind === kind && r.name === info.name)
    const fromHere = rec && rec.source === lib.id
    return {
      key: `${lib.id}:${kind}:${dirName}`, kind, name: info.name, title: info.title || '', description: info.description, version: info.version || '',
      source: lib.id, sourceName: lib.name, path, commit, mine: !!lib.writable,
      mcp: kind === 'plugin' ? info.mcp.map((m) => m.name) : [], skills: kind === 'plugin' ? info.skills : [],
      installed: !!fromHere, installedFrom: rec ? rec.source : '', update: !!(fromHere && commit && rec.commit !== commit),
    }
  }

  async install(key) {
    const [libId, kind, dirName] = key.split(':')
    const lib = this.available().find((l) => l.id === libId)
    if (!lib) throw new Error(`没有这个库：${libId}`)
    const src = join(lib.dir, kind === 'skill' ? 'skills' : 'plugins', dirName)
    const info = kind === 'skill' ? skillInfo(src) : pluginInfo(src)
    if (!info) throw new Error(`${kind === 'skill' ? '技能缺 SKILL.md' : '插件缺 plugin.json'}：${dirName}`)
    if (existsSync(join(this.o.root, 'skills', info.name))) throw new Error(`“${info.name}”和内置技能同名，不能安装`)
    const dest = join(this.installedDir, kind === 'skill' ? 'skills' : 'plugins', info.name)
    replaceDir(dest, (tmp) => cpSync(src, tmp, { recursive: true, filter: (p) => !/[\\/](\.git|\.utest)([\\/]|$)/.test(p) }))
    let commit = ''
    try { commit = (await git(lib.dir, ['log', '-1', '--format=%H', '--', relative(lib.dir, src).split('\\').join('/')])).trim() } catch { /* 没提交 */ }
    const inst = this.installed().filter((r) => !(r.kind === kind && r.name === info.name))
    inst.push({ kind, name: info.name, source: lib.id, dirName, commit, version: info.version || '', at: Date.now() })
    writeJson(join(this.installedDir, 'installed.json'), inst)
    return { kind, name: info.name }
  }

  uninstall(kind, name) {
    rmDir(join(this.installedDir, kind === 'skill' ? 'skills' : 'plugins', name))
    writeJson(join(this.installedDir, 'installed.json'), this.installed().filter((r) => !(r.kind === kind && r.name === name)))
  }

  /** 引擎要加载的技能目录：内置、已安装的技能、已安装插件里的技能 */
  skillDirs() {
    const dirs = [join(this.o.root, 'skills'), join(this.installedDir, 'skills')]
    for (const name of list(join(this.installedDir, 'plugins'))) {
      const dir = join(this.installedDir, 'plugins', name)
      const info = pluginInfo(dir)
      for (const s of info ? info.skills : []) {
        const p = resolve(dir, s)
        if (relative(dir, p).startsWith('..') || !existsSync(p)) continue
        // 插件的 skills 可以指向一组技能的父目录，也可以直接是一个技能目录
        dirs.push(existsSync(join(p, 'SKILL.md')) ? join(p, '..') : p)
      }
    }
    return [...new Set(dirs)]
  }

  /** 偏好：哪些技能放进“常用”（覆盖技能头信息里的 pinned） */
  skillPrefs() {
    const p = readJson(join(this.base, 'skill-prefs.json'), {})
    return { pinned: Array.isArray(p.pinned) ? p.pinned : [], unpinned: Array.isArray(p.unpinned) ? p.unpinned : [] }
  }

  setPinned(name, on) {
    const p = this.skillPrefs()
    p.pinned = p.pinned.filter((n) => n !== name)
    p.unpinned = p.unpinned.filter((n) => n !== name)
    ;(on ? p.pinned : p.unpinned).push(name)
    mkdirSync(this.base, { recursive: true })
    writeJson(join(this.base, 'skill-prefs.json'), p)
    return this.skillCards()
  }

  /**
   * 引擎能加载的全部技能，做成发起页的卡片：内置的、安装的（标出是不是我做的）、插件里的。
   * 同名的只留第一个（和引擎加载顺序一致）。
   */
  skillCards() {
    const inst = this.installed()
    const prefs = this.skillPrefs()
    const out = []
    const seen = new Set()
    const add = (dir, extra) => {
      const c = skillCard(dir)
      if (!c || seen.has(c.name)) return
      seen.add(c.name)
      const pinned = prefs.pinned.includes(c.name) ? true : prefs.unpinned.includes(c.name) ? false : c.pinned
      out.push({ ...c, ...extra, pinned })
    }
    const sourceOf = (kind, name) => {
      const rec = inst.find((r) => r.kind === kind && r.name === name)
      return rec && rec.source === 'mine' ? 'mine' : 'installed'
    }
    for (const n of list(join(this.o.root, 'skills'))) add(join(this.o.root, 'skills', n), { source: 'builtin' })
    for (const n of list(join(this.installedDir, 'skills'))) add(join(this.installedDir, 'skills', n), { source: sourceOf('skill', n) })
    for (const pn of list(join(this.installedDir, 'plugins'))) {
      const dir = join(this.installedDir, 'plugins', pn)
      const info = pluginInfo(dir)
      if (!info) continue
      for (const s of info.skills) {
        const p = resolve(dir, s)
        if (relative(dir, p).startsWith('..') || !existsSync(p)) continue
        const dirs = existsSync(join(p, 'SKILL.md')) ? [p] : list(p).map((x) => join(p, x))
        for (const d of dirs) add(d, { source: sourceOf('plugin', info.name), plugin: info.name })
      }
    }
    // 按研制流程排：需求 → 设计 → 编码 → 测试 → 走查 → 文档与图 → 创作 → 其他；同类里内置的在前
    const rank = { builtin: 0, installed: 1, mine: 2 }
    const order = ['requirements-analysis', 'preliminary-design', 'detailed-design', 'coding', 'unit-test-design', 'code-walkthrough']
    const pos = (c) => (order.includes(c.name) ? order.indexOf(c.name) : 99)
    return out.sort((a, b) => SKILL_CATEGORIES.indexOf(a.category) - SKILL_CATEGORIES.indexOf(b.category)
      || rank[a.source] - rank[b.source] || pos(a) - pos(b) || a.title.localeCompare(b.title, 'zh'))
  }

  /** 引擎要拉起的插件工具服务：[{ id, name, command, args, env, toolCallTimeoutMs }]，路径已换成绝对路径 */
  mcpServers(nodePath) {
    const out = []
    for (const name of list(join(this.installedDir, 'plugins'))) {
      const dir = join(this.installedDir, 'plugins', name)
      const info = pluginInfo(dir)
      for (const m of info ? info.mcp : []) {
        const args = m.args.map((a) => (/\.(m?js|cjs)$/.test(a) && !isAbsolute(a) ? resolve(dir, a) : a))
        if (args.some((a) => isAbsolute(a) && relative(dir, a).startsWith('..') && /\.(m?js|cjs)$/.test(a))) continue // 不许指到插件外
        // 命令只能是 node，或插件目录里的程序
        let command = nodePath
        if (m.command !== 'node') {
          command = resolve(dir, m.command)
          if (relative(dir, command).startsWith('..') || !existsSync(command)) continue
        }
        out.push({ id: `plugin-${safeId(info.name)}-${safeId(m.name)}`, name: `${safeId(info.name)}_${safeId(m.name)}`.replace(/-/g, '_').slice(0, 32), command, args, env: m.env, toolCallTimeoutMs: m.toolCallTimeoutMs, plugin: info.name })
      }
    }
    return out
  }
}

export { isRepo }

/** submit/<人>/<项>-<时间> → rejected/<人>/<项>-<时间> */
export const rejectedBranch = (b) => b.replace(/^submit\//, 'rejected/')

// ---------- 文件夹工具 ----------
const SKIP = /^(node_modules|\.utest|\.git)$/

/** 内容指纹（和提交时复制的范围一样，跳过 node_modules/.utest/.git；文本换行统一成 LF，免得 Windows 检出的 CRLF 算成不同） */
export function dirDigest(dir) {
  const h = createHash('sha1')
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      if (SKIP.test(name)) continue
      const p = join(d, name)
      const r = rel ? `${rel}/${name}` : name
      if (statSync(p).isDirectory()) { walk(p, r); continue }
      let buf = readFileSync(p)
      if (!buf.includes(0)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'))
      h.update(`${r}\0${buf.length}\0`)
      h.update(buf)
    }
  }
  if (statSync(dir).isDirectory()) walk(dir, '')
  return h.digest('hex')
}

/** 删文件夹：Windows 上刚关掉的进程可能还占着文件，多试几次 */
export function rmDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
}

/**
 * 换掉一个文件夹（安装、重新试用）：先写到旁边的临时目录，写好了再把旧的挪开、新的换上。
 * 中途失败时旧版本原样保留（以前是先删旧的，删到一半被占用就既没旧的也没新的）。
 */
export function replaceDir(dest, write) {
  mkdirSync(join(dest, '..'), { recursive: true })
  const tmp = `${dest}.new-${randomBytes(3).toString('hex')}`
  const old = `${dest}.old-${randomBytes(3).toString('hex')}`
  try { write(tmp) } catch (e) { rmDir(tmp); throw e }
  if (existsSync(dest)) {
    try { renameSync(dest, old) } catch (e) {
      rmDir(tmp)
      if (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') throw new Error(`旧版本正被占用（${basename(dest)}），换不了。关掉用到它的程序或重启软件后再试`)
      throw e
    }
  }
  renameSync(tmp, dest)
  try { rmDir(old) } catch { /* 旧的删不掉就留着，下次启动再清 */ }
}
