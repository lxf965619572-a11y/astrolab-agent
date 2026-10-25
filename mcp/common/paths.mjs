// 路径处理：相对路径按当前工作目录解析；写入只允许落在授权目录内。
//
// MCP 服务由 DSH 拉起，运行在 DSH 的沙箱之外，所以写文件的权限由服务自己把关：
//   DOC_ALLOWED_ROOTS  允许写入的目录，多个用分号分隔；未设置时只允许写当前工作目录（即启动 DSH 时的工作区）

import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const resolvePath = (p) => resolve(isAbsolute(p) ? p : resolve(process.cwd(), p))

// 解析为真实路径（展开符号链接、目录联接、subst 盘符）；路径尚不存在时解析最近的已存在上级目录
function real(p) {
  let cur = resolve(p)
  const tail = []
  while (!existsSync(cur)) {
    const up = dirname(cur)
    if (up === cur) return resolve(p)
    tail.unshift(basename(cur))
    cur = up
  }
  try { return join(realpathSync.native(cur), ...tail) } catch { return resolve(p) }
}

export function allowedRoots() {
  const env = process.env.DOC_ALLOWED_ROOTS
  const list = env ? env.split(';').map((s) => s.trim()).filter(Boolean) : [process.cwd()]
  return list.map((r) => real(r))
}

function inside(root, p) {
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s)
  const rel = relative(norm(root), norm(p))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 检查输出路径，返回绝对路径；不合规时抛出中文错误。 */
export function checkOutput(p, ext, overwrite) {
  const abs = resolvePath(p)
  if (!abs.toLowerCase().endsWith(ext)) throw new Error(`输出文件扩展名必须是 ${ext}：${abs}`)
  const roots = allowedRoots()
  if (!roots.some((r) => inside(r, real(abs)))) {
    throw new Error(`不允许写到 ${abs}。允许的目录：${roots.join('；')}（由环境变量 DOC_ALLOWED_ROOTS 配置）`)
  }
  if (existsSync(abs) && !overwrite) throw new Error(`文件已存在：${abs}。确需覆盖时设置 overwrite: true`)
  mkdirSync(dirname(abs), { recursive: true })
  return abs
}
