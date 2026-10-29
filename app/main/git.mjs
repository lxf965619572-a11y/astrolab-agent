// Git 操作：任务前快照、相对快照的改动和差异、恢复快照、界面提交、防护钩子。
//
// 快照不建分支、不动用户的暂存区：用一个临时索引文件把工作区（含未跟踪、不含忽略的文件）写成树，
// 再生成一个提交对象，挂在 refs/astrolab/snapshots/<任务> 下防止被垃圾回收。
// 界面发起的写操作带 DEPT_UI_GIT=1，reference-transaction 钩子只放行这种操作；智能体在沙箱里的 git 命令没有这个变量。
// 只用 Node 内置模块和系统的 git。

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const UI_ENV = { DEPT_UI_GIT: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' }

export function git(cwd, args, { env = {}, input, maxBuffer = 64 * 1024 * 1024, encoding = 'utf8' } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile('git', ['-c', 'core.quotepath=false', '-c', 'core.safecrlf=false', ...args], {
      cwd, env: { ...process.env, ...UI_ENV, ...env }, maxBuffer, encoding, windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        // 有些失败原因 git 写在标准输出（比如 nothing to commit），标准错误为空时用它，免得只剩一句 Command failed
        err.message = `git ${args.join(' ')}：${String(stderr || stdout || err.message).trim()}`
        err.stdout = stdout
        err.stderr = stderr
        return reject(err)
      }
      resolvePromise(stdout)
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

export async function isRepo(cwd) {
  try { return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true' } catch { return false }
}

export async function repoInfo(cwd) {
  if (!(await isRepo(cwd))) return { repo: false }
  const top = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  let branch = ''
  try { branch = (await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() } catch { branch = '' }
  let head = ''
  try { head = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() } catch { head = '' }
  const gitDir = resolve(cwd, (await git(cwd, ['rev-parse', '--git-dir'])).trim())
  return { repo: true, top, branch: branch || (head ? head.slice(0, 7) : ''), head, gitDir }
}

/** 新建仓库并提交当前内容（用于示例工程） */
export async function initRepo(cwd, message = '初始版本') {
  await git(cwd, ['init', '-q'])
  await git(cwd, ['config', 'user.name', 'AstroLab'])
  await git(cwd, ['config', 'user.email', 'astrolab@localhost'])
  await git(cwd, ['add', '-A'])
  await git(cwd, ['commit', '-q', '-m', message])
}

/** 当前工作区写成树对象（临时索引，不影响用户的暂存区） */
async function worktreeTree(cwd, gitDir, name) {
  const index = join(gitDir, `astrolab-${name}.index`)
  const env = { GIT_INDEX_FILE: index }
  try { unlinkSync(index) } catch { /* 没有旧文件 */ }
  let hasHead = true
  try { await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']) } catch { hasHead = false }
  if (hasHead) await git(cwd, ['read-tree', 'HEAD'], { env })
  await git(cwd, ['add', '-A'], { env })
  const tree = (await git(cwd, ['write-tree'], { env })).trim()
  try { unlinkSync(index) } catch { /* 留着也无妨 */ }
  return tree
}

/** 任务开始前的快照，返回 { commit, tree, ref } */
export async function snapshot(cwd, taskId) {
  const info = await repoInfo(cwd)
  if (!info.repo) throw new Error('不是 Git 仓库')
  const tree = await worktreeTree(cwd, info.gitDir, 'snap')
  const args = ['commit-tree', tree, '-m', `AstroLab 任务快照 ${taskId}`]
  if (info.head) args.splice(2, 0, '-p', info.head)
  const commit = (await git(cwd, args, { env: { GIT_AUTHOR_NAME: 'AstroLab', GIT_AUTHOR_EMAIL: 'astrolab@localhost', GIT_COMMITTER_NAME: 'AstroLab', GIT_COMMITTER_EMAIL: 'astrolab@localhost' } })).trim()
  const ref = `refs/astrolab/snapshots/${taskId}`
  await git(cwd, ['update-ref', ref, commit])
  return { commit, tree, ref, at: Date.now() }
}

function parseNameStatus(out) {
  const parts = out.split('\0').filter((x, i, a) => !(x === '' && i === a.length - 1))
  const res = []
  for (let i = 0; i < parts.length; i += 2) res.push({ status: parts[i][0], path: parts[i + 1] })
  return res
}

/** 相对快照的改动：[{ path, status: A|M|D, added, removed, binary }] */
export async function changes(cwd, snapTree, out = {}) {
  const info = await repoInfo(cwd)
  const now = await worktreeTree(cwd, info.gitDir, 'now')
  out.tree = now // 列出改动时的工作区树，提交前用来核对
  if (now === snapTree) return []
  // --relative：项目是仓库的子目录时，只看项目内的改动，路径相对项目
  const ns = parseNameStatus(await git(cwd, ['diff-tree', '-r', '-z', '--no-renames', '--relative', '--name-status', snapTree, now]))
  const num = new Map()
  for (const rec of (await git(cwd, ['diff-tree', '-r', '-z', '--no-renames', '--relative', '--numstat', snapTree, now])).split('\0')) {
    const m = rec.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s)
    if (m) num.set(m[3], { added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]), binary: m[1] === '-' })
  }
  return ns.map((c) => ({ ...c, ...(num.get(c.path) || { added: 0, removed: 0, binary: false }) }))
}

const TEXT_LIMIT = 2 * 1024 * 1024

/** 一个文件在快照中和现在的内容（文本），二进制或过大时只给标记 */
export async function fileVersions(cwd, snapTree, path) {
  const abs = safeJoin(cwd, path)
  let before = null
  try { before = await git(cwd, ['show', `${snapTree}:./${path}`], { encoding: 'buffer' }) } catch { before = null }
  let after = null
  if (existsSync(abs) && statSync(abs).isFile()) after = readFileSync(abs)
  const binary = [before, after].some((b) => b && (b.length > TEXT_LIMIT || b.subarray(0, 8000).includes(0)))
  return {
    path, binary,
    before: binary || before === null ? null : before.toString('utf8'),
    after: binary || after === null ? null : after.toString('utf8'),
    existedBefore: before !== null, existsNow: after !== null,
  }
}

function safeJoin(cwd, rel) {
  const p = resolve(cwd, rel)
  const r = relative(resolve(cwd), p)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`路径越出项目：${rel}`)
  return p
}

/** 把改动过的文件恢复成快照里的样子（新文件删除）。返回恢复的文件数 */
export async function restore(cwd, snapTree, list) {
  const items = list || (await changes(cwd, snapTree))
  let n = 0
  for (const c of items) {
    const abs = safeJoin(cwd, c.path)
    if (c.status === 'A') {
      try { unlinkSync(abs); n++ } catch { /* 已经不在 */ }
      removeEmptyDirs(cwd, dirname(abs))
    } else {
      mkdirSync(dirname(abs), { recursive: true })
      await git(cwd, ['restore', `--source=${snapTree}`, '--worktree', '--', c.path])
      n++
    }
  }
  return n
}

function removeEmptyDirs(root, dir) {
  const top = resolve(root)
  let d = resolve(dir)
  while (d.startsWith(top + sep) && d !== top) {
    try { rmdirSync(d) } catch { return } // 非空目录会失败，正好停下
    d = dirname(d)
  }
}

/**
 * 界面提交：只提交给出的路径（不带上用户另外暂存的内容），返回提交号。
 * 列表里的文件已经不在了：git 认识的（原来跟踪的）算删除照常提交；git 从来没见过的（任务中生成后又删掉、改名）跳过，
 * 不让一个消失的文件挡住整次提交。
 */
export async function commit(cwd, message, paths) {
  if (!paths || !paths.length) throw new Error('没有要提交的文件')
  const exist = paths.filter((p) => existsSync(safeJoin(cwd, p)))
  const gone = paths.filter((p) => !exist.includes(p))
  let known = []
  if (gone.length) {
    const inIndex = (await git(cwd, ['ls-files', '-z', '--', ...gone])).split('\0')
    let inHead = []
    try { inHead = (await git(cwd, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...gone])).split('\0') } catch { /* 还没有提交 */ }
    const set = new Set([...inIndex, ...inHead].filter(Boolean))
    known = gone.filter((p) => set.has(p))
  }
  const list = [...exist, ...known]
  if (!list.length) throw new Error('列表里的文件都已经不在了，没有可提交的改动')
  if (exist.length) await git(cwd, ['add', '-A', '--', ...exist])
  if (known.length) await git(cwd, ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...known]) // 已删除的跟踪文件：记为删除
  const staged = (await git(cwd, ['diff', '--cached', '--name-only', 'HEAD', '--', ...list]).catch(() => 'x')).trim()
  if (!staged) throw new Error('这些文件和上次提交时一样，没有可提交的改动')
  await git(cwd, ['commit', '-q', '--only', '-m', message, '--', ...list])
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

/** 工作区现在的树（含未跟踪、不含忽略的文件），用来判断列出改动之后文件有没有再变 */
export async function currentTree(cwd) {
  const info = await repoInfo(cwd)
  return worktreeTree(cwd, info.gitDir, 'check')
}

/** 撤销界面刚做的提交（工作区保留改动），只在 HEAD 就是这个提交时执行 */
export async function undoCommit(cwd, sha) {
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  if (head !== sha) throw new Error('提交之后又有新的提交，不能直接撤销')
  await git(cwd, ['reset', '-q', '--soft', 'HEAD~1'])
  await git(cwd, ['reset', '-q', '--', '.'])
}

// 防护钩子的旧版本（换行统一成 LF 后的 SHA-256），认出来就升级成新版
const OLD_GUARD_HOOKS = new Set([
  '2379e7a011946f4cb033ce5897dd0bcadaa79a5301c73297998d4655506132b1', // 2026-10 之前：只放行 DEPT_UI_GIT=1，人用自己的 Git 工具也会被拦
])
const hookDigest = (text) => createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex')

/**
 * 安装防护钩子 reference-transaction：仓库用默认钩子目录时复制进去；
 * 设置了 core.hooksPath（多个仓库共用钩子）或已有同名钩子时不动，返回原因由界面提示。
 */
export async function installGuardHook(cwd, hookSrc) {
  const info = await repoInfo(cwd)
  if (!info.repo) return { ok: false, reason: '不是 Git 仓库' }
  let hooksPath = ''
  try { hooksPath = (await git(cwd, ['config', '--get', 'core.hooksPath'])).trim() } catch { hooksPath = '' }
  const ours = readFileSync(hookSrc, 'utf8')
  if (hooksPath) {
    const p = resolve(info.top, hooksPath, 'reference-transaction')
    if (existsSync(p) && readFileSync(p, 'utf8') === ours) return { ok: true, installed: false }
    return { ok: false, reason: `仓库设置了共用钩子目录 core.hooksPath=${hooksPath}，没有自动安装防护钩子` }
  }
  const dst = join(info.gitDir, 'hooks', 'reference-transaction')
  if (existsSync(dst)) {
    const cur = readFileSync(dst, 'utf8')
    if (cur === ours) return { ok: true, installed: false }
    // 我们自己的旧版钩子（只放行界面操作，连人自己提交也拦）：换成新版
    if (!OLD_GUARD_HOOKS.has(hookDigest(cur))) return { ok: false, reason: '仓库已有 reference-transaction 钩子，没有覆盖' }
    copyFileSync(hookSrc, dst)
    try { chmodSync(dst, 0o755) } catch { /* Windows 不需要 */ }
    return { ok: true, installed: true, upgraded: true }
  }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(hookSrc, dst)
  try { chmodSync(dst, 0o755) } catch { /* Windows 不需要 */ }
  return { ok: true, installed: true }
}
