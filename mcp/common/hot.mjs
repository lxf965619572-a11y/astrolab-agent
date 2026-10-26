// MCP 服务的工具代码热更新：tools.mjs 及其引用的本地模块（mcp 目录下、node_modules 以外的 .mjs）修改后，
// 下一次调用工具时自动加载新版本，不用重启 DSH。
//
// DSH 只在启动时拉起 MCP 服务进程，进程内已加载的模块不会因文件修改而更新；以前改了 tools.mjs 必须重启 DSH 才生效，
// 忘记重启时工具仍按旧代码运行，而且看不出来。这里每次调用前比较这些文件的修改时间，有变化就用新的模块地址
// （file:///…/tools.mjs?hotv=<时间戳>）重新导入，并通过模块解析钩子把同一个 hotv 传给它引用的本地模块，整组一起换新。
//
// 只更新工具实现（tools.mjs、lib/、../common/）；server.mjs 中的工具名称、说明和参数定义修改后仍要重启 DSH。
// Node 不支持模块钩子（低于 20.6）时退回为不热更新。

import { register } from 'node:module'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MCP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// 模块解析钩子：父模块地址带 hotv 时，把同一个 hotv 加到它引用的 mcp 目录下的本地模块上
const HOOK = `
let root = ''
export async function initialize(d) { root = d.root.toLowerCase() }
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx)
  if (!ctx.parentURL || !r.url.startsWith('file:')) return r
  const v = new URL(ctx.parentURL).searchParams.get('hotv')
  const low = r.url.toLowerCase()
  if (!v || !low.startsWith(root) || low.includes('/node_modules/')) return r
  const u = new URL(r.url)
  u.searchParams.set('hotv', v)
  return { ...r, url: u.href }
}
`
let hooked = false
try {
  register('data:text/javascript,' + encodeURIComponent(HOOK), import.meta.url, { data: { root: pathToFileURL(MCP_ROOT).href + '/' } })
  hooked = true
} catch {
  hooked = false
}

function stampOf(dirs) {
  let max = 0, n = 0
  const walk = (d) => {
    let list
    try { list = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'selftest' && !e.name.startsWith('.')) walk(join(d, e.name)); continue }
      if (!e.name.endsWith('.mjs')) continue
      try { max = Math.max(max, statSync(join(d, e.name)).mtimeMs); n++ } catch { /* 正在保存的文件，下次再看 */ }
    }
  }
  for (const d of dirs) walk(d)
  return `${Math.floor(max)}-${n}`
}

// 用法（server.mjs 中）：const tools = hotModule(import.meta.url, 'tools.mjs')
//                        server.registerTool('x', {...}, hotHandler(tools, 'xTool'))
export function hotModule(serverUrl, rel) {
  const dir = dirname(fileURLToPath(serverUrl))
  const target = pathToFileURL(join(dir, rel)).href
  const watch = [dir, join(MCP_ROOT, 'common')]
  let mod = null, stamp = null
  return async () => {
    const now = hooked ? stampOf(watch) : 'static'
    if (mod && now === stamp) return mod
    // 第一次按原地址导入；之后有修改时带 hotv 重新导入。导入失败（如文件保存到一半有语法错误）时报错，下次调用再试
    mod = await import(mod && hooked ? `${target}?hotv=${encodeURIComponent(now)}` : target)
    stamp = now
    return mod
  }
}

export const hotHandler = (load, name) => async (...args) => (await load())[name](...args)
